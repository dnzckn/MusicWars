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
 * SEVEN BECAME TEN, AND THE COUNT WAS THE DIAGNOSIS.
 *
 * `docs/research-weapons.md` classified this roster against Vampire Survivors
 * and Ball x Pit by MECHANICAL VERB — "where the hitbox appears and how it
 * behaves", not theme and not stat — and measured one verb per 3.9 instruments
 * here against 1.2 for launch-era Vampire Survivors and 3.0 for Ball x Pit,
 * whose ratio is bought with a second orthogonal trigger axis this game does
 * not have at all. A quarter of the roster was `aura`, a ring centred on the
 * player, and three of those seven auras described themselves as "a very large
 * ring".
 *
 * `lance`, `cone` and `spray` are the first three of that document's nine, and
 * they were chosen because the owner named two of them ("like laser",
 * "something short range") and because the third answers "more fun with
 * projectiles". All three RE-POINT existing instruments: no id is added, no
 * `ENSEMBLE_MIX` lane is touched, and `AGENTS.md` §5's zero-sum offer is
 * untouched because a `shape` field is not a card.
 *
 * `trail`, `chain`, `mortar` and `spawn` are the next four, and they finish
 * the catalogue's affordable half. All four RE-POINT as well — TREMOLO FIELD,
 * CARILLON, TUTTI and VIBRATO — and three of them deliver a blurb the file's
 * own "PROSE THE SIMULATION DOES NOT DELIVER" heading has listed the whole
 * time. Seven shapes became fourteen over 27 instruments, 1 verb per 1.9,
 * largest share 19%, and not one instrument id was added.
 *
 * `boomerang` and `tether` ARE STILL NOT IMPLEMENTED AND SHOULD NOT BE
 * INFERRED CHEAP. Neither has an instrument free to own it, which is the whole
 * content of that document's §F.2: a thirteenth base instrument takes every
 * existing one's share of the draft from 1/12 to 1/13, -7.7% each, and §F.2's
 * own conclusion is that zero new instruments still delivers most of the win.
 * The other two shapes are that decision, taken.
 */
export type InstrumentShape =
  /** Bolts toward the nearest target inside range. */
  | 'seek'
  /** A sweep through an arc centred on the ship's facing. */
  | 'arc'
  /**
   * A beam re-drawn along the facing on the interval and left to fade.
   *
   * NOT the held laser — that is `lance`. What distinguishes them is that this
   * one spreads `count` beams evenly around the WHOLE COMPASS and re-fires,
   * which is CHORALE's "the pods stop circling and hold station, sustaining
   * beams between them": a static star of strokes, not a line you point.
   */
  | 'beam'
  /**
   * ONE CONTINUOUS BEAM, ANCHORED TO THE SHIP, TRACKING THE AIM IN REAL TIME.
   *
   * The owner asked for a laser by name and ROSIN BOW's blurb has promised one
   * since the row was written — "One held beam along your facing. **It does not
   * stop.**" It stopped: `fireBeam` re-fired every `interval` and spread
   * `count` copies around the compass, so the one instrument in the table whose
   * text says it holds was the one that flickered.
   *
   * `lance` is the verb no shape in this game had: your HEADING is the weapon.
   * `seek` picks targets for you, `aura` is omnidirectional, `strike` is
   * explicitly unaimable and `arc` sprays. A lance rewards strafing sideways to
   * keep the line on a boss and rotating through a pack like a scythe, and it
   * punishes standing still with the line off-target. That is a different left
   * hand, not a different damage number.
   *
   * `count` is PARALLEL lances, which is HARMONICS' "Three parallel beams,
   * held" taken literally. `linger` is how far past the next activation the
   * line is drawn for, so a longer hold is a steadier line rather than a
   * brighter one — `fireLance` refreshes it every interval and it therefore
   * never gaps, but it does fade out on its own once the instrument stops being
   * held. `speed`, `pierce`, `bounces` and `arc` are deliberately unread: a
   * held line has no travel speed, nothing to pass through, no wall to come off
   * and no angular width beyond its own half-thickness.
   */
  | 'lance'
  /**
   * A DENSE, SHORT, WIDE BURST OF PELLETS ALONG THE FACING THAT DIES AT ARM'S
   * LENGTH.
   *
   * The other thing the owner asked for by name. Nothing in this game rewarded
   * closing: every shape is safe-at-range or omnidirectional, and the arena's
   * whole risk model was "stay away and let the auto-aim work". A cone inverts
   * it — you dive into the group, dump, and leave — and you cannot camp with
   * one, which lines up with the camp-pressure system rather than fighting it.
   *
   * It is `fireSeek`'s spawn loop with the convergence removed, a short
   * `range`, and `arc` finally used as a spread by something other than
   * `fireArc`. `area` and `linger` are unread: a cone is pellets, not a field.
   */
  | 'cone'
  /**
   * A CONTINUOUS, UNAIMED, HIGH-RATE STREAM THROWN IN A ROTATING PATTERN AROUND
   * THE SHIP, BOUNCING OFF THE WALLS.
   *
   * The reason this game does not FEEL like a projectile game is that its
   * highest-`count` shapes are auras and beams, which are not objects — they
   * are rings and rectangles that appear and fade. A spray puts the player's
   * own output on screen as a physical field they can watch move. You stop
   * pointing and start timing: the pattern precesses whether you like it or
   * not, so you position against its phase, and the walls mean your own shots
   * come back through where you were standing.
   *
   * `arc` is the volley's angular span AND, divided by `count`, the amount the
   * pattern precesses each volley — so consecutive volleys interleave rather
   * than retracing. `bounces` is forwarded, which is what makes it a field
   * rather than a volley. `pierce` and `linger` are unread, and `pierce`
   * deliberately so: a bolt consumed on contact is what keeps the live count
   * bounded, and this is the one shape in the catalogue whose budget is real.
   */
  | 'spray'
  /**
   * HAZARD LAID DOWN BY MOVING. STANDING STILL LAYS NOTHING.
   *
   * TREMOLO FIELD's card has read "Pools left in your wake" since the row was
   * written, and `fireField` dropped its pools ON THE NEAREST ENEMY — the one
   * placement that guarantees the pool is never behind you. The blurb was in
   * `weapons.ts`'s own "NOT SHAPE BUGS, BUT PROSE THE SIMULATION DOES NOT
   * DELIVER" list; this is the repair.
   *
   * It is the only shape whose output the player authors directly with the
   * stick. You stop running in straight lines away from a pack and start
   * drawing loops around it, then walking it back through your own wake — and
   * it is the natural counterweight to the camp-pressure system in `World`,
   * because a trail makes moving PAY where `IDLE_GRACE_S` only makes standing
   * still cost.
   *
   * `count` is drops per activation, `damage` is shared between them (coverage,
   * not a multiplier), `area` is each drop's radius, `linger` is how long the
   * ground stays hot and `interval` is how often a moving ship lays another.
   * `speed`, `pierce`, `bounces`, `arc` and `range` are unread: a pool does not
   * travel, has nothing to pass through, no wall, no angular width and no
   * reach — it is where you were.
   */
  | 'trail'
  /**
   * ARCS FROM BODY TO BODY, LOSING A FRACTION EACH HOP.
   *
   * CARILLON's blurb is verbatim "Every strike chains to two more. The ringing
   * does not stop", and `fireStrike` picked its targets AT RANDOM — the same
   * undelivered-prose list as TREMOLO's. `docs/research-weapons.md` §D.3 calls
   * this the single highest-value re-point available, because the promise was
   * already written and paid for and it makes `chime + resonance -> carillon` a
   * genuine change of verb rather than a bigger bell.
   *
   * It is the first weapon whose value depends on enemy DENSITY rather than on
   * where the ship is: you stop kiting a pack apart and start letting it bunch.
   * Against a lone boss it is the worst weapon in the game, which is a real and
   * legible trade.
   *
   * IT DOES NOT MOVE CHIME. `strike` keeps its founding member — the shape was
   * split out of `seek` FOR the bell family — and the `FUSIONS` preamble's
   * refusal to move CHIME itself stands. What moves is CHIME's evolution.
   *
   * `count` is hops, `area` is how far a hop can reach, `range` is how far the
   * FIRST hop can start from the ship. `speed`, `linger`, `bounces`, `arc` and
   * `pierce` are unread: a chain does not travel, does not persist, has no wall,
   * no width and nothing to pass through.
   */
  | 'chain'
  /**
   * A SHELL AIMED AT WHERE A TARGET WILL BE, THAT LANDS THERE.
   *
   * The only shape that hits PAST a wall of bodies. A bolt stops on the first
   * thing it touches, an aura has to reach outward through everything, and
   * `strike` — the sole exception — is explicitly unaimed. A mortar makes the
   * dangerous back rank reachable, so a player stops retreating from a pack and
   * starts hitting through it.
   *
   * And it is the first weapon in this game whose output the ENEMY can respond
   * to: the landing is telegraphed by a ring that closes on the spot as the
   * shell arrives, and anything that walks out is not hit.
   *
   * TUTTI's "Everything is pulled to the centre first, and then struck" is the
   * third undelivered blurb this change repairs, and both halves are delivered
   * — the pending shell drags what is under it for the whole telegraph, then
   * detonates. `weapons.ts` listed that sentence as prose the simulation could
   * not produce because `Effect.pull` had no reader and `wells.pull` was
   * reachable only through two hardcoded ids.
   *
   * `count` is shells, `area` the blast radius, `range` how far one can be
   * thrown, `linger` the telegraph delay. `speed`, `pierce`, `bounces` and
   * `arc` are unread: a lobbed shell has no expressible travel speed — it
   * ignores what is in between, which is the point — nothing to pass through,
   * no wall and no angular width.
   */
  | 'mortar'
  /**
   * AN AUTONOMOUS ALLY THAT FIGHTS SOMEWHERE THE PLAYER IS NOT.
   *
   * The one archetype BOTH reference games have that this one had no equivalent
   * of at all — Gatti Amari in Vampire Survivors, Brood Mother and Mosquito
   * King in Ball x Pit, and the Ball x Pit wiki attributes that game's
   * late-game screen-fill to spawners rather than to slot count. Every hitbox
   * in this game is welded to the ship, PODS INCLUDED: an orbit is drawn at
   * `Player.dronePos`, so it is the ship's own geometry with a radius.
   *
   * A summon means a corner stays defended while you leave it, and it splits
   * the player's attention across two positions — a different cognitive load,
   * not a bigger number.
   *
   * VIBRATO owns it: "The pools go hunting", with HOMING as the literal
   * catalyst. Stated plainly, as `docs/research-weapons.md` §D.9 asks: this
   * re-points a row that was itself re-pointed one change ago (`field` ->
   * `strike`), and the argument is `deadhunt-ranges` output rather than taste —
   * `strike` was the closest thing available when there were seven shapes, and
   * it delivered "appears where the enemies are" without delivering "hunting",
   * because a strike is instantaneous and nothing persists to hunt with.
   *
   * `count` is the size of the RETINUE and not a volley — the routine tops the
   * population up rather than adding to it, which is what bounds the shape.
   * `linger` is each ally's lifetime, `speed` its travel, `range` how far out
   * it is dispatched. `area`, `arc`, `bounces` and `pierce` are unread; pierce
   * is refused on purpose, because a piercing ally sits inside the first thing
   * it reaches and applies its damage on all 120 steps a second.
   */
  | 'spawn'
  /** Satellites circling the ship. */
  | 'orbit'
  /** A ring or field centred on the ship. */
  | 'aura'
  /**
   * An unaimed hit that lands ON something and damages a circle around it.
   *
   * Split out of `seek`, which it had been wearing since the table was written.
   * The six `seek` instruments divided cleanly in two: `pizzicato`, `echoes`,
   * `spiccato` and `canon` declare a travel speed and no area, and `chime` and
   * `carillon` declare an area and no speed. Those are two different things,
   * and calling both of them `seek` meant `fireSeek` — which reads `speed` and
   * ignores `area` — served the bolts and silently dropped everything the bells
   * declared. CHIME's "strikes land wider" moved a number nothing read, and its
   * `speed: 0` was floored to a 120px/s crawl at every level with CAPO unable
   * to touch it, so the bell was also the slowest projectile in the game.
   *
   * `carillon` is `chime`'s own evolution, so this is a family rather than one
   * odd row. A strike reads `count`, `area`, `range`, `interval` and `damage`,
   * and ignores `speed` — a struck bell has no travel speed because it does not
   * travel.
   */
  | 'strike'
  /** A field dropped in the world that stays where it was put. */
  | 'field'
  /* ---------------------------------------------------------------------- *
   * THE FIVE SHAPES THAT ARE NOT "DAMAGE IS DEALT IN SHAPE X".
   *
   * `docs/plan-items-v2.md` §1 counted the roster and found twelve items and
   * ONE idea: every entry above answers the question "where does the hitbox
   * appear", and none of them answers "what does the player DO". Fourteen
   * distinct geometries is a real achievement and it is still one axis, which
   * is why the owner's verdict after playing it was "there currently not fun".
   *
   * Three of the five below deal NO DAMAGE AT ALL and two of them make other
   * items fire. That is the second axis, and it is the whole point of this
   * pass — a roster where the only decision is a delivery angle is a roster
   * where the level-up screen is a menu of camera angles.
   * ---------------------------------------------------------------------- */
  /**
   * A BAR OF INVULNERABILITY THAT SILENCES YOUR OWN BAND.
   *
   * Deals nothing, ever. The roster had zero non-damaging items and
   * `docs/plan-items-v2.md` §1 calls that the most obvious hole in it: Vampire
   * Survivors has Laurel, Clock Lancet, Garlic and Tiragisú and this game had
   * twelve damage dealers. A defensive item is the one card that changes what
   * the player is ALLOWED to do rather than what they hit.
   *
   * The cost is audible, which is the part no competitor can copy: while the
   * rest is running, `GameSnapshot.tacetStems` carries the whole band and the
   * mix drops to its drone. You do not get a free bar; you get a bar with the
   * music taken away, and you can hear it come back.
   *
   * `linger` is the length of the rest in BARS (not seconds — a rest that ends
   * mid-bar is not a rest), `interval` the cooldown, `area` the radius of the
   * ring that sweeps the field clean when the band comes back in. `damage`,
   * `count`, `speed`, `pierce`, `bounces`, `arc` and `range` are unread, and
   * `damage` is unread ON PURPOSE: see `INSTRUMENTS`' row for `nova`.
   */
  | 'rest'
  /**
   * TIME DRAGS IN A BUBBLE AROUND YOU — INCLUDING YOURS.
   *
   * The second non-damaging item, and the one with a real drawback attached
   * rather than a cooldown. Enemies inside `area` move and shoot at a fraction
   * of their speed; every instrument in the loadout takes proportionally
   * longer to come round. Control, bought with rate.
   *
   * It is the only item in the table that makes the player WORSE at the thing
   * the rest of the table does, which is what makes holding it a decision
   * instead of an acquisition. A build with RITARDANDO and a slow, heavy
   * loadout barely notices; one with METRONOME on the downbeat and SYNCOPATION
   * in the gaps is giving up its whole identity.
   *
   * `area` is the bubble, `damage` is REUSED AS THE DRAG FRACTION (see the row
   * in `INSTRUMENTS`, which explains why that is not a hack), `arc` is what it
   * costs you, `interval` and `linger` drive the visible pulse. `count`,
   * `speed`, `pierce`, `bounces` and `range` are unread.
   */
  | 'drag'
  /**
   * THE LAST THING YOU KILLED COMES BACK AND FIGHTS FOR YOU.
   *
   * `spawn` is an ally you buy on a timer; this is an ally you EARN, and the
   * difference is that it makes the corpse a resource. You stop fighting the
   * nearest thing and start choosing what to kill, because what you kill is
   * what you get.
   *
   * It reuses `BulletFlag.Summon` and `updateSummons` outright — no new
   * container, no new update loop, and `effectsdraw` already asserts sprite
   * type 2 exists. The difference from `spawn` is entirely in WHERE and WHEN:
   * a ghost is pushed at the corpse on the frame of the kill, not at the ship
   * on a clock.
   *
   * IT CANNOT OPEN A RUN. With no other weapon there is no kill, with no kill
   * there is no ghost, and the deadlock is total — which is why `echoes` had
   * to leave `STARTERS`. See the note there.
   *
   * `count` is the standing retinue, `linger` a ghost's lifetime, `damage` its
   * hit, `speed` its travel, `interval` the minimum gap between raisings.
   * `area`, `arc`, `pierce`, `bounces` and `range` are unread.
   */
  | 'ghost'
  /**
   * YOUR SECOND INSTRUMENT FIRES A COPY WHENEVER YOUR FIRST DOES.
   *
   * The first item in the game that modifies another item. Ball x Pit's actual
   * core is that things compose, and nothing here composed: the rig is twelve
   * global multipliers, which is the flattest possible version of an item
   * interacting with a build.
   *
   * The interesting consequence is that LOADOUT ORDER becomes a decision, and
   * order is a thing the player already controls (it is acquisition order) and
   * has never once had a reason to think about.
   *
   * `damage` is the copy's share of the follower's own damage, `count` extra
   * projectiles on the copy, `interval` a floor on how often a copy may be
   * struck. Everything else is unread — this shape has no geometry of its own,
   * which is exactly what makes it a modifier.
   */
  | 'counterpoint'
  /**
   * EVERY INSTRUMENT FIRES TOGETHER ON THE BAR INSTEAD OF ON ITS OWN TIMER.
   *
   * The second modifier, and the one that changes the shape of a whole run. It
   * converts a trickle into a volley: with UNISON held, breadth beats depth,
   * because six instruments landing on the same beat is one enormous hit and
   * six instruments on six timers is a texture.
   *
   * RATE-NEUTRAL BY CONSTRUCTION, and this is the part that had to be argued
   * rather than tuned. Re-clocking an instrument from its own `interval` to
   * one bar multiplies its activations by `interval / bar`; the routine
   * therefore multiplies its damage by `bar / interval`, clamped, so nothing
   * in the loadout gains or loses throughput from the conversion itself. What
   * UNISON's own ladder then adds is the payment. Without the compensation the
   * item is a 12x buff to PIZZICATO and a 45% nerf to TIMPANI, which is not a
   * design, it is an accident of two numbers.
   *
   * `damage` is the multiplier on the assembled volley and `count` the extra
   * projectiles every instrument puts into it. `interval` is read by the
   * dispatcher and nothing else.
   */
  | 'unison'
  /**
   * SILENCE ONE LANE OF YOUR OWN SOUNDTRACK, BANK IT, SPEND IT WHEN IT RETURNS.
   *
   * A resource loop made out of the arrangement. While the lane is out, charge
   * accumulates; on the bar it comes back in, the charge is spent as a ring.
   * The mix visibly and audibly thins while it is banking, so the resource has
   * a readout that is not a number on the HUD — it is the missing part.
   *
   * The only item in the game whose cost is paid in the thing the game is
   * about. You are choosing to make your own soundtrack worse for a payoff,
   * which is a decision no purely mechanical roster can offer.
   *
   * `damage` is banked per BAR of silence, `linger` how many bars the lane
   * stays out, `range` the bars it plays before going out again, `area` the
   * discharge radius, `count` how many lanes go at once. `speed`, `pierce`,
   * `bounces` and `arc` are unread.
   */
  | 'tacet';

/**
 * WHICH BEAT AN INSTRUMENT IS ALLOWED TO FIRE ON, over and above its interval.
 *
 * `docs/plan-items-v2.md` §2: this game generates its soundtrack from play, and
 * `Transport` has published `bar`, `beat`, `barPhase` and `crossings(div)` since
 * the project started — and not one weapon has ever read them. The enemy
 * emitters do; the player's band does not. So the pulse the whole game is built
 * on is something the player listens to and never plays against.
 *
 * A beat lock is a rate limiter that quantises rather than throttling: the
 * instrument's own `interval` still says how often it MAY fire, and the lock
 * says the activation waits for the next grid line of the named division. An
 * instrument whose interval is shorter than its grid therefore fires exactly on
 * the grid, and one whose interval is longer fires on the first grid line after
 * it is ready.
 *
 * THE RISK, STATED UP FRONT, because it is the one that sinks the whole axis:
 * a weapon that fires on the downbeat is only interesting if the player can
 * FEEL the downbeat. If the beat is not legible under combat, METRONOME reads
 * as "my gun is randomly slow". `tools/beatlock.mjs` proves the distributions
 * are what they claim; it cannot prove they are audible.
 */
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
 * Instruments
 *
 * Twelve, for six slots. Three of them (drones, nova, blackhole) are existing
 * PowerupKinds reused verbatim, so their audio signature in `layers.ts` keeps
 * working unchanged — the ids are the contract and the ids did not move.
 *
 * ---------------------------------------------------------------------------
 * FOUR OF THE TWELVE NO LONGER DEAL DIRECT DAMAGE, AND `tools/builds.mjs` IS
 * RED BECAUSE OF IT. Say this plainly; it is the one measured cost of this pass
 * that has not been paid back.
 *
 * REST and RITARDANDO deal nothing at all, and COUNTERPOINT and UNISON deal
 * nothing of their own — they multiply what is already there. That is the
 * design (`docs/plan-items-v2.md` §3: the roster had twelve damage dealers and
 * zero of anything else) and it costs about a fifth of the roster's raw output.
 * Measured over 900s x 8 seeds x 7 pick policies, before this pass against
 * after:
 *
 *     mean wave reached      24.1  ->  19.2
 *     policy / seed ratio    0.22  ->  0.34      (the tool's own diagnostic)
 *     damage taken spread    2.4x  ->  1.5x      (the tool's GATE — bar is 2x)
 *
 * The gate is right that the number moved and its diagnosis is the wrong way
 * round. Its threshold encodes an assumption from a roster with NO defensive
 * items: that the pick shows up as how much punishment a run costs. Under this
 * roster the pick shows up as how FAR a run gets — policy spread in wave
 * reached went 0.97 -> 1.98 and the ratio nearly doubled — and the damage
 * column compresses from both ends because every policy reaches a lower wave,
 * which is fewer minutes of late-game pressure for the reckless builds and more
 * enemies alive for the careful ones. Normalised per wave the spread is 2.14x
 * -> 1.45x, so it is not purely a survival-time artefact either.
 *
 * THREE ATTEMPTS TO CLOSE IT, all recorded so they are not re-tried:
 *
 *   REST's cooldown was going DOWN with its ladder, giving 39% of a run
 *   invulnerable. Fixed (7/12/16%) -> 1.4x -> 1.6x.
 *   RITARDANDO's bubble was 486px at 72% depth, most of the view. Cut to
 *   356px at 62% -> no separate effect measurable.
 *   REST's guns now stop with its band, so it trades damage for safety instead
 *   of granting safety free -> 1.5x. Within noise of 1.6x.
 *
 * WHAT IS NOT DONE, DELIBERATELY: a blanket 20-25% lift on the seven surviving
 * damage dealers would very likely take the column back over 2x, and it would
 * be the thing AGENTS.md §3 calls a gate optimised against — moving numbers to
 * move a metric. It would also push against `tools/arena.mjs`, which measures
 * the OTHER direction and holds: encirclement p90 went 0.32 -> 0.42 against a
 * 0.25 bar, and this file's own `INSTRUMENT_MAX_LEVEL` note says in as many
 * words that the difficulty curve needs the player weaker, not stronger. Two
 * gates now want opposite things and only one of them can be satisfied by a
 * number. Whoever takes this next should decide which, on the design, and then
 * either lift the roster or replace `builds`' threshold with one that is not
 * blind to a defensive item — not quietly widen the bar.
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
  {
    id: 'pizzicato',
    /*
     * PIZZICATO IS NOW METRONOME, AND IT IS THE PROOF OF THE WHOLE SECOND AXIS.
     *
     * `docs/plan-items-v2.md` §1: twelve items and one idea. Every row in this
     * table answered "where does the hitbox appear", the geometries were
     * genuinely distinct after the last pass, and the owner played it and said
     * "there currently not fun". Distinctness of geometry is not variety of
     * decision — the player still moves away from things and lets damage
     * happen, whatever shape the damage is.
     *
     * METRONOME is the cheapest possible test of the other axis. It keeps
     * `seek`, keeps the arp lane, keeps SPICCATO and SNAP as its endings, and
     * changes exactly one thing: WHEN it is allowed to fire. It goes off on the
     * bar line and nowhere else, for eight times a normal shot.
     *
     * POWER IS UNCHANGED AND THAT IS ARITHMETIC, not a guess. At 128 BPM a bar
     * is 1.875s against the old 0.22s interval, so it fires 8.5x less often;
     * damage goes 4 -> 34, which is 8.5x. Nominal throughput at level 1 is
     * 36.3/s against the old 36.4/s. What changes is that all of it lands at
     * once, on a beat the player can hear coming.
     *
     * THE SILENCE BONUS is the anti-synergy the plan asks for and it is the one
     * part that is not obvious. SYNCOPATION (`snare`) is deliberately the
     * anti-metronome, and two weapons on disjoint slices of the bar do not
     * actually fight — they interleave, which is a synergy. So the downbeat
     * volley scales with how much of the bar went by in silence
     * (`World.beatsQuiet`): alone, METRONOME arrives out of four beats of
     * nothing at full weight; alongside a weapon firing four times a bar it
     * arrives out of one and keeps 62% of it. That is a real cost the player
     * can hear, measured by `tools/beatlock.mjs`.
     *
     * IT IS STILL THE DEFAULT OPENER. A player who never touches the starter
     * menu meets the musical axis in the first second of the game, which is the
     * only way an axis this unusual gets learned at all.
     */
    label: 'METRONOME',
    shape: 'seek',
    beat: 'bar',
    swell: 'silence',
    blurb: 'Fires on the downbeat and nowhere else, for eight times a normal shot. Hardest out of silence.',
    character: 'aggressive — short, dry, off the string',
    weight: 1.0,
    // 34 rather than 4, and 0.5 rather than 0.22: at 128 BPM the bar gate sets
    // the rate and `interval` is only a floor under it, so the throughput above
    // is `count * damage / bar` and not `count * damage / interval`.
    base: stats({ interval: 0.5, count: 2, damage: 34, speed: 1150, range: 620 }),
    /*
     * FOLDED FROM SEVEN STEPS TO TWO, and this row is the worked example for
     * the other eleven.
     *
     * The old ladder was `+1 count / x1.18 speed x1.25 range / +1 count /
     * x0.68 interval / +1 pierce / +2 count / +1 pierce x1.4 damage`. Summed:
     * count +4, pierce +2, speed x1.18, range x1.25, interval x0.68,
     * damage x1.4. No field takes both an add and a mul, so splitting those
     * totals across two steps reproduces level 8's block exactly at level 3 —
     * count 6, damage 5.6, interval 0.1496, speed 1357, pierce 3, range 775.
     *
     * The split is by KIND rather than by arithmetic: the first step is more
     * bolts going further, the second is more bolts going harder and faster.
     * Both notes therefore name a count change, which is the one thing a player
     * can count on the screen without reading a stat.
     */
    /*
     * BOTH RUNGS ARE STRUCTURAL AND NEITHER IS A PERCENTAGE. L2 doubles the
     * bolts, L3 doubles the RATE by moving the lock from the bar to the
     * half-bar — a rung the player hears rather than reads. Nominal throughput
     * still tracks what the old ladder delivered: 36.3 / 72.5 / 208 per second
     * against 36.4 / 72.7 / 224.
     */
    steps: [
      {
        note: 'four bolts on the one instead of two, thrown further and faster, each punching through what it hits',
        add: { count: 2, pierce: 1 },
        mul: { speed: 1.18, range: 1.25 },
      },
      {
        note: 'the bar answers on the three as well — five bolts, twice as often, harder, punching through three',
        beat: 'halfbar',
        add: { count: 1, pierce: 2 },
        mul: { damage: 1.15 },
      },
    ],
  },
  {
    id: 'snare',
    /*
     * SNARE ROLL IS NOW SYNCOPATION: it fires on the OFF beat and never on the
     * beat. Four sweeps a bar, on the "and" of each one.
     *
     * It is the anti-metronome and the pair is the clearest statement the
     * roster makes about its new axis: two weapons that both run on the same
     * clock and never once agree about where they are in it. Holding both
     * covers the whole bar and costs METRONOME its silence bonus, which is a
     * decision rather than a stack.
     *
     * `interval` is 0.2 and the grid is 0.234s at 128 BPM, so the lock sets the
     * rate outright — four sweeps a bar, one every 0.469s. Read the block with
     * that in mind: `damage * count / interval` is not this instrument's
     * throughput, `damage * count / 0.469` is.
     *
     * ---------------------------------------------------------------------
     * IT IS A STARTER NOW, AND THE BLOCK WAS RE-AUTHORED FOR IT — twice, the
     * second time because the first was measuring the wrong thing.
     *
     * Carried over at throughput parity with the old SNARE ROLL (10.7/s against
     * 10.5/s) it measured **3.0 waves against METRONOME's 6.7, 45% of the best
     * against a 70% floor** — the gate correctly calling it a trap. Nothing
     * about the floor was touched, exactly as when this gate last named CHIME.
     *
     * THE FIRST FIX WAS DAMAGE AND IT DID ALMOST NOTHING. 2.4x the damage moved
     * the wave count 3.0 -> 3.0 and only the hits column responded (14.0 ->
     * 9.3). That is the finding, and it is about the SHAPE rather than this
     * row: an `arc` sweep reaches `max(range, area)` and this one reached 96px.
     * A weapon that only touches things already on top of you cannot clear a
     * wave however hard it hits, and no amount of damage fixes a reach problem.
     *
     * REACH, THEN, and the sweep says so at every step —
     * `tools/_openersweep.mjs`, 3 seeds x 240s, wave reached:
     *
     *     damage 5,  reach 96,  1 sweep     3.0     score  7,883
     *     damage 12, reach 96,  1 sweep     3.0     score  8,163
     *     damage 9,  reach 210, 1 sweep     4.0     score 21,858
     *     damage 11, reach 300, 1 sweep     4.3     score 46,137
     *     damage 8,  reach 280, 2 sweeps    6.7     score 69,830   <- overshoots
     *     damage 6,  reach 240, 2 sweeps    6.0     score 58,052   <- taken
     *
     * The second sweep is what actually did it, and in hindsight obviously:
     * `fireArc` spaces its strokes evenly around the whole compass, so a second
     * one is not more damage in front of you, it is an ANSWER BEHIND YOU, and
     * enemies in this game arrive from every bearing. The 280px row was not
     * taken because it makes the off-beat weapon outscore the downbeat one
     * nearly 2:1, and the pair is supposed to be a choice.
     *
     * Ladder in real throughput per second: 25.6 / 38.4 / 81.9 against the old
     * SNARE ROLL's 10.5 / 21.0 / 85.7 — the ceiling lands within 5% and the
     * opening is 2.4x, bought mostly in reach rather than in damage.
     */
    label: 'SYNCOPATION',
    shape: 'arc',
    beat: 'offbeat',
    blurb: 'Rolls on the off-beat and never on the beat. Four sweeps a bar, all of them in the gaps.',
    character: 'mechanical — tight, martial, rudimental',
    weight: 0.95,
    base: stats({ interval: 0.2, count: 2, damage: 6, area: 240, arc: 1.5, range: 240 }),
    steps: [
      {
        note: 'a third sweep off to the side, and all of them open a third wider and reach a third further out',
        add: { count: 1 },
        mul: { arc: 1.3, area: 1.3, range: 1.3 },
      },
      {
        note: 'a fourth sweep closes the circle, and every off-beat now bites well over half again as hard',
        add: { count: 1 },
        mul: { arc: 1.5, damage: 1.6 },
      },
    ],
  },
  {
    id: 'bow',
    label: 'ROSIN BOW',
    /*
     * THE THIRD SHAPE RE-POINT, AND THE ONLY ONE WHERE THE BLURB WAS ALREADY
     * RIGHT AND THE SIMULATION WAS WRONG.
     *
     * "One held beam along your facing. **It does not stop.**" has been the
     * text on this card since the row was written, and `fireBeam` re-fired it
     * every `interval`, spread `count` copies evenly around the compass, and
     * let each one fade. Nothing about it was held and nothing about it was
     * along your facing once `count` reached two. `lance` is that sentence,
     * implemented.
     *
     * NOT ONE NUMBER IN THIS BLOCK MOVED, and that is a property of the routine
     * rather than a coincidence. `fireBeam` spends `damage` over a life of
     * `linger` and overlaps `linger / interval` generations, so a target
     * standing in one stroke takes `damage / interval` per second.
     * `fireLance` sets its `dps` to exactly `damage / interval`. Single-target
     * throughput is therefore identical at every level and under every rig
     * loadout, which is the same power-neutrality argument CHORALE's re-point
     * made and it is checkable by reading two lines of `world.ts`.
     *
     * WHAT DOES CHANGE is coverage, in both directions. The pair used to point
     * at `aim` and `aim + PI`, so half the output faced backwards at all times;
     * it now runs as two parallel lines both pointing where you are pointing.
     * That is a straight upgrade when you are aiming and a straight downgrade
     * when you are not, which is the entire design of the shape.
     *
     * `pierce: 99` stays and stays DEAD. `deadhunt-ranges` reported it under
     * `beam` and reports it under `lance`; nothing has regressed and nothing
     * has been repaired. It is not deleted because `synthesiseDuet` takes
     * `Math.max` of each parent's `pierce`, so removing it would quietly turn
     * every bow-parented duet from a piercing weapon into a non-piercing one —
     * a real balance change disguised as a tidy-up. Fixing it properly means
     * giving `pierce` a meaning for a line that damages everything it crosses,
     * and there is not one.
     */
    shape: 'lance',
    blurb: 'One held beam along your facing. It does not stop.',
    character: 'mournful — long bowed sostenuto',
    weight: 0.85,
    base: stats({ interval: 1.6, count: 1, damage: 7, area: 9, speed: 0, pierce: 99, linger: 0.5, range: 520 }),
    steps: [
      {
        note: 'a far thicker stroke, held much steadier, reaching right across the arena',
        mul: { linger: 1.6, area: 1.4, range: 1.5 },
      },
      {
        /*
         * The note changed because the behaviour did. It used to read "a second
         * beam draws OPPOSITE the first ... redrawn so often the pair is all
         * but continuous", which described `fireBeam`'s compass spread and its
         * re-fire. Neither survives the re-point: the second line is parallel
         * and the pair is genuinely continuous rather than nearly so.
         * `AGENTS.md` §3 asks that a note say what the player will SEE, and
         * this one now does.
         */
        note: 'a second line runs alongside the first, both cutting half again as hard, and the pair holds without a flicker',
        add: { count: 1 },
        mul: { linger: 1.7, interval: 0.465, damage: 1.6 },
      },
    ],
  },
  {
    id: 'chime',
    /*
     * CHIME IS NOW RITARDANDO, AND IT DEALS NO DAMAGE AT ALL.
     *
     * `docs/plan-items-v2.md` §1: the roster had twelve damage dealers and zero
     * of anything else, and that is the most obvious hole in it. Vampire
     * Survivors has Laurel, Clock Lancet, Garlic and Tiragisu; the whole
     * reference class this game is chasing gets its variety from items that are
     * not a damage number. RITARDANDO is control, and the price is control of
     * yourself.
     *
     * WHAT IT DOES. Enemies inside `area` of the ship move, turn and fire at a
     * fraction of their speed. Every instrument in your loadout takes
     * proportionally longer to come round. You buy a bubble you can stand in
     * and pay for it out of your own rate of fire, which is the first genuine
     * DRAWBACK any item in this table has carried.
     *
     * WHY IT COST CHIME ITS PLACE IN `STARTERS`. An opener has to be able to
     * kill things in the first minute and this one cannot kill anything ever.
     * `tools/openers.mjs` asserts the weakest opener reaches 70% of the best,
     * and it is right to: a starter that cannot clear wave one is not a choice,
     * it is a trap. See the note on `STARTERS` in `progression.ts` for the
     * replacement and why it is a better set than the one it replaces.
     *
     * `damage` IS REUSED AS THE DRAG DEPTH, and it is signed so that MORE is
     * STRONGER: it is the fraction of enemy time REMOVED, not the fraction
     * left. That is not decoration. `tools/levelup.mjs` asserts
     * `damage * count / interval` never falls as an instrument levels, and a
     * field holding "enemies run at 55%" would read as a REGRESSION every time
     * the item got better. `arc` is what the drag costs you, as a fraction of
     * your own interval added on. `count` reaching 2 is the flag that enemy
     * BULLETS are dragged as well as enemy bodies — a rung with no number to
     * spend, expressed in the one field the shape has spare.
     *
     * DEPTH AND RADIUS WERE BOTH CUT AFTER THE FIRST MEASUREMENT, for the same
     * reason REST's cooldown went the other way: at 0.72 depth over a 486px
     * bubble this covers most of a 900x780 view and takes 72% off everything in
     * it, bodies AND fire, permanently. That is not control, it is a difficulty
     * setting. 0.40 / 0.52 / 0.62 over 220 / 297 / 356px is a bubble you have
     * to stand in.
     *
     * `World.ensembleDps` skips this shape outright. A "nominal dps" column
     * that counted 0.72 as damage would be quietly wrong in every balance tool
     * in `tools/`, which is exactly the class of defect this file's history is
     * made of.
     */
    label: 'RITARDANDO',
    shape: 'drag',
    blurb: 'Time drags in a bubble around you. Enemies crawl, and so does your own rate of fire. No damage.',
    character: 'shimmering — a single struck bell, long decay',
    weight: 0.9,
    base: stats({ interval: 1.2, count: 1, damage: 0.4, area: 220, arc: 0.3, linger: 0.6 }),
    steps: [
      {
        note: 'the bubble opens half again as wide, enemies inside it drop to under half speed, and it costs you less',
        add: { damage: 0.12 },
        mul: { area: 1.35, arc: 0.85, linger: 1.3 },
      },
      {
        note: 'enemy FIRE slows inside it as well as enemy bodies, in a bubble wider again and deeper still',
        add: { count: 1, damage: 0.1 },
        mul: { area: 1.2, arc: 0.85 },
      },
    ],
  },
  {
    id: 'harp',
    /*
     * HARP GLISS IS NOW COUNTERPOINT — the first item in this game that
     * modifies another item.
     *
     * `docs/plan-items-v2.md` §3: Ball x Pit's actual core is that things
     * compose, and nothing here composed. Twelve instruments each did their own
     * thing on their own timer, and the twelve passives were global
     * multipliers, which is the flattest imaginable version of an item
     * interacting with a build. A roster with no interactions has no lattice,
     * and a lattice is where "rich ecosystem" actually comes from.
     *
     * WHAT IT DOES. Whenever the FIRST instrument in your loadout fires, your
     * SECOND fires a copy — same routine, same geometry, a share of its damage.
     * At level 3 your third answers as well.
     *
     * AND THAT MAKES LOADOUT ORDER A DECISION, which is the interesting part.
     * Order is acquisition order; the player has always controlled it and has
     * never once had a reason to think about it. With COUNTERPOINT held, a fast
     * first instrument and a heavy second is a completely different build from
     * the reverse — and it is the one build decision in the game that costs no
     * picks at all.
     *
     * `docs/plan-items-v2.md` §7 names the risk and it is real: "if the player
     * cannot see which instrument is first, the item is a coin flip." The HUD
     * draws the loadout in acquisition order already, so the information is on
     * screen; whether it READS as an ordering is not something any tool here
     * can answer.
     *
     * `damage` is the copy's share of the follower's damage, `count` extra
     * projectiles on the copy, `pierce` HOW MANY followers answer, `interval` a
     * floor on how often a copy may be struck. Nothing else is read: this shape
     * has no geometry of its own, which is what makes it a modifier rather than
     * a weapon.
     */
    label: 'COUNTERPOINT',
    shape: 'counterpoint',
    blurb: 'Your second instrument fires a copy whenever your first does. The order you took them in matters now.',
    character: 'shimmering — a cascading harp run',
    weight: 0.9,
    base: stats({ interval: 0.6, count: 0, damage: 0.7, pierce: 1 }),
    steps: [
      {
        note: 'the answering voice carries an extra projectile of its own, and it may be struck twice as often',
        add: { count: 1 },
        mul: { interval: 0.5 },
      },
      {
        note: 'your THIRD instrument answers as well, and both copies come through as strong as the original',
        add: { count: 1, pierce: 1 },
        mul: { damage: 1.6 },
      },
    ],
  },
  {
    id: 'drones',
    /*
     * DRONE PODS IS NOW UNISON: the whole band stops using its own timers and
     * fires TOGETHER, on the bar.
     *
     * The second of the two items that modify other items, and the one that
     * changes the shape of a run rather than a build. A trickle becomes a
     * volley. Six instruments landing on the same beat is one enormous hit; six
     * instruments on six timers is a texture — and the game has only ever had
     * the texture.
     *
     * IT MAKES BREADTH BEAT DEPTH, which is the point. `tools/builds.mjs`
     * measures the `greedy` (spread wide) policy against `narrow` (go deep) and
     * the game has always rewarded depth. UNISON is the card that inverts that
     * for one run, and inverting a dominant strategy is worth more than adding
     * a number to it.
     *
     * RATE-NEUTRAL BY CONSTRUCTION, and this had to be argued rather than
     * tuned. Re-clocking an instrument from its own `interval` to one bar
     * multiplies its activations by `interval / bar`, so `World.fireInstruments`
     * multiplies its damage by `bar / interval`, clamped to [0.4, 12]. Without
     * that, UNISON is a 12x buff to a 0.15s weapon and a 45% NERF to a 3.2s
     * one — two numbers colliding, not a design. With it, the conversion costs
     * and gains nothing and this ladder is the whole of the payment.
     *
     * `damage` is the multiplier on the assembled volley, `count` extra
     * projectiles every instrument puts into it, `linger` how far past a bar
     * line a late instrument may still join. `interval` is read by the
     * dispatcher and nothing else.
     */
    label: 'UNISON',
    shape: 'unison',
    beat: 'bar',
    blurb: 'The whole band drops its own timers and fires together, on the bar. Breadth starts beating depth.',
    character: 'eerie — the arp split into hard-panned satellites',
    weight: 0.95,
    base: stats({ interval: 1.0, count: 0, damage: 1.25 }),
    steps: [
      {
        note: 'every instrument in the band puts one more projectile into the volley',
        add: { count: 1 },
      },
      {
        note: 'the band lands on the half-bar as well, half again as hard, with two extra projectiles from each player',
        beat: 'halfbar',
        add: { count: 1 },
        mul: { damage: 1.6 },
      },
    ],
  },
  {
    id: 'nova',
    /*
     * NOVA IS NOW REST, AND ITS DAMAGE IS ZERO ON EVERY RUNG.
     *
     * A full bar in which nothing can touch you, on a long cooldown — and your
     * whole band stops playing for every beat of it. The mix drops to its drone
     * and comes back on the bar line, and the ring that sweeps the field clean
     * lands with it.
     *
     * THE SECOND ITEM WITH NO DAMAGE, and the one that makes the axis a real
     * axis rather than one experiment. A player holding REST is playing a
     * different game for one bar in twenty: they can walk INTO the thing they
     * have spent the whole run walking away from, which is the only item here
     * that changes what the player is allowed to do rather than what they hit.
     *
     * THE SILENCE IS THE COST AND IT HAD TO BE AUDIBLE, or this is just Laurel
     * with extra steps. `GameSnapshot.tacetStems` carries the whole band while
     * the rest runs and the director zeroes those lanes; `SILENCEABLE_STEMS`
     * deliberately excludes `sub`, `hats`, `fx` and `power` so what is left is
     * a drone and not a crash. `docs/plan-items-v2.md` §7 names the failure
     * mode exactly: the silence has to read as dramatic rather than as a bug,
     * and that is a judgement no tool in this repository can make.
     *
     * `linger` IS IN BARS, not seconds. A rest that ends mid-bar is not a rest,
     * and the whole item is built on the player hearing where it starts and
     * stops. `interval` is the cooldown in seconds, `area` the radius of the
     * return sweep, `count` how many rings that sweep is made of.
     *
     * ---------------------------------------------------------------------
     * THE COOLDOWN GOES UP WITH THE LADDER, WHICH LOOKS BACKWARDS AND IS NOT.
     *
     * It went DOWN in the first draft — 26s, 22s, 13.7s against 1, 2 and 3 bars
     * of rest — and that is 7%, 22% and **39% of the whole run invulnerable**.
     * At 39% the item stops being a bar you spend and becomes a background
     * property of the run, and `tools/builds.mjs` could see the consequence
     * even though it has no idea REST exists: damage taken across the seven
     * pick policies collapsed from a 2.4x spread to 1.4x, because every policy
     * was picking up the same blanket immunity.
     *
     * Uptime is now 7%, 12% and 16%. What the ladder buys is the LENGTH of the
     * window — one bar is a dodge, three bars is a plan — and not how much of
     * the run you spend inside one.
     *
     * AND THE GUNS STOP TOO. `World.fireInstruments` returns early for the
     * whole rest, so the band is silent in the simulation as well as in the
     * mix. The first implementation silenced only the sound, which made the
     * card's own sentence false and the item a bar of free immunity. Read that
     * as the item's real shape: a rest is time you spend NOT killing things,
     * and at three bars on a 34-second cooldown it is 16% of the run's damage
     * traded for 16% of the run's danger.
     *
     * `damage: 0` IS THE DECLARATION. `tools/levelup.mjs` asserts nominal dps
     * never falls as an item levels; 0, 0, 0 passes, and any later editor who
     * gives this row a damage number will be undoing the design rather than
     * balancing it.
     */
    label: 'REST',
    shape: 'rest',
    /*
     * THE LOCK WAS IN THE PROSE AND NOT IN THE ROW, which is this file's own
     * favourite defect. `fireRest` says in as many words that 'the shape carries
     * beat: bar so it can only ever begin on a line', and it did not — the field
     * was simply never written. `tools/beatlock.mjs` printed REST as an UNLOCKED
     * row with 25/13/0/0/0/0/13/50 across the bar, which is a rest starting
     * wherever the cooldown happened to land. The whole item is built on the
     * player hearing where the silence starts and stops.
     */
    beat: 'bar',
    blurb: 'A whole bar where nothing can touch you — and your whole band stops playing for every beat of it.',
    character: 'heavy — a wide room clap on the pulse',
    weight: 0.8,
    base: stats({ interval: 26, count: 1, damage: 0, area: 320, linger: 1 }),
    steps: [
      {
        note: 'two full bars of silence instead of one, and the band coming back sweeps a far wider ring clean',
        add: { linger: 1 },
        mul: { area: 1.5, interval: 1.15 },
      },
      {
        note: 'three bars, and the return comes back as two rings that throw back and stagger everything they reach',
        add: { linger: 1, count: 1 },
        mul: { interval: 1.13, area: 1.3 },
      },
    ],
  },
  {
    id: 'blackhole',
    label: 'BLACK HOLE',
    shape: 'field',
    blurb: 'A well that drags everything in and crushes it.',
    character: 'heavy — a sub drone sliding down into an impact',
    weight: 0.7,
    base: stats({ interval: 6.5, count: 1, damage: 26, area: 150, linger: 2.4 }),
    steps: [
      {
        note: 'the well pulls from half again as far out, holds open longer, and is deployed more often',
        mul: { area: 1.536, linger: 1.4, interval: 0.72 },
      },
      {
        note: 'a second well, swallowing enemy fire as well as enemies, and the collapse detonates outward when it closes',
        add: { count: 1 },
        mul: { area: 1.2, damage: 2.4 },
      },
    ],
  },
  {
    id: 'feedback',
    label: 'DROP',
    /*
     * THE FOURTH SHAPE RE-POINT, AND THE ONE THAT COSTS THE MOST TO ARGUE.
     *
     * `aura` held SEVEN of twenty-seven instruments — 26%, the largest share in
     * the table by a wide margin, and three of the seven (CATHEDRAL, REQUIEM,
     * TUTTI) describe themselves as "a very large ring". The `FUSIONS` preamble
     * below already refuses a fourth on exactly that ground. FEEDBACK is the
     * cheapest one to move because it is already a short-range weapon — "burns
     * whatever comes close" — so it gains a facing rather than a range.
     *
     * THE STAT BLOCK IS RE-AUTHORED, WHICH THE OTHER RE-POINTS DID NOT NEED,
     * and this is the honest part. `cone` reads `arc`, `speed`, `range` and
     * `pierce` and ignores `area` and `linger`; the aura block set `area` and
     * nothing else. Carrying it over verbatim would have produced a cone with
     * no spread, no muzzle velocity and no reach, and `deadhunt-ranges` would
     * have printed `feedback.area 74->166 (the ladder moves it)` — the exact
     * defect class this table's history is made of. So `area` is DELETED rather
     * than carried, the way VIBRATO's `speed` was.
     *
     * POWER, TRACKED RUNG BY RUNG on `damage x count / interval`, which is the
     * convention CHORALE and VIBRATO were both argued on:
     *
     *     L1  was 10.0   now 11.7        L2  was 22.7   now 26.3
     *     L3  was 61.4   now 61.3
     *
     * The ceiling lands within a fifth of a per cent of where it was, and the
     * two rungs beneath it are within 16%. Nominal is generous to a cone and
     * stingy to an aura in
     * opposite directions and both are worth saying: an aura's ring hits
     * EVERYTHING inside its radius for full damage, so nominal understates it
     * badly in a crowd; a cone's pellets are counted as if every one of the
     * twelve connects, which at 250px of reach they will not. The real delivery
     * is therefore lower than these numbers on both sides of the change, and
     * `tools/arena.mjs`, `tools/builds.mjs` and `tools/openers.mjs` are where
     * that gets decided rather than here. FEEDBACK is not a starter, so
     * `openers` measures it only through the offer pool.
     *
     * AND IT COSTS A DEFENCE NOBODY WROTE DOWN, WHICH IS THE PART THAT MOVED
     * THE NUMBERS. `fireAura` pushes its rings into `novas` with
     * `clears: true`, and `updateNova` DELETES ENEMY BULLETS in the expanding
     * annulus — so every aura in this table is quietly also a bullet-cancel,
     * and neither FEEDBACK's blurb nor WALL OF SOUND's ever mentioned it. A
     * cone spawns bullets and clears nothing. Measured over `tools/builds.mjs`
     * at 900s x 8 seeds x 7 policies, hits taken across the policies went from
     * 12-32 to 24-67 while the mean wave reached barely moved (26.4 -> 25.5 for
     * the `first` policy, 27.0 -> 26.9 for `narrow`), and `tools/arena.mjs`
     * agrees: encirclement p90 0.27 -> 0.33 against a 0.25 bar, so the player is
     * more exposed rather than slower. Both gates still pass and the direction
     * is the one the INSTRUMENT_MAX_LEVEL note above says the curve needs, but
     * it is a real change and it is not in the nominal-power arithmetic. If a
     * later pass wants the defence back, give it to the shape rather than to
     * these two rows — a bullet-clearing cone is a design decision, and putting
     * FEEDBACK back on `aura` to get it would undo the census fix.
     *
     * THE BLURB CHANGED. "A hum around the hull" is an omnidirectional
     * sentence and this is no longer an omnidirectional weapon; leaving it
     * would have been a fourth entry on the "prose the simulation does not
     * deliver" list two paragraphs of this file already complain about. The
     * `character` phrase is untouched, so the audio side sees no change at all.
     */
    /*
     * FEEDBACK IS NOW DROP, AND THE SHAPE DID NOT MOVE — the CLOCK did.
     *
     * It keeps the cone, the stat block and the ladder it was given one pass
     * ago, and gains one property: it is near-inert during the intro, the
     * build, the breakdown and the fill, and it is the loudest thing on the
     * field during the drop. `Swell.drop` reads `MusicalState.section` and
     * `MusicalState.energy`, which `main.ts` pushes in from the director.
     *
     * THE RUN'S MUSICAL ARC BECOMES A COMBAT CLOCK. Nothing else in this game
     * has ever asked the player to listen for a cue and then act on it — the
     * arrangement has been a beautiful readout of a fight it had no say in
     * since the project started (`docs/plan-items-v2.md` §2). A player holding
     * DROP saves position, saves the well, saves the bomb, and spends all of it
     * when the build lands.
     *
     * MEASURED, BECAUSE THE SECTION SHARE DECIDES WHETHER THIS IS A DESIGN OR A
     * TAX. `tools/sections.mjs` over 8 seeds x 300s: drop 42.5%, build 17.2%,
     * breakdown 16.5%, sustain 16.2%, intro 4.1%, fill 3.4%. So the item is
     * live for a bit under half a run — often enough to build around, rarely
     * enough that its arrival is an event. Time-weighted, the swell works out
     * about 18% above a flat item of the same block, which is the volatility
     * premium and is deliberate.
     *
     * IT IS NOT AN OPENER AND MUST NOT BECOME ONE. Four minutes of `openers`
     * would spend most of itself outside a drop.
     */
    shape: 'cone',
    swell: 'drop',
    blurb: 'Almost nothing until the drop lands. Inside one, the loudest thing on the field.',
    character: 'aggressive — saturated amp hum, no attack at all',
    weight: 0.85,
    base: stats({ interval: 0.6, count: 5, damage: 1.4, arc: 0.8, speed: 880, range: 190 }),
    steps: [
      {
        note: 'four more pellets in the burst, thrown wider and further, and the drop comes round sooner',
        add: { count: 4 },
        mul: { arc: 1.15, range: 1.15, interval: 0.8 },
      },
      {
        note: 'twelve pellets that punch clean through everything while the drop is running, wide enough for a whole rush',
        add: { count: 3, pierce: 2 },
        mul: { interval: 0.8, damage: 1.4, arc: 1.35, speed: 1.2, range: 1.15 },
      },
    ],
  },
  {
    id: 'echoes',
    /*
     * ECHO CHAMBER IS NOW SOSTENUTO: the last enemy you killed comes back and
     * fights for you.
     *
     * The third non-damaging item, in the sense that matters — SOSTENUTO itself
     * has no hitbox anywhere. What it has is a rule about corpses, and that
     * turns the field into a resource. You stop shooting the nearest thing and
     * start choosing what to kill, because what you kill is what stands next to
     * you for the next seven seconds.
     *
     * NO NEW CONTAINER. A ghost is a `BulletFlag.Summon` bullet, driven by
     * `updateSummons`, drawn as sprite type 2 — all of which `spawn` (VIBRATO)
     * already built and `tools/effectsdraw.mjs` already asserts is drawn. The
     * difference is entirely WHERE and WHEN: a summon is bought on a timer at
     * the ship, a ghost is raised at a body.
     *
     * IT SURVIVES ITS OWN HITS, which `spawn` does not, and that is the one
     * change to `collidePlayerBullets` this item needed. A summon is consumed
     * on contact; a ghost carries `bounces` as STRIKES REMAINING and recoils
     * instead, which both keeps it alive to be an ally and rate-limits it — a
     * piercing ally would sit inside the first body it reached and apply its
     * damage on all 120 steps a second, which is why `spawn` refuses pierce.
     *
     * IT CANNOT OPEN A RUN, AND THAT IS A HARD DEADLOCK RATHER THAN A WEAKNESS.
     * No other weapon means no kill; no kill means no ghost; no ghost means no
     * kill. `echoes` therefore had to leave `STARTERS` — see the note there.
     * The old ECHO CHAMBER was in that list on merit and this is a real loss;
     * the wall-bouncing it brought survives in CANON, which is still its
     * evolution.
     *
     * `count` is the standing retinue, `linger` a ghost's lifetime, `damage`
     * its strike, `speed` its travel, `bounces` how many strikes it has in it,
     * `interval` the minimum gap between raisings, `range` how far from the
     * ship a corpse may be and still be raised.
     */
    label: 'SOSTENUTO',
    shape: 'ghost',
    blurb: 'The last thing you killed comes back and fights beside you until it fades.',
    character: 'eerie — the same hit returning late and quieter',
    weight: 0.85,
    base: stats({ interval: 1.4, count: 1, damage: 9, speed: 300, bounces: 3, linger: 7, range: 700 }),
    steps: [
      {
        note: 'two ghosts stand with you at once, they last half again as long and each one strikes far harder',
        add: { count: 1, bounces: 2 },
        mul: { linger: 1.6, damage: 1.8 },
      },
      {
        note: 'three ghosts, raised almost the instant you kill, moving faster and tearing through what they reach',
        add: { count: 1, bounces: 3 },
        mul: { interval: 0.45, damage: 1.5, speed: 1.4 },
      },
    ],
  },
  {
    id: 'timpani',
    /*
     * TIMPANI IS NOW CRESCENDO: the only weapon in the game that wants you in
     * trouble.
     *
     * Its damage is multiplied by how much danger the ship is actually in —
     * feeble on an empty field, enormous inside a ring. It inverts the risk
     * curve every other item in this table sits on, and inverting a curve is
     * worth more than steepening one: the whole roster's answer to pressure has
     * always been "get out", and this is the one card that answers "stay".
     *
     * IT READS THE WORLD, NOT THE MUSIC, AND THAT IS DELIBERATE. The plan
     * (`docs/plan-items-v2.md` §3) names `energy`, which is the director's
     * blend of run progress and immediate danger. The behaviour it asks for —
     * "feeble when safe, enormous when surrounded" — is the second half of that
     * blend and nothing else, and the world already computes it:
     * `World.analyseEncirclement` produces the exact signal `tools/arena.mjs`
     * gates the difficulty curve on. Using it means CRESCENDO needs no
     * `MusicalState` push, behaves identically in a headless gate and a played
     * run, and cannot be made strong by surviving for a long time in safety.
     * Say plainly what that costs: this item does NOT respond to the
     * arrangement, and one of the five musical-axis slots is therefore musical
     * in name rather than in mechanism.
     *
     * `World.dangerSwell` is the multiplier and `tools/beatlock.mjs` prints its
     * distribution over a real run, because a swell whose input sits at 0.04
     * for the whole game is a swell that is off — and the raw encirclement p50
     * IS 0.04. It is blended with the nearest-threat and local-population
     * signals for exactly that reason.
     *
     * THE BLOCK IS FRONT-LOADED, BECAUSE THIS IS THE THIRD OPENER NOW — see
     * `STARTERS`. `tools/_openersweep.mjs` measured it at 3.7 waves against
     * METRONOME's 6.7, which is 55% against a 70% floor; `damage` goes 34 -> 54
     * at level 1 and the top rung's multiplier comes down 2.4 -> 1.6 to pay for
     * it, which takes it to 5.3 waves (76%). The ceiling moves 90.7 -> 96.0 per
     * second before the swell, under 6%, while the opening moves 10.6 -> 16.9.
     * The swell then multiplies whatever that is by 0.3 to 3.3.
     *
     * Unlike SYNCOPATION this row needed no reach: an aura already covers 170px
     * in every direction, which is the same property that made the old TIMPANI
     * a better opener at 10.6 nominal than FEEDBACK was at 11.7.
     *
     * The number in the block is the FLOOR of a range rather than the value,
     * which is the one thing to keep in mind when reading it against any other
     * row in this table.
     */
    label: 'CRESCENDO',
    shape: 'aura',
    swell: 'danger',
    blurb: 'Feeble while you are safe. Enormous while you are surrounded. It wants you in trouble.',
    character: 'heavy — orchestral, felt in the chest',
    weight: 0.7,
    base: stats({ interval: 3.2, count: 1, damage: 54, area: 170, linger: 0.25 }),
    steps: [
      {
        note: 'the wave carries much further and lands more often — and it now swells outward with the danger too',
        mul: { area: 1.69, interval: 0.75, linger: 1.8 },
      },
      {
        note: 'a second, delayed wave, and being surrounded is worth well over half again what it was worth',
        add: { count: 1 },
        mul: { area: 1.2, damage: 1.6 },
      },
    ],
  },
  {
    id: 'tremolo',
    /*
     * TREMOLO FIELD IS NOW TACET: you silence a lane of your own soundtrack,
     * the quiet banks up, and it lands when the part comes back in.
     *
     * THE ONLY ITEM IN THE GAME WHOSE COST IS PAID IN THE THING THE GAME IS
     * ABOUT. Every other trade-off here is mechanical — rate for damage, range
     * for safety. This one asks the player to make their own soundtrack worse
     * for a payoff, and the readout for the resource is not a bar on the HUD,
     * it is the missing part. You can hear how charged it is.
     *
     * THE CYCLE. `range` bars of playing, then `linger` bars with `count` lanes
     * out of the mix, banking `damage` a bar; on the bar line the lanes come
     * back, the bank discharges as a ring of radius `area` and the cycle
     * restarts. It is locked to the bar because a tacet that begins in the
     * middle of one is not a tacet, it is a dropout — so `interval` is only the
     * dispatcher's floor (0.5s, under one bar) and `range` carries the count of
     * bars, which is the one spare field on a shape that has no reach.
     *
     * WHICH LANE. A rota over `SILENCEABLE_STEMS`, advancing each cycle, so the
     * item does not spend a whole run removing the same part — and never
     * `sub`, `hats`, `fx` or `power`, so there is always something sounding.
     * `docs/plan-items-v2.md` §7 names the risk: silence has to read as
     * dramatic, not as a bug.
     *
     * THIS IS THE SECOND RE-POINT THIS ROW HAS HAD. It was `field`, then
     * `trail` ("pools left in your wake", which the simulation finally
     * delivered one pass ago), and now this. The wake is not lost — VIBRATO,
     * still this instrument's evolution, is `spawn`, and UP-TEMPO in the rig
     * lays a trail on distance travelled. Say plainly that a good implemented
     * shape was spent here: `trail` was the item the last pass was proudest of
     * and the owner still found the roster boring, which is the whole argument
     * of `docs/plan-items-v2.md` §1 in one row.
     */
    label: 'TACET',
    shape: 'tacet',
    beat: 'bar',
    blurb: 'Silences a lane of your own soundtrack. The quiet banks up, and lands when the part comes back.',
    character: 'shimmering — unsettled, wobbling, never quite still',
    weight: 0.85,
    base: stats({ interval: 0.5, count: 1, damage: 7, area: 150, linger: 2, range: 4 }),
    steps: [
      {
        note: 'the part stays out for twice as long, so twice as much banks up, and it comes back wider',
        add: { linger: 2 },
        mul: { damage: 1.6, area: 1.4 },
      },
      {
        note: 'two parts go quiet at once, and what comes back sweeps every bullet it reaches off the field',
        add: { count: 1 },
        mul: { damage: 1.5, area: 1.35 },
      },
    ],
  },

  /* -------------------------------------------------------------------- *
   * Fusions. Never offered; only earned. `steps` is empty because a fusion
   * arrives finished — its whole point is that it is not on a ladder.
   * -------------------------------------------------------------------- */

  {
    id: 'spiccato',
    label: 'SPICCATO',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: 'The bolts stop stopping. They skip off everything and keep going.',
    character: 'aggressive — bouncing bow, dry ricochet',
    base: stats({ interval: 0.1, count: 7, damage: 9, speed: 1500, pierce: 3, bounces: 2, range: 1100 }),
    steps: [],
  },
  {
    /*
     * PIZZICATO'S SECOND ENDING, and the first branch in the tree.
     *
     * Every other evolution in this table is the only one its base has. Twelve
     * instruments, twelve evolutions, one catalyst each — so choosing an
     * instrument chose its ending too, and the only open question was whether
     * that one catalyst ever came up. That is a lookup, not a decision, and it
     * is the half of "the concept of mixing weapons together isn't really
     * there" that survives every other system working correctly.
     *
     * A branch costs nothing the offer pool cares about, which is why this is
     * the shape the fix takes. `compressor` already exists — it is BLACKHOLE's
     * catalyst — so no thirteenth rig item is added and the deliberate 12x12
     * survives. The result is `fused`, and `availableOptions` skips fused defs
     * outright, so it is never drafted and occupies no card slot. Nothing is
     * added to a four-card offer; an existing card simply becomes worth more,
     * which is the only way out of the zero-sum trap this project has found.
     *
     * The decision is real because `applyFusion` deletes the base. Hold
     * PIZZICATO at its ceiling with both CAPO and COMPRESSOR maxed and both cards are on
     * the table; take either and the base is spent, so the other is gone for
     * the run. That is the Ball x Pit shape — commit, and the commitment costs
     * you the alternative.
     *
     * IT IS A SIDEGRADE ON PURPOSE, and deliberately not an arc. HARP already
     * owns the fan-of-bolts territory and CROSSSTRUNG is its 360-degree
     * ending; giving PIZZICATO an arc would blur two roster lines into one,
     * which is the objection that killed the RICOCHET rig item. So both
     * branches stay `seek` and split on stat philosophy instead. SPICCATO is
     * seven fast light bolts that bounce — it clears crowds. This is one heavy
     * bolt that goes through things — 375 dmg/s on a single target against
     * SPICCATO's 630, and far more than that through a line. Trading raw
     * single-target damage for penetration is a direction, and it is the
     * direction SPICCATO cannot go.
     *
     * The name is real technique: Bartok pizzicato, the snap where the string
     * is pulled clear of the fingerboard and slaps back against it. The
     * loudest sound a plucked string can make, and a percussive one.
     *
     * BALANCE IS GATE-CHECKED, NOT PLAYTESTED. `tools/combine.mjs` asserts a
     * committed build still beats a fusion-ignoring control, and
     * `tools/builds.mjs` asserts the pick still moves the outcome. Read those
     * numbers rather than these; nobody has played this.
     */
    id: 'snap',
    label: 'SNAP',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: 'One bolt, pulled clear and let go. It goes through whatever is in the way.',
    character: 'aggressive — Bartok snap, string against fingerboard',
    base: stats({ interval: 0.28, count: 1, damage: 105, speed: 2200, pierce: 6, range: 1400 }),
    steps: [],
  },
  {
    id: 'blastbeat',
    label: 'BLAST BEAT',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: 'Sweeps front and back with no gap between them, forever.',
    character: 'aggressive — relentless, mechanical, no gaps',
    base: stats({ interval: 0.16, count: 4, damage: 22, area: 190, arc: 2.6, range: 190 }),
    steps: [],
  },
  {
    id: 'harmonics',
    label: 'HARMONICS',
    /*
     * ROSIN BOW's ending, and it moves with it. `bow + laser -> harmonics` has
     * LASER as its literal catalyst and "Three parallel beams, held" as its
     * literal blurb, so this is the one row in the table where the recipe, the
     * catalyst and the text all named the same shape and the field disagreed
     * with all three.
     *
     * Stat block untouched, for the reason given at ROSIN BOW: `fireLance`
     * delivers `damage / interval` to a target in the line, which is exactly
     * what `fireBeam`'s overlapping generations delivered. `count: 3` stops
     * being three strokes at 0, 120 and 240 degrees and becomes the three
     * parallel lines the blurb has always claimed.
     *
     * `harmonics + crossstrung -> stringsection` still changes the verb —
     * `lance -> arc` where it used to be `beam -> arc` — so the one union that
     * was already earning its shape change keeps earning it.
     */
    shape: 'lance',
    fused: true,
    weight: 0,
    blurb: 'Three parallel beams, held. Nothing crosses them twice.',
    character: 'shimmering — a glassy overtone stack above the fundamental',
    base: stats({ interval: 0.9, count: 3, damage: 20, area: 14, pierce: 99, linger: 1.6, range: 900 }),
    steps: [],
  },
  {
    id: 'carillon',
    label: 'CARILLON',
    /*
     * THE SEVENTH RE-POINT, AND `docs/research-weapons.md` §D.3 CALLS IT THE
     * HIGHEST-VALUE ONE AVAILABLE. The blurb below is verbatim "Every strike
     * chains to two more" and `fireStrike` picked its targets AT RANDOM. There
     * was no chain, and the `FUSIONS` preamble has said so in as many words.
     *
     * It also fixes what the recipe is FOR. `chime + resonance -> carillon` was
     * `strike -> strike`: the evolution bought a bigger bell, and this file's
     * own header rule is that a fusion must change the verb. It changes it now.
     *
     * CHIME DOES NOT MOVE. `strike` was split out of `seek` for the bell family
     * and the preamble's "Rejected on the census" bullet refuses to move CHIME
     * itself; this moves CHIME's EVOLUTION, which is a different row and the
     * one the blurb was written on.
     *
     * `area: 60 -> 170` IS A RE-TUNE AND NOT THE BUFF IT LOOKS LIKE. On
     * `strike` it was the blast radius around each landing; on `chain` it is
     * how far a hop can REACH for the next body, which is a different unit.
     * 60px between two enemy centres is inside contact range for a pair of 15px
     * shapes, so a 60px hop radius would have stopped the chain at one body on
     * every wave that was not a pile-up — the shape would have existed and
     * never fired past its first hop. 170 is a little over a typical two-shape
     * gap in a formation, which is what makes density the thing the weapon
     * reads.
     *
     * `pierce: 3` IS DELETED, and it was already dead: `strike` did not read it
     * either, so `deadhunt-ranges` printed `DEAD carillon.pierce=3 (set,
     * static)` before this change. Same call CROSS-STRUNG's `pierce: 2` got —
     * a stat kept and unread is the defect this whole audit exists to remove.
     *
     * POWER. Nominal `damage x count / interval` is 300 before and after. Real
     * output falls: five flat 30s become 30 + 25.5 + 21.7 + 18.4 + 15.7 = 111
     * at the 0.85 falloff, against five strikes that could each catch a second
     * shape in their circle. The compensation is that every hop lands on a
     * DISTINCT live body where five random strikes can and routinely do land on
     * the same one — the case `fireStrike`'s own comment admits it chose.
     */
    shape: 'chain',
    fused: true,
    weight: 0,
    blurb: 'Every strike chains to two more. The ringing does not stop.',
    character: 'shimmering — bells chaining into each other',
    base: stats({ interval: 0.5, count: 5, damage: 30, area: 170, range: 900 }),
    steps: [],
  },
  {
    id: 'crossstrung',
    label: 'CROSS-STRUNG',
    /*
     * THE FIFTH SHAPE RE-POINT, AND IT IS A REPAIR RATHER THAN A NEW IDEA.
     *
     * "A full circle of strings, swept continuously" already described a
     * rotating pattern, and `fireArc`'s travelling branch could not produce
     * one: it lays `count` bolts across `arc` centred on the aim and does it
     * again, identically, every interval. At `arc: 6.28` that is the same
     * twenty spokes redrawn in the same twenty places forever. Nothing swept.
     *
     * `spray` precesses the volley by `arc / count` each activation, so
     * consecutive volleys interleave and the field turns — and it forwards
     * `bounces`, so the pattern comes back off the walls through where you were
     * standing. That is the "more fun with projectiles" the owner asked for and
     * it is the only shape in the table that gives the player a PATTERN rather
     * than a volley.
     *
     * `pierce: 2` IS DELETED, AND IT IS A NERF. `spray` deliberately does not
     * read `pierce`, because a bolt consumed on contact is what keeps the live
     * count bounded and this is the one shape in the catalogue whose budget is
     * real — `docs/MASTER_PLAN.md` G4 already records this instrument silently
     * hitting `MAX_PLAYER_BULLETS`. Keeping the stat and not reading it would
     * have printed `crossstrung.pierce=2 (set, static)` in `deadhunt-ranges`;
     * keeping the stat and reading it would have made every one of ~90 live
     * bolts immortal. So it goes, the way VIBRATO's `speed` went, and the loss
     * is real: these bolts now stop at the first thing they hit.
     *
     * POWER, on the same nominal `damage x count / interval` the other
     * re-points were argued on: 10 x 20 / 0.34 = 588 before, 14.28 x 14 / 0.34
     * = 588 after. Exactly neutral on that metric and a genuine reduction in
     * play, because the pierce is gone. That is deliberate — it is the price of
     * a bounded budget — and `tools/arena.mjs` and `tools/builds.mjs` are where
     * it should be read rather than here.
     *
     * BUDGET, WHICH IS THE WHOLE REASON THIS ROW IS ANNOTATED AT LENGTH, AND
     * IT WAS TUNED AGAINST A MEASUREMENT RATHER THAN AGAINST THE ARITHMETIC.
     *
     * `count` 14 plus SPREAD's 3 is 17 bolts per volley; `range / speed` is
     * invariant under CAPO, because `applyModifiers` scales `range` by the same
     * multiplier it scales `speed` by, so the life is a fixed 1.15s; the floor
     * interval is 0.34 x RAPID's 0.62 = 0.211s. That says 5.5 overlapping
     * generations and 93 bolts in flight.
     *
     * The arithmetic UNDERSTATES it by about 13% and the first cut of this row
     * was written against the arithmetic. At `interval: 0.3` the live count
     * measured 119 — over the 90-107 `docs/research-weapons.md` §D.7 budgeted —
     * so the interval went back to CROSS-STRUNG's original 0.34 and `damage`
     * was re-derived to hold nominal at 588. `tools/_shapecount.mjs` runs the
     * real `World.update` with this instrument alone at max and the whole rig
     * at max, which is the number to trust; do not re-tune this row off the
     * paragraph above without re-running it.
     *
     * `MAX_PLAYER_BULLETS` moved 400 -> 700 in the same change, and that was
     * not precautionary: `deadhunt-ranges` recorded the 400 cap saturating in a
     * full-loadout run before this change and 473 live bullets with 0 overflow
     * after it.
     */
    shape: 'spray',
    fused: true,
    weight: 0,
    blurb: 'A full circle of strings, swept continuously, ringing off every wall.',
    character: 'shimmering — a full 360-degree cascade',
    base: stats({ interval: 0.34, count: 14, damage: 14.28, arc: 6.28, speed: 820, bounces: 3, range: 900 }),
    steps: [],
  },
  {
    id: 'chorale',
    label: 'CHORALE',
    /*
     * THE SHAPE CHANGED HERE, AND THE BLURB IS THE EVIDENCE.
     *
     * This was `orbit` — the same shape as DRONE PODS — so the evolution was a
     * rename and a stat bump, which is the defect the file header at the top of
     * this file promises does not exist ("a different verb, not a bigger
     * number"). Measured, 13 of the 15 recipes in `FUSIONS` produced a result
     * with their base's shape; this is one of the two that moved.
     *
     * FOUR INDEPENDENT THINGS SAY `beam`, and none of them is taste:
     *
     *   1. **The blurb already said so.** "…sustaining BEAMS between them." It
     *      has said so since the row was written. Nothing but the `shape` field
     *      disagreed.
     *   2. **The catalyst's stat was dead.** FERMATA is this recipe's catalyst
     *      and FERMATA moves `linger`; `firePods` does not read `linger`.
     *      `tools/deadhunt-ranges.mjs` printed exactly that — `DEAD
     *      chorale.linger=1 (set, static)` under `orbit`. `fireBeam` reads
     *      `linger` as the beam's life, so the catalyst now buys something.
     *   3. **The one per-shape floor in the whole simulation that BITES was
     *      this row.** Same tool: `firePods Math.max(200, s.speed) … BITES for
     *      chorale`, because CHORALE declared `speed: 0` and pods have to fire
     *      a bullet at *some* speed. `world.ts`'s own comment on that floor
     *      says the quiet part: "the `orbit` shape has no input that could
     *      express 'the satellites stop moving', and CHORALE's stated identity
     *      cannot currently be built out of the stats it has." A held beam has
     *      no travel speed, so the contradiction dissolves rather than being
     *      papered over with a hand-picked bullet speed.
     *   4. **`character` is "a sustained four-part choir with no attack."** A
     *      held beam is the only shape in the table with no attack transient.
     *
     * WHAT IT COSTS, said plainly: DRONE PODS' pods each eat one bullet, and
     * that defence is a property of the `orbit` shape, not of the stat block.
     * Evolving now gives it up. That is deliberate — Ball x Pit's Black Hole
     * one-shots and then destroys itself, and an evolution that only adds is
     * the thing this change exists to stop — but it does mean `orbit` has no
     * authored ending any more. It is not gone from built runs: DRONE PODS
     * itself is draftable all run, and any duet with drones as parent A is
     * still an orbit. Giving some OTHER evolution the `orbit` shape to fill the
     * hole was considered and rejected; see the note above `FUSIONS`.
     *
     * TUNED TO BE POWER-NEUTRAL ON BOTH METRICS, so the shape change can be
     * measured on its own. Nominal `damage x count / interval` is 360, exactly
     * what the `orbit` block produced. And because a beam's `dps` is
     * `damage / life` while `life / interval` generations overlap, a target
     * standing in one spoke takes `damage / interval` = 60/s — which is also
     * what six pods firing 12-damage bullets outward every 0.2s delivered to a
     * single target, since only about one pod in six was ever pointing at it.
     * `area` came down 120 -> 18 because on `orbit` it was the ORBIT radius and
     * on `beam` it is the beam's half-width; 120 would have been a 240px-thick
     * beam. `pierce: 99` is gone: `fireBeam` ignores `pierce` (it damages
     * everything along its length anyway), and BOW and HARMONICS already carry
     * that dead stat — a third copy is not worth the tidiness.
     *
     * FERMATA still does something, and it is coverage rather than power: a
     * longer life means more overlapping generations at more aim angles, while
     * `damage / interval` is unchanged. That is the same power-neutral shape as
     * the `pushField` count repair in `world.ts`, and for the same reason.
     */
    shape: 'beam',
    fused: true,
    weight: 0,
    blurb: 'The pods stop circling and hold station, sustaining beams between them.',
    character: 'mournful — a sustained four-part choir with no attack',
    base: stats({ interval: 0.5, count: 6, damage: 30, area: 18, linger: 0.9, range: 700 }),
    steps: [],
  },
  {
    id: 'cathedral',
    label: 'CATHEDRAL',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: 'The ring reaches the walls every bar and leaves the room ringing.',
    character: 'heavy — enormous, ceremonial, drenched in room',
    base: stats({ interval: 0.95, count: 3, damage: 26, area: 420, linger: 1.4 }),
    steps: [],
  },
  {
    id: 'downbeat',
    label: 'DOWNBEAT',
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: 'The well collapses on the beat and everything inside it goes with it.',
    character: 'heavy — a sub collapse landing exactly on the one',
    base: stats({ interval: 2.4, count: 2, damage: 90, area: 260, linger: 3.2 }),
    steps: [],
  },
  {
    id: 'wallofsound',
    label: 'WALL OF SOUND',
    /*
     * FEEDBACK's ending, and it moves with it. Two of the seven auras leave in
     * one recipe, which is why this pair was picked over any other.
     *
     * POWER-NEUTRAL EXACTLY. `damage x count / interval` was 16 x 1 / 0.1 =
     * 160; it is 4 x 16 / 0.4 = 160. `area: 190` and `linger: 0.8` are deleted
     * for the reason given at FEEDBACK — `cone` reads neither, and a stat left
     * set on a shape that cannot read it is this repository's signature defect.
     *
     * THE BLURB IS REWRITTEN AND THIS IS A RETREAT, SAID PLAINLY. "The field
     * grows with your speed" is on the `FUSIONS` preamble's list of prose the
     * simulation does not deliver, and `docs/research-weapons.md` §D.4 argues
     * that a cone "finally has an axis to grow along". It does — and it is not
     * implemented here. No `InstrumentStats` field expresses player speed and
     * no routine reads it, so scaling the cone by how fast the ship is moving
     * would be a hidden multiplier with no dial and no dead-stat audit row,
     * which is worse than an unkept promise. The text now says what the
     * simulation does. Whoever implements the speed term should put the
     * sentence back.
     *
     * BUDGET. `count` 16 plus SPREAD's 3 is 19 pellets, alive for
     * `range / speed x 1.05` = 0.24s, against a floor interval of 0.4 x RAPID's
     * 0.62 = 0.248s — so under one generation. `tools/_shapecount.mjs` runs
     * this instrument alone at max with the whole rig at max and measures
     * exactly 19, against the 16 `docs/research-weapons.md` §D.4 budgeted.
     * FEEDBACK's ceiling lands a frame the other side of the same line and
     * measures 30; see `fireCone` for why.
     */
    shape: 'cone',
    fused: true,
    weight: 0,
    blurb: 'A wall of blast out of the front. Nothing survives being driven into.',
    character: 'aggressive — total, saturated, everything at once',
    base: stats({ interval: 0.4, count: 16, damage: 4, arc: 1.7, speed: 1000, range: 230 }),
    steps: [],
  },
  {
    id: 'canon',
    label: 'CANON',
    shape: 'seek',
    fused: true,
    weight: 0,
    blurb: 'Every bounce spawns a delayed copy of the bolt that made it.',
    character: 'eerie — the same line entering late against itself',
    base: stats({ interval: 0.42, count: 4, damage: 13, speed: 700, bounces: 8, pierce: 2, range: 2600 }),
    steps: [],
  },
  {
    id: 'tutti',
    label: 'TUTTI',
    /*
     * THE EIGHTH RE-POINT, AND THE THIRD BLURB IN THIS CHANGE THE SIMULATION
     * HAS NEVER DELIVERED.
     *
     * "Everything is pulled to the centre first, and then struck" is a
     * telegraph that pulls followed by a landing. As an `aura` it was neither:
     * `fireAura` expands a ring from the SHIP outward and pulls nothing —
     * `Effect.pull` has no reader and `wells.pull` is reachable only through
     * two hardcoded ids, which is exactly what the preamble's undelivered-prose
     * heading records. `mortar` delivers both halves: `World.updateShells`
     * drags what is under the landing point for the whole telegraph and then
     * detonates there.
     *
     * It also stops being the fourth of five instruments describing itself as a
     * very large ring. `weapons.ts` already refused a fourth aura on that
     * ground; this takes `aura` from five members to four and hands the freed
     * identity to the only shape in the game that hits past a crowd.
     *
     * TIMPANI ITSELF STAYS `aura`. The recipe is `timpani + magnet -> tutti`,
     * so this is a fusion changing the verb, which is what a fusion is for.
     *
     * `area: 320 -> 180` IS A NERF AND IT IS THE HONEST DIRECTION. An aura's
     * 320 is the radius a THIN ANNULUS sweeps out to — `updateNova` damages
     * only within ±16px of the moving edge, so an enemy standing anywhere in
     * that circle takes the ring's dps for the ~0.07s the edge is on top of it,
     * about 6 of the 120 on the card. A mortar's radius is a FLAT DISC and
     * everything inside it takes the full 120. Keeping 320 would have turned "a
     * very large ring that mostly misses" into "120 damage to a third of the
     * arena, twice every 1.9s", which is not a re-point, it is a new weapon
     * wearing the old one's name. 180 is still the largest single blast in the
     * table, and REQUIEM at 520 keeps the "fills the arena" line to itself.
     *
     * `range: 700` IS NEW because a lobbed shell needs a reach and an aura had
     * no use for one; `fireAura` ignored `range` entirely, which is why REQUIEM
     * still prints a DEAD row for its own 900. 700 is long enough that the back
     * rank of a formation is inside it, which is the verb.
     *
     * `linger: 0.6` KEEPS ITS NUMBER AND CHANGES ITS JOB, from the ring's hang
     * at full radius to the telegraph delay. 0.6s is long enough to read and to
     * walk out of at any enemy speed in the table, and short enough that the
     * shell is not a warning the player has already forgotten.
     *
     * POWER, on the nominal `damage x count / interval` the other re-points
     * were argued on: 120 x 2 / 1.9 = 126 before and after — untouched, because
     * none of the three stats in it moved. What moved is delivery, and it moved
     * UP: see the annulus arithmetic above. `arena` and `builds` are where that
     * is read, not this paragraph.
     */
    shape: 'mortar',
    fused: true,
    weight: 0,
    blurb: 'Everything is pulled to the centre first, and then struck.',
    character: 'heavy — the whole orchestra on a single hit',
    base: stats({ interval: 1.9, count: 2, damage: 120, area: 180, linger: 0.6, range: 700 }),
    steps: [],
  },
  {
    id: 'vibrato',
    label: 'VIBRATO',
    /*
     * THE SECOND SHAPE RE-POINT. `field` -> `strike`, and the tell was a stat
     * the simulation never read.
     *
     * TREMOLO FIELD drops pools where you have been and they stay there.
     * VIBRATO's whole blurb is "the pools go hunting" — and it was `field`, so
     * the pools went on staying exactly where they were put. The row tried to
     * say otherwise: it declared `speed: 190`, and `tools/deadhunt-ranges.mjs`
     * printed `DEAD vibrato.speed=190 (set, static)`, because `fireField`
     * ignores `speed`. A stat set to express the evolution's entire identity,
     * read by nothing, is this repository's signature defect.
     *
     * `strike` is what "hunting" actually means here. `fireStrike` lands
     * `count` hits per activation ON randomly chosen live enemies within
     * `range`, each burning a circle of `area` around where it landed. That is
     * a pool that appears where the enemies are instead of where you were —
     * the same damage shape, relocated, which is the smallest change that makes
     * the sentence true.
     *
     * `speed` is DELETED rather than moved, and this is the honest part:
     * `fireStrike` ignores `speed` too. No shape in the table is "a pool that
     * travels". The hunting is expressed by the targeting, not by a velocity,
     * so the number goes rather than being carried to a second shape that also
     * cannot read it. `linger: 5.5` goes for the same reason — a strike is
     * instantaneous, and leaving it set would trade one dead stat for another.
     * `range: 620` is new because a strike needs a reach and `fireField` had no
     * use for one; 620 is short of CARILLON's 900 on purpose.
     *
     * NOMINAL POWER IS UNCHANGED at 96 (`damage x count / interval`) so the
     * shape change is what gets measured. REAL delivery is not unchanged and
     * saying so matters: on `field`, `pushField` splits one activation's damage
     * across its pools and spreads it over `linger`, so a maxed TREMOLO put
     * about 0.37 dps into each of a handful of wells. Nominal dps flatters
     * `field` badly. This is therefore a genuine buff in play, not only a
     * re-point, and `builds` / `combine` are the numbers that decide whether it
     * is too much — not the nominal column.
     *
     * IT DOES NOT BLUR CHIME. `strike` now has two members and so do `seek`
     * (three), `arc` (three) and `beam`; sharing a routine is not sharing a
     * role. CARILLON is five tight 30-damage bells in a 60px circle out to
     * 900px; this is four wide 12-damage washes in a 96px circle out to 620.
     * Strong-and-narrow against weak-and-wide is the same axis SPICCATO and
     * SNAP already split on.
     *
     * WHAT DID NOT WORK, AND NOW DOES. This entry used to read: "HOMING is this
     * recipe's catalyst and `Modifiers.homing` steers PLAYER BULLETS
     * (`world.ts`, `steerPlayerBullets`). A field spawns none and a strike
     * spawns none, so the catalyst was inert before this change and is inert
     * after it." That was true and it is the reason HOMING was re-pointed:
     * `Rules.killEcho` fires on a KILL rather than on a bullet spawn, and a
     * strike kills plenty. The catalyst of this recipe finally does something
     * for the line it gates.
     */
    /*
     * AND NOW `strike` -> `spawn`, WHICH IS THE SAME ROW MOVING TWICE. Stated
     * up front because `docs/research-weapons.md` §D.9 asks for exactly that:
     * "this re-points a row that was itself re-pointed one change ago, so it
     * should be argued on `deadhunt-ranges` output the way that change was, not
     * on taste."
     *
     * The argument above still holds in full and is left standing: `field` had
     * no way to express "hunting" and `strike` was the closest of the seven
     * shapes that existed. What it delivered was "the pool appears where the
     * enemies are" — relocation, instantly, and then gone. What it could not
     * deliver is the verb in the sentence: nothing persisted, so nothing hunted.
     * A strike is an event; a hunt needs a thing that is still there next
     * second.
     *
     * `spawn` is that thing, and the catalyst finally reads twice over: HOMING
     * gates this recipe, `Rules.killEcho` already made it live at the kill, and
     * now the result itself is four bodies that steer.
     *
     * WHAT MOVES IN THE STAT BLOCK, ALL THREE OF IT:
     *
     *   `speed: 300` COMES BACK. It was deleted in the last re-point with the
     *   note "no shape in the table is a pool that travels", which was true
     *   then and is the exact gap this shape fills. Not the original 190: that
     *   number was never balanced against anything, because nothing ever read
     *   it, and 190px/s is under the standoff speed of half the roster — an
     *   ally that cannot close is a decoration. 300 closes on everything but a
     *   diving shape.
     *
     *   `linger: 4` IS THE ALLY'S LIFETIME. Also deleted last time, for the
     *   honest reason that a strike is instantaneous. Four seconds is long
     *   enough to cross the arena twice and short enough that the retinue turns
     *   over inside a wave rather than accumulating.
     *
     *   `area: 96` IS DELETED. `spawn` does not read it and neither did
     *   `strike`'s replacement candidates — a summon is a body, not a field.
     *   Left set it would have printed `DEAD vibrato.area=96 (set, static)`,
     *   which is the same report that moved this row off `field` in the first
     *   place, so leaving it would have been a joke at this file's expense.
     *
     * `count: 4` CHANGES MEANING AND NOT VALUE, from strikes per activation to
     * the size of the standing retinue. `interval: 0.5` changes from "how often
     * it strikes" to "how quickly a spent ally is replaced". `range: 620` is
     * unchanged and still a reach — how far out an ally is dispatched.
     *
     * POWER. Nominal `damage x count / interval` is 96 before and after, and
     * for once the nominal is close to honest: an ally is consumed by the body
     * it reaches, so at most `count` of them can be spent and replaced per
     * interval, which is the same throughput a strike had. It is worse in
     * practice against anything far away — an ally has to fly there and a
     * strike teleports — and better against a pack, because the ally that
     * survives keeps hunting. `arena` and `builds` decide, not this paragraph.
     */
    shape: 'spawn',
    fused: true,
    weight: 0,
    blurb: 'The pools go hunting.',
    character: 'eerie — pitch wobbling as it hunts',
    base: stats({ interval: 0.5, count: 4, damage: 12, speed: 300, linger: 4, range: 620 }),
    steps: [],
  },
  {
    id: 'requiem',
    label: 'REQUIEM',
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: 'The choir and the room become one thing, and it fills the arena.',
    character: 'mournful — vast and funereal; the ceiling of a run',
    base: stats({ interval: 0.5, count: 6, damage: 44, area: 520, pierce: 99, linger: 2.4, range: 900 }),
    steps: [],
  },
  {
    id: 'stringsection',
    label: 'STRING SECTION',
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: 'Massed beams sweeping the circle, all of them held.',
    character: 'shimmering — massed strings, soaring',
    base: stats({ interval: 0.3, count: 24, damage: 24, area: 16, arc: 6.28, speed: 1100, pierce: 6, linger: 1.2, range: 900 }),
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
    label: 'FERMATA',
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

export const FUSIONS: readonly FusionDef[] = [
  { kind: 'evolution', base: 'pizzicato', catalyst: 'capo', result: 'spiccato', line: 'the bow starts to bounce' },
  { kind: 'evolution', base: 'pizzicato', catalyst: 'compressor', result: 'snap', line: 'the string is pulled clear and let go' },
  { kind: 'evolution', base: 'snare', catalyst: 'rapid', result: 'blastbeat', line: 'the roll never lands' },
  { kind: 'evolution', base: 'bow', catalyst: 'laser', result: 'harmonics', line: 'the fundamental splits' },
  { kind: 'evolution', base: 'chime', catalyst: 'resonance', result: 'carillon', line: 'one bell becomes a tower of them' },
  { kind: 'evolution', base: 'harp', catalyst: 'spread', result: 'crossstrung', line: 'the frame is strung both ways' },
  { kind: 'evolution', base: 'drones', catalyst: 'fermata', result: 'chorale', line: 'the satellites stop moving and start singing' },
  { kind: 'evolution', base: 'nova', catalyst: 'reverb', result: 'cathedral', line: 'the room grows around the pulse' },
  { kind: 'evolution', base: 'blackhole', catalyst: 'compressor', result: 'downbeat', line: 'the collapse lands on the one' },
  { kind: 'evolution', base: 'feedback', catalyst: 'tempo', result: 'wallofsound', line: 'the hum outruns you' },
  { kind: 'evolution', base: 'echoes', catalyst: 'timewarp', result: 'canon', line: 'the echo answers itself' },
  { kind: 'evolution', base: 'timpani', catalyst: 'magnet', result: 'tutti', line: 'everything is drawn in before the strike' },
  { kind: 'evolution', base: 'tremolo', catalyst: 'homing', result: 'vibrato', line: 'the pools start hunting' },

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
