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
    var target = event.target;
    if (event.shiftKey || !target || !target.closest || target.closest(nativeTargets) ||
        (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        (window.getSelection && String(window.getSelection()).trim())) {
      close();
      return;
    }

    event.preventDefault();
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
    menu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 8)) + 'px';
    menu.focus({ preventScroll: true });
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

  document.addEventListener('pointerdown', function (event) {
    if (!menu.contains(event.target)) close();
  });
  window.addEventListener('resize', close);
  document.addEventListener('click', function (event) {
    if (!menu.contains(event.target)) close();
  });
  document.addEventListener('scroll', close, true);
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
