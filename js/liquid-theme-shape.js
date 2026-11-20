(function (global) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  var contact = 0.16;

  function fillFraction(progress) {
    return clamp((progress - contact) / (0.98 - contact), 0, 1);
  }

  function surfaceLevel(progress, geometry) {
    var fill = fillFraction(progress);
    var margin = Math.max(5, Math.min(22, geometry.height * 0.025));
    return geometry.height - (geometry.height + margin) * fill;
  }

  function waveOffset(x, progress, geometry) {
    var fill = fillFraction(progress);
    if (!fill) return 0;
    var age = progress - contact;
    var amplitude = Math.max(5, Math.min(22, geometry.height * 0.025)) *
      Math.pow(1 - fill, 0.7) * Math.min(1, age / 0.10);
    var wavelength = Math.max(170, Math.min(400, geometry.width * 0.38));
    var traveling = Math.sin(x * Math.PI * 2 / wavelength - progress * 12) * amplitude * 0.72;
    // Two low pressure ridges travel outward once, leaving a shallow inlet.
    var distance = x - geometry.originX;
    var reach = (distance < 0 ? 420 : 510) * age;
    var width = 8 + 38 * age;
    var attack = 1 - Math.exp(-age * 85);
    var ridge = (distance < 0 ? 12 : 16) * attack * Math.exp(-age * 8) *
      Math.exp(-Math.pow((Math.abs(distance) - reach) / width, 2));
    var inlet = 4 * attack * Math.exp(-distance * distance / 100) * (1 - fill);
    return traveling + inlet - ridge;
  }

  function waterline(x, progress, geometry) {
    return surfaceLevel(progress, geometry) + waveOffset(x, progress, geometry);
  }


  function surfacePath(progress, geometry) {
    var fill = fillFraction(progress);
    if (fill <= 0) return "";
    if (fill >= 0.995) {
      return "M 0 0 H " + geometry.width + " V " + geometry.height + " H 0 Z";
    }

    var segment = geometry.width / 12;
    var path = ["M", 0, geometry.height, "L", 0, waterline(0, progress, geometry)];

    // Sample the same traveling wave at both ends of each cubic: no fixed
    // horizontal seams or repeating identical humps between segments.
    var near = Math.max(0, geometry.originX - 150);
    var far = Math.min(geometry.width, geometry.originX + 150);
    for (var startX = 0, endX; startX < geometry.width; startX = endX) {
      endX = startX < near ? Math.min(startX + segment, near) :
        startX < far ? Math.min(startX + 7, far) : Math.min(startX + segment, geometry.width);
      var span = endX - startX;
      var startY = waterline(startX, progress, geometry);
      var endY = waterline(endX, progress, geometry);
      var startSlope = (waterline(startX + 1, progress, geometry) -
        waterline(startX - 1, progress, geometry)) / 2;
      var endSlope = (waterline(endX + 1, progress, geometry) -
        waterline(endX - 1, progress, geometry)) / 2;
      path.push("C", startX + span / 3, startY + startSlope * span / 3,
        endX - span / 3, endY - endSlope * span / 3, endX, endY);
    }

    path.push("L", geometry.width, geometry.height, "Z");
    return path.join(" ");
  }

  function createPath(progress, geometry) {
    return surfacePath(clamp(progress, 0, 1), geometry);
  }

  global.CarverLiquidShape = Object.freeze({
    createPath: createPath,
    phases: Object.freeze({ flow: contact, finish: 0.98 })
  });
})(window);
