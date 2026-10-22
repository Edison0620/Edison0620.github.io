(function () {
  'use strict';

  var backgrounds = window.__siteBackgrounds || {};
  var targets = [
    ['light', '--site-main-bg-image'],
    ['dark', '--site-main-bg-dark-image'],
    ['sidebar', '--site-sidebar-bg-image']
  ];

  function loadBackgrounds() {
    targets.forEach(function (target) {
      var url = backgrounds[target[0]];
      if (!url) return;

      var image = new Image();
      image.onload = function () {
        document.documentElement.style.setProperty(target[1], 'url(' + JSON.stringify(url) + ')');
      };
      image.src = url;
    });
  }

  function scheduleBackgrounds() {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(loadBackgrounds, { timeout: 3000 });
    } else {
      window.setTimeout(loadBackgrounds, 0);
    }
  }

  if (document.readyState === 'complete') {
    scheduleBackgrounds();
  } else {
    window.addEventListener('load', scheduleBackgrounds, { once: true });
  }
})();
