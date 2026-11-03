'use strict';
// Twitch sign-in through Twitch's own login page (implicit grant). The user
// signs in on twitch.tv inside a separate window; when Twitch redirects to
// https://www.twitch.tv/#access_token=..., Lurk takes the token and closes it.
const { BrowserWindow, session, shell } = require('electron');
const { CLIENT_ID } = require('./client');

const LOGIN_URL = 'https://www.twitch.tv/login'
  + `?client_id=${CLIENT_ID}`
  + `&redirect_params=${encodeURIComponent(`client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent('https://www.twitch.tv/')}&response_type=token`)}`;

// Twitch's login page treats unknown browsers with suspicion; present as plain Chrome.
function chromeUserAgent(ua) {
  return ua.replace(/ Electron\/\S+/, '').replace(/ lurk\/\S+/i, '');
}

const isTwitch = (host) => host === 'twitch.tv' || host.endsWith('.twitch.tv');

// partition: each account signs in inside its own one, so a second account
// doesn't get the first one's Twitch session back.
function openLogin({ parent, icon, partition = 'persist:twitch-login' }) {
  const ses = session.fromPartition(partition);
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()));
  const win = new BrowserWindow({
    parent,
    width: 500,
    height: 760,
    title: 'Sign in to Twitch',
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e10',
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  const promise = new Promise((resolve) => {
    let done = false;
    const finish = (token) => {
      if (done) return;
      done = true;
      resolve(token);
      if (!win.isDestroyed()) win.close();
    };
    const check = (url) => {
      let u;
      try { u = new URL(url); } catch { return; }
      // Only Twitch itself may hand back a token; any other page is ignored.
      if (u.protocol !== 'https:' || !isTwitch(u.hostname)) return;
      const m = /(?:^#|&)access_token=([a-z0-9]+)/i.exec(u.hash);
      if (m) finish(m[1]);
    };
    const wc = win.webContents;
    for (const ev of ['will-redirect', 'will-navigate', 'did-redirect-navigation', 'did-navigate', 'did-navigate-in-page']) {
      wc.on(ev, (e, url) => check(typeof url === 'string' ? url : e && e.url));
    }
    win.on('closed', () => finish(null));
    // Stay on Twitch: other links (help pages, terms) open in the real browser.
    wc.on('will-navigate', (e, url) => {
      let u;
      try { u = new URL(typeof url === 'string' ? url : e.url); } catch { return e.preventDefault(); }
      if (u.protocol === 'https:' && isTwitch(u.hostname)) return;
      e.preventDefault();
      if (u.protocol === 'https:') shell.openExternal(u.toString());
    });
    wc.setWindowOpenHandler(({ url }) => {
      try {
        if (new URL(url).protocol === 'https:') shell.openExternal(url);
      } catch {}
      return { action: 'deny' };
    });
  });

  win.loadURL(LOGIN_URL);
  return {
    promise,
    focus: () => !win.isDestroyed() && win.focus(),
    close: () => !win.isDestroyed() && win.close(),
  };
}

module.exports = { openLogin };
