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

/** Below this the stick is noise and the facing is left exactly where it was. */
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
    bounds: { w: number; h: number },
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
    const wantY = input.y * top;
    const halflife = this.focused ? FOCUS_HALFLIFE : push > 0.01 ? ACCEL_HALFLIFE : BRAKE_HALFLIFE;
    this.vx = damp(this.vx, wantX, halflife, dt);
    this.vy = damp(this.vy, wantY, halflife, dt);

    const nx = clamp(this.x + this.vx * dt, 12, bounds.w - 12);
    const ny = clamp(this.y + this.vy * dt, 12, bounds.h - 12);
    // Kill the velocity component that the wall just ate, so the ship does not
    // sit there pressing into a wall with 430px/s of stored energy and then
    // launch when it turns away.
    if (nx !== this.x + this.vx * dt) this.vx = 0;
    if (ny !== this.y + this.vy * dt) this.vy = 0;
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
