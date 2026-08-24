/** Counts register flips while the player hovers on the boundary. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(7000);
const r = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const w = mw.world;
  let flips = 0, last = mw.readout().leadRegister;
  const seen = new Set([last]);
  // Also count how often the pattern set is rebuilt: a boundary that flickers
  // shows up there too, since the register is part of the structure key.
  const rebuild0 = mw.director.rebuildCount;
  // Hover exactly on the line with a pixel of drift, as a player holding
  // position mid-field inevitably does.
  const hold = setInterval(() => {
    w.player.y = w.height * (0.5 + Math.sin(performance.now() / 400) * 0.006);
  }, 16);
  const watch = setInterval(() => {
    const now = mw.readout().leadRegister;
    if (now !== last) { flips++; last = now; seen.add(now); }
  }, 50);
  await new Promise((res) => setTimeout(res, 18000));
  clearInterval(hold); clearInterval(watch);
  return { flips, values: [...seen], rebuilds: mw.director.rebuildCount - rebuild0 };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`hovering mid-field for 18s: ${r.flips} register flips, ${r.rebuilds} pattern rebuilds  (values: ${r.values.join(', ')})`);
const ok = r.flips <= 2 && r.rebuilds < 30;
console.log(ok ? 'STABLE' : 'FLICKERING');
if (!ok) process.exit(1);
