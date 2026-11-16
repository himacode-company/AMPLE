'use strict';
// php.ini for each PHP version: build it, validate it against what that
// version really supports, and keep the user's manual edits.
//
// Per-version cache lives in php\<ver>\.ample\ :
//   extensions.json      which extensions load on this machine
//   directives.json      every php.ini setting this version knows
//   last-generated.ini   copy of the last php.ini AMPLE wrote (to spot manual edits)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./paths');
const settings = require('./settings');
const { log } = require('./logger');

// AMPLE's default extensions (enabled when they load on this machine).
const DEFAULT_EXTENSIONS = [
  'bz2', 'curl', 'exif', 'fileinfo', 'ftp', 'gd', 'gettext', 'gmp', 'intl', 'mbstring',
  'mysqli', 'openssl', 'pdo_mysql', 'pdo_sqlite', 'soap', 'sockets', 'sodium', 'sqlite3',
  'xsl', 'zip',
];

// Settings tied to one PHP folder; never copied between versions or imported.
const VERSION_BOUND = new Set(['extension_dir', 'include_path']);

// Settings that exist only when PHP runs inside Apache (mod_php), so the
// command-line PHP we query doesn't list them. Always treat them as known.
const APACHE_SAPI_DIRECTIVES = ['engine', 'xbithack', 'last_modified'];

const phpDirOf = (v) => path.join(P.phpRoot, v);
const cacheDir = (v) => path.join(phpDirOf(v), '.ample');
const lastGenerated = (v) => path.join(cacheDir(v), 'last-generated.ini');

function envFor(phpDir) {
  return { ...process.env, PATH: [phpDir, path.join(P.apache, 'bin'), process.env.PATH].join(';') };
}

function runPhp(version, args, timeout = 20000) {
  const dir = phpDirOf(version);
  return spawnSync(path.join(dir, 'php.exe'), args, { env: envFor(dir), encoding: 'utf8', timeout });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// "php_xsl.dll" / "xsl" / "XSL" -> "xsl"
const normExt = (e) => String(e).trim().replace(/^"|"$/g, '').replace(/^php_/i, '').replace(/\.dll$/i, '').toLowerCase();

// Value from an ini line, without quotes and trailing "; comment".
function iniValue(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  return s.replace(/\s*;.*$/, '').trim();
}

// Active settings + extensions of a php.ini text (comments ignored, last value wins).
function parseIni(text) {
  const directives = new Map();
  const extensions = new Set();
  const zend = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_.]+)\s*=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = iniValue(m[2]);
    if (key === 'extension') extensions.add(normExt(val));
    else if (key === 'zend_extension') zend.add(normExt(val));
    else directives.set(key, val);
  }
  return { directives, extensions, zend };
}

// Format a value for php.ini (quote anything that isn't a plain token).
const fmt = (v) => (/^[A-Za-z0-9_.+\-/:]*$/.test(String(v)) && String(v) !== '' ? String(v) : `"${String(v).replace(/"/g, '')}"`);

// ---------- what does this PHP version support? ---------------------------------

// Try loading each extension on its own (Smart App Control may block some DLLs).
function detectExtensions(version, wanted) {
  const dir = phpDirOf(version);
  const file = path.join(cacheDir(version), 'extensions.json');
  const cache = readJson(file, {});
  let dirty = false;
  for (const ext of wanted) {
    if (ext in cache) continue;
    if (!fs.existsSync(path.join(dir, 'ext', `php_${ext}.dll`))) {
      cache[ext] = { ok: false, reason: `not included in PHP ${version}` };
    } else {
      const r = runPhp(version, ['-n', '-d', `extension_dir=${path.join(dir, 'ext')}`, '-d', `extension=${ext}`,
        '-r', `echo extension_loaded('${ext}') ? 'OK' : 'NO';`], 15000);
      const ok = (r.stdout || '').trim().endsWith('OK');
      const out = ((r.stderr || '') + (r.stdout || '')).replace(/\s+/g, ' ').trim();
      cache[ext] = ok ? { ok: true } : {
        ok: false,
        reason: /Application Control|policy/i.test(out) ? 'blocked by Windows Smart App Control' : (out.slice(0, 200) || 'failed to load'),
      };
    }
    dirty = true;
  }
  if (dirty) writeJson(file, cache);
  return cache;
}

// Every php.ini setting this version knows, with the given extensions loaded
// (extension settings such as curl.cainfo only exist when curl is loaded).
// zendExts: Zend extensions to load as well (e.g. xdebug, whose xdebug.* settings
// only exist when it is loaded).
function knownDirectives(version, exts, zendExts = []) {
  const dir = phpDirOf(version);
  const key = [...exts].sort().join(',') + (zendExts.length ? `|zend:${zendExts.join(',')}` : '');
  const file = path.join(cacheDir(version), 'directives.json');
  const cache = readJson(file, {});
  if (cache.key === key && Array.isArray(cache.list)) return new Set([...cache.list, ...APACHE_SAPI_DIRECTIVES]);
  const args = ['-n', '-d', `extension_dir=${path.join(dir, 'ext')}`];
  for (const e of exts) args.push('-d', `extension=${e}`);
  if (fs.existsSync(path.join(dir, 'ext', 'php_opcache.dll'))) args.push('-d', 'zend_extension=opcache');
  for (const z of zendExts) args.push('-d', `zend_extension=${z}`);
  args.push('-r', 'echo json_encode(array_keys(ini_get_all()));');
  const r = runPhp(version, args);
  let list;
  try { list = JSON.parse((r.stdout || '').trim().split(/\r?\n/).pop()); } catch { return null; }
  writeJson(file, { key, list });
  return new Set([...list, ...APACHE_SAPI_DIRECTIVES]);
}

// Startup problems of a php.ini: deprecated settings, failed extensions, ...
function startupProblems(version, iniFile) {
  const r = runPhp(version, ['-c', iniFile, '-d', 'display_startup_errors=1', '-d', 'log_errors=0', '-r', 'echo "AMPLE_OK";']);
  const lines = ((r.stdout || '') + '\n' + (r.stderr || '')).split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && l !== 'AMPLE_OK' && !/^AMPLE_OK$/.test(l));
  const deprecated = new Set();
  for (const l of lines) {
    const m = l.match(/PHP Startup: (\S+) INI setting is deprecated/i);
    if (m) deprecated.add(m[1]);
  }
  return { deprecated, messages: lines.filter((l) => /Startup|Warning|Deprecated|Fatal/i.test(l)) };
}

// ---------- manual edits ----------------------------------------------------------

// If the user edited php\<ver>\php.ini by hand since AMPLE last wrote it, pull
// those edits into ample.json so they survive regeneration and carry over to
// other PHP versions. Returns a list of human-readable changes.
function importManualEdits(version) {
  const iniFile = path.join(phpDirOf(version), 'php.ini');
  const lastFile = lastGenerated(version);
  if (!fs.existsSync(iniFile) || !fs.existsSync(lastFile)) return [];
  const current = fs.readFileSync(iniFile, 'utf8');
  const last = fs.readFileSync(lastFile, 'utf8');
  if (current === last) return [];

  const now = parseIni(current);
  const was = parseIni(last);
  const s = settings.load();
  const ini = { ...s.phpIni };
  const en = new Set(s.phpExtensions.enable.map(normExt));
  const dis = new Set(s.phpExtensions.disable.map(normExt));
  const changes = [];

  for (const [k, v] of now.directives) {
    if (VERSION_BOUND.has(k) || was.directives.get(k) === v) continue;
    ini[k] = v;
    changes.push(`${k} = ${v}`);
  }
  for (const k of was.directives.keys()) {
    if (!now.directives.has(k) && k in ini) { delete ini[k]; changes.push(`${k} removed (back to default)`); }
  }
  for (const e of now.extensions) if (!was.extensions.has(e)) { en.add(e); dis.delete(e); changes.push(`extension ${e} enabled`); }
  for (const e of was.extensions) if (!now.extensions.has(e)) { dis.add(e); en.delete(e); changes.push(`extension ${e} disabled`); }

  if (changes.length) {
    s.phpIni = ini;
    s.phpExtensions = { enable: [...en], disable: [...dis] };
    settings.save(s);
    log('PHP', 'IMPORT', `kept your manual edits of php/${version}/php.ini -> ample.json: ${changes.join('; ')}`);
  }
  return changes;
}

// ---------- build ----------------------------------------------------------------

// Which extensions this version should load, from defaults + your settings.
function wantedExtensions(version, s) {
  const per = (s.phpVersions[version] || {}).extensions || {};
  const set = new Set([...DEFAULT_EXTENSIONS, ...(s.phpExtensions.enable || []), ...(per.enable || [])].map(normExt));
  for (const e of [...(s.phpExtensions.disable || []), ...(per.disable || [])]) set.delete(normExt(e));
  return [...set];
}

// The [xdebug] section: only when enabled (ample xdebug on) AND the DLL loads.
function xdebugBlock(version, s) {
  if (!s.xdebug) return { text: '; off - enable with: ample xdebug on', loaded: false };
  const dir = phpDirOf(version);
  if (!fs.existsSync(path.join(dir, 'ext', 'php_xdebug.dll'))) {
    return { text: `; enabled, but not downloaded for PHP ${version} yet - run: ample xdebug on`, loaded: false };
  }
  const r = runPhp(version, ['-n', '-d', `extension_dir=${path.join(dir, 'ext')}`, '-d', 'zend_extension=xdebug',
    '-r', "echo extension_loaded('xdebug') ? 'OK' : 'NO';"], 15000);
  if (!(r.stdout || '').trim().endsWith('OK')) {
    const why = ((r.stderr || '') + (r.stdout || '')).replace(/\s+/g, ' ').trim().slice(0, 160) || 'failed to load';
    return { text: `; zend_extension=xdebug    ; skipped: ${why}`, loaded: false };
  }
  return {
    loaded: true,
    text: [
      'zend_extension=xdebug',
      '; debug = step debugging (VS Code "PHP Debug" / PhpStorm), develop = clearer error pages',
      'xdebug.mode = debug,develop',
      'xdebug.start_with_request = yes',
      'xdebug.client_host = 127.0.0.1',
      'xdebug.client_port = 9003',
      '; 0 = quiet: no warning on every request when no debugger is listening',
      'xdebug.log_level = 0',
    ].join('\n'),
  };
}

// Build php.ini text for `version`. `render(tplName, vars)` comes from config.js.
function buildPhpIni(version, s, vars, render, { dropDirectives = new Set() } = {}) {
  const dir = phpDirOf(version);
  const wanted = wantedExtensions(version, s);
  const extReport = detectExtensions(version, wanted);
  const okExts = wanted.filter((e) => extReport[e].ok);

  const extLines = wanted.map((e) => (extReport[e].ok
    ? `extension=${e}`
    : `; extension=${e}    ; skipped: ${extReport[e].reason}`));
  // PHP < 8.5 ships OPcache as a separate DLL; 8.5+ has it built in.
  if (fs.existsSync(path.join(dir, 'ext', 'php_opcache.dll'))) extLines.push('zend_extension=opcache');

  const xd = xdebugBlock(version, s);
  const major = version.split('.')[0];
  const MARK = '%%AMPLE_USER_INI%%';
  let text = render('php.ini.tpl', {
    ...vars,
    PHP_VERSION: version,
    PHP_DIR: P.fwd(dir),
    PHP_EXTENSIONS: extLines.join('\n'),
    PHP_XDEBUG: xd.text,
    PHP_USER_INI: MARK,
    PHP_TS_DLL: `php${major}ts.dll`,
  });

  // Your values: global phpIni, then per-version fixes from the comparison.
  const overrides = { ...s.phpIni, ...((s.phpVersions[version] || {}).ini || {}) };
  const used = new Set();
  const known = knownDirectives(version, okExts, xd.loaded ? ['xdebug'] : []);
  const skipped = [];

  const lines = text.split(/\r?\n/).map((line) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_.]+)\s*=(.*)$/);
    if (!m || m[2] === 'extension' || m[2] === 'zend_extension') return line;
    const key = m[2];
    let out = line;
    if (key in overrides && !used.has(key)) {
      used.add(key);
      out = `${key} = ${fmt(overrides[key])}    ; ← ample.json`;
    }
    return checkLine(out, key);
  });

  function checkLine(line, key) {
    if (dropDirectives.has(key)) {
      skipped.push({ key, reason: `deprecated in PHP ${version}` });
      return `; ${line.trim()}    ; skipped: deprecated in PHP ${version}`;
    }
    if (known && !known.has(key)) {
      skipped.push({ key, reason: `PHP ${version} does not know this setting` });
      return `; ${line.trim()}    ; skipped: PHP ${version} does not know this setting`;
    }
    return line;
  }

  const extra = Object.entries(overrides)
    .filter(([k]) => !used.has(k) && !VERSION_BOUND.has(k))
    .map(([k, v]) => checkLine(`${k} = ${fmt(v)}`, k));
  text = lines.join('\n').replace(MARK, extra.length ? extra.join('\n') : '; (none)');

  return {
    text,
    extensions: extReport,
    skippedExtensions: wanted.filter((e) => !extReport[e].ok).map((e) => ({ ext: e, reason: extReport[e].reason })),
    skippedSettings: skipped,
  };
}

// Write php\<ver>\php.ini: import manual edits, build, drop deprecated settings.
function writePhpIni(version, vars, render) {
  const imported = importManualEdits(version);
  const s = settings.load();
  const iniFile = path.join(phpDirOf(version), 'php.ini');

  let built = buildPhpIni(version, s, vars, render);
  fs.writeFileSync(iniFile, built.text);
  const probs = startupProblems(version, iniFile);
  if (probs.deprecated.size) {
    built = buildPhpIni(version, s, vars, render, { dropDirectives: probs.deprecated });
    fs.writeFileSync(iniFile, built.text);
  }
  fs.mkdirSync(cacheDir(version), { recursive: true });
  fs.writeFileSync(lastGenerated(version), built.text);
  const after = probs.deprecated.size ? startupProblems(version, iniFile) : probs;
  return { ...built, imported, startupMessages: after.messages, iniFile };
}

module.exports = {
  DEFAULT_EXTENSIONS, VERSION_BOUND, envFor, runPhp, parseIni, normExt,
  detectExtensions, knownDirectives, startupProblems, importManualEdits,
  wantedExtensions, buildPhpIni, writePhpIni, phpDirOf,
};
