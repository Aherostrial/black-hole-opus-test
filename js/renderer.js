/*
 * WebGL2 renderer: ray-traced black hole -> HDR target -> bloom -> tone-mapped composite,
 * then additive overlays (trajectories, guides) in the same camera.
 */
(function (root) {
  'use strict';
  const S = root.BHShaders;
  const K = root.GLKit;
  const Phys = root.BHPhysics;

  class LineBatch {
    constructor(gl) {
      this.gl = gl;
      this.vao = gl.createVertexArray();
      this.vbo = gl.createBuffer();
      this.ibo = gl.createBuffer();
      this.count = 0;
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      const stride = 12 * 4;
      const attr = (loc, size, off) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
      };
      attr(0, 3, 0);
      attr(1, 3, 3);
      attr(2, 3, 6);
      attr(3, 1, 9);
      attr(4, 1, 10);
      attr(5, 1, 11);
      gl.bindVertexArray(null);
    }

    /** polylines: array of { points: Float32Array, stride: 3 | 4 } (4th component = time). */
    set(polylines) {
      let nv = 0, ni = 0;
      for (const pl of polylines) {
        const n = Math.floor(pl.points.length / pl.stride);
        if (n < 2) continue;
        nv += n * 2;
        ni += (n - 1) * 6;
      }
      const v = new Float32Array(nv * 12);
      const idx = new Uint32Array(ni);
      let vo = 0, io = 0, base = 0;
      for (const pl of polylines) {
        const st = pl.stride, P = pl.points;
        const n = Math.floor(P.length / st);
        if (n < 2) continue;
        let dist = 0;
        for (let i = 0; i < n; i++) {
          const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
          if (i > 0) dist += Math.hypot(P[i * st] - P[ip * st], P[i * st + 1] - P[ip * st + 1], P[i * st + 2] - P[ip * st + 2]);
          const t = st === 4 ? P[i * st + 3] : 0;
          for (const side of [-1, 1]) {
            v[vo++] = P[i * st]; v[vo++] = P[i * st + 1]; v[vo++] = P[i * st + 2];
            v[vo++] = P[ip * st]; v[vo++] = P[ip * st + 1]; v[vo++] = P[ip * st + 2];
            v[vo++] = P[inx * st]; v[vo++] = P[inx * st + 1]; v[vo++] = P[inx * st + 2];
            v[vo++] = side; v[vo++] = dist; v[vo++] = t;
          }
        }
        for (let i = 0; i < n - 1; i++) {
          const b = base + 2 * i;
          idx[io++] = b; idx[io++] = b + 1; idx[io++] = b + 2;
          idx[io++] = b + 1; idx[io++] = b + 3; idx[io++] = b + 2;
        }
        base += n * 2;
      }
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      this.count = ni;
    }

    dispose() {
      const gl = this.gl;
      gl.deleteBuffer(this.vbo);
      gl.deleteBuffer(this.ibo);
      gl.deleteVertexArray(this.vao);
    }
  }

  class Renderer {
    constructor(canvas, opts = {}) {
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');
      this.gl = gl;
      this.canvas = canvas;
      this.hdr = !!gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('OES_texture_float_linear');
      this.rtFormat = this.hdr ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };

      this.progs = {
        trace: K.program(gl, S.FULLSCREEN_VS, S.TRACE_FS, 'trace'),
        sky: K.program(gl, S.FULLSCREEN_VS, S.SKY_BAKE_FS, 'sky'),
        down: K.program(gl, S.FULLSCREEN_VS, S.BLOOM_DOWN_FS, 'bloom down'),
        up: K.program(gl, S.FULLSCREEN_VS, S.BLOOM_UP_FS, 'bloom up'),
        comp: K.program(gl, S.FULLSCREEN_VS, S.COMPOSITE_FS, 'composite'),
        line: K.program(gl, S.LINE_VS, S.LINE_FS, 'lines'),
        point: K.program(gl, S.POINT_VS, S.POINT_FS, 'points'),
      };
      this.emptyVao = gl.createVertexArray();

      // Blackbody lookup table
      this.bbLogMin = Math.log(Phys.BB_T_MIN);
      this.bbLogRange = Math.log(Phys.BB_T_MAX) - this.bbLogMin;
      this.bbTex = K.texture2D(gl, { width: 256, height: 1, internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.FLOAT, data: Phys.blackbodyLUT(256) });
      this.tempTex = K.texture2D(gl, { width: 256, height: 1, internalFormat: gl.R16F, format: gl.RED, type: gl.FLOAT, data: new Float32Array(256) });
      this.probeTex = K.texture2D(gl, { width: 2, height: 2, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: new Float32Array(16), filter: gl.NEAREST });

      // Point sprites
      this.pointVao = gl.createVertexArray();
      this.pointVbo = gl.createBuffer();
      gl.bindVertexArray(this.pointVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
      gl.bindVertexArray(null);

      this.skySize = opts.skySize || 1024;
      this.bakeSky(this.skySize);
      this.targets = null;
      this.lastSize = [0, 0, 0, 0];
    }

    newLineBatch() {
      return new LineBatch(this.gl);
    }

    setTemperatureProfile(data) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tempTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, data.length, 1, 0, gl.RED, gl.FLOAT, data);
    }

    setProbe(probe) {
      const gl = this.gl;
      const data = new Float32Array(probe.n * 8);
      data.set(probe.pos4, 0);
      data.set(probe.vel4, probe.n * 4);
      gl.bindTexture(gl.TEXTURE_2D, this.probeTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, probe.n, 2, 0, gl.RGBA, gl.FLOAT, data);
    }

    bakeSky(size) {
      const gl = this.gl;
      const cube = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
      const fmt = this.hdr ? [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT] : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
      for (let f = 0; f < 6; f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, fmt[0], size, size, 0, fmt[1], fmt[2], null);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      const P = this.progs.sky;
      gl.useProgram(P.program);
      gl.bindVertexArray(this.emptyVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.bbTex);
      gl.uniform1i(P.uniforms.uBB, 0);
      gl.uniform1f(P.uniforms.uBBLogMin, this.bbLogMin);
      gl.uniform1f(P.uniforms.uBBLogRange, this.bbLogRange);
      gl.uniform1f(P.uniforms.uSize, size);
      gl.viewport(0, 0, size, size);
      gl.disable(gl.BLEND);
      for (let f = 0; f < 6; f++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, cube, 0);
        gl.uniform1i(P.uniforms.uFace, f);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      if (this.skyTex) gl.deleteTexture(this.skyTex);
      this.skyTex = cube;
    }

    ensureTargets(w, h, rw, rh) {
      if (this.targets && this.lastSize[0] === w && this.lastSize[1] === h && this.lastSize[2] === rw && this.lastSize[3] === rh) return;
      const gl = this.gl;
      if (this.targets) {
        for (const t of this.targets.all) {
          gl.deleteTexture(t.tex);
          gl.deleteFramebuffer(t.fb);
        }
      }
      const mk = (tw, th) => {
        const tex = K.texture2D(gl, { width: tw, height: th, internalFormat: this.rtFormat.internal, format: this.rtFormat.format, type: this.rtFormat.type });
        return { tex, fb: K.framebuffer(gl, tex), w: tw, h: th };
      };
      const scene = mk(rw, rh);
      const mips = [];
      let mw = Math.max(1, rw >> 1), mh = Math.max(1, rh >> 1);
      for (let i = 0; i < 6 && mw >= 4 && mh >= 4; i++) {
        mips.push(mk(mw, mh));
        mw >>= 1;
        mh >>= 1;
      }
      this.targets = { scene, mips, all: [scene, ...mips] };
      this.lastSize = [w, h, rw, rh];
    }

    /** Render one frame. See app.js for the shape of `f`. */
    render(f) {
      const gl = this.gl;
      const w = this.canvas.width, h = this.canvas.height;
      const rw = Math.max(16, Math.round(w * f.renderScale)), rh = Math.max(16, Math.round(h * f.renderScale));
      this.ensureTargets(w, h, rw, rh);
      const T = this.targets;
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.emptyVao);

      // 1. ray trace
      const P = this.progs.trace, u = P.uniforms;
      gl.useProgram(P.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
      gl.viewport(0, 0, rw, rh);
      const c = f.camera;
      gl.uniform2f(u.uRes, rw, rh);
      gl.uniform3fv(u.uCamPos, c.pos);
      gl.uniform4fv(u.uE0, c.tetrad.E0);
      gl.uniform4fv(u.uER, c.tetrad.Eright);
      gl.uniform4fv(u.uEU, c.tetrad.Eup);
      gl.uniform4fv(u.uEF, c.tetrad.Eforward);
      gl.uniform1f(u.uTanHalf, Math.tan(c.fovY / 2));
      gl.uniform1f(u.uAspect, w / h);
      gl.uniform2fv(u.uShift, f.camera.shift || [0, 0]);
      gl.uniform1f(u.uA, -f.spin);
      gl.uniform1f(u.uAPhys, f.spin);
      gl.uniform1f(u.uRH, f.rH);
      gl.uniform1f(u.uTime, f.time);
      gl.uniform1f(u.uCamZ, c.tetrad.redshiftFactor);
      gl.uniform1f(u.uRIn, f.rIn);
      gl.uniform1f(u.uROut, f.rOut);
      gl.uniform1f(u.uDiskGain, f.diskGain);
      gl.uniform1f(u.uMode, f.mode);
      gl.uniform1f(u.uIscoRing, f.iscoRing);
      gl.uniform1f(u.uBBLogMin, this.bbLogMin);
      gl.uniform1f(u.uBBLogRange, this.bbLogRange);
      gl.uniform1f(u.uDiskTempK, f.diskTempK);
      gl.uniform1f(u.uSkyGain, f.skyGain);
      gl.uniform1f(u.uGrid, f.grid);
      gl.uniform1f(u.uShell, f.shell);
      gl.uniform2fv(u.uShellR, f.shellR);
      gl.uniform1f(u.uStepK, f.stepK);
      gl.uniform1i(u.uMaxSteps, f.maxSteps);
      gl.uniform1f(u.uREsc, f.rEsc);
      gl.uniform1f(u.uDiskDim, f.diskDim);
      gl.uniform1i(u.uDebug, f.debug || 0);
      const pr = f.probe;
      gl.uniform1f(u.uProbeOn, pr ? 1 : 0);
      if (pr) {
        gl.uniform1f(u.uProbeT0, pr.t0);
        gl.uniform1f(u.uProbeDt, pr.dt);
        gl.uniform1f(u.uProbeN, pr.n);
        gl.uniform1f(u.uProbeR, pr.radius);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tempTex);
      gl.uniform1i(u.uTempLUT, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bbTex);
      gl.uniform1i(u.uBB, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.skyTex);
      gl.uniform1i(u.uSky, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.probeTex);
      gl.uniform1i(u.uProbeTex, 3);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2. bloom: 13-tap downsample chain, tent upsample with additive blend
      const D = this.progs.down;
      gl.useProgram(D.program);
      gl.uniform1i(D.uniforms.uSrc, 0);
      gl.uniform1f(D.uniforms.uThreshold, f.bloomThreshold);
      gl.uniform1f(D.uniforms.uExposure, f.exposure);
      let src = T.scene;
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < T.mips.length; i++) {
        const dst = T.mips[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(D.uniforms.uTexel, 1 / src.w, 1 / src.h);
        gl.uniform1f(D.uniforms.uFirst, i === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = dst;
      }
      const U = this.progs.up;
      gl.useProgram(U.program);
      gl.uniform1i(U.uniforms.uSrc, 0);
      gl.uniform1f(U.uniforms.uRadius, 1.0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = T.mips.length - 1; i > 0; i--) {
        const s = T.mips[i], d = T.mips[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
        gl.viewport(0, 0, d.w, d.h);
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2f(U.uniforms.uTexel, 1 / s.w, 1 / s.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);

      // 3. composite to the canvas
      const Cp = this.progs.comp;
      gl.useProgram(Cp.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T.scene.tex);
      gl.uniform1i(Cp.uniforms.uScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, T.mips.length ? T.mips[0].tex : T.scene.tex);
      gl.uniform1i(Cp.uniforms.uBloom, 1);
      gl.uniform1f(Cp.uniforms.uExposure, f.exposure);
      gl.uniform1f(Cp.uniforms.uBloomStrength, T.mips.length ? f.bloomStrength : 0);
      gl.uniform1f(Cp.uniforms.uVignette, f.vignette);
      gl.uniform1f(Cp.uniforms.uGrain, f.grain);
      gl.uniform1f(Cp.uniforms.uSeed, (f.frame % 997) * 13.1);
      gl.uniform2f(Cp.uniforms.uRes, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 4. overlays
      if ((f.lines && f.lines.length) || (f.points && f.points.length)) this.drawOverlays(f, w, h);
    }

    drawOverlays(f, w, h) {
      const gl = this.gl;
      const c = f.camera;
      const proj = K.mat4.perspective(c.fovY, w / h, 0.05, 2000);
      const view = K.mat4.view(c.pos, c.right, c.up, c.fwd);
      const vp = K.shiftProjection(K.mat4.multiply(proj, view), c.shift);
      this.viewProj = vp;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      if (f.lines && f.lines.length) {
        const L = this.progs.line, u = L.uniforms;
        gl.useProgram(L.program);
        gl.uniformMatrix4fv(u.uViewProj, false, vp);
        gl.uniform2f(u.uViewport, w, h);
        gl.uniform3fv(u.uCamPos, c.pos);
        for (const item of f.lines) {
          if (!item.batch || !item.batch.count) continue;
          gl.uniform1f(u.uWidth, item.width * f.pixelRatio);
          gl.uniform4fv(u.uColor, item.color);
          gl.uniform1f(u.uDash, item.dash || 0);
          gl.uniform1f(u.uHeadT, item.headT ?? 1e9);
          gl.uniform1f(u.uFade, item.fade || 0);
          gl.uniform1f(u.uMinAlpha, item.minAlpha ?? 1);
          gl.uniform1f(u.uOccR, item.occlude === false ? 0 : f.occlusionRadius);
          gl.bindVertexArray(item.batch.vao);
          gl.drawElements(gl.TRIANGLES, item.batch.count, gl.UNSIGNED_INT, 0);
        }
      }
      if (f.points && f.points.length) {
        const Pp = this.progs.point;
        gl.useProgram(Pp.program);
        gl.uniformMatrix4fv(Pp.uniforms.uViewProj, false, vp);
        gl.uniform1f(Pp.uniforms.uPixelRatio, f.pixelRatio);
        const data = new Float32Array(f.points.length * 8);
        f.points.forEach((p, i) => data.set([p.pos[0], p.pos[1], p.pos[2], p.color[0], p.color[1], p.color[2], p.color[3], p.size], i * 8));
        gl.bindVertexArray(this.pointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVbo);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.POINTS, 0, f.points.length);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
  }

  root.BHRenderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
