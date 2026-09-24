/* Small WebGL2 helpers: program compilation with readable errors, textures, framebuffers. */
(function (root) {
  'use strict';

  function compile(gl, type, src, label) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || '';
      const lines = src.split('\n');
      const m = /ERROR: \d+:(\d+)/.exec(log);
      const at = m ? +m[1] : 0;
      const ctx = at ? lines.slice(Math.max(0, at - 3), at + 2).map((l, i) => `${Math.max(1, at - 2) + i}: ${l}`).join('\n') : '';
      throw new Error(`Shader compile failed (${label}):\n${log}\n${ctx}`);
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc, label) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc, label + ' vs'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + ' fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link failed (${label}): ${gl.getProgramInfoLog(p)}`);
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      uniforms[name] = gl.getUniformLocation(p, info.name);
    }
    return { program: p, uniforms, label };
  }

  function texture2D(gl, { width, height, internalFormat, format, type, data = null, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE }) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
  }

  function framebuffer(gl, tex, target = gl.TEXTURE_2D) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, target, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) return null;
    return fb;
  }

  // ------------------------------------------------------------ tiny mat4 kit
  const mat4 = {
    perspective(fovY, aspect, near, far) {
      const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    /** View matrix from camera position and orthonormal right/up/forward vectors. */
    view(eye, right, up, fwd) {
      const b = [-fwd[0], -fwd[1], -fwd[2]];
      const dot = (v) => v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2];
      return new Float32Array([
        right[0], up[0], b[0], 0,
        right[1], up[1], b[1], 0,
        right[2], up[2], b[2], 0,
        -dot(right), -dot(up), -dot(b), 1,
      ]);
    },
    multiply(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          o[c * 4 + r] = s;
        }
      return o;
    },
    transform(m, v) {
      const x = v[0], y = v[1], z = v[2];
      return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
        m[3] * x + m[7] * y + m[11] * z + m[15],
      ];
    },
  };

  /** Off-axis lens shift: move the image centre by `shift` in NDC (clip.xy += shift * clip.w). */
  function shiftProjection(m, shift) {
    if (!shift) return m;
    const o = Float32Array.from(m);
    for (let c = 0; c < 4; c++) {
      o[c * 4] += shift[0] * m[c * 4 + 3];
      o[c * 4 + 1] += shift[1] * m[c * 4 + 3];
    }
    return o;
  }

  root.GLKit = { program, texture2D, framebuffer, mat4, shiftProjection };
})(typeof globalThis !== 'undefined' ? globalThis : this);
