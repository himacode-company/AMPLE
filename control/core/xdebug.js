'use strict';
// Xdebug on/off. The right DLL for the active PHP (major.minor, Thread Safe, x64)
// is downloaded from xdebug.org and checked against the SHA-256 published there.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');
const settings = require('./settings');
const { log } = require('./logger');

const PAGES = ['https://xdebug.org/download', 'https://xdebug.org/download/historical'];
const UA = 'ample-setup/1.0';

const dllPath = (phpVersion) => path.join(P.phpRoot, phpVersion, 'ext', 'php_xdebug.dll');
const infoPath = (phpVersion) => path.join(P.phpRoot, phpVersion, '.ample', 'xdebug.json');

function installedInfo(phpVersion) {
  try { return JSON.parse(fs.readFileSync(infoPath(phpVersion), 'utf8')); } catch { return null; }
}

// Newest STABLE Xdebug build for this PHP version (major.minor, TS, x64).
async function find(phpVersion) {
  const mm = phpVersion.split('.').slice(0, 2).join('.');
  const re = new RegExp(`title="SHA256:(?:&nbsp;|\\s)*([a-f0-9]{64})"\\s+href=['"](/files/php_xdebug-([0-9.]+)-${mm.replace('.', '\\.')}-ts-vs(\\d+)-x86_64\\.dll)['"]`, 'gi');
  for (const page of PAGES) {
    const res = await fetch(page, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const html = await res.text();
    for (const m of html.matchAll(re)) {
      // ([0-9.]+) excludes alpha/beta/RC builds like 3.6.0alpha1.
      return { version: m[3], sha256: m[1].toLowerCase(), url: `https://xdebug.org${m[2]}`, vs: m[4] };
    }
  }
  return null;
}

// Make sure php\<ver>\ext\php_xdebug.dll exists (download + verify if needed).
async function ensure(phpVersion, say = () => {}) {
  if (fs.existsSync(dllPath(phpVersion)) && installedInfo(phpVersion)) return installedInfo(phpVersion);
  say(`looking for Xdebug for PHP ${phpVersion} on xdebug.org`);
  const rel = await find(phpVersion);
  if (!rel) throw new Error(`xdebug.org has no stable Thread-Safe x64 build for PHP ${phpVersion} yet.`);
  say(`downloading Xdebug ${rel.version}`);
  const res = await fetch(rel.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${rel.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual !== rel.sha256) throw new Error(`Checksum mismatch for Xdebug: expected ${rel.sha256}, got ${actual}`);
  fs.writeFileSync(dllPath(phpVersion), buf);
  fs.mkdirSync(path.dirname(infoPath(phpVersion)), { recursive: true });
  fs.writeFileSync(infoPath(phpVersion), JSON.stringify({ version: rel.version, sha256: rel.sha256, url: rel.url }, null, 2));
  // The directive cache depends on loaded extensions; Xdebug adds its own settings.
  fs.rmSync(path.join(P.phpRoot, phpVersion, '.ample', 'directives.json'), { force: true });
  log('Xdebug', 'INSTALL', `Xdebug ${rel.version} for PHP ${phpVersion} (checksum OK)`);
  return { version: rel.version, sha256: rel.sha256, url: rel.url };
}

async function setEnabled(on, say = () => {}) {
  const services = require('./services');
  const config = require('./config');
  const phpVersion = config.activePhp();
  if (on) await ensure(phpVersion, say);
  settings.update({ xdebug: on });
  log('Xdebug', on ? 'ON' : 'OFF', `Xdebug ${on ? 'enabled' : 'disabled'} for PHP ${phpVersion}`);
  if ((await services.status('apache')).running) await services.restart('apache');
  else config.generate();
  return status();
}

function status() {
  const config = require('./config');
  const phpVersion = config.activePhp();
  const s = settings.load();
  return { enabled: !!s.xdebug, phpVersion, installed: installedInfo(phpVersion), port: 9003 };
}

module.exports = { find, ensure, setEnabled, status, dllPath, installedInfo };
