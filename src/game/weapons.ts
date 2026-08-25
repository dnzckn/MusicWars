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
 * instrument here is an aura, an orbit, an arc, a sweep or a lingering field.
 * A weapon that only fires "up" is a weapon that is useless half the time,
 * which is precisely why Vampire Survivors' roster looks the way it does.
 */

import type { AbilityId, AbilitySlot, EvolvedId, InstrumentId, RigId } from '../core/events';

/** Instruments cap at 8, as in Vampire Survivors. Seven decisions per instrument. */
export const INSTRUMENT_MAX_LEVEL = 8;
/** Rig caps at 5. Deliberately shorter: rig is the catalyst, not the payoff. */
export const RIG_MAX_LEVEL = 5;

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
 * collides it. These are the six arena archetypes; everything in the roster is
 * one of them, which keeps the world's dispatch honest.
 */
export type InstrumentShape =
  /** Bolts toward the nearest target inside range. */
  | 'seek'
  /** A sweep through an arc centred on the ship's facing. */
  | 'arc'
  /** A held beam along the facing. */
  | 'beam'
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
  /** Seven steps, taking level 1 to level 8. Fusions carry none. */
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
  /** Five entries, one per level. Each is the *cumulative* modifier at that level. */
  levels: readonly Partial<Modifiers>[];
  /** Per-level player-facing notes, five entries. */
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
    steps: [
      { note: 'a third bolt', add: { count: 1 } },
      { note: 'bolts travel further and faster', mul: { speed: 1.18, range: 1.25 } },
      { note: 'a fourth bolt', add: { count: 1 } },
      { note: 'fires half again as often', mul: { interval: 0.68 } },
      { note: 'bolts pass through one enemy', add: { pierce: 1 } },
      { note: 'a fifth and sixth bolt', add: { count: 2 } },
      { note: 'every bolt hits harder and passes through two', add: { pierce: 1 }, mul: { damage: 1.4 } },
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
      { note: 'the sweep answers behind you as well', add: { count: 1 } },
      { note: 'wider arc', mul: { arc: 1.3 } },
      { note: 'rolls twice as fast', mul: { interval: 0.66 } },
      { note: 'reaches further out', mul: { area: 1.3, range: 1.3 } },
      { note: 'a third sweep, off to the side', add: { count: 1 } },
      { note: 'hits harder', mul: { damage: 1.5 } },
      { note: 'a full sweep, and it knocks what it hits backwards', mul: { arc: 1.5, damage: 1.2 } },
    ],
  },
  {
    id: 'bow',
    label: 'ROSIN BOW',
    shape: 'beam',
    blurb: 'One held beam along your facing. It does not stop.',
    character: 'mournful — long bowed sostenuto',
    weight: 0.85,
    base: stats({ interval: 1.6, count: 1, damage: 7, area: 9, speed: 0, pierce: 99, linger: 0.5, range: 520 }),
    steps: [
      { note: 'the bow is held longer', mul: { linger: 1.6 } },
      { note: 'thicker stroke', mul: { area: 1.4 } },
      { note: 'reaches across the arena', mul: { range: 1.5 } },
      { note: 'drawn twice as often', mul: { interval: 0.62 } },
      { note: 'a second beam, opposite', add: { count: 1 } },
      { note: 'the stroke bites', mul: { damage: 1.6 } },
      { note: 'held almost continuously', mul: { linger: 1.7, interval: 0.75 } },
    ],
  },
  {
    id: 'chime',
    label: 'CHIME',
    shape: 'strike',
    blurb: 'Strikes something at random from above. You do not aim it.',
    character: 'shimmering — a single struck bell, long decay',
    weight: 0.9,
    base: stats({ interval: 1.4, count: 1, damage: 16, area: 34, range: 460 }),
    steps: [
      { note: 'a second strike', add: { count: 1 } },
      { note: 'strikes land wider', mul: { area: 1.35 } },
      { note: 'a third strike', add: { count: 1 } },
      { note: 'rings out faster', mul: { interval: 0.7 } },
      { note: 'each strike is heavier', mul: { damage: 1.5 } },
      { note: 'a fourth and fifth strike', add: { count: 2 } },
      { note: 'strikes reach the whole arena', mul: { range: 1.8, area: 1.25 } },
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
      { note: 'two more strings in the fan', add: { count: 2 } },
      { note: 'the fan opens wider', mul: { arc: 1.35 } },
      { note: 'the run comes round faster', mul: { interval: 0.72 } },
      { note: 'three more strings', add: { count: 3 } },
      { note: 'bolts carry through one enemy', add: { pierce: 1 } },
      { note: 'the low strings hit harder', mul: { damage: 1.45 } },
      { note: 'the fan opens past a half-circle and sweeps as it fires', mul: { arc: 1.6 } },
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
      { note: 'a third pod', add: { count: 1 } },
      { note: 'the ring widens', mul: { area: 1.22 } },
      { note: 'a fourth pod', add: { count: 1 } },
      { note: 'pods fire faster', mul: { interval: 0.7 } },
      { note: 'pods come back from an absorb twice as quickly', mul: { linger: 0.5, damage: 1.15 } },
      { note: 'a fifth and sixth pod', add: { count: 2 } },
      { note: 'pods fire outward as well as forward, and hit hard', mul: { damage: 1.5 } },
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
      { note: 'the ring reaches further', mul: { area: 1.3 } },
      { note: 'pulses every other beat instead of every bar', mul: { interval: 0.6 } },
      { note: 'a second ring chases the first', add: { count: 1 } },
      { note: 'the ring hits harder', mul: { damage: 1.5 } },
      { note: 'the ring hangs before it fades', mul: { linger: 1.8 } },
      { note: 'a third ring', add: { count: 1 } },
      { note: 'the ring covers most of the arena', mul: { area: 1.5 } },
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
      { note: 'the well pulls from further out', mul: { area: 1.28 } },
      { note: 'it holds open longer', mul: { linger: 1.4 } },
      { note: 'deployed more often', mul: { interval: 0.72 } },
      { note: 'the collapse is heavier', mul: { damage: 1.6 } },
      { note: 'a second well', add: { count: 1 } },
      { note: 'it swallows enemy fire as well as enemies', mul: { area: 1.2 } },
      { note: 'the collapse detonates outward when it closes', mul: { damage: 1.5, area: 1.2 } },
    ],
  },
  {
    id: 'feedback',
    label: 'FEEDBACK',
    shape: 'aura',
    blurb: 'A hum around the hull that burns whatever comes close.',
    character: 'aggressive — saturated amp hum, no attack at all',
    weight: 0.85,
    base: stats({ interval: 0.5, count: 1, damage: 5, area: 74 }),
    steps: [
      { note: 'the field reaches further', mul: { area: 1.28 } },
      { note: 'it burns continuously instead of ticking', mul: { interval: 0.55 } },
      { note: 'it bites harder', mul: { damage: 1.5 } },
      { note: 'further again', mul: { area: 1.25 } },
      { note: 'it slows what it is touching', mul: { damage: 1.2 } },
      { note: 'the hum doubles', mul: { damage: 1.5, interval: 0.8 } },
      { note: 'the field reaches half the arena and never stops', mul: { area: 1.4 } },
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
      { note: 'one more bounce', add: { bounces: 1 } },
      { note: 'a third bolt', add: { count: 1 } },
      { note: 'bolts live longer before they fade', mul: { range: 1.4 } },
      { note: 'fires faster', mul: { interval: 0.7 } },
      { note: 'two more bounces', add: { bounces: 2 } },
      { note: 'each bounce hits harder than the last', mul: { damage: 1.5 } },
      { note: 'bolts bounce off enemies too', add: { bounces: 2, pierce: 1 } },
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
      { note: 'the wave carries further', mul: { area: 1.3 } },
      { note: 'struck more often', mul: { interval: 0.75 } },
      { note: 'the hit is heavier', mul: { damage: 1.5 } },
      { note: 'a second, delayed wave', add: { count: 1 } },
      { note: 'the wave staggers what survives it', mul: { linger: 1.8 } },
      { note: 'further again', mul: { area: 1.3 } },
      { note: 'the strike shakes the whole arena', mul: { damage: 1.6, area: 1.2 } },
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
      { note: 'a second pool per drop', add: { count: 1 } },
      { note: 'pools spread wider', mul: { area: 1.3 } },
      { note: 'dropped more often', mul: { interval: 0.7 } },
      { note: 'pools last much longer', mul: { linger: 1.7 } },
      { note: 'pools burn harder', mul: { damage: 1.6 } },
      { note: 'a third pool', add: { count: 1 } },
      { note: 'pools creep outward as they burn', mul: { area: 1.35, linger: 1.3 } },
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
     * PIZZICATO at 8 with both CAPO and COMPRESSOR maxed and both cards are on
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
    shape: 'beam',
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
    shape: 'arc',
    fused: true,
    weight: 0,
    blurb: 'A full circle of strings, swept continuously.',
    character: 'shimmering — a full 360-degree cascade',
    base: stats({ interval: 0.34, count: 20, damage: 10, arc: 6.28, speed: 900, pierce: 2, range: 700 }),
    steps: [],
  },
  {
    id: 'chorale',
    label: 'CHORALE',
    shape: 'orbit',
    fused: true,
    weight: 0,
    blurb: 'The pods stop circling and hold station, sustaining beams between them.',
    character: 'mournful — a sustained four-part choir with no attack',
    /*
     * `speed: 0` is EXPLICIT, and it is the whole evolution.
     *
     * The line for this fusion is "the satellites stop moving and start
     * singing", and stopping is now something the data can say: `firePods`
     * spins the pods only while `speed > 0`. It was previously just absent
     * from this block, which is not the same thing — an unset stat landing on
     * `firePods`' `Math.max(200, s.speed)` floor is an omission that looks
     * like a decision, and `tools/deadhunt-ranges.mjs` reports that floor as
     * the only per-shape floor in six routines that actually bites.
     */
    base: stats({ interval: 0.2, count: 6, damage: 12, area: 120, speed: 0, pierce: 99, linger: 1, range: 700 }),
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
    shape: 'aura',
    fused: true,
    weight: 0,
    blurb: 'The field grows with your speed and scorches everything you pass.',
    character: 'aggressive — total, saturated, everything at once',
    base: stats({ interval: 0.1, count: 1, damage: 16, area: 190, linger: 0.8 }),
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
    shape: 'field',
    fused: true,
    weight: 0,
    blurb: 'The pools go hunting.',
    character: 'eerie — pitch wobbling as it hunts',
    base: stats({ interval: 0.5, count: 4, damage: 12, area: 96, linger: 5.5, speed: 190 }),
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
      { damage: 1.12 },
      { damage: 1.24 },
      { damage: 1.36 },
      { damage: 1.5, pierce: 1 },
      { damage: 1.7, pierce: 2 },
    ],
    notes: ['+12% damage', '+24% damage', '+36% damage', '+50% damage, everything pierces one', '+70% damage, pierces two'],
  },
  {
    id: 'spread',
    label: 'SPREAD',
    legacy: true,
    weight: 1.0,
    blurb: 'One more of everything that comes out in numbers.',
    character: 'shimmering — wider, more detuned supersaws',
    levels: [{ count: 1 }, { count: 1, area: 1.06 }, { count: 2, area: 1.06 }, { count: 2, area: 1.12 }, { count: 3, area: 1.2 }],
    notes: ['+1 projectile', '+1 projectile, slightly wider', '+2 projectiles', '+2 projectiles, wider', '+3 projectiles, much wider'],
  },
  {
    id: 'rapid',
    label: 'RAPID',
    legacy: true,
    weight: 1.0,
    blurb: 'Everything comes round sooner.',
    character: 'mechanical — hi-hats double in subdivision',
    levels: [{ cooldown: 0.92 }, { cooldown: 0.85 }, { cooldown: 0.78 }, { cooldown: 0.71 }, { cooldown: 0.62 }],
    notes: ['-8% cooldown', '-15% cooldown', '-22% cooldown', '-29% cooldown', '-38% cooldown'],
  },
  {
    id: 'homing',
    label: 'HOMING',
    legacy: true,
    weight: 0.9,
    blurb: 'Bolts that would have missed do not.',
    character: 'mechanical — the arpeggio grows a long delay tail',
    levels: [{ homing: 0.2 }, { homing: 0.36 }, { homing: 0.5 }, { homing: 0.64 }, { homing: 0.8 }],
    notes: ['bolts drift toward targets', 'they turn harder', 'they turn hard', 'they hunt', 'they do not miss'],
  },
  {
    id: 'magnet',
    label: 'MAGNET',
    legacy: true,
    weight: 0.95,
    blurb: 'Shards come to you.',
    character: 'shimmering — the bass filter inverts into a vacuum',
    levels: [
      { pickupRadius: 1.5 },
      { pickupRadius: 2.1 },
      { pickupRadius: 2.8 },
      { pickupRadius: 3.6 },
      { pickupRadius: 5.0, xpGain: 1.05 },
    ],
    notes: ['+50% pickup radius', '+110%', '+180%', '+260%', '+400%, and shards are worth a little more'],
  },
  {
    id: 'timewarp',
    label: 'TIMEWARP',
    legacy: true,
    weight: 0.7,
    blurb: 'The room runs slow. You do not.',
    character: 'eerie — half-time, at exactly the same tempo',
    levels: [{ enemyTime: 0.94 }, { enemyTime: 0.89 }, { enemyTime: 0.84 }, { enemyTime: 0.79 }, { enemyTime: 0.72 }],
    notes: ['enemies 6% slower', '11% slower', '16% slower', '21% slower', '28% slower'],
  },
  {
    id: 'reverb',
    label: 'REVERB',
    weight: 1.0,
    blurb: 'Everything with a radius gets a bigger one.',
    character: 'shimmering — tail and space',
    levels: [{ area: 1.1 }, { area: 1.2 }, { area: 1.32 }, { area: 1.45 }, { area: 1.62 }],
    notes: ['+10% area', '+20% area', '+32% area', '+45% area', '+62% area'],
  },
  {
    id: 'compressor',
    label: 'COMPRESSOR',
    weight: 0.9,
    blurb: 'More to lose before you lose it.',
    character: 'heavy — glued, dense, nothing peaks',
    levels: [{ maxHp: 1 }, { maxHp: 1, damage: 1.05 }, { maxHp: 2, damage: 1.05 }, { maxHp: 2, damage: 1.1 }, { maxHp: 3, damage: 1.15 }],
    notes: ['+1 shield', '+1 shield, +5% damage', '+2 shields', '+2 shields, +10% damage', '+3 shields, +15% damage'],
  },
  {
    id: 'capo',
    label: 'CAPO',
    weight: 0.9,
    blurb: 'Everything that travels, travels faster.',
    character: 'mechanical — brighter and tighter, everything up a step',
    levels: [{ speed: 1.12 }, { speed: 1.24 }, { speed: 1.36 }, { speed: 1.5 }, { speed: 1.7 }],
    notes: ['+12% projectile speed', '+24%', '+36%', '+50%', '+70%'],
  },
  {
    id: 'fermata',
    label: 'FERMATA',
    weight: 0.9,
    blurb: 'Things that linger, linger.',
    character: 'mournful — held past its length',
    levels: [{ linger: 1.15 }, { linger: 1.3 }, { linger: 1.48 }, { linger: 1.68 }, { linger: 1.95 }],
    notes: ['+15% duration', '+30%', '+48%', '+68%', '+95%'],
  },
  {
    id: 'tempo',
    label: 'UP-TEMPO',
    weight: 0.9,
    blurb: 'You move faster. In an arena that is a weapon.',
    character: 'aggressive — pushed ahead of the beat',
    levels: [{ moveSpeed: 1.07 }, { moveSpeed: 1.13 }, { moveSpeed: 1.19 }, { moveSpeed: 1.25 }, { moveSpeed: 1.33 }],
    notes: ['+7% move speed', '+13%', '+19%', '+25%', '+33%'],
  },
  {
    id: 'resonance',
    label: 'RESONANCE',
    weight: 0.85,
    blurb: 'Shards are worth more. Levels come sooner.',
    character: 'shimmering — rings on after the strike',
    levels: [{ xpGain: 1.1 }, { xpGain: 1.2 }, { xpGain: 1.32 }, { xpGain: 1.45 }, { xpGain: 1.6 }],
    notes: ['+10% XP', '+20% XP', '+32% XP', '+45% XP', '+60% XP'],
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
 */
export const DUET_INPUT_LEVEL = 6;

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
 * whole run: thirteen picks spent (a base at 8, a catalyst at 5) for something
 * standing at a third of its own ceiling.
 *
 * This number is load-bearing for the TOP of the tree, which is the part that
 * is easy to miss. `readyDuets` admits an instrument at
 * `min(DUET_INPUT_LEVEL, maxLevelOf(id))`, so an evolved instrument qualifies
 * at exactly this value — and two evolved instruments make a UNION. While
 * results seated at 1 that threshold was never met and there were zero unions
 * in every run ever measured; seated here, a committed player lands one in half
 * their runs.
 *
 * Three rather than the base eight because a fusion arrives already strong, and
 * because this is a starting position rather than something to be climbed.
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
