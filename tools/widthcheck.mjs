/*
 * widthcheck — how wide is a rendered WAV, per octave band, measured off the
 * two channels rather than off the pan values that were written.
 *
 * WHY OFF THE FILE. `tools/registermap.mjs` can tell you what `pan` each lane
 * carries; it cannot tell you whether that reached the output. superdough's
 * panner, the four orbit buses, the reverb sends and `postgain` all sit
 * between a `.pan()` and a speaker, and this repo's own history is a list of
 * controls that were written, measured in the haps, and never rendered —
 * `.spread()` on the pad, `.detune()` on a pulse, an `.hpf()` that was a
 * lowpass. `docs/research-music.md` §7 records that there is no width tool and
 * no whole-mix stereo measurement anywhere in `tools/`. This is it.
 *
 * WHAT IT MEASURES, per octave band and for the file as a whole:
 *
 *   corr    Pearson correlation between L and R. 1.000 is mono.
 *   side%   side energy as a share of mid+side. 0% is mono.
 *   bal     mid-point of the energy left-to-right, 0.5 is centred.
 *
 * Banded, because a single number hides the thing that matters: a mix can be
 * wide overall while every lane that shares an octave is stacked at one point.
 * Low bands SHOULD read near-mono — a sub and a kick belong in the middle and
 * that is not a defect — so read the 250 Hz band and up.
 *
 *   node tools/widthcheck.mjs renders/a.wav [renders/b.wav ...]
 *
 * Node-only, no browser, no Strudel: it reads PCM.
 */
import { readFileSync } from 'node:fs';

/** Minimal RIFF/WAVE reader: 16-bit or 32-bit float PCM, stereo or mono. */
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path}: not a RIFF/WAVE file`);
  }
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    if (id === 'fmt ') {
      fmt = {
        format: body.readUInt16LE(0),
        channels: body.readUInt16LE(2),
        rate: body.readUInt32LE(4),
        bits: body.readUInt16LE(14),
      };
    } else if (id === 'data') data = body;
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${path}: missing fmt or data chunk`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const ch = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * bytes;
      let v;
      if (fmt.format === 3 && fmt.bits === 32) v = data.readFloatLE(o);
      else if (fmt.bits === 16) v = data.readInt16LE(o) / 32768;
      else if (fmt.bits === 24) v = ((data.readUInt8(o) | (data.readUInt8(o + 1) << 8) | (data.readInt8(o + 2) << 16)) / 8388608);
      else if (fmt.bits === 32) v = data.readInt32LE(o) / 2147483648;
      else throw new Error(`${path}: unsupported ${fmt.bits}-bit format ${fmt.format}`);
      ch[c][i] = v;
    }
  }
  return { rate: fmt.rate, channels: ch };
}

/*
 * One-pole cascade bandpass. Crude on purpose: the question here is a RATIO
 * between two channels inside a band, and both channels go through the same
 * filter, so the filter's own shape cancels out of the answer. A sharper
 * filter would change the band edges and not the verdict.
 */
function band(x, rate, lo, hi) {
  const out = new Float32Array(x.length);
  const a = Math.exp((-2 * Math.PI * hi) / rate);
  const b = Math.exp((-2 * Math.PI * lo) / rate);
  let lp1 = 0, lp2 = 0, hp1 = 0, hp2 = 0;
  for (let i = 0; i < x.length; i++) {
    lp1 = (1 - a) * x[i] + a * lp1;
    lp2 = (1 - a) * lp1 + a * lp2;
    hp1 = (1 - b) * lp2 + b * hp1;
    hp2 = (1 - b) * hp1 + b * hp2;
    out[i] = lp2 - hp2;
  }
  return out;
}

const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function stats(l, r) {
  let sl = 0, sr = 0, slr = 0, mid = 0, side = 0;
  for (let i = 0; i < l.length; i++) {
    sl += l[i] * l[i];
    sr += r[i] * r[i];
    slr += l[i] * r[i];
    const m = (l[i] + r[i]) / 2, s = (l[i] - r[i]) / 2;
    mid += m * m;
    side += s * s;
  }
  const corr = sl > 0 && sr > 0 ? slr / Math.sqrt(sl * sr) : 1;
  const sidePct = mid + side > 0 ? (side / (mid + side)) * 100 : 0;
  const bal = sl + sr > 0 ? sr / (sl + sr) : 0.5;
  return { corr, sidePct, bal, energy: sl + sr };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.log('usage: node tools/widthcheck.mjs <wav> [wav ...]');
  process.exit(1);
}

for (const path of files) {
  const { rate, channels } = readWav(path);
  if (channels.length < 2) {
    console.log(`${path}: MONO FILE (${channels.length} channel) — nothing to measure`);
    continue;
  }
  const [L, R] = channels;
  const whole = stats(L, R);
  console.log('');
  console.log(`${path}  ${(L.length / rate).toFixed(1)}s @ ${rate} Hz`);
  console.log(`  whole file   corr ${whole.corr.toFixed(4)}   side ${whole.sidePct.toFixed(2)}%   balance ${whole.bal.toFixed(3)}`);
  console.log('       Hz     corr    side%   balance   band share');
  let checked = 0;
  const rows = BANDS.map((f) => {
    const lo = f / Math.SQRT2, hi = Math.min(f * Math.SQRT2, rate / 2 - 1);
    if (lo >= rate / 2) return null;
    const s = stats(band(L, rate, lo, hi), band(R, rate, lo, hi));
    checked++;
    return { f, ...s };
  }).filter(Boolean);
  const total = rows.reduce((a, r) => a + r.energy, 0);
  for (const r of rows) {
    console.log(
      `   ${String(r.f).padStart(6)}   ${r.corr.toFixed(4).padStart(7)}  ${r.sidePct.toFixed(2).padStart(6)}%   ${r.bal.toFixed(3).padStart(7)}   ${total > 0 ? ((r.energy / total) * 100).toFixed(1).padStart(5) : '  -  '}%`,
    );
  }
  console.log(`  bands measured ${checked} (a check that examined nothing is not a pass)`);
}
