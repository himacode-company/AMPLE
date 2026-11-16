'use strict';
// Log Doctor rules for Mailpit (logs\mailpit\mailpit.log).

module.exports = [
  {
    id: 'mailpit.bind',
    startup: true,
    match: /listen tcp [^:]*:(\d+): bind/,
    vars: (m) => ({ port: m[1] }),
    title: { en: 'Mailpit could not use port {port}', ar: 'لم يستطع Mailpit استخدام المنفذ {port}' },
    summary: { en: 'Another program is already using port {port}.', ar: 'هناك برنامج آخر يستخدم المنفذ {port} بالفعل.' },
    details: {
      en: 'Most often it is another Mailpit or MailHog you installed yourself, which uses the same ports (1025 for SMTP, 8025 for the web page).',
      ar: 'غالباً يكون برنامج Mailpit أو MailHog آخر ثبّته بنفسك، فهو يستخدم المنافذ نفسها (1025 لاستقبال البريد و 8025 لصفحة الويب).',
    },
    steps: {
      en: ['Close your other Mailpit/MailHog (Task Manager → mailpit.exe), AMPLE includes one.', 'Or let AMPLE use other ports (button below); PHP\'s mail() follows automatically.'],
      ar: ['أغلق برنامج Mailpit أو MailHog الآخر (مدير المهام ← mailpit.exe)، فـ AMPLE يتضمن واحداً.', 'أو اجعل AMPLE يستخدم منافذ أخرى (الزر أدناه)، وستتبعها الدالة mail() في PHP تلقائياً.'],
    },
    action: (v) => {
      const s = require('../../settings').load();
      return { type: 'ports.change', params: { service: Number(v.port) === s.ports.smtp ? 'smtp' : 'mailpit' }, label: { en: 'Use another port', ar: 'استخدم منفذاً آخر' } };
    },
  },

  {
    id: 'mailpit.cors',
    match: /\[cors\] blocking request from unauthorized origin: (\S+)/,
    vars: (m) => ({ origin: m[1] }),
    title: { en: 'Mailpit refused requests from {origin}', ar: 'رفض Mailpit طلبات قادمة من {origin}' },
    summary: {
      en: 'The browser\'s address and the address Mailpit received did not match, so Mailpit blocked them.',
      ar: 'لم يتطابق عنوان المتصفح مع العنوان الذي وصل إلى Mailpit، فمنع Mailpit الطلبات.',
    },
    details: {
      en: 'Mailpit protects its API by checking that requests come from its own page. When it is opened through a proxy that changes the host name, live updates and some buttons stop working. AMPLE\'s Apache keeps the original host (ProxyPreserveHost); this appears with an older AMPLE config or when Mailpit is opened through another address.',
      ar: 'يحمي Mailpit واجهته البرمجية بالتحقق من أن الطلبات قادمة من صفحته نفسها. عندما يُفتح عبر وسيط (proxy) يغيّر اسم المضيف، يتوقف التحديث اللحظي وبعض الأزرار. يحافظ Apache في AMPLE على اسم المضيف الأصلي (ProxyPreserveHost)، لذلك تظهر هذه الرسالة مع إعدادات AMPLE قديمة أو عند فتح Mailpit من عنوان آخر.',
    },
    steps: {
      en: ['Open Mailpit at http://localhost/mailpit/', 'Restart Apache so it uses the current config: ample restart apache'],
      ar: ['افتح Mailpit على العنوان http://localhost/mailpit/', 'أعد تشغيل Apache ليستخدم الإعدادات الحالية: ample restart apache'],
    },
    action: () => ({ type: 'service.restart', params: { name: 'apache' }, label: { en: 'Restart Apache', ar: 'أعد تشغيل Apache' } }),
  },

  {
    id: 'mailpit.database',
    match: /(database is locked|database disk image is malformed|file is not a database|unable to open database)/i,
    vars: (m) => ({ why: m[1] }),
    title: { en: 'Mailpit\'s email storage has a problem', ar: 'مشكلة في مخزن رسائل Mailpit' },
    summary: { en: 'Mailpit could not use its database: {why}.', ar: 'لم يستطع Mailpit استخدام قاعدة بياناته: {why}.' },
    details: {
      en: '"locked" means another Mailpit uses the same file. "malformed" means the file was damaged (e.g. the PC turned off). It only contains test emails, so deleting it is safe.',
      ar: '"locked" تعني أن Mailpit آخر يستخدم الملف نفسه، و "malformed" تعني أن الملف تلف (مثلاً بسبب إطفاء الحاسوب). يحتوي الملف على رسائل تجريبية فقط، لذلك حذفه آمن.',
    },
    steps: {
      en: ['Stop Mailpit: ample stop mailpit', 'Delete mailpit\\data\\mailpit.db (only test emails are lost).', 'Start it again: ample start mailpit'],
      ar: ['أوقف Mailpit: ample stop mailpit', 'احذف الملف mailpit\\data\\mailpit.db (ستُحذف الرسائل التجريبية فقط).', 'شغّله من جديد: ample start mailpit'],
    },
  },
];
