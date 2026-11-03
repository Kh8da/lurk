'use strict';
// Detailed log: one file per day in %APPDATA%\Lurk\logs, kept for 7 days.
// Every line is scrubbed of tokens and secrets before it is written, so a log
// can be attached to a bug report as is.
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 7;
const MAX_FILE = 8 * 1024 * 1024; // past this, only warnings and errors are kept
const RING = 600;

const SECRETS = [
  [/OAuth\s+[A-Za-z0-9]{20,}/g, 'OAuth [hidden]'],
  [/\b(access_token|refresh_token|token|client_secret|password|secret|webhook)(["'\s:=]+)([A-Za-z0-9._~+/-]{12,})/gi, '$1$2[hidden]'],
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[telegram token]'],
  [/https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/[^\s"']+/gi, '[discord webhook]'],
  [/\bapi\.telegram\.org\/bot[^\s/"']+/gi, 'api.telegram.org/bot[hidden]'],
  // Twitch tokens are 30 lowercase letters and digits.
  [/\b[a-z0-9]{30}\b/g, '[hidden]'],
];

function redact(text) {
  let out = String(text);
  for (const [re, to] of SECRETS) out = out.replace(re, to);
  return out;
}

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

class Logger {
  constructor() {
    this.dir = null;
    this.buffer = [];
    this.ring = [];
    this.timer = null;
  }

  init(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    const cutoff = day(Date.now() - KEEP_DAYS * 86400e3);
    for (const f of fs.readdirSync(dir)) {
      const m = /^lurk-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[1] < cutoff) fs.rmSync(path.join(dir, f), { force: true });
    }
    process.on('exit', () => this.flushSync());
  }

  file(d = day()) {
    return path.join(this.dir, `lurk-${d}.log`);
  }

  write(level, scope, msg, extra) {
    let text = msg instanceof Error ? (msg.stack || msg.message) : String(msg);
    if (extra !== undefined) {
      let more;
      try { more = typeof extra === 'string' ? extra : JSON.stringify(extra); } catch { more = String(extra); }
      text += ` ${more}`;
    }
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${redact(text)}`;
    this.ring.push(line);
    if (this.ring.length > RING) this.ring.shift();
    if (!this.dir) return;
    this.buffer.push({ level, line });
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 500);
  }

  debug(scope, msg, extra) { this.write('debug', scope, msg, extra); }
  info(scope, msg, extra) { this.write('info', scope, msg, extra); }
  warn(scope, msg, extra) { this.write('warn', scope, msg, extra); }
  error(scope, msg, extra) { this.write('error', scope, msg, extra); }

  take() {
    clearTimeout(this.timer);
    this.timer = null;
    const file = this.file();
    let size = 0;
    try { size = fs.statSync(file).size; } catch {}
    const lines = this.buffer.filter((b) => size < MAX_FILE || b.level === 'warn' || b.level === 'error').map((b) => b.line);
    this.buffer = [];
    return { file, text: lines.length ? `${lines.join('\n')}\n` : '' };
  }

  flush() {
    const { file, text } = this.take();
    if (text) fs.appendFile(file, text, () => {});
  }

  flushSync() {
    if (!this.dir) return;
    const { file, text } = this.take();
    if (text) try { fs.appendFileSync(file, text); } catch {}
  }

  // The last `days` days of log, newest last, cut to the final `maxBytes`.
  recent(days = 2, maxBytes = 600 * 1024) {
    this.flushSync();
    let text = '';
    for (let i = days - 1; i >= 0; i--) {
      try { text += fs.readFileSync(this.file(day(Date.now() - i * 86400e3)), 'utf8'); } catch {}
    }
    if (text.length > maxBytes) text = `[earlier lines cut]\n${text.slice(text.length - maxBytes)}`;
    return text;
  }

  tail(n = 200) {
    return this.ring.slice(-n).join('\n');
  }
}

module.exports = { log: new Logger(), redact };
