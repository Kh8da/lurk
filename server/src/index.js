// Lurk report server: bug and crash reports from the app, anonymous install
// pings, replies back to reporters, an announcement banner, and the admin API
// behind the app's Admin tab.

const MAX_BODY = 3 * 1024 * 1024;
const PER_DAY = { report: 10, crash: 20 }; // per install
const KEEP_REPORTS_DAYS = 180;
const KEEP_INSTALLS_DAYS = 365;
const DAY = 86400e3;
const ID_RE = /^[A-Za-z0-9-]{16,64}$/;
const STATUSES = ['new', 'seen', 'fixed', 'ignored'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
const fail = (status, message) => json({ error: message }, status);
const now = () => Date.now();
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const country = (request) => (request.cf && request.cf.country) || null;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares hashes of both sides so the time taken says nothing about the key.
async function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new HttpError(413, 'Too large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

// Install identity, trusted on first use: the first request from an install
// fixes its secret, later ones must bring the same secret.
async function touchInstall(env, request, body) {
  if (!ID_RE.test(body.installId || '') || typeof body.installSecret !== 'string' || body.installSecret.length < 16) {
    throw new HttpError(400, 'Bad install');
  }
  const secretHash = await sha256(body.installSecret);
  const row = await env.DB.prepare('SELECT secret_hash FROM installs WHERE id = ?').bind(body.installId).first();
  if (row && row.secret_hash && row.secret_hash !== secretHash) throw new HttpError(403, 'Unknown install');
  await env.DB.prepare(
    `INSERT INTO installs (id, secret_hash, first_seen, last_seen, version, platform, accounts, country)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET last_seen = ?3, version = COALESCE(?4, version), platform = COALESCE(?5, platform),
       accounts = COALESCE(?6, accounts), country = COALESCE(?7, country), secret_hash = COALESCE(secret_hash, ?2)`,
  ).bind(
    body.installId, secretHash, now(), str(body.version, 32), str(body.platform, 80),
    Number.isInteger(body.accounts) ? Math.min(body.accounts, 1000) : null, country(request),
  ).run();
}

async function getNotice(env) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'notice'").first();
  return row ? JSON.parse(row.value) : null;
}

// ---- public ----

async function postReport(env, request) {
  const body = await readJson(request);
  const kind = body.kind === 'crash' ? 'crash' : 'report';
  await touchInstall(env, request, body);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE install_id = ? AND kind = ? AND created_at > ?')
    .bind(body.installId, kind, now() - DAY).first();
  if (n >= PER_DAY[kind]) return fail(429, 'Too many reports today, try again tomorrow');
  const description = str(body.description, 5000);
  if (kind === 'report' && !(description && description.trim())) return fail(400, 'Describe what went wrong');
  const id = crypto.randomUUID();
  const log = str(body.logs, MAX_BODY);
  if (log) await env.LOGS.put(`reports/${id}.log`, log, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  const accounts = Array.isArray(body.accounts) ? JSON.stringify(body.accounts.slice(0, 20).map((a) => String(a).slice(0, 40))) : null;
  await env.DB.prepare(
    `INSERT INTO reports (id, created_at, kind, install_id, version, platform, description, contact, accounts, summary, error, has_log, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, now(), kind, body.installId, str(body.version, 32), str(body.platform, 80), description, str(body.contact, 200),
    accounts, body.summary ? JSON.stringify(body.summary).slice(0, 20000) : null, str(body.error, 20000), log ? 1 : 0, country(request),
  ).run();
  return json({ id });
}

async function postPing(env, request) {
  await touchInstall(env, request, await readJson(request));
  return json({ notice: await getNotice(env) });
}

// A reporter's own reports with the admin's replies, for the app to show.
async function getInbox(env, request, url) {
  const id = url.searchParams.get('install') || '';
  if (!ID_RE.test(id)) return fail(400, 'Bad install');
  const row = await env.DB.prepare('SELECT secret_hash FROM installs WHERE id = ?').bind(id).first();
  if (!row || row.secret_hash !== await sha256(request.headers.get('x-install-secret') || '')) return fail(403, 'Unknown install');
  const { results } = await env.DB.prepare(
    "SELECT id, created_at, description, status, reply, replied_at FROM reports WHERE install_id = ? AND kind = 'report' ORDER BY created_at DESC LIMIT 20",
  ).bind(id).all();
  return json({ reports: results.map((r) => ({ ...r, description: (r.description || '').slice(0, 300) })) });
}

// ---- admin ----

async function overview(env) {
  const t = now();
  const installs = await env.DB.prepare(
    'SELECT SUM(last_seen > ?1) AS d1, SUM(last_seen > ?2) AS d7, SUM(last_seen > ?3) AS d30, COUNT(*) AS total, SUM(CASE WHEN last_seen > ?3 THEN accounts ELSE 0 END) AS accounts FROM installs',
  ).bind(t - DAY, t - 7 * DAY, t - 30 * DAY).first();
  const versions = await env.DB.prepare('SELECT version, COUNT(*) AS n FROM installs WHERE last_seen > ? GROUP BY version ORDER BY n DESC LIMIT 10')
    .bind(t - 30 * DAY).all();
  const reports = await env.DB.prepare(
    "SELECT SUM(status = 'new') AS fresh, COUNT(*) AS total, SUM(kind = 'crash' AND created_at > ?1) AS crashes7, SUM(kind = 'report' AND created_at > ?1) AS reports7 FROM reports",
  ).bind(t - 7 * DAY).first();
  const days = await env.DB.prepare('SELECT CAST(created_at / 86400000 AS INTEGER) AS day, kind, COUNT(*) AS n FROM reports WHERE created_at > ? GROUP BY day, kind')
    .bind(t - 14 * DAY).all();
  return json({ installs, versions: versions.results, reports, days: days.results });
}

async function listReports(env, url) {
  const status = url.searchParams.get('status') || 'all';
  const kind = url.searchParams.get('kind') || 'all';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const where = [];
  const args = [];
  if (STATUSES.includes(status)) { where.push('status = ?'); args.push(status); }
  if (kind === 'report' || kind === 'crash') { where.push('kind = ?'); args.push(kind); }
  if (q) {
    where.push('(id LIKE ? OR install_id LIKE ? OR description LIKE ? OR contact LIKE ? OR accounts LIKE ? OR error LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    args.push(like, like, like, like, like, like);
  }
  const sql = `SELECT id, created_at, kind, install_id, version, platform, substr(description, 1, 200) AS description, contact, accounts,
    status, reply IS NOT NULL AS replied, country, substr(error, 1, 200) AS error, has_log
    FROM reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...args, limit, offset).all();
  return json({ reports: results });
}

async function getReport(env, id) {
  const r = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!r) return fail(404, 'No such report');
  let log = null;
  if (r.has_log) {
    const obj = await env.LOGS.get(`reports/${id}.log`);
    if (obj) log = await obj.text();
  }
  const install = await env.DB.prepare(
    'SELECT first_seen, last_seen, version, accounts, (SELECT COUNT(*) FROM reports WHERE install_id = ?1) AS reports FROM installs WHERE id = ?1',
  ).bind(r.install_id).first();
  return json({ report: r, log, install });
}

async function patchReport(env, request, id) {
  const body = await readJson(request);
  const r = await env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(id).first();
  if (!r) return fail(404, 'No such report');
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return fail(400, 'Bad status');
    await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind(body.status, id).run();
  }
  if (body.note !== undefined) await env.DB.prepare('UPDATE reports SET note = ? WHERE id = ?').bind(str(body.note, 5000), id).run();
  if (body.reply !== undefined) {
    const reply = str(body.reply, 5000);
    await env.DB.prepare('UPDATE reports SET reply = ?, replied_at = ? WHERE id = ?').bind(reply || null, reply ? now() : null, id).run();
  }
  return getReport(env, id);
}

async function deleteReport(env, id) {
  await env.LOGS.delete(`reports/${id}.log`);
  await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function putNotice(env, request) {
  const body = await readJson(request);
  const text = str(body.text, 500);
  if (!text || !text.trim()) {
    await env.DB.prepare("DELETE FROM meta WHERE key = 'notice'").run();
    return json({ notice: null });
  }
  const notice = { id: crypto.randomUUID(), text: text.trim(), level: body.level === 'warn' ? 'warn' : 'info', created_at: now() };
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('notice', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1")
    .bind(JSON.stringify(notice)).run();
  return json({ notice });
}

async function listInstalls(env, url) {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
  const { results } = await env.DB.prepare(
    `SELECT id, first_seen, last_seen, version, platform, accounts, country,
      (SELECT COUNT(*) FROM reports r WHERE r.install_id = installs.id) AS reports
     FROM installs ORDER BY last_seen DESC LIMIT ?`,
  ).bind(limit).all();
  return json({ installs: results });
}

async function admin(env, request, url, parts) {
  const auth = request.headers.get('authorization') || '';
  if (!(await sameSecret(auth.startsWith('Bearer ') ? auth.slice(7) : '', env.ADMIN_KEY))) return fail(401, 'Wrong admin key');
  const [what, id] = [parts[3], parts[4]];
  const m = request.method;
  if (id && !ID_RE.test(id)) return fail(400, 'Bad id');
  if (what === 'overview' && m === 'GET') return overview(env);
  if (what === 'reports' && !id && m === 'GET') return listReports(env, url);
  if (what === 'reports' && id && m === 'GET') return getReport(env, id);
  if (what === 'reports' && id && m === 'PATCH') return patchReport(env, request, id);
  if (what === 'reports' && id && m === 'DELETE') return deleteReport(env, id);
  if (what === 'notice' && m === 'GET') return json({ notice: await getNotice(env) });
  if (what === 'notice' && m === 'PUT') return putNotice(env, request);
  if (what === 'installs' && m === 'GET') return listInstalls(env, url);
  return fail(404, 'Not found');
}

// ---- entry ----

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    try {
      if (request.method === 'POST' && url.pathname === '/v1/reports') return await postReport(env, request);
      if (request.method === 'POST' && url.pathname === '/v1/ping') return await postPing(env, request);
      if (request.method === 'GET' && url.pathname === '/v1/inbox') return await getInbox(env, request, url);
      if (request.method === 'GET' && url.pathname === '/v1/notice') return json({ notice: await getNotice(env) });
      if (parts[1] === 'v1' && parts[2] === 'admin') return await admin(env, request, url, parts);
      if (url.pathname === '/') return new Response('Lurk', { headers: { 'content-type': 'text/plain' } });
      return fail(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      console.error(err);
      return fail(500, 'Server error');
    }
  },

  // Daily clean-up: old reports (and their logs) and installs gone quiet.
  async scheduled(_event, env) {
    const old = now() - KEEP_REPORTS_DAYS * DAY;
    const { results } = await env.DB.prepare('SELECT id FROM reports WHERE created_at < ? AND has_log = 1').bind(old).all();
    for (const r of results) await env.LOGS.delete(`reports/${r.id}.log`);
    await env.DB.prepare('DELETE FROM reports WHERE created_at < ?').bind(old).run();
    await env.DB.prepare('DELETE FROM installs WHERE last_seen < ?').bind(now() - KEEP_INSTALLS_DAYS * DAY).run();
  },
};
