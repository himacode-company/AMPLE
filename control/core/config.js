'use strict';
// Turns control/templates/*.tpl + ample.json into the real config files:
//   apache\conf\httpd.conf, php\<ver>\php.ini, mariadb\my.ini, phpmyadmin\config.inc.php
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const settings = require('./settings');
const phpini = require('./phpini');

const cmpVersion = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

function listPhpVersions() {
  if (!fs.existsSync(P.phpRoot)) return [];
  return fs.readdirSync(P.phpRoot)
    .filter((d) => fs.existsSync(path.join(P.phpRoot, d, 'php.exe')))
    .sort(cmpVersion)
    .reverse();
}

function activePhp(s = settings.load()) {
  const all = listPhpVersions();
  if (!all.length) throw new Error('No PHP installed in php\\. Run: ample setup');
  return s.php && all.includes(s.php) ? s.php : all[0];
}

function render(tplName, vars) {
  const tpl = fs.readFileSync(path.join(P.templates, tplName), 'utf8');
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Template ${tplName}: unknown variable {{${key}}}`);
    return String(vars[key]);
  });
}

function ensureDirs() {
  const dirs = [
    'logs/apache', 'logs/php', 'logs/mariadb', 'logs/ample',
    'tmp/uploads', 'tmp/sessions', 'tmp/phpmyadmin', 'tmp/run',
    'apache/conf/vhosts', 'mariadb/data', 'htdocs',
  ];
  for (const d of dirs) fs.mkdirSync(P.p(d), { recursive: true });
}

// Variables shared by all templates (paths, ports, ...).
function baseVars(s = settings.load()) {
  const comps = JSON.parse(fs.readFileSync(P.componentsFile, 'utf8'));
  return {
    ROOT: P.fwd(P.ROOT),
    APACHE: P.fwd(P.apache),
    VHOSTS: P.fwd(P.vhosts),
    MARIADB: P.fwd(P.mariadb),
    MARIADB_VERSION: comps.mariadb.version,
    MYSQL_DATA: P.fwd(P.mysqlData),
    HTDOCS: P.fwd(P.htdocs),
    PMA: P.fwd(P.phpmyadmin),
    DASHBOARD: P.fwd(P.dashboard),
    LOGS: P.fwd(P.logs),
    TMP: P.fwd(P.tmp),
    RUN: P.fwd(P.run),
    // With HTTPS on, PHP also trusts the AMPLE CA (curl to https://x.localhost works).
    CACERT: P.fwd(s.https ? require('./https').phpCaBundle() : P.cacert),
    HTTP_PORT: s.ports.http,
    MYSQL_PORT: s.ports.mysql,
    SITES_CONF: P.fwd(require('./sites').SITES_CONF),
    SHARE_CONF: P.fwd(path.join(P.apache, 'conf', 'ample-share.conf')),
    SMTP_PORT: s.ports.smtp,
    MAILPIT_PORT: s.ports.mailpit,
    // Apache logs in to Mailpit for you on /mailpit/ (settings.mailpitAuth)
    MAILPIT_AUTH: Buffer.from(`${s.mailpitAuth.user}:${s.mailpitAuth.pass}`).toString('base64'),
    MYSQL_USER: s.mysql.user.replace(/'/g, "\\'"),
    MYSQL_PASSWORD: s.mysql.password.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
    MYSQL_GENERAL_LOG: s.mysqlGeneralLog ? 1 : 0,
    PMA_SECRET: s.pmaSecret,
    APACHE_LOG_LEVEL: s.apacheLogLevel,
    TIMEZONE: s.timezone,
    // AMPLE's phpMyAdmin design (control/pma/*.css) is built on top of pmahomme, so with it
    // choosing another theme is switched off (ThemeManager = false).
    PMA_THEME: 'pmahomme',
    // "ample design": AMPLE's look or the original one, per tool. In httpd.conf the lines that
    // add AMPLE's files start with {{PMA_AMPLE}} / {{MAILPIT_AMPLE}}: empty = active,
    // "#" = a comment (switched off, still visible in the generated file).
    PMA_AMPLE: s.design.phpmyadmin === 'original' ? '#' : '',
    MAILPIT_AMPLE: s.design.mailpit === 'original' ? '#' : '',
    PMA_THEME_MANAGER: s.design.phpmyadmin === 'original' ? 'true' : 'false',
    PMA_OBGZIP: s.design.phpmyadmin === 'original' ? "'auto'" : 'false',
    // Only WHETHER a password is set (for phpMyAdmin's "Connect from your app" card),
    // never the password itself.
    MYSQL_HAS_PASSWORD: s.mysql.password ? 1 : 0,
  };
}

// php\<ver>\php.ini for any installed version (used by start and by the comparison).
function generatePhpIni(version) {
  ensureDirs();
  return phpini.writePhpIni(version, baseVars(), render);
}

// Generate all config files for the active PHP version.
function generate() {
  ensureDirs();
  const phpVersion = activePhp(settings.load());
  const php = phpini.writePhpIni(phpVersion, baseVars(), render); // may import manual edits into ample.json
  const s = settings.load();
  const phpDir = path.join(P.phpRoot, phpVersion);
  const vars = {
    ...baseVars(s),
    PHP_VERSION: phpVersion,
    PHP_DIR: P.fwd(phpDir),
    PHP_TS_DLL: `php${phpVersion.split('.')[0]}ts.dll`,
    PHP_APACHE_DLL: `php${phpVersion.split('.')[0]}apache2_4.dll`,
  };

  const files = [['httpd.conf.tpl', P.apacheConf], ['my.ini.tpl', P.myIni]];
  if (fs.existsSync(P.phpmyadmin)) files.push(['config.inc.php.tpl', path.join(P.phpmyadmin, 'config.inc.php')]);
  for (const [tpl, out] of files) fs.writeFileSync(out, render(tpl, vars));
  // bin\php, bin\composer, ... always point at the active PHP version.
  require('./shell').writeLaunchers(phpVersion);

  // One site per htdocs folder (NAME.localhost), plus HTTPS when enabled.
  const sitesMod = require('./sites');
  let ssl = null;
  if (s.https) {
    const https = require('./https');
    https.ensureSiteCert(sitesMod.list().sites.map((x) => x.host));
    ssl = { cert: https.F.crt, key: https.F.key };
  }
  const siteReport = sitesMod.writeConf(ssl);

  return {
    phpVersion,
    phpDir,
    imported: php.imported,
    skippedExtensions: php.skippedExtensions,
    skippedSettings: php.skippedSettings,
    startupMessages: php.startupMessages,
    sites: siteReport.sites,
    skippedSites: siteReport.skipped,
    files: [php.iniFile, ...files.map(([, out]) => out)].map((f) => path.relative(P.ROOT, f)),
  };
}

module.exports = {
  generate, generatePhpIni, listPhpVersions, activePhp, render, baseVars,
  envFor: phpini.envFor, cmpVersion, DEFAULT_EXTENSIONS: phpini.DEFAULT_EXTENSIONS,
};
