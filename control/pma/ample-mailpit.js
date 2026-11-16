/*
 * AMPLE: keeps Mailpit's light/dark mode in step with AMPLE's ◐ button (dashboard and
 * phpMyAdmin), both ways. Apache puts this script right BEFORE Mailpit's own script, with the
 * same one-time nonce Mailpit's security policy requires, so it runs first.
 *   - AMPLE's choice: localStorage "ample-theme" = "dark" | "light" (none = follow Windows)
 *   - Mailpit's: localStorage "mp-theme" = "auto" | "light" | "dark" | "deep-dark"
 */
(function () {
  'use strict';
  var AMPLE = 'ample-theme', MP = 'mp-theme';
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function ample() { var t = get(AMPLE); return t === 'dark' || t === 'light' ? t : null; }
  function system() { return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }

  // 1. before Mailpit starts: give it AMPLE's choice ("deep-dark" is kept: it is dark too)
  var a = ample(), m = get(MP);
  if (!a) set(MP, 'auto');
  else if (!(a === 'dark' && m === 'deep-dark')) set(MP, a);

  // 2. AMPLE's choice changed in another tab (dashboard, phpMyAdmin): follow it now
  window.addEventListener('storage', function (e) {
    if (e.key !== AMPLE) return;
    var t = ample();
    set(MP, t || 'auto');
    document.documentElement.setAttribute('data-bs-theme', t || system());
  });

  // 3. the mode was changed in Mailpit's own menu: AMPLE follows it
  new MutationObserver(function () {
    var mp = get(MP);
    if (mp === 'light' || mp === 'dark') { if (ample() !== mp) set(AMPLE, mp); }
    else if (mp === 'deep-dark') { if (ample() !== 'dark') set(AMPLE, 'dark'); }
    else if (mp === 'auto' && ample()) set(AMPLE, null);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme', 'data-mp-theme'] });

  // 4. a one-click light/dark button at the right end of the top bar (instead of Settings →
  //    Theme). It does what Mailpit's own setting does (data-bs-theme + "mp-theme") and saves
  //    AMPLE's choice too, so the dashboard and phpMyAdmin follow. Mailpit redraws the top bar
  //    when moving between pages, so the button is put back whenever it is missing.
  function current() { return document.documentElement.getAttribute('data-bs-theme') === 'light' ? 'light' : 'dark'; }
  function paint(btn) {
    var dark = current() === 'dark';
    btn.innerHTML = '<i class="bi ' + (dark ? 'bi-sun-fill' : 'bi-moon-fill') + '"></i>';
    btn.title = dark ? 'Light mode' : 'Dark mode';
  }
  function addButton() {
    var bar = document.querySelector('.navbar.bg-primary'), col = bar && bar.lastElementChild;
    if (!col || document.getElementById('ample-mp-theme')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'ample-mp-theme';
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.removeAttribute('data-mp-theme');
      set(MP, next); set(AMPLE, next);
      document.documentElement.setAttribute('data-bs-theme', next);
    });
    paint(btn);
    col.insertBefore(btn, col.firstChild);
  }
  new MutationObserver(function () {
    var btn = document.getElementById('ample-mp-theme');
    if (btn) paint(btn);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
  // 5. message list: each message gets its sender's first letter (data-av) and a fixed color
  //    worked out from the sender's address (--av); ample-mailpit.css draws the round avatar
  //    from these. Only attributes are set, no element is added inside Mailpit's rows.
  var PALETTE = ['#e07b39', '#3b82c4', '#2f9e7a', '#8b5cf6', '#d9485f', '#0e9fb0', '#b7791f', '#4f7d2b'];
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function avatars() {
    var rows = document.querySelectorAll('#message-page .list-group > .message');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], b = r.querySelector('b[title^="From: "]');
      var name = b ? b.textContent.trim() : '';
      var letter = ((name.match(/[A-Za-z0-9À-￿]/) || ['?'])[0]).toUpperCase();
      var color = PALETTE[hash(b ? b.title.slice(6).toLowerCase() : name) % PALETTE.length];
      if (r.getAttribute('data-av') !== letter) r.setAttribute('data-av', letter);
      if (r.style.getPropertyValue('--av') !== color) r.style.setProperty('--av', color);
    }
  }

  // 6. an open message: the HTML preview and the Raw view are frames (separate pages our
  //    stylesheet does not reach), so their scrollbars get the AMPLE look put inside them
  var FRAME_SCROLL = '::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-button{display:none}' +
    '::-webkit-scrollbar-track{background:rgba(127,127,127,.13);border-radius:10px}' +
    '::-webkit-scrollbar-thumb{background:rgba(240,138,36,.6);border-radius:10px;border:2px solid transparent;background-clip:padding-box}' +
    '::-webkit-scrollbar-thumb:hover{background-color:#f08a24}';
  function styleFrame(f) {
    try {
      var d = f.contentDocument;
      if (!d || !d.head || d.getElementById('ample-scroll')) return;
      var s = d.createElement('style'); s.id = 'ample-scroll'; s.textContent = FRAME_SCROLL; d.head.appendChild(s);
    } catch (e) { /* a frame we may not touch */ }
  }
  function frames() {
    var list = document.querySelectorAll('#message-view iframe');
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f.ampleScroll) { f.ampleScroll = true; f.addEventListener('load', styleFrame.bind(null, f)); }
      styleFrame(f);
    }
  }

  // 7. "Customized by AMPLE" with the small AMPLE mark, at the bottom of the sidebar, above About
  var MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="28 78 456 348" aria-hidden="true">'
    + '<g fill="#f08a24" stroke="#f08a24" stroke-width="6" stroke-linejoin="round">'
    + '<path d="M206.3 105 Q214 91 228 91 L280.5 91 Q294.4 91 302.1 105 L404.1 290.9 L322.8 290.9 L288.6 228 C266.8 187.9 240.2 187.9 218.6 228 L184.6 290.9 L104.2 290.9 Z"/>'
    + '<path d="M90.2 316.5 L205 316.5 L205 343.3 L180 343.3 Q157 343.3 138.9 375 L124.1 401 Q117.9 411.9 105 411.9 L37.8 411.9 Z"/>'
    + '<path d="M300 316.5 L418.2 316.5 L470.6 411.9 L401 411.9 Q388.1 411.9 381.9 401 L367.1 375 Q349 343.3 325 343.3 L300 343.3 Z"/></g>'
    + '<path d="M172 330.5 L177.6 330.5 Q191.6 330.5 198 343 L210.9 368.3 Q218.2 382.5 222.6 367.1 L249.3 273.2 Q254.8 254 261.5 272.8 L289 349.5 Q293.7 362.7 298.8 351.9 L304.7 339.5 Q309 330.5 319 330.5 L324 330.5" fill="none" stroke="#f08a24" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function credit() {
    var abouts = document.querySelectorAll('.row.flex-fill > .flex-column > .about-mailpit, #offcanvas .about-mailpit');
    for (var i = 0; i < abouts.length; i++) {
      var a = abouts[i], prev = a.previousElementSibling;
      if (prev && prev.classList.contains('ample-credit')) continue;
      var c = document.createElement('div');
      c.className = 'ample-credit';
      c.innerHTML = MARK + '<span>Customized by</span><b>AMPLE</b>';
      a.parentNode.insertBefore(c, a);
    }
  }

  var queued = false;
  function update() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; addButton(); avatars(); frames(); credit(); });
  }
  function watchApp() {
    update();
    new MutationObserver(update).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) watchApp(); else document.addEventListener('DOMContentLoaded', watchApp);
})();
