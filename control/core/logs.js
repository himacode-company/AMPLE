'use strict';
// List and clear AMPLE's log files.
// Clearing empties each file in place (truncate) instead of deleting it, so it
// works while Apache and MariaDB are running and keep the files open.
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const { log } = require('./logger');

const FILES = {
  apache: ['apache/error.log', 'apache/access.log'],
  php: ['php/error.log'],
  mariadb: ['mariadb/error.log', 'mariadb/slow.log', 'mariadb/general.log', 'mariadb/rescue.log'],
  mailpit: ['mailpit/mailpit.log'],
  ample: ['ample/ample.log'],
};

function list() {
  const out = [];
  for (const [group, files] of Object.entries(FILES)) {
    for (const rel of files) {
      const file = path.join(P.logs, rel);
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* not created yet */ }
      out.push({ group, file: path.relative(P.ROOT, file), size });
    }
  }
  return out;
}

// which: undefined = all, or 'apache' | 'php' | 'mariadb' | 'ample'
function clear(which) {
  const groups = which ? [which] : Object.keys(FILES);
  for (const g of groups) if (!FILES[g]) throw new Error(`Unknown log "${g}". Use: ${Object.keys(FILES).join(', ')}`);
  const done = [], failed = [];
  let freed = 0;
  for (const g of groups) {
    for (const rel of FILES[g]) {
      const file = path.join(P.logs, rel);
      if (!fs.existsSync(file)) continue;
      const size = fs.statSync(file).size;
      try {
        fs.truncateSync(file, 0);
        freed += size;
        done.push(rel);
      } catch (e) {
        failed.push({ file: rel, reason: e.code || e.message });
      }
    }
  }
  // Log Doctor's numbered list refers to the old lines; start fresh.
  fs.rmSync(path.join(P.tmp, 'doctor-last.json'), { force: true });
  // First line of the new log, so it's clear where fresh entries begin.
  log('Logs', 'CLEAR', `${which || 'all'} logs cleared (${done.length} file(s), ${(freed / 1024).toFixed(0)} KB freed)`);
  return { done, failed, freed };
}

module.exports = { list, clear, FILES };
