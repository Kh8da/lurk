'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// hashes.js loads the network helper, which needs Electron; stub it out.
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { net: {} };
  return load.call(this, req, ...rest);
};

const { Settings } = require('../src/settings');
const library = require('../src/library');
const { parse } = require('../src/twitch/hashes');
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
