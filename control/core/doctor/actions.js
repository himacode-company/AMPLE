'use strict';
// One-click fixes suggested by Log Doctor. Each returns { ok, message: {en, ar} }.
const fs = require('fs');
const path = require('path');
const net = require('net');
const P = require('../paths');
const settings = require('../settings');
const { log } = require('../logger');

const svc = () => require('../services');

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

async function restartApacheIfRunning() {
  if ((await svc().status('apache')).running) await svc().restart('apache');
  else require('../config').generate();
}

const ACTIONS = {
  async 'php.setIni'({ values }) {
    settings.update({ phpIni: values });
    const list = Object.entries(values).map(([k, v]) => `${k} = ${v}`).join(', ');
    log('Doctor', 'FIX', `php.ini: ${list}`);
    await restartApacheIfRunning();
    return { ok: true, message: { en: `Set ${list} (for all PHP versions). Apache restarted.`, ar: `تم ضبط ${list} (لكل نسخ PHP)، وأُعيد تشغيل Apache.` } };
  },

  async 'php.enableExt'({ ext }) {
    const s = settings.load();
    const enable = new Set(s.phpExtensions.enable);
    enable.add(ext);
    s.phpExtensions = { enable: [...enable], disable: s.phpExtensions.disable.filter((e) => e !== ext) };
    settings.save(s);
    const gen = require('../config').generate();
    const skipped = gen.skippedExtensions.find((x) => x.ext === ext);
    if (skipped) {
      return { ok: false, message: { en: `${ext} cannot be enabled: ${skipped.reason}.`, ar: `لا يمكن تفعيل ${ext}: ${skipped.reason}.` } };
    }
    log('Doctor', 'FIX', `extension ${ext} enabled`);
    await restartApacheIfRunning();
    return { ok: true, message: { en: `Extension ${ext} enabled. Apache restarted.`, ar: `تم تفعيل الإضافة ${ext}، وأُعيد تشغيل Apache.` } };
  },

  async 'service.start'({ name }) {
    await svc().start(name);
    const label = svc().SERVICES[name].label;
    return { ok: true, message: { en: `${label} is running.`, ar: `تم تشغيل ${label}.` } };
  },

  async 'service.restart'({ name }) {
    await svc().restart(name);
    const label = svc().SERVICES[name].label;
    return { ok: true, message: { en: `${label} restarted.`, ar: `أُعيد تشغيل ${label}.` } };
  },

  // service: 'http' | 'mysql' | 'smtp' | 'mailpit' (keys of ample.json "ports")
  async 'ports.change'({ service }) {
    const CANDIDATES = {
      mysql: [3307, 3308, 3309, 3310, 33060],
      http: [8080, 8000, 8081, 8888, 8008],
      smtp: [1026, 2525, 1027, 1125],
      mailpit: [8026, 8027, 8126, 8225],
    };
    const OWNER = { mysql: 'mariadb', http: 'apache', smtp: 'mailpit', mailpit: 'mailpit' };
    const s = settings.load();
    let chosen = null;
    for (const p of CANDIDATES[service]) if (p !== s.ports[service] && (await portFree(p))) { chosen = p; break; }
    if (!chosen) return { ok: false, message: { en: 'No free port found.', ar: 'لم يتم العثور على منفذ متاح.' } };
    settings.update({ ports: { [service]: chosen } });
    log('Doctor', 'FIX', `${service} port changed to ${chosen}`);
    // Apache (php.ini mail settings, /mailpit/ proxy) must follow Mailpit's ports.
    if (OWNER[service] === 'mailpit') await restartApacheIfRunning(); else require('../config').generate();
    await svc().start(OWNER[service]);
    const MSG = {
      mysql: { en: `MariaDB now uses port ${chosen} and is running. phpMyAdmin was updated; use port ${chosen} in your projects' database settings.`, ar: `يستخدم MariaDB الآن المنفذ ${chosen} وهو يعمل. تم تحديث phpMyAdmin، واستخدم المنفذ ${chosen} في إعدادات قاعدة البيانات في مشاريعك.` },
      http: { en: `Apache now uses port ${chosen} and is running: open http://localhost:${chosen}/`, ar: `يستخدم Apache الآن المنفذ ${chosen} وهو يعمل: افتح http://localhost:${chosen}/` },
      smtp: { en: `Mailpit now receives email on port ${chosen}. PHP's mail() was updated; in your apps use SMTP 127.0.0.1:${chosen}.`, ar: `يستقبل Mailpit البريد الآن على المنفذ ${chosen}. تم تحديث mail() في PHP، واستخدم في تطبيقاتك SMTP على 127.0.0.1:${chosen}.` },
      mailpit: { en: `Mailpit's page now uses port ${chosen}; it is still at http://localhost/mailpit/`, ar: `تستخدم صفحة Mailpit الآن المنفذ ${chosen}، وما زالت متاحة على http://localhost/mailpit/` },
    };
    return { ok: true, message: MSG[service] };
  },

  // The famous "MySQL shutdown unexpectedly": back up and remove the Aria log files.
  async 'mariadb.repairAria'() {
    if ((await svc().status('mariadb')).running) await svc().stop('mariadb');
    const files = fs.readdirSync(P.mysqlData).filter((f) => f === 'aria_log_control' || /^aria_log\.\d+$/.test(f));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backup = path.join(P.ROOT, 'backups', `aria-repair-${stamp}`);
    fs.mkdirSync(backup, { recursive: true });
    for (const f of files) {
      fs.copyFileSync(path.join(P.mysqlData, f), path.join(backup, f));
      fs.rmSync(path.join(P.mysqlData, f));
    }
    log('Doctor', 'FIX', `Aria repair: moved ${files.length} file(s) to ${path.relative(P.ROOT, backup)}`);
    await svc().start('mariadb');
    return { ok: true, message: { en: `Repaired: ${files.length} Aria log file(s) backed up to ${path.relative(P.ROOT, backup)} and removed. MariaDB is running.`, ar: `تم الإصلاح: نُسخ ${files.length} من ملفات سجل Aria احتياطياً إلى ${path.relative(P.ROOT, backup)} ثم حُذفت، و MariaDB يعمل الآن.` } };
  },

  async 'mariadb.upgrade'() {
    if (!(await svc().status('mariadb')).running) await svc().start('mariadb');
    const r = svc().mariadbClient('mariadb-upgrade.exe', ['--force'], { timeout: 300000 });
    if (r.status !== 0) return { ok: false, message: { en: 'Upgrade failed: ' + (r.stderr || '').trim(), ar: 'فشلت الترقية: ' + (r.stderr || '').trim() } };
    log('Doctor', 'FIX', 'mariadb-upgrade completed');
    return { ok: true, message: { en: 'System tables upgraded.', ar: 'تمت ترقية جداول النظام.' } };
  },
};

async function run(action) {
  const fn = ACTIONS[action.type];
  if (!fn) throw new Error(`Unknown action ${action.type}`);
  return fn(action.params || {});
}

module.exports = { run, ACTIONS };
