/*
 * Museum-style callouts anchored to the scene, plus the guide geometry drawn in 3D
 * (true-size horizon, photon orbits). Positions are recomputed every frame.
 */
(function (root) {
  'use strict';
  const P = root.BHPhysics;
  const K = root.GLKit;
  const DEG = Math.PI / 180;
  const SVGNS = 'http://www.w3.org/2000/svg';

  function init(app) {
    const host = document.getElementById('labels');
    const svg = document.getElementById('leaders');
    const els = new Map();
    let horizonBatch = null;
    let shellBatch = null;
    let shellPaths = [];
    let shellKey = '';

    function labelEl(id, cls) {
      if (els.has(id)) return els.get(id);
      const div = document.createElement('div');
      div.className = 'scene-label ' + (cls || '');
      host.appendChild(div);
      const line = document.createElementNS(SVGNS, 'line');
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('r', '2.2');
      svg.appendChild(line);
      svg.appendChild(dot);
      const rec = { div, line, dot, html: '' };
      els.set(id, rec);
      return rec;
    }

    /** World -> CSS pixel projection with the same camera the renderer uses. */
    function projector(f) {
      const c = f.camera;
      const w = window.innerWidth, h = window.innerHeight;
      const vp = K.shiftProjection(K.mat4.multiply(K.mat4.perspective(c.fovY, w / h, 0.05, 2000), K.mat4.view(c.pos, c.right, c.up, c.fwd)), c.shift);
      return (p) => {
        const q = K.mat4.transform(vp, p);
        if (q[3] <= 0.01) return null;
        return [(q[0] / q[3] * 0.5 + 0.5) * w, (1 - (q[1] / q[3] * 0.5 + 0.5)) * h];
      };
    }

    function blockers() {
      const rects = [];
      for (const id of ['explainer', 'console', 'titleCard', 'probeHud', 'labDock', 'cornerNav']) {
        const el = document.getElementById(id);
        if (!el || el.hidden || document.body.classList.contains('presenting')) continue;
        const r = el.getBoundingClientRect();
        if (r.width) rects.push(r);
      }
      return rects;
    }
    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    function place(rec, anchor, dir, html, rects, placed) {
      if (rec.html !== html) {
        rec.div.innerHTML = html;
        rec.html = html;
      }
      const bw = rec.div.offsetWidth, bh = rec.div.offsetHeight;
      const W = window.innerWidth, H = window.innerHeight;
      const tries = [dir, [-dir[0], dir[1]], [dir[0], -dir[1]]];
      for (const d of tries) {
        const len = 46;
        const ex = anchor[0] + d[0] * len, ey = anchor[1] + d[1] * len;
        let x = d[0] >= 0 ? ex : ex - bw;
        let y = ey - bh / 2;
        x = Math.min(W - bw - 8, Math.max(8, x));
        y = Math.min(H - bh - 8, Math.max(8, y));
        const box = { left: x, top: y, right: x + bw, bottom: y + bh };
        if (rects.some((r) => overlaps(box, r)) || placed.some((r) => overlaps(box, r))) continue;
        placed.push(box);
        rec.div.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        rec.div.style.opacity = '1';
        const lx = d[0] >= 0 ? x : x + bw;
        rec.line.setAttribute('x1', anchor[0].toFixed(1));
        rec.line.setAttribute('y1', anchor[1].toFixed(1));
        rec.line.setAttribute('x2', lx.toFixed(1));
        rec.line.setAttribute('y2', (y + bh / 2).toFixed(1));
        rec.dot.setAttribute('cx', anchor[0].toFixed(1));
        rec.dot.setAttribute('cy', anchor[1].toFixed(1));
        rec.line.style.opacity = rec.dot.style.opacity = '1';
        return true;
      }
      hide(rec);
      return false;
    }
    function hide(rec) {
      rec.div.style.opacity = '0';
      rec.line.style.opacity = rec.dot.style.opacity = '0';
    }

    function update(f) {
      const s = app.state, d = app.derived;
      const edu = 1 - s.modeBlend;
      const show = s.labels && edu > 0.5 && !(app.lab && app.lab.active);
      const project = projector(f);
      const c = f.camera;
      const W = window.innerWidth, H = window.innerHeight;
      const center = project([0, 0, 0]);
      const used = new Set();
      const rects = blockers();
      const placed = [];

      // True-size horizon: a dashed circle facing the camera (educational only).
      if (show) {
        const rEq = Math.sqrt(d.rH * d.rH + s.spin * s.spin);
        const pts = [];
        for (let i = 0; i <= 96; i++) {
          const t = (i / 96) * 2 * Math.PI;
          const ct = Math.cos(t), st = Math.sin(t);
          pts.push(rEq * (c.right[0] * ct + c.up[0] * st), rEq * (c.right[1] * ct + c.up[1] * st), rEq * (c.right[2] * ct + c.up[2] * st));
        }
        horizonBatch = horizonBatch || app.renderer.newLineBatch();
        horizonBatch.set([{ points: new Float32Array(pts), stride: 3 }]);
        f.lines.push({ batch: horizonBatch, color: [0.95, 0.72, 0.5, 0.55 * edu], width: 1.4, dash: 1.6, occlude: false });
      }

      // Photon sphere / shell orbits at true size
      if (s.shell) {
        const key = s.spin.toFixed(3);
        if (key !== shellKey) {
          shellPaths = P.sphericalOrbitPaths(s.spin, 18, 3);
          shellBatch = shellBatch || app.renderer.newLineBatch();
          shellBatch.set(shellPaths.map((p) => ({ points: p.points, stride: 3 })));
          shellKey = key;
        }
        f.lines.push({ batch: shellBatch, color: [0.45, 0.82, 1.0, 0.42], width: 1.5 });
        // photons running along a few of the orbits
        const tt = s.time * 0.35;
        shellPaths.forEach((p, i) => {
          if (i % 3) return;
          const n = p.points.length / 3;
          const k = Math.floor(((tt * 18 + i * 37) % n + n) % n);
          f.points.push({ pos: [p.points[k * 3], p.points[k * 3 + 1], p.points[k * 3 + 2]], color: [0.75, 0.93, 1.0, 1.0], size: 9 });
        });
      }

      if (!show || !center) {
        for (const rec of els.values()) hide(rec);
        return;
      }

      // Apparent shadow radius for a static observer (Synge), using the mean critical impact parameter.
      const bc = P.criticalImpact(s.spin);
      const b = 0.5 * (bc.withDisk - bc.againstDisk);
      const D = app.camera.dist;
      const alpha = Math.asin(Math.min(0.99, (b * Math.sqrt(1 - 2 / D)) / D));
      const Rpx = (Math.tan(alpha) / Math.tan(c.fovY / 2)) * (H / 2);
      const incl = app.camera.incl;
      const edgeOn = incl > 55 * DEG && incl < 125 * DEG;

      const items = [];
      items.push({ id: 'shadow', anchor: [center[0] - 0.72 * Rpx, center[1] - 0.69 * Rpx], dir: [-0.8, -0.6], html: '<b>Shadow</b><span>No light gets out of here</span>' });
      const rEq = Math.sqrt(d.rH * d.rH + s.spin * s.spin);
      const ca = Math.cos(-0.9), sa = Math.sin(-0.9);
      const hAnchor = project([0, 1, 2].map((k) => rEq * (c.right[k] * ca + c.up[k] * sa)));
      if (hAnchor) items.push({ id: 'horizon', anchor: hAnchor, dir: [0.75, 0.66], html: '<b>Event horizon, true size</b><span>The shadow is its magnified image</span>' });

      // Innermost stable orbit, on the near side of the disk
      const az = app.camera.azim;
      const rho = Math.sqrt(d.rIn * d.rIn + s.spin * s.spin);
      const nearISCO = project([rho * Math.cos(az), rho * Math.sin(az), 0]);
      if (nearISCO && (incl < 80 * DEG || incl > 100 * DEG)) items.push({ id: 'isco', anchor: nearISCO, dir: [0.8, 0.6], html: '<b>Innermost stable orbit</b><span>Inside it, gas plunges</span>', cls: 'cool' });

      // Approaching and receding sides (disk turns counter-clockwise seen from +z)
      const rr = Math.min(d.rOut * 0.62, 14);
      const hor = [c.right[0], c.right[1]];
      const hn = Math.hypot(hor[0], hor[1]) || 1;
      const sides = [1, -1].map((sg) => {
        const p = [(sg * hor[0] * rr) / hn, (sg * hor[1] * rr) / hn, 0];
        const v = [-p[1], p[0], 0];
        const toCam = [c.pos[0] - p[0], c.pos[1] - p[1], c.pos[2] - p[2]];
        return { p, approaching: v[0] * toCam[0] + v[1] * toCam[1] > 0 };
      });
      if (Math.abs(Math.sin(incl)) > 0.35) {
        for (const sd of sides) {
          const q = project(sd.p);
          if (!q) continue;
          const dir = [q[0] < center[0] ? -0.6 : 0.6, 0.8];
          items.push(
            sd.approaching
              ? { id: 'approach', anchor: q, dir, html: '<b>Coming toward you</b><span>Doppler-boosted: brighter, bluer</span>' }
              : { id: 'recede', anchor: q, dir, html: '<b>Moving away</b><span>Dimmer, redder</span>', cls: 'hazard' }
          );
        }
      }
      if (edgeOn) {
        items.push({ id: 'farside', anchor: [center[0] + 0.25 * Rpx, center[1] - 1.42 * Rpx], dir: [0.55, -0.83], html: '<b>Far side of the disk</b><span>Bent over the top by gravity</span>' });
      }
      if (s.shell) {
        items.push({ id: 'shell', anchor: project([0, 0, d.shell[1]]) || center, dir: [-0.6, -0.8], html: '<b>Photon sphere, true size</b><span>Light can orbit here</span>', cls: 'cool' });
      }

      for (const it of items) {
        const rec = labelEl(it.id, it.cls);
        const inView = it.anchor[0] > 0 && it.anchor[0] < W && it.anchor[1] > 0 && it.anchor[1] < H;
        if (!inView) continue;
        if (place(rec, it.anchor, it.dir, it.html, rects, placed)) used.add(it.id);
      }
      for (const [id, rec] of els) if (!used.has(id)) hide(rec);
    }

    return { update, projector };
  }

  root.SceneLabels = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
