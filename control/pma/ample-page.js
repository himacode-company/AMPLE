/*
 * AMPLE: phpMyAdmin home page content.
 *   - adds "Quick actions" (left column) and "Connect from your app" (right column)
 *   - shortens "Database server" (drops the SSL and protocol lines)
 * The "Web server" and "phpMyAdmin" cards are hidden by ample-page.css.
 *
 * Settings come from data-* attributes on this script's tag, written by Apache from
 * ample.json (control/templates/httpd.conf.tpl): the MariaDB port and WHETHER a password
 * is set (never the password itself). phpMyAdmin loads pages with AJAX, so the home page
 * is checked again whenever the content changes.
 */
(function () {
  'use strict';

  var tag = document.querySelector('script[src*="ample-page.js"]');
  var PORT = (tag && tag.getAttribute('data-port')) || '3306';
  var HAS_PASSWORD = tag && tag.getAttribute('data-password') === '1';
  var ar = (document.documentElement.lang || '').indexOf('ar') === 0;

  var T = ar ? {
    connect: 'الاتصال من تطبيقك', host: 'الخادم (Host)', port: 'المنفذ (Port)', user: 'المستخدم', password: 'كلمة المرور',
    empty: 'فارغة', set: 'مضبوطة في AMPLE',
    hint: 'استخدمها في ملف .env في Laravel (DB_HOST و DB_PORT و DB_USERNAME و DB_PASSWORD)، أو في wp-config.php في WordPress، أو في أي برنامج MySQL.',
    hintPass: 'لتغيير كلمة المرور: ample password NEW',
    actions: 'إجراءات سريعة',
    create: 'إنشاء قاعدة بيانات', createD: 'قاعدة جديدة فارغة',
    import: 'استيراد ملف .sql', importD: 'ملف كبير؟ في الطرفية: ample import file.sql db_name (بأي حجم)',
    dash: 'لوحة AMPLE', dashD: 'مواقعك والشروحات والأسئلة الشائعة',
    copy: 'نسخ'
  } : {
    connect: 'Connect from your app', host: 'Host', port: 'Port', user: 'User', password: 'Password',
    empty: 'empty', set: 'set in AMPLE',
    hint: 'Use these in Laravel\'s .env (DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD), WordPress\'s wp-config.php, or any MySQL client.',
    hintPass: 'Change the password with: ample password NEW',
    actions: 'Quick actions',
    create: 'Create a database', createD: 'A new, empty database',
    import: 'Import a .sql file', importD: 'Big file? In a terminal: ample import file.sql db_name (any size)',
    dash: 'AMPLE dashboard', dashD: 'Your sites, how-to guides and FAQ',
    copy: 'Copy'
  };

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cardOf(id) {
    var x = document.getElementById(id);
    return x ? x.closest('.card') : null;
  }

  function enhanceHome() {
    var general = cardOf('li_select_mysql_collation');
    if (!general || document.getElementById('ample-connect')) return;   // not the home page, or done
    var left = general.parentNode;
    var right = document.querySelector('#maincontainer .col-lg-5') || left;

    // ---- Database server: find it (the right-column card that is not one we hide) ----
    var dbCard = null;
    Array.prototype.forEach.call(right.querySelectorAll(':scope > .card'), function (c) {
      if (!dbCard && !c.querySelector('#li_pma_version, #li_mysql_client_version')) dbCard = c;
    });
    var user = 'root';
    if (dbCard) {
      var rows = dbCard.querySelectorAll('.list-group-item');
      // phpMyAdmin 5.2 order: server, type, connection (SSL), version, protocol, user, charset
      if (rows.length === 7) {
        rows[2].style.display = 'none';
        rows[4].style.display = 'none';
        var m = rows[5].textContent.trim().match(/([^\s:]+)@[^\s@]+$/);
        if (m) user = m[1];
      }
    }

    // ---- Connect from your app (right column, under Database server) ----------------
    function field(label, value, copyable, note) {
      return '<div><span>' + esc(label) + '</span><div class="val">'
        + (value !== null ? '<code>' + esc(value) + '</code>' : '<em>' + esc(note) + '</em>')
        + (copyable ? '<button type="button" class="ample-copy" title="' + esc(T.copy) + '" data-copy="' + esc(value) + '">⧉</button>' : '')
        + '</div></div>';
    }
    var connect = el(
      '<div class="card mt-4" id="ample-connect">'
      + '<div class="card-header">' + esc(T.connect) + '</div>'
      + '<div class="ample-conn">'
      + field(T.host, '127.0.0.1', true)
      + field(T.port, PORT, true)
      + field(T.user, user, true)
      + field(T.password, null, false, HAS_PASSWORD ? T.set : T.empty)
      + '</div>'
      + '<div class="ample-hint">' + esc(T.hint) + (HAS_PASSWORD ? '<br>' + esc(T.hintPass) : '') + '</div>'
      + '</div>'
    );
    if (dbCard && dbCard.nextSibling) right.insertBefore(connect, dbCard.nextSibling);
    else right.appendChild(connect);

    // ---- Quick actions (left column, under Appearance) -------------------------------
    // phpMyAdmin loads links with AJAX and expects its own JSON reply; a page outside
    // phpMyAdmin (the AMPLE dashboard) must be a normal link: class "disableAjax".
    function action(href, icon, title, desc, external) {
      return '<a href="' + href + '"' + (external ? ' class="disableAjax"' : '') + '><i class="' + icon + '"></i><span><b>'
        + esc(title) + '</b><small>' + esc(desc) + '</small></span></a>';
    }
    var actions = el(
      '<div class="card mt-4" id="ample-actions">'
      + '<div class="card-header">' + esc(T.actions) + '</div>'
      + '<div class="ample-actions">'
      + action('index.php?route=/server/databases', 'i-db', T.create, T.createD)
      + action('index.php?route=/server/import', 'i-import', T.import, T.importD)
      + action('/ample/', 'i-home', T.dash, T.dashD, true)
      + '</div></div>'
    );
    left.appendChild(actions);
    // (phpMyAdmin version + license: bottom of the sidebar, see ample-nav.js)
  }

  // Pop-up windows (jQuery UI dialogs, e.g. Settings): close smoothly (✕, Cancel, Esc).
  // jQuery UI's official "beforeclose" event may cancel a close: the first time we cancel
  // it, play the closing animation (.ample-closing in ample-modal.css, window + dimmed
  // page), then close for real. Opening is animated in ample-modal.css.
  // Skipped when Windows asks for reduced motion; any error = a normal, instant close.
  try {
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm && window.jQuery) {
      jQuery(document).on('dialogbeforeclose', '.ui-dialog-content', function (ev) {
        var $content = jQuery(this);
        if ($content.data('ampleClosing')) return;          // second pass: let it close
        var $win = $content.closest('.ui-dialog');
        if (!$win.length || !$win.is(':visible')) return;
        ev.preventDefault();                                  // hold the close for the animation
        $content.data('ampleClosing', true);
        var $overlay = jQuery('.ui-widget-overlay').last();
        $win.addClass('ample-closing');
        $overlay.addClass('ample-closing');
        setTimeout(function () {
          try { $content.dialog('close'); } finally {
            $content.removeData('ampleClosing');
            $win.removeClass('ample-closing');                // ready to animate in next time
            $overlay.removeClass('ample-closing');
          }
        }, 210);
      });
    }
  } catch (e) { /* never break phpMyAdmin over an animation */ }

  // ---- Databases page: mark MariaDB's own databases (same list as the sidebar folder) ----
  var SYSTEM = ['information_schema', 'mysql', 'performance_schema', 'sys', 'test'];
  function enhanceDatabases() {
    var rows = document.querySelectorAll('#dbStatsForm tr.db-row:not(.ample-seen)');
    Array.prototype.forEach.call(rows, function (tr) {
      tr.classList.add('ample-seen');
      var name = (tr.getAttribute('data-filter-row') || '').toLowerCase();
      if (SYSTEM.indexOf(name) < 0) return;
      tr.classList.add('ample-sys-row');
      var cell = tr.querySelector('td.name');
      if (cell && !cell.querySelector('.ample-badge')) {
        var b = document.createElement('span');
        b.className = 'ample-badge';
        b.textContent = ar ? 'النظام' : 'System';
        b.title = ar ? 'قاعدة خاصة بـ MariaDB، لا تلمسها' : "MariaDB's own database: do not touch";
        cell.appendChild(b);
      }
    });
  }

  // ---- pie charts (Status > Query statistics, profiling): AMPLE colors -----------------
  // phpMyAdmin's Functions.createProfilingChart hard-codes old Tango colors. This is the
  // same function (same steps, same data) with the AMPLE palette and a cleaner look.
  // If phpMyAdmin's chart classes are missing, its own function stays. The chart library is
  // only loaded on Status pages (also via AJAX), so this is retried on every page change and
  // applied once.
  var PALETTE = ['#f08a24', '#5aa9ff', '#41c27f', '#a78bfa', '#2dd4bf', '#f472b6', '#facc15', '#38bdf8',
    '#fb923c', '#e879f9', '#f87171', '#a3e635', '#818cf8', '#67e8f9', '#c084fc', '#9ca3af'];
  function patchCharts() {
   try {
    if (window.Functions && Functions.createProfilingChart && !Functions.createProfilingChart.ample
        && typeof JQPlotChartFactory !== 'undefined'
        && typeof DataTable !== 'undefined' && typeof ChartType !== 'undefined' && typeof ColumnType !== 'undefined') {
      Functions.createProfilingChart = function (target, data) {
        var chart = new JQPlotChartFactory().createChart(ChartType.PIE, target);
        var table = new DataTable();
        table.addColumn(ColumnType.STRING, '');
        table.addColumn(ColumnType.NUMBER, '');
        table.setData(data);
        chart.draw(table, {
          seriesDefaults: {
            shadow: false,
            rendererOptions: { showDataLabels: true, dataLabelThreshold: 4, sliceMargin: 2, startAngle: -90, shadow: false }
          },
          grid: { background: 'transparent', borderWidth: 0, shadow: false, drawBorder: false },
          highlighter: { tooltipLocation: 'se', sizeAdjust: 0, tooltipAxes: 'pieref', formatString: '%s, %.9Ps' },
          legend: { show: true, location: jQuery(window).width() > 768 ? 'e' : 's', rendererOptions: { numberColumns: 1 } },
          seriesColors: PALETTE
        });
        return chart;
      };
      Functions.createProfilingChart.ample = true;
    }
    // every other jqPlot chart (Status > Monitor line charts): AMPLE colors by default, and
    // light warm grid lines. jqPlot's own official settings, before any chart is drawn.
    if (window.jQuery && jQuery.jqplot && jQuery.jqplot.config && !jQuery.jqplot.config.ampleColors) {
      jQuery.jqplot.config.defaultColors = PALETTE.slice();
      jQuery.jqplot.config.ampleColors = true;
      if (jQuery.jqplot.preInitHooks) {
        jQuery.jqplot.preInitHooks.push(function (_target, _data, options) {
          if (!options) return;
          options.grid = jQuery.extend({ gridLineColor: '#ece7df', borderColor: '#e3ded5' }, options.grid || {});
        });
      }
    }
   } catch (e) { /* keep phpMyAdmin's own chart */ }
  }
  patchCharts();

  // ---- right-click menu in SQL editors (CodeMirror) ----------------------------------
  // CodeMirror shows the browser's menu by quickly moving a hidden textarea under the
  // mouse; inside phpMyAdmin that often misses, so "Paste" is missing (old problem, also
  // in XAMPP). We catch the right-click before CodeMirror and show our own menu, using
  // CodeMirror's own API. Paste reads the clipboard (the browser asks once). Shift +
  // right-click still shows the browser's menu.
  var CTX = ar
    ? { cut: 'قص', copy: 'نسخ', paste: 'لصق', all: 'تحديد الكل', blocked: 'منع المتصفح قراءة الحافظة. اضغط Ctrl+V للصق.' }
    : { cut: 'Cut', copy: 'Copy', paste: 'Paste', all: 'Select all', blocked: 'The browser blocked reading the clipboard. Press Ctrl+V to paste.' };
  var ctxMenu = null;
  function closeCtx() { if (ctxMenu && ctxMenu.parentNode) ctxMenu.parentNode.removeChild(ctxMenu); ctxMenu = null; }
  function notify(msg) {
    if (window.Functions && Functions.ajaxShowMessage) Functions.ajaxShowMessage(msg, 4000);
    else window.alert(msg);
  }
  function openCtx(cm, x, y) {
    closeCtx();
    var host = document.getElementById('page_content') || document.body;
    var has = cm.somethingSelected();
    var m = document.createElement('div');
    m.id = 'ample-ctx';
    m.setAttribute('role', 'menu');
    m.innerHTML =
        '<button type="button" data-a="cut"' + (has ? '' : ' disabled') + '><span>' + esc(CTX.cut) + '</span><kbd>Ctrl+X</kbd></button>'
      + '<button type="button" data-a="copy"' + (has ? '' : ' disabled') + '><span>' + esc(CTX.copy) + '</span><kbd>Ctrl+C</kbd></button>'
      + '<button type="button" data-a="paste"><span>' + esc(CTX.paste) + '</span><kbd>Ctrl+V</kbd></button>'
      + '<hr><button type="button" data-a="all"><span>' + esc(CTX.all) + '</span><kbd>Ctrl+A</kbd></button>';
    host.appendChild(m);
    // keep it inside the window
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
    m.addEventListener('mousedown', function (e) { e.preventDefault(); });   // keep the editor focused
    m.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      var a = b.getAttribute('data-a');
      closeCtx();
      cm.focus();
      if (a === 'all') { cm.execCommand('selectAll'); return; }
      if (a === 'copy' || a === 'cut') {
        var text = cm.getSelection();
        var done = function () { if (a === 'cut') cm.replaceSelection(''); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {
          document.execCommand(a);      // older fallback
        });
        else document.execCommand(a);
        return;
      }
      if (a === 'paste') {
        if (!navigator.clipboard || !navigator.clipboard.readText) { notify(CTX.blocked); return; }
        navigator.clipboard.readText().then(function (t) { cm.replaceSelection(t); cm.focus(); }, function () { notify(CTX.blocked); });
      }
    });
    ctxMenu = m;
  }
  document.addEventListener('contextmenu', function (e) {
    if (e.shiftKey) return;                                       // the browser's own menu
    var box = e.target.closest && e.target.closest('.CodeMirror');
    if (!box || !box.CodeMirror) return;
    if (e.target.closest('.CodeMirror-gutters')) return;          // line numbers: leave as is
    e.preventDefault();
    e.stopPropagation();                                          // before CodeMirror sees it
    openCtx(box.CodeMirror, e.clientX, e.clientY);
  }, true);
  document.addEventListener('mousedown', function (e) { if (ctxMenu && !ctxMenu.contains(e.target)) closeCtx(); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCtx(); }, true);
  window.addEventListener('scroll', closeCtx, true);
  window.addEventListener('blur', closeCtx);

  // ---- Database > Data dictionary: cards + table index (content itself is unchanged) ----
  // Recognised by its shape: <h1>db</h1> followed by the Print button, then one <div> per
  // table (<h2>name</h2>, comments, columns table, "Indexes" ...).
  function enhanceDataDictionary() {
    var h1 = document.querySelector('#page_content > .container-fluid > h1');
    if (!h1) return;
    var box = h1.parentNode;
    if (box.classList.contains('ample-dd')) return;                       // done already
    var next = h1.nextElementSibling;
    if (!next || !next.querySelector('.jsPrintButton')) return;           // not the data dictionary
    box.classList.add('ample-dd');

    var heads = box.querySelectorAll('h2');
    var toc = document.createElement('nav');
    toc.className = 'ample-dd-toc d-print-none';
    Array.prototype.forEach.call(heads, function (h2, i) {
      var card = h2.parentNode;
      if (!card || card === box) return;
      card.classList.add('ample-dd-card');
      var name = h2.textContent.trim();
      card.id = 'ample-dd-' + i;
      var a = document.createElement('a');
      a.href = '#' + card.id;
      a.className = 'disableAjax';
      a.textContent = name;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(a);
      // "(Primary)" after a column name -> a small "PK" badge
      Array.prototype.forEach.call(card.querySelectorAll('table:first-of-type tbody td:first-child em'), function (em) {
        if (/^\(.*\)$/.test(em.textContent.trim())) {
          em.className = 'ample-pk';
          em.title = em.textContent.trim().replace(/[()]/g, '');
          em.textContent = 'PK';
        }
      });
    });
    var sub = document.createElement('p');
    sub.className = 'ample-dd-sub';
    sub.textContent = (ar ? 'قاموس البيانات · ' : 'Data dictionary · ') + toc.children.length + (ar ? ' جدول' : ' tables');
    h1.parentNode.insertBefore(sub, h1.nextSibling);
    if (next.parentNode) next.parentNode.insertBefore(toc, next.nextSibling);
  }

  // ---- Browse: column visibility list ------------------------------------------------
  // phpMyAdmin shows it under the arrow in the action column's header, inside the table's
  // card. That card scrolls sideways, so it would cut a long list off. While the list is
  // open, pin it to the screen right under its arrow (it then can't be cut), and keep it
  // there when the page scrolls. phpMyAdmin still decides when it opens and closes.
  function placeColList() {
    var list = document.querySelector('#page_content .cList');
    // (not offsetParent: it is always null for a position:fixed element)
    if (!list || getComputedStyle(list).display === 'none') return;
    var arrow = document.querySelector('#page_content .cDrop .coldrop-hover');
    if (!arrow) return;
    var r = arrow.getBoundingClientRect();
    list.style.position = 'fixed';
    list.style.top = Math.round(r.bottom + 4) + 'px';
    list.style.right = 'auto';
    list.style.marginLeft = '0';
    list.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 20) + 'px';
    list.style.overflowY = 'auto';
    // open to the RIGHT of the arrow (the arrow sits near the table's left edge, next to the
    // sidebar), then keep the whole list on screen and never under the sidebar
    var nav = document.getElementById('pma_navigation');
    var minLeft = (nav ? nav.getBoundingClientRect().right : 0) + 8;
    var w = list.offsetWidth || 220;
    var left = Math.round(r.left);
    if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w;
    list.style.left = Math.max(minLeft, left) + 'px';
  }
  document.addEventListener('click', function (ev) {
    if (ev.target.closest && ev.target.closest('#page_content .cDrop')) setTimeout(placeColList, 0);
  });

  // ---- drop-down menus inside a table card (e.g. "More" on each column) -------------------
  // The card cuts off what goes outside it, so a menu opened near its bottom would be cut.
  // Bootstrap's own option: position the menu "fixed" (relative to the screen) instead.
  // Set on the menu's instance right before it opens ("show.bs.dropdown" comes first).
  document.addEventListener('show.bs.dropdown', function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('#page_content :is(.table-responsive-md, .table-responsive)')) return;
    try {
      var inst = window.bootstrap && window.bootstrap.Dropdown && window.bootstrap.Dropdown.getInstance(t);
      if (inst && inst._config) {
        inst._config.popperConfig = function (cfg) { return Object.assign({}, cfg, { strategy: 'fixed' }); };
      }
    } catch (err) { /* keep Bootstrap's default */ }
  });

  // ---- Browse: cell editor (click / double-click a cell to edit it) ---------------------
  // phpMyAdmin places its editor over the cell, inside the table's card, so a long text's
  // box could not be made bigger than the card. While editing, pin the editor to the
  // screen over its cell (same place), so it can grow freely; it follows the cell when the
  // page or the table scrolls. Saving / cancelling stays phpMyAdmin's.
  var editCell = null;
  function placeCellEditor() {
    if (!editCell || !document.body.contains(editCell)) { editCell = null; return; }
    var box = null;
    Array.prototype.forEach.call(document.querySelectorAll('#page_content .cEdit'), function (c) {
      if (getComputedStyle(c).display !== 'none') box = c;
    });
    if (!box) { editCell = null; return; }
    var r = editCell.getBoundingClientRect();
    box.style.position = 'fixed';
    box.style.top = Math.round(r.top) + 'px';
    box.style.left = Math.round(r.left) + 'px';
  }
  function onCellOpen(ev) {
    var td = ev.target.closest && ev.target.closest('#page_content table.table_results td.grid_edit');
    if (!td) return;
    setTimeout(function () { editCell = td; placeCellEditor(); }, 0);
  }
  document.addEventListener('click', onCellOpen);
  document.addEventListener('dblclick', onCellOpen);
  // ---- wide tables: floating ◀ ▶ buttons on the card's sides ----------------------------
  // For every table card that scrolls sideways: two round buttons, half outside the card,
  // in the middle of the part of the table that is on screen (they follow the page as you
  // scroll down). Click = 300px smooth; hold = keeps moving. A button hides at its end,
  // both hide when the table does not need scrolling or is off screen.
  var CHEV = {
    left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
    right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>'
  };
  function makeArrow(wrap, dir) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ample-hscroll is-off';
    b.setAttribute('aria-label', dir < 0 ? (ar ? 'تمرير لليسار' : 'Scroll left') : (ar ? 'تمرير لليمين' : 'Scroll right'));
    b.innerHTML = dir < 0 ? CHEV.left : CHEV.right;
    var hold = null, repeat = null;
    function stop() { clearTimeout(hold); clearInterval(repeat); hold = repeat = null; }
    b.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      wrap.scrollBy({ left: dir * 300, behavior: 'smooth' });
      hold = setTimeout(function () {              // still pressed: keep moving
        repeat = setInterval(function () { wrap.scrollLeft += dir * 40; }, 30);
      }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(function (t) { b.addEventListener(t, stop); });
    (document.getElementById('page_content') || document.body).appendChild(b);
    return b;
  }
  function placeHScroll() {
    var wraps = document.querySelectorAll('#page_content .table-responsive-md, #page_content .table-responsive');
    Array.prototype.forEach.call(wraps, function (wrap) {
      var a = wrap._ampleArrows;
      if (!a || !document.body.contains(a[0])) a = wrap._ampleArrows = [makeArrow(wrap, -1), makeArrow(wrap, 1)];
      var max = wrap.scrollWidth - wrap.clientWidth;
      var r = wrap.getBoundingClientRect();
      var top = Math.max(r.top, 70), bottom = Math.min(r.bottom - 14, window.innerHeight - 10);   // part on screen
      var shown = max > 2 && bottom - top > 60 && wrap.offsetParent !== null;
      var y = Math.round((top + bottom) / 2 - 19);
      a[0].style.top = a[1].style.top = y + 'px';
      a[0].style.left = Math.round(r.left - 19) + 'px';
      a[1].style.left = Math.round(r.right - 19) + 'px';
      a[0].classList.toggle('is-off', !shown || wrap.scrollLeft <= 1);
      a[1].classList.toggle('is-off', !shown || wrap.scrollLeft >= max - 1);
    });
    // buttons whose table is gone (page changed): remove
    Array.prototype.forEach.call(document.querySelectorAll('#page_content .ample-hscroll'), function (b) {
      var keep = Array.prototype.some.call(wraps, function (w) { return w._ampleArrows && w._ampleArrows.indexOf(b) >= 0; });
      if (!keep) b.parentNode.removeChild(b);
    });
  }

  function followAll() { placeColList(); placeCellEditor(); placeHScroll(); }
  window.addEventListener('scroll', followAll, true);
  window.addEventListener('resize', followAll);

  // ---- Change column / Add column / Create table: one card per column ------------------
  // phpMyAdmin shows one very wide row per column. We keep every field as it is (same
  // names: saving works as before) and only add: a label on each field (from the page's own,
  // translated header row), a mark on checkbox-only cells (Null, A_I ...) so they go to their
  // own line, and a card title "Column: <name>". ample-page.css draws the cards.
  function headerText(th) {
    if (!th) return '';
    var abbr = th.querySelector('abbr[title]');
    var c = th.cloneNode(true);
    Array.prototype.forEach.call(c.querySelectorAll('.pma_hint, .hide, a[target]'), function (h) { h.remove(); });
    var t = c.textContent.replace(/\s+/g, ' ').trim();
    return abbr ? t + ' · ' + abbr.getAttribute('title') : t;
  }
  function enhanceColumnForms() {
    var table = document.querySelector('#page_content #table_columns');
    if (!table) return;
    table.classList.add('ample-colform');
    var rows = Array.prototype.slice.call(table.rows);
    var head = rows.filter(function (r) { return r.cells.length && !r.querySelector('td'); })[0];
    if (!head) return;
    head.classList.add('ample-colhead');
    var labels = Array.prototype.map.call(head.cells, headerText);
    var word = ar ? 'العمود' : 'Column';
    rows.forEach(function (tr, n) {
      if (tr === head || tr.classList.contains('ample-colcard') || !tr.querySelector('td')) return;
      tr.classList.add('ample-colcard');
      Array.prototype.forEach.call(tr.cells, function (td, i) {
        td.setAttribute('data-label', labels[i] || '');
        var fields = td.querySelectorAll('input:not([type="hidden"]), select, textarea');
        var onlyBoxes = fields.length > 0 && Array.prototype.every.call(fields, function (f) { return f.type === 'checkbox'; });
        td.classList.add(onlyBoxes ? 'ample-toggle' : 'ample-field');
      });
      var name = tr.querySelector('input[name^="field_name"]');
      var title = function () { tr.setAttribute('data-title', word + ': ' + (name && name.value.trim() ? name.value.trim() : '#' + n)); };
      title();
      if (name) name.addEventListener('input', title);
    });
  }

  // ---- Insert (and edit row): a form card per record instead of a table -----------------
  // Every field stays phpMyAdmin's (same names: inserting works as before). We only mark the
  // parts of each column row by what they contain (not by position, so hiding the Function
  // or Type column in phpMyAdmin's settings is fine), title each record "Row N", and move each
  // "Ignore" checkbox (it stays inside the same form) into the header of the record it belongs
  // to. A record set to "Ignore" is shown faded. ample-page.css draws it.
  function enhanceInsertForm() {
    var form = document.querySelector('#page_content #insertForm');
    if (!form) return;
    var tables = form.querySelectorAll('table.insertRowTable');
    var funcHead = '';
    Array.prototype.forEach.call(tables, function (table, n) {
      var box = table.closest('.table-responsive-lg') || table.parentNode;
      if (!table.classList.contains('ample-ins')) {
        table.classList.add('ample-ins');
        box.classList.add('ample-ins-card');
        box.setAttribute('data-title', (ar ? 'السجل ' : 'Row ') + (n + 1));
        if (!funcHead && table.tHead) {
          Array.prototype.forEach.call(table.tHead.rows[0].cells, function (th) {
            if (th.querySelector('a[data-post*="ShowFunctionFields=0"]')) funcHead = th.textContent.trim();
          });
        }
        Array.prototype.forEach.call(table.tBodies[0] ? table.tBodies[0].rows : [], function (tr) {
          tr.classList.add('ample-ins-field');
          Array.prototype.forEach.call(tr.cells, function (td, i) {
            if (i === 0) td.classList.add('ins-name');
            else if (td.querySelector('.column_type')) td.classList.add('ins-type');
            else if (td.querySelector('select[name^="funcs"]')) {
              td.classList.add('ins-func');
              td.querySelector('select').title = funcHead || 'Function';   // its name, as a tooltip
            }
            else if (td.hasAttribute('data-type')) td.classList.add('ins-value');
            else td.classList.add('ins-null', td.querySelector('input.checkbox_null') ? 'has-null' : 'no-null');
          });
          if (tr.querySelector('.ins-value textarea, .ins-value select[multiple]')) tr.classList.add('ins-wide');
        });
      }
      // the "Ignore" checkbox right before this record's box belongs to it: move it into its header
      var ign = form.querySelector('input[name="insert_ignore_' + n + '"]');
      if (ign && !box.contains(ign)) {
        var label = form.querySelector('label[for="' + ign.id + '"]');
        var wrap = document.createElement('label');
        wrap.className = 'ample-ignore';
        wrap.appendChild(ign);
        wrap.appendChild(document.createTextNode(' ' + (label ? label.textContent.trim() : 'Ignore')));
        if (label) label.remove();
        box.appendChild(wrap);
        var sync = function () { box.classList.toggle('is-ignored', ign.checked); };
        sync();
        ign.addEventListener('change', sync);
        // phpMyAdmin unticks "Ignore" itself when you type in that record: follow it
        box.addEventListener('input', function () { setTimeout(sync, 0); });
        box.addEventListener('change', function () { setTimeout(sync, 0); });
      }
    });
  }

  // ---- User accounts: mark the account phpMyAdmin is connected with ----------------------
  // phpMyAdmin gives scripts only the user NAME (CommonParams "user"). The account is name +
  // host. AMPLE's phpMyAdmin always connects to 127.0.0.1, and MariaDB picks the most specific
  // matching host: 'name'@'127.0.0.1' if it exists, else 'name'@'%' ('localhost' is not used
  // for a 127.0.0.1 connection with skip-name-resolve). Same rule here.
  function enhanceUserAccounts() {
    var table = document.querySelector('#page_content #userRightsTable');
    if (!table || table.querySelector('tr.ample-me')) return;
    var me = window.CommonParams && CommonParams.get ? CommonParams.get('user') : '';
    if (!me) return;
    var byHost = {};
    Array.prototype.forEach.call(table.tBodies[0] ? table.tBodies[0].rows : [], function (tr) {
      if (tr.cells.length < 3) return;
      if (tr.cells[1].textContent.trim() === me) byHost[tr.cells[2].textContent.trim()] = tr;
    });
    var row = byHost['127.0.0.1'] || byHost['%'];
    if (!row) return;
    row.classList.add('ample-me');
    var b = document.createElement('span');
    b.className = 'ample-me-badge';
    b.textContent = ar ? 'أنت' : 'You';
    b.title = ar ? 'phpMyAdmin متصل بهذا الحساب' : 'phpMyAdmin is connected with this account';
    row.cells[1].appendChild(b);
  }

  // ---- Browse: row actions show icons only; keep their word as a tooltip -------------------
  function enhanceGridActions() {
    var links = document.querySelectorAll('#page_content table.table_results tbody td.d-print-none a:not([data-ample-tip])');
    Array.prototype.forEach.call(links, function (a) {
      a.setAttribute('data-ample-tip', '1');
      var word = a.textContent.replace(/\s+/g, ' ').trim();   // "Edit", "Copy", "Delete" (translated)
      if (word && !a.title) a.title = word;
      if (word) a.setAttribute('aria-label', word);
    });
  }

  // ---- ON/OFF toggles (e.g. Events > Event scheduler status) -----------------------------
  // phpMyAdmin's toggle measures its parts in pixels and slides them with JavaScript, so
  // restyling it would break it. Instead: our own switch next to it; phpMyAdmin's stays in the
  // page (only hidden from view) and does the real work: our switch clicks it, and follows its
  // state (it only flips once the server accepted the change).
  function enhanceToggles() {
    var toggles = document.querySelectorAll('#page_content .toggleButton:not(.ample-proxied)');
    Array.prototype.forEach.call(toggles, function (tb) {
      var box = tb.querySelector('div.toggle-container');
      if (!box) return;
      tb.classList.add('ample-proxied');
      var onTxt = (tb.querySelector('td.toggleOn > div') || {}).textContent || 'ON';
      var offTxt = (tb.querySelector('td.toggleOff > div') || {}).textContent || 'OFF';
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'ample-switch';
      sw.setAttribute('role', 'switch');
      sw.innerHTML = '<span class="ample-switch-track"><span class="ample-switch-knob"></span></span><span class="ample-switch-text"></span>';
      var sync = function () {
        var on = box.classList.contains('on');
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        sw.classList.toggle('is-on', on);
        sw.classList.toggle('is-busy', box.classList.contains('isActive'));
        sw.querySelector('.ample-switch-text').textContent = (on ? onTxt : offTxt).trim();
      };
      sync();
      new MutationObserver(sync).observe(box, { attributes: true, attributeFilter: ['class'] });
      sw.addEventListener('click', function () {
        if (window.jQuery) jQuery(box).trigger('click'); else box.click();
      });
      tb.parentNode.insertBefore(sw, tb.nextSibling);
    });
  }

  // copy buttons
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('#page_content .ample-copy');
    if (!b) return;
    var done = function () {
      b.textContent = '✓'; b.classList.add('done');
      setTimeout(function () { b.textContent = '⧉'; b.classList.remove('done'); }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(b.getAttribute('data-copy')).then(done, function () {});
  });

  // run now, and again whenever phpMyAdmin replaces the page content (AJAX navigation)
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false; patchCharts(); enhanceHome(); enhanceDatabases(); enhanceDataDictionary(); enhanceColumnForms(); enhanceInsertForm(); enhanceUserAccounts(); enhanceGridActions(); enhanceToggles(); placeHScroll();
    });
  }
  function start() {
    enhanceHome();
    enhanceDatabases();
    enhanceDataDictionary();
    enhanceColumnForms();
    enhanceInsertForm();
    enhanceUserAccounts();
    enhanceGridActions();
    enhanceToggles();
    placeHScroll();
    // body (not #page_content): it is never replaced, so the watch survives any navigation
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
