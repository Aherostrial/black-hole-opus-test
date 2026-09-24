/*
 * The exhibit's voice: plain-English explanations of what each change does physically.
 * Every function returns { eyebrow, title, body, facts } built from live numbers.
 */
(function (root) {
  'use strict';
  const F = root.Fmt;
  const P = root.BHPhysics;
  const DEG = Math.PI / 180;

  /** Orbital speed of disk gas at radius r, measured by a local non-rotating observer (fraction of c). */
  function orbitalSpeed(r, a) {
    const delta = r * r - 2 * r + a * a;
    return (r * r - 2 * a * Math.sqrt(r) + a * a) / (Math.sqrt(delta) * (Math.pow(r, 1.5) + a));
  }

  /** Brightness ratio (bolometric, g^4) between approaching and receding gas at radius r. */
  function beamingRatio(r, a, incl) {
    const s = Math.abs(Math.sin(incl));
    const w = P.omegaKepler(r, a) * r * s;
    return Math.pow((1 + w) / Math.max(1e-3, 1 - w), 4);
  }

  const PRESETS = {
    cyg: '<strong>Cygnus X-1</strong>, 7,200 light-years away, was the first object widely accepted as a black hole (1972). It orbits a blue supergiant star, and measurements suggest it spins close to the maximum possible rate.',
    gw: '<strong>GW150914</strong> is the black hole born when two others, of about 36 and 29 Suns, merged 1.3 billion years ago. LIGO recorded the collision on 14 September 2015, the first direct detection of gravitational waves. Three Suns’ worth of mass left as ripples in spacetime.',
    sgr: '<strong>Sagittarius A*</strong> sits at the centre of our Milky Way, 27,000 light-years away. The Event Horizon Telescope photographed its shadow in 2022. Its real disk is faint and puffy, far dimmer than the one shown here.',
    m87: '<strong>M87*</strong>, in the galaxy Messier 87 about 55 million light-years away, was the first black hole ever photographed (2019). We see it nearly face-on, at about 17°. Try a low viewing angle to match.',
  };

  function massFacts(p) {
    return [
      ['Horizon diameter', F.length(2 * p.horizonKm), F.compare(2 * p.horizonKm)],
      ['Inner-edge orbit', F.time(p.iscoPeriodSec), 'one lap of the innermost gas'],
      ['Disk temperature', F.temp(p.diskPeakK), F.band(p.diskPeakK).replace('peaking in ', '')],
      ['Tides at horizon', F.gForce(p.tidalG), 'stretch on a 2 m person'],
    ];
  }

  const Explain = {
    intro(app) {
      const p = app.derived.props;
      return {
        eyebrow: 'What you are looking at',
        title: 'A black hole, lit by <em>its own meal</em>',
        body:
          'The black region is not the hole itself but its <strong>shadow</strong>: the directions from which light could only have come out of the hole, so none arrives. Around it swirls an <strong>accretion disk</strong> of gas hotter than the surface of the Sun. The arch over the top is the <strong>far side of that disk</strong>, bent into view by gravity. The thin bright ring hugging the shadow is light that circled the hole before escaping. Drag to walk around it.',
        facts: [
          ['Mass', F.mass(app.state.massSun), 'the black hole at our galaxy’s centre'],
          ['Horizon diameter', F.length(2 * p.horizonKm), F.compare(2 * p.horizonKm)],
          ['Shadow vs horizon', `${F.sig((2 * Math.sqrt(27)) / (2 * p.rH), 2)}× wider`, 'magnified by its own gravity'],
        ],
      };
    },

    mass(app, { prev, preset }) {
      const s = app.state, p = app.derived.props;
      const ratio = s.massSun / prev;
      const verb = ratio >= 1 ? 'heavier' : 'lighter';
      const rtxt = ratio >= 1 ? F.words(ratio, 2) : F.words(1 / ratio, 2);
      const lead = preset ? PRESETS[preset] + ' ' : '';
      const change = Math.abs(Math.log10(ratio)) > 0.01 ? `You made it ${rtxt} times ${verb}. ` : '';
      return {
        eyebrow: 'Mass',
        title: `${F.mass(s.massSun)}`,
        body:
          lead +
          change +
          `The event horizon is now <strong>${F.length(2 * p.horizonKm)} across</strong>, ${F.compare(2 * p.horizonKm)}. Yet the picture looks the same, and that is the surprise: in Einstein’s gravity, mass is the only ruler, so a heavier black hole is an exact scaled-up copy. What changes is time and heat. The innermost gas now takes <strong>${F.time(p.iscoPeriodSec)}</strong> per lap and glows at about <strong>${F.temp(p.diskPeakK)}</strong>, ${F.band(p.diskPeakK)}. Bigger holes have cooler disks because the heat is spread over a far larger area. Tides get gentler too, which is why you could fall into a giant black hole without being torn apart at the horizon.`,
        facts: massFacts(p),
      };
    },

    spin(app, { prev }) {
      const s = app.state, d = app.derived, p = d.props;
      const a = s.spin;
      const prevIsco = P.isco(prev);
      const km = (r) => F.length(r * p.rg);
      const period = p.horizonSpinPeriodSec;
      const facts = [
        ['Disk inner edge', `${F.sig(d.rIn, 3)} GM/c²`, km(d.rIn)],
        ['Horizon radius', `${F.sig(d.rH, 3)} GM/c²`, km(d.rH)],
        ['Mass → light', F.pct(p.eta, 2), 'the Sun’s fusion: 0.7%'],
        ['Horizon rotates', isFinite(period) ? `every ${F.time(period)}` : 'not at all', 'frame dragging'],
      ];
      const moved = `from ${F.sig(prevIsco, 3)} to <strong>${F.sig(d.rIn, 3)} GM/c²</strong>`;
      if (Math.abs(a) < 0.03) {
        return {
          eyebrow: 'Spin',
          title: 'No spin: the <em>Schwarzschild</em> black hole',
          body: `This is the non-spinning black hole Karl Schwarzschild found in 1916, weeks after Einstein published his theory. Everything is symmetric. The horizon is a sphere of radius 2 GM/c² (${km(2)}). Gas can orbit stably down to 6 GM/c², and at 3 GM/c² light itself can circle the hole: the photon sphere. About <strong>5.7%</strong> of the mass that falls in comes out as light.`,
          facts,
        };
      }
      if (a > 0) {
        return {
          eyebrow: 'Spin',
          title: `Spinning <em>with</em> the disk, ${Math.round(a * 100)}% of the limit`,
          body: `A spinning black hole drags space around with it, like a spoon turning honey (<strong>frame dragging</strong>). Gas orbiting the same way gets help, so it can circle closer before it must plunge: the disk’s inner edge moved ${moved}, where it is hotter and faster. That lets the disk turn <strong>${F.pct(p.eta, 2)}</strong> of the infalling mass into light, against 5.7% for no spin and 0.7% for nuclear fusion. Look at the edge of the shadow on the side where the disk comes toward you: light travelling with the spin can skim closer, so that edge ${s.mode === 'real' ? '' : 'visibly '}flattens as the spin rises.`,
          facts,
        };
      }
      return {
        eyebrow: 'Spin',
        title: `Spinning <em>against</em> the disk, ${Math.round(-a * 100)}% of the limit`,
        body: `Now the hole turns the opposite way to its disk. Frame dragging works against the gas, so orbits become unstable farther out: the inner edge retreated ${moved}, out toward 9 GM/c² for a maximal backward spin. The disk is cooler and dimmer, turning only <strong>${F.pct(p.eta, 2)}</strong> of the mass into light. The flattened side of the shadow swaps to the side moving away from you. Such mismatched pairs can form when a black hole swallows gas arriving from a new direction.`,
        facts,
      };
    },

    incl(app) {
      const s = app.state, d = app.derived;
      const i = app.camera.incl;
      const deg = Math.round(i / DEG);
      const v = orbitalSpeed(d.rIn, s.spin);
      const ratio = beamingRatio(d.peakR, s.spin, i);
      const facts = [
        ['Viewing angle', `${deg}°`, deg < 90 ? 'from the spin axis' : 'from the axis, below'],
        ['Inner gas speed', `${Math.round(v * 100)}% of c`, 'at the disk’s inner edge'],
        ['Beaming contrast', `${F.sig(ratio, 2)}×`, 'approaching vs receding'],
      ];
      if (deg < 25 || deg > 155) {
        return {
          eyebrow: 'Viewing angle',
          title: `Looking ${deg < 90 ? 'down' : 'up'} the spin axis`,
          body: 'Face-on, the disk becomes a ring and the Doppler effect almost disappears, because the gas moves across your line of sight rather than toward or away from you. Lensing still shows: the thin ring just outside the shadow is the <em>other</em> face of the disk, whose light has swung around the hole to reach you. This is close to how we see M87*, whose spin axis points about 17° from us.',
          facts,
        };
      }
      if (deg < 65 || deg > 115) {
        return {
          eyebrow: 'Viewing angle',
          title: 'A tilted view',
          body: `At a slant, one side of the disk swings toward you and the other away. Gas near the inner edge moves at about <strong>${Math.round(v * 100)}% of the speed of light</strong>, so the approaching side is Doppler-boosted: its light is squeezed to higher energy and beamed forward, making it about <strong>${F.sig(ratio, 2)}× brighter</strong> than the receding side. Gravity is also starting to lift the disk’s far side up above the shadow.`,
          facts,
        };
      }
      return {
        eyebrow: 'Viewing angle',
        title: 'Edge-on: seeing <em>behind</em> the hole',
        body: `A flat disk seen edge-on should shrink to a thin line. Instead you see a halo. Light from the <strong>far side</strong> of the disk, which should be hidden behind the hole, is bent up over the top and down under the bottom to reach you. Gas on one side races toward you at up to ${Math.round(v * 100)}% of light speed and outshines the other side by about ${F.sig(ratio, 2)}×. This is the view made famous by the film <em>Interstellar</em>, whose effects team deliberately left the lopsided brightness out.`,
        facts,
      };
    },

    mdot(app) {
      const s = app.state, p = app.derived.props;
      return {
        eyebrow: 'Accretion disk',
        title: `Fed at <em>${F.pct(s.mdot, 2)}</em> of the Eddington limit`,
        body: `The disk shines because gas loses orbital energy as friction and magnetic turbulence drag it inward. Feed it faster and it glows brighter in direct proportion: it now swallows <strong>${F.sig(p.mdotSunPerYear, 2)} Suns of gas per year</strong> and shines like <strong>${F.power(p.luminosityW)}</strong>. Its temperature rises only with the fourth root of the feeding rate, to about ${F.temp(p.diskPeakK)}. At 100%, the push of the escaping light on the gas matches gravity’s pull. Feed it faster than that and the light starts blowing the gas away instead.`,
        facts: [
          ['Luminosity', F.power(p.luminosityW), `${F.sci(p.luminosityW, 2)} W`],
          ['Swallowing', `${F.sig(p.mdotSunPerYear, 2)} M☉/yr`, `${F.sci(p.mdotKgS, 2)} kg/s`],
          ['Disk temperature', F.temp(p.diskPeakK), F.band(p.diskPeakK).replace('peaking in ', '')],
        ],
      };
    },

    speed(app) {
      const s = app.state, p = app.derived.props;
      const perSec = app.BASE_SPEED * s.speed;
      if (s.speed === 0) {
        return {
          eyebrow: 'Time',
          title: 'Time <em>stopped</em>',
          body: 'The disk is frozen, but not at a single instant. The simulation follows each ray back to the moment its light left the gas, so rays that looped around the hole show the disk as it was a little earlier. Light from the far side of the disk is older than light from the near side.',
          facts: [['Light-crossing time', F.time(p.lightCrossSec), 'across the horizon']],
        };
      }
      return {
        eyebrow: 'Time',
        title: `One second here is <em>${F.time(perSec * p.tg)}</em> there`,
        body: `Gravity sets the clock. The natural unit of time for a black hole is GM/c³, which for this mass is <strong>${F.time(p.tg)}</strong>. The simulation now runs ${F.sig(perSec, 2)} of those units per second. Inner gas laps outer gas, just as Mercury laps Neptune, so the glowing clumps shear into spirals. Each ray also carries its own light-travel delay: what you see of the far side left it earlier than what you see of the near side.`,
        facts: [
          ['Time unit GM/c³', F.time(p.tg), 'for this mass'],
          ['Inner-edge lap', F.time(p.iscoPeriodSec), `${F.sig(p.iscoPeriodSec / (perSec * p.tg), 2)} s on screen`],
          ['Orbits per second', F.sig(p.iscoFreqHz, 2), p.iscoFreqHz > 20 && p.iscoFreqHz < 20000 ? 'an audible pitch!' : 'at the inner edge'],
        ],
      };
    },

    mode(app) {
      const s = app.state, d = app.derived, p = d.props;
      if (s.mode === 'edu') {
        return {
          eyebrow: 'Rendering mode',
          title: 'Educational <em>clarity</em>',
          body: 'Colours now follow temperature on a warm scale, from white-hot at the inner edge to deep red at the rim. The Doppler effect is still there but softened, so both sides of the disk stay visible. The cyan line traces the innermost stable orbit, and labels name the parts. Geometry is unchanged: every light path is still computed exactly.',
          facts: [],
        };
      }
      const ratio = beamingRatio(d.peakR, s.spin, app.camera.incl);
      return {
        eyebrow: 'Rendering mode',
        title: 'Physically <em>realistic</em>',
        body: `Now nothing is softened. Brightness scales with the fourth power of the Doppler factor, so at this angle the approaching gas outshines the receding gas by about <strong>${F.sig(ratio, 2)}×</strong>. Near the hole, gravitational redshift dims and reddens everything. Each colour is the blackbody hue of the gas’s shifted temperature, scaled so the hottest gas looks white. The real gas, at ${F.temp(p.diskPeakK)}, would look blue-white to the eye, and its peak glow would be invisible, ${F.band(p.diskPeakK)}.`,
        facts: [
          ['Beaming contrast', `${F.sig(ratio, 2)}×`, 'approaching vs receding'],
          ['True disk temp', F.temp(p.diskPeakK), F.band(p.diskPeakK).replace('peaking in ', '')],
        ],
      };
    },

    grid() {
      return {
        eyebrow: 'Lensing grid',
        title: 'The sky, <em>folded</em>',
        body: 'Lines 15° apart are now painted on the distant sky; the amber one is the sky’s equator. Near the hole the grid warps into loops. Each patch of sky appears more than once, because its light can reach you by passing either side of the hole, or even by circling it. Where the grid crowds into a ring, a whole circle of sky lines up behind the hole: an Einstein ring.',
        facts: [],
      };
    },

    shell(app) {
      const a = app.state.spin;
      const [lo, hi] = app.derived.shell;
      const p = app.derived.props;
      if (Math.abs(a) < 0.03) {
        return {
          eyebrow: 'Photon sphere',
          title: 'Where light <em>orbits</em>',
          body: `At 3 GM/c², one and a half times the horizon radius, gravity bends light into a closed circle. A photon aimed exactly sideways here would orbit forever. The cyan loops show such orbits at their true size. The orbit is unstable: nudge a photon by a hair and it spirals in or flies away. What you see as the shadow’s sharp edge is this sphere viewed through its own lens: light that grazed it on the way to you.`,
          facts: [
            ['Photon sphere', `3 GM/c²`, F.length(3 * p.rg)],
            ['Shadow edge', `5.2 GM/c²`, 'its magnified image'],
          ],
        };
      }
      return {
        eyebrow: 'Photon shell',
        title: 'Where light <em>orbits</em>',
        body: `With spin there is no single photon sphere but a <strong>photon shell</strong>, from ${F.sig(lo, 3)} to ${F.sig(hi, 3)} GM/c². Light orbiting with the spin can circle closer than light orbiting against it. The orbits in between tilt and wobble as frame dragging winds them around the hole, like yarn on a ball. All of them are unstable. The glowing edge of the shadow is this shell seen through its own lens.`,
        facts: [
          ['Inner orbit', `${F.sig(lo, 3)} GM/c²`, a > 0 ? 'with the spin' : 'with the disk'],
          ['Outer orbit', `${F.sig(hi, 3)} GM/c²`, 'against the spin'],
        ],
      };
    },

    probe(app, { r0, tauH, tauEnd, unit, endsAtSingularity }) {
      const p = app.derived.props;
      const sec = (m) => F.clock(m * p.tg, unit);
      return {
        eyebrow: 'Experiment',
        title: 'A clock falls <em>forever</em>',
        body: `You let go of a glowing clock ${F.sig(r0, 2)} GM/c² from the hole. It flashes every 6 GM/c³ of its own time. By its own reckoning it falls in <strong>${sec(tauH)}</strong>, crosses the horizon without anything special happening there, and ${endsAtSingularity ? `meets the central singularity ${sec(tauEnd - tauH)} later` : `reaches the inner horizon ${sec(tauEnd - tauH)} later, where today’s physics runs out`}. Now watch from here. Its flashes come further apart, its light reddens and fades, and it seems to stall just above the horizon forever. Both stories are true: time runs differently for the clock and for you.`,
        facts: [
          ['Fall time (its clock)', sec(tauH), 'to the horizon'],
          ['Fall time (your view)', '∞', 'it never quite arrives'],
        ],
      };
    },

    lab(app) {
      const b = P.criticalImpact(app.state.spin);
      return {
        eyebrow: 'Experiment',
        title: 'The photon <em>lab</em>',
        body: `Each line is a single photon, followed forward in time with the same equations that draw the picture. Drag on the plane to aim, then release to fire. The amber ring is the photon orbit. A photon passing the hole at an offset (its <strong>impact parameter</strong>) larger than ${F.sig(Math.min(b.withDisk, -b.againstDisk), 3)} GM/c² escapes${Math.abs(app.state.spin) > 0.03 ? `, or ${F.sig(Math.max(b.withDisk, -b.againstDisk), 3)} GM/c² if it travels against the spin` : ''}; anything smaller is captured. Aim right at that boundary and the photon whirls around before deciding.`,
        facts: [],
      };
    },

    labResult(app, r) {
      return r;
    },
  };

  root.Explain = Explain;
  root.ExplainUtil = { orbitalSpeed, beamingRatio };
})(typeof globalThis !== 'undefined' ? globalThis : this);
