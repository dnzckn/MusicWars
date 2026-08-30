/**
 * Where the view is, plus screenshake, hitstop and flash.
 *
 * Hitstop scales the *simulation* dt while the render keeps running, which is
 * what makes an impact read as heavy. It deliberately does not touch the audio
 * clock: freezing the music every time something explodes would wreck the
 * groove, and the whole point of this project is that the groove survives.
 *
 * TWO CHANNELS, ONE OUTPUT. This class used to hold nothing but shake, and
 * `x`/`y` WERE the shake. They are now the composed render offset — the single
 * number `renderer.ts` translates by — and the two things that feed it are
 * kept apart:
 *
 *   viewX / viewY     where the top-left of the view sits in WORLD space.
 *                     Moves with the player. Clamped to the field.
 *   shakeX / shakeY   the impact channel. Decays to zero, never accumulates
 *                     into where the camera is looking.
 *
 *       x = -viewX + shakeX
 *
 * The sign is what lets `renderer.ts` keep both of its
 * `translate(camera.x, camera.y)` calls untouched: translating by `-viewX`
 * moves world space left when the view moves right, which is what a camera is.
 *
 * WHY THE SPLIT MATTERS RATHER THAN BEING TIDINESS. A shake that wrote into
 * the view channel would be permanent — trauma decays, but the displacement it
 * had already added to the view would not, so the arena would drift a little
 * further off-centre with every explosion and never come back. `kick()` used
 * to add straight into `x`/`y` and got away with it only because `update()`
 * overwrote both from scratch on the very next frame, which also meant a kick
 * lasted less than one frame. It writes to the shake channel now.
 */

import { clamp, damp } from '../core/math';
import { PLAYFIELD_W, TRACK_ANCHOR, VIEW_H, VIEW_W } from './field';

/*
 * How far the aim point may drift from the centre of the view before the
 * camera moves at all, as a fraction of the view.
 *
 * A camera locked rigidly to the ship makes the background slide under every
 * twitch of a dodge, which is nausea rather than motion. The deadzone means
 * small corrections move the ship on screen and leave the world still.
 *
 * JUDGED, NOT MEASURED, and it cannot be otherwise: `research-camera.md` §9
 * Stage 7 records deadzone, lookahead and smoothing as the only three numbers
 * in the whole camera refactor that need a person and a browser. They stopped
 * being inert the moment `PLAYFIELD_*` grew past `VIEW_*`; nothing node-only
 * can tell you whether these five constants feel right, and no gate in this
 * repository will ever go red because they are wrong.
 */
const DEADZONE_X = 0.16;
/*
 * `DEADZONE_Y = 0.14` was here and is deleted with the axis it guarded. The
 * travel axis has no deadzone because it has no follow: `viewY` is the
 * treadmill rail, assigned from `World.trackY`. The band the ship moves in
 * along that axis is `TRACK_AHEAD`..`TRACK_BEHIND` in `field.ts`, which is a
 * window the player drives inside rather than a threshold the camera reacts
 * to — 0.52 of the view deep against this constant's 0.28.
 */

/** Seconds of travel to lead the ship by, and the furthest that lead may reach. */
const LOOKAHEAD_SECONDS = 0.38;
const LOOKAHEAD_MAX = 220;

/** Halflife of the camera's approach to its target, and of the velocity estimate. */
const FOLLOW_HALFLIFE = 0.14;
const VELOCITY_HALFLIFE = 0.1;

export class Camera {
  /**
   * Top-left of the view in world space.
   *
   * Was pinned at zero while the field was exactly one view across, which made
   * the legal range `[0, 0]`. The field is 3000x3000 now, so the range is
   * `[0, 2100] x [0, 1880]` and this moves every frame the ship leaves the
   * deadzone. `renderer.ts` composes the grid's clip rectangle from it and
   * needed no change when it started moving, which was the point of adding it
   * a stage early.
   */
  viewX = 0;
  viewY = 0;

  /** The composed render offset. `renderer.ts` translates by exactly this. */
  x = 0;
  y = 0;

  /**
   * The impact channel, kept out of `viewX`/`viewY` on purpose.
   *
   * Private because nothing outside should be able to move the camera without
   * going through `shake` or `kick` — the whole point of the split is that
   * there is one door into each channel.
   */
  private shakeX = 0;
  private shakeY = 0;

  private trauma = 0;
  private time = 0;

  /** Last target handed to `follow`, and the smoothed velocity derived from it. */
  private lastTargetX = 0;
  private velX = 0;
  private following = false;

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
      this.shakeX = (Math.sin(t * 1.13 + 1.7) + Math.sin(t * 2.71)) * 0.5 * amp;
      this.shakeY = (Math.sin(t * 1.61 + 4.2) + Math.sin(t * 3.17)) * 0.5 * amp;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
    this.flash = damp(this.flash, 0, 0.055, dt);
    this.compose();
  }

  /**
   * Track a point — the ship — with a deadzone and a velocity lookahead.
   *
   * THIS IS LIVE NOW. It was written one stage before the field grew, as a
   * numeric no-op — `PLAYFIELD_* === VIEW_*` gave the clamp below the range
   * `[0, 0]`, so `viewX`/`viewY` could not leave the origin however hard this
   * pushed — and it was called every frame anyway rather than left as dead
   * code, because a `follow()` nobody calls is a `follow()` nobody has proved
   * cannot reach the simulation. `tools/arena.mjs` produced bit-identical
   * output with it running, which is what established that the camera is
   * strictly downstream of the world. That property is worth keeping: if a
   * number in here ever starts changing a balance measurement, something has
   * fed the view back into the simulation.
   *
   * The lookahead is derived here rather than taken as a parameter so that the
   * caller does not have to hold a previous position on the camera's behalf.
   * `dt <= 0` is ignored: a paused frame has no velocity to estimate, and
   * dividing by it would put an Infinity into the view offset.
   */
  /**
   * @param trackY where the top of the view sits on the TRAVEL axis, in world
   *   space. Owned by `World` (`World.trackY`), not derived here.
   *
   * THE TWO AXES ARE NO LONGER THE SAME KIND OF CAMERA and that is the whole
   * of this change. Across the track (`x`) this is still a follow camera with
   * a deadzone, a lookahead and a clamp to the arena walls — untouched, and it
   * is what keeps a sideways dodge from sliding the whole world. Along the
   * track (`y`) there is nothing to follow: the treadmill is a rail the
   * simulation owns, and the camera's job is to show it, so `viewY` is assigned
   * rather than damped.
   *
   * ASSIGNED, NOT DAMPED, deliberately. A deadzone on the travel axis would
   * mean the ship drifting up and down the frame as the camera decided whether
   * to bother, on an axis where the player is trying to hold a position
   * relative to the frame; and smoothing a rail that already moves at a
   * constant velocity adds lag and removes nothing, because a constant
   * velocity has no jerk to smooth. The rail's own motion is the smoothing.
   *
   * This keeps the property the previous stage established — the camera is
   * strictly DOWNSTREAM of the simulation. `trackY` is computed in
   * `World.update` from the player and the clock; nothing here can feed back
   * into it. That matters because the spawn line, the population census, the
   * bullet cull and `hasEntered` are all derived from this rectangle.
   */
  follow(px: number, py: number, trackY: number, dt: number): void {
    if (!(dt > 0)) return;

    if (!this.following) {
      // First frame: snap the estimate to the target rather than reading the
      // ship's whole starting offset as one frame of enormous velocity.
      this.lastTargetX = px;
      this.following = true;
      /*
       * And snap the VIEW too, or every run opens with a swoop.
       *
       * `reset()` puts the view at the origin and `World.start()` puts the ship
       * in the middle of the arena, which used to be the same point and is now
       * 1500,1500 in a 3000x3000 field. Damping from one to the other at a
       * 0.14s halflife is about a second of the camera flying across the map
       * before the player has pressed anything — and worse than cosmetic, since
       * the spawn ring and the bullet cull are both derived from the view, so
       * the first wave would arrive around a rectangle that is still moving.
       */
      this.centreOn(px, py);
    }
    const rawVx = (px - this.lastTargetX) / dt;
    this.lastTargetX = px;
    this.velX = damp(this.velX, rawVx, VELOCITY_HALFLIFE, dt);

    // Lead the ship along its own motion, so what the player is flying toward
    // is on screen before they get there. Across the track only: the lead along
    // it is the track window itself, which is 40% of the view deep.
    const aimX = px + clamp(this.velX * LOOKAHEAD_SECONDS, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);

    // How far the aim point is outside the deadzone, which is centred on the
    // view. Inside it, the camera does not move at all.
    const halfX = VIEW_W * DEADZONE_X;
    const offX = aimX - (this.viewX + VIEW_W / 2);
    const pushX = offX > halfX ? offX - halfX : offX < -halfX ? offX + halfX : 0;

    /*
     * Clamped to the field ACROSS the track, which is what keeps the player
     * from ever seeing outside the arena. `Math.max(0, ...)` rather than
     * assuming a positive range: a view WIDER than the field gives an inverted
     * clamp, and `clamp(v, 0, negative)` would NaN out the render offset. That
     * is not hypothetical — it is the state this function shipped in for a
     * whole stage, and it is the state a `PLAYFIELD_W` typo would put it back
     * in.
     *
     * ALONG the track there is no clamp, and there cannot be one: the old line
     * read `clamp(..., 0, PLAYFIELD_H - VIEW_H)` and `PLAYFIELD_H` is
     * `Infinity` now, so it would have been `clamp(v, 0, Infinity)` — a floor
     * at zero that the very first second of a run drives straight through, and
     * the treadmill would have stopped dead at the origin with nothing
     * reporting it.
     */
    this.viewX = clamp(damp(this.viewX, this.viewX + pushX, FOLLOW_HALFLIFE, dt), 0, Math.max(0, PLAYFIELD_W - VIEW_W));
    this.viewY = trackY;
    this.compose();
  }

  /**
   * Put a world point where the ship BELONGS in the view, immediately.
   *
   * No damping and no deadzone: this is for discontinuities — the start of a
   * run — where smoothing is not motion, it is the camera visibly catching up
   * with something that teleported.
   *
   * Centred across the track and at `TRACK_ANCHOR` along it, not centred on
   * both axes: the anchor is where the ship sits with the stick centred, so
   * putting it anywhere else means the run opens with the ship out of position
   * and the first thing the treadmill does is slide it back. `World.start()`
   * seeds `trackY` from the same constant, and this call is what makes the
   * first frame agree with it before `follow` takes over.
   */
  centreOn(px: number, py: number): void {
    this.viewX = clamp(px - VIEW_W / 2, 0, Math.max(0, PLAYFIELD_W - VIEW_W));
    this.viewY = py - VIEW_H * TRACK_ANCHOR;
    this.compose();
  }

  /**
   * A one-off jolt in a specific direction, e.g. recoil away from an explosion.
   *
   * Writes the SHAKE channel. Putting it in the view channel would make the
   * displacement permanent — see the note at the top of this file.
   */
  kick(angle: number, amount: number): void {
    this.shakeX += Math.cos(angle) * amount;
    this.shakeY += Math.sin(angle) * amount;
    this.shake(amount * 0.02);
    this.compose();
  }

  reset(): void {
    this.trauma = 0;
    this.hitstop = 0;
    this.flash = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.viewX = 0;
    this.viewY = 0;
    this.velX = 0;
    this.following = false;
    this.x = 0;
    this.y = 0;
  }

  /** The one place `x`/`y` are written. */
  private compose(): void {
    this.x = -this.viewX + this.shakeX;
    this.y = -this.viewY + this.shakeY;
  }
}
