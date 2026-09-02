/*
 * leadcheck — does the melody carry the controls it is supposed to carry?
 *
 * This guards one specific failure mode, which has now bitten this project
 * twice: a control that is chained onto a pattern, reads perfectly in review,
 * type-checks, and does nothing. `.pw()` was undeclared and would have compiled
 * to nothing across three lanes. `.vibmod()` is silently inert unless `.vib()`
 * is also set. Neither is visible in a diff, and neither makes a sound you can
 * miss — the lane just quietly loses a dimension.
 *
 * WHAT THIS GATE USED TO ASSERT, AND WHY IT WAS REPLACED RATHER THAN RELAXED.
 *
 * The first version asserted VIBRATO on every lead note, a DEPTH window for
 * it, and COUPLING of that depth to note length. All three were about one
 * gesture, and that gesture is gone by design: `docs/research-dubstep.md`
 * §6.1 — vibrato is an acoustic-instrument mannerism no dubstep lead has, and
 * it is the thing that made a triangle at A4 read as "a woodwind in a video
 * game". The lead's `.vib().vibmod()` were removed with that finding.
 *
 * The old assertions were seen red on the new tree before being replaced:
 * VIBRATO failed on every note and COUPLING reported "0 distinct note
 * length(s) over 0 notes — measured nothing", because it built its pairs from
 * `vibmod`. A gate whose SUBJECT no longer exists is not a gate being relaxed;
 * keeping it would mean asserting a property nothing is trying to have.
 *
 * What the lane is supposed to carry NOW — the genre's lead recipe, research
 * §6.2, the fifth re-voicing and the first to move away from sweet:
 *
 *   NOTES      The lead produces notes at all, across every state swept.
 *   NO VIBRATO No lead note carries `vib`/`vibmod`. The inverse of the old
 *              check, asserted so a well-meaning "add expression" cannot
 *              quietly put the woodwind back.
 *   SATURATED  Every tune/decoration note (the pulse body) carries the diode
 *              saturation: distorttype 'diode', distort 0.8, distortvol 0.75.
 *              This is the "a dubstep lead is saturated" half of the recipe,
 *              and a dropped chain here is exactly the inert-control defect
 *              this file exists for.
 *   BAND       The body's cutoff stays inside 1400-3200 Hz across the whole
 *              openness sweep (0 and 1): mid-focused, not the 1.9-5 kHz air
 *              the triangle sat in.
 *   WIDTH      A supersaw width layer — unison 5, detune 0.5, spread 0.9,
 *              CLEAN (distort 0) — sounds on every bar the body sounds on.
 *              The support must never be saturated: it is width, not a
 *              second line.
 *   BOSS BODY  The boss's octave-down sawtooth stays clean and in its darker
 *              500-1400 band. It is a body, not a lead, and saturating it
 *              would put the crunch on the wrong voice.
 *
 * Every count prints its denominator.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const { buildLead } = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

const BAND_LO = 1400;
const BAND_HI = 3200;
const BODY_LO = 500;
const BODY_HI = 1400;
const SAT = { distorttype: 'diode', distort: 0.8, distortvol: 0.75 };
const WIDTH = { unison: 5, detune: 0.5, spread: 0.9 };

function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  return {
    tension: 0.6,
    immediate: 0.5,
    section: 'sustain',
    buildProgress: 1,
    fillBar: false,
    bar: 0,
    tonic: 57,
    mode,
    chord: buildChord(57, mode, over.degree ?? 0),
    nextChord: buildChord(57, mode, 4),
    chordIndex: 0,
    barInPhrase: over.barInPhrase ?? 0,
    phrase: over.phrase ?? 0,
    feel: 'boomchick',
    bpm: 140,
    intensity: 0.6,
    brightness: 0.5,
    powerups: {},
    enemies: {},
    boss: false,
    bossPhase: 0,
    wave: over.wave ?? 1,
    bombs: 0,
    health: 1,
    grazeRate: 0,
    combo: 0,
    leadRegister: 0,
    movement: null,
    sig: makeSignals(strudel, over.sigOver ?? {}),
    ...over,
  };
}

const cases = [];
for (const mode of Object.keys(PROGRESSIONS)) {
  for (let barInPhrase = 0; barInPhrase < 8; barInPhrase++) {
    for (const extra of [
      {},
      { powerups: { laser: 1 } },
      { powerups: { laser: 3 } },
      { movement: 'elite' },
      { boss: true, bossPhase: 1 },
    ]) {
      // Both ends of the openness sweep, because BAND is a range claim.
      for (const openness of [0, 1]) cases.push({ mode, barInPhrase, phrase: 2, ...extra, sigOver: { openness } });
    }
  }
}

let notes = 0;
let bodyNotes = 0;
let widthNotes = 0;
let bossBodyNotes = 0;
let barsWithBody = 0;
let barsWithBodyAndWidth = 0;
const withVib = [];
const unsaturated = [];
const outOfBand = [];
const badWidth = [];
const dirtyBoss = [];
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-6;

for (const c of cases) {
  const evs = notesIn(buildLead(state(c)), 1);
  notes += evs.length;
  const body = evs.filter((e) => e.s === 'pulse');
  const width = evs.filter((e) => e.s === 'supersaw');
  const bossBody = evs.filter((e) => e.s === 'sawtooth');
  bodyNotes += body.length;
  widthNotes += width.length;
  bossBodyNotes += bossBody.length;
  if (body.length) {
    barsWithBody++;
    if (width.length) barsWithBodyAndWidth++;
  }
  for (const e of evs) {
    if (e.vib !== undefined || e.vibmod !== undefined) withVib.push({ ...c, s: e.s, vib: e.vib, vibmod: e.vibmod });
  }
  for (const e of body) {
    if (e.distorttype !== SAT.distorttype || !near(e.distort, SAT.distort) || !near(e.distortvol, SAT.distortvol)) {
      unsaturated.push({ ...c, distorttype: e.distorttype, distort: e.distort, distortvol: e.distortvol });
    }
    if (typeof e.cutoff !== 'number' || e.cutoff < BAND_LO - 1 || e.cutoff > BAND_HI + 1) outOfBand.push({ ...c, cutoff: e.cutoff });
  }
  for (const e of width) {
    if (!near(e.unison, WIDTH.unison) || !near(e.detune, WIDTH.detune) || !near(e.spread, WIDTH.spread) || !(e.distort === undefined || near(e.distort, 0))) {
      badWidth.push({ ...c, unison: e.unison, detune: e.detune, spread: e.spread, distort: e.distort });
    }
  }
  for (const e of bossBody) {
    if (!(e.distort === undefined || near(e.distort, 0)) || typeof e.cutoff !== 'number' || e.cutoff < BODY_LO - 1 || e.cutoff > BODY_HI + 1) {
      dirtyBoss.push({ ...c, distort: e.distort, cutoff: e.cutoff });
    }
  }
}

const describe = (v) => `${v.mode}/bar${v.barInPhrase}${v.boss ? '/boss' : ''}${v.movement ? '/' + v.movement : ''} openness=${v.sigOver?.openness}`;
const sample = (list, fmt) => {
  const seen = new Set();
  for (const v of list) {
    const k = `${describe(v)}  ${fmt(v)}`;
    if (!seen.has(k) && seen.size < 6) console.log(`    ${k}`), seen.add(k);
  }
};

console.log(`leadcheck — ${cases.length} states, ${notes} note events (body ${bodyNotes}, width ${widthNotes}, boss body ${bossBodyNotes})\n`);
let failed = false;
if (notes === 0) {
  console.log('  FAIL  the lead produced no notes at all — is the harness parsing mini-notation?');
  process.exit(1);
}
if (bodyNotes === 0) {
  failed = true;
  console.log('  FAIL  no pulse body notes at all — the tune is not on the pulse this file expects (denominator for SATURATED/BAND is zero)');
}

if (withVib.length) {
  failed = true;
  console.log(`  NO VIBRATO — ${withVib.length} of ${notes} lead note(s) carry vib/vibmod; the lead has none by design (research §6.1):`);
  sample(withVib, (v) => `s=${v.s} vib=${v.vib} vibmod=${v.vibmod}`);
} else {
  console.log(`  ok   no vibrato — 0 of ${notes} lead notes carry vib or vibmod`);
}

if (unsaturated.length) {
  failed = true;
  console.log(`  SATURATED — ${unsaturated.length} of ${bodyNotes} body note(s) missing the diode chain (want distorttype ${SAT.distorttype}, distort ${SAT.distort}, distortvol ${SAT.distortvol}):`);
  sample(unsaturated, (v) => `distorttype=${v.distorttype} distort=${v.distort} distortvol=${v.distortvol}`);
} else {
  console.log(`  ok   saturated — ${bodyNotes} of ${bodyNotes} body notes carry diode 0.8 with postgain 0.75`);
}

if (outOfBand.length) {
  failed = true;
  console.log(`  BAND — ${outOfBand.length} of ${bodyNotes} body note(s) with cutoff outside ${BAND_LO}-${BAND_HI} Hz:`);
  sample(outOfBand, (v) => `cutoff=${v.cutoff}`);
} else {
  console.log(`  ok   band — ${bodyNotes} of ${bodyNotes} body notes inside ${BAND_LO}-${BAND_HI} Hz across openness 0 and 1`);
}

if (badWidth.length || barsWithBodyAndWidth < barsWithBody) {
  failed = true;
  if (badWidth.length) {
    console.log(`  WIDTH — ${badWidth.length} of ${widthNotes} width note(s) off spec (want unison ${WIDTH.unison}, detune ${WIDTH.detune}, spread ${WIDTH.spread}, clean):`);
    sample(badWidth, (v) => `unison=${v.unison} detune=${v.detune} spread=${v.spread} distort=${v.distort}`);
  }
  if (barsWithBodyAndWidth < barsWithBody) {
    console.log(`  WIDTH — the width layer sounds on ${barsWithBodyAndWidth} of ${barsWithBody} bars the body sounds on (want all)`);
  }
} else {
  console.log(`  ok   width — supersaw unison 5 / detune 0.5 / spread 0.9, clean, on ${barsWithBodyAndWidth} of ${barsWithBody} body bars`);
}

if (dirtyBoss.length) {
  failed = true;
  console.log(`  BOSS BODY — ${dirtyBoss.length} of ${bossBodyNotes} boss body note(s) saturated or out of ${BODY_LO}-${BODY_HI} Hz:`);
  sample(dirtyBoss, (v) => `distort=${v.distort} cutoff=${v.cutoff}`);
} else {
  console.log(`  ok   boss body — ${bossBodyNotes} of ${bossBodyNotes} octave-down sawtooth notes clean and inside ${BODY_LO}-${BODY_HI} Hz`);
}

console.log(failed ? '\nLEAD IS OUT OF SPEC' : '\nLEAD HOLDS — a saturated, mid-focused body with clean width behind it, and no vibrato');
process.exit(failed ? 1 : 0);
