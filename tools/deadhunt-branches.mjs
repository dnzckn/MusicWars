/**
 * Branches in `src/game` that a run can never take.
 *
 * The companion to `tools/deadhunt-ranges.mjs`. That one asks whether a
 * THRESHOLD is inside its signal's range; this one asks whether a BRANCH is
 * ever taken, which is the same question for the cases where the condition is
 * not a comparison against a tuned number — an early return, a state flag set
 * before the guard that reads it, a ternary whose arms are the same.
 *
 * Everything here is instrumented by wrapping the world's own methods rather
 * than by re-deriving the condition outside it. A re-derived condition is a
 * second copy of the logic and this directory has been burned by exactly that:
 * `tools/README.md` records a check that passed for nineteen iterations while
 * matching a banner by regex against a list it maintained itself. Wrapping the
 * real method cannot drift from the real method.
 *
 *   node --experimental-transform-types tools/deadhunt-branches.mjs [minutes] [runs]
 */

import { readFileSync } from 'node:fs';
import './lib/tsnode.mjs';

const MINUTES = Number(process.argv[2] ?? 6);
const RUNS = Number(process.argv[3] ?? 4);
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const { Player, INVULN_ON_HIT } = await import('../src/game/player.ts');
const W = await import('../src/game/weapons.ts');

const tally = new Map();
const extremes = new Map();
const bump = (k, n = 1) => tally.set(k, (tally.get(k) ?? 0) + n);

/* ------------------------------------------------------------------------ *
 * The bot, copied from tools/arena.mjs for the reason that file gives.
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
  const wall = Math.min(w.width, w.height) * (110 / 900);
  if (px < wall) mx += 1;
  if (px > w.width - wall) mx -= 1;
  if (py < wall) my += 1;
  if (py > w.height - wall) my -= 1;
  const len = Math.hypot(mx, my);
  inp.x = len > 0.05 ? mx / len : 0;
  inp.y = len > 0.05 ? my / len : 0;
  inp.focus = closest < 70;
  inp.bomb = danger > 3.2 && w.player.bombs > 0;
  inp.well = danger > 2.2 && w.player.wells > 0;
}

/* ------------------------------------------------------------------------ *
 * Instrumentation
 * ------------------------------------------------------------------------ */

/**
 * `introduce` marks the archetype seen BEFORE the banner guard, so a suppressed
 * introduction is a permanently suppressed one. Wrapping it records both halves
 * of that: how many archetypes were introduced at all, and how many of those
 * actually reached `announce`.
 */
function instrument(w) {
  const introduce = w.introduce.bind(w);
  w.introduce = (archetype) => {
    const first = !w.introduced.has(archetype);
    const ageBefore = w.bannerAge;
    const kindBefore = w.bannerKind;
    const textBefore = w.banner;
    introduce(archetype);
    if (!first) return;
    bump('introduce: called for a new archetype');
    const announced = w.bannerKind === 'archetype' && w.banner !== textBefore;
    if (announced) bump('introduce: banner ACTUALLY SHOWN');
    else bump(`introduce: SUPPRESSED (bannerAge ${ageBefore.toFixed(2)} < 2.2, over a '${kindBefore}')`);
  };

  const finishWave = w.finishWave.bind(w);
  w.finishWave = () => {
    /*
     * Read the grade's inputs before the method clears them — and read the
     * quantity the grade ACTUALLY uses.
     *
     * This originally reported `wavePeakCombo >= 8`, which was the condition at
     * the time. The grade now tests the chain built during the wave,
     * `wavePeakCombo - waveComboBase`, because the raw peak carries over from
     * the previous wave and was satisfied before the wave began. An instrument
     * left pointing at the old field would have kept reporting the input that
     * made `clean` unreachable, on a build where it is reachable — a harness
     * measuring a quantity the code stopped consulting.
     */
    const chain = w.wavePeakCombo - w.waveComboBase;
    bump(`grade inputs: damage=${w.waveDamage === 0 ? '0' : '>0'} waveChain=${chain >= 8 ? '>=8' : '<8'}`);
    extremes.set('lowest waveChain at a wave clear', Math.min(extremes.get('lowest waveChain at a wave clear') ?? Infinity, chain));
    extremes.set('highest waveChain at a wave clear', Math.max(extremes.get('highest waveChain at a wave clear') ?? -Infinity, chain));
    finishWave();
  };

  const autoBombRescue = w.autoBombRescue.bind(w);
  w.autoBombRescue = () => {
    // `takeHit` has already set invuln to INVULN_ON_HIT on the path that leads
    // here, so the `Math.max(invuln, 2.2)` inside is only live if this is ever
    // below 2.2.
    bump(`autoBombRescue: invuln on entry ${w.player.invuln.toFixed(2)} (raises past 2.2? ${w.player.invuln < 2.2 ? 'YES' : 'no'})`);
    autoBombRescue();
  };

  const collideEnemies = w.collideEnemies.bind(w);
  w.collideEnemies = () => {
    // Would any enemy skipped by `e.y < -10` have been a contact hit?
    if (!w.player.dead && w.player.invuln <= 0) {
      for (const e of w.enemies) {
        if (e.y >= -10) continue;
        const r = e.radius * 0.62 + 3.5;
        const dx = w.player.x - e.x;
        const dy = w.player.y - e.y;
        if (dx * dx + dy * dy <= r * r) bump('collideEnemies: e.y < -10 SKIPPED A REAL CONTACT');
      }
    }
    collideEnemies();
  };

  /*
   * `MAX_MULTIPLIER` is applied at the shard-pickup site and not at the kill
   * site, so the combo is tracked here per run rather than trusted. A cap that
   * one of its two increment paths does not consult is not a cap.
   */
  const seenMax = () => extremes.set('combo peak', Math.max(extremes.get('combo peak') ?? 0, w.combo));
  w.bus.on('enemy:death', seenMax);

  w.bus.on('wave:clear', (e) => {
    bump(`wave:clear grade=${e.grade}`);
    // The grade's own inputs, so the unreachable tier can be quantified rather
    // than merely observed absent.
    extremes.set(
      'lowest peakCombo at a wave clear',
      Math.min(extremes.get('lowest peakCombo at a wave clear') ?? Infinity, e.peakMultiplier - 1),
    );
  });
  w.bus.on('powerup:expire', (e) => bump(`powerup:expire ${e.kind}`));
  w.bus.on('level:choice', (e) => bump(e.grace ? `level:choice grace=${e.grace}` : 'level:choice ability'));
  w.bus.on('boss:phase', (e) => bump(`boss:phase ${e.phase}`));
  w.bus.on('player:extend', () => bump('player:extend'));
}

function runOnce(seed, minutes, immortal, startWave = 0) {
  const w = new World(seed);
  w.start();
  if (startWave) w.jumpToWave(startWave);
  instrument(w);
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };
  const steps = Math.round((minutes * 60) / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    w.update(DT, inp);
    w.shocks.length = 0; // the renderer's job; see deadhunt-ranges.mjs
    if (immortal) {
      w.player.lives = Math.max(3, w.player.lives);
      w.player.dead = false;
    }
    if (w.isOver && !immortal) break;
  }
  return w;
}

/* ------------------------------------------------------------------------ *
 * Static: two pure functions enumerated rather than sampled
 * ------------------------------------------------------------------------ */

console.log(`\nDEADHUNT/BRANCHES — ${RUNS} runs of ${MINUTES} min\n`);

console.log('STATIC — movementFor(index) over the first sixty waves');
{
  const w = new World(1);
  const seen = new Map();
  const at = [];
  for (let i = 0; i < 60; i++) {
    const m = w.movementFor(i);
    if (m) {
      seen.set(m, (seen.get(m) ?? 0) + 1);
      if (at.length < 12) at.push(`${i}:${m}`);
    }
    // A boss wave never reads the movement, so a collision would delete one.
    const isBoss = i > 0 && i % 4 === 3;
    if (m && isBoss) console.log(`  COLLISION: index ${i} is both a boss and '${m}'`);
  }
  console.log(`  first twelve: ${at.join('  ')}`);
  console.log(`  counts over 60 waves: ${[...seen].map(([k, n]) => `${k}=${n}`).join(', ')}`);
  const missing = ['elite', 'hush', 'flank'].filter((k) => !seen.has(k));
  console.log(`  ${missing.length ? `NEVER SCHEDULED: ${missing.join(', ')}` : 'all three are scheduled'}`);
}

console.log('\nSTATIC — WavePlan.lengthBeats, and who reads it');
{
  const { planWave } = await import('../src/game/waves.ts');
  const src = ['world.ts', 'waves.ts', 'enemies.ts', 'emitters.ts']
    .map((n) => readFileSync(new URL(`../src/game/${n}`, import.meta.url), 'utf8'))
    .join('\n');
  const reads = (src.match(/lengthBeats/g) ?? []).length;
  console.log(`  wave 0 lengthBeats=${planWave(0).lengthBeats}, wave 8=${planWave(8).lengthBeats}, boss=${planWave(3).lengthBeats}`);
  console.log(`  mentions of 'lengthBeats' in src/game: ${reads} (declaration, doc comment and two writes)`);
  console.log(`  the wave ends on '`+`entryCursor exhausted AND enemies.length === 0' — no timeout reads this field`);
}

console.log('\nSTATIC — Player.takeHit → autoBombRescue, the invulnerability it can add');
{
  const p = new Player();
  p.reset(0, 0);
  p.lives = 1;
  p.hp = 1;
  p.bombs = 1;
  const landed = p.takeHit();
  console.log(`  takeHit() on the last life with a bomb: landed=${landed} autoBombed=${p.lastHitAutoBombed} invuln=${p.invuln}`);
  console.log(`  INVULN_ON_HIT=${INVULN_ON_HIT}; autoBombRescue does Math.max(invuln, 2.2) → ${2.2 > p.invuln ? 'raises it' : 'NO-OP, the 2.2 can never bind'}`);
}

/* ------------------------------------------------------------------------ *
 * Dynamic
 * ------------------------------------------------------------------------ */

for (let r = 0; r < RUNS; r++) runOnce(0x51ed + r * 7919, MINUTES, false);
for (let r = 0; r < RUNS; r++) runOnce(0xbeef + r * 7919, MINUTES, true);
for (const wave of [8, 12, 16, 24, 25, 36]) runOnce(0xd00d + wave, 3, true, wave);

console.log('\nDYNAMIC — every instrumented branch, with its count');
for (const k of [...tally.keys()].sort()) {
  console.log(`  ${String(tally.get(k)).padStart(7)}  ${k}`);
}
console.log('\nDYNAMIC — extremes that decide whether a tier is reachable');
for (const [k, v] of [...extremes].sort()) console.log(`  ${String(v).padStart(7)}  ${k}`);
console.log(`  ${String(60).padStart(7)}  MAX_MULTIPLIER, the cap in world.ts`);
console.log('');
