/**
 * Rapid must be audible when the hats are already at their fastest.
 *
 * `hatDivision` tops out at sixteenths above intensity 0.7, and rapid works by
 * pushing intensity up a band — so in a busy fight, exactly when a player is
 * collecting powerups, RAPID changed nothing at all. It now opens the hats
 * instead. This measures the air band with and without it, interleaved, because
 * the panel showing a change is not the same as the speakers producing one.
 */
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
const r = await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  const air = async (ms) => {
    let sum = 0, n = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) {
        const f = new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(f);
        // ~6-14kHz: where an open hat lives.
        let hi = 0; for (let i = 512; i < 1200; i++) hi += f[i];
        sum += hi / 688; n++;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return n ? sum / n : 0;
  };
  const set = (lvl) => {
    for (const k of Object.keys(w.player.powerups)) delete w.player.powerups[k];
    for (const k of Object.keys(w.player.powerTimers)) delete w.player.powerTimers[k];
    w.player.held.length = 0;
    if (lvl) w.player.addPowerup('rapid', 120);
  };
  const off = [], on = [];
  for (let i = 0; i < 3; i++) {
    set(0); await new Promise((r) => setTimeout(r, 2400)); off.push(await air(3600));
    set(1); await new Promise((r) => setTimeout(r, 2400)); on.push(await air(3600));
  }
  set(0);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { off: +mean(off).toFixed(1), on: +mean(on).toFixed(1), intensity: +mw.readout().tension.toFixed(2) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
const gain = r.on / Math.max(0.1, r.off);
console.log(`air with rapid: ${gain.toFixed(2)}x`);
const ok = gain > 1.03;
if (!ok) console.log('rapid does not change the air band');
console.log(ok ? 'RAPID IS AUDIBLE' : 'RAPID IS SILENT');
process.exit(ok ? 0 : 1);
