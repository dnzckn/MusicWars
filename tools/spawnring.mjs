/**
 * spawnring — nothing may be placed inside the rectangle the player is looking
 * at, and the escape rate must not move when the geometry does.
 *
 *   node tools/spawnring.mjs [minutes] [runs]
 *
 * WHY THIS EXISTS. Until the camera moved, "enemies arrive from off screen" was
 * true BY CONSTRUCTION and there was nothing to check: `arenaSpawnPositions`
 * cast its ray from the middle of the field, the field was the screen, and the
 * only way to land inside the view was to pass a negative margin. That is no
 * longer the shape of the code. The ring is now the VIEW rectangle centred on
 * `camera.viewX/viewY`, and the field is several screens across, so there are
 * three new ways to put a group on the player's head — a stale centre, a ring
 * sized from `PLAYFIELD_*` instead of `VIEW_*`, and a camera read one frame
 * late while the view is panning fast. None of them throws. All of them look
 * like enemies materialising in the room, which is precisely the failure
 * `waves.ts` says the rectangle ray-cast exists to prevent.
 *
 * AGENTS.md §3: "before writing a threshold, ask how someone could pass it
 * while changing nothing." The inverse applies here — this check would have
 * been vacuous the day before the camera moved, and it is load-bearing the day
 * after. It is written now, against the code that made it necessary.
 *
 * TWO KINDS OF SPAWN, AND ONLY ONE OF THEM IS AN ARRIVAL. The first draft of
 * this file asserted "no spawn lands in the view" and went red on 427 of 2428,
 * every one of them an `echo` appearing on top of the player. Those are not
 * arrivals: `onEnemyKilled` splits an echo into two children at the parent's
 * corpse, and the parent was on screen because the player had just shot it.
 * Appearing in view is the whole point of a split. So the population is
 * classified — an ARRIVAL is placed by the wave script on the ring
 * (`generation === 0`), a BIRTH comes out of a death (`generation > 0`) — and
 * the gate is on arrivals. Both counts are printed, because "0 violations"
 * over a population that quietly stopped containing arrivals is the vacuous
 * pass AGENTS.md §3 warns about.
 *
 * WHAT IT ASSERTS
 *
 *   1. Every ARRIVAL — mobs and the boss — is OUTSIDE the view rect as it stood
 *      at the moment of the spawn. Not the view rect now, and not the field.
 *   2. Its clearance is at least `MIN_CLEARANCE` px. Zero would be satisfied by
 *      a group placed one pixel off the edge, which is an enemy popping into
 *      existence at the frame boundary rather than arriving.
 *   3. Arrivals were actually seen, and so were births. A run that spawned
 *      nothing would otherwise print a clean sheet — the `mirror` incident in
 *      AGENTS.md §3, where a check examined zero rows and exited green — and a
 *      run with no births would mean the classification above had never been
 *      exercised and could be inverted without anything noticing.
 *
 * WHAT IT REPORTS RATHER THAN GATES
 *
 * Escapes per wave. `world.ts` culls at `CULL_MARGIN` outside the FIELD, and
 * a wave cannot end until every enemy is dead or escaped, so the escape rate
 * is the quantity that tells you whether a geometry change has started
 * stranding enemies (waves stall) or deleting them early (waves evaporate).
 * It is reported, not gated, because the right value is a design question and
 * the useful comparison is against the previous run of this file.
 *
 * WHAT IT CANNOT SEE: anything about rendering, audio or feel. It is the same
 * node-only harness `arena` uses and inherits every limitation in that file's
 * header, including that the bot is a policy and not a player.
 */

import './lib/tsnode.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const MINUTES = Number(process.argv[2] ?? 8);
const RUNS = Number(process.argv[3] ?? 3);
const DT = 1 / 120;

/**
 * How far outside the view a spawn must be, in pixels.
 *
 * NOT `SPAWN_MARGIN` (70), and the difference is geometry rather than slack.
 * `edgePoint` pushes `margin` along the RAY, so the perpendicular clearance
 * from the edge it crossed is `margin * |cos|` or `margin * |sin|` — smallest
 * at the corners. For a 900x1120 ring the corner ray has |cos| = 0.626, giving
 * 43.8px at a margin of 70. 30 sits below that and above zero: it fails a ring
 * that has collapsed onto the view and passes every formation the table can
 * currently produce, including `arc`, whose bow costs it depth at the middle.
 */
const MIN_CLEARANCE = 30;

const { World } = await import('../src/game/world.ts');
const { VIEW_W, VIEW_H } = await import('../src/game/field.ts');

/**
 * Signed distance from a point to the view rect: negative INSIDE, positive
 * outside, and outside it is the distance to the nearest edge or corner.
 *
 * Written as a real signed distance rather than as a boolean so the report can
 * say how close the worst spawn came, which is the number that would show a
 * regression drifting toward the failure before it arrives.
 */
function clearance(x, y, vx, vy) {
  const dx = Math.max(vx - x, x - (vx + VIEW_W));
  const dy = Math.max(vy - y, y - (vy + VIEW_H));
  if (dx <= 0 && dy <= 0) return Math.max(dx, dy); // inside: negative
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

function runOnce(seed) {
  const w = new World(seed);
  const brain = makeBrain('dodge');
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };

  const spawns = [];
  const record = (e) => {
    if (!e) return;
    spawns.push({
      archetype: e.archetype,
      // `generation` is set by the split in `onEnemyKilled` and is 0 for
      // anything the wave script placed. Read off the enemy rather than taken
      // from the event, because the event carries only an id and an archetype
      // and widening it would put a tool's classification into the game's
      // public surface.
      birth: e.generation > 0,
      c: clearance(e.x, e.y, w.camera.viewX, w.camera.viewY),
      x: e.x,
      y: e.y,
      vx: w.camera.viewX,
      vy: w.camera.viewY,
      wave: w.waveIndex + 1,
    });
  };
  // `enemy:spawn` is emitted from inside `spawnGroup` after the push, so the
  // enemy is on the list and has not been moved by anything yet. Looked up by
  // id rather than taken as the last element: `flank` rewrites positions after
  // the push and a future formation could reorder.
  w.bus.on('enemy:spawn', (ev) => record(w.enemies.find((e) => e.id === ev.id)));
  w.bus.on('boss:spawn', () => record(w.boss));

  // byPlayer:false is exactly the escaped branch in `updateEnemies` — the kill
  // branch calls `onEnemyKilled`, which emits with byPlayer true.
  let escaped = 0;
  let killed = 0;
  w.bus.on('enemy:death', (e) => (e.byPlayer ? killed++ : escaped++));

  w.start();
  const steps = Math.round((MINUTES * 60) / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) brain(w, inp);
    w.update(DT, inp);
    if (w.isOver) break;
  }
  return { spawns, escaped, killed, waves: w.waveIndex + 1 };
}

console.log(`\nSPAWN RING — ${RUNS} runs of up to ${MINUTES} min, view ${VIEW_W} x ${VIEW_H}`);
console.log(`field ${new World(1).width} x ${new World(1).height}\n`);

let arrivals = 0;
let births = 0;
let inside = 0;
let tooClose = 0;
let worst = { c: Infinity };
const perRun = [];

for (let r = 0; r < RUNS; r++) {
  // The same seed ladder `tools/arena.mjs` uses, so the two files describe the
  // same three runs and a number that moves in one can be looked up in the
  // other.
  const out = runOnce(0x51ed + r * 7919);
  for (const s of out.spawns) {
    if (s.birth) {
      births++;
      continue;
    }
    arrivals++;
    if (s.c <= 0) inside++;
    else if (s.c < MIN_CLEARANCE) tooClose++;
    if (s.c < worst.c) worst = s;
  }
  perRun.push(out);
  console.log(
    `  run ${r + 1}   arrivals ${String(out.spawns.filter((s) => !s.birth).length).padStart(5)}` +
      `   births ${String(out.spawns.filter((s) => s.birth).length).padStart(5)}` +
      `   waves ${String(out.waves).padStart(3)}` +
      `   killed ${String(out.killed).padStart(5)}` +
      `   escaped ${String(out.escaped).padStart(4)}` +
      `   escaped/wave ${(out.escaped / Math.max(1, out.waves)).toFixed(2)}`,
  );
}

const totWaves = perRun.reduce((a, x) => a + x.waves, 0);
const totEsc = perRun.reduce((a, x) => a + x.escaped, 0);
const totKill = perRun.reduce((a, x) => a + x.killed, 0);

// Every denominator, printed. AGENTS.md §3: zero and clean look identical
// unless the count is on the page.
console.log('');
console.log(`  ARRIVALS checked          ${arrivals}`);
console.log(`  births (not gated)        ${births}`);
console.log(`  arrivals inside the view  ${inside}`);
console.log(`  outside but < ${MIN_CLEARANCE}px clear   ${tooClose}`);
console.log(
  `  closest arrival           ${worst.c === Infinity ? 'n/a' : `${worst.c.toFixed(1)}px  (${worst.archetype} at ${worst.x.toFixed(0)},${worst.y.toFixed(0)} — view at ${worst.vx.toFixed(0)},${worst.vy.toFixed(0)})`}`,
);
console.log('');
console.log(`  waves reached (total)     ${totWaves}`);
console.log(`  enemies killed / escaped  ${totKill} / ${totEsc}`);
console.log(`  ESCAPED PER WAVE          ${(totEsc / Math.max(1, totWaves)).toFixed(2)}`);
console.log(`  escaped share of deaths   ${((totEsc / Math.max(1, totEsc + totKill)) * 100).toFixed(1)}%`);
console.log('');

const problems = [];
if (arrivals === 0) problems.push('nothing was checked — 0 arrivals observed');
if (births === 0) problems.push('0 births observed — the arrival/birth split was never exercised');
if (inside > 0) problems.push(`${inside} of ${arrivals} arrivals landed INSIDE the view`);
if (tooClose > 0) problems.push(`${tooClose} of ${arrivals} arrivals cleared the view by less than ${MIN_CLEARANCE}px`);

for (const p of problems) console.log(`  FAIL  ${p}`);
console.log(problems.length ? '\ncheck the spawn ring\n' : '\nEVERYTHING ARRIVES FROM OFF SCREEN\n');
if (problems.length) process.exit(1);
