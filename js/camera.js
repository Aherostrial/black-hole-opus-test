/* Orbit camera with inertia. Positions are in the ray tracer's Cartesian frame, z = spin axis. */
(function (root) {
  'use strict';
  const DEG = Math.PI / 180;

  class OrbitCamera {
    constructor() {
      this.incl = 80 * DEG;
      this.azim = -90 * DEG;
      this.dist = 34;
      this.fovY = 40 * DEG;
      this.target = { incl: this.incl, azim: this.azim, dist: this.dist };
      this.vel = { incl: 0, azim: 0 };
      this.autoOrbit = 0; // radians per second
      this.minDist = 8;
      this.maxDist = 90;
      this.dragging = false;
      this.listeners = [];
    }

    onChange(fn) {
      this.listeners.push(fn);
    }

    set(params, instant = false) {
      if (params.incl !== undefined) this.target.incl = clamp(params.incl, 0.6 * DEG, 179.4 * DEG);
      if (params.azim !== undefined) this.target.azim = params.azim;
      if (params.dist !== undefined) this.target.dist = clamp(params.dist, this.minDist, this.maxDist);
      if (instant) {
        this.incl = this.target.incl;
        this.azim = this.target.azim;
        this.dist = this.target.dist;
      }
    }

    update(dt) {
      if (!this.dragging) {
        const decay = Math.exp(-dt * 3.5);
        this.target.azim += this.vel.azim * dt;
        this.target.incl = clamp(this.target.incl + this.vel.incl * dt, 0.6 * DEG, 179.4 * DEG);
        this.vel.azim *= decay;
        this.vel.incl *= decay;
        this.target.azim += this.autoOrbit * dt;
      }
      const k = 1 - Math.exp(-dt * 9);
      const before = this.incl;
      this.incl += (this.target.incl - this.incl) * k;
      this.azim += (this.target.azim - this.azim) * k;
      this.dist += (this.target.dist - this.dist) * k;
      if (Math.abs(before - this.incl) > 1e-5) this.listeners.forEach((fn) => fn(this));
    }

    get moving() {
      return (
        this.dragging ||
        Math.abs(this.target.incl - this.incl) > 1e-3 ||
        Math.abs(this.target.azim - this.azim) > 1e-3 ||
        Math.abs(this.target.dist - this.dist) > 1e-2 ||
        this.autoOrbit !== 0 ||
        Math.abs(this.vel.azim) > 1e-3
      );
    }

    basis() {
      const si = Math.sin(this.incl), ci = Math.cos(this.incl);
      const sa = Math.sin(this.azim), ca = Math.cos(this.azim);
      const pos = [this.dist * si * ca, this.dist * si * sa, this.dist * ci];
      const fwd = [-si * ca, -si * sa, -ci];
      const up = [-ci * ca, -ci * sa, si];
      const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
      return { pos, fwd, up, right };
    }

    /** Pointer/touch/wheel input. `intercept(e, kind)` may claim a pointer for another tool. */
    attach(el, intercept) {
      const pointers = new Map();
      let pinchStart = null;
      let last = null;
      let lastT = 0;
      el.addEventListener('pointerdown', (e) => {
        if (intercept && intercept(e, 'down')) return;
        el.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 1) {
          this.dragging = true;
          last = { x: e.clientX, y: e.clientY };
          lastT = performance.now();
          this.vel.azim = this.vel.incl = 0;
        } else if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: this.target.dist };
        }
      });
      el.addEventListener('pointermove', (e) => {
        if (intercept && intercept(e, 'move')) return;
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinchStart) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          this.set({ dist: pinchStart.dist * (pinchStart.d / Math.max(d, 1)) });
          return;
        }
        if (!last) return;
        const now = performance.now();
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        const s = 0.0045;
        this.target.azim -= dx * s;
        this.target.incl = clamp(this.target.incl - dy * s, 0.6 * DEG, 179.4 * DEG);
        const dtm = Math.max(1, now - lastT) / 1000;
        this.vel.azim = (-dx * s) / dtm * 0.6;
        this.vel.incl = (-dy * s) / dtm * 0.6;
        last = { x: e.clientX, y: e.clientY };
        lastT = now;
      });
      const end = (e) => {
        if (intercept && intercept(e, 'up')) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 0) {
          this.dragging = false;
          if (performance.now() - lastT > 80) this.vel.azim = this.vel.incl = 0;
          last = null;
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const k = e.deltaMode === 1 ? 0.05 : 0.0012;
          this.set({ dist: this.target.dist * Math.exp(e.deltaY * k) });
        },
        { passive: false }
      );
    }
  }

  function clamp(x, a, b) {
    return Math.min(b, Math.max(a, x));
  }

  root.OrbitCamera = OrbitCamera;
})(typeof globalThis !== 'undefined' ? globalThis : this);
