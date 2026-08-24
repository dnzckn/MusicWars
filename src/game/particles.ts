/** Purely cosmetic particle pool. Same SoA/swap-remove shape as the bullet pool. */

import { TAU } from '../core/math';
import type { Rng } from '../core/rng';

/* `as const` rather than `const enum` — see the note on `BulletFlag` in
 * `bullets.ts`. Unlike the flags, these are mutually exclusive and never
 * combined, so the union type below is the accurate one and is used to type
 * `emit`'s parameter. */
export const ParticleShape = {
  Spark: 0,
  Dot: 1,
  Ring: 2,
  Shard: 3,
} as const;

export type ParticleShape = (typeof ParticleShape)[keyof typeof ParticleShape];

export class ParticlePool {
  readonly capacity: number;
  count = 0;

  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly drag: Float32Array;
  readonly hue: Float32Array;
  readonly shape: Uint8Array;
  /** Emissions refused because the pool was full. Watched by tooling. */
  dropped = 0;

  constructor(capacity = 2400) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.hue = new Float32Array(capacity);
    this.shape = new Uint8Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  emit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    hue: number,
    shape: ParticleShape = ParticleShape.Spark,
    drag = 2.2,
    spin = 0,
  ): void {
    // Cosmetic only: when saturated, drop the newest rather than stealing a slot.
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.rot[i] = 0;
    this.spin[i] = spin;
    this.drag[i] = drag;
    this.hue[i] = hue;
    this.shape[i] = shape;
  }

  burst(rng: Rng, x: number, y: number, n: number, speed: number, hue: number, life = 0.5, size = 3): void {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU);
      const s = speed * rng.range(0.35, 1);
      this.emit(
        x,
        y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        life * rng.range(0.6, 1.25),
        size * rng.range(0.6, 1.3),
        hue + rng.range(-14, 14),
        ParticleShape.Spark,
        2.4,
        rng.range(-9, 9),
      );
    }
  }

  ring(x: number, y: number, size: number, hue: number, life = 0.35): void {
    this.emit(x, y, 0, 0, life, size, hue, ParticleShape.Ring, 0, 0);
  }

  update(dt: number): void {
    const { x, y, vx, vy, life, drag, rot, spin } = this;
    for (let i = this.count - 1; i >= 0; i--) {
      if ((life[i] -= dt) <= 0) {
        this.removeAt(i);
        continue;
      }
      const d = Math.max(0, 1 - drag[i] * dt);
      vx[i] *= d;
      vy[i] *= d;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      rot[i] += spin[i] * dt;
    }
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.rot[i] = this.rot[last];
    this.spin[i] = this.spin[last];
    this.drag[i] = this.drag[last];
    this.hue[i] = this.hue[last];
    this.shape[i] = this.shape[last];
  }
}
