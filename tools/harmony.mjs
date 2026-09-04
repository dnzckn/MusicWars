/*
 * harmony — is the chord a SEVENTH CHORD, or a triad with something twinkling
 * over it?
 *
 * WHY THIS EXISTS. `theory.ts` built every chord in this game as `[0, 2, 4]` —
 * root, third, fifth — and kept the 7th and the 9th in a separate field whose
 * own comment conceded what they were: "a gain the caller rides, not a note
 * list". They were rendered by a different instrument, an octave above the pad,
 * at a level a signal faded in and out. A listener does not hear a Dm7 from
 * that; they hear D minor with a twinkle.
 *
 * Nothing measured it, because nothing could: `clash.mjs` holds its own copy of
 * `[0, 2, 4]` (line 188) and would go on scoring against triads however the
 * chord was built, and `motorcheck`'s harmony assertion reads `chord.notes`, so
 * the day the chord grew a fourth member that assertion would have quietly
 * started ADMITTING MORE NOTES — a gate relaxing itself with no diff. This tool
 * exists so the extension is a measured property rather than a comment.
 *
 * WHAT IT ASSERTS, and every one of them off the built object or the emitted
 * haps rather than off the source text:
 *
 *   SEVENTH     Every chord the nine modes can produce over their own
 *               progressions carries exactly one structural tension, and its
 *               interval from the root is a seventh (9, 10 or 11 semitones).
 *
 *   PARTITION   `voiceLead` re-octaves and re-sorts everything, so after
 *               voicing there is no positional way to tell a seventh from a
 *               fifth. `core` and `tensions` must still partition `notes`
 *               exactly — three triad tones and one extension, nothing lost,
 *               nothing invented.
 *
 *   GUIDE TONES The stab plays the third and the seventh and drops the root
 *               and the fifth. That is not a preference, it is a dictionary:
 *               `@strudel/tonal` ships one called `guidetones`, and this tool
 *               IMPORTS IT rather than restating it, per AGENTS.md §3 ("a tool
 *               holding its own copy of a constant will lie the day it moves").
 *               Every quality our modes produce is compared against the
 *               package's own answer.
 *
 *   REGISTER    The stab's window is absolute (64-76). A five-note voiced
 *               stack was measured pushing `voiceLead`'s top voice to MIDI
 *               76-78 in six of nine modes — the melody's own register — which
 *               is why the ninth is played HERE, folded, instead of inside the
 *               pad's voicing where it could climb.
 *
 *   NINTH       In the acts that unlock it, the stab's pair becomes the
 *               seventh and the ninth. Voice count does not change: two before,
 *               two after, so the reserved material costs no onsets. That is
 *               checked, because "add the ninth" is exactly the change that
 *               would otherwise pay for harmony in transients — see the note in
 *               `buildChords` recording the 46,464 -> 69,696 hap regression that
 *               got a previous version of this idea reverted.
 *
 * HOW IT COULD BE GAMED, and the answer. By adding a seventh nobody can hear —
 * so the guide-tone assertion is about the STAB, the lane that states the
 * chord's quality in the register a listener follows, and not about the pad,
 * which drops everything but the root and the fifth whenever the melody is
 * sounding. And every denominator is printed: `checked === 0` fails.
 */
import { makeSignals, notesIn, pc } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
// Importing the package for its side effect as well as its data: `voicing`,
// `dict` and `anchor` are registered onto Pattern.prototype at import time and
// do not exist without it. `src/` does not import it (see the note in
// `theory.ts` on why the voicing is built in MIDI instead), so this is the only
// place in the repo that holds the package to its word.
const tonal = await import('@strudel/tonal');
const { buildChords, VOICE_TAGS } = await import('../src/audio/layers.ts');
const { buildChord, voiceLead, PROGRESSIONS, degreeToSemitone, extensionSemitone, LANE_RANGE } = await import(
  '../src/audio/theory.ts'
);

/*
 * IMPORTED, NOT RESTATED — and the old pair of literals had made the register
 * assertion VACUOUS, which is a worse failure than being wrong.
 *
 * This file used to declare `STAB_BOTTOM = 64` / `STAB_TOP = 76` and then, in
 * section 3, SELECT the stab's notes by filtering the bar's haps to that window
 * before asserting that every selected note was inside it. Nothing could ever
 * fail: the filter and the assertion were the same comparison. That is exactly
 * the "a ready row has away: 0 and every aim has at least 1" shape AGENTS.md
 * §3 records as the archetypal dead assertion.
 *
 * Two changes, and both make the check stronger. The window comes from
 * `theory.LANE_RANGE.stab`, which is the table the builder folds to — so the
 * two cannot disagree, and moving the window moves the assertion with it. And
 * the stab is selected by TIMBRE rather than by register.
 *
 * ---------------------------------------------------------------------------
 * AND THE TIMBRE IS NOW IMPORTED, BECAUSE THE HARDCODED COPY LIED
 * ---------------------------------------------------------------------------
 *
 * This file used to read `e.s === 'pulse' && e.pw === 0.5` for the stab and
 * `pw === 0` for the pad, written out here. The day the pad stopped being a
 * square and the stab stopped being a pulse, both selectors matched nothing and
 * this tool reported "the pad produced no bar with two tones" — on a pad
 * producing exactly two tones in all 88 bars. It was not measuring the harmony,
 * it was measuring its own copy of the orchestration.
 *
 * `layers.VOICE_TAGS` is that orchestration, exported by the module under test
 * and applied to the haps by the same function the builders call. AGENTS.md §3:
 * import the constant.
 */
const STAB_BOTTOM = LANE_RANGE.stab.lo;
const STAB_TOP = LANE_RANGE.stab.hi;
/** Does this hap belong to the voice group `tag` names? */
const isTag = (e, tag) =>
  e.s === tag.s &&
  (tag.pw === undefined || e.pw === tag.pw) &&
  (tag.unison === undefined || e.unison === tag.unison);
const isStab = (e) => isTag(e, VOICE_TAGS.stab);
const MODES_TO_TEST = Object.keys(PROGRESSIONS);

/** Interval class above the chord root, 0-11. */
const iv = (n, root) => ((((n - root) % 12) + 12) % 12);

/**
 * The chord's quality as a symbol `@strudel/tonal` understands, derived from
 * the mode rather than looked up: this is the same arithmetic `buildChord`
 * does, so the two cannot disagree about what chord a degree produces.
 */
function symbolFor(mode, degree) {
  const s = (d) => degreeToSemitone(mode, degree + d);
  const third = s(2) - s(0);
  const fifth = s(4) - s(0);
  const seventh = s(6) - s(0);
  const t = third === 4 ? 'M' : third === 3 ? 'm' : null;
  const f = fifth === 7 ? 'P' : fifth === 6 ? 'd' : fifth === 8 ? 'A' : null;
  const v = seventh === 11 ? 'M7' : seventh === 10 ? 'm7' : seventh === 9 ? 'd7' : null;
  if (!t || !f || !v) return null;
  return { MPM7: '^7', MPm7: '7', mPm7: 'm7', mPM7: 'mM7', mdm7: 'm7b5', mdd7: 'o7' }[t + f + v] ?? null;
}

/** A `MusicalState` good enough to build one bar of `chords` with. */
function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  const tonic = over.tonic ?? 57;
  const degree = over.degree ?? 0;
  const extend = over.extend ?? 'seventh';
  const chord = voiceLead([], buildChord(tonic, mode, degree, 0, extend));
  return {
    tension: 0.5,
    immediate: 0.5,
    section: 'sustain',
    buildProgress: 1,
    fillBar: false,
    bar: 0,
    tonic,
    mode,
    chord,
    nextChord: chord,
    chordIndex: 0,
    barInPhrase: 0,
    phrase: 0,
    feel: 'boomchick',
    bpm: 140,
    intensity: 0.5,
    brightness: 0.5,
    powerups: {},
    enemies: {},
    boss: false,
    bossTheme: false,
    bossPhase: 0,
    wave: 1,
    recap: false,
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

let failed = false;
const fail = (label, lines) => {
  failed = true;
  console.log(`\n  ${label}`);
  for (const l of lines.slice(0, 10)) console.log(`    ${l}`);
  if (lines.length > 10) console.log(`    ... and ${lines.length - 10} more`);
};

/* ------------------------------------------------- 1. every chord has a 7th */

const cases = [];
for (const mode of MODES_TO_TEST) {
  for (const [degree] of PROGRESSIONS[mode]) {
    for (const extend of ['seventh', 'ninth']) cases.push({ mode, degree, extend });
  }
}

const noSeventh = [];
const badInterval = [];
const badPartition = [];
let chordsChecked = 0;

for (const c of cases) {
  const raw = buildChord(57, c.mode, c.degree, 0, c.extend);
  const led = voiceLead([57, 60, 64], raw);
  chordsChecked++;
  const tag = `${c.mode}/deg${c.degree}/${c.extend}`;

  /*
   * `?? []` rather than a direct read, so a chord object that predates the
   * extension reports "this is a bare triad" instead of throwing. A gate that
   * crashes is red, but it is red in a way that says nothing about the music.
   */
  const tensions = led.tensions ?? [];
  const core = led.core ?? [];
  if (tensions.length !== 1) {
    noSeventh.push(`${tag}  tensions=[${tensions.join(',')}]  notes=[${led.notes.join(',')}]`);
    continue;
  }
  const seventhIv = iv(tensions[0], led.root);
  if (seventhIv < 9 || seventhIv > 11) {
    badInterval.push(`${tag}  tension is ${seventhIv} semitones above the root, not a seventh`);
  }
  const partition = [...core, ...tensions].sort((a, b) => a - b);
  const whole = [...led.notes].sort((a, b) => a - b);
  if (core.length !== 3 || partition.join(',') !== whole.join(',')) {
    badPartition.push(`${tag}  core=[${core}] tensions=[${tensions}] notes=[${whole}]`);
  }
}

console.log(`\nharmony — ${chordsChecked} voiced chords over ${MODES_TO_TEST.length} modes\n`);
if (chordsChecked === 0) fail('NOTHING WAS CHECKED — a zero denominator is a failure, not a pass.', []);

if (noSeventh.length) fail(`SEVENTH — ${noSeventh.length} of ${chordsChecked} chords are bare triads:`, noSeventh);
else console.log(`  ok   seventh — all ${chordsChecked} chords carry exactly one structural tension`);

if (badInterval.length) fail(`INTERVAL — ${badInterval.length} tensions are not sevenths:`, badInterval);
else console.log('  ok   interval — every tension is 9, 10 or 11 semitones above the root');

if (badPartition.length) fail(`PARTITION — ${badPartition.length} chords lose or invent a tone under voiceLead:`, badPartition);
else console.log('  ok   partition — core(3) + tensions(1) reconstructs notes exactly, after voicing');

/* -------------------------------- 2. the stab is @strudel/tonal's guidetones */

const guidetones = tonal.voicingRegistry?.guidetones?.dictionary;
if (!guidetones) {
  fail('DICTIONARY — @strudel/tonal did not expose voicingRegistry.guidetones. This tool cannot run.', []);
} else {
  const disagree = [];
  const unspelled = [];
  let pairsChecked = 0;
  for (const mode of MODES_TO_TEST) {
    for (const [degree] of PROGRESSIONS[mode]) {
      const sym = symbolFor(mode, degree);
      if (sym === null) {
        unspelled.push(`${mode}/deg${degree}`);
        continue;
      }
      const dict = guidetones[sym];
      if (!dict) {
        unspelled.push(`${mode}/deg${degree} -> "${sym}" is not in the guidetones dictionary`);
        continue;
      }
      pairsChecked++;
      // The package spells its voicings as interval names ('3m 7m'); convert to
      // semitones the same way `@strudel/tonal/tonleiter` does, by quality.
      const want = new Set(
        String(dict[0])
          .split(' ')
          .map((step) => {
            const [, acc, num] = step.match(/^(\d+)([mMPdA])$/) ?? step.match(/^([mMPdA]?)(\d+)$/) ?? [];
            const n = Number(step.replace(/[^0-9]/g, ''));
            const q = step.replace(/[0-9]/g, '');
            const base = [0, 0, 2, 4, 5, 7, 9, 11][((n - 1) % 7) + 1];
            const adj = q === 'm' ? -1 : q === 'd' ? (n === 5 || n === 4 ? -1 : -2) : q === 'A' ? 1 : 0;
            void acc;
            void num;
            return (((base + adj) % 12) + 12) % 12;
          }),
      );
      const chord = voiceLead([57, 60, 64], buildChord(57, mode, degree, 0, 'seventh'));
      const got = new Set(
        chord.notes.filter((n) => ![0, 6, 7].includes(iv(n, chord.root))).map((n) => iv(n, chord.root)),
      );
      const same = want.size === got.size && [...want].every((x) => got.has(x));
      if (!same) {
        disagree.push(
          `${mode}/deg${degree} (${sym})  guidetones wants {${[...want].sort((a, b) => a - b)}}  ` +
            `we play {${[...got].sort((a, b) => a - b)}}`,
        );
      }
    }
  }
  if (pairsChecked === 0) fail('GUIDE TONES — zero chord/quality pairs were compared. That is a failure.', []);
  else if (disagree.length) {
    fail(
      `GUIDE TONES — ${disagree.length} of ${pairsChecked} chords disagree with @strudel/tonal's own dictionary:`,
      disagree,
    );
  } else {
    console.log(
      `  ok   guide tones — all ${pairsChecked} chords select the same two intervals ` +
        "as @strudel/tonal's `guidetones` dictionary",
    );
  }
  if (unspelled.length) {
    console.log(`\n  note — ${unspelled.length} degree(s) have no standard chord symbol; not compared:`);
    for (const u of unspelled.slice(0, 6)) console.log(`    ${u}`);
  }
}

/* --------------------------- 3. the stab states them, in its own register */

const outOfWindow = [];
const missingSeventh = [];
const missingNinth = [];
const voiceCount = new Map();
let barsChecked = 0;

for (const mode of MODES_TO_TEST) {
  for (const [degree] of PROGRESSIONS[mode]) {
    for (const extend of ['seventh', 'ninth']) {
      const m = state({ mode, degree, extend, tension: 0.6 });
      const evs = notesIn(buildChords(m), 1);
      barsChecked++;
      // Selected by TIMBRE, so the register assertion below is a real one.
      // See the note on `isStab`.
      const stab = evs
        .filter(isStab)
        .map((e) => (typeof e.note === 'number' ? e.note : Number(e.note)))
        .filter((n) => Number.isFinite(n));
      if (!stab.length) continue;
      const root = m.chord.root;
      const ivs = new Set(stab.map((n) => iv(n, root)));
      const seventhIv = iv((m.chord.tensions ?? [])[0] ?? root, root);
      if (!ivs.has(seventhIv) && extend === 'seventh') {
        missingSeventh.push(`${mode}/deg${degree}  stab plays {${[...ivs].sort((a, b) => a - b)}}, no seventh (${seventhIv})`);
      }
      if (extend === 'ninth') {
        /*
         * IMPORTED, NOT RESTATED. This was `degreeToSemitone(mode, degree + 8)`
         * — the tool's own copy of "what a ninth is" — and it was WRONG in the
         * same way the builder's copy was: eight scale steps is the octave in an
         * eight-note scale, so in octatonic this asked whether the stab plays
         * the root. It reported two bars failing and the defect was real, but
         * the tool would have gone on agreeing with the builder however wrong
         * both of them were, because both held the same arithmetic.
         * `theory.extensionSemitone` is now the one definition.
         */
        const ninthIv = iv(57 + extensionSemitone(mode, degree, 14), root);
        if (!ivs.has(ninthIv)) {
          missingNinth.push(`${mode}/deg${degree}  stab plays {${[...ivs].sort((a, b) => a - b)}}, no ninth (${ninthIv})`);
        }
      }
      for (const n of stab) if (n < STAB_BOTTOM || n > STAB_TOP) outOfWindow.push(`${mode}/deg${degree} note ${n}`);
      const k = `${extend}`;
      voiceCount.set(k, (voiceCount.get(k) ?? []).concat(new Set(stab).size));
    }
  }
}

console.log('');
if (barsChecked === 0) fail('STAB — zero bars were built. That is a failure.', []);
if (missingSeventh.length) fail(`STAB SEVENTH — ${missingSeventh.length} of ${barsChecked} bars do not state the seventh in 64-76:`, missingSeventh);
else console.log(`  ok   stab — the seventh is stated in the stab's own register in every one of ${barsChecked} bars`);

if (missingNinth.length) fail(`STAB NINTH — ${missingNinth.length} bars unlock the ninth and do not play it:`, missingNinth);
else console.log('  ok   ninth — every ninth-act bar states the ninth');

if (outOfWindow.length) fail(`STAB REGISTER — ${outOfWindow.length} stab notes outside ${STAB_BOTTOM}-${STAB_TOP}:`, outOfWindow);
else console.log(`  ok   register — every stab note inside ${STAB_BOTTOM}-${STAB_TOP}`);

/*
 * ONSET NEUTRALITY. The whole reason the ninth REPLACES the third rather than
 * joining it: this lane's voice count must not change when the act unlocks the
 * ninth. `buildChords`' own comment records a previous version of this idea
 * being reverted for taking the stab from two voices to three (46,464 -> 69,696
 * haps, 41.1 -> 44.7 pitched note-events per bar) against a standing suspicion
 * that onset density is what "abrasive over time" means.
 */
const counts = [...voiceCount.entries()].map(([k, v]) => [k, Math.max(...v), Math.min(...v)]);
const seventhMax = counts.find((c) => c[0] === 'seventh')?.[1] ?? 0;
const ninthMax = counts.find((c) => c[0] === 'ninth')?.[1] ?? 0;
console.log('');
console.log(`  stab voices — seventh acts max ${seventhMax}, ninth acts max ${ninthMax}`);
if (seventhMax === 0 || ninthMax === 0) {
  fail('ONSETS — one of the two act families produced no stab voices at all.', []);
} else if (ninthMax > seventhMax) {
  failed = true;
  console.log(`\n  ONSETS — unlocking the ninth ADDED a voice (${seventhMax} -> ${ninthMax}). It must replace, not join.`);
} else {
  console.log('  ok   onsets — unlocking the ninth replaces a tone rather than adding one');
}

/* ------------------- 4. the chords lane does not sustain, and is not a supersaw */

/*
 * WHAT STOOD HERE, AND WHY IT WAS REPLACED RATHER THAN RELAXED.
 *
 * Section 4 was CLUSTER: the pad — a sustained dyad folded into
 * `LANE_RANGE.pad` — must never hold two tones within two semitones. It caught
 * a real defect on the day the chord grew a seventh (`[49,50,54,57]` in 38 of
 * 88 bars, every register gate green) and it stayed green for 176 pad bars on
 * the last tree that had a pad.
 *
 * The pad is deleted. So is the colour pair. The owner's words, verbatim:
 * "also the synth sound is really bad i hate it remove that and clean up the
 * music", after "the synth high pitch sound is not good" and "too much high
 * pitch synth always playing, its taxing on the ears". Two capping commits
 * (`2524fcb`, `6e6bdc4`) lowered filters and levels and did not answer it.
 * Measured on that tree: the colour pair was the top sustained voice above
 * 500 Hz from bar 11 of a run once the lead rests (expo 0.037-0.041 vs the
 * lead's 0.031), and bass+chords was 47% of all masking weight, 2620 of its
 * 3265 inside the pad's own window. A gate whose SUBJECT is deleted by design
 * is not a gate being relaxed (AGENTS.md §3, `leadcheck`'s own header records
 * the same shape); keeping CLUSTER would mean asserting spacing on a lane that
 * holds nothing.
 *
 * The two assertions that replace it are STRONGER in the sense that matters:
 * they are the ones that would go red the day somebody puts the pad back.
 *
 *   NO SUPERSAW   No hap the chords lane emits carries `s === 'supersaw'` —
 *                 in any section, any feel, and under the three flags that
 *                 used to floor the colour pair open (`shuffle` is a feel, NOVA
 *                 a powerup, HUSHED a movement). `harmony` used to build one
 *                 state — sustain/boomchick — and a pad voice re-added only in
 *                 the breakdown, or only under NOVA, would have passed. The hap
 *                 count is printed per section and per flag, so a state that
 *                 emits nothing (the breakdown, by design) is visible rather
 *                 than counted as clean by default. Seen red by restoring one
 *                 pad voice.
 *
 *   NO SUSTAIN    No chords hap sounds for more than half a bar. `hold` is
 *                 `clip`, a FRACTION OF THE SLOT (`articulation.ts`), so the
 *                 sounding length is `whole.duration × clip` — a stab on the
 *                 eighth grid at hold 0.62 is 0.08 of a bar, a whole-note pad
 *                 at 0.86 is 0.86. The longest sounding length seen is
 *                 printed. Giving the stab the `bowed` touch does NOT cross
 *                 this line (0.86 × 1/8 = 0.11), which is the point: the
 *                 assertion is about the lane's RHYTHM, not its envelope. Seen
 *                 red by giving the stab a whole-note struct.
 *
 * How either could be gamed: by emptying the lane. The total hap count over
 * the sweep is printed and zero is a failure.
 *
 * SEEN RED, each on its own, 2026-09-04, on the tree that deleted the pad:
 * one short supersaw voice (`struct('x ~ ~ ~ ~ ~ ~ ~')`, unison 3) added to
 * the lane -> "NO SUPERSAW — 2700 of 10800 chords haps are a supersaw" with
 * NO SUSTAIN still green; the stab's struct replaced by a whole note ->
 * "NO SUSTAIN — 4860 of 4860 chords haps sound longer than 0.5 of a bar" with
 * NO SUPERSAW still green. Both edits reverted and byte-verified. Green on
 * that tree: 8100 haps over 1620 states, breakdown 0 (by design — the lane is
 * `silence` there), longest hap 0.140 of a bar.
 */
const SWEEP_SECTIONS = ['intro', 'build', 'drop', 'breakdown', 'sustain', 'fill'];
const SWEEP_FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const SWEEP_FLAGS = [
  { name: 'plain', over: {} },
  { name: 'nova', over: { powerups: { nova: 3 } } },
  { name: 'hush', over: { movement: 'hush' } },
];
const SUSTAIN_MAX = 0.5;
const supersawHaps = [];
const sustained = [];
const perSection = {};
const perFlag = {};
const perFeel = {};
let sweepHaps = 0;
let sweepStates = 0;
let longest = 0;
let longestWhere = '';
for (const section of SWEEP_SECTIONS) {
  for (const feel of SWEEP_FEELS) {
    for (const flag of SWEEP_FLAGS) {
      for (const mode of MODES_TO_TEST) {
        for (const extend of ['seventh', 'ninth']) {
          const m = state({ mode, degree: 0, extend, tension: 0.6, section, feel, ...flag.over });
          const evs = notesIn(buildChords(m), 1);
          sweepStates++;
          sweepHaps += evs.length;
          perSection[section] = (perSection[section] ?? 0) + evs.length;
          perFlag[flag.name] = (perFlag[flag.name] ?? 0) + evs.length;
          perFeel[feel] = (perFeel[feel] ?? 0) + evs.length;
          const where = `${section}/${feel}/${flag.name}/${mode}/${extend}`;
          for (const e of evs) {
            if (e.s === 'supersaw') supersawHaps.push(`${where}  note ${e.note} s=${e.s} unison=${e.unison}`);
            // A hap with no `clip` sounds for its whole slot.
            const clip = typeof e.clip === 'number' ? e.clip : 1;
            const sounding = (e.end - e.begin) * clip;
            if (sounding > longest) {
              longest = sounding;
              longestWhere = where;
            }
            if (sounding > SUSTAIN_MAX) sustained.push(`${where}  note ${e.note} sounds ${sounding.toFixed(2)} of a bar`);
          }
        }
      }
    }
  }
}
console.log('');
console.log(`  chords haps over ${sweepStates} states (${SWEEP_SECTIONS.length} sections x ${SWEEP_FEELS.length} feels x ${SWEEP_FLAGS.length} flags x ${MODES_TO_TEST.length} modes x 2 extensions): ${sweepHaps}`);
console.log(`    per section  ${SWEEP_SECTIONS.map((s) => `${s} ${perSection[s] ?? 0}`).join('  ')}`);
console.log(`    per flag     ${SWEEP_FLAGS.map((f) => `${f.name} ${perFlag[f.name] ?? 0}`).join('  ')}`);
console.log(`    per feel     ${SWEEP_FEELS.map((f) => `${f} ${perFeel[f] ?? 0}`).join('  ')}`);
if (sweepHaps === 0) {
  fail('NO SUPERSAW / NO SUSTAIN — the chords lane emitted nothing over the whole sweep. A zero denominator is a failure, not a pass.', []);
} else {
  if (supersawHaps.length) {
    fail(`NO SUPERSAW — ${supersawHaps.length} of ${sweepHaps} chords haps are a supersaw. The pad or the colour pair is back:`, supersawHaps);
  } else {
    console.log(`  ok   no supersaw — 0 of ${sweepHaps} chords haps carry s=supersaw, in every section, feel and flag`);
  }
  if (sustained.length) {
    fail(`NO SUSTAIN — ${sustained.length} of ${sweepHaps} chords haps sound longer than ${SUSTAIN_MAX} of a bar. The lane sustains again:`, sustained);
  } else {
    console.log(`  ok   no sustain — the longest chords hap sounds ${longest.toFixed(3)} of a bar (${longestWhere}); the line is ${SUSTAIN_MAX}`);
  }
}

console.log('');
console.log(failed ? 'HARMONY FAILS' : 'HARMONY HOLDS — the chord is a seventh chord in the register a listener follows');
process.exit(failed ? 1 : 0);
