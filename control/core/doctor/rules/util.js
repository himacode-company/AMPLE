'use strict';
// Helpers shared by the Log Doctor rules.

// 134217728 -> "128 MB"
function human(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return String(bytes);
  if (n >= 1024 ** 3) return `${+(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// Next sensible memory/upload size above `bytes`, as a php.ini value.
function nextSize(bytes) {
  const mb = Number(bytes) / 1024 ** 2;
  for (const s of [256, 512, 1024, 2048, 4096]) if (s > mb) return s >= 1024 ? `${s / 1024}G` : `${s}M`;
  return '4G';
}

// Which PHP extension provides a function / class.
const FUNCTION_EXT = [
  [/^mysqli_/i, 'mysqli'], [/^mb_/i, 'mbstring'], [/^curl_/i, 'curl'], [/^gmp_/i, 'gmp'],
  [/^(image|getimagesize|gd_)/i, 'gd'], [/^zip_/i, 'zip'], [/^sodium_/i, 'sodium'], [/^exif_/i, 'exif'],
  [/^openssl_/i, 'openssl'], [/^(intl|grapheme_|idn_|numfmt_|collator_|locale_|msgfmt_|normalizer_)/i, 'intl'],
  [/^ftp_/i, 'ftp'], [/^socket_/i, 'sockets'], [/^(gettext|ngettext|dgettext|textdomain|bindtextdomain)$/i, 'gettext'],
  [/^(finfo_|mime_content_type)/i, 'fileinfo'], [/^bz/i, 'bz2'], [/^tidy_/i, 'tidy'], [/^xsl_/i, 'xsl'],
  [/^(shmop_)/i, 'shmop'], [/^(soap_)/i, 'soap'], [/^(pg_)/i, 'pgsql'], [/^(ldap_)/i, 'ldap'],
];
const CLASS_EXT = {
  ziparchive: 'zip', collator: 'intl', numberformatter: 'intl', intldateformatter: 'intl', normalizer: 'intl',
  locale: 'intl', messageformatter: 'intl', transliterator: 'intl', finfo: 'fileinfo', soapclient: 'soap',
  soapserver: 'soap', xsltprocessor: 'xsl', sqlite3: 'sqlite3', mysqli: 'mysqli', tidy: 'tidy',
};
function extForFunction(fn) {
  const name = String(fn).split('\\').pop();
  const hit = FUNCTION_EXT.find(([re]) => re.test(name));
  return hit ? hit[1] : null;
}
function extForClass(cls) {
  return CLASS_EXT[String(cls).split('\\').pop().toLowerCase()] || null;
}

// "C:\...\htdocs\shop\index.php" -> "htdocs\shop\index.php" (shorter, readable)
function shortPath(file, root) {
  if (!file) return null;
  const f = String(file).replace(/\//g, '\\');
  const r = String(root).replace(/\//g, '\\').replace(/\\$/, '') + '\\';
  return f.toLowerCase().startsWith(r.toLowerCase()) ? f.slice(r.length) : f;
}

module.exports = { human, nextSize, extForFunction, extForClass, shortPath };
