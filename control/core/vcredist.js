'use strict';
// Microsoft Visual C++ runtime (vcruntime140.dll): Apache and PHP need it, and newer
// builds need a newer one. PHP 8.6+ is built with Visual Studio 2026 (toolset 14.5x)
// and refuses to start on an older runtime:
//   "VCRUNTIME140.dll 14.40 is not compatible with this PHP build linked with 14.51"
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Microsoft's permalink for the LATEST supported v14 runtime (Visual Studio 2017-2026).
// (The old aka.ms/vs/17/... link stays on 14.4x, which is too old for VS 2026 builds.)
const URL = 'https://aka.ms/vc14/vc_redist.x64.exe';
const VS_NEEDS = { 17: '14.30', 18: '14.50' }; // build toolset (vs17/vs18) -> minimum runtime

const cmp = (a, b) => {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// Installed runtime, e.g. "14.40" (null = not installed).
function installed() {
  const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64', '/v', 'Version'], { encoding: 'utf8', windowsHide: true });
  const m = (r.stdout || '').match(/v?(\d+)\.(\d+)\./);
  return m ? `${m[1]}.${m[2]}` : null;
}

// Linker version a DLL/EXE was built with ("14.51"), read from its PE header.
// PHP refuses to start when the runtime is older than this.
function linkedWith(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (buf.toString('latin1', 0, 2) !== 'MZ') return null;
    const pe = buf.readUInt32LE(0x3c);
    if (pe + 28 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
    const opt = pe + 24; // optional header: magic(2), major linker(1), minor linker(1)
    return `${buf[opt + 2]}.${buf[opt + 3]}`;
  } catch { return null; }
}

// Runtime an installed PHP folder needs, by its toolset: linked with 14.5x
// (Visual Studio 2026) -> "14.50", 14.3x/14.4x (VS 2022) -> "14.30". null if unknown.
// (PHP 8.5, linked with 14.44, runs fine on runtime 14.40; PHP 8.6, linked with
// 14.51, does not.) If PHP still complains, explain() turns its error into the same message.
function neededByPhpDir(dir) {
  for (const f of ['php8ts.dll', 'php8.dll', 'php.exe']) {
    const v = linkedWith(path.join(dir, f));
    if (v && cmp(v, '14.0') >= 0) return cmp(v, '14.50') >= 0 ? VS_NEEDS[18] : VS_NEEDS[17];
  }
  return null;
}

// Runtime a build toolset needs (17 -> "14.30", 18 -> "14.50").
const neededByVs = (vs) => VS_NEEDS[Number(vs)] || '14.50';

// { ok, have, need } for a needed version.
function enough(need) {
  const have = installed();
  return { ok: !need || (!!have && cmp(have, need) >= 0), have, need };
}

// "PHP 8.6 needs Visual C++ 14.50+ (you have 14.40)" in en + ar.
function message(what, need, have) {
  return {
    en: `${what} needs the Microsoft Visual C++ runtime ${need} or newer (${have ? `you have ${have}` : 'it is not installed'}). ` +
      'Install it with one click from the PHP page ("Install Visual C++"), or run: ample vc install',
    ar: `يحتاج ${what} إلى مكتبة Microsoft Visual C++ بإصدار ${need} أو أحدث (${have ? `لديك ${have}` : 'غير مثبتة لديك'}). ` +
      'ثبّتها بضغطة واحدة من صفحة PHP (زر "ثبّت Visual C++")، أو نفّذ: ample vc install',
  };
}

// Is this PHP/Apache output the "runtime too old" error?
// PHP prints: 'C:\WINDOWS\SYSTEM32\VCRUNTIME140.dll' 14.40 is not compatible with this PHP build linked with 14.51
const VC_ERROR_RE = /VCRUNTIME140(?:_1)?\.dll['"]?\s+([\d.]+)\s+is not compatible with this PHP build linked with\s+([\d.]+)/i;
const isVcError = (text) => VC_ERROR_RE.test(String(text || ''));
// The error itself, rewritten as a clear en + ar message (null if it isn't one).
function explain(text, what = 'This PHP version') {
  const m = String(text || '').match(VC_ERROR_RE);
  if (!m) return null;
  const short = (v) => v.split('.').slice(0, 2).join('.');
  return message(what, short(m[2]), short(m[1]));
}
// An Error carrying both languages + a flag the panel uses to offer the install button.
function error(msg) {
  return Object.assign(new Error(msg.en), { vc: true, ar: msg.ar });
}

// Download the latest runtime from Microsoft, check Microsoft signed it, install it
// (Windows asks for permission). Returns { before, after, code }.
async function install(say = () => {}) {
  const before = installed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ample-vc-'));
  const exe = path.join(dir, 'vc_redist.x64.exe');
  try {
    say('Downloading the Visual C++ runtime from Microsoft...');
    const res = await fetch(URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Could not download the Visual C++ runtime (HTTP ${res.status})`);
    fs.writeFileSync(exe, Buffer.from(await res.arrayBuffer()));
    // Run it only if Microsoft really signed it.
    const sig = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$s = Get-AuthenticodeSignature '${exe.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: 'utf8', windowsHide: true });
    if (!/^Valid\|.*O=Microsoft Corporation/.test((sig.stdout || '').trim())) {
      throw new Error('The downloaded Visual C++ installer is not signed by Microsoft; it was not run.');
    }
    say('Signed by Microsoft. Windows asks for permission...');
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `try { $p = Start-Process '${exe.replace(/'/g, "''")}' -ArgumentList '/install','/passive','/norestart' -Verb RunAs -Wait -PassThru; $p.ExitCode } catch { 'cancelled' }`],
    { encoding: 'utf8', windowsHide: true });
    const out = (r.stdout || '').trim();
    if (/cancelled/.test(out)) throw new Error('Windows did not get permission (the box was cancelled), so Visual C++ was not installed.');
    const code = Number(out.split(/\r?\n/).pop());
    // 0 = done, 3010 = done (restart recommended), 1638 = a newer one is already installed
    if (![0, 3010, 1638].includes(code)) throw new Error(`The Visual C++ installer failed (exit code ${out || r.status}).`);
    const after = installed();
    return { before, after, code, restart: code === 3010 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { URL, VS_NEEDS, cmp, installed, linkedWith, neededByPhpDir, neededByVs, enough, message, isVcError, explain, error, install };
