/**
 * Declarative bullet-pattern emitters.
 *
 * A pattern is data, not code: an `EmitterSpec` says *what* the shape is and
 * the runtime turns it into bullets. That keeps wave scripting readable and,
 * more importantly, lets an emitter be retimed to the musical grid by changing
 * one field.
 */

import { TAU } from '../core/math';
import type { Rng } from '../core/rng';
import type { BulletPool, BulletSpawn } from './bullets';
import { BulletFlag } from './bullets';

export type EmitterShape =
  /** Even ring around the source. */
  | 'ring'
  /** Arc of `count` bullets centred on the aim angle. */
  | 'fan'
  /** One arm (or `arms`) that rotates a fixed step every shot. */
  | 'spiral'
  /** Single shot straight at the player. */
  | 'aimed'
  /** Randomly scattered inside `spread`. */
  | 'scatter'
  /** Bullets that start slow, stop, then accelerate outward. */
  | 'bloom';

export interface EmitterSpec {
  shape: EmitterShape;
  /** Bullets per volley. */
  count: number;
  /** Independent arms for spirals/rings. */
  arms?: number;
  /** Total arc width in radians for fan/scatter. */
  spread?: number;
  speed: number;
  /** Randomised extra speed per bullet, 0 = uniform. */
  speedJitter?: number;
  /** Speed added per bullet index, giving a "stream" look. */
  speedStep?: number;
  accel?: number;
  turn?: number;
  minSpeed?: number;
  maxSpeed?: number;
  /** Where the volley points. */
  aim?: 'player' | 'fixed' | 'down';
  /** Base angle for `fixed`, radians. */
  angle?: number;
  /** Radians added to the base angle every volley — the spiral's twist. */
  step?: number;
  /** Radians per second added continuously to the base angle. */
  spin?: number;
  /** Time between volleys, in *beats*. Set `seconds` instead to ignore tempo. */
  beats?: number;
  seconds?: number;
  /** Volleys per burst before `restBeats` of silence. Infinity for continuous. */
  burst?: number;
  restBeats?: number;
  /** Volleys before the emitter retires. Infinity by default. */
  total?: number;
  /** Beats to wait before the first volley. */
  delayBeats?: number;
  radius?: number;
  type?: number;
  ttl?: number;
  flags?: number;
  /** Muzzle offset along the aim angle. */
  offset?: number;
  /**
   * Fraction of a ring left open, 0..0.8.
   *
   * The single most important readability tool in danmaku. A full ring from a
   * centred boss has no solution the player can see; the same ring with a
   * rotating quarter missing is a puzzle with a visible answer — move to the
   * gap. Every boss ring in this game has one.
   */
  gap?: number;
}

type ResolvedSpec = EmitterSpec & typeof DEFAULTS;

const DEFAULTS = {
  arms: 1,
  spread: Math.PI / 3,
  speedJitter: 0,
  speedStep: 0,
  accel: 0,
  turn: 0,
  aim: 'player' as NonNullable<EmitterSpec['aim']>,
  angle: Math.PI / 2,
  step: 0,
  spin: 0,
  burst: Infinity,
  restBeats: 0,
  total: Infinity,
  delayBeats: 0,
  radius: 5,
  type: 0,
  ttl: 9,
  offset: 0,
  gap: 0,
};

export class Emitter {
  private spec: ResolvedSpec;
  /** Accumulated base rotation, in radians. */
  private phase = 0;
  private volleys = 0;
  private burstIndex = 0;
  /**
   * Absolute transport beat of the next volley, not a countdown.
   *
   * This used to accumulate its own beat count from `bpm * dt`, which drifted
   * away from the transport on every audio-clock correction and every frame of
   * hitstop — only ~55% of volleys were landing on a subdivision despite the
   * whole system being "scheduled in beats". Scheduling against the transport's
   * absolute position makes drift structurally impossible: a late frame, a
   * tempo change or a freeze can delay a volley, but never detune it.
   */
  private nextBeat = -1;
  private resting = false;
  finished = false;

  /** Extra offset applied when the emitter first arms itself. */
  private pendingDelay = 0;

  /**
   * How much sooner this emitter fires than its archetype says, as a musical
   * fraction. 1 is the written cadence; see `setUrgency`.
   */
  private urgency = 1;

  /**
   * Tighten this emitter's cadence, in MUSICAL steps only.
   *
   * Late waves were growing in the one dimension that adds clutter without
   * adding threat. Measured over three seeds, from the first quarter of a
   * 15-minute run to the last, the field goes from 3.4 enemies to 14.6 — more
   * than four times as many — while enemy bullets go 10.7 to 13.8. Per enemy
   * that is 3.15 volleys' worth down to 0.95. Four times the bodies firing
   * barely more shots, and in an arena a body is easy to walk around while a
   * bullet is what actually hits you. It is the same fact behind both "visual
   * clutter is high" and "the game gets easy and stays easy".
   *
   * The multiplier is SNAPPED to half a beat, and that is not fussiness. This
   * whole system schedules volleys against the transport's absolute beat so
   * that fire lands on subdivisions and a player can learn to dodge in time
   * with the track — the note on `nextBeat` explains what drift cost the last
   * time it was allowed. Scaling a 4-beat cadence by 1.37 gives 2.92 beats and
   * quietly destroys that; stepping it to 3, or to 2, keeps it.
   */
  setUrgency(mult: number): void {
    this.urgency = mult;
  }

  constructor(spec: EmitterSpec) {
    this.spec = { ...DEFAULTS, ...spec };
  }

  /** Beats between volleys, resolved from either `beats` or `seconds`. */
  private periodBeats(bpm: number): number {
    const base = this.spec.beats !== undefined
      ? this.spec.beats
      : this.spec.seconds !== undefined
        ? (this.spec.seconds * bpm) / 60
        : 1;
    if (this.urgency >= 1) return base;
    // Half-beat grid, and never faster than every half beat.
    return Math.max(0.5, Math.round(base * this.urgency * 2) / 2);
  }

  /**
   * Advance by `dtBeats` musical beats and fire any volleys that came due.
   * Driving emitters in beats rather than seconds is what keeps enemy fire
   * locked to the track when the director changes tempo.
   */
  update(
    nowBeat: number,
    bpm: number,
    pool: BulletPool,
    rng: Rng,
    sx: number,
    sy: number,
    px: number,
    py: number,
    dtSeconds: number,
  ): void {
    if (this.finished) return;
    this.phase += this.spec.spin * dtSeconds;

    if (this.nextBeat < 0) {
      this.nextBeat = nowBeat + this.spec.delayBeats + this.pendingDelay;
      this.pendingDelay = 0;
    }

    // A loop, not an `if`: at high tempo or after a hitch, several volleys can
    // fall inside one step and dropping them would visibly thin the pattern.
    let guard = 16;
    while (nowBeat >= this.nextBeat && !this.finished && guard-- > 0) {
      if (this.resting) {
        this.resting = false;
        this.burstIndex = 0;
        this.nextBeat += this.periodBeats(bpm);
        continue;
      }

      this.fire(pool, rng, sx, sy, px, py);
      this.volleys++;
      this.burstIndex++;
      this.phase += this.spec.step;

      if (this.volleys >= this.spec.total) {
        this.finished = true;
        return;
      }
      if (this.burstIndex >= this.spec.burst) {
        this.resting = true;
        this.nextBeat += this.spec.restBeats;
      } else {
        this.nextBeat += this.periodBeats(bpm);
      }
    }
  }

  private baseAngle(sx: number, sy: number, px: number, py: number): number {
    switch (this.spec.aim) {
      case 'player':
        return Math.atan2(py - sy, px - sx) + this.phase;
      case 'down':
        return Math.PI / 2 + this.phase;
      default:
        return this.spec.angle + this.phase;
    }
  }

  private fire(pool: BulletPool, rng: Rng, sx: number, sy: number, px: number, py: number): void {
    const s = this.spec;
    const base = this.baseAngle(sx, sy, px, py);
    const arms = Math.max(1, s.arms);
    const armStep = TAU / arms;

    for (let arm = 0; arm < arms; arm++) {
      const armAngle = base + arm * armStep;
      for (let i = 0; i < s.count; i++) {
        // The gap rotates with the arm, so the safe wedge sweeps the screen and
        // the player has somewhere to be rather than somewhere to pray.
        if (s.gap > 0 && (s.shape === 'ring' || s.shape === 'bloom')) {
          if (i / s.count < s.gap) continue;
        }
        let angle: number;
        switch (s.shape) {
          case 'ring':
            angle = armAngle + (i / s.count) * TAU;
            break;
          case 'fan':
            angle = armAngle + (s.count === 1 ? 0 : (i / (s.count - 1) - 0.5) * s.spread);
            break;
          case 'scatter':
            angle = armAngle + rng.range(-0.5, 0.5) * s.spread;
            break;
          case 'spiral':
          case 'aimed':
          case 'bloom':
          default:
            angle = armAngle + (s.count === 1 ? 0 : (i / s.count) * TAU);
            break;
        }

        let speed = s.speed + i * s.speedStep;
        if (s.speedJitter) speed += rng.range(-s.speedJitter, s.speedJitter);

        const shot: BulletSpawn = {
          x: sx + Math.cos(angle) * s.offset,
          y: sy + Math.sin(angle) * s.offset,
          angle,
          speed: s.shape === 'bloom' ? speed * 1.9 : speed,
          accel: s.shape === 'bloom' ? -speed * 2.4 : s.accel,
          turn: s.turn,
          minSpeed: s.shape === 'bloom' ? 0 : s.minSpeed,
          maxSpeed: s.maxSpeed,
          radius: s.radius,
          type: s.type,
          ttl: s.ttl,
          flags: s.flags ?? BulletFlag.DespawnOffscreen | BulletFlag.Cancellable,
        };
        pool.spawn(shot);
      }
    }
  }

  /**
   * Beats until the next volley, or Infinity when idle.
   *
   * Exposed so the renderer can telegraph the shot. Enemy fire has always been
   * scheduled in beats, but nothing on screen said so — the player had no way
   * to learn that volleys land on the grid. A visible windup turns the
   * soundtrack into gameplay information: once you can see that the shot comes
   * on the downbeat, you start dodging in time with the music instead of
   * reacting to pixels.
   */
  nextIn(nowBeat: number): number {
    if (this.finished || this.nextBeat < 0) return Infinity;
    return Math.max(0, this.nextBeat - nowBeat);
  }

  /** Push the volley later; before arming this stacks onto the initial offset. */
  delayBy(beats: number): void {
    if (this.nextBeat < 0) this.pendingDelay += beats;
    else this.nextBeat += beats;
  }

  /** Total volleys fired, so callers can detect a shot without a callback. */
  get volleyCount(): number {
    return this.volleys;
  }

  /** True once it has a scheduled volley, i.e. after its first update. */
  get armed(): boolean {
    return this.nextBeat >= 0;
  }

  /** Offset of the first volley for an emitter that has not armed yet. */
  firstOffset(): number {
    return this.spec.delayBeats + this.pendingDelay;
  }

  reset(): void {
    this.phase = 0;
    this.volleys = 0;
    this.burstIndex = 0;
    this.resting = false;
    this.finished = false;
    this.nextBeat = -1;
    this.pendingDelay = 0;
  }
}

/**
 * A "bloom" emitter fired once, used for death bursts and boss phase changes.
 * Kept separate from `Emitter` because it has no schedule to maintain.
 */
export function burstOnce(
  pool: BulletPool,
  x: number,
  y: number,
  count: number,
  speed: number,
  baseAngle = 0,
  opts: Partial<BulletSpawn> = {},
): void {
  for (let i = 0; i < count; i++) {
    const angle = baseAngle + (i / count) * TAU;
    pool.spawn({
      x,
      y,
      angle,
      speed,
      radius: 5,
      ttl: 12,
      flags: BulletFlag.DespawnOffscreen | BulletFlag.Cancellable,
      ...opts,
    });
  }
}
