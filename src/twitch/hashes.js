'use strict';
// Twitch persisted-query hashes that can be repaired while Lurk runs. When
// Twitch rotates one, requests using it fail with PersistedQueryNotFound; Lurk
// then looks the operation up in TwitchDropsMiner's constants.py (kept up to
// date by its maintainers) and retries with the hash listed there.
//
// The list is only trusted for repairs: a hash is replaced only after Twitch
// itself rejected it, and only for an operation Lurk was sending. A hash that
// works is never swapped out, so a bad copy of constants.py can at worst fail
// to fix a request that was already broken. Twitch also refuses a hash whose
// stored query has no operation by the name Lurk sends.
const { request } = require('../http');

const SOURCE = 'https://raw.githubusercontent.com/DevilXD/TwitchDropsMiner/master/constants.py';
const FILE = 'hashes.json';
const MIN_GAP = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const HASH_RE = /^[0-9a-f]{64}$/;

function parse(text) {
  const map = {};
  const re = /GQLPersistedQuery\(\s*"([A-Za-z0-9_]+)",\s*"([0-9a-f]{64})"/g;
  let m;
  while ((m = re.exec(text))) map[m[1]] = m[2];
  return map;
}

class Hashes {
  constructor() {
    this.map = {}; // repairs in use, by operation name
    this.latest = {}; // the last list fetched, used only for repairs
    this.at = 0;
    this.store = null;
    this.running = null;
    this.lastTry = 0;
  }

  init(store) {
    this.store = store;
    const saved = store.readJson(FILE, null);
    if (saved && saved.map) {
      this.map = clean(saved.map);
      this.latest = clean(saved.latest || {});
      this.at = saved.at || 0;
    }
  }

  get(operationName) {
    return this.map[operationName] || null;
  }

  stale() {
    return Date.now() - this.at > DAY;
  }

  save() {
    if (this.store) this.store.writeJson(FILE, { at: this.at, map: this.map, latest: this.latest });
  }

  // Fetches the current list without applying any of it.
  fetch() {
    if (this.running) return this.running;
    if (Date.now() - this.lastTry < MIN_GAP) return Promise.resolve(false);
    this.lastTry = Date.now();
    this.running = (async () => {
      try {
        const res = await request(SOURCE, { timeout: 15000 });
        if (!res.ok) return false;
        const fresh = parse(res.text);
        if (Object.keys(fresh).length < 5) return false;
        this.latest = fresh;
        this.at = Date.now();
        this.save();
        return true;
      } catch {
        return false;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // `failed` lists the operations Twitch rejected, as { name, hash } with the
  // hash that was sent. Returns the names that now have a different hash.
  async repair(failed) {
    const fix = () => failed.filter(({ name, hash }) => this.latest[name] && this.latest[name] !== hash);
    if (!fix().length) await this.fetch();
    const changed = [...new Set(fix().map(({ name }) => name))];
    for (const name of changed) this.map[name] = this.latest[name];
    if (changed.length) this.save();
    return changed;
  }
}

function clean(map) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (/^[A-Za-z0-9_]+$/.test(k) && HASH_RE.test(v)) out[k] = v;
  return out;
}

module.exports = { hashes: new Hashes(), parse, Hashes };
