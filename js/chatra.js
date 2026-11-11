(function () {
  'use strict';

  var buttons = document.querySelectorAll('[data-chat-open]');
  if (!buttons.length) return;
  var loading = false;
  var loaded = false;
  var pendingOpen = false;
  var setBusy = function (busy) {
    buttons.forEach(function (button) {
      if (busy) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    });
  };

  function loadChatra() {
    if (loading || loaded) return;
    loading = true;
    window.ChatraID = buttons[0].getAttribute('data-chatra-id');
    window.ChatraSetup = {
      customWidgetButton: '[data-chat-open]',
      buttonPosition: window.innerWidth <= 800 ? 'lt' : 'bl',
      colors: { buttonBg: '#f40', buttonText: '#fff' }
    };
    var script = document.createElement('script');
    script.src = 'https://call.chatra.io/chatra.js';
    script.async = true;
    script.onload = function () {
      if (typeof window.Chatra !== 'function') {
        script.onerror();
        return;
      }
      loaded = true;
      loading = false;
      setBusy(false);
      if (pendingOpen) {
        pendingOpen = false;
        window.Chatra('openChat', true);
      }
    };
    script.onerror = function () {
      script.remove();
      loading = false;
      pendingOpen = false;
      setBusy(false);
    };
    document.head.appendChild(script);
  }

  buttons.forEach(function (button) {
    button.addEventListener('pointerenter', loadChatra);
    button.addEventListener('focus', loadChatra);
    button.addEventListener('click', function () {
      if (loaded) {
        window.Chatra('openChat', true);
        return;
      }
      pendingOpen = true;
      setBusy(true);
      loadChatra();
    });
  });

  if (window.requestIdleCallback) window.requestIdleCallback(loadChatra, { timeout: 2500 });
  else window.setTimeout(loadChatra, 1500);
})();
