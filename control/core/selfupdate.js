'use strict';
// AMPLE's own updates. The newest AMPLE is announced in a small file on AMPLE's website:
//
//   https://ample.himacode.com/download/latest.json
//   { "version": "1.1.0", "url": "https://ample.himacode.com/download/AMPLE-Setup-1.1.exe",
//     "sha256": "…64 hex…", "size": 110300000, "notes": { "en": "…", "ar": "…" } }
//
// (control\tools\build-setup.js writes it next to the setup file.) The control panel downloads that
// setup, checks its size and SHA-256, and runs it; AMPLE Setup then closes the panel, stops the
// services safely, updates, and starts them again. Only a setup file on ample.himacode.com/download/
// is ever accepted, whatever the JSON says.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const P = require('./paths');
const V = require('./version');

const MANIFEST_URL = 'https://ample.himacode.com/download/latest.json';
const ALLOWED_URL = /^https:\/\/ample\.himacode\.com\/download\/AMPLE-Setup-\d+(\.\d+){0,3}\.exe$/;

const text = (v) => (typeof v === 'string' ? v.trim().slice(0, 600) : '');

// The announcement, checked field by field (anything odd is refused).
async function latest() {
  const res = await fetch(MANIFEST_URL, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`could not read ${MANIFEST_URL} (HTTP ${res.status})`);
  const j = await res.json();
  const version = String(j.version || '');
  if (!/^\d+(\.\d+){1,3}$/.test(version)) throw new Error('latest.json: bad version');
  if (!ALLOWED_URL.test(String(j.url || ''))) throw new Error('latest.json: the setup must be on ample.himacode.com/download/');
  if (!/^[a-f0-9]{64}$/i.test(String(j.sha256 || ''))) throw new Error('latest.json: bad sha256');
  const size = Number(j.size);
  if (!Number.isFinite(size) || size < 1e6 || size > 2e9) throw new Error('latest.json: bad size');
  const notes = j.notes && typeof j.notes === 'object' ? { en: text(j.notes.en), ar: text(j.notes.ar) || text(j.notes.en) } : null;
  return { version, url: j.url, sha256: j.sha256.toLowerCase(), size, notes: notes && (notes.en || notes.ar) ? notes : null };
}

// { current, latest, newer, manifest }
async function check() {
  const current = V.full() || '0.0.0';
  const m = await latest();
  return { current, latest: m.version, newer: V.compare(m.version, current) > 0, manifest: m };
}

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
});

// Download the setup to tmp\downloads (resumes nothing: a bad or partial file is deleted).
async function download(m, progress = () => {}) {
  if (!ALLOWED_URL.test(m.url)) throw new Error('Refused: not an AMPLE setup on ample.himacode.com');
  fs.mkdirSync(P.downloads, { recursive: true });
  const dest = path.join(P.downloads, path.basename(new URL(m.url).pathname));
  if (fs.existsSync(dest) && fs.statSync(dest).size === m.size && (await sha256(dest)) === m.sha256) return dest;
  const part = dest + '.part';
  const res = await fetch(m.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const out = fs.createWriteStream(part);
  let got = 0, last = -1;
  try {
    for await (const chunk of res.body) {
      got += chunk.length;
      if (got > m.size) throw new Error('The download is bigger than announced');
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const pct = Math.floor((got / m.size) * 100);
      if (pct !== last) { last = pct; progress(pct, got, m.size); }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e; }
  if (got !== m.size) { fs.rmSync(part, { force: true }); throw new Error('The download is incomplete'); }
  if ((await sha256(part)) !== m.sha256) { fs.rmSync(part, { force: true }); throw new Error('The download does not match its SHA-256: not running it'); }
  fs.rmSync(dest, { force: true });
  fs.renameSync(part, dest);
  return dest;
}

// Run the setup on its own; it shows its update screen.
function launch(file) {
  spawn(file, [], { cwd: path.dirname(file), detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

module.exports = { MANIFEST_URL, latest, check, download, launch };
