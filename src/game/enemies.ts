/**
 * Enemy archetypes.
 *
 * Each archetype is a movement function, a closing speed and — for the shapes
 * that have one — a LUNGE. They are also the units the music director thinks
 * in: every archetype has a motif in `audio/layers.ts`, so the composition of a
 * wave is audible before you have finished reading the screen.
 *
 * ------------------------------------------------------------------------
 * NOTHING HERE SHOOTS ANY MORE, and that is the whole of this pass.
 *
 * `docs/plan-refactor-3.md` §1b: this codebase is a vertical bullet-hell
 * converted to an arena, and enemy fire was the last shmup organ in it. The
 * declarative `EmitterSpec` tables that used to sit under every archetype, the
 * `Emitter` runtime that turned them into bullets, `armedChance`, the 3000-slot
 * `BulletPool` they filled and the collision sweep that read it are all gone —
 * deleted, not disabled, because a dead branch nobody runs is worse than no
 * branch.
 *
 * WHAT REPLACES THEM IS SPEED, NOT COUNT. The plan names the risk plainly:
 * "contact-only damage may make the game trivial ... without bullets, kiting
 * may beat everything". It is exactly right, and the arithmetic says why. The
 * closing speeds this file shipped for its whole life were 55-84 px/s against
 * a player who moves at 430 (`player.ts` PLAYER_SPEED). A body that can only
 * hurt you by touching you, moving at a fifth of your speed, is not a threat;
 * it is scenery. Every mob speed below is therefore two to three times what it
 * was, and the numbers are per archetype so the roster keeps its shape.
 *
 * THE LUNGE IS WHAT KEEPS THE MUSIC IN THE GAME. Enemy volleys were the one
 * enemy action locked to the transport's beat grid — `tools/telegraph.mjs`
 * measured 93% of them landing on a subdivision, the renderer drew a windup
 * ring over the last half beat, and `enemy:fire` was a note in the mix. Contact
 * damage on its own has no event and no clock, so deleting fire without
 * replacing it would have taken the enemies out of the arrangement entirely. A
 * lunge is the same contract expressed as movement: scheduled on an absolute
 * beat, telegraphed for half a beat before it commits, and emitting the same
 * panned event the volley did. It is also the direct answer to kiting — the
 * one thing on the field that can out-accelerate a running player.
 * ------------------------------------------------------------------------
 */

import type { EnemyArchetype } from '../core/events';
import { clamp } from '../core/math';
import { VIEW_H, VIEW_W } from './field';

/**
 * A telegraphed dash at the player.
 *
 * `everyBeats` is the cadence, in beats, exactly as `EmitterSpec.beats` was —
 * scheduling against the transport's ABSOLUTE beat rather than a countdown is
 * what made volleys undriftable and it is kept for the same reason (see
 * `Enemy.lungeBeat`).
 *
 * `windupBeats` is how long the body visibly gathers before it goes. Half a
 * beat is ~0.23s at 130bpm, which is what the old emitter windup ring used and
 * what `tools/telegraph.mjs` asserts is visible.
 */
export interface LungeSpec {
  everyBeats: number;
  windupBeats: number;
  /**
   * Dash speed, px/s, and it is deliberately two to three times the player's
   * 430.
   *
   * The first draft ran 430-560 and was nearly worthless, for a reason that is
   * obvious once written down: a charge that closes at 500 against a ship
   * running at 430 gains 70 px/s, so over a 0.4s dash it takes 28px off a gap
   * the ship opened at leisure. It has to be a BURST or it is a walk with a
   * ring drawn round it. Swept on `tools/arena.mjs` at x1.0 / x1.6 / x2.2 of
   * the original table (3 runs x 10 min each): hits taken 1.3 / 1.7 / 1.7 at a
   * 6-beat cadence, and 6.3 once the cadence came down with it. Cadence and
   * reach had to move together.
   */
  speed: number;
  /**
   * How long the dash lasts, in seconds. `speed x time` is its reach, and the
   * reach is the number to read: 258-408px across the roster, against a view
   * whose short axis is about 925. A third of the screen, in a third of a
   * second, after half a beat of warning.
   */
  time: number;
}

export interface EnemyContext {
  playerX: number;
  playerY: number;
  /** Where the ship is going, px/s. Movers lead it; see `toPlayer`. */
  playerVX: number;
  playerVY: number;
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
  /** Boss only: which of the two attack variants, and the difficulty it spawned at. */
  bossVariant: number;
  bossDifficulty: number;
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
  /** True once it has turned to leave; stops it lunging on the way out. */
  leaving: boolean;

  /* ---------------------------------------------------------------------- *
   * THE LUNGE — what replaced this shape's guns.
   * ---------------------------------------------------------------------- */
  /** Null for a body that only walks at you. */
  lunge: LungeSpec | null;
  /**
   * ABSOLUTE transport beat of the next lunge, not a countdown, and -1 until
   * the body has entered and been scheduled.
   *
   * This is the one piece of `Emitter` worth keeping and it is kept verbatim in
   * spirit. Its note there: an emitter that accumulated its own beat count from
   * `bpm * dt` drifted away from the transport on every audio-clock correction
   * and every frame of hitstop, and only ~55% of volleys landed on a
   * subdivision despite the whole system being "scheduled in beats". Scheduling
   * against the transport's absolute position makes drift structurally
   * impossible: a late frame, a tempo change or a freeze can delay a lunge, but
   * never detune it.
   */
  lungeBeat: number;
  /**
   * Beats added to the FIRST schedule only, so a formation can stagger.
   *
   * `Emitter.pendingDelay` in one number. `World.spawnGroup` sets it for the
   * `rhythm` formation, where each body in the row is a sixteenth later than
   * the last and the group performs its own bar around the player.
   */
  lungeOffset: number;
  /** Seconds of dash left. > 0 means it is committed and travelling. */
  lungeTime: number;
  lungeVX: number;
  lungeVY: number;
  /**
   * Knockback: seconds left of a shove and the velocity carrying it.
   *
   * `World.repel` writes these. It is the contact game's replacement for
   * deleting the bullets in the air — see the note on that method — and it is
   * per-body rather than an impulse into `vx`/`vy` because most movers here do
   * not integrate a velocity at all: `ringHold`, `weave` and `stutterHop` write
   * positions directly, so an impulse would be overwritten on the same frame.
   */
  pushTime: number;
  pushVX: number;
  pushVY: number;
  /**
   * Latch for the near-miss award, so one pass costs one graze.
   *
   * The bullet version was `BulletFlag.Grazed`, set on the bullet and never
   * cleared because a bullet only ever passes you once. A body can pass you
   * repeatedly, so this clears again when it has backed off past the hysteresis
   * band in `World.collidePlayer`.
   */
  grazed: boolean;
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
  /** Refractory window after a freeze ends; blocks an immediate re-freeze. */
  freezeLock: number;
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

/**
 * Unit vector from the enemy toward WHERE THE PLAYER IS GOING, and the
 * distance to them now.
 *
 * IT LEADS THE TARGET, and that is the second-largest behavioural change in
 * this pass after the standoff going away. Every mover aimed at the player's
 * current position, which is correct for a shape whose job is to get in range
 * and shoot and is hopeless for one whose job is to touch you: a body at 245
 * px/s chasing a ship at 430 that aims where the ship IS can never arrive, so
 * the whole crowd collapses into a tail behind the player and the arena's own
 * danger signal — encirclement, the largest angular gap in the ring — never
 * closes. Measured before this line existed, encirclement p50 sat at 0.01-0.04
 * against a p90 of 0.40 with 45 bodies on screen: forty-five enemies, all of
 * them behind, none of them a problem.
 *
 * Aiming at where the ship WILL be turns the same crowd into a pincer. The
 * bodies arriving from the flanks cut the corner and get in front, which is
 * what closes a ring, and it costs the player nothing they cannot see coming —
 * it is the difference between being followed and being herded.
 *
 * THE LEAD IS CAPPED IN TIME AND SCALED BY DISTANCE. A body 1500px away
 * extrapolating 0.7 seconds of a ship's current heading is aiming at a
 * prediction the ship has no intention of honouring, and the visible result is
 * a crowd that walks confidently at empty floor. Scaling by proximity keeps the
 * interception where it is actually an interception.
 */
function toPlayer(e: Enemy, ctx: EnemyContext): { ux: number; uy: number; d: number } {
  const rawX = ctx.playerX - e.x;
  const rawY = ctx.playerY - e.y;
  const d = Math.hypot(rawX, rawY) || 1;
  /*
   * The lead ramps IN with distance at both ends, and the near end is the half
   * that was missing.
   *
   * A first version scaled only by `1 - d/900`, so the lead was at its FULLEST
   * when the body was already on top of the player. That is the one place
   * leading is wrong: a body 30px away aiming 300px ahead of a ship travelling
   * at 430 px/s does not steer into it, it steers alongside it, and the two
   * never touch. Measured, that is exactly what happened — three 300-second
   * runs against a mean of 16-21 live enemies produced ZERO contacts.
   *
   * So the lead is zero at contact and reaches full by 200px, then falls away
   * again past 900 where extrapolating a heading the ship has not committed to
   * is guesswork. Interception where interception makes sense; a straight line
   * at arm's length.
   */
  const lead = LEAD_SECONDS * clamp(d / 200, 0, 1) * clamp(1 - d / 900, 0, 1);
  const dx = rawX + ctx.playerVX * lead;
  const dy = rawY + ctx.playerVY * lead;
  const dl = Math.hypot(dx, dy) || 1;
  return { ux: dx / dl, uy: dy / dl, d };
}

/**
 * How far ahead of the ship a mover aims, in seconds. See `toPlayer`.
 *
 * Swept on `tools/arena.mjs`, 3 runs x 10 simulated minutes at each value, with
 * everything else held: 0 gives encirclement p90 0.49 and 1.7 hits taken, 0.5
 * gives 0.52 and 2.7, 0.9 gives 0.56 and 3.3. Monotone in both columns, which
 * is the shape the mechanism predicts — leading the target closes the ring, and
 * a closed ring is where the hits come from.
 */
const LEAD_SECONDS = 0.9;

/**
 * The fastest an enemy may ever CLOSE, in px/s. 0.95 of the player's 430.
 *
 * A single ceiling shared by the difficulty term here and the escalation term
 * in `World.scaleForEnsemble`, because two multipliers compounding toward a
 * bound that only one of them respects is how a cap stops being a cap. The
 * rule it encodes is "a running ship always gains, however slowly": kiting gets
 * more expensive for the whole length of a run and never stops working.
 */
export const SPEED_CEILING = 340;
/*
 * 340, down from 408, and the old number is why you could not run away.
 *
 * Reported from play: "the monsters shouldnt be able to move faster than the
 * player except for maybe elites, otherwise cant run away."
 *
 * They never were faster — this cap has always sat under `PLAYER_SPEED` — but
 * 408 against 430 is a 5% margin, and a 22 px/s gain is not an escape. Ten
 * seconds of running buys 220px on a field 3000px across and a view 1492 wide:
 * the chaser stays on screen, stays the same size, and the player has spent ten
 * seconds proving that fleeing does not work. The rule above says "a running
 * ship always gains, however slowly", which was satisfied to the letter and
 * missed the point of its own sentence.
 *
 * At 340 the margin is 21% and the gain is 90 px/s, so a second of running is a
 * body length and five seconds clears half a screen. That is the difference
 * between a rule that is technically true and one a player can feel.
 *
 * WHAT STAYS FAST, deliberately, because "nothing may outrun you" and "nothing
 * may ever reach you" are different rules and only the first was asked for:
 *
 *   - THE LUNGE, at 860-1080. It is 0.3-0.4s long, it commits to a straight
 *     line at the instant it fires, and it is telegraphed by a contracting ring
 *     for half a beat first. That is the attack. A dash you can see coming and
 *     step out of is the whole of what makes contact damage a fight rather than
 *     a chase, and capping it to cruise speed would delete the only thing an
 *     enemy does that the player has to answer.
 *   - BOSSES AND RUSH, at 1000-1430. The owner's own exception: "except for
 *     maybe elites".
 *
 * So the cruise is escapable and the attack is not, which is the shape every
 * survivors-like uses.
 */

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
  /*
   * Eased into the first HALF of the subdivision, not the first third.
   *
   * Reported from play: "why do enemies just freeze often". This is half the
   * answer, and it is the half that applies whatever the player is holding.
   *
   * The cube put 70% of the travel in the first third, which reads as a snap —
   * correctly, that is the point. But it also means that from halfway through
   * every eighth note the body covers only the last 12% of its distance, so
   * the most numerous enemy in the game is VISIBLY STATIONARY for half of
   * every beat. On a shooting field that read as rhythm. Under contact damage
   * it reads as broken, and it makes the shape less dangerous than its speed
   * suggests, because half its time is spent not closing.
   *
   * Squared keeps the snap — 75% of the travel is still done by the halfway
   * point against the cube's 87% — while the back half keeps moving instead of
   * asymptoting. The hop still lands on the subdivision, which is what puts
   * the beat in the movement layer.
   */
  const frac = Math.min(1, Math.max(0, ctx.beat * 2 - step));
  const eased = 1 - Math.pow(1 - frac, 2);
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
  /**
   * Closing speed in px/s at difficulty 0. See the note at the head of the
   * SPECS table — these are the numbers that carry the difficulty curve now
   * that nothing shoots.
   */
  speed: number;
  /**
   * How close it wants to get, in px, as a fraction of nothing — it is an
   * absolute distance and it is 0 for every shape that means to touch you.
   *
   * Every mob used to hold a ring 120-280px out, handed to it per WAVE by
   * `planWave`'s `homeY`. That is a shooting gallery's geometry: you stand off
   * and you fire, and the standoff is what makes the fire the threat. With
   * contact as the only damage a standoff is a promise never to hurt anybody,
   * so the roster closes now and the character lives in HOW it closes.
   */
  standoff: number;
  lunge: LungeSpec | null;
}

/*
 * A NOTE ON CLOSING SPEED, WHICH IS NOW THE WHOLE THREAT MODEL.
 *
 * The old table shipped 55-84 px/s and a long comment (kept below, under
 * `spawnEnemy`) arguing that those numbers should not move as a side effect of
 * a coordinate change. That was right then and is wrong now: the coordinate
 * change was the arena, and this change deletes the only thing those bodies
 * could do at a distance. A shape that hurts you only by touching you and
 * closes at a fifth of your speed cannot hurt you at all — you walk away from
 * it, forever, for free.
 *
 * So the roster is re-speeded around the player's 430 px/s, in a spread rather
 * than a flat multiplier, and the spread IS the roster:
 *
 *   stutter 330   the swarm. Fastest thing on the field, individually pathetic
 *                 (4 hp). It was already the fastest at 84 and it keeps that
 *                 rank; a hi-hat should arrive first.
 *   glissando 265 evasive AND quick — it weaves +/-150px across its approach,
 *                 so its effective closing rate is well under this.
 *   pluck 245     the plain one. The shape a new player learns to walk away
 *                 from, so it has to be walkable-away-from: 0.57x player speed.
 *   echo 230      splits when killed, so two arrive where one died.
 *   arpeggiator 210  slow and tough, the thing you cannot simply ignore.
 *   subdrop 180   the heavy. 48 base hp and a charge that hurts to be near.
 *   rush          unchanged: it does not close, it commits. See `rushDive`.
 *
 * None of these outruns the player and that is deliberate — a mob that can
 * catch a running ship on foot removes kiting as a skill rather than taxing it.
 * The LUNGE is what taxes it, in bursts you can see coming.
 *
 * SWEPT, NOT GUESSED, and the first pass was too gentle by a factor of about
 * 1.4. `tools/arena.mjs`, 3 runs x 10 simulated minutes at each of three global
 * multipliers on this table, everything else held:
 *
 *     x1.0   encirclement p90 0.38   on screen p90 44.7   hits 0.0 / 0.0
 *     x1.4                    0.40                 47.7        1.3 / 2.3
 *     x1.8                    0.45                 45.0        1.7 / 3.7
 *
 * Read two things out of that. Speed moves ENCIRCLEMENT and barely moves
 * on-screen count, which is the right shape — it is not adding bodies, it is
 * stopping the ones there from trailing behind in a tail. And it does NOT on
 * its own make the game dangerous: three hits in ten minutes is still a bot
 * that cannot lose. Speed was necessary and nowhere near sufficient; the lunge,
 * the target lead and `INVULN_ON_HIT` are the other three quarters. x1.4 is
 * baked in above.
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
    speed: 245,
    standoff: 0,
    // The plain one, and the only mob whose lunge is slow enough to walk out
    // of on foot. It is the shape the game teaches the mechanic with.
    lunge: { everyBeats: 3, windupBeats: 0.5, speed: 860, time: 0.3 },
  },
  stutter: {
    hp: 4,
    radius: 10,
    score: 60,
    dropChance: 0.07,
    hue: 300,
    move: stutterHop,
    /*
     * 215, down from 330. Reported from play: "the little pink guys are still
     * too fast."
     *
     * That is this shape — hue 300, radius 10, the smallest body in the game
     * and the only one at 330. It was ALSO the most numerous, spawning 4-7 to a
     * group, so the thing a player meets most often was the thing they could
     * least get away from. `spec.speed * (1 + difficulty * 0.5)` put it at 330
     * from the very first wave, which is 77% of `PLAYER_SPEED` before any
     * scaling at all, and it reached the 340 ceiling by about difficulty 0.03 —
     * so lowering the global cap in the commit before this one did almost
     * nothing for the one shape the complaint was actually about.
     *
     * At 215 it opens at exactly half the player's speed and needs difficulty
     * 0.58 to reach the cap, so outrunning a swarm works from the first wave
     * and slowly stops being free. The hop keeps its eighth-note grid, which is
     * what puts it in the arrangement; it is the DISTANCE each hop covers that
     * comes down, not the rhythm.
     *
     * It is still the fastest cruise in the roster, which is right for the
     * hi-hat of the set. It is simply no longer faster than the thing it is
     * chasing.
     */
    speed: 215,
    standoff: 0,
    /*
     * The swarm does not lunge, exactly as it did not shoot.
     *
     * The old note here is worth keeping because the reasoning survives the
     * change of weapon: stutters spawn 4-7 at a time and are the fastest thing
     * on the field, and "the fastest and most numerous shape also gets the
     * telegraphed burst" is not readable at any density. It is the hi-hat of
     * the roster and a hi-hat is texture you move through. Its hop is already
     * on the eighth-note grid, so it is in the arrangement without one.
     */
    lunge: null,
  },
  arpeggiator: {
    hp: 32,
    radius: 20,
    score: 350,
    dropChance: 0.32,
    hue: 45,
    move: closeAndHold,
    speed: 210,
    standoff: 0,
    // Slow body, frequent lunge: the one you have to keep looking at. Its old
    // emitter was a rotating ring on a 2-beat burst, so a 4-beat cadence keeps
    // it "the one that keeps going off" in the mix.
    lunge: { everyBeats: 2, windupBeats: 0.5, speed: 1000, time: 0.34 },
  },
  glissando: {
    hp: 10,
    radius: 16,
    score: 240,
    dropChance: 0.26,
    hue: 150,
    move: weave,
    speed: 265,
    standoff: 0,
    // The evasive one, and its lunge is the longest reach in the roster: it
    // swings wide across its approach and then cuts straight in.
    lunge: { everyBeats: 2, windupBeats: 0.5, speed: 1080, time: 0.34 },
  },
  echo: {
    hp: 10,
    radius: 17,
    score: 260,
    dropChance: 0.2,
    hue: 265,
    move: echoDrift,
    speed: 230,
    standoff: 0,
    // A statement and its repeat: its lunge is the shortest and lightest in
    // the table, which is the same idea its motif carries.
    lunge: { everyBeats: 3, windupBeats: 0.5, speed: 960, time: 0.3 },
  },
  rush: {
    hp: 12,
    radius: 14,
    score: 180,
    dropChance: 0.14,
    hue: 25,
    move: rushDive,
    // Unused: `rushDive` drives itself from `vx`/`vy` after its telegraph.
    speed: 0,
    standoff: 0,
    // The dive IS the lunge, and it was here first. Giving it a second one
    // would be the same attack twice on two different clocks.
    lunge: null,
  },
  subdrop: {
    hp: 48,
    radius: 28,
    score: 800,
    dropChance: 0.55,
    hue: 8,
    move: closeAndHold,
    speed: 180,
    standoff: 0,
    // Slow, enormous, and it commits hard when it commits. 8 beats is two bars
    // — the longest windup-to-windup gap in the roster, so the low brass hit
    // stays an event.
    lunge: { everyBeats: 4, windupBeats: 0.5, speed: 900, time: 0.4 },
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
    move: driftIn,
    homeX: 0,
    homeY: 0,
    standoff: 0,
    orbitDir: 1,
    score: 0,
    dropChance: 0,
    alive: true,
    phase: 0,
    phasePending: false,
    phases: 1,
    phaseThresholds: [],
    bossVariant: 0,
    bossDifficulty: 0,
    hue: 200,
    escaped: false,
    leaveAt: Infinity,
    leaving: false,
    lunge: null,
    lungeBeat: -1,
    lungeOffset: 0,
    lungeTime: 0,
    lungeVX: 0,
    lungeVY: 0,
    pushTime: 0,
    pushVX: 0,
    pushVY: 0,
    grazed: false,
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
    freezeLock: 0,
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
 * How likely a spawned body is a LUNGER.
 *
 * Replaces `armedChance`, which decided whether an enemy carried guns. Renamed
 * rather than repurposed in place, per the same rule that renamed `enemy:fire`'s
 * `pan`: the old name would have let `spawnGroup`, `movements` and every tool
 * that reads it keep printing a column whose definition had moved.
 *
 * THE NUMBER IS FAR HIGHER THAN THE ONE IT REPLACES, and the reason is that it
 * is measuring something much cheaper. `armedChance` topped out at 0.22 because
 * a shooter fills the screen with bullets that persist for seconds; a lunger
 * costs the screen one contracting ring for half a beat and then a body that
 * is briefly somewhere else. The thing that made a high armed fraction unreadable
 * — 21.6 bullets in the air against 2.4 enemies, measured — has no analogue
 * here, so the fraction can be what the difficulty curve actually wants.
 *
 * 30% at wave 1 rising to 75% from wave 13. The floor matters because the
 * opening is where a player learns to read a windup, and a wave with no windup
 * in it teaches nothing.
 */
export function lungeChance(difficulty: number): number {
  /*
   * 0.72 -> 0.96, up from 0.30 -> 0.75, and this is a measurement rather than
   * a taste change.
   *
   * The old numbers were carried over from the armed-shooter chance they
   * replaced, where they were right: a field where every body shot at you is a
   * bullet hell, and `armedChance` existed to keep most shapes silent. A lunge
   * is not a volley. It is the ONLY thing an enemy does now that the player has
   * to answer, and a body without one is scenery that happens to be solid.
   *
   * Measured on the shipped value, 60s at 0.1s resolution: 6,024 enemy samples,
   * 5,243 of them with NO LUNGE SPEC AT ALL — 87%. Of a field averaging about
   * thirty bodies, 1.2 could attack. The whole 75-second run committed FIVE
   * lunges, which is why `tools/telegraph.mjs` reported "only 0 attacks in 75s"
   * and could not measure its own grid, and why hits taken had collapsed to
   * 6-16 across a twenty-minute run.
   *
   * Three of the twelve archetypes carry `lunge: null` deliberately and are
   * untouched — the unarmed escorts that make an early wave readable are still
   * the reason that field exists. The floor moves instead, so that most of
   * what CAN dash does.
   *
   * Contact damage is unaffected either way: every body has always hurt on
   * touch, and that is what the owner asked for. This is about whether anything
   * ever comes AT you, which is a different question and the one the difficulty
   * curve rests on now that there are no bullets.
   */
  return Math.min(0.96, 0.72 + difficulty * 0.24);
}

export function spawnEnemy(
  archetype: Exclude<EnemyArchetype, 'conductor'>,
  x: number,
  y: number,
  difficulty: number,
  lunges = true,
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
   * THE STANDOFF RING IS GONE, and it is the single largest behavioural change
   * in this pass.
   *
   * It used to be per-WAVE — `planWave` generated `homeY` in the range 120-280
   * and `spawnGroup` handed it straight in as a radius — with the note that
   * "how close a shape gets IS its character: a pluck lobbing from 260px away
   * and an arpeggiator working 170px out are different problems even before
   * either of them fires". Every word of that depended on the last four.
   *
   * A body that cannot shoot and stops 200px short is a body that has decided
   * never to hurt you. Holding a ring was the shooting gallery's geometry and
   * it goes with the shooting; the character now lives in the MOVER — a
   * glissando still weaves +/-150px across its approach, a stutter still hops
   * on the eighth note, a subdrop is still slow and enormous. They just all
   * arrive.
   */
  e.standoff = spec.standoff;
  e.orbitDir = orbitDir >= 0 ? 1 : -1;
  e.hp = e.maxHp = Math.round(spec.hp * (1 + difficulty * 0.85));
  e.radius = spec.radius;
  e.score = spec.score;
  e.dropChance = spec.dropChance;
  e.hue = spec.hue;
  e.move = spec.move;
  /*
   * Closing speed, and it MOVED — deliberately, as its own decision, measured.
   *
   * The comment this replaces said the opposite and was right at the time: the
   * numbers were held still through the arena conversion so that "the arena
   * changes where things come from and it should not silently also change how
   * fast they arrive". It recorded the old per-archetype measurements (stutter
   * 299/357 px/s including its hop overshoot, glissando 176/185, echo 96/100,
   * pluck 61/69, arpeggiator 62/63) and asked that any change be its own
   * decision rather than a side effect. This is that decision.
   *
   * What forces it is that closing speed is now the ONLY thing standing between
   * the player and a game they can walk away from. See the note at the head of
   * the SPECS table for the per-archetype spread and why it is a spread.
   *
   * The difficulty term is small on purpose — a quarter again by the cap. The
   * curve is carried by hp (`World.scaleForEnsemble`), count, and the lunge
   * fraction; speed is what makes the mechanic exist at all, and this file's
   * own history is two difficulty passes that overshot by tightening several
   * hands at once.
   */
  e.vy = Math.min(SPEED_CEILING, spec.speed * (1 + difficulty * 0.5));
  /*
   * `lunges` is the caller's intent; an archetype with no lunge overrules it,
   * exactly as `armed` used to be overruled by an archetype with no emitters.
   * Without this a guaranteed-lunging stutter reads as a lunger to everything
   * downstream and then never lunges, which is a lie to the renderer (it draws
   * the windup ring off this) and to every measuring tool.
   */
  e.lunge = lunges ? spec.lunge : null;
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
 * The boss's attack, per phase, in two variants that alternate between bosses.
 *
 * WHAT THIS REPLACES. Two tables of `EmitterSpec[][]` — gapped rotating rings
 * for variant 0, telegraphed walls and sweeps for variant 1 — 120 lines of
 * danmaku that were the single densest use of the bullet system in the game.
 * All of it is gone with the pool.
 *
 * WHAT SURVIVES IS THE DISTINCTION BETWEEN THE TWO VARIANTS, because that is
 * the part that was doing design work: "two shapes of problem rather than one
 * shape at two speeds, which is what stops the fourth boss feeling like the
 * first one with more HP". Expressed as a lunge:
 *
 *   variant 0 — ROTATION. It circles fast and charges often, on a short
 *               cadence with a short reach. You solve it by orbiting with it.
 *   variant 1 — TIMING. It circles slowly and charges rarely, but each charge
 *               is enormous — twice the reach and half again the speed. You
 *               solve it by reading one windup and being elsewhere.
 *
 * Both get faster and more frequent with each phase, which is what the phase
 * gate is for: three acts, each a harder version of the same question.
 */
function bossLunge(difficulty: number, variant: number, phase: number): LungeSpec {
  const d = difficulty;
  // Phase 0/1/2 -> 1 / 0.82 / 0.68 of the written cadence.
  const tighten = [1, 0.82, 0.68][Math.min(2, phase)];
  if (variant % 2 === 1) {
    return {
      everyBeats: 6 * tighten,
      // A full beat of windup rather than half. The whole variant is about
      // reading one thing coming, so it is deliberately the most readable
      // attack in the game and by far the worst one to be standing in front of.
      // 1250 x 0.5 is 625px of reach — two thirds of the short axis of the
      // view, which is what makes "be somewhere else" the whole fight.
      windupBeats: 1,
      speed: 1250 + d * 180,
      time: 0.5,
    };
  }
  return {
    everyBeats: 3 * tighten,
    windupBeats: 0.5,
    speed: 1000 + d * 140,
    time: 0.34,
  };
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
  e.bossVariant = variant;
  e.bossDifficulty = difficulty;
  e.lunge = bossLunge(difficulty, variant, 0);
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
  e.lunge = bossLunge(e.bossDifficulty, e.bossVariant, next);
  // Re-schedule from scratch so the new phase's first charge lands after the
  // transition rather than inheriting the old phase's next due beat.
  e.lungeBeat = -1;
  return next;
}

/**
 * Beats until this body commits its lunge; Infinity if it is not about to.
 *
 * Replaces `beatsUntilFire`, one for one, including its consumer: the renderer
 * draws a ring that contracts onto the enemy over the last half beat. That
 * windup is the ONLY warning contact damage gets, so it matters more now than
 * it did when it decorated a volley that was itself visible in the air.
 */
export function beatsUntilLunge(e: Enemy, nowBeat: number): number {
  if (!e.lunge || e.leaving || e.lungeBeat < 0 || e.lungeTime > 0) return Infinity;
  return Math.max(0, e.lungeBeat - nowBeat);
}

