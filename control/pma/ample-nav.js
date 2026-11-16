/*
 * AMPLE: groups phpMyAdmin's database list (left sidebar) into two "folders".
 *
 *   My databases            <- everything you create (always: any name not listed below)
 *     New, shop, blog ...
 *   System — Do not touch   <- MariaDB's own databases, collapsed by default
 *     information_schema, mysql, performance_schema, sys, test
 *
 * Display only: nothing is moved or changed in MariaDB. The <li> items are only
 * re-ordered inside phpMyAdmin's own list (never wrapped in new lists), so its features
 * (filter, expand tables, reload) keep working. Loaded on /phpmyadmin/ pages by Apache
 * (see control/templates/httpd.conf.tpl), so no phpMyAdmin file is modified.
 */
(function () {
  'use strict';

  var SYSTEM = ['information_schema', 'mysql', 'performance_schema', 'sys', 'test'];
  var KEY = 'ample-pma-system-open';
  var ar = (document.documentElement.lang || '').indexOf('ar') === 0;
  var LABEL = {
    mine: ar ? 'قواعد بياناتي' : 'My databases',
    system: ar ? 'النظام — لا تلمس' : 'System — Do not touch',
    hint: ar ? 'قواعد MariaDB الخاصة. لا تحذفها ولا تعدّلها.' : "MariaDB's own databases. Do not delete or change them."
  };

  // Styles for the folders and the whole sidebar: control/pma/ample-nav.css

  // ---- "by AMPLE" under the phpMyAdmin logo (the logo itself is kept as it is) --------
  var MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="28 78 456 348" aria-hidden="true">'
    + '<g fill="#f08a24" stroke="#f08a24" stroke-width="6" stroke-linejoin="round">'
    + '<path d="M206.3 105 Q214 91 228 91 L280.5 91 Q294.4 91 302.1 105 L404.1 290.9 L322.8 290.9 L288.6 228 C266.8 187.9 240.2 187.9 218.6 228 L184.6 290.9 L104.2 290.9 Z"/>'
    + '<path d="M90.2 316.5 L205 316.5 L205 343.3 L180 343.3 Q157 343.3 138.9 375 L124.1 401 Q117.9 411.9 105 411.9 L37.8 411.9 Z"/>'
    + '<path d="M300 316.5 L418.2 316.5 L470.6 411.9 L401 411.9 Q388.1 411.9 381.9 401 L367.1 375 Q349 343.3 325 343.3 L300 343.3 Z"/></g>'
    + '<path d="M172 330.5 L177.6 330.5 Q191.6 330.5 198 343 L210.9 368.3 Q218.2 382.5 222.6 367.1 L249.3 273.2 Q254.8 254 261.5 272.8 L289 349.5 Q293.7 362.7 298.8 351.9 L304.7 339.5 Q309 330.5 319 330.5 L324 330.5" fill="none" stroke="#f08a24" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function addBy() {
    var logo = document.getElementById('pmalogo');
    if (!logo || document.getElementById('ample-by')) return;
    var by = document.createElement('div');
    by.id = 'ample-by';
    by.innerHTML = '<span>by</span>' + MARK + '<b>AMPLE</b>';
    logo.parentNode.insertBefore(by, logo.nextSibling);
  }

  // ---- light / dark for the page content (the sidebar, top bar and console stay dark) ----
  // The mode is the attribute data-theme on <html>, set before drawing by a tiny script that
  // Apache puts in every page. The choice is saved as "ample-theme", the same key the AMPLE
  // dashboard uses (same site: localhost), so both follow each other, even in another tab.
  // No saved choice = follow Windows.
  var THEME_KEY = 'ample-theme';
  function systemTheme() { return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function savedTheme() { try { var t = localStorage.getItem(THEME_KEY); return t === 'dark' || t === 'light' ? t : null; } catch (e) { return null; } }
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var b = document.getElementById('ample-theme');
    if (b) {
      var next = t === 'dark' ? (ar ? 'الوضع الفاتح' : 'Light mode') : (ar ? 'الوضع الغامق' : 'Dark mode');
      b.title = next;
      b.setAttribute('aria-label', next);
    }
  }
  function addThemeButton() {
    var row = document.getElementById('navipanellinks');
    if (!row || document.getElementById('ample-theme')) return;
    var b = document.createElement('a');
    b.href = '#';
    b.id = 'ample-theme';
    b.className = 'disableAjax';
    b.innerHTML = '<span class="ample-theme-icon"></span>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var t = currentTheme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, t); } catch (err) { /* not saved, still applied */ }
      applyTheme(t);
    });
    row.appendChild(b);
    applyTheme(currentTheme());
  }
  // the dashboard (or another tab) changed it
  window.addEventListener('storage', function (e) { if (e.key === THEME_KEY) applyTheme(savedTheme() || systemTheme()); });
  // Windows changed it, and there is no saved choice
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var onSystem = function () { if (!savedTheme()) applyTheme(systemTheme()); };
    if (mq.addEventListener) mq.addEventListener('change', onSystem); else if (mq.addListener) mq.addListener(onSystem);
  }

  // ---- bottom of the sidebar: "phpMyAdmin 5.2.3 · GPL License" (on every page) --------
  // The version comes from phpMyAdmin's own file links (…js?v=5.2.3).
  function addFoot() {
    var nav = document.getElementById('pma_navigation');
    if (!nav || document.getElementById('ample-sb-foot')) return;
    var src = document.querySelector('script[src*="?v="]');
    var m = src && src.getAttribute('src').match(/[?&]v=([0-9][0-9A-Za-z.\-]*)/);
    var foot = document.createElement('div');
    foot.id = 'ample-sb-foot';
    foot.innerHTML = 'phpMyAdmin' + (m ? ' ' + m[1].replace(/[^0-9A-Za-z.\-]/g, '') : '')
      + ' · <a class="disableAjax" href="index.php?route=/license" target="_blank" rel="noopener">'
      + (ar ? 'رخصة GPL' : 'GPL License') + '</a>';
    // inside the sidebar's content column (after the list), so it takes its own place
    (document.getElementById('pma_navigation_content') || nav).appendChild(foot);
  }

  function storedOpen() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function storeOpen(open) {
    try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) { /* private mode: not remembered */ }
  }

  function dbName(li) {
    var a = li.querySelector(':scope > a.hover_show_full');
    return a ? a.textContent.trim() : '';
  }

  function folder(kind, count, open) {
    var li = document.createElement('li');
    li.className = 'ample-folder ' + kind + (open ? ' open' : '');
    li.dataset.ample = kind;
    if (kind === 'system') li.title = LABEL.hint;
    li.innerHTML = '<span class="ample-caret">▸</span><span></span><span class="ample-count"></span>';
    li.children[1].textContent = LABEL[kind];
    li.children[2].textContent = String(count);
    return li;
  }

  var observer;

  function group() {
    var ul = document.querySelector('#pma_navigation_tree_content > ul');
    if (!ul) return;

    var items = Array.prototype.filter.call(ul.children, function (li) { return li.tagName === 'LI'; });
    var newDb = items.filter(function (li) { return li.classList.contains('new_database'); });
    var dbs = items.filter(function (li) { return li.classList.contains('database'); });
    if (!dbs.length && !newDb.length) return;   // not the database list (e.g. a single-db view)

    var mine = [], system = [];
    dbs.forEach(function (li) { (SYSTEM.indexOf(dbName(li)) >= 0 ? system : mine).push(li); });

    // keep the folders we already made (so their open state survives), or create them
    var fMine = ul.querySelector(':scope > li[data-ample="mine"]');
    var fSys = ul.querySelector(':scope > li[data-ample="system"]');
    var current = new URLSearchParams(location.search).get('db');
    var sysOpen = storedOpen() || SYSTEM.indexOf(current) >= 0;   // open it when you are inside one
    if (!fMine) fMine = folder('mine', 0, true);
    if (!fSys) fSys = folder('system', 0, sysOpen);
    else if (sysOpen) fSys.classList.add('open');
    fMine.querySelector('.ample-count').textContent = String(mine.length);
    fSys.querySelector('.ample-count').textContent = String(system.length);

    var mineOpen = fMine.classList.contains('open');
    var sysIsOpen = fSys.classList.contains('open');
    newDb.concat(mine).forEach(function (li) {
      li.classList.add('ample-in');
      li.classList.toggle('ample-hidden', !mineOpen);
    });
    system.forEach(function (li) {
      li.classList.add('ample-in', 'ample-sys');
      li.classList.toggle('ample-hidden', !sysIsOpen);
    });

    // the wanted order; re-insert only if it differs (avoids an endless observer loop)
    var others = items.filter(function (li) {
      return !li.dataset.ample && newDb.indexOf(li) < 0 && dbs.indexOf(li) < 0;
    });
    var wanted = [fMine].concat(newDb, mine, system.length ? [fSys] : [], system, others);
    var now = Array.prototype.filter.call(ul.children, function (li) { return li.tagName === 'LI'; });
    var same = now.length === wanted.length && wanted.every(function (li, i) { return now[i] === li; });
    if (!same) wanted.forEach(function (li) { ul.appendChild(li); });
    if (!system.length && fSys.parentNode) fSys.parentNode.removeChild(fSys);
  }

  function regroup() {
    if (observer) observer.disconnect();
    try { addBy(); addFoot(); addThemeButton(); group(); } finally { watch(); }
  }

  // click on a folder title: open / close it
  document.addEventListener('click', function (ev) {
    var f = ev.target.closest && ev.target.closest('#pma_navigation_tree_content li.ample-folder');
    if (!f) return;
    ev.preventDefault();
    var open = !f.classList.contains('open');
    f.classList.toggle('open', open);
    if (f.dataset.ample === 'system') storeOpen(open);
    regroup();
  });

  // phpMyAdmin rebuilds the list (create/drop database, reload): group it again each time
  var pending = false;
  function watch() {
    var nav = document.getElementById('pma_navigation');
    if (!nav) return;
    if (!observer) {
      observer = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; regroup(); });
      });
    }
    observer.observe(nav, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', regroup);
  else regroup();
})();
