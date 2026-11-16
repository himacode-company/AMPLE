'use strict';
// AMPLE control panel: everything outside the window.
//   - the icon next to the clock (tray): status dot, menu (start / stop / open / quit)
//   - starting with Windows (the user's own startup list: no administrator needed)
//   - Desktop and Start-menu shortcuts with AMPLE's icon
const fs = require('fs');
const path = require('path');
const { app, Menu, Tray, shell } = require('electron');
const settings = require('../core/settings');

const L = {
  en: {
    running: 'running', stopped: 'stopped', notAnswering: 'not answering', open: 'Open AMPLE',
    startAll: 'Start all', stopAll: 'Stop all', quit: 'Quit AMPLE (stops the services)',
    allUp: 'everything is running', allDown: 'everything is stopped', some: (u, a) => `${u} of ${a} running`,
    hintTitle: 'AMPLE is still here', hintText: 'It keeps running next to the clock. Right-click the icon to quit.',
    stopping: 'stopping the services…',
  },
  ar: {
    running: 'يعمل', stopped: 'متوقف', notAnswering: 'لا يستجيب', open: 'فتح AMPLE',
    startAll: 'تشغيل الكل', stopAll: 'إيقاف الكل', quit: 'إنهاء AMPLE (يوقف الخدمات)',
    allUp: 'كل الخدمات تعمل', allDown: 'كل الخدمات متوقفة', some: (u, a) => `${u} من ${a} تعمل`,
    hintTitle: 'AMPLE ما زال يعمل', hintText: 'يبقى بجانب الساعة. اضغط الأيقونة بالزر الأيمن للإنهاء.',
    stopping: 'جارٍ إيقاف الخدمات…',
  },
};
const tr = () => L[settings.load().language === 'ar' ? 'ar' : 'en'];

// ---- tray --------------------------------------------------------------------------------------
let tray = null, ctx = null, lastKey = null, lastStatus = null;

// c = { icons, show(), run(method), open(target), quit() }
function initTray(c) {
  ctx = c;
  tray = new Tray(c.icons ? c.icons.tray.off : require('electron').nativeImage.createEmpty());
  tray.setToolTip('AMPLE');
  tray.on('click', () => ctx.show());
  update(null);
}

function update(status) {
  if (!tray) return;
  if (status) lastStatus = status;
  const t = tr();
  const list = lastStatus ? lastStatus.services : [];
  const up = list.filter((s) => s.running && s.answering).length;
  const state = !list.length || up === 0 ? 'off' : up === list.length ? 'ok' : 'partial';
  const key = JSON.stringify([state, t.open, list.map((s) => [s.name, s.running, s.answering])]);
  if (key === lastKey) return; // rebuilding an open menu would close it
  lastKey = key;
  if (ctx.icons) tray.setImage(ctx.icons.tray[state]);
  const summary = !list.length ? 'AMPLE' : up === list.length ? t.allUp : up === 0 ? t.allDown : t.some(up, list.length);
  tray.setToolTip(`AMPLE · ${summary}`);
  const items = [
    { label: t.open, click: () => ctx.show() },
    { type: 'separator' },
    ...list.map((s) => ({
      label: `${s.running && s.answering ? '●' : '○'}  ${s.label} · ${s.running ? (s.answering ? t.running : t.notAnswering) : t.stopped}`,
      enabled: false,
    })),
    { type: 'separator' },
    { label: t.startAll, enabled: up < list.length, click: () => ctx.run('startAll') },
    { label: t.stopAll, enabled: up > 0, click: () => ctx.run('stopAll') },
    { type: 'separator' },
    { label: 'localhost', click: () => ctx.open('localhost') },
    { label: 'phpMyAdmin', click: () => ctx.open('phpmyadmin') },
    { label: 'Mailpit', click: () => ctx.open('mailpit') },
    { type: 'separator' },
    { label: t.quit, click: () => ctx.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function stopping() { if (tray) tray.setToolTip('AMPLE · ' + tr().stopping); }

// The first time the window is closed: "AMPLE is still here, next to the clock".
function hintOnce() {
  const s = settings.load();
  if (!tray || s.panel.trayHintShown) return;
  const t = tr();
  try { tray.displayBalloon({ title: t.hintTitle, content: t.hintText, iconType: 'info' }); } catch { /* old Windows */ }
  settings.update({ panel: { trayHintShown: true } });
}

// ---- start with Windows --------------------------------------------------------------------
const LOGIN = () => ({ path: process.execPath, args: ['--hidden'], name: 'AMPLE' });
function setStartWithWindows(on) {
  app.setLoginItemSettings({ ...LOGIN(), openAtLogin: !!on });
  settings.update({ panel: { startWithWindows: !!on } });
}
// On every launch: keep Windows' entry in step with the setting (AMPLE may have been moved).
function syncLogin() {
  const want = !!settings.load().panel.startWithWindows;
  const has = app.getLoginItemSettings(LOGIN()).openAtLogin;
  if (want || has) app.setLoginItemSettings({ ...LOGIN(), openAtLogin: want });
}

// ---- shortcuts --------------------------------------------------------------------------------
const SHORTCUTS = {
  desktop: () => path.join(app.getPath('desktop'), 'AMPLE.lnk'),
  start: () => path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AMPLE.lnk'),
};
function shortcuts() {
  return Object.fromEntries(Object.entries(SHORTCUTS).map(([k, f]) => [k, fs.existsSync(f())]));
}
function setShortcut(where, on, ico) {
  if (!SHORTCUTS[where]) throw new Error('Unknown shortcut: ' + where);
  const file = SHORTCUTS[where]();
  if (!on) { fs.rmSync(file, { force: true }); return shortcuts(); }
  const ok = shell.writeShortcutLink(file, 'create', {
    target: process.execPath, cwd: path.dirname(process.execPath), description: 'AMPLE control panel',
    icon: ico || process.execPath, iconIndex: 0, appUserModelId: 'AMPLE',
  });
  if (!ok) throw new Error('Windows did not create the shortcut');
  return shortcuts();
}

module.exports = { initTray, update, stopping, hintOnce, setStartWithWindows, syncLogin, shortcuts, setShortcut };
