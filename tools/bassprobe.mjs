/** Long-window solo of one stem vs the kick, to settle whether it is audible. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await p.addInitScript(() => {
  const oc = AudioNode.prototype.connect; window.__tap = null;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try { if (d && d.context && d === d.context.destination) {
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 4096; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap); } } catch {}
    return res; };
});
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(14000);
console.table(await p.evaluate(async () => {
  const mw = window.__musicwars;
  const measure = async (ms) => {
    let sum = 0, n = 0, peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) { a.getFloatTimeDomainData(window.__buf);
        let acc = 0; for (let i = 0; i < window.__buf.length; i++) { const v = window.__buf[i]; acc += v*v; if (Math.abs(v) > peak) peak = Math.abs(v); }
        sum += Math.sqrt(acc / window.__buf.length); n++; }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { rms: n ? sum / n : 0, peak };
  };
  const out = [];
  for (const id of ['kick', 'bass', 'sub', 'clap', 'chords']) {
    mw.director.solo = id;
    await new Promise((r) => setTimeout(r, 1200));
    const m = await measure(9000);
    out.push({ stem: id, rms: +m.rms.toFixed(6), peak: +m.peak.toFixed(4),
      dbVsKick: out.length ? +(20*Math.log10(m.rms / out[0].rms)).toFixed(1) : 0,
      fader: +mw.readout().levels[id].toFixed(2) });
  }
  mw.director.solo = null;
  return out;
}));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
