'use strict';
// User settings live in one small JSON file: ample.json at the root.
const fs = require('fs');
const crypto = require('crypto');
const P = require('./paths');

const DEFAULTS = {
  language: null, // 'en' | 'ar' — Log Doctor & control panel; null = English (change in Settings)
  // share: Apache's private door for "ample share" (127.0.0.1 only; the public link points here)
  ports: { http: 80, https: 443, mysql: 3306, smtp: 1025, mailpit: 8025, share: 8099 },
  https: false, // ample https on: https://localhost and https://NAME.localhost
  php: null, // active PHP version; null = newest installed

  // Your PHP settings, by their real php.ini names. They apply to EVERY PHP
  // version, so switching versions keeps them. Edits you make by hand in
  // php\<ver>\php.ini are imported here automatically.
  phpIni: {
    memory_limit: '512M',
    upload_max_filesize: '512M',
    post_max_size: '512M',
    max_execution_time: '120',
  },
  // Extensions to enable/disable on top of AMPLE's default list, for every version.
  phpExtensions: { enable: [], disable: [] },
  // Per-version fixes, written by the PHP version comparison
  // (e.g. "on 8.9 keep 8.5's value of X"). Shape: { "8.9.0": { ini: {}, extensions: { enable: [] } } }
  phpVersions: {},

  // Look of the bundled tools: 'ample' = AMPLE's design (added by Apache, no vendor file
  // changed), 'original' = exactly as their makers ship them. Change with: ample design
  design: { phpmyadmin: 'ample', mailpit: 'ample' },
  // The control panel's light / dark mode: 'system' (follow Windows) | 'dark' | 'light'
  appearance: 'system',
  // The control panel itself (Electron):
  //   startWithWindows      open (hidden, next to the clock) when you sign in to Windows
  //   startServicesOnOpen   start Apache / MariaDB / Mailpit when the panel opens
  //   safeShutdown          stop MariaDB cleanly when Windows shuts down / signs out
  //   firstRunDone          the welcome screen has been completed
  panel: { startWithWindows: false, startServicesOnOpen: false, safeShutdown: true, firstRunDone: false, trayHintShown: false },

  xdebug: false, // step debugging for VS Code / PhpStorm (port 9003)
  mysql: { user: 'root', password: '' },
  mysqlGeneralLog: false,
  apacheLogLevel: 'warn',
  timezone: null, // null = taken from Windows
  pmaSecret: null,
  // Mailpit's web page / API ask for this login (made up by AMPLE on first use). Apache adds it
  // on http://localhost/mailpit/, so you never type it; a website trying to reach Mailpit's own
  // port through your browser (DNS rebinding) is refused.
  mailpitAuth: { user: 'ample', pass: null },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

// Older ample.json files used separate keys; move them into the new sections.
function migrate(saved) {
  let changed = false;
  const legacy = { phpMemoryLimit: 'memory_limit', phpMaxExecutionTime: 'max_execution_time' };
  for (const [oldKey, iniKey] of Object.entries(legacy)) {
    if (oldKey in saved) {
      saved.phpIni = { ...(saved.phpIni || {}), [iniKey]: String(saved[oldKey]) };
      delete saved[oldKey];
      changed = true;
    }
  }
  if ('phpUploadMax' in saved) {
    saved.phpIni = { ...(saved.phpIni || {}), upload_max_filesize: saved.phpUploadMax, post_max_size: saved.phpUploadMax };
    delete saved.phpUploadMax;
    changed = true;
  }
  if ('phpExtensionsExtra' in saved) {
    saved.phpExtensions = { enable: saved.phpExtensionsExtra, disable: [] };
    delete saved.phpExtensionsExtra;
    changed = true;
  }
  return changed;
}

function load() {
  let saved = {};
  const exists = fs.existsSync(P.settingsFile);
  if (exists) saved = JSON.parse(fs.readFileSync(P.settingsFile, 'utf8'));
  let changed = !exists || migrate(saved);
  const s = merge(DEFAULTS, saved);
  if (!s.pmaSecret) { s.pmaSecret = crypto.randomBytes(32).toString('hex'); changed = true; }
  if (!s.mailpitAuth.pass) { s.mailpitAuth = { user: 'ample', pass: crypto.randomBytes(24).toString('hex') }; changed = true; }
  if (!s.timezone) { s.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; changed = true; }
  if (!s.language) { s.language = 'en'; changed = true; }
  if (changed) save(s);
  return s;
}

function save(s) {
  fs.writeFileSync(P.settingsFile, JSON.stringify(s, null, 2) + '\n');
}

function update(patch) {
  const s = merge(load(), patch);
  save(s);
  return s;
}

module.exports = { load, save, update, merge, DEFAULTS };
