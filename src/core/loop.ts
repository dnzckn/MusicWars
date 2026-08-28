/**
 * Fixed-timestep loop with an interpolating render.
 *
 * Bullet patterns are built out of accumulated per-step rotations, so a variable
 * dt would make the same wave look different on different machines. The
 * simulation therefore always advances in equal slices and the renderer
 * interpolates between the last two states.
 */

export const FIXED_DT = 1 / 120;
/** Never simulate more than this many steps in one frame; better to slow down than to spiral. */
/*
 * 4, down from 8 — a cap on how much a hitch is allowed to cost the NEXT frame.
 *
 * `npm run jank` measures the frame-time tail rather than the median and found
 * p99 60.5ms and max 101ms on an RTX 3080 with a locked 16.7ms median. The
 * cause is garbage collection in the audio layer (see tools/jank.mjs), which
 * this file cannot fix — but it can stop one pause turning into two.
 *
 * At 60fps a frame is two steps of FIXED_DT. A 68ms GC pause puts about eight
 * steps of backlog in the accumulator, and at MAX_STEPS 8 the very next frame
 * ran all of them: four times the normal simulation work, in the frame
 * immediately after the one that was already late. The stall propagated,
 * because the recovery frame was itself slow enough to be a dropped frame.
 *
 * Four caps that recovery at twice the normal load and gives up the rest —
 * `accumulator = 0` below already exists for exactly this, and giving up is the
 * right answer here. What is discarded is a few milliseconds of simulated time
 * after a stutter nobody enjoyed; what is bought is that the frame after a
 * hitch renders on schedule. A player cannot see the game advance 30ms less
 * than it might have. They can see a second dropped frame.
 *
 * The 0.25s frame-delta cap above is a different guard for a different problem
 * (returning from a background tab) and is unchanged.
 *
 * MEASURED, AND THE MEASUREMENT DID NOT SEPARATE IT FROM NOISE. Across four
 * `jank` runs the tail sits in a band of 1.8-2.2% hitches and p99 60-69ms, and
 * this change reads 1.8% and 69.0ms — inside it on both axes. So this is kept
 * on the ARGUMENT rather than on evidence: an eight-step catch-up is four times
 * a normal frame's simulation work scheduled immediately after a frame that was
 * already late, and bounding that is right whether or not today's profile
 * happens to show it. It is recorded as unproven rather than written up as a
 * win, because the honest reading is that the real cost is elsewhere and this
 * only stops it compounding.
 */
const MAX_STEPS = 4;

export interface LoopHooks {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class Loop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  /** Wall-clock seconds spent in update() last frame, for the debug overlay. */
  updateMs = 0;
  renderMs = 0;
  fps = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  /** Distinct errors seen, so a per-frame throw logs once rather than 60x/s. */
  readonly errors: string[] = [];
  private seen = new Set<string>();

  private reportError(phase: string, err: unknown): void {
    const key = `${phase}: ${err instanceof Error ? err.message : String(err)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.errors.push(key);
    console.error(`[loop] ${key}`, err);
  }

  private readonly hooks: LoopHooks;

  /* Not a parameter property — see the note on `Latch` in `core/math.ts`. */
  constructor(hooks: LoopHooks) {
    this.hooks = hooks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);

      // Cap the frame delta so returning from a background tab does not
      // fast-forward the run.
      const frameDt = Math.min((now - this.lastTime) / 1000, 0.25);
      this.lastTime = now;
      this.accumulator += frameDt;

      const t0 = performance.now();
      let steps = 0;
      try {
        while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
          this.hooks.update(FIXED_DT);
          this.accumulator -= FIXED_DT;
          steps++;
        }
      } catch (err) {
        this.reportError('update', err);
      }
      if (steps === MAX_STEPS) this.accumulator = 0; // give up on the backlog
      const t1 = performance.now();

      // A throw inside render used to kill the rAF chain permanently: the
      // background had already been cleared to black, so the symptom was the
      // game turning into a black screen at random with no other trace. One bad
      // frame must never end the session.
      try {
        this.hooks.render(this.accumulator / FIXED_DT, frameDt);
      } catch (err) {
        this.reportError('render', err);
      }
      const t2 = performance.now();

      this.updateMs = t1 - t0;
      this.renderMs = t2 - t1;
      this.fpsAccum += frameDt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
