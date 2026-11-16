'use strict';
// Log Doctor rules for Apache (logs\apache\error.log).

module.exports = [
  {
    id: 'apache.bind',
    startup: true, // stops the service from starting; resolved once it starts
    match: /AH00072|could not bind to address[^:]*:(\d+)|make_sock: could not bind/,
    vars: (m) => ({ port: m[1] || '80' }),
    title: { en: 'Apache could not use port {port}', ar: 'لم يستطع Apache استخدام المنفذ {port}' },
    summary: {
      en: 'Another program is already using port {port}.',
      ar: 'هناك برنامج آخر يستخدم المنفذ {port} بالفعل.',
    },
    details: {
      en: 'Only one program can listen on a port. AMPLE checks the port before starting and names the program in logs\\ample\\ample.log. Common culprits: another Apache (XAMPP/WAMP), IIS, Skype, VMware.',
      ar: 'لا يمكن إلا لبرنامج واحد استخدام المنفذ نفسه. يفحص AMPLE المنفذ قبل التشغيل ويذكر اسم البرنامج في logs\\ample\\ample.log. أشهر الأسباب: نسخة Apache أخرى (XAMPP أو WAMP)، أو IIS، أو Skype، أو VMware.',
    },
    steps: {
      en: ['Run: ample doctor  — the AMPLE entry for this start names the program using the port.', 'Close that program, or let AMPLE use another port (button below).'],
      ar: ['نفّذ: ample doctor  — سيذكر سجل AMPLE الخاص بهذه المحاولة اسم البرنامج الذي يستخدم المنفذ.', 'أغلق ذلك البرنامج، أو اجعل AMPLE يستخدم منفذاً آخر (الزر أدناه).'],
    },
    action: () => ({ type: 'ports.change', params: { service: 'http' }, label: { en: 'Use another port', ar: 'استخدم منفذاً آخر' } }),
  },

  {
    id: 'apache.denied',
    match: /AH01630: client denied by server configuration: (.+)/,
    // Two different situations: a request from THIS computer refused by the
    // configuration (e.g. .htaccess files are protected), or another device on the network.
    vars: (m, e) => {
      const client = (e.client || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
      const local = /^(127\.|::1$|localhost$)/.test(client);
      const path = m[1].trim();
      return { path, client, local: local ? 'yes' : '', file: path.split(/[\\/]/).pop() };
    },
    title: {
      en: (v) => (v.local ? 'Access to {file} is forbidden by the configuration' : 'Access refused for {client}'),
      ar: (v) => (v.local ? 'الإعدادات تمنع الوصول إلى {file}' : 'تم رفض الوصول من الجهاز {client}'),
    },
    summary: {
      en: (v) => (v.local ? 'This computer requested {path}, and Apache\'s rules forbid serving it.' : 'A device other than this computer tried to open {path}.'),
      ar: (v) => (v.local ? 'طلب هذا الحاسوب الملف {path}، وقواعد Apache تمنع عرضه.' : 'حاول جهاز غير هذا الحاسوب فتح {path}.'),
    },
    details: {
      en: (v) => (v.local
        ? 'A "Require all denied" rule applies to this path. This is usually intentional: files like .htaccess, .env or .git must never be served. If it is a normal page, a .htaccess in that folder (or a parent folder) blocks it.'
        : 'For safety, AMPLE only answers requests from this computer (Require local). Phones or other PCs on your network are refused, which is what you want unless you are testing on a phone.'),
      ar: (v) => (v.local
        ? 'تنطبق قاعدة "Require all denied" على هذا المسار. غالباً يكون ذلك مقصوداً: فملفات مثل .htaccess و .env و .git يجب ألا تُعرض أبداً. أما إذا كانت صفحة عادية، فهناك ملف .htaccess في المجلد نفسه (أو في مجلد أعلى) يمنعها.'
        : 'حرصاً على الأمان، لا يستجيب AMPLE إلا للطلبات القادمة من هذا الحاسوب (Require local). لذلك تُرفض الهواتف والأجهزة الأخرى على شبكتك، وهذا هو السلوك المطلوب إلا إذا كنت تختبر موقعك على الهاتف.'),
    },
    steps: {
      en: (v) => (v.local
        ? ['If {file} is a protected file (.htaccess, .env), nothing to do: it is blocked on purpose.', 'If it should open, look for "Require all denied" or "Deny from all" in the .htaccess files of that folder and its parents.']
        : ['If this was you testing from a phone, network access can be enabled from the control panel (Settings → Allow other devices).', 'If you don\'t know this device, ignore it: the request was blocked.']),
      ar: (v) => (v.local
        ? ['إذا كان {file} ملفاً محمياً (.htaccess أو .env) فلا حاجة لأي إجراء: إنه محظور عن قصد.', 'إذا كان يجب أن يفتح، فابحث عن "Require all denied" أو "Deny from all" في ملفات .htaccess في هذا المجلد والمجلدات الأعلى منه.']
        : ['إذا كنت أنت من يختبر من الهاتف، فيمكن السماح بالوصول من الشبكة من لوحة التحكم (الإعدادات ← السماح للأجهزة الأخرى).', 'إذا كنت لا تعرف هذا الجهاز فتجاهل الرسالة: لقد تم حظر الطلب.']),
    },
  },

  {
    id: 'apache.redirect_loop',
    match: /AH00124: Request exceeded the limit of (\d+) internal redirects/,
    title: { en: 'Endless redirect loop in .htaccess', ar: 'حلقة تحويل لا نهائية في ملف .htaccess' },
    summary: {
      en: 'A RewriteRule keeps redirecting the request to itself.',
      ar: 'قاعدة RewriteRule تعيد تحويل الطلب إلى نفسه باستمرار.',
    },
    details: {
      en: 'A rewrite rule matches its own result again (for example index.php → index.php), so Apache gave up after 10 rounds. The page shows "500 Internal Server Error".',
      ar: 'قاعدة إعادة الكتابة تطابق نتيجتها مرة أخرى (مثلاً index.php ← index.php)، فتوقف Apache بعد 10 محاولات، وتظهر الصفحة بخطأ "500 Internal Server Error".',
    },
    steps: {
      en: ['Open the project\'s .htaccess file.', 'Before the RewriteRule add:\n    RewriteCond %{REQUEST_FILENAME} !-f\n    RewriteCond %{REQUEST_FILENAME} !-d', 'If the project lives in a subfolder (htdocs\\myapp), set: RewriteBase /myapp/'],
      ar: ['افتح ملف .htaccess الخاص بالمشروع.', 'أضف قبل RewriteRule السطرين:\n    RewriteCond %{REQUEST_FILENAME} !-f\n    RewriteCond %{REQUEST_FILENAME} !-d', 'إذا كان المشروع في مجلد فرعي (htdocs\\myapp)، فأضف: RewriteBase /myapp/'],
    },
  },

  {
    id: 'apache.htaccess_invalid',
    match: /(\S+\.htaccess): Invalid command '([^']+)'/,
    vars: (m) => ({ file: m[1], cmd: m[2] }),
    title: { en: 'Unknown command "{cmd}" in .htaccess', ar: 'أمر غير معروف "{cmd}" في ملف .htaccess' },
    summary: {
      en: '{file} uses "{cmd}", which this Apache does not understand.',
      ar: 'يستخدم الملف {file} الأمر "{cmd}"، ولا يفهمه Apache الحالي.',
    },
    details: {
      en: 'Either the command has a typo, or it belongs to an Apache module AMPLE does not load (for example SSL or proxy commands). The whole folder returns "500 Internal Server Error" until it is fixed.',
      ar: 'إما أن الأمر مكتوب بشكل خاطئ، أو أنه تابع لوحدة (module) في Apache لا يحمّلها AMPLE (مثل أوامر SSL أو proxy). سيعرض المجلد كله خطأ "500 Internal Server Error" حتى يتم إصلاحه.',
    },
    steps: {
      en: ['Open {file} and check the spelling of {cmd}.', 'If you don\'t need it locally, wrap it in <IfModule> or comment it out with #.'],
      ar: ['افتح {file} وتحقق من كتابة {cmd}.', 'إذا لم تكن بحاجة إليه محلياً، فضعه داخل <IfModule> أو عطّله بوضع # في بداية السطر.'],
    },
  },

  {
    id: 'apache.config_syntax',
    startup: true, // stops the service from starting; resolved once it starts
    match: /AH00526: Syntax error on line (\d+) of ([^:]+(?::[^:]+)?):/,
    vars: (m) => ({ line: m[1], file: m[2] }),
    title: { en: 'Error in Apache configuration', ar: 'خطأ في إعدادات Apache' },
    summary: { en: 'Line {line} of {file} is invalid.', ar: 'السطر {line} في الملف {file} غير صالح.' },
    details: {
      en: 'Apache refuses to start with an invalid configuration. If the file is one of yours in apache\\conf\\vhosts, fix it there; httpd.conf itself is generated by AMPLE from control\\templates\\httpd.conf.tpl.',
      ar: 'يرفض Apache العمل إذا كانت إعداداته غير صالحة. إذا كان الملف من ملفاتك في apache\\conf\\vhosts فأصلحه هناك، أما httpd.conf نفسه فيولّده AMPLE من control\\templates\\httpd.conf.tpl.',
    },
    steps: {
      en: ['Open {file} at line {line}.', 'Fix or remove the line, then start Apache again.'],
      ar: ['افتح {file} عند السطر {line}.', 'صحّح السطر أو احذفه، ثم شغّل Apache من جديد.'],
    },
  },

  {
    id: 'apache.unclean_pid',
    level: 'notice',
    match: /AH00098: pid file .+ overwritten/,
    title: { en: 'Apache was not stopped cleanly last time', ar: 'لم يُوقف Apache بشكل سليم في المرة السابقة' },
    summary: {
      en: 'Apache found its old pid file when it started.',
      ar: 'وجد Apache ملف رقم العملية (pid) القديم عند تشغيله.',
    },
    details: {
      en: 'Apache writes a small pid file while running and removes it when it stops normally. If Apache was closed from Task Manager or the PC was turned off, the file stays behind. Apache simply overwrites it, so nothing is broken.',
      ar: 'يكتب Apache ملفاً صغيراً برقم العملية (pid) أثناء عمله ويحذفه عند الإيقاف الطبيعي. إذا أُغلق Apache من مدير المهام أو أُطفئ الحاسوب، يبقى هذا الملف، ويقوم Apache ببساطة بالكتابة فوقه، لذلك لا يوجد أي عطل.',
    },
    steps: {
      en: ['Nothing to do. Stop Apache from AMPLE instead of Task Manager to avoid it.'],
      ar: ['لا حاجة لأي إجراء. لتجنّب ذلك، أوقف Apache من AMPLE بدلاً من مدير المهام.'],
    },
  },

  {
    id: 'apache.not_found',
    level: 'notice',
    match: /script '([^']+)' not found or unable to stat|AH00128: File does not exist: (.+)/,
    vars: (m) => ({ path: m[1] || m[2] }),
    title: { en: 'Page not found (404)', ar: 'الصفحة غير موجودة (404)' },
    summary: { en: '{path} does not exist.', ar: 'الملف {path} غير موجود.' },
    details: {
      en: 'Someone requested a file that is not in htdocs. This is often harmless (favicon.ico, a typo in the address), but repeated 404s for your own pages mean a wrong link or a missing rewrite rule.',
      ar: 'طُلب ملف غير موجود في htdocs. غالباً لا يدعو ذلك للقلق (مثل favicon.ico أو خطأ في كتابة العنوان)، لكن تكرار خطأ 404 لصفحاتك أنت يعني وجود رابط خاطئ أو قاعدة إعادة كتابة ناقصة.',
    },
    steps: {
      en: ['Check the address and that the file exists in htdocs.', 'Frameworks (Laravel, WordPress) need their .htaccess to route pretty URLs.'],
      ar: ['تحقق من العنوان ومن وجود الملف في htdocs.', 'أطر العمل مثل Laravel و WordPress تحتاج إلى ملف .htaccess الخاص بها لتوجيه الروابط.'],
    },
  },
];
