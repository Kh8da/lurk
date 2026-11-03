import { html, render, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { Icon, Mark, Img, installErrorReporting } from './ui.js';

const api = window.lurk;

function line(a) {
  if (a.status === 'signed-out') return 'Signed out';
  if (a.status !== 'signed-in' || !a.farm) return 'Checking';
  const f = a.farm;
  if (f.kind === 'watching' && f.channel) return `${f.channel}${f.game ? ` · ${f.game}` : ''}`;
  if (f.kind === 'held') return f.hold === 'gaming' ? 'On hold while you play' : 'Outside farming hours';
  if (f.kind === 'paused') return 'Paused';
  if (f.kind === 'searching') return 'Finding a channel';
  return f.autopilot ? 'Autopilot, nothing to farm' : 'Idle';
}

function Row({ a }) {
  const cur = a.farm && a.farm.kind === 'watching' ? a.farm.current : null;
  const pct = cur ? Math.min(100, (cur.minutes / Math.max(1, cur.required)) * 100) : 0;
  return html`
    <div class="wg-row ${cur ? 'live' : ''}">
      <div class="wg-art">
        ${cur && cur.image ? html`<${Img} src=${cur.image} fallback=${cur.label} />` : html`<${Img} class="round" src=${a.avatar} fallback=${a.displayName} />`}
      </div>
      <div class="wg-meta">
        <div class="wg-top">
          <span class="wg-name">${cur ? cur.label : a.displayName}</span>
          ${cur && html`<span class="wg-min mono">${cur.minutes}/${cur.required}</span>`}
        </div>
        <div class="wg-sub">${cur ? `${a.displayName} · ${line(a)}` : line(a)}</div>
        ${cur && html`<div class="bar wg-bar"><i style=${{ width: `${pct}%` }} /></div>`}
      </div>
    </div>`;
}

function Widget() {
  const [s, setS] = useState(null);
  const ref = useRef();
  useEffect(() => {
    api.getState().then(setS);
    return api.on('state', setS);
  }, []);
  useEffect(() => {
    if (s) document.documentElement.dataset.accent = s.engine.settings.accent || 'lime';
  }, [s && s.engine.settings.accent]);
  // Fit the window to the content after every render.
  useEffect(() => {
    if (ref.current) api.widget.resize(ref.current.offsetHeight);
  });
  if (!s) return null;
  return html`
    <div class="wg" ref=${ref}>
      <div class="wg-head">
        <${Mark} size=${15} blink=${false} />
        <span class="wg-title">LURK</span>
        <span class="grow" />
        <button class="wg-btn" onClick=${() => api.widget.open()} aria-label="Open Lurk"><${Icon} name="external" size=${14} /></button>
        <button class="wg-btn" onClick=${() => api.widget.close()} aria-label="Close the widget"><${Icon} name="x" size=${14} /></button>
      </div>
      ${!s.accounts.length && html`<div class="wg-empty">Sign in to Lurk to start farming.</div>`}
      ${s.accounts.map((a) => html`<${Row} a=${a} key=${a.id} />`)}
    </div>`;
}

installErrorReporting();
render(html`<${Widget} />`, document.getElementById('app'));
