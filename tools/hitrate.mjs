/**
 * How much of a volley actually lands on a shape that is moving sideways.
 *
 * `ttk` answers "how long does this take to kill" by parking a target, and for
 * everything that holds still that is the right question asked the right way.
 * It cannot answer it for `stutter`: it pins the target's position every 50ms
 * while the sim steps at 120Hz, so a hopping enemy slips between pins and eats
 * shots that would have landed on a stationary one. Its 1.8s reading for the
 * swarm is therefore not evidence about the swarm — the instrument is fighting
 * the movement it is trying to measure through.
 *
 * This pins nothing. It zeroes the target's *descent* (`vy = 0`), which stops
 * it drifting out of the test without touching the sideways motion at all, and
 * then lets the archetype's own move function run at full rate against a
 * stationary firing ship. What comes out is the real quantity: of the bullets
 * fired at a shape, how many hit it.
 *
 * Read `dps`, and `% of best` beside it — the share of the ship's output that
 * reaches this shape, against whichever archetype in the same session sat
 * still. dps is the honest measure here because it is damage per second and
 * therefore independent of the target's hp; time-to-kill is not.
 *
 * An earlier version counted bullets fired as `seconds / weapon.interval *
 * shots` and bullets landed as `damage / weapon.damage`, and reported 121% for
 * pluck. Drone pods fire their own bullets at 0.6x damage and appear in neither
 * term, so both halves of the fraction were wrong. Any hit-rate estimate here
 * has to account for the whole loadout, which is why this reports a ratio
 * between two measurements taken under the same loadout instead.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const TYPES = (process.env.TYPES ?? 'stutter,pluck,echo,glissando,arpeggiator').split(',');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);

const rows = await p.evaluate(async (TYPES) => {
  const w = window.__musicwars.world;
  const mod = await import('/src/game/enemies.ts');
  const out = [];
  for (const t of TYPES) {
    w.enemies.length = 0;
    w.enemyBullets.clear();
    w.player.x = w.width / 2;
    w.player.y = w.height * 0.8;
    w.player.invuln = 999;
    const e = mod.spawnEnemy(t, w.width / 2, w.height * 0.4, 0.5, w.height * 0.4, false);
    // Its own homeX is what the movement oscillates around, so centre that on
    // the ship: the test is "parked directly underneath", not "parked next to".
    e.homeX = w.width / 2;
    e.x = w.width / 2;
    e.vy = 0;
    w.enemies.push(e);
    const hp0 = e.hp;
    window.__botInput = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false };
    const t0 = performance.now();
    let maxDx = 0;
    await new Promise((done) => {
      const tick = () => {
        if (!w.enemies.includes(e) || performance.now() - t0 > 12000) return done();
        e.vy = 0;
        maxDx = Math.max(maxDx, Math.abs(e.x - w.width / 2));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const secs = (performance.now() - t0) / 1000;
    const killed = !w.enemies.includes(e);
    out.push({ archetype: t, hp: hp0, radius: e.radius, killed,
      seconds: +secs.toFixed(2), dps: +((hp0 - Math.max(0, e.hp)) / secs).toFixed(1),
      'sway px': Math.round(maxDx) });
  }
  window.__botInput = null;
  w.player.invuln = 0;
  return out;
}, TYPES);
if (reloads()) console.log(`WARNING: page reloaded ${reloads()}x mid-run; these numbers span more than one build`);
await b.close();
const best = Math.max(...rows.map((r) => r.dps));
for (const r of rows) r['% of best'] = Math.round((r.dps / best) * 100);
console.table(rows);
console.log(`the ship's output reaches each shape at: ${rows.map((r) => `${r.archetype} ${r['% of best']}%`).join(', ')}`);
