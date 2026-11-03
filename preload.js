'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const EVENTS = new Set(['state', 'toast']);

contextBridge.exposeInMainWorld('lurk', {
  getState: call('state:get'),
  on(event, fn) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  signIn: call('auth:start'),
  cancelSignIn: call('auth:cancel'),
  signOut: call('auth:signout'),
  refresh: call('campaigns:refresh'),
  accounts: {
    add: call('accounts:add'),
    reauth: call('accounts:reauth'),
    remove: call('accounts:remove'),
    switch: call('accounts:switch'),
  },
  join: call('queue:join'),
  joinAll: call('queue:joinAll'),
  leave: call('queue:leave'),
  move: call('queue:move'),
  clearQueue: call('queue:clear'),
  pause: call('farm:pause'),
  claim: call('drop:claim'),
  toggleGame: call('games:toggle'),
  stats: call('stats:get'),
  logError: call('log:renderer'),
  openLogs: call('logs:open'),
  report: {
    preview: call('report:preview'),
    send: call('report:send'),
    inbox: call('report:inbox'),
  },
  admin: {
    unlock: call('admin:unlock'),
    lock: call('admin:lock'),
    call: call('admin:call'),
  },
  scanLibrary: call('library:scan'),
  update: {
    check: call('update:check'),
    install: call('update:install'),
  },
  widget: {
    resize: call('widget:resize'),
    close: call('widget:close'),
    open: call('widget:open'),
  },
  telegram: {
    connect: call('telegram:connect'),
    cancel: call('telegram:cancel'),
    test: call('telegram:test'),
    disconnect: call('telegram:disconnect'),
  },
  discord: {
    connect: call('discord:connect'),
    test: call('discord:test'),
    disconnect: call('discord:disconnect'),
  },
  setSetting: call('settings:set'),
  open: call('open:url'),
  copy: call('clipboard:write'),
  win: (action) => ipcRenderer.invoke(`win:${action}`),
});
