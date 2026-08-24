/**
 * How much of a run is *nothing happening*?
 *
 * Three screenshots of a live run all showed "empty stage" with zero bullets —
 * at wave 1, wave 3 and wave 4. Cutting clutter was the right call, but an
 * empty screen is not calm, it is dead air, and the run is meant to be a
 * musical adventure rather than a wait. This samples the actual occupancy.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.evaluate(() => {
  window.__ev = { pickups: 0, kills: 0 };
  const w = window.__musicwars.world;
  w.bus.on('powerup:pickup', () => window.__ev.pickups++);
  w.bus.on('enemy:death', () => window.__ev.kills++);
  
});
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 195000) {
  await p.waitForTimeout(500);
  samples.push(await p.evaluate(() => {
    const w = window.__musicwars.world;
    return {
      wave: w.waveIndex,
      enemies: w.enemies.length,
      bullets: w.enemyBullets.count,
      pickups: w.drops.length,
      powerups: w.snapshot.powerups ? Object.values(w.snapshot.powerups).filter((v) => v > 0).length : 0,
      dead: w.player.dead, phase: w.phase,
      px: Math.round(w.player.x), py: Math.round(w.player.y),
      ev: { ...window.__ev },
    };
  }));
}
const reloadCount = reloads();
if (reloadCount > 0) console.log(`WARNING: the page reloaded ${reloadCount}x mid-run; these numbers span more than one build`);
await b.close();
/*
 * An empty screen during the boss telegraph or the one-bar interlude is the
 * design working: the riser needs somewhere to build into, and a cleared wave
 * needs a beat to land. Only emptiness during actual combat is the player
 * waiting on the game.
 *
 * 'conductor' is the boss fight and counts as combat. Leaving it out made the
 * run look like it was only 31% combat, which prompted a hunt for 80 seconds of
 * dead air that were in fact the boss.
 */
const COMBAT = new Set(['spawning', 'conductor']);
const combat = samples.filter((s) => COMBAT.has(s.phase));
const total = combat.length;
const empty = combat.filter((s) => s.enemies === 0 && s.bullets === 0).length;
const noEnemies = combat.filter((s) => s.enemies === 0).length;
const noPowerups = samples.filter((s) => s.powerups === 0).length;
const pct = (n) => `${((n / total) * 100).toFixed(0)}%`;
// Longest unbroken stretch of an empty screen, in seconds.
let run = 0, worst = 0;
for (const s of combat) { if (s.enemies === 0 && s.bullets === 0) { run++; worst = Math.max(worst, run); } else run = 0; }
console.log(JSON.stringify({
  seconds: samples.length * 0.5, combatSeconds: total * 0.5, wave: samples[samples.length-1].wave,
  maxPickupsOnScreen: Math.max(...samples.map(s=>s.pickups)),
  emptyScreen: pct(empty), noEnemies: pct(noEnemies), noPowerupsHeld: `${((noPowerups/samples.length)*100).toFixed(0)}%`,
  longestEmptyStretch: worst * 0.5,
  medianEnemies: combat.map(s=>s.enemies).sort((a,b)=>a-b)[Math.floor(total/2)],
  maxEnemies: Math.max(...samples.map(s=>s.enemies)),
  maxBullets: Math.max(...samples.map(s=>s.bullets)),
  phaseSeconds: Object.fromEntries(Object.entries(samples.reduce((a, s) => { a[s.phase] = (a[s.phase] ?? 0) + 0.5; return a; }, {})).sort((x, y) => y[1] - x[1])),
  events: samples[samples.length-1].ev,
  shipMoved: new Set(samples.map(s=>`${s.px},${s.py}`)).size,
}, null, 1));
/*
 * Powerup uptime needs a long sample, and a threshold outside its own spread.
 *
 * The run is 195s rather than 120s because this metric is dominated by a
 * handful of discrete events: two runs of the same build collected 5 drops and
 * 19 drops respectively, and read 19% and 36% bare. Across seven measurements
 * it has ranged 19-65%, so the old 40% gate sat squarely inside the noise and
 * failed roughly one run in three for no reason connected to any change. The
 * screen-occupancy numbers above it are continuous and need none of this
 * treatment — it is only the pickup-driven one that is this lumpy.
 *
 * 55% still catches the state that prompted the check: the player held nothing
 * for 59% of a run, and powerups are supposed to be the norm rather than the
 * exception.
 */
const ok = empty / total < 0.2 && worst * 0.5 <= 5 && noPowerups / samples.length < 0.55;
console.log(ok ? 'THE STAGE STAYS OCCUPIED' : 'TOO MUCH DEAD AIR');
process.exit(ok ? 0 : 1);
