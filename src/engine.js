'use strict';
// The farm loop. Works through the targets (joined campaigns first, then, with
// Autopilot on, everything else the account can earn): finds the live channel
// that counts for the most campaigns, "watches" it, follows the progress and
// claims rewards as they unlock.
const { EventEmitter } = require('events');

const MIN = 60 * 1000;
const NO_LOG = { debug() {}, info() {}, warn() {}, error() {} };

const now = () => Date.now();
const ts = (iso) => (iso ? Date.parse(iso) : NaN);

function dropLabel(d) {
  const names = d.benefits.map((b) => b.name).filter(Boolean);
  return names.length ? names.join(' + ') : d.name;
}

function inWindow(item, t) {
  const s = ts(item.startAt);
  const e = ts(item.endAt);
  return !(s > t) && !(e <= t);
}

function preconditionsMet(c, d) {
  return d.preconditions.every((id) => {
    const p = c.drops.find((x) => x.id === id);
    return !p || p.claimed;
  });
}

function earnable(c, d, t = now()) {
  return !d.claimed && d.required > 0 && d.minutes < d.required && preconditionsMet(c, d) && inWindow(d, t);
}

function phase(c, t = now()) {
  if (ts(c.startAt) > t) return 'upcoming';
  if (ts(c.endAt) <= t || c.status === 'EXPIRED') return 'ended';
  return 'active';
}

// Drops earned by subscribing (0 minutes) can't be farmed, so they don't keep a campaign open.
const watchable = (c) => c.drops.filter((d) => d.required > 0);

function finished(c, t = now()) {
  if (phase(c, t) === 'ended') return true;
  const list = watchable(c);
  return list.length > 0 && list.every((d) => d.claimed || ts(d.endAt) <= t);
}

function eligible(c) {
  if (c.linked) return true;
  return c.drops.some((d) => d.benefits.some((b) => b.type === 'BADGE' || b.type === 'EMOTE'));
}

// Minutes of watching each drop still needs. Every drop advances at once,
// except a drop gated behind another one, which only starts after it.
function dropNeeds(c, t = now()) {
  const memo = new Map();
  const need = (d, depth) => {
    if (memo.has(d.id)) return memo.get(d.id);
    if (d.claimed || d.required <= 0 || ts(d.endAt) <= t || depth > 8) return 0;
    let before = 0;
    for (const pid of d.preconditions) {
      const p = c.drops.find((x) => x.id === pid);
      if (p) before = Math.max(before, need(p, depth + 1));
    }
    const v = before + Math.max(0, d.required - d.minutes);
    memo.set(d.id, v);
    return v;
  };
  for (const d of c.drops) need(d, 0);
  return memo;
}

function needMinutes(c, t = now()) {
  let max = 0;
  for (const v of dropNeeds(c, t).values()) max = Math.max(max, v);
  return max;
}

// Can at least one more reward still finish before its deadline? Drops only
// pay out when complete, so time spent on one that can't finish is wasted.
function achievable(c, t = now()) {
  const needs = dropNeeds(c, t);
  return c.drops.some((d) => {
    const n = needs.get(d.id);
    return n > 0 && t + n * MIN <= Math.min(ts(d.endAt), ts(c.endAt));
  });
}

function fitsChannel(c, ch) {
  if (c.channels) return c.channels.some((x) => x.login === ch.login);
  return !c.game.id || !ch.gameId || ch.gameId === c.game.id;
}

class Engine extends EventEmitter {
  // store: this account's own folder. settings: the shared Settings instance.
  // logger/label: where this account's lines go in the detailed log.
  constructor({ client, store, settings, timing = {}, autopilot = false, logger = NO_LOG, label = 'engine' }) {
    super();
    this.logger = logger;
    this.label = label;
    this.client = client;
    this.store = store;
    this.t = {
      watch: 20000,
      progress: MIN,
      inventory: 5 * MIN,
      streamCheck: 3 * MIN,
      refresh: 20 * MIN,
      noChannel: MIN,
      stall: 12 * MIN,
      points: 5 * MIN,
      minTick: 1000, // shortest gap between two loop runs
      ...timing,
    };
    const saved = store.readJson('state.json', {});
    this.queue = Array.isArray(saved.queue) ? saved.queue : [];
    this.paused = !!saved.paused;
    this.activity = Array.isArray(saved.activity) ? saved.activity : [];
    this.seen = Array.isArray(saved.seen) ? new Set(saved.seen) : null;
    this.autopilot = 'autopilot' in saved ? !!saved.autopilot : autopilot;
    this.reminded = new Set(Array.isArray(saved.reminded) ? saved.reminded : []);
    // Per-day totals for the Stats page: minutes watched and channel points collected.
    this.stats = { minutes: {}, points: {}, ...(saved.stats || {}) };
    this.settings = settings.values;

    this.campaigns = new Map();
    this.claimed = [];
    this.loaded = false;
    this.loading = false;
    this.error = null;
    this.lastRefresh = 0;
    this.lastInventory = 0;
    this.watch = null;
    this.status = { kind: 'idle' };
    this.badChannels = new Map();
    this.noChannelUntil = new Map();
    this.doneLogged = new Set();
    this.hold = null; // 'schedule' | 'gaming' while farming is held from outside
    this.lastTick = 0;
    this.running = false;
    this.busy = false;
    this.kicked = false;
    this.timer = null;
    this.changeTimer = null;
    this.saveTimer = null;
  }

  // ---- lifecycle ----

  start() {
    if (this.running) return;
    this.running = true;
    this.kick(0);
  }

  // For good: an account removed from Lurk. Nothing may write its files afterwards.
  dispose() {
    this.stop();
    this.disposed = true;
    clearTimeout(this.saveTimer);
    clearTimeout(this.changeTimer);
    this.removeAllListeners();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.watch = null;
    this.campaigns = new Map();
    this.claimed = [];
    this.loaded = false;
    this.status = { kind: 'idle' };
    this.changed();
  }

  kick(ms = 50) {
    if (this.busy) {
      this.kicked = true;
      return;
    }
    this.schedule(ms);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (this.running) this.timer = setTimeout(() => this.tick(), ms);
  }

  async tick() {
    if (this.busy || !this.running) return;
    this.busy = true;
    this.kicked = false;
    let delay = this.t.watch;
    try {
      delay = await this.step();
      this.error = null;
    } catch (err) {
      if (err.auth) {
        this.busy = false;
        this.running = false;
        this.emit('auth-lost');
        return;
      }
      this.error = err.message;
      this.logger.error(this.label, err);
      this.log('error', err.message, { quiet: true });
      this.setStatus({ kind: 'error', message: err.message });
      delay = 30000;
    } finally {
      this.busy = false;
    }
    this.changed();
    this.schedule(this.kicked ? 50 : delay);
  }

  // ---- the loop ----

  async step() {
    const t0 = now();
    if (!this.loaded || t0 - this.lastRefresh > this.t.refresh) await this.refresh();

    this.remindEnding();

    if (this.hold && !this.paused) {
      this.watch = null;
      this.lastTick = 0;
      this.setStatus({ kind: 'held', reason: this.hold });
      if (now() - this.lastInventory > this.t.inventory * 2) await this.syncInventory();
      return this.t.watch * 3;
    }

    if (this.paused || (!this.queue.length && !this.autopilot)) {
      this.watch = null;
      this.lastTick = 0;
      this.setStatus({ kind: this.paused ? 'paused' : 'idle' });
      // Still claim anything earned elsewhere (e.g. watching on the website).
      if (now() - this.lastInventory > this.t.inventory * 2) await this.syncInventory();
      return this.t.watch * 3;
    }

    const c = this.pickTarget();
    if (!c) {
      this.watch = null;
      this.setStatus(this.waitingStatus());
      if (now() - this.lastInventory > this.t.inventory * 2) await this.syncInventory();
      return this.t.noChannel;
    }

    let w = this.watch;
    if (!w || w.campaignId !== c.id || !w.channel) {
      if (w && w.channel && this.channelFits(w.channel, c)) {
        w.campaignId = c.id;
      } else {
        this.setStatus({ kind: 'searching', campaignId: c.id });
        this.changed();
        const ch = await this.findChannel(c);
        if (!ch) {
          this.noChannelUntil.set(c.id, now() + this.t.noChannel);
          this.log('warn', `No live channels with drops for ${c.game.name} right now`, { gameId: c.game.id, quiet: true });
          return 500;
        }
        w = this.watch = {
          campaignId: c.id,
          channel: ch,
          since: now(),
          lastProgress: now(),
          lastStreamCheck: now(),
          lastGain: now(),
          fails: 0,
          dropId: null,
        };
        const extra = ch.covers > 1 ? ` (counts for ${ch.covers} campaigns)` : '';
        this.log('watch', `Watching ${ch.name} for ${c.game.name}${extra}`, { gameId: c.game.id });
      }
    }

    const ok = await this.client.sendWatch(w.channel);
    if (!ok) {
      w.fails++;
      if (w.fails >= 3) return this.dropChannel('stopped responding');
    } else {
      w.fails = 0;
      // Count real watching time for the Stats page (gaps over a minute don't count).
      if (this.lastTick) this.addStat('minutes', Math.min(now() - this.lastTick, MIN) / MIN);
      this.lastTick = now();
    }
    this.setStatus({ kind: 'watching', campaignId: c.id });

    if (now() - w.lastStreamCheck >= this.t.streamCheck) {
      w.lastStreamCheck = now();
      const [info] = await this.client.streamInfo([w.channel.login]);
      if (!info || !info.online) return this.dropChannel('went offline');
      if (c.game.id && info.gameId && info.gameId !== c.game.id) {
        return this.dropChannel(`switched to ${info.gameName || 'another game'}`);
      }
      w.channel.viewers = info.viewers;
      w.channel.title = info.title;
      if (info.avatar) w.channel.avatar = info.avatar;
    }

    if (now() - w.lastProgress >= this.t.progress) {
      const elapsed = now() - w.lastProgress;
      w.lastProgress = now();
      const cur = await this.client.currentDrop(w.channel.id);
      if (cur) {
        w.dropId = cur.dropId;
        const hit = this.findDrop(cur.dropId);
        if (hit && !hit.drop.claimed) {
          if (cur.minutes > hit.drop.minutes) {
            // Capped so a stale local value can't push the other campaigns too far.
            const gained = Math.min(cur.minutes - hit.drop.minutes, Math.ceil(elapsed / MIN) + 1);
            this.bumpOthers(w.channel, hit, gained);
            hit.drop.minutes = Math.min(cur.minutes, hit.drop.required);
            w.lastGain = now();
          }
          if (hit.drop.minutes >= hit.drop.required) this.lastInventory = 0;
        }
      }
      if (now() - w.lastGain > this.t.stall) return this.dropChannel('is not counting watch time', 30 * MIN);
    }

    if (this.settings.channelPoints && now() - (w.lastPoints || 0) >= this.t.points) {
      w.lastPoints = now();
      await this.collectPoints(w.channel);
    }

    if (now() - this.lastInventory >= this.t.inventory) await this.syncInventory();
    return Math.max(this.t.minTick, this.t.watch - (now() - t0));
  }

  // Twitch hands out a channel points bonus every 15 minutes of watching.
  async collectPoints(channel) {
    try {
      const cp = await this.client.channelPoints(channel.login);
      if (!cp) return;
      channel.points = cp.balance;
      if (!cp.claimId) return;
      const earned = await this.client.claimPoints(cp.channelId, cp.claimId);
      if (earned === null) return;
      channel.points = cp.balance + earned;
      this.addStat('points', earned || 50);
      this.log('points', `Collected channel points on ${channel.name}`, { quiet: true });
    } catch (err) {
      if (err.auth) throw err;
      // Points are a bonus; never let them get in the way of drops.
    }
  }

  addStat(kind, amount) {
    const day = new Date().toISOString().slice(0, 10);
    const bucket = this.stats[kind] || (this.stats[kind] = {});
    bucket[day] = Math.round(((bucket[day] || 0) + amount) * 100) / 100;
    this.save();
  }

  // Joined campaigns ending within 6 hours that still have rewards to earn.
  remindEnding() {
    if (!this.loaded) return;
    const t = now();
    for (const id of this.queue) {
      const c = this.campaigns.get(id);
      if (!c || this.reminded.has(id) || finished(c, t)) continue;
      const left = ts(c.endAt) - t;
      if (left <= 0 || left > 6 * 60 * MIN) continue;
      const open = watchable(c).filter((d) => !d.claimed && ts(d.endAt) > t);
      if (!open.length) continue;
      this.reminded.add(id);
      const need = needMinutes(c, t);
      this.save();
      this.emit('ending-soon', {
        name: c.name,
        game: c.game.name,
        image: c.game.boxArt,
        left,
        rewards: open.reduce((n, d) => n + Math.max(1, d.benefits.length), 0),
        need,
        late: t + need * MIN > ts(c.endAt),
      });
    }
  }

  // Farming held from outside (schedule, fullscreen game). null releases it.
  setHold(reason) {
    if (this.hold === reason) return;
    this.logger.info(this.label, reason ? `hold: ${reason}` : 'hold released');
    this.hold = reason;
    if (reason) this.watch = null;
    this.kick();
  }

  // Can Autopilot farm this campaign right now?
  autoFarmable(c, t = now()) {
    return eligible(c) && watchable(c).length > 0 && phase(c, t) === 'active' && !finished(c, t)
      && !this.settings.skipGames.includes(c.game.id) && c.drops.some((d) => earnable(c, d, t)) && achievable(c, t);
  }

  // Joined campaigns in queue order, then (with Autopilot) the rest: starred
  // games first, then whatever ends soonest.
  targets(t = now()) {
    const list = [];
    for (const id of this.queue) {
      const c = this.campaigns.get(id);
      if (c) list.push({ c, auto: false });
    }
    if (this.autopilot) {
      const fav = new Set(this.settings.favorites);
      const rest = [...this.campaigns.values()]
        .filter((c) => !this.queue.includes(c.id) && this.autoFarmable(c, t))
        .sort((a, b) => fav.has(b.game.id) - fav.has(a.game.id) || ts(a.endAt) - ts(b.endAt));
      for (const c of rest) list.push({ c, auto: true });
    }
    return list;
  }

  pickTarget() {
    const t = now();
    for (const { c } of this.targets(t)) {
      if (finished(c, t)) {
        this.markDone(c);
        this.removeFromQueue(c.id);
        continue;
      }
      if (!eligible(c) || phase(c, t) !== 'active') continue;
      if (!c.drops.some((d) => earnable(c, d, t))) continue;
      if (this.noChannelUntil.get(c.id) > t) continue;
      return c;
    }
    return null;
  }

  markDone(c) {
    if (this.doneLogged.has(c.id) || phase(c) === 'ended') return;
    this.doneLogged.add(c.id);
    this.log('done', `Finished ${c.name}`, { gameId: c.game.id });
    this.emit('finished', { name: c.name, game: c.game.name, image: c.game.boxArt });
  }

  waitingStatus() {
    const t = now();
    for (const { c } of this.targets(t)) {
      if (phase(c, t) === 'upcoming') return { kind: 'waiting', reason: 'upcoming', campaignId: c.id, until: ts(c.startAt) };
      if (!eligible(c)) return { kind: 'waiting', reason: 'link', campaignId: c.id };
      if (this.noChannelUntil.get(c.id) > t) return { kind: 'waiting', reason: 'offline', campaignId: c.id, until: this.noChannelUntil.get(c.id) };
    }
    return { kind: 'waiting', reason: 'none' };
  }

  channelFits(ch, c) {
    if (this.badChannels.get(ch.login) > now()) return false;
    return fitsChannel(c, ch);
  }

  // Smart pick: among live channels that count for the target, take the one
  // that also counts for the most other campaigns, so they progress together.
  async findChannel(c) {
    const t = now();
    let list = [];
    try {
      list = (await this.client.gameStreams(c.game, 60)).filter((ch) => this.channelFits(ch, c));
    } catch (err) {
      if (err.auth || !c.channels) throw err;
    }
    if (!list.length && c.channels) {
      // Channel-locked campaigns: their channels may sit below the directory's top results.
      const infos = await this.client.streamInfo(c.channels.slice(0, 80).map((x) => x.login));
      list = infos.filter((i) => i && i.online && (!c.game.id || !i.gameId || i.gameId === c.game.id) && !(this.badChannels.get(i.login) > t));
    }
    if (!list.length) return null;
    const related = [...this.campaigns.values()].filter((o) => o.id !== c.id && o.game.id === c.game.id
      && eligible(o) && phase(o, t) === 'active' && o.drops.some((d) => earnable(o, d, t)));
    for (const ch of list) ch.covers = 1 + related.filter((o) => fitsChannel(o, ch)).length;
    list.sort((a, b) => b.covers - a.covers || (b.viewers || 0) - (a.viewers || 0));
    return list[0];
  }

  // Twitch advances every unclaimed drop of every campaign the channel counts
  // for, but reports only one. Move the rest by the same amount until the next
  // inventory sync replaces the estimate with the real numbers.
  bumpOthers(channel, hit, gained) {
    const t = now();
    for (const c of this.campaigns.values()) {
      if (c.game.id !== hit.campaign.game.id || !eligible(c) || !this.channelFits(channel, c)) continue;
      for (const d of c.drops) {
        if (d === hit.drop || !earnable(c, d, t)) continue;
        d.minutes = Math.min(d.required, d.minutes + gained);
        if (d.minutes >= d.required) this.lastInventory = 0;
      }
    }
  }

  dropChannel(reason, banFor = 3 * MIN) {
    const w = this.watch;
    if (w && w.channel) {
      this.badChannels.set(w.channel.login, now() + banFor);
      this.log('warn', `${w.channel.name} ${reason}, switching channel`);
    }
    this.watch = null;
    return 1500;
  }

  // ---- data ----

  // One refresh at a time: the loop and the Refresh button can both ask.
  refresh() {
    if (!this.refreshing) this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async doRefresh() {
    const started = now();
    this.loading = true;
    this.changed();
    try {
      const list = await this.client.campaigns();
      const prev = this.campaigns;
      this.campaigns = new Map(list.map((c) => [c.id, c]));
      // Keep local progress for drops that Twitch reports without a self block.
      for (const c of list) {
        const old = prev.get(c.id);
        if (!old) continue;
        for (const d of c.drops) {
          const o = old.drops.find((x) => x.id === d.id);
          if (o && !d.hasSelf) Object.assign(d, { minutes: o.minutes, claimed: o.claimed, claimId: o.claimId });
        }
      }
      this.lastRefresh = now();
      await this.syncInventory();
      this.loaded = true;
      const gone = this.queue.filter((id) => !this.campaigns.has(id));
      for (const id of gone) this.removeFromQueue(id);
      this.detectNew(list);
      this.logger.info(this.label, `refreshed ${list.length} campaigns in ${now() - started} ms, queue ${this.queue.length}, autopilot ${this.autopilot}`);
      this.emit('refreshed');
    } finally {
      this.loading = false;
    }
  }

  // Alerts for campaigns that appeared since the last refresh, for starred games.
  detectNew(list) {
    const first = !this.seen;
    if (first) this.seen = new Set();
    const fav = new Set(this.settings.favorites);
    for (const c of list) {
      if (this.seen.has(c.id)) continue;
      this.seen.add(c.id);
      if (first || !fav.has(c.game.id) || phase(c) === 'ended') continue;
      this.log('new', `New drops for ${c.game.name}: ${c.name}`, { gameId: c.game.id, image: c.game.boxArt });
      this.emit('new-campaign', { name: c.name, game: c.game.name, image: c.game.boxArt, upcoming: phase(c) === 'upcoming' });
    }
    this.save();
  }

  async syncInventory() {
    this.lastInventory = now();
    const inv = await this.client.inventory();
    for (const ic of inv.campaigns) {
      const c = this.campaigns.get(ic.id);
      if (!c) {
        this.campaigns.set(ic.id, ic);
        continue;
      }
      for (const idrop of ic.drops) {
        const d = c.drops.find((x) => x.id === idrop.id);
        if (!d || !idrop.hasSelf) continue;
        d.claimed = idrop.claimed;
        d.claimId = idrop.claimId;
        // Inventory is the source of truth; it replaces the per-minute estimates.
        d.minutes = idrop.claimed ? d.required : idrop.minutes;
      }
    }
    // Drops claimed outside Lurk can miss a self block; match them by reward.
    const awarded = new Map(inv.claimed.map((b) => [b.id, ts(b.awardedAt)]));
    for (const c of this.campaigns.values()) {
      for (const d of c.drops) {
        if (d.claimed || d.hasSelf || !d.benefits.length) continue;
        const times = d.benefits.map((b) => awarded.get(b.id));
        if (times.every((x) => x >= ts(d.startAt) && x < ts(d.endAt))) {
          d.claimed = true;
          d.minutes = d.required;
        }
      }
    }
    this.claimed = inv.claimed.sort((a, b) => ts(b.awardedAt) - ts(a.awardedAt));
    this.logger.debug(this.label, `inventory: ${inv.campaigns.length} in progress, ${inv.claimed.length} rewards on the account`);
    if (this.settings.autoClaim) await this.claimReady();
    this.changed();
  }

  async claimReady() {
    for (const c of this.campaigns.values()) {
      for (const d of c.drops) {
        if (d.claimId && !d.claimed && d.minutes >= d.required) await this.claimDrop(c, d);
      }
    }
  }

  async claimDrop(c, d) {
    let ok = false;
    try {
      ok = await this.client.claim(d.claimId);
    } catch (err) {
      if (err.auth) throw err;
    }
    if (!ok) {
      this.log('warn', `Could not claim ${dropLabel(d)} yet, will retry`);
      return false;
    }
    d.claimed = true;
    d.minutes = d.required;
    const image = d.benefits[0] ? d.benefits[0].image : null;
    const awardedAt = new Date().toISOString();
    for (const b of d.benefits.length ? d.benefits : [{ id: d.id, name: d.name, image: null }]) {
      this.claimed.unshift({ id: b.id, name: b.name, image: b.image, game: c.game.name, awardedAt, count: 1 });
    }
    this.log('claim', `Claimed ${dropLabel(d)}`, { gameId: c.game.id, image });
    this.emit('claimed', { name: dropLabel(d), game: c.game.name, image });
    if (finished(c)) this.markDone(c);
    this.changed();
    return true;
  }

  async claimById(dropId) {
    const hit = this.findDrop(dropId);
    if (!hit) throw new Error('That reward is no longer listed');
    if (!hit.drop.claimId) {
      await this.syncInventory();
      if (hit.drop.claimed) return true;
      if (!hit.drop.claimId) throw new Error('Twitch has not unlocked this reward yet');
    }
    return this.claimDrop(hit.campaign, hit.drop);
  }

  findDrop(dropId) {
    for (const c of this.campaigns.values()) {
      const d = c.drops.find((x) => x.id === dropId);
      if (d) return { campaign: c, drop: d };
    }
    return null;
  }

  // ---- queue ----

  join(id) {
    const c = this.campaigns.get(id);
    if (!c) throw new Error('Campaign not found');
    if (!watchable(c).length) throw new Error('These rewards come from subscribing, not watch time');
    if (finished(c)) throw new Error('Every reward in this campaign is already claimed');
    if (!eligible(c)) throw new Error(`Link your ${c.game.name} account on Twitch first`);
    if (!this.queue.includes(id)) this.queue.push(id);
    this.noChannelUntil.delete(id);
    this.log('info', `Joined ${c.name}`, { gameId: c.game.id });
    this.save();
    this.kick();
  }

  leave(id) {
    const c = this.campaigns.get(id);
    this.removeFromQueue(id);
    if (this.watch && this.watch.campaignId === id) this.watch = null;
    if (c) this.log('info', `Left ${c.name}`, { gameId: c.game.id });
    this.save();
    this.kick();
  }

  removeFromQueue(id) {
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
    this.save();
  }

  move(id, delta) {
    const i = this.queue.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.queue.length) return;
    this.queue.splice(i, 1);
    this.queue.splice(j, 0, id);
    this.save();
    this.kick();
  }

  clearQueue() {
    this.queue = [];
    this.watch = null;
    if (this.autopilot) this.setAutopilot(false);
    this.log('info', 'Stopped all campaigns');
    this.save();
    this.kick();
  }

  setPaused(p) {
    this.paused = !!p;
    if (p) this.watch = null;
    this.log('info', p ? 'Paused' : 'Resumed');
    this.save();
    this.kick();
  }

  setAutopilot(on) {
    if (this.autopilot === !!on) return;
    this.autopilot = !!on;
    this.log('info', on ? 'Autopilot on' : 'Autopilot off');
    this.save();
    this.kick();
  }

  // A shared setting changed somewhere in the app.
  settingChanged(key, value) {
    if (key === 'autoClaim' && value && this.running) this.claimReady().catch(() => {});
    if (key === 'skipGames' || key === 'favorites') this.kick();
    this.changed();
  }

  // ---- state ----

  log(kind, text, extra = {}) {
    const { quiet, ...rest } = extra;
    this.logger[kind === 'error' ? 'error' : kind === 'warn' ? 'warn' : 'info'](this.label, `${kind}: ${text}`);
    // Collapse repeats of the same quiet message into one line.
    if (quiet && this.activity[0] && this.activity[0].text === text) {
      this.activity[0].t = now();
      this.activity[0].repeat = (this.activity[0].repeat || 1) + 1;
    } else {
      this.activity.unshift({ id: `${now()}-${Math.random().toString(36).slice(2, 7)}`, t: now(), kind, text, ...rest });
      if (this.activity.length > 300) this.activity.length = 300;
    }
    this.save();
    this.changed();
  }

  setStatus(s) {
    this.status = s;
  }

  save() {
    if (this.disposed) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.store.writeJson('state.json', {
        queue: this.queue,
        paused: this.paused,
        autopilot: this.autopilot,
        activity: this.activity.slice(0, 300),
        seen: this.seen ? [...this.seen].slice(-3000) : undefined,
        reminded: [...this.reminded].slice(-200),
        stats: this.trimmedStats(),
      });
    }, 300);
  }

  changed() {
    if (this.changeTimer) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = null;
      this.emit('change');
    }, 80);
  }

  // Rough finish times for the targets. Campaigns of one game farm together,
  // different games one after another.
  plan(t) {
    const out = new Map();
    let cursor = 0;
    const gameStart = new Map();
    const targets = this.paused ? [] : this.targets(t);
    targets.forEach(({ c, auto }, i) => {
      if (!gameStart.has(c.game.id)) gameStart.set(c.game.id, cursor);
      const done = gameStart.get(c.game.id) + needMinutes(c, t);
      cursor = Math.max(cursor, done);
      out.set(c.id, { index: i, auto, eta: t + done * MIN });
    });
    return { byId: out, count: targets.length, eta: targets.length ? t + cursor * MIN : null };
  }

  currentDrop(c) {
    const w = this.watch;
    return (w && c.drops.find((d) => d.id === w.dropId && !d.claimed)) || c.drops.find((d) => earnable(c, d)) || null;
  }

  // One-line status for the account list.
  // Last 90 days only.
  trimmedStats() {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * MIN).toISOString().slice(0, 10);
    const out = {};
    for (const [kind, days] of Object.entries(this.stats)) {
      out[kind] = Object.fromEntries(Object.entries(days).filter(([d]) => d >= cutoff));
    }
    return out;
  }

  // For the Stats page: daily totals plus every reward on the account.
  statsData() {
    return {
      ...this.trimmedStats(),
      claimed: this.claimed.map((b) => ({ name: b.name, game: b.game, image: b.image, awardedAt: b.awardedAt, count: b.count || 1 })),
    };
  }

  summary() {
    const w = this.watch;
    const wc = w && this.campaigns.get(w.campaignId);
    const cur = wc ? this.currentDrop(wc) : null;
    return {
      kind: this.paused ? 'paused' : this.status.kind,
      hold: this.hold,
      reason: this.status.reason || null,
      channel: w && w.channel && this.status.kind === 'watching' ? w.channel.name : null,
      game: wc ? wc.game.name : null,
      current: cur ? { label: dropLabel(cur), image: (cur.benefits.find((b) => b.image) || {}).image || null, minutes: cur.minutes, required: cur.required } : null,
      autopilot: this.autopilot,
      queued: this.queue.length,
    };
  }

  snapshot() {
    const t = now();
    const plan = this.plan(t);
    const campaigns = [...this.campaigns.values()].map((c) => {
      const need = needMinutes(c, t);
      const p = plan.byId.get(c.id);
      const deadline = ts(c.endAt);
      return {
        ...c,
        phase: phase(c, t),
        eligible: eligible(c),
        finished: finished(c, t),
        watchable: watchable(c).length > 0,
        queueIndex: this.queue.indexOf(c.id),
        target: p ? p.index : -1,
        auto: p ? p.auto : false,
        need,
        eta: p ? p.eta : null,
        late: need > 0 && (p ? p.eta : t + need * MIN) > deadline,
        drops: c.drops.map((d) => ({
          ...d,
          label: dropLabel(d),
          image: (d.benefits.find((b) => b.image) || {}).image || null,
          locked: !preconditionsMet(c, d),
          earnable: earnable(c, d, t),
        })),
      };
    });
    const w = this.watch;
    const wc = w && this.campaigns.get(w.campaignId);
    const cur = wc ? this.currentDrop(wc) : null;
    return {
      loaded: this.loaded,
      loading: this.loading,
      error: this.error,
      lastRefresh: this.lastRefresh,
      campaigns,
      claimed: this.claimed.slice(0, 400),
      queue: this.queue,
      targets: plan.count,
      queueEta: plan.eta,
      paused: this.paused,
      status: this.status,
      watch: w && w.channel ? {
        campaignId: w.campaignId,
        dropId: w.dropId,
        since: w.since,
        covers: w.channel.covers || 1,
        current: cur ? { id: cur.id, label: dropLabel(cur), image: (cur.benefits.find((b) => b.image) || {}).image || null, minutes: cur.minutes, required: cur.required } : null,
        channel: { login: w.channel.login, name: w.channel.name, avatar: w.channel.avatar, viewers: w.channel.viewers, title: w.channel.title },
      } : null,
      activity: this.activity.slice(0, 200),
      settings: { ...this.settings, autopilot: this.autopilot },
    };
  }
}

module.exports = { Engine, rules: { earnable, phase, finished, eligible, needMinutes, achievable } };
