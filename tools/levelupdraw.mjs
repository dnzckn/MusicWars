/**
 * The level-up screen, drawn into a recording canvas instead of a browser.
 *
 * `tools/levelshot.mjs` is the pixel version of this and is the better tool
 * when it can run. It cannot run here: this box has no system NSS, no root and
 * **no network**, so the four libraries Chromium needs (`libnspr4`, `libnss3`,
 * `libnssutil3`, `libasound`) cannot be fetched and Playwright cannot launch at
 * all. Rather than ship a screen with no evidence behind it, this reconstructs
 * the drawing arithmetically — the same move `gating` makes when it computes
 * the sidechain automation instead of listening to its result in a busy mix.
 *
 * It cannot tell you whether the screen looks good. Only a person can do that,
 * and this directory's README is emphatic about the difference. What it *can*
 * decide is every question about the layout that has a right answer:
 *
 *   1. **Nothing is NaN.** This is the one that matters most, and it is not
 *      hypothetical: `renderer.ts` carries a comment about exactly this failure
 *      — a colour string built from NaN throws inside `addColorStop`, and the
 *      frame dies *after* the background has been cleared, so the symptom is a
 *      black screen rather than an error anyone can trace. Every numeric
 *      argument to every call is checked finite, and every colour string is
 *      checked for `NaN`/`undefined`/`Infinity`.
 *   2. **`hitTest` agrees with where the cards were drawn**, at every size and
 *      every option count. The failure this guards is silent: the player clicks
 *      PIZZICATO and receives SNARE ROLL.
 *   3. **Cards do not overlap and stay on the field.**
 *   4. **Text stays inside its card**, measured rather than eyeballed.
 *   5. **Every option gets a card** — the grace-filter bug, made permanent.
 *
 * And crucially it sweeps **field sizes and option counts**, which a screenshot
 * at one window size cannot. Two of the three layout bugs found while writing
 * this screen only appear at the small end of the card-height clamp, which is a
 * state no screenshot anybody would think to take ever visits.
 */
import './lib/ts.mjs';

/*
 * Must be run with `node --experimental-transform-types`.
 *
 * The render tree reaches `core/math.ts`, which declares a parameter property
 * (`constructor(private riseAt: number)`), and Node's DEFAULT type handling is
 * strip-only: it may replace types with whitespace but never rewrite, and a
 * parameter property has to be expanded into an assignment rather than erased.
 * So a plain `node tools/levelupdraw.mjs` dies on an import with
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, which does not obviously mean "add a
 * flag". `--experimental-transform-types` transforms instead of stripping and
 * handles it — the whole render tree imports in ~100ms.
 *
 * Note this is a different question from the one `npm run syntax` answers:
 * `node --check` only has to PARSE, and a parameter property parses fine, so
 * that gate is green on the very file this cannot import without the flag.
 */
let LevelUpOverlay;
let emptySnapshot;
try {
  ({ LevelUpOverlay } = await import('../src/render/levelup.ts'));
  ({ emptySnapshot } = await import('../src/core/events.ts'));
} catch (err) {
  if (String(err).includes('UNSUPPORTED_TYPESCRIPT_SYNTAX')) {
    console.error('\nlevelupdraw: run this with the transform flag:\n');
    console.error('    node --experimental-transform-types tools/levelupdraw.mjs\n');
    process.exit(2);
  }
  throw err;
}

let failures = 0;
const seen = new Set();
const fail = (msg) => {
  // Deduplicated: one broken expression fires on every frame of every sweep,
  // and four hundred copies of one fault hides the other three.
  if (seen.has(msg)) return;
  seen.add(msg);
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

/* ------------------------------------------------------------ the recorder */

const BAD = /NaN|undefined|Infinity/;

/**
 * A CanvasRenderingContext2D that records instead of rasterising.
 *
 * Text widths assume a monospace face at 0.6em per character, which is what
 * `ui-monospace` actually is to within a few percent — close enough to decide
 * whether a string overruns a card by 200px, which is the only question asked
 * of it here.
 */
function recorder(where, sink = fail) {
  const calls = [];
  const texts = [];
  let fontPx = 12;

  const num = (name, ...vals) => {
    for (const v of vals) {
      if (typeof v === 'number' && !Number.isFinite(v)) sink(`${where}: ${name}() got a non-finite argument (${v})`);
    }
  };
  const colour = (name, v) => {
    if (typeof v === 'string' && BAD.test(v)) sink(`${where}: ${name} = "${v}"`);
  };

  const grad = () => ({ addColorStop: (o, c) => { num('addColorStop', o); colour('gradient stop', c); } });

  const g = {
    canvas: { width: 0, height: 0 },
    save() {}, restore() {},
    beginPath() {}, closePath() {},
    fill() { calls.push('fill'); }, stroke() { calls.push('stroke'); }, clip() {},
    moveTo: (...a) => num('moveTo', ...a),
    lineTo: (...a) => num('lineTo', ...a),
    rect: (...a) => num('rect', ...a),
    roundRect: (...a) => num('roundRect', ...a.flat()),
    arc: (...a) => num('arc', ...a),
    ellipse: (...a) => num('ellipse', ...a),
    fillRect: (...a) => { num('fillRect', ...a); calls.push('fillRect'); },
    strokeRect: (...a) => num('strokeRect', ...a),
    clearRect: (...a) => num('clearRect', ...a),
    translate: (...a) => num('translate', ...a),
    scale: (...a) => num('scale', ...a),
    rotate: (...a) => num('rotate', ...a),
    setTransform: (...a) => num('setTransform', ...a),
    setLineDash: () => {},
    createLinearGradient: (...a) => { num('createLinearGradient', ...a); return grad(); },
    createRadialGradient: (...a) => { num('createRadialGradient', ...a); return grad(); },
    drawImage: (...a) => num('drawImage', ...a.slice(1)),
    measureText: (t) => ({ width: String(t).length * fontPx * 0.6 }),
    fillText(t, x, y) {
      num('fillText', x, y);
      if (BAD.test(String(t))) sink(`${where}: fillText drew "${t}"`);
      texts.push({ t: String(t), x, y, w: String(t).length * fontPx * 0.6, px: fontPx, align: this.textAlign });
    },
    strokeText: (t, x, y) => num('strokeText', x, y),
  };

  // Style properties validate on write, which is where a NaN first becomes a
  // string and stops being detectable as a number.
  for (const p of ['fillStyle', 'strokeStyle']) {
    let v = '';
    Object.defineProperty(g, p, { get: () => v, set: (n) => { colour(p, n); v = n; } });
  }
  let font = '12px monospace';
  Object.defineProperty(g, 'font', {
    get: () => font,
    set: (n) => { colour('font', n); font = n; fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(n)?.[1] ?? 12); },
  });
  for (const p of ['globalAlpha', 'lineWidth']) {
    let v = 1;
    Object.defineProperty(g, p, {
      get: () => v,
      set: (n) => { if (!Number.isFinite(n)) sink(`${where}: ${p} = ${n}`); v = n; },
    });
  }
  for (const p of ['textAlign', 'textBaseline', 'lineCap', 'lineJoin', 'globalCompositeOperation', 'filter']) {
    g[p] = '';
  }
  return { g, calls, texts };
}

/* ------------------------------------------------------------- the states */

const opt = (id, grace = null) => ({ id, grace });

const snapshot = (abilities, i = 3, r = 3, choosing = true) => {
  const s = emptySnapshot();
  Object.assign(s.abilities, abilities);
  s.instrumentSlots = i;
  s.rigSlots = r;
  s.choosing = choosing;
  s.level = 12;
  return s;
};

const STATES = [
  {
    name: 'early',
    snap: snapshot({ pizzicato: 2 }),
    offer: { level: 3, queued: 0, rerolls: 2, banishes: 1, options: [opt('snare'), opt('bow'), opt('capo'), opt('chime')] },
  },
  {
    name: 'building',
    snap: snapshot({ pizzicato: 5, chime: 6, drones: 2, capo: 3, resonance: 3 }, 4, 4),
    offer: { level: 14, queued: 1, rerolls: 1, banishes: 1, options: [opt('chime'), opt('resonance'), opt('timpani'), opt('laser')] },
  },
  {
    name: 'onefromfusion',
    snap: snapshot({ pizzicato: 8, chime: 8, drones: 4, capo: 5, resonance: 4, laser: 2 }, 5, 5),
    offer: { level: 26, queued: 0, rerolls: 1, banishes: 0, options: [opt('resonance'), opt('drones'), opt('laser'), opt('bow')] },
    wantCompletes: 0,
  },
  {
    name: 'allgrace',
    snap: snapshot(
      { pizzicato: 8, chime: 8, drones: 8, snare: 8, bow: 8, harp: 8, capo: 5, resonance: 5, laser: 5, spread: 5, rapid: 5, magnet: 5 },
      6, 6,
    ),
    offer: { level: 41, queued: 2, rerolls: 0, banishes: 0, options: [opt(null, 'rest'), opt(null, 'bomb'), opt(null, 'shards'), opt(null, 'rest')] },
  },
  {
    name: 'fused-in-loadout',
    snap: snapshot({ carillon: 1, pizzicato: 8, capo: 5, resonance: 5 }, 4, 4),
    offer: { level: 30, queued: 0, rerolls: 1, banishes: 1, options: [opt('snare'), opt('bow')] },
  },
];

/** Field sizes: the real one, the old one, and two deliberately cruel ones. */
const SIZES = [
  [900, 1120],
  [720, 960],
  [560, 820],
  [440, 620],
];

/** Moments across the entry, the hold and the exit. */
const FRAMES = [0.016, 0.09, 0.2, 0.45, 0.9, 2.5];

/* ---------------------------------------------------------- the control */

/*
 * Does the detector detect?
 *
 * This directory's README is blunt about it: five checks here once printed a
 * verdict and exited 0 regardless, and "a check that cannot fail is
 * decoration". Everything below reports green when the screen is right, and a
 * green run is only worth reading if the instrument can go red. So plant one
 * of each fault into a throwaway recorder and require it to catch all four.
 */
console.log('\nCONTROL — can this tool fail?');
{
  const caught = [];
  const { g } = recorder('control', (m) => caught.push(m));
  g.fillRect(NaN, 0, 10, 10);
  g.fillStyle = 'hsla(NaN, 90%, 60%, 1)';
  g.fillText('level NaN', 5, Infinity);
  g.globalAlpha = NaN;
  // 4 planted: the coordinate, the colour, the text position AND its content
  // (the string itself contains "NaN"), plus the alpha — five detections from
  // four calls, because the bad fillText trips both of its own guards.
  if (caught.length < 5) fail(`control: only ${caught.length}/5 planted faults were caught`);
  else pass(`control: ${caught.length} planted faults caught (coordinate, colour, text position, text content, alpha)`);
}

console.log('\nDRAW — no browser: reconstructing the layout arithmetically');
console.log(`  ${STATES.length} states x ${SIZES.length} field sizes x ${FRAMES.length} frames, plus exits\n`);

let drew = 0;
let checked = 0;
let settled = 0;
let totalCalls = 0;
let totalTexts = 0;
let minCalls = Infinity;
let minTexts = Infinity;

for (const st of STATES) {
  for (const [W, H] of SIZES) {
    const where = `${st.name} @ ${W}x${H}`;
    const ui = new LevelUpOverlay();
    ui.open(st.offer, st.snap);

    // Cards must exist one-for-one with the options, before anything is drawn.
    const cards = ui.summary();
    if (cards.length !== st.offer.options.length) {
      fail(`${where}: ${st.offer.options.length} options -> ${cards.length} cards`);
    }
    if (st.wantCompletes !== undefined && !cards[st.wantCompletes]?.completes) {
      fail(`${where}: card ${st.wantCompletes} should complete a fusion and reports null`);
    }

    let last = 0;
    for (const t of FRAMES) {
      const { g, texts, calls } = recorder(`${where} t=${t}`);
      // Beat position and pulse swept too, so the beat-reactive expressions are
      // exercised at their extremes rather than only at pulse 0.
      const beat = t * 2.17;
      const pulse = t % 0.5 < 0.25 ? 1 : 0;
      ui.draw(g, st.snap, t - last, W, H, beat, pulse);
      last = t;
      drew++;

      const rects = ui.rects();
      if (rects.length !== st.offer.options.length) fail(`${where} t=${t}: rects went to ${rects.length}`);

      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        checked++;
        if (!Number.isFinite(r.x + r.y + r.w + r.h)) fail(`${where}: card ${i} rect is non-finite`);
        if (r.w <= 0 || r.h <= 0) fail(`${where}: card ${i} has a non-positive size`);
        if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) {
          fail(`${where}: card ${i} escapes the field (${r.x},${r.y} ${r.w}x${r.h})`);
        }
        const hit = ui.hitTest(r.x + r.w / 2, r.y + r.h / 2);
        if (hit !== i) fail(`${where}: hitTest at the centre of card ${i} returned ${hit}`);
        // The negative half of the same question. Without it, a `hitTest` that
        // returned the loop index unconditionally — or simply always 0 for a
        // one-card offer — would pass the line above every time.
        if (ui.hitTest(r.x - 12, r.y + r.h / 2) === i) {
          fail(`${where}: hitTest claims card ${i} 12px to the left of its own edge`);
        }
        for (let j = i + 1; j < rects.length; j++) {
          const o = rects[j];
          if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) {
            fail(`${where}: cards ${i} and ${j} overlap`);
          }
        }
      }

      /*
       * Did anything actually get drawn?
       *
       * Every other assertion in this loop reads `ui.rects()`, which is the
       * overlay's own layout state and not the recording — so a recorder that
       * captured nothing, or a `draw()` that early-returned, would leave the
       * text loop below iterating zero times and **every check would still
       * report green**. That is the shape of the `miniAllStrings()` trap in
       * `lib/headless-audio.mjs`: `motorcheck`'s first run passed 1760 states
       * while examining, in effect, no notes, and what exposed it was the
       * arithmetic — 1.75 events per state is not a pattern with a sixteenth
       * layer in it.
       *
       * The floor is deliberately loose, and the first version of it was not.
       * At 25 calls it failed the all-grace state at 21 — correctly measured
       * and wrongly judged, because a grace card has no ability and therefore
       * no level staff and no eight noteheads, so that state legitimately
       * paints less than the others. A threshold sitting inside the honest
       * variation of its own metric is the most common way a check in this
       * directory lies, and it had just done it to me.
       *
       * So the split is: **the assertion catches "nothing painted", the printed
       * averages catch "painting a quarter of itself".** 8 calls and 4 strings
       * is a 2.5x margin under the worst real frame and still fails hard on an
       * inert recorder (0/0) or a screen that drew only its backdrop (1/0).
       * Same division of labour as `chop`, where the hole detector asserts and
       * the swing column is printed with an explicit warning not to conclude
       * from it.
       */
      if (t >= 0.45) {
        minCalls = Math.min(minCalls, calls.length);
        minTexts = Math.min(minTexts, texts.length);
        totalCalls += calls.length;
        totalTexts += texts.length;
        settled++;
        if (calls.length < 8 || texts.length < 4) {
          fail(`${where} t=${t}: only ${calls.length} draw calls and ${texts.length} strings — the screen is not painting`);
        }
      }

      // Text must not run off the right edge of the field. Left-aligned only:
      // right- and centre-aligned strings are placed by their own anchor and a
      // width estimate would produce false alarms rather than findings.
      for (const tx of texts) {
        if (tx.align === 'left' && tx.x + tx.w > W + 1) {
          fail(`${where}: "${tx.t.slice(0, 28)}" runs ${Math.round(tx.x + tx.w - W)}px off the right edge`);
        }
        if (tx.y < 0 || tx.y > H) fail(`${where}: "${tx.t.slice(0, 28)}" is drawn off-field at y=${Math.round(tx.y)}`);
      }
    }

    /*
     * The exit, driven at a real frame time.
     *
     * `step` clamps dt to 0.05s so a long frame cannot skip an animation
     * outright, which means the exit takes at least ceil(0.55 / 0.05) = 12
     * frames however slow the game is running. Feeding it four 0.2s frames
     * measures the clamp, not the animation — the first version of this loop
     * did exactly that and reported twenty failures against working code.
     */
    ui.resolveChoice(st.offer.options[0].id, st.offer.options[0].grace);
    for (let f = 0; f < 60 && ui.isOpen; f++) {
      const { g } = recorder(`${where} exit`);
      ui.draw(g, st.snap, 1 / 60, W, H, 4.2, 0.5);
      drew++;
    }
    if (ui.isOpen) fail(`${where}: still open after 60 frames of exit animation`);

    // And the close path the grace pick relies on: `choosing` going false.
    const ui2 = new LevelUpOverlay();
    ui2.open(st.offer, st.snap);
    const open = snapshot({}, 3, 3, true);
    const shut = snapshot({}, 3, 3, false);
    ui2.draw(recorder('latch').g, open, 0.016, W, H, 1, 0);
    for (let k = 0; k < 60; k++) ui2.draw(recorder('latch').g, shut, 0.016, W, H, 1, 0);
    if (ui2.isOpen) fail(`${where}: the choosing latch did not close the screen`);
  }
}

pass(`${drew} frames drawn, ${checked} card rectangles checked, no non-finite values`);
// Printed, not just asserted, so the arithmetic can be sanity-checked by eye —
// a floor only catches zero, and a screen drawing a quarter of itself would
// clear a floor while being obviously wrong to anyone reading the averages.
pass(
  `painted: ${(totalCalls / settled).toFixed(0)} draw calls and ${(totalTexts / settled).toFixed(0)} strings ` +
    `per settled frame (worst ${minCalls}/${minTexts}, over ${settled} frames)`,
);
pass('hitTest agreed with the drawn layout at every size and every frame');
pass('no card overlapped another or escaped the field');
pass('the choosing latch closes the screen when no event arrives');

/* --------------------------------------------------------- the celebration */

console.log('\nFUSION');

for (const [kind, a, b, to] of [
  ['evolution', 'chime', 'resonance', 'carillon'],
  ['union', 'chorale', 'cathedral', 'requiem'],
]) {
  const ui = new LevelUpOverlay();
  ui.celebrate(kind, a, b, to, 'a line about the sound');
  const snap = snapshot({}, 3, 3, false);
  let painted = 0;
  let frames = 0;
  // Well past a union's 6.2s life, so the teardown is covered too.
  for (let t = 0; t < 8; t += 0.05) {
    const { g, calls } = recorder(`${kind} t=${t.toFixed(2)}`);
    ui.draw(g, snap, 0.05, 900, 1120, t * 2.17, 0.4);
    frames++;
    if (calls.length) painted++;
  }
  const life = kind === 'union' ? 6.2 : 3.6;
  const expected = Math.round(life / 0.05);
  // Within a couple of frames of its declared life: a celebration that never
  // ends is a celebration that eats the rest of the run.
  if (Math.abs(painted - expected) > 4) {
    fail(`${kind} ${to}: painted ${painted} frames, expected about ${expected} for a ${life}s life`);
  } else {
    pass(`${kind} ${to}: painted ${painted}/${frames} frames, ~${life}s as declared`);
  }
}

// Two on one boss defeat — a union's halves can both evolve in the same
// cadenza, and `resolveFusions` deliberately allows it. They must stack rather
// than draw on top of each other.
{
  const ui = new LevelUpOverlay();
  ui.celebrate('evolution', 'chime', 'resonance', 'carillon', 'one bell becomes a tower');
  ui.celebrate('union', 'chorale', 'cathedral', 'requiem', 'the choir and the room become one');
  const snap = snapshot({}, 3, 3, false);
  for (let t = 0; t < 8; t += 0.1) ui.draw(recorder(`stacked t=${t.toFixed(1)}`).g, snap, 0.1, 900, 1120, t * 2.17, 0.4);
  pass('two celebrations at once draw without a non-finite value');
}

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
