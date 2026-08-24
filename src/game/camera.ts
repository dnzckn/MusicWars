/**
 * Screenshake, hitstop and flash.
 *
 * Hitstop scales the *simulation* dt while the render keeps running, which is
 * what makes an impact read as heavy. It deliberately does not touch the audio
 * clock: freezing the music every time something explodes would wreck the
 * groove, and the whole point of this project is that the groove survives.
 */

import { damp } from '../core/math';

export class Camera {
  x = 0;
  y = 0;
  private trauma = 0;
  private time = 0;

  /** Seconds of simulation freeze remaining. */
  private hitstop = 0;
  /** 0..1 white flash. */
  flash = 0;
  flashHue = 0;

  /** Additive chromatic-aberration strength, driven by musical intensity. */
  aberration = 0;

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  freeze(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  strike(hue: number, amount = 0.5): void {
    this.flash = Math.max(this.flash, amount);
    this.flashHue = hue;
  }

  /** Returns the dt the simulation should actually advance by. */
  consumeHitstop(dt: number): number {
    if (this.hitstop <= 0) return dt;
    this.hitstop -= dt;
    return this.hitstop > 0 ? 0 : dt;
  }

  update(dt: number): void {
    this.time += dt;
    // Trauma decays linearly; shake amplitude uses trauma^2 so small hits are
    // subtle and big ones are violent.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const amp = this.trauma * this.trauma * 22;
    if (amp > 0.01) {
      const t = this.time * 46;
      this.x = (Math.sin(t * 1.13 + 1.7) + Math.sin(t * 2.71)) * 0.5 * amp;
      this.y = (Math.sin(t * 1.61 + 4.2) + Math.sin(t * 3.17)) * 0.5 * amp;
    } else {
      this.x = 0;
      this.y = 0;
    }
    this.flash = damp(this.flash, 0, 0.055, dt);
  }

  /** A one-off jolt in a specific direction, e.g. recoil away from an explosion. */
  kick(angle: number, amount: number): void {
    this.x += Math.cos(angle) * amount;
    this.y += Math.sin(angle) * amount;
    this.shake(amount * 0.02);
  }

  reset(): void {
    this.trauma = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.x = 0;
    this.y = 0;
  }
}
