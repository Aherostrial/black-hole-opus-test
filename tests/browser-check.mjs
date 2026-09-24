/*
 * End-to-end check in headless Chromium (SwiftShader WebGL2).
 *
 *   node tests/browser-check.mjs [screenshotDir]
 *
 * - fails on any console error or page exception (font downloads excepted: sandboxes often block them)
 * - measures the rendered shadow edge and compares it with an independent CPU ray trace
 *   (and, for a = 0, with Synge's closed-form shadow size)
 * - drives the controls, the falling clock and the photon lab, and checks what they report
 * - checks the phone layout for horizontal overflow
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = resolve(process.argv[2] || join(root, 'tests', 'screenshots'));
await mkdir(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const file = join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/index.html`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
let passed = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (ok) passed++;
  else problems.push(name);
}

async function open(query, viewport = { width: 1280, height: 760 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location()?.url || '';
    if (/fonts\.(googleapis|gstatic)\.com/.test(loc) || /Failed to load resource/.test(m.text())) return;
    problems.push(`console error [${query}]: ${m.text()}`);
    console.log('  console error:', m.text());
  });
  page.on('pageerror', (e) => {
    problems.push(`page error [${query}]: ${e.message}`);
    console.log('  page error:', e.message);
  });
  await page.goto(`${base}?${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(outDir, `${name}.png`) });

// Rendered frames can lag in software GL: advance simulated time explicitly and let frames catch up.
async function advance(page, M, ms = 2500) {
  await page.evaluate((m) => (BHApp.state.time += m), M);
  await page.waitForTimeout(ms);
}

// ---------------------------------------------------------------- 1. shadow edge
console.log('Shadow edge: GPU render vs CPU ray trace');
for (const spin of [0, 0.95]) {
  const page = await open(`present&debug=1&scale=1&sky=256&labels=0&spin=${spin}&incl=90&azim=-90&dist=34`);
  await page.waitForTimeout(1500);
  const png = await page.screenshot();
  const measured = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const W = img.width, H = img.height;
    const row = (y) => {
      const d = ctx.getImageData(0, y, W, 1).data;
      const dark = (x) => d[x * 4] + d[x * 4 + 1] + d[x * 4 + 2] < 12;
      let l = W / 2, r = W / 2;
      while (l > 0 && dark(l - 1)) l--;
      while (r < W - 1 && dark(r + 1)) r++;
      return [l - 0.5, r + 0.5];
    };
    const a = row(H / 2 - 1), b = row(H / 2);
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, W, H];
  }, png.toString('base64'));
  const expected = await page.evaluate(([W, H]) => {
    const P = BHPhysics, s = BHApp.state, f = BHApp.lastFrame, c = f.camera;
    const t = Math.tan(c.fovY / 2), aspect = W / H;
    const captured = (px) => {
      const nx = ((px + 0.5) / W) * 2 - 1;
      let d = [nx * t * aspect, 0, 1];
      const n = Math.hypot(...d);
      d = d.map((v) => v / n);
      const T = c.tetrad;
      const p = [0, 1, 2, 3].map((i) => T.E0[i] + d[0] * T.Eright[i] + d[1] * T.Eup[i] + d[2] * T.Eforward[i]);
      const st = new Float64Array([c.pos[0], c.pos[1], c.pos[2], -p[1] / p[0], -p[2] / p[0], -p[3] / p[0], 0]);
      return P.tracePhoton(st, -s.spin, { stepScale: 0.004, rFar: 150, maxTime: 3000 }).fate !== 'escaped';
    };
    const edge = (lo, hi) => {
      // lo captured, hi escaped
      for (let i = 0; i < 30; i++) {
        const m = 0.5 * (lo + hi);
        if (captured(m)) lo = m;
        else hi = m;
      }
      return 0.5 * (lo + hi) + 0.5;
    };
    return [edge(W / 2, 0) - 1, edge(W / 2, W - 1)];
  }, [measured[2], measured[3]]);
  const errL = Math.abs(measured[0] - expected[0]), errR = Math.abs(measured[1] - expected[1]);
  check(`a = ${spin}: left edge`, errL < 1.6, `render ${measured[0].toFixed(1)} px, CPU ${expected[0].toFixed(1)} px`);
  check(`a = ${spin}: right edge`, errR < 1.6, `render ${measured[1].toFixed(1)} px, CPU ${expected[1].toFixed(1)} px`);
  if (spin === 0) {
    const D = 34, H = measured[3];
    const alpha = Math.asin((Math.sqrt(27) / D) * Math.sqrt(1 - 2 / D));
    const R = (Math.tan(alpha) / Math.tan((40 * Math.PI) / 180 / 2)) * (H / 2);
    const Rm = (measured[1] - measured[0]) / 2;
    check('a = 0: shadow radius matches Synge’s formula', Math.abs(Rm - R) < 1.6, `render ${Rm.toFixed(1)} px, analytic ${R.toFixed(1)} px`);
  } else {
    const c = (measured[0] + measured[1]) / 2 - measured[2] / 2;
    check('a = 0.95: shadow is off-centre (frame dragging)', Math.abs(c) > 4, `centre shifted ${c.toFixed(1)} px`);
  }
  await shot(page, `shadow-a${spin}`);
  await page.close();
}

// ---------------------------------------------------------------- 2. the exhibit
console.log('Exhibit, desktop');
{
  const page = await open('scale=0.5&sky=512');
  await shot(page, '01-exhibit');
  check('intro explainer is shown', /shadow/.test(await page.textContent('#exBody')));
  check('specimen data table filled', (await page.$$eval('#dataTable tr', (r) => r.length)) >= 10);
  check('scene labels placed', (await page.$$eval('.scene-label', (els) => els.filter((e) => e.style.opacity === '1').length)) >= 3);

  // spin slider
  await page.$eval('#spin', (el) => {
    el.value = '0.95';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const t = await page.textContent('#exTitle');
  check('spin change explained', /with/.test(t) && /95%/.test(t), t);
  const isco = await page.evaluate(() => BHApp.derived.rIn);
  check('ISCO moves inward with spin', isco < 2, `r_isco = ${isco.toFixed(3)}`);

  // mass preset
  await page.click('.chip[data-key="m87"]');
  await page.waitForFunction(() => /M87\*/.test(document.getElementById('exBody').textContent), null, { timeout: 15000 }).catch(() => {});
  const body = await page.textContent('#exBody');
  check('mass preset explained', /M87\*/.test(body) && /exact scaled-up copy/.test(body));

  // realistic mode
  await page.click('#modeReal');
  await page.waitForTimeout(2500);
  check('realistic mode explained', /fourth power of the Doppler factor/.test(await page.textContent('#exBody')));
  await shot(page, '02-realistic');
  await page.click('#modeEdu');

  // viewing angle slider drives the camera
  await page.$eval('#incl', (el) => {
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1500);
  const incl = await page.evaluate(() => [(BHApp.camera.target.incl * 180) / Math.PI, (BHApp.camera.incl * 180) / Math.PI]);
  check('viewing-angle slider moves the camera', Math.abs(incl[0] - 20) < 0.5 && incl[1] < 79, `target ${incl[0].toFixed(1)}°, now ${incl[1].toFixed(1)}°`);
  await page.close();
}

console.log('Falling clock');
{
  const page = await open('scale=0.5&sky=512');
  await page.click('#probeBtn');
  await advance(page, 12);
  await shot(page, '03-clock-falling');
  const early = await page.evaluate(() => [document.getElementById('clockMine').textContent, document.getElementById('clockTheirs').textContent]);
  await advance(page, 400);
  await shot(page, '04-clock-frozen');
  const late = await page.evaluate(() => [document.getElementById('clockMine').textContent, document.getElementById('clockTheirs').textContent, document.getElementById('probeStatus').textContent]);
  const num = (s) => parseFloat(s);
  check('your clock runs on', num(late[0]) > num(early[0]), `${early[0]} → ${late[0]}`);
  check('the falling clock lags and freezes', num(late[1]) < num(late[0]) * 0.2, `yours ${late[0]}, theirs ${late[1]}`);
  check('status reports the freeze', /Frozen at the edge/.test(late[2]));
  await page.close();
}

console.log('Photon lab');
{
  const page = await open('scale=0.5&sky=512');
  await page.click('#labBtn');
  await page.waitForTimeout(1500);
  await page.click('#labBeam');
  await advance(page, 40);
  await shot(page, '05-lab-beam');
  const fates = await page.evaluate(() => BHApp.lab.photons.map((p) => p.res.fate));
  check('beam: 13 photons traced', fates.length === 13);
  check('beam: some captured, some escaped', fates.includes('captured') && fates.includes('escaped'), fates.join(','));
  await page.click('#labClear');
  await page.click('#labGraze');
  await advance(page, 90);
  await shot(page, '06-lab-photon-sphere');
  const readout = await page.textContent('#labReadout');
  const laps = [...readout.matchAll(/→ (\d+(?:\.\d+)?)/g)].map((m) => +m[1]);
  check('photon sphere: laps grow as the start nears the orbit', laps.length === 4 && laps.every((v, i) => i === 0 || v > laps[i - 1]), laps.join(' < '));
  await page.click('#labShell');
  await page.waitForTimeout(2000);
  await shot(page, '07-photon-shell');
  // aim & fire by dragging on the plane
  await page.click('#labClear');
  await page.mouse.move(360, 250);
  await page.mouse.down();
  await page.mouse.move(470, 300, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  check('drag on the plane fires a photon', (await page.evaluate(() => BHApp.lab.photons.length)) === 1);
  await page.close();
}

console.log('Phone layout');
{
  const page = await open('scale=0.5&sky=256', { width: 390, height: 844 });
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check('no horizontal overflow at 390 px', sw <= iw, `${sw} ≤ ${iw}`);
  await shot(page, '08-phone');
  await page.click('#consoleToggle');
  await page.waitForTimeout(800);
  check('controls sheet opens', await page.isVisible('#spin'));
  await shot(page, '09-phone-controls');
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed, ${problems.length} problems`);
if (problems.length) {
  console.log(problems.map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
