/*
 * jank — the frame-time TAIL, which is what "laggy" actually means.
 *
 * WHY THIS EXISTS. `framecheck` reports a MEDIAN and it is a good number:
 * 16.7ms, a locked 60fps, on a real GPU. The owner nonetheless reported "the
 * graphics are lagging". Both are true, because a median cannot see a stall.
 *
 * Measured on an RTX 3080 with two enemies on the field:
 *
 *     p50 16.7ms   p90 20.8   p99 68.1   max 105.3
 *     4.5% of frames over 33ms, 2.4% over 50ms
 *
 * A 68ms frame is four dropped in a row. Nothing in tools/ could see it: every
 * frame tool in this repo reports a mean or a median, and this failure mode
 * lives entirely in the top percentile.
 *
 * THE CAUSE IS KNOWN AND IS NOT THE RENDERER. `tools/rebuildrate.mjs` reports
 * the director rebuilding its patterns 10 times per 10 seconds at wave 24, for
 * 438ms of that 10 seconds — about 44ms of SYNCHRONOUS work per rebuild, on the
 * main thread, which is two to three dropped frames every time. `rebuildrate`
 * passes, because it asserts on the RATE and the rate is fine; the stall size
 * is what hurts, and it was never asserted.
 *
 * WHAT IT ASSERTS. Not a frame rate — the tail. A run may not spend more than a
 * small share of its frames past the point a player perceives a hitch. The
 * thresholds are deliberately generous, because this is a floor against
 * regression rather than a target: the point is that a change which doubles the
 * stall count cannot land silently while `framecheck` stays green.
 *
 * IT NEEDS A REAL GPU. Default headless Chromium renders with SwiftShader, in
 * software, where every frame is 37-52ms and the tail measurement is
 * meaningless. The flags below are not optional decoration — without them this
 * tool measures a software rasterizer and reports a catastrophe that does not
 * exist on any player's machine. That mistake is the reason every fps figure in
 * this repo's history was wrong.
 */
import { chromium } from 'playwright';

const GPU_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
  '--use-gl=angle',
  '--use-angle=default',
  '--enable-gpu-rasterization',
  '--ignore-gpu-blocklist',
  '--enable-zero-copy',
];

const b = await chromium.launch({ args: GPU_ARGS });
const p = await b.newPage({ viewport: { width: 1512, height: 950 } });

const gpu = await p.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : 'unknown';
});
const software = /swiftshader|llvmpipe|software/i.test(gpu);

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');

let dir = 'ArrowRight';
for (let i = 0; i < 30; i++) {
  await p.keyboard.down(dir);
  await p.waitForTimeout(310);
  await p.keyboard.up(dir);
  dir = dir === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
}

const r = await p.evaluate(
  (ms) =>
    new Promise((res) => {
      const t = [];
      let last = performance.now();
      const end = last + ms;
      const tick = () => {
        const n = performance.now();
        t.push(n - last);
        last = n;
        if (n < end) requestAnimationFrame(tick);
        else {
          const s = [...t].sort((a, b) => a - b);
          const q = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
          res({
            n: t.length,
            p50: q(0.5),
            p90: q(0.9),
            p99: q(0.99),
            max: s[s.length - 1],
            over33: t.filter((x) => x > 33).length,
            over50: t.filter((x) => x > 50).length,
            enemies: window.__musicwars.world.enemies.length,
          });
        }
      };
      requestAnimationFrame(tick);
    }),
  14000,
);
await b.close();

console.log('\njank — the frame-time tail\n');
console.log(`  renderer: ${gpu}`);
console.log(`  ${r.n} frames sampled, ${r.enemies} enemies on the field\n`);
console.log(`  p50 ${r.p50.toFixed(1)} ms    p90 ${r.p90.toFixed(1)}    p99 ${r.p99.toFixed(1)}    max ${r.max.toFixed(1)}`);
console.log(`  over 33ms (a dropped 30fps frame): ${r.over33}  ${((100 * r.over33) / r.n).toFixed(1)}%`);
console.log(`  over 50ms (a visible hitch):       ${r.over50}  ${((100 * r.over50) / r.n).toFixed(1)}%`);

/* A check that examined nothing reports a pass. */
if (r.n < 200) {
  console.log(`\n  FAIL  only ${r.n} frames sampled — this check proved nothing\n`);
  process.exit(1);
}

if (software) {
  console.log('\n  SKIPPED — this browser is rendering in software, so the tail is meaningless here.');
  console.log('  Nothing is asserted. Run on a machine where the GPU flags above take effect.\n');
  process.exit(0);
}

const MAX_HITCH_PCT = 4.0;
const MAX_P99 = 90;
const fails = [];
const hitchPct = (100 * r.over50) / r.n;
if (hitchPct > MAX_HITCH_PCT) fails.push(`${hitchPct.toFixed(1)}% of frames are visible hitches (>50ms), want <=${MAX_HITCH_PCT}%`);
if (r.p99 > MAX_P99) fails.push(`p99 frame time is ${r.p99.toFixed(1)}ms, want <=${MAX_P99}ms`);

if (fails.length) {
  console.log('');
  for (const f of fails) console.log(`  FAIL  ${f}`);
  console.log('\n  The median is not the problem. See tools/rebuildrate.mjs.\n');
  process.exit(1);
}
console.log('\n  ok    the tail is within budget\n');
