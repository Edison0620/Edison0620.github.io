(function () {
  'use strict';

  var root = document.querySelector('[data-search-root]');
  if (!root) return;

  var trigger = root.querySelector('[data-search-open]');
  var dialog = root.querySelector('[data-search-dialog]');
  var closeButton = root.querySelector('[data-search-close]');
  var form = root.querySelector('[data-search-form]');
  var input = root.querySelector('[data-search-input]');
  var status = root.querySelector('[data-search-status]');
  var retry = root.querySelector('[data-search-retry]');
  var resultsList = root.querySelector('[data-search-results]');

  if (!trigger || !dialog || !closeButton || !form || !input || !status || !retry || !resultsList) return;

  var endpoint = root.getAttribute('data-search-endpoint') || '/eishan-search.json';
  var locale = document.documentElement.lang || window.navigator.language || 'en';
  var index = null;
  var loading = null;
  var restoreFocusTo = null;
  var resultLimit = 20;

  var labels = {
    idle: root.getAttribute('data-label-idle') || 'Enter a term to search',
    loading: root.getAttribute('data-label-loading') || 'Loading search index…',
    empty: root.getAttribute('data-label-empty') || 'No matching content found',
    error: root.getAttribute('data-label-error') || 'Could not load the search index. Please try again.',
    count: root.getAttribute('data-label-count') || '{count} results found',
    limited: root.getAttribute('data-label-limited') || '{count} results found; showing the first {limit}'
  };

  var getConfiguredOrigin = function () {
    var configured = root.getAttribute('data-site-origin');
    if (!configured) return null;
    try {
      var parsed = new URL(configured, window.location.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.origin;
    } catch (error) {
      return null;
    }
  };
  var configuredOrigin = getConfiguredOrigin();

  var normalize = function (value) {
    var text = String(value || '').normalize ? String(value || '').normalize('NFKC') : String(value || '');
    try {
      return text.toLocaleLowerCase(locale);
    } catch (error) {
      return text.toLowerCase();
    }
  };

  var decodeEntities = function (value) {
    var named = {
      amp: '&',
      apos: "'",
      gt: '>',
      lt: '<',
      nbsp: ' ',
      quot: '"'
    };

    return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|amp|apos|gt|lt|nbsp|quot);/gi, function (entity, key) {
      if (key.charAt(0) !== '#') return named[key.toLowerCase()] || entity;
      var hexadecimal = key.charAt(1).toLowerCase() === 'x';
      var number = parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!isFinite(number) || number < 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) return '';
      try {
        return String.fromCodePoint(number);
      } catch (error) {
        return '';
      }
    });
  };

  var plainText = function (value) {
    return decodeEntities(String(value || ''))
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  var normalizeResultUrl = function (rawUrl) {
    var value = String(rawUrl || '').trim();
    if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return null;

    // Some existing search indexes emit `//post.html` for a site-root URL.
    // Treat it as `/post.html`, never as a protocol-relative external URL.
    if (value.indexOf('//') === 0) value = '/' + value.replace(/^\/+/, '');

    var hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value);
    var parsed;
    try {
      if (!hasProtocol && value.charAt(0) !== '/') value = '/' + value.replace(/^\.\//, '');
      parsed = new URL(value, window.location.origin);
    } catch (error) {
      return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (hasProtocol && parsed.origin !== window.location.origin && parsed.origin !== configuredOrigin) return null;
    if (!hasProtocol && parsed.origin !== window.location.origin) return null;

    return parsed.pathname + parsed.search + parsed.hash;
  };

  var parseIndex = function (records) {
    if (!Array.isArray(records)) throw new Error('Invalid search index JSON');

    return records.map(function (entry) {
      if (!entry || typeof entry !== 'object') return null;
      var href = normalizeResultUrl(entry.url);
      if (!href) return null;
      var title = plainText(entry.title) || href;
      var content = plainText(entry.content);
      return {
        title: title,
        content: content,
        href: href,
        searchableTitle: normalize(title),
        searchableContent: normalize(content)
      };
    }).filter(function (entry) {
      return entry !== null;
    });
  };

  var clearResults = function () {
    while (resultsList.firstChild) resultsList.removeChild(resultsList.firstChild);
  };

  var formatLabel = function (template, values) {
    return template.replace(/\{(count|limit)\}/g, function (match, key) {
      return String(values[key]);
    });
  };

  var createSnippet = function (content, terms) {
    if (!content) return '';
    var folded = normalize(content);
    var matchAt = -1;
    terms.some(function (term) {
      matchAt = folded.indexOf(term);
      return matchAt >= 0;
    });
    var start = matchAt > 55 ? matchAt - 55 : 0;
    var snippet = content.slice(start, start + 160).trim();
    if (start > 0) snippet = '…' + snippet;
    if (start + 160 < content.length) snippet += '…';
    return snippet;
  };

  var renderResults = function (matches, terms) {
    clearResults();
    var fragment = document.createDocumentFragment();

    matches.slice(0, resultLimit).forEach(function (entry) {
      var item = document.createElement('li');
      item.className = 'site-search__result';

      var link = document.createElement('a');
      link.className = 'site-search__result-link';
      link.href = entry.href;

      var title = document.createElement('span');
      title.className = 'site-search__result-title';
      title.textContent = entry.title;
      link.appendChild(title);

      var snippetText = createSnippet(entry.content, terms);
      if (snippetText) {
        var snippet = document.createElement('span');
        snippet.className = 'site-search__result-snippet';
        snippet.textContent = snippetText;
        link.appendChild(snippet);
      }

      item.appendChild(link);
      fragment.appendChild(item);
    });

    resultsList.appendChild(fragment);
  };

  var search = function () {
    if (!index) return;
    var terms = normalize(input.value).split(/\s+/).filter(Boolean);
    retry.hidden = true;

    if (!terms.length) {
      clearResults();
      status.textContent = labels.idle;
      return;
    }

    var matches = index.filter(function (entry) {
      return terms.every(function (term) {
        return entry.searchableTitle.indexOf(term) !== -1 || entry.searchableContent.indexOf(term) !== -1;
      });
    });

    renderResults(matches, terms);
    if (!matches.length) {
      status.textContent = labels.empty;
    } else if (matches.length > resultLimit) {
      status.textContent = formatLabel(labels.limited, { count: matches.length, limit: resultLimit });
    } else {
      status.textContent = formatLabel(labels.count, { count: matches.length, limit: resultLimit });
    }
  };

  var loadIndex = function () {
    if (index) return Promise.resolve(index);
    if (loading) return loading;

    status.textContent = labels.loading;
    retry.hidden = true;
    dialog.setAttribute('aria-busy', 'true');

    loading = window.fetch(endpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (!response.ok) throw new Error('Search index request failed');
      return response.json();
    }).then(function (records) {
      index = parseIndex(records);
      dialog.removeAttribute('aria-busy');
      search();
      return index;
    }).catch(function (error) {
      loading = null;
      dialog.removeAttribute('aria-busy');
      clearResults();
      status.textContent = labels.error;
      retry.hidden = false;
      throw error;
    });

    // The visible error state handles rejection; avoid an unhandled promise.
    loading.catch(function () {});
    return loading;
  };

  var isOpen = function () {
    return !dialog.hidden;
  };

  var openSearch = function () {
    if (isOpen()) return;
    restoreFocusTo = document.activeElement;
    dialog.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('search-open');
    window.requestAnimationFrame(function () {
      input.focus();
    });
    loadIndex();
  };

  var closeSearch = function () {
    if (!isOpen()) return;
    dialog.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('search-open');
    if (restoreFocusTo && typeof restoreFocusTo.focus === 'function' && document.contains(restoreFocusTo)) {
      restoreFocusTo.focus();
    } else {
      trigger.focus();
    }
  };

  var focusableElements = function () {
    return Array.prototype.filter.call(
      dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (element) {
        return !element.hidden && element.getAttribute('aria-hidden') !== 'true';
      }
    );
  };

  trigger.addEventListener('click', openSearch);
  closeButton.addEventListener('click', closeSearch);
  retry.addEventListener('click', loadIndex);
  input.addEventListener('input', search);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    search();
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) closeSearch();
  });

  document.addEventListener('keydown', function (event) {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key !== 'Tab') return;

    var focusable = focusableElements();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
