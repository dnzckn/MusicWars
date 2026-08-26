/**
 * Are the beams, sweeps and fields actually drawn?
 *
 *     node --experimental-transform-types tools/effectsdraw.mjs
 *
 * `World.effects` carries a doc comment headed "THIS IS THE RENDERER'S
 * CONTRACT" and for the whole life of the effects system **nothing in
 * `src/render/` read it**. ROSIN BOW and HARMONICS (`beam`), SNARE ROLL and
 * BLAST BEAT (`arc` at zero speed, which routes to `sweep`) dealt damage and
 * left no mark. In the soloist probe `snare` is last of the roster at 5.2
 * kills/min and `bow` third from last at 11.0 — the two weakest instruments in
 * the game were two of the four you could not see, which is a balance problem
 * caused by a rendering gap.
 *
 * A defect that is "nothing is drawn" needs a check that can tell drawn from
 * not-drawn, and the whole trap is that **an empty sample looks exactly like a
 * clean pass**. That is the `miniAllStrings()` failure from
 * `lib/headless-audio.mjs`, where `motorcheck` passed 1760 states while
 * examining no notes at all, and it is the same failure `levelupdraw` had
 * before its paint floor went in. So every assertion here is a *count*, and
 * every count is printed.
 *
 * The renderer is driven against a recording `CanvasRenderingContext2D` with a
 * duck-typed world — `Renderer` imports `World` as a **type only**, so a plain
 * object with the right fields is enough and none of `world.ts` is loaded. No
 * browser, no dev server, no canvas.
 */
import './lib/ts.mjs';

let Renderer;
try {
  ({ Renderer } = await import('../src/render/renderer.ts'));
} catch (err) {
  if (String(err).includes('UNSUPPORTED_TYPESCRIPT_SYNTAX')) {
    console.error('\neffectsdraw: run with  node --experimental-transform-types tools/effectsdraw.mjs\n');
    process.exit(2);
  }
  throw err;
}

let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const pass = (m) => console.log(`  ok    ${m}`);

const BAD = /NaN|undefined|Infinity/;

/**
 * Records draw calls and, crucially, **which of them are attributable to the
 * effect being tested**: the renderer draws a background, a grid and a
 * starfield on every frame, so "did anything get drawn" is trivially yes and
 * tells us nothing. Ops are tagged with the fill/stroke style in force, so an
 * effect's hue can be picked out of the noise.
 */
function recorder(sink) {
  const ops = [];
  let fill = '';
  let stroke = '';
  const num = (name, ...v) => {
    for (const x of v) if (typeof x === 'number' && !Number.isFinite(x)) sink(`${name}() got ${x}`);
  };
  const colour = (n, v) => {
    if (typeof v === 'string' && BAD.test(v)) sink(`${n} = "${v}"`);
  };
  const grad = () => ({
    addColorStop: (o, c) => {
      num('addColorStop', o);
      colour('gradient stop', c);
      // A gradient's stops are where an effect's hue actually lives, so they
      // are recorded as ops in their own right.
      ops.push({ op: 'stop', style: String(c) });
    },
  });
  const g = {
    canvas: { width: 900, height: 1120 },
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
    fill() { ops.push({ op: 'fill', style: String(fill) }); },
    stroke() { ops.push({ op: 'stroke', style: String(stroke) }); },
    fillRect: (...a) => { num('fillRect', ...a); ops.push({ op: 'fillRect', style: String(fill), a }); },
    strokeRect: (...a) => num('strokeRect', ...a),
    clearRect: (...a) => num('clearRect', ...a),
    moveTo: (...a) => num('moveTo', ...a),
    lineTo: (...a) => num('lineTo', ...a),
    rect: (...a) => num('rect', ...a),
    // The sprite atlas is built with curves at module load; without these the
    // run dies inside `enemyBulletSprites()` before reaching any effect.
    quadraticCurveTo: (...a) => num('quadraticCurveTo', ...a),
    bezierCurveTo: (...a) => num('bezierCurveTo', ...a),
    arcTo: (...a) => num('arcTo', ...a),
    transform: (...a) => num('transform', ...a),
    resetTransform: () => {},
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: () => {},
    roundRect: (...a) => num('roundRect', ...a.flat()),
    arc: (...a) => { num('arc', ...a); ops.push({ op: 'arc', style: String(stroke), a }); },
    ellipse: (...a) => { num('ellipse', ...a); ops.push({ op: 'ellipse', style: String(fill), a }); },
    translate: (...a) => num('translate', ...a),
    rotate: (...a) => num('rotate', ...a),
    scale: (...a) => num('scale', ...a),
    setTransform: (...a) => num('setTransform', ...a),
    setLineDash: () => {},
    createLinearGradient: (...a) => { num('createLinearGradient', ...a); return grad(); },
    createRadialGradient: (...a) => { num('createRadialGradient', ...a); return grad(); },
    drawImage: (...a) => num('drawImage', ...a.slice(1)),
    measureText: (t) => ({ width: String(t).length * 7 }),
    fillText: (t, x, y) => { num('fillText', x, y); if (BAD.test(String(t))) sink(`fillText "${t}"`); },
    strokeText: (t, x, y) => num('strokeText', x, y),
    getContext: () => g,
  };
  Object.defineProperty(g, 'fillStyle', { get: () => fill, set: (v) => { colour('fillStyle', v); fill = v; } });
  Object.defineProperty(g, 'strokeStyle', { get: () => stroke, set: (v) => { colour('strokeStyle', v); stroke = v; } });
  for (const p of ['globalAlpha', 'lineWidth']) {
    let v = 1;
    Object.defineProperty(g, p, { get: () => v, set: (n) => { if (!Number.isFinite(n)) sink(`${p} = ${n}`); v = n; } });
  }
  for (const p of ['font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'globalCompositeOperation', 'filter']) g[p] = '';
  /*
   * Assigned after `g` exists: the renderer is handed a canvas and calls
   * `getContext` on it, and the bloom pass reads `g.canvas` back.
   *
   * `clientHeight` IS LOAD-BEARING and was missing. `Renderer.fitCanvases`
   * guards on `clientHeight <= 0` and returns — but `undefined <= 0` is FALSE,
   * so it walked straight past the guard into
   * `Math.min(1.5, Math.max(0.6, (undefined * dpr) / height))`, which is NaN,
   * and `this.scale` was NaN for the whole run. Every frame then opened with
   * `setTransform(NaN, ...)`. 1120 makes the scale exactly 1, so the recorded
   * coordinates are world coordinates and the assertions below can be written
   * in the units the world uses.
   */
  g.canvas = { width: 900, height: 1120, clientHeight: 1120, clientWidth: 900, getContext: () => g };
  return { g, ops };
}

/** Enough of the DOM for the renderer's constructor. */
function installDom(rec) {
  globalThis.window ??= {};
  globalThis.devicePixelRatio ??= 1;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => rec.g }),
    getElementById: () => null,
  };
  /*
   * THIS FILE WAS DEAD, and neither `verify:node` nor `verify` could tell you.
   *
   * `Renderer`'s constructor grew `new ResizeObserver(...)` and
   * `addEventListener('resize', ...)`, and this stub provides neither, so every
   * invocation died at `frame()` with `ReferenceError: ResizeObserver is not
   * defined` before a single assertion ran. Confirmed against a pristine
   * `git archive HEAD` tree, so it is not a regression from the rules work —
   * it is the tool going quiet at some earlier point and nobody noticing,
   * because `effectsdraw` is in `npm run verify` (which dies on its first
   * browser gate on this machine) and not in `tools/verify-node.mjs`.
   *
   * A check that cannot run is worse than a red one: it looks like coverage.
   * The two stubs below are inert — nothing here ever resizes — and exist only
   * so the constructor completes.
   */
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.addEventListener ??= () => {};
}

const effect = (over) => ({
  kind: 'beam', id: 'bow', x: 450, y: 700, angle: -Math.PI / 2,
  radius: 14, length: 420, arc: 0, dps: 30, life: 0.5, age: 0,
  hue: 291, attached: true, pull: 0, swallows: false, ...over,
});

/** A duck-typed world. `Renderer` imports `World` as a type only. */
function makeWorld(effects, novas = []) {
  return {
    width: 900, height: 1120,
    camera: { x: 0, y: 0, flash: 0, flashHue: 0 },
    // Every field `drawPlayer` and `drawDrones` read. An absent one becomes
    // `undefined`, which reaches `translate()` as NaN — and a NaN in a colour
    // string throws inside `addColorStop` and kills the frame after the
    // background has been cleared, which is a black screen with no error.
    player: {
      x: 450, y: 800, prevX: 450, prevY: 800, dead: false,
      hp: 3, maxHp: 3, invuln: 0, focused: false, bank: 0, ringPhase: 0,
      droneAngle: [], droneCooldown: [], radius: 8,
    },
    enemies: [], shocks: [], notes: [], particles: { count: 0 }, drops: [], popups: [],
    playerBullets: { count: 0 }, enemyBullets: { count: 0 },
    novas, effects,
    banner: '', bannerSub: '', bannerAge: 9, bannerKind: 'wave',
    snapshot: { running: true, level: 3, xp: 2, xpToNext: 9, choosing: false, abilities: {}, instrumentSlots: 3, rigSlots: 3 },
    bus: { on() {} },
  };
}

/** Hues present in the ops recorded for one frame. */
const huesIn = (ops) => {
  const out = new Set();
  for (const o of ops) {
    const m = /hsla?\(\s*(-?[\d.]+)/.exec(o.style ?? '');
    if (m) out.add(Math.round(Number(m[1])));
  }
  return out;
};

const transport = { beat: 4.25, bpm: 128, advance() {}, get barPhase() { return 0.0625; } };

/** Render one frame with `effects` present and return the recorded ops. */
function frame(effects, novas = []) {
  const rec = recorder(fail);
  installDom(rec);
  const world = makeWorld(effects, novas);
  const r = new Renderer(rec.g.canvas, rec.g.canvas, world);
  r.bloomEnabled = false;
  r.bloomAuto = false;
  rec.ops.length = 0;
  r.render(1, 1 / 60, transport, 0.4, 60);
  return rec.ops;
}

/*
 * Warm the sprite atlas before measuring anything.
 *
 * `enemyBulletSprites()` and `playerBulletSprites()` build their atlases lazily
 * on first use, and that construction is hundreds of draw ops on the very frame
 * this tool is trying to use as a baseline. Measured cold, the empty-field
 * control came out at 761 ops against 178 for a frame WITH a beam, and the
 * control duly reported that adding a beam had removed 583 draw calls. The
 * baseline has to be of the same steady state as the thing it is compared to.
 */
frame([]);

console.log('\nCONTROL — can this tool tell drawn from not drawn?');
{
  // The negative control, and it is the whole basis of every count below: the
  // SAME frame with no effects at all. Every number that follows is measured
  // against this, not against zero, because the renderer paints a background,
  // a grid and a starfield regardless.
  const bare = frame([]);
  const withBeam = frame([effect({})]);
  console.log(`    empty field: ${bare.length} ops   one beam: ${withBeam.length} ops`);
  if (withBeam.length <= bare.length) {
    fail(`adding a beam changed nothing (${bare.length} -> ${withBeam.length} ops) — effects are not drawn`);
  } else {
    pass(`a beam adds ${withBeam.length - bare.length} draw ops over an otherwise identical frame`);
  }
  // And the hue has to be the effect's own, not the renderer's palette.
  const odd = 291;
  if (!huesIn(withBeam).has(odd) || huesIn(bare).has(odd)) {
    fail(`hue ${odd} is not attributable to the beam (bare has it: ${huesIn(bare).has(odd)})`);
  } else {
    pass(`the beam's hue ${odd} appears only when the beam is present`);
  }
}

console.log('\nEVERY SHAPE IS DRAWN');
{
  const bare = frame([]).length;
  const SHAPES = [
    ['beam  (ROSIN BOW / HARMONICS)', effect({ kind: 'beam', hue: 291 })],
    ['sweep (SNARE ROLL / BLAST BEAT)', effect({ kind: 'sweep', hue: 17, arc: 1.9, length: 260 })],
    ['field (BLACK HOLE / TREMOLO)', effect({ kind: 'field', hue: 268, radius: 190, pull: 120 })],
    ['field, no pull', effect({ kind: 'field', hue: 268, radius: 190, pull: 0 })],
  ];
  for (const [label, e] of SHAPES) {
    const ops = frame([e]);
    const added = ops.length - bare;
    const hue = huesIn(ops).has(e.hue);
    console.log(`    ${label.padEnd(32)} +${String(added).padStart(3)} ops   hue ${e.hue} ${hue ? 'present' : 'MISSING'}`);
    if (added < 3) fail(`${label}: only ${added} ops — not meaningfully drawn`);
    if (!hue) fail(`${label}: the effect's own hue never reaches the canvas`);
  }
}

console.log('\nTHE FADE');
{
  // It must fade, and it must still be visible in the middle of its life — the
  // nova bug was exactly this: a fade against the wrong denominator made the
  // largest ring invisible for most of its travel.
  const bare = frame([]).length;
  const at = (age) => frame([effect({ age, life: 1 })]).length - bare;
  const young = at(0.05);
  const mid = at(0.5);
  const old = at(0.99);
  console.log(`    ops at age 0.05 / 0.50 / 0.99 of life: ${young} / ${mid} / ${old}`);
  if (mid < 3) fail(`an effect halfway through its life draws only ${mid} ops — invisible for most of its life`);
  else pass(`still drawn at half life (${mid} ops)`);
  if (old > 0 && young <= 0) fail('the fade runs backwards');
}

console.log('\nNOVA HUE AND REACH');
{
  const bare = frame([], []).length;
  // The two bugs that were in `drawNovas`: a hardcoded hue, and a fade against
  // a fixed 155 while `maxR` reaches 520 for REQUIEM.
  const small = frame([], [{ x: 450, y: 700, r: 40, alive: true, maxR: 120, speed: 200, dps: 5, hue: 42 }]);
  const huge = frame([], [{ x: 450, y: 700, r: 300, alive: true, maxR: 520, speed: 200, dps: 5, hue: 191 }]);
  console.log(`    small ring hue 42: ${huesIn(small).has(42) ? 'present' : 'MISSING'}   +${small.length - bare} ops`);
  console.log(`    REQUIEM-sized ring at r=300 of maxR=520, hue 191: ${huesIn(huge).has(191) ? 'present' : 'MISSING'}   +${huge.length - bare} ops`);
  if (!huesIn(small).has(42) || !huesIn(huge).has(191)) fail('novas are not using their own hue');
  else pass('each nova draws in its own hue');
  if (huge.length - bare < 3) {
    fail('a 520px nova at r=300 draws almost nothing — the fade is against the wrong denominator');
  } else {
    pass('a large nova is still drawn well into its expansion');
  }

  /*
   * THE RIG'S OWN RINGS, which are the smallest this container has ever held.
   *
   * UP-TEMPO's trail drop is a 34-56px ring and COMPRESSOR's on-hit ring is
   * 170-300px, and both go through `drawNovas` rather than through any new
   * drawing code — that is why the trail is built on `novas[]` at all, since
   * nothing in `Renderer` reads `World.wells` and the `field` shape is
   * consequently invisible. A trail the player cannot see is a rule they cannot
   * play around.
   *
   * The specific risk at this size is the four-stroke loop: it skips any stroke
   * whose `r - k * 5` has gone non-positive, so a 34px ring early in its life
   * draws fewer strokes than a big one. Counted rather than assumed. The
   * geometry is restated here rather than imported because this file
   * deliberately does not load `world.ts` — see the header — so these numbers
   * are a SAMPLE of the shipped range, not a second copy of it.
   */
  const trail = frame([], [{ x: 450, y: 700, r: 12, alive: true, maxR: 34, speed: 42, dps: 22, hue: 28 }]);
  const hitRing = frame([], [{ x: 450, y: 700, r: 90, alive: true, maxR: 300, speed: 520, dps: 60, hue: 12 }]);
  console.log(`    UP-TEMPO trail drop, r=12 of maxR=34, hue 28: ${huesIn(trail).has(28) ? 'present' : 'MISSING'}   +${trail.length - bare} ops`);
  console.log(`    COMPRESSOR on-hit ring, r=90 of maxR=300, hue 12: ${huesIn(hitRing).has(12) ? 'present' : 'MISSING'}   +${hitRing.length - bare} ops`);
  if (trail.length - bare < 3) fail(`a trail drop at r=12 draws only ${trail.length - bare} ops — the rule is invisible`);
  else if (!huesIn(trail).has(28)) fail('the trail drop is not drawn in its own hue');
  else pass('UP-TEMPO leaves a visible mark, and COMPRESSOR\'s ring is drawn');
  if (hitRing.length - bare < 3) fail(`the on-hit ring at r=90 draws only ${hitRing.length - bare} ops`);
}

console.log('\nMANY AT ONCE');
{
  const many = [];
  for (let i = 0; i < 24; i++) {
    many.push(effect({
      kind: ['beam', 'sweep', 'field'][i % 3],
      hue: (i * 37) % 360, age: (i % 10) / 10, life: 1,
      angle: i, arc: 0.4 + (i % 5) * 0.3, radius: 8 + i * 3, length: 60 + i * 17,
      pull: i % 2 ? 90 : 0,
    }));
  }
  const ops = frame(many);
  console.log(`    24 mixed effects: ${ops.length} ops, ${huesIn(ops).size} distinct hues`);
  if (huesIn(ops).size < 10) fail(`only ${huesIn(ops).size} distinct hues from 24 differently-coloured effects`);
  else pass(`24 effects produce ${huesIn(ops).size} distinct hues — they are individually coloured`);
}

console.log('\nDEGENERATE INPUT');
{
  // Zero and negative geometry must not produce NaN. `fail` is wired into the
  // recorder, so a non-finite argument anywhere fails the run.
  const before = failures;
  frame([
    effect({ length: 0, radius: 0, arc: 0 }),
    effect({ kind: 'sweep', length: 0, arc: 0 }),
    effect({ kind: 'field', radius: 0, pull: 1 }),
    effect({ life: 0, age: 0 }),
    effect({ kind: 'sweep', arc: -1, length: -5 }),
  ]);
  if (failures === before) pass('zero, negative and zero-life geometry produce no non-finite values');
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
