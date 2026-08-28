/** Does sustained grazing starve the particle pool of slots for explosions? */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(9000);
const r = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  w.particles.dropped = 0;
  let peak = 0, peakRings = 0;
  const watch = setInterval(() => {
    peak = Math.max(peak, w.particles.count);
    let rings = 0;
    for (let i = 0; i < w.particles.count; i++) if (w.particles.shape[i] === 2) rings++;
    peakRings = Math.max(peakRings, rings);
  }, 40);
  /*
   * Sustained grazing, plus explosions.
   *
   * It used to feed a stream of enemy BULLETS past the ship, because grazing
   * meant near-missing a bullet. There is no enemy bullet pool; a graze is now
   * a BODY entering the annulus around the ship and leaving it again
   * (`World.collidePlayer`), so the feed parks bodies at graze range and clears
   * their latch each tick, which is the same "one graze per pass" stream at a
   * far higher rate than play produces.
   */
  const mod = await import('/src/game/enemies.ts');
  const feed = setInterval(() => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const e = mod.spawnEnemy('stutter', w.player.x + Math.cos(a) * 22, w.player.y + Math.sin(a) * 22, 0.5, false);
      e.move = () => {};
      w.enemies.push(e);
    }
    for (const e of w.enemies) e.grazed = false;
    w.player.invuln = 1;
    w.particles.burst(w.rng, 360, 400, 40, 300, 20, 0.7, 4);
  }, 60);
  await new Promise((res) => setTimeout(res, 12000));
  clearInterval(feed); clearInterval(watch);
  return { peak, peakRings, dropped: w.particles.dropped, capacity: w.particles.capacity,
    grazes: w.totals.grazes };
});
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
const ok = r.dropped === 0 && r.peak < r.capacity * 0.9;
console.log(ok ? 'POOL HAS HEADROOM UNDER SUSTAINED GRAZING' : 'pool saturating');
if (!ok) process.exit(1);
