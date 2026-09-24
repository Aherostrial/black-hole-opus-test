/*
 * Photon lab: launch individual photons in the black hole's equatorial plane (optionally tilted)
 * and watch their exact Kerr trajectories unfold in coordinate time.
 *
 * Photons are integrated forward in ingoing Kerr–Schild coordinates with the real spin, and
 * launched along a direction measured by a local zero-angular-momentum observer.
 */
(function (root) {
  'use strict';
  const P = root.BHPhysics;
  const F = root.Fmt;
  const DEG = Math.PI / 180;
  const COLORS = {
    escaped: [0.5, 0.83, 1.0],
    captured: [1.0, 0.48, 0.36],
    orbiting: [0.78, 0.65, 1.0],
  };
  const MAX_PHOTONS = 48;

  function init(app) {
    const s = app.state;
    const $ = (id) => document.getElementById(id);
    const dock = $('labDock');
    const readout = $('labReadout');
    const tiltInput = $('labTilt');
    const tiltOut = $('labTiltOut');
    const aimBtn = $('labAim');
    const shellBtn = $('labShell');

    const lab = {
      active: false,
      photons: [],
      aim: null,
      aimMode: true,
      tilt: 0,
    };

    let gridBatch = null, ringBatch = null, previewBatch = null;
    let gridKey = '';

    function buildGuides() {
      const a = s.spin;
      const key = a.toFixed(3);
      if (key === gridKey) return;
      gridKey = key;
      const circle = (rho, n = 180) => {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * 2 * Math.PI;
          pts.push(rho * Math.cos(t), rho * Math.sin(t), 0);
        }
        return { points: new Float32Array(pts), stride: 3 };
      };
      const lines = [];
      for (const r of [5, 10, 15, 20, 25, 30]) lines.push(circle(r));
      const rH = Math.sqrt(app.derived.rH ** 2 + a * a);
      for (let k = 0; k < 12; k++) {
        const t = (k / 12) * 2 * Math.PI;
        lines.push({ points: new Float32Array([rH * Math.cos(t), rH * Math.sin(t), 0, 30 * Math.cos(t), 30 * Math.sin(t), 0]), stride: 3 });
      }
      gridBatch = gridBatch || app.renderer.newLineBatch();
      gridBatch.set(lines);
      const [r1, r2] = [P.photonOrbitWithDisk(a), P.photonOrbitAgainstDisk(a)];
      const rings = [circle(Math.sqrt(r1 * r1 + a * a))];
      if (Math.abs(r2 - r1) > 0.02) rings.push(circle(Math.sqrt(r2 * r2 + a * a)));
      ringBatch = ringBatch || app.renderer.newLineBatch();
      ringBatch.set(rings);
    }

    // ------------------------------------------------------------ launching
    function makePhoton(pos, dir, meta = {}) {
      const a = s.spin;
      const rho = Math.hypot(pos[0], pos[1]);
      const rEq = Math.sqrt(app.derived.rH ** 2 + a * a);
      if (rho < rEq * 1.02 && Math.abs(pos[2]) < 0.5) return null;
      const st = P.photonFromZamo(pos, dir, a);
      const res = P.tracePhoton(st, a, { stepScale: meta.precise ? 0.002 : 0.008, rFar: 75, maxTime: meta.maxTime || 900 });
      return { res, meta };
    }

    function addPhoton(ph, delay = 0) {
      if (!ph) return null;
      const batch = app.renderer.newLineBatch();
      batch.set([{ points: ph.res.points, stride: 4 }]);
      const photon = { ...ph, batch, launchT: s.time + delay, color: COLORS[ph.res.fate] };
      lab.photons.push(photon);
      while (lab.photons.length > MAX_PHOTONS) lab.photons.shift().batch.dispose();
      return photon;
    }

    function describe(ph) {
      const r = ph.res;
      const b = Math.abs(r.L);
      const bc = P.criticalImpact(s.spin);
      const crit = r.L >= 0 ? bc.withDisk : -bc.againstDisk;
      const orbits = r.orbits;
      const turned = r.deflection / DEG;
      const loops = orbits >= 0.9 ? `circled the hole ${F.sig(orbits, 2)} times` : `swung ${Math.round(r.sweptAngle / DEG)}° around the hole`;
      const tilted = lab.tilt > 0 ? '' : ` Impact parameter <strong>${F.sig(b, 3)}</strong> GM/c² against a capture limit of ${F.sig(crit, 4)}.`;
      if (r.fate === 'captured') return `<strong>Fell in.</strong> It ${loops} and crossed the horizon.${tilted}`;
      if (r.fate === 'escaped') return `<strong>Escaped.</strong> It came within ${F.sig(r.rMin, 3)} GM/c² of the centre, ${loops}, and left bent by ${Math.round(turned)}°${r.sweptAngle > 2 * Math.PI ? ' (after the full loops)' : ''}.${tilted}`;
      return `<strong>Still orbiting</strong> after ${F.sig(r.duration, 3)} GM/c³: it sits almost exactly on the unstable photon orbit.`;
    }

    function launchFromAim() {
      if (!lab.aim) return;
      const ph = lab.aim.preview;
      lab.aim = null;
      document.body.classList.remove('aiming');
      if (!ph) return;
      const p = addPhoton(ph);
      if (p) readout.innerHTML = describe(p);
    }

    function aimDirection(start, cur) {
      let dx = cur[0] - start[0], dy = cur[1] - start[1];
      if (Math.hypot(dx, dy) < 0.4) {
        // no drag: fire sideways, with the disk's rotation
        dx = -start[1];
        dy = start[0];
      }
      const n = Math.hypot(dx, dy);
      const t = lab.tilt * DEG;
      return [(dx / n) * Math.cos(t), (dy / n) * Math.cos(t), Math.sin(t)];
    }

    function updatePreview() {
      if (!lab.aim) return;
      const dir = aimDirection(lab.aim.start, lab.aim.cur);
      lab.aim.dir = dir;
      lab.aim.preview = makePhoton(lab.aim.start, dir);
      previewBatch = previewBatch || app.renderer.newLineBatch();
      if (lab.aim.preview) previewBatch.set([{ points: lab.aim.preview.res.points, stride: 4 }]);
    }

    /** Camera ray (Euclidean) through a CSS pixel, intersected with the equatorial plane. */
    function planePoint(clientX, clientY) {
      const f = app.lastFrame;
      if (!f) return null;
      const c = f.camera;
      const w = window.innerWidth, h = window.innerHeight;
      const sh = c.shift || [0, 0];
      const nx = (clientX / w) * 2 - 1 - sh[0], ny = 1 - (clientY / h) * 2 - sh[1];
      const th = Math.tan(c.fovY / 2);
      const d = [0, 1, 2].map((k) => c.fwd[k] + nx * th * (w / h) * c.right[k] + ny * th * c.up[k]);
      if (Math.abs(d[2]) < 1e-6) return null;
      const t = -c.pos[2] / d[2];
      if (t <= 0) return null;
      const p = [c.pos[0] + t * d[0], c.pos[1] + t * d[1], 0];
      if (Math.hypot(p[0], p[1]) > 45) return null;
      return p;
    }

    lab.handlePointer = (e, kind) => {
      if (!lab.active || !lab.aimMode) return false;
      if (kind === 'down') {
        if (e.button !== 0 || e.shiftKey) return false;
        const p = planePoint(e.clientX, e.clientY);
        if (!p) return false;
        const a = s.spin;
        if (Math.hypot(p[0], p[1]) < Math.sqrt(app.derived.rH ** 2 + a * a) * 1.05) {
          app.ui.toast('That point is inside the event horizon. Aim from farther out.');
          return true;
        }
        e.target.setPointerCapture(e.pointerId);
        lab.aim = { start: p, cur: p, pointerId: e.pointerId, dirty: true };
        document.body.classList.add('aiming');
        updatePreview();
        return true;
      }
      if (!lab.aim || e.pointerId !== lab.aim.pointerId) return false;
      if (kind === 'move') {
        const p = planePoint(e.clientX, e.clientY);
        if (p) {
          lab.aim.cur = p;
          lab.aim.dirty = true;
        }
        return true;
      }
      if (kind === 'up') {
        if (lab.aim.dirty) updatePreview();
        launchFromAim();
        return true;
      }
      return false;
    };

    // ------------------------------------------------------------ presets
    function cameraFrameInPlane() {
      const c = app.camera.basis();
      let rx = c.right[0], ry = c.right[1];
      const n = Math.hypot(rx, ry) || 1;
      rx /= n;
      ry /= n;
      return { along: [rx, ry], across: [-ry, rx] };
    }

    function beam() {
      const { along, across } = cameraFrameInPlane();
      const bc = P.criticalImpact(s.spin);
      // Offsets chosen to straddle both capture limits (they differ once the hole spins).
      const lim1 = bc.withDisk, lim2 = -bc.againstDisk;
      const offsets = [-11, -8, -lim2 - 0.6, -lim2 - 0.04, -lim2 + 0.25, -2.5, 0, 2.5, lim1 - 0.25, lim1 + 0.04, lim1 + 0.6, 8, 11];
      let captured = 0;
      offsets.forEach((b, i) => {
        // start 28 M upstream; offset b along "across" (positive b => positive L, with the disk)
        const pos = [-28 * along[0] - b * across[0], -28 * along[1] - b * across[1], 0];
        const ph = makePhoton(pos, [along[0], along[1], 0]);
        if (ph && ph.res.fate === 'captured') captured++;
        addPhoton(ph, 0);
      });
      readout.innerHTML = `A beam of ${offsets.length} parallel photons. <strong>${captured}</strong> fell in. Those passing within about ${F.sig(Math.min(lim1, lim2), 3)}${Math.abs(lim1 - lim2) > 0.05 ? `–${F.sig(Math.max(lim1, lim2), 3)}` : ''} GM/c² of the axis are captured; the ones grazing the limit loop around first. The hole’s capture cross-section is ${F.sig(Math.PI * (0.5 * (lim1 + lim2)) ** 2 / (Math.PI * app.derived.rH ** 2), 2)}× larger than its horizon.`;
      app.ui.explain('lab', {}, true);
    }

    function graze() {
      const a = s.spin;
      const rph = P.photonOrbitWithDisk(a);
      const c = app.camera.basis();
      const baseAng = Math.atan2(c.pos[1], c.pos[0]) + Math.PI * 0.5;
      const deltas = [1e-2, 1e-4, 1e-6, 1e-8];
      const results = [];
      deltas.forEach((dlt, i) => {
        const r = rph * (1 + dlt);
        const rho = Math.sqrt(r * r + a * a);
        const ang = baseAng + i * 0.0;
        const pos = [rho * Math.cos(ang), rho * Math.sin(ang), 0];
        const dir = [-Math.sin(ang), Math.cos(ang), 0];
        const ph = makePhoton(pos, dir, { precise: true, maxTime: 1400 });
        if (ph) {
          addPhoton(ph, i * 0.0);
          results.push([dlt, ph.res.orbits, ph.res.fate]);
        }
      });
      const inside = makePhoton(
        (() => {
          const r = rph * (1 - 1e-4), rho = Math.sqrt(r * r + a * a);
          return [rho * Math.cos(baseAng), rho * Math.sin(baseAng), 0];
        })(),
        [-Math.sin(baseAng), Math.cos(baseAng), 0],
        { precise: true, maxTime: 1400 }
      );
      addPhoton(inside);
      const sup = (e) => `10${String(e).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}`;
      const list = results.map(([d, n]) => `${sup(Math.round(Math.log10(d)))} → <strong>${F.sig(n, 2)}</strong>`).join(', ');
      // Growth per lap, measured from these very photons: laps grow by ln(100)/ln(factor) per decade pair.
      const good = results.slice(0, 3).filter((r) => r[2] === 'escaped');
      const dn = good.length > 1 ? (good[good.length - 1][1] - good[0][1]) / (good.length - 1) : 0;
      const factor = dn > 0 ? Math.exp(Math.log(100) / dn) : 0;
      readout.innerHTML = `Five photons fired sideways from the photon orbit (r = ${F.sig(rph, 3)} GM/c²), each started a little farther out. Laps before escaping: ${list}. Starting a hundred times closer buys only about ${F.sig(dn, 2)} extra lap${factor ? `, because every lap multiplies any small error by about <strong>${F.sig(factor, 2)}×</strong>` : ''}. The one started just inside spirals in. That instability is why the photon ring is so thin.`;
      app.ui.explain('lab', {}, true);
    }

    // ------------------------------------------------------------ frame hook
    function headPosition(pts, t) {
      const n = pts.length / 4;
      if (t <= pts[3]) return [pts[0], pts[1], pts[2]];
      if (t >= pts[(n - 1) * 4 + 3]) return null;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (pts[m * 4 + 3] < t) lo = m;
        else hi = m;
      }
      const t0 = pts[lo * 4 + 3], t1 = pts[hi * 4 + 3];
      const w = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return [0, 1, 2].map((k) => pts[lo * 4 + k] * (1 - w) + pts[hi * 4 + k] * w);
    }

    app.on('frame', (f) => {
      if (lab.active) {
        buildGuides();
        f.lines.push({ batch: gridBatch, color: [0.45, 0.75, 1.0, 0.22], width: 1.1, occlude: true });
        f.lines.push({ batch: ringBatch, color: [0.95, 0.64, 0.37, 0.7], width: 1.6, dash: 1.2 });
      }
      for (const ph of lab.photons) {
        const age = s.time - ph.launchT;
        if (age < 0) continue;
        const c = ph.color;
        f.lines.push({ batch: ph.batch, color: [c[0], c[1], c[2], 0.95], width: 2.4, headT: ph.res.points[3] + age, fade: 40, minAlpha: 0.32 });
        const head = headPosition(ph.res.points, ph.res.points[3] + age);
        if (head) f.points.push({ pos: head, color: [1, 1, 1, 1], size: 11 });
      }
      if (lab.aim && lab.aim.preview) {
        f.lines.push({ batch: previewBatch, color: [1, 1, 1, 0.55], width: 1.6, dash: 1.4 });
        f.points.push({ pos: lab.aim.start, color: [1, 0.85, 0.6, 1], size: 12 });
      }
    });

    let pendingPreview = false;
    app.on('frame', () => {
      if (lab.aim && lab.aim.dirty && !pendingPreview) {
        pendingPreview = true;
        lab.aim.dirty = false;
        updatePreview();
        pendingPreview = false;
      }
    });

    // ------------------------------------------------------------ UI wiring
    lab.toggle = (on) => {
      const next = on === undefined ? !lab.active : on;
      if (next === lab.active) return;
      lab.active = next;
      dock.hidden = !next;
      $('labBtn').setAttribute('aria-pressed', String(next));
      if (next) {
        buildGuides();
        // Step back and look down on the orbital plane, the natural view for aiming.
        const i = app.camera.target.incl / DEG;
        lab.savedView = { incl: app.camera.target.incl, dist: app.camera.target.dist };
        app.camera.set({ incl: (i > 62 && i < 118 ? (i < 90 ? 42 : 138) : i) * DEG, dist: Math.max(app.camera.target.dist, 56) });
        app.ui.explain('lab', {}, true);
      } else {
        lab.aim = null;
        document.body.classList.remove('aiming');
        if (lab.savedView) app.camera.set(lab.savedView);
      }
    };
    $('labClose').addEventListener('click', () => lab.toggle(false));
    aimBtn.addEventListener('click', () => {
      lab.aimMode = !lab.aimMode;
      aimBtn.setAttribute('aria-pressed', String(lab.aimMode));
      aimBtn.textContent = lab.aimMode ? 'Aim & fire' : 'Orbit camera';
      app.ui.toast(lab.aimMode ? 'Drag on the plane to aim' : 'Drag now orbits the camera');
    });
    $('labBeam').addEventListener('click', beam);
    $('labGraze').addEventListener('click', graze);
    $('labClear').addEventListener('click', () => {
      lab.photons.forEach((p) => p.batch.dispose());
      lab.photons = [];
      readout.innerHTML = 'Cleared. Drag on the glowing plane to aim a photon, then release to fire it.';
    });
    shellBtn.addEventListener('click', () => {
      app.set('shell', !s.shell);
      if (s.shell) app.ui.explain('shell', {}, true);
    });
    tiltInput.addEventListener('input', () => {
      lab.tilt = +tiltInput.value;
      tiltOut.textContent = `${lab.tilt}°`;
      tiltInput.style.setProperty('--fill', `${(lab.tilt / 75) * 100}%`);
    });
    app.on('change', (key) => {
      shellBtn.setAttribute('aria-pressed', String(!!s.shell));
      if (key === 'spin' && lab.photons.length) {
        lab.photons.forEach((p) => p.batch.dispose());
        lab.photons = [];
        readout.innerHTML = 'The spin changed, so the old trajectories no longer apply. Fire again.';
      }
    });

    lab.beam = beam;
    lab.graze = graze;
    lab.fire = (pos, dir) => addPhoton(makePhoton(pos, dir));
    return lab;
  }

  root.PhotonLab = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
