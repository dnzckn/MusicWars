/*
 * bosscheck — does a boss fight sound like the ADVERSARY, or like the ordinary
 * track with more layers on it?
 *
 * WHAT THIS GATE USED TO ASSERT, AND WHY IT WAS REPLACED RATHER THAN RELAXED.
 *
 * The first version asserted the Lavender Town treatment the owner had asked
 * for by name: a four-note `pulse` ostinato on `motifs` (root, fifth, major
 * seventh, tritone) above the colour tones' 79-91 window, `vib("1:.5")` on
 * it, one phrase in five shuddering faster, a slower-and-wider lead vibrato,
 * and a single band-passed white-noise hit on `fx`. Every one of those was
 * deleted on the owner's later word — "lol the lavendar town boss fight is so
 * awful lets just forget about that spec" (see the tombstone in `buildLead`)
 * — and the lead's vibrato went with research §6.1 ("a woodwind in a video
 * game"). The gate was not updated. Measured on the tree that deleted the
 * chords pad, it was RED on HEAD with three failures: OSTINATO ("the `motifs`
 * lane is SILENT during a boss" — no `MOTIFS` row emits `pulse`, and the
 * sweep state has no enemies), LEAD ("one of the two states produced no lead
 * haps" — the ordinary state RESTS the lead by design, see `yieldToBass`),
 * and ONE HIT ("no filtered noise hit" — `buildFx` has no boss branch). It
 * had been red for as long as those deletions had existed, which is the
 * "unmeasured properties rot" failure with the sign flipped: a red nobody
 * reads is the same as no gate.
 *
 * A gate whose SUBJECT was deleted by design is replaced, not relaxed
 * (AGENTS.md §3; `leadcheck`'s header records the same shape). The three
 * stale assertions are replaced MINIMALLY with three that describe the boss
 * score AS IT IS WRITTEN NOW, each read off the haps and each seen red once:
 *
 *   LEITMOTIF  `themeForWave(wave, boss)` returns `BOSS_THEME`, a tune kept
 *              out of the rondo so that it is heard only in a fight. The boss
 *              lead's line must differ from the ordinary lead's line at the
 *              same bar for EVERY wave of a rondo period — if any wave's theme
 *              coincided with it, the leitmotif would be a seventh tune.
 *              Seen red by making `themeForWave` return `THEMES[0]` for a
 *              boss.
 *
 *   EXEMPT     `yieldToBass` rests the tune three bars in four across drop
 *              and sustain, and a boss is one of its two exemptions. So on a
 *              sustain bar that is not a cadence bar the ordinary lead must be
 *              SILENT and the boss lead must SOUND — the exact pair of counts
 *              the old LEAD assertion called a failure. The cadence bar is
 *              printed beside it so "the lead is silent everywhere" cannot
 *              satisfy the ordinary half. Seen red by removing `!m.boss` from
 *              `yieldToBass`.
 *
 *   WEIGHT     A boss is scored for low brass: the skeleton doubled on
 *              sawtooth an octave and two octaves down, DEEPER WITH EACH PHASE
 *              (`0.34 + phase * 0.08`, `0.24 + phase * 0.06`). Both octaves
 *              must be present under the tune, neither may exist outside a
 *              boss, and each must be louder at phase 2 than at phase 0.
 *              `leadcheck` already holds the body's band (500-1400 Hz) and
 *              cleanliness; this holds the part of it that is the FIGHT.
 *              Seen red by zeroing the phase term.
 *
 *   THIN       Kept from the first version: no triangle survives into a boss
 *              lead. Still true, still worth a line.
 *
 * WHAT THIS DOES NOT PIN. No `MOTIFS` row. The motifs are enemy-count-driven
 * (`buildMotifs` reads `m.enemies`) and a boss with no ordinary enemies on
 * screen has none — that is the stage being audible, not a boss treatment,
 * and `STEM_CURVES.motifs` names the three triangle rows "for the next pass".
 * Nothing on `fx` either: `buildFx` has no boss branch, so the old "reserved
 * — the hit is heard nowhere else" was vacuous (0 of 0). The director's boss
 * handling — the -10 bpm gear change that recovers by phase, the mode going
 * off the ladder — is not reachable from `layers.ts` alone and is not
 * asserted here.
 *
 * Every denominator is printed; `checked === 0` fails.
 *
 * SEEN RED, each assertion on its own, 2026-09-04, on the tree that deleted
 * the chords pad — one temporary `layers.ts` edit each, reverted and
 * byte-verified, the other three assertions staying green every time:
 *   LEITMOTIF  `themeForWave` returning `THEMES[0]` for a boss
 *              -> "4 of 8 waves play the boss line outside a boss"
 *   EXEMPT     `!m.boss &&` removed from `yieldToBass`
 *              -> "the boss lead is silent on the sustain rest bar"
 *   WEIGHT     both phase terms zeroed
 *              -> "the body does not deepen with the phase: -12 0.340 ->
 *                 0.340, -24 0.240 -> 0.240"
 *   THIN       a triangle voice pushed under the boss tune
 *              -> "the boss tune is still on a triangle"
 * Green on that tree: leitmotif 8 of 8 waves differ; rest bar boss 4 /
 * ordinary 0, cadence bar 3 / 3; body -12 x3 (0.34 -> 0.50), -24 x3 (0.24 ->
 * 0.36), ordinary sawtooth x0; sources {pulse supersaw sawtooth} over 13 haps.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, voiceLead } = await import('../src/audio/theory.ts');

const TONIC = 57;
const MODE = 'harmonicMinor';

function state(over = {}) {
  const degree = over.degree ?? 0;
  const chord = voiceLead([], buildChord(TONIC, MODE, degree));
  return {
    tension: 0.7,
    immediate: 0.7,
    section: 'sustain',
    buildProgress: 1,
    fillBar: false,
    bar: 0,
    tonic: TONIC,
    mode: MODE,
    chord,
    nextChord: chord,
    chordIndex: 0,
    barInPhrase: 0,
    phrase: 0,
    feel: 'gallop',
    bpm: 150,
    intensity: 0.8,
    brightness: 0.4,
    powerups: {},
    enemies: { rush: 0, echo: 0, conductor: 0, subdrop: 0, arpeggiator: 0, glissando: 0, stutter: 0, pluck: 0 },
    boss: true,
    bossTheme: true,
    bossPhase: 0,
    wave: 8,
    recap: false,
    bombs: 0,
    health: 1,
    grazeRate: 0,
    combo: 1,
    leadRegister: 0,
    movement: null,
    sig: makeSignals(strudel),
    ...over,
  };
}

const CALM = { boss: false, bossTheme: false };
const midi = (v) => (typeof v.note === 'number' ? v.note : Number(v.note));
/** The tune's own haps: the pulse body, in both duties. Width and body excluded. */
const tune = (evs) => evs.filter((e) => e.s === 'pulse' && Number.isFinite(midi(e)));
/** A line's fingerprint: onset and pitch, in order. */
const lineOf = (evs) => tune(evs).map((e) => `${e.begin.toFixed(3)}:${midi(e)}`).sort().join(' ');

let failed = false;
const fail = (label, lines = []) => {
  failed = true;
  console.log(`\n  ${label}`);
  for (const l of lines.slice(0, 8)) console.log(`    ${l}`);
  if (lines.length > 8) console.log(`    ... and ${lines.length - 8} more`);
};

console.log('\nbosscheck — the adversary, measured off the haps\n');

/* ----------------------------------------------------------- 1. leitmotif */

/*
 * `build` rather than `sustain`: the build keeps the whole melody, so the
 * comparison is between two full lines rather than between a line and a rest.
 * Bar 0 of the phrase — the bar a leitmotif is recognised on.
 */
const WAVES = [0, 1, 2, 3, 4, 5, 6, 7];
const same = [];
let leitChecked = 0;
let bossLine = '';
for (const wave of WAVES) {
  const bossEvs = notesIn(L.buildLead(state({ section: 'build', wave })), 1);
  const calmEvs = notesIn(L.buildLead(state({ section: 'build', wave, ...CALM })), 1);
  const bl = lineOf(bossEvs);
  const cl = lineOf(calmEvs);
  if (!bl || !cl) continue;
  leitChecked++;
  bossLine = bl;
  if (bl === cl) same.push(`wave ${wave}: the boss plays the ordinary theme's line note for note`);
}
console.log(`  leitmotif — boss line compared against ${leitChecked} of ${WAVES.length} waves' ordinary lines (bar 0 of the phrase, build)`);
console.log(`    boss bar 0: ${bossLine || '(no tune haps)'}`);
if (leitChecked === 0) fail('LEITMOTIF — no wave produced both a boss line and an ordinary line. Zero compared is a failure.');
else if (same.length) fail(`LEITMOTIF — ${same.length} of ${leitChecked} waves play the boss line outside a boss:`, same);
else console.log(`  ok   leitmotif — the boss line differs from every one of ${leitChecked} ordinary lines`);

/* ------------------------------------------------------------- 2. exempt */

const restBar = { section: 'sustain', barInPhrase: 0 };
const cadenceBar = { section: 'sustain', barInPhrase: 3 };
const bossRest = tune(notesIn(L.buildLead(state(restBar)), 1)).length;
const calmRest = tune(notesIn(L.buildLead(state({ ...restBar, ...CALM })), 1)).length;
const bossCadence = tune(notesIn(L.buildLead(state(cadenceBar)), 1)).length;
const calmCadence = tune(notesIn(L.buildLead(state({ ...cadenceBar, ...CALM })), 1)).length;
console.log(`\n  exempt — tune haps on a sustain rest bar: boss ${bossRest}, ordinary ${calmRest}; on the cadence bar: boss ${bossCadence}, ordinary ${calmCadence}`);
if (calmCadence === 0) {
  fail('EXEMPT — the ordinary lead is silent even on the cadence bar, so "silent on a rest bar" measures nothing.');
} else if (calmRest !== 0) {
  fail(`EXEMPT — the ordinary lead plays ${calmRest} tune hap(s) on a sustain rest bar; \`yieldToBass\` is not resting it.`);
} else if (bossRest === 0) {
  fail('EXEMPT — the boss lead is silent on the sustain rest bar. The leitmotif has lost its exemption from `yieldToBass`.');
} else {
  console.log('  ok   exempt — the ordinary lead rests on the bar and the boss lead plays through it');
}

/* ------------------------------------------------------------- 3. weight */

/*
 * The body's transposition is read against the tune at the same onset, so
 * the assertion is "an octave under THIS note" and not "a sawtooth somewhere".
 */
function bodyOctaves(evs) {
  const tuneAt = new Map();
  for (const e of tune(evs)) tuneAt.set(e.begin.toFixed(3), midi(e));
  const out = { 12: [], 24: [], other: [] };
  for (const e of evs) {
    if (e.s !== 'sawtooth' || !Number.isFinite(midi(e))) continue;
    const t = tuneAt.get(e.begin.toFixed(3));
    const off = t === undefined ? NaN : t - midi(e);
    (out[off] ?? out.other).push(typeof e.gain === 'number' ? e.gain : NaN);
  }
  return out;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const phase0 = bodyOctaves(notesIn(L.buildLead(state({ section: 'build', bossPhase: 0 })), 1));
const phase2 = bodyOctaves(notesIn(L.buildLead(state({ section: 'build', bossPhase: 2 })), 1));
const calmBody = bodyOctaves(notesIn(L.buildLead(state({ section: 'build', ...CALM })), 1));
const calmSaw = calmBody[12].length + calmBody[24].length + calmBody.other.length;
console.log(
  `\n  weight — body haps under the tune: -12 x${phase0[12].length} (gain ${mean(phase0[12]).toFixed(2)} -> ${mean(phase2[12]).toFixed(2)} by phase 2), ` +
    `-24 x${phase0[24].length} (gain ${mean(phase0[24]).toFixed(2)} -> ${mean(phase2[24]).toFixed(2)}), ` +
    `other sawtooth x${phase0.other.length}; ordinary sawtooth x${calmSaw}`,
);
if (phase0[12].length === 0 || phase0[24].length === 0) {
  fail(`WEIGHT — the boss body is missing an octave: -12 x${phase0[12].length}, -24 x${phase0[24].length}. A boss is scored for low brass, three octaves deep.`);
} else if (calmSaw !== 0) {
  fail(`WEIGHT — ${calmSaw} sawtooth hap(s) under the ordinary tune. The body is the boss's; outside a fight it is a second lead in the wrong octave.`);
} else if (!(mean(phase2[12]) > mean(phase0[12]) && mean(phase2[24]) > mean(phase0[24]))) {
  fail(
    `WEIGHT — the body does not deepen with the phase: -12 ${mean(phase0[12]).toFixed(3)} -> ${mean(phase2[12]).toFixed(3)}, ` +
      `-24 ${mean(phase0[24]).toFixed(3)} -> ${mean(phase2[24]).toFixed(3)}. A fight should get heavier as it goes.`,
  );
} else {
  console.log('  ok   weight — both octaves under the tune, only in a boss, and louder by phase 2');
}

/* --------------------------------------------------------------- 4. thin */

const bossLead = notesIn(L.buildLead(state({ section: 'build' })), 1);
const bossOsc = new Set(bossLead.map((v) => v.s).filter(Boolean));
console.log(`\n  lead sources in a boss — {${[...bossOsc].join(' ')}} over ${bossLead.length} haps`);
if (bossLead.length === 0) fail('THIN — the boss lead produced no haps at all.');
else if (bossOsc.has('triangle')) fail('THIN — the boss tune is still on a triangle. There is no warmth in the adversary anywhere.');
else console.log('  ok   thin — no triangle survives into a boss');

console.log('');
console.log(failed ? 'BOSSCHECK FAILS' : 'BOSSCHECK HOLDS — the fight has its own tune, plays through the rests, and gets heavier');
process.exit(failed ? 1 : 0);
