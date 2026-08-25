/*
 * aimcheck — do the bolts the ship fires actually intersect the thing it aimed at?
 *
 * WHY THIS EXISTS. `computeAim` resolves `seekAim` to the bearing of a specific
 * enemy, and `fireSeek` then decides where each bolt actually goes. Between
 * those two steps the game spent its entire life shooting AROUND the target.
 * The old body fanned bolts as
 *
 *     const t = n === 1 ? 0 : i / (n - 1) - 0.5;
 *     const angle = p.seekAim + t * spreadTotal;
 *
 * and for any EVEN count `t` never takes the value 0 — at n = 2 it is exactly
 * -0.5 and +0.5, so both bolts left at `seekAim ± spreadTotal/2` and the aim
 * itself was the gap between them. PIZZICATO, the instrument every run starts
 * with, is `count: 2` (`weapons.ts`), so this was live from the first second of
 * every run and got worse on the even rungs of its own upgrade ladder.
 *
 * Nothing in the suite could see it. Every gate that touched the gun measured
 * damage, cooldown, or on-screen pressure — all of which are perfectly healthy
 * while every bolt sails past. `hitrate` can see it, but it needs a browser and
 * a dev server, and it reports a rate rather than asserting, so it cannot fail
 * a build. Measured through `hitrate` against a HEAD worktree, four of the five
 * enemy archetypes could not be killed at all inside twelve seconds.
 *
 * WHAT IT MEASURES, and the distinction is the point. Not the source text and
 * not the damage numbers: it drives the real `World`, plants one real enemy at
 * a known bearing and distance, calls the real `fireSeek`, and then does pure
 * geometry on the bullets that were actually spawned into the real pool —
 * closest forward approach of each bolt's ray to the enemy's centre, against
 * the enemy's radius plus the bolt's. It holds no copy of anyone else's
 * arithmetic beyond the ray-point distance.
 *
 * THE ASSERTION is deliberately weak: for every count and range, AT LEAST ONE
 * bolt must connect. Not all of them — with several bolts and one target the
 * spares are legitimately doubled up or spread over other enemies. "At least
 * one" is the strongest thing that is true of a single stationary target, and
 * it was comprehensively false before.
 *
 * The parameter sweep is chosen against the defect rather than around it. The
 * old lateral error is `distance * tan(spread/2)`, so a check that only fired
 * at 60px would have passed on the broken code — the ranges bracket where the
 * straddle starts costing hits. Every count from 1 to 6 is covered because the
 * bug was PARITY-dependent and a check that only tried odd counts would also
 * have passed. Bearings are off the cardinal axes because the old fan was
 * symmetric and would have looked fine fired straight up.
 */
await import('./lib/headless-audio.mjs');

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { spawnEnemy } = await import(`${R}game/enemies.ts`);
const { instrumentStats } = await import(`${R}game/weapons.ts`);

const SEED = 12345;

/*
 * Distance from the enemy centre to the bolt's ray, forward only.
 *
 * A bolt that has already gone past cannot hit it, so a negative projection is
 * a miss and not a near approach behind the muzzle. Getting this wrong would
 * make a shot fired directly AWAY from the target score as a perfect hit.
 */
function rayMiss(ox, oy, angle, tx, ty) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const vx = tx - ox;
  const vy = ty - oy;
  if (vx * dx + vy * dy <= 0) return Infinity;
  return Math.abs(vx * dy - vy * dx);
}

const COUNTS = [1, 2, 3, 4, 5, 6];
const RANGES = [80, 120, 170, 250, 350, 500];
const BEARINGS = [0, 0.7, 1.9, 3.0, 4.4, 5.6];
/* PIZZICATO at level 1 is the real starting weapon; its range is 620, so every
 * range above is inside it and a miss cannot be excused as out of reach. */
const BASE = instrumentStats('pizzicato', 1);

let checked = 0;
const failures = [];

for (const count of COUNTS) {
  for (const range of RANGES) {
    for (const bearing of BEARINGS) {
      const w = new World(SEED);
      w.start();
      const p = w.player;

      // Exactly one target, so "at least one bolt connects" is unambiguous.
      w.enemies.length = 0;
      w.playerBullets.count = 0;

      const ex = p.x + Math.cos(bearing) * range;
      const ey = p.y + Math.sin(bearing) * range;
      const e = spawnEnemy('pluck', ex, ey, 0.5);
      e.x = e.prevX = ex;
      e.y = e.prevY = ey;
      e.invuln = 0;
      w.enemies.push(e);

      p.facing = bearing;
      p.seekAim = bearing;
      p.aim = bearing;
      p.focused = false;

      // TypeScript `private` is erased at runtime; this is the real firing path
      // the game uses, not a reimplementation of it.
      w.fireSeek({ ...BASE, count });

      const n = w.playerBullets.count;
      if (n === 0) {
        console.log(`\n  FAIL  no bullets were spawned at count ${count} — the firing path did not run\n`);
        process.exit(1);
      }

      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const m = rayMiss(
          w.playerBullets.x[i],
          w.playerBullets.y[i],
          w.playerBullets.angle[i],
          e.x,
          e.y,
        );
        if (m < best) best = m;
      }

      checked++;
      const allow = e.radius + w.playerBullets.radius[0];
      if (!(best <= allow)) {
        failures.push({ count, range, bearing: bearing.toFixed(2), miss: best, allow });
      }
    }
  }
}

console.log('\naimcheck — does a bolt actually reach what the ship aimed at?\n');
console.log(
  `  ${checked} shots examined (${COUNTS.length} counts x ${RANGES.length} ranges x ${BEARINGS.length} bearings)`,
);

/*
 * A check that examined nothing reports a pass. This repo has shipped exactly
 * that -- a tool that threw on every seed, printed "0 taken, 0 wrong" and
 * exited green -- so zero is a failure here, not a clean sheet.
 */
if (checked === 0) {
  console.log('\n  FAIL  nothing was examined, which is not the same as nothing being wrong\n');
  process.exit(1);
}

if (failures.length > 0) {
  const byCount = new Map();
  for (const f of failures) byCount.set(f.count, (byCount.get(f.count) ?? 0) + 1);
  console.log(`\n  ${failures.length} of ${checked} shots put NO bolt inside the target:\n`);
  console.log(
    `    by bolt count: ${[...byCount.entries()].map(([c, n]) => `${c}->${n}`).join('  ')}`,
  );
  console.log('');
  for (const f of failures.slice(0, 10)) {
    console.log(
      `    count ${f.count}  range ${String(f.range).padStart(3)}  bearing ${f.bearing}  ` +
        `closest bolt ${f.miss.toFixed(1)}px, needed <= ${f.allow.toFixed(1)}px`,
    );
  }
  if (failures.length > 10) console.log(`    ...and ${failures.length - 10} more`);
  console.log('\n  FAIL  the ship is firing around its target, not at it\n');
  process.exit(1);
}

console.log('  ok    every shot put at least one bolt inside the target\n');
