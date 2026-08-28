/**
 * The simulation.
 *
 * Owns everything that moves and, critically, produces the `GameSnapshot` the
 * music director reads. The threat analysis (how crowded the player is, how
 * soon something arrives) is computed in the same pass as player collision:
 * the loop is already touching every bullet, so measuring stress there is
 * nearly free, and it guarantees the music is reacting to exactly the same
 * numbers the collision system saw.
 */

import {
  EventBus,
  emptySnapshot,
  SILENCEABLE_STEMS,
  type AbilityId,
  type EnemyArchetype,
  type GameSnapshot,
  type InstrumentId,
  type MusicalState,
  type SilenceableStem,
} from '../core/events';
import { clamp, clamp01, damp, dist2, TAU } from '../core/math';
import { Rng } from '../core/rng';
import { BEATS_PER_BAR, Transport } from '../core/transport';
import { BulletFlag, BulletPool } from './bullets';
import { Camera } from './camera';
import { PLAYFIELD_H, PLAYFIELD_W, VIEW_H, VIEW_W } from './field';
import {
  ARCHETYPE_INFO,
  commitBossPhase,
  SPEED_CEILING,
  lungeChance,
  markBossPhasePending,
  spawnBoss,
  spawnEnemy,
  type Enemy,
  type EnemyContext,
} from './enemies';
import { ParticlePool, ParticleShape } from './particles';
import { angleDelta, PLAYER_CONTACT, Player } from './player';
import {
  pickPowerup,
  powerupDef,
  updateDrop,
  PICKUP_RADIUS,
  OVERDRIVE_MIN_GAP,
  type PowerupDrop,
} from './powerups';
import * as prog from './progression';
import {
  applyModifiers,
  beatLockOf,
  hasProps,
  instrumentDef,
  instrumentProps,
  instrumentStats,
  labelOf,
  noModifiers,
  noProps,
  noRules,
  PROP,
  PROPERTY_NAMES,
  type BeatLock,
  type InstrumentDef,
  type InstrumentStats,
  type Modifiers,
  type PropName,
  type Props,
  type Rules,
} from './weapons';
import {
  arenaSpawnPositions,
  edgePoint,
  BOSS_EVERY,
  formationWidth,
  planWave,
  type Formation,
  type SpawnRing,
  type WavePlan,
} from './waves';

/**
 * One instrument as `fireInstruments` folds it: the table row, the level it is
 * held at, and the stat block this step will fire it with.
 *
 * A NAMED TYPE AND NOT AN INLINE ONE, and the reason is a tool rather than
 * taste. `tools/deadhunt-ranges.mjs` slices a firing routine's body out of this
 * file by finding the first `{` after the routine's name and brace-matching
 * from there, so a parameter list containing an object type ends the "body" in
 * the middle of the signature. Measured: with `fireCounterpoint` declared as
 * `(s, voices: { id: string; ... }[])` the audit read an empty body and printed
 * `harp.count`, `harp.damage` and `harp.pierce` as DEAD stats when all three
 * are read on the next line.
 */
export interface BandVoice {
  id: string;
  level: number;
  def: InstrumentDef;
  s: InstrumentStats;
}

/** What a centre-screen announcement is about. */
export type BannerKind = 'wave' | 'boss' | 'phase' | 'grade' | 'archetype' | 'item';

/*
 * The field size and the view size now live in `./field`, and are re-exported
 * here so that every existing `import { PLAYFIELD_W } from './world'` keeps
 * working. They moved because `camera.ts` has to clamp itself against them and
 * `world.ts` imports `camera.ts` — the note at the top of `field.ts` has the
 * full reasoning.
 */
export { PLAYFIELD_W, PLAYFIELD_H, VIEW_W, VIEW_H } from './field';

/** Radii used by the threat analysis, in pixels. */
const DANGER_RADIUS = 110;
const PANIC_RADIUS = 52;
/** Only bullets inside this are considered for time-to-impact. */
const SCAN_RADIUS = 300;

/**
 * How far outside the field an enemy spawns, and how far outside it is culled.
 *
 * The cull margin is much larger than the spawn margin on purpose. In the
 * vertical game an enemy left by descending past the bottom, so one edge was
 * "gone" and three were "still coming". Here every edge is both, and a tight
 * cull margin deletes a shape on the frame it enters — a rush that spawns 70px
 * out and creeps for its telegraph is still outside the field when it commits.
 */
const SPAWN_MARGIN = 70;

/**
 * How far outside the view an enemy still counts toward the population floor.
 *
 * See `populationNearPlayer()`. It has to be at least the deepest formation
 * stagger (`columns` reaches `SPAWN_MARGIN + 128`) or a group in the middle of
 * arriving would not be counted and the schedule would slide another one in on
 * top of it.
 */
const POPULATION_MARGIN = 200;

/**
 * Seconds an unanswered level-up offer waits before the game picks card 0.
 *
 * A backstop, not a timer the player is meant to feel. The offer PAUSES the
 * world, so any visible countdown here would reintroduce exactly the pressure
 * the pause removes; 45s is well past deliberating and into walked-away. It
 * was 12s when the world merely slowed to 12% instead of stopping.
 */
const OFFER_TIMEOUT = 45;

/**
 * Shortest gap between one offer closing and the next opening, in seconds.
 *
 * Levels arrive in bursts — a big wave clears, three level-ups land at once —
 * and each one now STOPS THE WORLD. Measured across three 15-minute runs: the
 * mean gap between offers is a comfortable 20.8s, but 23% arrive within six
 * seconds of the previous and 11 of 129 within three. Two hard pauses in four
 * seconds is not a reward, it is a stutter, and the pause change made it worse
 * rather than better because the interruption is now total.
 *
 * Nothing is lost by waiting: `pending` holds every earned level and the HUD
 * already shows the queue depth, so a spaced-out burst is the same rewards in
 * a readable order. Six seconds is roughly three bars at this tempo — long
 * enough to re-engage with the fight, short enough that a queue still drains
 * inside the wave that produced it.
 */
const OFFER_MIN_GAP = 6;
const CULL_MARGIN = 320;

/**
 * Half-width of the escape corridor left open in the encirclement, in radians.
 *
 * 0.62 is about a 71-degree wedge. The number is the whole difficulty of the
 * arena in one constant: an encirclement WITHOUT a gap is not a decision, it is
 * a death sentence with a countdown, and an encirclement with too wide a gap is
 * a vertical shmup with extra steps because the player just stands in it.
 *
 * The corridor rotates between groups (see `rollGap`), so standing in it is a
 * thing you have to keep doing rather than a place you get to be.
 */
const ENCIRCLE_GAP_HALF = 0.62;

/**
 * How far off the facing the auto-aim will snap a shot, in radians.
 *
 * 0.5 rad is about 29 degrees. This is not aim assist in the usual sense —
 * there is no aiming input to assist. It is the difference between a ship that
 * fires along a heading and a ship that fires at a target, and on a keyboard
 * (where the heading is quantised to eight directions before the turn rate
 * smooths it) firing along a heading means missing anything that is not on one
 * of eight rays. The snap reads as a competent gunner rather than as help.
 *
 * There is precedent for the size of it: player-bullet collision already
 * carries an aim bonus for small targets, for the same reason.
 */
const AIM_SNAP = 0.5;

/**
 * Radii for the encirclement analysis, in pixels.
 *
 * `THREAT_RADIUS` is what counts as "near enough to be pressing you" for the
 * angular gap, and `THREAT_SCALE` normalises the nearest-enemy distance. Both
 * are deliberately generous — an enemy 400px away on an otherwise empty flank
 * is still the reason you cannot go that way.
 */
const THREAT_RADIUS = 460;
const THREAT_SCALE = 520;

/** Highest multiplier a run can reach. Beyond this, notes still score. */
const MAX_MULTIPLIER = 60;

/**
 * 400 -> 700, because `spray` landed and 400 was already being hit.
 *
 * `docs/MASTER_PLAN.md` G4 records CROSS-STRUNG silently saturating this pool
 * before any of this; `BulletPool.overflow` counts the drops and nothing was
 * reading it. The arithmetic for the new ceiling is written out at
 * CROSS-STRUNG's row in `weapons.ts`: 17 bolts a volley over 6.2 overlapping
 * generations is 105 in flight from that one instrument, and a loadout can hold
 * six instruments.
 *
 * IT IS NOT A SIMULATION CONSTRAINT AND THE NUMBER FOR THAT IS MEASURED.
 * `docs/research-weapons.md` §D.0 ran the real `World.update` at the real 1/120
 * step with zero-damage bullets injected, 4,000 measured steps x 3 repetitions
 * x 4 conditions: +73 bullets costs +8.0 us/step, or 110 ns per bullet per
 * step, against a 2.1 us run-to-run spread. At two steps per 60Hz frame that is
 * 16 us per frame for 100 extra bullets — 0.1% of a 16,667 us budget. The
 * RENDER slope is the half that was unmeasured, and it is one `drawImage` of a
 * pre-rendered sprite per bullet (`renderer.drawBullets`); see the report for
 * this change for the measurement.
 *
 * The storage cost is 17 typed arrays at the capacity, so 300 more slots is
 * about 20 KB. That was never the constraint either.
 */
const MAX_PLAYER_BULLETS = 700;

type Phase = 'idle' | 'spawning' | 'awaiting-boss' | 'conductor' | 'interlude' | 'over';

/**
 * A live instrument effect that is not a projectile.
 *
 * Three of the six instrument shapes — `beam`, `field` and the sweeping half of
 * `arc` — do not fit the bullet pool, because they are areas that persist and
 * damage over time rather than points that travel. Rather than three arrays
 * with three renderers, they are one array with a tag.
 *
 * THIS IS THE RENDERER'S CONTRACT and it is deliberately made of primitives:
 * a beam is a rectangle from (x,y) along `angle` of length `length` and half
 * width `radius`; a sweep is an annular wedge centred on (x,y) spanning `arc`
 * radians about `angle` out to `length`; a field is a circle of `radius` at
 * (x,y). `age / life` is the fade. Nothing here needs to know what an
 * instrument is.
 */
/**
 * Which statuses are live on an enemy, as a bitmask.
 *
 * ONE INTEGER TEST PER ENEMY PER STEP is the whole point. `Enemy` carries
 * fourteen status numbers, and walking them at 120 Hz across a field that has
 * already been measured at 39 enemies — and which the arena work is about to
 * grow — is a real cost for a state that is empty on most bodies most of the
 * time. `e.status !== 0` skips the entire tick, and inside it each branch is
 * one more mask test.
 *
 * A plain object rather than a `const enum` for the reason `BulletFlag` gives:
 * a const enum is not erasable syntax and Node's type stripping rejects the
 * file outright, which would take every headless tool in `tools/` down.
 */
export const Status = {
  Burn: 1 << 0,
  Poison: 1 << 1,
  Bleed: 1 << 2,
  Freeze: 1 << 3,
  Slow: 1 << 4,
  Blind: 1 << 5,
  Charm: 1 << 6,
  /**
   * Softened: takes `vulnStacks * vulnPer` more from everything.
   *
   * The eighth bit, and the first one that belongs to the FUSION tier rather
   * than to a base weapon. `hurt` reads it; nothing else has to know.
   */
  Vuln: 1 << 7,
} as const;

/** A fresh per-property counter set, one entry per name in `PROPERTIES`. */
function propCounters(): Record<PropName, number> {
  const out = {} as Record<PropName, number>;
  for (const k of PROPERTY_NAMES) out[k] = 0;
  return out;
}

export interface Effect {
  kind: 'sweep' | 'beam' | 'field';
  /** The ability that produced it, so the renderer and the mix can colour it. */
  id: string;
  x: number;
  y: number;
  /** Facing, for a sweep or a beam. Radians. */
  angle: number;
  /** Half-width for a beam, radius for a field. */
  radius: number;
  /** Reach along `angle` for a beam or a sweep. */
  length: number;
  /** Total angular width for a sweep. Radians. */
  arc: number;
  /** Damage per second for as long as it is alive. */
  dps: number;
  life: number;
  age: number;
  hue: number;
  /** True while it is welded to the ship and moves with it. */
  attached: boolean;
  /**
   * `lance` only: re-aim from the player's own aim every frame, not just
   * re-position.
   *
   * `attached` alone is not enough and the difference is the whole shape.
   * `fireBeam` spreads `count` strokes evenly around the compass and they are
   * attached, so they follow the ship while keeping the bearings they were
   * born with — that is CHORALE's static star. A lance is one line that TURNS
   * WITH THE PLAYER, which is what makes the heading the weapon. Rewriting
   * `angle` for every attached beam would have collapsed CHORALE's six spokes
   * onto one bearing, so the two cases have to be distinguishable and this is
   * the flag that does it.
   */
  tracks: boolean;
  /**
   * `lance` only: lateral offset from the ship, perpendicular to the aim, in
   * px.
   *
   * HARMONICS is "three parallel beams, held" and parallel is the load-bearing
   * word — three lines at 0, 120 and 240 degrees is the shape it is evolving
   * AWAY from. The offset cannot be recomputed in `updateEffects` because that
   * loop walks a flat array and does not know which lance of which instrument
   * it is holding, so it is stored per effect.
   */
  offset: number;
  /** Field only: inward pull on enemies, px/s at the rim. */
  pull: number;
  /** Field only: swallow enemy bullets, converting each into a shard. */
  swallows: boolean;
  /**
   * Index into `World.propSets`: which property set this effect's contacts
   * carry. 0 is the empty set.
   */
  prop: number;
  /**
   * Seconds since this effect last applied its statuses.
   *
   * A LINGERING SOURCE MUST NOT APPLY ON EVERY FRAME. A held lance touching a
   * body 120 times a second would put five poison stacks on it in a single
   * step and refresh every duration forever, which is not "a slow that lasts
   * five seconds", it is a permanent slow with a five-second tail. Statuses
   * are therefore applied on a `PROP.fieldTick` cadence per SOURCE — the
   * damage still accrues every frame, because damage is already a rate.
   */
  tick: number;
}

/**
 * What each shard tier looks like. EXPORTED because the renderer needs it too.
 *
 * This mapping used to be an inline ternary at the one place a shard is
 * collected, so it coloured the +XP popup and nothing else — and `drawNotes`
 * drew every shard with a hardcoded `dot(150)`. A rare shard, worth several
 * times a minor one, was pixel-identical to the commonest object in the game,
 * and the only place its colour appeared was a popup that fires AFTER you have
 * already picked it up. In a game whose core loop is deciding which pickups
 * are worth the trip, that is the one piece of information the player needed
 * before committing.
 *
 * The same bug, in the same file, is described two functions below
 * `drawNotes`: "a value the world took care to publish that the renderer then
 * ignored." It was fixed for the nova auras and missed here.
 */
export const SHARD_HUES: Record<prog.ShardTier, number> = { minor: 150, major: 48, rare: 340 };

/** A collectible shard: the note pickup, now carrying XP. */
export interface Shard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  alive: boolean;
  /** What it is worth. `minor` / `major` / `rare` is VS's blue / green / red. */
  tier: prog.ShardTier;
  /*
   * True once the shard has entered the pull radius even ONCE.
   *
   * Reported from play: "once xp starts to pull toward ship, should just
   * automatically be collected after some time". It did not. The pull was
   * re-tested every step against the CURRENT distance, so a shard that started
   * moving toward a player who then kited away simply stopped being pulled,
   * coasted to a halt on the drag, and expired at age 11 wherever it happened
   * to be. Measured before this: a third to a half of all shards expired
   * uncollected.
   *
   * That is the worst possible shape for a reward. The game promises the shard
   * is yours the moment it leans toward you, and then quietly takes it back
   * because you did the thing the game is otherwise asking you to do, which is
   * move. Committing on first contact makes the promise true: once it starts
   * coming, it arrives.
   */
  committed: boolean;
}

export class World {
  readonly width = PLAYFIELD_W;
  readonly height = PLAYFIELD_H;

  /**
   * The size of the rectangle the camera shows, in world units.
   *
   * Everything render-side and UI-side reads these instead of `width`/`height`
   * so that the field can grow without the viewport growing with it. See the
   * note on `VIEW_W` in `field.ts` for which of the two pairs a given number
   * belongs to.
   *
   * ACCESSORS, NOT FIELDS, and that is load-bearing. They used to be
   * `readonly viewW = VIEW_W` — a value copied once at construction, which was
   * correct while `VIEW_W` was a constant and silently wrong the moment it
   * became a function of the window. A `World` is built before the first
   * layout pass and survives every resize, so a copy taken in the constructor
   * would be the size of whatever the window happened to be on the frame the
   * run started, forever.
   *
   * Read per enemy per frame in `hasEntered`, so it is worth saying what it
   * costs: a getter returning a module-level `let` is monomorphic and inlines.
   */
  get viewW(): number {
    return VIEW_W;
  }

  get viewH(): number {
    return VIEW_H;
  }

  readonly bus = new EventBus();
  readonly transport = new Transport();
  readonly rng: Rng;

  readonly player = new Player();
  /*
   * THERE IS NO ENEMY BULLET POOL.
   *
   * `readonly enemyBullets = new BulletPool(3000)` stood here for the whole
   * life of the project. 3000 slots — 22 typed arrays of it — against a
   * measured on-screen peak of 186, plus its per-step update, its cull, its
   * collision sweep against the player, its graze annulus, its draw loop and
   * every archetype's `EmitterSpec` table. All of it is gone; see the head of
   * `enemies.ts` for why, and `docs/plan-refactor-3.md` §1b for the budget it
   * hands to enemy count.
   */
  readonly playerBullets = new BulletPool(MAX_PLAYER_BULLETS);
  readonly particles = new ParticlePool(2600);
  readonly camera = new Camera();

  enemies: Enemy[] = [];
  drops: PowerupDrop[] = [];

  score = 0;
  combo = 0;
  private comboTimer = 0;
  waveIndex = 0;
  private plan: WavePlan = planWave(0);
  private phase: Phase = 'idle';
  private waveStartBeat = 0;
  private entryCursor = 0;
  private phaseTimer = 0;
  private bossTelegraphed = false;
  private boss: Enemy | null = null;
  private time = 0;
  /** Transport beats as seen by emitters, slowed by timewarp. */
  private warpedBeat = 0;
  /** Read by the renderer to draw fire telegraphs against the same clock. */
  get warpedBeatNow(): number {
    return this.warpedBeat;
  }

  private lastBeat = 0;
  /** Kills this step, folded into a smoothed rate for the music director. */
  private killsThisStep = 0;
  /** Enemy volleys this step, folded into a smoothed rate. */
  private volleysThisStep = 0;

  /* ---------------------------------------------------------------------- *
   * Progression
   * ---------------------------------------------------------------------- */

  /**
   * The run economy. Public so the HUD can read `slotSummary`, `readyFusions`
   * and `levelProgress` without the world growing a passthrough for each.
   *
   * Created once and reset IN PLACE for every run. Never reassigned: the
   * snapshot's `abilities` map is written through `writeAbilityLevels` and the
   * director holds that reference across frames.
   */
  readonly progression: prog.ProgressionState;

  /** Seconds until each held instrument's next activation, by ability id. */
  private readonly instrumentTimers: Record<string, number> = {};


  /**
   * Whether any `spawn` ally is out, so the per-frame drive can be skipped.
   *
   * Same gate `steerPlayerBullets` gets and for the same reason its call site
   * gives: the ordinary loadout should pay one comparison, not a walk of 700
   * bullets looking for a flag nothing set. `fireSpawn` raises it on every
   * activation and `updateSummons` lowers it the frame it finds none, so the
   * flag is at worst one interval stale in the direction that costs nothing.
   */
  private summonsActive = false;
  /**
   * Live `spawn` allies, refreshed by `updateSummons`. Public because a
   * budget nothing can measure is a budget nobody can be wrong about, and
   * `tools/deadhunt-ranges.mjs` and `tools/_shapecount.mjs` are what measure
   * it — the same reason `BulletPool.bounced` and `.overflow` are public
   * counters. At most one step stale, in the direction that costs nothing.
   */
  summonsLive = 0;

  /** Real seconds the current offer has been open, for the safety pick. */
  private offerAge = 0;
  /** Game time the last offer closed, so a burst does not stack. */
  private lastOfferClosed = -OFFER_MIN_GAP;
  private wasChoosing = false;

  /** Persistent instrument effects: beams, sweeps and fields. */
  readonly effects: Effect[] = [];

  /**
   * Folded rig modifiers, refreshed once per step.
   *
   * Once per step and not once per use: `rigModifiers` walks the whole rig and
   * every one of the six firing routines wants it, and a value that is
   * recomputed per call is a value that can disagree with itself inside one
   * frame.
   */
  private mods: Modifiers = noModifiers();

  /**
   * Folded rig RULES, refreshed on the same line as `mods` and for the same
   * reasons. See `Rules` in `weapons.ts` for what each one is and where it
   * fires; the sites are all in this file, all in place, and none of them is a
   * bus subscription.
   */
  private rules: Rules = noRules();

  /**
   * How many times each rule has actually FIRED this run. Monotonic.
   *
   * The same argument as `BulletPool.spawned` and `BulletPool.bounced`, and it
   * is a sharper one here: a rule is far likelier than a multiplier to be
   * installed and never triggered, because a multiplier is applied every frame
   * by construction and a rule waits for a moment that may not come. A feature
   * nothing can observe is a feature that can rot, and this repository's single
   * most recorded defect is the ability that type-checks, appears in the HUD
   * and does nothing.
   *
   * `tools/rulefire.mjs` reads this and asserts every one is non-zero in a real
   * run, with a denominator. Public and mutable rather than private, because
   * the tool must not have to reach through a private field to see it.
   */
  readonly ruleFires = {
    /** Activations fired at overcharge (LASER). */
    overcharge: 0,
    /** Bolts re-fired from a corpse (HOMING). */
    killEcho: 0,
    /** Enemy-steps run slow inside the bubble (TIMEWARP). */
    slowed: 0,
    /** Rings released by taking a hit (COMPRESSOR). */
    hitNova: 0,
    /**
     * Activations fired on at least HALF a stillness charge (FERMATA).
     *
     * Half and not "any", deliberately. `idleTime` resets only when the ship
     * leaves a 60px anchor, so at top speed even a constantly-moving player
     * carries ~0.13s of it and every single activation would count — a counter
     * that reads 100% for a ship that never plants is a gate optimised against
     * (AGENTS.md §3). This one only moves when the charge is worth having, so
     * it measures the mechanic rather than the arithmetic.
     */
    charged: 0,
    /** Rings dropped in the wake (UP-TEMPO). */
    trail: 0,
  };

  /**
   * The DENOMINATOR for each entry in `ruleFires` — how many chances the rule
   * had, whether or not it took them.
   *
   * AGENTS.md §3: "Print every denominator. A check that examined nothing
   * reports a pass." A fire count on its own cannot tell "the rule is broken"
   * from "this run never produced the moment", and those need different fixes.
   * Same key names as `ruleFires` so a tool can zip them without a mapping
   * table it would have to keep in step.
   */
  readonly ruleChances = {
    /** Instrument activations. */
    overcharge: 0,
    /** Enemies killed by a player bullet. */
    killEcho: 0,
    /** Enemy-steps: one per live enemy per simulation step. */
    slowed: 0,
    /** Hits the player took. */
    hitNova: 0,
    /** Instrument activations, same as `overcharge`. */
    charged: 0,
    /** Steps in which the ship actually moved. */
    trail: 0,
  };

  /* ---------------------------------------------------------------------- *
   * THE PROPERTY SUBSTRATE
   *
   * `weapons.ts`' `Props` says what a hit CARRIES; this is where a hit finds
   * out. Three pieces:
   *
   *   `propSets`     interned property sets, index 0 = the empty set
   *   `propOwners`   which instrument each set came from, for cooldowns and hue
   *   `accelBySrc`   ACCELERANDO's per-set bounce gain, for `BulletPool.update`
   *
   * WHY INTERN. A bullet is a column in a structure-of-arrays and cannot hold
   * an object; every other option costs either an allocation per shot or a
   * per-bullet copy of a 28-field record. Interning gives the collision loop a
   * `Uint8Array` read and one array index, and a run holds at most a handful of
   * distinct sets because the player holds at most four instruments.
   * ---------------------------------------------------------------------- */
  /**
   * Every property set in play this run. Index 0 is `noProps()` and is what
   * every bolt not fired by a property-carrying instrument holds — which is
   * what makes `tools/propfire.mjs`' control run mean something.
   *
   * Public because a substrate nothing can observe is a substrate that can rot,
   * which is the same argument `ruleFires` and `BulletPool.bounced` are here on.
   */
  readonly propSets: Props[] = [noProps()];
  private readonly propOwners: string[] = [''];
  private readonly propIndex = new Map<string, number>();
  private readonly accelBySrc = new Float32Array(256);
  /**
   * Sets that could not be interned because the table was full. Public and
   * expected to stay at zero: 256 slots against four held instruments times
   * three levels is not a bound anyone should reach, and if it is ever reached
   * the affected bolts silently lose their properties, which is precisely the
   * class of defect this file is full of records of.
   */
  propOverflow = 0;
  /**
   * The property slot of the instrument currently firing.
   *
   * Set around `fireShape` rather than threaded through eleven routine
   * signatures. That is a deliberate trade: an ambient field is worse style
   * than an argument, and adding a parameter to every `fire*`, `pushWell`,
   * `pushField` and `throwWell` would have been a wider diff with more places
   * to forget. It is written and cleared on adjacent lines in one function.
   */
  private activeProp = 0;
  /** Game time at which each instrument's TUTTI burst may fire again. */
  private readonly burstAt: Record<string, number> = {};

  /**
   * How many times each PROPERTY actually took effect this run. Monotonic.
   *
   * The same argument as `ruleFires`, and a sharper one again: a status effect
   * that is installed and never fires is, in this repository's own record, the
   * single most repeated defect class. A property waits for a hit, a roll and
   * a body that can carry it; any of the three can be missing while everything
   * type-checks, renders and reads correctly on the card.
   *
   * `tools/propfire.mjs` reads all four of these tables and asserts, per
   * property, that it applies, that it ticks, and that a run with no property
   * installed produces zero of everything.
   */
  readonly propFires = propCounters();
  /** The DENOMINATOR: how many chances each property had, taken or not. */
  readonly propChances = propCounters();
  /**
   * Enemy-steps spent carrying each property — the proof that it TICKS rather
   * than merely being applied.
   *
   * A burn that is applied and expires on the same frame is not a burn, and no
   * fire count can tell the difference. This one can: it is incremented in the
   * status tick, which only runs on a body whose bitmask says the status is
   * live.
   */
  readonly propTicks = propCounters();
  /**
   * Hit points actually removed by each property, as opposed to by the hit.
   *
   * TWO ENTRIES ARE NOT HIT POINTS, and they are named here rather than left
   * to be discovered, because a column whose unit changes per row is exactly
   * the "know what a column actually contains" trap AGENTS.md §6 records.
   *
   *   `blind`  ATTACKS PREVENTED — volleys deleted and contacts waved off. A
   *            blind removes damage instead of dealing it, and a blind that
   *            never causes a miss is inert; there is no other number that can
   *            show that, so this column carries it.
   *   `leech`  HEALTH POINTS RESTORED, for the same reason with the sign
   *            flipped. A leech that rolls successfully while the player is at
   *            full health has fired and done nothing, which is worth being
   *            able to see.
   */
  readonly propDamage = propCounters();

  /**
   * THE UNCONDITIONAL DENOMINATORS: how often each MOMENT a property could
   * hook into happened at all, whether or not any property was installed.
   *
   * `propChances` is the tighter denominator — "the property was present and
   * was rolled" — and it is the right one for reading a hit rate. It cannot
   * do the job this table does, because it is incremented inside the branch
   * that tests for the property, so a run with nothing installed reports zero
   * chances and zero fires and looks exactly like a run where every branch is
   * broken. AGENTS.md §3: zero and clean look identical unless you print the
   * count.
   *
   * These are counted in the open. `tools/propfire.mjs`' control run asserts
   * every one of them is large while every `propFires` entry is zero, which is
   * the assertion that makes the rest of that file mean anything.
   */
  /**
   * Attacks — volleys and contacts — attempted by a body that is BLINDED.
   *
   * OUTSIDE `propMoments` on purpose, and the reason is the control run.
   * `tools/propfire.mjs` asserts every entry in that table is non-zero while
   * holding a weapon that carries nothing, which is what makes its zeros
   * evidence; this number is zero by construction in exactly that run, because
   * nothing there can blind anybody. It is a per-property denominator, not an
   * unconditional moment, and putting it in the wrong table made the control
   * fail for a reason that had nothing to do with the control.
   *
   * It exists because a bare "attacks prevented > 0" is duration-dependent in
   * a way an absolute cannot express: enemies in this build attack rarely, so
   * a 60s GLARE run produced three blinded attacks and prevented none of them,
   * and the gate called a working property inert. With a denominator the same
   * run reports the honest thing — nothing was measured.
   */
  blindedAttacks = 0;

  readonly propMoments = {
    /** Discrete hits landed on an enemy by a bolt or a strike. */
    hit: 0,
    /** Instrument activations. */
    activation: 0,
    /** Enemy volleys fired. */
    volley: 0,
    /** Enemy bodies that reached the player's hitbox. */
    contact: 0,
    /** Enemy simulation steps: one per live enemy per step. */
    enemyStep: 0,
  };

  /**
   * Per-instrument activation counter, for LASER's every-Nth overcharge.
   *
   * Keyed exactly as `instrumentTimers` is, and cleared alongside it on reset
   * and on a fusion — an evolution deletes its base, and a counter left behind
   * would hand the result a cadence it did not earn.
   */
  private readonly shotCount: Record<string, number> = {};

  /** Distance travelled since UP-TEMPO last dropped a ring, in px. */
  private trailSince = 0;

  /**
   * Seconds the ship has been genuinely stationary, for FERMATA's charge.
   *
   * NOT `idleTime`, and the first version of this used `idleTime` because it
   * already existed and was already the camp-pressure clock. `tools/rulefire`
   * measured what that actually meant: `idleTime` only resets when the ship
   * leaves a 60px anchor, so a weaving bot that never stops still held at least
   * half a charge on **74.8% of its activations**. An item whose card says
   * "hold still" was paying out to a ship that never did — the passive would
   * have read as a flat damage multiplier with extra steps, which is the exact
   * thing this whole pass exists to delete.
   *
   * Speed-gated instead: the stick is released and the slide has settled. That
   * is a thing the player can feel themselves doing, and it breaks the moment
   * they dodge.
   */
  private stillTime = 0;

  /**
   * True for the duration of ONE overcharged activation, so the projectile
   * routines can flag their bolts `Seeking`.
   *
   * Set immediately before the `switch` in `fireInstruments` and cleared
   * immediately after it, which is a window of one synchronous call. A
   * parameter on all ten `fire*` signatures would be honest too, but six of
   * them have nothing to steer and would carry it to ignore it — and
   * `tools/deadhunt-ranges.mjs` greps those bodies for the stats they read, so
   * a parameter nobody uses is noise in an audit that already has enough.
   */
  private overchargeVolley = false;

  /* ---------------------------------------------------------------------- *
   * THE SECOND AXIS: the state five of the twelve instruments run on.
   *
   * `docs/plan-items-v2.md` §1 counted the roster and found twelve items and
   * one idea. Everything below exists so that an item can be about WHEN, about
   * WHETHER, or about ANOTHER ITEM, rather than about where the hitbox appears.
   * ---------------------------------------------------------------------- */

  /**
   * Where the arrangement is, as far as the simulation is concerned.
   *
   * `main.ts` pushes the director's real readout into this once a frame. It is
   * the only inbound channel in the whole game/music boundary and it is a plain
   * value object by design — the world holds no director, cannot ask it a
   * question, and `src/game/` still never imports `src/audio/`.
   *
   * WITH NOBODY CONDUCTING IT FREE-RUNS, and that decision has to be stated
   * plainly because it is the one place this pass invents music inside the game
   * layer. Every headless tool in `tools/` builds a `World` and no director:
   * benchmarked, running a real `MusicDirector` alongside the simulation costs
   * **11.5x** the step time (`world only 136ms / world + director 1560ms` over
   * 7,200 steps), which `tools/builds.mjs` — 7 policies x 8 seeds x 900s —
   * cannot afford. A default of "always intro" would leave DROP inert in every
   * gate the project has, which is a worse lie than a stand-in.
   *
   * So the stand-in is CALIBRATED rather than invented: `tools/sections.mjs`
   * measures the real arranger at drop 42.5%, build 17.2%, breakdown 16.5%,
   * sustain 16.2% over 8 seeds x 300s, and `freeRunMusic` reproduces a drop
   * share of 43% off the eight-bar phrase. It is NOT a copy of
   * `Arranger.maybeAdvance` and must never become one; it is the world's own
   * coarse idea of the form, used only when nothing better has been pushed.
   */
  readonly musical: MusicalState = { section: 'sustain', energy: 0.45 };
  private musicalPushed = false;

  /**
   * The transport beat at the last activation of ANY instrument.
   *
   * METRONOME's silence bonus reads it. See `Swell` in `weapons.ts`: two
   * beat-locked weapons on disjoint slices of the bar interleave rather than
   * conflict, so the anti-synergy the design asks for has to be stated as a
   * real cost, and "how much of the bar went by in silence" is the honest one.
   */
  private lastVolleyBeat = 0;

  /** Beats since anything in the band last fired, capped at one bar. */
  get beatsQuiet(): number {
    return Math.min(BEATS_PER_BAR, Math.max(0, this.transport.beat - this.lastVolleyBeat));
  }

  /* RITARDANDO's bubble, folded once per step from the loadout. */
  private dragRadius = 0;
  /** Fraction of enemy time REMOVED inside the bubble, 0..1. */
  private dragDepth = 0;
  /** Multiplier on every instrument's own interval. 1 when nothing drags. */
  private dragSelf = 1;
  /**
   * L6 USED TO REACH ENEMY FIRE AND NOW REACHES DEEPER INTO BODIES.
   *
   * `dragBullets` slowed every enemy bullet that entered the bubble, once per
   * bullet, permanently. That was RITARDANDO's third rung and there is nothing
   * left for it to slow, so the rung buys the same thing in the only currency
   * on the field: the bubble's depth against BODIES goes half again as deep at
   * two lanes. The movement half of the bubble was always there — see the
   * `dragSq` block in `updateEnemies` — so this is a strengthening of an
   * existing effect rather than a new one, which is what stops the item's card
   * from describing a mechanism the simulation no longer has.
   */
  private dragDeepens = false;
  private dragPulseAt = 0;

  /** SOSTENUTO: where the last thing the player killed fell. */
  private corpseX = 0;
  private corpseY = 0;
  private corpseHue = 0;
  private hasCorpse = false;

  /** COUNTERPOINT: the earliest time the answering voice may be struck again. */
  private counterpointAt = 0;

  /* REST: the rest itself, and the sweep that lands when the band comes back. */
  private restUntil = -1;
  private restSweep: { at: number; area: number; rings: number; dps: number; hue: number } | null = null;

  /*
   * TACET's cycle. `tacetBars` counts down bars in whichever half of the cycle
   * is running; `tacetQuiet` says which half that is.
   */
  private tacetQuiet = false;
  private tacetBars = 0;
  private tacetBank = 0;
  private tacetRota = 0;
  private readonly tacetLanes: SilenceableStem[] = [];

  /**
   * Called once per instrument activation, if anything set it.
   *
   * `tools/beatlock.mjs` is the reason it exists: a beat-locked weapon that
   * fires uniformly is this repository's classic silent defect, and NO existing
   * gate can see it — `rulefire` watches the rig, `deadhunt-ranges` watches
   * stats, and neither knows what a bar is. Proving the claim needs the phase
   * of every activation, which is not derivable from anything the world already
   * publishes.
   *
   * Public and optional in the same style as `isFirstDiscovery`. Unset it costs
   * one comparison per activation.
   */
  onActivation: ((id: string, barPhase: number, damage: number) => void) | undefined = undefined;

  /**
   * How many activations each beat lock allowed, and how many it held back.
   *
   * The cheap half of the same question, always on, so a lock that has silently
   * stopped gating is visible without a browser or a bespoke tool.
   */
  readonly beatFires = { bar: 0, halfbar: 0, offbeat: 0, free: 0, held: 0 };

  /*
   * Fire counts for the four items whose whole identity is a branch that might
   * never be taken. Same argument as `ruleFires`: an item installed and never
   * triggered is the same defect as a stat nothing reads, and it is a likelier
   * one. `tools/beatlock.mjs` prints all four with denominators.
   */
  counterpointCopies = 0;
  ghostsRaised = 0;
  tacetDischarges = 0;
  /**
   * Bodies inside RITARDANDO's bubble this step, summed over the run.
   *
   * Was `dragsApplied`, a count of enemy BULLETS the bubble had slowed, latched
   * once per bullet with `BulletFlag.Dragged`. There are no enemy bullets, and
   * the item's third rung no longer reaches fire — it deepens the slow on
   * bodies instead (see `dragDeepens`). This counts what the bubble now does,
   * so `tools/beatlock.mjs` can still answer the question it was written to
   * ask: does this item's identity ever actually happen?
   *
   * Not latched, because a body is not consumed by being slowed: the same body
   * counts on every step it spends inside, which makes this "body-steps
   * dragged" rather than "bodies dragged". That is the honest unit for a
   * continuous effect and it is stated here because the number is otherwise
   * unreadably large.
   */
  dragsApplied = 0;

  /**
   * Flags every player bolt is spawned with.
   *
   * One place, so that a rule which changes what a shot IS cannot be applied to
   * four of the five spawning routines and forgotten on the fifth — which is
   * precisely how `bounces` spent the life of the table being honoured by one
   * routine and dropped by the others.
   *
   * `fireSpray` is the one shape the overcharge only half reaches: it flags its
   * bolts `Seeking` like everything else, but it ignores `pierce` on purpose
   * (see `InstrumentShape`, where bounding the live count is called the one
   * real budget in the catalogue), so an overcharged spray hits harder and
   * homes without becoming unstoppable. That is a deliberate hole, not a
   * missed site.
   */
  private get shotFlags(): number {
    return this.overchargeVolley
      ? BulletFlag.DespawnOffscreen | BulletFlag.Seeking
      : BulletFlag.DespawnOffscreen;
  }

  /* ---------------------------------------------------------------------- *
   * The danger signal
   * ---------------------------------------------------------------------- */

  /**
   * Distance to the nearest live enemy, normalised: 0 is touching, 1 is
   * nothing within `THREAT_SCALE`.
   *
   * This is half of what replaces `playerHeight` as the music's danger proxy.
   * "How far up the field is the player" was a real signal in a game where the
   * threat was always above and the safety always below; in the round it is
   * noise, because the player spends the whole run near the middle.
   */
  private nearestThreat = 1;
  /**
   * How closed the ring is: 0 is a wide-open escape corridor, 1 is surrounded.
   *
   * Computed as the largest ANGULAR GAP in the enemies around the player,
   * inverted. It is the slow axis and it is the one that is genuinely new —
   * "you are surrounded" and "something is close" are different feelings and
   * the vertical game had no way to tell them apart.
   */
  private encirclement = 0;
  /** The bearing of that largest gap, radians. The way out. */
  private escapeAngle = 0;

  /**
   * Centre of the escape corridor the CURRENT wave is leaving open, radians.
   *
   * Distinct from `escapeAngle`, which is measured from what is actually on the
   * field. This one is the spawner's intent: it is where the next group will
   * deliberately not come from. It rotates between groups so that the safe side
   * is somewhere you have to keep going rather than somewhere you get to stand.
   */
  private gapAngle = 0;
  /**
   * Run totals, for the summary at the end.
   *
   * A game over currently reports a score and a wave, which says nothing about
   * what the run was actually like — and in a game whose whole premise is that
   * the fight writes the music, the end is the natural place to show what you
   * played.
   */
  readonly totals = { notes: 0, bestMultiplier: 1, flawless: 0, wavesCleared: 0, grazes: 0 };

  /** Damage taken and peak multiplier during the current wave, for its grade. */
  private waveDamage = 0;
  private wavePeakCombo = 0;
  /**
   * The combo the player already had when this wave began.
   *
   * `wavePeakCombo` is reset to 0 at wave start but is immediately reseeded
   * from the running `combo`, which persists across waves — so it measures the
   * absolute chain, not this wave's contribution. Grading on the difference
   * asks "what did you build HERE", which is the question the grade was always
   * phrased as. Kept separate from `wavePeakCombo` so the banner and the
   * summary keep showing the real multiplier the player reached.
   */
  private waveComboBase = 0;

  readonly snapshot: GameSnapshot = emptySnapshot();

  /**
   * Halt the simulation while rendering continues.
   *
   * Tooling needs the world to hold still to measure a frame: the contrast
   * probe was freezing it by hammering every bullet's speed to zero on a 16ms
   * interval, which works only as long as nothing else touches those arrays.
   * A real flag is both honest about intent and immune to the pool layout
   * changing underneath it.
   */
  frozen = false;

  /** Whether this wave has produced an armed enemy yet; see spawnGroup. */
  private waveHasLunger = false;
  /** Beat the next boss-fight top-up is allowed at, and which entry it takes. */
  private bossEscortBeat = 0;
  private bossEscortCursor = 0;

  /** Beats the spawn schedule has been slid forward because the stage emptied. */
  private waveBeatBias = 0;

  /**
   * Impulses for the warping grid, drained by the renderer each frame.
   * The simulation does not know what a grid is; it just reports that
   * something violent happened at a place, and rendering decides what that
   * looks like.
   */
  readonly shocks: { x: number; y: number; radius: number; strength: number }[] = [];

  /** Expanding nova rings, drawn by the renderer and resolved here. */
  /**
   * Expanding rings — the `aura` instrument shape, drawn by the renderer and
   * resolved here.
   *
   * The three extra fields are what turned this from NOVA's private array into
   * the shape every aura uses: `maxR` is where the ring stops rather than a
   * constant, `dps` is the instrument's own damage rather than a hardcoded 6,
   * and `hue` lets six different auras look like six different instruments.
   * The original `x`/`y`/`r` are untouched, so the renderer keeps working
   * without knowing any of this happened.
   */
  readonly novas: {
    x: number;
    y: number;
    r: number;
    alive: boolean;
    maxR: number;
    speed: number;
    dps: number;
    /**
     * Seconds the ring holds at full radius before it fades — `linger`.
     *
     * The `aura` shape used to ignore `linger` entirely, which made NOVA L6
     * ("the ring hangs before it fades") and TIMPANI L6 ("the wave staggers
     * what survives it") two of the 84 level steps that moved only a field
     * their own shape never read. Picking either did nothing at all.
     */
    hold: number;
    hue: number;
    /**
     * Whether the expanding edge THROWS BODIES OUTWARD.
     *
     * Was `clears`, meaning "deletes enemy bullets in the annulus". True for an
     * aura, because NOVA's blurb sells exactly that — "a ring on the beat that
     * clears bullets"; false for a `strike`, which reuses this array as a
     * VISUAL only, so that CHIME could not inherit a defence by sharing a
     * container.
     *
     * With enemy fire gone the flag had no referent, and leaving it named
     * `clears` while it did nothing is precisely the dead-condition defect
     * `tools/deadconditions.mjs` exists to find. It carries the same INTENT —
     * "this ring buys the player room" — in the only currency left. The
     * true/false split is unchanged, so nothing gained the behaviour by
     * accident: it is exactly the rings that used to sweep bullets.
     */
    shoves: boolean;
    /** Property set this ring's contacts carry. 0 for the visual-only rings. */
    prop: number;
    /** Seconds since it last applied its statuses. See `Effect.tick`. */
    tick: number;
  }[] = [];
  /**
   * Archetypes already introduced this run.
   *
   * The enemy-to-motif mapping is the whole premise, and until now it was only
   * discoverable by hovering a side-panel entry with a mouse — which no one
   * does mid-dodge, and nobody on a phone can do at all. Naming each one the
   * first time it appears teaches the idea without a tutorial.
   */
  private introduced = new Set<EnemyArchetype>();

  /** One encore rescue per wave, at most. */
  private encoresThisWave = 0;
  /** Next score threshold that awards an extra life. */
  private nextExtend = 40000;
  /**
   * Camping pressure: where the ship was standing when it last actually moved.
   *
   * `deadhunt-horizon.mjs` measured a ship that never moves and never stops
   * firing reaching wave 60+ with zero deaths — see its comment for the full
   * mechanism. None of the game's mercy (invuln, the on-hit bullet clear,
   * ENCORE, auto-bomb) is conditioned on whether the player is doing anything,
   * so a parked ship gets exactly the same forgiveness as one that is dodging
   * for its life. This is the other side of that: bullets get faster the
   * longer the ship sits still, reset the instant it actually repositions.
   */
  private idleAnchorX = 0;
  private idleAnchorY = 0;
  private idleTime = 0;
  /** Seconds of standing still before camping costs anything — long enough to plant and shoot a pattern out. */
  static readonly IDLE_GRACE_S = 4;
  /** Seconds from the end of the grace period to full camp pressure. */
  static readonly IDLE_RAMP_S = 20;
  /** Px of drift from the anchor that counts as "moved", not jitter. */
  static readonly IDLE_RESET_DIST = 60;
  /**
   * Enemy CLOSING-speed multiplier at campPressure = 1.
   *
   * Was `CAMP_BULLET_BOOST`, and it sped up enemy bullets — the one lever a
   * camping player felt, and the only consumer of the `bulletScale` term. With
   * enemy fire deleted it had nowhere to land, so it moves to the quantity
   * that carries the threat now. Renamed rather than repointed silently: the
   * old name would have read as a bullet tuning in a game with no enemy
   * bullets.
   *
   * The number is unchanged at 0.5, so a fully camped player faces a swarm
   * closing half again as fast. That is a strictly stronger version of the
   * same punishment — a bullet you can still side-step versus a ring that
   * shrinks around you.
   */
  static readonly CAMP_CLOSE_BOOST = 0.5;
  /**
   * How far `clearRoom` throws bodies off you, in px.
   *
   * 520 is a little over half the short axis of the smallest view this game
   * allows (`field.ts` VIEW_SPAN_MIN is 1004), so "the room" means what a
   * player would point at if you asked them to. Larger and a bomb is a
   * teleport for the whole field; smaller and the bodies already touching you
   * are the only ones that move, which is the moment the valve is for.
   */
  static readonly CLEAR_RADIUS = 520;
  /** How far an ORDINARY hit shoves the crowd off you. See `onPlayerHit`. */
  static readonly HIT_SHOVE_RADIUS = 150;
  /** How full a boss wave is kept, and how often it is topped up. */
  static readonly BOSS_ESCORT_FLOOR = 18;
  static readonly BOSS_ESCORT_BARS = 1;

  /**
   * Total ring count past which UP-TEMPO stops laying a trail.
   *
   * Not a trail budget — a courtesy. The trail's own live count is bounded at
   * eleven by its drop distance and its life (see the drop site); this exists
   * so that in the one case where the array is already full of somebody else's
   * auras, the instruments win. Well clear of the measured peak of 310.
   */
  static readonly TRAIL_CEILING = 340;
  /**
   * Hard ceiling on `novas.length`. THERE WAS NONE.
   *
   * `docs/research-weapons.md` §D.5 recorded this as the risk to fix alongside
   * `mortar`: "`novas` has no cap today — the two `novas.push` sites
   * (`fireAura` and `fireStrike`) carry no length guard, unlike `wells`' 14."
   * There are seven push sites now (those two, COMPRESSOR's hit ring,
   * UP-TEMPO's trail drop, `fireTrail`, and `mortar`'s telegraph and
   * detonation) and every one of them is guarded.
   *
   * 420, against a MEASURED `novas.length` of mean 34 / peak 322 over three
   * eight-minute runs BEFORE this change and mean 27 / peak 240 after it
   * (`deadhunt-ranges`). It fell because TUTTI left `aura`, which is worth
   * saying: the number this cap is set against moved as a side effect of the
   * same change that added the cap, so read it off the tool rather than off
   * this paragraph. Deliberately ABOVE the observed peak rather than under it —
   * a cap that bites in ordinary play is a silent content change, and the job
   * here is to stop an unbounded array, not to ration the auras. Seen red at 10
   * (TREMOLO's trail fell 69 -> 10 in `_shapecount`), so it is not decorative.
   * `TRAIL_CEILING` at 340 sits below it on purpose, so the
   * rig's own trail yields to the instruments before this backstop is reached.
   *
   * Every ring costs a loop over the enemies in `updateNova` and four stroked
   * arcs in `drawNovas`, so the number is a render budget as much as a
   * simulation one. `tools/_shapecount.mjs` is where a shape's contribution to
   * it is read off.
   */
  static readonly MAX_NOVAS = 420;
  /**
   * How far a lightning arc may reach for its next body, px.
   *
   * ARC is the one weapon in the roster whose value depends on enemy DENSITY
   * rather than on where the ship is: against a lone shape it is the worst
   * thing in the game, and against a wall it is the best. That trade only
   * exists if the reach is short enough to be a real question about how the
   * pack is standing, which is why this is a third of a screen and not a
   * screen.
   */
  static readonly CHAIN_REACH = 260;
  /** Half-thickness of the line a `lance` property cuts, px. */
  static readonly LANCE_HALF_WIDTH = 15;
  /** Seconds a helper sent by the `brood` property lives. */
  static readonly BROOD_LIFE = 4;
  /** px/s a charmed body closes on whatever it has decided to fight. */
  static readonly CHARM_SPEED = 190;
  /**
   * A cap on `effects`, which never had one.
   *
   * It never needed one while the only writers were `fireArc`'s sweeps and
   * `fireLance`'s lines, both of which are bounded by the loadout. The `chain`
   * and `lance` PROPERTIES write one per hit, and a hit happens as often as
   * the fastest weapon in the band fires — so this is the same budget
   * `MAX_NOVAS` is, applied to the container that just gained an unbounded
   * writer. `updateEffects` costs a loop over the enemies per effect.
   */
  static readonly MAX_EFFECTS = 96;
  /**
   * Live `spawn` allies, shape-wide. `docs/research-weapons.md` §D.9 budgeted
   * 12; see `fireSpawn` for why the count is not per instrument.
   */
  static readonly MAX_SUMMONS = 12;
  /*
   * The bounds on UNISON's rate compensation. Both are reachable and neither is
   * decorative: SPICCATO under RAPID reaches a 0.062s interval (enumerated by
   * `deadhunt-ranges`), which asks for 30x, and BLACK HOLE opens at 6.5s, which
   * asks for 0.29x. See `World.fireUnison`.
   */
  static readonly UNISON_MAX = 12;
  static readonly UNISON_MIN = 0.4;
  /** How far a ghost is thrown back by its own strike, in px. See `fireGhost`. */
  static readonly GHOST_RECOIL = 44;
  /** Shapes whose `damage` field is not damage. See `ensembleDps`. */
  static readonly NO_DPS: ReadonlySet<string> = new Set(['rest', 'drag', 'unison', 'counterpoint']);
  /**
   * rad/s a summon can turn. Half `steerPlayerBullets`' hardcoded 6, because an
   * ally that turns as fast as a homing bolt sticks to its target's back and
   * reads as glued rather than as something flying.
   */
  static readonly SUMMON_TURN = 3;
  /** Seconds a `chain` hop's arc is drawn for. Long enough to read, short enough to be a flash. */
  static readonly CHAIN_FLASH_S = 0.12;
  /** Damage a `chain` keeps per hop. See `fireChain` for the power arithmetic. */
  static readonly CHAIN_FALLOFF = 0.85;
  /**
   * px/s below which the ship counts as stationary for FERMATA's charge.
   *
   * `Player.update` damps velocity rather than zeroing it, and its own comment
   * puts the slide from top speed at about 40px — so a released stick decays
   * through this within a couple of frames while any real input sits far above
   * it. Well under the ~460px/s top speed, so it cannot be gamed by feathering.
   */
  static readonly STILL_SPEED = 40;
  /**
   * Hues for the two rings the RIG produces, as opposed to the ten an
   * instrument produces.
   *
   * `hueOf(id)` cannot serve here: it hashes an INSTRUMENT id so that six
   * simultaneous auras are six colours, and a rule has no instrument. Fixed
   * hues instead, chosen to sit apart from each other and to read as what they
   * are — COMPRESSOR's is the red of a hit answered, UP-TEMPO's the ember of
   * ground you have already crossed.
   */
  static readonly HIT_NOVA_HUE = 12;
  static readonly TRAIL_HUE = 28;
  /**
   * campPressure at which the two rescue mechanics (ENCORE, the last-life
   * auto-bomb) stop firing: past half ramped, roughly 14s of standing still.
   * Same number for both because they are the same question — "is this ship
   * actually fighting" — asked at two different moments of a run.
   */
  static readonly CAMP_MERCY_BLOCK = 0.5;
  /**
   * Pity timer, in SECONDS. Read the reason before changing the unit back.
   *
   * Random drops mean a player can go a whole wave with nothing, which is
   * exactly what happened: "i got 0 powerups and i just had to dodge bullets
   * nonstop". So after a dry spell the next kill is guaranteed to drop.
   *
   * It counted KILLS for most of this project's life and was rewritten three
   * times — 9, then 6, then 3 — every time because something else changed the
   * kill rate: enemies got 2.5x tougher, group sizes were trimmed, and a run
   * went from 42-54 kills to 20-25. A budget denominated in an event whose rate
   * you are changing will move under you, and this one moved in the worst
   * possible direction each time, tightening exactly when the game got harder.
   * tools/README calls this out as a repeated defect in three separate budgets.
   *
   * The weapon rebuild cuts the player's damage again, so the kill rate is
   * about to move for a fourth time. Denominating it in seconds ends that: a
   * guarantee in wall-clock time means what it says whatever the roster does.
   * It still only pays out ON a kill, so it cannot hand drops to a player who
   * is doing nothing.
   */
  private secsSinceDrop = 0;
  /**
   * When the last OVERDRIVE was put on the floor. Negative so the first drop
   * of a run is never rationed — see `rollDrop`.
   */
  private lastOverdriveDrop = -OVERDRIVE_MIN_GAP;

  /**
   * Collectible note shards, Geometry Wars' "geoms".
   *
   * These are the reason to move *toward* the danger you just created rather
   * than only away from it, which is the emotional difference between this and
   * a pure bullet hell. They also feed the multiplier, which feeds the `flow`
   * term in the tension model — so chasing them literally makes the music go
   * harder.
   */
  readonly notes: Shard[] = [];

  /**
   * Gravity wells.
   *
   * The one powerup that turns the thing killing you into the thing rewarding
   * you: it drags enemy fire into itself and converts every bullet it swallows
   * into a collectible note. A screen that was a death sentence becomes a
   * payday, which is the most Geometry Wars idea in the game.
   */
  readonly wells: {
    x: number;
    y: number;
    age: number;
    life: number;
    /** Peak radius. Was a hardcoded 190; now the instrument's own area. */
    radius: number;
    /** Damage per second to anything inside. */
    dps: number;
    /** Inward pull at the rim, px/s. Zero for a pool that only burns. */
    pull: number;
    /** Swallow enemy bullets, converting each into a shard. */
    swallows: boolean;
    hue: number;
    /** The instrument that made it. */
    id: string;
    /** Property set this pool applies to whatever stands in it. */
    prop: number;
    /** Seconds since it last applied its statuses. See `Effect.tick`. */
    tick: number;
  }[] = [];

  /**
   * Floating score text.
   *
   * The multiplier lived only in the side panel, which is the one place a
   * player looking at their hitbox never looks. Putting the number where the
   * kill happened is what turns a counter into a reward.
   */
  readonly popups: { x: number; y: number; text: string; age: number; hue: number; big: boolean }[] = [];

  /**
   * Centre-screen announcement, its subtitle, its age, and what kind it is.
   *
   * The kind exists because tooling was identifying announcements by
   * regex-matching their text against a list of known prefixes — the same
   * brittleness that let an earlier test pass for nineteen iterations while the
   * feature it named was broken. A new banner type would silently have been
   * counted as something else. Typed state cannot drift from its label.
   */
  banner = '';
  bannerSub = '';
  bannerAge = 99;
  bannerKind: BannerKind = 'wave';

  /**
   * Set by the host when it keeps a cross-run record; see the fusion banner.
   *
   * A hook rather than an import because the saved set lives behind
   * `localStorage`, which a headless run does not have and should not need.
   */
  isFirstDiscovery: ((id: string) => boolean) | undefined = undefined;

  announce(text: string, sub = '', kind: BannerKind = 'wave'): void {
    this.banner = text;
    this.bannerSub = sub;
    this.bannerAge = 0;
    this.bannerKind = kind;
  }

  shock(x: number, y: number, radius: number, strength: number): void {
    // Bounded so a pathological frame cannot grow this without limit.
    if (this.shocks.length < 64) this.shocks.push({ x, y, radius, strength });
  }

  constructor(seed = Date.now() & 0xffffffff) {
    this.rng = new Rng(seed);
    this.progression = prog.createProgression(seed);
  }

  /* ---------------------------------------------------------------------- *
   * Progression, read and acted on from outside
   * ---------------------------------------------------------------------- */

  /** The open level-up offer, or null. The HUD renders this. */
  get offer(): prog.Offer | null {
    return this.progression.offer;
  }

  /** True while an offer is open and the world is stopped. */
  get choosing(): boolean {
    return prog.isChoosing(this.progression);
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  /**
   * The opener this run was started with. See `prog.STARTERS`.
   *
   * Held on the world rather than passed to `start()` because `start()` is
   * also the retry path — a player who picked ECHOES and died should get
   * ECHOES again on AGAIN, not silently be handed the default back.
   */
  starter: string | undefined = undefined;

  start(): void {
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.time = 0;
    this.waveIndex = 0;
    this.enemies = [];
    this.drops = [];
    this.playerBullets.clear();
    this.particles.clear();
    // The middle of the arena, not the bottom of the screen. There is no
    // "behind you" any more, so there is no safe edge to start against.
    this.player.reset(this.width / 2, this.height / 2);
    this.camera.reset();
    this.shocks.length = 0;
    this.novas.length = 0;
    this.summonsActive = false;
    this.summonsLive = 0;
    this.notes.length = 0;
    this.wells.length = 0;
    this.effects.length = 0;
    for (const k of Object.keys(this.instrumentTimers)) delete this.instrumentTimers[k];
    for (const k of Object.keys(this.shotCount)) delete this.shotCount[k];
    this.trailSince = 0;
    this.stillTime = 0;
    /*
     * The second axis' state, all of it, because the retry button is this same
     * call: a rest still running, a lane still muted or a corpse still banked
     * from the previous run would all survive into the next one, and the muted
     * lane would survive VISIBLY — a fresh run opening with a hole in the mix.
     */
    this.lastVolleyBeat = 0;
    this.dragRadius = 0;
    this.dragDepth = 0;
    this.dragSelf = 1;
    this.dragDeepens = false;
    this.dragPulseAt = 0;
    this.hasCorpse = false;
    this.counterpointAt = 0;
    this.restUntil = -1;
    this.restSweep = null;
    this.tacetQuiet = false;
    this.tacetBars = 0;
    this.tacetBank = 0;
    this.tacetRota = 0;
    this.tacetLanes.length = 0;
    this.snapshot.tacetStems.length = 0;
    this.counterpointCopies = 0;
    this.ghostsRaised = 0;
    this.tacetDischarges = 0;
    this.dragsApplied = 0;
    for (const k of Object.keys(this.beatFires) as (keyof typeof this.beatFires)[]) this.beatFires[k] = 0;
    for (const k of Object.keys(this.ruleFires) as (keyof typeof this.ruleFires)[]) this.ruleFires[k] = 0;
    for (const k of Object.keys(this.ruleChances) as (keyof typeof this.ruleChances)[]) this.ruleChances[k] = 0;
    /*
     * THE PROPERTY SUBSTRATE, RESET WHOLE.
     *
     * The interned table is cleared rather than kept across runs, for two
     * reasons and the second one is the load-bearing half. First, a bolt still
     * holding a slot index from the previous run would be pointing at whatever
     * inherited it — and `playerBullets.clear()` above makes that impossible,
     * which is why this is safe rather than merely tidy. Second, a session
     * that plays fifty runs would otherwise walk the 256-slot table into its
     * cap and start silently handing out the empty set, which is exactly the
     * "type-checks, renders, does nothing" failure this file is a museum of.
     */
    this.propSets.length = 1;
    this.propOwners.length = 1;
    this.propIndex.clear();
    this.accelBySrc.fill(0);
    this.activeProp = 0;
    this.propOverflow = 0;
    for (const k of Object.keys(this.burstAt)) delete this.burstAt[k];
    for (const k of Object.keys(this.propMoments) as (keyof typeof this.propMoments)[]) {
      this.propMoments[k] = 0;
    }
    this.blindedAttacks = 0;
    for (const k of PROPERTY_NAMES) {
      this.propFires[k] = 0;
      this.propChances[k] = 0;
      this.propTicks[k] = 0;
      this.propDamage[k] = 0;
    }
    // In place, never reassigned: see the field's comment, and the
    // `everypowerup` entry in tools/README.md for the bug that taught us.
    prog.resetProgression(this.progression, this.rng.next() * 0xffffffff, this.starter);
    this.mods = prog.modifiers(this.progression);
    this.rules = prog.rules(this.progression);
    this.gapAngle = this.rng.range(0, TAU);
    this.nearestThreat = 1;
    this.encirclement = 0;
    this.popups.length = 0;
    this.encoresThisWave = 0;
    this.nextExtend = 40000;
    this.idleAnchorX = this.player.x;
    this.idleAnchorY = this.player.y;
    this.idleTime = 0;
    this.secsSinceDrop = 0;
    this.lastOverdriveDrop = -OVERDRIVE_MIN_GAP;
    this.lastOfferClosed = -OFFER_MIN_GAP;
    this.wasChoosing = false;
    this.introduced.clear();
    this.totals.notes = 0;
    this.totals.bestMultiplier = 1;
    this.totals.flawless = 0;
    this.totals.wavesCleared = 0;
    this.totals.grazes = 0;
    this.transport.reset();
    this.transport.start();
    this.warpedBeat = 0;
    this.lastBeat = 0;
    this.boss = null;
    this.phase = 'idle';
    /*
     * Four bars of runway, not six.
     *
     * The intro holds for its full eight bars regardless — the director no
     * longer lets a wave start interrupt it — so this only decides how much of
     * the opening the player spends with nothing to do. Six bars measured as
     * 11.5 seconds of empty screen between pressing START and the first enemy,
     * which is a long time to be asked to wait by a game you have just decided
     * to try. Four still gives the arrangement half a phrase to assemble in,
     * and the last four bars of the intro now have a fight over them.
     */
    /*
     * Two bars, not four, and the argument for four is preserved rather than
     * discarded.
     *
     * This has come down twice. Eight bars was 11.5 seconds of empty screen
     * between pressing START and the first enemy; four was the fix, on the
     * grounds that the arrangement needs half a phrase to assemble in. Both
     * true. But `tools/firstminute.mjs` measures the result at 7.3s to the
     * first enemy and 8.1s to the first kill, and a survivors-like is judged
     * inside its first ninety seconds — spending a twelfth of that window
     * looking at an empty arena is the most expensive real estate in the game.
     *
     * The musical objection is answered by what the intro actually does rather
     * than by shortening it further and hoping. The comment this replaces
     * already noted that "the last four bars of the intro now have a fight over
     * them" — the arrangement is NOT gated on the field being empty, it is
     * gated on the transport, which starts at the same moment either way. Two
     * bars still gives the intro section its own uncontested opening, and the
     * remainder of the phrase assembles over a fight, which is what it was
     * already doing for the back half.
     *
     * MEASURED, and it does cost something. `firstminute` reports the first
     * enemy at 7.3s -> 3.5s and the first kill at 8.1s -> 4.7s, with the layer
     * count unchanged at 10-11. But the section list in the opening minute goes
     * from six to five: `breakdown` is no longer reached, consistently, across
     * repeated runs. That is not noise and it is not free — the player fights
     * sooner, so the director is driven harder and the run does not pass
     * through its quietest section inside the first minute.
     *
     * Taken anyway, and the trade is worth stating rather than burying. Five
     * distinct sections inside sixty seconds is still a great deal of musical
     * movement, and the four seconds bought back are the four the player spends
     * deciding whether the game is worth continuing. If `breakdown` in the
     * opening turns out to matter, the fix is in the director's section
     * scheduling and not here: putting the empty screen back would be paying
     * for it in the wrong currency.
     */
    this.phaseTimer = 2 * BEATS_PER_BAR * (60 / 128);
    this.bus.emit('run:start', { seed: 0 });
  }

  private beginWave(index: number): void {
    /*
     * The free wave-opening powerup is now the SECOND wave and the boss waves,
     * not every wave.
     *
     * "Open every wave with something in hand" plus a guaranteed drop every few
     * kills plus three more from every boss meant the player was never without
     * a loadout by construction — a full loadout was the resting state and a
     * pickup could not feel like anything, because there was no state for it to
     * be a change from. A stretch at baseline is what makes the next drop
     * matter, and the same argument holds for the music: the `power` lane needs
     * somewhere to come in from.
     *
     * Wave 2 keeps its gift because a first powerup has to arrive early enough
     * to teach what powerups are (tools/firstminute.mjs gates it at 45s), and
     * boss waves keep theirs because the escort before a boss exists to let the
     * player top up first — waves.ts says so in as many words.
     */
    this.waveIndex = index;
    this.plan = planWave(index);
    if (index === 1 || this.plan.isBoss) {
      // Near the ship rather than at the top of the screen. `y: 70` was the
      // player's own half of a vertical field; in the round it is a corner.
      this.drops.push({
        x: clamp(this.player.x + this.rng.range(-90, 90), 60, this.width - 60),
        y: clamp(this.player.y - 130, 60, this.height - 60),
        vx: 0,
        vy: 0,
        kind: this.rollDrop().kind,
        age: 0,
        alive: true,
      });
    }
    this.waveBeatBias = 0;
    this.movement = this.plan.isBoss ? null : this.movementFor(index);
    this.waveHasLunger = false;
    /*
     * The movement banner is DEFERRED to the end of this method, not dropped.
     *
     * It used to fire here and was then overwritten by the `WAVE N` announce
     * forty lines below, which runs unconditionally for every wave after the
     * first. Measured over three runs: movements were active for thousands of
     * frames and FLANKED, SOLOIST and HUSHED appeared in the banner log zero
     * times. Three named mechanics, each with a written line, announced every
     * time and seen never.
     */
    this.entryCursor = 0;
    // Snap the wave's clock to the next bar line.
    //
    // Spawn times are already expressed in beats, but they were measured from
    // whatever instant the wave happened to begin — so a group scheduled for
    // "beat 8" landed 8 beats after an arbitrary moment, i.e. nowhere musical.
    // Anchoring to the grid means every group arrives on a downbeat, and the
    // whole stage reads as choreographed to the track rather than merely
    // accompanied by it.
    this.waveStartBeat = Math.ceil(this.transport.beat / BEATS_PER_BAR) * BEATS_PER_BAR;
    this.bossTelegraphed = false;
    this.encoresThisWave = 0;
    this.waveDamage = 0;
    this.wavePeakCombo = 0;
    this.waveComboBase = this.combo;
    this.phase = 'spawning';
    this.bus.emit('wave:start', { index, difficulty: this.plan.difficulty });
    if (index > 0) {
      /*
       * ONE banner, and the movement wins when there is one.
       *
       * `WAVE 5` is already on the panel permanently — the banner spending
       * itself on a number the player can read at any time, while suppressing
       * the one thing about this wave that is different, was the wrong way
       * round. A boss has no movement (`movementFor` is skipped for one), so
       * BOSS INCOMING is never the loser here.
       */
      const move = this.movement;
      if (move) {
        const label = { flank: 'FLANKED', elite: 'SOLOIST', hush: 'HUSHED' }[move];
        const sub = {
          flank: 'THEY COME FROM THE WINGS',
          elite: 'ONE, WORTH THE WHOLE SECTION',
          hush: 'NO FIRE — BUT THEY PRESS CLOSER',
        }[move];
        this.announce(label, sub, 'wave');
      } else {
        this.announce(
          this.plan.isBoss ? 'BOSS INCOMING' : `WAVE ${index + 1}`,
          '',
          this.plan.isBoss ? 'boss' : 'wave',
        );
      }
    }
  }

  private context(): EnemyContext {
    return {
      playerX: this.player.x,
      playerY: this.player.y,
      playerVX: this.player.vx,
      playerVY: this.player.vy,
      width: this.width,
      height: this.height,
      difficulty: this.plan.difficulty,
      beat: this.warpedBeat,
    };
  }

  // -------------------------------------------------------------------------
  // main step
  // -------------------------------------------------------------------------

  /*
   * Previous-step state and this-step edge for the level-triggered inputs.
   *
   * Two objects rather than one so the read site says `this.edge.well` and
   * cannot accidentally read the held value: the whole defect being fixed is a
   * consumer treating a level as an edge, and a single object with both would
   * put the wrong field one keystroke away from the right one.
   */
  /** Bodies moved back to the ring because the player outran them. Diagnostic. */
  recycled = 0;
  /** Set on the step the player asks for their banked offers. See `update`. */
  private offerEdge = false;
  /*
   * True while the player is working through the offers they asked for.
   *
   * Reported from play: "pressing space bar only let you pick one powerup
   * instead of all of them." The original ask was to "pull up level ups that
   * happened over time so user can select all at once", and one-press-one-offer
   * is not that -- banking four levels and then pressing space four times is
   * the same four interruptions, just moved.
   *
   * So the press opens a SESSION rather than an offer. While it lasts, closing
   * one offer immediately opens the next, and it ends when the queue is empty.
   * The player asks once and deals with the whole backlog in one sitting, which
   * is what "all at once" means when each still needs its own choice.
   */
  private offerSession = false;
  private heldOpenOffers = false;
  private readonly held = { well: false, reroll: false, banish: false };
  private readonly edge = { well: false, reroll: false, banish: false };

  update(
    dt: number,
    input: {
      x: number;
      y: number;
      shoot: boolean;
      focus: boolean;
      bomb: boolean;
      well: boolean;
      choice?: number;
      banish?: number;
      reroll?: boolean;
      skip?: boolean;
      /*
       * "Show me the level-ups I have banked." Space, in the shipping game.
       *
       * OPTIONAL, AND `undefined` MEANS THE OLD BEHAVIOUR ON PURPOSE. `World`
       * is driven by roughly forty headless tools, every one of which builds
       * its own input literal and answers offers through `choice`. If banked
       * offers only ever opened on an explicit request, all forty would sit at
       * level 1 for twenty simulated minutes and every balance number in the
       * repo would quietly become meaningless.
       *
       * So: a caller that does not know about this field gets offers opened for
       * it on the bar line, exactly as before, and `main.ts` — which does know
       * — always passes a boolean and therefore always gets the banked
       * behaviour. The distinction is "did the caller opt in", not "is the flag
       * true", which is why the check below is `=== undefined` rather than a
       * truthiness test.
       */
      openOffers?: boolean;
      /*
       * "Just pick for me." A settings toggle, off by default.
       *
       * The owner asked for "a toggle in settings to make selections completely
       * random if user wants that way no menu ever needing to pull up". This is
       * that: while it is on, a banked level resolves itself the instant it is
       * earned and the card screen never appears at all.
       *
       * It deliberately does NOT go through `openOfferNow`. Opening an offer
       * and answering it on the next step would flash the overlay for a frame
       * and fire `level:offer`, which the HUD, the sound and `offerchurn` all
       * key on -- the promise is "no menu ever needing to pull up", so no offer
       * is ever emitted. See `autoPickOffer`.
       */
      autoPick?: boolean;
    },
  ): void {
    if (this.frozen) return;

    /*
     * Latch the level-triggered inputs into edges, once, at the top.
     *
     * `Input.sample()` now drains its own edge set, so a real keyboard, touch
     * or pad press yields `well === true` on exactly one step and the shipping
     * game is already correct without this. But `World.update` is a public API
     * taking a plain object, and THREE callers hold these fields true on every
     * step for as long as they want the action: `main.ts`'s dev-only
     * `__botInput` override, which bypasses `Input` entirely,
     * `tools/lib/driver.mjs`, and `tools/decisions.mjs` / `tools/arena.mjs`.
     *
     * Measured on the real `World` at seed 0x51ed with one field held true
     * across the two sim steps of a 60Hz frame: rerolls 3 -> 1 and banishes
     * 2 -> 0. Neither closes the offer, so both double-spent. `choice` and
     * `skip` happened to be protected because they do close it — which is
     * exactly the kind of accidental correctness that stops being true the day
     * someone reorders the branches.
     *
     * The bots are worse than the frame multiple suggests: they set `well` true
     * on every step where danger is high, so a held field spends a well per
     * step at 120Hz. Every arena / decisions / brain / builds number involving
     * wells was therefore measured against a player who can do something no
     * human can. Fixing the measurement before moving the measured is the same
     * rule Stage 0b was landed under, which is why this goes in now rather than
     * after the density work.
     *
     * ABOVE the hitstop return, deliberately. `update` bails out at
     * `simDt <= 0` a few lines down, and a latch updated below that would keep
     * a stale `true` across the whole freeze and then refuse the first genuine
     * press after it. It also must not sit inside the `phase !== 'over'` guard
     * for the same reason -- it would go stale on death.
     */
    this.edge.well = input.well === true && !this.held.well;
    this.held.well = input.well === true;
    this.edge.reroll = input.reroll === true && !this.held.reroll;
    this.held.reroll = input.reroll === true;
    // Same latch as the rest: a held key must open one offer, not one per step.
    this.offerEdge = input.openOffers === true && !this.heldOpenOffers;
    this.heldOpenOffers = input.openOffers === true;
    const banishing = input.banish !== undefined && input.banish >= 0;
    this.edge.banish = banishing && !this.held.banish;
    this.held.banish = banishing;

    // Hitstop freezes the simulation but never the transport: the music must
    // keep time through an explosion or the whole illusion falls apart.
    this.transport.advance(dt);
    this.camera.update(dt);
    /*
     * The camera tracks the ship.
     *
     * This was a no-op for two stages — `PLAYFIELD_*` and `VIEW_*` were the
     * same numbers, so `follow`'s clamp had the range [0, 0] — and it was
     * called anyway rather than left dormant, because an uncalled `follow()`
     * is an unproven `follow()`. `tools/arena.mjs` was bit-identical with this
     * line present, which is what proved the camera is strictly downstream of
     * the simulation and can never feed back into it.
     *
     * It moves now. The one place the view is allowed to reach back into the
     * world is `spawnRing()`, which is deliberate and is the entire point of
     * the stage: groups arrive around the player rather than around the
     * middle of a 3000px arena the player may be nowhere near.
     *
     * On the RAW dt, not `simDt`. A camera that stops moving during hitstop
     * would jerk on every impact, and hitstop is meant to be felt in the world
     * rather than in the viewport.
     */
    this.camera.follow(this.player.x, this.player.y, dt);
    let simDt = this.camera.consumeHitstop(dt);
    if (simDt <= 0) return;

    /*
     * The level-up offer. Opened on a bar line, and the world STOPS.
     *
     * It used to dilate to 12% instead, for a reason that was real and is
     * still real: `repl.stop()` rewinds Strudel's cycle counters by a measured
     * four bars, and every emitter on this field schedules against the
     * transport's ABSOLUTE beat. Stopping the music desynchronises the stage
     * from the track it is choreographed to, and stopping only the world while
     * the music runs on leaves every emitter overdue — the player would read
     * their cards in peace and then resume into every volley on the field
     * firing at once.
     *
     * So neither clock is lied to. The transport keeps running (it is advanced
     * above, before any of this, and the music never slows), and the emitters
     * are pushed forward by exactly the beats that pass while the world is
     * held. Their schedule RELATIVE to each other and to the bar survives
     * intact; what changes is only that the stage owes those beats to a player
     * who was not playing. `Emitter.delayBy` exists for this and is already
     * used a few lines below to correct drift.
     *
     * Dilation was the right call while it stood, and the case against it is
     * simply that 12% is not zero: four cards is a real decision, and the
     * arena keeps moving underneath one at a speed that still punishes reading
     * them. A choice the game asks you to make should not also be a thing the
     * game is doing to you.
     *
     * Opening on a bar line rather than on the instant of the level-up is the
     * musical half: this is the one moment in a run where the player is looking
     * at the arrangement instead of the bullets, so it is the one moment the
     * music gets to hold still, and a fermata that begins mid-bar is not a
     * fermata.
     *
     * This used to say "`openOffer` is idempotent, so calling it on every bar
     * line while one is already open costs nothing." That was false and it cost
     * a real complaint: idempotent in STATE is not idempotent in EFFECTS, and
     * re-calling it re-emitted the offer and re-fired the banner and the sting
     * every 1.875 seconds while the player was reading their cards. The guard
     * now lives at the top of `openOfferNow`; see the note there.
     */
    /*
     * BANKED, NOT INTERRUPTING. Reported from play: "level up screen pops up
     * too often, space bar to pull up level ups that happened over time so user
     * can select all at once".
     *
     * `pending` was already a queue rather than a boolean — progression.ts says
     * so in as many words — but the world drained it on the next bar line every
     * time, so a run that levelled three times in ten seconds stopped the game
     * three times. The queue existed and nothing was allowed to sit in it.
     *
     * Now it sits until asked for. `openOffers` is the request; the HUD shows
     * how many are waiting. A caller that predates the field (every tool in
     * tools/) is opted out and keeps the bar-line behaviour, see the field's
     * own note.
     */
    /*
     * Auto-pick drains the queue before anything else looks at it, so the rest
     * of the offer machinery below simply never sees a pending level.
     */
    if (input.autoPick && this.phase !== 'over') {
      let guard = 0;
      while (this.progression.pending > 0 && !prog.isChoosing(this.progression) && guard++ < 8) {
        if (!this.autoPickOffer()) break;
      }
    }
    if (this.offerEdge) this.offerSession = true;
    // The session ends when there is nothing left to spend, not when the key
    // is released -- otherwise a tap would open one and abandon the rest.
    if (this.progression.pending <= 0 && !prog.isChoosing(this.progression)) this.offerSession = false;
    const wants =
      input.openOffers === undefined
        ? this.transport.crossedBar()
        : this.offerEdge || (this.offerSession && this.progression.pending > 0);
    if (this.phase !== 'over' && wants) this.openOfferNow();
    this.applyOfferInput(input);
    if (prog.isChoosing(this.progression)) {
      /*
       * The band picks for you if you do not — but far later than it used to.
       *
       * A world that can be frozen forever by an input it never receives is
       * the world's problem rather than the harness's, so the backstop stays:
       * card 0 is a legal pick in every state the offer generator can produce,
       * so it can never leave a level unspent. Every harness in `tools/`
       * answers offers, so in practice nothing reaches this.
       *
       * The timeout went from 12s to 45s because the world now STOPS. Twelve
       * seconds was generous against a stage still moving at 12%; against a
       * true pause it is a hidden clock on a screen that looks like it has
       * none, which is the pressure this change exists to remove. 45s is past
       * deliberating and into walked-away.
       */
      this.offerAge += dt;
      if (this.offerAge > OFFER_TIMEOUT) this.chooseOffer(0);
      /*
       * Hold the beat-scheduled stage in place. Without this the transport
       * runs on while the world does not, and every emitter comes due at once
       * the moment play resumes.
       */
      const heldBeats = this.transport.lastStep;
      if (heldBeats > 0) {
        // Every scheduled lunge is pushed forward by exactly the beats the
        // pause costs it. Same contract `Emitter.delayBy` had; one line now,
        // because there is one clock per body instead of one per emitter.
        for (const e of this.enemies) if (e.lungeBeat >= 0) e.lungeBeat += heldBeats;
      }
      simDt = 0;
    } else {
      /*
       * Stamp the close on the TRANSITION rather than in each handler.
       *
       * An offer can close three ways — a pick, a skip, and the walk-away
       * timeout — and setting the timestamp in each would be three chances to
       * miss one. Watching `isChoosing` go false catches all of them, now and
       * whenever a fourth is added.
       */
      if (this.wasChoosing) this.lastOfferClosed = this.time;
      this.offerAge = 0;
    }
    this.wasChoosing = prog.isChoosing(this.progression);

    this.time += simDt;

    // One fold of the rig per step, shared by the player, every firing routine
    // and the enemy clock.
    this.mods = prog.modifiers(this.progression);
    this.rules = prog.rules(this.progression);
    this.applyRigHealth();

    if (this.phase !== 'over') {
      const expired = this.player.update(
        simDt,
        input,
        { w: this.width, h: this.height },
        this.mods.moveSpeed,
      );
      for (const kind of expired) this.bus.emit('powerup:expire', { kind });

      if (input.bomb && this.player.bombs > 0 && this.player.invuln <= 0) this.detonateBomb();
      /*
       * Black holes are placed, not spent on pickup.
       *
       * The charge now comes from the BLACK HOLE instrument rather than from a
       * drop, and it is the one instrument with a manual verb. The rule is not
       * a special case for one id: a field that SWALLOWS bullets hands you a
       * charge, and a field that only burns drops itself. Turning a screen of
       * bullets into a payday is a decision about timing and deserves an input;
       * a damage pool is not, and asking the player to aim one every second
       * would be busywork.
       */
      if (this.edge.well && this.player.wells > 0) {
        this.player.wells--;
        this.throwWell();
      }
    }

    /*
     * Camping pressure. See the field comment on `idleAnchorX` for why this
     * exists at all. The anchor is where the ship last actually repositioned;
     * drifting inside `IDLE_RESET_DIST` of it — including the small slide
     * `player.ts` deliberately leaves after releasing the stick — does not
     * count as moving. `IDLE_GRACE_S` alone is bought back on any real move, so
     * this can never bind on a player who is dodging, only on one who has
     * stopped.
     */
    {
      const dx = this.player.x - this.idleAnchorX;
      const dy = this.player.y - this.idleAnchorY;
      if (dx * dx + dy * dy > World.IDLE_RESET_DIST * World.IDLE_RESET_DIST) {
        this.idleAnchorX = this.player.x;
        this.idleAnchorY = this.player.y;
        this.idleTime = 0;
      } else if (this.phase !== 'over') {
        this.idleTime += simDt;
      }
    }
    const campPressure = clamp01((this.idleTime - World.IDLE_GRACE_S) / World.IDLE_RAMP_S);
    this.snapshot.campPressure = campPressure;

    /*
     * UP-TEMPO FIRES HERE, on DISTANCE TRAVELLED and not on a clock.
     *
     * That is the whole design of the item: a parked ship lays nothing, so the
     * trail is the one thing in the rig that pays you for the behaviour
     * `campPressure` above is trying to buy. It is also the pole opposite
     * FERMATA, which pays for exactly the opposite behaviour — a rig carrying
     * both is carrying a contradiction, and a rig carrying one is a build.
     *
     * THE DROP IS A `novas[]` RING, NOT A `wells[]` POOL, and the reason is
     * visibility: nothing in `Renderer` reads `World.wells`, so BLACK HOLE and
     * TREMOLO FIELD are invisible today and a trail built on them would be a
     * rule the player could not see or play around. A ring with a small `maxR`
     * and `speed = maxR / life` grows and fades over its whole life, which
     * `drawNovas` already draws and `updateNova` already collides — and for a
     * radius this small the damaging annulus (±16px) is effectively the disc.
     *
     * `clears: false`, unlike COMPRESSOR's ring: six bullet-cancelling rings a
     * second following the ship around would be the strongest defensive item in
     * the game bought by holding a direction. It burns; it does not sweep.
     *
     * WORST CASE IS BOUNDED BY ARITHMETIC, NOT BY A CAP, and the arithmetic is
     * `life / (every / topSpeed)`: at L3 that is 1.2s / (60px / 520px/s) = 11
     * rings alive, against a `novas.length` that `deadhunt-ranges` already
     * measures at a mean of 29 and a peak of 310 from the auras alone. A cap
     * would have to either scan the array to count its own rings — 310 entries,
     * six times a second, to guard 11 — or key on `hue`, which `hueOf` also
     * assigns and could collide with. The `TRAIL_CEILING` below is the cheap
     * version: one length check, and it only bites in an aura storm, where the
     * trail is the least of what is on screen.
     */
    {
      /*
       * One read of the ship's speed, feeding both poles of the pair: UP-TEMPO
       * pays for having it and FERMATA pays for not. The denominators are
       * counted whether or not either passive is held, so a zero fire count can
       * be told apart from a run that never moved or never stopped.
       */
      const speed = Math.hypot(this.player.vx, this.player.vy);
      const alive = this.phase !== 'over' && !this.player.dead;
      if (speed > 0 && alive) this.ruleChances.trail++;
      if (speed < World.STILL_SPEED && alive) this.stillTime += simDt;
      else this.stillTime = 0;
    }
    if (this.rules.trailDamage > 0 && this.phase !== 'over' && !this.player.dead) {
      this.trailSince += Math.hypot(this.player.vx, this.player.vy) * simDt;
      if (this.trailSince >= Math.max(20, this.rules.trailEvery) && this.novas.length < World.TRAIL_CEILING) {
        this.trailSince = 0;
        const maxR = Math.max(12, this.rules.trailRadius);
        const life = Math.max(0.2, this.rules.trailLife);
        this.novas.push({
          x: this.player.x,
          y: this.player.y,
          r: 0,
          alive: true,
          maxR,
          speed: maxR / life,
          // Same division `fireAura` makes: the number in the table is what a
          // target standing in the drop takes, not a rate.
          dps: this.rules.trailDamage / life,
          hold: 0,
          hue: World.TRAIL_HUE,
          shoves: false,
          prop: 0,
          tick: 0,
        });
        this.ruleFires.trail++;
      }
    }

    /*
     * TIMEWARP IS LOCAL NOW, AND THE THREE SCALES BELOW ARE WHAT THAT COST.
     *
     * This used to read `const warp = this.mods.enemyTime`, applied to all
     * three of bullet travel, emitter rate and enemy movement — a whole-room
     * slow. `Rules.slowRadius` moves it into a bubble around the ship, applied
     * per enemy inside `updateEnemies`, because a number that is true
     * everywhere is a number there is nothing to do about; a bubble is a place
     * you can stand.
     *
     * So the global warp is 1 and TIMEWARP no longer slows enemy BULLETS or the
     * emitter grid. State the loss plainly: the item is weaker against fire and
     * stronger against bodies, on purpose.
     *
     * The three variables STAY. `warpedBeat` exists so the emitters can be
     * warped without drifting off the transport, and a global time warp is a
     * thing this game will want again — a boss phase, a powerup, a second rig
     * item. Deleting the seam and re-deriving it later is more expensive than a
     * multiply by 1, which is the same argument `rigModifiers` makes for two
     * floors that cannot bite. Do not read `= 1` as "this can never move".
     */
    const warp = 1;
    /*
     * Camping speeds the BODIES up, never the beat grid they schedule against.
     *
     * This used to be `bulletScale`, applied to enemy bullet travel only, with
     * a note that the emitters and the enemies carrying them were deliberately
     * left alone because both were "locked to the beat grid TIMEWARP already
     * has to protect". Half of that survives exactly: the lunge SCHEDULE is
     * still on the unwarped grid, and stretching it for an unrelated reason
     * would still be the two-hands-tightening-at-once this file's TIMEWARP note
     * warns about. What changes is that the only quantity left to speed up is
     * movement, so the camp penalty lands there.
     */
    const fireScale = warp;
    const moveScale = warp * (1 + campPressure * World.CAMP_CLOSE_BOOST);

    // The lunge clock is driven by the transport's absolute position, warped by
    // timewarp rather than rescaled per-step, so it can never drift off it.
    this.warpedBeat += (this.transport.beat - this.lastBeat) * fireScale;
    this.lastBeat = this.transport.beat;
    /*
     * Where the arrangement is, for the two items that ask.
     *
     * A no-op the moment `main.ts` has pushed a real readout; see the `musical`
     * field for why the stand-in exists and why it is calibrated against
     * `tools/sections.mjs` rather than invented.
     */
    this.freeRunMusic();
    this.updateEnemies(simDt, this.warpedBeat, moveScale);
    // RITARDANDO's third rung. Guarded so the ordinary loadout pays one boolean
    // and not a walk of the enemy pool looking for a flag nothing set.
    this.updateWave(simDt);
    /*
     * BULLETS LIVE AND BOUNCE AGAINST THE VIEW, NOT THE FIELD, AND THAT IS
     * WHAT KEEPS STAGE 5 FROM CHANGING THEM AT ALL.
     *
     * Both rectangles below used to be `this.width/this.height`, which was the
     * same rectangle as the view for the whole life of the project. Leaving
     * them on the field when it grew to 3000x3000 was measured and was a real
     * regression in two separate ways:
     *
     *   Player bolts flew 3000px instead of 900 before being culled, so the
     *   ship killed things it could not see — and the shard each of those
     *   drops was then abandoned, because the pickup pull is 210px. Measured
     *   over three 8-minute runs: kills went UP and shards collected per kill
     *   fell 6.05/6.34 to 3.82/4.40, dragging level-at-20-minutes from 69.3 to
     *   61.0. More kills, less progress.
     *
     *   Enemy bullets accumulated off screen: alive p90 39.7 -> 73.3 and peak
     *   148 -> 230, while the number ON SCREEN did not move (33.3 -> 32.3).
     *   Every one of those extra bullets is invisible, unhittable and cannot
     *   reach a player who is by definition inside the view.
     *
     * Against the view, both numbers return to exactly what they were at one
     * screen, because at one screen the view WAS the field. This is not a
     * retune; it is the same rectangle, correctly identified.
     *
     * Player bullets are culled on all four edges by the same margin. It used
     * to be `-40, -80, +40, +40` — a deeper margin at the top, because that was
     * the only direction the ship fired and shots needed room to reach an enemy
     * that had not finished entering. Firing in the round makes the asymmetry
     * meaningless, and leaving it in would make shots aimed north outrange
     * shots aimed south by 40px.
     *
     * The player pool gets a wall rectangle; the enemy pool does not. That is
     * what makes `InstrumentStats.bounces` a behaviour instead of a number in a
     * table. It was declared, folded through `applyModifiers`, set by ECHO
     * CHAMBER and raised three times across its ladder, set by SPICCATO and
     * CANON — and read by nothing at all, so "bolts that come back off the
     * walls" was a blurb describing a shot that left the arena and was culled.
     * The rectangle is deliberately NOT the cull bounds passed alongside it: a
     * bounce has to land on the wall the player can see, and on a field eleven
     * times the size of the screen the only wall that satisfies that sentence
     * is the edge of the view. See `BulletPool.update` for why the reflection
     * is done in angle space.
     */
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    this.playerBullets.update(
      simDt,
      vx - 60,
      vy - 60,
      vx + this.viewW + 60,
      vy + this.viewH + 60,
      { l: vx, t: vy, r: vx + this.viewW, b: vy + this.viewH },
      // ACCELERANDO: the per-property-set speed gain applied at every wall.
      this.accelBySrc,
    );
    // The threat picture the aim and the music both read. Computed before
    // firing so a shot is aimed at where things are this step, not last step.
    this.analyseEncirclement();
    this.computeAim();
    if (this.phase !== 'over' && !this.player.dead) this.fireInstruments(simDt);
    /*
     * Gated on the RULES that can produce a seeking bolt rather than on a live
     * scan of the pool, so the ordinary loadout pays one comparison and not a
     * walk of 700 bullets looking for a flag nothing set.
     */
    if (this.rules.overchargeEvery > 0 || this.rules.killEcho > 0) this.steerPlayerBullets(simDt);
    this.updateEffects(simDt);

    this.bannerAge += simDt;
    /*
     * Simulation seconds. TIMEWARP no longer slows these — it is applied to the
     * enemy clock rather than to `simDt` — so the drop guarantee still means
     * what it says when the field is slowed, which was the whole reason this
     * budget was moved from kills to seconds.
     *
     * A level-up offer STOPS it, because the offer zeroes `simDt` itself.
     * That is correct rather than a leak: the offer is a pause in everything
     * except the transport, and a pity timer that kept counting through it
     * would hand out a drop for reading four cards slowly.
     */
    this.secsSinceDrop += simDt;

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const pop = this.popups[i];
      pop.age += simDt;
      pop.y -= (pop.big ? 34 : 24) * simDt;
      if (pop.age > 0.95) this.popups.splice(i, 1);
    }

    this.updateWells(simDt);
    // Before `updateNova`, so a shell that lands this step gets its blast ring
    // advanced on the same step rather than sitting at r=0 for a frame.
    if (this.summonsActive) this.updateSummons(simDt);
    // Before `updateNova`, so the sweep the band comes back with is advanced on
    // the step it is pushed rather than sitting at r=0 for a frame.
    this.updateRest();
    this.updateNova(simDt);
    this.updateNotes(simDt);
    this.particles.update(simDt);
    this.collidePlayerBullets();
    // One pass, not two: contact damage, the graze annulus and the threat
    // signals all read the same list now. See `collidePlayer`.
    this.collidePlayer(simDt);
    this.updateDrops(simDt);

    if (this.combo > this.wavePeakCombo) this.wavePeakCombo = this.combo;
    // Likewise: the summary's BEST MULT read x1 for every run, because this
    // was set to 1 at reset and never touched again.
    if (1 + this.combo > this.totals.bestMultiplier) this.totals.bestMultiplier = 1 + this.combo;
    /*
     * The multiplier bleeds down; it does not fall off a cliff.
     *
     * A six-second timer that reset the combo to zero was fair when a kill
     * happened every five seconds. The rebalance made enemies ~2.5x tougher and
     * kills are now much further apart, so the combo spiked on each burst of
     * notes and then collapsed entirely before the next one — measured, the peak
     * multiplier was x48 while the lead's descant, which needs x9, was audible
     * for 2% of a run. A reward that exists only inside a two-second window is
     * not a reward.
     *
     * Bleeding a third at a time keeps a good run's momentum across the gaps the
     * new pacing creates, while a genuinely idle player still loses it — and
     * `combo:break` still fires, once, when it finally reaches zero.
     */
    this.comboTimer -= simDt;
    if (this.comboTimer <= 0 && this.combo > 0) {
      const next = Math.max(0, this.combo - Math.max(1, Math.ceil(this.combo / 3)));
      if (next === 0) this.bus.emit('combo:break', { was: this.combo });
      this.combo = next;
      this.comboTimer = 2.5;
    }

    this.writeSnapshot(simDt);
  }

  // -------------------------------------------------------------------------
  // enemies & waves
  // -------------------------------------------------------------------------

  private updateEnemies(dt: number, nowBeat: number, moveScale = 1): void {
    const ctx = this.context();
    /*
     * TIMEWARP's bubble, hoisted out of the loop.
     *
     * `slowRadius` is the extent and `mods.enemyTime` is the depth, and with
     * the passive absent the radius is 0 and this whole thing costs one
     * comparison per enemy. Squared so the per-enemy test is a multiply rather
     * than a `hypot` — the loop already runs at 39 enemies and this is the
     * cheapest place in it to be careless.
     */
    const slowSq = this.rules.slowRadius * this.rules.slowRadius;
    const slowTo = this.mods.enemyTime;
    /*
     * RITARDANDO's bubble, hoisted for exactly the reason TIMEWARP's is: the
     * loop already runs at 39 enemies and this is the cheapest place in it to be
     * careless. Deliberately a SECOND bubble rather than folded into the first —
     * one is a passive's rule and one is an instrument, they have different
     * radii and different depths, and a player holding both should get both.
     */
    const dragSq = this.dragRadius * this.dragRadius;
    // `dragDeepens` is RITARDANDO's L6; see its declaration.
    const dragTo = Math.max(0.05, 1 - this.dragDepth * (this.dragDeepens ? 1.5 : 1));
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.prevX = e.x;
      e.prevY = e.y;
      e.age += dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.invuln > 0) e.invuln -= dt;
      /*
       * THE STATUS TICK. One integer test for the overwhelming majority of
       * bodies, which carry nothing.
       *
       * Here rather than in a loop of its own, because this loop already walks
       * every enemy every step and a second walk would double the cache
       * traffic of the most-run loop in the game for no benefit. The measured
       * ceiling before this pass was 56 fps at 39 enemies and the arena has
       * grown since; `Enemy.status` is what keeps this affordable.
       */
      this.propMoments.enemyStep++;
      if (e.status !== 0) {
        this.tickStatus(e, dt);
        if (!e.alive) continue;
      }
      // Checked here rather than on bullet impact, so *any* damage source
      // advances the fight. Bombs and nova pulses were chipping the boss down
      // without ever triggering a phase change, which meant a player leaning on
      // them could take a boss to zero while it stayed in phase one.
      if (e.archetype === 'conductor' && markBossPhasePending(e)) {
        this.camera.shake(0.25);
        e.hitFlash = 0.3;
      }
      /*
       * A boss cannot be taken past a phase gate it has not played yet.
       *
       * The existing design already says the fight has three acts and that the
       * player "still has to live through two transitions, however much damage
       * a loaded-out player can deal" — but that was only true while damage
       * arrived in bullet-sized pieces. Measured in the arena, a late fusion
       * puts a 360-degree fan of twenty-four projectiles inside the boss's own
       * radius at point-blank and takes it from full to dead between two bar
       * lines: bosses were dying in 0.1 to 5 seconds at waves 15+, having
       * played phase one and nothing else.
       *
       * The cost of that is musical before it is mechanical. Phases are the
       * boss's three sections, `boss:phase` is what the director builds on, and
       * a set piece that resolves inside one bar is not a set piece.
       *
       * So the gate holds one hit point above the threshold until the
       * transition commits on the next bar line, at which point the clamp
       * lifts. It costs a well-armed player about two bars and takes nothing
       * away from them; a boss with a phase left is not invulnerable, it is
       * queued.
       */
      if (e.archetype === 'conductor' && e.phasePending && e.hp > 0) {
        const gate = e.phaseThresholds[e.phase] ?? 0;
        e.hp = Math.max(e.hp, e.maxHp * gate * 0.999 + 1);
      }

      /*
       * NOT WHILE THE LEVEL-UP SCREEN IS OPEN, and this is a latent bug that
       * the passive rules surfaced rather than caused.
       *
       * A boss phase commits on a bar line and `openOfferNow` opens on a bar
       * line, so the two fire in the SAME update whenever a level and a phase
       * gate come due together. `announce` overwrites, so "LEVEL 17 / CHOOSE A
       * MUSICIAN" was written and replaced by "PHASE II" before either was
       * rendered — `tools/wiring.mjs` caught it at steps 20699 and 31500 of a
       * six-minute run the moment the rules work moved the boss's damage curve.
       * It has always been reachable; nothing had happened to line the two
       * clocks up before.
       *
       * Deferring is the right answer and not just the convenient one. The
       * world is STOPPED while an offer is open (`simDt` is 0), so committing a
       * phase here spends the bullet clear, the camera strike and the 1.4s
       * invulnerability on a frame the player cannot act in, and it does it
       * under a fermata the director is holding for the card screen.
       * `crossedBar()` is a pure query and `phasePending` stays set, so the
       * phase lands on the first bar after the cards close rather than being
       * lost.
       */
      if (e.phasePending && this.transport.crossedBar() && !prog.isChoosing(this.progression)) {
        const phase = commitBossPhase(e);
        if (phase >= 0) {
          this.bus.emit('boss:phase', { phase, of: e.phases });
          this.camera.shake(0.7);
          this.camera.freeze(0.12);
          this.camera.strike(e.hue, 0.7);
          this.clearRoom();
          // A bar to breathe, and to hear the music turn over.
          e.invuln = 1.4;
          this.shock(e.x, e.y, 480, 3800);
          this.announce(`PHASE ${['I', 'II', 'III'][phase] ?? phase + 1}`, '', 'phase');
        }
      }

      if (e.age > e.leaveAt && !e.leaving) {
        e.leaving = true;
        /*
         * Leave by going away from the PLAYER, not by the bottom and not
         * radially out from the middle of the field.
         *
         * The old retreat flew +y at 190px/s, which in the round is "walk
         * across the player and out the far side" for anything that came from
         * the south. That was fixed once by heading radially outward from the
         * arena centre, which was the right gesture — give up and go — while
         * the arena centre and the player were never more than half a screen
         * apart. On a field several screens across they can be, and then an
         * enemy on the far side of the player from the centre "retreats" by
         * flying straight through them: the same defect the +y version had,
         * re-created by a frame of reference that stopped being local.
         *
         * Away-from-the-player is the version that means what the gesture says
         * from any position, and it is the only one of the three that never
         * needs revisiting when the field changes shape again.
         */
        const ax = e.x - this.player.x;
        const ay = e.y - this.player.y;
        const al = Math.hypot(ax, ay) || 1;
        e.vx = (ax / al) * 190;
        e.vy = (ay / al) * 190;
        e.move = (en, d) => {
          en.x += en.vx * d;
          en.y += en.vy * d;
        };
      }
      /*
       * TIMEWARP FIRES HERE, per enemy, in place — no listener, no event.
       *
       * Movement only. Slowing this enemy's EMITTERS as well would mean giving
       * each one its own warped beat, and `warpedBeat` is a single number
       * precisely so that emitters can never drift off the transport; a bubble
       * that stretched the beat grid for whatever happened to be standing in it
       * would put the shots off the music, which is the one thing this game
       * cannot trade away. Bodies slow, fire does not.
       */
      let scale = moveScale;
      this.ruleChances.slowed++;
      if (slowSq > 0) {
        const sdx = e.x - this.player.x;
        const sdy = e.y - this.player.y;
        if (sdx * sdx + sdy * sdy <= slowSq) {
          scale *= slowTo;
          this.ruleFires.slowed++;
        }
      }
      if (dragSq > 0) {
        const ddx = e.x - this.player.x;
        const ddy = e.y - this.player.y;
        if (ddx * ddx + ddy * ddy <= dragSq) {
          scale *= dragTo;
          this.dragsApplied++;
        }
      }
      /*
       * GLASS AND FERMATA STOP A BODY; SWELL DRAGS ONE.
       *
       * A freeze wins outright rather than stacking with a slow, because
       * "frozen and also 30% slower" is not a state anybody can picture and
       * multiplying two slows is how a 60% and a 55% become 82% by accident.
       * Movement only, for the reason TIMEWARP's note above gives at length:
       * `warpedBeat` is a single number precisely so that the lunge clock can
       * never drift off the transport, and a status that stretched the beat
       * grid for whatever happened to be carrying it would put the attacks off
       * the music. A frozen shape's LUNGE is stopped below instead, where it
       * belongs.
       */
      if (e.status & (Status.Freeze | Status.Charm)) scale = 0;
      else if (e.status & Status.Slow) scale *= 1 - e.slowFactor;

      /*
       * A FROZEN OR CHARMED BODY DOES NOT LUNGE AT YOU.
       *
       * Freeze because a hold that leaves the attack working is a slow with
       * extra steps; charm because "it fights for you" has to mean it stops
       * fighting you, and a turncoat still throwing itself at the player would
       * be the clearest possible case of prose the simulation does not deliver.
       */
      /*
       * A SHOVE OVERRIDES EVERYTHING, including a charge and a freeze.
       *
       * Ordered first because it is the one thing on this body that is being
       * done TO it: `World.repel` has already zeroed any committed lunge, and a
       * frozen body still has to be thrown when a bomb goes off next to it or
       * the knockback would silently do nothing to exactly the shapes a player
       * most wants moved.
       */
      if (e.pushTime > 0) {
        e.pushTime -= dt;
        e.x += e.pushVX * dt;
        e.y += e.pushVY * dt;
        /*
         * Coasts to a stop rather than stopping dead, so the throw reads as a
         * throw — but only just.
         *
         * The first draft used 0.0004, which halves every 89ms and turns a
         * 700px/s launch into 84px of travel. That is not a screen clear, it is
         * a flinch; the whole point of `repel` is to buy the distance a bullet
         * clear used to buy. 0.3 halves every 580ms, so a 0.35s shove at 700
         * covers about 200px — roughly 0.7s of walking back at mob speed, which
         * is what `INVULN_ON_HIT` is then sized against.
         */
        const decay = Math.pow(0.3, dt);
        e.pushVX *= decay;
        e.pushVY *= decay;
        if (!e.alive) {
          this.enemies.splice(i, 1);
          if (!e.escaped) this.onEnemyKilled(e);
          if (e === this.boss) this.boss = null;
        }
        continue;
      }

      const muted = (e.status & (Status.Freeze | Status.Charm)) !== 0;
      const lunging =
        !e.leaving && !muted && e.lunge !== null && this.hasEntered(e)
          ? this.tickLunge(e, nowBeat, dt * scale)
          : false;
      /*
       * A COMMITTED LUNGE REPLACES THE MOVER, IT DOES NOT ADD TO IT.
       *
       * Running both would let a weave or a hop steer the dash, which is
       * exactly what makes a charge unreadable: the player is asked to leave a
       * line the attacker is still free to re-aim. A lunge picks its heading at
       * the instant it commits and then holds it — that fixed line is the whole
       * of what the windup ring is promising.
       */
      if (!lunging) e.move(e, dt * scale, ctx);

      /*
       * Culled on all four edges, at a much deeper margin than it spawns at.
       *
       * The old test was "past the bottom, or well off either side", which is
       * three edges out of four and encodes the assumption that things fall
       * downward. Here everything must be able to enter from any edge and
       * still be off-field for a second while it does, which is why the cull
       * margin (320) is four and a half times the spawn margin (70) — a tight
       * one would delete a rush during the telegraph it spends outside the
       * field, and the group would simply never arrive.
       *
       * AGAINST THE FIELD, and this is the ONE rectangle in the file that
       * deliberately stayed there when the field grew. Bullets, drops, the
       * spawn ring and `hasEntered` all moved to the view; enemies did not,
       * and it was tested rather than assumed. `research-camera.md` §4
       * predicted the failure and the prediction was right — culling enemies
       * at `view ± CULL_MARGIN` deletes shapes that are alive and chasing, and
       * on a moving camera the player outruns them into the cull:
       *
       *              escaped/wave   enemies on screen p90   encirclement p90
       *   view       13.27          10.3                    0.31
       *   field       4.11          11.7                    0.33
       *   (baseline at one screen: 8.58 / 13.0 / 0.32)
       *
       * The view version was 55% ABOVE the one-screen escape rate and emptier
       * with it — it was deleting the crowd. The field version is below the
       * baseline, which means enemies that used to wander out now stay and get
       * fought, and that is the direction this workstream wants. So
       * `CULL_MARGIN` is not retuned either: shrinking it is the same move as
       * culling against the view and would land in the same place.
       */
      /*
       * RECYCLE A BODY THE PLAYER HAS LEFT BEHIND, rather than letting it
       * loiter nine hundred pixels away for the rest of the run.
       *
       * THE DEFECT THIS FIXES, measured. arena reported 117 enemies ALIVE
       * against 7.7 ON SCREEN -- roughly 93% of the population outside the
       * view. That is not a rendering curiosity, it is the difficulty curve:
       * `hasEntered` gates the lunge on being inside the view rect, correctly,
       * because a body nobody can see must not charge out of the dark. So
       * ninety-three percent of the crowd was structurally unable to attack,
       * `tickLunge` was entered 314 times in 3,600 steps where it should have
       * been entered about five times that, and it committed ZERO charges.
       *
       * The cause is geometry rather than a constant. Groups arrive on a ring
       * around the VIEW, the player then moves, and the bodies left behind are
       * still well inside a 3000x3000 field -- so the field cull below never
       * touches them and they simply accumulate. Every one is paying full
       * simulation cost to be somewhere the player will never look.
       *
       * WHY RECYCLING RATHER THAN CULLING. `research-camera.md` §4 already ran
       * the experiment: culling against `view ± CULL_MARGIN` raised escapes per
       * wave from 8.58 to 13.27 AND left the screen emptier, because it deletes
       * shapes that are alive and chasing. Vampire Survivors does the other
       * thing, and it is the right one -- a body that falls too far behind is
       * MOVED back to the ring, keeping its type, its health, its statuses and
       * its level of investment. Nothing is destroyed, so nothing is escaped
       * and the wave accounting is untouched; the crowd is simply kept where
       * the player is.
       *
       * The radius is generous on purpose. It has to sit outside the spawn ring
       * or a body would be recycled on the frame it arrives, and outside the
       * cull-relevant band so a shape crossing the view edge is not yanked
       * about. A diagonal and a half of the view is comfortably past both.
       *
       * `lungeBeat` is reset so a recycled body cannot arrive already overdue
       * and charge the instant it appears -- the same contract the offer pause
       * honours when it pushes every schedule forward by the beats it cost.
       */
      if (e.archetype !== 'conductor' && !e.leaving) {
        const rdx = e.x - this.player.x;
        const rdy = e.y - this.player.y;
        /*
         * 0.9 of the view diagonal, about 1294px.
         *
         * The first draft used 1.5, giving 2156px — and on a 3000x3000 field a
         * player near the middle is at most about 2121px from the furthest
         * corner, so the test could essentially never be true. `recycled`
         * measured 0 across a full run: a rule that reads correctly and fires
         * never, which is this repo's most-recorded defect and exactly why the
         * counter was written alongside it.
         *
         * Swept rather than picked. The view's own half-diagonal is 718px and
         * bodies arrive at 788 (that plus SPAWN_MARGIN), so anything at or
         * under about 800 would recycle a shape on the frame it spawned.
         *
         * Swept above that, and TIGHTER IS NOT BETTER, which was not obvious
         * until it was measured:
         *
         *              on-screen p90   mid-charge p90   hits taken   encircle p90
         *   0.9 (this)     41.0             6.0            19.0          0.52
         *   0.7            38.7             3.7             8.7          0.60
         *
         * 0.7 keeps the crowd nominally closer and makes the game EASIER, by
         * a factor of two in damage taken. The mechanism is in this block: a
         * recycled body has its `lungeBeat` reset so it cannot arrive already
         * overdue, so every recycle also buys that body a fresh cadence before
         * it can charge. Recycle more often and the field fills with shapes
         * that are perpetually winding up and never landing. 0.9 recycles
         * enough to keep the population local and seldom enough that a charge
         * still completes.
         */
        const recycleAt = Math.hypot(this.viewW, this.viewH) * 0.9;
        if (rdx * rdx + rdy * rdy > recycleAt * recycleAt) {
          const at = edgePoint(this.rng.range(0, TAU), this.spawnRing(), SPAWN_MARGIN);
          e.x = at.x;
          e.y = at.y;
          e.prevX = at.x;
          e.prevY = at.y;
          e.lungeBeat = -1;
          e.lungeTime = 0;
          this.recycled++;
        }
      }

      if (
        e.archetype !== 'conductor' &&
        (e.x < -CULL_MARGIN ||
          e.x > this.width + CULL_MARGIN ||
          e.y < -CULL_MARGIN ||
          e.y > this.height + CULL_MARGIN)
      ) {
        e.escaped = true;
        e.alive = false;
      }

      if (!e.alive) {
        this.enemies.splice(i, 1);
        if (!e.escaped) this.onEnemyKilled(e);
        else this.bus.emit('enemy:death', { id: e.id, archetype: e.archetype, byPlayer: false });
        if (e === this.boss) this.boss = null;
      }
    }
  }

  /**
   * THE LUNGE: one body's telegraphed charge, on the transport's beat grid.
   *
   * Returns true while the dash is committed, which is the caller's signal to
   * skip the archetype's mover for this step.
   *
   * WHAT THIS IS THE DESCENDANT OF. `Emitter.update` — the loop that turned a
   * declarative `EmitterSpec` into bullets — and it keeps the two properties of
   * that class that were load-bearing and drops everything else:
   *
   *   THE SCHEDULE IS AN ABSOLUTE BEAT. `lungeBeat` is a position on the
   *   transport, not a countdown. Emitters that accumulated their own beat
   *   count from `bpm * dt` drifted on every audio-clock correction and every
   *   frame of hitstop, and only ~55% of volleys landed on a subdivision.
   *
   *   THE FIRST ONE IS SNAPPED TO THE GRID. A body enters at whatever moment
   *   its approach takes, not on a beat, so the first schedule is quantised to
   *   the half beat. `tools/telegraph.mjs` measured that taking on-grid volleys
   *   from 49% to ~100%, which is what makes a screen of windups pulse
   *   together instead of shimmering.
   *
   * What it drops is the whole pattern vocabulary — shapes, arms, gaps, spin,
   * bursts, jitter — because a body has exactly one thing it can do to you now
   * and it does not need a grammar.
   *
   * WHY THE DASH IS A VELOCITY AND NOT A TARGET POINT. A charge that homes is
   * not dodgeable, it is a delayed hit; a charge along a line fixed at the
   * moment of commitment is a question with a visible answer, which is the same
   * argument `EmitterSpec.gap` made for leaving a wedge out of every boss ring.
   */
  private tickLunge(e: Enemy, nowBeat: number, dt: number): boolean {
    const spec = e.lunge;
    if (!spec) return false;

    if (e.lungeTime > 0) {
      e.lungeTime -= dt;
      e.x += e.lungeVX * dt;
      e.y += e.lungeVY * dt;
      return e.lungeTime > 0;
    }

    if (e.lungeBeat < 0) {
      // Snap onto the half-beat grid, then wait one full cadence so a body
      // never arrives already charging.
      const grid = 0.5;
      const due = nowBeat + spec.everyBeats + e.lungeOffset;
      e.lungeBeat = due + ((grid - (due % grid)) % grid);
      return false;
    }

    if (nowBeat < e.lungeBeat) return false;

    /*
     * Overdue by more than one cadence means the world was held (a level-up
     * pause that outran `delayBy`, a very long hitch). Re-snap rather than
     * firing a burst of catch-up charges — `Emitter.update`'s catch-up loop
     * existed because dropping volleys visibly thinned a bullet pattern, and a
     * body cannot dash twice at once anyway.
     */
    if (nowBeat > e.lungeBeat + spec.everyBeats) {
      e.lungeBeat = nowBeat + spec.everyBeats;
      return false;
    }

    e.lungeBeat += spec.everyBeats;

    /*
     * GLARE FIRES HERE: a blinded body misses half of what it throws.
     *
     * The charge is CONSUMED and then thrown away rather than skipped, which is
     * the same distinction the volley version drew and for the same reason.
     * Skipping would only delay it — the schedule counts in beats and the body
     * would charge on the next grid line instead — so a blinded enemy would
     * attack the same number of times, slightly later, which is not a miss.
     *
     * WHAT CHANGED FOR THIS PROPERTY. Measured before this pass, a 180-second
     * GLARE-only run produced 45 blinded attacks in total, because "attacks" in
     * this game meant volleys and hardly anything was armed. Every body on the
     * field now attacks, so blind finally has a denominator; the after figure
     * is in the commit.
     */
    if (e.status & Status.Blind) {
      this.propMoments.volley++;
      this.blindedAttacks++;
      this.propChances.blind++;
      if (this.rng.next() < PROP.blindMiss) {
        this.propFires.blind++;
        this.propDamage.blind += 1;
        return false;
      }
    }

    const a = Math.atan2(this.player.y - e.y, this.player.x - e.x);
    e.lungeVX = Math.cos(a) * spec.speed;
    e.lungeVY = Math.sin(a) * spec.speed;
    e.lungeTime = spec.time;
    this.propMoments.volley++;
    this.volleysThisStep++;
    /*
     * `pan`, not `x`. This is a STEREO POSITION and never was a coordinate.
     *
     * It used to be `e.x / this.width` — which side of the FIELD the shot came
     * from. On a one-screen field that is also which side of the player it came
     * from, so the mix was right by coincidence. On a 3000px field the player
     * and everything near them occupy under a third of the range, so the value
     * collapses toward whatever fraction of the arena the player is standing at
     * and stops varying with the thing it exists to encode.
     *
     * `0.5 + (e.x - player.x) / VIEW_W` is "which side of ME", which is what a
     * listener hears, is independent of the camera and of the field, and is
     * more correct than the version it replaced even at one screen.
     *
     * THE EVENT NAME CHANGED WITH THE ATTACK. `enemy:fire` became
     * `enemy:lunge` for the same reason `x` became `pan`: the old name let
     * `tools/battlefield.mjs` keep printing a column after its definition had
     * moved, and there is no longer any fire to name.
     */
    const pan = clamp01(0.5 + (e.x - this.player.x) / this.viewW);
    this.bus.emit('enemy:lunge', { archetype: e.archetype, pan });
    return true;
  }

  /**
   * Fields: the `field` instrument shape, live on the arena.
   *
   * One routine covers both kinds because the difference between them is two
   * numbers rather than two behaviours — a BLACK HOLE has `pull` and
   * `swallows`, a TREMOLO FIELD has neither and a longer life. Both burn what
   * stands in them.
   */
  private updateWells(dt: number): void {
    for (let w = this.wells.length - 1; w >= 0; w--) {
      const well = this.wells[w];
      well.age += dt;

      /*
       * Grows, holds, then collapses.
       *
       * `Renderer.drawWells` REPEATS THIS LINE, which is a duplicated constant
       * and therefore a hazard by this repo's own rules. It is duplicated on
       * purpose: the alternative is publishing a derived radius on the well for
       * the renderer to read, which would put a per-frame write on every well
       * so that a drawing detail could avoid an arithmetic expression. The
       * defence is a test rather than a comment — `tools/effectsdraw.mjs`
       * asserts a well is drawn at three different sizes at three ages, so the
       * two copies cannot drift into agreeing on nothing.
       */
      /*
       * A POOL APPLIES ITS STATUSES ON A CADENCE, NOT EVERY FRAME.
       *
       * DETUNE's poison is one stack per application and caps at five; at 120
       * Hz a body standing in it would be at the cap in 42 milliseconds and
       * every duration in the game would be permanently refreshed. The damage
       * still accrues every frame — damage is already expressed as a rate —
       * and only the STATUS is throttled. `PROP.fieldTick` is 0.3s, so a full
       * five stacks takes a second and a half of standing still, which is a
       * decision the player can see being made.
       */
      well.tick += dt;
      const wellApplies = well.prop !== 0 && well.tick >= PROP.fieldTick;
      if (wellApplies) well.tick = 0;
      const wellProps = wellApplies ? this.propSets[well.prop] : null;
      const t = well.age / well.life;
      const radius = well.radius * Math.sin(Math.min(1, t) * Math.PI) + 40;
      if (well.pull > 0) this.shock(well.x, well.y, radius * 1.4, -1200 * dt * 60 * 0.016);

      /*
       * A BLACK HOLE USED TO EAT ENEMY BULLETS, and that half of it is gone.
       *
       * `swallows` ran a second loop here that spiralled every cancellable
       * bullet inward, turned each one into a shard at the centre, and cleared
       * the rest on collapse. It was a large part of what the item was worth —
       * see the ledger in the commit — and there is nothing left to eat.
       *
       * The `pull` above is untouched and is the half that survives, because it
       * was always the better half: it drags BODIES toward the crush, and
       * bodies are now the whole threat. The collapse still shoves, below.
       */

      for (const e of this.enemies) {
        const dx = well.x - e.x;
        const dy = well.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d > radius + e.radius || d < 1) continue;
        if (well.dps > 0 && e.invuln <= 0) {
          // `discrete: false` — a pool does not reopen a wound; see `hurt`.
          this.hurt(e, well.dps * dt, false);
        }
        if (wellProps && e.invuln <= 0 && e.alive) this.applyStatus(e, wellProps);
        if (well.pull > 0 && e.archetype !== 'conductor') {
          const pull = (1 - d / radius) * well.pull * dt;
          e.x += (dx / d) * pull;
          e.y += (dy / d) * pull;
        }
      }

      if (well.age >= well.life) {
        this.wells.splice(w, 1);
        if (well.swallows) {
          this.camera.shake(0.5);
          this.camera.strike(well.hue, 0.5);
          this.shock(well.x, well.y, radius * 2.2, 4200);
          this.particles.burst(this.rng, well.x, well.y, 60, 460, well.hue, 0.8, 5);
          this.repel(well.x, well.y, well.radius * 1.4, 620, well.hue);
        }
      }
    }
  }

  /**
   * THROW EVERY BODY IN THE RADIUS OUTWARD. The contact game's screen-clear.
   *
   * This is what `cancelBullets` and `cancelBulletsNear` became, and naming
   * what was lost matters more than naming what replaced it. Deleting the
   * bullets in the air was a HIDDEN DEFENCE with a measured price tag: moving
   * two instruments off the `aura` shape roughly doubled hits taken, purely
   * because every expanding ring in the game quietly swept the annulus it
   * crossed. Seven call sites depended on it — the player-hit reset, the bomb,
   * the auto-bomb rescue, every boss phase transition, COMPRESSOR's ring, the
   * black hole's collapse, and every aura in the roster by accident.
   *
   * None of that value survives as-is and pretending otherwise would be the
   * defect this repo keeps catching: a rule that reads live and does nothing.
   * What replaces it is a SHOVE, because in a contact game the thing standing
   * between you and the next hit is distance, and distance is exactly what a
   * bullet clear used to buy. A body thrown 200px away is 1.2 seconds at mob
   * closing speed — the same order as the breathing room a cleared screen gave.
   *
   * `push` is the launch speed in px/s; `pushTime` on the enemy is how long it
   * coasts, so reach is roughly push x 0.35. Score is paid per body at the same
   * 10 points a cancelled bullet paid, so the relief valve still pays out.
   */
  private repel(x: number, y: number, radius: number, push: number, hue = 190): void {
    const r2 = radius * radius;
    for (const e of this.enemies) {
      if (e.archetype === 'conductor') continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      /*
       * A shove CANCELS a committed lunge, and that is the point of the whole
       * mechanism. The bullet version's value was that the shot already in the
       * air stopped being a shot; the body version's value is that the charge
       * already committed stops being a charge.
       */
      e.lungeTime = 0;
      e.pushVX = (dx / d) * push;
      e.pushVY = (dy / d) * push;
      e.pushTime = 0.35;
      this.particles.emit(e.x, e.y, (dx / d) * 120, (dy / d) * 120, 0.3, 2.5, hue, ParticleShape.Dot, 2);
      this.score += 10;
    }
  }

  /**
   * Auras: expanding rings centred on the ship.
   *
   * The ring is now driven by the instrument's own stats rather than by NOVA's
   * hardcoded constants, but the thing that made NOVA good is kept: the rings
   * are emitted on the transport's grid by `fireInstruments`, so surviving
   * becomes "hold on until the next beat" and the player starts feeling the
   * clock as a gameplay object. That is the whole thesis of this project in
   * one mechanic and it would have been easy to lose in the conversion.
   */
  private updateNova(dt: number): void {
    for (let n = this.novas.length - 1; n >= 0; n--) {
      const ring = this.novas[n];
      if (ring.r >= ring.maxR && ring.hold > 0) {
        // Held at full radius: the ring hangs rather than expanding away.
        ring.r = ring.maxR;
        ring.hold -= dt;
      } else {
        ring.r += ring.speed * dt;
      }
      if (ring.r > ring.maxR && ring.hold <= 0) {
        this.novas.splice(n, 1);
        continue;
      }
      /*
       * GLARE's blind rides on the ring's own cadence rather than on
       * `PROP.fieldTick`: a ring is an expanding edge and sweeps a given body
       * once or twice at most, so throttling would sometimes skip the only
       * contact it ever gets. The cadence is the ring's geometry.
       */
      const ringApplies = ring.prop !== 0;
      for (const e of this.enemies) {
        if (e.invuln > 0) continue;
        const d = Math.hypot(e.x - ring.x, e.y - ring.y);
        if (Math.abs(d - ring.r) > 16 + e.radius) continue;
        this.hurt(e, ring.dps * dt, false);
        if (ringApplies) this.applyStatus(e, this.propSets[ring.prop]);
        e.hitFlash = 0.05;
        /*
         * `shoves` — what `clears` became.
         *
         * `clears: true` used to delete every enemy bullet in the ring's
         * annulus, and its own comment called that "undocumented behaviour
         * every aura quietly has". Here it was deliberate: COMPRESSOR's card
         * says "getting hit clears the room — a wide ring that eats the shots
         * in the air", and a previously-measured finding is that this hidden
         * sweep was worth roughly half the hits taken across the roster.
         *
         * A ring that throws bodies off you is the same sentence in the game
         * this now is, and it is deliberately still NOT the default: the
         * `false` on UP-TEMPO's trail is what stops a pool laid down six times
         * a second from being a permanent moving crowd-shredder, exactly as it
         * stopped it being a permanent moving bullet-shredder.
         */
        if (ring.shoves && e.archetype !== 'conductor' && e.pushTime <= 0) {
          const ux = (e.x - ring.x) / (d || 1);
          const uy = (e.y - ring.y) / (d || 1);
          e.lungeTime = 0;
          e.pushVX = ux * ring.speed * 0.8;
          e.pushVY = uy * ring.speed * 0.8;
          e.pushTime = 0.3;
        }
        if (e.hp <= 0) e.alive = false;
      }
    }
  }


  /**
   * `spawn` allies: keep the target you committed to, and burn what you reach.
   *
   * TWO THINGS SEPARATE THIS FROM `steerPlayerBullets`, which is the loop it
   * would otherwise be a copy of.
   *
   * IT COMMITS. That loop re-picks the nearest enemy every frame, which is
   * right for a bolt thrown a moment ago and wrong for an ally: between two
   * shapes at similar distances a re-picking ally oscillates and reaches
   * neither. `BulletPool.target` holds the index it chose and this only picks
   * again when that index no longer names something worth hunting. The index
   * can be inherited by a different enemy when the list is compacted by a
   * reap — which re-points the hunter at whatever took the slot, and a hunter
   * switching prey when its prey dies is the behaviour anyway.
   *
   * IT FALLS BACK TO THE SHIP. With nothing alive to hunt the ally steers home,
   * which is what keeps it inside the arena — the summons are spawned WITHOUT
   * `DespawnOffscreen` precisely so that chasing something to the edge does not
   * delete them, so something has to bring them back and this is it.
   *
   * IT DOES NOT DEAL DAMAGE. `collidePlayerBullets` does, exactly as it does
   * for every other bolt: a summon is `type: 2`, which is not the piercing
   * type, so it lands its `damage` on the thing it reaches and is consumed —
   * and the next activation of `fireSpawn` sends a replacement.
   *
   * A DRAFT OF THIS APPLIED A RATE HERE AS WELL, and it was wrong twice over.
   * It double-counted, because the bullet still went through
   * `collidePlayerBullets` and landed its full `damage` on contact on top of
   * the rate; and it cost an O(summons x enemies) overlap test per frame to
   * deliver a number too small to see. The alternative — making the summon
   * `type: 1` so it is not consumed, and letting the rate be the whole of its
   * output — is worse still: a piercing bullet that homes sits inside the first
   * thing it reaches and `collidePlayerBullets` applies its full `damage` on
   * every one of the 120 steps a second. Consumed-on-contact is the only one of
   * the three that is a weapon rather than a division by the step size.
   */
  private updateSummons(dt: number): void {
    const pb = this.playerBullets;
    let live = 0;
    for (let i = 0; i < pb.count; i++) {
      if (!(pb.flags[i] & BulletFlag.Summon)) continue;
      live++;

      let ti = pb.target[i];
      let t = ti >= 0 && ti < this.enemies.length ? this.enemies[ti] : null;
      if (t && (!t.alive || t.invuln > 0)) t = null;
      if (!t) {
        let bestD = Infinity;
        for (let j = 0; j < this.enemies.length; j++) {
          const e = this.enemies[j];
          if (!e.alive || e.invuln > 0) continue;
          const d = dist2(pb.x[i], pb.y[i], e.x, e.y);
          if (d >= bestD) continue;
          bestD = d;
          ti = j;
          t = e;
        }
        pb.target[i] = t ? ti : -1;
      }

      const gx = t ? t.x : this.player.x;
      const gy = t ? t.y : this.player.y;
      const want = Math.atan2(gy - pb.y[i], gx - pb.x[i]);
      pb.angle[i] += clamp(
        angleDelta(pb.angle[i], want),
        -World.SUMMON_TURN * dt,
        World.SUMMON_TURN * dt,
      );

    }
    this.summonsLive = live;
    this.summonsActive = live > 0;
  }

  /**
   * Beams and sweeps.
   *
   * Both are attached to the ship and both damage over their whole life rather
   * than on the frame they land, which is what lets ROSIN BOW read as a bow
   * stroke — a held thing you drag across a target — instead of as a very thin
   * bullet. A sweep is the same code with an angular test instead of a
   * rectangular one.
   */
  private updateEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.age += dt;
      if (fx.age >= fx.life) {
        this.effects.splice(i, 1);
        continue;
      }
      if (fx.attached) {
        fx.x = this.player.x;
        fx.y = this.player.y;
      }
      /*
       * A lance re-aims here, every frame, and that is the entire mechanism.
       *
       * `fireLance` only creates and refreshes; it runs on the instrument's
       * interval, which for ROSIN BOW is 1.6s at level 1. Aiming there would
       * give a laser that snaps to your heading twice a second, which is not a
       * held beam, it is a slow turret. The line has to follow the stick at
       * frame rate or the shape does not exist.
       *
       * Cost is two trig calls and an add per lance per frame, against a
       * worst case of six instruments times three parallel lines. The
       * collision below is unchanged — it is the same segment-versus-circle
       * test the beam branch has always run.
       */
      if (fx.tracks) {
        const aim = this.player.aim;
        fx.angle = aim;
        if (fx.offset !== 0) {
          fx.x += Math.cos(aim + Math.PI / 2) * fx.offset;
          fx.y += Math.sin(aim + Math.PI / 2) * fx.offset;
        }
      }
      /*
       * SWELL's slow rides here, on the same `PROP.fieldTick` cadence a pool
       * uses and for the same reason. A held lance touches a body 120 times a
       * second; without the throttle its five-second slow would be renewed
       * every 8ms and would never end.
       */
      fx.tick += dt;
      const fxApplies = fx.prop !== 0 && fx.tick >= PROP.fieldTick;
      if (fxApplies) fx.tick = 0;
      const fxProps = fxApplies ? this.propSets[fx.prop] : null;
      if (fx.dps <= 0 && !fxProps) continue;

      const cos = Math.cos(fx.angle);
      const sin = Math.sin(fx.angle);
      for (const e of this.enemies) {
        if (e.invuln > 0) continue;
        const dx = e.x - fx.x;
        const dy = e.y - fx.y;
        let inside: boolean;
        if (fx.kind === 'beam') {
          // Project onto the beam's axis; the perpendicular distance is the miss.
          const along = dx * cos + dy * sin;
          if (along < -e.radius || along > fx.length + e.radius) continue;
          const across = Math.abs(-dx * sin + dy * cos);
          inside = across <= fx.radius + e.radius;
        } else {
          const d = Math.hypot(dx, dy);
          if (d > fx.length + e.radius) continue;
          // A shape standing on top of the ship is inside every sweep; without
          // this a ram is immune to the weapon that should punish it most.
          inside =
            d < 14 + e.radius ||
            Math.abs(angleDelta(fx.angle, Math.atan2(dy, dx))) <= fx.arc / 2 + e.radius / Math.max(40, d);
        }
        if (!inside) continue;
        this.hurt(e, fx.dps * dt, false);
        if (fxProps && e.alive) this.applyStatus(e, fxProps);
      }
    }
  }

  /**
   * Notes drift out from a kill, then home to the player once they slow down.
   * The delay is deliberate: it gives the player a moment to decide whether the
   * trip is worth it, which is the whole risk/reward beat of the mechanic.
   */
  private updateNotes(dt: number): void {
    /*
     * Pickup radius is a rig statistic now, which is what makes MAGNET a build
     * decision rather than a lucky drop. It was 210px flat, or effectively
     * infinite while the MAGNET powerup was held; it is now 210 times the rig's
     * `pickupRadius`, which runs 1.0 to about 3.4 fully invested.
     *
     * "Collect more" being a thing you can choose to be good at is the reason
     * Vampire Survivors' Attractorb exists, and it is a much better shape than
     * a binary: at 3.4x the arena is nearly all in range and the player is
     * genuinely playing a different game, but they gave up three other rig
     * levels for it.
     */
    const pullRange = 210 * this.mods.pickupRadius;
    const pullSq = pullRange * pullRange;
    const magnet = this.mods.pickupRadius > 1.6;

    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      n.age += dt;
      const dx = this.player.x - n.x;
      const dy = this.player.y - n.y;
      const d2 = dx * dx + dy * dy;

      /*
       * COMMITTED ON FIRST CONTACT, and then it is chasing you rather than
       * being pulled. See `Shard.committed`.
       *
       * The pull no longer re-tests the range every step; it tests it once, and
       * from then on the shard homes regardless of how far the player has gone.
       * A committed shard also accelerates harder, because it may now have to
       * cross ground the player has already left, and it never expires -- the
       * age check below skips it.
       */
      if (n.age > 0.28 && !this.player.dead) {
        if (!n.committed && d2 < pullSq) n.committed = true;
        if (n.committed) {
          const d = Math.sqrt(d2) || 1;
          const pull = (magnet ? 2600 : 1500) * 1.35;
          n.vx += (dx / d) * pull * dt;
          n.vy += (dy / d) * pull * dt;
        }
      }
      const drag = Math.max(0, 1 - dt * (n.age > 0.28 ? 1.6 : 4.4));
      n.vx *= drag;
      n.vy *= drag;
      n.x += n.vx * dt;
      n.y += n.vy * dt;

      if (d2 < 26 * 26 && !this.player.dead) {
        /*
         * The multiplier is capped.
         *
         * It was uncapped and every collected note added to it, so a late wave
         * with twenty enemies and eighty note shards drove it past 240 — and
         * since score scales with it, a single wave earned 240,000 points and
         * three extra lives. A multiplier that outruns the difficulty curve
         * turns the endgame into a formality.
         */
        if (this.combo < MAX_MULTIPLIER) this.combo++;
        this.comboTimer = 6;
        // The run summary reports this. It was initialised to 0 and then never
        // written, so "NOTES 0" was on the screen at the end of every run ever
        // played, no matter how many were collected.
        this.totals.notes++;
        this.score += Math.round(28 * (1 + this.combo * 0.05));
        /*
         * And this is where a shard becomes XP.
         *
         * `grantXp` applies the rig's `xpGain` internally, so RESONANCE must
         * not be applied here as well — docs/progression.md says so in as many
         * words, and a double-applied multiplier is invisible until the pacing
         * table is a factor of two out.
         *
         * Levels are QUEUED rather than opened: `grantShard` can cross two
         * thresholds in one call and a bomb into a dense wave collects thirty
         * shards in a frame. The offer opens on the next bar line.
         */
        prog.grantShard(this.progression, n.tier);
        const hue = SHARD_HUES[n.tier];
        this.particles.emit(n.x, n.y, 0, -40, 0.24, 2.2, hue, ParticleShape.Dot, 2);
        /*
         * The most frequent reward in the game finally makes a sound.
         *
         * This emitted a single 2px dot and nothing else. Measured in ordinary
         * play that is 92-108 silent rewards every two minutes, and separately
         * a third to a half of all shards expire uncollected — which is not a
         * surprise, because nothing ever told the player that collecting one
         * did anything. The event carries `tier` and `combo` so the sound can
         * distinguish the three grades and climb with the streak; the SFX layer
         * throttles and merges the channel, so a bomb that collects thirty in
         * one frame is one louder tick rather than thirty overlapping ones.
         */
        this.bus.emit('shard:collect', { tier: n.tier, combo: this.combo });
        n.alive = false;
      }
      // A committed shard is already on its way and is never taken back.
      if (n.age > 11 && !n.committed) n.alive = false;
      if (!n.alive) this.notes.splice(i, 1);
    }

    // Extends. `player:extend` was declared and listened for but never emitted;
    // score-threshold extra lives are one of the main reasons Geometry Wars
    // stays playable while getting relentlessly harder.
    while (this.score >= this.nextExtend) {
      /*
       * Extends stack to +2, not +4. The old ceiling was maxLives + 4 — eight
       * lives, twenty-four hits — which turned a long run into a formality no
       * matter what the stage was doing.
       */
      this.player.lives = Math.min(this.player.maxLives + 2, this.player.lives + 1);
      this.player.bombs = Math.min(5, this.player.bombs + 1);
      this.popups.push({ x: this.player.x, y: this.player.y - 40, text: 'EXTEND', age: 0, hue: 150, big: true });
      // Steeper than the score curve, so extends stay rare as scores inflate.
      this.nextExtend = Math.round(this.nextExtend * 3.2);
      this.bus.emit('player:extend', { livesLeft: this.player.lives });
    }
  }

  /**
   * Scatter shards of a given tier split.
   *
   * The COUNT is unchanged from what `spawnNotes` used to produce for the same
   * kill — `prog.shardsForKill` is written against the same `maxHp / 12`
   * toughness formula the old code used — so the visual density of the field
   * does not move. Only the value each one carries is new. That was a
   * deliberate constraint: the shard scatter is one of the few things in this
   * game that has been looked at by a person and judged to feel right, and
   * changing its density while also changing what it is worth would make the
   * XP curve and the readability of a kill impossible to separate.
   */
  private spawnShards(x: number, y: number, split: { minor: number; major: number; rare: number }): void {
    if (this.notes.length > 320) return;
    const push = (tier: prog.ShardTier, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = this.rng.range(0, TAU);
        const sp = this.rng.range(90, 250);
        this.notes.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, alive: true, tier, committed: false });
      }
    };
    push('rare', split.rare);
    push('major', split.major);
    push('minor', split.minor);
  }

  private updateWave(dt: number): void {
    const beatsIn = this.transport.beat - this.waveStartBeat + this.waveBeatBias;

    switch (this.phase) {
      case 'idle':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.beginWave(0);
        break;

      case 'spawning': {
        /*
         * If the stage is empty and the next group is not due yet, slide the
         * whole remaining schedule forward so it is due now.
         *
         * Groups arrive on a fixed beat grid, so a player who clears a group
         * faster than it was budgeted for just stands there: measured over a
         * real run, 17% of the time there was nothing on screen at all, with
         * stretches up to 8.5 seconds. Raising the counts would fix the waiting
         * by reintroducing exactly the clutter that was cut on purpose. Sliding
         * the schedule instead leaves peak density untouched and only removes
         * the gaps — a strong player gets a tighter wave, a struggling one gets
         * the original spacing, and neither gets a fuller screen.
         *
         * The gap must exceed one beat, which is what makes this terminate:
         * sliding leaves the next group exactly one beat out, so the condition
         * is false on the following frame and the group then arrives on its own.
         * That one beat of air is also what keeps a cleared group audible as a
         * cleared group instead of the next one landing on the kill frame.
         *
         * Testing `gap > 1` rather than `atBeat > beatsIn` is load-bearing. The
         * loose version also fired on *negative* gaps — the frame where the
         * schedule had just come due but the spawn loop below had not run yet —
         * and dragged beatsIn back behind the entry it was about to spawn. The
         * bias then ran away at about eleven beats a second and the wave never
         * spawned anything at all.
         */
        /*
         * The slide must be a whole number of beats.
         *
         * `waveStartBeat` is quantised to a bar and every entry's `atBeat` is a
         * multiple of four, so groups land on bar lines exactly when the bias is
         * a whole number of bars. Sliding by the fractional `gap - 1` silently
         * took that apart — on-grid spawns fell from 98% to 22%, which is
         * audible: the arrivals stop agreeing with the kick. Whole beats were
         * not enough either (56%), because the grid the game is judged against
         * is the bar, not the beat.
         *
         * The cost is that gaps shorter than about five beats are left alone,
         * which is the right trade: those are already under two seconds, and
         * the waiting this exists to remove was eight.
         *
         * The guard keeps a slide from ever rounding to zero and leaving the
         * condition true forever, which is the runaway this loop deadlocked on
         * when it was first written.
         */
        /*
         * THE TRIGGER CHANGED FROM "EMPTY" TO "UNDER-POPULATED", and that is
         * the single most important balance change in the arena conversion.
         *
         * Measured on the first working build: enemies on screen ran
         * 0 / 1 / 4 at the 10th, 50th and 90th percentile, and encirclement
         * — the whole point of the arena — sat at 0.00 for most of a run and
         * peaked at 0.18. An arena with a median of one enemy in it is a
         * shooting gallery, which is "the game feels too simple" arriving by a
         * new route.
         *
         * The cause is not the schedule, it is the player. Auto-fire with a
         * seeking starter took the kill rate from 8.8/min to 32/min in the same
         * session, and every group count in `waves.ts` was chosen against the
         * old rate. Waiting for the stage to be *empty* before sliding meant a
         * player killing four times faster spent the wave clearing groups of
         * two, one group at a time, with nothing else on the field.
         *
         * A population floor is the honest lever because it changes only the
         * thing that is wrong. Per-enemy hp, speed and armed fraction are all
         * left exactly alone — they were measured carefully and the roster is
         * not what broke — and peak density is still bounded by the wave's own
         * content, so this cannot manufacture enemies a wave does not have.
         *
         * Everything below about whole-bar quantisation and the `> BAR + 1`
         * guard is unchanged and is load-bearing; read it before touching this.
         */
        const next = this.plan.entries[this.entryCursor];
        /*
         * `populationNearPlayer()`, NOT `this.enemies.length`.
         *
         * The floor is called `targetOnScreen` and it was compared against
         * every enemy alive anywhere in the world, which were the same number
         * for the whole life of the project because the world was one screen.
         * At 3000x3000 they are not: measured over three 20-minute runs, the
         * field held a p50 of 7.0 while the SCREEN held 2.3. The floor was
         * therefore being satisfied by enemies the player could not see, the
         * remaining schedule stopped sliding forward, and the arena the player
         * is actually looking at went quiet — the exact "bigger field, emptier
         * game" outcome `docs/research-density.md` warned about, arriving
         * through a comparison rather than through the area.
         */
        const gap = next && this.populationNearPlayer() < this.targetOnScreen() ? next.atBeat - beatsIn : 0;
        if (gap > BEATS_PER_BAR + 1) {
          this.waveBeatBias += Math.floor((gap - 1) / BEATS_PER_BAR) * BEATS_PER_BAR;
        }
        while (this.entryCursor < this.plan.entries.length && this.plan.entries[this.entryCursor].atBeat <= beatsIn) {
          this.spawnGroup(this.plan.entries[this.entryCursor]);
          this.entryCursor++;
        }
        const done = this.entryCursor >= this.plan.entries.length;
        /*
         * A WAVE WITH ITS SCHEDULE SPENT KEEPS TOPPING UP UNTIL ITS DEADLINE.
         *
         * Measured, sampled every 0.1s across a ten-minute run and bucketed by
         * wave AND phase, the empty screen was almost all in one place: the
         * `spawning` phase of a wave whose entries were exhausted. Wave 8 spent
         * 22 seconds there at a mean of 0.9 enemies on screen with 61% of
         * samples at exactly zero; wave 12 was 75% empty; wave 13 spent two
         * minutes at 49%. That is the "trough between every wave"
         * `docs/research-density.md` §6d says the `enemies.length === 0` gate
         * guarantees, finally located rather than inferred.
         *
         * `plan.lengthBeats` IS THE DEADLINE, and this is its first reader.
         * That field has been written by both `planWave` branches and read by
         * nothing for the whole life of the project — `waves.ts` documents it as
         * dead and `tools/deadhunt-branches.mjs` confirms only the declaration
         * and the two writes. It says "beats after the last spawn before the
         * wave gives up waiting", which is exactly the bound this needs: top up
         * until then, and after that let the wave end. Without a bound the floor
         * would keep manufacturing enemies and `settled` would never be true.
         */
        if (done && beatsIn <= this.plan.lengthBeats) this.topUp(this.targetOnScreen());
        /*
         * SETTLED IS A LOCAL QUESTION NOW, not a global one.
         *
         * `this.enemies.length === 0` is every enemy alive anywhere in a
         * 3000x3000 field, and a wave could not end while one straggler was
         * wandering half a screen behind the player — which is most of what
         * those 22-second empty stretches were. `populationNearPlayer()` is the
         * same census `targetOnScreen` is a floor for, so the wave now ends when
         * the player's own screen is clear. Anything left far away persists into
         * the next wave rather than holding this one open, which is the
         * accumulation a survivors-like wants anyway.
         */
        const settled = this.populationNearPlayer() === 0;
        if (done && settled) {
          if (this.plan.isBoss) {
            // Telegraph the boss a fixed number of bars out and tell the
            // director exactly how long it has. The riser and the boss's first
            // volley then land on the same beat.
            const bars = 4;
            const eta = bars * BEATS_PER_BAR * this.transport.secondsPerBeat();
            this.bus.emit('boss:telegraph', { id: `boss-${this.waveIndex}`, phases: 3, etaSeconds: eta });
            this.bossTelegraphed = true;
            this.phaseTimer = eta;
            this.phase = 'awaiting-boss';
          } else {
            this.finishWave();
          }
        }
        break;
      }

      case 'awaiting-boss':
        this.topUp(World.BOSS_ESCORT_FLOOR);
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          // Alternate boss variants so the fourth boss is a different problem
          // from the first, not the same one with more health.
          const variant = Math.floor(this.waveIndex / BOSS_EVERY);
          /*
           * The boss enters on the ring and takes the middle of the SCREEN.
           *
           * Was `(this.width / 2, -120)` — literally "off the top of the
           * playfield" — and it orbited the field centre. Both of those are the
           * same point only while the field is one screen. In a 3000px arena
           * the old code would have dropped the boss off the top edge of the
           * WORLD and sent it to circle the world's middle, which is a place
           * the player may be a screen and a half away from; the set piece
           * would be a health bar with nothing under it.
           *
           * ENTRY BEARING IS FIXED AT NORTH, not rolled. Rolling it would draw
           * from `this.rng` and desynchronise every downstream number in a
           * run, which is a behaviour change wearing a refactor's clothes.
           *
           * WRITTEN AS ARITHMETIC RATHER THAN AS `edgePoint(-PI/2, ring, 120)`,
           * and the reason is measured. The two are the same point in exact
           * maths, but `Math.cos(-Math.PI/2)` is 6.1e-17 rather than 0, which
           * puts the boss 4e-14 px off centre — and a twenty-minute run is
           * chaotic enough to amplify that into a visibly different run. With
           * `edgePoint`, `tools/arena.mjs` diverged in one of three runs
           * (level 73 -> 72, kills/min 155.4 -> 155.9); with this line it is
           * bit-identical to the pre-Stage-4 baseline, which is the evidence
           * that the rest of this stage is the no-op it claims to be. A
           * hand-inlined special case of a helper is normally a smell; here it
           * is the difference between a provable no-op and a plausible one.
           */
          const ring = this.spawnRing();
          const entry = { x: ring.cx, y: ring.cy - ring.h / 2 - 120 };
          const boss = spawnBoss(entry.x, entry.y, this.plan.difficulty, ring.cx, ring.cy, variant);
          /*
           * A boss gets HALF the roster's ensemble scaling, and the asymmetry
           * is deliberate rather than a compromise.
           *
           * Measured with the scaling off entirely, bosses died in 10-16
           * seconds against builds doing 140-240 dps — a set piece that lasts
           * less than a phrase is not a set piece, and this game's bosses have
           * three phases they never got to play. Measured with the full mob
           * scaling on, the same fights extrapolate past two minutes for a
           * player whose build went badly, and `tools/bosslength.mjs` gates at
           * 120s precisely because an over-long boss is an over-long piece of
           * music.
           *
           * Half is where those two meet, and the reason a boss can take less
           * scaling than a mob is that it already has a defence a mob does not:
           * `tools/README.md` records that boss length is dominated by whether
           * the player can get shots on a weaving target at all, so the same
           * hp buys a boss far more time than it buys anything else.
           */
          // Same 2.5 -> 10 fix as `scaleForEnsemble`, and for the same measured reason.
          const bossScale = 1 + this.plan.difficulty * 1.3 + Math.min(10, this.plan.escalation) * 0.7;
          boss.hp = boss.maxHp = Math.round(boss.maxHp * bossScale);
          this.enemies.push(boss);
          this.boss = boss;
          this.phase = 'conductor';
          this.introduced.add('conductor');
          this.bus.emit('boss:spawn', { id: `boss-${this.waveIndex}`, phases: boss.phases });
        }
        break;

      case 'conductor':
        if (!this.boss) {
          this.rewardBoss();
          this.bus.emit('boss:defeat', { id: `boss-${this.waveIndex}` });
          this.finishWave();
        } else {
          this.topUp(World.BOSS_ESCORT_FLOOR);
        }
        break;

      case 'interlude':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.beginWave(this.waveIndex + 1);
        break;

      case 'over':
        break;
    }

    void this.bossTelegraphed;
  }

  private finishWave(): void {
    /*
     * Grade the wave.
     *
     * Every wave used to end the same way regardless of how it went, which
     * wasted the one moment the player is guaranteed to be listening. A clean
     * run should sound like getting away with it; a mauling should not.
     */
    /*
     * `clean` HAS NEVER BEEN AWARDED, and the cause is that `wavePeakCombo` is
     * not a per-wave quantity.
     *
     * The middle tier means "untouched, but you did not build a streak", and it
     * requires `wavePeakCombo < 8`. `combo` persists across waves — it only
     * bleeds a third every 2.5s and is reset to zero solely by taking a hit —
     * and `wavePeakCombo` is seeded from whatever `combo` already is on the
     * wave's first step. So an untouched player arrives at every wave after the
     * first already holding a streak. Measured over ten runs with
     * `tools/deadhunt-branches.mjs`: 79 wave clears, 39 `perfect`, 40 `rough`,
     * 0 `clean`, and the LOWEST peak combo seen at any wave clear anywhere was
     * 11 against a threshold of 8.
     *
     * Two repairs were plausible from that measurement — lower the threshold,
     * or grade on the chain built during this wave alone — and both are
     * decisions about what a grade should MEAN rather than arithmetic, so the
     * measurement was handed over rather than acted on. The second was chosen;
     * see below for why, and note that the block below supersedes this one.
     */
    /*
     * FIXED, and the defect was the opposite way round from how it reads.
     *
     * `clean` never firing is the visible symptom; the real consequence is that
     * **`perfect` was awarded for merely not being hit**, 39 times in 79 clears.
     * The combo condition that was supposed to make it demanding was satisfied
     * before the wave even started.
     *
     * That matters musically more than it does on screen, which is why this is
     * being changed rather than left as a cosmetic gap. `perfect` is the ONLY
     * route into a `breakdown` — the one section where the arrangement rests
     * and the only place the tempo is allowed to leave dance territory — and it
     * also sets `modeBias` to -1.5, a strong brightening. Firing on half of all
     * waves made the rest routine instead of earned, and made the brightening
     * near-constant.
     *
     * Grading on the chain built DURING the wave restores all three tiers:
     * untouched and you built something is `perfect`, untouched and you did not
     * is `clean`, hit at all is `rough`. `wavePeakCombo` itself is untouched, so
     * the banner and the summary still show the real multiplier reached.
     */
    const waveChain = this.wavePeakCombo - this.waveComboBase;
    const grade: 'perfect' | 'clean' | 'rough' =
      this.waveDamage === 0 && waveChain >= 8
        ? 'perfect'
        : this.waveDamage === 0
          ? 'clean'
          : 'rough';
    this.bus.emit('wave:clear', {
      index: this.waveIndex,
      grade,
      peakMultiplier: 1 + this.wavePeakCombo,
      damageTaken: this.waveDamage,
    });
    this.totals.wavesCleared++;
    if (grade === 'perfect') this.totals.flawless++;
    this.announce(
      grade === 'perfect' ? 'FLAWLESS' : grade === 'clean' ? 'WAVE CLEAR' : 'WAVE CLEAR',
      grade === 'perfect' ? `UNTOUCHED · x${1 + this.wavePeakCombo}` : '',
      'grade',
    );
    // One bar of breathing room. Two left long enough dead air between waves
    // that the arrangement sat in a breakdown for a third of the run.
    this.phaseTimer = BEATS_PER_BAR * this.transport.secondsPerBeat();
    this.phase = 'interlude';
  }

  /**
   * A named variation on an ordinary wave, from wave 9 onward.
   *
   * Measured with tools/content.mjs, a five-minute run meets every archetype the
   * game has by wave 8 — and after that only the quantity changes. That is the
   * "rather uninteresting" complaint precisely: the novelty curve flattens
   * exactly where the difficulty curve steepens. Two attempts to fix it by
   * *rescheduling* existing content both measured worse and are recorded in
   * waves.ts; content that arrives after a run ends is not content, and delaying
   * what we have only thins the part anybody plays.
   *
   * THE THIRD CITATION OF A HORIZON THAT DOES NOT EXIST. "A run ends" is doing
   * the work in that last clause, and `tools/deadhunt-horizon.mjs` re-derives
   * it: no policy dies, at any competence, including a ship that never moves —
   * which reaches wave 60. See the tier comment in `waves.ts` for the numbers
   * and the mechanism.
   *
   * The argument FOR movements survives it intact and is arguably strengthened:
   * if the novelty curve flattens at wave 8 and the run keeps going to 30, 40,
   * 60, then the flat stretch this exists to fill is far longer than five
   * minutes rather than shorter. What does not survive is the five-minute frame
   * — movements start at index 5 and land every fourth wave, which was pitched
   * against a run that was thought to end at 8 and now delivers a named event
   * roughly fifteen times.
   *
   * So this is new material rather than later material, and it costs no new
   * assets: the same roster, arranged under a different rule. They are called
   * movements because that is what a section of a piece with its own character
   * is, and the banner names them so a player knows the game did something
   * rather than wondering why this wave feels odd.
   */
  /*
   * They start at index 5 and land every fourth wave, interleaved with bosses.
   *
   * `index < 8 && index % 3 !== 2` meant the first named wave was index 8 and
   * the next was index 14, because indices 11 and 15 are bosses and a boss
   * wave returns null here — a six-wave hole in the middle of the band the
   * "gets easy fast" complaint is actually about. Bosses are `index % 4 === 3`,
   * so keying movements to `index % 4 === 1` guarantees they never collide and
   * puts a named event on every other wave from index 5: boss 3, SOLOIST 5,
   * boss 7, HUSHED 9, boss 11, FLANKED 13.
   *
   * SOLOIST first is deliberate. It is the one that changes what the player
   * has to DO — a single enemy carrying the group's whole health pool is a wave
   * you clear by concentrating rather than sweeping, which is the same lesson
   * the new weapon teaches.
   */
  private movementFor(index: number): 'flank' | 'elite' | 'hush' | null {
    if (index < 5 || index % 4 !== 1) return null;
    return (['elite', 'hush', 'flank'] as const)[(Math.floor(index / 4) - 1) % 3];
  }

  private movement: 'flank' | 'elite' | 'hush' | null = null;

  /**
   * The roster's answer to the ensemble.
   *
   * THIS IS THE NUMBER THE CONVERSION BROKE, and it is worth being precise
   * about how. Every hp value in `enemies.ts` was chosen against a measured
   * player output of ~24 dps, by a workstream that timed each archetype
   * individually with `tools/ttk.mjs` and wrote the reasoning down at length.
   * None of that was wrong and none of it is being second-guessed here.
   *
   * What changed is the other side of the division. A vertical run held one
   * weapon whose ceiling was 1.9x baseline; an arena run holds up to six
   * instruments, each levelling to 8, over a rig that multiplies all of them.
   * Measured headless over five minutes, nominal output runs 36 dps at the
   * start and 200-245 by the end — call it 6.7x — against an hp curve that tops
   * out at 1.85x. So a mid-run enemy dies in a fraction of a second, and
   * measured, the arena held a MEDIAN OF ONE ENEMY with encirclement peaking at
   * 0.18. An arena with one enemy in it is not an arena.
   *
   * The fix has to track the player's curve rather than the wave index alone,
   * and it deliberately does NOT track the player's actual loadout: rubber-
   * banding off measured dps would make building a strong ensemble feel like
   * nothing, which deletes the reason the progression system exists. Wave index
   * is the honest proxy, because levels arrive on a clock the pacing table
   * already fixes.
   *
   * Applied here rather than inside `spawnEnemy` so the archetype table stays
   * the record of what each shape IS, and this stays the record of what the run
   * is doing to it.
   */
  private scaleForEnsemble(e: Enemy): void {
    /*
     * The escalation term used to clamp at 2.5, which reads as "past a point
     * toughness stops climbing" until you check where that point is:
     * `escalation` is 2.45 at wave 35 and 6.19 at wave 63, so the clamp bound
     * for the back half of every run this project's own tools measure a
     * parked ship reaching (`deadhunt-horizon.mjs` reports wave 60+ at 45
     * minutes). Toughness was flat for 28+ waves while `groups` two lines
     * away, reading the same `escalation`, kept climbing uncapped — one
     * enemy-count formula still escalating against a wall of enemies whose hp
     * had stopped. Raised to 10 (binds around wave 88) rather than removed
     * outright, so a session long enough to matter still has a ceiling.
     */
    /*
     * 40.0, up from 2.6, and the size of that jump needs its own justification.
     *
     * THE PREMISE THIS FUNCTION RESTS ON MOVED. The comment above says wave
     * index is "the honest proxy" for player power "because levels arrive on a
     * clock the pacing table already fixes". True when written. The level
     * ladder then went from 8 rungs to 3, so the same number of level-ups now
     * buys roughly 2.7x the power, and wave index stopped being a proxy for
     * anything. Measured: nominal dps 942 -> 3768 at the same wave, enemies on
     * field p50 7.3 -> 2.0, and encirclement p90 0.53 -> 0.02 against a 0.25
     * bar. The arena gate went red and it was right to.
     *
     * WHY TOUGHNESS AND NOT SOMETHING ELSE. Four levers were swept and three of
     * them do not work, which is worth recording so nobody re-tries them:
     *
     *   - Group count and group size alone: enemies p50 2.0 -> 3.0, and
     *     kills/min simply rose 167 -> 231. More bodies arriving at a player
     *     who deletes them on contact is more kills, not more pressure.
     *   - `targetOnScreen` alone, raised from 9 to 24 and then 36: p50 moved
     *     3.7 -> 4.0 and stopped. The floor pulls scheduled groups FORWARD and
     *     cannot manufacture enemies a wave does not contain, exactly as its
     *     own comment warns.
     *   - The XP curve alone, slowed 1.8x and 2.6x: encirclement reached only
     *     0.12, and it cost fusions 5.00 -> 3.33, which is the thing the ladder
     *     change existed to deliver.
     *
     * The arithmetic says why. On-screen population is spawn rate times
     * LIFETIME, and lifetime is hp/dps. Quadrupling dps cut lifetime to a
     * quarter; at ~3768 dps against 70-210hp an enemy lived about 0.05s. No
     * sane spawn rate fills a field at that lifetime. Only hp moves the term
     * that actually broke.
     *
     * At difficulty 1 this is 41x base rather than 3.6x, which sounds enormous
     * and is roughly the 4x dps rise compounded with the ~3x longer lifetime
     * needed to hold a ring. It is not a difficulty increase in the felt sense:
     * measured after, the run still survives 1200s on both policies, kills/min
     * is 188 against 101 before the ladder change, and fusions are 5.67 against
     * 0.33. The player is far stronger AND the field is now populated, which is
     * the combination the whole item brief was aiming at.
     *
     * Swept rather than guessed: 5.0 gives encirclement 0.11, 12.0 gives 0.12,
     * 22.0 gives 0.20, 32.0 gives 0.24, 40.0 gives 0.27 and clears the bar.
     */
    const scale = 1 + this.plan.difficulty * 40.0 + Math.min(10, this.plan.escalation) * 4.5;
    e.hp = e.maxHp = Math.max(1, Math.round(e.maxHp * scale));
    /*
     * ESCALATION BUYS CLOSING SPEED, and this is the term the difficulty gate
     * was missing.
     *
     * `difficulty` saturates at wave 13, so past that point the stage grew in
     * hp, group count and lunge cadence and in nothing else — and measured on
     * `tools/difficulty.mjs`, which samples bodies within 150px of the ship
     * continuously, that produced a stage whose back half was x0.93 of its
     * front against a bar of 1.15. The crowd itself went 10.7 -> 39.5 over the
     * same run. Four times the bodies, no more pressure: they were all behind.
     *
     * That is the same finding this file already records about the pre-contact
     * game ("growth going entirely into bodies ... bodies are clutter") arriving
     * by a new route, and with contact damage the answer is not cadence, it is
     * how fast the crowd arrives.
     *
     * THE CEILING IS THE POINT. `SPEED_CEILING` is 0.95 of the player's 430, so
     * however long a run goes, nothing on foot ever outruns the ship. Kiting
     * stays a skill and gets more expensive; it never stops working. Without a
     * ceiling this term reaches 1.6x by wave 35 and the swarm simply catches
     * you, which deletes the verb rather than taxing it.
     */
    e.vy = Math.min(SPEED_CEILING, e.vy * (1 + Math.min(6, this.plan.escalation) * 0.22));
    /*
     * Past the cap the run gets more AGGRESSIVE, not just more crowded.
     *
     * Toughness and group count both already climb with `escalation`, and
     * measured across three seeds that produced a back half with four times
     * the enemies and only 1.3x the bullets — growth going entirely into
     * bodies. Bodies are clutter; volleys are difficulty. So escalation now
     * also buys cadence, in two discrete gears rather than as a slide, because
     * `Emitter.setUrgency` snaps to the beat grid and a gear change is
     * something a player can hear happen.
     *
     * A/B over five seeds and fifteen minutes, on `npm run difficulty`'s
     * PRESSURE measure (mean enemy bullets within 150px of the ship, sampled
     * continuously — hits are far too rare to resolve a change this size):
     *
     *   quarter          Q1    Q2    Q3    Q4    back/front
     *   gears off       0.42  0.68  0.56  0.50     x0.96
     *   gears on        0.42  0.68  0.65  0.62     x1.16
     *
     * A decaying tail became a sustained one. Mean wave reached is 25.8 either
     * way and deaths stay at zero, so this adds pressure without shortening
     * the run — which is the point. It is deliberately gentle; the file's own
     * history is two passes that overshot.
     *
     * Deliberately the only new term. `waves.ts` says two hands tightening at
     * once is how a difficulty pass overshoots, and this file has already been
     * tuned twice for the opposite defect.
     */
    /*
     * Gear thresholds are in `escalation`, which is 0 at the wave-13 cap and
     * grows slowly: 0.15 is wave 15 and 0.6 is wave 19. The first pass set
     * them at 0.7 and 1.6 — waves 20 and 29 — and measured almost nothing,
     * because runs end between 22 and 30. A gear that engages after the run is
     * over is not a gear.
     */
    const urgency = this.plan.escalation >= 0.6 ? 0.5 : this.plan.escalation >= 0.15 ? 0.75 : 1;
    /*
     * The gears now tighten the LUNGE cadence, and they still snap to the beat.
     *
     * `Emitter.setUrgency` did this for volleys and its note is the reason the
     * multiplier is two discrete gears rather than a slide: the whole system
     * schedules against the transport's absolute beat so attacks land on
     * subdivisions, and scaling a 4-beat cadence by 1.37 gives 2.92 beats and
     * quietly destroys that. Stepping it to 3, or to 2, keeps it — so the
     * result is rounded to the half beat and floored at one beat, exactly as
     * that method did.
     */
    if (urgency < 1 && e.lunge) {
      e.lunge = { ...e.lunge, everyBeats: Math.max(1, Math.round(e.lunge.everyBeats * urgency * 2) / 2) };
    }
    // Score does NOT scale with it. Toughness already pays through the shard
    // split, which reads `maxHp`, so scaling both would compound a reward the
    // multiplier cap exists to keep bounded.
  }

  /**
   * How many enemies the wave tries to keep on the field.
   *
   * A FLOOR, not a cap: it only decides when the remaining schedule slides
   * forward, so a wave can hold more than this if its own groups happen to
   * overlap, and it can never hold more than the wave was written to contain.
   *
   * The numbers come from what the arena needs rather than from what the shmup
   * had. Encirclement is measured as the largest angular gap in the ring around
   * the player, so it is a function of HOW MANY BEARINGS are occupied: three
   * enemies can leave at most three gaps, and two of them cannot surround
   * anybody at all. Four is therefore the floor at which the mechanic exists
   * and eleven is where a ring starts to feel closed, which is the range this
   * spans across a run.
   *
   * A boss wave is exempt, and has to be: a boss is one enemy by design and its
   * escort is a top-up before the fight, so a floor would keep shoving escorts
   * in while the player is trying to read a three-phase pattern.
   */
  private targetOnScreen(): number {
    /*
     * A boss wave used to return 0 — no floor at all — with the reason that "a
     * boss is one enemy by design and its escort is a top-up before the fight,
     * so a floor would keep shoving escorts in while the player is trying to
     * read a three-phase pattern".
     *
     * MEASURED, THAT WAS A QUARTER OF THE RUN SPENT ON AN EMPTY SCREEN. Sampled
     * every 0.1s across a ten-minute run and bucketed by wave: ordinary
     * mid-game waves hold 21-35 enemies on screen, and waves 4, 8 and 12 — the
     * bosses — hold 1.0, 1.5 and 1.3, with 31-43% of their samples at exactly
     * zero. Those three waves are 23% of the whole run. Whatever the p50 of
     * this game's density is, boss waves are most of what drags it down, and
     * "the reference is a screen that fills up" cannot be true for a quarter of
     * the time if it is only true between set pieces.
     *
     * The floor is real but low, and `topUpForBoss` is what fills it — a
     * trickle rather than the wave schedule, so the pattern stays readable and
     * the boss is still the thing you are looking at.
     */
    if (this.plan.isBoss) return World.BOSS_ESCORT_FLOOR;
    // Same 2.5 -> 10 fix as `scaleForEnsemble` (this one's old bound was 2, an
    // even earlier wall — wave 30).
    /*
     * Raised with the rest of the post-3-level-ladder rebalance: 4 + d*5 became
     * 10 + d*16, so the mid-game floor is 26 rather than 9.
     *
     * On its own this does almost nothing — swept at 24 and 36, on-screen p50
     * moved 3.7 to 4.0 and stopped — because the floor pulls scheduled groups
     * FORWARD and cannot manufacture enemies a wave does not contain, which the
     * comment above already says. It earns its place only alongside the hp rise
     * in `scaleForEnsemble`: once enemies survive long enough to accumulate, a
     * low floor becomes the thing capping the crowd instead of the thing
     * creating it. Raised together, measured together.
     */
    return Math.round(24 + this.plan.difficulty * 42 + Math.min(10, this.plan.escalation) * 6);
  }

  /**
   * How many enemies are on screen or arriving on the ring — the population
   * `targetOnScreen()` is a floor for.
   *
   * The margin is generous on purpose. A group is PLACED `SPAWN_MARGIN` (70)
   * outside the view and formations stagger further out than that — `columns`
   * reaches +128, `centre` +48 per member — so a strictly on-screen count
   * would treat a group that is one second from arriving as if it did not
   * exist and pull the next one forward on top of it. `POPULATION_MARGIN`
   * covers the ring and the deepest stagger and nothing beyond, so an enemy
   * that has wandered a screen away behind the player stops counting, which is
   * the whole point.
   *
   * Linear in the enemy count, called once per wave step against a list that
   * peaks around 50. Measured peak `enemies alive` over three 20-minute runs
   * is 46.
   */
  private populationNearPlayer(): number {
    const l = this.camera.viewX - POPULATION_MARGIN;
    const t = this.camera.viewY - POPULATION_MARGIN;
    const r = this.camera.viewX + this.viewW + POPULATION_MARGIN;
    const b = this.camera.viewY + this.viewH + POPULATION_MARGIN;
    let n = 0;
    for (const e of this.enemies) {
      if (e.x > l && e.x < r && e.y > t && e.y < b) n++;
    }
    return n;
  }

  /**
   * Roll a new escape corridor.
   *
   * It jumps by at least a quarter turn every time, because a corridor that
   * drifts a few degrees is a corridor you can stand in — the player would
   * find the gap once and never have to move again, which is the failure mode
   * that makes a survivor game boring rather than the one that makes it hard.
   * Jumping means the safe side is a place you are always travelling toward.
   */
  /**
   * Keep a crowd alive when the wave's own schedule has nothing left.
   *
   * Two callers with two different floors: a boss fight asks for
   * `BOSS_ESCORT_FLOOR`, and an ordinary wave past its last group asks for the
   * full `targetOnScreen()` until its deadline.
   *
   * Spawns at most one group every `BOSS_ESCORT_BARS` bars, and only while the
   * population is under the floor, so a player who is clearing it gets nothing
   * extra and a player who is ignoring it does not accumulate a second fight.
   * The archetypes come from the wave's own escort entries, so a boss wave
   * still sounds like the wave it is — the motif layer reads what is present.
   *
   * DELIBERATELY NOT THE WAVE SCHEDULE. `entries` are exhausted before the boss
   * is summoned (that is the condition that summons it), and re-running them
   * would put a full wave's worth of bodies on top of a three-phase pattern.
   * The floor is a third of an ordinary wave's.
   */
  private topUp(floor: number): void {
    if (this.transport.beat < this.bossEscortBeat) return;
    this.bossEscortBeat = this.transport.beat + World.BOSS_ESCORT_BARS * BEATS_PER_BAR;
    if (this.populationNearPlayer() >= floor) return;
    const entry = this.plan.entries[this.bossEscortCursor % Math.max(1, this.plan.entries.length)];
    if (!entry) return;
    this.bossEscortCursor++;
    this.spawnGroup(entry);
  }

  private rollGap(): void {
    this.gapAngle = (this.gapAngle + this.rng.range(TAU * 0.25, TAU * 0.75)) % TAU;
  }

  /**
   * Pick the bearing a group arrives on, guaranteeing it clears the corridor.
   *
   * The group's own angular width is added to the exclusion, so a wide
   * formation cannot have one wing straddling the gap. Without that the
   * corridor silently narrows with the width of whatever formation was rolled,
   * and a `sides` group (2.4 rad across) would close it entirely.
   */
  private spawnBearing(formation: Formation): number {
    const half = ENCIRCLE_GAP_HALF + formationWidth(formation) / 2;
    const open = TAU - half * 2;
    // Unreachable with today's table, and kept as the guard it is. The widest
    // formation is `sides` at 2.4 rad, giving half = 1.82 and open = 2.64; the
    // narrowest open arc over all six formations is that one, ten times this
    // threshold (enumerated by `tools/deadhunt-ranges.mjs`). It would start to
    // bite at a formation arc above about 5.0 rad, which is what makes it worth
    // keeping — `crossstrung` and `stringsection` already carry 6.28 on the
    // player's side, so an enemy formation that wide is not a strange idea.
    if (open <= 0.2) return this.gapAngle + Math.PI;
    return this.gapAngle + half + this.rng.next() * open;
  }

  private spawnGroup(entry: {
    archetype: Exclude<EnemyArchetype, 'conductor'>;
    count: number;
    formation: Formation;
    homeY: number;
  }): void {
    this.rollGap();
    const bearing = this.spawnBearing(entry.formation);
    const ring = this.spawnRing();
    const positions = arenaSpawnPositions(entry.formation, entry.count, ring, bearing, SPAWN_MARGIN);
    /*
     * `entry.homeY` IS NOW READ BY NOTHING, and it is left in `SpawnEntry`
     * rather than deleted for one reason: `planWave` is a deterministic
     * generator seeded per wave, and removing a field it fills would change the
     * number of `rng.int` draws per group and re-roll every wave in the game.
     * That is a content change wearing a refactor's clothes. It was the
     * standoff radius; the standoff ring is gone (see `spawnEnemy`).
     */
    let lungeChanceNow = lungeChance(this.plan.difficulty);

    /*
     * `elite` sends one enemy instead of a group. `hush` takes the wave's
     * charges away and pays for it in reach, so a quiet stage is not a free
     * one. `flank` brings them in split across two bearings.
     */
    /*
     * `elite` USED TO DELETE THE GROUP: `positions.length = 1`, so a group of
     * eleven arrived as one. Measured across a ten-minute run, wave 6 — the
     * first elite wave — held a mean of 2.3 enemies on screen against 13.8 and
     * 15.1 on the waves either side of it, with 31% of its samples empty. A
     * named variation that empties the arena is a variation in the wrong
     * direction now that the arena is the point.
     *
     * It keeps the CHARACTER — one enemy carrying the group's health, worth the
     * group's score, a wave you clear by concentrating rather than by sweeping
     * — by promoting the first member instead of deleting the rest. The group
     * behind it is what makes concentrating a decision.
     */
    const eliteAt = this.movement === 'elite' ? 0 : -1;
    if (this.movement === 'hush') lungeChanceNow = 0;
    positions.forEach((p, i) => {
      /*
       * ONE GUARANTEED LUNGER PER WAVE, not per group, and the guarantee is
       * waived on a hushed wave.
       *
       * Both halves are inherited verbatim from the shooter guarantee this
       * replaces, and both were measured there. Setting the chance to zero was
       * not enough on its own: the flag armed the first enemy of every group
       * regardless, so a HUSHED wave measured 50% armed — the movement's one
       * rule quietly overridden by a rule written for ordinary waves. And
       * removing the guarantee outright was worse: a wave where nothing ever
       * attacks is not tension, it is a lull.
       *
       * `rush` is exempt because its dive is already its charge.
       */
      const needsFirstLunger = this.movement !== 'hush' && !this.waveHasLunger && entry.archetype !== 'rush';
      const guaranteed = needsFirstLunger && i === 0;
      const lunges = this.rng.next() < lungeChanceNow || guaranteed;
      if (lunges) this.waveHasLunger = true;
      // Alternate which way round the player each one circles, so a group
      // opens out rather than winding into a single rotating clump.
      const e = spawnEnemy(
        entry.archetype,
        p.x,
        p.y,
        this.plan.difficulty,
        lunges,
        i % 2 === 0 ? 1 : -1,
      );
      this.scaleForEnsemble(e);
      if (i === eliteAt) {
        // One enemy carrying the whole group's health, worth the whole group's
        // score. A wave you clear by concentrating rather than by sweeping.
        e.hp = e.maxHp = Math.round(e.maxHp * Math.max(2, entry.count * 0.8));
        e.score = Math.round(e.score * 3);
        e.radius = Math.round(e.radius * 1.35);
      }
      if (this.movement === 'hush') {
        /*
         * A hush wave pays for its silence in SPEED now.
         *
         * It used to press 90px closer by shaving the standoff, which was the
         * arena's translation of the vertical game's "arrives lower" — the same
         * statement, costing the player reaction distance. With the standoff
         * ring gone that line had nothing left to shave (every body closes to
         * zero), so the cost moves to the quantity that still buys reaction
         * distance. A quarter faster: no charges, but they are on you sooner.
         */
        e.vy *= 1.25;
      }
      if (this.movement === 'flank') {
        /*
         * FLANKED, in the round.
         *
         * "They come from the wings" needs a redefinition here, because on a
         * ring every arrival is from a wing. What made it distinct was that the
         * group arrived SPLIT — pressure from two bearings at once instead of
         * one — so that is what it means now: half the group is placed a half
         * turn away from the other half. It is the one movement that
         * deliberately puts enemies on both sides of the escape corridor
         * without closing it, which is exactly the flanking feeling.
         */
        if (i % 2 === 1) {
          // The same ring, deliberately captured once above rather than
          // re-derived: the camera moves between frames but not between the two
          // halves of one group, and re-reading it here would let a fast pan
          // split a formation across two different rectangles.
          const opposite = arenaSpawnPositions(entry.formation, entry.count, ring, bearing + Math.PI, SPAWN_MARGIN)[i];
          e.x = e.prevX = e.homeX = opposite.x;
          e.y = e.prevY = e.homeY = opposite.y;
        }
      }
      /*
       * A rhythm formation attacks left to right, one sixteenth apart, so the
       * row of enemies performs its own bar.
       *
       * The stagger is a PENDING offset rather than a delay applied now,
       * because `tickLunge` sets `lungeBeat` lazily on the body's first tick
       * after it enters — there is nothing to delay at spawn time.
       * `lungeOffset` is the last surviving piece of `Emitter.pendingDelay`,
       * which existed for exactly this call site.
       */
      if (entry.formation === 'rhythm') e.lungeOffset = (i % positions.length) * 0.25;
      this.enemies.push(e);
      this.introduce(e.archetype);
      this.bus.emit('enemy:spawn', { id: e.id, archetype: e.archetype });
    });
  }

  /** Name an archetype the first time the player meets it, with what it plays. */
  private introduce(archetype: EnemyArchetype): void {
    if (this.introduced.has(archetype)) return;
    // Never talk over a wave or boss announcement.
    if (this.bannerAge < 2.2) return;
    /*
     * Marked seen AFTER the banner guard, not before it.
     *
     * The order was the other way round, and that made the guard permanent
     * rather than momentary: an archetype suppressed for arriving under a fresh
     * banner was recorded as introduced anyway, so it could never be named
     * again for the rest of the run. The suppression is not rare, because the
     * two events are causally linked — `beginWave` announces `WAVE N` and then
     * the wave's first group spawns a fraction of a second later, inside the
     * same 2.2s window, every single time.
     *
     * Measured with `tools/deadhunt-branches.mjs` over ten runs: 83 first
     * encounters, 36 banners shown, 47 suppressed and therefore lost. Of the
     * losses, 41 were under a `wave` banner at ages 0.00-2.12s, which is the
     * causal case; the rest were under an `item` (a level-up) or under another
     * archetype's own banner from the same spawn.
     *
     * With the record moved down here a suppressed introduction is simply
     * deferred: the next spawn of that archetype tries again, and the naming
     * lands mid-wave once the banner has cleared. That is later than "the first
     * time it appears" and it is what the feature was for — the point is to
     * teach the enemy-to-motif mapping without a tutorial, and a name that
     * never appears teaches nothing.
     */
    this.introduced.add(archetype);
    const info = ARCHETYPE_INFO[archetype];
    this.announce(info.label, info.motif.toUpperCase(), 'archetype');
  }

  private onEnemyKilled(e: Enemy): void {
    this.killsThisStep++;
    /*
     * SOSTENUTO FIRES OFF THIS, in place, at the line that already knows an
     * enemy has died — the same rule the rig's trigger surface follows and for
     * the same reason: `core/events.ts` says the simulation emits and never
     * receives, and a listener in `main.ts` reaching back into the world to
     * raise a ghost would invert that boundary and buy a frame of latency for
     * nothing.
     *
     * A POSITION, NOT A GHOST. Raising here would make the retinue a function
     * of the kill rate rather than of the item's own clock, so this records the
     * corpse and `fireGhost` decides on its interval whether to use it. It is
     * one struct's worth of state and it is overwritten by the next kill, which
     * is what "the LAST enemy you killed" means.
     *
     * Unconditional, because the alternative is scanning the loadout on every
     * death to find out whether anyone cares. Four number writes against a
     * measured 1.5-2.8 kills a second.
     */
    this.corpseX = e.x;
    this.corpseY = e.y;
    this.corpseHue = e.hue;
    this.hasCorpse = true;
    /*
     * `MAX_MULTIPLIER` is applied HERE as well, and until now it was not.
     *
     * The cap was written at the shard-pickup site in `updateNotes` and this,
     * the other of the two places the combo is incremented, incremented it
     * unconditionally. So the cap held for exactly half the economy and the
     * declaration's own summary — "highest multiplier a run can reach" — was
     * false for every run: measured headless with `tools/deadhunt-branches.mjs`
     * over ten runs, the combo peaked at 182 against a cap of 60, and 19
     * score-threshold extends were handed out across those runs.
     *
     * That is precisely the failure the note-site comment describes and
     * believes it prevented. Score scales with the multiplier and extends scale
     * with score, so an uncapped kill path re-creates the "a single wave earned
     * 240,000 points and three extra lives" case one increment further along.
     *
     * The cap and not the increment is what moves: raising `MAX_MULTIPLIER` is
     * a balance decision for someone who can play the game, and 60 has never
     * actually been in force, so this is the first build in which the number
     * means anything at all. Expect peak score to fall by roughly a third and
     * the `combo` signal the arrangement reads to sit lower and flatter at the
     * top end — `combo:milestone` still fires every 25 up to the cap.
     */
    if (this.combo < MAX_MULTIPLIER) this.combo++;
    this.comboTimer = 6;
    // The multiplier comes from collected notes now, so it does the work a
    // dedicated x2 powerup used to do — and it does it as a skill expression
    // rather than a lucky drop.
    this.score += Math.round(e.score * (1 + this.combo * 0.025));
    /*
     * Notes scale with what the enemy cost to kill.
     *
     * These were flat per archetype, set when the whole roster died in a shot
     * or two. The rebalance made enemies ~2.5x tougher and cut group sizes, so a
     * run went from 42-54 kills to about 20 — and notes, combo and therefore the
     * multiplier all fell with it. Measured: peak multiplier x7 over four
     * minutes, against the x9 the lead's descant needs, so the one reward that
     * makes the music *better* rather than louder never fired once in real play.
     *
     * Paying by health restores the economy without handing out free score: a
     * tougher enemy took longer to kill and now scatters proportionally more,
     * which is also what it should always have done.
     */
    /*
     * hp/12, not hp/6. The first attempt at this took the peak multiplier from
     * x7 to x61 — the cap — which is the failure the MAX_MULTIPLIER comment
     * warns about: a multiplier that outruns the difficulty curve turns the
     * endgame into a formality. The point was to restore an economy the
     * rebalance had starved, not to hand out a maxed combo for free.
     */
    /*
     * The same toughness formula, now asking `progression` for the TIER SPLIT
     * as well as the count.
     *
     * `shardsForKill` returns the same total this used to compute, so nothing
     * about the density of the field changed; what is new is that a tough kill
     * pays in `major` and `rare` shards rather than in more of the same. That
     * is Vampire Survivors' blue/green/red, and the reason it matters here is
     * that it makes a big kill worth crossing the arena for even when the
     * player is not short of shards.
     */
    this.spawnShards(e.x, e.y, prog.shardsForKill(e.maxHp, e.archetype === 'conductor'));
    if (this.popups.length < 14) {
      const gained = Math.round(e.score * (1 + this.combo * 0.03));
      this.popups.push({
        x: e.x,
        y: e.y,
        text: this.combo > 1 ? `${gained}  x${1 + this.combo}` : String(gained),
        age: 0,
        hue: e.hue,
        big: e.archetype === 'conductor' || e.archetype === 'subdrop',
      });
    }
    if (this.combo > 0 && this.combo % 25 === 0) this.bus.emit('combo:milestone', { value: this.combo });

    const big = e.archetype === 'conductor' || e.archetype === 'subdrop';
    this.particles.burst(this.rng, e.x, e.y, big ? 60 : 18, big ? 420 : 220, e.hue, big ? 0.9 : 0.5, big ? 5 : 3);
    this.particles.ring(e.x, e.y, e.radius * (big ? 3 : 1.8), e.hue, big ? 0.5 : 0.3);
    /*
     * 0.28, not 0.12, and the old number was invisible rather than subtle.
     *
     * `Camera.update` computes the shake amplitude as `trauma * trauma * 22`
     * (`camera.ts:52`), which is quadratic on purpose so that small hits stay
     * quiet and big ones are violent. The consequence nobody checked is that
     * the quiet end collapses: 0.12 squares to 0.0144 and yields a peak
     * displacement of **0.32 pixels**. On any display that is no shake at all.
     * The most frequent event in the game -- a kill, 78 to 153 times a minute
     * measured off `arena` -- was writing to a feedback channel that could not
     * express it, and every discussion of the game feeling mushy was downstream
     * of that.
     *
     * 0.28 squares to 1.7px, which reads as a distinct knock without becoming
     * the boss treatment. `big` stays at 0.55 (6.7px) so the gap between a mob
     * and a conductor is preserved -- the point is to lift the floor off zero,
     * not to flatten the range.
     *
     * NO HITSTOP ON AN ORDINARY KILL, deliberately, and this is the part worth
     * arguing. `Camera.freeze` pauses the whole SIMULATION (`consumeHitstop`
     * returns 0 dt), and it is `Math.max`, so concurrent kills do not stack --
     * but consecutive ones do, one after another. At today's 1.55 kills/second
     * a 35ms freeze each would already be 5% of the run spent frozen, and the
     * density work this turnaround is heading for is explicitly aiming to
     * multiply the kill rate several times over. That ends in a game that
     * stutters continuously and reads as frame drops, not as impact. Vampire
     * Survivors, the reference for this, has no hitstop on trash at all: it
     * sells a kill with particles, numbers and sound, and reserves the freeze
     * for events that are actually rare. `big` keeps its 0.06 for exactly that
     * reason.
     */
    this.camera.shake(big ? 0.55 : 0.28);
    if (big) this.camera.freeze(0.06);
    this.shock(e.x, e.y, big ? 260 : 130, big ? 2600 : 900);

    /*
     * A subdrop's death used to scatter an 18-bullet ring — the one place in
     * the game a corpse was still dangerous. There is nothing to scatter, so it
     * KNOCKS instead: everything near it, including the player's problems,
     * goes outward. It is the one enemy death that gives the player floor, and
     * it keeps the shape's character (heavy, low, concussive) in the currency
     * the game now runs on.
     */
    if (e.archetype === 'subdrop') {
      this.repel(e.x, e.y, 180, 420, e.hue);
      this.particles.burst(this.rng, e.x, e.y, 26, 260, e.hue, 0.5, 4);
    }

    /*
     * Thirty seconds, not three kills. See `secsSinceDrop` for why the unit
     * changed; this is the number.
     *
     * Three kills, alongside per-archetype chances that had themselves been
     * raised 1.5x, produced a drop roughly every other kill — so the loadout
     * was permanently full, the cap never came into play, and a pickup could
     * not feel like anything because there was no state for it to be a change
     * from. The chances in enemies.ts come down by about half with this.
     *
     * Aimed at a drop every 20-25 seconds against durations of 23-35s, which
     * puts the expected loadout a little over one and leaves the player holding
     * nothing perhaps a third of the time. That last part is the point and not
     * a regression: `tools/deadair.mjs` gates `noPowerupsHeld` at 55% and its
     * comment says powerups "are supposed to be the norm rather than the
     * exception" — still true at a third, and a third is what makes the norm
     * legible.
     */
    /*
     * There is no `dropBoost` term any more, because it could never be
     * anything but 1.
     *
     * It read `this.player.powerups.magnet ? 1.6 : 1`, written when MAGNET was
     * a field drop. MAGNET is a rig item now and its entry in `POWERUPS` carries
     * `weight: 0`, so it cannot be rolled; `Player.addPowerup` has exactly one
     * call site (`updateDrops`) and the only kinds that reach it are `bomb`,
     * `overdrive` and the `encore` the world sends — `player.powerups` cannot
     * contain `magnet` in any run. Measured over 115,200 simulated steps with
     * `tools/deadhunt-ranges.mjs`: held on 0 of them.
     *
     * Deliberately deleted rather than re-pointed at `this.mods.pickupRadius`.
     * A magnet build boosting the drop rate might well be the right design, but
     * it is a rate the powerup economy was never tuned against — the pity timer
     * and the per-archetype chances in `enemies.ts` are both denominated in it,
     * and this file's own comment records three separate budgets already broken
     * by a rate moving underneath them. Restoring the term is a balance
     * decision, not a repair.
     */
    if (this.rng.next() < e.dropChance || this.secsSinceDrop >= 30) {
      this.dropPowerup(e.x, e.y);
    }
    // Two, not three. A boss already widens the loadout by a slot permanently,
    // which is the reward that lasts; three consumables on top of it refilled
    // every slot the widening had just created.
    if (e.archetype === 'conductor') {
      for (let i = 0; i < 2; i++) this.dropPowerup(e.x + this.rng.range(-60, 60), e.y);
    }

    // Echoes split into two smaller copies — the statement and its repeat. A
    // chain of them is the most satisfying thing to shoot in the game.
    if (e.splits > 0 && e.generation < 1 && this.enemies.length < 40) {
      for (let i = 0; i < e.splits; i++) {
        // A child inherits whether the parent lunged. The standoff argument is
        // gone with the standoff ring; see `spawnEnemy`.
        const child = spawnEnemy(
          'echo',
          e.x + (i === 0 ? -22 : 22),
          e.y,
          this.plan.difficulty,
          e.lunge !== null,
          i === 0 ? 1 : -1,
        );
        child.generation = e.generation + 1;
        child.splits = 0;
        child.radius = e.radius * 0.62;
        child.hp = child.maxHp = Math.max(2, Math.round(e.maxHp * 0.4));
        child.score = Math.round(e.score * 0.45);
        child.dropChance = e.dropChance * 0.5;
        child.vy = e.vy * 1.25;
        this.enemies.push(child);
        this.bus.emit('enemy:spawn', { id: child.id, archetype: child.archetype });
      }
    }

    this.bus.emit('enemy:death', { id: e.id, archetype: e.archetype, byPlayer: true });
  }

  /**
   * Rolls a drop, rationing OVERDRIVE to one per `OVERDRIVE_MIN_GAP` seconds.
   *
   * The clock starts when the drop SPAWNS, not when it is collected, so a
   * missed one still counts. Otherwise a player who walks past an OVERDRIVE
   * leaves the floor free to grow a second one, and the pile is back.
   */
  private rollDrop() {
    const def = pickPowerup(this.rng.next(), (kind) =>
      kind === 'overdrive' && this.time - this.lastOverdriveDrop < OVERDRIVE_MIN_GAP);
    if (def.kind === 'overdrive') this.lastOverdriveDrop = this.time;
    return def;
  }

  /** Every path that produces a drop clears the dry spell, including a boss's. */
  private dropPowerup(x: number, y: number): void {
    this.secsSinceDrop = 0;
    const def = this.rollDrop();
    this.drops.push({ x, y, vx: this.rng.range(-40, 40), vy: 0, kind: def.kind, age: 0, alive: true });
  }

  // -------------------------------------------------------------------------
  // collision
  // -------------------------------------------------------------------------

  private steerPlayerBullets(dt: number): void {
    const pb = this.playerBullets;
    if (!this.enemies.length) return;
    for (let i = 0; i < pb.count; i++) {
      /*
       * PER BULLET, AND IT USED TO BE ALL OF THEM.
       *
       * The old guard was `mods.homing > 0` at the call site and then every
       * player bullet in the pool turned. That made the rig's `homing` field a
       * switch whose three levels were indistinguishable — see
       * `BulletFlag.Seeking`. Now a bolt seeks because the rule that fired it
       * said so, and the inner O(enemies) scan below only runs for those.
       */
      if (!(pb.flags[i] & BulletFlag.Seeking)) continue;
      // Find the nearest enemy ahead of the bullet.
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < this.enemies.length; j++) {
        const e = this.enemies[j];
        const d = dist2(pb.x[i], pb.y[i], e.x, e.y);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) continue;
      const e = this.enemies[best];
      const want = Math.atan2(e.y - pb.y[i], e.x - pb.x[i]);
      let d = (want - pb.angle[i]) % TAU;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      pb.angle[i] += clamp(d, -6 * dt, 6 * dt);
    }
  }

  /* ---------------------------------------------------------------------- *
   * THE PROPERTY SUBSTRATE — the five methods every damage site goes through.
   *
   *   propSlot     intern an instrument's set and hand back an index
   *   hurt         apply damage, honouring freeze vulnerability and bleed
   *   applyStatus  write the durations and stacks a hit leaves behind
   *   onHit        the splash properties: chain, quake, lance, leech, brood
   *   tickStatus   one enemy's live statuses, once per step
   *
   * Everything that damages an enemy on the player's behalf goes through
   * `hurt`, and that is the point: before this there were seven separate
   * `e.hp -= x` sites and a property could only ever have reached whichever
   * ones somebody remembered.
   * ---------------------------------------------------------------------- */

  /**
   * Intern `id`'s property set at `level` and return its index.
   *
   * Keyed by id AND level, so a weapon that levels up gets a new slot rather
   * than mutating the one its bolts in flight are pointing at. Cleared on
   * `start()` so a long series of runs cannot walk the table into its cap.
   */
  private propSlot(id: string, level: number): number {
    const key = `${id}@${level}`;
    const had = this.propIndex.get(key);
    if (had !== undefined) return had;
    const props = instrumentProps(id, level);
    // A weapon with no properties shares slot 0 rather than burning a slot on
    // an empty record; the fusion results that are pure stat blocks are all of
    // them, and a run holding four of those should still intern nothing.
    if (!hasProps(props)) {
      this.propIndex.set(key, 0);
      return 0;
    }
    if (this.propSets.length >= 256) {
      this.propOverflow++;
      return 0;
    }
    const i = this.propSets.length;
    this.propSets.push(props);
    this.propOwners.push(id);
    this.accelBySrc[i] = props.accel;
    this.propIndex.set(key, i);
    return i;
  }

  /** The set the instrument currently firing carries. */
  private get activeProps(): Props {
    return this.propSets[this.activeProp];
  }

  /**
   * Spawn a player bolt carrying the firing instrument's properties.
   *
   * Every `fire*` routine goes through this rather than `playerBullets.spawn`
   * so that a new delivery shape cannot be written that silently drops the
   * property — the defect this whole pass exists to remove, re-created one
   * level down. `fireKillEcho` and `fireGhost` deliberately do NOT: an echo is
   * HOMING's rule and a ghost is the corpse's, neither is the weapon's hit.
   */
  private spawnBolt(spec: Parameters<BulletPool['spawn']>[0]): number {
    const p = this.activeProps;
    return this.playerBullets.spawn({
      ...spec,
      src: this.activeProp,
      splits: p.split,
      // The floor is a fraction of what the bolt LEFT WITH, so it has to be
      // computed here — by the time the bolt is eroding, its original damage
      // is gone. Zero when nothing erodes, which costs one multiply.
      dmgFloor: p.erode > 0 ? (spec.damage ?? 1) * p.erodeFloor : 0,
    });
  }

  /**
   * Deal `amount` to `e` on the player's behalf, and return what landed.
   *
   * TWO PROPERTIES LIVE HERE BECAUSE THEY MODIFY THE HIT ITSELF.
   *
   * `freeze` makes a body take `PROP.freezeVuln` more from EVERYTHING, which
   * is Ball x Pit's "frozen enemies take +25% damage" and is what makes a 5%
   * freeze chance worth carrying at all — the value is in what your other
   * three weapons then do to the thing you froze.
   *
   * `bleed` is paid HERE and not on a clock: `bleedDmg` per stack, on the hit.
   * `discrete` is false for the continuous sources (wells, rings, held beams),
   * because a lance touching a body 120 times a second would cash eight bleed
   * stacks 120 times a second — the same cadence problem `Effect.tick` solves
   * for statuses, answered here by not charging it at all. A pool does not
   * reopen a wound; a bolt does.
   */
  private hurt(e: Enemy, amount: number, discrete: boolean): number {
    if (!(amount > 0) || e.invuln > 0 || !e.alive) return 0;
    let dmg = amount;
    if (e.freezeTime > 0) {
      const extra = dmg * (PROP.freezeVuln - 1);
      dmg += extra;
      this.propDamage.freeze += extra;
    }
    /*
     * VULN IS THE GENERAL FORM OF THE LINE ABOVE, and it sits beside it rather
     * than replacing it: freeze's +25% is a property of being frozen, vuln's
     * stacks are a property of having been irradiated, cursed or frostburnt,
     * and a body can be both. Both are credited to their own column, so a
     * report can say which of the two did the softening.
     *
     * Computed off `amount` rather than off the running `dmg`, so the two do
     * not multiply into each other — a frozen body at five stacks takes
     * +25% +50%, not +87.5%. Additive is the honest reading of "takes 10% more
     * per stack" and it is the one that stays bounded.
     */
    if (e.vulnStacks > 0) {
      const extra = amount * e.vulnStacks * e.vulnPer;
      dmg += extra;
      this.propDamage.vuln += extra;
    }
    if (discrete && e.bleedStacks > 0) {
      const bled = e.bleedStacks * e.bleedDmg;
      dmg += bled;
      this.propDamage.bleed += bled;
      this.propFires.bleed++;
    }
    e.hp -= dmg;
    if (discrete) this.propMoments.hit++;
    if (e.hitFlash < 0.05) e.hitFlash = 0.05;
    if (e.hp <= 0) e.alive = false;
    return dmg;
  }

  /**
   * Write whatever `p` leaves on `e`: stacks, timers and the status bitmask.
   *
   * CHANCES ARE COUNTED WHETHER OR NOT THE ROLL LANDS, which is the difference
   * between "the property is broken" and "this run never rolled it". A 5%
   * freeze with 4,000 chances and 0 fires is a bug; a 5% freeze with 3 chances
   * and 0 fires is a quiet run, and only the denominator can tell them apart.
   *
   * A CONDUCTOR IS IMMUNE TO FREEZE, HOLD AND CHARM. A boss held motionless by
   * a 5% roll is not a fight, and a charmed boss is not a boss — the same
   * reasoning `updateWells` uses to exempt it from being dragged. It still
   * burns, bleeds, is poisoned, slowed and blinded, so nothing is inert
   * against it.
   */
  private applyStatus(e: Enemy, p: Props): void {
    if (!e.alive) return;
    const boss = e.archetype === 'conductor';
    if (p.burn > 0 && p.burnStack > 0) {
      this.propChances.burn++;
      e.burnStacks = Math.min(PROP.burnMax, e.burnStacks + p.burnStack);
      e.burnTime = PROP.burnTime;
      if (p.burn > e.burnDps) e.burnDps = p.burn;
      e.status |= Status.Burn;
      this.propFires.burn++;
    }
    if (p.poison > 0 && p.poisonStack > 0) {
      this.propChances.poison++;
      e.poisonStacks = Math.min(PROP.poisonMax, e.poisonStacks + p.poisonStack);
      e.poisonTime = PROP.poisonTime;
      if (p.poison > e.poisonDps) e.poisonDps = p.poison;
      e.status |= Status.Poison;
      this.propFires.poison++;
    }
    if (p.bleed > 0 && p.bleedStack > 0) {
      this.propChances.bleed++;
      e.bleedStacks = Math.min(PROP.bleedMax, e.bleedStacks + p.bleedStack);
      e.bleedTime = PROP.bleedTime;
      if (p.bleed > e.bleedDmg) e.bleedDmg = p.bleed;
      e.status |= Status.Bleed;
      // NOT counted as a fire here: a stack applied is not a stack PAID, and
      // the thing worth measuring about bleed is whether it ever costs anybody
      // anything. `hurt` counts the fire, at the hit that cashes it.
    }
    if (p.freeze > 0 && !boss) {
      this.propChances.freeze++;
      if (this.rng.next() < p.freeze) {
        if (PROP.freezeTime > e.freezeTime) e.freezeTime = PROP.freezeTime;
        e.status |= Status.Freeze;
        this.propFires.freeze++;
      }
    }
    if (p.hold > 0 && !boss) {
      this.propChances.hold++;
      // No roll: a snare holds what is standing in it. The duration is short
      // and renewed on every field tick, so the hold reads as "while you are
      // in it, plus a moment" rather than as a freeze with a long fuse.
      if (p.hold > e.freezeTime) e.freezeTime = p.hold;
      e.status |= Status.Freeze;
      this.propFires.hold++;
    }
    if (p.slow > 0) {
      this.propChances.slow++;
      e.slowTime = PROP.slowTime;
      if (p.slow > e.slowFactor) e.slowFactor = p.slow;
      e.status |= Status.Slow;
      this.propFires.slow++;
    }
    if (p.blind > 0) {
      this.propChances.blind++;
      if (this.rng.next() < p.blind) {
        e.blindTime = PROP.blindTime;
        e.status |= Status.Blind;
        this.propFires.blind++;
      }
    }
    if (p.charm > 0 && !boss) {
      this.propChances.charm++;
      if (this.rng.next() < p.charm) {
        e.charmTime = PROP.charmTime;
        e.status |= Status.Charm;
        this.propFires.charm++;
      }
    }
    /*
     * VULN. No roll — a radiation stack is not a chance, it is what the hit
     * leaves. A CONDUCTOR IS NOT EXEMPT: this is the one fusion-tier status a
     * boss can carry, and deliberately so, because "soften the boss with one
     * weapon and cash it with the other three" is the whole reason the
     * property exists and a boss is the only target that lives long enough for
     * a twelve-second window to matter.
     */
    if (p.vuln > 0 && p.vulnStack > 0) {
      this.propChances.vuln++;
      e.vulnStacks = Math.min(PROP.vulnMax, e.vulnStacks + p.vulnStack);
      e.vulnTime = PROP.vulnTime;
      if (p.vuln > e.vulnPer) e.vulnPer = p.vuln;
      e.status |= Status.Vuln;
      this.propFires.vuln++;
    }
  }

  /**
   * The splash properties: what a hit does to things it did not hit.
   *
   * CHAIN, QUAKE and LANCE are the three geometries Ball x Pit spends on
   * Lightning, Earthquake and Laser, and they are properties here rather than
   * delivery shapes for the reason `InstrumentShape` gives at length: a
   * property arcs from ANY delivery and composes into a fusion, where a shape
   * can only ever be worn by one instrument at a time.
   *
   * Each pushes a visual into a container that is already drawn — `effects`
   * for the arcs and the line, `novas` for the shock — so none of the three
   * costs a container, which was the falsification test the plan set for
   * itself.
   */
  private onHit(e: Enemy, p: Props, slot: number, x: number, y: number, angle: number): void {
    const hue = this.hueOf(this.propOwners[slot] || 'arc');

    if (p.chain > 0 && p.chainDamage > 0) {
      this.propChances.chain++;
      const reach = World.CHAIN_REACH;
      let hops = 0;
      let fromX = x;
      let fromY = y;
      const taken = new Set<Enemy>([e]);
      for (let k = 0; k < p.chain; k++) {
        let best: Enemy | null = null;
        let bestD = reach * reach;
        for (const o of this.enemies) {
          if (!o.alive || o.invuln > 0 || taken.has(o)) continue;
          const d = dist2(o.x, o.y, fromX, fromY);
          if (d < bestD) {
            bestD = d;
            best = o;
          }
        }
        if (!best) break;
        taken.add(best);
        const dealt = this.hurt(best, p.chainDamage, true);
        this.propDamage.chain += dealt;
        this.applyStatus(best, p);
        if (this.effects.length < World.MAX_EFFECTS) {
          this.effects.push({
            kind: 'beam',
            id: this.propOwners[slot],
            x: fromX,
            y: fromY,
            angle: Math.atan2(best.y - fromY, best.x - fromX),
            radius: 4,
            length: Math.hypot(best.x - fromX, best.y - fromY),
            arc: 0,
            // Zero: the damage above has already landed, and a live hitbox on
            // the arc would make the hop a second weapon.
            dps: 0,
            // 0.22s rather than 0.14: at 0.14 an arc was gone inside two frames
            // of the 120Hz step and essentially never caught the eye, which for
            // the one weapon whose whole value is what happens to the bodies it
            // did NOT hit is the difference between a mechanic and a rumour.
            // It costs nothing — `dps: 0` means the picture outliving the
            // damage changes no outcome.
            life: 0.22,
            age: 0,
            hue,
            attached: false,
            tracks: false,
            offset: 0,
            pull: 0,
            swallows: false,
            prop: 0,
            tick: 0,
          });
        }
        fromX = best.x;
        fromY = best.y;
        hops++;
      }
      if (hops > 0) this.propFires.chain++;
    }

    if (p.quake > 0 && p.quakeRadius > 0) {
      this.propChances.quake++;
      let struck = 0;
      for (const o of this.enemies) {
        if (!o.alive || o.invuln > 0 || o === e) continue;
        const rr = p.quakeRadius + o.radius;
        if (dist2(o.x, o.y, x, y) > rr * rr) continue;
        this.propDamage.quake += this.hurt(o, p.quake, true);
        this.applyStatus(o, p);
        struck++;
      }
      if (this.novas.length < World.MAX_NOVAS) {
        this.novas.push({
          x,
          y,
          r: 0,
          alive: true,
          maxR: p.quakeRadius,
          /*
           * SLOW ENOUGH TO SEE. At `radius * 5` a 330px shock crossed its own
           * radius in 0.2 seconds — screenshotted mid-run in a real browser it
           * was a 40px ring, which is to say the largest area effect in the
           * roster was drawing as a spark. `* 2.2` puts the crossing at about
           * 0.45s, which is a wave you watch arrive. It costs nothing in
           * damage: the hit above is instantaneous and area-flat, and this
           * ring carries `dps: 0`.
           */
          speed: Math.max(260, p.quakeRadius * 2.2),
          // Visual only: the damage is instantaneous and area-flat above, so a
          // wider shock hits more things rather than each thing more weakly.
          dps: 0,
          hold: 0,
          hue,
          shoves: false,
          prop: 0,
          tick: 0,
        });
      }
      this.camera.shake(0.05);
      if (struck > 0) this.propFires.quake++;
    }

    if (p.lance > 0 && p.lanceRange > 0) {
      this.propChances.lance++;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let cut = 0;
      for (const o of this.enemies) {
        if (!o.alive || o.invuln > 0 || o === e) continue;
        const dx = o.x - x;
        const dy = o.y - y;
        const along = dx * cos + dy * sin;
        if (along < -p.lanceRange || along > p.lanceRange) continue;
        const across = Math.abs(-dx * sin + dy * cos);
        if (across > World.LANCE_HALF_WIDTH + o.radius) continue;
        this.propDamage.lance += this.hurt(o, p.lance, true);
        this.applyStatus(o, p);
        cut++;
      }
      if (this.effects.length < World.MAX_EFFECTS) {
        this.effects.push({
          kind: 'beam',
          id: this.propOwners[slot],
          x: x - cos * p.lanceRange,
          y: y - sin * p.lanceRange,
          angle,
          // Drawn WIDER than it cuts, and held longer, for the same reason the
          // chain hop is: `dps: 0` makes this a picture, and a 15px stripe that
          // lasted a sixth of a second was one the browser almost never caught
          // — which is to say the player almost never did either.
          radius: World.LANCE_HALF_WIDTH * 1.6,
          length: p.lanceRange * 2,
          arc: 0,
          dps: 0,
          life: 0.3,
          age: 0,
          hue,
          attached: false,
          tracks: false,
          offset: 0,
          pull: 0,
          swallows: false,
          prop: 0,
          tick: 0,
        });
      }
      if (cut > 0) this.propFires.lance++;
    }

    if (p.leech > 0) {
      this.propChances.leech++;
      /*
       * THE ROLL AND THE HEAL ARE COUNTED SEPARATELY, and the first version of
       * this conflated them: `roll < leech && hp < maxHp` recorded a fire only
       * when there was somewhere to put the health, so a player at full health
       * made SIPHON look broken rather than look wasted. `propfire` read 91
       * chances and 0 fires and called it "installed and inert", which is a
       * true sentence about the counter and a false one about the property.
       *
       * The roll is the property firing. `propDamage.leech` is what it was
       * worth, and the two being different is a real thing about the item.
       */
      if (this.rng.next() < p.leech) {
        this.propFires.leech++;
        if (this.player.hp < this.player.maxHp) {
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
          this.propDamage.leech += 1;
          this.particles.emit(this.player.x, this.player.y, 0, -40, 0.3, 4, 340, ParticleShape.Ring, 1);
        }
      }
    }

    /*
     * REND — a share of what is LEFT, taken off the body that was hit.
     *
     * Here rather than in `hurt` for two reasons. It must be attributable to
     * its own column, and `hurt` cannot separate "the bolt's damage" from "the
     * rend" once they are summed; and it must be paid ONCE per discrete hit,
     * where `hurt` is also called by every continuous source at 120 Hz. A pool
     * that removed 6% of current health per step would kill anything standing
     * in it in under a second, which is not a property, it is a floor trap.
     *
     * `discrete: false` on the inner call so the rend does not also cash the
     * body's bleed stacks — the hit that carried it already did.
     */
    if (p.rend > 0 && e.alive) {
      this.propChances.rend++;
      const bite = e.hp * p.rend;
      const dealt = this.hurt(e, bite, false);
      if (dealt > 0) {
        this.propDamage.rend += dealt;
        this.propFires.rend++;
      }
    }

    /*
     * EXECUTE — Ball x Pit's Black Hole and Reaper, which simply delete a
     * non-boss.
     *
     * Credited with the hit points it actually removed rather than with a
     * count alone, so a run can say what the roll was WORTH: an execute that
     * only ever lands on a body already at 2 hp is a fire count that looks
     * healthy and a mechanic that does nothing.
     */
    if (p.execute > 0 && e.alive && e.archetype !== 'conductor') {
      this.propChances.execute++;
      if (this.rng.next() < p.execute) {
        const left = e.hp;
        e.hp = 0;
        e.alive = false;
        this.propDamage.execute += Math.max(0, left);
        this.propFires.execute++;
        this.particles.emit(e.x, e.y, 0, 0, 0.4, 10, 280, ParticleShape.Ring, 1);
      }
    }

    if (p.brood > 0) {
      this.propChances.brood++;
      if (this.rng.next() < p.brood && this.summonsLive < World.MAX_SUMMONS) {
        /*
         * REUSES `BulletFlag.Summon` AND `updateSummons` OUTRIGHT — no
         * container, no update loop, and `tools/effectsdraw.mjs` already
         * asserts sprite type 2 exists. This is what the `spawn` SHAPE used to
         * be; as a property it can now be carried by any delivery and by any
         * fusion, which is strictly more than the shape could do.
         */
        this.playerBullets.spawn({
          x,
          y,
          angle: this.rng.range(0, TAU),
          speed: 320,
          radius: 8,
          ttl: Math.max(1, World.BROOD_LIFE),
          damage: Math.max(1, p.chainDamage || p.quake || 12),
          type: 2,
          flags: BulletFlag.Summon,
          bounces: 3,
          src: 0,
        });
        this.summonsActive = true;
        this.propFires.brood++;
      }
    }
  }

  /**
   * One enemy's live statuses, once per step. Only reached when `e.status` is
   * non-zero, which is the whole performance argument for the bitmask.
   *
   * BURN AND POISON DAMAGE GOES STRAIGHT TO `hp` rather than through `hurt`.
   * That is deliberate and it is not a shortcut: a damage-over-time tick must
   * not cash a bleed stack (that is what being hit is for) and must not be
   * amplified by the freeze vulnerability, or a frozen body would take 25%
   * more from a fire that was already burning before it froze. `propDamage` is
   * credited here so the two are still measured.
   */
  private tickStatus(e: Enemy, dt: number): void {
    const st = e.status;
    if (st & Status.Burn) {
      this.propTicks.burn++;
      const d = e.burnStacks * e.burnDps * dt;
      e.hp -= d;
      this.propDamage.burn += d;
      e.burnTime -= dt;
      if (e.burnTime <= 0) {
        e.burnStacks = 0;
        e.burnDps = 0;
        e.status &= ~Status.Burn;
      }
    }
    if (st & Status.Poison) {
      this.propTicks.poison++;
      const d = e.poisonStacks * e.poisonDps * dt;
      e.hp -= d;
      this.propDamage.poison += d;
      e.poisonTime -= dt;
      if (e.poisonTime <= 0) {
        e.poisonStacks = 0;
        e.poisonDps = 0;
        e.status &= ~Status.Poison;
      }
    }
    if (st & Status.Bleed) {
      this.propTicks.bleed++;
      e.bleedTime -= dt;
      if (e.bleedTime <= 0) {
        e.bleedStacks = 0;
        e.bleedDmg = 0;
        e.status &= ~Status.Bleed;
      }
    }
    if (st & Status.Freeze) {
      this.propTicks.freeze++;
      // HOLD shares the freeze timer, so a snare and an ice shard on the same
      // body are one effect rather than two competing ones. `propTicks.hold`
      // is credited alongside, so the two are still separable in the report.
      this.propTicks.hold++;
      e.freezeTime -= dt;
      if (e.freezeTime <= 0) e.status &= ~Status.Freeze;
    }
    if (st & Status.Slow) {
      this.propTicks.slow++;
      e.slowTime -= dt;
      if (e.slowTime <= 0) {
        e.slowFactor = 0;
        e.status &= ~Status.Slow;
      }
    }
    if (st & Status.Blind) {
      this.propTicks.blind++;
      e.blindTime -= dt;
      if (e.blindTime <= 0) e.status &= ~Status.Blind;
    }
    if (st & Status.Vuln) {
      this.propTicks.vuln++;
      e.vulnTime -= dt;
      if (e.vulnTime <= 0) {
        e.vulnStacks = 0;
        e.vulnPer = 0;
        e.status &= ~Status.Vuln;
      }
    }
    if (st & Status.Charm) {
      this.propTicks.charm++;
      /*
       * A CHARMED BODY FIGHTS THE NEAREST THING THAT IS NOT ALSO CHARMED.
       *
       * One target rather than everything in radius, and the nearest rather
       * than all of them, because this loop is O(enemies) per charmed body and
       * the field is heading upward. At the shipped chances there is rarely
       * more than one turncoat alive; if a fusion ever makes charm common this
       * is the line to revisit, and `propTicks.charm` is what would show it.
       */
      let best: Enemy | null = null;
      let bestD = Infinity;
      for (const o of this.enemies) {
        if (o === e || !o.alive || o.invuln > 0 || (o.status & Status.Charm) !== 0) continue;
        const d = dist2(o.x, o.y, e.x, e.y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        /*
         * IT WALKS AT WHAT IT IS FIGHTING, and this is not decoration.
         *
         * The first version only dealt damage inside a fixed radius and left
         * the body drifting on its own `move` — which is a path aimed at the
         * PLAYER. `tools/propfire.mjs` measured the result: 2 charms applied,
         * 0 hit points dealt, because the turncoat's neighbours had walked out
         * of range while it obediently kept chasing the person it was supposed
         * to be defending. "It fights for you" was prose the simulation did not
         * deliver, in the exact form this file has a heading for.
         *
         * `updateEnemies` suppresses the normal move for a charmed body (the
         * same line freeze uses), so this IS its movement while the charm
         * lasts. The damage still needs contact, so the two halves are one
         * behaviour rather than a walk plus an aura.
         */
        const dx = best.x - e.x;
        const dy = best.y - e.y;
        const d = Math.sqrt(bestD) || 1;
        const step = World.CHARM_SPEED * dt;
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
        if (d <= PROP.charmRadius + best.radius + e.radius) {
          const dealt = PROP.charmDps * dt;
          best.hp -= dealt;
          this.propDamage.charm += dealt;
          if (best.hitFlash < 0.04) best.hitFlash = 0.04;
          if (best.hp <= 0) best.alive = false;
        }
      }
      e.charmTime -= dt;
      if (e.charmTime <= 0) e.status &= ~Status.Charm;
    }
    if (e.hp <= 0) e.alive = false;
  }

  private collidePlayerBullets(): void {
    const pb = this.playerBullets;
    for (let i = pb.count - 1; i >= 0; i--) {
      for (let j = 0; j < this.enemies.length; j++) {
        const e = this.enemies[j];
        /*
         * Small targets get a generous hitbox; large ones get none.
         *
         * This was a plain `e.radius + pb.radius`, with no leniency at all,
         * while enemy-versus-player contact has always used a forgiving 0.62
         * factor. So the smaller an enemy was, the harder it was to shoot —
         * and measured with tools/ttk.mjs, `stutter` at radius 10 had an
         * effective dps of 3.2 against 22-34 for everything else. It was the
         * slowest thing in the game to kill despite having the least health,
         * purely because shots slipped past it, which reads as a weapon that
         * does not work rather than as an enemy that is tough.
         *
         * The bonus shrinks to nothing by radius 16, so nothing bigger than a
         * pluck is affected and bosses are untouched. It buys aim, not damage.
         */
        const aim = Math.max(0, 16 - e.radius) * 0.8;
        const r = e.radius + aim + pb.radius[i];
        if (dist2(pb.x[i], pb.y[i], e.x, e.y) > r * r) continue;

        if (e.invuln > 0) {
          // Shots still land visually during a phase transition; they just do
          // nothing, which reads as a shield rather than as a bug.
          this.particles.emit(pb.x[i], pb.y[i], 0, -40, 0.12, 2, 200, ParticleShape.Dot, 4);
          if (pb.type[i] !== 1) {
            pb.remove(i);
            break;
          }
          continue;
        }
        /*
         * EVERY PROPERTY THAT ACTS ON A HIT ACTS HERE, in this order:
         *
         *   1. the damage itself, through `hurt`, which is where the frozen
         *      target's +25% and the bleed stacks are cashed
         *   2. the statuses the bolt leaves behind
         *   3. the splash — chain, quake, lance, leech, brood
         *   4. what happens to the BOLT: ghost, erode, split, burst, dark
         *
         * The order matters in one place and only one: 1 before 2, so a hit
         * that freezes does not also get the freeze bonus on itself. That is
         * the Ball x Pit reading — the ice makes the NEXT hit hurt — and it is
         * what stops a high-chance freeze compounding with its own multiplier.
         */
        const slot = pb.src[i];
        const props = this.propSets[slot];
        this.hurt(e, pb.damage[i], true);
        e.hitFlash = 0.07;
        this.particles.emit(pb.x[i], pb.y[i], 0, -60, 0.16, 3, e.hue, ParticleShape.Dot, 3);
        this.bus.emit('enemy:hit', { archetype: e.archetype, lethal: e.hp <= 0 });
        if (slot !== 0) {
          this.applyStatus(e, props);
          this.onHit(e, props, slot, pb.x[i], pb.y[i], pb.angle[i]);
          this.propHitEffects(props, slot, i, pb.x[i], pb.y[i], pb.angle[i]);
        }


        if (e.hp <= 0) {
          e.alive = false;
          this.ruleChances.killEcho++;
          /*
           * HOMING FIRES HERE — in place, at the hit that did it.
           *
           * NOT at `enemy:death`, and the difference matters. That event is
           * emitted from the reap loop and from `onEnemyKilled`, neither of
           * which knows what killed the enemy; an echo has to know it was a
           * player BULLET and where that bullet was, or a body burned down by
           * an aura would re-fire a bolt from nothing. This is the only line in
           * the file that has both.
           */
          if (this.rules.killEcho > 0 && !(pb.flags[i] & BulletFlag.Echo)) {
            this.fireKillEcho(e, pb.damage[i], pb.speed[i], pb.radius[i]);
          }
        }
        /*
         * A GHOST STRIKES AND RECOILS; everything else is consumed.
         *
         * SOSTENUTO's allies carry `bounces` as STRIKES REMAINING, and an ally
         * deleted by its own first hit is a homing bolt with a long fuse rather
         * than something that fights beside you. The recoil is not decoration:
         * it is the rate limiter. A summon left overlapping the body it just
         * struck would re-hit on all 120 steps a second, which is exactly why
         * `fireSpawn`'s own note refuses `pierce` for this shape — so the ghost
         * is thrown back out of contact and has to come in again.
         *
         * VIBRATO's retinue is untouched: `fireSpawn` sets no `bounces`, so its
         * summons arrive at zero and fall through to the removal below, which
         * is the behaviour that shipped.
         */
        if (pb.flags[i] & BulletFlag.Summon && pb.bounces[i] > 0) {
          pb.bounces[i]--;
          pb.x[i] -= Math.cos(pb.angle[i]) * World.GHOST_RECOIL;
          pb.y[i] -= Math.sin(pb.angle[i]) * World.GHOST_RECOIL;
          pb.target[i] = -1;
          break;
        }
        /*
         * GHOST AND ERODE DECIDE THE BOLT'S FATE.
         *
         * `ghost` is Ball x Pit's Ghost ball and it is a PROPERTY rather than
         * the `pierce` stat because the two answer different questions:
         * `pierce` is set by the table and folded into `type`, and a fusion
         * that inherits Ghost has to be able to acquire pass-through without
         * anybody re-authoring its stat block. Both routes end here.
         *
         * `erode` is Stone: the bolt keeps travelling and loses a fraction of
         * itself at every body, down to `dmgFloor` — which is why GRAVEL
         * carries an unlimited `pierce` in its stat block AND an erode
         * property. Without pass-through there is nothing to erode over.
         */
        if (props.erode > 0 && pb.damage[i] > pb.dmgFloor[i]) {
          this.propChances.erode++;
          const before = pb.damage[i];
          pb.damage[i] = Math.max(pb.dmgFloor[i], before * (1 - props.erode));
          if (pb.damage[i] < before) {
            // AND IT VISIBLY WEARS DOWN — the same argument ACCELERANDO's
            // growth is made on, with the sign reversed. A stone that has cut
            // through four bodies should not look like one that has just left.
            pb.radius[i] = Math.max(3, pb.radius[i] * 0.86);
            this.propFires.erode++;
          }
        }
        if (props.ghost > 0) {
          this.propChances.ghost++;
          this.propFires.ghost++;
          continue;
        }
        // Piercing shots keep going; everything else is consumed.
        if (pb.type[i] !== 1) {
          pb.remove(i);
          break;
        }
      }
    }
  }

  /**
   * SPLIT, BURST and DARK — the three properties that act on the BOLT rather
   * than on the body it hit.
   *
   * Split out of `collidePlayerBullets` because that loop is the hottest in
   * the file and this branch only runs for a bolt that carries a property at
   * all; keeping it inline would have put four more field reads in front of
   * every ordinary hit.
   *
   * `i` IS ONLY VALID FOR THE REST OF THE CALLER'S ITERATION. Nothing here
   * removes a bullet, and every spawn appends, so the index the caller is
   * holding is not disturbed — with one exception the caller handles: a spawn
   * into a saturated pool returns -1 and is simply not made.
   */
  private propHitEffects(p: Props, slot: number, i: number, x: number, y: number, angle: number): void {
    const pb = this.playerBullets;

    if (p.split > 0) {
      this.propChances.split++;
      if (pb.splits[i] > 0) {
        pb.splits[i]--;
        /*
         * THE CLONE INHERITS ONE FEWER SPLIT, which is what bounds the whole
         * property: a bolt with four splits produces at most four clones over
         * its life and each clone produces fewer, so the worst case is linear
         * rather than the exponential that "splits on every hit" would be. The
         * clone leaves at a right angle so the pair reads as one bolt becoming
         * two rather than as a bolt stuttering.
         */
        const clone = pb.spawn({
          x,
          y,
          angle: angle + (this.rng.next() < 0.5 ? 1 : -1) * (0.5 + this.rng.next() * 0.5),
          speed: Math.max(300, pb.speed[i]),
          radius: pb.radius[i],
          ttl: 1.5,
          damage: pb.damage[i] * 0.75,
          type: pb.type[i],
          flags: pb.flags[i],
          src: slot,
          splits: pb.splits[i],
          dmgFloor: pb.dmgFloor[i],
        });
        if (clone >= 0) this.propFires.split++;
      }
    }

    if (p.burst > 0) {
      /*
       * A COOLDOWN PER INSTRUMENT, not per bolt. Ball x Pit's Egg Sac carries
       * one for the same reason: without it a weapon that scatters on contact
       * scatters on every contact of every bolt, and TUTTI at level 3 would
       * put fifty bolts into the pool from one activation into a crowd.
       */
      const owner = this.propOwners[slot];
      this.propChances.burst++;
      if (this.time >= (this.burstAt[owner] ?? 0)) {
        this.burstAt[owner] = this.time + PROP.burstCooldown;
        const n = Math.round(p.burst);
        for (let k = 0; k < n; k++) {
          pb.spawn({
            x,
            y,
            angle: angle + (k / n) * TAU,
            speed: 620,
            radius: 4,
            ttl: 0.75,
            damage: pb.damage[i] / 3,
            type: 0,
            flags: BulletFlag.DespawnOffscreen,
            // Slot 0: the lesser bolts carry the hit and not the property, or
            // a burst would burst, which is the chain reaction the cooldown
            // exists to prevent stated a second way.
            src: 0,
          });
        }
        this.propFires.burst++;
      }
    }

    if (p.dark > 1 && p.darkCooldown > 0) {
      /*
       * "DESTROYS ITSELF AFTER HITTING, 3s COOLDOWN" — the second half.
       *
       * The bolt is consumed by the ordinary path below (NOCTURNE carries
       * `pierce: 1` and no ghost), and this is the silence. Written into
       * `instrumentTimers`, which is the same clock `fireInstruments` counts
       * down, so the weapon simply does not come due — no second timer, no
       * new state, and the HUD's cooldown reading stays true.
       */
      const owner = this.propOwners[slot];
      if (owner) {
        this.propChances.dark++;
        this.instrumentTimers[owner] = Math.max(this.instrumentTimers[owner] ?? 0, p.darkCooldown);
        this.propFires.dark++;
      }
    }
  }

  /**
   * HOMING's kill echo: bolts thrown back out of a corpse at whatever is next.
   *
   * REUSES `BulletPool`, WHICH IS THE WHOLE COST. No container, no pool, no
   * per-echo bookkeeping — the echo is an ordinary player bullet carrying two
   * flags. Worst case is `killEcho` extra bullets per bullet-kill, and it
   * cannot compound because `BulletFlag.Echo` blocks an echo from echoing.
   * Measured against `MAX_PLAYER_BULLETS` (700) that is nothing: the arena runs
   * 1.5-2.8 kills a second and the bolts expire in under two.
   *
   * The bolt is `Seeking`, which is what makes the item read as HOMING at all:
   * it is thrown at the nearest live target and then keeps correcting. With
   * nothing left to hit it goes out along the dead enemy's own bearing from the
   * ship — a visible follow-through rather than a shot that silently is not
   * fired, so a player learns the mechanic on the kill that clears the wave.
   */
  private fireKillEcho(from: Enemy, damage: number, speed: number, radius: number): void {
    const n = Math.max(1, Math.round(this.rules.killEcho));
    let angle = Math.atan2(from.y - this.player.y, from.x - this.player.x);
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e === from || e.invuln > 0) continue;
      const d = dist2(e.x, e.y, from.x, from.y);
      if (d < bestD) {
        bestD = d;
        angle = Math.atan2(e.y - from.y, e.x - from.x);
      }
    }
    for (let k = 0; k < n; k++) {
      // Fanned slightly when there is more than one, so three echoes read as
      // three bolts leaving rather than as one thick one.
      const spread = n === 1 ? 0 : (k / (n - 1) - 0.5) * 0.5;
      this.playerBullets.spawn({
        x: from.x,
        y: from.y,
        angle: angle + spread,
        speed: Math.max(700, speed),
        radius: Math.max(4, radius),
        ttl: 1.4,
        damage,
        type: 0,
        flags: BulletFlag.DespawnOffscreen | BulletFlag.Seeking | BulletFlag.Echo,
      });
      this.ruleFires.killEcho++;
    }
  }

  /**
   * CONTACT DAMAGE, GRAZE AND THREAT ANALYSIS IN ONE PASS.
   *
   * This method used to be two: a sweep over 3000 slots of enemy bullets that
   * did the hit test, the pod absorb, the graze annulus and the closest-approach
   * prediction, and a separate `collideEnemies` that was five lines of
   * rectangle test bolted on afterwards. The bullet half is deleted and the
   * body half is now the whole thing, so they are one loop over `enemies` —
   * which is also the loop that costs, and running it once matters more now
   * that it is expected to walk 60+ bodies rather than 20.
   *
   * WHAT EACH OUTPUT MEANS, because three of them were renamed rather than
   * repointed in place (AGENTS.md's `pan` rule: an unchanged name lets a tool
   * keep printing a column whose definition moved):
   *
   *   `threatsNear` / `threatsVeryNear`   were `bulletsNear` / `bulletsVeryNear`.
   *   `timeToContact`                     was `timeToImpact`.
   *   `pressureCount`                     was `bulletCount`.
   *
   * `timeToContact` is the earliest closest-approach time among bodies actually
   * converging on the player, and it is a better predictor of felt danger than
   * proximity for exactly the reason it was when it read bullets: a crowd
   * moving away is not scary and the music should not pretend it is. A body's
   * velocity is `(x - prevX) / dt`, which is the only honest source here —
   * three of the six movers write positions directly and never touch `vx`/`vy`.
   *
   * THE TEST IS AGAINST THE ENEMY'S CORE, at 0.62 of its radius, so clipping a
   * wingtip is survivable and flying into the middle of something is not. That
   * is the danmaku convention the rest of the game follows and it is inherited
   * unchanged from `collideEnemies`.
   */
  private collidePlayer(dt: number): void {
    const px = this.player.x;
    const py = this.player.y;
    const hit = PLAYER_CONTACT;

    let near = 0;
    let veryNear = 0;
    let soonest = Infinity;
    // Grazes this step, so the flash is one ring rather than one per body.
    let grazedThisStep = 0;

    const dangerSq = DANGER_RADIUS * DANGER_RADIUS;
    const panicSq = PANIC_RADIUS * PANIC_RADIUS;
    const grazeRadius = this.player.grazeRadius();
    const invulnerable = this.player.dead || this.player.invuln > 0;

    for (const e of this.enemies) {
      const dx = e.x - px;
      const dy = e.y - py;
      const d2 = dx * dx + dy * dy;

      /*
       * 0.8 of the enemy's radius, up from 0.62.
       *
       * The old factor came with the note that "clipping a wingtip is
       * survivable and flying into the middle of something is not", which is
       * the right instinct and is kept — 0.8 still forgives the outer fifth of
       * a sprite. What it cannot go on being is the dominant term: at 0.62
       * against a 3.5px ship it was a 13px test, and see `PLAYER_CONTACT` for
       * what that measured.
       */
      const core = e.radius * 0.8;
      if (d2 < dangerSq) near++;
      if (d2 < panicSq) veryNear++;

      /*
       * Closest approach of a body travelling in a straight line, relative to a
       * stationary player. Negative t means it is already past.
       *
       * `prevX`/`prevY` are written at the top of `updateEnemies` every step,
       * so this is the velocity the body actually had rather than the one its
       * archetype intends — which is the point, since a lunging body's real
       * velocity is six times its walking one and that is exactly the case this
       * signal exists to catch.
       */
      if (dt > 1e-6 && d2 < SCAN_RADIUS * SCAN_RADIUS) {
        const vx = (e.x - e.prevX) / dt;
        const vy = (e.y - e.prevY) / dt;
        const vv = vx * vx + vy * vy;
        if (vv > 1) {
          const t = -(dx * vx + dy * vy) / vv;
          if (t > 0 && t < soonest) {
            const cx = dx + vx * t;
            const cy = dy + vy * t;
            const missSq = cx * cx + cy * cy;
            const threat = core + 18;
            if (missSq < threat * threat) soonest = t;
          }
        }
      }

      /*
       * THE GRAZE, RE-POINTED FROM BULLETS ONTO BODIES.
       *
       * It exists to reward cutting it fine and it FEEDS THE MUSIC: `player:graze`
       * drives `sfxGraze`, `Player.grazeRate` drives the director's graze
       * shimmer (`layers.ts`, `m.grazeRate > 1.2`) and `tension.flow`. With no
       * bullets it could never fire again, which would have left a dead event
       * the arrangement was still listening for — the exact defect this
       * repository keeps a tools directory to catch.
       *
       * A BODY IS NOT A BULLET AND THE LATCH HAS TO ACCOUNT FOR IT. A bullet
       * passes you once, so `BulletFlag.Grazed` was set and never cleared. A
       * body can hover at arm's length for ten seconds, and awarding that at
       * 120 Hz would make the graze rate a proximity meter rather than a skill
       * signal. So the award is once per APPROACH: latched on entering the
       * annulus, released only when the body has backed out past 1.9x the graze
       * radius. That hysteresis is what makes it "you got out again" rather
       * than "you are near something".
       *
       * The annulus is between the contact core and the graze ring, so a graze
       * is by construction a hit that did not land.
       */
      const grazeAt = core + grazeRadius;
      if (d2 > grazeAt * grazeAt * 3.6) e.grazed = false;
      if (!invulnerable && !e.grazed && d2 < grazeAt * grazeAt && d2 > (core + hit) * (core + hit)) {
        e.grazed = true;
        this.player.countGraze();
        this.totals.grazes++;
        grazedThisStep++;
        this.score += 60;
        this.particles.emit(e.x, e.y, -dx * 1.6, -dy * 1.6, 0.22, 2, 190, ParticleShape.Dot, 2);
        this.bus.emit('player:graze', { total: this.player.grazeTotal });
      }

      if (invulnerable) continue;
      if (d2 > (core + hit) * (core + hit)) continue;

      /*
       * A LIVE POD EATS THE CONTACT. Two pods is two free mistakes.
       *
       * DRONE PODS absorbed a bullet before it reached the ship; there is
       * nothing to absorb, so the pod now spends itself blocking a body. Same
       * cooldown, same count, same "the one object the player owns that is both
       * a gun and a shield" — and it is a straight upgrade in reliability,
       * because a pod could previously miss a bullet that passed between two of
       * them and a contact is always at the ship.
       */
      let absorbed = false;
      for (let k = 0; k < this.player.droneAngle.length; k++) {
        if (this.player.droneCooldown[k] > 0) continue;
        this.player.absorbWithDrone(k);
        const pod = this.player.dronePos(k);
        this.particles.burst(this.rng, pod.x, pod.y, 10, 200, 265, 0.35, 3);
        this.score += 40;
        // Thrown off rather than deleted: a pod is a shield, not a weapon.
        e.lungeTime = 0;
        e.pushVX = (dx / (Math.sqrt(d2) || 1)) * 520;
        e.pushVY = (dy / (Math.sqrt(d2) || 1)) * 520;
        e.pushTime = 0.3;
        absorbed = true;
        break;
      }
      if (absorbed) continue;

      this.propMoments.contact++;
      /*
       * A CHARMED BODY CANNOT RAM YOU, AND A BLINDED ONE MAY WALK STRAIGHT
       * THROUGH.
       *
       * The second half is Ball x Pit's Light ball read honestly: "blinded
       * enemies have 50% miss chance" has to include the attack this game
       * actually leans on, and contact is now the ONLY attack. The roll is
       * taken per CONTACT rather than per frame — `player.invuln` gates
       * everything below after a hit lands, so a body that misses does not get
       * 120 more chances that second.
       */
      if (e.status & Status.Charm) continue;
      if (e.status & Status.Blind) {
        this.blindedAttacks++;
        this.propChances.blind++;
        if (this.rng.next() < PROP.blindMiss) {
          this.propFires.blind++;
          this.propDamage.blind += 1;
          continue;
        }
      }
      if (!this.player.takeHit(this.snapshot.campPressure >= World.CAMP_MERCY_BLOCK)) break;
      if (this.player.lastHitAutoBombed) {
        this.autoBombRescue();
        break;
      }
      // A ram costs the enemy too, so a charge is a trade rather than a mugging.
      e.hp -= 8;
      e.hitFlash = 0.12;
      if (e.hp <= 0) e.alive = false;
      this.onPlayerHit();
      break;
    }

    /*
     * Graze feedback.
     *
     * Grazing is the highest-skill act in the game — deliberately letting
     * something close enough to feel it — and its only visual acknowledgement
     * was a two-pixel dot. The ring tightens around the ship as the streak
     * builds, so a good run has a visible halo that a bad one does not.
     */
    if (grazedThisStep > 0) {
      const heat = clamp01(this.player.grazeRate / 8);
      this.particles.ring(
        this.player.x,
        this.player.y,
        26 + grazedThisStep * 3,
        170 + heat * 40,
        0.24 + heat * 0.14,
      );
      if (heat > 0.5) this.camera.shake(0.02 * heat);
    }

    this.snapshot.threatsNear = near;
    this.snapshot.threatsVeryNear = veryNear;
    this.snapshot.timeToContact = soonest;
  }

  private onPlayerHit(): void {
    this.waveDamage++;
    this.ruleChances.hitNova++;
    this.camera.shake(0.85);
    this.camera.freeze(0.09);
    this.camera.strike(0, 0.65);
    this.particles.burst(this.rng, this.player.x, this.player.y, 40, 320, 350, 0.8, 4);
    this.shock(this.player.x, this.player.y, 340, 3400);
    /*
     * AN ORDINARY HIT SHOVES WHAT IS ON YOU. IT DOES NOT CLEAR THE ROOM.
     *
     * `cancelBullets()` stood here, and deleting every cancellable bullet in
     * the world was the right size for a bullet game: the screen the player had
     * just failed to read was wiped so they could read the next one, and it
     * cost the stage nothing it could not rebuild in a second.
     *
     * The same gesture at the same scale is a DISASTER in a contact game, and
     * it was measured before it was reasoned about. With a 520px shove on every
     * hit, `tools/difficulty.mjs`' pressure — bodies within 150px of the ship,
     * sampled continuously — pinned at 0.47-0.57 in every quarter of every run
     * no matter what else moved: enemy speed, count and lunge cadence all
     * changed and the number did not, because the crowd could never build past
     * the point where it landed one hit and blew itself apart. Getting hit was
     * the most effective defensive move in the game.
     *
     * So the ordinary hit gets a shove the size of the mistake — enough that
     * the bodies touching you are not still touching you when the 1.2s of
     * invulnerability lapses, and no more. The room-clearing version survives
     * where it was always earned: the bomb, the auto-bomb rescue, a boss phase
     * turning over, ENCORE, REST's return sweep and COMPRESSOR's ring.
     */
    this.repel(this.player.x, this.player.y, World.HIT_SHOVE_RADIUS, 480, 350);
    this.combo = 0;

    /*
     * COMPRESSOR FIRES HERE — in place, two lines from the `player:hit` emit at
     * the bottom of this method, and not through it.
     *
     * The ring is an ordinary entry in `novas[]`: same container as every aura,
     * same `updateNova`, same `drawNovas`. One object per hit, and the arena's
     * worst-behaved pick policy takes 67 hits in a fifteen-minute run.
     *
     * `clears: true`, DELIBERATELY. Every aura in the game quietly deletes
     * enemy bullets in its annulus and nothing says so; here it is the point.
     * `cancelBullets()` two lines up spares anything not flagged `Cancellable`,
     * and this ring sweeps those up as it goes out. See the item's row in
     * `weapons.ts`.
     *
     * `dps` divides the ring's damage over its crossing, exactly as `fireAura`
     * does, so the number in the table is what a target standing in it takes
     * rather than a rate that scales with how far the ring travels.
     */
    if (this.rules.hitNova > 0 && this.novas.length < World.MAX_NOVAS) {
      const maxR = Math.max(40, this.rules.hitNovaRadius);
      const speed = 520;
      this.novas.push({
        x: this.player.x,
        y: this.player.y,
        r: 0,
        alive: true,
        maxR,
        speed,
        dps: this.rules.hitNova / Math.max(0.08, maxR / speed),
        hold: 0,
        hue: World.HIT_NOVA_HUE,
        shoves: true,
        prop: 0,
        tick: 0,
      });
      this.ruleFires.hitNova++;
    }

    // ENCORE: not a drop you find, one the game sends. Once per wave, when the
    // run is nearly over. This is the direct answer to "give me a chance" — a
    // bad patch becomes recoverable instead of terminal.
    //
    // "give me a chance" presupposes someone is trying, and it spawns locked
    // to the ship's own x — `clamp(this.player.x, ...)` two lines down — so it
    // falls straight through a ship that has not moved regardless of the
    // passive pull above. `parkdiag.mjs` measured a parked, never-moving ship
    // collecting it 26-36 times across a 45-minute run: every near-death
    // moment answered for free, forever, which is the opposite of a chance.
    // Gated on the same camping signal as the pull, so a ship that is actually
    // fighting — repositioning at all in the last `IDLE_GRACE_S +
    // IDLE_RAMP_S` seconds — is completely unaffected.
    const hitsLeft = (this.player.lives - 1) * this.player.maxHp + this.player.hp;
    if (!this.player.dead && hitsLeft <= 3 && this.encoresThisWave === 0 && this.snapshot.campPressure < World.CAMP_MERCY_BLOCK) {
      this.encoresThisWave++;
      this.drops.push({
        x: clamp(this.player.x, 60, this.width - 60),
        y: clamp(this.player.y - 110, 60, this.height - 60),
        vx: 0,
        vy: 0,
        kind: 'encore',
        age: 0,
        alive: true,
      });
    }

    if (this.player.dead) {
      this.phase = 'over';
      // Deliberately do NOT stop the transport. The director's collapse — the
      // filter closing, the kit dropping out, the tempo sagging — is an
      // arrangement change, and arrangement changes need bar lines to land on.
      // Freezing the clock here would leave the last loop hanging instead.
      this.bus.emit('player:death', {});
      this.bus.emit('run:over', { score: this.score, wave: this.waveIndex + 1 });
    } else {
      this.bus.emit('player:hit', { hpLeft: this.player.hp });
    }
  }

  /**
   * Clear the room around the ship — the traditional relief valve, in bodies.
   *
   * `cancelBullets()` deleted every cancellable bullet ANYWHERE, which was
   * cheap because a bullet off screen is not costing the player anything and
   * deleting it changes nothing. A shove has to be local or it is a teleport,
   * so this is a radius: everything within about a screen's half-width goes
   * outward hard. `CLEAR_RADIUS` is deliberately generous — the moment this
   * fires is the moment the player most needs floor.
   */
  private clearRoom(): void {
    this.repel(this.player.x, this.player.y, World.CLEAR_RADIUS, 700, 50);
  }

  /** The panic bomb the player did not have to press. */
  private autoBombRescue(): void {
    // The 2.2 can never bind. Both callers reach here only when `takeHit()`
    // returned true with `lastHitAutoBombed`, and that branch of `takeHit` has
    // already set `invuln = INVULN_ON_HIT`, which is 3.2 — verified directly in
    // `tools/deadhunt-branches.mjs` by driving the last-life-with-a-bomb case.
    // So the rescue's own invulnerability floor is the hit's, and this line is
    // a no-op that reads as a grant. Left alone because 3.2 > 2.2 means the
    // player gets the longer of the two either way.
    this.player.invuln = Math.max(this.player.invuln, 2.2);
    this.camera.shake(1.1);
    this.camera.strike(150, 1);
    this.camera.freeze(0.16);
    this.clearRoom();
    for (const e of this.enemies) {
      e.hp -= e.archetype === 'conductor' ? 90 : 45;
      e.hitFlash = 0.12;
      if (e.hp <= 0) e.alive = false;
    }
    this.particles.burst(this.rng, this.player.x, this.player.y, 140, 700, 150, 1.2, 6);
    this.shock(this.player.x, this.player.y, 780, 7000);
    this.bus.emit('player:bomb', {});
    this.bus.emit('player:hit', { hpLeft: this.player.hp });
  }

  /**
   * Test/debug hook: jump straight to a wave.
   *
   * Everything in this game has been balanced by playing the opening waves,
   * because that is what a 30-second headless run reaches. The endgame has
   * never been looked at.
   */
  jumpToWave(index: number): void {
    this.enemies = [];
    this.notes.length = 0;
    this.boss = null;
    this.beginWave(index);
  }

  /** Test/debug hook: detonate without going through input. */
  detonateBombNow(): void {
    this.detonateBomb();
  }

  private detonateBomb(): void {
    this.player.bombs--;
    this.player.invuln = Math.max(this.player.invuln, 1.6);
    this.camera.shake(1);
    this.camera.strike(190, 0.9);
    this.camera.freeze(0.12);
    this.clearRoom();
    for (const e of this.enemies) {
      e.hp -= e.archetype === 'conductor' ? 140 : 60;
      e.hitFlash = 0.12;
      if (e.hp <= 0) e.alive = false;
    }
    this.particles.burst(this.rng, this.player.x, this.player.y, 120, 620, 190, 1.1, 6);
    this.shock(this.player.x, this.player.y, 700, 6000);
    this.bus.emit('player:bomb', {});
  }

  private updateDrops(dt: number): void {
    /*
     * The auto-collect line is gone.
     *
     * It used to be `y < 130` — fly up into enemy territory and everything
     * comes to you, which was a real risk/reward trade when "up" was where the
     * danger lived. On a ring there is no such line: every direction is enemy
     * territory and a height threshold would just be a strip of free pickups
     * along one wall. The rig's pickup radius does that job now, and it does it
     * as a decision the player made rather than as a place on the map.
     */
    const magnetY = this.mods.pickupRadius > 1.6;
    // A camping ship still gets drops falling toward it (gravity, not pull —
    // that part is physics, not mercy) but stops getting the free close-range
    // assist once it has been parked long enough to owe nobody a bailout.
    const pullScale = 1 - this.snapshot.campPressure;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      /*
       * The despawn floor is the bottom of the VIEW, not of the field.
       *
       * `updateDrop` still falls downward and still kills a drop past
       * `height + 40`; `powerups.ts` flags that as unfinished conversion work
       * and it is. What must not happen meanwhile is the floor moving to 3000:
       * a drop would then keep falling for two and a half screens after it has
       * left the player's sight, invisible, still costing an update and still
       * collectable by a player who happened to wander under it much later.
       * The bottom of the screen is where it visibly leaves, which is what the
       * rule has always meant.
       */
      updateDrop(d, dt, this.camera.viewY + this.viewH, this.player.x, this.player.y, magnetY, pullScale);
      const r = PICKUP_RADIUS * this.mods.pickupRadius + 8;
      if (dist2(d.x, d.y, this.player.x, this.player.y) < r * r) {
        const def = powerupDef(d.kind);
        const level = this.player.addPowerup(d.kind, def.duration);
        if (d.kind === 'bomb') this.player.bombs = Math.min(5, this.player.bombs + 1);
        if (d.kind === 'encore') {
          this.player.hp = this.player.maxHp;
          this.player.bombs = Math.min(5, this.player.bombs + 1);
          this.player.invuln = Math.max(this.player.invuln, 3);
          this.clearRoom();
        }
        if (d.kind === 'overdrive') this.camera.shake(0.5);
        // The black-hole charge used to arrive here, from a drop. It comes from
        // the BLACK HOLE instrument's own cadence now (see `fireField`), and
        // `blackhole` no longer has a drop weight, so the branch that granted
        // it here was unreachable code that read as live.
        this.score += 250;
        this.particles.burst(this.rng, d.x, d.y, 16, 200, def.hue, 0.45, 3);
        // Anything the cap displaced leaves the mix too.
        while (this.player.evicted.length) {
          const gone = this.player.evicted.shift()!;
          this.bus.emit('powerup:expire', { kind: gone });
        }
        this.bus.emit('powerup:pickup', { kind: d.kind, level });
        d.alive = false;
      }
      if (!d.alive) this.drops.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------
  // progression
  // -------------------------------------------------------------------------

  /** Open a queued offer. Idempotent; safe to call on every bar line. */
  /*
   * Resolve one banked level at random, without ever showing a card.
   *
   * `prog.openOffer` is still what builds the option list, because it is the
   * only thing that knows which cards are LEGAL in the current state -- a
   * random pick from an illegal set would hand out a maxed instrument or a rig
   * item with no slot. What is skipped is `emitOffer` and the announcement, so
   * the overlay never opens and `level:offer` is never fired.
   *
   * `chooseOffer` still runs in full, so the choice is applied exactly as a
   * hand-picked one is and `level:choice` still fires -- the HUD updates, the
   * sting plays, and a fusion still gets its banner. The player is told what
   * they got; they are simply not asked.
   */
  private autoPickOffer(): boolean {
    const offer = prog.openOffer(this.progression);
    if (!offer || !offer.options.length) return false;
    this.chooseOffer(Math.floor(this.rng.next() * offer.options.length));
    return true;
  }

  private openOfferNow(): void {
    /*
     * Do nothing if one is already open. Reported from play: "on the item
     * selection screen, whenever the tempo reaches the end it repops up the
     * selection, so it's pretty annoying."
     *
     * `update` calls this on EVERY bar line, and the comment there said that
     * was free because `openOffer` is idempotent. `openOffer` is idempotent in
     * STATE and not in EFFECTS, which is the whole bug:
     *
     *     if (state.offer || state.pending <= 0) return state.offer;
     *
     * When an offer is already open that returns `state.offer` — TRUTHY, the
     * same object — so the `if (!offer) return` guard below never fired. Every
     * bar line therefore re-ran `emitOffer` and re-fired the LEVEL banner, and
     * because `main.ts` answers `level:offer` with `sfxPickup(7)`, it re-played
     * the sting as well. At 128bpm a bar is 1.875 seconds, so the card screen
     * re-announced itself about every two seconds for as long as the player
     * took to read it — and the whole point of stopping the world here was to
     * let them read it without pressure.
     *
     * Guarding on `isChoosing` rather than on the return value, because the
     * defect was that a truthy return means two different things. A caller
     * should not have to know that `openOffer` answers "here is your new offer"
     * and "you already had one" with the same value.
     */
    if (prog.isChoosing(this.progression)) return;
    /*
     * Space out a burst -- but NOT inside a session the player asked for.
     *
     * OFFER_MIN_GAP exists so a run that levels twice in a second does not
     * throw two card screens at a player who wanted neither. Inside a session
     * the player has explicitly asked for the whole backlog, so making them
     * wait six seconds between their own choices is the gap protecting them
     * from something they requested.
     */
    if (!this.offerSession && this.time - this.lastOfferClosed < OFFER_MIN_GAP) return;
    const offer = prog.openOffer(this.progression);
    if (!offer) return;
    this.emitOffer(offer);
    this.announce(`LEVEL ${offer.level}`, 'CHOOSE A MUSICIAN', 'item');
  }

  /**
   * Push an offer's contents to the overlay.
   *
   * Every path that CHANGES the cards has to come through here. `LevelUpOverlay`
   * only rebuilds its cards inside `open()`, and `open()` is reached from the
   * `level:offer` handler alone (`renderer.ts`) — so a reroll or a banish that
   * mutated the offer and emitted nothing left the player looking at the cards
   * they had just spent a charge to replace. Two of the three printed controls
   * did nothing visible, which is a complete explanation for why nobody used
   * them.
   *
   * Re-emitting also replays the card entry animation and re-plays the offer
   * cue. Both are wanted: a reroll should look and sound like new cards landed.
   * `sawChoosing` resetting to false is harmless — `snap.choosing` is still
   * true, so the next frame sets it straight back, and the falling-edge close
   * still fires exactly once.
   */
  private emitOffer(offer: prog.Offer): void {
    this.bus.emit('level:offer', {
      level: offer.level,
      // Unfiltered and index-aligned with `chooseOption`. Dropping the grace
      // cards would both empty the screen late in a run and shift every index
      // after the hole, handing the player an ability they did not pick.
      // `replaces` travels with the card or the swap charges its price in
      // silence — the renderer cannot derive it, it is chosen when the offer
      // is built. See `OfferOption.replaces`.
      // `level` travels too: a fusion card arrives at its ceiling, and the
      // renderer cannot derive that from a loadout that does not hold it yet.
      options: offer.options.map((o) => ({ id: o.id, grace: o.grace, replaces: o.replaces, level: o.level })),
      queued: offer.queued,
      rerolls: offer.rerollsLeft,
      banishes: offer.banishesLeft,
    });
  }

  private applyOfferInput(input: {
    choice?: number;
    banish?: number;
    reroll?: boolean;
    skip?: boolean;
  }): void {
    if (!prog.isChoosing(this.progression)) return;
    if (this.edge.reroll) {
      const next = prog.rerollOffer(this.progression);
      if (next) this.emitOffer(next);
      return;
    }
    if (this.edge.banish && input.banish !== undefined && input.banish >= 0) {
      const next = prog.banishOption(this.progression, input.banish);
      if (next) this.emitOffer(next);
      return;
    }
    if (input.skip) {
      const level = this.progression.level;
      prog.skipOffer(this.progression);
      this.bus.emit('level:skip', { level });
      return;
    }
    if (input.choice === undefined || input.choice < 0) return;
    this.chooseOffer(input.choice);
  }

  /**
   * Take card `index`. Public so a click on the HUD does not have to be
   * laundered back through a synthetic keypress.
   */
  chooseOffer(index: number): void {
    /*
     * The fusion this pick performs, captured BEFORE the choice is applied —
     * `chooseOption` closes the offer, so the option is gone afterwards.
     */
    const fused = this.progression.offer?.options[index]?.fusion ?? null;
    const c = prog.chooseOption(this.progression, index);
    if (!c.ok) return;
    /*
     * A fusion taken as a card still announces itself.
     *
     * These events used to fire from `onBossDefeated`, which resolved fusions
     * in a batch. Fusions are picks now, so without this the single most
     * dramatic thing a player can do — spending two maxed instruments to make
     * a third — would happen in silence, with the loadout panel just quietly
     * showing one fewer row.
     */
    if (fused) {
      /*
       * ASKED BEFORE THE EMIT, and the order is the whole thing.
       *
       * `main.ts` records the discovery inside its handler for these very
       * events, so a hook consulted after them always answers "seen before" —
       * the banner would have read FIRST TIME exactly never. Captured here,
       * one line above the emits, it reflects the state the player was in when
       * they earned it.
       */
      const firstEver = this.isFirstDiscovery?.(fused.result) ?? false;
      if (fused.kind === 'union') this.bus.emit('ability:union', { a: fused.base, b: fused.catalyst, to: fused.result });
      else if (fused.kind === 'duet') this.bus.emit('ability:duet', { a: fused.base, b: fused.catalyst, to: fused.result });
      else this.bus.emit('ability:evolve', { from: fused.base, catalyst: fused.catalyst, to: fused.result });
      /*
       * A FIRST-EVER discovery is a different event from a repeat.
       *
       * Making SPICCATO for the first time in your life and making it again on
       * your ninth run produced an identical banner, which is the collection
       * telling you nothing at the one moment it has something to say. The
       * count on the title screen goes up either way and the player is looking
       * at the arena, not the title screen.
       *
       * The world owns banners and `main.ts` owns the saved set — neither can
       * answer this alone, so the decision arrives as a hook, captured above
       * the emits. Left unset (every harness in `tools/`, and any headless
       * embedding) it is simply a repeat, which is the honest default for a
       * world with no memory of past runs.
       */
      this.announce(
        labelOf(fused.result),
        firstEver ? `FIRST TIME — ${fused.line.toUpperCase()}` : fused.line.toUpperCase(),
        'grade',
      );
    }
    /*
     * Emitted for EVERY committed pick, grace included, with a null id.
     *
     * The first version of this guarded on `c.id && c.slot`, so taking a grace
     * card emitted nothing at all — not a choice, because the id is null, and
     * not a skip, because it was not one. Any screen driven off these events
     * would then sit open forever with the world still paused underneath it,
     * and it is reachable exactly in the late-game state where grace cards are
     * the only thing on offer. `snapshot.choosing` is still the authoritative
     * signal for anyone closing a screen; this is the notification.
     */
    this.bus.emit('level:choice', {
      id: c.id,
      grace: c.grace,
      slot: c.slot ?? 'rig',
      level: c.level,
      isNew: c.isNew,
    });
    if (c.id && c.slot && !fused) {
      /*
       * NOT when a fusion just announced itself.
       *
       * A fusion card resolves through here like any other pick, so this ran
       * afterwards and overwrote the banner the fusion branch had just set —
       * every arrangement in the game announced itself as "JOINS THE BAND"
       * and its written line ("the bow starts to bounce", "the collapse lands
       * on the one") was displayed for less than a frame. Twelve authored
       * lines, none of them ever read.
       *
       * Found by testing a first-discovery banner end to end and getting the
       * generic text back; the flavour line had been clobbered since the
       * fusion card path was built, and nothing looked at the banner.
       */
      this.announce(labelOf(c.id), c.isNew ? 'JOINS THE BAND' : `LEVEL ${c.level}`, 'item');
      // A new instrument should be audible immediately rather than after its
      // first full cooldown, which for TIMPANI would be three seconds of
      // nothing happening after the card that recruited it.
      if (c.slot === 'instrument' && c.isNew) this.instrumentTimers[c.id] = 0;
    }
    /*
     * Grace cards. They exist because a late-run offer can genuinely have
     * nothing legal left to put on it — both inventories full, everything in
     * them maxed — and four blank cards is worse than a small consolation.
     */
    if (c.grace === 'rest') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
      this.announce('A REST', 'ONE SHIELD BACK', 'item');
    } else if (c.grace === 'bomb') {
      this.player.bombs = Math.min(5, this.player.bombs + 1);
      this.announce('A BAR OF SILENCE', 'ONE BOMB', 'item');
    } else if (c.grace === 'shards') {
      this.score += 2500;
      this.announce('APPLAUSE', '+2500', 'item');
    }
  }

  skipOffer(): void {
    if (!prog.isChoosing(this.progression)) return;
    const level = this.progression.level;
    prog.skipOffer(this.progression);
    this.bus.emit('level:skip', { level });
  }

  rerollOffer(): void {
    const next = prog.rerollOffer(this.progression);
    if (next) this.emitOffer(next);
  }

  banishOffer(index: number): void {
    const next = prog.banishOption(this.progression, index);
    if (next) this.emitOffer(next);
  }

  /**
   * The cadenza: slots grow, levers restock, and anything you have been
   * building finishes.
   *
   * `onBossDefeated` resolves fusions in a loop, so a union whose two halves
   * both evolve on the same boss lands in one go. That is a once-a-run moment
   * and deferring half of it to the next boss would be arbitrary.
   */
  private rewardBoss(): void {
    const reward = prog.onBossDefeated(this.progression);
    /*
     * No ENSEMBLE GROWS branch. Slot growth was removed — `grantBossReward`
     * returns a fixed four and three — so this tested a flag that could never
     * be true, kept an unreachable `slots:grow` emit alive, and left a sound
     * effect wired in `main.ts` that could never play. Dead code that
     * describes a removed mechanic is how the HUD ended up telling players to
     * "beat a boss to widen the band" long after beating a boss stopped doing
     * that.
     */
    for (const f of reward.fusions) {
      if (f.kind === 'union') {
        this.bus.emit('ability:union', { a: f.base, b: f.catalyst, to: f.result });
      } else {
        this.bus.emit('ability:evolve', { from: f.base, catalyst: f.catalyst, to: f.result });
      }
      this.announce(labelOf(f.result), f.line.toUpperCase(), 'grade');
      this.camera.strike(300, 1);
      this.camera.shake(0.8);
      // A fusion resets the timer under the id that no longer exists, so the
      // new instrument starts cold rather than inheriting a half-spent cooldown
      // from something with a completely different interval.
      delete this.instrumentTimers[f.base];
      delete this.instrumentTimers[f.catalyst];
      this.instrumentTimers[f.result] = 0;
      // Same argument for LASER's every-Nth counter: a result inheriting its
      // base's position in the cadence would get an overcharge it did not fire
      // for, or lose one it had earned.
      delete this.shotCount[f.base];
      delete this.shotCount[f.catalyst];
      this.shotCount[f.result] = 0;
    }
  }

  /**
   * Fold the rig's flat HP bonus into the ship.
   *
   * Additive and idempotent, recomputed from `bonusHp` each step rather than
   * incremented on pickup: an increment on the event would drift the moment a
   * fusion, a reset or a reroll changed what is held, and a max-HP value that
   * has drifted is a bug you only notice when a player cannot die.
   */
  private applyRigHealth(): void {
    const want = Math.round(this.mods.maxHp);
    if (want === this.player.bonusHp) return;
    const gained = want - this.player.bonusHp;
    this.player.bonusHp = want;
    this.player.maxHp = 3 + want;
    if (gained > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + gained);
    else this.player.hp = Math.min(this.player.hp, this.player.maxHp);
  }

  // -------------------------------------------------------------------------
  // aiming and the danger signal
  // -------------------------------------------------------------------------

  /**
   * Where the ship is actually shooting.
   *
   * The facing is the player's statement of intent and the snap is the gunner
   * reading it charitably. The rule is deliberately narrow: snap to the nearest
   * enemy whose bearing is within `AIM_SNAP` of the facing, and otherwise fire
   * exactly along the facing. It never acquires a target behind you, it never
   * overrides a deliberate turn, and it prefers NEAR over well-aligned — a
   * shape at 40px that is 25 degrees off is the thing about to kill you, and a
   * shape at 600px dead ahead is not.
   */
  private computeAim(): void {
    const p = this.player;
    let inCone = -1;
    let inConeD = Infinity;
    let anywhere = -1;
    let anywhereD = Infinity;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e.invuln > 0) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < anywhereD) {
        anywhereD = d;
        anywhere = i;
      }
      const bearing = Math.atan2(dy, dx);
      // Allowance for the target's own size, so a boss filling a third of the
      // arena is not "off axis" because its centre happens to be.
      const slack = Math.atan2(e.radius, d);
      if (Math.abs(angleDelta(p.facing, bearing)) > AIM_SNAP + slack) continue;
      if (d < inConeD) {
        inConeD = d;
        inCone = i;
      }
    }
    const bearingOf = (i: number) => Math.atan2(this.enemies[i].y - p.y, this.enemies[i].x - p.x);
    p.aim = inCone >= 0 ? bearingOf(inCone) : p.facing;
    /*
     * `seek` gets a wider licence than the facing, and it is the one shape that
     * should.
     *
     * Measured before this existed: a run could reach a boss and then take four
     * minutes to make no progress on it, thirteen kills in five minutes. The
     * cause is not the bot and is not the boss. A survivor arena is played by
     * KITING — you run away from the thing chasing you — and a weapon that only
     * fires along your heading fires away from everything that matters for the
     * whole time you are surviving correctly. Vampire Survivors gets away with
     * a forward-firing starter because six slots fill up with orbits and auras
     * within a minute; here the player starts with exactly one instrument, so a
     * forward-only opening is a game where running away means dealing no damage
     * at all.
     *
     * `weapons.ts` already said so and I read it as flavour: the shape's
     * definition is literally "bolts toward the nearest target inside range".
     * It is the auto-targeting shape, and the two shapes whose character IS
     * directional — `arc` and `beam` — keep the strict cone.
     *
     * Facing still decides something real here, which is what stops this
     * collapsing into "there is no aiming": among the targets available it
     * PRIORITISES the one you are pointing at. Point at the thing you want
     * dead and it dies first; point at nothing and the ship defends itself.
     */
    p.seekAim = inCone >= 0 ? p.aim : anywhere >= 0 ? bearingOf(anywhere) : p.facing;
  }

  /**
   * The danger signal: how close the nearest threat is, and how closed the ring
   * around the player has become.
   *
   * This replaces `playerHeight` as the music's proxy for danger. Height was a
   * real signal in a vertical game — the threat was always above and the safety
   * always below, so "how far up are you" genuinely meant "how committed are
   * you". In the round the player lives near the middle and the number stops
   * varying, which is the worst possible failure for a musical input: it looks
   * responsive in the source and is a constant in play, the exact defect
   * `tools/deadconditions.mjs` was built to catch.
   *
   * `encirclement` is computed from the largest ANGULAR GAP in the ring of
   * enemies, inverted. One enemy leaves a gap of nearly a full turn and scores
   * ~0; four spread evenly leave a quarter turn each and score 0.75; a closed
   * ring scores 1. It is the slow axis and it is the genuinely new one —
   * "surrounded" and "something is close" are different feelings, and the
   * vertical game had no way to tell them apart.
   */
  private analyseEncirclement(): void {
    const p = this.player;
    let nearest = Infinity;
    // Reused across frames would be nice, but the array has to be sorted and
    // the enemy count is bounded at a few dozen; this is not the hot loop.
    const bearings: number[] = [];
    for (const e of this.enemies) {
      /*
       * Two exclusions, and both of them are the difference between a signal
       * that means something and one that merely moves.
       *
       * A shape still OUTSIDE the arena does not close the ring. Spawns enter
       * from 70px beyond the edge and a player standing near that edge is well
       * within the threat radius of something that has not arrived yet — so
       * without this the music tenses during the calm before a wave and relaxes
       * as the wave actually lands, which is precisely backwards.
       *
       * A shape that is LEAVING does not close it either. It has given up and
       * is flying outward; counting it holds the ring shut through the lull at
       * the end of a wave, which is the one moment the arrangement has to
       * breathe.
       */
      if (e.leaving || !this.hasEntered(e)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < nearest) nearest = d;
      if (d <= THREAT_RADIUS) bearings.push(Math.atan2(e.y - p.y, e.x - p.x));
    }
    this.nearestThreat = clamp01(nearest / THREAT_SCALE);

    if (bearings.length === 0) {
      this.encirclement = 0;
      // Nothing is pressing, so the way out is wherever you are already going.
      this.escapeAngle = p.facing;
      return;
    }
    bearings.sort((a, b) => a - b);
    let widest = 0;
    let at = bearings[0];
    for (let i = 0; i < bearings.length; i++) {
      const a = bearings[i];
      // Wrap: the gap after the last bearing runs round to the first.
      const b = i + 1 < bearings.length ? bearings[i + 1] : bearings[0] + TAU;
      const gap = b - a;
      if (gap > widest) {
        widest = gap;
        at = a + gap / 2;
      }
    }
    this.encirclement = clamp01(1 - widest / TAU);
    this.escapeAngle = at;
  }

  // -------------------------------------------------------------------------
  // firing: ten shapes, one per InstrumentShape
  // -------------------------------------------------------------------------

  /**
   * Run every held instrument's clock and dispatch the ones that came due.
   *
   * Ten routines and not twenty-seven: every instrument in `weapons.ts` is one
   * of ten shapes, which is the entire reason that field exists. A table of
   * twenty-seven bespoke weapons is a table nobody can balance and a dispatch
   * nobody can read.
   *
   * IT WAS SIX, THEN SEVEN, AND SEVEN WAS TOO FEW — which is the opposite
   * problem and it was measured rather than felt.
   * `docs/research-weapons.md` classified this roster and two reference games
   * by mechanical verb and got one verb per 3.9 instruments here against 1.2
   * for launch-era Vampire Survivors, with `aura` alone holding 26% of the
   * table. `lance`, `cone` and `spray` are the first three of that document's
   * nine and they take it to 2.7. Every one of them RE-POINTS instruments that
   * already exist: no id was added, so `AGENTS.md` §5's zero-sum four-card
   * offer is untouched.
   *
   * The cap that matters is on CONTAINERS, not on shapes. All three reuse
   * something already allocated and already drawn — `lance` is
   * `Effect{kind:'beam'}`, `cone` and `spray` are `BulletPool` — so none of
   * them adds a render contract. `docs/MASTER_PLAN.md` G5's "2-3 new shapes,
   * not 20" is respected in the letter and the reason.
   */
  /**
   * Push the arrangement's current position into the simulation.
   *
   * The ONE inbound call in the game/music boundary, and it is a value copy
   * rather than a reference so nothing on the audio side can be mutated from
   * here by accident. `main.ts` calls it once a frame with the previous frame's
   * readout — one frame of latency against a section that holds for a minimum
   * of four bars (`arrangement.ts` MIN_BARS), which is 7.5 seconds at 128 BPM.
   */
  setMusicalState(m: MusicalState): void {
    this.musical.section = m.section;
    this.musical.energy = m.energy;
    this.musicalPushed = true;
  }

  /**
   * The stand-in form, for a world with nobody conducting it.
   *
   * See the `musical` field for why this exists at all and why it is calibrated
   * rather than invented. One eight-bar phrase: build, drop, sustain,
   * breakdown, in shares of 22 / 43 / 22 / 13 against the arranger's measured
   * 17.2 / 42.5 / 16.2 / 16.5. Energy rises across the phrase and peaks in the
   * drop, which is what the arranger's own does.
   */
  private freeRunMusic(): void {
    if (this.musicalPushed) return;
    const p = this.transport.phrasePhase;
    this.musical.section = p < 0.22 ? 'build' : p < 0.65 ? 'drop' : p < 0.87 ? 'sustain' : 'breakdown';
    this.musical.energy = clamp01(0.3 + 0.55 * Math.sin(Math.PI * Math.min(1, p / 0.65)));
  }

  /**
   * DROP's multiplier: near-inert outside the drop, the loudest thing in it.
   *
   * Two numbers rather than one, because "near-inert" has to mean something a
   * player notices without reading a stat: outside the drop the cone fires a
   * QUARTER as often for a SIXTH of the damage, so it is a stutter you can hear
   * stop. Inside, it scales with the arrangement's own energy, so the peak of
   * the drop is the peak of the item.
   */
  private dropSwell(): { damage: number; interval: number } {
    if (this.musical.section === 'drop') {
      return { damage: 1.6 + 1.8 * clamp01(this.musical.energy), interval: 1 };
    }
    return { damage: 0.15, interval: 4 };
  }

  /**
   * CRESCENDO's multiplier: how much trouble the ship is actually in, 0..1.
   *
   * A BLEND, AND THE REASON IS A MEASUREMENT. `encirclement` alone reads p50
   * 0.04 / p90 0.32 over a real run (`tools/arena.mjs`), so an item keyed on it
   * would sit at its floor for essentially the whole game — a swell that never
   * swells, which is this repository's most-repeated defect. `nearestThreat` is
   * 1 when nothing is close and reads p50 0.83 / p10 0.34, and the local
   * population is the third view of the same question. The max of the three is
   * "am I in trouble by any reading", which is what the card promises.
   *
   * `tools/beatlock.mjs` prints the distribution of the returned multiplier
   * over a real run, because the whole point is that it must not be a constant.
   */
  private dangerSwell(): number {
    const near = this.populationNearPlayer();
    const danger = clamp01(
      Math.max(this.encirclement * 1.6, 1 - this.nearestThreat, near / 7),
    );
    return 0.3 + 3.0 * danger;
  }

  /** True if the last `advance()` crossed a half-bar line (beats 1 and 3). */
  private crossedHalfBar(): boolean {
    return this.transport.crossings(2 / BEATS_PER_BAR) > 0;
  }

  /**
   * True if the last `advance()` crossed an OFF-beat eighth — the "and" of a
   * beat, never the beat itself.
   *
   * `Transport.crossings(2)` counts eighth-note boundaries and cannot say which
   * one, so the parity is taken from where the transport now IS: the newest
   * boundary crossed has index `floor(beat * 2)`, and an odd index is an
   * off-beat. Two or more crossings in one step means both parities went by, so
   * an off-beat is among them — at 120 Hz and 128 BPM an eighth is 28 steps
   * wide, so that arm is a correctness guard rather than a live path.
   */
  private crossedOffbeat(): boolean {
    const n = this.transport.crossings(2);
    if (n <= 0) return false;
    return n >= 2 || Math.floor(this.transport.beat * 2) % 2 === 1;
  }

  private fireInstruments(dt: number): void {
    const held = prog.activeInstruments(this.progression);
    let fired = false;
    /*
     * Which instrument's voice this tick's shot sound gets.
     *
     * Several instruments can come due on the same 8.3ms step and only one
     * event is emitted, so a tiebreak is needed. It is the one with the LONGEST
     * interval — the rarest thing that fired, not the first.
     *
     * "First" is the natural choice and it is the worst one available here,
     * because `held` is in acquisition order and index 0 is always the opener:
     * every run starts holding it, so a first-wins tiebreak resolves every
     * collision in favour of the sound the player has already heard a thousand
     * times, and it does it most reliably at the exact moment it matters least.
     *
     * Rarest-wins costs the frequent voice nothing and it protects the voices
     * that only speak every few seconds, where losing one appearance costs a
     * third of the instrument's presence in the mix. It is the same reason an
     * arranger does not let the hi-hat mask the timpani: the event that happens
     * least is the event carrying information.
     *
     * It also fixes a systematic case rather than only a statistical one. A
     * newly recruited instrument has its timer set to 0 so it sounds
     * immediately, which means acquisition is the one moment a collision is
     * *likely* — and under first-wins the new musician would be silenced by the
     * starter gun on the very tick the player recruited them.
     */
    let firedId: InstrumentId | null = null;
    let firedInterval = -1;
    /*
     * FERMATA FIRES HERE. `stillTime` is seconds with the stick released — see
     * the field, and see why it is NOT `idleTime`: the first version used the
     * camp-pressure clock and `rulefire` measured a weaving bot holding half a
     * charge 74.8% of the time, which is a "hold still" card paying out to a
     * ship that never held still.
     *
     * It builds and holds rather than being spent on the next activation. The
     * band fires constantly, so a charge that were consumed would never reach a
     * few per cent before something ate it, and the passive would be inert for
     * exactly the reason this pass exists. See the item's row in `weapons.ts`
     * for why this cannot become a camping reward: the whole ladder completes
     * inside `IDLE_GRACE_S`.
     */
    const charge =
      this.rules.chargeSeconds > 0 ? clamp01(this.stillTime / this.rules.chargeSeconds) : 0;
    const chargeMul = 1 + charge * (this.rules.chargeDamage - 1);

    /*
     * THE BEAT GRID FOR THIS STEP.
     *
     * `dt <= 0` is the level-up pause: `update` zeroes `simDt` while an offer is
     * open and lets the transport run on, so a bar line DOES cross while the
     * world is stopped. Without this guard a beat-locked weapon would fire
     * through a pause the whole rest of the game holds still for — and the
     * timer-driven instruments cannot, because their countdown is fed the same
     * zero. Same rule for both, stated once.
     */
    const live = dt > 0;
    const grid: Record<BeatLock, boolean> = {
      bar: live && this.transport.crossedBar(),
      halfbar: live && this.crossedHalfBar(),
      offbeat: live && this.crossedOffbeat(),
    };
    const barSecs = (BEATS_PER_BAR * 60) / this.transport.bpm;

    /*
     * ONE FOLD OF THE LOADOUT, then two passes over it.
     *
     * `applyModifiers` is called once per instrument here rather than once in
     * each pass. The first pass is for the items that are not voices — the ones
     * that modify the band or the room — because two of them change what the
     * voices are about to do and all of them have to be resolved before a
     * single shot is fired.
     */
    const band: BandVoice[] = [];
    for (const { id, level } of held) {
      const def = instrumentDef(id);
      if (!def) continue;
      band.push({ id, level, def, s: applyModifiers(instrumentStats(id, level), this.mods) });
    }

    let unison: { lock: BeatLock; s: InstrumentStats } | null = null;
    let counterpoint: InstrumentStats | null = null;
    this.dragRadius = 0;
    this.dragDepth = 0;
    this.dragSelf = 1;
    this.dragDeepens = false;
    for (const v of band) {
      if (v.def.shape === 'unison') {
        unison = { lock: beatLockOf(v.id, v.level) ?? 'bar', s: v.s };
      } else if (v.def.shape === 'counterpoint') {
        counterpoint = v.s;
      } else if (v.def.shape === 'drag') {
        this.fireDrag(v.id, v.s, dt);
      }
    }
    /*
     * The voices, in acquisition order, and this ORDER IS NOW A GAME MECHANIC.
     *
     * `activeInstruments` returns the loadout in the order it was picked up, and
     * COUNTERPOINT reads index 0 as the leader and 1 and 2 as the answering
     * voices. It has always been an order; until now nothing looked at it.
     *
     * The three modifier/room shapes are filtered out rather than sorted to the
     * back, so holding UNISON does not silently change which instrument
     * COUNTERPOINT considers to be first.
     */
    const voices = band.filter(
      (v) => v.def.shape !== 'unison' && v.def.shape !== 'counterpoint' && v.def.shape !== 'drag',
    );

    /*
     * A REST IS A REST. THE BAND STOPS, AND SO DO THE GUNS.
     *
     * The card says "your band stops playing for every beat of it" and the
     * first implementation only stopped the SOUND — the mix thinned and the
     * weapons went on firing. That is the failure mode this repository has a
     * name for: prose the simulation does not deliver, and it made REST a bar
     * of free invulnerability with a mood attached.
     *
     * IT ALSO SHOWED UP IN A GATE THAT KNOWS NOTHING ABOUT ANY OF THIS.
     * `tools/builds.mjs` measures the spread in damage taken across seven pick
     * policies, because a pick that does not change how much punishment a run
     * costs is a pick that is not reaching the game. Free invulnerability
     * available to every policy compresses that spread from the outside: it
     * read 2.4x before this pass, 1.4x with REST at 39% uptime, and 1.6x after
     * the cooldown was fixed. A REST that costs you your damage is a REST that
     * separates builds again, because a run that spends 16% of itself not
     * firing has to make that back somewhere.
     *
     * The modifier pass above still runs, so the drag bubble and the tacet rota
     * keep their state across a rest rather than resetting on the far side.
     */
    if (this.restUntil > this.time) {
      this.beatFires.held += voices.length;
      return;
    }

    for (const v of voices) {
      const { id, level, def } = v;
      const s = v.s;

      if (def.shape === 'orbit') {
        // Pods exist continuously; only their shooting is on a clock.
        this.player.podCount = Math.max(1, Math.round(s.count));
        this.player.podRadius = Math.max(28, s.area);
        // A boolean rather than a rate scaled from `speed`: 1.6 and 1050 are in
        // unrelated units and inventing a conversion between them would be a
        // made-up number dressed as a derivation. CHORALE's satellites hold
        // station (`speed: 0`); DRONE-lineage ones sweep.
        this.player.podSpin = s.speed > 0 ? 1.6 : 0;
      }

      /*
       * UNISON RE-CLOCKS THE BAND, and it does it before anything reads
       * `s.interval`, because the compensation it applies is computed from the
       * interval it is replacing.
       */
      const conducted = unison !== null;
      let lock = beatLockOf(id, level);
      if (unison) {
        lock = unison.lock;
        this.fireUnison(unison.s, s, barSecs);
      }

      /*
       * RITARDANDO TAXES ITS OWN SIDE, and under UNISON it has to take the
       * payment somewhere else: a conducted band ignores its intervals
       * entirely, so a rate tax would simply evaporate and the item's whole
       * drawback with it. Same cost, charged against the volley instead.
       */
      if (this.dragSelf > 1) {
        if (conducted) s.damage /= this.dragSelf;
        else s.interval *= this.dragSelf;
      }

      // DROP is the one swell that moves the CLOCK as well as the damage, which
      // is what "near-inert" has to mean to be noticeable.
      if (def.swell === 'drop') {
        const sw = this.dropSwell();
        s.damage *= sw.damage;
        s.interval *= sw.interval;
      }

      /*
       * A CONDUCTED INSTRUMENT HAS NO TIMER. That sentence is the whole of
       * UNISON: "instead of on its own timer" is not a figure of speech, and
       * leaving the countdown in would make a 3.2s instrument skip every other
       * bar while a 0.15s one fired on all of them — which is the trickle the
       * item exists to remove.
       */
      if (!conducted) {
        const left = (this.instrumentTimers[id] ?? 0) - dt;
        if (left > 0) {
          this.instrumentTimers[id] = left;
          continue;
        }
      }

      /*
       * THE BEAT LOCK. Ready is not the same as allowed.
       *
       * The timer is left at zero rather than restarted, so the instrument
       * re-asks on every step until its grid line comes round. That is what
       * makes `interval` a FLOOR under a locked instrument rather than a second
       * clock fighting the first: METRONOME at 0.5s is ready three times a bar
       * and fires once, and its damage is set against the bar it actually gets.
       */
      if (lock && !grid[lock]) {
        if (!conducted) this.instrumentTimers[id] = 0;
        this.beatFires.held++;
        continue;
      }
      this.instrumentTimers[id] = conducted ? 0 : Math.max(0.05, s.interval);
      this.beatFires[lock ?? 'free']++;

      /*
       * THE TWO SWELLS THAT SCALE DAMAGE FROM OUTSIDE THE STAT BLOCK.
       *
       * Applied to `s` — the block this instrument is about to be fired with —
       * and never to `this.mods`, for the same reason LASER's overcharge is:
       * `Modifiers` is folded once per step and shared by every instrument, the
       * enemy clock and the player, so a rule that reached into it would apply
       * to whatever else happened to read it that frame.
       */
      if (def.swell === 'danger') {
        s.damage *= this.dangerSwell();
        // The wave swells outward as well from L2, which is what that rung's
        // note promises. Level-gated because the L1 card does not claim it.
        if (level >= 2) s.area *= 0.85 + 0.4 * clamp01((this.dangerSwell() - 0.3) / 3);
      }
      if (def.swell === 'silence') {
        /*
         * METRONOME'S SILENCE BONUS, and the anti-synergy the plan asks for.
         *
         * Out of a full bar of nothing the downbeat lands at its full weight;
         * arriving straight after something else fired it keeps 70%. That is
         * what makes SYNCOPATION a genuine cost rather than free interleaving:
         * four sweeps a bar hold `beatsQuiet` near zero all game.
         *
         * THE DEPTH WAS HALVED AFTER MEASURING IT. At `0.5 + 0.5x` a band —
         * ANY band, since every run starts holding this instrument and almost
         * every run adds a second voice — held `beatsQuiet` near 0.2 beats and
         * so ran METRONOME at 52% for the entire game. That is not an
         * anti-synergy with SYNCOPATION, it is a 48% tax on the starting weapon
         * payable by owning a second instrument of any kind, and it is a large
         * part of why the first draft of this roster reached wave 18.6 where
         * the old one reached 24.1. 30% is a cost you can weigh; 48% is a rule
         * against having a band.
         */
        s.damage *= 0.7 + 0.3 * (this.beatsQuiet / BEATS_PER_BAR);
      }

      /*
       * LASER FIRES HERE. The counter is PER INSTRUMENT (`shotCount[id]`), so
       * each voice has its own cadence — a single global counter would spend
       * nearly every overcharge on the fastest instrument in the band, which is
       * the same failure the rarest-wins tiebreak above exists to avoid.
       *
       * `pierce = 99` rather than a flag: five routines already read
       * `s.pierce > 1` to choose a piercing bullet type and a fatter radius, so
       * the overcharged volley is visibly thicker as well as unstoppable, and no
       * routine needed a new argument.
       */
      /*
       * THE TWO PROPERTIES THAT ACT ON AN ACTIVATION RATHER THAN ON A HIT.
       *
       * ANVIL's `heavy` and NOCTURNE's `dark` both multiply the volley and
       * charge for it — `heavy` in travel speed, `dark` in a silence after the
       * bolt lands (`collidePlayerBullets` sets that timer). They are applied
       * to `s`, the block this instrument is about to be fired with, and never
       * to `this.mods`, for the same reason LASER's overcharge is: `Modifiers`
       * is folded once per step and shared by every instrument, the enemy
       * clock and the player.
       *
       * THE DENOMINATOR IS EVERY ACTIVATION IN THE BAND, not every activation
       * of the weapon that carries the property. A fires/chances of 1.00 for a
       * solo ANVIL is arithmetic, not evidence; what carries the weight is the
       * control run, where the same denominator is large and the numerator is
       * zero.
       */
      const propSlot = this.propSlot(id, level);
      const props = this.propSets[propSlot];
      this.propMoments.activation++;
      this.propChances.heavy++;
      this.propChances.dark++;
      if (props.heavy > 1) {
        s.damage *= props.heavy;
        s.speed /= props.heavy;
        this.propFires.heavy++;
      }
      if (props.dark > 1) {
        s.damage *= props.dark;
        this.propFires.dark++;
      }

      const n = (this.shotCount[id] = (this.shotCount[id] ?? 0) + 1);
      this.ruleChances.overcharge++;
      this.ruleChances.charged++;
      const overcharged =
        this.rules.overchargeEvery > 0 && n % Math.round(this.rules.overchargeEvery) === 0;
      if (overcharged) {
        s.pierce = Math.max(s.pierce, 99);
        s.damage *= this.rules.overchargeDamage;
        this.ruleFires.overcharge++;
      }
      if (charge > 0) {
        s.damage *= chargeMul;
        // Counted at half, not at any — see `ruleFires.charged`.
        if (charge >= 0.5) this.ruleFires.charged++;
      }
      this.overchargeVolley = overcharged;
      /*
       * The firing instrument's property slot, ambient for the duration of one
       * dispatch. See the field's own note for why this is not a parameter.
       */
      this.activeProp = propSlot;
      this.fireShape(id, def, s);
      this.activeProp = 0;
      this.overchargeVolley = false;

      /*
       * COUNTERPOINT ANSWERS THE LEADER, on the leader's own activation.
       *
       * Here rather than after the loop, so the copy lands on the same step as
       * the thing it is answering — a frame of separation would read as two
       * weapons that happen to be fast, which is precisely what the item is
       * not.
       */
      if (counterpoint && v === voices[0] && voices.length > 1) {
        this.fireCounterpoint(counterpoint, voices);
      }

      this.lastVolleyBeat = this.transport.beat;
      if (this.onActivation) this.onActivation(id, this.transport.barPhase, s.damage);
      fired = true;
      // The rarest thing that fired this tick gets the voice; see above.
      if (s.interval > firedInterval) {
        firedInterval = s.interval;
        firedId = id as InstrumentId;
      }
    }
    // Nothing holds an orbit instrument: retire the pods rather than leaving
    // the last set circling forever after a fusion consumed them.
    if (!voices.some((v) => v.def.shape === 'orbit')) this.player.podCount = 0;
    /*
     * And the same for lances, for the same reason and with sharper teeth.
     *
     * A lance is refreshed rather than re-pushed, so it outlives its own
     * instrument by `interval + linger` — and `applyFusion` DELETES the base
     * when a recipe lands, so ROSIN BOW evolving into HARMONICS would otherwise
     * leave the bow's line hanging in the arena, still tracking the aim and
     * still dealing damage, for a second and a half. It would expire on its
     * own; it should not have to.
     */
    if (this.effects.length > 0) {
      for (const fx of this.effects) {
        if (!fx.tracks) continue;
        if (held.some(({ id }) => id === fx.id)) continue;
        fx.life = 0;
        fx.age = 0;
      }
    }
    /*
     * `voice` is the instrument's character FAMILY. `src/audio/sfx.ts` builds a
     * per-family voice table precisely so that every instrument sounds like
     * itself without anyone remembering to add a row, and `src/core/events.ts`
     * declares this field because `src/audio/` must not import `src/game/`.
     * This emit did not set it for most of the project's life, so `SHOT_FAMILIES`
     * was unreachable and every fusion in the game sounded like the starting
     * weapon.
     */
    if (fired) {
      const family = firedId
        ? instrumentDef(firedId)?.character.split('—')[0].trim().split(/\s+/)[0]
        : undefined;
      this.bus.emit('player:shoot', { id: firedId ?? undefined, voice: family || undefined });
    }
  }

  /**
   * The dispatch, extracted so COUNTERPOINT can re-enter it.
   *
   * It was the `switch` at the bottom of `fireInstruments` and nothing else has
   * changed about it. Pulling it out is what lets one instrument's activation
   * produce another instrument's geometry without a second copy of the table —
   * a copy that would go stale the first time a shape was added, which is a
   * failure mode `src/render/levelup.ts` already demonstrates for the fusion
   * rules and `npm run mirror` exists to catch.
   */
  private fireShape(id: string, def: InstrumentDef, s: InstrumentStats): void {
    switch (def.shape) {
      case 'seek':
        this.fireSeek(s);
        break;
      case 'arc':
        this.fireArc(id, s);
        break;
      case 'lance':
        this.fireLance(id, s);
        break;
      case 'orbit':
        this.firePods(s);
        break;
      case 'aura':
        this.fireAura(id, s);
        break;
      case 'strike':
        this.fireStrike(id, s);
        break;
      case 'field':
        this.fireField(id, s);
        break;
      case 'rest':
        this.fireRest(id, s);
        break;
      case 'ghost':
        this.fireGhost(id, s);
        break;
      case 'tacet':
        this.fireTacet(id, s);
        break;
      /*
       * The three that are resolved in `fireInstruments`' first pass and have no
       * activation of their own. Listed rather than defaulted, so the day a
       * fifteenth shape is added the compiler names the omission instead of the
       * weapon silently doing nothing — which is the single most repeated defect
       * in this file's history.
       */
      case 'drag':
      case 'counterpoint':
      case 'unison':
        break;
    }
  }

  /**
   * UNISON's conversion, applied to ONE instrument's block.
   *
   * `ratio` is the whole argument for why this item is buildable at all.
   * Re-clocking an instrument from `interval` to one bar multiplies its
   * activations by `interval / bar`, so its damage is multiplied by
   * `bar / interval` and the conversion is throughput-neutral before the
   * ladder's own multiplier is applied. Without it UNISON is a 12x buff to a
   * 0.15s weapon and a 45% nerf to a 3.2s one in the same loadout — two numbers
   * colliding, not a design.
   *
   * CLAMPED AT BOTH ENDS. The upper bound stops a rig-boosted 0.05s instrument
   * asking for a 37x volley, which would put one activation past anything the
   * damage popup can render; the lower stops a very slow instrument being
   * gutted for the crime of already being slower than a bar.
   *
   * The parameter is called `s` and not `u` on purpose: `deadhunt-ranges` greps
   * a routine body for `s.<stat>` to decide which stats a shape reads, so a
   * conventionally-named block is the difference between UNISON's ladder being
   * audited and being invisible. Both bounds are
   * reachable — SPICCATO under RAPID sits at 0.062s (`deadhunt-ranges`
   * enumerates it) and BLACK HOLE at level 1 sits at 6.5s — so neither is
   * decorative.
   */
  private fireUnison(s: InstrumentStats, target: InstrumentStats, barSecs: number): void {
    const ratio = clamp(barSecs / Math.max(0.05, target.interval), World.UNISON_MIN, World.UNISON_MAX);
    target.damage *= ratio * Math.max(0.1, s.damage);
    target.count = Math.max(1, Math.round(target.count + Math.max(0, s.count)));
  }

  /**
   * COUNTERPOINT: the answering voices, fired on the leader's activation.
   *
   * `s.pierce` is HOW MANY answer — the one spare field on a shape with no
   * geometry, and the level step that buys the third voice has nowhere else to
   * put itself. `voices` arrives in acquisition order with the leader at index
   * 0, which is what makes loadout order the decision this item is about.
   *
   * REST AND TACET ARE NOT COPYABLE and the refusal is not squeamishness: both
   * are state machines driven one step per activation (a rest that starts
   * twice, a cycle that advances twice), so a copy would corrupt them rather
   * than duplicate them. Everything with an actual hitbox is fair game,
   * including the ones that place allies and wells.
   *
   * BUDGET: one extra activation per follower per `s.interval`, floored at
   * 0.05s and reaching 0.45s at level 3 — so at most two extra volleys every
   * 0.45s, which is well under what a single fast instrument already produces.
   * It cannot recurse: COUNTERPOINT is filtered out of `voices` before this is
   * called, so a follower can never be another copier.
   */
  private fireCounterpoint(s: InstrumentStats, voices: BandVoice[]): void {
    if (this.time < this.counterpointAt) return;
    this.counterpointAt = this.time + Math.max(0.05, s.interval);
    const followers = Math.max(1, Math.round(s.pierce));
    for (let k = 1; k <= followers && k < voices.length; k++) {
      const f = voices[k];
      if (f.def.shape === 'rest' || f.def.shape === 'tacet') continue;
      const c = applyModifiers(instrumentStats(f.id, f.level), this.mods);
      c.damage *= Math.max(0, s.damage);
      c.count = Math.max(1, Math.round(c.count + Math.max(0, s.count)));
      this.fireShape(f.id, f.def, c);
      this.counterpointCopies++;
    }
  }

  /**
   * RITARDANDO: the drag bubble, folded and drawn.
   *
   * Called EVERY STEP from `fireInstruments`' first pass rather than on the
   * interval, because the bubble is a continuous state and not an activation —
   * the same treatment `orbit` gets for its pods, and for the same reason. The
   * visible pulse is what `interval` and `linger` are for, and it is a ring
   * with `dps: 0`: this item deals no damage, and a bubble that quietly did
   * some would make the card a lie.
   *
   * `s.damage` IS THE DRAG DEPTH and it is signed so more is stronger — the
   * fraction of enemy time REMOVED. See the row in `weapons.ts`: a field
   * holding "enemies run at 55%" would read as a regression to
   * `tools/levelup.mjs` every time the item improved.
   *
   * `s.arc` is what it costs the player, as a fraction added to every
   * instrument's own interval. Folded with `Math.max` rather than multiplied,
   * because two drag sources are one bubble and not two.
   */
  private fireDrag(id: string, s: InstrumentStats, dt: number): void {
    this.dragRadius = Math.max(this.dragRadius, Math.max(40, s.area));
    this.dragDepth = Math.max(this.dragDepth, clamp01(s.damage));
    this.dragSelf = Math.max(this.dragSelf, 1 + Math.max(0, s.arc));
    if (Math.round(s.count) >= 2) this.dragDeepens = true;
    if (dt <= 0 || this.time < this.dragPulseAt) return;
    this.dragPulseAt = this.time + Math.max(0.2, s.interval);
    if (this.novas.length >= World.MAX_NOVAS) return;
    const maxR = Math.max(40, s.area);
    this.novas.push({
      x: this.player.x,
      y: this.player.y,
      r: 0,
      alive: true,
      maxR,
      speed: maxR / Math.max(0.3, s.linger),
      dps: 0,
      hold: 0,
      hue: this.hueOf(id),
      shoves: false,
      prop: 0,
      tick: 0,
    });
  }

  /**
   * REST: a whole bar in which nothing can touch you, and the band stops.
   *
   * `s.linger` IS IN BARS and is converted here, because a rest that ends
   * mid-bar is not a rest — the entire item is built on the player hearing
   * where it starts and where it stops, and the shape carries `beat: 'bar'` so
   * it can only ever begin on a line.
   *
   * The silence itself is published by `writeSnapshot` off `restUntil`, not
   * from here: a mute that is set on an activation and cleared on a timer is a
   * mute that survives a death, a fusion or a pause, and this game has already
   * shipped one stale-reference bug of exactly that shape
   * (`tools/everypowerup.mjs` exists because of it).
   *
   * `s.damage` is read and IS ZERO on every rung of the ladder. It is the
   * return sweep's dps, so the sweep clears bullets and hurts nothing — and if
   * a later editor puts a number in that field they will be undoing the design
   * rather than balancing it, which is the reason to read it rather than
   * ignore it.
   */
  private fireRest(id: string, s: InstrumentStats): void {
    const bars = Math.max(1, Math.round(s.linger));
    const secs = bars * ((BEATS_PER_BAR * 60) / this.transport.bpm);
    this.restUntil = this.time + secs;
    this.player.invuln = Math.max(this.player.invuln, secs);
    this.restSweep = {
      at: this.restUntil,
      area: Math.max(60, s.area),
      rings: clamp(Math.round(s.count) || 1, 1, 4),
      dps: Math.max(0, s.damage),
      hue: this.hueOf(id),
    };
    this.camera.shake(0.18);
    this.particles.burst(this.rng, this.player.x, this.player.y, 26, 200, this.hueOf(id), 0.6, 3);
  }

  /**
   * The bar line the band comes back in on, and the sweep that arrives with it.
   *
   * Separate from `fireRest` because it has to happen whether or not the item
   * is still held, still due, or still in the loadout at all — a player who
   * fuses REST away mid-rest must still get their band back.
   */
  private updateRest(): void {
    const sw = this.restSweep;
    if (!sw || this.time < sw.at) return;
    this.restSweep = null;
    this.clearRoom();
    for (let i = 0; i < sw.rings; i++) {
      if (this.novas.length >= World.MAX_NOVAS) break;
      this.novas.push({
        x: this.player.x,
        y: this.player.y,
        r: -i * 30,
        alive: true,
        maxR: sw.area,
        speed: 620,
        dps: sw.dps,
        hold: 0,
        hue: sw.hue,
        shoves: true,
        prop: 0,
        tick: 0,
      });
    }
    this.shock(this.player.x, this.player.y, sw.area * 1.2, 1400);
    this.camera.shake(0.3);
  }

  /**
   * SOSTENUTO: raise the last thing the player killed.
   *
   * A ghost is an ordinary `BulletFlag.Summon` bullet — same pool, same
   * `updateSummons` steering, same sprite type 2 that `tools/effectsdraw.mjs`
   * already asserts exists. NO NEW CONTAINER, which is the cost model
   * `docs/research-weapons.md` §D.10 sets for any new shape.
   *
   * What is different is `bounces`, which for a summon is otherwise unused and
   * here means STRIKES REMAINING. `collidePlayerBullets` recoils a ghost
   * instead of consuming it while it has strikes left, so it fights rather than
   * being a homing bolt with a long fuse — and the recoil is what rate-limits
   * it, because a piercing ally would sit inside the first body it reached and
   * apply its damage on all 120 steps a second.
   *
   * WORST CASE is `count` ghosts alive at once, capped at `World.MAX_SUMMONS`
   * (the same cap VIBRATO's retinue runs under), so three at level 3 and never
   * more however many things die. The corpse is consumed on use, so a run of
   * kills does not queue up a mob.
   */
  private fireGhost(_id: string, s: InstrumentStats): void {
    if (!this.hasCorpse) return;
    const p = this.player;
    const reach = s.range > 0 ? s.range : 700;
    if (dist2(this.corpseX, this.corpseY, p.x, p.y) > reach * reach) {
      // Too far to raise. The corpse is spent either way: a body kept in the
      // bank until the player happens to walk past it would make the item a
      // delayed-action mine rather than an ally.
      this.hasCorpse = false;
      return;
    }
    const pb = this.playerBullets;
    const want = clamp(Math.round(s.count) || 1, 1, World.MAX_SUMMONS);
    let alive = 0;
    for (let i = 0; i < pb.count; i++) if (pb.flags[i] & BulletFlag.Summon) alive++;
    if (alive >= want) return;
    this.hasCorpse = false;
    this.summonsActive = true;
    pb.spawn({
      x: this.corpseX,
      y: this.corpseY,
      angle: Math.atan2(p.y - this.corpseY, p.x - this.corpseX),
      speed: Math.max(120, s.speed),
      radius: 8,
      ttl: Math.max(1, s.linger),
      damage: s.damage,
      type: 2,
      flags: BulletFlag.Summon,
      bounces: clamp(Math.round(s.bounces) || 1, 1, 200),
    });
    this.particles.emit(this.corpseX, this.corpseY, 0, -40, 0.45, 6, this.corpseHue, ParticleShape.Ring, 2);
    this.ghostsRaised++;
  }

  /**
   * TACET: one bar of the silence cycle.
   *
   * Called on every bar line, because the shape declares `beat: 'bar'` and its
   * `interval` is only a floor beneath it. The cycle is `range` bars playing,
   * then `linger` bars with `count` lanes out of the mix banking `damage` a
   * bar, then the lanes return and the bank is spent as a ring.
   *
   * THE LANES ARE A ROTA over `SILENCEABLE_STEMS` so a long run does not spend
   * itself removing the same part; `SILENCEABLE_STEMS` itself keeps `sub`,
   * `hats`, `fx` and `power` out of reach so there is always something
   * sounding. The mute is published by `writeSnapshot` off `tacetLanes`, for
   * the same staleness reason `fireRest` gives.
   *
   * The bank is spent as `dps` over the ring's crossing, which is the division
   * `fireAura` makes: the number in the table is what a target standing in it
   * takes, rather than a rate that scales with how far the ring travels.
   */
  private fireTacet(id: string, s: InstrumentStats): void {
    if (this.tacetBars > 0) {
      this.tacetBars--;
      if (this.tacetQuiet) this.tacetBank += Math.max(0, s.damage);
      return;
    }
    if (this.tacetQuiet) {
      this.tacetQuiet = false;
      this.tacetLanes.length = 0;
      this.tacetBars = Math.max(1, Math.round(s.range));
      const maxR = Math.max(50, s.area);
      if (this.tacetBank > 0 && this.novas.length < World.MAX_NOVAS) {
        this.novas.push({
          x: this.player.x,
          y: this.player.y,
          r: 0,
          alive: true,
          maxR,
          speed: 460,
          dps: this.tacetBank / Math.max(0.08, maxR / 460),
          hold: 0,
          hue: this.hueOf(id),
          // At two lanes the return shoves the field open as well as burning it.
          shoves: Math.round(s.count) >= 2,
          prop: 0,
          tick: 0,
        });
        this.camera.shake(0.22);
        this.shock(this.player.x, this.player.y, maxR, 900);
      }
      this.tacetBank = 0;
      this.tacetDischarges++;
      return;
    }
    this.tacetQuiet = true;
    this.tacetBars = Math.max(1, Math.round(s.linger));
    this.tacetBank = 0;
    const lanes = clamp(Math.round(s.count) || 1, 1, SILENCEABLE_STEMS.length);
    this.tacetLanes.length = 0;
    for (let k = 0; k < lanes; k++) {
      this.tacetLanes.push(SILENCEABLE_STEMS[(this.tacetRota + k) % SILENCEABLE_STEMS.length]);
    }
    this.tacetRota = (this.tacetRota + lanes) % SILENCEABLE_STEMS.length;
  }

  private hueOf(id: string): number {
    // Stable per id and spread around the wheel, so six simultaneous
    // instruments are six colours rather than six shades of the same one.
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  /**
   * Bolts that CONVERGE on the nearest targets, one each, rather than fanning
   * around the aim.
   *
   * THE BUG THIS REPLACES, because it is worth recording exactly.
   *
   * `computeAim` resolves `seekAim` to the bearing of a specific chosen enemy —
   * that is the whole point of the `seek` shape, whose definition in
   * `weapons.ts` is literally "bolts toward the nearest target inside range".
   * The old body then fanned every bolt AROUND that bearing:
   *
   *     const t = n === 1 ? 0 : i / (n - 1) - 0.5;
   *     const angle = p.seekAim + t * spreadTotal;
   *
   * For any EVEN `n`, `t` never takes the value 0. At n = 2 it is exactly -0.5
   * and +0.5, so both bolts left at `seekAim ± spreadTotal/2` and **nothing was
   * ever fired along the aim at all** — the aim was the gap between the two
   * bolts. PIZZICATO, the instrument every run starts with, is `count: 2`
   * (`weapons.ts:254`). So from the first second of the game the starting
   * weapon computed precisely where a target was and then shot either side of
   * it, and it got worse on the even rungs of its own upgrade ladder.
   *
   * The miss is `distance * tan(spreadTotal / 2)`. At the old 0.32 rad total
   * that is 19px at 120, 27px at the measured 170px median engagement range and
   * 48px at 300, against a typical enemy radius of 15 and a bolt radius of 4.5.
   * Measured live hit rate before this change: 17%, and zero hits at any range
   * at or beyond 120px against a stationary target. "The gameplay doesn't feel
   * snappy" was, in large part, "the gun misses".
   *
   * WHY CONVERGENCE RATHER THAN A NARROWER FAN. Narrowing the spread was the
   * cheaper fix and it is the wrong one twice over. It only moves the range at
   * which the straddle starts costing hits — at 0.12 rad total the bolts still
   * bracket the target from about 325px, which is inside PIZZICATO's 620 range
   * — and it leaves `count` as a stat that makes the weapon LESS accurate. A
   * fan is a spray weapon's idiom; `seek` is the auto-targeting shape, and the
   * two were fighting.
   *
   * Converging turns `count` into what a survivor player expects it to be: more
   * bolts means more things dying at once, because each additional bolt takes
   * the next nearest target. That is the same reading Vampire Survivors gives
   * projectile-count upgrades, and it makes the number legible on screen
   * instead of only in the stat block.
   *
   * The angle is computed from each bolt's own MUZZLE, not from the ship
   * centre, so the lateral offset that separates them visually does not
   * reintroduce a miss at close range — at 40px a 7px offset is 10 degrees.
   *
   * WHAT KEEPS ITS OLD BEHAVIOUR. With no target in range there is nothing to
   * converge on, so the fan survives as the spray it always was, along the
   * facing. That is the case the old code was actually tuned for and it is
   * still the right answer: firing n parallel bolts into empty space would be
   * strictly worse than covering an arc of it.
   */
  private fireSeek(s: InstrumentStats): void {
    const p = this.player;
    const n = Math.max(1, Math.round(s.count));
    /*
     * Focus tightens the fan and raises the damage, exactly as it did for the
     * old gun. It is the one verb that survived the conversion unchanged, and
     * it survived because it got BETTER: in a vertical shmup focus is a
     * defensive crouch, and in an arena where the facing is retained it is how
     * you hold a firing line. Slow movement plus a steady heading plus a
     * tighter, harder shot is a coherent thing to want to do.
     *
     * With convergence it keeps a job: the damage bonus is unchanged, and the
     * spread it tightens is now only the no-target spray.
     */
    const spreadTotal = p.focused ? 0.1 : 0.26 + n * 0.03;
    const damage = s.damage * (p.focused ? 1.45 : 1);

    /*
     * Pick up to `n` targets, nearest first, inside the weapon's own range.
     *
     * Partial selection rather than a sort: `n` is at most a handful and the
     * enemy count is heading upward, so this is O(E*n) with no allocation per
     * shot beyond the small index array. A full sort would be O(E log E) on
     * every shot of every frame a weapon fires.
     *
     * `invuln` shapes are skipped for the same reason `computeAim` skips them —
     * a bolt spent on something that cannot be hurt is a bolt wasted, and on an
     * even count it used to be every bolt.
     */
    const reach = s.range > 0 ? s.range : Infinity;
    const picked: number[] = [];
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.enemies.length; i++) {
        if (picked.includes(i)) continue;
        const e = this.enemies[i];
        if (e.invuln > 0) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > reach + e.radius) continue;
        /*
         * Bias toward what the player is pointing at, so facing still decides
         * something. `computeAim` already prefers near over well-aligned and
         * this keeps that ordering: the discount is small enough that a much
         * closer shape still wins, and large enough that among comparable
         * targets the aimed-at one is taken first.
         */
        const off = Math.abs(angleDelta(p.seekAim, Math.atan2(e.y - p.y, e.x - p.x)));
        const score = d * (1 + off * 0.35);
        if (score < bestD) {
          bestD = score;
          best = i;
        }
      }
      if (best < 0) break;
      picked.push(best);
    }

    for (let i = 0; i < n; i++) {
      const side = (i % 2 === 0 ? -1 : 1) * (p.focused ? 2.5 : 7);
      // Every bolt beyond the target count doubles up on a target that exists,
      // so a high `count` against one enemy is still all damage on that enemy
      // rather than bolts thrown into the dark.
      const target = picked.length > 0 ? this.enemies[picked[i % picked.length]] : null;
      let angle: number;
      let mx: number;
      let my: number;
      if (target) {
        // Offset the muzzle first, then aim FROM it, so the bolts actually meet
        // at the target instead of running parallel past either side of it.
        const nose = Math.atan2(target.y - p.y, target.x - p.x);
        mx = p.x + Math.cos(nose + Math.PI / 2) * side;
        my = p.y + Math.sin(nose + Math.PI / 2) * side;
        angle = Math.atan2(target.y - my, target.x - mx);
      } else {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        angle = p.seekAim + t * spreadTotal;
        mx = p.x + Math.cos(angle + Math.PI / 2) * side;
        my = p.y + Math.sin(angle + Math.PI / 2) * side;
      }
      this.spawnBolt({
        x: mx,
        y: my,
        angle,
        speed: Math.max(120, s.speed),
        radius: s.pierce > 1 ? 7 : 4.5,
        // Range is a distance and the pool expires on time, so convert. Plus a
        // little, or a bolt dies exactly as it reaches the edge of its range.
        ttl: s.range > 0 ? (s.range / Math.max(120, s.speed)) * 1.05 : 2,
        damage,
        type: s.pierce > 1 ? 1 : 0,
        bounces: s.bounces,
        flags: this.shotFlags,
      });
    }
  }

  /**
   * An arc: a fan of projectiles if it travels, an instant sweep if it does not.
   *
   * Both are the same gesture — a stroke through the arc you are facing — and
   * which one an instrument gets is decided by whether its `speed` is non-zero.
   * HARP GLISS throws a fan; SNARE ROLL sweeps a blade. `count` above one adds
   * further strokes evenly around the compass, which is what turns BLAST BEAT
   * and CROSS-STRUNG into the all-round weapons their notes promise.
   */
  private fireArc(id: string, s: InstrumentStats): void {
    const p = this.player;
    const strokes = Math.max(1, Math.round(s.count));
    if (s.speed > 0) {
      // A travelling fan. `count` is the number of projectiles, not strokes.
      const arc = s.arc > 0 ? s.arc : 0.6;
      for (let i = 0; i < strokes; i++) {
        const t = strokes === 1 ? 0 : i / (strokes - 1) - 0.5;
        const angle = p.aim + t * arc;
        this.spawnBolt({
          x: p.x,
          y: p.y,
          angle,
          speed: s.speed,
          radius: 5,
          ttl: s.range > 0 ? (s.range / s.speed) * 1.05 : 1.6,
          damage: s.damage * (p.focused ? 1.35 : 1),
          type: s.pierce > 1 ? 1 : 0,
          // Passed even though no `arc` instrument sets it today. A stat that
          // one spawning routine honours and another silently drops is exactly
          // the defect this was: better that the table decides, and that a
          // future bouncing fan works the day someone writes one.
          bounces: s.bounces,
          flags: this.shotFlags,
        });
      }
      return;
    }
    const reach = Math.max(s.range, s.area);
    for (let i = 0; i < strokes; i++) {
      const angle = p.aim + (i / strokes) * TAU;
      this.effects.push({
        kind: 'sweep',
        id,
        x: p.x,
        y: p.y,
        angle,
        radius: 0,
        length: reach,
        arc: s.arc > 0 ? s.arc : 1.2,
        // A sweep is instantaneous in feel and short in fact; spending its
        // whole damage over a 0.16s life is what makes it a stroke rather than
        // a lingering hitbox that mows down anything that walks into it.
        dps: s.damage / 0.16,
        life: 0.16,
        age: 0,
        hue: this.hueOf(id),
        attached: true,
        tracks: false,
        offset: 0,
        pull: 0,
        swallows: false,
        prop: this.activeProp,
        tick: PROP.fieldTick,
      });
    }
    this.camera.shake(0.05);
  }


  /**
   * A LANCE: one continuous line welded to the ship, tracking the aim, never
   * re-fired.
   *
   * THE OWNER ASKED FOR A LASER BY NAME and ROSIN BOW's card has promised one
   * the whole time — "One held beam along your facing. It does not stop."
   * `fireBeam` re-fired it every interval and, from `count: 2` upward, threw
   * half of it out of the back of the ship. This routine is the sentence.
   *
   * IT CREATES AND REFRESHES; IT NEVER PUSHES A SECOND SET. The instrument's
   * clock still runs — that is what emits `player:shoot`, so the lane still
   * gets voiced on the instrument's own cadence — but when it comes due the
   * lines that already exist have their stats rewritten and their `age` reset
   * rather than being replaced. Pushing per activation would stack effects
   * without bound, since nothing expires them.
   *
   * `life` is `interval + linger`, and both halves are load-bearing.
   * `interval` is what makes the refresh land before the expiry, so the line
   * genuinely never gaps; `linger` is what makes FERMATA and the rig's
   * `linger` multiplier mean something on this shape, and it is what makes the
   * line fade out by itself a moment after the instrument stops being held
   * rather than hanging in the arena forever. The renderer's fade is
   * `age / life`, so a longer `linger` also reads as a STEADIER line — the
   * brightness dips less between refreshes — which is exactly what "held much
   * steadier" on ROSIN BOW's first step now buys.
   *
   * WHAT IT READS: `interval` (the refresh clock and the damage divisor),
   * `count` (parallel lines), `damage`, `area` (half-width), `range` (length)
   * and `linger`. `speed`, `pierce`, `bounces` and `arc` are deliberately
   * unread: a held line has no travel speed, no wall to come off, no angular
   * width beyond its own thickness, and nothing to pass through because it
   * damages everything it crosses already.
   *
   * POWER IS NEUTRAL BY CONSTRUCTION. `fireBeam` sets `dps = damage / life`
   * and overlaps `life / interval` generations, so a target inside one stroke
   * takes `damage / interval` per second. This sets `dps` to that value
   * directly. Neither ROSIN BOW's nor HARMONICS' stat block moved.
   *
   * BUDGET: `count` Effect objects, permanently, and zero `BulletPool`
   * entries. The cheapest shape in `docs/research-weapons.md`'s catalogue.
   */
  private fireLance(id: string, s: InstrumentStats): void {
    const p = this.player;
    const lines = Math.max(1, Math.round(s.count));
    const half = Math.max(4, s.area);
    const life = Math.max(0.2, s.interval) + Math.max(0, s.linger);
    // A held line spends `damage` once per interval on whatever is in it,
    // which is what a re-fired beam already delivered. See above.
    const dps = s.damage / Math.max(0.05, s.interval);
    const hue = this.hueOf(id);

    let seen = 0;
    for (const fx of this.effects) {
      if (!fx.tracks || fx.id !== id) continue;
      seen++;
      if (seen > lines) {
        // The ladder can only ever ADD lines, but a duet or a fusion can hand
        // this id a smaller `count`, so shrink rather than leave orphans that
        // nothing will ever refresh.
        fx.life = 0;
        fx.age = 0;
        continue;
      }
      fx.radius = half;
      fx.length = Math.max(120, s.range);
      fx.dps = dps;
      fx.life = life;
      fx.age = 0;
      fx.offset = this.lanceOffset(seen - 1, lines, half);
      // The refresh rewrites the stats, so it must rewrite the property set
      // too: a lance held across a level-up would otherwise keep applying the
      // slow it was born with for the rest of the run.
      fx.prop = this.activeProp;
    }
    for (let i = seen; i < lines; i++) {
      this.effects.push({
        kind: 'beam',
        id,
        x: p.x,
        y: p.y,
        angle: p.aim,
        radius: half,
        length: Math.max(120, s.range),
        arc: 0,
        dps,
        life,
        age: 0,
        hue,
        attached: true,
        tracks: true,
        offset: this.lanceOffset(i, lines, half),
        pull: 0,
        swallows: false,
        prop: this.activeProp,
        // Starts DUE, so a line that is only held for a moment still applies
        // once. A lance is refreshed rather than re-pushed, so an effect that
        // started its cadence at zero would apply on its first frame anyway;
        // this makes the refresh path below behave the same way.
        tick: PROP.fieldTick,
      });
    }
  }

  /**
   * Where the i-th of `n` parallel lances sits, perpendicular to the aim.
   *
   * Spaced at 2.4 half-widths so the lines read as separate strings with a gap
   * rather than as one thick beam — HARMONICS is "three parallel beams" and a
   * player has to be able to count them — and centred, so an odd count still
   * puts one line exactly on the aim. That last part is the bug `fireSeek`'s
   * comment records at length: an even fan that never fires along the bearing
   * it computed. Here it costs nothing to get right.
   */
  private lanceOffset(i: number, n: number, half: number): number {
    if (n <= 1) return 0;
    return (i - (n - 1) / 2) * half * 2.4;
  }



  /** Pods fire outward along their own orbit angle. */
  private firePods(s: InstrumentStats): void {
    const p = this.player;
    for (let i = 0; i < p.droneAngle.length; i++) {
      if (p.droneCooldown[i] > 0) continue;
      const pos = p.dronePos(i);
      // Radially outward from the ship, so a full set of pods covers the
      // compass — the canonical arena orbit, and the reason the shape exists.
      const angle = Math.atan2(pos.y - p.y, pos.x - p.x);
      this.spawnBolt({
        x: pos.x,
        y: pos.y,
        angle,
        /*
         * The floor at 200 is load-bearing for CHORALE and worth naming.
         *
         * CHORALE sets no `speed` at all, so this floor invents one: measured,
         * it is the only place in the six routines where a per-shape floor
         * actually bites (0.9% of activations). Its evolution line reads "the
         * satellites stop moving and start singing", which sounds like the
         * omission is deliberate — but `speed` here is the BULLET's speed, not
         * the orbit's, and the pods' orbit rate comes from `Player.dronePos`
         * and is not an instrument stat at all. So the `orbit` shape has no
         * input that could express "the satellites stop moving", and CHORALE's
         * stated identity cannot currently be built out of the stats it has.
         *
         * Left as-is rather than guessed at: giving the shape an orbit-rate
         * input is a feature, and picking a bullet speed for CHORALE by hand
         * would be inventing a balance number to paper over the gap. Recorded
         * so the next person sees the floor is doing design work.
         */
        speed: Math.max(200, s.speed) * 0.92,
        radius: 4,
        ttl: s.range > 0 ? (s.range / Math.max(200, s.speed)) * 1.05 : 1.4,
        damage: s.damage,
        type: s.pierce > 1 ? 1 : 0,
        // Likewise zero for both orbit instruments today; see `fireArc`.
        bounces: s.bounces,
        flags: this.shotFlags,
      });
    }
  }

  /**
   * A ring on the beat, centred on the ship.
   *
   * `linger` IS read now, as a hold at full radius — see `hold` on `novas`.
   *
   * This comment used to say the opposite, and it was right when written: the
   * ring expanded until it passed `maxR` and was spliced out, so NOVA's "the
   * ring hangs before it fades" (L6, `linger` 0.35 -> 0.63) and TIMPANI's "the
   * wave staggers what survives it" (L6, 0.25 -> 0.45) were two level choices
   * that changed nothing. `tools/deadhunt-ranges.mjs` found them by slicing
   * this routine out of the file and diffing the stats it reads against the
   * stats its shape's instruments set.
   *
   * They were repaired once the balance objection dissolved: the ring holds
   * for `linger` and the same total damage is divided over the crossing plus
   * the hold, so a longer hold changes the SHAPE of the effect and not its
   * power. `deadhunt-ranges` now reports 0 of 84 level steps as dead.
   *
   * Still unread here, and correctly: REQUIEM's `range: 900` and `pierce: 99`.
   * An expanding ring has neither a range nor anything to pass through, so
   * those are noise in the table rather than a missing feature.
   */
  private fireAura(id: string, s: InstrumentStats): void {
    const p = this.player;
    const rings = Math.max(1, Math.round(s.count));
    for (let i = 0; i < rings; i++) {
      // `World.MAX_NOVAS`, which this array did not have until `mortar` needed
      // one. It cannot bite here at any measured density — the peak over three
      // eight-minute runs is 240 against a cap of 420 — and it is applied to
      // every push site rather than only to the new ones, because a cap that
      // half the writers ignore is not a cap.
      if (this.novas.length >= World.MAX_NOVAS) break;
      this.novas.push({
        x: p.x,
        y: p.y,
        // Stagger concentric rings so a `count` of three reads as three pulses
        // rather than as one thick one.
        r: -i * 26,
        alive: true,
        maxR: Math.max(40, s.area),
        speed: 430,
        /*
         * Damage is spread over the crossing AND the hold, so honouring
         * `linger` costs nothing in power.
         *
         * That is what unblocked implementing it: a ring that hangs for longer
         * while dealing the same damage per second would be a straight buff on
         * two level steps nobody here can play-test. Dividing the same total
         * over the longer window makes the level a change in SHAPE — the ring
         * catches what walks into it later instead of only what it sweeps past
         * — which is what "the ring hangs before it fades" actually describes.
         */
        hold: Math.max(0, s.linger),
        dps: s.damage / (Math.max(0.08, Math.max(40, s.area) / 430) + Math.max(0, s.linger)),
        hue: this.hueOf(id),
        shoves: true,
        prop: this.activeProp,
        tick: 0,
      });
    }
    this.shock(p.x, p.y, Math.max(40, s.area) * 1.3, 900);
  }

  /**
   * A strike: an unaimed hit that lands ON something and burns a circle.
   *
   * CHIME's blurb has always described this — "strikes something at random from
   * above, you do not aim it" — and the instrument was declared `seek`, so it
   * fired a bolt along `seekAim` at the `Math.max(120, s.speed)` floor and
   * threw away the `area` its ladder spends two steps widening. See the
   * `strike` member of `InstrumentShape` for why this is a new shape rather
   * than `fireSeek` learning to read `area`: pushing an area-of-effect onto the
   * four instruments that are balanced as point bolts would be a rebalance
   * wearing a repair's clothes.
   *
   * WHAT IT READS: `count` strikes per activation, each landing on a random
   * live enemy within `range` of the ship and dealing `damage` to everything
   * within `area` of where it landed. `speed` is deliberately unread.
   *
   * THE TARGET POOL REFILLS WHEN IT EMPTIES, which is the one decision here
   * that is not forced. Striking only distinct enemies reads better — "strikes
   * something at random" — but CHIME reaches five strikes at level 8 and the
   * arena runs a median of two enemies on the field, so distinct-only would
   * have quietly killed "a fourth and fifth strike" on exactly the thin waves
   * where the ladder is supposed to be paying off. That is the defect this
   * whole audit is about, so the pool refills: five strikes on one enemy is
   * five hits, and the step always buys something.
   *
   * The ring pushed into `novas` is a VISUAL, with `dps: 0` and `clears: false`
   * — the damage above is instantaneous and area-flat, so a bell that lands
   * wider hits more things rather than each thing more weakly. `novas` is
   * borrowed because it is drawn: `world.effects` has no reader outside this
   * file, so a strike built on the beam/sweep container would have been
   * invisible.
   */
  private fireStrike(id: string, s: InstrumentStats): void {
    const p = this.player;
    const strikes = Math.max(1, Math.round(s.count));
    const reach = s.range > 0 ? s.range : 460;
    const reachSq = reach * reach;
    const radius = Math.max(24, s.area);
    const hue = this.hueOf(id);

    const pool: Enemy[] = [];
    for (let k = 0; k < strikes; k++) {
      if (pool.length === 0) {
        for (const e of this.enemies) {
          if (!e.alive || e.invuln > 0) continue;
          if (dist2(e.x, e.y, p.x, p.y) > reachSq) continue;
          pool.push(e);
        }
        // Nothing in reach. A bell over an empty field is silence, not a shot
        // fired at the horizon.
        if (pool.length === 0) return;
      }
      const target = pool.splice(this.rng.int(0, pool.length), 1)[0];
      const x = target.x;
      const y = target.y;

      /*
       * THE STRIKE'S OWN CIRCLE, then the property splash ONCE from the
       * landing point.
       *
       * Once and not per body: TIMPANI's quake is "and 40 more to everything
       * within 200px", and calling `onHit` for each of the five things already
       * inside the strike would run five overlapping quakes from five slightly
       * different centres — the same damage delivered five times, which is a
       * weapon nobody wrote.
       */
      for (const e of this.enemies) {
        if (!e.alive || e.invuln > 0) continue;
        const rr = radius + e.radius;
        if (dist2(e.x, e.y, x, y) > rr * rr) continue;
        this.hurt(e, s.damage, true);
        if (e.hitFlash < 0.07) e.hitFlash = 0.07;
        if (this.activeProp !== 0) this.applyStatus(e, this.activeProps);
      }
      if (this.activeProp !== 0) {
        this.onHit(target, this.activeProps, this.activeProp, x, y, Math.atan2(y - p.y, x - p.x));
      }

      // See `fireAura` for why the guard is here too. This ring is a visual, so
      // dropping it under an already-saturated array costs a picture and no
      // damage — the hit above has already landed.
      if (this.novas.length < World.MAX_NOVAS) {
        this.novas.push({
          x,
          y,
          r: 0,
          alive: true,
          maxR: radius,
          speed: Math.max(260, radius * 5),
          dps: 0,
          // A visual only — no damage, so nothing to hang. See `hold`.
          hold: 0,
          hue,
          shoves: false,
          prop: 0,
          tick: 0,
        });
      }
      this.particles.emit(x, y, 0, -30, 0.3, 4, hue, ParticleShape.Ring, 1);
    }
    this.camera.shake(0.04);
  }





  /**
   * A field, placed rather than centred.
   *
   * A field that swallows bullets becomes a CHARGE the player throws, because
   * choosing the moment to turn a screen of bullets into a payday is the most
   * interesting decision in the game and automating it would delete it. A field
   * that only burns drops itself on the nearest enemy, because asking the
   * player to aim a damage pool every second is busywork.
   */
  private fireField(id: string, s: InstrumentStats): void {
    /*
     * THIS IS THE ONE SHAPE THAT IGNORES `count`, and three level steps promise
     * otherwise.
     *
     * Every other routine loops: `fireSeek` over `n`, `fireArc` over `strokes`,
     * `fireBeam` over `beams`, `fireAura` over `rings`, `firePods` over the
     * pods. This one places exactly one well per activation, and the swallowing
     * branch below banks exactly one charge, whatever `s.count` says.
     *
     * So TREMOLO FIELD's "a second pool per drop" (L2) and "a third pool" (L7)
     * and BLACK HOLE's "a second well" (L6) are three of the seven decisions
     * those ladders offer, and they buy nothing; DOWNBEAT arrives with count 2
     * and VIBRATO with count 4, and both place one. `tools/deadhunt-ranges.mjs`
     * slices the six routines out of this file and cross-references them
     * against the stat blocks their shape's instruments set — it reports 8 of
     * the 84 level steps as moving only fields their own shape ignores, and
     * these three are among them.
     *
     * FIXED, and power-neutrally, which is what unblocked it.
     *
     * The objection recorded here was real: looping this naively roughly
     * triples TREMOLO's output and doubles BLACK HOLE's, and that is a balance
     * change nobody in this workstream can play-test. But that objection is
     * only about DAMAGE. Read what the levels actually promise — "a second
     * pool per drop", "a third pool" — and they promise COVERAGE, not power.
     *
     * So `pushField` places `count` pools ringed around the target and divides
     * the damage between them. Total damage per activation is unchanged by
     * construction, so there is no balance change to play-test; what the
     * player gets is the area the text describes. A level that reads "a second
     * pool" and produces a second pool is the behavioural change `weapons.ts`
     * asks for, and it no longer requires a judgement call nobody here can
     * make.
     */
    if (s.linger <= 0) return;
    if (this.fieldSwallows(id)) {
      // Hold the newest stats, so a charge banked at level 2 and thrown at
      // level 4 is thrown at level 4. Anything else means the player is
      // rewarded for spending charges before they upgrade, which is a strategy
      // nobody should have to know about.
      this.pendingWell = { id, stats: s };
      this.player.wells = Math.min(3, this.player.wells + 1);
      return;
    }
    const target = this.nearestEnemy();
    const x = target ? target.x : this.player.x + this.player.facingX * 140;
    const y = target ? target.y : this.player.y + this.player.facingY * 140;
    // `s.count` is read HERE rather than inside the helper on purpose:
    // `tools/deadhunt-ranges.mjs` slices each `fire*` routine and greps it for
    // the stat names, so a stat consumed only in a helper reads to that audit
    // as still ignored — which is exactly the report that found this bug.
    this.pushField(id, s, x, y, clamp(Math.round(s.count) || 1, 1, 3));
  }

  /**
   * DOWNBEAT alone eats bullets and is thrown by hand; the other fields drop
   * where they are needed.
   *
   * `blackhole` LEFT THIS LIST, and the reason is a real cost worth naming.
   * The id is FERMATA now — a dropped snare that holds what stands in it — and
   * a swallowing field is not dropped, it is BANKED as a charge and thrown
   * with the well key. A base weapon whose whole property only happens when
   * the player presses a second button is a base weapon whose property does
   * not happen, which is the defect class this pass exists to remove.
   *
   * The charge mechanic and the well key are not deleted: DOWNBEAT is
   * FERMATA's evolution and still carries them, so the input, `throwWell`,
   * `pendingWell` and `player.wells` all stay reachable — one tier further up
   * than before.
   */
  private fieldSwallows(id: string): boolean {
    return id === 'downbeat';
  }

  /** The charge waiting to be thrown, and the stats it will be thrown with. */
  private pendingWell: { id: string; stats: InstrumentStats } | null = null;

  private throwWell(): void {
    const held = this.pendingWell;
    if (!held) return;
    const p = this.player;
    // Thrown ahead of the ship along the facing rather than "up the screen",
    // which is what it used to be and which in the round would fire it into a
    // wall roughly half the time.
    const reach = 210;
    this.pushField(
      held.id,
      held.stats,
      clamp(p.x + p.facingX * reach, 60, this.width - 60),
      clamp(p.y + p.facingY * reach, 60, this.height - 60),
      clamp(Math.round(held.stats.count) || 1, 1, 3),
    );
    this.camera.shake(0.35);
    this.announce(labelOf(held.id), '', 'item');
  }

  /**
   * Place `s.count` pools around (x,y), sharing one activation's damage.
   *
   * See the note in `fireField`. The ring radius is tied to the pool's own
   * area so the group reads as one wider field rather than as scattered
   * unrelated pools, and every position is clamped inside the arena so a
   * spread near a wall does not put half the field out of play.
   */
  private pushField(id: string, s: InstrumentStats, x: number, y: number, n: number): void {
    if (n <= 1) {
      this.pushWell(id, s, x, y, 1);
      return;
    }
    const spread = Math.max(40, s.area) * 0.85;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.pushWell(
        id,
        s,
        clamp(x + Math.cos(a) * spread, 60, this.width - 60),
        clamp(y + Math.sin(a) * spread, 60, this.height - 60),
        1 / n,
      );
    }
  }

  private pushWell(id: string, s: InstrumentStats, x: number, y: number, share = 1): void {
    // Raised from 8 with `count`: a three-pool TREMOLO drop places three at
    // once, so the old cap bit on the second activation rather than the eighth.
    if (this.wells.length >= 14) return;
    const swallows = this.fieldSwallows(id);
    this.wells.push({
      x,
      y,
      age: 0,
      life: Math.max(0.4, s.linger),
      radius: Math.max(40, s.area),
      dps: (s.damage * share) / Math.max(0.4, s.linger),
      pull: swallows ? 90 : 0,
      swallows,
      hue: this.hueOf(id),
      id,
      prop: this.activeProp,
      // Due immediately: a pool should poison what is already standing in it
      // on the frame it lands, not 0.3s later.
      tick: PROP.fieldTick,
    });
  }

  private nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.enemies) {
      const d = dist2(e.x, e.y, this.player.x, this.player.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * True once an enemy has crossed into the VIEW and may start firing.
   *
   * Was the field rectangle, which was the same rectangle. The two callers both
   * want "on screen" and always did — `updateEnemies` uses it to decide whether
   * an enemy may shoot, and `analyseEncirclement` uses it to decide whether an
   * enemy counts toward closing the ring. An enemy 2000px behind the player in
   * a 3000px field is neither a threat the player can answer nor part of a
   * circle around them, and letting it fire would be shots arriving from
   * nowhere.
   *
   * The 30px of slack is kept from the original: it lets a shape that is
   * one pixel from the edge open fire rather than waiting a frame, which is
   * what stops a group's first volley scattering off the beat grid.
   */
  private hasEntered(e: Enemy): boolean {
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    return e.x > vx - 30 && e.x < vx + this.viewW + 30 && e.y > vy - 30 && e.y < vy + this.viewH + 30;
  }

  /**
   * The rectangle groups arrive from the outside of: the VIEW, centred on the
   * camera.
   *
   * `viewX`/`viewY` rather than the composed `camera.x`/`camera.y`, for the
   * same reason `main.ts`'s `toWorld` does it: the composed offset carries
   * screenshake, and a spawn ring that jittered with every explosion would
   * make the arrival distance a function of how recently something blew up.
   */
  private spawnRing(): SpawnRing {
    return {
      cx: this.camera.viewX + this.viewW / 2,
      cy: this.camera.viewY + this.viewH / 2,
      w: this.viewW,
      h: this.viewH,
    };
  }

  // -------------------------------------------------------------------------
  // snapshot
  // -------------------------------------------------------------------------

  private writeSnapshot(dt: number): void {
    const s = this.snapshot;
    s.time = this.time;
    s.running = this.phase !== 'over' && this.phase !== 'idle';
    s.paused = false;
    s.gameOver = this.phase === 'over';

    s.playerHp = this.player.hp;
    s.playerMaxHp = this.player.maxHp;
    s.lives = this.player.lives;
    s.maxLives = this.player.maxLives;
    s.bombs = this.player.bombs;
    s.wells = this.player.wells;
    s.timeSinceHit = this.player.timeSinceHit;
    s.invulnerable = this.player.invuln > 0;
    s.focused = this.player.focused;
    /*
     * WHICH LANES OF THE PLAYER'S OWN SOUNDTRACK ARE OUT.
     *
     * Rebuilt from state every step rather than written at the moment REST or
     * TACET fires, and that is the whole reason it lives here. A mute set on an
     * activation and cleared on a timer is a mute that survives a death, a
     * fusion that eats the item, and the level-up pause; this cannot, because
     * the two conditions are re-read from scratch on every frame and both
     * evaluate to "nothing" once the run is over.
     *
     * REST wins outright while it is running — the whole band is already out,
     * so a tacet lane inside it is not a second statement.
     *
     * MUTATED IN PLACE. The director holds this array across frames.
     */
    const hushed = s.tacetStems;
    hushed.length = 0;
    if (this.phase !== 'over' && !this.player.dead) {
      if (this.restUntil > this.time) for (const lane of SILENCEABLE_STEMS) hushed.push(lane);
      else for (const lane of this.tacetLanes) hushed.push(lane);
    }
    /*
     * DEPRECATED, and kept populated only so nothing downstream breaks on the
     * frame this lands.
     *
     * "How far up the playfield the player is" was a genuine danger proxy in
     * the vertical game and means nothing in the round: the player lives near
     * the middle, so this now spends a run hovering around 0.5. It is exactly
     * the shape `tools/deadconditions.mjs` exists to find — a condition that
     * looks responsive in the source and is a constant in play.
     *
     * `nearestThreat` and `encirclement` are the replacements. Nothing here
     * re-derives the melody's register from them; that is the audio side's call
     * and changing it from this file would be changing someone else's music.
     */
    s.playerHeight = clamp01(1 - this.player.y / this.height);

    /*
     * The crowd term. Was `s.bulletCount = this.enemyBullets.count`.
     *
     * `this.enemies.length` deliberately, and not the on-screen count: this
     * feeds `tension.density`, the arrangement's "how busy is it" input, and an
     * enemy chasing the player from just off camera is part of how busy it is.
     * `s.enemyCount` two lines down is the same number today and is kept
     * separate because it is read against a different scale (`tension.threat`)
     * and one of the two will move first.
     */
    s.pressureCount = this.enemies.length;
    // threatsNear / threatsVeryNear / timeToContact are written by collidePlayer.

    s.enemyCount = this.enemies.length;
    for (const key of Object.keys(s.enemies) as EnemyArchetype[]) s.enemies[key] = 0;
    let hp = 0;
    let maxHp = 0;
    for (const e of this.enemies) {
      s.enemies[e.archetype]++;
      hp += e.hp;
      maxHp += e.maxHp;
    }
    s.enemyThreat = maxHp > 0 ? clamp01(hp / maxHp) : 0;

    s.bossActive = !!this.boss;
    s.bossPhase = this.boss?.phase ?? 0;
    s.bossPhases = this.boss?.phases ?? 0;
    s.bossHp = this.boss ? clamp01(this.boss.hp / this.boss.maxHp) : 1;

    s.wave = this.waveIndex;
    s.waveProgress =
      this.plan.entries.length > 0 ? clamp01(this.entryCursor / this.plan.entries.length) : 1;
    s.difficulty = this.plan.difficulty;

    s.score = this.score;
    s.combo = this.combo;
    s.grazeRate = damp(s.grazeRate, this.player.grazeRate, 0.35, dt);
    s.killRate = damp(s.killRate, this.killsThisStep / Math.max(dt, 1e-4), 0.5, dt);
    this.killsThisStep = 0;
    s.enemyFireRate = damp(s.enemyFireRate, this.volleysThisStep / Math.max(dt, 1e-4), 0.4, dt);
    this.volleysThisStep = 0;
    /*
     * `playerFiring` had to be redefined or it would be a constant.
     *
     * It used to mean "the fire button is held", and `tools/faders.mjs` already
     * found that measured true 100% of the time across 789 samples in a bullet
     * hell, so a rule written as a dynamic response was a permanent cut. With
     * auto-fire the button is gone entirely and the old reading would be true
     * by construction, forever.
     *
     * It now means ENGAGED: the ensemble is discharging AND there is something
     * within reach of the aim for it to discharge at. That varies — it is false
     * while crossing the arena between groups and true in a fight — and it is
     * closer to what any musical rule keyed to it was reaching for anyway.
     */
    s.playerFiring = !this.player.dead && this.phase !== 'over' && this.nearestThreat < 0.85;
    s.powerups = this.player.powerups;
    s.loadoutSlots = this.player.maxActive;
    s.movement = this.movement;

    /*
     * Progression. The loadout IS the mix, so this is the most important thing
     * on the snapshot.
     *
     * `writeAbilityLevels` MUTATES `s.abilities` in place and is never replaced
     * with `s.abilities = prog.abilityLevels(...)`. The director holds this
     * reference across frames; handing it a fresh object leaves the music
     * reading a map that stopped changing. That bug already shipped once in
     * this project with `player.powerups`, and `tools/everypowerup.mjs` exists
     * because of it.
     */
    s.level = this.progression.level;
    s.xp = this.progression.xp;
    s.xpToNext = prog.xpToNext(this.progression.level);
    /*
     * How many level-ups are waiting to be spent.
     *
     * Published because banking them made it possible to have some and not
     * know: the offer no longer interrupts, so the ONLY thing telling a player
     * they are three levels behind is the HUD. A banked reward nobody can see
     * is worse than one that interrupts.
     */
    s.pendingOffers = this.progression.pending;
    prog.writeAbilityLevels(this.progression, s.abilities as Record<string, number>);
    s.instrumentSlots = this.progression.instrumentSlots;
    s.rigSlots = this.progression.rigSlots;
    s.choosing = prog.isChoosing(this.progression);
    s.fusions = this.progression.fusions.length;

    /*
     * The danger signal, and the ship's heading.
     *
     * These four are what replace `playerHeight` for the music. The register
     * follows `encirclement` and the filter follows `nearestThreat`, so if
     * these are ever left at their `emptySnapshot` defaults the score goes
     * static and the cause looks like an audio bug rather than a missing feed.
     * That failure mode is why they are written here, next to everything else,
     * rather than in the analysis pass that computes them.
     */
    s.nearestThreat = this.nearestThreat;
    s.encirclement = this.encirclement;
    s.facing = this.player.facing;
    s.facingSettled = this.player.facingSettled;
  }

  /* ---------------------------------------------------------------------- *
   * The danger signal, read from outside
   *
   * On the world rather than only on the snapshot because the renderer wants
   * `escapeAngle` — pointing at the way out is the most useful single thing the
   * HUD could draw in this game — and the renderer does not read the snapshot.
   * ---------------------------------------------------------------------- */

  /** 0 when something is touching the ship, 1 when nothing is within ~520px. */
  get threatDistance(): number {
    return this.nearestThreat;
  }

  /** 0 with a wide-open escape corridor, 1 when the ring has closed. */
  get encircled(): number {
    return this.encirclement;
  }

  /** Bearing of the widest gap in the ring, radians. The way out. */
  get wayOut(): number {
    return this.escapeAngle;
  }

  /** Where the next group will deliberately NOT come from, radians. */
  get safeBearing(): number {
    return this.gapAngle;
  }

  /**
   * Nominal damage per second of the whole ensemble, rig folded in.
   *
   * For tooling. `tools/ttk.mjs` and `tools/roster.mjs` both read
   * `player.weapon().damage` today and there is no longer a `weapon()` to read
   * — the ship's output is six clocks, not one function — so this is the
   * replacement, and it is deliberately NOMINAL: damage per activation times
   * activations per second, summed, with no account taken of what actually
   * connects.
   *
   * Read it as a budget, never as dps. A sweep hits everything in its arc and a
   * seek bolt hits one thing if it hits anything, so a build with the same
   * number here can be worth wildly different amounts in play. That gap is
   * exactly what `ttk` exists to measure and this cannot substitute for it.
   */
  ensembleDps(): number {
    let total = 0;
    for (const { id, level } of prog.activeInstruments(this.progression)) {
      const def = instrumentDef(id);
      if (!def) continue;
      /*
       * THE FOUR SHAPES WHOSE `damage` IS NOT DAMAGE ARE SKIPPED.
       *
       * REST is 0 and would contribute nothing anyway; RITARDANDO's `damage` is
       * the drag depth, UNISON's is a multiplier and COUNTERPOINT's is a share.
       * Summing those into a column labelled "nominal dps" would put a drag
       * fraction of 0.72 and a volley multiplier of 1.45 into every balance
       * tool in `tools/` as if they were hit points, and this column feeds
       * `tools/arena.mjs`, the HUD and the run summary. A number that is wrong
       * in an obvious unit is much less dangerous than one that is wrong by a
       * factor nobody notices.
       */
      if (World.NO_DPS.has(def.shape)) continue;
      const s = applyModifiers(instrumentStats(id, level), this.mods);
      total += (s.damage * Math.max(1, Math.round(s.count))) / Math.max(0.05, s.interval);
    }
    return total;
  }

  /** Every ability id currently held, with its level. For the HUD. */
  loadout(): { id: AbilityId; level: number }[] {
    const out: { id: AbilityId; level: number }[] = [];
    for (const [id, level] of Object.entries(this.progression.instruments)) {
      out.push({ id: id as AbilityId, level });
    }
    for (const [id, level] of Object.entries(this.progression.rig)) {
      out.push({ id: id as AbilityId, level });
    }
    return out;
  }

  get isOver(): boolean {
    return this.phase === 'over';
  }
}
