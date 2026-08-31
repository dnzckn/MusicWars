/*
 * reverbchurn — how many times a bar does superdough REBUILD the reverb?
 *
 * WHY THIS EXISTS. A CPU profile of a live wave-8 run (`tools/jankwhere.mjs`)
 * put `generateReverb` at 1061ms of JS self time in a 15-second window — SEVEN
 * TIMES the next JavaScript entry, and the only plausible source of the 24
 * long tasks of 72-109ms recorded over the same window. That is not a
 * rasteriser artefact: it is V8 running superdough's own code, and it costs
 * the same on a real GPU.
 *
 * THE MECHANISM, read out of the dependency rather than guessed
 * (`node_modules/superdough/superdoughoutput.mjs:69`, `getReverb`):
 *
 *     if (hasChanged(duration, this.reverbNode.duration) || fade || lp ||
 *         dim || irspeed || irbegin || ir !== ir) {
 *       this.reverbNode.generate(...)   // <- synchronous, on the main thread
 *     }
 *
 * There is ONE reverb node PER ORBIT. Any hap whose room shape differs from
 * the previous hap ON THAT ORBIT rebuilds the whole impulse response: a
 * `roomsize(8)` IR is eight seconds of stereo noise, generated and filtered
 * inline. superdough's own comment names the pathological case —
 * "avoids endless regeneration on things like stack(s(a), s(b).rsize(8))" —
 * which is exactly a score whose lanes share an orbit and disagree.
 *
 * `.room()` is the SEND AMOUNT and is not part of the key; it never
 * regenerates and is deliberately not counted here. The regenerating controls
 * are roomsize/roomfade/roomlp/roomdim/irspeed/irbegin/ir, and only those.
 *
 * WHAT IT MEASURES. Every lane is built across the same feel/tension/section
 * sweep the rest of the suite uses, and the haps are replayed IN ONSET ORDER
 * PER ORBIT — which is what the runtime actually does, and is why counting
 * distinct values alone would understate it: two lanes alternating between two
 * room shapes rebuild on EVERY hap, not twice.
 *
 * THE FIX IS ORBITS, NOT UNIFORMITY. Each orbit owns a reverb, so lanes that
 * genuinely want different spaces can have them for the price of one IR each,
 * built once. Collapsing every lane onto a single roomsize also passes this
 * gate and costs the score its depth; that is the worse of the two ways.
 *
 *   node --experimental-transform-types tools/reverbchurn.mjs
 */
/*
 * Dynamic, and in this order, for the reason `tools/lib/ts.mjs` gives: Node's
 * resolver will not try `./math.ts` for a specifier written `./math`, and the
 * hook that teaches it to is registered by `headless-audio.mjs`. A STATIC
 * `import` of the game's modules is hoisted above that registration and fails
 * — which is exactly how this file failed on its first run.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const layers = await import('../src/audio/layers.ts');
const { buildChord } = await import('../src/audio/theory.ts');

/*
 * The controls superdough hashes the impulse response by. `room` is absent on
 * purpose — see the header. Taken from `getReverb`'s condition, not from
 * memory of the docs.
 */
const IR_KEYS = ['roomsize', 'roomfade', 'roomlp', 'roomdim', 'irspeed', 'irbegin', 'ir'];

const LANES = {
  sub: layers.buildSub,
  motor: layers.buildMotor,
  bass: layers.buildBass,
  chords: layers.buildChords,
  arp: layers.buildArp,
  lead: layers.buildLead,
  kick: layers.buildKick,
  clap: layers.buildClap,
  fx: layers.buildFx,
  motifs: layers.buildMotifs,
  power: layers.buildPowerupVoices,
};

function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  const degree = over.degree ?? 0;
  return {
    tension: 0.6,
    immediate: 0.5,
    section: 'sustain',
    buildProgress: 1,
    fillBar: false,
    bar: 0,
    tonic: 57,
    mode,
    chord: buildChord(57, mode, degree),
    nextChord: buildChord(57, mode, 4),
    chordIndex: 0,
    barInPhrase: 0,
    phrase: 2,
    feel: 'boomchick',
    bpm: 140,
    intensity: 0.6,
    brightness: 0.5,
    powerups: {},
    enemies: {},
    boss: false,
    bossPhase: 0,
    wave: 3,
    bombs: 0,
    health: 1,
    grazeRate: 0,
    combo: 0,
    leadRegister: 0,
    movement: null,
    sig: makeSignals(strudel, { thin: 0, openness: 0.5 }),
    ...over,
  };
}

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const TENSIONS = [0.35, 0.6, 0.85];
const SECTIONS = ['sustain', 'breakdown', 'build'];

const cases = [];
for (const feel of FEELS) {
  for (const tension of TENSIONS) {
    for (const section of SECTIONS) cases.push({ feel, tension, section });
  }
}

/*
 * One reverb node per orbit, and an absent `orbit` IS orbit 0 at the
 * superdough default — so it must not become a separate bucket, or a score
 * with no `.orbit()` call anywhere would look perfectly partitioned.
 */
const orbitOf = (h) => (h.orbit === undefined ? 0 : h.orbit);
const irKeyOf = (h) => IR_KEYS.map((k) => (h[k] === undefined ? '-' : String(h[k]))).join('|');
const carriesIr = (h) => IR_KEYS.some((k) => h[k] !== undefined);

let hapsSeen = 0;
let hapsWithIr = 0;
let barsBuilt = 0;
const perOrbit = new Map();
const regensPerBar = [];
const sizesSeen = new Set();

for (const c of cases) {
  for (let bar = 0; bar < 8; bar++) {
    const m = state({ ...c, barInPhrase: bar, bar });
    barsBuilt++;
    /*
     * Every lane's haps merged and sorted by onset: the runtime does not play
     * lanes one after another, it interleaves them, and the interleave is the
     * whole point of this measurement.
     */
    const all = [];
    for (const [lane, build] of Object.entries(LANES)) {
      let evs;
      try {
        evs = notesIn(build(m), 1);
      } catch (err) {
        throw new Error(
          `lane '${lane}' threw (${c.feel}/${c.section}/bar ${bar}): ${String(err).split('\n')[0]}`,
        );
      }
      for (const e of evs) all.push({ lane, ...e });
    }
    all.sort((a, b) => a.begin - b.begin);

    const last = new Map();
    let regensThisBar = 0;
    for (const h of all) {
      hapsSeen++;
      if (!carriesIr(h)) continue;
      hapsWithIr++;
      const o = orbitOf(h);
      const key = irKeyOf(h);
      if (h.roomsize !== undefined) sizesSeen.add(h.roomsize);
      if (!perOrbit.has(o)) perOrbit.set(o, { shapes: new Map(), regens: 0, haps: 0 });
      const rec = perOrbit.get(o);
      rec.haps++;
      if (!rec.shapes.has(key)) rec.shapes.set(key, { n: 0, lanes: new Set() });
      const sh = rec.shapes.get(key);
      sh.n++;
      sh.lanes.add(h.lane);
      if (last.get(o) !== undefined && last.get(o) !== key) {
        rec.regens++;
        regensThisBar++;
      }
      last.set(o, key);
    }
    regensPerBar.push(regensThisBar);
  }
}

const sum = regensPerBar.reduce((a, b) => a + b, 0);
const sorted = [...regensPerBar].sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

console.log(
  `states built: ${barsBuilt} bars over ${cases.length} cases ` +
    `(${FEELS.length} feels x ${TENSIONS.length} tensions x ${SECTIONS.length} sections)`,
);
console.log(
  `haps: ${hapsSeen} total, ${hapsWithIr} carrying a reverb-IR control ` +
    `(${((hapsWithIr / Math.max(1, hapsSeen)) * 100).toFixed(1)}%)`,
);
console.log(
  `distinct roomsize values in the score: ${[...sizesSeen].sort((a, b) => a - b).join(', ') || '(none)'}`,
);
console.log(
  `\nIR REBUILDS PER BAR: mean ${(sum / barsBuilt).toFixed(1)}  p50 ${p(0.5)}  ` +
    `p90 ${p(0.9)}  max ${sorted[sorted.length - 1]}`,
);

console.log(`\nper orbit:`);
for (const [o, rec] of [...perOrbit].sort((a, b) => a[0] - b[0])) {
  console.log(
    `  orbit ${o}: ${rec.shapes.size} distinct room shape(s), ${rec.haps} haps, ${rec.regens} rebuilds`,
  );
  for (const [key, sh] of [...rec.shapes].sort((a, b) => b[1].n - a[1].n)) {
    const parts = key.split('|');
    const shown = IR_KEYS.map((k, i) => (parts[i] === '-' ? null : `${k}=${parts[i]}`))
      .filter(Boolean)
      .join(' ');
    console.log(`      ${String(sh.n).padStart(6)} haps  ${shown.padEnd(34)} [${[...sh.lanes].sort().join(' ')}]`);
  }
}

/* ---- assertions ------------------------------------------------------- */
const fails = [];

/*
 * One shape per orbit is the whole rule: a reverb node nobody asks for a
 * different shape is never rebuilt, whatever that shape happens to be.
 */
for (const [o, rec] of perOrbit) {
  if (rec.shapes.size > 1) {
    fails.push(
      `orbit ${o} carries ${rec.shapes.size} distinct reverb-IR shapes; every hap that ` +
        `changes the shape rebuilds the impulse response synchronously on the main thread ` +
        `(superdoughoutput.mjs:69). Give the disagreeing lanes their own .orbit(), or settle ` +
        `on one shape.`,
    );
  }
}

/*
 * The consequence, asserted separately from the cause — so a future score that
 * somehow disagrees without churning is not failed for the wrong reason, and
 * so this stays red if the shape count is ever gamed.
 */
if (sum > 0) {
  fails.push(
    `${sum} impulse-response rebuilds across ${barsBuilt} bars (mean ` +
      `${(sum / barsBuilt).toFixed(1)}/bar). The budget is zero: an IR should be built once ` +
      `per orbit and never again.`,
  );
}

if (fails.length) {
  console.log(`\nFAIL`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nok — every orbit holds one reverb shape, so no IR is ever rebuilt mid-run`);
