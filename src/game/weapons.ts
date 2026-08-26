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
 * The remaining six — `trail`, `chain`, `mortar`, `boomerang`, `tether`,
 * `spawn` — are specified in the same document and are NOT implemented. Do not
 * infer from the three below that the other six are cheap; two of them
 * (`boomerang`, `tether`) have no instrument free to own them, which is the
 * whole content of that document's §F.2.
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
  | 'field';

export interface LevelStep {
  /** What the player will notice. If this is only a number, redesign the step. */
  note: string;
  add?: Partial<InstrumentStats>;
  mul?: Partial<InstrumentStats>;
}

export interface InstrumentDef {
  id: InstrumentId | EvolvedId;
  label: string;
  shape: InstrumentShape;
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
  /** Additive pierce. */
  pierce: number;
  /** 0..1 seek strength applied to projectiles that do not already home. */
  homing: number;
  /** Multiplier on enemy time. Below 1 is slower. */
  enemyTime: number;
  /** Multiplier on XP gained from shards. */
  xpGain: number;
}

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
    pierce: 0,
    homing: 0,
    enemyTime: 1,
    xpGain: 1,
  };
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
   */
  levels: readonly Partial<Modifiers>[];
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
    label: 'PIZZICATO',
    shape: 'seek',
    blurb: 'Dry bolts at the nearest thing moving.',
    character: 'aggressive — short, dry, off the string',
    weight: 1.0,
    // Level 1 deliberately reproduces the ship's current gun, so the arena
    // conversion starts a player exactly where the vertical game left them.
    base: stats({ interval: 0.22, count: 2, damage: 4, speed: 1150, range: 620 }),
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
    steps: [
      {
        note: 'two more bolts, thrown further and faster — and each one carries through the first thing it hits',
        add: { count: 2, pierce: 1 },
        mul: { speed: 1.18, range: 1.25 },
      },
      {
        note: 'six bolts now, fired half again as often, each hitting harder and punching through two',
        add: { count: 2, pierce: 1 },
        mul: { interval: 0.68, damage: 1.4 },
      },
    ],
  },
  {
    id: 'snare',
    label: 'SNARE ROLL',
    shape: 'arc',
    blurb: 'A sweep through the arc you are facing.',
    character: 'mechanical — tight, martial, rudimental',
    weight: 0.95,
    base: stats({ interval: 1.05, count: 1, damage: 11, area: 96, arc: 1.5, range: 96 }),
    steps: [
      {
        note: 'the roll answers behind you as well, and both sweeps open wider and reach further out',
        add: { count: 1 },
        mul: { arc: 1.3, area: 1.3, range: 1.3 },
      },
      {
        note: 'a third sweep off to the side, rolling twice as fast — a near-full circle that knocks back what it touches',
        add: { count: 1 },
        mul: { arc: 1.5, interval: 0.66, damage: 1.8 },
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
    label: 'CHIME',
    shape: 'strike',
    blurb: 'Strikes something at random from above. You do not aim it.',
    character: 'shimmering — a single struck bell, long decay',
    weight: 0.9,
    /*
     * TWO BELLS AT LEVEL 1, AND THE REASON IS A CHANGE IN `world.ts`.
     *
     * `fireSeek` used to fan its bolts as `t = i/(n - 1) - 0.5`, which for any
     * EVEN count never takes the value 0 — so the starting weapon's two bolts
     * flew either side of the aim and nothing was ever fired along it. It now
     * CONVERGES the bolts on the n nearest targets, which turned `count` on a
     * seek weapon from "a wider spray" into "one more enemy hit per volley".
     *
     * Two of the three openers are `seek` and both got that for free. CHIME is
     * `strike` and got nothing, and `tools/openers.mjs` caught it: the weakest
     * opener fell to **68% of the strongest against a 70% floor**, with CHIME
     * named as the trap. The floor was NOT relaxed — it is correct, and it is
     * the gate doing its job.
     *
     * The fix is the same property, given to the shape that lacked it. A strike
     * is already multi-target by `count`; CHIME simply opened with `count: 1`,
     * so it was the one opener with no count for the change to be worth
     * anything to. Two bells restores the share to **77%**, which is exactly
     * what `openers` measured before the convergence change landed — the
     * roster catching up, not overtaking. Swept against the gate's own
     * measurement: `count 2` -> 77%, `interval 1.4 -> 1.0` -> 74%,
     * `damage 16 -> 24` -> 74%, `area 34 -> 56` -> 68% (no effect at all), and
     * `count 2 + interval 1.15` -> 81%, which overshoots the historical figure
     * and was therefore not taken.
     *
     * WATCH ECHO CHAMBER, NOT CHIME, NEXT TIME. With this in, CHIME reaches 84%
     * and **ECHOES becomes the binding opener at ~78%**. The gate only ever
     * names the worst one, so the next regression in this area will be reported
     * against a different instrument than the one that moved.
     *
     * The ladder is renumbered rather than re-costed: every `add` below is
     * unchanged, so the ceiling moves 5 strikes -> 6 and the early game moves
     * 1 -> 2. That is deliberate — `openers` measures the first four minutes,
     * which is where the trap was.
     */
    base: stats({ interval: 1.4, count: 2, damage: 16, area: 34, range: 460 }),
    /*
     * THE RENUMBERING NOTE ABOVE STILL HOLDS, at a different length. Every
     * `add` in the old seven-rung ladder is still here — the count total is
     * unchanged at +4, so the ceiling is still six bells and the opener is
     * still two. `tools/openers.mjs` measures the first four minutes, and the
     * first four minutes are now the whole ladder, so watch it after any edit
     * to these two rows.
     */
    steps: [
      {
        note: 'four bells instead of two, landing wider and reaching the far side of the arena',
        add: { count: 2 },
        mul: { area: 1.35, range: 1.8 },
      },
      {
        note: 'six bells, rung faster and struck half again as hard — the room never stops ringing',
        add: { count: 2 },
        mul: { area: 1.25, interval: 0.7, damage: 1.5 },
      },
    ],
  },
  {
    id: 'harp',
    label: 'HARP GLISS',
    shape: 'arc',
    blurb: 'A fan of bolts sweeping across your facing.',
    character: 'shimmering — a cascading harp run',
    weight: 0.9,
    base: stats({ interval: 0.9, count: 5, damage: 5, arc: 1.1, speed: 780, range: 540 }),
    steps: [
      {
        note: 'three more strings in the fan, and it opens a third wider',
        add: { count: 3 },
        mul: { arc: 1.35 },
      },
      {
        note: 'ten strings sweeping past a half-circle, coming round faster, and the low ones carry through an enemy',
        add: { count: 2, pierce: 1 },
        mul: { arc: 1.6, interval: 0.72, damage: 1.45 },
      },
    ],
  },
  {
    id: 'drones',
    label: 'DRONE PODS',
    shape: 'orbit',
    blurb: 'Pods that circle you, shoot, and each eat one bullet.',
    character: 'eerie — the arp split into hard-panned satellites',
    weight: 0.95,
    base: stats({ interval: 0.34, count: 2, damage: 3, area: 46, speed: 1050, range: 560 }),
    steps: [
      {
        note: 'four pods on a wider ring, each coming back from an absorb twice as quickly',
        add: { count: 2 },
        mul: { area: 1.22, linger: 0.5 },
      },
      {
        note: 'six pods, firing outward as well as forward, faster and far harder',
        add: { count: 2 },
        mul: { interval: 0.7, damage: 1.725 },
      },
    ],
  },
  {
    id: 'nova',
    label: 'NOVA',
    shape: 'aura',
    blurb: 'A ring on the beat that clears bullets and hurts what it touches.',
    character: 'heavy — a wide room clap on the pulse',
    weight: 0.8,
    // Pulses on the beat, so `interval` is a floor the world rounds up to the
    // next beat. A ring that ignores the grid would be the one thing on the
    // field not locked to the transport.
    base: stats({ interval: 1.85, count: 1, damage: 9, area: 130, linger: 0.35 }),
    steps: [
      {
        note: 'a second ring chases the first, both reach further, and they pulse every other beat instead of every bar',
        add: { count: 1 },
        mul: { area: 1.3, interval: 0.6 },
      },
      {
        note: 'a third ring, covering most of the arena, hanging in the air before it fades',
        add: { count: 1 },
        mul: { area: 1.5, damage: 1.5, linger: 1.8 },
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
    label: 'FEEDBACK',
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
    shape: 'cone',
    blurb: 'A blast of feedback out of the front of the hull. Murderous up close, nothing at range.',
    character: 'aggressive — saturated amp hum, no attack at all',
    weight: 0.85,
    base: stats({ interval: 0.6, count: 5, damage: 1.4, arc: 0.8, speed: 880, range: 190 }),
    steps: [
      {
        note: 'four more pellets in the burst, thrown a fifth wider and a little further, and it comes round sooner',
        add: { count: 4 },
        mul: { arc: 1.15, range: 1.15, interval: 0.8 },
      },
      {
        note: 'twelve pellets now, leaving a fifth faster and biting two fifths harder, in a blast wide enough to catch a whole rush',
        add: { count: 3 },
        mul: { interval: 0.8, damage: 1.4, arc: 1.35, speed: 1.2, range: 1.15 },
      },
    ],
  },
  {
    id: 'echoes',
    label: 'ECHO CHAMBER',
    shape: 'seek',
    blurb: 'Bolts that come back off the walls.',
    character: 'eerie — the same hit returning late and quieter',
    weight: 0.85,
    base: stats({ interval: 0.75, count: 2, damage: 6, speed: 620, bounces: 2, range: 1400 }),
    steps: [
      {
        note: 'a third bolt, and every bolt takes three more bounces before it fades',
        add: { bounces: 3, count: 1 },
        mul: { range: 1.4 },
      },
      {
        note: 'seven bounces each, off enemies as well as walls, fired faster and hitting harder every time they return',
        add: { bounces: 2, pierce: 1 },
        mul: { interval: 0.7, damage: 1.5 },
      },
    ],
  },
  {
    id: 'timpani',
    label: 'TIMPANI',
    shape: 'aura',
    blurb: 'A slow, enormous shockwave. You will feel it land.',
    character: 'heavy — orchestral, felt in the chest',
    weight: 0.7,
    base: stats({ interval: 3.2, count: 1, damage: 34, area: 170, linger: 0.25 }),
    steps: [
      {
        note: 'the wave carries much further, is struck more often, and staggers whatever survives it',
        mul: { area: 1.69, interval: 0.75, linger: 1.8 },
      },
      {
        note: 'a second, delayed wave — and the strike shakes the whole arena at well over twice the weight',
        add: { count: 1 },
        mul: { area: 1.2, damage: 2.4 },
      },
    ],
  },
  {
    id: 'tremolo',
    label: 'TREMOLO FIELD',
    shape: 'field',
    blurb: 'Pools left in your wake that keep working after you have gone.',
    character: 'shimmering — unsettled, wobbling, never quite still',
    weight: 0.85,
    base: stats({ interval: 1.1, count: 1, damage: 4, area: 62, linger: 2.6 }),
    steps: [
      {
        note: 'a second pool per drop, spread wider and still burning long after you have gone',
        add: { count: 1 },
        mul: { area: 1.3, linger: 1.7 },
      },
      {
        note: 'a third pool, dropped more often, burning harder and creeping outward as it burns',
        add: { count: 1 },
        mul: { area: 1.35, interval: 0.7, linger: 1.3, damage: 1.6 },
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
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: 'Every strike chains to two more. The ringing does not stop.',
    character: 'shimmering — bells chaining into each other',
    base: stats({ interval: 0.5, count: 5, damage: 30, area: 60, pierce: 3, range: 900 }),
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
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: 'Everything is pulled to the centre first, and then struck.',
    character: 'heavy — the whole orchestra on a single hit',
    base: stats({ interval: 1.9, count: 2, damage: 120, area: 320, linger: 0.6 }),
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
     * WHAT STILL DOES NOT WORK, recorded so it is not re-derived: HOMING is
     * this recipe's catalyst and `Modifiers.homing` steers PLAYER BULLETS
     * (`world.ts`, `steerPlayerBullets`). A field spawns none and a strike
     * spawns none, so the catalyst was inert before this change and is inert
     * after it. Making HOMING mean something for this line needs `world.ts`.
     */
    shape: 'strike',
    fused: true,
    weight: 0,
    blurb: 'The pools go hunting.',
    character: 'eerie — pitch wobbling as it hunts',
    base: stats({ interval: 0.5, count: 4, damage: 12, area: 96, range: 620 }),
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
  {
    id: 'laser',
    label: 'LASER',
    legacy: true,
    weight: 1.0,
    blurb: 'Everything hits harder, and eventually goes through.',
    character: 'aggressive — the lead holds instead of stabbing',
    levels: [
      { damage: 1.24 },
      { damage: 1.5, pierce: 1 },
      { damage: 1.7, pierce: 2 },
    ],
    notes: [
      'everything in the band hits a quarter harder',
      'half again as hard — and every shot now goes through the first enemy it meets',
      'seventy per cent harder, and shots carry through two',
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
    blurb: 'Bolts that would have missed do not.',
    character: 'mechanical — the arpeggio grows a long delay tail',
    levels: [{ homing: 0.36 }, { homing: 0.64 }, { homing: 0.8 }],
    notes: [
      'bolts that would have drifted past bend back toward what you aimed at',
      'they hunt — a target has to break hard to shake one off',
      'they do not miss',
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
    blurb: 'The room runs slow. You do not.',
    character: 'eerie — half-time, at exactly the same tempo',
    levels: [{ enemyTime: 0.89 }, { enemyTime: 0.79 }, { enemyTime: 0.72 }],
    notes: [
      'the room runs a tenth slow; you do not',
      'a fifth slow — gaps you could not have made start to open',
      'everything but you moves at under three quarters speed',
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
    blurb: 'More to lose before you lose it.',
    character: 'heavy — glued, dense, nothing peaks',
    levels: [{ maxHp: 1, damage: 1.05 }, { maxHp: 2, damage: 1.1 }, { maxHp: 3, damage: 1.15 }],
    notes: [
      'one more shield, and the band glues together a little louder',
      'two shields — one mistake stops being the end of the run',
      'three shields, and everything plays fifteen per cent hotter',
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
    blurb: 'Things that linger, linger.',
    character: 'mournful — held past its length',
    levels: [{ linger: 1.3 }, { linger: 1.68 }, { linger: 1.95 }],
    notes: [
      'pools and held beams last a third longer than they are written',
      'two thirds longer — what you left behind is still working when you come back',
      'held to almost double; the field never quite clears',
    ],
  },
  {
    id: 'tempo',
    label: 'UP-TEMPO',
    weight: 0.9,
    blurb: 'You move faster. In an arena that is a weapon.',
    character: 'aggressive — pushed ahead of the beat',
    levels: [{ moveSpeed: 1.13 }, { moveSpeed: 1.25 }, { moveSpeed: 1.33 }],
    notes: [
      'you start arriving ahead of the beat',
      'a quarter faster — you can cross a ring before it closes',
      'a third faster, and in an arena that is a weapon',
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
 * NOT SHAPE BUGS, BUT PROSE THE SIMULATION DOES NOT DELIVER. Left alone here
 * because no existing shape implements them and inventing one is a `world.ts`
 * feature, not a data edit: TUTTI's "everything is pulled to the centre first"
 * (no shape has a pull except a swallowing field, and that list is hardcoded),
 * CANON's "every bounce spawns a delayed copy" (the pool reflects, it
 * does not spawn), CARILLON's "every strike chains to two more" (`fireStrike`
 * picks random targets; it does not chain), and STRING SECTION's "all of them
 * held" on an `arc`, which is why `deadhunt-ranges` reports its `linger: 1.2`
 * as dead. `docs/research-weapons.md` §D.3 and §D.5 specify `chain` and
 * `mortar`, which would deliver the first two; neither is implemented.
 *
 * TWO CAME OFF THIS LIST. ROSIN BOW's "it does not stop" is delivered by
 * `lance`, and WALL OF SOUND's "the field grows with your speed" is GONE
 * rather than delivered — the blurb was rewritten to describe what the cone
 * actually does, because no stat expresses player speed and a hidden
 * multiplier with no dial is worse than an unkept promise. Say which of those
 * two happened when quoting this paragraph.
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
 * Fold every owned rig item into a single modifier set.
 *
 * Multiplicative fields multiply and additive fields add, which is the only
 * arrangement that makes stacking two passives mean the same thing whichever
 * order they were picked up in. `enemyTime` and `cooldown` are floored, because
 * a stack that reaches zero stops the game rather than speeding it up.
 *
 * THE TWO FLOORS BELOW CANNOT BE REACHED, and the reason is that the stack they
 * guard against does not exist. Exactly one rig item touches `cooldown` (RAPID,
 * bottoming out at 0.62) and exactly one touches `enemyTime` (TIMEWARP, 0.72),
 * so with no second contributor there is nothing to multiply and the achievable
 * ranges are [0.62, 1] and [0.72, 1]. `tools/deadhunt-ranges.mjs` enumerates
 * every legal loadout — not a sample, the whole set — and prints both.
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
      // count, maxHp, pierce and homing add; everything else scales.
      if (k === 'count' || k === 'maxHp' || k === 'pierce') out[k] += v;
      else if (k === 'homing') out[k] = Math.max(out[k], v);
      else out[k] *= v;
    }
  }
  out.cooldown = Math.max(0.18, out.cooldown);
  out.enemyTime = Math.max(0.35, out.enemyTime);
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
    pierce: s.pierce + m.pierce,
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
