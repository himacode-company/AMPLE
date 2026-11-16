'use strict';
// PHP extensions: "ample ext" lists them, "ample ext intl on|off" switches one, for EVERY PHP
// version (ample.json "phpExtensions"). The active version's ext\ folder says what exists.
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const settings = require('./settings');
const phpini = require('./phpini');
const { log } = require('./logger');

// Managed elsewhere: opcache (always on when present), xdebug ("ample xdebug"). Not listed either:
// dl_test / zend_test, which only exist for PHP's own internal tests.
const MANAGED = new Set(['opcache', 'xdebug', 'dl_test', 'zend_test']);
const norm = (e) => String(e).trim().replace(/^php_/i, '').replace(/\.dll$/i, '').toLowerCase();

// Every extension of the active PHP: { name, enabled, default, ok, reason }
function list() {
  const config = require('./config');
  const version = config.activePhp();
  const dir = path.join(P.phpRoot, version, 'ext');
  const s = settings.load();
  const wanted = new Set(phpini.wantedExtensions(version, s));
  const present = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^php_.+\.dll$/i.test(f)).map(norm).filter((e) => !MANAGED.has(e))
    : [];
  // Only the enabled ones are test-loaded (cached per version by phpini).
  const loads = phpini.detectExtensions(version, [...wanted].filter((e) => present.includes(e)));
  const out = present.map((name) => {
    const enabled = wanted.has(name);
    const r = enabled ? loads[name] || { ok: false, reason: 'not checked' } : null;
    return { name, enabled, default: phpini.DEFAULT_EXTENSIONS.includes(name), ok: enabled ? !!r.ok : null, reason: r && !r.ok ? r.reason : null };
  });
  return { version, extensions: out.sort((a, b) => a.name.localeCompare(b.name)) };
}

// Turn one extension on or off for every PHP version; Apache restarts if it runs.
async function set(ext, on) {
  const name = norm(ext);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`"${ext}" is not an extension name`);
  if (MANAGED.has(name)) throw new Error(name === 'xdebug' ? 'Use: ample xdebug on|off' : 'opcache is managed by AMPLE');
  const { extensions } = list();
  if (!extensions.some((e) => e.name === name)) throw new Error(`There is no extension "${name}" in this PHP (see: ample ext)`);

  const s = settings.load();
  const enable = new Set((s.phpExtensions.enable || []).map(norm));
  const disable = new Set((s.phpExtensions.disable || []).map(norm));
  if (on) { disable.delete(name); if (!phpini.DEFAULT_EXTENSIONS.includes(name)) enable.add(name); } else { enable.delete(name); disable.add(name); }
  s.phpExtensions = { enable: [...enable], disable: [...disable] };
  settings.save(s);

  const services = require('./services');
  const gen = require('./config').generate();
  const skipped = gen.skippedExtensions.find((x) => norm(x.ext) === name);
  if ((await services.status('apache')).running) await services.restart('apache');
  log('PHP', 'EXT', `${name} ${on ? 'enabled' : 'disabled'}${skipped ? ` (does not load: ${skipped.reason})` : ''}`);
  return { name, on: !!on, loads: on ? !skipped : null, reason: skipped ? skipped.reason : null };
}

module.exports = { list, set, MANAGED };
