(function () {
  'use strict';

  var STORAGE_KEY = 'blog-color-mode';
  var MODES = ['light', 'dark'];
  var MODE_LABELS = {
    light: '浅色',
    dark: '深色'
  };
  var MODE_ICONS = {
    light: 'fa-sun',
    dark: 'fa-moon'
  };
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var savedMode = readMode();
  var followsSystem = savedMode === null;
  var currentMode = savedMode || getSystemMode();
  var colorSchemeMediaRules = [];
  var seenMediaRules = new WeakSet();
  var themeColorMetas = [];
  var seenThemeColorMetas = new WeakSet();
  var positionMedia = window.matchMedia('(max-width: 767px)');
  var POSITION_STORAGE_KEYS = {
    desktop: 'blog-theme-toggle-y-desktop',
    mobile: 'blog-theme-toggle-y-mobile'
  };
  var DEFAULT_POSITION_RATIO = 0.58;
  var DRAG_THRESHOLD = 6;
  var KEYBOARD_STEP = 24;
  var POSITION_INSET = 12;
  var resizeFrame = null;

  function readMode() {
    try {
      var savedMode = window.localStorage.getItem(STORAGE_KEY);
      return MODES.indexOf(savedMode) === -1 ? null : savedMode;
    } catch (error) {
      return null;
    }
  }

  function getSystemMode() {
    return media.matches ? 'dark' : 'light';
  }

  function collectColorSchemeMediaRules() {
    function visit(rules) {
      Array.prototype.forEach.call(rules, function (rule) {
        if (rule.type === 4) {
          var query = rule.media.mediaText;
          if (
            !seenMediaRules.has(rule) &&
            (query.indexOf('(prefers-color-scheme: dark)') !== -1 ||
              query.indexOf('(prefers-color-scheme: light)') !== -1)
          ) {
            seenMediaRules.add(rule);
            colorSchemeMediaRules.push({ rule: rule, query: query });
          }
        }

        if (rule.cssRules && rule.type !== 1) visit(rule.cssRules);
      });
    }

    Array.prototype.forEach.call(document.styleSheets, function (sheet) {
      try {
        visit(sheet.cssRules);
      } catch (error) {
        // Cross-origin stylesheets cannot be inspected.
      }
    });
  }

  function collectThemeColorMetas() {
    Array.prototype.forEach.call(
      document.querySelectorAll('meta[name="theme-color"][media]'),
      function (meta) {
        if (seenThemeColorMetas.has(meta)) return;
        seenThemeColorMetas.add(meta);
        themeColorMetas.push({
          meta: meta,
          media: meta.getAttribute('media')
        });
      }
    );
  }

  function syncThemeColorMetas(resolvedMode) {
    collectThemeColorMetas();
    themeColorMetas.forEach(function (entry) {
      entry.meta.setAttribute(
        'media',
        followsSystem
          ? entry.media
          : forceColorSchemeQuery(entry.media, resolvedMode)
      );
    });
  }

  function forceColorSchemeQuery(query, resolvedMode) {
    return query
      .split(',')
      .map(function (branch) {
        var targetsDark = branch.indexOf('(prefers-color-scheme: dark)') !== -1;
        var targetsLight = branch.indexOf('(prefers-color-scheme: light)') !== -1;

        if (!targetsDark && !targetsLight) return branch;
        if (
          (targetsDark && resolvedMode === 'dark') ||
          (targetsLight && resolvedMode === 'light')
        ) {
          return branch
            .replace('(prefers-color-scheme: dark)', '(min-width: 0px)')
            .replace('(prefers-color-scheme: light)', '(min-width: 0px)');
        }
        return 'not all';
      })
      .join(', ');
  }

  function syncColorSchemeMedia(resolvedMode) {
    collectColorSchemeMediaRules();
    colorSchemeMediaRules.forEach(function (entry) {
      entry.rule.media.mediaText =
        followsSystem
          ? entry.query
          : forceColorSchemeQuery(entry.query, resolvedMode);
    });
    syncThemeColorMetas(resolvedMode);
  }

  function persistMode(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
      // Theme switching still works when storage is unavailable.
    }
  }

  function getPositionStorageKey() {
    return POSITION_STORAGE_KEYS[positionMedia.matches ? 'mobile' : 'desktop'];
  }

  function readPositionRatio() {
    try {
      var savedPosition = window.localStorage.getItem(getPositionStorageKey());
      if (savedPosition === null) return DEFAULT_POSITION_RATIO;
      var savedRatio = Number(savedPosition);
      return savedRatio >= 0 && savedRatio <= 1 ? savedRatio : DEFAULT_POSITION_RATIO;
    } catch (error) {
      return DEFAULT_POSITION_RATIO;
    }
  }

  function getPositionBounds(button) {
    var halfHeight = button.offsetHeight / 2;
    return {
      min: POSITION_INSET + halfHeight,
      max: window.innerHeight - POSITION_INSET - halfHeight
    };
  }

  function setTogglePosition(button, position, persist) {
    var bounds = getPositionBounds(button);
    var clampedPosition = Math.min(Math.max(position, bounds.min), bounds.max);
    button.style.setProperty('--theme-toggle-y', clampedPosition + 'px');

    if (persist) {
      try {
        window.localStorage.setItem(
          getPositionStorageKey(),
          String(clampedPosition / window.innerHeight)
        );
      } catch (error) {
        // Dragging still works when storage is unavailable.
      }
    }
  }

  function restoreTogglePosition(button) {
    setTogglePosition(button, readPositionRatio() * window.innerHeight, false);
  }

  function bindToggleInteraction(button) {
    if (button.dataset.themeDragReady === 'true') return;

    var dragState = null;
    var suppressClick = false;

    button.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      var rect = button.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startPointerY: event.clientY,
        startButtonY: rect.top + rect.height / 2,
        moved: false
      };
      button.setPointerCapture(event.pointerId);
      button.classList.add('theme-mode-toggle-dragging');
    });

    button.addEventListener('pointermove', function (event) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      var deltaY = event.clientY - dragState.startPointerY;
      if (!dragState.moved && Math.abs(deltaY) < DRAG_THRESHOLD) return;

      dragState.moved = true;
      event.preventDefault();
      setTogglePosition(button, dragState.startButtonY + deltaY, false);
    });

    function finishDrag(event, cancelled) {
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      if (button.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      button.classList.remove('theme-mode-toggle-dragging');
      suppressClick = dragState.moved && !cancelled;
      if (dragState.moved && !cancelled) {
        var rect = button.getBoundingClientRect();
        setTogglePosition(button, rect.top + rect.height / 2, true);
      }
      dragState = null;
    }

    button.addEventListener('pointerup', function (event) {
      finishDrag(event, false);
    });
    button.addEventListener('pointercancel', function (event) {
      finishDrag(event, true);
    });

    button.addEventListener('click', function (event) {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
      }

      var nextMode = MODES[(MODES.indexOf(currentMode) + 1) % MODES.length];
      applyMode(nextMode, true);
    });

    button.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

      event.preventDefault();
      var rect = button.getBoundingClientRect();
      var direction = event.key === 'ArrowUp' ? -1 : 1;
      setTogglePosition(
        button,
        rect.top + rect.height / 2 + direction * KEYBOARD_STEP,
        true
      );
    });

    button.dataset.themeDragReady = 'true';
  }

  function updateToggle() {
    var button = document.querySelector('[data-theme-mode-toggle]');
    if (!button) return;

    var nextMode = MODES[(MODES.indexOf(currentMode) + 1) % MODES.length];
    var icon = button.querySelector('i');

    icon.className = 'fa ' + MODE_ICONS[currentMode] + ' fa-fw';
    button.dataset.mode = currentMode;
    button.setAttribute('aria-label', '当前为' + MODE_LABELS[currentMode] + '模式，切换到' + MODE_LABELS[nextMode] + '模式');
    button.title = '外观：' + MODE_LABELS[currentMode] + '；可上下拖动';
  }

  function applyMode(mode, persist) {
    if (persist) followsSystem = false;
    currentMode = MODES.indexOf(mode) === -1 ? getSystemMode() : mode;
    document.documentElement.dataset.themeMode = currentMode;
    document.documentElement.dataset.theme = currentMode;
    syncColorSchemeMedia(currentMode);

    if (persist) persistMode(currentMode);
    updateToggle();
  }

  function mountToggle() {
    var button = document.querySelector('body > [data-theme-mode-toggle]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-mode-toggle';
      button.setAttribute('data-theme-mode-toggle', '');

      var icon = document.createElement('i');
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);
      document.body.appendChild(button);
    }

    bindToggleInteraction(button);
    restoreTogglePosition(button);
    updateToggle();
    syncColorSchemeMedia(currentMode);
  }

  applyMode(currentMode, false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle, { once: true });
  } else {
    mountToggle();
  }

  document.addEventListener('pjax:success', mountToggle);
  window.addEventListener('load', function () {
    syncColorSchemeMedia(currentMode);
  });
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY) return;
    var syncedMode = readMode();
    followsSystem = syncedMode === null;
    applyMode(syncedMode || getSystemMode(), false);
  });

  window.addEventListener('resize', function () {
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(function () {
      var button = document.querySelector('body > [data-theme-mode-toggle]');
      if (button) restoreTogglePosition(button);
      resizeFrame = null;
    });
  });

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', function () {
      if (followsSystem) applyMode(getSystemMode(), false);
    });
  } else {
    media.addListener(function () {
      if (followsSystem) applyMode(getSystemMode(), false);
    });
  }
})();
