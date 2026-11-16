'use strict';
// Change AMPLE's ports by hand: "ample port mysql 3307" or the control panel's Settings.
// (Log Doctor's one-click fix picks a free port by itself: doctor/actions.js "ports.change".)
const net = require('net');
const settings = require('./settings');
const config = require('./config');
const { log } = require('./logger');

// ample.json "ports" keys and the services that must restart when one changes.
// Apache also uses Mailpit's ports (PHP's mail settings, the /mailpit/ address).
const NEEDS = {
  http: ['apache'], https: ['apache'], mysql: ['mariadb'],
  smtp: ['mailpit', 'apache'], mailpit: ['mailpit', 'apache'],
};

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

function get() {
  const s = settings.load();
  return { ports: { ...s.ports }, https: !!s.https };
}

// patch: { mysql: 3307, http: 8080, ... }  Nothing is saved unless every check passes.
async function set(patch) {
  const services = require('./services');
  const s = settings.load();
  const next = { ...s.ports };
  const changed = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (!NEEDS[key]) throw new Error(`Unknown port "${key}". Use: ${Object.keys(NEEDS).join(', ')}`);
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`The ${key} port must be a whole number from 1 to 65535 (got "${value}")`);
    if (n !== s.ports[key]) { next[key] = n; changed.push(key); }
  }
  if (!changed.length) return { changed: [], restarted: [] };

  // Two services on one port would block each other.
  const inUse = Object.entries(next).filter(([k]) => k !== 'https' || s.https);
  for (const key of changed) {
    const twin = inUse.find(([other, p]) => other !== key && p === next[key]);
    if (twin) throw new Error(`Port ${next[key]} is already set for ${twin[0]}`);
  }
  // The new port must be free now.
  for (const key of changed) {
    if (await portFree(next[key])) continue;
    const who = services.whoUsesPort(next[key]);
    throw new Error(`Port ${next[key]} is already used by ${who ? `${who.name} (PID ${who.pid})` : 'another program'}`);
  }

  settings.update({ ports: Object.fromEntries(changed.map((k) => [k, next[k]])) });
  log('Ports', 'SET', changed.map((k) => `${k} ${s.ports[k]} -> ${next[k]}`).join(', '));

  const affected = new Set(changed.flatMap((k) => NEEDS[k]));
  const restarted = [];
  for (const name of services.ORDER) {
    if (!affected.has(name)) continue;
    if ((await services.status(name)).running) { await services.restart(name); restarted.push(name); }
  }
  config.generate(); // phpMyAdmin, php.ini and httpd.conf always show the new ports
  return { changed: changed.map((k) => ({ key: k, from: s.ports[k], to: next[k] })), restarted };
}

module.exports = { get, set, NEEDS };
