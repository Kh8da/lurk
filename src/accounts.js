'use strict';
// Every Twitch account gets its own client and farm engine, and they all run
// at the same time. On disk:
//   accounts.json                   order, which one is shown, login partitions
//   accounts/<userId>/session.bin   encrypted token
//   accounts/<userId>/state.json    queue, Autopilot, activity
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { session } = require('electron');
const { Engine } = require('./engine');

const ENGINE_EVENTS = ['claimed', 'finished', 'new-campaign', 'ending-soon', 'refreshed'];

class Accounts extends EventEmitter {
  // makeClient(): a fresh API client. login(partition): { promise, focus, close },
  // the promise resolving to a token or null.
  constructor({ store, settings, makeClient, login, timing, logger }) {
    super();
    this.logger = logger || { debug() {}, info() {}, warn() {}, error() {} };
    this.store = store;
    this.settings = settings;
    this.makeClient = makeClient;
    this.login = login;
    this.timing = timing;
    this.byId = new Map();
    this.order = [];
    this.activeId = null;
    this.loaded = false;
    this.pending = null; // { kind: 'add' | 'reauth', id, window }
    this.error = null;
  }

  list() {
    return this.order.map((id) => this.byId.get(id)).filter(Boolean);
  }

  get active() {
    return this.byId.get(this.activeId) || this.list()[0] || null;
  }

  signedIn() {
    return this.list().filter((a) => a.auth.status === 'signed-in');
  }

  // ---- loading ----

  load() {
    this.migrateSingleAccount();
    const saved = this.store.readJson('accounts.json', { list: [], active: null });
    for (const rec of saved.list || []) this.create(rec);
    this.activeId = saved.active;
    this.loaded = true;
    for (const a of this.list()) this.restore(a);
    this.changed();
  }

  // Lurk 0.2 kept one account at the top of the data folder.
  migrateSingleAccount() {
    if (this.store.exists('accounts.json') || !this.store.exists('session.bin')) return;
    const s = this.store.readSecret('session.bin');
    if (!s || !s.userId) return;
    const dir = `accounts/${s.userId}`;
    this.store.move('session.bin', `${dir}/session.bin`);
    if (this.store.exists('state.json')) this.store.move('state.json', `${dir}/state.json`);
    const state = this.store.readJson(`${dir}/state.json`, {});
    if (!('autopilot' in state)) this.store.writeJson(`${dir}/state.json`, { ...state, autopilot: this.settings.legacyAutopilot });
    this.store.writeJson('accounts.json', {
      list: [{ id: s.userId, login: s.login, partition: 'persist:twitch-login' }],
      active: s.userId,
    });
  }

  create(rec) {
    const store = this.store.scoped(`accounts/${rec.id}`);
    const client = this.makeClient();
    const engine = new Engine({ client, store, settings: this.settings, timing: this.timing, logger: this.logger, label: `acct:${rec.login || rec.id}` });
    const a = {
      id: rec.id,
      login: rec.login,
      displayName: rec.displayName || rec.login,
      avatar: rec.avatar || null,
      partition: rec.partition,
      auth: { status: 'checking', error: null },
      store,
      client,
      engine,
    };
    engine.on('change', () => this.changed());
    engine.on('auth-lost', () => this.authLost(a));
    for (const ev of ENGINE_EVENTS) {
      engine.on(ev, (data) => {
        // A broken listener must never break the farm loop that emitted the event.
        try {
          this.emit('event', a, ev, data);
        } catch (err) {
          console.error(`event ${ev} failed:`, err);
        }
      });
    }
    this.byId.set(a.id, a);
    if (!this.order.includes(a.id)) this.order.push(a.id);
    return a;
  }

  save() {
    this.store.writeJson('accounts.json', {
      list: this.list().map((a) => ({ id: a.id, login: a.login, displayName: a.displayName, avatar: a.avatar, partition: a.partition })),
      active: this.activeId,
    });
  }

  // False once the account has been removed (or replaced) while we were waiting.
  alive(a) {
    return this.byId.get(a.id) === a;
  }

  async restore(a) {
    if (!this.alive(a)) return;
    const saved = a.store.readSecret('session.bin');
    if (!saved || !saved.token) return this.setAuth(a, 'signed-out');
    a.client.setSession(saved);
    try {
      let who = await a.client.validate();
      if (!who && (await a.client.refresh())) who = await a.client.validate();
      if (!who) {
        a.store.remove('session.bin');
        return this.setAuth(a, 'signed-out', 'Twitch ended this session. Sign in again.');
      }
      await this.start(a);
    } catch (err) {
      // Offline or Twitch unreachable: keep the session and try again soon.
      this.setAuth(a, 'offline', err.message);
      setTimeout(() => this.restore(a), 30000);
    }
  }

  async start(a) {
    const profile = await a.client.profile();
    if (!this.alive(a)) return;
    a.login = a.client.login || a.login;
    a.displayName = profile.displayName || a.login;
    a.avatar = profile.avatar || a.avatar;
    a.store.writeSecret('session.bin', a.client.session());
    this.setAuth(a, 'signed-in');
    this.save();
    a.engine.start();
  }

  setAuth(a, status, error = null) {
    if (!a.auth || a.auth.status !== status) this.logger[status === 'signed-in' ? 'info' : 'warn']('accounts', `${a.login}: ${status}${error ? ` (${error})` : ''}`);
    a.auth = { status, error };
    this.changed();
  }

  // ---- signing in ----

  // Add a new account. Each one signs in inside its own browser partition,
  // so Twitch doesn't hand back the session of an account already added.
  async add() {
    if (this.pending) return this.pending.window.focus();
    const partition = `persist:acct-${crypto.randomBytes(6).toString('hex')}`;
    const token = await this.openLogin({ kind: 'add' }, partition);
    if (!token) return;
    try {
      const probe = this.makeClient();
      probe.setSession({ token });
      const who = await probe.validate();
      if (!who) throw new Error('Twitch did not accept the new session. Try again.');
      let a = this.byId.get(who.userId);
      if (!a) {
        a = this.create({ id: who.userId, login: who.login, partition });
      } else {
        a.engine.stop();
        a.partition = partition;
      }
      a.client.setSession({ ...a.client.session(), token, refreshToken: null, userId: who.userId, login: who.login });
      this.activeId = a.id;
      await this.start(a);
      this.emit('added', a);
    } catch (err) {
      this.error = err.message;
      this.logger.warn('accounts', `adding an account failed: ${err.message}`);
      this.changed();
    }
  }

  // Sign a signed-out account back in, in the partition it used before.
  async reauth(id) {
    const a = this.byId.get(id);
    if (!a) throw new Error('Account not found');
    if (this.pending) return this.pending.window.focus();
    const token = await this.openLogin({ kind: 'reauth', id }, a.partition);
    if (!token) return;
    try {
      const probe = this.makeClient();
      probe.setSession({ token });
      const who = await probe.validate();
      if (!who) throw new Error('Twitch did not accept the new session. Try again.');
      if (who.userId !== a.id) throw new Error(`That signed in as ${who.login}. Use Add account for a different account.`);
      a.engine.stop();
      a.client.setSession({ ...a.client.session(), token, refreshToken: null, userId: who.userId, login: who.login });
      await this.start(a);
    } catch (err) {
      this.setAuth(a, 'signed-out', err.message);
    }
  }

  async openLogin(info, partition) {
    this.error = null;
    const window = this.login(partition);
    this.pending = { ...info, window };
    this.changed();
    try {
      return await window.promise;
    } finally {
      this.pending = null;
      this.changed();
    }
  }

  cancel() {
    if (this.pending) this.pending.window.close();
  }

  async remove(id) {
    const a = this.byId.get(id);
    if (!a) return;
    this.logger.info('accounts', `removing ${a.login}`);
    if (this.pending && this.pending.id === id) this.pending.window.close();
    a.engine.dispose();
    await a.client.revoke();
    this.byId.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (this.activeId === id) this.activeId = this.order[0] || null;
    this.store.removeDir(`accounts/${id}`);
    if (a.partition && !this.list().some((x) => x.partition === a.partition)) {
      session.fromPartition(a.partition).clearStorageData().catch(() => {});
    }
    this.save();
    this.changed();
  }

  setActive(id) {
    if (!this.byId.has(id)) throw new Error('Account not found');
    this.activeId = id;
    this.save();
    this.changed();
  }

  async authLost(a) {
    if (!this.alive(a)) return;
    let ok;
    try {
      // A stray 401 from one endpoint shouldn't sign anyone out if the token still checks out.
      ok = (await a.client.validate()) || ((await a.client.refresh()) && (await a.client.validate()));
    } catch {
      setTimeout(() => this.authLost(a), 30000);
      return;
    }
    if (!this.alive(a)) return;
    if (ok) {
      a.store.writeSecret('session.bin', a.client.session());
      a.engine.start();
      return;
    }
    a.engine.stop();
    a.store.remove('session.bin');
    this.setAuth(a, 'signed-out', 'Twitch signed this account out. Sign in again to keep farming.');
    this.emit('signed-out', a);
  }

  // ---- state ----

  summaries() {
    return this.list().map((a) => ({
      id: a.id,
      login: a.login,
      displayName: a.displayName,
      avatar: a.avatar,
      status: a.auth.status,
      error: a.auth.error,
      farm: a.auth.status === 'signed-in' ? a.engine.summary() : null,
    }));
  }

  pendingState() {
    return this.pending ? { kind: this.pending.kind, id: this.pending.id || null } : null;
  }

  changed() {
    this.emit('change');
  }
}

module.exports = { Accounts };
