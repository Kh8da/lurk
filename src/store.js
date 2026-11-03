'use strict';
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const file = (name) => path.join(app.getPath('userData'), name);

function write(name, data) {
  const f = file(name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', data);
  fs.renameSync(f + '.tmp', f);
}

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

function writeJson(name, data) {
  write(name, JSON.stringify(data, null, 2));
}

// Secrets are encrypted with the OS keychain (DPAPI on Windows) when available.
function readSecret(name) {
  try {
    const buf = fs.readFileSync(file(name));
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeSecret(name, data) {
  const text = JSON.stringify(data);
  write(name, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8'));
}

function remove(name) {
  try { fs.unlinkSync(file(name)); } catch {}
}

function exists(name) {
  return fs.existsSync(file(name));
}

function move(from, to) {
  fs.mkdirSync(path.dirname(file(to)), { recursive: true });
  fs.renameSync(file(from), file(to));
}

function removeDir(name) {
  fs.rmSync(file(name), { recursive: true, force: true });
}

// The same API, rooted in a subfolder (one per account).
function scoped(dir) {
  const at = (name) => `${dir}/${name}`;
  return {
    readJson: (name, fallback) => readJson(at(name), fallback),
    writeJson: (name, data) => writeJson(at(name), data),
    readSecret: (name) => readSecret(at(name)),
    writeSecret: (name, data) => writeSecret(at(name), data),
    remove: (name) => remove(at(name)),
  };
}

module.exports = { readJson, writeJson, readSecret, writeSecret, remove, exists, move, removeDir, scoped };
