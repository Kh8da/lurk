'use strict';
// Twitch persisted-query hashes that can be refreshed while Lurk runs. When
// Twitch rotates one, requests using it fail with PersistedQueryNotFound; Lurk
// then pulls the current list from TwitchDropsMiner's constants.py (kept up to
// date by its maintainers), caches it and retries.
const { request } = require('../http');

const SOURCE = 'https://raw.githubusercontent.com/DevilXD/TwitchDropsMiner/master/constants.py';
const FILE = 'hashes.json';
const MIN_GAP = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

function parse(text) {
  const map = {};
  const re = /GQLPersistedQuery\(\s*"([A-Za-z0-9_]+)",\s*"([0-9a-f]{64})"/g;
  let m;
  while ((m = re.exec(text))) map[m[1]] = m[2];
  return map;
}

class Hashes {
  constructor() {
    this.map = {};
    this.at = 0;
    this.store = null;
    this.running = null;
    this.lastTry = 0;
  }

  init(store) {
    this.store = store;
    const saved = store.readJson(FILE, null);
    if (saved && saved.map) {
      this.map = saved.map;
      this.at = saved.at || 0;
    }
  }

  get(operationName) {
    return this.map[operationName] || null;
  }

  stale() {
    return Date.now() - this.at > DAY;
  }

  // Returns the operation names whose hash changed (empty when nothing did).
  refresh() {
    if (this.running) return this.running;
    if (Date.now() - this.lastTry < MIN_GAP) return Promise.resolve([]);
    this.lastTry = Date.now();
    this.running = (async () => {
      try {
        const res = await request(SOURCE, { timeout: 15000 });
        if (!res.ok) return [];
        const fresh = parse(res.text);
        if (Object.keys(fresh).length < 5) return [];
        const changed = Object.keys(fresh).filter((k) => this.map[k] !== fresh[k]);
        this.map = { ...this.map, ...fresh };
        this.at = Date.now();
        if (this.store) this.store.writeJson(FILE, { at: this.at, map: this.map });
        return changed;
      } catch {
        return [];
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }
}

module.exports = { hashes: new Hashes(), parse };
