'use strict';
// Log Doctor rules for SQL errors. They show up in the PHP log (as
// mysqli_sql_exception / PDOException) and sometimes in the MariaDB log.

module.exports = [
  {
    id: 'sql.syntax',
    match: /error in your SQL syntax;.*?near '([\s\S]{0,80}?)' at line (\d+)/,
    vars: (m) => ({ near: m[1].replace(/\s+/g, ' ').trim(), sqlLine: m[2] }),
    title: { en: 'SQL syntax error', ar: 'خطأ في صياغة استعلام SQL' },
    summary: { en: 'MariaDB could not understand the query near: {near}', ar: 'لم يفهم MariaDB الاستعلام عند الجزء: {near}' },
    details: {
      en: 'The query text is not valid SQL. MariaDB shows where it stopped understanding: the mistake is right before or at "{near}" (line {sqlLine} of the query).',
      ar: 'نص الاستعلام ليس SQL صحيحاً. يُظهر MariaDB الموضع الذي توقف فيه عن الفهم: الخطأ يكون عند "{near}" أو قبله مباشرة (السطر {sqlLine} من الاستعلام).',
    },
    causes: {
      en: ['A missing comma or quote', 'A column or table name that is a reserved word (order, group, key, desc...) without `backticks`', 'Building the query by joining strings, so a value with a quote breaks it', 'Syntax from another database (MySQL 8 / PostgreSQL)'],
      ar: ['فاصلة أو علامة تنصيص ناقصة', 'اسم عمود أو جدول من الكلمات المحجوزة (order أو group أو key أو desc...) دون وضعه بين `علامتي اقتباس مائلتين`', 'بناء الاستعلام بدمج النصوص، فتكسر قيمةٌ تحتوي على علامة تنصيص الاستعلامَ', 'صياغة خاصة بقاعدة بيانات أخرى (MySQL 8 أو PostgreSQL)'],
    },
    steps: {
      en: ['Print the full query at {where} and check the part before "{near}".', 'Wrap reserved-word names in backticks: `order`', 'Use prepared statements ($pdo->prepare + execute) instead of putting values in the SQL text; it also prevents SQL injection.', 'Test the query in phpMyAdmin → SQL to see the error immediately.'],
      ar: ['اطبع الاستعلام كاملاً في {where} وافحص الجزء الذي يسبق "{near}".', 'ضع الأسماء المحجوزة بين علامتي اقتباس مائلتين: `order`', 'استخدم الاستعلامات المُجهّزة ($pdo->prepare ثم execute) بدلاً من وضع القيم داخل نص الاستعلام، فهي تحمي أيضاً من حقن SQL.', 'جرّب الاستعلام في phpMyAdmin ← SQL لترى الخطأ مباشرة.'],
    },
  },

  {
    id: 'sql.unknown_column',
    match: /Unknown column '([^']+)' in '([^']+)'/,
    vars: (m) => ({ col: m[1], clause: m[2] }),
    title: { en: 'Column {col} does not exist', ar: 'العمود {col} غير موجود' },
    summary: { en: 'The query uses the column {col} (in the {clause}), but the table has no such column.', ar: 'يستخدم الاستعلام العمود {col} (في {clause})، لكن الجدول لا يحتوي على عمود بهذا الاسم.' },
    details: {
      en: 'Either the column name has a typo, the column was never created (a migration was not run), or it belongs to another table in a JOIN without the table prefix.',
      ar: 'إما أن اسم العمود مكتوب بشكل خاطئ، أو أن العمود لم يُنشأ أصلاً (لم تُنفّذ الـ migration)، أو أنه يتبع جدولاً آخر في JOIN دون كتابة اسم الجدول قبله.',
    },
    steps: {
      en: ['Check the table structure in phpMyAdmin → Structure.', 'Laravel: run php artisan migrate', 'In JOINs write table.column, e.g. users.created_at'],
      ar: ['افحص بنية الجدول في phpMyAdmin ← Structure.', 'في Laravel نفّذ: php artisan migrate', 'في استعلامات JOIN اكتب الجدول.العمود، مثل users.created_at'],
    },
  },

  {
    id: 'sql.table_exists',
    match: /Table '([^']+)' already exists/,
    vars: (m) => ({ table: m[1] }),
    title: { en: 'Table {table} already exists', ar: 'الجدول {table} موجود مسبقاً' },
    summary: { en: 'CREATE TABLE ran for a table that is already there.', ar: 'تم تنفيذ CREATE TABLE لجدول موجود بالفعل.' },
    details: {
      en: 'Usually an install/migration script ran twice, or an import file is loaded into a database that already has the tables.',
      ar: 'غالباً نُفّذ سكربت التثبيت أو الـ migration مرتين، أو تم استيراد ملف إلى قاعدة بيانات تحتوي على الجداول مسبقاً.',
    },
    steps: {
      en: ['Use CREATE TABLE IF NOT EXISTS in your own scripts.', 'Laravel: check php artisan migrate:status; the migrations table may be out of sync.', 'When importing, import into an empty database (or tick "Add DROP TABLE" when exporting).'],
      ar: ['استخدم CREATE TABLE IF NOT EXISTS في السكربتات الخاصة بك.', 'في Laravel افحص php artisan migrate:status، فقد يكون جدول migrations غير متطابق.', 'عند الاستيراد، استورد إلى قاعدة بيانات فارغة (أو فعّل خيار "Add DROP TABLE" عند التصدير).'],
    },
  },

  {
    id: 'sql.duplicate',
    match: /Duplicate entry '([^']*)' for key '([^']+)'/,
    vars: (m) => ({ value: m[1], key: m[2] }),
    title: { en: 'Duplicate value "{value}"', ar: 'قيمة مكررة "{value}"' },
    summary: { en: 'The value "{value}" already exists, and the key {key} must be unique.', ar: 'القيمة "{value}" موجودة مسبقاً، والمفتاح {key} يجب أن يكون فريداً.' },
    details: {
      en: 'The column has a UNIQUE or PRIMARY key, so the same value cannot be stored twice. Common cases: registering an email that already exists, or inserting a fixed id.',
      ar: 'العمود عليه مفتاح فريد (UNIQUE) أو أساسي (PRIMARY)، لذلك لا يمكن تخزين القيمة نفسها مرتين. الحالات الشائعة: تسجيل بريد إلكتروني موجود مسبقاً، أو إدخال رقم id ثابت.',
    },
    steps: {
      en: ['Check first whether the value exists (SELECT) and show a friendly message.', 'Or use INSERT ... ON DUPLICATE KEY UPDATE to update instead.', 'If it is the PRIMARY key, let AUTO_INCREMENT choose the id (don\'t send it).'],
      ar: ['تحقق أولاً من وجود القيمة (SELECT) واعرض رسالة مناسبة للمستخدم.', 'أو استخدم INSERT ... ON DUPLICATE KEY UPDATE للتحديث بدلاً من الإدخال.', 'إذا كان المفتاح الأساسي PRIMARY، فاترك AUTO_INCREMENT يختار الرقم (لا ترسل id).'],
    },
  },

  {
    id: 'sql.fk_child',
    match: /Cannot add or update a child row: a foreign key constraint fails \(`?([^`.]+)`?\.`([^`]+)`, CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)`/,
    vars: (m) => ({ table: m[2], fk: m[3], col: m[4], parent: m[5] }),
    title: { en: 'Linked record missing in {parent}', ar: 'السجل المرتبط غير موجود في الجدول {parent}' },
    summary: { en: '{table}.{col} points to a row in {parent} that does not exist.', ar: 'العمود {table}.{col} يشير إلى صف غير موجود في الجدول {parent}.' },
    details: {
      en: 'A foreign key guarantees that {table}.{col} always matches an existing row in {parent}. The value you inserted has no matching row there.',
      ar: 'يضمن المفتاح الأجنبي (foreign key) أن قيمة {table}.{col} تطابق دائماً صفاً موجوداً في {parent}. القيمة التي أدخلتها لا يوجد صف مطابق لها هناك.',
    },
    steps: {
      en: ['Insert the {parent} row first, then the {table} row.', 'Check the value of {col} you are inserting (wrong id, or 0 instead of NULL).', 'If the link is optional, allow NULL in {col} and insert NULL.'],
      ar: ['أدخل الصف في {parent} أولاً، ثم الصف في {table}.', 'تحقق من قيمة {col} التي تدخلها (رقم خاطئ، أو 0 بدلاً من NULL).', 'إذا كان الارتباط اختيارياً، فاسمح بـ NULL في {col} وأدخل NULL.'],
    },
  },

  {
    id: 'sql.fk_parent',
    match: /Cannot delete or update a parent row: a foreign key constraint fails \(`?([^`.]+)`?\.`([^`]+)`/,
    vars: (m) => ({ child: m[2] }),
    title: { en: 'Row is still used by {child}', ar: 'الصف ما زال مستخدماً في الجدول {child}' },
    summary: { en: 'You tried to delete/change a row that rows in {child} still point to.', ar: 'حاولت حذف أو تعديل صف ما زالت صفوف في الجدول {child} تشير إليه.' },
    details: {
      en: 'Deleting it would leave rows in {child} pointing to nothing, so MariaDB refuses.',
      ar: 'حذفه سيترك صفوفاً في {child} تشير إلى شيء غير موجود، لذلك يرفض MariaDB العملية.',
    },
    steps: {
      en: ['Delete (or re-link) the rows in {child} first.', 'Or define the foreign key with ON DELETE CASCADE / ON DELETE SET NULL if that is the behavior you want.'],
      ar: ['احذف الصفوف في {child} أولاً (أو اربطها بصف آخر).', 'أو عرّف المفتاح الأجنبي مع ON DELETE CASCADE أو ON DELETE SET NULL إذا كان هذا هو السلوك الذي تريده.'],
    },
  },

  {
    id: 'sql.data_too_long',
    match: /Data too long for column '([^']+)'/,
    vars: (m) => ({ col: m[1] }),
    title: { en: 'Value too long for column {col}', ar: 'القيمة أطول من المسموح في العمود {col}' },
    summary: { en: 'The text is longer than the column {col} can hold.', ar: 'النص أطول مما يتسع له العمود {col}.' },
    details: {
      en: 'Each VARCHAR column has a maximum length. With strict mode (AMPLE\'s default, like production servers) MariaDB refuses instead of silently cutting the text.',
      ar: 'لكل عمود VARCHAR طول أقصى. مع الوضع الصارم (strict mode، وهو الافتراضي في AMPLE كما في الخوادم الحقيقية) يرفض MariaDB القيمة بدلاً من قصّ النص دون إعلامك.',
    },
    steps: {
      en: ['Make the column bigger: ALTER TABLE t MODIFY {col} VARCHAR(500); or TEXT', 'Or validate the length in PHP before saving.'],
      ar: ['كبّر العمود: ALTER TABLE t MODIFY {col} VARCHAR(500); أو استخدم النوع TEXT', 'أو تحقق من طول القيمة في PHP قبل الحفظ.'],
    },
  },

  {
    id: 'sql.incorrect_string',
    match: /Incorrect string value: '([^']*)' for column [`']?(?:[^`'.]+[`']?\.)*[`']?([^`' ]+)/,
    vars: (m) => ({ bytes: m[1], col: m[2] }),
    title: { en: 'Characters not supported by column {col}', ar: 'العمود {col} لا يدعم بعض الأحرف' },
    summary: { en: 'The text has characters (often emoji) that the column\'s character set cannot store.', ar: 'يحتوي النص على أحرف (غالباً رموز تعبيرية emoji) لا يستطيع ترميز العمود تخزينها.' },
    details: {
      en: 'Old tables use "utf8" (utf8mb3), which cannot store 4-byte characters such as emoji. AMPLE creates new databases as utf8mb4, but tables imported from elsewhere may still be utf8 or latin1.',
      ar: 'الجداول القديمة تستخدم الترميز "utf8" (أي utf8mb3)، وهو لا يستطيع تخزين الأحرف ذات الأربعة بايتات مثل الرموز التعبيرية. ينشئ AMPLE قواعد البيانات الجديدة بترميز utf8mb4، لكن الجداول المستوردة من مكان آخر قد تبقى utf8 أو latin1.',
    },
    steps: {
      en: ['Convert the table: ALTER TABLE t CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;', 'Connect with utf8mb4 too: new PDO("mysql:host=127.0.0.1;dbname=x;charset=utf8mb4", ...)'],
      ar: ['حوّل الجدول: ALTER TABLE t CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;', 'واتصل أيضاً بترميز utf8mb4: new PDO("mysql:host=127.0.0.1;dbname=x;charset=utf8mb4", ...)'],
    },
  },

  {
    id: 'sql.no_default',
    match: /Field '([^']+)' doesn't have a default value/,
    vars: (m) => ({ col: m[1] }),
    title: { en: 'No value for required column {col}', ar: 'لم تُرسل قيمة للعمود الإلزامي {col}' },
    summary: { en: 'The INSERT did not give {col} a value, and the column has no default.', ar: 'لم يحدد أمر INSERT قيمة للعمود {col}، وليس للعمود قيمة افتراضية.' },
    details: {
      en: 'Older XAMPP setups often ran without strict mode, so MariaDB silently filled in empty values. AMPLE uses strict mode like real servers, so this mistake shows up now instead of on your live site.',
      ar: 'كثير من إعدادات XAMPP القديمة كانت تعمل دون الوضع الصارم، فيملأ MariaDB قيمة فارغة دون إعلامك. يستخدم AMPLE الوضع الصارم كما في الخوادم الحقيقية، لذلك يظهر هذا الخطأ الآن بدلاً من أن يظهر في موقعك المنشور.',
    },
    steps: {
      en: ['Send a value for {col} in the INSERT.', 'Or give the column a default: ALTER TABLE t MODIFY {col} ... DEFAULT \'\';', 'Or allow NULL if it is optional.'],
      ar: ['أرسل قيمة للعمود {col} في أمر INSERT.', 'أو أعطِ العمود قيمة افتراضية: ALTER TABLE t MODIFY {col} ... DEFAULT \'\';', 'أو اسمح بقيمة NULL إذا كان العمود اختيارياً.'],
    },
  },

  {
    id: 'sql.zero_date',
    match: /Incorrect (?:date|datetime|timestamp) value: '0000-00-00|Invalid default value for '([^']+)'/,
    vars: (m) => ({ col: m[1] || '' }),
    title: { en: 'Invalid date 0000-00-00', ar: 'تاريخ غير صالح 0000-00-00' },
    summary: { en: 'A zero date ("0000-00-00") was used, which strict mode does not accept.', ar: 'تم استخدام تاريخ صفري ("0000-00-00")، والوضع الصارم لا يقبله.' },
    details: {
      en: 'Old projects use 0000-00-00 to mean "no date". Modern MariaDB/MySQL reject it. Use NULL for "no date".',
      ar: 'تستخدم المشاريع القديمة 0000-00-00 للتعبير عن "لا يوجد تاريخ"، لكن MariaDB و MySQL الحديثة ترفضه. استخدم NULL للتعبير عن عدم وجود تاريخ.',
    },
    steps: {
      en: ['Make the column nullable: ALTER TABLE t MODIFY col DATETIME NULL DEFAULT NULL;', 'Replace old values: UPDATE t SET col = NULL WHERE col = \'0000-00-00\';'],
      ar: ['اجعل العمود يقبل NULL: ALTER TABLE t MODIFY col DATETIME NULL DEFAULT NULL;', 'استبدل القيم القديمة: UPDATE t SET col = NULL WHERE col = \'0000-00-00\';'],
    },
  },

  {
    id: 'sql.incorrect_value',
    match: /Incorrect (integer|decimal|double) value: '([^']*)' for column [`']?(?:[^`'.]+[`']?\.)*[`']?([^`' ]+)|Out of range value for column '([^']+)'/,
    vars: (m) => ({ type: m[1] || 'number', value: m[2] ?? '', col: m[3] || m[4] }),
    title: { en: 'Wrong value for column {col}', ar: 'قيمة غير مناسبة للعمود {col}' },
    summary: { en: 'The value "{value}" does not fit the {type} column {col}.', ar: 'القيمة "{value}" لا تناسب العمود {col} من النوع {type}.' },
    details: {
      en: 'Typical: an empty string \'\' sent to a number column (use NULL), or a number bigger than the column type (INT max is 2147483647; use BIGINT).',
      ar: 'الحالات المعتادة: إرسال نص فارغ \'\' إلى عمود رقمي (استخدم NULL بدلاً منه)، أو رقم أكبر من حدود نوع العمود (الحد الأقصى لـ INT هو 2147483647، فاستخدم BIGINT).',
    },
    steps: {
      en: ['Convert empty form values to NULL before saving.', 'If numbers are too big, change the column to BIGINT or DECIMAL.'],
      ar: ['حوّل قيم النموذج الفارغة إلى NULL قبل الحفظ.', 'إذا كانت الأرقام كبيرة جداً، فغيّر نوع العمود إلى BIGINT أو DECIMAL.'],
    },
  },

  {
    id: 'sql.collation_mix',
    match: /Illegal mix of collations \(([^,]+),\w+\) and \(([^,]+),\w+\)/,
    vars: (m) => ({ a: m[1], b: m[2] }),
    title: { en: 'Mixed text encodings in one query', ar: 'خلط بين ترميزات نصية مختلفة في استعلام واحد' },
    summary: { en: 'The query compares text in {a} with text in {b}.', ar: 'يقارن الاستعلام نصاً بترميز {a} مع نص بترميز {b}.' },
    details: {
      en: 'Two columns (or a column and a value) use different collations, so MariaDB doesn\'t know how to compare them. It happens after importing tables from different sources.',
      ar: 'يستخدم عمودان (أو عمود وقيمة) ترتيبين نصيين (collation) مختلفين، فلا يعرف MariaDB كيف يقارن بينهما. يحدث ذلك بعد استيراد جداول من مصادر مختلفة.',
    },
    steps: {
      en: ['Convert all tables of the database to the same collation: ALTER TABLE t CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;', 'Connect with charset=utf8mb4.'],
      ar: ['حوّل كل جداول قاعدة البيانات إلى الترتيب نفسه: ALTER TABLE t CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;', 'واتصل باستخدام charset=utf8mb4.'],
    },
  },

  {
    id: 'sql.key_too_long',
    match: /Specified key was too long; max key length is (\d+) bytes/,
    vars: (m) => ({ max: m[1] }),
    title: { en: 'Index too long ({max} bytes max)', ar: 'الفهرس أطول من المسموح (الحد {max} بايت)' },
    summary: { en: 'An index on a long text column is bigger than MariaDB allows.', ar: 'فهرس على عمود نصي طويل أكبر مما يسمح به MariaDB.' },
    details: {
      en: 'With utf8mb4 each character can take 4 bytes, so VARCHAR(255) needs 1020 bytes. Very common in older Laravel projects.',
      ar: 'مع الترميز utf8mb4 قد يحتاج كل حرف إلى 4 بايتات، فيحتاج VARCHAR(255) إلى 1020 بايت. هذا شائع جداً في مشاريع Laravel القديمة.',
    },
    steps: {
      en: ['Laravel: in AppServiceProvider::boot() add Schema::defaultStringLength(191);', 'Or shorten the indexed column (VARCHAR(191)).'],
      ar: ['في Laravel أضف داخل AppServiceProvider::boot() السطر: Schema::defaultStringLength(191);', 'أو قصّر العمود المفهرس (VARCHAR(191)).'],
    },
  },

  {
    id: 'sql.lock',
    match: /(Deadlock found when trying to get lock|Lock wait timeout exceeded)/,
    vars: (m) => ({ kind: m[1] }),
    title: { en: 'Database lock conflict', ar: 'تعارض في أقفال قاعدة البيانات' },
    summary: { en: '{kind}.', ar: 'تعارض بين عمليتين على الصفوف نفسها: {kind}.' },
    details: {
      en: 'Two operations wanted the same rows at the same time. A deadlock is resolved by cancelling one of them; a lock wait timeout means one waited too long (often a transaction left open, e.g. in phpMyAdmin or a stuck script).',
      ar: 'أرادت عمليتان الصفوف نفسها في الوقت نفسه. يُحلّ الـ deadlock بإلغاء إحداهما، أما انتهاء مهلة الانتظار فيعني أن إحداهما انتظرت طويلاً (غالباً بسبب transaction بقيت مفتوحة، مثلاً في phpMyAdmin أو في سكربت عالق).',
    },
    steps: {
      en: ['Retry the operation (deadlocks are normal under load).', 'Keep transactions short and always COMMIT or ROLLBACK.', 'Look for a stuck query: phpMyAdmin → Status → Processes.'],
      ar: ['أعد تنفيذ العملية (الـ deadlock أمر طبيعي تحت الضغط).', 'اجعل الـ transactions قصيرة، ونفّذ دائماً COMMIT أو ROLLBACK.', 'ابحث عن استعلام عالق: phpMyAdmin ← Status ← Processes.'],
    },
  },

  {
    id: 'sql.gone_away',
    match: /MySQL server has gone away|Lost connection to (?:MySQL|MariaDB) server during query|Error while sending QUERY packet/,
    title: { en: 'Database connection lost', ar: 'انقطع الاتصال بقاعدة البيانات' },
    summary: { en: 'The connection to MariaDB closed in the middle of the work.', ar: 'أُغلق الاتصال بـ MariaDB في أثناء العمل.' },
    details: {
      en: 'Causes: MariaDB was stopped or restarted, a single query/row was bigger than max_allowed_packet, or the connection sat idle longer than wait_timeout (long-running scripts).',
      ar: 'الأسباب: أُوقف MariaDB أو أُعيد تشغيله، أو كان استعلام أو صف واحد أكبر من max_allowed_packet، أو بقي الاتصال خاملاً أطول من wait_timeout (في السكربتات الطويلة).',
    },
    steps: {
      en: ['Check MariaDB is running: ample status', 'For big imports, check logs\\mariadb\\error.log for max_allowed_packet.', 'In long scripts, reconnect before using an old connection.'],
      ar: ['تأكد من أن MariaDB يعمل: ample status', 'في عمليات الاستيراد الكبيرة، افحص logs\\mariadb\\error.log بحثاً عن max_allowed_packet.', 'في السكربتات الطويلة، أعد الاتصال قبل استخدام اتصال قديم.'],
    },
  },

  {
    id: 'sql.group_by',
    match: /isn't in GROUP BY|incompatible with sql_mode=only_full_group_by/,
    title: { en: 'GROUP BY rule broken (ONLY_FULL_GROUP_BY)', ar: 'مخالفة قاعدة GROUP BY (ONLY_FULL_GROUP_BY)' },
    summary: { en: 'The SELECT lists a column that is neither grouped nor aggregated.', ar: 'يعرض أمر SELECT عموداً ليس ضمن GROUP BY ولا داخل دالة تجميع.' },
    details: {
      en: 'With ONLY_FULL_GROUP_BY (default on MySQL 5.7+), every selected column must be in GROUP BY or inside MAX(), COUNT(), etc. Otherwise the result would be random.',
      ar: 'مع الخيار ONLY_FULL_GROUP_BY (الافتراضي في MySQL 5.7 وما بعده) يجب أن يكون كل عمود معروض ضمن GROUP BY أو داخل دالة مثل MAX() أو COUNT()، وإلا ستكون النتيجة عشوائية.',
    },
    steps: {
      en: ['Add the column to GROUP BY, or wrap it: MAX(col) / ANY_VALUE(col).'],
      ar: ['أضف العمود إلى GROUP BY، أو ضعه داخل دالة: MAX(col) أو ANY_VALUE(col).'],
    },
  },

  {
    id: 'sql.column_count',
    match: /Column count doesn't match value count at row (\d+)/,
    title: { en: 'INSERT has the wrong number of values', ar: 'عدد القيم في أمر INSERT غير صحيح' },
    summary: { en: 'The number of values does not match the number of columns.', ar: 'عدد القيم لا يساوي عدد الأعمدة.' },
    details: {
      en: 'INSERT INTO t VALUES (...) without a column list must give a value for every column, in order. Adding a column to the table breaks such queries.',
      ar: 'أمر INSERT INTO t VALUES (...) دون قائمة أعمدة يجب أن يحدد قيمة لكل عمود وبالترتيب. إضافة عمود جديد إلى الجدول تكسر هذا النوع من الاستعلامات.',
    },
    steps: {
      en: ['Always name the columns: INSERT INTO t (name, email) VALUES (?, ?)'],
      ar: ['اذكر أسماء الأعمدة دائماً: INSERT INTO t (name, email) VALUES (?, ?)'],
    },
  },

  {
    id: 'sql.ambiguous',
    match: /Column '([^']+)' in (field list|where clause|on clause|order clause|group statement) is ambiguous/,
    vars: (m) => ({ col: m[1] }),
    title: { en: 'Column {col} is ambiguous', ar: 'اسم العمود {col} غامض' },
    summary: { en: 'Several joined tables have a column named {col}.', ar: 'أكثر من جدول في الاستعلام يحتوي على عمود باسم {col}.' },
    details: { en: 'In a JOIN, MariaDB needs to know which table\'s {col} you mean.', ar: 'في استعلامات JOIN يحتاج MariaDB إلى معرفة العمود {col} من أي جدول تقصد.' },
    steps: { en: ['Prefix it with the table name: users.{col}'], ar: ['اكتب اسم الجدول قبله: users.{col}'] },
  },

  {
    id: 'sql.host_not_allowed',
    match: /Host '([^']+)' is not allowed to connect/,
    vars: (m) => ({ host: m[1] }),
    title: { en: 'Connections from {host} are not allowed', ar: 'الاتصال من {host} غير مسموح' },
    summary: { en: 'MariaDB has no account that may log in from {host}.', ar: 'لا يوجد في MariaDB حساب مسموح له بالدخول من {host}.' },
    details: {
      en: 'AMPLE accounts only allow localhost / 127.0.0.1 / ::1. Use 127.0.0.1 as the host in your project.',
      ar: 'حسابات AMPLE تسمح فقط بـ localhost و 127.0.0.1 و ::1. استخدم 127.0.0.1 كعنوان قاعدة البيانات في مشروعك.',
    },
    steps: { en: ['Set the database host to 127.0.0.1 in your project.'], ar: ['اجعل عنوان قاعدة البيانات في مشروعك 127.0.0.1.'] },
  },

  {
    id: 'sql.row_size',
    match: /Row size too large/,
    title: { en: 'Table row too large', ar: 'حجم الصف في الجدول كبير جداً' },
    summary: { en: 'The table has too many or too wide columns for one row.', ar: 'يحتوي الجدول على أعمدة كثيرة أو عريضة جداً بالنسبة لصف واحد.' },
    details: { en: 'A row is limited to about 8 KB plus long columns stored separately. Many VARCHAR(255) utf8mb4 columns hit the limit.', ar: 'حجم الصف محدود بنحو 8 كيلوبايت، مع تخزين الأعمدة الطويلة بشكل منفصل. كثرة أعمدة VARCHAR(255) بترميز utf8mb4 تصل إلى هذا الحد.' },
    steps: { en: ['Change wide VARCHAR columns to TEXT, or use ROW_FORMAT=DYNAMIC.', 'Consider splitting the table.'], ar: ['حوّل أعمدة VARCHAR العريضة إلى TEXT، أو استخدم ROW_FORMAT=DYNAMIC.', 'فكّر في تقسيم الجدول إلى جدولين.'] },
  },
];
