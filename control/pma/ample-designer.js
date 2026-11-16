/*
 * AMPLE: phpMyAdmin Designer, redesigned (styles: ample-designer.css). Runs on the Designer
 * page only. No phpMyAdmin file is changed: two of its drawing functions are replaced at
 * run time (same inputs, our look), everything else is added around it.
 *   1. each table gets its own header color (from its name: always the same color)
 *   2. column rows: "name : type" split into name / type, an "FK" badge on foreign keys
 *   3. relationship lines: smooth curves (or rounded right angles), 2px, a dot at the foreign
 *      key, an arrow at the referenced table; colored by the referenced table
 *   4. auto arrange: when the tables lie on top of each other (no saved page), place them by
 *      their relations: referenced ("parent") tables first, then the tables that point to
 *      them, column by column; tables without relations in a grid after them
 *   5. an "Auto arrange" button in the side toolbar
 * Positions are only kept if you press "Save page" (phpMyAdmin's own behaviour).
 */
(function () {
  'use strict';

  var ar = (document.documentElement.lang || '').indexOf('ar') === 0;
  var COLORS = ['#d9731a', '#2f7ad1', '#1f8a52', '#7c5cd6', '#c2417a', '#138a7e', '#b45309', '#4f5bd5',
    '#0e7fb5', '#9d4edd', '#c0392b', '#4d7c0f', '#0f766e', '#a16207'];

  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function colorFor(name) { return COLORS[hash(name) % COLORS.length]; }
  function isDesigner() { return !!(window.DesignerMove && window.designerConfig && document.getElementById('osn_tab')); }
  function tables() {
    return Array.prototype.filter.call(document.querySelectorAll('#page_content table.designer_tab'), function (t) {
      return t.style.display !== 'none' && t.offsetParent !== null;
    });
  }

  // ---- relations, from phpMyAdmin's own data: [{constraint: {table: {column: [refTable, refColumn]}}}]
  function relations() {
    var out = [];
    var contr = (window.designerConfig && window.designerConfig.scriptContr) || window.contr || [];
    Array.prototype.forEach.call(contr, function (group) {
      Object.keys(group || {}).forEach(function (cname) {
        var byTable = group[cname] || {};
        Object.keys(byTable).forEach(function (tbl) {
          Object.keys(byTable[tbl] || {}).forEach(function (col) {
            var ref = byTable[tbl][col];
            if (ref && ref[0]) out.push({ from: tbl, col: col, to: ref[0], toCol: ref[1] });
          });
        });
      });
    });
    return out;
  }

  // ---- 1 + 2: table colors, column rows, FK badges --------------------------------------
  function redraw() {
    try { if (window.DesignerMove && window.contr) window.DesignerMove.reload(); } catch (e) { /* not ready yet */ }
  }
  function styleTables() {
    var changed = false;
    var fk = {};
    relations().forEach(function (r) { fk[r.from + '.' + r.col] = true; });
    tables().forEach(function (t) {
      if (!t.dataset.ampleColor) {
        t.dataset.ampleColor = '1';
        t.style.setProperty('--ample-tc', colorFor(t.id || t.getAttribute('table_name_url') || ''));
      }
      Array.prototype.forEach.call(t.querySelectorAll('tbody > tr > td > div:not(.ample-split)'), function (div) {
        var text = div.textContent.replace(/\s+/g, ' ').trim();
        var at = text.indexOf(' : ');
        if (at < 0) return;
        div.classList.add('ample-split');
        changed = true;
        var img = div.querySelector('img');
        while (div.lastChild && div.lastChild !== img) div.removeChild(div.lastChild);
        if (img && img.nextSibling) div.removeChild(img.nextSibling);
        var name = document.createElement('span');
        name.className = 'ample-dcol';
        name.textContent = text.slice(0, at);
        var type = document.createElement('span');
        type.className = 'ample-dtype';
        type.textContent = text.slice(at + 3);
        div.appendChild(name);
        var td = div.parentNode;
        if (td && td.id && fk[td.id]) {
          var b = document.createElement('span');
          b.className = 'ample-fk-badge';
          b.textContent = 'FK';
          b.title = ar ? 'مفتاح أجنبي' : 'Foreign key';
          div.appendChild(b);
        }
        div.appendChild(type);
      });
      // collapsed state (header arrow) for the chevron direction
      var toggle = t.querySelector('td.small_tab');
      if (toggle) t.classList.toggle('ample-collapsed', toggle.textContent.trim() !== 'v');
    });
    if (changed) redraw();   // the cards changed size: lines must follow
  }

  // ---- 3: relationship lines --------------------------------------------------------------
  function patchLines() {
    var DM = window.DesignerMove;
    if (!DM || DM.ampleLines) return;
    DM.ampleLines = true;
    // one color per referenced table (all lines into "users" share a color)
    DM.getColorByTarget = function (target) {
      var parts = String(target || '').split('.');
      return colorFor(parts.slice(0, 2).join('.'));
    };
    DM.line0 = function (x1, y1, x2, y2, color) {
      if (!window.showRelationLines) return;
      var canvas = document.getElementById('canvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      // which side each end leaves from (same rule phpMyAdmin uses: sLeft / sRight globals)
      var d1, d2;
      if (window.sRight) { d1 = 1; d2 = 1; } else if (window.sLeft) { d1 = -1; d2 = -1; } else if (x1 < x2) { d1 = 1; d2 = -1; } else { d1 = -1; d2 = 1; }
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      if (window.onAngularDirect) {
        // smooth curve
        var dx = Math.max(45, Math.abs(x2 - x1) / 2);
        ctx.bezierCurveTo(x1 + d1 * dx, y1, x2 + d2 * dx, y2, x2 + d2 * 9, y2);
      } else {
        // right angles with rounded corners
        var xs = (d1 === d2) ? (d1 > 0 ? Math.max(x1, x2) + 24 : Math.min(x1, x2) - 24) : (x1 + x2) / 2;
        var r = Math.min(8, Math.abs(y2 - y1) / 2, Math.abs(xs - x1), Math.abs(xs - x2)) || 0;
        ctx.arcTo(xs, y1, xs, y2, r);
        ctx.arcTo(xs, y2, x2, y2, r);
        ctx.lineTo(x2 + d2 * 9, y2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // foreign-key end: a dot with a white ring
      ctx.beginPath();
      ctx.arc(x1, y1, 4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      // referenced end: an arrow pointing into the table
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 + d2 * 10, y2 - 5);
      ctx.lineTo(x2 + d2 * 10, y2 + 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    redraw();   // lines already drawn the old way (if any): draw them again in ours
  }

  // ---- 4: auto arrange ---------------------------------------------------------------------
  function overlapping(list) {
    for (var i = 0; i < list.length; i++) {
      var a = list[i].getBoundingClientRect();
      for (var j = i + 1; j < list.length; j++) {
        var b = list[j].getBoundingClientRect();
        if (a.left < b.right - 8 && b.left < a.right - 8 && a.top < b.bottom - 8 && b.top < a.bottom - 8) return true;
      }
    }
    return false;
  }
  function autoArrange(force) {
    var list = tables();
    if (list.length < 2 || (!force && !overlapping(list))) return false;
    var byId = {};
    list.forEach(function (t) { byId[t.id] = t; });
    var refs = {}, referenced = {};
    relations().forEach(function (r) {
      if (r.from === r.to || !byId[r.from] || !byId[r.to]) return;
      (refs[r.from] = refs[r.from] || {})[r.to] = true;
      referenced[r.to] = true;
    });
    // level = how deep a table is in the "points to" chain (parents = 0)
    var level = {};
    function depth(id, seen) {
      if (level[id] !== undefined) return level[id];
      if (seen[id]) return 0;                       // a cycle: stop here
      seen[id] = true;
      var best = -1;
      Object.keys(refs[id] || {}).forEach(function (p) { best = Math.max(best, depth(p, seen)); });
      seen[id] = false;
      return (level[id] = best + 1);
    }
    var related = list.filter(function (t) { return refs[t.id] || referenced[t.id]; });
    var alone = list.filter(function (t) { return !refs[t.id] && !referenced[t.id]; });
    related.forEach(function (t) { depth(t.id, {}); });
    var levels = [];
    related.forEach(function (t) { (levels[level[t.id]] = levels[level[t.id]] || []).push(t); });
    // start to the right of the side toolbar (it floats over the board; its width changes
    // when its labels are shown), measured on screen in the tables' own coordinates
    var X0 = 40, Y0 = 30, GAPX = 120, GAPY = 34, pos = {};
    var menu = document.getElementById('side_menu');
    var origin = list[0].offsetParent;
    // (visibility by its size on screen: offsetParent is always null for this position:fixed bar)
    var m = menu ? menu.getBoundingClientRect() : null;
    if (m && m.width > 0 && origin) {
      var o = origin.getBoundingClientRect();
      X0 = Math.max(X0, Math.round(m.right - o.left + origin.scrollLeft + 72));
    }
    // Compact layout:
    //  - one column per level (parents first), ordered to sit next to what they point to;
    //  - a column never taller than about one screen: a crowded level splits into side-by-side
    //    columns;
    //  - tables without relations fill the free space under the shortest columns (biggest
    //    first); a new column only when every column is full.
    var H = Math.max(window.innerHeight - 220, 360);
    list.forEach(function (t) { H = Math.max(H, t.offsetHeight); });
    var cols = [];   // each: { items: [tables], h: used height }
    var order = {};  // y order of placed tables, for the "next to what they point to" sort
    levels.forEach(function (lvl, c) {
      if (!lvl) return;
      lvl.sort(function (a, b) {
        function bary(t) {
          var ys = Object.keys(refs[t.id] || {}).map(function (p) { return order[p] !== undefined ? order[p] : 0; });
          return ys.length ? ys.reduce(function (s, v) { return s + v; }, 0) / ys.length : 0;
        }
        return c > 0 ? (bary(a) - bary(b)) || a.id.localeCompare(b.id) : a.id.localeCompare(b.id);
      });
      var col = { items: [], h: 0 };
      cols.push(col);
      lvl.forEach(function (t, i) {
        var th = t.offsetHeight + GAPY;
        if (col.items.length && col.h + th > H) { col = { items: [], h: 0 }; cols.push(col); }
        col.items.push(t);
        col.h += th;
        order[t.id] = cols.length * 10000 + col.h;
      });
    });
    alone.sort(function (a, b) { return b.offsetHeight - a.offsetHeight || a.id.localeCompare(b.id); });
    alone.forEach(function (t) {
      var th = t.offsetHeight + GAPY, best = null;
      cols.forEach(function (c) { if (c.h + th <= H && (!best || c.h < best.h)) best = c; });
      if (!best) { best = { items: [], h: 0 }; cols.push(best); }
      best.items.push(t);
      best.h += th;
    });
    var x = X0;
    cols.forEach(function (col) {
      var y = Y0, w = 0;
      col.items.forEach(function (t) { pos[t.id] = { x: x, y: y }; y += t.offsetHeight + GAPY; w = Math.max(w, t.offsetWidth); });
      x += w + GAPX;
    });
    list.forEach(function (t) {
      if (!pos[t.id]) return;
      t.style.left = pos[t.id].x + 'px';
      t.style.top = pos[t.id].y + 'px';
    });
    redraw();
    if (window.DesignerMove && window.DesignerMove.markUnsaved) window.DesignerMove.markUnsaved();
    return true;
  }

  // ---- 5: "Auto arrange" button in the side toolbar ---------------------------------------
  function addButton() {
    var menu = document.getElementById('side_menu');
    if (!menu || document.getElementById('ample_auto_arrange')) return;
    var label = ar ? 'ترتيب تلقائي' : 'Auto arrange';
    var a = document.createElement('a');
    a.href = '#';
    a.id = 'ample_auto_arrange';
    a.className = 'M_butt';
    a.title = label;
    a.innerHTML = '<span class="hide hidable"></span>';
    a.firstChild.textContent = label;
    a.addEventListener('click', function (e) { e.preventDefault(); autoArrange(true); });
    var after = document.getElementById('reloadPage');
    if (after && after.parentNode === menu) menu.insertBefore(a, after.nextSibling);
    else menu.appendChild(a);
  }

  // ---- run -------------------------------------------------------------------------------
  var arranged = false;
  function run() {
    if (!isDesigner()) { arranged = false; return; }
    patchLines();
    styleTables();
    addButton();
  }
  function firstArrange() {
    if (!isDesigner() || arranged) return;
    // phpMyAdmin may still be loading a saved page (from the browser's storage): wait a bit,
    // then arrange only if the tables are still piled up
    arranged = true;
    [700, 1800].forEach(function (ms) { setTimeout(function () { styleTables(); autoArrange(false); }, ms); });
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; run(); firstArrange(); });
  }
  function start() {
    run();
    firstArrange();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
