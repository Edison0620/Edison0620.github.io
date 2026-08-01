(function () {
  'use strict';

  var STORAGE_KEY = 'blog-color-mode';
  var MODES = ['auto', 'light', 'dark'];
  var MODE_LABELS = {
    auto: '自动',
    light: '浅色',
    dark: '深色'
  };
  var MODE_ICONS = {
    auto: 'fa-adjust',
    light: 'fa-sun',
    dark: 'fa-moon'
  };
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var currentMode = readMode();
  var colorSchemeMediaRules = [];
  var seenMediaRules = new WeakSet();
  var themeColorMetas = [];
  var seenThemeColorMetas = new WeakSet();

  function readMode() {
    try {
      var savedMode = window.localStorage.getItem(STORAGE_KEY);
      return MODES.indexOf(savedMode) === -1 ? 'auto' : savedMode;
    } catch (error) {
      return 'auto';
    }
  }

  function resolveMode(mode) {
    return mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode;
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
        currentMode === 'auto'
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
        currentMode === 'auto'
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

  function updateToggle() {
    var button = document.querySelector('[data-theme-mode-toggle]');
    if (!button) return;

    var nextMode = MODES[(MODES.indexOf(currentMode) + 1) % MODES.length];
    var icon = button.querySelector('i');
    var label = button.querySelector('span');

    icon.className = 'fa ' + MODE_ICONS[currentMode] + ' fa-fw';
    label.textContent = MODE_LABELS[currentMode];
    button.setAttribute('aria-label', '当前为' + MODE_LABELS[currentMode] + '模式，切换到' + MODE_LABELS[nextMode] + '模式');
    button.title = '外观：' + MODE_LABELS[currentMode];
  }

  function applyMode(mode, persist) {
    currentMode = MODES.indexOf(mode) === -1 ? 'auto' : mode;
    document.documentElement.dataset.themeMode = currentMode;
    document.documentElement.dataset.theme = resolveMode(currentMode);
    syncColorSchemeMedia(document.documentElement.dataset.theme);

    if (persist) persistMode(currentMode);
    updateToggle();
  }

  function mountToggle() {
    var menu = document.querySelector('.main-menu');
    if (!menu) return;

    var item = menu.querySelector('.theme-mode-item');
    if (!item) {
      item = document.createElement('li');
      item.className = 'menu-item theme-mode-item animated fadeInDown';

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-mode-toggle';
      button.setAttribute('data-theme-mode-toggle', '');

      var icon = document.createElement('i');
      icon.setAttribute('aria-hidden', 'true');

      var label = document.createElement('span');

      button.appendChild(icon);
      button.appendChild(label);
      button.addEventListener('click', function () {
        var nextMode = MODES[(MODES.indexOf(currentMode) + 1) % MODES.length];
        applyMode(nextMode, true);
      });

      item.appendChild(button);
      menu.appendChild(item);
    }

    updateToggle();
    syncColorSchemeMedia(resolveMode(currentMode));
  }

  applyMode(currentMode, false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle, { once: true });
  } else {
    mountToggle();
  }

  document.addEventListener('pjax:success', mountToggle);
  window.addEventListener('load', function () {
    syncColorSchemeMedia(resolveMode(currentMode));
  });
  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) applyMode(readMode(), false);
  });

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', function () {
      if (currentMode === 'auto') applyMode('auto', false);
    });
  } else {
    media.addListener(function () {
      if (currentMode === 'auto') applyMode('auto', false);
    });
  }
})();
