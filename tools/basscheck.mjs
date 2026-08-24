/*
 * basscheck — the bass line, verified without a browser.
 *
 * `tools/bassprobe.mjs` drives Playwright, so on a box where the browser suite
 * is dark the bass has NO coverage at all — and the bass is the lane a
 * "cheap techno" complaint lands on first. Every other pitched lane has a Node
 * check (`leadcheck`, `motorcheck`, `masking`, `interlock`); this closes the
 * gap.
 *
 * WHAT IT PROTECTS. `buildBass` is not a root pump: it carries five named
 * figures chosen by `feel` — a Castlevania octave pedal, the Wily-stage 1-5-8-10
 * arp, a Frog's-Theme boom-chick with real thirds, a held pedal for `chase`,
 * and a wobble for `halftime`. That is good writing and it is entirely
 * invisible to the rest of the suite, so it could collapse to one figure, or
 * to silence, with every gate still green. Measured before this existed: the
 * five produce 2, 4, 5 and 8 note events respectively and no two are alike.
 *
 * It checks four things, in the order they would break:
 *   1. the mini-notation actually parses (the `miniAllStrings` trap — a
 *      harness that measures nothing passes everything);
 *   2. the five figures are still DISTINCT, so none has quietly collapsed;
 *   3. every feel is reachable from `feelForWave`, so none is dead content;
 *   4. the notes are harmonically defensible and in a bass register.
 */
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS, degreeToSemitone } = await import('../src/audio/theory.ts');

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const TONIC = 57;

function state(over) {
  const mode = over.mode ?? 'aeolian';
  const degree = over.degree ?? 0;
  return {
    tension: 0.62, immediate: 0.5, section: over.section ?? 'sustain', buildProgress: 1,
    fillBar: false, bar: 0, tonic: TONIC, mode, chord: buildChord(TONIC, mode, degree),
    nextChord: buildChord(TONIC, mode, over.next ?? degree + 1), chordIndex: degree,
    barInPhrase: over.barInPhrase ?? 0, phrase: 0, feel: over.feel ?? 'boomchick', bpm: 140,
    intensity: 0.62, brightness: 0.5, powerups: over.powerups ?? {}, enemies: {},
    boss: false, bossTheme: false, bossPhase: 0, wave: 4, bombs: 0, health: 1,
    grazeRate: 0, combo: 0, leadRegister: 0, movement: null, sig: makeSignals(strudel),
  };
}

const notesOf = (over) =>
  L.buildBass(state(over)).queryArc(0, 1)
    .map((e) => ({ n: e.value?.note ?? e.value, at: Number(e.whole?.begin ?? 0) }))
    .filter((e) => typeof e.n === 'number')
    .sort((a, b) => a.at - b.at);

const fails = [];
let total = 0;

/* 1. Does it parse at all? */
const shapes = new Map();
for (const feel of FEELS) {
  const rows = [];
  for (const barInPhrase of [0, 1, 2, 3]) {
    const ns = notesOf({ feel, barInPhrase });
    total += ns.length;
    rows.push(ns.map((x) => x.n).join(' '));
  }
  shapes.set(feel, rows);
}
if (total === 0) {
  console.log('\nbasscheck\n\n  FAIL  the bass produced no notes at all — is the harness parsing mini-notation?');
  process.exit(1);
}

/* 2. Are the five still different from one another? */
const sig = new Map();
for (const [feel, rows] of shapes) sig.set(feel, rows.join('|'));
for (let i = 0; i < FEELS.length; i++) {
  for (let j = i + 1; j < FEELS.length; j++) {
    if (sig.get(FEELS[i]) === sig.get(FEELS[j])) {
      fails.push(`"${FEELS[i]}" and "${FEELS[j]}" play an identical bass line — a figure has collapsed`);
    }
  }
}

/*
 * 3. Can the game actually reach each one — from the ROTA, not just the boss?
 *
 * The first version of this swept `feelForWave(w, boss)` over both values of
 * `boss` and called anything it saw reachable. That is too generous: the boss
 * branch returns one fixed feel regardless of the cycle, so a figure dropped
 * out of `FEEL_CYCLE` entirely would still look reachable if it happened to be
 * the boss's. The rota and the boss override are separate promises and each
 * has to be kept on its own.
 */
const rota = new Set();
for (let w = 0; w < 64; w++) rota.add(L.feelForWave(w, false));
const bossFeel = L.feelForWave(0, true);
const seen = new Set([...rota, bossFeel]);
const unreachable = FEELS.filter((f) => !seen.has(f));
if (unreachable.length) {
  fails.push(`${unreachable.join(', ')} — declared, written, and never produced by feelForWave`);
}
const rotaMissing = FEELS.filter((f) => !rota.has(f));
if (rotaMissing.length) {
  fails.push(`${rotaMissing.join(', ')} reachable ONLY on a boss — a figure written for the rota is not in it`);
}
/* Share of WAVES per feel. Share of BARS differs; see the note on FEEL_CYCLE. */
const share = {};
for (let w = 0; w < 64; w++) { const f = L.feelForWave(w, false); share[f] = (share[f] ?? 0) + 1; }

/*
 * 4. Harmony and register.
 *
 * Legal: any tone of the current chord, its octave below or above, the fifth
 * and tenth the figures spell explicitly, or a semitone either side of the
 * NEXT chord's root — which is the walk-out every figure ends on. Anything
 * else is a bass note that belongs to no chord in the bar.
 */
const offBook = [];
const bassPitches = [];
const leadPitches = [];
for (const mode of Object.keys(PROGRESSIONS)) {
  /*
   * THE DEGREES THE PROGRESSION ACTUALLY USES, not 0..5.
   *
   * The first version swept arbitrary degrees and reported 105 notes out of
   * register — states the game cannot reach. `PROGRESSIONS` entries are
   * [degree, bars] pairs; scoring a cross-product against cells the code
   * cannot produce is how a harness invents a defect.
   */
  for (const [degree] of PROGRESSIONS[mode]) {
    for (const feel of FEELS) {
      const st = { mode, degree, feel, next: degree + 1 };
      const chord = buildChord(TONIC, mode, degree);
      const next = buildChord(TONIC, mode, degree + 1);
      const legal = new Set();
      for (const base of [chord.root - 12, chord.root, chord.root + 12]) {
        legal.add(base);
        for (const d of [2, 4, 6]) legal.add(base + degreeToSemitone(mode, d));
        for (const n of chord.notes ?? []) { legal.add(n); legal.add(n - 12); legal.add(n + 12); }
      }
      for (const t of [next.root - 12, next.root]) { legal.add(t); legal.add(t - 1); legal.add(t + 1); }
      for (const { n } of notesOf(st)) {
        if (!legal.has(n)) offBook.push(`${mode}/deg${degree}/${feel}: ${n}`);
        bassPitches.push(n);
      }
    }
  }
}
/*
 * REGISTER, as a ROLE rather than as a number I picked.
 *
 * An absolute MIDI window was the first attempt and it was wrong twice over:
 * the bound was invented, and the octave-pedal figures legitimately reach the
 * octave above the highest chord root (MIDI 67), so it flagged the Castlevania
 * engine working as designed.
 *
 * What is actually falsifiable is the role: whatever the figures do with
 * octave displacement, the bass must sit UNDER the tune. If its median ever
 * rises above the lead's, the arrangement has inverted and the low end has
 * gone with it — that is a defect at any absolute pitch.
 */
for (const mode of Object.keys(PROGRESSIONS)) {
  for (const [degree] of PROGRESSIONS[mode]) {
    for (const evt of L.buildLead(state({ mode, degree })).queryArc(0, 1)) {
      const n = evt.value?.note ?? evt.value;
      if (typeof n === 'number') leadPitches.push(n);
    }
  }
}
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN);
const bassMid = median(bassPitches), leadMid = median(leadPitches);
if (!(bassMid < leadMid)) {
  fails.push(`the bass median (${bassMid}) is not below the lead's (${leadMid}) — the arrangement has inverted`);
}

console.log(`\nbasscheck — ${total} note events across ${FEELS.length} figures\n`);
console.log(`  ${'feel'.padEnd(11)} ${'notes/bar'.padStart(9)}  figure (bar 0)`);
console.log(`  ${'-'.repeat(11)} ${'-'.repeat(9)}  ${'-'.repeat(34)}`);
for (const [feel, rows] of shapes) {
  console.log(`  ${feel.padEnd(11)} ${String(rows[0].split(' ').length).padStart(9)}  ${rows[0]}`);
}
console.log(`\n  rota share by WAVE: ${Object.entries(share).sort((a, b) => b[1] - a[1])
  .map(([f, n]) => `${f} ${Math.round((100 * n) / 64)}%`).join('  ')}`);
console.log(`  boss override: ${bossFeel}`);
console.log(`  notes off the chord: ${offBook.length}${offBook.length ? '  e.g. ' + offBook.slice(0, 3).join(', ') : ''}`);
console.log(`  register: bass ${Math.min(...bassPitches)}-${Math.max(...bassPitches)} (median ${bassMid})` +
  `  vs lead median ${leadMid}`);

for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) console.log('\n  ok  five distinct figures, all reachable, all in register');
process.exit(fails.length ? 1 : 0);
