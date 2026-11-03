'use strict';
// Games installed through Steam and Epic, read from their local files, so
// Lurk can star the games you own.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const read = (file) => {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
};

function regValue(key, value) {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const m = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`).exec(out);
      resolve(m ? m[1].trim() : null);
    });
  });
}

async function steamGames() {
  const roots = new Set(['C:\\Program Files (x86)\\Steam']);
  const fromReg = await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (fromReg) roots.add(path.normalize(fromReg));
  const libraries = new Set();
  for (const root of roots) {
    const vdf = read(path.join(root, 'steamapps', 'libraryfolders.vdf'));
    if (!vdf) continue;
    libraries.add(root);
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
  }
  const names = [];
  for (const lib of libraries) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(dir); } catch {}
    for (const f of files) {
      if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
      const m = /"name"\s+"([^"]+)"/.exec(read(path.join(dir, f)) || '');
      if (m) names.push(m[1]);
    }
  }
  return names;
}

function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = fs.readdirSync(dir); } catch {}
  const names = [];
  for (const f of files) {
    if (!f.endsWith('.item')) continue;
    try {
      const j = JSON.parse(read(path.join(dir, f)) || '{}');
      if (j.DisplayName) names.push(j.DisplayName);
    } catch {}
  }
  return names;
}

async function scan() {
  const [steam, epic] = await Promise.all([steamGames(), Promise.resolve(epicGames())]);
  return [...new Set([...steam, ...epic])];
}

const normalize = (name) => name
  .toLowerCase()
  .replace(/[™®©]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

// Steam often adds a sequel number Twitch drops ("Overwatch 2" vs "Overwatch").
const withoutNumber = (n) => n.replace(/\s+\d+$/, '');

// Twitch games (id + name) that match an owned game.
function match(owned, games) {
  const mine = new Set();
  for (const name of owned) {
    const n = normalize(name);
    mine.add(n);
    mine.add(withoutNumber(n));
  }
  return games.filter((g) => {
    const n = normalize(g.name);
    return n.length > 1 && (mine.has(n) || mine.has(withoutNumber(n)));
  });
}

module.exports = { scan, match };
