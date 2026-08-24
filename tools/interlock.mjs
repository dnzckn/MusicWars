/*
 * interlock — do the parts play WITH each other, or all AT the same instants?
 *
 * This measures the thing "cheap techno" actually names. It is not about
 * timbre, and it is not about levels; both of those have been worked over. It
 * is about coincidence. In dance production every lane is locked to the same
 * grid and the parts attack together, which is why the result reads as one
 * thick object pulsing rather than as several players. In the reference canon —
 * Chrono Trigger, Wily Stage 1, Frog's Theme, Pokemon R/B — the parts
 * interlock: where the tune moves the accompaniment waits, the bass answers
 * between the melody's notes, and the inner voice fills what the others leave.
 * Those scores are sparse per-instant and dense over time. A techno arrangement
 * is the reverse.
 *
 * So three numbers, none of which needs a listener to agree with a taste claim:
 *
 *   PILE-UP    Mean number of lanes attacking on the same instant, counted
 *              only over instants where anything attacks at all. 1.0 would be
 *              perfect counterpoint; the drums alone guarantee more than that.
 *              What matters is whether it FALLS as parts are added, which is
 *              what interlocking means.
 *
 *   DOWNBEAT   How many lanes hit beat one together. Everything landing on the
 *              downbeat is the single loudest signature of the genre, and it is
 *              also the one place where some coincidence is correct — the
 *              question is how much.
 *
 *   OFF-GRID   Fraction of onsets NOT on a quarter-note. A score where
 *              everything sits on the four beats has no groove to speak of;
 *              syncopation, offbeats and triplets are what the ear hears as
 *              rhythm rather than as a metronome.
 *
 * There is no pass/fail threshold here on purpose. These are comparative
 * numbers: run them, change the arrangement, run them again. The failure mode
 * of a made-up threshold is that someone tunes to satisfy it.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const layers = await import('../src/audio/layers.ts');
const { buildChord } = await import('../src/audio/theory.ts');

/* The pitched lanes plus the kit, addressed the way the director addresses
 * them. `hats` is THE MOTOR — a pitched inner voice, not a hi-hat. */
const LANES = {
  kick: layers.buildKick,
  clap: layers.buildClap,
  motor: layers.buildMotor,
  bass: layers.buildBass,
  chords: layers.buildChords,
  arp: layers.buildArp,
  lead: layers.buildLead,
};

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
/** Quantise to a 48th so triplets and sixteenths both land cleanly. */
const Q = 48;
const q = (t) => Math.round(t * Q);

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
    chord: buildChord(57, mode, 0),
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
    sig: makeSignals(strudel),
    ...over,
  };
}

/*
 * An onset only counts if the ear hears an ATTACK there.
 *
 * This distinction decides whether the whole measurement is honest. A note
 * event is not an accent: the pad enters with `attack(0.45)`, a swell that
 * takes nearly half a second to arrive, and counting it the same as a kick
 * would say the pad "hits the downbeat" when nothing audible happens there at
 * all. Left uncorrected, the tool would have reported a downbeat pile-up caused
 * largely by sustaining lanes and invited a fix to a part that is already doing
 * the right thing.
 *
 * 50ms is the rough boundary where a rising envelope stops being heard as a
 * transient and starts being heard as a swell.
 */
const ACCENT_ATTACK = 0.05;
const isAccent = (e) => {
  const a = typeof e.attack === 'number' ? e.attack : Number(e.attack);
  return !Number.isFinite(a) || a <= ACCENT_ATTACK;
};

function measure(m) {
  /** lane -> Set of quantised onset positions in the bar */
  const onsets = new Map();
  for (const [name, build] of Object.entries(LANES)) {
    let evs = [];
    try {
      evs = notesIn(build(m), 1);
    } catch {
      continue; // a lane that cannot build in this state simply is not playing
    }
    onsets.set(
      name,
      new Set(
        evs
          .filter(isAccent)
          .map((e) => q(e.begin))
          .filter((t) => t >= 0 && t < Q),
      ),
    );
  }

  /** instant -> how many lanes attack there */
  const hits = new Map();
  for (const set of onsets.values()) {
    for (const t of set) hits.set(t, (hits.get(t) ?? 0) + 1);
  }

  const instants = [...hits.keys()];
  const totalOnsets = [...hits.values()].reduce((a, b) => a + b, 0);
  const pileUp = instants.length ? totalOnsets / instants.length : 0;
  const downbeat = hits.get(0) ?? 0;

  const QUARTERS = new Set([0, Q / 4, Q / 2, (3 * Q) / 4]);
  let onQuarter = 0;
  for (const [t, n] of hits) if (QUARTERS.has(t)) onQuarter += n;
  const offGrid = totalOnsets ? 1 - onQuarter / totalOnsets : 0;

  return { pileUp, downbeat, offGrid, totalOnsets, instants: instants.length, onsets };
}

console.log('interlock — how much do the lanes attack together?\n');
console.log('  feel        intensity   onsets   instants   pile-up   downbeat   off-grid');
console.log('  ' + '-'.repeat(76));

const rows = [];
for (const feel of FEELS) {
  for (const intensity of [0.3, 0.6, 0.9]) {
    const r = measure(state({ feel, intensity }));
    rows.push({ feel, intensity, ...r });
    console.log(
      `  ${feel.padEnd(12)}${String(intensity).padEnd(12)}` +
        `${String(r.totalOnsets).padEnd(9)}${String(r.instants).padEnd(11)}` +
        `${r.pileUp.toFixed(2).padEnd(10)}${String(r.downbeat).padEnd(11)}` +
        `${(r.offGrid * 100).toFixed(0)}%`,
    );
  }
}

const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
console.log(
  `\n  mean pile-up ${mean((r) => r.pileUp).toFixed(2)} lanes per attacked instant` +
    `   ·   mean downbeat ${mean((r) => r.downbeat).toFixed(1)} lanes` +
    `   ·   mean off-grid ${(mean((r) => r.offGrid) * 100).toFixed(0)}%`,
);

/*
 * Which pairs of lanes shadow each other. Two parts that attack together most
 * of the time are not two parts — they are one part with a thicker timbre, and
 * they cost two voices to say one thing. This is where an interlocking problem
 * is actually actionable, because it names the pair to separate.
 */
console.log('\n  Lane pairs that attack together most often (of the smaller lane\'s onsets):');
const pairScores = new Map();
for (const r of rows) {
  const names = [...r.onsets.keys()];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = r.onsets.get(names[i]);
      const b = r.onsets.get(names[j]);
      const smaller = Math.min(a.size, b.size);
      if (smaller === 0) continue;
      let shared = 0;
      for (const t of a) if (b.has(t)) shared++;
      const key = `${names[i]}+${names[j]}`;
      const prev = pairScores.get(key) ?? { sum: 0, n: 0 };
      pairScores.set(key, { sum: prev.sum + shared / smaller, n: prev.n + 1 });
    }
  }
}
const ranked = [...pairScores.entries()]
  .map(([k, v]) => [k, v.sum / v.n])
  .sort((a, b) => b[1] - a[1]);
for (const [k, v] of ranked.slice(0, 8)) {
  console.log(`    ${k.padEnd(18)} ${(v * 100).toFixed(0)}%`);
}
console.log(
  '\n  These are comparative numbers, not a pass mark. Record them, change the\n' +
    '  arrangement, compare. A pair near 100% is one part wearing two costumes.',
);

/*
 * TWO LIMITS, so nobody reads more into these numbers than they carry.
 *
 * 1. GAIN IS IGNORED. An onset counts whether the lane is at full level or
 *    faded to nothing. The motor's sixteenth layer, for instance, is always
 *    present in the pattern and rides `sig.fill` for its level — so it shows up
 *    here even in states where it is effectively inaudible. Treat the off-grid
 *    figure as an upper bound on rhythmic activity.
 *
 * 2. THE MOTOR DOMINATES THE PAIR TABLE BY CONSTRUCTION. It is the clock: it
 *    attacks more often than anything else, so any other lane's onsets land on
 *    one of its onsets most of the time. `motor+lead 90%` is not evidence that
 *    the two are doubling — read the pairs that do NOT involve the motor.
 */
console.log(
  '\n  Baseline, 2026-08-22, after the fourfloor motor became a boom-chick:\n' +
    '    fourfloor  pile-up 3.63-3.44  off-grid 34-42%   (was 3.88-3.67, 28-39%)\n' +
    '    swing      pile-up 2.19-2.38  off-grid 61-63%   — the most interlocked feel\n' +
    '    gallop     pile-up 3.63-2.83  off-grid 28-38%   — now the most grid-locked\n' +
    '  Gain is not considered, and the motor dominates the pair table by design.',
);
