'use strict';
// Compare two PHP versions as they REALLY run (not just their php.ini files),
// using the current version as the reference, and fix the new one to match.
//
//   1. snapshot the reference version: every setting value + every loaded extension
//   2. generate php.ini for the target version and snapshot it the same way
//   3. diff: missing extensions, different values, removed settings, new things
//   4. fix: enable missing extensions, keep the reference values
//      (stored in ample.json -> phpVersions[target], marked carriedFrom)
//   5. snapshot again to verify nothing is left
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const settings = require('./settings');
const config = require('./config');
const phpini = require('./phpini');
const { log } = require('./logger');

const SNAPSHOT = 'echo json_encode(['
  + '"ini" => ini_get_all(null, false),'
  + '"ext" => array_map("strtolower", get_loaded_extensions()),'
  + '"zend" => array_map("strtolower", get_loaded_extensions(true))'
  + ']);';

function snapshot(version) {
  // PHP 8.6+ refuses to start on an older Visual C++ runtime: say it clearly, before anything else.
  const vc = require('./vcredist');
  const need = vc.neededByPhpDir(phpini.phpDirOf(version));
  const st = vc.enough(need);
  if (need && !st.ok) throw vc.error(vc.message(`PHP ${version}`, need, st.have));
  const gen = config.generatePhpIni(version);
  const r = phpini.runPhp(version, ['-c', gen.iniFile, '-d', 'display_startup_errors=0', '-r', SNAPSHOT]);
  const line = (r.stdout || '').trim().split(/\r?\n/).pop();
  let data;
  try { data = JSON.parse(line); } catch {
    const why = vc.explain(`${r.stderr || ''}${r.stdout || ''}`, `PHP ${version}`);
    if (why) throw vc.error(why);
    throw new Error(`Could not read PHP ${version}'s configuration:\n${(r.stderr || r.stdout || '').trim()}`);
  }
  return {
    version,
    ini: data.ini || {},
    ext: new Set([...(data.ext || []), ...(data.zend || [])]),
    startup: gen.startupMessages,
    skippedSettings: gen.skippedSettings,
  };
}

// The snapshot runs command-line PHP, which forces these values regardless of
// php.ini (and the forcing differs between versions). They don't affect your
// site under Apache, so comparing them would only show false differences.
const CLI_FORCED = new Set([
  'display_errors', 'register_argc_argv', 'html_errors', 'implicit_flush',
  'output_buffering', 'max_execution_time', 'max_input_time',
]);

// Values Xdebug changes while it is loaded (it switches off OPcache's optimizer so
// the debugger sees the real code). Copying them would keep PHP slow after
// "ample xdebug off", so they are never compared.
const XDEBUG_AFFECTED = (key) => key.startsWith('xdebug.') || key === 'opcache.optimization_level';

// A value that points into one PHP folder can't be copied to another version.
function versionBoundValue(key, value, base) {
  if (phpini.VERSION_BOUND.has(key) || CLI_FORCED.has(key) || XDEBUG_AFFECTED(key)) return true;
  const dir = P.fwd(phpini.phpDirOf(base.version)).toLowerCase();
  const val = P.fwd(String(value ?? '')).toLowerCase();
  return val.includes(dir) || val.includes(`\\php\\${base.version}`) || val.includes(`/php/${base.version}`);
}

// Managed by AMPLE itself (ample xdebug on/off, built-in OPcache), not copied between versions.
const MANAGED_EXT = new Set(['xdebug', 'zend opcache', 'opcache']);

function diff(base, target) {
  const targetDir = phpini.phpDirOf(target.version);
  const missingExt = [], removedExt = [], newExt = [];
  for (const e of base.ext) {
    if (target.ext.has(e) || MANAGED_EXT.has(e)) continue;
    const dll = path.join(targetDir, 'ext', `php_${e.replace(/^zend /, '')}.dll`);
    if (fs.existsSync(dll)) missingExt.push(e);
    else removedExt.push(e);
  }
  for (const e of target.ext) if (!base.ext.has(e) && !MANAGED_EXT.has(e)) newExt.push(e);

  const changed = [], removedSettings = [], newSettings = [];
  for (const [k, v] of Object.entries(base.ini)) {
    if (!(k in target.ini)) {
      // Settings of an extension that is itself missing are reported with the extension.
      const owner = k.split('.')[0].toLowerCase();
      if (!removedExt.includes(owner) && !missingExt.includes(owner)) removedSettings.push({ key: k, value: v });
      continue;
    }
    const tv = target.ini[k];
    if (String(tv ?? '') === String(v ?? '')) continue;
    if (versionBoundValue(k, v, base)) continue;
    changed.push({ key: k, from: tv, to: v });
  }
  for (const [k, v] of Object.entries(target.ini)) if (!(k in base.ini)) newSettings.push({ key: k, value: v });

  const same = Object.keys(base.ini).filter((k) => k in target.ini && String(target.ini[k] ?? '') === String(base.ini[k] ?? '')).length;
  return { missingExt, removedExt, newExt, changed, removedSettings, newSettings, same };
}

// Compare `baseVersion` (reference) with `targetVersion`.
// apply=false: report only. apply=true: fix the target and verify.
function compare(baseVersion, targetVersion, { apply = false } = {}) {
  if (baseVersion === targetVersion) throw new Error('Pick two different PHP versions to compare.');
  const base = snapshot(baseVersion);
  const target = snapshot(targetVersion);
  const before = diff(base, target);

  const report = {
    base: baseVersion, target: targetVersion, applied: false,
    fixedExt: [], fixedSettings: [],
    ...before,
    deprecated: target.skippedSettings,
    startup: target.startup,
  };
  if (!apply || (!before.missingExt.length && !before.changed.length)) return report;

  // Save fixes as per-version settings for the target.
  const s = settings.load();
  const per = s.phpVersions[targetVersion] || {};
  const ini = { ...(per.ini || {}) };
  for (const c of before.changed) ini[c.key] = c.to ?? '';
  const enable = new Set([...((per.extensions || {}).enable || []), ...before.missingExt.map((e) => e.replace(/^zend /, ''))]);
  s.phpVersions[targetVersion] = {
    carriedFrom: baseVersion,
    ini,
    extensions: { enable: [...enable], disable: (per.extensions || {}).disable || [] },
  };
  settings.save(s);

  // Verify: what is still different after the fix?
  const after = diff(base, snapshot(targetVersion));
  const stillChanged = new Set(after.changed.map((c) => c.key));
  const stillMissing = new Set(after.missingExt);
  report.applied = true;
  report.fixedSettings = before.changed.filter((c) => !stillChanged.has(c.key));
  report.fixedExt = before.missingExt.filter((e) => !stillMissing.has(e));
  report.changed = after.changed;       // could not be fixed
  report.missingExt = after.missingExt; // could not be enabled
  report.same = after.same;

  log('PHP', 'COMPARE', `${baseVersion} -> ${targetVersion}: fixed ${report.fixedSettings.length} setting(s) + ` +
    `${report.fixedExt.length} extension(s); ${report.removedExt.length} extension(s) and ` +
    `${report.removedSettings.length} setting(s) not available in ${targetVersion}`);
  return report;
}

// Human-readable report (used by the CLI; the panel renders the object itself).
function format(r) {
  const out = [];
  out.push(`PHP ${r.base} → ${r.target}  (reference: ${r.base})`);
  out.push(`  ✅ ${r.same} settings identical`);
  for (const c of r.fixedSettings) out.push(`  🔧 ${c.key}: ${show(c.from)} → ${show(c.to)}  (kept ${r.base} value)`);
  for (const e of r.fixedExt) out.push(`  🔧 extension ${e} enabled (was on in ${r.base})`);
  if (!r.applied) {
    for (const c of r.changed) out.push(`  ≠  ${c.key}: ${r.target} has ${show(c.from)}, ${r.base} has ${show(c.to)}  (would keep ${r.base} value)`);
    for (const e of r.missingExt) out.push(`  ≠  extension ${e} is off in ${r.target}  (would enable)`);
  } else {
    for (const c of r.changed) out.push(`  ❌ ${c.key}: could not keep ${show(c.to)}, ${r.target} uses ${show(c.from)}`);
    for (const e of r.missingExt) out.push(`  ❌ extension ${e} could not be enabled`);
  }
  for (const e of r.removedExt) out.push(`  ❌ extension ${e} does not exist in PHP ${r.target}`);
  for (const s of r.removedSettings) out.push(`  ❌ setting ${s.key} does not exist in PHP ${r.target} (was ${show(s.value)})`);
  for (const d of r.deprecated) out.push(`  ⚠️  ${d.key}: ${d.reason}, left out of php.ini`);
  for (const m of r.startup) out.push(`  ⚠️  startup: ${m}`);
  for (const e of r.newExt) out.push(`  ➕ extension ${e} is new/extra in ${r.target}`);
  for (const s of r.newSettings) out.push(`  ➕ setting ${s.key} = ${show(s.value)} is new in ${r.target}`);
  return out.join('\n');
}
const show = (v) => (v === null || v === undefined || v === '' ? '(empty)' : JSON.stringify(String(v)));

module.exports = { compare, snapshot, diff, format };
