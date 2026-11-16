'use strict';
// Reads AMPLE's four logs and turns every line into one common shape:
//   { time: Date, source, level, message, file, line, raw, extra[] }
// level: 'error' | 'warning' | 'notice' | 'info'
const fs = require('fs');
const path = require('path');
const P = require('../paths');

const LOGS = {
  php: path.join(P.logs, 'php', 'error.log'),
  apache: path.join(P.logs, 'apache', 'error.log'),
  mariadb: path.join(P.logs, 'mariadb', 'error.log'),
  mailpit: path.join(P.logs, 'mailpit', 'mailpit.log'),
  ample: path.join(P.logs, 'ample', 'ample.log'),
};

// Read only the end of big files.
function readTail(file, maxBytes = 512 * 1024) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text; // drop the cut first line
  } catch { return ''; }
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

// "in C:\x\a.php on line 12"  or  "in C:\x\a.php:12"
function fileLine(msg) {
  let m = msg.match(/ in ([A-Za-z]:[\\/][^\n]*?\.\w+|[^\s\n]+\.\w+) on line (\d+)/);
  if (m) return { file: m[1], line: Number(m[2]) };
  m = msg.match(/ in ([A-Za-z]:[\\/].+?\.\w+):(\d+)/);
  if (m) return { file: m[1], line: Number(m[2]) };
  return { file: null, line: null };
}

// With html_errors=On PHP writes &quot; etc. even into the log file; undo that.
const unescapeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---- PHP: [13-Nov-2026 14:00:00 Asia/Amman] PHP Fatal error:  message in file on line N
function parsePhp(text) {
  const out = [];
  for (const raw of unescapeHtml(text).split(/\r?\n/)) {
    const m = raw.match(/^\[(\d{2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})[^\]]*\] (?:PHP )?([A-Za-z ]+?):\s+(.*)$/);
    if (m) {
      const kind = m[7].toLowerCase();
      const level = /fatal|parse|core error|compile error|recoverable/.test(kind) ? 'error'
        : /warning/.test(kind) ? 'warning' : 'notice';
      out.push({
        time: new Date(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]),
        source: 'php', level, kind: m[7], message: m[8], raw, extra: [], ...fileLine(m[8]),
      });
    } else if (out.length && raw.trim()) {
      out[out.length - 1].extra.push(raw); // stack trace lines etc.
    }
  }
  return out;
}

// ---- Apache. Two time formats:
//   AMPLE:   [2026-11-13 13:13:27] [php:error] [pid 4436] [client 127.0.0.1:57682] AH01071: message
//   default: [Tue Nov 11 15:03:58.123456 2026] [php:error] [pid 1234:tid 5678] [client ::1:5555] message, referer: ...
// (XAMPP uses the default format.) PHP errors written into the Apache log
// ("PHP Fatal error:  ...") are returned as source 'php' so PHP rules apply.
const APACHE_AMPLE_TIME = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})[^\]]*\]/;
const APACHE_DEFAULT_TIME = /^\[\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)? (\d{4})\]/;
const APACHE_REST = /^\s*\[([^:\]]*):([^\]]+)\] \[pid [^\]]+\]\s*(?:\[client ([^\]]+)\])?\s*(.*)$/;

function parseApache(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    let time = null, rest = null, m;
    if ((m = raw.match(APACHE_AMPLE_TIME))) {
      time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      rest = raw.slice(m[0].length);
    } else if ((m = raw.match(APACHE_DEFAULT_TIME))) {
      time = new Date(+m[6], MONTHS[m[1]] ?? 0, +m[2], +m[3], +m[4], +m[5]);
      rest = raw.slice(m[0].length);
    }
    const r = rest !== null ? rest.match(APACHE_REST) : null;
    if (!r) { if (out.length && raw.trim()) out[out.length - 1].extra.push(raw); continue; }

    const lv = r[2].trim();
    let level = /emerg|alert|crit|error/.test(lv) ? 'error' : /warn/.test(lv) ? 'warning' : 'info';
    let message = r[4].replace(/^\s*:\s*/, '').replace(/, referer: \S+$/, '');
    let source = 'apache', kind, extra = [];
    const php = message.match(/^PHP ([A-Za-z ]+?):\s+(.*)$/);
    if (php) {
      source = 'php';
      kind = php[1];
      // Apache escapes PHP's message: newlines become a literal "\n" and "\" becomes "\\".
      const lines = unescapeHtml(php[2]).replace(/\\n/g, '\n').replace(/\\\\/g, '\\').split('\n');
      message = lines[0];
      extra = lines.slice(1).filter((l) => l.trim()); // stack trace
      const k = kind.toLowerCase();
      level = /fatal|parse|core error|compile error|recoverable/.test(k) ? 'error' : /warning/.test(k) ? 'warning' : 'notice';
    }
    out.push({ time, source, level, kind, module: r[1], client: r[3] || null, message, raw, extra, ...fileLine(message) });
  }
  return out;
}

// InnoDB explains one problem over several timestamped lines; these lines
// belong to the previous message instead of being separate problems.
const INNODB_FOLLOW_UP = /^InnoDB: (The error means|If you are installing InnoDB|Some operating system error numbers|Please refer to|Check that you do not already have|Error number \d+ means|Cannot continue operation|You may have to recover)/;

// ---- MariaDB: 2026-11-13 13:12:16 0 [Warning] message
// "Operating system error number 3 in a file operation." comes BEFORE the line
// that names the file; it is attached to that next line.
const INNODB_LEAD_IN = /^InnoDB: Operating system error number \d+ in a file operation/;

function parseMariadb(text) {
  const out = [];
  let leadIn = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+\d+\s+\[(\w+)\]\s+(.*)$/);
    if (!m) { if (out.length && raw.trim()) out[out.length - 1].extra.push(raw); continue; }
    if (INNODB_LEAD_IN.test(m[8])) { leadIn = [raw]; continue; }
    if (INNODB_FOLLOW_UP.test(m[8])) {
      if (leadIn) leadIn.push(raw);
      else if (out.length) out[out.length - 1].extra.push(raw);
      continue;
    }
    const lv = m[7].toLowerCase();
    const level = lv === 'error' ? 'error' : lv === 'warning' ? 'warning' : 'info';
    out.push({
      time: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
      source: 'mariadb', level, message: m[8], raw, extra: leadIn || [], file: null, line: null,
    });
    leadIn = null;
  }
  return out;
}

// ---- Mailpit: time="2026/11/13 15:07:16" level=error msg="[smtpd] listen tcp 127.0.0.1:1025: bind: ..."
function parseMailpit(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^time="(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})" level=(\w+) msg="(.*)"\s*$/);
    if (!m) { if (out.length && raw.trim()) out[out.length - 1].extra.push(raw); continue; }
    const lv = m[7].toLowerCase();
    const level = /error|fatal|panic/.test(lv) ? 'error' : /warn/.test(lv) ? 'warning' : 'info';
    out.push({
      time: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
      source: 'mailpit', level, message: m[8].replace(/\\"/g, '"'), raw, extra: [], file: null, line: null,
    });
  }
  return out;
}

// ---- AMPLE: 2026-11-13 14:02:11  Apache   ERROR   message
function parseAmple(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\s+(\S+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const action = m[8].toUpperCase();
    const level = action === 'ERROR' ? 'error' : action === 'WARN' ? 'warning' : 'info';
    out.push({
      time: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]),
      source: 'ample', level, service: m[7], action, message: m[9], raw, extra: [], file: null, line: null,
    });
  }
  return out;
}

const PARSERS = { php: parsePhp, apache: parseApache, mariadb: parseMariadb, mailpit: parseMailpit, ample: parseAmple };

// All entries from all logs, oldest first. `since`: Date to ignore older lines.
function readAll({ since = null, sources = Object.keys(LOGS) } = {}) {
  const all = [];
  for (const src of sources) {
    for (const e of PARSERS[src](readTail(LOGS[src]))) {
      if (!since || e.time >= since) all.push(e);
    }
  }
  return all.sort((a, b) => a.time - b.time);
}

module.exports = { LOGS, readAll, readTail, parsePhp, parseApache, parseMariadb, parseMailpit, parseAmple };
