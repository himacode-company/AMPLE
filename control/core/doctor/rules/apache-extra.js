'use strict';
// More Log Doctor rules for Apache: start-up problems, .htaccess mistakes, notices.

module.exports = [
  {
    id: 'apache.module_load',
    startup: true,
    match: /Cannot load (.+?) into server: (.*)/,
    vars: (m) => ({ module: m[1].split(/[\\/]/).pop(), reason: m[2].trim() }),
    title: { en: 'Apache could not load {module}', ar: 'لم يستطع Apache تحميل {module}' },
    summary: { en: '{reason}', ar: 'السبب: {reason}' },
    details: {
      en: '"The specified module could not be found" usually means a DLL it depends on is missing (for PHP: php8ts.dll or its libraries, or the Visual C++ runtime). "Application Control policy has blocked this file" means Windows Smart App Control blocked it.',
      ar: 'الرسالة "The specified module could not be found" تعني عادةً أن ملف DLL يعتمد عليه مفقود (بالنسبة لـ PHP: الملف php8ts.dll أو مكتباته، أو مكتبة Visual C++). أما "Application Control policy has blocked this file" فتعني أن Smart App Control في ويندوز منعه.',
    },
    steps: {
      en: ['Repair the components: ample setup', 'Install the latest "Visual C++ Redistributable 2015-2022 x64" from Microsoft.', 'If Smart App Control blocked it: Windows Security → App & browser control → Smart App Control.'],
      ar: ['أصلح المكونات: ample setup', 'ثبّت أحدث نسخة من "Visual C++ Redistributable 2015-2022 x64" من موقع مايكروسوفت.', 'إذا منعه Smart App Control: أمن Windows ← التحكم في التطبيقات والمستعرض ← Smart App Control.'],
    },
  },

  {
    id: 'apache.no_listen',
    startup: true,
    match: /AH00451: no listening sockets available|AH00015: Unable to open logs|AH00091: httpd: could not open error log file (.+?)\./,
    title: { en: 'Apache could not start', ar: 'تعذّر تشغيل Apache' },
    summary: { en: 'Apache gave up during start-up (port busy or log file locked).', ar: 'توقف Apache أثناء التشغيل (المنفذ مشغول أو ملف السجل مقفول).' },
    details: {
      en: 'This message follows the real cause: usually the port is already used, or another Apache has the log files open. Look at the problem just before this one.',
      ar: 'تأتي هذه الرسالة بعد السبب الحقيقي: غالباً يكون المنفذ مستخدماً، أو أن نسخة Apache أخرى تفتح ملفات السجل. راجع المشكلة التي قبلها مباشرة.',
    },
    steps: { en: ['Check the other Apache problems in this list (same time).', 'Make sure no other Apache (XAMPP) is running.'], ar: ['راجع مشكلات Apache الأخرى في هذه القائمة (بالتوقيت نفسه).', 'تأكد من عدم وجود Apache آخر يعمل (مثل XAMPP).'] },
  },

  {
    id: 'apache.docroot_missing',
    startup: true,
    match: /AH00112: Warning: DocumentRoot \[(.+?)\] does not exist|DocumentRoot '(.+?)' is not a directory/,
    vars: (m) => ({ dir: m[1] || m[2] }),
    title: { en: 'Website folder does not exist', ar: 'مجلد الموقع غير موجود' },
    summary: { en: '{dir} is configured as a site folder but does not exist.', ar: 'المجلد {dir} محدد كمجلد لموقع، لكنه غير موجود.' },
    details: { en: 'A virtual host in apache\\conf\\vhosts points to a folder that was moved, renamed or deleted.', ar: 'أحد المواقع الوهمية في apache\\conf\\vhosts يشير إلى مجلد نُقل أو أُعيدت تسميته أو حُذف.' },
    steps: { en: ['Create the folder, or fix DocumentRoot in the .conf file in apache\\conf\\vhosts.'], ar: ['أنشئ المجلد، أو صحّح DocumentRoot في ملف .conf داخل apache\\conf\\vhosts.'] },
  },

  {
    id: 'apache.mailpit_down',
    resolvedBy: 'Mailpit', // fixed once Mailpit starts
    // Apache logs two lines for it (AH00957 and AH01114); only some include the port.
    match: /AH0(?:1114|0957|1102)\b.*(?:backend|127\.0\.0\.1)|failed to make connection to backend: 127\.0\.0\.1/,
    title: { en: 'Mailpit is not running', ar: 'برنامج Mailpit لا يعمل' },
    summary: { en: 'The page http://localhost/mailpit/ was opened, but Mailpit is stopped.', ar: 'تم فتح الصفحة http://localhost/mailpit/ لكن Mailpit متوقف.' },
    details: {
      en: 'Apache forwards /mailpit/ to Mailpit. When Mailpit is not running, the browser shows "503 Service Unavailable".',
      ar: 'يمرّر Apache العنوان /mailpit/ إلى Mailpit، وعندما لا يعمل Mailpit يعرض المتصفح الخطأ "503 Service Unavailable".',
    },
    steps: { en: ['Start Mailpit (button below) and reload the page.'], ar: ['شغّل Mailpit (الزر أدناه) ثم أعد تحميل الصفحة.'] },
    action: () => ({ type: 'service.start', params: { name: 'mailpit' }, label: { en: 'Start Mailpit', ar: 'شغّل Mailpit' } }),
  },

  {
    id: 'apache.no_index',
    match: /AH01276: Cannot serve directory (.+?): No matching DirectoryIndex/,
    vars: (m) => ({ dir: m[1] }),
    title: { en: 'Folder has no index page', ar: 'المجلد لا يحتوي على صفحة رئيسية' },
    summary: { en: '{dir} has no index.php / index.html, and listing the folder is not allowed there.', ar: 'المجلد {dir} لا يحتوي على index.php أو index.html، وعرض محتويات المجلد غير مسموح فيه.' },
    details: { en: 'Apache looks for index.php, index.html or index.htm when you open a folder. The browser shows "403 Forbidden".', ar: 'يبحث Apache عن index.php أو index.html أو index.htm عند فتح مجلد، ويعرض المتصفح الخطأ "403 Forbidden".' },
    steps: { en: ['Add an index.php to the folder, or open the exact file (e.g. /app/home.php).', 'Frameworks (Laravel): open the public folder, or create a .test site for the project.'], ar: ['أضف ملف index.php إلى المجلد، أو افتح الملف المطلوب مباشرة (مثل /app/home.php).', 'في أطر العمل مثل Laravel: افتح المجلد public، أو أنشئ موقع .test للمشروع.'] },
  },

  {
    id: 'apache.htaccess_rewrite',
    match: /(\S+\.htaccess): (RewriteRule: cannot compile regular expression|RewriteCond: bad flag delimiters|RewriteCond: unknown flag|RewriteRule: unknown flag|RewriteRule: bad flag delimiters)/,
    vars: (m) => ({ file: m[1], what: m[2] }),
    title: { en: 'Invalid rewrite rule in .htaccess', ar: 'قاعدة إعادة كتابة غير صالحة في .htaccess' },
    summary: { en: '{file}: {what}', ar: 'في الملف {file}: {what}' },
    details: { en: 'A RewriteRule/RewriteCond line has an invalid pattern or flags, so the whole folder returns "500 Internal Server Error".', ar: 'يحتوي سطر RewriteRule أو RewriteCond على نمط أو خيارات غير صالحة، لذلك يعرض المجلد كله الخطأ "500 Internal Server Error".' },
    steps: { en: ['Open {file} and check the [flags] are like [L,R=301,QSA] (no spaces) and the pattern is a valid regular expression.'], ar: ['افتح {file} وتحقق من أن الخيارات بين القوسين مثل [L,R=301,QSA] (دون مسافات)، ومن أن النمط تعبير نمطي (regex) صالح.'] },
  },

  {
    id: 'apache.htaccess_not_allowed',
    match: /(\S+\.htaccess): (\w+) not allowed here/,
    vars: (m) => ({ file: m[1], cmd: m[2] }),
    title: { en: '"{cmd}" is not allowed in .htaccess', ar: 'الأمر "{cmd}" غير مسموح في .htaccess' },
    summary: { en: '{file} uses {cmd}, which can only be set in the main configuration.', ar: 'يستخدم الملف {file} الأمر {cmd}، وهو لا يُضبط إلا في الإعدادات الرئيسية.' },
    details: { en: 'Some commands (for example DocumentRoot, ServerName, Listen, or Options in some setups) cannot be used in .htaccess.', ar: 'بعض الأوامر (مثل DocumentRoot و ServerName و Listen، أو Options في بعض الإعدادات) لا يمكن استخدامها داخل .htaccess.' },
    steps: { en: ['Remove the line from {file}; put it in a .conf file in apache\\conf\\vhosts if you need it.'], ar: ['احذف السطر من {file}، وضعه في ملف .conf داخل apache\\conf\\vhosts إذا كنت تحتاجه.'] },
  },

  {
    id: 'apache.htaccess_unreadable',
    match: /AH00529: (.+?\.htaccess) pcfg_openfile: unable to check htaccess file/,
    vars: (m) => ({ file: m[1] }),
    title: { en: 'Apache cannot read .htaccess', ar: 'لا يستطيع Apache قراءة ملف .htaccess' },
    summary: { en: '{file} exists but cannot be opened.', ar: 'الملف {file} موجود لكن لا يمكن فتحه.' },
    details: { en: 'Windows refused access: the file may be locked by another program, encrypted, or in a OneDrive "online-only" folder.', ar: 'رفض ويندوز الوصول: قد يكون الملف مقفولاً من برنامج آخر، أو مشفّراً، أو في مجلد OneDrive غير محفوظ على الجهاز.' },
    steps: { en: ['Make sure the file is available offline and not open in another program.', 'Keep projects in htdocs instead of OneDrive.'], ar: ['تأكد من أن الملف متاح دون اتصال وغير مفتوح في برنامج آخر.', 'احتفظ بالمشاريع في htdocs بدلاً من OneDrive.'] },
  },

  {
    id: 'apache.ssl_name',
    level: 'notice',
    match: /AH01909: (\S+) server certificate does NOT include an ID which matches the server name/,
    vars: (m) => ({ host: m[1] }),
    title: { en: 'SSL certificate name mismatch ({host})', ar: 'اسم شهادة SSL لا يطابق الموقع ({host})' },
    summary: { en: 'The HTTPS certificate was made for a different name.', ar: 'شهادة HTTPS صادرة لاسم مختلف.' },
    details: {
      en: 'XAMPP ships a sample certificate for "www.example.com", so Apache warns on every start. It is harmless locally, but browsers show a security warning for HTTPS. AMPLE will create trusted certificates for your .test sites.',
      ar: 'يأتي XAMPP بشهادة تجريبية للاسم "www.example.com"، لذلك يحذّر Apache عند كل تشغيل. لا ضرر منه محلياً، لكن المتصفحات تعرض تحذيراً أمنياً عند استخدام HTTPS. سيُنشئ AMPLE شهادات موثوقة لمواقع .test الخاصة بك.',
    },
    steps: { en: ['Nothing to do for HTTP. For HTTPS use AMPLE\'s local certificates.'], ar: ['لا حاجة لأي إجراء مع HTTP. ولـ HTTPS استخدم الشهادات المحلية في AMPLE.'] },
  },

  {
    id: 'apache.parent_exited',
    level: 'notice',
    match: /AH02538: Child: Parent process exited abruptly|AH00428: Parent: child process \d+ exited with status (\d+)/,
    title: { en: 'Apache was stopped abruptly', ar: 'أُوقف Apache بشكل مفاجئ' },
    summary: { en: 'The main Apache process ended without a normal shutdown.', ar: 'انتهت عملية Apache الرئيسية دون إيقاف طبيعي.' },
    details: {
      en: 'Happens when Apache is closed from Task Manager, by a control panel that kills it, or when Windows shuts down. If it happens while you are working, PHP probably crashed: check the PHP problems around the same time.',
      ar: 'يحدث ذلك عند إغلاق Apache من مدير المهام، أو من لوحة تحكم تُنهيه بالقوة، أو عند إطفاء ويندوز. إذا حدث أثناء عملك فالأرجح أن PHP تعطّل: راجع مشكلات PHP في التوقيت نفسه.',
    },
    steps: { en: ['Nothing to do if you stopped it yourself.', 'If Apache stops by itself, look for PHP errors at the same time.'], ar: ['لا حاجة لأي إجراء إذا أوقفته بنفسك.', 'إذا كان Apache يتوقف من تلقاء نفسه، فابحث عن أخطاء PHP في التوقيت نفسه.'] },
  },

  {
    id: 'apache.ssl_session_cache',
    level: 'notice',
    match: /AH01873: Init: Session Cache is not configured/,
    title: { en: 'HTTPS session cache not configured', ar: 'ذاكرة جلسات HTTPS غير مضبوطة' },
    summary: { en: 'mod_ssl is loaded without SSLSessionCache.', ar: 'تم تحميل mod_ssl دون ضبط SSLSessionCache.' },
    details: {
      en: 'Harmless: HTTPS still works, only reconnecting browsers do a full handshake again. AMPLE\'s current httpd.conf sets the cache; this comes from an older AMPLE config.',
      ar: 'لا ضرر منه: يبقى HTTPS يعمل، فقط تعيد المتصفحات عملية الاتصال الآمن كاملة عند إعادة الاتصال. يضبط httpd.conf الحالي في AMPLE هذه الذاكرة، لذلك تأتي الرسالة من إعدادات AMPLE قديمة.',
    },
    steps: { en: ['Restart Apache: ample restart apache'], ar: ['أعد تشغيل Apache: ample restart apache'] },
  },

  {
    id: 'apache.fqdn',
    level: 'notice',
    match: /AH00558: .*Could not reliably determine the server's fully qualified domain name/,
    title: { en: 'Apache has no server name', ar: 'لا يوجد اسم للخادم في Apache' },
    summary: { en: 'ServerName is not set; Apache guessed one.', ar: 'لم يُضبط ServerName، فخمّن Apache اسماً.' },
    details: { en: 'Harmless. AMPLE sets ServerName localhost, so it only appears with other configurations.', ar: 'لا ضرر منه. يضبط AMPLE القيمة ServerName localhost، لذلك لا تظهر الرسالة إلا مع إعدادات أخرى.' },
    steps: { en: ['Nothing to do.'], ar: ['لا حاجة لأي إجراء.'] },
  },

  {
    id: 'apache.timeout',
    level: 'notice',
    match: /AH01382: Request header read timeout|AH00121|AH01075: Error dispatching request/,
    title: { en: 'A browser connection timed out', ar: 'انتهت مهلة اتصال من المتصفح' },
    summary: { en: 'A browser opened a connection and sent nothing in time.', ar: 'فتح المتصفح اتصالاً ولم يرسل شيئاً في الوقت المحدد.' },
    details: { en: 'Browsers open spare connections in advance and close them later. Harmless.', ar: 'تفتح المتصفحات اتصالات احتياطية مسبقاً ثم تغلقها لاحقاً. لا ضرر منه.' },
    steps: { en: ['Nothing to do.'], ar: ['لا حاجة لأي إجراء.'] },
  },

  {
    id: 'apache.invalid_uri',
    level: 'notice',
    match: /AH10244: invalid URI path|AH00126: Invalid URI in request/,
    title: { en: 'Suspicious request blocked', ar: 'تم حظر طلب مشبوه' },
    summary: { en: 'A request with a malformed or "../" path was refused.', ar: 'رُفض طلب يحتوي على مسار غير صالح أو على "../".' },
    details: { en: 'Usually an automated scanner, or a broken link. Apache blocked it, nothing to fix.', ar: 'غالباً برنامج فحص آلي أو رابط معطوب، وقد حظره Apache، فلا يوجد ما يجب إصلاحه.' },
    steps: { en: ['Nothing to do.'], ar: ['لا حاجة لأي إجراء.'] },
  },

  {
    id: 'apache.access_compat',
    match: /AH01797: client denied by server configuration: (.+)/,
    vars: (m) => ({ path: m[1] }),
    title: { en: '.htaccess blocks access to {path}', ar: 'ملف .htaccess يمنع الوصول إلى {path}' },
    summary: { en: 'An old-style "Deny from" / "Order" rule refused the request.', ar: 'رفضت قاعدة قديمة من نوع "Deny from" أو "Order" الطلب.' },
    details: { en: 'Old Apache 2.2 access rules in a .htaccess blocked this file or folder. Often intentional (protecting config files).', ar: 'منعت قواعد وصول قديمة من Apache 2.2 داخل ملف .htaccess هذا الملف أو المجلد، وغالباً يكون ذلك مقصوداً (لحماية ملفات الإعدادات).' },
    steps: { en: ['If it should be reachable, replace "Order/Deny/Allow" with "Require all granted" (Apache 2.4 syntax).'], ar: ['إذا كان يجب أن يكون متاحاً، فاستبدل "Order/Deny/Allow" بالأمر "Require all granted" (صيغة Apache 2.4).'] },
  },
];
