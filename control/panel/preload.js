'use strict';
// AMPLE control panel: the ONLY bridge between the page and AMPLE. The page gets
// window.ample with these functions and nothing else (no Node, no files, no processes).
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('ample', {
  status: call('ample:status'),        // services + active PHP
  problems: call('ample:problems'),    // Log Doctor: problems in the last 24 h
  start: call('ample:start'),          // (name)  apache | mariadb | mailpit
  stop: call('ample:stop'),
  restart: call('ample:restart'),
  startAll: call('ample:startAll'),
  stopAll: call('ample:stopAll'),
  doctor: call('ample:doctor'),        // (hours) 24 | 72 | 168: problems, solved ones marked
  doctorFix: call('ample:doctorFix'),  // (scanId, n): apply problem n's automatic fix
  clearLogs: call('ample:clearLogs'),  // empty every log file
  getSettings: call('ample:getSettings'),      // language, appearance, design, PATH
  setLanguage: call('ample:setLanguage'),      // ('en' | 'ar')
  setAppearance: call('ample:setAppearance'),  // ('system' | 'dark' | 'light')
  setDesign: call('ample:setDesign'),          // ('phpmyadmin' | 'mailpit', 'ample' | 'original')
  setPath: call('ample:setPath'),              // (true | false)
  getPorts: call('ample:getPorts'),
  setPorts: call('ample:setPorts'),            // ({ mysql: 3307, ... })
  changePassword: call('ample:changePassword'),// (newPassword)
  checkPc: call('ample:checkPc'),              // "ample check"
  fixDefender: call('ample:fixDefender'),      // Windows asks for administrator
  updatesCheck: call('ample:updatesCheck'),
  updatesApply: call('ample:updatesApply'),    // (['php', ...] | ['all'])
  ampleUpdate: call('ample:ampleUpdate'),      // download the new AMPLE Setup (SHA-256 checked) and run it
  panelUpdate: call('ample:panelUpdate'),      // update Electron: the panel closes, a helper updates it and reopens it
  notifyUpdates: call('ample:notifyUpdates'),  // (count, ['AMPLE', 'PHP'], { version, note } | null) a Windows notification
  onGoto: (cb) => { ipcRenderer.on('ample:goto', (_e, page) => cb(String(page))); },  // the notification was clicked
  // Progress of a long task: cb({ kind, text, pct, read, total }) (plain values only).
  onProgress: (cb) => { ipcRenderer.on('ample:progress', (_e, p) => cb(p)); },
  databases: call('ample:databases'),          // MariaDB info, databases, backups
  dbCreate: call('ample:dbCreate'),            // (name)
  dbBackup: call('ample:dbBackup'),            // (['shop'] | 'all')
  dbRestore: call('ample:dbRestore'),          // (backup file NAME)
  rescue: call('ample:rescue'),
  openDb: call('ample:openDb'),                // (name) in phpMyAdmin
  pickImportFile: call('ample:pickImportFile'),// Windows' "Open" box -> { name, bytes } | null
  dbImport: call('ample:dbImport'),            // (target database or '') imports the chosen file
  sites: call('ample:sites'),                  // sites, invalid folders, own hosts, HTTPS
  siteCreate: call('ample:siteCreate'),        // (name)
  siteRename: call('ample:siteRename'),        // (folder, newName)
  sitesApply: call('ample:sitesApply'),        // restart Apache for new hosts
  httpsSet: call('ample:httpsSet'),            // (true | false)
  httpsTrust: call('ample:httpsTrust'),
  httpsUntrust: call('ample:httpsUntrust'),
  openSite: call('ample:openSite'),            // (name, 'http' | 'https' | 'folder')
  php: call('ample:php'),                      // active + installed versions, main settings, Xdebug
  phpExtensions: call('ample:phpExtensions'),
  phpAvailable: call('ample:phpAvailable'),    // lines on windows.php.net
  phpUse: call('ample:phpUse'),                // (version)
  phpCompare: call('ample:phpCompare'),        // (version) report only
  phpAdd: call('ample:phpAdd'),                // ('8.4')
  phpIniSet: call('ample:phpIniSet'),          // ({ memory_limit: '512M', ... })
  phpExtSet: call('ample:phpExtSet'),          // (name, true | false)
  xdebugSet: call('ample:xdebugSet'),          // (true | false)
  copy: call('ample:copy'),                    // (text) to the clipboard
  mail: call('ample:mail'),                    // Mailpit: latest messages
  mailTest: call('ample:mailTest'),            // send a test email
  mailClear: call('ample:mailClear'),          // delete every message
  openMail: call('ample:openMail'),            // (message id) in Mailpit
  shareStatus: call('ample:shareStatus'),      // { active, site, url, password, installed }
  shareInstall: call('ample:shareInstall'),    // download cloudflared (first use)
  shareStart: call('ample:shareStart'),        // (site, password | '')
  shareStop: call('ample:shareStop'),
  openShare: call('ample:openShare'),          // (the trycloudflare.com link) in the browser
  xamppInventory: call('ample:xamppInventory'),// XAMPP found? its databases and projects
  xamppPick: call('ample:xamppPick'),          // Windows' folder box -> inventory | null
  xamppImport: call('ample:xamppImport'),      // (dbNames, copyProjects, password)
  getStartup: call('ample:getStartup'),        // start with Windows, services on open, safe shutdown, shortcuts
  setStartup: call('ample:setStartup'),        // (key, true | false)
  setShortcut: call('ample:setShortcut'),      // ('desktop' | 'start', true | false)
  firstRunDone: call('ample:firstRunDone'),    // the welcome screen is completed
  open: call('ample:open'),            // localhost | phpmyadmin | mailpit | htdocs | logs | backups | phpinfo
  openLog: call('ample:openLog'),      // (name)
});
