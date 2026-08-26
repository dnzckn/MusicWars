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
  /** Has already awarded a graze; do not award again. */
  Grazed: 1 << 1,
  /** Turns into score items on a bomb instead of vanishing. */
  Cancellable: 1 << 2,
  /** Ignores the bomb clear (boss lasers, etc). */
  Indestructible: 1 << 3,
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
}

export class BulletPool {
  readonly capacity: number;
  count = 0;

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
  ): void {
    const { x, y, px, py, speed, angle, accel, turn, minSpeed, maxSpeed, ttl, age, flags, bounces } = this;
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
        }
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
