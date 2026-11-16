'use strict';
// Log Doctor rules for common PHP code errors, PHP 8.x upgrade notices,
// frameworks (Composer, Laravel) and mail. Loaded before php.js.

module.exports = [
  {
    id: 'php.vendor_missing',
    // Only "file not found" for vendor/autoload.php, not errors raised inside it.
    match: /(?:Failed opening required|Failed to open stream)[^\n]{0,200}?vendor[\\/]autoload\.php|vendor[\\/]autoload\.php'?\)?: Failed to open stream/,
    title: { en: 'Composer packages not installed', ar: 'حزم Composer غير مثبتة' },
    summary: { en: 'The project needs vendor/autoload.php, which does not exist yet.', ar: 'يحتاج المشروع إلى الملف vendor/autoload.php، وهو غير موجود بعد.' },
    details: {
      en: 'The vendor folder holds the project\'s Composer packages. It is never stored in Git, so after cloning or copying a project you must install the packages once.',
      ar: 'يحتوي المجلد vendor على حزم Composer الخاصة بالمشروع، ولا يُحفظ في Git أبداً، لذلك بعد استنساخ المشروع أو نسخه يجب تثبيت الحزم مرة واحدة.',
    },
    steps: {
      en: ['Open a terminal in the project folder and run: composer install', 'Laravel: then copy .env.example to .env and run php artisan key:generate'],
      ar: ['افتح الطرفية داخل مجلد المشروع ونفّذ: composer install', 'في Laravel: انسخ بعدها .env.example إلى .env ونفّذ php artisan key:generate'],
    },
  },

  {
    id: 'php.laravel_helper',
    match: /Call to undefined function (env|config|app|view|route|url|asset|base_path|storage_path|public_path|database_path|resource_path|app_path|collect|now|today|request|response|redirect|session|auth|trans|__|dd|dump|abort|bcrypt|old|csrf_token|csrf_field|logger|cache|optional|tap|value|e)\(\)/,
    vars: (m) => ({ fn: m[1] }),
    title: { en: 'Laravel function {fn}() used outside Laravel', ar: 'استخدام دالة Laravel {fn}() خارج Laravel' },
    summary: {
      en: '{fn}() exists only after Laravel has started, but this file was run directly.',
      ar: 'الدالة {fn}() لا تكون موجودة إلا بعد تشغيل Laravel، لكن هذا الملف شُغّل مباشرة.',
    },
    details: {
      en: 'Laravel loads its helper functions (env, config, view, route...) through public/index.php and vendor/autoload.php. Opening a file such as config/app.php or a file in the project root in the browser runs it without Laravel, so the helpers are missing.',
      ar: 'يحمّل Laravel دواله المساعدة (env و config و view و route...) عبر public/index.php و vendor/autoload.php. فتح ملف مثل config/app.php أو ملف في جذر المشروع من المتصفح يشغّله دون Laravel، فلا تكون هذه الدوال موجودة.',
    },
    steps: {
      en: ['Open the project through its public folder: http://localhost/<project>/public/', 'Better: give the project its own site (myproject.test) pointing to public/.', 'If vendor/ is missing, run composer install first.'],
      ar: ['افتح المشروع من خلال مجلد public: http://localhost/<المشروع>/public/', 'والأفضل: أنشئ للمشروع موقعاً خاصاً (myproject.test) يشير إلى المجلد public.', 'إذا كان المجلد vendor غير موجود، فنفّذ composer install أولاً.'],
    },
  },

  {
    id: 'php.laravel_key',
    match: /No application encryption key has been specified/,
    title: { en: 'Laravel app key missing', ar: 'مفتاح تطبيق Laravel غير موجود' },
    summary: { en: 'APP_KEY in .env is empty.', ar: 'القيمة APP_KEY في ملف .env فارغة.' },
    details: { en: 'Laravel needs a secret key to encrypt sessions and cookies. A fresh copy of a project doesn\'t have one.', ar: 'يحتاج Laravel إلى مفتاح سري لتشفير الجلسات والكوكيز، والنسخة الجديدة من المشروع لا تحتوي عليه.' },
    steps: { en: ['In the project folder run: php artisan key:generate', 'Then reload the page.'], ar: ['نفّذ داخل مجلد المشروع: php artisan key:generate', 'ثم أعد تحميل الصفحة.'] },
  },

  {
    id: 'php.laravel_storage',
    match: /The stream or file "([^"]+laravel\.log)" could not be opened|Please provide a valid cache path|storage[\\/]framework[\\/](?:views|cache|sessions)/,
    title: { en: 'Laravel cannot write to storage', ar: 'لا يستطيع Laravel الكتابة في مجلد storage' },
    summary: { en: 'A folder inside storage/ is missing or not writable.', ar: 'أحد المجلدات داخل storage مفقود أو لا يمكن الكتابة فيه.' },
    details: {
      en: 'Laravel writes logs, cache and compiled views into storage/ and bootstrap/cache/. If these folders were not copied (they are often ignored by Git) Laravel fails.',
      ar: 'يكتب Laravel السجلات والكاش والواجهات المترجمة في المجلدين storage و bootstrap/cache. إذا لم تُنسخ هذه المجلدات (وكثيراً ما يتجاهلها Git) يفشل Laravel.',
    },
    steps: {
      en: ['Create the folders: storage/logs, storage/framework/cache, storage/framework/sessions, storage/framework/views, bootstrap/cache', 'Then run: php artisan optimize:clear'],
      ar: ['أنشئ المجلدات: storage/logs و storage/framework/cache و storage/framework/sessions و storage/framework/views و bootstrap/cache', 'ثم نفّذ: php artisan optimize:clear'],
    },
  },

  {
    id: 'php.mail',
    resolvedBy: 'Mailpit', // fixed once Mailpit starts
    match: /mail\(\): Failed to connect to mailserver at "([^"]*)" port (\d+)|SMTP server response: (.+)/,
    vars: (m) => ({ host: m[1] || 'localhost', port: m[2] || '25' }),
    title: { en: 'Sending email failed', ar: 'فشل إرسال البريد الإلكتروني' },
    summary: { en: 'PHP\'s mail() found no mail server at {host}:{port}.', ar: 'لم تجد الدالة mail() خادم بريد على {host}:{port}.' },
    details: {
      en: 'AMPLE includes Mailpit: it receives every email your code sends and shows it at http://localhost/mailpit/, without sending anything to real people. PHP\'s mail() already points to it, so this usually means Mailpit is not running, or your app uses its own SMTP settings.',
      ar: 'يتضمن AMPLE برنامج Mailpit: يستقبل كل رسالة يرسلها الكود ويعرضها على http://localhost/mailpit/ دون إرسال أي شيء لأشخاص حقيقيين. الدالة mail() في PHP موجّهة إليه مسبقاً، لذلك يعني هذا غالباً أن Mailpit لا يعمل، أو أن تطبيقك يستخدم إعدادات SMTP خاصة به.',
    },
    steps: {
      en: ['Start Mailpit (button below), then send again.', 'If your app has its own mail settings, point them to Mailpit. Laravel .env: MAIL_MAILER=smtp, MAIL_HOST=127.0.0.1, MAIL_PORT=1025 (any username/password works).', 'Read the emails at http://localhost/mailpit/'],
      ar: ['شغّل Mailpit (الزر أدناه) ثم أعد الإرسال.', 'إذا كان لتطبيقك إعدادات بريد خاصة، فوجّهها إلى Mailpit. في ملف .env الخاص بـ Laravel: MAIL_MAILER=smtp و MAIL_HOST=127.0.0.1 و MAIL_PORT=1025 (أي اسم مستخدم وكلمة مرور تعمل).', 'اقرأ الرسائل على http://localhost/mailpit/'],
    },
    action: () => ({ type: 'service.start', params: { name: 'mailpit' }, label: { en: 'Start Mailpit', ar: 'شغّل Mailpit' } }),
  },

  {
    id: 'php.redeclare',
    match: /Cannot redeclare (?:function )?([\w\\]+)\(\)|Cannot declare (?:class|interface|trait|enum) ([\w\\]+), because the name is already in use/,
    vars: (m) => ({ name: m[1] || m[2] }),
    title: { en: '{name} is defined twice', ar: 'تم تعريف {name} مرتين' },
    summary: { en: 'The same function or class name was declared a second time.', ar: 'عُرّف اسم الدالة أو الكلاس نفسه مرة ثانية.' },
    details: {
      en: 'Usually the same file was included twice (include instead of include_once), or two libraries define the same name.',
      ar: 'غالباً تم تضمين الملف نفسه مرتين (include بدلاً من include_once)، أو أن مكتبتين تعرّفان الاسم نفسه.',
    },
    steps: {
      en: ['Use require_once / include_once.', 'Wrap helper functions: if (!function_exists(\'{name}\')) { function {name}() {...} }', 'For classes, use namespaces and Composer autoloading.'],
      ar: ['استخدم require_once أو include_once.', 'ضع الدوال المساعدة داخل: if (!function_exists(\'{name}\')) { function {name}() {...} }', 'بالنسبة للكلاسات، استخدم الـ namespaces والتحميل التلقائي عبر Composer.'],
    },
  },

  {
    id: 'php.div_zero',
    match: /(Division|Modulo) by zero/,
    title: { en: 'Division by zero', ar: 'قسمة على صفر' },
    summary: { en: 'The code divided a number by 0.', ar: 'قسم الكود رقماً على صفر.' },
    details: { en: 'Since PHP 8 this stops the script (DivisionByZeroError) instead of returning false.', ar: 'منذ PHP 8 يوقف هذا الخطأ السكربت (DivisionByZeroError) بدلاً من إرجاع false.' },
    steps: { en: ['At {where}, check the divisor first: $b != 0 ? $a / $b : 0'], ar: ['في {where} تحقق من المقسوم عليه أولاً: $b != 0 ? $a / $b : 0'] },
  },

  {
    id: 'php.array_to_string',
    match: /Array to string conversion/,
    title: { en: 'Array used as text', ar: 'استخدام مصفوفة كنص' },
    summary: { en: 'An array was printed or joined as if it were a string; PHP printed the word "Array".', ar: 'تمت طباعة مصفوفة أو دمجها كأنها نص، فطبع PHP كلمة "Array".' },
    details: { en: 'Usually echo $array, or a form field sent as name[] arriving as an array.', ar: 'غالباً بسبب echo $array، أو حقل نموذج اسمه name[] يصل على شكل مصفوفة.' },
    steps: { en: ['At {where} use print_r($x) / var_dump($x) to look at it, implode(\', \', $x) to join it, or pick the element you need ($x[0]).'], ar: ['في {where} استخدم print_r($x) أو var_dump($x) لعرضها، أو implode(\', \', $x) لدمجها، أو اختر العنصر المطلوب ($x[0]).'] },
  },

  {
    id: 'php.offset_on_null',
    match: /Trying to access array offset on (?:value of type )?(null|bool|int|float)/,
    vars: (m) => ({ type: m[1] }),
    title: { en: 'Reading [..] from {type}', ar: 'قراءة [..] من قيمة نوعها {type}' },
    summary: { en: 'The code used $x[\'key\'] but $x is {type}, not an array.', ar: 'استخدم الكود $x[\'key\'] بينما $x قيمته من نوع {type} وليست مصفوفة.' },
    details: { en: 'Typical: a database fetch returned false/null because nothing was found, and the code read a column from it anyway.', ar: 'الحالة المعتادة: أعاد جلب البيانات من قاعدة البيانات القيمة false أو null لعدم وجود نتيجة، ومع ذلك قرأ الكود عموداً منها.' },
    steps: { en: ['At {where}, check the value before reading it: if ($row) { ... } or $row[\'name\'] ?? \'\''], ar: ['في {where} تحقق من القيمة قبل قراءتها: if ($row) { ... } أو $row[\'name\'] ?? \'\''] },
  },

  {
    id: 'php.property_on_null',
    match: /Attempt to read property "(\w+)" on (null|bool|int|string|array)/,
    vars: (m) => ({ prop: m[1], type: m[2] }),
    title: { en: 'Reading ->{prop} from {type}', ar: 'قراءة الخاصية ->{prop} من قيمة نوعها {type}' },
    summary: { en: 'The code read ->{prop}, but the variable is {type}, not an object.', ar: 'قرأ الكود الخاصية ->{prop}، لكن المتغير من نوع {type} وليس كائناً.' },
    details: { en: 'Usually a lookup returned null (record not found) or the variable was never set.', ar: 'غالباً أعاد البحث القيمة null (لم يُعثر على السجل)، أو لم يتم تعيين المتغير أصلاً.' },
    steps: { en: ['At {where}, handle the "not found" case, or use $x?->{prop}'], ar: ['في {where} تعامل مع حالة "عدم وجود نتيجة"، أو استخدم $x?->{prop}'] },
  },

  {
    id: 'php.unsupported_operand',
    match: /Unsupported operand types: (\w+) ([+\-*/%]|\*\*) (\w+)/,
    vars: (m) => ({ a: m[1], op: m[2], b: m[3] }),
    title: { en: 'Cannot calculate {a} {op} {b}', ar: 'لا يمكن حساب {a} {op} {b}' },
    summary: { en: 'A math operation was used on values of the wrong type.', ar: 'استُخدمت عملية حسابية على قيم من نوع غير مناسب.' },
    details: { en: 'PHP 8 refuses arithmetic on arrays/null in many cases where PHP 7 guessed.', ar: 'يرفض PHP 8 العمليات الحسابية على المصفوفات و null في حالات كثيرة كان PHP 7 يخمّن فيها النتيجة.' },
    steps: { en: ['At {where}, check the two values (var_dump) and convert them: (int), (float), or array_merge() for arrays.'], ar: ['في {where} افحص القيمتين (var_dump) وحوّلهما: (int) أو (float)، أو array_merge() للمصفوفات.'] },
  },

  {
    id: 'php.undefined_method',
    match: /Call to undefined method ([\w\\]+)::(\w+)\(\)/,
    vars: (m) => ({ cls: m[1], method: m[2] }),
    title: { en: 'Method {method}() does not exist in {cls}', ar: 'الدالة {method}() غير موجودة في الكلاس {cls}' },
    summary: { en: '{cls} has no method called {method}().', ar: 'لا يحتوي الكلاس {cls} على دالة باسم {method}().' },
    details: { en: 'A typo, a method from another version of a library, or the variable holds a different class than you think.', ar: 'خطأ إملائي، أو دالة من نسخة أخرى من المكتبة، أو أن المتغير يحتوي على كلاس غير الذي تتوقعه.' },
    steps: { en: ['Check the spelling at {where}.', 'Check the library version (composer show) and its documentation.'], ar: ['تحقق من كتابة الاسم في {where}.', 'تحقق من نسخة المكتبة (composer show) ومن توثيقها.'] },
  },

  {
    id: 'php.visibility',
    match: /Call to (private|protected) method ([\w\\]+)::(\w+)\(\)|Cannot access (private|protected) property ([\w\\]+)::\$(\w+)/,
    vars: (m) => ({ vis: m[1] || m[4], name: `${m[2] || m[5]}::${m[3] ? m[3] + '()' : '$' + m[6]}` }),
    title: { en: '{name} is {vis}', ar: '{name} محمي ({vis})' },
    summary: { en: 'Code outside the class tried to use something marked {vis}.', ar: 'حاول كود من خارج الكلاس استخدام عنصر مُعلّم بأنه {vis}.' },
    details: { en: 'private/protected members can only be used inside the class (protected: also in child classes).', ar: 'العناصر private و protected لا تُستخدم إلا داخل الكلاس نفسه (و protected أيضاً داخل الكلاسات الوارثة).' },
    steps: { en: ['Use a public method of the class instead, or make it public if that is intended.'], ar: ['استخدم دالة عامة (public) من الكلاس بدلاً منه، أو اجعله public إذا كان ذلك مقصوداً.'] },
  },

  {
    id: 'php.cannot_instantiate',
    match: /Cannot instantiate (abstract class|interface|enum|trait) ([\w\\]+)/,
    vars: (m) => ({ kind: m[1], name: m[2] }),
    title: { en: 'Cannot create an object of {name}', ar: 'لا يمكن إنشاء كائن من {name}' },
    summary: { en: '{name} is an {kind}; you must use a class that implements/extends it.', ar: '{name} من نوع {kind}، ويجب استخدام كلاس يطبّقه أو يرثه.' },
    details: { en: 'Abstract classes and interfaces only describe what a class must do. In frameworks this often means a missing binding in the service container.', ar: 'الكلاسات المجردة والواجهات تصف فقط ما يجب أن يفعله الكلاس. في أطر العمل يعني ذلك غالباً نقص ربط (binding) في الـ service container.' },
    steps: { en: ['Create a concrete class that extends/implements {name}.', 'Laravel: bind it in a service provider: $this->app->bind({name}::class, Concrete::class);'], ar: ['أنشئ كلاساً فعلياً يرث {name} أو يطبّقه.', 'في Laravel: اربطه داخل service provider: $this->app->bind({name}::class, Concrete::class);'] },
  },

  {
    id: 'php.non_static',
    match: /Non-static method ([\w\\]+::\w+)\(\) cannot be called statically/,
    vars: (m) => ({ method: m[1] }),
    title: { en: '{method}() called statically', ar: 'استدعاء {method}() بشكل ثابت (static)' },
    summary: { en: 'Class::method() was used on a method that needs an object.', ar: 'استُخدمت الصيغة Class::method() مع دالة تحتاج إلى كائن.' },
    details: { en: 'PHP 8 no longer allows this. Create an object first, or declare the method static.', ar: 'لم يعد PHP 8 يسمح بذلك. أنشئ كائناً أولاً، أو عرّف الدالة على أنها static.' },
    steps: { en: ['Use (new ClassName())->method() or $obj->method().', 'Or add "static" to the method if it doesn\'t use $this.'], ar: ['استخدم (new ClassName())->method() أو $obj->method().', 'أو أضف الكلمة static إلى الدالة إذا كانت لا تستخدم $this.'] },
  },

  {
    id: 'php.too_few_args',
    match: /Too few arguments to function ([\w\\:]+)\(\), (\d+) passed.*?(?:exactly|at least) (\d+) expected/,
    vars: (m) => ({ fn: m[1], passed: m[2], expected: m[3] }),
    title: { en: '{fn}() needs {expected} arguments', ar: 'الدالة {fn}() تحتاج إلى {expected} من المعاملات' },
    summary: { en: 'It was called with {passed}.', ar: 'تم استدعاؤها بعدد {passed} فقط.' },
    details: { en: 'The function signature requires more arguments than were given.', ar: 'تعريف الدالة يتطلب عدداً من المعاملات أكبر مما تم تمريره.' },
    steps: { en: ['Pass the missing argument(s) at {where}, or give the parameter a default value in the function definition.'], ar: ['مرّر المعاملات الناقصة في {where}، أو أعطِ المعامل قيمة افتراضية في تعريف الدالة.'] },
  },

  {
    id: 'php.object_as_array',
    match: /Cannot use object of type ([\w\\]+) as array/,
    vars: (m) => ({ cls: m[1] }),
    title: { en: '{cls} object used like an array', ar: 'استخدام كائن {cls} كأنه مصفوفة' },
    summary: { en: 'The code wrote $x[\'key\'] but $x is an object.', ar: 'كتب الكود $x[\'key\'] بينما $x كائن.' },
    details: { en: 'Common with json_decode() (returns objects by default) and PDO::FETCH_OBJ.', ar: 'يحدث كثيراً مع json_decode() (التي تعيد كائنات افتراضياً) ومع PDO::FETCH_OBJ.' },
    steps: { en: ['Use $x->key instead, or json_decode($json, true) to get arrays.'], ar: ['استخدم $x->key بدلاً من ذلك، أو json_decode($json, true) للحصول على مصفوفات.'] },
  },

  {
    id: 'php.type_not_found',
    match: /(Interface|Trait|Enum) "?([\w\\]+)"? not found/,
    vars: (m) => ({ kind: m[1], name: m[2] }),
    title: { en: '{kind} {name} not found', ar: '{kind} {name} غير موجود' },
    summary: { en: 'PHP could not load {name}.', ar: 'لم يستطع PHP تحميل {name}.' },
    details: { en: 'Like a missing class: the file was not autoloaded, the namespace is wrong, or the package is not installed.', ar: 'مثل الكلاس المفقود: لم يُحمّل الملف تلقائياً، أو أن الـ namespace خاطئ، أو أن الحزمة غير مثبتة.' },
    steps: { en: ['composer dump-autoload', 'Check the "use" line and the namespace of {name}.'], ar: ['نفّذ: composer dump-autoload', 'تحقق من سطر "use" ومن الـ namespace الخاص بـ {name}.'] },
  },

  {
    id: 'php.localhost_name',
    match: /getaddrinfo for ([\w.-]+\.localhost) failed|Could not resolve host: ([\w.-]+\.localhost)/,
    vars: (m) => ({ host: m[1] || m[2], name: (m[1] || m[2]).replace(/\.localhost$/, '') }),
    title: { en: 'Windows cannot resolve {host}', ar: 'لا يستطيع ويندوز الوصول إلى العنوان {host}' },
    summary: {
      en: 'Browsers and curl understand NAME.localhost, but Windows\' own name lookup (file_get_contents, fsockopen, gethostbyname) does not.',
      ar: 'تفهم المتصفحات و curl العناوين بصيغة NAME.localhost، لكن نظام الأسماء في ويندوز نفسه (file_get_contents و fsockopen و gethostbyname) لا يفهمها.',
    },
    details: {
      en: 'AMPLE\'s sites use *.localhost so that no hosts file and no administrator rights are needed. Inside PHP, use curl for HTTP calls to your local sites (it resolves *.localhost itself), or call http://localhost/{name}/ instead.',
      ar: 'تستخدم مواقع AMPLE العناوين *.localhost حتى لا تحتاج إلى ملف hosts ولا إلى صلاحيات المسؤول. داخل PHP استخدم curl للاتصال بمواقعك المحلية (فهو يحل *.localhost بنفسه)، أو استخدم العنوان http://localhost/{name}/ بدلاً من ذلك.',
    },
    steps: {
      en: ['Use curl (or Guzzle / Laravel Http, which use curl) for {host}.', 'Or use http://localhost/{name}/ in that call.'],
      ar: ['استخدم curl (أو Guzzle أو Laravel Http، وهي تعتمد على curl) للوصول إلى {host}.', 'أو استخدم العنوان http://localhost/{name}/ في هذا الاستدعاء.'],
    },
  },

  {
    id: 'php.network',
    match: /php_network_getaddresses: getaddrinfo(?: for (\S+))? failed|Could not resolve host: (\S+)|HTTP request failed!? ?(.*)|Connection timed out after \d+ milliseconds/,
    vars: (m) => ({ host: m[1] || m[2] || '' }),
    title: { en: 'Could not reach an outside server', ar: 'تعذّر الوصول إلى خادم خارجي' },
    summary: { en: 'PHP tried to connect to {host} on the internet and failed.', ar: 'حاول PHP الاتصال بـ {host} عبر الإنترنت وفشل.' },
    details: { en: 'No internet connection, a wrong address, a firewall/VPN blocking php.exe, or the remote server is down.', ar: 'لا يوجد اتصال بالإنترنت، أو العنوان خاطئ، أو أن جداراً نارياً أو VPN يمنع php.exe، أو أن الخادم البعيد متوقف.' },
    steps: { en: ['Check the address is correct and opens in your browser.', 'Check your internet / VPN, and that the firewall allows php.exe and httpd.exe.'], ar: ['تحقق من صحة العنوان ومن أنه يفتح في المتصفح.', 'تحقق من الإنترنت و VPN، ومن أن الجدار الناري يسمح لـ php.exe و httpd.exe.'] },
  },

  {
    id: 'php.permission',
    match: /(?:fopen|file_put_contents|mkdir|unlink|rename|copy|move_uploaded_file|touch)\((.*?)\): (?:Failed to open stream: )?Permission denied/i,
    vars: (m) => ({ path: m[1] }),
    title: { en: 'Permission denied: {path}', ar: 'تم رفض الإذن: {path}' },
    summary: { en: 'Windows did not let PHP write or change this file.', ar: 'لم يسمح ويندوز لـ PHP بالكتابة في هذا الملف أو تعديله.' },
    details: { en: 'The file is open in another program (Excel, an editor), it is read-only, the folder is protected (e.g. Program Files), or antivirus/OneDrive is locking it.', ar: 'الملف مفتوح في برنامج آخر (مثل Excel أو محرر)، أو أنه للقراءة فقط، أو أن المجلد محمي (مثل Program Files)، أو أن برنامج الحماية أو OneDrive يقفله.' },
    steps: { en: ['Close programs that may have the file open.', 'Right-click the file → Properties → uncheck "Read-only".', 'Keep projects inside htdocs, not in OneDrive or Program Files.'], ar: ['أغلق البرامج التي قد تكون فتحت الملف.', 'انقر بزر الفأرة الأيمن على الملف ← خصائص ← ألغِ تحديد "للقراءة فقط".', 'احتفظ بمشاريعك داخل htdocs، وليس في OneDrive أو Program Files.'] },
  },

  {
    id: 'php.recursion',
    match: /Maximum function nesting level of '(\d+)' reached|Maximum call stack size of \d+ bytes reached/,
    title: { en: 'Endless recursion', ar: 'استدعاء ذاتي لا نهائي' },
    summary: { en: 'A function kept calling itself until PHP stopped it.', ar: 'ظلت دالة تستدعي نفسها حتى أوقفها PHP.' },
    details: { en: 'A recursive function has no stopping condition, or two functions keep calling each other (e.g. a __get that reads a property through itself).', ar: 'دالة تستدعي نفسها دون شرط توقف، أو دالتان تستدعي كل منهما الأخرى (مثل __get تقرأ خاصية عبر نفسها).' },
    steps: { en: ['Look at the stack trace (raw log below): the repeating function is the culprit.', 'Add or fix its stop condition.'], ar: ['انظر إلى الـ stack trace في السجل الأصلي أدناه: الدالة المتكررة هي السبب.', 'أضف شرط توقف لها أو صحّحه.'] },
  },

  {
    id: 'php.max_input_vars',
    match: /Input variables exceeded (\d+)/,
    vars: (m) => ({ limit: m[1] }),
    title: { en: 'Form has too many fields ({limit} max)', ar: 'النموذج يحتوي على حقول كثيرة (الحد {limit})' },
    summary: { en: 'PHP ignored fields beyond max_input_vars, so part of the form was lost.', ar: 'تجاهل PHP الحقول التي تزيد على max_input_vars، فضاع جزء من بيانات النموذج.' },
    details: { en: 'Big forms (menus in WordPress, large tables, settings pages) can send thousands of fields.', ar: 'النماذج الكبيرة (القوائم في WordPress، والجداول الكبيرة، وصفحات الإعدادات) قد ترسل آلاف الحقول.' },
    steps: { en: ['Raise max_input_vars (button below).'], ar: ['ارفع max_input_vars (الزر أدناه).'] },
    action: () => ({ type: 'php.setIni', params: { values: { max_input_vars: '10000' } }, label: { en: 'Raise max_input_vars to 10000', ar: 'ارفع max_input_vars إلى 10000' } }),
  },

  {
    id: 'php.upload_tmp',
    match: /Missing a temporary folder|unable to create a temporary file|upload_tmp_dir/,
    title: { en: 'Upload temp folder missing', ar: 'مجلد الرفع المؤقت غير موجود' },
    summary: { en: 'PHP could not store an uploaded file temporarily.', ar: 'لم يستطع PHP حفظ الملف المرفوع مؤقتاً.' },
    details: { en: 'AMPLE uses tmp\\uploads. It is recreated on every start, so this happens if tmp was deleted while Apache was running.', ar: 'يستخدم AMPLE المجلد tmp\\uploads، ويعيد إنشاءه عند كل تشغيل، لذلك يحدث هذا إذا حُذف المجلد tmp أثناء عمل Apache.' },
    steps: { en: ['Restart Apache (button below).'], ar: ['أعد تشغيل Apache (الزر أدناه).'] },
    action: () => ({ type: 'service.restart', params: { name: 'apache' }, label: { en: 'Restart Apache', ar: 'أعد تشغيل Apache' } }),
  },

  {
    id: 'php.xdebug_v2_settings',
    match: /(?:Xdebug|xdebug)[^\n]*\b(xdebug\.(?:remote_\w+|profiler_enable\w*|default_enable|coverage_enable|auto_trace))\b[^\n]*(?:removed|renamed|no longer)/i,
    vars: (m) => ({ setting: m[1] }),
    title: { en: 'Old Xdebug 2 setting {setting}', ar: 'إعداد قديم من Xdebug 2: {setting}' },
    summary: { en: '{setting} no longer exists in Xdebug 3, so it has no effect.', ar: 'الإعداد {setting} لم يعد موجوداً في Xdebug 3، لذلك ليس له أي تأثير.' },
    details: {
      en: 'Xdebug 3 replaced the old remote_* settings with xdebug.mode, xdebug.client_host and xdebug.client_port. Guides written for Xdebug 2 still show the old names. AMPLE already sets the correct Xdebug 3 settings with: ample xdebug on',
      ar: 'استبدل Xdebug 3 إعدادات remote_* القديمة بالإعدادات xdebug.mode و xdebug.client_host و xdebug.client_port، وما زالت الشروحات المكتوبة لـ Xdebug 2 تذكر الأسماء القديمة. يضبط AMPLE إعدادات Xdebug 3 الصحيحة بالأمر: ample xdebug on',
    },
    steps: {
      en: ['Remove {setting} from php.ini / ample.json "phpIni".', 'Use ample xdebug on, and port 9003 in your editor (Xdebug 2 used 9000).'],
      ar: ['احذف {setting} من php.ini أو من "phpIni" في ample.json.', 'استخدم الأمر ample xdebug on، والمنفذ 9003 في المحرر (كان Xdebug 2 يستخدم 9000).'],
    },
  },

  {
    id: 'php.xdebug_no_client',
    level: 'notice',
    match: /Xdebug: \[Step Debug\] Could not connect to debugging client\. Tried: ([^\s]+)/,
    vars: (m) => ({ tried: m[1] }),
    title: { en: 'Xdebug found no debugger listening', ar: 'لم يجد Xdebug أي برنامج تصحيح ينتظر الاتصال' },
    summary: { en: 'Xdebug tried {tried}, but your editor is not listening.', ar: 'حاول Xdebug الاتصال بـ {tried}، لكن المحرر لا ينتظر الاتصال.' },
    details: {
      en: 'With Xdebug on, every request tries to reach your editor. If you are not debugging right now, this is harmless, but Xdebug makes PHP slower, so turn it off when you don\'t need it.',
      ar: 'عندما يكون Xdebug مفعّلاً، يحاول كل طلب الاتصال بالمحرر. إذا كنت لا تصحّح الأخطاء الآن فلا ضرر من ذلك، لكن Xdebug يبطّئ PHP، لذا أطفئه عندما لا تحتاجه.',
    },
    steps: {
      en: ['VS Code: Run and Debug → "Listen for Xdebug" (F5), port 9003.', 'Or turn it off: ample xdebug off'],
      ar: ['في VS Code: Run and Debug ← "Listen for Xdebug" (F5) على المنفذ 9003.', 'أو أطفئه: ample xdebug off'],
    },
  },

  // ---- upgrade notices (deprecations with a known fix) ------------------------

  {
    id: 'php.implicit_nullable',
    level: 'notice',
    match: /Implicitly marking parameter \$(\w+) as nullable is deprecated/,
    title: { en: 'PHP 8.4: implicit nullable parameter', ar: 'PHP 8.4: معامل يقبل null بشكل ضمني' },
    summary: { en: 'A parameter like "Type $x = null" must now be written "?Type $x = null".', ar: 'المعامل المكتوب بالشكل "Type $x = null" يجب أن يُكتب الآن "?Type $x = null".' },
    details: {
      en: 'PHP 8.4 deprecated giving a typed parameter a default of null without marking its type nullable. It still works, but will break in PHP 9. It usually comes from older libraries.',
      ar: 'أهمل PHP 8.4 إعطاء معامل له نوع محدد القيمة الافتراضية null دون تحديد أن نوعه يقبل null. ما زال يعمل، لكنه سيتوقف في PHP 9، وغالباً يأتي من مكتبات قديمة.',
    },
    steps: {
      en: ['In your own code: change "Type $x = null" to "?Type $x = null".', 'In libraries (vendor): composer update', 'phpMyAdmin bundled with AMPLE is already compatible.'],
      ar: ['في الكود الخاص بك: غيّر "Type $x = null" إلى "?Type $x = null".', 'في المكتبات (vendor): نفّذ composer update', 'phpMyAdmin المرفق مع AMPLE متوافق مسبقاً.'],
    },
  },

  {
    id: 'php.dynamic_property',
    level: 'notice',
    match: /Creation of dynamic property ([\w\\]+)::\$(\w+) is deprecated/,
    vars: (m) => ({ cls: m[1], prop: m[2] }),
    title: { en: 'PHP 8.2: dynamic property {cls}::${prop}', ar: 'PHP 8.2: خاصية ديناميكية {cls}::${prop}' },
    summary: { en: 'A property was added to an object without being declared in its class.', ar: 'أُضيفت خاصية إلى كائن دون تعريفها داخل الكلاس.' },
    details: { en: 'Since PHP 8.2 properties should be declared. This will become an error in PHP 9.', ar: 'منذ PHP 8.2 يجب تعريف الخصائص داخل الكلاس، وسيصبح ذلك خطأً في PHP 9.' },
    steps: { en: ['Declare it in the class: public $' + '{prop};', 'Or add #[\\AllowDynamicProperties] above the class.'], ar: ['عرّفها داخل الكلاس: public $' + '{prop};', 'أو أضف #[\\AllowDynamicProperties] فوق تعريف الكلاس.'] },
  },

  {
    id: 'php.null_to_internal',
    level: 'notice',
    match: /Passing null to parameter #(\d+) \(\$(\w+)\) of type ([\w|]+) is deprecated/,
    vars: (m) => ({ n: m[1], param: m[2], type: m[3] }),
    title: { en: 'PHP 8.1: null passed to a built-in function', ar: 'PHP 8.1: تمرير null إلى دالة مدمجة' },
    summary: { en: 'Parameter ${param} expects {type}, but null was passed.', ar: 'المعامل ${param} يتوقع {type}، لكن تم تمرير null.' },
    details: { en: 'Built-in functions like strlen(), trim(), str_replace() no longer accept null silently. Very common with database values that are NULL.', ar: 'لم تعد الدوال المدمجة مثل strlen() و trim() و str_replace() تقبل null بصمت، ويحدث ذلك كثيراً مع قيم قاعدة البيانات الفارغة NULL.' },
    steps: { en: ['At {where} convert first: trim($x ?? \'\')'], ar: ['في {where} حوّل القيمة أولاً: trim($x ?? \'\')'] },
  },

  {
    id: 'php.return_type',
    level: 'notice',
    match: /Return type of ([\w\\:]+\(\)) should either be compatible with/,
    vars: (m) => ({ method: m[1] }),
    title: { en: 'PHP 8.1: missing return type on {method}', ar: 'PHP 8.1: نوع الإرجاع ناقص في {method}' },
    summary: { en: 'A method overriding a built-in interface needs a return type.', ar: 'دالة تعيد تعريف دالة من واجهة مدمجة تحتاج إلى تحديد نوع الإرجاع.' },
    details: { en: 'Classes implementing ArrayAccess, Iterator, Countable, JsonSerializable... must declare return types since PHP 8.1.', ar: 'الكلاسات التي تطبّق ArrayAccess أو Iterator أو Countable أو JsonSerializable... يجب أن تحدد نوع الإرجاع منذ PHP 8.1.' },
    steps: { en: ['Add the return type the message names, or #[\\ReturnTypeWillChange] above the method.', 'In libraries: composer update'], ar: ['أضف نوع الإرجاع المذكور في الرسالة، أو #[\\ReturnTypeWillChange] فوق الدالة.', 'في المكتبات: composer update'] },
  },
];
