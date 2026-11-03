import { html, useState, useEffect } from '../vendor/preact-htm.js';

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  minus: '<path d="M6 12h12"/>',
  max: '<rect x="6.5" y="6.5" width="11" height="11" rx="1"/>',
  restore: '<rect x="6.5" y="8.5" width="9" height="9" rx="1"/><path d="M9.5 6.5h7a1 1 0 0 1 1 1v7"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11"/>',
  play: '<path d="M8 6.2v11.6L17.5 12z" fill="currentColor"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="6" y="10.5" width="12" height="9" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  out: '<path d="M14 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  external: '<path d="M13.5 5H19v5.5M19 5l-8 8"/><path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5"/>',
  copy: '<rect x="8.5" y="8.5" width="10" height="10" rx="1.5"/><path d="M15.5 8.5V6.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/>',
  up: '<path d="M7 14l5-5 5 5"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  chevron: '<path d="M10 7l5 5-5 5"/>',
  gift: '<rect x="4.5" y="9" width="15" height="4" rx="1"/><path d="M6 13v6h12v-6M12 9v10M12 9c-1.5-3.5-5.5-3.5-5-1 .3 1 2.5 1 5 1zM12 9c1.5-3.5 5.5-3.5 5-1-.3 1-2.5 1-5 1z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1-3.5 3.8-5 7-5s6 1.5 7 5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  star: '<path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z"/>',
  'star-fill': '<path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="currentColor"/>',
  ban: '<circle cx="12" cy="12" r="7.5"/><path d="M6.8 6.8l10.4 10.4"/>',
  bolt: '<path d="M13 3.5L5.5 13.5H12l-1 7 7.5-10H12z" fill="currentColor" stroke-width="1.4"/>',
  send: '<path d="M20.5 3.5L10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 18.5c.8-3 3-4.3 5.5-4.3s4.7 1.3 5.5 4.3"/><path d="M15.5 6a3 3 0 0 1 0 6M17.5 14.6c1.5.6 2.6 1.9 3 3.9"/>',
};

export function Icon({ name, size = 18, class: cls = '' }) {
  return html`<svg class="icon ${cls}" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: PATHS[name] || '' }} />`;
}

export function Mark({ size = 22, blink = true }) {
  return html`
    <svg class="mark ${blink ? 'blinks' : ''}" width=${size} height=${size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="23" fill="var(--accent)" />
      <g class="mark-eyes">
        <ellipse cx="45.5" cy="44" rx="9.5" ry="14" fill="var(--on-accent)" />
        <ellipse cx="69.5" cy="44" rx="9.5" ry="14" fill="var(--on-accent)" />
        <circle cx="49" cy="39.5" r="3" fill="var(--accent)" />
        <circle cx="73" cy="39.5" r="3" fill="var(--accent)" />
      </g>
    </svg>`;
}

export function Img({ src, alt = '', class: cls = '', fallback = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return html`<div class="img img-empty ${cls}" aria-hidden="true">${fallback ? fallback.slice(0, 2).toUpperCase() : ''}</div>`;
  }
  return html`<img class="img ${cls}" src=${src} alt=${alt} loading="lazy" decoding="async" draggable="false" onError=${() => setFailed(true)} />`;
}

export function Toggle({ on, onChange, label, hint }) {
  return html`
    <label class="toggle-row">
      <span class="toggle-text">
        <span class="toggle-label">${label}</span>
        ${hint && html`<span class="toggle-hint">${hint}</span>`}
      </span>
      <button type="button" role="switch" aria-checked=${on ? 'true' : 'false'} class="switch ${on ? 'on' : ''}" onClick=${() => onChange(!on)}><i /></button>
    </label>`;
}

// ---- errors ----

// Uncaught errors in a window go to the detailed log (and a crash report when allowed).
export function installErrorReporting() {
  let sent = 0;
  const report = (text) => {
    if (sent++ > 20) return;
    try { window.lurk.logError(text).catch(() => {}); } catch {}
  };
  window.addEventListener('error', (e) => {
    report(`${e.message} at ${e.filename || '?'}:${e.lineno || 0}\n${(e.error && e.error.stack) || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report(`Unhandled promise: ${(r && (r.stack || r.message)) || r}`);
  });
}

// ---- tooltips ----

// One shared tooltip for every element with data-tip, in place of the
// browser's native title box. Sits above the element (below when there's no
// room), stays inside the window and points at what it describes.
export function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let target = null;
  let timer = null;

  const hide = () => {
    clearTimeout(timer);
    target = null;
    tip.classList.remove('show');
  };

  const show = (el) => {
    const text = el.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.top - t.height - 9;
    const below = top < 54;
    if (below) top = r.bottom + 9;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.setProperty('--arrow-x', `${Math.round(r.left + r.width / 2 - left)}px`);
    tip.classList.toggle('below', below);
    tip.classList.add('show');
  };

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    // Quicker when moving between tipped elements, like a toolbar.
    const delay = tip.dataset.recent && Date.now() - tip.dataset.recent < 400 ? 60 : 380;
    timer = setTimeout(() => {
      if (target === el && el.isConnected) {
        show(el);
        tip.dataset.recent = '';
      }
    }, delay);
  });
  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) hide();
    if (tip.classList.contains('show')) tip.dataset.recent = String(Date.now());
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  // The element can vanish under the pointer (a re-render, a page change).
  setInterval(() => {
    if (target && !target.isConnected) hide();
  }, 400);
}

// ---- formatting ----

const T = { m: 60e3, h: 3600e3, d: 86400e3 };

export function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function fmtSpan(ms) {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / T.d);
  const h = Math.floor((ms % T.d) / T.h);
  const m = Math.max(1, Math.floor((ms % T.h) / T.m));
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function timeLeft(c, now = Date.now()) {
  if (c.phase === 'upcoming') return { text: `Starts in ${fmtSpan(Date.parse(c.startAt) - now)}`, soon: false };
  const left = Date.parse(c.endAt) - now;
  if (left <= 0) return { text: 'Ended', soon: true };
  return { text: `${fmtSpan(left)} left`, soon: left < T.d };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(iso, withTime = true) {
  const d = new Date(iso);
  const day = `${MONTHS[d.getMonth()]} ${pad(d.getDate())}`;
  return withTime ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day;
}

// "18:40", "tomorrow 09:15" or "Nov 05 21:00".
export function fmtEta(t) {
  const d = new Date(t);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date().toDateString()) return time;
  if (d.toDateString() === new Date(Date.now() + 86400e3).toDateString()) return `tomorrow ${time}`;
  return `${MONTHS[d.getMonth()]} ${pad(d.getDate())} ${time}`;
}

export function fmtClock(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ago(iso) {
  const ms = Date.now() - (typeof iso === 'number' ? iso : Date.parse(iso));
  if (ms < T.m) return 'just now';
  if (ms < T.h) return `${Math.floor(ms / T.m)}m ago`;
  if (ms < T.d) return `${Math.floor(ms / T.h)}h ago`;
  if (ms < 30 * T.d) return `${Math.floor(ms / T.d)}d ago`;
  return fmtDate(iso, false);
}

export function fmtViewers(n) {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function errText(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// Re-render once a minute so countdowns stay fresh.
export function useClock(ms = 30000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return Date.now();
}
