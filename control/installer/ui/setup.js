'use strict';
// AMPLE Setup page: 1 install → 2 import from XAMPP? → 3 import → 4 options → ready.
// Every value goes into the page as plain text (textContent).
(function () {
  const api = window.setup;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sizeText = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  const SCREENS = ['install', 'ask', 'import', 'options', 'done'];
  const TITLES = {
    install: ['Welcome to AMPLE', 'We\'ll set everything up in a few minutes'],
    ask: ['Import from XAMPP', 'Bring your databases and projects along'],
    import: ['Import from XAMPP', 'Choose what to copy into AMPLE'],
    options: ['Almost done', 'A few choices, all can be changed later in Settings'],
    done: ['Welcome to AMPLE', 'Everything is installed'],
  };
  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.dataset.screen !== name;
    $('title').textContent = TITLES[name][0];
    $('subtitle').textContent = TITLES[name][1];
    const idx = Math.min(3, SCREENS.indexOf(name));
    document.querySelectorAll('.dots span').forEach((d, i) => d.classList.toggle('on', i <= idx));
  }

  // ---- 1. install --------------------------------------------------------------------------------
  let checkOk = false, installedOk = false;
  // install: a new AMPLE · update: an older AMPLE is here · same: this version is here (repair)
  // newer: a newer AMPLE is here (setup does not go back)
  let mode = 'install', VERSION = '1.0.0', from = null;
  const shortV = (v) => (v ? String(v).replace(/\.0$/, '') : '?');
  function setLocation(target, check) {
    $('loc').value = target;
    const hint = $('loc-hint');
    checkOk = check.ok;
    hint.textContent = !check.ok ? check.reason : '';
    hint.classList.toggle('bad', !check.ok);
    $('install-go').disabled = !check.ok;
    applyMode(check.ok ? (check.mode || 'install') : 'install', check.installed, target);
  }
  function applyMode(m, installed, target) {
    mode = m; from = installed;
    const upd = mode !== 'install';
    $('upd-card').hidden = !upd;
    $('loc-card').hidden = upd;
    document.querySelector('.dots').hidden = upd;
    const card = $('upd-card');
    card.classList.toggle('same', mode === 'same');
    card.classList.toggle('newer', mode === 'newer');
    $('upd-from').textContent = shortV(installed);
    $('upd-to').textContent = shortV(VERSION);
    const go = $('install-go');
    if (mode === 'update') {
      TITLES.install = ['Update AMPLE', `A new version of AMPLE is ready to install`];
      $('upd-text').textContent = `AMPLE in ${target} will be updated to ${shortV(VERSION)}. Your projects, databases, emails and settings are kept.`;
      go.textContent = 'Update';
    } else if (mode === 'same') {
      TITLES.install = ['AMPLE is installed', `AMPLE ${shortV(VERSION)} is already on this PC`];
      $('upd-text').textContent = `AMPLE ${shortV(VERSION)} is already installed in ${target}. Repair copies its files again; your projects, databases, emails and settings are kept.`;
      go.textContent = 'Repair';
    } else if (mode === 'newer') {
      TITLES.install = ['A newer AMPLE is installed', `This setup has AMPLE ${shortV(VERSION)}`];
      $('upd-text').textContent = `AMPLE ${shortV(installed)} is already installed in ${target}. It is newer than this setup (${shortV(VERSION)}), so nothing needs to be done.`;
      go.textContent = 'Close';
    } else {
      TITLES.install = ['Welcome to AMPLE', 'We\'ll set everything up in a few minutes'];
      go.textContent = 'Install';
    }
    $('upd-note').hidden = mode === 'newer';
    if (!document.querySelector('.screen[data-screen="install"]').hidden) show('install');
  }
  $('upd-elsewhere').addEventListener('click', async () => {
    const r = await api.pickFolder();
    if (r) setLocation(r.target, r.check);
  });

  api.onEvent((m) => {
    if (m.event === 'log') { onLog(m.text); return; }
    const row = document.querySelector(`.step[data-step="${m.id}"]`);
    if (!row) return;
    row.classList.remove('run', 'ok', 'fail');
    row.classList.add(m.state);
    if (m.detail) row.querySelector('small').textContent = '· ' + m.detail;
    const pct = row.querySelector('.pct');
    if (m.state === 'run' && m.pct != null) { row.querySelector('.bar i').style.width = m.pct + '%'; pct.textContent = m.pct + '%'; }
    if (m.state !== 'run') pct.textContent = '';
  });

  $('loc-change').addEventListener('click', async () => {
    const r = await api.pickFolder();
    if (r) setLocation(r.target, r.check);
  });
  $('install-cancel').addEventListener('click', () => api.quit());
  const scope = () => (document.querySelector('input[name="scope"]:checked') || {}).value || 'me';
  for (const r of document.querySelectorAll('input[name="scope"]')) {
    r.addEventListener('change', () => { $('scope-warn').hidden = scope() !== 'all'; });
  }
  $('install-go').addEventListener('click', async () => {
    if (mode === 'newer') { api.quit(); return; }
    if (installedOk) { goAsk(); return; }
    const go = $('install-go');
    const updating = mode === 'update' || mode === 'same';
    go.disabled = true; go.classList.add('busy'); go.textContent = mode === 'update' ? 'Updating…' : mode === 'same' ? 'Repairing…' : 'Installing…';
    $('loc-change').disabled = true; $('install-cancel').disabled = true; $('upd-elsewhere').disabled = true;
    for (const r of document.querySelectorAll('input[name="scope"]')) r.disabled = true;
    $('install-error').hidden = true;
    try {
      await api.install(scope());
      if (updating) {
        // an update needs no XAMPP or option pages: start AMPLE again and say so
        go.textContent = 'Starting AMPLE…';
        const r = await api.finishUpdate();
        TITLES.done = mode === 'update' ? ['AMPLE is updated', `Now AMPLE ${shortV(VERSION)}`] : ['AMPLE is repaired', `AMPLE ${shortV(VERSION)}`];
        $('done-title').textContent = mode === 'update' ? `Updated to AMPLE ${shortV(VERSION)}` : `AMPLE ${shortV(VERSION)} is repaired`;
        $('done-text').textContent = 'Your projects, databases and settings are kept. Apache, MariaDB and Mailpit are running.';
        $('done-notes').textContent = r && r.notes && r.notes.length ? 'Notes: ' + r.notes.join(' · ') : '';
        go.classList.remove('busy');
        show('done');
        document.querySelector('.dots').hidden = true;
        return;
      }
      installedOk = true;
      go.textContent = 'Continue';
      go.disabled = false;
    } catch (e) {
      for (const row of document.querySelectorAll('.step.run')) { row.classList.remove('run'); row.classList.add('fail'); }
      const msg = String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      const failed = document.querySelector('.step.fail b');
      const box = $('install-error');
      // say what really went wrong: a file in use, the internet, or something else
      const locked = /EBUSY|EPERM|EACCES|busy or locked|Still running from the AMPLE folder/i.test(msg);
      const network = /fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket|network|HTTP \d{3}/i.test(msg);
      const hint = locked
        ? 'A file in the AMPLE folder is in use. Close the AMPLE control panel and anything started from the AMPLE folder (for example a terminal running php or composer), then press "Try again".'
        : network
          ? 'Check your internet connection, then press "Try again": what is already done is not downloaded again.'
          : 'Press "Try again": what is already done is not downloaded again.';
      box.replaceChildren(
        el('b', null, failed ? `${failed.textContent} could not be installed` : 'Setup could not finish'),
        document.createTextNode(hint),
        el('code', null, msg),
      );
      box.hidden = false;
      go.textContent = 'Try again';
      go.disabled = false;
      $('install-cancel').disabled = false;
      $('upd-elsewhere').disabled = false;
    }
    go.classList.remove('busy');
  });

  // ---- 2. import from XAMPP? -----------------------------------------------------------------
  let inv = null;
  async function goAsk() {
    show('ask');
    $('ask-yes').disabled = true;
    try { inv = await api.xamppDetect(); } catch { inv = { found: false }; }
    if (inv.found) {
      $('ask-text').textContent = `XAMPP was found in ${inv.root} (${inv.databases.length} database(s) of yours, ${inv.projects.length} project(s)). Do you want to import them into AMPLE?`;
      $('ask-yes').disabled = false;
      $('ask-pick').hidden = true;
    } else {
      $('ask-text').textContent = 'XAMPP was not found in C:\\xampp. If it is somewhere else, choose its folder (or its mysql\\data folder).';
      $('ask-pick').hidden = false;
    }
  }
  $('ask-skip').addEventListener('click', () => show('options'));
  $('ask-pick').addEventListener('click', async () => {
    try { const r = await api.xamppPick(); if (r) { inv = r; $('ask-pick').hidden = true; $('ask-text').textContent = `XAMPP was found in ${inv.root} (${inv.databases.length} database(s), ${inv.projects.length} project(s)). Import them?`; $('ask-yes').disabled = !inv.found; } }
    catch (e) { $('ask-text').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  });
  $('ask-yes').addEventListener('click', () => { sel = new Set(inv.databases.filter((d) => !d.existsInAmple).map((d) => d.name)); show('import'); renderImport(); });

  // ---- 3. import ---------------------------------------------------------------------------------
  let sel = new Set(), importing = false, imported = false;
  const log = [];
  function onLog(text) {
    if (!importing) return;
    log.push(text);
    const box = $('xa-log');
    box.hidden = false;
    box.textContent = log.slice(-200).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  function renderImport() {
    $('xa-loc').value = inv.data || inv.root;
    $('xa-warn').hidden = !inv.mysqlRunning;
    $('xa-recheck').hidden = !inv.mysqlRunning || imported;
    const choosable = inv.databases.filter((d) => !d.existsInAmple);
    $('xa-count').textContent = `${sel.size} of ${choosable.length} selected`;
    $('xa-all').disabled = importing || imported || sel.size === choosable.length;
    $('xa-none').disabled = importing || imported || !sel.size;
    $('xa-list').replaceChildren(...inv.databases.map((d) => {
      const row = el('label', 'xa-db' + (d.existsInAmple ? ' off' : ''));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !d.existsInAmple && sel.has(d.name);
      cb.disabled = d.existsInAmple || importing || imported;
      cb.addEventListener('change', () => { if (cb.checked) sel.add(d.name); else sel.delete(d.name); renderImport(); });
      row.append(cb, el('b', null, d.name), el('small', null, d.existsInAmple ? 'already in AMPLE' : sizeText(d.size)));
      return row;
    }));
    const newProjects = inv.projects.filter((p) => !p.exists).length;
    $('xa-projects-row').hidden = !newProjects;
    $('xa-projects-text').textContent = `Also copy ${newProjects} project(s) from XAMPP's htdocs`;
    $('xa-projects').disabled = importing || imported;
    const go = $('xa-go');
    if (imported) { go.textContent = 'Continue'; go.disabled = false; $('xa-skip').hidden = true; $('xa-change').disabled = true; return; }
    go.textContent = importing ? 'Importing…' : 'Import';
    go.classList.toggle('busy', importing);
    go.disabled = importing || (!sel.size && !$('xa-projects').checked) || (inv.mysqlRunning && sel.size > 0);
    $('xa-skip').disabled = importing;
    $('xa-change').disabled = importing;
  }
  $('xa-all').addEventListener('click', () => { sel = new Set(inv.databases.filter((d) => !d.existsInAmple).map((d) => d.name)); renderImport(); });
  $('xa-none').addEventListener('click', () => { sel.clear(); renderImport(); });
  $('xa-projects').addEventListener('change', renderImport);
  $('xa-skip').addEventListener('click', () => show('options'));
  $('xa-change').addEventListener('click', async () => {
    try { const r = await api.xamppPick(); if (r) { inv = r; sel = new Set(inv.databases.filter((d) => !d.existsInAmple).map((d) => d.name)); renderImport(); } } catch { /* keep */ }
  });
  $('xa-recheck').addEventListener('click', async () => { try { inv = await api.xamppDetect(); renderImport(); } catch { /* keep */ } });

  function askPassword() {
    return new Promise((resolve) => {
      $('pw').hidden = false;
      $('pw-input').value = '';
      $('pw-input').focus();
      const done = (v) => { $('pw').hidden = true; $('pw-ok').onclick = null; $('pw-cancel').onclick = null; resolve(v); };
      $('pw-ok').onclick = () => done($('pw-input').value);
      $('pw-cancel').onclick = () => done(null);
    });
  }

  $('xa-go').addEventListener('click', async () => {
    if (imported) { show('options'); return; }
    importing = true; log.length = 0; $('xa-results').replaceChildren();
    renderImport();
    let password = '', r = null, error = null;
    for (;;) {
      try { r = await api.xamppImport([...sel], $('xa-projects').checked, password); } catch (e) { error = e; break; }
      if (!r.needPassword) break;
      const pw = await askPassword();
      if (pw === null) { r = null; break; }
      password = pw;
    }
    importing = false;
    const rows = [];
    const ICON = { imported: ['ok', '✓', 'imported'], partial: ['warn', '!', 'partly imported'], failed: ['bad', '✕', 'not imported'], skipped: ['info', 'i', 'skipped (exists in AMPLE)'] };
    if (error) rows.push(resRow('bad', '✕', String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), ''));
    if (r && r.databases) for (const d of r.databases) {
      const ic = ICON[d.status] || ICON.failed;
      rows.push(resRow(ic[0], ic[1], `${d.db} · ${ic[2]}`, d.status === 'imported' || d.status === 'partial' ? `${d.tablesAfter} / ${d.tablesBefore} tables` : (d.error || '')));
    }
    if (r && r.projects && r.projects.length) rows.push(resRow('ok', '✓', `Projects copied: ${r.projects.join(', ')}`, ''));
    $('xa-results').replaceChildren(...rows);
    if (r) imported = true;
    renderImport();
  });
  function resRow(kind, icon, text, side) {
    const row = el('div', 'res');
    row.append(el('span', 'ic ' + kind, icon), el('span', null, text));
    if (side) row.appendChild(el('small', null, side));
    return row;
  }

  // ---- 4. options + finish --------------------------------------------------------------------------
  for (const s of document.querySelectorAll('[data-opt]')) {
    s.addEventListener('click', () => s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true')));
  }
  $('finish-go').addEventListener('click', async () => {
    const go = $('finish-go');
    go.disabled = true; go.classList.add('busy'); go.textContent = 'Finishing…';
    for (const s of document.querySelectorAll('[data-opt]')) s.disabled = true;
    const opts = {};
    for (const s of document.querySelectorAll('[data-opt]')) opts[s.dataset.opt] = s.getAttribute('aria-checked') === 'true';
    try {
      const r = await api.finish(opts);
      $('done-notes').textContent = r.notes && r.notes.length ? 'Notes: ' + r.notes.join(' · ') : '';
      show('done');
    } catch (e) {
      $('finish-error').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      $('finish-error').hidden = false;
      go.disabled = false; go.textContent = 'Finish';
    }
    go.classList.remove('busy');
  });
  $('done-open').addEventListener('click', () => api.open());

  // ---- start ----------------------------------------------------------------------------------
  (async () => {
    const d = await api.defaults();
    if (d.version) VERSION = d.version;
    setLocation(d.target, d.check);
    const v = d.versions || {};
    if (v.apache) $('v-apache').textContent = 'Apache ' + v.apache;
    if (v.php) $('v-php').textContent = 'PHP ' + v.php;
    if (v.mariadb) $('v-mariadb').textContent = 'MariaDB ' + v.mariadb;
    if (v.phpmyadmin) $('v-phpmyadmin').textContent = 'phpMyAdmin ' + v.phpmyadmin;
    if (v.mailpit) $('v-mailpit').textContent = 'Mailpit ' + v.mailpit;
    show('install');
  })();
})();
