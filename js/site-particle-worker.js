'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteParticleWorker = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function() {
  const FIXED_STEP = 1 / 60;
  const FIXED_STEP_MS = FIXED_STEP * 1000;
  const DRAG = 0.965;
  const GRAVITY = 580;

  function clean(value) {
    return Math.round(value * 1e12) / 1e12;
  }

  function stepShrapnel(particle, dt) {
    particle.t += dt * 1000;
    particle.vx *= DRAG;
    particle.vy *= DRAG;
    particle.vy += GRAVITY * dt;
    particle.x = clean(particle.x + particle.vx * dt);
    particle.y = clean(particle.y + particle.vy * dt);
    particle.vx = clean(particle.vx);
    particle.vy = clean(particle.vy);
    particle.rot = clean(particle.rot + particle.av * dt);
    return particle;
  }

  // Keep formulas in sync with stepCardParticle. Guarded by “Worker physics
  // matches Canvas through every card phase for 45 ticks”.
  function stepWorkerParticle(particle, dt) {
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
    if (fallDt > 0) stepShrapnel(particle, fallDt);
    const progress = particle.age / particle.duration;
    particle.opacity = progress > 0.5
      ? Math.max(0, 1 - (progress - 0.5) * 2)
      : 1;
    return particle;
  }

  function advanceFixedParticles(state, elapsedSeconds) {
    state.accumulator = Math.min(state.accumulator + elapsedSeconds, 0.1);
    while (state.accumulator >= FIXED_STEP) {
      for (const particle of state.particles) {
        if (particle.phase === 'complete') continue;
        particle.previousX = particle.x;
        particle.previousY = particle.y;
        particle.previousRot = particle.rot;
        particle.previousOpacity = particle.opacity;
        stepWorkerParticle(particle, FIXED_STEP);
      }
      state.accumulator -= FIXED_STEP;
    }
    return state;
  }

  function interpolateParticle(particle, alpha) {
    function interpolate(previous, current) {
      const start = Number.isFinite(previous) ? previous : current;
      return start + (current - start) * alpha;
    }
    return {
      ...particle,
      x: interpolate(particle.previousX, particle.x),
      y: interpolate(particle.previousY, particle.y),
      rot: interpolate(particle.previousRot, particle.rot),
      opacity: interpolate(particle.previousOpacity, particle.opacity)
    };
  }

  function createWorkerRuntime(scope, dependencies) {
    let renderer = null;
    let active = null;
    let destroyed = false;
    let initErrorReported = false;
    const startedIds = new Set();
    const erroredIds = new Set();

    function post(message) {
      scope.postMessage(message);
    }

    function errorMessage(error) {
      if (error && typeof error.message === 'string') return error.message;
      return String(error);
    }

    function postError(id, error) {
      if (id === null) {
        if (initErrorReported) return;
        initErrorReported = true;
      } else {
        if (erroredIds.has(id)) return;
        erroredIds.add(id);
      }
      post({ type: 'error', id, message: errorMessage(error) });
    }

    function cancelActiveFrame(record = active) {
      if (!record || record.frame === null) return;
      const frame = record.frame;
      record.frame = null;
      try {
        dependencies.cancelAnimationFrame(frame);
      } catch (error) {
        postError(record.id, error);
      }
    }

    function releaseRenderer(id) {
      if (!renderer) return;
      const ownedRenderer = renderer;
      renderer = null;
      try {
        if (typeof ownedRenderer.destroy === 'function') {
          ownedRenderer.destroy();
        }
      } catch (error) {
        postError(id, error);
      }
    }

    function fail(id, error, record = active) {
      if (record && active === record) {
        cancelActiveFrame(record);
        active = null;
      }
      postError(id, error);
      releaseRenderer(id);
    }

    function schedule(record) {
      try {
        record.frame = dependencies.requestAnimationFrame(timestamp => {
          if (destroyed || active !== record || record.completed) return;
          record.frame = null;
          try {
            const currentTime = Number.isFinite(timestamp)
              ? timestamp
              : dependencies.now();
            const elapsed = Math.max(0, (currentTime - record.lastTime) / 1000);
            record.lastTime = currentTime;
            advanceFixedParticles(record.state, elapsed);
            const alpha = Math.max(
              0,
              Math.min(record.state.accumulator / FIXED_STEP, 1)
            );
            const visible = [];
            let latestTerminalDeadline = -Infinity;
            for (const particle of record.state.particles) {
              if (particle.phase !== 'complete') {
                visible.push(interpolateParticle(particle, alpha));
                continue;
              }
              let terminal = record.terminals.get(particle);
              if (!terminal) {
                const startedAt = currentTime - alpha * FIXED_STEP_MS;
                terminal = {
                  deadline: startedAt + FIXED_STEP_MS,
                  displayed: false
                };
                record.terminals.set(particle, terminal);
              }
              latestTerminalDeadline = Math.max(
                latestTerminalDeadline,
                terminal.deadline
              );
              if (!terminal.displayed
                || currentTime < terminal.deadline - 1e-9) {
                const terminalAlpha = Math.max(0, Math.min(
                  1 - (terminal.deadline - currentTime) / FIXED_STEP_MS,
                  1
                ));
                visible.push(interpolateParticle(particle, terminalAlpha));
                terminal.displayed = true;
              }
            }
            renderer.draw(visible);
            post({ type: 'frame', id: record.id });
            const allComplete = record.state.particles.every(
              particle => particle.phase === 'complete'
            );
            const nextFrameTime = currentTime + elapsed * 1000;
            const wouldMissTerminalDeadline = allComplete
              && visible.length > 0
              && nextFrameTime > latestTerminalDeadline + 1e-9;
            if (allComplete && (
              visible.length === 0 || wouldMissTerminalDeadline
            )) {
              record.completed = true;
              post({ type: 'complete', id: record.id });
              return;
            }
            schedule(record);
          } catch (error) {
            fail(record.id, error, record);
          }
        });
      } catch (error) {
        fail(record.id, error, record);
      }
    }

    function initialize(message) {
      cancelActiveFrame();
      const previousId = active ? active.id : null;
      active = null;
      releaseRenderer(previousId);
      startedIds.clear();
      erroredIds.clear();
      initErrorReported = false;
      try {
        const gl = message.canvas.getContext('webgl2', {
          alpha: true,
          premultipliedAlpha: true
        });
        if (!gl) throw new Error('WebGL2 context is unavailable');
        renderer = dependencies.createRenderer(gl, {
          ...message.viewport,
          pages: message.pages
        });
        if (!renderer || typeof renderer.draw !== 'function'
          || typeof renderer.resize !== 'function'
          || typeof renderer.destroy !== 'function') {
          throw new Error('Particle renderer is invalid');
        }
        post({ type: 'ready' });
      } catch (error) {
        releaseRenderer(null);
        postError(null, error);
      }
    }

    function start(message) {
      if (startedIds.has(message.id)) return;
      startedIds.add(message.id);
      if (!renderer) {
        postError(message.id, new Error('Particle renderer is not initialized'));
        return;
      }
      if (!Array.isArray(message.particles)) {
        fail(message.id, new Error('Particle list is invalid'));
        return;
      }
      cancelActiveFrame();
      let lastTime;
      try {
        lastTime = dependencies.now();
      } catch (error) {
        fail(message.id, error);
        return;
      }
      const record = {
        id: message.id,
        state: {
          accumulator: 0,
          particles: message.particles
        },
        lastTime,
        frame: null,
        completed: false,
        terminals: new Map()
      };
      active = record;
      schedule(record);
    }

    function cancel(message) {
      if (!active || active.id !== message.id) return;
      const id = active.id;
      cancelActiveFrame();
      active = null;
      releaseRenderer(id);
    }

    function resize(message) {
      if (!renderer) return;
      try {
        renderer.resize(message.viewport);
      } catch (error) {
        fail(active ? active.id : null, error);
      }
    }

    function onMessage(event) {
      if (destroyed || !event || !event.data) return;
      const message = event.data;
      if (message.type === 'init') {
        initialize(message);
      } else if (message.type === 'start') {
        start(message);
      } else if (message.type === 'cancel') {
        cancel(message);
      } else if (message.type === 'resize') {
        resize(message);
      }
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      const id = active ? active.id : null;
      cancelActiveFrame();
      active = null;
      releaseRenderer(id);
    }

    return { onMessage, destroy };
  }

  if (typeof self !== 'undefined' && typeof importScripts === 'function') {
    importScripts('/js/site-particle-webgl.js?v=20260727.1');
    const scheduleFrame = typeof self.requestAnimationFrame === 'function'
      ? callback => self.requestAnimationFrame(callback)
      : callback => self.setTimeout(() => callback(performance.now()), 16);
    const cancelFrame = typeof self.cancelAnimationFrame === 'function'
      ? id => self.cancelAnimationFrame(id)
      : id => self.clearTimeout(id);
    const runtime = createWorkerRuntime(self, {
      createRenderer: self.SiteParticleWebGL.createRenderer,
      requestAnimationFrame: scheduleFrame,
      cancelAnimationFrame: cancelFrame,
      now: () => performance.now()
    });
    self.onmessage = runtime.onMessage;
  }

  return {
    FIXED_STEP,
    stepWorkerParticle,
    advanceFixedParticles,
    createWorkerRuntime
  };
});
