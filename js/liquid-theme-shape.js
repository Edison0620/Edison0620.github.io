(function (global) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function circlePath(x, y, radius) {
    return [
      "M", x - radius, y,
      "a", radius, radius, 0, 1, 0, radius * 2, 0,
      "a", radius, radius, 0, 1, 0, -radius * 2, 0,
      "Z"
    ].join(" ");
  }

  function surfaceLevel(progress, geometry) {
    var fill = clamp((progress - 0.16) / 0.82, 0, 1);
    var amplitude = Math.max(5, Math.min(22, geometry.height * 0.025)) * (1 - fill * 0.65);
    return geometry.height + amplitude - (geometry.height + amplitude * 2) * fill;
  }

  function waveOffset(x, progress, geometry) {
    var fill = clamp((progress - 0.16) / 0.82, 0, 1);
    var amplitude = Math.max(5, Math.min(22, geometry.height * 0.025)) * Math.pow(1 - fill, 0.7);
    var wavelength = Math.max(170, Math.min(400, geometry.width * 0.38));
    var traveling = Math.sin(x * Math.PI * 2 / wavelength - progress * 12) * amplitude * 0.72;
    var impact = Math.sin(Math.PI * clamp((progress - 0.2) / 0.55, 0, 1));
    var distance = x - geometry.originX;
    var spread = 48 + progress * 180;
    var swell = impact * amplitude * 0.65 * Math.exp(-Math.pow(distance / spread, 2)) *
      Math.cos(distance / 25 - progress * 16);
    return traveling + swell;
  }

  function waterline(x, progress, geometry) {
    return surfaceLevel(progress, geometry) + waveOffset(x, progress, geometry);
  }

  function flowEdge(y, originX, originY, progress, side, widthScale) {
    var depth = y - originY;
    var sway = Math.min(1, depth / 76) *
      (Math.sin(depth / 82 - progress * 15) * 6 + Math.sin(depth / 163 - progress * 9) * 3);
    var width = Math.max(10.5, 12.5 +
      Math.sin(depth / 46 - progress * 33) * 3 +
      Math.sin(depth / 102 - progress * 21) * 2);
    return originX + sway + side * width * widthScale;
  }

  function streamPath(progress, geometry) {
    var originX = geometry.originX;
    var pour = clamp(progress / 0.22, 0, 1);
    if (pour <= 0) return "";

    var surfaceY = waterline(originX, progress, geometry);
    var originY = geometry.originY;
    var depth = surfaceY - originY;
    if (depth <= 0) return "";
    var widthScale = clamp(depth / 38, 0, 1);
    var tip = originY + (depth + 3 * widthScale) * pour;
    if (tip - originY < 1) return "";

    // Traveling edge undulations give the continuous stream a flowing silhouette.
    var sections = Math.max(2, Math.ceil((tip - originY) / 48));
    var step = (tip - originY) / sections;
    var path = ["M", flowEdge(originY, originX, originY, progress, -1, widthScale), originY];
    for (var index = 0; index < sections; index += 1) {
      var start = originY + step * index;
      var end = start + step;
      path.push("C",
        flowEdge(start + step / 3, originX, originY, progress, -1, widthScale), start + step / 3,
        flowEdge(end - step / 3, originX, originY, progress, -1, widthScale), end - step / 3,
        flowEdge(end, originX, originY, progress, -1, widthScale), end);
    }
    path.push("Q", flowEdge(tip, originX, originY, progress, 0, widthScale), tip + 5 * widthScale,
      flowEdge(tip, originX, originY, progress, 1, widthScale), tip);
    for (var reverse = sections - 1; reverse >= 0; reverse -= 1) {
      var bottom = originY + step * (reverse + 1);
      var top = bottom - step;
      path.push("C",
        flowEdge(bottom - step / 3, originX, originY, progress, 1, widthScale), bottom - step / 3,
        flowEdge(top + step / 3, originX, originY, progress, 1, widthScale), top + step / 3,
        flowEdge(top, originX, originY, progress, 1, widthScale), top);
    }
    path.push("Z");
    return path.join(" ");
  }

  function splashPath(progress, geometry) {
    var splash = clamp((progress - 0.2) / 0.22, 0, 1);
    if (splash <= 0 || splash >= 1) return "";

    var paths = [];
    var energy = Math.sin(splash * Math.PI);
    var centerX = geometry.originX + Math.sin(progress * 31) * 8;
    var baseY = waterline(centerX, progress, geometry);
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
    var fill = clamp((progress - 0.16) / 0.82, 0, 1);
    if (fill <= 0) return "";
    if (fill >= 0.995) {
      return "M 0 0 H " + geometry.width + " V " + geometry.height + " H 0 Z";
    }

    var segment = geometry.width / 12;
    var path = ["M", 0, geometry.height, "L", 0, waterline(0, progress, geometry)];

    // Sample the same traveling wave at both ends of each cubic: no fixed
    // horizontal seams or repeating identical humps between segments.
    for (var index = 0; index < 12; index += 1) {
      var startX = index * segment;
      var endX = (index + 1) * segment;
      var startY = waterline(startX, progress, geometry);
      var endY = waterline(endX, progress, geometry);
      var startSlope = (waterline(startX + 1, progress, geometry) -
        waterline(startX - 1, progress, geometry)) / 2;
      var endSlope = (waterline(endX + 1, progress, geometry) -
        waterline(endX - 1, progress, geometry)) / 2;
      path.push("C", startX + segment / 3, startY + startSlope * segment / 3,
        endX - segment / 3, endY - endSlope * segment / 3, endX, endY);
    }

    path.push("L", geometry.width, geometry.height, "Z");
    return path.join(" ");
  }

  function createFrame(progress, geometry) {
    var normalized = clamp(progress, 0, 1);
    if (normalized >= 0.995) {
      return { shape: "M 0 0 H " + geometry.width + " V " + geometry.height + " H 0 Z", water: "" };
    }
    var water = streamPath(normalized, geometry);
    return {
      shape: [surfacePath(normalized, geometry), water, splashPath(normalized, geometry)]
        .filter(Boolean).join(" "),
      water: water
    };
  }

  function createPath(progress, geometry) {
    return createFrame(progress, geometry).shape;
  }

  global.EishanLiquidShape = Object.freeze({
    createPath: createPath,
    createFrame: createFrame,
    phases: Object.freeze({ pour: 0, splash: 0.2, flow: 0.16, finish: 0.98 })
  });
})(window);
