'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteParticleWebGL = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function() {
  const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_geometry;
layout(location = 2) in vec2 a_rotationOpacity;
layout(location = 3) in vec4 a_uv;
uniform vec2 u_viewport;
out vec2 v_uv;
out float v_opacity;
void main() {
  vec2 local = a_corner * a_geometry.zw;
  float c = cos(a_rotationOpacity.x);
  float s = sin(a_rotationOpacity.x);
  vec2 rotated = mat2(c, s, -s, c) * local;
  vec2 pixel = a_geometry.xy + a_geometry.zw * 0.5 + rotated;
  vec2 clip = vec2(
    pixel.x / u_viewport.x * 2.0 - 1.0,
    1.0 - pixel.y / u_viewport.y * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner + 0.5);
  v_opacity = a_rotationOpacity.y;
}`;

  const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in float v_opacity;
out vec4 outColor;
void main() {
  vec4 color = texture(u_atlas, v_uv);
  outColor = vec4(color.rgb * v_opacity, color.a * v_opacity);
}`;

  function compileShader(gl, type, label, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`Unable to create ${label.toLowerCase()} shader`);
    try {
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) || 'No driver log was provided';
        throw new Error(`${label} shader compilation failed: ${log}`);
      }
      return shader;
    } catch (error) {
      gl.deleteShader(shader);
      throw error;
    }
  }

  function createRenderer(gl, options) {
    const pages = Array.isArray(options && options.pages) ? options.pages : [];
    const shaders = [];
    const buffers = [];
    const textures = [];
    let program = null;
    let vertexArray = null;
    let destroyed = false;
    let pagesClosed = false;
    let viewportLocation = null;
    let atlasLocation = null;

    function releaseResources() {
      for (const texture of textures) gl.deleteTexture(texture);
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (program) gl.deleteProgram(program);
      for (const shader of shaders) gl.deleteShader(shader);
    }

    function assertActive() {
      if (destroyed) throw new Error('Particle renderer is destroyed');
    }

    function assertHealthy(operation) {
      if (gl.isContextLost()) {
        throw new Error(`${operation} failed: WebGL context is lost`);
      }
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        throw new Error(
          `${operation} failed with WebGL error 0x${error.toString(16)}`
        );
      }
    }

    function applyViewport(viewport) {
      const width = Number(viewport && viewport.width);
      const height = Number(viewport && viewport.height);
      const dpr = Number(viewport && viewport.dpr);
      if (!Number.isFinite(width) || width <= 0
        || !Number.isFinite(height) || height <= 0
        || !Number.isFinite(dpr) || dpr <= 0) {
        throw new Error('Particle renderer viewport is invalid');
      }
      const physicalWidth = Math.max(1, Math.round(width * dpr));
      const physicalHeight = Math.max(1, Math.round(height * dpr));
      gl.canvas.width = physicalWidth;
      gl.canvas.height = physicalHeight;
      gl.viewport(0, 0, physicalWidth, physicalHeight);
      gl.useProgram(program);
      gl.uniform2f(viewportLocation, width, height);
    }

    function createAttributeBuffer(location, size, divisor, data, usage) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Unable to create particle buffer');
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
      if (divisor) gl.vertexAttribDivisor(location, divisor);
      return buffer;
    }

    function closePages() {
      if (pagesClosed) return null;
      pagesClosed = true;
      let firstError = null;
      for (const page of pages) {
        if (!page || typeof page.close !== 'function') continue;
        try {
          page.close();
        } catch (error) {
          if (!firstError) firstError = error;
        }
      }
      return firstError;
    }

    try {
      const vertexShader = compileShader(
        gl,
        gl.VERTEX_SHADER,
        'Vertex',
        VERTEX_SHADER_SOURCE
      );
      shaders.push(vertexShader);
      const fragmentShader = compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        'Fragment',
        FRAGMENT_SHADER_SOURCE
      );
      shaders.push(fragmentShader);

      program = gl.createProgram();
      if (!program) throw new Error('Unable to create particle program');
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || 'No driver log was provided';
        throw new Error(`Program link failed: ${log}`);
      }
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      shaders.length = 0;

      viewportLocation = gl.getUniformLocation(program, 'u_viewport');
      atlasLocation = gl.getUniformLocation(program, 'u_atlas');
      if (viewportLocation === null || atlasLocation === null) {
        throw new Error('Particle shader uniforms are unavailable');
      }

      vertexArray = gl.createVertexArray();
      if (!vertexArray) throw new Error('Unable to create particle vertex array');
      gl.bindVertexArray(vertexArray);
      createAttributeBuffer(
        0,
        2,
        0,
        new Float32Array([
          -0.5, -0.5,
          0.5, -0.5,
          -0.5, 0.5,
          0.5, 0.5
        ]),
        gl.STATIC_DRAW
      );
      const geometryBuffer = createAttributeBuffer(
        1, 4, 1, new Float32Array(0), gl.DYNAMIC_DRAW
      );
      const rotationOpacityBuffer = createAttributeBuffer(
        2, 2, 1, new Float32Array(0), gl.DYNAMIC_DRAW
      );
      const uvBuffer = createAttributeBuffer(
        3, 4, 1, new Float32Array(0), gl.DYNAMIC_DRAW
      );

      gl.useProgram(program);
      gl.uniform1i(atlasLocation, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

      let uploadError = null;
      try {
        for (const page of pages) {
          const texture = gl.createTexture();
          if (!texture) throw new Error('Unable to create atlas texture');
          textures.push(texture);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(
            gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR
          );
          gl.texParameteri(
            gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR
          );
          gl.texParameteri(
            gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE
          );
          gl.texParameteri(
            gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE
          );
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            page
          );
          assertHealthy('Atlas texture upload');
        }
      } catch (error) {
        uploadError = error;
      }
      const closeError = closePages();
      if (uploadError) throw uploadError;
      if (closeError) throw closeError;

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      applyViewport(options);
      assertHealthy('Renderer initialization');

      function upload(buffer, data) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      }

      function draw(particles) {
        assertActive();
        if (!Array.isArray(particles)) {
          throw new Error('Particle list is invalid');
        }
        const groups = Array.from({ length: textures.length }, () => []);
        for (const particle of particles) {
          if (!particle || !Number.isInteger(particle.page)
            || particle.page < 0 || particle.page >= groups.length) {
            throw new Error('Particle atlas page is invalid');
          }
          groups[particle.page].push(particle);
        }

        gl.useProgram(program);
        gl.bindVertexArray(vertexArray);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (let page = 0; page < groups.length; page += 1) {
          const group = groups[page];
          if (!group.length) continue;
          const geometry = new Float32Array(group.length * 4);
          const rotationOpacity = new Float32Array(group.length * 2);
          const uv = new Float32Array(group.length * 4);
          for (let index = 0; index < group.length; index += 1) {
            const particle = group[index];
            const geometryOffset = index * 4;
            const rotationOpacityOffset = index * 2;
            geometry[geometryOffset] = particle.x;
            geometry[geometryOffset + 1] = particle.y;
            geometry[geometryOffset + 2] = particle.w;
            geometry[geometryOffset + 3] = particle.h;
            rotationOpacity[rotationOpacityOffset] = particle.rot;
            rotationOpacity[rotationOpacityOffset + 1] = particle.opacity;
            uv[geometryOffset] = particle.u0;
            uv[geometryOffset + 1] = particle.v0;
            uv[geometryOffset + 2] = particle.u1;
            uv[geometryOffset + 3] = particle.v1;
          }
          upload(geometryBuffer, geometry);
          upload(rotationOpacityBuffer, rotationOpacity);
          upload(uvBuffer, uv);
          gl.bindTexture(gl.TEXTURE_2D, textures[page]);
          gl.drawArraysInstanced(
            gl.TRIANGLE_STRIP,
            0,
            4,
            group.length
          );
        }
        assertHealthy('Particle draw');
      }

      function resize(viewport) {
        assertActive();
        applyViewport(viewport);
        assertHealthy('Renderer resize');
      }

      function destroy() {
        if (destroyed) return;
        destroyed = true;
        releaseResources();
      }

      return { draw, resize, destroy };
    } catch (error) {
      closePages();
      releaseResources();
      throw error;
    }
  }

  return { createRenderer };
});
