/**
 * Confirms enemy attacks land on beat subdivisions and are telegraphed first.
 *
 * RE-POINTED, NOT RETIRED. It used to watch `enemyBullets.spawned` jump and
 * read each emitter's `nextIn()` for the windup ring. Enemy fire is deleted;
 * the enemy attack is now a telegraphed LUNGE on the same absolute-beat
 * schedule, drawn with the same contracting ring by the same code in
 * `Renderer.drawEnemies`. Both assertions are unchanged in substance and in
 * threshold — attacks are on the grid, and something is visibly winding up —
 * because both are properties of the design rather than of the projectile.
 *
 * The windup matters MORE than it did. It used to decorate a volley that was
 * then visible in the air for a second; a lunge is over in a third of a second
 * and the ring is the only warning contact damage ever gives.
 */
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
  // The beat at which a charge committed. Read off the event the audio hears,
  // so this measures the thing the mix is given rather than a parallel guess.
  mw.world.bus.on('enemy:lunge', () => window.__fires.push(mw.world.warpedBeatNow));
  setInterval(() => {
    const w = mw.world;
    // Count frames where at least one enemy is visibly winding up. Same
    // half-beat window the renderer draws the ring in.
    for (const e of w.enemies) {
      if (!e.lunge || e.leaving || e.lungeBeat < 0 || e.lungeTime > 0) continue;
      if (e.lungeBeat - w.warpedBeatNow < 0.5) { window.__wind++; break; }
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
  return { lunges: f.length, onGridPct: Math.round((onGrid / Math.max(1, off.length)) * 100), windupFrames: window.__wind };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
// Print the denominator and treat zero as a failure: a run with no attacks in
// it reports 0% on-grid of nothing, and 0/0 must not read as a pass.
const ok = r.lunges >= 10 && r.onGridPct >= 70 && r.windupFrames > 50;
if (r.lunges < 10) console.log(`only ${r.lunges} attacks in 75s — the grid check measured nothing`);
console.log(ok ? 'ATTACKS ARE ON THE GRID AND TELEGRAPHED' : 'check telegraph');
if (!ok) process.exit(1);
