/*
 * rhythm — does every lane say its rhythm with the same two note lengths?
 *
 * `contour` found the melody had exactly two durations and no held note
 * anywhere, which is the difference between a line and a rhythm part. That
 * question was never asked of the other lanes, and a score where every voice
 * articulates on the same uniform grid is a drum machine however good the
 * pitches are — the sustained/detached contrast between parts is most of what
 * makes an arrangement sound like an ensemble rather than a sequencer.
 *
 * Reported per lane, over a whole 8-bar phrase in every mode:
 *   lengths  how many DISTINCT note lengths the lane uses
 *   longest  the longest single note, as a fraction of a bar
 *   legato   share of sounding time vs the phrase (union, not sum)
 *   onsets   attacks per bar — the grid density
 *
 * A lane is not required to be varied: a motor is supposed to be even, and a
 * kick that breathes is a mistake. What is worth knowing is whether ANY
 * sustained voice exists, and whether the pitched lanes all landed on the same
 * two values by accident rather than by decision.
 */
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

const LANES = [
  ['sub', L.buildSub], ['kick', L.buildKick], ['clap', L.buildClap],
  ['motor', L.buildMotor], ['bass', L.buildBass], ['chords', L.buildChords],
  ['arp', L.buildArp], ['lead', L.buildLead],
];

function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  return {
    tension: 0.6, immediate: 0.5, section: 'sustain', buildProgress: 1, fillBar: false,
    bar: 0, tonic: 57, mode, chord: buildChord(57, mode, over.degree ?? 0),
    nextChord: buildChord(57, mode, 4), chordIndex: 0, barInPhrase: over.barInPhrase ?? 0,
    phrase: over.phrase ?? 0, feel: 'boomchick', bpm: 140, intensity: 0.6, brightness: 0.5,
    powerups: {}, enemies: {}, boss: false, bossPhase: 0, wave: over.wave ?? 1, bombs: 0,
    health: 1, grazeRate: 0, combo: 0, leadRegister: 0, movement: null,
    sig: makeSignals(strudel), ...over,
  };
}

const modes = Object.keys(PROGRESSIONS);
/*
 * SAMPLE THE WHOLE SPACE, NOT ONE CELL.
 *
 * The first version fixed feel='boomchick' and intensity=0.6 and reported the
 * bass as 6 onsets/bar at 100% legato with two note lengths — a wall. That is
 * true of that one cell and false of the lane: `buildBass` selects a different
 * written pattern per feel and per intensity band, and the quiet branch is
 * `${low}@4`, a whole-bar held note. Reading one state and calling it "the
 * arrangement" is how a lane gets rewritten to fix a problem it does not have.
 */
const FEELS = ['boomchick', 'halftime', 'chase', 'gallop', 'shuffle'];
const INTENSITIES = [0.2, 0.5, 0.85];
const rows = [];
for (const [name, build] of LANES) {
  const lens = new Set(); let onsets = 0; let bars = 0; let sound = 0;
  for (const mode of modes) for (const feel of FEELS) for (const intensity of INTENSITIES) {
    /*
     * Union PER MODE. The first version pushed every mode's spans onto one
     * shared 0-8 timeline and divided the union by 9x8 bars, so every lane
     * reported about a ninth of its true legato — chords, which holds a
     * full-bar pad, read 11%. Overlapping distinct renderings of the same bar
     * is meaningless; each mode is its own timeline.
     */
    const spans = [];
    for (let b = 0; b < 8; b++) {
      let evs;
      try { evs = build(state({ mode, feel, intensity, tension: intensity, barInPhrase: b, phrase: 2 })).queryArc(0, 1); }
      catch (err) { throw new Error(`${name} threw at ${mode}/${feel}/i=${intensity} bar ${b}: ${err.message}`); }
      bars++;
      /*
       * Collapse simultaneous events to one attack. Several lanes are voiced
       * as chords or doubled an octave down (see the note in contour.mjs), and
       * counting each voice separately would report a triad as three onsets
       * and make a sustained pad look like a busy one.
       */
      const byOnset = new Map();
      for (const e of evs) {
        const t = +e.part.begin;
        const d = +e.part.end - t;
        byOnset.set(t, Math.max(byOnset.get(t) ?? 0, d));
      }
      onsets += byOnset.size;
      for (const [t, d] of byOnset) { lens.add(+d.toFixed(4)); spans.push([b + t, b + t + d]); }
    }
    spans.sort((a, b) => a[0] - b[0]);
    let cur = null;
    for (const [a, b2] of spans) {
      if (!cur || a > cur[1]) { if (cur) sound += cur[1] - cur[0]; cur = [a, b2]; }
      else cur[1] = Math.max(cur[1], b2);
    }
    if (cur) sound += cur[1] - cur[0];
  }
  if (!lens.size) { rows.push([name, 0, '-', '-', '0.0']); continue; }
  const longest = Math.max(...[...lens]);
  rows.push([name, lens.size, longest.toFixed(3), `${(100 * sound / bars).toFixed(0)}%`, (onsets / bars).toFixed(1)]);
}

const H = ['lane', 'lengths', 'longest', 'legato', 'onsets/bar'];
const w = H.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
console.log(`\nrhythm — ${modes.length} modes x ${FEELS.length} feels x ${INTENSITIES.length} intensities x 8 bars per lane\n`);
console.log('  ' + H.map((h, i) => h.padEnd(w[i])).join('  '));
console.log('  ' + w.map((x) => '-'.repeat(x)).join('  '));
for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(w[i])).join('  '));

const pitched = rows.filter((r) => ['sub', 'motor', 'bass', 'chords', 'arp', 'lead'].includes(r[0]));
const sustained = pitched.filter((r) => Number(r[2]) >= 0.25);
console.log(`\n  pitched lanes with a note held at least a quarter-bar: ${sustained.length}/${pitched.length}` +
  (sustained.length ? `  (${sustained.map((r) => r[0]).join(', ')})` : ''));

/*
 * THE ARP IS SUPPOSED TO BE EVEN. Do not "fix" it.
 *
 * It reports exactly one note length in every sampled state, which looks like
 * the same defect `contour` found in the melody and is not. An accompaniment
 * figure in even subdivisions under a melody that sings is the texture the
 * canon this project is aiming at actually runs on — it is what the Chrono
 * Trigger accompaniments do. Uniform arp was never the problem; uniform MELODY
 * was, and that is fixed. Giving the arp varied durations would blur the one
 * contrast that makes the tune read as the tune.
 *
 * So the check is RELATIVE, not absolute: the melody must be rhythmically
 * richer than the figure underneath it. That is the property worth defending,
 * and it fails in both directions — if the lead flattens back to a grid, or if
 * someone decides the arp should get expressive.
 */
const lengthsOf = (n) => Number(rows.find((r) => r[0] === n)?.[1] ?? 0);
const fails = [];
for (const r of rows) if (!r[1]) fails.push(`${r[0]} produced no events at all — harness or lane is broken`);
/*
 * The relative test needs an absolute floor beside it, and finding that out is
 * why this comment exists.
 *
 * Written with only the comparison, this gate PASSED a planted regression: the
 * lead flattened back to two note lengths, which still beats the arp's one, so
 * `lead > arp` held while the exact defect the tool was built to describe was
 * live in the file. A relative invariant is only as strong as the thing it is
 * measured against, and the arp is deliberately the least varied lane there is.
 *
 * `contour` owns the same floor, and the duplication is wanted rather than
 * redundant: contour reads ONE state (boomchick, intensity 0.6) while this
 * samples 5 feels x 3 intensities x 9 modes, so a rhythm that survives only in
 * the cell contour happens to look at gets caught here.
 */
const LEAD_MIN_LENGTHS = 3;
if (lengthsOf('lead') < LEAD_MIN_LENGTHS) {
  fails.push(`lead uses only ${lengthsOf('lead')} note length(s) across every feel and intensity — the tune is back on a grid`);
}
if (lengthsOf('lead') <= lengthsOf('arp')) {
  fails.push(`lead uses ${lengthsOf('lead')} note lengths and the arp uses ${lengthsOf('arp')} — ` +
    'the tune must be rhythmically richer than its accompaniment, or it stops reading as the tune');
}
/*
 * At least one pitched lane must sustain. This is the arrangement-level form
 * of what contour checks for the melody alone: if nothing holds, there is no
 * bed, and every voice is competing in the same transient window.
 */
if (!sustained.length) fails.push('NO pitched lane holds a note as long as a quarter-bar — the whole texture is transients');
console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  the texture has both sustained and articulated voices,');
console.log(`      and the tune (${lengthsOf('lead')} lengths) is richer than the arp (${lengthsOf('arp')})`);
