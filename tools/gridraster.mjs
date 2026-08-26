/*
 * gridraster — the other half of gridcost: what does the lattice cost to
 * actually RASTERISE, in a real browser, at the field sizes the arena work
 * would take?
 *
 * WHY BOTH TOOLS EXIST. `gridcost` times the JavaScript — spring integration,
 * displacement, path construction — against a recording stub, and reports 0.018
 * ms/frame today and 0.156 at a 3x field. That is 0.9% of a 60Hz frame and it
 * looks like the arena is free. It is only half the question: a recording
 * context counts `lineTo` calls, it does not draw them, and the call count goes
 * 536 to 4741. Strokes are the expensive half of a Canvas2D frame and no stub
 * can see them.
 *
 * `docs/research-camera.md` §2a names `WarpGrid` as "the one genuine perf cliff"
 * standing between this game and a bigger arena. That claim has never been
 * measured in either half. This is the second half.
 *
 * WHAT IT MEASURES. The real `WarpGrid`, drawn into a real `CanvasRenderingContext2D`
 * in headless Chromium at the same sizes, timed with `performance.now()` around
 * `update` + `draw` and forced to actually flush — a Canvas2D implementation is
 * free to defer work until something reads the surface, so each timed block ends
 * with a 1x1 `getImageData`, without which the number is the cost of QUEUEING
 * the work rather than doing it. That distinction is the entire reason this tool
 * is not just gridcost with a canvas.
 *
 * The grid module is imported THROUGH THE DEV SERVER rather than hand-stripped.
 * The first version of this tool stripped the TypeScript with regexes and threw
 * on `GridStyle` -- which is the right failure, but it also means any strip
 * subtle enough to survive would have been measuring a class that is not quite
 * the one the game runs. Vite already transpiles this exact file for the browser,
 * so pointing the page at http://localhost:5173/src/render/grid.ts gets the real
 * module through the real build path with no second implementation to drift.
 *
 * Requires a dev server on 5173: node node_modules/vite/bin/vite.js --port 5173
 */
import { chromium } from 'playwright';

/* Field size, and the view clipped out of it. A null view draws everything,
 * which is what the game does today. The last row is the whole point: a 3x
 * field seen through a 1x window is what a follow camera actually renders. */
const CASES = [
  ['900 x 1120  (today)', 900, 1120, null],
  ['1800 x 1800  (2x area)', 1800, 1800, null],
  ['2700 x 3360  (3x linear)', 2700, 3360, null],
  ['3x field, 1x VIEW', 2700, 3360, { x: 900, y: 1120, w: 900, h: 1120 }],
];

const FRAMES = 240;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.setContent('<canvas id="c"></canvas>', { waitUntil: 'domcontentloaded' });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.id = 'c';
  document.body.appendChild(cv);
});

const rows = [];
for (const [label, w, h, view] of CASES) {
  const r = await page.evaluate(
    async ({ w, h, view, frames }) => {
      const mod = await import('/src/render/grid.ts');
      const grid = new mod.WarpGrid(w, h);
      const cv = document.getElementById('c');
      cv.width = w;
      cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const opts = { hue: 210, alpha: 0.15, glow: 0.2 };

      for (let i = 0; i < 60; i++) { grid.update(1 / 60); grid.draw(g, opts, view ?? undefined); }
      g.getImageData(0, 0, 1, 1);

      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        if (i % 30 === 0 && grid.kick) grid.kick(w * 0.5, h * 0.5, 1);
        grid.update(1 / 60);
        grid.draw(g, opts, view ?? undefined);
      }
      // Force the queue to drain before stopping the clock. Without this the
      // number is how long it took to ASK for the work.
      g.getImageData(0, 0, 1, 1);
      const ms = (performance.now() - t0) / frames;
      return { ms, points: grid.count };
    },
    { w, h, view, frames: FRAMES },
  );
  rows.push({ label, w, h, view, ...r });
}
await browser.close();

console.log('\ngridraster — the warp lattice RASTERISED, real Chromium, real canvas\n');
console.log(`  ${FRAMES} frames per case, flushed with getImageData so the queue is actually drained\n`);
console.log(`  ${'field'.padEnd(26)} ${'points'.padStart(7)} ${'ms/frame'.padStart(9)} ${'vs 1x'.padStart(7)} ${'of 60Hz'.padStart(8)}`);
console.log(`  ${'-'.repeat(26)} ${'-'.repeat(7)} ${'-'.repeat(9)} ${'-'.repeat(7)} ${'-'.repeat(8)}`);

let fails = 0;
const base = rows[0].ms;
for (const r of rows) {
  // The point count must match the geometry, or the TS strip silently changed
  // the class and every number above is about something else.
  const expect = (Math.floor(r.w / 62) + 1) * (Math.floor(r.h / 62) + 1);
  if (r.points !== expect) {
    console.log(`  FAIL  ${r.label}: ${r.points} points, expected ${expect} from cols x rows`);
    fails++;
  }
  console.log(
    `  ${r.label.padEnd(26)} ${String(r.points).padStart(7)} ${r.ms.toFixed(3).padStart(9)} ` +
      `${(r.ms / base).toFixed(1).padStart(6)}x ${((r.ms / (1000 / 60)) * 100).toFixed(1).padStart(7)}%`,
  );
}

if (rows.length === 0) {
  console.log('\n  FAIL  nothing was measured\n');
  process.exit(1);
}
if (fails > 0) {
  console.log('\n  FAIL  the evaluated grid does not match the source geometry\n');
  process.exit(1);
}

const full3x = rows.find((r) => r.label.startsWith('2700') && !r.view);
const clipped = rows.find((r) => r.view);
console.log('');
if (full3x) {
  console.log(`  Whole lattice at a 3x field: ${full3x.ms.toFixed(2)} ms/frame, ` +
    `${((full3x.ms / (1000 / 60)) * 100).toFixed(0)}% of a 60Hz budget.`);
}
if (full3x && clipped) {
  console.log(`  Same field clipped to a 1x view: ${clipped.ms.toFixed(2)} ms/frame, ` +
    `${((clipped.ms / (1000 / 60)) * 100).toFixed(1)}% — ${(full3x.ms / clipped.ms).toFixed(0)}x cheaper.`);
  console.log('  The field size stops being a rendering question once the lattice is clipped.');
}
console.log('');
