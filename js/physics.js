/*
 * Kerr black-hole physics used by the exhibit.
 *
 * Units: geometric, G = c = M = 1, so lengths are in GM/c^2 and times in GM/c^3.
 * The spin parameter `a` is signed. The accretion disk always orbits toward +phi
 * (counter-clockwise seen from +z), so a > 0 means the hole spins with the disk and
 * a < 0 means against it.
 *
 * Geodesics are integrated in Cartesian Kerr–Schild coordinates with the Hamiltonian
 *   H = 1/2 g^{mu nu} p_mu p_nu,   g^{mu nu} = eta^{mu nu} - f l^mu l^nu,
 * which has no coordinate singularity at the horizon or on the spin axis.
 *
 * The file runs in the browser (exposes window.BHPhysics) and in Node (module.exports)
 * so the same code is unit tested in tests/physics.test.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BHPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  const SUN = {
    timeSec: 4.925490947e-6, // GM_sun / c^3
    lengthKm: 1.476625038, // GM_sun / c^2
    gm: 1.32712440018e20, // GM_sun (m^3 s^-2)
    lEdd: 1.257e31, // Eddington luminosity per solar mass (W)
    lum: 3.828e26, // solar luminosity (W)
    radiusKm: 695700,
  };
  const C = 299792458;
  const SIGMA_SB = 5.670374419e-8;
  const G_EARTH = 9.80665;
  const HAWKING_K = 2.4684e-7; // hbar c^3 / (2 pi k_B G M_sun) in kelvin

  // ------------------------------------------------------- characteristic radii
  const horizon = (a) => 1 + Math.sqrt(Math.max(0, 1 - a * a));
  const innerHorizon = (a) => 1 - Math.sqrt(Math.max(0, 1 - a * a));

  /** Innermost stable circular orbit for gas orbiting toward +phi. */
  function isco(a) {
    const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
    const z2 = Math.sqrt(3 * a * a + z1 * z1);
    return 3 + z2 - Math.sign(a) * Math.sqrt(Math.max(0, (3 - z1) * (3 + z1 + 2 * z2)));
  }

  /** Circular equatorial photon orbit moving toward +phi (with the disk). */
  const photonOrbitWithDisk = (a) => 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
  /** Circular equatorial photon orbit moving toward -phi (against the disk). */
  const photonOrbitAgainstDisk = (a) => 2 * (1 + Math.cos((2 / 3) * Math.acos(a)));

  /** Range of radii [inner, outer] filled by spherical photon orbits (the photon shell). */
  function photonShell(a) {
    const r1 = photonOrbitWithDisk(a);
    const r2 = photonOrbitAgainstDisk(a);
    return [Math.min(r1, r2), Math.max(r1, r2)];
  }

  /** Critical impact parameters b = L/E of equatorial photons moving toward +phi and -phi. */
  function criticalImpact(a) {
    return {
      withDisk: -a + 6 * Math.cos(Math.acos(-a) / 3),
      againstDisk: -a - 6 * Math.cos(Math.acos(a) / 3),
    };
  }

  /** Spherical photon orbit constants of motion (E = 1): angular momentum L and Carter constant Q. */
  function sphericalPhotonOrbit(r, a) {
    const L = -(r * r * r - 3 * r * r + a * a * r + a * a) / (a * (r - 1));
    const Q = (-r * r * r * (r * r * r - 6 * r * r + 9 * r - 4 * a * a)) / (a * a * (r - 1) * (r - 1));
    return { L, Q };
  }

  // ------------------------------------------------------------- disk physics
  const omegaKepler = (r, a) => 1 / (Math.pow(r, 1.5) + a);
  function utKepler(r, a) {
    const s = Math.sqrt(r);
    return (r * s + a) / (Math.pow(r, 0.75) * Math.sqrt(r * s - 3 * s + 2 * a));
  }
  /** Fraction of rest-mass energy radiated by gas spiralling down to the ISCO. */
  const efficiency = (a) => 1 - Math.sqrt(1 - 2 / (3 * isco(a)));

  /**
   * Novikov–Thorne / Page–Thorne flux of a thin disk, in units of Mdot c^2 / (GM/c^2)^2.
   * Zero at the ISCO (no torque at the inner edge), Newtonian 3/(8 pi r^3)(1 - sqrt(r_in/r)) far out.
   */
  function novikovThorneFlux(r, a) {
    const x = Math.sqrt(r);
    const x0 = Math.sqrt(isco(a));
    if (x <= x0) return 0;
    const ac = Math.acos(a);
    const x1 = 2 * Math.cos((ac - Math.PI) / 3);
    const x2 = 2 * Math.cos((ac + Math.PI) / 3);
    const x3 = -2 * Math.cos(ac / 3);
    const coef = (xi, xj, xk) => (Math.abs(xi) < 1e-12 ? 0 : (3 * (xi - a) * (xi - a)) / (xi * (xi - xj) * (xi - xk)));
    const term = (xi, c) => (c === 0 ? 0 : c * Math.log((x - xi) / (x0 - xi)));
    const bracket =
      x - x0 - 1.5 * a * Math.log(x / x0) -
      term(x1, coef(x1, x2, x3)) -
      term(x2, coef(x2, x1, x3)) -
      term(x3, coef(x3, x1, x2));
    return ((3 / (8 * Math.PI)) * bracket) / (x ** 4 * (x ** 3 - 3 * x + 2 * a));
  }

  /** Temperature profile T(r)/T_peak sampled on [rIn, rOut]; returns { data, peakR }. */
  function diskTemperatureProfile(a, rIn, rOut, n = 256) {
    const data = new Float32Array(n);
    let peak = 0;
    let peakR = rIn;
    for (let i = 0; i < n; i++) {
      const r = rIn + ((rOut - rIn) * i) / (n - 1);
      const t = Math.pow(Math.max(0, novikovThorneFlux(r, a)), 0.25);
      data[i] = t;
      if (t > peak) {
        peak = t;
        peakR = r;
      }
    }
    for (let i = 0; i < n; i++) data[i] /= peak || 1;
    return { data, peakR };
  }

  // ------------------------------------------------------- physical readouts
  /**
   * Physical numbers for a hole of `massSun` solar masses, spin `a`, fed at `mdotEdd`
   * (fraction of the Eddington accretion rate).
   */
  function physicalProperties(massSun, a, mdotEdd) {
    const rg = SUN.lengthKm * massSun; // km per GM/c^2
    const tg = SUN.timeSec * massSun; // s per GM/c^3
    const rH = horizon(a);
    const rI = isco(a);
    const eta = efficiency(a);
    const lum = mdotEdd * SUN.lEdd * massSun; // W
    const mdot = lum / (eta * C * C); // kg/s
    const rgM = rg * 1000;
    // peak effective temperature of the Novikov–Thorne disk
    let fMax = 0;
    for (let i = 1; i <= 400; i++) {
      const r = rI * (1 + (i / 400) * 4);
      fMax = Math.max(fMax, novikovThorneFlux(r, a));
    }
    const fluxSI = (fMax * mdot * C * C) / (rgM * rgM);
    const tPeak = Math.pow(fluxSI / SIGMA_SB, 0.25);
    const rMinus = innerHorizon(a);
    const kappa = (rH - rMinus) / (2 * (rH * rH + a * a)); // surface gravity in 1/M
    const omegaH = a / (2 * rH);
    // radial tidal stretch across a 2 m body at the horizon: 2 G M L / r^3
    const rHm = rH * rgM;
    const tidal = (2 * SUN.gm * massSun * 2) / (rHm * rHm * rHm);
    return {
      rg,
      tg,
      rH,
      rI,
      eta,
      horizonKm: rH * rg,
      horizonCircumferenceKm: 2 * Math.PI * Math.sqrt(rH * rH + a * a) * rg,
      schwarzschildKm: 2 * rg,
      shadowDiameterKm: 2 * Math.sqrt(27) * rg,
      iscoKm: rI * rg,
      iscoPeriodSec: 2 * Math.PI * (Math.pow(rI, 1.5) + a) * tg,
      horizonSpinPeriodSec: Math.abs(omegaH) > 1e-9 ? (2 * Math.PI) / Math.abs(omegaH) * tg : Infinity,
      luminosityW: lum,
      luminositySun: lum / SUN.lum,
      mdotKgS: mdot,
      mdotSunPerYear: (mdot * 3.15576e7) / 1.98847e30,
      diskPeakK: tPeak,
      hawkingK: (HAWKING_K * kappa) / massSun,
      tidalG: tidal / G_EARTH,
      lightCrossSec: 2 * rH * tg,
      iscoFreqHz: 1 / (2 * Math.PI * (Math.pow(rI, 1.5) + a) * tg),
    };
  }

  // ------------------------------------------------------ Kerr–Schild geometry
  function ksR(x, y, z, a) {
    const a2 = a * a;
    const k = x * x + y * y + z * z - a2;
    const r2 = 0.5 * (k + Math.sqrt(k * k + 4 * a2 * z * z));
    return Math.sqrt(Math.max(r2, 0));
  }

  /**
   * Right-hand side of Hamilton's equations. State s = [x, y, z, px, py, pz, t].
   * E = -p_t is conserved (1 for photons in our normalisation, <1 for bound massive bodies).
   * Returns derivatives with respect to the affine parameter (proper time for massive bodies).
   */
  function ksDerivs(s, a, E, out) {
    const x = s[0], y = s[1], z = s[2], px = s[3], py = s[4], pz = s[5];
    const a2 = a * a;
    const k = x * x + y * y + z * z - a2;
    const r2 = 0.5 * (k + Math.sqrt(k * k + 4 * a2 * z * z));
    const r = Math.sqrt(r2);
    const W = r2 * r2 + a2 * z * z;
    const f = (2 * r * r2) / W;
    const N = r2 + a2;
    const lx = (r * x + a * y) / N;
    const ly = (r * y - a * x) / N;
    const lz = z / r;
    const T = lx * px + ly * py + lz * pz;
    const S = E + T;
    // positions and coordinate time
    out[0] = px - f * S * lx;
    out[1] = py - f * S * ly;
    out[2] = pz - f * S * lz;
    out[6] = E + f * S;
    // gradients
    const grx = (x * r * r2) / W, gry = (y * r * r2) / W, grz = (z * r * N) / W;
    const cf = 3 / r - (4 * r * r2) / W;
    const gfx = f * cf * grx, gfy = f * cf * gry, gfz = f * (cf * grz - (2 * a2 * z) / W);
    const A = x * px + y * py;
    const B = y * px - x * py;
    const Cc = A / N - (2 * r * (r * A + a * B)) / (N * N) - (z * pz) / r2;
    const gTx = Cc * grx + (r * px - a * py) / N;
    const gTy = Cc * gry + (r * py + a * px) / N;
    const gTz = Cc * grz + pz / r;
    const hS2 = 0.5 * S * S, fS = f * S;
    out[3] = hS2 * gfx + fS * gTx;
    out[4] = hS2 * gfy + fS * gTy;
    out[5] = hS2 * gfz + fS * gTz;
    return out;
  }

  /** Hamiltonian value (0 for photons, -1/2 for unit-mass bodies). Used to check accuracy. */
  function ksHamiltonian(s, a, E) {
    const r = ksR(s[0], s[1], s[2], a);
    const a2 = a * a, r2 = r * r, N = r2 + a2;
    const f = (2 * r * r2) / (r2 * r2 + a2 * s[2] * s[2]);
    const T = ((r * s[0] + a * s[1]) / N) * s[3] + ((r * s[1] - a * s[0]) / N) * s[4] + (s[2] / r) * s[5];
    const S = E + T;
    return 0.5 * (-E * E + s[3] * s[3] + s[4] * s[4] + s[5] * s[5] - f * S * S);
  }

  function makeStepper(a, E) {
    const k1 = new Float64Array(7), k2 = new Float64Array(7), k3 = new Float64Array(7), k4 = new Float64Array(7);
    const tmp = new Float64Array(7);
    return function rk4(s, h) {
      ksDerivs(s, a, E, k1);
      for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * h * k1[i];
      ksDerivs(tmp, a, E, k2);
      for (let i = 0; i < 7; i++) tmp[i] = s[i] + 0.5 * h * k2[i];
      ksDerivs(tmp, a, E, k3);
      for (let i = 0; i < 7; i++) tmp[i] = s[i] + h * k3[i];
      ksDerivs(tmp, a, E, k4);
      for (let i = 0; i < 7; i++) s[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      return s;
    };
  }

  /** Covariant metric, inverse metric and helpers at a point. */
  function ksMetric(x, y, z, a) {
    const r = ksR(x, y, z, a);
    const a2 = a * a, r2 = r * r, N = r2 + a2;
    const f = (2 * r * r2) / (r2 * r2 + a2 * z * z);
    const lDown = [1, (r * x + a * y) / N, (r * y - a * x) / N, z / r];
    const lUp = [-1, lDown[1], lDown[2], lDown[3]];
    const g = [], gi = [];
    for (let m = 0; m < 4; m++) {
      g.push([]);
      gi.push([]);
      for (let n = 0; n < 4; n++) {
        const eta = m === n ? (m === 0 ? -1 : 1) : 0;
        g[m].push(eta + f * lDown[m] * lDown[n]);
        gi[m].push(eta - f * lUp[m] * lUp[n]);
      }
    }
    return { g, gi, f, r, lDown };
  }

  const dot4 = (g, A, B) => {
    let s = 0;
    for (let m = 0; m < 4; m++) for (let n = 0; n < 4; n++) s += g[m][n] * A[m] * B[n];
    return s;
  };
  const lower = (g, A) => [0, 1, 2, 3].map((m) => g[m][0] * A[0] + g[m][1] * A[1] + g[m][2] * A[2] + g[m][3] * A[3]);

  /**
   * Orthonormal frame of an observer with 4-velocity u, built by Gram–Schmidt from
   * Euclidean spatial directions (first direction is kept exactly, e.g. the view axis).
   */
  function observerFrame(g, u, dirs) {
    const basis = [];
    for (const v of dirs) {
      let w = [0, v[0], v[1], v[2]];
      const du = dot4(g, w, u);
      w = w.map((c, i) => c + du * u[i]);
      for (const e of basis) {
        const d = dot4(g, w, e);
        w = w.map((c, i) => c - d * e[i]);
      }
      const n = Math.sqrt(dot4(g, w, w));
      basis.push(w.map((c) => c / n));
    }
    return basis;
  }

  /** 4-velocity of a static observer (hovering at fixed Kerr–Schild position). */
  function staticVelocity(m) {
    return [1 / Math.sqrt(1 - m.f), 0, 0, 0];
  }

  /** 4-velocity of a zero-angular-momentum observer (exists everywhere outside the horizon). */
  function zamoVelocity(x, y, z, a, m) {
    const r = m.r, r2 = r * r, a2 = a * a, N = r2 + a2;
    const W = r2 * r2 + a2 * z * z;
    const delta = r2 - 2 * r + a2;
    const Fp = (2 * r) / delta; // d(t_KS - t_BL)/dr
    const w = [-1, (Fp * x * r * r2) / W, (Fp * y * r * r2) / W, (Fp * z * r * N) / W];
    const u = [0, 1, 2, 3].map((mu) => m.gi[mu][0] * w[0] + m.gi[mu][1] * w[1] + m.gi[mu][2] * w[2] + m.gi[mu][3] * w[3]);
    const norm = Math.sqrt(-(u[0] * w[0] + u[1] * w[1] + u[2] * w[2] + u[3] * w[3]));
    return u.map((c) => c / norm);
  }

  /**
   * Camera frame for the ray tracer: a static observer at `pos` in a chart with spin `a`.
   * Returns covariant tetrad legs so a pixel's photon momentum is p = E0 + sum d_i E_i.
   */
  function cameraTetrad(pos, a, forward, up, right) {
    const m = ksMetric(pos[0], pos[1], pos[2], a);
    const u = staticVelocity(m);
    const [ef, eu, er] = observerFrame(m.g, u, [forward, up, right]);
    return {
      E0: lower(m.g, u),
      Eright: lower(m.g, er),
      Eup: lower(m.g, eu),
      Eforward: lower(m.g, ef),
      redshiftFactor: 1 / Math.sqrt(1 - m.f), // photon energy seen by the camera for E = 1
      f: m.f,
    };
  }

  /** Initial photon state leaving `pos` along Euclidean direction `dir`, measured by a ZAMO. */
  function photonFromZamo(pos, dir, a) {
    const m = ksMetric(pos[0], pos[1], pos[2], a);
    const u = zamoVelocity(pos[0], pos[1], pos[2], a, m);
    const [n] = observerFrame(m.g, u, [dir]);
    const k = u.map((c, i) => c + n[i]);
    const p = lower(m.g, k);
    const E = -p[0];
    return new Float64Array([pos[0], pos[1], pos[2], p[1] / E, p[2] / E, p[3] / E, 0]);
  }

  // ------------------------------------------------------------ photon tracing
  /**
   * Integrate a photon forward in time (ingoing Kerr–Schild chart, spin a).
   * Returns the path (x, y, z, t per point) and its fate.
   */
  function tracePhoton(state, a, opts = {}) {
    const rH = horizon(a);
    const rFar = opts.rFar ?? 70;
    const maxT = opts.maxTime ?? 2500;
    const hs = opts.stepScale ?? 0.01;
    const maxPts = opts.maxPoints ?? 60000;
    const s = Float64Array.from(state);
    const rk4 = makeStepper(a, 1);
    const pts = [s[0], s[1], s[2], s[6]];
    const L = s[0] * s[4] - s[1] * s[3];
    const d0 = new Float64Array(7);
    ksDerivs(s, a, 1, d0);
    const v0 = normalize3([d0[0], d0[1], d0[2]]);
    let swept = 0;
    let prev = normalize3([s[0], s[1], s[2]]);
    let rMin = Infinity;
    let fate = 'orbiting';
    let lastStored = [s[0], s[1], s[2]];
    let steps = 0;
    const d = new Float64Array(7);
    while (steps++ < 400000) {
      const r = ksR(s[0], s[1], s[2], a);
      rMin = Math.min(rMin, r);
      if (r < rH * 0.999) {
        fate = 'captured';
        break;
      }
      ksDerivs(s, a, 1, d);
      if (r > rFar && s[0] * d[0] + s[1] * d[1] + s[2] * d[2] > 0) {
        fate = 'escaped';
        break;
      }
      if (s[6] > maxT) break;
      const h = hs * Math.max(0.05, Math.min(r, r > 12 ? r * 1.5 : r));
      rk4(s, h);
      const cur = normalize3([s[0], s[1], s[2]]);
      swept += Math.acos(Math.min(1, Math.max(-1, cur[0] * prev[0] + cur[1] * prev[1] + cur[2] * prev[2])));
      prev = cur;
      const dx = s[0] - lastStored[0], dy = s[1] - lastStored[1], dz = s[2] - lastStored[2];
      if (dx * dx + dy * dy + dz * dz > 0.0016 && pts.length < maxPts * 4) {
        pts.push(s[0], s[1], s[2], s[6]);
        lastStored = [s[0], s[1], s[2]];
      }
    }
    pts.push(s[0], s[1], s[2], s[6]);
    ksDerivs(s, a, 1, d);
    const v1 = normalize3([d[0], d[1], d[2]]);
    const deflection = Math.acos(Math.min(1, Math.max(-1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2])));
    return {
      points: new Float32Array(pts),
      fate,
      orbits: swept / (2 * Math.PI),
      sweptAngle: swept,
      deflection,
      L,
      rMin,
      duration: s[6],
      final: Float64Array.from(s),
    };
  }

  function normalize3(v) {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  }

  /**
   * Spherical photon orbits filling the photon shell, drawn in the oblate-spheroidal
   * embedding x + i y = sqrt(r^2 + a^2) sin(theta) e^{i phi}, z = r cos(theta).
   * Integrated in Mino time with r held fixed (the orbits are unstable in r).
   */
  function sphericalOrbitPaths(a, count = 24, revolutions = 3) {
    const paths = [];
    if (Math.abs(a) < 0.02) {
      // Schwarzschild: every great circle of radius 3M is a photon orbit.
      for (let i = 0; i < count; i++) {
        const tilt = (Math.PI * (i + 0.5)) / count;
        const node = i * 2.39996;
        const pts = [];
        const n = 256;
        for (let j = 0; j <= n; j++) {
          const u = (2 * Math.PI * j) / n;
          const cx = 3 * Math.cos(u), cy = 3 * Math.sin(u) * Math.cos(tilt), cz = 3 * Math.sin(u) * Math.sin(tilt);
          pts.push(cx * Math.cos(node) - cy * Math.sin(node), cx * Math.sin(node) + cy * Math.cos(node), cz);
        }
        paths.push({ r: 3, L: Math.cos(tilt) * Math.sqrt(27), points: new Float32Array(pts) });
      }
      return paths;
    }
    const [rLo, rHi] = photonShell(a);
    for (let i = 0; i < count; i++) {
      const r = rLo + ((rHi - rLo) * (i + 0.5)) / count;
      let { L, Q } = sphericalPhotonOrbit(r, a);
      if (!(Q > 0)) continue;
      if (Math.abs(L) < 0.02) L = 0;
      const a2 = a * a, delta = r * r - 2 * r + a2;
      const P = r * r + a2 - a * L;
      let th = Math.PI / 2, dth = Math.sqrt(Q), ph = (i * 2.39996) % (2 * Math.PI);
      const R = Math.sqrt(r * r + a2);
      const pts = [];
      const accel = (t) => {
        const st = Math.sin(t), ct = Math.cos(t);
        return -a2 * st * ct + (L === 0 ? 0 : (L * L * ct) / (st * st * st));
      };
      const phiDot = (t) => {
        const st = Math.sin(t);
        return (a * P) / delta - a + (L === 0 ? 0 : L / (st * st));
      };
      let swept = 0;
      let guard = 0;
      while (swept < revolutions * 2 * Math.PI && guard++ < 20000) {
        pts.push(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), r * Math.cos(th));
        const st = Math.abs(Math.sin(th));
        const h = 0.012 * Math.min(1, 4 * st * st + 0.02);
        // RK4 on (theta, dtheta, phi)
        const f1t = dth, f1v = accel(th), f1p = phiDot(th);
        const t2 = th + 0.5 * h * f1t, v2 = dth + 0.5 * h * f1v;
        const f2t = v2, f2v = accel(t2), f2p = phiDot(t2);
        const t3 = th + 0.5 * h * f2t, v3 = dth + 0.5 * h * f2v;
        const f3t = v3, f3v = accel(t3), f3p = phiDot(t3);
        const t4 = th + h * f3t, v4 = dth + h * f3v;
        const f4t = v4, f4v = accel(t4), f4p = phiDot(t4);
        const dph = (h / 6) * (f1p + 2 * f2p + 2 * f3p + f4p);
        th += (h / 6) * (f1t + 2 * f2t + 2 * f3t + f4t);
        dth += (h / 6) * (f1v + 2 * f2v + 2 * f3v + f4v);
        ph += dph;
        // angle travelled along the sphere, for a fair stopping rule
        swept += Math.hypot(dph * Math.max(st, 0.05), (h / 6) * (f1t + 2 * f2t + 2 * f3t + f4t));
      }
      paths.push({ r, L, Q, points: new Float32Array(pts) });
    }
    return paths;
  }

  // ------------------------------------------------------------- infall probe
  /** Kerr–Schild minus Boyer–Lindquist time and azimuth offsets (ingoing chart). */
  function ingoingOffsets(r, a) {
    const rp = horizon(a), rm = innerHorizon(a), d = rp - rm;
    const F = (2 / d) * (rp * Math.log(Math.abs(r - rp)) - (rm > 0 ? rm * Math.log(Math.abs(r - rm)) : 0));
    const Gphi = (a / d) * Math.log(Math.abs((r - rp) / (r - rm)));
    return { F, G: Gphi };
  }

  /**
   * Drop a probe from rest (a hovering platform) at `pos` and integrate its free fall.
   * The result is resampled on a uniform grid in the time coordinate that the ray tracer uses
   * (outgoing Kerr–Schild time, i.e. the moment light leaves the probe on its way to the camera),
   * with positions in the tracer's chart. Each sample: [x, y, z, tau] and [vx, vy, vz, u^t].
   */
  function buildProbe(pos, a, n = 1024) {
    const rH = horizon(a);
    const rM = innerHorizon(a);
    const m = ksMetric(pos[0], pos[1], pos[2], a);
    const u = staticVelocity(m);
    const p = lower(m.g, u);
    const E = -p[0];
    const s = new Float64Array([pos[0], pos[1], pos[2], p[1], p[2], p[3], 0]);
    const rk4 = makeStepper(a, E);
    const raw = []; // tau, t_out, x, y, z (tracer chart)
    let tau = 0;
    let tauHorizon = null;
    let tInHorizon = null;
    let tauEnd = null;
    const sample = () => {
      const r = ksR(s[0], s[1], s[2], a);
      if (r <= rH) return r;
      const { F, G } = ingoingOffsets(r, a);
      const tOut = s[6] - 2 * F;
      const rot = -2 * (Math.atan2(a, r) + G);
      const c = Math.cos(rot), sn = Math.sin(rot);
      raw.push(tau, tOut, c * s[0] - sn * s[1], sn * s[0] + c * s[1], s[2]);
      return r;
    };
    let guard = 0;
    while (guard++ < 200000) {
      const r = sample();
      if (r <= rH) break;
      if (r - rH < 1e-9) break;
      const h = Math.min(0.02 * r, 0.03 * (r - rH) + 1e-6);
      rk4(s, h);
      tau += h;
      if (ksR(s[0], s[1], s[2], a) <= rH && tauHorizon === null) {
        tauHorizon = tau;
        tInHorizon = s[6];
      }
    }
    if (tauHorizon === null) {
      tauHorizon = tau;
      tInHorizon = s[6];
    }
    // Continue inside the horizon to find when the probe meets the singularity (a = 0)
    // or the inner horizon (a != 0), where known physics stops being trustworthy.
    const rStop = Math.abs(a) < 1e-3 ? 0.02 : rM + 0.02 * (rH - rM);
    guard = 0;
    while (guard++ < 200000) {
      const r = ksR(s[0], s[1], s[2], a);
      if (r <= rStop || !isFinite(r)) break;
      const h = 0.004 * Math.max(r, 0.05);
      rk4(s, h);
      tau += h;
    }
    tauEnd = tau;

    const count = raw.length / 5;
    const t0 = raw[1];
    const t1 = raw[(count - 1) * 5 + 1];
    const dt = (t1 - t0) / (n - 1);
    const pos4 = new Float32Array(n * 4);
    const vel4 = new Float32Array(n * 4);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * dt;
      while (j < count - 2 && raw[(j + 1) * 5 + 1] < t) j++;
      const ta = raw[j * 5 + 1], tb = raw[(j + 1) * 5 + 1];
      const w = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
      for (let k = 0; k < 3; k++) pos4[i * 4 + k] = raw[j * 5 + 2 + k] * (1 - w) + raw[(j + 1) * 5 + 2 + k] * w;
      pos4[i * 4 + 3] = raw[j * 5] * (1 - w) + raw[(j + 1) * 5] * w;
    }
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const span = (i1 - i0) * dt;
      const dtau = pos4[i1 * 4 + 3] - pos4[i0 * 4 + 3];
      const ut = dtau > 1e-9 ? span / dtau : 1e4;
      for (let k = 0; k < 3; k++) vel4[i * 4 + k] = ((pos4[i1 * 4 + k] - pos4[i0 * 4 + k]) / span) * ut;
      vel4[i * 4 + 3] = ut;
    }
    // Before release the probe hovers: static observer, no velocity.
    vel4[0] = vel4[1] = vel4[2] = 0;
    vel4[3] = 1 / Math.sqrt(1 - m.f);
    return { pos4, vel4, t0, dt, n, tauHorizon, tInHorizon, tauEnd, energy: E, spin: a, start: pos.slice(), endsAtSingularity: Math.abs(a) < 1e-3 };
  }

  /** Sample the probe table at outgoing time t (clamped to its ends). */
  function probeAt(probe, t) {
    const x = Math.min(probe.n - 1, Math.max(0, (t - probe.t0) / probe.dt));
    const i = Math.min(probe.n - 2, Math.floor(x));
    const w = x - i;
    const out = new Float64Array(8);
    for (let k = 0; k < 4; k++) {
      out[k] = probe.pos4[i * 4 + k] * (1 - w) + probe.pos4[(i + 1) * 4 + k] * w;
      out[4 + k] = probe.vel4[i * 4 + k] * (1 - w) + probe.vel4[(i + 1) * 4 + k] * w;
    }
    return out;
  }

  /**
   * What a distant camera sees of the probe right now. Light is followed along the outgoing
   * principal null direction (t_out - r constant), exact for a probe radially below the camera.
   * `tracerSpin` is the chart spin used by the ray tracer (-a).
   */
  function probeAsSeen(probe, tCam, camPos, camRedshift) {
    const a = probe.spin;
    const rCam = ksR(camPos[0], camPos[1], camPos[2], -a);
    const target = tCam - rCam;
    let lo = probe.t0 - 1e4, hi = probe.t0 + probe.dt * (probe.n - 1);
    const key = (t) => {
      const st = probeAt(probe, t);
      return t - ksR(st[0], st[1], st[2], -a);
    };
    if (key(hi) < target) lo = hi;
    else {
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (key(mid) < target) lo = mid;
        else hi = mid;
      }
    }
    const st = probeAt(probe, lo);
    const r = ksR(st[0], st[1], st[2], -a);
    // incoming principal null direction of the tracer chart: p = -l
    const a2 = a * a, N = r * r + a2, at = -a;
    const lx = (r * st[0] + at * st[1]) / N, ly = (r * st[1] - at * st[0]) / N, lz = st[2] / r;
    const denom = st[7] - (lx * st[4] + ly * st[5] + lz * st[6]);
    const g = camRedshift / denom;
    return { tau: st[3], r, g, position: [st[0], st[1], st[2]], frozen: lo >= probe.t0 + probe.dt * (probe.n - 1) - 1e-6 };
  }

  // -------------------------------------------------------------- blackbody
  /** CIE 1931 colour matching functions (Wyman, Sloan & Shirley 2013 multi-lobe fit). */
  function cie(l) {
    const g = (x, mu, s1, s2) => {
      const t = (x - mu) / (x < mu ? s1 : s2);
      return Math.exp(-0.5 * t * t);
    };
    return [
      1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
      0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
      1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
    ];
  }

  /** Linear-sRGB chromaticity of a blackbody at temperature T (kelvin), luminance normalised to 1. */
  function blackbodyRGB(T) {
    let X = 0, Y = 0, Z = 0;
    for (let l = 380; l <= 780; l += 5) {
      const lm = l * 1e-9;
      const planck = 1 / (Math.pow(lm, 5) * (Math.exp(0.0143877735 / (lm * T)) - 1));
      const [xb, yb, zb] = cie(l);
      X += planck * xb;
      Y += planck * yb;
      Z += planck * zb;
    }
    X /= Y;
    Z /= Y;
    Y = 1;
    const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    const Gc = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    const Bc = 0.0557 * X - 0.204 * Y + 1.057 * Z;
    return [Math.max(0, R), Math.max(0, Gc), Math.max(0, Bc)];
  }

  const BB_T_MIN = 800, BB_T_MAX = 40000;
  /** Lookup table over log(T) used by the shaders (RGB triples). */
  function blackbodyLUT(n = 256) {
    const out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const T = BB_T_MIN * Math.pow(BB_T_MAX / BB_T_MIN, i / (n - 1));
      const c = blackbodyRGB(T);
      out.set([c[0], c[1], c[2], 1], i * 4);
    }
    return out;
  }

  return {
    SUN,
    horizon,
    innerHorizon,
    isco,
    photonOrbitWithDisk,
    photonOrbitAgainstDisk,
    photonShell,
    criticalImpact,
    sphericalPhotonOrbit,
    omegaKepler,
    utKepler,
    efficiency,
    novikovThorneFlux,
    diskTemperatureProfile,
    physicalProperties,
    ksR,
    ksDerivs,
    ksHamiltonian,
    ksMetric,
    makeStepper,
    cameraTetrad,
    photonFromZamo,
    zamoVelocity,
    staticVelocity,
    observerFrame,
    tracePhoton,
    sphericalOrbitPaths,
    ingoingOffsets,
    buildProbe,
    probeAt,
    probeAsSeen,
    blackbodyRGB,
    blackbodyLUT,
    BB_T_MIN,
    BB_T_MAX,
  };
});
