'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ClawdPhysics = api;
})(typeof window === 'undefined' ? null : window, function() {
  const CONSTANTS = Object.freeze({
    minFireRate: 6,
    maxFireRate: 40,
    rampMs: 2000,
    minSpread: 0.15,
    maxSpread: 0.8,
    bulletSpeed: 450,
    bulletLifeMs: 4000,
    bounceRetention: 0.55,
    hitRadius: 50,
    maxDisplacement: 80,
    impulseScale: 5,
    spring: 0.08,
    damping: 0.82,
    restThreshold: 0.1
  });

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function cleanFloat(value) {
    return Math.round(value * 1e12) / 1e12;
  }

  function getFireProfile(holdMs) {
    const progress = clamp(holdMs / CONSTANTS.rampMs, 0, 1);
    return {
      rate: CONSTANTS.minFireRate
        + (CONSTANTS.maxFireRate - CONSTANTS.minFireRate) * progress,
      spread: CONSTANTS.minSpread
        + (CONSTANTS.maxSpread - CONSTANTS.minSpread) * progress
    };
  }

  function createBullet(x, y, angle) {
    return {
      x,
      y,
      vx: CONSTANTS.bulletSpeed * Math.cos(angle),
      vy: CONSTANTS.bulletSpeed * Math.sin(angle),
      life: CONSTANTS.bulletLifeMs,
      maxLife: CONSTANTS.bulletLifeMs
    };
  }

  function stepBullet(bullet, dtSeconds, width, height) {
    bullet.x += bullet.vx * dtSeconds;
    bullet.y += bullet.vy * dtSeconds;
    bullet.life -= dtSeconds * 1000;

    if (bullet.x <= 0) {
      bullet.x = 0;
      bullet.vx = cleanFloat(CONSTANTS.bounceRetention * Math.abs(bullet.vx));
      bullet.vy = cleanFloat(bullet.vy * CONSTANTS.bounceRetention);
    } else if (bullet.x >= width) {
      bullet.x = width;
      bullet.vx = cleanFloat(-CONSTANTS.bounceRetention * Math.abs(bullet.vx));
      bullet.vy = cleanFloat(bullet.vy * CONSTANTS.bounceRetention);
    }

    if (bullet.y <= 0) {
      bullet.y = 0;
      bullet.vy = cleanFloat(CONSTANTS.bounceRetention * Math.abs(bullet.vy));
      bullet.vx = cleanFloat(bullet.vx * CONSTANTS.bounceRetention);
    } else if (bullet.y >= height) {
      bullet.y = height;
      bullet.vy = cleanFloat(-CONSTANTS.bounceRetention * Math.abs(bullet.vy));
      bullet.vx = cleanFloat(bullet.vx * CONSTANTS.bounceRetention);
    }

    return bullet.life > 0 && Math.hypot(bullet.vx, bullet.vy) >= 30;
  }

  function circleRectDistance(x, y, rect) {
    const closestX = clamp(x, rect.left, rect.right);
    const closestY = clamp(y, rect.top, rect.bottom);
    return Math.hypot(x - closestX, y - closestY);
  }

  function addImpulse(state, angle, magnitude) {
    state.vx += Math.cos(angle) * magnitude;
    state.vy += Math.sin(angle) * magnitude;
    const speed = Math.hypot(state.vx, state.vy);

    if (speed > CONSTANTS.maxDisplacement) {
      state.vx *= CONSTANTS.maxDisplacement / speed;
      state.vy *= CONSTANTS.maxDisplacement / speed;
    }

    return state;
  }

  function stepDisplacement(state) {
    state.vx += -state.dx * CONSTANTS.spring;
    state.vy += -state.dy * CONSTANTS.spring;
    state.vx *= CONSTANTS.damping;
    state.vy *= CONSTANTS.damping;
    state.dx += state.vx;
    state.dy += state.vy;
    const displacement = Math.hypot(state.dx, state.dy);
    if (displacement > CONSTANTS.maxDisplacement) {
      const scale = CONSTANTS.maxDisplacement / displacement;
      state.dx *= scale;
      state.dy *= scale;
      state.vx *= scale;
      state.vy *= scale;
    }
    state.atRest = Math.abs(state.dx) < CONSTANTS.restThreshold
      && Math.abs(state.dy) < CONSTANTS.restThreshold
      && Math.abs(state.vx) < CONSTANTS.restThreshold
      && Math.abs(state.vy) < CONSTANTS.restThreshold;

    if (state.atRest) {
      state.dx = 0;
      state.dy = 0;
      state.vx = 0;
      state.vy = 0;
    }

    return state;
  }

  return {
    CONSTANTS,
    getFireProfile,
    createBullet,
    stepBullet,
    circleRectDistance,
    addImpulse,
    stepDisplacement
  };
});
