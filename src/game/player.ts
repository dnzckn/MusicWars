/** The player ship: movement, facing, focus mode, invulnerability, grazing. */

import { clamp, damp, TAU } from '../core/math';
import type { PowerupKind } from '../core/events';

/*
 * Speeds, re-tuned for the arena.
 *
 * The vertical game moved the ship at a flat 460 px/s with no acceleration at
 * all: velocity WAS the stick. That is the right choice for a shmup, where the
 * player's whole job is to place the hitbox in a gap that is arriving on a
 * schedule, and any lag between the key and the pixel is a death they could not
 * have avoided.
 *
 * It is the wrong choice here. In a game where moving is the ONLY verb — there
 * is no fire button any more — instantaneous velocity means the ship has no
 * weight, and a ship with no weight has no relationship to the ground it is
 * crossing. Every survivor-shaped game that feels good has some carry in it.
 *
 * So the top speed comes DOWN and acceleration goes in. The felt speed rises
 * even though the number falls, because a ship that has to spend a tenth of a
 * second reaching 430 reads as fast when it gets there, where one that is
 * simply at 460 on the first frame reads as a cursor.
 */
export const PLAYER_SPEED = 430;
export const PLAYER_FOCUS_SPEED = 190;

/*
 * AUTO-ADVANCE. The ship is always moving forward; the stick only trims it.
 *
 * `CRUISE_SPEED` is what the ship makes along -y with the stick centred, and
 * `TRIM_SPEED` is how much the forward axis of the stick may add to or take
 * off that. So the forward speed runs [170, 430] px/s and there is no input
 * that stops it, which is the whole contract: "you cannot stop and you cannot
 * leave the frame".
 *
 * THE FIRST PAIR WAS 300/130 AND THE REASONING BEHIND IT WAS BACKWARDS.
 * It read: `enemies.ts` caps every mob at `SPEED_CEILING = 285`, so a cruise
 * above that makes "things you have already passed leave" true by
 * construction. That is true, and it is the wrong thing to want. A stage where
 * no body can ever reach the ship is not a hard stage, it is an EMPTY one —
 * measured in play at 16 enemies alive and ZERO on screen — and it is the same
 * finding `docs/research-density.md` §6 records from the other direction, where
 * bodies arriving behind a running ship read as scenery and hits taken fell
 * 18.3 to 1.0.
 *
 * The crowd travels WITH the stage now (`World.updateEnemies` carries every
 * body forward at `CRUISE_SPEED`), so the cruise no longer decides whether a
 * mob can keep up — nothing has to keep up, because nothing is being left. See
 * that block for why enemies and only enemies ride.
 *
 * SO THE TWO NUMBERS MEAN DIFFERENT THINGS NOW. `CRUISE_SPEED` is how fast the
 * STAGE travels: it sets how quickly the ground goes past, and nothing else.
 * 360 px/s is a screen every three seconds at the default view, which reads as
 * travel rather than drift.
 *
 * `TRIM_SPEED` is the whole of the gameplay in this axis: it is the ship's top
 * speed RELATIVE TO THE STAGE along the track, which is the frame every enemy,
 * every standoff and every lunge is now measured in. 260 against a lateral 430
 * is 60% — enough that moving up and down the frame is a real dodge rather
 * than a nudge, and short of parity so that sideways remains the fastest
 * escape, which is what the roster is tuned around.
 *
 * TRIM MUST STAY UNDER CRUISE, and that inequality is the owner's "always
 * moving forward" written as arithmetic: the forward range is
 * [CRUISE - TRIM, CRUISE + TRIM] = [100, 620], so there is no stick position
 * that stops the ship or reverses it. 100 px/s at a full brake is slow enough
 * to feel like being caught and fast enough that the ground is still visibly
 * moving.
 *
 * NEITHER IS SCALED BY THE RIG OR BY FOCUS, and that is a decision rather than
 * an oversight. `moveSpeed` and focus multiply the LATERAL speed and the trim;
 * the cruise is the stage's speed, not the ship's, and letting a build change
 * it would move the spawn line, the population census and the cull horizon
 * with it — all three are derived from a view that travels at this rate.
 * Focus in particular has to leave it alone: a focused ship that dropped to
 * 190 px/s would slide backwards out of the frame every time the player
 * planted, which is the opposite of what planting is for.
 */
export const CRUISE_SPEED = 360;
export const TRIM_SPEED = 260;

/*
 * How hard the ship settles back to its station in the track window, and over
 * what distance, when the throttle is released.
 *
 * WHY THE WINDOW NEEDS THIS AT ALL. Without it the window has no restoring
 * force in either direction: the rail advances at `CRUISE_SPEED` and a coasting
 * ship travels at `CRUISE_SPEED`, so wherever the player leaves the ship in the
 * frame is where it stays, forever. Verified in the browser — boost to the
 * front of the window, release, and the ship sits at 0.16 of the view for as
 * long as you like. `TRACK_ANCHOR` would then be nothing but a starting
 * position, and since the threat is all ASTERN there is never a reason to come
 * back: every player would ride the front edge permanently, seeing the most
 * pursuit, and the throttle would be a one-way ratchet rather than a choice.
 *
 * With it, boosting and braking are what they read as — transients. Let go and
 * the ship drifts back to station.
 *
 * 160 px/s is under `TRIM_SPEED` by enough that holding the stick still pins
 * the ship against either end of the window (260 - 160 = 100 px/s of net
 * travel, so both edges are still reachable and still hold), and easing it in
 * over 220 px means the last stretch of the return is not a lurch.
 *
 * JUDGED, NOT MEASURED, like the camera's deadzone and the window fractions
 * themselves: no node-only gate can tell you whether a throttle springs back
 * nicely. What IS verified is the failure it fixes, which was a position the
 * ship could enter and never leave.
 */
const RECENTRE_SPEED = 160;
const RECENTRE_SPAN = 220;

/*
 * Halflives for the velocity approach, in seconds.
 *
 * Acceleration is quicker than deceleration on purpose. Answering the stick has
 * to be nearly immediate or the ship feels broken; letting go is where the
 * weight lives, and about 40px of slide from top speed is enough to feel the
 * mass without ever costing a dodge you had already committed to.
 *
 * Focus is crisp in both directions. "Plant and shoot" is the verb, and a
 * planted ship that keeps sliding is not planted.
 */
const ACCEL_HALFLIFE = 0.035;
const BRAKE_HALFLIFE = 0.055;
const FOCUS_HALFLIFE = 0.022;

/*
 * How fast the nose comes round, in radians per second.
 *
 * 18 rad/s turns the ship through 180 degrees in about a sixth of a second —
 * fast enough that reversing feels like a reversal rather than a three-point
 * turn, slow enough that the nose visibly swings rather than teleporting. The
 * swing is most of what makes the ship read as a ship.
 *
 * Focus halves it, which is the whole point of focus in this game: you give up
 * the ability to whip round and you get a facing that holds still while you
 * shoot along it.
 */
const TURN_RATE = 18;
const TURN_RATE_FOCUSED = 9;

/**
 * Below this the stick is noise and the facing is left exactly where it was.
 *
 * THIS WAS DELETED FOR ONE REVISION AND THE DELETION WAS A REGRESSION. The
 * argument for removing it was that auto-advance means the ship can never
 * stand still, so a "the stick is centred, hold your heading" rule has nothing
 * to protect. That is wrong about what the rule protects. Reported from play:
 * "i cant shoot backwards now". With the facing derived from the ship's total
 * velocity — which always carries `CRUISE_SPEED` along -y — the nose could
 * never leave a 136-degree forward arc, so `arc` and `beam` could not be aimed
 * behind at all and the retained-facing rule three comments below was still in
 * the source and unreachable.
 *
 * The facing is driven by the INPUT again, exactly as it was, and the
 * treadmill's contribution is excluded. Pressing back turns the ship round to
 * face the pursuit, which is also what brakes it — one stick, two readings of
 * it, and they agree.
 */
const FACING_DEADZONE = 0.22;

/**
 * How big the ship is for the purposes of being touched. 3.5 -> 11.
 *
 * `PLAYER_HITBOX = 3.5` was the danmaku convention — "the hitbox is far
 * smaller than the sprite" — and it was exactly right for its one consumer: a
 * pinpoint hitbox is what makes threading a wall of bullets possible, and the
 * renderer draws the dot so the player can see where it is.
 *
 * IT IS THE WRONG CONVENTION FOR CONTACT DAMAGE, and the measurement is
 * unambiguous. With the roster converted to contact-only, three 300-second runs
 * of the dodging bot against a mean of 16-21 live enemies produced **zero
 * contacts** — not few, zero. At 3.5 the test was `d < e.radius * 0.62 + 3.5`,
 * which for a pluck is 12.8 pixels: the ship had to pass within thirteen pixels
 * of an enemy's centre, and bodies that orbit and lead their target simply
 * never do. The one damage source in the game could not fire.
 *
 * 11 is the drawn hull: `Renderer.drawPlayer` strokes a triangle 18px forward
 * and 12px to each side. A survivors-like is a game about where your BODY is,
 * so the body is what touches things, and it is the size it looks.
 *
 * RENAMED, not retuned in place. A constant called `PLAYER_HITBOX` sitting at
 * 11 would read as a broken danmaku hitbox to everyone who has ever seen one;
 * `PLAYER_CONTACT` says what it now decides.
 */
export const PLAYER_CONTACT = 11;
export const GRAZE_RADIUS = 26;

/**
 * Seconds of invulnerability after a hit lands. 3.2 -> 1.2.
 *
 * THIS NUMBER WAS SIZED FOR BULLETS AND IS NOW SIZED FOR BODIES, and the two
 * are different problems. Against fire, 3.2 seconds bought the player time to
 * re-read a screen whose contents had just been deleted by `cancelBullets` and
 * would take that long to fill again. Against contact there is nothing to
 * refill: the crowd that hit you is still standing on you, so a long grant is
 * simply free passage through the thing that is supposed to be dangerous — the
 * ship walks out through the middle of a swarm and the swarm is scenery.
 *
 * DERIVED, THEN MEASURED. `World.onPlayerHit` throws every body within
 * `CLEAR_RADIUS` outward at 700 px/s for 0.35s, which covers about 200px after
 * the coast decay. A mob walks back at 245-330 px/s, so the crowd is on the
 * ship again 0.6-0.8s later; add the flight and the floor is about 1.0s. Below
 * that the grant expires while the bodies are still in the air and the player
 * is hit again by the same crowd on the same spot, which reads as the game
 * cheating rather than as a mistake.
 *
 * Swept on `tools/arena.mjs`, 3 runs x 10 simulated minutes, everything else
 * held, hits taken as card-0 / builder:
 *
 *     3.2s   5.0 hits / 12.0     (this is close to free passage)
 *     1.2s   5.0 / 12.0
 *     0.8s   7.0 / 11.3
 *
 * 1.2 is the smallest value above the derived floor. The measured difference
 * between 1.2 and 0.8 is inside the run-to-run spread of this column, so the
 * derivation is what chooses between them rather than the numbers.
 *
 * The x1.5 grant on losing a life (below) is unchanged in FORM and therefore
 * comes down with it, which is correct for the same reason: a life lost in a
 * crowd should hand back position, not immunity.
 */
export const INVULN_ON_HIT = 1.2;

/** Shortest signed angular distance from `a` to `b`, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export class Player {
  x = 450;
  y = 560;
  prevX = 450;
  prevY = 560;

  /**
   * Velocity, in px/s. New in the arena conversion.
   *
   * The vertical ship had no velocity state at all — position was integrated
   * straight from the stick — so nothing downstream could ask which way it was
   * actually moving as opposed to which way it was being pushed. Facing, bank
   * and the audio pan all read this rather than the input, which is why a ship
   * that has let go of the stick still points and banks the way it is
   * travelling instead of snapping back to neutral.
   */
  vx = 0;
  vy = 0;

  /*
   * Facing, and the reason it is a retained value rather than a derived one.
   *
   * "direction moving is how it points and last direction is last pointing
   * vector" — so this is written when the stick is pushed and simply left alone
   * when it is not. That single rule is what makes standing still a usable
   * position: you can back into a corner, stop, and keep shooting the way you
   * were facing, which is a decision. If the facing decayed to some default the
   * player would have to keep moving to keep aiming, and there would be no such
   * thing as holding a line.
   *
   * Full 360 and never snapped to eight ways. An eight-way facing in a game
   * where the enemies arrive on a continuous ring means five degrees of
   * position error becomes forty-five degrees of aim error.
   */
  facing = -Math.PI / 2;
  facingX = 0;
  facingY = -1;
  /**
   * A heavily damped copy of `facing`, for anything that would jitter on the
   * raw value — the audio pan in particular. Weaving between two bullets swings
   * the raw facing 180 degrees twice a second, which is honest and is also not
   * something anybody wants to hear in the stereo field.
   */
  facingSettled = -Math.PI / 2;
  /**
   * Where the ship is actually SHOOTING, after the soft auto-aim snap. Written
   * by the world each step, because only the world knows where the enemies are.
   *
   * `aim` is the facing plus a narrow snap and is what the directional shapes —
   * `arc`, `beam`, and the thrown field — use. `seekAim` is the same when there
   * is a target in the cone and the bearing of the nearest enemy anywhere when
   * there is not, and only the `seek` shape reads it. See `World.computeAim`
   * for why the two are different; the short version is that a kiting player
   * with a forward-only weapon does no damage at all.
   */
  aim = -Math.PI / 2;
  seekAim = -Math.PI / 2;

  /*
   * Derived, never a literal. This was `lives = 4` here and `this.lives = 4`
   * again in reset(), with `maxLives` a third copy — so changing the cap
   * changed nothing a player could feel, and the bug was invisible because
   * every number still looked right in the source.
   */
  lives = 3;
  readonly maxLives = 3;
  hp = 3;
  maxHp = 3;
  /** Extra hit points granted by rig items, folded in by the world. */
  bonusHp = 0;
  bombs = 3;
  /** Black-hole charges in hand, deployed on command. */
  wells = 0;

  focused = false;
  invuln = 0;
  dead = false;
  /** Seconds since the last hit; the music reads this. */
  timeSinceHit = 999;

  grazeTotal = 0;
  /** Grazes counted this second, for the smoothed rate. */
  grazeRate = 0;
  private grazeAccum = 0;

  /**
   * Cosmetic: how hard the ship is sliding sideways relative to where it points.
   *
   * It used to be the raw horizontal stick, which in a vertical shmup is the
   * same thing. Here it is the component of velocity perpendicular to the
   * facing, normalised, so the ship banks into a drift and sits level when it is
   * travelling the way it is pointing — which is what banking means.
   */
  bank = 0;
  /** Cosmetic: the focus ring spins. */
  ringPhase = 0;

  /**
   * Legacy timed powerups: the three field-dropped surges that stayed out of
   * the progression system. Everything else moved to `abilities`.
   */
  powerups: Partial<Record<PowerupKind, number>> = {};

  /**
   * Orbiting pods. Each is a small gun *and* a one-shot bullet absorber, which
   * is the point: they are damage and forgiveness in the same object.
   *
   * The count and radius are written by the world from the DRONE PODS
   * instrument's folded stats rather than derived from a powerup level here.
   * The pod is a rendering and collision fact; what decides how many there are
   * is a progression fact, and the two were tangled.
   */
  readonly droneAngle: number[] = [];
  /** Seconds until an absorbed pod comes back. 0 = live. */
  readonly droneCooldown: number[] = [];
  /** Written by the world each step from the orbit instrument's stats. */
  podCount = 0;
  podRadius = 46;
  podSpin = 1.6;

  /* ---------------------------------------------------------------------- *
   * THE GUARD — Vampire Survivors' Laurel, and the only thing on this class
   * that can refuse a hit for free.
   *
   * Three fields and no logic: `World.fireGuard` owns the refill clock and
   * `takeHit` owns the spend, because a charge that regenerates has to know
   * about the instrument's `interval` and this class does not know what the
   * player is holding. `guardMax` is written by the world every step from the
   * folded stat block, exactly as `podCount` is and for the same reason —
   * "how many there are is a progression fact".
   *
   * `guardBonusInvuln` is the discharge's extra invulnerability, in seconds,
   * so UNA CORDA's card can promise 2.6s and deliver it without `takeHit`
   * knowing which weapon set it.
   * ---------------------------------------------------------------------- */
  /** Charges in hand. Spent by `takeHit` before anything else. */
  guard = 0;
  /** Charges the held instrument allows. Written by the world each step. */
  guardMax = 0;
  /** Extra seconds of invulnerability a spent charge buys, on top of the usual. */
  guardBonusInvuln = 0;
  /**
   * True for exactly one hit: the last `takeHit` was eaten by a charge.
   *
   * The same shape as `lastHitAutoBombed`, and read by `World` for the same
   * reason — this class has no bus, so the world has to be able to ask what
   * happened in order to fire the discharge and count it. A counter here that
   * the world merely read would be a second place the state lives.
   */
  lastHitGuarded = false;

  /** Seconds remaining per timed powerup. */
  private powerTimers: Partial<Record<PowerupKind, number>> = {};

  reset(startX: number, startY: number): void {
    this.x = startX;
    this.y = startY;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.facing = -Math.PI / 2;
    this.facingSettled = this.facing;
    this.aim = this.facing;
    this.seekAim = this.facing;
    this.facingX = 0;
    this.facingY = -1;
    this.lives = this.maxLives;
    this.bonusHp = 0;
    this.maxHp = 3;
    this.hp = 3;
    this.bombs = 3;
    this.wells = 0;
    this.invuln = 0;
    this.dead = false;
    this.timeSinceHit = 999;
    this.grazeTotal = 0;
    this.grazeRate = 0;
    this.grazeAccum = 0;
    this.bank = 0;
    this.powerups = {};
    this.maxActive = Player.MAX_ACTIVE;
    this.powerTimers = {};
    this.held = [];
    this.evicted.length = 0;
    this.podCount = 0;
    this.droneAngle.length = 0;
    this.droneCooldown.length = 0;
    this.guard = 0;
    this.guardMax = 0;
    this.guardBonusInvuln = 0;
    this.lastHitGuarded = false;
  }

  droneCount(): number {
    return this.podCount;
  }

  droneRadius(): number {
    return this.podRadius;
  }

  private syncDrones(dt: number): void {
    const want = Math.max(0, Math.round(this.podCount));
    while (this.droneAngle.length < want) {
      this.droneAngle.push(0);
      this.droneCooldown.push(0);
    }
    this.droneAngle.length = want;
    this.droneCooldown.length = want;
    for (let i = 0; i < want; i++) {
      this.droneAngle[i] = (this.droneAngle[i] + this.podSpin * dt) % TAU;
      if (this.droneCooldown[i] > 0) this.droneCooldown[i] -= dt;
    }
  }

  /** World position of pod `i`, accounting for its phase offset. */
  dronePos(i: number): { x: number; y: number } {
    const n = Math.max(1, this.droneAngle.length);
    const a = this.droneAngle[i] + (i / n) * TAU;
    const r = this.droneRadius();
    return { x: this.x + Math.cos(a) * r, y: this.y + Math.sin(a) * r };
  }

  grazeRadius(): number {
    if (this.powerups.overdrive) return 40;
    return GRAZE_RADIUS;
  }

  /**
   * How many timed powerups can be held at once.
   *
   * Only the three field-dropped surges pass through here now, so in practice
   * the cap almost never bites — the eviction queue is kept because OVERDRIVE
   * and ENCORE can overlap and because deleting a working mechanism to save
   * twenty lines is how a system loses the ability to grow back.
   *
   * "ALMOST NEVER" IS "NEVER", and the sentence above contains its own proof.
   * Only a `duration > 0` kind enters `held`, and of the three kinds a run can
   * grant — BOMB, OVERDRIVE, ENCORE — bomb's duration is 0. Two queue-eligible
   * kinds against a cap of three is a cap that cannot bite:
   * `tools/deadhunt-ranges.mjs` drives 40 grants of every kind in the table and
   * gets 0 evictions, and 115,200 simulated steps produce none either. So
   * `evicted`, the `powerup:expire` emission the world drains from it in
   * `updateDrops`, and the `while` loop above are all unreachable today.
   *
   * Two consequences worth knowing before touching this. `snapshot.loadoutSlots`
   * is written from `maxActive` and is therefore the constant 3 for every frame
   * of every run, whatever its doc in `core/events.ts` says about growing with
   * bosses. And a third timed drop is all it would take to bring the whole
   * mechanism back, which is the argument for leaving it exactly as it is.
   */
  static readonly MAX_ACTIVE = 3;
  maxActive = Player.MAX_ACTIVE;

  /** Pickup order, oldest first, for evicting at the cap. */
  private held: PowerupKind[] = [];

  addPowerup(kind: PowerupKind, duration: number): number {
    const timed = duration > 0;
    if (timed) {
      const at = this.held.indexOf(kind);
      if (at >= 0) this.held.splice(at, 1);
      this.held.push(kind);
      while (this.held.length > this.maxActive) {
        const evicted = this.held.shift();
        if (evicted && evicted !== kind) {
          delete this.powerups[evicted];
          delete this.powerTimers[evicted];
          this.evicted.push(evicted);
        }
      }
    }
    const level = Math.min(3, (this.powerups[kind] ?? 0) + 1);
    this.powerups[kind] = level;
    if (timed) this.powerTimers[kind] = duration;
    return level;
  }

  /** Kinds displaced by the cap this step; drained by the world for events. */
  readonly evicted: PowerupKind[] = [];

  /** Returns the kinds that expired this step. */
  private tickPowerups(dt: number): PowerupKind[] {
    const expired: PowerupKind[] = [];
    for (const key of Object.keys(this.powerTimers) as PowerupKind[]) {
      const left = (this.powerTimers[key] ?? 0) - dt;
      if (left <= 0) {
        delete this.powerTimers[key];
        delete this.powerups[key];
        this.held = this.held.filter((k) => k !== key);
        expired.push(key);
      } else {
        this.powerTimers[key] = left;
      }
    }
    return expired;
  }

  /**
   * Move, turn, and tick everything on a clock.
   *
   * Firing is deliberately NOT here any more. Every weapon in the game is now
   * an instrument in the progression ensemble, and the world is the only thing
   * that knows what is held, where the enemies are, and which of the six shapes
   * to dispatch. A `Player.weapon()` that returned one fan of bullets was the
   * right model for one gun and is a lie about six.
   *
   * `moveScale` is the rig's move-speed modifier, folded in by the caller.
   */
  update(
    dt: number,
    input: { x: number; y: number; focus: boolean },
    /**
     * The rectangle the ship may occupy this step, in WORLD coordinates.
     *
     * Was `{ w, h }` — "the field is a rectangle at the origin" — which stopped
     * being true when the field became unbounded along the travel axis. The
     * caller now hands over a real rectangle because the two axes are no longer
     * the same kind of thing: `x0/x1` are the arena's walls and never move,
     * while `y0/y1` are the TRACK WINDOW and slide forward every step. `y0` is
     * conventionally -Infinity: the front of the window is enforced by the
     * camera dragging forward, not by stopping the ship, because a ship pinned
     * against a moving front edge would have its forward velocity zeroed on
     * every frame and would stutter.
     *
     * `yHome` is the station inside that window — `TRACK_ANCHOR` in world
     * coordinates — which the ship settles back to when the throttle is
     * released. See `RECENTRE_SPEED`.
     */
    bounds: { x0: number; y0: number; x1: number; y1: number; yHome: number },
    moveScale = 1,
  ): PowerupKind[] {
    this.prevX = this.x;
    this.prevY = this.y;

    this.focused = input.focus;
    const boost = this.powerups.overdrive ? 1.1 : 1;
    const top = (this.focused ? PLAYER_FOCUS_SPEED : PLAYER_SPEED) * boost * moveScale;

    // The stick is a direction and a magnitude; `Input` has already normalised
    // anything longer than one, so a half-pushed stick is a half-speed ship.
    const push = Math.hypot(input.x, input.y);
    const wantX = input.x * top;
    /*
     * THE FORWARD AXIS IS A THROTTLE, NOT A DIRECTION.
     *
     * `input.y` is -1 for "push ahead" and +1 for "pull back", and it trims the
     * cruise instead of setting the velocity: the target is always negative, so
     * there is no stick position that stops the ship or reverses it. That is
     * the auto-advance, and it is one line because everything else about this
     * function — the damping, the facing, the bank — already worked off a
     * velocity rather than off the stick.
     *
     * The trim scales with `moveScale`/focus and the cruise does not; see the
     * note on `CRUISE_SPEED`. `trimTop` is capped at the cruise so that a rig
     * with a large move-speed bonus cannot trim the ship to a standstill by
     * exceeding it.
     */
    const trimTop = Math.min(CRUISE_SPEED, TRIM_SPEED * (this.focused ? PLAYER_FOCUS_SPEED / PLAYER_SPEED : 1) * boost * moveScale);
    // Plus the settle back to station. Added to the TARGET rather than applied
    // as a separate impulse, so it goes through the same damping the stick does
    // and cannot fight the acceleration curve. See `RECENTRE_SPEED`.
    const settle = clamp((bounds.yHome - this.y) / RECENTRE_SPAN, -1, 1) * RECENTRE_SPEED;
    const wantY = -CRUISE_SPEED + input.y * trimTop + settle;
    const halflife = this.focused ? FOCUS_HALFLIFE : push > 0.01 ? ACCEL_HALFLIFE : BRAKE_HALFLIFE;
    this.vx = damp(this.vx, wantX, halflife, dt);
    this.vy = damp(this.vy, wantY, halflife, dt);

    const nx = clamp(this.x + this.vx * dt, bounds.x0, bounds.x1);
    const ny = clamp(this.y + this.vy * dt, bounds.y0, bounds.y1);
    /*
     * Kill the velocity component the WALL just ate, so the ship does not sit
     * there pressing into it with 430px/s of stored energy and then launch when
     * it turns away.
     *
     * ACROSS THE TRACK ONLY, and the asymmetry is a bug that shipped for a
     * revision before anyone drove into it. `bounds.y1` is the back of the
     * TRACK WINDOW and it is MOVING — it advances by `CRUISE_SPEED * dt` every
     * step. So a ship resting against it is overtaken by its own bound every
     * frame, the clamp fires every frame, and zeroing `vy` every frame meant
     * the velocity could never build past the ~3px a step the window had just
     * gained. Measured in the browser: the ship pinned at 0.556 of the view
     * with `vy` exactly 0, holding forward for two and a half seconds, going
     * nowhere. The back of the frame was a trap you could enter and not leave.
     *
     * Not zeroing it is also the physically right answer rather than a
     * workaround. A static wall takes the ship's momentum; a moving floor
     * CARRIES it, and the ship's velocity against the world is still whatever
     * the stick is asking for. Leaving `vy` alone lets it damp toward its
     * target as normal, so the ship peels off the back edge the instant its own
     * speed exceeds the window's — about a frame after the stick moves — and is
     * carried at exactly the window's rate until then.
     */
    if (nx !== this.x + this.vx * dt) this.vx = 0;
    this.x = nx;
    this.y = ny;

    /*
     * Turn toward the stick, and only toward the stick.
     *
     * Deliberately the INPUT direction and not the velocity direction. Velocity
     * lags by design, so aiming off it would mean the nose lags the intent by
     * the acceleration time on top of the turn rate, and reversing direction
     * would swing the nose through the old heading first. What the player means
     * is what they are pressing.
     *
     * AND ON A TREADMILL IT MUST BE THE INPUT, not merely should be. For one
     * revision this read `atan2(wantY, wantX)` — the velocity TARGET, which
     * carries `CRUISE_SPEED` on the y axis whatever the player is doing. The
     * worst case of that expression is `atan2(-(CRUISE - TRIM), ±PLAYER_SPEED)`,
     * so the nose was confined to a forward arc and the ship could not be
     * pointed at anything behind it. `arc` and `beam` take a strict cone off
     * the facing (`World.computeAim`), and the whole pursuit is behind, so two
     * of the six weapon shapes could not be aimed at the fight. Reported from
     * play in four words: "i cant shoot backwards now".
     *
     * `input.y` is a throttle for MOVEMENT and a heading for AIM at the same
     * time, and that is the design rather than a compromise: pressing back
     * turns the ship to face the pursuit and drops it back through the frame
     * toward them, which is one gesture meaning one thing.
     */
    if (push > FACING_DEADZONE) {
      const want = Math.atan2(input.y, input.x);
      const rate = (this.focused ? TURN_RATE_FOCUSED : TURN_RATE) * dt;
      const delta = angleDelta(this.facing, want);
      this.facing += clamp(delta, -rate, rate);
    }
    this.facingX = Math.cos(this.facing);
    this.facingY = Math.sin(this.facing);
    // Damped in delta space so it can never take the long way round the circle.
    this.facingSettled += angleDelta(this.facingSettled, this.facing) * (1 - Math.pow(2, -dt / 0.12));

    // Bank on the sideways component of travel, relative to where we point.
    const cross = (this.vx * this.facingY - this.vy * this.facingX) / Math.max(1, top);
    this.bank = damp(this.bank, clamp(cross, -1, 1), 0.08, dt);
    this.ringPhase = (this.ringPhase + dt * (this.focused ? 2.4 : 0.8)) % TAU;

    if (this.invuln > 0) this.invuln -= dt;
    this.timeSinceHit += dt;

    // Graze rate is a one-second sliding average, smoothed enough that a single
    // lucky dodge does not spike the music.
    this.grazeRate += (this.grazeAccum / Math.max(dt, 1e-4) - this.grazeRate) * Math.min(1, dt * 3);
    this.grazeAccum = 0;

    this.syncDrones(dt);

    return this.tickPowerups(dt);
  }

  /**
   * A pod eats one bullet, then goes dark for four seconds.
   *
   * Four, hardcoded, at every level — which makes DRONE PODS' L6 step, "pods
   * come back from an absorb twice as quickly", half a lie. That step is
   * `mul: { linger: 0.5, damage: 1.15 }`: the damage half lands, and the
   * `linger` half has no reader, because `firePods` and the dispatcher's orbit
   * block between them read only `count`, `area`, `speed`, `pierce`, `range`
   * and `damage`. CHORALE's `linger: 1` is unread for the same reason.
   *
   * The world would have to pass the instrument's folded `linger` in for the
   * note to come true, and the pod is the one object the player owns that is
   * both a gun and a shield, so halving its downtime is a real balance move.
   * Left as it is, and written down.
   */
  absorbWithDrone(i: number): void {
    this.droneCooldown[i] = 4;
  }

  countGraze(): void {
    this.grazeTotal++;
    this.grazeAccum++;
  }

  /**
   * Returns true if the hit actually landed (i.e. not invulnerable).
   *
   * `autoBomb` reports that the hit was survived by spending a bomb instead of
   * a life — the caller is responsible for the explosion. It only fires on the
   * LAST life: it used to fire whenever shields were about to break with a bomb
   * in reserve, which made it a routine refund rather than a save.
   */
  lastHitAutoBombed = false;

  /**
   * `blockAutoBomb` exists for one caller: `World`, when the ship has been
   * camping. The branch below was written to fire "on the LAST life" so it
   * would read as "a save rather than a routine refund" — see its own
   * comment — but bomb income (extends plus the 55%-of-the-pool BOMB drop)
   * outruns the drain at one life, so once a ship is pinned there the save
   * repeats every time and stops being exceptional. Blocking it only when
   * camping — never for a ship that is actually moving — is what keeps it a
   * save rather than removing it.
   */
  takeHit(blockAutoBomb = false): boolean {
    if (this.invuln > 0 || this.dead) return false;
    this.lastHitAutoBombed = false;
    this.lastHitGuarded = false;
    /*
     * A GUARD CHARGE IS SPENT FIRST — before the WARD powerup and before the
     * auto-bomb rescue, and the order is the design rather than convenience.
     *
     * A charge refills on its own clock and costs the player nothing; a WARD
     * is a pickup they found and an auto-bomb costs a bomb. Spending the free
     * thing before the paid ones is what a player would do by hand, and doing
     * it in the other order would make DAMPER worse the more the player was
     * already carrying — an item that punishes you for having found something
     * else.
     *
     * The invulnerability is the ordinary one plus whatever the weapon's
     * `linger` bought, so the ladder rung that promises "a second and a half
     * of invulnerability on top" is this line and not a blurb.
     */
    if (this.guard > 0) {
      this.guard--;
      this.lastHitGuarded = true;
      this.timeSinceHit = 0;
      this.invuln = INVULN_ON_HIT + Math.max(0, this.guardBonusInvuln);
      return true;
    }
    /*
     * WARD absorbs the hit and is spent doing it.
     *
     * Checked before the auto-bomb rescue on purpose: the rescue is the last
     * resort and costs a bomb, so anything the player is already carrying
     * should be spent first. It routes through `evicted` rather than emitting
     * anything itself because `Player` has no bus — the world drains that
     * array every step and turns it into `powerup:expire`, which is what tells
     * the director to take the pad back out of the mix.
     */
    if (this.powerups.ward) {
      delete this.powerups.ward;
      delete this.powerTimers.ward;
      this.held = this.held.filter((k) => k !== 'ward');
      this.evicted.push('ward');
      this.timeSinceHit = 0;
      this.invuln = INVULN_ON_HIT;
      return true;
    }
    if (!blockAutoBomb && this.hp <= 1 && this.bombs > 0 && this.lives <= 1) {
      this.bombs--;
      this.hp = this.maxHp;
      this.invuln = INVULN_ON_HIT;
      this.timeSinceHit = 0;
      this.lastHitAutoBombed = true;
      return true;
    }
    this.hp -= 1;
    this.timeSinceHit = 0;
    this.invuln = INVULN_ON_HIT;
    if (this.hp <= 0) {
      this.lives -= 1;
      if (this.lives <= 0) {
        this.dead = true;
      } else {
        this.hp = this.maxHp;
        this.invuln = INVULN_ON_HIT * 1.5;
      }
    }
    return true;
  }
}
