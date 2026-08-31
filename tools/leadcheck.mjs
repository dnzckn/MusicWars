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
 * The checks:
 *
 *   VIBRATO   Every lead note carries a non-zero `vib` rate and a `vibmod`
 *             depth. Vibrato is what makes a held note sound sung rather than
 *             generated, and the score had none anywhere until it was added.
 *
 *   COUPLING  Depth tracks how long the note is held. LASER and a SOLOIST wave
 *             lengthen the note and open the vibrato as ONE gesture; if they
 *             ever drift apart, a long note gets a short note's vibrato and the
 *             expressive link is gone.
 *
 *   DEPTH     Depth stays inside 0.05-0.40 semitones. Above about 0.5 the pitch
 *             stops reading as one note and the melody goes out of tune with
 *             the harmony under it. superdough's own default is 0.5, so a
 *             dropped `.vibmod()` lands squarely in the bad range — which is
 *             exactly why this bound is asserted rather than assumed.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const { buildLead } = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

const DEPTH_MIN = 0.05;
const DEPTH_MAX = 0.4;
/*
 * THE BOSS-DEPTH CLAUSE IS RETIRED, and this says which of the two it is.
 *
 * It asserted that the boss lead must be measurably MORE out of tune than the
 * ordinary one — written to protect the Lavender Town treatment from being
 * quietly softened, and it did its job: it caught a Math.max that broke the
 * sustain coupling, and it was seen red by zeroing the effect.
 *
 * The treatment is gone at the owner's word — "lol the lavendar town boss fight
 * is so awful lets just forget about that spec" — so this is a gate whose
 * SUBJECT no longer exists, not a gate being relaxed to let a defect through.
 * Keeping it would mean asserting a property nothing is trying to have, which
 * is how a suite fills with checks nobody can satisfy or delete.
 *
 * The two assertions that outlive it — every note carries both a rate and a
 * depth, and depth rises with note length — are unchanged and still cover the
 * lane. The depth window is one number again because there is one behaviour
 * again.
 */

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
    sig: makeSignals(strudel),
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
      cases.push({ mode, barInPhrase, phrase: 2, ...extra });
    }
  }
}

let notes = 0;
const noVib = [];
const badDepth = [];
const plainDepths = [];
/*
 * [length, depth] for the coupling check.
 *
 * IT WAS [sustain, depth] AND THAT WENT DEAD WITHOUT FAILING, which is the
 * failure mode AGENTS.md 3 names: "a check with five assertions can pass its
 * own fail-test on the strength of one while the rest are dead."
 *
 * `buildLead`'s `held` used to be written into `.sustain()`, so the note-length
 * dial and the sustain LEVEL were the same control. `articulation.ts` separated
 * them: sustain is now a property of the touch (0.58-0.50, the same on every
 * lead note) and LENGTH is `clip`, which is what `held` drives. The coupling
 * itself — a longer note gets more vibrato — is unchanged and is exactly as
 * real as it was; this file was reading the wrong column, and the symptom was a
 * "--   only one sustain value seen; nothing to compare" line rather than a
 * failure. A gate that reports "nothing to compare" is a gate that has stopped
 * being one.
 *
 * `clip` is also the STRONGER column to read. It is the control that literally
 * says how long the note is; sustain was only ever a proxy for it, and a proxy
 * that a change of design could silently break, as this one did.
 */
const pairs = []; // [clip, depth]

for (const c of cases) {
  const evs = notesIn(buildLead(state(c)), 1);
  notes += evs.length;
  for (const e of evs) {
    if (!(e.vib > 0) || !(e.vibmod > 0)) noVib.push({ ...c, vib: e.vib, vibmod: e.vibmod });
    else if (e.vibmod < DEPTH_MIN || e.vibmod > DEPTH_MAX) badDepth.push({ ...c, vibmod: e.vibmod });
    // Coupling is a property of ONE state's sustain curve. Mixing the boss in
    // compares two different curves and reports their difference as a failure.
    if (typeof e.clip === 'number' && typeof e.vibmod === 'number') {
      pairs.push([Number(e.clip.toFixed(4)), e.vibmod]);
      plainDepths.push(e.vibmod);
    }
  }
}

console.log(`leadcheck — ${cases.length} states, ${notes} note events\n`);
let failed = false;

if (notes === 0) {
  // A harness that measures nothing passes everything. See the note about
  // `miniAllStrings` in `lib/headless-audio.mjs`.
  console.log('  FAIL  the lead produced no notes at all — is the harness parsing mini-notation?');
  process.exit(1);
}

if (noVib.length) {
  failed = true;
  console.log(`  VIBRATO — ${noVib.length} note(s) with no vibrato:`);
  const seen = new Set();
  for (const v of noVib) {
    const k = `${v.mode}/bar${v.barInPhrase}  vib=${v.vib} vibmod=${v.vibmod}`;
    if (!seen.has(k) && seen.size < 6) console.log(`    ${k}`), seen.add(k);
  }
} else {
  console.log('  ok   vibrato — every lead note carries both a rate and a depth');
}

if (badDepth.length) {
  failed = true;
  const lo = Math.min(...badDepth.map((v) => v.vibmod));
  const hi = Math.max(...badDepth.map((v) => v.vibmod));
  console.log(`\n  DEPTH — ${badDepth.length} note(s) outside ${DEPTH_MIN}-${DEPTH_MAX} (${lo}-${hi})`);
} else {
  console.log(`  ok   depth — every ordinary note inside ${DEPTH_MIN}-${DEPTH_MAX} semitones`);
}

/*
 * Coupling: longer notes must get deeper vibrato. Checked as a monotone
 * relation over the distinct (sustain, depth) pairs actually produced, rather
 * than by asserting a formula — the formula is allowed to change, the
 * expressive link is not.
 */
const distinct = [...new Map(pairs.map((p) => [p[0], p[1]])).entries()].sort((a, b) => a[0] - b[0]);
const monotone = distinct.every(([, d], i) => i === 0 || d >= distinct[i - 1][1]);
/*
 * FEWER THAN TWO LENGTHS IS A FAILURE, not a shrug. The lead's whole expressive
 * premise is that LASER and a SOLOIST wave lengthen the note AND open the
 * vibrato as one gesture; if the sweep only ever produces one note length,
 * either the states below stopped exercising it or the coupling has been
 * removed, and both of those are things this file exists to catch. It printed
 * `--` for exactly one build of this repo and that build had a dead assertion.
 */
if (distinct.length < 2) {
  failed = true;
  console.log(
    `\n  COUPLING — only ${distinct.length} distinct note length(s) over ${pairs.length} notes; ` +
      'nothing to compare, which means this assertion measured nothing.',
  );
} else if (!monotone) {
  failed = true;
  console.log(
    `\n  COUPLING — depth does not rise with note length: ${distinct.map(([s, d]) => `${s}->${d.toFixed(3)}`).join('  ')}`,
  );
} else {
  console.log(
    `  ok   coupling — depth rises with note length (clip): ${distinct.map(([s, d]) => `${s}->${d.toFixed(3)}`).join('  ')}`,
  );
}

console.log(failed ? '\nLEAD IS OUT OF SPEC' : '\nLEAD HOLDS — the melody is articulated, not just pitched');
process.exit(failed ? 1 : 0);
