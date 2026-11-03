import { html, render, useState, useEffect, useRef, useCallback } from '../vendor/preact-htm.js';
import { Icon, Mark, Img, Toggle, fmtMinutes, fmtSpan, fmtEta, fmtViewers, errText, useClock, installTooltips, installErrorReporting, ago } from './ui.js';
import { CampaignsView } from './campaigns.js';
import { InventoryView, ActivityView, LinkView, StatsView, lockedGames } from './pages.js';
import { AdminView } from './admin.js';

const api = window.lurk;

const TABS = [
  ['campaigns', 'Campaigns'],
  ['link', 'Link accounts'],
  ['inventory', 'Inventory'],
  ['stats', 'Stats'],
  ['activity', 'Activity'],
];

const ACCENTS = [
  ['lime', 'Lime'],
  ['violet', 'Violet'],
  ['ice', 'Ice'],
  ['ember', 'Ember'],
];

function WindowControls({ maximized }) {
  return html`
    <div class="winctl">
      <button data-tip="Minimize" onClick=${() => api.win('min')}><${Icon} name="minus" size=${16} /></button>
      <button data-tip=${maximized ? 'Restore' : 'Maximize'} onClick=${() => api.win('max')}><${Icon} name=${maximized ? 'restore' : 'max'} size=${15} /></button>
      <button class="close" data-tip="Close" onClick=${() => api.win('close')}><${Icon} name="x" size=${16} /></button>
    </div>`;
}

// "Watching Sypeh · 40/240 min", "Signed out", "Autopilot, nothing to farm"...
function accountLine(a) {
  if (a.status === 'signed-out') return 'Signed out';
  if (a.status === 'offline') return 'Offline, retrying';
  if (a.status !== 'signed-in' || !a.farm) return 'Checking';
  const f = a.farm;
  if (f.kind === 'watching' && f.channel) return `Watching ${f.channel}${f.current ? ` · ${f.current.minutes}/${f.current.required} min` : ''}`;
  if (f.kind === 'held') return f.hold === 'gaming' ? 'On hold while you play' : 'On hold, outside farming hours';
  if (f.kind === 'searching') return `Finding a channel${f.game ? ` for ${f.game}` : ''}`;
  if (f.kind === 'paused') return 'Paused';
  if (f.kind === 'error') return 'Problem, retrying';
  if (f.kind === 'waiting') return f.reason === 'offline' ? 'No live channels, retrying' : f.autopilot ? 'Autopilot, nothing to farm' : 'Waiting';
  return f.autopilot ? 'Autopilot, nothing to farm' : f.queued ? 'Starting' : 'Idle';
}

function accountDot(a) {
  if (a.status === 'signed-out') return 'warn';
  return a.farm && a.farm.kind === 'watching' ? 'live' : '';
}

function AccountMenu({ s, onClose, onToast }) {
  const adding = s.pending && s.pending.kind === 'add';
  const pick = (id) => {
    api.accounts.switch(id).catch(() => {});
    onClose();
  };
  return html`
    <div class="menu-scrim" onClick=${onClose} />
    <div class="acct-menu">
      <div class="acct-head mono">Accounts</div>
      ${s.accounts.map((a) => html`
        <button class="acct-row ${a.id === s.activeId ? 'on' : ''}" key=${a.id} onClick=${() => pick(a.id)}>
          <span class="acct-av"><${Img} class="avatar lg" src=${a.avatar} fallback=${a.displayName} /><i class="acct-dot ${accountDot(a)}" /></span>
          <span class="acct-meta">
            <span class="acct-name">${a.displayName}</span>
            <span class="acct-sub ${a.status === 'signed-out' ? 'warn-text' : ''}">${accountLine(a)}</span>
          </span>
          ${a.id === s.activeId && html`<${Icon} name="check" size=${16} class="acct-check" />`}
        </button>`)}
      ${adding
        ? html`
          <div class="acct-pending">
            <i class="spinner" />
            <span>Finish signing in in the Twitch window</span>
            <button class="link-btn" onClick=${() => api.cancelSignIn()}>Cancel</button>
          </div>`
        : html`
          <button class="acct-add" onClick=${() => api.accounts.add().catch((err) => onToast({ kind: 'error', title: 'Could not add account', text: errText(err) }))}>
            <span class="acct-plus"><${Icon} name="plus" size=${16} /></span> Add Twitch account
          </button>`}
      ${s.addError && html`<div class="login-error">${s.addError}</div>`}
    </div>`;
}

function TitleBar({ s, tab, setTab, openSettings, menu, setMenu, onToast }) {
  const signedIn = s.auth.status === 'signed-in';
  const user = s.auth.user;
  const watching = s.engine.status.kind === 'watching';
  const locked = signedIn && s.engine.loaded ? lockedGames(s).length : 0;
  const others = s.accounts.filter((a) => a.id !== s.activeId);
  return html`
    <header class="titlebar">
      <div class="brand">
        <${Mark} size=${20} />
        <span class="wordmark">LURK</span>
        ${s.app.demo && html`<span class="demo-tag mono">Demo</span>`}
      </div>
      ${signedIn && html`
        <nav class="tabs">
          ${(s.reports && s.reports.admin ? [...TABS, ['admin', 'Admin']] : TABS).map(([id, label]) => html`
            <button class="tab ${tab === id ? 'on' : ''}" onClick=${() => setTab(id)}>
              ${label}${id === 'campaigns' && watching && html`<i class="tab-live" />`}${id === 'link' && locked > 0 && html`<span class="tab-count mono">${locked}</span>`}
            </button>`)}
        </nav>`}
      <div class="drag grow" />
      ${s.update && s.update.status === 'ready' && html`<button class="update-pill" onClick=${() => api.update.install()} data-tip="Restarts Lurk to install it"><${Icon} name="refresh" size=${13} /> Update ${s.update.version} ready</button>`}
      ${user && html`
        <button class="account ${menu ? 'open' : ''}" onClick=${() => setMenu(!menu)} data-tip=${menu ? '' : 'Switch or add accounts'}>
          <${Img} class="avatar" src=${user.avatar} fallback=${user.displayName} />
          <span class="account-name">${user.displayName}</span>
          ${others.length > 0 && html`
            <span class="acct-stack">
              ${others.slice(0, 3).map((o) => html`<span class="mini-av ${accountDot(o)}" key=${o.id}><${Img} src=${o.avatar} fallback=${o.displayName} /></span>`)}
              ${others.length > 3 && html`<span class="mini-more mono">+${others.length - 3}</span>`}
            </span>`}
          <${Icon} name="down" size=${14} />
        </button>
        <button class="icon-btn tb-settings" onClick=${openSettings} data-tip="Settings"><${Icon} name="sliders" size=${16} /></button>`}
      <${WindowControls} maximized=${s.app.maximized} />
      ${menu && user && html`<${AccountMenu} s=${s} onClose=${() => setMenu(false)} onToast=${onToast} />`}
    </header>`;
}

// ---- login ----

function Login({ auth, s, onToast }) {
  // An account that exists but needs signing in again, vs. a first sign-in.
  const known = auth.user;
  const start = () => (known ? api.accounts.reauth(known.id) : api.signIn())
    .catch((err) => onToast({ kind: 'error', title: 'Sign-in failed', text: errText(err) }));
  const others = s.accounts.filter((a) => known && a.id !== known.id && a.status === 'signed-in').length;

  let card;
  if (auth.status === 'checking') {
    card = html`<div class="login-card center"><i class="spinner big" /><p class="muted">Checking your session</p></div>`;
  } else if (auth.status === 'offline') {
    card = html`
      <div class="login-card">
        <h2>Can't reach Twitch</h2>
        <p class="muted">${auth.error || 'Check your connection or VPN.'} Lurk retries on its own every 30 seconds.</p>
      </div>`;
  } else if (auth.status === 'pending') {
    card = html`
      <div class="login-card">
        <div class="eyebrow mono">Almost there</div>
        <h2>Finish in the Twitch window</h2>
        <p class="muted">Sign in on Twitch's page. The window closes by itself once you're in.</p>
        <button class="btn ghost wide" onClick=${start}>Show the Twitch window</button>
        <div class="login-wait">
          <i class="spinner" />
          <span>Waiting for Twitch</span>
        </div>
        <button class="link-btn" onClick=${() => api.cancelSignIn()}>Cancel</button>
      </div>`;
  } else if (known) {
    card = html`
      <div class="login-card">
        <div class="eyebrow mono warn-text">Signed out</div>
        <h2>${known.displayName} needs to sign in again</h2>
        <p class="muted">Twitch ended this account's session, so it stopped farming.${others ? ` Your other ${others === 1 ? 'account keeps' : `${others} accounts keep`} going.` : ''}</p>
        ${auth.error && html`<div class="login-error">${auth.error}</div>`}
        <button class="btn twitch wide" onClick=${start}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.3 3L3 6.4v13.1h4.5V22h2.6l2.5-2.5h3.6L21 14.7V3H4.3zm15.1 10.9l-2.8 2.8h-4.5l-2.5 2.5v-2.5H5.9V4.6h13.5v9.3zM16.6 8v4.8H15V8h1.6zm-4.5 0v4.8h-1.6V8h1.6z"/></svg>
          Sign in as ${known.displayName}
        </button>
        <button class="link-btn" onClick=${() => api.accounts.remove(known.id)}>Remove this account instead</button>
      </div>`;
  } else {
    card = html`
      <div class="login-card">
        <div class="eyebrow mono">Get started</div>
        <h2>Sign in with Twitch</h2>
        <p class="muted">You sign in on Twitch's own login page. Lurk only keeps the session it hands back, never your password.</p>
        ${auth.error && html`<div class="login-error">${auth.error}</div>`}
        <button class="btn twitch wide" onClick=${start}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.3 3L3 6.4v13.1h4.5V22h2.6l2.5-2.5h3.6L21 14.7V3H4.3zm15.1 10.9l-2.8 2.8h-4.5l-2.5 2.5v-2.5H5.9V4.6h13.5v9.3zM16.6 8v4.8H15V8h1.6zm-4.5 0v4.8h-1.6V8h1.6z"/></svg>
          Continue with Twitch
        </button>
      </div>`;
  }

  return html`
    <div class="login">
      <div class="login-left">
        <div class="login-mark"><${Mark} size=${64} /></div>
        <h1 class="login-word">LURK</h1>
        <p class="login-tag">Watches Twitch for you and claims the drops.</p>
        <ol class="login-steps">
          <li><span class="mono">01</span>Sign in with Twitch</li>
          <li><span class="mono">02</span>Join the campaigns you want</li>
          <li><span class="mono">03</span>Rewards land on your account</li>
        </ol>
      </div>
      <div class="login-right">${card}</div>
    </div>`;
}

// ---- dock ----

function Dock({ s, goTo }) {
  useClock(20000);
  const e = s.engine;
  const st = e.status;
  const byId = new Map(e.campaigns.map((c) => [c.id, c]));
  const w = e.watch;
  const live = st.kind === 'watching' && w;
  const c = byId.get((live && w.campaignId) || st.campaignId || e.queue[0]);
  const held = st.kind === 'held';
  if (!c && !e.paused && !e.settings.autopilot && !held) return null;
  const cur = live ? w.current : null;
  const pct = cur ? Math.min(100, (cur.minutes / Math.max(1, cur.required)) * 100) : 0;
  const more = e.targets - 1;
  const otherFarming = s.accounts.filter((a) => a.id !== s.activeId && a.farm && a.farm.kind === 'watching');

  let left;
  let middle;
  if (e.paused) {
    left = html`<div class="dock-icon"><${Icon} name="pause" size=${18} /></div><div><div class="dock-k mono">Paused</div><div class="dock-v">Farming is on hold</div></div>`;
    middle = html`<div class="dock-note">Resume to keep earning.</div>`;
  } else if (live) {
    // Twitch refreshes its stream thumbnails every few minutes; bust the cache each minute.
    // Demo channels don't exist on Twitch, so the demo shows the game's poster instead.
    const preview = s.app.demo && c && c.game.boxArt
      ? c.game.boxArt
      : `https://static-cdn.jtvnw.net/previews-ttv/live_user_${w.channel.login}-440x248.jpg?t=${Math.floor(Date.now() / 60000)}`;
    const open = () => api.open(`https://www.twitch.tv/${w.channel.login}`);
    left = html`
      ${e.settings.livePreview
        ? html`
          <button class="dock-preview" onClick=${open}>
            <img src=${preview} alt="" draggable="false" />
            <span class="live-pill mono">Live</span>
            <span class="preview-pop"><img src=${preview} alt="" draggable="false" /><span class="preview-cap">${w.channel.title || w.channel.name}</span></span>
          </button>`
        : html`<div class="dock-avatar"><${Img} class="avatar lg" src=${w.channel.avatar} fallback=${w.channel.name} /><i class="live-dot" /></div>`}
      <div class="dock-chan">
        <div class="dock-k mono"><span class="accent">Watching</span> · ${fmtViewers(w.channel.viewers)} viewers</div>
        <div class="dock-v">${w.channel.name}</div>
      </div>`;
    middle = cur ? html`
      <button class="dock-drop" onClick=${() => goTo(c)}>
        <${Img} class="dock-art" src=${cur.image} fallback=${cur.label} />
        <div class="dock-progress">
          <div class="dock-row"><span class="dock-name">${cur.label}</span><span class="mono dock-min">${cur.minutes} / ${cur.required} min</span></div>
          <div class="bar"><i style=${{ width: `${pct}%` }} /></div>
          <div class="dock-row sub"><span>${c.game.name}</span><span class="mono">${cur.required - cur.minutes > 0 ? `${fmtMinutes(cur.required - cur.minutes)} to go` : 'Claiming'}</span></div>
        </div>
      </button>` : html`<div class="dock-note">Working out which reward Twitch is counting</div>`;
  } else if (held) {
    const sched = st.reason === 'schedule';
    left = html`<div class="dock-icon"><${Icon} name=${sched ? 'clock' : 'pause'} size=${18} /></div><div><div class="dock-k mono">On hold</div><div class="dock-v">${sched ? 'Farming hours' : 'Game running'}</div></div>`;
    middle = html`<div class="dock-note">${sched ? `Lurk farms between ${e.settings.scheduleFrom} and ${e.settings.scheduleTo}. It picks up again on its own.` : 'A fullscreen game is running. Farming resumes when you leave it.'}</div>`;
  } else if (st.kind === 'searching' && c) {
    left = html`<div class="dock-icon"><i class="spinner" /></div><div><div class="dock-k mono">Searching</div><div class="dock-v">${c.game.name}</div></div>`;
    middle = html`<div class="dock-note">Looking for the live channel that counts for the most of your campaigns</div>`;
  } else {
    const why = st.reason === 'upcoming' ? `Starts in ${fmtSpan((st.until || 0) - Date.now())}`
      : st.reason === 'link' ? 'Waiting for you to link your account'
      : st.reason === 'offline' ? 'No live channels with drops right now, checking again soon'
      : st.kind === 'error' ? st.message
      : e.settings.autopilot ? 'Autopilot is on. Nothing you can earn right now, it keeps watching for new drops.'
      : 'Nothing to farm right now';
    left = html`<div class="dock-icon"><${Icon} name=${e.settings.autopilot && !c ? 'bolt' : 'clock'} size=${18} /></div><div><div class="dock-k mono">${st.kind === 'error' ? 'Problem' : 'Waiting'}</div><div class="dock-v">${c ? c.game.name : 'Autopilot'}</div></div>`;
    middle = html`<div class="dock-note">${why}</div>`;
  }

  return html`
    <footer class="dock ${live ? 'is-live' : ''}">
      <div class="dock-left">${left}</div>
      <div class="dock-mid">${middle}</div>
      <div class="dock-right">
        ${e.queueEta && !e.paused && html`<span class="dock-queue mono" data-tip="When everything lined up should be done">all done ~${fmtEta(e.queueEta)}</span>`}
        ${more > 0 && html`<span class="dock-queue mono">+${more} lined up</span>`}
        ${otherFarming.length > 0 && html`<span class="dock-queue mono accent" data-tip=${otherFarming.map((a) => `${a.displayName}: ${accountLine(a)}`).join('\n')}>+${otherFarming.length} ${otherFarming.length === 1 ? 'account' : 'accounts'}</span>`}
        <button class="icon-btn" data-tip=${e.paused ? 'Resume' : 'Pause'} onClick=${() => api.pause(!e.paused)}><${Icon} name=${e.paused ? 'play' : 'pause'} size=${17} /></button>
        <button class="icon-btn" data-tip="Stop everything" onClick=${() => api.clearQueue()}><${Icon} name="stop" size=${15} /></button>
      </div>
    </footer>`;
}

// ---- settings ----

function gameName(s, id) {
  const c = s.engine.campaigns.find((x) => x.game.id === id);
  return c ? c.game.name : 'Unknown game';
}

function TelegramCard({ tg }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      await api.telegram.connect(token);
      setToken('');
    } catch {}
    setBusy(false);
  };
  const test = async () => {
    try { await api.telegram.test(); setTested(true); setTimeout(() => setTested(false), 2000); } catch {}
  };

  if (tg.connected) {
    return html`
      <div class="tg">
        <span class="tg-icon"><${Icon} name="send" size=${16} /></span>
        <div class="tg-meta"><div class="tg-title">Telegram</div><div class="tg-sub mono" data-tip="Send /status, /pause, /resume, /autopilot on, /today or /help to your bot">Sending to @${tg.bot} · send /help for commands</div></div>
        <button class="btn ghost sm" onClick=${test}>${tested ? 'Sent' : 'Test'}</button>
        <button class="link-btn" onClick=${() => api.telegram.disconnect()}>Disconnect</button>
      </div>`;
  }
  if (tg.pending !== null) {
    return html`
      <div class="tg">
        <span class="tg-icon"><i class="spinner" /></span>
        <div class="tg-meta">
          <div class="tg-title">${tg.pending ? html`Now message <b>@${tg.pending}</b>` : 'Checking the token'}</div>
          <div class="tg-sub">${tg.pending ? 'Open your bot in Telegram and send it anything, like "hi".' : 'One moment'}</div>
        </div>
        <button class="link-btn" onClick=${() => api.telegram.cancel()}>Cancel</button>
      </div>`;
  }
  return html`
    <div class="tg form">
      <div class="tg-row">
        <span class="tg-icon"><${Icon} name="send" size=${16} /></span>
        <div class="tg-meta"><div class="tg-title">Telegram</div><div class="tg-sub">Alerts on your phone through your own bot.</div></div>
      </div>
      <ol class="tg-steps">
        <li>In Telegram, message <b>@BotFather</b> and send <span class="mono">/newbot</span>.</li>
        <li>Paste the token it gives you below and hit Connect.</li>
        <li>Send your new bot any message.</li>
      </ol>
      <div class="tg-input">
        <input type="password" placeholder="Bot token" value=${token} onInput=${(e) => setToken(e.currentTarget.value)} spellcheck="false" autocomplete="off" />
        <button class="btn primary sm" disabled=${busy || !token.trim()} onClick=${connect}>Connect</button>
      </div>
      ${tg.error && html`<div class="login-error">${tg.error}</div>`}
    </div>`;
}

const DISCORD_LOGO = 'M19.6 5.3A16.6 16.6 0 0 0 15.5 4l-.5 1a15.4 15.4 0 0 0-6 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C1.8 9.2 1.1 13 1.4 16.7A16.7 16.7 0 0 0 6.5 19.3l1.1-1.7a10.8 10.8 0 0 1-1.7-.8l.4-.3a11.9 11.9 0 0 0 11.4 0l.4.3a10.8 10.8 0 0 1-1.7.8l1.1 1.7a16.7 16.7 0 0 0 5.1-2.6c.4-4.3-.6-8-2.9-11.4zM8.5 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z';

function DiscordCard({ dc }) {
  const [url, setUrl] = useState('');
  const [tested, setTested] = useState(false);
  const logo = html`<span class="tg-icon dc"><svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d=${DISCORD_LOGO} /></svg></span>`;
  const connect = async () => {
    try {
      await api.discord.connect(url);
      setUrl('');
    } catch {}
  };
  const test = async () => {
    try { await api.discord.test(); setTested(true); setTimeout(() => setTested(false), 2000); } catch {}
  };

  if (dc.connected) {
    return html`
      <div class="tg">
        ${logo}
        <div class="tg-meta"><div class="tg-title">Discord</div><div class="tg-sub mono">Posting as ${dc.name}</div></div>
        <button class="btn ghost sm" onClick=${test}>${tested ? 'Sent' : 'Test'}</button>
        <button class="link-btn" onClick=${() => api.discord.disconnect()}>Disconnect</button>
      </div>`;
  }
  return html`
    <div class="tg form">
      <div class="tg-row">
        ${logo}
        <div class="tg-meta"><div class="tg-title">Discord</div><div class="tg-sub">Alerts in a channel of your server.</div></div>
      </div>
      <ol class="tg-steps">
        <li>In Discord, open the channel's settings, then <b>Integrations</b>, then <b>Webhooks</b>.</li>
        <li>Create a webhook, hit <b>Copy Webhook URL</b> and paste it below.</li>
      </ol>
      <div class="tg-input">
        <input type="password" placeholder="Webhook URL" value=${url} onInput=${(e) => setUrl(e.currentTarget.value)} spellcheck="false" autocomplete="off" />
        <button class="btn primary sm" disabled=${dc.pending || !url.trim()} onClick=${connect}>${dc.pending ? 'Checking' : 'Connect'}</button>
      </div>
      ${dc.error && html`<div class="login-error">${dc.error}</div>`}
    </div>`;
}

function AccountList({ s }) {
  const [confirm, setConfirm] = useState(null);
  const adding = s.pending && s.pending.kind === 'add';
  return html`
    <div class="acct-list">
      ${s.accounts.map((a) => html`
        <div class="acct-item" key=${a.id}>
          <span class="acct-av"><${Img} class="avatar lg" src=${a.avatar} fallback=${a.displayName} /><i class="acct-dot ${accountDot(a)}" /></span>
          <div class="who-meta">
            <div class="who-name">${a.displayName}${a.id === s.activeId && html`<span class="acct-tag mono">Showing</span>`}</div>
            <div class="who-sub mono ${a.status === 'signed-out' ? 'warn-text' : ''}">${accountLine(a)}</div>
          </div>
          ${confirm === a.id
            ? html`
              <span class="acct-confirm">
                <button class="btn ghost sm danger" onClick=${() => { setConfirm(null); api.accounts.remove(a.id); }}>Remove</button>
                <button class="link-btn" onClick=${() => setConfirm(null)}>Keep</button>
              </span>`
            : html`
              ${a.status === 'signed-out' && html`<button class="btn ghost sm" onClick=${() => api.accounts.reauth(a.id)}>Sign in</button>`}
              <button class="icon-btn" data-tip="Remove this account from Lurk" onClick=${() => setConfirm(a.id)}><${Icon} name="out" size=${15} /></button>`}
        </div>`)}
      ${adding
        ? html`<div class="acct-pending"><i class="spinner" /><span>Finish signing in in the Twitch window</span><button class="link-btn" onClick=${() => api.cancelSignIn()}>Cancel</button></div>`
        : html`<button class="acct-add boxed" onClick=${() => api.accounts.add()}><span class="acct-plus"><${Icon} name="plus" size=${16} /></span> Add Twitch account</button>`}
      ${s.addError && html`<div class="login-error">${s.addError}</div>`}
      ${s.accounts.length > 1 && html`<div class="toggle-hint acct-note">Every signed-in account farms at the same time. Starred and skipped games, alerts and display settings are shared.</div>`}
    </div>`;
}

function LibraryRow({ st, set }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const scan = async () => {
    setBusy(true);
    try { setResult(await api.scanLibrary()); } catch (err) { setResult({ error: errText(err) }); }
    setBusy(false);
  };
  let note = null;
  if (result && result.error) note = result.error;
  else if (result) {
    note = `Found ${result.owned} installed ${result.owned === 1 ? 'game' : 'games'}. `
      + (result.matched.length ? `${result.matched.length} ${result.matched.length === 1 ? 'has' : 'have'} drops right now: ${result.matched.join(', ')}.` : 'None of them have drops right now.')
      + (result.starred ? ` Starred ${result.starred}.` : '');
  }
  return html`
    <${Toggle} on=${st.autoStarOwned} onChange=${set('autoStarOwned')} label="Star games I own" hint="Reads your Steam and Epic libraries and stars those games, including ones that get drops later." />
    <div class="row-actions">
      <button class="btn ghost sm" disabled=${busy} onClick=${scan}><${Icon} name="search" size=${13} /> ${busy ? 'Scanning' : 'Scan now'}</button>
    </div>
    ${note && html`<div class="row-note">${note}</div>`}`;
}

const UPDATE_TEXT = {
  dev: 'Updates are off while running from source.',
  idle: 'Not checked yet.',
  checking: 'Checking for updates',
  current: 'You have the latest version.',
  error: 'Could not check for updates.',
};

function UpdateRow({ s }) {
  const u = s.update || { status: 'idle' };
  const text = u.status === 'downloading' ? `Downloading ${u.version || 'update'} (${u.progress || 0}%)`
    : u.status === 'ready' ? `Version ${u.version} is ready.`
    : UPDATE_TEXT[u.status] || '';
  return html`
    <div class="row-actions">
      <span class="row-note grow" data-tip=${u.error || ''}>${text}</span>
      ${u.status === 'ready'
        ? html`<button class="btn primary sm" onClick=${() => api.update.install()}>Restart to update</button>`
        : html`<button class="btn ghost sm" disabled=${u.status === 'dev' || u.status === 'checking' || u.status === 'downloading'} onClick=${() => api.update.check()}>Check now</button>`}
    </div>`;
}

function YourReports({ reports }) {
  const list = (reports && reports.inbox) || [];
  if (!list.length) return null;
  return html`
    <div class="subhead mono">Your reports</div>
    <div class="my-reports">
      ${list.map((r) => html`
        <div class="my-report" key=${r.id}>
          <div class="my-top"><span class="my-text">${r.description}</span><span class="status-tag ${r.status}">${r.status === 'new' ? 'Sent' : r.status === 'fixed' ? 'Fixed' : r.status === 'ignored' ? 'Closed' : 'Seen'}</span></div>
          <div class="my-meta mono">${ago(r.created_at)}</div>
          ${r.reply && html`<div class="my-reply"><b>Lurk:</b> ${r.reply}</div>`}
        </div>`)}
    </div>`;
}

function AdminUnlock({ s }) {
  const [clicks, setClicks] = useState(0);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const admin = s.reports && s.reports.admin;
  const unlock = async () => {
    setError('');
    try {
      await api.admin.unlock(key);
      setKey('');
      setClicks(0);
    } catch (err) {
      setError(errText(err));
    }
  };
  return html`
    <div class="sheet-foot mono" onClick=${() => setClicks((n) => n + 1)}>Lurk ${s.app.version}${s.app.demo ? ' · demo data' : ''}${admin ? ' · admin' : ''}</div>
    ${admin && html`<button class="link-btn" onClick=${() => api.admin.lock()}>Turn off admin on this copy</button>`}
    ${!admin && clicks >= 5 && html`
      <div class="tg-input admin-key">
        <input type="password" placeholder="Admin key" value=${key} onInput=${(e) => setKey(e.currentTarget.value)} autocomplete="off" spellcheck="false" />
        <button class="btn primary sm" disabled=${!key.trim()} onClick=${unlock}>Unlock</button>
      </div>
      ${error && html`<div class="login-error">${error}</div>`}`}`;
}

function ReportDialog({ s, onClose, onToast }) {
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [names, setNames] = useState(false);
  const [logs, setLogs] = useState(true);
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [state, setState] = useState('form');
  const [error, setError] = useState('');
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && state !== 'sending' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);
  useEffect(() => {
    if (showPreview) api.report.preview({ includeNames: names, includeLogs: logs }).then(setPreview).catch(() => {});
  }, [showPreview, names, logs]);
  const send = async () => {
    setState('sending');
    setError('');
    try {
      await api.report.send({ description: text, contact, includeNames: names, includeLogs: logs });
      setState('done');
    } catch (err) {
      setError(errText(err));
      setState('form');
    }
  };
  return html`
    <div class="modal-wrap" onClick=${(e) => e.target === e.currentTarget && state !== 'sending' && onClose()}>
      <div class="modal">
        ${state === 'done'
          ? html`
            <div class="modal-done">
              <span class="done-check"><${Icon} name="check" size=${22} /></span>
              <h2>Thanks, it's in</h2>
              <p class="muted">If there's a reply it shows up as a notification and in Settings, under Help and privacy.</p>
              <button class="btn primary" onClick=${onClose}>Done</button>
            </div>`
          : html`
            <div class="sheet-head"><h2>Report a problem</h2><button class="icon-btn" onClick=${onClose} data-tip="Close"><${Icon} name="x" size=${16} /></button></div>
            <textarea class="field" rows="5" maxlength="5000" placeholder="What happened, and what did you expect? Steps to make it happen again help a lot." value=${text} onInput=${(e) => setText(e.currentTarget.value)} />
            <input class="field" placeholder="How to reach you (Discord or Telegram name), optional" maxlength="200" value=${contact} onInput=${(e) => setContact(e.currentTarget.value)} />
            <${Toggle} on=${logs} onChange=${setLogs} label="Attach the log" hint="The last two days of Lurk's log. Tokens and passwords are never in it." />
            <${Toggle} on=${names} onChange=${setNames} label="Include my Twitch names" hint=${names ? 'They show in the report and the log.' : 'Off: they are swapped for account-1, account-2 everywhere.'} />
            <button class="link-btn" onClick=${() => setShowPreview(!showPreview)}>${showPreview ? 'Hide' : 'See'} exactly what gets sent</button>
            ${showPreview && preview && html`
              <pre class="err-view preview">${JSON.stringify({ accounts: preview.accounts, app: preview.summary }, null, 2)}${preview.logBytes ? `\n\nLog: ${Math.round(preview.logBytes / 1024)} KB, ending with:\n${preview.logTail}` : '\n\nNo log attached.'}</pre>`}
            ${error && html`<div class="login-error">${error}</div>`}
            <div class="row-actions">
              <span class="grow" />
              <button class="btn ghost sm" onClick=${onClose} disabled=${state === 'sending'}>Cancel</button>
              <button class="btn primary sm" disabled=${state === 'sending' || !text.trim()} onClick=${send}>${state === 'sending' ? 'Sending' : 'Send report'}</button>
            </div>`}
      </div>
    </div>`;
}

function NoticeBanner({ notice }) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem('lurk-notice-hidden') || ''; } catch { return ''; }
  });
  if (!notice || hidden === notice.id) return null;
  const hide = () => {
    setHidden(notice.id);
    try { localStorage.setItem('lurk-notice-hidden', notice.id); } catch {}
  };
  return html`
    <div class="notice ${notice.level}">
      <${Icon} name=${notice.level === 'warn' ? 'clock' : 'bolt'} size=${15} />
      <span>${notice.text}</span>
      <span class="grow" />
      <button class="icon-btn" onClick=${hide} data-tip="Hide"><${Icon} name="x" size=${14} /></button>
    </div>`;
}

function Settings({ s, onClose, openReport }) {
  const set = (k) => (v) => api.setSetting(k, v);
  const st = s.engine.settings;
  const user = s.auth.user;
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="sheet-wrap" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <aside class="sheet">
        <div class="sheet-head">
          <h2>Settings</h2>
          <button class="icon-btn" onClick=${onClose} data-tip="Close"><${Icon} name="x" size=${16} /></button>
        </div>

        <h4 class="section-label mono first">Accounts</h4>
        <${AccountList} s=${s} />

        <h4 class="section-label mono">Farming</h4>
        ${s.auth.status === 'signed-in' && html`<${Toggle} on=${st.autopilot} onChange=${set('autopilot')} label=${s.accounts.length > 1 ? `Autopilot for ${user.displayName}` : 'Autopilot'} hint="Farms every campaign you can earn. Starred games first, then whatever ends soonest." />`}
        <${Toggle} on=${st.autoClaim} onChange=${set('autoClaim')} label="Claim rewards automatically" hint="Also claims drops you earn by watching on your own." />
        <${Toggle} on=${st.channelPoints} onChange=${set('channelPoints')} label="Collect channel point bonuses" hint="Picks up the bonus Twitch gives every 15 minutes on the channel being watched." />
        ${st.skipGames.length > 0 && html`
          <div class="skip-list">
            <span class="toggle-hint">Autopilot skips:</span>
            ${st.skipGames.map((id) => html`<button class="pill on warn" key=${id} data-tip="Stop skipping" onClick=${() => api.toggleGame('skipGames', id, false)}>${gameName(s, id)} <${Icon} name="x" size=${12} /></button>`)}
          </div>`}

        <h4 class="section-label mono">Alerts</h4>
        <${Toggle} on=${st.alertClaims} onChange=${set('alertClaims')} label="Reward claimed" />
        <${Toggle} on=${st.alertFinished} onChange=${set('alertFinished')} label="Campaign finished" />
        <${Toggle} on=${st.alertEndingSoon} onChange=${set('alertEndingSoon')} label="Joined campaign ending soon" hint="Six hours before the end, if rewards are still left." />
        <${Toggle} on=${st.alertNewCampaigns} onChange=${set('alertNewCampaigns')} label="New drops for starred games" hint="Star a game from its page to follow it." />
        <${Toggle} on=${st.alertSignedOut} onChange=${set('alertSignedOut')} label="Signed out of Twitch" />
        <div class="subhead mono">Send them to</div>
        <${Toggle} on=${st.notify} onChange=${set('notify')} label="Windows notifications" />
        <${TelegramCard} tg=${s.telegram} />
        <${DiscordCard} dc=${s.discord} />

        <h4 class="section-label mono">Schedule</h4>
        <${Toggle} on=${st.scheduleOn} onChange=${set('scheduleOn')} label="Only farm during set hours" hint="Outside them every account holds and picks up again on its own." />
        ${st.scheduleOn && html`
          <div class="time-row">
            <span>From</span>
            <input type="time" value=${st.scheduleFrom} onChange=${(e) => e.currentTarget.value && api.setSetting('scheduleFrom', e.currentTarget.value)} />
            <span>to</span>
            <input type="time" value=${st.scheduleTo} onChange=${(e) => e.currentTarget.value && api.setSetting('scheduleTo', e.currentTarget.value)} />
          </div>`}
        <${Toggle} on=${st.pauseWhileGaming} onChange=${set('pauseWhileGaming')} label="Hold while a fullscreen game runs" hint=${s.hold === 'gaming' ? 'Holding right now.' : 'Resumes when you leave the game.'} />

        <h4 class="section-label mono">Games you own</h4>
        <${LibraryRow} st=${st} set=${set} />

        <h4 class="section-label mono">Display</h4>
        <${Toggle} on=${st.livePreview} onChange=${set('livePreview')} label="Stream preview" hint="A live thumbnail of the stream in the bottom bar. Off shows the channel avatar." />
        <${Toggle} on=${st.taskbarProgress} onChange=${set('taskbarProgress')} label="Progress on the taskbar icon" />
        <${Toggle} on=${st.widget} onChange=${set('widget')} label="Mini widget" hint="A small always-on-top window with every account's progress. Drag it anywhere." />

        <h4 class="section-label mono">App</h4>
        <${Toggle} on=${st.closeToTray} onChange=${set('closeToTray')} label="Keep running in the tray" hint="Closing the window doesn't stop farming." />
        <${Toggle} on=${st.startWithWindows} onChange=${set('startWithWindows')} label="Start with Windows" hint="Opens quietly in the tray." />
        <${Toggle} on=${st.autoUpdate} onChange=${set('autoUpdate')} label="Install updates automatically" hint="New versions download in the background and install when Lurk restarts." />
        <${UpdateRow} s=${s} />

        <h4 class="section-label mono">Help and privacy</h4>
        <div class="row-actions">
          <button class="btn primary sm" onClick=${openReport}><${Icon} name="send" size=${13} /> Report a problem</button>
          <button class="btn ghost sm" onClick=${() => api.openLogs()}>Open log folder</button>
        </div>
        <${Toggle} on=${st.crashReports} onChange=${set('crashReports')} label="Send crash reports" hint="When something breaks, Lurk sends the error and the last log lines, with Twitch names taken out." />
        <${Toggle} on=${st.usageStats} onChange=${set('usageStats')} label="Send anonymous usage stats" hint="Once every few hours: Lurk's version and how many accounts it runs. No names." />
        <${YourReports} reports=${s.reports} />

        <h4 class="section-label mono">Accent</h4>
        <div class="swatches">
          ${ACCENTS.map(([id, label]) => html`
            <button class="swatch ${st.accent === id ? 'on' : ''}" data-swatch=${id} onClick=${() => api.setSetting('accent', id)}>
              <i /><span>${label}</span>
            </button>`)}
        </div>

        <${AdminUnlock} s=${s} />
      </aside>
    </div>`;
}

// ---- toasts ----

function Toasts({ items, dismiss }) {
  return html`
    <div class="toasts">
      ${items.map((t) => html`
        <div class="toast ${t.kind}" key=${t.id} onClick=${() => dismiss(t.id)}>
          ${t.image ? html`<${Img} class="toast-img ${t.kind}" src=${t.image} />` : html`<span class="toast-icon"><${Icon} name=${t.kind === 'error' ? 'x' : t.kind === 'new' ? 'star' : 'check'} size=${15} /></span>`}
          <div class="toast-body">
            <div class="toast-title">${t.title}</div>
            ${t.text && html`<div class="toast-text">${t.text}</div>`}
            ${t.sub && html`<div class="toast-sub mono">${t.sub}</div>`}
          </div>
        </div>`)}
    </div>`;
}

// ---- app ----

function App() {
  const [s, setS] = useState(null);
  const [tab, setTab] = useState('campaigns');
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [focusGame, setFocusGame] = useState(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.kind === 'error' ? 6000 : 4500);
  }, []);

  useEffect(() => {
    api.getState().then(setS);
    const off1 = api.on('state', setS);
    const off2 = api.on('toast', pushToast);
    return () => { off1(); off2(); };
  }, []);

  useEffect(() => {
    if (s) document.documentElement.dataset.accent = s.engine.settings.accent || 'lime';
  }, [s && s.engine.settings.accent]);

  if (!s) return html`<div class="boot" />`;
  const signedIn = s.auth.status === 'signed-in';

  return html`
    <div class="shell">
      <${TitleBar} s=${s} tab=${tab} setTab=${setTab} openSettings=${() => { setMenu(false); setSettings(true); }} menu=${menu} setMenu=${setMenu} onToast=${pushToast} />
      <${NoticeBanner} notice=${s.reports && s.reports.notice} />
      ${!signedIn && html`<${Login} auth=${s.auth} s=${s} onToast=${pushToast} key=${s.activeId || 'none'} />`}
      ${signedIn && html`
        <main class="main">
          ${tab === 'campaigns' && html`<${CampaignsView} s=${s} onToast=${pushToast} key=${focusGame} />`}
          ${tab === 'link' && html`<${LinkView} s=${s} />`}
          ${tab === 'inventory' && html`<${InventoryView} s=${s} />`}
          ${tab === 'stats' && html`<${StatsView} s=${s} />`}
          ${tab === 'activity' && html`<${ActivityView} s=${s} />`}
          ${tab === 'admin' && s.reports && s.reports.admin && html`<${AdminView} onToast=${pushToast} />`}
        </main>
        <${Dock} s=${s} goTo=${() => { setTab('campaigns'); setFocusGame((n) => n + 1); }} />`}
      ${settings && s.accounts.length > 0 && html`<${Settings} s=${s} onClose=${() => setSettings(false)} openReport=${() => { setSettings(false); setReporting(true); }} />`}
      ${reporting && html`<${ReportDialog} s=${s} onClose=${() => setReporting(false)} onToast=${pushToast} />`}
      <${Toasts} items=${toasts} dismiss=${dismiss} />
    </div>`;
}

installTooltips();
installErrorReporting();
render(html`<${App} />`, document.getElementById('app'));
