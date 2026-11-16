<?php
declare(strict_types=1);
// AMPLE dashboard: http://localhost/ (and /ample/).
// Pages: home (status + your sites), faq, guides, phpinfo.
// Anything that reveals this machine (sites, status, versions, phpinfo, tool links) is
// shown ONLY to requests from this computer — even if AMPLE is ever put on a server.

$root = dirname(__DIR__, 2);
$cfg = json_decode((string) @file_get_contents("$root/ample.json"), true) ?: [];
$ports = ($cfg['ports'] ?? []) + ['http' => 80, 'https' => 443, 'mysql' => 3306, 'smtp' => 1025, 'mailpit' => 8025];

// Local = the TCP connection itself comes from this machine. Never trust headers like
// X-Forwarded-For here: any visitor can fake them.
$remote = $_SERVER['REMOTE_ADDR'] ?? '';
$isLocal = $remote === '::1' || str_starts_with($remote, '127.') || $remote === '::ffff:127.0.0.1';

// ---- language: ample.json, overridable with ?lang=en|ar (remembered in a cookie) ----
$lang = $_GET['lang'] ?? $_COOKIE['ample_lang'] ?? ($cfg['language'] ?? 'en');
$lang = $lang === 'ar' ? 'ar' : 'en';
if (isset($_GET['lang'])) {
    setcookie('ample_lang', $lang, ['expires' => time() + 31536000, 'path' => '/', 'samesite' => 'Lax']);
}
$T = [
    'en' => [
        'home' => 'Home', 'faq' => 'FAQ', 'guides' => 'How-to Guides', 'mail' => 'Inbox', 'mailpit' => 'Mailpit', 'share' => 'Share',
        'sites' => 'Your sites', 'open' => 'Open',
        'empty_title' => 'No projects yet',
        'empty_text' => 'Create a folder in htdocs, for example htdocs\\shop, put an index.php in it, and open',
        'bad_name' => 'Not a valid site name (letters, digits, hyphens). Rename it to',
        'theme' => 'Theme', 'served' => 'serves',
        'hello' => 'Welcome to AMPLE', 'hello_sub' => 'Every folder in htdocs is a site: htdocs\\NAME opens at',
        'pma_d' => 'Create and manage your databases', 'mail_d' => 'Emails sent by your PHP code',
        'guides_d' => 'Laravel, WordPress, Xdebug, HTTPS and more', 'faq_d' => 'Quick answers to common questions',
        'faq_title' => 'Frequently asked questions', 'guides_title' => 'How-to guides',
        'welcome' => 'AMPLE local development server', 'welcome_sub' => 'Apache · MariaDB · PHP',
    ],
    'ar' => [
        'home' => 'الرئيسية', 'faq' => 'الأسئلة الشائعة', 'guides' => 'الشروحات', 'mail' => 'صندوق البريد', 'mailpit' => 'Mailpit', 'share' => 'المشاركة',
        'sites' => 'مواقعك', 'open' => 'فتح',
        'empty_title' => 'لا توجد مشاريع بعد',
        'empty_text' => 'أنشئ مجلداً داخل htdocs، مثل htdocs\\shop، وضع فيه ملف index.php، ثم افتح',
        'bad_name' => 'ليس اسم موقع صالحاً (أحرف إنجليزية وأرقام وشرطات). غيّر اسمه إلى',
        'theme' => 'المظهر', 'served' => 'يعرض',
        'hello' => 'أهلاً بك في AMPLE', 'hello_sub' => 'كل مجلد داخل htdocs هو موقع: htdocs\\NAME يفتح على',
        'pma_d' => 'أنشئ قواعد بياناتك وأدرها', 'mail_d' => 'الرسائل التي يرسلها كود PHP',
        'guides_d' => 'Laravel و WordPress و Xdebug و HTTPS وغيرها', 'faq_d' => 'إجابات سريعة عن الأسئلة المتكررة',
        'faq_title' => 'الأسئلة الشائعة', 'guides_title' => 'الشروحات',
        'welcome' => 'خادم التطوير المحلي AMPLE', 'welcome_sub' => 'Apache · MariaDB · PHP',
    ],
][$lang];
$all = require __DIR__ . '/content.php';
$content = $all[$lang];
$smtp = ['{SMTP}' => (string) (int) $ports['smtp']];   // the real SMTP port, shown in the Mailpit page
$code = array_map(static fn(string $c): string => strtr($c, $smtp), $all['code']);
$e = static fn($s): string => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

$page = $_GET['page'] ?? 'home';
if (!in_array($page, ['home', 'faq', 'guides', 'mailpit', 'share', 'phpinfo'], true)) $page = 'home';
if ($page === 'phpinfo' && !$isLocal) $page = 'home';
$link = static fn(string $p): string => '/ample/' . ($p === 'home' ? '' : "?page=$p");

// ---- your sites: computed only for local requests --------------------------------------
// No service status and no versions here: if this page opens, Apache + PHP are running,
// and the AMPLE panel is the place for service status. Versions live in phpinfo (local only).
$sites = $bad = [];
if ($isLocal && $page === 'home') {
    // one site per htdocs folder (same rules as control/core/sites.js)
    $htdocs = "$root/htdocs";
    $port = (int) $ports['http'] === 80 ? '' : ':' . $ports['http'];
    $sport = (int) $ports['https'] === 443 ? '' : ':' . $ports['https'];
    foreach (is_dir($htdocs) ? scandir($htdocs) : [] as $name) {
        if ($name[0] === '.' || !is_dir("$htdocs/$name")) continue;
        if (!preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i', $name)) {
            $bad[] = ['name' => $name, 'suggest' => trim(preg_replace('/[^a-z0-9-]/', '', preg_replace('/[\s_]+/', '-', strtolower($name))), '-')];
            continue;
        }
        $d = "$htdocs/$name";
        $kind = match (true) {
            is_file("$d/artisan") && is_file("$d/public/index.php") => ['Laravel', 'public'],
            is_file("$d/bin/console") && is_file("$d/public/index.php") => ['Symfony', 'public'],
            is_file("$d/wp-config.php") || is_file("$d/wp-load.php") => ['WordPress', ''],
            is_file("$d/public/index.php") => ['PHP', 'public'],
            default => ['', ''],
        };
        $host = strtolower($name) . '.localhost';
        $sites[] = ['name' => $name, 'url' => "http://$host$port/", 'https' => !empty($cfg['https']) ? "https://$host$sport/" : null,
            'kind' => $kind[0], 'web' => $kind[1]];
    }
}

// ---- logo files ---------------------------------------------------------------------
$mark = preg_replace('/<!--.*?-->/s', '', (string) @file_get_contents("$root/control/assets/logo/ample-mark.svg"));
$favicon = 'data:image/svg+xml;base64,' . base64_encode((string) @file_get_contents("$root/control/assets/logo/ample-icon-16.svg"));
?>
<!doctype html>
<html lang="<?= $lang ?>" dir="<?= $lang === 'ar' ? 'rtl' : 'ltr' ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AMPLE<?= $page !== 'home' ? ' · ' . $e($T[$page] ?? 'phpinfo') : '' ?></title>
<link rel="icon" href="<?= $favicon ?>">
<style>
  :root {
    --bg:#f6f4f0; --panel:#ffffff; --panel2:#f3f0ea; --line:#e3ded5; --text:#1c1a17; --muted:#625d55;
    --accent:#f08a24; --accent-ink:#b35a0c; --on-accent:#1a1205; --ok:#1f8a52; --off:#8a847b;
    /* the header bar: charcoal in both themes, so it always stands apart from the page */
    --hdr:#15171c; --hdr-line:#2a2e36; --hdr-text:#f1efea; --hdr-muted:#b4b1aa;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg:#15171c; --panel:#1f2229; --panel2:#262a32; --line:#30343d; --text:#f1efea; --muted:#a2a6af;
      --accent-ink:#f5a04f; --ok:#41c27f; --off:#7d828c; --hdr:#0c0d10; --hdr-line:#24272e;
    }
  }
  :root[data-theme="dark"] {
    --bg:#15171c; --panel:#1f2229; --panel2:#262a32; --line:#30343d; --text:#f1efea; --muted:#a2a6af;
    --accent-ink:#f5a04f; --ok:#41c27f; --off:#7d828c; --hdr:#0c0d10; --hdr-line:#24272e;
  }
  * { box-sizing: border-box; }
  /* column layout: main grows, so the footer always sits at the very bottom */
  body { margin: 0; background: var(--bg); color: var(--text); font-family: "Segoe UI", Tahoma, system-ui, sans-serif; line-height: 1.55;
         min-height: 100vh; display: flex; flex-direction: column; }
  a { color: var(--accent-ink); }
  code { background: var(--panel2); padding: 1px 6px; border-radius: 5px; font-family: Consolas, "Cascadia Mono", monospace; font-size: .92em; direction: ltr; unicode-bidi: isolate; }

  /* full-width header bar */
  html { scroll-padding-top: 80px; }   /* in-page jumps (phpinfo links) land below the sticky header */

  /* Scrollbars in AMPLE colors. Chrome/Edge: full design via ::-webkit-scrollbar (rounded amber thumb).
     Firefox: only colors + width (scrollbar-color), used where ::-webkit-scrollbar is not supported,
     because in Chrome scrollbar-color would switch the rounded design off. */
  ::-webkit-scrollbar { width: 12px; height: 12px; }
  ::-webkit-scrollbar-track { background: var(--bg); }
  ::-webkit-scrollbar-thumb { background: var(--accent); border-radius: 10px; border: 3px solid var(--bg); }
  ::-webkit-scrollbar-thumb:hover { background: var(--accent-ink); }
  ::-webkit-scrollbar-corner { background: var(--bg); }
  /* code blocks: thin bar on the dark code background */
  .code pre::-webkit-scrollbar { height: 8px; }
  .code pre::-webkit-scrollbar-track { background: var(--hdr); border-radius: 0 0 8px 8px; }
  .code pre::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 65%, transparent); border: 2px solid var(--hdr); }
  .code pre::-webkit-scrollbar-thumb:hover { background: var(--accent); }
  @supports not selector(::-webkit-scrollbar) {
    html { scrollbar-color: var(--accent) var(--bg); }
    .code pre { scrollbar-color: var(--accent) var(--hdr); scrollbar-width: thin; }
  }
  /* sticky: stays at the top while the page scrolls */
  .hdr { background: var(--hdr); border-bottom: 1px solid var(--hdr-line); color: var(--hdr-text);
         position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
  .hdr-in { display: flex; align-items: center; gap: 22px; padding: 12px 32px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: var(--hdr-text); }
  .brand .mark { width: 40px; height: 31px; display: block; }
  .brand .mark svg { width: 100%; height: 100%; display: block; }
  .brand b { font-size: 20px; letter-spacing: 3px; }
  .menu { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; flex: 1; }
  .menu a { color: var(--hdr-muted); text-decoration: none; font-size: 15px; padding: 8px 12px; border-radius: 8px; }
  .menu a:hover { color: var(--hdr-text); background: rgba(255,255,255,.06); }
  .menu a.on { color: var(--hdr-text); box-shadow: inset 0 -2px 0 var(--accent); border-radius: 0; }
  .tools { display: flex; align-items: center; gap: 8px; margin-inline-start: auto; }
  .tools a, .tools button { font: inherit; font-size: 14px; text-decoration: none; padding: 8px 14px; border-radius: 8px; cursor: pointer;
                             color: var(--hdr-text); background: transparent; border: 1px solid var(--hdr-line); }
  .tools a:hover, .tools button:hover { border-color: var(--accent); }
  .tools a.main { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
  /* EN | ع switch: two joined buttons, the current language filled */
  .lang { display: inline-flex; direction: ltr; }
  .tools .lang a { border-radius: 0; min-width: 40px; text-align: center; padding-inline: 10px; }
  .tools .lang a:first-child { border-radius: 8px 0 0 8px; }
  .tools .lang a:last-child { border-radius: 0 8px 8px 0; border-left: 0; }
  .tools .lang a.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: var(--accent); color: var(--hdr-text); }
  .tools .lang a.on + a, .tools .lang a + a.on { border-left: 1px solid var(--accent); }

  /* full-width content */
  main { padding: 8px 32px 48px; flex: 1 0 auto; }
  h2 { font-size: 13px; margin: 26px 0 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
  h1.title { font-size: 24px; margin: 26px 0 16px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  /* welcome banner + shortcut cards (home, local only) */
  .hello { display: flex; align-items: center; gap: 18px; padding: 22px 24px; margin-top: 26px;
           border-inline-start: 4px solid var(--accent); }
  .hello .mark { width: 56px; height: 43px; flex: none; }
  .hello .mark svg { width: 100%; height: 100%; display: block; }
  .hello b { font-size: 22px; display: block; }
  .hello span { color: var(--muted); }
  .quick { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
  .quick a { display: block; padding: 16px 18px; text-decoration: none; color: var(--text); transition: border-color .15s, transform .15s; }
  .quick a:hover { border-color: var(--accent); transform: translateY(-1px); }
  .quick b { display: block; color: var(--accent-ink); font-size: 16px; margin-bottom: 2px; }
  .quick span { color: var(--muted); font-size: 14px; }
  .sites { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  .site { display: flex; align-items: center; gap: 12px; padding: 14px 16px; flex-wrap: wrap; }
  .site .grow { flex: 1; min-width: 160px; }
  .site .url { font-weight: 600; direction: ltr; unicode-bidi: isolate; }
  .site small { color: var(--muted); display: block; direction: ltr; text-align: start; }
  .tag { font-size: 12px; padding: 2px 9px; border-radius: 6px; background: var(--panel2); color: var(--muted); }
  .site .btn { font-size: 13px; text-decoration: none; padding: 7px 13px; border-radius: 8px; border: 1px solid var(--line); color: var(--text); }
  .site .btn:hover { border-color: var(--accent); }
  .empty { padding: 28px 20px; text-align: center; }
  .empty b { display: block; font-size: 17px; margin-bottom: 6px; }
  .warn { padding: 12px 16px; margin-top: 12px; color: var(--muted); font-size: 14px; }
  .welcome { padding: 48px 20px; text-align: center; }
  .welcome .mark { width: 120px; height: 92px; margin: 0 auto 14px; }
  .welcome b { font-size: 22px; display: block; }
  .welcome span { color: var(--muted); }

  /* FAQ + guides */
  .qa { padding: 0; }
  .qa details + details { border-top: 1px solid var(--line); }
  .qa summary { cursor: pointer; padding: 16px 20px; font-weight: 600; list-style: none; display: flex; gap: 10px; }
  .qa summary::-webkit-details-marker { display: none; }
  .qa summary::before { content: "+"; color: var(--accent-ink); font-weight: 700; width: 14px; flex: none; }
  .qa details[open] summary::before { content: "−"; }
  .qa .a { padding: 0 20px 18px 44px; color: var(--text); }
  [dir="rtl"] .qa .a { padding: 0 44px 18px 20px; }
  .guides { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
  .guide { padding: 18px 20px; }
  .guide h3 { margin: 0 0 10px; font-size: 17px; }
  .guide ol { margin: 0; padding-inline-start: 22px; }
  .guide li { margin: 6px 0; }

  /* Mailpit page */
  .mp-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .mp-head .title { margin-inline-end: auto; }
  .btn-main { background: var(--accent); color: var(--on-accent); text-decoration: none; font-weight: 600; padding: 9px 16px; border-radius: 8px; }
  .mp-intro, .mp-tip { padding: 18px 20px; }
  .mp-tip { margin-top: 14px; color: var(--muted); }
  .mp-set { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .mp-set div { padding: 14px 20px; border-bottom: 1px solid var(--line); }
  .mp-set span { display: block; color: var(--muted); font-size: 13px; margin-bottom: 4px; }
  .mp-ex { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 14px; }
  .mp-ex .card { padding: 18px 20px; min-width: 0; }
  .mp-ex h3 { margin: 0 0 6px; font-size: 17px; }
  .mp-ex p { margin: 0 0 12px; color: var(--muted); }
  .code { position: relative; direction: ltr; }
  .code pre { margin: 0; background: var(--hdr); color: #e9e6df; padding: 14px 16px; border-radius: 8px; overflow-x: auto;
              font: 13px/1.6 Consolas, "Cascadia Mono", monospace; text-align: left; }
  .code .copy { position: absolute; top: 8px; right: 8px; background: transparent; border: 1px solid var(--hdr-line); color: var(--hdr-muted);
                border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 14px; }
  .code .copy:hover, .code .copy.done { color: var(--accent); border-color: var(--accent); }
  @media (max-width: 560px) { .mp-ex { grid-template-columns: 1fr; } }

  /* phpinfo() in AMPLE colors */
  .phpinfo { overflow-x: auto; padding: 8px 20px 20px; direction: ltr; }
  .phpinfo table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
  .phpinfo td, .phpinfo th { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; word-break: break-word; }
  .phpinfo .e { background: var(--panel2); font-weight: 600; width: 30%; }
  .phpinfo .h, .phpinfo th { background: var(--panel2); }
  .phpinfo h1, .phpinfo h2 { color: var(--text); text-transform: none; letter-spacing: 0; font-size: 18px; }
  .phpinfo img, .phpinfo hr { display: none; }

  /* full-width footer bar, same charcoal as the header */
  .ftr { background: var(--hdr); border-top: 1px solid var(--hdr-line); color: var(--hdr-muted); font-size: 13px; }
  .ftr-in { display: flex; align-items: center; gap: 12px; padding: 14px 32px; flex-wrap: wrap; }
  .ftr .mark { width: 26px; height: 20px; display: block; }
  .ftr .mark svg { width: 100%; height: 100%; display: block; }
  .ftr b { color: var(--hdr-text); letter-spacing: 2px; }
  .ftr .by b { letter-spacing: 0; }
  .ftr .end { margin-inline-start: auto; display: flex; gap: 14px; align-items: center; }
  .ftr a { color: var(--hdr-muted); text-decoration: none; }
  .ftr a:hover, .ftr a.on, .ftr .by a:hover b { color: var(--accent); }
  .ftr .by b { transition: color .15s; }
  .ftr .by a { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--hdr-muted); }
  .ftr .by a:hover { text-decoration-color: var(--accent); }
  @media (max-width: 900px) { .quick { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) {
    .hdr-in, main, .ftr-in { padding-inline: 16px; }
    .quick { grid-template-columns: 1fr; }
    .tools { margin-inline-start: 0; }
  }
</style>
<script>
  // Theme: follows Windows unless you picked one (remembered in this browser only).
  try { const t = localStorage.getItem('ample-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
</script>
</head>
<body>

<header class="hdr">
  <div class="hdr-in">
    <a class="brand" href="/ample/"><span class="mark"><?= $mark ?></span><b>AMPLE</b></a>
    <nav class="menu">
      <a href="<?= $link('home') ?>" class="<?= $page === 'home' ? 'on' : '' ?>"><?= $e($T['home']) ?></a>
      <a href="<?= $link('faq') ?>" class="<?= $page === 'faq' ? 'on' : '' ?>"><?= $e($T['faq']) ?></a>
      <a href="<?= $link('guides') ?>" class="<?= $page === 'guides' ? 'on' : '' ?>"><?= $e($T['guides']) ?></a>
      <a href="<?= $link('mailpit') ?>" class="<?= $page === 'mailpit' ? 'on' : '' ?>">Mailpit</a>
      <a href="<?= $link('share') ?>" class="<?= $page === 'share' ? 'on' : '' ?>"><?= $e($T['share']) ?></a>
      <?php if ($isLocal): ?><a href="<?= $link('phpinfo') ?>" class="<?= $page === 'phpinfo' ? 'on' : '' ?>">phpinfo</a><?php endif; ?>
    </nav>
    <div class="tools">
      <?php if ($isLocal): ?>
        <a class="main" href="/phpmyadmin/" target="_blank" rel="noopener">phpMyAdmin</a>
        <a href="/mailpit/" target="_blank" rel="noopener"><?= $e($T['mail']) ?></a>
      <?php endif; ?>
      <?php $q = $page !== 'home' ? 'page=' . $e($page) . '&amp;' : ''; ?>
      <span class="lang">
        <a href="?<?= $q ?>lang=en" class="<?= $lang === 'en' ? 'on' : '' ?>">EN</a><a href="?<?= $q ?>lang=ar" class="<?= $lang === 'ar' ? 'on' : '' ?>">ع</a>
      </span>
      <button type="button" id="theme" aria-label="<?= $e($T['theme']) ?>">◐</button>
    </div>
  </div>
</header>

<main>
<?php if ($page === 'home' && $isLocal): ?>
  <div class="card hello">
    <span class="mark"><?= $mark ?></span>
    <div><b><?= $e($T['hello']) ?></b><span><?= $e($T['hello_sub']) ?> <code>http://NAME.localhost</code></span></div>
  </div>
  <div class="quick">
    <a class="card" href="/phpmyadmin/" target="_blank" rel="noopener"><b>phpMyAdmin</b><span><?= $e($T['pma_d']) ?></span></a>
    <a class="card" href="/mailpit/" target="_blank" rel="noopener"><b><?= $e($T['mail']) ?></b><span><?= $e($T['mail_d']) ?></span></a>
    <a class="card" href="<?= $link('guides') ?>"><b><?= $e($T['guides']) ?></b><span><?= $e($T['guides_d']) ?></span></a>
    <a class="card" href="<?= $link('faq') ?>"><b><?= $e($T['faq']) ?></b><span><?= $e($T['faq_d']) ?></span></a>
  </div>

  <h2><?= $e($T['sites']) ?></h2>
  <?php if (!$sites && !$bad): ?>
    <div class="card empty"><b><?= $e($T['empty_title']) ?></b><?= $e($T['empty_text']) ?> <code>http://shop.localhost</code></div>
  <?php else: ?>
    <div class="sites">
      <?php foreach ($sites as $s): ?>
        <div class="card site">
          <div class="grow">
            <a class="url" href="<?= $e($s['url']) ?>"><?= $e(rtrim($s['url'], '/')) ?></a>
            <small>htdocs\<?= $e($s['name']) ?><?= $s['web'] ? ' · ' . $e($T['served']) . ' ' . $e($s['web']) . '\\' : '' ?></small>
          </div>
          <?php if ($s['kind']): ?><span class="tag"><?= $e($s['kind']) ?></span><?php endif; ?>
          <?php if ($s['https']): ?><a class="btn" href="<?= $e($s['https']) ?>">https</a><?php endif; ?>
          <a class="btn" href="<?= $e($s['url']) ?>"><?= $e($T['open']) ?></a>
        </div>
      <?php endforeach; ?>
    </div>
    <?php foreach ($bad as $b): ?>
      <div class="card warn">⚠ <code><?= $e($b['name']) ?></code> — <?= $e($T['bad_name']) ?> <code><?= $e($b['suggest'] ?: 'my-site') ?></code></div>
    <?php endforeach; ?>
  <?php endif; ?>

<?php elseif ($page === 'home'): ?>
  <div class="card welcome" style="margin-top:26px">
    <div class="mark"><?= $mark ?></div>
    <b><?= $e($T['welcome']) ?></b><span><?= $e($T['welcome_sub']) ?></span>
  </div>

<?php elseif ($page === 'faq'): ?>
  <h1 class="title"><?= $e($T['faq_title']) ?></h1>
  <div class="card qa">
    <?php foreach ($content['faq'] as $i => [$q, $a]): ?>
      <details<?= $i === 0 ? ' open' : '' ?>><summary><?= $e($q) ?></summary><div class="a"><?= $a ?></div></details>
    <?php endforeach; ?>
  </div>

<?php elseif ($page === 'guides'): ?>
  <h1 class="title"><?= $e($T['guides_title']) ?></h1>
  <div class="guides">
    <?php foreach ($content['guides'] as [$title, $steps]): ?>
      <div class="card guide"><h3><?= $e($title) ?></h3><ol><?php foreach ($steps as $s): ?><li><?= $s ?></li><?php endforeach; ?></ol></div>
    <?php endforeach; ?>
  </div>

<?php elseif ($page === 'mailpit'): $m = $content['mailpit']; $x = static fn(string $h): string => strtr($h, $smtp); ?>
  <div class="mp-head">
    <h1 class="title"><?= $e($m['title']) ?></h1>
    <?php if ($isLocal): ?><a class="btn-main" href="/mailpit/" target="_blank" rel="noopener"><?= $e($m['inbox']) ?> ↗</a><?php endif; ?>
  </div>
  <div class="card mp-intro"><?= $x($m['intro']) ?></div>

  <h2><?= $e($m['settings_title']) ?></h2>
  <div class="card mp-set">
    <?php foreach ($m['settings'] as [$k, $v]): ?>
      <div><span><?= $e($k) ?></span><code><?= $e($x($v)) ?></code></div>
    <?php endforeach; ?>
  </div>

  <h2><?= $e($m['examples_title']) ?></h2>
  <div class="mp-ex">
    <?php foreach ($m['examples'] as [$title, $desc, $blocks]): ?>
      <div class="card">
        <h3><?= $e($title) ?></h3>
        <p><?= $x($desc) ?></p>
        <?php foreach ($blocks as $b): ?>
          <div class="code"><button type="button" class="copy" aria-label="Copy">⧉</button><pre><?= $e($code[$b]) ?></pre></div>
        <?php endforeach; ?>
      </div>
    <?php endforeach; ?>
  </div>
  <div class="card mp-tip">💡 <?= $x($m['tip']) ?></div>

<?php elseif ($page === 'share'): $sh = $content['share']; ?>
  <div class="mp-head"><h1 class="title"><?= $e($sh['title']) ?></h1></div>
  <div class="card mp-intro"><?= $sh['intro'] ?></div>

  <h2><?= $e($sh['how_title']) ?></h2>
  <div class="card guide"><ol><?php foreach ($sh['how'] as $s): ?><li><?= $s ?></li><?php endforeach; ?></ol></div>

  <h2><?= $e($sh['safe_title']) ?></h2>
  <div class="card mp-set">
    <?php foreach ($sh['safe'] as [$k, $v]): ?>
      <div><span><?= $e($k) ?></span><code><?= $e($v) ?></code></div>
    <?php endforeach; ?>
  </div>

  <h2><?= $e($sh['examples_title']) ?></h2>
  <div class="mp-ex">
    <?php foreach ($sh['examples'] as [$title, $desc, $blocks]): ?>
      <div class="card">
        <h3><?= $e($title) ?></h3>
        <p><?= $desc ?></p>
        <?php foreach ($blocks as $b): ?>
          <div class="code"><button type="button" class="copy" aria-label="Copy">⧉</button><pre><?= $e($code[$b]) ?></pre></div>
        <?php endforeach; ?>
      </div>
    <?php endforeach; ?>
  </div>
  <div class="card mp-tip">💡 <?= $sh['tip'] ?></div>

<?php elseif ($page === 'phpinfo'): ?>
  <div class="card phpinfo" style="margin-top:26px">
    <?php ob_start(); phpinfo(); $info = (string) ob_get_clean();
    echo preg_replace(['#^.*<body>#s', '#</body>.*$#s'], '', $info); ?>
  </div>
<?php endif; ?>

</main>

<?php $year = (int) date('Y'); ?>
<footer class="ftr">
  <div class="ftr-in">
    <span class="mark"><?= $mark ?></span>
    <span>© <?= $year > 2026 ? "2026–$year" : '2026' ?> <b>AMPLE</b></span>
    <span class="by">· by <a href="https://himacode.com/" target="_blank" rel="noopener"><b>HimaCode</b></a></span>
    <span class="end">
    </span>
  </div>
</footer>

<script>
  // Theme toggle: dark ↔ light (overrides the Windows setting in this browser).
  document.getElementById('theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('ample-theme', root.dataset.theme); } catch (e) {}
  });
  // Copy buttons on code samples.
  document.querySelectorAll('.code .copy').forEach(btn => btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(btn.nextElementSibling.textContent); } catch (e) { return; }
    btn.textContent = '✓'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = '⧉'; btn.classList.remove('done'); }, 1200);
  }));
</script>
</body>
</html>
