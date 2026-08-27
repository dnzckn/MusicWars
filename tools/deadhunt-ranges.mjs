/**
 * Which tuned numbers in `src/game` and `src/core` can never reach the
 * thresholds written against them.
 *
 * `tools/deadconditions.mjs` asks this question of the SNAPSHOT, in a browser,
 * and answers it for the music. This asks it of the simulation itself, in Node,
 * and answers it for the game: it prints the measured range of every number a
 * `>` or `<` in the game layer is compared against, next to the constant it is
 * compared against, so a threshold outside its own signal's range is visible as
 * a row rather than as a hunch.
 *
 * Three shapes were found in `src/audio/` this week and they are the shapes
 * being hunted here:
 *
 *   1. a threshold outside the achievable range (a lane whose `full` point sat
 *      above its signal's measured peak),
 *   2. a guard equal to its own timeout, so the guarded arm is dead for ANY
 *      value of the constant,
 *   3. an override computed elsewhere that shadows the configured value.
 *
 * TWO HALVES, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 * STATIC is exhaustive and exact. Everything folded out of `weapons.ts` — the
 * rig modifiers and the instrument stat blocks — is a pure function of a
 * loadout, and a loadout is at most six rig items out of twelve at levels 1-5.
 * Each `Modifiers` field is touched by at most two rig items, so the extremes
 * can be enumerated rather than sampled, and a bound printed here is a bound,
 * not the best a bot happened to roll.
 *
 * DYNAMIC is a real run. Anything that depends on where things are — the
 * threat signal, the population floor, the drop economy, wave pacing — cannot
 * be derived from the tables and has to be played. The bot is the same policy
 * `tools/arena.mjs` drives, copied for the same reason that file gives.
 *
 * A HARNESS THAT MEASURES NOTHING PASSES EVERYTHING. Every dynamic row carries
 * its own sample count, and rows whose sample count is zero are printed as
 * NEVER SAMPLED rather than silently folded into a green summary — an empty
 * accumulator reporting `min 0 max 0` is the failure mode that makes a tool
 * like this worse than no tool at all.
 *
 *   node --experimental-transform-types tools/deadhunt-ranges.mjs [minutes] [runs]
 */

import { readFileSync } from 'node:fs';
import './lib/tsnode.mjs';

const MINUTES = Number(process.argv[2] ?? 8);
const RUNS = Number(process.argv[3] ?? 3);
const DT = 1 / 120;

/*
 * The renderer drains three of the world's arrays every frame and there is no
 * renderer here.
 *
 * The first version of this tool reported `shocks.length >= 64` true for 72% of
 * a run and it was measuring itself: `World.shock` is bounded at 64 and
 * `world.shocks` is emptied by `src/render` on each draw, so a headless run
 * fills it in the first few seconds and then reports a permanently saturated
 * cap that no real session ever sees. Draining them here is what makes every
 * row below a statement about the game rather than about the absence of a
 * screen.
 */
function drainRenderQueues(w) {
  w.shocks.length = 0;
}

const { World } = await import('../src/game/world.ts');
const W = await import('../src/game/weapons.ts');
const P = await import('../src/game/progression.ts');
const E = await import('../src/game/enemies.ts');
const V = await import('../src/game/waves.ts');
const PU = await import('../src/game/powerups.ts');

const f = (x, n = 3) => (Number.isFinite(x) ? Number(x.toFixed(n)) : String(x));

/* ------------------------------------------------------------------------ *
 * A range accumulator that refuses to lie about an empty sample.
 * ------------------------------------------------------------------------ */

class Range {
  constructor(label) {
    this.label = label;
    this.n = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.sum = 0;
    this.vals = [];
  }
  add(v) {
    if (!Number.isFinite(v)) return;
    this.n++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
    // Reservoir-free: the sample counts here are in the tens of thousands and
    // the p-values only need to be indicative, so keep every tenth.
    if (this.n % 10 === 0) this.vals.push(v);
  }
  q(p) {
    if (!this.vals.length) return NaN;
    const a = this.vals.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(p * a.length))];
  }
  row() {
    if (this.n === 0) return `${this.label.padEnd(34)} NEVER SAMPLED`;
    return (
      `${this.label.padEnd(34)} n=${String(this.n).padStart(7)}  ` +
      `min ${String(f(this.min)).padStart(9)}  p50 ${String(f(this.q(0.5))).padStart(9)}  ` +
      `max ${String(f(this.max)).padStart(9)}  mean ${String(f(this.sum / this.n)).padStart(9)}`
    );
  }
}

class Counter {
  constructor(label) {
    this.label = label;
    this.t = 0;
    this.n = 0;
  }
  add(b) {
    this.n++;
    if (b) this.t++;
  }
  row() {
    if (this.n === 0) return `${this.label.padEnd(46)} NEVER EVALUATED`;
    const pct = (this.t / this.n) * 100;
    const tag = this.t === 0 ? '   <<< NEVER TRUE' : this.t === this.n ? '   <<< ALWAYS TRUE' : '';
    return `${this.label.padEnd(46)} ${String(this.t).padStart(8)}/${String(this.n).padStart(8)}  ${pct.toFixed(2)}%${tag}`;
  }
}

/* ------------------------------------------------------------------------ *
 * STATIC 1 — every value each `Modifiers` field can take
 *
 * Exhaustive rather than sampled. A field is touched by at most two rig items,
 * so the achievable set is the fold over every subset of the touching items at
 * every level, bounded by the six-slot cap (which never binds at two items).
 * ------------------------------------------------------------------------ */

function modsFieldExtremes() {
  const keys = Object.keys(W.noModifiers());
  const out = {};
  for (const key of keys) {
    const touching = W.RIG.filter((d) => d.levels.some((l) => key in l));
    // Cartesian product of {absent, L1..L5} over the touching items. At most
    // two items touch any field today, so this is at most 36 combinations.
    const combos = [[]];
    for (const def of touching) {
      const next = [];
      for (const c of combos) {
        next.push(c);
        for (let lv = 1; lv <= def.levels.length; lv++) next.push([...c, [def.id, lv]]);
      }
      combos.length = 0;
      combos.push(...next);
    }
    let min = Infinity;
    let max = -Infinity;
    const seen = new Set();
    for (const c of combos) {
      // Rig capacity is fixed at RIG_SLOTS now; SLOTS_CAP is gone.
      if (c.length > P.RIG_SLOTS) continue;
      const owned = Object.fromEntries(c);
      const v = W.rigModifiers(owned)[key];
      seen.add(Number(v.toFixed(6)));
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[key] = { min, max, touching: touching.map((d) => d.id), values: [...seen].sort((a, b) => a - b) };
  }
  return out;
}

/* ------------------------------------------------------------------------ *
 * STATIC 2 — every folded stat block any legal loadout can produce
 *
 * `instrumentStats(id, level)` for every instrument at every legal level,
 * crossed with the modifier extremes above. The cross is per-field because
 * `applyModifiers` touches each output field with exactly one modifier field,
 * so the extreme of the product is the product of the extremes.
 * ------------------------------------------------------------------------ */

function statExtremes(mx) {
  const rows = [];
  for (const def of W.INSTRUMENTS) {
    const maxLv = def.fused ? 1 : W.INSTRUMENT_MAX_LEVEL;
    for (let lv = 1; lv <= maxLv; lv++) {
      const base = W.instrumentStats(def.id, lv);
      // The two folds that actually bound the guards downstream.
      const fastest = W.applyModifiers(base, { ...W.noModifiers(), cooldown: mx.cooldown.min });
      const slowest = W.applyModifiers(base, { ...W.noModifiers(), cooldown: mx.cooldown.max });
      rows.push({ id: def.id, shape: def.shape, lv, base, fastest, slowest });
    }
  }
  return rows;
}

/* ------------------------------------------------------------------------ *
 * DYNAMIC — the arena bot, with the sampling done from outside the world
 *
 * A copy of `tools/arena.mjs`'s policy, for the reason that file states: the
 * browser driver is a string evaluated in a page and cannot be imported here.
 * ------------------------------------------------------------------------ */

function drive(w, inp) {
  inp.choice = w.choosing ? 0 : -1;
  const px = w.player.x;
  const py = w.player.y;
  let rx = 0;
  let ry = 0;
  let danger = 0;
  let closest = 1e9;
  const bl = w.enemyBullets;
  for (let i = 0; i < bl.count; i++) {
    const dx = px - bl.x[i];
    const dy = py - bl.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 > 190 * 190) continue;
    const d = Math.sqrt(d2) || 1;
    closest = Math.min(closest, d);
    const vx = Math.cos(bl.angle[i]) * bl.speed[i];
    const vy = Math.sin(bl.angle[i]) * bl.speed[i];
    const closing = (-dx * vx - dy * vy) / d;
    if (closing <= 0) continue;
    const weight = (1 - d / 190) ** 2 * (1 + closing / 300);
    rx += (dx / d) * weight;
    ry += (dy / d) * weight;
    if (d < 90) danger += weight;
  }
  for (const e of w.enemies) {
    const dx = px - e.x;
    const dy = py - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > e.radius + 70) continue;
    rx += (dx / d) * 1.5;
    ry += (dy / d) * 1.5;
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

const R = {};
const C = {};
const range = (k) => (R[k] ??= new Range(k));
const count = (k) => (C[k] ??= new Counter(k));

const powerupKindsSeen = new Set();
const fusionsSeen = [];
const abilityLevelsSeen = new Map();
const archetypesSeen = new Set();
const gradesSeen = new Map();
const movementsSeen = new Set();
const shotVoicesSeen = new Set();
const shotIdsSeen = new Set();

/**
 * `immortal` keeps a run going past the point the bot would die, because the
 * late game is where most of these thresholds live and a bot that dies at wave
 * 4 measures the opening only. It is a lie about survival and is used for
 * nothing else: every row that depends on the player taking damage is read off
 * the mortal runs.
 */
function runOnce(seed, minutes, immortal, opts = {}) {
  const w = new World(seed);
  /*
   * DOES A SHOT CARRY THE VOICE IT IS SUPPOSED TO?
   *
   * `src/core/events.ts` declares `player:shoot { id?, voice? }` with nine
   * lines explaining that the character FAMILY travels on the event because
   * `src/audio/` must not import `src/game/`, and `src/audio/sfx.ts` builds
   * `SHOT_FAMILIES` off it so every instrument sounds like itself without
   * anyone remembering to add a row. `fireInstruments` never set the field, so
   * that table was unreachable and the 19 of 27 instruments with no bespoke
   * `SHOT_VOICES` row all fired with PIZZICATO's pluck —
   * `docs/research-weapons.md` §0.2 measured 0 of 6,185 shots carrying one.
   *
   * NOTHING IN `tools/` COULD SEE THAT. `sfxcheck` calls `sfxShoot` directly
   * with hand-written arguments, so it tests the synth and not the wiring; the
   * probe that found it was written for the document and thrown away. This row
   * is here because a defect that survived because nobody could observe it is
   * the exact thing this file exists for, and because three new shapes were
   * added on top of it.
   */
  w.bus.on('player:shoot', (e) => {
    count('player:shoot carries a character family').add(!!e.voice);
    if (e.voice) shotVoicesSeen.add(e.voice);
    if (e.id) shotIdsSeen.add(e.id);
  });
  w.bus.on('enemy:spawn', (e) => archetypesSeen.add(e.archetype));
  w.bus.on('wave:clear', (e) => gradesSeen.set(e.grade, (gradesSeen.get(e.grade) ?? 0) + 1));
  w.bus.on('powerup:pickup', (e) => powerupKindsSeen.add(e.kind));
  w.bus.on('ability:evolve', (e) => fusionsSeen.push(e.to));
  w.bus.on('ability:union', (e) => fusionsSeen.push(e.to));
  w.start();
  if (opts.wave) w.jumpToWave(opts.wave);
  /*
   * `loadout: 'max'` writes the whole roster in at its ceiling.
   *
   * Not a claim about play — no run reaches this — but the only way to observe
   * the six firing routines and the per-shape floors under the stats they were
   * written against. A natural run holds two or three instruments at level 1-2,
   * so a floor like `Math.max(200, s.speed)` in `firePods` is never even
   * evaluated, and "never evaluated" is not evidence of anything.
   */
  if (opts.loadout === 'max') {
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    for (const def of W.INSTRUMENTS) {
      if (def.fused) continue;
      w.progression.instruments[def.id] = W.INSTRUMENT_MAX_LEVEL;
    }
    for (const def of W.RIG) w.progression.rig[def.id] = W.RIG_MAX_LEVEL;
  }
  if (opts.loadout === 'fused') {
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    for (const def of W.INSTRUMENTS) {
      if (!def.fused) continue;
      w.progression.instruments[def.id] = 1;
    }
    for (const def of W.RIG) w.progression.rig[def.id] = W.RIG_MAX_LEVEL;
  }
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };
  const steps = Math.round((minutes * 60) / DT);
  const tag = immortal ? 'imm' : 'mortal';

  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    if (opts.loadout) {
      // The world does not remove abilities, but a fusion would consume one, so
      // re-assert the forced loadout rather than assuming it survives.
      if (opts.loadout === 'max') {
        for (const def of W.INSTRUMENTS) {
          if (!def.fused) w.progression.instruments[def.id] = W.INSTRUMENT_MAX_LEVEL;
        }
      }
    }
    w.update(DT, inp);
    if (immortal) {
      w.player.lives = Math.max(3, w.player.lives);
      w.player.dead = false;
    }

    // ---- sampled every step: the cheap scalars the guards read -----------
    const m = w.mods;
    range('mods.pickupRadius').add(m.pickupRadius);
    range('mods.cooldown').add(m.cooldown);
    range('mods.enemyTime').add(m.enemyTime);
    range('mods.damage').add(m.damage);
    range('mods.area').add(m.area);
    range('mods.count').add(m.count);
    /*
     * `mods.homing` and `mods.pierce` USED TO BE SAMPLED HERE and the fields
     * are gone, not forgotten. Both were fed by exactly one passive and both
     * were re-pointed into `Rules`: LASER's overcharge sets
     * `InstrumentStats.pierce` on the activation it fires, and HOMING's steer
     * became `BulletFlag.Seeking` per bullet. The `homing` row is worth a
     * moment's regret — this tool reported `world: mods.homing > 0` at 14.98%
     * and was satisfied, while the VALUE of the field was never read at all, so
     * HOMING L1, L2 and L3 steered identically for the life of the table. A
     * field being READ is not a field being USED, and nothing here could see
     * the difference. `tools/rulefire.mjs` is the answer to that.
     */
    range('mods.maxHp').add(m.maxHp);
    range('mods.moveSpeed').add(m.moveSpeed);
    range('mods.xpGain').add(m.xpGain);
    range('mods.linger').add(m.linger);
    range('mods.speed').add(m.speed);

    count('updateNotes: pickupRadius > 1.6').add(m.pickupRadius > 1.6);
    count('updateDrops: pickupRadius > 1.6').add(m.pickupRadius > 1.6);
    count('rigModifiers: cooldown floor 0.18 bites').add(m.cooldown <= 0.18);
    count('rigModifiers: enemyTime floor 0.35 bites').add(m.enemyTime <= 0.35);
    /*
     * The rig's RULES, as CUMULATIVE counters — the same idiom as
     * `playerBullets.bounced` two rows down, and for the same reason: a
     * behaviour nothing can observe is a behaviour that can rot.
     *
     * These are read from an ordinary run rather than from a forced loadout, so
     * a `max` of 0 here means the run never held the passive and NOT that the
     * rule is broken. `tools/rulefire.mjs` is the check that forces each
     * passive and asserts the fire; this row is the ambient one, and its job is
     * to notice a rule quietly starved by a change made somewhere else.
     */
    for (const k of Object.keys(w.ruleFires)) range(`ruleFires.${k} (cumulative)`).add(w.ruleFires[k]);

    range(`threat.nearestThreat[${tag}]`).add(w.threatDistance);
    range(`threat.encircled[${tag}]`).add(w.encircled);
    count('snapshot.playerFiring (nearestThreat < 0.85)').add(w.threatDistance < 0.85);

    range('wave.difficulty').add(w.plan.difficulty);
    range('wave.escalation').add(w.plan.escalation);
    range('enemies.onField').add(w.enemies.length);
    range('enemyBullets.count').add(w.enemyBullets.count);
    range('notes.length').add(w.notes.length);
    range('wells.length').add(w.wells.length);
    range('effects.length').add(w.effects.length);
    range('novas.length').add(w.novas.length);
    /*
     * THE FOUR NEW SHAPES' LIVE-OBJECT BUDGETS, sampled from a real run.
     *
     * `docs/research-weapons.md` Part D states a worst case per shape and this
     * repo's rule is that a budget nothing measures is a budget nobody can be
     * wrong about — the same sentence that put `playerBullets.count` here for
     * `spray`. `shells` is `mortar`'s pending-detonation list and `summons` is
     * the live `spawn` population; `novas.length` above now also carries
     * `trail`'s drops and `mortar`'s telegraph and blast rings, and it is the
     * array that got its first cap in this change (`World.MAX_NOVAS`).
     */

    range('summons live (spawn)').add(w.summonsLive);
    count('novas.length >= MAX_NOVAS (cap hit)').add(w.novas.length >= World.MAX_NOVAS);

    count('summons >= MAX_SUMMONS (cap hit)').add(w.summonsLive >= World.MAX_SUMMONS);
    range('popups.length').add(w.popups.length);
    range('drops.length').add(w.drops.length);
    range('secsSinceDrop').add(w.secsSinceDrop);
    range('combo').add(w.combo);
    range('player.wells').add(w.player.wells);
    range('player.bombs').add(w.player.bombs);
    range('player.maxHp').add(w.player.maxHp);
    range('player.podCount').add(w.player.podCount);
    range('score').add(w.score);
    range('progression.level').add(w.progression.level);

    count('spawnShards: notes.length > 320 (cap hit)').add(w.notes.length > 320);
    count('pushWell: wells.length >= 8 (cap hit)').add(w.wells.length >= 8);
    count('onEnemyKilled: popups.length >= 14 (cap hit)').add(w.popups.length >= 14);
    count('shock: shocks.length >= 64 (cap hit)').add(w.shocks.length >= 64);
    count('enemyBullets pool saturated').add(w.enemyBullets.count >= w.enemyBullets.capacity);
    /*
     * `bounces` is implemented now, so it has to be observable. A stat with no
     * counter is how this one stayed dead through the whole life of the table:
     * `bounced` is monotonic, so a run that never reflects a bolt reports 0 and
     * the feature is falsifiable without a screen.
     */
    range('playerBullets.bounced (cumulative)').add(w.playerBullets.bounced);
    /*
     * The live player-bullet count, which had no row here at all.
     *
     * `spray` is the first shape whose design document states a projectile
     * BUDGET (90-107 from one instrument) and `MAX_PLAYER_BULLETS` moved
     * 400 -> 700 to hold it. A budget nothing measures is a budget nobody can
     * be wrong about, so the population and the drop counter both get printed:
     * `overflow` is monotonic and non-zero means the cap bit and shots were
     * silently thrown away, which is what `docs/MASTER_PLAN.md` G4 records
     * happening before anyone noticed.
     */
    range('playerBullets.count').add(w.playerBullets.count);
    range('playerBullets.overflow (cumulative)').add(w.playerBullets.overflow);
    count('playerBullets pool saturated').add(w.playerBullets.count >= w.playerBullets.capacity);
    count('secsSinceDrop >= 30 (pity timer armed)').add(w.secsSinceDrop >= 30);
    count('player.powerups.magnet held').add(!!w.player.powerups.magnet);
    count('player.powerups.overdrive held').add(!!w.player.powerups.overdrive);
    count('updateWave: enemies < targetOnScreen()').add(!w.plan.isBoss && w.enemies.length < w.targetOnScreen());

    for (const k of Object.keys(w.player.powerups)) powerupKindsSeen.add(k);

    // Instrument levels, so the offer bias thresholds can be read against them.
    for (const [id, lv] of Object.entries(w.progression.instruments)) {
      abilityLevelsSeen.set(id, Math.max(abilityLevelsSeen.get(id) ?? 0, lv));
    }
    for (const [id, lv] of Object.entries(w.progression.rig)) {
      abilityLevelsSeen.set(id, Math.max(abilityLevelsSeen.get(id) ?? 0, lv));
    }
    if (w.movement) movementsSeen.add(w.movement);

    // ---- sampled every 12 steps: the per-object loops --------------------
    if (i % 12 === 0) {
      for (const e of w.enemies) {
        range('enemy.maxHp').add(e.maxHp);
        range('enemy.toughness (maxHp/12)').add(Math.max(1, Math.round(e.maxHp / 12)));
        range('enemy.age').add(e.age);
        range('enemy.standoff').add(e.standoff);
        count('collideEnemies: e.y < -10 (skipped)').add(e.y < -10);
      }
      for (const { id, level } of Object.entries(w.progression.instruments).map(([id, level]) => ({ id, level }))) {
        const def = W.instrumentDef(id);
        if (!def) continue;
        const s = W.applyModifiers(W.instrumentStats(id, level), m);
        range('instrument.interval (folded)').add(s.interval);
        range('instrument.linger (folded)').add(s.linger);
        range('instrument.pierce (folded)').add(s.pierce);
        range('instrument.bounces (folded)').add(s.bounces);
        count('fireInstruments: interval floor 0.05 bites').add(s.interval < 0.05);
        count('fireField: s.linger <= 0 (early return)').add(def.shape === 'field' && s.linger <= 0);
        count('fireArc: s.arc <= 0 (fallback)').add(def.shape === 'arc' && s.arc <= 0);
        count('fireArc/Seek: s.range <= 0 (fallback ttl)').add(s.range <= 0);
        count('fireSeek: s.speed < 120 (floor bites)').add(def.shape === 'seek' && s.speed < 120);
        count('firePods: s.speed < 200 (floor bites)').add(def.shape === 'orbit' && s.speed < 200);
        count('fireBeam: s.range < 120 (floor bites)').add(def.shape === 'beam' && s.range < 120);
        count('fireAura: s.area < 40 (floor bites)').add(def.shape === 'aura' && s.area < 40);
        count('pushWell: s.area < 40 (floor bites)').add(def.shape === 'field' && s.area < 40);
        count('fireTrail: s.area < 20 (floor bites)').add(def.shape === 'trail' && s.area < 20);
        count('fireChain: s.area < 40 (floor bites)').add(def.shape === 'chain' && s.area < 40);
        count('fireMortar: s.linger < 0.15 (floor bites)').add(def.shape === 'mortar' && s.linger < 0.15);
        count('fireSpawn: s.speed < 120 (floor bites)').add(def.shape === 'spawn' && s.speed < 120);
      }
    }
    // Last, so the counters above see what one step actually produced.
    drainRenderQueues(w);
    if (w.isOver && !immortal) break;
  }
  return { wave: w.waveIndex + 1, level: w.progression.level, over: w.isOver, kills: w.totals.notes };
}

/* ------------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------------ */

console.log(`\nDEADHUNT — thresholds against measured ranges, ${RUNS} runs of ${MINUTES} min\n`);

const mx = modsFieldExtremes();
console.log('STATIC — every value a Modifiers field can take, over EVERY legal rig loadout');
for (const [k, v] of Object.entries(mx)) {
  const vals = v.values.length <= 12 ? `  {${v.values.join(', ')}}` : '';
  console.log(
    `  ${k.padEnd(14)} ${String(f(v.min)).padStart(7)} .. ${String(f(v.max)).padStart(7)}` +
      `   from [${v.touching.join(', ') || 'nothing'}]${vals}`,
  );
}

const stats = statExtremes(mx);
console.log('\nSTATIC — folded instrument stats, over every instrument x level x rig extreme');
{
  const pick = (sel, key) => {
    let lo = Infinity;
    let hi = -Infinity;
    let loAt = '';
    for (const r of stats) {
      const v = sel(r)[key];
      if (v < lo) {
        lo = v;
        loAt = `${r.id} L${r.lv}`;
      }
      if (v > hi) hi = v;
    }
    return { lo, hi, loAt };
  };
  const iv = pick((r) => r.fastest, 'interval');
  console.log(`  interval, max cooldown reduction   ${f(iv.lo, 4)} .. ${f(iv.hi, 3)}   (min at ${iv.loAt})`);
  console.log(`  world floors it at 0.05            ${iv.lo < 0.05 ? 'REACHABLE' : 'UNREACHABLE — floor is dead'}`);
  const bo = pick((r) => r.base, 'bounces');
  console.log(`  bounces                            ${f(bo.lo)} .. ${f(bo.hi)}`);
  const pi = pick((r) => r.base, 'pierce');
  console.log(`  pierce (before rig)                ${f(pi.lo)} .. ${f(pi.hi)}`);
}

/*
 * The per-shape floors in the six firing routines.
 *
 * `fireSeek` writes `Math.max(120, s.speed)`, `firePods` writes
 * `Math.max(200, s.speed)`, and so on. Each is only meaningful if some
 * instrument of that shape can actually sit under it, and only the instruments
 * of that shape can — an aura's `speed` is not what `fireSeek` floors. This
 * enumerates the shape's own instruments at every level under both cooldown
 * extremes, which is exhaustive for a pure table.
 */
console.log('\nSTATIC — the per-shape floors in world.ts, against the instruments of that shape');
{
  const floors = [
    ['fireSeek   Math.max(120, s.speed)', 'seek', 'speed', 120],
    ['fireSeek   s.range > 0 ? ... : 2', 'seek', 'range', 0.0001],
    ['fireArc    s.arc > 0 ? ... : 0.6/1.2', 'arc', 'arc', 0.0001],
    ['fireLance  Math.max(120, s.range)', 'lance', 'range', 120],
    ['fireLance  Math.max(0.2, s.interval)', 'lance', 'interval', 0.2],
    ['fireLance  Math.max(4, s.area)', 'lance', 'area', 4],
    ['firePods   Math.max(200, s.speed)', 'orbit', 'speed', 200],
    ['fireAura   Math.max(40, s.area)', 'aura', 'area', 40],
    ['fireField  s.linger <= 0 → return', 'field', 'linger', 0.0001],
    ['pushWell   Math.max(40, s.area)', 'field', 'area', 40],
    ['pushWell   Math.max(0.4, s.linger)', 'field', 'linger', 0.4],
  ];
  for (const [label, shape, key, floor] of floors) {
    const under = [];
    let lo = Infinity;
    for (const r of stats) {
      if (r.shape !== shape) continue;
      for (const s of [r.base, r.fastest, r.slowest]) {
        const v = s[key];
        if (v < lo) lo = v;
        if (v < floor) under.push(`${r.id} L${r.lv}=${f(v)}`);
      }
    }
    const uniq = [...new Set(under.map((u) => u.split(' L')[0]))];
    console.log(
      `  ${label.padEnd(38)} min over ${shape.padEnd(6)} = ${String(f(lo)).padStart(8)}   ` +
        (uniq.length ? `BITES for ${uniq.join(', ')}` : 'UNREACHABLE — floor is dead'),
    );
  }
}

/*
 * Which `InstrumentStats` fields any firing routine ever reads.
 *
 * A stat that no routine reads is the third shape of the defect: it reads as a
 * live dial on the offer card and in the table, and nothing in the simulation
 * can observe it. Grepped from the source rather than asserted, so this row
 * cannot go stale the way a hand-maintained list would.
 */
console.log('\nSTATIC — which InstrumentStats fields the simulation actually reads');
{
  const src = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
  const keys = Object.keys(W.instrumentStats('pizzicato', 1));
  for (const k of keys) {
    const hits = (src.match(new RegExp(`\\bs\\.${k}\\b`, 'g')) ?? []).length;
    const setBy = W.INSTRUMENTS.filter((d) => {
      const v = W.instrumentStats(d.id, d.fused ? 1 : W.INSTRUMENT_MAX_LEVEL)[k];
      const dflt = W.instrumentStats('__none__', 1)[k];
      return v !== dflt;
    }).map((d) => d.id);
    console.log(
      `  ${k.padEnd(9)} read in world.ts ${String(hits).padStart(3)}x   set away from default by ${setBy.length} instruments` +
        (hits === 0 ? `   <<< NEVER READ: ${setBy.join(', ')}` : ''),
    );
  }
}

/*
 * Which stats each of the six firing routines reads, against which stats the
 * instruments of that shape set.
 *
 * The table in `weapons.ts` is one stat block per instrument and the world
 * dispatches on `shape`, so a stat is only live for an instrument if the
 * routine THAT SHAPE dispatches to happens to read it. Nothing enforces that,
 * and a level step that moves a stat its own shape ignores is a card promising
 * a behaviour the simulation cannot produce — the offer screen's note is
 * written by hand and never checked against the routine.
 *
 * The routine bodies are sliced out of `world.ts` by brace matching rather than
 * listed here, so this cannot drift from the code the way a maintained list
 * would.
 */
console.log('\nSTATIC — per shape: stats the routine reads vs stats the instruments set');
{
  const src = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
  /*
   * Comments are stripped before matching, and skipping that step made this
   * tool report a false clean.
   *
   * The annotation added at `fireField` explaining that the routine ignores
   * `s.count` contains the literal text `s.count`, so the regex below matched
   * the documentation of the defect as evidence that the defect was fixed:
   * the dead-step count fell from 8 to 3 on a commit that changed no field
   * behaviour at all. A tool that reads its own writeup as proof is worse than
   * no tool, and this is the second time this file has been caught measuring
   * itself — see `drainRenderQueues`.
   */
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const bodyOf = (name) => {
    const at = src.indexOf(`private ${name}(`);
    if (at < 0) return '';
    let i = src.indexOf('{', at);
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return stripComments(src.slice(start, i));
    }
    return '';
  };
  /*
   * EVERY SHAPE IN `InstrumentShape` MUST HAVE A ROW HERE.
   *
   * This map is the one place in the audit that is hand-maintained, and the
   * loop below iterates IT rather than the shapes — so a shape added to
   * `weapons.ts` and forgotten here is not reported as broken, it is not
   * reported at all. That is the worst failure mode a tool like this has, and
   * `drainRenderQueues` and `stripComments` above are both records of this
   * file measuring itself. The assertion underneath catches it.
   */
  const ROUTINE = {
    seek: 'fireSeek',
    arc: 'fireArc',
    lance: 'fireLance',
    /*
     * `beam`, `cone`, `spray`, `trail`, `chain`, `mortar` and `spawn` LEFT the
     * table with the twenty-weapon roster. Two of them became PROPERTIES
     * (`Props.chain`, `Props.brood`) and five were geometry variants of a
     * survivor; `InstrumentShape` names each with which. They are not listed
     * here because the assertion below iterates this map and would report
     * every routine as bodyless, which is a true statement about a routine
     * that no longer exists and a distracting one.
     */
    orbit: 'firePods',
    aura: 'fireAura',
    strike: 'fireStrike',
    field: 'fireField',
    /*
     * The five shapes the second-axis pass added. Three of them deal no damage
     * and two of them make OTHER instruments fire, but every one still folds a
     * stat block, so every one can still promise a number nothing reads —
     * which is the only question this table asks.
     */
    rest: 'fireRest',
    drag: 'fireDrag',
    ghost: 'fireGhost',
    counterpoint: 'fireCounterpoint',
    unison: 'fireUnison',
    tacet: 'fireTacet',
  };
  {
    const shapes = [...new Set(W.INSTRUMENTS.map((d) => d.shape))].sort();
    const missing = shapes.filter((s) => !ROUTINE[s]);
    const bodyless = Object.entries(ROUTINE).filter(([, r]) => src.indexOf(`private ${r}(`) < 0);
    console.log(`  ${shapes.length} shapes in the table, ${Object.keys(ROUTINE).length} routines mapped here`);
    if (missing.length) console.log(`  <<< UNAUDITED SHAPES: ${missing.join(', ')} — add them to ROUTINE`);
    if (bodyless.length) console.log(`  <<< NO SUCH ROUTINE: ${bodyless.map(([s, r]) => `${s}->${r}`).join(', ')}`);
  }
  const keys = Object.keys(W.instrumentStats('pizzicato', 1));
  /*
   * `fireInstruments` is the dispatcher and reads two things itself: `interval`
   * for every shape, and — inside its `def.shape === 'orbit'` block — `count`
   * and `area`, which is where the pods get their number and their ring. Both
   * have to be credited or the table reports `interval` dead for all six
   * shapes, which was this tool's first answer and was wrong.
   */
  const dispatcherReads = { all: ['interval'], orbit: ['count', 'area'] };
  const ignoredByShape = {};
  for (const [shape, routine] of Object.entries(ROUTINE)) {
    // `field` hands its stats to `pushWell` and `throwWell`, so those count.
    const body = bodyOf(routine) + (shape === 'field' ? bodyOf('pushWell') + bodyOf('throwWell') : '');
    const read = keys.filter(
      (k) =>
        new RegExp(`\\bs(?:tats)?\\.${k}\\b|\\bheld\\.stats\\.${k}\\b`).test(body) ||
        dispatcherReads.all.includes(k) ||
        (shape === 'orbit' && dispatcherReads.orbit.includes(k)),
    );
    const ignored = keys.filter((k) => !read.includes(k));
    ignoredByShape[shape] = ignored;
    const defs = W.INSTRUMENTS.filter((d) => d.shape === shape);
    const promised = [];
    for (const d of defs) {
      const maxLv = d.fused ? 1 : W.INSTRUMENT_MAX_LEVEL;
      const lo = W.instrumentStats(d.id, 1);
      const hi = W.instrumentStats(d.id, maxLv);
      for (const k of ignored) {
        if (hi[k] !== lo[k]) promised.push(`${d.id}.${k} ${f(lo[k])}→${f(hi[k])} (the ladder moves it)`);
        else if (hi[k] !== W.instrumentStats('__none__', 1)[k]) promised.push(`${d.id}.${k}=${f(hi[k])} (set, static)`);
      }
    }
    console.log(`  ${shape.padEnd(6)} ${routine}`);
    console.log(`         reads   ${read.join(', ')}`);
    console.log(`         ignores ${ignored.join(', ')}`);
    for (const pr of promised) console.log(`         DEAD    ${pr}`);
  }

  /*
   * The number that matters to a player: how many of the seven-step ladders
   * buy nothing at all. A step is dead when EVERY field it touches is one its
   * own shape ignores — the card still names a behaviour, and the simulation
   * cannot produce one.
   */
  console.log('\n  level steps whose every field is ignored by their own shape:');
  let dead = 0;
  let total = 0;
  for (const d of W.INSTRUMENTS) {
    d.steps.forEach((st, i) => {
      total++;
      const touched = [...Object.keys(st.add ?? {}), ...Object.keys(st.mul ?? {})];
      if (!touched.length) return;
      if (!touched.every((k) => ignoredByShape[d.shape].includes(k))) return;
      dead++;
      console.log(`    ${d.id} L${i + 2} (${d.shape})  "${st.note}"  moves only [${touched.join(', ')}]`);
    });
  }
  console.log(`    ${dead} of ${total} level steps`);
}

console.log('\nSTATIC — armedChance() over the whole difficulty range');
{
  const at = (d) => E.armedChance(d);
  console.log(`  d=0 ${f(at(0))}   d=0.5 ${f(at(0.5))}   d=1 ${f(at(1))}   cap in source: 0.22`);
  console.log(`  the Math.min cap ${at(1) >= 0.22 ? 'is reached exactly at d=1 and never exceeded' : 'is never reached'}`);
}

console.log('\nSTATIC — spawnBearing(): the open arc left after the corridor exclusion');
{
  const TAU = Math.PI * 2;
  const GAP = 0.62;
  let worst = Infinity;
  let worstAt = '';
  for (const fm of ['line', 'arc', 'columns', 'sides', 'centre', 'rhythm']) {
    const half = GAP + V.formationWidth(fm) / 2;
    const open = TAU - half * 2;
    if (open < worst) {
      worst = open;
      worstAt = fm;
    }
    console.log(`  ${fm.padEnd(8)} half ${f(half)}  open ${f(open)}`);
  }
  console.log(`  narrowest open arc ${f(worst)} (${worstAt}); the fallback triggers at open <= 0.2 → ${worst <= 0.2 ? 'REACHABLE' : 'UNREACHABLE'}`);
}

console.log('\nSTATIC — planWave(): difficulty and escalation by wave index');
{
  const line = [];
  for (const i of [0, 1, 4, 8, 12, 13, 16, 20, 26, 32, 40]) {
    const p = V.planWave(i);
    line.push(`w${i}: d=${f(p.difficulty, 2)} e=${f(p.escalation, 2)} groups=${p.entries.length}`);
  }
  console.log('  ' + line.join('\n  '));
}

console.log('\nSTATIC — shardsForKill() tier thresholds against reachable toughness');
{
  for (const hp of [4, 12, 30, 60, 120, 240, 500, 1200]) {
    const s = P.shardsForKill(hp, false);
    console.log(`  maxHp ${String(hp).padStart(5)}  toughness ${String(Math.max(1, Math.round(hp / 12))).padStart(4)}  ${JSON.stringify(s)}  xp ${P.xpForKill(hp, false)}`);
  }
}

console.log('\nSTATIC — the powerup drop pool');
{
  const pool = PU.POWERUPS.filter((p) => p.weight > 0).map((p) => p.kind);
  const dead = PU.POWERUPS.filter((p) => p.weight === 0).map((p) => p.kind);
  console.log(`  can be dropped at random : ${pool.join(', ')}`);
  console.log(`  weight 0, never dropped  : ${dead.join(', ')}`);
}

/*
 * `Player.addPowerup`'s eviction queue, driven exhaustively.
 *
 * The cap only exists for TIMED powerups (`duration > 0`), and after the
 * progression rebuild only three kinds can ever be added at all: `bomb`
 * (duration 0, so it never enters the queue), `overdrive` and `encore`. Two
 * queue-eligible kinds against a cap of three is a cap that cannot bite, and
 * this drives every kind in the table at once to show that even the impossible
 * case cannot exceed it.
 */
console.log('\nSTATIC — Player.MAX_ACTIVE, against the kinds that can reach the queue');
{
  const { Player } = await import('../src/game/player.ts');
  const p = new Player();
  p.reset(0, 0);
  const droppable = PU.POWERUPS.filter((d) => d.weight > 0).map((d) => d.kind);
  const grantable = [...droppable, 'encore'];
  const timed = grantable.filter((k) => PU.powerupDef(k).duration > 0);
  console.log(`  kinds a run can grant  : ${grantable.join(', ')}`);
  console.log(`  of those, timed        : ${timed.join(', ')}  (only timed kinds enter the queue)`);
  for (let i = 0; i < 40; i++) {
    const k = grantable[i % grantable.length];
    p.addPowerup(k, PU.powerupDef(k).duration);
  }
  console.log(
    `  after 40 grants: held ${Object.keys(p.powerups).length}, evicted ${p.evicted.length}` +
      `   cap ${p.maxActive} → ${timed.length > p.maxActive ? 'REACHABLE' : 'UNREACHABLE — the eviction path is dead'}`,
  );
}

for (let r = 0; r < RUNS; r++) {
  const res = runOnce(0x51ed + r * 7919, MINUTES, false);
  console.log(`\n  mortal run ${r + 1}: wave ${res.wave}, level ${res.level}${res.over ? ', DIED' : ''}`);
}
for (let r = 0; r < RUNS; r++) {
  const res = runOnce(0xbeef + r * 7919, MINUTES, true);
  console.log(`  immortal run ${r + 1}: wave ${res.wave}, level ${res.level}`);
}
/*
 * Three states no natural run reaches inside the time these tools have.
 *
 * `jumpToWave` is the world's own debug hook and exists for exactly this. The
 * escalation term, the fused stat blocks and the six firing routines under a
 * full rig are all unobservable otherwise, and "the bot never got there" is not
 * a measurement of anything.
 */
for (const wave of [16, 26, 40]) {
  const res = runOnce(0xd00d + wave, 2, true, { wave });
  console.log(`  deep run @wave ${wave}: reached wave ${res.wave}`);
}
{
  const res = runOnce(0xfeed, 2, true, { loadout: 'max' });
  console.log(`  full-loadout run: wave ${res.wave}`);
}
{
  const res = runOnce(0xf00d, 2, true, { loadout: 'fused', wave: 16 });
  console.log(`  all-fusions run @wave 16: wave ${res.wave}`);
}

console.log('\nDYNAMIC — measured ranges');
for (const k of Object.keys(R).sort()) console.log('  ' + R[k].row());

console.log('\nDYNAMIC — how often each guard was true');
for (const k of Object.keys(C).sort()) console.log('  ' + C[k].row());

console.log('\nDYNAMIC — what the run actually contained');
console.log(`  archetypes met     ${[...archetypesSeen].join(', ')}`);
console.log(`  wave grades        ${[...gradesSeen].map(([g, n]) => `${g}:${n}`).join(', ') || 'none'}`);
console.log(`  movements seen     ${[...movementsSeen].join(', ') || 'none'}`);
console.log(`  powerup kinds held ${[...powerupKindsSeen].join(', ') || 'none'}`);
console.log(
  `  shot voices heard  ${[...shotVoicesSeen].sort().join(', ') || 'NONE — the family fallback in audio/sfx.ts is unreachable'}` +
    `   (from ${shotIdsSeen.size} instruments)`,
);
console.log(`  fusions completed  ${fusionsSeen.join(', ') || 'NONE — no run reached one'}`);
console.log(`  abilities reached  ${[...abilityLevelsSeen].map(([id, lv]) => `${id}:${lv}`).join(', ')}`);
console.log(
  `  rig max level seen ${Math.max(0, ...[...abilityLevelsSeen].filter(([id]) => W.slotOf(id) === 'rig').map(([, lv]) => lv))}` +
    `  (RIG_MAX_LEVEL=${W.RIG_MAX_LEVEL})`,
);
console.log(
  `  inst max level seen ${Math.max(0, ...[...abilityLevelsSeen].filter(([id]) => W.slotOf(id) === 'instrument').map(([, lv]) => lv))}` +
    `  (INSTRUMENT_MAX_LEVEL=${W.INSTRUMENT_MAX_LEVEL}, catalystHintLevel=${P.OFFER_TUNING.catalystHintLevel})`,
);
console.log('');
