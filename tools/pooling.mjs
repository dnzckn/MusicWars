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
  // Sustained grazing: a continuous stream past the ship, plus explosions.
  const feed = setInterval(() => {
    for (let i = 0; i < 6; i++) {
      w.enemyBullets.spawn({ x: w.player.x + (i % 2 ? 21 : -21), y: w.player.y - 120,
        angle: Math.PI / 2, speed: 300, radius: 4, ttl: 3, type: 0 });
    }
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
