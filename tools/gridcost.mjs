/*
 * gridcost — what does the warp lattice cost per frame, and how does that scale
 * if the arena grows?
 *
 * WHY THIS EXISTS. `docs/research-camera.md` §2a identifies `WarpGrid` as the
 * performance cliff standing between this game and a bigger arena: it
 * materialises and integrates the WHOLE FIELD every frame with no culling, and
 * its size comes from the world rather than from the view. At 900x1120 and
 * SPACING 62 that is 15 x 19 = 285 points. At a 3x field it is 44 x 55 = 2420,
 * about 88% of them off screen.
 *
 * That 8.5x is arithmetic and nobody has ever costed it in milliseconds, so the
 * whole arena workstream has been resting on an argument. This measures it.
 *
 * WHAT IT MEASURES. The real `WarpGrid`, integrated and drawn into a real 2D
 * context, at the sizes the field would actually take. Not a model of it: the
 * class is imported and `update` and `draw` are the ones the game calls, so a
 * change to either shows up here.
 *
 * The context is node-canvas-free by design — it is a RECORDING stub that
 * counts operations rather than rasterising, the same approach
 * `tools/effectsdraw.mjs` uses. That means the number is the cost of the
 * JavaScript: the spring integration, the displacement maths and the path
 * construction. It does NOT include GPU rasterisation, and the header says so
 * because a reader will otherwise take it for a frame budget. It is the half
 * that scales with point count, which is the half the arena question turns on.
 */
import { performance } from 'node:perf_hooks';

const R = new URL('../src/', import.meta.url).href;
const { WarpGrid } = await import(`${R}render/grid.ts`);

/** A recording 2D context: counts calls, allocates nothing, rasterises nothing. */
function stubContext() {
  const ops = { beginPath: 0, moveTo: 0, lineTo: 0, stroke: 0, other: 0 };
  const noop = (k) => () => { ops[k] !== undefined ? ops[k]++ : ops.other++; };
  return {
    ops,
    beginPath: noop('beginPath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    stroke: noop('stroke'),
    save: noop('other'), restore: noop('other'), closePath: noop('other'),
    setLineDash: noop('other'), arc: noop('other'), fill: noop('other'),
    set strokeStyle(_v) {}, get strokeStyle() { return '#000'; },
    set lineWidth(_v) {}, get lineWidth() { return 1; },
    set globalAlpha(_v) {}, get globalAlpha() { return 1; },
    set shadowBlur(_v) {}, get shadowBlur() { return 0; },
    set shadowColor(_v) {}, get shadowColor() { return '#000'; },
    set globalCompositeOperation(_v) {}, get globalCompositeOperation() { return 'source-over'; },
    set lineCap(_v) {}, get lineCap() { return 'butt'; },
    set lineJoin(_v) {}, get lineJoin() { return 'miter'; },
  };
}

const FRAMES = 600;
const DT = 1 / 60;

/* The field at 1x, and the multiples the arena work would plausibly take. The
 * 3x row is the one research-camera.md's Stage 5 proposes. */
const CASES = [
  ['900 x 1120  (today)', 900, 1120],
  ['1400 x 1400', 1400, 1400],
  ['1800 x 1800  (2x area)', 1800, 1800],
  ['2700 x 3360  (3x linear)', 2700, 3360],
  ['3000 x 3000', 3000, 3000],
];

console.log('\ngridcost — the warp lattice, integrated and drawn, per frame\n');
console.log(`  ${FRAMES} frames per case, real WarpGrid, recording context (JS cost only, no rasterisation)\n`);
console.log(`  ${'field'.padEnd(26)} ${'points'.padStart(7)} ${'lineTo'.padStart(8)} ${'ms/frame'.padStart(9)} ${'vs 1x'.padStart(7)}`);
console.log(`  ${'-'.repeat(26)} ${'-'.repeat(7)} ${'-'.repeat(8)} ${'-'.repeat(9)} ${'-'.repeat(7)}`);

let base = 0;
let checked = 0;
const rows = [];

for (const [label, w, h] of CASES) {
  const grid = new WarpGrid(w, h);
  const g = stubContext();
  const opts = { hue: 210, alpha: 0.15, glow: 0.2 };

  // Warm the JIT so the first case is not measuring compilation.
  for (let i = 0; i < 120; i++) { grid.update(DT); grid.draw(g, opts); }

  const before = { ...g.ops };
  const t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) {
    // A kick every 30 frames, so the springs are actually displaced rather than
    // sitting at rest where the integration is trivially cheap.
    if (i % 30 === 0) grid.kick?.(w * 0.5, h * 0.5, 1);
    grid.update(DT);
    grid.draw(g, opts);
  }
  const ms = (performance.now() - t0) / FRAMES;
  const lineTo = (g.ops.lineTo - before.lineTo) / FRAMES;

  if (!base) base = ms;
  checked++;
  rows.push({ label, points: grid.count, lineTo, ms });
  console.log(
    `  ${label.padEnd(26)} ${String(grid.count).padStart(7)} ${lineTo.toFixed(0).padStart(8)} ` +
      `${ms.toFixed(3).padStart(9)} ${(ms / base).toFixed(1).padStart(6)}x`,
  );
}

/* A check that examined nothing reports a pass. */
if (checked === 0) {
  console.log('\n  FAIL  no field size was measured — this check proved nothing\n');
  process.exit(1);
}

const today = rows[0];
const at3x = rows.find((r) => r.label.startsWith('2700'));
console.log('');
console.log(`  today: ${today.points} points at ${today.ms.toFixed(3)} ms/frame of JavaScript`);
if (at3x) {
  const share = (at3x.ms / (1000 / 60)) * 100;
  console.log(`  at 3x: ${at3x.points} points at ${at3x.ms.toFixed(3)} ms/frame — ${share.toFixed(1)}% of a 60Hz frame, before rasterising anything`);
}
console.log('');
console.log('  THE ROWS ABOVE ARE A SWEEP, NOT THE GAME. This file constructs a WarpGrid');
console.log('  at each size to measure how the cost scales, and the shipped lattice is no');
console.log('  longer one of them: `Renderer.makeGrid` allocates the whole field ACROSS');
console.log('  the track and one view plus a cell of bleed ALONG it, because the travel');
console.log('  axis is unbounded and a world-sized allocation is now an infinite array.');
console.log('  At the default view that is 49 x 19 = 931 points against the 2401 a');
console.log('  3000x3000 field used to take, and the draw is clipped to the view on top');
console.log('  of that (see tools/gridview.mjs, which gates the clip).');
console.log('');
