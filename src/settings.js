'use strict';
// App-wide settings, shared by every account. Per-account choices (queue,
// Autopilot, pause) live in each account's own state file instead.
const { EventEmitter } = require('events');

const DEFAULTS = {
  autoClaim: true,
  channelPoints: true,
  skipGames: [],
  favorites: [],
  autoStarOwned: false,
  notify: true,
  alertClaims: true,
  alertFinished: true,
  alertEndingSoon: true,
  alertNewCampaigns: true,
  alertSignedOut: true,
  scheduleOn: false,
  scheduleFrom: '01:00',
  scheduleTo: '09:00',
  pauseWhileGaming: false,
  livePreview: true,
  taskbarProgress: true,
  widget: false,
  closeToTray: true,
  startWithWindows: false,
  autoUpdate: true,
  crashReports: true,
  usageStats: true,
  accent: 'lime',
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHECKS = {
  scheduleFrom: (v) => TIME_RE.test(v),
  scheduleTo: (v) => TIME_RE.test(v),
  accent: (v) => ['lime', 'violet', 'ice', 'ember'].includes(v),
};

class Settings extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    const saved = store.readJson('settings.json', {});
    // Autopilot used to be app-wide; it's per account now. Kept only so the
    // first account can inherit it.
    this.legacyAutopilot = !!saved.autopilot;
    this.values = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) if (key in saved) this.values[key] = saved[key];
  }

  has(key) {
    return key in DEFAULTS;
  }

  set(key, value) {
    if (!this.has(key)) throw new Error(`Unknown setting ${key}`);
    const def = DEFAULTS[key];
    if (Array.isArray(def)) {
      if (!Array.isArray(value) || value.length > 1000 || value.some((v) => typeof v !== 'string')) throw new Error(`Bad value for ${key}`);
    } else if (typeof value !== typeof def || (CHECKS[key] && !CHECKS[key](value))) {
      throw new Error(`Bad value for ${key}`);
    }
    // Mutate in place: engines hold a reference to this object.
    this.values[key] = value;
    this.store.writeJson('settings.json', this.values);
    this.emit('change', key, value);
  }

  // Add or remove one game id in a list setting (favorites, skipGames).
  toggleGame(key, gameId, on) {
    if (key !== 'favorites' && key !== 'skipGames') throw new Error(`Unknown list ${key}`);
    const set = new Set(this.values[key]);
    if (on) set.add(String(gameId));
    else set.delete(String(gameId));
    this.set(key, [...set]);
  }
}

module.exports = { Settings, DEFAULTS };
