'use strict';
// Log Doctor rules for MariaDB (logs\mariadb\error.log).

module.exports = [
  {
    id: 'mariadb.aria',
    startup: true, // stops the service from starting; resolved once it starts
    match: /Aria recovery failed|aria_log_control|Plugin 'Aria' (?:registration|init function)|Could not open mysql\.plugin table|Aria engine is not enabled/i,
    title: { en: 'MariaDB system files damaged (Aria)', ar: 'تلف ملفات نظام MariaDB (Aria)' },
    summary: {
      en: 'MariaDB cannot start because its Aria log files were damaged, almost always by an unclean shutdown.',
      ar: 'لا يستطيع MariaDB العمل لأن ملفات سجل Aria تالفة، والسبب في الغالب إيقاف غير سليم.',
    },
    details: {
      en: 'This is the famous XAMPP "MySQL shutdown unexpectedly" problem. When Windows shuts down or MariaDB is killed while running, the Aria log files (aria_log_control, aria_log.*) are left half-written. They only hold temporary recovery data: your databases are in other files and are usually fine. AMPLE prevents this by always stopping MariaDB cleanly.',
      ar: 'هذه هي مشكلة XAMPP الشهيرة "MySQL shutdown unexpectedly". عندما يُطفأ ويندوز أو يُغلق MariaDB بالقوة أثناء عمله، تبقى ملفات سجل Aria (aria_log_control و aria_log.*) مكتوبة بشكل ناقص. هذه الملفات تحتوي فقط على بيانات استرجاع مؤقتة، أما قواعد بياناتك فموجودة في ملفات أخرى وعادةً تكون سليمة. يمنع AMPLE حدوث ذلك بإيقاف MariaDB بشكل سليم دائماً.',
    },
    causes: {
      en: ['Turning off or restarting the PC while MariaDB was running', 'Closing MariaDB with Task Manager', 'A power cut or crash'],
      ar: ['إطفاء الحاسوب أو إعادة تشغيله أثناء عمل MariaDB', 'إغلاق MariaDB من مدير المهام (Task Manager)', 'انقطاع الكهرباء أو تعطّل النظام'],
    },
    steps: {
      en: ['Make sure MariaDB is stopped.', 'Back up the folder mariadb\\data (copy it somewhere safe).', 'Delete mariadb\\data\\aria_log_control and the files aria_log.0000000*.', 'Start MariaDB again: the files are recreated automatically.'],
      ar: ['تأكد من أن MariaDB متوقف.', 'خذ نسخة احتياطية من المجلد mariadb\\data (انسخه إلى مكان آمن).', 'احذف الملف mariadb\\data\\aria_log_control والملفات aria_log.0000000*.', 'شغّل MariaDB من جديد: سيعيد إنشاء هذه الملفات تلقائياً.'],
    },
    action: () => ({ type: 'mariadb.repairAria', params: {}, label: { en: 'Back up and repair automatically', ar: 'خذ نسخة احتياطية وأصلح تلقائياً' } }),
  },

  {
    id: 'mariadb.innodb_corrupt',
    startup: true, // stops the service from starting; resolved once it starts
    match: /InnoDB: (?:Database page corruption|Plugin initialization aborted|Assertion failure|Your database may be corrupt|Unable to lock .+ error: 33)|Plugin 'InnoDB' (?:init function returned error|registration as a STORAGE ENGINE failed)/i,
    title: { en: 'InnoDB could not start', ar: 'تعذّر تشغيل محرك InnoDB' },
    summary: {
      en: 'MariaDB\'s main storage engine (InnoDB) found a problem in its files.',
      ar: 'وجد محرك التخزين الرئيسي في MariaDB (InnoDB) مشكلة في ملفاته.',
    },
    details: {
      en: 'InnoDB stores most of your tables. It stops instead of risking more damage. "Unable to lock ... error: 33" means another MariaDB/MySQL is already using the same data folder. Otherwise the files were damaged, usually by an unclean shutdown or a full disk.',
      ar: 'يخزّن InnoDB معظم جداولك، وهو يتوقف بدلاً من المخاطرة بمزيد من التلف. إذا ظهرت الرسالة "Unable to lock ... error: 33" فهذا يعني أن نسخة أخرى من MariaDB أو MySQL تستخدم مجلد البيانات نفسه. وفي غير ذلك تكون الملفات قد تلفت، غالباً بسبب إيقاف غير سليم أو امتلاء القرص.',
    },
    steps: {
      en: ['Check no other MariaDB/MySQL is running (Task Manager → mysqld.exe / mariadbd.exe).', 'Back up the whole mariadb\\data folder before trying anything else.', 'Check the disk is not full.', 'Recovery mode: add innodb_force_recovery = 1 under [mysqld] in control\\templates\\my.ini.tpl, start MariaDB, export your databases, then remove the line. Raise it to 2–4 only if 1 does not start.'],
      ar: ['تأكد من عدم وجود نسخة أخرى من MariaDB أو MySQL تعمل (مدير المهام ← mysqld.exe أو mariadbd.exe).', 'خذ نسخة احتياطية من المجلد mariadb\\data بالكامل قبل تجربة أي شيء آخر.', 'تأكد من أن القرص غير ممتلئ.', 'وضع الاسترجاع: أضف innodb_force_recovery = 1 تحت [mysqld] في control\\templates\\my.ini.tpl، ثم شغّل MariaDB وصدّر قواعد بياناتك، ثم احذف السطر. لا ترفع القيمة إلى 2–4 إلا إذا لم يعمل مع 1.'],
    },
  },

  {
    id: 'mariadb.bind',
    startup: true, // stops the service from starting; resolved once it starts
    match: /Can't start server: Bind on TCP\/IP port|Do you already have another (?:mysqld|mariadbd|server) running on port: ?(\d+)/,
    vars: (m) => ({ port: m[1] || '3306' }),
    title: { en: 'MariaDB could not use port {port}', ar: 'لم يستطع MariaDB استخدام المنفذ {port}' },
    summary: { en: 'Another program is already using port {port}.', ar: 'هناك برنامج آخر يستخدم المنفذ {port} بالفعل.' },
    details: {
      en: 'Usually another MySQL/MariaDB: the Windows service "MySQL80" from MySQL Installer, or XAMPP\'s MySQL. AMPLE names the program in logs\\ample\\ample.log.',
      ar: 'غالباً تكون نسخة أخرى من MySQL أو MariaDB: مثل خدمة ويندوز "MySQL80" التي يثبّتها MySQL Installer، أو MySQL الخاص بـ XAMPP. يذكر AMPLE اسم البرنامج في logs\\ample\\ample.log.',
    },
    steps: {
      en: ['Stop the other database server (services.msc → MySQL80 → Stop, or close XAMPP).', 'Or let AMPLE use another port (button below).'],
      ar: ['أوقف خادم قاعدة البيانات الآخر (services.msc ← MySQL80 ← Stop، أو أغلق XAMPP).', 'أو اجعل AMPLE يستخدم منفذاً آخر (الزر أدناه).'],
    },
    action: () => ({ type: 'ports.change', params: { service: 'mysql' }, label: { en: 'Use another port', ar: 'استخدم منفذاً آخر' } }),
  },

  {
    id: 'mariadb.crashed_table',
    match: /Table '([^']+)' is marked as crashed/,
    // ".\mysql\plugin" or "./shop/orders" -> "mysql.plugin" / "shop.orders"
    vars: (m) => ({ table: m[1].replace(/^\.[\\/]/, '').replace(/[\\/]/g, '.') }),
    title: { en: 'Table {table} is damaged', ar: 'الجدول {table} تالف' },
    summary: { en: 'MariaDB marked the table {table} as crashed.', ar: 'وضع MariaDB علامة "تالف" على الجدول {table}.' },
    details: {
      en: 'Tables stored with the Aria or MyISAM engines can be damaged by an unclean shutdown. They can usually be repaired without losing data.',
      ar: 'يمكن أن تتلف الجداول المخزّنة بمحرك Aria أو MyISAM بسبب الإيقاف غير السليم، وغالباً يمكن إصلاحها دون فقدان البيانات.',
    },
    steps: {
      en: ['phpMyAdmin → select the table → Operations → "Repair table".', 'Or run the SQL: REPAIR TABLE {table};', 'Consider converting it to InnoDB, which recovers by itself: ALTER TABLE {table} ENGINE=InnoDB;'],
      ar: ['phpMyAdmin ← اختر الجدول ← Operations ← "Repair table".', 'أو نفّذ الاستعلام: REPAIR TABLE {table};', 'يُنصح بتحويله إلى InnoDB الذي يُصلح نفسه تلقائياً: ALTER TABLE {table} ENGINE=InnoDB;'],
    },
  },

  {
    id: 'mariadb.too_many',
    match: /Too many connections/,
    title: { en: 'Too many database connections', ar: 'عدد اتصالات قاعدة البيانات كبير جداً' },
    summary: { en: 'MariaDB reached its connection limit and refused new ones.', ar: 'وصل MariaDB إلى الحد الأقصى للاتصالات ورفض اتصالات جديدة.' },
    details: {
      en: 'Locally this almost always means code that opens connections and never closes them, for example a new PDO inside a loop, or persistent connections piling up.',
      ar: 'على الجهاز المحلي يعني هذا في الغالب أن الكود يفتح اتصالات ولا يغلقها، مثل إنشاء PDO جديد داخل حلقة، أو تراكم الاتصالات الدائمة (persistent).',
    },
    steps: {
      en: ['Create the database connection once and reuse it.', 'Restart MariaDB to free the connections.'],
      ar: ['أنشئ اتصال قاعدة البيانات مرة واحدة وأعد استخدامه.', 'أعد تشغيل MariaDB لتحرير الاتصالات.'],
    },
    action: () => ({ type: 'service.restart', params: { name: 'mariadb' }, label: { en: 'Restart MariaDB', ar: 'أعد تشغيل MariaDB' } }),
  },

  {
    id: 'mariadb.packet',
    match: /Got a packet bigger than 'max_allowed_packet'|max_allowed_packet/,
    title: { en: 'Query bigger than max_allowed_packet', ar: 'الاستعلام أكبر من max_allowed_packet' },
    summary: { en: 'A single query or row was larger than MariaDB accepts.', ar: 'كان أحد الاستعلامات أو الصفوف أكبر مما يقبله MariaDB.' },
    details: {
      en: 'AMPLE sets max_allowed_packet to 512M, so this usually happens when importing a dump with huge rows (images or files stored in the database).',
      ar: 'يضبط AMPLE القيمة max_allowed_packet على 512M، لذلك يحدث هذا عادةً عند استيراد ملف يحتوي على صفوف ضخمة (صور أو ملفات مخزّنة داخل قاعدة البيانات).',
    },
    steps: {
      en: ['Raise max_allowed_packet in control\\templates\\my.ini.tpl (for example 1G) and restart MariaDB.', 'Avoid storing big files inside the database; store the file path instead.'],
      ar: ['ارفع max_allowed_packet في control\\templates\\my.ini.tpl (مثلاً 1G) ثم أعد تشغيل MariaDB.', 'تجنّب تخزين الملفات الكبيرة داخل قاعدة البيانات، وخزّن مسار الملف بدلاً منها.'],
    },
  },

  {
    id: 'mariadb.upgrade_needed',
    match: /Incorrect definition of table mysql\.|Column count of mysql\.\w+ is wrong|(?:run|Please use) mariadb-upgrade|mysql_upgrade/i,
    title: { en: 'System tables need an upgrade', ar: 'جداول النظام بحاجة إلى ترقية' },
    summary: {
      en: 'The data folder was created by an older MariaDB/MySQL version.',
      ar: 'تم إنشاء مجلد البيانات بواسطة نسخة أقدم من MariaDB أو MySQL.',
    },
    details: {
      en: 'After upgrading MariaDB or copying a data folder from XAMPP, the internal system tables must be upgraded once. Your own databases are not changed.',
      ar: 'بعد ترقية MariaDB أو نسخ مجلد بيانات من XAMPP، يجب ترقية جداول النظام الداخلية مرة واحدة. لا يغيّر ذلك قواعد بياناتك الخاصة.',
    },
    steps: {
      en: ['With MariaDB running, upgrade the system tables (button below).'],
      ar: ['أثناء عمل MariaDB، قم بترقية جداول النظام (الزر أدناه).'],
    },
    action: () => ({ type: 'mariadb.upgrade', params: {}, label: { en: 'Upgrade system tables', ar: 'رقِّ جداول النظام' } }),
  },

  {
    id: 'mariadb.unknown_var',
    startup: true, // stops the service from starting; resolved once it starts
    match: /unknown (?:variable|option) '([^']+)'/,
    vars: (m) => ({ option: m[1] }),
    title: { en: 'Unknown setting {option}', ar: 'إعداد غير معروف: {option}' },
    summary: { en: 'This MariaDB version does not know the setting {option}.', ar: 'نسخة MariaDB هذه لا تعرف الإعداد {option}.' },
    details: {
      en: 'MariaDB refuses to start with unknown settings. The setting may have been removed in this version or belongs to MySQL, not MariaDB.',
      ar: 'يرفض MariaDB العمل عند وجود إعدادات غير معروفة. ربما أُزيل هذا الإعداد في هذه النسخة، أو أنه خاص بـ MySQL وليس بـ MariaDB.',
    },
    steps: {
      en: ['Remove "{option}" from control\\templates\\my.ini.tpl and start MariaDB again.'],
      ar: ['احذف "{option}" من control\\templates\\my.ini.tpl ثم شغّل MariaDB من جديد.'],
    },
  },

  {
    id: 'mariadb.skip_name_resolve',
    level: 'notice',
    match: /'(?:user|proxies_priv)' entry '([^']+)' ignored in --skip-name-resolve mode/,
    vars: (m) => ({ account: m[1] }),
    title: { en: 'Unused account {account}', ar: 'حساب غير مستخدم: {account}' },
    summary: {
      en: 'An account tied to a computer name is ignored because AMPLE connects by IP address.',
      ar: 'تم تجاهل حساب مرتبط باسم حاسوب، لأن AMPLE يتصل عن طريق عنوان IP.',
    },
    details: {
      en: 'AMPLE runs MariaDB with skip-name-resolve (faster connections), so accounts written with a computer name instead of localhost / 127.0.0.1 can never log in. AMPLE removes them after the first start; they can come back if you import user accounts from another server.',
      ar: 'يشغّل AMPLE خادم MariaDB مع الخيار skip-name-resolve (لاتصالات أسرع)، لذلك لا يمكن للحسابات المكتوبة باسم حاسوب بدلاً من localhost أو 127.0.0.1 تسجيل الدخول أبداً. يحذفها AMPLE بعد أول تشغيل، وقد تعود إذا استوردت حسابات مستخدمين من خادم آخر.',
    },
    steps: {
      en: ['Harmless. To remove it: phpMyAdmin → User accounts → delete {account}.'],
      ar: ['لا ضرر منه. لحذفه: phpMyAdmin ← User accounts ← احذف {account}.'],
    },
  },

  {
    id: 'mariadb.deprecated_option',
    level: 'notice',
    match: /--([\w-]+) is deprecated and will be removed in a future release/,
    vars: (m) => ({ option: m[1].replace(/-/g, '_') }),
    title: { en: 'Deprecated setting {option}', ar: 'إعداد مهمل: {option}' },
    summary: {
      en: 'my.ini uses {option}, which a future MariaDB version will remove.',
      ar: 'يستخدم my.ini الإعداد {option}، وستزيله نسخة قادمة من MariaDB.',
    },
    details: {
      en: 'It still works today, but once MariaDB removes it, MariaDB will refuse to start with it in the config.',
      ar: 'ما زال يعمل حالياً، لكن عندما تزيله MariaDB سيرفض الخادم العمل إذا بقي في الإعدادات.',
    },
    steps: {
      en: ['Remove {option} from control\\templates\\my.ini.tpl and restart MariaDB.'],
      ar: ['احذف {option} من control\\templates\\my.ini.tpl ثم أعد تشغيل MariaDB.'],
    },
  },

  {
    id: 'mariadb.aborted',
    level: 'notice',
    match: /Aborted connection \d+ to db: '([^']*)' user: '([^']*)'.*\((Got an error reading communication packets|Got timeout reading communication packets|This connection closed normally without authentication)\)/,
    vars: (m) => ({ db: m[1], user: m[2] }),
    title: { en: 'Connection closed without saying goodbye', ar: 'أُغلق اتصال دون إنهائه بشكل صحيح' },
    summary: {
      en: 'A client ({user}) disconnected without closing the connection properly.',
      ar: 'انقطع أحد البرامج ({user}) دون أن يغلق الاتصال بشكل صحيح.',
    },
    details: {
      en: 'Usually harmless: a PHP script ended or was stopped while connected. Many of these in a row can point to scripts timing out.',
      ar: 'غالباً لا يدعو ذلك للقلق: انتهى سكربت PHP أو أُوقف وهو متصل. أما تكرارها بكثرة فقد يدل على سكربتات تتجاوز الوقت المسموح.',
    },
    steps: {
      en: ['Nothing to do unless it happens a lot; then check for PHP timeouts.'],
      ar: ['لا حاجة لأي إجراء إلا إذا تكرر كثيراً، وعندها تحقق من تجاوز السكربتات للوقت المسموح.'],
    },
  },
];
