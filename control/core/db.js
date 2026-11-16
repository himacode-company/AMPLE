'use strict';
// Database export / import with MariaDB's own tools.
// Every function accepts a connection { port, user, password } so the same code
// works on the normal server and on a temporary rescue server.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync, execFileSync } = require('child_process');
const P = require('./paths');
const settings = require('./settings');

const SYSTEM_DBS = new Set(['mysql', 'information_schema', 'performance_schema', 'sys']);

function defaultConn() {
  const s = settings.load();
  return { port: s.ports.mysql, user: s.mysql.user, password: s.mysql.password };
}

// Base arguments; the password goes through MYSQL_PWD (never visible in the process list).
function connArgs(c) {
  return ['--host=127.0.0.1', `--port=${c.port}`, ...(c.user ? [`--user=${c.user}`] : [])];
}
function connEnv(c) {
  return { ...process.env, MYSQL_PWD: c.password || '' };
}
const tool = (name) => path.join(P.mariadb, 'bin', name);

function sql(query, conn = defaultConn(), { timeout = 30000 } = {}) {
  const r = spawnSync(tool('mariadb.exe'), [...connArgs(conn), '-N', '-B', '-e', query],
    { encoding: 'utf8', env: connEnv(conn), timeout });
  if (r.status !== 0) throw new Error((r.stderr || 'query failed').trim());
  return r.stdout;
}

function listDatabases(conn = defaultConn()) {
  // "#mysql50#..." = a folder inside the data dir that is not a real database.
  return sql('SHOW DATABASES', conn).split(/\r?\n/).map((s) => s.trim())
    .filter((d) => d && !SYSTEM_DBS.has(d.toLowerCase()) && !d.startsWith('#mysql50#'));
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Export one database to .sql or .sql.gz. Returns { file, bytes, warnings }.
// force: keep going past broken tables (used by rescue).
function exportDb(db, file, { conn = defaultConn(), force = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = [
    ...connArgs(conn), '--single-transaction', '--routines', '--events', '--triggers',
    '--default-character-set=utf8mb4', '--max-allowed-packet=1G', '--hex-blob',
    ...(force ? ['--force', '--skip-lock-tables'] : []),
    '--databases', db,
  ];
  const child = spawn(tool('mariadb-dump.exe'), args, { env: connEnv(conn), windowsHide: true });
  const out = fs.createWriteStream(file);
  const gz = file.endsWith('.gz') ? zlib.createGzip({ level: 6 }) : null;
  (gz ? child.stdout.pipe(gz) : child.stdout).pipe(out);
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  // Wait for BOTH: the process exit code and the file fully written.
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const written = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
  return Promise.all([exited, written]).then(([code]) => {
    const warnings = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (code !== 0 && !force) throw new Error(`Export of ${db} failed: ${warnings.join(' | ')}`);
    return { file, bytes: fs.statSync(file).size, warnings, code };
  });
}

// Import a .sql / .sql.gz / .zip file, streaming (no size limit), with progress.
// db: target database (created if missing). Files made by mysqldump --databases
// contain their own CREATE DATABASE / USE, so db may be omitted for them.
async function importFile(file, db, { conn = defaultConn(), onProgress = () => {} } = {}) {
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  let source = file;
  let cleanup = null;
  if (/\.zip$/i.test(file)) {
    const dir = path.join(P.tmp, `import-${stamp()}`);
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['-xf', file, '-C', dir]);
    const sqlFile = fs.readdirSync(dir, { recursive: true }).find((f) => /\.sql(\.gz)?$/i.test(f));
    if (!sqlFile) throw new Error('No .sql file inside the zip.');
    source = path.join(dir, sqlFile);
    cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  }
  if (db) sql(`CREATE DATABASE IF NOT EXISTS \`${db.replace(/`/g, '``')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, conn);

  const total = fs.statSync(source).size;
  const args = [...connArgs(conn), '--default-character-set=utf8mb4', '--max-allowed-packet=1G', ...(db ? [db] : [])];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(tool('mariadb.exe'), args, { env: connEnv(conn), windowsHide: true });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error((stderr || `import failed (code ${code})`).trim()))));
      const input = fs.createReadStream(source);
      let read = 0, lastPct = -1;
      input.on('data', (chunk) => {
        read += chunk.length;
        const pct = Math.floor((read / total) * 100);
        if (pct !== lastPct) { lastPct = pct; onProgress(pct, read, total); }
      });
      (source.endsWith('.gz') ? input.pipe(zlib.createGunzip()) : input).pipe(child.stdin);
      child.stdin.on('error', () => { /* reported through close/stderr */ });
    });
  } finally {
    if (cleanup) cleanup();
  }
  return { file, bytes: total };
}

// Every database with its table count and size. Size comes from the files on disk:
// information_schema sizes lag behind after big inserts.
function details(conn = defaultConn()) {
  const rows = sql("SELECT table_schema, COUNT(*) FROM information_schema.tables WHERE table_type='BASE TABLE' GROUP BY table_schema", conn);
  const tables = Object.fromEntries(rows.split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')));
  const sizeOf = (name) => {
    const dir = path.join(P.mysqlData, name);
    try { return fs.readdirSync(dir).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0); } catch { return 0; }
  };
  return listDatabases(conn).map((name) => ({ name, tables: Number(tables[name] || 0), bytes: sizeOf(name) }));
}

// Database names AMPLE creates: letters, digits, _ and - (works everywhere without quoting surprises).
const DB_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// "ample db new NAME": an empty database in utf8mb4 (emoji and every language work).
function createDatabase(name, conn = defaultConn()) {
  name = String(name || '').trim();
  if (!DB_NAME.test(name)) throw new Error(`"${name}" can't be a database name here: use letters, digits, _ and - (up to 64)`);
  if (SYSTEM_DBS.has(name.toLowerCase())) throw new Error(`"${name}" is a MariaDB system database`);
  if (listDatabases(conn).some((d) => d.toLowerCase() === name.toLowerCase())) throw new Error(`The database "${name}" already exists`);
  sql(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, conn);
  require('./logger').log('MariaDB', 'NEWDB', `database ${name} created (utf8mb4)`);
  return name;
}

// backups\: files made by "ample backup" (and anything else .sql / .sql.gz / .zip put there).
const BACKUPS = P.p('backups');
function listBackups(limit = 30) {
  if (!fs.existsSync(BACKUPS)) return [];
  return fs.readdirSync(BACKUPS, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(sql|sql\.gz|zip)$/i.test(e.name))
    .map((e) => { const st = fs.statSync(path.join(BACKUPS, e.name)); return { name: e.name, bytes: st.size, time: st.mtimeMs }; })
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}
// Full path of a backup, from its file NAME only (never a path).
function backupPath(name) {
  name = String(name || '');
  if (name !== path.basename(name) || !/\.(sql|sql\.gz|zip)$/i.test(name)) throw new Error(`"${name}" is not a backup file name`);
  const file = path.join(BACKUPS, name);
  if (!fs.existsSync(file)) throw new Error(`backups\\${name} does not exist`);
  return file;
}

module.exports = {
  SYSTEM_DBS, defaultConn, sql, listDatabases, exportDb, importFile, stamp, connArgs, connEnv,
  details, createDatabase, listBackups, backupPath, BACKUPS, DB_NAME,
};
