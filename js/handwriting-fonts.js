(() => {
  if (document.querySelector('link[data-handwriting-warm]')) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = document.currentScript.dataset.fontStylesheet;
  stylesheet.media = 'print';
  stylesheet.onload = async () => {
    stylesheet.media = 'all';
    const text = document.body.innerText;
    try {
      await Promise.all([
        document.fonts.load('16px Excalifont', text),
        document.fonts.load('16px Xiaolai', text),
      ]);
      document.documentElement.classList.add('handwriting-ready');
      try {
        sessionStorage.setItem('eishan-handwriting-ready', '1');
      } catch {
        // Storage may be unavailable in private browsing.
      }
    } catch {
      // Keep the readable fallback when a font cannot be loaded.
    }
  };
  document.head.appendChild(stylesheet);
})();
