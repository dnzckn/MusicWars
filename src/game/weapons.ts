/**
 * The ensemble: instruments, rig, and what they fuse into.
 *
 * This is the data half of the Vampire-Survivors-shaped progression system;
 * `game/progression.ts` is the logic half and this file knows nothing about it.
 * Everything here is a plain table so it can be read, diffed and argued about
 * without running anything.
 *
 * The shape is borrowed deliberately and the reasons are worth writing down,
 * because three of them are load-bearing:
 *
 *   - **A level is a behavioural change, not a multiplier.** In Vampire
 *     Survivors, Knife at level 3 fires an extra knife; it does not do 12% more
 *     damage. The reason is legibility: a player has to be able to *see* what
 *     the last choice bought, and +12% is invisible. Every step below therefore
 *     carries a one-line `note` describing what the player will notice, and any
 *     step whose note is only a number is a step that should be redesigned.
 *   - **Two inventories, both small.** Instruments (weapons) and rig (passives)
 *     have separate slots, and the interesting decisions only start once they
 *     are full — a full inventory means new offers can only *level what you
 *     already hold*, which is what turns a run into a build instead of a
 *     shopping list.
 *   - **Evolution is the hook.** A maxed instrument plus its maxed catalyst
 *     fuses into something with a different verb, not a bigger number.
 *
 * And one thing that is *not* borrowed. In this game every ability has a voice
 * in the live arrangement, so an evolution is two instruments becoming a new
 * timbre. That is why the catalysts are studio gear rather than trinkets, and
 * why each fusion below carries a `character` phrase: the audio side reads it
 * to write the voice, and if a fusion cannot be described in one musical phrase
 * it is probably not a fusion, it is a stat.
 *
 * Arena shapes only. The game is a bullet hell in the round, so every
 * instrument here is an aura, an orbit, an arc, a sweep, a lingering field, a
 * held line, a burst or a rotating pattern. A weapon that only fires "up" is a
 * weapon that is useless half the time, which is precisely why Vampire
 * Survivors' roster looks the way it does — and note that three of those eight
 * are AIMED, which is a direction this roster deliberately moved in. See
 * `InstrumentShape` for why.
 */

import type { AbilityId, AbilitySlot, EvolvedId, InstrumentId, RigId } from '../core/events';

/**
 * Instruments cap at 3. TWO decisions per instrument, and the ladder is short
 * on purpose.
 *
 * IT WAS EIGHT, copied from Vampire Survivors, and the copy imported a pacing
 * assumption that does not hold here. VS runs thirty minutes with six weapon
 * slots and an evolution table where the catalyst caps at 5; the ladder is long
 * because the RUN is long. A MusicWars run reaches level 55-61 in twenty
 * minutes over ~54 offers (`tools/arena.mjs`), and an evolution demanded a base
 * at 8 *and* a catalyst at 5 — thirteen levels, twelve of them picks, all of
 * them landing on the right two of four cards. `tools/combine.mjs` measured the
 * most fusion-focused player the game permits taking until wave 30 to land two.
 *
 * The owner's complaint was the symptom of exactly that: "the combos that exist
 * are cool, but take way too long to unlock the upgrade." So the ladder is cut
 * to the length of the thing it gates. Base 3 + catalyst 3 is six levels, five
 * of them picks, and the fusion is then its own three-rung ladder — which is
 * the shape asked for: three levels to a weapon, then it combines, then three
 * more.
 *
 * THE ROSTER IS NOT NERFED BY THIS. Cutting seven rungs to two by deleting five
 * of them would have taken 60% of every instrument's ladder out of the game.
 * Instead each instrument's seven steps were FOLDED into two: every `add` is
 * summed and every `mul` multiplied, so the stat block at the new max is
 * IDENTICAL to the stat block at the old level 8, field for field. No field in
 * the table carried both an add and a mul, which is what makes the fold exact
 * rather than approximate. `tools/_maxprobe.mjs` diffs the emitted blocks
 * against a pristine copy of this file and reports zero drift; that is a
 * measurement of the folded output, not a reading of this comment.
 *
 * What changed is the SLOPE. The ceiling is where it was and it is reached in
 * two picks instead of seven, which is the whole point — and it is why each
 * surviving step has to buy something a player can see. A step here is now
 * worth three and a half of the old ones.
 *
 * ---------------------------------------------------------------------------
 * AND THE SLOPE IS WHAT BROKE THE DIFFICULTY CURVE. Say this plainly, because
 * it is the one thing this change costs and it is not fixable in this file.
 *
 * `tools/arena.mjs`, 3 runs of 20 minutes, card-0 bot, before against after:
 *
 *     fusions per run     0.33 -> 5.00        nominal dps    942 -> 3768
 *     kills/min          101.5 -> 167.5       wave          35.7 -> 42.3
 *     enemies on field (p50/p90)  7.3/30.3 -> 2.0/9.7
 *     encirclement p90    0.53 -> 0.02        <-- the STRUCTURE gate wants >0.25
 *
 * The arena's `the player does get surrounded` check is RED and it is right to
 * be. Reading the per-minute income table, the two runs are identical at minute
 * 1 and diverge from minute 2 (45 -> 57 kills) and decisively by minute 3
 * (40 -> 90): the first few level-ups now max an instrument outright, so the
 * player outruns the wave curve almost immediately and the field never fills.
 *
 * This is a POWER-PER-MINUTE problem, not a power-at-max problem — the ceiling
 * is provably unmoved. The fix is enemy hp and spawn scaling in `waves.ts` and
 * `enemies.ts`, which have to be re-fitted to a player who arrives at full
 * strength around minute three instead of minute twelve. Do NOT fix it by
 * lengthening these ladders again; that is the complaint this change exists to
 * answer, and the rig ablation below shows the catalyst is not the lever
 * either.
 */
export const INSTRUMENT_MAX_LEVEL = 3;
/**
 * Rig caps at 3 as well, and this one is load-bearing rather than tidy.
 *
 * It was 5, and leaving it there would have MOVED the bottleneck rather than
 * removed it: `readyFusions` requires `catLevel >= maxLevelOf(f.catalyst)`, so
 * an evolution with a 3-level base and a 5-level catalyst costs 2 + 5 = seven
 * picks, of which five are the passive. The catalyst would have become 71% of
 * the cost of every designed recipe in the table. Verified against the
 * requirement itself and not assumed — `readyFusions` reads `maxLevelOf`, which
 * returns this constant for every rig id, and all thirteen evolutions take a
 * rig item as their catalyst (`tools/_fusecost.mjs` prints the cost of each).
 *
 * Same treatment as the instruments: `levels` is CUMULATIVE, so entry 3 is the
 * old entry 5 verbatim and the two rungs below it are re-spaced. Every passive
 * therefore tops out at exactly the multiplier it topped out at before.
 *
 * ABLATED, because "the rig is what makes the player too strong" is the obvious
 * objection and it is wrong. Holding this at 5 while everything else stayed —
 * which costs nothing in power, since `rigModifiers` clamps to
 * `levels.length`, and so isolates the PICK COST on its own — was run through
 * `tools/arena.mjs` at 3 runs of 20 minutes:
 *
 *     rig 3   fusions/run 5.00   nominal dps 3768   kills/min 167   enc p90 0.02
 *     rig 5   fusions/run 3.00   nominal dps 2172   kills/min 166   enc p90 0.00
 *
 * A five-pick catalyst does cut the fusion count, and it does NOT recover the
 * difficulty curve: kills per minute is identical and the encirclement signal
 * is no better — it is marginally worse. Whatever made the player too strong is
 * the two-pick INSTRUMENT ladder, not the catalyst. So paying seven picks a
 * recipe would have bought nothing except the exact complaint this change
 * exists to answer. Do not re-propose it without a number that contradicts
 * these two rows.
 */
export const RIG_MAX_LEVEL = 3;

/**
 * What the world needs to fire an instrument.
 *
 * Every field is a number so a stat block can be folded, scaled and diffed
 * without a special case. `shape` is the only string, and it selects which
 * routine in the world runs — it is not modulated, it is dispatched on.
 */
export interface InstrumentStats {
  /** Seconds between activations. */
  interval: number;
  /** Projectiles, pods, strikes or pools per activation. */
  count: number;
  /** Damage per hit, before rig modifiers. */
  damage: number;
  /** Effect radius in px. 0 for shapes that are pure projectiles. */
  area: number;
  /** Angular width in radians for arcs and fans. 0 for single-file shapes. */
  arc: number;
  /** Travel speed in px/s. 0 for shapes anchored to the ship. */
  speed: number;
  /** Enemies one hit passes through. 1 means it stops at the first. */
  pierce: number;
  /**
   * Wall bounces before expiry.
   *
   * FOR MOST OF THIS TABLE'S LIFE THIS WAS A NUMBER WITH NO CONSUMER, and the
   * history is worth keeping because it is the cheapest example of the defect
   * class in the repository. `applyModifiers` carried it, ECHO CHAMBER set 2
   * and raised it three more times across its ladder, SPICCATO set 2 and CANON
   * set 8 — and `BulletSpawn` had no such field and `BulletPool.update`
   * reflected nothing, so a bolt with `DespawnOffscreen` was simply removed at
   * the boundary. "Bolts that come back off the walls" was a blurb, ECHO
   * CHAMBER's identity was inert, and two of its seven steps bought nothing.
   * `tools/deadhunt-ranges.mjs` found it by greping each stat name against the
   * six firing routines and reporting this one as NEVER READ.
   *
   * It is implemented now: `BulletPool.update` takes a wall rectangle and
   * reflects in angle space, `World` passes the arena rect for the player pool
   * only, and all three projectile-spawning routines forward the stat. The
   * counter that proves it is `BulletPool.bounced`, which the same tool reads —
   * a feature nothing can observe is a feature that can rot again.
   */
  bounces: number;
  /** Seconds the effect persists where it landed. */
  linger: number;
  /** Max range in px before expiry. 0 means "until it leaves the arena". */
  range: number;
}

/**
 * How an instrument occupies space, and therefore which routine draws and
 * collides it. These are the arena archetypes; everything in the roster is
 * one of them, which keeps the world's dispatch honest.
 *
 * ---------------------------------------------------------------------------
 * SEVEN BECAME FOURTEEN, AND THEN BACK TO SEVEN. READ WHY, BEFORE ADDING ONE.
 *
 * `docs/research-weapons.md` classified this roster by MECHANICAL VERB and
 * measured one verb per 3.9 instruments against 1.2 for launch-era Vampire
 * Survivors. The answer taken at the time was more geometries: `lance`, `cone`
 * and `spray`, then `trail`, `chain`, `mortar` and `spawn`. Seven shapes became
 * fourteen over 27 instruments, one verb per 1.9, and not one id was added.
 *
 * IT DID NOT WORK, AND THE OWNER SAID SO TWICE. "There currently not fun", and
 * then, of the roster that followed: "all one idea". Both verdicts are the same
 * finding — fourteen geometries are fourteen ways of saying "damage happens
 * near enemies", and distinctness of geometry is not variety of decision.
 *
 * `docs/plan-refactor-3.md` §9 went back to the source material rather than
 * inventing a third answer, and found that Ball x Pit spends its variety on
 * PROPERTIES rather than on delivery — and that this is exactly what lets it
 * reach thousands of combinations, because uniform delivery is what makes
 * properties compose. So the count came back down and the variety moved to
 * `Props`. Seven survivors, chosen for how differently they read on screen,
 * plus the six non-damage shapes that are a different axis entirely.
 *
 * DO NOT ADD A GEOMETRY TO MAKE A WEAPON DIFFERENT. That was tried, it is
 * written up above, and the next weapon's difference belongs in `Props`.
 */
export type InstrumentShape =
  /* ---------------------------------------------------------------------- *
   * SEVEN GEOMETRIES, DOWN FROM FOURTEEN, AND THE CUT IS THE ARCHITECTURE.
   *
   * `docs/plan-refactor-3.md` §9a: Ball x Pit reaches ~7,921 combinations
   * because DELIVERY IS UNIFORM. Every ball launches the same way, so the
   * property is the weapon and properties compose without a combinatorial
   * explosion of firing code. This file had gone the other way — fourteen
   * geometries and zero properties — and the owner's verdict on the result was
   * that it was "all one idea", which it was: every one of the fourteen
   * answered "where does the hitbox appear" and none answered "what does the
   * hit DO".
   *
   * Seven of the fourteen are gone. Each was cut because it is a VARIANT of a
   * survivor, or because the property substrate now expresses it better, and
   * each is named here with which:
   *
   *   `beam`    a static star of strokes around the compass. `lance` is the
   *             aimed version and the one the owner asked for by name; a star
   *             of six lances is a lance with a `count`, not a second idea.
   *   `cone`    `arc` with a short `range` and a wide `arc` is the same volley.
   *             The close-range identity survives as RASP's stat block.
   *   `spray`   `arc` with `bounces` and a precessing phase. A geometry variant
   *             of a survivor by its own documentation.
   *   `trail`   pools laid down by moving. `field` places pools and UP-TEMPO's
   *             `Rules.trailDamage` already lays a wake; two systems, one
   *             sentence.
   *   `chain`   IS NOW A PROPERTY. `Props.chain` arcs from any hit by any
   *             delivery, which is strictly more general than a shape only one
   *             instrument could wear.
   *   `spawn`   IS NOW A PROPERTY. `Props.brood` sends a hunter from any hit.
   *   `mortar`  a telegraphed shell that pulls, then lands. `strike` already
   *             lands ON a body and burns a circle; the telegraph is a
   *             presentation difference, not a verb.
   *
   * WHAT SURVIVES IS CHOSEN FOR HOW DIFFERENTLY IT READS ON SCREEN, not for
   * how differently it is implemented: a bolt at a target, a stroke across
   * your facing, a ring on you, a hit that lands over there, satellites, a
   * pool on the ground, a held line. Seven silhouettes a player can name.
   * ---------------------------------------------------------------------- */
  /** Bolts toward the nearest target inside range. The default delivery. */
  | 'seek'
  /** A sweep through an arc centred on the ship's facing; a fan if it travels. */
  | 'arc'
  /**
   * ONE CONTINUOUS BEAM, ANCHORED TO THE SHIP, TRACKING THE AIM IN REAL TIME.
   *
   * `lance` is the verb no other shape has: your HEADING is the weapon. `seek`
   * picks targets for you, `aura` is omnidirectional, `strike` is explicitly
   * unaimable and `arc` sprays. A lance rewards strafing sideways to keep the
   * line on a boss and rotating through a pack like a scythe, and it punishes
   * standing still with the line off-target.
   *
   * `count` is PARALLEL lances. `linger` is how far past the next activation
   * the line is drawn for, so a longer hold is a steadier line rather than a
   * brighter one. `speed`, `pierce`, `bounces` and `arc` are deliberately
   * unread: a held line has no travel speed, nothing to pass through, no wall
   * to come off and no angular width beyond its own half-thickness.
   */
  | 'lance'
  /** Satellites circling the ship. */
  | 'orbit'
  /** A ring or field centred on the ship. */
  | 'aura'
  /**
   * An unaimed hit that lands ON something and damages a circle around it.
   *
   * The only shape that reaches PAST a wall of bodies without travelling
   * through it. A strike reads `count`, `area`, `range`, `interval` and
   * `damage`, and ignores `speed` — a struck bell has no travel speed because
   * it does not travel.
   */
  | 'strike'
  /** A field dropped in the world that stays where it was put. */
  | 'field'
  /* ---------------------------------------------------------------------- *
   * THE SIX SHAPES THAT ARE NOT "DAMAGE IS DEALT IN SHAPE X".
   *
   * `docs/plan-items-v2.md` §1 counted the roster and found twelve items and
   * ONE idea. Three of the six below deal NO DAMAGE AT ALL and two of them
   * make other items fire; that is the second axis, and it is orthogonal to
   * this pass, which is about the FIRST axis being one idea.
   *
   * NONE OF THE TWENTY BASE WEAPONS IS ONE OF THESE, and that is a deliberate
   * consequence of "every base weapon is a property". They survive as fusion
   * results — earned rather than drafted — so the code stays reachable, the
   * gates that measure them keep their contributors (`tools/builds.mjs`' damage
   * spread is largely their doing), and the next phase can decide on evidence
   * whether the axis earns a base slot back. Deleting six working shapes on the
   * way past would have been a second design decision smuggled into this one.
   * ---------------------------------------------------------------------- */
  /**
   * A BAR OF INVULNERABILITY THAT SILENCES YOUR OWN BAND.
   *
   * Deals nothing, ever. The cost is audible: while the rest is running,
   * `GameSnapshot.tacetStems` carries the whole band and the mix drops to its
   * drone. `linger` is the length of the rest in BARS, `interval` the cooldown,
   * `area` the radius of the ring that sweeps the field clean when the band
   * comes back in.
   */
  | 'rest'
  /**
   * TIME DRAGS IN A BUBBLE AROUND YOU — INCLUDING YOURS.
   *
   * `area` is the bubble, `damage` is REUSED AS THE DRAG FRACTION, `arc` is
   * what it costs you, `interval` and `linger` drive the visible pulse.
   */
  | 'drag'
  /**
   * THE LAST THING YOU KILLED COMES BACK AND FIGHTS FOR YOU.
   *
   * `count` is the standing retinue, `linger` a ghost's lifetime, `damage` its
   * hit, `speed` its travel, `interval` the minimum gap between raisings.
   */
  | 'ghost'
  /**
   * YOUR SECOND INSTRUMENT FIRES A COPY WHENEVER YOUR FIRST DOES.
   *
   * `damage` is the copy's share of the follower's own damage, `count` extra
   * projectiles on the copy, `interval` a floor on how often a copy may be
   * struck.
   */
  | 'counterpoint'
  /**
   * EVERY INSTRUMENT FIRES TOGETHER ON THE BAR INSTEAD OF ON ITS OWN TIMER.
   *
   * Rate-neutral by construction: re-clocking an instrument from its own
   * `interval` to one bar multiplies its activations by `interval / bar`, so
   * the routine multiplies its damage by `bar / interval`, clamped.
   */
  | 'unison'
  /**
   * SILENCE ONE LANE OF YOUR OWN SOUNDTRACK, BANK IT, SPEND IT WHEN IT RETURNS.
   *
   * `damage` is banked per BAR of silence, `linger` how many bars the lane
   * stays out, `range` the bars it plays before going out again, `area` the
   * discharge radius, `count` how many lanes go at once.
   */
  | 'tacet';
export type BeatLock =
  /** Bar lines. Four beats apart. */
  | 'bar'
  /** Bar lines and the half-bar. Two beats apart. */
  | 'halfbar'
  /** The eighth-note OFF beats — the "and" of every beat, never the beat. */
  | 'offbeat';

/**
 * A multiplier the world applies to an activation from OUTSIDE the stat block.
 *
 * Two items scale with something no `Modifiers` field can express, and both of
 * them invert a curve rather than steepening one.
 */
export type Swell =
  /**
   * Near-inert outside the drop, the strongest thing in the game inside one.
   * Reads `MusicalState.section` and `MusicalState.energy`.
   */
  | 'drop'
  /**
   * Feeble when safe, enormous when surrounded. Reads the world's own
   * encirclement signal — the same one `tools/arena.mjs` gates the difficulty
   * curve on — so it needs no snapshot from the music and behaves identically
   * in a headless run and in a played one.
   */
  | 'danger'
  /**
   * Full weight out of a bar of silence, 62% of it arriving one beat after
   * something else fired. Reads `World.beatsQuiet`.
   *
   * It exists because two beat-locked weapons on disjoint slices of the bar do
   * not actually fight — they interleave, which is a synergy, and
   * `docs/plan-items-v2.md` §3 asks for METRONOME and SYNCOPATION to
   * anti-synergise on purpose. A downbeat that is worth more the emptier the
   * bar before it was is the honest version of that: it costs nothing to hold
   * one of them and something real to hold both.
   */
  | 'silence';

export interface LevelStep {
  /** What the player will notice. If this is only a number, redesign the step. */
  note: string;
  add?: Partial<InstrumentStats>;
  mul?: Partial<InstrumentStats>;
  /**
   * The beat lock this level and every level above it runs on.
   *
   * A rung that moves an instrument from the bar to the half-bar is the largest
   * legible jump a beat-locked weapon has available — the player HEARS it, and
   * "twice as often" needs no stat block to read. It is a separate field from
   * `mul` because a lock is not a number; `beatLockOf` resolves it.
   */
  beat?: BeatLock;
  /**
   * The property set this level and every level above it carries, CUMULATIVE.
   *
   * Cumulative rather than a delta, exactly as `RigDef.levels` is and for the
   * same reason: you cannot answer "what does this do at level 3" without
   * folding, and every balance conversation about a property is that question.
   * `instrumentProps` overwrites named fields and leaves the rest, so a rung
   * that only moves `burn` says only `{ burn: 14 }`.
   */
  prop?: Partial<Props>;
}

export interface InstrumentDef {
  id: InstrumentId | EvolvedId;
  label: string;
  shape: InstrumentShape;
  /**
   * Which grid line this instrument's activations are allowed to land on, at
   * level 1. Absent means "whenever the interval says", which is every
   * instrument that existed before this pass.
   */
  beat?: BeatLock;
  /** A multiplier the world applies from outside the stat block. */
  swell?: Swell;
  /** Level 1. Every step below is applied on top of this, in order. */
  base: InstrumentStats;
  /**
   * What this weapon's hits CARRY at level 1. Absent means "nothing" — a
   * weapon that is only a stat block, which after this pass is a thing only a
   * fusion result is allowed to be.
   *
   * `tools/propfire.mjs` asserts every DRAFTABLE instrument declares at least
   * one property, because "the property is the weapon" is the architecture and
   * a base weapon with no property is a delivery shape wearing a name — which
   * is the roster the owner rejected first.
   */
  props?: Partial<Props>;
  /**
   * Two steps, taking level 1 to level 3. Fusions carry none.
   *
   * `tools/levelup.mjs` asserts `steps.length === INSTRUMENT_MAX_LEVEL - 1`, so
   * this length follows the constant rather than being a second copy of it.
   */
  steps: readonly LevelStep[];
  /** One line for the HUD and the offer card. */
  blurb: string;
  /** One phrase for whoever writes the voice. Read by the audio side, not the sim. */
  character: string;
  /** Relative weight in the offer pool. 0 means it is never offered. */
  weight: number;
  /** True for fusions: reachable only by evolving or unioning into them. */
  fused?: boolean;
}

/** Everything a rig item can move. Folded into one object per frame. */
export interface Modifiers {
  /** Multiplier on instrument damage. */
  damage: number;
  /** Multiplier on instrument interval. Below 1 is faster. */
  cooldown: number;
  /** Multiplier on area and arc. */
  area: number;
  /** Additive extra projectiles per activation. */
  count: number;
  /** Multiplier on projectile speed. */
  speed: number;
  /** Multiplier on linger. */
  linger: number;
  /** Multiplier on the shard pickup radius. */
  pickupRadius: number;
  /** Multiplier on player move speed. */
  moveSpeed: number;
  /** Additive max HP. */
  maxHp: number;
  /**
   * Multiplier on enemy time. Below 1 is slower.
   *
   * IT IS LOCAL NOW. `Rules.slowRadius` says WHERE it applies, and TIMEWARP is
   * the only item that sets either — so this is the depth of the slow bubble
   * around the ship rather than a whole-room time warp. See `Rules.slowRadius`
   * for why the room stopped being slowed and what that cost.
   */
  enemyTime: number;
  /** Multiplier on XP gained from shards. */
  xpGain: number;
}

/*
 * TWO FIELDS WERE DELETED FROM `Modifiers` BY THE RULES WORK. Recorded here
 * because both were load-bearing in the table and both are now expressed
 * better, and because "the number vanished" and "the number was replaced" look
 * identical in a diff.
 *
 *   `pierce` — additive, set by LASER alone. LASER is a rule now, and its rule
 *   sets `InstrumentStats.pierce` directly on the overcharged activation
 *   (`World.fireInstruments`). A modifier field nothing fed would have folded
 *   to 0 on every frame of every run, which is this repository's most recorded
 *   defect wearing a stat block.
 *
 *   `homing` — 0..1, set by HOMING alone. It was ALREADY a dead ladder: the one
 *   consumer, `World.steerPlayerBullets`, tested `mods.homing > 0` and then
 *   turned every bullet at a hardcoded 6 rad/s, so HOMING L1, L2 and L3 steered
 *   identically and two of its three rungs bought nothing. `deadhunt-ranges`
 *   could see the field was READ (14.98% of steps) and not that its VALUE was
 *   ignored. Steering is per-bullet now — `BulletFlag.Seeking` — so a shot
 *   either seeks or does not, and the rule that spawns it decides.
 */

export function noModifiers(): Modifiers {
  return {
    damage: 1,
    cooldown: 1,
    area: 1,
    count: 0,
    speed: 1,
    linger: 1,
    pickupRadius: 1,
    moveSpeed: 1,
    maxHp: 0,
    enemyTime: 1,
    xpGain: 1,
  };
}

/**
 * The trigger surface: what a rig item can DO, as opposed to what it can scale.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. `docs/plan-passives.md` measured the problem: all twelve
 * passives were entries in one spreadsheet column-set, `Modifiers` had thirteen
 * fields and every one was a number, and so a passive physically could not say
 * anything except *a number is bigger*. LASER — the item the owner reached for
 * when naming what a weapon should be — rendered on the level-up card as
 * "+12% damage". Half of every four-card offer was a percentage.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS A FLAT RECORD AND NOT A LIST OF `RuleSpec`s. The plan drafted
 * `{ onKill: RuleSpec[]; onDamaged: RuleSpec[]; ... }` — a bag of specs per
 * trigger moment. This is deliberately not that, and the reason is the one
 * `Modifiers` states two declarations above: a flat record of numbers folds.
 * `rigRules` is `rigModifiers`' exact twin, order-independent by construction
 * and diffable by a tool that holds no copy of anyone's arithmetic; a list of
 * specs needs an interpreter, an ordering rule and a dispatch table, all of
 * which is machinery for a table with one contributor per rule. What makes
 * these RULES rather than stats is not the container — it is that each one is
 * consumed by a BRANCH at a moment, not by a multiplication in
 * `applyModifiers`, and that the player can do something about the moment.
 *
 * ---------------------------------------------------------------------------
 * WHERE THEY FIRE. In place inside `world.ts`, at the lines that already emit
 * the matching event — NOT from a bus subscription. `core/events.ts` says the
 * simulation emits and never receives and that the narrow boundary is why
 * either half can be rewritten; a listener in `main.ts` reaching back into the
 * world to spawn a nova would invert it, and would additionally buy an ordering
 * question and a frame of latency for nothing.
 *
 *     overchargeEvery   World.fireInstruments   (on an activation)
 *     killEcho          World.collidePlayerBullets, at the killing hit
 *     slowRadius        World.updateEnemies, per enemy, at `e.move`
 *     hitNova           World.onPlayerHit       (beside `player:hit`)
 *     chargeSeconds     World.fireInstruments   (reads the idle clock)
 *     trailDamage       World.step              (on distance travelled)
 *
 * `player:graze` and `shard:collect` are the two moments in the plan's draft
 * that NOTHING here uses. There is deliberately no `onGraze` or `onCollect`
 * field: an unused field is the defect this whole change exists to remove, and
 * the two events are still there for the day a passive wants them.
 *
 * ---------------------------------------------------------------------------
 * NO NEW CONTAINERS, WHICH WAS THE PLAN'S OWN FALSIFICATION TEST. §7 says that
 * if the surface needs a container per rule the cost model collapses. It does
 * not: the overcharge re-flags bullets that were going to be fired anyway, the
 * echo and the trail reuse `BulletPool` and `novas[]`, the nova reuses
 * `novas[]`, and the slow bubble and the still-charge are scalars.
 */
export interface Rules {
  /**
   * ON AN ACTIVATION. Every Nth activation of EACH instrument is overcharged:
   * it pierces everything and its bolts seek. 0 is off.
   *
   * Per instrument and not per volley across the band, because a global counter
   * would spend almost every overcharge on PIZZICATO — at 0.15s it fires ten
   * times for TIMPANI's once — which is the voice the player has already heard
   * a thousand times. Same argument as `fireInstruments`' rarest-wins tiebreak.
   */
  overchargeEvery: number;
  /** Damage multiplier on an overcharged activation. */
  overchargeDamage: number;
  /**
   * ON A KILL BY A PLAYER BULLET. Bolts re-fired from the corpse at the next
   * target, seeking. 0 is off.
   *
   * An echo cannot echo — the re-fired bolt carries `BulletFlag.Echo` and the
   * branch skips it — so the worst case is one extra bullet per kill and not a
   * chain reaction that empties the field into the pool.
   */
  killEcho: number;
  /**
   * CONTINUOUSLY, PER ENEMY. Radius in px around the ship inside which
   * `Modifiers.enemyTime` applies to an enemy's movement. 0 is off, and off is
   * the state in which `enemyTime` does nothing at all.
   */
  slowRadius: number;
  /** ON TAKING A HIT. Damage of the ring released. 0 is off. */
  hitNova: number;
  /** Radius of that ring. */
  hitNovaRadius: number;
  /**
   * WHILE STANDING STILL. Seconds with the stick released for a full charge.
   * 0 is off.
   *
   * The ladder tops out at 1.5s, well inside the `World.IDLE_GRACE_S` window of
   * 4s that the game allows before camping starts costing you — so FERMATA's
   * sweet spot is plant, take the swell, move before the bullets speed up.
   */
  chargeSeconds: number;
  /** Damage multiplier at a full charge. */
  chargeDamage: number;
  /** WHILE MOVING. Damage of each ring dropped in your wake. 0 is off. */
  trailDamage: number;
  /** Radius each dropped ring grows to. */
  trailRadius: number;
  /** Seconds each dropped ring takes to grow and fade. */
  trailLife: number;
  /** Px of travel between drops. */
  trailEvery: number;
}

export function noRules(): Rules {
  return {
    overchargeEvery: 0,
    overchargeDamage: 1,
    killEcho: 0,
    slowRadius: 0,
    hitNova: 0,
    hitNovaRadius: 0,
    chargeSeconds: 0,
    chargeDamage: 1,
    trailDamage: 0,
    trailRadius: 0,
    trailLife: 0,
    trailEvery: 0,
  };
}

/**
 * Fields where a SMALLER positive number is the stronger version, so the fold
 * takes the minimum of the contributors that are switched on rather than the
 * maximum. Exported because `tools/rulefire.mjs` asserts a rule ladder never
 * goes backwards and has to know which way forwards is; a copy of this list
 * over there would lie by calling a real regression an improvement the day
 * somebody moved a field between the two categories. AGENTS.md §3.
 */
export const RULE_LOWER_IS_STRONGER: readonly (keyof Rules)[] = ['overchargeEvery', 'chargeSeconds', 'trailEvery'];

/* ------------------------------------------------------------------------ *
 * THE PROPERTY SUBSTRATE
 *
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS, IN ONE PARAGRAPH THAT SHOULD NOT HAVE TO BE RE-DERIVED.
 *
 * Three rosters were rejected: fourteen delivery shapes ("all one idea"), a
 * `family x element` grid ("samey weapons wearing modifier tags"), and sixteen
 * invented weapons ("too many odd weapons — literally just look at those
 * games"). `docs/plan-refactor-3.md` §9 reads both wikis and finds the answer
 * in Ball x Pit: its 21 base balls are mostly SIMPLE COMPOSABLE PROPERTIES —
 * Burn, Freeze, Poison, Bleed, Lightning, Wind, Ghost, Iron, Stone, Dark,
 * Light, Time, Vampire, Cell, Egg Sac, Brood Mother, Earthquake, Flesh, Laser,
 * Charm — and its 69 fusions are hand-authored NEW BEHAVIOURS. It reaches
 * ~7,921 combinations because DELIVERY IS UNIFORM: every ball launches the
 * same way, so the property IS the weapon and properties compose without a
 * combinatorial explosion of firing code.
 *
 * This codebase was exactly backwards for a combination game: fourteen
 * delivery shapes and zero properties. This is the half that was missing.
 *
 * ---------------------------------------------------------------------------
 * IT IS A FLAT RECORD OF NUMBERS, FOR THE SAME REASON `Rules` IS.
 *
 * `Rules`' own note argues it and the argument transfers verbatim: a flat
 * record folds. `instrumentProps` and `mergeProps` are order-independent by
 * construction, diffable by a tool that holds no copy of anyone's arithmetic,
 * and need no interpreter, ordering rule or dispatch table. What makes these
 * PROPERTIES rather than stats is not the container — it is that each one is
 * consumed by a BRANCH at a moment (a hit, a tick, an activation) rather than
 * by a multiplication in `applyModifiers`, and that the enemy carries state
 * because of it.
 *
 * `mergeProps` is what the ~60 authored fusions of the next phase are built
 * on: a fusion result declares its own props and inherits its parents', and
 * the merge is one `Math.max` per field. That is the whole reason this is a
 * record and not a list of behaviours.
 *
 * ---------------------------------------------------------------------------
 * NUMBERS ARE TUNED TO THIS GAME, RATIOS ARE FROM THE SOURCE. Ball x Pit's
 * damage figures mean nothing here — a `pluck` has 16 hp and a heavy 72, and
 * an instrument deals 4-40 a hit. What is carried across is the SHAPE of each
 * effect: burn caps at three stacks over three seconds, poison at five over
 * six, bleed at eight stacks paid on being hit, freeze is a small chance for a
 * long hold that also makes the target softer, and so on. The per-effect
 * constants live in `PROP` below rather than in twenty stat blocks, so a
 * duration is one number and not twenty copies of one number.
 * ------------------------------------------------------------------------ */

/**
 * What a HIT CARRIES, over and above its damage.
 *
 * Every field is a number so the set can be folded, merged and diffed with no
 * special case — the same contract `InstrumentStats` and `Modifiers` hold. Zero
 * always means "this property is not present", which is what makes `noProps()`
 * a usable control and what lets `tools/propfire.mjs` prove a run with no
 * property installed fires nothing.
 */
export interface Props {
  /** BURN. Damage per second per stack. Ball x Pit Burn. */
  burn: number;
  /** Burn stacks a hit applies. */
  burnStack: number;
  /** POISON. Damage per second per stack. Ball x Pit Poison. */
  poison: number;
  /** Poison stacks a hit applies. */
  poisonStack: number;
  /**
   * BLEED. Damage per stack, paid WHEN THE TARGET IS HIT AGAIN rather than on
   * a clock. Ball x Pit Bleed, and the reason it is the odd one out: a bleed
   * build wants to hit fast and often, which is a different left hand from a
   * burn build that wants to hit once and walk away.
   */
  bleed: number;
  /** Bleed stacks a hit applies. */
  bleedStack: number;
  /** FREEZE. 0..1 chance a hit freezes solid. Ball x Pit Freeze. */
  freeze: number;
  /** BLIND. 0..1 chance a hit blinds. Ball x Pit Light. */
  blind: number;
  /** CHARM. 0..1 chance a hit turns the target against its own side. Ball x Pit Charm. */
  charm: number;
  /** SLOW. 0..1 of a target's speed a hit removes. Ball x Pit Wind. */
  slow: number;
  /** CHAIN. Nearby bodies a hit arcs to. Ball x Pit Lightning. */
  chain: number;
  /** Damage each arc deals. */
  chainDamage: number;
  /** QUAKE. Damage dealt to everything within `quakeRadius` of a hit. Ball x Pit Earthquake. */
  quake: number;
  /** That radius, px. */
  quakeRadius: number;
  /** LANCE. Damage dealt to everything on a line through a hit. Ball x Pit Laser. */
  lance: number;
  /** How far that line reaches either side of the hit, px. */
  lanceRange: number;
  /** LEECH. 0..1 chance a hit heals the player one point. Ball x Pit Vampire. */
  leech: number;
  /** SPLIT. Times a bolt may split into a clone on hitting. Ball x Pit Cell. */
  split: number;
  /** BURST. Lesser bolts a bolt scatters when it lands. Ball x Pit Egg Sac. */
  burst: number;
  /** BROOD. 0..1 chance a hit sends out a hunting helper. Ball x Pit Brood Mother. */
  brood: number;
  /** ERODE. 0..1 of a bolt's damage lost per body it passes through. Ball x Pit Stone. */
  erode: number;
  /** Floor on the eroded damage, as a fraction of the bolt's original. */
  erodeFloor: number;
  /** ACCEL. Fractional speed a bolt gains off every wall. Ball x Pit Flesh. */
  accel: number;
  /** GHOST. 1 means a bolt passes through bodies instead of being consumed. Ball x Pit Ghost. */
  ghost: number;
  /** HOLD. Seconds of freeze a dropped field renews on whatever stands in it. Ball x Pit Time. */
  hold: number;
  /** HEAVY. Multiplier on an activation's damage; its bolts travel slower by the same. Ball x Pit Iron. */
  heavy: number;
  /** DARK. Multiplier on an activation's damage; the weapon then goes silent. Ball x Pit Dark. */
  dark: number;
  /** Seconds a dark weapon is silent after its bolt lands. */
  darkCooldown: number;
}

export function noProps(): Props {
  return {
    burn: 0,
    burnStack: 0,
    poison: 0,
    poisonStack: 0,
    bleed: 0,
    bleedStack: 0,
    freeze: 0,
    blind: 0,
    charm: 0,
    slow: 0,
    chain: 0,
    chainDamage: 0,
    quake: 0,
    quakeRadius: 0,
    lance: 0,
    lanceRange: 0,
    leech: 0,
    split: 0,
    burst: 0,
    brood: 0,
    erode: 0,
    erodeFloor: 0,
    accel: 0,
    ghost: 0,
    hold: 0,
    heavy: 0,
    dark: 0,
    darkCooldown: 0,
  };
}

/**
 * The named properties, and which `Props` fields carry each one.
 *
 * EXPORTED BECAUSE THE GATE MUST NOT HOLD ITS OWN COPY. `tools/propfire.mjs`
 * has to know that `burn` and `burnStack` are one property with one counter,
 * and a second copy of this table over there would lie the day a field moved
 * between two properties — AGENTS.md §3, the `tools/contrast.mjs` lesson.
 * `World.propFires` is keyed by exactly these names.
 */
export const PROPERTIES = {
  burn: ['burn', 'burnStack'],
  poison: ['poison', 'poisonStack'],
  bleed: ['bleed', 'bleedStack'],
  freeze: ['freeze'],
  blind: ['blind'],
  charm: ['charm'],
  slow: ['slow'],
  chain: ['chain', 'chainDamage'],
  quake: ['quake', 'quakeRadius'],
  lance: ['lance', 'lanceRange'],
  leech: ['leech'],
  split: ['split'],
  burst: ['burst'],
  brood: ['brood'],
  erode: ['erode', 'erodeFloor'],
  accel: ['accel'],
  ghost: ['ghost'],
  hold: ['hold'],
  heavy: ['heavy'],
  dark: ['dark', 'darkCooldown'],
} as const satisfies Record<string, readonly (keyof Props)[]>;

export type PropName = keyof typeof PROPERTIES;

/** Every property name, in table order. */
export const PROPERTY_NAMES = Object.keys(PROPERTIES) as PropName[];

/**
 * The per-effect constants: durations, caps and the two multipliers.
 *
 * Here rather than in twenty stat blocks. A duration that appears once cannot
 * drift, and the twenty rows below are then genuinely one number each — which
 * is what "the property IS the weapon" has to mean if it is to mean anything.
 *
 * The RATIOS are Ball x Pit's, read off the wiki; the absolute numbers are
 * this game's. Burn is short and stacks three; poison is long and stacks five,
 * so poison is the patient one. Bleed stacks eight and pays on contact, so it
 * belongs to the fastest weapon in the set. Freeze is rare, long and makes the
 * target softer, which is the whole reason a 4% chance is worth carrying.
 */
export const PROP = {
  /** Seconds a burn stack lasts; every fresh stack refreshes the whole timer. */
  burnTime: 3,
  /** Burn stacks a target may carry. */
  burnMax: 3,
  poisonTime: 6,
  poisonMax: 5,
  /** Seconds a bleed sits on a target before it clots. */
  bleedTime: 5,
  bleedMax: 8,
  /** Seconds a freeze holds. */
  freezeTime: 2.2,
  /** Damage multiplier on a frozen target. Ball x Pit: +25%. */
  freezeVuln: 1.25,
  /** Seconds a slow lasts. */
  slowTime: 5,
  /** Seconds a blind lasts. */
  blindTime: 3,
  /** 0..1 of a blinded enemy's attacks that miss. */
  blindMiss: 0.5,
  /** Seconds a charm lasts. */
  charmTime: 5,
  /** Damage per second a charmed enemy deals to the ones around it. */
  charmDps: 26,
  /**
   * How close a charmed body has to get before it can hurt what it is
   * fighting, px, on top of both radii.
   *
   * Small on purpose: it CLOSES now (`World.CHARM_SPEED`), so this is a
   * contact range rather than an aura, and a turncoat that damaged everything
   * within a screen would be a second weapon rather than a defector.
   */
  charmRadius: 26,
  /** Seconds between two status applications from one lingering field. */
  fieldTick: 0.3,
  /**
   * Seconds before a weapon's TUTTI burst may scatter again.
   *
   * Ball x Pit's Egg Sac carries a 3s cooldown and this is that number kept.
   * Without it a scatter-on-contact weapon scatters on every contact of every
   * bolt, which is not a stronger weapon, it is a pool overflow with a card.
   */
  burstCooldown: 3,
} as const;

/**
 * Fold two property sets into one. Bigger wins, field by field.
 *
 * THIS IS THE JOINT THE NEXT PHASE IS BUILT ON. Sixty authored fusions each
 * inherit both parents' properties and add their own; that is this function
 * called twice. It is a `Math.max` rather than a sum because two burns should
 * be the hotter burn and not double burn — stacking is expressed by
 * `burnStack`, which is a property in its own right and can be authored up
 * deliberately.
 */
export function mergeProps(a: Props, b: Partial<Props>): Props {
  const out = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof Props, number][]) {
    if (typeof v !== 'number') continue;
    if (v > out[k]) out[k] = v;
  }
  return out;
}

/**
 * Property fields where a SMALLER positive number is the STRONGER version, so
 * a ladder that moves them downward is an improvement rather than a
 * regression.
 *
 * Two of them, and both are counter-intuitive enough that a check without this
 * list reports a real improvement as a bug — which it did, on the first run of
 * `tools/propfire.mjs`: GRAVEL's erode goes 0.4 -> 0.32 -> 0.25 because the
 * stone KEEPS more of itself at higher levels, and NOCTURNE's silence goes 3s
 * -> 2.4s -> 1.8s because a miss costs you less.
 *
 * Exported for the same reason `RULE_LOWER_IS_STRONGER` is: a copy of this
 * list inside the gate would lie by declaring a real regression to be an
 * improvement the day somebody moved a field between the two categories.
 * AGENTS.md §3.
 */
export const PROP_LOWER_IS_STRONGER: readonly (keyof Props)[] = ['erode', 'darkCooldown'];

/** True if any property at all is present. Used to skip work, and to gate a control. */
export function hasProps(p: Props): boolean {
  for (const k of Object.keys(p) as (keyof Props)[]) if (p[k] !== 0) return true;
  return false;
}

export interface RigDef {
  id: RigId;
  label: string;
  /**
   * Three entries, one per level. Each is the *cumulative* modifier at that
   * level, so entry 3 is the ceiling and not a delta on top of entry 2.
   *
   * `tools/levelup.mjs` asserts both arrays are exactly `RIG_MAX_LEVEL` long,
   * so the length tracks the constant instead of being a second copy of it.
   *
   * A RULE PASSIVE MAY LEAVE ENTRIES EMPTY. LASER and HOMING carry `{}` on all
   * three rungs, which is the honest statement that they move no global number
   * — their whole ladder is in `rules`. The four other re-pointed items keep
   * the ONE modifier field that nothing else feeds, held flat at its old
   * level-1 value: dropping it would have orphaned `linger`, `moveSpeed`,
   * `maxHp` and `enemyTime` and taken their consumers in `world.ts` dead with
   * them, which is a worse defect than a passive with a small number on it.
   */
  levels: readonly Partial<Modifiers>[];
  /**
   * Three entries, one per level, cumulative exactly as `levels` is. Absent
   * for the six passives that are still pure numbers.
   *
   * `tools/levelup.mjs` asserts this is either absent or `RIG_MAX_LEVEL` long,
   * and `tools/rulefire.mjs` asserts that every rule declared here actually
   * FIRES in a real run — a rule installed and never triggered is the same
   * defect as a stat nothing reads, and it is a likelier one.
   */
  rules?: readonly Partial<Rules>[];
  /** Per-level player-facing notes, three entries. */
  notes: readonly string[];
  blurb: string;
  character: string;
  weight: number;
  /** True for the six that already exist as powerups and already have a voice. */
  legacy?: boolean;
}

/* ------------------------------------------------------------------------ *
 * THE TWENTY BASES
 *
 * ---------------------------------------------------------------------------
 * ONE WEAPON, ONE PROPERTY. That is the whole organising rule, and it is taken
 * from Ball x Pit rather than invented — `docs/plan-refactor-3.md` §9c maps
 * every row below to the ball it comes from. Three previous rosters were
 * rejected (fourteen delivery shapes, a family x element grid, sixteen invented
 * weapons) and the common fault in all three was that the weapon's identity
 * lived in its GEOMETRY. Here it lives in what the hit leaves behind.
 *
 * TWELVE OF THE TWENTY ARE EXISTING IDS RE-POINTED. `pizzicato` is RASP,
 * `snare` is SWELL, `chime` is GLASS, and so on down. Every one keeps its
 * `ENSEMBLE_MIX` lane, its per-id shot voice in `audio/sfx.ts` and its place in
 * `layers.ts`; only the mechanic moved. That is AGENTS.md §5's one free move —
 * change what a card is WORTH — and it is why this pass costs eight new cards
 * in the offer rather than twenty.
 *
 * TWELVE OF THE TWENTY DELIVER WITH `seek`, WHICH IS THE POINT AND NOT LAZINESS.
 * Ball x Pit reaches ~7,921 combinations because every ball launches the same
 * way; uniform delivery is what lets properties compose without a
 * combinatorial explosion of firing code. A roster where every weapon has its
 * own geometry is a roster where every FUSION needs its own geometry too, and
 * that is the wall the last two passes hit. The other eight are spread over the
 * six surviving shapes so the screen still tells you what is firing.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS. Every base is written to roughly 30-40 nominal damage per second
 * at level 1 and 110-200 at level 3, which is the band the previous roster
 * occupied (METRONOME ran 36.3 / 72.5 / 208). Ball x Pit's own damage figures
 * are meaningless here and are NOT copied; what is carried across is each
 * effect's shape — stack counts, durations, chances and ratios — which lives in
 * `PROP` rather than in twenty stat blocks.
 *
 * CARD TEXT LEADS WITH THE MECHANIC. `docs/plan-refactor-3.md` §4: damage
 * number, then effect, then flavour, and no poetry above the numbers. Every
 * `blurb` and every `steps[].note` below is written in that order, and
 * `tools/levelup.mjs` holds them to a 131-character card.
 * ------------------------------------------------------------------------ */

function stats(p: Partial<InstrumentStats>): InstrumentStats {
  return {
    interval: 1,
    count: 1,
    damage: 4,
    area: 0,
    arc: 0,
    speed: 0,
    pierce: 1,
    bounces: 0,
    linger: 0,
    range: 0,
    ...p,
  };
}

export const INSTRUMENTS: readonly InstrumentDef[] = [
  /* ---------------------------------------------------------------- burn */
  {
    id: 'ember',
    label: 'EMBER',
    shape: 'seek',
    weight: 1.0,
    blurb: '9 dmg x2 · each hit sets 1 burn stack, 7/s for 3s, up to 3 stacks. Coals thrown at whatever is nearest.',
    character: 'aggressive — coals spat, dry and crackling',
    base: stats({ interval: 0.5, count: 2, damage: 9, speed: 900, range: 620 }),
    props: { burn: 7, burnStack: 1 },
    steps: [
      {
        note: '12 dmg x3 · burn bites 10/s a stack — three stacks on one target is 30/s for as long as it lives',
        add: { count: 1 },
        mul: { damage: 1.35 },
        prop: { burn: 10 },
      },
      {
        note: '17 dmg x4 · every coal now lands TWO stacks, so one hit takes a target most of the way to its cap',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { burn: 14, burnStack: 2 },
      },
    ],
  },
  /* -------------------------------------------------------------- freeze */
  {
    id: 'chime',
    label: 'GLASS',
    shape: 'seek',
    weight: 1.0,
    blurb: '5 dmg x2, fast · 5% of hits freeze solid for 2.2s, and a frozen target takes 25% more from everything.',
    character: 'shimmering — thin struck glass, a long ring',
    base: stats({ interval: 0.28, count: 2, damage: 5, speed: 1000, range: 560 }),
    props: { freeze: 0.05 },
    steps: [
      {
        note: '7 dmg x3 · 8% to freeze. More shards in the air is more rolls, which is the only way this weapon scales',
        add: { count: 1 },
        mul: { damage: 1.35 },
        prop: { freeze: 0.08 },
      },
      {
        note: '11 dmg x4 · 12% to freeze. At four shards a pack loses something to the ice about once a second',
        add: { count: 1 },
        mul: { damage: 1.55 },
        prop: { freeze: 0.12 },
      },
    ],
  },
  /* -------------------------------------------------------------- poison */
  {
    id: 'tremolo',
    label: 'DETUNE',
    shape: 'field',
    weight: 0.95,
    blurb: '52 dmg pool for 3s · anything standing in it takes a poison stack, 5/s each, to 5 stacks over 6s.',
    character: 'eerie — a beating, out-of-tune unison',
    base: stats({ interval: 1.6, count: 1, damage: 52, area: 130, linger: 3 }),
    props: { poison: 5, poisonStack: 1 },
    steps: [
      {
        note: 'two pools per drop, sharing the damage · poison bites 7/s a stack — twice the ground, same hit',
        add: { count: 1 },
        mul: { area: 1.1 },
        prop: { poison: 7 },
      },
      {
        note: 'three pools, 5s each · poison 10/s a stack, so a full five stacks is 50/s on anything that lingers',
        add: { count: 1 },
        mul: { linger: 1.7, damage: 1.3 },
        prop: { poison: 10 },
      },
    ],
  },
  /* --------------------------------------------------------------- bleed */
  {
    id: 'pizzicato',
    label: 'RASP',
    shape: 'arc',
    beat: 'offbeat',
    weight: 1.0,
    blurb: '3 dmg x4 at close range · 2 bleed stacks a hit to 8; every stack costs the target 2 more per hit.',
    character: 'mechanical — a bow scraped across the bridge',
    /*
     * 300px, AND 210 WAS A BUG RATHER THAN A CHOICE.
     *
     * `Enemy.standoff` defaults to 240: everything that is not a rammer holds
     * a ring at that distance and works the tangent. A 210px weapon therefore
     * could not reach the majority of the roster AT ALL — it was not a
     * short-range trade, it was a weapon that only hit things already touching
     * you. `tools/openers.mjs` found it from the outside: RASP reached 61% of
     * the best opener's wave against a 70% floor.
     *
     * 300 is still by a distance the shortest reach in the roster (the next is
     * SWELL's 520) and still means diving into a pack, which is the identity.
     * It is now outside the standoff ring rather than inside it.
     */
    base: stats({ interval: 0.22, count: 4, damage: 3, arc: 0.8, speed: 900, range: 300 }),
    props: { bleed: 2, bleedStack: 2 },
    steps: [
      {
        note: '4 dmg x6, wider · bleed pays 3 a stack, so a target at full stacks loses 24 on every single hit',
        add: { count: 2 },
        mul: { damage: 1.3, arc: 1.25 },
        prop: { bleed: 3 },
      },
      {
        note: '6 dmg x8, reaching further · bleed pays 4 a stack. Nothing in the game rewards fire rate more',
        add: { count: 2 },
        mul: { damage: 1.35, range: 1.5 },
        prop: { bleed: 4 },
      },
    ],
  },
  /* --------------------------------------------------------------- chain */
  {
    id: 'feedback',
    label: 'ARC',
    shape: 'seek',
    weight: 0.95,
    blurb: '20 dmg · the hit arcs on to 3 more bodies nearby for 9 each. Worthless against one thing, murder in a crowd.',
    character: 'aggressive — a squealing feedback loop',
    base: stats({ interval: 0.75, count: 1, damage: 20, speed: 1100, range: 640 }),
    props: { chain: 3, chainDamage: 9 },
    steps: [
      {
        note: '28 dmg · arcs to 4 for 14 each. A packed group takes 84 from one bolt where a lone shape takes 42',
        mul: { damage: 1.4 },
        prop: { chain: 4, chainDamage: 14 },
      },
      {
        note: '39 dmg x2 · each bolt arcs to 5 for 20. Two bolts into a wall of bodies is ten separate arcs',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { chain: 5, chainDamage: 20 },
      },
    ],
  },
  /* ---------------------------------------------------------------- slow */
  {
    id: 'snare',
    label: 'SWELL',
    shape: 'lance',
    weight: 0.95,
    blurb: '30 dmg/s in a held line along your heading · everything in it loses 30% of its speed for 5s.',
    character: 'mechanical — a rising wash of noise',
    base: stats({ interval: 0.5, count: 1, damage: 15, area: 13, linger: 0.6, range: 520 }),
    props: { slow: 0.3 },
    steps: [
      {
        note: 'two parallel lines, reaching 40% further · the drag deepens to 45%, which is most of a shape’s charge',
        add: { count: 1 },
        mul: { damage: 1.25, range: 1.4 },
        prop: { slow: 0.45 },
      },
      {
        note: 'three lines, thicker, held longer · 60% slower. A wall of bodies walks into it and effectively stops',
        add: { count: 1 },
        mul: { damage: 1.35, area: 1.5, linger: 1.4 },
        prop: { slow: 0.6 },
      },
    ],
  },
  /* --------------------------------------------------------------- ghost */
  {
    id: 'phantom',
    label: 'PHANTOM',
    shape: 'seek',
    weight: 0.9,
    blurb: '14 dmg x2 · the bolts are not consumed by what they hit. One shot crosses the whole arena through everything.',
    character: 'eerie — a voice with no body behind it',
    base: stats({ interval: 0.85, count: 2, damage: 14, speed: 820, range: 1400, pierce: 99 }),
    props: { ghost: 1 },
    steps: [
      {
        note: '20 dmg x3, faster · three lines drawn through a column of enemies instead of two',
        add: { count: 1 },
        mul: { damage: 1.4, speed: 1.2 },
        prop: { ghost: 1 },
      },
      {
        note: '30 dmg x4 · four bolts that stop for nothing. Line the pack up and every one of them is hit four times',
        add: { count: 1 },
        mul: { damage: 1.5 },
        prop: { ghost: 1 },
      },
    ],
  },
  /* --------------------------------------------------------------- heavy */
  {
    id: 'anvil',
    label: 'ANVIL',
    shape: 'seek',
    weight: 0.9,
    blurb: '60 dmg in one slow bolt · double damage for 40% less speed. You watch it travel, and so does the target.',
    character: 'heavy — struck metal, no decay worth speaking of',
    base: stats({ interval: 1.5, count: 1, damage: 30, speed: 900 }),
    props: { heavy: 2 },
    steps: [
      {
        note: '96 dmg · the weight goes to x2.4, which takes the speed down with it. One bolt kills most things outright',
        mul: { damage: 1.33 },
        prop: { heavy: 2.4 },
      },
      {
        note: '176 dmg x2 · two of them, at x2.75 weight. Slower than anything else in the game and it does not matter',
        add: { count: 1 },
        mul: { damage: 1.6 },
        prop: { heavy: 2.75 },
      },
    ],
  },
  /* --------------------------------------------------------------- erode */
  {
    id: 'gravel',
    label: 'GRAVEL',
    shape: 'seek',
    weight: 0.9,
    blurb: '36 dmg on the first body, then 40% less on each one after, down to a floor of 18. It never stops travelling.',
    character: 'heavy — grit dragged over a drum head',
    base: stats({ interval: 1.0, count: 1, damage: 36, speed: 700, range: 760, pierce: 99 }),
    props: { erode: 0.4, erodeFloor: 0.5 },
    steps: [
      {
        note: '50 dmg, wearing down 32% a body · the stone keeps more of itself, so the fourth target still feels it',
        mul: { damage: 1.4 },
        prop: { erode: 0.32, erodeFloor: 0.5 },
      },
      {
        note: '70 dmg x2, wearing 25% a body and never below 60% · two stones through a column is eight or ten hits',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { erode: 0.25, erodeFloor: 0.6 },
      },
    ],
  },
  /* ---------------------------------------------------------------- dark */
  {
    id: 'nocturne',
    label: 'NOCTURNE',
    shape: 'seek',
    weight: 0.85,
    blurb: '120 dmg in one bolt · triple damage, and the weapon goes silent for 3s the moment it lands.',
    character: 'mournful — a low held tone, nothing above it',
    base: stats({ interval: 0.6, count: 1, damage: 40, speed: 950, range: 780 }),
    props: { dark: 3, darkCooldown: 3 },
    steps: [
      {
        note: '198 dmg · x3.3 weight and the silence drops to 2.4s. A miss now costs you noticeably less',
        mul: { damage: 1.65 },
        prop: { dark: 3.3, darkCooldown: 2.4 },
      },
      {
        note: '396 dmg x2 · two bolts at x3.6, silent for 1.8s after. The largest single number in the game',
        add: { count: 1 },
        mul: { damage: 1.83 },
        prop: { dark: 3.6, darkCooldown: 1.8 },
      },
    ],
  },
  /* --------------------------------------------------------------- blind */
  {
    id: 'nova',
    label: 'GLARE',
    shape: 'aura',
    beat: 'halfbar',
    swell: 'danger',
    weight: 0.9,
    blurb: '44 dmg in a ring on the beat · blinds for 3s, and a blinded enemy misses half of what it throws.',
    character: 'aggressive — a hard flash of white noise',
    base: stats({ interval: 0.6, count: 1, damage: 44, area: 210, linger: 0.25 }),
    props: { blind: 0.55 },
    steps: [
      {
        note: '62 dmg, half again as wide · 75% of what the ring touches is blinded rather than half of it',
        mul: { damage: 1.4, area: 1.45 },
        prop: { blind: 0.75 },
      },
      {
        note: '99 dmg in two rings that hang before fading · everything caught is blinded, with no roll at all',
        add: { count: 1 },
        mul: { damage: 1.6, linger: 2.2 },
        prop: { blind: 1 },
      },
    ],
  },
  /* ---------------------------------------------------------------- hold */
  {
    id: 'blackhole',
    label: 'FERMATA',
    shape: 'field',
    weight: 0.85,
    blurb: '40 dmg over 8s in a 190px snare · everything standing in it is held fast, and takes 25% more while it is.',
    character: 'eerie — one chord, suspended, refusing to resolve',
    base: stats({ interval: 4.0, count: 1, damage: 40, area: 190, linger: 8 }),
    props: { hold: 0.6 },
    steps: [
      {
        note: 'a 240px snare lasting 12s · the hold clings for 0.9s after a shape walks out of it',
        mul: { area: 1.26, linger: 1.5, damage: 1.4 },
        prop: { hold: 0.9 },
      },
      {
        note: 'two snares, 16s each · with the interval down to 3s you can have three of them on the field at once',
        add: { count: 1 },
        mul: { linger: 1.33, damage: 1.5, interval: 0.75 },
        prop: { hold: 1.2 },
      },
    ],
  },
  /* --------------------------------------------------------------- leech */
  {
    id: 'siphon',
    label: 'SIPHON',
    shape: 'seek',
    weight: 0.9,
    blurb: '6 dmg x2, quick · 5% of hits give you a point of health back. The only weapon that pays you.',
    character: 'mournful — a slow drawn breath in',
    base: stats({ interval: 0.34, count: 2, damage: 6, speed: 900, range: 600 }),
    props: { leech: 0.05 },
    steps: [
      {
        note: '8 dmg x3 · 8% of hits heal. Three bolts a third of a second means the roll comes round constantly',
        add: { count: 1 },
        mul: { damage: 1.35 },
        prop: { leech: 0.08 },
      },
      {
        note: '12 dmg x4 · 12% of hits heal. Against a full screen this out-heals most of what the screen does to you',
        add: { count: 1 },
        mul: { damage: 1.5 },
        prop: { leech: 0.12 },
      },
    ],
  },
  /* --------------------------------------------------------------- split */
  {
    id: 'echoes',
    label: 'CANON',
    shape: 'seek',
    weight: 0.9,
    blurb: '18 dmg · every bolt splits off a clone of itself where it lands, twice. One shot becomes three.',
    character: 'shimmering — the same figure entering late',
    base: stats({ interval: 0.9, count: 1, damage: 18, speed: 880, range: 700 }),
    props: { split: 2 },
    steps: [
      {
        note: '25 dmg, splitting three times · one bolt into a crowd leaves four travelling out of it',
        mul: { damage: 1.4 },
        prop: { split: 3 },
      },
      {
        note: '35 dmg x2, splitting four times · two bolts in, ten out. The screen fills with your own answer',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { split: 4 },
      },
    ],
  },
  /* --------------------------------------------------------------- burst */
  {
    id: 'harp',
    label: 'TUTTI',
    shape: 'seek',
    weight: 0.9,
    blurb: '34 dmg · scatters 3 lesser bolts where it lands, at most once every 3s. The whole band answers at once.',
    character: 'shimmering — everyone in, on the same beat',
    base: stats({ interval: 1.6, count: 1, damage: 34, speed: 860, range: 660 }),
    props: { burst: 3 },
    steps: [
      {
        note: '48 dmg · four lesser bolts a burst instead of three, and they carry a third of the parent’s hit',
        mul: { damage: 1.4 },
        prop: { burst: 4 },
      },
      {
        note: '67 dmg x2 · six lesser bolts a burst, from either parent. A single activation puts fourteen shots out',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { burst: 6 },
      },
    ],
  },
  /* --------------------------------------------------------------- brood */
  {
    id: 'drones',
    label: 'ENSEMBLE',
    shape: 'orbit',
    weight: 0.9,
    blurb: '9 dmg a shot from 2 circling pods · 25% of hits send out a helper that hunts on its own for 4s.',
    character: 'eerie — a pedal tone that will not go away',
    // No `linger`: `firePods` does not read it (`tools/deadhunt-ranges.mjs`
    // reports it as a dead stat), and the helper's lifetime is
    // `World.BROOD_LIFE` because a helper is a PROPERTY's output rather than
    // this instrument's geometry.
    base: stats({ interval: 0.5, count: 2, damage: 9, area: 78, speed: 900, range: 620 }),
    props: { brood: 0.25 },
    steps: [
      {
        note: '13 dmg from 3 pods on a wider ring · 35% of hits send a helper instead of a quarter of them',
        add: { count: 1 },
        mul: { damage: 1.45, area: 1.3 },
        prop: { brood: 0.35 },
      },
      {
        note: '19 dmg from 4 pods · half of every hit sends a helper. The screen is more yours than theirs',
        add: { count: 1 },
        mul: { damage: 1.45 },
        prop: { brood: 0.5 },
      },
    ],
  },
  /* --------------------------------------------------------------- quake */
  {
    id: 'timpani',
    label: 'TIMPANI',
    shape: 'strike',
    beat: 'bar',
    swell: 'silence',
    weight: 0.9,
    blurb: '30 dmg where it lands on the downbeat · and 40 more to everything within 200px. Hardest out of silence.',
    character: 'heavy — a struck head, all body and no edge',
    base: stats({ interval: 0.9, count: 1, damage: 30, area: 120, range: 560 }),
    props: { quake: 40, quakeRadius: 200 },
    steps: [
      {
        note: 'two strikes a bar, 42 each · the shock behind them reaches 260px and hits for 62',
        add: { count: 1 },
        mul: { damage: 1.4, area: 1.2 },
        prop: { quake: 62, quakeRadius: 260 },
      },
      {
        note: 'three strikes, on the one and the three · 59 each, with a 330px shock hitting for 96 behind every one',
        beat: 'halfbar',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { quake: 96, quakeRadius: 330 },
      },
    ],
  },
  /* --------------------------------------------------------------- accel */
  {
    id: 'accelerando',
    label: 'ACCELERANDO',
    shape: 'arc',
    weight: 0.9,
    blurb: '10 dmg x2 thrown off the walls · every wall a bolt comes off makes it 25% faster, and it keeps them.',
    character: 'mechanical — a click track pulling ahead',
    base: stats({ interval: 0.7, count: 2, damage: 10, arc: 0.5, speed: 620, bounces: 6 }),
    props: { accel: 0.25 },
    steps: [
      {
        note: '14 dmg x3, bouncing 9 times · each wall now adds 35%, so a corner shot comes back through you very fast',
        add: { count: 1, bounces: 3 },
        mul: { damage: 1.4 },
        prop: { accel: 0.35 },
      },
      {
        note: '20 dmg x4, bouncing 13 times at +45% a wall · the arena fills with your own ricochets and they never slow',
        add: { count: 1, bounces: 4 },
        mul: { damage: 1.4 },
        prop: { accel: 0.45 },
      },
    ],
  },
  /* --------------------------------------------------------------- lance */
  {
    id: 'bow',
    label: 'LANCE',
    shape: 'seek',
    weight: 0.95,
    blurb: '10 dmg · and 22 to everything on a 420px line straight through what it hits. Line them up.',
    character: 'aggressive — one thin sustained edge',
    base: stats({ interval: 0.9, count: 1, damage: 10, speed: 1300, range: 900 }),
    props: { lance: 22, lanceRange: 420 },
    steps: [
      {
        note: '14 dmg · the line carries 32 and reaches 540px. Against a column this is the highest damage in the game',
        mul: { damage: 1.4 },
        prop: { lance: 32, lanceRange: 540 },
      },
      {
        note: '20 dmg x2 · two lines, 46 each, reaching 680px. Two shots can cut a wave in half twice over',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { lance: 46, lanceRange: 680 },
      },
    ],
  },
  /* --------------------------------------------------------------- charm */
  {
    id: 'charm',
    label: 'DUET',
    shape: 'seek',
    weight: 0.85,
    blurb: '12 dmg · 5% of hits turn a shape against its own side for 5s. It fights for you and cannot touch you.',
    character: 'shimmering — two voices agreeing for once',
    base: stats({ interval: 0.4, count: 1, damage: 12, speed: 950, range: 620 }),
    props: { charm: 0.05 },
    steps: [
      {
        note: '17 dmg x2 · 8% of hits charm, and twice the bolts is twice the rolls. Expect one turncoat at all times',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { charm: 0.08 },
      },
      {
        note: '24 dmg x3 · 12% of hits charm. On a full screen you are running a second wave against the first',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { charm: 0.12 },
      },
    ],
  },

  /* ------------------------------------------------------------------ *
   * THE RESULTS — twenty-one evolutions and two unions.
   *
   * Never drafted: `progression.ts` skips `def.fused` when it builds the pool,
   * so every row below is free in offer terms (AGENTS.md §5). They are seated
   * at `FUSED_MAX_LEVEL` on arrival and carry no steps.
   *
   * TWENTY-ONE BECAUSE THERE ARE TWENTY BASES. `tools/levelup.mjs` fails any
   * instrument with no evolution — "a dead end to commit to" — so the recipe
   * count follows the roster size rather than taste. RASP branches, which is
   * the one place a base has two endings.
   *
   * SIX OF THEM EXIST TO KEEP A SHAPE ALIVE. INTERLUDE (`rest`), ADAGIO
   * (`drag`), REVENANT (`ghost`), FUGUE (`counterpoint`), MAESTRO (`unison`)
   * and SORDINO (`tacet`) are `docs/plan-items-v2.md`'s second axis — items
   * that change a rule rather than where a hitbox appears. None of the twenty
   * property weapons is one, so without these rows six working shapes and the
   * `tools/builds.mjs` spread they produce would have gone dark. Their stat
   * blocks are the previous roster's, lifted rather than re-derived.
   * ------------------------------------------------------------------ */
  {
    id: 'spiccato',
    label: 'SPICCATO',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '9 dmg x9 · 3 bleed stacks a hit, and the bolts come off the walls twice.',
    character: 'aggressive — bounced bow, very short',
    base: stats({ interval: 0.15, count: 9, damage: 9, speed: 1500, pierce: 3, bounces: 2, range: 900 }),
    props: { bleed: 5, bleedStack: 3 },
    steps: [],
  },
  {
    id: 'snap',
    label: 'SNAP',
    shape: 'seek',
    fused: true,
    weight: 0,
    /*
     * THE ONE WEAPON IN THE TABLE THAT CARRIES NO PROPERTY, DELIBERATELY.
     *
     * Two reasons, and the second is why it is written down. `levelup.mjs`
     * refuses a rig where every passive is a rule, on the grounds that an
     * ecosystem in which everything is special is as flat as one in which
     * nothing is; the same argument applies here, and a single enormous
     * unadorned bolt is the baseline every property reads as a departure from.
     *
     * And it is `tools/propfire.mjs`' CONTROL. That check's whole weight rests
     * on a run that produces every moment — hits, kills, volleys, bounces —
     * and fires no property at all, because without one a counter incremented
     * one line too high would pass every other row for free. A property-free
     * weapon that still kills things is the only way to build that run without
     * the tool reaching in and mutating the table it is auditing.
     *
     * It is a FUSION RESULT, so it is never drafted: the rule that every
     * DRAFTABLE instrument carries a property is not weakened by this row.
     */
    blurb: '96 dmg in one enormous pluck · no effect at all, and it punches through five.',
    character: 'aggressive — a string pulled clear and let go',
    base: stats({ interval: 1.15, count: 1, damage: 96, speed: 1750, pierce: 5, range: 1000 }),
    steps: [],
  },
  {
    id: 'blastbeat',
    label: 'BLAST BEAT',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '26 dmg a stroke, six strokes around the compass · everything caught is slowed 60%.',
    character: 'mechanical — a blast beat, relentless',
    base: stats({ interval: 0.26, count: 6, damage: 26, area: 210, arc: 2.4, range: 240 }),
    props: { slow: 0.6 },
    steps: [],
  },
  {
    id: 'harmonics',
    label: 'HARMONICS',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '46 dmg/s in three parallel held beams · 55% slow on anything standing in them.',
    character: 'mournful — flageolet tones, glassy',
    base: stats({ interval: 0.46, count: 3, damage: 21, area: 15, linger: 0.9, range: 780 }),
    props: { slow: 0.55 },
    steps: [],
  },
  {
    id: 'carillon',
    label: 'CARILLON',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '34 dmg a strike, four of them · each arcs to 5 more for 26, and 18% of hits freeze.',
    character: 'shimmering — bells chaining into each other',
    base: stats({ interval: 0.55, count: 4, damage: 34, area: 170, range: 900 }),
    props: { chain: 5, chainDamage: 26, freeze: 0.18 },
    steps: [],
  },
  {
    id: 'crossstrung',
    label: 'CROSS-STRUNG',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '15 dmg x14 in a bouncing fan · 5 burst bolts wherever one lands.',
    character: 'shimmering — a harp strung both ways at once',
    base: stats({ interval: 0.34, count: 14, damage: 15, arc: 6.28, speed: 820, bounces: 3, range: 900 }),
    props: { burst: 5 },
    steps: [],
  },
  {
    id: 'chorale',
    label: 'CHORALE',
    shape: 'orbit',
    fused: true,
    weight: 0,
    blurb: '30 dmg from six pods holding station · 60% of hits send a helper out to hunt.',
    character: 'mournful — a chorale, four parts, held',
    base: stats({ interval: 0.4, count: 6, damage: 30, area: 150, speed: 640, range: 700 }),
    props: { brood: 0.6 },
    steps: [],
  },
  {
    id: 'cathedral',
    label: 'CATHEDRAL',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '130 dmg in a 520px ring that hangs · everything inside is blinded outright.',
    character: 'mournful — a vast slow room',
    base: stats({ interval: 1.1, count: 2, damage: 130, area: 520, linger: 0.8 }),
    props: { blind: 1 },
    steps: [],
  },
  {
    id: 'downbeat',
    label: 'DOWNBEAT',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '220 dmg well, thrown, that eats bullets · and holds whatever falls into it.',
    character: 'heavy — the one, landed on hard',
    base: stats({ interval: 6.5, count: 2, damage: 220, area: 330, linger: 5 }),
    props: { hold: 1.2 },
    steps: [],
  },
  {
    id: 'wallofsound',
    label: 'WALL OF SOUND',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '22 dmg x16 at close range · every hit sets two burn stacks at 16/s.',
    character: 'aggressive — a wall of amplifiers',
    base: stats({ interval: 0.2, count: 16, damage: 22, arc: 1.5, speed: 980, range: 330 }),
    props: { burn: 16, burnStack: 2 },
    steps: [],
  },
  {
    id: 'canon',
    label: 'STRETTO',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '30 dmg x5 off the walls · splitting five times, and 40% faster off every wall.',
    character: 'shimmering — entries stacked on top of each other',
    base: stats({ interval: 0.42, count: 5, damage: 30, speed: 1150, bounces: 6, range: 1000 }),
    props: { split: 5, accel: 0.4 },
    steps: [],
  },
  {
    id: 'tutti',
    label: 'FORTISSIMO',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '90 dmg a strike, three of them · with a 400px shock behind each one for 120.',
    character: 'heavy — everyone, as loud as they can',
    base: stats({ interval: 1.1, count: 3, damage: 90, area: 200, range: 780 }),
    props: { quake: 120, quakeRadius: 400 },
    steps: [],
  },
  {
    id: 'vibrato',
    label: 'VIBRATO',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '150 dmg in four pools · poison 14/s a stack on anything that stands in one.',
    character: 'eerie — a wide, slow vibrato',
    base: stats({ interval: 1.9, count: 4, damage: 150, area: 190, linger: 6 }),
    props: { poison: 14, poisonStack: 2 },
    steps: [],
  },
  {
    id: 'pyre',
    label: 'PYRE',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '70 dmg in a ring twice a second · three burn stacks a hit at 22/s each.',
    character: 'aggressive — a fire that has taken hold',
    base: stats({ interval: 0.5, count: 1, damage: 70, area: 300, linger: 0.4 }),
    props: { burn: 22, burnStack: 3 },
    steps: [],
  },
  {
    id: 'revenant',
    label: 'REVENANT',
    shape: 'ghost',
    fused: true,
    weight: 0,
    blurb: 'The last four things you killed come back and fight for you, at 44 a hit.',
    character: 'eerie — a voice from the other side of the room',
    base: stats({ interval: 0.5, count: 4, damage: 44, speed: 420, linger: 8, range: 700 }),
    props: { ghost: 1 },
    steps: [],
  },
  {
    id: 'maestro',
    label: 'MAESTRO',
    shape: 'unison',
    fused: true,
    weight: 0,
    blurb: 'Your whole band fires together on the bar, at x1.5, with two extra shots each.',
    character: 'heavy — the downbeat, conducted',
    // `area` is unread by `fireUnison` and was a dead stat; see the shape.
    base: stats({ interval: 1, count: 2, damage: 1.5 }),
    props: { heavy: 1.2 },
    steps: [],
  },
  {
    id: 'sordino',
    label: 'SORDINO',
    shape: 'tacet',
    fused: true,
    weight: 0,
    blurb: 'Two lanes of your own soundtrack go out; you get 220 dmg back when they return.',
    character: 'eerie — the mute on, and then off',
    base: stats({ interval: 1, count: 2, damage: 220, area: 380, linger: 2, range: 2 }),
    props: { poison: 10, poisonStack: 2 },
    steps: [],
  },
  {
    id: 'adagio',
    label: 'ADAGIO',
    shape: 'drag',
    fused: true,
    weight: 0,
    blurb: 'Time crawls in a 400px bubble around you — at 55% — and your own guns with it.',
    character: 'mournful — everything, slower',
    // `count: 2` is what switches ENEMY FIRE into the bubble as well as
    // bodies (`World.fireDrag`). At 1 the item slowed movement and left every
    // bullet at full speed, and `tools/beatlock.mjs` read 0 drags over 225
    // activations — the shape's whole identity, installed and never happening.
    base: stats({ interval: 0.5, count: 2, damage: 0.55, area: 400, arc: 1.16, linger: 0.4 }),
    props: { slow: 0.55 },
    steps: [],
  },
  {
    id: 'interlude',
    label: 'INTERLUDE',
    shape: 'rest',
    fused: true,
    weight: 0,
    blurb: 'Two bars where nothing can touch you and your band stops playing. 300px sweep after.',
    character: 'mournful — a rest, and then everyone back in',
    base: stats({ interval: 15, count: 1, damage: 0, area: 300, linger: 2 }),
    props: { leech: 0.4 },
    steps: [],
  },
  {
    id: 'fugue',
    label: 'FUGUE',
    shape: 'counterpoint',
    fused: true,
    weight: 0,
    blurb: 'Every other instrument answers your first one, at 70% weight, with two extra shots.',
    character: 'shimmering — a subject answered at the fifth',
    base: stats({ interval: 0.18, count: 2, damage: 0.7 }),
    props: { split: 1 },
    steps: [],
  },
  {
    id: 'consort',
    label: 'CONSORT',
    shape: 'orbit',
    fused: true,
    weight: 0,
    blurb: '26 dmg from five pods · 22% of hits charm what they touch into fighting for you.',
    character: 'shimmering — a consort of viols, all agreeing',
    base: stats({ interval: 0.35, count: 5, damage: 26, area: 132, speed: 1000, range: 680 }),
    props: { charm: 0.22 },
    steps: [],
  },
  {
    id: 'requiem',
    label: 'REQUIEM',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '210 dmg in a 620px ring · blinds everything, and 30% of hits heal you.',
    character: 'mournful — a requiem, the whole room singing',
    base: stats({ interval: 0.85, count: 3, damage: 210, area: 620, linger: 1.1 }),
    props: { blind: 1, leech: 0.3 },
    steps: [],
  },
  {
    id: 'stringsection',
    label: 'STRING SECTION',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '150 dmg/s in six held beams · a 70% slow and 44 down the line from every contact.',
    character: 'shimmering — massed strings, soaring',
    base: stats({ interval: 0.3, count: 6, damage: 45, area: 18, linger: 1.2, range: 900 }),
    props: { slow: 0.7, lance: 44, lanceRange: 520 },
    steps: [],
  },
];

/* ------------------------------------------------------------------------ *
 * Rig
 *
 * Global multipliers with a character, which is Vampire Survivors' passive
 * design read back as studio gear. Six of the twelve are existing powerups; the
 * ids are unchanged, so every signature already written in `layers.ts` for
 * SPREAD, LASER, HOMING, RAPID, MAGNET and TIMEWARP keeps working. Their labels
 * are unchanged too — a rename would churn the HUD for nothing.
 *
 * `levels[i]` is the *cumulative* modifier at level i+1, not a delta. Deltas
 * read shorter and are worse to reason about: you cannot answer "what does this
 * do at level 4" without folding, and every balance conversation about a
 * passive is exactly that question.
 *
 * ---------------------------------------------------------------------------
 * FIVE RUNGS BECAME THREE, AND THE CEILING DID NOT MOVE.
 *
 * Because these entries are cumulative rather than incremental, shortening the
 * ladder is a re-spacing rather than a re-costing: `levels[2]` below is the old
 * `levels[4]` VERBATIM in all twelve rows, so every passive tops out at exactly
 * the multiplier it topped out at before. The two rungs beneath it are the old
 * entries 2 and 4, which keeps the curve's shape — a modest first pick and a
 * decisive last one — with the middle of the old ladder removed rather than the
 * top. `tools/_maxprobe.mjs` diffs `rigModifiers` for every single item at max
 * and for all twelve at once against a pristine copy of this file, and reports
 * zero drift.
 *
 * What that means in play is that a passive is now WORTH MORE PER PICK and no
 * more at the end. Two picks used to buy old level 2; they now buy old level 4.
 * That is the intended half of the change: the rig is the catalyst, and the
 * catalyst was 5 of the 12 picks every designed fusion cost.
 *
 * THE NOTES WERE REWRITTEN, not truncated. Three of the twelve rows used to
 * read `'+24%'`, `'+180%'`, `'+45% duration'` — a bare number, which the header
 * of this file explicitly calls a step that should be redesigned, and which it
 * only got away with because that rule was written about instruments. With five
 * rungs a bare percentage was at least a legible ramp; with three, each note is
 * a third of everything the passive will ever say, so each one now says what
 * the player will notice.
 * ------------------------------------------------------------------------ */

export const RIG: readonly RigDef[] = [
  /*
   * ------------------------------------------------------------------------
   * SIX OF THE TWELVE ARE RULES NOW, AND SIX ARE STILL NUMBERS.
   *
   * Not twelve, deliberately. An ecosystem where everything is a rule is as
   * flat as one where nothing is: SPREAD, RAPID, MAGNET, REVERB, CAPO and
   * RESONANCE are the cleanest numeric items in the set and they are the
   * baseline the six rules read as a departure from.
   *
   * Every id, label, catalyst relationship, `character` phrase and audio
   * signature below is UNCHANGED. The 12x12 lattice is keyed on `id` and does
   * not care what an item does, which is what makes re-pointing cost zero offer
   * slots — the exit AGENTS.md §5 names, applied to passives.
   * ------------------------------------------------------------------------
   */
  {
    id: 'laser',
    label: 'LASER',
    legacy: true,
    weight: 1.0,
    blurb: 'Every few shots, one that goes through everything.',
    character: 'aggressive — the lead holds instead of stabbing',
    /*
     * THE ITEM THE WHOLE PLAN IS NAMED AFTER. It was
     * `[{damage:1.24},{damage:1.5,pierce:1},{damage:1.7,pierce:2}]` and it
     * rendered as "+24% damage" — "the game has the word and none of the
     * weapon".
     *
     * IT IS POWER-NEUTRAL BY ARITHMETIC, which is what made it safe to land
     * without a play-test. An overcharge every Nth activation at xM is a mean
     * damage multiplier of `(N - 1 + M) / N`:
     *
     *     L1  every 5th at x2.0  ->  x1.20   was x1.24
     *     L2  every 4th at x2.5  ->  x1.375  was x1.50 (+1 pierce)
     *     L3  every 3rd at x3.0  ->  x1.667  was x1.70 (+2 pierce)
     *
     * Slightly under the old curve on the mean, and the overcharged volley
     * additionally pierces EVERYTHING and cannot miss, which is where the two
     * lost pierce rungs went. What changes is not the total, it is that the
     * total arrives in a shape the player can see and time: you learn the
     * cadence and save the big volley for the pack.
     */
    levels: [{}, {}, {}],
    rules: [
      { overchargeEvery: 5, overchargeDamage: 2 },
      { overchargeEvery: 4, overchargeDamage: 2.5 },
      { overchargeEvery: 3, overchargeDamage: 3 },
    ],
    notes: [
      'every fifth shot fires white — twice as hard, straight through the line, and every bolt hunts',
      'every fourth, and the charged volley hits two and a half times as hard',
      'every third shot is the charged one, three times as hard, and nothing stops it',
    ],
  },
  {
    id: 'spread',
    label: 'SPREAD',
    legacy: true,
    weight: 1.0,
    blurb: 'One more of everything that comes out in numbers.',
    character: 'shimmering — wider, more detuned supersaws',
    levels: [{ count: 1 }, { count: 2, area: 1.12 }, { count: 3, area: 1.2 }],
    notes: [
      'one more of everything that comes out in numbers',
      'two more, and everything with a radius grows to make room for them',
      'three more, and the whole stage is a fifth wider',
    ],
  },
  {
    id: 'rapid',
    label: 'RAPID',
    legacy: true,
    weight: 1.0,
    blurb: 'Everything comes round sooner.',
    character: 'mechanical — hi-hats double in subdivision',
    levels: [{ cooldown: 0.85 }, { cooldown: 0.71 }, { cooldown: 0.62 }],
    notes: [
      'the whole band comes round about a sixth sooner',
      'nearly a third sooner — the gaps between volleys start to close',
      'everything fires at half again the rate it did',
    ],
  },
  {
    id: 'homing',
    label: 'HOMING',
    legacy: true,
    weight: 0.9,
    blurb: 'A shot that kills goes looking for the next one.',
    character: 'mechanical — the arpeggio grows a long delay tail',
    /*
     * THIS ROW WAS ALREADY BROKEN AND NOBODY COULD SEE IT.
     *
     * `[{homing:0.36},{homing:0.64},{homing:0.8}]` — and the sole consumer,
     * `World.steerPlayerBullets`, read the field as `mods.homing > 0` and then
     * turned every bullet at a hardcoded 6 rad/s. The three rungs steered
     * IDENTICALLY. Two of this item's three level-ups bought nothing, and
     * `deadhunt-ranges` could not report it because the field was read — just
     * not its value. "They hunt" and "they do not miss" were the same shot.
     *
     * Re-pointed rather than repaired, because the repair is not worth the
     * card: a global steer strength is invisible (you cannot see a bolt that
     * would have missed) and it makes aiming matter LESS, which is the opposite
     * of every other change in this pass. A kill that re-fires is visible on
     * the frame it happens, it rewards the thing the player is already doing,
     * and it compounds with density — a shot into a pack chains through it.
     *
     * IT ALSO REPAIRS A RECIPE. `chime + homing -> vibrato` is annotated in
     * `INSTRUMENTS` as a catalyst that was "inert before this change and inert
     * after it", because a `strike` spawns no bullets for the old steer to
     * bend. A strike kills; a kill echoes. The catalyst now means something for
     * the one line it gates.
     */
    levels: [{}, {}, {}],
    rules: [{ killEcho: 1 }, { killEcho: 2 }, { killEcho: 3 }],
    notes: [
      'a bolt that finishes something is thrown straight back out at whatever is nearest, and that one hunts',
      'two bolts come back off every kill',
      'three — a shot into a crowd keeps going until the crowd runs out',
    ],
  },
  {
    id: 'magnet',
    label: 'MAGNET',
    legacy: true,
    weight: 0.95,
    blurb: 'Shards come to you.',
    character: 'shimmering — the bass filter inverts into a vacuum',
    levels: [
      { pickupRadius: 2.1 },
      { pickupRadius: 3.6 },
      { pickupRadius: 5.0, xpGain: 1.05 },
    ],
    notes: [
      'shards jump to you from twice as far out',
      'most of what drops near you comes in without your going to get it',
      'shards cross the arena to reach you, and they are worth a little more when they land',
    ],
  },
  {
    id: 'timewarp',
    label: 'TIMEWARP',
    legacy: true,
    weight: 0.7,
    blurb: 'Close to you, the room runs slow. Away from you it does not.',
    character: 'eerie — half-time, at exactly the same tempo',
    /*
     * THE SLOW BECOMES POSITIONAL, WHICH IS THE WHOLE POINT.
     *
     * A global `enemyTime` is the most passive item in the set: it is a number
     * that is true everywhere, so there is nothing to do about it. Bounded to a
     * bubble around the ship it becomes a place you can stand — you wade INTO a
     * pack instead of away from it, and you position the bubble over the thing
     * that is about to reach you.
     *
     * `enemyTime` STAYS in `levels` and gets deeper, because the bubble is
     * small: 0.55 inside 150px is a far stronger effect than 0.89 everywhere
     * and it is only true where you put it. The field keeps its floor and its
     * only consumer, so nothing in `Modifiers` was orphaned.
     *
     * WHAT IT COSTS, said plainly rather than buried: the global warp is gone,
     * so TIMEWARP no longer slows enemy BULLETS or the emitter grid. Those two
     * were `bulletScale` and `fireScale` in `World.step` and both are now 1
     * from this item's point of view. That is a real reduction in defensive
     * power and it is intended — an item that slowed the bullets too was a
     * blanket, not a decision — but the machinery is kept rather than deleted,
     * for the same reason `rigModifiers` keeps two floors that cannot bite.
     */
    levels: [{ enemyTime: 0.72 }, { enemyTime: 0.6 }, { enemyTime: 0.5 }],
    rules: [{ slowRadius: 150 }, { slowRadius: 200 }, { slowRadius: 250 }],
    notes: [
      'anything that gets close to you wades — inside about a ship-length and a half, the room runs at three quarters speed',
      'the slow reaches further out and bites deeper; you can walk into a group and out the other side',
      'a wide bubble of half-speed travels with you, and the rest of the arena never notices',
    ],
  },
  {
    id: 'reverb',
    label: 'REVERB',
    weight: 1.0,
    blurb: 'Everything with a radius gets a bigger one.',
    character: 'shimmering — tail and space',
    levels: [{ area: 1.2 }, { area: 1.45 }, { area: 1.62 }],
    notes: [
      'every ring, pool and sweep grows a fifth',
      'half again as much room — auras begin to overlap each other',
      'everything with a radius takes up two thirds more of the arena',
    ],
  },
  {
    id: 'compressor',
    label: 'COMPRESSOR',
    weight: 0.9,
    blurb: 'A shield, and a hit that answers back.',
    character: 'heavy — glued, dense, nothing peaks',
    /*
     * A COMPRESSOR ANSWERS A PEAK. That is what the word means and it is what
     * the item does now: get hit, and the hit comes back out as a ring.
     *
     * `maxHp` is HELD FLAT at its old level-1 value rather than dropped. It is
     * the only feeder of `Modifiers.maxHp`, and `World.applyRigHealth` is its
     * only consumer — take it away and both go dead. So the shield is the
     * spine, the ladder is the nova, and the passive stops being "+15% damage
     * with a bonus".
     *
     * The `damage` RAMP is gone and the level-1 value stays, and that is a
     * deliberate compromise rather than a tidy one. LASER's damage multiplier
     * left with its re-point, so `damage: 1.05` here is the ONLY thing left
     * feeding `Modifiers.damage` — drop it and the field folds to 1 on every
     * frame of every run and `applyModifiers` carries a channel nobody uses.
     * `tools/levelup.mjs` prints the maxed fold and read `dmg x1.00` the first
     * time this row was written without it, which is how it was caught.
     *
     * It is the right item to own the remainder. A compressor raises the
     * average and lowers the peaks — "glued, dense, nothing peaks" is the
     * `character` phrase and a small global lift is literally what the device
     * does. What it is NOT any more is the card's identity: 5% is a footnote
     * under a rule, where 15% used to be the whole item. The rig's largest
     * flat damage percentage went from 95% to 5%.
     *
     * THE RING INHERITS THE BULLET-CANCEL AND THAT IS WANTED. `updateNova`
     * deletes enemy bullets in the annulus for any ring with `clears: true`,
     * which is undocumented behaviour every aura quietly has. Here it is
     * deliberate: `onPlayerHit` already runs `cancelBullets`, which spares
     * anything not flagged `Cancellable`, and the expanding ring sweeps those
     * up behind it. A defensive item that clears the screen it just failed to
     * save you from is the correct reading of the card.
     */
    levels: [{ maxHp: 1, damage: 1.05 }, { maxHp: 1, damage: 1.05 }, { maxHp: 1, damage: 1.05 }],
    rules: [
      { hitNova: 40, hitNovaRadius: 170 },
      { hitNova: 90, hitNovaRadius: 230 },
      { hitNova: 160, hitNovaRadius: 300 },
    ],
    notes: [
      'one more shield — and every hit you take blows a ring back out of you that hurts what caused it',
      'the ring goes out further and lands much harder',
      'getting hit clears the room — a wide ring that eats the shots in the air and bites whatever stands in it',
    ],
  },
  {
    id: 'capo',
    label: 'CAPO',
    weight: 0.9,
    blurb: 'Everything that travels, travels faster.',
    character: 'mechanical — brighter and tighter, everything up a step',
    levels: [{ speed: 1.24 }, { speed: 1.5 }, { speed: 1.7 }],
    notes: [
      'everything that travels leaves a quarter faster, and reaches further before it fades',
      'half again as fast — bolts arrive before the gap closes',
      'seventy per cent faster; nothing you fire lags behind you',
    ],
  },
  {
    id: 'fermata',
    /*
     * LABELLED 'PEDAL' NOW, BECAUSE THE WEAPON ROSTER TOOK THE OTHER NAME.
     *
     * `docs/plan-refactor-3.md` §9c names one of the twenty bases FERMATA (Ball
     * x Pit's Time ball — a dropped snare that holds what stands in it), and
     * two things labelled FERMATA on the same pause screen is the exact defect
     * `tools/mirror.mjs` was rewritten for: two rows with different ids
     * rendering identical text, which a person reads as the game repeating
     * itself. AGENTS.md §3, "assert what a person SEES".
     *
     * The ID DOES NOT MOVE, so the catalyst lattice, the audio signature and
     * every reference in `layers.ts` are untouched — this is a label change and
     * nothing else. A sustain pedal is the same gesture the item already
     * describes: put your foot down and hold.
     */
    label: 'PEDAL',
    weight: 0.9,
    blurb: 'Plant your feet and the whole band swells.',
    character: 'mournful — held past its length',
    /*
     * A FERMATA IS A HOLD. The item held the EFFECTS; now it also rewards the
     * PLAYER for holding, which is the same gesture pointed at the person.
     *
     * THE OPPOSITE POLE TO UP-TEMPO, deliberately, and that opposition is the
     * point of the pair: FERMATA pays you to plant and UP-TEMPO pays you to
     * keep moving, so a rig carrying both is carrying two contradictions and a
     * rig carrying one is a build.
     *
     * IT CANNOT BECOME A CAMPING ITEM, and the reason is a mechanism that
     * already exists. The charge reads `World.idleTime`, the same clock
     * `campPressure` reads — and camping starts costing you at
     * `IDLE_GRACE_S` = 4s, with enemy bullets accelerating and both rescue
     * mechanics switched off past half ramp. A full charge takes 2.5s falling
     * to 1.5s, so the whole ladder lives INSIDE the grace window. Plant, take
     * the swell, move before the field speeds up. Standing there for twenty
     * seconds buys exactly the same charge and a much worse arena.
     *
     * It is not consumed by firing, and that is the one decision here worth
     * arguing. Spending it on the next activation reads better on the card —
     * but the band fires constantly (PIZZICATO every 0.15s), so a charge that
     * is spent would never reach more than a few per cent before something ate
     * it, and the item would be inert for exactly the reason this whole pass
     * exists. Building and holding makes it a state the player manages instead.
     *
     * `linger` is held flat at its old level-1 value for the reason
     * COMPRESSOR's `maxHp` is: FERMATA is the only feeder of
     * `Modifiers.linger`, and dropping it would kill the field in
     * `applyModifiers` along with aura hold and well life.
     */
    levels: [{ linger: 1.3 }, { linger: 1.3 }, { linger: 1.3 }],
    rules: [
      { chargeSeconds: 2.5, chargeDamage: 1.6 },
      { chargeSeconds: 2, chargeDamage: 2.1 },
      { chargeSeconds: 1.5, chargeDamage: 2.6 },
    ],
    notes: [
      'hold still a breath and the band swells — planted shots land half again as hard, and it drops when you move',
      'the swell arrives sooner and climbs to double',
      'a second and a half planted and you hit for two and a half — standing your ground is the weapon now',
    ],
  },
  {
    id: 'tempo',
    label: 'UP-TEMPO',
    weight: 0.9,
    blurb: 'Where you have been burns behind you.',
    character: 'aggressive — pushed ahead of the beat',
    /*
     * `docs/research-weapons.md` D.2's `trail` shape, reused as a passive
     * rather than as a weapon — the plan's own suggestion, and the machinery is
     * built either way so whichever lands first pays for the other.
     *
     * THE POLE OPPOSITE FERMATA. This one only pays while you are moving: the
     * drop is triggered by DISTANCE TRAVELLED and not by a timer, so a parked
     * ship lays nothing at all. Kiting a group through your own wake is the
     * play, and it is the exact behaviour `campPressure` is trying to
     * encourage — the first item in the game that rewards it directly.
     *
     * IT DROPS INTO `novas[]`, NOT `wells[]`, and the reason is that nothing
     * draws a well. `Renderer` reads `novas`, `effects`, `notes`, `popups`,
     * `drops`, both bullet pools and the particles; `World.wells` is in none of
     * them, so BLACK HOLE and TREMOLO FIELD are invisible damage pools today. A
     * trail the player cannot see is a rule they cannot play around, which is
     * the defect in a new costume. A ring with a small `maxR` and a slow
     * `speed` is a growing, fading blot that `drawNovas` already renders and
     * `updateNova` already collides.
     *
     * `clears: false` ON THE DROP, unlike COMPRESSOR's ring. Every aura in the
     * game quietly deletes enemy bullets in its annulus, and a trail laid down
     * six times a second with that behaviour would be a permanent moving
     * bullet-shredder — far and away the strongest defensive item in the game,
     * bought by holding a direction. It burns; it does not sweep.
     *
     * `moveSpeed` is held flat at its old level-1 value: UP-TEMPO is the only
     * feeder of `Modifiers.moveSpeed`, and `Player.update` takes it as an
     * argument.
     */
    levels: [{ moveSpeed: 1.13 }, { moveSpeed: 1.13 }, { moveSpeed: 1.13 }],
    rules: [
      { trailDamage: 26, trailRadius: 34, trailLife: 0.8, trailEvery: 80 },
      { trailDamage: 46, trailRadius: 44, trailLife: 1, trailEvery: 70 },
      { trailDamage: 72, trailRadius: 56, trailLife: 1.2, trailEvery: 60 },
    ],
    notes: [
      'you move ahead of the beat, and the ground you cross keeps burning for a moment after you leave it',
      'the burn is wider, hotter and laid down closer together — run a group through your own wake',
      'a thick scorched line follows you everywhere; kiting is now the highest damage in your rig',
    ],
  },
  {
    id: 'resonance',
    label: 'RESONANCE',
    weight: 0.85,
    blurb: 'Shards are worth more. Levels come sooner.',
    character: 'shimmering — rings on after the strike',
    levels: [{ xpGain: 1.2 }, { xpGain: 1.45 }, { xpGain: 1.6 }],
    notes: [
      'every shard is worth a fifth more than it was',
      'half again — levels start arriving between waves instead of after them',
      'shards pay sixty per cent over, and the band fills out fast',
    ],
  },
];

/* ------------------------------------------------------------------------ *
 * Fusions
 *
 * Every rig item is the catalyst for exactly one instrument, and no instrument
 * shares a catalyst. That is a deliberate divergence from Vampire Survivors,
 * where several passives catalyse nothing and exist purely as stats. Here it
 * means every rig item you are offered has a reason beyond its own numbers, and
 * a player can learn the whole table — which is the point, because a
 * combination you cannot anticipate is not a decision, it is a surprise.
 *
 * Unions take two *evolved* instruments and free a slot, as Fuwalafuwaloo does.
 * They are the ceiling and they are meant to be rarely reached.
 *
 * ---------------------------------------------------------------------------
 * DOES AN EVOLUTION CHANGE THE VERB? COUNTED, AND THEN ACTED ON.
 *
 * The header of this file promises "a different verb, not a bigger number".
 * Walking this table and comparing each result's `shape` to its base's:
 *
 *     before   13 of 15 recipes kept the base's shape   (13 of 13 evolutions,
 *              0 of 2 unions)
 *     after    11 of 15                                 (11 of 13 evolutions,
 *              0 of 2 unions)
 *     now      10 of 15                                 (10 of 13 evolutions,
 *              0 of 2 unions)
 *
 * Three moved: `drones -> chorale` orbit -> beam, `tremolo -> vibrato`
 * field -> strike, and `harp -> crossstrung` arc -> spray. All three are
 * argued at their rows in `INSTRUMENTS`. The test they had to pass was not "is
 * a different shape imaginable" — it always is — but **does the re-point make
 * more of the row's own declared stats live?** `tools/deadhunt-ranges.mjs`
 * prints that per shape, so it is a number rather than an opinion.
 *
 * TWO MORE RECIPES MOVED BOTH ENDS AT ONCE and so do NOT show up in that
 * count, which is worth saying because the count understates the change.
 * `bow + laser -> harmonics` went beam -> beam and is now lance -> lance, and
 * `feedback + tempo -> wallofsound` went aura -> aura and is now cone -> cone.
 * Neither is a verb change WITHIN the recipe and neither is claimed as one;
 * what they are is four instruments leaving the two most crowded shapes in the
 * table. `harmonics + crossstrung -> stringsection` still changes the verb, at
 * lance -> arc rather than beam -> arc, so the one union that was earning its
 * shape change keeps earning it.
 *
 * THE OTHER ELEVEN WERE EXAMINED AND LEFT. Recording why, because
 * `docs/research-items.md` §5 Gap 1 proposes six re-points and four of them are
 * on this list — do not re-propose them without answering the objection.
 *
 *   - `blackhole + compressor -> downbeat`, field -> strike. **Blocked.**
 *     `World.fieldSwallows` is `id === 'blackhole' || id === 'downbeat'`, and
 *     that is what banks a charge into `player.wells` for the player to throw.
 *     DOWNBEAT is the only fused instrument that keeps the throw. Re-pointing
 *     it deletes a player-facing verb and leaves the second half of that
 *     predicate unreachable. Needs `fieldSwallows` to become a data flag first.
 *   - `echoes + timewarp -> canon`, seek -> field. **Blocked.** CANON is
 *     `bounces: 8` and `range: 2600`; `fireField` reads neither. `bounces` is
 *     the flagship dead-stat repair in this repo (see `InstrumentStats.bounces`)
 *     and this would re-kill it on the one instrument built around it.
 *   - `bow + laser -> harmonics`, beam -> arc. **Rejected, and then routed
 *     around.** As an `arc` it would collapse STRING SECTION — one of only two
 *     recipes that changes shape at all — from beam -> arc to arc -> arc, so
 *     the count would not improve, and it puts a `speed: 0` arc into SNARE's
 *     sweep branch or a travelling fan into HARP's. That objection stands and
 *     was never overturned. Both rows are now `lance` instead, which preserves
 *     STRING SECTION's shape change and takes them off `arc` entirely.
 *   - `snare + rapid -> blastbeat`, arc -> orbit. **Blocked, concretely.**
 *     `World` writes `player.podCount` once per orbit instrument inside the
 *     firing loop, last write wins. Today at most one orbit instrument can ever
 *     be held (CHORALE and every drones-parented duet consume DRONE PODS), so
 *     the collision has never been reachable. A second orbit RESULT makes
 *     DRONE PODS + BLAST BEAT a legal pair and the collision real. Separately:
 *     "the roll never lands" is already satisfied inside `arc` — the sweep's
 *     life is 0.16s and the interval is 0.16s, so there is literally no gap.
 *   - `chime + resonance -> carillon`, strike -> aura. **Rejected on the
 *     census.** `aura` was 4 of the 15 results (CATHEDRAL, WALL OF
 *     SOUND, TUTTI, REQUIEM) against `beam` 1 and `strike` 1; three of those
 *     four are "a very large ring". A fifth would be the same-verb-bigger-number
 *     problem reproduced at roster level. And `strike` was split out of `seek`
 *     *for* the CHIME family — moving CHIME's own ending off it a change later
 *     is churn. Nothing in the recipe argues for it either: RESONANCE moves
 *     `xpGain`, which no shape reads.
 *   - `pizzicato + capo -> spiccato` / `+ compressor -> snap`. **Left, twice
 *     over.** The branch note on SNAP records the decision and its reason. And
 *     "the bow starts to bounce" is not an unimplemented shape: `bounces: 2`
 *     plus `fireSeek` forwarding it to a reflecting pool IS that line. CAPO
 *     moves `speed`, which only seek, travelling arc and orbit read.
 *
 * NOT SHAPE BUGS, BUT PROSE THE SIMULATION DOES NOT DELIVER. There is ONE
 * entry left, and it is worth saying that this list used to have five.
 *
 *   - CANON's "every bounce spawns a delayed copy". The pool reflects; it does
 *     not spawn. `docs/research-weapons.md` §C.4 #8 files this under
 *     "splits or spawns sub-projectiles", which that document argues belongs on
 *     the RIDER axis (§E.1) and not on a shape — firing on an event is a
 *     trigger, and as a rider it would compose with all fourteen routines
 *     instead of needing its own instrument. Left alone deliberately.
 *
 * FOUR CAME OFF, AND THEY CAME OFF IN THREE DIFFERENT WAYS. Say which one
 * happened when quoting this paragraph; "the promise was kept" and "the
 * promise was withdrawn" look identical in a census of unkept promises.
 *
 *   DELIVERED BY A NEW SHAPE:
 *   - ROSIN BOW's "it does not stop" -> `lance`.
 *   - CARILLON's "every strike chains to two more" -> `chain`, which walks
 *     nearest-to-nearest instead of picking at random.
 *   - TUTTI's "everything is pulled to the centre first, and then struck" ->
 *     `mortar`, both halves: the pending shell drags what is under it for the
 *     whole telegraph and then detonates. `Effect.pull` still has no reader,
 *     but the sentence no longer needs one.
 *   - TREMOLO FIELD's "pools left in your wake" -> `trail`. It was never in
 *     this paragraph because the `FUSIONS` preamble is about fusions and
 *     TREMOLO is a base instrument, but it was on the same list in
 *     `docs/research-weapons.md` §C.3 and it is delivered by the same change.
 *
 *   WITHDRAWN RATHER THAN DELIVERED:
 *   - WALL OF SOUND's "the field grows with your speed" is GONE. The blurb was
 *     rewritten to describe what the cone actually does, because no stat
 *     expresses player speed and a hidden multiplier with no dial is worse than
 *     an unkept promise.
 *
 *   STILL A DEAD STAT RATHER THAN A DEAD SENTENCE:
 *   - STRING SECTION's "all of them held" on an `arc` is why `deadhunt-ranges`
 *     still reports its `linger: 1.2` as dead. The union is `lance + spray ->
 *     arc` and moving it would collapse the one union that already earns its
 *     shape change; the honest fix is to delete the stat or to give `arc` a
 *     hold, and neither is this change.
 * ------------------------------------------------------------------------ */

export interface FusionDef {
  kind: 'evolution' | 'union';
  /** The instrument that must be at max level. */
  base: InstrumentId | EvolvedId;
  /** Rig item (evolution) or second instrument (union), also at max level. */
  catalyst: AbilityId;
  result: EvolvedId;
  /** One line for the announcement banner. */
  line: string;
}

/*
 * TWENTY-ONE EVOLUTIONS AND TWO UNIONS.
 *
 * The count follows the roster: `tools/levelup.mjs` fails any instrument that
 * has no evolution, because committing three picks to a dead end is the worst
 * thing a progression system can do to a player. Twenty bases therefore need
 * twenty recipes, and RASP branches to make twenty-one.
 *
 * EIGHT RIG ITEMS NOW CATALYSE TWO BASES EACH. AGENTS.md §5 permits exactly
 * this and says why: the 12x12 lattice is broken by a THIRTEENTH PASSIVE, not
 * by a passive doing double duty. Every one of the twelve still catalyses at
 * least one base, which `levelup` also asserts, so no passive is filler.
 *
 * THIS IS NOT THE FUSION SYSTEM THE NEXT PHASE BUILDS. `docs/plan-refactor-3.md`
 * §9d asks for ~60 hand-authored results over `C(20,2) = 190` base-plus-base
 * pairs, Ball x Pit style. What is here is the EXISTING base-plus-catalyst
 * lattice re-pointed onto the new roster, so `discovery`, `mirror`, `combine`
 * and the workbench keep working while the roster changes underneath them.
 * `mergeProps` is the joint the authored table will hang off.
 */
export const FUSIONS: readonly FusionDef[] = [
  { kind: 'evolution', base: 'pizzicato', catalyst: 'capo', result: 'spiccato', line: 'the bow starts to bounce' },
  { kind: 'evolution', base: 'pizzicato', catalyst: 'compressor', result: 'snap', line: 'the string is pulled clear and let go' },
  { kind: 'evolution', base: 'snare', catalyst: 'rapid', result: 'blastbeat', line: 'the roll never lands' },
  { kind: 'evolution', base: 'bow', catalyst: 'laser', result: 'harmonics', line: 'the fundamental splits' },
  { kind: 'evolution', base: 'chime', catalyst: 'resonance', result: 'carillon', line: 'one bell becomes a tower of them' },
  { kind: 'evolution', base: 'harp', catalyst: 'spread', result: 'crossstrung', line: 'the frame is strung both ways' },
  { kind: 'evolution', base: 'drones', catalyst: 'fermata', result: 'chorale', line: 'the satellites stop moving and start singing' },
  { kind: 'evolution', base: 'nova', catalyst: 'reverb', result: 'cathedral', line: 'the room grows around the pulse' },
  { kind: 'evolution', base: 'blackhole', catalyst: 'magnet', result: 'downbeat', line: 'the collapse lands on the one' },
  { kind: 'evolution', base: 'feedback', catalyst: 'tempo', result: 'wallofsound', line: 'the hum outruns you' },
  { kind: 'evolution', base: 'echoes', catalyst: 'timewarp', result: 'canon', line: 'the echo answers itself' },
  { kind: 'evolution', base: 'timpani', catalyst: 'reverb', result: 'tutti', line: 'the whole band comes in behind it' },
  { kind: 'evolution', base: 'tremolo', catalyst: 'homing', result: 'vibrato', line: 'the pools start hunting' },
  { kind: 'evolution', base: 'ember', catalyst: 'laser', result: 'pyre', line: 'the coals catch, all at once' },
  { kind: 'evolution', base: 'phantom', catalyst: 'timewarp', result: 'revenant', line: 'what you killed comes back' },
  { kind: 'evolution', base: 'anvil', catalyst: 'capo', result: 'maestro', line: 'the whole band lands on the one' },
  { kind: 'evolution', base: 'gravel', catalyst: 'spread', result: 'sordino', line: 'the mute goes on, and the room banks it' },
  { kind: 'evolution', base: 'nocturne', catalyst: 'timewarp', result: 'adagio', line: 'the dark spreads out and slows everything in it' },
  { kind: 'evolution', base: 'siphon', catalyst: 'compressor', result: 'interlude', line: 'the band stops, and nothing can reach you' },
  { kind: 'evolution', base: 'accelerando', catalyst: 'rapid', result: 'fugue', line: 'the subject is answered, and answered again' },
  { kind: 'evolution', base: 'charm', catalyst: 'homing', result: 'consort', line: 'the turncoats form a consort' },

  { kind: 'union', base: 'chorale', catalyst: 'cathedral', result: 'requiem', line: 'the choir and the room become one' },
  { kind: 'union', base: 'harmonics', catalyst: 'crossstrung', result: 'stringsection', line: 'the section takes the whole line' },
];

/* ------------------------------------------------------------------------ *
 * Lookups and folding
 * ------------------------------------------------------------------------ */

const INSTRUMENT_BY_ID = new Map<string, InstrumentDef>(INSTRUMENTS.map((d) => [d.id, d]));

/* ---------------------------------------------------------------------------
 * DUETS — the generative half of combining.
 *
 * `FUSIONS` is a hand-authored table: eleven named recipes, each an instrument
 * plus its catalyst. Those are the good ones and they stay. But a table of
 * recipes has a failure mode that Ball x Pit's own reviews name as its worst —
 * a build that holds two things with no recipe between them is STRANDED, and
 * the player is punished for a combination nobody happened to write down.
 *
 * So any two maxed instruments combine, always. The result is synthesised
 * rather than authored: it keeps the FIRST parent's projectile shape and takes
 * the second's stat character, which makes the outcome predictable from the
 * inputs without a wiki. `PIZZICATO × SNARE` is pizzicato's bolts carrying
 * snare's reach — you can guess that, which is the property that matters.
 *
 * Ids are canonical (`a+b` sorted), so `A × B` and `B × A` are the same thing
 * and cannot both exist. They are not in `InstrumentId`, and deliberately so:
 * a union type would need 15 entries for the base six alone and would grow
 * quadratically. Every lookup in this file goes through `instrumentDef` below,
 * which synthesises on demand.
 * ------------------------------------------------------------------------- */


/**
 * The level at which an instrument becomes duet material.
 *
 * Requiring BOTH parents at max level 8 put the first duet out of reach for
 * the first eight minutes of a run: measured across three seeds, 0% of offers
 * in a 480s run contained a fusion card, against 13-16% at 900s. A player
 * levelling narrowly reached two maxed instruments only on their final picks.
 * A core verb that does not exist for the first half of the game is not a core
 * verb.
 *
 * Six rather than eight, and the synthesised stats below are blended at this
 * same level rather than at max. Tying both to one constant is what keeps the
 * result predictable: a duet is worth the same whether you fused at 6 or
 * waited until 8, so there is no hidden penalty for combining as soon as you
 * can — which is the decision the mechanic is supposed to be about.
 *
 * ---------------------------------------------------------------------------
 * NOW THREE, WHICH IS THE INSTRUMENT MAX, AND THAT IS DELIBERATE RATHER THAN A
 * CLAMP.
 *
 * It could not stay at 6: `INSTRUMENT_MAX_LEVEL` is 3, `readyDuets` admits at
 * `min(DUET_INPUT_LEVEL, maxLevelOf(id))`, and a threshold above every ceiling
 * it is compared against is a dead number that silently reads as "max". The
 * question is only whether it should be 2 or 3.
 *
 * IT IS 3, because 2 would put generic duets AHEAD of the authored table and
 * this repository has already paid for that mistake twice. An evolution needs
 * its base at 3 *and* its catalyst at 3; a duet needs two instruments at this
 * value and nothing else. At 2 the generic pairing would be available a full
 * pick before any designed recipe could be, on a ladder only two picks long —
 * and duets are combinatorial while `FUSIONS` is not, so four held instruments
 * offer six duets against at most a handful of recipes. The measured cost of
 * exactly that crowding is recorded twice in this file and in AGENTS.md §5:
 * designed fusions per run 1.63 -> 1.13 when duets went 4 -> 9. At 3 the two
 * tiers unlock on the same pick and the designed one is still cheaper in
 * cards, because its catalyst is a passive rather than a second instrument
 * competing for a stand slot.
 *
 * The original reason for 6-of-8 — "a core verb that does not exist for the
 * first half of the game is not a core verb" — is satisfied by the ladder being
 * short rather than by the threshold sitting below it. Two picks reaches max.
 *
 * ONE KNOCK-ON, stated because it is a real balance change and not a rename:
 * the synthesised stats below blend the parents at this level, so a duet is now
 * built from two MAXED parents rather than from two three-quarter ones, and the
 * `1.5x the better parent` rescale at the bottom of `synthesiseDuet` is
 * therefore measured against a bigger number. A duet used to be beatable by its
 * own parent's top two rungs; it no longer is. That is the correct direction —
 * it costs two maxed instruments and a stand slot — but it is a buff, and
 * `tools/builds.mjs` and `tools/combine.mjs` are where it should be read.
 */
export const DUET_INPUT_LEVEL = 3;

// The id grammar lives in `core/duet.ts` so `audio/` can read it without
// importing `game/`. Re-exported here because every existing call site expects
// it from this module. See the note in that file.
export { DUET_SEP, duetId, duetParents } from '../core/duet';
import { duetParents } from '../core/duet';

const DUET_CACHE = new Map<string, InstrumentDef>();

function synthesiseDuet(id: string): InstrumentDef | undefined {
  const parents = duetParents(id);
  if (!parents) return undefined;
  const [a, b] = parents.map((p) => INSTRUMENT_BY_ID.get(p));
  if (!a || !b) return undefined;
  const cached = DUET_CACHE.get(id);
  if (cached) return cached;
  /*
   * A's shape, and the better half of each stat — measured at the parents'
   * MAXED level, not their base.
   *
   * Blending the base stats was wrong and produced a weapon weaker than either
   * input: `PIZZICATO × SNARE` came out at count 2 while a maxed pizzicato
   * fires 4, because pizzicato's extra bolts live in its level steps rather
   * than its base row. Spending two maxed instruments and a chair to get
   * something worse is not a decision, it is a trap.
   *
   * Taking the max of each field rather than the mean or the sum is
   * deliberate: a mean makes every duet mediocre and a sum makes the last one
   * you build win the run. Max means a duet is at least as good as either
   * parent at everything, which is what earns the cost — and it is bounded,
   * because both parents are bounded by their own ladders.
   *
   * `interval` is inverted (lower is faster), so it takes the min.
   */
  const am = instrumentStats(a.id, Math.min(DUET_INPUT_LEVEL, maxLevelOf(a.id)));
  const bm = instrumentStats(b.id, Math.min(DUET_INPUT_LEVEL, maxLevelOf(b.id)));
  const def: InstrumentDef = {
    id: id as InstrumentDef['id'],
    label: `${a.label} × ${b.label}`,
    shape: a.shape,
    blurb: `${a.blurb.replace(/\.$/, '')}, carrying ${b.label.toLowerCase()}.`,
    /*
     * The tail names the TIER, because the two are not the same event.
     *
     * Both parents evolved means this is a UNION, the top of the tree, and
     * everything else that describes one — the offer line, the HUD banner, the
     * workbench glyph — already says "sections" rather than "players". This
     * was the last place still calling it two players on one stand, which read
     * as though a union were an ordinary duet with longer names.
     */
    character: `${a.character.split('—')[0].trim()} + ${b.character.split('—')[0].trim()} — `
      + (a.fused && b.fused ? 'two sections, one score' : 'two players on one stand'),
    weight: 0,
    fused: true,
    /*
     * BOTH PARENTS' PROPERTIES, MERGED. This is the line that makes a generic
     * duet a real Ball x Pit combination rather than a stat blend: EMBER x
     * GLASS carries burn AND freeze, and behaves like both, without anyone
     * having authored the pair. `docs/plan-refactor-3.md` §9b's requirement
     * that "the remaining 130 pairs carry both parents' properties so nothing
     * is a dead end" is one `mergeProps` call.
     *
     * Unbounded in the sense that damage is not: the dps rescale below acts on
     * the STAT block only, so a duet's properties are the strict union of its
     * parents' at full strength. That is intended — properties are what the
     * player is combining FOR, and halving them would make every duet a
     * diluted version of both parents, which is the "samey weapons wearing
     * modifier tags" verdict in a different costume.
     */
    props: mergeProps(
      instrumentProps(a.id, Math.min(DUET_INPUT_LEVEL, maxLevelOf(a.id))),
      instrumentProps(b.id, Math.min(DUET_INPUT_LEVEL, maxLevelOf(b.id))),
    ),
    base: {
      ...am,
      interval: Math.min(am.interval, bm.interval),
      count: Math.max(am.count, bm.count),
      damage: Math.max(am.damage, bm.damage),
      area: Math.max(am.area, bm.area),
      arc: Math.max(am.arc, bm.arc),
      speed: Math.max(am.speed, bm.speed),
      pierce: Math.max(am.pierce, bm.pierce),
    },
    /* A short ladder, like the authored fusions. See `FUSED_MAX_LEVEL`. */
    steps: [
      { note: 'both parts play out', mul: { damage: 1.18, count: 1 } },
      { note: 'and again, tighter', mul: { interval: 0.88, damage: 1.15 } },
    ],
  };
  /*
   * ...THEN BOUNDED, because max-of-each-field compounds.
   *
   * Taking the best interval AND the best damage AND the best count multiplies
   * three advantages together: measured before this, `PIZZICATO × SNARE` came
   * out at 794 nominal dps against parents of 225 and 86 — three and a half
   * times the better one, from a rule whose stated intent was "at least as
   * good as either parent". `CHIME × PIZZICATO` reached 4.3x. A duet that
   * strong makes the choice of WHICH pair irrelevant, because any pair wins.
   *
   * So the qualitative blend stands — shape, reach, pierce and speed all come
   * from whichever parent had more — and damage is then scaled so nominal dps
   * lands at a fixed multiple of the better parent. 1.5x is a real reward for
   * spending two maxed instruments and leaves the level ladder somewhere to go.
   */
  const dpsOf = (t: InstrumentStats) => (t.interval > 0 ? (t.damage * t.count) / t.interval : 0);
  const target = 1.5 * Math.max(dpsOf(am), dpsOf(bm));
  const raw = dpsOf(def.base);
  if (raw > 0 && target > 0) def.base.damage *= target / raw;

  DUET_CACHE.set(id, def);
  return def;
}

/** Every instrument lookup goes through here so duets resolve like the rest. */
export function instrumentDef(id: string): InstrumentDef | undefined {
  return INSTRUMENT_BY_ID.get(id) ?? synthesiseDuet(id);
}
const RIG_BY_ID = new Map<string, RigDef>(RIG.map((d) => [d.id, d]));



export function rigDef(id: string): RigDef | undefined {
  return RIG_BY_ID.get(id);
}

export function slotOf(id: string): AbilitySlot | null {
  if (instrumentDef(id)) return 'instrument';
  if (RIG_BY_ID.has(id)) return 'rig';
  return null;
}

/**
 * Where a fusion STARTS, which is also where it stops. Not a ladder.
 *
 * `applyFusion` seats a result here immediately rather than at 1. A fused
 * instrument is never draftable — you earn it by combining — so it was never
 * offered as a level-up card either, and seating it at 1 left it at 1 for the
 * whole run: twelve picks spent (a base from 1 to 8, a catalyst from 0 to 5)
 * for something standing at a third of its own ceiling. That bill is now five
 * picks, because the two ladders it counts are three rungs each — but the
 * seating argument is unchanged, and so is this number.
 *
 * This number is load-bearing for the TOP of the tree, which is the part that
 * is easy to miss. `readyDuets` admits an instrument at
 * `min(DUET_INPUT_LEVEL, maxLevelOf(id))`, so an evolved instrument qualifies
 * at exactly this value — and two evolved instruments make a UNION. While
 * results seated at 1 that threshold was never met and there were zero unions
 * in every run ever measured; seated here, a committed player lands one in half
 * their runs.
 *
 * Three because a fusion arrives already strong, and because this is a starting
 * position rather than something to be climbed. It used to be "three rather
 * than the base eight"; the base is now three as well, which is precisely the
 * shape the owner asked for — three levels to a weapon, then it combines, then
 * three more. This constant did not move to get there.
 *
 * An earlier note here claimed the short ladder kept fused ids "in the pool"
 * and so held off pool exhaustion. That was never true — `availableOptions`
 * skips `def.fused` outright. Exhaustion is handled by the grace cards and by
 * the slots a fusion hands back when it spends its catalyst.
 */
export const FUSED_MAX_LEVEL = 3;

export function maxLevelOf(id: string): number {
  const inst = instrumentDef(id);
  if (inst) return inst.fused ? FUSED_MAX_LEVEL : INSTRUMENT_MAX_LEVEL;
  return RIG_BY_ID.has(id) ? RIG_MAX_LEVEL : 0;
}

export function labelOf(id: string): string {
  return instrumentDef(id)?.label ?? RIG_BY_ID.get(id)?.label ?? id.toUpperCase();
}

export function characterOf(id: string): string {
  return instrumentDef(id)?.character ?? RIG_BY_ID.get(id)?.character ?? '';
}

/** What the player will notice about taking `id` to `level`. */
export function stepNote(id: string, level: number): string {
  const inst = instrumentDef(id);
  if (inst) {
    if (level <= 1) return inst.blurb;
    return inst.steps[level - 2]?.note ?? inst.blurb;
  }
  const rig = RIG_BY_ID.get(id);
  if (rig) return rig.notes[level - 1] ?? rig.blurb;
  return '';
}

/**
 * Fold an instrument's base and its steps up to `level` into one stat block.
 *
 * Adds land before multipliers at each step, so "one more bolt" and "everything
 * hits 40% harder" compose the way the notes read. A fused instrument has no
 * steps and returns its base whatever the level.
 */
export function instrumentStats(id: string, level: number): InstrumentStats {
  /*
   * Through `instrumentDef`, not the raw map — a duet id is not in the table
   * and the fallback below returns `stats({})`, which is a weapon that fires
   * nothing. A synthesised instrument that silently does zero damage is the
   * worst version of this repository's recurring bug: it type-checks, it
   * appears in the HUD, and it is inert.
   */
  const def = instrumentDef(id);
  if (!def) return stats({});
  const out: InstrumentStats = { ...def.base };
  const upto = Math.min(Math.max(level, 1), def.steps.length + 1) - 1;
  for (let i = 0; i < upto; i++) {
    const step = def.steps[i];
    if (step.add) {
      for (const [k, v] of Object.entries(step.add) as [keyof InstrumentStats, number][]) out[k] += v;
    }
    if (step.mul) {
      for (const [k, v] of Object.entries(step.mul) as [keyof InstrumentStats, number][]) out[k] *= v;
    }
  }
  return out;
}

/**
 * Fold an instrument's base properties and its steps up to `level` into one set.
 *
 * The `beatLockOf` treatment rather than the `instrumentStats` one: each rung's
 * `prop` is cumulative and OVERWRITES the fields it names, so a ladder reads as
 * "burn 9 / 14 / 20" rather than as three deltas nobody can add up. A fused
 * instrument has no steps and returns its base set at every level.
 *
 * A DUET INHERITS BOTH PARENTS. `synthesiseDuet` merges the two sets with
 * `mergeProps`, which is the same fold the authored fusions of the next phase
 * will use — a generic pairing is therefore never a dead end in the way
 * `docs/plan-refactor-3.md` §9b warns about, because the properties survive
 * even when nobody wrote the recipe down.
 */
export function instrumentProps(id: string, level: number): Props {
  const def = instrumentDef(id);
  if (!def) return noProps();
  const out = { ...noProps(), ...def.props };
  const upto = Math.min(Math.max(level, 1), def.steps.length + 1) - 1;
  for (let i = 0; i < upto; i++) {
    const p = def.steps[i].prop;
    if (p) Object.assign(out, p);
  }
  return out;
}

/**
 * Which grid line this instrument fires on at this level, or null for "any".
 *
 * The same fold `instrumentStats` performs, on the one property that is not a
 * number: the highest rung reached that names a lock wins, and the base's lock
 * is the floor. Kept beside the stat fold rather than inside it because
 * `InstrumentStats` is documented as all-numeric so a block can be folded,
 * scaled and diffed with no special case, and adding a string to it would
 * break `applyModifiers`, `synthesiseDuet` and `deadhunt-ranges` at once.
 */
export function beatLockOf(id: string, level: number): BeatLock | null {
  const def = instrumentDef(id);
  if (!def) return null;
  let lock: BeatLock | null = def.beat ?? null;
  const upto = Math.min(Math.max(level, 1), def.steps.length + 1) - 1;
  for (let i = 0; i < upto; i++) if (def.steps[i].beat) lock = def.steps[i].beat!;
  return lock;
}

/**
 * Fold every owned rig item into a single modifier set.
 *
 * Multiplicative fields multiply and additive fields add, which is the only
 * arrangement that makes stacking two passives mean the same thing whichever
 * order they were picked up in. `enemyTime` and `cooldown` are floored, because
 * a stack that reaches zero stops the game rather than speeding it up.
 *
 * THE TWO FLOORS BELOW CANNOT BE REACHED, and the reason is that the stack they
 * guard against does not exist. Exactly one rig item touches `cooldown` (RAPID,
 * bottoming out at 0.62) and exactly one touches `enemyTime` (TIMEWARP, now
 * 0.5), so with no second contributor there is nothing to multiply and the
 * achievable ranges are [0.62, 1] and [0.5, 1]. `tools/deadhunt-ranges.mjs`
 * enumerates every legal loadout — not a sample, the whole set — and prints
 * both.
 *
 * They stay because they are cheap and because the invariant is real the moment
 * a second cooldown or time item is added to the table, which is a likely thing
 * to happen. What must not happen is someone reading `Math.max(0.18, ...)` as
 * evidence that 0.18 is attainable and tuning against it.
 */
export function rigModifiers(owned: Readonly<Record<string, number>>): Modifiers {
  const out = noModifiers();
  for (const [id, level] of Object.entries(owned)) {
    const def = RIG_BY_ID.get(id);
    if (!def || level < 1) continue;
    const at = def.levels[Math.min(level, def.levels.length) - 1];
    if (!at) continue;
    for (const [k, v] of Object.entries(at) as [keyof Modifiers, number][]) {
      // count and maxHp add; everything else scales.
      if (k === 'count' || k === 'maxHp') out[k] += v;
      else out[k] *= v;
    }
  }
  out.cooldown = Math.max(0.18, out.cooldown);
  out.enemyTime = Math.max(0.35, out.enemyTime);
  return out;
}

/**
 * Fold every owned rig item's RULES into one set. `rigModifiers`' twin.
 *
 * Order-independent by construction, which is the property `tools/levelup.mjs`
 * already asserts for the modifier fold and now asserts for this one: every
 * field takes an extremum of its contributors rather than a running product, so
 * two passives installing the same rule cannot mean different things depending
 * on which was picked up first.
 *
 * Bigger wins, EXCEPT for `RULE_LOWER_IS_STRONGER` — "every 3rd shot" beats
 * "every 5th", and a 1.5s charge beats a 2.5s one. `Math.min` over the
 * contributors that are switched on, so an absent contributor cannot win by
 * being zero.
 *
 * Exactly one passive feeds each rule today, so every branch below is a no-op
 * on the shipped table. It is written anyway for the same reason `rigModifiers`
 * keeps its two floors: it is the correct fold the day a second contributor
 * lands, and it costs nothing. Do not read it as evidence that stacking is
 * reachable — it is not, and `tools/rulefire.mjs` prints the contributor count
 * per rule so that stays visible.
 */
export function rigRules(owned: Readonly<Record<string, number>>): Rules {
  const out = noRules();
  const lower = new Set<string>(RULE_LOWER_IS_STRONGER);
  for (const [id, level] of Object.entries(owned)) {
    const def = RIG_BY_ID.get(id);
    if (!def?.rules || level < 1) continue;
    const at = def.rules[Math.min(level, def.rules.length) - 1];
    if (!at) continue;
    for (const [k, v] of Object.entries(at) as [keyof Rules, number][]) {
      if (lower.has(k)) out[k] = out[k] > 0 ? Math.min(out[k], v) : v;
      else out[k] = Math.max(out[k], v);
    }
  }
  return out;
}

/** Apply a folded modifier set to a folded stat block. Pure; no clamping of shape. */
export function applyModifiers(s: InstrumentStats, m: Modifiers): InstrumentStats {
  return {
    interval: s.interval * m.cooldown,
    count: s.count + (s.count > 1 || s.speed > 0 ? m.count : 0),
    damage: s.damage * m.damage,
    area: s.area * m.area,
    arc: Math.min(Math.PI * 2, s.arc * (1 + (m.area - 1) * 0.5)),
    speed: s.speed * m.speed,
    // `+ m.pierce` is gone with `Modifiers.pierce`; LASER's overcharge sets
    // this field directly on the activation it fires. See the note under
    // `Modifiers`.
    pierce: s.pierce,
    bounces: s.bounces,
    linger: s.linger * m.linger,
    range: s.range * m.speed,
  };
}

/** Every ability id, in table order. Instruments first, then rig. */
export const ALL_ABILITY_IDS: readonly AbilityId[] = [
  ...INSTRUMENTS.map((d) => d.id),
  ...RIG.map((d) => d.id),
];
