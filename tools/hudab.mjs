/** A/B: how much of the frame is the DOM HUD's style/layout/paint? */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.evaluate(() => window.__musicwars.world.jumpToWave(20));
await p.waitForTimeout(3000);
const raf = async (label) => {
  const r = await p.evaluate(async () => {
    const f = []; let last = performance.now();
    await new Promise((res) => { const tick = (t) => { f.push(t - last); last = t; if (f.length < 420) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    const s = f.slice(20).sort((a, c) => a - c);
    return { fps: +(1000 / (s.reduce((a, c) => a + c, 0) / s.length)).toFixed(1),
      over20: +((s.filter((x) => x > 20).length / s.length) * 100).toFixed(1) };
  });
  console.log(label, JSON.stringify(r));
};
/*
 * Interleaved, not sequential.
 *
 * Measured once each, this said the HUD cost 7.7fps; measured again it said the
 * HUD cost nothing. Frame rate here drifts by ~5fps with the arrangement and
 * the enemy count, which is larger than the effect being looked for. Same
 * lesson volcheck learned about loudness: alternate the conditions and compare
 * means, or the answer is whatever the run happened to be doing.
 */
const measure = async () => p.evaluate(async () => {
  const f = []; let last = performance.now();
  await new Promise((res) => { const tick = (t) => { f.push(t - last); last = t; if (f.length < 260) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const s = f.slice(20);
  return 1000 / (s.reduce((a, c) => a + c, 0) / s.length);
});
const on = [], off = [];
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => { const mw = window.__musicwars; if (mw.__hudOrig) mw.hud.update = mw.__hudOrig; });
  on.push(await measure());
  await p.evaluate(() => { const mw = window.__musicwars; mw.__hudOrig = mw.__hudOrig ?? mw.hud.update; mw.hud.update = () => {}; });
  off.push(await measure());
}
await p.evaluate(() => { const mw = window.__musicwars; mw.hud.update = mw.__hudOrig; });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log('HUD on :', on.map((x) => x.toFixed(1)).join(' '), '=> mean', mean(on).toFixed(1), 'fps');
console.log('HUD off:', off.map((x) => x.toFixed(1)).join(' '), '=> mean', mean(off).toFixed(1), 'fps');
console.log('HUD costs', (mean(off) - mean(on)).toFixed(1), 'fps');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
