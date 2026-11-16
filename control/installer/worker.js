'use strict';
// AMPLE Setup: the worker process (plain Node, started by installer/main.js with AMPLE_ROOT set
// to the chosen folder). argv: [payload folder, folder of this Electron, this Electron's exe].
//   install   copy AMPLE + Electron, then download every component (same code as "ample setup")
//   xampp*    import databases / projects from XAMPP (control/core/xampp.js)
//   finish    PATH, HTTPS, settings, start the services
// Electron reads .asar files (resources\default_app.asar) as if they were folders; setup only
// COPIES files, so they must be plain files here (else: EISDIR when copying Electron).
process.noAsar = true;

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const [PAYLOAD, ELECTRON_DIR, ELECTRON_EXE] = process.argv.slice(2);
const ROOT = path.resolve(process.env.AMPLE_ROOT);
const core = (m) => require(path.join(ROOT, 'control', 'core', m));

const send = (m) => process.parentPort.postMessage(m);
const step = (id, state, extra = {}) => send({ event: 'step', id, state, ...extra });
const say = (text) => send({ event: 'log', text: String(text) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCKED = ['EBUSY', 'EPERM', 'EACCES'];

// A file can be locked for a moment (antivirus scanning it): try again a few times before failing.
function copyFile(s, d) {
  for (let i = 0; ; i++) {
    try { fs.copyFileSync(s, d); return; } catch (e) {
      if (!LOCKED.includes(e.code) || i >= 8) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    }
  }
}

function copyDir(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (skip(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, skip);
    else copyFile(s, d);
  }
}

// ---- an update: close what is running from this folder first ---------------------------------
// Windows does not let anyone overwrite a program that is running (EBUSY: "resource busy or
// locked"). So when AMPLE is already installed here, its services are stopped CLEANLY with the
// installed AMPLE's own code (MariaDB shuts down properly), the share tunnel is closed, and the old
// control panel is closed. "finish" starts the services again at the end.
function runningFromRoot() {
  const root = ROOT.replace(/'/g, "''") + '\\';
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${root}', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [pid, name] = l.split('|'); return { pid: Number(pid), name: name || '' }; })
    .filter((p) => p.pid && p.pid !== process.pid);
}
async function closeRunning() {
  if (!fs.existsSync(path.join(ROOT, 'control', 'core', 'services.js'))) return; // a new install
  if (!runningFromRoot().length) return;
  step('ample', 'run', { pct: 0, detail: 'closing the running AMPLE' });
  say('AMPLE is running from this folder: stopping it before the update');
  try {
    const S = core('services.js');
    for (const name of [...S.ORDER].reverse()) {
      try { await S.stop(name); } catch (e) { say(`${name}: ${String(e.message).split('\n')[0]}`); }
    }
  } catch (e) { say('services: ' + e.message); }
  try { core('share.js').killTunnel(); } catch { /* not sharing */ }
  // What is still running (the old control panel, a tunnel...) is closed. MariaDB is never forced:
  // killing it could damage your databases, so if it did not stop, setup stops and says so.
  for (const p of runningFromRoot()) {
    if (/^(mariadbd|mysqld)\.exe$/i.test(p.name)) continue;
    spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true });
  }
  for (let i = 0; i < 24 && runningFromRoot().length; i++) await sleep(250);
  const left = runningFromRoot();
  if (left.length) {
    throw Object.assign(new Error(`Still running from the AMPLE folder: ${[...new Set(left.map((p) => p.name))].join(', ')}. Close it, then press "Try again".`), { step: 'ample' });
  }
  // the next steps must use the NEW AMPLE code, not the one loaded above
  for (const k of Object.keys(require.cache)) if (k.toLowerCase().startsWith(ROOT.toLowerCase())) delete require.cache[k];
}

// ---- 1. this PC ----------------------------------------------------------------------------
function vcRuntime() {
  const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64', '/v', 'Version'], { encoding: 'utf8', windowsHide: true });
  const m = (r.stdout || '').match(/v?(\d+)\.(\d+)\./);
  return m ? `${m[1]}.${m[2]}` : null;
}
const verOk = (v) => { if (!v) return false; const [a, b] = v.split('.').map(Number); return a > 14 || (a === 14 && b >= 30); };

function windowsName() {
  const build = Number(os.release().split('.')[2] || 0);
  return build >= 22000 ? 'Windows 11' : 'Windows 10';
}

async function installVcRuntime() {
  const exe = path.join(os.tmpdir(), 'vc_redist.x64.exe');
  const res = await fetch('https://aka.ms/vs/17/release/vc_redist.x64.exe', { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download the Visual C++ runtime (HTTP ${res.status})`);
  fs.writeFileSync(exe, Buffer.from(await res.arrayBuffer()));
  // Run it only if Microsoft really signed it.
  const sig = spawnSync('powershell', ['-NoProfile', '-Command',
    `$s = Get-AuthenticodeSignature '${exe.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: 'utf8', windowsHide: true });
  if (!/^Valid\|.*Microsoft Corporation/.test((sig.stdout || '').trim())) throw new Error('The Visual C++ installer is not signed by Microsoft; not running it.');
  say('Visual C++ runtime: Windows asks for permission...');
  spawnSync('powershell', ['-NoProfile', '-Command',
    `Start-Process '${exe.replace(/'/g, "''")}' -ArgumentList '/install','/passive','/norestart' -Verb RunAs -Wait`], { windowsHide: true });
}

// ---- who may use the AMPLE folder ------------------------------------------------------------
// 'me':  only this Windows account (+ SYSTEM + Administrators). A folder made on C:\ otherwise
//        inherits "Authenticated Users: Modify": any other account could change AMPLE's programs.
// 'all': Windows' default permissions (every account can use and change AMPLE).
// SIDs, not names, so it works in every Windows language. Set BEFORE any file is copied, so
// every file inherits it; an existing folder (update) has its files reset to inherit it too.
function currentUserSid() {
  const r = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const m = (r.stdout || '').match(/"(S-1-[\d-]+)"/);
  if (!m) throw new Error('Could not read your Windows account id (whoami)');
  return m[1];
}
function setAccess(scope) {
  fs.mkdirSync(ROOT, { recursive: true });
  const hasFiles = fs.readdirSync(ROOT).length > 0;
  const icacls = (args) => {
    const r = spawnSync('icacls', args, { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error('Could not set the folder permissions: ' + ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/)[0]);
  };
  if (scope === 'me') {
    const me = currentUserSid();
    icacls([ROOT, '/inheritance:r', '/grant:r', `*${me}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  } else {
    icacls([ROOT, '/reset']); // back to what the parent folder (C:\) gives
  }
  if (hasFiles) icacls([path.join(ROOT, '*'), '/reset', '/T', '/C', '/Q']); // existing files follow the folder
}

// ---- 2. AMPLE files + Electron + Node --------------------------------------------------------
async function copyAmple() {
  fs.mkdirSync(ROOT, { recursive: true });
  // AMPLE's code (control\, ample.cmd, ...). Your data is never in the payload.
  copyDir(PAYLOAD, ROOT, (s) => path.relative(PAYLOAD, s).toLowerCase() === path.join('htdocs', 'index.php') && fs.existsSync(path.join(ROOT, 'htdocs', 'index.php')));
  // The control panel = this same Electron, only the exe renamed (never modified).
  const dest = path.join(ROOT, 'electron');
  const appDir = path.join(ELECTRON_DIR, 'resources', 'app');
  copyDir(ELECTRON_DIR, dest, (s) => s === appDir || s === ELECTRON_EXE);
  copyFile(ELECTRON_EXE, path.join(dest, 'AMPLE.exe'));
  const comps = JSON.parse(fs.readFileSync(path.join(ROOT, 'control', 'components.json'), 'utf8'));
  fs.writeFileSync(path.join(dest, '.ample-version'), comps.electron.version);
  core('panel.js').prepare();
}

async function installNode(progress) {
  const comps = JSON.parse(fs.readFileSync(path.join(ROOT, 'control', 'components.json'), 'utf8'));
  const c = comps.node;
  const exe = path.join(ROOT, c.dest);
  if (fs.existsSync(exe)) return;
  const dir = path.join(ROOT, 'tmp', 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, path.basename(new URL(c.url).pathname));
  if (!fs.existsSync(zip)) {
    const res = await fetch(c.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Node.js: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(zip + '.part');
    let got = 0;
    for await (const chunk of res.body) {
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (total) progress(Math.floor((got / total) * 100));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    fs.renameSync(zip + '.part', zip);
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  if (sha !== c.sha256) { fs.rmSync(zip, { force: true }); throw new Error('Node.js: checksum mismatch'); }
  const tmp = path.join(ROOT, 'tmp', 'node-extract');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync('tar', ['-xf', zip, '-C', tmp, c.file], { stdio: 'ignore' });
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.copyFileSync(path.join(tmp, c.file), exe);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- 3. components (the same code as "ample setup") ---------------------------------------------
async function component(id, label, comp) {
  step(id, 'run', { pct: 0 });
  const log = (m) => {
    const t = String(m);
    const pct = t.match(/(\d+)%\s*$/);
    if (pct) step(id, 'run', { pct: Number(pct[1]) });
    else if (/extracting/i.test(t)) step(id, 'run', { pct: 100, detail: 'extracting' });
    say(t.trim());
  };
  await core('download.js').install(label, comp, log);
  step(id, 'ok', { detail: comp.sha256 ? 'checksum OK' : '' });
}

const METHODS = {
  async install(scope, opts = {}) {
    const result = { windows: windowsName(), vc: null, scope: scope === 'all' ? 'all' : 'me' };
    // 1. this PC
    step('pc', 'run');
    let vc = vcRuntime();
    if (!verOk(vc)) {
      step('pc', 'run', { detail: 'installing the Visual C++ runtime (Windows asks)' });
      await installVcRuntime();
      vc = vcRuntime();
      if (!verOk(vc)) throw Object.assign(new Error('The Visual C++ runtime is needed by Apache and PHP. It was not installed (the Windows box was cancelled?).'), { step: 'pc' });
    }
    result.vc = vc;
    step('pc', 'ok', { detail: `${result.windows} · Visual C++ ${vc}` });

    // 2. AMPLE files, the control panel, Node.js (permissions first: every file inherits them)
    step('ample', 'run', { pct: 0 });
    await closeRunning(); // an update: nothing from this folder may be running while it is replaced
    if (!opts.update) setAccess(result.scope); // an update keeps the permissions chosen the first time
    await copyAmple();
    await installNode((pct) => step('ample', 'run', { pct }));
    step('ample', 'ok', { detail: 'control panel + command line' });

    // 3. components
    const comps = JSON.parse(fs.readFileSync(path.join(ROOT, 'control', 'components.json'), 'utf8'));
    await component('apache', 'Apache', comps.apache);
    await component('php', 'PHP', comps.php[0]);
    await core('download.js').install('CA certificates', comps.cacert, say);
    await component('mariadb', 'MariaDB', comps.mariadb);
    await component('phpmyadmin', 'phpMyAdmin', comps.phpmyadmin);
    await component('mailpit', 'Mailpit', comps.mailpit);
    await component('composer', 'Composer', comps.composer);
    core('config.js').generate();
    return result;
  },

  async xamppDetect() {
    const XM = core('xampp.js');
    const d = XM.detect();
    if (d) XM.usePath(d.root);
    return d ? XM.inventory() : { found: false, root: 'C:\\xampp' };
  },
  async xamppSetPath(folder) { core('xampp.js').usePath(folder); return core('xampp.js').inventory(); },
  async xamppImport(dbs, projects, password) {
    const XM = core('xampp.js');
    const inv = XM.inventory();
    if (!inv.found) throw new Error('XAMPP was not found');
    const names = (Array.isArray(dbs) ? dbs : []).filter((n) => inv.databases.some((d) => d.name === n));
    const onStep = (text) => say(text);
    const out = { databases: null, projects: null };
    if (names.length) {
      try {
        const r = await XM.importDatabases(names, { yes: true, password: typeof password === 'string' ? password : '', onStep });
        out.databases = r.results.map((x) => ({ db: x.db, status: x.status, error: x.error || null, tablesBefore: x.tablesBefore || 0, tablesAfter: x.tablesAfter || 0 }));
      } catch (e) {
        if (e.code === 'XAMPP_PASSWORD') return { needPassword: true };
        throw e;
      }
    }
    if (projects === true) {
      const r = XM.importProjects([], { yes: true, onStep });
      out.projects = r.plan.filter((p) => p.type === 'folder' && !p.exists).map((p) => p.name);
    }
    return out;
  },

  // After an update: the options were chosen the first time and are kept; only rebuild the
  // config for the new version and start the services again.
  async finishUpdate() {
    const notes = [];
    core('config.js').generate();
    const services = core('services.js');
    for (const name of services.ORDER) {
      try { await services.start(name); } catch (e) { notes.push(`${name}: ${e.message.split('\n')[0]}`); }
    }
    return { notes };
  },

  // Options chosen on the last page (shortcuts / start with Windows are done by main.js).
  async finish(opts) {
    const settings = core('settings.js');
    const notes = [];
    if (opts.path) { try { core('shell.js').pathAdd(); } catch (e) { notes.push('PATH: ' + e.message); } }
    if (opts.https) { try { core('https.js').ensureCA(); settings.update({ https: true }); } catch (e) { notes.push('HTTPS: ' + e.message); } }
    settings.update({ panel: { firstRunDone: true, startWithWindows: !!opts.windows } });
    core('config.js').generate();
    const services = core('services.js');
    for (const name of services.ORDER) {
      try { await services.start(name); } catch (e) { notes.push(`${name}: ${e.message.split('\n')[0]}`); }
    }
    return { notes };
  },
};

process.parentPort.on('message', async (e) => {
  const { id, method, args = [] } = e.data || {};
  try {
    if (!Object.prototype.hasOwnProperty.call(METHODS, method)) throw new Error('Unknown request: ' + method);
    send({ id, ok: true, result: await METHODS[method](...args) });
  } catch (err) {
    send({ id, ok: false, error: err.message, step: err.step || null });
  }
});
