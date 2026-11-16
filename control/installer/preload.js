'use strict';
// AMPLE Setup: the only bridge between the page and the installer.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('setup', {
  defaults: call('setup:defaults'),          // { target, version, check }
  pickFolder: call('setup:pickFolder'),      // Windows' folder box -> { target, check } | null
  install: call('setup:install'),            // ('me' | 'all') copy + download everything
  xamppDetect: call('setup:xamppDetect'),    // XAMPP found? its databases / projects
  xamppPick: call('setup:xamppPick'),        // Windows' folder box -> inventory | null
  xamppImport: call('setup:xamppImport'),    // (dbNames, copyProjects, password)
  finish: call('setup:finish'),              // ({ desktop, start, path, windows, https })
  finishUpdate: call('setup:finishUpdate'),  // after an update: start the services, record the version
  open: call('setup:open'),                  // open AMPLE, close setup
  quit: call('setup:quit'),
  // progress: cb({ event: 'step' | 'log', id, state, pct, detail, text })
  onEvent: (cb) => { ipcRenderer.on('setup:event', (_e, m) => cb(m)); },
});
