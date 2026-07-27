(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  root.ContentImageStates = api;
  let activeCleanup = () => {};
  const initialize = () => {
    activeCleanup();
    activeCleanup = api.initContentImageStates(root.document, {
      Image: root.Image,
      MutationObserver: root.MutationObserver,
    });
  };
  root.document.addEventListener('page:loaded', initialize);
})(typeof window === 'undefined' ? null : window, function() {
  const CONTENT_IMAGE_SELECTOR = '.post-body img, .bb-channel-content img';
  const BB_IMAGE_SELECTOR = 'img[data-bb-image-url]';
  const BB_HOLDER_SELECTOR = '.bb-channel-media-thumb, .bb-channel-image-slide';
  const BB_FAILED_HOLDER_SELECTOR = '.bb-channel-media-thumb[data-bb-loaded="error"], .bb-channel-image-slide[data-bb-loaded="error"]';

  function isExcludedContentImage(image) {
    const src = image.currentSrc || image.getAttribute('src') || '';
    return image.getAttribute('data-image-state') === 'off'
      || image.matches(BB_IMAGE_SELECTOR)
      || Boolean(image.closest('.post-reward, .reward-container, .sidebar, .site-author-image'))
      || image.classList.contains('emoji')
      || /(?:img\.shields\.io|shields\.io)/iu.test(src);
  }

  function createErrorIcon(document) {
    const namespace = 'http://www.w3.org/2000/svg';
    const icon = document.createElementNS(namespace, 'svg');
    icon.setAttribute('class', 'content-image-error-icon');
    icon.setAttribute('viewBox', '0 0 32 32');
    icon.setAttribute('aria-hidden', 'true');

    const frame = document.createElementNS(namespace, 'rect');
    frame.setAttribute('x', '4.5');
    frame.setAttribute('y', '5.5');
    frame.setAttribute('width', '23');
    frame.setAttribute('height', '21');
    frame.setAttribute('rx', '3');

    const landscape = document.createElementNS(namespace, 'path');
    landscape.setAttribute('d', 'M7.5 22.5 13 17l4.2 4.2 3.2-3.2 4.1 4.5');

    const sun = document.createElementNS(namespace, 'circle');
    sun.setAttribute('cx', '11');
    sun.setAttribute('cy', '11.5');
    sun.setAttribute('r', '2');

    const slash = document.createElementNS(namespace, 'path');
    slash.setAttribute('d', 'M7 27 27 7');
    slash.setAttribute('class', 'content-image-error-slash');
    icon.append(frame, landscape, sun, slash);
    return icon;
  }

  function errorMessageFor(image) {
    return image.getAttribute('alt')?.trim() || '图片暂时不可用';
  }

  function createErrorCard(document, image, interactive = true) {
    const card = document.createElement('span');
    card.className = 'content-image-error-card';
    card.setAttribute('data-content-image-error', '');

    const message = document.createElement('span');
    message.className = 'content-image-error-message';
    message.textContent = errorMessageFor(image);
    card.append(createErrorIcon(document), message);

    if (interactive) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'content-image-retry';
      retry.setAttribute('data-content-image-retry', '');
      retry.setAttribute('aria-label', `重新加载图片：${message.textContent}`);
      retry.textContent = '点击重试';
      card.append(retry);
    } else {
      const action = document.createElement('span');
      action.className = 'content-image-retry-label';
      action.textContent = '点击重试';
      card.append(action);
    }
    return card;
  }

  function createFrame(document, image) {
    const parentLink = image.parentElement?.tagName === 'A'
      && image.parentElement.children.length === 1 ? image.parentElement : null;
    const visual = parentLink || image;
    if (!visual.parentNode) return null;

    const frame = document.createElement('span');
    frame.className = 'content-image-frame';
    frame.setAttribute('data-image-state', 'loading');
    frame.setAttribute('data-content-image-frame', '');
    image.setAttribute('data-image-original-src', image.currentSrc || image.getAttribute('src') || '');
    image.setAttribute('data-content-image-initialized', 'true');
    visual.parentNode.insertBefore(frame, visual);
    frame.append(visual, createErrorCard(document, image));
    return frame;
  }

  function setFrameState(frame, state) {
    frame.setAttribute('data-image-state', state);
    const retry = frame.querySelector('[data-content-image-retry]');
    if (retry) retry.disabled = state === 'retrying';
  }

  function hasUsableImage(image) {
    return image.complete && image.naturalWidth > 0;
  }

  function retryImage(image, frame, ImageConstructor) {
    if (frame.getAttribute('data-image-state') === 'retrying') return;
    const src = image.getAttribute('data-image-original-src');
    if (!src) {
      setFrameState(frame, 'error');
      return;
    }

    setFrameState(frame, 'retrying');
    const preload = new ImageConstructor();
    preload.decoding = 'async';
    preload.onload = () => {
      image.src = src;
      if (hasUsableImage(image)) setFrameState(frame, 'loaded');
    };
    preload.onerror = () => setFrameState(frame, 'error');
    preload.src = src;
  }

  function initializeImage(document, image, ImageConstructor) {
    if (isExcludedContentImage(image) || image.hasAttribute('data-content-image-initialized')) return;
    const frame = createFrame(document, image);
    if (!frame) return;

    const onLoad = () => setFrameState(frame, hasUsableImage(image) ? 'loaded' : 'error');
    const onError = () => setFrameState(frame, 'error');
    const onRetry = event => {
      if (event.target.closest('[data-content-image-retry]')) {
        retryImage(image, frame, ImageConstructor);
      }
    };
    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    frame.addEventListener('click', onRetry);
    if (image.complete) onLoad();
  }

  function bbHolderFor(image) {
    return image.closest(BB_HOLDER_SELECTOR);
  }

  function syncBbHolder(document, holder) {
    const image = holder?.querySelector(BB_IMAGE_SELECTOR);
    if (!image) return;

    const failed = holder.getAttribute('data-bb-loaded') === 'error';
    let card = holder.querySelector('[data-content-image-error]');
    if (failed && !card) {
      const isButton = holder.tagName === 'BUTTON';
      card = createErrorCard(document, image, !isButton);
      holder.append(card);
      if (isButton) {
        holder.setAttribute('data-image-original-label', holder.getAttribute('aria-label') || '');
        holder.setAttribute('aria-label', `重新加载图片：${errorMessageFor(image)}`);
      }
    } else if (!failed && card) {
      card.remove();
      if (holder.hasAttribute('data-image-original-label')) {
        holder.setAttribute('aria-label', holder.getAttribute('data-image-original-label'));
        holder.removeAttribute('data-image-original-label');
      }
    }
  }

  function retryBbImage(image, holder, ImageConstructor) {
    if (!image || holder.getAttribute('data-bb-loaded') === 'retrying') return;
    const src = image.getAttribute('data-bb-image-url');
    if (!src) return;

    holder.setAttribute('data-bb-loaded', 'retrying');
    const preload = new ImageConstructor();
    preload.decoding = 'async';
    preload.onload = () => {
      const onLoad = () => holder.setAttribute('data-bb-loaded', 'true');
      const onError = () => holder.setAttribute('data-bb-loaded', 'error');
      image.addEventListener('load', onLoad, { once: true });
      image.addEventListener('error', onError, { once: true });
      image.src = src;
      if (hasUsableImage(image)) {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        holder.setAttribute('data-bb-loaded', 'true');
      }
    };
    preload.onerror = () => holder.setAttribute('data-bb-loaded', 'error');
    preload.src = src;
  }

  function initContentImageStates(document, constructors) {
    const ImageConstructor = constructors.Image;
    const initializeScope = scope => {
      if (scope.matches?.(CONTENT_IMAGE_SELECTOR)) {
        initializeImage(document, scope, ImageConstructor);
      }
      scope.querySelectorAll?.(CONTENT_IMAGE_SELECTOR).forEach(image => {
        initializeImage(document, image, ImageConstructor);
      });
      scope.querySelectorAll?.(BB_IMAGE_SELECTOR).forEach(image => {
        syncBbHolder(document, bbHolderFor(image));
      });
    };

    initializeScope(document);

    const onClick = event => {
      const holder = event.target.closest?.(BB_FAILED_HOLDER_SELECTOR);
      if (!holder) return;
      const retryControl = event.target.closest?.('[data-content-image-retry]');
      if (holder.tagName !== 'BUTTON' && !retryControl) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      retryBbImage(holder.querySelector(BB_IMAGE_SELECTOR), holder, ImageConstructor);
    };
    document.addEventListener('click', onClick, true);

    const observer = constructors.MutationObserver ? new constructors.MutationObserver(records => {
      records.forEach(record => {
        if (record.type === 'attributes') syncBbHolder(document, record.target);
        record.addedNodes.forEach(node => {
          if (node.nodeType === 1) initializeScope(node);
        });
      });
    }) : null;
    observer?.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-bb-loaded'],
    });

    return () => {
      observer?.disconnect();
      document.removeEventListener('click', onClick, true);
    };
  }

  return {
    CONTENT_IMAGE_SELECTOR,
    isExcludedContentImage,
    initContentImageStates,
    retryImage,
    setFrameState,
    syncBbHolder,
  };
});
