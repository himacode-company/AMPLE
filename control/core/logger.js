'use strict';
// ample's own event log: logs/ample/ample.log — one readable line per event.
// Format: 2026-11-13 14:02:11  Apache   START   running on port 80 (pid 1234)
const fs = require('fs');
const path = require('path');
const P = require('./paths');

const FILE = path.join(P.logs, 'ample', 'ample.log');
const listeners = new Set();

function stamp(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

function log(service, action, message, level = 'info') {
  const line = `${stamp()}  ${service.padEnd(8)} ${action.padEnd(7)} ${message}`;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, line + '\n');
  } catch { /* logging must never crash the app */ }
  for (const fn of listeners) fn({ time: new Date(), service, action, message, level, line });
  return line;
}

module.exports = { log, stamp, FILE, onLog: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
