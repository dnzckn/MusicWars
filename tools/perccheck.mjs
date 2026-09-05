/*
 * perccheck — is the drum programme actually intricate, displaced and additive?
 *
 * WHY THIS EXISTS. The owner asked for Aphex Twin, and the single most
 * identifiable mechanical property of that reference is the drum writing:
 * sixteenth and thirty-second figures with rolls and ratchets, ghost snares
 * between the backbeats, and grid positions that are deliberately a step early
 * or late. `percGrid` in `src/audio/layers.ts` is the attempt at it.
 *
 * Every one of those properties is a claim about ONSET POSITIONS, which is
 * exactly the class of claim that reads as true in the source and turns out
 * false in the output. This repository has the receipts: `buildHats` chose a
 * subdivision from a threshold and every hit moved on every step of the dial
 * (`retention`, 45% nested); `buildMotor` wrote five distinct articulations and
 * emitted one, because `sustain(0)` made written length inaudible
 * (`attackfloor`, 74/74/74 ms over 25,340 haps); the whole `hatLayer` /
 * `metal` group sat exported and CALLED FROM NOWHERE while the stem still
 * labelled `hats` was a pitched pulse. A grid is measurable and therefore has
 * no excuse to be unmeasured.
 *
 * WHAT IT ASSERTS. Six things, each with its denominator printed:
 *
 *   REACHES     `buildClap` actually emits hat haps — noise above the 7 kHz
 *               highpass — in ordinary play, and emits NONE under TIMEWARP,
 *               which is the one state the grid is deliberately silent in.
 *   DENSITY     onsets per bar respond to intensity. A grid whose density is
 *               the same when the screen is empty and when it is full is a
 *               loop, and this game's premise is that it is not one.
 *   DISPLACED   a real share of accent onsets land off the quarter note, and a
 *               real share of BARS start a sixteenth late. Both are trait 2.
 *   RATCHETS    thirty-second ratchets occur, and the fill bar always rolls.
 *   ADDITIVE    the grouping vocabulary is actually used, and a calm bar can
 *               only draw from the square end of it — the ladder is monotone,
 *               so getting busier can open the vocabulary and never close it.
 *   DISJOINT    the three hat layers never put two hits on the same instant.
 *               They share one noise source through one filter, so a collision
 *               is not a chord, it is 6 dB with no musical event in it.
 *
 * Plus the bell: every bell note must be a chord tone inside MIDI 81-92, which
 * is above the motor's 57-69 contract and above the lead's measured doubling,
 * so the percussion can state harmony without masking either.
 *
 * No browser. A Strudel pattern is a pure function from a timespan to events —
 * see `tools/lib/headless-audio.mjs`. This asks what notes exist and where,
 * never how loud they are; `capture` answers that.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSignals, notesIn, pc } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const { buildClap, percGrid } = await import('../src/audio/layers.ts');
const { KIT_NAMES } = await import('../src/audio/samples.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const MODES_TO_TEST = Object.keys(PROGRESSIONS);

/** A `MusicalState` good enough to build one bar with. */
function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  const tonic = over.tonic ?? 57;
  return {
    tension: 0.5,
    immediate: 0.5,
    section: 'sustain',
    buildProgress: 1,
    fillBar: false,
    bar: 0,
    tonic,
    mode,
    chord: buildChord(tonic, mode, over.degree ?? 0),
    nextChord: buildChord(tonic, mode, over.nextDegree ?? 4),
    chordIndex: 0,
    barInPhrase: 0,
    phrase: 0,
    feel: 'boomchick',
    bpm: 140,
    intensity: 0.5,
    brightness: 0.5,
    powerups: {},
    enemies: { pluck: 0, stutter: 0, arpeggiator: 0, glissando: 0, subdrop: 0, echo: 0, rush: 0, conductor: 0 },
    boss: false,
    bossPhase: 0,
    wave: 1,
    bombs: 0,
    health: 1,
    grazeRate: 0,
    combo: 0,
    leadRegister: 0,
    movement: null,
    /*
     * SIGNALS DERIVED FROM INTENSITY, not pinned to 0.5, and this is the whole
     * reason the density row below means anything.
     *
     * `percGrid` emits all sixteen steps in every bar by construction — that is
     * the nesting property `retention` exists to protect, and it means the
     * STRUCTURAL onset count is nearly flat and cannot answer "does this
     * respond to the game". What varies is the beds' gain, and a hat at gain 0
     * is not a quiet hat: `director.ts`'s `AUDIBLE_FLOOR` (0.0025 on
     * `gain * postgain`) drops the hap before superdough ever sees it, so it
     * costs no voice and makes no sound.
     *
     * The two mappings are copied from `director.ts:711-713` — `density` is
     * intensity remapped over 0.18-0.50 and `fill` over 0.58-0.82. A tool
     * holding its own copy of a constant lies the day it moves (AGENTS §3), so
     * this is checked against the director in `signalDrift` below rather than
     * trusted.
     */
    sig: makeSignals(strudel, {
      density: remap01(over.intensity ?? 0.5, 0.18, 0.5),
      fill: remap01(over.intensity ?? 0.5, 0.58, 0.82),
      ornament: remap01(over.intensity ?? 0.5, 0.68, 0.9),
    }),
    ...over,
  };
}

const remap01 = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/*
 * The three mappings above are copied out of the director, and a tool holding
 * its own copy of a constant lies the day it moves — `tools/contrast.mjs` did
 * exactly this with the field size and reported a total readability failure
 * that was entirely its own. There is no way to import them: they are closed
 * over inside `signal(() => ...)` expressions in the `MusicDirector`
 * constructor, so instantiating one would need a `World` and an `EventBus`.
 *
 * So the literals are read back out of the source and compared. This is a
 * source check and AGENTS §3 is right that source checks usually test the
 * prose — the exception is a numeric literal, which is the thing itself and
 * not a description of it. If the director's ladder is retuned this goes red
 * on the same commit instead of silently measuring the old game.
 */
const DIRECTOR = readFileSync(fileURLToPath(new URL('../src/audio/director.ts', import.meta.url)), 'utf8');
const EXPECT_SIGNALS = { density: [0.18, 0.5], ornament: [0.68, 0.9], fill: [0.58, 0.82] };
const signalDrift = [];
for (const [name, [lo, hi]] of Object.entries(EXPECT_SIGNALS)) {
  const m = new RegExp(`${name}:\\s*signal\\(\\(\\)\\s*=>\\s*clamp01\\(remap\\(this\\.intensity,\\s*([\\d.]+),\\s*([\\d.]+),`).exec(DIRECTOR);
  if (!m) signalDrift.push(`${name}: no intensity remap found in director.ts`);
  else if (Number(m[1]) !== lo || Number(m[2]) !== hi) {
    signalDrift.push(`${name}: director says ${m[1]}-${m[2]}, this tool assumes ${lo}-${hi}`);
  }
}

/* ------------------------------------------------------------------ sweep */

const EMPTY_FIELD = { pluck: 0, stutter: 0, arpeggiator: 0, glissando: 0, subdrop: 0, echo: 0, rush: 0, conductor: 0 };
const STUTTERS = [0, 4, 9];

const cases = [];
for (const feel of FEELS) {
  for (const mode of MODES_TO_TEST) {
    const prog = PROGRESSIONS[mode];
    for (let d = 0; d < prog.length; d++) {
      for (let bar = 0; bar < 8; bar++) {
        for (const intensity of [0.1, 0.35, 0.6, 0.85, 1]) {
          for (const stutter of STUTTERS) {
            cases.push({
              feel,
              mode,
              degree: prog[d][0],
              nextDegree: prog[(d + 1) % prog.length][0],
              bar,
              barInPhrase: bar,
              fillBar: bar === 7,
              intensity,
              phrase: bar % 3,
              wave: 1 + (d % 5),
              stutter,
              enemies: { ...EMPTY_FIELD, stutter },
            });
          }
        }
      }
    }
  }
}

/* --------------------------------------------------------- grid arithmetic */

const groupingUse = new Map();
const groupingByIntensity = new Map();
let bars = 0;
let shifted = 0;
let ratchetBars = 0;
let ratchetHits = 0;
let fillBars = 0;
let fillBarsWithRoll = 0;
let accentOnsets = 0;
let accentOffQuarter = 0;
let accentOffEighth = 0;
let ghostTotal = 0;
const densityByIntensity = new Map();

for (const c of cases) {
  const m = state(c);
  const g = percGrid(m);
  bars++;
  const key = g.grouping.join('+');
  groupingUse.set(key, (groupingUse.get(key) ?? 0) + 1);
  if (!groupingByIntensity.has(c.intensity)) groupingByIntensity.set(c.intensity, new Set());
  groupingByIntensity.get(c.intensity).add(key);

  if (g.shift === 1) shifted++;
  const rk = Object.keys(g.ratchets);
  if (rk.length) ratchetBars++;
  for (const k of rk) ratchetHits += g.ratchets[k] - 1;
  if (c.fillBar) {
    fillBars++;
    // A roll is a ratchet on every one of the last four steps.
    if ([12, 13, 14, 15].every((i) => (g.ratchets[i] ?? 1) > 1)) fillBarsWithRoll++;
  }

  for (const a of g.accents) {
    accentOnsets++;
    if (a % 4 !== 0) accentOffQuarter++;
    if (a % 2 !== 0) accentOffEighth++;
  }
  ghostTotal += g.ghosts.length;

  // Onsets a bar AS WRITTEN, counting a ratchet as the hits it produces. This
  // is deliberately near-flat: see the note on signals in `state`.
  const hits = (arr) => arr.reduce((n, i) => n + (g.ratchets[i] ?? 1), 0);
  const total = hits(g.accents) + hits(g.eighths) + hits(g.sixteenths) + g.ghosts.length + g.bells.length;
  const b = densityByIntensity.get(c.intensity) ?? { n: 0, sum: 0 };
  b.n++;
  b.sum += total;
  densityByIntensity.set(c.intensity, b);

  // Disjointness, at the step level. The hap-level version is below.
  const seen = new Set();
  for (const set of [g.accents, g.eighths, g.sixteenths]) {
    for (const i of set) {
      if (seen.has(i)) {
        console.log(`FAIL disjoint(steps): step ${i} claimed twice at ${c.feel}/${c.mode}/bar${c.bar}`);
        process.exit(1);
      }
      seen.add(i);
    }
  }
}

/* ---------------------------------------------------- the pattern it makes */

/*
 * A seventh of the sweep, not all of it, and the split is deliberate rather
 * than a shortcut.
 *
 * `percGrid` is arithmetic over integers, so the section above can afford the
 * whole space — 21,120 bars costs about a second. Building a `Pattern` and
 * querying it is three orders of magnitude dearer, and a gate nobody runs
 * because it takes ten minutes is a gate that is not in the suite. What is
 * thinned is the mode and degree space, which the hats do not read at all; the
 * bell does read the chord and its own denominator is printed below.
 *
 * SEVEN AND NOT SIX, and this was caught by a crash rather than by reading.
 * The two innermost loops are 5 intensities x 3 stutter counts = 15 cases, and
 * the first draft strided by 6 over what was then 12 — so it selected two
 * intensities at one stutter count and nothing else, while the comment here
 * claimed every intensity and stutter count was represented. It was a sampling
 * bias wearing a coverage claim, which is the shape AGENTS §6 keeps finding.
 * 7 is coprime with 15 and walks all fifteen residues, and the block directly
 * below asserts that rather than trusting it.
 */
const patternCases = cases.filter((_, i) => i % 7 === 0);

/*
 * COVERAGE IS A PRECONDITION, so it is checked HERE and not with the verdicts
 * at the bottom — and that ordering was itself established by a fail-test.
 *
 * When the stride was deliberately set to 15 to break this, the tool did not
 * report a coverage failure: it threw a TypeError out of the density table,
 * because `audibleByIntensity.get(0.85)` was `undefined` for an intensity the
 * sweep had never visited. A break that produces a stack trace instead of a
 * verdict is a check that only works when someone is watching, and every
 * number below is meaningless if the sample is short, so nothing else may run
 * until this holds.
 */
const seenFeels = new Set(patternCases.map((c) => c.feel));
const seenIntensity = new Set(patternCases.map((c) => c.intensity));
const seenStutter = new Set(patternCases.map((c) => c.stutter));
const coverage = `${seenFeels.size}/${FEELS.length} feels, ${seenIntensity.size}/5 intensities, ${seenStutter.size}/${STUTTERS.length} stutter counts`;
if (seenFeels.size !== FEELS.length || seenIntensity.size !== 5 || seenStutter.size !== STUTTERS.length) {
  console.log(`FAIL pattern sweep covers only ${coverage} of the space it claims`);
  process.exit(1);
}

/*
 * Hat haps, in BOTH kits (2026-09-05).
 *
 * The kit is sampled now (`src/audio/samples.ts`): in Node the builders emit
 * the written score, which is the three 909/LinnDrum hat names, and under
 * `MUSICWARS_KIT=fallback` they emit the white noise behind the 7 kHz
 * highpass `hatLayer` sets. The three names are checked against the sample
 * table so a renamed sample goes red here rather than quietly counting zero
 * hats — which is exactly what happened the day the kit landed: 3772 of 3772
 * bars "had no hat at all" while every one of them had eight.
 *
 * The fallback rule also requires `hatLayer`'s constant 10.5 kHz lowpass,
 * because the shaker's oscillator body (`kit.ts shaker`) is ALSO white noise
 * above 7 kHz — through a 12 kHz lowpass — and it sits on every eighth,
 * where the bed also sits. Two different DRUMS on one instant is the
 * reference's own layering (`<- hh>*8` over `<sh>*8`), not the collision the
 * DISJOINT assertion is about; the lowpass is what tells them apart.
 */
const SAMPLED_HATS = new Set(['mw_hh909', 'mw_hhlinn', 'mw_oh909']);
for (const n of SAMPLED_HATS) {
  if (!KIT_NAMES.includes(n)) {
    console.log(`FAIL perccheck counts "${n}" as a hat but samples.ts has no such sample`);
    process.exit(1);
  }
}
const isHat = (e) =>
  SAMPLED_HATS.has(e.s) || (e.s === 'white' && Number(e.hcutoff) >= 7000 && Number(e.cutoff) === 10500);
/** The off-beat bed specifically: `percLayers` pans it at 0.44 and nothing else does. */
const isBed = (e) => isHat(e) && Number(e.pan) === 0.44;
/** Bell haps: the FM triangle `metal` builds. */
const isBell = (e) => e.s === 'triangle' && Number(e.fmh) > 0;

/*
 * The floor `director.applyAudibleFloor` uses, so this counts the haps that
 * REACH superdough rather than the haps that were written. A hat at gain 0 is
 * not a quiet hat; it is a hap the director drops.
 */
const AUDIBLE_FLOOR = 0.0025;
const audible = (e) => (typeof e.gain === 'number' ? e.gain : 1) * (typeof e.velocity === 'number' ? e.velocity : 1) >= AUDIBLE_FLOOR;

let hatHaps = 0;
let hatBars = 0;
let hatCollisions = 0;
let bellNotes = 0;
let bellBad = 0;
let timewarpHats = 0;
let timewarpBars = 0;
const audibleByIntensity = new Map();

let patternBars = 0;
for (const c of patternCases) {
  const m = state(c);
  patternBars++;
  const evs = notesIn(buildClap(m), 1);
  const hats = evs.filter(isHat);
  hatHaps += hats.length;
  if (hats.length) hatBars++;

  const ab = audibleByIntensity.get(c.intensity) ?? { n: 0, sum: 0, kit: 0, bed: 0, bedGain: 0, bedBars: 0 };
  ab.n++;
  ab.sum += hats.filter(audible).length;
  ab.kit += evs.filter(audible).length;
  // The off-beat bed: how many of its hits are audible, and at what written
  // gain. Both are the response the density assertion reads now.
  const bed = hats.filter(isBed).filter(audible);
  ab.bed += bed.length;
  if (bed.length) {
    ab.bedBars++;
    ab.bedGain += bed.reduce((a, h) => a + Number(h.gain), 0) / bed.length;
  }
  audibleByIntensity.set(c.intensity, ab);

  // Two hits at the same instant in one bar, from the same noise source.
  const at = new Map();
  for (const h of hats) {
    const t = Math.round(h.begin * 32 * 1000) / 1000;
    at.set(t, (at.get(t) ?? 0) + 1);
  }
  for (const n of at.values()) if (n > 1) hatCollisions += n - 1;

  const chordPcs = new Set(m.chord.notes.map(pc));
  for (const b of evs.filter(isBell)) {
    const n = Number(b.note);
    if (!Number.isFinite(n)) continue;
    bellNotes++;
    if (n < 81 || n > 92 || !chordPcs.has(pc(n))) bellBad++;
  }

  // Every sixth of the pattern sweep again: TIMEWARP takes an early return in
  // `buildClap`, so it has one behaviour and does not need the whole space.
  if (patternBars % 6 === 0) {
    const tw = notesIn(buildClap(state({ ...c, powerups: { timewarp: 1 } })), 1);
    timewarpBars++;
    timewarpHats += tw.filter(isHat).length;
  }
}

/* ------------------------------------------------------------------ report */

const pctOf = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);

console.log(
  `perccheck — ${bars} grid bars swept (${FEELS.length} feels x ${MODES_TO_TEST.length} modes x 8 bars x 5 intensities x ${STUTTERS.length} stutter counts); ${patternBars} of them built as patterns\n`,
);

console.log('  REACHES');
console.log(`    hat haps                 ${hatHaps} over ${patternBars} bars (${(hatHaps / Math.max(1, patternBars)).toFixed(1)}/bar)`);
console.log(`    bars with any hat        ${hatBars}/${patternBars}  ${pctOf(hatBars, patternBars)}`);
console.log(`    hat haps under TIMEWARP  ${timewarpHats} over ${timewarpBars} bars`);

console.log('\n  DENSITY (per bar; written = the grid, audible = past AUDIBLE_FLOOR)');
console.log('    intensity   written  audible hats  whole kit  bed hits  bed gain   bars');
for (const k of [...densityByIntensity.keys()].sort((a, b) => a - b)) {
  const b = densityByIntensity.get(k);
  const a = audibleByIntensity.get(k);
  console.log(
    `      ${k.toFixed(2)}      ${(b.sum / b.n).toFixed(2).padStart(6)}  ${(a.sum / a.n).toFixed(2).padStart(12)}  ${(a.kit / a.n).toFixed(2).padStart(9)}  ${(a.bed / a.n).toFixed(2).padStart(8)}  ${(a.bedBars ? a.bedGain / a.bedBars : 0).toFixed(3).padStart(8)}  ${String(b.n).padStart(5)}`,
  );
}

console.log('\n  DISPLACED');
console.log(`    bars starting a 16th late ${shifted}/${bars}  ${pctOf(shifted, bars)}`);
console.log(`    accent onsets off the 1/4 ${accentOffQuarter}/${accentOnsets}  ${pctOf(accentOffQuarter, accentOnsets)}`);
console.log(`    accent onsets off the 1/8 ${accentOffEighth}/${accentOnsets}  ${pctOf(accentOffEighth, accentOnsets)}`);

console.log('\n  RATCHETS');
console.log(`    bars with a ratchet      ${ratchetBars}/${bars}  ${pctOf(ratchetBars, bars)}`);
console.log(`    extra 32nd hits          ${ratchetHits}`);
console.log(`    fill bars that roll      ${fillBarsWithRoll}/${fillBars}`);
console.log(`    ghost snares             ${ghostTotal} over ${bars} bars (${(ghostTotal / Math.max(1, bars)).toFixed(2)}/bar)`);

console.log('\n  ADDITIVE');
for (const [k, n] of [...groupingUse.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(16)} ${n}  ${pctOf(n, bars)}`);
}
for (const k of [...groupingByIntensity.keys()].sort((a, b) => a - b)) {
  console.log(`    intensity ${k.toFixed(2)} vocabulary ${groupingByIntensity.get(k).size}`);
}

console.log('\n  DISJOINT / BELL');
console.log(`    hat onsets sharing an instant ${hatCollisions}`);
console.log(`    bell notes                    ${bellNotes}, out of contract ${bellBad}`);

/* ---------------------------------------------------------------- verdicts */

const fails = [...signalDrift];
const req = (ok, msg) => { if (!ok) fails.push(msg); };
console.log(`    signal ladder vs director.ts  ${signalDrift.length === 0 ? 'agrees' : 'DRIFTED'} (3 mappings checked)`);

// Checked before anything was measured; printed here so the report carries it.
console.log(`    pattern sweep covers ${coverage}`);

// Every denominator must be non-zero. Zero and clean look identical otherwise.
req(bars > 0, 'swept 0 bars');
req(accentOnsets > 0, 'counted 0 accent onsets');
req(fillBars > 0, 'swept 0 fill bars');
req(bellNotes > 0, 'the bell never sounded — 0 notes over the whole sweep');

req(hatHaps > 0, 'the hat grid emits nothing from buildClap');
req(hatBars === patternBars, `${patternBars - hatBars} of ${patternBars} bars have no hat at all`);
req(timewarpHats === 0, `TIMEWARP emitted ${timewarpHats} hat haps; the grid is meant to be silent there`);

/*
 * The AUDIBLE column, not the written one. The written count is flat on
 * purpose — that is the nesting property — so asserting on it would be a gate
 * satisfied by construction, which AGENTS §3 names as the failure mode to
 * design against. The audible count is what a listener is handed.
 */
const lo = audibleByIntensity.get(0.1);
const hi = audibleByIntensity.get(0.85);
/*
 * REPLACED, NOT RELAXED (2026-09-05). This read `audible hats at 0.85 > 2 x
 * audible hats at 0.10`, and the design it measured is gone on purpose: the
 * off-beat bed is FLOORED at written 0.35 in build/drop/sustain
 * (`percLayers`, from the owner's reference B — `<- hh>*8` is the one hat
 * line that never leaves), so a calm bar now has the bed as well as the
 * accents and the ratio is about 1.1, not 2. The response moved from COUNT
 * to LEVEL, and the three assertions below are the stronger statement of
 * it: the bed is heard in every calm bar (new), its written gain rises with
 * intensity (new), and the whole kit's audible count still rises (kept, as a
 * floor of +2 hits rather than a doubling).
 */
req(lo.sum / lo.n >= 3, `a calm bar has only ${(lo.sum / lo.n).toFixed(2)} audible hats — the accent figure should always sound`);
req(lo.bedBars === lo.n, `${lo.n - lo.bedBars} of ${lo.n} calm sustain bars have no audible off-beat bed — the floor is not holding`);
req(
  hi.bedBars > 0 && lo.bedBars > 0 && hi.bedGain / hi.bedBars > lo.bedGain / lo.bedBars + 0.05,
  `the bed's written gain does not rise with intensity: ${(lo.bedBars ? lo.bedGain / lo.bedBars : 0).toFixed(3)} at 0.10 vs ${(hi.bedBars ? hi.bedGain / hi.bedBars : 0).toFixed(3)} at 0.85`,
);
req(
  hi.kit / hi.n >= lo.kit / lo.n + 2,
  `the kit's audible count does not respond to intensity: ${(lo.kit / lo.n).toFixed(2)} at 0.10 vs ${(hi.kit / hi.n).toFixed(2)} at 0.85`,
);

req(shifted / bars > 0.1 && shifted / bars < 0.45, `displaced-bar share ${pctOf(shifted, bars)} outside 10-45%`);
req(accentOffQuarter / accentOnsets > 0.35, `only ${pctOf(accentOffQuarter, accentOnsets)} of accents land off the quarter`);

/*
 * REPLACED, NOT RELAXED (2026-09-05): `ratchetBars / bars > 0.4` became
 * `ratchetBars === fillBars`. The per-bar ratchets are gone (`percGrid`'s
 * tombstone: the references carry none outside a fill, and one to three a
 * bar was part of "cheapy"), so the claim is now exact in both directions —
 * every fill bar ratchets and no other bar does. A ratchet creeping back onto
 * an ordinary bar is red here, which the old threshold could never see.
 */
req(ratchetBars === fillBars, `${ratchetBars} bars carry a ratchet against ${fillBars} fill bars — ratchets belong on the fill bar and nowhere else`);
req(fillBarsWithRoll === fillBars, `${fillBars - fillBarsWithRoll} fill bars did not roll`);
req(ghostTotal / bars >= 2, `ghost snares average ${(ghostTotal / bars).toFixed(2)} a bar`);

req(groupingUse.size >= 5, `only ${groupingUse.size} of the 8 additive groupings ever occur`);
const calm = groupingByIntensity.get(0.1);
const busy = groupingByIntensity.get(0.85);
req(calm.size < busy.size, `the grouping vocabulary does not open with intensity: ${calm.size} at 0.10, ${busy.size} at 0.85`);
req([...calm].every((k) => busy.has(k)), 'the vocabulary is not monotone — a calm grouping is unavailable when busy');

req(hatCollisions === 0, `${hatCollisions} hat onsets share an instant with another hat`);
req(bellBad === 0, `${bellBad} of ${bellNotes} bell notes are outside 81-92 or not a chord tone`);

console.log('');
if (fails.length) {
  for (const f of fails) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log('perccheck OK');
