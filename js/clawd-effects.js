'use strict';

(function() {
  if (window.__clawdEffects) return;

  const physics = window.ClawdPhysics;
  if (!physics) {
    console.warn('[Clawd effects] Physics module is unavailable; effects are disabled.');
    return;
  }

  const EFFECT_TRANSITION = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
  const IGNORED_SELECTOR = [
    'input',
    'textarea',
    'select',
    'button',
    '[contenteditable="true"]',
    '[data-clawd-ignore]',
    '[data-site-effects-ignore]',
    '.fancybox__container',
    '.search-popup',
    '.search-pop-overlay',
    '.highlight',
    '.post-body pre',
    '.comments',
    '.comment-container'
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
      this.avatar = null;
      this.raf = null;
      this.avatarOpacityRaf = null;
      this.avatarHideTimer = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.pointerX = 0;
      this.pointerY = 0;
      this.clawdX = 0;
      this.clawdY = 0;
      this.previousPointerX = 0;
      this.previousPointerY = 0;
      this.facingAngle = 0;
      this.bullets = [];
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
        this.persistent = localStorage.getItem('clawd-permanent') === 'true';
      } catch (error) {
        this.persistent = false;
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

      if (this.persistent) this._schedulePersistentActivation();
    }

    _canActivate(input = 'mouse') {
      if (this.reducedMotion.matches) return false;
      return input === 'touch' ? this.coarsePointer.matches : this.finePointer.matches;
    }

    _isIgnoredTarget(target) {
      return target instanceof Element && (
        target.isContentEditable
        || Boolean(target.closest(IGNORED_SELECTOR))
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
        'width:100px',
        'height:100px',
        'pointer-events:none',
        'z-index:9999',
        'display:none',
        'opacity:0',
        'transition:opacity 0.3s ease',
        'image-rendering:pixelated'
      ].join(';');

      document.documentElement.append(this.canvas, this.avatar);
      this._resizeCanvas();
    }

    _cancelAvatarCallbacks() {
      if (this.avatarOpacityRaf !== null) {
        window.cancelAnimationFrame(this.avatarOpacityRaf);
        this.avatarOpacityRaf = null;
      }
      if (this.avatarHideTimer !== null) {
        window.clearTimeout(this.avatarHideTimer);
        this.avatarHideTimer = null;
      }
    }

    _resizeCanvas() {
      if (!this.canvas || !this.context) return;
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _collectTargets() {
      const content = document.querySelector('.main-inner');
      if (!content) return [];

      const candidates = new Set();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let textNode;

      while ((textNode = walker.nextNode())) {
        if (!textNode.textContent.trim()) continue;
        const element = textNode.parentElement;
        if (!element || element.closest(IGNORED_SELECTOR)) continue;
        if (element.closest('script, style, noscript, svg, canvas')) continue;
        candidates.add(element);
      }

      return [...candidates]
        .filter(element => {
          let ancestor = element.parentElement;
          while (ancestor && ancestor !== content) {
            if (candidates.has(ancestor)) return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        })
        .filter(element => {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (style.position === 'fixed' || style.position === 'sticky') return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0
            && rect.height > 0
            && rect.top < window.innerHeight + 200
            && rect.bottom > -200;
        })
        .map(element => ({ element, rect: null }));
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

    _draw() {
      const context = this.context;
      context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      context.clearRect(0, 0, this.width, this.height);

      for (const bullet of this.bullets) {
        const opacity = Math.min((bullet.life / bullet.maxLife) * 2, 1);
        context.globalAlpha = opacity;
        context.fillStyle = '#ffa657';
        context.beginPath();
        context.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = opacity * 0.3;
        context.beginPath();
        context.arc(bullet.x, bullet.y, 9, 0, Math.PI * 2);
        context.fill();
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

      this.clawdX += (this.pointerX - this.clawdX) * 0.1;
      this.clawdY += (this.pointerY - this.clawdY) * 0.1;
      const movementX = this.pointerX - this.previousPointerX;
      const movementY = this.pointerY - this.previousPointerY;
      if (Math.hypot(movementX, movementY) > 1.5) {
        this.facingAngle = Math.atan2(movementY, movementX);
        this.avatar.style.transform = movementX < 0 ? 'scaleX(1)' : 'scaleX(-1)';
        this.previousPointerX = this.pointerX;
        this.previousPointerY = this.pointerY;
      }
      this.avatar.style.left = `${this.clawdX - 50}px`;
      this.avatar.style.top = `${this.clawdY - 78}px`;

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

      this.bullets = this.bullets.filter(bullet => {
        if (!physics.stepBullet(bullet, dt, this.width, this.height)) return false;

        for (const target of this.targets) {
          const distance = physics.circleRectDistance(bullet.x, bullet.y, target.rect);
          if (distance >= physics.CONSTANTS.hitRadius) continue;
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
        this._flushReleases();
        this._cancelAvatarCallbacks();
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
        this.bullets = [];
        this.mouseDown = false;
        this.lastFireTime = 0;
        this.lastTargetRefresh = 0;
        document.documentElement.style.cursor = 'none';
        document.documentElement.style.userSelect = 'none';
        if (input === 'touch') {
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
        this.avatar.style.left = `${x - 50}px`;
        this.avatar.style.top = `${y - 78}px`;
        this.avatarOpacityRaf = window.requestAnimationFrame(() => {
          this.avatarOpacityRaf = null;
          if (this.active) this.avatar.style.opacity = '1';
        });
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
      if (!this.active && this.displacements.size === 0) {
        if (!animate) {
          this._cancelAvatarCallbacks();
          if (this.avatar) {
            this.avatar.style.opacity = '0';
            this.avatar.style.display = 'none';
          }
        }
        return;
      }
      this._cancelAvatarCallbacks();
      this.active = false;
      this.activeInput = null;
      this.mouseDown = false;
      this.touchGestureActive = false;
      this.tapGesture = null;
      this.bullets = [];
      if (this.raf) window.cancelAnimationFrame(this.raf);
      this.raf = null;
      this._restorePageState();

      if (this.context) {
        this.context.clearRect(0, 0, this.width, this.height);
      }
      if (this.canvas) this.canvas.style.display = 'none';
      if (this.avatar) {
        this.avatar.style.opacity = '0';
        if (animate) {
          this.avatarHideTimer = window.setTimeout(() => {
            this.avatarHideTimer = null;
            if (!this.active && this.avatar) this.avatar.style.display = 'none';
          }, 300);
        } else {
          this.avatar.style.display = 'none';
        }
      }

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
        if (Date.now() - this.lastActivationTime > 500) this.deactivate();
        return;
      }
      if (this.activate(event.clientX, event.clientY)) {
        this.lastActivationTime = Date.now();
      }
    }

    _onMouseMove(event) {
      if (!this.active) return;
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
    }

    _onMouseDown(event) {
      if (!this.active || event.button !== 0) return;
      event.preventDefault();
      this.startShooting();
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
      if (this.persistent && !this.active && !this.reducedMotion.matches && hasPointer) {
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
      if (this.persistent) this._schedulePersistentActivation();
    }

    _cancelPersistentActivation() {
      if (this.persistentActivationTimer === null) return;
      window.clearTimeout(this.persistentActivationTimer);
      this.persistentActivationTimer = null;
    }

    _schedulePersistentActivation() {
      this._cancelPersistentActivation();
      this.persistentActivationTimer = window.setTimeout(() => {
        this.persistentActivationTimer = null;
        if (!this.persistent || this.active) return;
        this.activate(
          innerWidth / 2,
          innerHeight / 2,
          this.coarsePointer.matches ? 'touch' : 'mouse'
        );
      }, 0);
    }

    setPersistent(enabled) {
      this.persistent = Boolean(enabled);
      try {
        if (this.persistent) {
          localStorage.setItem('clawd-permanent', 'true');
        } else {
          localStorage.removeItem('clawd-permanent');
        }
      } catch (error) {
        // Persistence can be unavailable in privacy-restricted browsing modes.
      }

      if (this.persistent) {
        if (!this.active) {
          this.activate(
            innerWidth / 2,
            innerHeight / 2,
            this.coarsePointer.matches ? 'touch' : 'mouse'
          );
        }
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
