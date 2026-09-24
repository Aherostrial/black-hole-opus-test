/*
 * The falling clock. A glowing probe is released from rest and falls freely; the ray tracer
 * shows it at the moment its light left it, so it visibly slows, reddens, fades and never
 * quite reaches the horizon, while its own clock runs to the horizon in finite time.
 */
(function (root) {
  'use strict';
  const P = root.BHPhysics;
  const F = root.Fmt;
  const DEG = Math.PI / 180;
  const R0 = 11;

  function init(app) {
    const s = app.state;
    const $ = (id) => document.getElementById(id);
    const hud = $('probeHud');
    const mine = $('clockMine'), theirs = $('clockTheirs'), meter = $('probeMeter'), status = $('probeStatus');

    const probe = { active: false, data: null };
    let dropT = 0, unit = null, lastHud = 0, releaseT = 0;

    function drop() {
      const a = s.spin;
      const cam = app.camera.basis();
      // Release point: up and to the right of the hole as you see it, clear of the disk.
      const phi = app.camera.azim + 38 * DEG;
      const theta = (app.camera.incl < 90 * DEG ? 42 : 138) * DEG;
      const pos = [R0 * Math.sin(theta) * Math.cos(phi), R0 * Math.sin(theta) * Math.sin(phi), R0 * Math.cos(theta)];
      const data = P.buildProbe(pos, a, 1024);
      const rCam = Math.hypot(cam.pos[0], cam.pos[1], cam.pos[2]);
      // Time the release so its light reaches the camera now (outgoing light: t - r is constant).
      releaseT = s.time - (rCam - R0);
      data.t0 += releaseT - data.t0;
      app.renderer.setProbe(data);
      probe.data = data;
      probe.active = true;
      dropT = s.time;
      unit = F.clockUnit(data.tauHorizon * app.derived.props.tg);
      hud.hidden = false;
      document.body.classList.add('experiment');
      $('probeBtn').setAttribute('aria-pressed', 'true');
      app.ui.explain('probe', { r0: R0, tauH: data.tauHorizon, tauEnd: data.tauEnd, unit, endsAtSingularity: data.endsAtSingularity }, true);
    }

    function clear() {
      probe.active = false;
      probe.data = null;
      hud.hidden = true;
      document.body.classList.remove('experiment');
      $('probeBtn').setAttribute('aria-pressed', 'false');
    }

    probe.toggle = () => (probe.active ? clear() : drop());
    probe.drop = drop;
    probe.clear = clear;
    $('probeClose').addEventListener('click', clear);

    probe.frameInfo = () => (probe.active ? { t0: probe.data.t0, dt: probe.data.dt, n: probe.data.n, radius: 0.34 } : null);

    app.on('change', (key) => {
      if (key === 'spin' && probe.active) {
        clear();
        app.ui.toast('Spin changed, so the falling clock was recalled. Drop it again.');
      }
      if (key === 'massSun' && probe.active) unit = F.clockUnit(probe.data.tauHorizon * app.derived.props.tg);
    });

    app.on('frame', (f) => {
      if (!probe.active) return;
      const now = performance.now();
      if (now - lastHud < 90) return;
      lastHud = now;
      const tg = app.derived.props.tg;
      const d = probe.data;
      const seen = P.probeAsSeen(d, s.time, f.camera.pos, f.camera.tetrad.redshiftFactor);
      const elapsed = Math.max(0, s.time - dropT);
      mine.textContent = F.clock(elapsed * tg, unit);
      theirs.textContent = F.clock(Math.max(0, seen.tau) * tg, unit);
      const frac = Math.min(1, Math.max(0, seen.tau / d.tauHorizon));
      meter.style.width = `${(frac * 100).toFixed(1)}%`;

      const rH = app.derived.rH;
      const stretch = 1 / Math.max(seen.g, 1e-9);
      const tidal = (2 * P.SUN.gm * s.massSun * 2) / Math.pow(seen.r * app.derived.props.rg * 1000, 3) / 9.80665;
      // Once your own clock has run longer than the whole fall took on its clock, say so.
      const crossed = elapsed > d.tauHorizon;
      let msg;
      if (seen.tau < 0.3) msg = '<strong>Released.</strong> Light from its first moments of falling is on its way to you.';
      else if (seen.g > 0.6) msg = `<strong>Falling.</strong> ${F.sig(seen.r - rH, 2)} GM/c² above the horizon. Its light arrives stretched ×${F.sig(stretch, 2)}: a little redder and dimmer, and the flashes are spacing out.`;
      else if (seen.g > 0.02) msg = `<strong>Slowing, to you.</strong> Its light is stretched ×${F.sig(stretch, 2)}. Each flash takes longer to arrive and is fainter than the last.`;
      else msg = `<strong>Frozen at the edge, to you.</strong> Light is stretched ×${F.sig(Math.min(stretch, 9.99e9), 2)} and fading fast. You will never see the clock read more than ${F.clock(d.tauHorizon * tg, unit)}.`;
      if (crossed) msg += ` Yet your clock has now run longer than its whole fall: by its own clock it crossed the horizon at <strong>${F.clock(d.tauHorizon * tg, unit)}</strong>.`;
      msg += ` <span style="color:var(--ink-3)">Tidal stretch on a 2 m astronaut at its position: ${F.gForce(tidal)}.</span>`;
      status.innerHTML = msg;
    });

    return probe;
  }

  root.ProbeExperiment = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
