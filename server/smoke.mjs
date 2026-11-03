// End-to-end check of the live report server. Uses a throwaway install and
// deletes everything it creates.
//   NODE_USE_ENV_PROXY=1 node server/smoke.mjs
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';

const { api, adminKey } = JSON.parse(readFileSync(new URL('../keys.local.json', import.meta.url)));
const install = { installId: `smoke-${randomUUID()}`, installSecret: randomBytes(16).toString('hex') };
let failed = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ` (${extra})` : ''}`);
  if (!ok) failed++;
};
const call = async (path, { method = 'GET', body, key, secret } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (secret) headers['x-install-secret'] = secret;
  const res = await fetch(api + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

const report = { ...install, kind: 'report', version: '0.0.0-smoke', platform: 'smoke', accounts: 2, description: 'Smoke test report', contact: 'smoke', logs: 'line one\nline two\n' };
let r = await call('/v1/reports', { method: 'POST', body: report });
check(r.status === 200 && r.data.id, 'send a report', r.status);
const id = r.data && r.data.id;

r = await call('/v1/reports', { method: 'POST', body: { ...report, installSecret: 'wrong-secret-0000000' } });
check(r.status === 403, 'another secret for the same install is refused', r.status);

r = await call('/v1/reports', { method: 'POST', body: { ...install, kind: 'report', description: '   ' } });
check(r.status === 400, 'an empty description is refused', r.status);

r = await call('/v1/reports', { method: 'POST', body: { ...install, kind: 'report', description: 'x', logs: 'y'.repeat(3.2 * 1024 * 1024) } });
check(r.status === 413, 'an oversized report is refused', r.status);

r = await call('/v1/admin/overview', { key: 'wrong' });
check(r.status === 401, 'a wrong admin key is refused', r.status);

r = await call('/v1/admin/overview', { key: adminKey });
check(r.status === 200 && r.data.installs && r.data.installs.total >= 1, 'admin overview', r.status);

r = await call(`/v1/admin/reports?q=${install.installId}`, { key: adminKey });
check(r.status === 200 && r.data.reports.length === 1, 'admin finds the report', r.data && r.data.reports && r.data.reports.length);

r = await call(`/v1/admin/reports/${id}`, { key: adminKey });
check(r.status === 200 && r.data.log === report.logs, 'admin reads the report with its log');

r = await call(`/v1/admin/reports/${id}`, { method: 'PATCH', key: adminKey, body: { status: 'fixed', reply: 'Thanks, fixed in the next version.' } });
check(r.status === 200 && r.data.report.status === 'fixed' && r.data.report.replied_at, 'admin replies and marks it fixed');

r = await call(`/v1/inbox?install=${install.installId}`, { secret: install.installSecret });
check(r.status === 200 && r.data.reports[0].reply === 'Thanks, fixed in the next version.', 'the reporter sees the reply');

r = await call(`/v1/inbox?install=${install.installId}`, { secret: 'nope-nope-nope-nope' });
check(r.status === 403, 'nobody else can read that inbox', r.status);

r = await call('/v1/admin/notice', { method: 'PUT', key: adminKey, body: { text: 'Smoke notice', level: 'info' } });
check(r.status === 200 && r.data.notice.text === 'Smoke notice', 'admin sets a notice');
r = await call('/v1/ping', { method: 'POST', body: { ...install, version: '0.0.0-smoke', accounts: 2 } });
check(r.status === 200 && r.data.notice && r.data.notice.text === 'Smoke notice', 'apps get the notice with their ping');
r = await call('/v1/admin/notice', { method: 'PUT', key: adminKey, body: { text: '' } });
check(r.status === 200 && r.data.notice === null, 'admin clears the notice');

r = await call(`/v1/admin/reports/${id}`, { method: 'DELETE', key: adminKey });
check(r.status === 200, 'admin deletes the report');
r = await call(`/v1/admin/reports/${id}`, { key: adminKey });
check(r.status === 404, 'the report is gone');

console.log(failed ? `${failed} failed` : 'all good');
process.exit(failed ? 1 : 0);
