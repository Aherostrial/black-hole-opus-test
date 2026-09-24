/* Control panel, explainer placard, data table, keyboard shortcuts and presenter mode. */
(function (root) {
  'use strict';
  const F = root.Fmt;
  const DEG = Math.PI / 180;
  const $ = (id) => document.getElementById(id);

  function init(app) {
    const s = app.state;
    const el = {
      mass: $('mass'), massOut: $('massOut'),
      spin: $('spin'), spinOut: $('spinOut'),
      incl: $('incl'), inclOut: $('inclOut'),
      mdot: $('mdot'), mdotOut: $('mdotOut'),
      speed: $('speed'), speedOut: $('speedOut'),
      pause: $('pauseBtn'), reset: $('resetBtn'),
      modeEdu: $('modeEdu'), modeReal: $('modeReal'),
      swLabels: $('swLabels'), swShell: $('swShell'), swGrid: $('swGrid'), swOrbit: $('swOrbit'),
      probeBtn: $('probeBtn'), labBtn: $('labBtn'),
      data: $('dataTable').querySelector('tbody'),
      explainer: $('explainer'), exEyebrow: $('exEyebrow'), exTitle: $('exTitle'), exBody: $('exBody'), exFacts: $('exFacts'),
      toast: $('toast'), perf: $('perf'),
    };

    // ------------------------------------------------------------ explainer
    let lastExplainKey = '';
    let pendingExplain = null;
    function explain(key, payload = {}, immediate = false) {
      const fn = root.Explain[key];
      if (!fn) return;
      const run = () => {
        const c = fn(app, payload);
        if (!c) return;
        const changed = key !== lastExplainKey;
        lastExplainKey = key;
        el.exEyebrow.textContent = c.eyebrow;
        el.exTitle.innerHTML = c.title;
        el.exBody.innerHTML = c.body;
        el.exFacts.innerHTML = (c.facts || [])
          .map(([k, v, sub]) => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`)
          .join('');
        el.exFacts.hidden = !(c.facts && c.facts.length);
        if (changed) {
          el.explainer.classList.remove('swap');
          void el.explainer.offsetWidth;
          el.explainer.classList.add('swap');
        }
      };
      clearTimeout(pendingExplain);
      if (immediate) run();
      else pendingExplain = setTimeout(run, 70);
    }

    let toastTimer = null;
    function toast(msg) {
      el.toast.textContent = msg;
      el.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
    }

    // ------------------------------------------------------------ sliders
    const fill = (input) => {
      const t = (input.value - input.min) / (input.max - input.min);
      input.style.setProperty('--fill', `${(t * 100).toFixed(2)}%`);
    };
    const dragStart = {};
    function bindSlider(input, key, fromSlider, onInput) {
      const remember = () => {
        dragStart[key] = s[key];
      };
      input.addEventListener('pointerdown', remember);
      input.addEventListener('focus', remember);
      input.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        remember();
      });
      input.addEventListener('input', () => {
        fill(input);
        if (dragStart[key] === undefined) remember();
        onInput(fromSlider(+input.value), dragStart[key]);
      });
      input.addEventListener('change', () => {
        dragStart[key] = undefined;
      });
    }

    bindSlider(el.mass, 'massSun', (v) => Math.pow(10, v), (m, prev) => {
      app.set('massSun', m);
      explain('mass', { prev });
    });
    bindSlider(el.spin, 'spin', (v) => v, (a, prev) => {
      app.set('spin', a);
      explain('spin', { prev });
    });
    bindSlider(el.incl, 'incl', (v) => v, (deg) => {
      app.camera.set({ incl: deg * DEG });
      explain('incl');
    });
    bindSlider(el.mdot, 'mdot', (v) => Math.pow(10, v), (m) => {
      app.set('mdot', m);
      explain('mdot');
    });
    bindSlider(el.speed, 'speed', (v) => v, (v) => {
      app.set('speed', v);
      explain('speed');
    });

    // Mass presets animate through log-mass so the scale readouts roll smoothly.
    let tween = null;
    document.querySelectorAll('.chip[data-mass]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const target = +chip.dataset.mass;
        const from = s.massSun;
        const t0 = performance.now();
        cancelAnimationFrame(tween);
        const step = (now) => {
          const k = Math.min(1, (now - t0) / 900);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          app.set('massSun', Math.pow(10, Math.log10(from) + (Math.log10(target) - Math.log10(from)) * e));
          if (k < 1) tween = requestAnimationFrame(step);
          else {
            app.set('massSun', target);
            explain('mass', { prev: from, preset: chip.dataset.key }, true);
          }
        };
        tween = requestAnimationFrame(step);
      });
    });

    // ------------------------------------------------------------ buttons
    el.pause.addEventListener('click', () => togglePause());
    function togglePause() {
      app.set('paused', !s.paused);
    }
    el.reset.addEventListener('click', () => {
      app.camera.set({ incl: 80 * DEG, azim: -90 * DEG, dist: 34 });
      toast('View reset');
    });

    function setMode(mode) {
      if (s.mode === mode) return;
      app.set('mode', mode);
      app.set('labels', mode === 'edu');
      explain('mode', {}, true);
    }
    el.modeEdu.addEventListener('click', () => setMode('edu'));
    el.modeReal.addEventListener('click', () => setMode('real'));
    document.querySelector('.mode-switch').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setMode(s.mode === 'edu' ? 'real' : 'edu');
        (s.mode === 'edu' ? el.modeEdu : el.modeReal).focus();
      }
    });

    const switches = [
      [el.swLabels, 'labels', null],
      [el.swShell, 'shell', 'shell'],
      [el.swGrid, 'grid', 'grid'],
      [el.swOrbit, 'autoOrbit', null],
    ];
    for (const [btn, key, story] of switches) {
      btn.addEventListener('click', () => {
        app.set(key, !s[key]);
        if (s[key] && story) explain(story, {}, true);
        if (key === 'autoOrbit') toast(s.autoOrbit ? 'Slow orbit on: the camera circles the hole' : 'Slow orbit off');
        if (key === 'labels') toast(s.labels ? 'Labels on' : 'Labels off');
      });
    }

    el.probeBtn.addEventListener('click', () => app.probe && app.probe.toggle());
    el.labBtn.addEventListener('click', () => app.lab && app.lab.toggle());

    // ------------------------------------------------------------ sync UI from state
    function syncControls() {
      el.mass.value = Math.log10(s.massSun).toFixed(2);
      el.massOut.textContent = F.massShort(s.massSun);
      el.spin.value = s.spin;
      el.spinOut.textContent = `${s.spin >= 0 ? '+' : '−'}${Math.abs(s.spin).toFixed(3)}`;
      el.mdot.value = Math.log10(s.mdot).toFixed(2);
      el.mdotOut.textContent = `${F.sig(s.mdot * 100, 2)}% Eddington`;
      el.speed.value = s.speed;
      el.speedOut.textContent = s.paused || s.speed === 0 ? 'paused' : `${s.speed.toFixed(2)}×`;
      el.pause.textContent = s.paused ? 'Play' : 'Pause';
      el.pause.setAttribute('aria-pressed', String(s.paused));
      el.modeEdu.setAttribute('aria-checked', String(s.mode === 'edu'));
      el.modeReal.setAttribute('aria-checked', String(s.mode === 'real'));
      for (const [btn, key] of switches) btn.setAttribute('aria-checked', String(!!s[key]));
      document.querySelectorAll('.chip[data-mass]').forEach((c) => c.setAttribute('aria-pressed', String(Math.abs(Math.log10(+c.dataset.mass / s.massSun)) < 0.004)));
      [el.mass, el.spin, el.mdot, el.speed].forEach(fill);
    }
    function syncIncl() {
      const deg = app.camera.target.incl / DEG;
      if (document.activeElement !== el.incl) el.incl.value = deg.toFixed(1);
      el.inclOut.textContent = `${Math.round(app.camera.incl / DEG)}°`;
      fill(el.incl);
    }

    function syncData() {
      const p = app.derived.props, d = app.derived;
      const rows = [
        ['Mass', F.massShort(s.massSun)],
        ['Horizon radius', F.length(p.horizonKm)],
        ['Shadow diameter', F.length(p.shadowDiameterKm)],
        ['Disk inner edge', `${F.sig(d.rIn, 3)} GM/c² · ${F.length(p.iscoKm)}`],
        ['Inner-edge lap', F.time(p.iscoPeriodSec)],
        ['Horizon rotation', isFinite(p.horizonSpinPeriodSec) ? `every ${F.time(p.horizonSpinPeriodSec)}` : 'none'],
        ['Disk temperature', F.temp(p.diskPeakK)],
        ['Luminosity', F.power(p.luminosityW)],
        ['Mass → light', F.pct(p.eta, 2)],
        ['Hawking temperature', F.temp(p.hawkingK)],
        ['Tides at horizon', F.gForce(p.tidalG)],
      ];
      el.data.innerHTML = rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
    }

    app.on('change', (key) => {
      syncControls();
      if (key === 'massSun' || key === 'spin' || key === 'mdot') syncData();
    });

    // Camera drags update the viewing-angle slider; a new regime earns a new explanation.
    const regime = (i) => (i < 25 * DEG || i > 155 * DEG ? 0 : i < 65 * DEG || i > 115 * DEG ? 1 : 2);
    let lastRegime = regime(app.camera.incl);
    app.camera.onChange(() => syncIncl());
    let settleTimer = null;
    app.camera.onChange((cam) => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        const r = regime(cam.incl);
        if (r !== lastRegime) {
          lastRegime = r;
          if (!(app.lab && app.lab.active) && !(app.probe && app.probe.active)) explain('incl');
        }
      }, 350);
    });

    // ------------------------------------------------------------ chrome
    const present = $('presentBtn');
    function togglePresent() {
      document.body.classList.toggle('presenting');
      toast(document.body.classList.contains('presenting') ? 'Presenter mode: press H to bring the controls back' : 'Controls restored');
    }
    present.addEventListener('click', togglePresent);
    function toggleFullscreen() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available here'));
      else document.exitFullscreen?.();
    }
    $('fsBtn').addEventListener('click', toggleFullscreen);
    const help = $('help');
    const openHelp = () => {
      help.hidden = false;
      $('helpClose').focus();
    };
    $('helpBtn').addEventListener('click', openHelp);
    $('helpClose').addEventListener('click', () => (help.hidden = true));
    help.addEventListener('click', (e) => {
      if (e.target === help) help.hidden = true;
    });

    const consoleEl = $('console');
    const consoleToggle = $('consoleToggle');
    const narrow = window.matchMedia('(max-width: 760px)');
    function setConsole(open) {
      consoleEl.classList.toggle('collapsed', !open);
      document.body.classList.toggle('console-open', open && narrow.matches);
      consoleToggle.textContent = open ? 'Hide' : 'Controls';
      consoleToggle.setAttribute('aria-expanded', String(open));
    }
    consoleToggle.addEventListener('click', () => setConsole(consoleEl.classList.contains('collapsed')));
    if (narrow.matches) setConsole(false);
    narrow.addEventListener('change', (e) => setConsole(!e.matches));

    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, textarea') && e.target.type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (!help.hidden) help.hidden = true;
        else if (document.body.classList.contains('presenting')) togglePresent();
        else if (app.lab && app.lab.active) app.lab.toggle(false);
        return;
      }
      if (e.target.type === 'range' && k.startsWith('arrow')) return;
      if (k === ' ') {
        e.preventDefault();
        togglePause();
      } else if (k === 'h') togglePresent();
      else if (k === 'f') toggleFullscreen();
      else if (k === 'm') setMode(s.mode === 'edu' ? 'real' : 'edu');
      else if (k === 'c') app.probe && app.probe.toggle();
      else if (k === 'p') app.lab && app.lab.toggle();
      else if (k === '?') openHelp();
    });
    $('view').addEventListener('contextmenu', (e) => e.preventDefault());

    // Perf readout (small, bottom corner)
    let frames = 0, acc = 0;
    app.on('frame', (f, dt) => {
      frames++;
      acc += dt;
      if (acc > 0.5) {
        const fps = frames / acc;
        const c = app.renderer.canvas;
        el.perf.textContent = `ray-traced ${Math.round(c.width * s.renderScale)}×${Math.round(c.height * s.renderScale)} · ${Math.round(fps)} fps`;
        frames = 0;
        acc = 0;
      }
    });

    /** Where the image centre should sit (NDC): the middle of the screen area not covered by panels. */
    function viewShiftTarget() {
      if (document.body.classList.contains('presenting')) return [0, 0];
      const W = window.innerWidth, H = window.innerHeight;
      let left = 0, right = W, top = 0, bottom = H;
      const c = consoleEl.getBoundingClientRect();
      if (narrow.matches) {
        bottom = Math.min(bottom, c.top);
        const ex = el.explainer.getBoundingClientRect();
        if (!el.explainer.hidden && ex.height && getComputedStyle(el.explainer).display !== 'none') top = Math.max(top, ex.bottom);
        if (bottom - top < H * 0.3) top = Math.max(0, bottom - H * 0.3);
      } else {
        right = Math.min(right, c.left);
      }
      return [(left + right) / W - 1, 1 - (top + bottom) / H];
    }

    syncControls();
    syncIncl();
    syncData();
    explain('intro', {}, true);

    return { explain, toast, syncControls, viewShiftTarget };
  }

  root.ExhibitUI = { init };
})(typeof globalThis !== 'undefined' ? globalThis : this);
