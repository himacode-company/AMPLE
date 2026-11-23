#!/usr/bin/env node
'use strict';
// ample command-line tool. The Electron control panel uses the same core modules.
const [cmd, ...args] = process.argv.slice(2);
require('../core/logger').onLog((e) => console.log(e.line));
const path = require('path');

// "ample start" = both, "ample start apache" = one.
const pick = () => (args[0] ? [args[0]] : [...require('../core/services').ORDER]);
const svc = () => require('../core/services');

// ---- Log Doctor output --------------------------------------------------------
const ICON = { error: '✖', warning: '⚠', notice: '·' };
// Colors only in a real terminal (not when output is piped or captured).
const C = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m', reset: '\x1b[0m' }
  : { red: '', yellow: '', dim: '', bold: '', cyan: '', reset: '' };
const COLOR = { error: C.red, warning: C.yellow, notice: C.dim };
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);

// Visible part: title, summary, where, count.
function printSummary(d, ar) {
  const count = d.count > 1 ? ` ×${d.count}` : '';
  const when = d.last ? `  ${C.dim}${hhmm(d.last)}${C.reset}` : '';
  const icon = d.resolved ? '✔' : (ICON[d.level] || '·');
  const tag = d.resolved ? `  ${C.dim}(${ar ? 'تم حلّها' : 'resolved'})${C.reset}` : '';
  console.log(` ${String(d.n || '').padStart(2)}  ${d.resolved ? C.dim : (COLOR[d.level] || '')}${icon}  ${C.bold}${d.title}${C.reset}${C.dim}${count}${C.reset}${when}${tag}`);
  console.log(`       ${d.summary}`);
  if (d.where) console.log(`       ${C.cyan}${d.where}${C.reset}`);
}

// Collapsible part: details, causes, steps, fix, raw log.
function printDetails(d, ar) {
  const h = (en, a) => `${C.bold}${ar ? a : en}${C.reset}`;
  console.log('');
  printSummary(d, ar);
  console.log(`\n${h('What happened?', 'ما الذي حدث؟')}\n  ${d.details}`);
  if (d.causes.length) console.log(`\n${h('Common causes', 'الأسباب الشائعة')}\n` + d.causes.map((c) => `  • ${c}`).join('\n'));
  if (d.steps.length) console.log(`\n${h('How to fix it', 'طريقة الحل')}\n` + d.steps.map((s, i) => `  ${i + 1}. ${s.replace(/\n/g, '\n     ')}`).join('\n'));
  if (d.action) {
    const how = d.n ? `ample doctor fix ${d.n}` : (ar ? 'ample doctor  ثم  ample doctor fix <رقم>' : 'ample doctor  then  ample doctor fix <n>');
    console.log(`\n${h('Automatic fix', 'الحل التلقائي')}\n  [ ${d.action.label} ]  →  ${how}`);
  }
  if (d.raw && d.raw.length) console.log(`\n${h('Original log', 'السجل الأصلي')}\n${C.dim}` + d.raw.slice(0, 12).map((l) => `  ${l}`).join('\n') + C.reset);
  console.log('');
}

const commands = {
  async doctor() {
    const doc = require('../core/doctor');
    const ar = doc.language() === 'ar';
    if (args[0] === 'fix') {
      if (!args[1]) throw new Error('Usage: ample doctor fix <number>');
      const r = await doc.fix(args[1]);
      console.log(`${r.ok ? '✔' : '✖'} ${r.text}`);
      return;
    }
    if (args[0] && /^\d+$/.test(args[0])) {
      const item = doc.lastScanItem(args[0]);
      if (!item) throw new Error(`No problem #${args[0]}. Run "ample doctor" first.`);
      printDetails(item, ar);
      return;
    }
    const all = args.includes('--all');
    const hoursArg = args.find((a) => /^\d+h$/.test(a));
    const hours = hoursArg ? Number(hoursArg.slice(0, -1)) : 24;
    const list = doc.scan({ hours, all });
    // Arabic counted noun: 1 مشكلة واحدة, 2 مشكلتان, 3–10 مشكلات, 11+ مشكلة
    const n = list.length;
    const arCount = n === 1 ? 'مشكلة واحدة' : n === 2 ? 'مشكلتان' : n <= 10 ? `${n} مشكلات` : `${n} مشكلة`;
    const head = ar ? `Log Doctor — آخر ${hours} ساعة — ${n ? arCount : 'لا مشكلات'}` : `Log Doctor — last ${hours} hours — ${n} problem(s)`;
    console.log(`\n${C.bold}${head}${C.reset}\n`);
    if (!list.length) console.log(ar ? '  ✔ لا توجد مشكلات.' : '  ✔ No problems found.');
    for (const d of list) { printSummary(d, ar); console.log(''); }
    if (list.length) console.log(C.dim + (ar
      ? 'التفاصيل: ample doctor <رقم>    الحل التلقائي: ample doctor fix <رقم>    الكل: ample doctor --all    مدة أطول: ample doctor 72h'
      : 'Details: ample doctor <n>    Fix: ample doctor fix <n>    Include notices: ample doctor --all    Longer: ample doctor 72h') + C.reset);
  },
  async db() {
    const D = require('../core/db');
    if (args[0] === 'new') {
      if (!args[1]) throw new Error('Usage: ample db new <name>');
      console.log(`✔ database ${D.createDatabase(args[1])} created (utf8mb4)`);
      return;
    }
    const list = D.details();
    if (!list.length) console.log('No databases yet. Create one: ample db new <name>   or import one: ample import file.sql');
    for (const d of list) console.log(`${d.name.padEnd(30)} ${String(d.tables).padStart(4)} tables  ${(d.bytes / 1048576).toFixed(1).padStart(8)} MB`);
  },
  async backup() {
    const D = require('../core/db');
    const path = require('path');
    const P = require('../core/paths');
    const dbs = args.length ? args : D.listDatabases();
    if (!dbs.length) { console.log('No databases to back up.'); return; }
    const stamp = D.stamp();
    for (const name of dbs) {
      const file = path.join(P.ROOT, 'backups', `${name}-${stamp}.sql.gz`);
      const r = await D.exportDb(name, file);
      console.log(`✔ ${name}  →  ${path.relative(P.ROOT, file)}  (${(r.bytes / 1024).toFixed(0)} KB)`);
    }
  },
  async import() {
    const D = require('../core/db');
    if (!args[0]) throw new Error('Usage: ample import <file.sql | file.sql.gz | file.zip> [database]');
    const started = Date.now();
    const bar = (pct) => `[${'#'.repeat(Math.floor(pct / 4)).padEnd(25, '.')}] ${String(pct).padStart(3)}%`;
    await D.importFile(args[0], args[1], {
      onProgress: (pct, read, total) => process.stdout.write(`\r${bar(pct)}  ${(read / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`),
    });
    console.log(`\n✔ imported in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  },
  async rescue() {
    if (!args.includes('--yes')) {
      console.log(`MariaDB rescue mode — use it when MariaDB will not start.

  1. stops MariaDB and MOVES mariadb\\data to mariadb\\data-broken-<date> (nothing is deleted)
  2. creates a fresh, clean mariadb\\data and starts MariaDB on it
  3. opens the broken copy with a temporary server (port 3399, this PC only)
  4. exports every database it can read to backups\\rescue-<date>\\
  5. imports them into the fresh MariaDB, then reports what was saved

User accounts other than root are not carried over (recreate them in phpMyAdmin).

Run it with:  ample rescue --yes`);
      return;
    }
    const r = await require('../core/rescue').rescue();
    console.log('');
    if (!r.ok) { console.log(`✖ ${r.message}`); return; }
    for (const d of r.databases) {
      const icon = d.status === 'full' ? '✔' : d.status === 'partial' ? '⚠' : '✖';
      console.log(`${icon} ${d.db.padEnd(28)} ${d.status.padEnd(8)} ${d.tablesAfter}/${d.tablesBefore} tables` +
        (d.failedTables.length ? `   missing: ${d.failedTables.join(', ')}` : '') + (d.importError ? `   ${d.importError}` : ''));
    }
    const path = require('path');
    const P = require('../core/paths');
    console.log(`\nBroken data kept in: ${path.relative(P.ROOT, r.broken)}   Exports: ${path.relative(P.ROOT, r.outDir)}`);
  },
  async check() {
    const CK = require('../core/check');
    const ar = require('../core/doctor').language() === 'ar';
    if (args[0] === '--fix' && args[1] === 'defender') {
      console.log(ar ? 'سيطلب ويندوز صلاحيات المسؤول لاستثناء مجلد AMPLE من فحص Defender...' : 'Windows will ask for administrator rights to exclude the AMPLE folder from Defender scanning...');
      console.log(CK.fixDefender() ? '✔ done' : '✖ cancelled or failed');
      return;
    }
    const ICONS = { ok: '✔', info: 'ℹ', warn: '⚠', fail: '✖' };
    const pick = (t) => (t ? (ar ? t.ar : t.en) : null);
    console.log(ar ? 'فحص هذا الحاسوب...\n' : 'Checking this computer...\n');
    const list = await CK.run();
    for (const c of list) {
      console.log(`${ICONS[c.status]}  ${pick(c.title)}`);
      if (c.detail) console.log(`   ${pick(c.detail)}`);
      if (c.fix) console.log(`   → ${pick(c.fix)}`);
    }
    const fails = list.filter((c) => c.status === 'fail').length;
    const warns = list.filter((c) => c.status === 'warn').length;
    console.log('\n' + (ar
      ? (fails ? `✖ ${fails} مشكلة تمنع AMPLE من العمل.` : warns ? `⚠ يعمل AMPLE، وهناك ${warns} أمور يُنصح بإصلاحها.` : '✔ هذا الحاسوب جاهز لـ AMPLE.')
      : (fails ? `✖ ${fails} problem(s) stop AMPLE from working.` : warns ? `⚠ AMPLE works; ${warns} thing(s) worth fixing.` : '✔ This computer is ready for AMPLE.')));
  },
  async xampp() {
    const XM = require('../core/xampp');
    const ar = require('../core/doctor').language() === 'ar';
    const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
    if (opt('path')) require('../core/settings').update({ xamppPath: opt('path') });
    const yes = args.includes('--yes');
    const names = (args.find((a, i) => i > 1 && !a.startsWith('--')) || '').split(',').filter(Boolean);
    const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
    const what = args[0] === 'import' ? args[1] : args[0];
    const dry = () => console.log(`\n(nothing changed — add --yes to do it)`);

    if (!what || what === 'scan') {
      const s = XM.scan({ lang: ar ? 'ar' : 'en' });
      console.log(`XAMPP: ${s.root}   Apache ${s.versions.apache || '?'} · PHP ${s.versions.php || '?'} · ${s.versions.mariadb || 'MariaDB ?'}`);
      console.log(s.running.length ? `⚠ running now: ${s.running.map((p) => p.name).join(', ')} (stop MySQL in XAMPP before importing databases)` : '✔ XAMPP is not running');
      console.log(`\nProjects (${s.projects.length}) — ample xampp import projects`);
      for (const p of s.projects) console.log(`  ${p.exists ? '⚠' : '•'} ${p.name.padEnd(30)} ${mb(p.size).padStart(10)}  ${p.files} files${p.exists ? '  (already in AMPLE, will be skipped)' : ''}`);
      for (const f of s.files) console.log(`  • ${f.name.padEnd(30)} ${mb(f.size).padStart(10)}  (file)${f.exists ? '  (exists, skipped)' : ''}`);
      console.log(`\nDatabases (${s.databases.length}) from ${s.root}\\mysql\\data — ample xampp import databases`);
      for (const d of s.databases) console.log(`  ${d.existsInAmple ? '⚠' : '•'} ${d.name.padEnd(30)} ${mb(d.size).padStart(10)}${d.existsInAmple ? '  (already in AMPLE, will be skipped)' : ''}`);
      console.log(`\nVirtual hosts (${s.vhosts.length}) — ample xampp import vhosts`);
      for (const v of s.vhosts) console.log(`  ${v.skip ? '·' : '•'} ${v.name.padEnd(30)} ${v.docroot}${v.skip ? `  (${v.skip})` : ''}${!v.skip && v.inHostsFile ? '  [in hosts file]' : ''}`);
      console.log(`\nYour php.ini changes (${s.php.items.length}, compared with ${s.php.base || '?'}) — ample xampp import php`);
      for (const x of s.php.items) console.log(`  ${String(x.n).padStart(3)}. ${x.kind === 'ext' ? `extension ${x.key}` : `${x.key} = ${x.value}${x.base !== null ? `   (default ${x.base})` : ''}`}`);
      const errs = s.doctor.filter((d) => d.level === 'error');
      console.log(`\nLog Doctor on XAMPP's logs: ${errs.length} error(s), ${s.doctor.length - errs.length} other`);
      for (const d of errs.slice(0, 10)) console.log(`  ✖ ${d.title}${d.count > 1 ? ` ×${d.count}` : ''}`);
      console.log('\nNothing was changed. XAMPP\'s folder is only read.');
      return;
    }
    if (what === 'projects') {
      const r = XM.importProjects(names, { yes });
      for (const p of r.plan) console.log(`${p.action === 'copy' ? (r.done ? '✔ copied' : '• copy  ') : '⚠ skip  '} ${p.name.padEnd(30)} ${mb(p.size)}${p.action !== 'copy' ? `  ${p.action}` : ''}`);
      if (!r.done) dry(); else console.log('\nXAMPP\'s copies are untouched. New sites: ample sites');
      return;
    }
    if (what === 'databases') {
      const r = await XM.importDatabases(names, { yes, password: opt('xampp-password') });
      if (!r.done) {
        for (const d of r.plan) console.log(`${d.existsInAmple ? '⚠ skip  ' : '• import'} ${d.name.padEnd(30)} ${mb(d.size)}${d.existsInAmple ? `  ${d.action}` : ''}`);
        if (r.xamppMysqlRunning) console.log('\n⚠ XAMPP\'s MySQL is running: stop it in the XAMPP Control Panel before importing.');
        console.log('\nNon-root database users and their permissions are imported too.');
        dry();
        return;
      }
      for (const x of r.results) {
        const icon = x.status === 'imported' ? '✔' : x.status === 'partial' ? '⚠' : x.status === 'skipped' ? '·' : '✖';
        console.log(`${icon} ${x.db.padEnd(30)} ${x.status}${x.tablesBefore !== undefined ? `  ${x.tablesAfter}/${x.tablesBefore} tables` : ''}${x.reason ? `  (${x.reason})` : ''}${x.error ? `  ${x.error}` : ''}`);
      }
      for (const u of r.users) console.log(`${u.status === 'imported' ? '✔' : '·'} user ${u.user}@${u.host}${u.from && u.from !== u.host ? ` (from @${u.from})` : ''}  ${u.status}${u.error ? ` ${u.error}` : ''}`);
      if (r.users.some((u) => u.from === 'localhost' && u.host !== 'localhost')) {
        console.log('  (accounts @localhost are also created @127.0.0.1 and @::1: PHP on Windows connects to "localhost" through 127.0.0.1)');
      }
      if (r.recoveryLevel) console.log(`\n⚠ XAMPP's data needed recovery level ${r.recoveryLevel} to open; check the partial databases.`);
      console.log(`\nExports kept in ${path.relative(require('../core/paths').ROOT, r.outDir)} (delete when you're happy).`);
      return;
    }
    if (what === 'php') {
      const nums = names.map(Number).filter(Boolean);
      const r = XM.importPhp(nums, { yes });
      if (!r.done) {
        for (const x of r.items) console.log(`  ${String(x.n).padStart(3)}. ${x.kind === 'ext' ? `extension ${x.key}` : `${x.key} = ${x.value}${x.base !== null ? `   (default ${x.base})` : ''}`}`);
        console.log(r.items.length ? '\nPick numbers:  ample xampp import php 1,3,4 --yes' : 'No changes found.');
        return;
      }
      for (const x of r.chosen) console.log(`✔ ${x.kind === 'ext' ? `extension ${x.key}` : `${x.key} = ${x.value}`}`);
      console.log('\nSaved in ample.json; applies to every PHP version. Restart Apache: ample restart apache');
      return;
    }
    if (what === 'vhosts') {
      const r = XM.importVhosts({ yes });
      for (const v of r.list) console.log(`${v.skip ? '· skip  ' : r.done ? '✔ done  ' : '• import'} ${v.name.padEnd(28)} ${v.skip ? v.skip : `→ also ${v.localhostName}${v.inHostsFile ? '' : '  (not in hosts file: use the .localhost name)'}`}`);
      if (!r.done) dry(); else console.log('\nRestart Apache to use them: ample restart apache');
      return;
    }
    if (what === 'undo') {
      const r = XM.undo({ yes, force: args.includes('--force') });
      const p = r.plan;
      console.log(`projects: ${p.projects.map((x) => x.name + (x.changed ? ' (CHANGED since import)' : '')).join(', ') || '-'}`);
      console.log(`databases: ${p.databases.join(', ') || '-'}\nusers: ${p.users.map((u) => `${u.user}@${u.host}`).join(', ') || '-'}`);
      console.log(`vhosts: ${p.vhosts.length}   php settings: ${p.php ? p.php.applied.length + ' change(s)' : '-'}`);
      if (!r.done) { console.log('\nOnly AMPLE is changed; XAMPP is not touched.'); dry(); return; }
      console.log(`\n✔ removed from AMPLE${r.kept.length ? `; kept changed projects (use --force): ${r.kept.join(', ')}` : ''}`);
      return;
    }
    throw new Error('Usage: ample xampp scan | import projects|databases|php|vhosts [names] [--yes] | undo [--yes]');
  },
  // Started by the control panel when you press Update next to "Electron (control panel)": the
  // panel closes itself (services keep running), this waits for it to be gone, updates Electron
  // safely (checksum, the same code as "ample update electron"), then opens the panel again.
  async 'panel-update'() {
    const U = require('../core/update');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    console.log('AMPLE: updating the control panel. Apache, MariaDB and Mailpit keep running.');
    console.log('AMPLE opens again by itself when it is done.\n');
    for (let i = 0; i < 120 && U.panelRunning(); i++) await sleep(500);
    if (U.panelRunning()) {
      console.log('The control panel is still open, so its files cannot be replaced. Close it and try again.');
    } else {
      try {
        const res = await U.apply(['electron'], (m) => console.log(m));
        const r = res.find((x) => x.name === 'electron') || {};
        console.log(r.ok && !r.skipped ? `\n✔ Control panel updated: ${r.from} → ${r.to}` : r.skipped ? '\n✔ The control panel is already up to date.' : `\n✖ Not updated: ${r.error || 'unknown error'}`);
      } catch (e) { console.log(`\n✖ Not updated: ${e.message}`); }
    }
    const exe = require('../core/paths').p('electron', 'AMPLE.exe');
    if (require('fs').existsSync(exe)) {
      require('child_process').spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
      console.log('Opening AMPLE…');
    }
    await sleep(2500);
  },
  async update() {
    const U = require('../core/update');
    const ar = require('../core/doctor').language() === 'ar';
    if (!args.length) {
      console.log('Checking official sources...\n');
      const list = await U.check();
      for (const r of list) {
        const state = r.error ? `✖ ${r.error}` : r.comp ? `→ ${r.latest}   update available` : '✔ up to date';
        console.log(`${r.label.padEnd(20)} ${String(r.current ?? '-').padEnd(12)} ${state}`);
        if (r.note) console.log(`${' '.repeat(21)}ℹ ${ar ? r.note.ar : r.note.en}`);
      }
      const n = list.filter((r) => r.comp).length;
      console.log(n ? `\nApply: ample update all   or one: ample update ${list.filter((r) => r.comp).map((r) => r.name).join(' | ')}` : '\nEverything is up to date.');
      return;
    }
    const res = await U.apply(args, (m) => console.log(m));
    console.log('');
    for (const r of res) {
      if (r.skipped) console.log(`✔ ${r.name}: ${r.skipped}`);
      else if (r.ok) console.log(`✔ ${r.name}: ${r.from} → ${r.to}`);
      else if (r.kept) console.log(`⚠ ${r.name}: kept the current version. ${r.error}`);
      else console.log(`✖ ${r.name}: ${r.rolledBack ? (r.sac ? 'blocked by Windows, rolled back' : 'failed, rolled back') : 'failed'}: ${r.error}`);
    }
  },
  async sites() {
    const SI = require('../core/sites');
    if (args[0] === 'new') {
      if (!args[1]) throw new Error('Usage: ample sites new <name>');
      const x = SI.create(args[1]);
      console.log(`✔ htdocs\\${x.name} created: ${x.url}`);
      return;
    }
    if (args[0] === 'rename') {
      if (args.length < 3) throw new Error('Usage: ample sites rename "<folder>" <new-name>');
      const x = SI.rename(args[1], args[2]);
      console.log(`✔ renamed to htdocs\\${x.name}: ${x.url || ''}`);
      return;
    }
    const { sites, skipped } = SI.list();
    if (!sites.length) console.log('No folders in htdocs yet. Create htdocs\\myapp and open http://myapp.localhost/');
    for (const x of sites) {
      const web = path.relative(x.dir, x.docroot);
      console.log(`${x.url.padEnd(34)} ${x.httpsUrl ? x.httpsUrl.padEnd(35) : ''}${x.framework}${web ? `  (serves ${web}\\)` : ''}`);
    }
    for (const k of skipped) console.log(`⚠ "${k.name}" is not a valid site name (letters, digits, hyphens)${k.suggestion ? `; rename it to "${k.suggestion}"` : ''}. Still reachable at http://localhost/${encodeURI(k.name)}/`);
  },
  async https() {
    const H = require('../core/https');
    const S = require('../core/settings');
    const restart = async () => {
      if ((await svc().status('apache')).running) await svc().restart('apache');
      else require('../core/config').generate();
    };
    if (args[0] === 'on') {
      H.ensureCA();
      S.update({ https: true });
      await restart();
    } else if (args[0] === 'off') {
      S.update({ https: false });
      await restart();
    } else if (args[0] === 'trust') {
      console.log('Windows will now ask you to confirm installing the "AMPLE Local Development CA". Click Yes.');
      const r = H.trust();
      console.log(r.already ? '✔ already trusted' : r.ok ? '✔ trusted: browsers now show a padlock for https://*.localhost' : '✖ not trusted (the dialog was cancelled?)');
      return;
    } else if (args[0] === 'untrust') {
      console.log(H.untrust() ? '✔ AMPLE CA removed from your trusted certificates' : '✖ could not remove it');
      return;
    }
    const s = S.load();
    const i = H.info();
    console.log(`HTTPS: ${s.https ? 'ON' : 'OFF'}   port ${s.ports.https}`);
    console.log(`Local CA: ${i.ca ? 'created' : 'not created'}   trusted by Windows: ${i.trusted ? 'yes' : 'no'}`);
    if (i.cert) console.log(`Certificate: ${i.names.length} name(s), ${i.certDaysLeft} days left (renewed automatically)`);
    if (s.https && !i.trusted) console.log('\nBrowsers will warn until you run:  ample https trust   (Windows asks you to confirm, no admin needed)');
    console.log('The CA can only sign localhost names (X.509 name constraints), so it cannot be misused for real websites.');
    console.log('Windows\' built-in curl.exe needs --ssl-no-revoke for local certificates (browsers and PHP don\'t).');
  },
  async xdebug() {
    const X = require('../core/xdebug');
    const say = (m) => console.log(`  ${m}`);
    const st = args[0] === 'on' ? await X.setEnabled(true, say)
      : args[0] === 'off' ? await X.setEnabled(false, say)
        : X.status();
    console.log(`Xdebug: ${st.enabled ? 'ON' : 'OFF'}   PHP ${st.phpVersion}` +
      (st.installed ? `   (Xdebug ${st.installed.version})` : '   (not downloaded for this PHP)'));
    if (st.enabled) {
      console.log(`
VS Code: install the "PHP Debug" extension, then in .vscode/launch.json:
  { "name": "Listen for Xdebug", "type": "php", "request": "launch", "port": ${st.port} }
Press F5, set a breakpoint, and open the page in the browser.
Turn it off when not debugging (it slows PHP down): ample xdebug off`);
    }
  },
  async path() {
    const S = require('../core/shell');
    const show = (st) => {
      console.log(`AMPLE commands folder: ${st.bin}`);
      console.log(st.added ? '✔ in your PATH (new terminals can run: php, composer, mysql, mysqldump, ample)' : '✖ not in your PATH  →  ample path add');
      for (const e of st.stale) console.log(`⚠ old AMPLE location still in PATH: ${e}  (ample path add removes it)`);
      for (const c of st.systemConflicts) console.log(`⚠ ${c.exe} in the SYSTEM PATH wins over AMPLE: ${c.dir}  (remove it in System Properties → Environment Variables, needs admin)`);
      for (const c of st.userConflicts) console.log(`⚠ ${c.exe} found before AMPLE: ${c.dir}`);
      const others = st.otherPhp.filter((d) => !st.systemConflicts.some((c) => c.dir === d));
      if (st.added) {
        for (const d of others) console.log(`ℹ another PHP is also in PATH (after AMPLE, so AMPLE wins): ${d}`);
      } else {
        const now = S.whichInNewTerminal('php')[0];
        console.log(`ℹ right now "php" in a terminal runs: ${now || '(nothing)'}`);
      }
    };
    if (args[0] === 'add') {
      const r = S.pathAdd();
      for (const e of r.removed) console.log(`removed old entry: ${e}`);
      show(r);
      for (const name of ['php', 'composer', 'mysql']) console.log(`  new terminal → ${name.padEnd(9)} ${S.whichInNewTerminal(name)[0] || '(not found)'}`);
      console.log('\nOpen a NEW terminal (already open ones keep the old PATH).');
    } else if (args[0] === 'remove') {
      show(S.pathRemove());
    } else {
      show(S.pathStatus());
    }
  },
  async logs() {
    const L = require('../core/logs');
    if (args[0] === 'clear') {
      const r = L.clear(args[1]);
      for (const f of r.failed) console.log(`✖ ${f.file}: ${f.reason}`);
      console.log(`✔ cleared ${r.done.length} file(s), ${(r.freed / 1024).toFixed(0)} KB freed`);
      return;
    }
    const kb = (n) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
    for (const f of L.list()) console.log(`${f.group.padEnd(8)} ${f.file.padEnd(28)} ${kb(f.size).padStart(10)}`);
    console.log('\nClear all: ample logs clear     One: ample logs clear apache|php|mariadb|ample');
  },
  async lang() {
    if (!['ar', 'en'].includes(args[0])) throw new Error('Usage: ample lang ar|en');
    require('../core/settings').update({ language: args[0] });
    console.log(args[0] === 'ar' ? 'اللغة الآن: العربية' : 'Language: English');
  },
  async start() { for (const n of pick()) await svc().start(n); },
  async stop() { for (const n of pick().reverse()) await svc().stop(n); },
  async restart() { for (const n of pick()) await svc().restart(n); },
  async status() {
    for (const n of svc().ORDER) {
      const s = await svc().status(n);
      console.log(`${s.label.padEnd(8)} ${s.running ? `RUNNING  port ${s.port}  pid ${s.pid}` : 'STOPPED'}`);
    }
    console.log(`PHP      ${require('../core/config').activePhp()} (active)`);
  },
  async 'php-list'() {
    const cfg = require('../core/config');
    const active = cfg.activePhp();
    for (const v of cfg.listPhpVersions()) console.log(`${v === active ? '*' : ' '} ${v}`);
  },
  async 'php-use'() {
    if (!args[0]) throw new Error('Usage: ample php-use <version>   (see: ample php-list)');
    const { version, report } = await svc().usePhp(args[0]);
    if (report) console.log('\n' + require('../core/phpcompare').format(report) + '\n');
    console.log(`PHP ${version} is now active.`);
  },
  async 'php-compare'() {
    // ample php-compare 8.4        -> active version vs 8.4
    // ample php-compare 8.5 8.4    -> 8.5 (reference) vs 8.4
    const cfg = require('../core/config');
    const all = cfg.listPhpVersions();
    const resolve = (w) => all.find((v) => v === w) || all.find((v) => v.startsWith(w + '.'));
    const [a, b] = args.length >= 2 ? args : [cfg.activePhp(), args[0]];
    if (!b) throw new Error('Usage: ample php-compare [reference] <version>   e.g. ample php-compare 8.4');
    const base = resolve(a), target = resolve(b);
    if (!base || !target) throw new Error(`Not installed: ${!base ? a : b}. Installed: ${all.join(', ')}`);
    const cmp = require('../core/phpcompare');
    console.log(cmp.format(cmp.compare(base, target, { apply: false })));
    console.log('\n(report only, nothing changed — "ample php-use" applies the fixes)');
  },
  async password() {
    if (args.length === 0) throw new Error('Usage: ample password <new-password>   (use "" for no password)');
    const hosts = await svc().changePassword(args[0]);
    console.log(`Password updated for ${hosts.length} account(s), ample.json and phpMyAdmin.`);
  },
  async setup() {
    const { installAll } = require('../core/download');
    await installAll();
    console.log('\nAll components installed.');
  },
  async share() {
    const SH = require('../core/share');
    if (args[0] === 'stop') { const r = await SH.stop(); console.log(r.stopped ? '✔ sharing stopped: the public link no longer works' : 'Nothing was shared.'); return; }
    if (args[0]) {
      if (!SH.installed()) {
        console.log('Sharing uses cloudflared from Cloudflare (signed by Cloudflare, about 53 MB). Downloading it once...');
        await SH.install((m) => console.log(`  ${m}`));
      }
      const pw = (args.find((a) => a.startsWith('--password=')) || '').slice('--password='.length) || null;
      console.log(`Opening a public link to ${args[0]} (a few seconds)...`);
      const r = await SH.start(args[0], { password: pw });
      console.log(`\n✔ ${r.site} is PUBLIC at:  ${r.url}`);
      if (r.password) console.log(`  Visitors need:  user ${r.user}  +  your password`);
      console.log('  Anyone with this link can open the site. phpMyAdmin, the dashboard and Mailpit stay private.');
      console.log('  The link changes every time. Stop it with:  ample share stop');
      return;
    }
    const st = SH.status();
    console.log(st.active ? `${st.site} is public at ${st.url}${st.password ? ' (password)' : ''} since ${new Date(st.started).toLocaleTimeString()}` : 'Nothing is shared.  Share a site:  ample share <site> [--password=...]');
  },
  async mail() {
    const M = require('../core/mail');
    if (args[0] === 'test') { const r = await M.sendTest(); console.log(`✔ sent "${r.subject}": open http://localhost/mailpit/`); return; }
    if (args[0] === 'clear') { await M.clear(); console.log('✔ every message deleted'); return; }
    const r = await M.list(15);
    console.log(`Mailpit: ${r.total} message(s), ${r.unread} unread   http://localhost/mailpit/\n`);
    for (const m of r.messages) {
      const when = m.time ? new Date(m.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      console.log(`${m.read ? ' ' : '•'} ${when.padEnd(16)} ${(m.subject || '(no subject)').slice(0, 50).padEnd(50)}  ${m.from} → ${m.to}`);
    }
  },
  async ext() {
    const X = require('../core/phpext');
    if (args.length) {
      if (args.length < 2 || !['on', 'off'].includes(args[1])) throw new Error('Usage: ample ext <name> on|off');
      const r = await X.set(args[0], args[1] === 'on');
      console.log(r.on ? (r.loads ? `✔ ${r.name} enabled (every PHP version)` : `⚠ ${r.name} enabled but does not load: ${r.reason}`) : `✔ ${r.name} disabled`);
      return;
    }
    const { version, extensions } = X.list();
    console.log(`PHP ${version} extensions (on/off applies to every version):`);
    for (const e of extensions) {
      console.log(`  ${e.enabled ? (e.ok ? '✔' : '✖') : ' '} ${e.name.padEnd(14)}${e.default ? ' default' : ''}${e.reason ? `  (${e.reason})` : ''}`);
    }
  },
  async port() {
    const PS = require('../core/portset');
    if (args.length) {
      if (args.length < 2) throw new Error('Usage: ample port http|https|mysql|smtp|mailpit <number>');
      const r = await PS.set({ [args[0]]: args[1] });
      if (!r.changed.length) console.log('Nothing to change.');
      for (const c of r.changed) console.log(`✔ ${c.key}: ${c.from} → ${c.to}`);
      if (r.restarted.length) console.log(`  restarted: ${r.restarted.join(', ')}`);
    }
    const { ports, https } = PS.get();
    for (const [k, v] of Object.entries(ports)) if (k !== 'https' || https) console.log(`${k.padEnd(8)} ${v}`);
  },
  async design() {
    const D = require('../core/design');
    if (args.length) {
      if (args.length < 2) throw new Error('Usage: ample design phpmyadmin|mailpit|all ample|original');
      const r = await D.set(args[0], args[1]);
      if (!r.changed.length) console.log('Nothing to change.');
      else console.log(`✔ ${r.changed.map((t) => D.TOOLS[t]).join(' + ')}: ${args[1]} design` + (r.restarted ? ' (Apache restarted)' : ''));
    }
    const d = D.get();
    for (const t of Object.keys(D.TOOLS)) console.log(`${D.TOOLS[t].padEnd(11)} ${d[t] === 'ample' ? 'AMPLE design' : 'original design'}`);
  },
  async panel() {
    require('../core/panel').open();
    console.log('Opening the AMPLE control panel...');
  },
  async 'php-add'() {
    if (!args[0]) throw new Error('Usage: ample php-add <version>   e.g. ample php-add 8.6');
    const { installPhpVersion } = require('../core/download');
    const v = await installPhpVersion(args[0]);
    console.log(`PHP ${v} ready. Switch to it with: ample php-use ${v}`);
  },
  // Microsoft Visual C++ runtime: show it, or install the latest one from Microsoft.
  async vc() {
    const vc = require('../core/vcredist');
    if (args[0] === 'install') {
      const r = await vc.install((t) => console.log('  ' + t));
      console.log(r.code === 1638 ? `✔ A newer Visual C++ runtime is already installed (${r.after}).`
        : `✔ Visual C++ runtime ${r.before || 'none'} → ${r.after}` + (r.restart ? ' (Windows recommends a restart)' : ''));
      return;
    }
    const have = vc.installed();
    console.log(`Visual C++ runtime: ${have || 'not installed'}`);
    const config = require('../core/config');
    for (const v of config.listPhpVersions()) {
      const need = vc.neededByPhpDir(require('../core/phpini').phpDirOf(v));
      if (!need) continue;
      console.log(`  PHP ${v.padEnd(8)} needs ${need}+  ${vc.enough(need).ok ? '✔' : '✖ run: ample vc install'}`);
    }
  },
  async config() {
    const r = require('../core/config').generate();
    console.log(`PHP ${r.phpVersion} active. Generated:\n  ` + r.files.join('\n  '));
    for (const c of r.imported) console.log(`  ↻ imported your edit: ${c}`);
    for (const s of r.skippedExtensions) console.log(`  ⚠ extension ${s.ext} skipped: ${s.reason}`);
    for (const s of r.skippedSettings) console.log(`  ⚠ setting ${s.key} skipped: ${s.reason}`);
    for (const m of r.startupMessages) console.log(`  ⚠ PHP startup: ${m}`);
  },
  help() {
    console.log(`ample commands:
  panel            open the AMPLE control panel (window)
  start [apache|mariadb]    start both (or one)
  stop [apache|mariadb]     stop both (or one)
  restart [apache|mariadb]
  status
  php-list         installed PHP versions (* = active)
  php-use <ver>    switch PHP version: makes it match the current one, then restarts Apache
  php-compare [ref] <ver>   report differences between two PHP versions (changes nothing)
  php-add <ver>    download another PHP version from windows.php.net
  vc [install]     Visual C++ runtime each PHP needs / install the latest from Microsoft
  password <pw>    change the MariaDB password (MariaDB + ample.json + phpMyAdmin)
  doctor           explain the problems in the logs (last 24h)
  doctor <n>       details + how to fix problem n
  doctor fix <n>   apply the automatic fix for problem n
  lang ar|en       language of Log Doctor messages
  db               list your databases
  db new <name>    create an empty database (utf8mb4)
  backup [db...]   export databases to backups\\ (.sql.gz); all if none given
  import <file> [db]  import .sql / .sql.gz / .zip of any size, with progress
  rescue           MariaDB won't start? save your databases into a fresh data folder
  path [add|remove]   use php, composer, mysql, ample from any terminal (user PATH, no admin)
  ext [name on|off]   list PHP extensions, or switch one (every PHP version)
  mail [test|clear]   latest emails in Mailpit / send a test email / delete them all
  share <site> [--password=...]   a public https link to one site (Cloudflare, no account)
  share stop          close the public link
  xdebug [on|off]  step debugging (downloads the Xdebug build matching the active PHP)
  update [all|name...]   check for new versions (no args) or update safely, with rollback
  check            will AMPLE work on this PC? (Windows, Visual C++, Smart App Control, Defender, path, ports, disk)
  check --fix defender   exclude the AMPLE folder from Defender scanning (asks for admin)
  xampp scan       what can be imported from XAMPP (read-only)
  xampp import projects|databases|php|vhosts [names] [--yes]   (shows a plan without --yes)
  xampp undo [--yes]     remove what was imported (XAMPP itself is never changed)
  sites            every htdocs folder is a site: http://NAME.localhost
  sites new <name>             create htdocs\\<name> (works at once)
  sites rename "<folder>" <name>   rename a folder whose name can't be a site (spaces...)
  https [on|off|trust|untrust]   trusted local HTTPS for localhost and *.localhost
  design [phpmyadmin|mailpit|all ample|original]   AMPLE's look or the original one
  port [http|https|mysql|smtp|mailpit <number>]   show or change a port (checks it is free)
  logs             list log files and sizes
  logs clear [svc] empty all logs (or one: apache, php, mariadb, ample)
  config           regenerate config files from templates + ample.json
  setup            download + verify Apache, PHP, MariaDB, phpMyAdmin, Mailpit, the control panel`);
  },
};

(commands[cmd] || commands.help)().catch((e) => {
  if (e.diagnosis) {
    // Explain the failure instead of only printing the technical message.
    printDetails({ ...e.diagnosis, n: null, raw: e.message.split('\n') }, require('../core/doctor').language() === 'ar');
  } else {
    console.error('✖ ' + (e.ar && require('../core/doctor').language() === 'ar' ? e.ar : e.message));
  }
  process.exit(1);
});
