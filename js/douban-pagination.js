(function () {
  'use strict';

  var instances = new WeakMap();

  function pageWindow(current, total) {
    var pages = [];
    var page;

    if (total <= 7) {
      for (page = 1; page <= total; page += 1) pages.push(page);
      return pages;
    }

    if (current <= 4) return [1, 2, 3, 4, null, total];
    if (current >= total - 3) return [1, null, total - 3, total - 2, total - 1, total];

    return [1, null, current - 1, current, current + 1, null, total];
  }

  function makeButton(page, label, className, disabled) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.page = String(page);
    button.setAttribute('aria-label', label);
    button.textContent = className.indexOf('--previous') !== -1 ? '‹' :
      className.indexOf('--next') !== -1 ? '›' : String(page);
    button.disabled = disabled;
    return button;
  }

  function render(state, current, total) {
    var fragment = document.createDocumentFragment();
    var pages = pageWindow(current, total);

    fragment.appendChild(makeButton(
      current - 1,
      '上一页',
      'douban-pagination__button douban-pagination__button--previous',
      current === 1
    ));

    pages.forEach(function (page) {
      if (page === null) {
        var ellipsis = document.createElement('span');
        ellipsis.className = 'douban-pagination__ellipsis';
        ellipsis.setAttribute('aria-hidden', 'true');
        ellipsis.textContent = '…';
        fragment.appendChild(ellipsis);
        return;
      }

      var button = makeButton(
        page,
        page === current ? '第 ' + page + ' 页，当前页' : '转到第 ' + page + ' 页',
        'douban-pagination__button douban-pagination__button--page',
        false
      );
      if (page === current) button.setAttribute('aria-current', 'page');
      fragment.appendChild(button);
    });

    fragment.appendChild(makeButton(
      current + 1,
      '下一页',
      'douban-pagination__button douban-pagination__button--next',
      current === total
    ));

    state.element.replaceChildren(fragment);
  }

  window.createDoubanPagination = function (element, onSelect) {
    if (!element || typeof element.replaceChildren !== 'function') {
      throw new TypeError('A pagination element is required.');
    }
    if (typeof onSelect !== 'function') {
      throw new TypeError('A page selection callback is required.');
    }

    var existing = instances.get(element);
    if (existing) {
      existing.state.onSelect = onSelect;
      return existing.api;
    }

    var state = {
      element: element,
      onSelect: onSelect,
      current: 0,
      total: 0
    };

    element.addEventListener('click', function (event) {
      var target = event.target;
      var button = target && typeof target.closest === 'function' ?
        target.closest('button[data-page]') : null;
      if (!button || !element.contains(button) || button.disabled) return;

      var page = Number(button.dataset.page);
      if (!Number.isInteger(page) || page < 1 || page > state.total || page === state.current) return;
      state.onSelect(page);
    });

    var api = {
      update: function (current, total) {
        total = Math.max(0, Math.trunc(Number(total) || 0));
        if (total === 0) {
          state.current = 0;
          state.total = 0;
          element.replaceChildren();
          return;
        }

        current = Math.min(total, Math.max(1, Math.trunc(Number(current) || 1)));
        state.current = current;
        state.total = total;
        render(state, current, total);
      }
    };

    instances.set(element, { state: state, api: api });
    return api;
  };
}());
