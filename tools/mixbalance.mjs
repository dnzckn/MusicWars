/**
 * Per-stem loudness, by soloing.
 *
 * KNOWN LIMIT — read before drawing conclusions. Every stem sends to shared
 * reverb and delay buses whose tails ring for seconds, so a soloed measurement
 * always contains some of what was playing before it. Measured spreads across
 * three passes are frequently as large as the medians themselves.
 *
 * This tool reliably catches a layer that is *completely absent* — the bass sat
 * 200x below everything else and well outside any spread, which is how a
 * project-long silent bassline was finally found. It cannot settle differences
 * of ~10dB, and tuning against these numbers at that resolution is chasing
 * noise. For aggregate balance use `npm run audiocheck`, which averages
 * spectral content over long windows.
 *
 * Fader position is not loudness — every stem has its own internal gains, so
 * comparing the numbers the smoke test prints is only valid for spotting a
 * pinned or silent layer. This solos each stem in turn and measures the actual
 * signal, which is the only way to reason about balance.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await p.addInitScript(() => {
  const oc = AudioNode.prototype.connect; window.__tap = null;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try { if (d && d.context && d === d.context.destination) {
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 2048; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap); } } catch {}
    return res; };
});
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(20000);   // reach a busy section so every stem is live

const rows = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const ids = ['sub','kick','clap','hats','bass','chords','arp','lead','fx','motifs','power'];
  const out = [];
  const measure = async (ms) => {
    let sum = 0, n = 0, peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) { a.getFloatTimeDomainData(window.__buf);
        let acc = 0, mx = 0;
        for (let i = 0; i < window.__buf.length; i++) { const v = window.__buf[i]; acc += v * v; if (Math.abs(v) > mx) mx = Math.abs(v); }
        sum += Math.sqrt(acc / window.__buf.length); peak = Math.max(peak, mx); n++; }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { rms: n ? sum / n : 0, peak };
  };
  const full = await measure(2500);
  /*
   * Three passes, take the median.
   *
   * A single solo sample lands wherever the arrangement happens to be, and one
   * unlucky reading had `hats` at -43dB when a repeated probe showed it healthy
   * in 6/6 samples. After the bass turned out to be genuinely silent, a low
   * reading has to be checked rather than dismissed — so the tool needs to be
   * trustworthy enough that checking is cheap.
   */
  const samples = {};
  for (const id of ids) samples[id] = [];
  for (let pass = 0; pass < 3; pass++) {
    for (const id of ids) {
      mw.director.solo = id;
      await new Promise((r) => setTimeout(r, 450));
      const m = await measure(1200);
      samples[id].push(m.rms);
    }
    mw.director.solo = null;
    // Let the arrangement move on between passes so the three samples are not
    // all taken from the same bar.
    await new Promise((r) => setTimeout(r, 2500));
  }
  for (const id of ids) {
    const v = samples[id].slice().sort((a, c) => a - c);
    out.push({ stem: id, rms: v[1], spread: v[2] - v[0], fader: mw.readout().levels[id] });
  }
  mw.director.solo = null;
  return { full, out };
});
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

const total = rows.out.reduce((a, c) => a + c.rms, 0) || 1;
console.log(`full mix rms ${rows.full.rms.toFixed(4)}  peak ${rows.full.peak.toFixed(3)}\n`);
console.log('stem      fader   median rms  share   dB rel   spread');
const loudest = Math.max(...rows.out.map((r) => r.rms));
for (const r of rows.out.sort((a, c) => c.rms - a.rms)) {
  const db = r.rms > 0 ? 20 * Math.log10(r.rms / loudest) : -99;
  console.log(
    `${r.stem.padEnd(9)} ${r.fader.toFixed(2)}   ${r.rms.toFixed(5)}    ${((r.rms / total) * 100).toFixed(1).padStart(5)}%  ${db.toFixed(1).padStart(6)}   ${r.spread.toFixed(5)}`,
  );
}
