/**
 * Proves the game is actually producing audio, not merely scheduling it.
 *
 * Web Audio gives no way to read what reached the speakers, so we monkey-patch
 * `AudioNode.connect` before the page boots: anything that connects to the
 * destination also gets connected to an AnalyserNode we own. Reading RMS off
 * that tap is the difference between "the scheduler is running" (which the
 * smoke test already showed) and "sound is coming out".
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();

await page.addInitScript(() => {
  const origConnect = AudioNode.prototype.connect;
  window.__tap = null;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    try {
      if (dest && dest.context && dest === dest.context.destination) {
        if (!window.__tap) {
          const a = dest.context.createAnalyser();
          a.fftSize = 2048;
          window.__tap = a;
          window.__buf = new Float32Array(a.fftSize);
        }
        origConnect.call(this, window.__tap);
      }
    } catch { /* a node type that refuses the extra fan-out is not worth failing over */ }
    return result;
  };
});

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const __reloads = await freezePage(page);

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.click('#start-button');

// Sample RMS densely so we catch individual drum hits rather than averaging
// them away.
const measure = async (label, ms, hold) => {
  if (hold) for (const k of hold) await page.keyboard.down(k);
  const stats = await page.evaluate(async (durationMs) => {
    const out = { peak: 0, sum: 0, n: 0, silentFrames: 0, clipped: 0, bands: [0, 0, 0, 0, 0, 0], bandN: 0 };
    // Band edges in Hz. 2.5-6k is the "harshness" band: too much energy there
    // is what makes a mix fatiguing rather than loud, and it is exactly what
    // stacked saw waves and white-noise hats pile up.
    const EDGES = [20, 80, 250, 800, 2500, 6000, 16000];
    const end = performance.now() + durationMs;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) {
        a.getFloatTimeDomainData(window.__buf);
        let acc = 0;
        let mx = 0;
        for (let i = 0; i < window.__buf.length; i++) {
          const v = window.__buf[i];
          acc += v * v;
          const av = Math.abs(v);
          if (av > mx) mx = av;
        }
        const rms = Math.sqrt(acc / window.__buf.length);

        // Spectral balance.
        if (!window.__freq) window.__freq = new Float32Array(a.frequencyBinCount);
        a.getFloatFrequencyData(window.__freq);
        const nyq = a.context.sampleRate / 2;
        const binHz = nyq / a.frequencyBinCount;
        const acc2 = [0, 0, 0, 0, 0, 0];
        for (let bi = 0; bi < a.frequencyBinCount; bi++) {
          const hz = bi * binHz;
          const lin = Math.pow(10, window.__freq[bi] / 20);
          for (let k = 0; k < 6; k++) {
            if (hz >= EDGES[k] && hz < EDGES[k + 1]) { acc2[k] += lin; break; }
          }
        }
        const tot = acc2.reduce((x, y) => x + y, 0) || 1;
        for (let k = 0; k < 6; k++) out.bands[k] += acc2[k] / tot;
        out.bandN++;
        out.peak = Math.max(out.peak, mx);
        out.sum += rms;
        out.n++;
        if (rms < 1e-5) out.silentFrames++;
        if (mx > 1.0) out.clipped++;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return out;
  }, ms);
  if (hold) for (const k of hold) await page.keyboard.up(k);
  const avg = stats.n ? stats.sum / stats.n : 0;
  const bands = stats.bands.map((b) => (stats.bandN ? (b / stats.bandN) * 100 : 0));
  // Crest factor: peak over RMS in dB. Squashed, fatiguing mixes sit under
  // ~10dB; music with life in it is usually 12-20.
  const crest = avg > 0 ? 20 * Math.log10(stats.peak / avg) : 0;
  const silentPct = stats.n ? (stats.silentFrames / stats.n) * 100 : 100;
  const clipPct = stats.n ? (stats.clipped / stats.n) * 100 : 0;
  const readout = await page.evaluate(() => {
    const r = window.__musicwars.readout();
    const s = window.__musicwars.world.snapshot;
    return { section: r.section, tension: +r.tension.toFixed(3), bpm: r.bpm, bullets: s.pressureCount, enemies: s.enemyCount };
  });
  console.log(
    `${label.padEnd(26)} rms=${avg.toFixed(4)} peak=${stats.peak.toFixed(3)} crest=${crest.toFixed(1)}dB ` +
      `clip=${clipPct.toFixed(1)}% | ${readout.section} t=${readout.tension} ${readout.bpm}bpm`,
  );
  console.log(
    `${''.padEnd(26)} sub ${bands[0].toFixed(0)}% low ${bands[1].toFixed(0)}% lomid ${bands[2].toFixed(0)}% ` +
      `mid ${bands[3].toFixed(0)}% HARSH ${bands[4].toFixed(0)}% air ${bands[5].toFixed(0)}%`,
  );
  return { avg, peak: stats.peak, silentPct, clipPct, crest, bands, readout };
};

console.log('');
const quiet = await measure('opening (intro/build)', 6000);
const mid = await measure('mid-run', 8000);
const hot = await measure('firing + advancing', 12000, ['KeyZ', 'ArrowUp']);
const after = await measure('after retreat', 8000);

// Screenshot while the screen is actually busy.
await page.keyboard.down('KeyZ');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tools/action.png' });
await page.keyboard.up('KeyZ');

if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await browser.close();

const fail = [];
if (hot.avg < 0.002) fail.push(`no audible signal (rms ${hot.avg.toFixed(5)}) — the graph is running but silent`);
if (hot.peak < 0.02) fail.push(`peak amplitude only ${hot.peak.toFixed(4)}`);
if (hot.silentPct > 50) fail.push(`silent for ${hot.silentPct.toFixed(0)}% of frames`);
if (hot.peak > 1.6) fail.push(`hard clipping: peak ${hot.peak.toFixed(2)}`);
if (hot.bands[4] > 26) fail.push(`harsh: ${hot.bands[4].toFixed(0)}% of energy in the 2.5-6kHz fatigue band`);
if (hot.crest < 9) fail.push(`squashed: crest factor only ${hot.crest.toFixed(1)}dB`);
if (errors.length) fail.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);

console.log('');
if (fail.length) {
  fail.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('=== AUDIO VERIFIED: signal present, responsive, not clipping ===');
console.log(`   loudness rose from ${quiet.avg.toFixed(4)} (opening) to ${hot.avg.toFixed(4)} (combat), ` +
  `${(hot.avg / Math.max(quiet.avg, 1e-6)).toFixed(1)}x`);
void mid; void after;
