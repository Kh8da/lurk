import { html, useState, useMemo, useEffect, useRef } from '../vendor/preact-htm.js';
import { Icon, Img, fmtMinutes, fmtDate, fmtEta, timeLeft, fmtViewers, errText, useClock } from './ui.js';

const api = window.lurk;

const FILTERS = [
  ['all', 'All'],
  ['ready', 'Ready'],
  ['starred', 'Starred'],
  ['queue', 'Queue'],
];

function groupGames(campaigns, s) {
  const map = new Map();
  for (const c of campaigns) {
    if (c.phase === 'ended') continue;
    let g = map.get(c.game.id);
    if (!g) map.set(c.game.id, (g = { ...c.game, campaigns: [] }));
    g.campaigns.push(c);
  }
  const watchingId = s.engine.watch && s.engine.watch.campaignId;
  const fav = new Set(s.engine.settings.favorites);
  const rank = (g) => {
    if (g.campaigns.some((c) => c.id === watchingId)) return 0;
    const q = Math.min(...g.campaigns.map((c) => (c.target >= 0 ? c.target : 9999)));
    if (q < 9999) return 1 + q / 10000;
    if (g.campaigns.every((c) => c.finished)) return 6;
    if (g.campaigns.every((c) => c.phase === 'upcoming')) return 5;
    if (!g.campaigns.some((c) => c.eligible)) return fav.has(g.id) ? 3.5 : 4;
    return fav.has(g.id) ? 2 : 3;
  };
  const soonest = (g) => Math.min(...g.campaigns.map((c) => Date.parse(c.endAt)));
  for (const g of map.values()) {
    const q = (c) => (c.id === watchingId ? -1 : c.target >= 0 ? c.target : 9999);
    g.campaigns.sort((a, b) => q(a) - q(b) || (a.finished - b.finished) || (a.phase === 'upcoming') - (b.phase === 'upcoming') || Date.parse(a.endAt) - Date.parse(b.endAt));
    g.rank = rank(g);
  }
  return [...map.values()].sort((a, b) => a.rank - b.rank || soonest(a) - soonest(b) || a.name.localeCompare(b.name));
}

function gameFlag(g, s) {
  const watchingId = s.engine.watch && s.engine.watch.campaignId;
  if (g.campaigns.some((c) => c.id === watchingId)) return html`<span class="flag live" data-tip="Watching"><i class="pulse" /></span>`;
  const lined = g.campaigns.filter((c) => c.target >= 0);
  if (lined.length) {
    const first = lined.reduce((a, b) => (a.target < b.target ? a : b));
    return html`<span class="flag queued ${first.auto ? 'auto' : ''}" data-tip=${first.auto ? 'Lined up by Autopilot' : 'In your queue'}>#${first.target + 1}</span>`;
  }
  if (s.engine.settings.autopilot && s.engine.settings.skipGames.includes(g.id)) return html`<span class="flag muted" data-tip="Skipped by Autopilot"><${Icon} name="ban" size=${14} /></span>`;
  if (g.campaigns.every((c) => c.finished)) return html`<span class="flag done" data-tip="All claimed"><${Icon} name="check" size=${14} /></span>`;
  if (!g.campaigns.some((c) => c.eligible)) return html`<span class="flag muted" data-tip="Account not linked"><${Icon} name="link" size=${14} /></span>`;
  return null;
}

function AutopilotCard({ s }) {
  const on = s.engine.settings.autopilot;
  const n = s.engine.targets;
  const set = (v) => api.setSetting('autopilot', v);
  return html`
    <div class="autopilot ${on ? 'on' : ''}" onClick=${() => set(!on)}>
      <span class="ap-icon"><${Icon} name="bolt" size=${16} /></span>
      <div class="ap-text">
        <div class="ap-title">Autopilot</div>
        <div class="ap-sub">${on ? (n ? `${n} ${n === 1 ? 'campaign' : 'campaigns'} lined up` : 'Nothing to farm right now') : 'Farms all you can earn'}</div>
      </div>
      <button type="button" role="switch" aria-checked=${on ? 'true' : 'false'} class="switch ${on ? 'on' : ''}" onClick=${(e) => { e.stopPropagation(); set(!on); }}><i /></button>
    </div>`;
}

function Rail({ games, selected, onSelect, s, filter, setFilter, query, setQuery }) {
  const [spinning, setSpinning] = useState(false);
  const refresh = async () => {
    setSpinning(true);
    try { await api.refresh(); } catch {}
    setSpinning(false);
  };
  const busy = spinning || s.engine.loading;
  const fav = new Set(s.engine.settings.favorites);
  const empty = query ? 'No games match that search.'
    : filter === 'queue' ? 'Nothing lined up. Hit Join on a campaign or turn on Autopilot.'
    : filter === 'starred' ? 'Star a game to keep it here and get alerts for its new drops.'
    : 'No drop campaigns right now.';
  return html`
    <aside class="rail">
      <div class="rail-head">
        <div class="rail-title">Drops <span class="count">${games.length}</span></div>
        <button class="icon-btn ${busy ? 'spin' : ''}" data-tip="Refresh campaigns" onClick=${refresh} disabled=${busy}><${Icon} name="refresh" size=${16} /></button>
      </div>
      <${AutopilotCard} s=${s} />
      <label class="search">
        <${Icon} name="search" size=${15} />
        <input placeholder="Search games" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} spellcheck="false" />
        ${query && html`<button class="search-clear" onClick=${() => setQuery('')} data-tip="Clear"><${Icon} name="x" size=${13} /></button>`}
      </label>
      <div class="chips">
        ${FILTERS.map(([id, label]) => html`<button class="chip ${filter === id ? 'on' : ''}" onClick=${() => setFilter(id)}>${label}</button>`)}
      </div>
      <div class="rail-list">
        ${!s.engine.loaded && Array.from({ length: 7 }, () => html`<div class="game-row skeleton"><div class="img box" /><div class="meta"><div class="bar w70" /><div class="bar w40" /></div></div>`)}
        ${s.engine.loaded && !games.length && html`<div class="rail-empty">${empty}</div>`}
        ${games.map((g) => html`
          <button key=${g.id} class="game-row ${selected === g.id ? 'active' : ''}" onClick=${() => onSelect(g.id)}>
            <${Img} class="box" src=${g.boxArt} fallback=${g.name} />
            <div class="meta">
              <div class="name">${fav.has(g.id) && html`<${Icon} name="star-fill" size=${12} class="star-mark" />`}${g.name}</div>
              <div class="sub">${g.campaigns.length} ${g.campaigns.length === 1 ? 'campaign' : 'campaigns'}</div>
            </div>
            ${gameFlag(g, s)}
          </button>`)}
      </div>
    </aside>`;
}

// One tile per reward. A drop can hand out several rewards at once; each gets
// its own tile with its own art, all sharing the drop's watch progress.
function rewardsOf(drops) {
  return drops.flatMap((d) => {
    const list = d.benefits.length ? d.benefits : [{ id: d.id, name: d.label, image: d.image }];
    return list.map((b) => ({ key: `${d.id}:${b.id}`, d, b }));
  });
}

const VISIBLE_REWARDS = 12;

function RewardTile({ d, b, c, watchingThis, manualClaim, onToast }) {
  const pct = d.claimed ? 100 : Math.min(100, (d.minutes / Math.max(1, d.required)) * 100);
  const ready = !d.claimed && d.minutes >= d.required && d.required > 0;
  const state = d.claimed ? 'claimed' : ready ? 'ready' : d.locked || c.phase === 'upcoming' ? 'locked' : d.minutes > 0 ? 'earning' : 'idle';
  const [claiming, setClaiming] = useState(false);
  const claim = async () => {
    setClaiming(true);
    try { await api.claim(d.id); } catch (err) { onToast({ kind: 'error', title: 'Claim failed', text: errText(err) }); }
    setClaiming(false);
  };
  let meta;
  if (d.claimed) meta = html`<span class="accent">Claimed</span>`;
  else if (ready) meta = html`<span class="accent">${manualClaim ? 'Ready' : 'Claiming'}</span>`;
  else if (d.minutes > 0) meta = html`<span><b>${d.minutes}</b> / ${d.required} min</span>`;
  else if (!d.required && d.requiredSubs) meta = d.requiredSubs > 1 ? `${d.requiredSubs} subs` : 'Sub reward';
  else meta = fmtMinutes(d.required);
  return html`
    <div class="drop ${state} ${watchingThis && state === 'earning' ? 'hot' : ''}" data-tip=${b.name}>
      <div class="drop-art">
        <${Img} src=${b.image} alt=${b.name} fallback=${b.name} />
        ${d.claimed && html`<span class="drop-badge"><${Icon} name="check" size=${12} /></span>`}
        ${state === 'locked' && html`<span class="drop-badge dim"><${Icon} name="lock" size=${11} /></span>`}
        ${!d.claimed && d.minutes > 0 && html`<div class="drop-bar"><i style=${{ width: `${pct}%` }} /></div>`}
        ${ready && manualClaim && html`<button class="drop-claim" disabled=${claiming} onClick=${claim}>${claiming ? 'Claiming' : 'Claim'}</button>`}
      </div>
      <div class="drop-name">${b.name}</div>
      <div class="drop-meta mono">${meta}</div>
    </div>`;
}

function MoreTile({ next, hidden, total, onClick }) {
  return html`
    <button class="drop more" onClick=${onClick} data-tip="Show every reward">
      <div class="drop-art">
        <${Img} class="more-bg" src=${next.b.image} fallback=${next.b.name} />
        <span class="more-label"><b>View all <${Icon} name="chevron" size=${13} /></b><span class="mono">${total} total</span></span>
      </div>
      <div class="drop-name">${next.b.name}</div>
      <div class="drop-meta mono">+${hidden} more</div>
    </button>`;
}

// Some campaigns allow hundreds of channels; name a few.
function channelsTip(list) {
  const names = list.slice(0, 12).map((x) => x.name).join(', ');
  return list.length > 12 ? `${names} and ${list.length - 12} more` : names;
}

// "done ~18:40", "2 h 10 min to go", or a warning when the deadline wins.
function Deadline({ c }) {
  if (c.finished || !c.watchable || !c.need) return null;
  if (c.late) {
    const text = c.eta ? `won't finish in time (~${fmtEta(c.eta)})` : `needs ${fmtMinutes(c.need)}, not enough time left`;
    return html`<span class="dot" /><span class="warn-text" data-tip="Some rewards can't be earned before it ends. The ones that finish in time still count.">${text}</span>`;
  }
  if (c.eta) return html`<span class="dot" /><span class="eta">done ~${fmtEta(c.eta)}</span>`;
  return html`<span class="dot" /><span>${fmtMinutes(c.need)} to go</span>`;
}

function CampaignCard({ c, s, onToast }) {
  const now = useClock();
  const watch = s.engine.watch;
  const watchingThis = watch && watch.campaignId === c.id && s.engine.status.kind === 'watching';
  const queued = c.queueIndex >= 0;
  const lined = c.target >= 0;
  const status = s.engine.status;
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const left = timeLeft(c, now);
  const rewards = rewardsOf(c.drops);
  const folded = !showAll && rewards.length > VISIBLE_REWARDS;
  const shown = folded ? rewards.slice(0, VISIBLE_REWARDS - 1) : rewards;
  const run = (fn) => async () => {
    setBusy(true);
    try { await fn(); } catch (err) { onToast({ kind: 'error', title: 'Could not do that', text: errText(err) }); }
    setBusy(false);
  };
  const liveAccounts = s.accounts.filter((a) => a.status === 'signed-in').length;
  const joinEverywhere = run(async () => {
    const r = await api.joinAll(c.id);
    const why = r.skipped.map((x) => `${x.account}: ${x.reason}`).join(' · ');
    if (!r.joined.length) throw new Error(why || 'No account could join');
    onToast({
      kind: 'info',
      title: `Joined on ${r.joined.length} ${r.joined.length === 1 ? 'account' : 'accounts'}`,
      text: c.name,
      sub: why || r.joined.join(', '),
    });
  });
  const allButton = liveAccounts > 1 && c.watchable && c.phase !== 'ended'
    ? html`<button class="btn ghost square" disabled=${busy} data-tip=${`Join on all ${liveAccounts} accounts`} onClick=${joinEverywhere}><${Icon} name="users" size=${17} /></button>`
    : null;

  let action;
  if (c.finished) action = html`<span class="done-tag"><${Icon} name="check" size=${14} /> All claimed</span>`;
  else if (!c.watchable) action = html`<span class="done-tag muted" data-tip="These rewards come from subscribing, not watch time">Subs only</span>`;
  else if (queued) action = html`<button class="btn ghost" disabled=${busy} onClick=${run(() => api.leave(c.id))}>Cancel</button>`;
  else if (!c.eligible) action = html`<button class="btn outline" onClick=${() => api.open(c.linkUrl || 'https://www.twitch.tv/drops/campaigns')}><${Icon} name="link" size=${15} /> Link account</button>`;
  else if (c.auto && watchingThis) action = html`<span class="done-tag muted" data-tip="Picked by Autopilot. Use Skip in Autopilot above to leave this game alone."><${Icon} name="bolt" size=${14} /> Autopilot</span>`;
  else if (c.auto) action = html`<button class="btn ghost" disabled=${busy} data-tip="Move it to the front of the line" onClick=${run(() => api.join(c.id))}>Farm first</button>`;
  else action = html`<button class="btn primary" disabled=${busy} onClick=${run(() => api.join(c.id))}>Join</button>`;

  let strip = null;
  if (watchingThis) {
    const cur = c.drops.find((d) => d.id === watch.dropId && !d.claimed) || c.drops.find((d) => d.earnable);
    const eta = cur ? cur.required - cur.minutes : 0;
    strip = html`
      <div class="strip live">
        <i class="pulse" />
        <span>Watching <b>${watch.channel.name}</b></span>
        <span class="strip-dim mono"><${Icon} name="user" size=${13} /> ${fmtViewers(watch.channel.viewers)}</span>
        ${watch.covers > 1 && html`<span class="strip-dim mono" data-tip="This channel counts for several of your campaigns at once">${watch.covers} campaigns at once</span>`}
        <span class="grow" />
        ${cur && html`<span class="mono">${eta > 0 ? `Next reward in ${fmtMinutes(eta)}` : 'Claiming reward'}</span>`}
      </div>`;
  } else if (lined && status.campaignId === c.id && status.kind === 'searching') {
    strip = html`<div class="strip"><i class="spinner" /> <span>Finding the best live channel</span></div>`;
  } else if (lined && status.campaignId === c.id && status.kind === 'waiting' && status.reason === 'offline') {
    strip = html`<div class="strip warn"><${Icon} name="clock" size=${15} /> <span>No live channels have drops for this right now. Lurk keeps checking.</span></div>`;
  } else if (queued && c.phase === 'upcoming') {
    strip = html`<div class="strip"><${Icon} name="clock" size=${15} /> <span>Joined. Lurk starts watching when the campaign opens.</span></div>`;
  } else if (lined) {
    strip = html`<div class="strip"><span class="queue-no mono">#${c.target + 1}</span> <span>${c.auto ? 'Lined up by Autopilot.' : 'In your queue.'} It starts when the ones ahead of it finish.</span></div>`;
  } else if (!c.eligible && !c.finished && c.watchable) {
    strip = html`<div class="strip warn"><${Icon} name="link" size=${15} /> <span>Connect your ${c.game.name} account on Twitch, or these rewards can't be granted.</span><span class="grow" /><button class="link-btn" onClick=${() => api.refresh()}>I linked it</button></div>`;
  }

  return html`
    <article class="camp ${watchingThis ? 'is-live' : ''} ${lined && !watchingThis ? 'is-queued' : ''} ${c.finished ? 'is-done' : ''}">
      <header class="camp-head">
        <div class="camp-title">
          <h3>${c.name}</h3>
          <div class="camp-when mono">
            <span>${fmtDate(c.startAt)} - ${fmtDate(c.endAt)}</span>
            <span class="dot" />
            <span class=${left.soon ? 'warn-text' : ''}>${left.text}</span>
            <${Deadline} c=${c} />
            ${c.channels && html`<span class="dot" /><span data-tip=${channelsTip(c.channels)}>${c.channels.length} ${c.channels.length === 1 ? 'channel' : 'channels'} only</span>`}
          </div>
        </div>
        <div class="camp-action">${action}${allButton}</div>
      </header>
      ${strip}
      <div class="drops">
        ${shown.map((r) => html`<${RewardTile} key=${r.key} d=${r.d} b=${r.b} c=${c} watchingThis=${watchingThis} manualClaim=${!s.engine.settings.autoClaim} onToast=${onToast} />`)}
        ${folded && html`<${MoreTile} next=${rewards[shown.length]} hidden=${rewards.length - shown.length} total=${rewards.length} onClick=${() => setShowAll(true)} />`}
      </div>
      ${showAll && rewards.length > VISIBLE_REWARDS && html`<button class="link-btn show-less" onClick=${() => setShowAll(false)}>Show fewer</button>`}
    </article>`;
}

function GameActions({ game, s }) {
  const starred = s.engine.settings.favorites.includes(game.id);
  const skipped = s.engine.settings.skipGames.includes(game.id);
  return html`
    <div class="hero-actions">
      <button class="pill ${starred ? 'on' : ''}" onClick=${() => api.toggleGame('favorites', game.id, !starred)} data-tip="Starred games come first in Autopilot and alert you when new drops start">
        <${Icon} name=${starred ? 'star-fill' : 'star'} size=${14} /> ${starred ? 'Starred' : 'Star'}
      </button>
      <button class="pill ${skipped ? 'on warn' : ''}" onClick=${() => api.toggleGame('skipGames', game.id, !skipped)} data-tip="Autopilot leaves skipped games alone">
        <${Icon} name="ban" size=${14} /> ${skipped ? 'Skipped by Autopilot' : 'Skip in Autopilot'}
      </button>
    </div>`;
}

function GamePane({ game, s, onToast }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [game && game.id]);
  if (!game) {
    return html`<section class="pane"><div class="pane-empty"><${Icon} name="gift" size=${28} /><p>${s.engine.loaded ? 'Pick a game on the left.' : 'Loading campaigns from Twitch'}</p></div></section>`;
  }
  const drops = game.campaigns.flatMap((c) => c.drops);
  const rewards = rewardsOf(drops);
  const claimed = rewards.filter((r) => r.d.claimed).length;
  const need = Math.max(0, ...game.campaigns.filter((c) => c.eligible && !c.finished).map((c) => c.need));
  return html`
    <section class="pane" ref=${ref}>
      <div class="backdrop" aria-hidden="true">${game.boxArt && html`<img src=${game.boxArt} alt="" />`}</div>
      <div class="hero">
        <${Img} class="hero-box" src=${game.boxArt} fallback=${game.name} />
        <div class="hero-meta">
          <div class="eyebrow mono">Twitch Drops</div>
          <h1 class="game-title ${game.name.length > 22 ? 'long' : ''}">${game.name}</h1>
          <div class="hero-stats">
            <div class="stat"><span class="stat-k mono">Campaigns</span><span class="stat-v">${game.campaigns.length}</span></div>
            <div class="stat"><span class="stat-k mono">Claimed</span><span class="stat-v">${claimed}<span class="of"> / ${rewards.length}</span></span></div>
            <div class="stat"><span class="stat-k mono">Watch time left</span><span class="stat-v">${need ? fmtMinutes(need) : 'None'}</span></div>
          </div>
        </div>
        <${GameActions} game=${game} s=${s} />
      </div>
      <div class="camp-list">
        ${game.campaigns.map((c) => html`<${CampaignCard} key=${c.id} c=${c} s=${s} onToast=${onToast} />`)}
      </div>
    </section>`;
}

export function CampaignsView({ s, onToast, focusGame }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(focusGame || null);
  const all = useMemo(() => groupGames(s.engine.campaigns, s), [s]);
  const fav = new Set(s.engine.settings.favorites);
  const q = query.trim().toLowerCase();
  const games = all.filter((g) => {
    if (q && !g.name.toLowerCase().includes(q) && !g.campaigns.some((c) => c.name.toLowerCase().includes(q))) return false;
    if (filter === 'queue') return g.campaigns.some((c) => c.target >= 0);
    if (filter === 'starred') return fav.has(g.id);
    if (filter === 'ready') return g.campaigns.some((c) => c.eligible && c.watchable && c.phase === 'active' && !c.finished);
    return true;
  });
  const current = all.find((g) => g.id === selected) || games[0] || null;
  return html`
    <div class="campaigns-view">
      <${Rail} games=${games} selected=${current && current.id} onSelect=${setSelected} s=${s} filter=${filter} setFilter=${setFilter} query=${query} setQuery=${setQuery} />
      <${GamePane} game=${current} s=${s} onToast=${onToast} />
    </div>`;
}

export { rewardsOf };
