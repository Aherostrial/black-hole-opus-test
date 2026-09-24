/* Human-readable numbers, units and size comparisons for the exhibit text. */
(function (root) {
  'use strict';
  const nf = (d) => new Intl.NumberFormat('en-US', { maximumSignificantDigits: d });
  const cache = {};
  function sig(x, d = 2) {
    if (!isFinite(x)) return '∞';
    const f = cache[d] || (cache[d] = nf(d));
    return f.format(x);
  }
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  function sci(x, d = 2) {
    if (x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x)));
    const m = x / Math.pow(10, e);
    return `${sig(m, d)} × 10${String(e).split('').map((c) => SUP[c]).join('')}`;
  }
  function words(x, d = 2) {
    const ax = Math.abs(x);
    if (ax >= 1e12) return `${sig(x / 1e12, d)} trillion`;
    if (ax >= 1e9) return `${sig(x / 1e9, d)} billion`;
    if (ax >= 1e6) return `${sig(x / 1e6, d)} million`;
    return sig(x, Math.max(d, 3));
  }

  function mass(m) {
    return m < 1e6 ? `${sig(m, 3)} Suns` : `${words(m, 2)} Suns`;
  }
  function massShort(m) {
    return m < 1e6 ? `${sig(m, 3)} M☉` : `${words(m, 2)} M☉`;
  }

  const AU = 1.495978707e8;
  function length(km) {
    if (km < 1) return `${sig(km * 1000, 2)} m`;
    if (km < 1e6) return `${sig(km, 3)} km`;
    if (km < 0.1 * AU) return `${sig(km / 1e6, 2)} million km`;
    return `${sig(km / AU, 2)} AU`;
  }

  function time(s) {
    const a = Math.abs(s);
    if (a < 1e-3) return `${sig(s * 1e6, 3)} µs`;
    if (a < 1) return `${sig(s * 1e3, 3)} ms`;
    if (a < 120) return `${sig(s, 3)} s`;
    if (a < 7200) return `${sig(s / 60, 3)} min`;
    if (a < 2 * 86400) return `${sig(s / 3600, 3)} h`;
    if (a < 2 * 3.156e7) return `${sig(s / 86400, 3)} days`;
    return `${words(s / 3.156e7, 3)} years`;
  }

  /** Clock-face style: same unit for both clocks, fixed decimals so digits tick smoothly. */
  function clockUnit(sampleSeconds) {
    const a = Math.abs(sampleSeconds);
    if (a < 1e-3) return { unit: 'µs', k: 1e6 };
    if (a < 1) return { unit: 'ms', k: 1e3 };
    if (a < 120) return { unit: 's', k: 1 };
    if (a < 7200) return { unit: 'min', k: 1 / 60 };
    if (a < 2 * 86400) return { unit: 'h', k: 1 / 3600 };
    if (a < 2 * 3.156e7) return { unit: 'days', k: 1 / 86400 };
    return { unit: 'years', k: 1 / 3.156e7 };
  }
  function clock(seconds, u) {
    const v = seconds * u.k;
    return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u.unit}`;
  }

  function temp(K) {
    if (K < 1e-3) return `${sci(K, 2)} K`;
    if (K < 1e6) return `${sig(K, 2)} K`;
    return `${sig(K / 1e6, 2)} million K`;
  }

  function band(K) {
    const lambdaNm = 2.898e6 / K; // Wien peak in nm
    if (lambdaNm < 0.1) return 'peaking in hard X-rays';
    if (lambdaNm < 10) return 'peaking in X-rays';
    if (lambdaNm < 121) return 'peaking in extreme ultraviolet';
    if (lambdaNm < 380) return 'peaking in ultraviolet';
    if (lambdaNm < 750) return 'peaking in visible light';
    return 'peaking in infrared';
  }

  const REFS = [
    ['Paris', 15],
    ['Greater London', 50],
    ['the island of Hawaiʻi', 150],
    ['Great Britain', 1000],
    ['the Moon', 3474],
    ['Earth', 12742],
    ['Jupiter', 139820],
    ['the Sun', 1.3927e6],
    ["Mercury's orbit", 1.159e8],
    ["Earth's orbit", 2.992e8],
    ["Jupiter's orbit", 1.557e9],
    ["Neptune's orbit", 9.0e9],
  ];
  /** Compare a diameter in km with something familiar. */
  function compare(km) {
    let best = null;
    for (const r of REFS) if (r[1] <= km * 1.25) best = r;
    if (!best) return 'about the size of a small town';
    const ratio = km / best[1];
    if (ratio < 1.3) return `about as wide as ${best[0]}`;
    return `${sig(ratio, ratio < 10 ? 2 : 2)} times as wide as ${best[0]}`;
  }

  function power(W) {
    const Lsun = W / 3.828e26;
    return Lsun < 1e6 ? `${sig(Lsun, 2)} Suns` : `${words(Lsun, 2)} Suns`;
  }

  function pct(x, d = 2) {
    return `${sig(x * 100, d)}%`;
  }

  function gForce(g) {
    if (g >= 1e6) return `${words(g, 2)} g`;
    if (g >= 1) return `${sig(g, 2)} g`;
    if (g >= 1e-3) return `${sig(g, 2)} g`;
    return `${sci(g, 2)} g`;
  }

  root.Fmt = { sig, sci, words, mass, massShort, length, time, clockUnit, clock, temp, band, compare, power, pct, gForce };
})(typeof globalThis !== 'undefined' ? globalThis : this);
