// Uploads the built installer to the lurk-releases R2 bucket, where installed
// copies of Lurk look for updates. latest.yml goes last, so no client ever sees
// a version whose installer isn't there yet.
//   npm run dist && npm run release
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BUCKET = 'lurk-releases';
// The Cloudflare account comes from the environment or the untracked keys.local.json.
const local = (() => { try { return require(path.join(__dirname, '..', 'keys.local.json')); } catch { return {}; } })();
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || local.cloudflareAccountId;
if (!ACCOUNT) throw new Error('Set CLOUDFLARE_ACCOUNT_ID or cloudflareAccountId in keys.local.json');
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const TYPES = {
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.blockmap': 'application/octet-stream',
  '.yml': 'text/yaml',
};

const exe = `Lurk-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'];
for (const f of files) {
  if (!fs.existsSync(path.join(dist, f))) throw new Error(`dist/${f} is missing. Run npm run dist first.`);
}
const latest = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
if (!latest.includes(`version: ${version}`)) throw new Error(`dist/latest.yml is not for ${version}. Rebuild first.`);

const put = (key, file, extra = []) => {
  console.log(`uploading ${key}`);
  execFileSync(process.execPath, [
    wrangler, 'r2', 'object', 'put', `${BUCKET}/${key}`,
    '--file', path.join(dist, file),
    '--remote',
    '--content-type', TYPES[path.extname(file)] || 'application/octet-stream',
    ...extra,
  ], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
};

put(exe, exe);
put(`${exe}.blockmap`, `${exe}.blockmap`);
// A stable name for the README's download link.
put('Lurk-Setup.exe', exe, ['--cache-control', 'no-cache']);
put('latest.yml', 'latest.yml', ['--cache-control', 'no-cache']);
console.log(`Lurk ${version} is live.`);
