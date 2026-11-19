(function () {
  'use strict';

  var kinds = ['book', 'movie', 'music', 'game'];
  var pageSize = 24;

  function safeUrl(value, host, prefix) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && url.hostname === host && url.pathname.indexOf(prefix) === 0;
    } catch (error) {
      return false;
    }
  }

  function normalizeCollection(payload) {
    if (!payload || payload.schemaVersion !== 1 || !payload.items) {
      throw new Error('Invalid Douban data');
    }
    var result = {};
    kinds.forEach(function (kind) {
      if (!Array.isArray(payload.items[kind])) {
        if (kind === 'game' && payload.items[kind] === undefined) {
          result[kind] = [];
          return;
        }
        throw new Error('Missing Douban collection: ' + kind);
      }
      result[kind] = payload.items[kind].filter(function (item) {
        return item && typeof item.title === 'string' && typeof item.id === 'string' &&
          (kind === 'game'
            ? safeUrl(item.url, 'www.douban.com', '/game/')
            : safeUrl(item.url, kind + '.douban.com', '/subject/')) &&
          safeUrl(item.poster, 'res.cloudinary.com', '/clawvox/image/upload/');
      }).sort(function (a, b) {
        return String(b.star_time || '').localeCompare(String(a.star_time || ''));
      });
    });
    return result;
  }

  function selectPage(items, page, size) {
    if (!Number.isInteger(page) || page < 1) return [];
    return items.slice((page - 1) * size, page * size);
  }

  function bookStampPose(id) {
    var hash = 2166136261;
    for (var i = 0; i < id.length; i++) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    }
    return {
      x: (hash >>> 0) % 9 - 4,
      y: (hash >>> 8) % 7 - 3,
      angle: ((hash >>> 16) % 41 - 20) / 10
    };
  }

  function encodeItfBarPositions(digits) {
    if (!/^\d{8}$/.test(digits)) return null;
    var patterns = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];
    var bars = [];
    var x = 0;
    function segment(bar, width) {
      if (bar) bars.push({ x: x, width: width });
      x += width;
    }
    segment(true, 1);
    segment(false, 1);
    segment(true, 1);
    segment(false, 1);
    for (var i = 0; i < digits.length; i += 2) {
      var black = patterns[Number(digits[i])];
      var white = patterns[Number(digits[i + 1])];
      for (var j = 0; j < 5; j++) {
        segment(true, black[j] === 'w' ? 2 : 1);
        segment(false, white[j] === 'w' ? 2 : 1);
      }
    }
    segment(true, 2);
    segment(false, 1);
    segment(true, 1);
    return { bars: bars, width: x };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeCollection: normalizeCollection, selectPage: selectPage, encodeItfBarPositions: encodeItfBarPositions, bookStampPose: bookStampPose };
  }
  if (typeof document === 'undefined') return;

  var root = document.querySelector('[data-douban-root]');
  if (!root) return;
  var tintCanvas;
  function posterPalette(image) {
    if (!tintCanvas) {
      tintCanvas = document.createElement('canvas');
      tintCanvas.width = 12;
      tintCanvas.height = 12;
    }
    try {
      var ctx = tintCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, 12, 12);
      var pixels = ctx.getImageData(0, 0, 12, 12).data;
      var counts = new Uint8Array(12), bottomCounts = new Uint8Array(12);
      var red = new Uint16Array(12), green = new Uint16Array(12), blue = new Uint16Array(12);
      var bottomRed = new Uint16Array(12), bottomGreen = new Uint16Array(12), bottomBlue = new Uint16Array(12);
      var neutrals = new Uint8Array(8), neutralRed = new Uint16Array(8);
      var neutralGreen = new Uint16Array(8), neutralBlue = new Uint16Array(8);
      var white = 0, edgeR = 0, edgeG = 0, edgeB = 0, edgeCount = 0;
      for (var y = 0; y < 12; y++) {
        for (var x = 0; x < 12; x++) {
          var i = (y * 12 + x) * 4;
          if (pixels[i + 3] < 128) continue;
          var r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          if (y >= 10) { edgeR += r; edgeG += g; edgeB += b; edgeCount++; }
          var hi = Math.max(r, g, b), lo = Math.min(r, g, b), chroma = hi - lo;
          if (y >= 8 && chroma < 30) {
            var shade = Math.min(7, hi >> 5);
            neutrals[shade]++;
            neutralRed[shade] += r; neutralGreen[shade] += g; neutralBlue[shade] += b;
            if (lo >= 238) white++;
          }
          if (chroma < 30 || hi < 55 || hi > 250) continue;
          var hue = (hi === r ? ((g - b) / chroma + 6) % 6 :
            hi === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60;
          var bin = Math.floor(hue / 30) % 12;
          counts[bin]++; red[bin] += r; green[bin] += g; blue[bin] += b;
          if (y >= 8) {
            bottomCounts[bin]++;
            bottomRed[bin] += r; bottomGreen[bin] += g; bottomBlue[bin] += b;
          }
        }
      }
      var most = 0, bottom = 0, shade = 0, neutralCount = 0;
      for (var j = 0; j < 12; j++) {
        if (counts[j] > counts[most]) most = j;
        if (bottomCounts[j] > bottomCounts[bottom]) bottom = j;
      }
      for (var k = 0; k < 8; k++) {
        neutralCount += neutrals[k];
        if (neutrals[k] > neutrals[shade]) shade = k;
      }
      var lightPaper = white >= 18 && neutralCount >= 32;
      var count, sums;
      if (lightPaper) {
        count = 1; sums = [255, 255, 255];
      } else if (neutralCount >= 26 && neutralCount > bottomCounts[bottom]) {
        count = neutrals[shade];
        sums = [neutralRed[shade], neutralGreen[shade], neutralBlue[shade]];
      } else if (bottomCounts[bottom] >= 5) {
        count = bottomCounts[bottom];
        sums = [bottomRed[bottom], bottomGreen[bottom], bottomBlue[bottom]];
      } else if (counts[most] >= 4) {
        count = counts[most];
        sums = [red[most], green[most], blue[most]];
      } else {
        return null;
      }
      var pr = Math.round(sums[0] / count), pg = Math.round(sums[1] / count), pb = Math.round(sums[2] / count);
      var er = edgeCount ? Math.round(edgeR / edgeCount) : pr;
      var eg = edgeCount ? Math.round(edgeG / edgeCount) : pg;
      var eb = edgeCount ? Math.round(edgeB / edgeCount) : pb;
      if (!lightPaper && edgeCount) {
        var difference = Math.max(Math.abs(pr - er), Math.abs(pg - eg), Math.abs(pb - eb));
        if (difference > 20) {
          var pull = Math.min(0.75, (difference - 12) / difference);
          pr = Math.round(pr * (1 - pull) + er * pull);
          pg = Math.round(pg * (1 - pull) + eg * pull);
          pb = Math.round(pb * (1 - pull) + eb * pull);
        }
      }
      function linear(value) {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      }
      var luminance = 0.2126 * linear(pr) + 0.7152 * linear(pg) + 0.0722 * linear(pb);
      return {
        paper: 'rgb(' + pr + ' ' + pg + ' ' + pb + ')',
        ink: luminance < 0.18 ? '#fff' : '#000',
        lightPaper: lightPaper,
        edge: lightPaper ? '#fff' : edgeCount ? 'rgb(' + er + ' ' + eg + ' ' + eb + ')' : null
      };
    } catch (error) {
      return null;
    }
  }
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-douban-kind]'));
  var status = root.querySelector('[data-douban-status]');
  var list = root.querySelector('[data-douban-list]');
  var retry = root.querySelector('[data-douban-retry]');
  var pagination = root.querySelector('[data-douban-pagination]');
  var readingSealTemplate = root.querySelector('[data-douban-reading-seal]');
  var readingSealId = 0;
  var sealCover, sealFrame, sealAvatar;

  function updateSealReveal() {
    sealFrame = 0;
    if (!sealCover) return;
    if (sealAvatar) sealAvatar.style.removeProperty('--seal-occlusion');
    var progress = 0;
    var activeRegion = sealCover.parentElement.classList.contains('is-reading-seal-active');
    sealAvatar = document.querySelector('[data-clawd-avatar]');
    if (!reduceMotion.matches && finePointer.matches && sealCover.isConnected) {
      var sprite = sealAvatar && sealAvatar.getBoundingClientRect();
      if (sprite && sprite.width && sprite.height && getComputedStyle(sealAvatar).opacity !== '0') {
        var cover = sealCover.getBoundingClientRect();
        var clamp = function (value) { return Math.max(0, Math.min(1, value)); };
        var left = clamp((cover.left - 5 - sprite.left) / sprite.width);
        var right = clamp((cover.right + 5 - sprite.left) / sprite.width);
        var top = clamp((cover.top - 5 - sprite.top) / sprite.height);
        var bottom = clamp((cover.bottom + 5 - sprite.top) / sprite.height);
        // The SVG's painted body occupies the center third, near the bottom.
        var width = Math.max(0, Math.min(right, 2 / 3) - Math.max(left, 1 / 3));
        var height = Math.max(0, Math.min(bottom, 41 / 45) - Math.max(top, 30 / 45));
        progress = clamp(width * height / (11 / 135));
        if (right > left && bottom > top) {
          if (new DOMMatrixReadOnly(getComputedStyle(sealAvatar).transform).a < 0) {
            var oldLeft = left;
            left = 1 - right;
            right = 1 - oldLeft;
          }
          var tl = left * 100 + '% ' + top * 100 + '%';
          var tr = right * 100 + '% ' + top * 100 + '%';
          var br = right * 100 + '% ' + bottom * 100 + '%';
          var bl = left * 100 + '% ' + bottom * 100 + '%';
          sealAvatar.style.setProperty('--seal-occlusion', 'polygon(evenodd, 0 0,100% 0,100% 100%,0 100%,0 0,' + [tl,tr,br,bl,tl].join(',') + ',0 0)');
        }
      } else if (activeRegion) {
        progress = 1;
      }
      if (activeRegion || progress > 0) sealFrame = requestAnimationFrame(updateSealReveal);
    }
    sealCover.style.setProperty('--seal-reveal', progress * .9);
    if (!sealFrame) {
      if (sealAvatar) sealAvatar.style.removeProperty('--seal-occlusion');
      sealCover = null;
    }
  }
  var updatePagination = window.createDoubanPagination(pagination, function (target) {
    page = target;
    render();
    list.focus({ preventScroll: true });
    list.scrollIntoView({ block: 'start' });
  });
  var data = null;
  var requestedTab = new URL(window.location.href).searchParams.get('tab');
  var active = tabs.some(function (tab) { return tab.getAttribute('data-douban-kind') === requestedTab; }) ? requestedTab : 'book';
  var page = 1;
  list.tabIndex = -1;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var cardObserver = new ResizeObserver(scheduleLayout);
  var layoutFrame = 0;

  function scheduleLayout() {
    if (active === 'game') {
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      list.style.height = '';
      return;
    }
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(function () {
      layoutFrame = 0;
      if (active === 'game') {
        list.style.height = '';
        return;
      }
      var cards = list.querySelectorAll('.douban-item');
      var single = window.matchMedia('(max-width: 900px)').matches;
      var width = list.clientWidth;
      var gap = single ? 0 : 48;
      var columnWidth = single ? width : (width - gap) / 2;
      var bottoms = [0, 0];
      Array.prototype.forEach.call(cards, function (card, index) {
        var column = single ? 0 : index % 2;
        var x = column * (columnWidth + gap);
        card.style.transform = 'translate3d(' + x + 'px,' + bottoms[column] + 'px,0)';
        bottoms[column] += card.getBoundingClientRect().height;
      });
      list.style.height = Math.max(bottoms[0], bottoms[1]) + 'px';
      if (data) list.classList.remove('is-loading');
    });
  }
  window.addEventListener('resize', scheduleLayout);


  function text(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function attachReadingSeal(cover, date) {
    var clip = readingSealTemplate.content.firstElementChild.cloneNode(true);
    var seal = clip.firstElementChild;
    var id = ++readingSealId;
    ['top', 'bottom'].forEach(function (arc) {
      var pathId = 'reading-seal-' + id + '-' + arc;
      seal.querySelector('[data-seal-arc="' + arc + '"]').id = pathId;
      seal.querySelector('[data-seal-label="' + arc + '"]').setAttribute('href', '#' + pathId);
    });
    seal.querySelector('[data-seal-date]').textContent = date.replace(/-/g, '.');
    cover.appendChild(clip);
    return seal;
  }

  function coverUrl(url) {
    return url.replace('/image/upload/', '/image/upload/f_auto,q_auto,w_320,c_limit/');
  }

  function render() {
    if (!data) return;
    cardObserver.disconnect();
    list.classList.toggle('douban-list--game', active === 'game');
    var items = data[active];
    var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    var fragment = document.createDocumentFragment();
    var visible = selectPage(items, page, pageSize);
    visible.forEach(function (item) {
        var card = document.createElement('article');
        card.className = 'douban-item douban-item--' + active;
        var body = document.createElement('div');
        body.className = 'douban-item__body';
        var coverLink = document.createElement('a');
        coverLink.className = 'douban-item__cover-link';
        coverLink.href = item.url;
        coverLink.target = '_blank';
        coverLink.rel = 'noopener noreferrer';
        if (active === 'book') {
          var pose = bookStampPose(item.id);
          coverLink.style.setProperty('--stamp-x-full', pose.x + 'px');
          coverLink.style.setProperty('--stamp-y-full', pose.y + 'px');
          coverLink.style.setProperty('--stamp-angle-full', pose.angle + 'deg');
          coverLink.style.setProperty('--stamp-x-half', pose.x / 2 + 'px');
          coverLink.style.setProperty('--stamp-y-half', pose.y / 2 + 'px');
          coverLink.style.setProperty('--stamp-angle-half', pose.angle / 2 + 'deg');
        }
        var watched = String(item.star_time || '').slice(0, 10);
        if (active === 'movie' && /^\d{4}-\d{2}-\d{2}$/.test(watched)) {
          coverLink.setAttribute('data-watch-date', watched);
        }
        coverLink.setAttribute('aria-label', item.title + (active === 'movie' && coverLink.hasAttribute('data-watch-date') ? ' · 观看于 ' + watched : '') + ' · 豆瓣');
        if (active === 'movie') {
          coverLink.target = '_self';
          coverLink.addEventListener('click', function (event) {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || reduceMotion.matches || coverLink.classList.contains('is-cover-loading')) return;
            event.preventDefault();
            coverLink.classList.add('is-ticket-torn');
            setTimeout(function () { window.location.assign(coverLink.href); }, 260);
          });
        }
        var coverFrame = 0;
        var readingSeal;
        var pointerX, pointerY, pointerType;
        var coverRegion = coverLink;
        if (active === 'book') {
          coverRegion = document.createElement('div');
          coverRegion.className = 'douban-item__book-cover-region';
          coverRegion.appendChild(coverLink);
        }
        coverRegion.addEventListener('pointermove', function (event) {
          if (active !== 'book' || !finePointer.matches || reduceMotion.matches) return;
          pointerX = event.clientX;
          pointerY = event.clientY;
          pointerType = event.pointerType;
          if (coverFrame) return;
          coverFrame = requestAnimationFrame(function () {
            coverFrame = 0;
            var bounds = coverLink.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            var x = Math.max(0, Math.min(1, (pointerX - bounds.left) / bounds.width));
            var y = Math.max(0, Math.min(1, (pointerY - bounds.top) / bounds.height));
            coverLink.style.setProperty('--cover-tilt-x', ((0.5 - y) * 6).toFixed(2) + 'deg');
            coverLink.style.setProperty('--cover-tilt-y', ((x - 0.5) * 6).toFixed(2) + 'deg');
            coverLink.style.setProperty('--cover-light-x', (x * 100).toFixed(1) + '%');
            coverLink.style.setProperty('--cover-light-y', (y * 100).toFixed(1) + '%');
            if (pointerType === 'mouse' && image.naturalWidth) {
              if (!readingSeal && readingSealTemplate && /^\d{4}-\d{2}-\d{2}$/.test(watched)) {
                readingSeal = attachReadingSeal(coverLink, watched);
              }
              if (!readingSeal) return;
              readingSeal.style.setProperty('--seal-x', (x * coverLink.clientWidth) + 'px');
              readingSeal.style.setProperty('--seal-y', (y * coverLink.clientHeight) + 'px');
              coverRegion.classList.add('is-reading-seal-active');
              if (sealCover && sealCover !== coverLink) sealCover.style.removeProperty('--seal-reveal');
              sealCover = coverLink;
              if (!sealFrame) sealFrame = requestAnimationFrame(updateSealReveal);
            }
          });
        });
        coverRegion.addEventListener('pointerleave', function () {
          if (coverFrame) cancelAnimationFrame(coverFrame);
          coverFrame = 0;
          coverRegion.classList.remove('is-reading-seal-active');
          coverLink.style.removeProperty('--cover-tilt-x');
          coverLink.style.removeProperty('--cover-tilt-y');
          coverLink.style.removeProperty('--cover-light-x');
          coverLink.style.removeProperty('--cover-light-y');
        });
        if (active === 'music') {
          var resetCover;
          coverLink.addEventListener('click', function () {
            if (!finePointer.matches || reduceMotion.matches) return;
            coverLink.classList.add('is-cover-activated');
            clearTimeout(resetCover);
            resetCover = setTimeout(function () {
              coverLink.classList.remove('is-cover-activated');
            }, 410);
          });
        }
        var image = document.createElement('img');
        image.className = 'douban-item__cover';
        image.alt = item.title + '封面';
        image.width = 96;
        image.height = 136;
        image.loading = 'lazy';
        image.decoding = 'async';
        if (active === 'movie') image.crossOrigin = 'anonymous';
        function finishCover() {
          if (card.classList.contains('douban-item--movie') && image.naturalWidth) {
            var palette = posterPalette(image);
            if (palette) {
              card.style.setProperty('--ticket-paper', palette.paper);
              card.style.setProperty('--ticket-ink', palette.ink);
              if (palette.edge) card.style.setProperty('--ticket-edge', palette.edge);
              if (palette.lightPaper) card.classList.add('douban-item--movie-light-paper');
            }
          }
          coverLink.classList.remove('is-cover-loading');
        }
        image.addEventListener('load', finishCover, { once: true });
        image.addEventListener('error', function () {
          if (active === 'music') coverLink.classList.add('is-cover-error');
          coverLink.classList.remove('is-cover-loading');
        }, { once: true });
        coverLink.classList.add('is-cover-loading');
        image.src = coverUrl(item.poster);
        if (image.complete) finishCover();
        coverLink.appendChild(image);
        if (active === 'game') {
          var backdrop = document.createElement('img');
          backdrop.className = 'douban-item__game-backdrop';
          backdrop.alt = '';
          backdrop.setAttribute('aria-hidden', 'true');
          backdrop.loading = 'lazy';
          backdrop.decoding = 'async';
          backdrop.src = image.src;
          card.appendChild(backdrop);
        }
        var ticketStub;
        if (active === 'movie') {
          ticketStub = document.createElement('span');
          ticketStub.className = 'douban-item__ticket-stub';
          ticketStub.setAttribute('aria-hidden', 'true');
          coverLink.appendChild(ticketStub);
        }
        if (active === 'movie' && coverLink.hasAttribute('data-watch-date')) {
          var encoded = encodeItfBarPositions(watched.replace(/-/g, ''));
          var ticketCode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          ticketCode.classList.add('douban-item__ticket-code');
          ticketCode.setAttribute('viewBox', '0 0 ' + (encoded.width + 20) + ' 14');
          ticketCode.setAttribute('width', encoded.width + 20);
          ticketCode.setAttribute('height', '14');
          ticketCode.setAttribute('aria-hidden', 'true');
          var codeBars = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          codeBars.setAttribute('fill', 'currentColor');
          codeBars.setAttribute('d', encoded.bars.map(function (bar) {
            var x = bar.x + 10;
            return 'M' + x + ' 0h' + bar.width + 'v14h-' + bar.width + 'z';
          }).join(''));
          ticketCode.appendChild(codeBars);
          ticketStub.appendChild(ticketCode);
        }
        var details = document.createElement('div');
        details.className = 'douban-item__details';
        var title = text('a', 'douban-item__title', item.title);
        title.href = item.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        details.appendChild(title);
        var meta = [watched, String(item.pubdate || '').slice(0, 4)].filter(Boolean).join(' · ');
        var metaRow = active === 'game' ? document.createElement('div') : details;
        if (active === 'game') {
          metaRow.className = 'douban-item__game-meta';
          meta = '玩过' + (watched ? ' · ' + watched.replace(/-/g, '.') : '');
        }
        if (meta) metaRow.appendChild(text('span', 'douban-item__meta', meta));
        if (item.star && /^[1-5]$/.test(String(item.star))) {
          var stars = text('span', 'douban-item__stars', '★'.repeat(Number(item.star)) + '☆'.repeat(5 - Number(item.star)));
          stars.setAttribute('aria-label', '我的评分 ' + item.star + ' / 5');
          metaRow.appendChild(stars);
        }
        if (active === 'game') details.appendChild(metaRow);
        if (item.rating) details.appendChild(text('span', 'douban-item__rating', '豆瓣 ' + item.rating));
        if (item.comment) {
          var comment = text('button', 'douban-item__comment', '');
          comment.type = 'button';
          comment.setAttribute('aria-expanded', 'false');
          comment.setAttribute('aria-label', '展开《' + item.title + '》的评价：' + item.comment);
          var commentText = text('span', 'douban-item__comment-text', item.comment);
          comment.appendChild(commentText);
          comment.addEventListener('click', function () {
            var expanded = comment.getAttribute('aria-expanded') === 'true';
            comment.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            comment.setAttribute('aria-label', (expanded ? '展开《' : '收起《') + item.title + '》的评价：' + item.comment);
            commentText.style.maxHeight = expanded ? '' : commentText.scrollHeight + 'px';
          });
          details.appendChild(comment);
          card._comment = comment;
        }
        body.appendChild(coverRegion);
        body.appendChild(details);
        card.appendChild(body);
        fragment.appendChild(card);
    });
    list.replaceChildren(fragment);
    if (active !== 'game') {
      Array.prototype.forEach.call(list.querySelectorAll('.douban-item'), function (card) {
        cardObserver.observe(card);
      });
    }
    scheduleLayout();
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(list.querySelectorAll('.douban-item'), function (card) {
        if (!card._comment) return;
        var comment = card._comment;
        var preview = comment.firstChild;
        if (preview.scrollHeight <= preview.clientHeight + 1) {
          comment.replaceWith(text('p', 'douban-item__short-comment', preview.textContent));
        }
        delete card._comment;
      });
    });
    status.textContent = items.length ? '' : '这里暂时没有记录。';
    pagination.hidden = items.length <= pageSize;
    updatePagination.update(page, totalPages);
    tabs.forEach(function (tab) {
      var selected = tab.getAttribute('data-douban-kind') === active;
      tab.setAttribute('aria-pressed', selected ? 'true' : 'false');
      tab.querySelector('[data-douban-count]').textContent = data[tab.getAttribute('data-douban-kind')].length;
    });
    document.dispatchEvent(new CustomEvent('carver:doubanchange'));
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      active = tab.getAttribute('data-douban-kind');
      var url = new URL(window.location.href);
      if (active === 'book') url.searchParams.delete('tab');
      else url.searchParams.set('tab', active);
      window.history.replaceState(window.history.state, '', url);
      page = 1;
      render();
    });
  });

  function load() {
    status.textContent = '正在载入书影音与游戏…';
    retry.hidden = true;
    fetch(root.getAttribute('data-douban-url'))
      .then(function (response) { if (!response.ok) throw new Error('Data unavailable'); return response.json(); })
      .then(function (payload) { data = normalizeCollection(payload); render(); })
      .catch(function () {
        list.classList.remove('is-loading');
        status.textContent = '书影音与游戏数据暂不可用，请稍后重试。';
        retry.hidden = false;
      });
  }
  retry.addEventListener('click', load);
  load();
}());
