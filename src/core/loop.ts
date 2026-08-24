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
const MAX_STEPS = 8;

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
