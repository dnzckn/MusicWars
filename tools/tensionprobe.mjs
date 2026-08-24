/** What the tension model's terms and channels actually reach in play. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
console.log(JSON.stringify(await p.evaluate(async () => {
  const mw = window.__musicwars;
  const tm = mw.director.tensionModel ?? null;
  const peak = {}, sum = {}; let n = 0;
  let rawMax = 0, sustMax = 0, immMax = 0, readoutMax = 0;
  const end = performance.now() + 150000;
  while (performance.now() < end) {
    const rd = mw.readout();
    readoutMax = Math.max(readoutMax, rd.tension);
    const st = mw.director.debugTension ? mw.director.debugTension() : null;
    if (st) {
      rawMax = Math.max(rawMax, st.raw); sustMax = Math.max(sustMax, st.sustained); immMax = Math.max(immMax, st.immediate);
      for (const [k, v] of Object.entries(st.terms)) { peak[k] = Math.max(peak[k] ?? 0, v); sum[k] = (sum[k] ?? 0) + v; }
      n++;
    }
    mw.world.player.lives = Math.max(3, mw.world.player.lives);
    await new Promise((r) => setTimeout(r, 200));
  }
  const round = (o, d = 1) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / d).toFixed(2)]));
  return { readoutMax: +readoutMax.toFixed(2), rawMax: +rawMax.toFixed(2), sustMax: +sustMax.toFixed(2), immMax: +immMax.toFixed(2),
    termPeak: round(peak), termMean: round(sum, n || 1), samples: n };
}), null, 1));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
