/**
 * Enemy archetypes.
 *
 * Each archetype is a movement function plus a set of declarative emitters.
 * They are also the units the music director thinks in: every archetype has a
 * motif in `audio/layers.ts`, so the composition of a wave is audible before
 * you have finished reading the screen.
 */

import type { EnemyArchetype } from '../core/events';
import { clamp } from '../core/math';
import { Emitter, type EmitterSpec } from './emitters';
import { VIEW_H, VIEW_W } from './field';

export interface EnemyContext {
  playerX: number;
  playerY: number;
  /**
   * The FIELD, not the view, and nothing reads them.
   *
   * `bossMove` was the last consumer and now orbits an anchor captured at
   * spawn instead. They are kept because `EnemyContext` is the published shape
   * a mover receives and a mover that wants the arena bounds has nowhere else
   * to get them — but per AGENTS.md §3 an unread field is exactly the kind of
   * thing that rots, so: if you are reading this and still nothing consumes
   * them, delete them. Anything wanting "how big is the screen" should import
   * `VIEW_W`/`VIEW_H` directly, as `bossMove` does.
   */
  width: number;
  height: number;
  /** Transport position in beats, so movement can step in time. */
  beat: number;
  /** Wave difficulty, roughly 0..1 over a long run. */
  difficulty: number;
}

export type MoveFn = (e: Enemy, dt: number, ctx: EnemyContext) => void;

export interface Enemy {
  id: number;
  archetype: EnemyArchetype;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  age: number;
  /** Seconds of white-flash remaining after being shot. */
  hitFlash: number;
  /**
   * Seconds of invulnerability, used at boss phase transitions.
   *
   * Structure the fight rather than inflating its HP: however much damage a
   * loaded-out player can deal, they still have to live through two transitions,
   * so the boss always has three acts instead of evaporating in one burst.
   */
  invuln: number;
  emitters: Emitter[];
  move: MoveFn;
  homeX: number;
  homeY: number;
  /**
   * Preferred distance from the PLAYER, in px. The arena's replacement for
   * `homeY`.
   *
   * In the vertical game an enemy's station was an absolute screen height,
   * because there was only one direction anything could come from and "how far
   * down has it got" was the same question as "how close is it". On a ring that
   * is meaningless: an enemy at y=200 is on top of a player at y=240 and a
   * screen away from one at y=900. A standoff radius is the same intent
   * expressed in the only frame that survives the conversion.
   *
   * A shape with standoff 0 closes all the way and rams. Everything else holds
   * a ring at this distance and works the tangent.
   */
  standoff: number;
  /** +1 or -1: which way round the player this shape circles. */
  orbitDir: number;
  score: number;
  /** 0..1 chance to drop a powerup on death. */
  dropChance: number;
  alive: boolean;
  /** Boss only. */
  phase: number;
  /** HP threshold crossed, waiting for a musical boundary to switch. */
  phasePending: boolean;
  phases: number;
  phaseThresholds: number[];
  /** Boss only: emitter sets per phase. */
  phaseEmitters: EmitterSpec[][];
  hue: number;
  /** Leaves the playfield without being killed; no score, no music credit. */
  escaped: boolean;
  /**
   * Age at which a stationary enemy gives up and flies away.
   *
   * Turrets and bruisers hold position, so without this they accumulate wave
   * after wave until twenty of them are firing at once — which reads as unfair
   * rather than difficult, because no amount of skill clears a screen that only
   * ever grows.
   */
  leaveAt: number;
  /** True once it has turned to leave; stops it firing on the way out. */
  leaving: boolean;
  /** False for the unarmed escorts that make early waves readable. */
  armed: boolean;
  /** Set once its first volley has been snapped onto the beat grid. */
  gridAligned: boolean;
  /** Beat-stepped movement state: last subdivision index and hop endpoints. */
  stepIndex: number;
  hopFromX: number;
  hopFromY: number;
  hopToX: number;
  hopToY: number;
  /** How many children to spawn on death, and how deep we already are. */
  splits: number;
  generation: number;

  /* ---------------------------------------------------------------------- *
   * STATUS — what the player's properties have left on this body.
   *
   * `docs/plan-refactor-3.md` §9a: Ball x Pit's base balls are composable
   * PROPERTIES, and a property is only a property if the target REMEMBERS it.
   * These fourteen numbers are that memory, and `weapons.ts`' `Props` is what
   * writes them.
   *
   * FOURTEEN PLAIN NUMBERS ON A PLAIN OBJECT, and both halves of that were
   * chosen against the alternatives. A per-enemy `Map` or a status array would
   * allocate on every application, at up to a few hundred applications a
   * second; a parallel structure-of-arrays keyed by enemy index would have to
   * be shuffled on every swap-remove and every split. Enemies are already
   * plain objects in a plain array of tens, not thousands — `BulletPool` is
   * where the typed arrays are because bullets are the thing there are
   * hundreds of.
   *
   * `status` IS THE WHOLE PERFORMANCE STORY. It is a bitmask of which of the
   * seven statuses are live, so the per-step tick is one integer test per
   * enemy for the overwhelming majority of enemies that carry nothing. The
   * measured ceiling before this pass was 56 fps at 39 enemies and the arena
   * has since grown; a tick that walked fourteen floats per enemy per step at
   * 120 Hz would be a real cost, and a tick that reads one int is not.
   * ---------------------------------------------------------------------- */
  /** Bitmask of live statuses; see `Status` in `world.ts`. 0 means skip. */
  status: number;
  /** Burn stacks held, and how long until they all lapse. */
  burnStacks: number;
  burnTime: number;
  /** Damage per second per burn stack, from whatever applied it last. */
  burnDps: number;
  poisonStacks: number;
  poisonTime: number;
  poisonDps: number;
  /**
   * Bleed stacks held, and how long until they clot.
   *
   * Bleed is the one status that costs nothing per second: `bleedDmg` per
   * stack is paid at the moment the target is HIT again, which is why it
   * belongs to the fastest weapon in the roster and not the slowest.
   */
  bleedStacks: number;
  bleedTime: number;
  bleedDmg: number;
  /** Seconds held motionless. A frozen body also takes `PROP.freezeVuln` more. */
  freezeTime: number;
  /** Seconds slowed, and the fraction of its speed that is gone. */
  slowTime: number;
  slowFactor: number;
  /** Seconds blinded. A blinded body's volleys and contacts miss half the time. */
  blindTime: number;
  /** Seconds fighting for the player instead of against them. */
  charmTime: number;
  /**
   * Vuln stacks held, how long until they lapse, and the extra damage each
   * one is worth as a fraction.
   *
   * The only status whose whole payoff is paid by SOMETHING ELSE: it removes
   * no hit points on its own clock, it makes every other source hit harder.
   * That is why it is a fusion-tier property — it is worth nothing to a player
   * holding one weapon and a great deal to one holding four.
   */
  vulnStacks: number;
  vulnTime: number;
  vulnPer: number;
}

/**
 * Display names and, more usefully, what each one contributes to the track.
 * The enemy roster and the instrument list are the same list — that is the
 * whole idea — so this table is the legend for both the screen and the mix.
 */
export const ARCHETYPE_INFO: Record<EnemyArchetype, { label: string; motif: string }> = {
  pluck: { label: 'PLUCK', motif: 'offbeat plucked stab' },
  stutter: { label: 'STUTTER', motif: 'sixteenth-note cluster' },
  arpeggiator: { label: 'ARP', motif: 'alternating fifths' },
  glissando: { label: 'GLISS', motif: 'delayed sliding line' },
  subdrop: { label: 'SUBDROP', motif: 'distorted low brass hit' },
  echo: { label: 'ECHO', motif: 'a stab and its delayed repeat' },
  rush: { label: 'RUSH', motif: 'a rising whoosh into each dive' },
  conductor: { label: 'CONDUCTOR', motif: 'tritone pedal under everything' },
};

let nextId = 1;

// ---------------------------------------------------------------------------
// movement
// ---------------------------------------------------------------------------

/*
 * Every mover below was rewritten for the arena, and the rewrite follows one
 * rule: keep the CHARACTER, change the frame.
 *
 * In the vertical game each of these was expressed against the screen — +y is
 * forward, x is the axis you weave on, `homeY` is where you stop. All three of
 * those are properties of a shmup and none of them survives a stage where the
 * enemy can arrive from behind you.
 *
 * The frame every one of them now uses is the vector from the enemy to the
 * PLAYER: `toward` is forward, its perpendicular is the weave axis, and
 * `standoff` is where you stop. A glissando still swings +/-150px across its
 * line of approach; the line of approach is just no longer guaranteed to be
 * straight down. That is what keeps the roster recognisable — the shapes read
 * the same, they simply read the same from every direction.
 */

/** Unit vector from the enemy toward the player, and the distance. */
function toPlayer(e: Enemy, ctx: EnemyContext): { ux: number; uy: number; d: number } {
  const dx = ctx.playerX - e.x;
  const dy = ctx.playerY - e.y;
  const d = Math.hypot(dx, dy) || 1;
  return { ux: dx / d, uy: dy / d, d };
}

/**
 * Close to the standoff ring and hold it, drifting round.
 *
 * The radial term is signed, so a shape pushed inside its ring backs off rather
 * than sitting on top of the player. Without that, a rush that clips a holder
 * leaves it embedded and the player takes contact damage from something that
 * was supposed to be keeping its distance.
 */
function ringHold(e: Enemy, dt: number, ctx: EnemyContext, closeSpeed: number, tangent: number): void {
  const { ux, uy, d } = toPlayer(e, ctx);
  const err = d - e.standoff;
  // Approach at full speed while far out; ease into the ring over the last
  // 60px so the shape settles instead of oscillating across it.
  const radial = clamp(err / 60, -1, 1) * closeSpeed;
  const tx = -uy * e.orbitDir;
  const ty = ux * e.orbitDir;
  e.x += (ux * radial + tx * tangent) * dt;
  e.y += (uy * radial + ty * tangent) * dt;
}

/** Drifts steadily inward. The simplest shape in the game, in the round. */
const driftIn: MoveFn = (e, dt, ctx) => {
  ringHold(e, dt, ctx, e.vy, 26);
};

/** Closes to its ring, then works the tangent in a slow sway. */
const closeAndHold: MoveFn = (e, dt, ctx) => {
  ringHold(e, dt, ctx, e.vy, Math.cos(e.age * 0.85) * 60 * e.orbitDir);
};

/**
 * Hops on every eighth note instead of gliding.
 *
 * Stutters are the hi-hat of the enemy roster, so they move like one: a snap to
 * the next position on each subdivision, with a fast ease so it reads as a hop
 * rather than a teleport. It is the most direct way to make the beat visible in
 * the *movement* layer rather than only in the shooting, and a screen of them
 * stepping together is the clearest signal the game gives that everything here
 * is running off one clock.
 */
const stutterHop: MoveFn = (e, dt, ctx) => {
  const step = Math.floor(ctx.beat * 2);
  if (step !== e.stepIndex) {
    e.stepIndex = step;
    e.hopFromX = e.x;
    e.hopFromY = e.y;
    /*
     * Each hop is half a beat of closing plus a sidestep across the approach.
     *
     * The sidestep is what makes a row of them read as a hi-hat rather than as
     * a queue: they all step on the same subdivision but the phase term is
     * seeded from the spawn position, so the group scatters as it advances
     * instead of arriving in single file.
     */
    const { ux, uy, d } = toPlayer(e, ctx);
    const close = Math.min(e.vy * 0.5, Math.max(0, d - e.standoff));
    const side = Math.sin(step * 0.7 + e.homeX * 0.02) * 46;
    e.hopToX = e.x + ux * close - uy * side;
    e.hopToY = e.y + uy * close + ux * side;
  }
  // Fraction through the current subdivision, eased so most of the travel
  // happens in the first third — that snap is what makes it a hop.
  const frac = Math.min(1, Math.max(0, ctx.beat * 2 - step));
  const eased = 1 - Math.pow(1 - frac, 3);
  e.x = e.hopFromX + (e.hopToX - e.hopFromX) * eased;
  e.y = e.hopFromY + (e.hopToY - e.hopFromY) * eased;
  void dt;
};

/**
 * Closes on a wide sine across its own line of approach.
 *
 * The +/-150px swing is kept exactly: `tools/hitrate.mjs` measured that this
 * weave, and not this shape's hp, is what makes it take five and a half seconds
 * of parked fire to kill, and that hp and evasion multiply. It is the same
 * evasion, now expressed perpendicular to wherever it happens to be coming
 * from. Deliberately not clamped to the field edges any more — a shape that is
 * *behind* the player is legitimately near a wall, and clamping it there pinned
 * every glissando that arrived from the sides into a straight line, which
 * would have quietly deleted the one genuinely evasive archetype in the game.
 */
const weave: MoveFn = (e, dt, ctx) => {
  const { ux, uy, d } = toPlayer(e, ctx);
  const radial = clamp((d - e.standoff) / 60, -1, 1) * e.vy;
  // Derivative of 150*sin(age*1.05): the swing is a velocity, not a position,
  // so it composes with the approach instead of overwriting it.
  const swing = Math.cos(e.age * 1.05) * 150 * 1.05 * e.orbitDir;
  e.x += (ux * radial - uy * swing) * dt;
  e.y += (uy * radial + ux * swing) * dt;
  void ctx;
};

/**
 * Dives at wherever the player was when it committed, then keeps going.
 *
 * Deliberately fires nothing: it is pressure made of movement rather than
 * bullets, which is what a calm game needs to stay engaging without filling the
 * screen. You beat it by not standing still.
 */
const rushDive: MoveFn = (e, dt, ctx) => {
  if (e.age < 1.2) {
    /*
     * Creep and telegraph, so the dive is always readable.
     *
     * The telegraph was the free part in the vertical game — a rush entered at
     * the top of the screen and the player was at the bottom, so there was
     * always most of a screen of warning whatever it did. On a ring it spawns
     * just off the edge and the player might be standing right there, so the
     * warning has to be bought explicitly: 1.2 seconds of visibly slow drift
     * before it commits, and it commits to where the player was at the END of
     * that, not the start.
     */
    const { ux, uy } = toPlayer(e, ctx);
    e.x += ux * 40 * dt;
    e.y += uy * 40 * dt;
    e.homeX = ctx.playerX;
    e.homeY = ctx.playerY;
    return;
  }
  if (e.vx === 0 && e.vy === 0) {
    const a = Math.atan2(e.homeY - e.y, e.homeX - e.x);
    e.vx = Math.cos(a) * 300;
    e.vy = Math.sin(a) * 300;
  }
  e.x += e.vx * dt;
  e.y += e.vy * dt;
};

/** Closes in a lazy S. Splits when killed. */
const echoDrift: MoveFn = (e, dt, ctx) => {
  const { ux, uy, d } = toPlayer(e, ctx);
  const radial = clamp((d - e.standoff) / 60, -1, 1) * e.vy;
  const swing = Math.sin(e.age * 1.2) * 58 * e.orbitDir;
  e.x += (ux * radial - uy * swing) * dt;
  e.y += (uy * radial + ux * swing) * dt;
};

/**
 * Boss: takes the middle of the arena and circles there, faster each phase.
 *
 * The centre rather than a station near the top, because in the round the
 * middle is the only position that is equally a problem from everywhere. A boss
 * parked at one edge would let the player fight it from the opposite side of
 * the field with three quarters of the arena behind them as a retreat, which is
 * the opposite of what a boss is for.
 *
 * "THE MIDDLE" IS AN ANCHOR CAPTURED AT SPAWN, NOT THE MIDDLE OF THE FIELD.
 * This read `ctx.width/2, ctx.height/2` with a radius of
 * `min(ctx.width, ctx.height) * 0.17`, both of which were the screen because
 * the field was the screen. On a 3000px field that is a 510px orbit — one and a
 * half screens across — around a point the player may never go near, so the
 * boss would spend the fight off camera and the set piece would be a health bar
 * with nothing under it. `homeX`/`homeY` hold the arena centre the boss was
 * summoned around (`spawnBoss`), and the radius comes from `VIEW_*`, so the
 * orbit is the same fraction of the SCREEN it has always been.
 *
 * The anchor is fixed for the boss's life rather than tracking the camera:
 * an orbit that followed the view would let the player drag the boss around
 * the arena by walking, which is the "fight it from the far side" failure this
 * comment already argues against, only worse — the boss would never be
 * anywhere the player was not.
 */
const bossMove: MoveFn = (e, dt) => {
  const cx = e.homeX;
  const cy = e.homeY;
  const speed = 0.5 + e.phase * 0.28;
  const r = Math.min(VIEW_W, VIEW_H) * 0.17;
  const tx = cx + Math.cos(e.age * speed) * r;
  const ty = cy + Math.sin(e.age * speed * 1.3) * r * 0.8;
  // Ease in rather than snapping: it arrives from off-field and has to cross.
  const k = Math.min(1, dt * 1.6);
  e.x += (tx - e.x) * k;
  e.y += (ty - e.y) * k;
};

// ---------------------------------------------------------------------------
// archetypes
// ---------------------------------------------------------------------------

interface Spec {
  hp: number;
  radius: number;
  score: number;
  dropChance: number;
  hue: number;
  move: MoveFn;
  emitters(d: number): EmitterSpec[];
}

/*
 * A note on bullet speed, because the intuition is backwards.
 *
 * Slow bullets are not gentler — they are *worse*. A slow shot stays on screen
 * for five seconds, so six enemies firing three shots every two beats put ~80
 * bullets in the air simultaneously and the screen becomes fog with no gaps to
 * read. Fast bullets clear out, so the same fire rate yields a third as many
 * on screen and each one arrives as a discrete, dodgeable event.
 *
 * Everything below therefore fires *faster and less often* than it used to.
 *
 * A note on hp, because these numbers look large against a 3.5-damage bullet.
 *
 * They were far too small. `tools/ttk.mjs` parks one enemy in front of a firing
 * ship and times it: most of the roster died in 0.22s. There is no encounter in
 * a fifth of a second — you sweep and they evaporate — which is why the stage
 * flattened out the moment the player could aim.
 *
 * These numbers target a TIME, not a multiple of the old hp, and the times are
 * per archetype rather than uniform. Measured effective dps against each shape
 * ranges from 4.6 to 32.5 against a player dps of ~23.8, because a small hopping
 * target eats most of a volley in misses while a stationary turret eats all of
 * it. A flat hp target would therefore have produced a four-second stutter and a
 * one-second arpeggiator from the same number.
 *
 * `stutter` sits at 4 because the swarm is a time sink at anything higher. It
 * arrives 4-7 at a time and carries no weapons, so its cost is measured in
 * seconds of the player's fire that are not going anywhere else: 1.4s each at 6
 * is nearly nine seconds to clear one group.
 *
 * It went 5 -> 4 -> 6 -> 4 on the way here, and the round trip is the lesson.
 * ttk read 1.79s and pins its target every 50ms against a sim stepping at
 * 120Hz, so a hopping shape plausibly slips between pins — that story was good
 * enough that `tools/hitrate.mjs` was written to pin nothing, it returned 0.59s
 * on its first run, and the hp went back up on the strength of it. Repeated
 * three times the same tool returns 1.43, 1.43 and 1.47s, and ttk's 1.34s was
 * never far off. ONE RUN OF A NEW TOOL IS NOT A MEASUREMENT, least of all when
 * it agrees with the hypothesis that motivated building it.
 *
 * `glissando` is the shape that hunt did find, and it repeats: 5.79, 5.83 and
 * 5.97 seconds, taking 8% of the ship's output where a stationary target takes
 * all of it. Its +/-150px weave, not its hp, is what costs the time — cutting
 * 14 -> 10 moved 6.16s to 5.83s and nothing more. Left at 10 and the weave left
 * alone: that test parks the ship, real play tracks, and in continuous runs
 * glissando is killed at 22-31% like the rest of the roster. The number to
 * remember is that hp and evasion multiply, so an evasive shape cannot be
 * balanced by hp in either direction.
 *
 * The multiplier is unchanged, so the shape of the curve is too — only the
 * floor moved.
 *
 * Drop chances went up by half with them, and have now been halved again.
 * `killsSinceDrop` counts kills rather than seconds, so both halves of the
 * roster change — fewer bodies, and more hits needed for each — came straight
 * off the drop rate, and 1.5x was the factor that held drops per second still.
 *
 * THAT WAS THE RIGHT ARITHMETIC FOR THE WRONG TARGET. Holding the drop rate
 * still was only correct while a full loadout was the intended resting state,
 * and it is not: with the pity timer at three kills on top of these, a run was
 * never without one, so the cap could never make a pickup a decision and the
 * `power` lane of the arrangement never had a silence to enter from. These are
 * roughly half of what they were, against a pity timer of seven rather than
 * three. The intent is that a player holds one or two most of the time, five
 * only briefly and late, and none often enough that finding one is an event.
 *
 * Powerup uptime is the one number here lumpy enough to hide a regression —
 * this repo has it ranging 19-65% across seven runs of unchanged builds — so
 * read `deadair`'s `noPowerupsHeld` across several runs and not once.
 */
const SPECS: Record<Exclude<EnemyArchetype, 'conductor'>, Spec> = {
  pluck: {
    hp: 12,
    radius: 15,
    score: 100,
    dropChance: 0.15,
    hue: 195,
    move: driftIn,
    emitters: (d) => [
      {
        shape: 'fan',
        count: 2 + Math.floor(d * 3),
        spread: 0.44,
        speed: 245 + d * 85,
        aim: 'player',
        beats: 3,
        delayBeats: 1,
        radius: 5,
        ttl: 7,
        type: 0,
      },
    ],
  },
  stutter: {
    hp: 4,
    radius: 10,
    score: 60,
    dropChance: 0.07,
    hue: 300,
    move: stutterHop,
    /*
     * The swarm does not shoot. It is the hi-hat of the roster, and a hi-hat is
     * texture you move through rather than a firing line.
     *
     * Stutters spawn 4-7 at a time and cross the screen at 299-357 px/s, three
     * times anything else — measured, the fastest thing on the field was also
     * the most numerous and it was throwing aimed shots. That combination is
     * not readable at any density, and it is where most of the wall of fire
     * came from. `armedChance` cannot express this, because it is called
     * without an archetype; declaring no weapons here is how `rush` already
     * says the same thing, and it is the only way to say it about one shape.
     *
     * Note this also overrides `spawnGroup`'s guarantee that the first enemy of
     * every group is armed: a stutter group now poses a movement question
     * instead of a bullet one, exactly as a rush group does. The motif layer
     * reads presence rather than fire, so the sixteenth-note cluster still
     * plays for a silent swarm.
     */
    emitters: () => [],
  },
  arpeggiator: {
    hp: 32,
    radius: 20,
    score: 350,
    dropChance: 0.32,
    hue: 45,
    move: closeAndHold,
    emitters: (d) => [
      {
        shape: 'ring',
        count: 6 + Math.floor(d * 5),
        speed: 195 + d * 70,
        aim: 'fixed',
        // The step is what turns a ring into a spiral; it is also why turrets
        // read as "the rotating one" both visually and, via their motif, aurally.
        step: 0.32,
        beats: 2,
        burst: 3,
        restBeats: 4,
        radius: 5,
        ttl: 7,
        type: 1,
      },
    ],
  },
  glissando: {
    hp: 10,
    radius: 16,
    score: 240,
    dropChance: 0.26,
    hue: 150,
    move: weave,
    emitters: (d) => [
      {
        shape: 'scatter',
        count: 3,
        spread: 1.5,
        speed: 250 + d * 80,
        speedJitter: 45,
        aim: 'player',
        beats: 2.5,
        radius: 4,
        ttl: 6,
        type: 3,
      },
    ],
  },
  echo: {
    hp: 10,
    radius: 17,
    score: 260,
    dropChance: 0.2,
    hue: 265,
    move: echoDrift,
    emitters: (d) => [
      {
        shape: 'fan',
        count: 2,
        spread: 0.5,
        speed: 240 + d * 70,
        aim: 'player',
        beats: 3,
        delayBeats: 2,
        radius: 5,
        ttl: 6,
        type: 0,
      },
    ],
  },
  rush: {
    hp: 12,
    radius: 14,
    score: 180,
    dropChance: 0.14,
    hue: 25,
    move: rushDive,
    // No emitters at all. Its whole threat is the dive.
    emitters: () => [],
  },
  subdrop: {
    hp: 48,
    radius: 28,
    score: 800,
    dropChance: 0.55,
    hue: 8,
    move: closeAndHold,
    emitters: (d) => [
      {
        shape: 'ring',
        count: 8,
        arms: 2,
        speed: 185 + d * 60,
        aim: 'fixed',
        step: -0.19,
        beats: 2,
        burst: 2,
        restBeats: 5,
        radius: 6,
        ttl: 7,
        type: 1,
      },
      {
        shape: 'fan',
        count: 4,
        spread: 0.7,
        speed: 330,
        aim: 'player',
        beats: 5,
        radius: 6,
        ttl: 6,
        type: 0,
      },
    ],
  },
};

function blank(): Enemy {
  return {
    id: 0,
    archetype: 'pluck',
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    hp: 1,
    maxHp: 1,
    radius: 12,
    age: 0,
    hitFlash: 0,
    invuln: 0,
    emitters: [],
    move: driftIn,
    homeX: 0,
    homeY: 0,
    standoff: 240,
    orbitDir: 1,
    score: 0,
    dropChance: 0,
    alive: true,
    phase: 0,
    phasePending: false,
    phases: 1,
    phaseThresholds: [],
    phaseEmitters: [],
    hue: 200,
    escaped: false,
    leaveAt: Infinity,
    leaving: false,
    armed: true,
    gridAligned: false,
    stepIndex: -1,
    hopFromX: 0,
    hopFromY: 0,
    hopToX: 0,
    hopToY: 0,
    splits: 0,
    generation: 0,
    status: 0,
    burnStacks: 0,
    burnTime: 0,
    burnDps: 0,
    poisonStacks: 0,
    poisonTime: 0,
    poisonDps: 0,
    bleedStacks: 0,
    bleedTime: 0,
    bleedDmg: 0,
    freezeTime: 0,
    slowTime: 0,
    slowFactor: 0,
    blindTime: 0,
    charmTime: 0,
    vulnStacks: 0,
    vulnTime: 0,
    vulnPer: 0,
  };
}

/**
 * How likely a spawned enemy is armed at all.
 *
 * Early waves should be about moving and shooting, not dodging: an unarmed
 * enemy is still a threat by collision and still drops notes, so it is not
 * free.
 *
 * Read the second half of the comment below before changing this number. It is
 * not the fraction of enemies that shoot, and it cannot be.
 */
export function armedChance(difficulty: number): number {
  /*
   * 0.16 turned out to mean "entire minutes with no bullets at all" once the
   * unarmed `rush` archetype joined the early pool. Rare should still be
   * something you occasionally have to dodge.
   *
   * The old slope was 0.26 + d * 0.75 against a ceiling of 0.85, and the field
   * it produced was measured rather than guessed at, over two six-minute runs:
   * 67% and 72% of every enemy that spawned fired back, with 21.6 and 24.3
   * bullets on screen against 1.8 and 2.4 enemies. That is a screen made almost
   * entirely of bullets, fired by a handful of shapes that had usually already
   * left — fog rather than a stage, and nothing in it is worth prioritising
   * because everything in it shoots.
   *
   * A quarter of that: 4% at wave 1, 22% from wave 14 on.
   *
   * The ceiling matters less than it used to, because the escalation past wave
   * 14 is now group count rather than armed fraction. The old 0.85 ceiling was
   * chosen so the late game kept some silent shapes to read against; at 0.22
   * that is no longer the scarce thing.
   *
   * WHAT A PLAYER ACTUALLY MEETS IS HIGHER THAN THIS NUMBER, and no value here
   * can lower it past a floor. `World.spawnGroup` arms the first enemy of every
   * non-rush group whatever this returns, so a group of n has at least 1/n
   * armed; solving the measured 70% against the chances that produced it gives
   * an effective n of about 3.3, i.e. a floor near 30%. This function only
   * decides how many *extra* shooters a group gets beyond its one guaranteed
   * one. Getting under that floor needs `spawnGroup` to change, or an archetype
   * to declare no weapons the way `stutter` and `rush` do.
   */
  return Math.min(0.22, 0.04 + difficulty * 0.18);
}

export function spawnEnemy(
  archetype: Exclude<EnemyArchetype, 'conductor'>,
  x: number,
  y: number,
  difficulty: number,
  standoff = 240,
  armed = true,
  orbitDir = 1,
): Enemy {
  const spec = SPECS[archetype];
  const e = blank();
  e.id = nextId++;
  e.archetype = archetype;
  e.x = e.prevX = x;
  e.y = e.prevY = y;
  e.homeX = x;
  e.homeY = y;
  /*
   * `rush` has no standoff: it is the shape whose whole job is to reach you.
   * Everything else holds a ring, and the ring is per-archetype rather than
   * per-wave because how close a shape gets IS its character — a pluck lobbing
   * from 260px away and an arpeggiator working 170px out are different problems
   * even before either of them fires.
   */
  e.standoff = archetype === 'rush' ? 0 : standoff;
  e.orbitDir = orbitDir >= 0 ? 1 : -1;
  e.hp = e.maxHp = Math.round(spec.hp * (1 + difficulty * 0.85));
  e.radius = spec.radius;
  e.score = spec.score;
  e.dropChance = spec.dropChance;
  e.hue = spec.hue;
  e.move = spec.move;
  /*
   * Approach speeds. These were DESCENT rates and are now CLOSING rates, and
   * the numbers are deliberately unchanged.
   *
   * Measured per archetype over two runs, before: stutter 299 and 357 px/s,
   * glissando 176 and 185, rush 170 and 278, echo 96 and 100, pluck 61 and 69,
   * arpeggiator 62 and 63. Judge this per archetype and not by the run mean —
   * the run mean read 136 and 170 on those same two runs, because it is an
   * average over whatever mix of shapes the run happened to spawn, and the mix
   * moves more than the speeds do.
   *
   * Holding them still through the conversion is the point: the arena changes
   * where things come from and it should not silently also change how fast they
   * arrive. If closing speed needs to move it should move as its own decision,
   * measured, rather than as a side effect of a coordinate change.
   */
  e.vy = archetype === 'stutter' ? 84 : archetype === 'pluck' ? 55 : 68;
  e.emitters = armed ? spec.emitters(difficulty).map((s) => new Emitter(s)) : [];
  // `armed` is the caller's intent; an archetype with no weapons overrules it.
  // Without this, a guaranteed-armed stutter or a lucky rush reads as armed to
  // everything downstream and then never fires, which is a lie to the renderer
  // (it draws a windup ring on armed enemies) and to every measuring tool.
  e.armed = armed && e.emitters.length > 0;
  // Echoes split once into two, which is where their name and their motif come
  // from: a statement, then its repeat.
  e.splits = archetype === 'echo' ? 2 : 0;
  e.vy = archetype === 'rush' ? 0 : e.vy;
  if (archetype === 'rush') e.vx = 0;
  /*
   * EVERYTHING gets a deadline now, and this is a real consequence of the
   * conversion rather than a tuning choice.
   *
   * It used to be `closeAndHold ? 17 : Infinity`, and the infinity was safe
   * because a drifting shape left by falling off the bottom of the screen: the
   * field culled it for free. In the round there is no bottom — every mover
   * holds a ring around the player instead of crossing the field — so an
   * unbounded `leaveAt` means the stage only ever accumulates, and a player who
   * cannot clear a group is followed by it for the rest of the run. That is the
   * exact failure the original comment on `leaveAt` warns about, arriving by a
   * new route.
   *
   * `rush` is the one exemption and needs none: it commits, flies through, and
   * is culled by the field margin the way it always was.
   *
   * 18 seconds is a GUESS standing in for a measurement. The old drifting
   * shapes crossed the screen in 10-20s depending on their speed, so this is
   * the same order, but wave duration is now set by this number rather than by
   * closing speed and it should be re-read off `tools/wavelength.mjs`.
   */
  e.leaveAt = archetype === 'rush' ? Infinity : 18;
  return e;
}

// ---------------------------------------------------------------------------
// boss
// ---------------------------------------------------------------------------

/**
 * Attack sets per phase, in two variants that alternate between bosses.
 *
 * Variant 0 is about *rotation* — gapped rings you orbit around. Variant 1 is
 * about *timing* — telegraphed walls you thread between. Two shapes of problem
 * rather than one shape at two speeds, which is what stops the fourth boss
 * feeling like the first one with more HP.
 */
function bossPhaseEmitters(difficulty: number, variant: number): EmitterSpec[][] {
  const d = difficulty;
  if (variant % 2 === 1) return bossVariantB(d);
  return [
    // Phase 1 — one rotating ring with a quarter missing. Nothing else.
    [
      {
        shape: 'ring',
        count: 12,
        gap: 0.3,
        speed: 200 + d * 45,
        aim: 'fixed',
        step: 0.26,
        beats: 1.5,
        radius: 6,
        ttl: 7,
        type: 1,
      },
      { shape: 'fan', count: 3, spread: 0.5, speed: 320, aim: 'player', beats: 6, radius: 6, ttl: 6, type: 0 },
    ],
    // Phase 2 — two counter-rotating gapped rings. The gaps cross, and the
    // crossing point is the answer.
    [
      {
        shape: 'ring',
        count: 12,
        gap: 0.28,
        speed: 215 + d * 45,
        aim: 'fixed',
        step: 0.2,
        beats: 1.5,
        radius: 6,
        ttl: 7,
        type: 1,
      },
      {
        shape: 'ring',
        count: 10,
        gap: 0.34,
        speed: 175,
        aim: 'fixed',
        step: -0.26,
        beats: 2.5,
        radius: 5,
        ttl: 7,
        type: 3,
      },
    ],
    // Phase 3 — a fast gapped ring, plus a telegraphed bloom on the downbeat.
    // Two things, not three: three simultaneous patterns from a centred source
    // is not difficulty, it is noise.
    [
      {
        shape: 'ring',
        count: 14,
        gap: 0.26,
        speed: 245,
        aim: 'fixed',
        step: 0.38,
        turn: 0.22,
        beats: 1.5,
        radius: 6,
        ttl: 7,
        type: 1,
      },
      { shape: 'bloom', count: 16, gap: 0.25, speed: 275, aim: 'fixed', beats: 6, radius: 7, ttl: 7, type: 3 },
    ],
  ];
}

/** The timing-based boss: walls, sweeps and pauses rather than rotation. */
function bossVariantB(d: number): EmitterSpec[][] {
  return [
    // Wide aimed walls with a clear gap, on a slow, readable pulse.
    [
      {
        shape: 'fan',
        count: 9,
        spread: 2.4,
        speed: 230 + d * 40,
        aim: 'player',
        beats: 4,
        radius: 6,
        ttl: 7,
        type: 0,
      },
    ],
    // Alternating side sweeps: the safe lane moves across the screen.
    [
      {
        shape: 'fan',
        count: 7,
        spread: 1.5,
        speed: 260 + d * 45,
        aim: 'fixed',
        angle: Math.PI / 2,
        step: 0.55,
        beats: 1.5,
        radius: 6,
        ttl: 7,
        type: 1,
      },
      { shape: 'aimed', count: 1, speed: 380, aim: 'player', beats: 3, radius: 5, ttl: 6, type: 2 },
    ],
    // Bursts of three, then a rest long enough to reposition and shoot back.
    [
      {
        shape: 'fan',
        count: 11,
        spread: 2.8,
        speed: 250 + d * 50,
        aim: 'player',
        beats: 0.75,
        burst: 3,
        restBeats: 5,
        radius: 6,
        ttl: 7,
        type: 0,
      },
      { shape: 'ring', count: 10, gap: 0.35, speed: 190, aim: 'fixed', step: -0.3, beats: 3, radius: 5, ttl: 7, type: 3 },
    ],
  ];
}

/**
 * `x, y` is where it enters from — off the ring. `anchorX, anchorY` is the
 * point it will orbit, which is the centre of the arena AT THE MOMENT IT IS
 * SUMMONED and is stored in `homeX`/`homeY` for `bossMove` to read.
 *
 * The fourth argument used to be the field width, from which this derived
 * `homeX = width / 2` and `bossMove` separately derived the same centre and its
 * own radius. Two places computing "the middle" from the field is one place too
 * many the day the field stops being the screen; the caller decides now, and
 * `world.ts` passes the camera's centre.
 *
 * `homeY` was `y` — the off-field entry height — and was read by nothing, which
 * is why it could be wrong for the whole life of the boss without showing.
 */
export function spawnBoss(
  x: number,
  y: number,
  difficulty: number,
  anchorX: number,
  anchorY: number,
  variant = 0,
): Enemy {
  const e = blank();
  e.id = nextId++;
  e.archetype = 'conductor';
  e.x = e.prevX = x;
  e.y = e.prevY = y;
  e.homeX = anchorX;
  e.homeY = anchorY;
  e.standoff = 0;
  /*
   * Was 900 * (1 + d*1.1), then 620 * (1 + d*0.7). A boss should be a set
   * piece, not an endurance test.
   *
   * Timed end to end: the wave-8 boss took 88 seconds and the wave-16 boss took
   * 174. The HP pool only grows 33% between them, so almost all of that gap is
   * the player being unable to attack — a late boss arrives with more on screen
   * to dodge, so a smaller share of the fight is spent shooting at it. Scaling
   * HP with difficulty therefore compounds a penalty the game is already
   * applying, which is why the difficulty term comes down rather than the base.
   *
   * 560 -> 430 is COMPENSATION, NOT A DIFFICULTY DECISION, and it is an
   * estimate. The weapon rebuild in player.ts cut a typical two-powerup loadout
   * from about 210 nominal dps to about 48, and boss length is very nearly
   * hp / effective dps, so leaving this alone would have turned a 64-second
   * fight into a two-minute one and a 98-second fight into a timeout. That is
   * not the boss getting harder, it is the same fight taking longer, and
   * `bosslength` gates at 120s precisely because an over-long boss is an
   * over-long piece of music.
   *
   * THIS IS THE FIRST NUMBER TO RE-TUNE FROM MEASUREMENT. Read `bosslength`
   * AND `bossdps`, twice each, before moving it — and read the warning in
   * tools/README about those two agreeing, because they share a dodging bot
   * that lines up under a weaving boss about half the time.
   */
  e.hp = e.maxHp = Math.round(430 * (1 + difficulty * 0.25));
  e.radius = 46;
  e.score = 8000;
  e.dropChance = 1;
  e.hue = variant % 2 === 1 ? 15 : 340;
  e.move = bossMove;
  e.phases = 3;
  e.phaseThresholds = [0.66, 0.33];
  e.phaseEmitters = bossPhaseEmitters(difficulty, variant);
  e.emitters = e.phaseEmitters[0].map((s) => new Emitter(s));
  return e;
}

/**
 * Flag a phase change once HP crosses its threshold — but do not commit it.
 *
 * The commit waits for a musical boundary (see `World.updateEnemies`), so a
 * boss fight is three sections that begin on downbeats rather than three
 * sections that begin whenever a bullet happens to land. The gap between
 * crossing and committing is the boss visibly straining, which also gives the
 * player a beat of warning that the pattern is about to change.
 */
export function markBossPhasePending(e: Enemy): boolean {
  if (e.archetype !== 'conductor' || e.phasePending) return false;
  const next = e.phase + 1;
  if (next >= e.phases) return false;
  if (e.hp / e.maxHp > e.phaseThresholds[e.phase]) return false;
  e.phasePending = true;
  return true;
}

/** Actually switch to the next phase. Returns the new index, or -1. */
export function commitBossPhase(e: Enemy): number {
  if (!e.phasePending) return -1;
  e.phasePending = false;
  const next = e.phase + 1;
  if (next >= e.phases) return -1;
  e.phase = next;
  e.emitters = e.phaseEmitters[next].map((s) => new Emitter(s));
  return next;
}

/** Beats until this enemy's soonest volley; Infinity if it is not about to fire. */
export function beatsUntilFire(e: Enemy, nowBeat: number): number {
  if (!e.armed || e.leaving || e.emitters.length === 0) return Infinity;
  let soonest = Infinity;
  for (const em of e.emitters) soonest = Math.min(soonest, em.nextIn(nowBeat));
  return soonest;
}

