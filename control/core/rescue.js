'use strict';
// MariaDB rescue mode: when the database won't start, save your databases.
//
//   1. stop MariaDB, move mariadb\data -> mariadb\data-broken-<date>   (nothing deleted)
//   2. create a fresh, clean data folder and start MariaDB on it        (you can work again)
//   3. start a TEMPORARY MariaDB on the broken copy (port 3399, local only),
//      with innodb_force_recovery 1..6 until it starts
//   4. export every user database from it (broken tables are skipped)  -> backups\rescue-<date>\
//   5. import the exports into the fresh MariaDB
//   6. report: database saved fully / partly (which tables) / not at all
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const P = require('./paths');
const db = require('./db');
const { log } = require('./logger');

const RESCUE_PORT = 3399;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => log('Rescue', 'STEP', msg);

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

const rescueConn = { port: RESCUE_PORT, user: 'root', password: '' };

function ping(conn) {
  const r = spawnSync(path.join(P.mariadb, 'bin', 'mariadb-admin.exe'), [...db.connArgs(conn), '--connect-timeout=2', 'ping'],
    { encoding: 'utf8', env: db.connEnv(conn), timeout: 5000 });
  return r.status === 0;
}

// Start a temporary server on the broken data with the given recovery level.
async function startRescueServer(dataDir, level) {
  const errLog = path.join(P.logs, 'mariadb', 'rescue.log');
  const child = spawn(path.join(P.mariadb, 'bin', 'mariadbd.exe'), [
    '--no-defaults', `--basedir=${P.mariadb}`, `--datadir=${dataDir}`,
    `--port=${RESCUE_PORT}`, '--bind-address=127.0.0.1', '--skip-name-resolve',
    '--skip-grant-tables', `--innodb-force-recovery=${level}`, '--max-allowed-packet=1G',
    `--log-error=${errLog}`, `--pid-file=${path.join(P.run, 'rescue.pid')}`,
  ], { cwd: P.mariadb, windowsHide: true, stdio: 'ignore', detached: true });
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.unref();
  for (let i = 0; i < 60 && !exited; i++) {
    if (ping(rescueConn)) return child;
    await sleep(500);
  }
  if (!exited) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  return null;
}

async function stopRescueServer(child) {
  spawnSync(path.join(P.mariadb, 'bin', 'mariadb-admin.exe'), [...db.connArgs(rescueConn), 'shutdown'],
    { env: db.connEnv(rescueConn), timeout: 30000, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { process.kill(child.pid, 0); } catch { return; }
    await sleep(500);
  }
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

// Count tables per database on a server (to compare before/after).
function tableCounts(conn) {
  const out = db.sql("SELECT table_schema, COUNT(*) FROM information_schema.tables WHERE table_type='BASE TABLE' GROUP BY table_schema", conn);
  const map = {};
  for (const line of out.split(/\r?\n/)) {
    const [schema, n] = line.split('\t');
    if (schema) map[schema] = Number(n);
  }
  return map;
}

async function rescue({ onStep = () => {} } = {}) {
  const services = require('./services');
  const step = (msg) => { say(msg); onStep(msg); };
  if (!(await portFree(RESCUE_PORT))) throw new Error(`Port ${RESCUE_PORT} (used for the temporary rescue server) is busy.`);
  if (!fs.existsSync(P.mysqlData)) throw new Error('There is no mariadb\\data folder to rescue.');

  const stamp = db.stamp();
  const broken = path.join(P.mariadb, `data-broken-${stamp}`);
  const outDir = path.join(P.ROOT, 'backups', `rescue-${stamp}`);

  // 1. Move the broken data aside.
  step('stopping MariaDB');
  await services.stop('mariadb');
  fs.renameSync(P.mysqlData, broken);
  step(`moved mariadb\\data to ${path.relative(P.ROOT, broken)} (nothing deleted)`);

  // 2. Fresh data + normal server.
  step('creating a fresh data folder');
  await services.start('mariadb'); // initDatabase() runs because mariadb\data is gone
  step('MariaDB is running again on a clean data folder');

  // 3. Temporary server on the broken copy.
  let child = null, level = 0, ariaMoved = false;
  for (level = 1; level <= 6 && !child; level++) {
    step(`starting temporary server on the broken data (recovery level ${level})`);
    child = await startRescueServer(broken, level);
    if (!child && level === 1 && !ariaMoved) {
      // Damaged Aria logs are the most common reason; move them aside and retry.
      // NOT inside the data folder: MariaDB treats every sub-folder there as a database.
      const aside = path.join(outDir, 'aria-logs');
      fs.mkdirSync(aside, { recursive: true });
      for (const f of fs.readdirSync(broken)) {
        if (f === 'aria_log_control' || /^aria_log\.\d+$/.test(f)) fs.renameSync(path.join(broken, f), path.join(aside, f));
      }
      ariaMoved = true;
      level = 0; // retry from level 1
      step('moved the Aria log files aside and retrying');
    }
  }
  level -= 1;
  if (!child) {
    step('the broken data could not be opened at any recovery level');
    return { ok: false, broken, outDir, databases: [], level: null, message: 'Could not open the broken data at any recovery level. It is kept untouched in ' + path.relative(P.ROOT, broken) };
  }
  step(`temporary server is up (recovery level ${level})`);

  // 4. Export every user database.
  const results = [];
  let before = {};
  try {
    before = tableCounts(rescueConn);
    for (const name of db.listDatabases(rescueConn)) {
      step(`exporting ${name}`);
      const file = path.join(outDir, `${name}.sql`);
      const r = await db.exportDb(name, file, { conn: rescueConn, force: true });
      const failedTables = [...new Set(r.warnings
        .map((w) => (w.match(/`([^`]+)`['"]?:? .*?(?:doesn't exist|error|corrupt|crashed)/i) || w.match(/table `?([\w$]+)`?/i) || [])[1])
        .filter(Boolean))];
      results.push({ db: name, file, bytes: r.bytes, warnings: r.warnings, failedTables, tablesBefore: before[name] || 0 });
    }
  } finally {
    step('stopping the temporary server');
    await stopRescueServer(child);
  }

  // 5. Import into the fresh server.
  for (const r of results) {
    step(`importing ${r.db}`);
    try {
      await db.importFile(r.file, null);
      r.imported = true;
    } catch (e) {
      r.imported = false;
      r.importError = e.message;
    }
  }
  const after = tableCounts(db.defaultConn());
  for (const r of results) {
    r.tablesAfter = after[r.db] || 0;
    r.status = !r.imported ? 'failed' : (r.tablesAfter >= r.tablesBefore && !r.failedTables.length ? 'full' : 'partial');
  }
  const summary = results.map((r) => `${r.db}: ${r.status} (${r.tablesAfter}/${r.tablesBefore} tables)`).join('; ');
  step(`done. ${summary || 'no user databases found'}`);
  return { ok: true, broken, outDir, level, databases: results };
}

module.exports = { rescue, RESCUE_PORT };
