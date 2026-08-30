/*
 * registermap — what register does each lane ACTUALLY occupy, and what does
 * its filtering leave of it?
 *
 * WHY THIS EXISTS. The mix measures 66.6% of all its energy in the 250 and
 * 500 Hz octave bands and 3.2% above 2 kHz — "muddy and dull", measured. The
 * standing explanation (`docs/research-music.md` §4) is a table of note ranges
 * that was built by READING `layers.ts`. Per `AGENTS.md` §3, a source-read
 * cannot see a control that was written and then overwritten two lines later,
 * and cannot see a filter that a signal parks somewhere unexpected. So this
 * builds every lane and reads the haps.
 *
 * WHAT IT PRINTS, per voice group (a lane subdivided by oscillator and duty,
 * because `chords` alone is four different instruments):
 *
 *   - the MIDI range actually emitted, p5..p95 and absolute
 *   - the Hz of the fundamental at those pitches
 *   - the lowpass and highpass the haps carry, and whether `ftype` is set
 *     (an `hcutoff` on a hap that also carries `ftype` is a second LOWPASS —
 *     AGENTS.md §4 — so the two are printed together, never separately)
 *   - the top harmonic the lowpass leaves standing, as a multiple of the
 *     fundamental: this is the "does anything reach 2 kHz" question
 *   - pan, and how far from centre the group's energy sits
 *
 * AND a voice count with its denominator: simultaneous pitched voices per bar,
 * mean and max, over the whole sweep.
 *
 * IT IS A GATE NOW, and it was not. The header used to say "THIS IS NOT A GATE
 * and deliberately has no thresholds", which was the right call while the
 * register map was a diagnosis in progress and the wrong one once the map
 * became a table the builders read. `theory.LANE_RANGE` is that table; this
 * file imports it rather than restating it, and asserts four things against it
 * at the bottom — window span, per-hap containment, per-group sprawl, and the
 * count of voice groups living in 200-800 Hz. Everything above the assertions
 * is still the instrument.
 *
 *   node --experimental-transform-types tools/registermap.mjs
 *   node --experimental-transform-types tools/registermap.mjs --thin=0.5
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const layers = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS, LANE_RANGE, MIN_LANE_SPAN } = await import('../src/audio/theory.ts');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? Number(hit.slice(n.length + 3)) : d;
};
/*
 * `thin` is the PLAYER-DAMAGE signal and it is 0 at full health
 * (`director.ts:955`, `pow(1 - health, 1.35)` through a damp). The shared
 * harness defaults every unknown signal to 0.5, which would render the whole
 * score as a half-dead run — so normal play is the default here and the
 * damaged case is a flag.
 */
const THIN = opt('thin', 0);
const OPENNESS = opt('openness', 0.5);
/*
 * `arpOctave` is the DIRECTOR's value, not the builder's.
 *
 * `orchestration.arpDisplacement` returns -12 when the lead and the arp both
 * clear 0.18, and `buildArp` applies `.add(note(sig.arpOctave.mul(-1)))` — it
 * inverts the sign on purpose (see the long note at that call site). So the
 * displaced state is `--arp-oct=-12` and it renders the arp an octave UP. The
 * shared harness defaults transposition signals to 0, which is the undisplaced
 * case, so a sweep that never sets this cannot see either the collision the
 * displacement is meant to fix or the register it actually moves to.
 */
const ARP_OCT = opt('arp-oct', 0);

const LANES = {
  sub: layers.buildSub,
  motor: layers.buildMotor,
  bass: layers.buildBass,
  chords: layers.buildChords,
  arp: layers.buildArp,
  lead: layers.buildLead,
  kick: layers.buildKick,
  clap: layers.buildClap,
  fx: layers.buildFx,
  motifs: layers.buildMotifs,
  power: layers.buildPowerupVoices,
};
const PITCHED = new Set(['sub', 'motor', 'bass', 'chords', 'arp', 'lead']);
const LANE_STEM = { sub: 'sub', motor: 'hats', bass: 'bass', chords: 'chords', arp: 'arp', lead: 'lead', kick: 'kick', clap: 'clap', fx: 'fx', motifs: 'motifs', power: 'power' };

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const TENSIONS = [0.35, 0.6, 0.85];

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
    sig: makeSignals(strudel, { thin: THIN, openness: OPENNESS, arpOctave: ARP_OCT }),
    ...over,
  };
}

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
/*
 * A hap's `note` is not always a number.
 *
 * `buildKick` writes `note('c1 ~ ~ ~')` and the clap's body writes
 * `note('e3')`, so those haps carry NOTE NAMES, and `Number('c1')` is NaN.
 * The first version of this tool dropped every one of them, which is how the
 * kick — the loudest single source in the mix and the entire occupant of the
 * 31.5 Hz octave band — came out of the model at exactly zero. A parser that
 * silently discards its input reports a clean answer about nothing.
 */
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function midiOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const num = Number(v);
  if (Number.isFinite(num)) return num;
  const m = /^([a-gA-G])([#bs]*)(-?\d+)$/.exec(v.trim());
  if (!m) return NaN;
  let semi = PC[m[1].toLowerCase()];
  for (const ch of m[2]) semi += ch === 'b' ? -1 : 1;
  // Strudel/Tone note names are scientific pitch: c4 is middle C, MIDI 60.
  return semi + (Number(m[3]) + 1) * 12;
}
const q = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : NaN);

/** A voice group key: the lane, its oscillator, and its duty if it has one. */
function groupOf(lane, e) {
  const src = e.s ?? (typeof e.note === 'number' || typeof e.note === 'string' ? 'note' : '?');
  const pw = typeof e.pw === 'number' ? `:pw${e.pw}` : '';
  const fm = typeof e.fm === 'number' ? `:fm${e.fm}` : '';
  return `${lane}/${src}${pw}${fm}`;
}

const groups = new Map();
const perBarVoices = [];
let statesBuilt = 0;
let hapsSeen = 0;
/*
 * THE ONE ASSERTION IN THIS FILE, and it is here because nothing else in
 * `tools/` has it.
 *
 * superdough has ONE filter-model control: `lpMap` and `hpMap` both map
 * `model: 'ftype'` (`superdough.mjs:671` and `:706`), and `createFilter`
 * (`helpers.mjs:238`) routes `model === 'ladder'` to a worklet whose only
 * parameters are frequency, q and drive — the `filter.type = type` assignment
 * lives in the dead `else` branch. So a hap carrying BOTH `hcutoff` and
 * `ftype` has a second 24 dB/oct LOWPASS where its author wrote a highpass.
 * That bug lived in `buildBass` and both wobble voices for the project's whole
 * life and cost the bass 33-52 dB across its own range.
 *
 * `docs/TURNAROUND.md` records that after the fix, **no tool in `tools/` can
 * see a re-introduction of it** — the probe that once went red is not in the
 * repo, does not run, and exits non-zero only on a zero denominator. This pass
 * adds six highpasses to `layers.ts`, which is exactly the change that would
 * walk back into it, so the guard ships with them.
 *
 * How it could be gamed: by writing `.hpf(0)` instead of removing the control.
 * So the count is of haps with `hcutoff > 0` AND `ftype` set, and the number
 * of haps examined is printed whether or not anything failed — `checked === 0`
 * is a failure, not a pass.
 */
let bothFilters = 0;
const bothWitness = [];

const cases = [];
for (const feel of FEELS) {
  for (const mode of Object.keys(PROGRESSIONS)) {
    const prog = PROGRESSIONS[mode];
    for (let i = 0; i < prog.length; i++) {
      for (const tension of TENSIONS) {
        for (const leadRegister of [0, 12]) cases.push({ feel, mode, degree: prog[i][0], tension, leadRegister });
      }
    }
  }
}

/*
 * SIMULTANEITY, and why it is measured rather than counted.
 *
 * `docs/research-music.md` §4 states "about 19 simultaneous pitched voices"
 * per bar. That number was counted by walking the source and adding up layers.
 * A hap count per bar is a different quantity again — it conflates rhythm with
 * polyphony, because a lane playing sixteen sixteenths contributes sixteen
 * haps and one voice.
 *
 * What a listener's ear (and an octave band) actually sees is how many notes
 * are SOUNDING AT ONCE. So the bar is sampled on a 64th-note lattice and the
 * notes whose written span covers each instant are counted. Written span, not
 * envelope tail: the tail is real but it is a different measurement and mixing
 * the two would make the number unfalsifiable.
 *
 * Both are printed, with both denominators, because they answer different
 * questions and the difference between them is itself the finding.
 */
const SAMPLES_PER_BAR = 64;
const perBarSimul = [];

for (const c of cases) {
  for (let bar = 0; bar < 8; bar++) {
    const m = state({ ...c, barInPhrase: bar });
    statesBuilt++;
    let pitchedThisBar = 0;
    const spans = [];
    for (const [lane, build] of Object.entries(LANES)) {
      let evs;
      try {
        evs = notesIn(build(m), 1);
      } catch (err) {
        throw new Error(`lane '${lane}' threw (${c.feel}/${c.mode}/bar ${bar}): ${String(err).split('\n')[0]}`);
      }
      for (const e of evs) {
        hapsSeen++;
        const key = groupOf(lane, e);
        let g = groups.get(key);
        if (!g) {
          g = { lane, key, notes: [], cut: [], hcut: [], pans: [], gains: [], ftype: 0, n: 0, rooms: [], vel: [], dur: [] };
          groups.set(key, g);
        }
        g.n++;
        const n = midiOf(e.note);
        if (Number.isFinite(n)) g.notes.push(n);
        if (Number.isFinite(e.cutoff)) g.cut.push(Number(e.cutoff));
        if (Number.isFinite(e.hcutoff)) g.hcut.push(Number(e.hcutoff));
        if (e.ftype != null) g.ftype++;
        if (e.ftype != null && Number(e.hcutoff) > 0) {
          bothFilters++;
          if (bothWitness.length < 5) {
            bothWitness.push(`${key} hpf ${e.hcutoff} ftype ${e.ftype} note ${e.note} (${c.feel}/${c.mode}/bar ${bar})`);
          }
        }
        g.pans.push(Number.isFinite(e.pan) ? Number(e.pan) : 0.5);
        g.gains.push(Number.isFinite(e.gain) ? Number(e.gain) : 1);
        g.vel.push(Number.isFinite(e.velocity) ? Number(e.velocity) : 1);
        g.dur.push(Math.max(1e-4, (e.end ?? 0) - (e.begin ?? 0)));
        g.rooms.push(Number.isFinite(e.room) ? Number(e.room) : 0);
        if (PITCHED.has(lane) && Number.isFinite(n)) {
          pitchedThisBar++;
          spans.push([e.begin, e.end]);
        }
      }
    }
    perBarVoices.push(pitchedThisBar);
    let peak = 0, sum = 0;
    for (let i = 0; i < SAMPLES_PER_BAR; i++) {
      const t = (i + 0.5) / SAMPLES_PER_BAR;
      let live = 0;
      for (const [b, e] of spans) if (t >= b && t < e) live++;
      sum += live;
      if (live > peak) peak = live;
    }
    perBarSimul.push({ mean: sum / SAMPLES_PER_BAR, peak });
  }
}

const rows = [...groups.values()].sort((a, b) => {
  const ma = a.notes.length ? a.notes.slice().sort((x, y) => x - y)[Math.floor(a.notes.length / 2)] : -1;
  const mb = b.notes.length ? b.notes.slice().sort((x, y) => x - y)[Math.floor(b.notes.length / 2)] : -1;
  return ma - mb;
});

console.log(
  `registermap — thin=${THIN} (${THIN === 0 ? 'full health' : 'damaged'}), openness=${OPENNESS}, arpOctave=${ARP_OCT} (${ARP_OCT === 0 ? 'undisplaced' : 'displaced'})`,
);
console.log(`states built ${statesBuilt}, haps examined ${hapsSeen}, voice groups ${rows.length}`);
if (hapsSeen === 0) {
  console.log('FAILURE: examined 0 haps');
  process.exit(1);
}
console.log('');
console.log('group                 haps   MIDI p5-p95   fund Hz      lowpass Hz     highpass Hz  ftype  harm@lpf  pan        gain');
for (const g of rows) {
  const ns = g.notes.slice().sort((a, b) => a - b);
  const lo = q(ns, 0.05), hi = q(ns, 0.95);
  const cs = g.cut.slice().sort((a, b) => a - b);
  const hs = g.hcut.slice().sort((a, b) => a - b);
  const cLo = q(cs, 0.02), cHi = q(cs, 0.98);
  const hLo = q(hs, 0.02), hHi = q(hs, 0.98);
  const pans = g.pans.slice().sort((a, b) => a - b);
  const medPan = q(pans, 0.5);
  const medGain = q(g.gains.slice().sort((a, b) => a - b), 0.5);
  const noteRange = Number.isFinite(lo) ? `${lo.toFixed(0)}-${hi.toFixed(0)}` : '   -  ';
  const fundRange = Number.isFinite(lo) ? `${hz(lo).toFixed(0)}-${hz(hi).toFixed(0)}` : '   -  ';
  const lpText = cs.length ? `${cLo.toFixed(0)}-${cHi.toFixed(0)}` : '(none)';
  const hpText = hs.length ? `${hLo.toFixed(0)}-${hHi.toFixed(0)}` : '(none)';
  // How many harmonics of the MEDIAN pitch survive the median lowpass.
  const medNote = q(ns, 0.5);
  const medCut = cs.length ? q(cs, 0.5) : Infinity;
  const harm = Number.isFinite(medNote) ? (medCut / hz(medNote)) : NaN;
  console.log(
    `${g.key.padEnd(20)} ${String(g.n).padStart(6)}  ${noteRange.padStart(11)}  ${fundRange.padStart(10)}  ${lpText.padStart(13)}  ${hpText.padStart(11)}  ${String(g.ftype).padStart(5)}  ${(Number.isFinite(harm) ? harm.toFixed(1) + 'x' : '  -').padStart(8)}  ${medPan.toFixed(2)}  ${medGain.toFixed(2)}`,
  );
}

/* ------------------------------------------------ the two headline counts */

console.log('');
const inBand = (n) => hz(n) >= 200 && hz(n) <= 800;
let bandGroups = 0, allPitchedGroups = 0;
const bandNames = [];
for (const g of rows) {
  if (!PITCHED.has(g.lane) || !g.notes.length) continue;
  allPitchedGroups++;
  const share = g.notes.filter(inBand).length / g.notes.length;
  if (share >= 0.5) {
    bandGroups++;
    bandNames.push(`${g.key} ${(share * 100).toFixed(0)}% of ${g.n} haps`);
  }
}
console.log(`pitched voice groups with MOST of their notes in 200-800 Hz: ${bandGroups} of ${allPitchedGroups}`);
for (const n of bandNames) console.log(`   ${n}`);
/*
 * THE BAND CEILING, and why it is a gate now.
 *
 * This line used to be a readout. It measured 9 of 12 when
 * `docs/research-music.md` §4 was written and the mix's own complaint —
 * "muddy", "multiple conflicting melodies", 66.6% of all energy in the 250 and
 * 500 Hz bands — is what that number is a picture of. A readout nobody fails on
 * is the "unmeasured properties rot" case AGENTS.md §3 names: the register work
 * that moved it can be undone one lane at a time with every gate green.
 *
 * SEVEN is the ceiling, and it is set from what the arrangement legitimately
 * needs rather than from what it currently scores. The lanes that BELONG in
 * 200-800 Hz are the motor (its window is 57-69 by contract), the stab (the
 * upper structure), and the tune with its two doublings — which is five voice
 * groups before anything is wrong. Seven leaves two of slack and fails the
 * ninth, which is where this started.
 *
 * How it could be gamed: by moving a lane out of the band and leaving it
 * inaudible, or by silencing one. Hence the denominator is printed, the
 * per-group share and hap count are printed, and `bandGroups === 0` with
 * `allPitchedGroups` under 10 would mean lanes have gone missing rather than
 * moved — which the presence table immediately below makes visible.
 */
const BAND_MAX = 7;
let bandFail = false;
if (allPitchedGroups === 0) {
  console.log('FAIL — zero pitched voice groups examined. A check with no denominator is not a pass.');
  bandFail = true;
} else if (bandGroups > BAND_MAX) {
  console.log(`FAIL — ${bandGroups} of ${allPitchedGroups} groups live in 200-800 Hz; the ceiling is ${BAND_MAX}.`);
  bandFail = true;
}
/*
 * A group is not "always on". Printed as a share of the sweep so a feel-only
 * voice (the chase 808, the shuffle clav) is not counted alongside the pad.
 */
console.log(`presence over the ${statesBuilt}-state sweep, haps per state:`);
for (const g of rows) console.log(`   ${g.key.padEnd(20)} ${(g.n / statesBuilt).toFixed(2)}`);

const mean = perBarVoices.reduce((a, b) => a + b, 0) / perBarVoices.length;
const sorted = perBarVoices.slice().sort((a, b) => a - b);
console.log(
  `pitched note-events per bar over ${perBarVoices.length} bars: mean ${mean.toFixed(1)}, median ${q(sorted, 0.5)}, p95 ${q(sorted, 0.95)}, max ${sorted[sorted.length - 1]}`,
);
const simMeans = perBarSimul.map((s) => s.mean).sort((a, b) => a - b);
const simPeaks = perBarSimul.map((s) => s.peak).sort((a, b) => a - b);
console.log(
  `pitched voices SOUNDING AT ONCE, ${SAMPLES_PER_BAR} samples in each of ${perBarSimul.length} bars ` +
    `(${perBarSimul.length * SAMPLES_PER_BAR} instants): mean ${(simMeans.reduce((a, b) => a + b, 0) / simMeans.length).toFixed(1)}, ` +
    `median ${q(simMeans, 0.5).toFixed(1)}, p95 ${q(simMeans, 0.95).toFixed(1)} | per-bar PEAK median ${q(simPeaks, 0.5)}, p95 ${q(simPeaks, 0.95)}, max ${simPeaks[simPeaks.length - 1]}`,
);

/* ------------------------------------------------- where the top end is */

let above2k = 0, total = 0;
for (const g of rows) {
  const cs = g.cut.slice().sort((a, b) => a - b);
  const medCut = cs.length ? q(cs, 0.5) : Infinity;
  const hs = g.hcut.slice().sort((a, b) => a - b);
  const medHp = hs.length ? q(hs, 0.5) : 0;
  total++;
  // A group can put energy above 2 kHz if its lowpass is above 2 kHz (or absent)
  // and it is not a note whose whole harmonic series dies first.
  if (medCut > 2000) above2k++;
  g.medCut = medCut;
  g.medHp = medHp;
}
console.log(`voice groups whose lowpass leaves anything above 2 kHz: ${above2k} of ${total}`);
for (const g of rows) {
  if (g.medCut > 2000) console.log(`   ${g.key.padEnd(20)} lpf ${g.medCut === Infinity ? 'none' : g.medCut.toFixed(0)}  hpf ${g.medHp.toFixed(0)}  gain ${q(g.gains.slice().sort((a, b) => a - b), 0.5).toFixed(2)}`);
}

/* -------------------------------------------------------------------------
 * WHERE EACH GROUP'S ENERGY LANDS — a MODEL, and it is labelled one.
 *
 * "voice groups whose lowpass leaves anything above 2 kHz" above is a necessary
 * condition and a very weak one: a triangle at 440 Hz behind a 2750 Hz lowpass
 * passes that test while putting its 5th partial — the first one over 2 kHz —
 * through at -28 dB before the filter touches it. The question the mix asks is
 * how much ENERGY is up there, and that needs the source spectrum, not just
 * the cutoff.
 *
 * So: every hap's own note, cutoff, hcutoff, gain and velocity, through the
 * textbook harmonic series of the oscillator superdough will actually run, and
 * summed into the same ten octave bands `capture.mjs` reports. This is a
 * COMPUTED distribution. It is here to say WHICH LANE to change; the rendered
 * WAV is the evidence that a change worked, and the two are not the same claim.
 *
 * What it does NOT model, stated so nobody reads more into it than is there:
 * `distort` (a waveshaper, and the bass runs 1.05-1.8 of it, which adds
 * harmonics this model cannot see), the amplitude envelope, reverb and delay
 * tails, note density over time, and the ladder's resonance peak. It is a
 * steady-state, per-note picture.
 * ---------------------------------------------------------------------- */

const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const bandOf = (f) => {
  for (let i = 0; i < BANDS.length; i++) {
    if (f < BANDS[i] * Math.SQRT2) return i;
  }
  return -1;
};

/*
 * Relative amplitude of harmonic k, for a waveform that swings between -1 and
 * +1 — which is what superdough's oscillators produce. The constants are the
 * textbook Fourier coefficients rather than a convenient 1/k, because the
 * whole point of this table is to compare a triangle against a pulse against a
 * sawtooth: getting the ROLLOFF right and the scale wrong would put every lane
 * in the wrong order. Sanity: summing a_k^2 / 2 over k reproduces each shape's
 * mean square (sine 0.5, saw 1/3, square 1, triangle 1/3).
 */
function harmonicAmp(src, k, pw) {
  switch (src) {
    case 'sine':
      return k === 1 ? 1 : 0;
    case 'triangle':
      return k % 2 === 1 ? 8 / (Math.PI * Math.PI * k * k) : 0;
    case 'square':
      return k % 2 === 1 ? 4 / (Math.PI * k) : 0;
    case 'pulse': {
      // superdough's worklet maps duty as (1 - pw) / 2, so pw 0 is a square
      // and pw 0.5 is a 25% pulse.
      const d = (1 - (pw ?? 0)) / 2;
      return (4 / (Math.PI * k)) * Math.abs(Math.sin(k * Math.PI * d));
    }
    case 'sawtooth':
    case 'supersaw':
      return 2 / (Math.PI * k);
    default:
      return 0; // white/noise sources are handled separately below
  }
}

/** One-pole cascade magnitude: n poles at fc. n=4 is the ladder, n=2 a biquad. */
const lpMag = (f, fc, n) => (fc > 0 ? Math.pow(1 / Math.sqrt(1 + (f / fc) ** 2), n) : 1);
const hpMag = (f, fc, n) => {
  if (!(fc > 0)) return 1;
  const x = f / fc;
  return Math.pow(x / Math.sqrt(1 + x * x), n);
};

/*
 * Stem faders. `stemLevel` is IMPORTED rather than copied — `AGENTS.md` §3,
 * "a tool holding its own copy of a constant will lie the day it moves" — and
 * the value used is printed, because the director applies further multipliers
 * (health, ensembleTrim, the section mix, orchestration's yield) that this
 * cannot see. `--faders=bass:0.32,chords:0.66,...` overrides with figures read
 * out of a real capture, which is what the headline numbers should use.
 */
const faderArg = argv.find((a) => a.startsWith('--faders='));
const FADERS = {};
for (const id of Object.values(LANE_STEM)) FADERS[id] = layers.stemLevel(id, 0.6);
if (faderArg) {
  for (const pair of faderArg.slice('--faders='.length).split(',')) {
    const [k, v] = pair.split(':');
    if (k && Number.isFinite(Number(v))) FADERS[k] = Number(v);
  }
}

const NOISE_SRC = new Set(['white', 'pink', 'brown', 'crackle']);

for (const g of rows) {
  g.bands = new Array(BANDS.length).fill(0);
  const src = g.key.split('/')[1].split(':')[0];
  const pwMatch = /:pw([-\d.]+)/.exec(g.key);
  const pw = pwMatch ? Number(pwMatch[1]) : 0;
  const fader = FADERS[LANE_STEM[g.lane]] ?? 0;
  // amplitude = gain^2 * (fader * masterVolume)^2 — see `volume.ts`. The master
  // volume is common to every lane and cancels out of a SHARE, so it is left
  // out and its absence is the reason these are shares and not dBFS.
  const NYQ = 22050;
  for (let i = 0; i < g.n; i++) {
    const gain = g.gains[i] ?? 1;
    const vel = g.vel[i] ?? 1;
    // amplitude = gain^2 * (fader * masterVolume)^2 (volume.ts), so ENERGY
    // carries the fourth power of each; times how long the note is held.
    const w = (gain * gain * vel * fader * fader) ** 2 * (g.dur[i] ?? 0.25);
    if (w <= 0) continue;
    const fc = g.cut[i] ?? Infinity;
    const hc = g.hcut[i] ?? 0;
    const poles = g.ftype > 0 ? 4 : 2;
    if (NOISE_SRC.has(src)) {
      /*
       * Flat spectrum normalised to unit mean square over 0..Nyquist, so a
       * noise source and an oscillator are on one scale. Integrating the
       * band-limited PSD without that normalisation multiplies noise by the
       * sample rate and makes the clap 99.7% of the mix, which is how this
       * block was first written and is why the normalisation is spelled out.
       */
      for (let b = 0; b < BANDS.length; b++) {
        const lo = BANDS[b] / Math.SQRT2, hi = Math.min(BANDS[b] * Math.SQRT2, NYQ);
        if (hi <= lo) continue;
        let e = 0;
        for (let s = 0; s < 16; s++) {
          const f = lo + ((hi - lo) * (s + 0.5)) / 16;
          e += (lpMag(f, fc, poles) * hpMag(f, hc, 2)) ** 2 * ((hi - lo) / 16) / NYQ;
        }
        g.bands[b] += w * e;
      }
      continue;
    }
    const nOff = g.notes.length === g.n ? g.notes[i] : undefined;
    if (!Number.isFinite(nOff)) continue;
    const f0 = hz(nOff);
    for (let k = 1; k <= 200; k++) {
      const f = f0 * k;
      if (f > NYQ) break;
      const a = harmonicAmp(src, k, pw);
      if (a === 0) continue;
      const b = bandOf(f);
      if (b < 0) continue;
      g.bands[b] += (w * (a * lpMag(f, fc, poles) * hpMag(f, hc, 2)) ** 2) / 2;
    }
  }
}

const totalBands = new Array(BANDS.length).fill(0);
for (const g of rows) for (let b = 0; b < BANDS.length; b++) totalBands[b] += g.bands[b];
const grand = totalBands.reduce((a, b) => a + b, 0);

console.log('');
console.log('COMPUTED octave-band shares of the summed model (not a render; see the note in source)');
console.log(`faders used: ${Object.entries(FADERS).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ')}`);
console.log('group                  31.5     63    125    250    500     1k     2k     4k     8k    16k   | share of mix');
for (const g of rows) {
  const tot = g.bands.reduce((a, b) => a + b, 0);
  if (tot <= 0) continue;
  const cells = g.bands.map((v) => ((v / tot) * 100).toFixed(1).padStart(6)).join(' ');
  console.log(`${g.key.padEnd(20)} ${cells}   | ${((tot / grand) * 100).toFixed(1).padStart(5)}%`);
}
console.log(
  `MIX                  ${totalBands.map((v) => ((v / grand) * 100).toFixed(1).padStart(6)).join(' ')}   | 100.0%`,
);
const share250500 = ((totalBands[3] + totalBands[4]) / grand) * 100;
const shareAir = ((totalBands[6] + totalBands[7] + totalBands[8] + totalBands[9]) / grand) * 100;
console.log(`COMPUTED: 250+500 Hz ${share250500.toFixed(1)}%, above 2 kHz ${shareAir.toFixed(1)}%, over ${hapsSeen} haps in ${rows.length} groups`);

console.log('');
console.log('who owns the air: each group\'s share of the mix\'s total energy ABOVE 2 kHz');
const airTotal = totalBands.slice(6).reduce((a, b) => a + b, 0);
const airRows = rows
  .map((g) => ({ key: g.key, air: g.bands.slice(6).reduce((a, b) => a + b, 0) }))
  .filter((r) => r.air > 0)
  .sort((a, b) => b.air - a.air);
for (const r of airRows) console.log(`   ${r.key.padEnd(20)} ${((r.air / airTotal) * 100).toFixed(1).padStart(5)}% of the air`);
if (airRows.length === 0) console.log('   (nothing — a check that examined nothing is not a pass)');

/* --------------------------------------------------------------- stereo */

console.log('');
console.log('stereo placement and room send, weighted by written gain');
console.log('   (a written pan is not a rendered width — verify with tools/widthcheck.mjs on the WAV)');
let centred = 0, placed = 0, dry = 0;
for (const g of rows) {
  const pans = g.pans.slice().sort((a, b) => a - b);
  const medPan = q(pans, 0.5);
  const spread = q(pans, 0.95) - q(pans, 0.05);
  const w = q(g.gains.slice().sort((a, b) => a - b), 0.5);
  const room = q(g.rooms.slice().sort((a, b) => a - b), 0.5);
  const dead = Math.abs(medPan - 0.5) < 0.05 && spread < 0.05;
  if (dead) centred++; else placed++;
  if (!(room > 0)) dry++;
  console.log(
    `   ${g.key.padEnd(20)} pan ${medPan.toFixed(2)} spread ${spread.toFixed(2)} room ${room.toFixed(2)} gain ${w.toFixed(2)} ${dead ? 'DEAD CENTRE' : ''}${room > 0 ? '' : ' DRY'}`,
  );
}
console.log(`dead centre ${centred} of ${centred + placed} voice groups; bone dry (room 0) ${dry} of ${centred + placed}`);

/* -------------------------------------------------------------------------
 * THE REGISTER CONTRACT — three assertions, all against `theory.LANE_RANGE`.
 *
 * `docs/research-music.md` §4 asked for exactly this and it was never built:
 * "Make the register map a constant table, `LANE_RANGE`, imported by the
 * builders AND by the gate, per §3's 'a tool holding its own copy of a constant
 * will lie the day it moves'. Add a `registermap` check that fails any hap
 * outside its lane's declared `LANE_RANGE` — that one would already be red
 * today on the motor."
 *
 * It WAS red on the motor. `motorcheck` reported 80 notes at MIDI 55-56 the
 * first time the fill turnaround's fold was narrowed, and the chase run's
 * `root + 2` had been able to leave the window since it was written.
 * ---------------------------------------------------------------------- */

console.log('');
console.log('REGISTER CONTRACT — theory.LANE_RANGE, imported not restated');
let contractFail = false;

/*
 * 1. EVERY WINDOW IS AT LEAST AN OCTAVE.
 *
 * `foldInto` moves a pitch by octaves until it fits, so a window narrower than
 * twelve semitones has no legal answer for some pitch classes and the fold has
 * to return something outside it. That makes assertion 2 below fail at random
 * on one chord in twelve rather than on a real defect — which is exactly how it
 * was found. This assertion is what stops a future narrowing reintroducing it.
 */
let spanFail = false;
for (const [lane, w] of Object.entries(LANE_RANGE)) {
  const span = w.hi - w.lo;
  if (span < MIN_LANE_SPAN) {
    console.log(`   FAIL  ${lane} window ${w.lo}-${w.hi} spans ${span}; a fold needs ${MIN_LANE_SPAN}.`);
    spanFail = true;
    contractFail = true;
  }
}
// Only when nothing failed. An `ok` line printed underneath its own FAILs is
// how a multi-assertion check gets read as passing — AGENTS.md §3.
if (!spanFail) {
  console.log(`   ok    ${Object.keys(LANE_RANGE).length} lane windows, all at least ${MIN_LANE_SPAN} semitones`);
}

/*
 * 2. EVERY HAP OF A MAPPED VOICE GROUP IS INSIDE ITS LANE'S WINDOW.
 *
 * Only the groups whose mapping is UNAMBIGUOUS are asserted, and the list is
 * short deliberately. `lead/*` is three octave doublings of one part and
 * `chords/triangle` is two different parts sharing an oscillator (the halftime
 * clav and the colour tones), so a per-hap window on either would be asserting
 * something the code does not claim. Assertion 3 covers those.
 *
 * The arp's window moves with the displacement, so the offset is applied: this
 * check is correct under `--arp-oct=0` and `--arp-oct=-12` alike, which matters
 * because the displaced state is the one the game is in most of the time.
 *
 * How it could be gamed: by removing a lane, at which point its group vanishes
 * and there is nothing to fail. Hence the count of groups actually checked is
 * printed and zero is a failure.
 */
const GROUP_WINDOW = {
  'chords/pulse:pw0': 'pad',
  'chords/pulse:pw0.5': 'stab',
  'motor/pulse:pw0.5': 'motor',
  'arp/triangle': 'arp',
};
let windowsChecked = 0;
let windowFail = false;
for (const g of rows) {
  const lane = GROUP_WINDOW[g.key];
  if (!lane || !g.notes.length) continue;
  const w = LANE_RANGE[lane];
  const shift = lane === 'arp' ? ARP_OCT : 0;
  const lo = w.lo + shift;
  const hi = w.hi + shift;
  const out = g.notes.filter((n) => n < lo || n > hi);
  windowsChecked++;
  if (out.length) {
    const sorted = out.slice().sort((a, b) => a - b);
    console.log(
      `   FAIL  ${g.key} -> ${lane}: ${out.length} of ${g.notes.length} haps outside ${lo}-${hi}, ` +
        `spanning ${sorted[0]}-${sorted[sorted.length - 1]}`,
    );
    windowFail = true;
    contractFail = true;
  }
}
if (windowsChecked === 0) {
  console.log('   FAIL  no mapped voice group was found — the group keys have moved or a lane is silent.');
  contractFail = true;
} else if (!windowFail) {
  console.log(`   ok    ${windowsChecked} mapped voice groups, every hap inside its declared window`);
}

/*
 * 3. NO PITCHED VOICE GROUP SPRAWLS.
 *
 * The colour tones — the 7th and the 9th, TWO voices — measured MIDI 56-90 at
 * p5-p95. Thirty-four semitones is wider than the pad, the motor and the stab
 * put together, and a lane that can be anywhere collides with everything: it is
 * the reason `chords` paired badly against every other lane at once in
 * `masking`. This is the assertion that covers the groups assertion 2 cannot
 * map, and it is the one that would have caught the sprawl on the day it
 * appeared.
 *
 * 26 semitones — just over two octaves — because the lead legitimately spans
 * its own window plus an octave doubling, and the halftime clav shares an
 * oscillator with the colour tones a fifth above it. Below that is a real
 * defect; above it is the writing.
 */
const SPRAWL_MAX = 26;
let sprawlChecked = 0;
let sprawlFail = false;
for (const g of rows) {
  if (!PITCHED.has(g.lane) || g.notes.length < 20) continue;
  const ns = g.notes.slice().sort((a, b) => a - b);
  const span = q(ns, 0.95) - q(ns, 0.05);
  sprawlChecked++;
  if (span > SPRAWL_MAX) {
    console.log(`   FAIL  ${g.key} spans ${span} semitones p5-p95 (${q(ns, 0.05)}-${q(ns, 0.95)}); the ceiling is ${SPRAWL_MAX}`);
    sprawlFail = true;
    contractFail = true;
  }
}
if (sprawlChecked === 0) {
  console.log('   FAIL  no pitched group had enough haps to measure a span.');
  contractFail = true;
} else if (!sprawlFail) {
  console.log(`   ok    ${sprawlChecked} pitched groups, none spanning more than ${SPRAWL_MAX} semitones`);
}

/*
 * 4. THE CROSS-LANE OVERLAP TABLE, printed always.
 *
 * Two voice groups of DIFFERENT lanes sharing a p5-p95 window is the measurable
 * form of "multiple conflicting melodies". Octave doublings inside one lane are
 * not that — a lead triangle over a lead sawtooth is one part — so pairs within
 * a lane are excluded and stated as excluded rather than quietly dropped.
 *
 * A count rather than a ban: five lanes cannot occupy five disjoint octaves and
 * still be a mix. What is being asserted is that no cross-lane pair is in near
 * UNISON, which is the case that reads as thickness instead of as harmony.
 *
 * MEASURED, same formula, same 57-pair denominator, before and after the
 * register table landed: **12 heavy pairs -> 6**. The six that remain are named
 * in the output every run and each of them is a relationship an arranger keeps:
 *
 *   bass line crossing the bed                 bass/sawtooth vs chords/pulse:pw0
 *   the tune's octave doubling vs the growl    lead/sawtooth vs bass/supersaw
 *   upper structure under the tune, twice      chords/pulse:pw0.5 vs lead/*
 *   the halftime clav under the tune, twice    chords/triangle vs lead/*
 *
 * The six that went were the ones that were not: the colour tones' 34-semitone
 * sprawl colliding with SIX other groups at once, and the arp sitting on the
 * tune in both of its octaves.
 *
 * The ceiling is set AT the current figure rather than above it, so this is a
 * ratchet. How it could be gamed: by silencing a lane, which removes its group
 * and its pairs — hence the pair count is printed and a zero denominator fails.
 */
const HEAVY = 9;
const HEAVY_MAX = 6;
const pitchedRows = rows.filter((g) => PITCHED.has(g.lane) && g.notes.length >= 20);
const winOf = (g) => {
  const ns = g.notes.slice().sort((a, b) => a - b);
  return [q(ns, 0.05), q(ns, 0.95)];
};
const heavy = [];
let pairs = 0;
for (let i = 0; i < pitchedRows.length; i++) {
  for (let j = i + 1; j < pitchedRows.length; j++) {
    const a = pitchedRows[i];
    const b = pitchedRows[j];
    if (a.lane === b.lane) continue;
    pairs++;
    const [al, ah] = winOf(a);
    const [bl, bh] = winOf(b);
    const ov = Math.min(ah, bh) - Math.max(al, bl);
    if (ov >= HEAVY) heavy.push(`${a.key} ${al}-${ah} vs ${b.key} ${bl}-${bh} overlap ${ov}`);
  }
}
console.log(`   cross-lane pairs compared: ${pairs}; overlapping by ${HEAVY}+ semitones: ${heavy.length}`);
for (const h of heavy) console.log(`      ${h}`);
if (pairs === 0) {
  console.log('   FAIL  no cross-lane pair was compared. A check with no denominator is not a pass.');
  contractFail = true;
} else if (heavy.length > HEAVY_MAX) {
  console.log(`   FAIL  ${heavy.length} cross-lane pairs share ${HEAVY}+ semitones; the ceiling is ${HEAVY_MAX} (was 12).`);
  contractFail = true;
} else {
  console.log(`   ok    ${heavy.length} of ${pairs} cross-lane pairs overlap heavily; the ceiling is ${HEAVY_MAX}`);
}

/* ------------------------------------- the assertion; see `bothFilters` */

console.log('');
console.log(`hcutoff + ftype on the same hap: ${bothFilters} of ${hapsSeen} haps examined`);
for (const w of bothWitness) console.log(`   ${w}`);
if (hapsSeen === 0) {
  console.log('FAIL — examined nothing. A check with no denominator is not a pass.');
  process.exit(1);
}
if (bothFilters > 0) {
  console.log('FAIL — those highpasses are 24 dB/oct LOWPASSES. See AGENTS.md §4.');
  process.exit(1);
}
console.log('ok — no hap carries a highpass and a filter model together');
if (bandFail || contractFail) {
  console.log('');
  console.log('REGISTER IS OUT OF SPEC');
  process.exit(1);
}
