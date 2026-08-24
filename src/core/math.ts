/** Small math helpers shared by the simulation, the renderer and the music director. */

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const inverseLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));

/** Remap `v` from [inLo,inHi] into [outLo,outHi], clamped. */
export function remap(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  return lerp(outLo, outHi, clamp01(inverseLerp(inLo, inHi, v)));
}

/**
 * Frame-rate independent lerp. `halflife` is the time in seconds for the value
 * to close half the remaining distance, so behaviour is identical at 30 or 144fps.
 */
export function damp(current: number, target: number, halflife: number, dt: number): number {
  if (halflife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halflife);
}


export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
};


/**
 * A latch with separate rise and fall thresholds.
 *
 * Any boolean derived from a continuous value needs one of these. Without the
 * gap, a value resting near the threshold toggles every time it is sampled: the
 * melody's octave flipped 14 times in 18 seconds with the ship parked at
 * mid-field, which is a jump an octave wide roughly once a second.
 *
 * The stem levels learned this early on and then it was reintroduced twice in
 * new code, so it lives here now rather than being re-derived each time.
 */
/*
 * Fields are declared and assigned explicitly rather than written as TypeScript
 * parameter properties (`constructor(private riseAt: number)`).
 *
 * Parameter properties are the one common TS feature that Node's strip-only
 * type stripping REJECTS outright, because erasing the annotation is not
 * enough — the feature emits an assignment, so there is nothing to strip down
 * to. Everything in this project's headless verification story (`session`,
 * `wiring`, `motorcheck`, `leadcheck`, `masking`, `render`) loads the real
 * source through that stripper, with no build step in between. One parameter
 * property anywhere in the reachable graph takes all of it out at once, which
 * is exactly what happened: `session` died on this file with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
 *
 * `npm run syntax` now fails on non-erasable syntax in any headless-reachable
 * file, so this does not have to be remembered.
 */
export class Latch {
  private on: boolean;
  private readonly riseAt: number;
  private readonly fallAt: number;

  constructor(riseAt: number, fallAt: number, initial = false) {
    this.riseAt = riseAt;
    this.fallAt = fallAt;
    this.on = initial;
  }

  update(value: number): boolean {
    if (!this.on && value >= this.riseAt) this.on = true;
    else if (this.on && value < this.fallAt) this.on = false;
    return this.on;
  }

  get value(): boolean {
    return this.on;
  }

  reset(initial = false): void {
    this.on = initial;
  }
}

/**
 * `Math.round(v * steps)` with hysteresis.
 *
 * The same problem `Latch` solves, one dimension up. The music director's
 * rebuild key quantises intensity, brightness and health into buckets, and a
 * value resting on a bucket boundary flips every frame — which rewrites all
 * eight bars of all eleven stems each time. Measured, the arrangement was being
 * rebuilt about twenty times per eight-bar phrase at high waves, which is both
 * a frame cost and exactly the shape of music that sounds choppy: patterns
 * replaced faster than they can be heard.
 *
 * `margin` is a fraction of one step, so 0.35 means a value must clear the
 * boundary by a third of a bucket before the bucket changes.
 */
export class StickyBucket {
  private level: number;
  private readonly steps: number;
  /** See the note on `Latch` for why these are not parameter properties. */
  private readonly margin: number;

  constructor(steps: number, margin = 0.35, initial = 0) {
    this.steps = steps;
    this.margin = margin;
    this.level = initial;
  }

  update(v01: number): number {
    const raw = clamp01(v01) * this.steps;
    if (raw > this.level + 0.5 + this.margin || raw < this.level - 0.5 - this.margin) {
      this.level = Math.round(raw);
    }
    return this.level;
  }

  get value(): number {
    return this.level;
  }

  reset(initial = 0): void {
    this.level = initial;
  }
}
