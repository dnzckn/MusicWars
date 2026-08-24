/**
 * Repeated solo measurement of one stem across several sections.
 *
 * A single solo sample lands wherever the arrangement happens to be, so one low
 * reading proves nothing. This measures the same stem several times, spread out,
 * and reports the spread — enough to tell a genuinely quiet layer from an
 * unlucky sample.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const STEM = process.env.STEM ?? 'hats';
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
await p.waitForTimeout(14000);
const rows = await p.evaluate(async (stem) => {
  const mw = window.__musicwars;
  const measure = async (ms) => {
    let sum = 0, n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) { a.getFloatTimeDomainData(window.__buf);
        let acc = 0; for (let i = 0; i < window.__buf.length; i++) acc += window.__buf[i] ** 2;
        sum += Math.sqrt(acc / window.__buf.length); n++; }
      await new Promise((r) => setTimeout(r, 16));
    }
    return n ? sum / n : 0;
  };
  const out = [];
  for (let i = 0; i < 6; i++) {
    mw.director.solo = null;
    await new Promise((r) => setTimeout(r, 2500));
    const ref = await measure(1800);
    mw.director.solo = stem;
    await new Promise((r) => setTimeout(r, 600));
    const solo = await measure(2200);
    const rd = mw.readout();
    out.push({ section: rd.section, fader: +rd.levels[stem].toFixed(2), solo: +solo.toFixed(5),
      full: +ref.toFixed(5), notes: mw.director.sampleBar(mw.world.transport)[stem].length });
  }
  mw.director.solo = null;
  return out;
}, STEM);
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`stem: ${STEM}`);
console.table(rows);
const audible = rows.filter((r) => r.solo > 0.0002);
console.log(`readings above the noise floor: ${audible.length}/${rows.length}`);
