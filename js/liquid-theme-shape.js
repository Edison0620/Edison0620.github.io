(function (global) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function easeInOutCubic(value) {
    return value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function circlePath(x, y, radius) {
    return [
      "M", x - radius, y,
      "a", radius, radius, 0, 1, 0, radius * 2, 0,
      "a", radius, radius, 0, 1, 0, -radius * 2, 0,
      "Z"
    ].join(" ");
  }

  function streamPath(progress, geometry) {
    var width = geometry.width;
    var originX = geometry.originX;
    var pour = clamp(progress / 0.24, 0, 1);
    var tail = easeInOutCubic(clamp((progress - 0.31) / 0.14, 0, 1));
    if (pour <= 0 || tail >= 0.99) return "";

    // Once the stream lands, its trailing end falls into the rising pool.
    var originY = geometry.originY + (geometry.height - geometry.originY - 8) * tail;
    var length = (geometry.height - originY + 18) * easeInOutCubic(pour);
    var tip = originY + length;
    var sway = Math.sin(progress * Math.PI * 6) * Math.min(28, width * 0.07) * pour;
    var ripple = Math.sin(progress * 39);
    var neck = 3.5 + pour;
    var waist = 8 + pour * 6 + ripple * 2;
    var belly = 10 + pour * 7 + Math.sin(progress * 28 + 0.8) * 3;
    var x1 = originX + sway * 0.3 + ripple * 4 * pour;
    var x2 = originX + sway + Math.sin(progress * 24 + 1.2) * 5 * pour;
    var endX = originX + sway * 0.8;

    // Keep the stream clockwise like the wave so their overlap remains a union.
    return [
      "M", originX + neck, originY,
      "C", originX + neck, originY + length * 0.12,
      x1 + waist, originY + length * 0.19,
      x1 + waist, originY + length * 0.32,
      "C", x1 + waist + 4, originY + length * 0.48,
      x2 + belly, originY + length * 0.55,
      x2 + belly, originY + length * 0.73,
      "Q", x2 + belly, tip - length * 0.07, endX, tip,
      "Q", x2 - belly, tip - length * 0.07,
      x2 - belly, originY + length * 0.73,
      "C", x2 - belly, originY + length * 0.55,
      x1 - waist - 4, originY + length * 0.48,
      x1 - waist, originY + length * 0.32,
      "C", x1 - waist, originY + length * 0.19,
      originX - neck, originY + length * 0.12,
      originX - neck, originY,
      "Z"
    ].join(" ");
  }

  function detachedDrops(progress, geometry) {
    if (progress < 0.035 || progress > 0.43) return "";

    var local = clamp((progress - 0.035) / 0.28, 0, 1);
    var paths = [];
    var count = 3;
    for (var index = 0; index < count; index += 1) {
      var phase = clamp(local * 1.55 - index * 0.25, 0, 1);
      if (phase <= 0 || phase >= 1) continue;
      var direction = index % 2 ? -1 : 1;
      var x = geometry.originX + direction * (10 + index * 7) + Math.sin(progress * 22 + index) * 5;
      var y = geometry.originY + (geometry.height - geometry.originY) * easeOutCubic(phase);
      var radius = 2.5 + (1 - phase) * (3 + index);
      paths.push(circlePath(x, y, radius));
    }
    return paths.join(" ");
  }

  function splashPath(progress, geometry) {
    var splash = clamp((progress - 0.2) / 0.22, 0, 1);
    if (splash <= 0 || splash >= 1) return "";

    var paths = [];
    var energy = Math.sin(splash * Math.PI);
    var centerX = geometry.originX + Math.sin(progress * 31) * 8;
    var baseY = geometry.height - 4;
    var offsets = [-42, -25, 24, 45];
    for (var index = 0; index < offsets.length; index += 1) {
      var direction = offsets[index] < 0 ? -1 : 1;
      var x = centerX + offsets[index] * energy;
      var y = baseY - (20 + index % 2 * 16) * energy - Math.abs(offsets[index]) * 0.15;
      paths.push(circlePath(x, y, 2.5 + energy * 2));
      paths.push([
        "M", centerX + direction * 5, baseY,
        "Q", centerX + offsets[index] * 0.55, baseY - (18 + index * 3) * energy,
        x, y + 5,
        "Q", centerX + offsets[index] * 0.5, baseY - 4,
        centerX + direction * 11, baseY,
        "Z"
      ].join(" "));
    }

    var rippleWidth = 28 + energy * 72;
    paths.push([
      "M", centerX - rippleWidth, baseY,
      "Q", centerX, baseY - 8 * energy, centerX + rippleWidth, baseY,
      "Q", centerX, baseY + 5, centerX - rippleWidth, baseY,
      "Z"
    ].join(" "));
    return paths.join(" ");
  }

  function surfacePath(progress, geometry) {
    var fill = clamp((progress - 0.22) / 0.75, 0, 1);
    if (fill <= 0) return "";
    if (fill >= 0.995) {
      return "M 0 0 H " + geometry.width + " V " + geometry.height + " H 0 Z";
    }

    var eased = easeInOutCubic(fill);
    var amplitude = Math.max(5, Math.min(22, geometry.height * 0.025)) * (1 - fill * 0.65);
    var waveY = geometry.height + amplitude - (geometry.height + amplitude * 2) * eased;
    var segment = geometry.width / 6;
    var phase = progress * Math.PI * 8;
    var path = ["M", 0, geometry.height, "L", 0, waveY];

    for (var index = 0; index < 6; index += 1) {
      var startX = index * segment;
      var endX = (index + 1) * segment;
      var direction = index % 2 ? -1 : 1;
      var y1 = waveY + Math.sin(phase + index * 0.9) * amplitude * 0.42;
      var y2 = waveY + direction * amplitude + Math.cos(phase * 0.8 + index) * amplitude * 0.28;
      path.push("C", startX + segment * 0.3, y1, startX + segment * 0.7, y2, endX, waveY);
    }

    path.push("L", geometry.width, geometry.height, "Z");
    return path.join(" ");
  }

  function createPath(progress, geometry) {
    var normalized = clamp(progress, 0, 1);
    if (normalized >= 0.995) {
      return "M 0 0 H " + geometry.width + " V " + geometry.height + " H 0 Z";
    }
    return [
      surfacePath(normalized, geometry),
      streamPath(normalized, geometry),
      detachedDrops(normalized, geometry),
      splashPath(normalized, geometry)
    ].filter(Boolean).join(" ");
  }

  global.EishanLiquidShape = Object.freeze({
    createPath: createPath,
    phases: Object.freeze({ pour: 0, splash: 0.2, flow: 0.32, finish: 0.97 })
  });
})(window);
