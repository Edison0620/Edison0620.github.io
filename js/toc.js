(function () {
  'use strict';

  var MOBILE_QUERY = '(max-width: 800px)';

  var init = function () {
    var rail = document.querySelector('[data-toc-rail]');
    var article = document.querySelector('.writing-content');
    if (!rail || !article) return;

    var headings = Array.prototype.slice.call(article.querySelectorAll('h2, h3, h4'));
    if (headings.length < 2) return;

    var list = rail.querySelector('[data-toc-list]');
    var toggle = rail.querySelector('.toc-rail__toggle');
    var navigation = rail.querySelector('.toc-rail__nav');
    if (!list || !toggle || !navigation) return;

    var usedIds = Object.create(null);
    Array.prototype.forEach.call(document.querySelectorAll('[id]'), function (element) {
      if (element.id) usedIds[element.id] = true;
    });

    var makeSlug = function (text, index) {
      var normalized = text.trim().toLowerCase();
      if (normalized.normalize) normalized = normalized.normalize('NFKD');
      normalized = normalized
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9\u00c0-\uffff]+/g, '-')
        .replace(/^-+|-+$/g, '');

      var base = normalized || 'section-' + (index + 1);
      var candidate = base;
      var suffix = 2;
      while (usedIds[candidate]) {
        candidate = base + '-' + suffix;
        suffix += 1;
      }
      usedIds[candidate] = true;
      return candidate;
    };

    var links = headings.map(function (heading, index) {
      if (!heading.id) heading.id = makeSlug(heading.textContent || '', index);

      var item = document.createElement('li');
      item.className = 'toc-rail__item toc-rail__item--level-' + heading.tagName.slice(1);
      item.setAttribute('data-level', heading.tagName.slice(1));

      var link = document.createElement('a');
      link.className = 'toc-rail__link';
      link.href = '#' + heading.id;
      link.setAttribute('aria-label', heading.textContent.trim() || 'Untitled section');

      var marker = document.createElement('span');
      marker.className = 'toc-rail__marker';
      marker.setAttribute('aria-hidden', 'true');

      var label = document.createElement('span');
      label.className = 'toc-rail__label';
      label.textContent = heading.textContent.trim() || 'Untitled section';

      link.appendChild(marker);
      link.appendChild(label);
      item.appendChild(link);
      list.appendChild(item);
      return link;
    });

    var mobile = window.matchMedia(MOBILE_QUERY);
    var setExpanded = function (expanded) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      navigation.hidden = !expanded;
      rail.classList.toggle('is-expanded', expanded);
    };

    var syncViewport = function () {
      rail.classList.toggle('is-compact', mobile.matches);
      setExpanded(!mobile.matches);
      remeasure();
    };

    toggle.addEventListener('click', function () {
      setExpanded(toggle.getAttribute('aria-expanded') !== 'true');
    });

    rail.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && mobile.matches && toggle.getAttribute('aria-expanded') === 'true') {
        setExpanded(false);
        toggle.focus();
      }
    });

    links.forEach(function (link) {
      link.addEventListener('click', function () {
        if (mobile.matches) setExpanded(false);
      });
    });

    if (mobile.addEventListener) mobile.addEventListener('change', syncViewport);
    else mobile.addListener(syncViewport);

    var positions = [];
    var articleEnd = 0;
    var activeIndex = -1;
    var ticking = false;
    var minorLayer = document.createElement('li');
    minorLayer.className = 'toc-rail__minor-layer';
    minorLayer.setAttribute('aria-hidden', 'true');
    list.appendChild(minorLayer);
    var minorTicks = [];

    var measureTicks = function () {
      minorTicks = [];
      minorLayer.replaceChildren();
      list.style.paddingBottom = '';
      if (window.innerWidth <= 800) return;

      var fragment = document.createDocumentFragment();
      for (var i = 0; i < links.length - 1; i += 1) {
        var start = links[i].parentElement.offsetTop + links[i].offsetHeight / 2;
        var end = links[i + 1].parentElement.offsetTop + links[i + 1].offsetHeight / 2;
        var count = Math.max(0, Math.round((end - start) / 8) - 1);
        for (var step = 1; step <= count; step += 1) {
          var tick = document.createElement('span');
          tick.className = 'toc-rail__minor-tick';
          tick.style.top = (start + (end - start) * step / (count + 1)) + 'px';
          fragment.appendChild(tick);
          minorTicks.push({ element: tick, position: i + step / (count + 1), wave: '' });
        }
      }
      var last = links.length - 1;
      var lastMarker = links[last].parentElement.offsetTop + links[last].offsetHeight / 2;
      var firstMarker = links[0].parentElement.offsetTop + links[0].offsetHeight / 2;
      var averageMarkerGap = (lastMarker - firstMarker) / last;
      var tailHeight = Math.max(0, articleEnd - positions[last]);
      var tailCount = tailHeight > 48
        ? Math.max(1, Math.floor(averageMarkerGap / 8) - 1)
        : 0;
      for (var tailStep = 1; tailStep <= tailCount; tailStep += 1) {
        var tailTick = document.createElement('span');
        tailTick.className = 'toc-rail__minor-tick';
        tailTick.style.top = (lastMarker + tailStep * 8) + 'px';
        fragment.appendChild(tailTick);
        minorTicks.push({ element: tailTick, position: last + tailStep / (tailCount + 1), wave: '' });
      }
      list.style.paddingBottom = (tailCount * 8) + 'px';
      minorLayer.appendChild(fragment);
    };

    var measure = function () {
      positions = headings.map(function (heading) {
        return heading.getBoundingClientRect().top + window.pageYOffset;
      });
      articleEnd = article.getBoundingClientRect().bottom + window.pageYOffset;
    };

    var renderActive = function (index) {
      if (index === activeIndex) return;
      if (activeIndex >= 0) {
        links[activeIndex].classList.remove('is-active');
        links[activeIndex].removeAttribute('aria-current');
        links[activeIndex].classList.remove('is-at-heading');
        links[activeIndex].classList.remove('is-at-end');
      }
      activeIndex = index;
      links[activeIndex].classList.add('is-active');
      links[activeIndex].setAttribute('aria-current', 'location');
      links.forEach(function (link, position) {
        link.classList.toggle('is-past', position < index);
      });
      toggle.querySelector('.toc-rail__toggle-label').textContent =
        'On this page · ' + links[index].getAttribute('aria-label');
    };

    var updateActive = function () {
      ticking = false;
      var target = window.pageYOffset + Math.max(96, window.innerHeight * 0.22);
      var low = 0;
      var high = positions.length - 1;
      var result = 0;

      while (low <= high) {
        var middle = (low + high) >> 1;
        if (positions[middle] <= target) {
          result = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      var atPageEnd = window.pageYOffset + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (atPageEnd) result = links.length - 1;
      var atArticleEnd = result === links.length - 1 &&
        (target >= articleEnd - 2 || atPageEnd);
      renderActive(result);
      links[result].classList.toggle('is-at-heading',
        target >= positions[result] && target - positions[result] <= 32);
      links[result].classList.toggle('is-at-end', atArticleEnd);
      var end = positions[result + 1] || Math.max(articleEnd, positions[result] + 1);
      var progress = atArticleEnd ? 1 :
        Math.max(0, Math.min(1, (target - positions[result]) / Math.max(1, end - positions[result])));
      var wavePosition = result + progress;
      minorTicks.forEach(function (tick) {
        var proximity = Math.max(0, 1 - Math.abs(tick.position - wavePosition) / 0.55);
        var wave = (proximity * proximity).toFixed(2);
        if (wave !== tick.wave) {
          tick.element.style.setProperty('--wave', wave);
          tick.wave = wave;
        }
        tick.element.classList.toggle('is-past', tick.position < wavePosition);
        tick.element.classList.toggle('is-current', proximity > 0.7);
      });
    };

    var requestUpdate = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateActive);
    };

    var remeasure = function () {
      measure();
      measureTicks();
      requestUpdate();
    };
    if (window.ResizeObserver) new ResizeObserver(remeasure).observe(article);

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', remeasure, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);

    rail.hidden = false;
    syncViewport();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
