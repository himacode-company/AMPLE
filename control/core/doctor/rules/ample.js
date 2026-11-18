'use strict';
// Which ample.json "ports" key a busy port belongs to (for the "use another port" fix).
function portKey(service, port) {
  if (/mariadb/i.test(service)) return 'mysql';
  if (/mailpit/i.test(service)) return Number(port) === require('../../settings').load().ports.smtp ? 'smtp' : 'mailpit';
  return 'http';
}
// Log Doctor rules for AMPLE's own log (logs\ample\ample.log).
// Port lines look like:
//   port 3306 is already used by mysqld.exe (PID 4412) [service: MySQL80] [path: C:\...\mysqld.exe]

module.exports = [
  {
    id: 'ample.port',
    startup: true, // stops the service from starting; resolved once it starts
    match: /port (\d+) is already used by (\S+) \(PID (\d+)\)(?: \[service: ([^\]]+)\])?(?: \[path: ([^\]]+)\])?/,
    vars: (m, e) => {
      const ports = require('../ports');
      const info = { pid: Number(m[3]), name: m[2], services: m[4] ? m[4].split(',').map((x) => x.trim()) : [], path: m[5] || '' };
      const d = ports.describe(info);
      return {
        port: m[1], name: m[2], pid: m[3], service: e.service,
        whoEn: d.who.en, whoAr: d.who.ar, howEn: d.how.en, howAr: d.how.ar,
        svcKey: portKey(e.service, m[1]),
      };
    },
    title: { en: '{service} could not start: port {port} is taken', ar: 'لم يعمل {service}: المنفذ {port} مستخدم' },
    summary: { en: 'Port {port} is used by {name} (PID {pid}).', ar: 'المنفذ {port} يستخدمه البرنامج {name} (رقم العملية {pid}).' },
    details: { en: 'Who is it? {whoEn}', ar: 'ما هذا البرنامج؟ {whoAr}' },
    steps: {
      en: ['{howEn}', 'Or keep that program and let AMPLE use another port (button below).'],
      ar: ['{howAr}', 'أو أبقِ ذلك البرنامج يعمل واجعل AMPLE يستخدم منفذاً آخر (الزر أدناه).'],
    },
    action: (v) => ({ type: 'ports.change', params: { service: v.svcKey }, label: { en: 'Use another port', ar: 'استخدم منفذاً آخر' } }),
  },

  {
    id: 'ample.port_unknown',
    startup: true, // stops the service from starting; resolved once it starts
    match: /port (\d+) is already in use by another program/,
    vars: (m, e) => ({ port: m[1], service: e.service, svcKey: portKey(e.service, m[1]) }),
    title: { en: '{service} could not start: port {port} is taken', ar: 'لم يعمل {service}: المنفذ {port} مستخدم' },
    summary: { en: 'Another program is using port {port}.', ar: 'هناك برنامج آخر يستخدم المنفذ {port}.' },
    details: {
      en: 'Windows did not say which program it is (it may belong to another user or need administrator rights to see).',
      ar: 'لم يُظهر ويندوز اسم البرنامج (ربما يتبع مستخدماً آخر أو يحتاج إلى صلاحيات المسؤول لرؤيته).',
    },
    steps: {
      en: ['In a terminal run: netstat -ano | findstr :{port}  — the last number is the program\'s PID; find it in Task Manager → Details.', 'Or let AMPLE use another port (button below).'],
      ar: ['نفّذ في الطرفية: netstat -ano | findstr :{port}  — الرقم الأخير هو رقم العملية (PID)، ابحث عنه في مدير المهام ← Details.', 'أو اجعل AMPLE يستخدم منفذاً آخر (الزر أدناه).'],
    },
    action: (v) => ({ type: 'ports.change', params: { service: v.svcKey }, label: { en: 'Use another port', ar: 'استخدم منفذاً آخر' } }),
  },

  {
    // services.js: an optional Apache module was blocked, Apache started without it
    id: 'ample.sac_module_skipped',
    level: 'warning',
    match: /Smart App Control blocked (.+?); Apache started without/,
    vars: (m) => ({ files: m[1] }),
    title: { en: 'Apache runs without {files} (blocked by Windows)', ar: 'يعمل Apache دون {files} (منعه ويندوز)' },
    summary: {
      en: 'Windows Smart App Control blocked an optional Apache module, so AMPLE started Apache without it. Your sites work.',
      ar: 'منع Smart App Control في ويندوز إضافة اختيارية من Apache، فشغّل AMPLE خادم Apache بدونها. مواقعك تعمل.',
    },
    details: {
      en: 'These modules only add extras: page compression (mod_deflate), folder listings (mod_autoindex), cache headers (mod_expires), and the AMPLE look for phpMyAdmin and Mailpit (mod_substitute, mod_filter). Smart App Control blocks unsigned files until Microsoft has seen them on many PCs, so this often goes away by itself after a few weeks.',
      ar: 'هذه الإضافات للميزات الإضافية فقط: ضغط الصفحات (mod_deflate)، وعرض محتوى المجلدات (mod_autoindex)، وترويسات التخزين المؤقت (mod_expires)، وشكل AMPLE في phpMyAdmin و Mailpit (mod_substitute و mod_filter). يمنع Smart App Control الملفات غير الموقّعة حتى تراها مايكروسوفت على أجهزة كثيرة، لذلك يزول هذا غالباً من تلقاء نفسه بعد بضعة أسابيع.',
    },
    steps: {
      en: ['Nothing to do: AMPLE tries the module again on every start.', 'Run: ample check  — it lists every file Windows blocked.', 'Turning Smart App Control off (Windows Security → App & browser control) removes the block, but that is your decision: on many Windows versions it cannot be turned back on.'],
      ar: ['لا حاجة لأي إجراء: يجرّب AMPLE الإضافة من جديد مع كل تشغيل.', 'نفّذ: ample check  — يعرض كل ملف منعه ويندوز.', 'إطفاء Smart App Control (أمن Windows ← التحكم في التطبيقات والمستعرض) يرفع المنع، لكن ذلك قرارك أنت: في كثير من إصدارات ويندوز لا يمكن إعادة تشغيله.'],
    },
  },

  {
    // services.js: a core Apache file (PHP, rewrite, ssl...) was blocked, Apache cannot start
    id: 'ample.sac_apache_core',
    startup: true, // stops the service from starting; resolved once it starts
    match: /Smart App Control blocked (\S+), which Apache needs/,
    vars: (m) => ({ file: m[1] }),
    title: { en: 'Windows blocked {file}, so Apache cannot start', ar: 'منع ويندوز الملف {file}، فلا يستطيع Apache العمل' },
    summary: {
      en: 'Windows Smart App Control refused to load {file}, a file Apache cannot run without.',
      ar: 'رفض Smart App Control في ويندوز تحميل الملف {file}، وهو ملف لا يعمل Apache بدونه.',
    },
    details: {
      en: 'Smart App Control only lets unsigned files run once Microsoft has seen them on many PCs. Apache, PHP and their modules are open-source builds that are not digitally signed, so a release can be blocked for a few weeks.',
      ar: 'لا يسمح Smart App Control بتشغيل الملفات غير الموقّعة إلا بعد أن تراها مايكروسوفت على أجهزة كثيرة. و Apache و PHP وإضافاتهما نسخ مفتوحة المصدر غير موقّعة رقمياً، لذلك قد يُمنع إصدار منها لبضعة أسابيع.',
    },
    steps: {
      en: ['Run: ample check  — it lists every file Windows blocked.', 'If this started after an update, go back: ample setup reinstalls the versions listed in control\\components.json.', 'Turning Smart App Control off (Windows Security → App & browser control) removes the block, but that is your decision: on many Windows versions it cannot be turned back on.'],
      ar: ['نفّذ: ample check  — يعرض كل ملف منعه ويندوز.', 'إذا بدأ ذلك بعد تحديث، فارجع إلى الإصدار السابق: يعيد ample setup تثبيت الإصدارات المذكورة في control\\components.json.', 'إطفاء Smart App Control (أمن Windows ← التحكم في التطبيقات والمستعرض) يرفع المنع، لكن ذلك قرارك أنت: في كثير من إصدارات ويندوز لا يمكن إعادة تشغيله.'],
    },
  },

  {
    id: 'ample.config_failed',
    startup: true, // stops the service from starting; resolved once it starts
    match: /Apache config test failed/,
    title: { en: 'Apache configuration is invalid', ar: 'إعدادات Apache غير صالحة' },
    summary: { en: 'AMPLE tested httpd.conf before starting and Apache rejected it.', ar: 'اختبر AMPLE الملف httpd.conf قبل التشغيل فرفضه Apache.' },
    details: {
      en: 'The message after "failed:" says which file and line. If it is one of your files in apache\\conf\\vhosts, fix it there; if it is httpd.conf, the cause is in control\\templates\\httpd.conf.tpl.',
      ar: 'تذكر الرسالة بعد "failed:" اسم الملف ورقم السطر. إذا كان أحد ملفاتك في apache\\conf\\vhosts فأصلحه هناك، وإذا كان httpd.conf فالسبب في control\\templates\\httpd.conf.tpl.',
    },
    steps: {
      en: ['Read the full message in the raw log below.', 'Fix the line it names, then start Apache again.'],
      ar: ['اقرأ الرسالة كاملة في السجل الأصلي أدناه.', 'صحّح السطر المذكور ثم شغّل Apache من جديد.'],
    },
  },

  {
    id: 'ample.sac_blocked',
    startup: true, // stops the service from starting; resolved once it starts
    match: /failed to start \(exited with code (-1058471934|3236495362)\)/,
    vars: (m, e) => ({ service: e.service }),
    title: { en: '{service} was blocked by Windows Smart App Control', ar: 'منع Smart App Control في ويندوز تشغيل {service}' },
    summary: {
      en: 'Windows refused to run a program file of {service} because it is not signed and not yet widely used.',
      ar: 'رفض ويندوز تشغيل أحد ملفات {service} لأنه غير موقّع رقمياً وغير منتشر بعد.',
    },
    details: {
      en: 'Exit code 0xC0E90002 means "system integrity policy violation". Smart App Control only lets unsigned programs run once Microsoft has seen them on many PCs. Brand-new releases are blocked for a few weeks; older releases of the same program usually work.',
      ar: 'رمز الخروج 0xC0E90002 يعني "مخالفة سياسة سلامة النظام". لا يسمح Smart App Control بتشغيل البرامج غير الموقّعة إلا بعد أن تراها مايكروسوفت على أجهزة كثيرة، لذلك تُمنع الإصدارات الجديدة جداً لبضعة أسابيع، بينما تعمل غالباً الإصدارات الأقدم من البرنامج نفسه.',
    },
    steps: {
      en: ['Run: ample check  — it lists exactly which files are blocked.', 'If this started after an update, go back: ample setup reinstalls the versions listed in control\\components.json.', 'Turning Smart App Control off (Windows Security → App & browser control) removes the block, but that is your decision.'],
      ar: ['نفّذ: ample check  — يعرض الملفات الممنوعة بالتحديد.', 'إذا بدأ ذلك بعد تحديث، فارجع إلى الإصدار السابق: يعيد ample setup تثبيت الإصدارات المذكورة في control\\components.json.', 'إطفاء Smart App Control (أمن Windows ← التحكم في التطبيقات والمستعرض) يرفع المنع، لكن ذلك قرارك أنت.'],
    },
  },

  {
    id: 'ample.start_failed',
    startup: true, // stops the service from starting; resolved once it starts
    match: /failed to start \((.+)\)/,
    vars: (m, e) => ({ why: m[1], service: e.service, logdir: /mariadb/i.test(e.service) ? 'mariadb' : 'apache' }),
    title: { en: '{service} failed to start', ar: 'فشل تشغيل {service}' },
    summary: { en: '{service} {why}.', ar: 'توقف {service} أثناء التشغيل ({why}).' },
    details: {
      en: 'The reason is in the service\'s own log. Log Doctor lists the entries from that log right next to this one, so look for a {service} problem with the same time.',
      ar: 'السبب موجود في سجل الخدمة نفسها. يعرض Log Doctor مشكلات ذلك السجل بجانب هذه المشكلة، فابحث عن مشكلة في {service} بالتوقيت نفسه.',
    },
    steps: {
      en: ['Look at the other {service} problems in this list (same time).', 'If there are none, open logs\\{logdir}\\error.log and read the last lines.'],
      ar: ['راجع مشكلات {service} الأخرى في هذه القائمة (بالتوقيت نفسه).', 'إذا لم تجد أياً منها، فافتح logs\\{logdir}\\error.log واقرأ الأسطر الأخيرة.'],
    },
  },
];
