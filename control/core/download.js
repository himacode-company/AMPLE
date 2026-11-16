'use strict';
// Downloads + verifies + extracts the server components listed in components.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const P = require('./paths');

const UA = 'ample-setup/1.0';

async function fetchToFile(url, file, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(file);
  let got = 0;
  for await (const chunk of res.body) {
    got += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (onProgress) onProgress(got, total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

async function remoteSha(url) {
  for (const suffix of ['.sha256', '.sha256sum', '.txt']) {
    try {
      const r = await fetch(url + suffix, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      const m = (await r.text()).match(/\b[a-f0-9]{64}\b/i);
      if (m) return m[0].toLowerCase();
    } catch { /* ignore */ }
  }
  return null;
}

// Extract a zip into dest, removing a top-level folder prefix if given.
// `preserve` paths (your data, e.g. mariadb/data) are moved aside and put back,
// so upgrading a component never touches them. `prune` removes unneeded folders.
function extractZip(zip, dest, { stripPrefix, preserve = [], prune = [] } = {}) {
  const stamp = Date.now();
  const stage = path.join(P.tmp, 'extract-' + stamp);
  fs.mkdirSync(stage, { recursive: true });
  execFileSync('tar', ['-xf', zip, '-C', stage], { stdio: 'ignore' });
  const src = stripPrefix ? path.join(stage, stripPrefix) : stage;
  if (!fs.existsSync(src)) throw new Error(`Expected folder "${stripPrefix}" inside ${path.basename(zip)}`);

  const keep = path.join(P.tmp, 'keep-' + stamp);
  const kept = [];
  for (const rel of preserve) {
    const from = path.join(dest, rel);
    if (!fs.existsSync(from)) continue;
    const to = path.join(keep, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    kept.push(rel);
  }
  try {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    for (const rel of prune) fs.rmSync(path.join(dest, rel), { recursive: true, force: true });
    for (const rel of kept) {
      const back = path.join(dest, rel);
      fs.rmSync(back, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(back), { recursive: true });
      fs.renameSync(path.join(keep, rel), back);
    }
  } catch (e) {
    if (kept.length) e.message += `\nYour preserved data is safe in: ${keep}`;
    throw e;
  }
  fs.rmSync(keep, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });
}

// force: replace even if this version is already there (used by "ample update").
async function install(name, comp, log = console.log, { force = false } = {}) {
  const dest = P.p(comp.dest);
  if (comp.plainFile) {
    if (fs.existsSync(dest) && !force) { log(`✔ ${name} already installed`); return; }
    log(`↓ Downloading ${name} ...`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let last = 0;
    await fetchToFile(comp.url, dest + '.part', (g, t) => {
      const pct = t ? Math.floor((g / t) * 100) : 0;
      if (pct >= last + 10) { last = pct; log(`  ${name}: ${pct}%`); }
    });
    // The checksum written in components.json wins; else a published .sha256 next to the file.
    const expected = comp.sha256 || (await remoteSha(comp.url));
    if (expected && expected !== sha256(dest + '.part')) {
      fs.rmSync(dest + '.part', { force: true });
      throw new Error(`Checksum mismatch for ${name}`);
    }
    fs.renameSync(dest + '.part', dest);
    log(`✔ ${name} installed${expected ? ' (checksum OK)' : ''}`);
    return;
  }
  const marker = path.join(dest, '.ample-version');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === comp.version) {
    log(`✔ ${name} ${comp.version} already installed`);
    return;
  }
  fs.mkdirSync(P.downloads, { recursive: true });
  // Name + version in the cache name: some projects use the SAME file name for
  // every release (mailpit-windows-amd64.zip), which must never be mixed up.
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const base = path.basename(new URL(comp.url).pathname);
  const zip = path.join(P.downloads, base.includes(comp.version) ? base : `${slug}-${comp.version}-${base}`);
  if (!fs.existsSync(zip)) {
    log(`↓ Downloading ${name} ${comp.version} ...`);
    let last = 0;
    const urls = [comp.url, comp.archiveUrl].filter(Boolean);
    let ok = false, err;
    for (const u of urls) {
      try {
        await fetchToFile(u, zip + '.part', (g, t) => {
          const pct = t ? Math.floor((g / t) * 100) : 0;
          if (pct >= last + 10) { last = pct; log(`  ${name}: ${pct}%`); }
        });
        ok = true; break;
      } catch (e) { err = e; }
    }
    if (!ok) throw err;
    fs.renameSync(zip + '.part', zip);
  }
  const expected = comp.sha256 || (await remoteSha(comp.url));
  const actual = sha256(zip);
  if (expected && expected !== actual) {
    fs.rmSync(zip);
    throw new Error(`Checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
  }
  log(expected ? `  checksum OK (${actual.slice(0, 12)}…)` : `  ⚠ no published checksum; sha256=${actual}`);
  log(`  extracting to ${comp.dest}`);
  extractZip(zip, dest, comp);
  fs.writeFileSync(marker, comp.version);
  log(`✔ ${name} ${comp.version} installed`);
}

async function installAll(log = console.log) {
  const c = JSON.parse(fs.readFileSync(P.componentsFile, 'utf8'));
  await install('Apache', c.apache, log);
  for (const php of c.php) await install('PHP', php, log);
  await install('MariaDB', c.mariadb, log);
  await install('CA certificates', c.cacert, log);
  await install('Composer', c.composer, log);
  await install('Mailpit', c.mailpit, log);
  await install('phpMyAdmin', c.phpmyadmin, log);
  if (c.electron) {
    await install('Electron (control panel)', c.electron, log);
    require('./panel').prepare();
  }
}

// Fetch any PHP version straight from windows.php.net (e.g. "8.6.1" or "8.6").
async function installPhpVersion(want, log = console.log) {
  const rel = await (await fetch('https://windows.php.net/downloads/releases/releases.json', { headers: { 'User-Agent': UA } })).json();
  const branch = want.split('.').slice(0, 2).join('.');
  const b = rel[branch];
  if (!b) throw new Error(`PHP ${branch} not found on windows.php.net (available: ${Object.keys(rel).join(', ')})`);
  const key = Object.keys(b).find((k) => /^ts-vs\d+-x64$/.test(k));
  if (!key) throw new Error(`No Thread-Safe x64 build for PHP ${branch}`);
  const version = b.version.replace(/-\d+$/, '');
  const comp = {
    version,
    url: 'https://windows.php.net/downloads/releases/' + b[key].zip.path,
    // Older patch releases move to /archives/ when a new one comes out.
    archiveUrl: 'https://windows.php.net/downloads/releases/archives/' + b[key].zip.path,
    sha256: b[key].zip.sha256,
    stripPrefix: '',
    dest: `php/${version}`,
  };
  await install('PHP', comp, log);
  // Record it, so "ample setup" on another PC installs the same PHP versions.
  const all = JSON.parse(fs.readFileSync(P.componentsFile, 'utf8'));
  if (!all.php.some((p) => p.version === version)) {
    all.php.push(comp);
    fs.writeFileSync(P.componentsFile, JSON.stringify(all, null, 2) + '\n');
  }
  return version;
}

// PHP lines available on windows.php.net (Thread-Safe x64 builds): [{ branch, version }], newest first.
async function availablePhp() {
  const rel = await (await fetch('https://windows.php.net/downloads/releases/releases.json', { headers: { 'User-Agent': UA } })).json();
  return Object.entries(rel)
    .filter(([, b]) => b && b.version && Object.keys(b).some((k) => /^ts-vs\d+-x64$/.test(k)))
    .map(([branch, b]) => ({ branch, version: b.version.replace(/-\d+$/, '') }))
    .sort((a, b) => b.branch.localeCompare(a.branch, undefined, { numeric: true }));
}

module.exports = { installAll, installPhpVersion, install, availablePhp };
