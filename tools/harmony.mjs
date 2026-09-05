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
const { buildChord, voiceLead, pivotChord, PROGRESSIONS, degreeToSemitone, extensionSemitone, LANE_RANGE } = await import(
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
  /*
   * `pivot` is not a field of `MusicalState`; it is the one flag on `Chord`
   * the bed and the stab both read (`Chord.pivot` in theory.ts). Stripped
   * here and written onto the chord, so the sweep can build the bar before a
   * modulation without holding a copy of `pivotChord`.
   */
  const { pivot, ...rest } = over;
  over = rest;
  const mode = over.mode ?? 'aeolian';
  const tonic = over.tonic ?? 57;
  const degree = over.degree ?? 0;
  const extend = over.extend ?? 'seventh';
  /*
   * A pivot bar is `pivotChord`'s dominant seventh on the way to the next key
   * up the cycle of fourths (`onWaveStart`: the new tonic is five semitones
   * above), never an ordinary chord with the flag set. The first version of
   * this sweep flagged the mode's tonic chord and reported 225 bed dyads a
   * major sixth wide — a fact about the sweep, not about the bed.
   */
  const chord = voiceLead([], pivot ? pivotChord(tonic, tonic + 5) : buildChord(tonic, mode, degree, 0, extend));
  if (pivot) chord.pivot = true;
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

/* ------ 4. the chords lane sustains ONLY in the open sections, as a sine bed */

/*
 * WHAT STOOD HERE, TWICE, AND WHY EACH VERSION WAS REPLACED RATHER THAN RELAXED.
 *
 * First there was CLUSTER: the pad — a sustained dyad folded into
 * `LANE_RANGE.pad` — must never hold two tones within two semitones. It caught
 * a real defect on the day the chord grew a seventh (`[49,50,54,57]` in 38 of
 * 88 bars, every register gate green) and it stayed green for 176 pad bars on
 * the last tree that had a pad.
 *
 * Then the pad was deleted on the owner's word ("also the synth sound is
 * really bad i hate it remove that and clean up the music", after "the synth
 * high pitch sound is not good" and "too much high pitch synth always
 * playing, its taxing on the ears") and CLUSTER lost its subject. Its
 * replacements were NO SUPERSAW and NO SUSTAIN: no chords hap is a supersaw,
 * and no chords hap sounds longer than half a bar — anywhere. Measured on the
 * tree the deletion answered: the colour pair was the top sustained voice above
 * 500 Hz from bar 11 of a run once the lead rests, and bass+chords was 47% of
 * all masking weight, 2620 of its 3265 inside the pad's own window.
 *
 * NO SUSTAIN encoded a STRONGER claim than the complaint did (the audit,
 * `scratchpad/cheap/reports/audit.md` §5: "the deletion answered the pad's
 * SOUND ... the reference shows a held chord is acceptable to the owner when it
 * is a sine under 200 Hz"). The owner's own reference — screenshot 2 of
 * `refs/references.md` — is `chord("<Bm Asus G [D A]>").voicing().s('sine')
 * .lpf(200)`: a held chord, dark, under everything. What was rejected was three
 * detuned saws opening to 1.9 kHz at gain 0.30 in every section. So the line
 * moves from "never sustain" to "sustain only THIS, only THERE", and every
 * clause of that sentence is an assertion below, because each is a way the old
 * pad could come back wearing the bed's name:
 *
 *   OPEN        A chords hap may sound longer than `SUSTAIN_MAX` (0.5 bar) only
 *               in an OPEN state: section intro, build or breakdown, or the
 *               HUSHED movement in any section (a hushed wave is "that moment
 *               stretched over a whole stage", `MOVEMENT_MIX.hush`; the lead
 *               treats it as open for the same reason). In a plain or NOVA
 *               drop, sustain or fill NOTHING in this lane sustains — that is
 *               the wub's window, where bass+chords was 47% of masking with
 *               the old pad in it.
 *
 *   SOURCE      Every sustained hap is the bed — `VOICE_TAGS.bed`, imported,
 *               applied to the haps by the same `tagVoice` the builder calls
 *               — AND that tag's oscillator is a sine. Both, because the
 *               imported tag alone can be satisfied by editing the tag: a
 *               `bed: { s: 'sawtooth' }` would match its own haps. The sine is
 *               the design (the reference's `.s('sine')`), so it is asserted
 *               as a literal here, on purpose, against the table.
 *
 *   DARK        Every sustained hap carries `cutoff <= BED_CUTOFF_MAX` (400 Hz;
 *               the bed writes 300, the reference 200) and written `gain <=
 *               BED_GAIN_MAX` (0.35; the bed writes 0.32, the old pad 0.30 of three saws).
 *               A sine under 300 Hz in 116-233 Hz is a fundamental and
 *               nothing else — it cannot be "high pitch synth" however it is
 *               played.
 *
 *   DYAD        Per bar, at most TWO distinct sustained tones. A third tone is
 *               the fold trap (AGENTS.md §4: "folding three or more tones into
 *               thirteen semitones puts a low SECOND in a sustained lane").
 *
 *   INTERVAL    The pair is a fourth or a fifth apart (or the tritone that
 *               locrian's diminished fifth folds to), or on a PIVOT bar a
 *               major third or a minor sixth — root + leading tone, the
 *               voicing `tools/arc.mjs` ARRIVAL counts (12/12 with it).
 *
 *   CLUSTER     Back, for the bed: two sustained tones at least
 *               `CLUSTER_MIN` (3) semitones apart. INTERVAL implies it, but the
 *               spacing check is the one that caught the real defect once, so
 *               it stays a named assertion with its own message and its own
 *               denominator rather than being a corollary nobody can see fail.
 *
 *   PRESENT     The bed BARS are printed per section and per flag, and an open
 *               section under the plain flag with ZERO bed bars is red — a bed
 *               that never sounds satisfies every other clause.
 *
 *   NO SUPERSAW Unchanged: no chords hap carries `s === 'supersaw'`, in any
 *               section, feel or flag.
 *
 * How the set could be gamed: by emptying the lane (total haps printed, zero
 * fails) or by emptying the bed (PRESENT). The PIVOT flag exists because a
 * pivot bar is the one bar the bed voices differently, and a sweep without
 * one would never exercise the major-third branch.
 *
 * SEEN RED, each on its own, 2026-09-05, on the tree that added the bed. Each
 * edit was made in `layers.ts` by a script that counted its substitutions
 * (the CRLF trap from Stage 2), ran this tool, restored the file and `cmp`'d
 * it against a copy. Every other clause stayed green on every break:
 *   OPEN      `bedSounds` widened to the drop
 *             -> "OPEN — 540 sustained chords haps outside the open sections"
 *   SOURCE    `VOICE_TAGS.bed.s` set to 'sawtooth'
 *             -> "SOURCE — VOICE_TAGS.bed is sawtooth, not a sine" and
 *                "SOURCE — 2700 of 2700 sustained haps are not the sine bed"
 *   DARK      `.lpf(300)` -> `.lpf(1200)`
 *             -> "DARK — 2700 of 2700 sustained haps carry cutoff > 400"
 *   DYAD      the chord's third admitted as a third bed tone
 *             -> "DYAD — 540 of 1350 bed bars hold more than two tones"
 *                (the seventh acts; the ninth acts have no third to admit)
 *   CLUSTER   the dyad replaced by root + a semitone
 *             -> "CLUSTER — 1080 of 1350 bed bars hold two tones under 3
 *                semitones apart" and INTERVAL red on the same 1080 (the 270
 *                pivot bars are built by construction and stayed clean)
 *   PRESENT   the bed removed from the intro
 *             -> "PRESENT — an open section has no bed bars: intro/plain: 0
 *                bed bars over 90 states"
 * Green on this tree: 14040 haps over 2160 states, 1350 bed bars, 2700
 * sustained haps, longest closed-section hap 0.140 of a bar.
 */
const SWEEP_SECTIONS = ['intro', 'build', 'drop', 'breakdown', 'sustain', 'fill'];
const SWEEP_FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const SWEEP_FLAGS = [
  { name: 'plain', over: {} },
  { name: 'nova', over: { powerups: { nova: 3 } } },
  { name: 'hush', over: { movement: 'hush' } },
  // The bar before a modulation: the bed keeps root + major third there.
  { name: 'pivot', over: { pivot: true } },
];
/** The sections in which a chords hap may sustain (plus the hush movement). */
const OPEN_SECTIONS = new Set(['intro', 'build', 'breakdown']);
const isOpen = (section, flag) => OPEN_SECTIONS.has(section) || flag.over.movement === 'hush';
const SUSTAIN_MAX = 0.5;
const BED_CUTOFF_MAX = 400;
/*
 * 0.35, NOT 0.25: the bed rendered at the spec's 0.22 did not register in any
 * full-mix band (Stage 3's captures, < 0.2 dB), so it went to 0.32 — still ~6 dB
 * under the deleted pad's 0.30-of-three-saws. The cap moves with it and stays
 * a cap: a bed written above 0.35 is the pad's loudness coming back.
 */
const BED_GAIN_MAX = 0.35;
const CLUSTER_MIN = 3;
/** Interval classes a bed dyad may span, after the fold. */
const DYAD_IVS = new Set([5, 6, 7]);
const PIVOT_IVS = new Set([4, 8]);
const isBed = (e) => VOICE_TAGS.bed !== undefined && isTag(e, VOICE_TAGS.bed);

const supersawHaps = [];
const closedSustain = [];
const wrongSource = [];
const notDark = [];
const tooMany = [];
const clusters = [];
const wrongInterval = [];
const perSection = {};
const perFlag = {};
const perFeel = {};
/** bed bars (states with >= 1 bed hap) and states, per section/flag. */
const bedBars = {};
const bedStates = {};
let sweepHaps = 0;
let sweepStates = 0;
let sustainedHaps = 0;
let bedBarsTotal = 0;
let longest = 0;
let longestWhere = '';
let longestClosed = 0;
let longestClosedWhere = '';
const stabDecays = new Set();
const stabPans = new Set();
let stabHaps = 0;

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
          const cell = `${section}/${flag.name}`;
          bedStates[cell] = (bedStates[cell] ?? 0) + 1;
          const where = `${section}/${feel}/${flag.name}/${mode}/${extend}`;
          const open = isOpen(section, flag);
          const sustainedTones = new Set();
          let bedHere = 0;
          for (const e of evs) {
            if (e.s === 'supersaw') supersawHaps.push(`${where}  note ${e.note} s=${e.s} unison=${e.unison}`);
            if (isStab(e)) {
              stabHaps++;
              if (typeof e.decay === 'number') stabDecays.add(e.decay.toFixed(4));
              if (typeof e.pan === 'number') stabPans.add(e.pan.toFixed(3));
            }
            if (isBed(e)) bedHere++;
            // A hap with no `clip` sounds for its whole slot.
            const clip = typeof e.clip === 'number' ? e.clip : 1;
            const sounding = (e.end - e.begin) * clip;
            if (sounding > longest) {
              longest = sounding;
              longestWhere = where;
            }
            if (!open && sounding > longestClosed) {
              longestClosed = sounding;
              longestClosedWhere = where;
            }
            if (sounding <= SUSTAIN_MAX) continue;
            sustainedHaps++;
            const n = typeof e.note === 'number' ? e.note : Number(e.note);
            if (!open) {
              closedSustain.push(`${where}  note ${e.note} sounds ${sounding.toFixed(2)} of a bar`);
              continue;
            }
            if (!isBed(e) || e.s !== 'sine') wrongSource.push(`${where}  note ${e.note} s=${e.s} sounds ${sounding.toFixed(2)}`);
            const cutoff = typeof e.cutoff === 'number' ? e.cutoff : Infinity;
            const gain = typeof e.gain === 'number' ? e.gain : 1;
            if (!(cutoff <= BED_CUTOFF_MAX) || !(gain <= BED_GAIN_MAX)) {
              notDark.push(`${where}  note ${e.note} cutoff ${cutoff} gain ${gain}`);
            }
            if (Number.isFinite(n)) sustainedTones.add(n);
          }
          if (bedHere > 0) {
            bedBars[cell] = (bedBars[cell] ?? 0) + 1;
            bedBarsTotal++;
          }
          if (sustainedTones.size === 0) continue;
          const tones = [...sustainedTones].sort((a, b) => a - b);
          if (tones.length > 2) tooMany.push(`${where}  bed=[${tones}]`);
          for (let i = 1; i < tones.length; i++) {
            if (tones[i] - tones[i - 1] < CLUSTER_MIN) {
              clusters.push(`${where}  bed=[${tones}]`);
              break;
            }
          }
          if (tones.length === 2) {
            const ivc = (tones[1] - tones[0]) % 12;
            const want = m.chord.pivot ? PIVOT_IVS : DYAD_IVS;
            if (!want.has(ivc)) {
              wrongInterval.push(`${where}  bed=[${tones}] spans ${ivc} semitones${m.chord.pivot ? ' on a pivot bar' : ''}`);
            }
          }
        }
      }
    }
  }
}

console.log('');
console.log(
  `  chords haps over ${sweepStates} states (${SWEEP_SECTIONS.length} sections x ${SWEEP_FEELS.length} feels x ` +
    `${SWEEP_FLAGS.length} flags x ${MODES_TO_TEST.length} modes x 2 extensions): ${sweepHaps}`,
);
console.log(`    per section  ${SWEEP_SECTIONS.map((s) => `${s} ${perSection[s] ?? 0}`).join('  ')}`);
console.log(`    per flag     ${SWEEP_FLAGS.map((f) => `${f.name} ${perFlag[f.name] ?? 0}`).join('  ')}`);
console.log(`    per feel     ${SWEEP_FEELS.map((f) => `${f} ${perFeel[f] ?? 0}`).join('  ')}`);
console.log(`  bed bars (states with a bed hap) per section x flag, as bars/states — ${bedBarsTotal} in all:`);
for (const section of SWEEP_SECTIONS) {
  const cells = SWEEP_FLAGS.map((f) => {
    const cell = `${section}/${f.name}`;
    return `${f.name} ${bedBars[cell] ?? 0}/${bedStates[cell] ?? 0}`;
  });
  console.log(`    ${section.padEnd(10)} ${cells.join('  ')}`);
}
console.log(`  sustained chords haps (> ${SUSTAIN_MAX} of a bar): ${sustainedHaps} of ${sweepHaps}; longest ${longest.toFixed(3)} (${longestWhere})`);
console.log(
  `  stab per-hit randomness, a readout: ${stabDecays.size} distinct decay values and ${stabPans.size} distinct pans over ` +
    `${stabHaps} stab haps (every state is queried at cycle 0, where the legacy rand reads exactly 0 at t = 0 — a valid draw, not a dropped hap)`,
);

if (sweepHaps === 0) {
  fail('CHORDS — the lane emitted nothing over the whole sweep. A zero denominator is a failure, not a pass.', []);
} else {
  if (supersawHaps.length) {
    fail(`NO SUPERSAW — ${supersawHaps.length} of ${sweepHaps} chords haps are a supersaw. The pad or the colour pair is back:`, supersawHaps);
  } else {
    console.log(`  ok   no supersaw — 0 of ${sweepHaps} chords haps carry s=supersaw, in every section, feel and flag`);
  }

  if (closedSustain.length) {
    fail(
      `OPEN — ${closedSustain.length} sustained chords haps outside the open sections (intro/build/breakdown, or hush). The lane sustains in the drop again:`,
      closedSustain,
    );
  } else {
    console.log(
      `  ok   open — outside intro/build/breakdown/hush the longest chords hap sounds ${longestClosed.toFixed(3)} of a bar ` +
        `(${longestClosedWhere}); the line is ${SUSTAIN_MAX}`,
    );
  }

  if (VOICE_TAGS.bed?.s !== 'sine') {
    fail(`SOURCE — VOICE_TAGS.bed is ${VOICE_TAGS.bed?.s ?? '(missing)'}, not a sine. The reference bed is s('sine').`, []);
  }
  if (wrongSource.length) {
    fail(`SOURCE — ${wrongSource.length} of ${sustainedHaps} sustained haps are not the sine bed (VOICE_TAGS.bed):`, wrongSource);
  } else if (sustainedHaps > 0 && VOICE_TAGS.bed?.s === 'sine') {
    console.log(`  ok   source — all ${sustainedHaps} sustained haps are the bed, and the bed is a sine`);
  }

  if (notDark.length) {
    fail(`DARK — ${notDark.length} of ${sustainedHaps} sustained haps carry cutoff > ${BED_CUTOFF_MAX} or written gain > ${BED_GAIN_MAX}:`, notDark);
  } else if (sustainedHaps > 0) {
    console.log(`  ok   dark — every sustained hap is under ${BED_CUTOFF_MAX} Hz at written gain <= ${BED_GAIN_MAX}`);
  }

  if (tooMany.length) {
    fail(`DYAD — ${tooMany.length} of ${bedBarsTotal} bed bars hold more than two tones (the fold trap):`, tooMany);
  } else if (bedBarsTotal > 0) {
    console.log(`  ok   dyad — none of ${bedBarsTotal} bed bars holds more than two sustained tones`);
  }

  if (wrongInterval.length) {
    fail(`INTERVAL — ${wrongInterval.length} of ${bedBarsTotal} bed bars are not a fourth/fifth/tritone (pivot: major third/minor sixth):`, wrongInterval);
  } else if (bedBarsTotal > 0) {
    console.log('  ok   interval — every bed dyad is a fourth, a fifth or a tritone; every pivot dyad a major third or a minor sixth');
  }

  if (clusters.length) {
    fail(`CLUSTER — ${clusters.length} of ${bedBarsTotal} bed bars hold two tones under ${CLUSTER_MIN} semitones apart:`, clusters);
  } else if (bedBarsTotal > 0) {
    console.log(`  ok   spacing — none of ${bedBarsTotal} bed bars holds two tones within ${CLUSTER_MIN - 1} semitones`);
  }

  // PRESENT: every open section under the plain flag, and hush in the drop,
  // must actually carry the bed.
  const missing = [];
  for (const section of OPEN_SECTIONS) {
    const cell = `${section}/plain`;
    if (!(bedBars[cell] > 0)) missing.push(`${cell}: ${bedBars[cell] ?? 0} bed bars over ${bedStates[cell] ?? 0} states`);
  }
  if (!(bedBars['drop/hush'] > 0)) missing.push(`drop/hush: ${bedBars['drop/hush'] ?? 0} bed bars over ${bedStates['drop/hush'] ?? 0} states`);
  if (missing.length) {
    fail('PRESENT — an open section has no bed bars; a bed that never sounds satisfies every other clause:', missing);
  } else {
    console.log('  ok   present — the bed sounds in intro, build and breakdown (plain) and under hush in the drop');
  }
}

console.log('');
console.log(failed ? 'HARMONY FAILS' : 'HARMONY HOLDS — the chord is a seventh chord in the register a listener follows');
process.exit(failed ? 1 : 0);
