'use strict';

(function() {
  if (window.__clawdEffects) return;

  const physics = window.ClawdPhysics;
  if (!physics) {
    console.warn('[Clawd effects] Physics module is unavailable; effects are disabled.');
    return;
  }

  const EFFECT_TRANSITION = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
  const IMPACT_LIFETIME_MS = 220;
  const MAX_IMPACT_BURSTS = 8;
  const IMPACT_GRAINS = 12;
  const GLYPH_SHAKE_MS = 320;
  const MAX_GLYPH_GROUPS = 3;
  const MAX_GLYPHS_PER_HIT = 9;
  const TARGET_ROOT_SELECTOR = '.header, .main-inner, .sidebar-inner';
  const CODE_LINE_TARGET_SELECTOR = '.post-body .highlight td.code .line';
  const GROUPED_TARGET_SELECTOR = [
    '.post-meta-container',
    '.post-body > pre',
    '.post-toc'
  ].join(', ');
  const INTERACTIVE_COLLISION_SELECTOR = [
    'a',
    'button',
    'summary',
    'label',
    '[role="button"]',
    '[role="link"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');
  const COLLISION_IGNORED_SELECTOR = [
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[data-clawd-ignore]',
    '[data-site-effects-ignore]',
    '.fancybox__container',
    '.search-popup',
    '.search-pop-overlay',
    '.site-search__overlay',
    '.comments',
    '.comment-container'
  ].join(', ');
  const INTERACTION_IGNORED_SELECTOR = [
    COLLISION_IGNORED_SELECTOR,
    INTERACTIVE_COLLISION_SELECTOR,
    '.highlight',
    '.post-body pre',
    '.post-title-link',
    '.post-button .btn'
  ].join(', ');

  function listenMediaQuery(query, listener) {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    }
    query.addListener(listener);
    return () => query.removeListener(listener);
  }

  class ClawdEffects {
    constructor() {
      this.active = false;
      this.canvas = null;
      this.context = null;
      this.canvasHasPixels = false;
      this.avatar = null;
      this.raf = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.pointerX = 0;
      this.pointerY = 0;
      this.lastMousePosition = null;
      this.clawdX = 0;
      this.clawdY = 0;
      this.previousPointerX = 0;
      this.previousPointerY = 0;
      this.facingAngle = 0;
      this.facingScale = 1;
      this.bullets = [];
      this.impactBursts = [];
      this.glyphGroups = new Set();
      this.graphemeSegmenter = null;
      this.targets = [];
      this.displacements = new Map();
      this.releaseRecords = new Set();
      this.mouseDown = false;
      this.touchGestureActive = false;
      this.holdStart = 0;
      this.lastFireTime = 0;
      this.lastFrameTime = 0;
      this.lastTargetRefresh = 0;
      this.lastActivationTime = 0;
      this.geometryDirty = true;
      this.warned = false;
      this.savedCursor = '';
      this.savedUserSelect = '';
      this.savedOverflow = '';
      this.pageState = null;
      this.activeInput = null;
      this.previousTouchEnd = 0;
      this.tapGesture = null;
      this.persistentActivationTimer = null;
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
      this.coarsePointer = window.matchMedia('(pointer: coarse)');
      try {
        this.persistent = localStorage.getItem('clawd-disabled') !== 'true';
      } catch (error) {
        this.persistent = true;
      }

      this._onDoubleClick = this._onDoubleClick.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseDown = this._onMouseDown.bind(this);
      this._onMouseUp = this._onMouseUp.bind(this);
      this._onTouchStart = this._onTouchStart.bind(this);
      this._onTouchMove = this._onTouchMove.bind(this);
      this._onTouchEnd = this._onTouchEnd.bind(this);
      this._onTouchCancel = this._onTouchCancel.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._onViewportChange = this._onViewportChange.bind(this);
      this._onVisibilityChange = this._onVisibilityChange.bind(this);
      this._onMediaChange = this._onMediaChange.bind(this);
      this._onPjaxSend = this._onPjaxSend.bind(this);
      this._onPjaxSuccess = this._onPjaxSuccess.bind(this);
      this._stepFrame = this._stepFrame.bind(this);

      document.addEventListener('dblclick', this._onDoubleClick);
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mousedown', this._onMouseDown);
      document.addEventListener('mouseup', this._onMouseUp);
      document.addEventListener('touchstart', this._onTouchStart, { passive: false });
      document.addEventListener('touchmove', this._onTouchMove, { passive: false });
      document.addEventListener('touchend', this._onTouchEnd, { passive: false });
      document.addEventListener('touchcancel', this._onTouchCancel);
      document.addEventListener('keydown', this._onKeyDown);
      document.addEventListener('visibilitychange', this._onVisibilityChange);
      document.addEventListener('pjax:send', this._onPjaxSend);
      document.addEventListener('pjax:success', this._onPjaxSuccess);
      window.addEventListener('resize', this._onViewportChange);
      window.addEventListener('scroll', this._onViewportChange, { passive: true });
      window.addEventListener('blur', this._onMouseUp);
      this.removeReducedMotionListener = listenMediaQuery(
        this.reducedMotion,
        this._onMediaChange
      );
      this.removeFinePointerListener = listenMediaQuery(
        this.finePointer,
        this._onMediaChange
      );
      this.removeCoarsePointerListener = listenMediaQuery(
        this.coarsePointer,
        this._onMediaChange
      );

      if (this.persistent && this.finePointer.matches) {
        this._schedulePersistentActivation();
      }
    }

    _canActivate(input = 'mouse') {
      if (this.reducedMotion.matches) return false;
      return input === 'touch' ? this.coarsePointer.matches : this.finePointer.matches;
    }

    _isIgnoredTarget(target) {
      return target instanceof Element && (
        target.isContentEditable
        || Boolean(target.closest(INTERACTION_IGNORED_SELECTOR))
      );
    }

    _warn(error) {
      if (this.warned) return;
      this.warned = true;
      console.warn('[Clawd effects] Effects are disabled after an initialization error.', error);
    }

    _ensureLayers() {
      if (this.canvas && this.avatar) return;

      this.canvas = document.createElement('canvas');
      this.canvas.dataset.clawdLayer = '';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.canvas.style.cssText = [
        'position:fixed',
        'inset:0',
        'width:100vw',
        'height:100vh',
        'pointer-events:none',
        'z-index:9998',
        'display:none'
      ].join(';');
      this.context = this.canvas.getContext('2d');
      if (!this.context) throw new Error('Canvas 2D context is unavailable');

      this.avatar = document.createElement('img');
      this.avatar.src = '/images/clawd-walking.svg';
      this.avatar.alt = '';
      this.avatar.dataset.clawdAvatar = '';
      this.avatar.setAttribute('aria-hidden', 'true');
      this.avatar.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        'width:100px',
        'height:100px',
        'pointer-events:none',
        'z-index:9999',
        'display:none',
        'opacity:0',
        'will-change:transform',
        'image-rendering:pixelated'
      ].join(';');

      document.documentElement.append(this.canvas, this.avatar);
      this._resizeCanvas();
    }


    _resizeCanvas() {
      if (!this.canvas || !this.context) return;
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvasHasPixels = false;
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _prepareTextTargets() {
      for (const postBody of document.querySelectorAll('.post-body')) {
        for (const node of [...postBody.childNodes]) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const wrapper = document.createElement('div');
          wrapper.dataset.clawdTextTarget = '';
          postBody.replaceChild(wrapper, node);
          wrapper.append(node);
        }
      }
      for (const line of document.querySelectorAll(CODE_LINE_TARGET_SELECTOR)) {
        line.dataset.clawdCodeLine = '';
      }
    }

    _collectTargets() {
      const roots = [...document.querySelectorAll(TARGET_ROOT_SELECTOR)];
      if (roots.length === 0) return [];
      this._prepareTextTargets();

      const candidates = new Set();
      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let textNode;

        while ((textNode = walker.nextNode())) {
          if (!textNode.textContent.trim()) continue;
          const element = textNode.parentElement;
          if (!element || element.closest(COLLISION_IGNORED_SELECTOR)) continue;
          if (element.closest('script, style, noscript, svg, canvas')) continue;
          candidates.add(element.closest(INTERACTIVE_COLLISION_SELECTOR) || element);
        }
      }

      for (const control of document.querySelectorAll(INTERACTIVE_COLLISION_SELECTOR)) {
        if (!control.closest(COLLISION_IGNORED_SELECTOR)) candidates.add(control);
      }

      for (const element of document.querySelectorAll(GROUPED_TARGET_SELECTOR)) {
        if (element.closest(TARGET_ROOT_SELECTOR) && !element.querySelector(INTERACTIVE_COLLISION_SELECTOR)) {
          candidates.add(element);
        }
      }

      for (const line of document.querySelectorAll(CODE_LINE_TARGET_SELECTOR)) {
        if (line.textContent.trim()) candidates.add(line);
      }

      return [...candidates]
        .filter(element => {
          const root = element.closest(TARGET_ROOT_SELECTOR) || document.body;
          if (element === root) return false;
          let ancestor = element.parentElement;
          while (ancestor && ancestor !== root) {
            if (candidates.has(ancestor)
              && !(element.matches(INTERACTIVE_COLLISION_SELECTOR)
                && ancestor.matches('p')
                && ancestor.closest('.post-body, .writing-content'))) return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        })
        .filter(element => {
          if (!element.matches(INTERACTIVE_COLLISION_SELECTOR)
            && element.querySelector(INTERACTIVE_COLLISION_SELECTOR)
            && !(element.matches('p') && element.closest('.post-body, .writing-content'))) return false;
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const interactive = element.matches(INTERACTIVE_COLLISION_SELECTOR);
          if (!interactive && (style.position === 'fixed' || style.position === 'sticky')) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0
            && rect.height > 0
            && rect.top < window.innerHeight + 200
            && rect.bottom > -200;
        })
        .map(element => ({
          element,
          interactive: element.matches(INTERACTIVE_COLLISION_SELECTOR),
          rect: null
        }));
    }

    _refreshGeometry(recollect) {
      if (recollect) this.targets = this._collectTargets();

      this.targets = this.targets.filter(target => {
        if (!target.element.isConnected) return false;
        const rect = target.element.getBoundingClientRect();
        const state = this.displacements.get(target.element);
        const dx = state ? state.dx : 0;
        const dy = state ? state.dy : 0;
        target.rect = {
          left: rect.left - dx,
          top: rect.top - dy,
          right: rect.right - dx,
          bottom: rect.bottom - dy
        };
        return rect.width > 0
          && rect.height > 0
          && rect.top < window.innerHeight + 200
          && rect.bottom > -200;
      });
      this.geometryDirty = false;
    }

    _flushReleases() {
      for (const record of [...this.releaseRecords]) this._finishRelease(record);
    }

    _finishRelease(record) {
      if (record.finished) return;
      record.finished = true;
      window.clearTimeout(record.timer);
      this.releaseRecords.delete(record);
      this._restoreSavedStyles(record);
    }

    _restoreSavedStyles(record) {
      const element = record.element;
      const currentStyleAttribute = element.getAttribute('style');
      if (!record.styleDiverged && currentStyleAttribute === record.appliedStyleAttribute) {
        if (record.savedStyleAttribute === null) {
          element.removeAttribute('style');
        } else {
          element.setAttribute('style', record.savedStyleAttribute);
        }
      } else {
        element.style.transform = record.savedTransform;
        element.style.transition = record.savedTransition;
        element.style.willChange = record.savedWillChange;
      }
      element.removeAttribute('data-clawd-impacted');
    }

    _capturePageState() {
      const html = document.documentElement;
      const body = document.body;
      this.savedCursor = html.style.cursor;
      this.savedUserSelect = html.style.userSelect;
      this.savedOverflow = html.style.overflow;
      this.pageState = {
        html,
        body,
        htmlStyleAttribute: html.getAttribute('style'),
        bodyStyleAttribute: body ? body.getAttribute('style') : null,
        htmlStyles: {
          cursor: html.style.cursor,
          userSelect: html.style.userSelect,
          overflow: html.style.overflow,
          touchAction: html.style.touchAction
        },
        bodyStyles: body ? {
          overflow: body.style.overflow,
          touchAction: body.style.touchAction
        } : null,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        htmlAppliedStyleAttribute: null,
        bodyAppliedStyleAttribute: null,
        touchMode: false,
        hadActiveClass: html.classList.contains('clawd-effects-active')
      };
    }

    _markPageStateApplied(touchMode) {
      if (!this.pageState) return;
      this.pageState.touchMode = touchMode;
      this.pageState.htmlAppliedStyleAttribute = this.pageState.html.getAttribute('style');
      this.pageState.bodyAppliedStyleAttribute = this.pageState.body
        ? this.pageState.body.getAttribute('style')
        : null;
    }

    _restoreElementStyles(element, originalAttribute, appliedAttribute, currentAttribute, styles) {
      if (currentAttribute === appliedAttribute) {
        if (originalAttribute === null) {
          element.removeAttribute('style');
        } else {
          element.setAttribute('style', originalAttribute);
        }
        return;
      }
      for (const [property, value] of Object.entries(styles)) {
        element.style[property] = value;
      }
    }

    _restorePageState() {
      const state = this.pageState;
      if (!state) return;

      const currentHtmlStyleAttribute = state.html.getAttribute('style');
      const currentBodyStyleAttribute = state.body ? state.body.getAttribute('style') : null;
      if (state.touchMode) {
        document.documentElement.style.overflow = this.savedOverflow;
      }
      const htmlStyles = state.touchMode
        ? state.htmlStyles
        : {
            cursor: state.htmlStyles.cursor,
            userSelect: state.htmlStyles.userSelect
          };
      this._restoreElementStyles(
        state.html,
        state.htmlStyleAttribute,
        state.htmlAppliedStyleAttribute,
        currentHtmlStyleAttribute,
        htmlStyles
      );
      if (state.body && state.touchMode) {
        this._restoreElementStyles(
          state.body,
          state.bodyStyleAttribute,
          state.bodyAppliedStyleAttribute,
          currentBodyStyleAttribute,
          state.bodyStyles
        );
      }
      if (state.touchMode) {
        try {
          window.scrollTo(state.scrollX, state.scrollY);
        } catch {
          // Scroll restoration is best effort; owned teardown must still finish.
        }
      }
      if (state.hadActiveClass) {
        state.html.classList.add('clawd-effects-active');
      } else {
        state.html.classList.remove('clawd-effects-active');
      }
      this.pageState = null;
    }

    _createDisplacement(element) {
      const state = {
        element,
        dx: 0,
        dy: 0,
        vx: 0,
        vy: 0,
        atRest: false,
        hadStyleAttribute: element.hasAttribute('style'),
        savedStyleAttribute: element.getAttribute('style'),
        savedTransform: element.style.transform,
        savedTransition: element.style.transition,
        savedWillChange: element.style.willChange,
        appliedStyleAttribute: null,
        styleDiverged: false
      };
      element.dataset.clawdImpacted = '';
      element.style.transition = 'none';
      element.style.willChange = 'transform';
      state.appliedStyleAttribute = element.getAttribute('style');
      this.displacements.set(element, state);
      return state;
    }

    _restoreDisplacement(state, animate) {
      this.displacements.delete(state.element);
      if (!state.element.isConnected) {
        this._restoreSavedStyles(state);
        return;
      }

      if (!animate) {
        this._restoreSavedStyles(state);
        return;
      }

      if (state.element.getAttribute('style') !== state.appliedStyleAttribute) {
        state.styleDiverged = true;
      }
      state.element.style.transition = EFFECT_TRANSITION;
      state.element.style.transform = state.savedTransform;
      state.element.removeAttribute('data-clawd-impacted');
      const record = {
        element: state.element,
        hadStyleAttribute: state.hadStyleAttribute,
        savedStyleAttribute: state.savedStyleAttribute,
        savedTransform: state.savedTransform,
        savedTransition: state.savedTransition,
        savedWillChange: state.savedWillChange,
        appliedStyleAttribute: state.element.getAttribute('style'),
        styleDiverged: state.styleDiverged,
        finished: false,
        timer: 0
      };
      record.timer = window.setTimeout(() => this._finishRelease(record), 520);
      this.releaseRecords.add(record);
    }

    _spawnBullet(now) {
      const profile = physics.getFireProfile(now - this.holdStart);
      const angle = this.facingAngle + (Math.random() - 0.5) * profile.spread;
      this.bullets.push(physics.createBullet(this.clawdX, this.clawdY - 5, angle));
      return 1000 / profile.rate;
    }

    _spawnImpact(bullet, target, now) {
      if (bullet.sparked) return;
      bullet.sparked = true;
      if (this.impactBursts.length === MAX_IMPACT_BURSTS) this.impactBursts.shift();
      this.impactBursts.push({
        x: Math.min(Math.max(bullet.x, target.rect.left), target.rect.right),
        y: Math.min(Math.max(bullet.y, target.rect.top), target.rect.bottom),
        angle: Math.atan2(bullet.vy || 0, bullet.vx || 0),
        at: now
      });
    }

    _restoreGlyphGroup(group) {
      if (!this.glyphGroups.delete(group)) return;
      window.clearTimeout(group.timer);
      for (const animation of group.animations) animation.cancel();
      if (!group.wrapper.isConnected) return;
      if (group.prefix.nextSibling === group.wrapper
        && group.wrapper.nextSibling === group.suffix) {
        group.prefix.data += group.wrapper.textContent + group.suffix.data;
        group.wrapper.remove();
        group.suffix.remove();
      } else {
        group.wrapper.replaceWith(document.createTextNode(group.wrapper.textContent));
      }
    }

    _flushGlyphGroups() {
      for (const group of this.glyphGroups) this._restoreGlyphGroup(group);
    }

    _shakeNearbyGlyphs(target, bullet) {
      const element = target.element;
      if (typeof element.matches !== 'function'
        || !element.matches('p, h1, h2, h3, h4, li, blockquote')
        || !element.closest('.post-body, .writing-content')
        || typeof document.caretPositionFromPoint !== 'function'
        || typeof Intl.Segmenter !== 'function') return false;
      if (bullet.textShaken) return true;
      bullet.textShaken = true;
      if (document.getSelection()?.isCollapsed === false) return true;
      if (this.glyphGroups.size >= MAX_GLYPH_GROUPS) return true;
      for (const group of this.glyphGroups) {
        if (group.parent === element) return true;
      }

      const x = Math.min(Math.max(bullet.x, target.rect.left + 1), target.rect.right - 1);
      const y = Math.min(Math.max(bullet.y, target.rect.top + 1), target.rect.bottom - 1);
      const caret = document.caretPositionFromPoint(x, y);
      const node = caret?.offsetNode;
      if (node?.nodeType !== Node.TEXT_NODE || node.parentElement !== element || !node.data.trim()) {
        return true;
      }

      const previous = [];
      const next = [];
      this.graphemeSegmenter ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const segments = this.graphemeSegmenter.segment(node.data);
      for (const glyph of segments) {
        if (glyph.index < caret.offset) {
          if (previous.length === 4) previous.shift();
          previous.push(glyph);
        } else {
          next.push(glyph);
          if (next.length === MAX_GLYPHS_PER_HIT - 4) break;
        }
      }
      const nearby = previous.concat(next);
      const range = document.createRange();
      const hits = [];
      for (const glyph of nearby) {
        range.setStart(node, glyph.index);
        range.setEnd(node, glyph.index + glyph.segment.length);
        const rect = range.getBoundingClientRect();
        const dx = Math.max(rect.left - bullet.x, 0, bullet.x - rect.right);
        const dy = Math.max(rect.top - bullet.y, 0, bullet.y - rect.bottom);
        if (Math.hypot(dx, dy) < physics.CONSTANTS.hitRadius) hits.push(glyph);
      }
      if (hits.length === 0) return true;

      const start = hits[0].index;
      const end = hits[hits.length - 1].index + hits[hits.length - 1].segment.length;
      const wrapper = document.createElement('span');
      if (typeof wrapper.animate !== 'function') return true;
      wrapper.dataset.clawdIgnore = '';
      const prefix = node;
      const middle = node.splitText(start);
      const suffix = middle.splitText(end - start);
      middle.replaceWith(wrapper);
      const group = { parent: element, prefix, suffix, wrapper, animations: [], timer: 0 };
      this.glyphGroups.add(group);
      for (const glyph of nearby) {
        if (glyph.index < start || glyph.index >= end) continue;
        if (!glyph.segment.trim()) {
          wrapper.append(glyph.segment);
          continue;
        }
        const span = document.createElement('span');
        span.dataset.clawdGlyph = '';
        span.textContent = glyph.segment;
        span.style.display = 'inline-block';
        wrapper.append(span);
        if (!hits.includes(glyph)) continue;
        const direction = glyph.index % 2 === 0 ? 1 : -1;
        group.animations.push(span.animate([
          { transform: 'translate(0, 0) rotate(0deg)' },
          { transform: `translate(${direction * 7}px, -7px) rotate(${direction * 4}deg)`, offset: 0.3 },
          { transform: `translate(${-direction * 3}px, 3px) rotate(${-direction * 2}deg)`, offset: 0.7 },
          { transform: 'translate(0, 0) rotate(0deg)' }
        ], { duration: GLYPH_SHAKE_MS, easing: 'ease-out' }));
      }
      group.timer = window.setTimeout(() => this._restoreGlyphGroup(group), GLYPH_SHAKE_MS);
      return true;
    }

    _draw() {
      if (this.bullets.length === 0 && this.impactBursts.length === 0 && !this.canvasHasPixels) return;
      const context = this.context;
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      context.clearRect(0, 0, this.width, this.height);
      this.canvasHasPixels = this.bullets.length > 0 || this.impactBursts.length > 0;

      for (const bullet of this.bullets) {
        if (bullet.impactAt !== undefined) {
          const progress = Math.min((this.lastFrameTime - bullet.impactAt) / 240, 1);
          context.globalAlpha = 1 - progress;
          context.strokeStyle = '#f40';
          context.lineWidth = 1.25;
          context.beginPath();
          context.arc(bullet.x, bullet.y, 3 + progress * 7, 0, Math.PI * 2);
          context.stroke();
          continue;
        }
        const opacity = Math.min((bullet.life / bullet.maxLife) * 2, 1);
        context.globalAlpha = opacity;
        context.fillStyle = '#ffa657';
        context.beginPath();
        context.arc(bullet.x, bullet.y, 2.5, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = opacity * 0.18;
        context.beginPath();
        context.arc(bullet.x, bullet.y, 6, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = '#f40';
      for (const burst of this.impactBursts) {
        const progress = (this.lastFrameTime - burst.at) / IMPACT_LIFETIME_MS;
        if (progress <= 0) continue;
        context.globalAlpha = (1 - progress) * (1 - progress) * 0.85;
        for (let index = 0; index < IMPACT_GRAINS; index += 1) {
          const angle = burst.angle - 1.4 + index * 2.8 / (IMPACT_GRAINS - 1);
          const distance = (8 + index % 3 * 4) * progress;
          const size = index % 3 === 0 ? 1.4 : 1;
          context.fillRect(
            burst.x + Math.cos(angle) * distance,
            burst.y + Math.sin(angle) * distance + 4 * progress * progress,
            size, size
          );
        }
      }
      context.globalAlpha = 1;
    }

    _stepFrame(now) {
      if (!this.active || document.hidden) return;
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
      this.lastFrameTime = now;

      if (
        this.geometryDirty
        || (this.targets.length === 0 && now - this.lastTargetRefresh > 250)
      ) {
        this._refreshGeometry(true);
        this.lastTargetRefresh = now;
      }

      if (this.activeInput === 'touch') {
        const follow = 1 - Math.exp(-dt / 0.05);
        this.clawdX += (this.pointerX - this.clawdX) * follow;
        this.clawdY += (this.pointerY - this.clawdY) * follow;
      }
      const movementX = this.pointerX - this.previousPointerX;
      const movementY = this.pointerY - this.previousPointerY;
      if (Math.hypot(movementX, movementY) > 1.5) {
        this.facingAngle = Math.atan2(movementY, movementX);
        this.facingScale = movementX < 0 ? 1 : -1;
        this.previousPointerX = this.pointerX;
        this.previousPointerY = this.pointerY;
      }
      this.avatar.style.transform = `translate3d(${this.clawdX - 50}px, ${this.clawdY - 78}px, 0) scaleX(${this.facingScale})`;

      if (this.mouseDown) {
        const profile = physics.getFireProfile(now - this.holdStart);
        const interval = 1000 / profile.rate;
        if (!this.lastFireTime) this.lastFireTime = now - interval;
        while (now - this.lastFireTime >= interval) {
          this.lastFireTime += this._spawnBullet(now);
        }
      } else {
        this.lastFireTime = 0;
      }

      for (let index = this.impactBursts.length - 1; index >= 0; index -= 1) {
        if (now - this.impactBursts[index].at >= IMPACT_LIFETIME_MS) {
          this.impactBursts.splice(index, 1);
        }
      }
      this.bullets = this.bullets.filter(bullet => {
        if (bullet.impactAt !== undefined) return now - bullet.impactAt < 240;
        if (!physics.stepBullet(bullet, dt, this.width, this.height)) return false;

        for (const target of this.targets) {
          const distance = physics.circleRectDistance(bullet.x, bullet.y, target.rect);
          if (distance >= physics.CONSTANTS.hitRadius) continue;
          this._spawnImpact(bullet, target, now);
          if (target.interactive) {
            bullet.impactAt = now;
            return true;
          }
          if (this._shakeNearbyGlyphs(target, bullet)) continue;
          const centerX = (target.rect.left + target.rect.right) / 2;
          const centerY = (target.rect.top + target.rect.bottom) / 2;
          const angle = Math.atan2(centerY - bullet.y, centerX - bullet.x);
          const magnitude = (1 - distance / physics.CONSTANTS.hitRadius)
            * 30 * dt * physics.CONSTANTS.impulseScale;
          const state = this.displacements.get(target.element)
            || this._createDisplacement(target.element);
          physics.addImpulse(state, angle, magnitude);
        }
        return true;
      });

      for (const state of [...this.displacements.values()]) {
        if (!state.element.isConnected) {
          this._restoreDisplacement(state, false);
          continue;
        }
        physics.stepDisplacement(state);
        if (state.atRest) {
          this._restoreDisplacement(state, false);
          continue;
        }
        if (state.element.getAttribute('style') !== state.appliedStyleAttribute) {
          state.styleDiverged = true;
        }
        state.element.style.transition = 'none';
        state.element.style.transform = `translate(${state.dx.toFixed(1)}px, ${state.dy.toFixed(1)}px) ${state.savedTransform}`.trim();
        state.appliedStyleAttribute = state.element.getAttribute('style');
      }

      this._draw();
      this.raf = window.requestAnimationFrame(this._stepFrame);
    }

    activate(x, y, input = 'mouse') {
      if (this.active || !this._canActivate(input)) return false;

      try {
        this._cancelPersistentActivation();
        this._ensureLayers();
        this._capturePageState();
        this.active = true;
        this.activeInput = input;
        this.pointerX = x;
        this.pointerY = y;
        this.clawdX = x;
        this.clawdY = y;
        this.previousPointerX = x;
        this.previousPointerY = y;
        this.facingAngle = 0;
        this.facingScale = 1;
        this.bullets = [];
        this.mouseDown = false;
        this.impactBursts.length = 0;
        this.lastFireTime = 0;
        this.lastTargetRefresh = 0;
        document.documentElement.style.cursor = 'none';
        if (input === 'touch') {
          document.documentElement.style.userSelect = 'none';
          document.documentElement.style.overflow = 'hidden';
          document.documentElement.style.touchAction = 'none';
          if (document.body) {
            document.body.style.overflow = 'hidden';
            document.body.style.touchAction = 'none';
          }
        }
        document.documentElement.classList.add('clawd-effects-active');
        this._markPageStateApplied(input === 'touch');
        this._resizeCanvas();
        this.targets = this._collectTargets();
        this._refreshGeometry(false);
        this.canvas.style.display = 'block';
        this.avatar.style.display = 'block';
        this.avatar.style.transform = `translate3d(${x - 50}px, ${y - 78}px, 0) scaleX(1)`;
        this.avatar.style.opacity = '1';
        this.lastFrameTime = performance.now();
        this.raf = window.requestAnimationFrame(this._stepFrame);
        this.lastActivationTime = Date.now();
        return true;
      } catch (error) {
        this.deactivate(false);
        this._warn(error);
        return false;
      }
    }

    deactivate(animate = true) {
      this._flushGlyphGroups();
      if (!this.active && this.displacements.size === 0) {
        if (!animate && this.avatar) {
          this.avatar.style.opacity = '0';
          this.avatar.style.display = 'none';
        }
        return;
      }
      this.active = false;
      this.activeInput = null;
      this.mouseDown = false;
      this.touchGestureActive = false;
      this.tapGesture = null;
      this.bullets = [];
      this.impactBursts.length = 0;
      if (this.raf) window.cancelAnimationFrame(this.raf);
      this.raf = null;
      if (this.avatar) {
        this.avatar.style.opacity = '0';
        this.avatar.style.display = 'none';
      }
      this._restorePageState();

      if (this.context) {
        this.context.clearRect(0, 0, this.width, this.height);
        this.canvasHasPixels = false;
      }
      if (this.canvas) this.canvas.style.display = 'none';

      for (const state of [...this.displacements.values()]) {
        this._restoreDisplacement(state, animate);
      }
      this.targets = [];
    }

    startShooting() {
      if (!this.active) return;
      this.mouseDown = true;
      this.holdStart = performance.now();
      this.lastFireTime = 0;
    }

    stopShooting() {
      this.mouseDown = false;
    }

    _onTouchStart(event) {
      if (!this.coarsePointer.matches) {
        this.tapGesture = null;
        this.previousTouchEnd = 0;
        return;
      }
      const touch = event.touches[0];
      if (!touch || this._isIgnoredTarget(event.target)) {
        this.tapGesture = null;
        this.previousTouchEnd = 0;
        return;
      }
      this.tapGesture = {
        startedAt: Date.now(),
        x: touch.clientX,
        y: touch.clientY
      };
      if (!this.active) return;
      event.preventDefault();
      this.touchGestureActive = true;
      this.pointerX = touch.clientX;
      this.pointerY = touch.clientY;
      this.startShooting();
    }

    _onTouchMove(event) {
      const touch = event.touches[0];
      if (!touch) return;
      if (this.tapGesture && Math.hypot(
        touch.clientX - this.tapGesture.x,
        touch.clientY - this.tapGesture.y
      ) > 12) {
        this.tapGesture = null;
        this.previousTouchEnd = 0;
      }
      if (!this.active || !this.coarsePointer.matches) return;
      event.preventDefault();
      this.pointerX = touch.clientX;
      this.pointerY = touch.clientY;
    }

    _onTouchEnd(event) {
      this.stopShooting();
      this.touchGestureActive = false;
      if (!this.coarsePointer.matches) {
        this.tapGesture = null;
        this.previousTouchEnd = 0;
        return;
      }
      const gesture = this.tapGesture;
      this.tapGesture = null;
      const touch = event.changedTouches[0];
      const now = Date.now();
      if (!gesture || !touch
        || now - gesture.startedAt > 500
        || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12) {
        this.previousTouchEnd = 0;
        return;
      }
      if (!this.active && !this._canActivate('touch')) return;
      const result = window.SiteParticleEffects.isDoubleTap(
        this.previousTouchEnd,
        now,
        this.lastActivationTime
      );
      if (result.doubleTap) {
        event.preventDefault();
        if (this.active) {
          if (result.mayDeactivate) this.deactivate();
        } else {
          if (this.activate(touch.clientX, touch.clientY, 'touch')) {
            window.__siteEffects?.cancelPendingNavigation?.();
            this.lastActivationTime = now;
          }
        }
        this.previousTouchEnd = 0;
      } else {
        this.previousTouchEnd = now;
      }
    }

    _onTouchCancel() {
      this.stopShooting();
      this.touchGestureActive = false;
      this.tapGesture = null;
      this.previousTouchEnd = 0;
    }

    _onDoubleClick(event) {
      if (this._isIgnoredTarget(event.target)) return;
      if (!this.active && !this._canActivate()) return;
      event.preventDefault();

      if (this.active) {
        if (Date.now() - this.lastActivationTime > 500) {
          this.setPersistent(false);
        }
        return;
      }
      this.setPersistent(true, event.clientX, event.clientY, 'mouse');
    }

    _onMouseMove(event) {
      this._rememberMousePosition(event);
      if (!this.active) {
        if (this.persistent && this.finePointer.matches && this.lastMousePosition) {
          this.activate(this.lastMousePosition.x, this.lastMousePosition.y, 'mouse');
        }
        return;
      }
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      if (this.activeInput === 'mouse') {
        this.clawdX = event.clientX;
        this.clawdY = event.clientY;
        this.avatar.style.transform = `translate3d(${this.clawdX - 50}px, ${this.clawdY - 78}px, 0) scaleX(${this.facingScale})`;
      }
    }

    _onMouseDown(event) {
      if (event.button !== 0) return;
      if (this._isIgnoredTarget(event.target)) return;
      this._rememberMousePosition(event);
      if (!this.active) return;
      event.preventDefault();
      this.startShooting();
    }

    _rememberMousePosition(event) {
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      this.lastMousePosition = { x: event.clientX, y: event.clientY };
    }

    _onMouseUp() {
      this.stopShooting();
    }

    _onKeyDown(event) {
      if (!this.active || event.key !== 'Escape') return;
      event.preventDefault();
      this.deactivate();
    }

    _onViewportChange() {
      if (!this.active) return;
      this.geometryDirty = true;
      this._resizeCanvas();
    }

    _onVisibilityChange() {
      if (!this.active) return;
      if (document.hidden) {
        this._flushGlyphGroups();
        if (this.raf) window.cancelAnimationFrame(this.raf);
        this.raf = null;
        this.stopShooting();
        this.touchGestureActive = false;
        this.tapGesture = null;
        this.previousTouchEnd = 0;
        return;
      }
      if (!this.raf) {
        this.lastFrameTime = performance.now();
        this.raf = window.requestAnimationFrame(this._stepFrame);
      }
    }

    _onMediaChange() {
      this.stopShooting();
      this.touchGestureActive = false;
      this.tapGesture = null;
      this.previousTouchEnd = 0;
      const hasPointer = this.finePointer.matches || this.coarsePointer.matches;
      const inputUnavailable = this.activeInput && !this._canActivate(this.activeInput);
      if (this.reducedMotion.matches || !hasPointer || inputUnavailable) {
        this.deactivate(false);
      }
      if (this.persistent && this.finePointer.matches
        && !this.active && !this.reducedMotion.matches) {
        this._schedulePersistentActivation();
      }
    }

    _onPjaxSend() {
      this._cancelPersistentActivation();
      this.tapGesture = null;
      this.previousTouchEnd = 0;
      this._flushReleases();
      this.deactivate(false);
    }

    _onPjaxSuccess() {
      this.geometryDirty = true;
      if (this.persistent && this.finePointer.matches) {
        this._schedulePersistentActivation();
      }
    }

    _cancelPersistentActivation() {
      if (this.persistentActivationTimer === null) return;
      window.clearTimeout(this.persistentActivationTimer);
      this.persistentActivationTimer = null;
    }

    _schedulePersistentActivation() {
      this._cancelPersistentActivation();
      if (!this.lastMousePosition) return;
      this.persistentActivationTimer = window.setTimeout(() => {
        this.persistentActivationTimer = null;
        if (!this.persistent || this.active || !this.finePointer.matches) return;
        const position = this.lastMousePosition;
        if (position) this.activate(position.x, position.y, 'mouse');
      }, 0);
    }

    setPersistent(
      enabled,
      x = innerWidth / 2,
      y = innerHeight / 2,
      input = this.coarsePointer.matches ? 'touch' : 'mouse'
    ) {
      this.persistent = Boolean(enabled);
      try {
        if (this.persistent) {
          localStorage.removeItem('clawd-disabled');
        } else {
          localStorage.setItem('clawd-disabled', 'true');
        }
      } catch (error) {
        // Persistence can be unavailable in privacy-restricted browsing modes.
      }

      if (this.persistent) {
        if (!this.active) this.activate(x, y, input);
      } else {
        this._cancelPersistentActivation();
        this.deactivate();
      }
      return this.persistent;
    }

    togglePersistent() {
      return this.setPersistent(!this.persistent);
    }

    destroy() {
      this._cancelPersistentActivation();
      this._flushReleases();
      this.deactivate(false);
      document.removeEventListener('dblclick', this._onDoubleClick);
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mousedown', this._onMouseDown);
      document.removeEventListener('mouseup', this._onMouseUp);
      document.removeEventListener('touchstart', this._onTouchStart);
      document.removeEventListener('touchmove', this._onTouchMove);
      document.removeEventListener('touchend', this._onTouchEnd);
      document.removeEventListener('touchcancel', this._onTouchCancel);
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.removeEventListener('pjax:send', this._onPjaxSend);
      document.removeEventListener('pjax:success', this._onPjaxSuccess);
      window.removeEventListener('resize', this._onViewportChange);
      window.removeEventListener('scroll', this._onViewportChange);
      window.removeEventListener('blur', this._onMouseUp);
      this.removeReducedMotionListener();
      this.removeFinePointerListener();
      this.removeCoarsePointerListener();
      this.canvas?.remove();
      this.avatar?.remove();
    }
  }

  window.__clawdEffects = new ClawdEffects();
})();
