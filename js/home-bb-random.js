(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  let activeCleanup = () => {};
  let generation = 0;
  const initialize = async () => {
    const current = ++generation;
    activeCleanup();
    activeCleanup = () => {};
    const cleanup = await api.initHomeBbRandom(
      root.document,
      root.fetch.bind(root),
      root.__homeBbRandomConfig || {}
    );
    if (current !== generation) return cleanup();
    activeCleanup = cleanup;
  };
  root.document.addEventListener('page:loaded', initialize);
})(typeof window === 'undefined' ? null : window, function() {
  function normalizePost(post) {
    if (!post) return null;
    const id = String(post.id || '').trim();
    const text = String(post.text || '').replace(/\s+/g, ' ').trim();
    return id && text ? { id, text } : null;
  }

  function normalizeRandomPost(payload) {
    return normalizePost(payload?.post);
  }

  function normalizeRandomPosts(payload) {
    const source = Array.isArray(payload?.posts) ? payload.posts : [payload?.post];
    const seen = new Set();
    const posts = [];
    for (const item of source) {
      const post = normalizePost(item);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
      if (posts.length === 5) break;
    }
    return posts;
  }

  function buildBbDeepLink(bbPath, id, page = 1) {
    const value = Number(page);
    const normalizedPage = Number.isInteger(value) && value > 0 ? value : 1;
    return String(bbPath || '/bb/').replace(/[?#].*$/, '')
      + '?page=' + normalizedPage + '#bb-' + encodeURIComponent(id);
  }

  function cleanBbPath(bbPath) {
    return String(bbPath || '/bb/').replace(/[?#].*$/, '');
  }

  function buildEntryState(post, bbPath) {
    if (!post) {
      return {
        kind: 'fallback',
        href: cleanBbPath(bbPath),
        text: '看看最近的片刻',
        title: '看看最近的片刻',
        ariaLabel: '查看最近的 BB',
      };
    }

    return {
      kind: 'random',
      href: buildBbDeepLink(bbPath, post.id, 1),
      text: post.text,
      title: post.text,
      ariaLabel: '随机 BB：' + post.text,
    };
  }

  function shuffleForNextCycle(states, previousHref, random = Math.random) {
    const shuffled = states.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const selected = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))));
      [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
    }
    if (shuffled.length > 1 && shuffled[0].href === previousHref) {
      shuffled.push(shuffled.shift());
    }
    return shuffled;
  }

  async function loadEntryStates(fetchRandomPost, config) {
    const fallback = () => [buildEntryState(null, config.bbPath)];
    if (!config.apiBase) return fallback();

    try {
      const url = new URL('/api/posts/random', config.apiBase);
      url.searchParams.set('pool_size', String(config.poolSize || 20));
      url.searchParams.set('count', '5');
      const response = await fetchRandomPost(url.toString(), {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return fallback();
      const posts = normalizeRandomPosts(await response.json());
      return posts.length
        ? posts.map(post => buildEntryState(post, config.bbPath))
        : fallback();
    } catch {
      return fallback();
    }
  }

  function normalizePath(path) {
    const segments = String(path || '/').split(/[?#]/, 1)[0].split('/').filter(Boolean);
    return segments.length ? '/' + segments.join('/') + '/' : '/';
  }

  function isRootHomePath(pathname, siteRoot) {
    return normalizePath(pathname) === normalizePath(siteRoot);
  }

  function createSvgElement(document, name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function createUnderline(document) {
    const underline = createSvgElement(document, 'svg', {
      class: 'home-bb-random-underline',
      viewBox: '0 0 360 14',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    underline.setAttribute('class', 'home-bb-random-underline');
    const defs = createSvgElement(document, 'defs');
    const filter = createSvgElement(document, 'filter', {
      id: 'home-bb-random-dry-brush',
      x: '-4%', y: '-80%', width: '108%', height: '260%',
    });
    const noise = createSvgElement(document, 'feTurbulence', {
      type: 'fractalNoise',
      baseFrequency: '0.018 0.38',
      numOctaves: '3',
      seed: '19',
      result: 'home-bb-random-brush-noise',
    });
    const displacement = createSvgElement(document, 'feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'home-bb-random-brush-noise',
      scale: '3.4',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    });
    filter.append(noise, displacement);
    defs.append(filter);

    const pigment = createSvgElement(document, 'path', {
      class: 'home-bb-random-stroke home-bb-random-pigment',
      d: 'M3 7.8 C28 4.3 54 9.7 83 6.2 C118 2.9 143 9.8 176 6.7 C213 3.2 242 9.4 276 6.1 C307 3.8 333 7.8 357 5.9',
      style: 'filter: url(#home-bb-random-dry-brush)',
    });
    const edge = createSvgElement(document, 'path', {
      class: 'home-bb-random-stroke home-bb-random-edge',
      d: 'M4 10.1 C39 7.4 64 11.4 101 8.8 C141 6.2 169 11 207 8.2 C251 5.9 298 10.4 356 7.7',
      style: 'filter: url(#home-bb-random-dry-brush)',
    });
    const channel = createSvgElement(document, 'path', {
      class: 'home-bb-random-stroke home-bb-random-channel',
      d: 'M8 7 C52 6.1 91 7.8 132 6.6 S211 7.7 253 6.5 S322 7.1 351 6.7',
    });
    underline.append(defs, pigment, edge, channel);
    return underline;
  }

  function createEntry(document, bbPath) {
    const entry = document.createElement('aside');
    entry.className = 'home-bb-random';
    entry.setAttribute('data-home-bb-random', '');
    entry.setAttribute('data-state', 'loading');
    entry.setAttribute('aria-label', '随机旁白');
    entry.setAttribute('aria-busy', 'true');

    const link = document.createElement('a');
    link.className = 'home-bb-random-link';
    link.setAttribute('data-home-bb-random-link', '');
    link.setAttribute('href', cleanBbPath(bbPath));
    link.setAttribute('tabindex', '-1');

    const mark = document.createElement('span');
    mark.className = 'home-bb-random-mark';
    mark.setAttribute('aria-hidden', 'true');

    const content = document.createElement('span');
    content.className = 'home-bb-random-content';

    const text = document.createElement('span');
    text.className = 'home-bb-random-text';
    text.setAttribute('data-home-bb-random-text', '');
    content.append(text, createUnderline(document));

    link.append(mark, content);
    entry.append(link);
    return { entry, link, text };
  }

  function applyEntryState(elements, state) {
    elements.link.setAttribute('href', state.href);
    elements.link.setAttribute('title', state.title);
    elements.link.setAttribute('aria-label', state.ariaLabel);
    elements.text.textContent = state.text;
    elements.entry.setAttribute('data-state', state.kind);
  }

  function revealEntry(document, elements, state) {
    if (elements.entry.isConnected === false) return;
    applyEntryState(elements, state);
    elements.link.removeAttribute('tabindex');
    elements.entry.setAttribute('aria-busy', 'false');

    const view = document.defaultView;
    if (view && typeof view.requestAnimationFrame === 'function') {
      view.requestAnimationFrame(() => elements.entry.classList.add('is-ready'));
    } else {
      elements.entry.classList.add('is-ready');
    }
  }

  function createCarouselController(document, elements, states, options = {}) {
    const view = document.defaultView || {};
    const setTimeoutFn = options.setTimeoutFn || view.setTimeout.bind(view);
    const clearTimeoutFn = options.clearTimeoutFn || view.clearTimeout.bind(view);
    const requestAnimationFrameFn = options.requestAnimationFrameFn
      || view.requestAnimationFrame.bind(view);
    const matchMediaFn = options.matchMediaFn || view.matchMedia.bind(view);
    const applyStateFn = options.applyStateFn || (state => applyEntryState(elements, state));
    const random = options.random || Math.random;
    const paused = new Set();
    const reduced = matchMediaFn('(prefers-reduced-motion: reduce)').matches;
    let queue = states.slice();
    let index = 0;
    let waitTimer = null;
    let transitionTimer = null;
    let disposed = false;

    const clearWait = () => {
      if (waitTimer !== null) clearTimeoutFn(waitTimer);
      waitTimer = null;
    };
    const clearTransition = () => {
      if (transitionTimer !== null) clearTimeoutFn(transitionTimer);
      transitionTimer = null;
      elements.entry.classList?.remove('is-changing');
    };
    const schedule = () => {
      clearWait();
      if (disposed || reduced || queue.length < 2 || paused.size) return;
      waitTimer = setTimeoutFn(advance, 12000);
    };
    const advance = () => {
      waitTimer = null;
      let nextQueue = queue;
      let nextIndex = index + 1;
      if (index + 1 >= queue.length) {
        nextQueue = shuffleForNextCycle(states, queue[index].href, random);
        nextIndex = 0;
      }
      elements.entry.classList?.add('is-changing');
      transitionTimer = setTimeoutFn(() => {
        transitionTimer = null;
        queue = nextQueue;
        index = nextIndex;
        applyStateFn(queue[index]);
        requestAnimationFrameFn(() => elements.entry.classList?.remove('is-changing'));
        schedule();
      }, 140);
    };
    const pause = reason => {
      paused.add(reason);
      clearWait();
      clearTransition();
    };
    const resume = reason => {
      paused.delete(reason);
      schedule();
    };
    const onPointerEnter = () => pause('pointer');
    const onPointerLeave = () => resume('pointer');
    const onFocusIn = () => pause('focus');
    const onFocusOut = event => {
      if (!elements.entry.contains(event.relatedTarget)) resume('focus');
    };
    const onVisibility = () => (document.hidden ? pause('hidden') : resume('hidden'));

    return {
      start() {
        if (reduced || queue.length < 2) return;
        elements.entry.addEventListener('pointerenter', onPointerEnter);
        elements.entry.addEventListener('pointerleave', onPointerLeave);
        elements.entry.addEventListener('focusin', onFocusIn);
        elements.entry.addEventListener('focusout', onFocusOut);
        document.addEventListener('visibilitychange', onVisibility);
        if (document.hidden) paused.add('hidden');
        schedule();
      },
      cleanup() {
        disposed = true;
        clearWait();
        clearTransition();
        elements.entry.removeEventListener('pointerenter', onPointerEnter);
        elements.entry.removeEventListener('pointerleave', onPointerLeave);
        elements.entry.removeEventListener('focusin', onFocusIn);
        elements.entry.removeEventListener('focusout', onFocusOut);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
  }

  async function initHomeBbRandom(document, fetchRandomPost, config = {}) {
    const home = document.querySelector('.main-inner.index');
    if (!home || !isRootHomePath(document.location.pathname, config.siteRoot)) return () => {};
    if (home.querySelector('[data-home-bb-random]')) return () => {};

    const elements = createEntry(document, config.bbPath);
    home.prepend(elements.entry);
    const states = await loadEntryStates(fetchRandomPost, config);
    if (elements.entry.isConnected === false) return () => {};
    revealEntry(document, elements, states[0]);
    const controller = createCarouselController(document, elements, states);
    controller.start();
    return () => controller.cleanup();
  }

  return {
    applyEntryState,
    buildBbDeepLink,
    buildEntryState,
    createCarouselController,
    initHomeBbRandom,
    isRootHomePath,
    loadEntryStates,
    normalizePost,
    normalizeRandomPost,
    normalizeRandomPosts,
    shuffleForNextCycle,
  };
});
