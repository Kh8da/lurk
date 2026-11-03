'use strict';
// Talks to the Lurk report server: bug reports people send, crash reports the
// app sends, an anonymous daily ping, replies to this install's reports, the
// announcement banner, and (with the admin key) the admin API.
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { request } = require('./http');

const API = 'https://lurk-api.avatar-cart-server.workers.dev';
const SIX_HOURS = 6 * 3600e3;
const CRASHES_PER_DAY = 5;

class Reports extends EventEmitter {
  constructor({ store, log, version }) {
    super();
    this.store = store;
    this.log = log;
    this.version = version;
    let install = store.readSecret('install.bin');
    if (!install || !install.id || !install.secret) {
      install = { id: crypto.randomUUID(), secret: crypto.randomBytes(24).toString('hex') };
      store.writeSecret('install.bin', install);
    }
    this.install = install;
    this.notice = null;
    this.inbox = [];
    this.seenReplies = new Set(store.readJson('inbox.json', { seen: [] }).seen);
    const admin = store.readSecret('admin.bin');
    this.adminKey = admin && admin.key ? admin.key : null;
    this.crashTimes = [];
    this.timer = null;
  }

  platform() {
    const os = require('os');
    return `${os.platform()} ${os.release()} ${os.arch()}`;
  }

  async call(path, { method = 'GET', body, admin = false } = {}) {
    const headers = { 'x-install-secret': this.install.secret };
    if (admin) headers.authorization = `Bearer ${this.adminKey}`;
    const res = await request(API + path, { method, headers, json: body, timeout: 30000 });
    const data = res.json();
    if (!res.ok) throw new Error((data && data.error) || `Report server answered ${res.status}`);
    return data;
  }

  identity() {
    return { installId: this.install.id, installSecret: this.install.secret, version: this.version, platform: this.platform() };
  }

  // ---- reporting ----

  async send(report) {
    const out = await this.call('/v1/reports', { method: 'POST', body: { ...this.identity(), kind: 'report', ...report } });
    this.log.info('reports', `sent report ${out.id}`);
    this.checkInbox().catch(() => {});
    return out.id;
  }

  // Called for unexpected errors; at most a few a day, and only when allowed.
  async crash(enabled, { error, summary, logs }) {
    if (!enabled) return;
    const t = Date.now();
    this.crashTimes = this.crashTimes.filter((x) => t - x < 86400e3);
    if (this.crashTimes.length >= CRASHES_PER_DAY) return;
    this.crashTimes.push(t);
    try {
      await this.call('/v1/reports', { method: 'POST', body: { ...this.identity(), kind: 'crash', error, summary, logs } });
      this.log.info('reports', 'sent crash report');
    } catch (err) {
      this.log.warn('reports', `crash report failed: ${err.message}`);
    }
  }

  // ---- ping, notice, inbox ----

  start(getPing) {
    const run = async () => {
      if (getPing().usageStats) {
        try {
          const out = await this.call('/v1/ping', { method: 'POST', body: { ...this.identity(), accounts: getPing().accounts } });
          this.setNotice(out.notice);
        } catch (err) {
          this.log.debug('reports', `ping failed: ${err.message}`);
        }
      } else {
        try { this.setNotice((await this.call('/v1/notice')).notice); } catch {}
      }
      this.checkInbox().catch(() => {});
    };
    setTimeout(run, 20000);
    this.timer = setInterval(run, SIX_HOURS);
  }

  setNotice(notice) {
    const same = JSON.stringify(notice || null) === JSON.stringify(this.notice);
    this.notice = notice || null;
    if (!same) this.emit('change');
  }

  async checkInbox() {
    let out;
    try {
      out = await this.call(`/v1/inbox?install=${encodeURIComponent(this.install.id)}`);
    } catch {
      return; // no reports from this install yet, or offline
    }
    this.inbox = out.reports || [];
    for (const r of this.inbox) {
      if (!r.reply || this.seenReplies.has(`${r.id}:${r.replied_at}`)) continue;
      this.seenReplies.add(`${r.id}:${r.replied_at}`);
      this.emit('reply', r);
    }
    this.store.writeJson('inbox.json', { seen: [...this.seenReplies].slice(-200) });
    this.emit('change');
  }

  // ---- admin ----

  get isAdmin() {
    return !!this.adminKey;
  }

  async unlock(key) {
    const k = String(key || '').trim();
    if (!/^[a-f0-9]{32,128}$/i.test(k)) throw new Error('That is not an admin key');
    const prev = this.adminKey;
    this.adminKey = k;
    try {
      await this.call('/v1/admin/overview', { admin: true });
    } catch (err) {
      this.adminKey = prev;
      throw err;
    }
    this.store.writeSecret('admin.bin', { key: k });
    this.log.info('reports', 'admin unlocked');
    this.emit('change');
  }

  lock() {
    this.adminKey = null;
    this.store.remove('admin.bin');
    this.emit('change');
  }

  admin(path, opts = {}) {
    if (!this.adminKey) return Promise.reject(new Error('Admin is locked'));
    return this.call(`/v1/admin${path}`, { ...opts, admin: true });
  }

  status() {
    return { installId: this.install.id, notice: this.notice, inbox: this.inbox, admin: this.isAdmin };
  }
}

module.exports = { Reports, API };
