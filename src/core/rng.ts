/**
 * Deterministic PRNG (mulberry32). Bullet patterns must replay identically for a
 * given seed so a run can be reproduced when debugging a "that was unfair" moment.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0,1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [lo,hi). */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  /** Integer in [lo,hi). */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }
}

/*
 * There is deliberately NO shared `rng` instance exported here.
 *
 * There used to be — `export const rng = new Rng(Date.now() & 0xffffffff)` —
 * and nothing imported it. Every caller correctly makes its own: `World` owns
 * one seeded from its `seed` argument, `waves.ts` derives one per wave index
 * (`0x5eed ^ index * 0x9e3779b9`), and `particles.ts` takes one as a
 * parameter. So it was dead, but it was dead code of the worst kind: the
 * obvious thing to reach for, seeded from the wall clock, sitting one import
 * away from silently making a run unreproducible.
 *
 * That would have broken the promise at the top of this file. It is not a
 * decorative one — the same seed is verified to give an identical state hash
 * across separate processes at 120s and 300s of simulation, and every
 * gameplay measurement in `tools/` depends on it holding. Take an `Rng` as a
 * parameter or construct one from a seed you control.
 */
