(function (global, document) {
  "use strict";

  var THEME_KEY = "carver-theme";
  var activeTransition = null;
  var controls = null;
  var initialized = false;

  function safeWrite(key, value) {
    try { global.localStorage.setItem(key, value); } catch (error) { /* Storage may be unavailable. */ }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function themeColor(theme) {
    return theme === "dark" ? "#101311" : "#f9f9f7";
  }

  function updateControl(theme) {
    if (!controls) return;
    var dark = theme === "dark";
    controls.toggle.setAttribute("aria-pressed", String(dark));
    controls.toggle.setAttribute("aria-label", dark ? controls.lightLabel : controls.darkLabel);
    controls.toggle.setAttribute("title", dark ? controls.lightLabel : controls.darkLabel);
    var use = controls.toggle.querySelector("use");
    if (use) use.setAttribute("href", dark ? "#liquid-theme-sun" : "#liquid-theme-moon");
  }

  function applyTheme(theme, persist) {
    var normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", normalized);
    document.documentElement.style.colorScheme = normalized;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", themeColor(normalized));
    updateControl(normalized);
    if (persist !== false) safeWrite(THEME_KEY, normalized);
    document.dispatchEvent(new CustomEvent("carver:themechange", { detail: { theme: normalized } }));
  }

  function supportsAnimatedReveal() {
    return Boolean(
      global.CarverLiquidShape &&
      global.requestAnimationFrame &&
      global.CSS &&
      (CSS.supports("clip-path", "url(#liquid-theme-clip)") || CSS.supports("-webkit-clip-path", "url(#liquid-theme-clip)")) &&
      !global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function getViewport(button) {
    var viewport = global.visualViewport;
    var left = viewport ? viewport.offsetLeft : 0;
    var top = viewport ? viewport.offsetTop : 0;
    var width = viewport ? viewport.width : document.documentElement.clientWidth;
    var height = viewport ? viewport.height : document.documentElement.clientHeight;
    var rect = button.getBoundingClientRect();
    return {
      left: left,
      top: top,
      width: Math.max(1, width),
      height: Math.max(1, height),
      originX: clamp(rect.right - 5 - left, 0, width),
      originY: clamp(rect.bottom - 5 - top, 0, height)
    };
  }

  function copyControlState(source, clone) {
    if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      clone.value = source.value;
      clone.checked = source.checked;
      clone.indeterminate = source.indeterminate;
      if (typeof source.selectionStart === "number") {
        try { clone.setSelectionRange(source.selectionStart, source.selectionEnd, source.selectionDirection || "none"); } catch (error) {}
      }
    } else if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
      clone.value = source.value;
      if (typeof source.selectionStart === "number") {
        try { clone.setSelectionRange(source.selectionStart, source.selectionEnd, source.selectionDirection || "none"); } catch (error) {}
      }
    } else if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
      clone.selectedIndex = source.selectedIndex;
      Array.prototype.forEach.call(source.options, function (option, index) {
        if (clone.options[index]) clone.options[index].selected = option.selected;
      });
    } else if (source instanceof HTMLDetailsElement && clone instanceof HTMLDetailsElement) {
      clone.open = source.open;
    }
  }

  function createSnapshot(targetTheme, viewport) {
    var sourceBody = document.body;
    var cloneBody = sourceBody.cloneNode(true);
    var sourceElements = [sourceBody].concat(Array.prototype.slice.call(sourceBody.querySelectorAll("*")));
    var cloneElements = [cloneBody].concat(Array.prototype.slice.call(cloneBody.querySelectorAll("*")));
    var fixed = [];
    var scrolled = [];
    var canvases = [];

    sourceElements.forEach(function (source, index) {
      var clone = cloneElements[index];
      if (!clone) return;
      copyControlState(source, clone);
      if (source instanceof HTMLInputElement && source.type === "file" &&
          global.getComputedStyle(source).display === "none") {
        clone.style.display = "none";
      }
      if (source.scrollTop || source.scrollLeft) {
        scrolled.push({ node: clone, top: source.scrollTop, left: source.scrollLeft });
      }
      if (source instanceof HTMLCanvasElement && clone instanceof HTMLCanvasElement) {
        canvases.push({ source: source, clone: clone });
      }
      if (source !== sourceBody && source.nodeType === 1) {
        var position = global.getComputedStyle(source).position;
        if (position === "fixed" || position === "sticky") {
          var rect = source.getBoundingClientRect();
          fixed.push({
            node: clone,
            top: rect.top - viewport.top,
            left: rect.left - viewport.left,
            width: rect.width,
            height: rect.height
          });
        }
      }
    });

    cloneBody.querySelectorAll("script, iframe, object, embed, noscript").forEach(function (node) { node.remove(); });
    cloneBody.querySelectorAll("audio, video").forEach(function (media) {
      media.removeAttribute("autoplay");
      media.removeAttribute("src");
      media.querySelectorAll("source").forEach(function (source) { source.remove(); });
    });
    var snapshotToggle = cloneBody.querySelector("[data-theme-toggle]");
    if (snapshotToggle) {
      snapshotToggle.setAttribute("aria-pressed", String(targetTheme === "dark"));
      var snapshotUse = snapshotToggle.querySelector("use");
      if (snapshotUse) snapshotUse.setAttribute("href", targetTheme === "dark" ? "#liquid-theme-sun" : "#liquid-theme-moon");
    }
    cloneBody.setAttribute("data-theme", targetTheme);
    cloneBody.setAttribute("data-accent", document.documentElement.getAttribute("data-accent") || "orange");
    cloneBody.setAttribute("data-liquid-theme-snapshot", "");
    cloneBody.setAttribute("aria-hidden", "true");
    cloneBody.setAttribute("inert", "");
    cloneBody.inert = true;
    cloneBody.style.position = "absolute";
    cloneBody.style.top = -global.scrollY + "px";
    cloneBody.style.left = -global.scrollX + "px";
    cloneBody.style.width = sourceBody.getBoundingClientRect().width + "px";
    cloneBody.style.minHeight = Math.max(document.documentElement.scrollHeight, viewport.height) + "px";
    cloneBody.style.pointerEvents = "none";

    cloneBody.querySelectorAll("*").forEach(function (node) {
      Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        if (name === "id" || name.indexOf("on") === 0) node.removeAttribute(attribute.name);
      });
      node.removeAttribute("autofocus");
      if (node.matches("a, button, input, select, textarea, summary, [tabindex], [contenteditable]")) {
        node.setAttribute("tabindex", "-1");
        node.setAttribute("contenteditable", "false");
      }
    });
    cloneBody.removeAttribute("id");
    Array.prototype.slice.call(cloneBody.attributes).forEach(function (attribute) {
      if (attribute.name.toLowerCase().indexOf("on") === 0) cloneBody.removeAttribute(attribute.name);
    });

    var stage = document.createElement("div");
    stage.className = "liquid-theme-reveal";
    stage.setAttribute("data-theme", targetTheme);
    stage.setAttribute("aria-hidden", "true");
    stage.style.top = viewport.top + "px";
    stage.style.left = viewport.left + "px";
    stage.style.width = viewport.width + "px";
    stage.style.height = viewport.height + "px";
    stage.appendChild(cloneBody);
    document.documentElement.appendChild(stage);

    fixed.forEach(function (entry) {
      if (!entry.node.isConnected) return;
      entry.node.style.setProperty("position", "fixed", "important");
      entry.node.style.setProperty("top", entry.top + "px", "important");
      entry.node.style.setProperty("left", entry.left + "px", "important");
      entry.node.style.setProperty("right", "auto", "important");
      entry.node.style.setProperty("bottom", "auto", "important");
      entry.node.style.setProperty("width", entry.width + "px", "important");
      entry.node.style.setProperty("height", entry.height + "px", "important");
      entry.node.style.setProperty("transform", "none", "important");
      entry.node.style.setProperty("margin", "0", "important");
    });
    scrolled.forEach(function (entry) {
      if (!entry.node.isConnected) return;
      entry.node.scrollTop = entry.top;
      entry.node.scrollLeft = entry.left;
    });
    canvases.forEach(function (entry) {
      if (!entry.clone.isConnected) return;
      try {
        entry.clone.width = entry.source.width;
        entry.clone.height = entry.source.height;
        entry.clone.getContext("2d").drawImage(entry.source, 0, 0);
      } catch (error) { /* WebGL and protected canvases cannot be copied safely. */ }
    });

    return stage;
  }

  function createClip(viewport) {
    var namespace = "http://www.w3.org/2000/svg";
    var id = "liquid-theme-clip-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    var svg = document.createElementNS(namespace, "svg");
    var defs = document.createElementNS(namespace, "defs");
    var clip = document.createElementNS(namespace, "clipPath");
    var path = document.createElementNS(namespace, "path");
    svg.classList.add("liquid-theme-clip");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", String(viewport.width));
    svg.setAttribute("height", String(viewport.height));
    clip.setAttribute("id", id);
    clip.setAttribute("clipPathUnits", "userSpaceOnUse");
    clip.appendChild(path);
    defs.appendChild(clip);
    svg.appendChild(defs);
    document.documentElement.appendChild(svg);
    return { svg: svg, path: path, id: id };
  }


  function createPeel(button, viewport) {
    var rect = button.getBoundingClientRect();
    var ns = "http://www.w3.org/2000/svg";
    var peel = document.createElementNS(ns, "svg");
    peel.classList.add("liquid-theme-peel");
    peel.setAttribute("viewBox", "0 0 32 32");
    peel.setAttribute("aria-hidden", "true");
    peel.style.left = rect.right - 32 + "px";
    peel.style.top = rect.bottom - 32 + "px";
    var bead = document.createElementNS(ns, "ellipse");
    bead.setAttribute("fill", themeColor("dark"));
    peel.appendChild(bead);
    var shadow = document.createElementNS(ns, "path");
    shadow.style.cssText = "fill:none;stroke:#241e18;stroke-width:2;filter:blur(1.5px)";
    peel.appendChild(shadow);
    var strips = [];
    for (var i = 0; i < 28; i++) {
      var strip = document.createElementNS(ns, "path");
      strip.setAttribute("stroke-width", "0.35");
      strip.setAttribute("stroke-linejoin", "round");
      peel.appendChild(strip);
      strips.push(strip);
    }
    document.documentElement.appendChild(peel);
    function ease(x) {
      x = clamp(x, 0, 1);
      return x * x * (3 - 2 * x);
    }
    // Fixed diagonal root, with pressure and damping concentrated at the tip.
    function project(x, y, t) {
      var d = Math.max(0, (x + y - 53) / 35), side = (x - y) / 35;
      var time = t - 0.032 * d - 0.015 * side;
      var load = ease(time / 0.29) * (1 - ease((time - 1.70) / 0.38));
      var wet = ease((time - 0.24) / 0.22) * (1 - ease((time - 1.52) / 0.24));
      var age = Math.max(0, time - 1.72);
      var rebound = 0.16 * Math.exp(-8 * age) * Math.sin(32 * age);
      var pressure = wet * (0.075 * Math.sin(17 * time + 0.8 * side) +
        0.038 * Math.sin(25 * time - 1.1 * side));
      var bend = 1.84 * load + (pressure + rebound) * d * d, a = bend * d;
      var slip = Math.abs(a) < 0.00001 ? 0 : 17.5 * d * (1 - Math.sin(a) / a);
      var z = Math.abs(bend) < 0.00001 ? 0 : 17.5 * (1 - Math.cos(a)) / bend;
      return [x - 12 - slip - 0.21 * z, y - 12 - slip - 0.40 * z, a];
    }
    return {
      remove: function () { peel.remove(); },
      draw: function (p) {
        var t = p * 2.16, lip = project(44, 44, t);
        var flow = ease((p - 0.075) / 0.10) * (1 - ease((p - 0.88) / 0.08));
        viewport.originX = rect.right - 32 - viewport.left + lip[0] - 0.7;
        viewport.originY = rect.bottom - 32 - viewport.top + lip[1] - 3 * flow;
        peel.style.visibility = p > 0 && p < 0.98 ? "visible" : "hidden";
        bead.setAttribute("cx", lip[0] - 0.7);
        bead.setAttribute("cy", lip[1] + 0.4);
        bead.setAttribute("rx", 3.2 * flow);
        bead.setAttribute("ry", 5.76 * flow);
        shadow.setAttribute("d", "M32 -3 Q" + (lip[0]+4) + " " + (lip[1]+4) + " -3 32");
        shadow.style.opacity = 0.24 * flow;
        var A = project(44,9,t), D = project(9,44,t);
        for (var j = 0; j < strips.length; j++) {
          var w = 9 + 35 * (j + 1) / strips.length;
          var B = project(44,w,t), C = project(w,44,t);
          var path = strips[j], n = A[2];
          path.setAttribute("d", "M"+A[0]+" "+A[1]+"L"+B[0]+" "+B[1]+" "+
            C[0]+" "+C[1]+" "+D[0]+" "+D[1]+"Z");
          var shade = 1 - 0.19 * (1 - Math.cos(n)) + 0.055 * Math.sin(2*n);
          var tone = Math.round(249 * shade);
          var color = "rgb("+tone+","+tone+","+(tone-2)+")";
          path.setAttribute("fill", color);
          path.setAttribute("stroke", color);
          A = B; D = C;
        }
      }
    };
  }

  function runReveal(targetTheme) {
    var viewport = getViewport(controls.toggle);
    var reverse = targetTheme === "light";
    // Reversing the same clip drains the old dark snapshot into the trigger.
    var stage = createSnapshot(reverse ? "dark" : targetTheme, viewport);
    var clip = createClip(viewport);
    var namespace = "http://www.w3.org/2000/svg";
    var waterSvg = document.createElementNS(namespace, "svg");
    var water = document.createElementNS(namespace, "path");
    var texture = document.createElementNS(namespace, "pattern");
    var base = document.createElementNS(namespace, "rect");
    var dot = document.createElementNS(namespace, "circle");
    var defs = document.createElementNS(namespace, "defs");
    texture.setAttribute("id", clip.id + "-water");
    texture.setAttribute("patternUnits", "userSpaceOnUse");
    texture.setAttribute("width", "32");
    texture.setAttribute("height", "32");
    base.setAttribute("width", "32");
    base.setAttribute("height", "32");
    base.style.fill = "var(--bg-page)";
    dot.setAttribute("r", "1");
    dot.style.fill = "var(--paper-dot)";
    dot.setAttribute("opacity", "0.6");
    texture.appendChild(base);
    texture.appendChild(dot);
    defs.appendChild(texture);
    waterSvg.appendChild(defs);
    waterSvg.setAttribute("viewBox", "0 0 " + viewport.width + " " + viewport.height);
    waterSvg.setAttribute("aria-hidden", "true");
    waterSvg.classList.add("liquid-theme-stream");
    waterSvg.setAttribute("data-theme", "dark");
    waterSvg.style.left = viewport.left + "px";
    waterSvg.style.top = viewport.top + "px";
    waterSvg.style.width = viewport.width + "px";
    waterSvg.style.height = viewport.height + "px";
    water.style.fill = 'url("#' + clip.id + '-water")';
    waterSvg.appendChild(water);
    document.documentElement.appendChild(waterSvg);
    var duration = controls.duration;
    var peel = createPeel(controls.toggle, viewport);
    peel.draw(reverse ? 1 : 0);
    var animationFrame = 0;
    var startedAt = 0;
    var finished = false;
    var abort = null;
    var eventTargets = [global];

    stage.style.clipPath = 'url("#' + clip.id + '")';
    stage.style.webkitClipPath = 'url("#' + clip.id + '")';
    var initial = global.CarverLiquidShape.createFrame(reverse ? 1 : 0.001, viewport);
    clip.path.setAttribute("d", initial.shape);
    water.setAttribute("d", initial.water);
    if (reverse) {
      // The full-screen clip covers the live page while the target variables switch.
      document.documentElement.setAttribute("data-theme", targetTheme);
      document.documentElement.style.colorScheme = targetTheme;
    }

    function cleanup() {
      if (finished) return;
      finished = true;
      if (animationFrame) global.cancelAnimationFrame(animationFrame);
      eventTargets.forEach(function (target) {
        target.removeEventListener("scroll", abort, true);
        target.removeEventListener("resize", abort, true);
      });
      document.removeEventListener("visibilitychange", abort);
      global.removeEventListener("pagehide", abort);
      stage.remove();
      waterSvg.remove();
      clip.svg.remove();
      peel.remove();
      if (activeTransition && activeTransition.cleanup === cleanup) activeTransition = null;
    }

    function finish(commit) {
      if (finished) return;
      if (commit) applyTheme(targetTheme, true);
      cleanup();
    }

    abort = function () { finish(true); };
    eventTargets.forEach(function (target) {
      target.addEventListener("scroll", abort, { capture: true, passive: true });
      target.addEventListener("resize", abort, { capture: true, passive: true });
    });
    if (global.visualViewport) {
      eventTargets.push(global.visualViewport);
      global.visualViewport.addEventListener("scroll", abort, { capture: true, passive: true });
      global.visualViewport.addEventListener("resize", abort, { capture: true, passive: true });
    }
    document.addEventListener("visibilitychange", abort);
    global.addEventListener("pagehide", abort);

    function frame(timestamp) {
      if (finished) return;
      if (!startedAt) startedAt = timestamp;
      var progress = clamp((timestamp - startedAt) / duration, 0, 1);
      var liquidProgress = reverse ? 1 - progress : progress;
      peel.draw(liquidProgress);
      var shape = global.CarverLiquidShape.createFrame(liquidProgress, viewport);
      clip.path.setAttribute("d", shape.shape);
      water.setAttribute("d", shape.water);
      if (progress >= 1) {
        finish(true);
        return;
      }
      animationFrame = global.requestAnimationFrame(frame);
    }

    activeTransition = { cleanup: cleanup, finish: finish, theme: targetTheme };
    animationFrame = global.requestAnimationFrame(frame);
  }

  function switchTheme(theme) {
    var target = theme === "dark" || theme === "light"
      ? theme
      : currentTheme() === "dark" ? "light" : "dark";
    if (!controls) {
      applyTheme(target, true);
      return;
    }
    if (activeTransition) {
      activeTransition.finish(true);
      return;
    }
    if (target === currentTheme()) return;

    if (!supportsAnimatedReveal()) {
      applyTheme(target, true);
      return;
    }
    safeWrite(THEME_KEY, target);
    runReveal(target);
  }

  function initialize() {
    if (initialized) return;
    var root = document.querySelector("[data-liquid-theme-controls]");
    if (!root) return;
    var toggle = root.querySelector("[data-theme-toggle]");
    if (!toggle) return;
    initialized = true;

    controls = {
      root: root,
      toggle: toggle,
      duration: clamp(Number(root.getAttribute("data-duration")) || 1450, 400, 5000),
      darkLabel: root.getAttribute("data-label-dark") || "Switch to dark theme",
      lightLabel: root.getAttribute("data-label-light") || "Switch to light theme"
    };
    updateControl(currentTheme());
    toggle.addEventListener("click", function () { switchTheme(); });
  }

  global.CarverLiquidTheme = Object.freeze({
    init: initialize,
    switchTheme: switchTheme,
    cancel: function () { if (activeTransition) activeTransition.finish(true); },
    getTheme: currentTheme
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  global.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    try {
      var stored = global.localStorage.getItem(THEME_KEY);
      if ((stored === "dark" || stored === "light") && stored !== currentTheme()) {
        applyTheme(stored, false);
      }
    } catch (error) { /* Storage may be unavailable. */ }
  });
})(window, document);
