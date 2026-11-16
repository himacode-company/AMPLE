'use strict';
// AMPLE's own version, from control\version.json (the only place it is written).
//   full:  "1.0.0"   short: "1.0" (a trailing ".0" dropped, as people read it: AMPLE 1.0, 1.0.1, 1.2)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'version.json');

function full(file = FILE) {
  try { return String(JSON.parse(fs.readFileSync(file, 'utf8')).version || '').trim() || null; } catch { return null; }
}
const short = (v) => (v ? String(v).replace(/\.0$/, '') : v);

// -1 if a < b, 0 if equal, 1 if a > b ("1.0.0" vs "1.0.1", missing parts count as 0)
function compare(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

module.exports = { FILE, full, short, compare, get version() { return full(); } };
