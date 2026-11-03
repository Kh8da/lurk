import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { Icon, Img, fmtMinutes, fmtClock, fmtDate, fmtSpan, ago, useClock } from './ui.js';

const api = window.lurk;

// Games whose rewards are waiting on a linked game account.
export function lockedGames(s) {
  const fav = new Set(s.engine.settings.favorites);
  const map = new Map();
  for (const c of s.engine.campaigns) {
    if (c.eligible || c.finished || !c.watchable || c.phase === 'ended') continue;
    let g = map.get(c.game.id);
    if (!g) map.set(c.game.id, (g = { ...c.game, campaigns: [], rewards: [], linkUrl: null, ends: Infinity }));
    g.campaigns.push(c);
    g.linkUrl = g.linkUrl || c.linkUrl;
    g.ends = Math.min(g.ends, Date.parse(c.endAt));
    for (const d of c.drops) for (const b of d.benefits) g.rewards.push(b);
  }
  return [...map.values()].sort((a, b) => fav.has(b.id) - fav.has(a.id) || b.rewards.length - a.rewards.length || a.ends - b.ends);
}

export function LinkView({ s }) {
  useClock(60000);
  const games = lockedGames(s);
  const [opened, setOpened] = useState({});
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try { await api.refresh(); } catch {}
    setChecking(false);
  };
  // Coming back from the browser after linking: look again on our own.
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (!Object.keys(opened).length || Date.now() - last < 20000) return;
      last = Date.now();
      recheck();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [opened]);
  const total = games.reduce((n, g) => n + g.rewards.length, 0);
  return html`
    <div class="page">
      <div class="page-head">
        <h2>Link accounts</h2>
        <span class="page-sub mono">${games.length} ${games.length === 1 ? 'game' : 'games'} · ${total} rewards waiting</span>
        <span class="grow" />
        <button class="btn ghost sm" disabled=${checking || s.engine.loading} onClick=${recheck}><${Icon} name="refresh" size=${14} /> ${checking ? 'Checking' : 'Check again'}</button>
      </div>
      <p class="page-lead">Twitch only hands these rewards out once your game account is connected. Link it on the game's site, come back, and Lurk picks it up by itself.</p>
      ${!games.length && html`<div class="empty-line">${s.engine.loaded ? 'Every game with drops right now is linked. Nice.' : 'Loading campaigns'}</div>`}
      <div class="link-list">
        ${games.map((g) => html`
          <div class="link-row" key=${g.id}>
            <${Img} class="link-box" src=${g.boxArt} fallback=${g.name} />
            <div class="link-meta">
              <div class="link-name">${g.name}</div>
              <div class="link-sub mono">${g.rewards.length} ${g.rewards.length === 1 ? 'reward' : 'rewards'} · ${g.campaigns.length} ${g.campaigns.length === 1 ? 'campaign' : 'campaigns'} · ends in ${fmtSpan(g.ends - Date.now())}</div>
            </div>
            <div class="link-rewards">
              ${g.rewards.slice(0, 6).map((b) => html`<${Img} key=${b.id} class="link-reward" src=${b.image} fallback=${b.name} />`)}
              ${g.rewards.length > 6 && html`<span class="link-more mono">+${g.rewards.length - 6}</span>`}
            </div>
            ${opened[g.id]
              ? html`<button class="btn ghost sm" disabled=${checking} onClick=${recheck}>${checking ? 'Checking' : 'I linked it'}</button>`
              : html`<button class="btn outline sm" onClick=${() => { api.open(g.linkUrl || 'https://www.twitch.tv/drops/campaigns'); setOpened({ ...opened, [g.id]: true }); }}><${Icon} name="link" size=${14} /> Link</button>`}
          </div>`)}
      </div>
    </div>`;
}

export function InventoryView({ s }) {
  useClock(60000);
  const inProgress = s.engine.campaigns.filter((c) => !c.finished && c.phase === 'active' && c.drops.some((d) => d.minutes > 0 && !d.claimed));
  const claimed = s.engine.claimed;
  return html`
    <div class="page">
      <div class="page-head">
        <h2>Inventory</h2>
        <span class="page-sub mono">${claimed.length} ${claimed.length === 1 ? 'reward' : 'rewards'} on your account</span>
      </div>

      <h4 class="section-label mono">In progress</h4>
      ${!inProgress.length && html`<div class="empty-line">Nothing in progress. Join a campaign and it shows up here.</div>`}
      <div class="progress-list">
        ${inProgress.map((c) => html`
          <div class="prog-row" key=${c.id}>
            <${Img} class="prog-box" src=${c.game.boxArt} fallback=${c.game.name} />
            <div class="prog-meta">
              <div class="prog-name">${c.name}</div>
              <div class="prog-game">${c.game.name}</div>
            </div>
            <div class="prog-drops">
              ${c.drops.map((d) => {
                const pct = d.claimed ? 100 : Math.min(100, (d.minutes / Math.max(1, d.required)) * 100);
                return html`
                  <div class="mini ${d.claimed ? 'claimed' : ''}" data-tip=${`${d.label}: ${d.claimed ? 'claimed' : `${d.minutes} / ${d.required} min`}`}>
                    <${Img} src=${d.image} fallback=${d.label} />
                    <div class="mini-bar"><i style=${{ width: `${pct}%` }} /></div>
                  </div>`;
              })}
            </div>
          </div>`)}
      </div>

      <h4 class="section-label mono">Claimed</h4>
      ${!claimed.length && html`<div class="empty-line">No claimed rewards yet.</div>`}
      <div class="claimed-grid">
        ${claimed.map((b) => html`
          <div class="claimed" key=${b.id + b.awardedAt}>
            <div class="claimed-art"><${Img} src=${b.image} fallback=${b.name} />${b.count > 1 && html`<span class="claimed-count mono">x${b.count}</span>`}</div>
            <div class="claimed-name" data-tip=${b.name}>${b.name}</div>
            <div class="claimed-meta mono">${b.game ? `${b.game} · ` : ''}${ago(b.awardedAt)}</div>
          </div>`)}
      </div>
    </div>`;
}

const KIND_ICON = { claim: 'gift', watch: 'eye', warn: 'clock', error: 'x', done: 'check', info: 'chevron', new: 'star', points: 'plus' };

function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 86400e3);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return fmtDate(t, false);
}

export function ActivityView({ s }) {
  const items = s.engine.activity;
  const groups = [];
  for (const a of items) {
    const label = dayLabel(a.t);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(a);
  }
  return html`
    <div class="page">
      <div class="page-head">
        <h2>Activity</h2>
        <span class="page-sub mono">What Lurk did and when</span>
      </div>
      ${!items.length && html`<div class="empty-line">Quiet so far. Join a campaign to get things moving.</div>`}
      ${groups.map((g) => html`
        <div class="act-group" key=${g.label}>
          <h4 class="section-label mono">${g.label}</h4>
          <ol class="act-list">
            ${g.items.map((a) => html`
              <li class="act ${a.kind}" key=${a.id}>
                <span class="act-time mono">${fmtClock(a.t)}</span>
                <span class="act-icon"><${Icon} name=${KIND_ICON[a.kind] || 'chevron'} size=${14} /></span>
                ${a.image && html`<${Img} class="act-img" src=${a.image} />`}
                <span class="act-text">${a.text}${a.repeat > 1 && html`<span class="act-repeat mono">x${a.repeat}</span>`}</span>
              </li>`)}
          </ol>
        </div>`)}
    </div>`;
}

// ---- stats ----

const DAY_MS = 86400e3;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * DAY_MS));
  return out;
}

const sumDays = (map, days) => days.reduce((n, d) => n + ((map && map[d]) || 0), 0);
const fmtHours = (min) => (min >= 600 ? `${Math.round(min / 60)} h` : `${(min / 60).toFixed(1)} h`);

function rewardsSince(claimed, since) {
  return claimed.filter((b) => Date.parse(b.awardedAt) >= since).reduce((n, b) => n + 1, 0);
}

export function StatsView({ s }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.stats().then((d) => alive && setData(d)).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [s.accounts.length]);
  if (!data) return html`<div class="page"><div class="empty-line">Loading stats</div></div>`;

  const days = lastDays(14);
  const week = Date.now() - 7 * DAY_MS;
  const month = Date.now() - 30 * DAY_MS;
  const accounts = data.map((a) => ({
    id: a.id,
    name: a.name,
    avatar: a.avatar,
    claimed: a.claimed,
    daily: a.minutes || {},
    week: rewardsSince(a.claimed, week),
    month: rewardsSince(a.claimed, month),
    minutes: sumDays(a.minutes, days),
    points: sumDays(a.points, days),
  }));
  const total = (key) => accounts.reduce((n, a) => n + a[key], 0);
  const perDay = days.map((d) => {
    const split = accounts.map((a) => ({ name: a.name, minutes: a.daily[d] || 0 }));
    return { day: d, minutes: split.reduce((n, x) => n + x.minutes, 0), split };
  });
  const peak = Math.max(60, ...perDay.map((p) => p.minutes));
  const games = new Map();
  for (const a of accounts) for (const b of a.claimed) if (b.game) games.set(b.game, (games.get(b.game) || 0) + (b.count || 1));
  const topGames = [...games.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
  const several = accounts.length > 1;

  return html`
    <div class="page stats">
      <div class="page-head">
        <h2>Stats</h2>
        <span class="page-sub mono">${several ? `${accounts.length} accounts · ` : ''}last 14 days unless noted</span>
      </div>

      <div class="tiles">
        <div class="tile"><span class="tile-k mono">Rewards this week</span><span class="tile-v">${total('week')}</span></div>
        <div class="tile"><span class="tile-k mono">Rewards, 30 days</span><span class="tile-v">${total('month')}</span></div>
        <div class="tile"><span class="tile-k mono">Hours farmed</span><span class="tile-v">${fmtHours(total('minutes'))}</span></div>
        <div class="tile"><span class="tile-k mono">Channel points</span><span class="tile-v">${total('points').toLocaleString('en-US')}</span></div>
      </div>

      <h4 class="section-label mono">Hours farmed per day</h4>
      <div class="chart">
        <div class="chart-grid">
          ${[1, 0.5].map((f) => html`<div class="grid-line" style=${{ bottom: `${f * 100}%` }}><span class="mono">${fmtHours(peak * f)}</span></div>`)}
        </div>
        <div class="chart-bars">
          ${perDay.map((p) => html`
            <div class="col" key=${p.day} data-tip=${`${fmtDate(p.day + 'T12:00:00', false)}: ${fmtHours(p.minutes)}${several ? `\n${p.split.map((x) => `${x.name} ${fmtHours(x.minutes)}`).join('\n')}` : ''}`}>
              <i class="col-bar" style=${{ height: `${(p.minutes / peak) * 100}%` }} />
            </div>`)}
        </div>
        <div class="chart-x mono">
          ${perDay.map((p, i) => html`<span key=${p.day}>${i % 2 === 0 ? fmtDate(p.day + 'T12:00:00', false).slice(4) : ''}</span>`)}
        </div>
      </div>

      ${several && html`
        <h4 class="section-label mono">By account</h4>
        <table class="stat-table">
          <thead><tr><th>Account</th><th class="num">This week</th><th class="num">30 days</th><th class="num">Hours</th><th class="num">Points</th></tr></thead>
          <tbody>
            ${accounts.map((a) => html`
              <tr key=${a.id}>
                <td><span class="stat-acct"><${Img} class="avatar" src=${a.avatar} fallback=${a.name} />${a.name}</span></td>
                <td class="num mono">${a.week}</td>
                <td class="num mono">${a.month}</td>
                <td class="num mono">${fmtHours(a.minutes)}</td>
                <td class="num mono">${a.points.toLocaleString('en-US')}</td>
              </tr>`)}
          </tbody>
        </table>`}

      ${topGames.length > 0 && html`
        <h4 class="section-label mono">Top games by rewards</h4>
        <div class="top-games">
          ${topGames.map(([name, n]) => html`
            <div class="top-game" key=${name}>
              <span class="top-name">${name}</span>
              <span class="top-bar"><i style=${{ width: `${(n / topGames[0][1]) * 100}%` }} /></span>
              <span class="top-n mono">${n}</span>
            </div>`)}
        </div>`}
    </div>`;
}
