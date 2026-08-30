/**
 * Bullet storage.
 *
 * Structure-of-arrays over typed arrays with a dense active prefix and
 * swap-remove. Nothing outside a single frame holds a bullet index, so the
 * shuffling that swap-remove causes is invisible and we get to keep the update
 * loop as one linear pass over contiguous memory.
 *
 * Motion is stored in polar form (speed + angle + their derivatives) rather
 * than as a velocity vector, because almost every danmaku pattern is expressed
 * as "fire at angle A, accelerating, turning N degrees per second". Cartesian
 * velocity would force every emitter to re-derive that each frame.
 */

import { TAU } from '../core/math';

/*
 * An `as const` object rather than a `const enum`.
 *
 * A `const enum` is not erasable syntax: the compiler deletes the declaration
 * and inlines each member at its use sites, so there is nothing left to strip
 * and Node's type stripping rejects the file outright. Every headless tool in
 * `tools/` loads this module through that stripper — `wiring` and `session`
 * both reach it via `world.ts` — so the enum would have taken the whole
 * verification suite down the moment either tool touched it.
 *
 * Call sites are unchanged (`BulletFlag.Grazed` still reads the same) and the
 * stored type is unchanged too: `flags` is a `Uint8Array` and `BulletSpawn.
 * flags` is a plain `number`, because these OR together and a union of the
 * individual literals could not express `DespawnOffscreen | Cancellable`.
 */
export const BulletFlag = {
  None: 0,
  /** Removed when it leaves the playfield rather than clamped/reflected. */
  DespawnOffscreen: 1 << 0,
  /*
   * BITS 1, 2 AND 3 ARE FREE, and what used to be in them is worth recording.
   *
   * `Grazed` (1) latched the graze award per bullet, `Cancellable` (2) marked
   * a bullet a bomb turned into score, and `Indestructible` (3) exempted boss
   * lasers from that clear. All three described ENEMY bullets and there are no
   * enemy bullets — the pool, the emitters and the archetype tables are gone.
   * The graze latch now lives on the enemy (`Enemy.grazed`, and it has to be
   * released as well as set, because a body can pass you twice); the clear
   * became a knockback (`World.repel`), which nothing is exempt from.
   *
   * Left as a gap rather than renumbered: this is a `Uint8Array` with all eight
   * bits spoken for below, the remaining five are load-bearing on the PLAYER
   * pool, and renumbering them to close a hole would rewrite five live
   * constants to save nothing.
   */
  /**
   * Player bolt that steers toward the nearest enemy every frame.
   *
   * PER BULLET, and it used to be global. `Modifiers.homing` was a 0..1 field
   * whose only consumer tested it for `> 0` and then turned every player bullet
   * at a hardcoded 6 rad/s — so the passive's three levels steered identically
   * and the strength was never read at all. A shot now either seeks or does
   * not, and the rule that spawned it decides: LASER's overcharged volley and
   * HOMING's kill echo both set this, and nothing else does.
   */
  Seeking: 1 << 4,
  /**
   * A bolt re-fired by HOMING's kill echo.
   *
   * Exists purely so an echo cannot echo. Without it a shot into a dense pack
   * chains one kill into the next for as long as the pack lasts, and the worst
   * case stops being "one extra bullet per kill" and becomes the pool.
   */
  Echo: 1 << 5,
  /**
   * An autonomous ally — the `spawn` shape's hunter. See `World.fireSpawn`.
   *
   * It rides in the player pool because a summon is a thing at a position with
   * a heading and a lifetime, which is what this pool is, and adding a
   * fourteenth array of loose objects for twelve of them would be a container
   * per shape — the cost model `docs/research-weapons.md` §D.10 exists to
   * refuse. It collides and is consumed exactly as any other non-piercing bolt
   * is; what the flag buys is the two places a summon is NOT an ordinary bolt.
   * `World.updateSummons` drives it — steering it at the target held in
   * `target` below rather than letting it fly straight — and `World.fireSpawn`
   * counts the live population off it to decide how many more to send, which is
   * what makes `count` a retinue size instead of a volley.
   */
  Summon: 1 << 6,
  /**
   * BIT 7, WHICH WAS FREE AND IS NOW THE BOOMERANG. Vampire Survivors' Cross:
   * "aims at the nearest enemy, has boomerang effect".
   *
   * IT REVERSES ONCE, AT THE MIDPOINT OF ITS OWN LIFE, and the whole trick is
   * that this needs no new column. At spawn `age` is 0 and `ttl` is T; `age`
   * counts up while `ttl` counts down, so `age >= ttl` is true for the first
   * time at exactly T/2. The bolt therefore turns around at the halfway mark
   * and retraces its own outbound path, arriving back where it was thrown
   * from as its lifetime runs out. The flag is CLEARED on the turn, which is
   * the latch — without it the test stays true for the whole second half and
   * the bolt would flip every step and stand still.
   *
   * DECELERATION WAS THE OBVIOUS IMPLEMENTATION AND IT IS WRONG. A negative
   * `accel` with `minSpeed = -speed` also returns a bolt along its own line
   * and costs nothing at all — but the speed passes through ZERO at the apex,
   * and a piercing bolt parked on a body deals its damage on every one of the
   * 120 steps a second it spends there. An instant reversal has no dwell: the
   * bolt is travelling at full speed on both passes and stationary on none.
   *
   * COST is one AND against a `Uint8Array` per bullet per step, on the same
   * line the `DespawnOffscreen` test already occupies.
   *
   * `BulletPool.flags` is a `Uint8Array` and this is the eighth and last bit.
   * A ninth would need it widened to `Uint16Array` — cheap, but not something
   * to discover by watching a flag silently truncate to zero.
   */
  Returning: 1 << 7,
} as const;

export interface BulletSpawn {
  x: number;
  y: number;
  angle: number;
  speed: number;
  /** Change in speed per second. */
  accel?: number;
  /** Change in angle per second, radians. Positive = clockwise on screen. */
  turn?: number;
  minSpeed?: number;
  maxSpeed?: number;
  radius?: number;
  /** Visual/behaviour type index into the sprite table. */
  type?: number;
  ttl?: number;
  flags?: number;
  /** Damage dealt on contact (player bullets). */
  damage?: number;
  /**
   * Wall reflections before the bullet stops reflecting. 0 is the old
   * behaviour: leave the arena and be culled.
   *
   * Only meaningful when the caller passes `walls` to `update`, which today is
   * the player pool alone — enemy fire has never wanted to come back.
   */
  bounces?: number;
  /**
   * Index into `World.propSets` — WHICH PROPERTY SET THIS BOLT CARRIES.
   *
   * ONE BYTE PER BULLET, AND THAT IS THE WHOLE COST OF THE SUBSTRATE ON THE
   * HOT PATH. A property set is a 28-field record; storing one per bullet, or
   * a reference to one, would put an object pointer in a structure-of-arrays
   * whose entire reason for existing is that it holds no objects. Interning
   * instead — the world keeps at most 255 distinct sets and hands out indices
   * — means the collision loop reads a `Uint8Array` and one array lookup, and
   * `remove`'s swap moves a byte.
   *
   * 0 is the empty set (`noProps()`), which every bullet not fired by an
   * instrument carries. That is what makes `tools/propfire.mjs`' control run
   * meaningful: with no property installed every bolt in the game is index 0
   * and every counter must read zero.
   */
  src?: number;
  /** Splits this bolt has left (Ball x Pit Cell). Counts down at each hit. */
  splits?: number;
  /**
   * The lowest this bolt's damage may erode to (Ball x Pit Stone), in absolute
   * damage rather than as a fraction.
   *
   * Absolute because by the time a bolt is eroding, what it left with is gone —
   * `damage` has already been multiplied down. Storing the floor at spawn is
   * one `Float32Array` column; storing the original and re-deriving the floor
   * every hit would be the same column with an extra multiply.
   */
  dmgFloor?: number;
}

export class BulletPool {
  readonly capacity: number;
  count = 0;

  /**
   * Move every live bolt along the travel axis by `dy`, forward being -y.
   *
   * The pool rides the treadmill with the rest of the world; see
   * `World.carryStage`. Without it a bolt fired astern would be crossing the
   * ground at its own speed MINUS the stage's, so every range, every lifetime
   * and every bounce in `weapons.ts` would mean something different depending
   * on which way the ship was pointing.
   *
   * A flat pass over `count` and not `capacity`: dead slots are compacted to
   * the end by `update`, so there is nothing above `count` to move.
   */
  carry(dy: number): void {
    const y = this.y;
    for (let i = 0; i < this.count; i++) y[i] -= dy;
  }

  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Previous-step position, used for render interpolation and swept collision. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly speed: Float32Array;
  readonly angle: Float32Array;
  readonly accel: Float32Array;
  readonly turn: Float32Array;
  readonly minSpeed: Float32Array;
  readonly maxSpeed: Float32Array;
  readonly radius: Float32Array;
  readonly ttl: Float32Array;
  readonly age: Float32Array;
  readonly damage: Float32Array;
  readonly type: Uint8Array;
  readonly flags: Uint8Array;
  /** Wall reflections REMAINING. Counts down; 0 means the next wall is the end. */
  readonly bounces: Uint8Array;
  /** Property-set index. See `BulletSpawn.src`. */
  readonly src: Uint8Array;
  /** Splits remaining. See `BulletSpawn.splits`. */
  readonly splits: Uint8Array;
  /** Damage floor for an eroding bolt. See `BulletSpawn.dmgFloor`. */
  readonly dmgFloor: Float32Array;
  /**
   * `spawn` only: the index into `World.enemies` this summon is hunting, or -1.
   *
   * THE ONE PIECE OF NEW MACHINERY IN THE WHOLE NINE-SHAPE CATALOGUE, and
   * `docs/research-weapons.md` §D.9 named it in advance: "one `Int16Array`
   * target index on `BulletPool` so a summon keeps its target between frames
   * instead of re-picking."
   *
   * Keeping the target is the difference between a summon and a homing bolt.
   * `World.steerPlayerBullets` re-picks the nearest enemy every frame, which is
   * correct for a bolt thrown a moment ago and wrong for an ally: an ally that
   * re-picks flips between two shapes it is equidistant from and oscillates
   * instead of committing. It commits here, and only re-picks when the thing it
   * committed to is gone.
   *
   * Int16 because the enemy list is tens of entries and -1 has to be
   * representable; a Uint8Array could hold neither the sentinel nor a boss
   * fight's index range honestly. It is swapped by `remove` alongside every
   * other column — a stale index surviving a swap-remove would point a summon
   * at whatever enemy happened to inherit the slot.
   */
  readonly target: Int16Array;

  /** Bullets dropped this step because the pool was full, for the debug overlay. */
  overflow = 0;
  /** Monotonic spawn count. Never decreases, so tooling can detect real volleys. */
  spawned = 0;
  /**
   * Monotonic reflection count, for the same reason `spawned` exists.
   *
   * `bounces` was a declared stat with no consumer for the whole life of the
   * instrument table, and the thing that let it stay that way is that nothing
   * could observe whether a bolt had ever bounced. A counter makes the feature
   * falsifiable from a headless harness rather than from watching the screen.
   */
  bounced = 0;
  /**
   * Monotonic count of bolts that reached the turn of their arc and came back.
   *
   * The same argument as `bounced`, made once already in this file and worth
   * making again: `bounces` was a declared stat with no consumer for the whole
   * life of the instrument table precisely because nothing could observe
   * whether a bolt had ever bounced. A boomerang that never returns passes
   * every existing gate silently — it deals its outbound damage, it type
   * checks, its card renders — so the return needs a counter or it will rot
   * exactly as `bounces` did. `tools/propfire.mjs`' DELIVERIES section reads
   * this against `spawned` as its denominator.
   */
  returned = 0;
  /**
   * Monotonic count of reflections that ACCELERATED the bolt, for the same
   * reason `bounced` exists. `tools/propfire.mjs` reads it as the fire count
   * for the `accel` property, against `bounced` as its denominator — a
   * property whose whole content is "the bounce is different" cannot be
   * measured any other way.
   */
  accelerated = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.angle = new Float32Array(capacity);
    this.accel = new Float32Array(capacity);
    this.turn = new Float32Array(capacity);
    this.minSpeed = new Float32Array(capacity);
    this.maxSpeed = new Float32Array(capacity);
    this.radius = new Float32Array(capacity);
    this.ttl = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.damage = new Float32Array(capacity);
    this.type = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.bounces = new Uint8Array(capacity);
    this.src = new Uint8Array(capacity);
    this.splits = new Uint8Array(capacity);
    this.dmgFloor = new Float32Array(capacity);
    this.target = new Int16Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  /** Returns the new bullet's index, or -1 when the pool is saturated. */
  spawn(s: BulletSpawn): number {
    if (this.count >= this.capacity) {
      this.overflow++;
      return -1;
    }
    const i = this.count++;
    this.spawned++;
    this.x[i] = s.x;
    this.y[i] = s.y;
    this.px[i] = s.x;
    this.py[i] = s.y;
    this.speed[i] = s.speed;
    this.angle[i] = s.angle;
    this.accel[i] = s.accel ?? 0;
    this.turn[i] = s.turn ?? 0;
    this.minSpeed[i] = s.minSpeed ?? -Infinity;
    this.maxSpeed[i] = s.maxSpeed ?? Infinity;
    this.radius[i] = s.radius ?? 4;
    this.ttl[i] = s.ttl ?? 9;
    this.age[i] = 0;
    this.damage[i] = s.damage ?? 1;
    this.type[i] = s.type ?? 0;
    this.flags[i] = s.flags ?? BulletFlag.DespawnOffscreen;
    // Clamped rather than trusted: the stat is folded out of a table of adds
    // and multipliers, and a Uint8Array would wrap a negative or an overflow
    // into a large positive count rather than failing.
    this.bounces[i] = Math.max(0, Math.min(255, Math.round(s.bounces ?? 0)));
    this.src[i] = s.src ?? 0;
    this.splits[i] = Math.max(0, Math.min(255, Math.round(s.splits ?? 0)));
    this.dmgFloor[i] = s.dmgFloor ?? 0;
    // Every spawn starts unlocked; only `World.updateSummons` ever sets it.
    this.target[i] = -1;
    return i;
  }

  /** Swap-remove. Safe to call while iterating downward, or upward if you re-test `i`. */
  remove(i: number): void {
    // A caller iterating downward can have its index invalidated underneath it
    // if something else clears the pool mid-loop (a bomb, a player death).
    // Silently ignoring the stale index is much better than letting `count` go
    // negative, which corrupts every subsequent frame.
    if (i < 0 || i >= this.count) return;
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.px[i] = this.px[last];
      this.py[i] = this.py[last];
      this.speed[i] = this.speed[last];
      this.angle[i] = this.angle[last];
      this.accel[i] = this.accel[last];
      this.turn[i] = this.turn[last];
      this.minSpeed[i] = this.minSpeed[last];
      this.maxSpeed[i] = this.maxSpeed[last];
      this.radius[i] = this.radius[last];
      this.ttl[i] = this.ttl[last];
      this.age[i] = this.age[last];
      this.damage[i] = this.damage[last];
      this.type[i] = this.type[last];
      this.flags[i] = this.flags[last];
      this.bounces[i] = this.bounces[last];
      this.src[i] = this.src[last];
      this.splits[i] = this.splits[last];
      this.dmgFloor[i] = this.dmgFloor[last];
      this.target[i] = this.target[last];
    }
  }

  /**
   * Integrate one fixed step and cull. `bounds` is the playfield with a margin
   * already applied by the caller.
   *
   * `walls` is the rectangle bullets with `bounces` left REFLECT off, and it is
   * deliberately a different rectangle from the cull bounds. The cull margin is
   * 60px outside the field so a shot has somewhere to die; a bounce has to
   * happen at the wall the player can see, or a bolt would visibly leave the
   * arena and reappear. Omitted by the enemy pool, which has never wanted its
   * fire to come back.
   */
  update(
    dt: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    walls?: { l: number; t: number; r: number; b: number },
    /*
     * ACCELERANDO lives here: fractional speed gained per wall, indexed by the
     * bolt's property set.
     *
     * A lookup table rather than a callback, and rather than a per-bullet
     * `Float32Array`. A callback would allocate a closure per frame at the one
     * call site and put a function call inside the tightest loop in the game;
     * a per-bullet column would cost four bytes a bullet to store a number
     * that is a property of the WEAPON. This is one array index on the branch
     * that already fired, and bounces are rare — a full run reflects about
     * 1,600 times against 400,000 steps.
     */
    accelBySrc?: Float32Array,
  ): void {
    const { x, y, px, py, speed, angle, accel, turn, minSpeed, maxSpeed, ttl, age, flags, bounces, src } = this;
    for (let i = this.count - 1; i >= 0; i--) {
      px[i] = x[i];
      py[i] = y[i];

      let sp = speed[i] + accel[i] * dt;
      if (sp < minSpeed[i]) sp = minSpeed[i];
      else if (sp > maxSpeed[i]) sp = maxSpeed[i];
      speed[i] = sp;

      let a = angle[i] + turn[i] * dt;
      angle[i] = a;

      x[i] += Math.cos(a) * sp * dt;
      y[i] += Math.sin(a) * sp * dt;

      /*
       * Reflect, then clamp back onto the wall.
       *
       * Motion is polar here, so a reflection is one angle identity rather than
       * a velocity negation: a vertical wall maps `a` to `PI - a` and a
       * horizontal one maps it to `-a`. Doing it in angle space is what makes
       * this compose with `turn` — a bolt that is curving keeps curving after
       * it comes off the wall, which is what CANON's eight bounces are for.
       *
       * The outward-velocity test is not redundant with the position test. A
       * bolt can legitimately be spawned outside the wall rectangle (a pod
       * sitting on the far side of a ship pressed against the edge), and
       * without it such a bolt would be turned around and fired back into the
       * arena instead of leaving. Today no orbit instrument carries bounces, so
       * this is a guard rather than a live case, and it costs one comparison.
       *
       * Both axes are tested in the same step rather than one-per-step: a shot
       * into a corner hits two walls in the same frame, and handling one would
       * leave it travelling along the outside of the other until the cull
       * margin ate it — a bolt that visibly grazes the corner and vanishes.
       * A corner counts as one bounce, not two; two would make corners quietly
       * twice as expensive and CANON's count is a budget the player can see.
       */
      if (walls !== undefined && bounces[i] > 0) {
        let hit = false;
        if (x[i] < walls.l && Math.cos(a) < 0) {
          x[i] = walls.l;
          a = Math.PI - a;
          hit = true;
        } else if (x[i] > walls.r && Math.cos(a) > 0) {
          x[i] = walls.r;
          a = Math.PI - a;
          hit = true;
        }
        if (y[i] < walls.t && Math.sin(a) < 0) {
          y[i] = walls.t;
          a = -a;
          hit = true;
        } else if (y[i] > walls.b && Math.sin(a) > 0) {
          y[i] = walls.b;
          a = -a;
          hit = true;
        }
        if (hit) {
          angle[i] = a;
          bounces[i]--;
          this.bounced++;
          if (accelBySrc !== undefined) {
            const gain = accelBySrc[src[i]];
            if (gain > 0) {
              speed[i] *= 1 + gain;
              /*
               * AND IT VISIBLY GROWS. A speed change is the hardest property in
               * the roster to see — screenshotted in a real browser at wave 15,
               * an ACCELERANDO bolt on its sixth wall was pixel-identical to one
               * that had never touched a wall, so the weapon's entire identity
               * ("every wall makes it faster, and it keeps them") was a number
               * in a log. A bolt that swells as it winds up is the cheapest
               * honest readout of that, and it makes the hitbox agree with what
               * the player is looking at rather than only with the stat.
               */
              this.radius[i] = Math.min(11, this.radius[i] * 1.07);
              this.accelerated++;
            }
          }
        }
      }

      /*
       * THE BOOMERANG TURNS HERE, before the age/ttl update rather than after,
       * so the crossing is tested against the values this step was integrated
       * with. See `BulletFlag.Returning`: `age >= ttl` is first true at the
       * midpoint of the bolt's life, the flag is cleared so it can only happen
       * once, and the reversal is instant so there is no zero-speed apex for a
       * piercing bolt to sit on.
       */
      if (flags[i] & BulletFlag.Returning && age[i] >= ttl[i]) {
        flags[i] &= ~BulletFlag.Returning;
        angle[i] += Math.PI;
        /*
         * AND IT VISIBLY THICKENS ON THE WAY BACK, which is the same argument
         * `accelBySrc` makes four lines down with the sign the other way: a
         * blade on its return pass and one on its outbound pass are otherwise
         * pixel-identical, so "it comes back through everything" would be a
         * counter in a log rather than something the player can watch happen.
         * Screenshotted at wave 16 before this line, the field was a spray of
         * identical bolts.
         *
         * The hitbox grows with the picture rather than behind it, so what the
         * player is looking at is what they are hitting with.
         */
        this.radius[i] = Math.min(12, this.radius[i] * 1.45);
        this.returned++;
      }

      const t = (ttl[i] -= dt);
      age[i] += dt;

      if (t <= 0) {
        this.remove(i);
        continue;
      }
      if (flags[i] & BulletFlag.DespawnOffscreen) {
        const bx = x[i];
        const by = y[i];
        if (bx < left || bx > right || by < top || by > bottom) this.remove(i);
      }
    }
  }

  /** Wrap an angle into [0, TAU) for the whole pool. Only needed before serialising. */
  normaliseAngles(): void {
    for (let i = 0; i < this.count; i++) this.angle[i] = ((this.angle[i] % TAU) + TAU) % TAU;
  }
}
