'use strict';
// Import from XAMPP — without ever writing into the XAMPP folder.
//
//   scan       read-only inventory + Log Doctor report on XAMPP's logs
//   projects   COPY htdocs projects (never move); existing AMPLE folders are never overwritten
//   databases  copy mysql\data to a temp folder, run XAMPP's OWN MariaDB on that copy,
//              export every database (+ non-root users and their grants), import into AMPLE
//   php        list YOUR changes in XAMPP's php.ini; you pick what to carry over
//   vhosts     turn httpd-vhosts.conf entries into apache\conf\vhosts\*.conf
//   undo       remove everything that was imported (recorded in a manifest)
//
// Every step only shows a plan unless called with yes=true.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const P = require('./paths');
const settings = require('./settings');
const db = require('./db');
const { log } = require('./logger');

// Overridable for tests (a fake XAMPP) — the real default is C:\xampp.
const root = () => process.env.AMPLE_XAMPP || settings.load().xamppPath || 'C:\\xampp';
const mysqlBin = () => process.env.AMPLE_XAMPP_MYSQL_BIN || path.join(root(), 'mysql', 'bin');
const X = (...p) => path.join(root(), ...p);

// htdocs entries that belong to XAMPP itself, not to you.
const XAMPP_OWN = new Set(['dashboard', 'img', 'webalizer', 'xampp', 'forbidden', 'restricted',
  'index.php', 'index.html', 'applications.html', 'bitnami.css', 'favicon.ico']);
// Databases that are not yours.
const SYSTEM_DBS = new Set(['mysql', 'performance_schema', 'information_schema', 'phpmyadmin', 'test', 'sys']);
// php.ini settings tied to XAMPP's folders/services: never carried over.
const PHP_SKIP = new Set(['extension_dir', 'include_path', 'error_log', 'session.save_path', 'upload_tmp_dir',
  'sys_temp_dir', 'browscap', 'sendmail_path', 'sendmail_from', 'curl.cainfo', 'openssl.cafile', 'openssl.capath',
  'smtp', 'smtp_port', 'SMTP', 'mail.log', 'user_dir', 'doc_root', 'auto_prepend_file', 'auto_append_file']);

const TEMP_PORT = 3398;
const MANIFEST = path.join(P.ROOT, 'backups', 'xampp-import', 'manifest.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch {
    return { xampp: root(), projects: [], databases: [], users: [], vhosts: [], php: null };
  }
}
function writeManifest(m) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

function dirSize(dir) {
  let size = 0, files = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(f);
      else { try { size += fs.statSync(f).size; files++; } catch { /* locked file */ } }
    }
  };
  walk(dir);
  return { size, files };
}

// XAMPP programs running right now (by executable path).
function runningXampp() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '${root().replace(/'/g, "''")}\\*' } | ForEach-Object { $_.Name + '|' + $_.ProcessId }`],
  { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').split(/\r?\n/).filter(Boolean).map((l) => { const [name, pid] = l.split('|'); return { name, pid: Number(pid) }; });
}

function version(exe, args, re) {
  if (!fs.existsSync(exe)) return null;
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const m = ((r.stdout || '') + (r.stderr || '')).match(re);
  return m ? m[1] : null;
}

// ---- scan --------------------------------------------------------------------

function listProjects() {
  const htdocs = X('htdocs');
  if (!fs.existsSync(htdocs)) return { projects: [], files: [] };
  const projects = [], files = [];
  for (const e of fs.readdirSync(htdocs, { withFileTypes: true })) {
    if (XAMPP_OWN.has(e.name.toLowerCase())) continue;
    const src = path.join(htdocs, e.name);
    const dest = path.join(P.htdocs, e.name);
    if (e.isDirectory()) projects.push({ name: e.name, src, dest, exists: fs.existsSync(dest), ...dirSize(src) });
    else files.push({ name: e.name, src, dest, exists: fs.existsSync(dest), size: fs.statSync(src).size });
  }
  return { projects, files };
}

// MariaDB stores special characters of a database name in its folder name as @XXXX (hex):
// the folder "tech@002da" is the database "tech-da".
const dbNameOf = (folder) => folder.replace(/@([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

function listDatabases() {
  const data = X('mysql', 'data');
  if (!fs.existsSync(data)) return [];
  let ample = [];
  try { ample = db.listDatabases().map((d) => d.toLowerCase()); } catch { /* AMPLE MariaDB not running */ }
  return fs.readdirSync(data, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('#'))
    .map((e) => ({ name: dbNameOf(e.name), folder: e.name }))
    .filter((d) => !SYSTEM_DBS.has(d.name.toLowerCase()))
    .map((d) => ({ name: d.name, ...dirSize(path.join(data, d.folder)), existsInAmple: ample.includes(d.name.toLowerCase()) }));
}

function hostsFileNames() {
  try {
    const t = fs.readFileSync('C:\\Windows\\System32\\drivers\\etc\\hosts', 'utf8');
    return new Set(t.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
      .flatMap((l) => l.split(/\s+/).slice(1)).map((h) => h.toLowerCase()));
  } catch { return new Set(); }
}

function listVhosts() {
  const file = X('apache', 'conf', 'extra', 'httpd-vhosts.conf');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  const inHosts = hostsFileNames();
  const htdocs = path.resolve(X('htdocs')).toLowerCase();
  const out = [];
  for (const m of text.matchAll(/<VirtualHost\s+([^>]+)>([\s\S]*?)<\/VirtualHost>/gi)) {
    const body = m[2];
    const get = (k) => ((body.match(new RegExp(`^\\s*${k}\\s+"?([^"\\r\\n]+?)"?\\s*$`, 'im')) || [])[1] || null);
    const name = get('ServerName');
    const docroot = get('DocumentRoot');
    if (!name || !docroot) continue;
    const abs = path.resolve(docroot.replace(/\//g, '\\'));
    const isDefault = abs.toLowerCase() === htdocs;
    const ssl = /:443\b/.test(m[1]) || /SSLEngine\s+on/i.test(body);
    // A docroot inside XAMPP's htdocs points to the COPY in AMPLE's htdocs.
    const mapped = abs.toLowerCase().startsWith(htdocs + '\\') ? path.join(P.htdocs, abs.slice(htdocs.length + 1)) : abs;
    out.push({
      name: name.toLowerCase(), aliases: get('ServerAlias'), docroot: abs, ampleDocroot: mapped,
      inHostsFile: inHosts.has(name.toLowerCase()), skip: isDefault ? 'default localhost' : ssl ? 'HTTPS vhost (use ample https)' : null,
      exists: fs.existsSync(mapped),
    });
  }
  return out;
}

// Your php.ini changes = XAMPP's php.ini compared with php.ini-development next to it.
function phpChanges() {
  const phpini = require('./phpini');
  const ini = X('php', 'php.ini');
  const base = [X('php', 'php.ini-development'), X('php', 'php.ini-production')].find((f) => fs.existsSync(f));
  if (!fs.existsSync(ini) || !base) return { items: [], base: null };
  const now = phpini.parseIni(fs.readFileSync(ini, 'utf8'));
  const was = phpini.parseIni(fs.readFileSync(base, 'utf8'));
  const ampleExt = new Set(phpini.wantedExtensions(require('./config').activePhp(), settings.load()));
  const items = [];
  for (const [k, v] of now.directives) {
    if (PHP_SKIP.has(k) || k.startsWith('xdebug.') || was.directives.get(k) === v) continue;
    items.push({ kind: 'ini', key: k, value: v, base: was.directives.has(k) ? was.directives.get(k) : null });
  }
  for (const e of now.extensions) {
    if (!was.extensions.has(e) && !ampleExt.has(e)) items.push({ kind: 'ext', key: e });
  }
  items.forEach((x, i) => { x.n = i + 1; });
  return { items, base: path.basename(base) };
}

function doctorReport(lang) {
  const reader = require('./doctor/logreader');
  const doctor = require('./doctor');
  let entries = [];
  for (const [kind, f] of [['apache', X('apache', 'logs', 'error.log')], ['mariadb', X('mysql', 'data', 'mysql_error.log')]]) {
    if (!fs.existsSync(f)) continue;
    const t = reader.readTail(f, 2 * 1024 * 1024);
    entries = entries.concat(kind === 'mariadb' ? reader.parseMariadb(t) : reader.parseApache(t));
  }
  entries.sort((a, b) => a.time - b.time);
  return doctor.scan({ entries, lang, save: false, hours: 0 });
}

function scan({ lang } = {}) {
  if (!fs.existsSync(root())) throw new Error(`XAMPP not found at ${root()}. Set its folder with: ample xampp scan --path=D:\\xampp`);
  return {
    root: root(),
    versions: {
      apache: version(X('apache', 'bin', 'httpd.exe'), ['-v'], /Apache\/([\d.]+)/),
      php: version(X('php', 'php.exe'), ['-n', '-v'], /PHP ([\d.]+)/),
      mariadb: version(path.join(mysqlBin(), 'mysqld.exe'), ['--version'], /Ver ([\d.]+-MariaDB)/),
    },
    running: runningXampp(),
    ...listProjects(),
    databases: listDatabases(),
    vhosts: listVhosts(),
    php: phpChanges(),
    doctor: doctorReport(lang),
  };
}

// ---- where is XAMPP? (control panel / installer) ------------------------------------------

// A folder chosen by the user: XAMPP itself, its mysql folder, or its mysql\data folder.
// Returns { ok, root, data, reason }.
function check(folder) {
  let r = path.resolve(String(folder || ''));
  if (/[\\/]mysql[\\/]data[\\/]?$/i.test(r)) r = path.dirname(path.dirname(r));
  else if (/[\\/]mysql[\\/]?$/i.test(r)) r = path.dirname(r);
  const data = path.join(r, 'mysql', 'data');
  if (!fs.existsSync(data)) return { ok: false, root: r, data, reason: 'no mysql\\data folder here' };
  if (!fs.existsSync(path.join(r, 'mysql', 'bin', 'mysqld.exe'))) return { ok: false, root: r, data, reason: 'no mysql\\bin\\mysqld.exe (XAMPP\'s MySQL is needed to read its data)' };
  return { ok: true, root: r, data };
}

// The usual places, then the one saved last time.
function detect() {
  const tries = [settings.load().xamppPath, 'C:\\xampp', 'D:\\xampp', 'E:\\xampp'].filter(Boolean);
  for (const t of tries) { const c = check(t); if (c.ok) return c; }
  return null;
}

function usePath(folder) {
  const c = check(folder);
  if (!c.ok) throw new Error(`Not a XAMPP folder: ${c.root} (${c.reason})`);
  settings.update({ xamppPath: c.root });
  return c;
}

// Light inventory for the panel / installer: databases + projects, no log or php.ini reading.
function inventory() {
  const c = check(root());
  if (!c.ok) return { found: false, root: c.root, reason: c.reason };
  const { projects } = listProjects();
  return {
    found: true, root: c.root, data: c.data,
    mariadb: version(path.join(mysqlBin(), 'mysqld.exe'), ['--version'], /Ver ([\d.]+-MariaDB)/),
    mysqlRunning: runningXampp().some((p) => /^mysqld/i.test(p.name)),
    databases: listDatabases(),
    projects: projects.map((p) => ({ name: p.name, size: p.size, exists: p.exists })),
  };
}

// ---- projects ------------------------------------------------------------------

function importProjects(names = [], { yes = false, onStep = () => {} } = {}) {
  const { projects, files } = listProjects();
  const pick = (x) => !names.length || names.map((n) => n.toLowerCase()).includes(x.name.toLowerCase());
  const plan = [...projects.filter(pick).map((p) => ({ ...p, type: 'folder' })),
    ...(names.length ? [] : files.map((f) => ({ ...f, type: 'file' })))];
  for (const p of plan) p.action = p.exists ? 'skip: already exists in AMPLE htdocs' : 'copy';
  if (!yes) return { plan, done: false };

  const m = readManifest();
  for (const p of plan) {
    if (p.exists) continue;
    onStep(`copying ${p.name}`);
    fs.cpSync(p.src, p.dest, { recursive: true, errorOnExist: true, force: false });
    m.projects.push({ name: p.name, dest: p.dest, type: p.type, importedAt: new Date().toISOString() });
    writeManifest(m);
    log('XAMPP', 'IMPORT', `copied ${p.type} ${p.name} → htdocs\\${p.name}`);
  }
  writeManifest(m);
  return { plan, done: true };
}

// ---- databases -----------------------------------------------------------------

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function startXamppServer(dataDir, password, say) {
  const conn = { port: TEMP_PORT, user: 'root', password };
  const errLog = path.join(P.logs, 'mariadb', 'xampp-import.log');
  const tryStart = async (level) => {
    const args = ['--no-defaults', `--basedir=${path.dirname(mysqlBin())}`, `--datadir=${dataDir}`,
      `--port=${TEMP_PORT}`, '--bind-address=127.0.0.1', `--log-error=${errLog}`,
      `--pid-file=${path.join(P.run, 'xampp-import.pid')}`, '--max-allowed-packet=1G'];
    if (level) args.push(`--innodb-force-recovery=${level}`);
    const child = spawn(path.join(mysqlBin(), 'mysqld.exe'), args, { windowsHide: true, stdio: 'ignore', detached: true });
    let exited = false;
    child.once('exit', () => { exited = true; });
    child.unref();
    for (let i = 0; i < 60 && !exited; i++) {
      const r = spawnSync(path.join(P.mariadb, 'bin', 'mariadb-admin.exe'), [...db.connArgs(conn), '--connect-timeout=2', 'ping'],
        { encoding: 'utf8', env: db.connEnv(conn), timeout: 5000 });
      if (r.status === 0 || /Access denied/i.test(r.stderr || '')) return child;
      await sleep(500);
    }
    if (!exited) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return null;
  };
  for (let level = 0; level <= 6; level++) {
    say(level ? `XAMPP's MariaDB did not open the copy normally; retrying with recovery level ${level}` : 'starting XAMPP\'s MariaDB on the copy');
    const child = await tryStart(level);
    if (child) return { child, conn, level };
    if (level === 0) {
      // Damaged Aria logs (the classic XAMPP crash): move them aside in the COPY and retry.
      for (const f of fs.readdirSync(dataDir)) {
        if (f === 'aria_log_control' || /^aria_log\.\d+$/.test(f)) fs.rmSync(path.join(dataDir, f));
      }
    }
  }
  throw new Error('XAMPP\'s MariaDB could not open the copy of its data (see logs\\mariadb\\xampp-import.log).');
}

async function importDatabases(names = [], { yes = false, password = '', onStep = () => {} } = {}) {
  const services = require('./services');
  const all = listDatabases();
  const pick = all.filter((d) => !names.length || names.map((n) => n.toLowerCase()).includes(d.name.toLowerCase()));
  const plan = pick.map((d) => ({ ...d, action: d.existsInAmple ? 'skip: a database with this name already exists in AMPLE' : 'export + import' }));
  const xamppMysqlRunning = runningXampp().some((p) => /^mysqld/i.test(p.name));
  if (!yes) return { plan, done: false, xamppMysqlRunning };
  if (xamppMysqlRunning) {
    throw new Error('XAMPP\'s MySQL is running. Stop it in the XAMPP Control Panel first: copying a running database gives a damaged copy.');
  }
  if (!(await portFree(TEMP_PORT))) throw new Error(`Port ${TEMP_PORT} (temporary XAMPP server) is busy.`);
  if (!(await services.status('mariadb')).running) await services.start('mariadb');

  const say = (msg) => { log('XAMPP', 'DB', msg); onStep(msg); };
  const stamp = db.stamp();
  const copy = path.join(P.tmp, `xampp-data-${stamp}`);
  const outDir = path.join(P.ROOT, 'backups', `xampp-import-${stamp}`);
  say(`copying ${X('mysql', 'data')} → tmp (XAMPP's folder is only read)`);
  fs.cpSync(X('mysql', 'data'), copy, { recursive: true });

  const m = readManifest();
  const results = [];
  let server;
  try {
    server = await startXamppServer(copy, password, say);
    try { db.sql('SELECT 1', server.conn); } catch (e) {
      if (/Access denied/i.test(e.message)) {
        throw Object.assign(new Error('XAMPP\'s root user has a password. Run again with: --xampp-password=YOUR_PASSWORD'), { code: 'XAMPP_PASSWORD' });
      }
      throw e;
    }
    const before = {};
    for (const line of db.sql("SELECT table_schema, COUNT(*) FROM information_schema.tables WHERE table_type='BASE TABLE' GROUP BY table_schema", server.conn).split(/\r?\n/)) {
      const [s, n] = line.split('\t'); if (s) before[s.toLowerCase()] = Number(n);
    }
    // Databases
    for (const d of plan) {
      if (d.existsInAmple) { results.push({ db: d.name, status: 'skipped', reason: 'exists in AMPLE' }); continue; }
      say(`exporting ${d.name}`);
      const file = path.join(outDir, `${d.name}.sql`);
      const r = await db.exportDb(d.name, file, { conn: server.conn, force: true });
      say(`importing ${d.name}`);
      try {
        await db.importFile(file, null);
        m.databases.push(d.name);
        writeManifest(m); // record right away: undo must know even if a later step fails
        results.push({ db: d.name, status: 'imported', file, warnings: r.warnings, tablesBefore: before[d.name.toLowerCase()] || 0 });
      } catch (e) {
        results.push({ db: d.name, status: 'failed', error: e.message, file });
      }
    }
    const after = {};
    for (const line of db.sql("SELECT table_schema, COUNT(*) FROM information_schema.tables WHERE table_type='BASE TABLE' GROUP BY table_schema").split(/\r?\n/)) {
      const [s, n] = line.split('\t'); if (s) after[s.toLowerCase()] = Number(n);
    }
    for (const r of results) {
      if (r.status !== 'imported') continue;
      r.tablesAfter = after[r.db.toLowerCase()] || 0;
      if (r.tablesAfter < r.tablesBefore) r.status = 'partial';
    }

    // Users (not root/pma) with their exact password hashes and grants
    const users = [];
    const ampleUsers = new Set(db.sql("SELECT CONCAT(User,'@',Host) FROM mysql.user").split(/\r?\n/).map((s) => s.trim().toLowerCase()));
    // Two real columns: batch mode separates them with a TAB (a TAB inside one
    // CONCAT'ed value would be escaped to a literal "\t").
    // MariaDB's own internal accounts are not yours.
    const INTERNAL = new Set(['root', 'pma', '', 'mariadb.sys', 'mysql.sys', 'mysql.session', 'mysql.infoschema']);
    const list = db.sql('SELECT User, Host FROM mysql.user', server.conn)
      .split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')).filter(([u]) => !INTERNAL.has(u));
    for (const [user, host] of list) {
      const q = `'${user.replace(/'/g, "''")}'@'${host.replace(/'/g, "''")}'`;
      // AMPLE runs with skip-name-resolve, so a connection from 127.0.0.1 does NOT match
      // an account @'localhost' (XAMPP resolved it). PHP on Windows connects to
      // "localhost" through 127.0.0.1, so local accounts are created for all three
      // local addresses. Hostname-based accounts (e.g. @'MY-PC') become local too.
      const targets = host === '%' ? ['%'] : ['localhost', '127.0.0.1', '::1'];
      try {
        const create = db.sql(`SHOW CREATE USER ${q}`, server.conn).trim();
        const grants = db.sql(`SHOW GRANTS FOR ${q}`, server.conn).split(/\r?\n/).filter(Boolean);
        const hostRe = new RegExp(`@['\`]${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['\`]`, 'g');
        for (const target of targets) {
          if (ampleUsers.has(`${user}@${target}`.toLowerCase())) { users.push({ user, host: target, from: host, status: 'skipped (exists in AMPLE)' }); continue; }
          const fix = (s) => s.replace(hostRe, `@'${target}'`);
          db.sql([fix(create), ...grants.map(fix)].join(';\n'));
          m.users.push({ user, host: target });
          writeManifest(m);
          users.push({ user, host: target, from: host, status: 'imported' });
        }
      } catch (e) {
        users.push({ user, host, status: 'failed', error: e.message.split('\n')[0] });
      }
    }
    if (m.users.length) db.sql('FLUSH PRIVILEGES');
    writeManifest(m);
    return { plan, done: true, results, users, outDir, recoveryLevel: server.level };
  } finally {
    if (server) {
      spawnSync(path.join(P.mariadb, 'bin', 'mariadb-admin.exe'), [...db.connArgs(server.conn), 'shutdown'],
        { env: db.connEnv(server.conn), timeout: 30000, stdio: 'ignore' });
      for (let i = 0; i < 40; i++) { try { process.kill(server.child.pid, 0); await sleep(500); } catch { break; } }
      spawnSync('taskkill', ['/PID', String(server.child.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    fs.rmSync(copy, { recursive: true, force: true });
    say('temporary copy removed');
  }
}

// ---- php.ini -------------------------------------------------------------------

function importPhp(numbers = [], { yes = false } = {}) {
  const { items, base } = phpChanges();
  const chosen = numbers.length ? items.filter((x) => numbers.includes(x.n)) : [];
  if (!yes || !chosen.length) return { items, base, chosen, done: false };
  const s = settings.load();
  const m = readManifest();
  if (!m.php) m.php = { before: { phpIni: s.phpIni, phpExtensions: s.phpExtensions }, applied: [] };
  const ini = { ...s.phpIni };
  const enable = new Set(s.phpExtensions.enable);
  for (const x of chosen) {
    if (x.kind === 'ini') ini[x.key] = x.value; else enable.add(x.key);
    m.php.applied.push(x);
  }
  settings.update({ phpIni: ini, phpExtensions: { enable: [...enable], disable: s.phpExtensions.disable.filter((e) => !enable.has(e)) } });
  writeManifest(m);
  log('XAMPP', 'IMPORT', `php.ini: ${chosen.map((x) => (x.kind === 'ini' ? `${x.key} = ${x.value}` : `extension ${x.key}`)).join('; ')}`);
  return { items, base, chosen, done: true };
}

// ---- vhosts --------------------------------------------------------------------

function importVhosts({ yes = false } = {}) {
  const list = listVhosts();
  for (const v of list) {
    v.file = path.join(P.vhosts, `xampp-${v.name.replace(/[^a-z0-9.-]/gi, '_')}.conf`);
    v.localhostName = `${v.name.split('.')[0].replace(/[^a-z0-9-]/gi, '-')}.localhost`;
    if (!v.skip && fs.existsSync(v.file)) v.skip = 'already imported';
    if (!v.skip && !v.exists) v.skip = `folder not found: ${v.ampleDocroot} (import the project first?)`;
  }
  if (!yes) return { list, done: false };
  const m = readManifest();
  fs.mkdirSync(P.vhosts, { recursive: true });
  for (const v of list) {
    if (v.skip) continue;
    const port = settings.load().ports.http;
    const conf = [
      `# Imported from XAMPP (${X('apache', 'conf', 'extra', 'httpd-vhosts.conf')})`,
      v.inHostsFile ? `# ${v.name} is in your Windows hosts file, so it keeps working.` : `# ${v.name} is NOT in your hosts file; use http://${v.localhostName}/ instead.`,
      `<VirtualHost *:${port}>`,
      `    ServerName ${v.name}`,
      `    ServerAlias ${v.localhostName}${v.aliases ? ' ' + v.aliases : ''}`,
      `    DocumentRoot "${P.fwd(v.ampleDocroot)}"`,
      `    <Directory "${P.fwd(v.ampleDocroot)}">`,
      '        Options Indexes FollowSymLinks',
      '        AllowOverride All',
      '        Require local',
      '    </Directory>',
      '</VirtualHost>',
      '',
    ].join('\n');
    fs.writeFileSync(v.file, conf);
    m.vhosts.push(v.file);
    log('XAMPP', 'IMPORT', `vhost ${v.name} (+ ${v.localhostName}) → ${path.relative(P.ROOT, v.file)}`);
  }
  writeManifest(m);
  return { list, done: true };
}

// ---- undo ----------------------------------------------------------------------

function newestChange(dir) {
  let newest = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else try { newest = Math.max(newest, fs.statSync(f).mtimeMs); } catch { /* ignore */ }
    }
  };
  if (fs.statSync(dir).isDirectory()) walk(dir); else newest = fs.statSync(dir).mtimeMs;
  return newest;
}

function undo({ yes = false, force = false } = {}) {
  const m = readManifest();
  const plan = {
    projects: m.projects.filter((p) => fs.existsSync(p.dest)).map((p) => ({
      ...p, changed: newestChange(p.dest) > new Date(p.importedAt).getTime() + 5000,
    })),
    databases: m.databases, users: m.users, vhosts: m.vhosts.filter((f) => fs.existsSync(f)), php: m.php,
  };
  if (!yes) return { plan, done: false };
  const kept = [];
  for (const p of plan.projects) {
    if (p.changed && !force) { kept.push(p.name); continue; }
    fs.rmSync(p.dest, { recursive: true, force: true });
  }
  for (const d of plan.databases) { try { db.sql(`DROP DATABASE IF EXISTS \`${d.replace(/`/g, '``')}\``); } catch { /* already gone */ } }
  for (const u of plan.users) { try { db.sql(`DROP USER IF EXISTS '${u.user.replace(/'/g, "''")}'@'${u.host}'`); } catch { /* gone */ } }
  for (const f of plan.vhosts) fs.rmSync(f, { force: true });
  if (plan.php) {
    // Replace (not merge): merging would keep the imported keys.
    const s = settings.load();
    s.phpIni = plan.php.before.phpIni;
    s.phpExtensions = plan.php.before.phpExtensions;
    settings.save(s);
  }
  const rest = { ...m, projects: m.projects.filter((p) => kept.includes(p.name)), databases: [], users: [], vhosts: [], php: null };
  writeManifest(rest);
  log('XAMPP', 'UNDO', `removed imported items${kept.length ? `; kept changed projects: ${kept.join(', ')}` : ''}`);
  return { plan, done: true, kept };
}

module.exports = {
  scan, importProjects, importDatabases, importPhp, importVhosts, undo, root, MANIFEST,
  check, detect, usePath, inventory, SYSTEM_DBS,
};
