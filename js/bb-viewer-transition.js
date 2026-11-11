(function () {
  'use strict';

  var feed = document.querySelector('.writing-container--bb [data-bb-channel-feed]');
  if (!feed) return;

  function measure(card) {
    var rail = card.querySelector('.bb-channel-media-rail');
    var viewer = card.querySelector('[data-bb-image-viewer]');
    if (!rail || !viewer) return;

    rail.style.setProperty('--bb-rail-height', rail.scrollHeight + 'px');
    if (!viewer.hidden) {
      var limit = window.innerHeight * 0.68 + 64;
      viewer.style.setProperty('--bb-viewer-height', Math.min(viewer.scrollHeight, limit) + 'px');
    }
  }

  function measureAll() {
    feed.querySelectorAll('.bb-channel-card').forEach(measure);
  }

  var observer = new MutationObserver(function (records) {
    var replacedCards = false;
    records.forEach(function (record) {
      if (record.type === 'childList') {
        replacedCards = true;
        return;
      }
      var card = record.target.closest('.bb-channel-card');
      if (card) measure(card);
    });
    if (replacedCards) measureAll();
  });
  observer.observe(feed, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-bb-viewer-open', 'data-bb-viewer-closing']
  });
  feed.addEventListener('load', function (event) {
    var card = event.target.closest('.bb-channel-card');
    if (card) measure(card);
  }, true);
  window.addEventListener('resize', measureAll, { passive: true });
  window.addEventListener('pagehide', function () {
    observer.disconnect();
    window.removeEventListener('resize', measureAll);
  }, { once: true });
  measureAll();
})();
