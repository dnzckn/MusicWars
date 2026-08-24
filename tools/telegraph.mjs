/** Confirms enemy volleys land on beat subdivisions and are telegraphed first. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(async () => {
  const mw = window.__musicwars;
  window.__fires = [];
  window.__wind = 0;
  let last = 0;
  setInterval(() => {
    const w = mw.world;
    // Record the beat at which the enemy bullet count jumps (a volley landed).
    const n = w.enemyBullets.spawned;
    if (n > last) window.__fires.push(w.warpedBeatNow);
    last = n;
    // Count frames where at least one enemy is visibly winding up.
    for (const e of w.enemies) {
      if (!e.armed || e.leaving) continue;
      let soonest = Infinity;
      for (const em of e.emitters) soonest = Math.min(soonest, em.nextIn(w.warpedBeatNow));
      if (soonest < 0.5) { window.__wind++; break; }
    }
  }, 16);
});
await p.keyboard.down('KeyZ');
await p.waitForTimeout(75000);
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const f = window.__fires;
  // Distance from the nearest 1/4-beat subdivision.
  const off = f.map((b) => { const x = b * 4; const fr = x % 1; return Math.min(fr, 1 - fr) / 4; });
  const onGrid = off.filter((o) => o < 0.07).length;
  return { volleys: f.length, onGridPct: Math.round((onGrid / Math.max(1, off.length)) * 100), windupFrames: window.__wind };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
const ok = r.onGridPct >= 70 && r.windupFrames > 50;
console.log(ok ? 'FIRE IS ON THE GRID AND TELEGRAPHED' : 'check telegraph');
if (!ok) process.exit(1);
