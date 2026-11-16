'use strict';
// AMPLE control panel: the worker process (plain Node, started by main.js). It runs AMPLE's
// own core (control\core, the same code as the "ample" command line). Only the methods listed
// in METHODS can be called; anything else is refused.
const services = require('../core/services');
const config = require('../core/config');
const settings = require('../core/settings');

const busy = new Set(); // services with a start / stop / restart in progress
const PHP_INI_KEYS = ['memory_limit', 'upload_max_filesize', 'post_max_size', 'max_execution_time'];

// Progress of a long task, sent to the window as it happens:
// { kind: 'update' | 'backup' | 'rescue', text } or { kind: 'import', pct, read, total }
const progress = (p) => process.parentPort.postMessage({ event: 'progress', ...p });

function checkName(name) {
  if (!services.ORDER.includes(name)) throw new Error('Unknown service: ' + name);
}

// The ports a service uses, in the order people know them (Mailpit: SMTP, then the web UI).
function portsOf(name, s) {
  const svc = services.SERVICES[name];
  if (name === 'mailpit') return [s.ports.smtp, s.ports.mailpit];
  return [svc.port(s), ...(svc.extraPorts ? svc.extraPorts(s) : [])];
}

// Log Doctor's explanation, as plain data (it can then travel to the window).
function plainDiagnosis(d) {
  if (!d) return null;
  return {
    title: d.title || '', summary: d.summary || '', details: d.details || '', where: d.where || '',
    causes: Array.isArray(d.causes) ? d.causes.map(String) : [],
    steps: Array.isArray(d.steps) ? d.steps.map(String) : [],
  };
}

// Start / stop / restart one service. Never throws: the window gets { ok, message, diagnosis }.
async function act(name, fn) {
  checkName(name);
  if (busy.has(name)) return { ok: false, message: 'Already working on ' + name };
  busy.add(name);
  try {
    await fn(name);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message, diagnosis: plainDiagnosis(e.diagnosis) };
  } finally {
    busy.delete(name);
  }
}

// Is AMPLE's bin folder in the user PATH, and which other PHP could run instead?
function pathInfo() {
  try {
    const st = require('../core/shell').pathStatus();
    return {
      added: !!st.added,
      otherPhp: st.otherPhp.map(String),
      system: st.systemConflicts.map((c) => `${c.dir}\\${c.exe}`),
    };
  } catch (e) {
    return { added: false, otherPhp: [], system: [], error: e.message };
  }
}

// ---- Log Doctor -----------------------------------------------------------------------------
// The panel's own last scan, kept here. "Fix" sends back only (scanId, n): the fix itself
// (what to change, which value) always comes from this list, never from the page.
let lastScan = { id: 0, list: [] };
const DOCTOR_HOURS = [24, 72, 168];

function plainProblem(g) {
  return {
    n: g.n, level: g.level, source: g.source, service: g.service || null, resolved: !!g.resolved,
    title: g.title || '', summary: g.summary || '', details: g.details || '', where: g.where || '',
    causes: (g.causes || []).map(String), steps: (g.steps || []).map(String),
    fixLabel: g.action ? String(g.action.label || '') : null,
    count: g.count || 1, first: +new Date(g.first), last: +new Date(g.last),
    raw: (g.raw || []).slice(0, 20).map(String),
  };
}

const METHODS = {
  // Every service (running? answering? ports, pid) + the active PHP version.
  async status() {
    const s = settings.load();
    const list = [];
    for (const name of services.ORDER) {
      const st = await services.status(name);
      list.push({ ...st, ports: portsOf(name, s), busy: busy.has(name) });
    }
    let php = null;
    try { php = config.activePhp(); } catch { /* no PHP installed yet */ }
    return { services: list, php, ample: require('../core/version').short(require('../core/version').full()) };
  },

  // How many problems Log Doctor finds in the last 24 hours (solved ones not counted).
  // save:false keeps the numbering of "ample doctor" untouched.
  async problems() {
    const list = require('../core/doctor').scan({ hours: 24, save: false });
    return list.filter((d) => !d.resolved).length;
  },

  // Every problem of the last 24 h / 3 days / 7 days, solved ones included (marked), the
  // minor notices (404s...) left out, as on "ample doctor".
  async doctor(hours) {
    const h = DOCTOR_HOURS.includes(Number(hours)) ? Number(hours) : 24;
    const doc = require('../core/doctor');
    const list = doc.scan({ hours: h, all: true, save: false }).filter((g) => g.level !== 'notice');
    lastScan = { id: lastScan.id + 1, list };
    return { scanId: lastScan.id, hours: h, lang: doc.language(), problems: list.map(plainProblem) };
  },

  async doctorFix(scanId, n) {
    const lang = require('../core/doctor').language();
    if (scanId !== lastScan.id) {
      return { ok: false, text: lang === 'ar' ? 'تغيّرت القائمة. افتح المشكلة من جديد ثم أعد المحاولة.' : 'The list has changed. Open the problem again and retry.' };
    }
    const item = lastScan.list.find((g) => g.n === Number(n));
    if (!item || !item.action) return { ok: false, text: lang === 'ar' ? 'لا يوجد حل تلقائي لهذه المشكلة.' : 'This problem has no automatic fix.' };
    try {
      const r = await require('../core/doctor/actions').run(item.action);
      return { ok: !!r.ok, text: r.message[lang] || r.message.en };
    } catch (e) {
      return { ok: false, text: e.message };
    }
  },

  // Empty every log file (they stay in place; Apache / MariaDB can keep running).
  async clearLogs() {
    const r = require('../core/logs').clear();
    return { files: r.done.length, failed: r.failed.map((f) => f.file), freedKb: Math.round(r.freed / 1024) };
  },

  // ---- Settings ------------------------------------------------------------------------------
  // withPath = false skips the PATH check (it asks PowerShell, ~1 s): used when the panel opens.
  async getSettings(withPath = true) {
    const s = settings.load();
    return { language: s.language, appearance: s.appearance, design: require('../core/design').get(), path: withPath ? pathInfo() : null };
  },
  async setLanguage(lang) {
    if (!['en', 'ar'].includes(lang)) throw new Error('Unknown language: ' + lang);
    settings.update({ language: lang });
    return lang;
  },
  // tool: phpmyadmin | mailpit, value: ample | original (checked again in core/design.js)
  async setDesign(tool, value) {
    if (!['phpmyadmin', 'mailpit'].includes(tool)) throw new Error('Unknown tool: ' + tool);
    const r = await require('../core/design').set(tool, value);
    return { design: r.design, restarted: r.restarted };
  },
  // php / composer / mysql in any terminal: AMPLE's bin folder in the user PATH (no admin).
  async setPath(on) {
    const sh = require('../core/shell');
    if (on === true) sh.pathAdd(); else if (on === false) sh.pathRemove(); else throw new Error('setPath expects true or false');
    return pathInfo();
  },

  // ---- Settings, part 2 ----------------------------------------------------------------------
  async getPorts() { return require('../core/portset').get(); },
  async setPorts(patch) {
    if (!patch || typeof patch !== 'object') throw new Error('setPorts expects { name: port }');
    return require('../core/portset').set(patch);
  },

  // New MariaDB password: every account of the user + ample.json + phpMyAdmin, together.
  async changePassword(password) {
    if (typeof password !== 'string' || password.length > 128) throw new Error('Invalid password');
    const hosts = await services.changePassword(password);
    return { accounts: hosts.length };
  },

  // "ample check": is this PC ready? Texts in the chosen language.
  async checkPc() {
    const lang = require('../core/doctor').language();
    const pick = (x) => (x ? (lang === 'ar' ? x.ar : x.en) : null);
    const list = await require('../core/check').run();
    return list.map((c) => ({
      id: String(c.id || ''), status: c.status, title: pick(c.title), detail: pick(c.detail), fix: pick(c.fix),
      canFix: c.id === 'defender' && c.status === 'info' && !!c.fix,
    }));
  },
  // Exclude the AMPLE folder from Defender (Windows asks for administrator).
  async fixDefender() { return { ok: !!require('../core/check').fixDefender() }; },

  // "ample update": what is newer at the official sources.
  async updatesCheck() {
    const lang = require('../core/doctor').language();
    const list = await require('../core/update').check();
    return list.map((r) => ({
      name: r.name, label: r.label || r.name, current: r.current || null, latest: r.latest || null,
      available: !!r.comp, error: r.error || null, note: r.note ? (lang === 'ar' ? r.note.ar : r.note.en) : null,
    }));
  },
  // AMPLE itself: download the new AMPLE Setup (size + SHA-256 checked), then run it. Setup shows
  // its update screen and closes this panel when the visitor presses Update.
  async ampleUpdate() {
    const S = require('../core/selfupdate');
    const r = await S.check();
    if (!r.newer) throw new Error('AMPLE is already up to date');
    progress({ kind: 'update', text: `AMPLE ${r.latest}: downloading AMPLE Setup…` });
    let lastTen = -1;
    const file = await S.download(r.manifest, (pct) => {
      if (Math.floor(pct / 10) !== lastTen) { lastTen = Math.floor(pct / 10); progress({ kind: 'update', text: `  ${pct}%` }); }
    });
    progress({ kind: 'update', text: '  SHA-256 checked · opening AMPLE Setup' });
    S.launch(file);
    return { ok: true, version: r.latest };
  },
  // Update the named components (never Electron: the panel itself runs on it). Every step is
  // sent to the window as it happens.
  async updatesApply(names) {
    const allowed = ['apache', 'php', 'mariadb', 'phpmyadmin', 'mailpit', 'composer', 'cacert', 'xdebug', 'cloudflared'];
    const list = (Array.isArray(names) ? names : []).filter((n) => n === 'all' || allowed.includes(n));
    if (!list.length) throw new Error('Nothing to update');
    const wanted = list.includes('all') ? allowed : list;
    const res = await require('../core/update').apply(wanted, (text) => progress({ kind: 'update', text: String(text) }));
    return res.map((r) => ({
      name: r.name, ok: !!r.ok, from: r.from || null, to: r.to || null, skipped: r.skipped || null,
      kept: !!r.kept, rolledBack: !!r.rolledBack, sac: !!r.sac, error: r.error || null,
    }));
  },

  // ---- Sites -----------------------------------------------------------------------------------
  async sites() {
    const SI = require('../core/sites');
    const H = require('../core/https');
    const path = require('path');
    const s = settings.load();
    const { sites, skipped } = SI.list();
    let info = {};
    try { info = H.info(); } catch { /* shown as unknown */ }
    return {
      sites: sites.map((x) => ({
        name: x.name, url: x.url, httpsUrl: x.httpsUrl, framework: x.framework,
        dir: x.dir, web: path.relative(x.dir, x.docroot) || null,
      })),
      skipped: skipped.map((k) => ({ name: k.name, suggestion: k.suggestion || null })),
      own: SI.ownHosts().map((h) => ({ name: h.name, aliases: h.aliases, docroot: h.docroot, file: h.file, https: h.https })),
      pending: SI.pendingChanges(),
      apacheRunning: (await services.status('apache')).running,
      https: { on: !!s.https, port: s.ports.https, ca: !!info.ca, trusted: !!info.trusted, daysLeft: info.certDaysLeft || null },
    };
  },
  async siteCreate(name) { const x = require('../core/sites').create(name); return { name: x.name, url: x.url }; },
  async siteRename(from, to) { const x = require('../core/sites').rename(from, to); return { name: x.name, url: x.url }; },
  // New explicit hosts (e.g. Laravel's public\) only after Apache restarts.
  async sitesApply() {
    if ((await services.status('apache')).running) await services.restart('apache');
    else config.generate();
    return { ok: true };
  },
  // "ample https on|off"
  async httpsSet(on) {
    if (typeof on !== 'boolean') throw new Error('httpsSet expects true or false');
    if (on) require('../core/https').ensureCA();
    settings.update({ https: on });
    if ((await services.status('apache')).running) await services.restart('apache');
    else config.generate();
    return { on };
  },
  // Windows shows its own "install this certificate?" box (no administrator needed).
  async httpsTrust() { const r = require('../core/https').trust(); return { ok: !!(r.ok || r.already), already: !!r.already }; },
  async httpsUntrust() { return { ok: !!require('../core/https').untrust() }; },

  // ---- Databases ------------------------------------------------------------------------------
  async databases() {
    const D = require('../core/db');
    const s = settings.load();
    const comps = JSON.parse(require('fs').readFileSync(require('../core/paths').componentsFile, 'utf8'));
    const st = await services.status('mariadb');
    const base = { running: st.running && st.answering, version: comps.mariadb.version, port: s.ports.mysql, user: s.mysql.user, backups: D.listBackups() };
    if (!base.running) return { ...base, databases: [] };
    return { ...base, databases: D.details() };
  },
  async dbCreate(name) { return { name: require('../core/db').createDatabase(name) }; },

  // Back up the named databases (or every one) to backups\NAME-<date>.sql.gz.
  async dbBackup(names) {
    const D = require('../core/db');
    const path = require('path');
    const all = D.listDatabases();
    const list = names === 'all' ? all : (Array.isArray(names) ? names.filter((n) => all.includes(n)) : []);
    if (!list.length) throw new Error('No database to back up');
    const stamp = D.stamp();
    const done = [];
    for (const name of list) {
      progress({ kind: 'backup', text: name });
      const r = await D.exportDb(name, path.join(D.BACKUPS, `${name}-${stamp}.sql.gz`));
      done.push({ name, file: path.basename(r.file), bytes: r.bytes });
    }
    return { done };
  },

  // file: chosen in Windows' own "Open" box by main.js (never sent by the page).
  async dbImport(file, db) {
    const D = require('../core/db');
    if (db && !D.DB_NAME.test(db)) throw new Error(`"${db}" can't be a database name here: use letters, digits, _ and -`);
    const started = Date.now();
    await D.importFile(file, db || null, { onProgress: (pct, read, total) => progress({ kind: 'import', pct, read, total }) });
    return { seconds: Math.round((Date.now() - started) / 100) / 10 };
  },
  // Restore a backup by its file NAME in backups\ (dumps of "ample backup" name their database).
  async dbRestore(name) {
    const D = require('../core/db');
    const file = D.backupPath(name);
    const started = Date.now();
    await D.importFile(file, null, { onProgress: (pct, read, total) => progress({ kind: 'import', pct, read, total }) });
    return { seconds: Math.round((Date.now() - started) / 100) / 10 };
  },

  // MariaDB rescue mode (the same as "ample rescue --yes"); every step is shown as it happens.
  async rescue() {
    const path = require('path');
    const P = require('../core/paths');
    const r = await require('../core/rescue').rescue({ onStep: (text) => progress({ kind: 'rescue', text }) });
    return {
      ok: !!r.ok, message: r.message || null,
      broken: r.broken ? path.relative(P.ROOT, r.broken) : null, outDir: r.outDir ? path.relative(P.ROOT, r.outDir) : null,
      databases: (r.databases || []).map((d) => ({
        db: d.db, status: d.status, tablesBefore: d.tablesBefore || 0, tablesAfter: d.tablesAfter || 0,
        failedTables: (d.failedTables || []).map(String), importError: d.importError || null,
      })),
    };
  },

  // ---- PHP ---------------------------------------------------------------------------------
  async php() {
    const s = settings.load();
    const X = require('../core/xdebug');
    let xd = {};
    try { xd = X.status(); } catch { /* no PHP yet */ }
    const ini = {};
    for (const k of PHP_INI_KEYS) ini[k] = s.phpIni[k] != null ? String(s.phpIni[k]) : '';
    return {
      active: config.activePhp(), installed: config.listPhpVersions(), ini,
      xdebug: { enabled: !!xd.enabled, version: xd.installed ? xd.installed.version : null, port: xd.port || 9003 },
    };
  },
  async phpExtensions() { return require('../core/phpext').list(); },
  async phpAvailable() { return require('../core/download').availablePhp(); },

  // Switch PHP: the new version is made to match the current one, then Apache restarts.
  async phpUse(version) {
    if (!config.listPhpVersions().includes(version)) throw new Error(`PHP ${version} is not installed`);
    const { version: v, report } = await services.usePhp(version);
    return { version: v, report: report ? require('../core/phpcompare').format(report) : null };
  },
  // What differs between the active PHP and another one (changes nothing).
  async phpCompare(version) {
    if (!config.listPhpVersions().includes(version)) throw new Error(`PHP ${version} is not installed`);
    const active = config.activePhp();
    const cmp = require('../core/phpcompare');
    return { text: cmp.format(cmp.compare(active, version, { apply: false })) };
  },
  // Download a PHP line from windows.php.net (e.g. "8.4"); progress shown as it happens.
  async phpAdd(branch) {
    if (!/^\d+\.\d+$/.test(String(branch))) throw new Error('Expected a PHP line like 8.4');
    const v = await require('../core/download').installPhpVersion(branch, (text) => progress({ kind: 'php', text: String(text) }));
    return { version: v };
  },
  // The main php.ini settings, for EVERY PHP version.
  async phpIniSet(values) {
    const RULES = {
      memory_limit: /^(-1|\d+[KMG]?)$/i, upload_max_filesize: /^\d+[KMG]?$/i,
      post_max_size: /^\d+[KMG]?$/i, max_execution_time: /^\d+$/,
    };
    const patch = {};
    for (const [k, v] of Object.entries(values || {})) {
      if (!RULES[k]) throw new Error(`Unknown setting: ${k}`);
      const val = String(v).trim();
      if (!RULES[k].test(val)) throw new Error(`${k}: "${val}" is not a valid value`);
      patch[k] = val;
    }
    if (!Object.keys(patch).length) return { changed: 0 };
    settings.update({ phpIni: patch });
    require('../core/logger').log('PHP', 'INI', Object.entries(patch).map(([k, v]) => `${k} = ${v}`).join(', '));
    if ((await services.status('apache')).running) await services.restart('apache');
    else config.generate();
    return { changed: Object.keys(patch).length };
  },
  async phpExtSet(name, on) {
    if (typeof on !== 'boolean') throw new Error('phpExtSet expects true or false');
    return require('../core/phpext').set(name, on);
  },
  // Xdebug on / off (downloads the build that matches the active PHP).
  async xdebugSet(on) {
    if (typeof on !== 'boolean') throw new Error('xdebugSet expects true or false');
    const st = await require('../core/xdebug').setEnabled(on, (text) => progress({ kind: 'php', text: String(text) }));
    return { enabled: !!st.enabled, version: st.installed ? st.installed.version : null, port: st.port || 9003 };
  },

  // ---- Mail (Mailpit) --------------------------------------------------------------------------
  async mail() {
    const s = settings.load();
    const st = await services.status('mailpit');
    const base = { running: st.running && st.answering, smtp: s.ports.smtp };
    if (!base.running) return { ...base, total: 0, unread: 0, messages: [] };
    return { ...base, ...(await require('../core/mail').list(20)) };
  },
  async mailTest() { return require('../core/mail').sendTest(); },
  async mailClear() { await require('../core/mail').clear(); return { ok: true }; },

  // ---- Import from XAMPP (copies only: the XAMPP folder is never written) ------------------
  async xamppInventory() {
    const XM = require('../core/xampp');
    if (!settings.load().xamppPath) { const d = XM.detect(); if (d) XM.usePath(d.root); }
    return XM.inventory();
  },
  // folder: chosen in Windows' own folder box by main.js (never sent by the page).
  async xamppSetPath(folder) { require('../core/xampp').usePath(folder); return require('../core/xampp').inventory(); },
  // dbs: names to import (must exist in XAMPP); projects: also copy XAMPP's htdocs projects.
  async xamppImport(dbs, projects, password) {
    const XM = require('../core/xampp');
    const inv = XM.inventory();
    if (!inv.found) throw new Error('XAMPP was not found');
    const names = (Array.isArray(dbs) ? dbs : []).filter((n) => inv.databases.some((d) => d.name === n));
    const onStep = (text) => progress({ kind: 'xampp', text: String(text) });
    const out = { databases: null, projects: null };
    if (names.length) {
      try {
        const r = await XM.importDatabases(names, { yes: true, password: typeof password === 'string' ? password : '', onStep });
        out.databases = {
          results: r.results.map((x) => ({ db: x.db, status: x.status, error: x.error || null, tablesBefore: x.tablesBefore || 0, tablesAfter: x.tablesAfter || 0 })),
          users: r.users.map((u) => ({ user: u.user, host: u.host, status: u.status })),
        };
      } catch (e) {
        if (e.code === 'XAMPP_PASSWORD') return { needPassword: true };
        throw e;
      }
    }
    if (projects === true) {
      const r = XM.importProjects([], { yes: true, onStep });
      out.projects = r.plan.filter((p) => p.type === 'folder').map((p) => ({ name: p.name, copied: !p.exists }));
    }
    return out;
  },

  // ---- Share (public link through Cloudflare) -----------------------------------------------
  async shareStatus() { return require('../core/share').status(); },
  async shareInstall() {
    await require('../core/share').install((text) => progress({ kind: 'share', text: String(text) }));
    return { installed: require('../core/share').installed() };
  },
  async shareStart(site, password) {
    if (typeof site !== 'string') throw new Error('Expected a site name');
    return require('../core/share').start(site, { password: typeof password === 'string' && password ? password : null });
  },
  async shareStop() { return require('../core/share').stop(); },

  start: (name) => act(name, services.start),
  stop: (name) => act(name, services.stop),
  restart: (name) => act(name, services.restart),

  // All services, one after the other; one failing does not stop the others.
  async startAll() {
    const results = {};
    for (const name of services.ORDER) results[name] = await act(name, services.start);
    return { results };
  },
  async stopAll() {
    const results = {};
    for (const name of [...services.ORDER].reverse()) results[name] = await act(name, services.stop);
    return { results };
  },
};

process.parentPort.on('message', async (e) => {
  const { id, method, args = [] } = e.data || {};
  try {
    if (!Object.prototype.hasOwnProperty.call(METHODS, method)) throw new Error('Unknown request: ' + method);
    const result = await METHODS[method](...args);
    process.parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    process.parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
