'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// hashes.js and telegram.js load the network helper, which needs Electron;
// stub it out. Tests that talk to a fake server set electron.net.fetch.
const electron = { net: {} };
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return electron;
  return load.call(this, req, ...rest);
};

const { Settings } = require('../src/settings');
const library = require('../src/library');
const { parse, Hashes } = require('../src/twitch/hashes');
const { inFarmingHours } = require('../src/schedule');
const { memStore } = require('./helpers');

test('settings reject wrong types and bad times', () => {
  const s = new Settings(memStore());
  assert.throws(() => s.set('autoClaim', 'yes'), /Bad value/);
  assert.throws(() => s.set('scheduleFrom', '25:00'), /Bad value/);
  assert.throws(() => s.set('accent', 'pink'), /Bad value/);
  assert.throws(() => s.set('favorites', [1, 2]), /Bad value/);
  assert.throws(() => s.set('nope', true), /Unknown setting/);
  s.set('scheduleFrom', '23:30');
  assert.equal(s.values.scheduleFrom, '23:30');
});

test('farming hours wrap past midnight', () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m);
  assert.equal(inFarmingHours('01:00', '09:00', at(5)), true);
  assert.equal(inFarmingHours('01:00', '09:00', at(9)), false);
  assert.equal(inFarmingHours('22:00', '06:00', at(23)), true);
  assert.equal(inFarmingHours('22:00', '06:00', at(3)), true);
  assert.equal(inFarmingHours('22:00', '06:00', at(12)), false);
  assert.equal(inFarmingHours('08:00', '08:00', at(12)), true);
});

test('owned games match Twitch names', () => {
  const games = [
    { id: '1', name: 'Marvel Rivals' },
    { id: '2', name: 'Overwatch' },
    { id: '3', name: 'Rust' },
    { id: '4', name: 'Call of Duty: Modern Warfare 4' },
  ];
  const owned = ['Marvel Rivals', 'Overwatch® 2', 'Call of Duty®', 'Rust'];
  assert.deepEqual(library.match(owned, games).map((g) => g.id), ['1', '2', '3']);
});

test('query hashes are read from TwitchDropsMiner constants', () => {
  const text = `
    "Inventory": GQLPersistedQuery(
        "Inventory",
        "8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404",
    ),
    "Bad": GQLPersistedQuery("Short", "abc"),`;
  assert.deepEqual(parse(text), { Inventory: '8337eb8541b314040b0edde0c09c5c7a2783ba1960aa9edfbf3bac16d0fec404' });
});

test('a fetched hash only replaces one Twitch rejected', async () => {
  const h = new Hashes();
  h.init(memStore());
  h.lastTry = Date.now(); // no network in tests
  const old = 'a'.repeat(64);
  h.latest = { Inventory: 'b'.repeat(64), DropCampaignDetails: 'c'.repeat(64), Evil: 'd'.repeat(64) };
  assert.deepEqual(await h.repair([{ name: 'Inventory', hash: old }]), ['Inventory']);
  assert.equal(h.get('Inventory'), 'b'.repeat(64));
  // Listed but never rejected, or never sent by Lurk: left alone.
  assert.equal(h.get('DropCampaignDetails'), null);
  assert.equal(h.get('Evil'), null);
  // The list offers the same hash Twitch just rejected: nothing to fix.
  assert.deepEqual(await h.repair([{ name: 'Inventory', hash: 'b'.repeat(64) }]), []);
});

test('saved hashes that are not real hashes are dropped', () => {
  const store = memStore();
  store.writeJson('hashes.json', { at: 1, map: { Inventory: 'e'.repeat(64), Bad: 'xyz', 'no-pe': 'f'.repeat(64) } });
  const h = new Hashes();
  h.init(store);
  assert.deepEqual(h.map, { Inventory: 'e'.repeat(64) });
});

test('Telegram only binds the chat that sends the pairing code', async () => {
  const { Telegram } = require('../src/telegram');
  const token = '1234567:AAH9xYzAbCdEfGhIjKlMnOpQrStUvWxYz012';
  const store = { ...memStore(), readSecret: () => null, writeSecret: (f, d) => { store.saved = d; }, remove() {} };
  const tg = new Telegram({ store, onChange: () => {} });
  const sent = [];
  let polls = 0;
  electron.net.fetch = async (url, { body }) => {
    const method = url.split('/').pop();
    const params = JSON.parse(body || '{}');
    let result = true;
    if (method === 'getMe') result = { username: 'lurk_test_bot' };
    if (method === 'sendMessage') sent.push(params);
    if (method === 'getUpdates' && params.timeout > 0) {
      polls++;
      const code = tg.status().code;
      result = polls === 1
        ? [{ update_id: 10, message: { chat: { id: 666 }, text: 'hi' } }, { update_id: 11, message: { chat: { id: 666 }, text: '12345' } }]
        : [{ update_id: 12, message: { chat: { id: 42 }, text: `/start ${code}` } }];
    } else if (method === 'getUpdates') result = [];
    return { status: 200, ok: true, text: async () => JSON.stringify({ ok: true, result }) };
  };
  try {
    await tg.connect(token);
  } finally {
    delete electron.net.fetch;
  }
  assert.equal(tg.chatId, 42);
  assert.equal(store.saved.chatId, 42);
  assert.equal(tg.status().code, null);
  // The stranger got one hint, never the welcome.
  assert.deepEqual(sent.filter((m) => m.chat_id === 666).map((m) => m.text), ['Send the 6-digit code Lurk shows you.']);
  assert.ok(sent.some((m) => m.chat_id === 42 && /connected/.test(m.text)));
});

const { redact } = require('../src/logger');

test('the log never keeps tokens, bot tokens or webhook URLs', () => {
  const tw = 'abcdefghijklmnopqrstuvwxyz0123';
  const lines = [
    `Authorization: OAuth ${tw}`,
    `{"token":"${tw}","refreshToken":"x"}`,
    `access_token=${tw}&scope=`,
    'bot 1234567890:AAH9xYzAbCdEfGhIjKlMnOpQrStUvWxYz012 ok',
    'posting to https://discord.com/api/webhooks/123456/abcDEF-ghi_jkl now',
    'GET https://api.telegram.org/bot1234567890:AAH9xYz/sendMessage',
  ];
  const out = redact(lines.join('\n'));
  assert.ok(!out.includes(tw), out);
  assert.ok(!out.includes('AAH9xYz'), out);
  assert.ok(!out.includes('abcDEF-ghi_jkl'), out);
  assert.match(out, /\[discord webhook\]/);
});

test('redaction leaves normal log text alone', () => {
  const text = 'Watching Sypeh for Marvel Rivals (counts for 2 campaigns), drop 22d4192b-c479-11f1-a353-0a58a9feac02 at 40/240';
  assert.equal(redact(text), text);
});
