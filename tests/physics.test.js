/* Physics regression tests. Run with: node tests/physics.test.js */
'use strict';
const P = require('../js/physics.js');

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? '  (' + detail + ')' : ''}`);
  }
}
const near = (x, y, tol) => Math.abs(x - y) <= tol;
const fmt = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(3) : x.toFixed(5));

console.log('Characteristic radii');
check('horizon a=0 is 2M', near(P.horizon(0), 2, 1e-12));
check('horizon a=0.998', near(P.horizon(0.998), 1.0632, 1e-4), fmt(P.horizon(0.998)));
check('ISCO a=0 is 6M', near(P.isco(0), 6, 1e-12));
check('ISCO a=1 is 1M', near(P.isco(1), 1, 1e-6));
check('ISCO a=-1 is 9M', near(P.isco(-1), 9, 1e-6));
check('ISCO a=0.998', near(P.isco(0.998), 1.2370, 1e-3), fmt(P.isco(0.998)));
check('photon orbit a=0 is 3M', near(P.photonOrbitWithDisk(0), 3, 1e-12) && near(P.photonOrbitAgainstDisk(0), 3, 1e-12));
check('photon orbits a=1 are 1M and 4M', near(P.photonOrbitWithDisk(1), 1, 1e-9) && near(P.photonOrbitAgainstDisk(1), 4, 1e-9));
check('critical impact a=0 is 3*sqrt(3)', near(P.criticalImpact(0).withDisk, Math.sqrt(27), 1e-12));
check('efficiency a=0 is 5.72%', near(P.efficiency(0), 0.0572, 1e-4), fmt(P.efficiency(0)));
check('efficiency a=0.998 about 32%', near(P.efficiency(0.998), 0.321, 2e-3), fmt(P.efficiency(0.998)));

console.log('Hamiltonian gradient (analytic vs finite difference)');
{
  let worst = 0;
  const rng = mulberry32(7);
  for (let trial = 0; trial < 200; trial++) {
    const a = rng() * 1.996 - 0.998;
    const E = trial % 2 ? 1 : 0.9;
    const s = new Float64Array([rng() * 20 - 10, rng() * 20 - 10, rng() * 8 - 4, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, 0]);
    if (P.ksR(s[0], s[1], s[2], a) < 1.5) continue;
    const d = P.ksDerivs(s, a, E, new Float64Array(7));
    for (let i = 0; i < 6; i++) {
      const eps = 1e-6;
      const sp = Float64Array.from(s), sm = Float64Array.from(s);
      sp[i] += eps;
      sm[i] -= eps;
      const dH = (P.ksHamiltonian(sp, a, E) - P.ksHamiltonian(sm, a, E)) / (2 * eps);
      // dx/dl = dH/dp, dp/dl = -dH/dx
      const expected = i < 3 ? -dH : dH;
      const got = i < 3 ? d[i + 3] : d[i - 3];
      worst = Math.max(worst, Math.abs(expected - got) / (1 + Math.abs(expected)));
    }
  }
  check('Hamilton equations match -dH/dx and dH/dp', worst < 1e-6, 'worst rel err ' + worst.toExponential(2));
}

console.log('Observer frames');
{
  const a = 0.9;
  const pos = [3.1, -4.2, 1.5];
  const m = P.ksMetric(pos[0], pos[1], pos[2], a);
  const u = P.zamoVelocity(pos[0], pos[1], pos[2], a, m);
  const frame = P.observerFrame(m.g, u, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const g = (A, B) => {
    let s = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += m.g[i][j] * A[i] * B[j];
    return s;
  };
  let err = Math.abs(g(u, u) + 1);
  for (let i = 0; i < 3; i++) {
    err = Math.max(err, Math.abs(g(frame[i], u)), Math.abs(g(frame[i], frame[i]) - 1));
    for (let j = 0; j < i; j++) err = Math.max(err, Math.abs(g(frame[i], frame[j])));
  }
  check('ZAMO frame is orthonormal', err < 1e-10, err.toExponential(2));
  const phiHat = [-pos[1], pos[0], 0];
  const s = P.photonFromZamo(pos, phiHat, a);
  check('photon launched from ZAMO is null', Math.abs(P.ksHamiltonian(s, a, 1)) < 1e-10);
  const cam = P.cameraTetrad([0, -30, 8], -0.9, [0, 30 / 31.05, -8 / 31.05], [0, 8 / 31.05, 30 / 31.05], [1, 0, 0]);
  const mi = P.ksMetric(0, -30, 8, -0.9).gi;
  const gi = (A, B) => {
    let s2 = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s2 += mi[i][j] * A[i] * B[j];
    return s2;
  };
  const fz = Math.sqrt(1 - 0.3 * 0.3 - 0.2 * 0.2);
  const pix = [0, 1, 2, 3].map((k) => cam.E0[k] + 0.3 * cam.Eright[k] - 0.2 * cam.Eup[k] + fz * cam.Eforward[k]);
  check('camera pixel momentum is null', Math.abs(gi(pix, pix)) < 1e-10, gi(pix, pix).toExponential(2));
}

console.log('Photon orbits and capture');
{
  // Bisection on launch offset for the capture threshold of an incoming equatorial beam.
  function threshold(a, sign) {
    let lo = 1, hi = 12;
    for (let i = 0; i < 40; i++) {
      const b = 0.5 * (lo + hi);
      const s = P.photonFromZamo([-400, sign * b, 0], [1, 0, 0], a);
      const res = P.tracePhoton(s, a, { stepScale: 0.004, rFar: 450, maxTime: 5000 });
      if (res.fate === 'captured') lo = b;
      else hi = b;
    }
    const s = P.photonFromZamo([-400, sign * hi, 0], [1, 0, 0], a);
    return Math.abs(s[0] * s[4] - s[1] * s[3]);
  }
  const b0 = threshold(0, 1);
  check('Schwarzschild capture threshold b = 3 sqrt(3) M', near(b0, Math.sqrt(27), 2e-3), fmt(b0));
  const a = 0.9;
  const bc = P.criticalImpact(a);
  // Launching at +y moving +x gives L < 0 (against the disk), at -y gives L > 0 (with the disk).
  const bWith = threshold(a, -1);
  const bAgainst = threshold(a, 1);
  check('Kerr a=0.9 capture threshold, photons moving with the spin', near(bWith, bc.withDisk, 3e-3), `${fmt(bWith)} vs ${fmt(bc.withDisk)}`);
  check('Kerr a=0.9 capture threshold, photons moving against the spin', near(bAgainst, -bc.againstDisk, 3e-3), `${fmt(bAgainst)} vs ${fmt(-bc.againstDisk)}`);

  // Weak-field deflection: 4M/b + 15 pi M^2 / (4 b^2)
  const b = 200;
  const s = P.photonFromZamo([-20000, b, 0], [1, 0, 0], 0);
  const res = P.tracePhoton(s, 0, { stepScale: 0.002, rFar: 20000, maxTime: 1e6 });
  const expected = 4 / b + (15 * Math.PI) / (4 * b * b);
  check('weak-field deflection matches 4M/b + 15piM^2/4b^2', near(res.deflection, expected, 5e-5 * 4), `${fmt(res.deflection)} vs ${fmt(expected)}`);

  // Circular photon orbit: stays on r = 3M for several orbits, then peels off.
  const circ = P.photonFromZamo([3, 0, 0], [0, 1, 0], 0);
  const cres = P.tracePhoton(circ, 0, { stepScale: 0.002, maxTime: 400 });
  check('tangential photon at r = 3M circles before escaping', cres.orbits > 2.5, `${cres.orbits.toFixed(2)} orbits, fate ${cres.fate}`);

  // Instability: every orbit multiplies a perturbation by e^(2 pi) ~ 535.
  const orbitsFor = (delta) => {
    const st = P.photonFromZamo([3 * (1 + delta), 0, 0], [0, 1, 0], 0);
    return P.tracePhoton(st, 0, { stepScale: 0.002, maxTime: 600 }).orbits;
  };
  const n3 = orbitsFor(1e-3), n6 = orbitsFor(1e-6);
  const predicted = Math.log(1000) / (2 * Math.PI);
  check('orbit count grows by ln(1000)/2pi per factor 1000 closer', near(n6 - n3, predicted, 0.15), `${(n6 - n3).toFixed(3)} vs ${predicted.toFixed(3)}`);

  // Kerr circular prograde photon orbit
  // On the equator the Kerr–Schild radius is sqrt(r^2 + a^2), not r.
  const rp = P.photonOrbitWithDisk(0.9);
  const kst = P.photonFromZamo([Math.hypot(rp, 0.9), 0, 0], [0, 1, 0], 0.9);
  const kres = P.tracePhoton(kst, 0.9, { stepScale: 0.002, maxTime: 300 });
  check('Kerr a=0.9 prograde photon orbit circles', kres.orbits > 1.5, `${kres.orbits.toFixed(2)} orbits at r=${rp.toFixed(3)}`);

  // Null condition conserved along a strongly bent Kerr ray
  const st = P.photonFromZamo([-40, 6.3, 2.0], [1, 0, -0.02], 0.95);
  const s2 = Float64Array.from(st);
  const step = P.makeStepper(0.95, 1);
  let worst = 0;
  for (let i = 0; i < 4000; i++) {
    const r = P.ksR(s2[0], s2[1], s2[2], 0.95);
    if (r < P.horizon(0.95) * 1.5) break;
    step(s2, 0.01 * r);
    const p2 = s2[3] * s2[3] + s2[4] * s2[4] + s2[5] * s2[5];
    worst = Math.max(worst, Math.abs(P.ksHamiltonian(s2, 0.95, 1)) / (1 + p2));
  }
  check('H = 0 conserved along a plunging Kerr photon (RK4, h = 0.01 r)', worst < 1e-6, 'relative ' + worst.toExponential(2));
}

console.log('Spherical photon orbits');
{
  const a = 0.8;
  const [lo, hi] = P.photonShell(a);
  let worst = 0;
  for (let i = 1; i < 10; i++) {
    const r = lo + ((hi - lo) * i) / 10;
    const { L, Q } = P.sphericalPhotonOrbit(r, a);
    const R = (rr) => (rr * rr + a * a - a * L) ** 2 - (rr * rr - 2 * rr + a * a) * (Q + (L - a) ** 2);
    const dR = (R(r + 1e-5) - R(r - 1e-5)) / 2e-5;
    worst = Math.max(worst, Math.abs(R(r)), Math.abs(dR));
  }
  check('constants satisfy R(r) = R\'(r) = 0', worst < 1e-5, worst.toExponential(2));
  const paths = P.sphericalOrbitPaths(a, 12);
  let rErr = 0;
  for (const p of paths) {
    for (let i = 0; i < p.points.length; i += 3) {
      rErr = Math.max(rErr, Math.abs(P.ksR(p.points[i], p.points[i + 1], p.points[i + 2], a) - p.r));
    }
  }
  check('drawn orbits stay on their sphere', rErr < 1e-4 && paths.length >= 10, `${paths.length} paths, max dr ${rErr.toExponential(2)}`);
}

console.log('Disk');
{
  const a = 0.6;
  check('Novikov-Thorne flux vanishes at the ISCO', P.novikovThorneFlux(P.isco(a), a) === 0);
  const r = 1e8;
  const newton = (3 / (8 * Math.PI * r ** 3)) * (1 - Math.sqrt(P.isco(a) / r));
  check('flux approaches the Newtonian thin disk far out', near(P.novikovThorneFlux(r, a) / newton, 1, 1e-3), fmt(P.novikovThorneFlux(r, a) / newton));
  // Closed form against direct integration of the Page–Thorne conservation laws.
  let worstNT = 0;
  for (const av of [-0.9, -0.3, 0, 0.6, 0.95]) {
    for (const k of [1.1, 1.7, 3, 6]) {
      const rr = P.isco(av) * k;
      worstNT = Math.max(worstNT, Math.abs(P.novikovThorneFlux(rr, av) / numericPageThorne(rr, av) - 1));
    }
  }
  check('closed-form flux equals the Page–Thorne integral', worstNT < 1e-4, 'worst rel err ' + worstNT.toExponential(2));
  const prof = P.diskTemperatureProfile(0, 6, 20);
  check('relativistic disk (a = 0) is hottest near r = 9.6M', near(prof.peakR, 9.57, 0.1), fmt(prof.peakR));
  let bad = 0;
  for (const av of [-0.998, -0.5, 0, 0.5, 0.998]) {
    for (let rr = P.isco(av) * 1.01; rr < 30; rr += 0.5) if (!(P.novikovThorneFlux(rr, av) > 0)) bad++;
  }
  check('flux positive for all spins', bad === 0);
  const props = P.physicalProperties(10, 0, 0.1);
  check('10 Msun ISCO orbital frequency is ~220 Hz', near(props.iscoFreqHz, 220, 3), props.iscoFreqHz.toFixed(1) + ' Hz');
  check('10 Msun Hawking temperature ~6.2 nK', near(props.hawkingK, 6.17e-9, 0.05e-9), props.hawkingK.toExponential(3));
  const sun = P.blackbodyRGB(5800), cool = P.blackbodyRGB(2000), hot = P.blackbodyRGB(20000);
  check('blackbody hues: cool is red, hot is blue', cool[0] > cool[2] * 3 && hot[2] > hot[0] && Math.abs(sun[0] - sun[2]) < 0.35);
}

console.log('Infalling probe');
{
  const probe = P.buildProbe([10, 0, 0], 0);
  const R = 10;
  const eta = Math.acos((2 * 2) / R - 1);
  const tauH = Math.sqrt((R * R * R) / 8) * (eta + Math.sin(eta));
  const tauS = Math.sqrt((R * R * R) / 8) * Math.PI;
  check('proper time to horizon from rest at 10M', near(probe.tauHorizon, tauH, 0.02), `${probe.tauHorizon.toFixed(3)} vs ${tauH.toFixed(3)}`);
  check('proper time to singularity', near(probe.tauEnd, tauS, 0.05), `${probe.tauEnd.toFixed(3)} vs ${tauS.toFixed(3)}`);
  let mono = true;
  for (let i = 1; i < probe.n; i++) if (probe.pos4[i * 4 + 3] < probe.pos4[(i - 1) * 4 + 3] - 1e-6) mono = false;
  check('probe clock runs forward through the table', mono);
  const early = P.probeAsSeen(probe, probe.t0 + 30, [30, 0, 0], 1 / Math.sqrt(1 - 2 / 30));
  const late = P.probeAsSeen(probe, probe.t0 + 400, [30, 0, 0], 1 / Math.sqrt(1 - 2 / 30));
  check('seen clock freezes before the horizon time', late.tau < probe.tauHorizon && late.tau > probe.tauHorizon - 1, `seen ${late.tau.toFixed(3)} < ${probe.tauHorizon.toFixed(3)}`);
  check('light from the probe fades toward zero', late.g < 1e-3 && early.g > 0.2, `g early ${early.g.toFixed(3)}, late ${late.g.toExponential(2)}`);
  // Static observer at 10M sees g = sqrt(1-2/10)/sqrt(1-2/30) before release.
  const hover = P.probeAsSeen(probe, probe.t0 - 50, [30, 0, 0], 1 / Math.sqrt(1 - 2 / 30));
  const gHover = Math.sqrt(1 - 2 / 10) / Math.sqrt(1 - 2 / 30);
  check('hovering probe shows gravitational redshift only', near(hover.g, gHover, 1e-3), `${hover.g.toFixed(4)} vs ${gHover.toFixed(4)}`);
  const kp = P.buildProbe([6, 4, 5], 0.9);
  const kl = P.probeAsSeen(kp, kp.t0 + 300, [0, -30, 5], 1.03);
  check('Kerr probe also freezes and fades', kl.g < 1e-2 && isFinite(kp.tauHorizon), `tau_H ${kp.tauHorizon.toFixed(2)}, g ${kl.g.toExponential(2)}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

function numericPageThorne(r, a) {
  const rin = P.isco(a);
  const den = (x) => x ** 0.75 * Math.sqrt(x ** 1.5 - 3 * x ** 0.5 + 2 * a);
  const E = (x) => (x ** 1.5 - 2 * x ** 0.5 + a) / den(x);
  const L = (x) => (x * x - 2 * a * x ** 0.5 + a * a) / den(x);
  const W = (x) => 1 / (x ** 1.5 + a);
  const d = (fn, x) => (fn(x * (1 + 1e-6)) - fn(x * (1 - 1e-6))) / (2e-6 * x);
  let I = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const x0 = rin + ((r - rin) * i) / n, x1 = rin + ((r - rin) * (i + 1)) / n, xm = 0.5 * (x0 + x1);
    I += (E(xm) - W(xm) * L(xm)) * d(L, xm) * (x1 - x0);
  }
  return ((1 / (4 * Math.PI * r)) * -d(W, r) * I) / (E(r) - W(r) * L(r)) ** 2;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
