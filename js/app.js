/*
 * Exhibit controller: owns the simulation state, runs the frame loop, and connects the
 * renderer, camera, UI, photon lab and probe.
 */
(function (root) {
  'use strict';
  const Phys = root.BHPhysics;
  const DEG = Math.PI / 180;
  const BASE_SPEED = 12; // simulation time (GM/c^3) per wall-clock second at speed 1x

  const params = new URLSearchParams(location.search);

  const state = {
    massSun: 4.3e6,
    spin: 0.6,
    mdot: 0.1,
    speed: 1,
    paused: false,
    mode: 'edu',
    modeBlend: 0,
    labels: true,
    grid: false,
    shell: false,
    autoOrbit: false,
    time: 0,
    frame: 0,
    quality: params.get('quality') || 'auto',
    renderScale: params.has('scale') ? +params.get('scale') : 0.75,
  };

  // URL overrides (used by the automated browser checks and for sharing a view).
  const num = (k) => (params.has(k) ? +params.get(k) : undefined);
  if (params.has('mass')) state.massSun = num('mass');
  if (params.has('spin')) state.spin = num('spin');
  if (params.has('mdot')) state.mdot = num('mdot');
  if (params.has('mode')) state.mode = params.get('mode') === 'real' ? 'real' : 'edu';
  if (state.mode === 'real') state.modeBlend = 1;
  for (const k of ['labels', 'grid', 'shell']) if (params.has(k)) state[k] = params.get(k) === '1';
  if (params.has('t')) state.time = num('t');
  if (params.has('paused')) state.paused = true;

  const derived = {};
  const listeners = { change: [], frame: [] };

  function recomputeDerived() {
    const a = state.spin;
    derived.rH = Phys.horizon(a);
    derived.rIn = Phys.isco(a);
    derived.rOut = Math.max(21, derived.rIn + 12);
    derived.shell = Phys.photonShell(a);
    derived.props = Phys.physicalProperties(state.massSun, a, state.mdot);
    const prof = Phys.diskTemperatureProfile(a, derived.rIn, derived.rOut, 256);
    derived.tempProfile = prof.data;
    derived.peakR = prof.peakR;
    derived.displayTempK = Math.min(30000, Math.max(2400, 6200 * Math.pow(derived.props.diskPeakK / 2.0e5, 0.3)));
  }

  function set(key, value, meta = {}) {
    const prev = state[key];
    state[key] = value;
    if (key === 'spin' || key === 'massSun' || key === 'mdot') {
      recomputeDerived();
      if (key === 'spin' && app.renderer) app.renderer.setTemperatureProfile(derived.tempProfile);
    }
    listeners.change.forEach((fn) => fn(key, value, prev, meta));
  }

  const app = {
    state,
    derived,
    set,
    params,
    BASE_SPEED,
    on(evt, fn) {
      listeners[evt].push(fn);
    },
    renderer: null,
    camera: null,
    viewShift: [0, 0],
  };

  function init() {
    recomputeDerived();
    const canvas = document.getElementById('view');
    let renderer;
    try {
      renderer = new root.BHRenderer(canvas, { skySize: +(params.get('sky') || 1024), preserve: params.has('preserve') });
    } catch (err) {
      showFatal(err);
      return;
    }
    app.renderer = renderer;
    renderer.setTemperatureProfile(derived.tempProfile);
    const camera = new root.OrbitCamera();
    app.camera = camera;
    if (params.has('incl')) camera.set({ incl: num('incl') * DEG }, true);
    if (params.has('azim')) camera.set({ azim: num('azim') * DEG }, true);
    if (params.has('dist')) camera.set({ dist: num('dist') }, true);
    camera.attach(canvas, (e, kind) => (app.lab ? app.lab.handlePointer(e, kind) : false));

    if (params.has('present')) document.body.classList.add('presenting');
    app.ui = root.ExhibitUI.init(app);
    app.lab = root.PhotonLab.init(app);
    app.probe = root.ProbeExperiment.init(app);
    app.labels = root.SceneLabels.init(app);
    app.viewShift = app.ui.viewShiftTarget();
    app.on('frame', (f) => app.labels.update(f));

    let lastT = performance.now();
    let frameTimes = [];
    let lastScaleChange = 0;
    const fixedScale = params.has('scale') || state.quality !== 'auto';

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      app.pixelRatio = dpr;
    }

    function frame(now) {
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      resize();
      camera.autoOrbit = state.autoOrbit ? 0.07 : 0;
      camera.update(dt);
      const goal = app.ui.viewShiftTarget();
      const k = 1 - Math.exp(-dt * 6);
      app.viewShift[0] += (goal[0] - app.viewShift[0]) * k;
      app.viewShift[1] += (goal[1] - app.viewShift[1]) * k;
      if (!state.paused) state.time += dt * BASE_SPEED * state.speed;
      const target = state.mode === 'real' ? 1 : 0;
      state.modeBlend += (target - state.modeBlend) * (1 - Math.exp(-dt * 4));
      if (Math.abs(target - state.modeBlend) < 1e-3) state.modeBlend = target;

      const f = buildFrame();
      app.lastFrame = f;
      listeners.frame.forEach((fn) => fn(f, dt));
      renderer.render(f);
      state.frame++;

      // Dynamic resolution: keep the frame time near 60 fps without dropping below 0.4x.
      if (!fixedScale && state.frame > 20) {
        frameTimes.push(dt);
        if (frameTimes.length > 24) frameTimes.shift();
        const avg = frameTimes.reduce((x, y) => x + y, 0) / frameTimes.length;
        const maxScale = 1 / Math.sqrt(app.pixelRatio || 1);
        if (now - lastScaleChange > 500 && frameTimes.length >= 12) {
          if (avg > 1 / 45 && state.renderScale > 0.4) {
            state.renderScale = Math.max(0.4, state.renderScale * 0.88);
            lastScaleChange = now;
            frameTimes = [];
          } else if (avg < 1 / 58 && state.renderScale < maxScale) {
            state.renderScale = Math.min(maxScale, state.renderScale * 1.06);
            lastScaleChange = now;
            frameTimes = [];
          }
        }
      }
      if (!params.has('noloop')) requestAnimationFrame(frame);
    }

    app.renderOnce = () => {
      resize();
      const f = buildFrame();
      app.lastFrame = f;
      listeners.frame.forEach((fn) => fn(f, 0));
      renderer.render(f);
      return f;
    };

    // Realistic mode is exposed like a camera metering on the brightest gas: the peak of
    // (g T)^4 over the disk, where g is the Doppler + gravitational shift at the approaching limb.
    function peakBeamedIntensity(incl, camZ) {
      const a = state.spin, prof = derived.tempProfile, n = prof.length;
      const s = Math.abs(Math.sin(incl));
      let peak = 1e-6;
      for (let i = 1; i < n; i++) {
        const r = derived.rIn + ((derived.rOut - derived.rIn) * i) / (n - 1);
        const g = camZ / (Phys.utKepler(r, a) * (1 - Phys.omegaKepler(r, a) * r * s));
        if (g > 0) peak = Math.max(peak, Math.pow(g * prof[i], 4));
      }
      return peak;
    }

    // Keep a sensible horizontal field of view on tall (portrait) screens.
    function fovFor(aspect) {
      const t = Math.tan(camera.fovY / 2);
      return aspect >= 1.25 ? camera.fovY : Math.min(80 * DEG, 2 * Math.atan((t * 1.25) / aspect));
    }

    function buildFrame() {
      const b = camera.basis();
      const tetrad = Phys.cameraTetrad(b.pos, -state.spin, b.fwd, b.up, b.right);
      const m = state.modeBlend;
      const gain = Math.pow(state.mdot / 0.1, 0.4);
      return {
        frame: state.frame,
        renderScale: state.renderScale,
        pixelRatio: app.pixelRatio || 1,
        camera: { pos: b.pos, fwd: b.fwd, up: b.up, right: b.right, fovY: fovFor(canvas.width / Math.max(1, canvas.height)), tetrad, shift: app.viewShift.slice() },
        spin: state.spin,
        rH: derived.rH,
        rIn: derived.rIn,
        rOut: derived.rOut,
        time: state.time,
        diskGain: gain,
        mode: m,
        iscoRing: state.labels && !(app.lab && app.lab.active) ? 1 : 0,
        diskTempK: derived.displayTempK,
        skyGain: lerp(1.0, 0.55, m),
        grid: state.grid ? 1 : 0,
        shell: state.shell ? 1 : 0,
        shellR: derived.shell,
        stepK: state.quality === 'fast' ? 0.14 : 0.1,
        maxSteps: state.quality === 'fast' ? 220 : 400,
        rEsc: Math.max(150, camera.dist * 2.5),
        diskDim: app.lab && app.lab.active ? 0.78 : 0,
        probe: app.probe ? app.probe.frameInfo() : null,
        exposure: lerp(1.05, 0.8 / (1.3 * peakBeamedIntensity(camera.incl, tetrad.redshiftFactor)), m),
        bloomStrength: params.has('debug') ? 0 : lerp(0.6, 0.5, m),
        bloomThreshold: 0.9,
        vignette: params.has('debug') ? 0 : 0.55,
        grain: params.has('debug') ? 0 : 0.012,
        lines: [],
        points: [],
        occlusionRadius: derived.rH,
        debug: +(params.get('debug') || 0),
      };
    }
    app.buildFrame = buildFrame;
    app.ready = true;
    requestAnimationFrame(frame);
    document.documentElement.dataset.ready = '1';
  }

  function showFatal(err) {
    console.error(err);
    const el = document.getElementById('fatal');
    if (el) {
      el.hidden = false;
      el.querySelector('p').textContent = String(err.message || err);
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  app.DEG = DEG;
  root.BHApp = app;
  window.addEventListener('DOMContentLoaded', init);
})(typeof globalThis !== 'undefined' ? globalThis : this);
