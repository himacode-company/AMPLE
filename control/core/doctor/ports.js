'use strict';
// Who is using a port, and what that program is, in plain words (EN + AR).
const { execFileSync } = require('child_process');

function run(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 8000, windowsHide: true }); } catch { return ''; }
}

// The program file of a process. Win32_Process.ExecutablePath is empty for a program that runs
// with MORE rights (started "as administrator"); QueryFullProcessImageName with the smallest
// access right still works across that line, so AMPLE can recognise its own programs.
function imagePath(pid) {
  const ps = 'Add-Type -Namespace AmpleW -Name K -MemberDefinition \''
    + '[DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool b, int c);'
    + '[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, int f, System.Text.StringBuilder s, ref int n);'
    + '[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);\'; '
    + `$h = [AmpleW.K]::OpenProcess(0x1000, $false, ${Number(pid)}); `
    + 'if ($h -ne [IntPtr]::Zero) { $sb = New-Object System.Text.StringBuilder 1024; $n = 1024; '
    + 'if ([AmpleW.K]::QueryFullProcessImageName($h, 0, $sb, [ref]$n)) { $sb.ToString() }; [void][AmpleW.K]::CloseHandle($h) }';
  return run('powershell', ['-NoProfile', '-Command', ps]).trim();
}

// The process that started this one ({ pid, name } or null), e.g. Apache's parent httpd.exe.
function parentOf(pid) {
  const out = run('powershell', ['-NoProfile', '-Command',
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { $q = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; if ($q) { "$($q.ProcessId)|$($q.Name)" } }`]).trim();
  const [p, name] = out.split('|');
  return Number(p) ? { pid: Number(p), name: name || '' } : null;
}

// { pid, name, services: [], path, elevated, ample } or null
//   elevated: the program runs with more rights than AMPLE (its path was only readable the long way)
//   ample:    the program is one of AMPLE's own (its file is inside the AMPLE folder)
function inspect(port) {
  const net = run('netstat', ['-ano', '-p', 'TCP']);
  const m = net.match(new RegExp(`^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'im'));
  if (!m) return null;
  const pid = Number(m[1]);
  const csv = run('tasklist', ['/svc', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  const cols = (csv.trim().split(/\r?\n/)[0] || '').match(/"([^"]*)"/g) || [];
  const name = pid === 4 ? 'System' : (cols[0] || '"unknown"').replace(/"/g, '');
  const svc = (cols[2] || '').replace(/"/g, '');
  const services = svc && svc !== 'N/A' ? svc.split(',').map((x) => x.trim()) : [];
  let exe = '', elevated = false;
  if (pid > 4) {
    exe = run('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ExecutablePath`]).trim();
    if (!exe) { exe = imagePath(pid); elevated = !!exe; }
  }
  const root = require('../paths').ROOT.toLowerCase() + '\\';
  return { pid, name, services, path: exe, elevated, ample: !!exe && exe.toLowerCase().startsWith(root) };
}

// Known port users -> explanation + how to free the port.
const KNOWN = [
  {
    // AMPLE's own Apache / Mailpit / MariaDB, left running by an earlier start: not "another program"
    test: (i) => i.ample,
    who: { en: 'AMPLE\'s own {name}, still running from an earlier start ({path}).', ar: 'برنامج {name} الخاص بـ AMPLE نفسه، ما زال يعمل من تشغيل سابق ({path}).' },
    how: { en: 'Press Start (or Restart) again: AMPLE stops its old copy and starts it fresh. Windows may ask for permission once if it was started by AMPLE Setup.', ar: 'اضغط Start (أو Restart) مرة أخرى: يوقف AMPLE نسخته القديمة ويشغّلها من جديد. قد يطلب Windows الإذن مرة واحدة إذا كان AMPLE Setup هو من شغّلها.' },
  },
  {
    test: (i) => i.pid === 4,
    who: { en: 'Windows itself (the HTTP.sys driver). Usually IIS ("World Wide Web Publishing Service"), Web Deploy, or SQL Server Reporting Services.', ar: 'ويندوز نفسه (برنامج التشغيل HTTP.sys). غالباً يكون السبب IIS (خدمة "World Wide Web Publishing Service") أو Web Deploy أو SQL Server Reporting Services.' },
    how: { en: 'Open services.msc and stop + disable "World Wide Web Publishing Service" (W3SVC), or run as administrator: net stop W3SVC', ar: 'افتح services.msc وأوقف الخدمة "World Wide Web Publishing Service" (W3SVC) واجعلها معطّلة، أو نفّذ كمسؤول: net stop W3SVC' },
  },
  {
    test: (i) => /xampp/i.test(i.path),
    who: { en: 'XAMPP is still running ({name}).', ar: 'برنامج XAMPP ما زال يعمل ({name}).' },
    how: { en: 'Stop it from the XAMPP Control Panel (and uncheck "Svc" if it runs as a service).', ar: 'أوقفه من لوحة تحكم XAMPP (وألغِ تحديد "Svc" إذا كان يعمل كخدمة).' },
  },
  {
    test: (i) => /wamp/i.test(i.path) || /wampapache|wampmysqld|wampmariadb/i.test(i.services.join(' ')),
    who: { en: 'WampServer is running ({name}).', ar: 'برنامج WampServer يعمل ({name}).' },
    how: { en: 'Right-click the WampServer tray icon → Exit.', ar: 'انقر بزر الفأرة الأيمن على أيقونة WampServer بجانب الساعة ← Exit.' },
  },
  {
    test: (i) => /^(mysqld|mariadbd)\.exe$/i.test(i.name),
    who: { en: (i) => `Another database server (${i.name}${i.services.length ? `, Windows service "${i.services[0]}"` : ''}). Often installed by MySQL Installer or another dev tool.`, ar: (i) => `خادم قاعدة بيانات آخر (${i.name}${i.services.length ? `، خدمة ويندوز "${i.services[0]}"` : ''}). غالباً ثبّته MySQL Installer أو أداة تطوير أخرى.` },
    how: { en: (i) => (i.services.length ? `Open services.msc → "${i.services[0]}" → Stop, and set Startup type to Manual.` : 'Close the program that started it.'), ar: (i) => (i.services.length ? `افتح services.msc ← "${i.services[0]}" ← Stop، واجعل Startup type يدوياً (Manual).` : 'أغلق البرنامج الذي شغّله.') },
  },
  {
    test: (i) => /^httpd\.exe$/i.test(i.name),
    who: { en: 'Another Apache web server ({path}).', ar: 'خادم Apache آخر ({path}).' },
    how: { en: 'Stop the other Apache (or the tool that started it).', ar: 'أوقف خادم Apache الآخر (أو الأداة التي شغّلته).' },
  },
  {
    test: (i) => /^(mailpit|mailhog)(\.exe)?$/i.test(i.name) || /^(mailpit|mailhog)/i.test(i.name),
    who: { en: 'Another {name}, probably one you installed yourself (it uses the same ports as AMPLE\'s Mailpit).', ar: 'نسخة أخرى من {name}، غالباً ثبّتها بنفسك (وهي تستخدم منافذ Mailpit الخاص بـ AMPLE نفسها).' },
    how: { en: 'Close it (Task Manager → {name}) and use AMPLE\'s Mailpit at http://localhost/mailpit/, or give AMPLE other ports.', ar: 'أغلقه (مدير المهام ← {name}) واستخدم Mailpit الخاص بـ AMPLE على http://localhost/mailpit/، أو امنح AMPLE منافذ أخرى.' },
  },
  {
    test: (i) => /^(skype|teams|ms-teams)\.exe$/i.test(i.name),
    who: { en: '{name} (it can use ports 80 and 443).', ar: 'برنامج {name} (قد يستخدم المنفذين 80 و 443).' },
    how: { en: 'Close it, or in its settings turn off "use port 80 and 443".', ar: 'أغلقه، أو عطّل خيار "استخدام المنفذين 80 و 443" من إعداداته.' },
  },
  {
    test: (i) => /^vmware/i.test(i.name),
    who: { en: 'VMware (shared virtual machines service).', ar: 'برنامج VMware (خدمة مشاركة الأجهزة الافتراضية).' },
    how: { en: 'Stop the "VMware Workstation Server" service in services.msc, or change its port in VMware → Preferences → Shared VMs.', ar: 'أوقف خدمة "VMware Workstation Server" من services.msc، أو غيّر منفذها من VMware ← Preferences ← Shared VMs.' },
  },
  {
    test: (i) => /^(com\.docker|docker|wslrelay|vpnkit)/i.test(i.name),
    who: { en: 'Docker / WSL: a container is publishing this port.', ar: 'Docker أو WSL: هناك حاوية (container) تستخدم هذا المنفذ.' },
    how: { en: 'Stop the container (docker ps, then docker stop <name>).', ar: 'أوقف الحاوية (docker ps ثم docker stop <الاسم>).' },
  },
  {
    test: (i) => /^(nginx|node|php|java|python)\.exe$/i.test(i.name),
    who: { en: 'A development server ({name}) you may have started yourself.', ar: 'خادم تطوير ({name}) ربما شغّلته بنفسك.' },
    how: { en: 'Stop it in its terminal (Ctrl+C) or end it in Task Manager.', ar: 'أوقفه من نافذة الطرفية الخاصة به (Ctrl+C) أو أنهِه من مدير المهام.' },
  },
];

const fill = (t, i) => (typeof t === 'function' ? t(i) : t)
  .replace(/\{name\}/g, i.name).replace(/\{path\}/g, i.path || i.name);

// { who: {en, ar}, how: {en, ar} } for an inspect() result.
function describe(info) {
  const k = KNOWN.find((x) => x.test(info));
  if (k) return { who: { en: fill(k.who.en, info), ar: fill(k.who.ar, info) }, how: { en: fill(k.how.en, info), ar: fill(k.how.ar, info) } };
  return {
    who: { en: `${info.name}${info.path ? ` (${info.path})` : ''}`, ar: `${info.name}${info.path ? ` (${info.path})` : ''}` },
    how: { en: `Close ${info.name}, or end PID ${info.pid} in Task Manager.`, ar: `أغلق ${info.name}، أو أنهِ العملية رقم ${info.pid} من مدير المهام.` },
  };
}

module.exports = { inspect, describe, imagePath, parentOf };
