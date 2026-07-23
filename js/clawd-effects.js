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
    '.fancybox__container',
    '.search-popup',
    '.search-pop-overlay'
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
      this.holdStart = 0;
      this.lastFireTime = 0;
      this.lastFrameTime = 0;
      this.lastTargetRefresh = 0;
      this.lastActivationTime = 0;
      this.geometryDirty = true;
      this.warned = false;
      this.savedCursor = '';
      this.savedUserSelect = '';
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

      this._onDoubleClick = this._onDoubleClick.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseDown = this._onMouseDown.bind(this);
      this._onMouseUp = this._onMouseUp.bind(this);
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
    }

    _canActivate() {
      return !this.reducedMotion.matches && this.finePointer.matches;
    }

    _isIgnoredTarget(target) {
      return target instanceof Element && Boolean(target.closest(IGNORED_SELECTOR));
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
      window.clearTimeout(record.timer);
      this.releaseRecords.delete(record);
      if (!record.element.isConnected) return;
      this._restoreSavedStyles(record);
    }

    _restoreSavedStyles(record) {
      const element = record.element;
      if (record.savedStyleAttribute === null) {
        element.removeAttribute('style');
      } else {
        element.setAttribute('style', record.savedStyleAttribute);
      }
      element.removeAttribute('data-clawd-impacted');
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
        savedWillChange: element.style.willChange
      };
      element.dataset.clawdImpacted = '';
      element.style.transition = 'none';
      element.style.willChange = 'transform';
      this.displacements.set(element, state);
      return state;
    }

    _restoreDisplacement(state, animate) {
      this.displacements.delete(state.element);
      if (!state.element.isConnected) return;

      if (!animate) {
        this._restoreSavedStyles(state);
        return;
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
          this.displacements.delete(state.element);
          continue;
        }
        physics.stepDisplacement(state);
        if (state.atRest) {
          this._restoreDisplacement(state, false);
          continue;
        }
        state.element.style.transition = 'none';
        state.element.style.transform = `translate(${state.dx.toFixed(1)}px, ${state.dy.toFixed(1)}px) ${state.savedTransform}`.trim();
      }

      this._draw();
      this.raf = window.requestAnimationFrame(this._stepFrame);
    }

    activate(x, y) {
      if (this.active || !this._canActivate()) return false;

      try {
        this._flushReleases();
        this._ensureLayers();
        this.active = true;
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
        this.savedCursor = document.documentElement.style.cursor;
        this.savedUserSelect = document.documentElement.style.userSelect;
        document.documentElement.style.cursor = 'none';
        document.documentElement.style.userSelect = 'none';
        document.documentElement.classList.add('clawd-effects-active');
        this._resizeCanvas();
        this.targets = this._collectTargets();
        this._refreshGeometry(false);
        this.canvas.style.display = 'block';
        this.avatar.style.display = 'block';
        this.avatar.style.left = `${x - 50}px`;
        this.avatar.style.top = `${y - 78}px`;
        window.requestAnimationFrame(() => {
          if (this.active) this.avatar.style.opacity = '1';
        });
        this.lastFrameTime = performance.now();
        this.raf = window.requestAnimationFrame(this._stepFrame);
        return true;
      } catch (error) {
        this.deactivate(false);
        this._warn(error);
        return false;
      }
    }

    deactivate(animate = true) {
      if (!this.active && this.displacements.size === 0) return;
      this.active = false;
      this.mouseDown = false;
      this.bullets = [];
      if (this.raf) window.cancelAnimationFrame(this.raf);
      this.raf = null;
      document.documentElement.classList.remove('clawd-effects-active');
      document.documentElement.style.cursor = this.savedCursor;
      document.documentElement.style.userSelect = this.savedUserSelect;

      if (this.context) {
        this.context.clearRect(0, 0, this.width, this.height);
      }
      if (this.canvas) this.canvas.style.display = 'none';
      if (this.avatar) {
        this.avatar.style.opacity = '0';
        window.setTimeout(() => {
          if (!this.active && this.avatar) this.avatar.style.display = 'none';
        }, 300);
      }

      for (const state of [...this.displacements.values()]) {
        this._restoreDisplacement(state, animate);
      }
      this.targets = [];
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
      this.mouseDown = true;
      this.holdStart = performance.now();
      this.lastFireTime = 0;
    }

    _onMouseUp() {
      this.mouseDown = false;
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
        this.mouseDown = false;
        return;
      }
      if (!this.raf) {
        this.lastFrameTime = performance.now();
        this.raf = window.requestAnimationFrame(this._stepFrame);
      }
    }

    _onMediaChange() {
      if (!this._canActivate()) this.deactivate(false);
    }

    _onPjaxSend() {
      this.deactivate(false);
    }

    _onPjaxSuccess() {
      this.geometryDirty = true;
    }

    destroy() {
      this.deactivate(false);
      this._flushReleases();
      document.removeEventListener('dblclick', this._onDoubleClick);
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mousedown', this._onMouseDown);
      document.removeEventListener('mouseup', this._onMouseUp);
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.removeEventListener('pjax:send', this._onPjaxSend);
      document.removeEventListener('pjax:success', this._onPjaxSuccess);
      window.removeEventListener('resize', this._onViewportChange);
      window.removeEventListener('scroll', this._onViewportChange);
      window.removeEventListener('blur', this._onMouseUp);
      this.removeReducedMotionListener();
      this.removeFinePointerListener();
      this.canvas?.remove();
      this.avatar?.remove();
    }
  }

  window.__clawdEffects = new ClawdEffects();
})();
