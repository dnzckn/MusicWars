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
  type AbilityId,
  type EnemyArchetype,
  type GameSnapshot,
  type InstrumentId,
} from '../core/events';
import { clamp, clamp01, damp, dist2, TAU } from '../core/math';
import { Rng } from '../core/rng';
import { BEATS_PER_BAR, Transport } from '../core/transport';
import { BulletFlag, BulletPool } from './bullets';
import { Camera } from './camera';
import {
  ARCHETYPE_INFO,
  armedChance,
  commitBossPhase,
  markBossPhasePending,
  spawnBoss,
  spawnEnemy,
  type Enemy,
  type EnemyContext,
} from './enemies';
import { burstOnce } from './emitters';
import { ParticlePool, ParticleShape } from './particles';
import { angleDelta, PLAYER_HITBOX, Player } from './player';
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
  instrumentDef,
  instrumentStats,
  labelOf,
  noModifiers,
  type InstrumentStats,
  type Modifiers,
} from './weapons';
import {
  arenaSpawnPositions,
  BOSS_EVERY,
  formationWidth,
  planWave,
  type Formation,
  type WavePlan,
} from './waves';

/** What a centre-screen announcement is about. */
export type BannerKind = 'wave' | 'boss' | 'phase' | 'grade' | 'archetype' | 'item';

/*
 * The field, widened from 720x960.
 *
 * "Perhaps expand the map size", asked for alongside "enemies that shoot should
 * be rare, they should move slower, and take a few more hits" — the same wish
 * from two directions. A bigger field is what makes fewer, tougher enemies read
 * as a stage you pick apart instead of a swarm you flinch at: there is somewhere
 * to go, and a bullet crossing it gives you time to decide.
 *
 * Widened proportionally more than it is heightened (0.75 -> 0.80 aspect)
 * because lateral room is the axis dodging actually uses, and because the stage
 * is height-limited on screen — a wider field is physically larger in the
 * window as well as in simulation units, which puts the horizontal space a
 * 1440px window was wasting to work.
 *
 * Everything downstream reads `world.width`/`world.height`; only the two canvas
 * elements and the CSS aspect-ratio carry the numbers separately.
 */
/*
 * DELIBERATELY UNCHANGED BY THE ARENA CONVERSION, and this is the wrong shape.
 *
 * A survivor arena wants to be square or landscape; 900x1120 is a shmup's
 * aspect ratio and it means the ring the enemies arrive on is 25% further away
 * north and south than east and west. The conversion works anyway — `edgePoint`
 * spawns against the rectangle so the geometry is correct, it is just not
 * symmetric — but a squarer field would be better and 1000x1000 is the
 * recommendation.
 *
 * It is not changed here because the number lives in three places and only one
 * of them is in this file: `src/style.css` carries a hardcoded
 * `aspect-ratio: 900 / 1120` and the two canvas elements in `index.html` carry
 * their own copies, and both belong to another workstream. Moving the field
 * without moving those makes the simulation and the viewport disagree, and the
 * last time this constant moved it silently broke `tools/contrast.mjs`
 * completely — that tool kept its own copy and then reported a total
 * readability failure that was entirely its own.
 */
export const PLAYFIELD_W = 900;
export const PLAYFIELD_H = 1120;

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

const MAX_ENEMY_BULLETS = 3000;
const MAX_PLAYER_BULLETS = 400;

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
  /** Field only: inward pull on enemies, px/s at the rim. */
  pull: number;
  /** Field only: swallow enemy bullets, converting each into a shard. */
  swallows: boolean;
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
}

export class World {
  readonly width = PLAYFIELD_W;
  readonly height = PLAYFIELD_H;

  readonly bus = new EventBus();
  readonly transport = new Transport();
  readonly rng: Rng;

  readonly player = new Player();
  readonly enemyBullets = new BulletPool(MAX_ENEMY_BULLETS);
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
  private waveHasShooter = false;

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
     * Whether the expanding edge deletes enemy bullets.
     *
     * True for an aura, because NOVA's blurb sells exactly that — "a ring on
     * the beat that clears bullets". False for a `strike`, which reuses this
     * array as a VISUAL only: CHIME has never cleared bullets and nothing in
     * its table says it should, so letting it inherit the behaviour by sharing
     * a container would be a buff smuggled in by an implementation detail.
     */
    clears: boolean;
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
  /** Bullet-speed multiplier at campPressure = 1. */
  static readonly CAMP_BULLET_BOOST = 0.5;
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
    this.enemyBullets.clear();
    this.playerBullets.clear();
    this.particles.clear();
    // The middle of the arena, not the bottom of the screen. There is no
    // "behind you" any more, so there is no safe edge to start against.
    this.player.reset(this.width / 2, this.height / 2);
    this.camera.reset();
    this.shocks.length = 0;
    this.novas.length = 0;
    this.notes.length = 0;
    this.wells.length = 0;
    this.effects.length = 0;
    for (const k of Object.keys(this.instrumentTimers)) delete this.instrumentTimers[k];
    // In place, never reassigned: see the field's comment, and the
    // `everypowerup` entry in tools/README.md for the bug that taught us.
    prog.resetProgression(this.progression, this.rng.next() * 0xffffffff, this.starter);
    this.mods = prog.modifiers(this.progression);
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
    this.phaseTimer = 4 * BEATS_PER_BAR * (60 / 128);
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
    this.waveHasShooter = false;
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
      width: this.width,
      height: this.height,
      difficulty: this.plan.difficulty,
      beat: this.warpedBeat,
    };
  }

  // -------------------------------------------------------------------------
  // main step
  // -------------------------------------------------------------------------

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
    },
  ): void {
    if (this.frozen) return;

    // Hitstop freezes the simulation but never the transport: the music must
    // keep time through an explosion or the whole illusion falls apart.
    this.transport.advance(dt);
    this.camera.update(dt);
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
     * fermata. `openOffer` is idempotent, so calling it on every bar line while
     * one is already open costs nothing.
     */
    if (this.phase !== 'over' && this.transport.crossedBar()) this.openOfferNow();
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
        for (const e of this.enemies) for (const em of e.emitters) em.delayBy(heldBeats);
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
      if (input.well && this.player.wells > 0) {
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
     * TIMEWARP is a rig modifier now, not a powerup, and it still has to scale
     * all three of bullet travel, fire rate and enemy movement. Scaling only
     * bullet travel (as this once did) left emitters dumping at full rate into
     * a slowed field, so the screen filled up faster than before — the
     * defensive item was actively making things worse.
     */
    const warp = this.mods.enemyTime;
    // Camping only ever speeds bullets up, never the emitters that schedule
    // them or the enemies that carry them — both of those are locked to the
    // beat grid TIMEWARP already has to protect, and stretching that grid for
    // an unrelated reason is exactly the kind of two-hands-tightening-at-once
    // this file's own TIMEWARP comment warns about.
    const bulletScale = warp * (1 + campPressure * World.CAMP_BULLET_BOOST);
    const fireScale = warp;
    const moveScale = warp;

    // Emitters are driven by the transport's absolute position, warped by
    // timewarp rather than rescaled per-step, so they can never drift off it.
    this.warpedBeat += (this.transport.beat - this.lastBeat) * fireScale;
    this.lastBeat = this.transport.beat;
    this.updateEnemies(simDt, this.warpedBeat, moveScale);
    this.updateWave(simDt);
    this.enemyBullets.update(simDt * bulletScale, -60, -60, this.width + 60, this.height + 60);
    /*
     * Player bullets are culled on all four edges by the same margin now.
     *
     * It used to be `-40, -80, +40, +40` — a deeper margin at the top, because
     * that was the only direction the ship fired and shots needed room to reach
     * an enemy that had not finished entering. Firing in the round makes the
     * asymmetry meaningless, and leaving it in would make shots aimed north
     * outrange shots aimed south by 40px.
     */
    /*
     * The player pool gets a wall rectangle; the enemy pool above does not.
     *
     * This is what makes `InstrumentStats.bounces` a behaviour instead of a
     * number in a table. It was declared, folded through `applyModifiers`, set
     * by ECHO CHAMBER and raised three times across its ladder, set by SPICCATO
     * and CANON — and read by nothing at all, so "bolts that come back off the
     * walls" was a blurb describing a shot that left the arena and was culled.
     *
     * The rectangle is the arena itself and not the cull bounds passed
     * alongside it: a bounce has to land on the wall the player can see. See
     * `BulletPool.update` for why the reflection is done in angle space.
     */
    this.playerBullets.update(simDt, -60, -60, this.width + 60, this.height + 60, {
      l: 0,
      t: 0,
      r: this.width,
      b: this.height,
    });
    // The threat picture the aim and the music both read. Computed before
    // firing so a shot is aimed at where things are this step, not last step.
    this.analyseEncirclement();
    this.computeAim();
    if (this.phase !== 'over' && !this.player.dead) this.fireInstruments(simDt);
    if (this.mods.homing > 0) this.steerPlayerBullets(simDt);
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
    this.updateNova(simDt);
    this.updateNotes(simDt);
    this.particles.update(simDt);
    this.collidePlayerBullets();
    this.collidePlayer(simDt);
    this.collideEnemies();
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
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.prevX = e.x;
      e.prevY = e.y;
      e.age += dt;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.invuln > 0) e.invuln -= dt;
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

      if (e.phasePending && this.transport.crossedBar()) {
        const phase = commitBossPhase(e);
        if (phase >= 0) {
          this.bus.emit('boss:phase', { phase, of: e.phases });
          this.camera.shake(0.7);
          this.camera.freeze(0.12);
          this.camera.strike(e.hue, 0.7);
          this.cancelBullets();
          // A bar to breathe, and to hear the music turn over.
          e.invuln = 1.4;
          this.shock(e.x, e.y, 480, 3800);
          this.announce(`PHASE ${['I', 'II', 'III'][phase] ?? phase + 1}`, '', 'phase');
        }
      }

      if (e.age > e.leaveAt && !e.leaving) {
        e.leaving = true;
        /*
         * Leave by the nearest edge, not by the bottom.
         *
         * The old retreat flew +y at 190px/s, which in the round is "walk
         * across the player and out the far side" for anything that came from
         * the south. Heading radially outward from the arena centre is the same
         * gesture — give up and go — expressed in a frame where the shape is
         * not guaranteed to be north of anybody.
         */
        const ax = e.x - this.width / 2;
        const ay = e.y - this.height / 2;
        const al = Math.hypot(ax, ay) || 1;
        e.vx = (ax / al) * 190;
        e.vy = (ay / al) * 190;
        e.move = (en, d) => {
          en.x += en.vx * d;
          en.y += en.vy * d;
        };
      }
      e.move(e, dt * moveScale, ctx);

      // Only fire once it has entered, and never while retreating.
      if (!e.leaving && this.hasEntered(e)) {
        /*
         * Snap the first volley onto the beat grid.
         *
         * Emitters count down in beats, but they only start counting once the
         * enemy has descended into view — which happens at whatever moment its
         * descent takes, not on a beat. Groups were arriving on the downbeat and
         * then firing off-grid anyway; only 49% of volleys landed on a
         * subdivision. Aligning once, on activation, takes that to ~100% and is
         * what makes the windup rings across a whole wave pulse together.
         */
        if (!e.gridAligned) {
          e.gridAligned = true;
          const grid = 0.5;
          for (const em of e.emitters) {
            const due = nowBeat + (em.armed ? em.nextIn(nowBeat) : em.firstOffset());
            const drift = (grid - (due % grid)) % grid;
            if (drift > 0.001) em.delayBy(drift);
          }
        }
        for (const em of e.emitters) {
          const before = em.volleyCount;
          em.update(nowBeat, this.transport.bpm, this.enemyBullets, this.rng, e.x, e.y, this.player.x, this.player.y, dt);
          // Every shot is a note. Volleys are already locked to the beat grid,
          // so these land musically without any extra quantisation.
          if (em.volleyCount > before) {
            this.volleysThisStep++;
            this.bus.emit('enemy:fire', { archetype: e.archetype, x: e.x / this.width });
          }
        }
      }

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
       */
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
   * Fields: the `field` instrument shape, live on the arena.
   *
   * One routine covers both kinds because the difference between them is two
   * numbers rather than two behaviours — a BLACK HOLE has `pull` and
   * `swallows`, a TREMOLO FIELD has neither and a longer life. Both burn what
   * stands in them.
   */
  private updateWells(dt: number): void {
    const b = this.enemyBullets;
    for (let w = this.wells.length - 1; w >= 0; w--) {
      const well = this.wells[w];
      well.age += dt;

      // Grows, holds, then collapses.
      const t = well.age / well.life;
      const radius = well.radius * Math.sin(Math.min(1, t) * Math.PI) + 40;
      if (well.pull > 0) this.shock(well.x, well.y, radius * 1.4, -1200 * dt * 60 * 0.016);

      if (well.swallows) {
        for (let i = b.count - 1; i >= 0; i--) {
          if (b.flags[i] & BulletFlag.Indestructible) continue;
          const dx = well.x - b.x[i];
          const dy = well.y - b.y[i];
          const d2 = dx * dx + dy * dy;
          if (d2 > radius * radius) continue;
          const d = Math.sqrt(d2) || 1;

          if (d < 26) {
            // Swallowed. Every bullet becomes a shard.
            this.spawnShards(b.x[i], b.y[i], { minor: 1, major: 0, rare: 0 });
            this.particles.emit(b.x[i], b.y[i], 0, 0, 0.2, 3, well.hue, ParticleShape.Dot, 4);
            b.remove(i);
            continue;
          }
          // Spiral in: steer toward the centre and accelerate.
          const want = Math.atan2(dy, dx);
          const turn = (1 - d / radius) * 9;
          b.angle[i] += clamp(angleDelta(b.angle[i], want), -turn * dt, turn * dt);
          b.speed[i] += (1 - d / radius) * 320 * dt;
        }
      }

      for (const e of this.enemies) {
        const dx = well.x - e.x;
        const dy = well.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d > radius + e.radius || d < 1) continue;
        if (well.dps > 0 && e.invuln <= 0) {
          e.hp -= well.dps * dt;
          e.hitFlash = Math.max(e.hitFlash, 0.04);
          if (e.hp <= 0) e.alive = false;
        }
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
          this.cancelBulletsNear(well.x, well.y, well.radius * 1.4);
        }
      }
    }
  }

  /** Cancel bullets inside a radius, converting each to a note. */
  private cancelBulletsNear(x: number, y: number, radius: number): void {
    const b = this.enemyBullets;
    const r2 = radius * radius;
    for (let i = b.count - 1; i >= 0; i--) {
      if (b.flags[i] & BulletFlag.Indestructible) continue;
      if (dist2(b.x[i], b.y[i], x, y) > r2) continue;
      this.spawnShards(b.x[i], b.y[i], { minor: 1, major: 0, rare: 0 });
      b.remove(i);
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
    const b = this.enemyBullets;
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
      // Annulus test: only bullets the expanding edge actually sweeps. Skipped
      // entirely for a ring that does not clear — see `clears`.
      const inner = Math.max(0, ring.r - 13);
      const outer = ring.r + 13;
      for (let i = ring.clears ? b.count - 1 : -1; i >= 0; i--) {
        if (b.flags[i] & BulletFlag.Indestructible) continue;
        const d2 = dist2(b.x[i], b.y[i], ring.x, ring.y);
        if (d2 < inner * inner || d2 > outer * outer) continue;
        this.particles.emit(b.x[i], b.y[i], 0, -30, 0.25, 2.5, ring.hue, ParticleShape.Dot, 1.5);
        this.score += 10;
        b.remove(i);
      }
      for (const e of this.enemies) {
        if (e.invuln > 0) continue;
        const d = Math.hypot(e.x - ring.x, e.y - ring.y);
        if (Math.abs(d - ring.r) > 16 + e.radius) continue;
        e.hp -= ring.dps * dt;
        e.hitFlash = 0.05;
        if (e.hp <= 0) e.alive = false;
      }
    }
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
      if (fx.dps <= 0) continue;

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
        e.hp -= fx.dps * dt;
        e.hitFlash = Math.max(e.hitFlash, 0.05);
        if (e.hp <= 0) e.alive = false;
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

      if (n.age > 0.28 && d2 < pullSq && !this.player.dead) {
        const d = Math.sqrt(d2) || 1;
        const pull = magnet ? 2600 : 1500;
        n.vx += (dx / d) * pull * dt;
        n.vy += (dy / d) * pull * dt;
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
        n.alive = false;
      }
      if (n.age > 11) n.alive = false;
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
        this.notes.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, alive: true, tier });
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
        const gap = next && this.enemies.length < this.targetOnScreen() ? next.atBeat - beatsIn : 0;
        if (gap > BEATS_PER_BAR + 1) {
          this.waveBeatBias += Math.floor((gap - 1) / BEATS_PER_BAR) * BEATS_PER_BAR;
        }
        while (this.entryCursor < this.plan.entries.length && this.plan.entries[this.entryCursor].atBeat <= beatsIn) {
          this.spawnGroup(this.plan.entries[this.entryCursor]);
          this.entryCursor++;
        }
        const done = this.entryCursor >= this.plan.entries.length;
        if (done && this.enemies.length === 0) {
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
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          // Alternate boss variants so the fourth boss is a different problem
          // from the first, not the same one with more health.
          const variant = Math.floor(this.waveIndex / BOSS_EVERY);
          const boss = spawnBoss(this.width / 2, -120, this.plan.difficulty, this.width, variant);
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
    const scale = 1 + this.plan.difficulty * 2.6 + Math.min(10, this.plan.escalation) * 1.4;
    e.hp = e.maxHp = Math.max(1, Math.round(e.maxHp * scale));
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
    if (urgency < 1) for (const em of e.emitters) em.setUrgency(urgency);
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
    if (this.plan.isBoss) return 0;
    // Same 2.5 -> 10 fix as `scaleForEnsemble` (this one's old bound was 2, an
    // even earlier wall — wave 30).
    return Math.round(4 + this.plan.difficulty * 5 + Math.min(10, this.plan.escalation) * 1.5);
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
    const positions = arenaSpawnPositions(
      entry.formation,
      entry.count,
      this.width,
      this.height,
      bearing,
      SPAWN_MARGIN,
    );
    /*
     * `homeY` was an absolute screen height; it is now read as a STANDOFF from
     * the player. The generator produces 120-280, which as a radius is exactly
     * the right band — 120 is in your face and 280 is most of the short axis of
     * the field away — so the numbers carry across without retuning. That is
     * luck rather than design and it is worth saying so: if `planWave` ever
     * changes that range, this is the line that quietly reinterprets it.
     */
    const standoff = entry.homeY;
    let armedChanceNow = armedChance(this.plan.difficulty);

    /*
     * `elite` sends one enemy instead of a group. `hush` disarms the wave and
     * pays for it in speed, so a silent stage is not a free one. `flank` brings
     * them in from the edges rather than the top, which the formation helper
     * cannot express on its own.
     */
    if (this.movement === 'elite') positions.length = 1;
    if (this.movement === 'hush') armedChanceNow = 0;
    positions.forEach((p, i) => {
      // At least one enemy per group is armed once past the opening waves, so a
      // group never feels completely inert.
      // One armed enemy per group from the very first wave, so every group
      // poses at least one question. `rush` is exempt: it has no weapons.
      /*
       * The guarantee is waived on a hushed wave.
       *
       * Setting `armedChance` to zero was not enough: this flag arms the first
       * enemy of every group regardless, so a HUSHED wave measured 50% armed —
       * the movement's one rule quietly overridden by a rule written for
       * ordinary waves. The same override is why a low `armedChance` never
       * produced as few shooters as it claimed.
       */
      /*
       * One guaranteed shooter per WAVE, not per group.
       *
       * Per-group was written when armedChance was high and the guarantee only
       * mattered in the opening waves. With shooters deliberately rare — 25% of
       * enemies, which is what was asked for — it became the dominant source of
       * armed enemies in every group, which is why a low armedChance never
       * produced as few shooters as it claimed.
       *
       * Removing it entirely is worse, though: measured, waves now arrive with
       * 0.8 bullets on screen against 2.3 enemies, and a wave where nothing
       * shoots is not tension, it is a lull. One per wave keeps every wave
       * asking a question while leaving the overall fraction low, which is the
       * actual ask — fewer, more meaningful bullets rather than none.
       */
      const needsFirstShooter = this.movement !== 'hush' && !this.waveHasShooter && entry.archetype !== 'rush';
      const guaranteed = needsFirstShooter && i === 0;
      const armed = this.rng.next() < armedChanceNow || guaranteed;
      if (armed) this.waveHasShooter = true;
      // Alternate which way round the player each one circles, so a group
      // opens out rather than winding into a single rotating clump.
      const e = spawnEnemy(
        entry.archetype,
        p.x,
        p.y,
        this.plan.difficulty,
        standoff,
        armed,
        i % 2 === 0 ? 1 : -1,
      );
      this.scaleForEnsemble(e);
      if (this.movement === 'elite') {
        // One enemy carrying the whole group's health, worth the whole group's
        // score. A wave you clear by concentrating rather than by sweeping.
        e.hp = e.maxHp = Math.round(e.maxHp * Math.max(2, entry.count * 0.8));
        e.score = Math.round(e.score * 3);
        e.radius = Math.round(e.radius * 1.35);
      }
      if (this.movement === 'hush') {
        // Enemies carry no single speed field — movement lives in each
        // archetype's mover — so a hush wave pays for its silence by pressing
        // 90px closer, which costs the player reaction distance instead. In the
        // vertical game that was "arrives lower"; on a ring it is the standoff,
        // which is the same statement and now true from every direction.
        e.standoff = Math.max(60, e.standoff - 90);
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
          const opposite = arenaSpawnPositions(
            entry.formation,
            entry.count,
            this.width,
            this.height,
            bearing + Math.PI,
            SPAWN_MARGIN,
          )[i];
          e.x = e.prevX = e.homeX = opposite.x;
          e.y = e.prevY = e.homeY = opposite.y;
        }
      }
      // A rhythm formation fires left to right, one sixteenth apart, so the row
      // of enemies performs its own bar.
      if (entry.formation === 'rhythm') {
        for (const em of e.emitters) em.delayBy((i % positions.length) * 0.25);
      }
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
    this.camera.shake(big ? 0.55 : 0.12);
    if (big) this.camera.freeze(0.06);
    this.shock(e.x, e.y, big ? 260 : 130, big ? 2600 : 900);

    // Big enemies scatter a farewell ring; it is the same "denser as it gets
    // worse" idea the music runs on, expressed in bullets.
    if (e.archetype === 'subdrop') burstOnce(this.enemyBullets, e.x, e.y, 18, 150, this.rng.range(0, TAU));

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
        // `e.standoff`, not `e.homeY`: the fifth argument is a standoff radius
        // now and `homeY` is just where the parent happened to be standing.
        const child = spawnEnemy(
          'echo',
          e.x + (i === 0 ? -22 : 22),
          e.y,
          this.plan.difficulty,
          e.standoff,
          e.armed,
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
        e.hp -= pb.damage[i];
        e.hitFlash = 0.07;
        this.particles.emit(pb.x[i], pb.y[i], 0, -60, 0.16, 3, e.hue, ParticleShape.Dot, 3);
        this.bus.emit('enemy:hit', { archetype: e.archetype, lethal: e.hp <= 0 });


        if (e.hp <= 0) e.alive = false;
        // Piercing shots keep going; everything else is consumed.
        if (pb.type[i] !== 1) {
          pb.remove(i);
          break;
        }
      }
    }
  }

  /**
   * Player collision *and* threat analysis in one pass.
   *
   * `timeToImpact` is the earliest closest-approach time among bullets that are
   * actually converging on the player. It is a far better predictor of felt
   * danger than raw proximity: a wall of bullets moving away is not scary, and
   * the music should not pretend it is.
   */
  private collidePlayer(dt: number): void {
    const b = this.enemyBullets;
    const px = this.player.x;
    const py = this.player.y;
    const hit = PLAYER_HITBOX;

    let near = 0;
    let veryNear = 0;
    let soonest = Infinity;
    // Grazes this step, so the flash is one ring rather than one per bullet.
    let grazedThisStep = 0;

    const scanSq = SCAN_RADIUS * SCAN_RADIUS;
    const dangerSq = DANGER_RADIUS * DANGER_RADIUS;
    const panicSq = PANIC_RADIUS * PANIC_RADIUS;
    const grazeRadius = this.player.grazeRadius();
    const grazeSq = grazeRadius * grazeRadius;

    for (let i = b.count - 1; i >= 0; i--) {
      const dx = b.x[i] - px;
      const dy = b.y[i] - py;
      const d2 = dx * dx + dy * dy;
      if (d2 > scanSq) continue;

      if (d2 < dangerSq) near++;
      if (d2 < panicSq) veryNear++;

      // A live pod eats the bullet first. Two pods is two free mistakes.
      let absorbed = false;
      for (let k = 0; k < this.player.droneAngle.length; k++) {
        if (this.player.droneCooldown[k] > 0) continue;
        const pod = this.player.dronePos(k);
        const pr = b.radius[i] + 9;
        if (dist2(b.x[i], b.y[i], pod.x, pod.y) > pr * pr) continue;
        this.player.absorbWithDrone(k);
        this.particles.burst(this.rng, pod.x, pod.y, 10, 200, 265, 0.35, 3);
        this.score += 40;
        b.remove(i);
        absorbed = true;
        break;
      }
      if (absorbed) continue;

      const rr = b.radius[i] + hit;
      if (d2 < rr * rr) {
        b.remove(i);
        if (this.player.takeHit(this.snapshot.campPressure >= World.CAMP_MERCY_BLOCK)) {
          if (this.player.lastHitAutoBombed) {
            // The hit was refunded for a bomb. Give it the full bomb treatment
            // so it reads as a rescue rather than a missed collision.
            this.autoBombRescue();
            break;
          }
          // `onPlayerHit` clears the whole pool, so this loop's remaining
          // indices are meaningless. The threat numbers below are stale for one
          // frame, which is exactly right: the screen just got emptied.
          this.onPlayerHit();
          break;
        }
        continue;
      }

      if (d2 < grazeSq && !(b.flags[i] & BulletFlag.Grazed) && this.player.invuln <= 0) {
        b.flags[i] |= BulletFlag.Grazed;
        this.player.countGraze();
        this.totals.grazes++;
        grazedThisStep++;
        // Flat 60. This was `powerups.magnet ? 90 : 60` and the 90 was
        // unreachable for the same reason the drop boost above was: `magnet`
        // became a rig item and no path can put it in `player.powerups`. See
        // that comment; measured 0 of 115,200 steps.
        this.score += 60;
        this.particles.emit(b.x[i], b.y[i], -dx * 1.6, -dy * 1.6, 0.22, 2, 190, ParticleShape.Dot, 2);
        this.bus.emit('player:graze', { total: this.player.grazeTotal });
      }

      // Closest approach of a bullet travelling in a straight line, relative to
      // a stationary player. Negative t means it is already past.
      const vx = Math.cos(b.angle[i]) * b.speed[i];
      const vy = Math.sin(b.angle[i]) * b.speed[i];
      const vv = vx * vx + vy * vy;
      if (vv > 1) {
        const t = -(dx * vx + dy * vy) / vv;
        if (t > 0 && t < soonest) {
          const cx = dx + vx * t;
          const cy = dy + vy * t;
          const missSq = cx * cx + cy * cy;
          const threat = b.radius[i] + 18;
          if (missSq < threat * threat) soonest = t;
        }
      }
    }

    /*
     * Graze feedback.
     *
     * Grazing is the highest-skill act in the game — deliberately flying close
     * enough to a bullet to feel it — and its only visual acknowledgement was a
     * two-pixel dot. The ring tightens around the ship as the streak builds, so
     * a good run has a visible halo that a bad one does not.
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

    this.snapshot.bulletsNear = near;
    this.snapshot.bulletsVeryNear = veryNear;
    this.snapshot.timeToImpact = soonest;
    void dt;
  }

  /**
   * Enemies hurt on contact.
   *
   * There was no enemy-versus-player collision anywhere in this game: the ship
   * flew straight through everything, so position carried no risk at all and
   * the `rush` archetype — added specifically to apply pressure through
   * movement rather than bullets — could not touch the player. It has been
   * diving harmlessly through them for twenty iterations.
   *
   * The test is against the enemy's core rather than its full radius, so
   * clipping a wingtip is survivable and flying into the middle of something is
   * not. That matches the danmaku convention the rest of the game follows.
   */
  private collideEnemies(): void {
    if (this.player.dead || this.player.invuln > 0) return;
    const px = this.player.x;
    const py = this.player.y;
    for (const e of this.enemies) {
      /*
       * A vertical-game leftover that protects nothing and is asymmetric.
       *
       * "Not on screen yet" meant "above the top edge" when everything entered
       * from the north; on a ring it skips shapes arriving from one bearing and
       * not from the other three, so an enemy 70px off the south edge can
       * contact and one 70px off the north edge cannot. In practice neither
       * can: the player is clamped to y >= 12 and the largest mob contact
       * radius is 20.9px (subdrop), so an enemy at y < -10 is out of reach by
       * construction. `tools/deadhunt-branches.mjs` re-tests every skipped
       * enemy against the contact radius it would have used and found 0 real
       * contacts skipped in ten runs.
       *
       * Left in as a cheap early-out rather than removed, because it is the
       * only thing keeping off-field arrivals out of the inner loop and the
       * correct arena version of it is `hasEntered(e)`, which is a different
       * change with its own reason to be measured.
       */
      if (e.y < -10) continue;
      const r = e.radius * 0.62 + PLAYER_HITBOX;
      if (dist2(px, py, e.x, e.y) > r * r) continue;
      if (!this.player.takeHit(this.snapshot.campPressure >= World.CAMP_MERCY_BLOCK)) return;
      if (this.player.lastHitAutoBombed) {
        this.autoBombRescue();
        return;
      }
      // A ram costs the enemy too, so a rush is a trade rather than a mugging.
      e.hp -= 8;
      e.hitFlash = 0.12;
      if (e.hp <= 0) e.alive = false;
      this.onPlayerHit();
      return;
    }
  }

  private onPlayerHit(): void {
    this.waveDamage++;
    this.camera.shake(0.85);
    this.camera.freeze(0.09);
    this.camera.strike(0, 0.65);
    this.particles.burst(this.rng, this.player.x, this.player.y, 40, 320, 350, 0.8, 4);
    this.shock(this.player.x, this.player.y, 340, 3400);
    this.cancelBullets();
    this.combo = 0;

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

  /** Turn every cancellable bullet into score, the traditional relief valve. */
  private cancelBullets(): void {
    const b = this.enemyBullets;
    for (let i = b.count - 1; i >= 0; i--) {
      if (b.flags[i] & BulletFlag.Indestructible) continue;
      if (!(b.flags[i] & BulletFlag.Cancellable)) continue;
      this.particles.emit(b.x[i], b.y[i], 0, -40, 0.3, 2.5, 50, ParticleShape.Dot, 1.5);
      this.score += 10;
      b.remove(i);
    }
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
    this.cancelBullets();
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
    this.enemyBullets.clear();
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
    this.cancelBullets();
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
      updateDrop(d, dt, this.height, this.player.x, this.player.y, magnetY, pullScale);
      const r = PICKUP_RADIUS * this.mods.pickupRadius + 8;
      if (dist2(d.x, d.y, this.player.x, this.player.y) < r * r) {
        const def = powerupDef(d.kind);
        const level = this.player.addPowerup(d.kind, def.duration);
        if (d.kind === 'bomb') this.player.bombs = Math.min(5, this.player.bombs + 1);
        if (d.kind === 'encore') {
          this.player.hp = this.player.maxHp;
          this.player.bombs = Math.min(5, this.player.bombs + 1);
          this.player.invuln = Math.max(this.player.invuln, 3);
          this.cancelBullets();
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
  private openOfferNow(): void {
    // Space out a burst. See `OFFER_MIN_GAP`.
    if (this.time - this.lastOfferClosed < OFFER_MIN_GAP) return;
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
    if (input.reroll) {
      const next = prog.rerollOffer(this.progression);
      if (next) this.emitOffer(next);
      return;
    }
    if (input.banish !== undefined && input.banish >= 0) {
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
  // firing: six shapes, one per InstrumentShape
  // -------------------------------------------------------------------------

  /**
   * Run every held instrument's clock and dispatch the ones that came due.
   *
   * Six routines and not twenty-six: every instrument in `weapons.ts` is one of
   * six shapes, which is the entire reason that field exists. A table of
   * twenty-six bespoke weapons is a table nobody can balance and a dispatch
   * nobody can read.
   */
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
     * because `held` is in acquisition order and index 0 is always PIZZICATO:
     * every run starts holding it, and at 0.22s falling to 0.062 under RAPID it
     * fires four to ten times more often than anything else in the ensemble. So
     * a first-wins tiebreak resolves every collision in favour of the sound the
     * player has already heard a thousand times, and it does it most reliably at
     * the exact moment it matters least.
     *
     * Rarest-wins costs the frequent voice nothing — PIZZICATO gets another
     * chance in a fifth of a second — and it protects the voices that only
     * speak every few seconds, where losing one appearance costs a third of the
     * instrument's presence in the mix. It is the same reason an arranger does
     * not let the hi-hat mask the timpani: the event that happens least is the
     * event carrying information.
     *
     * It also fixes a systematic case rather than only a statistical one. A
     * newly recruited instrument has its timer set to 0 so it sounds
     * immediately, which means acquisition is the one moment a collision is
     * *likely* — and under first-wins the new musician would be silenced by the
     * starter gun on the very tick the player recruited them.
     */
    let firedId: InstrumentId | null = null;
    let firedInterval = -1;
    for (const { id, level } of held) {
      const def = instrumentDef(id);
      if (!def) continue;
      const s = applyModifiers(instrumentStats(id, level), this.mods);

      if (def.shape === 'orbit') {
        // Pods exist continuously; only their shooting is on a clock.
        this.player.podCount = Math.max(1, Math.round(s.count));
        this.player.podRadius = Math.max(28, s.area);
        /*
         * The pods spin only if the instrument moves at all.
         *
         * This was a hardcoded 1.6 for every orbit instrument, which meant the
         * shape had nowhere to express a stationary satellite — and CHORALE's
         * evolution line is exactly that: "the satellites stop moving and
         * start singing". With its `speed` now explicitly 0 (see `weapons.ts`)
         * the pods hold their compass positions instead of sweeping, and DRONE
         * PODS at speed 1050 is unchanged.
         *
         * A boolean rather than a rate scaled from `speed`, because there is
         * no honest scale to divide by: 1.6 and 1050 are in unrelated units,
         * and inventing a conversion between them would be a made-up number
         * dressed as a derivation.
         */
        this.player.podSpin = s.speed > 0 ? 1.6 : 0;
      }

      const left = (this.instrumentTimers[id] ?? 0) - dt;
      if (left > 0) {
        this.instrumentTimers[id] = left;
        continue;
      }
      /*
       * Floored, so a fully-stacked cooldown reduction cannot ask for a volley
       * every simulation step and saturate the bullet pool in half a second.
       *
       * THE FLOOR ITSELF NEVER BINDS, and the claim above is true for a
       * different reason than it appears to be. The shortest interval any legal
       * loadout can produce is SPICCATO's 0.1 under RAPID at level 5, which is
       * 0.062 — enumerated exhaustively over every instrument, every level and
       * every rig extreme by `tools/deadhunt-ranges.mjs`, which reports the
       * 0.05 as unreachable. What actually keeps the pool safe is that
       * `rigModifiers` has a single cooldown contributor (see its comment) and
       * that a 120Hz step is 0.0083s, so even the fastest instrument fires
       * every seventh step rather than every step.
       *
       * Left as written. It costs nothing and it is the correct guard the day a
       * second cooldown item lands; the note is here so nobody reads 0.05 as a
       * measured lower bound on anything.
       */
      this.instrumentTimers[id] = Math.max(0.05, s.interval);

      switch (def.shape) {
        case 'seek':
          this.fireSeek(s);
          break;
        case 'arc':
          this.fireArc(id, s);
          break;
        case 'beam':
          this.fireBeam(id, s);
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
      }
      fired = true;
      // The rarest thing that fired this tick gets the voice; see above.
      // `held` is the player's instrument list, so this id is an `InstrumentId`
      // by construction; the loop simply types it as a bare string.
      if (s.interval > firedInterval) {
        firedInterval = s.interval;
        firedId = id as InstrumentId;
      }
    }
    // Nothing holds an orbit instrument: retire the pods rather than leaving
    // the last set circling forever after a fusion consumed DRONE PODS.
    if (!held.some(({ id }) => instrumentDef(id)?.shape === 'orbit')) this.player.podCount = 0;
    if (fired) this.bus.emit('player:shoot', { id: firedId ?? undefined });
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
      this.playerBullets.spawn({
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
        flags: BulletFlag.DespawnOffscreen,
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
        this.playerBullets.spawn({
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
          flags: BulletFlag.DespawnOffscreen,
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
        pull: 0,
        swallows: false,
      });
    }
    this.camera.shake(0.05);
  }

  /** A held beam along the aim. Damages for as long as it is drawn. */
  private fireBeam(id: string, s: InstrumentStats): void {
    const p = this.player;
    const beams = Math.max(1, Math.round(s.count));
    const life = Math.max(0.12, s.linger);
    for (let i = 0; i < beams; i++) {
      this.effects.push({
        kind: 'beam',
        id,
        x: p.x,
        y: p.y,
        angle: p.aim + (i / beams) * TAU,
        radius: Math.max(4, s.area),
        length: Math.max(120, s.range),
        arc: 0,
        // `damage` is per hit and a beam hits continuously, so it is spent
        // across the stroke. A beam that applied `damage` every frame would be
        // sixty times its stat block and would trivialise the game instantly.
        dps: s.damage / life,
        life,
        age: 0,
        hue: this.hueOf(id),
        attached: true,
        pull: 0,
        swallows: false,
      });
    }
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
      this.playerBullets.spawn({
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
        flags: BulletFlag.DespawnOffscreen,
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
        clears: true,
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

      for (const e of this.enemies) {
        if (!e.alive || e.invuln > 0) continue;
        const rr = radius + e.radius;
        if (dist2(e.x, e.y, x, y) > rr * rr) continue;
        e.hp -= s.damage;
        e.hitFlash = Math.max(e.hitFlash, 0.07);
        if (e.hp <= 0) e.alive = false;
      }

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
        clears: false,
      });
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

  /** BLACK HOLE and its evolution eat bullets; the other fields only burn. */
  private fieldSwallows(id: string): boolean {
    return id === 'blackhole' || id === 'downbeat';
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

  /** True once an enemy has crossed into the field and may start firing. */
  private hasEntered(e: Enemy): boolean {
    return e.x > -30 && e.x < this.width + 30 && e.y > -30 && e.y < this.height + 30;
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

    s.bulletCount = this.enemyBullets.count;
    // bulletsNear / bulletsVeryNear / timeToImpact are written by collidePlayer.

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
