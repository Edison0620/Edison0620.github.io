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

  function fallbackSegments(text) {
    const segments = [];
    let index = 0;
    for (const character of text) {
      const previous = segments[segments.length - 1];
      const joinsPrevious = previous && (
        /\p{Mark}/u.test(character)
        || /[\uFE00-\uFE0F]/u.test(character)
        || /[\u{1F3FB}-\u{1F3FF}]/u.test(character)
        || character === '\u200D'
        || previous.segment.endsWith('\u200D')
      );
      if (joinsPrevious) {
        previous.segment += character;
      } else {
        segments.push({ segment: character, index });
      }
      index += character.length;
    }
    return segments;
  }

  function extractCharacters(element, cap) {
    const candidates = [];
    const rootRect = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest(TEXT_EXCLUSIONS)) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.position === 'fixed' || style.position === 'sticky') continue;
      const segments = typeof Intl.Segmenter === 'function'
        ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          .segment(node.textContent)]
        : fallbackSegments(node.textContent);
      for (const item of segments) {
        if (!item.segment.trim() && item.segment !== ' ') continue;
        candidates.push({ item, node, style });
      }
    }
    const characters = [];
    for (const { item, node, style } of sampleEvenly(candidates, cap)) {
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
    }
    return characters;
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
        animation.drawCharacter(context, particle);
      }
    }
    if (complete) animation.finish();
  }

  function makeCardAnimation(
    target, characters, clientX, clientY,
    durationScale, random, finish, resolve, drawCharacter
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
      target,
      particles,
      resolve,
      drawCharacter,
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
    const runtimeWindow = typeof window === 'undefined' ? globalThis : window;
    let primary = null;
    let confetti = [];
    let destroyed = false;
    let warned = false;
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

    function settlePrimary(record, outcome = 'resolve', error) {
      if (!record || record.settled) return;
      record.settled = true;
      if (record.watchdog !== null) {
        runtimeWindow.clearTimeout(record.watchdog);
        record.watchdog = null;
      }
      if (primary === record) primary = null;
      restoreTarget(record.target);
      if (outcome === 'reject') {
        record.reject?.(error);
      } else {
        record.resolve?.();
      }
    }

    function finishPrimary() {
      settlePrimary(primary);
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

    function startPrimary(target, makeAnimation) {
      return new Promise((resolve, reject) => {
        let record;
        try {
          record = makeAnimation(
            () => settlePrimary(record),
            resolve
          );
        } catch (error) {
          restoreTarget(target);
          warnOnce(error);
          reject(error);
          return;
        }
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
      finishPrimary();
      stopVisuals();
    }

    if (typeof runtimeWindow.addEventListener === 'function') {
      runtimeWindow.addEventListener('resize', onResize);
    }

    return {
      explodeCard(element, clientX, clientY, options = {}) {
        finishPrimary();
        const mobile = Boolean(options.mobile);
        const durationScale = mobile ? 180 / 625 : 1;
        const particles = extractCharacters(element, particleCap(mobile));
        if (!particles.length) return Promise.resolve();
        const target = saveTarget(element);
        element.style.visibility = 'hidden';
        return startPrimary(target, (finish, resolve) => (
          makeCardAnimation(
            target, particles, clientX, clientY,
            durationScale, random, finish, resolve, drawCharacter
          )
        ));
      },
      explodeCode(element, options = {}) {
        if (primary?.target.element === element) return Promise.resolve();
        finishPrimary();
        const particles = extractCharacters(
          element, particleCap(Boolean(options.mobile))
        );
        if (!particles.length) return Promise.resolve();
        const target = saveTarget(element);
        element.style.visibility = 'hidden';
        return startPrimary(target, (finish, resolve) => (
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
      cancelAll() {
        finishPrimary();
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
    createRuntime
  };
});
