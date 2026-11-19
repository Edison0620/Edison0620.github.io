'use strict';

(function initClawdMobileLauncher() {
  const effects = window.__clawdEffects;
  if (!effects || window.__clawdMobileLauncher
    || !document.querySelector('[data-douban-list]')) return;

  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.createElement('aside');
  root.dataset.clawdLauncher = '';
  root.setAttribute('aria-label', 'Claw 发射器');
  root.hidden = true;
  root.innerHTML = `
    <span data-clawd-launcher-hint aria-live="polite">拖动瞄准 · 松开发射</span>
    <button type="button" data-clawd-launcher-close aria-label="停止 Claw 效果" title="停止 Claw 效果">×</button>
    <button type="button" data-clawd-launcher-control aria-label="拖动瞄准，松开发射 Claw" aria-describedby="clawd-launcher-hint">
      <img src="/images/clawd-walking.svg" alt="" draggable="false" aria-hidden="true">
    </button>`;
  const hint = root.querySelector('[data-clawd-launcher-hint]');
  hint.id = 'clawd-launcher-hint';
  const control = root.querySelector('[data-clawd-launcher-control]');
  const close = root.querySelector('[data-clawd-launcher-close]');
  document.body.append(root);

  let pointerId = null;
  let originX = 0;
  let originY = 0;
  let startX = 0;
  let startY = 0;
  let aimed = false;
  let multiplePointers = false;
  let deactivateTimer = 0;
  let lastShotAt = 0;
  const DEFAULT_ANGLE = -Math.PI * 0.75;
  const AUTO_DEACTIVATE_MS = 5000;

  function listenMediaQuery(query, listener) {
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      return;
    }
    query.addListener(listener);
  }

  function clearDeactivateTimer() {
    if (!deactivateTimer) return;
    window.clearTimeout(deactivateTimer);
    deactivateTimer = 0;
  }

  function hasMovingEffects() {
    return effects.bullets.length > 0
      || effects.impactBursts.length > 0
      || effects.glyphGroups.size > 0
      || effects.displacements.size > 0
      || Boolean(document.querySelector('[data-preview-curl-active], [data-preview-book-flex]'));
  }

  function scheduleDeactivate(delay = AUTO_DEACTIVATE_MS) {
    clearDeactivateTimer();
    deactivateTimer = window.setTimeout(() => {
      deactivateTimer = 0;
      if (!effects.active || effects.activeInput !== 'launcher') return;
      if (pointerId !== null || hasMovingEffects()) {
        scheduleDeactivate(250);
        return;
      }
      effects.deactivate();
    }, delay);
  }

  function syncActiveState() {
    const active = effects.active && effects.activeInput === 'launcher';
    root.classList.toggle('is-active', active);
    close.disabled = !active;
  }

  function cancelAim() {
    const capturedPointer = pointerId;
    pointerId = null;
    if (capturedPointer !== null && control.hasPointerCapture(capturedPointer)) {
      try { control.releasePointerCapture(capturedPointer); } catch {}
    }
    aimed = false;
    multiplePointers = false;
    control.classList.remove('is-aiming');
    effects.stopShooting();
  }

  const nativeDeactivate = effects.deactivate.bind(effects);
  effects.deactivate = function deactivateFromLauncher(...args) {
    clearDeactivateTimer();
    cancelAim();
    const result = nativeDeactivate(...args);
    lastShotAt = 0;
    syncActiveState();
    return result;
  };

  function setAim(clientX, clientY) {
    const dx = clientX - originX;
    const dy = clientY - originY;
    effects.facingAngle = Math.atan2(dy, dx);
    effects.facingScale = dx < 0 ? 1 : -1;
    control.style.setProperty('--launcher-facing', effects.facingScale);
    effects.pointerX = clientX;
    effects.pointerY = clientY;
    effects.previousPointerX = clientX;
    effects.previousPointerY = clientY;
  }

  function setDefaultAim() {
    aimed = false;
    setAim(originX + Math.cos(DEFAULT_ANGLE) * 72, originY + Math.sin(DEFAULT_ANGLE) * 72);
  }

  function activateAtControl() {
    const rect = control.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    if (!effects.active && !effects.activate(originX, originY, 'launcher')) return false;
    if (effects.activeInput !== 'launcher') return false;
    effects.clawdX = originX;
    effects.clawdY = originY;
    effects.holdStart = performance.now();
    setDefaultAim();
    syncActiveState();
    return true;
  }

  function fire() {
    if (!effects.active || effects.activeInput !== 'launcher') return;
    const now = performance.now();
    effects.holdStart = now;
    effects.lastFireTime = now;
    effects._spawnBullet(now);
    lastShotAt = now;
    scheduleDeactivate();
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (pointerId !== null) {
      multiplePointers = true;
      return;
    }
    if (!coarsePointer.matches || reducedMotion.matches || !activateAtControl()) return;
    clearDeactivateTimer();
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    setDefaultAim();
    multiplePointers = false;
    control.classList.add('is-aiming');
    control.setPointerCapture(pointerId);
    event.stopPropagation();
  }

  function onPointerMove(event) {
    if (event.pointerId !== pointerId) return;
    if (!aimed && Math.hypot(event.clientX - startX, event.clientY - startY) >= 8) aimed = true;
    if (aimed) setAim(event.clientX, event.clientY);
    event.preventDefault();
    event.stopPropagation();
  }

  function finishPointer(event, shouldFire) {
    if (event.pointerId !== pointerId) return;
    const fireOnce = shouldFire && !multiplePointers;
    if (fireOnce && aimed) setAim(event.clientX, event.clientY);
    pointerId = null;
    control.classList.remove('is-aiming');
    if (control.hasPointerCapture(event.pointerId)) {
      try { control.releasePointerCapture(event.pointerId); } catch {}
    }
    aimed = false;
    multiplePointers = false;
    if (fireOnce) {
      fire();
    } else if (!lastShotAt && effects.activeInput === 'launcher') {
      effects.deactivate();
    } else if (effects.activeInput === 'launcher') {
      scheduleDeactivate();
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onDocumentPointerDown(event) {
    if (pointerId !== null && event.pointerId !== pointerId) multiplePointers = true;
  }

  function fireFromKeyboard(event) {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (!coarsePointer.matches || reducedMotion.matches || !activateAtControl()) return;
    clearDeactivateTimer();
    setDefaultAim();
    fire();
  }

  function stopSyntheticEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function updateCapability() {
    window.__clawdLauncherEnabled = coarsePointer.matches;
    root.hidden = !coarsePointer.matches;
    control.disabled = reducedMotion.matches;
    if (reducedMotion.matches) {
      hint.textContent = '已关闭：系统已启用减少动态效果';
    } else {
      hint.textContent = '拖动瞄准 · 松开发射';
    }
    if ((!coarsePointer.matches || reducedMotion.matches)
      && effects.activeInput === 'launcher') effects.deactivate(false);
    if (!coarsePointer.matches || reducedMotion.matches) cancelAim();
    syncActiveState();
  }

  control.addEventListener('pointerdown', onPointerDown);
  control.addEventListener('pointermove', onPointerMove);
  control.addEventListener('pointerup', event => finishPointer(event, true));
  control.addEventListener('pointercancel', event => finishPointer(event, false));
  control.addEventListener('lostpointercapture', event => {
    if (event.pointerId === pointerId) finishPointer(event, false);
  });
  control.addEventListener('keydown', fireFromKeyboard);
  control.addEventListener('click', stopSyntheticEvent);
  control.addEventListener('contextmenu', stopSyntheticEvent);
  control.addEventListener('mousedown', event => event.stopPropagation());
  control.addEventListener('mouseup', event => event.stopPropagation());
  close.addEventListener('click', event => {
    stopSyntheticEvent(event);
    effects.deactivate();
  });
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || pointerId === null) return;
    cancelAim();
    if (!lastShotAt && effects.activeInput === 'launcher') {
      effects.deactivate(false);
    } else if (effects.activeInput === 'launcher') {
      scheduleDeactivate();
    }
  });
  listenMediaQuery(coarsePointer, updateCapability);
  listenMediaQuery(reducedMotion, updateCapability);

  window.__clawdMobileLauncher = { root, control, close, updateCapability };
  updateCapability();
})();
