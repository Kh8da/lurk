'use strict';
// Alerts posted to a Discord channel through a webhook URL.
const { request } = require('./http');

const URL_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/;
const FILE = 'discord.bin';

class Discord {
  constructor({ store, onChange }) {
    this.store = store;
    this.onChange = onChange || (() => {});
    const saved = store.readSecret(FILE) || {};
    this.url = saved.url || null;
    this.name = saved.name || null;
    this.pending = false;
    this.error = null;
  }

  status() {
    return { connected: !!this.url, name: this.name, pending: this.pending, error: this.error };
  }

  async connect(rawUrl) {
    const url = String(rawUrl || '').trim().replace(/\?.*$/, '');
    if (!URL_RE.test(url)) throw new Error('That does not look like a Discord webhook URL. It starts with https://discord.com/api/webhooks/');
    this.pending = true;
    this.error = null;
    this.onChange();
    try {
      // GET on a webhook returns its name and channel without posting anything.
      const res = await request(url, { timeout: 15000 });
      const info = res.json();
      if (res.status === 401 || res.status === 404) throw new Error('Discord says that webhook does not exist anymore');
      if (!res.ok || !info) throw new Error(`Discord answered ${res.status}`);
      await this.post(url, { content: 'Lurk is connected. Alerts will show up in this channel.' });
      this.url = url;
      this.name = info.name || 'Webhook';
      this.store.writeSecret(FILE, { url, name: this.name });
    } catch (err) {
      this.error = err.message;
      throw err;
    } finally {
      this.pending = false;
      this.onChange();
    }
  }

  disconnect() {
    this.url = null;
    this.name = null;
    this.error = null;
    this.store.remove(FILE);
    this.onChange();
  }

  async post(url, body) {
    const res = await request(`${url}?wait=true`, { method: 'POST', json: { username: 'Lurk', ...body }, timeout: 15000 });
    if (!res.ok) {
      const j = res.json();
      throw new Error((j && j.message) || `Discord answered ${res.status}`);
    }
  }

  async send(title, body, { image, color } = {}) {
    if (!this.url) return;
    const embed = { title, description: body, color, footer: { text: 'Lurk' }, timestamp: new Date().toISOString() };
    if (image && image.startsWith('https://')) embed.thumbnail = { url: image };
    await this.post(this.url, { embeds: [embed] });
  }
}

module.exports = { Discord };
