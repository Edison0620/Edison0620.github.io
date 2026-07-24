'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteParticleEffects = api;
})(typeof window === 'undefined' ? null : window, function() {
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

  function tagScatterVector(point, origin, random) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const distance = Math.max(Math.hypot(dx, dy), 20);
    const magnitude = Math.min(800 / distance, 40);
    const angle = Math.atan2(dy, dx);
    return {
      x: Math.cos(angle) * magnitude + (random() - 0.5) * 10,
      y: Math.sin(angle) * magnitude + (random() - 0.5) * 10,
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

  function extractCharacters(element, cap) {
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
      if (!parent || parent.closest(TEXT_EXCLUSIONS)) continue;
      for (const item of segmentsFor(node.textContent)) {
        if (item.segment.trim() || item.segment === ' ') candidateCount += 1;
      }
    }
    if (!candidateCount) return [];
    const selectedCount = Math.min(candidateCount, cap);
    const selectedIndexes = Array.from({ length: selectedCount }, (_, index) => (
      selectedCount === 1
        ? Math.floor(candidateCount / 2)
        : Math.round(index * (candidateCount - 1) / (selectedCount - 1))
    ));
    const rootRect = element.getBoundingClientRect();
    const characters = [];
    let candidateIndex = 0;
    let selectedIndex = 0;
    walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while ((node = walker.nextNode()) && selectedIndex < selectedIndexes.length) {
      const parent = node.parentElement;
      if (!parent || parent.closest(TEXT_EXCLUSIONS)) continue;
      for (const item of segmentsFor(node.textContent)) {
        if (!item.segment.trim() && item.segment !== ' ') continue;
        if (candidateIndex !== selectedIndexes[selectedIndex]) {
          candidateIndex += 1;
          continue;
        }
        candidateIndex += 1;
        selectedIndex += 1;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden'
          || style.opacity === '0'
          || style.position === 'fixed' || style.position === 'sticky') continue;
        const range = document.createRange();
        range.setStart(node, item.index);
        range.setEnd(node, item.index + item.segment.length);
        const rect = range.getBoundingClientRect();
        range.detach?.();
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        if (rect.bottom < -50 || rect.top > window.innerHeight + 50) continue;
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
        if (selectedIndex >= selectedIndexes.length) break;
      }
    }
    return characters;
  }

  function sampleDescendants(root, matches, cap) {
    if (cap <= 0) return [];
    let candidateCount = 0;
    let walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let element;
    while ((element = walker.nextNode())) {
      if (matches(element)) candidateCount += 1;
    }
    if (!candidateCount) return [];
    const selectedCount = Math.min(candidateCount, cap);
    const selectedIndexes = Array.from({ length: selectedCount }, (_, index) => (
      selectedCount === 1
        ? Math.floor(candidateCount / 2)
        : Math.round(index * (candidateCount - 1) / (selectedCount - 1))
    ));
    const selected = [];
    let candidateIndex = 0;
    let selectedIndex = 0;
    walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while ((element = walker.nextNode()) && selectedIndex < selectedCount) {
      if (!matches(element)) continue;
      if (candidateIndex === selectedIndexes[selectedIndex]) {
        selected.push(element);
        selectedIndex += 1;
      }
      candidateIndex += 1;
    }
    return selected;
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

  function extractImageVisuals(card, cap) {
    const visuals = [];
    const images = sampleDescendants(card, element => (
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
      if (!visible) continue;
      const box = imageContentBox(image, visible.rect, visible.style);
      if (!image.complete || !box) {
        const color = visible.style.backgroundColor !== 'rgba(0, 0, 0, 0)'
          ? visible.style.backgroundColor
          : visible.style.color;
        const halfWidth = visible.rect.width / 2;
        const halfHeight = visible.rect.height / 2;
        const fallbackCount = Math.min(4, tileBudget);
        for (let index = 0; index < fallbackCount; index += 1) {
          const tileIndex = fallbackCount === 1
            ? 2
            : Math.round(index * 3 / (fallbackCount - 1));
          const row = Math.floor(tileIndex / 2);
          const column = tileIndex % 2;
          visuals.push(paintedShape(
            image,
            visible.rect.left + halfWidth * column,
            visible.rect.top + halfHeight * row,
            halfWidth,
            halfHeight,
            color
          ));
        }
        continue;
      }
      const columns = Math.max(2, Math.min(4, Math.ceil(box.destination.width / 48)));
      const rows = Math.max(2, Math.min(4, Math.ceil(box.destination.height / 48)));
      const gridCount = columns * rows;
      const selectedTiles = Math.min(gridCount, tileBudget);
      for (let index = 0; index < selectedTiles; index += 1) {
        const tileIndex = selectedTiles === 1
          ? Math.floor(gridCount / 2)
          : Math.round(index * (gridCount - 1) / (selectedTiles - 1));
        const row = Math.floor(tileIndex / columns);
        const column = tileIndex % columns;
        const xRatio = column / columns;
        const yRatio = row / rows;
        visuals.push({
          kind: 'image',
          image,
          sx: box.source.x + box.source.width * xRatio,
          sy: box.source.y + box.source.height * yRatio,
          sw: box.source.width / columns,
          sh: box.source.height / rows,
          x: box.destination.x + box.destination.width * xRatio,
          y: box.destination.y + box.destination.height * yRatio,
          w: box.destination.width / columns,
          h: box.destination.height / rows,
          fallbackColor: visible.style.color
        });
      }
    }
    return visuals;
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
      ...metadata
    };
  }

  function shapeFragments(owner, rect, style, metadata = {}) {
    const visuals = [];
    const background = style.backgroundColor;
    if (visibleColor(background)) {
      const columns = rect.width > 48 ? 2 : 1;
      const rows = rect.height > 32 ? 2 : 1;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          visuals.push(paintedShape(
            owner,
            rect.left + rect.width * column / columns,
            rect.top + rect.height * row / rows,
            rect.width / columns,
            rect.height / rows,
            background,
            parseFloat(style.borderTopLeftRadius) || 0,
            metadata
          ));
        }
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
      if (!(w > 0 && h > 0) || !visibleLine(style, `border${side}`)) continue;
      visuals.push(paintedShape(
        owner, x, y, w, h, style[`border${side}Color`], 0, metadata
      ));
    }
    if (visibleLine(style, 'outline')) {
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
        visuals.push(paintedShape(
          owner, x, y, w, h, style.outlineColor, 0, metadata
        ));
      }
    }
    return visuals;
  }

  function appendAtMost(target, values, cap) {
    const remaining = cap - target.length;
    if (remaining <= 0) return;
    target.push(...sampleAtMost(values, remaining));
  }

  function extractPaintVisuals(card, shapeCap, glyphCap) {
    const shapes = [];
    const glyphs = [];
    const scanCap = shapeCap + glyphCap;
    const descendants = sampleDescendants(
      card,
      element => !isExcludedForegroundElement(element),
      scanCap
    );
    for (const element of descendants) {
      const visible = visibleRect(element);
      if (!visible || visible.style.position === 'fixed'
        || visible.style.position === 'sticky') continue;
      if (shapes.length < shapeCap && visiblePaint(visible.style)) {
        appendAtMost(
          shapes,
          shapeFragments(element, visible.rect, visible.style),
          shapeCap
        );
      }
      let emittedPseudoGlyph = false;
      for (const pseudo of ['::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (style.display === 'none' || style.visibility === 'hidden'
          || style.opacity === '0') continue;
        const char = pseudoContent(style);
        if (char && glyphs.length < glyphCap) {
          emittedPseudoGlyph = true;
          glyphs.push({
            kind: 'glyph',
            owner: element,
            pseudo,
            char,
            x: visible.rect.left,
            y: visible.rect.top,
            w: parseFloat(style.width) || visible.rect.width,
            h: parseFloat(style.height) || visible.rect.height,
            color: style.color,
            font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          });
        }
        if (shapes.length < shapeCap && visiblePaint(style)) {
          appendAtMost(
            shapes,
            shapeFragments(element, visible.rect, style, { pseudo }),
            shapeCap
          );
        }
      }
      if (!emittedPseudoGlyph && element.matches?.('svg')
        && shapes.length < shapeCap && !visiblePaint(visible.style)) {
        const halfWidth = visible.rect.width / 2;
        const halfHeight = visible.rect.height / 2;
        const fallback = [];
        for (let row = 0; row < 2; row += 1) {
          for (let column = 0; column < 2; column += 1) {
            fallback.push(paintedShape(
              element,
              visible.rect.left + halfWidth * column,
              visible.rect.top + halfHeight * row,
              halfWidth,
              halfHeight,
              visible.style.color
            ));
          }
        }
        appendAtMost(shapes, fallback, shapeCap);
      }
      if (shapes.length >= shapeCap && glyphs.length >= glyphCap) break;
    }
    return { glyphs, shapes };
  }

  function sampleAtMost(values, cap) {
    if (cap <= 0 || !values.length) return [];
    if (values.length <= cap) return values;
    if (cap === 1) return [values[Math.floor(values.length / 2)]];
    return sampleEvenly(values, cap);
  }

  function fairSampleGroups(groups, cap) {
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
    return records.flatMap(group => sampleAtMost(group.values, group.quota));
  }

  function extractCardVisuals(card, cap) {
    if (cap <= 0) return [];
    const paint = extractPaintVisuals(card, cap, cap);
    return fairSampleGroups([
      paint.shapes,
      extractImageVisuals(card, cap),
      paint.glyphs,
      extractCharacters(card, cap).map(item => ({
        ...item,
        kind: 'text'
      }))
    ], cap);
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
      context.fillText(particle.char, -particle.w / 2, -particle.h / 2);
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
      savedStyleAttribute: element.getAttribute('style'),
      savedVisibility: element.style.visibility,
      appliedStyleAttribute: null
    };
  }

  function hideVisibilityTarget(record) {
    record.element.style.visibility = 'hidden';
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
      record.element.style.visibility = record.savedVisibility;
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
      stepShrapnel(particle, dt, {
        drag: CONSTANTS.drag,
        gravity: CONSTANTS.gravity
      });
      const progress = particle.t / particle.duration;
      particle.opacity = progress > 0.5
        ? Math.max(0, 1 - (progress - 0.5) * 2)
        : 1;
      if (progress < 1) {
        complete = false;
        animation.drawCardVisual(context, particle);
      }
    }
    if (complete) animation.finish();
  }

  function makeCardAnimation(
    characters, clientX, clientY, durationScale, random,
    finish, resolve, drawCardVisual
  ) {
    const particles = characters.map(character => {
      const launch = inverseSquareLaunch(
        character.x + character.w / 2,
        character.y + character.h / 2,
        clientX,
        clientY,
        {
          force: CONSTANTS.cardForce,
          minimumDistance: 25,
          angularJitter: 0.35,
          upwardMinimum: 80,
          upwardRange: 120,
          random
        }
      );
      return {
        ...character,
        ...launch,
        rot: 0,
        av: (random() - 0.5) * 14,
        opacity: 1,
        t: 0,
        duration: (550 + random() * 150) * durationScale
      };
    });
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
        animation.drawCharacter(context, particle);
      }
    }
    if (complete) animation.finish();
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

  function createRuntime(options = {}) {
    const overlay = new CanvasOverlay();
    const random = options.random || Math.random;
    const watchdogMs = options.watchdogMs || 4000;
    const shouldRetainCardForeground = options.shouldRetainCardForeground
      || (() => false);
    const runtimeWindow = typeof window === 'undefined' ? globalThis : window;
    let primary = null;
    let confetti = [];
    let destroyed = false;
    let warned = false;
    let retainedCard = null;
    const tagRecords = new Set();

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

    function settlePrimary(record, outcome = 'resolve', error, options = {}) {
      if (!record || record.settled) return;
      record.settled = true;
      clearPrimaryWatchdog(record);
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
      record.cancelled = true;
      if (record.raf !== null) cancelAnimationFrame(record.raf);
      clearTimeout(record.timer);
      restoreTarget(record);
      tagRecords.delete(record);
    }

    function stopVisuals() {
      confetti = [];
      for (const record of [...tagRecords]) cancelTag(record);
      overlay.hide();
    }

    function failRuntime(error) {
      const record = primary;
      if (record) settlePrimary(record, 'reject', error);
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
          if (primary) primary.step(overlay.context, dt);
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

    function startPrimary(recordOptions, makeAnimation) {
      return new Promise((resolve, reject) => {
        let record;
        try {
          record = makeAnimation(
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
          ensureLoop();
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

    return {
      explodeCard(element, clientX, clientY, options = {}) {
        restoreRetainedCard();
        finishPrimary();
        const mobile = Boolean(options.mobile);
        const durationScale = mobile ? 180 / 625 : 1;
        const particles = extractCardVisuals(element, particleCap(mobile));
        if (!particles.length) return Promise.resolve();
        const targets = saveTargets(cardForegroundRoots(element));
        for (const target of targets) hideVisibilityTarget(target);
        return startPrimary({
          kind: 'card',
          retainOnResolve: true,
          targets
        }, (finish, resolve) => (
          makeCardAnimation(
            particles, clientX, clientY,
            durationScale, random, finish, resolve, drawCardVisual
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
        const target = saveTarget(element);
        element.style.visibility = 'hidden';
        return startPrimary({
          kind: 'code',
          retainOnResolve: false,
          target
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
          for (const existing of tagRecords) {
            if (existing.element === element) cancelTag(existing);
          }
          if (element === selected) continue;
          const record = saveTarget(element);
          record.cancelled = false;
          record.raf = null;
          record.timer = null;
          tagRecords.add(record);
          const rect = element.getBoundingClientRect();
          const vector = tagScatterVector({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          }, origin, random);
          const scale = options.mobile ? 0.65 : 1;
          element.style.transition = 'transform 0s';
          element.style.transform = `translate(${vector.x * scale}px, ${
            vector.y * scale
          }px) rotate(${vector.rotation * scale}deg)`;
          record.raf = requestAnimationFrame(() => {
            if (record.cancelled) return;
            record.raf = requestAnimationFrame(() => {
              if (record.cancelled) return;
              record.raf = null;
              element.style.transition = options.mobile
                ? 'transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)'
                : 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
              element.style.transform = '';
              record.timer = setTimeout(() => {
                restoreTarget(record);
                tagRecords.delete(record);
              }, options.mobile ? 340 : 620);
            });
          });
        }
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
      cancelAll(options = {}) {
        finishPrimary(options);
        if (!options.retainCardForeground) this.restoreRetainedCard();
        stopVisuals();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        this.cancelAll();
        if (typeof runtimeWindow.removeEventListener === 'function') {
          runtimeWindow.removeEventListener('resize', onResize);
        }
        overlay.destroy();
      }
    };
  }

  return {
    CONSTANTS,
    CanvasOverlay,
    inverseSquareLaunch,
    stepShrapnel,
    elasticOut,
    sampleEvenly,
    tagScatterVector,
    createConfettiParticle,
    stepConfettiParticle,
    advanceKonami,
    isEligibleLinkClick,
    isDoubleTap,
    isReportedError,
    extractCharacters,
    extractCardVisuals,
    drawCardVisual,
    createRuntime
  };
});
