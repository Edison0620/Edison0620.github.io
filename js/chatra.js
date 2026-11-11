(function () {
  'use strict';

  var buttons = document.querySelectorAll('[data-chat-open]');
  if (!buttons.length) return;
  var loading = false;
  var loaded = false;
  var setDisabled = function (disabled) {
    buttons.forEach(function (button) { button.disabled = disabled; });
  };

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (loading || loaded) return;
      loading = true;
      setDisabled(true);
      window.ChatraID = button.getAttribute('data-chatra-id');
      window.ChatraSetup = {
        customWidgetButton: '[data-chat-open]',
        buttonPosition: window.innerWidth <= 800 ? 'lt' : 'br',
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
        setDisabled(false);
        window.Chatra('openChat', true);
      };
      script.onerror = function () {
        script.remove();
        loading = false;
        setDisabled(false);
      };
      document.head.appendChild(script);
    });
  });
})();
