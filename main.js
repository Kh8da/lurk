'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, Notification, nativeImage } = require('electron');

const demoArg = process.argv.find((a) => a === '--demo' || a.startsWith('--demo='));
const DEMO = !!demoArg;
if (DEMO) app.setPath('userData', path.join(app.getPath('appData'), 'Lurk-demo'));

const store = require('./src/store');
const { Settings } = require('./src/settings');
const { Accounts } = require('./src/accounts');
const { TwitchClient } = require('./src/twitch/client');
const { openLogin } = require('./src/twitch/login');
const { DemoClient, demoLogin, DEMO_USERS } = require('./src/demo');
const { Telegram } = require('./src/telegram');
const { Discord } = require('./src/discord');
const { hashes } = require('./src/twitch/hashes');
const library = require('./src/library');
const { Gaming } = require('./src/gaming');
const { Updater } = require('./src/updater');
const { inFarmingHours } = require('./src/schedule');
const { log, redact } = require('./src/logger');
const { Reports } = require('./src/reports');

const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const startHidden = process.argv.includes('--hidden');

let win = null;
let tray = null;
let quitting = false;
let settings;
let accounts;
let telegram;
let discord;
let gaming;
let updater;
let widget = null;
let ownedGames = null;
let reports;
let pushTimer = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(boot);
}

app.setAppUserModelId(DEMO ? 'app.lurk.demo' : 'app.lurk');

// Anything thrown and not caught ends up in the log, and in a crash report when allowed.
process.on('uncaughtException', (err) => onCrash('main', err));
process.on('unhandledRejection', (err) => onCrash('main', err instanceof Error ? err : new Error(String(err))));

function onCrash(where, err) {
  log.error('crash', `${where}: ${(err && err.stack) || err}`);
  if (!reports || !settings) return;
  reports.crash(settings.values.crashReports, {
    error: redact(`${where}: ${(err && err.stack) || err}`).slice(0, 20000),
    summary: appSummary(),
    logs: stripNames(log.tail(300)),
  });
}

function boot() {
  log.init(path.join(app.getPath('userData'), 'logs'));
  log.info('app', `Lurk ${app.getVersion()} starting`, { electron: process.versions.electron, os: `${require('os').platform()} ${require('os').release()}`, packaged: app.isPackaged, demo: DEMO });
  settings = new Settings(store);
  reports = new Reports({ store, log, version: DEMO ? `${app.getVersion()}-demo` : app.getVersion() });
  reports.on('change', push);
  reports.on('reply', (r) => {
    toast({ kind: 'info', title: 'Reply to your report', text: r.reply.slice(0, 160), sub: 'Open Settings, Help to see it' });
    notify('Reply to your report', r.reply.slice(0, 200));
  });
  telegram = new Telegram({ store, onChange: push });
  discord = new Discord({ store, onChange: push });
  if (DEMO) seedDemo();

  accounts = new Accounts({
    store,
    settings,
    makeClient: () => (DEMO ? new DemoClient() : new TwitchClient({ debugLog: debugLogger(), logger: log })),
    login: (partition) => (DEMO
      ? demoLogin(DEMO_USERS.find((u) => !accounts.byId.has(u.id)))
      : openLogin({ parent: win, icon: ICON, partition })),
    timing: DEMO ? { watch: 1500, progress: 3000, inventory: 9000, streamCheck: 15000, noChannel: 5000, points: 6000 } : {},
    logger: log,
  });
  accounts.on('change', push);
  accounts.on('added', showWindow);
  accounts.on('event', onEngineEvent);
  accounts.on('signed-out', (a) => alert('signedOut', 'Signed out of Twitch', `${a.displayName}: farming stopped. Open Lurk to sign in again.`));
  settings.on('change', (key, value) => {
    log.info('settings', `${key} = ${Array.isArray(value) ? `[${value.length} items]` : JSON.stringify(value)}`);
    for (const a of accounts.list()) a.engine.settingChanged(key, value);
    if (key === 'widget') setWidget(value);
    if (key === 'pauseWhileGaming') (value ? gaming.start() : gaming.stop());
    if (key.startsWith('schedule') || key === 'pauseWhileGaming') applyHold();
    if (key === 'autoUpdate') updater.setEnabled(value);
    if (key === 'autoStarOwned' && value) autoStar().catch(() => {});
    push();
  });

  hashes.init(store);
  if (!DEMO && hashes.stale()) hashes.refresh();
  gaming = new Gaming();
  gaming.on('change', () => { applyHold(); push(); });
  if (settings.values.pauseWhileGaming) gaming.start();
  updater = new Updater();
  updater.on('change', (st) => {
    log.info('update', st.status + (st.version ? ` ${st.version}` : '') + (st.error ? ` (${st.error})` : ''));
    push();
  });
  updater.init(settings.values.autoUpdate);
  telegram.listen(onTelegramCommand);
  setInterval(applyHold, 30000);

  if (app.isPackaged) {
    // Keep the Windows startup entry pointing at the installed exe.
    app.setLoginItemSettings({ openAtLogin: settings.values.startWithWindows, args: ['--hidden'] });
  }

  createWindow();
  createTray();
  accounts.load();
  // The demo never counts as an install in your stats.
  reports.start(() => ({ usageStats: settings.values.usageStats && !DEMO, accounts: accounts.list().length }));
  applyHold();
  if (settings.values.widget) setWidget(true);
}

// ---- schedule and gaming pause ----

function holdReason() {
  const v = settings.values;
  if (v.scheduleOn && !inFarmingHours(v.scheduleFrom, v.scheduleTo)) return 'schedule';
  if (v.pauseWhileGaming && gaming.active) return 'gaming';
  return null;
}

function applyHold() {
  const reason = holdReason();
  for (const a of accounts.list()) a.engine.setHold(reason);
}

// ---- games you own ----

async function scanLibrary(force) {
  if (!ownedGames || force) ownedGames = await library.scan();
  return ownedGames;
}

function knownGames() {
  const map = new Map();
  for (const a of accounts.signedIn()) for (const c of a.engine.campaigns.values()) map.set(c.game.id, c.game);
  return [...map.values()];
}

// Stars owned games once each, so un-starring one by hand sticks.
async function autoStar(force) {
  const owned = await scanLibrary(force);
  const matched = library.match(owned, knownGames());
  if (!settings.values.autoStarOwned && !force) return { owned: owned.length, matched, starred: 0 };
  const saved = store.readJson('library.json', { starredOnce: [] });
  const fresh = matched.filter((g) => !saved.starredOnce.includes(g.id));
  if (fresh.length) {
    settings.set('favorites', [...new Set([...settings.values.favorites, ...fresh.map((g) => g.id)])]);
    store.writeJson('library.json', { starredOnce: [...saved.starredOnce, ...fresh.map((g) => g.id)] });
    toast({ kind: 'new', title: fresh.length === 1 ? 'Starred a game you own' : `Starred ${fresh.length} games you own`, text: fresh.map((g) => g.name).join(', ') });
  }
  return { owned: owned.length, matched, starred: fresh.length };
}

// The demo starts already signed in to its first fake account.
function seedDemo() {
  if (demoArg === '--demo=login' || store.exists('accounts.json')) return;
  const u = DEMO_USERS[0];
  store.writeJson('accounts.json', { list: [{ id: u.id, login: u.login }], active: u.id });
  store.writeSecret(`accounts/${u.id}/session.bin`, { token: u.token, userId: u.id, login: u.login });
  // Two weeks of made-up history so the Stats page has something to show.
  const minutes = {};
  const points = {};
  for (let i = 1; i <= 14; i++) {
    const day = new Date(Date.now() - i * 86400e3).toISOString().slice(0, 10);
    minutes[day] = [190, 240, 75, 0, 310, 260, 120, 45, 280, 330, 0, 150, 210, 95][i - 1];
    points[day] = Math.round(minutes[day] / 15) * 50;
  }
  store.writeJson(`accounts/${u.id}/state.json`, { stats: { minutes, points } });
}

// LURK_DEBUG=1 writes raw Twitch GQL responses to %APPDATA%\Lurk\debug.log.
function debugLogger() {
  if (!process.env.LURK_DEBUG) return null;
  const file = path.join(app.getPath('userData'), 'debug.log');
  return (entry) => {
    try {
      require('fs').appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
    } catch {}
  };
}

function onEngineEvent(a, kind, d) {
  if (kind === 'refreshed') {
    if (settings.values.autoStarOwned) autoStar().catch(() => {});
    return;
  }
  // With more than one account, say which one it was.
  const who = accounts.list().length > 1 ? a.displayName : null;
  const sub = who ? `${d.game} · ${who}` : d.game;
  if (kind === 'claimed') {
    toast({ kind: 'claim', title: 'Reward claimed', text: d.name, sub, image: d.image });
    alert('claim', 'Reward claimed', `${d.name}\n${sub}`, d.image);
  } else if (kind === 'finished') {
    alert('finished', 'Campaign finished', `${d.name}\n${d.game}: every reward claimed${who ? ` on ${who}` : ''}`, d.image);
  } else if (kind === 'ending-soon') {
    const hours = Math.max(1, Math.round(d.left / 3600000));
    const rest = `${d.rewards} ${d.rewards === 1 ? 'reward' : 'rewards'} left${d.late ? ", not all can finish in time" : ''}`;
    toast({ kind: 'warn', title: `Ends in ${hours} h`, text: d.name, sub: who ? `${rest} · ${who}` : rest, image: d.image });
    alert('endingSoon', 'Campaign ending soon', `${d.name}\n${d.game}: ends in about ${hours} h, ${rest}${who ? ` (${who})` : ''}`, d.image);
  } else if (kind === 'new-campaign') {
    // The same new campaign shows up on every account; alert once.
    if (a !== accounts.signedIn()[0]) return;
    toast({ kind: 'new', title: d.upcoming ? 'Drops coming soon' : 'New drops', text: d.name, sub: d.game, image: d.image });
    alert('newCampaign', d.upcoming ? 'Drops coming soon' : 'New drops', `${d.game}\n${d.name}`, d.image);
  }
}

// ---- Telegram remote control ----

const HELP = [
  'Lurk commands:',
  '/status  what every account is doing',
  '/pause  pause all accounts',
  '/resume  resume all accounts',
  '/autopilot on|off  Autopilot on all accounts',
  '/today  rewards claimed and hours farmed today',
].join('\n');

function statusLine(a) {
  if (a.auth.status !== 'signed-in') return `${a.displayName}: signed out`;
  const f = a.engine.summary();
  let what = 'idle';
  if (f.kind === 'watching' && f.channel) what = `watching ${f.channel}${f.current ? `, ${f.current.label} ${f.current.minutes}/${f.current.required} min` : ''}`;
  else if (f.kind === 'held') what = f.hold === 'gaming' ? 'on hold while you play' : 'on hold outside farming hours';
  else if (f.kind === 'paused') what = 'paused';
  else if (f.kind === 'searching') what = 'finding a channel';
  else if (f.kind === 'waiting' || f.autopilot) what = 'waiting for something to farm';
  return `${a.displayName}: ${what}${f.autopilot ? ' (Autopilot)' : ''}`;
}

async function onTelegramCommand(text) {
  const [cmd, arg] = text.toLowerCase().split(/\s+/);
  const live = accounts.signedIn();
  switch (cmd.replace(/@.*$/, '')) {
    case '/start':
    case '/help':
      return HELP;
    case '/status':
      return accounts.list().length ? accounts.list().map(statusLine).join('\n') : 'No accounts signed in.';
    case '/pause':
      live.forEach((a) => a.engine.setPaused(true));
      return `Paused ${live.length} ${live.length === 1 ? 'account' : 'accounts'}.`;
    case '/resume':
      live.forEach((a) => a.engine.setPaused(false));
      return `Resumed ${live.length} ${live.length === 1 ? 'account' : 'accounts'}.`;
    case '/autopilot': {
      if (arg !== 'on' && arg !== 'off') return 'Use /autopilot on or /autopilot off';
      live.forEach((a) => a.engine.setAutopilot(arg === 'on'));
      return `Autopilot ${arg} on ${live.length} ${live.length === 1 ? 'account' : 'accounts'}.`;
    }
    case '/today': {
      const day = new Date().toISOString().slice(0, 10);
      return live.map((a) => {
        const st = a.engine.statsData();
        const rewards = st.claimed.filter((b) => (b.awardedAt || '').slice(0, 10) === day).length;
        const hours = ((st.minutes[day] || 0) / 60).toFixed(1);
        return `${a.displayName}: ${rewards} ${rewards === 1 ? 'reward' : 'rewards'}, ${hours} h farmed`;
      }).join('\n') || 'No accounts signed in.';
    }
    default:
      return HELP;
  }
}

// ---- mini widget ----

const WIDGET_WIDTH = 320;

function setWidget(on) {
  if (on && !widget) createWidget();
  if (!on && widget) widget.close();
}

function createWidget() {
  const pos = store.readJson('widget.json', {});
  widget = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: 140,
    x: Number.isFinite(pos.x) ? pos.x : undefined,
    y: Number.isFinite(pos.y) ? pos.y : undefined,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Lurk widget',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  widget.setAlwaysOnTop(true, 'floating');
  widget.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widget.once('ready-to-show', () => widget.showInactive());
  widget.on('moved', () => {
    const [x, y] = widget.getPosition();
    store.writeJson('widget.json', { x, y });
  });
  widget.on('closed', () => {
    widget = null;
    if (!quitting && settings.values.widget) settings.set('widget', false);
  });
  widget.webContents.on('will-navigate', (e) => e.preventDefault());
  widget.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// ---- window ----

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#09090b',
    icon: ICON,
    title: 'Lurk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!startHidden) win.show();
  });
  win.on('maximize', push);
  win.on('unmaximize', push);
  win.on('close', (e) => {
    if (quitting || !settings.values.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!store.readJson('flags.json', {}).trayHint) {
      store.writeJson('flags.json', { trayHint: true });
      notify('Lurk is still running', 'It keeps farming from the tray. Right-click the tray icon to quit.');
    }
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    onCrash('window', new Error(`renderer gone: ${d.reason} (exit ${d.exitCode})`));
    if (d.reason !== 'clean-exit' && !quitting) setTimeout(() => win && !win.isDestroyed() && win.reload(), 1000);
  });
  win.on('unresponsive', () => log.warn('window', 'stopped responding'));
}

app.on('child-process-gone', (_e, d) => {
  if (d.reason !== 'clean-exit') log.warn('app', `${d.type} process gone: ${d.reason}`);
});

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.on('click', showWindow);
  updateTray();
}

function updateTray(active) {
  if (!tray) return;
  const live = accounts ? accounts.signedIn() : [];
  const farming = live.filter((a) => a.engine.summary().kind === 'watching');
  let tip = 'Lurk';
  if (live.length > 1) {
    tip = `Lurk: ${farming.length} of ${live.length} accounts farming`;
  } else if (active && active.watch && active.status.kind === 'watching') {
    const cur = active.watch.current;
    tip = `Lurk: watching ${active.watch.channel.name}${cur ? `\n${cur.label} ${cur.minutes}/${cur.required} min` : ''}`;
  }
  // Windows cuts tray tooltips at 127 characters.
  tray.setToolTip(tip.length > 120 ? `${tip.slice(0, 117)}...` : tip);
  const allAuto = live.length > 0 && live.every((a) => a.engine.autopilot);
  const allPaused = live.length > 0 && live.every((a) => a.engine.paused);
  const several = live.length > 1;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lurk', click: showWindow },
    { type: 'separator' },
    {
      label: several ? 'Autopilot on all accounts' : 'Autopilot',
      type: 'checkbox',
      checked: allAuto,
      enabled: live.length > 0,
      click: (item) => live.forEach((a) => a.engine.setAutopilot(item.checked)),
    },
    {
      label: allPaused ? (several ? 'Resume all accounts' : 'Resume farming') : (several ? 'Pause all accounts' : 'Pause farming'),
      enabled: live.length > 0,
      click: () => live.forEach((a) => a.engine.setPaused(!allPaused)),
    },
    { label: 'Mini widget', type: 'checkbox', checked: settings.values.widget, click: (item) => settings.set('widget', item.checked) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function updateTaskbar(s) {
  if (!win || win.isDestroyed()) return;
  const cur = s && s.watch && s.status.kind === 'watching' && s.watch.current;
  if (settings.values.taskbarProgress && cur && cur.required) win.setProgressBar(Math.min(1, cur.minutes / cur.required));
  else win.setProgressBar(-1);
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, icon: ICON, silent: false }).show();
}

const ALERT_SETTING = { claim: 'alertClaims', finished: 'alertFinished', endingSoon: 'alertEndingSoon', newCampaign: 'alertNewCampaigns', signedOut: 'alertSignedOut' };

const ACCENT_HEX = { lime: 0xd4ff3a, violet: 0xb18cff, ice: 0x6fe3ff, ember: 0xff7a45 };
const accentHex = () => ACCENT_HEX[settings.values.accent] || ACCENT_HEX.lime;

// One alert, sent to every place the user turned on: Windows, Telegram, Discord.
function alert(kind, title, body, image) {
  if (!settings.values[ALERT_SETTING[kind]]) return;
  log.info('alert', `${kind}: ${title}`);
  discord.send(title, body, { image, color: accentHex() }).catch(() => {});
  if (settings.values.notify) notify(title, body.replace(/\n/g, ' · '));
  telegram.send(`${title}\n${body}`, image).catch(() => {});
}

function toast(t) {
  if (win && !win.isDestroyed()) win.webContents.send('toast', t);
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
  } catch {}
}

// ---- state ----

function emptyEngine() {
  return {
    loaded: false, loading: false, error: null, lastRefresh: 0, campaigns: [], claimed: [], queue: [],
    targets: 0, queueEta: null, paused: false, status: { kind: 'idle' }, watch: null, activity: [],
    settings: { ...settings.values, autopilot: false },
  };
}

function fullState() {
  const a = accounts && accounts.active;
  const auth = a
    ? { status: a.auth.status, error: a.auth.error, user: { id: a.id, login: a.login, displayName: a.displayName, avatar: a.avatar } }
    : { status: accounts && accounts.loaded ? 'signed-out' : 'checking', error: accounts && accounts.error, user: null };
  if (accounts && accounts.pending && accounts.pending.kind === 'add' && !a) auth.status = 'pending';
  if (a && accounts.pending && accounts.pending.kind === 'reauth' && accounts.pending.id === a.id) auth.status = 'pending';
  return {
    auth,
    accounts: accounts ? accounts.summaries() : [],
    activeId: a ? a.id : null,
    pending: accounts ? accounts.pendingState() : null,
    addError: accounts ? accounts.error : null,
    engine: a && a.auth.status === 'signed-in' ? a.engine.snapshot() : emptyEngine(),
    telegram: telegram.status(),
    discord: discord.status(),
    update: updater.state,
    reports: reports.status(),
    hold: holdReason(),
    app: { version: app.getVersion(), demo: DEMO, maximized: !!(win && win.isMaximized()) },
  };
}

// What a report says about the app. No secrets, no Twitch names.
function appSummary() {
  if (!accounts) return null;
  const v = settings.values;
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    uptimeMin: Math.round(process.uptime() / 60),
    accounts: accounts.list().map((a, i) => ({
      account: i + 1,
      status: a.auth.status,
      farm: a.auth.status === 'signed-in' ? a.engine.summary().kind : null,
      autopilot: a.engine.autopilot,
      queue: a.engine.queue.length,
      campaigns: a.engine.campaigns.size,
      lastError: a.engine.error,
    })),
    settings: { ...v, favorites: v.favorites.length, skipGames: v.skipGames.length },
    telegram: telegram.status().connected,
    discord: discord.status().connected,
    hold: holdReason(),
    update: updater.state.status,
  };
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Swap every account's Twitch name for "account-1", "account-2" and so on.
function stripNames(text) {
  let out = text;
  accounts.list().forEach((a, i) => {
    for (const name of new Set([a.login, a.displayName].filter((n) => n && n.length > 2))) {
      out = out.replace(new RegExp(escapeRe(name), 'gi'), `account-${i + 1}`);
    }
  });
  return out;
}

function buildReport({ description, contact, includeNames, includeLogs }) {
  const logs = includeLogs ? log.recent(2) : null;
  return {
    description: String(description || '').slice(0, 5000),
    contact: String(contact || '').slice(0, 200),
    accounts: includeNames ? accounts.list().map((a) => a.login) : null,
    summary: appSummary(),
    logs: logs && (includeNames ? logs : stripNames(logs)),
  };
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const ADMIN_OPS = {
  overview: () => reports.admin('/overview'),
  reports: (q) => reports.admin(`/reports?${new URLSearchParams(pick(q, ['status', 'kind', 'q', 'limit', 'offset']))}`),
  report: (id) => reports.admin(`/reports/${encodeURIComponent(id)}`),
  patch: (id, body) => reports.admin(`/reports/${encodeURIComponent(id)}`, { method: 'PATCH', body: pick(body, ['status', 'reply', 'note']) }),
  remove: (id) => reports.admin(`/reports/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  notice: () => reports.admin('/notice'),
  // The admin's own copy shows the new notice right away.
  setNotice: (body) => reports.admin('/notice', { method: 'PUT', body: pick(body, ['text', 'level']) }).then((d) => { reports.setNotice(d.notice); return d; }),
  installs: () => reports.admin('/installs?limit=100'),
};

// Daily stats per signed-in account, for the Stats page.
function statsState() {
  return accounts.signedIn().map((a) => ({ id: a.id, name: a.displayName, avatar: a.avatar, ...a.engine.statsData() }));
}

function push() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const state = fullState();
    updateTray(state.engine);
    updateTaskbar(state.engine);
    if (win && !win.isDestroyed()) win.webContents.send('state', state);
    if (widget && !widget.isDestroyed()) widget.webContents.send('state', state);
  }, 30);
}

function engine() {
  const a = accounts.active;
  if (!a || a.auth.status !== 'signed-in') throw new Error('Sign in to this account first');
  return a.engine;
}

// Join one campaign on every signed-in account that can earn it.
function joinAll(id) {
  const joined = [];
  const skipped = [];
  for (const a of accounts.signedIn()) {
    try {
      a.engine.join(id);
      joined.push(a.displayName);
    } catch (err) {
      skipped.push({ account: a.displayName, reason: err.message });
    }
  }
  return { joined, skipped };
}

const handlers = {
  'state:get': () => fullState(),
  'auth:start': () => { accounts.add(); },
  'auth:cancel': () => accounts.cancel(),
  'auth:signout': () => accounts.active && accounts.remove(accounts.active.id),
  'accounts:add': () => { accounts.add(); },
  'accounts:reauth': (id) => { accounts.reauth(String(id)).catch(() => {}); },
  'accounts:remove': (id) => accounts.remove(String(id)),
  'accounts:switch': (id) => accounts.setActive(String(id)),
  'campaigns:refresh': async () => { const e = engine(); await e.refresh(); e.kick(); },
  'queue:join': (id) => engine().join(String(id)),
  'queue:joinAll': (id) => joinAll(String(id)),
  'queue:leave': (id) => engine().leave(String(id)),
  'queue:move': (id, delta) => engine().move(String(id), delta > 0 ? 1 : -1),
  'queue:clear': () => engine().clearQueue(),
  'farm:pause': (p) => engine().setPaused(!!p),
  'drop:claim': (id) => engine().claimById(String(id)),
  'games:toggle': (list, gameId, on) => settings.toggleGame(String(list), String(gameId), !!on),
  'telegram:connect': (token) => telegram.connect(token),
  'telegram:cancel': () => telegram.cancel(),
  'telegram:test': () => telegram.send('Test from Lurk. Alerts are working.'),
  'telegram:disconnect': () => telegram.disconnect(),
  'discord:connect': (url) => discord.connect(url),
  'discord:test': () => discord.send('Test from Lurk', 'Alerts are working.', { color: accentHex() }),
  'discord:disconnect': () => discord.disconnect(),
  'settings:set': (key, value) => {
    if (key === 'autopilot') return engine().setAutopilot(!!value);
    settings.set(String(key), value);
    if (key === 'startWithWindows') {
      app.setLoginItemSettings({
        openAtLogin: !!value,
        args: app.isPackaged ? ['--hidden'] : [path.resolve(__dirname), '--hidden'],
      });
    }
  },
  'stats:get': () => statsState(),
  'log:renderer': (msg) => onCrash('renderer', new Error(String(msg).slice(0, 4000))),
  'logs:open': () => shell.openPath(path.join(app.getPath('userData'), 'logs')),
  'report:preview': (opts) => {
    const r = buildReport({ ...opts, description: '' });
    return { summary: r.summary, accounts: r.accounts, logBytes: r.logs ? r.logs.length : 0, logTail: r.logs ? r.logs.split('\n').slice(-30).join('\n') : '' };
  },
  'report:send': (opts) => reports.send(buildReport(opts || {})),
  'report:inbox': () => reports.checkInbox(),
  'admin:unlock': (key) => reports.unlock(key),
  'admin:lock': () => reports.lock(),
  'admin:call': (op, ...args) => {
    if (!Object.prototype.hasOwnProperty.call(ADMIN_OPS, op)) throw new Error('Unknown admin call');
    return ADMIN_OPS[op](...args);
  },
  'library:scan': async () => {
    const r = await autoStar(true);
    return { owned: r.owned, matched: r.matched.map((g) => g.name), starred: r.starred };
  },
  'update:check': () => updater.check(),
  'update:install': () => { quitting = true; updater.install(); },
  'widget:resize': (height) => {
    if (!widget || widget.isDestroyed()) return;
    // Windows ignores setSize on a non-resizable window, so allow it for the moment.
    widget.setResizable(true);
    widget.setSize(WIDGET_WIDTH, Math.max(60, Math.min(600, Math.round(Number(height) || 140))));
    widget.setResizable(false);
  },
  'widget:close': () => settings.set('widget', false),
  'widget:open': () => showWindow(),
  'open:url': (url) => openExternal(String(url)),
  'clipboard:write': (text) => clipboard.writeText(String(text)),
  'win:min': () => win.minimize(),
  'win:max': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'win:close': () => win.close(),
};

// Only Lurk's own pages (the main window and the widget) may call in.
const RENDERER_DIR = path.join(__dirname, 'renderer');
function trusted(e) {
  try {
    const url = e.senderFrame && e.senderFrame.url;
    if (!url || !url.startsWith('file:')) return false;
    const file = path.normalize(decodeURIComponent(new URL(url).pathname).replace(/^\/(\w:)/, '$1'));
    return file.toLowerCase().startsWith(RENDERER_DIR.toLowerCase());
  } catch {
    return false;
  }
}

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) {
      log.warn('ipc', `blocked ${channel} from ${e.senderFrame && e.senderFrame.url}`);
      throw new Error('Not allowed');
    }
    try {
      return await fn(...args);
    } catch (err) {
      log.warn('ipc', `${channel}: ${err.message}`);
      throw err;
    }
  });
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
