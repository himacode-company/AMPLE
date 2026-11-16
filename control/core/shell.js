'use strict';
// Command-line integration: the bin\ folder of small launchers (php, composer,
// mysql, ...) that always point at AMPLE's active versions, and adding that
// folder to the user's PATH (no administrator rights needed).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('./paths');
const { log } = require('./logger');

const BIN = P.p('bin');
const MARKER = '.ample-bin'; // identifies an AMPLE bin folder (also an old one after moving AMPLE)

// name -> target relative to the AMPLE root ({php} = active PHP folder). args = fixed leading args.
function launchers(phpVersion) {
  const php = `php/${phpVersion}/php.exe`;
  return {
    php: { target: php },
    composer: { target: php, args: ['bin/composer.phar'] },
    mysql: { target: 'mariadb/bin/mariadb.exe' },
    mariadb: { target: 'mariadb/bin/mariadb.exe' },
    mysqldump: { target: 'mariadb/bin/mariadb-dump.exe' },
    'mariadb-dump': { target: 'mariadb/bin/mariadb-dump.exe' },
    mysqladmin: { target: 'mariadb/bin/mariadb-admin.exe' },
    // Through the root ample.cmd, which picks the portable Node.js when present.
    ample: { target: 'ample.cmd' },
  };
}

// Write bin\<name>.cmd (CMD, PowerShell) and bin\<name> (Git Bash).
function writeLaunchers(phpVersion) {
  fs.mkdirSync(BIN, { recursive: true });
  fs.writeFileSync(path.join(BIN, MARKER), 'AMPLE launchers. This folder can be added to PATH: ample path add\n');
  for (const [name, l] of Object.entries(launchers(phpVersion))) {
    const win = (p) => `"%~dp0..\\${p.replace(/\//g, '\\')}"`;
    const winLine = [l.external ? l.target : win(l.target), ...(l.args || []).map(win), '%*'].join(' ');
    fs.writeFileSync(path.join(BIN, `${name}.cmd`),
      `@echo off\r\nrem AMPLE launcher (generated). Runs: ${l.target}\r\n${winLine}\r\n`);

    const sh = (p) => `"$here/../${p}"`;
    // Git Bash can't exec a .cmd directly; run it through cmd.exe.
    const shTarget = l.target.endsWith('.cmd') ? `cmd.exe //c ${sh(l.target)}` : l.external ? l.target : sh(l.target);
    const shLine = ['exec', shTarget, ...(l.args || []).map(sh), '"$@"'].join(' ');
    fs.writeFileSync(path.join(BIN, name),
      `#!/bin/sh\n# AMPLE launcher (generated) for Git Bash. Runs: ${l.target}\nhere="$(cd "$(dirname "$0")" && pwd)"\n${shLine}\n`);
  }
}

// ---- PATH (user level, HKCU\Environment) -------------------------------------

function ps(script, env = {}) {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
  if (r.status !== 0) throw new Error((r.stderr || 'PowerShell failed').trim());
  return r.stdout;
}

// Raw user PATH, without expanding %VARIABLES% (so we never break them).
function readUserPath() {
  return ps("(Get-Item 'HKCU:\\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')").replace(/\r?\n$/, '');
}
function readSystemPath() {
  return ps("[Environment]::GetEnvironmentVariable('Path', 'Machine')").replace(/\r?\n$/, '');
}

function writeUserPath(value) {
  // Keep the registry type ExpandString, then broadcast the change to Windows
  // (setting and clearing a dummy variable through .NET sends WM_SETTINGCHANGE).
  ps("Set-ItemProperty -Path 'HKCU:\\Environment' -Name Path -Value $env:AMPLE_NEW_PATH -Type ExpandString; " +
    "[Environment]::SetEnvironmentVariable('AMPLE_PATH_REFRESH', '1', 'User'); " +
    "[Environment]::SetEnvironmentVariable('AMPLE_PATH_REFRESH', $null, 'User')", { AMPLE_NEW_PATH: value });
}

const norm = (p) => path.resolve(p.replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')).toLowerCase().replace(/\\+$/, '');
const isOurs = (entry) => norm(entry) === norm(BIN);
// An AMPLE bin folder from an older location (e.g. before moving AMPLE to C:\ample).
const isStaleAmple = (entry) => !isOurs(entry) && (fs.existsSync(path.join(entry, MARKER)) ||
  (!fs.existsSync(entry) && /[\\/](ample|phsql)[\\/]bin$/i.test(entry)));

// Folders in PATH (before ours) that also contain php/mysql/composer: they would win.
function conflicts(entries) {
  const out = [];
  for (const e of entries) {
    if (isOurs(e)) break;
    for (const exe of ['php.exe', 'mysql.exe', 'mariadb.exe', 'composer.bat', 'composer']) {
      try { if (fs.existsSync(path.join(e.replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''), exe))) out.push({ dir: e, exe }); } catch { /* ignore */ }
    }
  }
  return out;
}

function pathStatus() {
  const user = readUserPath().split(';').filter(Boolean);
  const system = readSystemPath().split(';').filter(Boolean);
  const inUser = user.some(isOurs);
  // Windows puts the SYSTEM path before the USER path.
  const effective = [...system, ...user];
  return {
    bin: BIN,
    added: inUser,
    stale: user.filter(isStaleAmple),
    systemConflicts: conflicts(system),               // can't be overridden from the user PATH
    userConflicts: inUser ? conflicts(user) : [],      // before ours in the user PATH
    otherPhp: effective.filter((e) => !isOurs(e) && fs.existsSync(path.join(e, 'php.exe'))),
  };
}

function pathAdd() {
  const entries = readUserPath().split(';').filter(Boolean);
  const kept = entries.filter((e) => !isOurs(e) && !isStaleAmple(e));
  const removed = entries.filter((e) => isStaleAmple(e));
  writeUserPath([BIN, ...kept].join(';'));
  log('Shell', 'PATH', `added ${BIN} to the front of the user PATH${removed.length ? `; removed old: ${removed.join(', ')}` : ''}`);
  return { removed, ...pathStatus() };
}

function pathRemove() {
  const entries = readUserPath().split(';').filter(Boolean);
  const kept = entries.filter((e) => !isOurs(e) && !isStaleAmple(e));
  writeUserPath(kept.join(';'));
  log('Shell', 'PATH', `removed ${BIN} from the user PATH`);
  return pathStatus();
}

// What a NEW terminal will run for `name` (fresh PATH from the registry).
function whichInNewTerminal(name) {
  const env = { ...process.env, PATH: `${readSystemPath()};${readUserPath().replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')}` };
  const r = spawnSync('where.exe', [name], { encoding: 'utf8', env, windowsHide: true });
  return (r.stdout || '').split(/\r?\n/).filter(Boolean);
}

module.exports = { BIN, writeLaunchers, pathStatus, pathAdd, pathRemove, whichInNewTerminal };
