(function () {
  'use strict';

  var NOISE = '-+<>/[]!_';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- mode toggle: builder <-> employee -----------------------------------
  var toggle = document.getElementById('mode-toggle');
  if (toggle) {
    var knob = toggle.querySelector('.mode-toggle__switch');
    var label = toggle.querySelector('.mode-toggle__label');
    var stored = null;
    try {
      stored = window.localStorage.getItem('eishan-mode');
    } catch (e) {}

    var apply = function (mode) {
      var employee = mode === 'employee';
      document.body.setAttribute('data-mode', employee ? 'employee' : 'builder');
      knob.classList.toggle('active', employee);
      label.textContent = employee ? 'EMPLOYEE MODE' : 'BUILDER MODE';
      toggle.setAttribute('aria-checked', employee ? 'true' : 'false');
    };

    var flip = function () {
      var next = document.body.getAttribute('data-mode') === 'employee' ? 'builder' : 'employee';
      apply(next);
      try {
        window.localStorage.setItem('eishan-mode', next);
      } catch (e) {}
    };

    apply(stored === 'employee' ? 'employee' : 'builder');
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip();
      }
    });
  }

  // --- scramble reveal for accent words -----------------------------------
  var scramble = document.querySelectorAll('.scramble');
  if (!reduceMotion) {
    Array.prototype.forEach.call(scramble, function (el) {
      var target = el.getAttribute('data-text') || el.textContent;
      var frame = 0;
      var timer = window.setInterval(function () {
        var out = target
          .split('')
          .map(function (ch, i) {
            if (i < frame) return ch;
            return NOISE[Math.floor(Math.random() * NOISE.length)];
          })
          .join('');
        el.textContent = out;
        frame += 0.1;
        if (frame >= target.length) {
          el.textContent = target;
          window.clearInterval(timer);
        }
      }, 16);
    });
  }

  // --- wrap wide tables so they scroll instead of overflowing -------------
  var tables = document.querySelectorAll('.writing-content table');
  Array.prototype.forEach.call(tables, function (t) {
    if (t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('table-scroll')) return;
    if (t.closest('figure.highlight')) return;
    var scroller = document.createElement('div');
    scroller.className = 'table-scroll';
    t.parentNode.insertBefore(scroller, t);
    scroller.appendChild(t);
  });

  // Keep the native details control while easing the space occupied by the QR code.
  var reward = document.querySelector('.writing-reward');
  if (reward && !reduceMotion && reward.animate) {
    var rewardSummary = reward.querySelector('summary');
    var rewardContent = reward.querySelector('.writing-reward__content');
    var rewardAnimation = null;
    var rewardExpanded = reward.open;

    rewardSummary.addEventListener('click', function (event) {
      event.preventDefault();
      var from = reward.getBoundingClientRect().height;
      if (rewardAnimation) rewardAnimation.cancel();
      rewardAnimation = null;
      reward.style.height = from + 'px';
      reward.style.overflow = 'hidden';

      rewardExpanded = !rewardExpanded;
      if (rewardExpanded) reward.open = true;
      var border = reward.offsetHeight - reward.clientHeight;
      var to = rewardSummary.offsetHeight + border + (rewardExpanded ? rewardContent.scrollHeight : 0);
      var animation = reward.animate(
        [{ height: from + 'px' }, { height: to + 'px' }],
        { duration: 260, easing: 'ease-out', fill: 'forwards' }
      );
      rewardAnimation = animation;
      animation.onfinish = function () {
        if (rewardAnimation !== animation) return;
        reward.style.height = to + 'px';
        animation.cancel();
        rewardAnimation = null;
        if (!rewardExpanded) reward.open = false;
        reward.style.height = '';
        reward.style.overflow = '';
      };
    });
  }

  // Article utilities use the rendered content, so no extra library is needed.
  var content = document.querySelector('.writing-content');
  if (content) {
    Array.prototype.forEach.call(content.querySelectorAll('p'), function (paragraph) {
      var images = paragraph.querySelectorAll('img');
      if (!images.length) return;
      if (!paragraph.textContent.trim()) {
        paragraph.classList.add('media-paragraph');
        return;
      }
      Array.prototype.forEach.call(images, function (image) {
        var item = image.parentElement === paragraph ? image : image.parentElement;
        var previous = item.previousElementSibling;
        if (item.parentElement === paragraph &&
            (image.hasAttribute('align') || parseInt(image.getAttribute('width'), 10) > 64 ||
             (previous && (previous.tagName === 'BR' ||
               previous.classList.contains('media-image') || previous.querySelector('img.media-image'))))) {
          image.classList.add('media-image');
        }
      });
    });

    Array.prototype.forEach.call(content.querySelectorAll('figure.highlight, pre:not(figure.highlight pre)'), function (block) {
      var source = block.matches('figure.highlight') ? block.querySelector('.code pre') : block;
      if (!source) return;
      var code = source.innerText || source.textContent;
      var frame = document.createElement('div');
      frame.className = 'code-frame';
      var toolbar = document.createElement('div');
      toolbar.className = 'code-frame__toolbar';
      var caption = block.querySelector('figcaption');
      if (caption) {
        toolbar.appendChild(caption);
      } else {
        var label = document.createElement('span');
        label.className = 'code-frame__language';
        label.textContent = block.matches('figure.highlight')
          ? (Array.prototype.slice.call(block.classList).filter(function (name) { return name !== 'highlight'; })[0] || 'Code')
          : 'Code';
        toolbar.appendChild(label);
      }
      var button = document.createElement('button');
      button.className = 'code-copy';
      button.type = 'button';
      button.title = 'Copy code';
      button.setAttribute('aria-label', 'Copy code');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect class="code-copy__copy" x="8" y="8" width="11" height="11" rx="1"></rect><path class="code-copy__copy" d="M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1"></path><path class="code-copy__check" d="m4 12 5 5L20 6"></path></svg>';
      var status = document.createElement('span');
      status.className = 'code-copy__status';
      status.setAttribute('aria-live', 'polite');
      button.appendChild(status);
      var resetTimer;
      button.addEventListener('click', function () {
        navigator.clipboard.writeText(code).then(function () {
          button.classList.add('is-copied');
          button.classList.remove('is-error');
          button.title = 'Copied';
          button.setAttribute('aria-label', 'Copied');
          status.textContent = 'Copied';
          window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(reset, 1800);
        }, function () {
          button.classList.add('is-error');
          button.classList.remove('is-copied');
          button.title = 'Copy failed';
          button.setAttribute('aria-label', 'Copy failed');
          status.textContent = 'Copy failed';
          window.clearTimeout(resetTimer);
          resetTimer = window.setTimeout(reset, 1800);
        });
      });
      function reset() {
        button.classList.remove('is-copied', 'is-error');
        button.title = 'Copy code';
        button.setAttribute('aria-label', 'Copy code');
        status.textContent = '';
      }
      var scroller = document.createElement('div');
      scroller.className = 'code-frame__scroll';
      block.parentNode.insertBefore(frame, block);
      frame.appendChild(toolbar);
      frame.appendChild(scroller);
      toolbar.appendChild(button);
      scroller.appendChild(block);
    });

    var dialog = document.createElement('dialog');
    dialog.className = 'image-viewer';
    dialog.setAttribute('aria-label', 'Image preview');
    dialog.innerHTML = '<button type="button" class="image-viewer__close" aria-label="Close image">×</button><img alt="">';
    document.body.appendChild(dialog);
    dialog.querySelector('button').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
    content.addEventListener('click', function (event) {
      var image = event.target.closest('img');
      if (!image || image.closest('a, button, .aplayer, .bb-channel-portable, .token-usage-app')) return;
      var preview = dialog.querySelector('img');
      preview.src = image.currentSrc || image.src;
      preview.alt = image.alt || '';
      dialog.showModal();
    });
  }

  var backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    var updateBackToTop = function () {
      backToTop.hidden = window.scrollY < 450;
    };
    updateBackToTop();
    window.addEventListener('scroll', updateBackToTop, { passive: true });
    backToTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' });
    });
  }

})();
