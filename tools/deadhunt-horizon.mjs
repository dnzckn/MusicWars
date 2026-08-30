/**
 * How far does a run actually get, and what does that do to the `/3` vs `/5`
 * archetype tier?
 *
 * "Runs end around wave 8" is cited twice in `waves.ts` and once in
 * `enemies.ts`, and it propagated into `tools/session.mjs` — a file that never
 * mentions `waves.ts` — as a tempo ramp that saturated at wave 18 and pinned
 * for the whole second half of a real run. One stale horizon assumption, three
 * files, and the third did not cite its source. That is why this re-derives it
 * once rather than patching each consumer as it surfaces.
 *
 * THE HONEST DIFFICULTY, STATED UP FRONT: the headless bot does not die. Zero
 * deaths in sixteen runs of twenty minutes, because score extends outrun the
 * lives it loses. So "where does a run end" has no answer from this bot at full
 * competence — the horizon is set by the cap, and a cap is not a measurement.
 *
 * So the run length is measured as a CURVE against a competence axis rather
 * than as a point. The knob is the bot's re-planning interval: the arena driver
 * re-plans every 2 simulation steps (60Hz against a 120Hz sim) and everything
 * below that is a player reacting later to the same information. It is a proxy
 * for skill and not a model of a person — a slow bot is not a bad player, it is
 * a bot with lag — so read the SHAPE of the curve and the bracket it gives,
 * never a single row as "where runs end".
 *
 * The second half needs no bot at all. Which archetypes a run has met by wave W
 * is a pure function of `planWave`, so the `/3` vs `/5` question is enumerated
 * exactly rather than sampled — and the counterfactual divisor is validated
 * against the real `planWave` before any of its numbers are printed.
 *
 *   node --experimental-transform-types tools/deadhunt-horizon.mjs [runs]
 */

import { readFileSync } from 'node:fs';
import './lib/tsnode.mjs';

const RUNS = Number(process.argv[2] ?? 5);
const MAX_MINUTES = Number(process.argv[3] ?? 20);
/** Optional substring filter on the competence ladder, for long floor-only runs. */
const ONLY = process.argv[4] ?? '';
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const { planWave, BOSS_EVERY } = await import('../src/game/waves.ts');
const { Rng } = await import('../src/core/rng.ts');

const f = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : String(x));

/* ------------------------------------------------------------------------ *
 * PART 1 — the tier counterfactual, enumerated and then validated
 *
 * `POOLS` is module-private in `waves.ts`, so it is read out of the source
 * rather than duplicated here: a second copy of a table is the thing this
 * directory keeps getting caught by. Comments are stripped first — a tool of
 * mine already once read its own annotation as evidence.
 * ------------------------------------------------------------------------ */

function poolsFromSource() {
  const src = readFileSync(new URL('../src/game/waves.ts', import.meta.url), 'utf8');
  const at = src.indexOf('const POOLS');
  if (at < 0) throw new Error('could not find POOLS in waves.ts');
  const open = src.indexOf('{', at);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      i++;
      break;
    }
  }
  const body = src
    .slice(open, i)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${body});`)();
}

const POOLS = poolsFromSource();

/**
 * `planWave`'s archetype sequence, with the tier divisor as a parameter.
 *
 * A faithful replication and not an approximation: the rng draws have to happen
 * in the same order and the same number of times, because `subdrop` takes no
 * `rng.int` for its count while every other archetype does — so a wrong branch
 * desynchronises every later draw in the wave. `validate()` below is what makes
 * this trustworthy; nothing derived from it is printed if that fails.
 */
function archetypesOfWave(index, divisor) {
  const rng = new Rng(0x5eed ^ (index * 0x9e3779b9));
  const raw = Math.pow(index / 13, 1.25);
  const difficulty = Math.min(1, raw);
  const escalation = Math.max(0, raw - 1);
  const isBoss = index > 0 && index % BOSS_EVERY === BOSS_EVERY - 1;
  if (isBoss) return ['stutter', 'pluck', 'conductor'];

  const tier = Math.min(3, Math.floor(index / divisor));
  const pool = POOLS[tier];
  const groups = 2 + Math.floor(index / 2.0) + Math.floor(escalation * 1.5);
  const out = [];
  for (let g = 0; g < groups; g++) {
    const archetype = rng.pick(pool);
    out.push(archetype);
    if (archetype === 'stutter') rng.int(0, 3);
    else if (archetype === 'subdrop') {
      /* no draw: its count is the literal 1 */
    } else if (archetype === 'arpeggiator') rng.int(0, 2);
    else if (archetype === 'rush') rng.int(0, 3);
    else if (archetype === 'echo') rng.int(0, 2);
    else rng.int(0, 3);
    rng.pick(['line', 'arc', 'columns', 'sides', 'centre', 'rhythm', 'rhythm']);
    rng.int(0, 4);
    if (!(escalation > 0.4)) rng.bool(0.45);
  }
  return out;
}

/** The replication must reproduce the real `planWave` exactly at divisor 3. */
function validate() {
  for (let i = 0; i < 60; i++) {
    const real = planWave(i);
    const mine = archetypesOfWave(i, 3);
    if (real.isBoss) continue;
    const realList = real.entries.map((e) => e.archetype);
    if (realList.length !== mine.length || realList.some((a, k) => a !== mine[k])) {
      return { ok: false, at: i, real: realList, mine };
    }
  }
  return { ok: true };
}

/** Distinct archetypes met by the end of wave `W`, under a tier divisor. */
function coverage(W, divisor) {
  const seen = new Set();
  for (let i = 0; i <= W; i++) for (const a of archetypesOfWave(i, divisor)) seen.add(a);
  seen.delete('conductor');
  return seen;
}

/* ------------------------------------------------------------------------ *
 * PART 2 — run length against a competence axis
 * ------------------------------------------------------------------------ */

function drive(w, inp) {
  inp.choice = w.choosing ? 0 : -1;
  const px = w.player.x;
  const py = w.player.y;
  let rx = 0;
  let ry = 0;
  let danger = 0;
  let closest = 1e9;
  // Bodies, not bullets — enemies damage by contact now and there is no enemy
  // bullet pool. Kept written out rather than imported, exactly as the eight
  // copies of the old bullet policy were; `tools/lib/bot-brain.mjs` carries the
  // full reasoning and is the version to keep this in step with.
  for (const e of w.enemies) {
    const dx = px - e.x;
    const dy = py - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 240 * 240) continue;
    const d = Math.sqrt(d2) || 1;
    const edge = Math.max(1, d - e.radius * 0.62);
    closest = Math.min(closest, edge);
    const closing = (-dx * (e.x - e.prevX) - dy * (e.y - e.prevY)) / d;
    const weight =
      (1 - Math.min(1, edge / 240)) ** 2 * (1 + Math.max(0, closing) / 2.5) * (e.lungeTime > 0 ? 2.4 : 1);
    rx += (dx / d) * weight;
    ry += (dy / d) * weight;
    if (edge < 110) danger += weight;
  }
  let ax = 0;
  let ay = 0;
  for (const n of [...w.notes, ...w.drops]) {
    const dx = n.x - px;
    const dy = n.y - py;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 300) continue;
    const pull = (n.kind ? 1.6 : 0.5) * (1 - d / 300);
    ax += (dx / d) * pull;
    ay += (dy / d) * pull;
  }
  const calm = Math.max(0, 1 - danger);
  let mx = rx * 2.2 + ax * calm;
  let my = ry * 2.2 + ay * calm;
  const enc = w.encircled;
  if (enc > 0.35) {
    mx += Math.cos(w.wayOut) * enc * 1.8;
    my += Math.sin(w.wayOut) * enc * 1.8;
  }
  // Wall repulsion, scaled to the field, not a fixed 110px: on a bigger arena
  // a 110px margin goes inert and every number here re-baselines against a
  // player that quietly changed. See tools/lib/bot-brain.mjs for the full
  // reasoning. Math.min(900, 1120) * (110/900) is exactly 110, so this is a
  // no-op at today's field size.
  /*
   * TWO WALLS AND A WINDOW. `w.height` is `Infinity` — the arena is bounded
   * across the track and unbounded along it — so the two y terms this
   * replaces were `py < 366`, which is true for every step after the first
   * second of a run: the bot would have held the brake for the whole run. The
   * travel axis is bounded by the TRACK WINDOW instead, read off `World` so
   * this file does not hold its own copy of it. See tools/lib/bot-brain.mjs.
   */
  const wall = w.width * (110 / 900);
  if (px < wall) mx += 1;
  if (px > w.width - wall) mx -= 1;
  const room = (w.trackBack - w.trackFront) * 0.22;
  if (py < w.trackFront + room) my += 1;
  if (py > w.trackBack - room) my -= 1;
  const len = Math.hypot(mx, my);
  inp.x = len > 0.05 ? mx / len : 0;
  inp.y = len > 0.05 ? my / len : 0;
  inp.focus = closest < 70;
  inp.bomb = danger > 3.2 && w.player.bombs > 0;
  inp.well = danger > 2.2 && w.player.wells > 0;
}

/*
 * Two policies below the reaction axis, because the reaction axis bottomed out
 * without producing a single death.
 *
 * `drunk` keeps moving but stops responding to anything — a direction re-rolled
 * twice a second, no bombs, no wells. `parked` does not move at all. They are
 * not models of bad players; they are the FLOOR, and their only job is to say
 * whether this game can kill a ship that is not being flown. If it cannot, then
 * "where does a run end" has no answer in the simulation and the horizon is set
 * by how long someone chooses to keep playing.
 */
function drunkDrive(w, inp, t) {
  const a = Math.floor(t * 2);
  const rng = Math.sin(a * 12.9898) * 43758.5453;
  const ang = (rng - Math.floor(rng)) * Math.PI * 2;
  inp.x = Math.cos(ang);
  inp.y = Math.sin(ang);
  inp.focus = false;
  inp.bomb = false;
  inp.well = false;
  inp.choice = w.choosing ? 0 : -1;
}

function parkedDrive(w, inp) {
  inp.x = 0;
  inp.y = 0;
  inp.focus = false;
  inp.bomb = false;
  inp.well = false;
  inp.choice = w.choosing ? 0 : -1;
}

function runOnce(seed, replanEvery, mode = 'react') {
  const w = new World(seed);
  /*
   * Hits, lives lost and extends are counted because "a parked ship survives
   * twenty minutes" is the kind of result that is far more often a broken
   * harness than a real finding. If the ship is never hit, this probe is not
   * measuring survival; if it is hit constantly and lives anyway, the mechanism
   * is what the report has to name.
   */
  let hits = 0;
  let extends_ = 0;
  let livesLost = 0;
  let prevLives = 3;
  /*
   * `player:bomb` is emitted by the manual detonation AND by `autoBombRescue`.
   * The floor policies never press the bomb key, so for `parked` and `drunk`
   * every one of these is a rescue — which is how the mechanism behind an
   * unkillable idle ship gets named rather than guessed at.
   */
  let bombs = 0;
  w.bus.on('player:bomb', () => bombs++);
  w.bus.on('player:hit', () => hits++);
  w.bus.on('player:extend', () => extends_++);
  w.start();
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };
  const steps = Math.round((MAX_MINUTES * 60) / DT);
  let i = 0;
  for (; i < steps; i++) {
    if (mode === 'parked') parkedDrive(w, inp);
    else if (mode === 'drunk') drunkDrive(w, inp, i * DT);
    else if (i % replanEvery === 0) drive(w, inp);
    w.update(DT, inp);
    w.shocks.length = 0;
    if (w.player.lives < prevLives) livesLost += prevLives - w.player.lives;
    prevLives = w.player.lives;
    if (w.isOver) break;
  }
  return {
    wave: w.waveIndex + 1,
    elapsed: i * DT,
    died: w.isOver,
    hits,
    livesLost,
    extends: extends_,
    bombs,
    bombsHeld: w.player.bombs,
    livesLeft: w.player.lives,
  };
}

/* ------------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------------ */

console.log(`\nDEADHUNT/HORIZON — re-deriving "runs end around wave 8"\n`);

const v = validate();
console.log('VALIDATION — the tier replication against the real planWave, waves 0-59');
if (!v.ok) {
  console.log(`  MISMATCH at wave ${v.at}: real [${v.real}] vs replicated [${v.mine}]`);
  console.log('  The /5 counterfactual is NOT trustworthy and is not printed.');
} else {
  console.log('  ok — identical archetype sequences at divisor 3, so the /5 column is sound');
}

console.log('\nRUN LENGTH vs COMPETENCE (bot re-plans every N sim steps; 2 is the arena driver)');
console.log('  A slow bot is a bot with lag, not a bad player. Read the bracket, not a row.');
const ladder = [
  ['arena driver, 60 Hz', 2, 'react'],
  ['reacting at 15 Hz', 8, 'react'],
  ['reacting at 6 Hz', 20, 'react'],
  ['reacting at 1.5 Hz', 80, 'react'],
  ['reacting at 0.8 Hz', 160, 'react'],
  ['drunk: moving, not looking', 2, 'drunk'],
  ['parked: not moving at all', 2, 'parked'],
];
for (const [label, every, mode] of ladder) {
  if (ONLY && !label.includes(ONLY)) continue;
  const rows = [];
  for (let r = 0; r < RUNS; r++) rows.push(runOnce(0x51ed + r * 7919, every, mode));
  const died = rows.filter((x) => x.died);
  const mean = (g) => rows.reduce((a, x) => a + g(x), 0) / rows.length;
  console.log(
    `  ${label.padEnd(28)} died ${died.length}/${rows.length}   ` +
      `wave ${String(f(mean((x) => x.wave))).padStart(5)}   ` +
      `${String(f(mean((x) => x.elapsed))).padStart(7)}s` +
      (died.length ? `   (those that died: wave ${f(died.reduce((a, x) => a + x.wave, 0) / died.length)} at ${f(died.reduce((a, x) => a + x.elapsed, 0) / died.length)}s)` : '   NO DEATHS — capped'),
  );
  console.log(
    `  ${''.padEnd(28)} hits ${String(f(mean((x) => x.hits))).padStart(6)}   ` +
      `lives lost ${String(f(mean((x) => x.livesLost))).padStart(5)}   ` +
      `extends ${String(f(mean((x) => x.extends))).padStart(5)}   ` +
      `lives left ${f(mean((x) => x.livesLeft))}   ` +
      `bombs spent ${String(f(mean((x) => x.bombs))).padStart(5)} (held ${f(mean((x) => x.bombsHeld))})`,
  );
}

if (v.ok) {
  console.log('\nARCHETYPE COVERAGE by terminal wave (exact; 7 non-boss archetypes exist)');
  console.log('  wave      /3 (as written)      /5 (the rejected option)');
  for (const W of [4, 6, 8, 10, 12, 16, 20, 26, 34, 40]) {
    const a = coverage(W, 3);
    const b = coverage(W, 5);
    console.log(
      `  ${String(W).padStart(4)}      ${String(a.size).padStart(2)}/7  ${[...a].sort().join(',').padEnd(46)} ${String(b.size).padStart(2)}/7  ${[...b].sort().join(',')}`,
    );
  }

  console.log('\n  first wave at which each divisor has shown all 7:');
  for (const d of [3, 5]) {
    let at = -1;
    for (let W = 0; W < 80; W++) {
      if (coverage(W, d).size >= 7) {
        at = W;
        break;
      }
    }
    console.log(`    /${d}  wave ${at}`);
  }
}
console.log('');
