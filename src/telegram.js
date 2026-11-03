'use strict';
// Alerts through the user's own Telegram bot. Connecting: paste the bot token,
// then send the bot the one-time code Lurk shows. Only the chat that sends that
// code becomes the target, so someone else who finds the bot first can't claim it.
const crypto = require('crypto');
const { request } = require('./http');

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILE = 'telegram.bin';

class Telegram {
  constructor({ store, onChange }) {
    this.store = store;
    this.onChange = onChange || (() => {});
    const saved = store.readSecret(FILE) || {};
    this.token = saved.token || null;
    this.chatId = saved.chatId || null;
    this.bot = saved.bot || null;
    this.pending = null; // { bot, code } while waiting for the code
    this.error = null;
    this.run = 0;
  }

  status() {
    return {
      connected: !!(this.token && this.chatId),
      bot: this.bot,
      // null: idle. '': checking the token. 'name': waiting for the code at @name.
      pending: this.pending ? this.pending.bot || '' : null,
      code: this.pending ? this.pending.code || null : null,
      error: this.error,
    };
  }

  async api(method, params, token = this.token, timeout = 15000) {
    const res = await request(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', json: params, timeout });
    const j = res.json();
    if (!j || !j.ok) {
      const msg = (j && j.description) || `Telegram answered ${res.status}`;
      throw new Error(res.status === 401 || res.status === 404 ? 'Telegram did not accept that bot token' : msg);
    }
    return j.result;
  }

  async connect(rawToken) {
    const token = String(rawToken || '').trim();
    if (!TOKEN_RE.test(token)) throw new Error('That does not look like a bot token. It looks like 123456789:AAH...');
    const run = ++this.run;
    this.error = null;
    this.pending = { bot: null };
    this.onChange();
    try {
      const me = await this.api('getMe', {}, token);
      if (run !== this.run) return;
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      this.pending = { bot: me.username, code };
      this.onChange();
      // Skip anything sent to the bot before this moment.
      const old = await this.api('getUpdates', { timeout: 0 }, token);
      let offset = old.length ? old[old.length - 1].update_id + 1 : 0;
      const until = Date.now() + 5 * 60 * 1000;
      const hinted = new Set();
      while (run === this.run && Date.now() < until) {
        const updates = await this.api('getUpdates', { offset, timeout: 20 }, token, 30000);
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg || !msg.chat || run !== this.run) continue;
          // "/start 123456" from the Open in Telegram link, or the code typed by hand.
          const sent = String(msg.text || '').replace(/^\/start(@\w+)?/i, '').replace(/[\s-]/g, '');
          if (sent !== code) {
            if (!hinted.has(msg.chat.id)) {
              hinted.add(msg.chat.id);
              await this.api('sendMessage', { chat_id: msg.chat.id, text: 'Send the 6-digit code Lurk shows you.' }, token).catch(() => {});
            }
            continue;
          }
          this.token = token;
          this.chatId = msg.chat.id;
          this.bot = me.username;
          this.store.writeSecret(FILE, { token, chatId: this.chatId, bot: this.bot });
          await this.api('getUpdates', { offset, timeout: 0 }, token).catch(() => {});
          await this.send('Lurk is connected. Alerts will show up here.');
          return;
        }
      }
      if (run === this.run) throw new Error(`The code never reached @${me.username}. Connect again for a new one.`);
    } catch (err) {
      if (run === this.run) this.error = err.message;
      throw err;
    } finally {
      if (run === this.run) {
        this.pending = null;
        this.onChange();
      }
    }
  }

  cancel() {
    this.run++;
    this.pending = null;
    this.onChange();
  }

  disconnect() {
    this.cancel();
    this.token = null;
    this.chatId = null;
    this.bot = null;
    this.error = null;
    this.store.remove(FILE);
    this.onChange();
  }

  // Remote control: answers commands sent to the bot. Only the chat that
  // connected the bot is listened to; everyone else is ignored.
  listen(onCommand) {
    this.onCommand = onCommand;
    if (this.listening) return;
    this.listening = true;
    this.pollLoop();
  }

  async pollLoop() {
    let offset = 0;
    while (this.listening) {
      if (!this.token || !this.chatId || this.pending) {
        await sleep(5000);
        continue;
      }
      try {
        const updates = await this.api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, this.token, 35000);
        for (const u of updates) {
          offset = u.update_id + 1;
          const m = u.message;
          if (!m || typeof m.text !== 'string' || String(m.chat.id) !== String(this.chatId)) continue;
          const reply = await this.onCommand(m.text.trim()).catch((err) => `Something went wrong: ${err.message}`);
          if (reply) await this.api('sendMessage', { chat_id: this.chatId, text: reply, disable_web_page_preview: true });
        }
      } catch {
        // Offline, or the connect flow took over getUpdates for a moment.
        await sleep(10000);
      }
    }
  }

  async send(text, image) {
    if (!this.token || !this.chatId) return;
    if (image && image.startsWith('https://')) {
      try {
        await this.api('sendPhoto', { chat_id: this.chatId, photo: image, caption: text });
        return;
      } catch {}
    }
    await this.api('sendMessage', { chat_id: this.chatId, text, disable_web_page_preview: true });
  }
}

module.exports = { Telegram };
