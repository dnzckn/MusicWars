/*
 * motorcheck — does THE MOTOR emit the notes it was designed to emit?
 *
 * The motor is the change this whole music refactor is built on. The diagnosis
 * was that time was being kept by percussion, which left every pitched lane
 * free to become texture; `buildMotor` moved the pulse out of the drum kit and
 * into a pitched inner voice that keeps time AND states the harmony. It runs
 * constantly, so if it is wrong it is wrong under every single bar of the game.
 *
 * It had never been verified. Not once, in any state. This checks it without a
 * browser — see `tools/lib/headless-audio.mjs` for why that is possible at all.
 *
 * The three properties it asserts are the three the function's own comments
 * promise:
 *
 *   REGISTER   Every note lands in MIDI 57-69, "the octave between bass and
 *              tune, where nothing else lives". This is the entire reason the
 *              lane does not collide with the melody, and the folding code at
 *              the top of `buildMotor` exists to guarantee it.
 *
 *   HARMONY    Away from the deliberate chromatic figures, every note is a
 *              chord tone — that is what makes the motor the comping rather
 *              than a rhythm part that happens to have a pitch.
 *
 *   CONTINUITY The lane never falls silent. It is the clock; a bar with no
 *              notes in it is a dropped beat.
 *
 * Chromatic passing tones are expected in exactly two places and are exempt:
 * the `chase` feel (Pokemon's buzzing run) and the last beat of a fill bar (the
 * turnaround into the next chord). Both are stated in the source as
 * deliberate.
 */
import { makeSignals, notesIn, pc } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const { buildMotor } = await import('../src/audio/layers.ts');
const { buildChord, MODES, PROGRESSIONS, LANE_RANGE } = await import('../src/audio/theory.ts');

/*
 * IMPORTED, NOT RESTATED. These were `const LOW = 57; const HIGH = 69;` — a
 * tool holding its own copy of a constant, which AGENTS.md §3 says "will lie
 * the day it moves". `layers.ts` now takes MOTOR_BOTTOM/MOTOR_TOP from the same
 * table, so the assertion and the builder cannot disagree, and a future
 * narrowing of the motor's window tightens this check automatically instead of
 * silently loosening it.
 */
const LOW = LANE_RANGE.motor.lo;
const HIGH = LANE_RANGE.motor.hi;
const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const MODES_TO_TEST = Object.keys(PROGRESSIONS);

/** A `MusicalState` good enough to build one bar with. */
function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  const tonic = over.tonic ?? 57;
  const degree = over.degree ?? 0;
  const nextDegree = over.nextDegree ?? 4;
  return {
    tension: 0.5,
    immediate: 0.5,
    section: 'sustain',
    buildProgress: 1,
    fillBar: false,
    bar: 0,
    tonic,
    mode,
    chord: buildChord(tonic, mode, degree),
    nextChord: buildChord(tonic, mode, nextDegree),
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
    bossPhase: 0,
    wave: 1,
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
for (const feel of FEELS) {
  for (const mode of MODES_TO_TEST) {
    const prog = PROGRESSIONS[mode];
    for (let i = 0; i < prog.length; i++) {
      const degree = prog[i][0];
      const nextDegree = prog[(i + 1) % prog.length][0];
      for (const fillBar of [false, true]) {
        for (const powerups of [{}, { rapid: 2 }, { nova: 1 }, { timewarp: 1 }]) {
          cases.push({ feel, mode, degree, nextDegree, fillBar, powerups });
        }
      }
    }
  }
}

const outOfRange = [];
const nonChordTone = [];
const silent = [];
let notes = 0;

for (const c of cases) {
  const m = state(c);
  const pattern = buildMotor(m);
  const evs = notesIn(pattern, 1);
  if (evs.length === 0) {
    silent.push(c);
    continue;
  }
  notes += evs.length;

  const chordPcs = new Set(m.chord.notes.map(pc));
  // The two places a chromatic tone is deliberate.
  const chromaticOk = c.feel === 'chase' || c.fillBar;

  for (const e of evs) {
    const n = typeof e.note === 'number' ? e.note : Number(e.note);
    if (!Number.isFinite(n)) continue;
    if (n < LOW || n > HIGH) {
      outOfRange.push({ ...c, note: n, at: e.begin });
    }
    if (!chromaticOk && !chordPcs.has(pc(n))) {
      nonChordTone.push({ ...c, note: n, at: e.begin });
    }
  }
}

const label = (v) =>
  `${v.feel}/${v.mode}/deg${v.degree}${v.fillBar ? '/fill' : ''}` +
  `${Object.keys(v.powerups).length ? `/${Object.keys(v.powerups).join('+')}` : ''}`;

/** Collapse many identical findings into one line with a count. */
function summarise(list, describe) {
  const groups = new Map();
  for (const v of list) {
    const k = describe(v);
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  return [...groups.entries()].sort((a, b) => b[1] - a[1]);
}

console.log(`motorcheck — ${cases.length} states, ${notes} note events\n`);

let failed = false;

if (silent.length) {
  failed = true;
  console.log(`  SILENT — the clock stopped in ${silent.length} state(s):`);
  for (const [k, n] of summarise(silent, label).slice(0, 8)) console.log(`    ${k}  x${n}`);
} else {
  console.log('  ok   continuity — every state produces notes');
}

if (outOfRange.length) {
  failed = true;
  const lo = Math.min(...outOfRange.map((v) => v.note));
  const hi = Math.max(...outOfRange.map((v) => v.note));
  console.log(
    `\n  REGISTER — ${outOfRange.length} note(s) outside ${LOW}-${HIGH}, spanning ${lo}-${hi}:`,
  );
  for (const [k, n] of summarise(outOfRange, (v) => `${label(v)}  note ${v.note}`).slice(0, 10)) {
    console.log(`    ${k}  x${n}`);
  }
} else {
  console.log(`  ok   register — every note inside ${LOW}-${HIGH}`);
}

if (nonChordTone.length) {
  failed = true;
  console.log(`\n  HARMONY — ${nonChordTone.length} non-chord-tone(s) outside the exempt figures:`);
  for (const [k, n] of summarise(nonChordTone, (v) => `${label(v)}  note ${v.note}`).slice(0, 10)) {
    console.log(`    ${k}  x${n}`);
  }
} else {
  console.log('  ok   harmony — every note is a chord tone, outside chase and fill bars');
}

console.log(
  failed
    ? '\nMOTOR IS OUT OF SPEC'
    : '\nMOTOR HOLDS — register, harmony and continuity all as designed',
);
process.exit(failed ? 1 : 0);
