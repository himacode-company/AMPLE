'use strict';
// AMPLE's icons, made from the SVG logo (control\assets\logo) by Electron itself: no image file
// is shipped and AMPLE.exe is never modified. Drawn once in a hidden window, then kept in
// tmp\panel\icons (made again only when the logo changes).
//   window / taskbar : 256 px PNG
//   tray (clock)     : 16 + 32 px, with a status dot (green / yellow / grey)
//   ample.ico        : 16-256 px, for the Desktop and Start-menu shortcuts
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BrowserWindow, nativeImage } = require('electron');
const P = require('../core/paths');

const LOGO_DIR = P.p('control', 'assets', 'logo');
const OUT = path.join(P.tmp, 'panel', 'icons');
const ICO_FOR_SHORTCUTS = path.join(LOGO_DIR, 'ample.ico');
const DOTS = { ok: '#3fb97c', partial: '#f0b429', off: '#8b9099' };

// Draw one SVG (plus an optional status dot) at 256 x 256 in an off-screen window.
function render(svg, dot) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 256, height: 256, show: false, frame: false, transparent: true, useContentSize: true,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: false },
    });
    const css = 'html,body{margin:0;width:256px;height:256px;overflow:hidden;background:transparent}'
      + 'svg{width:256px;height:256px;display:block}'
      + '.dot{position:absolute;right:0;bottom:0;width:124px;height:124px;border-radius:50%;box-sizing:border-box;border:24px solid #141414}';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${svg}`
      + (dot ? `<div class="dot" style="background:${dot}"></div>` : '') + '</body></html>';
    let loaded = false, done = false;
    const finish = (err, img) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      if (err) reject(err); else resolve(img);
    };
    const timer = setTimeout(() => finish(new Error('drawing the icon took too long')), 10000);
    win.webContents.on('paint', (_e, _dirty, image) => { if (loaded && !image.isEmpty()) finish(null, image); });
    win.webContents.on('did-finish-load', () => { loaded = true; win.webContents.invalidate(); });
    win.webContents.setFrameRate(10);
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch((e) => finish(e));
  });
}

const png = (img, size) => img.resize({ width: size, height: size, quality: 'best' }).toPNG();

// .ico = a small header + one PNG per size (supported since Windows Vista).
function makeIco(list) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(list.length, 4);
  const dir = Buffer.alloc(16 * list.length);
  let offset = 6 + dir.length;
  list.forEach(({ size, buf }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([head, dir, ...list.map((x) => x.buf)]);
}

function trayImage(files) {
  const img = nativeImage.createEmpty();
  for (const [scale, file] of files) img.addRepresentation({ scaleFactor: scale, buffer: fs.readFileSync(file) });
  return img;
}

// Make (or reuse) every icon. Returns { window, ico, tray: { ok, partial, off } }.
async function ensure() {
  const logo = fs.readFileSync(path.join(LOGO_DIR, 'ample-logo.svg'), 'utf8');
  const small = fs.readFileSync(path.join(LOGO_DIR, 'ample-icon-16.svg'), 'utf8');
  const key = crypto.createHash('sha256').update(logo + small + 'v1').digest('hex').slice(0, 16);
  const keyFile = path.join(OUT, 'key.txt');
  const f = (name) => path.join(OUT, name);
  const fresh = (() => { try { return fs.readFileSync(keyFile, 'utf8') === key; } catch { return false; } })();

  if (!fresh) {
    fs.mkdirSync(OUT, { recursive: true });
    const big = await render(logo);
    const tiny = await render(small);
    fs.writeFileSync(f('app-256.png'), png(big, 256));
    const icoList = [16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, buf: png(s <= 24 ? tiny : big, s) }));
    const ico = makeIco(icoList);
    fs.writeFileSync(f('ample.ico'), ico);
    try { fs.writeFileSync(ICO_FOR_SHORTCUTS, ico); } catch { /* shortcuts fall back to tmp */ }
    for (const [state, color] of Object.entries(DOTS)) {
      const img = await render(small, color);
      for (const s of [16, 20, 24, 32]) fs.writeFileSync(f(`tray-${state}-${s}.png`), png(img, s));
    }
    fs.writeFileSync(keyFile, key);
  }
  if (!fs.existsSync(ICO_FOR_SHORTCUTS)) { try { fs.copyFileSync(f('ample.ico'), ICO_FOR_SHORTCUTS); } catch { /* ignore */ } }

  const tray = {};
  for (const state of Object.keys(DOTS)) {
    tray[state] = trayImage([[1, f(`tray-${state}-16.png`)], [1.25, f(`tray-${state}-20.png`)], [1.5, f(`tray-${state}-24.png`)], [2, f(`tray-${state}-32.png`)]]);
  }
  return {
    window: nativeImage.createFromPath(f('app-256.png')),
    ico: fs.existsSync(ICO_FOR_SHORTCUTS) ? ICO_FOR_SHORTCUTS : f('ample.ico'),
    tray,
  };
}

module.exports = { ensure };
