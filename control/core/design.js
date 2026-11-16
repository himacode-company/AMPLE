'use strict';
// "ample design": AMPLE's look or the original look, for phpMyAdmin and Mailpit separately.
// AMPLE's design is added by Apache (control/pma/*); no phpMyAdmin or Mailpit file is ever
// changed, so 'original' simply stops adding it: the tools are then exactly as shipped.
const settings = require('./settings');
const { log } = require('./logger');

const TOOLS = { phpmyadmin: 'phpMyAdmin', mailpit: 'Mailpit' };
const VALUES = ['ample', 'original'];

function get() {
  const d = settings.load().design;
  return { phpmyadmin: d.phpmyadmin === 'original' ? 'original' : 'ample', mailpit: d.mailpit === 'original' ? 'original' : 'ample' };
}

// tool: 'phpmyadmin' | 'mailpit' | 'all'   value: 'ample' | 'original'
async function set(tool, value) {
  const tools = tool === 'all' ? Object.keys(TOOLS) : [tool];
  for (const t of tools) if (!TOOLS[t]) throw new Error(`Unknown tool "${tool}". Use: phpmyadmin, mailpit or all`);
  if (!VALUES.includes(value)) throw new Error(`Unknown design "${value}". Use: ample or original`);

  const before = get();
  const patch = {};
  for (const t of tools) patch[t] = value;
  settings.update({ design: patch });
  const changed = tools.filter((t) => before[t] !== value);

  // Apache adds (or not) AMPLE's files: new config, and a restart if it is running.
  const services = require('./services');
  let restarted = false;
  if (changed.length) {
    if ((await services.status('apache')).running) { await services.restart('apache'); restarted = true; }
    else require('./config').generate();
    log('Design', 'SET', `${changed.map((t) => TOOLS[t]).join(' + ')}: ${value} design`);
  }
  return { design: get(), changed, restarted };
}

module.exports = { get, set, TOOLS, VALUES };
