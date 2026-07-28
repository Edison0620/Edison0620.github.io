'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteParticleAccelerator = api;
})(typeof window === 'undefined' ? null : window, function() {
  const DEFAULT_WORKER_URL = '/js/site-particle-worker.js?v=20260727.1';
  const DEFAULT_WEBGL_URL = '/js/site-particle-webgl.js?v=20260727.1';
  const PARTICLE_KEYS = [
    'x', 'y', 'w', 'h',
    'sourceX', 'sourceY',
    'fractureOffsetX', 'fractureOffsetY',
    'fractureDelay', 'fractureDuration',
    'launchVx', 'launchVy',
    'vx', 'vy', 'rot', 'av', 'opacity',
    'age', 't', 'duration', 'phase'
  ];
  const INITIAL_PARTICLE_KEYS = [
    'x', 'y', 'w', 'h', 'rot', 'opacity',
    'page', 'u0', 'v0', 'u1', 'v1'
  ];
  const DEFAULT_MAX_ENTRY_TEXTURE_BYTES = 16 * 1024 * 1024;
  const DEFAULT_MAX_HOT_TEXTURE_BYTES = 32 * 1024 * 1024;

  function transferFunction(environment) {
    return environment.transferControlToOffscreen
      || environment.HTMLCanvasElement?.prototype
        ?.transferControlToOffscreen;
  }

  function capabilityReason(environment = {}) {
    if (environment.killSwitch || environment.enabled === false) {
      return 'kill-switch';
    }
    const reducedMotion = typeof environment.reducedMotion === 'object'
      ? environment.reducedMotion?.matches
      : environment.reducedMotion;
    if (reducedMotion) return 'reduced-motion';
    if (typeof environment.Worker !== 'function') return 'worker';
    if (typeof environment.OffscreenCanvas !== 'function') {
      return 'offscreen-canvas';
    }
    if (typeof transferFunction(environment) !== 'function') {
      return 'canvas-transfer';
    }
    if (typeof environment.createImageBitmap !== 'function') {
      return 'image-bitmap';
    }
    if (typeof environment.IntersectionObserver !== 'function') {
      return 'intersection-observer';
    }
    return null;
  }

  function cardCacheKey(options = {}) {
    return JSON.stringify([
      Number(options.width) || 0,
      Number(options.height) || 0,
      Number(options.dpr) || 1,
      Boolean(options.mobile),
      Number(options.cardWidth) || 0,
      Number(options.cardHeight) || 0,
      options.fontVersion ?? 0,
      options.imageVersion ?? 0,
      options.atlasVersion ?? '',
      options.effectsVersion ?? '',
      options.workerVersion ?? '',
      options.webglVersion ?? ''
    ]);
  }

  function closePages(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    try {
      entry.releaseBudget?.();
    } catch {
      // Continue releasing concrete resources if accounting hooks fail.
    }
    if (entry.readyTimer !== null && entry.readyTimer !== undefined) {
      try {
        entry.window?.clearTimeout?.(entry.readyTimer);
      } catch {
        // Resource teardown remains authoritative.
      }
      entry.readyTimer = null;
    }
    try {
      entry.worker?.terminate?.();
    } catch {
      // Continue releasing the detached overlay and atlas ownership.
    }
    entry.worker = null;
    try {
      entry.overlay?.remove?.();
    } catch {
      try {
        entry.overlay?.parentNode?.removeChild?.(entry.overlay);
      } catch {
        // Continue releasing bitmap ownership.
      }
    }
    entry.overlay = null;
    if (!entry.transferred) {
      for (const page of entry.pages || []) {
        try {
          if (page && typeof page.close === 'function') page.close();
        } catch {
          // Continue releasing the remaining owned bitmaps.
        }
      }
    }
  }

  function listen(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(type, listener, options);
    return () => target.removeEventListener?.(type, listener, options);
  }

  function listenMediaQuery(query, listener) {
    if (!query) return () => {};
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      return () => query.removeEventListener?.('change', listener);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(listener);
      return () => query.removeListener?.(listener);
    }
    return () => {};
  }

  function createAccelerator(options = {}) {
    const runtimeWindow = options.window
      || (typeof window === 'undefined' ? globalThis : window);
    const runtimeDocument = options.document
      || runtimeWindow.document
      || (typeof document === 'undefined' ? null : document);
    const atlas = options.atlas || runtimeWindow.SiteParticleAtlas;
    const effects = options.effects || runtimeWindow.SiteParticleEffects;
    const cardSelector = options.cardSelector || '.post-block';
    const requestedEntries = Number.isInteger(options.maxEntries)
      ? Math.max(1, options.maxEntries)
      : 4;
    const maxEntries = Math.min(
      requestedEntries,
      Number.isInteger(options.maxHotEntries)
        ? Math.max(1, options.maxHotEntries)
        : 4
    );
    const readyTimeoutMs = Number.isFinite(options.readyTimeoutMs)
      ? Math.max(1, options.readyTimeoutMs)
      : 3000;
    const maxEntryTextureBytes = Number.isFinite(
      options.maxEntryTextureBytes
    ) ? Math.max(0, options.maxEntryTextureBytes)
      : DEFAULT_MAX_ENTRY_TEXTURE_BYTES;
    const maxHotTextureBytes = Number.isFinite(
      options.maxHotTextureBytes
    ) ? Math.max(0, options.maxHotTextureBytes)
      : DEFAULT_MAX_HOT_TEXTURE_BYTES;
    const geometryTolerance = Number.isFinite(options.geometryTolerance)
      ? Math.max(0, options.geometryTolerance)
      : 1;
    const workerUrl = options.workerUrl || DEFAULT_WORKER_URL;
    const webglUrl = options.webglUrl || DEFAULT_WEBGL_URL;
    const prefetch = options.prefetch || (url => {
      const link = runtimeDocument.createElement('link');
      link.rel = 'prefetch';
      link.as = 'script';
      link.href = url;
      (runtimeDocument.head || runtimeDocument.documentElement)
        .appendChild(link);
    });
    const createCanvas = options.createCanvas || ((width, height) => {
      const canvas = runtimeDocument.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });
    const reducedMotion = options.reducedMotionQuery
      || runtimeWindow.matchMedia?.('(prefers-reduced-motion: reduce)')
      || { matches: false };
    const roots = new Set();
    const queue = [];
    const queued = new Set();
    const deferredRequeue = new Set();
    const cache = new WeakMap();
    const cacheOrder = new Map();
    const preparing = new Map();
    const taken = new Set();
    const active = new Set();
    const removers = [];
    let observer = null;
    let scheduled = null;
    let preparationActive = false;
    let generation = 0;
    let fontVersion = options.fontVersion ?? 0;
    let imageVersion = options.imageVersion ?? 0;
    let loaded = runtimeDocument?.readyState === 'complete';
    let pjaxPending = false;
    let disabled = false;
    let disabledReason = null;
    let destroyed = false;
    let nextAnimationId = 1;
    let assetsWarmed = false;
    let liveEntryCount = 0;
    let liveTextureBytes = 0;
    let reservedTextureBytes = 0;

    const versions = {
      atlasVersion: options.atlasVersion || '20260727.1',
      effectsVersion: options.effectsVersion || '20260727.1',
      workerVersion: options.workerVersion || '20260727.1',
      webglVersion: options.webglVersion || '20260727.1'
    };

    function environment() {
      return {
        Worker: runtimeWindow.Worker,
        OffscreenCanvas: runtimeWindow.OffscreenCanvas,
        HTMLCanvasElement: runtimeWindow.HTMLCanvasElement,
        createImageBitmap: runtimeWindow.createImageBitmap,
        enabled: options.enabled,
        IntersectionObserver: runtimeWindow.IntersectionObserver,
        killSwitch: disabled,
        reducedMotion
      };
    }

    function currentDpr() {
      return Math.min(
        Math.max(Number(runtimeWindow.devicePixelRatio) || 1, 1),
        options.maximumDpr || 2
      );
    }

    function currentMobile(card) {
      if (typeof options.mobile === 'function') {
        return Boolean(options.mobile(card));
      }
      if (options.mobile !== undefined) return Boolean(options.mobile);
      return Number(runtimeWindow.innerWidth) <= 767;
    }

    function geometryFor(card) {
      const source = card?.getBoundingClientRect?.() || {};
      const rect = {
        left: Number(source.left) || 0,
        top: Number(source.top) || 0,
        width: Number(source.width) || 0,
        height: Number(source.height) || 0
      };
      const scrollX = Number(
        runtimeWindow.scrollX ?? runtimeWindow.pageXOffset
      ) || 0;
      const scrollY = Number(
        runtimeWindow.scrollY ?? runtimeWindow.pageYOffset
      ) || 0;
      return {
        documentLeft: rect.left + scrollX,
        documentTop: rect.top + scrollY,
        rect
      };
    }

    function documentOriginMatches(left, right) {
      return Math.abs(left.documentLeft - right.documentLeft)
          <= geometryTolerance
        && Math.abs(left.documentTop - right.documentTop)
          <= geometryTolerance;
    }

    function preparationGeometryMatches(left, right) {
      return documentOriginMatches(left, right)
        && Math.abs(left.rect.left - right.rect.left) <= geometryTolerance
        && Math.abs(left.rect.top - right.rect.top) <= geometryTolerance
        && Math.abs(left.rect.width - right.rect.width) <= geometryTolerance
        && Math.abs(left.rect.height - right.rect.height) <= geometryTolerance;
    }

    function rebaseVisuals(visuals, fromGeometry, toGeometry) {
      const deltaX = toGeometry.rect.left - fromGeometry.rect.left;
      const deltaY = toGeometry.rect.top - fromGeometry.rect.top;
      return visuals.map(visual => ({
        ...visual,
        x: visual.x + deltaX,
        y: visual.y + deltaY
      }));
    }

    function keyFor(card, mobile) {
      const rect = card?.getBoundingClientRect?.() || {};
      return cardCacheKey({
        width: runtimeWindow.innerWidth,
        height: runtimeWindow.innerHeight,
        dpr: currentDpr(),
        mobile,
        cardWidth: rect.width,
        cardHeight: rect.height,
        fontVersion,
        imageVersion,
        ...versions
      });
    }

    function cardsIn(root) {
      if (!root || root.isConnected === false) return [];
      const cards = [];
      try {
        if (root.matches?.(cardSelector)) cards.push(root);
        for (const card of root.querySelectorAll?.(cardSelector) || []) {
          if (!cards.includes(card)) cards.push(card);
        }
      } catch {
        return [];
      }
      return cards;
    }

    function isCurrentNearCard(card) {
      if (!card || card.isConnected === false
        || !loaded || pjaxPending || destroyed || disabled
        || capabilityReason(environment())) return false;
      let belongsToRoot = false;
      for (const root of roots) {
        if (cardsIn(root).includes(card)) {
          belongsToRoot = true;
          break;
        }
      }
      if (!belongsToRoot) return false;
      const rect = geometryFor(card).rect;
      return rect.width > 0 && rect.height > 0
        && rect.left + rect.width >= -300
        && rect.top + rect.height >= -300
        && rect.left <= Number(runtimeWindow.innerWidth) + 300
        && rect.top <= Number(runtimeWindow.innerHeight) + 300;
    }

    function cancelScheduled() {
      if (!scheduled) return;
      const record = scheduled;
      scheduled = null;
      try {
        if (record.kind === 'idle') {
          runtimeWindow.cancelIdleCallback?.(record.id);
        } else {
          runtimeWindow.clearTimeout?.(record.id);
        }
      } catch {
        // Revocation below must continue if scheduler cancellation fails.
      }
    }

    function disconnectObserver() {
      const ownedObserver = observer;
      observer = null;
      if (!ownedObserver) return;
      try {
        ownedObserver.disconnect?.();
      } catch {
        // State is already detached; continue releasing other resources.
      }
    }

    function schedulePreparation() {
      if (scheduled || preparationActive
        || destroyed || disabled || !queue.length) return;
      const run = () => {
        scheduled = null;
        let card = null;
        while (queue.length && !card) {
          const candidate = queue.shift();
          if (!queued.delete(candidate)) continue;
          card = candidate;
        }
        if (card) {
          preparationActive = true;
          try {
            observer?.unobserve?.(card);
          } catch {
            // Preparation remains valid if unobserving the card fails.
          }
          void prepareCard(card).finally(() => {
            preparationActive = false;
            if (queue.length) schedulePreparation();
          });
        } else if (queue.length) {
          schedulePreparation();
        }
      };
      if (typeof runtimeWindow.requestIdleCallback === 'function') {
        scheduled = {
          kind: 'idle',
          id: runtimeWindow.requestIdleCallback(run, { timeout: 1000 })
        };
      } else {
        scheduled = {
          kind: 'timer',
          id: runtimeWindow.setTimeout(run, 32)
        };
      }
    }

    function enqueue(card) {
      if (destroyed || disabled) return;
      if (preparing.has(card)) {
        deferredRequeue.add(card);
        return;
      }
      if (queued.has(card) || cache.has(card)) return;
      queued.add(card);
      queue.push(card);
      schedulePreparation();
    }

    function warmAssets() {
      if (assetsWarmed) return;
      assetsWarmed = true;
      for (const url of [workerUrl, webglUrl]) {
        if (!sameOriginStaticUrl(url)) continue;
        try {
          prefetch(url);
        } catch {
          // Asset warming is optional and must never block Canvas fallback.
        }
      }
    }

    function onIntersection(entries) {
      for (const entry of entries || []) {
        if (entry?.isIntersecting || entry?.intersectionRatio > 0) {
          warmAssets();
          enqueue(entry.target);
        }
      }
    }

    function scanRoots() {
      if (!observer) return;
      for (const root of roots) {
        for (const card of cardsIn(root)) {
          try {
            observer.observe(card);
          } catch {
            // A failed card observation must not block the remaining root.
          }
        }
      }
    }

    function ensureObserver() {
      if (!loaded || pjaxPending || destroyed || disabled || observer) return;
      if (capabilityReason(environment())) return;
      let createdObserver = null;
      try {
        createdObserver = new runtimeWindow.IntersectionObserver(entries => {
          if (observer !== createdObserver) return;
          onIntersection(entries);
        }, {
          rootMargin: '300px'
        });
      } catch {
        return;
      }
      observer = createdObserver;
      scanRoots();
    }

    function rescan() {
      if (!loaded || pjaxPending || destroyed || disabled) return;
      ensureObserver();
      scanRoots();
    }

    function closeCache() {
      for (const [card, entry] of cacheOrder) {
        cache.delete(card);
        closePages(entry);
      }
      cacheOrder.clear();
    }

    function textureBytesFor(pages) {
      return (pages || []).reduce((total, page) => (
        total + Math.max(0, Number(page?.width) || 0)
          * Math.max(0, Number(page?.height) || 0) * 4
      ), 0);
    }

    function ownEntry(entry) {
      if (entry.budgetOwned) return;
      entry.budgetOwned = true;
      liveEntryCount++;
      liveTextureBytes += entry.textureBytes;
      entry.releaseBudget = () => {
        if (!entry.budgetOwned) return;
        entry.budgetOwned = false;
        liveEntryCount = Math.max(0, liveEntryCount - 1);
        liveTextureBytes = Math.max(
          0, liveTextureBytes - entry.textureBytes
        );
      };
    }

    function evictOldestCached(excludedCard = null) {
      for (const [card, entry] of cacheOrder) {
        if (card === excludedCard) continue;
        cache.delete(card);
        cacheOrder.delete(card);
        closePages(entry);
        return true;
      }
      return false;
    }

    function reserveTexture(bytes) {
      while (liveTextureBytes + reservedTextureBytes + bytes
        > maxHotTextureBytes) {
        if (!evictOldestCached()) return false;
      }
      reservedTextureBytes += bytes;
      return true;
    }

    function releaseTextureReservation(bytes) {
      reservedTextureBytes = Math.max(0, reservedTextureBytes - bytes);
    }

    function makeRoomForEntry(card, textureBytes) {
      const replaced = cache.get(card);
      if (replaced) {
        cache.delete(card);
        cacheOrder.delete(card);
        closePages(replaced);
      }
      while (liveEntryCount >= maxEntries
        || liveTextureBytes + textureBytes > maxHotTextureBytes) {
        if (!evictOldestCached(card)) return false;
      }
      return true;
    }

    function insertCache(card, entry) {
      const replaced = cache.get(card);
      if (replaced) closePages(replaced);
      cache.delete(card);
      cacheOrder.delete(card);
      cache.set(card, entry);
      cacheOrder.set(card, entry);
      while (cacheOrder.size > maxEntries) {
        const oldest = cacheOrder.entries().next().value;
        if (!oldest) break;
        cache.delete(oldest[0]);
        cacheOrder.delete(oldest[0]);
        closePages(oldest[1]);
      }
    }

    function sourceIsCrossOrigin(source) {
      if (!source || !runtimeWindow.location) return false;
      try {
        const url = new URL(source, runtimeWindow.location.href);
        if (url.protocol === 'data:' || url.protocol === 'blob:') return false;
        return Boolean(
          runtimeWindow.location.origin
          && url.origin !== runtimeWindow.location.origin
        );
      } catch {
        return true;
      }
    }

    function hasCrossOriginImage(visuals) {
      return visuals.some(visual => {
        if (visual?.kind !== 'image' || !visual.image) return false;
        return sourceIsCrossOrigin(
          visual.image.currentSrc || visual.image.src
        );
      });
    }

    async function imagesAreReady(card, preparedGeneration) {
      const images = [...(card?.querySelectorAll?.('img') || [])];
      const batchSize = Math.max(
        1,
        Math.floor(options.extractionBatchSize || 50)
      );
      for (let index = 0; index < images.length; index += 1) {
        if (index > 0 && index % batchSize === 0) {
          await yieldPreparationControl(preparedGeneration);
        }
        const image = images[index];
        const source = image.currentSrc || image.src;
        if (sourceIsCrossOrigin(source) || image.complete === false) return false;
        if (typeof image.decode === 'function') {
          try {
            await image.decode();
          } catch {
            return false;
          }
        }
      }
      return true;
    }

    function drawVisualAtPlacement(dpr, context, visual, placement) {
      context.save?.();
      try {
        context.translate?.(placement.x, placement.y);
        context.scale?.(dpr, dpr);
        effects.drawCardVisual(context, {
          ...visual,
          x: 0,
          y: 0,
          rot: 0,
          opacity: 1
        });
      } finally {
        context.restore?.();
      }
    }

    async function buildPrimeSnapshot(
      visuals, geometry, dpr, preparedGeneration
    ) {
      const width = Math.max(1, Math.ceil(geometry.rect.width * dpr));
      const height = Math.max(1, Math.ceil(geometry.rect.height * dpr));
      if (width > 4096 || height > 4096) return null;
      const canvas = createCanvas(width, height);
      const context = canvas.getContext?.('2d');
      if (!context) return null;
      context.save?.();
      try {
        context.scale?.(dpr, dpr);
        context.translate?.(-geometry.rect.left, -geometry.rect.top);
        const batchSize = Number(options.primeSnapshotBatchSize ?? 100);
        for (let index = 0; index < visuals.length; index += 1) {
          if (Number.isFinite(batchSize) && batchSize > 0
            && index > 0 && index % batchSize === 0) {
            await yieldPreparationControl(preparedGeneration);
          }
          effects.drawCardVisual(context, {
            ...visuals[index],
            rot: 0,
            opacity: 1
          });
        }
      } finally {
        context.restore?.();
      }
      const page = await runtimeWindow.createImageBitmap(canvas);
      return {
        page,
        particle: {
          x: geometry.rect.left,
          y: geometry.rect.top,
          w: geometry.rect.width,
          h: geometry.rect.height,
          rot: 0,
          opacity: 1,
          page: -1,
          u0: 0,
          v0: 0,
          u1: 1,
          v1: 1
        }
      };
    }

    function yieldPreparationControl(preparedGeneration) {
      return new Promise((resolve, reject) => {
        const resume = () => {
          if (destroyed || disabled || generation !== preparedGeneration) {
            reject(new Error('Particle preparation was revoked'));
          } else {
            resolve();
          }
        };
        if (typeof runtimeWindow.requestIdleCallback === 'function') {
          runtimeWindow.requestIdleCallback(resume, { timeout: 1000 });
        } else {
          runtimeWindow.setTimeout(resume, 32);
        }
      });
    }

    async function yieldCardPreparationControl(
      card, preparedGeneration, geometry
    ) {
      await yieldPreparationControl(preparedGeneration);
      if (!preparationGeometryMatches(geometry, geometryFor(card))) {
        deferredRequeue.add(card);
        throw new Error('Particle preparation geometry changed');
      }
    }

    async function buildEntry(card, preparedGeneration) {
      if (!atlas || typeof atlas.buildVisualAtlas !== 'function'
        || !effects || typeof effects.extractCardVisualsAsync !== 'function'
        || typeof effects.drawCardVisual !== 'function') return null;
      if (!(await imagesAreReady(card, preparedGeneration))) return null;
      if (destroyed || disabled || generation !== preparedGeneration) return null;
      const mobile = currentMobile(card);
      const cap = mobile
        ? effects.CONSTANTS?.mobileParticleCap || 320
        : effects.CONSTANTS?.desktopParticleCap || 1200;
      const key = keyFor(card, mobile);
      const geometry = geometryFor(card);
      const visuals = await effects.extractCardVisualsAsync(card, cap, {
        batchSize: options.extractionBatchSize || 50,
        mobile,
        yieldControl: () => yieldCardPreparationControl(
          card, preparedGeneration, geometry
        )
      });
      if (destroyed || disabled || generation !== preparedGeneration) return null;
      if (!preparationGeometryMatches(geometry, geometryFor(card))) {
        deferredRequeue.add(card);
        return null;
      }
      if (!Array.isArray(visuals) || !visuals.length
        || hasCrossOriginImage(visuals)) return null;
      const dpr = currentDpr();
      const conservativeReservation = maxEntryTextureBytes;
      if (!reserveTexture(conservativeReservation)) return null;
      let built;
      try {
        built = await atlas.buildVisualAtlas(visuals, {
          ...(options.atlasOptions || {}),
          batchSize: options.atlasBatchSize
            || options.atlasOptions?.batchSize
            || 100,
          dpr,
          createCanvas,
          createImageBitmap: runtimeWindow.createImageBitmap.bind(runtimeWindow),
          drawVisual: (context, visual, placement) => {
            drawVisualAtPlacement(dpr, context, visual, placement);
          },
          yieldControl: () => yieldPreparationControl(preparedGeneration)
        });
      } finally {
        releaseTextureReservation(conservativeReservation);
      }
      const entry = {
        card,
        closed: false,
        entries: built.entries,
        geometry,
        key,
        mobile,
        pages: built.pages,
        transferred: false,
        visuals
      };
      try {
        const prime = await buildPrimeSnapshot(
          visuals, geometry, dpr, preparedGeneration
        );
        if (prime) {
          prime.particle.page = entry.pages.length;
          entry.pages.push(prime.page);
          entry.initialParticles = [prime.particle];
        }
        entry.textureBytes = textureBytesFor(entry.pages);
        if (entry.textureBytes > maxEntryTextureBytes
          || !makeRoomForEntry(card, entry.textureBytes)) {
          closePages(entry);
          return null;
        }
        ownEntry(entry);
        await warmEntry(entry);
      } catch {
        closePages(entry);
        return null;
      }
      if (destroyed || disabled || generation !== preparedGeneration
        || keyFor(card, mobile) !== key) {
        closePages(entry);
        return null;
      }
      insertCache(card, entry);
      return entry;
    }

    function warmEntry(entry) {
      if (!sameOriginStaticUrl(workerUrl)) {
        return Promise.reject(new Error('Particle Worker URL is not same-origin'));
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        let worker = null;
        let overlay = null;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          if (entry.readyTimer !== null) {
            runtimeWindow.clearTimeout(entry.readyTimer);
            entry.readyTimer = null;
          }
          callback(value);
        };
        const fail = error => {
          const failure = error instanceof Error
            ? error
            : new Error(String(error));
          if (settled) {
            if (entry.ready && !entry.closed) {
              cache.delete(entry.card);
              cacheOrder.delete(entry.card);
              closePages(entry);
              disableLifecycle(failure, null);
            }
            return;
          }
          finish(reject, failure);
        };
        try {
          overlay = runtimeDocument.createElement('canvas');
          overlay.setAttribute('data-site-effects-webgl-layer', '');
          overlay.setAttribute('aria-hidden', 'true');
          overlay.style.cssText = [
            'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
            'pointer-events:none', 'z-index:9997', 'display:none'
          ].join(';');
          entry.overlay = overlay;
          entry.window = runtimeWindow;
          const offscreen = overlay.transferControlToOffscreen();
          worker = new runtimeWindow.Worker(workerUrl);
          entry.worker = worker;
          worker.onmessage = event => {
            const message = event?.data || {};
            if (message.type === 'ready') {
              entry.renderer = message.renderer || 'unknown';
              entry.workerRaf = Boolean(message.workerRaf);
              entry.ready = true;
              finish(resolve, entry);
            } else if (message.type === 'error' && message.id === null) {
              fail(new Error(message.message || 'Particle Worker failed to warm'));
            }
          };
          worker.onerror = event => {
            event?.preventDefault?.();
            fail(event?.error || new Error(
              event?.message || 'Particle Worker failed to warm'
            ));
          };
          worker.onmessageerror = worker.onerror;
          entry.readyTimer = runtimeWindow.setTimeout(() => {
            fail(new Error(
              `Particle Worker warmup exceeded ${readyTimeoutMs}ms`
            ));
          }, readyTimeoutMs);
          worker.postMessage({
            type: 'init',
            canvas: offscreen,
            viewport: {
              width: runtimeWindow.innerWidth,
              height: runtimeWindow.innerHeight,
              dpr: currentDpr()
            },
            pages: entry.pages,
            initialParticles: entry.initialParticles
              || serializeInitialParticles(entry.visuals, entry.entries)
          }, [offscreen, ...entry.pages]);
          entry.transferred = true;
        } catch (error) {
          fail(error);
        }
      });
    }

    function prepareCard(card) {
      if (preparing.has(card)) return preparing.get(card);
      const preparedGeneration = generation;
      const promise = Promise.resolve()
        .then(() => {
          if (!loaded || destroyed || disabled
            || capabilityReason(environment())) return null;
          return buildEntry(card, preparedGeneration);
        })
        .catch(() => null)
        .finally(() => {
          if (preparing.get(card) === promise) preparing.delete(card);
          if (deferredRequeue.delete(card) && isCurrentNearCard(card)) {
            enqueue(card);
          }
        });
      preparing.set(card, promise);
      return promise;
    }

    function serializeParticles(particles, entries) {
      if (!Array.isArray(particles) || particles.length !== entries.length) {
        throw new Error('Particle list does not match the prepared atlas');
      }
      return particles.map((particle, index) => {
        const serialized = {};
        for (const key of PARTICLE_KEYS) serialized[key] = particle[key];
        return { ...serialized, ...entries[index] };
      });
    }

    function serializeInitialParticles(visuals, entries) {
      if (!Array.isArray(visuals) || visuals.length !== entries.length) {
        throw new Error('Initial particle list does not match the prepared atlas');
      }
      return visuals.map((visual, index) => {
        const source = {
          ...visual,
          ...entries[index],
          rot: 0,
          opacity: 1
        };
        const serialized = {};
        for (const key of INITIAL_PARTICLE_KEYS) serialized[key] = source[key];
        return serialized;
      });
    }

    function sameOriginStaticUrl(candidate) {
      if (!runtimeWindow.location) return true;
      try {
        const url = new URL(candidate, runtimeWindow.location.href);
        return (url.protocol === 'http:' || url.protocol === 'https:')
          && (!runtimeWindow.location.origin
            || url.origin === runtimeWindow.location.origin);
      } catch {
        return false;
      }
    }

    function callHandler(handlers, name, value) {
      const handler = handlers?.[name] || handlers?.[`on${
        name[0].toUpperCase()}${name.slice(1)}`];
      if (typeof handler !== 'function') return;
      try {
        handler(value);
      } catch {
        // Coordinator callback errors must not escape Worker event delivery.
      }
    }

    function benchmarkMark(name) {
      try {
        runtimeWindow.__particleBenchmarkMark?.(name);
      } catch {
        // Test-only timing hooks must never affect production animation.
      }
    }

    function disableLifecycle(reason, failingRun) {
      if (disabled || destroyed) return;
      disabled = true;
      disabledReason = reason;
      generation++;
      cancelScheduled();
      queued.clear();
      queue.length = 0;
      deferredRequeue.clear();
      disconnectObserver();
      closeCache();
      for (const token of [...taken]) {
        try {
          token.revoke();
        } catch {
          // Continue revoking the remaining ownership tokens.
        }
      }
      for (const run of [...active]) {
        if (run === failingRun) continue;
        try {
          run.abort(reason);
        } catch {
          // Continue aborting the remaining active runs.
        }
      }
    }

    function createRejectedRun(error, handlers, entry, disableOnFailure) {
      closePages(entry);
      callHandler(handlers, 'restore');
      callHandler(handlers, 'error', error);
      if (disableOnFailure) disableLifecycle(error, null);
      const completion = Promise.reject(error);
      return {
        completion,
        cancel() {}
      };
    }

    function startEntry(token, particlesOrFactory, handlers = {}) {
      if (token.revoked || token.generation !== generation) {
        return createRejectedRun(
          new Error('Prepared particle entry was revoked'),
          handlers,
          token.entry,
          false
        );
      }
      if (token.started) {
        return createRejectedRun(
          new Error('Prepared particle entry was already consumed'),
          handlers,
          null,
          false
        );
      }
      token.started = true;
      taken.delete(token);
      if (!loaded || destroyed || disabled
        || capabilityReason(environment())
        || token.entry.key !== keyFor(token.card, token.mobile)
        || !sameOriginStaticUrl(workerUrl)
        || !token.entry.ready
        || !token.entry.worker
        || !token.entry.overlay) {
        return createRejectedRun(
          new Error('Prepared particle entry is no longer eligible'),
          handlers,
          token.entry,
          false
        );
      }
      let workerParticles = null;
      if (typeof particlesOrFactory !== 'function') {
        try {
          workerParticles = serializeParticles(
            particlesOrFactory,
            token.entry.entries
          );
        } catch (error) {
          return createRejectedRun(error, handlers, token.entry, false);
        }
      }
      let worker = token.entry.worker;
      let overlay = token.entry.overlay;
      let transferred = token.entry.transferred;
      let startPosted = false;
      let physicsStarted = false;
      let physicsFrame = null;
      let physicsTimer = null;
      let settled = false;
      let cleaned = false;
      let readySeen = true;
      let resolveCompletion;
      let rejectCompletion;
      const id = nextAnimationId++;
      const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });

      function cleanup(sendCancel) {
        if (cleaned) return;
        cleaned = true;
        if (physicsFrame !== null) {
          try {
            runtimeWindow.cancelAnimationFrame?.(physicsFrame);
          } catch {
            // Continue with authoritative Worker cleanup.
          }
          physicsFrame = null;
        }
        if (physicsTimer !== null) {
          try {
            runtimeWindow.clearTimeout?.(physicsTimer);
          } catch {
            // Continue with authoritative Worker cleanup.
          }
          physicsTimer = null;
        }
        if (sendCancel && worker && startPosted) {
          try {
            worker.postMessage({ type: 'cancel', id });
          } catch {
            // Termination below remains the final cleanup boundary.
          }
        }
        try {
          overlay?.removeEventListener?.('webglcontextlost', onContextLost);
        } catch {
          // Continue releasing the Worker after a DOM cleanup failure.
        }
        const overlayParent = overlay?.parentNode;
        try {
          overlay?.remove?.();
        } catch {
          try {
            overlayParent?.removeChild?.(overlay);
          } catch {
            // Continue Worker cleanup even if both DOM removal APIs fail.
          }
        }
        if (worker) {
          try {
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
          } catch {
            // Termination remains mandatory if listener detachment fails.
          }
          try {
            worker.terminate();
          } catch {
            // Continue settling the coordinator even if termination throws.
          }
        }
        try {
          token.entry.releaseBudget?.();
        } catch {
          // Resource teardown remains authoritative if accounting fails.
        }
        if (!transferred) closePages(token.entry);
        token.entry.closed = true;
        token.entry.worker = null;
        token.entry.overlay = null;
        active.delete(run);
      }

      function restore() {
        callHandler(handlers, 'restore');
      }

      function fail(error, runtimeFailure = true) {
        if (settled) return;
        settled = true;
        cleanup(false);
        restore();
        callHandler(handlers, 'error', error);
        rejectCompletion(error);
        if (runtimeFailure) disableLifecycle(error, run);
      }

      function cancel() {
        if (settled) return;
        settled = true;
        const error = new Error('Particle animation was cancelled');
        cleanup(true);
        restore();
        callHandler(handlers, 'cancel', error);
        rejectCompletion(error);
      }

      function complete() {
        if (settled) return;
        settled = true;
        cleanup(true);
        callHandler(handlers, 'complete');
        resolveCompletion();
      }

      function onContextLost(event) {
        event?.preventDefault?.();
        fail(new Error('WebGL context is lost'));
      }

      function startPhysics() {
        if (settled || physicsStarted) return;
        physicsStarted = true;
        try {
          if (workerParticles === null) {
            benchmarkMark('particle-map-start');
            const particles = particlesOrFactory();
            benchmarkMark('particle-map-end');
            benchmarkMark('serialization-start');
            workerParticles = serializeParticles(
              particles,
              token.entry.entries
            );
            benchmarkMark('serialization-end');
          }
          worker.postMessage({
            type: 'start',
            id,
            particles: workerParticles
          });
          benchmarkMark('start-post');
          startPosted = true;
        } catch (error) {
          fail(error);
        }
      }

      function schedulePhysicsAfterComposite() {
        if (settled || physicsStarted
          || physicsFrame !== null || physicsTimer !== null) return;
        if (typeof runtimeWindow.requestAnimationFrame !== 'function') {
          startPhysics();
          return;
        }
        try {
          physicsFrame = runtimeWindow.requestAnimationFrame(() => {
            physicsFrame = null;
            if (settled) return;
            physicsTimer = runtimeWindow.setTimeout(() => {
              physicsTimer = null;
              startPhysics();
            }, 0);
          });
        } catch (error) {
          fail(error);
        }
      }

      function onWorkerMessage(event) {
        if (settled || !event?.data) return;
        const message = event.data;
        if (message.type === 'ready') {
          if (readySeen) return;
          readySeen = true;
          callHandler(handlers, 'ready');
          return;
        }
        if (message.type === 'error'
          && (message.id === null || message.id === id)) {
          fail(new Error(message.message || 'Particle Worker failed'));
          return;
        }
        if (message.id !== id) return;
        if (message.type === 'frame') {
          callHandler(handlers, 'frame');
          if (message.prime) schedulePhysicsAfterComposite();
        } else if (message.type === 'complete') {
          complete();
        }
      }

      function onWorkerError(event) {
        event?.preventDefault?.();
        fail(event?.error || new Error(event?.message || 'Particle Worker failed'));
      }

      const run = {
        abort: cancel,
        cancel,
        completion,
        id
      };
      active.add(run);

      try {
        benchmarkMark('overlay-attach-start');
        overlay.style.display = 'block';
        overlay.addEventListener?.('webglcontextlost', onContextLost);
        runtimeDocument.documentElement.appendChild(overlay);
        benchmarkMark('overlay-attach-end');
        worker.onmessage = onWorkerMessage;
        worker.onerror = onWorkerError;
        worker.onmessageerror = onWorkerError;
        worker.postMessage({
          type: 'prime',
          id,
          offsetX: token.offsetX,
          offsetY: token.offsetY
        });
        benchmarkMark('prime-post');
      } catch (error) {
        fail(error);
      }
      return run;
    }

    function revokeResources(reason, shouldRescan) {
      if (destroyed || disabled) return;
      if (reason === 'font') fontVersion++;
      if (reason === 'image') imageVersion++;
      generation++;
      cancelScheduled();
      queued.clear();
      queue.length = 0;
      closeCache();
      for (const token of [...taken]) {
        try {
          token.revoke();
        } catch {
          // Continue revoking remaining ownership.
        }
      }
      for (const run of [...active]) {
        try {
          run.abort(new Error(`Particle cache invalidated: ${reason}`));
        } catch {
          // Continue aborting remaining active runs.
        }
      }
      disconnectObserver();
      if (shouldRescan) rescan();
    }

    function invalidate(reason = 'manual') {
      revokeResources(reason, true);
    }

    function onLoad() {
      if (destroyed || loaded) return;
      loaded = true;
      ensureObserver();
    }

    function onResize() {
      invalidate('resize');
    }

    function onPjaxSend() {
      pjaxPending = true;
      revokeResources('pjax', false);
    }

    function onPjaxComplete() {
      pjaxPending = false;
      revokeResources('pjax', true);
    }

    function onImageEvent(event) {
      if (String(event?.target?.tagName || '').toUpperCase() === 'IMG') {
        invalidate('image');
      }
    }

    function onFontChange() {
      invalidate('font');
    }

    function onReducedMotionChange(event) {
      if (event?.matches ?? reducedMotion.matches) {
        invalidate('reduced-motion');
      } else {
        rescan();
      }
    }

    function onVisibilityChange() {
      if (runtimeDocument?.hidden) {
        revokeResources('visibility', false);
      } else {
        rescan();
      }
    }

    removers.push(
      listen(runtimeWindow, 'load', onLoad),
      listen(runtimeWindow, 'resize', onResize),
      listen(runtimeDocument, 'pjax:send', onPjaxSend),
      listen(runtimeDocument, 'pjax:success', onPjaxComplete),
      listen(runtimeDocument, 'pjax:error', onPjaxComplete),
      listen(runtimeDocument, 'visibilitychange', onVisibilityChange),
      listen(runtimeDocument, 'load', onImageEvent, true),
      listen(runtimeDocument, 'error', onImageEvent, true),
      listen(runtimeDocument?.fonts, 'loadingdone', onFontChange),
      listenMediaQuery(reducedMotion, onReducedMotionChange)
    );

    if (runtimeDocument?.fonts
      && runtimeDocument.fonts.status !== 'loaded'
      && runtimeDocument.fonts.ready?.then) {
      runtimeDocument.fonts.ready.then(() => {
        if (!destroyed) onFontChange();
      }, () => {});
    }

    return {
      capabilityReason: () => capabilityReason(environment()),
      cardCacheKey,
      observe(root) {
        if (destroyed || !root) return;
        const replacingRoot = roots.size > 0 && !roots.has(root);
        if (replacingRoot) revokeResources('root-replacement', false);
        roots.clear();
        roots.add(root);
        ensureObserver();
        scanRoots();
      },
      whenPrepared(card) {
        if (cache.has(card)) return Promise.resolve(cache.get(card));
        if (preparing.has(card)) return preparing.get(card);
        return Promise.resolve(null);
      },
      take(card, mobile = currentMobile(card)) {
        if (!loaded || destroyed || disabled
          || capabilityReason(environment())) return null;
        const entry = cache.get(card);
        if (!entry) return null;
        cache.delete(card);
        cacheOrder.delete(card);
        const currentGeometry = geometryFor(card);
        if (entry.mobile !== Boolean(mobile)
          || entry.key !== keyFor(card, Boolean(mobile))
          || !documentOriginMatches(entry.geometry, currentGeometry)) {
          closePages(entry);
          enqueue(card);
          return null;
        }
        const token = {
          card,
          entry,
          generation,
          mobile: Boolean(mobile),
          offsetX: currentGeometry.rect.left - entry.geometry.rect.left,
          offsetY: currentGeometry.rect.top - entry.geometry.rect.top,
          revoked: false,
          started: false,
          revoke() {
            if (this.started || this.revoked) return;
            this.revoked = true;
            taken.delete(this);
            closePages(this.entry);
          },
          dispose() {
            this.revoke();
          }
        };
        taken.add(token);
        return {
          visuals: rebaseVisuals(
            entry.visuals, entry.geometry, currentGeometry
          ),
          start(particles, handlers) {
            return startEntry(token, particles, handlers);
          },
          dispose() {
            token.dispose();
          }
        };
      },
      invalidate,
      disable(reason = new Error('Particle acceleration disabled')) {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        disableLifecycle(error, null);
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        generation++;
        cancelScheduled();
        queued.clear();
        queue.length = 0;
        deferredRequeue.clear();
        disconnectObserver();
        closeCache();
        for (const token of [...taken]) {
          try {
            token.revoke();
          } catch {
            // Continue destroying remaining resources.
          }
        }
        for (const run of [...active]) {
          try {
            run.abort(new Error('Particle accelerator was destroyed'));
          } catch {
            // Continue destroying remaining resources.
          }
        }
        for (const remove of removers.splice(0)) {
          try {
            remove();
          } catch {
            // Continue removing the remaining lifecycle listeners.
          }
        }
        roots.clear();
      },
      get disabled() {
        return disabled;
      },
      get disabledReason() {
        return disabledReason;
      }
    };
  }

  return {
    DEFAULT_WEBGL_URL,
    DEFAULT_WORKER_URL,
    capabilityReason,
    cardCacheKey,
    createAccelerator
  };
});
