/**
 * pursuit — does a body spawned BEHIND the ship ever actually reach it?
 *
 *   node --experimental-transform-types tools/pursuit.mjs [minutes] [runs]
 *
 * WHY THIS EXISTS. The stage is a treadmill and every group arrives from the
 * stern (`ARRIVAL_ANGLE` in `world.ts`). That geometry has one failure mode and
 * it is not a crash: a body placed behind a ship that is moving away from it
 * can never close, so the stage fills with things that are alive, counted,
 * simulated, drawn when they happen to be in shot — and completely unable to
 * participate. It was measured in play at 16 enemies ALIVE and ZERO on screen,
 * and `docs/research-density.md` §6 records the same shape from the other
 * direction: more bodies arriving behind a running ship measured as MORE
 * on-screen population and LESS damage taken, 18.3 hits to 1.0, because the
 * extra bodies were scenery.
 *
 * Nothing in this repository could see that. `arena` reports how many enemies
 * are alive and how many are on screen, and both of those numbers look healthy
 * for a crowd trailing half a screen astern; `spawnring` checks where a group
 * is PLACED and stops there. The question that matters is what happens after
 * the placement, and it has a yes-or-no answer per body: did it get within
 * contact range of the ship before it died, escaped, or was retired?
 *
 * WHAT IT MEASURES, per archetype and in total:
 *
 *   arrivals   bodies placed by the wave script (`generation === 0`). Births —
 *              an `echo` splitting at its parent's corpse — are excluded,
 *              because a body that starts on top of the player has not
 *              pursued anything.
 *   reached    of those, how many came within `CONTACT` of the ship at any
 *              point in their life.
 *   closest    the median of each body's closest approach, in pixels. The
 *              share alone can be high while every miss is a mile out, and the
 *              distribution is what says whether a near miss was near.
 *
 * BOTH DENOMINATORS ARE PRINTED, per AGENTS.md §3, and a run with zero
 * arrivals is a failure rather than a clean sheet.
 *
 * TWO GATES, and the second is the load-bearing one — see the note on
 * `MIN_REACHED`. The share of arrivals that reach the ship is a ratio of a
 * rare event and is dominated by how well the bot kites; the MEDIAN CLOSEST
 * APPROACH is what separates a pursuit from a procession.
 *
 * WHAT IT CANNOT SEE: whether the pursuit is FUN, or readable, or fair. It is
 * the same node-only harness `arena` uses and inherits every limitation in that
 * file's header, including that the bot is a policy and not a player. A human
 * who kites better than the bot will be reached less often.
 */

import './lib/tsnode.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const MINUTES = Number(process.argv[2] ?? 6);
const RUNS = Number(process.argv[3] ?? 3);
const DT = 1 / 120;

/**
 * How close counts as having reached the ship, in pixels.
 *
 * NOT `PLAYER_CONTACT` (11), which is the hitbox. Gating on an actual
 * collision would measure the bot's dodging rather than the geometry: every
 * archetype carries `standoff: 0` and closes all the way, so whether it
 * TOUCHES is a question about the player and whether it ARRIVES is a question
 * about the stage, and only the second one is being asked here.
 *
 * 120 px is about ten times the ship's own contact radius and comfortably
 * inside `DANGER_RADIUS` (110) plus a large body's radius, so a shape this
 * close is one the player is having to answer. It is also the radius the bot's
 * own flee term has already been fighting for a hundred pixels, which is why
 * the share reads single digits even on a perfectly healthy build — see the
 * control table below.
 */
const CONTACT = 120;

/*
 * THE TWO THRESHOLDS, AND EVERY NUMBER IN THEM WAS MEASURED ON THIS FILE.
 *
 * Three conditions, two runs of four simulated minutes each, dodge bot,
 * ~2,400-3,000 arrivals tracked per condition:
 *
 *                                     reached <=120px   median closest
 *   pre-treadmill tree (the control)        6.5%             394 px
 *   treadmill, crowd rides the stage        7.8%             354 px
 *   treadmill, carry removed                0.1%             724 px
 *
 * READ THE CONTROL FIRST, because it is the reason the share gate is 3% and
 * not 50%. A share of 6.5% looks like a broken game and is not: the bot flees
 * anything inside 240 px and makes 430 px/s sideways against a mob's 285, so
 * MOST bodies are supposed to be kept at arm's length. That is what the game
 * has always measured, and a threshold set by intuition rather than against
 * this control would have been a guess with an exit code. The first draft of
 * this file carried exactly that mistake — a gate of 50%, and a comment
 * asserting numbers nobody had run.
 *
 * What the control does NOT tolerate is the third row. With the carry removed,
 * arrivals sit 724 px astern and TWO of 2,398 ever reach the ship; `echo` and
 * `arpeggiator` vanish from the table entirely, because nothing survives long
 * enough to split. That is the state the owner saw in play as "16 enemies
 * alive, 0 on screen", and it is what these gates exist to catch.
 *
 * MIN_REACHED at 0.03 sits 2.6x under the live value and 30x over the broken
 * one. MAX_CLOSEST at 500 px is the better of the two discriminators and is
 * why both are here: the share is a ratio of a rare event and moves several
 * points run to run (4.8 / 7.6 on the control, 9.2 / 7.1 on the treadmill),
 * where the median closest approach is stable and separates 354 from 724
 * without ambiguity.
 */
const MIN_REACHED = 0.03;
const MAX_CLOSEST = 500;

const { World } = await import('../src/game/world.ts');

function runOnce(seed) {
  const w = new World(seed);
  const brain = makeBrain('dodge');
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: 0, banish: -1, reroll: false, skip: false,
  };

  /** id -> { archetype, closest, born } for every ARRIVAL still being tracked. */
  const tracked = new Map();
  const done = [];
  w.bus.on('enemy:spawn', (ev) => {
    const e = w.enemies.find((x) => x.id === ev.id);
    // `generation` is set by the split in `onEnemyKilled` and is 0 for anything
    // the wave script placed. A birth appears at its parent's corpse, which is
    // wherever the player just shot, so counting it would flatter the number.
    if (!e || e.generation > 0) return;
    tracked.set(e.id, { archetype: e.archetype, closest: Infinity });
  });
  w.bus.on('boss:spawn', () => {
    if (w.boss) tracked.set(w.boss.id, { archetype: 'conductor', closest: Infinity });
  });

  w.start();
  const steps = Math.round((MINUTES * 60) / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) brain(w, inp);
    w.update(DT, inp);
    // Sampled every 4th step rather than every step: a body closing at its own
    // speed moves under 3px in that time, which is well inside the 120px this
    // is comparing against, and the walk is otherwise the hot loop here.
    if (i % 4 === 0) {
      const px = w.player.x;
      const py = w.player.y;
      for (const e of w.enemies) {
        const t = tracked.get(e.id);
        if (!t) continue;
        const d = Math.hypot(e.x - px, e.y - py);
        if (d < t.closest) t.closest = d;
      }
    }
    // Retire the records of bodies that have left the field, so the closest
    // approach is final rather than still open at the end of the run.
    if (i % 240 === 0) {
      const live = new Set(w.enemies.map((e) => e.id));
      for (const [id, t] of tracked) {
        if (!live.has(id)) {
          done.push(t);
          tracked.delete(id);
        }
      }
    }
    if (w.isOver) break;
  }
  for (const t of tracked.values()) done.push(t);
  return done;
}

console.log(`\nPURSUIT — ${RUNS} runs of up to ${MINUTES} min, headless, no browser`);
console.log(`Everything arrives from the stern. Did it get within ${CONTACT}px of the ship?\n`);

const all = [];
for (let r = 0; r < RUNS; r++) {
  // The same seed ladder `arena` and `spawnring` use, so a number that moves in
  // one can be looked up in the others.
  const rows = runOnce(0x51ed + r * 7919);
  all.push(...rows);
  const got = rows.filter((t) => t.closest <= CONTACT).length;
  console.log(
    `  run ${r + 1}   arrivals ${String(rows.length).padStart(5)}` +
      `   reached ${String(got).padStart(5)}` +
      `   ${((got / Math.max(1, rows.length)) * 100).toFixed(1)}%`,
  );
}

const byType = new Map();
for (const t of all) {
  const row = byType.get(t.archetype) ?? { n: 0, got: 0, ds: [] };
  row.n++;
  if (t.closest <= CONTACT) row.got++;
  if (Number.isFinite(t.closest)) row.ds.push(t.closest);
  byType.set(t.archetype, row);
}
const median = (xs) => {
  if (!xs.length) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  return a[a.length >> 1];
};

console.log('');
console.log(`  ${'archetype'.padEnd(14)} ${'arrivals'.padStart(8)} ${'reached'.padStart(8)} ${'share'.padStart(7)} ${'median closest'.padStart(15)}`);
console.log(`  ${'-'.repeat(14)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(7)} ${'-'.repeat(15)}`);
for (const [k, v] of [...byType].sort((a, b) => b[1].n - a[1].n)) {
  console.log(
    `  ${k.padEnd(14)} ${String(v.n).padStart(8)} ${String(v.got).padStart(8)}` +
      ` ${((v.got / Math.max(1, v.n)) * 100).toFixed(1).padStart(6)}%` +
      ` ${median(v.ds).toFixed(0).padStart(14)}px`,
  );
}

const reached = all.filter((t) => t.closest <= CONTACT).length;
const share = all.length ? reached / all.length : 0;
console.log('');
console.log(`  ARRIVALS TRACKED     ${all.length}`);
console.log(`  reached the ship     ${reached}`);
console.log(`  SHARE                ${(share * 100).toFixed(1)}%   (gate ${(MIN_REACHED * 100).toFixed(0)}%)`);
const med = median(all.map((t) => t.closest));
console.log(`  MEDIAN CLOSEST       ${med.toFixed(0)}px   (gate ${MAX_CLOSEST}px)`);
console.log('  control, pre-treadmill tree: 6.5% and 394px. Carry removed: 0.1% and 724px.');

const problems = [];
if (all.length === 0) problems.push('nothing was tracked — 0 arrivals observed');
if (all.length > 0 && share < MIN_REACHED) {
  problems.push(
    `only ${(share * 100).toFixed(1)}% of arrivals ever got within ${CONTACT}px — bodies spawned behind cannot catch the ship`,
  );
}
if (all.length > 0 && !(med <= MAX_CLOSEST)) {
  problems.push(
    `the median arrival never got closer than ${med.toFixed(0)}px — the crowd is trailing the ship rather than reaching it`,
  );
}
console.log('');
for (const p of problems) console.log(`  FAIL  ${p}`);
console.log(problems.length ? '\nTHE PURSUIT IS SCENERY\n' : '\nWHAT ARRIVES BEHIND YOU GETS TO YOU\n');
if (problems.length) process.exit(1);
