(function () {
  'use strict';

  var kinds = ['book', 'movie', 'music'];
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
      if (!Array.isArray(payload.items[kind])) throw new Error('Missing Douban collection: ' + kind);
      result[kind] = payload.items[kind].filter(function (item) {
        return item && typeof item.title === 'string' && typeof item.id === 'string' &&
          safeUrl(item.url, kind + '.douban.com', '/subject/') &&
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeCollection: normalizeCollection, selectPage: selectPage };
  }
  if (typeof document === 'undefined') return;

  var root = document.querySelector('[data-douban-root]');
  if (!root) return;
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-douban-kind]'));
  var status = root.querySelector('[data-douban-status]');
  var list = root.querySelector('[data-douban-list]');
  var retry = root.querySelector('[data-douban-retry]');
  var pagination = root.querySelector('[data-douban-pagination]');
  var updatePagination = window.createDoubanPagination(pagination, function (target) {
    page = target;
    render();
    list.focus({ preventScroll: true });
    list.scrollIntoView({ block: 'start' });
  });
  var data = null;
  var active = 'book';
  var page = 1;
  list.tabIndex = -1;
  var cardObserver = new ResizeObserver(scheduleLayout);
  var layoutFrame = 0;

  function scheduleLayout() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(function () {
      layoutFrame = 0;
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
    });
  }
  window.addEventListener('resize', scheduleLayout);


  function text(tag, className, value) {
    var node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function coverUrl(url) {
    return url.replace('/image/upload/', '/image/upload/f_auto,q_auto,w_320,c_limit/');
  }

  function render() {
    if (!data) return;
    cardObserver.disconnect();
    var items = data[active];
    var totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    var fragment = document.createDocumentFragment();
    var visible = selectPage(items, page, pageSize);
    visible.forEach(function (item) {
        var card = document.createElement('article');
        card.className = 'douban-item';
        var body = document.createElement('div');
        body.className = 'douban-item__body';
        var coverLink = document.createElement('a');
        coverLink.className = 'douban-item__cover-link';
        coverLink.href = item.url;
        coverLink.target = '_blank';
        coverLink.rel = 'noopener noreferrer';
        coverLink.setAttribute('aria-label', item.title + ' · 豆瓣');
        var image = document.createElement('img');
        image.className = 'douban-item__cover';
        image.src = coverUrl(item.poster);
        image.alt = item.title + '封面';
        image.width = 80;
        image.height = 112;
        image.loading = 'lazy';
        image.decoding = 'async';
        coverLink.appendChild(image);
        var details = document.createElement('div');
        details.className = 'douban-item__details';
        var title = text('a', 'douban-item__title', item.title);
        title.href = item.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        details.appendChild(title);
        var meta = [String(item.star_time || '').slice(0, 10), String(item.pubdate || '').slice(0, 4)].filter(Boolean).join(' · ');
        if (meta) details.appendChild(text('span', 'douban-item__meta', meta));
        if (item.star && /^[1-5]$/.test(String(item.star))) {
          var stars = text('span', 'douban-item__stars', '★'.repeat(Number(item.star)) + '☆'.repeat(5 - Number(item.star)));
          stars.setAttribute('aria-label', '我的评分 ' + item.star + ' / 5');
          details.appendChild(stars);
        }
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
        body.appendChild(coverLink);
        body.appendChild(details);
        card.appendChild(body);
        fragment.appendChild(card);
    });
    list.replaceChildren(fragment);
    Array.prototype.forEach.call(list.querySelectorAll('.douban-item'), function (card) {
      cardObserver.observe(card);
    });
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
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      active = tab.getAttribute('data-douban-kind');
      page = 1;
      render();
    });
  });

  function load() {
    status.textContent = '正在载入书影音…';
    retry.hidden = true;
    fetch(root.getAttribute('data-douban-url'), { cache: 'no-store' })
      .then(function (response) { if (!response.ok) throw new Error('Data unavailable'); return response.json(); })
      .then(function (payload) { data = normalizeCollection(payload); render(); })
      .catch(function () {
        status.textContent = '书影音数据暂不可用，请稍后重试。';
        retry.hidden = false;
      });
  }
  retry.addEventListener('click', load);
  load();
}());
