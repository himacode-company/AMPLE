'use strict';
// Log Doctor: reads the logs, recognises known problems, explains them in
// English or Arabic, groups repeats, and offers one-click fixes.
//
// A diagnosis has a visible part (title, summary, where, count) and a
// collapsible part (details, causes, steps, action, raw log lines).
const fs = require('fs');
const path = require('path');
const P = require('../paths');
const settings = require('../settings');
const reader = require('./logreader');
const { shortPath } = require('./rules/util');

// Rule files and the logs they apply to. SQL errors appear in both the PHP log
// (as exceptions) and the MariaDB log, so sql.js serves both.
const RULE_FILES = [
  ['./rules/sql', ['php', 'mariadb']],
  ['./rules/php-code', ['php']], // before php.js: vendor/autoload.php beats the general "include" rule
  ['./rules/php', ['php']],
  ['./rules/apache', ['apache']],
  ['./rules/apache-extra', ['apache']],
  ['./rules/mariadb-files', ['mariadb', 'php']], // "doesn't exist in engine" also reaches PHP
  ['./rules/mariadb', ['mariadb']],
  ['./rules/mailpit', ['mailpit']],
  ['./rules/ample', ['ample']],
];
const EXTRA_SOURCES = { 'php.db_access_denied': ['mariadb'] };

// Specific rules first; catch-all rules (generic: true) only when nothing else matched.
const RULES = RULE_FILES
  .flatMap(([file, sources]) => require(file).map((r) => ({ ...r, sources: [...sources, ...(EXTRA_SOURCES[r.id] || [])] })))
  .sort((a, b) => (a.generic ? 1 : 0) - (b.generic ? 1 : 0));

// Notices from libraries you didn't write (vendor/, phpMyAdmin) are grouped into one line.
const THIRD_PARTY = /[\\/](vendor|phpmyadmin|node_modules)[\\/]/i;

const LAST_FILE = path.join(P.tmp, 'doctor-last.json');

const UNKNOWN = {
  title: {
    php: { en: 'PHP {level}', ar: '{levelAr} في PHP' },
    apache: { en: 'Apache {level}', ar: '{levelAr} في Apache' },
    mariadb: { en: 'MariaDB {level}', ar: '{levelAr} في MariaDB' },
    mailpit: { en: 'Mailpit {level}', ar: '{levelAr} في Mailpit' },
    ample: { en: 'AMPLE {level}', ar: '{levelAr} في AMPLE' },
  },
  details: {
    en: 'Log Doctor does not have an explanation for this message yet. The original log text is shown below.',
    ar: 'لا يملك Log Doctor شرحاً لهذه الرسالة بعد. النص الأصلي من السجل معروض أدناه.',
  },
};
const LEVEL_AR = { error: 'خطأ', warning: 'تحذير', notice: 'ملاحظة', info: 'معلومة' };

function language() {
  const s = settings.load();
  return s.language === 'ar' ? 'ar' : 'en';
}

// Fill {placeholders}; text may be a string, an array, or a function(vars).
function fill(t, vars) {
  const v = typeof t === 'function' ? t(vars) : t;
  if (Array.isArray(v)) return v.map((x) => fill(x, vars));
  if (typeof v !== 'string') return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}
const pick = (obj, lang, vars) => (obj ? fill(obj[lang] !== undefined ? obj[lang] : obj.en, vars) : undefined);

function whereOf(entry, lang) {
  if (!entry.file) return lang === 'ar' ? 'الملف المذكور في رسالة الخطأ' : 'the file named in the error';
  return `${shortPath(entry.file, P.ROOT)}${entry.line ? `:${entry.line}` : ''}`;
}

// Diagnose one log entry.
function diagnose(entry, lang = language()) {
  const text = [entry.message, ...entry.extra.slice(0, 3)].join(' ');
  for (const rule of RULES) {
    if (!rule.sources.includes(entry.source)) continue;
    if (rule.kind && !rule.kind.test(entry.kind || '')) continue;
    const m = rule.match.exec(rule.kind ? entry.message : text);
    if (!m) continue;
    const vars = { ...(rule.vars ? rule.vars(m, entry) : {}), where: whereOf(entry, lang) };
    const action = rule.action ? rule.action(vars, entry) : null;
    return {
      id: rule.id,
      startup: !!rule.startup,
      resolvedBy: rule.resolvedBy || null, // e.g. 'Mailpit': solved once that service starts
      level: rule.level || entry.level,
      title: pick(rule.title, lang, vars),
      summary: pick(rule.summary, lang, vars),
      details: pick(rule.details, lang, vars),
      causes: pick(rule.causes, lang, vars) || [],
      steps: pick(rule.steps, lang, vars) || [],
      action: action ? { type: action.type, params: action.params, label: pick(action.label, lang, vars) } : null,
    };
  }
  const vars = { level: entry.level, levelAr: LEVEL_AR[entry.level] || entry.level };
  return {
    id: null,
    level: entry.level,
    title: pick(UNKNOWN.title[entry.source], lang, vars),
    summary: entry.message,
    details: UNKNOWN.details[lang],
    causes: [],
    steps: [],
    action: null,
  };
}

const RANK = { error: 0, warning: 1, notice: 2, info: 3 };

// Scan the logs. Returns grouped problems, most important first.
//   hours: how far back to look (default 24)   all: include notices (404s, etc.)
//   entries: diagnose these parsed lines instead of AMPLE's logs (e.g. XAMPP's logs)
function scan({ hours = 24, all = false, lang = language(), entries: given = null, save = true } = {}) {
  const since = hours ? new Date(Date.now() - hours * 3600 * 1000) : null;
  const entries = given || reader.readAll({ since });

  // Last successful start of each service ("running on port ..." in ample.log).
  // A start-blocking problem older than that has been resolved.
  const lastStart = {};
  for (const e of entries) {
    if (e.source === 'ample' && e.action === 'START' && /^running on port/.test(e.message)) lastStart[e.service] = e.time;
  }
  const serviceOf = (e) => (e.source === 'ample' ? e.service
    : { mariadb: 'MariaDB', apache: 'Apache', mailpit: 'Mailpit' }[e.source] || null);

  const groups = new Map();
  for (const e of entries) {
    if (e.level === 'info') continue;
    const d = diagnose(e, lang);
    if (!all && d.level === 'notice') continue;
    const thirdParty = d.level === 'notice' && e.file && THIRD_PARTY.test(e.file);
    const where = thirdParty
      ? (lang === 'ar' ? 'مكتبات خارجية (vendor / phpMyAdmin)' : 'third-party libraries (vendor / phpMyAdmin)')
      : e.file ? whereOf(e, lang) : null;
    // A problem logged by two services (e.g. a wrong DB password appears in the
    // PHP log AND the MariaDB log) is one problem: group it without source/where.
    const shared = d.id && EXTRA_SOURCES[d.id];
    const key = shared
      ? `${d.id}|${d.title}`
      : thirdParty
        ? `${e.source}|${d.id}|third-party`
        : `${e.source}|${d.id || e.message.replace(/\d+/g, '#')}|${d.title}|${where || ''}`;
    const g = groups.get(key);
    if (g) {
      // The same event from the second log arrives within a second: don't count it twice.
      if (!(shared && e.source !== g.source && Math.abs(e.time - g.last) <= 2000)) g.count++;
      g.last = e.time;
      if (!g.where && where) { g.where = where; g.source = e.source; }
      if (e.source === g.source) g.raw = [e.raw, ...e.extra];
    } else {
      groups.set(key, { ...d, source: e.source, service: serviceOf(e), where, count: 1, first: e.time, last: e.time, raw: [e.raw, ...e.extra] });
    }
  }
  for (const g of groups.values()) {
    // Start-blocking problems are solved by a later start of their own service;
    // others name the service that solves them (resolvedBy).
    const started = lastStart[g.resolvedBy || g.service];
    g.resolved = !!((g.startup || g.resolvedBy) && started && started > g.last);
  }
  const list = [...groups.values()]
    .filter((g) => all || !g.resolved)
    .sort((a, b) => (a.resolved - b.resolved) || (RANK[a.level] - RANK[b.level]) || (b.last - a.last));
  list.forEach((g, i) => { g.n = i + 1; });
  if (save) try {
    fs.mkdirSync(path.dirname(LAST_FILE), { recursive: true });
    fs.writeFileSync(LAST_FILE, JSON.stringify(list, null, 2));
  } catch { /* the list is still returned */ }
  return list;
}

// Problem #n from the last scan (used by "ample doctor <n>" and "ample doctor fix <n>").
function lastScanItem(n) {
  let list;
  try { list = JSON.parse(fs.readFileSync(LAST_FILE, 'utf8')); } catch { list = scan(); }
  return list.find((g) => g.n === Number(n)) || null;
}

async function fix(n) {
  const item = lastScanItem(n);
  if (!item) throw new Error(`No problem #${n}. Run "ample doctor" first.`);
  if (!item.action) throw new Error(`Problem #${n} has no automatic fix; follow the steps in "ample doctor ${n}".`);
  const r = await require('./actions').run(item.action);
  return { ...r, text: r.message[language()] || r.message.en };
}

// Diagnose a fresh error message (e.g. right after a failed start).
function explainText(source, message, lang = language(), fields = {}) {
  return diagnose({ source, level: 'error', message, extra: [], raw: message, file: null, line: null, ...fields }, lang || language());
}

module.exports = { scan, diagnose, lastScanItem, fix, explainText, language, RULES };
