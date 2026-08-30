/*
 * bosscheck — does a boss fight sound like the ADVERSARY, or like the ordinary
 * track with more layers on it?
 *
 * WHY THIS EXISTS. Before this, `m.boss` reached exactly three places in
 * `layers.ts`: it chose `BOSS_THEME`, it nudged the lead's vibrato rate from
 * 5.1 Hz to 5.6, and it pushed two more sawtooth octaves under the tune. The
 * mode changed to `harmonicMinor` and the tempo moved. Everything else — the
 * groove, the timbres, the accompaniment, the percussion — was the same music.
 * A boss was a louder wave.
 *
 * The owner asked for a specific thing by name: a Lavender Town cover, "would
 * be sick for a boss fight". That cue's character is not its notes, it is four
 * mechanisms, and this tool asserts that all four reach the haps:
 *
 *   OSTINATO   A four-note high pulse figure of root, fifth, MAJOR SEVENTH and
 *              TRITONE. Two of the most stable intervals there are and two of
 *              the least, repeating and never resolving. In `harmonicMinor` the
 *              major seventh is the mode's own raised leading tone and the
 *              tritone is foreign, so the figure states the mode and then
 *              contradicts it.
 *
 *   WRONGNESS  `vib("1:.5")`. Half a semitone of pitch wobble a whole second
 *              long. `strudel.d.ts` warns that above ~0.5 "the pitch stops
 *              being heard as one note", and AGENTS.md §4 lists superdough's
 *              silent 0.5 default as a trap — this is that value ON PURPOSE and
 *              it is the single most characteristic number in the cue. The gate
 *              exists so nobody "fixes" it to 0.1.
 *
 *   THINNESS   Every voice in the reference is `pulse`. No warmth anywhere: a
 *              pulse has only odd harmonics, it cannot swell, and a lullaby
 *              played on one is wrong before a single note is out of place. So
 *              the boss's tune moves off the triangle and onto a pulse, and its
 *              vibrato slows from 5.6 Hz to 2.5 — a fast narrow vibrato is
 *              expressive, a slow wide one is UNSTEADY.
 *
 *   ONE HIT    `s("white*2").dec(.15).bpf(15e2).bpq(2)` is the entire
 *              percussion of that cue. A resonant band of noise with a pitch
 *              you can almost hear, and it works because it is the only one.
 *
 * AND ONE THING THE REFERENCE DOES THAT NOTHING IN THIS SCORE DID: it gets
 * WORSE PERIODICALLY. `.when("<0!4[1!3 0]>/4", x => x.vib("8:.2")...)` swaps in
 * a shudder and a ramping gain for one phrase in five. That is a musical unit
 * about seventy-five seconds long, which is longer than anything in this file
 * except the key — so it is also the smallest piece of macro structure in the
 * game, and it is checked here.
 *
 * WHY OFF THE HAPS. Every one of these is a control superdough reads or
 * silently ignores, and AGENTS.md §4 is a list of controls that look correct in
 * source and do nothing: `.vibmod()` without `.vib()` is inert, `.detune()` is
 * supersaw-only, `.ds()` leaves attack and release at defaults, and an
 * `.ftype()` beside a `.bpf()` turns the bandpass into a ladder LOWPASS,
 * because `bpMap` maps `model: 'ftype'` exactly as `lpMap` and `hpMap` do
 * (`superdough.mjs:733`). Reading the source cannot see any of that. Every
 * denominator is printed; `checked === 0` fails.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, voiceLead } = await import('../src/audio/theory.ts');

const TONIC = 57;
const MODE = 'harmonicMinor';
/** Root, fifth, major seventh, tritone — Lavender Town's interval set. */
const FIGURE = [0, 7, 11, 6];

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

/** Raw haps, so controls that are not notes (vib, bandf, ftype) are visible. */
function haps(pattern, cycles = 1) {
  try {
    return pattern.queryArc(0, cycles).map((h) => h.value ?? {});
  } catch {
    return [];
  }
}

let failed = false;
const fail = (label, lines = []) => {
  failed = true;
  console.log(`\n  ${label}`);
  for (const l of lines.slice(0, 8)) console.log(`    ${l}`);
  if (lines.length > 8) console.log(`    ... and ${lines.length - 8} more`);
};

console.log('\nbosscheck — the adversary, measured off the haps\n');

/* ------------------------------------------------------------ 1. ostinato */

const bossMotifs = haps(L.buildMotifs(state()));
const calmMotifs = haps(L.buildMotifs(state({ boss: false, bossTheme: false })));

if (bossMotifs.length === 0) {
  fail('OSTINATO — the `motifs` lane is SILENT during a boss. There is no adversary voice at all.');
} else {
  const pulses = bossMotifs.filter((v) => v.s === 'pulse');
  const notes = [...new Set(pulses.map((v) => Number(v.note)).filter(Number.isFinite))].sort((a, b) => a - b);
  const ivs = [...new Set(notes.map((n) => ((((n - TONIC) % 12) + 12) % 12)))].sort((a, b) => a - b);
  const want = [...FIGURE].sort((a, b) => a - b);
  console.log(`  ostinato — ${pulses.length} pulse haps of ${bossMotifs.length} on \`motifs\`, pitches ${notes.join(' ')}`);
  if (pulses.length === 0) {
    fail('OSTINATO — no `pulse` voice on `motifs` during a boss. The figure is the wrong timbre or absent.');
  } else if (ivs.join(',') !== want.join(',')) {
    fail(`OSTINATO — intervals above the tonic are {${ivs}}, want {${want}} (root, fifth, major seventh, tritone).`);
  } else {
    console.log('  ok   ostinato — root, fifth, major seventh and tritone, on a pulse');
  }
  /*
   * ABOVE EVERYTHING. The colour tones are the highest sustained pitches in
   * the score at MIDI 79-91; the figure has to clear them or it is inside the
   * arrangement rather than on top of it.
   */
  if (notes.length && Math.min(...notes) < 79) {
    fail(`OSTINATO REGISTER — lowest note ${Math.min(...notes)} is inside the colour tones' 79-91 window.`);
  } else if (notes.length) {
    console.log(`  ok   register — the figure sits at ${Math.min(...notes)}-${Math.max(...notes)}, clear of every sustained lane`);
  }

  /* ------------------------------------------------------- 2. wrongness */

  const noBoth = pulses.filter((v) => !(typeof v.vib === 'number' && v.vib > 0 && typeof v.vibmod === 'number'));
  if (noBoth.length) {
    fail(
      `VIBRATO — ${noBoth.length} of ${pulses.length} ostinato haps do not carry BOTH vib and vibmod. ` +
        'superdough puts the oscillator behind `if (vib > 0)` and defaults the depth to 0.5 (AGENTS.md §4).',
    );
  } else {
    const rates = [...new Set(pulses.map((v) => +Number(v.vib).toFixed(3)))];
    const depths = [...new Set(pulses.map((v) => +Number(v.vibmod).toFixed(3)))];
    console.log(`  ok   vibrato — every hap carries both; rate ${rates.join('/')} Hz, depth ${depths.join('/')} semitones`);
    if (!depths.some((d) => d >= 0.4)) {
      fail(
        `WRONGNESS — the deepest vibrato on the ostinato is ${Math.max(...depths)} semitones. ` +
          'Lavender Town uses 0.5 — half a semitone — and that detuning IS the effect. ' +
          'A "safe" 0.1 here has deleted the reason this figure exists.',
      );
    } else {
      console.log('  ok   wrongness — the ostinato detunes by half a semitone, deliberately');
    }
  }

  /* ------------------------------------- 3. one phrase in five is worse */

  const sour = haps(L.buildMotifs(state({ phrase: 4 }))).filter((v) => v.s === 'pulse');
  const plain = pulses;
  const sourRate = Math.max(0, ...sour.map((v) => Number(v.vib) || 0));
  const plainRate = Math.max(0, ...plain.map((v) => Number(v.vib) || 0));
  if (sour.length === 0) {
    fail('SOUR PHRASE — phrase 4 produced no ostinato at all.');
  } else if (sourRate <= plainRate) {
    fail(
      `SOUR PHRASE — phrase 4 vibrates at ${sourRate} Hz against ${plainRate} Hz on an ordinary phrase. ` +
        'One phrase in five is supposed to get WORSE; nothing changes.',
    );
  } else {
    console.log(`  ok   sour phrase — one phrase in five shudders at ${sourRate} Hz against ${plainRate} Hz`);
  }
}

if (calmMotifs.some((v) => v.s === 'pulse' && Number(v.vibmod) >= 0.4)) {
  fail('LEAKAGE — the ostinato sounds when there is no boss. A leitmotif heard in ordinary play is not a leitmotif.');
} else {
  console.log(`  ok   reserved — ${calmMotifs.length} non-boss \`motifs\` haps and none of them is the ostinato`);
}

/* ------------------------------------------------------------- 4. the tune */

const bossLead = haps(L.buildLead(state()));
const calmLead = haps(L.buildLead(state({ boss: false, bossTheme: false })));
const rateOf = (hs) => [...new Set(hs.map((v) => Number(v.vib)).filter((x) => Number.isFinite(x) && x > 0))];
const bossRates = rateOf(bossLead);
const calmRates = rateOf(calmLead);
console.log(`\n  lead — ${bossLead.length} boss haps, ${calmLead.length} ordinary haps`);
if (bossLead.length === 0 || calmLead.length === 0) {
  fail('LEAD — one of the two states produced no lead haps at all.');
} else if (!bossRates.length) {
  fail('LEAD VIBRATO — the boss lead carries no live vibrato.');
} else if (Math.min(...bossRates) >= Math.min(...calmRates)) {
  fail(
    `LEAD VIBRATO — the boss vibrates at ${bossRates.join('/')} Hz against ${calmRates.join('/')} ordinary. ` +
      'A boss should waver SLOWER and wider, not faster: a fast narrow vibrato is expressive, a slow wide one is unsteady.',
  );
} else {
  console.log(`  ok   lead vibrato — boss ${bossRates.join('/')} Hz against ${calmRates.join('/')} Hz ordinary: slower, and wider`);
}

const bossOsc = new Set(bossLead.map((v) => v.s).filter(Boolean));
const calmOsc = new Set(calmLead.map((v) => v.s).filter(Boolean));
console.log(`  lead sources — boss {${[...bossOsc].join(' ')}}  ordinary {${[...calmOsc].join(' ')}}`);
if (bossOsc.has('triangle')) {
  fail('LEAD TIMBRE — the boss tune is still on a triangle. Every voice in the reference is a pulse; there is no warmth in that cue anywhere.');
} else {
  console.log('  ok   lead timbre — no triangle survives into a boss: the tune is thin on purpose');
}

/* --------------------------------------------------------- 5. the one hit */

const bossFx = haps(L.buildFx(state()));
const noise = bossFx.filter((v) => v.s === 'white');
console.log(`\n  fx — ${bossFx.length} boss haps, ${noise.length} of them white noise`);
if (noise.length === 0) {
  fail('ONE HIT — no filtered noise hit during a boss. That single sound is the whole percussion of the reference.');
} else {
  const banded = noise.filter((v) => v.bandf != null);
  if (!banded.length) {
    fail('ONE HIT — the noise hit carries no bandpass. Unfiltered white noise is a hiss, not a hit.');
  } else {
    const collide = banded.filter((v) => v.ftype != null);
    if (collide.length) {
      fail(
        `FILTER MODEL — ${collide.length} noise haps carry BOTH bandf and ftype. superdough has one shared ` +
          'filter-model control, so `.ftype()` beside `.bpf()` routes the bandpass to the ladder LOWPASS worklet ' +
          '(AGENTS.md §4, and `bpMap` maps `model: "ftype"` at superdough.mjs:733 exactly as lpMap and hpMap do).',
      );
    } else {
      const fs = [...new Set(banded.map((v) => Number(v.bandf)))];
      console.log(`  ok   one hit — ${banded.length} noise haps, bandpass at ${fs.join('/')} Hz, none carrying ftype`);
    }
  }
}

const calmFx = haps(L.buildFx(state({ boss: false, bossTheme: false })));
if (calmFx.some((v) => v.s === 'white')) {
  fail('LEAKAGE — the noise hit sounds outside a boss.');
} else {
  console.log('  ok   reserved — the hit is heard nowhere else');
}

console.log('');
console.log(failed ? 'BOSSCHECK FAILS' : 'BOSSCHECK HOLDS — the fight has its own timbre, its own figure and its own wrongness');
process.exit(failed ? 1 : 0);
