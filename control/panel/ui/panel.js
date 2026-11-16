'use strict';
// AMPLE control panel page. Talks to AMPLE only through window.ample (preload.js).
// Every value is put in the page as plain text (textContent), never as HTML.
// Every text comes from i18n.js: t('key').
(function () {
  const api = window.ample;
  const { t, setLang } = window.AMPLE_I18N;
  const $ = (id) => document.getElementById(id);
  const STATUS_MS = 3000;     // services
  const PROBLEMS_MS = 30000;  // Log Doctor (reads the logs: less often)

  const state = {
    data: null,          // last status from AMPLE
    problems: 0,
    busy: {},            // name -> 'start' | 'stop' | 'restart'
    allBusy: null,       // 'start' | 'stop' while Start all / Stop all runs
    errors: {},          // name -> { message, diagnosis } of the last failed action
  };

  // ---- small DOM helpers ------------------------------------------------------------------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick, { disabled = false, busy = false } = {}) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : '') + (busy ? ' busy' : ''), text);
    b.disabled = disabled || busy;
    b.addEventListener('click', onClick);
    return b;
  }
  let toastTimer = null;
  function toast(text) {
    const box = $('toast');
    box.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 4500);
  }
  const msg = (e) => (e && e.message ? e.message : String(e));

  // ================================ Home ======================================================
  function stateOf(s) {
    const busy = state.busy[s.name] || (s.busy ? 'work' : null);
    if (busy) return { cls: 'busy', text: t('busy.' + busy) };
    if (!s.running) return { cls: 'stopped', text: t('svc.stopped') };
    if (!s.answering) return { cls: 'starting', text: t('svc.notAnswering') };
    return { cls: 'running', text: t('svc.running') };
  }

  function renderBanner(list) {
    const upList = list.filter((s) => s.running && s.answering);
    const up = upList.length, all = list.length;
    $('banner').className = 'banner ' + (up === all ? 'is-ok' : up === 0 ? 'is-off' : 'is-partial');
    $('banner-title').textContent = up === all ? t('banner.allUp') : up === 0 ? t('banner.allDown') : t('banner.some', { up, all });
    $('banner-sub').textContent = up === all ? t('banner.upSub', { names: list.map((s) => s.label) })
      : up === 0 ? t('banner.downSub')
      : t('banner.stoppedSub', { names: list.filter((s) => !(s.running && s.answering)).map((s) => s.label) });

    const box = $('banner-actions');
    box.replaceChildren();
    const anyBusy = !!state.allBusy || Object.keys(state.busy).length > 0;
    if (up < all) {
      box.appendChild(button(state.allBusy === 'start' ? t('btn.startingAll') : t('btn.startAll'), 'primary', () => runAll('start'),
        { busy: state.allBusy === 'start', disabled: anyBusy }));
    }
    if (up > 0) {
      box.appendChild(button(state.allBusy === 'stop' ? t('btn.stoppingAll') : t('btn.stopAll'), 'danger', () => runAll('stop'),
        { busy: state.allBusy === 'stop', disabled: anyBusy }));
    }
  }

  function renderError(name, err) {
    const d = err.diagnosis;
    const box = el('div', 'svc-error');
    box.dir = 'auto';
    const head = el('div', 'svc-error-head');
    head.appendChild(el('b', null, d && d.title ? d.title : t('err.failed')));
    const x = el('button', 'x', '×');
    x.title = t('err.hide');
    x.addEventListener('click', () => { delete state.errors[name]; render(); });
    head.appendChild(x);
    box.appendChild(head);
    if (d && d.summary) box.appendChild(el('p', null, d.summary));
    if (d && d.steps && d.steps.length) {
      const ol = el('ol');
      for (const s of d.steps) ol.appendChild(el('li', null, s));
      box.appendChild(ol);
    }
    if (err.message) {
      const pre = el('pre', null, err.message.split('\n').slice(0, 10).join('\n'));
      pre.dir = 'ltr';
      box.appendChild(pre);
    }
    return box;
  }

  function renderServices(list) {
    $('services').replaceChildren(...list.map((s) => {
      const st = stateOf(s);
      const card = el('div', 'svc ' + st.cls);
      const row = el('div', 'svc-row');
      row.appendChild(el('span', 'dot'));

      const info = el('div');
      info.appendChild(el('div', 'svc-name', s.label));
      info.appendChild(el('div', 'svc-state', st.text));
      row.appendChild(info);

      const ports = el('div', 'ports', (s.ports.length > 1 ? t('svc.ports') : t('svc.port')) + ' ');
      const nums = el('span');
      nums.dir = 'ltr';
      s.ports.forEach((p, i) => {
        if (i) nums.append(' · ');
        nums.appendChild(el('b', null, String(p)));
      });
      ports.appendChild(nums);
      row.appendChild(ports);

      const actions = el('div', 'svc-actions');
      const busy = state.busy[s.name];
      const locked = !!state.allBusy || !!busy;
      if (s.running) {
        actions.appendChild(button(busy === 'stop' ? t('busy.stop') : t('btn.stop'), 'danger', () => run(s.name, 'stop'),
          { busy: busy === 'stop', disabled: locked }));
      } else {
        actions.appendChild(button(busy === 'start' ? t('busy.start') : t('btn.start'), 'primary', () => run(s.name, 'start'),
          { busy: busy === 'start', disabled: locked }));
      }
      actions.appendChild(button(busy === 'restart' ? t('busy.restart') : t('btn.restart'), '', () => run(s.name, 'restart'),
        { busy: busy === 'restart', disabled: locked || !s.running }));
      actions.appendChild(button(t('btn.log'), '', () => openLog(s.name)));
      row.appendChild(actions);

      card.appendChild(row);
      if (state.errors[s.name]) card.appendChild(renderError(s.name, state.errors[s.name]));
      return card;
    }));
  }

  function renderProblems() {
    const n = state.problems;
    $('problems').hidden = !n;
    $('problems-text').textContent = t('problems.strip', { n });
    const badge = $('nav-problems');
    badge.hidden = !n;
    badge.textContent = String(n);
  }

  function render() {
    if (!state.data) return;
    renderBanner(state.data.services);
    renderServices(state.data.services);
    renderProblems();
    $('side-foot').textContent = 'AMPLE ' + (state.data.ample || '1.0') + (state.data.php ? ' · PHP ' + state.data.php : '');
    if (currentPage === 'settings') updatePassword(); // "MariaDB must be running" follows the status
  }

  async function refreshStatus() {
    try {
      state.data = await api.status();
      render();
    } catch (e) {
      toast(t('toast.status') + msg(e));
    }
  }
  async function refreshProblems() {
    try { state.problems = await api.problems(); renderProblems(); } catch { /* keep the last number */ }
  }
  // Repeat fn every ms, but not while the window is hidden next to the clock (the tray icon has
  // its own status check in main.js); everything refreshes as soon as the window shows again.
  function loop(fn, ms) {
    const tick = async () => { if (!document.hidden) { try { await fn(); } catch { /* next time */ } } setTimeout(tick, ms); };
    tick();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshStatus(); refreshProblems(); } });

  async function run(name, kind) {
    state.busy[name] = kind;
    delete state.errors[name];
    render();
    let r;
    try { r = await api[kind](name); } catch (e) { r = { ok: false, message: msg(e) }; }
    delete state.busy[name];
    if (!r.ok) state.errors[name] = r;
    await refreshStatus();
    refreshProblems();
  }

  async function runAll(kind) {
    state.allBusy = kind;
    for (const s of state.data.services) delete state.errors[s.name];
    render();
    let r;
    try { r = await api[kind + 'All'](); } catch (e) { r = { results: {} }; toast(msg(e)); }
    state.allBusy = null;
    for (const [name, res] of Object.entries(r.results || {})) if (!res.ok) state.errors[name] = res;
    await refreshStatus();
    refreshProblems();
  }

  async function openLog(name) {
    try {
      const r = await api.openLog(name);
      if (!r.ok) toast(r.message);
    } catch (e) { toast(msg(e)); }
  }

  // ================================ "Are you sure?" box =======================================
  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      const m = $('modal');
      $('modal-title').textContent = title;
      $('modal-text').textContent = text;
      const ok = $('modal-ok');
      ok.textContent = okLabel;
      ok.className = 'btn ' + (danger ? 'danger' : 'primary');
      m.hidden = false;
      ok.focus();
      const done = (v) => {
        m.hidden = true;
        ok.removeEventListener('click', yes);
        $('modal-cancel').removeEventListener('click', no);
        document.removeEventListener('keydown', key);
        resolve(v);
      };
      const yes = () => done(true);
      const no = () => done(false);
      const key = (e) => { if (e.key === 'Escape') done(false); };
      ok.addEventListener('click', yes);
      $('modal-cancel').addEventListener('click', no);
      document.addEventListener('keydown', key);
    });
  }

  // ================================ Log Doctor ================================================
  const doc = {
    hours: 24, filter: 'all', data: null, loading: false,
    open: new Set(),   // problems shown open (kept across refreshes)
    fixing: null,      // key of the problem whose fix is running
    results: {},       // key -> { ok, text } after a fix
  };
  const FILTERS = [['all', 'doc.f.all'], ['php', 'PHP'], ['apache', 'Apache'], ['mariadb', 'MariaDB'], ['mailpit', 'Mailpit'], ['resolved', 'doc.f.resolved']];
  const keyOf = (p) => [p.source, p.title, p.where].join('|');
  const groupOf = (p) => (p.source === 'php' ? 'php' : String(p.service || p.source).toLowerCase());

  function when(ms) {
    const d = new Date(ms);
    const hm = d.toTimeString().slice(0, 5);
    return d.toDateString() === new Date().toDateString() ? hm : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + hm;
  }

  async function loadDoctor() {
    if (doc.loading) return;
    doc.loading = true;
    try {
      doc.data = await api.doctor(doc.hours);
      renderDoctor();
    } catch (e) {
      toast(t('toast.logs') + msg(e));
    } finally {
      doc.loading = false;
    }
  }

  function renderDoctor() {
    const d = doc.data;
    if (!d) return;
    const all = d.problems;
    const open = all.filter((p) => !p.resolved);
    $('doc-sub').textContent = t('doc.range' + d.hours) + ' · ' + t('doc.count', { n: open.length });
    for (const b of document.querySelectorAll('#doc-hours button')) b.classList.toggle('on', Number(b.dataset.hours) === doc.hours);

    const count = (f) => (f === 'resolved' ? all.filter((p) => p.resolved).length
      : f === 'all' ? open.length : open.filter((p) => groupOf(p) === f).length);
    $('doc-filters').replaceChildren(...FILTERS.map(([f, label]) => {
      const c = el('button', 'chip-f' + (doc.filter === f ? ' on' : ''), label.startsWith('doc.') ? t(label) : label);
      c.appendChild(el('b', null, String(count(f))));
      c.addEventListener('click', () => { doc.filter = f; renderDoctor(); });
      return c;
    }));

    const shown = doc.filter === 'resolved' ? all.filter((p) => p.resolved)
      : doc.filter === 'all' ? open : open.filter((p) => groupOf(p) === doc.filter);
    const list = $('doc-list');
    if (!shown.length) {
      const e = el('div', 'empty');
      e.appendChild(el('b', null, '✔ ' + (doc.filter === 'resolved' ? t('doc.emptyResolved') : t('doc.empty'))));
      e.append(doc.filter === 'all' ? t('doc.emptyAll') : t('doc.emptyFilter'));
      list.replaceChildren(e);
      return;
    }
    list.replaceChildren(...shown.map((p) => renderProblem(p, d.lang)));
  }

  function renderProblem(p, lang) {
    const key = keyOf(p);
    const isOpen = doc.open.has(key);
    const card = el('div', 'prob' + (isOpen ? ' open' : '') + (p.resolved ? ' resolved' : ''));
    card.dir = lang === 'ar' ? 'rtl' : 'ltr';

    const head = el('button', 'prob-head');
    head.setAttribute('aria-expanded', String(isOpen));
    const icon = p.resolved ? ['resolved', '✓'] : p.level === 'error' ? ['error', '✕'] : ['warning', '!'];
    head.appendChild(el('span', 'lvl ' + icon[0], icon[1]));
    const text = el('div');
    text.appendChild(el('div', 'prob-title', p.title));
    if (p.summary) text.appendChild(el('div', 'prob-sum', p.summary));
    if (p.where) { const w = el('div', 'prob-where', p.where); w.dir = 'ltr'; text.appendChild(w); }
    head.appendChild(text);
    const meta = el('div', 'prob-meta');
    if (p.count > 1) meta.appendChild(el('span', 'times', '×' + p.count));
    meta.append(when(p.last));
    if (p.resolved) meta.appendChild(el('span', 'tag-ok', t('doc.resolved')));
    head.appendChild(meta);
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('class', 'chev');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm9 6 6 6-6 6');
    chev.appendChild(path);
    head.appendChild(chev);
    head.addEventListener('click', () => {
      if (doc.open.has(key)) doc.open.delete(key); else doc.open.add(key);
      renderDoctor();
    });
    card.appendChild(head);

    if (isOpen) {
      const body = el('div', 'prob-body');
      if (p.details) { body.appendChild(el('h3', null, t('doc.what'))); body.appendChild(el('p', null, p.details)); }
      if (p.causes.length) {
        body.appendChild(el('h3', null, t('doc.causes')));
        const ul = el('ul');
        for (const c of p.causes) ul.appendChild(el('li', null, c));
        body.appendChild(ul);
      }
      if (p.steps.length) {
        body.appendChild(el('h3', null, t('doc.how')));
        const ol = el('ol');
        for (const s of p.steps) ol.appendChild(el('li', null, s));
        body.appendChild(ol);
      }
      if (p.fixLabel && !p.resolved) {
        body.appendChild(el('h3', null, t('doc.auto')));
        const row = el('div', 'fix-row');
        row.appendChild(button(p.fixLabel, 'primary', () => applyFix(p), { busy: doc.fixing === key, disabled: !!doc.fixing }));
        body.appendChild(row);
      }
      const res = doc.results[key];
      if (res) body.appendChild(el('div', 'fix-result ' + (res.ok ? 'ok' : 'bad'), res.text));
      if (p.raw.length) { body.appendChild(el('h3', null, t('doc.raw'))); body.appendChild(el('pre', null, p.raw.join('\n'))); }
      card.appendChild(body);
    }
    return card;
  }

  async function applyFix(p) {
    if (!(await confirmBox(t('doc.confirmFix'), p.fixLabel, t('doc.auto'), false))) return;
    const key = keyOf(p);
    doc.fixing = key;
    delete doc.results[key];
    renderDoctor();
    let r;
    try { r = await api.doctorFix(doc.data.scanId, p.n); } catch (e) { r = { ok: false, text: msg(e) }; }
    doc.fixing = null;
    doc.results[key] = r;
    renderDoctor();
    refreshStatus();
    refreshProblems();
  }

  for (const b of document.querySelectorAll('#doc-hours button')) {
    b.addEventListener('click', () => { doc.hours = Number(b.dataset.hours); loadDoctor(); });
  }
  $('doc-folder').addEventListener('click', async () => {
    try { const r = await api.open('logs'); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  });
  $('doc-clear').addEventListener('click', async () => {
    if (!(await confirmBox(t('doc.clearTitle'), t('doc.clearText'), t('doc.clear'), true))) return;
    try {
      const r = await api.clearLogs();
      toast(t('doc.cleared', { files: r.files, kb: r.freedKb }) + (r.failed.length ? t('doc.notCleared', { list: r.failed.join(', ') }) : ''));
    } catch (e) { toast(msg(e)); }
    doc.open.clear();
    doc.results = {};
    loadDoctor();
    refreshProblems();
  });

  // ================================ Settings ==================================================
  const set = { data: null, designBusy: null, pathBusy: false };

  function markSeg(id, value) {
    for (const b of document.querySelectorAll(`#${id} button`)) b.classList.toggle('on', b.dataset.v === value);
  }

  function renderSettings() {
    const s = set.data;
    if (!s || !s.path) return;
    markSeg('set-appearance', s.appearance);
    markSeg('set-language', s.language);
    for (const tool of ['phpmyadmin', 'mailpit']) {
      markSeg('set-design-' + tool, s.design[tool]);
      for (const b of document.querySelectorAll(`#set-design-${tool} button`)) b.disabled = !!set.designBusy;
    }
    const note = $('set-design-note');
    note.textContent = set.designBusy ? t('set.applying') : t('set.designNote');
    note.classList.toggle('busy', !!set.designBusy);

    const sw = $('set-path');
    sw.setAttribute('aria-checked', String(!!s.path.added));
    sw.disabled = set.pathBusy;
    const warn = [];
    if (s.path.error) warn.push(s.path.error);
    if (s.path.added && s.path.otherPhp.length) warn.push(t('set.pathOther', { list: s.path.otherPhp.join(', ') }));
    if (s.path.system.length) warn.push(t('set.pathSystem', { list: s.path.system.join(', ') }));
    $('set-path-warn').hidden = !warn.length;
    $('set-path-warn').textContent = warn.join('\n');
  }

  async function loadSettings() {
    try {
      set.data = await api.getSettings();
      renderSettings();
    } catch (e) { toast(t('toast.settings') + msg(e)); }
  }

  // Language: the whole panel switches at once (no restart).
  function applyLanguage(lang) {
    setLang(lang);
    render();
    renderDoctor();
    renderSettings();
    renderSettings2();
    renderSites();
    renderDatabases();
    renderXampp();
    renderPhp();
    renderMail();
    renderShare();
  }

  for (const b of document.querySelectorAll('#set-appearance button')) {
    b.addEventListener('click', async () => {
      try { set.data.appearance = await api.setAppearance(b.dataset.v); renderSettings(); } catch (e) { toast(msg(e)); }
    });
  }
  for (const b of document.querySelectorAll('#set-language button')) {
    b.addEventListener('click', async () => {
      try {
        set.data.language = await api.setLanguage(b.dataset.v);
        applyLanguage(set.data.language);
        if (doc.data) loadDoctor(); // Log Doctor's explanations in the new language
      } catch (e) { toast(msg(e)); }
    });
  }
  for (const tool of ['phpmyadmin', 'mailpit']) {
    for (const b of document.querySelectorAll(`#set-design-${tool} button`)) {
      b.addEventListener('click', async () => {
        if (set.designBusy || set.data.design[tool] === b.dataset.v) return;
        set.designBusy = tool;
        renderSettings();
        try {
          const r = await api.setDesign(tool, b.dataset.v);
          set.data.design = r.design;
          toast(t('set.designDone', { tool: tool === 'phpmyadmin' ? 'phpMyAdmin' : 'Mailpit', value: b.dataset.v }));
        } catch (e) { toast(msg(e)); }
        set.designBusy = null;
        renderSettings();
        refreshStatus();
      });
    }
  }
  $('set-path').addEventListener('click', async () => {
    if (set.pathBusy) return;
    const on = !set.data.path.added;
    set.pathBusy = true;
    renderSettings();
    try {
      set.data.path = await api.setPath(on);
      toast(on ? t('set.pathOn') : t('set.pathOff'));
    } catch (e) { toast(msg(e)); }
    set.pathBusy = false;
    renderSettings();
  });

  // ---- Ports ----------------------------------------------------------------------------------
  const ports = { data: null, busy: false };
  const PORT_KEYS = ['http', 'https', 'mysql', 'smtp', 'mailpit'];

  function portInputs() { return [...document.querySelectorAll('#set-ports input')]; }
  function portPatch() {
    const patch = {};
    for (const i of portInputs()) if (String(ports.data.ports[i.dataset.key]) !== i.value.trim()) patch[i.dataset.key] = i.value.trim();
    return patch;
  }
  function updatePortsButton() {
    const patch = portPatch();
    for (const i of portInputs()) i.classList.toggle('changed', i.dataset.key in patch);
    const b = $('set-ports-save');
    b.disabled = ports.busy || !Object.keys(patch).length;
    b.textContent = ports.busy ? t('set.saving') : t('set.save');
    b.classList.toggle('busy', ports.busy);
  }
  function renderPorts() {
    if (!ports.data) return;
    const box = $('set-ports');
    const keep = {};
    for (const i of portInputs()) keep[i.dataset.key] = i.value; // typed values survive a language switch
    box.replaceChildren(...PORT_KEYS.filter((k) => k !== 'https' || ports.data.https).map((k) => {
      const label = el('label');
      label.appendChild(el('span', null, t('port.' + k)));
      const input = el('input', 'input');
      input.type = 'number'; input.min = '1'; input.max = '65535'; input.dataset.key = k;
      input.value = keep[k] !== undefined ? keep[k] : String(ports.data.ports[k]);
      input.addEventListener('input', updatePortsButton);
      label.appendChild(input);
      return label;
    }));
    updatePortsButton();
  }
  async function loadPorts() {
    try { ports.data = await api.getPorts(); $('set-ports').replaceChildren(); renderPorts(); } catch (e) { toast(msg(e)); }
  }
  $('set-ports-save').addEventListener('click', async () => {
    const patch = portPatch();
    const lines = Object.entries(patch).map(([k, v]) => `${t('port.' + k)}: ${ports.data.ports[k]} → ${v}`).join('\n');
    if (!(await confirmBox(t('set.portsConfirm'), lines + '\n\n' + t('set.portsNote'), t('set.save'), false))) return;
    ports.busy = true;
    updatePortsButton();
    try {
      const r = await api.setPorts(patch);
      toast(t('set.portsDone') + (r.restarted.length ? t('set.portsRestarted', { list: r.restarted.join(', ') }) : ''));
    } catch (e) { toast(msg(e)); }
    ports.busy = false;
    await loadPorts();
    refreshStatus();
  });

  // ---- MariaDB password -------------------------------------------------------------------
  const pw = { busy: false };
  function mariadbRunning() {
    const m = state.data && state.data.services.find((s) => s.name === 'mariadb');
    return !!(m && m.running);
  }
  function updatePassword() {
    const a = $('pw1').value, b = $('pw2').value;
    const note = $('pw-note');
    let problem = null;
    if (!mariadbRunning()) problem = t('set.pwNeedsDb');
    else if (a && b && a !== b) problem = t('set.pwMismatch');
    note.textContent = problem || t('set.pwNote');
    note.classList.toggle('bad', !!problem);
    const save = $('pw-save');
    save.disabled = pw.busy || !!problem || !a || a !== b;
    save.textContent = pw.busy ? t('set.saving') : t('set.pwSave');
    save.classList.toggle('busy', pw.busy);
  }
  $('pw1').addEventListener('input', updatePassword);
  $('pw2').addEventListener('input', updatePassword);
  $('pw-show').addEventListener('change', () => {
    const type = $('pw-show').checked ? 'text' : 'password';
    $('pw1').type = type; $('pw2').type = type;
  });
  $('pw-save').addEventListener('click', async () => {
    if (!(await confirmBox(t('set.pwConfirm'), t('set.pwConfirmText'), t('set.pwSave'), false))) return;
    pw.busy = true;
    updatePassword();
    try {
      const r = await api.changePassword($('pw1').value);
      toast(t('set.pwDone', { n: r.accounts }));
      $('pw1').value = ''; $('pw2').value = '';
    } catch (e) { toast(msg(e)); }
    pw.busy = false;
    updatePassword();
  });

  // ---- This computer ("ample check") -----------------------------------------------------
  const pc = { list: null, busy: false };
  function renderPc() {
    const b = $('pc-run');
    b.disabled = pc.busy;
    b.textContent = pc.busy ? t('set.pcRunning') : t('set.pcRun');
    b.classList.toggle('busy', pc.busy);
    const note = $('pc-note');
    note.classList.remove('bad');
    if (!pc.list) { note.textContent = t('set.pcNote'); $('pc-list').replaceChildren(); return; }
    const fails = pc.list.filter((c) => c.status === 'fail').length;
    const warns = pc.list.filter((c) => c.status === 'warn').length;
    note.textContent = fails ? t('set.pcFail', { n: fails }) : warns ? t('set.pcWarn', { n: warns }) : t('set.pcOk');
    note.classList.toggle('bad', !!fails);
    const ICON = { ok: ['ok', '✓'], info: ['info', 'i'], warn: ['warning', '!'], fail: ['error', '✕'] };
    $('pc-list').replaceChildren(...pc.list.map((c) => {
      const row = el('div', 'pc-item');
      const ic = ICON[c.status] || ICON.info;
      row.appendChild(el('span', 'lvl ' + ic[0], ic[1]));
      const text = el('div');
      text.appendChild(el('b', null, c.title));
      if (c.detail) text.appendChild(el('small', null, c.detail));
      if (c.fix) text.appendChild(el('small', 'fix', '→ ' + c.fix));
      row.appendChild(text);
      row.appendChild(c.canFix ? button(t('set.defender'), '', fixDefender, { disabled: pc.busy }) : el('span'));
      return row;
    }));
  }
  async function runPc() {
    pc.busy = true;
    renderPc();
    try { pc.list = await api.checkPc(); } catch (e) { toast(msg(e)); }
    pc.busy = false;
    renderPc();
  }
  async function fixDefender() {
    if (!(await confirmBox(t('set.defenderConfirm'), t('set.defenderText'), t('set.defender'), false))) return;
    try {
      const r = await api.fixDefender();
      toast(r.ok ? t('set.defenderDone') : t('set.defenderFail'));
    } catch (e) { toast(msg(e)); }
    runPc();
  }
  $('pc-run').addEventListener('click', runPc);

  // ---- Updates ("ample update") ------------------------------------------------------------
  const up = { list: null, checking: false, running: false };
  const upLog = [];
  function onUpdateLine(line) {
    upLog.push(line);
    const box = $('up-log');
    box.hidden = false;
    box.textContent = upLog.slice(-200).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  function renderUpdates() {
    const busy = up.checking || up.running;
    const c = $('up-check');
    c.disabled = busy;
    c.textContent = up.checking ? t('set.upChecking') : t('set.upCheck');
    c.classList.toggle('busy', up.checking);
    const panelOnly = (r) => r.name === 'electron';
    // AMPLE itself has its own button (it is updated by running the new AMPLE Setup)
    const ready = (up.list || []).filter((r) => r.available && !panelOnly(r) && r.name !== 'ample');
    setUpdateBadge();
    const all = $('up-all');
    all.hidden = !ready.length;
    all.disabled = busy;
    all.textContent = up.running ? t('set.upRunning') : t('set.upAll');
    all.classList.toggle('busy', up.running);
    if (!up.list) { $('up-list').replaceChildren(); return; }
    $('up-note').textContent = (up.list.some((r) => r.available) ? '' : t('set.upNone') + ' ') + t('set.upNote');
    $('up-list').replaceChildren(...up.list.map((r) => {
      const row = el('div', 'up-item');
      row.appendChild(el('span', 'lvl ' + (r.error ? 'error' : r.available ? 'warning' : 'ok'), r.error ? '✕' : r.available ? '↑' : '✓'));
      const text = el('div');
      text.appendChild(el('b', null, r.label));
      const ver = el('span', 'ver', r.available ? `${r.current} → ${r.latest}` : String(r.current || '-'));
      ver.dir = 'ltr';
      text.appendChild(ver);
      if (r.note) text.appendChild(el('small', null, r.note));
      if (r.error) text.appendChild(el('small', null, r.error));
      row.appendChild(text);
      if (r.error) row.appendChild(el('span', 'state bad', '✕'));
      else if (!r.available) row.appendChild(el('span', 'state ok', t('set.upToDate')));
      else if (panelOnly(r)) row.appendChild(button(t('set.upOne'), 'primary', () => runPanelUpdate(r), { disabled: busy }));
      else if (r.name === 'ample') row.appendChild(button(t('set.upAmple'), 'primary', () => runAmpleUpdate(r), { disabled: busy }));
      else row.appendChild(button(t('set.upOne'), 'primary', () => runUpdates([r.name]), { disabled: busy }));
      return row;
    }));
  }
  // The amber number on "Settings": how many updates are waiting.
  function setUpdateBadge() {
    const n = (up.list || []).filter((r) => r.available).length;
    const b = $('nav-updates');
    b.hidden = !n;
    b.textContent = n ? String(n) : '';
  }
  // AMPLE itself: download the new AMPLE Setup (checked) and open it; Setup does the rest.
  async function runAmpleUpdate(r) {
    if (!(await confirmBox(t('set.upAmpleTitle', { v: r.latest }), t('set.upAmpleText', { v: r.latest }), t('set.upAmple'), false))) return;
    up.running = true;
    upLog.length = 0;
    renderUpdates();
    try { await api.ampleUpdate(); toast(t('set.upAmpleOpened')); } catch (e) { toast(msg(e)); }
    up.running = false;
    renderUpdates();
  }
  // Electron (the engine of this panel): the panel closes for a moment, a small window shows the
  // update, and AMPLE opens again by itself. The services keep running.
  async function runPanelUpdate(r) {
    if (!(await confirmBox(t('set.upPanelTitle', { v: r.latest }), t('set.upPanelText'), t('set.upOne'), false))) return;
    up.running = true;
    renderUpdates();
    try { await api.panelUpdate(); } catch (e) { toast(msg(e)); up.running = false; renderUpdates(); }
  }
  // When the panel opens: look for updates once, quietly. If there are some, the badge on Settings
  // shows how many and Windows shows a notification (clicking it opens Settings).
  async function autoCheckUpdates() {
    if (up.checking || up.running) return;
    try { up.list = await api.updatesCheck(); } catch { return; }
    renderUpdates();
    const ready = up.list.filter((r) => r.available);
    if (ready.length) api.notifyUpdates(ready.length, ready.map((r) => `${r.label} ${r.latest}`)).catch(() => {});
  }
  async function checkUpdates() {
    up.checking = true;
    renderUpdates();
    try { up.list = await api.updatesCheck(); } catch (e) { toast(t('set.upError') + msg(e)); }
    up.checking = false;
    renderUpdates();
  }
  async function runUpdates(names) {
    const chosen = (up.list || []).filter((r) => r.available && r.name !== 'electron' && r.name !== 'ample' && (names.includes('all') || names.includes(r.name)));
    if (!chosen.length) return;
    const list = chosen.map((r) => `${r.label}: ${r.current} → ${r.latest}`).join('\n');
    if (!(await confirmBox(t('set.upConfirm'), t('set.upConfirmText', { list }), t('set.upOne'), false))) return;
    up.running = true;
    upLog.length = 0;
    renderUpdates();
    try {
      const res = await api.updatesApply(chosen.map((r) => r.name));
      const ok = res.filter((r) => r.ok && !r.skipped).length;
      toast(t('set.upDone', { ok, bad: res.length - ok - res.filter((r) => r.skipped).length }));
    } catch (e) { toast(msg(e)); }
    up.running = false;
    refreshStatus();
    checkUpdates();
  }
  $('up-check').addEventListener('click', checkUpdates);
  $('up-all').addEventListener('click', () => runUpdates(['all']));

  function renderSettings2() {
    renderPorts();
    updatePassword();
    renderPc();
    renderUpdates();
  }

  // ================================ Sites =====================================================
  const sites = { data: null, loading: false, busy: false, httpsBusy: false };
  const SITE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i; // same rule as control/core/sites.js

  // A small box asking for a name; validate(name) -> { ok, hint, bad }. Resolves the name or null.
  function nameBox(title, text, okLabel, initial, validate, { secret = false } = {}) {
    return new Promise((resolve) => {
      const box = $('namebox'), input = $('namebox-input'), ok = $('namebox-ok'), hint = $('namebox-hint');
      $('namebox-title').textContent = title;
      $('namebox-text').textContent = text;
      ok.textContent = okLabel;
      input.type = secret ? 'password' : 'text';
      input.maxLength = secret ? 128 : 63;
      input.value = initial || '';
      const check = () => {
        const r = validate(input.value.trim());
        hint.textContent = r.hint || '';
        hint.classList.toggle('bad', !!r.bad);
        ok.disabled = !r.ok;
      };
      const done = (v) => {
        box.hidden = true;
        input.removeEventListener('input', check);
        input.removeEventListener('keydown', key);
        ok.removeEventListener('click', yes);
        $('namebox-cancel').removeEventListener('click', no);
        resolve(v);
      };
      const yes = () => { if (!ok.disabled) done(input.value.trim()); };
      const no = () => done(null);
      const key = (e) => { if (e.key === 'Enter') yes(); if (e.key === 'Escape') no(); };
      input.addEventListener('input', check);
      input.addEventListener('keydown', key);
      ok.addEventListener('click', yes);
      $('namebox-cancel').addEventListener('click', no);
      box.hidden = false;
      check();
      input.focus();
      input.select();
    });
  }
  function nameRule(except) {
    const taken = new Set([...(sites.data ? sites.data.sites : []), ...(sites.data ? sites.data.skipped : [])]
      .map((x) => x.name.toLowerCase()).filter((n) => n !== String(except || '').toLowerCase()));
    return (name) => {
      if (!name) return { ok: false };
      if (!SITE_NAME.test(name)) return { ok: false, bad: true, hint: t('sites.nameBad') };
      if (taken.has(name.toLowerCase())) return { ok: false, bad: true, hint: t('sites.nameTaken') };
      return { ok: true, hint: t('sites.newHint', { name: name.toLowerCase() }) };
    };
  }

  async function openSite(name, kind) {
    try { const r = await api.openSite(name, kind); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  }

  function siteRow({ title, small, dir, tags, actions, bad }) {
    const row = el('div', 'site' + (bad ? ' bad' : ''));
    const text = el('div');
    const head = el('div', 'site-url', title);
    head.dir = 'ltr';
    if (small) head.appendChild(el('small', null, small));
    text.appendChild(head);
    if (dir) { const d = el('div', 'site-dir', dir); d.dir = 'ltr'; text.appendChild(d); }
    if (tags && tags.length) {
      const box = el('div', 'tags');
      for (const [label, cls] of tags) box.appendChild(el('span', 'tag' + (cls ? ' ' + cls : ''), label));
      text.appendChild(box);
    }
    row.appendChild(text);
    const a = el('div', 'site-actions');
    for (const b of actions) a.appendChild(b);
    row.appendChild(a);
    return row;
  }

  function renderSites() {
    const d = sites.data;
    if (!d) return;
    // something Apache must restart for
    const pend = d.apacheRunning && d.pending.length;
    $('sites-pending').hidden = !pend;
    if (pend) $('sites-pending-text').textContent = t('sites.pending', { list: d.pending.join(', ') });
    const apply = $('sites-apply');
    apply.disabled = sites.busy;
    apply.classList.toggle('busy', sites.busy);

    // one card per site
    const list = $('sites-list');
    if (!d.sites.length) {
      list.replaceChildren(el('div', 'empty', t('sites.empty')));
    } else {
      list.replaceChildren(...d.sites.map((x) => {
        const actions = [button(t('sites.open'), 'primary', () => openSite(x.name, 'http'))];
        if (x.httpsUrl) actions.push(button('HTTPS', '', () => openSite(x.name, 'https')));
        actions.push(shareButton(x.name));
        actions.push(button(t('sites.folder'), '', () => openSite(x.name, 'folder')));
        const tags = [[x.framework, 'fw']];
        if (x.web) tags.push([t('sites.serves', { dir: x.web })]);
        return siteRow({ title: x.url.replace(/\/$/, ''), dir: x.dir, tags, actions });
      }));
    }

    // folders that can't be site names
    const sk = $('sites-skipped');
    sk.replaceChildren();
    if (d.skipped.length) {
      sk.appendChild(el('div', 'sub-title', t('sites.badTitle')));
      const box = el('div', 'site-list');
      for (const k of d.skipped) {
        const actions = [];
        if (k.suggestion) actions.push(button(t('sites.rename'), 'primary', () => renameFolder(k)));
        actions.push(button(t('sites.folder'), '', () => openSite(k.name, 'folder')));
        const tags = [[t('sites.badWhy')]];
        box.appendChild(siteRow({ title: k.name, small: k.suggestion ? '→ ' + k.suggestion : '', dir: t('sites.badReach', { name: encodeURI(k.name) }), tags, actions, bad: true }));
      }
      sk.appendChild(box);
    }

    // your own virtual hosts (read only)
    const own = $('sites-own');
    own.replaceChildren();
    if (d.own.length) {
      own.appendChild(el('div', 'sub-title', t('sites.ownTitle')));
      const box = el('div', 'site-list');
      for (const h of d.own) {
        const tags = [[h.file]];
        if (h.https) tags.push(['HTTPS', 'fw']);
        box.appendChild(siteRow({
          title: h.name, small: h.aliases || '', dir: h.docroot, tags,
          actions: [button(t('sites.open'), 'primary', () => openSite(h.name, 'http')), button(t('sites.folder'), '', () => openSite(h.name, 'folder'))],
        }));
      }
      own.appendChild(box);
      own.appendChild(el('p', 'set-note', t('sites.ownNote')));
    }

    // HTTPS
    const h = d.https;
    const sw = $('https-switch');
    sw.setAttribute('aria-checked', String(h.on));
    sw.disabled = sites.httpsBusy;
    $('https-trust-row').hidden = !h.on && !h.ca;
    $('https-trust-title').textContent = h.trusted ? t('https.trusted') : t('https.notTrusted');
    $('https-trust-sub').textContent = (h.trusted ? t('https.trustedSub') : t('https.notTrustedSub')) + (h.on && h.daysLeft ? t('https.days', { n: h.daysLeft }) : '');
    $('https-trust').hidden = h.trusted;
    $('https-untrust').hidden = !h.trusted;
    for (const id of ['https-trust', 'https-untrust']) $(id).disabled = sites.httpsBusy;
  }

  async function loadSites() {
    if (sites.loading) return;
    sites.loading = true;
    try { sites.data = await api.sites(); renderSites(); } catch (e) { toast(msg(e)); }
    sites.loading = false;
  }

  async function renameFolder(k) {
    const name = await nameBox(t('sites.renameTitle'), t('sites.renameText', { name: k.name }), t('sites.rename'), k.suggestion, nameRule(k.name));
    if (!name) return;
    try { const r = await api.siteRename(k.name, name); toast(t('sites.renamed', { url: r.url })); } catch (e) { toast(msg(e)); }
    loadSites();
  }

  $('sites-new').addEventListener('click', async () => {
    const name = await nameBox(t('sites.newTitle'), t('sites.newText'), t('sites.create'), '', nameRule());
    if (!name) return;
    try { const r = await api.siteCreate(name); toast(t('sites.created', { url: r.url })); } catch (e) { toast(msg(e)); }
    loadSites();
  });
  $('sites-htdocs').addEventListener('click', async () => {
    try { const r = await api.open('htdocs'); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  });
  $('sites-apply').addEventListener('click', async () => {
    sites.busy = true;
    renderSites();
    try { await api.sitesApply(); toast(t('sites.applied')); } catch (e) { toast(msg(e)); }
    sites.busy = false;
    loadSites();
    refreshStatus();
  });
  $('https-switch').addEventListener('click', async () => {
    if (sites.httpsBusy || !sites.data) return;
    const on = !sites.data.https.on;
    sites.httpsBusy = true;
    renderSites();
    try { await api.httpsSet(on); toast(on ? t('https.onDone') : t('https.offDone')); } catch (e) { toast(msg(e)); }
    sites.httpsBusy = false;
    loadSites();
    refreshStatus();
  });
  $('https-trust').addEventListener('click', async () => {
    sites.httpsBusy = true;
    renderSites();
    try { const r = await api.httpsTrust(); toast(r.ok ? t('https.trustDone') : t('https.trustFail')); } catch (e) { toast(msg(e)); }
    sites.httpsBusy = false;
    loadSites();
  });
  $('https-untrust').addEventListener('click', async () => {
    sites.httpsBusy = true;
    renderSites();
    try { await api.httpsUntrust(); toast(t('https.untrustDone')); } catch (e) { toast(msg(e)); }
    sites.httpsBusy = false;
    loadSites();
  });

  // ================================ Databases =================================================
  const dbs = { data: null, loading: false, busy: null, started: 0 };
  const DB_RE = /^[A-Za-z0-9_-]{1,64}$/; // same rule as control/core/db.js
  const sizeText = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const dateText = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function renderDatabases() {
    const d = dbs.data;
    if (!d) return;
    $('db-sub').textContent = `MariaDB ${d.version} · 127.0.0.1:${d.port} · ${d.user}`;
    $('db-off').hidden = d.running;
    const busy = !!dbs.busy;
    for (const id of ['db-new', 'db-import', 'db-backup-all']) $(id).disabled = busy || !d.running;
    const all = $('db-backup-all');
    all.textContent = dbs.busy === 'backupAll' ? t('db.backingUp') : t('db.backupAll');
    all.classList.toggle('busy', dbs.busy === 'backupAll');

    const list = $('db-list');
    if (!d.running) list.replaceChildren();
    else if (!d.databases.length) list.replaceChildren(el('div', 'empty', t('db.empty')));
    else {
      list.replaceChildren(...d.databases.map((x) => siteRow({
        title: x.name, small: `${t('db.tables', { n: x.tables })} · ${sizeText(x.bytes)}`,
        actions: [
          button(dbs.busy === 'backup:' + x.name ? t('db.backingUp') : t('db.backup'), '', () => backupDbs([x.name]),
            { busy: dbs.busy === 'backup:' + x.name, disabled: busy }),
          button(t('db.pma'), 'primary', () => api.openDb(x.name).catch((e) => toast(msg(e)))),
        ],
      })));
    }

    const bk = $('db-backups');
    if (!d.backups.length) bk.replaceChildren(el('div', 'empty', t('db.noBackups')));
    else {
      bk.replaceChildren(...d.backups.map((b) => siteRow({
        title: b.name, small: `${sizeText(b.bytes)} · ${dateText(b.time)}`,
        actions: [button(t('db.restore'), '', () => restoreBackup(b), { disabled: busy || !d.running })],
      })));
    }

    const r = $('db-rescue');
    r.disabled = busy;
    r.textContent = dbs.busy === 'rescue' ? t('db.rescueRunning') : t('db.rescueRun');
    r.classList.toggle('busy', dbs.busy === 'rescue');
  }

  async function loadDatabases() {
    if (dbs.loading) return;
    dbs.loading = true;
    try { dbs.data = await api.databases(); renderDatabases(); } catch (e) { toast(msg(e)); }
    dbs.loading = false;
  }

  // the progress bar (import / restore)
  function showProgress(title) {
    dbs.started = Date.now();
    $('db-progress-title').textContent = title;
    $('db-progress-pct').textContent = '0%';
    $('db-progress-bar').style.width = '0%';
    $('db-progress-sub').textContent = '';
    $('db-progress').hidden = false;
  }
  function onImportProgress(p) {
    if (!p.total) return;
    const secs = Math.max(0.5, (Date.now() - dbs.started) / 1000);
    $('db-progress-pct').textContent = p.pct + '%';
    $('db-progress-bar').style.width = Math.min(100, p.pct) + '%';
    $('db-progress-sub').textContent = t('db.importSub', {
      read: (p.read / 1048576).toFixed(1), total: (p.total / 1048576).toFixed(1), speed: (p.read / 1048576 / secs).toFixed(1),
    });
  }

  async function backupDbs(names) {
    dbs.busy = names === 'all' ? 'backupAll' : 'backup:' + names[0];
    renderDatabases();
    try {
      const r = await api.dbBackup(names);
      toast(t('db.backedUp', { list: r.done.map((x) => `${x.name} (${sizeText(x.bytes)})`).join(', ') }));
    } catch (e) { toast(msg(e)); }
    dbs.busy = null;
    loadDatabases();
  }

  async function restoreBackup(b) {
    if (!(await confirmBox(t('db.restoreTitle'), t('db.restoreText', { file: b.name }), t('db.restore'), true))) return;
    dbs.busy = 'restore';
    renderDatabases();
    showProgress(t('db.restoring', { file: b.name }));
    try { const r = await api.dbRestore(b.name); toast(t('db.imported', { s: r.seconds })); } catch (e) { toast(msg(e)); }
    dbs.busy = null;
    $('db-progress').hidden = true;
    loadDatabases();
  }

  $('db-new').addEventListener('click', async () => {
    const taken = new Set(dbs.data.databases.map((x) => x.name.toLowerCase()));
    const name = await nameBox(t('db.newTitle'), t('db.newText'), t('db.create'), '', (n) => {
      if (!n) return { ok: false };
      if (!DB_RE.test(n)) return { ok: false, bad: true, hint: t('db.nameBad') };
      if (taken.has(n.toLowerCase())) return { ok: false, bad: true, hint: t('db.nameTaken') };
      return { ok: true, hint: t('db.nameOk') };
    });
    if (!name) return;
    try { await api.dbCreate(name); toast(t('db.created', { name })); } catch (e) { toast(msg(e)); }
    loadDatabases();
  });

  $('db-import').addEventListener('click', async () => {
    let file;
    try { file = await api.pickImportFile(); } catch (e) { toast(msg(e)); return; }
    if (!file) return;
    const existing = new Set(dbs.data.databases.map((x) => x.name.toLowerCase()));
    const target = await nameBox(t('db.importTitle'), t('db.importText', { file: file.name, size: sizeText(file.bytes) }), t('db.importGo'), '', (n) => {
      if (!n) return { ok: true, hint: t('db.importEmpty') };
      if (!DB_RE.test(n)) return { ok: false, bad: true, hint: t('db.nameBad') };
      return { ok: true, hint: existing.has(n.toLowerCase()) ? t('db.importInto', { name: n }) : t('db.importNew', { name: n }) };
    });
    if (target === null) return;
    dbs.busy = 'import';
    renderDatabases();
    showProgress(t('db.importing', { file: file.name }));
    try { const r = await api.dbImport(target); toast(t('db.imported', { s: r.seconds })); } catch (e) { toast(msg(e)); }
    dbs.busy = null;
    $('db-progress').hidden = true;
    loadDatabases();
  });

  $('db-backup-all').addEventListener('click', () => backupDbs('all'));
  $('db-backups-folder').addEventListener('click', async () => {
    try { const r = await api.open('backups'); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  });
  $('db-start').addEventListener('click', async () => { await run('mariadb', 'start'); loadDatabases(); });

  // ---- Import from XAMPP -----------------------------------------------------------------------
  const xa = { inv: null, busy: false, loading: false, sel: new Set() };
  const xaLog = [];
  function onXamppLine(line) {
    xaLog.push(line);
    const box = $('xa-log');
    box.hidden = false;
    box.textContent = xaLog.slice(-200).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  function renderXampp() {
    const inv = xa.inv;
    $('xa-sub').textContent = !inv ? t('xa.subIdle') : inv.found ? t('xa.found', { root: inv.root, ver: inv.mariadb }) : t('xa.notFound');
    const find = $('xa-find');
    find.disabled = xa.busy || xa.loading;
    find.textContent = xa.loading ? t('xa.loading') : t('xa.find');
    find.classList.toggle('busy', xa.loading);
    $('xa-pick').disabled = xa.busy;
    const ok = inv && inv.found;
    $('xa-warn').hidden = !(ok && inv.mysqlRunning);
    $('xa-warn').textContent = t('xa.running');
    const list = $('xa-list');
    if (!ok) list.replaceChildren();
    else if (!inv.databases.length) list.replaceChildren(el('p', 'set-note', t('xa.none')));
    else {
      list.replaceChildren(...inv.databases.map((d) => {
        const row = el('label', 'xa-db' + (d.existsInAmple ? ' off' : ''));
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !d.existsInAmple && xa.sel.has(d.name);
        cb.disabled = d.existsInAmple || xa.busy;
        cb.addEventListener('change', () => { if (cb.checked) xa.sel.add(d.name); else xa.sel.delete(d.name); renderXampp(); });
        row.appendChild(cb);
        const name = el('b', null, d.name);
        name.dir = 'ltr';
        row.appendChild(name);
        row.appendChild(el('small', null, d.existsInAmple ? t('xa.exists') : sizeText(d.size)));
        return row;
      }));
    }
    // Select all / Clear all + how many are chosen (databases already in AMPLE never count)
    const choosable = ok ? inv.databases.filter((d) => !d.existsInAmple) : [];
    $('xa-bar').hidden = !choosable.length;
    $('xa-count').textContent = t('xa.count', { n: xa.sel.size, total: choosable.length });
    $('xa-all').disabled = xa.busy || xa.sel.size === choosable.length;
    $('xa-none').disabled = xa.busy || !xa.sel.size;
    const newProjects = ok ? inv.projects.filter((p) => !p.exists).length : 0;
    $('xa-projects-row').hidden = !newProjects;
    $('xa-projects-text').textContent = t('xa.projects', { n: newProjects });
    $('xa-projects').disabled = xa.busy;
    $('xa-actions').hidden = !(ok && (inv.databases.length || newProjects));
    const go = $('xa-go');
    const nothing = !xa.sel.size && !$('xa-projects').checked;
    go.disabled = xa.busy || nothing || (ok && inv.mysqlRunning && xa.sel.size > 0);
    go.textContent = xa.busy ? t('xa.going') : t('xa.go');
    go.classList.toggle('busy', xa.busy);
  }
  function xaSetInventory(inv) {
    xa.inv = inv;
    xa.sel = new Set(inv && inv.found ? inv.databases.filter((d) => !d.existsInAmple).map((d) => d.name) : []);
    renderXampp();
  }
  $('xa-find').addEventListener('click', async () => {
    xa.loading = true;
    renderXampp();
    try { xaSetInventory(await api.xamppInventory()); } catch (e) { toast(msg(e)); }
    xa.loading = false;
    renderXampp();
  });
  $('xa-pick').addEventListener('click', async () => {
    try { const inv = await api.xamppPick(); if (inv) xaSetInventory(inv); } catch (e) { toast(msg(e)); }
  });
  $('xa-projects').addEventListener('change', renderXampp);
  $('xa-all').addEventListener('click', () => {
    xa.sel = new Set(xa.inv.databases.filter((d) => !d.existsInAmple).map((d) => d.name));
    renderXampp();
  });
  $('xa-none').addEventListener('click', () => { xa.sel.clear(); renderXampp(); });
  $('xa-go').addEventListener('click', async () => {
    const names = [...xa.sel];
    const projects = $('xa-projects').checked;
    const lines = [...names];
    if (projects) lines.push(t('xa.projects', { n: xa.inv.projects.filter((p) => !p.exists).length }));
    if (!(await confirmBox(t('xa.confirmTitle'), t('xa.confirmText', { list: lines.join('\n') }), t('xa.go'), false))) return;
    xa.busy = true;
    xaLog.length = 0;
    $('xa-result').replaceChildren();
    renderXampp();
    let password = '';
    let r = null;
    for (;;) {
      try { r = await api.xamppImport(names, projects, password); } catch (e) { toast(msg(e)); r = null; break; }
      if (!r.needPassword) break;
      const pw = await nameBox(t('xa.pwTitle'), t('xa.pwText'), t('xa.go'), '', (v) => ({ ok: !!v }), { secret: true });
      if (pw === null) { r = null; break; }
      password = pw;
    }
    xa.busy = false;
    if (r) {
      const rows = [];
      for (const d of (r.databases ? r.databases.results : [])) {
        const row = el('div', 'pc-item');
        const ic = d.status === 'imported' ? ['ok', '✓'] : d.status === 'partial' ? ['warning', '!'] : d.status === 'skipped' ? ['info', 'i'] : ['error', '✕'];
        row.appendChild(el('span', 'lvl ' + ic[0], ic[1]));
        const text = el('div');
        text.appendChild(el('b', null, `${d.db} · ${t('xa.' + d.status)}`));
        if (d.status === 'imported' || d.status === 'partial') text.appendChild(el('small', null, t('xa.tables', { after: d.tablesAfter, before: d.tablesBefore })));
        if (d.error) text.appendChild(el('small', null, d.error));
        row.appendChild(text);
        row.appendChild(el('span'));
        rows.push(row);
      }
      const users = r.databases ? r.databases.users.filter((u) => u.status === 'imported').map((u) => `${u.user}@${u.host}`) : [];
      if (users.length) rows.push(el('p', 'set-note', t('xa.users', { list: users.join(', ') })));
      const copied = r.projects ? r.projects.filter((p) => p.copied).map((p) => p.name) : [];
      if (copied.length) rows.push(el('p', 'set-note', t('xa.copied', { list: copied.join(', ') })));
      $('xa-result').replaceChildren(...rows);
      toast(t('xa.done'));
      try { xaSetInventory(await api.xamppInventory()); } catch { /* keep */ }
      loadDatabases();
    }
    renderXampp();
  });

  // rescue mode
  const rescueLog = [];
  function onRescueLine(line) {
    rescueLog.push(line);
    const box = $('db-rescue-log');
    box.hidden = false;
    box.textContent = rescueLog.join('\n');
    box.scrollTop = box.scrollHeight;
  }
  $('db-rescue').addEventListener('click', async () => {
    if (!(await confirmBox(t('db.rescueTitle'), t('db.rescueText'), t('db.rescueRun'), true))) return;
    dbs.busy = 'rescue';
    rescueLog.length = 0;
    $('db-rescue-result').replaceChildren();
    renderDatabases();
    let r;
    try { r = await api.rescue(); } catch (e) { r = { ok: false, message: msg(e), databases: [] }; }
    dbs.busy = null;
    const box = $('db-rescue-result');
    const rows = r.databases.map((d) => {
      const row = el('div', 'pc-item');
      const ic = d.status === 'full' ? ['ok', '✓'] : d.status === 'partial' ? ['warning', '!'] : ['error', '✕'];
      row.appendChild(el('span', 'lvl ' + ic[0], ic[1]));
      const text = el('div');
      text.appendChild(el('b', null, `${d.db} · ${t(d.status === 'full' ? 'db.rescueFull' : d.status === 'partial' ? 'db.rescuePartial' : 'db.rescueFailed')}`));
      text.appendChild(el('small', null, t('db.rescueTables', { after: d.tablesAfter, before: d.tablesBefore })));
      if (d.failedTables.length) text.appendChild(el('small', null, t('db.rescueMissing', { list: d.failedTables.join(', ') })));
      if (d.importError) text.appendChild(el('small', null, d.importError));
      row.appendChild(text);
      row.appendChild(el('span'));
      return row;
    });
    if (r.ok && !r.databases.length) rows.push(el('p', 'set-note', t('db.rescueNone')));
    if (!r.ok && r.message) rows.push(el('p', 'set-note bad', r.message));
    if (r.broken) rows.push(el('p', 'set-note', t('db.rescueKept', { broken: r.broken, out: r.outDir })));
    box.replaceChildren(...rows);
    refreshStatus();
    loadDatabases();
  });

  // ================================ PHP =======================================================
  const phpx = { data: null, ext: null, avail: null, busy: null, availLoading: false };
  const PHP_KEYS = ['memory_limit', 'upload_max_filesize', 'post_max_size', 'max_execution_time'];
  const LAUNCH_JSON = (port) => JSON.stringify({
    version: '0.2.0',
    configurations: [{ name: 'Listen for Xdebug', type: 'php', request: 'launch', port }],
  }, null, 2);
  const toBytes = (v) => {
    const m = String(v).trim().match(/^(\d+)([KMG]?)$/i);
    return m ? Number(m[1]) * { '': 1, K: 1024, M: 1048576, G: 1073741824 }[m[2].toUpperCase()] : null;
  };
  function switchEl(on, disabled, onClick) {
    const s = el('button', 'switch');
    s.setAttribute('role', 'switch');
    s.setAttribute('aria-checked', String(!!on));
    s.disabled = !!disabled;
    s.appendChild(el('span'));
    s.addEventListener('click', onClick);
    return s;
  }

  // php.ini fields
  function iniInputs() { return [...document.querySelectorAll('#php-ini input')]; }
  function iniPatch() {
    const p = {};
    for (const i of iniInputs()) if (i.value.trim() !== phpx.data.ini[i.dataset.key]) p[i.dataset.key] = i.value.trim();
    return p;
  }
  function updateIni() {
    if (!phpx.data) return;
    const p = iniPatch();
    for (const i of iniInputs()) i.classList.toggle('changed', i.dataset.key in p);
    const vals = Object.fromEntries(iniInputs().map((i) => [i.dataset.key, i.value]));
    const up = toBytes(vals.upload_max_filesize), post = toBytes(vals.post_max_size);
    const note = $('php-ini-note');
    const small = up !== null && post !== null && post < up;
    note.textContent = small ? t('php.postSmall') : t('php.settingsNote');
    note.classList.toggle('bad', small);
    const b = $('php-ini-save');
    b.disabled = !!phpx.busy || !Object.keys(p).length;
    b.textContent = phpx.busy === 'ini' ? t('set.saving') : t('set.save');
    b.classList.toggle('busy', phpx.busy === 'ini');
  }

  function renderPhp() {
    const d = phpx.data;
    if (!d) return;
    const busy = !!phpx.busy;
    $('php-sub').textContent = t('php.sub', { v: d.active });

    // installed versions
    $('php-versions').replaceChildren(...d.installed.map((v) => {
      const active = v === d.active;
      const actions = active ? [] : [
        button(phpx.busy === 'use:' + v ? t('php.switching') : t('php.use'), 'primary', () => usePhp(v), { busy: phpx.busy === 'use:' + v, disabled: busy }),
        button(phpx.busy === 'cmp:' + v ? t('php.comparing') : t('php.compare'), '', () => comparePhp(v), { busy: phpx.busy === 'cmp:' + v, disabled: busy }),
      ];
      return siteRow({ title: 'PHP ' + v, tags: active ? [[t('php.active'), 'fw']] : [], actions });
    }));

    // download another version
    const av = $('php-available');
    av.disabled = phpx.availLoading || busy;
    av.textContent = phpx.availLoading ? t('php.loading') : t('php.showAvailable');
    av.classList.toggle('busy', phpx.availLoading);
    if (phpx.avail) {
      $('php-download').replaceChildren(...phpx.avail.map((a) => {
        const have = d.installed.includes(a.version);
        const actions = have ? [el('span', 'tag', t('php.have'))]
          : [button(phpx.busy === 'add:' + a.branch ? t('php.getting') : t('php.get'), '', () => addPhp(a.branch),
            { busy: phpx.busy === 'add:' + a.branch, disabled: busy })];
        return siteRow({ title: 'PHP ' + a.branch, small: a.version, actions });
      }));
    }

    // php.ini fields (typed values survive a re-render)
    const box = $('php-ini');
    const keep = Object.fromEntries(iniInputs().map((i) => [i.dataset.key, i.value]));
    box.replaceChildren(...PHP_KEYS.map((k) => {
      const label = el('label');
      label.appendChild(el('span', null, k));
      const input = el('input', 'input');
      input.dataset.key = k;
      input.value = keep[k] !== undefined ? keep[k] : d.ini[k];
      input.addEventListener('input', updateIni);
      label.appendChild(input);
      return label;
    }));
    updateIni();

    // extensions
    if (phpx.ext) {
      $('php-ext').replaceChildren(...phpx.ext.extensions.map((x) => {
        const bad = x.enabled && x.ok === false;
        const row = el('div', 'ext' + (x.enabled ? ' on' : '') + (bad ? ' bad' : ''));
        const name = el('div', 'ext-name', x.name);
        const sub = bad ? t('php.extFails', { r: x.reason }) : x.default ? t('php.extDefault') : '';
        if (sub) { const s = el('small', null, sub); s.dir = 'auto'; name.appendChild(s); }
        row.appendChild(name);
        row.appendChild(switchEl(x.enabled, busy, () => setExt(x.name, !x.enabled)));
        return row;
      }));
    }

    // Xdebug
    const xd = d.xdebug;
    const sw = $('xdebug-switch');
    sw.setAttribute('aria-checked', String(xd.enabled));
    sw.disabled = busy;
    $('xdebug-sub').textContent = xd.enabled ? t('php.xdebugOn', { v: xd.version || '?', port: xd.port }) : t('php.xdebugOff');
    $('xdebug-help').hidden = !xd.enabled;
    $('xdebug-json').textContent = LAUNCH_JSON(xd.port);
  }

  async function loadPhp() {
    try { phpx.data = await api.php(); renderPhp(); } catch (e) { toast(msg(e)); return; }
    try { phpx.ext = await api.phpExtensions(); renderPhp(); } catch (e) { toast(msg(e)); }
  }

  const phpLog = [];
  function onPhpLine(line) {
    phpLog.push(line);
    const box = $('php-log');
    box.hidden = false;
    box.textContent = phpLog.slice(-200).join('\n');
    box.scrollTop = box.scrollHeight;
  }
  async function phpTask(busy, fn) {
    phpx.busy = busy;
    renderPhp();
    try { await fn(); } catch (e) { toast(msg(e)); }
    phpx.busy = null;
    await loadPhp();
    refreshStatus();
  }

  async function usePhp(v) {
    if (!(await confirmBox(t('php.useTitle', { v }), t('php.useText'), t('php.use'), false))) return;
    await phpTask('use:' + v, async () => {
      const r = await api.phpUse(v);
      toast(t('php.used', { v: r.version }));
      const rep = $('php-report');
      rep.hidden = !r.report;
      rep.textContent = r.report || '';
    });
  }
  async function comparePhp(v) {
    await phpTask('cmp:' + v, async () => {
      const r = await api.phpCompare(v);
      const rep = $('php-report');
      rep.hidden = false;
      rep.textContent = r.text;
    });
  }
  async function addPhp(branch) {
    phpLog.length = 0;
    await phpTask('add:' + branch, async () => {
      const r = await api.phpAdd(branch);
      toast(t('php.got', { v: r.version }));
    });
  }
  async function setExt(name, on) {
    await phpTask('ext:' + name, async () => {
      const r = await api.phpExtSet(name, on);
      toast(!on ? t('php.extOff', { n: name }) : r.loads ? t('php.extOn', { n: name }) : t('php.extOnBad', { n: name, r: r.reason }));
    });
  }

  $('php-available').addEventListener('click', async () => {
    phpx.availLoading = true;
    renderPhp();
    try { phpx.avail = await api.phpAvailable(); } catch (e) { toast(msg(e)); }
    phpx.availLoading = false;
    renderPhp();
  });
  $('php-ini-save').addEventListener('click', async () => {
    const patch = iniPatch();
    await phpTask('ini', async () => { await api.phpIniSet(patch); toast(t('php.saved')); });
    for (const i of iniInputs()) i.value = phpx.data.ini[i.dataset.key];
    updateIni();
  });
  $('xdebug-switch').addEventListener('click', async () => {
    const on = !phpx.data.xdebug.enabled;
    phpLog.length = 0;
    await phpTask('xdebug', () => api.xdebugSet(on));
  });
  $('xdebug-copy').addEventListener('click', async () => {
    try { await api.copy($('xdebug-json').textContent); toast(t('php.copied')); } catch (e) { toast(msg(e)); }
  });
  $('php-info').addEventListener('click', async () => {
    try { const r = await api.open('phpinfo'); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  });

  // ================================ Mail ======================================================
  const mail = { data: null, loading: false, busy: null };
  // Same colors and the same calculation as ample-mailpit.js, so a sender looks the same in both.
  const PALETTE = ['#e07b39', '#3b82c4', '#2f9e7a', '#8b5cf6', '#d9485f', '#0e9fb0', '#b7791f', '#4f7d2b'];
  const hashOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const ENV = (port) => [
    'MAIL_MAILER=smtp', 'MAIL_HOST=127.0.0.1', `MAIL_PORT=${port}`, 'MAIL_USERNAME=null', 'MAIL_PASSWORD=null',
    'MAIL_SCHEME=null', 'MAIL_FROM_ADDRESS="hello@example.com"', 'MAIL_FROM_NAME="${APP_NAME}"',
  ].join('\n');

  function renderMail() {
    const d = mail.data;
    if (!d) return;
    const busy = !!mail.busy;
    $('mail-off').hidden = d.running;
    $('mail-sub').textContent = d.running ? t('mail.count', { total: d.total, unread: d.unread }) : t('mail.sub');
    for (const id of ['mail-test', 'mail-clear', 'mail-open']) $(id).disabled = busy || !d.running;
    $('mail-clear').disabled = busy || !d.running || !d.total;
    const tb = $('mail-test');
    tb.textContent = mail.busy === 'test' ? t('mail.sending') : t('mail.test');
    tb.classList.toggle('busy', mail.busy === 'test');

    const list = $('mail-list');
    if (!d.running) list.replaceChildren();
    else if (!d.messages.length) list.replaceChildren(el('div', 'empty', t('mail.empty')));
    else {
      list.replaceChildren(...d.messages.map((m) => {
        const card = el('button', 'mail' + (m.read ? ' read' : ''));
        const who = m.fromName || m.from || '?';
        const letter = ((who.match(/[A-Za-z0-9À-￿]/) || ['?'])[0]).toUpperCase();
        const av = el('span', 'avatar', letter);
        av.style.background = PALETTE[hashOf((m.from || who).toLowerCase()) % PALETTE.length];
        card.appendChild(av);
        const main = el('div', 'mail-main');
        main.dir = 'auto';
        main.appendChild(el('div', 'mail-subject', m.subject || t('mail.noSubject')));
        const w = el('div', 'mail-who', `${who} → ${m.to}`);
        w.dir = 'ltr';
        main.appendChild(w);
        if (m.snippet) main.appendChild(el('div', 'mail-snippet', m.snippet));
        if (m.tags.length) {
          const tags = el('div', 'tags');
          for (const tg of m.tags) tags.appendChild(el('span', 'tag fw', tg));
          main.appendChild(tags);
        }
        card.appendChild(main);
        const side = el('div', 'mail-side');
        if (m.attachments) side.appendChild(el('span', 'clip', '📎'));
        side.append(m.time ? when(m.time) : '');
        card.appendChild(side);
        card.addEventListener('click', () => api.openMail(m.id).catch((e) => toast(msg(e))));
        return card;
      }));
    }
    $('mail-conn-text').textContent = t('mail.connText', { port: d.smtp });
    $('mail-env').textContent = ENV(d.smtp);
  }

  function setUnreadBadge(n) {
    const b = $('nav-unread');
    b.hidden = !n;
    b.textContent = String(n);
  }
  async function loadMail() {
    if (mail.loading) return;
    mail.loading = true;
    try {
      mail.data = await api.mail();
      setUnreadBadge(mail.data.unread);
      renderMail();
    } catch (e) { if (currentPage === 'mail') toast(msg(e)); }
    mail.loading = false;
  }

  $('mail-open').addEventListener('click', async () => {
    try { const r = await api.open('mailpit'); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  });
  $('mail-guide').addEventListener('click', async () => {
    try { const r = await api.open('mailguide'); if (r && !r.ok) toast(r.message); } catch (e) { toast(msg(e)); }
  });
  $('mail-test').addEventListener('click', async () => {
    mail.busy = 'test';
    renderMail();
    try { const r = await api.mailTest(); toast(t('mail.sent', { s: r.subject })); } catch (e) { toast(msg(e)); }
    mail.busy = null;
    loadMail();
  });
  $('mail-clear').addEventListener('click', async () => {
    if (!(await confirmBox(t('mail.clearTitle'), t('mail.clearText'), t('mail.clear'), true))) return;
    mail.busy = 'clear';
    renderMail();
    try { await api.mailClear(); toast(t('mail.cleared')); } catch (e) { toast(msg(e)); }
    mail.busy = null;
    loadMail();
  });
  $('mail-copy').addEventListener('click', async () => {
    try { await api.copy($('mail-env').textContent); toast(t('php.copied')); } catch (e) { toast(msg(e)); }
  });
  $('mail-start').addEventListener('click', async () => { await run('mailpit', 'start'); loadMail(); });

  // Progress of every long task, sent by AMPLE while it runs.
  api.onProgress((p) => {
    if (!p) return;
    if (p.kind === 'update') onUpdateLine(p.text);
    else if (p.kind === 'import') onImportProgress(p);
    else if (p.kind === 'rescue') onRescueLine(p.text);
    else if (p.kind === 'php') onPhpLine(p.text);
    else if (p.kind === 'share' && p.text) toast(p.text.trim());
    else if (p.kind === 'xampp') onXamppLine(p.text);
  });

  // ================================ Share (public link) =======================================
  const share = { data: null, busy: null };

  function shareButton(site) {
    const d = share.data;
    const mine = d && d.active && d.site === site;
    if (mine) return button(t('share.stopBtn'), 'danger', () => stopShare());
    const busy = share.busy === site;
    return button(busy ? t('share.starting') : t('share.btn'), '', () => shareSite(site), { busy, disabled: !!share.busy });
  }

  function renderShare() {
    const d = share.data;
    for (const box of document.querySelectorAll('[data-share-banner]')) {
      box.hidden = !(d && d.active);
      if (box.hidden) { box.replaceChildren(); continue; }
      const text = el('div', 'share-text');
      text.appendChild(el('b', null, '🌐 ' + t('share.live', { site: d.site })));
      const url = el('div', 'share-url', d.url);
      url.dir = 'ltr';
      text.appendChild(url);
      text.appendChild(el('small', null, d.password ? t('share.livePw') : t('share.liveNote')));
      const actions = el('div', 'share-actions');
      actions.appendChild(button(t('share.copy'), '', async () => { try { await api.copy(d.url); toast(t('php.copied')); } catch (e) { toast(msg(e)); } }));
      actions.appendChild(button(t('share.open'), '', () => api.openShare(d.url).catch((e) => toast(msg(e)))));
      actions.appendChild(button(t('share.stop'), 'danger', () => stopShare(), { busy: share.busy === 'stop', disabled: !!share.busy }));
      box.replaceChildren(el('span', 'share-dot'), text, actions);
    }
  }

  async function loadShare() {
    try {
      const before = JSON.stringify(share.data);
      share.data = await api.shareStatus();
      if (JSON.stringify(share.data) !== before) { renderShare(); renderSites(); }
    } catch { /* keep the last state */ }
  }

  // The "share this site?" box: resolves { password } (null = no password) or false.
  function shareBox(site) {
    return new Promise((resolve) => {
      const box = $('sharebox'), on = $('sharebox-pw-on'), pw = $('sharebox-pw'), hint = $('sharebox-pw-hint'), ok = $('sharebox-ok');
      $('sharebox-title').textContent = t('share.title', { site });
      on.checked = false; pw.value = ''; pw.hidden = true; hint.hidden = true;
      const check = () => {
        pw.hidden = !on.checked;
        hint.hidden = !on.checked;
        const short = on.checked && pw.value.length < 4;
        hint.textContent = short ? t('share.pwShort') : t('share.pwUser');
        hint.classList.toggle('bad', short && pw.value.length > 0);
        ok.disabled = short;
        if (on.checked && document.activeElement === on) pw.focus();
      };
      const done = (v) => {
        box.hidden = true;
        on.removeEventListener('change', check); pw.removeEventListener('input', check);
        ok.removeEventListener('click', yes); $('sharebox-cancel').removeEventListener('click', no);
        document.removeEventListener('keydown', key);
        resolve(v);
      };
      const yes = () => { if (!ok.disabled) done({ password: on.checked ? pw.value : null }); };
      const no = () => done(false);
      const key = (e) => { if (e.key === 'Escape') no(); };
      on.addEventListener('change', check); pw.addEventListener('input', check);
      ok.addEventListener('click', yes); $('sharebox-cancel').addEventListener('click', no);
      document.addEventListener('keydown', key);
      box.hidden = false;
      check();
      ok.focus();
    });
  }

  async function shareSite(site) {
    try { share.data = await api.shareStatus(); } catch { /* use the last state */ }
    // first use: download cloudflared (asked first)
    if (share.data && !share.data.installed) {
      if (!(await confirmBox(t('share.dlTitle'), t('share.dlText'), t('share.dlGo'), false))) return;
      share.busy = site;
      renderSites();
      toast(t('share.downloading'));
      try { await api.shareInstall(); } catch (e) { toast(msg(e)); share.busy = null; renderSites(); return; }
      share.busy = null;
    }
    const answer = await shareBox(site);
    if (!answer) return;
    share.busy = site;
    renderSites();
    try {
      share.data = await api.shareStart(site, answer.password || '');
      toast(t('share.started'));
    } catch (e) { toast(msg(e)); }
    share.busy = null;
    await loadShare();
    renderShare();
    renderSites();
  }

  async function stopShare() {
    if (!(await confirmBox(t('share.stopTitle'), t('share.stopText'), t('share.stop'), true))) return;
    share.busy = 'stop';
    renderShare();
    try { await api.shareStop(); toast(t('share.stopped')); } catch (e) { toast(msg(e)); }
    share.busy = null;
    await loadShare();
    renderShare();
    renderSites();
  }

  // ================================ Startup (Settings) ========================================
  const stp = { data: null, busy: false };
  const ST_SWITCHES = {
    'st-windows': (d) => d.startWithWindows, 'st-services': (d) => d.startServicesOnOpen, 'st-safe': (d) => d.safeShutdown,
    'st-desktop': (d) => d.shortcuts.desktop, 'st-start': (d) => d.shortcuts.start,
  };
  function renderStartup() {
    if (!stp.data) return;
    for (const [id, get] of Object.entries(ST_SWITCHES)) {
      $(id).setAttribute('aria-checked', String(!!get(stp.data)));
      $(id).disabled = stp.busy;
    }
  }
  async function loadStartup() {
    try { stp.data = await api.getStartup(); renderStartup(); } catch (e) { toast(msg(e)); }
  }
  async function startupChange(fn) {
    stp.busy = true;
    renderStartup();
    try { await fn(); toast(t('st.saved')); } catch (e) { toast(msg(e)); }
    stp.busy = false;
    await loadStartup();
  }
  $('st-windows').addEventListener('click', () => startupChange(() => api.setStartup('startWithWindows', !stp.data.startWithWindows)));
  $('st-services').addEventListener('click', () => startupChange(() => api.setStartup('startServicesOnOpen', !stp.data.startServicesOnOpen)));
  $('st-safe').addEventListener('click', () => startupChange(() => api.setStartup('safeShutdown', !stp.data.safeShutdown)));
  $('st-desktop').addEventListener('click', () => startupChange(() => api.setShortcut('desktop', !stp.data.shortcuts.desktop)));
  $('st-start').addEventListener('click', () => startupChange(() => api.setShortcut('start', !stp.data.shortcuts.start)));

  // ================================ Welcome (first run) =======================================
  async function welcome() {
    let st;
    try { st = await api.getStartup(); } catch { return; }
    if (st.firstRunDone) return;
    $('welcome').hidden = false;
    markSeg('wel-language', window.AMPLE_I18N.lang());
    for (const s of document.querySelectorAll('[data-wel]')) {
      s.addEventListener('click', () => s.setAttribute('aria-checked', String(s.getAttribute('aria-checked') !== 'true')));
    }
    for (const b of document.querySelectorAll('#wel-language button')) {
      b.addEventListener('click', async () => {
        try { applyLanguage(await api.setLanguage(b.dataset.v)); markSeg('wel-language', b.dataset.v); } catch (e) { toast(msg(e)); }
      });
    }
    // Is this PC ready? (one line: the details are in Settings → This computer)
    (async () => {
      const box = $('wel-check');
      try {
        const list = await api.checkPc();
        const fails = list.filter((c) => c.status === 'fail').length, warns = list.filter((c) => c.status === 'warn').length;
        box.className = 'welcome-check ' + (fails ? 'bad' : warns ? 'warn' : 'ok');
        box.replaceChildren(el('span', 'lvl ' + (fails ? 'error' : warns ? 'warning' : 'ok'), fails ? '✕' : warns ? '!' : '✓'),
          el('span', null, fails ? t('set.pcFail', { n: fails }) : warns ? t('set.pcWarn', { n: warns }) : t('set.pcOk')));
      } catch { box.hidden = true; }
    })();
    $('wel-go').addEventListener('click', async () => {
      const go = $('wel-go');
      go.disabled = true; go.classList.add('busy'); go.textContent = t('wel.going');
      const on = (k) => document.querySelector(`[data-wel="${k}"]`).getAttribute('aria-checked') === 'true';
      const steps = [];
      if (on('desktop')) steps.push(() => api.setShortcut('desktop', true));
      if (on('start')) steps.push(() => api.setShortcut('start', true));
      if (on('windows')) steps.push(() => api.setStartup('startWithWindows', true));
      if (on('path')) steps.push(() => api.setPath(true));
      if (on('https')) steps.push(() => api.httpsSet(true));
      for (const step of steps) { try { await step(); } catch (e) { toast(msg(e)); } }
      try { await api.firstRunDone(); } catch { /* shown again next time */ }
      $('welcome').hidden = true;
      refreshStatus();
    });
  }

  // ================================ navigation + links ========================================
  const PAGES = ['home', 'sites', 'databases', 'php', 'mail', 'doctor', 'settings'];
  let currentPage = 'home';
  function showPage(page) {
    if (!PAGES.includes(page)) return;
    currentPage = page;
    for (const b of document.querySelectorAll('.nav')) b.classList.toggle('active', b.dataset.page === page);
    for (const p of PAGES) $('page-' + p).hidden = p !== page;
    if (page === 'doctor') loadDoctor();
    if (page === 'sites') loadSites();
    if (page === 'databases') { loadDatabases(); renderXampp(); }
    if (page === 'php' && !phpx.busy) loadPhp();
    if (page === 'mail') loadMail();
    if (page === 'settings') { loadSettings(); loadStartup(); loadPorts(); updatePassword(); renderPc(); renderUpdates(); }
  }
  for (const b of document.querySelectorAll('.nav')) b.addEventListener('click', () => showPage(b.dataset.page));
  $('problems').addEventListener('click', () => showPage('doctor'));

  for (const q of document.querySelectorAll('[data-open]')) {
    q.addEventListener('click', async () => {
      try {
        const r = await api.open(q.dataset.open);
        if (r && !r.ok) toast(r.message);
      } catch (e) { toast(msg(e)); }
    });
  }

  // ================================ start =====================================================
  (async () => {
    try {
      setLang((await api.getSettings(false)).language);
    } catch { setLang('en'); }
    welcome();
    loop(refreshStatus, STATUS_MS);
    loop(refreshProblems, PROBLEMS_MS);
    // Log Doctor page: refreshed every 30 s while it is shown (open problems stay open).
    setInterval(() => { if (currentPage === 'doctor' && !doc.fixing) loadDoctor(); }, PROBLEMS_MS);
    // Sites page: a folder created or removed in Explorer shows up within 10 s.
    setInterval(() => { if (currentPage === 'sites' && !sites.busy && !sites.httpsBusy) loadSites(); }, 10000);
    // Databases page: new databases (made in phpMyAdmin, by your app...) show up within 10 s.
    setInterval(() => { if (currentPage === 'databases' && !dbs.busy) loadDatabases(); }, 10000);
    // Mail: every 5 s on its page (a new email shows up at once), every 30 s elsewhere (the badge).
    setInterval(() => { if (currentPage === 'mail' && !mail.busy) loadMail(); }, 5000);
    loop(() => (currentPage === 'mail' ? null : loadMail()), PROBLEMS_MS);
    // Is a site shared? (the live bar on Home and Sites)
    loop(() => (share.busy ? null : loadShare()), 5000);
    // Updates: checked once each time the panel opens (a little after, so opening stays fast)
    api.onGoto((page) => { if (page === 'settings') showPage('settings'); });
    setTimeout(autoCheckUpdates, 4000);
  })();
})();
