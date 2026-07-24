'use strict';

(function() {
  if (window.__siteEffects) return;
  const effects = window.SiteParticleEffects;
  if (!effects) {
    console.warn('[Site effects] Particle module is unavailable.');
    return;
  }

  const IGNORED_SELECTOR = [
    'input', 'textarea', 'select', 'button', '[contenteditable="true"]',
    '[data-site-effects-ignore]', '.search-popup', '.search-pop-overlay',
    '.fancybox__container', '.comments', '.comment-container'
  ].join(', ');
  const POST_NAVIGATION_WATCHDOG_MS = 4000;

  function listenMediaQuery(query, listener) {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    }
    query.addListener(listener);
    return () => query.removeListener(listener);
  }

  class SiteEffectsController {
    constructor() {
      this.ownedCardNavigation = null;
      this.pageLifecycleRetention = null;
      this.retainedCardNavigation = null;
      this.runtime = effects.createRuntime({
        shouldRetainCardForeground: () => Boolean(
          this.pendingNavigation?.kind === 'card'
          || this.retainedCardNavigation
          || this.pageLifecycleRetention
        )
      });
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      this.coarsePointer = matchMedia('(pointer: coarse)');
      this.articleRewarded = false;
      this.pendingNavigation = null;
      this.navigationGeneration = 0;
      this.longPressTimer = null;
      this.longPressTarget = null;
      this.longPressSuppression = null;
      this.touchStartX = 0;
      this.touchStartY = 0;
      this.konamiState = [];
      this.toastTimers = new Set();
      this.toastFrame = null;
      this.visibilitySettlement = null;
      this.warned = false;
      for (const name of [
        '_onClick', '_onDoubleClick', '_onTouchStart', '_onTouchMove',
        '_onTouchEnd', '_onTouchCancel', '_onContextMenu', '_onScroll',
        '_onKeyDown', '_onPjaxSend', '_onPjaxSuccess', '_onPjaxError',
        '_onVisibilityChange', '_onPageHide', '_onPageShow',
        '_onReducedMotionChange'
      ]) this[name] = this[name].bind(this);
      document.addEventListener('click', this._onClick, true);
      document.addEventListener('contextmenu', this._onContextMenu, true);
      document.addEventListener('dblclick', this._onDoubleClick, true);
      document.addEventListener('touchstart', this._onTouchStart, { passive: true });
      document.addEventListener('touchmove', this._onTouchMove, { passive: true });
      document.addEventListener('touchend', this._onTouchEnd, { passive: true });
      document.addEventListener('touchcancel', this._onTouchCancel, { passive: true });
      document.addEventListener('keydown', this._onKeyDown);
      document.addEventListener('visibilitychange', this._onVisibilityChange);
      document.addEventListener('pjax:send', this._onPjaxSend);
      document.addEventListener('pjax:success', this._onPjaxSuccess);
      document.addEventListener('pjax:error', this._onPjaxError);
      window.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('pagehide', this._onPageHide);
      window.addEventListener('pageshow', this._onPageShow);
      this.removeReducedMotionListener = listenMediaQuery(
        this.reducedMotion,
        this._onReducedMotionChange
      );
    }

    _isIgnored(target) {
      return target instanceof Element && (target.isContentEditable
        || Boolean(target.closest(IGNORED_SELECTOR)));
    }

    _navigate(record) {
      if (window.pjax && typeof window.pjax.loadUrl === 'function') {
        if (record.kind === 'card'
          && this.ownedCardNavigation === record) {
          this._armPostNavigationWatchdog(record);
        }
        window.pjax.loadUrl(record.url);
      } else {
        window.location.assign(record.url);
      }
    }

    _clearPostNavigationWatchdog(record) {
      if (!record || record.postNavigationWatchdog === null) return;
      window.clearTimeout(record.postNavigationWatchdog);
      record.postNavigationWatchdog = null;
    }

    _armPostNavigationWatchdog(record) {
      this._clearPostNavigationWatchdog(record);
      record.postNavigationWatchdog = window.setTimeout(() => {
        if (this.ownedCardNavigation !== record) return;
        record.postNavigationWatchdog = null;
        this._restoreOwnedCardNavigation();
        window.location.assign(record.url);
      }, POST_NAVIGATION_WATCHDOG_MS);
    }

    _warn(error) {
      if (effects.isReportedError?.(error)) return;
      if (this.warned) return;
      this.warned = true;
      window.console?.warn(
        '[Site effects] Animation failed; continuing without the effect.',
        error
      );
    }

    _invalidatePendingNavigation() {
      this.navigationGeneration += 1;
      const record = this.pendingNavigation;
      this.pendingNavigation = null;
      if (!record) return;
      this._clearVisibilitySettlement(record);
      record.active = false;
      for (const timer of record.timers) window.clearTimeout(timer);
      record.timers.clear();
    }

    _cancelAll(options = {}) {
      this.runtime.cancelAll(options);
      if (!options.retainCardForeground) {
        this.pageLifecycleRetention = null;
        this.retainedCardNavigation = null;
      }
      if (!options.retainCardNavigation) {
        this._clearPostNavigationWatchdog(this.ownedCardNavigation);
        this.ownedCardNavigation = null;
      }
    }

    _restoreOwnedCardNavigation() {
      const record = this.ownedCardNavigation;
      if (!record) return;
      this._clearPostNavigationWatchdog(record);
      if (this.retainedCardNavigation === record) {
        this.runtime.restoreRetainedCard();
      }
      this.ownedCardNavigation = null;
      this.retainedCardNavigation = null;
    }

    _discardOwnedCardNavigation() {
      const record = this.ownedCardNavigation;
      if (!record) return;
      this._clearPostNavigationWatchdog(record);
      if (this.retainedCardNavigation === record) {
        this.runtime.discardRetainedCard();
      }
      this.ownedCardNavigation = null;
      this.retainedCardNavigation = null;
    }

    _beginNavigation(url, kind) {
      this._invalidatePendingNavigation();
      this._cancelAll();
      const record = {
        active: true,
        generation: this.navigationGeneration,
        kind,
        postNavigationWatchdog: null,
        pjaxSendObserved: false,
        timers: new Set(),
        url
      };
      this.pendingNavigation = record;
      return record;
    }

    _isPendingNavigation(record) {
      return record.active
        && record.generation === this.navigationGeneration
        && this.pendingNavigation === record;
    }

    _scheduleNavigation(record, delay) {
      const timer = window.setTimeout(() => {
        record.timers.delete(timer);
        this._completeNavigation(record);
      }, delay);
      record.timers.add(timer);
      return timer;
    }

    _clearVisibilitySettlement(record) {
      const settlement = this.visibilitySettlement;
      if (!settlement || (record && settlement.navigation !== record)) return;
      window.clearTimeout(settlement.timer);
      this.visibilitySettlement = null;
    }

    _deferVisibilitySettlement(record) {
      this._clearVisibilitySettlement();
      const settlement = { navigation: record, timer: null };
      settlement.timer = window.setTimeout(() => {
        if (this.visibilitySettlement !== settlement) return;
        this.visibilitySettlement = null;
        if (!this._isPendingNavigation(record)) return;
        this._cancelAll({ retainCardForeground: true });
      }, 0);
      this.visibilitySettlement = settlement;
    }

    _completeNavigation(record) {
      if (!this._isPendingNavigation(record)) return;
      this._clearVisibilitySettlement(record);
      record.active = false;
      this.pendingNavigation = null;
      for (const timer of record.timers) window.clearTimeout(timer);
      record.timers.clear();
      if (record.kind === 'card' && !this.reducedMotion.matches) {
        this._cancelAll({ retainCardForeground: true });
        this.retainedCardNavigation = record;
      } else {
        this._cancelAll();
      }
      if (record.kind === 'card') this.ownedCardNavigation = record;
      try {
        this._navigate(record);
      } catch (error) {
        this._onPjaxError();
        window.location.assign(record.url);
      }
    }

    cancelPendingNavigation() {
      this._invalidatePendingNavigation();
      this._cancelAll();
    }

    _effectLink(link, event, kind) {
      const target = (link.target || '').trim().toLowerCase();
      if (event.defaultPrevented
        || !effects.isEligibleLinkClick(event)
        || (target && target !== '_self')
        || link.hasAttribute('download')
        || new URL(link.href, location.href).origin !== location.origin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const record = this._beginNavigation(link.href, kind);
      this._scheduleNavigation(record, 900);
      if (this.reducedMotion.matches) return this._completeNavigation(record);
      if (kind === 'card') {
        const card = link.closest('.post-block');
        if (!card) return this._completeNavigation(record);
        let animation;
        try {
          animation = this.runtime.explodeCard(
            card, event.clientX, event.clientY,
            { mobile: this.coarsePointer.matches }
          );
        } catch (error) {
          this._warn(error);
          return this._completeNavigation(record);
        }
        Promise.resolve(animation).then(
          () => this._completeNavigation(record),
          error => {
            this._warn(error);
            this._completeNavigation(record);
          }
        );
      } else {
        const tags = [...link.closest('.tag-cloud-tags').querySelectorAll('a')];
        try {
          this.runtime.scatterTags(tags, link, {
            mobile: this.coarsePointer.matches
          });
        } catch (error) {
          this._warn(error);
          return this._completeNavigation(record);
        }
        this._scheduleNavigation(
          record, this.coarsePointer.matches ? 180 : 350
        );
      }
    }

    _onClick(event) {
      if (this._suppressLongPressAction(event)) return;
      if (this._isIgnored(event.target)) return;
      const cardLink = event.target.closest(
        '.post-title-link, .post-button .btn'
      );
      if (cardLink && cardLink.closest('.post-block')) {
        this._effectLink(cardLink, event, 'card');
        return;
      }
      const tagLink = event.target.closest('.tag-cloud-tags a');
      if (tagLink) this._effectLink(tagLink, event, 'tag');
    }

    _onContextMenu(event) {
      this._suppressLongPressAction(event);
    }

    _onDoubleClick(event) {
      const code = event.target.closest('.post-body .highlight, .post-body pre');
      if (!code || window.__clawdEffects?.active
        || this.coarsePointer.matches || this.reducedMotion.matches) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._explodeCode(code, { mobile: false });
    }

    _explodeCode(code, options) {
      let animation;
      try {
        animation = this.runtime.explodeCode(code, options);
      } catch (error) {
        this._warn(error);
        return;
      }
      Promise.resolve(animation).catch(error => this._warn(error));
    }

    _onTouchStart(event) {
      this._cancelLongPress(true);
      const code = event.target.closest('.post-body .highlight, .post-body pre');
      if (!code || !this.coarsePointer.matches
        || this.reducedMotion.matches || window.__clawdEffects?.active) return;
      const touch = event.touches[0];
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      this.longPressTarget = code;
      this.longPressTimer = setTimeout(() => {
        const target = this.longPressTarget;
        this.longPressTimer = null;
        this.longPressTarget = null;
        if (!target) return;
        this._armLongPressSuppression(target);
        this._explodeCode(target, { mobile: true });
      }, 550);
    }

    _onTouchMove(event) {
      if (!this.longPressTimer && !this.longPressSuppression) return;
      const touch = event.touches[0];
      if (Math.hypot(
        touch.clientX - this.touchStartX,
        touch.clientY - this.touchStartY
      ) > 12) this._cancelLongPress(true);
    }

    _onTouchEnd() {
      this._cancelLongPress();
    }

    _onTouchCancel() {
      this._cancelLongPress(true);
    }

    _armLongPressSuppression(target) {
      this._clearLongPressSuppression();
      const record = { target, timer: null };
      record.timer = window.setTimeout(() => {
        if (this.longPressSuppression === record) {
          this.longPressSuppression = null;
        }
      }, 800);
      this.longPressSuppression = record;
    }

    _clearLongPressSuppression() {
      if (!this.longPressSuppression) return;
      window.clearTimeout(this.longPressSuppression.timer);
      this.longPressSuppression = null;
    }

    _suppressLongPressAction(event) {
      const record = this.longPressSuppression;
      if (!record || !(event.target instanceof Element)) return false;
      const code = event.target.closest(
        '.post-body .highlight, .post-body pre'
      );
      if (code !== record.target) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return true;
    }

    _cancelLongPress(clearSuppression = false) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      this.longPressTarget = null;
      if (clearSuppression) this._clearLongPressSuppression();
    }

    _onScroll() {
      if (this.articleRewarded || this.reducedMotion.matches) return;
      if (!document.querySelector('.main-inner.post .post-body')) return;
      if (scrollY + innerHeight < document.documentElement.scrollHeight - 100) return;
      let launched;
      try {
        launched = this.runtime.confettiBurst(
          innerWidth / 2,
          innerHeight * 0.7,
          80
        );
      } catch (error) {
        this._warn(error);
        return;
      }
      if (launched === false) return;
      this.articleRewarded = true;
    }

    _onKeyDown(event) {
      if (this._isIgnored(event.target)) return;
      const result = effects.advanceKonami(this.konamiState, event.key);
      this.konamiState = result.state;
      if (!result.matched || !window.__clawdEffects) return;
      const enabled = window.__clawdEffects.togglePersistent();
      this._showToast(enabled
        ? 'Permanent Clawd mode activated! 🦀'
        : 'Clawd mode deactivated');
    }

    _clearToast() {
      for (const timer of this.toastTimers) window.clearTimeout(timer);
      this.toastTimers.clear();
      if (this.toastFrame !== null) window.cancelAnimationFrame(this.toastFrame);
      this.toastFrame = null;
      document.querySelector('[data-site-effects-toast]')?.remove();
    }

    _showToast(message) {
      this._clearToast();
      const toast = document.createElement('div');
      toast.dataset.siteEffectsToast = '';
      toast.setAttribute('role', 'status');
      toast.textContent = message;
      toast.style.cssText = [
        'position:fixed', 'top:20px', 'left:50%',
        'transform:translateX(-50%)', 'padding:12px 24px',
        'background:#161b22', 'color:#3fb950',
        'border:1px solid #3fb950', 'border-radius:8px',
        'font-family:monospace', 'font-size:14px',
        'z-index:10001', 'opacity:0', 'pointer-events:none'
      ].join(';');
      if (!this.reducedMotion.matches) toast.style.transition = 'opacity 0.3s';
      document.body.appendChild(toast);
      if (this.reducedMotion.matches) {
        toast.style.opacity = '1';
      } else {
        this.toastFrame = requestAnimationFrame(() => {
          this.toastFrame = null;
          toast.style.opacity = '1';
        });
      }
      const fadeTimer = window.setTimeout(() => {
        this.toastTimers.delete(fadeTimer);
        toast.style.opacity = '0';
      }, 2000);
      const removeTimer = window.setTimeout(() => {
        this.toastTimers.delete(removeTimer);
        toast.remove();
      }, 2300);
      this.toastTimers.add(fadeTimer);
      this.toastTimers.add(removeTimer);
    }

    _onVisibilityChange() {
      if (document.hidden) {
        this._cancelLongPress(true);
        const pendingRecord = this.pendingNavigation;
        if (pendingRecord?.kind === 'card') {
          this._deferVisibilitySettlement(pendingRecord);
          return;
        }
        this._cancelAll({
          retainCardForeground: Boolean(
            this.retainedCardNavigation || this.pageLifecycleRetention
          ),
          retainCardNavigation: Boolean(this.ownedCardNavigation)
        });
      }
    }

    _onPageHide() {
      this._cancelLongPress(true);
      const pendingRecord = this.pendingNavigation?.kind === 'card'
        ? this.pendingNavigation
        : null;
      this._clearVisibilitySettlement(pendingRecord);
      this._invalidatePendingNavigation();
      if (pendingRecord) this.pageLifecycleRetention = pendingRecord;
      this._cancelAll({
        retainCardForeground: Boolean(
          pendingRecord
          || this.retainedCardNavigation
          || this.pageLifecycleRetention
        ),
        retainCardNavigation: Boolean(
          this.ownedCardNavigation
        )
      });
    }

    _onPageShow(event) {
      if (!event.persisted) return;
      this._cancelLongPress(true);
      this._invalidatePendingNavigation();
      this._clearToast();
      this._cancelAll();
      this.articleRewarded = false;
    }

    _onReducedMotionChange() {
      if (!this.reducedMotion.matches) return;
      this._cancelLongPress(true);
      this._clearToast();
      const record = this.pendingNavigation;
      if (record) {
        this._completeNavigation(record);
      } else {
        this._cancelAll({
          retainCardNavigation: Boolean(this.ownedCardNavigation)
        });
      }
    }

    _onPjaxSend() {
      this._cancelLongPress(true);
      this._invalidatePendingNavigation();
      this.konamiState = [];
      this._clearToast();
      const ownedRecord = this.ownedCardNavigation;
      const isOwnedSend = Boolean(
        ownedRecord && !ownedRecord.pjaxSendObserved
      );
      if (isOwnedSend) ownedRecord.pjaxSendObserved = true;
      this._cancelAll({
        retainCardForeground: Boolean(
          isOwnedSend && this.retainedCardNavigation === ownedRecord
        ),
        retainCardNavigation: isOwnedSend
      });
    }

    _onPjaxSuccess() {
      this._discardOwnedCardNavigation();
      this.articleRewarded = false;
    }

    _onPjaxError() {
      this._restoreOwnedCardNavigation();
    }

    destroy() {
      this._cancelLongPress(true);
      this._invalidatePendingNavigation();
      this.konamiState = [];
      this._clearToast();
      this._clearPostNavigationWatchdog(this.ownedCardNavigation);
      this._clearVisibilitySettlement();
      this.ownedCardNavigation = null;
      this.pageLifecycleRetention = null;
      this.retainedCardNavigation = null;
      this.runtime.destroy();
      this.removeReducedMotionListener();
      document.removeEventListener('click', this._onClick, true);
      document.removeEventListener('contextmenu', this._onContextMenu, true);
      document.removeEventListener('dblclick', this._onDoubleClick, true);
      document.removeEventListener('touchstart', this._onTouchStart);
      document.removeEventListener('touchmove', this._onTouchMove);
      document.removeEventListener('touchend', this._onTouchEnd);
      document.removeEventListener('touchcancel', this._onTouchCancel);
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.removeEventListener('pjax:send', this._onPjaxSend);
      document.removeEventListener('pjax:success', this._onPjaxSuccess);
      document.removeEventListener('pjax:error', this._onPjaxError);
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('pagehide', this._onPageHide);
      window.removeEventListener('pageshow', this._onPageShow);
    }
  }

  window.__siteEffects = new SiteEffectsController();
})();
