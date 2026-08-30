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
 *
 * ---------------------------------------------------------------------------
 * SIX WERE ADDED ANYWAY, AND THE PARAGRAPH ABOVE IS THE REASON THEY ARE THESE
 * SIX AND NOT ANY OTHERS. Read this before reading it as a reversal.
 *
 * The rule above refuses a geometry ADDED TO MAKE A WEAPON DIFFERENT — a
 * second fan, a third cone, a star of lances that is a lance with a `count`.
 * Every one of the seven it cut answered the same question, "where does the
 * hitbox appear", and answering it a fourteenth way is what produced "all one
 * idea". That refusal stands and nothing below relaxes it.
 *
 * What `docs/plan-refactor-3.md` §9a records and this file had not spent is
 * that the two source games contribute DIFFERENT halves. Ball x Pit's is the
 * property substrate, which landed. **Vampire Survivors' is the delivery
 * vocabulary** — "attacks horizontally, fires in the faced direction,
 * boomerangs, orbits, generates zones, bounces around, strikes at random,
 * erases everything in sight, freezes in a line, shields, fires in four fixed
 * directions, zones while moving and strikes when stopping" — and almost none
 * of its weapons carries a status at all. Its roster is the mirror image of
 * the one this file shipped, and refusing its half outright on the strength of
 * a rule written about the OTHER half is how a roster ends up strong on one
 * axis and empty on the other, which is where this one was.
 *
 * SO THE TEST IS NOT "IS IT A NEW SHAPE", IT IS "DOES IT ANSWER A QUESTION THE
 * SEVEN CANNOT". Four of the six below do not answer "where does the hitbox
 * appear" at all; they answer WHEN, and there was no shape in the table that
 * could:
 *
 *   `wake`      the condition is the player MOVING. No existing shape reads
 *               the stick. Two different behaviours, chosen by it.
 *   `riposte`   the trigger is the player BEING HIT. Every other shape in the
 *               table is on a timer or a beat grid.
 *   `erase`     no aim, no travel, no target selection, one long cooldown, the
 *               whole visible field at once.
 *   `guard`     deals nothing, ever, and its activation is a CHARGE that sits
 *               there until something takes it.
 *
 * Two of them are geometry, and they are the two the source names as its own
 * distinctive deliveries rather than as variants:
 *
 *   `boomerang` out and BACK, hitting on both passes. `seek` cannot: a seek
 *               bolt is spent at its range. Ball x Pit has nothing like it.
 *   `compass`   four FIXED WORLD AXES that ignore the aim entirely. `arc`'s
 *               `count` spreads strokes around the compass but centres them on
 *               `p.aim`, so it rotates with the player; the whole point of
 *               Phiera Der Tuphello is that it does not.
 *
 * AND FOUR OF THE TEN NEW WEAPONS ADDED NO SHAPE, deliberately, because their
 * delivery already existed and the honest thing was to say so. CAESURA is a
 * `lance` with its damage set to zero; BACKBEAT is a static `arc`, which is
 * already a stroke either side of you; ALEATORY is a `strike`, which already
 * lands on a random body without travelling; CLUSTER is an `aura`. "Another
 * weapon that fires at the nearest thing" is not a shape and never was.
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
   * THE SIX FROM VAMPIRE SURVIVORS' DELIVERY VOCABULARY. See the long note
   * above `InstrumentShape` for why these six and not the other eleven.
   * ---------------------------------------------------------------------- */
  /**
   * THROWN OUT, AND IT COMES BACK THROUGH EVERYTHING IT PASSED. VS Cross.
   *
   * The one delivery in the table where a single projectile hits the same body
   * twice on purpose. It costs no new machinery: `BulletFlag.Returning`
   * reverses a bolt once at the midpoint of its own life, so the outbound and
   * inbound halves are the same bolt on the same line, and the round trip is
   * `2 * range / speed`.
   *
   * WHAT IT READS: `count` blades, `damage`, `speed`, `range` (half the round
   * trip), `interval`, `bounces` and `pierce` — a boomerang that stopped at
   * the first body would only ever return from a body's face, so `pierce` is
   * high by construction on everything wearing this shape. `area`, `arc` and
   * `linger` are unread: a blade has no blast, no fan and nothing to leave
   * behind.
   */
  | 'boomerang'
  /**
   * FOUR FIXED WORLD AXES, AND THE AIM IS NOT AN INPUT. VS Phiera Der
   * Tuphello, and VS Song of Mana for the vertical pair.
   *
   * The distinction from `arc` is the whole weapon and it is worth stating
   * flatly: `fireArc` spreads `count` strokes evenly around the compass but
   * centres them on `p.aim`, so the star rotates with the player. This one is
   * welded to the world. It is the only thing in the roster that covers your
   * back without you turning round, and the only one whose coverage the player
   * cannot aim, improve or ruin.
   *
   * WHAT IT READS: `count` bolts PER AXIS, `damage`, `speed`, `range`,
   * `interval`, `arc` (the jitter between the bolts on one axis, so a `count`
   * above one is a narrow stream rather than a stack of identical bolts) and
   * `pierce`. `area`, `linger` and `bounces` are unread.
   */
  | 'compass'
  /**
   * ZONES WHILE YOU MOVE, A STRIKE WHEN YOU STOP. VS Shadow Pinion, and VS
   * Santa Water for the zones.
   *
   * THE CONDITION IS THE DELIVERY. Nothing else in the table reads the stick:
   * FERMATA's charge does, but it is a rig RULE that scales an existing
   * weapon, and `Swell` reads the music and the encirclement. This is one
   * weapon with two behaviours and the player chooses between them by moving
   * or not moving, continuously, which is the only decision in the game that
   * is made with the left hand.
   *
   * WHAT IT READS: `interval` (the gap between drops while moving AND the
   * strike's cooldown when stopped), `count` (pools per drop while moving,
   * strikes per landing when stopped), `damage`, `area`, `linger` (how long a
   * pool lies), `range` (how far a stopped strike reaches). `speed`, `arc`,
   * `pierce` and `bounces` are unread — nothing here travels.
   */
  | 'wake'
  /**
   * IT ANSWERS WHEN YOU ARE HIT. VS Victory Sword.
   *
   * The only shape whose activation is not on a clock at all. It still folds a
   * stat block and still has an `interval`, but the interval is a FLOOR on how
   * often the answer may be given rather than a cadence — the trigger is
   * `World.onPlayerHit`, so a run that is never touched never fires it and a
   * run that is being swarmed fires it constantly. That is a weapon that is
   * worth more the worse the run is going, which nothing else in the table is.
   *
   * WHAT IT READS: `count` answering strikes, `damage`, `area` (each answer's
   * blast), `range` (how far an answer reaches for a body), `interval` (the
   * floor). `speed`, `arc`, `pierce`, `bounces` and `linger` are unread.
   */
  | 'riposte'
  /**
   * EVERYTHING ON THE SCREEN, ON A LONG COOLDOWN. VS Pentagram.
   *
   * No aim, no travel, no target selection, no falloff: the hit lands on every
   * live body inside `area` of the ship simultaneously, and `area` is set at
   * roughly the visible field. It is the only weapon in the roster whose
   * output does not depend on where anything is, which makes it the answer to
   * being surrounded and worthless against one thing at the edge of the map —
   * the exact inverse of `lance`.
   *
   * WHAT IT READS: `interval` (the cooldown, and it is long), `damage`,
   * `area` (the reach, which is the whole screen), `count` (repeats of the
   * pulse) and `linger` (how long the flash hangs). `speed`, `arc`, `pierce`,
   * `bounces` and `range` are unread.
   */
  | 'erase'
  /**
   * A CHARGE THAT EATS A HIT. IT DEALS NOTHING, EVER. VS Laurel.
   *
   * The second no-damage draftable weapon (`lance` at zero damage is the
   * other), and the reason both exist is `docs/plan-refactor-3.md` §0: VS's
   * build space has SHAPE because Laurel and Clock Lancet are in it. A roster
   * where every card is throughput is a roster where the only question is how
   * much.
   *
   * `count` charges are held, refilled one at a time on `interval`, and spent
   * by `Player.takeHit` before anything else — before the auto-bomb rescue and
   * before the WARD powerup, because a charge that regenerates on its own is
   * the cheapest thing the player is carrying. Spending one throws what hit
   * you off and applies the weapon's properties to it, which is why a shape
   * that deals no damage still carries a property honestly.
   *
   * WHAT IT READS: `count` (charges held), `interval` (seconds to refill one),
   * `area` (the discharge's shove radius), `linger` (extra invulnerability the
   * discharge grants). `damage` is deliberately NOT read and every ladder rung
   * leaves it at zero; `speed`, `arc`, `pierce`, `bounces` and `range` are
   * unread.
   */
  | 'guard'
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

  /* ---------------------------------------------------------------------- *
   * THE THREE FUSION-ONLY PROPERTIES.
   *
   * No base weapon carries any of these and that is the design: Ball x Pit's
   * fusion tier introduces mechanics its base balls do not have — radiation
   * stacks, an instant kill, damage as a share of what is left — and a lattice
   * whose every result is a re-mix of twenty base effects is the "property
   * merge" this phase exists to avoid. Three fields buy back twelve of the
   * source's fusions that would otherwise have collapsed into their parents.
   *
   * `FUSION_ONLY_PROPERTIES` names them so `tools/propfire.mjs` can hold its
   * "every property has a BASE carrier" assertion for the twenty and hand
   * these to `tools/fusefire.mjs`, which proves each one fires in a run
   * holding the fusion that installs it. Neither tool keeps its own copy.
   * ---------------------------------------------------------------------- */
  /**
   * VULN. Extra damage taken per stack, as a fraction. Ball x Pit's radiation
   * (Nuclear Bomb, X Ray, Radiation Beam), frostburn (Frozen Flame) and curse
   * (Phantom, Sacrifice) are one mechanic wearing three names: a stack that
   * makes the body softer for everything else you own.
   *
   * `PROP.freezeVuln` is the same idea hard-coded on one status, and this is
   * the general form of it. They compose: a frozen, irradiated body takes both.
   */
  vuln: number;
  /** Vuln stacks a hit applies. */
  vulnStack: number;
  /**
   * REND. Fraction of the target's CURRENT health a hit removes, on top of its
   * damage. Ball x Pit Erosion and Hemorrhage.
   *
   * Percent-of-current is the one damage shape a flat number cannot imitate:
   * it is enormous against a full-health heavy and nearly nothing against the
   * chaff a bolt would have killed anyway, which is why it is the answer to a
   * boss and not to a wave.
   */
  rend: number;
  /**
   * EXECUTE. 0..1 chance a hit simply kills a non-boss outright. Ball x Pit
   * Black Hole (kills the first thing it touches) and Reaper (10% instant).
   *
   * Never against a conductor, for the reason freeze and charm are not: a boss
   * removed by a dice roll is not a fight.
   */
  execute: number;
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
    vuln: 0,
    vulnStack: 0,
    rend: 0,
    execute: 0,
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
  vuln: ['vuln', 'vulnStack'],
  rend: ['rend'],
  execute: ['execute'],
} as const satisfies Record<string, readonly (keyof Props)[]>;

export type PropName = keyof typeof PROPERTIES;

/**
 * Properties no BASE weapon carries, only fusion results.
 *
 * `tools/propfire.mjs` asserts that every property has a base carrier, on the
 * grounds that a property only a fusion can reach is one most runs never see.
 * That assertion is right for the twenty and wrong for these three, and the
 * difference is a design decision rather than a convenience — so it is named
 * here rather than quietly excused there, and it is not a weakening: propfire
 * still fails a fusion-only property that no instrument at all installs, and
 * `tools/fusefire.mjs` additionally requires each one to FIRE, with a
 * denominator, in a run holding the fusion that declares it. Two assertions
 * replace one. AGENTS.md 3.
 */
export const FUSION_ONLY_PROPERTIES: readonly PropName[] = ['vuln', 'rend', 'execute'];

/**
 * THE SIX NEW DELIVERIES, AND WHICH COUNTERS OBSERVE EACH ONE.
 *
 * The exact argument `PROPERTIES` makes one screen up, applied to the other
 * axis. A property waits for a hit, a roll and a body that can carry it, and
 * any of the three can be missing while everything type-checks — so
 * `tools/propfire.mjs` exists. **A DELIVERY IS NO DIFFERENT AND WAS PREVIOUSLY
 * UNMEASURED**: a boomerang that never returns still throws bolts, still deals
 * its outbound damage and still passes `levelup`, `wiring`, `aimcheck` and
 * `deadhunt-ranges`; a retaliator that never retaliates fires nothing and no
 * gate in the suite can tell that from a run where the player was never hit.
 * `bounces` sat in this file as a declared stat with no consumer for the whole
 * life of the table for exactly this reason, and what let it is that nothing
 * could observe whether a bolt had ever bounced.
 *
 * So each of the six has a `World.deliveryFires` counter and a
 * `World.deliveryChances` denominator, and the two shapes with TWO behaviours
 * have two of each — `wake` is zones while moving AND a strike when stopped,
 * and half of it working would be a card that lies half the time.
 *
 * EXPORTED SO THE GATE HOLDS NO COPY, which is the `tools/contrast.mjs` lesson
 * in AGENTS.md §3: the day a shape's counters move, a second list over in
 * `tools/` would keep reporting the old ones green.
 */
export const DELIVERIES = {
  boomerang: ['boomerang'],
  compass: ['compass'],
  wake: ['wake', 'wakestrike'],
  riposte: ['riposte'],
  erase: ['erase'],
  guard: ['guard', 'guardrefill'],
} as const satisfies Partial<Record<InstrumentShape, readonly string[]>>;

/** Every delivery counter name, in table order. */
export const DELIVERY_COUNTERS: readonly string[] = Object.values(DELIVERIES).flat();

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
  /**
   * Seconds a vuln stack lasts. Long, because it is a SET-UP: the payoff is
   * whatever your other three weapons do to the body while it is soft, and a
   * two-second window would only ever be cashed by the weapon that applied it.
   * Ball x Pit's frostburn runs 20s and this is that shape kept.
   */
  vulnTime: 12,
  /** Vuln stacks a body may carry. Five at 10% each is +50% at the ceiling. */
  vulnMax: 5,
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
    blurb: '9 dmg x2, burns through up to 5 · each hit sets 1 burn stack, 12/s for 3s, to 3 stacks.',
    character: 'aggressive — coals spat, dry and crackling',
    /*
     * `pierce: 3`, and it is a density fix rather than a buff.
     *
     * The three openers were within a few percent of each other while the
     * field held about a dozen bodies. Contact-damage-only tripled that —
     * on-screen p90 went 12 to 37 — and the three stopped being comparable,
     * because two of them scale with a crowd and this one did not. LANCE puts
     * its damage through everything on a 420px line and TIMPANI carries a
     * 200px blast, so both got roughly three times better for free; EMBER
     * threw two single-target bolts before and after, and `openers` correctly
     * called it a trap at 70% against its own 70% floor.
     *
     * Piercing is the right answer rather than more damage or more bolts:
     * every other opener's crowd scaling comes from ONE hit reaching many
     * bodies, so matching that keeps the three comparable at any density
     * instead of re-tuning them against one. It is also what a thrown coal
     * should do — it does not stop at the first thing it sets alight — and it
     * means the burn STACK, which is the weapon's actual identity, now lands
     * on a line of enemies rather than on one.
     *
     * Measured: 70% -> see the commit. The `steps` ladder is untouched, so the
     * fix is at level 1 where the gate reads it.
     */
    /*
     * pierce 5, raised again with the recycling change and for the same reason
     * it was raised to 3: EMBER's crowd scaling is entirely "one bolt reaches
     * many bodies", so it tracks how tightly the crowd packs. Recycling holds
     * the population near the player, which made LANCE's 420px line and
     * TIMPANI's blast better again while EMBER stood still -- `openers` read
     * 83% before the change and 65% after, back under its own 70% floor.
     */
    base: stats({ interval: 0.5, count: 2, damage: 9, speed: 900, range: 620, pierce: 5 }),
    /*
     * burn 7 -> 12, and this rather than more pierce is what actually fixed it.
     *
     * The recycling change holds the crowd near the player, which made LANCE's
     * 420px line and TIMPANI's 200px blast better again while EMBER stood
     * still: `openers` went 83% -> 65%, back under its own 70% floor. Raising
     * pierce 3 -> 5 first moved it NOT AT ALL -- still 65% -- which is the
     * useful measurement, because it says reach was no longer the binding
     * constraint. The gate scores WAVE REACHED, so what EMBER lacked was
     * throughput, and its throughput is the burn rather than the bolt.
     *
     * 74% now. The pierce stays at 5 because a tighter crowd genuinely is more
     * bodies per bolt, but it is the tick that carries the weapon.
     */
    props: { burn: 12, burnStack: 1 },
    steps: [
      {
        note: '12 dmg x3 · burn bites 17/s a stack — three stacks on one target is 51/s for as long as it lives',
        add: { count: 1 },
        mul: { damage: 1.35 },
        prop: { burn: 17 },
      },
      {
        note: '17 dmg x4 · every coal now lands TWO stacks, so one hit takes a target most of the way to its cap',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { burn: 23, burnStack: 2 },
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

  /* ==================================================================== *
   * TEN MORE, AND THE OTHER HALF OF THE SOURCE MATERIAL.
   *
   * The twenty above are Ball x Pit: twenty composable PROPERTIES over seven
   * shapes, which is the architecture `docs/plan-refactor-3.md` §9b asks for
   * and it landed. What it did NOT spend is §9a's other paragraph — that
   * Vampire Survivors' ~70 weapons contribute the DELIVERY vocabulary, and
   * that almost none of them carries a status at all. Its roster is the mirror
   * image of the twenty: all of its interest is in HOW the thing reaches you.
   *
   * So the twenty were strong on one axis and empty on the other, and these
   * ten are taken one-to-one off that list rather than invented — the fourth
   * roster, and the first one whose entries can each be pointed at a real
   * weapon in a real game. Each row names the VS weapon it is.
   *
   * SIX OF THEM ADD A SHAPE AND FOUR DELIBERATELY DO NOT. See the long note
   * above `InstrumentShape` for the test that decided which: a shape has to
   * answer a question the seven cannot, and "another weapon that fires at the
   * nearest thing" is not one. CAESURA is a `lance` with its damage set to
   * zero, BACKBEAT a static `arc`, ALEATORY a `strike`, CLUSTER an `aura`.
   *
   * TWO OF THEM DEAL NO DAMAGE AT ALL, which is the point of including them.
   * §0 of the same plan is explicit that VS's build space has SHAPE because
   * Laurel and Clock Lancet are in it; a roster where every card is throughput
   * is a roster whose only question is how much. DAMPER and CAESURA are those
   * two, and they are the first draftable weapons in this game that do not
   * deal damage.
   *
   * THE COST IS TEN MORE CARDS IN A FOUR-CARD OFFER and it is measured rather
   * than asserted — `tools/offerpool.mjs` runs 30, 20 and 12 draftable arms
   * inside one build. AGENTS.md §5 records a change reverted for costing 31%
   * of a building player's fusions; the number for this one is in the commit.
   * ==================================================================== */

  /* --------------------------------------------------- boomerang (Cross) */
  {
    id: 'rondo',
    label: 'RONDO',
    shape: 'boomerang',
    weight: 0.9,
    blurb: '24 dmg x2, thrown and caught · it passes through everything on the way out and hits all of it again coming back.',
    character: 'mechanical — a struck rim, answered by its own return',
    /*
     * VS Cross: "aims at the nearest enemy, has boomerang effect". `pierce: 99`
     * is structural rather than generous — a blade consumed by the first body
     * would return from that body's face and the second half of the weapon
     * would not exist. `ghost` is carried for the same reason at the property
     * level, so a fusion that inherits RONDO inherits the pass-through with it.
     *
     * `range` is HALF the round trip: the bolt reverses at the midpoint of its
     * own life, so it travels `range` out and `range` back.
     */
    base: stats({ interval: 0.9, count: 2, damage: 24, speed: 780, range: 340, pierce: 99 }),
    props: { ghost: 1, bleed: 3, bleedStack: 1 },
    steps: [
      {
        note: '32 dmg x3, thrown 30% further · the return pass opens the same wound again — two bleed stacks per body per throw',
        add: { count: 1 },
        mul: { damage: 1.35, range: 1.3 },
        prop: { ghost: 1, bleed: 4 },
      },
      {
        note: '43 dmg x4, and the blades come off the walls · the line they return along is no longer the one they went out on',
        add: { count: 1, bounces: 2 },
        mul: { damage: 1.35 },
        prop: { ghost: 1, bleed: 6, bleedStack: 2 },
      },
    ],
  },
  /* ------------------------------- compass (Phiera Der Tuphello / Song of Mana) */
  {
    id: 'quadrille',
    label: 'QUADRILLE',
    shape: 'compass',
    weight: 0.9,
    blurb: '7 dmg on each of four fixed compass lines, three times a second · every bolt splits once into a clone on its first hit.',
    character: 'mechanical — four square strokes, always the same four',
    /*
     * VS Phiera Der Tuphello: "fires quickly in four fixed directions". The
     * fixed part is the weapon — see `compass` in `InstrumentShape` — and the
     * `split` property is what makes the four lines worth holding into the
     * late game, because a fixed axis cannot be pointed at the thing that
     * matters and has to pay off in volume instead.
     */
    base: stats({ interval: 0.3, count: 1, damage: 7, speed: 950, range: 520, arc: 0.06 }),
    props: { split: 1 },
    steps: [
      {
        note: '10 dmg, two bolts per axis — eight in the air at once, and where you are pointing still has nothing to do with it',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { split: 1 },
      },
      {
        note: '14 dmg, three per axis, reaching 40% further · each bolt splits TWICE, so twelve lines leave and thirty-six arrive',
        add: { count: 1 },
        mul: { damage: 1.4, range: 1.4 },
        prop: { split: 2 },
      },
    ],
  },
  /* ------------------------- wake (Shadow Pinion, and Santa Water's zones) */
  {
    id: 'ostinato',
    label: 'OSTINATO',
    shape: 'wake',
    weight: 0.9,
    blurb: '34 dmg pools dropped behind you twice a second while you steer · let go of the stick and it stops dropping and starts striking instead.',
    character: 'eerie — a figure repeated under everything else',
    /*
     * VS Shadow Pinion: "damaging zones when moving, strikes when stopping",
     * with Santa Water's random-placement zones folded into the moving half
     * rather than given a weapon of their own. Two source entries, one card,
     * because "drops pools" on its own is DETUNE with a different trigger and
     * the trigger is the only thing here that is new.
     */
    base: stats({ interval: 0.5, count: 1, damage: 34, area: 96, linger: 2.4, range: 420 }),
    props: { poison: 6, poisonStack: 1 },
    steps: [
      {
        note: 'two pools a drop, lying 60% longer · and coasting now lands two strikes instead of one',
        add: { count: 1 },
        mul: { linger: 1.6 },
        prop: { poison: 8 },
      },
      {
        note: '46 dmg, three pools, 30% wider · 11/s a stack. A corridor you have already walked is one they cannot',
        add: { count: 1 },
        mul: { damage: 1.35, area: 1.3 },
        prop: { poison: 11 },
      },
    ],
  },
  /* --------------------------------------------- riposte (Victory Sword) */
  {
    id: 'antiphon',
    label: 'ANTIPHON',
    shape: 'riposte',
    weight: 0.85,
    blurb: 'nothing at all until you are hit · then 60 dmg lands on 2 bodies at once, each shocking 180px for 30 more.',
    character: 'aggressive — a call answered louder than it was made',
    /*
     * VS Victory Sword: "strikes at the nearest enemy, retaliates". The
     * retaliation is the whole card and the strike-at-nearest half is dropped,
     * because that half is `seek` and the roster has six of those. It is
     * therefore worth MORE the worse the run is going, which nothing else in
     * the table is — and worth nothing to a player who is not being touched,
     * which is a real drawback rather than a balance number.
     *
     * `interval` is a FLOOR on how often the answer may be given, not a
     * cadence. See `riposte` in `InstrumentShape`.
     */
    base: stats({ interval: 0.8, count: 2, damage: 60, area: 150, range: 520 }),
    props: { quake: 30, quakeRadius: 180 },
    steps: [
      {
        note: '84 dmg to 3 bodies, reaching 30% further · the answer is now worth more than the hit that bought it',
        add: { count: 1 },
        mul: { damage: 1.4, range: 1.3 },
        prop: { quake: 44 },
      },
      {
        note: '118 dmg to 4, each shocking 260px for 62 · the answer clears the bodies that landed the hit off you',
        add: { count: 1 },
        mul: { damage: 1.4, area: 1.35 },
        prop: { quake: 62, quakeRadius: 260 },
      },
    ],
  },
  /* ----------------------------------------------- erase (Pentagram) */
  {
    id: 'coda',
    label: 'CODA',
    shape: 'erase',
    weight: 0.8,
    blurb: '150 dmg to every body on the screen at once, every 9s · a third of whatever survives is frozen where it stands.',
    character: 'heavy — the last bar, and nothing after it',
    /*
     * VS Pentagram: "erases everything in sight". The screen clear, on the
     * longest cooldown in the roster — and the only weapon whose output does
     * not depend on where anything is, which makes it the answer to being
     * surrounded and worthless against one thing at the edge of the map. That
     * is the exact inverse of LANCE, which is why both can be in the same
     * table.
     */
    base: stats({ interval: 9, count: 1, damage: 150, area: 620, linger: 0.5 }),
    props: { freeze: 0.35 },
    steps: [
      {
        note: '218 dmg, and the wait drops from 9s to 7s · half of what lives through it is frozen solid',
        mul: { damage: 1.45, interval: 0.78 },
        prop: { freeze: 0.5 },
      },
      {
        note: '316 dmg TWICE in a row every 5.5s · seven in ten survivors are frozen, and the second pulse lands on them',
        add: { count: 1 },
        mul: { damage: 1.45, interval: 0.78 },
        prop: { freeze: 0.7 },
      },
    ],
  },
  /* -------------------------------------- guard (Laurel) — NO DAMAGE */
  {
    id: 'damper',
    label: 'DAMPER',
    shape: 'guard',
    weight: 0.8,
    blurb: 'no damage, ever · 1 charge that eats a hit whole, throws what hit you clear and leaves it at half speed. One back every 14s.',
    character: 'mournful — the soft pedal, everything pulled back',
    /*
     * VS Laurel: "shields from damage when active". THE FIRST DRAFTABLE WEAPON
     * IN THIS GAME THAT DEALS NO DAMAGE, and `docs/plan-refactor-3.md` §0 is
     * the argument for it: VS's build space has shape because Laurel and Clock
     * Lancet are in it, and a roster where every card is throughput has only
     * one question in it.
     *
     * `damage` is 0 at every rung and `fireGuard` does not read it. The
     * property is not decoration either — a charge that breaks applies the
     * weapon's `slow` to whatever broke it, which is a real effect a
     * no-damage shape can honestly deliver, and it is what `propfire` measures
     * this weapon by.
     */
    base: stats({ interval: 14, count: 1, damage: 0, area: 240, linger: 0.8 }),
    props: { slow: 0.5 },
    steps: [
      {
        note: 'two charges instead of one, and one comes back every 10s · what breaks a charge is left at 40% speed',
        add: { count: 1 },
        mul: { interval: 0.72 },
        prop: { slow: 0.6 },
      },
      {
        note: 'three charges, one back every 7s · breaking one now buys a second and a half of invulnerability on top of eating the hit',
        add: { count: 1 },
        mul: { interval: 0.72, linger: 1.9 },
        prop: { slow: 0.7 },
      },
    ],
  },
  /* ------------------------------- lance at zero (Clock Lancet) — NO DAMAGE */
  {
    id: 'caesura',
    label: 'CAESURA',
    shape: 'lance',
    weight: 0.8,
    blurb: 'no damage, ever · a line held along your heading, and everything standing in it is frozen for as long as it stands there.',
    character: 'shimmering — the double bar, and the silence at it',
    /*
     * VS Clock Lancet: "fires a line that freezes, deals NO damage". It is a
     * `lance` and NOT a new shape, deliberately: the delivery is the held line
     * SWELL already wears, and what is new is that the damage is zero. Saying
     * that plainly is better than inventing a geometry to carry it.
     *
     * `fireLance` sets `dps = damage / interval`, so a zero here is a line
     * with no hitbox at all — and `updateEffects` still runs `applyStatus` for
     * an effect carrying a property set, on the `PROP.fieldTick` cadence, so
     * the hold lands and renews exactly as FERMATA's snare does.
     */
    base: stats({ interval: 1.1, count: 1, damage: 0, area: 16, linger: 0.5, range: 480 }),
    props: { hold: 0.6 },
    steps: [
      {
        note: 'two parallel lines, 40% longer, held four times as steadily · twice the field is simply closed',
        add: { count: 1 },
        mul: { range: 1.4, linger: 4 },
        prop: { hold: 0.6 },
      },
      {
        note: 'three lines, longer again · the hold now outlasts the beam by a second, so a body walks out of it and stays stopped',
        add: { count: 1 },
        mul: { range: 1.25 },
        prop: { hold: 1 },
      },
    ],
  },
  /* ------------------------------------------ static arc (Whip) */
  {
    id: 'backbeat',
    label: 'BACKBEAT',
    shape: 'arc',
    weight: 0.9,
    blurb: '18 dmg in a flat stroke either side of you, through everything · a third of what it catches misses half its attacks for 3s.',
    character: 'aggressive — the crack on two and four',
    /*
     * VS Whip: "attacks horizontally, passes through". A STATIC `arc` already
     * IS this — `fireArc`'s non-travelling branch spreads `count` strokes
     * evenly around the compass from `p.aim`, so a `count` of two is one
     * stroke ahead and one behind, which is the whip exactly. No shape was
     * added and the reason is written above `InstrumentShape`.
     *
     * It carries `blind` because dadbaad's own closing note says GLARE's blind
     * "is nearly pointless in this build" for want of blinded bodies rather
     * than for want of a working property — a second, much faster carrier is
     * the honest fix for that, and a whip-crack that dazzles is what the
     * property is for.
     */
    base: stats({ interval: 0.45, count: 2, damage: 18, arc: 1.15, range: 300 }),
    props: { blind: 0.35 },
    steps: [
      {
        note: '25 dmg, reaching 35% further, and four strokes rather than two — the diagonals as well as front and back',
        add: { count: 2 },
        mul: { damage: 1.4, range: 1.35, arc: 1.2 },
        prop: { blind: 0.5 },
      },
      {
        note: '35 dmg in six strokes, all round · everything the whip touches is dazzled, with no roll at all',
        add: { count: 2 },
        mul: { damage: 1.4, range: 1.2 },
        prop: { blind: 1 },
      },
    ],
  },
  /* ------------------------------------- strike, unaimed (Lightning Ring) */
  {
    id: 'aleatory',
    label: 'ALEATORY',
    shape: 'strike',
    weight: 0.9,
    blurb: '22 dmg on 3 bodies at random anywhere on screen, each arcing on to 2 more for 10 · nothing travels and nothing is aimed.',
    character: 'shimmering — chance music, struck where it falls',
    /*
     * VS Lightning Ring: "strikes at random enemies". A `strike` already lands
     * on a random live body without travelling — see `fireStrike` — so the
     * shape is right and what makes this a different weapon from TIMPANI is
     * the stat block: TIMPANI is one enormous 200px blast near you on a slow
     * clock, this is many small pinpricks across the whole field on a fast
     * one. Its 900px `range` is roughly the visible screen.
     */
    base: stats({ interval: 0.75, count: 3, damage: 22, area: 26, range: 900 }),
    props: { chain: 2, chainDamage: 10 },
    steps: [
      {
        note: '31 dmg on 4 at once, each arcing on to 3 for 15 — nothing on the screen is out of its reach',
        add: { count: 1 },
        mul: { damage: 1.4 },
        prop: { chain: 3, chainDamage: 15 },
      },
      {
        note: '43 dmg on 6, arcing to 4 for 22, and it lands nearly twice as often',
        add: { count: 2 },
        mul: { damage: 1.4, interval: 0.55 },
        prop: { chain: 4, chainDamage: 22 },
      },
    ],
  },
  /* --------------------------------------------- close aura (Garlic) */
  {
    id: 'cluster',
    label: 'CLUSTER',
    shape: 'aura',
    weight: 0.9,
    blurb: '16 dmg in a 130px ring twice a second, thrown hard off you · 5% of what it catches turns on its own side for 5s.',
    character: 'eerie — every note at once, close and low',
    /*
     * VS Garlic: "damages nearby enemies, reduces resistance to knockback".
     * An `aura` and not a new shape — GLARE is one too, and the difference is
     * the stat block and the SHOVE. `fireAura` reads `s.speed` as the ring's
     * expansion speed, and the shove is 0.8 of that, so a ring set to 980
     * throws bodies twice as hard as GLARE's default 430. That is the honest
     * reading of "reduces resistance to knockback" in a game whose only enemy
     * attack is contact: the weapon's job is to keep them off you.
     *
     * GLARE is a hard flash on the half-bar at 210px; this is a small, fast,
     * unlocked cloud you stand inside. They read as different weapons on
     * screen, which was the test.
     */
    base: stats({ interval: 0.55, count: 1, damage: 16, area: 130, speed: 980, linger: 0.25 }),
    props: { charm: 0.05 },
    steps: [
      {
        note: '23 dmg in a 175px ring that hangs before it fades · 9% of what it catches changes sides',
        mul: { damage: 1.4, area: 1.35, linger: 2.2 },
        prop: { charm: 0.09 },
      },
      {
        note: '32 dmg, 235px, two rings a pulse · 14% turn, and at this width you are pushing a hole through the crowd',
        add: { count: 1 },
        mul: { damage: 1.4, area: 1.35 },
        prop: { charm: 0.14 },
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

  /* ------------------------------------------------------------------ *
   * TEN ENDINGS FOR THE TEN VAMPIRE SURVIVORS DELIVERIES.
   *
   * `tools/levelup.mjs` fails any instrument with no evolution — "a dead end
   * to commit to" — so ten bases means ten more recipes, and every one of them
   * is free in offer terms because `progression.ts` skips `def.fused` when it
   * builds the draft pool (AGENTS.md §5).
   *
   * EVERY ONE KEEPS ITS BASE'S SHAPE, and that is the rule rather than a
   * coincidence. The shape IS what the base was added for; an ending that
   * turned the boomerang back into a seek bolt would delete the delivery this
   * whole pass exists to add, and the player would have spent three levels and
   * a catalyst to be handed a bolt.
   * ------------------------------------------------------------------ */
  {
    id: 'refrain',
    label: 'REFRAIN',
    shape: 'boomerang',
    fused: true,
    weight: 0,
    blurb: '62 dmg x5 out and back · 3 bleed stacks on each pass, and every body it passes arcs on to 2 more for 24.',
    character: 'mechanical — the theme returning, and returning',
    base: stats({ interval: 0.55, count: 5, damage: 62, speed: 900, range: 620, pierce: 99, bounces: 3 }),
    props: { ghost: 1, bleed: 9, bleedStack: 3, chain: 2, chainDamage: 24 },
    steps: [],
  },
  {
    id: 'reel',
    label: 'REEL',
    shape: 'compass',
    fused: true,
    weight: 0,
    blurb: '16 dmg, three bolts on each of four fixed axes, six times a second · each splits three times and scatters 3 more when it lands.',
    character: 'mechanical — a reel, four square and relentless',
    base: stats({ interval: 0.16, count: 3, damage: 16, speed: 1100, range: 760, arc: 0.1 }),
    props: { split: 3, burst: 3 },
    steps: [],
  },
  {
    id: 'groundbass',
    label: 'GROUND BASS',
    shape: 'wake',
    fused: true,
    weight: 0,
    blurb: '78 dmg pools three at a time, lying for 4.5s · 2 poison stacks and a 40% drag on anything wading through your wake.',
    character: 'eerie — the same bass, under everything, forever',
    base: stats({ interval: 0.34, count: 3, damage: 78, area: 150, linger: 4.5, range: 620 }),
    props: { poison: 18, poisonStack: 2, slow: 0.4 },
    steps: [],
  },
  {
    id: 'responsory',
    label: 'RESPONSORY',
    shape: 'riposte',
    fused: true,
    weight: 0,
    blurb: '210 dmg to 6 bodies the moment you are touched · each shocks 380px for 130, and everything caught takes 12% more per stack.',
    character: 'aggressive — the choir answering the cantor, twice as loud',
    base: stats({ interval: 0.4, count: 6, damage: 210, area: 320, range: 760 }),
    props: { quake: 130, quakeRadius: 380, vuln: 0.12, vulnStack: 2 },
    steps: [],
  },
  {
    id: 'finale',
    label: 'FINALE',
    shape: 'erase',
    fused: true,
    weight: 0,
    blurb: '520 dmg to everything on the screen, three times over, every 4.2s · every survivor is frozen solid and takes 15% more per stack.',
    character: 'heavy — the last page, all of it at once',
    base: stats({ interval: 4.2, count: 3, damage: 520, area: 900, linger: 0.9 }),
    props: { freeze: 1, vuln: 0.15, vulnStack: 2 },
    steps: [],
  },
  {
    id: 'unacorda',
    label: 'UNA CORDA',
    shape: 'guard',
    fused: true,
    weight: 0,
    blurb: 'no damage · five charges, one back every 4s · breaking one freezes everything within 460px and buys 2.6s of invulnerability.',
    character: 'mournful — one string, and the room gone quiet',
    base: stats({ interval: 4, count: 5, damage: 0, area: 460, linger: 2.6 }),
    props: { slow: 0.85, freeze: 1, hold: 1.4 },
    steps: [],
  },
  {
    id: 'grandpause',
    label: 'GRAND PAUSE',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: 'no damage · five held lines reaching 900px, and everything standing in any of them is frozen for two seconds past leaving it.',
    character: 'shimmering — G.P., and nobody plays',
    base: stats({ interval: 0.9, count: 5, damage: 0, area: 26, linger: 3, range: 900 }),
    props: { hold: 2, slow: 0.8 },
    steps: [],
  },
  {
    id: 'flam',
    label: 'FLAM',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '52 dmg in six strokes all round, three times a second · everything caught is blinded and takes 3 bleed stacks.',
    character: 'aggressive — two sticks, a hair apart',
    base: stats({ interval: 0.3, count: 6, damage: 52, arc: 2.4, range: 560 }),
    props: { blind: 1, bleed: 7, bleedStack: 3 },
    steps: [],
  },
  {
    id: 'stochastic',
    label: 'STOCHASTIC',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '62 dmg on 8 bodies at random anywhere, twice a second · each arcs on to 5 more for 40, and half of what it touches is blinded.',
    character: 'shimmering — a cloud of events, none of them chosen',
    base: stats({ interval: 0.4, count: 8, damage: 62, area: 40, range: 1100 }),
    props: { chain: 5, chainDamage: 40, blind: 0.5 },
    steps: [],
  },
  {
    id: 'tamtam',
    label: 'TAM-TAM',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '58 dmg in a 330px ring three times a second, thrown hard · 30% of what it catches changes sides and the rest is slowed 70%.',
    character: 'heavy — one enormous gong, still ringing',
    base: stats({ interval: 0.35, count: 2, damage: 58, area: 330, speed: 1100, linger: 0.5 }),
    props: { charm: 0.3, slow: 0.7, quake: 60, quakeRadius: 220 },
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

  /* ------------------------------------------------------------------ *
   * THE LATTICE - sixty-three authored results for INSTRUMENT PAIRS.
   *
   * See the note above `FUSIONS` for the recipes and for what was cut. Two
   * things about the rows themselves:
   *
   * EVERY ONE INHERITS BOTH PARENTS' PROPERTIES AND THEN ADDS. The sets
   * below were generated as `mergeProps(parentA@3, parentB@3)` plus an
   * authored delta, so an arrangement is never weaker than the generic duet
   * it shadows - and since `readyDuets` refuses a pair that has a named
   * recipe, a weaker result would be a trap the player could not see. The
   * DELTA is the fusion: it is the property the pair does not already have,
   * and `tools/fusefire.mjs` proves each delta actually fires.
   *
   * DAMAGE IS 1.6x THE BETTER PARENT (1.5x for the tier-two chains), for the
   * same reason: `synthesiseDuet` rescales to 1.5x, so this clears the
   * fallback by a margin at every pair.
   *
   * ------------------------------------------------------------------
   * SEVEN `burn` FIELDS WENT 14 -> 23, AND THE REASON IS A GATE THAT WAS
   * ALREADY RED BEFORE THIS PASS TOUCHED ANYTHING.
   *
   * `a4a553a` raised EMBER's ladder to `burn 12/17/23` — a density fix, and a
   * good one — and `tools/fusefire.mjs` was not re-run. Seven rows below were
   * authored against the old `burn: 14` ceiling, so from that commit onward
   * BOMB, FROSTFIRE, INFERNO, MAGMA, BRIMSTONE, SUN and FIREWORKS each carried
   * a WEAKER burn than the generic duet they shadow: spending two maxed
   * instruments on an authored arrangement bought a worse card than not
   * having one, and `readyDuets` refuses the pair once a recipe exists, so
   * the player could not even see the better option.
   *
   * That is precisely the defect 31c8756 wrote this gate to catch — its own
   * commit message records "ALL 63 ROWS WERE WEAKER THAN THEIR OWN FALLBACK"
   * as the first thing it found. It found it again. Verified red at `fb3db55`
   * in a detached worktree before this edit, with these seven named and no
   * others.
   * ------------------------------------------------------------------ */
  {
    id: 'detonate',
    label: 'BOMB',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '170 dmg x2, weighted 2.75x by the iron · every hit blows a 250px ring for 95 and leaves 2 burn stacks.',
    character: 'heavy — a bass drum with a fuse in it',
    base: stats({ interval: 1, count: 2, speed: 820, range: 700, damage: 170 }),
    props: { burn: 23, burnStack: 2, quake: 95, quakeRadius: 250, heavy: 2.75 },
    steps: [],
  },
  {
    id: 'frostfire',
    label: 'FROSTFIRE',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '37 dmg x3 · frostburn: every hit stacks +10% damage taken, to five, and it still burns and freezes.',
    character: 'shimmering — struck glass over a live coal',
    base: stats({ interval: 0.3, count: 3, speed: 1000, range: 620, damage: 37 }),
    props: { burn: 23, burnStack: 2, freeze: 0.14, vuln: 0.1, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'inferno',
    label: 'INFERNO',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '171 dmg in a 330px ring around you, twice a second · everything in it burns at 14/s a stack and is slowed 60%.',
    character: 'aggressive — a wall of fire, roaring',
    base: stats({ interval: 0.45, count: 1, area: 330, linger: 0.5, damage: 171 }),
    props: { burn: 23, burnStack: 2, slow: 0.6 },
    steps: [],
  },
  {
    id: 'magma',
    label: 'MAGMA',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '212 dmg per gout, three of them, lying where they fall for 4s · anything wading takes 2 burn stacks, 14/s each.',
    character: 'heavy — lava, dropped in gouts',
    base: stats({ interval: 1.3, count: 3, area: 150, linger: 4, damage: 212 }),
    props: { burn: 23, burnStack: 2, quake: 96, quakeRadius: 330 },
    steps: [],
  },
  {
    id: 'brimstone',
    label: 'BRIMSTONE',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '176 dmg in a 290px ring · everything caught takes BOTH burn and poison stacks, 14/s and 12/s a stack.',
    character: 'eerie — sulphur, hissing',
    base: stats({ interval: 0.5, count: 1, area: 290, linger: 0.45, damage: 176 }),
    props: { burn: 23, burnStack: 2, poison: 12, poisonStack: 2, erode: 0.25, erodeFloor: 0.6 },
    steps: [],
  },
  {
    id: 'sun',
    label: 'SUN',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '2134 dmg where it is dropped, and it hangs for 6s · everything inside 520px of it is blinded and burning.',
    character: 'shimmering — one unbearable sustained chord',
    base: stats({ interval: 2.6, count: 1, area: 520, linger: 6, damage: 2134 }),
    props: { burn: 23, burnStack: 2, blind: 1 },
    steps: [],
  },
  {
    id: 'fireworks',
    label: 'FIREWORKS',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '76 dmg x4 lobbed in a spread · wherever one lands 6 more go out from it, and each sets 2 burn stacks.',
    character: 'shimmering — rockets, and then the report',
    base: stats({ interval: 0.9, count: 4, arc: 1.4, speed: 900, range: 600, damage: 76 }),
    props: { burn: 23, burnStack: 2, burst: 6 },
    steps: [],
  },
  {
    id: 'timestop',
    label: 'TIMESTOP',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '2240 dmg, and EVERYTHING within 640px stops dead for 5s · once every six seconds, and never a boss.',
    character: 'eerie — everything stops, and one note hangs',
    base: stats({ interval: 6, count: 1, area: 640, linger: 1.2, damage: 2240 }),
    props: { freeze: 1, hold: 5 },
    steps: [],
  },
  {
    id: 'frostray',
    label: 'FROSTRAY',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '75 dmg/s in two held beams reaching 820px · a quarter of everything the line touches freezes solid.',
    character: 'shimmering — a glass rod drawn out',
    base: stats({ interval: 0.4, count: 2, area: 16, linger: 0.8, range: 820, damage: 75 }),
    props: { freeze: 0.25, lance: 46, lanceRange: 680 },
    steps: [],
  },
  {
    id: 'blizzard',
    label: 'BLIZZARD',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '266 dmg in a 420px whiteout · half of everything caught freezes outright, and the rest is slowed 60%.',
    character: 'shimmering — a whiteout, all noise and no pitch',
    base: stats({ interval: 0.7, count: 1, area: 420, linger: 0.6, damage: 266 }),
    props: { freeze: 0.5, slow: 0.6 },
    steps: [],
  },
  {
    id: 'glacier',
    label: 'GLACIER',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '359 dmg x3 in spikes standing for 6s · whatever touches one is HELD where it stands, no roll needed.',
    character: 'heavy — ice, grinding',
    base: stats({ interval: 2.2, count: 3, area: 210, linger: 6, damage: 359 }),
    props: { freeze: 0.6, quake: 96, quakeRadius: 330, hold: 1.5 },
    steps: [],
  },
  {
    id: 'venom',
    label: 'VENOM',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '44 dmg x3 · venom stacks that BOTH rot at 14/s and take 55% of the speed. Five stacks, six seconds.',
    character: 'eerie — a slow chromatic slide downward',
    base: stats({ interval: 0.35, count: 3, speed: 950, range: 640, damage: 44 }),
    props: { poison: 14, poisonStack: 2, freeze: 0.12, slow: 0.55 },
    steps: [],
  },
  {
    id: 'wraith',
    label: 'WRAITH',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '62 dmg x3 passing through everything · anything the wraith crosses is HELD where it stands, no roll.',
    character: 'mournful — a cold breath crossing the room',
    base: stats({ interval: 0.5, count: 3, speed: 1000, pierce: 99, range: 1200, damage: 62 }),
    props: { freeze: 0.3, ghost: 1, hold: 0.9 },
    steps: [],
  },
  {
    id: 'swamp',
    label: 'SWAMP',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '261 dmg x3 tar pools lying for 5.5s · anything wading takes 2 poison stacks at 16/s AND loses half its speed.',
    character: 'eerie — tar, bubbling',
    base: stats({ interval: 1.6, count: 3, area: 190, linger: 5.5, damage: 261 }),
    props: { poison: 16, poisonStack: 2, slow: 0.5, quake: 96, quakeRadius: 330 },
    steps: [],
  },
  {
    id: 'virus',
    label: 'VIRUS',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '48 dmg x3 · the disease SPREADS — every hit jumps to 4 more bodies for 22 and infects each of them too.',
    character: 'eerie — one voice infecting the next',
    base: stats({ interval: 0.3, count: 3, speed: 920, range: 640, damage: 48 }),
    props: { poison: 10, poisonStack: 1, bleed: 4, bleedStack: 2, chain: 4, chainDamage: 22 },
    steps: [],
  },
  {
    id: 'noxious',
    label: 'NOXIOUS',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '905 dmg in a 400px cloud · everything in it takes 2 poison stacks at 18/s, and 70% of it is blinded.',
    character: 'eerie — a low cloud that will not lift',
    base: stats({ interval: 0.9, count: 1, area: 400, linger: 0.6, damage: 905 }),
    props: { poison: 18, poisonStack: 2, blind: 0.7 },
    steps: [],
  },
  {
    id: 'radiation',
    label: 'RADIATION',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '71 dmg/s in two held beams · every touch is a radiation stack, +10% damage taken, to five. And it rots.',
    character: 'eerie — a sustained cluster, humming',
    base: stats({ interval: 0.45, count: 2, area: 16, linger: 0.85, range: 860, damage: 71 }),
    props: { poison: 14, poisonStack: 2, lance: 46, lanceRange: 680, vuln: 0.1, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'hemorrhage',
    label: 'HEMORRHAGE',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '80 dmg x3, weighted by the iron · every hit also takes 6% of whatever health is LEFT, and leaves 3 bleeds.',
    character: 'aggressive — a saw drawn across a wound',
    base: stats({ interval: 0.5, count: 3, speed: 850, range: 620, damage: 80 }),
    props: { bleed: 7, bleedStack: 3, heavy: 2.75, rend: 0.06 },
    steps: [],
  },
  {
    id: 'sacrifice',
    label: 'SACRIFICE',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '352 dmg x2, tripled by the dark · bleeds AND curses: +12% damage taken a stack. Then it goes quiet 1.8s.',
    character: 'mournful — a chord struck once and left to ring',
    base: stats({ interval: 0.7, count: 2, speed: 950, range: 780, damage: 352 }),
    props: { bleed: 7, bleedStack: 3, dark: 3.6, darkCooldown: 1.8, vuln: 0.12, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'heartswallower',
    label: 'HEARTSWALLOWER',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '48 dmg x4 passing through everything · 12% of hits take a point of health off them and give it to you.',
    character: 'mournful — something drawing breath through you',
    base: stats({ interval: 0.4, count: 4, speed: 980, pierce: 99, range: 1200, damage: 48 }),
    props: { bleed: 6, bleedStack: 3, leech: 0.12, ghost: 1 },
    steps: [],
  },
  {
    id: 'vampirelord',
    label: 'VAMPIRELORD',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '27 dmg x5, very fast · a quarter of hits heal you, and 7% simply CONSUME a non-boss outright.',
    character: 'aggressive — a fast, hungry ostinato',
    base: stats({ interval: 0.28, count: 5, speed: 950, range: 640, damage: 27 }),
    props: { bleed: 8, bleedStack: 3, leech: 0.25, execute: 0.07 },
    steps: [],
  },
  {
    id: 'berserk',
    label: 'BERSERK',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '239 dmg in a 300px ring · 30% of everything caught turns and fights its own neighbours for 5s.',
    character: 'aggressive — a march that turns on itself',
    base: stats({ interval: 0.5, count: 1, area: 300, linger: 0.4, damage: 239 }),
    props: { bleed: 6, bleedStack: 2, charm: 0.3 },
    steps: [],
  },
  {
    id: 'storm',
    label: 'STORM',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '66 dmg x4 strikes landing ON things, unaimed · each arcs to 6 more for 40 and slows all of them 60%.',
    character: 'mechanical — thunder, arriving in sheets',
    base: stats({ interval: 0.7, count: 4, area: 130, range: 900, damage: 66 }),
    props: { slow: 0.6, chain: 6, chainDamage: 40 },
    steps: [],
  },
  {
    id: 'flash',
    label: 'FLASH',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '246 dmg x2 · every hit blinds and damages EVERYTHING within 900px for 55, then arcs to 8 more for 46.',
    character: 'shimmering — a cymbal choke and a white flash',
    base: stats({ interval: 0.6, count: 2, speed: 1200, range: 760, damage: 246 }),
    props: { blind: 1, chain: 8, chainDamage: 46, quake: 55, quakeRadius: 900 },
    steps: [],
  },
  {
    id: 'rod',
    label: 'ROD',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '183 dmg x2 rods driven into whatever is out there · every strike arcs to 8 nearby for 44.',
    character: 'mechanical — a rod struck on the three',
    base: stats({ interval: 1.4, count: 2, area: 180, range: 900, damage: 183 }),
    props: { chain: 8, chainDamage: 44 },
    steps: [],
  },
  {
    id: 'lightningbug',
    label: 'LIGHTNINGBUG',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '38 dmg x5 sprayed wide · half of what they touch sends a hunter out, and every hit arcs to 4 more.',
    character: 'mechanical — small sparks, everywhere at once',
    base: stats({ interval: 0.5, count: 5, arc: 2, speed: 900, range: 620, damage: 38 }),
    props: { chain: 5, chainDamage: 28, brood: 0.5 },
    steps: [],
  },
  {
    id: 'sandstorm',
    label: 'SANDSTORM',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '82 dmg x3 passing through everything · 60% of what it crosses is blinded, all of it slowed and shocked.',
    character: 'mechanical — grit in the mechanism',
    base: stats({ interval: 0.5, count: 3, speed: 880, pierce: 99, range: 1100, damage: 82 }),
    props: { blind: 0.6, slow: 0.6, quake: 96, quakeRadius: 330, ghost: 1 },
    steps: [],
  },
  {
    id: 'erosion',
    label: 'EROSION',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '70 dmg x3 passing through everything · each pass also takes 8% of the health a body has LEFT.',
    character: 'mournful — a long decay that never quite ends',
    base: stats({ interval: 0.55, count: 3, speed: 900, pierce: 99, range: 1200, damage: 70 }),
    props: { slow: 0.6, ghost: 1, hold: 1.2, rend: 0.08 },
    steps: [],
  },
  {
    id: 'shade',
    label: 'SHADE',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '377 dmg x2, tripled by the dark, passing through everything · every body it crosses is cursed, +14% a stack.',
    character: 'mournful — a curse, whispered',
    base: stats({ interval: 0.75, count: 2, speed: 1000, pierce: 99, range: 1200, damage: 377 }),
    props: { ghost: 1, dark: 3.6, darkCooldown: 1.8, vuln: 0.14, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'assassin',
    label: 'ASSASSIN',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '156 dmg x2, weighted by the iron, passing through everything · 7% of hits kill a non-boss outright.',
    character: 'mechanical — one note, precisely placed',
    base: stats({ interval: 0.9, count: 2, speed: 1150, pierce: 99, range: 1300, damage: 156 }),
    props: { ghost: 1, heavy: 2.75, execute: 0.07 },
    steps: [],
  },
  {
    id: 'soulsucker',
    label: 'SOULSUCKER',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '54 dmg x3 passing through everything · 30% of hits heal you, and half of what it crosses is blinded.',
    character: 'mournful — breath drawn out of the room',
    base: stats({ interval: 0.45, count: 3, speed: 900, pierce: 99, range: 1200, damage: 54 }),
    props: { blind: 0.5, leech: 0.3, ghost: 1 },
    steps: [],
  },
  {
    id: 'temper',
    label: 'TEMPER',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '212 dmg x2, 3.2x and a third of the speed · each blow leaves the metal softer: +12% damage taken a stack.',
    character: 'heavy — struck steel, enormous',
    base: stats({ interval: 1.2, count: 2, speed: 700, pierce: 99, range: 900, damage: 212 }),
    props: { erode: 0.15, erodeFloor: 0.75, heavy: 3.2, vuln: 0.12, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'drill',
    label: 'DRILL',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '245 dmg x2, weighted by the iron, pierces everything · it also cuts a 300px line through each body it enters.',
    character: 'heavy — a drum roll boring through',
    base: stats({ interval: 1, count: 2, speed: 760, pierce: 99, range: 1000, damage: 245 }),
    props: { quake: 96, quakeRadius: 330, lance: 40, lanceRange: 300, heavy: 2.75 },
    steps: [],
  },
  {
    id: 'sforzando',
    label: 'SFORZANDO',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '78 dmg x3 in a heavy close spread, weighted by the iron · wherever one lands, 7 more go out from it.',
    character: 'aggressive — one enormous accent, then shrapnel',
    base: stats({ interval: 1.1, count: 3, arc: 1.1, speed: 900, bounces: 2, range: 560, damage: 78 }),
    props: { burst: 7, heavy: 2.75 },
    steps: [],
  },
  {
    id: 'cutter',
    label: 'CUTTER',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '97 dmg x2, weighted 2.4x and slow with it · every body it enters is cut 700px through, front and back.',
    character: 'mechanical — a cutting head, never lifting',
    base: stats({ interval: 0.55, count: 2, speed: 640, pierce: 99, range: 900, damage: 97 }),
    props: { lance: 70, lanceRange: 700, erode: 0.25, erodeFloor: 0.6, heavy: 2.4 },
    steps: [],
  },
  {
    id: 'catapult',
    label: 'CATAPULT',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '129 dmg x3 stones lobbed in a spread · each shocks 170px on contact and throws 6 more out of the impact.',
    character: 'heavy — stones thrown, and landing',
    base: stats({ interval: 1.1, count: 3, arc: 1.3, speed: 620, pierce: 99, range: 700, damage: 129 }),
    props: { quake: 45, quakeRadius: 170, burst: 6, erode: 0.25, erodeFloor: 0.6 },
    steps: [],
  },
  {
    id: 'petrify',
    label: 'PETRIFY',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '159 dmg/s in two held beams · everything standing in the line is HELD, no roll, for as long as it is lit.',
    character: 'heavy — everything in the line stops',
    base: stats({ interval: 0.9, count: 2, area: 20, linger: 0.9, range: 760, damage: 159 }),
    props: { erode: 0.25, erodeFloor: 0.6, accel: 0.45, hold: 1.4 },
    steps: [],
  },
  {
    id: 'landslide',
    label: 'LANDSLIDE',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '196 dmg x3 landing across the field, unaimed · each one shocks everything within 300px for 130 more.',
    character: 'heavy — the whole low end coming down',
    base: stats({ interval: 1.2, count: 3, area: 200, range: 900, damage: 196 }),
    props: { quake: 130, quakeRadius: 330, erode: 0.25, erodeFloor: 0.6 },
    steps: [],
  },
  {
    id: 'flicker',
    label: 'FLICKER',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '235 dmg x6 landing across the whole screen at once, unaimed · everything they touch is blinded outright.',
    character: 'eerie — a lamp failing, over and over',
    base: stats({ interval: 1.4, count: 6, area: 150, range: 1100, damage: 235 }),
    props: { blind: 1 },
    steps: [],
  },
  {
    id: 'incubus',
    label: 'INCUBUS',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: '754 dmg x2 shadows lying for 5s · 28% of whatever walks into one walks back out fighting for you.',
    character: 'eerie — a seductive minor line',
    base: stats({ interval: 1.5, count: 2, area: 200, linger: 5, damage: 754 }),
    props: { charm: 0.28 },
    steps: [],
  },
  {
    id: 'warp',
    label: 'WARP',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '903 dmg in a 380px bubble · time drags in it: everything is HELD and blinded, and slowed 50% on the way out.',
    character: 'shimmering — a bar that will not end',
    base: stats({ interval: 1.1, count: 1, area: 380, linger: 0.7, damage: 903 }),
    props: { blind: 1, slow: 0.5, hold: 1.6 },
    steps: [],
  },
  {
    id: 'succubus',
    label: 'SUCCUBUS',
    shape: 'orbit',
    fused: true,
    weight: 0,
    blurb: '44 dmg from four attendants circling you · 26% of what they touch turns, and their hits keep healing you.',
    character: 'shimmering — two voices, one of them lying',
    base: stats({ interval: 0.4, count: 4, area: 140, speed: 940, range: 660, damage: 44 }),
    props: { charm: 0.26, leech: 0.12 },
    steps: [],
  },
  {
    id: 'zombie',
    label: 'ZOMBIE',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '40 dmg x4, faster off every wall · 35% of what it hits gets back up and fights on your side for 5s.',
    character: 'eerie — a shuffling figure that will not stop repeating',
    base: stats({ interval: 0.45, count: 4, speed: 700, bounces: 6, range: 0, damage: 40 }),
    props: { charm: 0.35, leech: 0.12, accel: 0.45 },
    steps: [],
  },
  {
    id: 'mosquitoswarm',
    label: 'MOSQUITOSWARM',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '98 dmg x4 in a spraying swarm · seven more come out of wherever one lands, and hits still heal you.',
    character: 'mechanical — a cloud of small fast things',
    base: stats({ interval: 1.1, count: 4, arc: 1.6, speed: 880, range: 620, damage: 98 }),
    props: { leech: 0.12, burst: 7 },
    steps: [],
  },
  {
    id: 'mosquitoking',
    label: 'MOSQUITOKING',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '63 dmg x3 · 55% of hits send a hunter out after something else, and the hits still heal you.',
    character: 'mechanical — a swarm with a leader',
    base: stats({ interval: 0.5, count: 3, speed: 920, range: 700, damage: 63 }),
    props: { leech: 0.12, brood: 0.55 },
    steps: [],
  },
  {
    id: 'offspring',
    label: 'OFFSPRING',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '37 dmg x3 splitting FIVE times instead of twice · and every one of them is faster off every wall.',
    character: 'eerie — a figure answering itself, faster each time',
    base: stats({ interval: 0.4, count: 3, speed: 760, bounces: 8, range: 0, damage: 37 }),
    props: { split: 5, accel: 0.5 },
    steps: [],
  },
  {
    id: 'clutch',
    label: 'CLUTCH',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '49 dmg x3 that split, scatter AND hatch · 40% of hits send a hunter out on top of the burst.',
    character: 'eerie — a cell dividing, wetly',
    base: stats({ interval: 0.7, count: 3, speed: 880, range: 700, damage: 49 }),
    props: { split: 4, burst: 6, brood: 0.4 },
    steps: [],
  },
  {
    id: 'overgrowth',
    label: 'OVERGROWTH',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '131 dmg x3 landing ON things, unaimed · each one shocks everything within 360px for 130 more.',
    character: 'heavy — growth, and then a collapse',
    base: stats({ interval: 0.8, count: 3, area: 170, range: 820, damage: 131 }),
    props: { quake: 130, quakeRadius: 360, split: 4 },
    steps: [],
  },
  {
    id: 'maggot',
    label: 'MAGGOT',
    shape: 'orbit',
    fused: true,
    weight: 0,
    blurb: '34 dmg from five circling pods · hits split, send hunters, AND scatter 5 lesser bolts out of the body.',
    character: 'eerie — something small, multiplying',
    base: stats({ interval: 0.45, count: 5, area: 130, speed: 880, range: 660, damage: 34 }),
    props: { split: 4, burst: 5, brood: 0.5 },
    steps: [],
  },
  {
    id: 'spiderqueen',
    label: 'SPIDERQUEEN',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '76 dmg x3 · 60% of hits birth a hunter, and 6 lesser bolts go out of the same body with it.',
    character: 'eerie — a nest, waking',
    base: stats({ interval: 0.6, count: 3, speed: 880, range: 680, damage: 76 }),
    props: { burst: 6, brood: 0.6 },
    steps: [],
  },
  {
    id: 'leeches',
    label: 'LEECHES',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '48 dmg x4 · 55% of hits attach a hunter, and every hit leaves 3 bleed stacks costing 7 more each.',
    character: 'aggressive — many small mouths',
    base: stats({ interval: 0.4, count: 4, speed: 900, range: 660, damage: 48 }),
    props: { bleed: 7, bleedStack: 3, brood: 0.55 },
    steps: [],
  },
  {
    id: 'fleshmound',
    label: 'FLESHMOUND',
    shape: 'orbit',
    fused: true,
    weight: 0,
    blurb: '38 dmg from five circling pods, faster off every wall · 60% of what they touch sends a hunter out.',
    character: 'eerie — a heap that keeps producing',
    base: stats({ interval: 0.5, count: 5, area: 150, speed: 820, range: 620, damage: 38 }),
    props: { brood: 0.6, accel: 0.5 },
    steps: [],
  },
  {
    id: 'lovestruck',
    label: 'LOVESTRUCK',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '574 dmg in a 430px ring · everything caught is blinded, and 30% of it turns and fights its own side.',
    character: 'shimmering — a love duet, badly timed',
    base: stats({ interval: 0.7, count: 1, area: 430, linger: 0.6, damage: 574 }),
    props: { blind: 1, charm: 0.3 },
    steps: [],
  },
  {
    id: 'beam',
    label: 'BEAM',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '164 dmg/s in two held beams reaching 880px · everything the line touches is blinded outright.',
    character: 'shimmering — one blinding sustained line',
    base: stats({ interval: 0.4, count: 2, area: 18, linger: 0.85, range: 880, damage: 164 }),
    props: { blind: 1, lance: 46, lanceRange: 680 },
    steps: [],
  },
  {
    id: 'fallout',
    label: 'FALLOUT',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '425 dmg x2, weighted by the iron · a 330px blast for 140, and 2 radiation stacks: +12% damage taken each.',
    character: 'heavy — the low end of the world falling out',
    base: stats({ interval: 1, count: 2, speed: 800, range: 720, damage: 425 }),
    props: { burn: 23, burnStack: 2, poison: 10, poisonStack: 1, quake: 140, quakeRadius: 330, heavy: 2.75, vuln: 0.12, vulnStack: 2 },
    steps: [],
  },
  {
    id: 'timebomb',
    label: 'TIMEBOMB',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '340 dmg x3 shells landing ON things · each blows 300px for 130 and HOLDS everything left in the crater.',
    character: 'heavy — a fuse, and then the one',
    base: stats({ interval: 1.2, count: 3, area: 160, range: 900, damage: 340 }),
    props: { burn: 23, burnStack: 2, quake: 130, quakeRadius: 300, hold: 1.2 },
    steps: [],
  },
  {
    id: 'armageddon',
    label: 'ARMAGEDDON',
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: '111 dmg x3 landing three times a second · each shocks 220px, arcs to 6 more, and sets 3 burn stacks.',
    character: 'aggressive — a meteor shower with no gaps in it',
    base: stats({ interval: 0.35, count: 3, area: 150, range: 1000, damage: 111 }),
    props: { burn: 24, burnStack: 3, slow: 0.6, chain: 6, chainDamage: 40, quake: 80, quakeRadius: 220 },
    steps: [],
  },
  {
    id: 'banshee',
    label: 'BANSHEE',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: '3265 dmg in a 700px scream · EVERYTHING in it is cursed twice over, blinded, and 40% of it freezes solid.',
    character: 'mournful — a scream that curses the whole room',
    base: stats({ interval: 1.3, count: 1, area: 700, linger: 0.8, damage: 3265 }),
    props: { freeze: 0.4, blind: 1, ghost: 1, hold: 0.9, vuln: 0.16, vulnStack: 2 },
    steps: [],
  },
  {
    id: 'reaper',
    label: 'REAPER',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '126 dmg x4 passing through everything · 12% of hits simply take a non-boss, and 35% of them heal you.',
    character: 'mournful — the last chord, and nothing after it',
    base: stats({ interval: 0.42, count: 4, speed: 980, pierce: 99, range: 1300, damage: 126 }),
    props: { bleed: 6, bleedStack: 3, blind: 0.5, leech: 0.35, ghost: 1, execute: 0.12 },
    steps: [],
  },
  {
    id: 'eventhorizon',
    label: 'EVENTHORIZON',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '1230 dmg x2, tripled by the dark · 30% of what they touch is simply gone. Then the weapon goes quiet.',
    character: 'eerie — a single note that swallows the bar',
    base: stats({ interval: 1.2, count: 2, speed: 900, range: 800, damage: 1230 }),
    props: { burn: 23, burnStack: 2, blind: 1, dark: 3.6, darkCooldown: 1.8, execute: 0.3 },
    steps: [],
  },
  {
    id: 'xray',
    label: 'XRAY',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '256 dmg x4 cutting 640px through every body they enter · each touch is 2 radiation stacks, +24% taken.',
    character: 'shimmering — four lines crossing, all of them lit',
    base: stats({ interval: 0.5, count: 4, speed: 1100, pierce: 99, range: 1100, damage: 256 }),
    props: { blind: 1, lance: 80, lanceRange: 700, erode: 0.25, erodeFloor: 0.6, heavy: 2.4, vuln: 0.12, vulnStack: 2 },
    steps: [],
  },
  {
    id: 'sniper',
    label: 'SNIPER',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '433 dmg x2, weighted by the iron · each shot cuts 700px through everything, and 12% of hits end a body.',
    character: 'mechanical — one shot, and a very long silence',
    base: stats({ interval: 1, count: 2, speed: 1600, pierce: 99, range: 1500, damage: 433 }),
    props: { lance: 70, lanceRange: 700, burst: 7, ghost: 1, heavy: 2.75, execute: 0.12 },
    steps: [],
  },
  {
    id: 'diabolus',
    label: 'DIABOLUS',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: '460 dmg x3 · 45% of hits turn a body against its own side, and the rest take +30% from everything.',
    character: 'eerie — the tritone, held',
    base: stats({ interval: 0.55, count: 3, speed: 950, range: 700, damage: 460 }),
    props: { charm: 0.45, leech: 0.12, vuln: 0.15, vulnStack: 2 },
    steps: [],
  },

  /* ------------------------------------------------------------------ *
   * SEVEN AUTHORED PAIRS FOR THE NEW DELIVERIES — a handful, not sixty.
   *
   * `C(30,2)` is 435 pairs and `synthesiseDuet` already covers every one of
   * them, so nothing is a dead end and the roster WIDTH is what this pass
   * buys. Sixty more recipes would be a second pass wearing this one's
   * clothes. These seven are the pairs where a new delivery makes an obvious
   * result, plus one that is structural.
   *
   * THE STRUCTURAL ONE IS LULL. DAMPER x CAESURA is the only pair in the whole
   * table where BOTH parents deal no damage, so its generic duet deals none
   * either — `tools/fusefire.mjs`' FALLBACK section fails a pair that "deals
   * no damage", and it is right to. Authoring the pair is the answer, and the
   * result is the honest one: two defences make a bigger defence.
   *
   * THE NUMBERS ARE NOT GUESSED. Each row's property set is
   * `mergeProps(parentA@max, parentB@max)` plus an authored delta, and each
   * row's nominal dps clears the dps of the generic duet it shadows — both of
   * which `fusefire` asserts directly, and both of which every one of the
   * original sixty-three failed before that gate was written.
   * ------------------------------------------------------------------ */
  {
    id: 'firewheel',
    label: 'FIREWHEEL',
    shape: 'boomerang',
    fused: true,
    weight: 0,
    blurb: '121 dmg x3 out and back · every body it passes takes a 200px 60-dmg blast and 2 burn stacks, on BOTH passes.',
    character: 'aggressive — a burning hoop, thrown flat',
    base: stats({ interval: 0.7, count: 3, damage: 121, speed: 900, range: 520, pierce: 99 }),
    props: { burn: 23, burnStack: 2, bleed: 6, bleedStack: 2, ghost: 1, quake: 60, quakeRadius: 200 },
    steps: [],
  },
  {
    id: 'stasis',
    label: 'STASIS',
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: '42 dmg/s in three held lines · everything standing in one is frozen AND takes 12% more per stack from everything else you own.',
    character: 'shimmering — one chord, and the clock stopped',
    base: stats({ interval: 0.9, count: 3, damage: 42, area: 22, linger: 2, range: 700 }),
    props: { hold: 1.2, vuln: 0.12, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'starburst',
    label: 'STARBURST',
    shape: 'compass',
    fused: true,
    weight: 0,
    blurb: '32 dmg, three bolts on each of four fixed axes · each splits twice, scatters 6 more, and arcs on to 3 for 26.',
    character: 'shimmering — a rocket, and everything it throws',
    base: stats({ interval: 0.28, count: 3, damage: 32, speed: 1000, range: 700 }),
    props: { split: 2, burst: 6, chain: 3, chainDamage: 26 },
    steps: [],
  },
  {
    id: 'lull',
    label: 'LULL',
    shape: 'guard',
    fused: true,
    weight: 0,
    blurb: 'no damage, ever · three charges that each eat a hit, and breaking one freezes every body within 380px where it stands.',
    character: 'mournful — the bar where nothing happens',
    base: stats({ interval: 5, count: 3, damage: 0, area: 380, linger: 2.4 }),
    props: { slow: 0.7, hold: 1, freeze: 1 },
    steps: [],
  },
  {
    id: 'thunderclap',
    label: 'THUNDERCLAP',
    shape: 'erase',
    fused: true,
    weight: 0,
    blurb: '1700 dmg to every body on the screen, twice, every 2.2s · what survives is frozen and takes 14% more per stack from everything.',
    character: 'heavy — one strike, and the whole room in it',
    base: stats({ interval: 2.2, count: 2, damage: 1700, area: 820, linger: 0.6 }),
    props: { freeze: 0.7, chain: 4, chainDamage: 22, vuln: 0.14, vulnStack: 1 },
    steps: [],
  },
  {
    id: 'miasma',
    label: 'MIASMA',
    shape: 'wake',
    fused: true,
    weight: 0,
    blurb: '90 dmg pools three at a time wherever you walk · poison, 14% of them change sides, and every touch takes 4% of what is LEFT.',
    character: 'eerie — a cloud that stays where it was left',
    base: stats({ interval: 0.4, count: 3, damage: 90, area: 170, linger: 3.5, range: 520 }),
    props: { poison: 11, poisonStack: 1, charm: 0.14, rend: 0.04 },
    steps: [],
  },
  {
    id: 'ruff',
    label: 'RUFF',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: '42 dmg x8, three times a second, coming off the walls faster every time · one hit in twelve simply ends what it touched.',
    character: 'aggressive — a roll of strokes, none of them separable',
    base: stats({ interval: 0.3, count: 8, damage: 42, arc: 1.6, speed: 900, range: 620, bounces: 3 }),
    props: { blind: 1, accel: 0.45, execute: 0.08 },
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
      'coast a breath and the band swells — planted shots land half again as hard, and it drops when you steer',
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
  /**
   * `evolution` — instrument + its RIG catalyst, both maxed.
   * `union`     — two evolved instruments, possession only.
   * `lattice`   — TWO INSTRUMENTS, both at their own ceiling. The Ball x Pit
   *               tier: an authored result for a pair that would otherwise
   *               fall through to a generic duet. See `LATTICE` below.
   */
  kind: 'evolution' | 'union' | 'lattice';
  /** The instrument that must be at max level. */
  base: InstrumentId | EvolvedId;
  /** Rig item (evolution) or second instrument (union/lattice), also at max level. */
  catalyst: AbilityId;
  result: EvolvedId;
  /** One line for the announcement banner and the offer card. Mechanic first. */
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

  /*
   * TEN MORE ENDINGS, ONE PER NEW DELIVERY. `levelup.mjs` fails a base with no
   * evolution, so this block is the size of the roster addition rather than a
   * taste decision. Every rig item was already catalysing at least one base
   * (`levelup` asserts that too), so these ten only DEEPEN the existing
   * double-duty AGENTS.md §5 permits — no thirteenth passive.
   */
  { kind: 'evolution', base: 'rondo', catalyst: 'spread', result: 'refrain', line: 'the theme comes back, and back' },
  { kind: 'evolution', base: 'quadrille', catalyst: 'rapid', result: 'reel', line: 'the four lines stop pausing between figures' },
  { kind: 'evolution', base: 'ostinato', catalyst: 'magnet', result: 'groundbass', line: 'the figure sinks into the floor and stays there' },
  { kind: 'evolution', base: 'antiphon', catalyst: 'compressor', result: 'responsory', line: 'the answer comes back with the whole choir behind it' },
  { kind: 'evolution', base: 'coda', catalyst: 'reverb', result: 'finale', line: 'the last bar takes the room with it' },
  { kind: 'evolution', base: 'damper', catalyst: 'fermata', result: 'unacorda', line: 'the pedal goes down and stays down' },
  { kind: 'evolution', base: 'caesura', catalyst: 'timewarp', result: 'grandpause', line: 'the break becomes the piece' },
  { kind: 'evolution', base: 'backbeat', catalyst: 'capo', result: 'flam', line: 'one stroke becomes two, a hair apart' },
  { kind: 'evolution', base: 'aleatory', catalyst: 'laser', result: 'stochastic', line: 'chance stops being occasional' },
  { kind: 'evolution', base: 'cluster', catalyst: 'resonance', result: 'tamtam', line: 'the cloud finds the room and will not stop' },

  { kind: 'union', base: 'chorale', catalyst: 'cathedral', result: 'requiem', line: 'the choir and the room become one' },
  { kind: 'union', base: 'harmonics', catalyst: 'crossstrung', result: 'stringsection', line: 'the section takes the whole line' },

  /* ------------------------------------------------------------------ *
   * THE LATTICE. Sixty-three instrument PAIRS with an authored result.
   * ------------------------------------------------------------------ */
  { kind: 'lattice', base: 'ember', catalyst: 'anvil', result: 'detonate', line: 'every hit detonates a 250px ring for 95, and the coals go on burning' },
  { kind: 'lattice', base: 'ember', catalyst: 'chime', result: 'frostfire', line: 'frostburn — every hit leaves +10% damage taken, and it still burns and freezes' },
  { kind: 'lattice', base: 'ember', catalyst: 'snare', result: 'inferno', line: 'the fire stops being a bolt and becomes a room you carry with you' },
  { kind: 'lattice', base: 'ember', catalyst: 'timpani', result: 'magma', line: 'it stops throwing coals and starts pouring — three gouts that lie where they land' },
  { kind: 'lattice', base: 'ember', catalyst: 'gravel', result: 'brimstone', line: 'burning AND poisoning everything in 290px — the stone was full of it all along' },
  { kind: 'lattice', base: 'ember', catalyst: 'nova', result: 'sun', line: 'a 520px sun left hanging for six seconds; nothing near it can see or stop burning' },
  { kind: 'lattice', base: 'ember', catalyst: 'harp', result: 'fireworks', line: 'four rockets in a spread, each one bursting into six more, all of them burning' },
  { kind: 'lattice', base: 'blackhole', catalyst: 'chime', result: 'timestop', line: 'everything within 640px stops for five seconds — once every six, which is the whole cost' },
  { kind: 'lattice', base: 'chime', catalyst: 'bow', result: 'frostray', line: 'the shards become a held beam, and a quarter of what it crosses freezes solid' },
  { kind: 'lattice', base: 'chime', catalyst: 'snare', result: 'blizzard', line: 'a 420px whiteout: half of what it touches freezes, the rest can barely move' },
  { kind: 'lattice', base: 'chime', catalyst: 'timpani', result: 'glacier', line: 'spikes that stand for six seconds and hold whatever touches them — no roll, just held' },
  { kind: 'lattice', base: 'chime', catalyst: 'tremolo', result: 'venom', line: 'venom, not poison — it rots at 14/s a stack AND takes 55% of the legs away' },
  { kind: 'lattice', base: 'chime', catalyst: 'phantom', result: 'wraith', line: 'it passes through everything, and everything it passes through stops where it stands' },
  { kind: 'lattice', base: 'tremolo', catalyst: 'timpani', result: 'swamp', line: 'the pools turn to tar: poison as before, and half the speed of anything standing in it' },
  { kind: 'lattice', base: 'tremolo', catalyst: 'pizzicato', result: 'virus', line: 'the poison spreads: every hit jumps to four more and stacks on all of them' },
  { kind: 'lattice', base: 'tremolo', catalyst: 'nocturne', result: 'noxious', line: 'a 400px cloud nothing can see through, poisoning everything standing in it' },
  { kind: 'lattice', base: 'tremolo', catalyst: 'bow', result: 'radiation', line: 'the beam irradiates: +10% damage taken per stack, on top of the rot' },
  { kind: 'lattice', base: 'pizzicato', catalyst: 'anvil', result: 'hemorrhage', line: 'each hit takes 6% of what is LEFT — worthless on chaff, enormous on a boss' },
  { kind: 'lattice', base: 'pizzicato', catalyst: 'nocturne', result: 'sacrifice', line: 'bleeds and curses at once — three stacks of the wound, one of +12% damage taken' },
  { kind: 'lattice', base: 'pizzicato', catalyst: 'phantom', result: 'heartswallower', line: 'it passes through them and takes something with it — 12% of hits heal you' },
  { kind: 'lattice', base: 'pizzicato', catalyst: 'siphon', result: 'vampirelord', line: 'a quarter of hits heal you and 7% consume the body entirely, whatever its health was' },
  { kind: 'lattice', base: 'pizzicato', catalyst: 'charm', result: 'berserk', line: 'a 300px ring of rage — a third of what it catches attacks its own side' },
  { kind: 'lattice', base: 'feedback', catalyst: 'snare', result: 'storm', line: 'the lightning stops being aimed — four strikes land wherever the bodies are' },
  { kind: 'lattice', base: 'feedback', catalyst: 'nova', result: 'flash', line: 'the whole screen takes 55 and is blinded, every single time it lands' },
  { kind: 'lattice', base: 'feedback', catalyst: 'anvil', result: 'rod', line: 'rods driven into the field and struck — eight arcs out of every one' },
  { kind: 'lattice', base: 'feedback', catalyst: 'drones', result: 'lightningbug', line: 'sparks sprayed across the arc — half of what they touch hatches a hunter' },
  { kind: 'lattice', base: 'snare', catalyst: 'timpani', result: 'sandstorm', line: 'it passes through the whole line, blinding and shocking everything on the way' },
  { kind: 'lattice', base: 'snare', catalyst: 'blackhole', result: 'erosion', line: 'it passes through and takes 8% of what is left — nothing on chaff, everything on a boss' },
  { kind: 'lattice', base: 'phantom', catalyst: 'nocturne', result: 'shade', line: 'it crosses the whole line and curses everything on it: +14% damage taken a stack' },
  { kind: 'lattice', base: 'phantom', catalyst: 'anvil', result: 'assassin', line: 'seven percent of its hits simply end a non-boss, wherever its health happened to be' },
  { kind: 'lattice', base: 'phantom', catalyst: 'siphon', result: 'soulsucker', line: 'it draws through the line: 30% of hits heal you, and half of them cannot aim after' },
  { kind: 'lattice', base: 'anvil', catalyst: 'gravel', result: 'temper', line: 'triple damage at a third the speed, and every blow makes the next one land harder' },
  { kind: 'lattice', base: 'anvil', catalyst: 'timpani', result: 'drill', line: 'it does not stop at the first — it bores, cutting a line through everything behind' },
  { kind: 'lattice', base: 'anvil', catalyst: 'harp', result: 'sforzando', line: 'a close, heavy spread — and seven more bolts out of wherever it lands' },
  { kind: 'lattice', base: 'gravel', catalyst: 'bow', result: 'cutter', line: 'a cutting head rather than a bolt: heavy, slow, and 700px of line out of every body' },
  { kind: 'lattice', base: 'gravel', catalyst: 'harp', result: 'catapult', line: 'stones lobbed in a spread, each shocking 170px and scattering six more' },
  { kind: 'lattice', base: 'gravel', catalyst: 'accelerando', result: 'petrify', line: 'everything in the sightline is held where it stands, for as long as the line is on it' },
  { kind: 'lattice', base: 'gravel', catalyst: 'timpani', result: 'landslide', line: 'the ground goes: three unaimed landings, each shocking 300px for 130' },
  { kind: 'lattice', base: 'nocturne', catalyst: 'nova', result: 'flicker', line: 'six strikes across the whole screen at once, and everything they touch is blinded' },
  { kind: 'lattice', base: 'nocturne', catalyst: 'charm', result: 'incubus', line: 'shadows left on the ground — what walks into one walks out on your side' },
  { kind: 'lattice', base: 'blackhole', catalyst: 'nova', result: 'warp', line: 'a 380px bubble where time drags — everything inside it is held and blinded' },
  { kind: 'lattice', base: 'siphon', catalyst: 'charm', result: 'succubus', line: 'four attendants circling; a quarter of what they touch changes sides' },
  { kind: 'lattice', base: 'siphon', catalyst: 'accelerando', result: 'zombie', line: 'a third of what it hits gets back up on your side' },
  { kind: 'lattice', base: 'siphon', catalyst: 'harp', result: 'mosquitoswarm', line: 'a swarm rather than a bolt — seven more out of every landing, all of them feeding you' },
  { kind: 'lattice', base: 'siphon', catalyst: 'drones', result: 'mosquitoking', line: 'over half its hits send out a hunter, and every one of them still feeds you' },
  { kind: 'lattice', base: 'echoes', catalyst: 'accelerando', result: 'offspring', line: 'five splits instead of two, and each one comes off the walls faster than the last' },
  { kind: 'lattice', base: 'echoes', catalyst: 'harp', result: 'clutch', line: 'it splits, it scatters, and two in five of its hits hatch something that hunts' },
  { kind: 'lattice', base: 'echoes', catalyst: 'timpani', result: 'overgrowth', line: 'it stops travelling and starts landing — three unaimed strikes, each shocking 360px' },
  { kind: 'lattice', base: 'echoes', catalyst: 'drones', result: 'maggot', line: 'it splits, it hatches, and it bursts — five lesser bolts out of every body it opens' },
  { kind: 'lattice', base: 'drones', catalyst: 'harp', result: 'spiderqueen', line: 'three in five of its hits birth a hunter, and a burst of six goes out with each one' },
  { kind: 'lattice', base: 'drones', catalyst: 'pizzicato', result: 'leeches', line: 'over half its hits attach something that keeps feeding, on top of three bleed stacks' },
  { kind: 'lattice', base: 'drones', catalyst: 'accelerando', result: 'fleshmound', line: 'five pods throwing hunters out at whatever comes near, all of them speeding up' },
  { kind: 'lattice', base: 'charm', catalyst: 'nova', result: 'lovestruck', line: 'a 430px ring: everything in it is blinded and a third of it changes sides' },
  { kind: 'lattice', base: 'bow', catalyst: 'nova', result: 'beam', line: 'the bolt becomes a held beam, and nothing it touches can aim afterwards' },
  { kind: 'lattice', base: 'detonate', catalyst: 'tremolo', result: 'fallout', line: 'the bomb goes nuclear: 330px, and everything left standing takes 24% more from everything' },
  { kind: 'lattice', base: 'detonate', catalyst: 'blackhole', result: 'timebomb', line: 'the bombs are lobbed now, and everything left in the crater is held where it stood' },
  { kind: 'lattice', base: 'inferno', catalyst: 'storm', result: 'armageddon', line: 'a meteor shower: three strikes a second, shocking, arcing and setting the ground alight' },
  { kind: 'lattice', base: 'shade', catalyst: 'wraith', result: 'banshee', line: 'it curses every enemy on the screen at once: +32% damage taken, blinded, and held' },
  { kind: 'lattice', base: 'soulsucker', catalyst: 'heartswallower', result: 'reaper', line: 'twelve percent of its hits end a body outright, and a third give you the health back' },
  { kind: 'lattice', base: 'sun', catalyst: 'nocturne', result: 'eventhorizon', line: 'thirty percent of what it touches is gone — not damaged, gone' },
  { kind: 'lattice', base: 'beam', catalyst: 'cutter', result: 'xray', line: 'four crossed cuts, and everything they touch takes 24% more from everything else you own' },
  { kind: 'lattice', base: 'sforzando', catalyst: 'assassin', result: 'sniper', line: 'one shot down the whole line: 12% of what it touches is finished where it stands' },
  { kind: 'lattice', base: 'incubus', catalyst: 'succubus', result: 'diabolus', line: 'nearly half of what it touches changes sides, and the rest of it is condemned' },

  /*
   * SEVEN FOR THE NEW DELIVERIES. See the block above these results in
   * `INSTRUMENTS` for why seven rather than sixty, and for why LULL is the one
   * that had to be written rather than chosen.
   */
  { kind: 'lattice', base: 'rondo', catalyst: 'ember', result: 'firewheel', line: 'a burning hoop thrown flat: it sets a 200px ring alight at every body it passes, on the way out AND on the way back' },
  { kind: 'lattice', base: 'caesura', catalyst: 'blackhole', result: 'stasis', line: 'the line stops being a courtesy: three held beams, everything in them frozen and 12% softer per stack' },
  { kind: 'lattice', base: 'quadrille', catalyst: 'harp', result: 'starburst', line: 'four fixed lines that split, scatter and arc — twelve bolts leave and the field fills up' },
  { kind: 'lattice', base: 'damper', catalyst: 'caesura', result: 'lull', line: 'three charges, and breaking one freezes every body within 380px where it stood' },
  { kind: 'lattice', base: 'aleatory', catalyst: 'coda', result: 'thunderclap', line: 'the whole screen at once, twice, every 2.2s — and everything left standing takes 14% more per stack' },
  { kind: 'lattice', base: 'cluster', catalyst: 'ostinato', result: 'miasma', line: 'the cloud stops following you and stays where you left it — and every touch takes 4% of whatever is left' },
  { kind: 'lattice', base: 'backbeat', catalyst: 'accelerando', result: 'ruff', line: 'eight strokes off the walls, faster every time, and one hit in twelve simply ends what it touched' },
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
    // Rewritten below, once the damage rescale has run — see `describeDuet`.
    blurb: '',
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

  /*
   * NAMED HONESTLY, WHICH THE LATTICE MADE NECESSARY, and written here rather
   * than in the literal above so it can quote the damage the rescale settled on.
   *
   * While every pairing was generic, "…, carrying glass" was an adequate
   * description of the only thing on offer. Sixty-three of the 190 pairs now
   * have an AUTHORED result and the other 127 land here, and the two arrive on
   * cards laid out identically — so the card has to say which it is. The tier
   * word does half of it (`ARRANGEMENT` against `DUET`, drawn by
   * `render/levelup.ts` from `TIER_WORD`); this says the mechanical half,
   * which is the part a player can act on: a generic pairing is `a`'s DELIVERY
   * carrying BOTH property sets, which is exactly what the `mergeProps` above
   * produces.
   *
   * It is deliberately not apologetic. A duet is a real result — at least as
   * good as either parent at everything, and 2.3x the better one — so calling
   * it "no recipe" would misrepresent the fallback as a punishment for a pair
   * nobody wrote down, which is the failure mode `docs/plan-refactor-3.md`
   * §9b asks the fallback to avoid.
   *
   * The property NAMES are listed rather than described, because there are 190
   * pairs and no sentence can be written for each: `PROPERTIES` is the same
   * table `propfire` and `fusefire` read, so a name here cannot drift from what
   * the hit actually carries.
   */
  const carried = PROPERTY_NAMES.filter((n) => PROPERTIES[n].some((k) => def.props![k] !== 0));
  /*
   * CACHED BEFORE THE BLURB IS WRITTEN, and the order is load-bearing:
   * `instrumentStats` resolves through `instrumentDef`, which would re-enter
   * this function for the same id and recurse until the stack gave out. Seen,
   * as `RangeError: Maximum call stack size exceeded`.
   */
  DUET_CACHE.set(id, def);
  const top = instrumentStats(def.id, FUSED_MAX_LEVEL);
  def.blurb =
    `${Math.round(top.damage)} dmg x${Math.round(top.count)} every ${top.interval.toFixed(2)}s · `
    + `${a.label}'s delivery carrying BOTH property sets: ${carried.join(', ')}. No written arrangement for this pair.`;
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
    /*
     * A FUSED INSTRUMENT ALWAYS DESCRIBES ITSELF, whatever level is asked for.
     *
     * `applyFusion` seats a result at its ceiling and `availableOptions` offers
     * it at `maxLevelOf`, so the only `stepNote` a fusion card ever asks for is
     * the TOP one — and for a synthesised duet, which does carry steps, that
     * returned "and again, tighter". Screenshotted: the generic EMBER x SIPHON
     * card said nothing whatever about what it does, while the authored BOMB
     * beside it printed its whole mechanic, purely because one has level steps
     * and the other does not. "What this rung buys" is not a question about a
     * thing that arrives finished and can never be levelled.
     */
    if (inst.fused) return inst.blurb;
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
