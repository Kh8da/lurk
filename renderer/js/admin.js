// Admin tab: only shown in a copy holding the admin key. Everything goes
// through the main process, which adds the key; this page never sees it.
import { html, useState, useEffect, useMemo, useRef } from '../vendor/preact-htm.js';
import { Icon, ago, fmtDate, fmtClock, errText } from './ui.js';

const api = window.lurk;
const call = (op, ...args) => api.admin.call(op, ...args);

const STATUS = [
  ['new', 'New'],
  ['seen', 'Seen'],
  ['fixed', 'Fixed'],
  ['ignored', 'Ignored'],
  ['all', 'All'],
];

const when = (t) => (t ? `${fmtDate(t, false)} ${fmtClock(t)}` : '');
const parse = (text, fallback) => {
  try { return JSON.parse(text); } catch { return fallback; }
};

function Overview({ data }) {
  if (!data) return html`<div class="tiles"><div class="tile skeleton-tile" /><div class="tile skeleton-tile" /><div class="tile skeleton-tile" /><div class="tile skeleton-tile" /></div>`;
  const i = data.installs || {};
  const r = data.reports || {};
  return html`
    <div class="tiles">
      <div class="tile" data-tip=${`${i.d1 || 0} today · ${i.d7 || 0} this week · ${i.total || 0} ever`}><span class="tile-k mono">Active installs, 30 days</span><span class="tile-v">${i.d30 || 0}</span></div>
      <div class="tile"><span class="tile-k mono">Accounts farming</span><span class="tile-v">${i.accounts || 0}</span></div>
      <div class="tile ${r.fresh ? 'hot' : ''}"><span class="tile-k mono">New reports</span><span class="tile-v">${r.fresh || 0}</span></div>
      <div class="tile"><span class="tile-k mono">Crashes, 7 days</span><span class="tile-v">${r.crashes7 || 0}</span></div>
    </div>
    ${data.versions && data.versions.length > 0 && html`
      <div class="versions mono">
        <span class="versions-k">Versions in use</span>
        ${data.versions.map((v) => html`<span class="version-chip" key=${v.version}>${v.version || '?'} <b>${v.n}</b></span>`)}
      </div>`}`;
}

// ---- reports ----

const LEVELS = [['ERROR', 'Errors'], ['WARN', 'Warnings'], ['INFO', 'Info'], ['DEBUG', 'Debug']];

function LogViewer({ text }) {
  const [levels, setLevels] = useState({ ERROR: true, WARN: true, INFO: true, DEBUG: false });
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(800);
  const lines = useMemo(() => (text || '').split('\n').filter(Boolean), [text]);
  const shown = lines.filter((l) => {
    const m = / (ERROR|WARN |INFO |DEBUG) /.exec(l);
    const lvl = m ? m[1].trim() : 'INFO';
    return levels[lvl] && (!q || l.toLowerCase().includes(q.toLowerCase()));
  });
  const tail = shown.slice(-limit);
  if (!text) return html`<div class="empty-line">No log was sent with this one.</div>`;
  return html`
    <div class="log-tools">
      ${LEVELS.map(([k, label]) => html`<button class="chip ${levels[k] ? 'on' : ''}" key=${k} onClick=${() => setLevels({ ...levels, [k]: !levels[k] })}>${label}</button>`)}
      <label class="search slim"><${Icon} name="search" size=${13} /><input placeholder="Search the log" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} spellcheck="false" /></label>
      <span class="mono log-count">${shown.length} of ${lines.length} lines</span>
      <button class="btn ghost sm" onClick=${() => api.copy(text)}><${Icon} name="copy" size=${13} /> Copy</button>
    </div>
    ${shown.length > tail.length && html`<button class="link-btn" onClick=${() => setLimit(limit + 2000)}>Show ${Math.min(2000, shown.length - tail.length)} earlier lines</button>`}
    <pre class="log-view">${tail.map((l, i) => html`<div key=${i} class="ll ${/ ERROR /.test(l) ? 'e' : / WARN  /.test(l) ? 'w' : / DEBUG /.test(l) ? 'd' : ''}">${l}</div>`)}</pre>`;
}

function ReportDetail({ id, onPatched, onDeleted, onToast }) {
  const [data, setData] = useState(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setData(null);
    setConfirm(false);
    call('report', id).then((d) => {
      setData(d);
      setReply(d.report.reply || '');
      setNote(d.report.note || '');
      // Opening a new report marks it seen.
      if (d.report.status === 'new') call('patch', id, { status: 'seen' }).then((p) => onPatched(p.report)).catch(() => {});
    }).catch((err) => onToast({ kind: 'error', title: 'Could not load the report', text: errText(err) }));
  }, [id]);
  const patch = async (body, done) => {
    setBusy(true);
    try {
      const d = await call('patch', id, body);
      setData((old) => ({ ...old, report: d.report }));
      onPatched(d.report);
      if (done) onToast({ kind: 'info', title: done });
    } catch (err) {
      onToast({ kind: 'error', title: 'Could not save', text: errText(err) });
    }
    setBusy(false);
  };
  const remove = async () => {
    try {
      await call('remove', id);
      onDeleted(id);
    } catch (err) {
      onToast({ kind: 'error', title: 'Could not delete', text: errText(err) });
    }
  };
  if (!data) return html`<div class="detail"><div class="pane-empty"><i class="spinner big" /></div></div>`;
  const r = data.report;
  const accounts = parse(r.accounts, null);
  const summary = parse(r.summary, null);
  return html`
    <div class="detail">
      <div class="detail-head">
        <span class="kind ${r.kind}">${r.kind === 'crash' ? 'Crash' : 'Report'}</span>
        <span class="mono detail-id" data-tip="Copy the id" onClick=${() => api.copy(r.id)}>${r.id.slice(0, 8)}</span>
        <span class="grow" />
        ${['seen', 'fixed', 'ignored'].map((st) => html`<button class="pill ${r.status === st ? 'on' : ''}" key=${st} disabled=${busy} onClick=${() => patch({ status: st })}>${st[0].toUpperCase() + st.slice(1)}</button>`)}
      </div>
      <div class="meta-grid">
        <span>Sent</span><b>${when(r.created_at)} (${ago(r.created_at)})</b>
        <span>Version</span><b class="mono">${r.version || '?'}</b>
        <span>System</span><b class="mono">${r.platform || '?'}</b>
        <span>Country</span><b>${r.country || '?'}</b>
        <span>Contact</span><b>${r.contact || 'None given'}</b>
        <span>Twitch</span><b>${accounts && accounts.length ? accounts.join(', ') : 'Not shared'}</b>
        ${data.install && html`<span>Install</span><b>${data.install.reports} ${data.install.reports === 1 ? 'report' : 'reports'}, first seen ${ago(data.install.first_seen)}, last seen ${ago(data.install.last_seen)}</b>`}
      </div>
      ${r.description && html`<h4 class="section-label mono">What happened</h4><p class="detail-text">${r.description}</p>`}
      ${r.error && html`<h4 class="section-label mono">Error</h4><pre class="err-view">${r.error}</pre>`}

      <h4 class="section-label mono">Reply</h4>
      ${r.kind === 'crash'
        ? html`<div class="empty-line">Crash reports come from the app, nobody to reply to.</div>`
        : html`
          <textarea class="field" rows="3" placeholder="Shows up in their app as a notification" value=${reply} onInput=${(e) => setReply(e.currentTarget.value)} />
          <div class="row-actions">
            <button class="btn primary sm" disabled=${busy || !reply.trim() || reply === (r.reply || '')} onClick=${() => patch({ reply }, 'Reply sent')}>${r.reply ? 'Update reply' : 'Send reply'}</button>
            ${r.replied_at && html`<span class="row-note">Replied ${ago(r.replied_at)}</span>`}
          </div>`}

      <h4 class="section-label mono">Private note</h4>
      <textarea class="field" rows="2" placeholder="Only you see this" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} />
      <div class="row-actions"><button class="btn ghost sm" disabled=${busy || note === (r.note || '')} onClick=${() => patch({ note }, 'Note saved')}>Save note</button></div>

      <h4 class="section-label mono">Log</h4>
      <${LogViewer} text=${data.log} />

      ${summary && html`
        <details class="summary-box">
          <summary class="mono">App state when sent</summary>
          <pre class="err-view">${JSON.stringify(summary, null, 2)}</pre>
        </details>`}

      <div class="row-actions danger-zone">
        ${confirm
          ? html`<button class="btn ghost sm danger" onClick=${remove}>Delete for good</button><button class="link-btn" onClick=${() => setConfirm(false)}>Keep</button>`
          : html`<button class="link-btn" onClick=${() => setConfirm(true)}>Delete this report</button>`}
      </div>
    </div>`;
}

function ReportsSection({ onToast, reloadOverview }) {
  const [status, setStatus] = useState('new');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);
  // Only the newest request may fill the list; an older, slower answer is dropped.
  const latest = useRef(0);
  const load = () => {
    const n = ++latest.current;
    return call('reports', { status, kind, q, limit: 100 })
      .then((d) => { if (n === latest.current) setList(d.reports); })
      .catch((err) => onToast({ kind: 'error', title: 'Could not load reports', text: errText(err) }));
  };
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [status, kind, q]);
  // Rows change in place: a report opened from the New list stays there until the list is reloaded.
  const patched = (r) => {
    setList((l) => l && l.map((x) => (x.id === r.id ? { ...x, status: r.status, replied: r.reply ? 1 : 0 } : x)));
    reloadOverview();
  };
  const deleted = (rid) => {
    setList((l) => l && l.filter((x) => x.id !== rid));
    setSelected(null);
    reloadOverview();
  };
  return html`
    <div class="admin-filters">
      ${STATUS.map(([id, label]) => html`<button class="chip ${status === id ? 'on' : ''}" key=${id} onClick=${() => setStatus(id)}>${label}</button>`)}
      <span class="sep" />
      ${[['all', 'Everything'], ['report', 'Reports'], ['crash', 'Crashes']].map(([id, label]) => html`<button class="chip ${kind === id ? 'on' : ''}" key=${id} onClick=${() => setKind(id)}>${label}</button>`)}
      <label class="search slim grow"><${Icon} name="search" size=${13} /><input placeholder="Search text, contact, Twitch name or id" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} spellcheck="false" /></label>
    </div>
    <div class="admin-split">
      <div class="report-list">
        ${!list && html`<div class="empty-line">Loading</div>`}
        ${list && !list.length && html`<div class="empty-line">Nothing here.</div>`}
        ${list && list.map((r) => {
          const accounts = parse(r.accounts, null);
          return html`
            <button class="report-row ${selected === r.id ? 'on' : ''} ${r.status}" key=${r.id} onClick=${() => setSelected(r.id)}>
              <span class="kind ${r.kind}">${r.kind === 'crash' ? 'Crash' : 'Report'}</span>
              <span class="report-main">
                <span class="report-text">${r.description || (r.error || '').split('\n')[0] || 'No description'}</span>
                <span class="report-meta mono">${r.version || '?'} · ${ago(r.created_at)}${r.country ? ` · ${r.country}` : ''}${accounts && accounts.length ? ` · ${accounts.join(', ')}` : r.contact ? ` · ${r.contact}` : ''}</span>
              </span>
              ${r.replied ? html`<span class="replied" data-tip="Replied"><${Icon} name="send" size=${13} /></span>` : null}
              ${r.status === 'new' && html`<i class="new-dot" />`}
            </button>`;
        })}
      </div>
      ${selected
        ? html`<${ReportDetail} id=${selected} key=${selected} onPatched=${patched} onDeleted=${deleted} onToast=${onToast} />`
        : html`<div class="detail"><div class="pane-empty"><${Icon} name="gift" size=${26} /><p>Pick a report on the left.</p></div></div>`}
    </div>`;
}

// ---- installs ----

function InstallsSection({ onToast }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    call('installs').then((d) => setList(d.installs)).catch((err) => onToast({ kind: 'error', title: 'Could not load installs', text: errText(err) }));
  }, []);
  if (!list) return html`<div class="empty-line">Loading</div>`;
  return html`
    <table class="stat-table">
      <thead><tr><th>Install</th><th>Version</th><th class="num">Accounts</th><th>System</th><th>Country</th><th>First seen</th><th>Last seen</th><th class="num">Reports</th></tr></thead>
      <tbody>
        ${list.map((i) => html`
          <tr key=${i.id}>
            <td class="mono" data-tip=${i.id}>${i.id.slice(0, 8)}</td>
            <td class="mono">${i.version || '?'}</td>
            <td class="num mono">${i.accounts == null ? '?' : i.accounts}</td>
            <td class="mono small">${i.platform || '?'}</td>
            <td>${i.country || '?'}</td>
            <td>${ago(i.first_seen)}</td>
            <td>${ago(i.last_seen)}</td>
            <td class="num mono">${i.reports}</td>
          </tr>`)}
      </tbody>
    </table>`;
}

// ---- notice ----

function NoticeSection({ onToast }) {
  const [current, setCurrent] = useState(undefined);
  const [text, setText] = useState('');
  const [level, setLevel] = useState('info');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call('notice').then((d) => {
      setCurrent(d.notice);
      if (d.notice) {
        setText(d.notice.text);
        setLevel(d.notice.level);
      }
    }).catch((err) => onToast({ kind: 'error', title: 'Could not load the notice', text: errText(err) }));
  }, []);
  const save = async (clear) => {
    setBusy(true);
    try {
      const d = await call('setNotice', { text: clear ? '' : text, level });
      setCurrent(d.notice);
      if (clear) setText('');
      onToast({ kind: 'info', title: clear ? 'Notice taken down' : 'Notice published', text: clear ? '' : 'Apps pick it up within 6 hours, or on their next start.' });
    } catch (err) {
      onToast({ kind: 'error', title: 'Could not save the notice', text: errText(err) });
    }
    setBusy(false);
  };
  return html`
    <p class="page-lead">A banner at the top of every copy of Lurk. Good for "Twitch changed something, an update is on the way".</p>
    <div class="notice-edit">
      <textarea class="field" rows="3" maxlength="500" placeholder="What everyone should know" value=${text} onInput=${(e) => setText(e.currentTarget.value)} />
      <div class="row-actions">
        <button class="chip ${level === 'info' ? 'on' : ''}" onClick=${() => setLevel('info')}>Info</button>
        <button class="chip ${level === 'warn' ? 'on' : ''}" onClick=${() => setLevel('warn')}>Warning</button>
        <span class="grow" />
        ${current && html`<button class="btn ghost sm" disabled=${busy} onClick=${() => save(true)}>Take down</button>`}
        <button class="btn primary sm" disabled=${busy || !text.trim()} onClick=${() => save(false)}>${current ? 'Update' : 'Publish'}</button>
      </div>
      ${text.trim() && html`<div class="notice-preview"><div class="notice ${level}"><${Icon} name=${level === 'warn' ? 'clock' : 'bolt'} size=${15} /><span>${text}</span></div></div>`}
      ${current === null && html`<div class="row-note">No notice is up right now.</div>`}
      ${current && html`<div class="row-note">Live since ${ago(current.created_at)}.</div>`}
    </div>`;
}

export function AdminView({ onToast }) {
  const [section, setSection] = useState('reports');
  const [overview, setOverview] = useState(null);
  const loadOverview = () => call('overview').then(setOverview).catch((err) => onToast({ kind: 'error', title: 'Admin server', text: errText(err) }));
  useEffect(() => {
    loadOverview();
    const id = setInterval(loadOverview, 60000);
    return () => clearInterval(id);
  }, []);
  return html`
    <div class="page admin">
      <div class="page-head">
        <h2>Admin</h2>
        <span class="page-sub mono">Only this copy can open this</span>
        <span class="grow" />
        <button class="btn ghost sm" onClick=${loadOverview}><${Icon} name="refresh" size=${13} /> Refresh</button>
      </div>
      <${Overview} data=${overview} />
      <div class="admin-tabs">
        ${[['reports', 'Reports'], ['installs', 'Installs'], ['notice', 'Announcement']].map(([id, label]) => html`<button class="tab-pill ${section === id ? 'on' : ''}" key=${id} onClick=${() => setSection(id)}>${label}</button>`)}
      </div>
      ${section === 'reports' && html`<${ReportsSection} onToast=${onToast} reloadOverview=${loadOverview} />`}
      ${section === 'installs' && html`<${InstallsSection} onToast=${onToast} />`}
      ${section === 'notice' && html`<${NoticeSection} onToast=${onToast} />`}
    </div>`;
}
