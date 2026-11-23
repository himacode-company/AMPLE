'use strict';
// AMPLE Setup: the installer window (Electron: the same build as the control panel).
// Packed into AMPLE-Setup.exe by control/tools/build-setup.js:
//   resources\app\installer\   this code
//   resources\app\payload\     AMPLE's code (control\, ample.cmd, setup.cmd, README.md, htdocs\index.php)
// Pages: 1 install (location + downloads)  2 import from XAMPP?  3 import  4 options  → open AMPLE.
// Security as in the control panel: isolated page, a few checked requests, no navigation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { fileURLToPath } = require('url');
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, utilityProcess } = require('electron');

const APP_DIR = path.join(__dirname, '..');
const PAYLOAD = path.join(APP_DIR, 'payload');
const UI = path.join(__dirname, 'ui', 'index.html');
const ELECTRON_EXE = process.execPath;
const ELECTRON_DIR = path.dirname(process.execPath);
const VERSION = (() => { try { return require(path.join(APP_DIR, 'package.json')).version; } catch { return '1.0.0'; } })();

// ---- started by the AMPLE control panel (Update button)? Run on our own first --------------------
// Windows keeps every program the panel opens in the panel's "job": when the panel is closed, all of
// them are closed with it. Setup closes the old panel to replace its files, so it closed ITSELF too
// and the update stopped halfway. So when the panel started us, Windows (WMI) starts a fresh copy of
// this setup outside that job, and this copy quits. The fresh copy waits until this one is gone
// (only one setup may run). Panels from 1.0.2 on start setup outside the job themselves.
const OUTSIDE = process.argv.find((a) => a.startsWith('--outside='));
function startedByPanel() {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `$me = Get-CimInstance Win32_Process -Filter "ProcessId=${process.pid}"; ` +
    `if ($me) { (Get-CimInstance Win32_Process -Filter "ProcessId=$($me.ParentProcessId)").ExecutablePath }`],
  { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const parent = (r.stdout || '').trim();
  // the panel is <AMPLE>\electron\AMPLE.exe (its worker runs the same exe)
  return !!parent && /\\electron\\AMPLE\.exe$/i.test(parent) &&
    fs.existsSync(path.join(path.dirname(path.dirname(parent)), 'control', 'core', 'paths.js'));
}
function startOutsideJob() {
  const cmd = `"${process.execPath}" --outside=${process.pid}`.replace(/'/g, "''");
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmd}'; CurrentDirectory = '${path.dirname(process.execPath).replace(/'/g, "''")}' }).ReturnValue`],
  { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return (r.stdout || '').trim() === '0';
}
if (OUTSIDE) {
  // wait (up to 10 s) until the copy that started us has quit
  const pid = Number(OUTSIDE.split('=')[1]);
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch { break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
} else if (process.platform === 'win32' && startedByPanel() && startOutsideJob()) {
  app.exit(0);
  return;
}

app.setPath('userData', path.join(os.tmpdir(), 'ample-setup')); // leaves nothing in AppData
app.setAppUserModelId('AMPLE.Setup');

let win = null;
let target = 'C:\\ample';
let worker = null, seq = 0;
const pending = new Map();
let installing = false, installed = false;

// ---- an AMPLE that is already installed ------------------------------------------------------
// Setup records where AMPLE is and which version in "Apps & features" (HKCU, no administrator).
// The version of a folder is read from its control\version.json; older installs only have the
// registry value.
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AMPLE';
function regRead(name) {
  const r = spawnSync('reg', ['query', UNINSTALL_KEY, '/v', name], { encoding: 'utf8', windowsHide: true });
  const m = (r.stdout || '').match(new RegExp(name + '\\s+REG_\\w+\\s+(.+)'));
  return m ? m[1].trim() : null;
}
function versionOf(dir) {
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, 'control', 'version.json'), 'utf8')).version; if (v) return String(v); } catch { /* older AMPLE */ }
  const loc = regRead('InstallLocation');
  return loc && path.resolve(loc).toLowerCase() === path.resolve(dir).toLowerCase() ? regRead('DisplayVersion') : null;
}
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}
// install: a new AMPLE · update: older version here · same: this version is already here (repair)
// newer: a NEWER version is already here (setup does not go back)
function modeOf(dir, existing) {
  if (!existing) return { mode: 'install', installed: null };
  const installed = versionOf(dir);
  if (!installed) return { mode: 'update', installed: null };
  const c = compareVersions(VERSION, installed);
  return { mode: c > 0 ? 'update' : c === 0 ? 'same' : 'newer', installed };
}
// Where setup starts: the folder AMPLE is installed in, if there is one
(() => {
  const loc = regRead('InstallLocation');
  if (loc && fs.existsSync(path.join(loc, 'control', 'core', 'paths.js'))) target = path.resolve(loc);
})();

// ---- the install folder ---------------------------------------------------------------------
function checkTarget(p) {
  const dir = path.resolve(String(p || ''));
  if (!/^[A-Za-z]:\\/.test(dir)) return { ok: false, reason: 'Choose a folder on a drive, for example C:\\ample.' };
  if (/^[A-Za-z]:\\?$/.test(dir)) return { ok: false, reason: 'Choose a folder, not the whole drive (for example C:\\ample).' };
  if (/[^\x20-\x7E]/.test(dir)) return { ok: false, reason: 'Use only English letters in the path: Apache and MariaDB do not handle other characters reliably.' };
  if (/\s/.test(dir)) return { ok: false, reason: 'Use a path without spaces, for example C:\\ample.' };
  if (/\\(OneDrive)[\\ -]?/i.test(dir)) return { ok: false, reason: 'Not inside OneDrive: syncing locks database and log files.' };
  let existing = false;
  if (fs.existsSync(dir)) {
    existing = fs.existsSync(path.join(dir, 'control', 'core', 'paths.js'));
    if (!existing && fs.readdirSync(dir).length) return { ok: false, reason: 'This folder is not empty. Choose an empty folder or a new one.' };
  }
  return { ok: true, dir, existing, ...modeOf(dir, existing) };
}

// ---- worker ---------------------------------------------------------------------------------
function startWorker() {
  worker = utilityProcess.fork(path.join(__dirname, 'worker.js'), [PAYLOAD, ELECTRON_DIR, ELECTRON_EXE], {
    serviceName: 'AMPLE Setup', stdio: 'ignore', env: { ...process.env, AMPLE_ROOT: target },
  });
  worker.on('message', (m) => {
    if (m && (m.event === 'step' || m.event === 'log')) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('setup:event', {
          event: m.event, id: m.id ? String(m.id) : null, state: m.state ? String(m.state) : null,
          pct: Number.isFinite(m.pct) ? m.pct : null, detail: m.detail ? String(m.detail) : null, text: m.text ? String(m.text) : null,
        });
      }
      return;
    }
    const p = pending.get(m && m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result); else p.reject(Object.assign(new Error(m.error), { step: m.step }));
  });
  worker.on('exit', () => { for (const p of pending.values()) p.reject(new Error('Setup stopped unexpectedly')); pending.clear(); worker = null; });
}
function call(method, ...args) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
}

// ---- requests from the page -----------------------------------------------------------------
function fromOurPage(event) {
  try { return path.normalize(fileURLToPath(event.senderFrame.url)).toLowerCase() === path.normalize(UI).toLowerCase(); } catch { return false; }
}
function on(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => { if (!fromOurPage(event)) throw new Error('Request refused'); return fn(...args); });
}

// Windows-only work at the end: shortcuts (with AMPLE's icon), start with Windows,
// "Apps & features" entry (current user, no administrator) with Uninstall.
async function desktopFinish(opts) {
  const exe = path.join(target, 'electron', 'AMPLE.exe');
  let ico = exe;
  try {
    process.env.AMPLE_ROOT = target;
    ico = (await require(path.join(target, 'control', 'panel', 'icons.js')).ensure()).ico;
  } catch { /* Electron's own icon then */ }
  const link = (file) => shell.writeShortcutLink(file, 'create', {
    target: exe, cwd: path.dirname(exe), description: 'AMPLE control panel', icon: ico, iconIndex: 0, appUserModelId: 'AMPLE',
  });
  if (opts.desktop) link(path.join(app.getPath('desktop'), 'AMPLE.lnk'));
  if (opts.start) link(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AMPLE.lnk'));
  app.setLoginItemSettings({ openAtLogin: !!opts.windows, path: exe, args: ['--hidden'], name: 'AMPLE' });

  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AMPLE';
  const reg = (name, type, value) => spawnSync('reg', ['add', key, '/v', name, '/t', type, '/d', String(value), '/f'], { windowsHide: true });
  reg('DisplayName', 'REG_SZ', 'AMPLE');
  reg('DisplayVersion', 'REG_SZ', VERSION);
  reg('Publisher', 'REG_SZ', 'HimaCode');
  reg('URLInfoAbout', 'REG_SZ', 'https://himacode.com/');
  reg('InstallLocation', 'REG_SZ', target);
  reg('DisplayIcon', 'REG_SZ', ico);
  reg('UninstallString', 'REG_SZ', `"${exe}" --uninstall`);
  reg('NoModify', 'REG_DWORD', 1);
  reg('NoRepair', 'REG_DWORD', 1);
}

function createWindow() {
  win = new BrowserWindow({
    width: 760, height: 760, minWidth: 640, minHeight: 600, show: false, backgroundColor: '#15171c',
    // AMPLE's icon (copied in by build-setup.js) instead of Electron's, on the taskbar from the start
    icon: fs.existsSync(path.join(__dirname, 'icon.png')) ? nativeImage.createFromPath(path.join(__dirname, 'icon.png')) : undefined,
    title: 'AMPLE Setup', autoHideMenuBar: true, titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#15171c', symbolColor: '#c9c5bd', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false, devTools: process.env.AMPLE_DEVTOOLS === '1',
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('close', (e) => {
    if (!installing) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Keep installing', 'Stop setup'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'AMPLE Setup', message: 'AMPLE is still being installed.', detail: 'If you stop now, run AMPLE Setup again later to finish.',
    });
    if (r === 1) { installing = false; if (worker) worker.kill(); app.exit(0); }
  });
  win.loadFile(UI);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    on('setup:defaults', () => {
      let versions = {};
      try {
        const c = JSON.parse(fs.readFileSync(path.join(PAYLOAD, 'control', 'components.json'), 'utf8'));
        versions = { apache: c.apache.version, php: c.php[0].version, mariadb: c.mariadb.version, phpmyadmin: c.phpmyadmin.version, mailpit: c.mailpit.version };
        // An update keeps the components you have (see keepMine in worker.js): show yours.
        try {
          const mine = JSON.parse(fs.readFileSync(path.join(target, 'control', 'components.json'), 'utf8'));
          for (const k of ['apache', 'mariadb', 'phpmyadmin', 'mailpit']) if (mine[k] && mine[k].version) versions[k] = mine[k].version;
          const active = (() => { try { return JSON.parse(fs.readFileSync(path.join(target, 'ample.json'), 'utf8')).php; } catch { return null; } })();
          if (active) versions.php = active;
          else if (Array.isArray(mine.php) && mine.php[0]) versions.php = mine.php[0].version;
        } catch { /* a new install */ }
      } catch { /* names without versions */ }
      return { target, version: VERSION, check: checkTarget(target), versions };
    });
    on('setup:pickFolder', async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: 'C:\\' });
      if (r.canceled || !r.filePaths.length) return null;
      let dir = r.filePaths[0];
      // A drive or a non-empty folder that is not AMPLE: install into an "ample" folder inside it.
      const c = checkTarget(dir);
      if (!c.ok && (/^[A-Za-z]:\\?$/.test(dir) || /not empty/.test(c.reason))) dir = path.join(dir, 'ample');
      target = path.resolve(dir);
      return { target, check: checkTarget(target) };
    });
    on('setup:install', async (scope) => {
      const c = checkTarget(target);
      if (!c.ok) throw new Error(c.reason);
      if (c.mode === 'newer') throw new Error(`A newer AMPLE (${c.installed}) is already installed here. This setup has ${VERSION}.`);
      installing = true;
      // an update or repair keeps the folder permissions chosen the first time
      try { const r = await call('install', scope === 'all' ? 'all' : 'me', { update: c.existing }); installed = true; return r; } finally { installing = false; }
    });
    // After an update: no XAMPP or option pages. Start the services again and record the new version.
    on('setup:finishUpdate', async () => {
      if (!installed) throw new Error('Install first');
      installing = true;
      try {
        const r = await call('finishUpdate');
        spawnSync('reg', ['add', UNINSTALL_KEY, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', VERSION, '/f'], { windowsHide: true });
        spawnSync('reg', ['add', UNINSTALL_KEY, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', target, '/f'], { windowsHide: true });
        return r;
      } finally { installing = false; }
    });
    on('setup:xamppDetect', () => call('xamppDetect'));
    on('setup:xamppPick', async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: 'C:\\' });
      if (r.canceled || !r.filePaths.length) return null;
      return call('xamppSetPath', r.filePaths[0]);
    });
    on('setup:xamppImport', async (dbs, projects, password) => {
      installing = true;
      try { return await call('xamppImport', dbs, projects, password); } finally { installing = false; }
    });
    on('setup:finish', async (opts) => {
      if (!installed) throw new Error('Install first');
      const o = {
        desktop: opts && opts.desktop === true, start: opts && opts.start === true, path: opts && opts.path === true,
        windows: opts && opts.windows === true, https: opts && opts.https === true,
      };
      installing = true;
      try {
        const r = await call('finish', o);
        await desktopFinish(o);
        return r;
      } finally { installing = false; }
    });
    on('setup:open', () => {
      const exe = path.join(target, 'electron', 'AMPLE.exe');
      if (fs.existsSync(exe)) spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.exit(0), 300);
      return true;
    });
    on('setup:quit', () => { if (!installing) app.exit(0); return true; });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { if (worker) worker.kill(); });
}
