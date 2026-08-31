/*
 * SCRATCH. Does raising the treadmill speed change anything at all?
 *
 * The warp brief asks whether warp should also speed up `CRUISE_SPEED`, and
 * warns that it is one constant feeding `carryStage`, the bullet cull and the
 * camera. This measures the claim instead of arguing it: run the same seeds at
 * the shipped 430 and at 860, and compare the things that would move if the
 * arrival geometry had moved.
 *
 * The prediction being tested is that NOTHING moves, because the ship and the
 * whole world are advanced by the same constant — so in the stage's frame the
 * fight is identical and only the ABSOLUTE coordinates differ. The one thing
 * that must move is the control invariant from commit 2d5e783: full back is
 * `-CRUISE + PLAYER_SPEED`, which is exactly 0 today and is -430 at 860.
 *
 *   NODE_OPTIONS=--experimental-transform-types node tools/_cruiseab.mjs
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const DT = 1 / 120;
const MINUTES = Number(process.env.AB_MINUTES ?? 4);
const SEEDS = [0x51ed, 0x51ed + 7919, 0x51ed + 15838];

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);

/*
 * ONE CONFIGURATION PER INVOCATION, and the A/B is done by editing the
 * constant between runs and undoing it with a second edit. Importing the module
 * twice under a cache-buster would give two copies of `World` but only one set
 * of module-level constants in the copy `world.ts` itself imported, so the
 * "before" arm would silently be the "after" one — the shape of a harness that
 * measures nothing and reports a pass.
 */
async function run() {
  const { World } = await import('../src/game/world.ts');
  const { CRUISE_SPEED, TRIM_SPEED, PLAYER_SPEED } = await import('../src/game/player.ts');
  const rows = [];
  for (const seed of SEEDS) {
    const w = new World(seed);
    const brain = makeBrain('dodge');
    w.start();
    const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false, throttle: 0 };
    let kills = 0;
    let spawned = 0;
    w.bus.on('enemy:death', (e) => {
      if (e.byPlayer) kills++;
    });
    w.bus.on('enemy:spawn', () => spawned++);
    const n = Math.round((MINUTES * 60) / DT);
    const onScreen = [];
    const near = [];
    /** Closest approach of every arrival, the measure `pursuit` gates on. */
    const closest = new Map();
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) brain(w, inp);
      w.update(DT, inp);
      if (i % 12 === 0) {
        let vis = 0;
        for (const e of w.enemies) {
          if (
            e.x >= w.camera.viewX &&
            e.x <= w.camera.viewX + w.viewW &&
            e.y >= w.camera.viewY &&
            e.y <= w.camera.viewY + w.viewH
          ) {
            vis++;
          }
          const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
          const p = closest.get(e.id);
          if (p === undefined || d < p) closest.set(e.id, d);
        }
        onScreen.push(vis);
        near.push(w.threatDistance);
      }
    }
    const cs = [...closest.values()];
    rows.push({
      wave: w.waveIndex,
      level: w.progression.level,
      spawned,
      kills,
      screen50: q(onScreen, 0.5),
      screen90: q(onScreen, 0.9),
      near: mean(near),
      closest50: q(cs, 0.5),
      reached120: cs.filter((d) => d <= 120).length / Math.max(1, cs.length),
      tracked: cs.length,
    });
  }
  return { CRUISE_SPEED, TRIM_SPEED, PLAYER_SPEED, rows };
}

const a = await run();
console.log('\nCRUISE_SPEED A/B — same seeds, same bot, ' + MINUTES + ' min x ' + SEEDS.length + '\n');
console.log(`  shipped: CRUISE ${a.CRUISE_SPEED}  TRIM ${a.TRIM_SPEED}  PLAYER_SPEED ${a.PLAYER_SPEED}`);
console.log(`  full-back world velocity = -CRUISE + TRIM = ${-a.CRUISE_SPEED + a.TRIM_SPEED} px/s (0 is the 2d5e783 invariant)\n`);
const f = (r, k, d = 1) => mean(r.map((x) => x[k])).toFixed(d);
console.log(`  wave ${f(a.rows, 'wave')}  level ${f(a.rows, 'level')}  spawned ${f(a.rows, 'spawned', 0)}  kills ${f(a.rows, 'kills', 0)}`);
console.log(`  on-screen p50 ${f(a.rows, 'screen50')}  p90 ${f(a.rows, 'screen90')}  threatDistance ${f(a.rows, 'near', 3)}`);
console.log(`  closest approach p50 ${f(a.rows, 'closest50')}px   reached 120px ${(mean(a.rows.map((r) => r.reached120)) * 100).toFixed(1)}%   arrivals tracked ${f(a.rows, 'tracked', 0)}`);
console.log('');
