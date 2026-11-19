(function () {
  'use strict';

  var menu = document.getElementById('site-context-menu');
  var postsData = document.getElementById('site-context-posts');
  if (!menu || !postsData) return;

  var posts = JSON.parse(postsData.textContent);
  var items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'));
  var random = menu.querySelector('[data-context-random]');
  var palettes = Array.prototype.slice.call(menu.querySelectorAll('[data-accent-choice]'));
  var previousFocus = null;
  var nativeTargets = 'a, button, input, textarea, select, option, img, picture, video, audio, canvas, iframe, p, h1, h2, h3, h4, h5, h6, pre, code, blockquote, label, summary, [contenteditable], [role="button"], [role="link"], [role="menu"]';
  var touchHold = null;
  var touchPointers = new Set();
  var releaseClick = null;
  var HOLD_MS = 550;
  var HOLD_RADIUS = 12;

  function cancelTouchHold() {
    if (!touchHold) return;
    window.clearTimeout(touchHold.timer);
    touchHold = null;
  }

  function eligible(target) {
    return target && target.closest && !target.closest(nativeTargets) &&
      !(window.getSelection && String(window.getSelection()).trim());
  }

  function openAt(x, y) {
    previousFocus = document.activeElement;
    if (posts.length) {
      random.href = posts[Math.floor(Math.random() * posts.length)];
      random.hidden = false;
    } else {
      random.hidden = true;
    }
    syncPalette();
    menu.hidden = false;
    document.documentElement.classList.add('clawd-context-menu-open');
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.focus({ preventScroll: true });
  }

  function close() {
    if (menu.hidden) return;
    document.documentElement.classList.remove('clawd-context-menu-open');
    menu.hidden = true;
    if (menu.contains(document.activeElement) && previousFocus && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
  }

  function syncPalette() {
    var selected = document.documentElement.getAttribute('data-accent') || 'orange';
    palettes.forEach(function (button) {
      button.setAttribute('aria-checked', String(button.dataset.accentChoice === selected));
    });
  }

  document.addEventListener('contextmenu', function (event) {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (coarse && (touchHold || releaseClick) && eligible(event.target)) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey || !eligible(event.target) || coarse) {
      close();
      return;
    }
    event.preventDefault();
    openAt(event.clientX, event.clientY);
  });

  menu.querySelector('[data-context-back]').addEventListener('click', function () {
    close();
    window.history.back();
  });
  menu.querySelector('[data-context-forward]').addEventListener('click', function () {
    close();
    window.history.forward();
  });
  menu.querySelector('[data-context-reload]').addEventListener('click', function () {
    close();
    window.location.reload();
  });
  random.addEventListener('click', close);
  menu.querySelector('[data-context-top]').addEventListener('click', function () {
    close();
    window.scrollTo({ top: 0, behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });

  palettes.forEach(function (button) {
    button.addEventListener('click', function () {
      var accent = button.dataset.accentChoice;
      document.documentElement.setAttribute('data-accent', accent);
      try {
        if (accent === 'orange') localStorage.removeItem('carver-accent');
        else localStorage.setItem('carver-accent', accent);
      } catch (error) { /* The selection still applies to this page. */ }
      syncPalette();
      document.dispatchEvent(new CustomEvent('carver:accentchange', { detail: { accent: accent } }));
      close();
    });
  });

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    var stored;
    try { stored = localStorage.getItem('carver-accent'); }
    catch (error) { return; }
    var accent = /^(yellow|green|blue|purple)$/.test(stored) ? stored : 'orange';
    if (accent === document.documentElement.getAttribute('data-accent')) return;
    document.documentElement.setAttribute('data-accent', accent);
    syncPalette();
    document.dispatchEvent(new CustomEvent('carver:accentchange', { detail: { accent: accent } }));
  });

  document.addEventListener('pointerdown', function (event) {
    var wasOpen = !menu.hidden;
    if (!menu.contains(event.target)) close();
    if (event.pointerType !== 'touch') return;
    touchPointers.add(event.pointerId);
    cancelTouchHold();
    if (wasOpen || touchPointers.size !== 1 || !eligible(event.target) ||
        window.__clawdEffects && window.__clawdEffects.active ||
        !window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
    var hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: null };
    touchHold = hold;
    hold.timer = window.setTimeout(function () {
      if (touchHold !== hold) return;
      touchHold = null;
      if (touchPointers.size !== 1 || window.__clawdEffects && window.__clawdEffects.active ||
          !eligible(event.target)) return;
      openAt(hold.x, hold.y);
      releaseClick = hold;
      hold.timer = window.setTimeout(function () {
        if (releaseClick === hold) releaseClick = null;
      }, 800);
    }, HOLD_MS);
  });
  document.addEventListener('pointermove', function (event) {
    if (touchHold && event.pointerId === touchHold.pointerId &&
        Math.hypot(event.clientX - touchHold.x, event.clientY - touchHold.y) > HOLD_RADIUS) {
      cancelTouchHold();
    }
  });
  function finishTouch(event) {
    if (event.pointerType !== 'touch') return;
    touchPointers.delete(event.pointerId);
    if (touchHold && touchHold.pointerId === event.pointerId) cancelTouchHold();
  }
  document.addEventListener('pointerup', finishTouch);
  document.addEventListener('pointercancel', finishTouch);
  window.addEventListener('resize', function () { cancelTouchHold(); close(); });
  document.addEventListener('click', function (event) {
    if (!releaseClick || Math.hypot(event.clientX - releaseClick.x, event.clientY - releaseClick.y) > HOLD_RADIUS) return;
    window.clearTimeout(releaseClick.timer);
    releaseClick = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', function (event) {
    if (!menu.contains(event.target)) close();
  });
  document.addEventListener('scroll', function () { cancelTouchHold(); close(); }, true);
  menu.addEventListener('pointerover', function (event) {
    if (event.target.closest('[role="menuitem"], [role="menuitemradio"]') && menu.contains(document.activeElement)) {
      menu.focus({ preventScroll: true });
    }
  });
  document.addEventListener('keydown', function (event) {
    if (menu.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
               event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      var visible = items.filter(function (item) { return !item.hidden; });
      var index = visible.indexOf(document.activeElement);
      var next = index < 0 ? (event.key === 'ArrowUp' || event.key === 'End' ? visible.length - 1 : 0) :
        event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      visible[next].focus({ preventScroll: true });
    } else if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
               document.activeElement.matches('[data-accent-choice]')) {
      event.preventDefault();
      var direction = event.key === 'ArrowRight' ? 1 : -1;
      palettes[(palettes.indexOf(document.activeElement) + direction + palettes.length) % palettes.length].focus({ preventScroll: true });
    }
  });
})();
