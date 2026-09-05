/*
 * masking — where do two lanes sound a semitone apart at the same instant?
 *
 * This is the "music clutter" complaint, measured. It is a different question
 * from the one `clash.mjs` answers, and the difference matters:
 *
 *   clash    is HORIZONTAL and hypothetical. It asks whether a melody note is
 *            a chord tone, from the tables, without building a pattern. It
 *            knows nothing about what any other lane is doing.
 *
 *   masking  is VERTICAL and actual. It builds every lane, queries the real
 *            events, and asks what is literally sounding together — including
 *            notes still ringing from earlier beats, which is where mud
 *            actually comes from and which no reading of the source reveals.
 *
 * Two notes a semitone or a tone apart in the same register do not sound like
 * two notes. They fall inside one critical band on the basilar membrane, beat
 * against each other, and the ear reports roughness rather than pitch. A score
 * can be harmonically impeccable on paper and still be mud, because the pad is
 * holding a seventh while the melody arrives on the root above it.
 *
 * WHAT IS AND IS NOT A DEFECT:
 *
 *   0 semitones   Unison or octave — a doubling, and deliberate. The lead is
 *                 built as a triangle over a sawtooth an octave down for
 *                 exactly this reason. Not counted.
 *   1-2 semitones In the same octave, this is roughness. Counted.
 *                 A ninth (14) is NOT — spacing is what makes an added ninth
 *                 a colour instead of a clash, so only close spacing counts.
 *   3+            Consonant enough that the ear separates the voices. Ignored.
 *
 * Percussion is excluded: `kick` and `clap` are noise and transient, they have
 * no pitch to mask with.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const layers = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

/** Pitched lanes only. `hats` is THE MOTOR — a pitched inner voice. */
const LANES = {
  motor: layers.buildMotor,
  bass: layers.buildBass,
  chords: layers.buildChords,
  arp: layers.buildArp,
  lead: layers.buildLead,
};

/*
 * Which stem fader each lane sits behind, so roughness can be weighted by how
 * audible it actually is.
 *
 * Counting collisions unweighted answers "do these notes collide", which is
 * necessary but not sufficient: two lanes grinding at a semitone matters
 * enormously if both are at full level and not at all if one is faded out. The
 * first version of this tool ignored that, and it is exactly why the largest
 * finding it produced — the pad against the melody — could not be acted on.
 * `stemLevel` is a pure function of the curve and the tension, so the whole
 * mix's audibility is reproducible here without a single audio node.
 */
const LANE_STEM = { motor: 'hats', bass: 'bass', chords: 'chords', arp: 'arp', lead: 'lead' };

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
/** Below this many semitones apart, two voices are inside one critical band. */
const ROUGH = 2;
/** Ignore anything this far apart or more; the ear separates them cleanly. */
const EPS = 1e-6;

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
    barInPhrase: over.barInPhrase ?? 0,
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

/**
 * How many bars of the phrase to sample. Eight is the full phrase — see the
 * note in `soundingNotes`.
 */
const BARS_SAMPLED = 8;

/** Every sounding note across the phrase, tagged with its lane. */
function soundingNotes(m) {
  const out = [];
  /*
   * EIGHT STATES, one per bar of the phrase — not eight cycles of one state.
   *
   * A theme is `a a2 b b2 a a2 c tag`, and `cellForBar(theme, phrase,
   * barInPhrase)` picks which cell sounds. `barInPhrase` is a FIELD ON THE
   * STATE, so querying more cycles of a pattern built from one state just
   * repeats that state's bar: the first attempt at this fix asked for eight
   * cycles, got a number 11x larger, and was still completely blind to a
   * change in `a2`. Rebuilding the lane per bar is the only thing that moves
   * the cell.
   *
   * Why it matters: this tool reported an identical 917.8 before and after a
   * pass that rebuilt five themes, because the single cell it sampled (`a`, at
   * bar 0) was the one cell that pass happened not to change. The metric was
   * live throughout — perturbing `a` moves it — it was pointed at a keyhole.
   *
   * Note times are offset by the bar index so `overlaps` cannot pair a note in
   * bar 1 with one in bar 6.
   */
  for (let bar = 0; bar < BARS_SAMPLED; bar++) {
    const mb = { ...m, barInPhrase: bar };
    for (const [lane, build] of Object.entries(LANES)) {
      let evs = [];
      try {
        evs = notesIn(build(mb), 1);
      } catch (err) {
        /*
         * A LANE THAT THROWS IS NOT A LANE WITH NO NOTES.
         *
         * This used to `continue` silently, which meant a broken builder read
         * as an improvement: while editing `buildChords` I left a dangling
         * reference, the chords lane threw on every state, and this tool
         * happily reported 410.1 per bar against a true 1137.5 — a 64% "win"
         * that was the largest lane vanishing. `tsc` caught the real error, but
         * the number was already on screen and would have been believed.
         */
        throw new Error(
          `lane '${lane}' threw while building (bar ${bar}): ${String(err).split('\n')[0]}\n` +
            '  A masking score with a lane missing is meaningless — fix the builder, do not skip it.',
        );
      }
      for (const e of evs) {
        const n = typeof e.note === 'number' ? e.note : Number(e.note);
        if (!Number.isFinite(n)) continue;
        /*
         * How long the note actually rings, not how long its event is. A
         * pattern event ends at the next step, but `sustain` and `release`
         * decide whether the voice is still sounding into the following beat —
         * which is exactly how a pad ends up masking a melody note that "isn't
         * playing at the same time" according to the pattern.
         */
        const sustain = typeof e.sustain === 'number' ? e.sustain : 0;
        const release = typeof e.release === 'number' ? e.release : 0;
        const rings = Math.max(e.end - e.begin, sustain + release > 0 ? (e.end - e.begin) * (1 + sustain) : 0);
        out.push({ lane, note: n, begin: bar + e.begin, end: bar + e.begin + rings, gain: e.gain ?? 1 });
      }
    }
  }
  return out;
}

const overlaps = (a, b) => a.begin < b.end - EPS && b.begin < a.end - EPS;

const TENSIONS = [0.35, 0.6, 0.85];
/*
 * `--section=breakdown` (or intro, build, drop, fill; default sustain, which
 * is what every figure in this file's history was measured in). Added
 * 2026-09-05 with the chords bed, which sounds ONLY in intro/build/breakdown
 * and under hush: a sustain-only sweep is structurally blind to it, and the
 * spec for that pass asks for the bass+chords pair in the breakdown AND in the
 * drop, where the bed is absent and the pair must therefore read exactly as
 * before. The default is unchanged so the numbers above stay comparable.
 */
const SECTION = (process.argv.find((a) => a.startsWith('--section=')) ?? '--section=sustain').slice('--section='.length);
const cases = [];
for (const feel of FEELS) {
  for (const mode of Object.keys(PROGRESSIONS)) {
    const prog = PROGRESSIONS[mode];
    for (let i = 0; i < prog.length; i++) {
      for (const tension of TENSIONS) cases.push({ feel, mode, degree: prog[i][0], tension, section: SECTION });
    }
  }
}

let pairsChecked = 0;
const rough = [];

for (const c of cases) {
  const notes = soundingNotes(state(c));
  const level = Object.fromEntries(
    Object.keys(LANES).map((lane) => [lane, layers.stemLevel(LANE_STEM[lane], c.tension)]),
  );
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const a = notes[i];
      const b = notes[j];
      if (a.lane === b.lane) continue; // within-lane spacing is the builder's business
      if (!overlaps(a, b)) continue;
      pairsChecked++;
      const d = Math.abs(a.note - b.note);
      // A ninth is a colour, a second is mud. Only close spacing counts.
      if (d >= 1 && d <= ROUGH) {
        /*
         * Severity is the QUIETER of the two voices. Roughness is something
         * two sounds do to each other, so it is bounded by whichever is
         * closer to inaudible — a full-level melody grinding against a pad
         * that has faded out is not a defect anyone can hear.
         */
        const weight = Math.min(level[a.lane] * (a.gain ?? 1), level[b.lane] * (b.gain ?? 1));
        rough.push({
          ...c,
          lanes: [a.lane, b.lane].sort().join('+'),
          semis: d,
          at: a.note,
          weight,
        });
      }
    }
  }
}

const totalWeight = rough.reduce((s, r) => s + r.weight, 0);

const rate = pairsChecked ? (rough.length / pairsChecked) * 100 : 0;
console.log(`masking — ${cases.length} states (section ${SECTION}), ${pairsChecked} overlapping cross-lane pairs\n`);
console.log(`  rough pairs (1-${ROUGH} semitones apart, sounding together): ${rough.length}  (${rate.toFixed(1)}%)`);
/*
 * PER BAR, because the raw total now covers eight bars instead of one.
 * Dividing keeps the figure on a familiar scale, but it is NOT the same
 * measurement as the old one: this averages the whole phrase where the old
 * number was bar 0 alone. Treat pre-change figures as a different metric.
 */
console.log(
  `  total audible weight: ${(totalWeight / BARS_SAMPLED).toFixed(1)} per bar` +
    `  (${totalWeight.toFixed(1)} across ${BARS_SAMPLED} bars)`,
);
console.log(
  '  NOTE: this sampled only bar 0 until now, and scored 917.8. Across the'
    + ' whole phrase it is 1137.5 per bar, so the one cell it used to look at'
    + ' was the LEAST rough of the eight and the old figure understated the'
    + ' mix by about 24%. Figures below 1000 in older notes are bar-0-only'
    + ' and are not comparable with these.',
);

if (rough.length) {
  const byPair = new Map();
  for (const r of rough) {
    const prev = byPair.get(r.lanes) ?? { n: 0, w: 0 };
    byPair.set(r.lanes, { n: prev.n + 1, w: prev.w + r.weight });
  }
  console.log('\n  by lane pair            count           audible weight');
  for (const [k, v] of [...byPair.entries()].sort((a, b) => b[1].w - a[1].w)) {
    console.log(
      `    ${k.padEnd(16)} ${String(v.n).padStart(5)}  ${((v.n / rough.length) * 100).toFixed(0).padStart(3)}%` +
        `      ${v.w.toFixed(1).padStart(7)}  ${((v.w / totalWeight) * 100).toFixed(0).padStart(3)}%`,
    );
  }
  console.log(
    '\n  Ranked by weight, not count — that is the ordering worth acting on.\n' +
      '  A pair with many quiet collisions matters less than one with few loud ones.',
  );

  const byFeel = new Map();
  for (const r of rough) byFeel.set(r.feel, (byFeel.get(r.feel) ?? 0) + 1);
  console.log('\n  by feel:');
  for (const [k, n] of [...byFeel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(16)} ${String(n).padStart(5)}`);
  }

  const byRegister = new Map();
  for (const r of rough) {
    const oct = Math.floor(r.at / 12) * 12;
    byRegister.set(oct, (byRegister.get(oct) ?? 0) + 1);
  }
  /*
 * Where each lane actually sits. A collision is two lanes sharing a register,
 * so the ranges are what a fix has to move — and they are cheap to print.
 */
{
  const perLane = new Map();
  for (const c of cases) {
    for (const nte of soundingNotes(state(c))) {
      const cur = perLane.get(nte.lane) ?? [];
      cur.push(nte.note);
      perLane.set(nte.lane, cur);
    }
  }
  console.log('\n  where each lane sits (MIDI) — percentiles, so one stray note cannot');
  console.log('  make a lane look wider than it plays:');
  console.log('    lane      min   p5   p50   p95   max    p5-p95 span');
  const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
  const rows = [...perLane.entries()].map(([lane, arr]) => {
    const a = arr.slice().sort((x, y) => x - y);
    return { lane, min: a[0], p5: q(a, 0.05), p50: q(a, 0.5), p95: q(a, 0.95), max: a[a.length - 1] };
  }).sort((x, y) => x.p50 - y.p50);
  for (const r of rows) {
    console.log(
      `    ${r.lane.padEnd(8)} ${String(r.min).padStart(3)}  ${String(r.p5).padStart(3)}  ` +
      `${String(r.p50).padStart(4)}  ${String(r.p95).padStart(4)}  ${String(r.max).padStart(4)}    ${String(r.p95 - r.p5).padStart(3)}`,
    );
  }
}

/*
 * The worst pair, broken down by where it actually collides.
 *
 * The ranked table above says which pair costs most; it does not say whether
 * the fix is a register move or a voicing change. This splits the top pair by
 * register, which is the difference between "the pad's top voice is sitting in
 * the tune" and "the tune dips into the pad". `at` is one of the two notes and
 * they are within two semitones by definition, so it places the collision to
 * within a tone — ample for choosing an octave.
 */
{
  const top = [...byPair.entries()].sort((a, b) => b[1].w - a[1].w)[0];
  if (top) {
    const [name] = top;
    const hist = new Map();
    for (const r of rough) {
      if (r.lanes !== name) continue;
      const oct = Math.floor(r.at / 12) * 12;
      const cur = hist.get(oct) ?? { n: 0, w: 0 };
      cur.n += 1;
      cur.w += r.weight;
      hist.set(oct, cur);
    }
    console.log(`\n  ${name} (worst pair) by register:`);
    for (const [oct, v] of [...hist.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`    MIDI ${String(oct).padStart(3)}-${oct + 11}   ${String(v.n).padStart(6)} pairs   weight ${v.w.toFixed(1)}`);
    }
  }
}
console.log('\n  by register (MIDI octave of the lower note):');
  for (const [k, n] of [...byRegister.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${String(k).padStart(3)}-${k + 11}          ${String(n).padStart(5)}`);
  }
}

console.log(
  '\n  Unisons and octaves are excluded — those are deliberate doublings, not\n' +
    '  mud. A ninth is excluded too: spacing is what turns a second into a\n' +
    '  colour. What is left is genuine roughness inside one critical band.\n' +
    '  Comparative, like `interlock`: record it, change the voicing, compare.',
);

/*
 * Gain is ignored here, exactly as in `interlock`. A lane faded to nothing
 * still contributes its notes, so these counts are an upper bound — and it is
 * why the most promising fix for the largest finding cannot be scored by this
 * tool at all. See the rejected-fix note in `buildChords`.
 */
console.log(
  '\n  Baseline, 2026-08-22, after the pad opened to fifths under the melody:\n' +
    '    7365 rough pairs (4.1%)   ·   audible weight 915.5\n' +
    '    chords+lead 546.7 (60%)  ·  arp+lead 153.7  ·  lead+motor 114.4\n' +
    '\n' +
    '  How it got here, because two of the three numbers along the way were\n' +
    '  wrong and the record is more useful than the destination:\n' +
    '    1950 / unweighted   the first run. Understated: `makeSignals` handed\n' +
    '                        `register` and `arpOctave` 0.5, and those are\n' +
    '                        SEMITONES — a half-step offset shifted real\n' +
    '                        collisions to 1.5 and 2.5 where the filter missed\n' +
    '                        them. The harness was hiding the defect.\n' +
    '    9636 / weight 1253  the honest reading, once that was fixed.\n' +
    '    7365 / weight 915   after the pad dropped its third while the melody\n' +
    '                        plays. -27% weight with NO level change and no\n' +
    '                        loss of sustain, so it is not a metric being\n' +
    '                        gamed: cutting the pad fader would have scored\n' +
    '                        better and sounded worse.\n' +
    '                        BAR 0 ONLY. The whole-phrase equivalent is 1137.5,\n' +
    '                        which is the number to compare against below.\n' +
    '   10108 / weight 1264  melody allowed to HOLD, tying through every empty\n' +
    '                        slot. +11%, and too blunt: the slots it tied over\n' +
    '                        are the ones `arpGapsFor` gives the arp, so the\n' +
    '                        two lines stopped taking turns.\n' +
    '    9619 / weight 1202  tying only through gaps of 2+ slots — a phrase\n' +
    '                        ending rather than a breath. +5.7% on the\n' +
    '                        1137.5 whole-phrase baseline, and accepted on\n' +
    '                        purpose. The skeleton used to render every slot it\n' +
    '                        did not play as a rest, so the tune was note-rest-\n' +
    '                        note-rest and the score contained exactly two note\n' +
    '                        lengths, the longest an eighth (tools/contour.mjs).\n' +
    '                        A sustained melody overlaps more than a stabbing\n' +
    '                        one does; that is what sustain IS, and the extra\n' +
    '                        weight is the cost of the melody existing as a\n' +
    '                        line rather than as a rhythm part. The alternative\n' +
    '                        was to keep a metric flat by keeping the tune\n' +
    '                        detached, which is the same trade this file\n' +
    '                        already refuses one paragraph up.\n' +
    '\n' +
    '  A register fix was tried and rejected: capping the pad below the tune\n' +
    '  left chords+lead untouched and raised the total, because a ceiling of\n' +
    '  tonic+10 is still a whole tone from a melody based at tonic+12. There\n' +
    '  are four sustained pitched lanes and three registers; no voicing rule\n' +
    '  invents a fourth. What was left to remove was a NOTE, not an octave.',
);
