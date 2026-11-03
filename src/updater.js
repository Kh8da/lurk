'use strict';
// In-app updates from the release feed set in package.json (build.publish).
// New versions download in the background and install on the next restart.
const { app } = require('electron');
const { EventEmitter } = require('events');

const SIX_HOURS = 6 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: app.isPackaged ? 'idle' : 'dev', version: null, progress: 0, error: null };
    this.timer = null;
    this.au = null;
  }

  init(enabled) {
    if (!app.isPackaged) return;
    // Loaded lazily: electron-updater expects a packaged app.
    this.au = require('electron-updater').autoUpdater;
    const au = this.au;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    au.on('update-available', (i) => this.set({ status: 'downloading', version: i.version, progress: 0 }));
    au.on('update-not-available', () => this.set({ status: 'current' }));
    au.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version, progress: 100 }));
    au.on('error', (err) => this.set({ status: 'error', error: String((err && err.message) || err).split('\n')[0] }));
    this.setEnabled(enabled);
  }

  setEnabled(on) {
    clearInterval(this.timer);
    if (!this.au || !on) return;
    this.check();
    this.timer = setInterval(() => this.check(), SIX_HOURS);
  }

  check() {
    if (!this.au) return Promise.resolve(this.state);
    if (this.state.status === 'downloading' || this.state.status === 'ready') return Promise.resolve(this.state);
    return this.au.checkForUpdates().then(() => this.state).catch(() => this.state);
  }

  install() {
    if (this.au && this.state.status === 'ready') this.au.quitAndInstall(true, true);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }
}

module.exports = { Updater };
