'use strict';
// All network traffic goes through Electron's net.fetch so it follows the
// system proxy (Node's own fetch ignores it).
const { net } = require('electron');

async function request(url, opts = {}) {
  const { method = 'GET', json, form, timeout = 20000 } = opts;
  const headers = { ...(opts.headers || {}) };
  let body = opts.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers['Content-Type'] = 'application/json';
  } else if (form) {
    body = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await net.fetch(url, { method, headers, body, signal: ctrl.signal });
    const text = method === 'HEAD' ? '' : await res.text();
    return {
      status: res.status,
      ok: res.ok,
      text,
      json() {
        try { return JSON.parse(text); } catch { return null; }
      },
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timed out talking to ${new URL(url).host}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { request };
