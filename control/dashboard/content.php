<?php
declare(strict_types=1);
// Text of the dashboard's FAQ and How-to pages, in English and Arabic.
// Answers are trusted static HTML (only <code>, <b>, <br>, <a>).
// {SMTP} is replaced with the SMTP port from ample.json when the page is shown.

// Code samples for the Mailpit page: plain text (escaped when shown), same in both languages.
$mailCode = [
    'php' => <<<'CODE'
<?php
mail('test@example.com', 'Hello', 'It works!');
CODE,
    'laravel' => <<<'CODE'
MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT={SMTP}
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_SCHEME=null
MAIL_FROM_ADDRESS="hello@example.com"
MAIL_FROM_NAME="${APP_NAME}"
CODE,
    'laravel_test' => <<<'CODE'
php artisan config:clear
php artisan tinker
> Mail::raw('It works!', fn ($m) => $m->to('test@example.com')->subject('Hello'));
CODE,
    'symfony' => <<<'CODE'
MAILER_DSN=smtp://127.0.0.1:{SMTP}
CODE,
    'phpmailer' => <<<'CODE'
$mail = new PHPMailer\PHPMailer\PHPMailer(true);
$mail->isSMTP();
$mail->Host = '127.0.0.1';
$mail->Port = {SMTP};
$mail->SMTPAuth = false;
$mail->SMTPAutoTLS = false;
$mail->setFrom('hello@example.com', 'My App');
$mail->addAddress('test@example.com');
$mail->Subject = 'Hello';
$mail->Body = 'It works!';
$mail->send();
CODE,
    // Share page ("ample share"): a public link to one site.
    'share_cli' => <<<'CODE'
ample share shop
ample share stop
CODE,
    'share_pw' => <<<'CODE'
ample share shop --password=my-secret
CODE,
    'share_laravel' => <<<'CODE'
APP_URL=https://your-link.trycloudflare.com
CODE,
    'share_laravel_proxy' => <<<'CODE'
// bootstrap/app.php (Laravel 11+): trust the tunnel, so links use https
->withMiddleware(function (Middleware $middleware) {
    $middleware->trustProxies(at: '*');
})
CODE,
    'share_wp' => <<<'CODE'
// wp-config.php: use whatever address the site is opened with
define('WP_HOME', 'https://' . $_SERVER['HTTP_HOST']);
define('WP_SITEURL', 'https://' . $_SERVER['HTTP_HOST']);
CODE,
];

return [
    'en' => [
        'faq' => [
            ['Where do I put my projects?', 'In the <code>htdocs</code> folder inside AMPLE. Every folder there is a site: <code>htdocs\shop</code> opens at <code>http://shop.localhost</code> (and also at <code>http://localhost/shop/</code>).'],
            ['What is the database user and password?', 'User <code>root</code>, no password, host <code>127.0.0.1</code>, port <code>3306</code>. Change the password everywhere at once with <code>ample password NEW</code>; phpMyAdmin follows automatically.'],
            ['Apache or MariaDB does not start', 'Open <b>Log Doctor</b> in the AMPLE panel (or run <code>ample doctor</code>). It tells you exactly why, for example which program is using port 80 or 3306, and offers a fix.'],
            ['How do I change the PHP version?', 'Run <code>ample php-add 8.4</code> to download another version and <code>ample php-use 8.4</code> to switch. Your extensions and settings are carried over automatically.'],
            ['Where is php.ini?', 'In <code>php\VERSION\php.ini</code>. You can edit it by hand: AMPLE keeps your changes and applies them to every PHP version.'],
            ['Where are the logs?', 'All in the <code>logs</code> folder: <code>apache</code>, <code>php</code>, <code>mariadb</code>, <code>mailpit</code>. <b>Log Doctor</b> explains them in plain words. Clear them with <code>ample logs clear</code>.'],
            ['My emails are not sent', 'On purpose: every email PHP sends goes to <b>Mailpit</b> and never reaches real people. Read them at <a href="/mailpit/">/mailpit/</a>.'],
            ['Can I use php, composer and mysql in a terminal?', 'Yes: <code>ample path add</code> (no admin needed). Open a new terminal afterwards.'],
            ['Is it safe? Can others on my Wi-Fi see my sites?', 'No. Apache, MariaDB and Mailpit only answer this computer (127.0.0.1).'],
            ['How do I move from XAMPP?', 'Run <code>ample xampp scan</code> to see what can be imported, then import projects, databases, php.ini changes and virtual hosts step by step. XAMPP itself is never changed.'],
            ['Can someone outside my computer open my site?', 'Yes, when you choose to: press <b>Share</b> next to a site in the AMPLE panel (or run <code>ample share shop</code>) and you get a public <code>https://….trycloudflare.com</code> link from Cloudflare, free and with no account. Only that site is public; phpMyAdmin, the dashboard and Mailpit stay private. See the <a href="/ample/?page=share">Share</a> page.'],
            ['Is sharing safe? How do I stop it?', 'Anyone who has the link can open the shared site, so share only what you want to show, and add a password if needed (<code>--password=…</code>). The link stops when you press <b>Stop sharing</b>, run <code>ample share stop</code>, stop Apache or close the panel, and it is different every time.'],
        ],
        'guides' => [
            ['Your first site', [
                'Create a folder <code>htdocs\hello</code>.',
                'Inside it create <code>index.php</code> with <code>&lt;?php echo "Hello!";</code>',
                'Open <code>http://hello.localhost</code>.',
            ]],
            ['A Laravel project', [
                'In a terminal: <code>cd htdocs</code> then <code>composer create-project laravel/laravel shop</code>',
                'Open <code>http://shop.localhost</code>: AMPLE serves the <code>public</code> folder automatically.',
                'In <code>.env</code> set <code>DB_HOST=127.0.0.1</code>, <code>DB_USERNAME=root</code>, empty <code>DB_PASSWORD</code>, then <code>php artisan migrate</code>.',
            ]],
            ['WordPress', [
                'Download WordPress from wordpress.org and unzip it to <code>htdocs\blog</code>.',
                'Create a database <code>blog</code> in <a href="/phpmyadmin/">phpMyAdmin</a>.',
                'Open <code>http://blog.localhost</code> and use host <code>127.0.0.1</code>, user <code>root</code>, no password.',
            ]],
            ['Connect PHP to the database', [
                '<code>$pdo = new PDO("mysql:host=127.0.0.1;dbname=shop;charset=utf8mb4", "root", "");</code>',
                'Always use <code>utf8mb4</code> so Arabic text and emoji are stored correctly.',
            ]],
            ['Test emails', [
                'PHP <code>mail()</code> works with no setup.',
                'For frameworks use SMTP <code>127.0.0.1</code> port <code>1025</code>, any username and password.',
                'Read the emails at <a href="/mailpit/">/mailpit/</a>.',
            ]],
            ['Debug with Xdebug and VS Code', [
                'Run <code>ample xdebug on</code>.',
                'In VS Code install the <b>PHP Debug</b> extension and add a launch configuration on port <code>9003</code>.',
                'Press F5, set a breakpoint and open the page. Turn it off afterwards: <code>ample xdebug off</code>.',
            ]],
            ['Import a big .sql file', [
                'phpMyAdmin has upload limits. Use <code>ample import file.sql database_name</code> instead: any size, with progress.',
                '<code>.sql.gz</code> and <code>.zip</code> files work too.',
            ]],
            ['HTTPS with a padlock', [
                'Run <code>ample https on</code>, then <code>ample https trust</code> and accept the Windows prompt once.',
                'Open <code>https://shop.localhost</code>.',
            ]],
            ['Back up your databases', [
                '<code>ample backup</code> saves every database to the <code>backups</code> folder (compressed).',
                'Restore one with <code>ample import backups\FILE.sql.gz</code>.',
            ]],
            ['Show a site to someone (public link)', [
                'In the AMPLE panel open <b>Sites</b> and press <b>Share</b> next to the site (or run <code>ample share shop</code>).',
                'The first time, AMPLE downloads <b>cloudflared</b> from Cloudflare (signed, about 53 MB).',
                'Copy the <code>https://….trycloudflare.com</code> link and send it. It works on any phone or computer.',
                'Press <b>Stop sharing</b> (or <code>ample share stop</code>) when you are done. More on the <a href="/ample/?page=share">Share</a> page.',
            ]],
        ],
        'mailpit' => [
            'title' => 'Mailpit: test emails safely',
            'intro' => '<b>Mailpit</b> is a fake mail server that runs inside AMPLE. Every email your code sends is caught by Mailpit and shown in its inbox, '
                . 'so you can see exactly what your users would receive (subject, HTML, attachments) without anything reaching a real person. '
                . 'Any recipient address works, even made-up ones.',
            'inbox' => 'Open the inbox',
            'settings_title' => 'Settings for any app',
            'settings' => [
                ['SMTP host', '127.0.0.1'], ['SMTP port', '{SMTP}'], ['Username / password', 'none (any value also works)'],
                ['Encryption', 'none (no SSL / TLS)'], ['Inbox', '/mailpit/'],
            ],
            'examples_title' => 'Examples',
            'examples' => [
                ['Plain PHP: mail()', 'Works with no setup: AMPLE already points PHP at Mailpit in php.ini.', ['php']],
                ['Laravel', 'Open the <code>.env</code> file in your project and set these values (older Laravel versions use <code>MAIL_ENCRYPTION=null</code> instead of <code>MAIL_SCHEME</code>):', ['laravel']],
                ['Laravel: send a test email', 'Clear the cached config, then send one from Tinker:', ['laravel_test']],
                ['Symfony', 'In <code>.env.local</code>:', ['symfony']],
                ['PHPMailer', 'Point it at Mailpit with no login and no encryption:', ['phpmailer']],
                ['WordPress', 'Nothing to do: WordPress uses PHP <code>mail()</code>, so password resets and notifications land in Mailpit. If an SMTP plugin is installed, give it the settings above.', []],
            ],
            'tip' => 'Emails do not arrive? Make sure Mailpit is running in the AMPLE panel, and that the port in your app is <code>{SMTP}</code>. <b>Log Doctor</b> shows Mailpit errors too.',
        ],
        'share' => [
            'title' => 'Share: a public link to your site',
            'intro' => 'Show a site to a client, try it on your phone over 4G, or receive a webhook (payments, GitHub…): AMPLE gives one site a public '
                . '<code>https://….trycloudflare.com</code> address through a <b>Cloudflare Quick Tunnel</b>. Free, no account, no router settings: '
                . 'a small program from Cloudflare (<b>cloudflared</b>) connects from your computer to Cloudflare, and visitors reach your site through it.',
            'how_title' => 'How it works',
            'how' => [
                'In the AMPLE panel open <b>Sites</b> and press <b>Share</b> next to a site, or run <code>ample share shop</code>.',
                'The first time only, AMPLE downloads cloudflared (official, signed by Cloudflare, about 53 MB) and checks it.',
                'After a few seconds you get the link. Copy it and send it to anyone.',
                'Press <b>Stop sharing</b>, run <code>ample share stop</code>, stop Apache or close the panel: the link stops working at once.',
            ],
            'safe_title' => 'What is public and what stays private',
            'safe' => [
                ['Public', 'only the site you share'],
                ['Always private', 'phpMyAdmin, the dashboard, Mailpit, phpinfo'],
                ['Password', 'optional: visitors type the user guest + your password'],
                ['Address', 'random, different every time you share'],
                ['Visits', 'written to logs\\share\\access.log'],
            ],
            'examples_title' => 'Examples',
            'examples' => [
                ['From the command line', 'Share the site in <code>htdocs\shop</code>, then stop:', ['share_cli']],
                ['With a password', 'Only people who have the password can open it:', ['share_pw']],
                ['Laravel', 'If links or images point back to <code>localhost</code>, set <code>APP_URL</code> in <code>.env</code> to the public link while sharing (then <code>php artisan config:clear</code>):', ['share_laravel']],
                ['Laravel: https links', 'If pages load without styles (mixed content), trust the tunnel:', ['share_laravel_proxy']],
                ['WordPress', 'WordPress redirects to the address it was installed with. To open it through the link, add this to <code>wp-config.php</code> while sharing:', ['share_wp']],
            ],
            'tip' => 'Sharing is for demos and tests, not for hosting a real website: it works only while your computer and AMPLE are on, the address changes every time, and Cloudflare gives no guarantee for quick tunnels. Uploads through the link are limited to 100 MB per request.',
        ],
    ],

    'ar' => [
        'faq' => [
            ['أين أضع مشاريعي؟', 'في المجلد <code>htdocs</code> داخل AMPLE. كل مجلد فيه هو موقع: <code>htdocs\shop</code> يفتح على <code>http://shop.localhost</code> (وأيضاً على <code>http://localhost/shop/</code>).'],
            ['ما اسم المستخدم وكلمة المرور لقاعدة البيانات؟', 'المستخدم <code>root</code> دون كلمة مرور، والعنوان <code>127.0.0.1</code>، والمنفذ <code>3306</code>. لتغيير كلمة المرور في كل الأماكن دفعة واحدة: <code>ample password NEW</code>، ويتبعها phpMyAdmin تلقائياً.'],
            ['لا يعمل Apache أو MariaDB', 'افتح <b>Log Doctor</b> في لوحة AMPLE (أو نفّذ <code>ample doctor</code>). سيخبرك بالسبب بالضبط، مثل البرنامج الذي يستخدم المنفذ 80 أو 3306، ويقترح الحل.'],
            ['كيف أغيّر نسخة PHP؟', 'نفّذ <code>ample php-add 8.4</code> لتنزيل نسخة أخرى، و <code>ample php-use 8.4</code> للتبديل. تنتقل إضافاتك وإعداداتك تلقائياً.'],
            ['أين ملف php.ini؟', 'في <code>php\VERSION\php.ini</code>. يمكنك تعديله يدوياً، ويحفظ AMPLE تعديلاتك ويطبّقها على كل نسخ PHP.'],
            ['أين السجلات (اللوجات)؟', 'كلها في المجلد <code>logs</code>: <code>apache</code> و <code>php</code> و <code>mariadb</code> و <code>mailpit</code>. يشرحها <b>Log Doctor</b> بكلمات واضحة، ولمسحها: <code>ample logs clear</code>.'],
            ['رسائلي الإلكترونية لا تُرسل', 'هذا مقصود: كل رسالة يرسلها PHP تذهب إلى <b>Mailpit</b> ولا تصل لأشخاص حقيقيين. اقرأها على <a href="/mailpit/">/mailpit/</a>.'],
            ['هل يمكنني استخدام php و composer و mysql من الطرفية؟', 'نعم: <code>ample path add</code> (دون صلاحيات المسؤول). افتح طرفية جديدة بعدها.'],
            ['هل هو آمن؟ هل يرى الآخرون على شبكتي مواقعي؟', 'لا. لا تستجيب Apache و MariaDB و Mailpit إلا لهذا الحاسوب (127.0.0.1).'],
            ['كيف أنتقل من XAMPP؟', 'نفّذ <code>ample xampp scan</code> لترى ما يمكن استيراده، ثم استورد المشاريع وقواعد البيانات وتعديلات php.ini والمواقع الوهمية خطوة بخطوة. لا يتغير XAMPP نفسه أبداً.'],
            ['هل يمكن لشخص خارج حاسوبي أن يفتح موقعي؟', 'نعم، عندما تختار ذلك: اضغط <b>مشاركة</b> بجانب الموقع في لوحة AMPLE (أو نفّذ <code>ample share shop</code>)، فتحصل على رابط عام <code>https://….trycloudflare.com</code> من Cloudflare، مجاناً ودون حساب. هذا الموقع فقط يصبح عاماً، ويبقى phpMyAdmin والداشبورد و Mailpit خاصة. راجع صفحة <a href="/ample/?page=share">المشاركة</a>.'],
            ['هل المشاركة آمنة؟ وكيف أوقفها؟', 'أي شخص لديه الرابط يستطيع فتح الموقع المشارَك، لذا شارك فقط ما تريد عرضه، وأضف كلمة سر عند الحاجة (<code>--password=…</code>). يتوقف الرابط عند الضغط على <b>إيقاف المشاركة</b>، أو تنفيذ <code>ample share stop</code>، أو إيقاف Apache، أو إغلاق اللوحة، ويتغير في كل مرة.'],
        ],
        'guides' => [
            ['موقعك الأول', [
                'أنشئ المجلد <code>htdocs\hello</code>.',
                'أنشئ بداخله ملف <code>index.php</code> يحتوي على <code>&lt;?php echo "Hello!";</code>',
                'افتح <code>http://hello.localhost</code>.',
            ]],
            ['مشروع Laravel', [
                'في الطرفية: <code>cd htdocs</code> ثم <code>composer create-project laravel/laravel shop</code>',
                'افتح <code>http://shop.localhost</code>: يعرض AMPLE المجلد <code>public</code> تلقائياً.',
                'في ملف <code>.env</code> اضبط <code>DB_HOST=127.0.0.1</code> و <code>DB_USERNAME=root</code> واترك <code>DB_PASSWORD</code> فارغاً، ثم نفّذ <code>php artisan migrate</code>.',
            ]],
            ['WordPress', [
                'نزّل WordPress من wordpress.org وفك ضغطه في <code>htdocs\blog</code>.',
                'أنشئ قاعدة بيانات باسم <code>blog</code> في <a href="/phpmyadmin/">phpMyAdmin</a>.',
                'افتح <code>http://blog.localhost</code> واستخدم العنوان <code>127.0.0.1</code> والمستخدم <code>root</code> دون كلمة مرور.',
            ]],
            ['ربط PHP بقاعدة البيانات', [
                '<code>$pdo = new PDO("mysql:host=127.0.0.1;dbname=shop;charset=utf8mb4", "root", "");</code>',
                'استخدم دائماً <code>utf8mb4</code> ليُحفظ النص العربي والرموز التعبيرية بشكل صحيح.',
            ]],
            ['تجربة الرسائل الإلكترونية', [
                'تعمل الدالة <code>mail()</code> في PHP دون أي إعداد.',
                'في أطر العمل استخدم SMTP على <code>127.0.0.1</code> والمنفذ <code>1025</code>، وأي اسم مستخدم وكلمة مرور.',
                'اقرأ الرسائل على <a href="/mailpit/">/mailpit/</a>.',
            ]],
            ['تصحيح الأخطاء بـ Xdebug و VS Code', [
                'نفّذ <code>ample xdebug on</code>.',
                'في VS Code ثبّت إضافة <b>PHP Debug</b> وأضف إعداد تشغيل على المنفذ <code>9003</code>.',
                'اضغط F5 وضع نقطة توقف وافتح الصفحة. أطفئه بعدها: <code>ample xdebug off</code>.',
            ]],
            ['استيراد ملف .sql كبير', [
                'لـ phpMyAdmin حدود في حجم الرفع. استخدم بدلاً منه <code>ample import file.sql database_name</code>: بأي حجم ومع شريط تقدّم.',
                'تعمل أيضاً ملفات <code>.sql.gz</code> و <code>.zip</code>.',
            ]],
            ['HTTPS مع القفل', [
                'نفّذ <code>ample https on</code> ثم <code>ample https trust</code> ووافق على رسالة ويندوز مرة واحدة.',
                'افتح <code>https://shop.localhost</code>.',
            ]],
            ['نسخ قواعد البيانات احتياطياً', [
                'يحفظ <code>ample backup</code> كل قاعدة بيانات في المجلد <code>backups</code> (مضغوطة).',
                'لاستعادة واحدة: <code>ample import backups\FILE.sql.gz</code>.',
            ]],
            ['عرض موقع على شخص آخر (رابط عام)', [
                'في لوحة AMPLE افتح <b>المواقع</b> واضغط <b>مشاركة</b> بجانب الموقع (أو نفّذ <code>ample share shop</code>).',
                'في المرة الأولى فقط، يحمّل AMPLE برنامج <b>cloudflared</b> من Cloudflare (موقّع، حوالي 53 MB).',
                'انسخ الرابط <code>https://….trycloudflare.com</code> وأرسله. يعمل على أي جوال أو حاسوب.',
                'اضغط <b>إيقاف المشاركة</b> (أو <code>ample share stop</code>) عندما تنتهي. المزيد في صفحة <a href="/ample/?page=share">المشاركة</a>.',
            ]],
        ],
        'mailpit' => [
            'title' => 'Mailpit: تجربة الرسائل بأمان',
            'intro' => '<b>Mailpit</b> خادم بريد وهمي يعمل داخل AMPLE. كل رسالة يرسلها كودك يلتقطها Mailpit ويعرضها في صندوق بريده، '
                . 'فترى بالضبط ما سيصل لمستخدميك (العنوان و HTML والمرفقات) دون أن يصل شيء لأي شخص حقيقي. '
                . 'يقبل أي عنوان مستلم، حتى العناوين المخترعة.',
            'inbox' => 'افتح صندوق البريد',
            'settings_title' => 'الإعدادات لأي تطبيق',
            'settings' => [
                ['خادم SMTP', '127.0.0.1'], ['منفذ SMTP', '{SMTP}'], ['اسم المستخدم / كلمة المرور', 'لا يوجد (وأي قيمة تعمل أيضاً)'],
                ['التشفير', 'بدون (لا SSL ولا TLS)'], ['صندوق البريد', '/mailpit/'],
            ],
            'examples_title' => 'أمثلة',
            'examples' => [
                ['PHP العادي: mail()', 'تعمل دون أي إعداد: AMPLE يوجّه PHP إلى Mailpit مسبقاً في php.ini.', ['php']],
                ['Laravel', 'افتح ملف <code>.env</code> في مشروعك وضع هذه القيم (نسخ Laravel الأقدم تستخدم <code>MAIL_ENCRYPTION=null</code> بدلاً من <code>MAIL_SCHEME</code>):', ['laravel']],
                ['Laravel: إرسال رسالة تجريبية', 'امسح الإعدادات المخزنة، ثم أرسل رسالة من Tinker:', ['laravel_test']],
                ['Symfony', 'في ملف <code>.env.local</code>:', ['symfony']],
                ['PHPMailer', 'وجّهه إلى Mailpit دون تسجيل دخول ودون تشفير:', ['phpmailer']],
                ['WordPress', 'لا شيء تفعله: يستخدم WordPress الدالة <code>mail()</code>، فتصل رسائل استعادة كلمة المرور والتنبيهات إلى Mailpit. إن كانت لديك إضافة SMTP فأعطها الإعدادات أعلاه.', []],
            ],
            'tip' => 'لا تصل الرسائل؟ تأكد أن Mailpit يعمل في لوحة AMPLE، وأن المنفذ في تطبيقك هو <code>{SMTP}</code>. يعرض <b>Log Doctor</b> أخطاء Mailpit أيضاً.',
        ],
        'share' => [
            'title' => 'المشاركة: رابط عام لموقعك',
            'intro' => 'اعرض موقعاً على عميلك، أو جرّبه على جوالك عبر 4G، أو استقبل Webhook (الدفع، GitHub…): يعطي AMPLE موقعاً واحداً عنواناً عاماً '
                . '<code>https://….trycloudflare.com</code> عبر <b>Cloudflare Quick Tunnel</b>. مجاناً، ودون حساب، ودون إعدادات في الراوتر: '
                . 'برنامج صغير من Cloudflare اسمه <b>cloudflared</b> يتصل من حاسوبك إلى Cloudflare، ويصل الزوار إلى موقعك من خلاله.',
            'how_title' => 'كيف تعمل',
            'how' => [
                'في لوحة AMPLE افتح <b>المواقع</b> واضغط <b>مشاركة</b> بجانب الموقع، أو نفّذ <code>ample share shop</code>.',
                'في المرة الأولى فقط، يحمّل AMPLE برنامج cloudflared (رسمي، وموقّع من Cloudflare، حوالي 53 MB) ويتحقق منه.',
                'بعد ثوانٍ تحصل على الرابط. انسخه وأرسله لمن تريد.',
                'اضغط <b>إيقاف المشاركة</b>، أو نفّذ <code>ample share stop</code>، أو أوقف Apache، أو أغلق اللوحة: يتوقف الرابط فوراً.',
            ],
            'safe_title' => 'ما الذي يصبح عاماً وما الذي يبقى خاصاً',
            'safe' => [
                ['عام', 'الموقع الذي تشاركه فقط'],
                ['خاص دائماً', 'phpMyAdmin والداشبورد و Mailpit و phpinfo'],
                ['كلمة السر', 'اختيارية: يكتب الزائر المستخدم guest وكلمة السر'],
                ['العنوان', 'عشوائي، ويتغير في كل مشاركة'],
                ['الزيارات', 'تُسجَّل في logs\\share\\access.log'],
            ],
            'examples_title' => 'أمثلة',
            'examples' => [
                ['من سطر الأوامر', 'شارك الموقع الموجود في <code>htdocs\shop</code>، ثم أوقف المشاركة:', ['share_cli']],
                ['مع كلمة سر', 'لا يفتحه إلا من لديه كلمة السر:', ['share_pw']],
                ['Laravel', 'إذا كانت الروابط أو الصور تعود إلى <code>localhost</code>، اضبط <code>APP_URL</code> في ملف <code>.env</code> على الرابط العام أثناء المشاركة (ثم <code>php artisan config:clear</code>):', ['share_laravel']],
                ['Laravel: روابط https', 'إذا ظهرت الصفحات دون تنسيق (محتوى مختلط)، اجعل Laravel يثق بالنفق:', ['share_laravel_proxy']],
                ['WordPress', 'يعيد WordPress التوجيه إلى العنوان الذي ثُبّت عليه. لفتحه عبر الرابط، أضف هذا إلى <code>wp-config.php</code> أثناء المشاركة:', ['share_wp']],
            ],
            'tip' => 'المشاركة للعرض والتجربة، لا لاستضافة موقع حقيقي: تعمل فقط وحاسوبك و AMPLE يعملان، ويتغير العنوان في كل مرة، ولا تقدّم Cloudflare ضماناً للأنفاق السريعة. حجم الرفع عبر الرابط محدود بـ 100 MB لكل طلب.',
        ],
    ],

    'code' => $mailCode,
];
