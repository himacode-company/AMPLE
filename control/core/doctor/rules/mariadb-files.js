'use strict';
// Log Doctor rules for MariaDB data-file problems: copied/missing files,
// Windows file errors, disk, system tables, upgrades. Loaded before mariadb.js.

// Windows / C runtime error numbers MariaDB reports, in plain words.
const OS_ERRORS = {
  2: { en: 'the file does not exist', ar: 'الملف غير موجود' },
  3: { en: 'the folder (path) does not exist', ar: 'المجلد (المسار) غير موجود' },
  5: { en: 'access was denied (permissions, antivirus or another program)', ar: 'تم رفض الوصول (الصلاحيات، أو برنامج الحماية، أو برنامج آخر)' },
  13: { en: 'permission denied', ar: 'تم رفض الإذن' },
  17: { en: 'the file already exists', ar: 'الملف موجود مسبقاً' },
  28: { en: 'the disk is full', ar: 'القرص ممتلئ' },
  32: { en: 'the file is in use by another program (antivirus, backup, another MariaDB)', ar: 'الملف مستخدم من برنامج آخر (برنامج الحماية، أو النسخ الاحتياطي، أو MariaDB آخر)' },
  33: { en: 'the file is locked by another program', ar: 'الملف مقفول من برنامج آخر' },
  112: { en: 'the disk is full', ar: 'القرص ممتلئ' },
  203: { en: 'the file could not be found', ar: 'تعذّر العثور على الملف' },
  1450: { en: 'Windows ran out of resources', ar: 'نفدت موارد ويندوز' },
};

module.exports = [
  {
    id: 'mariadb.lsn_future',
    match: /log sequence number \d+ is in the future|doublewrite copy of page .* with future log sequence number|you may have copied the InnoDB tablespace but not the InnoDB log files/,
    title: { en: 'Data files do not match each other (copied data folder)', ar: 'ملفات البيانات غير متطابقة (مجلد بيانات منسوخ)' },
    summary: {
      en: 'Table files are newer than MariaDB\'s log files. This happens when data files are copied from a backup without the matching ib_logfile/ibdata1.',
      ar: 'ملفات الجداول أحدث من ملفات السجل في MariaDB. يحدث ذلك عند نسخ ملفات البيانات من نسخة احتياطية دون ملفات ib_logfile و ibdata1 المطابقة لها.',
    },
    details: {
      en: 'A common XAMPP "fix" for "MySQL shutdown unexpectedly" is to copy the data folder from data_backup. That makes MariaDB start, but the table files and the InnoDB log files then come from different moments in time. MariaDB keeps complaining, and tables changed after the backup can be damaged or lose recent changes. The safe way out is to export the data while it still opens, and import it into a fresh database.',
      ar: 'من "الحلول" الشائعة في XAMPP لمشكلة "MySQL shutdown unexpectedly" نسخُ مجلد البيانات من data_backup. هذا يجعل MariaDB يعمل، لكن ملفات الجداول وملفات سجل InnoDB تصبح من لحظات زمنية مختلفة، فيستمر MariaDB في التحذير، وقد تتلف الجداول التي تغيّرت بعد النسخة الاحتياطية أو تفقد آخر تعديلاتها. الطريق الآمن هو تصدير البيانات ما دامت تفتح، ثم استيرادها إلى قاعدة بيانات جديدة.',
    },
    causes: {
      en: ['Copying mysql\\data or mysql\\backup files over the data folder', 'Restoring only some files (*.ibd) from a backup', 'Moving a data folder between two installations'],
      ar: ['نسخ ملفات mysql\\data أو mysql\\backup فوق مجلد البيانات', 'استعادة بعض الملفات فقط (*.ibd) من نسخة احتياطية', 'نقل مجلد بيانات بين تثبيتين مختلفين'],
    },
    steps: {
      en: ['Back up the whole data folder first.', 'Export every database you need (phpMyAdmin → Export, or mariadb-dump).', 'Start from a fresh data folder and import the exports.', 'From now on use real backups (exports), not copies of the data folder. AMPLE makes daily exports for you.'],
      ar: ['خذ نسخة احتياطية من مجلد البيانات كاملاً أولاً.', 'صدّر كل قاعدة بيانات تحتاجها (phpMyAdmin ← Export، أو mariadb-dump).', 'ابدأ بمجلد بيانات جديد واستورد الملفات المصدّرة.', 'من الآن فصاعداً استخدم نسخاً احتياطية حقيقية (ملفات تصدير)، وليس نسخاً لمجلد البيانات. ينشئ AMPLE ملفات تصدير يومية لك.'],
    },
  },

  {
    id: 'mariadb.missing_tablespace',
    match: /Could not find a valid tablespace file for `+([^`]+)`\.`([^`]+)`+|Ignoring tablespace for `([^`]+)`\.`([^`]+)` because it could not be opened|Cannot open datafile for read-only: '\.[\\/]([^\\/]+)[\\/]([^'.]+)\.ibd'|Table '(?:\.[\\/])?([^'./\\]+)[./\\]([^']+)' doesn't exist in engine|Tablespace for table '`?([^`.']+)`?\.`?([^`']+)`?' exists/,
    vars: (m) => ({ db: m[1] || m[3] || m[5] || m[7] || m[9], table: m[2] || m[4] || m[6] || m[8] || m[10] }),
    title: { en: 'Database {db}: table files are missing', ar: 'قاعدة البيانات {db}: ملفات الجداول مفقودة' },
    summary: {
      en: 'MariaDB still lists tables of {db} (for example {table}), but their .ibd files are gone or unreadable.',
      ar: 'ما زال MariaDB يسجّل جداول قاعدة البيانات {db} (مثل {table})، لكن ملفات .ibd الخاصة بها مفقودة أو لا يمكن قراءتها.',
    },
    details: {
      en: 'InnoDB keeps a central list of all tables (in ibdata1) and one .ibd file per table in the database folder. Here the list and the files disagree: the folder mariadb\\data\\{db} (or some files in it) was deleted, moved, or not copied along with ibdata1. MariaDB skips these tables, and every query on them fails with "doesn\'t exist in engine".',
      ar: 'يحتفظ InnoDB بقائمة مركزية لكل الجداول (في الملف ibdata1)، وبملف .ibd لكل جدول داخل مجلد قاعدة البيانات. هنا لا تتطابق القائمة مع الملفات: المجلد mariadb\\data\\{db} (أو بعض ملفاته) حُذف أو نُقل أو لم يُنسخ مع ibdata1. يتجاوز MariaDB هذه الجداول، ويفشل كل استعلام عليها بالرسالة "doesn\'t exist in engine".',
    },
    steps: {
      en: ['If you have a backup of the folder {db}, put it back (with MariaDB stopped).', 'If the data is not needed: in phpMyAdmin run DROP DATABASE `{db}`; (or DROP TABLE for single tables) to clean up the list, then import {db} again from an .sql export.', 'Never copy single database folders between installations; use Export/Import.'],
      ar: ['إذا كانت لديك نسخة احتياطية من المجلد {db} فأعدها إلى مكانها (و MariaDB متوقف).', 'إذا لم تكن بحاجة إلى البيانات: نفّذ في phpMyAdmin الأمر DROP DATABASE `{db}`; (أو DROP TABLE لجداول منفردة) لتنظيف القائمة، ثم استورد {db} من جديد من ملف .sql.', 'لا تنسخ مجلدات قواعد البيانات منفردة بين تثبيتات مختلفة، واستخدم التصدير والاستيراد (Export/Import).'],
    },
  },

  {
    id: 'mariadb.os_error',
    match: /Operating system error number (\d+)|OS error: (\d+)|Errcode: (\d+)/,
    vars: (m, e) => {
      const n = Number(m[1] || m[2] || m[3]);
      const k = OS_ERRORS[n] || { en: `Windows error ${n}`, ar: `خطأ ويندوز رقم ${n}` };
      const file = ((e.message + ' ' + e.extra.join(' ')).match(/'([^']+\.(?:ibd|ibdata\d*|frm|MAI|MAD|MYD|MYI|log|\w+))'/) || [])[1] || '';
      return { code: n, meaningEn: k.en, meaningAr: k.ar, file };
    },
    title: { en: 'File error {code}: {meaningEn}', ar: 'خطأ في ملف ({code}): {meaningAr}' },
    summary: { en: 'MariaDB could not use a file because {meaningEn}. {file}', ar: 'لم يستطع MariaDB استخدام ملف لأن {meaningAr}. {file}' },
    details: {
      en: 'MariaDB asked Windows to open or write one of its files and Windows refused with error {code} ({meaningEn}). The other MariaDB problems at the same time usually name the table involved.',
      ar: 'طلب MariaDB من ويندوز فتح أحد ملفاته أو الكتابة فيه، فرفض ويندوز بالخطأ رقم {code} ({meaningAr}). غالباً تذكر مشكلات MariaDB الأخرى في التوقيت نفسه اسم الجدول المعني.',
    },
    steps: {
      en: ['Error 2/3/203: the file or folder is missing; see "table files are missing" in this list.', 'Error 5/13/32/33: stop other MariaDB/MySQL copies, and exclude the mariadb\\data folder from antivirus and OneDrive/backup tools.', 'Error 28/112: free up disk space.'],
      ar: ['الخطأ 2 أو 3 أو 203: الملف أو المجلد مفقود، راجع مشكلة "ملفات الجداول مفقودة" في هذه القائمة.', 'الخطأ 5 أو 13 أو 32 أو 33: أوقف أي نسخة أخرى من MariaDB أو MySQL، واستثنِ المجلد mariadb\\data من فحص برنامج الحماية ومن OneDrive وأدوات النسخ الاحتياطي.', 'الخطأ 28 أو 112: وفّر مساحة على القرص.'],
    },
  },

  {
    id: 'mariadb.disk_full',
    match: /Disk is full|No space left on device|The table '([^']+)' is full/,
    vars: (m) => ({ table: m[1] || '' }),
    title: { en: 'Disk or table is full', ar: 'القرص أو الجدول ممتلئ' },
    summary: { en: 'MariaDB could not write because there is no free space.', ar: 'لم يستطع MariaDB الكتابة لعدم وجود مساحة فارغة.' },
    details: { en: 'Either the drive is full, or a temporary table grew past tmp_table_size during a big query.', ar: 'إما أن القرص ممتلئ، أو أن جدولاً مؤقتاً تجاوز الحجم tmp_table_size أثناء استعلام كبير.' },
    steps: { en: ['Free up disk space (check logs\\mariadb\\general.log, which can grow large if enabled).', 'For a big query, add an index or LIMIT so it needs less temporary space.'], ar: ['وفّر مساحة على القرص (افحص logs\\mariadb\\general.log، فقد يكبر كثيراً إذا كان مفعّلاً).', 'في حالة الاستعلام الكبير، أضف فهرساً أو LIMIT ليحتاج إلى مساحة مؤقتة أقل.'] },
  },

  {
    id: 'mariadb.privilege_tables',
    startup: true,
    match: /Can't open and lock privilege tables|Table 'mysql\.(?:user|db|global_priv)' doesn't exist/,
    title: { en: 'MariaDB system database is missing', ar: 'قاعدة بيانات النظام في MariaDB مفقودة' },
    summary: { en: 'The "mysql" system database (accounts and permissions) is missing or damaged.', ar: 'قاعدة بيانات النظام "mysql" (الحسابات والصلاحيات) مفقودة أو تالفة.' },
    details: {
      en: 'mariadb\\data\\mysql holds the user accounts. It is missing when a data folder was copied without it, or was emptied.',
      ar: 'يحتوي المجلد mariadb\\data\\mysql على حسابات المستخدمين، ويكون مفقوداً إذا نُسخ مجلد بيانات دونه أو تم إفراغه.',
    },
    steps: {
      en: ['Stop MariaDB and rename mariadb\\data to data-old.', 'Start MariaDB: AMPLE creates a fresh data folder automatically.', 'Import your databases from .sql exports (the folders in data-old can\'t simply be copied back).'],
      ar: ['أوقف MariaDB وغيّر اسم المجلد mariadb\\data إلى data-old.', 'شغّل MariaDB: سينشئ AMPLE مجلد بيانات جديداً تلقائياً.', 'استورد قواعد بياناتك من ملفات .sql (لا يمكن ببساطة نسخ المجلدات من data-old إلى المجلد الجديد).'],
    },
  },

  {
    id: 'mariadb.upgrade_after_crash',
    startup: true,
    match: /Upgrade after a crash is not supported|InnoDB: Upgrade after a crash/,
    title: { en: 'Data was not closed cleanly by the old MariaDB', ar: 'لم يُغلق MariaDB القديم البيانات بشكل سليم' },
    summary: { en: 'This data folder comes from an older MariaDB/MySQL that crashed or was killed, so the new version refuses to open it.', ar: 'هذا المجلد من نسخة أقدم من MariaDB أو MySQL تعطّلت أو أُغلقت بالقوة، لذلك ترفض النسخة الجديدة فتحه.' },
    details: {
      en: 'Upgrading is only safe from a cleanly stopped server. Typical when moving from XAMPP: XAMPP\'s MySQL was not stopped properly before the data folder was copied.',
      ar: 'الترقية آمنة فقط إذا كان الخادم القديم متوقفاً بشكل سليم. يحدث هذا كثيراً عند الانتقال من XAMPP: لم يُوقف MySQL الخاص بـ XAMPP بشكل صحيح قبل نسخ مجلد البيانات.',
    },
    steps: {
      en: ['Start the OLD server once on this data (e.g. in XAMPP), then stop it with its Stop button so it closes the files cleanly.', 'Copy the data again and start AMPLE.', 'Safer: export the databases from XAMPP (phpMyAdmin → Export) and import them into AMPLE.'],
      ar: ['شغّل الخادم القديم مرة واحدة على هذه البيانات (مثلاً في XAMPP)، ثم أوقفه بزر Stop ليغلق الملفات بشكل سليم.', 'انسخ البيانات من جديد وشغّل AMPLE.', 'الأكثر أماناً: صدّر قواعد البيانات من XAMPP (phpMyAdmin ← Export) ثم استوردها في AMPLE.'],
    },
  },

  {
    id: 'mariadb.redo_format',
    startup: true,
    match: /redo log (?:was created with|file .* is of different size)|ib_logfile0 is of different size|Unsupported redo log format/i,
    title: { en: 'InnoDB log files are from another version', ar: 'ملفات سجل InnoDB من نسخة أخرى' },
    summary: { en: 'The ib_logfile files were created by a different MariaDB/MySQL version.', ar: 'ملفات ib_logfile أُنشئت بواسطة نسخة مختلفة من MariaDB أو MySQL.' },
    details: { en: 'MySQL and MariaDB data folders are not interchangeable, and very old MariaDB log files need a clean shutdown before upgrading.', ar: 'مجلدات بيانات MySQL و MariaDB غير قابلة للتبادل، وملفات السجل في نسخ MariaDB القديمة جداً تحتاج إلى إيقاف سليم قبل الترقية.' },
    steps: { en: ['Use Export/Import to move the databases instead of copying the data folder.'], ar: ['استخدم التصدير والاستيراد (Export/Import) لنقل قواعد البيانات بدلاً من نسخ مجلد البيانات.'] },
  },

  {
    id: 'mariadb.ibdata_locked',
    startup: true,
    match: /The innodb_system data file '([^']+)' must be writable|Unable to lock (?:\.[\\/])?ibdata1|Check that you do not already have another mariadbd process using the same InnoDB data/,
    title: { en: 'Another database server uses the same data', ar: 'خادم قاعدة بيانات آخر يستخدم البيانات نفسها' },
    summary: { en: 'MariaDB could not lock its main data file.', ar: 'لم يستطع MariaDB قفل ملف البيانات الرئيسي.' },
    details: { en: 'Another MariaDB/MySQL is already running on this data folder, or the file is read-only / locked by antivirus or backup software.', ar: 'هناك نسخة أخرى من MariaDB أو MySQL تعمل على مجلد البيانات نفسه، أو أن الملف للقراءة فقط، أو مقفول من برنامج الحماية أو النسخ الاحتياطي.' },
    steps: { en: ['Task Manager → Details: end other mariadbd.exe / mysqld.exe.', 'Exclude mariadb\\data from antivirus and OneDrive.'], ar: ['مدير المهام ← Details: أنهِ أي mariadbd.exe أو mysqld.exe آخر.', 'استثنِ المجلد mariadb\\data من برنامج الحماية و OneDrive.'] },
  },

  {
    id: 'mariadb.unknown_engine',
    match: /Unknown\/unsupported storage engine: (\w+)/,
    vars: (m) => ({ engine: m[1] }),
    title: { en: 'Storage engine {engine} is not available', ar: 'محرك التخزين {engine} غير متاح' },
    summary: { en: 'Tables using {engine} cannot be opened.', ar: 'لا يمكن فتح الجداول التي تستخدم {engine}.' },
    details: { en: 'For InnoDB this is a consequence: InnoDB failed to start earlier. Look at the InnoDB problems around the same time; they show the real cause.', ar: 'بالنسبة لـ InnoDB فهذه نتيجة وليست سبباً: فشل InnoDB في البدء قبل ذلك. راجع مشكلات InnoDB في التوقيت نفسه، فهي تُظهر السبب الحقيقي.' },
    steps: { en: ['Fix the InnoDB problem listed near this one.'], ar: ['أصلح مشكلة InnoDB المذكورة بالقرب من هذه المشكلة.'] },
  },

  {
    id: 'mariadb.index_corrupt',
    match: /Index for table '([^']+)' is corrupt|Incorrect key file for table '([^']+)'|Got error (\d+) "([^"]*)" from storage engine (\w+)/,
    vars: (m) => ({ table: m[1] || m[2] || '', detail: m[4] ? `${m[3]} "${m[4]}" (${m[5]})` : '' }),
    title: { en: 'Damaged table index {table}', ar: 'فهرس تالف في الجدول {table}' },
    summary: { en: 'MariaDB found damage in a table or its index. {detail}', ar: 'وجد MariaDB تلفاً في جدول أو في فهرسه. {detail}' },
    details: { en: 'Aria and MyISAM tables can be damaged by an unclean shutdown; a temporary table can also fail when the disk is full.', ar: 'قد تتلف جداول Aria و MyISAM بسبب الإيقاف غير السليم، وقد يفشل جدول مؤقت أيضاً عند امتلاء القرص.' },
    steps: { en: ['Run REPAIR TABLE {table}; (phpMyAdmin → Operations → Repair table).', 'Check free disk space.', 'Consider converting it to InnoDB: ALTER TABLE {table} ENGINE=InnoDB;'], ar: ['نفّذ REPAIR TABLE {table}; (phpMyAdmin ← Operations ← Repair table).', 'تحقق من المساحة المتاحة على القرص.', 'يُنصح بتحويله إلى InnoDB: ALTER TABLE {table} ENGINE=InnoDB;'] },
  },

  {
    id: 'mariadb.recovering',
    level: 'notice',
    match: /Recovering table: '([^']+)'|Checking table: '([^']+)'|Auto-recovered (?:table )?'?([^']*)|Starting crash recovery|Crash recovery finished|Recovering after a crash using/,
    title: { en: 'MariaDB repaired itself after an unclean stop', ar: 'أصلح MariaDB نفسه بعد إيقاف غير سليم' },
    summary: { en: 'MariaDB was not stopped cleanly last time and ran its automatic recovery.', ar: 'لم يُوقف MariaDB بشكل سليم في المرة السابقة، فشغّل الاسترجاع التلقائي.' },
    details: {
      en: 'This usually succeeds on its own. It is a sign the PC was turned off or MariaDB was killed while running; AMPLE stops MariaDB cleanly to avoid it.',
      ar: 'غالباً ينجح ذلك تلقائياً، لكنه علامة على أن الحاسوب أُطفئ أو أُغلق MariaDB بالقوة أثناء عمله. يوقف AMPLE خادم MariaDB بشكل سليم لتجنّب ذلك.',
    },
    steps: { en: ['Nothing to do if MariaDB is running now.', 'Stop MariaDB from AMPLE before shutting down the PC.'], ar: ['لا حاجة لأي إجراء إذا كان MariaDB يعمل الآن.', 'أوقف MariaDB من AMPLE قبل إطفاء الحاسوب.'] },
  },

  {
    id: 'mariadb.open_files',
    level: 'notice',
    match: /Could not increase number of max_open_files|Changed limits: max_open_files/,
    title: { en: 'Open-files limit adjusted', ar: 'تم تعديل حد الملفات المفتوحة' },
    summary: { en: 'Windows gave MariaDB fewer open files than requested.', ar: 'منح ويندوز خادم MariaDB عدداً من الملفات المفتوحة أقل من المطلوب.' },
    details: { en: 'Harmless for a development machine.', ar: 'لا ضرر منه على جهاز تطوير.' },
    steps: { en: ['Nothing to do.'], ar: ['لا حاجة لأي إجراء.'] },
  },
];
