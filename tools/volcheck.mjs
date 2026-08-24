import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await p.addInitScript(() => {
  const oc = AudioNode.prototype.connect;
  window.__tap = null;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try { if (d && d.context && d === d.context.destination) {
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 2048; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap);
    } } catch {}
    return res;
  };
});
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(9000);
const measure = async (label, pct) => {
  if (pct !== null) {
    await p.evaluate((v) => {
      const s = document.getElementById('ui-volume');
      s.value = String(v); s.dispatchEvent(new Event('input'));
    }, pct);
  }
  await p.waitForTimeout(2500);
  const rms = await p.evaluate(async () => {
    let sum = 0, n = 0;
    const end = performance.now() + 4000;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) { a.getFloatTimeDomainData(window.__buf);
        let acc = 0; for (let i = 0; i < window.__buf.length; i++) acc += window.__buf[i] ** 2;
        sum += Math.sqrt(acc / window.__buf.length); n++; }
      await new Promise((r) => setTimeout(r, 16));
    }
    return n ? sum / n : 0;
  });
  console.log(`${label.padEnd(16)} rms=${rms.toFixed(5)}`);
  return rms;
};
/*
 * Alternate the two settings instead of measuring them once each.
 *
 * The arrangement's own loudness varies by more than 5x between a breakdown and
 * a drop, which completely swamps a 2.5x fader difference: measured once each,
 * 40% came out *louder* than 100% simply because it landed on a busier bar.
 * Interleaving short samples cancels that drift.
 */
// Interleaving makes this a ~50s check, which is long enough that editing a
// source file mid-run lets Vite's HMR full-reload the page out from under it
// ("Execution context was destroyed"). That is the tool being right and the
// operator being wrong: don't edit src/ while the browser suite is running.
const fulls = [];
const halves = [];
for (let i = 0; i < 3; i++) {
  fulls.push(await measure(`volume 100% (${i + 1})`, 100));
  halves.push(await measure(`volume 40%  (${i + 1})`, 40));
}
// `measure` returns a plain rms number, not an object.
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const full = mean(fulls);
const half = mean(halves);
console.log(`\nmean rms — 100%: ${full.toFixed(5)}   40%: ${half.toFixed(5)}`);
await p.evaluate(() => document.getElementById('ui-mute').click());
await p.waitForTimeout(2500);
const muted = await measure('muted', null);
const label = await p.evaluate(() => document.getElementById('ui-volnum').textContent);
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`\nmute label shows: "${label}"`);
const ok = half < full * 0.8 && half > full * 0.1 && muted < full * 0.06 && label === 'off';
console.log(ok ? 'VOLUME CONTROL WORKS' : 'VOLUME CONTROL NOT WORKING');
if (!ok) process.exit(1);

