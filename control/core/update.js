'use strict';
// "ample update": check every component against its official source, and update
// safely (data kept, automatic rollback if the new version doesn't start).
//
// The new version is written to control\components.json, so "ample setup" on any
// other PC installs exactly the same versions.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const P = require('./paths');
const settings = require('./settings');
const { log } = require('./logger');

const UA = 'ample-update/1.0';
const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r;
};
const text = async (url) => (await get(url)).text();
const json = async (url) => (await get(url)).json();

const cmp = (a, b) => {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

const components = () => JSON.parse(fs.readFileSync(P.componentsFile, 'utf8'));
const saveComponents = (c) => fs.writeFileSync(P.componentsFile, JSON.stringify(c, null, 2) + '\n');
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Installed Visual C++ 2015-2022+ runtime, e.g. "14.40". Apache/PHP builds need a minimum.
function vcRuntime() {
  const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64', '/v', 'Version'], { encoding: 'utf8' });
  const m = (r.stdout || '').match(/v?(\d+)\.(\d+)\./);
  return m ? `${m[1]}.${m[2]}` : null;
}
const VS_NEEDS = { 17: '14.30', 18: '14.50' }; // build toolset -> minimum runtime

// ---- checkers: each returns { name, current, latest, comp?, note? } ----------------

async function checkApache() {
  const c = components().apache;
  const vc = vcRuntime();
  const builds = [];
  for (const [vs, page] of [[18, 'https://www.apachelounge.com/download/'], [17, 'https://www.apachelounge.com/download/VS17/']]) {
    const html = await text(page).catch(() => '');
    for (const m of html.matchAll(/href="([^"]*\/httpd-(2\.4\.\d+)-(\d+)-[Ww]in64-VS(\d+)\.zip)"/g)) {
      builds.push({ url: new URL(m[1], 'https://www.apachelounge.com').href, version: m[2], vs: Number(m[4] || vs) });
    }
  }
  builds.sort((a, b) => cmp(b.version, a.version) || b.vs - a.vs);
  const usable = builds.filter((b) => vc && cmp(vc, VS_NEEDS[b.vs] || '99') >= 0);
  const best = usable[0];
  const newest = builds[0];
  let note = null;
  if (newest && best && cmp(newest.version, best.version) > 0) {
    note = { en: `Apache ${newest.version} exists but needs Visual C++ runtime ${VS_NEEDS[newest.vs]}+ (you have ${vc}). Install the latest "Visual C++ Redistributable x64" from Microsoft, then run ample update again.`,
      ar: `توجد نسخة Apache ${newest.version} لكنها تحتاج إلى مكتبة Visual C++ بإصدار ${VS_NEEDS[newest.vs]} أو أحدث (لديك ${vc}). ثبّت أحدث "Visual C++ Redistributable x64" من مايكروسوفت ثم نفّذ ample update من جديد.` };
  }
  if (!best || cmp(best.version, c.version) <= 0) return { name: 'apache', label: 'Apache', current: c.version, latest: best ? best.version : null, note };
  const sum = (await text(best.url + '.txt').catch(() => '')).match(/\b[a-f0-9]{64}\b/i);
  return {
    name: 'apache', label: 'Apache', current: c.version, latest: best.version, note,
    comp: { ...c, version: best.version, url: best.url, sha256: sum ? sum[0].toLowerCase() : null, note: undefined },
  };
}

async function checkPhp() {
  const active = require('./config').activePhp();
  const branch = active.split('.').slice(0, 2).join('.');
  const rel = await json('https://windows.php.net/downloads/releases/releases.json');
  const b = rel[branch];
  const latest = b ? b.version.replace(/-\d+$/, '') : null;
  const newerBranches = Object.keys(rel).filter((k) => cmp(k, branch) > 0).sort(cmp);
  const note = newerBranches.length
    ? { en: `A newer PHP line is available: ${newerBranches.join(', ')}. Try it with: ample php-add ${newerBranches.pop()} (your settings are carried over by php-use).`,
      ar: `يتوفر خط أحدث من PHP: ${newerBranches.join('، ')}. جرّبه بالأمر: ample php-add ${newerBranches[newerBranches.length - 1]} (ينقل php-use إعداداتك تلقائياً).` }
    : null;
  return { name: 'php', label: `PHP ${branch}`, current: active, latest, branch, note, comp: latest && cmp(latest, active) > 0 ? { version: latest } : null };
}

async function checkMariadb() {
  const c = components().mariadb;
  const series = c.version.split('.').slice(0, 2).join('.');
  const list = await json(`https://downloads.mariadb.org/rest-api/mariadb/${series}/`);
  const latest = Object.keys(list.releases || {}).sort(cmp).pop();
  if (!latest || cmp(latest, c.version) <= 0) return { name: 'mariadb', label: `MariaDB ${series} LTS`, current: c.version, latest };
  const files = (await json(`https://downloads.mariadb.org/rest-api/mariadb/${latest}/`)).release_data[latest].files;
  const f = files.find((x) => /winx64\.zip$/.test(x.file_name) && !/debug/i.test(x.file_name));
  return {
    name: 'mariadb', label: `MariaDB ${series} LTS`, current: c.version, latest,
    comp: { ...c, version: latest, url: f.file_download_url.replace(/^http:/, 'https:'), sha256: f.checksum.sha256sum, stripPrefix: f.file_name.replace(/\.zip$/, '') },
  };
}

async function checkPma() {
  const c = components().phpmyadmin;
  const v = (await json('https://www.phpmyadmin.net/home_page/version.json')).version;
  if (cmp(v, c.version) <= 0) return { name: 'phpmyadmin', label: 'phpMyAdmin', current: c.version, latest: v };
  const url = `https://files.phpmyadmin.net/phpMyAdmin/${v}/phpMyAdmin-${v}-all-languages.zip`;
  const sum = (await text(url + '.sha256').catch(() => '')).match(/\b[a-f0-9]{64}\b/i);
  return { name: 'phpmyadmin', label: 'phpMyAdmin', current: c.version, latest: v,
    comp: { ...c, version: v, url, sha256: sum ? sum[0] : null, stripPrefix: `phpMyAdmin-${v}-all-languages` } };
}

async function checkMailpit() {
  const c = components().mailpit;
  const r = await json('https://api.github.com/repos/axllent/mailpit/releases/latest');
  const v = r.tag_name.replace(/^v/, '');
  if (cmp(v, c.version) <= 0) return { name: 'mailpit', label: 'Mailpit', current: c.version, latest: v };
  const a = r.assets.find((x) => x.name === 'mailpit-windows-amd64.zip');
  return { name: 'mailpit', label: 'Mailpit', current: c.version, latest: v,
    comp: { ...c, version: v, url: a.browser_download_url, sha256: (a.digest || '').replace(/^sha256:/, '') || null } };
}

async function checkComposer() {
  const phar = P.p('bin', 'composer.phar');
  const r = spawnSync(path.join(P.phpRoot, require('./config').activePhp(), 'php.exe'), [phar, '--version', '--no-ansi'], { encoding: 'utf8' });
  const current = ((r.stdout || '').match(/Composer version (\S+)/) || [])[1] || null;
  const latest = (await json('https://getcomposer.org/versions')).stable[0].version;
  return { name: 'composer', label: 'Composer', current, latest, comp: current && cmp(latest, current) > 0 ? components().composer : null };
}

async function checkCacert() {
  const remote = (await text('https://curl.se/ca/cacert.pem.sha256')).match(/\b[a-f0-9]{64}\b/i)[0];
  const local = fs.existsSync(P.cacert) ? sha256File(P.cacert) : null;
  const date = fs.existsSync(P.cacert) ? fs.statSync(P.cacert).mtime.toISOString().slice(0, 10) : null;
  return { name: 'cacert', label: 'CA certificates', current: date, latest: local === remote ? date : 'newer', comp: local === remote ? null : components().cacert };
}

async function checkXdebug() {
  const X = require('./xdebug');
  const active = require('./config').activePhp();
  const info = X.installedInfo(active);
  if (!info) return { name: 'xdebug', label: 'Xdebug', current: null, latest: null, skip: true };
  const rel = await X.find(active);
  return { name: 'xdebug', label: 'Xdebug', current: info.version, latest: rel ? rel.version : null, comp: rel && cmp(rel.version, info.version) > 0 ? rel : null };
}

// The control panel's Electron: newest patch of the SAME major line (e.g. 45.x), which is where
// Electron publishes its security fixes. SHA-256 from the release's SHASUMS256.txt.
async function checkElectron() {
  const c = components().electron;
  if (!c) return { name: 'electron', skip: true };
  const major = c.version.split('.')[0];
  const label = `Electron ${major} (control panel)`;
  const rels = await json('https://api.github.com/repos/electron/electron/releases?per_page=100');
  const versions = rels.filter((r) => !r.prerelease && !r.draft && new RegExp(`^v${major}\\.\\d+\\.\\d+$`).test(r.tag_name))
    .map((r) => r.tag_name.slice(1)).sort(cmp);
  const latest = versions.pop() || c.version;
  if (cmp(latest, c.version) <= 0) return { name: 'electron', label, current: c.version, latest };
  const base = `https://github.com/electron/electron/releases/download/v${latest}`;
  const file = `electron-v${latest}-win32-x64.zip`;
  const sums = await text(`${base}/SHASUMS256.txt`);
  const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(file));
  const sha = line ? line.trim().split(/\s+/)[0].toLowerCase() : null;
  if (!sha) throw new Error(`no checksum for ${file} in SHASUMS256.txt`);
  return { name: 'electron', label, current: c.version, latest, comp: { ...c, version: latest, url: `${base}/${file}`, sha256: sha } };
}

// cloudflared ("ample share"): only checked once it has been downloaded.
async function checkCloudflared() {
  const c = components().cloudflared;
  if (!c || !fs.existsSync(P.p(c.dest))) return { name: 'cloudflared', skip: true };
  const r = await json('https://api.github.com/repos/cloudflare/cloudflared/releases/latest');
  const v = r.tag_name.replace(/^v/, '');
  if (cmp(v, c.version) <= 0) return { name: 'cloudflared', label: 'cloudflared (share)', current: c.version, latest: v };
  const a = r.assets.find((x) => x.name === 'cloudflared-windows-amd64.exe');
  return { name: 'cloudflared', label: 'cloudflared (share)', current: c.version, latest: v,
    comp: { ...c, version: v, url: a.browser_download_url, sha256: (a.digest || '').replace(/^sha256:/, '') || null } };
}

// AMPLE itself: announced on AMPLE's website (core/selfupdate.js). It is updated by running the new
// AMPLE Setup (the control panel does it in one click), not file by file like the components.
async function checkAmple() {
  const V = require('./version');
  const r = await require('./selfupdate').check();
  return {
    name: 'ample', label: 'AMPLE', current: V.short(r.current), latest: V.short(r.latest),
    comp: r.newer ? r.manifest : null, note: r.newer ? r.manifest.notes : null,
  };
}

const CHECKERS = { ample: checkAmple, apache: checkApache, php: checkPhp, mariadb: checkMariadb, phpmyadmin: checkPma,
  mailpit: checkMailpit, composer: checkComposer, cacert: checkCacert, xdebug: checkXdebug, electron: checkElectron,
  cloudflared: checkCloudflared };

// Is the control panel (electron\AMPLE.exe) open? Its files can't be replaced then.
function panelRunning() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq AMPLE.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  return /"AMPLE\.exe"/i.test(r.stdout || '');
}

async function check() {
  const out = [];
  for (const [name, fn] of Object.entries(CHECKERS)) {
    try { out.push(await fn()); } catch (e) { out.push({ name, label: name, error: e.message }); }
  }
  return out.filter((x) => !x.skip);
}

// ---- apply ---------------------------------------------------------------------

async function withService(name, fn) {
  const services = require('./services');
  const was = (await services.status(name)).running;
  if (was) await services.stop(name);
  try { return await fn(); } finally { if (was) await services.start(name).catch(() => {}); }
}

// Can the freshly installed version run on THIS PC? (Smart App Control blocks new
// unsigned releases until they are widely used.) Throws with .sac = true when blocked.
function verifyInstalled(key) {
  const { tryRun } = require('./check');
  const exe = {
    apache: [path.join(P.apache, 'bin', 'httpd.exe'), ['-v']],
    mailpit: [path.join(P.p('mailpit'), 'mailpit.exe'), ['version']],
    mariadb: [path.join(P.mariadb, 'bin', 'mariadbd.exe'), ['--version']],
  }[key];
  if (!exe) return;
  const r = tryRun(exe[0], exe[1]);
  if (r.blocked) throw Object.assign(new Error(`Windows Smart App Control blocked the new ${key} (${path.basename(exe[0])})`), { sac: true });
  if (!r.ok) throw new Error(`the new ${key} does not run (exit ${r.code}): ${r.out}`);
  // Apache: the config test loads every module (a single blocked module stops Apache).
  if (key === 'apache') {
    try { require('./services').SERVICES.apache.prepare(); } catch (e) {
      throw Object.assign(new Error(e.message.split('\n').slice(0, 2).join(' ')), { sac: /Application Control/i.test(e.message) });
    }
  }
}
const sacNote = (current) => ` Windows Smart App Control blocks brand-new unsigned releases for a few weeks; AMPLE stays on ${current}. Try "ample update" again later.`;

// Replace a zip-based component; roll back to the old version if it is blocked or won't start.
async function replaceComponent(key, newComp, serviceName, say) {
  const { install } = require('./download');
  const services = require('./services');
  const all = components();
  const oldComp = all[key];
  const was = serviceName ? (await services.status(serviceName)).running : false;
  if (serviceName && was) await services.stop(serviceName);

  await install(newComp.label || key, newComp, say);
  all[key] = newComp;
  saveComponents(all);
  try {
    verifyInstalled(key);
    if (serviceName && was) await services.start(serviceName);
    return { ok: true };
  } catch (e) {
    if (e.sac) e.message += sacNote(oldComp.version);
    say(`new version ${e.sac ? 'is blocked by Windows' : 'did not start'} (${e.message.split('\n')[0]}); rolling back to ${oldComp.version}`);
    await install(key, oldComp, say);
    all[key] = oldComp;
    saveComponents(all);
    if (serviceName && was) await services.start(serviceName).catch(() => {});
    log('Update', 'ROLLBACK', `${key} ${newComp.version} ${e.sac ? 'blocked by Smart App Control' : 'failed'}; back on ${oldComp.version}`, 'warn');
    return { ok: false, rolledBack: true, sac: !!e.sac, error: e.message };
  }
}

const APPLY = {
  async apache(r, say) { return replaceComponent('apache', r.comp, 'apache', say); },
  async mailpit(r, say) { return replaceComponent('mailpit', r.comp, 'mailpit', say); },
  async phpmyadmin(r, say) {
    const res = await replaceComponent('phpmyadmin', r.comp, null, say);
    require('./config').generate(); // rewrites phpmyadmin\config.inc.php
    return res;
  },

  // 1. stop  2. temporary copy of mariadb\data  3. new binaries (data preserved)
  // 4. start + mariadb-upgrade  5a. success: delete the copy
  // 5b. failure: old binaries + old manifest entry + data copy back, start again.
  async mariadb(r, say) {
    const services = require('./services');
    const { install } = require('./download');
    const oldComp = components().mariadb;
    const was = (await services.status('mariadb')).running;
    if (was) await services.stop('mariadb');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safety = path.join(P.ROOT, 'backups', `pre-update-mariadb-${stamp}`);
    say('copying mariadb\\data (temporary safety copy)');
    fs.cpSync(P.mysqlData, safety, { recursive: true });
    try {
      await install('MariaDB', r.comp, say);
      const all = components(); all.mariadb = r.comp; saveComponents(all);
      try { verifyInstalled('mariadb'); } catch (e) { if (e.sac) e.message += sacNote(r.current); throw e; }
      await services.start('mariadb');
      say('upgrading system tables (mariadb-upgrade)');
      const up = services.mariadbClient('mariadb-upgrade.exe', [], { timeout: 600000 });
      if (up.status !== 0) throw new Error((up.stderr || 'mariadb-upgrade failed').trim());
    } catch (e) {
      say(`MariaDB ${r.latest} failed (${e.message.split('\n')[0]}); restoring ${r.current} and your data`);
      await services.stop('mariadb').catch(() => {});
      await install('MariaDB', oldComp, say);
      const all = components(); all.mariadb = oldComp; saveComponents(all);
      fs.rmSync(P.mysqlData, { recursive: true, force: true });
      fs.cpSync(safety, P.mysqlData, { recursive: true });
      fs.rmSync(safety, { recursive: true, force: true });
      if (was) await services.start('mariadb').catch(() => {});
      log('Update', 'ROLLBACK', `MariaDB ${r.latest} failed; back on ${r.current} with the original data`, 'warn');
      return { ok: false, rolledBack: true, error: e.message };
    }
    fs.rmSync(safety, { recursive: true, force: true });
    const backups = path.dirname(safety);
    if (fs.existsSync(backups) && !fs.readdirSync(backups).length) fs.rmSync(backups, { recursive: true, force: true });
    if (!was) await services.stop('mariadb');
    return { ok: true };
  },

  // New PHP patch = new folder next to the old one; php-use carries every setting over.
  async php(r, say) {
    const { installPhpVersion } = require('./download');
    const phpini = require('./phpini');
    const v = await installPhpVersion(r.branch, say); // also records it in components.json
    // Smart switch: only use the new PHP if it runs AND every extension that works
    // now still loads (Smart App Control may block new unsigned DLLs for weeks).
    const { tryRun } = require('./check');
    const run = tryRun(path.join(P.phpRoot, v, 'php.exe'), ['-n', '-v'], phpini.envFor(path.join(P.phpRoot, v)));
    const wanted = phpini.wantedExtensions(r.current, settings.load());
    const nowOk = phpini.detectExtensions(r.current, wanted);
    const newRes = phpini.detectExtensions(v, wanted);
    const lost = wanted.filter((e) => nowOk[e] && nowOk[e].ok && !(newRes[e] && newRes[e].ok));
    if (run.blocked || !run.ok || lost.length) {
      const why = run.blocked ? 'php.exe is blocked by Windows' : !run.ok ? `php.exe does not run (exit ${run.code})`
        : `these extensions would stop working: ${lost.map((e) => `${e} (${newRes[e] ? newRes[e].reason : 'missing'})`).join(', ')}`;
      const sac = run.blocked || lost.some((e) => /Smart App Control/i.test((newRes[e] || {}).reason || ''));
      say(`not switching to PHP ${v}: ${why}`);
      log('Update', 'KEEP', `PHP ${r.current} kept; ${v} downloaded but not used: ${why}`, 'warn');
      return { ok: false, kept: true, sac, error: `PHP ${v} is installed in php\\${v} but not used: ${why}.${sac ? sacNote(r.current) : ''}` };
    }
    await require('./services').usePhp(v);
    say(`PHP ${v} is active; ${r.current} is kept in php\\${r.current} (switch back with: ample php-use ${r.current})`);
    return { ok: true };
  },

  async composer(r, say) {
    await require('./download').install('Composer', r.comp, say, { force: true });
    return { ok: true };
  },
  async cacert(r, say) {
    await require('./download').install('CA certificates', r.comp, say, { force: true });
    require('./config').generate();
    return { ok: true };
  },
  // Electron runs the control panel, so it can only be replaced while the panel is closed.
  async electron(r, say) {
    if (process.versions.electron || panelRunning()) {
      return { ok: false, kept: true, error: 'The control panel is open. Close it, then run: ample update electron' };
    }
    await require('./download').install('Electron (control panel)', r.comp, say);
    const all = components(); all.electron = r.comp; saveComponents(all);
    require('./panel').prepare(); // electron.exe -> AMPLE.exe + the link to control\panel
    return { ok: true };
  },
  async cloudflared(r, say) {
    if (require('./share').status().active) return { ok: false, kept: true, error: 'A site is being shared. Stop sharing first: ample share stop' };
    await require('./download').install('cloudflared', r.comp, say, { force: true });
    const all = components(); all.cloudflared = r.comp; saveComponents(all);
    return { ok: true };
  },
  async xdebug(r, say) {
    const X = require('./xdebug');
    const active = require('./config').activePhp();
    fs.rmSync(X.dllPath(active), { force: true });
    fs.rmSync(path.join(P.phpRoot, active, '.ample', 'xdebug.json'), { force: true });
    await withService('apache', () => X.ensure(active, say));
    return { ok: true };
  },
};

async function apply(names, say = () => {}) {
  const results = await check();
  const out = [];
  for (const r of results) {
    if (!names.includes('all') && !names.includes(r.name)) continue;
    if (r.error) { out.push({ name: r.name, ok: false, error: r.error }); continue; }
    if (!r.comp) { out.push({ name: r.name, ok: true, skipped: 'up to date' }); continue; }
    if (r.name === 'ample') {
      say(`AMPLE ${r.latest} is available: update it from the control panel (Settings → Updates), or download AMPLE Setup ${r.latest} from ample.himacode.com`);
      out.push({ name: 'ample', ok: true, skipped: 'install the new AMPLE Setup' });
      continue;
    }
    say(`${r.label}: ${r.current} -> ${r.latest}`);
    try {
      const res = await APPLY[r.name](r, (m) => say(`  ${m}`));
      log('Update', 'DONE', `${r.label} ${r.current} -> ${r.latest}${res.rolledBack ? ' (rolled back)' : ''}`);
      out.push({ name: r.name, from: r.current, to: r.latest, ...res });
    } catch (e) {
      log('Update', 'ERROR', `${r.label}: ${e.message}`, 'error');
      out.push({ name: r.name, ok: false, error: e.message });
    }
  }
  return out;
}

module.exports = { check, apply, vcRuntime, cmp, replaceComponent, panelRunning };
