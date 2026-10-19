(function() {
  document.addEventListener('click', function(event) {
    if (event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target;
    if (!target || !target.closest ||
        target.closest('a, button, input, select, textarea, [contenteditable], [role="button"]')) return;

    const card = target.closest('.main-inner.index .post-block');
    if (!card || window.getSelection().toString()) return;

    const titleLink = card.querySelector('.post-title-link');
    if (titleLink) titleLink.click();
  });
})();
