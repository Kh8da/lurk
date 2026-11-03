'use strict';
// Shared test helpers: an in-memory store and a fast engine on demo data.
const { Settings } = require('../src/settings');
const { Engine } = require('../src/engine');
const { DemoClient } = require('../src/demo');

function memStore() {
  const files = new Map();
  let writes = 0;
  const api = {
    readJson: (n, fallback) => (files.has(n) ? JSON.parse(files.get(n)) : fallback),
    writeJson: (n, d) => { writes++; files.set(n, JSON.stringify(d)); },
    readSecret: (n) => (files.has(n) ? JSON.parse(files.get(n)) : null),
    writeSecret: (n, d) => { writes++; files.set(n, JSON.stringify(d)); },
    remove: (n) => files.delete(n),
    get writes() { return writes; },
    files,
  };
  return api;
}

const FAST = { watch: 2, progress: 5, inventory: 15, streamCheck: 1000, noChannel: 20, points: 10, refresh: 60000, minTick: 1 };

// Every engine made here is disposed after its test, pass or fail.
const live = new Set();
process.on('exit', () => live.forEach((e) => e.dispose()));

function disposeAll() {
  for (const e of live) e.dispose();
  live.clear();
}

function demoEngine({ token = 'demo', settings: values = {}, timing = {} } = {}) {
  const store = memStore();
  const settings = new Settings(memStore());
  Object.assign(settings.values, values);
  const client = new DemoClient();
  client.setSession({ token });
  const engine = new Engine({ client, store, settings, timing: { ...FAST, ...timing } });
  live.add(engine);
  return { engine, store, settings, client };
}

function waitFor(cond, ms = 5000) {
  return new Promise((resolve, reject) => {
    const end = Date.now() + ms;
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() > end) return reject(new Error('timed out'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { memStore, demoEngine, disposeAll, waitFor, sleep };
