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
// The port is overridable so the same tool can measure two trees. Comparing a
// change against a remembered number is what AGENTS.md 6 forbids; comparing it
// against a HEAD worktree served on another port is the same tool, same run,
// same machine, and the only difference is the code under test.
const PORT = process.env.MW_PORT ?? '5173';
await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);

const rows = await p.evaluate(async (TYPES) => {
  const w = window.__musicwars.world;
  const mod = await import('/src/game/enemies.ts');
  const out = [];
  /*
   * THE TEST PAIR IS A FIXED PIXEL SEPARATION, NOT A FRACTION OF THE FIELD.
   *
   * This read `w.player.y = w.height * 0.8` and spawned at `w.height * 0.4`,
   * so the gap the volley has to cross was 40% of the field height. The whole
   * quantity this tool reports — what share of the ship's output reaches a
   * shape that is moving sideways — is a function of that gap: further away,
   * the sway has longer to carry the target out of the stream. On a 3x arena
   * the pair would be 3x apart and the hit rate would fall for reasons that
   * have nothing to do with any weapon or any archetype.
   *
   * The offsets reproduce today's 900x1120 positions EXACTLY (560 + 336 = 896
   * = 1120*0.8; 896 - 448 = 448 = 1120*0.4), so this is a numeric no-op now.
   * Anchored to the field centre, not the bottom edge, so a bigger arena keeps
   * the pair where the game is played rather than against a far wall.
   *
   * SEPARATION is passed as the archetype's `standoff` too, which is what the
   * old code did by coincidence of both being `w.height * 0.4`: the shape holds
   * the radius it was spawned at instead of closing on the ship.
   */
  const SEPARATION = 448;                 // px between ship and target
  // Anchored to the middle of the VIEW, not of the field: `w.height` is
  // `Infinity` on an unbounded travel axis and `Infinity/2 + 336` is not a
  // position. The view centre is the same point the old expression named at
  // one screen, and it is where the game is actually played.
  const SHIP_Y = w.camera.viewY + w.viewH / 2 + 336;
  const TARGET_Y = SHIP_Y - SEPARATION;
  const LANE_X = w.width / 2;             // both on one vertical line
  for (const t of TYPES) {
    w.enemies.length = 0;
    w.player.x = LANE_X;
    w.player.y = SHIP_Y;
    w.player.invuln = 999;
    const e = mod.spawnEnemy(t, LANE_X, TARGET_Y, 0.5, SEPARATION, false);
    // Its own homeX is what the movement oscillates around, so centre that on
    // the ship: the test is "parked directly underneath", not "parked next to".
    e.homeX = LANE_X;
    e.x = LANE_X;
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
        maxDx = Math.max(maxDx, Math.abs(e.x - LANE_X));
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
