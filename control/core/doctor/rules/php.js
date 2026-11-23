'use strict';
// Log Doctor rules for PHP errors (logs\php\error.log).
// Every text has an English and an Arabic version. {name} = value from vars().
// Built-in vars available in all texts: {where} = "file:line" of the error.
const { human, nextSize, extForFunction, extForClass } = require('./util');

module.exports = [
  {
    // PHP 8.6+ (Visual Studio 2026 builds) on an older Visual C++ runtime. PHP prints:
    //   'C:\WINDOWS\SYSTEM32\VCRUNTIME140.dll' 14.40 is not compatible with this PHP build linked with 14.51
    // AMPLE's own check says: PHP 8.6.0 needs the Microsoft Visual C++ runtime 14.50 or newer (you have 14.40)
    id: 'php.vc_runtime',
    startup: true, // PHP cannot start at all; resolved once it starts
    match: /VCRUNTIME140(?:_1)?\.dll['"]?\s+(\d+\.\d+)[\d.]*\s+is not compatible with this PHP build linked with\s+(\d+\.\d+)|(?:PHP [\d.]+ )needs the Microsoft Visual C\+\+ runtime (\d+\.\d+) or newer \((?:you have (\d+\.\d+)|it is not installed)/,
    vars: (m) => ({ have: m[1] || m[4] || '—', need: m[2] || m[3] }),
    title: { en: 'PHP needs a newer Visual C++ runtime ({need}+)', ar: 'يحتاج PHP إلى إصدار أحدث من Visual C++ ({need} أو أحدث)' },
    summary: {
      en: 'This PHP version was built with a newer Microsoft compiler and does not start with the Visual C++ runtime on this PC ({have}).',
      ar: 'بُني إصدار PHP هذا بمترجم أحدث من مايكروسوفت، ولا يعمل مع مكتبة Visual C++ الموجودة على هذا الجهاز ({have}).',
    },
    details: {
      en: 'Apache and PHP use Microsoft\'s Visual C++ runtime (vcruntime140.dll), which is installed once for all of Windows. PHP 8.6 and newer are built with Visual Studio 2026 and need runtime 14.50 or newer. Nothing is wrong with PHP or your settings: only the runtime is too old.',
      ar: 'يستخدم Apache و PHP مكتبة Visual C++ من مايكروسوفت (vcruntime140.dll)، وهي تُثبَّت مرة واحدة لكل ويندوز. يُبنى PHP 8.6 وما بعده باستخدام Visual Studio 2026، ويحتاج إلى المكتبة بإصدار 14.50 أو أحدث. لا توجد مشكلة في PHP أو في إعداداتك: المكتبة فقط قديمة.',
    },
    steps: {
      en: ['Install the latest Visual C++ runtime (button below, or: ample vc install). AMPLE downloads it from Microsoft and checks Microsoft signed it; Windows asks for permission.', 'Then switch to this PHP version again, or start Apache again.', 'Until then, your other PHP versions keep working: ample php-use 8.5'],
      ar: ['ثبّت أحدث مكتبة Visual C++ (الزر أدناه، أو الأمر: ample vc install). ينزّلها AMPLE من مايكروسوفت ويتأكد أنها موقّعة منها، وسيطلب ويندوز إذنك.', 'بعدها بدّل إلى إصدار PHP هذا من جديد، أو شغّل Apache من جديد.', 'حتى ذلك الحين، تبقى إصدارات PHP الأخرى تعمل: ample php-use 8.5'],
    },
    action: () => ({ type: 'vc.install', params: {}, label: { en: 'Install Visual C++', ar: 'ثبّت Visual C++' } }),
  },
  {
    id: 'php.memory',
    match: /Allowed memory size of (\d+) bytes exhausted/,
    vars: (m) => ({ limit: human(m[1]), suggest: nextSize(m[1]) }),
    title: { en: 'PHP ran out of memory ({limit})', ar: 'نفدت ذاكرة PHP ({limit})' },
    summary: {
      en: 'A script tried to use more memory than memory_limit allows.',
      ar: 'حاول سكربت استخدام ذاكرة أكثر من الحد المسموح به في memory_limit.',
    },
    details: {
      en: 'PHP stops any script that uses more than memory_limit (now {limit}). Raising the limit helps when the work really needs more memory, such as big imports, image processing or Composer. If memory runs out at any limit, the code keeps allocating without end.',
      ar: 'يوقف PHP أي سكربت يتجاوز الحد المحدد في memory_limit (حالياً {limit}). رفع الحد يفيد إذا كانت العملية تحتاج فعلاً إلى ذاكرة أكبر، مثل استيراد ملفات كبيرة أو معالجة الصور أو Composer. أما إذا استمر نفاد الذاكرة مهما رفعت الحد، فالكود يستهلك الذاكرة بلا توقف.',
    },
    causes: {
      en: ['An infinite loop or endless recursion', 'Loading thousands of database rows at once', 'Reading a large file or image fully into memory'],
      ar: ['حلقة لا نهائية أو استدعاء ذاتي (recursion) لا يتوقف', 'جلب آلاف السجلات من قاعدة البيانات دفعة واحدة', 'قراءة ملف أو صورة كبيرة بالكامل في الذاكرة'],
    },
    steps: {
      en: ['Open {where} and check what the code is doing there.', 'If the task really needs more memory, raise memory_limit to {suggest} (button below).', 'For large data, process it in chunks (pagination, LIMIT/OFFSET, chunk()).', 'If it fails at any limit, look for a loop or recursion that never stops.'],
      ar: ['افتح {where} وتحقق مما يفعله الكود في هذا الموضع.', 'إذا كانت العملية تحتاج فعلاً إلى ذاكرة أكبر، ارفع memory_limit إلى {suggest} (الزر أدناه).', 'عند التعامل مع بيانات كبيرة، عالجها على دفعات (pagination أو LIMIT/OFFSET أو chunk()).', 'إذا استمر الخطأ مهما رفعت الحد، فابحث عن حلقة أو استدعاء ذاتي لا يتوقف.'],
    },
    action: (v) => ({ type: 'php.setIni', params: { values: { memory_limit: v.suggest } }, label: { en: 'Raise memory_limit to {suggest}', ar: 'ارفع memory_limit إلى {suggest}' } }),
  },

  {
    id: 'php.timeout',
    match: /Maximum execution time of (\d+) seconds? exceeded/,
    vars: (m) => ({ seconds: m[1], suggest: String(Math.max(300, Number(m[1]) * 2)) }),
    title: { en: 'Script took too long ({seconds} s)', ar: 'تجاوز السكربت الوقت المسموح ({seconds} ثانية)' },
    summary: {
      en: 'PHP stopped a script after max_execution_time ({seconds} seconds).',
      ar: 'أوقف PHP السكربت بعد انتهاء الوقت المحدد في max_execution_time ({seconds} ثانية).',
    },
    details: {
      en: 'To protect the server, PHP stops a script that runs longer than max_execution_time. Long imports, big reports or slow external APIs can legitimately need more time; a page that is simply stuck usually has a loop or a slow query.',
      ar: 'لحماية الخادم، يوقف PHP أي سكربت يعمل لمدة أطول من max_execution_time. قد تحتاج عمليات الاستيراد الطويلة أو التقارير الكبيرة أو الاتصال بخدمات خارجية بطيئة إلى وقت أطول فعلاً، أما الصفحة العالقة فغالباً سببها حلقة لا تنتهي أو استعلام بطيء.',
    },
    causes: {
      en: ['A slow database query (check logs\\mariadb\\slow.log)', 'Waiting for a slow external API or website', 'A loop that never ends'],
      ar: ['استعلام بطيء في قاعدة البيانات (راجع logs\\mariadb\\slow.log)', 'انتظار خدمة خارجية أو موقع بطيء', 'حلقة لا تنتهي'],
    },
    steps: {
      en: ['Check {where}: that is where the script was when time ran out.', 'Look in logs\\mariadb\\slow.log for slow queries.', 'If the task is legitimately long, raise max_execution_time to {suggest} (button below).'],
      ar: ['راجع {where}: هذا هو الموضع الذي كان فيه السكربت عند انتهاء الوقت.', 'ابحث في logs\\mariadb\\slow.log عن استعلامات بطيئة.', 'إذا كانت العملية طويلة بطبيعتها، ارفع max_execution_time إلى {suggest} ثانية (الزر أدناه).'],
    },
    action: (v) => ({ type: 'php.setIni', params: { values: { max_execution_time: v.suggest } }, label: { en: 'Raise max_execution_time to {suggest} s', ar: 'ارفع max_execution_time إلى {suggest} ثانية' } }),
  },

  {
    id: 'php.post_too_large',
    match: /POST Content-Length of (\d+) bytes exceeds the limit of (\d+) bytes/,
    vars: (m) => ({ size: human(m[1]), limit: human(m[2]), suggest: nextSize(Number(m[1]) * 1.2) }),
    title: { en: 'Upload too large ({size}, limit {limit})', ar: 'حجم الملف المرفوع أكبر من المسموح ({size}، والحد {limit})' },
    summary: {
      en: 'A form sent {size}, but post_max_size only allows {limit}. PHP dropped all the form data.',
      ar: 'أرسل نموذج بيانات بحجم {size}، بينما يسمح post_max_size بـ {limit} فقط، فتجاهل PHP جميع بيانات النموذج.',
    },
    details: {
      en: 'When a request is bigger than post_max_size, PHP discards the whole body: $_POST and $_FILES arrive empty, which often looks like "the form does nothing". upload_max_filesize must also be large enough for each single file.',
      ar: 'عندما يتجاوز الطلب حجم post_max_size يتجاهل PHP محتواه بالكامل، فيصل $_POST و $_FILES فارغين، ويبدو الأمر وكأن "النموذج لا يعمل". ويجب أيضاً أن يكون upload_max_filesize كافياً لحجم كل ملف على حدة.',
    },
    steps: {
      en: ['Raise post_max_size and upload_max_filesize to {suggest} (button below).', 'If you import a big .sql file, use AMPLE\'s database import instead of phpMyAdmin.'],
      ar: ['ارفع post_max_size و upload_max_filesize إلى {suggest} (الزر أدناه).', 'إذا كنت تستورد ملف .sql كبيراً، فاستخدم أداة الاستيراد في AMPLE بدلاً من phpMyAdmin.'],
    },
    action: (v) => ({ type: 'php.setIni', params: { values: { post_max_size: v.suggest, upload_max_filesize: v.suggest } }, label: { en: 'Raise upload limits to {suggest}', ar: 'ارفع حدود الرفع إلى {suggest}' } }),
  },

  {
    id: 'php.pdo_driver',
    match: /could not find driver/i,
    title: { en: 'PDO database driver missing', ar: 'برنامج تشغيل PDO لقاعدة البيانات غير مفعّل' },
    summary: {
      en: 'The code uses PDO, but the driver for this database is not enabled.',
      ar: 'يستخدم الكود PDO، لكن برنامج التشغيل الخاص بقاعدة البيانات هذه غير مفعّل.',
    },
    details: {
      en: 'PDO needs a separate extension for each database: pdo_mysql for MariaDB/MySQL, pdo_sqlite for SQLite, pdo_pgsql for PostgreSQL. AMPLE enables pdo_mysql and pdo_sqlite by default, so check the DSN in your code too (for example "mysql:host=127.0.0.1;dbname=shop").',
      ar: 'يحتاج PDO إلى إضافة منفصلة لكل نوع من قواعد البيانات: pdo_mysql لـ MariaDB و MySQL، و pdo_sqlite لـ SQLite، و pdo_pgsql لـ PostgreSQL. يفعّل AMPLE الإضافتين pdo_mysql و pdo_sqlite افتراضياً، لذا تحقق أيضاً من نص الاتصال (DSN) في الكود، مثل "mysql:host=127.0.0.1;dbname=shop".',
    },
    steps: {
      en: ['Check the DSN in your code starts with "mysql:" for MariaDB.', 'Enable pdo_mysql if it is off (button below).', 'For PostgreSQL, enable pdo_pgsql instead.'],
      ar: ['تأكد من أن نص الاتصال (DSN) في الكود يبدأ بـ "mysql:" عند استخدام MariaDB.', 'فعّل pdo_mysql إذا كانت معطلة (الزر أدناه).', 'إذا كنت تستخدم PostgreSQL، ففعّل pdo_pgsql بدلاً منها.'],
    },
    action: () => ({ type: 'php.enableExt', params: { ext: 'pdo_mysql' }, label: { en: 'Enable pdo_mysql', ar: 'فعّل pdo_mysql' } }),
  },

  {
    id: 'php.undefined_function',
    match: /Call to undefined function ([\w\\]+)\(\)/,
    vars: (m) => ({ fn: m[1], ext: extForFunction(m[1]) }),
    title: {
      en: (v) => (v.ext ? 'Function {fn}() needs the {ext} extension' : 'Function {fn}() does not exist'),
      ar: (v) => (v.ext ? 'الدالة {fn}() تحتاج إلى الإضافة {ext}' : 'الدالة {fn}() غير موجودة'),
    },
    summary: {
      en: (v) => (v.ext ? 'The {ext} extension that provides {fn}() is not enabled.' : 'PHP cannot find a function called {fn}().'),
      ar: (v) => (v.ext ? 'الإضافة {ext} التي توفّر الدالة {fn}() غير مفعّلة.' : 'لا يجد PHP دالة باسم {fn}().'),
    },
    details: {
      en: (v) => (v.ext
        ? '{fn}() is part of the {ext} extension. Extensions are optional parts of PHP that must be enabled in php.ini. Enable it and AMPLE restarts Apache for you.'
        : 'The function is not built into PHP and was not defined before it was called. Usually it is a typo, a missing include/require, or a namespace problem.'),
      ar: (v) => (v.ext
        ? 'الدالة {fn}() جزء من الإضافة {ext}. الإضافات أجزاء اختيارية من PHP يجب تفعيلها في php.ini. فعّلها وسيعيد AMPLE تشغيل Apache تلقائياً.'
        : 'الدالة ليست من دوال PHP الأساسية، ولم يتم تعريفها قبل استدعائها. السبب غالباً خطأ إملائي في الاسم، أو ملف لم يتم تضمينه (include/require)، أو مشكلة في الـ namespace.'),
    },
    steps: {
      en: (v) => (v.ext
        ? ['Enable the {ext} extension (button below).']
        : ['Check the spelling of {fn} at {where}.', 'Make sure the file that defines it is included (require_once) or autoloaded.', 'If it lives in a namespace, add "use function" or call it with its full name.']),
      ar: (v) => (v.ext
        ? ['فعّل الإضافة {ext} (الزر أدناه).']
        : ['تحقق من كتابة اسم الدالة {fn} في {where}.', 'تأكد من تضمين الملف الذي يعرّف الدالة (require_once) أو تحميله تلقائياً عبر autoload.', 'إذا كانت الدالة داخل namespace، فأضف "use function" أو استدعها باسمها الكامل.']),
    },
    action: (v) => (v.ext ? { type: 'php.enableExt', params: { ext: v.ext }, label: { en: 'Enable {ext}', ar: 'فعّل {ext}' } } : null),
  },

  {
    id: 'php.class_not_found',
    match: /Class "?([\w\\]+)"? not found/,
    vars: (m) => ({ cls: m[1], ext: extForClass(m[1]) }),
    title: {
      en: (v) => (v.ext ? 'Class {cls} needs the {ext} extension' : 'Class {cls} not found'),
      ar: (v) => (v.ext ? 'الكلاس {cls} يحتاج إلى الإضافة {ext}' : 'الكلاس {cls} غير موجود'),
    },
    summary: {
      en: (v) => (v.ext ? 'The {ext} extension that provides {cls} is not enabled.' : 'PHP could not load the class {cls}.'),
      ar: (v) => (v.ext ? 'الإضافة {ext} التي توفّر الكلاس {cls} غير مفعّلة.' : 'لم يستطع PHP تحميل الكلاس {cls}.'),
    },
    details: {
      en: (v) => (v.ext
        ? '{cls} is provided by the {ext} extension, which must be enabled in php.ini.'
        : 'PHP looked for the class and the autoloader could not find its file. In Composer projects this usually means the autoload files are outdated or the namespace/file name don\'t match.'),
      ar: (v) => (v.ext
        ? 'الكلاس {cls} توفّره الإضافة {ext}، ويجب تفعيلها في php.ini.'
        : 'بحث PHP عن الكلاس ولم يجد الـ autoloader الملف الخاص به. في مشاريع Composer يعني هذا غالباً أن ملفات الـ autoload قديمة، أو أن الـ namespace لا يطابق اسم الملف ومساره.'),
    },
    steps: {
      en: (v) => (v.ext
        ? ['Enable the {ext} extension (button below).']
        : ['Check the spelling and the "use" statement of {cls} at {where}.', 'In a Composer project run: composer dump-autoload', 'Make sure the file name matches the class name exactly (Linux servers are case-sensitive).', 'If the package is missing: composer install']),
      ar: (v) => (v.ext
        ? ['فعّل الإضافة {ext} (الزر أدناه).']
        : ['تحقق من كتابة اسم الكلاس {cls} وجملة "use" في {where}.', 'في مشاريع Composer نفّذ الأمر: composer dump-autoload', 'تأكد من أن اسم الملف يطابق اسم الكلاس تماماً (خوادم Linux تفرّق بين الأحرف الكبيرة والصغيرة).', 'إذا كانت الحزمة غير مثبتة، نفّذ: composer install']),
    },
    action: (v) => (v.ext ? { type: 'php.enableExt', params: { ext: v.ext }, label: { en: 'Enable {ext}', ar: 'فعّل {ext}' } } : null),
  },

  {
    id: 'php.db_refused',
    resolvedBy: 'MariaDB', // fixed once MariaDB starts
    match: /SQLSTATE\[HY000\] \[2002\]|target machine actively refused it|Can't connect to (?:MySQL|MariaDB) server/i,
    title: { en: 'Cannot connect to the database server', ar: 'تعذّر الاتصال بخادم قاعدة البيانات' },
    summary: {
      en: 'Your code tried to connect to MariaDB, but nothing answered.',
      ar: 'حاول الكود الاتصال بـ MariaDB، لكن لم يستجب أحد.',
    },
    details: {
      en: 'Either MariaDB is not running, or the code connects to a different host/port than the one MariaDB listens on (AMPLE uses 127.0.0.1 and the port in ample.json).',
      ar: 'إما أن MariaDB لا يعمل، أو أن الكود يتصل بعنوان أو منفذ (port) مختلف عن الذي يستخدمه MariaDB (يستخدم AMPLE العنوان 127.0.0.1 والمنفذ المحدد في ample.json).',
    },
    steps: {
      en: ['Start MariaDB (button below).', 'Check the host and port in your code (.env, config.php): host 127.0.0.1, port 3306 unless you changed it.', 'If it still fails, check logs\\mariadb\\error.log.'],
      ar: ['شغّل MariaDB (الزر أدناه).', 'تحقق من العنوان والمنفذ في إعدادات مشروعك (.env أو config.php): العنوان 127.0.0.1 والمنفذ 3306 إلا إذا غيّرته.', 'إذا استمرت المشكلة، فراجع logs\\mariadb\\error.log.'],
    },
    action: () => ({ type: 'service.start', params: { name: 'mariadb' }, label: { en: 'Start MariaDB', ar: 'شغّل MariaDB' } }),
  },

  {
    id: 'php.db_access_denied',
    match: /Access denied for user '([^']*)'@'([^']*)'(?: \(using password: (YES|NO)\))?/,
    vars: (m) => ({ user: m[1], host: m[2], withPw: m[3] || '' }),
    title: { en: 'Database login refused for {user}', ar: 'رفضت قاعدة البيانات تسجيل دخول المستخدم {user}' },
    summary: {
      en: (v) => (v.withPw === 'NO' ? 'No password was sent, but the account has one.' : 'The username or password in the code is wrong.'),
      ar: (v) => (v.withPw === 'NO' ? 'لم يُرسل الكود كلمة مرور، بينما الحساب محمي بكلمة مرور.' : 'اسم المستخدم أو كلمة المرور في الكود غير صحيحة.'),
    },
    details: {
      en: 'MariaDB refused the login for \'{user}\'@\'{host}\'. The credentials in your project must match MariaDB. AMPLE keeps the root password in ample.json; to change it everywhere at once use: ample password <new>',
      ar: 'رفض MariaDB تسجيل دخول \'{user}\'@\'{host}\'. يجب أن تطابق بيانات الدخول في مشروعك ما هو موجود في MariaDB. يحفظ AMPLE كلمة مرور root في ample.json، ولتغييرها في كل الأماكن دفعة واحدة استخدم الأمر: ample password <كلمة-جديدة>',
    },
    steps: {
      en: ['Open your project\'s database settings (.env, config.php, wp-config.php).', 'Compare the user and password with ample.json → mysql.', 'If the user is not root, check it exists in phpMyAdmin → User accounts.'],
      ar: ['افتح إعدادات قاعدة البيانات في مشروعك (.env أو config.php أو wp-config.php).', 'قارن اسم المستخدم وكلمة المرور مع القسم mysql في ample.json.', 'إذا لم يكن المستخدم root، فتأكد من وجوده في phpMyAdmin ← User accounts.'],
    },
  },

  {
    id: 'php.unknown_db',
    match: /Unknown database '([^']+)'/,
    vars: (m) => ({ db: m[1] }),
    title: { en: 'Database "{db}" does not exist', ar: 'قاعدة البيانات "{db}" غير موجودة' },
    summary: {
      en: 'The code connects to a database named {db} that has not been created.',
      ar: 'يتصل الكود بقاعدة بيانات اسمها {db} لم يتم إنشاؤها بعد.',
    },
    details: {
      en: 'MariaDB is running and the login worked, but there is no database called "{db}". Database names are case-insensitive in AMPLE.',
      ar: 'يعمل MariaDB ونجح تسجيل الدخول، لكن لا توجد قاعدة بيانات باسم "{db}". لا يفرّق AMPLE بين الأحرف الكبيرة والصغيرة في أسماء قواعد البيانات.',
    },
    steps: {
      en: ['Create it in phpMyAdmin → Databases → "{db}" with collation utf8mb4_unicode_ci.', 'Or import your .sql backup into it.', 'Or fix the database name in your project settings.'],
      ar: ['أنشئها من phpMyAdmin ← Databases باسم "{db}" وبترميز utf8mb4_unicode_ci.', 'أو استورد ملف النسخة الاحتياطية (.sql) إليها.', 'أو صحّح اسم قاعدة البيانات في إعدادات مشروعك.'],
    },
  },

  {
    id: 'php.table_missing',
    match: /Table '([^']+)' doesn't exist(?! in engine)|Unknown table '([^']+)'/,
    vars: (m) => ({ table: m[1] || m[2] }),
    title: { en: 'Table {table} does not exist', ar: 'الجدول {table} غير موجود' },
    summary: {
      en: 'A query used the table {table}, which is not in the database.',
      ar: 'استخدم أحد الاستعلامات الجدول {table}، وهو غير موجود في قاعدة البيانات.',
    },
    details: {
      en: 'The database exists but this table is missing. Usually the project\'s tables were never created (migrations not run, SQL not imported) or the table name has a typo or the wrong prefix.',
      ar: 'قاعدة البيانات موجودة لكن هذا الجدول غير موجود فيها. غالباً لم يتم إنشاء جداول المشروع (لم تُنفّذ الـ migrations أو لم يُستورد ملف SQL)، أو أن اسم الجدول مكتوب بشكل خاطئ أو ببادئة (prefix) غير صحيحة.',
    },
    steps: {
      en: ['Laravel: php artisan migrate', 'Other projects: import the project\'s .sql file in phpMyAdmin.', 'Check the table name and prefix in the query at {where}.'],
      ar: ['في Laravel نفّذ: php artisan migrate', 'في المشاريع الأخرى: استورد ملف .sql الخاص بالمشروع من phpMyAdmin.', 'تحقق من اسم الجدول وبادئته في الاستعلام في {where}.'],
    },
  },

  {
    id: 'php.parse',
    match: /syntax error, (unexpected .+?)(?: in [A-Za-z]:|, expecting|$)/,
    vars: (m) => ({ token: m[1] }),
    title: { en: 'PHP syntax error', ar: 'خطأ في صياغة كود PHP' },
    summary: {
      en: 'PHP could not read the file: {token} at {where}.',
      ar: 'لم يستطع PHP قراءة الملف بسبب {token} في {where}.',
    },
    details: {
      en: 'The file has invalid PHP syntax, so nothing in it runs. The real mistake is often on the line BEFORE the reported one: a missing semicolon, bracket or quote.',
      ar: 'يحتوي الملف على كود غير صالح، لذلك لا يُنفّذ أي شيء منه. الخطأ الحقيقي غالباً يكون في السطر الذي يسبق السطر المذكور: فاصلة منقوطة أو قوس أو علامة تنصيص ناقصة.',
    },
    steps: {
      en: ['Open {where} and look at that line and the one above it.', 'Check for a missing ; ) } or closing quote.', 'Your editor (VS Code) usually underlines the exact spot in red.'],
      ar: ['افتح {where} وانظر إلى السطر المذكور والسطر الذي قبله.', 'ابحث عن ; أو ) أو } أو علامة تنصيص إغلاق ناقصة.', 'غالباً يضع المحرر (VS Code) خطاً أحمر تحت موضع الخطأ بالضبط.'],
    },
  },

  {
    id: 'php.include',
    match: /(?:Failed opening required '([^']+)'|(?:include|require)(?:_once)?\(([^)]+)\): Failed to open stream: No such file or directory)/,
    vars: (m) => ({ path: m[1] || m[2] }),
    title: { en: 'Included file not found: {path}', ar: 'الملف المطلوب تضمينه غير موجود: {path}' },
    summary: {
      en: 'include/require could not find {path}.',
      ar: 'لم يجد include/require الملف {path}.',
    },
    details: {
      en: 'Relative paths in include/require are resolved from the folder of the page that was requested, not from the file that contains the include. That is why an include works on one page and fails on another.',
      ar: 'المسارات النسبية في include/require تُحسب انطلاقاً من مجلد الصفحة التي طُلبت في المتصفح، وليس من الملف الذي يحتوي على الـ include. لهذا قد يعمل التضمين في صفحة ويفشل في أخرى.',
    },
    steps: {
      en: ['Use an absolute path: require __DIR__ . \'/config.php\';', 'Check the file really exists and the name/case is correct.', 'In Composer projects, check vendor/ exists (run composer install).'],
      ar: ['استخدم مساراً مطلقاً: require __DIR__ . \'/config.php\';', 'تأكد من وجود الملف فعلاً ومن صحة اسمه وحالة أحرفه.', 'في مشاريع Composer تأكد من وجود المجلد vendor (نفّذ composer install).'],
    },
  },

  {
    id: 'php.headers_sent',
    match: /headers already sent by \(output started at (.+?):(\d+)\)/,
    vars: (m) => ({ outFile: m[1], outLine: m[2] }),
    title: { en: 'Headers already sent', ar: 'تم إرسال الترويسات (headers) مسبقاً' },
    summary: {
      en: 'Output started at {outFile}:{outLine}, so header()/cookie/session can no longer be sent.',
      ar: 'بدأ إخراج محتوى في {outFile}:{outLine}، لذلك لم يعد ممكناً إرسال header() أو الكوكيز أو بدء الجلسة.',
    },
    details: {
      en: 'HTTP headers (redirects, cookies, sessions) must be sent before any page content. Something printed output first, even a single space, an empty line before <?php, or an invisible BOM at the start of the file.',
      ar: 'يجب إرسال ترويسات HTTP (التحويل والكوكيز والجلسات) قبل أي محتوى للصفحة. لكن شيئاً ما طُبع أولاً، حتى لو كان مسافة واحدة، أو سطراً فارغاً قبل <?php، أو رمز BOM غير مرئي في بداية الملف.',
    },
    steps: {
      en: ['Open {outFile} line {outLine}: that is where the early output is.', 'Remove spaces/empty lines before <?php and the closing ?> at the end of PHP-only files.', 'Save the file as "UTF-8" (without BOM) in your editor.', 'Move echo/HTML after the header(), setcookie() or session_start() call.'],
      ar: ['افتح {outFile} عند السطر {outLine}: هناك بدأ الإخراج المبكر.', 'احذف المسافات والأسطر الفارغة قبل <?php، واحذف وسم الإغلاق ?> في نهاية الملفات التي تحتوي على PHP فقط.', 'احفظ الملف بترميز "UTF-8" بدون BOM من المحرر.', 'انقل أوامر echo أو HTML إلى ما بعد header() أو setcookie() أو session_start().'],
    },
  },

  {
    id: 'php.session_start',
    match: /session_start\(\): (Session cannot be started after headers have already been sent|Failed to read session data)/,
    vars: (m) => ({ reason: m[1] }),
    title: { en: 'Session could not start', ar: 'تعذّر بدء الجلسة (session)' },
    summary: { en: '{reason}.', ar: 'فشل session_start(): {reason}.' },
    details: {
      en: 'session_start() must run before any output, and PHP must be able to write to its session folder (AMPLE uses tmp\\sessions).',
      ar: 'يجب استدعاء session_start() قبل أي إخراج، ويجب أن يستطيع PHP الكتابة في مجلد الجلسات (يستخدم AMPLE المجلد tmp\\sessions).',
    },
    steps: {
      en: ['Call session_start() at the very top of the page, before any echo or HTML.', 'If the tmp folder was deleted while running, restart Apache.'],
      ar: ['استدعِ session_start() في أعلى الصفحة قبل أي echo أو HTML.', 'إذا حُذف المجلد tmp أثناء التشغيل، فأعد تشغيل Apache.'],
    },
  },

  {
    id: 'php.null_member',
    match: /Call to a member function (\w+)\(\) on (null|bool|false|array|string|int)/,
    vars: (m) => ({ method: m[1], type: m[2] }),
    title: { en: '{method}() called on {type}', ar: 'استدعاء {method}() على قيمة من نوع {type}' },
    summary: {
      en: 'The code expected an object but the variable is {type}.',
      ar: 'توقّع الكود كائناً (object)، لكن المتغير قيمته من نوع {type}.',
    },
    details: {
      en: 'A variable that should hold an object is {type}. Typical reasons: a database lookup found nothing and returned null/false, a connection failed, or the variable was never assigned.',
      ar: 'المتغير الذي يُفترض أن يحتوي على كائن قيمته {type}. الأسباب المعتادة: بحث في قاعدة البيانات لم يجد نتيجة فأعاد null أو false، أو فشل اتصال، أو أن المتغير لم يُسند إليه أي قيمة.',
    },
    steps: {
      en: ['At {where}, find which variable ->{method}() is called on.', 'Check where that variable gets its value and handle the "not found" case (if ($x === null) ...).', 'With PHP 8 you can use the nullsafe operator: $x?->{method}()'],
      ar: ['في {where}، حدّد المتغير الذي يُستدعى عليه ->{method}().', 'تتبّع من أين يأخذ هذا المتغير قيمته، وتعامل مع حالة "عدم وجود نتيجة" (مثلاً: if ($x === null) ...).', 'في PHP 8 يمكنك استخدام المعامل الآمن: $x?->{method}()'],
    },
  },

  {
    id: 'php.composer_platform',
    match: /Your Composer dependencies require a PHP version "([^"]+)"(?: and you are running (\S+))?/,
    vars: (m) => ({ need: m[1], have: m[2] || '' }),
    title: { en: 'Project needs PHP {need}', ar: 'المشروع يحتاج إلى PHP {need}' },
    summary: {
      en: 'This project\'s Composer packages need PHP {need}, but PHP {have} is active.',
      ar: 'حزم Composer في هذا المشروع تحتاج إلى PHP {need}، بينما النسخة المفعّلة هي {have}.',
    },
    details: {
      en: 'Composer checks that the active PHP version matches what the installed packages need. Switch to a matching PHP version (AMPLE keeps your settings when you switch), or update the packages.',
      ar: 'يتحقق Composer من أن نسخة PHP المفعّلة تناسب متطلبات الحزم المثبتة. انتقل إلى نسخة PHP مناسبة (يحافظ AMPLE على إعداداتك عند التبديل)، أو حدّث الحزم.',
    },
    steps: {
      en: ['See installed versions: ample php-list', 'Switch: ample php-use <version>  (or download one: ample php-add <version>)', 'Or update the packages: composer update'],
      ar: ['اعرض النسخ المثبتة: ample php-list', 'بدّل النسخة: ample php-use <النسخة> (أو نزّل واحدة: ample php-add <النسخة>)', 'أو حدّث الحزم: composer update'],
    },
  },

  {
    id: 'php.ssl',
    match: /SSL certificate problem|certificate verify failed|unable to get local issuer certificate/i,
    title: { en: 'HTTPS certificate check failed', ar: 'فشل التحقق من شهادة HTTPS' },
    summary: {
      en: 'PHP could not verify the certificate of a website it tried to reach.',
      ar: 'لم يستطع PHP التحقق من شهادة الموقع الذي حاول الاتصال به.',
    },
    details: {
      en: 'AMPLE ships the official certificate list (php\\cacert.pem) and sets curl.cainfo/openssl.cafile for you, so this usually means the code or a library uses its own outdated certificate file, or an antivirus/proxy intercepts HTTPS traffic.',
      ar: 'يوفّر AMPLE قائمة الشهادات الرسمية (php\\cacert.pem) ويضبط curl.cainfo و openssl.cafile تلقائياً، لذلك فالسبب غالباً أن الكود أو إحدى المكتبات يستخدم ملف شهادات قديماً خاصاً به، أو أن برنامج حماية أو proxy يعترض اتصالات HTTPS.',
    },
    steps: {
      en: ['Search your project for CURLOPT_CAINFO or "cacert" and remove the custom path.', 'Update the certificate list: ample setup', 'If your antivirus scans HTTPS, add an exception for php.exe.', 'Never fix it by disabling verification (CURLOPT_SSL_VERIFYPEER = false).'],
      ar: ['ابحث في مشروعك عن CURLOPT_CAINFO أو "cacert" واحذف المسار الخاص.', 'حدّث قائمة الشهادات: ample setup', 'إذا كان برنامج الحماية يفحص اتصالات HTTPS، فأضف استثناءً لـ php.exe.', 'لا تحلّ المشكلة بتعطيل التحقق (CURLOPT_SSL_VERIFYPEER = false) أبداً.'],
    },
  },

  {
    id: 'php.ext_load',
    match: /Unable to load dynamic library '([^']+)'/,
    vars: (m, e) => ({ lib: m[1], blocked: /Application Control|policy/i.test(e.raw + e.extra.join(' ')) ? 'yes' : '' }),
    title: { en: 'Extension {lib} failed to load', ar: 'فشل تحميل الإضافة {lib}' },
    summary: {
      en: (v) => (v.blocked ? 'Windows Smart App Control blocked the file.' : 'The extension file is missing or does not match this PHP version.'),
      ar: (v) => (v.blocked ? 'منع Smart App Control في ويندوز تشغيل الملف.' : 'ملف الإضافة غير موجود أو لا يتوافق مع نسخة PHP هذه.'),
    },
    details: {
      en: 'AMPLE tests each extension before enabling it, so this normally comes from an extension added by hand that is not part of this PHP build, was built for another version, or is blocked by Windows.',
      ar: 'يختبر AMPLE كل إضافة قبل تفعيلها، لذلك يأتي هذا الخطأ عادةً من إضافة أُضيفت يدوياً وليست جزءاً من نسخة PHP هذه، أو بُنيت لنسخة أخرى، أو يمنعها ويندوز.',
    },
    steps: {
      en: ['Remove the extension line you added, or run: ample config (AMPLE then skips it with the reason).', 'Download the build of the extension that matches this PHP version (same x64 / TS / vs17).'],
      ar: ['احذف سطر الإضافة الذي أضفته، أو نفّذ: ample config (وسيتجاوزها AMPLE مع ذكر السبب).', 'نزّل نسخة الإضافة المطابقة لنسخة PHP هذه (نفس x64 و TS و vs17).'],
    },
  },

  {
    id: 'php.undefined_var',
    match: /Undefined (variable \$\w+|array key "?[^"]*"?|index: ?\S+|offset: ?\S+|property: ?\S+)/,
    vars: (m) => ({
      what: m[1],
      whatAr: m[1].replace(/^variable/, 'المتغير').replace(/^array key/, 'مفتاح المصفوفة')
        .replace(/^property:?/, 'الخاصية').replace(/^index:?/, 'الفهرس').replace(/^offset:?/, 'الموضع'),
    }),
    title: { en: 'Undefined {what}', ar: 'قيمة غير معرّفة: {whatAr}' },
    summary: {
      en: 'The code read something that was never set.',
      ar: 'قرأ الكود قيمة لم يتم تعيينها من قبل.',
    },
    details: {
      en: 'This is a warning: the page keeps running, but the value is treated as null, which can cause wrong results later. Very common with form fields ($_POST[\'x\']) that were not sent.',
      ar: 'هذا تحذير: تستمر الصفحة في العمل، لكن القيمة تُعامل على أنها null، وقد يؤدي ذلك إلى نتائج خاطئة لاحقاً. يحدث كثيراً مع حقول النماذج ($_POST[\'x\']) التي لم تُرسل.',
    },
    steps: {
      en: ['At {where}, give the value a default: $x = $_POST[\'x\'] ?? \'\';', 'Or check first: if (isset($arr[\'key\'])) { ... }'],
      ar: ['في {where}، أعطِ القيمة قيمة افتراضية: $x = $_POST[\'x\'] ?? \'\';', 'أو تحقق منها أولاً: if (isset($arr[\'key\'])) { ... }'],
    },
  },

  {
    id: 'php.type_error',
    match: /Uncaught (?:TypeError|ArgumentCountError): (.+?)(?:, called in| in [A-Za-z]:|$)/,
    vars: (m) => ({ msg: m[1] }),
    title: { en: 'Wrong type passed to a function', ar: 'تم تمرير قيمة من نوع غير صحيح إلى دالة' },
    summary: { en: '{msg}', ar: '{msg}' },
    details: {
      en: 'PHP 8 checks argument types strictly. Code written for PHP 7 often passed null or a string where a number/array was expected; PHP 8 now stops with a TypeError.',
      ar: 'يتحقق PHP 8 من أنواع المعاملات بشكل صارم. كثيراً ما كانت الأكواد المكتوبة لـ PHP 7 تمرّر null أو نصاً حيث يُتوقع رقم أو مصفوفة، أما PHP 8 فيتوقف الآن بخطأ TypeError.',
    },
    steps: {
      en: ['Open {where} and check the value passed to the function.', 'Convert or validate it first, for example (int) $x, or $x ?? [].', 'If it\'s a library, update it to a PHP 8-compatible version.'],
      ar: ['افتح {where} وتحقق من القيمة الممرّرة إلى الدالة.', 'حوّل القيمة أو تحقق منها أولاً، مثل (int) $x أو $x ?? [].', 'إذا كان الخطأ داخل مكتبة، فحدّثها إلى نسخة متوافقة مع PHP 8.'],
    },
  },

  {
    id: 'php.uncaught',
    generic: true, // catch-all: checked after every specific rule
    match: /Uncaught ([\w\\]+): (.*?)(?: in [A-Za-z]:[\\/]|$)/,
    vars: (m) => ({ type: m[1], msg: m[2] || '(no message)' }),
    title: { en: 'Unhandled {type}', ar: 'استثناء غير معالَج: {type}' },
    summary: { en: '{msg}', ar: '{msg}' },
    details: {
      en: 'An exception was thrown and nothing caught it, so the page stopped. The message above comes from the code or library that threw it, and the stack trace (raw log below) shows the path that led there.',
      ar: 'حدث استثناء (exception) ولم يلتقطه أي جزء من الكود، فتوقفت الصفحة. الرسالة أعلاه صادرة عن الكود أو المكتبة التي أطلقت الاستثناء، ويُظهر الـ stack trace (في السجل الأصلي أدناه) المسار الذي أدى إليه.',
    },
    steps: {
      en: ['Read the message: it usually says exactly what went wrong.', 'Open {where}, then follow the stack trace from the top to find the first file of YOUR project.', 'Wrap risky calls in try { ... } catch (\\Throwable $e) { ... } where it makes sense.'],
      ar: ['اقرأ الرسالة: غالباً تذكر بالضبط ما الذي حدث.', 'افتح {where}، ثم تتبّع الـ stack trace من الأعلى حتى تصل إلى أول ملف من ملفات مشروعك أنت.', 'ضع الاستدعاءات المعرّضة للفشل داخل try { ... } catch (\\Throwable $e) { ... } حيث يكون ذلك مناسباً.'],
    },
  },

  {
    id: 'php.deprecated',
    generic: true, // catch-all: checked after every specific rule
    kind: /Deprecated/i,
    match: /(.+?)(?: in [A-Za-z]:[\\/]|$)/,
    vars: (m) => ({ msg: m[1] }),
    title: { en: 'Deprecated feature', ar: 'استخدام ميزة مهملة (deprecated)' },
    summary: { en: '{msg}', ar: '{msg}' },
    details: {
      en: 'The code still works, but it uses something PHP plans to remove. It will break in a future PHP version. Fixing it now makes upgrading PHP painless.',
      ar: 'ما زال الكود يعمل، لكنه يستخدم ميزة يخطط PHP لإزالتها، وسيتوقف عن العمل في نسخة مستقبلية. إصلاحه الآن يجعل الترقية إلى نسخ PHP الجديدة سهلة.',
    },
    steps: {
      en: ['Open {where} and replace the deprecated usage (the message usually names the replacement).', 'If it is inside vendor/, update the package: composer update'],
      ar: ['افتح {where} واستبدل الاستخدام المهمل (غالباً تذكر الرسالة البديل).', 'إذا كان داخل المجلد vendor، فحدّث الحزمة: composer update'],
    },
  },
];
