'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteParticleEffects = api;
})(typeof window === 'undefined' ? null : window, function() {
  const PARTICLE_EFFECTS_VERSION = '20260727.14';
  const ACCELERATOR_LAZY_DELAY = 1500;
  const ACCELERATOR_SCRIPTS = Object.freeze([
    '/js/site-particle-atlas.js?v=20260727.1',
    '/js/site-particle-accelerator.js?v=20260727.1'
  ]);
  const CONSTANTS = Object.freeze({
    cardForce: 28000,
    codeForce: 15000,
    drag: 0.965,
    gravity: 580,
    desktopParticleCap: 1200,
    mobileParticleCap: 320,
    confettiColors: Object.freeze([
      '#ffa657', '#3fb950', '#58a6ff',
      '#d2a8ff', '#f85149', '#d29922'
    ]),
    konami: Object.freeze([
      'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
      'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'
    ])
  });

  const TEXT_EXCLUSIONS = [
    'script', 'style', 'noscript', 'svg', 'canvas',
    'input', 'textarea', 'select', 'button', '[contenteditable="true"]',
    '[data-site-effects-ignore]', '.search-popup', '.search-pop-overlay',
    '.fancybox__container', '.comments', '.comment-container'
  ].join(', ');
  const FOREGROUND_SUBTREE_EXCLUSIONS = [
    'script', 'style', 'noscript', 'canvas', '[data-site-effects-ignore]',
    '.search-popup', '.search-pop-overlay', '.fancybox__container',
    '.comments', '.comment-container'
  ].join(', ');
  const reportedErrorObjects = new WeakSet();
  const reportedErrorValues = new Set();

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

  function markReportedError(error) {
    if ((typeof error === 'object' && error !== null)
      || typeof error === 'function') {
      reportedErrorObjects.add(error);
    } else {
      reportedErrorValues.add(error);
    }
  }

  function isReportedError(error) {
    return ((typeof error === 'object' && error !== null)
      || typeof error === 'function')
      ? reportedErrorObjects.has(error)
      : reportedErrorValues.has(error);
  }

  class CanvasOverlay {
    constructor() {
      this.element = null;
      this.context = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.raf = null;
    }

    ensure() {
      if (this.element) return;
      this.element = document.createElement('canvas');
      this.element.dataset.siteEffectsLayer = '';
      this.element.setAttribute('aria-hidden', 'true');
      this.element.style.cssText = [
        'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
        'pointer-events:none', 'z-index:9997', 'display:none'
      ].join(';');
      document.documentElement.appendChild(this.element);
      try {
        this.context = this.element.getContext('2d');
        if (!this.context) {
          throw new Error('Canvas 2D context is unavailable');
        }
      } catch (error) {
        this.element.remove();
        this.element = null;
        this.context = null;
        throw error;
      }
      this.resize();
    }

    resize() {
      if (!this.element || !this.context) return;
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.element.width = Math.round(this.width * this.dpr);
      this.element.height = Math.round(this.height * this.dpr);
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    show() {
      this.ensure();
      this.resize();
      this.element.style.display = 'block';
    }

    clear() {
      if (!this.context) return;
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.context.clearRect(0, 0, this.width, this.height);
    }

    hide() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      try {
        this.clear();
      } catch {
        // Hiding the owned layer must remain safe after a canvas failure.
      }
      if (this.element) this.element.style.display = 'none';
    }

    destroy() {
      this.hide();
      this.element?.remove();
      this.element = null;
      this.context = null;
    }
  }

  function clean(value) {
    return Math.round(value * 1e12) / 1e12;
  }

  function inverseSquareLaunch(x, y, originX, originY, options) {
    const rawX = x - originX;
    const rawY = y - originY;
    const distance = Math.max(Math.hypot(rawX, rawY), options.minimumDistance);
    const baseAngle = rawX === 0 && rawY === 0 ? 0 : Math.atan2(rawY, rawX);
    const jitter = (options.random() - 0.5) * options.angularJitter * 2;
    const magnitude = options.force / (distance * distance);
    return {
      vx: clean(Math.cos(baseAngle + jitter) * magnitude),
      vy: clean(
        Math.sin(baseAngle + jitter) * magnitude
        - options.upwardMinimum - options.upwardRange * options.random()
      )
    };
  }

  function stepShrapnel(particle, dt, options) {
    particle.t += dt * 1000;
    particle.vx *= options.drag;
    particle.vy *= options.drag;
    particle.vy += options.gravity * dt;
    particle.x = clean(particle.x + particle.vx * dt);
    particle.y = clean(particle.y + particle.vy * dt);
    particle.vx = clean(particle.vx);
    particle.vy = clean(particle.vy);
    particle.rot = clean(particle.rot + particle.av * dt);
    return particle;
  }

  function createCardParticle(visual, originX, originY, options = {}) {
    const mobile = Boolean(options.mobile);
    const random = options.random || Math.random;
    const centerX = visual.x + visual.w / 2;
    const centerY = visual.y + visual.h / 2;
    const deltaX = centerX - originX;
    const deltaY = centerY - originY;
    const distance = Math.hypot(deltaX, deltaY);
    const direction = distance
      ? Math.atan2(deltaY, deltaX)
      : random() * Math.PI * 2;
    const launch = inverseSquareLaunch(
      centerX,
      centerY,
      originX,
      originY,
      {
        force: CONSTANTS.cardForce,
        minimumDistance: 25,
        angularJitter: 0.35,
        upwardMinimum: 80,
        upwardRange: 120,
        random
      }
    );
    const separation = 1 + random() * 2;
    const maximumDelay = mobile ? 25 : 50;
    const rotationCaps = {
      line: 3,
      fill: 8,
      image: 8,
      glyph: 8,
      text: 12
    };
    const rotationCap = rotationCaps[visual.material] || 8;

    return {
      ...visual,
      sourceX: visual.x,
      sourceY: visual.y,
      x: visual.x,
      y: visual.y,
      fractureOffsetX: clean(Math.cos(direction) * separation),
      fractureOffsetY: clean(Math.sin(direction) * separation),
      fractureDelay: Math.min(distance * (mobile ? 0.08 : 0.12), maximumDelay),
      fractureDuration: mobile ? 40 : 70,
      launchVx: launch.vx,
      launchVy: launch.vy,
      vx: 0,
      vy: 0,
      rot: 0,
      av: (random() - 0.5) * rotationCap * 2,
      opacity: 1,
      age: 0,
      t: 0,
      duration: mobile ? 160 + random() * 60 : 550 + random() * 150,
      phase: 'waiting'
    };
  }

  // Keep formulas in sync with stepWorkerParticle. Guarded by “Worker physics
  // matches Canvas through every card phase for 45 ticks”.
  function stepCardParticle(particle, dt) {
    const previousAge = particle.age;
    particle.age += dt * 1000;
    if (particle.age >= particle.duration) {
      particle.phase = 'complete';
      particle.opacity = 0;
      return particle;
    }

    const fractureStart = particle.fractureDelay;
    const fallStart = fractureStart + particle.fractureDuration;
    if (particle.age < fractureStart) {
      particle.phase = 'waiting';
      particle.x = particle.sourceX;
      particle.y = particle.sourceY;
      particle.opacity = 1;
      particle.rot = 0;
      return particle;
    }
    if (particle.age < fallStart) {
      const progress = Math.max(
        0,
        Math.min((particle.age - fractureStart) / particle.fractureDuration, 1)
      );
      const easing = 1 - Math.pow(1 - progress, 3);
      particle.phase = 'fracturing';
      particle.x = clean(
        particle.sourceX + particle.fractureOffsetX * easing
      );
      particle.y = clean(
        particle.sourceY + particle.fractureOffsetY * easing
      );
      particle.opacity = 1;
      particle.rot = 0;
      return particle;
    }

    let fallDt = dt;
    if (particle.phase !== 'falling') {
      particle.phase = 'falling';
      particle.x = clean(particle.sourceX + particle.fractureOffsetX);
      particle.y = clean(particle.sourceY + particle.fractureOffsetY);
      particle.vx = particle.launchVx;
      particle.vy = particle.launchVy;
      particle.t = 0;
      fallDt = Math.max(0, particle.age - Math.max(previousAge, fallStart))
        / 1000;
    }
    if (fallDt > 0) {
      stepShrapnel(particle, fallDt, {
        drag: CONSTANTS.drag,
        gravity: CONSTANTS.gravity
      });
    }
    const progress = particle.age / particle.duration;
    particle.opacity = progress > 0.5
      ? Math.max(0, 1 - (progress - 0.5) * 2)
      : 1;
    return particle;
  }

  function elasticOut(progress) {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return Math.pow(2, -10 * progress)
      * Math.sin(2 * Math.PI * (progress - 0.075) / 0.8) + 1;
  }

  function sampleEvenly(values, cap) {
    if (values.length <= cap) return values;
    return Array.from({ length: cap }, (_, index) => (
      values[Math.round(index * (values.length - 1) / (cap - 1))]
    ));
  }

  function drainSteps(iterator) {
    let step = iterator.next();
    while (!step.done) step = iterator.next();
    return step.value;
  }

  async function drainStepsAsync(iterator, options = {}) {
    const batchSize = Math.max(1, Math.floor(options.batchSize || 50));
    const yieldControl = typeof options.yieldControl === 'function'
      ? options.yieldControl
      : () => new Promise(resolve => setTimeout(resolve, 0));
    let operationCount = 0;
    let step = iterator.next();
    while (!step.done) {
      operationCount += 1;
      if (operationCount % batchSize === 0) await yieldControl();
      step = iterator.next();
    }
    return step.value;
  }

  function cardFragmentUnit(characters, mobile) {
    const heights = characters
      .map(character => character.h)
      .filter(height => Number.isFinite(height) && height > 0)
      .sort((left, right) => left - right);
    if (!heights.length) return mobile ? 18 : 16;
    const middle = Math.floor(heights.length / 2);
    const median = heights.length % 2
      ? heights[middle]
      : (heights[middle - 1] + heights[middle]) / 2;
    const minimum = mobile ? 14 : 12;
    const maximum = mobile ? 22 : 20;
    return Math.max(minimum, Math.min(maximum, median));
  }

  function cardControlFragmentUnit(textUnit, mobile) {
    const minimum = mobile ? 10 : 8;
    const maximum = mobile ? 16 : 14;
    return Math.max(minimum, Math.min(maximum, clean(textUnit * 0.7)));
  }

  function* fragmentRectangleSteps(rect, unit, cap) {
    if (!(rect.width > 0 && rect.height > 0 && unit > 0 && cap > 0)) return [];
    const columns = Math.max(1, Math.ceil(rect.width / unit));
    const rows = Math.max(1, Math.ceil(rect.height / unit));
    const total = columns * rows;
    const count = Math.min(total, Math.floor(cap));
    const fragments = [];
    for (let selectionIndex = 0; selectionIndex < count; selectionIndex += 1) {
      const index = count === 1
        ? Math.floor(total / 2)
        : Math.round(selectionIndex * (total - 1) / (count - 1));
      const row = Math.floor(index / columns);
      const column = index % columns;
      const left = rect.left + rect.width * column / columns;
      const right = rect.left + rect.width * (column + 1) / columns;
      const top = rect.top + rect.height * row / rows;
      const bottom = rect.top + rect.height * (row + 1) / rows;
      fragments.push({
        left, top, right, bottom,
        width: right - left,
        height: bottom - top,
        row, column, index
      });
      yield;
    }
    return fragments;
  }

  function fragmentRectangles(rect, unit, cap) {
    return drainSteps(fragmentRectangleSteps(rect, unit, cap));
  }

  function tagScatterVector(point, origin, random) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const rawDistance = Math.hypot(dx, dy);
    const distance = Math.max(rawDistance, 20);
    const magnitude = Math.min(800 / distance, 40);
    const outwardAngle = rawDistance < 0.5
      ? random() * Math.PI * 2
      : Math.atan2(dy, dx);
    const angle = outwardAngle + (random() - 0.5) * 0.5;
    return {
      x: Math.cos(angle) * magnitude,
      y: Math.sin(angle) * magnitude,
      rotation: (random() - 0.5) * 15
    };
  }

  function createConfettiParticle(x, y, random) {
    const angle = random() * Math.PI * 2;
    const speed = 200 + random() * 400;
    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 200,
      rot: random() * Math.PI * 2,
      av: (random() - 0.5) * 12,
      size: 3 + random() * 5,
      color: CONSTANTS.confettiColors[
        Math.floor(random() * CONSTANTS.confettiColors.length)
      ],
      shape: random() > 0.5 ? 'rect' : 'circle',
      life: 1500 + random() * 800,
      t: 0,
      alive: true
    };
  }

  function stepConfettiParticle(particle, dt) {
    particle.t += dt * 1000;
    particle.alive = particle.t < particle.life;
    if (!particle.alive) return particle;
    particle.vy += 400 * dt;
    particle.vx *= 0.98;
    particle.vy *= 0.98;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.rot += particle.av * dt;
    return particle;
  }

  function advanceKonami(state, key) {
    const next = [...state, key].slice(-CONSTANTS.konami.length);
    const matched = next.length === CONSTANTS.konami.length
      && next.every((value, index) => value === CONSTANTS.konami[index]);
    return { state: matched ? [] : next, matched };
  }

  function isEligibleLinkClick(event) {
    return (event.button === undefined || event.button === 0)
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function isDoubleTap(previous, current, activatedAt) {
    return {
      doubleTap: previous > 0 && current - previous < 350,
      mayDeactivate: current - activatedAt > 500
    };
  }

  function* fallbackSegments(text) {
    let segment = '';
    let segmentIndex = 0;
    let index = 0;
    for (const character of text) {
      const joinsPrevious = segment && (
        /\p{Mark}/u.test(character)
        || /[\uFE00-\uFE0F]/u.test(character)
        || /[\u{1F3FB}-\u{1F3FF}]/u.test(character)
        || character === '\u200D'
        || segment.endsWith('\u200D')
      );
      if (joinsPrevious) {
        segment += character;
      } else {
        if (segment) yield { segment, index: segmentIndex };
        segment = character;
        segmentIndex = index;
      }
      index += character.length;
    }
    if (segment) yield { segment, index: segmentIndex };
  }

  function* extractCharacterSteps(element, cap) {
    if (cap <= 0) return [];
    const segmenter = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
    const segmentsFor = text => segmenter
      ? segmenter.segment(text)
      : fallbackSegments(text);
    let candidateCount = 0;
    let walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (parent && !parent.closest(TEXT_EXCLUSIONS)) {
        for (const item of segmentsFor(node.textContent)) {
          if (item.segment.trim() || item.segment === ' ') candidateCount += 1;
          yield;
        }
      }
      yield;
    }
    if (!candidateCount) return [];
    const selectedCount = Math.min(candidateCount, cap);
    const selectedIndexes = [];
    for (let index = 0; index < selectedCount; index += 1) {
      selectedIndexes.push(selectedCount === 1
        ? Math.floor(candidateCount / 2)
        : Math.round(index * (candidateCount - 1) / (selectedCount - 1))
      );
      yield;
    }
    const rootRect = element.getBoundingClientRect();
    const characters = [];
    let candidateIndex = 0;
    let selectedIndex = 0;
    walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while ((node = walker.nextNode()) && selectedIndex < selectedIndexes.length) {
      const parent = node.parentElement;
      if (parent && !parent.closest(TEXT_EXCLUSIONS)) {
        for (const item of segmentsFor(node.textContent)) {
          if (!item.segment.trim() && item.segment !== ' ') {
            yield;
            continue;
          }
          if (candidateIndex !== selectedIndexes[selectedIndex]) {
            candidateIndex += 1;
            yield;
            continue;
          }
          candidateIndex += 1;
          selectedIndex += 1;
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden'
            || style.opacity === '0'
            || style.position === 'fixed' || style.position === 'sticky') {
            yield;
            continue;
          }
          const range = document.createRange();
          range.setStart(node, item.index);
          range.setEnd(node, item.index + item.segment.length);
          const rect = range.getBoundingClientRect();
          range.detach?.();
          if (rect.width >= 0.5 && rect.height >= 0.5
            && rect.bottom >= -50
            && rect.top <= window.innerHeight + 50) {
            characters.push({
              char: item.segment,
              x: rect.left,
              y: rect.top,
              tx: rect.left,
              ty: rect.top,
              w: rect.width,
              h: rect.height,
              color: style.color,
              font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
              rootX: rootRect.left,
              rootY: rootRect.top
            });
          }
          yield;
          if (selectedIndex >= selectedIndexes.length) break;
        }
      }
      yield;
    }
    return characters;
  }

  function extractCharacters(element, cap) {
    return drainSteps(extractCharacterSteps(element, cap));
  }

  function* sampleDescendantSteps(root, matches, cap) {
    if (cap <= 0) return [];
    let candidateCount = 0;
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let element;
    while ((element = walker.nextNode())) {
      if (matches(element)) candidateCount += 1;
      yield;
    }
    if (!candidateCount) return [];
    const selectedCount = Math.min(candidateCount, cap);
    const selectedIndexes = [];
    for (let index = 0; index < selectedCount; index += 1) {
      selectedIndexes.push(selectedCount === 1
        ? Math.floor(candidateCount / 2)
        : Math.round(index * (candidateCount - 1) / (selectedCount - 1))
      );
      yield;
    }
    const selected = [];
    let candidateIndex = 0;
    let selectedIndex = 0;
    walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while ((element = walker.nextNode()) && selectedIndex < selectedCount) {
      if (!matches(element)) {
        yield;
        continue;
      }
      if (candidateIndex === selectedIndexes[selectedIndex]) {
        selected.push(element);
        selectedIndex += 1;
      }
      candidateIndex += 1;
      yield;
    }
    return selected;
  }

  function sampleDescendants(root, matches, cap) {
    return drainSteps(sampleDescendantSteps(root, matches, cap));
  }

  function isExcludedForegroundElement(element) {
    return Boolean(
      typeof element.closest === 'function'
      && element.closest(FOREGROUND_SUBTREE_EXCLUSIONS)
    );
  }

  function visibleRect(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden'
      || style.opacity === '0' || rect.width < 0.5 || rect.height < 0.5) {
      return null;
    }
    if (rect.bottom < -50 || rect.top > window.innerHeight + 50) return null;
    return { rect, style };
  }

  function imageContentBox(image, rect, style) {
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    if (!naturalWidth || !naturalHeight) return null;
    const source = { x: 0, y: 0, width: naturalWidth, height: naturalHeight };
    const destination = {
      x: rect.left, y: rect.top, width: rect.width, height: rect.height
    };
    const imageRatio = naturalWidth / naturalHeight;
    const boxRatio = rect.width / rect.height;
    if (style.objectFit === 'cover') {
      if (imageRatio > boxRatio) {
        source.width = naturalHeight * boxRatio;
        source.x = (naturalWidth - source.width) / 2;
      } else {
        source.height = naturalWidth / boxRatio;
        source.y = (naturalHeight - source.height) / 2;
      }
    } else if (style.objectFit === 'contain') {
      if (imageRatio > boxRatio) {
        destination.height = rect.width / imageRatio;
        destination.y += (rect.height - destination.height) / 2;
      } else {
        destination.width = rect.height * imageRatio;
        destination.x += (rect.width - destination.width) / 2;
      }
    }
    return { destination, source };
  }

  function* extractImageVisualSteps(card, cap, unit) {
    const visuals = [];
    const images = yield* sampleDescendantSteps(card, element => (
      !isExcludedForegroundElement(element)
      && (
        element.matches?.('img')
        || element.tagName?.toLowerCase() === 'img'
      )
    ), cap);
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      const tileBudget = Math.max(1, Math.floor(
        (cap - visuals.length) / (images.length - imageIndex)
      ));
      const visible = visibleRect(image);
      yield;
      if (!visible) continue;
      const box = imageContentBox(image, visible.rect, visible.style);
      if (!image.complete || !box) {
        const color = visible.style.backgroundColor !== 'rgba(0, 0, 0, 0)'
          ? visible.style.backgroundColor
          : visible.style.color;
        const fragments = yield* fragmentRectangleSteps(
          visible.rect, unit, tileBudget
        );
        for (const fragment of fragments) {
          visuals.push(paintedShape(
            image,
            fragment.left,
            fragment.top,
            fragment.width,
            fragment.height,
            color,
            0,
            { material: 'image' }
          ));
          yield;
        }
        continue;
      }
      const destinationRect = {
        left: box.destination.x,
        top: box.destination.y,
        width: box.destination.width,
        height: box.destination.height
      };
      const fragments = yield* fragmentRectangleSteps(
        destinationRect, unit, tileBudget
      );
      for (const fragment of fragments) {
        const xRatio = (fragment.left - box.destination.x)
          / box.destination.width;
        const yRatio = (fragment.top - box.destination.y)
          / box.destination.height;
        visuals.push({
          kind: 'image',
          material: 'image',
          image,
          sx: box.source.x + box.source.width * xRatio,
          sy: box.source.y + box.source.height * yRatio,
          sw: box.source.width * fragment.width / box.destination.width,
          sh: box.source.height * fragment.height / box.destination.height,
          x: fragment.left,
          y: fragment.top,
          w: fragment.width,
          h: fragment.height,
          fallbackColor: visible.style.color
        });
        yield;
      }
    }
    return visuals;
  }

  function extractImageVisuals(card, cap, unit) {
    return drainSteps(extractImageVisualSteps(card, cap, unit));
  }

  function pseudoContent(style) {
    const content = style.content;
    if (!content || content === 'none' || content === 'normal') return '';
    const unquoted = content.replace(/^(['"])(.*)\1$/, '$2');
    return unquoted.replace(/\\+([0-9a-fA-F]{1,6})\s?/g, (_, value) => (
      String.fromCodePoint(parseInt(value, 16))
    ));
  }

  function visibleColor(value) {
    if (!value || value === 'transparent') return false;
    return !/^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(value);
  }

  function visibleLine(style, prefix) {
    return (parseFloat(style[`${prefix}Width`]) || 0) > 0
      && style[`${prefix}Style`] !== 'none'
      && style[`${prefix}Style`] !== 'hidden'
      && visibleColor(style[`${prefix}Color`]);
  }

  function visiblePaint(style) {
    return visibleColor(style.backgroundColor)
      || ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']
        .some(prefix => visibleLine(style, prefix))
      || visibleLine(style, 'outline');
  }

  function pseudoVisualRect(ownerRect, style) {
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    if (!(width > 0 && height > 0)) return ownerRect;
    const left = parseFloat(style.left);
    const right = parseFloat(style.right);
    const top = parseFloat(style.top);
    const bottom = parseFloat(style.bottom);
    const x = Number.isFinite(left)
      ? ownerRect.left + left
      : Number.isFinite(right)
        ? ownerRect.right - right - width
        : ownerRect.left;
    const y = Number.isFinite(top)
      ? ownerRect.top + top
      : Number.isFinite(bottom)
        ? ownerRect.bottom - bottom - height
        : ownerRect.top;
    return {
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      width,
      height
    };
  }

  function pseudoGlyphRect(rect, style) {
    const fontSize = parseFloat(style.fontSize) || 16;
    const explicitWidth = parseFloat(style.width);
    const explicitHeight = parseFloat(style.height);
    const width = explicitWidth > 0
      ? rect.width
      : Math.min(rect.width, fontSize);
    const height = explicitHeight > 0
      ? rect.height
      : Math.min(rect.height, fontSize);
    return {
      left: rect.left,
      top: rect.top,
      right: rect.left + width,
      bottom: rect.top + height,
      width,
      height
    };
  }

  function paintedShape(
    owner, x, y, w, h, color, borderRadius = 0, metadata = {}
  ) {
    return {
      kind: 'shape',
      owner,
      x, y, w, h,
      backgroundColor: color,
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius,
      material: 'fill',
      ...metadata
    };
  }

  function* shapeFragmentSteps(
    owner, rect, style, metadata = {}, unit = 16, cap = Infinity
  ) {
    const visuals = [];
    const background = style.backgroundColor;
    if (visibleColor(background)) {
      const fragments = yield* fragmentRectangleSteps(
        rect, unit, cap - visuals.length
      );
      for (const fragment of fragments) {
        visuals.push(paintedShape(
          owner,
          fragment.left,
          fragment.top,
          fragment.width,
          fragment.height,
          background,
          parseFloat(style.borderTopLeftRadius) || 0,
          { ...metadata, material: 'fill' }
        ));
        yield;
      }
    }
    const sides = [
      ['Top', rect.left, rect.top, rect.width, parseFloat(style.borderTopWidth)],
      ['Right', rect.right - parseFloat(style.borderRightWidth), rect.top,
        parseFloat(style.borderRightWidth), rect.height],
      ['Bottom', rect.left, rect.bottom - parseFloat(style.borderBottomWidth),
        rect.width, parseFloat(style.borderBottomWidth)],
      ['Left', rect.left, rect.top, parseFloat(style.borderLeftWidth), rect.height]
    ];
    for (const [side, x, y, w, h] of sides) {
      if (visuals.length >= cap) break;
      if (!(w > 0 && h > 0) || !visibleLine(style, `border${side}`)) continue;
      const fragments = yield* fragmentRectangleSteps(
        { left: x, top: y, width: w, height: h },
        unit,
        cap - visuals.length
      );
      for (const fragment of fragments) {
        visuals.push(paintedShape(
          owner,
          fragment.left,
          fragment.top,
          fragment.width,
          fragment.height,
          style[`border${side}Color`],
          0,
          { ...metadata, material: 'line' }
        ));
        yield;
      }
    }
    if (visuals.length < cap && visibleLine(style, 'outline')) {
      const width = parseFloat(style.outlineWidth);
      const offset = parseFloat(style.outlineOffset) || 0;
      const left = rect.left - offset - width;
      const top = rect.top - offset - width;
      const right = rect.right + offset + width;
      const bottom = rect.bottom + offset + width;
      for (const [x, y, w, h] of [
        [left, top, right - left, width],
        [right - width, top, width, bottom - top],
        [left, bottom - width, right - left, width],
        [left, top, width, bottom - top]
      ]) {
        if (visuals.length >= cap) break;
        const fragments = yield* fragmentRectangleSteps(
          { left: x, top: y, width: w, height: h },
          unit,
          cap - visuals.length
        );
        for (const fragment of fragments) {
          visuals.push(paintedShape(
            owner,
            fragment.left,
            fragment.top,
            fragment.width,
            fragment.height,
            style.outlineColor,
            0,
            { ...metadata, material: 'line' }
          ));
          yield;
        }
      }
    }
    return visuals;
  }

  function* appendAtMostSteps(target, values, cap) {
    const remaining = cap - target.length;
    if (remaining <= 0) return;
    const sampled = yield* sampleAtMostSteps(values, remaining);
    for (const value of sampled) {
      target.push(value);
      yield;
    }
  }

  function* glyphFragmentSteps(owner, pseudo, char, rect, style, unit, cap) {
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if (rect.width <= unit * 1.5 && rect.height <= unit * 1.5) {
      yield;
      return [{
        kind: 'glyph',
        material: 'glyph',
        owner,
        pseudo,
        char,
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        color: style.color,
        font
      }];
    }
    const fragments = yield* fragmentRectangleSteps(rect, unit, cap);
    const glyphs = [];
    for (const fragment of fragments) {
      glyphs.push({
        kind: 'glyph',
        material: 'glyph',
        owner,
        pseudo,
        char,
        x: fragment.left,
        y: fragment.top,
        w: fragment.width,
        h: fragment.height,
        color: style.color,
        font,
        clipGlyph: true,
        glyphDrawX: rect.left - (fragment.left + fragment.width / 2),
        glyphDrawY: rect.top - (fragment.top + fragment.height / 2)
      });
      yield;
    }
    return glyphs;
  }

  function* extractPaintVisualSteps(card, shapeCap, glyphCap, unit) {
    const shapes = [];
    const glyphs = [];
    const scanCap = shapeCap + glyphCap;
    const descendants = yield* sampleDescendantSteps(
      card,
      element => !isExcludedForegroundElement(element),
      scanCap
    );
    for (const element of descendants) {
      const visible = visibleRect(element);
      yield;
      if (!visible || visible.style.position === 'fixed'
        || visible.style.position === 'sticky') continue;
      if (shapes.length < shapeCap && visiblePaint(visible.style)) {
        const fragments = yield* shapeFragmentSteps(
          element, visible.rect, visible.style, {}, unit,
          shapeCap - shapes.length
        );
        yield* appendAtMostSteps(
          shapes,
          fragments,
          shapeCap
        );
      }
      let emittedPseudoGlyph = false;
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (style.display === 'none' || style.visibility === 'hidden'
          || style.opacity === '0') {
          yield;
          continue;
        }
        const pseudoRect = pseudoVisualRect(visible.rect, style);
        const char = pseudoContent(style);
        if (char && glyphs.length < glyphCap) {
          emittedPseudoGlyph = true;
          const glyphRect = pseudoGlyphRect(pseudoRect, style);
          const fragments = yield* glyphFragmentSteps(
            element, pseudo, char, glyphRect, style, unit,
            glyphCap - glyphs.length
          );
          yield* appendAtMostSteps(
            glyphs,
            fragments,
            glyphCap
          );
        }
        if (shapes.length < shapeCap && visiblePaint(style)) {
          const fragments = yield* shapeFragmentSteps(
            element, pseudoRect, style, { pseudo }, unit,
            shapeCap - shapes.length
          );
          yield* appendAtMostSteps(
            shapes,
            fragments,
            shapeCap
          );
        }
        yield;
      }
      if (!emittedPseudoGlyph && element.matches?.('svg')
        && shapes.length < shapeCap && !visiblePaint(visible.style)) {
        const fragments = yield* fragmentRectangleSteps(
          visible.rect, unit, shapeCap - shapes.length
        );
        const fallback = [];
        for (const fragment of fragments) {
          fallback.push(paintedShape(
            element,
            fragment.left,
            fragment.top,
            fragment.width,
            fragment.height,
            visible.style.color,
            0,
            { material: 'glyph' }
          ));
          yield;
        }
        yield* appendAtMostSteps(shapes, fallback, shapeCap);
      }
      if (shapes.length >= shapeCap && glyphs.length >= glyphCap) break;
    }
    return { glyphs, shapes };
  }

  function* sampleAtMostSteps(values, cap) {
    if (cap <= 0 || !values.length) return [];
    if (values.length <= cap) return values;
    if (cap === 1) return [values[Math.floor(values.length / 2)]];
    const sampled = [];
    for (let index = 0; index < cap; index += 1) {
      sampled.push(
        values[Math.round(index * (values.length - 1) / (cap - 1))]
      );
      yield;
    }
    return sampled;
  }

  function* fairSampleGroupSteps(groups, cap) {
    const records = groups
      .filter(values => values.length)
      .map(values => ({ quota: 0, values }));
    if (!records.length || cap <= 0) return [];
    const active = [...records];
    let remaining = cap;
    while (active.length && remaining > 0) {
      const share = Math.floor(remaining / active.length);
      if (share === 0) {
        for (let index = 0; index < remaining; index += 1) {
          active[index].quota += 1;
        }
        remaining = 0;
        break;
      }
      let exhausted = false;
      for (let index = active.length - 1; index >= 0; index -= 1) {
        const group = active[index];
        const available = group.values.length - group.quota;
        const allocation = Math.min(share, available);
        group.quota += allocation;
        remaining -= allocation;
        if (allocation === available) {
          active.splice(index, 1);
          exhausted = true;
        }
      }
      if (!exhausted) {
        for (let index = 0; index < remaining; index += 1) {
          active[index].quota += 1;
        }
        remaining = 0;
      }
    }
    const sampled = [];
    for (const group of records) {
      const values = yield* sampleAtMostSteps(group.values, group.quota);
      for (const value of values) {
        sampled.push(value);
        yield;
      }
    }
    return sampled;
  }

  function* extractCardVisualSteps(card, cap, options = {}) {
    if (cap <= 0) return [];
    const characters = yield* extractCharacterSteps(card, cap);
    const text = [];
    for (const item of characters) {
      text.push({
        ...item,
        kind: 'text',
        material: 'text'
      });
      yield;
    }
    const mobile = Boolean(options.mobile);
    const textUnit = cardFragmentUnit(text, mobile);
    const controlUnit = cardControlFragmentUnit(textUnit, mobile);
    const paint = yield* extractPaintVisualSteps(
      card, cap, cap, controlUnit
    );
    const images = yield* extractImageVisualSteps(card, cap, controlUnit);
    return yield* fairSampleGroupSteps([
      paint.shapes,
      images,
      paint.glyphs,
      text
    ], cap);
  }

  function extractCardVisuals(card, cap, options = {}) {
    return drainSteps(extractCardVisualSteps(card, cap, options));
  }

  function extractCardVisualsAsync(card, cap, options = {}) {
    return drainStepsAsync(
      extractCardVisualSteps(card, cap, options),
      options
    );
  }

  function drawShapeFragment(context, particle) {
    const x = -particle.w / 2;
    const y = -particle.h / 2;
    context.fillStyle = particle.backgroundColor;
    if (particle.backgroundColor
      && particle.backgroundColor !== 'transparent'
      && particle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      context.fillRect(x, y, particle.w, particle.h);
    }
    if (particle.borderWidth > 0) {
      context.strokeStyle = particle.borderColor;
      context.lineWidth = particle.borderWidth;
      context.strokeRect(x, y, particle.w, particle.h);
    }
  }

  function drawCardVisual(context, particle) {
    context.globalAlpha = Math.max(0, Math.min(particle.opacity, 1));
    context.save();
    context.translate(particle.x + particle.w / 2, particle.y + particle.h / 2);
    context.rotate(particle.rot);
    if (particle.kind === 'image') {
      try {
        context.drawImage(
          particle.image,
          particle.sx, particle.sy, particle.sw, particle.sh,
          -particle.w / 2, -particle.h / 2, particle.w, particle.h
        );
      } catch {
        context.fillStyle = particle.fallbackColor;
        context.fillRect(
          -particle.w / 2, -particle.h / 2, particle.w, particle.h
        );
      }
    } else if (particle.kind === 'shape') {
      drawShapeFragment(context, particle);
    } else {
      context.fillStyle = particle.color;
      context.font = particle.font;
      context.textBaseline = 'top';
      if (particle.kind === 'glyph' && particle.clipGlyph) {
        context.beginPath();
        context.rect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
        context.clip();
        context.fillText(
          particle.char, particle.glyphDrawX, particle.glyphDrawY
        );
      } else {
        context.fillText(particle.char, -particle.w / 2, -particle.h / 2);
      }
    }
    context.restore();
    context.globalAlpha = 1;
  }

  function saveTarget(element) {
    return {
      element,
      savedStyleAttribute: element.getAttribute('style')
    };
  }

  function restoreTarget(record) {
    const { element, savedStyleAttribute } = record;
    if (savedStyleAttribute === null) {
      element.removeAttribute('style');
    } else {
      element.setAttribute('style', savedStyleAttribute);
    }
  }

  function saveVisibilityTarget(element) {
    return {
      element,
      property: 'visibility',
      savedStyleAttribute: element.getAttribute('style'),
      savedValue: element.style.visibility,
      appliedStyleAttribute: null
    };
  }

  function hideVisibilityTarget(record) {
    record.element.style[record.property] = 'hidden';
    record.appliedStyleAttribute = record.element.getAttribute('style');
  }

  function restoreVisibilityTarget(record) {
    const current = record.element.getAttribute('style');
    if (current === record.appliedStyleAttribute) {
      if (record.savedStyleAttribute === null) {
        record.element.removeAttribute('style');
      } else {
        record.element.setAttribute('style', record.savedStyleAttribute);
      }
    } else {
      record.element.style[record.property] = record.savedValue;
    }
  }

  function saveTargets(elements) {
    return elements.map(saveVisibilityTarget);
  }

  function restoreTargets(records) {
    for (const record of records) restoreVisibilityTarget(record);
  }

  function cardForegroundRoots(card) {
    return [...card.children].filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    });
  }

  function saveCodeForegroundTargets(code) {
    const roots = cardForegroundRoots(code);
    if (roots.length) {
      const targets = saveTargets(roots);
      for (const target of targets) hideVisibilityTarget(target);
      return targets;
    }
    const target = {
      element: code,
      property: 'color',
      savedStyleAttribute: code.getAttribute('style'),
      savedValue: code.style.color,
      appliedStyleAttribute: null
    };
    code.style.color = 'transparent';
    target.appliedStyleAttribute = code.getAttribute('style');
    return [target];
  }

  function drawConfetti(context, particle) {
    const progress = particle.t / particle.life;
    context.globalAlpha = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
    context.fillStyle = particle.color;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.rot);
    if (particle.shape === 'rect') {
      context.fillRect(-particle.size / 2, -particle.size / 4,
        particle.size, particle.size / 2);
    } else {
      context.beginPath();
      context.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    context.globalAlpha = 1;
  }

  function _stepCard(animation, context, dt) {
    let complete = true;
    for (const particle of animation.particles) {
      stepCardParticle(particle, dt);
      if (particle.phase !== 'complete') {
        complete = false;
        animation.drawCardVisual(context, particle);
      }
    }
    if (complete) animation.finish();
  }

  function makeCardAnimation(
    visuals, clientX, clientY, mobile, random,
    finish, resolve, drawCardVisual
  ) {
    const particles = visuals.map(visual => createCardParticle(
      visual,
      clientX,
      clientY,
      { mobile, random }
    ));
    return {
      particles,
      resolve,
      drawCardVisual,
      finish,
      step(context, dt) {
        _stepCard(this, context, dt);
      }
    };
  }

  function _stepCode(animation, context, dt) {
    let complete = true;
    for (const particle of animation.particles) {
      if (particle.state === 'shrapnel') {
        stepShrapnel(particle, dt, {
          drag: CONSTANTS.drag,
          gravity: CONSTANTS.gravity
        });
        const progress = particle.t / particle.duration;
        particle.opacity = progress > 0.5
          ? Math.max(0.3, 1 - (progress - 0.5))
          : 1;
        if (progress >= 1) {
          particle.state = 'assembling';
          particle.fx = particle.x;
          particle.fy = particle.y;
          particle.fr = particle.rot;
          particle.t = 0;
          particle.duration = 700 + animation.random() * 200;
        }
      }
      if (particle.state === 'assembling') {
        particle.t += dt * 1000;
        const progress = Math.min(particle.t / particle.duration, 1);
        const easing = elasticOut(progress);
        particle.x = particle.fx + (particle.tx - particle.fx) * easing;
        particle.y = particle.fy + (particle.ty - particle.fy) * easing;
        particle.rot = particle.fr * (1 - easing);
        particle.opacity = Math.min(progress * 3, 1);
        if (progress >= 1) particle.state = 'complete';
      }
      if (particle.state !== 'complete') {
        complete = false;
      }
    }
    if (complete) {
      animation.finish();
      return;
    }
    for (const particle of animation.particles) {
      animation.drawCharacter(context, particle);
    }
  }

  function makeCodeAnimation(
    target, characters, random, finish, resolve, drawCharacter
  ) {
    const rect = target.element.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const particles = characters.map(character => {
      const launch = inverseSquareLaunch(
        character.x + character.w / 2,
        character.y + character.h / 2,
        originX,
        originY,
        {
          force: CONSTANTS.codeForce,
          minimumDistance: 15,
          angularJitter: 0.25,
          upwardMinimum: 60,
          upwardRange: 80,
          random
        }
      );
      return {
        ...character,
        ...launch,
        rot: 0,
        av: (random() - 0.5) * 10,
        opacity: 1,
        state: 'shrapnel',
        t: 0,
        duration: 500 + random() * 100
      };
    });
    return {
      target,
      particles,
      random,
      resolve,
      drawCharacter,
      finish,
      step(context, dt) {
        _stepCode(this, context, dt);
      }
    };
  }

  function createAcceleratorLoader(runtimeWindow, runtimeDocument) {
    const scriptPromises = new Map();
    const canFetchSource = typeof runtimeWindow.fetch === 'function'
      && typeof runtimeWindow.Blob === 'function'
      && typeof runtimeWindow.URL?.createObjectURL === 'function'
      && typeof runtimeWindow.URL?.revokeObjectURL === 'function';

    function abortError() {
      const error = new Error('Particle accelerator loading was cancelled');
      error.name = 'AbortError';
      return error;
    }

    function acceleratorLoadError(message, retryable, cause) {
      const error = new Error(message);
      error.retryable = retryable;
      if (cause !== undefined) error.cause = cause;
      return error;
    }

    function evaluateScript(source, url, signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      let objectUrl;
      try {
        objectUrl = runtimeWindow.URL.createObjectURL(new runtimeWindow.Blob(
          [`${source}\n//# sourceURL=${url}`],
          { type: 'text/javascript' }
        ));
      } catch (error) {
        return Promise.reject(acceleratorLoadError(
          `Failed to prepare particle accelerator script: ${url}`,
          false,
          error
        ));
      }
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          runtimeWindow.URL.revokeObjectURL(objectUrl);
          reject(abortError());
          return;
        }
        let script;
        let settled = false;

        const cleanup = () => {
          script?.removeEventListener?.('load', onLoad);
          script?.removeEventListener?.('error', onError);
          signal?.removeEventListener?.('abort', onAbort);
          try {
            script?.remove?.();
          } catch {
            // Script execution has already settled.
          }
          try {
            runtimeWindow.URL.revokeObjectURL(objectUrl);
          } catch {
            // Revocation is best-effort after the script has settled.
          }
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          callback(value);
        };
        const onLoad = () => settle(resolve);
        const onError = () => settle(
          reject,
          acceleratorLoadError(
            `Failed to evaluate particle accelerator script: ${url}`,
            false
          )
        );
        const onAbort = () => settle(reject, abortError());

        try {
          script = runtimeDocument.createElement('script');
          script.async = false;
          script.src = objectUrl;
        } catch (error) {
          settle(
            reject,
            acceleratorLoadError(
              `Failed to prepare particle accelerator script: ${url}`,
              false,
              error
            )
          );
          return;
        }
        script.addEventListener?.('load', onLoad);
        script.addEventListener?.('error', onError);
        signal?.addEventListener?.('abort', onAbort, { once: true });
        try {
          (runtimeDocument.head || runtimeDocument.documentElement)
            .appendChild(script);
        } catch (error) {
          settle(
            reject,
            acceleratorLoadError(
              `Failed to evaluate particle accelerator script: ${url}`,
              false,
              error
            )
          );
        }
      });
    }

    async function fetchAndEvaluate(url, signal) {
      if (signal?.aborted) throw abortError();
      let response;
      try {
        response = await runtimeWindow.fetch(url, {
          signal,
          credentials: 'same-origin',
          cache: 'force-cache'
        });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          throw abortError();
        }
        throw acceleratorLoadError(
          `Failed to fetch particle accelerator script: ${url}`,
          true,
          error
        );
      }
      if (!response?.ok) {
        throw acceleratorLoadError(
          `Failed to fetch particle accelerator script: ${url}`,
          true
        );
      }
      let source;
      try {
        source = await response.text();
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
          throw abortError();
        }
        throw acceleratorLoadError(
          `Failed to read particle accelerator script: ${url}`,
          true,
          error
        );
      }
      if (signal?.aborted) throw abortError();
      await evaluateScript(source, url, signal);
    }

    function appendScript(url, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        const script = runtimeDocument.createElement('script');
        let settled = false;
        script.async = true;
        script.src = url;

        const cleanup = () => {
          script.removeEventListener?.('load', onLoad);
          script.removeEventListener?.('error', onError);
          signal?.removeEventListener?.('abort', onAbort);
        };
        const settle = (callback, value, remove) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (remove) {
            try {
              script.remove?.();
            } catch {
              // Promise state still determines whether a retry is possible.
            }
          }
          callback(value);
        };
        const onLoad = () => settle(resolve, undefined, false);
        const onError = () => settle(
          reject,
          acceleratorLoadError(
            `Failed to load particle accelerator script: ${url}`,
            true
          ),
          true
        );
        const onAbort = () => settle(reject, abortError(), true);

        script.addEventListener?.('load', onLoad);
        script.addEventListener?.('error', onError);
        signal?.addEventListener?.('abort', onAbort, { once: true });
        try {
          (runtimeDocument.head || runtimeDocument.documentElement)
            .appendChild(script);
        } catch (error) {
          settle(reject, error, true);
        }
      });
    }

    function loadScript(url, signal) {
      if (scriptPromises.has(url)) return scriptPromises.get(url);
      const promise = canFetchSource
        ? fetchAndEvaluate(url, signal)
        : appendScript(url, signal);
      scriptPromises.set(url, promise);
      promise.catch(() => {
        if (scriptPromises.get(url) === promise) scriptPromises.delete(url);
      });
      return promise;
    }

    return async function loadAccelerator({ signal } = {}) {
      if (runtimeWindow.SiteParticleAccelerator?.createAccelerator) {
        return runtimeWindow.SiteParticleAccelerator;
      }
      for (const url of ACCELERATOR_SCRIPTS) {
        await loadScript(url, signal);
      }
      const api = runtimeWindow.SiteParticleAccelerator;
      if (!api || typeof api.createAccelerator !== 'function') {
        throw new Error('Particle accelerator API is unavailable');
      }
      return api;
    };
  }

  function createRuntime(options = {}) {
    const overlay = new CanvasOverlay();
    const random = options.random || Math.random;
    const watchdogMs = options.watchdogMs || 4000;
    const shouldRetainCardForeground = options.shouldRetainCardForeground
      || (() => false);
    const runtimeWindow = typeof window === 'undefined' ? globalThis : window;
    const runtimeDocument = options.document
      || runtimeWindow.document
      || (typeof document === 'undefined' ? null : document);
    const reducedMotion = options.reducedMotionQuery
      || runtimeWindow.matchMedia?.('(prefers-reduced-motion: reduce)')
      || { matches: false };
    const canLoadAccelerator = typeof options.loadAccelerator === 'function'
      || Boolean(runtimeDocument?.head && runtimeDocument?.createElement);
    const loadAccelerator = options.loadAccelerator
      || (canLoadAccelerator
        ? createAcceleratorLoader(runtimeWindow, runtimeDocument)
        : null);
    const accelerationRoot = options.accelerationRoot || runtimeDocument;
    const accelerationSelector = options.accelerationSelector || null;
    let primary = null;
    let confetti = [];
    let destroyed = false;
    let warned = false;
    let retainedCard = null;
    let accelerator = null;
    let accelerationDisabled = false;
    let acceleratorLoad = null;
    let acceleratorRetryTimer = null;
    let acceleratorGeneration = 0;
    let loadGateTimer = null;
    let loadGateElapsed = false;
    let lcpObserver = null;
    let lcpGeneration = 0;
    let lcpCandidateObserved = false;
    let lcpFinalized = false;
    let lcpLoadSuppressed = false;
    let loaded = runtimeDocument?.readyState === 'complete';
    const tagRecords = new Set();
    const accelerationRemovers = [];
    const lcpFinalizationRemovers = [];

    function acceleratorEffectsApi() {
      return {
        CONSTANTS,
        drawCardVisual,
        extractCardVisuals,
        extractCardVisualsAsync
      };
    }

    function hasEligibleCards() {
      if (!accelerationSelector) return true;
      try {
        return Boolean(
          accelerationRoot?.querySelector?.(accelerationSelector)
        );
      } catch {
        return false;
      }
    }

    function cancelAcceleratorRetry() {
      if (acceleratorRetryTimer === null) return;
      runtimeWindow.clearTimeout(acceleratorRetryTimer);
      acceleratorRetryTimer = null;
    }

    function cancelLoadGate() {
      if (loadGateTimer === null) return;
      runtimeWindow.clearTimeout(loadGateTimer);
      loadGateTimer = null;
    }

    function disconnectLcpObserver() {
      lcpGeneration++;
      const observer = lcpObserver;
      lcpObserver = null;
      try {
        observer?.disconnect?.();
      } catch {
        // Generation checks still ignore a late observer delivery.
      }
    }

    function removeLcpFinalizationListeners() {
      for (const remove of lcpFinalizationRemovers.splice(0)) {
        try {
          remove();
        } catch {
          // Continue removing the remaining finalization listeners.
        }
      }
    }

    function completeLcpGate(options = {}) {
      if (!lcpCandidateObserved || !lcpFinalized) return;
      disconnectLcpObserver();
      removeLcpFinalizationListeners();
      if (options.attempt !== false && !lcpLoadSuppressed) {
        attemptAcceleratorLoad();
      }
    }

    function finalizeLcp(options = {}) {
      if (destroyed) return;
      if (options.attempt === false) lcpLoadSuppressed = true;
      if (lcpFinalized) return;
      lcpFinalized = true;
      completeLcpGate(options);
    }

    function onLcpInteraction() {
      finalizeLcp();
    }

    function onLcpVisibilityChange() {
      if (runtimeDocument?.hidden) {
        finalizeLcp({ attempt: false });
      } else {
        lcpLoadSuppressed = false;
        attemptAcceleratorLoad();
      }
    }

    function onLcpPageHide() {
      finalizeLcp({ attempt: false });
    }

    function armLcpFinalizationListeners() {
      if (destroyed || lcpFinalized || lcpFinalizationRemovers.length) return;
      const passiveCapture = { capture: true, passive: true };
      lcpFinalizationRemovers.push(
        listen(runtimeWindow, 'pointerdown', onLcpInteraction, passiveCapture),
        listen(runtimeWindow, 'keydown', onLcpInteraction, true),
        listen(runtimeWindow, 'scroll', onLcpInteraction, passiveCapture)
      );
    }

    function cancelAcceleratorLoad() {
      acceleratorGeneration++;
      const record = acceleratorLoad;
      acceleratorLoad = null;
      try {
        record?.controller?.abort();
      } catch {
        // Generation checks still prevent a late install.
      }
    }

    function installAccelerator(api, generation) {
      if (destroyed || accelerationDisabled
        || generation !== acceleratorGeneration
        || reducedMotion.matches || accelerator
        || !hasEligibleCards()) return;
      if (!api || typeof api.createAccelerator !== 'function') {
        throw new Error('Particle accelerator factory is unavailable');
      }
      const instance = api.createAccelerator({
        ...(options.acceleratorOptions || {}),
        ...(accelerationSelector
          ? { cardSelector: accelerationSelector }
          : {}),
        atlasVersion: '20260727.1',
        document: runtimeDocument,
        effects: acceleratorEffectsApi(),
        effectsVersion: PARTICLE_EFFECTS_VERSION,
        reducedMotionQuery: reducedMotion,
        webglVersion: '20260727.1',
        window: runtimeWindow,
        workerVersion: '20260727.1'
      });
      if (!instance || typeof instance.take !== 'function') {
        instance?.destroy?.();
        throw new Error('Particle accelerator instance is invalid');
      }
      if (destroyed || accelerationDisabled
        || generation !== acceleratorGeneration
        || reducedMotion.matches || !hasEligibleCards()) {
        instance.destroy?.();
        return;
      }
      accelerator = instance;
      accelerator.observe?.(accelerationRoot);
    }

    function attemptAcceleratorLoad() {
      if (destroyed || accelerationDisabled
        || accelerator || acceleratorLoad
        || reducedMotion.matches || !loaded || !loadGateElapsed
        || !lcpCandidateObserved || !lcpFinalized
        || lcpLoadSuppressed || runtimeDocument?.hidden
        || !hasEligibleCards() || !loadAccelerator) return;
      const generation = acceleratorGeneration;
      const AbortControllerClass = runtimeWindow.AbortController
        || (typeof AbortController === 'function' ? AbortController : null);
      const controller = AbortControllerClass
        ? new AbortControllerClass()
        : null;
      const record = { controller, generation, promise: null };
      const promise = (async () => {
        let shouldRetry = false;
        try {
          const api = await loadAccelerator({
            signal: controller?.signal
          });
          installAccelerator(api, generation);
        } catch (error) {
          if (error?.retryable === false
            && generation === acceleratorGeneration) {
            accelerationDisabled = true;
          }
          shouldRetry = !destroyed
            && !accelerationDisabled
            && generation === acceleratorGeneration
            && !reducedMotion.matches
            && hasEligibleCards();
        } finally {
          if (acceleratorLoad === record) acceleratorLoad = null;
          if (shouldRetry) scheduleAcceleratorRetry();
        }
      })();
      record.promise = promise;
      acceleratorLoad = record;
    }

    function scheduleAcceleratorRetry() {
      if (destroyed || accelerationDisabled
        || accelerator || acceleratorLoad
        || acceleratorRetryTimer !== null || reducedMotion.matches
        || !loaded || !loadGateElapsed
        || !lcpCandidateObserved || !lcpFinalized
        || lcpLoadSuppressed || runtimeDocument?.hidden
        || !hasEligibleCards() || !loadAccelerator) return;
      acceleratorRetryTimer = runtimeWindow.setTimeout(() => {
        acceleratorRetryTimer = null;
        attemptAcceleratorLoad();
      }, ACCELERATOR_LAZY_DELAY);
    }

    function armLoadGate() {
      if (destroyed || accelerationDisabled || !loaded
        || loadGateElapsed || loadGateTimer !== null
        || !loadAccelerator) return;
      loadGateTimer = runtimeWindow.setTimeout(() => {
        loadGateTimer = null;
        loadGateElapsed = true;
        attemptAcceleratorLoad();
      }, ACCELERATOR_LAZY_DELAY);
    }

    function armLcpObservation() {
      if (destroyed || accelerationDisabled || reducedMotion.matches
        || (lcpCandidateObserved && lcpFinalized)
        || lcpObserver || !loadAccelerator) return;
      const PerformanceObserverClass = runtimeWindow.PerformanceObserver;
      if (typeof PerformanceObserverClass !== 'function') {
        // Older browsers conservatively fall back to the post-load delay.
        lcpCandidateObserved = true;
        lcpFinalized = true;
        attemptAcceleratorLoad();
        return;
      }
      const supportedEntryTypes = PerformanceObserverClass.supportedEntryTypes;
      if (Array.isArray(supportedEntryTypes)
        && !supportedEntryTypes.includes('largest-contentful-paint')) {
        lcpCandidateObserved = true;
        lcpFinalized = true;
        attemptAcceleratorLoad();
        return;
      }
      armLcpFinalizationListeners();
      const generation = ++lcpGeneration;
      let observer;
      try {
        observer = new PerformanceObserverClass(entries => {
          if (destroyed || generation !== lcpGeneration
            || observer !== lcpObserver) return;
          const candidates = entries?.getEntries?.() || [];
          if (!candidates.length) return;
          lcpCandidateObserved = true;
          completeLcpGate();
        });
        lcpObserver = observer;
        observer.observe({
          type: 'largest-contentful-paint',
          buffered: true
        });
      } catch {
        if (observer === lcpObserver) disconnectLcpObserver();
        // A partial/older observer implementation uses the same safe fallback.
        removeLcpFinalizationListeners();
        lcpCandidateObserved = true;
        lcpFinalized = true;
        attemptAcceleratorLoad();
      }
    }

    function suspendAcceleratorLifecycle() {
      cancelAcceleratorRetry();
      cancelLoadGate();
      loadGateElapsed = false;
      cancelAcceleratorLoad();
      disconnectLcpObserver();
      removeLcpFinalizationListeners();
      lcpCandidateObserved = false;
      lcpFinalized = false;
      lcpLoadSuppressed = false;
      const instance = accelerator;
      accelerator = null;
      try {
        instance?.destroy?.();
      } catch {
        // Runtime teardown must continue even if accelerator cleanup fails.
      }
    }

    function onLoad() {
      if (destroyed) return;
      loaded = true;
      armLoadGate();
      armLcpObservation();
      attemptAcceleratorLoad();
    }

    function resumeAcceleratorLifecycle() {
      if (destroyed) return;
      loaded = true;
      // A suspended document has passed pagehide, which finalizes its LCP.
      lcpFinalized = true;
      lcpLoadSuppressed = false;
      armLcpObservation();
      armLoadGate();
      attemptAcceleratorLoad();
    }

    function refreshAcceleratorLifecycle() {
      if (destroyed || accelerationDisabled) return;
      if (!hasEligibleCards()) {
        cancelAcceleratorRetry();
        cancelAcceleratorLoad();
        const instance = accelerator;
        accelerator = null;
        try {
          instance?.destroy?.();
        } catch {
          // A later eligible page may still use a fresh accelerator.
        }
        return;
      }
      armLcpObservation();
      armLoadGate();
      attemptAcceleratorLoad();
    }

    function onReducedMotionChange(event) {
      if (event?.matches ?? reducedMotion.matches) {
        cancelAcceleratorRetry();
        cancelAcceleratorLoad();
        disconnectLcpObserver();
      } else {
        armLcpObservation();
        armLoadGate();
        attemptAcceleratorLoad();
      }
    }

    function particleCap(mobile) {
      return mobile
        ? CONSTANTS.mobileParticleCap
        : CONSTANTS.desktopParticleCap;
    }

    function warnOnce(error) {
      markReportedError(error);
      if (warned) return;
      warned = true;
      console.warn(
        '[Site particle effects] Animation failed; visual state was restored.',
        error
      );
    }

    function clearPrimaryWatchdog(record) {
      if (record.watchdog === null) return;
      runtimeWindow.clearTimeout(record.watchdog);
      record.watchdog = null;
    }

    function restorePrimaryTargets(record) {
      if (record.targets) {
        restoreTargets(record.targets);
      } else {
        restoreTarget(record.target);
      }
    }

    function cancelExternalRun(record) {
      if (!record.externalRun || record.externalCancelled) return;
      record.externalCancelled = true;
      try {
        record.externalRun.cancel();
      } catch {
        // Coordinator settlement remains authoritative.
      }
    }

    function settlePrimary(record, outcome = 'resolve', error, options = {}) {
      if (!record || record.settled) return;
      record.settled = true;
      clearPrimaryWatchdog(record);
      cancelExternalRun(record);
      if (primary === record) primary = null;
      const retain = record.kind === 'card'
        && (record.retainOnResolve && outcome === 'resolve'
          || options.retainCardForeground);
      if (retain) {
        if (retainedCard) restoreTargets(retainedCard);
        retainedCard = record.targets;
      } else {
        restorePrimaryTargets(record);
      }
      if (outcome === 'reject') {
        record.reject?.(error);
      } else {
        record.resolve?.();
      }
    }

    function finishPrimary(options) {
      settlePrimary(primary, 'resolve', undefined, options);
    }

    function cancelTag(record) {
      if (record.cancelled) return;
      record.cancelled = true;
      if (record.raf !== null) cancelAnimationFrame(record.raf);
      clearTimeout(record.timer);
      restoreTarget(record);
      tagRecords.delete(record);
      record.group.remaining -= 1;
      if (record.group.remaining === 0) record.group.resolve();
    }

    function stopVisuals() {
      confetti = [];
      for (const record of [...tagRecords]) cancelTag(record);
      overlay.hide();
    }

    function failRuntime(error) {
      const record = primary;
      if (record) settlePrimary(record, 'reject', error);
      if (record?.external) {
        accelerationDisabled = true;
        try {
          accelerator?.disable?.(error);
        } catch {
          // The current failure still settles through the runtime.
        }
      }
      stopVisuals();
      overlay.destroy();
      warnOnce(error);
    }

    function drawCharacter(context, particle) {
      context.globalAlpha = Math.max(0, Math.min(particle.opacity, 1));
      context.fillStyle = particle.color;
      context.font = particle.font;
      context.textBaseline = 'top';
      context.save();
      context.translate(
        particle.x + particle.w / 2,
        particle.y + particle.h / 2
      );
      context.rotate(particle.rot);
      context.fillText(particle.char, -particle.w / 2, -particle.h / 2);
      context.restore();
      context.globalAlpha = 1;
    }

    function ensureLoop() {
      overlay.show();
      if (overlay.raf) return;
      let previous = performance.now();
      const frame = now => {
        overlay.raf = null;
        try {
          const dt = Math.min((now - previous) / 1000, 0.05);
          previous = now;
          overlay.clear();
          if (primary?.step) primary.step(overlay.context, dt);
          confetti = confetti.filter(particle => {
            stepConfettiParticle(particle, dt);
            if (!particle.alive) return false;
            drawConfetti(overlay.context, particle);
            return true;
          });
          if (primary || confetti.length) {
            overlay.raf = requestAnimationFrame(frame);
          } else {
            overlay.hide();
          }
        } catch (error) {
          failRuntime(error);
        }
      };
      overlay.raf = requestAnimationFrame(frame);
    }

    function startPrimary(recordOptions, makeAnimation, startExternal) {
      return new Promise((resolve, reject) => {
        let record;
        try {
          record = startExternal
            ? { external: true, externalCancelled: false, externalRun: null }
            : makeAnimation(
              () => settlePrimary(record),
              resolve
            );
        } catch (error) {
          restorePrimaryTargets(recordOptions);
          warnOnce(error);
          reject(error);
          return;
        }
        Object.assign(record, recordOptions);
        record.resolve = resolve;
        record.reject = reject;
        record.settled = false;
        record.watchdog = null;
        primary = record;
        try {
          if (startExternal) {
            const run = startExternal(
              () => settlePrimary(record),
              error => {
                if (!record.settled) failRuntime(error);
              }
            );
            if (!run || typeof run.cancel !== 'function'
              || !run.completion?.then) {
              throw new Error('External particle animation is invalid');
            }
            record.externalRun = run;
            Promise.resolve(run.completion).then(
              () => settlePrimary(record),
              error => {
                if (!record.settled) failRuntime(error);
              }
            );
            if (record.settled) cancelExternalRun(record);
          } else {
            ensureLoop();
          }
          if (primary === record) {
            record.watchdog = runtimeWindow.setTimeout(() => {
              if (primary !== record || record.settled) return;
              failRuntime(new Error(
                `Primary animation watchdog expired after ${watchdogMs}ms`
              ));
            }, watchdogMs);
          }
        } catch (error) {
          failRuntime(error);
        }
      });
    }

    function onResize() {
      if (destroyed) return;
      const retainCardForeground = Boolean(shouldRetainCardForeground());
      finishPrimary({ retainCardForeground });
      if (!retainCardForeground) restoreRetainedCard();
      stopVisuals();
    }

    function restoreRetainedCard() {
      if (!retainedCard) return;
      restoreTargets(retainedCard);
      retainedCard = null;
    }

    function discardRetainedCard() {
      retainedCard = null;
    }

    if (typeof runtimeWindow.addEventListener === 'function') {
      runtimeWindow.addEventListener('resize', onResize);
    }
    if (loadAccelerator) {
      accelerationRemovers.push(
        listen(runtimeWindow, 'load', onLoad),
        listen(runtimeWindow, 'pagehide', onLcpPageHide),
        listen(runtimeDocument, 'visibilitychange', onLcpVisibilityChange),
        listenMediaQuery(reducedMotion, onReducedMotionChange)
      );
      armLcpObservation();
      if (loaded) armLoadGate();
    }

    return {
      explodeCard(element, clientX, clientY, options = {}) {
        restoreRetainedCard();
        finishPrimary();
        const mobile = Boolean(options.mobile);
        let prepared = null;
        try {
          prepared = accelerator?.take(element, mobile) || null;
        } catch (error) {
          accelerationDisabled = true;
          try {
            accelerator?.disable?.(error);
          } catch {
            // Canvas fallback remains immediately available.
          }
        }
        const visuals = prepared?.visuals || extractCardVisuals(
          element, particleCap(mobile), { mobile }
        );
        if (!visuals.length) {
          prepared?.dispose?.();
          return Promise.resolve();
        }
        const targets = saveTargets(cardForegroundRoots(element));
        for (const target of targets) hideVisibilityTarget(target);
        if (prepared) {
          return startPrimary({
            kind: 'card',
            retainOnResolve: true,
            targets
          }, null, (finish, error) => {
            let particles;
            try {
              particles = visuals.map(visual => createCardParticle(
                visual,
                clientX,
                clientY,
                { mobile, random }
              ));
            } catch (particleError) {
              prepared.dispose?.();
              throw particleError;
            }
            return prepared.start(particles, {
              complete: finish,
              error
            });
          });
        }
        return startPrimary({
          kind: 'card',
          retainOnResolve: true,
          targets
        }, (finish, resolve) => (
          makeCardAnimation(
            visuals, clientX, clientY,
            mobile, random, finish, resolve, drawCardVisual
          )
        ));
      },
      explodeCode(element, options = {}) {
        if (primary?.target?.element === element) return Promise.resolve();
        finishPrimary();
        const particles = extractCharacters(
          element, particleCap(Boolean(options.mobile))
        );
        if (!particles.length) return Promise.resolve();
        const targets = saveCodeForegroundTargets(element);
        const target = { element };
        return startPrimary({
          kind: 'code',
          retainOnResolve: false,
          targets
        }, (finish, resolve) => (
          makeCodeAnimation(
            target, particles, random, finish, resolve, drawCharacter
          )
        ));
      },
      scatterTags(elements, selected, options = {}) {
        const selectedRect = selected.getBoundingClientRect();
        const origin = {
          x: selectedRect.left + selectedRect.width / 2,
          y: selectedRect.top + selectedRect.height / 2
        };
        for (const element of elements) {
          for (const existing of [...tagRecords]) {
            if (existing.element === element) cancelTag(existing);
          }
        }
        const targets = elements.filter(element => element !== selected);
        if (!targets.length) return Promise.resolve();
        const group = { remaining: targets.length, resolve: null };
        const completion = new Promise(resolve => {
          group.resolve = resolve;
        });
        for (const element of targets) {
          const record = saveTarget(element);
          record.cancelled = false;
          record.group = group;
          record.raf = null;
          record.timer = null;
          tagRecords.add(record);
          const rect = element.getBoundingClientRect();
          const vector = tagScatterVector({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          }, origin, random);
          const scale = options.mobile ? 0.65 : 1;
          element.style.transition = 'transform 0s, opacity 0s';
          record.raf = requestAnimationFrame(() => {
            if (record.cancelled) return;
            record.raf = requestAnimationFrame(() => {
              if (record.cancelled) return;
              record.raf = null;
              element.style.transition = options.mobile
                ? 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease-out'
                : 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.6s ease-out';
              element.style.transform = `translate(${vector.x * scale}px, ${
                vector.y * scale
              }px) rotate(${vector.rotation * scale}deg)`;
              element.style.opacity = '0';
              record.timer = setTimeout(() => {
                cancelTag(record);
              }, options.mobile ? 340 : 620);
            });
          });
        }
        return completion;
      },
      confettiBurst(x, y, count) {
        try {
          for (let index = 0; index < count; index += 1) {
            confetti.push(createConfettiParticle(x, y, random));
          }
          ensureLoop();
          return true;
        } catch (error) {
          failRuntime(error);
          return false;
        }
      },
      restoreRetainedCard() {
        restoreRetainedCard();
      },
      discardRetainedCard() {
        discardRetainedCard();
      },
      suspendAcceleration() {
        if (destroyed) return;
        suspendAcceleratorLifecycle();
      },
      resumeAcceleration() {
        resumeAcceleratorLifecycle();
      },
      refreshAcceleration() {
        refreshAcceleratorLifecycle();
      },
      cancelAll(options = {}) {
        finishPrimary(options);
        if (!options.retainCardForeground) this.restoreRetainedCard();
        stopVisuals();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        this.cancelAll();
        suspendAcceleratorLifecycle();
        for (const remove of accelerationRemovers.splice(0)) {
          try {
            remove();
          } catch {
            // Continue removing the remaining lifecycle listeners.
          }
        }
        if (typeof runtimeWindow.removeEventListener === 'function') {
          runtimeWindow.removeEventListener('resize', onResize);
        }
        overlay.destroy();
      }
    };
  }

  return {
    ACCELERATOR_SCRIPTS,
    PARTICLE_EFFECTS_VERSION,
    CONSTANTS,
    CanvasOverlay,
    inverseSquareLaunch,
    stepShrapnel,
    createCardParticle,
    stepCardParticle,
    elasticOut,
    sampleEvenly,
    cardFragmentUnit,
    cardControlFragmentUnit,
    fragmentRectangles,
    tagScatterVector,
    createConfettiParticle,
    stepConfettiParticle,
    advanceKonami,
    isEligibleLinkClick,
    isDoubleTap,
    isReportedError,
    extractCharacters,
    extractCardVisuals,
    extractCardVisualsAsync,
    drawCardVisual,
    createRuntime
  };
});
