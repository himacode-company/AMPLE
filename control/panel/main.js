'use strict';
// AMPLE control panel: Electron's main process.
//
// Security
//   - the window shows only AMPLE's own local page (ui\index.html); it has NO Node access
//     (contextIsolation + sandbox) and can call only the few functions preload.js exposes
//   - every request is checked to come from that page; it cannot navigate away, open other
//     windows or webviews, and every browser permission (camera, notifications...) is refused
//   - links to websites open in the normal browser, never inside the panel
//
// The real work (status, start, stop, ...) runs in worker.js: a separate Node process, so a
// slow task (a service taking 30 s to start, a big import) never freezes the window.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { fileURLToPath } = require('url');
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, Notification, shell, session, utilityProcess } = require('electron');
const P = require('../core/paths');
const settings = require('../core/settings');
const services = require('../core/services');

const UI = path.join(__dirname, 'ui', 'index.html');

// Everything the panel stores (cache, window state) stays inside AMPLE: portable, no traces
// in the user's AppData.
app.setPath('userData', path.join(P.tmp, 'panel'));
app.setAppUserModelId('AMPLE');

// ---- worker: AMPLE's core in its own process -----------------------------------------------
let worker = null;
let seq = 0;
const pending = new Map();

function startWorker() {
  worker = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'AMPLE core', stdio: 'ignore' });
  worker.on('message', (m) => {
    // Progress of a long task (update, backup, import, rescue): only these plain fields reach the window.
    if (m && m.event === 'progress') {
      const num = (v) => (Number.isFinite(v) ? v : null);
      const p = { kind: String(m.kind || ''), text: m.text == null ? null : String(m.text), pct: num(m.pct), read: num(m.read), total: num(m.total) };
      if (win && !win.isDestroyed()) win.webContents.send('ample:progress', p);
      return;
    }
    const p = pending.get(m && m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
  });
  worker.on('exit', () => {
    for (const p of pending.values()) p.reject(new Error('AMPLE core stopped unexpectedly'));
    pending.clear();
    worker = null; // started again on the next request
  });
}

function call(method, ...args) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
}

// ---- requests from the page -----------------------------------------------------------------
function fromOurPage(event) {
  try {
    const url = event.senderFrame && event.senderFrame.url;
    return !!url && url.startsWith('file:') && path.normalize(fileURLToPath(url)).toLowerCase() === path.normalize(UI).toLowerCase();
  } catch { return false; }
}

function handle(channel, method) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurPage(event)) throw new Error('Request refused');
    return call(method, ...args);
  });
}

// Links and folders the page may open. The page only sends a NAME from this list, never a
// URL or a path, so it cannot open anything else.
function openTarget(what) {
  const port = settings.load().ports.http;
  const host = 'http://localhost' + (port === 80 ? '' : ':' + port);
  const LINKS = {
    localhost: host + '/', phpmyadmin: host + '/phpmyadmin/', mailpit: host + '/mailpit/', phpinfo: host + '/ample/?page=phpinfo',
    mailguide: host + '/ample/?page=mailpit',
    // AMPLE's website (the side menu): in the panel's language
    docs: 'https://ample.himacode.com/docs/' + (settings.load().language === 'ar' ? '?lang=ar' : ''),
    guides: 'https://ample.himacode.com/guides/' + (settings.load().language === 'ar' ? '?lang=ar' : ''),
    himacode: 'https://himacode.com/' + (settings.load().language === 'ar' ? '?lang=ar' : ''),
  };
  if (Object.prototype.hasOwnProperty.call(LINKS, what)) return shell.openExternal(LINKS[what]).then(() => ({ ok: true }));
  const FOLDERS = { htdocs: P.htdocs, logs: P.logs, backups: P.p('backups') };
  if (Object.prototype.hasOwnProperty.call(FOLDERS, what)) {
    fs.mkdirSync(FOLDERS[what], { recursive: true });
    return shell.openPath(FOLDERS[what]).then((err) => (err ? { ok: false, message: err } : { ok: true }));
  }
  throw new Error('Not allowed: ' + what);
}

// A site in the browser or its folder. The page sends only a site NAME and what to open; the
// address / folder comes from AMPLE's own list, so nothing else can be opened.
async function openSite(name, kind) {
  const sitesMod = require('../core/sites');
  const site = sitesMod.list().sites.find((x) => x.name === name);
  if (site) {
    if (kind === 'http') return shell.openExternal(site.url).then(() => ({ ok: true }));
    if (kind === 'https' && site.httpsUrl) return shell.openExternal(site.httpsUrl).then(() => ({ ok: true }));
    if (kind === 'folder') return shell.openPath(site.dir).then((err) => (err ? { ok: false, message: err } : { ok: true }));
  }
  const skipped = sitesMod.list().skipped.find((k) => k.name === name);
  if (skipped && kind === 'folder') {
    return shell.openPath(path.join(P.htdocs, skipped.name)).then((err) => (err ? { ok: false, message: err } : { ok: true }));
  }
  const own = sitesMod.ownHosts().find((h) => h.name === name);
  if (own && /^[a-z0-9.-]+$/i.test(own.name)) {
    if (kind === 'http' || kind === 'https') {
      const s = settings.load();
      const port = own.https ? s.ports.https : s.ports.http;
      const def = own.https ? 443 : 80;
      return shell.openExternal(`${own.https ? 'https' : 'http'}://${own.name}${port === def ? '' : ':' + port}/`).then(() => ({ ok: true }));
    }
    if (kind === 'folder' && own.docroot && fs.existsSync(own.docroot)) {
      return shell.openPath(own.docroot).then((err) => (err ? { ok: false, message: err } : { ok: true }));
    }
  }
  return { ok: false, message: 'Not found: ' + name };
}

// One email in Mailpit. The page sends only the message ID (letters, digits, hyphens).
function openMail(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new Error('Invalid message id');
  const port = settings.load().ports.http;
  const host = 'http://localhost' + (port === 80 ? '' : ':' + port);
  return shell.openExternal(`${host}/mailpit/view/${id}`).then(() => ({ ok: true }));
}

// A database in phpMyAdmin (its structure page). The name only goes into the query string.
function openDb(name) {
  if (typeof name !== 'string' || !name || name.length > 64) throw new Error('Invalid database name');
  const port = settings.load().ports.http;
  const host = 'http://localhost' + (port === 80 ? '' : ':' + port);
  return shell.openExternal(`${host}/phpmyadmin/index.php?route=/database/structure&db=${encodeURIComponent(name)}`).then(() => ({ ok: true }));
}

// Import: the FILE is chosen in Windows' own "Open" box and kept here; the page only learns its
// name and size, then sends the target database name. It can never pass a path.
let importFile = null;
async function pickImportFile() {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'SQL (.sql, .sql.gz, .zip)', extensions: ['sql', 'gz', 'zip'] }],
  });
  if (r.canceled || !r.filePaths.length) { importFile = null; return null; }
  importFile = r.filePaths[0];
  return { name: path.basename(importFile), bytes: fs.statSync(importFile).size };
}
// XAMPP's folder, chosen in Windows' own folder box (XAMPP itself, or its mysql\data folder).
async function xamppPick() {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: 'C:\\' });
  if (r.canceled || !r.filePaths.length) return null;
  return call('xamppSetPath', r.filePaths[0]);
}

function dbImport(db) {
  if (!importFile) throw new Error('Choose a file first');
  const file = importFile;
  importFile = null;
  return call('dbImport', file, typeof db === 'string' && db.trim() ? db.trim() : null);
}

// A service's log file, opened in the program Windows uses for .log files (Notepad by default).
async function openLog(name) {
  if (!services.ORDER.includes(name)) throw new Error('Unknown service: ' + name);
  const file = services.SERVICES[name].errorLog();
  if (!fs.existsSync(file)) return { ok: false, message: 'This service has no log yet.' };
  const err = await shell.openPath(file);
  return err ? { ok: false, message: err } : { ok: true };
}

// Light / dark for the panel window: 'system' (follow Windows) | 'dark' | 'light'.
const APPEARANCES = ['system', 'dark', 'light'];
function applyAppearance(value) {
  nativeTheme.themeSource = APPEARANCES.includes(value) ? value : 'system';
}
function setAppearance(value) {
  if (!APPEARANCES.includes(value)) throw new Error('Unknown appearance: ' + value);
  settings.update({ appearance: value });
  applyAppearance(value);
  return value;
}

function handleLocal(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOurPage(event)) throw new Error('Request refused');
    return fn(...args);
  });
}

// ---- window ---------------------------------------------------------------------------------
let win = null;
let icons = null;          // made from the SVG logo (icons.js)
let quitting = false;      // true once "Quit AMPLE" (or Windows shutting down) started
const startHidden = process.argv.includes('--hidden'); // started with Windows: tray only

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 740, minWidth: 900, minHeight: 600,
    show: false, backgroundColor: '#15171c', title: 'AMPLE', autoHideMenuBar: true,
    icon: icons ? icons.window : undefined,
    // Our own dark title bar; Windows still draws its real minimize / maximize / close
    // buttons on it (in our colors), so dragging and Snap layouts work as usual.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#15171c', symbolColor: '#c9c5bd', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      spellcheck: false, devTools: process.env.AMPLE_DEVTOOLS === '1',
    },
  });
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });
  // ✕ hides the window: AMPLE keeps running next to the clock ("Quit AMPLE" in its menu).
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    require('./desktop').hintOnce();
  });
  // Windows is shutting down / signing out: stop the services cleanly first (MariaDB above
  // all: an unclean stop is XAMPP's famous "MySQL shutdown unexpectedly").
  win.on('query-session-end', (e) => {
    if (quitting) return;
    if (settings.load().panel.safeShutdown) e.preventDefault();
    quitAmple();
  });
  win.on('closed', () => { win = null; });
  win.loadFile(UI);
}

function focusWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// "Quit AMPLE" (tray menu, or Windows shutting down): stop every service cleanly, close a
// public link, then exit. Never waits more than 60 s.
async function quitAmple() {
  if (quitting) return;
  quitting = true;
  require('./desktop').stopping();
  try { require('../core/share').killTunnel(); } catch { /* nothing shared */ }
  try {
    await Promise.race([call('stopAll'), new Promise((r) => setTimeout(r, 60000))]);
  } catch { /* exit anyway */ }
  if (worker) worker.kill();
  app.exit(0);
}

// "Uninstall" in Windows' Apps & features runs: AMPLE.exe --uninstall
async function uninstallAmple() {
  const ar = settings.load().language === 'ar';
  const T = ar ? {
    title: 'إلغاء تثبيت AMPLE', msg: 'إلغاء تثبيت AMPLE؟', detail: `يمكن الاحتفاظ بمشاريعك (htdocs) وقواعد بياناتك (mariadb\\data) ونسخك الاحتياطية في ${P.ROOT}.`,
    keep: 'إلغاء التثبيت مع الاحتفاظ بمشاريعي وقواعد بياناتي', all: 'إلغاء تثبيت كل شيء', cancel: 'إلغاء',
  } : {
    title: 'Uninstall AMPLE', msg: 'Uninstall AMPLE?', detail: `Your projects (htdocs), databases (mariadb\\data) and backups can be kept in ${P.ROOT}.`,
    keep: 'Uninstall, keep my projects and databases', all: 'Uninstall everything', cancel: 'Cancel',
  };
  const r = await dialog.showMessageBox({ type: 'question', title: T.title, message: T.msg, detail: T.detail,
    buttons: [T.keep, T.all, T.cancel], defaultId: 0, cancelId: 2, noLink: true });
  if (r.response === 2) return false;
  const keep = r.response === 0;

  // Never delete a folder that is not AMPLE (or a whole drive).
  const root = path.resolve(P.ROOT);
  if (!fs.existsSync(path.join(root, 'control', 'core', 'paths.js')) || /^[A-Za-z]:\\?$/.test(root)) throw new Error('Not an AMPLE folder: ' + root);

  quitting = true;
  try { require('../core/share').killTunnel(); } catch { /* nothing shared */ }
  try { await Promise.race([call('stopAll'), new Promise((res) => setTimeout(res, 60000))]); } catch { /* go on */ }
  if (worker) worker.kill();
  try { require('../core/https').untrust(); } catch { /* not trusted */ }
  try { require('../core/shell').pathRemove(); } catch { /* not in PATH */ }
  try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: ['--hidden'], name: 'AMPLE' }); } catch { /* ignore */ }
  for (const f of [path.join(app.getPath('desktop'), 'AMPLE.lnk'), path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AMPLE.lnk')]) {
    fs.rmSync(f, { force: true });
  }
  spawnSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AMPLE', '/f'], { windowsHide: true });

  // The files are deleted by a small script once AMPLE.exe has closed (it cannot delete itself).
  const q = (s) => "'" + s.replace(/'/g, "''") + "'";
  const script = [
    `$root = ${q(root)}`,
    `for ($i = 0; $i -lt 60 -and (Get-Process -Name AMPLE -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($root + '\\*') }); $i++) { Start-Sleep -Milliseconds 500 }`,
    keep
      ? "Get-ChildItem -LiteralPath $root -Force | Where-Object { @('htdocs','backups','ample.json','mariadb') -notcontains $_.Name } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; " +
        "Get-ChildItem -LiteralPath (Join-Path $root 'mariadb') -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'data' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"
      : 'Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.exit(0);
  return true;
}

// The status of the services for the icon next to the clock.
function trayLoop() {
  call('status').then((s) => require('./desktop').update(s)).catch(() => {}).finally(() => {
    if (!quitting) setTimeout(trayLoop, 5000);
  });
}

// Only one panel at a time: opening it again brings the open one to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second start: "Uninstall" from Windows (AMPLE.exe --uninstall) or simply "show the panel".
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--uninstall')) uninstallAmple().catch(() => {});
    else focusWindow();
  });

  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.on('will-attach-webview', (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Started by Windows' "Uninstall": only the uninstall question, no panel.
    if (process.argv.includes('--uninstall')) {
      try { if (!(await uninstallAmple())) app.exit(0); } catch { app.exit(1); }
      return;
    }
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    handle('ample:status', 'status');
    handle('ample:problems', 'problems');
    for (const m of ['start', 'stop', 'restart', 'startAll', 'stopAll', 'doctor', 'doctorFix', 'clearLogs',
      'getSettings', 'setLanguage', 'setDesign', 'setPath', 'getPorts', 'setPorts', 'changePassword',
      'checkPc', 'fixDefender', 'updatesCheck', 'updatesApply', 'ampleUpdate',
      'sites', 'siteCreate', 'siteRename', 'sitesApply', 'httpsSet', 'httpsTrust', 'httpsUntrust']) handle('ample:' + m, m);
    handleLocal('ample:openSite', openSite);
    for (const m of ['databases', 'dbCreate', 'dbBackup', 'dbRestore', 'rescue']) handle('ample:' + m, m);
    handleLocal('ample:openDb', openDb);
    for (const m of ['mail', 'mailTest', 'mailClear', 'shareStatus', 'shareInstall', 'shareStart', 'shareStop']) handle('ample:' + m, m);
    // The public link is opened with the browser like any address, after checking it IS one.
    handleLocal('ample:openShare', (url) => {
      if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(url)) throw new Error('Not a share link');
      return shell.openExternal(url).then(() => ({ ok: true }));
    });
    handleLocal('ample:openMail', openMail);
    for (const m of ['php', 'phpExtensions', 'phpAvailable', 'phpUse', 'phpCompare', 'phpAdd', 'phpIniSet', 'phpExtSet', 'xdebugSet']) handle('ample:' + m, m);
    // "Copy" buttons: text only, limited size (the page itself gets no clipboard permission).
    handleLocal('ample:copy', (text) => { clipboard.writeText(String(text).slice(0, 10000)); return { ok: true }; });
    handleLocal('ample:pickImportFile', pickImportFile);
    handleLocal('ample:dbImport', dbImport);
    for (const m of ['xamppInventory', 'xamppImport']) handle('ample:' + m, m);
    handleLocal('ample:xamppPick', xamppPick);
    handleLocal('ample:open', openTarget);
    // "Update" next to Electron (control panel): the panel cannot replace its own running files,
    // so a small helper ("ample panel-update", in its own window) waits for the panel to close,
    // updates Electron, and opens AMPLE again. Apache, MariaDB and Mailpit keep running.
    handleLocal('ample:panelUpdate', () => {
      const node = P.p('control', 'runtime', 'node.exe'), cli = P.p('control', 'cli', 'ample.js');
      if (!fs.existsSync(node) || !fs.existsSync(cli)) throw new Error('AMPLE\'s command line is missing: run AMPLE Setup again');
      spawn('cmd.exe', ['/c', 'start', 'AMPLE update', node, cli, 'panel-update'], { cwd: P.ROOT, detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => {
        quitting = true;                       // not quitAmple(): the services stay on
        try { require('../core/share').killTunnel(); } catch { /* nothing shared */ }
        if (worker) worker.kill();
        app.exit(0);
      }, 700);
      return { ok: true };
    });
    // Updates found when the panel opened: a Windows notification; clicking it opens Settings.
    // The page sends only a count and short names; the words are written here.
    handleLocal('ample:notifyUpdates', (count, names) => {
      const n = Math.max(0, Math.min(99, Number(count) || 0));
      if (!n || !Notification.isSupported()) return { ok: false };
      const list = (Array.isArray(names) ? names : []).map((x) => String(x).slice(0, 40)).slice(0, 6).join(', ');
      const ar = settings.load().language === 'ar';
      const note = new Notification({
        title: ar ? (n === 1 ? 'تحديث جديد في AMPLE' : `${n} تحديثات جديدة في AMPLE`) : (n === 1 ? 'An AMPLE update is available' : `${n} AMPLE updates are available`),
        body: (ar ? 'متوفر الآن: ' : 'Ready to install: ') + list + (ar ? '\nاضغط لفتح الإعدادات.' : '\nClick to open Settings.'),
        icon: icons && icons.window ? icons.window : undefined,
      });
      note.on('click', () => { focusWindow(); if (win && !win.isDestroyed()) win.webContents.send('ample:goto', 'settings'); });
      note.show();
      return { ok: true };
    });
    handleLocal('ample:openLog', openLog);
    handleLocal('ample:setAppearance', setAppearance);
    // Startup, shortcuts, welcome screen (all handled here: they belong to the panel itself).
    const desktop = require('./desktop');
    handleLocal('ample:getStartup', () => {
      const p = settings.load().panel;
      return { startWithWindows: !!p.startWithWindows, startServicesOnOpen: !!p.startServicesOnOpen,
        safeShutdown: !!p.safeShutdown, firstRunDone: !!p.firstRunDone, shortcuts: desktop.shortcuts() };
    });
    handleLocal('ample:setStartup', (key, value) => {
      if (typeof value !== 'boolean') throw new Error('Expected true or false');
      if (key === 'startWithWindows') desktop.setStartWithWindows(value);
      else if (key === 'startServicesOnOpen' || key === 'safeShutdown') settings.update({ panel: { [key]: value } });
      else throw new Error('Unknown setting: ' + key);
      return { ok: true };
    });
    handleLocal('ample:setShortcut', (where, on) => desktop.setShortcut(where, !!on, icons && icons.ico));
    handleLocal('ample:firstRunDone', () => { settings.update({ panel: { firstRunDone: true } }); return { ok: true }; });
    try { applyAppearance(settings.load().appearance); } catch { /* keep following Windows */ }

    try { icons = await require('./icons').ensure(); } catch { icons = null; /* Electron's own icon then */ }
    createWindow();
    desktop.initTray({
      icons,
      show: focusWindow,
      run: (method) => call(method).catch(() => {}),
      open: (target) => { try { openTarget(target); } catch { /* ignore */ } },
      quit: quitAmple,
    });
    try { desktop.syncLogin(); } catch { /* not critical */ }
    trayLoop();
    if (settings.load().panel.startServicesOnOpen) call('startAll').catch(() => {});
  });

  // The window is only hidden on ✕; AMPLE ends with "Quit AMPLE" (which stops the services).
  app.on('window-all-closed', () => { /* keep running next to the clock */ });
  app.on('before-quit', (e) => { if (!quitting) { e.preventDefault(); quitAmple(); } });
  app.on('will-quit', () => {
    // A public link never outlives the panel that opened it.
    try { require('../core/share').killTunnel(); } catch { /* nothing shared */ }
    if (worker) worker.kill();
  });
}
