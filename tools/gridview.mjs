/*
 * gridview — is the amount of grid we DRAW a function of the VIEW, or of the
 * FIELD?
 *
 *     node --experimental-transform-types tools/gridview.mjs
 *
 * WHY THIS EXISTS. `WarpGrid` materialises the whole field as flat arrays, and
 * for the project's whole life it also DREW the whole field. That was free
 * while the field was one screen and it is the thing that blocked the arena:
 * `tools/gridraster.mjs` measured a 3x field at 5.0 ms/frame in real Chromium,
 * 30% of a 60Hz budget, scaling 48x where the point count scales 8.5x. The
 * cliff was painted AREA, so the fix is to stop painting the part nobody can
 * see — `WarpGrid.draw` takes a view rectangle and bounds its loops to whole
 * rows and columns, and `Renderer` passes one.
 *
 * WHAT COULD GO WRONG SILENTLY, and therefore what this checks. Both halves
 * of that sentence can rot independently:
 *
 *   - `grid.ts` could stop honouring the rectangle. Nothing else would notice:
 *     the game looks identical either way today, because the view IS the
 *     field, and `gridcost`/`gridraster` both call `draw` with no view at all.
 *   - `renderer.ts` could stop PASSING one. The argument is optional, so
 *     dropping it is a silent revert to painting the whole arena, and every
 *     other gate stays green. That is why the second half of this file drives
 *     the real `Renderer` rather than testing `WarpGrid` alone: measure the
 *     output, not the source text.
 *
 * WHAT "DRAWN POINT COUNT" MEANS HERE. Every `moveTo` and `lineTo` the lattice
 * issues, counted against a recording 2D context — the same stub approach as
 * `gridcost` and `effectsdraw`. It is the path the GPU would have to stroke,
 * which is the quantity that actually cost 5 ms.
 *
 * ONE HONEST WRINKLE. The clip keeps a cell of bleed on each side so a line
 * entering the view still has its off-screen endpoint. On a field that is
 * exactly one view big there is no bleed to keep — the array simply ends — so
 * the 1x field draws slightly FEWER points than a larger one, and 1x is
 * reported below but excluded from the equality set. Everything from two view
 * widths up must agree exactly.
 *
 * Node-only: no browser, no dev server, no canvas.
 */
import './lib/ts.mjs';

/*
 * The NAMESPACE, not a destructure.
 *
 * `VIEW_W` and `VIEW_H` stopped being constants when the view became a
 * function of the window: they are `export let` in `field.ts` and `setView`
 * reassigns them. Destructuring here would snapshot 900x1120 at import time
 * and this whole file would go on measuring a rectangle nothing uses — which
 * is exactly the failure mode it exists to catch, so it would have caught
 * itself last.
 */
const field = await import('../src/game/field.ts');
const { VIEW_W, VIEW_H } = field;

let Renderer;
let WarpGrid;
try {
  ({ WarpGrid } = await import('../src/render/grid.ts'));
  ({ Renderer } = await import('../src/render/renderer.ts'));
} catch (err) {
  if (String(err).includes('UNSUPPORTED_TYPESCRIPT_SYNTAX')) {
    console.error('\ngridview: run with  node --experimental-transform-types tools/gridview.mjs\n');
    process.exit(2);
  }
  throw err;
}

let failures = 0;
let checked = 0;
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const pass = (m) => console.log(`  ok    ${m}`);

/** A recording 2D context that counts path vertices and rasterises nothing. */
function stub() {
  const ops = { moveTo: 0, lineTo: 0, stroke: 0, fillRect: 0, other: 0 };
  const bump = (k) => () => {
    ops[k] !== undefined ? ops[k]++ : ops.other++;
  };
  const grad = () => ({ addColorStop() {} });
  const g = {
    ops,
    moveTo: bump('moveTo'),
    lineTo: bump('lineTo'),
    stroke: bump('stroke'),
    fillRect: bump('fillRect'),
    beginPath() {}, closePath() {}, save() {}, restore() {}, clip() {}, fill() {},
    strokeRect() {}, clearRect() {}, rect() {},
    quadraticCurveTo: bump('other'), bezierCurveTo: bump('other'), arcTo: bump('other'),
    arc: bump('other'), ellipse: bump('other'),
    transform() {}, resetTransform() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    setLineDash() {}, createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData() {}, roundRect() {},
    createLinearGradient: grad, createRadialGradient: grad,
    drawImage() {},
    measureText: (t) => ({ width: String(t).length * 7 }),
    fillText() {}, strokeText() {},
    getContext: () => g,
  };
  for (const p of ['fillStyle', 'strokeStyle', 'globalAlpha', 'lineWidth', 'font', 'textAlign',
    'textBaseline', 'lineCap', 'lineJoin', 'globalCompositeOperation', 'filter', 'shadowBlur', 'shadowColor']) {
    g[p] = '';
  }
  return g;
}

const STYLE = { hue: 210, alpha: 0.15, glow: 0.2 };
const DT = 1 / 60;

/** Vertices the lattice issues for one frame of a `w x h` field under `view`. */
function drawnPoints(w, h, view, { deform = true } = {}) {
  const grid = new WarpGrid(w, h);
  const g = stub();
  /*
   * Deform the sheet so the stress pass — the bright second path, the one a
   * bomb lights up — is actually producing segments. Measured at rest it
   * contributes nothing and half the draw would go unmeasured.
   *
   * The shocks are placed inside the VIEW rectangle whether or not a view was
   * passed, so the clipped and unclipped runs are deforming the same points
   * and the two numbers are comparable.
   */
  if (deform) {
    const at = view ?? VIEW;
    grid.impulse(at.x + at.w * 0.5, at.y + at.h * 0.5, 260, 900);
    grid.impulse(at.x + at.w * 0.2, at.y + at.h * 0.7, 200, -900);
    grid.update(DT);
  }
  const before = g.ops.moveTo + g.ops.lineTo;
  grid.draw(g, STYLE, view);
  return { drawn: g.ops.moveTo + g.ops.lineTo - before, allocated: grid.count };
}

const VIEW = { x: 0, y: 0, w: VIEW_W, h: VIEW_H };

console.log('\ngridview — the drawn lattice must be a function of the VIEW, not the FIELD\n');
console.log(`  view ${VIEW_W} x ${VIEW_H}\n`);

/* ------------------------------------------------------------------ part A */

console.log('A. THE LATTICE ITSELF — grow the field, hold the view');
const FIELDS = [
  ['900 x 1120   (1x, view == field)', 900, 1120, false],
  ['1800 x 1800  (2x area)', 1800, 1800, true],
  ['2700 x 3360  (3x linear)', 2700, 3360, true],
  ['5400 x 6720  (6x linear)', 5400, 6720, true],
];

/*
 * `unclipped` is the same frame with the view argument omitted — what the game
 * drew before this stage. It is the denominator that makes the clipped number
 * mean anything: "764 vertices" is only good news next to what it replaced.
 */
console.log(
  `    ${'field'.padEnd(34)} ${'points'.padStart(7)} ${'unclipped'.padStart(9)} ${'clipped'.padStart(8)} ${'saved'.padStart(6)}`,
);
const rowsA = [];
for (const [label, w, h, inSet] of FIELDS) {
  const { drawn, allocated } = drawnPoints(w, h, VIEW);
  const all = drawnPoints(w, h, undefined).drawn;
  rowsA.push({ label, drawn, allocated, unclipped: all, inSet });
  console.log(
    `    ${label.padEnd(34)} ${String(allocated).padStart(7)} ${String(all).padStart(9)} ${String(drawn).padStart(8)} ` +
      `${(all > 0 ? (1 - drawn / all) * 100 : 0).toFixed(1).padStart(5)}%`,
  );
}

{
  const set = rowsA.filter((r) => r.inSet);
  const first = set[0];
  let same = 0;
  for (const r of set) {
    checked++;
    if (r.drawn === first.drawn) same++;
    else fail(`${r.label}: drew ${r.drawn} vertices where ${first.label} drew ${first.drawn} — the draw scales with the FIELD`);
  }
  if (same === set.length) {
    pass(`${set.length} fields from 2x to 6x all drew exactly ${first.drawn} vertices — the draw is a function of the view`);
  }
  // And the clip has to be discarding most of the sheet, or "constant" could
  // simply mean the lattice never got big.
  const biggest = rowsA[rowsA.length - 1];
  checked++;
  const share = biggest.drawn / biggest.unclipped;
  if (share >= 0.2) {
    fail(`at 6x the clip still strokes ${(share * 100).toFixed(1)}% of the unclipped path — it is not culling`);
  } else {
    pass(
      `at 6x the clip strokes ${biggest.drawn} vertices where the unclipped draw strokes ${biggest.unclipped}` +
        ` (${(share * 100).toFixed(1)}%, over ${biggest.allocated} allocated points)`,
    );
  }
}

console.log('\nB. THE SAME LATTICE — hold the field, shrink the view');
{
  // The negative control for part A. A `draw()` that clipped to a hardcoded
  // window, or that simply drew nothing, would satisfy every assertion above.
  const VIEWS = [
    ['full view', { x: 0, y: 0, w: VIEW_W, h: VIEW_H }],
    ['half view', { x: 0, y: 0, w: VIEW_W / 2, h: VIEW_H / 2 }],
    ['quarter view', { x: 0, y: 0, w: VIEW_W / 4, h: VIEW_H / 4 }],
  ];
  let prev = Infinity;
  let monotone = true;
  for (const [label, v] of VIEWS) {
    const { drawn } = drawnPoints(2700, 3360, v);
    console.log(`    ${label.padEnd(34)} ${String(drawn).padStart(7)} vertices`);
    checked++;
    if (!(drawn < prev)) {
      monotone = false;
      fail(`${label}: drew ${drawn}, not fewer than the larger view's ${prev} — the view rectangle is being ignored`);
    }
    prev = drawn;
  }
  if (monotone) pass('a smaller view draws strictly fewer vertices at every step');
}

/* ------------------------------------------------------------------ part C */

console.log('\nC. THE RENDERER — does it actually PASS a view rectangle?');

globalThis.window ??= {};
globalThis.devicePixelRatio ??= 1;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.addEventListener ??= () => {};

const transport = { beat: 4.25, bpm: 128, advance() {}, get barPhase() { return 0.0625; } };

/**
 * A duck-typed world. `Renderer` imports `World` as a type only.
 *
 * `viewW`/`viewH` are ACCESSORS onto the live module binding, exactly as the
 * real `World` declares them. They were plain numbers, which meant this half of
 * the file tested `Renderer` against a rectangle the harness invented and could
 * not have noticed if `field.ts` and `world.ts` disagreed about what the view
 * is. Part D below moves the real binding and this is how the movement reaches
 * the renderer.
 */
function duckWorld(fieldW, fieldH, viewW, viewH) {
  return {
    width: fieldW, height: fieldH,
    get viewW() { return field.VIEW_W; },
    get viewH() { return field.VIEW_H; },
    camera: { x: 0, y: 0, viewX: 0, viewY: 0, flash: 0, flashHue: 0 },
    player: {
      x: viewW / 2, y: viewH * 0.7, prevX: viewW / 2, prevY: viewH * 0.7, dead: false,
      hp: 3, maxHp: 3, invuln: 0, focused: false, bank: 0, ringPhase: 0,
      droneAngle: [], droneCooldown: [], radius: 8,
    },
    enemies: [], shocks: [], notes: [], particles: { count: 0 }, drops: [], popups: [],
    playerBullets: { count: 0 },
    novas: [], effects: [], wells: [],
    banner: '', bannerSub: '', bannerAge: 9, bannerKind: 'wave',
    snapshot: {
      running: true, level: 3, xp: 2, xpToNext: 9, choosing: false,
      abilities: {}, instrumentSlots: 3, rigSlots: 3,
    },
    bus: { on() {} },
  };
}

/** Path vertices for one rendered frame of a field/view pair. */
function renderedPoints(fieldW, fieldH, viewW, viewH) {
  // The real setter, so `duckWorld`'s accessors, `Renderer`'s bloom bitmap and
  // its starfield all see the same rectangle the assertions below name.
  field.setView(viewW, viewH);
  const g = stub();
  g.canvas = { width: viewW, height: viewH, clientHeight: viewH, clientWidth: viewW, getContext: () => g };
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => g }),
    getElementById: () => null,
  };
  const world = duckWorld(fieldW, fieldH, viewW, viewH);
  const r = new Renderer(g.canvas, g.canvas, world);
  r.bloomEnabled = false;
  r.bloomAuto = false;
  // One frame to settle, then measure the next — the sprite atlases build
  // lazily on first use and are hundreds of ops that belong to neither field.
  r.render(1, DT, transport, 0.4, 60);
  const before = g.ops.moveTo + g.ops.lineTo;
  r.render(1, DT, transport, 0.4, 60);
  return g.ops.moveTo + g.ops.lineTo - before;
}

// Warm the module-level sprite atlases before the first measured construction.
renderedPoints(VIEW_W, VIEW_H, VIEW_W, VIEW_H);

{
  const CASES = [
    ['1800 x 1800  (2x area)', 1800, 1800],
    ['2700 x 3360  (3x linear)', 2700, 3360],
    ['5400 x 6720  (6x linear)', 5400, 6720],
  ];
  console.log(`    view held at ${VIEW_W} x ${VIEW_H}`);
  const counts = [];
  for (const [label, fw, fh] of CASES) {
    const n = renderedPoints(fw, fh, VIEW_W, VIEW_H);
    counts.push({ label, n });
    console.log(`    ${label.padEnd(34)} ${String(n).padStart(7)} vertices per frame`);
  }
  const first = counts[0].n;
  let same = 0;
  for (const c of counts) {
    checked++;
    if (c.n === first) same++;
    else fail(`${c.label}: the renderer drew ${c.n} vertices where the 2x field drew ${first} — it is not passing a view rectangle`);
  }
  if (same === counts.length) {
    pass(`the renderer drew exactly ${first} vertices at every field size from 2x to 6x`);
  }

  // The positive control. If `Renderer` stopped drawing a grid at all, every
  // assertion above would still hold, at a constant of whatever the ship costs.
  const wide = renderedPoints(5400, 6720, VIEW_W * 2, VIEW_H * 2);
  console.log(`    same 6x field, view doubled       ${String(wide).padStart(7)} vertices per frame`);
  checked++;
  if (wide <= first) {
    fail(`doubling the VIEW did not add vertices (${first} -> ${wide}) — the renderer is not drawing a view-sized lattice`);
  } else {
    pass(`doubling the view took the renderer from ${first} to ${wide} vertices`);
  }
}

/* ------------------------------------------------------------------ part D */

/*
 * D. THE VIEW IS A FUNCTION OF THE WINDOW, and the drawn lattice follows it.
 *
 * Parts A-C all hold the view still and grow the field. That was the whole
 * question while `VIEW_W/VIEW_H` were constants: the arena had just become
 * eleven times the screen and the risk was the draw scaling with it. This file
 * says in its own header that it "has never yet seen VIEW actually move".
 *
 * It moves now. `field.setView` is called from `main.ts` on every resize, so
 * the pair this whole check is denominated in is live state. Two things
 * therefore need asserting that did not before:
 *
 *   THE POLICY. `viewForStage` maps a stage box to a world rectangle. It must
 *   preserve the box's ASPECT — a view of a different shape from the element
 *   it is drawn into is a stretched playfield, silently — and it must clamp the
 *   visible AREA into `[VIEW_SPAN_MIN, VIEW_SPAN_MAX]` squared, which is what
 *   stops a small window being harder than the old fixed layout and an
 *   ultrawide seeing two thirds of the field at once.
 *
 *   THE COUPLING, in both directions and in the same run. Move the FIELD and
 *   the drawn count must not move; move the VIEW and it must. Part A has the
 *   first half against an explicit rectangle; this has both halves against the
 *   real module binding, which is the thing `main.ts` writes.
 */
console.log('\nD. THE VIEW FOLLOWS THE WINDOW');

{
  const { VIEW_SPAN_MIN, VIEW_SPAN_MAX, VIEW_ASPECT_MIN, VIEW_ASPECT_MAX } = field;
  console.log(
    `    span clamped to [${VIEW_SPAN_MIN}, ${VIEW_SPAN_MAX}], stage aspect to [${VIEW_ASPECT_MIN}, ${VIEW_ASPECT_MAX}]`,
  );
  console.log(
    `    ${'window'.padEnd(13)} ${'stage box'.padEnd(13)} ${'view'.padEnd(13)} ${'span'.padStart(6)} ${'aspect'.padStart(7)} ${'area vs 900x1120'.padStart(17)}`,
  );

  // Real windows plus the two extremes the clamps exist for.
  const WINDOWS = [
    ['phone portrait', 390, 844],
    ['tablet', 820, 1180],
    ['small laptop', 1000, 700],
    ['1280 x 800', 1280, 800],
    ['this machine', 1512, 945],
    ['1080p', 1920, 1080],
    ['1440p', 2560, 1440],
    ['ultrawide 21:9', 3440, 1440],
    ['4K', 3840, 2160],
  ];
  const BASE = 900 * 1120;
  let aspectBad = 0;
  let spanBad = 0;
  for (const [label, ww, wh] of WINDOWS) {
    // 10px of padding on every side, as `#app` carries in style.css.
    const box = field.stageBox(ww - 20, wh - 20);
    const v = field.viewForStage(box.w, box.h);
    const span = Math.sqrt(v.w * v.h);
    const aspect = v.w / v.h;
    const boxAspect = box.w / box.h;
    console.log(
      `    ${label.padEnd(13)} ${`${box.w}x${box.h}`.padEnd(13)} ${`${v.w}x${v.h}`.padEnd(13)} ` +
        `${span.toFixed(0).padStart(6)} ${aspect.toFixed(3).padStart(7)} ${`${((v.w * v.h) / BASE).toFixed(2)}x`.padStart(17)}`,
    );
    checked++;
    // 0.5% of slack for the rounding to whole world units at both ends.
    if (Math.abs(aspect / boxAspect - 1) > 0.005) {
      aspectBad++;
      fail(
        `${label}: the view is ${aspect.toFixed(3)}:1 into a ${boxAspect.toFixed(3)}:1 element — the playfield draws stretched`,
      );
    }
    checked++;
    if (span < VIEW_SPAN_MIN - 1 || span > VIEW_SPAN_MAX + 1) {
      spanBad++;
      fail(`${label}: visible span ${span.toFixed(0)} is outside [${VIEW_SPAN_MIN}, ${VIEW_SPAN_MAX}]`);
    }
    checked++;
    if (box.w > ww - 20 + 0.5 || box.h > wh - 20 + 0.5) {
      fail(`${label}: the stage box ${box.w}x${box.h} is larger than the ${ww - 20}x${wh - 20} it was given`);
    }
  }
  if (!aspectBad) pass(`${WINDOWS.length} windows: the view is the same shape as the element at every one`);
  if (!spanBad) pass(`${WINDOWS.length} windows: visible area stays inside [${VIEW_SPAN_MIN}, ${VIEW_SPAN_MAX}] squared`);

  // Both clamps have to actually BITE somewhere, or the band above is
  // decoration and this check would pass on a policy that ignored it.
  const smallest = field.viewForStage(...Object.values(field.stageBox(380, 824)));
  const largest = field.viewForStage(...Object.values(field.stageBox(3820, 2140)));
  checked++;
  if (Math.abs(Math.sqrt(smallest.w * smallest.h) - VIEW_SPAN_MIN) > 2) {
    fail(`the floor never binds: a 390x844 phone shows span ${Math.sqrt(smallest.w * smallest.h).toFixed(0)}`);
  } else pass(`the floor binds — a phone sees ${smallest.w}x${smallest.h}, the same area as the old 900x1120`);
  checked++;
  if (Math.abs(Math.sqrt(largest.w * largest.h) - VIEW_SPAN_MAX) > 2) {
    fail(`the ceiling never binds: 4K shows span ${Math.sqrt(largest.w * largest.h).toFixed(0)}`);
  } else pass(`the ceiling binds — 4K sees ${largest.w}x${largest.h} and not the whole field`);
}

{
  /*
   * The coupling, measured off the real renderer, through the real setter.
   *
   * `renderedPoints` calls `field.setView` and `duckWorld` reads the binding
   * back, so this is the same path `main.ts` uses on a window drag.
   */
  console.log('');
  const FIELD = [2700, 3360];
  const at = (w, h) => renderedPoints(FIELD[0], FIELD[1], w, h);
  const rows = [
    ['900 x 1120  (the old constant)', 900, 1120],
    ['1205 x 836  (1000x700 window)', 1205, 836],
    ['1492 x 925  (1512x945 window)', 1492, 925],
    ['1709 x 900  (ultrawide, clamped)', 1709, 900],
  ];
  const seen = [];
  for (const [label, w, h] of rows) {
    const n = at(w, h);
    seen.push({ label, w, h, n });
    console.log(`    view ${label.padEnd(34)} ${String(n).padStart(7)} vertices per frame`);
  }
  // Strictly monotone in AREA, which is what the lattice is a function of.
  const byArea = seen.slice().sort((a, b) => a.w * a.h - b.w * b.h);
  let mono = true;
  for (let i = 1; i < byArea.length; i++) {
    checked++;
    if (byArea[i].n <= byArea[i - 1].n) {
      mono = false;
      fail(
        `${byArea[i].label} covers more world than ${byArea[i - 1].label} but drew ${byArea[i].n} against ${byArea[i - 1].n}` +
          ' — moving VIEW_W/VIEW_H does not reach the draw',
      );
    }
  }
  if (mono) {
    pass(
      `every step up in view area drew strictly more: ${byArea.map((r) => r.n).join(' -> ')}` +
        ' — the module binding reaches the renderer',
    );
  }

  // And the negative control, in the same run and through the same path: hold
  // the view where it is and take the FIELD from 2x to 6x.
  const held = [1492, 925];
  const a = renderedPoints(1800, 1800, held[0], held[1]);
  const bb = renderedPoints(5400, 6720, held[0], held[1]);
  console.log(`    field 1800x1800 -> 5400x6720 at a held ${held[0]}x${held[1]} view: ${a} -> ${bb} vertices`);
  checked++;
  if (a !== bb) fail(`the field moved the draw at a held view (${a} -> ${bb})`);
  else pass(`the field did not move the draw at a held view (${a} both times)`);
}

// Leave the binding where it was found. Nothing else in this process reads it,
// but a tool that mutates shared module state and does not put it back is one
// import away from being the reason another check is wrong.
field.setView(VIEW_W, VIEW_H);


/* A check that examined nothing reports a pass. */
console.log('');
console.log(`  assertions checked ${checked}, failed ${failures}`);
if (checked === 0) {
  console.log('  FAIL  nothing was measured — this check proved nothing\n');
  process.exit(1);
}
if (failures > 0) {
  console.log('\nTHE DRAWN LATTICE STILL SCALES WITH THE FIELD\n');
  process.exit(1);
}
console.log('\nTHE DRAWN LATTICE IS A FUNCTION OF THE VIEW\n');
