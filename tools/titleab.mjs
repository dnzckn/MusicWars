/**
 * Is the title screen's cost this workstream's CSS, or the frame under it?
 *
 * `framecheck` asserts the title screen matches a blank-page control measured
 * in the same session, and it started failing at 33.3ms against 16.7ms. That is
 * the exact signature of the `backdrop-filter` regression this project has hit
 * before, so it has to be attributed rather than argued about.
 *
 * Interleaved, because a single before/after on this box is noise: the repo's
 * own `hudab` measured the same HUD at 7.7fps and at nothing on consecutive
 * runs. Arm A is the page as shipped. Arm B strips everything the UI workstream
 * put on the title screen — the opening overlay, the cabinet glow, the ambient
 * page gradients, the scanline blend — leaving the same canvas, world and
 * director running underneath.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

const sample = async (n) => p.evaluate(async (n) => {
  const f = []; let last = performance.now();
  await new Promise((res) => { const tick = (t) => { f.push(t - last); last = t; if (f.length < n) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  return f.slice(20).sort((a, c) => a - c);
}, n);
const median = (a) => a[a.length >> 1];

await p.goto('about:blank');
const control = median(await sample(240));

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const VARIANTS = {
  'opening overlay': 'body #opening{display:none!important}',
  'playfield glow': '#playfield{box-shadow:0 0 0 1px #1b2136!important}',
  'page gradients': 'body{background:#05060c!important}',
  'scanline blend': 'body::before{display:none!important}',
  'live dot pulse': '.live i{animation:none!important}',
};

const sampleWith = async (css) => {
  await p.evaluate((css) => {
    document.getElementById('ab-var')?.remove();
    if (!css) return;
    const s = document.createElement('style');
    s.id = 'ab-var';
    s.textContent = css;
    document.head.appendChild(s);
  }, css);
  await p.waitForTimeout(350);
  return median(await sample(180));
};

const base = [];
const off = Object.fromEntries(Object.keys(VARIANTS).map((k) => [k, []]));
for (let i = 0; i < 3; i++) {
  base.push(await sampleWith(''));
  for (const [name, css] of Object.entries(VARIANTS)) off[name].push(await sampleWith(css));
}
await b.close();

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`control (blank page): ${control.toFixed(1)}ms`);
console.log(`as shipped          : ${avg(base).toFixed(1)}ms  [${base.map((x) => x.toFixed(1)).join(' ')}]`);
for (const name of Object.keys(VARIANTS)) {
  const m = avg(off[name]);
  console.log(`without ${name.padEnd(18)}: ${m.toFixed(1)}ms  (saves ${(avg(base) - m).toFixed(1)}ms)  [${off[name].map((x) => x.toFixed(1)).join(' ')}]`);
}
