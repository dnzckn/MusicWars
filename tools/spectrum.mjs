/*
 * spectrum — where the energy actually is, measured from rendered audio.
 *
 * This is the check the whole refactor was aimed at, and until now it could not
 * be run. The original diagnosis was made in a browser and is quoted in
 * `STEM_CURVES`:
 *
 *   "Measured spectral balance previously put 45-50% of all energy below 250Hz
 *    with the melody averaging 0.13 — a thumping loop with nothing to listen to
 *    on top of it."
 *
 * and separately, from the user:
 *
 *   "too much high pitch synth always playing, its taxing on the ears"
 *
 * Every change since — the pulse inversion, the sub becoming an accent, the
 * supersaws becoming duty-cycle pulses, the ceiling rebalance, the pad opening
 * to fifths — was aimed at those two sentences. None of it has been checked
 * against them, because checking needs audio and audio needed Chromium.
 *
 * `tools/render.mjs` removed that dependency. This reads the WAV it writes and
 * reports the energy distribution, so the diagnosis can finally be tested
 * rather than assumed.
 *
 * THE BANDS, and why these boundaries:
 *
 *   sub      < 80Hz    Felt rather than heard. The canon has almost nothing
 *                      here: the NES triangle bottoms out near 55Hz. A
 *                      permanent sub is the single clearest "club track" tell.
 *   bass    80-250Hz   The bass line's home. Real, wanted, and the band the
 *                      original 45-50% figure was measured across together
 *                      with sub.
 *   body   250-2500Hz  Where a melody lives and where the ear takes pitch
 *                      from. If the tune is the point, this is where the
 *                      energy should be.
 *   edge  2500-6000Hz  The fatigue band. This is what "taxing on the ears"
 *                      names, and what the supersaw removal targeted.
 *   air      > 6000Hz  Cymbals and noise transients. Small is correct.
 *
 * WHAT THIS CANNOT TELL YOU, and the first point is large enough that the
 * headline number should never be quoted without it.
 *
 * **A band share is not an instrument's share.** Energy is binned by frequency,
 * not by source. A sawtooth bass at 110Hz puts its fundamental in `bass` and
 * its second, third and fourth harmonics — which carry more total energy than
 * the fundamental — squarely in `body`. So "3% below 250Hz" does NOT mean the
 * bass is 3% of the mix; it means 3% of the energy is at frequencies below
 * 250Hz, most of the bass having been counted as body.
 *
 * That matters specifically for comparing against the original 45-50% figure,
 * because the mix it described contained a permanent SINE sub — and a sine puts
 * effectively all of its energy in one band. Removing that one lane would
 * collapse this number on its own, without the bass having changed at all. The
 * comparison is directionally sound and quantitatively unreliable.
 *
 * It also measures the render, which has no reverb, no delay and one-pole
 * filters — see `render.mjs`. Reverb and echo add energy mostly in body and
 * air, so the real game is likely brighter than this reports.
 *
 * Treat the SHAPE as trustworthy and every digit as approximate.
 */
import { readFileSync } from 'node:fs';

/*
 * Default moved from `dist/musicwars-score.wav`, which has not existed for a
 * while — `render` writes to `renders/` now, so this tool died with ENOENT on
 * every invocation and the spectral check that the whole refactor was aimed at
 * could not be run at all. A stale path is a silent way to retire a gate.
 *
 * Pass a path to override:  node tools/spectrum.mjs renders/boss-32.wav
 */
const FILE = process.argv[2] ?? 'renders/live-32.wav';

/* ------------------------------------------------------------------- wav */

let buf;
try {
  buf = readFileSync(FILE);
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  console.error(`spectrum: no such file "${FILE}".\n\n` +
    'This tool measures RENDERED AUDIO, so something has to render it first:\n' +
    '  RENDER_STATE=live RENDER_OUT=renders/live-32.wav node --experimental-transform-types tools/render.mjs 32\n' +
    'then re-run, optionally passing a different path as the first argument.');
  process.exit(1);
}
if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${FILE} is not a RIFF file`);
const channels = buf.readUInt16LE(22);
const sr = buf.readUInt32LE(24);
const bits = buf.readUInt16LE(34);
if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}`);

// Walk the chunks rather than assuming data starts at 44 — a renderer that
// adds a LIST chunk would otherwise be read as if its metadata were samples.
let pos = 12;
let dataAt = -1;
let dataLen = 0;
while (pos + 8 <= buf.length) {
  const id = buf.toString('ascii', pos, pos + 4);
  const size = buf.readUInt32LE(pos + 4);
  if (id === 'data') { dataAt = pos + 8; dataLen = size; break; }
  pos += 8 + size + (size % 2);
}
if (dataAt < 0) throw new Error('no data chunk');

const frames = Math.floor(dataLen / (2 * channels));
const mono = new Float32Array(frames);
for (let i = 0; i < frames; i++) {
  let acc = 0;
  for (let c = 0; c < channels; c++) acc += buf.readInt16LE(dataAt + (i * channels + c) * 2) / 32768;
  mono[i] = acc / channels;
}

/* ------------------------------------------------------------------- fft */

/** In-place iterative radix-2 Cooley-Tukey. `re`/`im` are length 2^k. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/* --------------------------------------------------------------- measure */

const N = 4096;
const HOP = 2048;
const BANDS = [
  { name: 'sub', lo: 0, hi: 80 },
  { name: 'bass', lo: 80, hi: 250 },
  { name: 'body', lo: 250, hi: 2500 },
  { name: 'edge', lo: 2500, hi: 6000 },
  { name: 'air', lo: 6000, hi: sr / 2 },
];
const energy = BANDS.map(() => 0);
// Hann, so a note that straddles a window boundary does not smear into every
// band as spectral leakage and inflate `air` on transients alone.
const win = new Float32Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

let windows = 0;
const rmsOverTime = [];
for (let start = 0; start + N <= frames; start += HOP) {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const x = mono[start + i];
    re[i] = x * win[i];
    sum += x * x;
  }
  rmsOverTime.push(Math.sqrt(sum / N));
  fft(re, im);
  for (let k = 1; k < N / 2; k++) {
    const hz = (k * sr) / N;
    const mag = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < BANDS.length; b++) {
      if (hz >= BANDS[b].lo && hz < BANDS[b].hi) { energy[b] += mag; break; }
    }
  }
  windows++;
}

const total = energy.reduce((a, b) => a + b, 0) || 1;

console.log(`spectrum — ${FILE}`);
console.log(`  ${(frames / sr).toFixed(1)}s, ${sr}Hz, ${channels}ch, ${windows} analysis windows\n`);
console.log('  band              range        share    ');
console.log('  ' + '-'.repeat(56));
for (let b = 0; b < BANDS.length; b++) {
  const pct = (energy[b] / total) * 100;
  const bar = '#'.repeat(Math.round(pct / 2));
  console.log(
    `  ${BANDS[b].name.padEnd(6)} ${`${BANDS[b].lo}-${Math.round(BANDS[b].hi)}Hz`.padEnd(14)} ` +
      `${pct.toFixed(1).padStart(5)}%   ${bar}`,
  );
}

/*
 * THE SAME BANDS, IN THIRDS, because a whole-file average hides development.
 *
 * Every figure above is one number for the entire recording. That is the right
 * summary for a frozen snapshot render, and it is close to useless for
 * `RENDER_STATE=live`, where the whole point is that the arrangement changes:
 * an opening with no melody and a climax with everything in it average out to
 * a perfectly ordinary-looking mix that never existed at any moment.
 *
 * Splitting the analysis windows into thirds is the cheapest thing that shows
 * a trend at all. It is not a substitute for listening, and three points
 * cannot describe a shape — but it can answer "does the low end recede as the
 * tune arrives", which is the specific thing this refactor has been aiming at.
 */
if (windows >= 30) {
  const third = Math.floor(rmsOverTime.length / 3);
  console.log('\n  development over the recording (thirds):');
  console.log('    part      <250Hz   250-2.5k   2.5-6k    loudness');
  for (let t = 0; t < 3; t++) {
    const lo = t * third;
    const hi = t === 2 ? rmsOverTime.length : (t + 1) * third;
    const e = BANDS.map(() => 0);
    for (let wi = lo; wi < hi; wi++) {
      const start = wi * HOP;
      if (start + N > frames) break;
      const re = new Float32Array(N);
      const im = new Float32Array(N);
      for (let i = 0; i < N; i++) re[i] = mono[start + i] * win[i];
      fft(re, im);
      for (let k = 1; k < N / 2; k++) {
        const hz = (k * sr) / N;
        const mag = re[k] * re[k] + im[k] * im[k];
        for (let b = 0; b < BANDS.length; b++) {
          if (hz >= BANDS[b].lo && hz < BANDS[b].hi) { e[b] += mag; break; }
        }
      }
    }
    const tot = e.reduce((a, b) => a + b, 0) || 1;
    let sum = 0;
    let n = 0;
    for (let wi = lo; wi < hi; wi++) { sum += rmsOverTime[wi] * rmsOverTime[wi]; n++; }
    const rms = Math.sqrt(sum / Math.max(1, n));
    console.log(
      `    ${['first', 'middle', 'last'][t].padEnd(9)} ${(((e[0] + e[1]) / tot) * 100).toFixed(1).padStart(5)}%   ` +
        `${((e[2] / tot) * 100).toFixed(1).padStart(6)}%   ${((e[3] / tot) * 100).toFixed(1).padStart(5)}%   ` +
        `${(rms > 0 ? 20 * Math.log10(rms) : -Infinity).toFixed(1).padStart(6)}dB`,
    );
  }
}

const lowShare = ((energy[0] + energy[1]) / total) * 100;
const bodyShare = (energy[2] / total) * 100;
const edgeShare = (energy[3] / total) * 100;

console.log('\n  against the two sentences this refactor was aimed at:');
console.log(
  `    below 250Hz: ${lowShare.toFixed(1)}%   — the diagnosis recorded 45-50% and called it\n` +
    '                        "a thumping loop with nothing to listen to on top of it"',
);
console.log(
  `    2.5-6kHz:    ${edgeShare.toFixed(1)}%   — the fatigue band, i.e. "too much high pitch\n` +
    '                        synth always playing, its taxing on the ears"',
);
console.log(`    250Hz-2.5kHz: ${bodyShare.toFixed(1)}%  — where a tune lives`);

/*
 * Dynamic range, from the same pass. A soundtrack whose loudest and quietest
 * moments are the same is the "wall rather than an arrangement" failure that
 * `session` checks for per-lane; this checks it on the finished signal, which
 * is the only place it actually matters.
 */
const sorted = [...rmsOverTime].sort((a, b) => a - b);
const q = (p) => sorted[Math.floor(sorted.length * p)] ?? 0;
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
console.log(
  `\n  loudness p10 ${db(q(0.1)).toFixed(1)}dB  median ${db(q(0.5)).toFixed(1)}dB  ` +
    `p90 ${db(q(0.9)).toFixed(1)}dB   (p10-p90 range ${(db(q(0.9)) - db(q(0.1))).toFixed(1)}dB)`,
);
if (lowShare < 8) {
  console.log(
    '\n  WATCH THIS ONE. Under 8% below 250Hz is thin even allowing for the\n' +
      '  harmonics caveat above. The refactor removed a permanent sine sub for\n' +
      '  good reasons, and the failure mode on the other side of that decision is\n' +
      '  a mix with no floor at all. This cannot distinguish "correctly restrained"\n' +
      '  from "overshot" — only ears can — but it can say the number moved a long\n' +
      '  way and should be listened for.',
  );
}
console.log(
  '\n  Measured from the render, which has no reverb or delay and one-pole\n' +
    '  filters. Those add energy mostly in body and air, so the real game is\n' +
    '  likely a little brighter than this. Trust the shape, not the last digit.',
);

/*
 * TWO GATES, and only two, because this measures taste-adjacent things and
 * most of what it prints is for a person to read rather than for a threshold
 * to judge.
 *
 * They are the two sentences this refactor was aimed at, turned around so they
 * cannot come back:
 *
 *   FATIGUE   "too much high pitch synth always playing, its taxing on the
 *             ears". The 2.5-6kHz band is where that lives. It measures 0.3%
 *             now and the ceiling is set at 8%, which is loose on purpose —
 *             this is a tripwire against a regression, not a target to tune
 *             toward. Note that the score is dark here BY CONSTRUCTION: every
 *             pitched lane is filtered at or below 2700Hz (bass 1400, arp
 *             1625, chords 1750, lead 2550, motor 2700) and only the clap
 *             reaches 6280. That is the deliberate answer to the complaint,
 *             not an accident of the renderer.
 *
 *   TUNE      "a thumping loop with nothing to listen to on top of it", which
 *             was diagnosed at 45-50% below 250Hz. The honest invariant is not
 *             a bass ceiling — 45% below 250Hz is unremarkable on its own —
 *             but that the band where a TUNE lives has more energy than the
 *             band underneath it. Currently 54.4% against 45.1%.
 *
 * HOW THESE WERE VERIFIED, and the limit of it. Opening the lane filters with
 * a sed over literal `.lpf(N)` calls did NOT move the edge band, because most
 * cutoffs here are signal-driven (`m.sig.openness.range(...)`) and the literals
 * are a minority — a plant that misses its mechanism proves nothing. They were
 * checked instead by feeding a synthetic 3.5/4.5kHz tone, which trips both at
 * once. That proves the ARITHMETIC works. It does not prove the ceiling is
 * tight enough to catch a plausible code regression: the score sits at 0.3%
 * against a 8% ceiling, a 26x margin, so this catches a catastrophe and not a
 * drift. Tightening it would need a listener first.
 *
 * There is deliberately no gate on the top end being too QUIET. The pendulum
 * from "too bright" to "too dull" is real, but which side of it this sits on
 * is a question for ears, and guessing at it would undo a complaint the user
 * actually made.
 */
/** Fractional share of one named band, from the whole-file `energy` tally. */
const bandShare = (name) => energy[BANDS.findIndex((b) => b.name === name)] / total;

const MAX_FATIGUE = 0.08;
const gateFails = [];
if (bandShare('edge') > MAX_FATIGUE) {
  gateFails.push(`the 2.5-6kHz fatigue band is ${(100 * bandShare('edge')).toFixed(1)}% (max ${100 * MAX_FATIGUE}%) — ` +
    'that is the band the "taxing on the ears" complaint was about');
}
if (bandShare('body') <= (bandShare('sub') + bandShare('bass'))) {
  gateFails.push(`the tune band (250Hz-2.5kHz, ${(100 * bandShare('body')).toFixed(1)}%) has no more energy than ` +
    `everything below it (${(100 * (bandShare('sub') + bandShare('bass'))).toFixed(1)}%) — that is "a thumping loop with nothing on top"`);
}
console.log('');
if (gateFails.length) {
  for (const m of gateFails) console.log(`  FAIL  ${m}`);
  process.exit(1);
}
console.log('  ok  the fatigue band is quiet and the tune outweighs the floor');
