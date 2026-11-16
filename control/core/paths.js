'use strict';
// Every path in AMPLE is derived from ROOT at runtime, so the whole folder
// can be moved anywhere (e.g. C:\ample) without editing a single file.
//
//   ample\
//   ├── htdocs\        your PHP projects
//   ├── apache\        Apache (config: apache\conf\httpd.conf)
//   ├── php\<ver>\     one folder per PHP version (config: php\<ver>\php.ini)
//   ├── mariadb\       MariaDB (config: mariadb\my.ini, databases: mariadb\data)
//   ├── phpmyadmin\
//   ├── logs\          all logs
//   ├── tmp\           temporary files, safe to delete while stopped
//   └── control\       AMPLE itself (this code)
const path = require('path');

const ROOT = process.env.AMPLE_ROOT
  ? path.resolve(process.env.AMPLE_ROOT)
  : path.resolve(__dirname, '..', '..');

const p = (...parts) => path.join(ROOT, ...parts);
// Apache and MariaDB configs are happiest with forward slashes on Windows.
const fwd = (s) => s.replace(/\\/g, '/');

module.exports = {
  ROOT,
  p,
  fwd,
  // components
  htdocs: p('htdocs'),
  apache: p('apache'),
  apacheConf: p('apache', 'conf', 'httpd.conf'),
  vhosts: p('apache', 'conf', 'vhosts'),
  phpRoot: p('php'),
  cacert: p('php', 'cacert.pem'),
  mariadb: p('mariadb'),
  myIni: p('mariadb', 'my.ini'),
  mysqlData: p('mariadb', 'data'),
  phpmyadmin: p('phpmyadmin'),
  logs: p('logs'),
  tmp: p('tmp'),
  run: p('tmp', 'run'),
  downloads: p('tmp', 'downloads'),
  // AMPLE itself
  control: p('control'),
  templates: p('control', 'templates'),
  dashboard: p('control', 'dashboard'),
  componentsFile: p('control', 'components.json'),
  settingsFile: p('ample.json'),
};
