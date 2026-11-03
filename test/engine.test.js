'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rules } = require('../src/engine');
const { demoEngine, disposeAll, waitFor, sleep } = require('./helpers');

test.afterEach(disposeAll);

const H = 3600e3;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

function campaign(drops, { start = -H, end = 10 * H, linked = true } = {}) {
  return {
    id: 'c1', name: 'Test', game: { id: 'g1', name: 'Game' }, status: 'ACTIVE', linked, channels: null,
    startAt: iso(start), endAt: iso(end),
    drops: drops.map((d, i) => ({
      id: `d${i}`, name: `Drop ${i}`, startAt: iso(start), endAt: iso(end), required: 60, minutes: 0,
      claimed: false, claimId: null, preconditions: [], benefits: [{ id: `b${i}`, name: `B${i}`, image: null, type: 'DIRECT_ENTITLEMENT' }],
      ...d,
    })),
  };
}

test('needMinutes: parallel drops take the longest one', () => {
  const c = campaign([{ required: 30 }, { required: 120, minutes: 20 }]);
  assert.equal(rules.needMinutes(c), 100);
});

test('needMinutes: a gated drop starts after its precondition', () => {
  const c = campaign([{ id: 'a', required: 30 }, { id: 'b', required: 60, preconditions: ['a'] }]);
  assert.equal(rules.needMinutes(c), 90);
});

test('achievable: false when no reward can finish before the end', () => {
  const c = campaign([{ required: 120 }], { end: H });
  assert.equal(rules.achievable(c), false);
  assert.equal(rules.achievable(campaign([{ required: 30 }], { end: H })), true);
});

test('finished ignores subscription-only drops', () => {
  const c = campaign([{ required: 30, claimed: true }, { required: 0 }]);
  assert.equal(rules.finished(c), true);
});

test('eligible: unlinked campaigns only count with badge or emote rewards', () => {
  const c = campaign([{}], { linked: false });
  assert.equal(rules.eligible(c), false);
  c.drops[0].benefits[0].type = 'BADGE';
  assert.equal(rules.eligible(c), true);
});

test('joining, watching and auto-claiming a reward', async () => {
  const { engine } = demoEngine();
  const claimed = [];
  engine.on('claimed', (d) => claimed.push(d.name));
  await engine.refresh();
  // OWCS Stage 3 Playoffs: Candlelit Satya Spray starts at 34 of 60 minutes.
  const owcs = [...engine.campaigns.values()].find((c) => c.name === 'OWCS Stage 3 Playoffs');
  engine.join(owcs.id);
  engine.start();
  await waitFor(() => claimed.includes('Candlelit Satya Spray'), 8000);
  engine.dispose();
});

test('join refuses unlinked and subscription-only campaigns', async () => {
  const { engine } = demoEngine();
  await engine.refresh();
  const arc = [...engine.campaigns.values()].find((c) => c.game.name === 'ARC Raiders');
  assert.throws(() => engine.join(arc.id), /Link your ARC Raiders account/);
  engine.dispose();
});

test('autopilot leaves out campaigns that cannot finish in time', async () => {
  const { engine } = demoEngine();
  await engine.refresh();
  engine.autopilot = true;
  const names = engine.targets().map((t) => t.c.name);
  assert.ok(names.length > 0);
  assert.ok(!names.includes('Halloween Terror'), 'Halloween Terror needs 2 h with 1.5 h left');
  engine.dispose();
});

test('a hold stops watching and reports why', async () => {
  const { engine } = demoEngine();
  await engine.refresh();
  engine.autopilot = true;
  engine.start();
  await waitFor(() => engine.status.kind === 'watching');
  engine.setHold('schedule');
  await waitFor(() => engine.status.kind === 'held');
  assert.equal(engine.watch, null);
  assert.equal(engine.status.reason, 'schedule');
  engine.dispose();
});

test('refresh calls running at once share one request', async () => {
  const { engine, client } = demoEngine();
  let calls = 0;
  const orig = client.campaigns.bind(client);
  client.campaigns = async () => { calls++; await sleep(20); return orig(); };
  await Promise.all([engine.refresh(), engine.refresh(), engine.refresh()]);
  assert.equal(calls, 1);
  engine.dispose();
});

test('a disposed engine never writes its files again', async () => {
  const { engine, store } = demoEngine();
  await engine.refresh();
  engine.log('info', 'something');
  engine.dispose();
  const before = store.writes;
  await sleep(400);
  assert.equal(store.writes, before);
});

test('channel points are collected while watching', async () => {
  const { engine } = demoEngine();
  await engine.refresh();
  engine.autopilot = true;
  engine.start();
  await waitFor(() => Object.values(engine.stats.points || {}).some((n) => n > 0), 8000);
  engine.dispose();
});
