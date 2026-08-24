/*
 * motion — are the other lines actually independent of the tune?
 *
 * `counterpoint.mjs` asks the RHYTHMIC question: does the arp fill the melody's
 * rests instead of running over it. `interlock.mjs` asks how much everything
 * attacks at the same instant. Neither asks the MELODIC one, which is the older
 * and more basic test of whether you have two voices or one:
 *
 *   **when the tune moves, which way does the other line go?**
 *
 * Four answers, and the mix of them is what separates counterpoint from
 * doubling:
 *
 *   CONTRARY  they move in opposite directions. The strongest evidence of two
 *             independent voices, and the thing species counterpoint spends its
 *             whole first chapter on.
 *   OBLIQUE   one holds while the other moves. Also independence — a pedal or a
 *             sustained note under a moving line is two parts, not one.
 *   SIMILAR   same direction, different distance. Weak independence.
 *   PARALLEL  same direction, SAME interval. This is not a second voice at all;
 *             it is the first voice thickened. A lane in consistent parallel
 *             with the melody costs a slot and adds no line.
 *
 * The canon this score is aiming at is full of contrary and oblique motion —
 * that is what makes a Mitsuda bassline a tune rather than a root generator,
 * and it is why those scores sound like several players rather than one patch.
 *
 * There is no pass mark, deliberately, for the same reason `interlock` has
 * none: parallel motion is not a defect in itself. A parallel third for two
 * bars is an effect; a lane that is 80% parallel across an entire phrase is a
 * doubling wearing a second lane's clothes. Read the proportions, change a
 * part, read them again.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const layers = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

/** Everything pitched that could in principle be a second voice against the tune. */
const LANES = {
  bass: layers.buildBass,
  motor: layers.buildMotor,
  chords: layers.buildChords,
  arp: layers.buildArp,
  motifs: layers.buildMotifs,
};

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
/** Sixteenth resolution: the melody carries an ornament on the half-slot, and
 *  `counterpoint.mjs` records what bucketing that too coarsely does to a
 *  rhythmic claim. The same trap applies to a melodic one. */
const GRID = 16;

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
    nextChord: buildChord(57, mode, over.nextDegree ?? 4),
    chordIndex: 0,
    barInPhrase: over.barInPhrase ?? 0,
    phrase: 2,
    feel: 'boomchick',
    bpm: 140,
    intensity: 0.6,
    brightness: 0.5,
    powerups: {},
    enemies: { pluck: 3, rush: 2 },
    boss: false,
    bossPhase: 0,
    wave: 3,
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

/**
 * The pitch each lane is sounding at every grid position of one bar.
 *
 * A voice holds its last pitch until it moves — that is what "oblique motion"
 * means and it cannot be measured from onsets alone. Where a lane plays a chord
 * at once, the TOP note is taken: the ear tracks the top of a texture, and it
 * is the top that either fights the melody or answers it.
 */
function voiceLine(build, m) {
  let evs = [];
  try {
    evs = notesIn(build(m), 1);
  } catch {
    return null;
  }
  const byStep = new Map();
  for (const e of evs) {
    const n = typeof e.note === 'number' ? e.note : Number(e.note);
    if (!Number.isFinite(n)) continue;
    const step = Math.floor(e.begin * GRID + 1e-6);
    if (step < 0 || step >= GRID) continue;
    byStep.set(step, Math.max(byStep.get(step) ?? -Infinity, n));
  }
  if (byStep.size === 0) return null;
  const line = new Array(GRID).fill(null);
  let held = null;
  for (let i = 0; i < GRID; i++) {
    if (byStep.has(i)) held = byStep.get(i);
    line[i] = held;
  }
  return line;
}

const tally = { contrary: 0, oblique: 0, similar: 0, parallel: 0 };
const perLane = new Map();

for (const feel of FEELS) {
  for (const mode of Object.keys(PROGRESSIONS)) {
    const prog = PROGRESSIONS[mode];
    /*
     * Measured across the WHOLE eight-bar phrase, not bar by bar.
     *
     * A per-bar loop starts its comparison at step 1, so the downbeat is never
     * compared against anything — and the downbeat is precisely where
     * `arpGapsFor` makes the arp coincide with the melody on purpose. Measuring
     * bars in isolation therefore excluded the one place those two lines are
     * designed to move together, and reported the arp as 100% oblique.
     *
     * Motion across a barline is also just motion. Splitting on it was an
     * artefact of how the builders are called, not a musical boundary.
     */
    const phraseLead = [];
    const phraseOther = new Map();
    for (let bar = 0; bar < 8; bar++) {
      const degree = prog[bar % prog.length][0];
      const m = state({ feel, mode, degree, barInPhrase: bar });
      const lead = voiceLine(layers.buildLead, m);
      if (!lead) continue;
      phraseLead.push(...lead);

      for (const [name, build] of Object.entries(LANES)) {
        const other = voiceLine(build, m);
        phraseOther.set(name, [...(phraseOther.get(name) ?? []), ...(other ?? new Array(GRID).fill(null))]);
        if (!other) continue;
        const t = perLane.get(name) ?? { contrary: 0, oblique: 0, similar: 0, parallel: 0 };

        perLane.set(name, t);
      }
    }

    // Now compare the concatenated phrase, barlines included.
    for (const [name, other] of phraseOther) {
      const t = perLane.get(name);
      if (!t) continue;
      for (let i = 1; i < phraseLead.length; i++) {
        if (phraseLead[i] === null || phraseLead[i - 1] === null) continue;
        if (other[i] === null || other[i - 1] === null) continue;
        const dL = phraseLead[i] - phraseLead[i - 1];
        const dO = other[i] - other[i - 1];
        // Neither moved: not a motion event at all, and counting these would
        // swamp everything with the held-note case.
        if (dL === 0 && dO === 0) continue;

        let kind;
        if (dL === 0 || dO === 0) kind = 'oblique';
        else if (Math.sign(dL) !== Math.sign(dO)) kind = 'contrary';
        else if (dL === dO) kind = 'parallel';
        else kind = 'similar';

        t[kind]++;
        tally[kind]++;
      }
    }
  }
}

const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log(`motion — melodic independence against the tune, ${total} motion events\n`);

if (total === 0) {
  // A harness that measures nothing passes everything.
  console.log('  NOTHING MEASURED — no lane produced two consecutive pitches. Check the harness.');
  process.exit(1);
}

const pct = (n) => `${((n / total) * 100).toFixed(0)}%`;
console.log(`  overall   contrary ${pct(tally.contrary)}   oblique ${pct(tally.oblique)}   ` +
  `similar ${pct(tally.similar)}   parallel ${pct(tally.parallel)}`);
console.log('\n  against the lead, per lane:');
console.log('    lane       contrary  oblique  similar  parallel   independence');
for (const [name, t] of [...perLane.entries()].sort((a, b) => {
  const ia = (a[1].contrary + a[1].oblique) / Math.max(1, Object.values(a[1]).reduce((x, y) => x + y, 0));
  const ib = (b[1].contrary + b[1].oblique) / Math.max(1, Object.values(b[1]).reduce((x, y) => x + y, 0));
  return ib - ia;
})) {
  const n = Object.values(t).reduce((a, b) => a + b, 0) || 1;
  const indep = (t.contrary + t.oblique) / n;
  const flag = indep < 0.5 ? '  <- tracks the tune more than it answers it' : '';
  console.log(
    `    ${name.padEnd(10)} ${String(`${((t.contrary / n) * 100).toFixed(0)}%`).padEnd(9)}` +
      `${String(`${((t.oblique / n) * 100).toFixed(0)}%`).padEnd(9)}` +
      `${String(`${((t.similar / n) * 100).toFixed(0)}%`).padEnd(9)}` +
      `${String(`${((t.parallel / n) * 100).toFixed(0)}%`).padEnd(10)} ${(indep * 100).toFixed(0)}%${flag}`,
  );
}

console.log(
  '\n  Baseline, 2026-08-22:\n' +
    '    overall  contrary 10%  oblique 81%  similar 9%  parallel 1%\n' +
    '    motor 17% contrary  ·  bass 14%  ·  chords 13%  ·  arp 1%  ·  motifs 0%\n' +
    '\n' +
    '  Read that as a characterisation, not a defect list. Bass, motor and chords\n' +
    '  carry real two-voice writing. `arp` and `motifs` are purely responsorial\n' +
    '  BY DESIGN — `arpGapsFor` makes the arp play where the melody rests — so\n' +
    '  their near-zero contrary share is the design working, not failing. Pushing\n' +
    '  them to overlap the tune is exactly the clutter that complement prevents.\n' +
    '\n' +
    '  One trap already hit here: measuring bar by bar reported the arp at 100%\n' +
    '  oblique, because a per-bar loop starts at step 1 and never compares the\n' +
    '  downbeat — the one place `arpGapsFor` deliberately lets the two coincide.',
);

console.log(
  '\n  Independence is contrary + oblique: the share of the time a lane is doing\n' +
    '  something the tune is not. Parallel motion is not a defect in itself — a\n' +
    '  parallel third for two bars is an effect — but a lane that is mostly\n' +
    '  parallel across a whole phrase is the melody thickened, not a second part,\n' +
    '  and it is spending a voice slot to say nothing new.',
);
