'use strict';
// Trusted local HTTPS for https://localhost and https://NAME.localhost
//
// A local certificate authority (CA) is created once per PC. It is restricted with
// X.509 Name Constraints to localhost / *.localhost / 127.x / ::1, so even if its key
// were stolen it could NOT be used to fake a certificate for a real website.
// Files live in apache\conf\ssl\ (kept when Apache is upgraded).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const P = require('./paths');
const { log } = require('./logger');

const DIR = path.join(P.apache, 'conf', 'ssl');
const F = {
  caKey: path.join(DIR, 'ample-ca.key'),
  caCrt: path.join(DIR, 'ample-ca.crt'),
  key: path.join(DIR, 'sites.key'),
  crt: path.join(DIR, 'sites.crt'),
  names: path.join(DIR, 'sites.names'),
  phpBundle: path.join(DIR, 'php-cacert.pem'),
};
const OPENSSL = path.join(P.apache, 'bin', 'openssl.exe');

function openssl(args, cnf) {
  const env = { ...process.env, OPENSSL_CONF: cnf || path.join(DIR, 'openssl.cnf') };
  const r = spawnSync(OPENSSL, args, { encoding: 'utf8', env, windowsHide: true, timeout: 60000 });
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

function writeCnf() {
  fs.mkdirSync(DIR, { recursive: true });
  const cnf = path.join(DIR, 'openssl.cnf');
  fs.writeFileSync(cnf, [
    '[req]', 'distinguished_name = dn', 'prompt = no', '',
    '[dn]', 'CN = AMPLE Local Development CA', 'O = AMPLE (this PC only)', '',
    '[v3_ca]',
    'basicConstraints = critical, CA:TRUE, pathlen:0',
    'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    // The safety net: this CA may only sign certificates for local names.
    'nameConstraints = critical, permitted;DNS:localhost, permitted;DNS:.localhost, ' +
      'permitted;IP:127.0.0.0/255.0.0.0, permitted;IP:0:0:0:0:0:0:0:1/FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF',
    '',
  ].join('\n'));
  return cnf;
}

function ensureCA() {
  if (fs.existsSync(F.caKey) && fs.existsSync(F.caCrt)) return false;
  const cnf = writeCnf();
  openssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', F.caKey, '-out', F.caCrt, '-days', '3650', '-sha256', '-extensions', 'v3_ca', '-config', cnf], cnf);
  log('HTTPS', 'CA', 'created the local AMPLE certificate authority (limited to localhost names)');
  return true;
}

const expiresInDays = (crt) => {
  try { return (new Date(new crypto.X509Certificate(fs.readFileSync(crt)).validTo) - Date.now()) / 86400000; } catch { return -1; }
};

// One certificate for localhost + every site. Renewed when sites change or it is near expiry.
function ensureSiteCert(hosts) {
  ensureCA();
  const names = ['localhost', ...hosts].sort();
  const want = names.join(',');
  const current = fs.existsSync(F.names) ? fs.readFileSync(F.names, 'utf8') : '';
  if (current === want && fs.existsSync(F.crt) && expiresInDays(F.crt) > 30) return false;

  const cnf = writeCnf();
  const csr = path.join(DIR, 'sites.csr');
  const ext = path.join(DIR, 'sites.ext');
  fs.writeFileSync(ext, [
    'basicConstraints = CA:FALSE',
    'keyUsage = critical, digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
    `subjectAltName = ${[...names.map((n) => `DNS:${n}`), 'IP:127.0.0.1', 'IP:0:0:0:0:0:0:0:1'].join(', ')}`,
    '',
  ].join('\n'));
  openssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', F.key, '-out', csr, '-subj', '/CN=localhost/O=AMPLE'], cnf);
  // 825 days: the longest validity Apple platforms accept.
  openssl(['x509', '-req', '-in', csr, '-CA', F.caCrt, '-CAkey', F.caKey, '-CAcreateserial',
    '-out', F.crt, '-days', '825', '-sha256', '-extfile', ext], cnf);
  fs.rmSync(csr, { force: true });
  fs.rmSync(ext, { force: true });
  fs.writeFileSync(F.names, want);
  log('HTTPS', 'CERT', `site certificate for: ${names.join(', ')}`);
  return true;
}

// PHP trusts the public CAs (cacert.pem) AND the AMPLE CA, so curl to https://x.localhost works.
function phpCaBundle() {
  if (!fs.existsSync(F.caCrt) || !fs.existsSync(P.cacert)) return P.cacert;
  fs.writeFileSync(F.phpBundle, fs.readFileSync(P.cacert, 'utf8').trimEnd() + '\n\nAMPLE Local Development CA\n' + fs.readFileSync(F.caCrt, 'utf8'));
  return F.phpBundle;
}

function thumbprint() {
  if (!fs.existsSync(F.caCrt)) return null;
  return new crypto.X509Certificate(fs.readFileSync(F.caCrt)).fingerprint.replace(/:/g, '').toUpperCase();
}

function ps(script) {
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true });
}

function isTrusted() {
  const tp = thumbprint();
  if (!tp) return false;
  const r = ps(`[bool](Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object Thumbprint -eq '${tp}')`);
  return /True/.test(r.stdout || '');
}

// Adds the CA to the CURRENT USER's trusted roots. Windows shows a confirmation
// dialog that the user must accept; no administrator rights are needed.
function trust() {
  ensureCA();
  if (isTrusted()) return { already: true };
  const r = spawnSync('certutil', ['-user', '-addstore', 'Root', F.caCrt], { encoding: 'utf8' });
  const ok = isTrusted();
  log('HTTPS', 'TRUST', ok ? 'AMPLE CA trusted for this Windows user' : `trust was not completed: ${(r.stdout || r.stderr || '').trim().split(/\r?\n/).pop()}`);
  return { already: false, ok };
}

function untrust() {
  const tp = thumbprint();
  if (!tp) return false;
  spawnSync('certutil', ['-user', '-delstore', 'Root', tp], { encoding: 'utf8' });
  log('HTTPS', 'TRUST', 'AMPLE CA removed from this Windows user\'s trusted roots');
  return !isTrusted();
}

function info() {
  return {
    ca: fs.existsSync(F.caCrt), trusted: isTrusted(), thumbprint: thumbprint(),
    cert: fs.existsSync(F.crt), certDaysLeft: Math.floor(expiresInDays(F.crt)),
    names: fs.existsSync(F.names) ? fs.readFileSync(F.names, 'utf8').split(',') : [],
  };
}

module.exports = { ensureCA, ensureSiteCert, phpCaBundle, trust, untrust, isTrusted, info, F, DIR };
