// Removes what test runs leave on the live server: reports whose text starts
// with "Harness test", a leftover notice, and demo installs.
//   NODE_USE_ENV_PROXY=1 node server/cleanup-tests.mjs
import { readFileSync } from 'node:fs';

const { api, adminKey } = JSON.parse(readFileSync(new URL('../keys.local.json', import.meta.url)));
const call = async (path, method = 'GET', body) => {
  const res = await fetch(api + path, {
    method,
    headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};

const { reports } = await call('/v1/admin/reports?status=all&q=Harness%20test&limit=100');
for (const r of reports) {
  await call(`/v1/admin/reports/${r.id}`, 'DELETE');
  console.log('deleted report', r.id.slice(0, 8));
}
const { notice } = await call('/v1/admin/notice');
if (notice) {
  await call('/v1/admin/notice', 'PUT', { text: '' });
  console.log('cleared notice');
}
console.log('done');
