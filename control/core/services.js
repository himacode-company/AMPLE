'use strict';
// Start / stop / status for Apache and MariaDB.
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const P = require('./paths');
const settings = require('./settings');
const config = require('./config');
const { log } = require('./logger');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pidFile = (name) => path.join(P.run, `${name}.ample.pid`);
const MAILPIT_AUTH_FILE = path.join(P.run, 'mailpit-ui.htpasswd');

// ---------- helpers ----------------------------------------------------------

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readPid(name) {
  try { return Number(fs.readFileSync(pidFile(name), 'utf8')) || null; } catch { return null; }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function portAnswers(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(800);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

// { pid, name, services, path, elevated, ample } of the program listening on `port`.
const whoUsesPort = (port) => require('./doctor/ports').inspect(port);

// The program file of each service, to recognise AMPLE's own copy on a busy port.
const OWN_EXE = {
  apache: () => path.join(P.apache, 'bin', 'httpd.exe'),
  mariadb: () => path.join(P.mariadb, 'bin', 'mariadbd.exe'),
  mailpit: () => path.join(P.p('mailpit'), 'mailpit.exe'),
};
const sameFile = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// Apache runs as a parent httpd.exe and a child that holds the port: climb to the top process of
// the same program, so stopping it does not just make the parent start a new child.
function topOfSame(pid, name) {
  const { parentOf } = require('./doctor/ports');
  let cur = pid;
  for (let i = 0; i < 4; i++) {
    const p = parentOf(cur);
    if (!p || p.name.toLowerCase() !== String(name).toLowerCase()) break;
    cur = p.pid;
  }
  return cur;
}

// A program started "as administrator" (e.g. by an older AMPLE Setup) cannot be stopped by a
// normal user: ask Windows once (the usual permission box) and stop it that way.
function elevatedKill(pid) {
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Start-Process -FilePath taskkill.exe -ArgumentList '/PID','${Number(pid)}','/T','/F' -Verb RunAs -Wait -WindowStyle Hidden`],
  { windowsHide: true, stdio: 'ignore' });
}

// After a failed start: the first known problem in the service's last log lines.
function diagnoseLog(name, text) {
  const reader = require('./doctor/logreader');
  const doctor = require('./doctor');
  const entries = (name === 'mariadb' ? reader.parseMariadb(text) : reader.parseApache(text))
    .filter((e) => e.level !== 'info');
  for (const e of entries.reverse()) {
    const d = doctor.diagnose(e);
    if (d.id) return d;
  }
  return null;
}

function tail(file, lines = 8) {
  try {
    const all = fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
    return all.slice(-lines).join('\n');
  } catch { return ''; }
}

function killTree(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

async function waitFor(check, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(300);
  }
  return false;
}

// ---------- service definitions ------------------------------------------------

// Run a MariaDB client tool (mariadb.exe, mariadb-admin.exe, mariadb-dump.exe)
// as the configured user. The password goes through the MYSQL_PWD environment
// variable, so it never appears in the process list like --password=... would.
function mariadbClient(tool, args, { timeout = 15000, password } = {}) {
  const s = settings.load();
  const pw = password !== undefined ? password : s.mysql.password;
  return spawnSync(path.join(P.mariadb, 'bin', tool), [
    '--host=127.0.0.1', `--port=${s.ports.mysql}`, `--user=${s.mysql.user}`, ...args,
  ], { encoding: 'utf8', timeout, env: { ...process.env, MYSQL_PWD: pw } });
}

// MariaDB health check that logs in properly (a bare TCP probe makes MariaDB
// write "Aborted connection ... unauthenticated" warnings into its log).
function mariadbPing() {
  const r = mariadbClient('mariadb-admin.exe', ['--connect-timeout=2', 'ping'], { timeout: 5000 });
  return r.status === 0 && /alive/i.test(r.stdout || '');
}

// Apache modules AMPLE can run without (see apache.prepare). Everything else is required.
const OPTIONAL_APACHE_MODULES = new Set(['mod_deflate', 'mod_expires', 'mod_autoindex', 'mod_substitute', 'mod_filter']);
// httpd -t: "Cannot load modules/mod_deflate.so into server: An Application Control policy has blocked this file."
const SAC_LOAD_RE = /Cannot load "?([^"\s]+?)"? into server: An Application Control policy has blocked this file/i;

const SERVICES = {
  apache: {
    label: 'Apache',
    port: (s) => s.ports.http,
    extraPorts: (s) => (s.https ? [s.ports.https] : []),
    ready: (port) => portAnswers(port),
    errorLog: () => path.join(P.logs, 'apache', 'error.log'),
    // Test httpd.conf before starting. If Windows Smart App Control blocks an OPTIONAL module
    // (compression, folder listings, the AMPLE look for phpMyAdmin / Mailpit), Apache starts
    // without it instead of not starting at all. A blocked core file (PHP, rewrite, headers,
    // proxy, ssl...) is explained in plain words instead of the raw httpd message.
    prepare() {
      const skip = new Set();
      for (;;) {
        const r = config.generate({ skipModules: skip });
        const t = spawnSync(path.join(P.apache, 'bin', 'httpd.exe'), ['-t', '-f', P.apacheConf], {
          env: config.envFor(r.phpDir), encoding: 'utf8',
        });
        if (t.status === 0) {
          if (skip.size) {
            const files = [...skip].map((m) => m + '.so').join(', ');
            log('Apache', 'WARN', `Windows Smart App Control blocked ${files}; Apache started without ${skip.size > 1 ? 'them' : 'it'} (optional)`, 'warn');
          }
          return r;
        }
        const out = (t.stderr || t.stdout || '').trim();
        const blocked = out.match(SAC_LOAD_RE);
        if (blocked) {
          const file = blocked[1].replace(/\\/g, '/').split('/').pop();
          const mod = file.replace(/\.(so|dll)$/i, '');
          if (OPTIONAL_APACHE_MODULES.has(mod) && !skip.has(mod)) { skip.add(mod); continue; }
          throw new Error(`Windows Smart App Control blocked ${file}, which Apache needs, so Apache cannot start. Run "ample check" to see every blocked file.\n${out}`);
        }
        throw new Error('Apache config test failed:\n' + out);
      }
    },
    spawn(r) {
      return spawn(path.join(P.apache, 'bin', 'httpd.exe'), ['-f', P.apacheConf], {
        env: config.envFor(r.phpDir), cwd: P.apache, detached: true, windowsHide: true, stdio: 'ignore',
      });
    },
    async stop(pid) {
      killTree(pid);
      // Apache can't remove its own pid file when stopped this way; without this it
      // logs "AH00098: pid file overwritten -- Unclean shutdown" on the next start.
      await waitFor(async () => !isAlive(pid), 5000);
      fs.rmSync(path.join(P.run, 'apache.pid'), { force: true });
    },
  },

  mariadb: {
    label: 'MariaDB',
    port: (s) => s.ports.mysql,
    ready: async () => mariadbPing(),
    errorLog: () => path.join(P.logs, 'mariadb', 'error.log'),
    prepare() {
      const r = config.generate();
      initDatabase();
      return r;
    },
    spawn() {
      return spawn(path.join(P.mariadb, 'bin', 'mariadbd.exe'), [`--defaults-file=${P.myIni}`], {
        cwd: P.mariadb, detached: true, windowsHide: true, stdio: 'ignore',
      });
    },
    async stop(pid) {
      // Clean shutdown first: avoids InnoDB crash recovery / corrupted tables.
      mariadbClient('mariadb-admin.exe', ['shutdown'], { timeout: 20000 });
      if (!(await waitFor(async () => !isAlive(pid), 15000))) {
        log('MariaDB', 'STOP', 'clean shutdown timed out, forcing stop', 'warn');
        killTree(pid);
      }
    },
  },

  // Catches every email PHP sends. Web UI: http://localhost/mailpit/ (via Apache)
  mailpit: {
    label: 'Mailpit',
    port: (s) => s.ports.mailpit,          // web UI (used for "is it ready?")
    extraPorts: (s) => [s.ports.smtp],     // SMTP must be free too
    ready: (port) => portAnswers(port),
    errorLog: () => path.join(P.logs, 'mailpit', 'mailpit.log'),
    prepare() {
      fs.mkdirSync(path.join(P.p('mailpit'), 'data'), { recursive: true });
      fs.mkdirSync(path.join(P.logs, 'mailpit'), { recursive: true });
      // The login for Mailpit's page / API (see settings.mailpitAuth): a bcrypt password file
      // written by Apache's own htpasswd, the password given on standard input.
      const { user, pass } = settings.load().mailpitAuth;
      fs.mkdirSync(P.run, { recursive: true });
      const r = spawnSync(path.join(P.apache, 'bin', 'htpasswd.exe'), ['-i', '-B', '-c', MAILPIT_AUTH_FILE, user],
        { input: pass + '\n', encoding: 'utf8', windowsHide: true });
      if (r.status !== 0) throw new Error('Could not write Mailpit\'s login file: ' + (r.stderr || r.stdout || '').trim());
      return {};
    },
    spawn() {
      const s = settings.load();
      return spawn(path.join(P.p('mailpit'), 'mailpit.exe'), [
        // 127.0.0.1 only: Mailpit's default listens on the whole network.
        '--listen', `127.0.0.1:${s.ports.mailpit}`,
        '--smtp', `127.0.0.1:${s.ports.smtp}`,
        '--database', path.join(P.p('mailpit'), 'data', 'mailpit.db'),
        '--webroot', '/mailpit/',
        // Page + API need a login (Apache adds it on /mailpit/); SMTP stays open for your apps.
        '--ui-auth-file', MAILPIT_AUTH_FILE,
        // Any username/password works, so apps with MAIL_USERNAME etc. need no changes.
        '--smtp-auth-accept-any', '--smtp-auth-allow-insecure', '--smtp-disable-rdns',
        '--disable-version-check',
        '--log-file', path.join(P.logs, 'mailpit', 'mailpit.log'),
      ], { cwd: P.p('mailpit'), detached: true, windowsHide: true, stdio: 'ignore' });
    },
    async stop(pid) { killTree(pid); await waitFor(async () => !isAlive(pid), 5000); },
  },
};

// Start order (stop is the reverse).
const ORDER = ['mariadb', 'apache', 'mailpit'];

// First run: create the MariaDB system tables in data/mariadb.
function initDatabase() {
  if (fs.existsSync(path.join(P.mysqlData, 'mysql'))) return false;
  fs.mkdirSync(P.mysqlData, { recursive: true });
  log('MariaDB', 'INIT', `creating new database in ${path.relative(P.ROOT, P.mysqlData)}`);
  const s = settings.load();
  const args = [`--datadir=${P.mysqlData}`, `--port=${s.ports.mysql}`];
  if (s.mysql.password) args.push(`--password=${s.mysql.password}`);
  const r = spawnSync(path.join(P.mariadb, 'bin', 'mysql_install_db.exe'), args, { encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) {
    throw new Error('MariaDB first-time setup failed:\n' + ((r.stderr || '') + (r.stdout || '')).trim());
  }
  // mysql_install_db writes its own my.ini into the data dir; ours in conf/ is the one we use.
  fs.rmSync(path.join(P.mysqlData, 'my.ini'), { force: true });
  log('MariaDB', 'INIT', 'database created');
  return true;
}

// Once, after the first start: mysql_install_db creates accounts for the PC's
// hostname (e.g. root@MY-PC). They are useless with skip-name-resolve and make
// MariaDB log warnings on every start, so keep only local accounts.
function secureFirstRun() {
  const marker = path.join(P.mysqlData, '.ample-secured');
  if (fs.existsSync(marker)) return;
  const sql = [
    "DELETE FROM mysql.global_priv WHERE Host NOT IN ('localhost','127.0.0.1','::1')",
    "DELETE FROM mysql.proxies_priv WHERE Host NOT IN ('localhost','127.0.0.1','::1')",
    'FLUSH PRIVILEGES',
  ].join('; ');
  const r = mariadbClient('mariadb.exe', ['-e', sql]);
  if (r.status === 0) {
    fs.writeFileSync(marker, new Date().toISOString());
    log('MariaDB', 'SETUP', 'removed non-local accounts (only localhost / 127.0.0.1 / ::1 remain)');
  } else {
    log('MariaDB', 'WARN', 'could not clean up default accounts: ' + (r.stderr || '').trim(), 'warn');
  }
}

// ---------- public API ---------------------------------------------------------

async function status(name) {
  const svc = SERVICES[name];
  const s = settings.load();
  const pid = readPid(name);
  const alive = isAlive(pid);
  const port = svc.port(s);
  return { name, label: svc.label, running: alive, pid: alive ? pid : null, port, answering: alive && (await svc.ready(port)) };
}

async function start(name) {
  const svc = SERVICES[name];
  if (!svc) throw new Error(`Unknown service "${name}". Use: ${ORDER.join(', ')}`);
  const s = settings.load();
  const port = svc.port(s);
  const cur = await status(name);
  if (cur.running) { log(svc.label, 'START', `already running (pid ${cur.pid})`); return cur; }

  for (const p of [port, ...(svc.extraPorts ? svc.extraPorts(s) : [])]) {
    if (await portFree(p)) continue;
    let who = whoUsesPort(p);
    // AMPLE's OWN program is on the port (left running by an earlier start): it is not "another
    // program". AMPLE takes it back if it can control it, or stops it (asking Windows once if it
    // runs as administrator) and starts it fresh.
    if (who && OWN_EXE[name] && sameFile(who.path, OWN_EXE[name]())) {
      const top = topOfSame(who.pid, who.name);
      if (!who.elevated && p === port) {
        fs.writeFileSync(pidFile(name), String(top));
        log(svc.label, 'START', `already running from an earlier start (pid ${top}): AMPLE takes it back`);
        return status(name);
      }
      log(svc.label, 'START', `its old copy (pid ${top}) still holds port ${p}${who.elevated ? ' and runs as administrator: asking Windows to stop it' : ': stopping it'}`);
      if (who.elevated) elevatedKill(top); else killTree(top);
      if (await waitFor(() => portFree(p), 8000)) continue;
      who = whoUsesPort(p);
    }
    // Service + path are logged too, so Log Doctor can explain it later even if the program has closed.
    const msg = who
      ? `port ${p} is already used by ${who.name} (PID ${who.pid})` +
        (who.services.length ? ` [service: ${who.services.join(', ')}]` : '') +
        (who.path ? ` [path: ${who.path}]` : '')
      : `port ${p} is already in use by another program.`;
    log(svc.label, 'ERROR', msg, 'error');
    const err = new Error(`${svc.label} could not start: ${msg}`);
    err.diagnosis = require('./doctor').explainText('ample', msg, undefined, { service: svc.label });
    throw err;
  }

  let prep;
  try { prep = svc.prepare(); } catch (e) { log(svc.label, 'ERROR', e.message.split('\n').join(' | '), 'error'); throw e; }

  const child = svc.spawn(prep);
  let exited = null;
  child.once('exit', (code) => { exited = code; });
  child.unref();
  fs.writeFileSync(pidFile(name), String(child.pid));
  log(svc.label, 'START', `starting (pid ${child.pid}) ...`);

  const ok = await waitFor(async () => exited !== null || (await svc.ready(port)), 30000);
  if (!ok || exited !== null) {
    const lastLines = tail(svc.errorLog());
    const why = exited !== null ? `exited with code ${exited}` : 'did not answer within 30s';
    killTree(child.pid);
    fs.rmSync(pidFile(name), { force: true });
    const msg = `${svc.label} failed to start (${why}). Last lines of ${path.relative(P.ROOT, svc.errorLog())}:\n${lastLines}`;
    log(svc.label, 'ERROR', `failed to start (${why})`, 'error');
    const err = new Error(msg);
    err.diagnosis = diagnoseLog(name, lastLines);
    throw err;
  }
  log(svc.label, 'START', `running on port ${port} (pid ${child.pid})`);
  if (name === 'mariadb') secureFirstRun();
  return status(name);
}

// restarting: true when called by restart() (a public link survives an Apache restart, but
// not Apache being stopped).
async function stop(name, { restarting = false } = {}) {
  const svc = SERVICES[name];
  if (name === 'apache' && !restarting) { try { require('./share').killTunnel(); } catch { /* nothing shared */ } }
  const pid = readPid(name);
  if (!isAlive(pid)) { fs.rmSync(pidFile(name), { force: true }); log(svc.label, 'STOP', 'was not running'); return; }
  log(svc.label, 'STOP', `stopping (pid ${pid}) ...`);
  await svc.stop(pid);
  // Only say "stopped" when it really is. A copy started as administrator (by an older AMPLE
  // Setup) refuses a normal stop: ask Windows once. MariaDB is never forced (its data).
  if (isAlive(pid) && name !== 'mariadb') {
    log(svc.label, 'STOP', `pid ${pid} did not stop (it may run as administrator): asking Windows`);
    elevatedKill(pid);
    await waitFor(async () => !isAlive(pid), 8000);
  }
  if (isAlive(pid)) {
    log(svc.label, 'ERROR', `could not be stopped (pid ${pid} is still running)`, 'error');
    throw new Error(`${svc.label} could not be stopped: it is still running (PID ${pid}). If Windows asked for permission, allow it and try again, or restart Windows.`);
  }
  fs.rmSync(pidFile(name), { force: true });
  log(svc.label, 'STOP', 'stopped');
}

async function restart(name) { await stop(name, { restarting: true }); return start(name); }

// Switch the active PHP version. With mod_php, Apache must restart to load it.
async function usePhp(wanted) {
  const all = config.listPhpVersions(); // newest first
  // "8.4" picks the newest installed 8.4.x; "8.4.27" must match exactly.
  const version = all.find((v) => v === wanted) || all.find((v) => v.startsWith(wanted + '.'));
  if (!version) {
    throw new Error(`PHP ${wanted} is not installed. Installed: ${all.join(', ') || 'none'}.` +
      ` Download it with: ample php-add ${wanted}`);
  }
  const before = config.activePhp();
  // Xdebug DLLs are built per PHP version: fetch the matching one BEFORE comparing,
  // so the comparison sees the version exactly as it will run.
  if (settings.load().xdebug) {
    try { await require('./xdebug').ensure(version); } catch (e) { log('Xdebug', 'WARN', e.message, 'warn'); }
  }
  // Make the new version match the current one (extensions + settings).
  const report = before !== version
    ? require('./phpcompare').compare(before, version, { apply: true })
    : null;
  settings.update({ php: version });
  log('PHP', 'SWITCH', `active PHP: ${before} -> ${version}`);
  if ((await status('apache')).running) await restart('apache');
  else config.generate();
  return { version, report };
}

// Change the MariaDB password everywhere at once: every account of the
// configured user (localhost, 127.0.0.1, ::1), ample.json, and phpMyAdmin's
// config. (In XAMPP, changing it in one place breaks phpMyAdmin.)
async function changePassword(newPassword) {
  if (!(await status('mariadb')).running) throw new Error('MariaDB must be running to change the password. Run: ample start mariadb');
  const s = settings.load();
  const q = (v) => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const hosts = mariadbClient('mariadb.exe', ['-N', '-B', '-e',
    `SELECT Host FROM mysql.global_priv WHERE User=${q(s.mysql.user)}`]);
  if (hosts.status !== 0) throw new Error('Could not read accounts: ' + (hosts.stderr || '').trim());
  const list = hosts.stdout.split(/\r?\n/).map((h) => h.trim()).filter(Boolean);
  const sql = list.map((h) => `ALTER USER ${q(s.mysql.user)}@${q(h)} IDENTIFIED BY ${q(newPassword)}`)
    .concat('FLUSH PRIVILEGES').join('; ');
  const r = mariadbClient('mariadb.exe', ['-e', sql]);
  if (r.status !== 0) throw new Error('Password change failed: ' + (r.stderr || '').trim());

  // Verify the new password really works before saving it anywhere.
  const check = mariadbClient('mariadb-admin.exe', ['ping'], { password: newPassword, timeout: 5000 });
  if (check.status !== 0) throw new Error('Password was changed but logging in with it failed: ' + (check.stderr || '').trim());

  settings.update({ mysql: { password: newPassword } });
  config.generate(); // rewrites phpMyAdmin's config.inc.php with the new password
  log('MariaDB', 'PASSWD', `password changed for ${s.mysql.user}@{${list.join(', ')}}; ample.json + phpMyAdmin updated`);
  return list;
}

module.exports = {
  SERVICES, ORDER, start, stop, restart, status, whoUsesPort, initDatabase,
  usePhp, changePassword, mariadbClient,
};
