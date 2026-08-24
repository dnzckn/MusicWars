/**
 * The warping neon grid.
 *
 * A lattice of points, each on a spring to its home position. Explosions,
 * near-misses and the player shove them around; the springs pull them back.
 * Drawing the lines through the displaced points is what produces Geometry
 * Wars' signature rubber-sheet look.
 *
 * The beat is present here but deliberately quiet: one small breath from the
 * centre per bar, under the gameplay impulses rather than over them. It used to
 * breathe on every beat at four times the strength, which made the sheet
 * convulse twice a second and drowned out the shocks it exists to show. A grid
 * that is always shaking cannot register being hit.
 *
 * Cost: ~290 points, integrated with one linear pass and drawn as two batched
 * paths. Everything is in flat typed arrays because this runs every frame.
 */

export interface GridStyle {
  /** Base line colour, as an `hsl(...)` prefix without the alpha. */
  hue: number;
  alpha: number;
  /** Extra brightness, 0..1. Driven by tension, which moves over a wave — this
   *  used to be the beat pulse, and a lattice that changes lightness twice a
   *  second is read as flicker rather than as rhythm. */
  glow: number;
}

/*
 * 48 put 456 points and 43 lines across the field, which is a lot of edges for
 * bullets and enemies to be read against. 62 gives 285 points and 34 lines —
 * 20% less stroked length for the same rubber-sheet read, and cheaper to
 * integrate and stroke.
 */
const SPACING = 62;
/** Spring constant pulling a point home. Higher = snappier, more brittle. */
const STIFFNESS = 62;
/** Velocity damping per second. Below ~5 the grid wobbles like jelly forever. */
const DAMPING = 6.2;
/** Displacement cap, so a bomb cannot fold the grid inside out. */
const MAX_OFFSET = 44;
/*
 * How deformed a pair of neighbours must be before the bright pass draws them.
 *
 * This was 10, which the beat's own full-field breath cleared everywhere at
 * once — so the "an explosion tore the sheet" highlight fired over the whole
 * field twice a second and meant nothing. At 24 it takes a real shock, or the
 * ship's own wake, and it goes back to being a signal.
 */
const STRESS_MIN = 24;
/** The pre-fix value, kept only so `tools/strobe.mjs` can A/B the two. */
const STRESS_MIN_LEGACY = 10;

export class WarpGrid {
  /**
   * Restore the pre-fix strobe constants at runtime.
   *
   * Set by `Renderer.legacyStrobe` so `tools/strobe.mjs` can measure both
   * versions **inside one session**. Comparing across two builds would mean
   * comparing two browser launches on a box whose I/O throughput swings by an
   * order of magnitude, and this project's README is a long record of
   * measurements that turned out to describe the harness rather than the game.
   * Interleaving is the only version of this comparison worth trusting.
   */
  legacy = false;

  private cols: number;
  private rows: number;
  private homeX: Float32Array;
  private homeY: Float32Array;
  private x: Float32Array;
  private y: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private count: number;

  private readonly width: number;
  private readonly height: number;

  /* Explicit fields, not parameter properties — see the note on `Latch` in
   * `core/math.ts`; `erasableSyntaxOnly` in tsconfig enforces it. */
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cols = Math.floor(width / SPACING) + 1;
    this.rows = Math.floor(height / SPACING) + 1;
    this.count = this.cols * this.rows;
    this.homeX = new Float32Array(this.count);
    this.homeY = new Float32Array(this.count);
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.vx = new Float32Array(this.count);
    this.vy = new Float32Array(this.count);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const hx = c * SPACING;
        const hy = r * SPACING;
        this.homeX[i] = hx;
        this.homeY[i] = hy;
        this.x[i] = hx;
        this.y[i] = hy;
      }
    }
  }

  reset(): void {
    this.x.set(this.homeX);
    this.y.set(this.homeY);
    this.vx.fill(0);
    this.vy.fill(0);
  }

  /**
   * Shove the grid outward from a point. `strength` is roughly the peak
   * velocity in px/s at the epicentre; negative pulls inward, which is how a
   * gravity well reads.
   */
  impulse(px: number, py: number, radius: number, strength: number): void {
    const r2 = radius * radius;
    // Only the rows/columns that can possibly be in range, rather than all 350.
    const c0 = Math.max(0, Math.floor((px - radius) / SPACING));
    const c1 = Math.min(this.cols - 1, Math.ceil((px + radius) / SPACING));
    const r0 = Math.max(0, Math.floor((py - radius) / SPACING));
    const r1 = Math.min(this.rows - 1, Math.ceil((py + radius) / SPACING));

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const dx = this.x[i] - px;
        const dy = this.y[i] - py;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) || 0.0001;
        // Smooth falloff; a linear one leaves a visible hard edge at the radius.
        const falloff = 1 - d2 / r2;
        const f = (strength * falloff * falloff) / d;
        this.vx[i] += dx * f;
        this.vy[i] += dy * f;
      }
    }
  }

  /** A ring of outward pressure centred on the field, used for beat breathing. */
  breathe(strength: number): void {
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    this.impulse(cx, cy, Math.max(this.width, this.height), strength);
  }

  update(dt: number): void {
    // Sub-stepping keeps a stiff spring stable when a frame runs long; without
    // it a hitch makes the whole grid explode.
    const steps = dt > 1 / 45 ? 2 : 1;
    const h = dt / steps;
    const { x, y, vx, vy, homeX, homeY, count } = this;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < count; i++) {
        const ox = x[i] - homeX[i];
        const oy = y[i] - homeY[i];
        vx[i] += (-ox * STIFFNESS - vx[i] * DAMPING) * h;
        vy[i] += (-oy * STIFFNESS - vy[i] * DAMPING) * h;
        let nx = x[i] + vx[i] * h;
        let ny = y[i] + vy[i] * h;
        const dx = nx - homeX[i];
        const dy = ny - homeY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 > MAX_OFFSET * MAX_OFFSET) {
          const k = MAX_OFFSET / Math.sqrt(d2);
          nx = homeX[i] + dx * k;
          ny = homeY[i] + dy * k;
          vx[i] *= 0.4;
          vy[i] *= 0.4;
        }
        x[i] = nx;
        y[i] = ny;
      }
    }
  }

  /**
   * Draw as two batched paths — one for all rows, one for all columns. Stroking
   * 35 separate paths costs far more than stroking one with 35 subpaths.
   */
  draw(g: CanvasRenderingContext2D, style: GridStyle): void {
    const { x, y, cols, rows } = this;
    g.lineWidth = 1;

    g.beginPath();
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      g.moveTo(x[base], y[base]);
      for (let c = 1; c < cols; c++) {
        const i = base + c;
        g.lineTo(x[i], y[i]);
      }
    }
    for (let c = 0; c < cols; c++) {
      g.moveTo(x[c], y[c]);
      for (let r = 1; r < rows; r++) {
        const i = r * cols + c;
        g.lineTo(x[i], y[i]);
      }
    }
    g.strokeStyle = `hsla(${style.hue}, 90%, ${52 + style.glow * 26}%, ${style.alpha})`;
    g.stroke();

    // A second, brighter pass only where the sheet is actually deformed. This is
    // what makes an explosion look like it tore the grid rather than nudged it.
    const stressMin = this.legacy ? STRESS_MIN_LEGACY : STRESS_MIN;
    g.beginPath();
    let any = false;
    for (let r = 0; r < rows; r++) {
      const base = r * cols;
      for (let c = 1; c < cols; c++) {
        const i = base + c;
        const j = i - 1;
        if (this.stress(i) + this.stress(j) < stressMin) continue;
        g.moveTo(x[j], y[j]);
        g.lineTo(x[i], y[i]);
        any = true;
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 1; r < rows; r++) {
        const i = r * cols + c;
        const j = i - cols;
        if (this.stress(i) + this.stress(j) < stressMin) continue;
        g.moveTo(x[j], y[j]);
        g.lineTo(x[i], y[i]);
        any = true;
      }
    }
    if (any) {
      g.strokeStyle = `hsla(${style.hue + 20}, 100%, 74%, ${Math.min(0.55, style.alpha * 3.2)})`;
      g.lineWidth = 1.6;
      g.stroke();
    }
  }

  /** Displacement magnitude of a point, used to pick out the deformed region. */
  private stress(i: number): number {
    const dx = this.x[i] - this.homeX[i];
    const dy = this.y[i] - this.homeY[i];
    return Math.abs(dx) + Math.abs(dy);
  }
}
