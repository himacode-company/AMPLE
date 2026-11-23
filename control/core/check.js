'use strict';
// "ample check": will AMPLE work properly on THIS computer?
// Each check returns { id, status: 'ok'|'info'|'warn'|'fail', title, detail, fix } (texts in en + ar).
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawnSync } = require('child_process');
const P = require('./paths');
const settings = require('./settings');

const VC_URL = require('./vcredist').URL;
const SAC_EXIT = new Set([-1058471934, 3236495362]); // 0xC0E90002 STATUS_SYSTEM_INTEGRITY_POLICY_VIOLATION

const T = (en, ar) => ({ en, ar });
const ps = (script) => spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 });

// Run a program the way AMPLE does; tell whether Windows blocked it.
function tryRun(exe, args, env) {
  if (!fs.existsSync(exe)) return { missing: true };
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 20000, env });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return {
    ok: r.status === 0,
    blocked: SAC_EXIT.has(r.status) || /Application Control policy|Smart App Control/i.test(out),
    code: r.status, out: out.trim().split(/\r?\n/)[0] || '',
  };
}

// ---- individual checks ---------------------------------------------------------

function checkWindows() {
  const arch = process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || os.arch();
  const build = Number(os.release().split('.')[2] || 0);
  const name = build >= 22000 ? 'Windows 11' : 'Windows 10';
  if (/arm/i.test(arch)) {
    return { id: 'windows', status: 'warn', title: T(`${name} on ARM`, `${name} على معالج ARM`),
      detail: T('AMPLE\'s programs are built for x64 and run through Windows\' x64 emulation: they work, but slower.', 'برامج AMPLE مبنية لمعالجات x64، وتعمل عبر محاكاة ويندوز: تعمل، لكن بشكل أبطأ.') };
  }
  return { id: 'windows', status: build >= 17763 ? 'ok' : 'warn', title: T(`${name} 64-bit (build ${build})`, `${name} بنظام 64-bit (الإصدار ${build})`),
    detail: build >= 17763 ? null : T('Windows 10 1809 or newer is recommended (tar.exe and modern TLS are needed).', 'يُنصح بـ Windows 10 1809 أو أحدث (يحتاج AMPLE إلى tar.exe و TLS حديث).') };
}

function checkVcRuntime() {
  const v = require('./update').vcRuntime();
  if (!v) {
    return { id: 'vcredist', status: 'fail', title: T('Visual C++ runtime is missing', 'مكتبة Visual C++ غير مثبتة'),
      detail: T('Apache and PHP need the "Microsoft Visual C++ Redistributable" (x64). Without it they do not start at all.', 'يحتاج Apache و PHP إلى "Microsoft Visual C++ Redistributable" (x64)، وبدونها لا يعملان أبداً.'),
      fix: T(`Run: ample vc install (or download it from Microsoft: ${VC_URL})`, `نفّذ: ample vc install (أو نزّلها من مايكروسوفت: ${VC_URL})`) };
  }
  const { cmp } = require('./update');
  const ok = cmp(v, '14.30') >= 0;
  if (!ok) {
    return { id: 'vcredist', status: 'fail', title: T(`Visual C++ runtime ${v}`, `مكتبة Visual C++ بإصدار ${v}`),
      detail: T('Version 14.30 or newer is needed by Apache and PHP.', 'يحتاج Apache و PHP إلى الإصدار 14.30 أو أحدث.'),
      fix: T(`Run: ample vc install (or download it from Microsoft: ${VC_URL})`, `نفّذ: ample vc install (أو نزّلها من مايكروسوفت: ${VC_URL})`) };
  }
  // Newer builds (PHP 8.6+, Apache built with Visual Studio 2026) need 14.50+.
  if (cmp(v, '14.50') < 0) {
    return { id: 'vcredist', status: 'info', title: T(`Visual C++ runtime ${v}`, `مكتبة Visual C++ بإصدار ${v}`),
      detail: T('Enough for the current versions. PHP 8.6 and newer need 14.50+.', 'كافية للإصدارات الحالية. يحتاج PHP 8.6 وما بعده إلى الإصدار 14.50 أو أحدث.'),
      fix: T('Optional: ample vc install (the latest from Microsoft; Windows asks for permission)', 'اختياري: ample vc install (أحدث إصدار من مايكروسوفت، ويطلب ويندوز الإذن)') };
  }
  return { id: 'vcredist', status: 'ok', title: T(`Visual C++ runtime ${v}`, `مكتبة Visual C++ بإصدار ${v}`) };
}

// Files blocked by Code Integrity (Smart App Control / WDAC) inside AMPLE, last 7 days.
function blockedByWindows() {
  const root = P.ROOT.replace(/'/g, "''").replace(/^[A-Za-z]:/, '');
  const r = ps(`Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational'; Id=3033,3077; StartTime=(Get-Date).AddDays(-7)} -ErrorAction SilentlyContinue | ` +
    `ForEach-Object { if ($_.Message -match 'attempted to load (\\S+)') { $matches[1] } } | Where-Object { $_ -like '*${root}*' } | Select-Object -Unique`);
  // Only files that still exist (old blocks of since-replaced versions don't matter).
  return (r.stdout || '').split(/\r?\n/).filter(Boolean)
    .map((f) => f.replace(/^\\Device\\HarddiskVolume\d+/i, P.ROOT.slice(0, 2)))
    .filter((f) => fs.existsSync(f))
    .map((f) => path.relative(P.ROOT, f));
}

function checkSmartAppControl() {
  const r = ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy' -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState");
  const state = Number((r.stdout || '').trim());
  // The event log also holds blocks from when SAC was on earlier; only use it while it is on.
  // (Blocks by other policies show up in the programs check, which really runs each program.)
  const blocked = state === 1 ? blockedByWindows() : [];
  if (state === 1) {
    return { id: 'sac', status: blocked.length ? 'warn' : 'info', title: T('Smart App Control is ON', 'ميزة Smart App Control مفعّلة'),
      detail: T(`Windows blocks programs that are not signed and not yet widely used. AMPLE's components are not signed, so brand-new releases can be blocked for a few weeks. AMPLE tests every new version before using it and stays on the older one if it is blocked.${blocked.length ? ` Blocked recently: ${blocked.slice(0, 6).join(', ')}` : ''}`,
        `يمنع ويندوز البرامج غير الموقّعة رقمياً وغير المنتشرة بعد. مكونات AMPLE غير موقّعة، لذلك قد تُمنع الإصدارات الجديدة جداً لبضعة أسابيع. يختبر AMPLE كل إصدار جديد قبل استخدامه، ويبقى على الإصدار الأقدم إذا مُنع.${blocked.length ? ` الملفات الممنوعة مؤخراً: ${blocked.slice(0, 6).join('، ')}` : ''}`),
      fix: blocked.length ? T('Usually nothing to do: keep the current versions. Turning Smart App Control off (Windows Security → App & browser control) removes the block for everything, but it is your decision; on older Windows versions it cannot be turned back on.', 'غالباً لا حاجة لأي إجراء: أبقِ الإصدارات الحالية. إطفاء Smart App Control (أمن Windows ← التحكم في التطبيقات والمستعرض) يرفع المنع عن كل شيء، لكنه قرارك أنت، وفي إصدارات ويندوز الأقدم لا يمكن إعادة تشغيله.') : null };
  }
  if (state === 2) {
    return { id: 'sac', status: 'info', title: T('Smart App Control is in evaluation mode', 'ميزة Smart App Control في وضع التقييم'),
      detail: T('It only watches for now and blocks nothing. Windows may switch it on later; AMPLE will then test new versions before using them.', 'تراقب فقط حالياً ولا تمنع شيئاً. قد يفعّلها ويندوز لاحقاً، وعندها سيختبر AMPLE الإصدارات الجديدة قبل استخدامها.') };
  }
  return { id: 'sac', status: 'ok', title: T('Smart App Control is off', 'ميزة Smart App Control مطفأة') };
}

function checkPrograms() {
  const config = require('./config');
  const phpVersion = config.activePhp();
  const phpDir = path.join(P.phpRoot, phpVersion);
  const env = config.envFor(phpDir);
  const list = [
    ['Apache', path.join(P.apache, 'bin', 'httpd.exe'), ['-v']],
    [`PHP ${phpVersion}`, path.join(phpDir, 'php.exe'), ['-n', '-v']],
    ['MariaDB', path.join(P.mariadb, 'bin', 'mariadbd.exe'), ['--version']],
    ['Mailpit', path.join(P.p('mailpit'), 'mailpit.exe'), ['version']],
    ['OpenSSL', path.join(P.apache, 'bin', 'openssl.exe'), ['version']],
  ];
  const bad = [], blocked = [], missing = [];
  for (const [name, exe, args] of list) {
    const r = tryRun(exe, args, env);
    if (r.missing) missing.push(name);
    else if (r.blocked) blocked.push(name);
    else if (!r.ok) bad.push(`${name} (exit ${r.code})`);
  }
  // PHP extensions: from AMPLE's per-version test cache.
  const extCache = (() => { try { return JSON.parse(fs.readFileSync(path.join(phpDir, '.ample', 'extensions.json'), 'utf8')); } catch { return {}; } })();
  const extBlocked = Object.entries(extCache).filter(([, v]) => !v.ok && /Smart App Control/i.test(v.reason)).map(([k]) => k);
  const problems = [...blocked.map((b) => `${b}: blocked by Windows`), ...bad, ...missing.map((m) => `${m}: not installed`)];
  if (extBlocked.length) problems.push(`PHP extensions blocked by Windows: ${extBlocked.join(', ')}`);
  return {
    id: 'programs', status: problems.length ? (blocked.length || missing.length ? 'fail' : 'warn') : 'ok',
    title: problems.length ? T('Some programs cannot run', 'بعض البرامج لا تعمل') : T('All programs run (Apache, PHP, MariaDB, Mailpit, OpenSSL)', 'كل البرامج تعمل (Apache و PHP و MariaDB و Mailpit و OpenSSL)'),
    detail: problems.length ? T(problems.join('; '), problems.join('؛ ')) : null,
    fix: missing.length ? T('Run: ample setup', 'نفّذ: ample setup') : blocked.length || extBlocked.length ? T('See the Smart App Control check above.', 'راجع فحص Smart App Control أعلاه.') : null,
  };
}

function checkDefender() {
  const r = ps('$s = Get-MpComputerStatus -ErrorAction SilentlyContinue; if ($s) { "$($s.RealTimeProtectionEnabled)" }; ' +
    '$p = Get-MpPreference -ErrorAction SilentlyContinue; if ($p) { ($p.ExclusionPath -join "|") }');
  const lines = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { id: 'defender', status: 'info', title: T('Microsoft Defender status unknown', 'حالة Microsoft Defender غير معروفة'), detail: T('Another antivirus may be in use.', 'ربما يُستخدم برنامج حماية آخر.') };
  const realtime = /True/i.test(lines[0]);
  if (!realtime) return { id: 'defender', status: 'ok', title: T('Defender real-time scanning is off or managed by another antivirus', 'الفحص اللحظي في Defender مطفأ أو يديره برنامج حماية آخر') };
  const ex = (lines[1] || '');
  const readable = !/must be an administrator|N\/A/i.test(ex);
  const excluded = readable && ex.split('|').some((p) => p && P.ROOT.toLowerCase().startsWith(p.toLowerCase().replace(/\\+$/, '')));
  if (excluded) return { id: 'defender', status: 'ok', title: T('Defender: the AMPLE folder is excluded from scanning', 'Defender: مجلد AMPLE مستثنى من الفحص') };
  return {
    id: 'defender', status: 'info',
    title: T(readable ? 'Defender scans the AMPLE folder' : 'Defender is on (exclusions can only be read as administrator)', readable ? 'يفحص Defender مجلد AMPLE' : 'برنامج Defender يعمل (لا يمكن قراءة الاستثناءات إلا كمسؤول)'),
    detail: T('Every PHP file, database file and log write is scanned in real time. On big projects (Laravel, WordPress, node_modules) this can make pages, Composer and imports much slower.', 'يُفحص كل ملف PHP وكل ملف قاعدة بيانات وكل كتابة في السجلات لحظياً. في المشاريع الكبيرة (Laravel و WordPress و node_modules) قد يجعل ذلك الصفحات و Composer والاستيراد أبطأ بكثير.'),
    fix: T(`Optional: ample check --fix defender (asks for administrator once). Trade-off: files in ${P.ROOT} are then not scanned, so only put your own projects there.`, `اختياري: ample check --fix defender (يطلب صلاحيات المسؤول مرة واحدة). الثمن: لن تُفحص الملفات داخل ${P.ROOT}، لذا ضع فيه مشاريعك أنت فقط.`),
  };
}

function checkPath() {
  const root = P.ROOT;
  const problems = [], fixes = [];
  if (/[^\x00-\x7F]/.test(root)) {
    problems.push(T('the folder path contains non-English characters, which Apache and MariaDB do not handle reliably', 'مسار المجلد يحتوي على أحرف غير إنجليزية، ولا يتعامل معها Apache و MariaDB بشكل موثوق'));
  }
  if (/\s/.test(root)) problems.push(T('the folder path contains spaces', 'مسار المجلد يحتوي على مسافات'));
  if (root.length > 80) problems.push(T(`the path is long (${root.length} characters); deep project folders may hit Windows' 260-character limit`, `المسار طويل (${root.length} حرفاً)، وقد تصل مجلدات المشاريع العميقة إلى حد ويندوز البالغ 260 حرفاً`));
  const oneDrive = [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean);
  if (oneDrive.some((o) => root.toLowerCase().startsWith(o.toLowerCase())) || /\\OneDrive[\\ -]/i.test(root)) {
    problems.push(T('the folder is inside OneDrive: syncing locks database and log files while MariaDB and Apache use them', 'المجلد داخل OneDrive: المزامنة تقفل ملفات قاعدة البيانات والسجلات أثناء استخدام MariaDB و Apache لها'));
  }
  if (problems.length) fixes.push(T('Move the whole AMPLE folder to C:\\ample (AMPLE works from any folder; nothing needs editing). Then: ample path add (if you use it).', 'انقل مجلد AMPLE بالكامل إلى C:\\ample (يعمل AMPLE من أي مجلد دون تعديل أي شيء). ثم نفّذ: ample path add (إذا كنت تستخدمه).'));
  return {
    id: 'path', status: problems.length ? 'warn' : 'ok',
    title: problems.length ? T('The AMPLE folder location may cause problems', 'قد يسبب مكان مجلد AMPLE مشكلات') : T(`Folder location is fine (${root})`, `مكان المجلد مناسب (${root})`),
    detail: problems.length ? T(problems.map((p) => p.en).join('; '), problems.map((p) => p.ar).join('؛ ')) : null,
    fix: fixes[0] || null,
  };
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function checkPorts() {
  const services = require('./services');
  const s = settings.load();
  const want = [['http', s.ports.http, 'apache'], ['mysql', s.ports.mysql, 'mariadb'], ['smtp', s.ports.smtp, 'mailpit'], ['mailpit', s.ports.mailpit, 'mailpit']];
  if (s.https) want.push(['https', s.ports.https, 'apache']);
  const busy = [];
  for (const [, port, svc] of want) {
    if (await portFree(port)) continue;
    const st = await services.status(svc);
    const who = services.whoUsesPort(port);
    if (st.running && who && who.pid && isOurs(who)) continue;
    busy.push(`${port} (${who ? who.name : '?'})`);
  }
  function isOurs(who) { return who.path && who.path.toLowerCase().startsWith(P.ROOT.toLowerCase()); }
  return {
    id: 'ports', status: busy.length ? 'warn' : 'ok',
    title: busy.length ? T('Some ports are used by other programs', 'بعض المنافذ تستخدمها برامج أخرى') : T(`Ports are free or used by AMPLE (${want.map((w) => w[1]).join(', ')})`, `المنافذ متاحة أو يستخدمها AMPLE (${want.map((w) => w[1]).join('، ')})`),
    detail: busy.length ? T(`Busy: ${busy.join(', ')}`, `مستخدمة: ${busy.join('، ')}`) : null,
    fix: busy.length ? T('Start AMPLE: Log Doctor names each program and offers another port.', 'شغّل AMPLE: سيذكر Log Doctor اسم كل برنامج ويقترح منفذاً آخر.') : null,
  };
}

function checkDisk() {
  try {
    const st = fs.statfsSync(P.ROOT);
    const free = st.bavail * st.bsize;
    const gb = (free / 1024 ** 3).toFixed(1);
    return { id: 'disk', status: free < 2 * 1024 ** 3 ? 'warn' : 'ok', title: T(`Free disk space: ${gb} GB`, `المساحة المتاحة على القرص: ${gb} GB`),
      detail: free < 2 * 1024 ** 3 ? T('Less than 2 GB: databases and imports may fail.', 'أقل من 2 GB: قد تفشل قواعد البيانات وعمليات الاستيراد.') : null };
  } catch { return { id: 'disk', status: 'info', title: T('Free disk space unknown', 'المساحة المتاحة غير معروفة') }; }
}

async function run() {
  const out = [];
  for (const fn of [checkWindows, checkVcRuntime, checkSmartAppControl, checkPrograms, checkDefender, checkPath, checkPorts, checkDisk]) {
    try { out.push(await fn()); } catch (e) { out.push({ id: fn.name, status: 'info', title: T(`${fn.name}: could not check`, `${fn.name}: تعذّر الفحص`), detail: T(e.message, e.message) }); }
  }
  return out;
}

// Optional fix: exclude the AMPLE folder from Defender (UAC prompt; the user confirms).
function fixDefender() {
  // -EncodedCommand (UTF-16LE, base64) avoids every quoting problem with the path.
  const cmd = `Add-MpPreference -ExclusionPath '${P.ROOT.replace(/'/g, "''")}'`;
  const encoded = Buffer.from(cmd, 'utf16le').toString('base64');
  const r = ps(`Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`);
  return r.status === 0;
}

module.exports = { run, fixDefender, tryRun, SAC_EXIT };
