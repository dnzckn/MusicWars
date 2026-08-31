/**
 * Canvas 2D renderer.
 *
 * Two canvases: the playfield (redrawn every frame) and an overlay for the
 * boss bar and flashes. The bullet loop is deliberately dumb — one `drawImage`
 * per bullet from a pre-rendered sprite, no state changes, no transforms — and
 * everything expensive (gradients, glows, rotation) was baked at load time.
 *
 * Exactly one thing answers the beat at full strength — the enemies breathe —
 * and everything else in the background is either steady or responds to
 * gameplay. The coupling between the music and the game still has to be legible
 * at a glance, but it is carried by the things the player is already looking at
 * rather than by the whole field flashing: five layers keeping the same time in
 * the periphery reads as strobing, not as rhythm.
 */

import { clamp01, lerp, TAU } from '../core/math';
import { BOSS_EVERY } from '../game/waves';
import type { Transport } from '../core/transport';
import type { Effect, World } from '../game/world';
import { beatsUntilLunge } from '../game/enemies';
import { CRUISE_SPEED, INVULN_ON_HIT } from '../game/player';
import { ParticleShape } from '../game/particles';
import { powerupDef } from '../game/powerups';
import { SHARD_HUES, Status } from '../game/world';
import { PLAYFIELD_W, TRACK_ANCHOR } from '../game/field';
import { WarpGrid } from './grid';
import { fusionLine, LevelUpOverlay } from './levelup';
import { playerBulletSprites, ROTATIONS, softDot } from './sprites';

const STAR_COUNT = 140;

/**
 * How much of the camera's motion the nearest star layer takes, at `z = 1`.
 *
 * Below 1 so that even the closest layer slides against the world rather than
 * being pinned to it. Inert while the camera cannot move; see the note in
 * `drawBackground`.
 */
const STAR_PARALLAX = 0.55;

interface Star {
  x: number;
  y: number;
  z: number;
}

export class Renderer {
  /**
   * Which ring each live status draws, in the order they stack outward.
   *
   * A table rather than a chain of ifs so the draw loop is a single pass with
   * no branching per colour, and so adding a status is one row. `Status` is
   * IMPORTED rather than restated: a renderer holding its own copy of a
   * bitmask would draw the wrong ring the day a bit moved, and would do it
   * silently. AGENTS.md §3.
   */
  private static readonly STATUS_RINGS: readonly [number, number, number][] = [
    [Status.Burn, 22, 0.85],    // fire
    [Status.Poison, 96, 0.8],   // rot
    [Status.Bleed, 350, 0.75],  // blood
    [Status.Freeze, 195, 0.95], // ice — the brightest, because it is the one
                                //       that changes what the body can do most
    [Status.Slow, 168, 0.7],    // wind
    [Status.Blind, 52, 0.8],    // glare
    [Status.Charm, 300, 0.95],  // it is yours now
    [Status.Vuln, 275, 0.9],    // irradiated — the fusion tier's own colour,
                                //   and violet because nothing else in the
                                //   table is: a softened body has to be
                                //   readable next to a burning one, since the
                                //   whole play is "soften here, cash there"
  ];

  private g: CanvasRenderingContext2D;
  private og: CanvasRenderingContext2D;
  private stars: Star[] = [];
  private dots = new Map<number, HTMLCanvasElement>();
  /** Smoothed beat pulse, 1 on the beat decaying to 0. */
  private pulse = 0;
  private lastBeatIndex = -1;
  /** Set on the frame a beat lands, so the grid is kicked exactly once. */
  private pulseFired = false;
  /** Whether the beat that just landed was a downbeat. */
  private downbeat = false;
  /** Vignettes are quantised to 5% tension steps and cached; building a radial
   *  gradient every frame showed up in profiles for no visible benefit. */
  private vignettes = new Map<number, CanvasGradient>();
  /** Ground speed along the track, px/s. Set once a frame; see `render`. */
  private groundSpeed = CRUISE_SPEED;
  /**
   * How far into warp the screen is, smoothed. 0 at cruise, 1 fully warped.
   *
   * SMOOTHED AND NOT THE BOOLEAN, because everything it drives is a length or
   * an alpha and a mode that snaps on in one frame reads as a glitch rather
   * than as a change of state. `World.warping` is the truth; this is how fast
   * the picture agrees with it.
   */
  private warpShown = 0;
  /** Stick position on the throttle axis: 0 stopped, 0.5 cruise, 1 flat out. */
  private trim = 0.5;
  /** Smoothed `trim`, so the gauge and the plume do not twitch on a tap. */
  private trimShown = 0.5;
  /** The level the last frame saw, and the countdown of the pop it fired. */
  private lastLevel = 0;
  private levelPop = 0;
  private grid: WarpGrid;
  /** Quarter-resolution buffer for the bloom pass. */
  private bloom: HTMLCanvasElement;
  private bloomG: CanvasRenderingContext2D;
  bloomEnabled = true;
  /**
   * Adaptive quality.
   *
   * Bloom costs about 14fps once the endgame is throwing 20+ enemies and 180
   * bullets around — measured at wave 27, 40fps with it and 55 without. Rather
   * than lose the look everywhere to protect the worst case, it sheds itself
   * when the frame budget is actually tight and comes back when it is not. The
   * thresholds are far apart so it cannot oscillate frame to frame, and it needs
   * a sustained reading in either direction before it acts.
   */
  private bloomAuto = true;
  private lowFrames = 0;
  private highFrames = 0;

  private updateQuality(fps: number): void {
    if (!this.bloomAuto || fps <= 1) return;
    if (fps < 46) {
      this.lowFrames++;
      this.highFrames = 0;
    } else if (fps > 57) {
      this.highFrames++;
      this.lowFrames = 0;
    } else {
      this.lowFrames = 0;
      this.highFrames = 0;
    }
    if (this.lowFrames > 45) {
      this.bloomEnabled = false;
      this.lowFrames = 0;
    } else if (this.highFrames > 90 && !this.bloomEnabled) {
      this.bloomEnabled = true;
      this.highFrames = 0;
    }
  }

  /**
   * The level-up screen, the ensemble readout and the fusion payoff.
   *
   * Public so `main.ts` can route a click or a number key into `hitTest` /
   * `select` / `resolve` without re-deriving the card rectangles. Everything it
   * needs it takes itself: `world.bus` for the events and `world.snapshot` for
   * the loadout, both already public and readonly on `World`. That is why
   * adding this screen needed no change to `main.ts` at all.
   */
  readonly levelUp = new LevelUpOverlay();

  /*
   * Put the pre-fix strobe constants back, at runtime.
   *
   * The five things that used to answer the beat — grid alpha, grid lightness,
   * a full-field `breathe()` convulsion, the bloom and the horizon — are all
   * restored together when this is set, so `tools/strobe.mjs` can measure the
   * old screen against the new one **in a single browser session**.
   *
   * Interleaving rather than comparing two builds is not fussiness. This box's
   * I/O throughput swings by an order of magnitude minute to minute, and
   * `tools/README.md` is largely a record of measurements that turned out to
   * describe the harness rather than the game — `hudab` measured the same HUD
   * as costing 7.7fps and then nothing at all, and the rule that came out of it
   * was that any A/B smaller than the run-to-run noise band must interleave.
   *
   * The values below are reconstructed from the line references in the original
   * complaint, not recovered from source control: this repository has no
   * commits, and the fixes were already applied when this switch was written.
   * They are the right shape and the right order of magnitude; treat the
   * absolute "before" number as indicative and the ratio as the finding.
   */
  legacyStrobe = false;

  private readonly world: World;

  /* `world` is an explicit field, not a parameter property — see the note on
   * `Latch` in `core/math.ts`. */
  /**
   * The two gameplay canvases, and the scale their backing stores are at.
   *
   * Both were a fixed 900x1120 bitmap stretched by CSS to fill `#stage`, whose
   * height is `min(100%, calc(100vw - 300px) * 960/720)` with no cap. On any
   * window where that resolves taller than 1120 CSS pixels — a maximised
   * browser on a 1440p monitor, and more so once the device pixel ratio is
   * applied — the browser upscaled the whole playfield, softening exactly the
   * things a bullet hell cannot afford to soften: the bullets, the ship, and
   * the hitbox dot.
   *
   * `hud.ts` already solved this for the notation canvas and records the same
   * finding in its own words ("the most distinctive thing on the page was also
   * the blurriest"). The gameplay canvases never got the same treatment.
   *
   * Nothing here draws in canvas coordinates. Gameplay draws in WORLD
   * coordinates (`w.width` x `w.height`) inside the camera translate; the
   * background, the overlay and every readout draw in VIEW coordinates
   * (`w.viewW` x `w.viewH`) outside it. `toWorld`/`toView` in `main.ts` map
   * pointers via `getBoundingClientRect` rather than the backing store — so
   * the fix is entirely a matter of sizing the bitmap and scaling the context,
   * with no change to any drawing or hit-testing code.
   *
   * WHAT THIS DOES NOT FIX: the projectile sprites in `sprites.ts` are
   * pre-rendered once at world scale and blitted 1:1, so they are resampled by
   * the context transform just as they were previously resampled by the
   * browser. They are no softer than before and no sharper. Everything drawn
   * as vectors — the ship, the hitbox dot, the grid, the glows, the overlay
   * text — does get the full backing-store resolution. Making the sprites
   * sharp too means re-baking the atlas whenever the scale changes, which is a
   * larger change and wants a frame-rate measurement first.
   */
  private readonly canvasEl: HTMLCanvasElement;

  private readonly overlayEl: HTMLCanvasElement;

  private scale = 1;

  private resized = true;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, world: World) {
    this.world = world;
    this.canvasEl = canvas;
    this.overlayEl = overlay;
    this.g = canvas.getContext('2d', { alpha: false })!;
    this.og = overlay.getContext('2d')!;
    const ro = new ResizeObserver(() => {
      this.resized = true;
    });
    ro.observe(canvas);
    addEventListener('resize', () => {
      this.resized = true;
    });
    this.grid = this.makeGrid();
    this.wireProgression(world);
    this.bloom = document.createElement('canvas');
    /*
     * A quarter of the VIEW, not a quarter of the world.
     *
     * The bloom pass downsamples the gameplay canvas, and that canvas is the
     * viewport. Sizing it from the field would make the bitmap grow with the
     * arena — 3x linear is 9x the pixels — to hold a blur of a rectangle that
     * is still only one screen.
     */
    this.bloom.width = Math.round(world.viewW / 4);
    this.bloom.height = Math.round(world.viewH / 4);
    this.bloomG = this.bloom.getContext('2d', { alpha: true })!;
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: Math.random() * world.viewW,
        y: Math.random() * world.viewH,
        z: 0.25 + Math.random() * 0.75,
      });
    }
    this.starW = world.viewW;
    this.starH = world.viewH;
  }

  /**
   * The view the starfield was laid out against, so a resize can carry it.
   *
   * Not `world.viewW` at read time: the stars are the one thing here that is
   * STATE rather than a function of the current size, and the wrap in
   * `drawStars` requires them to be inside `[0, viewW)`. After the view grows
   * they would all be crowded into the left of the new rectangle; after it
   * shrinks they would be outside it and the wrap arithmetic would pull the
   * whole field into one column. Rescaling needs the old size, which is this.
   */
  private starW = 0;

  private starH = 0;

  /**
   * The view size changed. Rebuild everything sized from it.
   *
   * Called by `main.ts` after `setView`, which is the only place the view
   * moves. Three things are derived from `VIEW_*` and none of them can notice
   * on their own:
   *
   *   - the backing store and the context scale (`fitCanvases`, via `resized`)
   *   - the bloom bitmap, a quarter of the view in each axis
   *   - the starfield, whose positions are view coordinates
   *
   * The grid is NOT in that list and must not be: `WarpGrid` is allocated from
   * the FIELD and clipped to the view at draw time, which is the arrangement
   * `tools/gridview.mjs` exists to defend. Reallocating it here would be the
   * silent revert that check is watching for.
   */
  /**
   * Allocate the warp lattice: the whole field across the track, one view plus
   * a cell of bleed along it.
   *
   * WAS `new WarpGrid(world.width, world.height)` and that line is now a
   * `Float32Array(Infinity)`, because `world.height` is `Infinity`. The
   * treadmill did not make a view-sized lattice a good idea, it made it the
   * only possible one — see the constructor comment in `grid.ts`, which
   * records that the same change was proposed, measured and rejected on a
   * bounded field for reasons that no longer apply.
   *
   * `SPACING` is not exported, so the bleed is expressed as a round 128 px —
   * two cells at the current 62 and at least one at anything up to 128. Over-
   * allocating by a row is 49 points; under-allocating is a lattice that ends
   * inside the frame.
   *
   * Rebuilt on every view change rather than resized, because the row count is
   * a function of `viewH` and a resize is rare, one-off, and already
   * reallocates the bloom bitmap two lines away.
   */
  private makeGrid(): WarpGrid {
    return new WarpGrid(this.world.width, this.world.viewH + 128);
  }

  viewChanged(): void {
    const w = this.world;
    this.resized = true;
    this.grid = this.makeGrid();
    const bw = Math.max(1, Math.round(w.viewW / 4));
    const bh = Math.max(1, Math.round(w.viewH / 4));
    if (this.bloom.width !== bw || this.bloom.height !== bh) {
      this.bloom.width = bw;
      this.bloom.height = bh;
    }
    if (this.starW > 0 && this.starH > 0) {
      const sx = w.viewW / this.starW;
      const sy = w.viewH / this.starH;
      for (const s of this.stars) {
        s.x *= sx;
        s.y *= sy;
      }
    }
    this.starW = w.viewW;
    this.starH = w.viewH;
  }

  /**
   * Subscribe the level-up screen to the progression events.
   *
   * Done here rather than in `main.ts` because everything needed is already on
   * `World`, and because the renderer owning its own overlay means the screen
   * cannot be half-wired: there is no call site to forget.
   *
   * `level:skip` resolves with -1, which plays the exit animation without
   * flaring a card — a skip should look like the question being withdrawn
   * rather than like an answer.
   */
  private wireProgression(world: World): void {
    world.bus.on('level:offer', (p) => this.levelUp.open(p, world.snapshot));
    world.bus.on('level:choice', (p) => this.levelUp.resolveChoice(p.id, p.grace));
    world.bus.on('level:skip', () => this.levelUp.resolve(-1));
    world.bus.on('ability:evolve', (p) => {
      this.levelUp.celebrate('evolution', p.from, p.catalyst, p.to, fusionLine(p.to));
    });
    world.bus.on('ability:union', (p) => {
      this.levelUp.celebrate('union', p.a, p.b, p.to, fusionLine(p.to));
    });
    world.bus.on('ability:duet', (p) => {
      this.levelUp.celebrate('duet', p.a, p.b, p.to, 'two players, one stand');
    });

    /*
     * A way to hold the screen open without playing to a level-up.
     *
     * The arena conversion is landing in another workstream, so for most of
     * this screen's development there was no way to reach it in a running game
     * at all — and a screenshot is the only instrument that can judge a layout.
     * This lets a tool put any offer on screen in one `page.evaluate`.
     *
     * It is *re-attached every frame* rather than installed once here, because
     * `main.ts` does `window.__musicwars = { … }` — a whole-object assignment,
     * and it runs after this constructor. Installing the hook once would put it
     * on an object that is thrown away a few lines later, and the symptom would
     * be a tool failing with "cannot read properties of undefined" against code
     * that is demonstrably present. See `attachHook`.
     */
    this.uiHook = {
      offer: (payload: Parameters<LevelUpOverlay['forceOffer']>[0]) =>
        this.levelUp.forceOffer(payload, world.snapshot),
      close: () => this.levelUp.clearForced(),
      /*
       * WHETHER THE SCREEN IS STILL PAINTING, because "I closed it and waited"
       * is not the same question and `levelshot` was getting it wrong.
       *
       * That check takes a CONTROL — the overlay's alpha over the card region
       * with nothing open — by calling `close()` and sleeping 700ms. The exit
       * animation is at least 12 frames plus a page fade, so on a loaded
       * machine the control was measured over a screen still at full backdrop:
       * observed swinging between 5.8 and 214.7 across runs of identical code,
       * with everything failing on the high readings because the OPEN state
       * could not clear a control that was already nearly opaque. A gate whose
       * baseline is sometimes the thing it is comparing against is not a gate.
       *
       * One boolean off the overlay's own `isOpen`, so a tool can wait for the
       * state instead of guessing at a duration.
       */
      isOpen: () => this.levelUp.isOpen,
      select: (i: number) => this.levelUp.select(i),
      resolve: (i: number) => this.levelUp.resolve(i),
      // Layout and hit-test, side by side, so a check can assert they agree.
      // The failure they exist to catch is silent: cards drawn in one place and
      // hit-tested in another means the player clicks one instrument and gets
      // another, and nothing on screen looks wrong when it happens.
      rects: () => this.levelUp.rects(),
      summary: () => this.levelUp.summary(),
      hitTest: (x: number, y: number) => this.levelUp.hitTest(x, y),
      hitTestControl: (x: number, y: number) => this.levelUp.hitTestControl(x, y),
      celebrate: (kind: 'evolution' | 'union', a: string, b: string, to: string) =>
        this.levelUp.celebrate(
          kind,
          a as Parameters<LevelUpOverlay['celebrate']>[1],
          b as Parameters<LevelUpOverlay['celebrate']>[2],
          to as Parameters<LevelUpOverlay['celebrate']>[3],
          fusionLine(to),
        ),
    };
  }

  /** The debug hook, built once and re-attached whenever `main` replaces it. */
  private uiHook: Record<string, unknown> = {};

  /**
   * Put `__musicwars.ui` back if it has gone.
   *
   * One property read and a compare per frame. `main.ts` assigns the whole
   * `__musicwars` object after the renderer is constructed, and a hot reload
   * can do it again mid-session, so "install once in the constructor" silently
   * loses the hook and leaves a tool failing against code that is plainly
   * there.
   */
  private attachHook(): void {
    const w = window as unknown as { __musicwars?: Record<string, unknown> };
    if (!w.__musicwars) w.__musicwars = {};
    if (w.__musicwars.ui !== this.uiHook) w.__musicwars.ui = this.uiHook;
  }

  private dot(hue: number): HTMLCanvasElement {
    const key = Math.round(hue / 10) * 10;
    let c = this.dots.get(key);
    if (!c) {
      c = softDot(key, 12);
      this.dots.set(key, c);
    }
    return c;
  }

  /** The current musical caption, set by main each frame. */
  bannerDetail = '';

  /**
   * Base hue for the playfield, set from the current groove each frame and
   * eased so a change reads as the room shifting rather than a cut.
   */
  private hue = 205;
  targetHue = 205;

  /**
   * Match both backing stores to the box they are displayed in.
   *
   * Gated on a flag set by the observer rather than measured every frame:
   * reading `clientHeight` forces a layout, and this runs immediately before a
   * frame that writes styles elsewhere, which is the classic read-after-write
   * stall `hud.ts` calls out.
   *
   * The 1.5 cap is a PERFORMANCE GUARD CHOSEN WITHOUT MEASUREMENT, and should
   * be revisited. At 1.5 the fill cost is 2.25x the old fixed bitmap, which is
   * the most this seemed worth risking on a bullet hell while no browser on
   * this machine can run `tools/framecheck.mjs` to check the frame budget. An
   * uncapped ideal on a large high-DPI display lands somewhere in the 1.3-1.9
   * range depending on panel size, OS scaling and how much browser chrome is
   * in the way — illustrative, not derived, and reviewed as such: a peer
   * recomputed an earlier single figure here several ways and got a spread,
   * not that number. Do not lean on it later as if it were measured.
   *
   * The floor matters less than it looks: when the stage is displayed SMALLER
   * than 900x1120 — an ordinary 1080p window — the scale drops below 1 and the
   * game renders fewer pixels than it used to, at exactly display resolution
   * instead of rendering 900x1120 and having the browser resample it down.
   * That case is both sharper and cheaper than before.
   */
  private fitCanvases(): void {
    if (!this.resized) return;
    const w = this.world;
    /*
     * A zero height means the element is not laid out yet, on the very first
     * frame. Do NOT consume the flag in that case: clamping a height of 0
     * would latch the minimum scale and leave the game permanently rendering
     * at 540x672 if no further resize event ever arrived. Retry next frame
     * instead.
     */
    const cssH = this.canvasEl.clientHeight;
    const cssW = this.canvasEl.clientWidth;
    if (cssH <= 0 || cssW <= 0) return;
    this.resized = false;
    const dpr = Math.min(3, Math.max(1, devicePixelRatio || 1));
    /*
     * BOTH AXES, taking the smaller ratio.
     *
     * This used to read the height alone, and said so: it was correct only
     * because `#stage` carried `aspect-ratio: 900 / 1120` and so could never
     * have a different shape from the view. That rule is gone — the stage is
     * the window now and the VIEW is derived FROM the stage (`field.ts`
     * `viewForStage`), which is the same guarantee arrived at from the other
     * end. The two should therefore agree to within a rounding error, and
     * taking the smaller of the two ratios is the belt to that braces: if they
     * ever disagree the playfield is letterboxed rather than stretched, which
     * is a bug you can see instead of one you cannot.
     *
     * The scale and the backing store come from `viewW`/`viewH` and not from
     * the field — a bigger arena must not mean a bigger bitmap.
     */
    const scale = Math.min(
      1.5,
      Math.max(0.6, Math.min((cssH * dpr) / w.viewH, (cssW * dpr) / w.viewW)),
    );
    this.scale = scale;
    const bw = Math.round(w.viewW * scale);
    const bh = Math.round(w.viewH * scale);
    for (const el of [this.canvasEl, this.overlayEl]) {
      // Assigning width/height resets all context state, transform included,
      // so only do it when it actually changed and re-apply the transform after.
      if (el.width !== bw || el.height !== bh) {
        el.width = bw;
        el.height = bh;
      }
    }
  }

  render(alpha: number, dt: number, transport: Transport, rawTension: number, fps = 60): void {
    this.fitCanvases();
    const w = this.world;
    const g = this.g;
    // Colour strings built from NaN throw inside addColorStop, and the frame
    // dies after the background has been cleared — i.e. a black screen.
    const tension = Number.isFinite(rawTension) ? clamp01(rawTension) : 0;
    this.updateQuality(fps);

    /*
     * HOW FAST THE SHIP IS ACTUALLY GOING, computed once and read by three
     * draw passes: the starfield, the engine plume and the gauge.
     *
     * SPEED IS THE VERB NOW and until this pass almost nothing said so. The
     * forward axis of the stick is a throttle — `player.ts` sets
     * `wantY = -CRUISE_SPEED + input.y * trimTop` with CRUISE === TRIM === 430
     * — so ground speed spans roughly [120, 765] px/s in play (the floor is
     * above zero because the station-keeping `settle` term is still pushing).
     * Measured on this build with `_speedcue`, differencing the upper third of
     * the frame across 250ms at three stick positions over 307,200 pixels:
     *
     *   full back      ground 122 px/s   1.09% of pixels changed
     *   cruise         ground 478 px/s   3.22%
     *   full forward   ground 765 px/s   3.05%
     *
     * The top HALF of the throttle range — a 60% speed increase — moved the
     * same number of pixels as cruise did. The background was carrying speed
     * only through star parallax, and the one visual that looked like speed
     * (star elongation) was wired to MUSICAL TENSION, which is a different
     * signal that happens to rise at the same time often enough to be
     * mistaken for it.
     *
     * `trim` is 0 stopped, 0.5 at cruise, 1 flat out — the stick position, not
     * the speed, which is what the player is actually controlling.
     */
    // Guarded the same way `tension` is one line up, and for the same reason:
    // a NaN here reaches a star's height and a gauge's fill, and a NaN in a
    // colour string throws inside `addColorStop` and kills the frame after the
    // background has been cleared — a black screen with no error.
    const vy = w.player.vy;
    this.groundSpeed = Number.isFinite(vy) ? Math.max(0, -vy) : CRUISE_SPEED;
    this.trim = clamp01(this.groundSpeed / (CRUISE_SPEED * 2));
    // Smoothed for the things that would otherwise twitch on a tap. `trim`
    // itself stays raw for anything that wants the instantaneous value.
    this.trimShown += (this.trim - this.trimShown) * Math.min(1, dt * 7);
    // Faster in than out (0.35s to arrive, 0.9s to fade), so engaging warp is
    // an event and leaving it is a settle. Both are well inside the 1.4s hold
    // at either stop, so neither transition is still moving when the next
    // decision is available.
    const warpTarget = w.warping ? 1 : 0;
    this.warpShown += (warpTarget - this.warpShown) * Math.min(1, dt * (w.warping ? 8 : 3));
    // Shortest way round the colour wheel, so 8 -> 282 goes down through 0
    // rather than sweeping through every hue in between.
    let d = ((this.targetHue - this.hue + 540) % 360) - 180;
    // Frozen with everything else while the cards are up: a background sliding
    // through the colour wheel is still the screen changing under a player who
    // is trying to read. It resumes from wherever it stopped, so the groove's
    // colour still arrives, just not during the fermata.
    this.hue = w.choosing ? this.hue : (this.hue + d * Math.min(1, dt * 1.6) + 360) % 360;

    /*
     * THE SCREEN HOLDS STILL WHILE THE CARDS ARE UP.
     *
     * Reported from play: "why does anything move while in the item selection
     * screen". The simulation already stops dead — `World.update` sets
     * `simDt = 0` for the whole offer, so nothing translates, and the long note
     * there is right that a card screen the arena keeps moving underneath is a
     * decision the game is also doing TO you.
     *
     * But the RENDERER never knew about the offer. It runs on real `dt`, not
     * sim time, and it must — the transport deliberately keeps running so the
     * music does not stop for the fermata. So while the player read four cards,
     * the grid convulsed on every downbeat, the enemies breathed, the bloom
     * pulsed and the horizon lifted. Nothing moved anywhere and the whole
     * screen was still throbbing.
     *
     * Freezing the pulse fixes all of it at once, because `pulse` and
     * `downbeat` are the single source every beat-driven visual reads: the
     * grid's `breathe`, the enemy scale, the bloom alpha and the horizon all
     * derive from these two lines. Held at zero, the field behind the cards is
     * simply a still picture of the fight you paused.
     *
     * `lastBeatIndex` is still advanced, so the first beat after the cards
     * close is not mistaken for a fresh one and does not fire a double pulse on
     * resume — the same reason `World` pushes every scheduled lunge forward by
     * the beats the pause cost.
     *
     * The MUSIC is untouched. It keeps playing through the card screen, which
     * is the one moment in a run the player is listening to the arrangement
     * rather than dodging, and that was always the point.
     */
    const beatIndex = Math.floor(transport.beat);
    const held = w.choosing;
    if (beatIndex !== this.lastBeatIndex) {
      this.lastBeatIndex = beatIndex;
      // Downbeats hit harder.
      this.pulse = held ? 0 : beatIndex % 4 === 0 ? 1 : 0.55;
      this.pulseFired = !held;
      this.downbeat = !held && beatIndex % 4 === 0;
    }
    this.pulse = held ? 0 : Math.max(0, this.pulse - dt * 4.2);

    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawBackground(g, dt, tension);

    g.save();
    g.translate(w.camera.x, w.camera.y);

    this.updateGrid(dt, tension);
    /*
     * The lattice holds still.
     *
     * Both of these used to carry the beat pulse — alpha swung 0.135 -> 0.225
     * and the line lightness 52% -> 78% twice a second, over the whole field.
     * A background that changes brightness at 2Hz in the player's peripheral
     * vision is fatiguing whatever else is on screen, and it was one of five
     * things doing it on the same clock. Tension still moves both, but slowly:
     * the grid brightens over a wave rather than flashing over a bar.
     *
     * The steady alpha is set to the old *resting* value rather than its mean,
     * so the lattice looks the way it did between beats — which is where the
     * eye spent most of its time anyway. With 20% less stroked length at the
     * wider spacing that is about a quarter less grid on screen, which is the
     * clutter coming out, not the game going dark.
     */
    this.grid.legacy = this.legacyStrobe;
    this.grid.draw(g, {
      hue: this.hue + tension * 26,
      // The legacy pair is what the complaint was about: the lattice swinging
      // 0.135 -> 0.225 in alpha and 52% -> 78% in lightness, twice a second,
      // across the whole field.
      alpha: this.legacyStrobe ? 0.1 + tension * 0.1 + this.pulse * 0.09 : 0.105 + tension * 0.085,
      glow: this.legacyStrobe ? this.pulse : tension * 0.4,
    }, this.viewRect());

    this.drawBounds(g);

    // Under everything: a well is ground the player is standing on, so it must
    // not sit over the shapes and pickups the player is reading.
    this.drawWells(g);
    this.drawDrops(g);
    this.drawEnemies(g, alpha);
    this.drawNotes(g);
    this.drawParticles(g);
    this.drawNovas(g);
    // Under the bullets and the ship, over the enemies they are hitting: a beam
    // is something the player is projecting, so it must not obscure the thing
    // it is aimed at, and it must not compete with incoming fire for attention.
    this.drawEffects(g);
    this.drawBullets(g, alpha);
    this.drawPlayer(g, alpha);
    this.drawDrones(g);
    this.drawGuard(g);
    this.drawShipPrompt(g, alpha, dt);

    g.restore();

    if (this.bloomEnabled) this.applyBloom(g, tension);
    // Text after bloom: blurring type just makes it hard to read.
    g.save();
    g.translate(w.camera.x, w.camera.y);
    this.drawPopups(g);
    g.restore();
    this.drawOverlay(tension, dt, transport.beat);
  }

  /**
   * The rectangle of WORLD space the canvas is currently showing.
   *
   * Derived from the composed render offset rather than from `camera.viewX`
   * directly, because the offset is what `translate()` is actually given —
   * `x = -viewX + shakeX`, so `-x` is the world point that lands on screen
   * pixel zero, screenshake included. Anything that clips against the view
   * therefore stays correct while the screen is shaking, with no separate
   * allowance for the shake amplitude.
   *
   * Today `viewX/viewY` are pinned at the origin, so this is `(-shakeX,
   * -shakeY, 900, 1120)` — a rectangle that always covers the whole field, so
   * every consumer sees exactly what it saw before the camera existed.
   */
  /**
   * The edge of the world, drawn only when it is in shot.
   *
   * WHY THIS EXISTS. Until the field grew, the edge of the arena was the edge of
   * the canvas and the player could not miss it. At 3000x3000 behind a 900x1120
   * window the boundary is somewhere off screen almost all of the time, and when
   * you finally reach it NOTHING tells you: the lattice runs to the canvas edge
   * exactly as it does mid-field, and the only feedback is that you stop moving.
   * Driving the camera into the clamped corner and finding no wall was the most
   * obvious remaining gap after the arena landed, and it was reported honestly
   * rather than shipped quietly.
   *
   * A wall the player runs into with no warning is worse than no wall, so this
   * is a GRADIENT and not a line: the glow strengthens over the last 260px of
   * approach, which is roughly half a second at PLAYER_SPEED, so it arrives as
   * "you are running out of room" before it becomes "you have stopped".
   *
   * Only the edges within the view are drawn, and the whole thing is skipped
   * when none are. Mid-field that is four cheap comparisons and no path at all,
   * which matters because this sits inside the per-frame camera transform.
   *
   * Deliberately drawn AFTER the lattice and BEFORE anything alive: it is
   * scenery, and it must never sit over a bullet the player is reading. It uses
   * the same hue as the grid so it reads as the same surface ending rather than
   * as a new object.
   */
  private drawBounds(g: CanvasRenderingContext2D): void {
    const v = this.viewRect();
    const FADE = 260;

    /*
     * TWO WALLS, NOT FOUR. The arena is bounded across the track and unbounded
     * along it, so there is a left edge and a right edge and there is nothing
     * ahead or behind to draw.
     *
     * The north and south bands are DELETED rather than left to evaluate
     * false. `PLAYFIELD_H` is `Infinity`, so `v.y + v.h > Infinity - FADE` is
     * never true and the southern band would simply have been dead code; but
     * `v.y < FADE` is true for the first two seconds of every run and false
     * for the rest of it forever, which would have opened each run with a
     * bright wall across the top of the screen announcing a boundary the ship
     * is about to fly through. That is worse than dead — it is a lie about the
     * geometry, on the frame the player is forming their first idea of it.
     */
    const nearL = v.x < FADE;
    const nearR = v.x + v.w > PLAYFIELD_W - FADE;
    if (!nearL && !nearR) return;

    // 0 at FADE away, 1 with the edge against the view edge. Squared so the
    // last stretch of the approach carries most of the change.
    const lit = (gap: number) => {
      const t = clamp01(1 - gap / FADE);
      return t * t;
    };

    const band = (x0: number, y0: number, x1: number, y1: number, a: number, hx: number, hy: number) => {
      if (a <= 0.01) return;
      const grad = g.createLinearGradient(x0, y0, x0 + hx, y0 + hy);
      grad.addColorStop(0, `hsla(${this.hue}, 90%, 66%, ${0.5 * a})`);
      grad.addColorStop(1, `hsla(${this.hue}, 90%, 66%, 0)`);
      g.fillStyle = grad;
      g.fillRect(Math.min(x0, x1 + hx), Math.min(y0, y1 + hy), Math.abs(x1 - x0) + Math.abs(hx), Math.abs(y1 - y0) + Math.abs(hy));
      g.strokeStyle = `hsla(${this.hue}, 95%, 78%, ${0.85 * a})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };

    const D = 150;
    if (nearL) band(0, v.y, 0, v.y + v.h, lit(v.x), D, 0);
    if (nearR) band(PLAYFIELD_W, v.y, PLAYFIELD_W, v.y + v.h, lit(PLAYFIELD_W - (v.x + v.w)), -D, 0);
  }

  private viewRect(): { x: number; y: number; w: number; h: number } {
    const w = this.world;
    return { x: -w.camera.x, y: -w.camera.y, w: w.viewW, h: w.viewH };
  }

  /**
   * Feed the grid: gameplay shocks, the player's wake, and a breath on the bar.
   *
   * This used to convulse the entire sheet on every beat — `breathe()` at up to
   * -220 at 130bpm is a full-field geometric spasm twice a second, and it was
   * the single loudest source of background clutter. The rule now is that the
   * grid is a surface that gets *hit*: explosions and near-misses move it, the
   * ship drags it, and the transport is present as one gentle swell per bar
   * plus a small kick under the ship. Everything that reads as violence on it
   * is now something that actually happened in the game.
   */
  private updateGrid(dt: number, tension: number): void {
    const w = this.world;
    /*
     * SCROLL THE SHEET UNDER THE CAMERA, before anything is written into it.
     *
     * Before the impulses, because `scrollTo` renumbers rows and re-seeds the
     * ones that fall off the end: a shock applied first and scrolled second
     * would be applied to a row that then became a different piece of ground.
     * One cell of margin above the view so the row the clip draws as bleed
     * exists.
     *
     * `camera.viewY` and not `world.trackY`, for the same reason the grid clip
     * uses `viewRect()`: this has to agree with what is actually drawn,
     * screenshake included, or the top row of the lattice pops in and out of
     * frame every time something explodes.
     */
    this.grid.scrollTo(w.camera.viewY - 64);
    for (const s of w.shocks) this.grid.impulse(s.x, s.y, s.radius, s.strength);
    w.shocks.length = 0;

    if (this.pulseFired) {
      this.pulseFired = false;
      /*
       * The breath is centred on the VIEW, not on the field.
       *
       * This was written while the two were the same rectangle and was a no-op
       * then. They differ now — 900x1120 of a 3000x3000 arena — and it is
       * load-bearing: a swell centred on the middle of the field is a swell
       * happening somewhere the player is not, which is a beat the music plays
       * and the screen does not show.
       */
      const view = this.viewRect();
      if (this.legacyStrobe) {
        // Every beat, at full strength: a full-field geometric convulsion twice
        // a second, which was the single loudest source of background clutter.
        this.grid.breathe(-90 - tension * 130, view);
        this.grid.impulse(w.player.x, w.player.y, 200, 90 + tension * 90);
      } else {
        // Once a bar rather than four times, and a quarter of the old strength.
        if (this.downbeat) this.grid.breathe(-20 - tension * 26, view);
        // The beat still lands where the player is already looking: local to the
        // ship, small enough not to compete with the bullets around it.
        this.grid.impulse(w.player.x, w.player.y, 150, 90 + tension * 90);
      }
    }

    // The ship drags the sheet along behind it.
    if (!w.player.dead) this.grid.impulse(w.player.x, w.player.y, 74, -170);
    this.grid.update(dt);
  }

  /**
   * Cheap additive bloom: downscale to a quarter, blur *there* (blurring 180x240
   * costs a fraction of blurring 720x960), then composite back with 'lighter'.
   */
  private applyBloom(g: CanvasRenderingContext2D, tension: number): void {
    const w = this.world;
    const bg = this.bloomG;
    bg.globalCompositeOperation = 'copy';
    bg.filter = 'blur(2.5px)';
    bg.drawImage(g.canvas, 0, 0, this.bloom.width, this.bloom.height);
    bg.filter = 'none';

    g.save();
    g.globalCompositeOperation = 'lighter';
    // Tension only. A bloom that pulses on the beat brightens *everything* at
    // once, which is the least selective way a screen can keep time — and it
    // washes the bullets into the background it is lifting with them.
    g.globalAlpha = 0.3 + tension * 0.16 + (this.legacyStrobe ? this.pulse * 0.1 : 0);
    g.drawImage(this.bloom, 0, 0, w.viewW, w.viewH);
    g.restore();
  }

  /**
   * The background is SCREEN furniture, not world furniture.
   *
   * It is drawn before `translate(camera.x, camera.y)` in `render()`, so its
   * rectangle is the view and never the field: `(0, 0, viewW, viewH)` is the
   * whole of what the canvas shows, whatever the camera is looking at.
   */
  private drawBackground(g: CanvasRenderingContext2D, dt: number, tension: number): void {
    const w = this.world;
    g.fillStyle = '#04050a';
    g.fillRect(0, 0, w.viewW, w.viewH);

    /*
     * Starfield, speed scaling with tension so the world literally accelerates
     * as the track does — plus PARALLAX against the camera.
     *
     * `s.x`/`s.y` are view-space positions that wrap inside the viewport; the
     * camera offset is subtracted at draw time, scaled by the star's own `z`,
     * so near stars slide further than far ones. Today `viewX/viewY` are zero
     * and the subtraction is exactly nothing — `s.x` is already inside
     * `[0, viewW)` and `s.y` inside `[0, viewH]`, so neither wrap branch can
     * fire and the drawn pixels are the pixels this drew before the camera
     * existed.
     *
     * `research-camera.md` §10 calls this the highest ratio of "the world is
     * big" to lines changed in the whole conversion, and it is: the layer that
     * currently FAKES vertical scrolling over a static field becomes real
     * depth the moment the camera can move, at the cost of two subtractions.
     *
     * 0.55 rather than 1.0 so that even the nearest layer still slides against
     * the world instead of being pinned to it — a starfield locked to world
     * coordinates reads as debris, not as distance. JUDGED, NOT MEASURED: this
     * is one of `research-camera.md` §9 Stage 7's numbers and it is inert
     * until the camera can move.
     */
    /*
     * The starfield stops with everything else while the cards are up.
     *
     * It scrolls on real `dt` rather than on sim time, so it was the one thing
     * still visibly drifting after the beat pulse was frozen — measured by
     * capturing the playfield twice 750ms apart during an open offer and
     * finding the frames differed. Particles were already correct
     * (`particles.update(simDt)`); this was the survivor.
     *
     * Zeroing the speed rather than skipping the loop, so the stars are still
     * DRAWN — the field behind the cards stays a picture of the fight rather
     * than losing its background.
     */
    /*
     * THE STARS ANSWER THE STICK, NOT THE ARRANGEMENT.
     *
     * This was `40 + tension * 220`. Tension is the DIRECTOR's signal — danger
     * or progress, whichever is higher — and driving the one layer that looks
     * like speed from it meant the background sped up when the music did and
     * ignored the throttle entirely. On a treadmill where the forward axis of
     * the stick is the only thing the player controls in that axis, that is
     * the wrong dial wired to the wrong readout.
     *
     * `groundSpeed * 0.42` puts the drift roughly on the same scale as the
     * parallax term below (`CRUISE * 0.55 * z`), so the two agree instead of
     * fighting: at full back the field crawls, at full throttle it pours. A
     * small tension term survives because "the world accelerates as the track
     * does" is still true and still worth seeing — it is now a garnish on the
     * ship's own speed rather than the whole of it.
     */
    const speed = w.choosing ? 0 : this.groundSpeed * 0.42 + tension * 40;
    const parX = w.camera.viewX * STAR_PARALLAX;
    const parY = w.camera.viewY * STAR_PARALLAX;
    g.fillStyle = `hsl(${this.hue + 12}, 32%, 72%)`;
    for (const s of this.stars) {
      s.y += speed * s.z * dt;
      if (s.y > w.viewH) {
        s.y -= w.viewH;
        s.x = Math.random() * w.viewW;
      }
      let px = s.x - parX * s.z;
      let py = s.y - parY * s.z;
      if (px < 0 || px >= w.viewW) px = ((px % w.viewW) + w.viewW) % w.viewW;
      if (py < 0 || py > w.viewH) py = ((py % w.viewH) + w.viewH) % w.viewH;
      /*
       * THE STREAK IS THE SPEEDOMETER.
       *
       * `size * (1 + tension * 2.5)` elongated every star when the MUSIC got
       * intense. A streak is the most literal speed cue a starfield has and it
       * was reporting somebody else's number. It is the throttle now, squared
       * so the change lands in the top half of the range where it was
       * previously invisible: at cruise (trim 0.5) a star is 1.4x its width,
       * at full throttle 6.5x, at full back 1.1x. Tension keeps a small share
       * so an intense wave still reads as faster than a quiet one at the same
       * speed.
       *
       * Alpha rises with the streak as well, because a longer star spread over
       * more pixels at the same alpha is a DIMMER star, which would have
       * cancelled half of what the length is trying to say.
       */
      /*
       * WARP ADDS TO THE STREAK, and it has to, because the throttle term
       * cannot say it. Warp LATCHES (see `world.ts`), so a warping player is
       * usually NOT at the forward stop — they are flying, and `trimShown` is
       * wherever they left the stick. Without this term the one visual that
       * most obviously means "going faster" would be at its cruise value in the
       * mode called warp.
       *
       * +4.0 is roughly the top of the throttle's own range, so warp at cruise
       * looks about as fast as full throttle does at rest, and warp at full
       * throttle is off the end of anything the game shows otherwise.
       */
      const streak = this.trimShown * this.trimShown * 5.5 + tension * 0.6 + this.warpShown * 4;
      g.globalAlpha = (0.16 + s.z * 0.4) * (1 + Math.min(0.55, streak * 0.12));
      const size = s.z * 1.9;
      g.fillRect(px, py, size, size * (1 + streak));
    }
    g.globalAlpha = 1;

    // Horizon glow that swells with tension — and with tension only. It used to
    // carry the beat as well, which made the bottom of the field breathe in
    // step with the grid, the bloom and the enemies.
    const grad = g.createLinearGradient(0, w.viewH, 0, w.viewH * 0.55);
    const horizonBeat = this.legacyStrobe ? this.pulse * 0.05 : 0;
    grad.addColorStop(0, `hsla(${this.hue + tension * 40}, 90%, 50%, ${0.05 + tension * 0.12 + horizonBeat})`);
    grad.addColorStop(1, `hsla(${this.hue}, 90%, 50%, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, w.viewH * 0.55, w.viewW, w.viewH * 0.45);
  }

  private drawBullets(g: CanvasRenderingContext2D, alpha: number): void {
    g.globalCompositeOperation = 'lighter';

    /*
     * THE ENEMY BULLET LOOP IS GONE, and it was one `drawImage` per bullet
     * against a pool of 3000 with a measured on-screen peak of 186 — the
     * largest single draw loop in this file. `enemyBulletSprites()` and the
     * four `ENEMY_TYPES` frames it builds go with it, in `sprites.ts`.
     */

    const pset = playerBulletSprites();
    const pb = this.world.playerBullets;
    for (let i = 0; i < pb.count; i++) {
      const t = pb.type[i] % pset.frames.length;
      const set = pset.frames[t];
      const spr = pset.rotating[t]
        ? set[(((Math.round((pb.angle[i] / TAU) * ROTATIONS) % ROTATIONS) + ROTATIONS) % ROTATIONS)]
        : set[0];
      const x = lerp(pb.px[i], pb.x[i], alpha) - spr.ox;
      const y = lerp(pb.py[i], pb.y[i], alpha) - spr.oy;
      g.drawImage(spr.canvas, x, y);
    }

    g.globalCompositeOperation = 'source-over';
  }

  private drawEnemies(g: CanvasRenderingContext2D, alpha: number): void {
    for (const e of this.world.enemies) {
      const x = lerp(e.prevX, e.x, alpha);
      const y = lerp(e.prevY, e.y, alpha);
      const flash = e.hitFlash > 0;
      const hpFrac = clamp01(e.hp / e.maxHp);

      g.save();
      g.translate(x, y);
      // A held body does not sway. See the status block below.
      if ((e.status & Status.Freeze) === 0) g.rotate(Math.sin(e.age * 1.4) * 0.08);
      /*
       * The one thing that still answers the beat at full strength.
       *
       * Five things used to pulse on this clock — grid alpha, grid lightness, a
       * full-field grid convulsion, the bloom and the horizon — and together
       * they read as the screen strobing rather than as the game keeping time.
       * The enemies keep it instead: it is small, it is local, it is on the
       * things the player is already tracking, and an ensemble that visibly
       * moves with the music is the premise of the game rather than decoration.
       */
      if (this.pulse > 0.01) {
        const breathe = 1 + this.pulse * 0.07;
        g.scale(breathe, breathe);
      }

      // Each member of the ensemble gets its own silhouette, so a glance at the
      // stage tells you what you are about to hear.
      const r = e.radius;
      /*
       * Damage has to read across several hits, not one.
       *
       * These ranges were set when almost everything died in a hit or two, so a
       * wounded enemy shifted lightness by about ten points — invisible unless
       * you were staring at it. Enemies now take a handful of hits by design
       * (fewer, slower, tougher), which only feels like toughness rather than
       * unresponsiveness if you can see the thing wearing down: the body drains
       * toward black, the outline heats up, and the line thins as it goes.
       */
      /*
       * A HIT FLASHES THE OUTLINE. IT USED TO FILL THE BODY PURE WHITE.
       *
       * `flash ? '#ffffff'` on the FILL is the single largest legibility cost
       * in the frame at the densities this game now runs. `arena` measures
       * on-screen p50 19 and p90 56; photographed at wave 23 with 76 bodies on
       * screen and a multi-hit weapon, a third of the field is solid white
       * discs at any instant, drawn under a renderer that composites
       * everything else with `lighter`. The ship, the shards and the incoming
       * bodies all vanish into it. Finding one's own ship in that frame took
       * seconds; it is supposed to take none.
       *
       * The flash is worth keeping — knowing what you are hitting is why it
       * exists — so it moves to where it costs nothing: the OUTLINE goes white
       * and the fill lifts to a bright version of the body's OWN hue rather
       * than losing it. That is strictly more information, not less: a flashing
       * body still says which archetype it is, which a white disc did not.
       */
      g.fillStyle = flash
        ? `hsla(${e.hue}, 92%, ${40 + hpFrac * 20}%, 0.95)`
        : `hsla(${e.hue}, 72%, ${6 + hpFrac * 26}%, 0.95)`;
      g.strokeStyle = flash
        ? '#ffffff'
        : `hsla(${e.hue - (1 - hpFrac) * 18}, 100%, ${52 + (1 - hpFrac) * 34}%, 0.95)`;
      g.lineWidth = 1.2 + hpFrac * 1.2;
      g.lineCap = 'round';

      switch (e.archetype) {
        case 'arpeggiator': {
          // A sequencer wheel: ring plus spokes that turn as it fires.
          g.beginPath();
          g.arc(0, 0, r * 0.72, 0, TAU);
          g.fill();
          g.stroke();
          g.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = e.age * 1.7 + (i / 6) * TAU;
            g.moveTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
            g.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15);
          }
          g.stroke();
          break;
        }
        case 'stutter': {
          // Hi-hat: two cymbals, the top one chattering.
          const gap = r * 0.34 + Math.abs(Math.sin(e.age * 9)) * r * 0.3;
          g.beginPath();
          g.ellipse(0, gap, r * 1.15, r * 0.34, 0, 0, TAU);
          g.fill();
          g.stroke();
          g.beginPath();
          g.ellipse(0, -gap, r * 1.15, r * 0.34, 0, 0, TAU);
          g.fill();
          g.stroke();
          break;
        }
        case 'subdrop': {
          // A speaker cone.
          g.beginPath();
          g.arc(0, 0, r, 0, TAU);
          g.fill();
          g.stroke();
          g.beginPath();
          g.arc(0, 0, r * 0.58, 0, TAU);
          g.stroke();
          g.beginPath();
          g.arc(0, 0, r * 0.26 + Math.sin(e.age * 7) * r * 0.06, 0, TAU);
          g.fill();
          g.stroke();
          break;
        }
        case 'glissando': {
          // A slur: a swept ribbon leaning into its direction of travel.
          g.beginPath();
          g.moveTo(-r, r * 0.5);
          g.quadraticCurveTo(0, -r * 1.25, r, r * 0.5);
          g.quadraticCurveTo(0, -r * 0.35, -r, r * 0.5);
          g.closePath();
          g.fill();
          g.stroke();
          break;
        }
        case 'conductor': {
          // Podium and baton: wide shoulders, a raised arm keeping time.
          g.beginPath();
          g.moveTo(0, r * 1.05);
          g.lineTo(-r * 1.5, 0);
          g.lineTo(-r * 0.7, -r * 0.85);
          g.lineTo(r * 0.7, -r * 0.85);
          g.lineTo(r * 1.5, 0);
          g.closePath();
          g.fill();
          g.stroke();
          g.beginPath();
          const beat = Math.sin(e.age * 4.4);
          g.moveTo(r * 0.55, -r * 0.7);
          g.lineTo(r * 0.55 + beat * r * 0.7, -r * 1.5);
          g.lineWidth = 3;
          g.stroke();
          break;
        }
        default: {
          // Pluck: a guitar pick.
          g.beginPath();
          g.moveTo(0, r);
          g.quadraticCurveTo(-r * 1.05, r * 0.1, -r * 0.62, -r * 0.8);
          g.quadraticCurveTo(0, -r * 1.05, r * 0.62, -r * 0.8);
          g.quadraticCurveTo(r * 1.05, r * 0.1, 0, r);
          g.closePath();
          g.fill();
          g.stroke();
          break;
        }
      }

      /*
       * Windup — and it is now the ONLY warning any attack in this game gives.
       *
       * A ring that contracts onto the enemy over the last half-beat before it
       * charges. Half a beat is ~0.23s at 130bpm — long enough to read and
       * react, short enough that it is a warning rather than a countdown. It
       * also makes the beat visible on every attacking body at once, which is
       * the whole point: the track is telling you when to move.
       *
       * IT MATTERS MORE THAN IT DID. It used to decorate a volley that was
       * itself perfectly visible in the air for a second afterwards, so a
       * player who missed the ring still had the bullets to read. A lunge is
       * over in a third of a second and the ring is all there is, so it is
       * drawn heavier: the stroke reaches 3.4px rather than 2.6 and the ring
       * starts 26px out rather than 20, which makes it legible against a body
       * in a crowd of sixty rather than one of six.
       */
      const beats = beatsUntilLunge(e, this.world.warpedBeatNow);
      if (beats < 0.5) {
        const charge = 1 - beats / 0.5;
        g.strokeStyle = `hsla(${e.hue}, 100%, 82%, ${0.3 + charge * 0.65})`;
        g.lineWidth = 1.2 + charge * 2.2;
        g.beginPath();
        g.arc(0, 0, e.radius + 26 - charge * 20, 0, TAU);
        g.stroke();
      }

      /*
       * WHAT THE PLAYER'S PROPERTIES HAVE LEFT ON THIS BODY.
       *
       * THE SIMULATION DELIVERED AND THE SCREEN DID NOT, which is this file's
       * own recurring defect inverted. Driven in a browser with each of the
       * twenty weapons forced in turn, every property fired and ticked and NOT
       * ONE of them was visible: a burning enemy, a poisoned one, a frozen one
       * and an untouched one were the same orange teardrop. A status the
       * player cannot see is a status they cannot play around, which makes the
       * whole substrate a number in a log.
       *
       * ONE STROKED ARC PER LIVE STATUS, drawn concentric so two statuses read
       * as two rings rather than as one thicker one, and skipped entirely on
       * the overwhelming majority of bodies by the same `status !== 0` test the
       * simulation's own tick uses. Colours are the ones the effect already
       * suggests — fire, rot, ice, wind, glare, and the player's own cyan for a
       * body that has changed sides.
       *
       * FREEZE ALSO STOPS THE WOBBLE, because a body that is held and still
       * rocking to the beat is the same lie in a smaller font. That is handled
       * at the top of this block, where the rotation is applied.
       */
      if (e.status !== 0) {
        g.globalCompositeOperation = 'lighter';
        let ring = 0;
        for (const [bit, hue, alpha] of Renderer.STATUS_RINGS) {
          if ((e.status & bit) === 0) continue;
          g.strokeStyle = `hsla(${hue}, 100%, 66%, ${alpha})`;
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(0, 0, e.radius + 3 + ring * 3.2, 0, TAU);
          g.stroke();
          ring++;
        }
        g.globalCompositeOperation = 'source-over';
      }

      // Core light, brighter as it gets closer to death.
      g.globalCompositeOperation = 'lighter';
      const d = this.dot(e.hue);
      const s = e.radius * (0.9 + (1 - hpFrac) * 0.7);
      g.globalAlpha = 0.4 + (1 - hpFrac) * 0.5;
      g.drawImage(d, -s, -s, s * 2, s * 2);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';

      g.restore();
    }
  }

  private drawPlayer(g: CanvasRenderingContext2D, alpha: number): void {
    const p = this.world.player;
    if (p.dead) return;
    const x = lerp(p.prevX, p.x, alpha);
    const y = lerp(p.prevY, p.y, alpha);
    /*
     * Invulnerability PULSES; it does not strobe.
     *
     * This was `Math.floor(p.invuln * 16) % 2 === 0` driving a hard cut
     * between alpha 0.4 and 1 — a binary flip sixteen times a second, so the
     * ship flashed at 8Hz for the whole 3.2s of invulnerability, and 4.8s
     * after losing a life. Three things wrong with that, in rising order of
     * importance:
     *
     *   - WCAG 2.3.1 puts the ceiling for flashing content at three per
     *     second. 8Hz is not near that line. The sprite is small enough that
     *     the "large area" clause does not bite, but the run also opens with a
     *     background beat pulse that `tools/strobe.mjs` exists to keep in
     *     check, and this was the one flashing thing in the frame that nothing
     *     measured at all.
     *   - It is worst exactly when it can least afford to be. The player is
     *     invulnerable because they were just hit, which is the moment they
     *     most need to find their own ship and get out of whatever killed
     *     them; a hard flicker is the least trackable thing to put on screen
     *     there.
     *   - It threw away information it was already holding. The old blink was
     *     the same at 3.2s remaining as at 0.2s, so the moment protection ran
     *     out arrived with no warning.
     *
     * A smooth cosine is not a flash — the luminance change is gradual rather
     * than a transition — and the floor is lifted from 0.4 to 0.55 so the hull
     * stays readable throughout. The rate rides the remaining time, running
     * about 1Hz when freshly hit and reaching 3Hz as it lapses, so the pulse
     * quickening IS the warning. It stays at or under the WCAG rate at its
     * fastest.
     */
    const invulnFrac = clamp01(p.invuln / INVULN_ON_HIT);
    const pulse = p.invuln > 0
      ? 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(p.invuln * (3 - invulnFrac * 2) * TAU))
      : 1;

    g.save();
    g.translate(x, y);
    g.globalAlpha = pulse;
    g.rotate(p.bank * 0.22);

    g.beginPath();
    g.moveTo(0, -18);
    g.lineTo(-12, 12);
    g.lineTo(0, 6);
    g.lineTo(12, 12);
    g.closePath();
    g.fillStyle = '#0b1728';
    g.fill();
    /*
     * A DARK KEYLINE UNDER THE CYAN, and this is a density fix rather than a
     * style one.
     *
     * Every explosion, particle and effect in this renderer composites with
     * `lighter`. Photographed at 76 on-screen bodies, the pile of overlapping
     * particle dots around a kill saturates to PURE WHITE over an area several
     * times the ship — and a 2px #6ff0ff stroke on white is very nearly
     * nothing. The ship is drawn after all of it and was still the hardest
     * thing on the screen to find.
     *
     * Stroking near-black at 5px first gives the cyan an edge to sit on that
     * is dark against the blown-out case and invisible against the ordinary
     * one, because the field behind it is #04050a anyway. One extra stroke of
     * one four-point path per frame.
     */
    g.strokeStyle = 'rgba(2,5,12,0.92)';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.stroke();
    g.strokeStyle = '#6ff0ff';
    g.lineWidth = 2;
    g.stroke();

    /*
     * THE PLUME IS A THROTTLE READOUT.
     *
     * It was `9 + sin(t) * 2` — a fixed flicker that said the same thing at
     * 120 px/s and at 765. The engine is the one part of the ship a player is
     * already watching (it is directly under the hull, in the direction the
     * threat comes from), so it is the cheapest honest place to put the stick
     * position: a stub when trimmed back, a torch when pushed. The idle
     * flicker survives on top so a ship at cruise still breathes.
     */
    g.globalCompositeOperation = 'lighter';
    const flame = this.dot(200);
    const fs = (5 + this.trimShown * 11) + Math.sin(performance.now() * 0.03) * 1.6;
    g.globalAlpha = 0.6 + this.trimShown * 0.4;
    g.drawImage(flame, -fs, 6 - fs * 0.4, fs * 2, fs * 2);
    g.globalAlpha = 1;

    /*
     * The contact body. Always drawn, bright when focused.
     *
     * This used to be "the hitbox", a 5px dot standing for `PLAYER_HITBOX`'s
     * 3.5 — a bullet hell that hides its hitbox is just being coy. There are no
     * enemy bullets to thread and the ship is touched at `PLAYER_CONTACT`,
     * which is 11, so the dot is drawn at the size that is actually tested. A
     * marker that understates the thing it marks is worse than no marker.
     */
    const hb = this.dot(p.focused ? 350 : 190);
    const hs = p.focused ? 14 : 11;
    g.globalAlpha = p.focused ? 1 : 0.55;
    g.drawImage(hb, -hs, -hs, hs * 2, hs * 2);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // Shield arc: health drawn on the thing the player is already looking at.
    // A side-panel readout is useless when your eyes are locked to your hitbox.
    const hpFrac = p.maxHp > 0 ? clamp01(p.hp / p.maxHp) : 0;
    if (hpFrac < 1 || p.invuln > 0) {
      const hue = hpFrac > 0.66 ? 150 : hpFrac > 0.33 ? 45 : 350;
      g.lineWidth = 2.5;
      g.strokeStyle = `hsla(${hue}, 100%, 62%, 0.8)`;
      g.beginPath();
      // Starts at 12 o'clock and fills clockwise, so "how much is left" is the
      // arc length rather than something you have to decode.
      g.arc(0, 0, 25, -Math.PI / 2, -Math.PI / 2 + TAU * hpFrac);
      g.stroke();
      g.lineWidth = 2.5;
      g.strokeStyle = 'rgba(255,255,255,0.09)';
      g.beginPath();
      g.arc(0, 0, 25, -Math.PI / 2 + TAU * hpFrac, -Math.PI / 2 + TAU);
      g.stroke();
    }

    if (p.focused) {
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = p.ringPhase + (i / 3) * TAU;
        g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18);
        g.arc(0, 0, 18, a, a + 0.9);
      }
      g.stroke();
    }

    g.restore();
  }

  /**
   * LEVELLING UP HAD NO PICTURE, and the key that spends it was a whisper.
   *
   * Two defects, one place, because they are the same event seen twice.
   *
   * FIRST: crossing a level threshold is silent. `world.ts`'s shard pickup
   * calls `prog.grantShard` and DISCARDS the `{ gained }` it returns; nothing
   * anywhere reacts to the level rising. Every other reward in this game got
   * an acknowledgement in some earlier pass — shards got a sound, wells got a
   * renderer, beams got drawn — and the biggest one in the progression, the
   * thing the whole XP economy exists to produce, produced nothing at all. The
   * ring below is that receipt. It is drawn from the SNAPSHOT rather than from
   * an event because `src/game/` is another workstream's file and a renderer
   * watching a number it is already handed needs nothing from it.
   *
   * SECOND: offers BANK now (`world.ts`: "level up screen pops up too often,
   * space bar to pull up level ups"), and the only thing telling the player so
   * was 9px of text at the bottom edge of the screen. Photographed at wave 23:
   * EIGHT banked level-ups, the notice reading exactly as loud as it does at
   * one, printed across the band the enemies arrive through. A bot ran a whole
   * wave eight levels under-spent. A reward the player cannot see is a reward
   * they do not take.
   *
   * IT GOES ON THE SHIP because that is where the eyes are — the same argument
   * `drawPlayer`'s shield arc already makes ("a side-panel readout is useless
   * when your eyes are locked to your hitbox") — and it goes ABOVE the ship
   * because that is the safest real estate on the screen: `spawnring` measures
   * 96.4% of arrivals astern, so the forward quarter is the one place a plate
   * can sit without covering something that can kill you. It is gone the frame
   * the queue empties, so it costs nothing in the ordinary case.
   */
  private drawShipPrompt(g: CanvasRenderingContext2D, alpha: number, dt: number): void {
    const w = this.world;
    const p = w.player;
    const snap = w.snapshot;

    // The pop. Latched on the level rising, and re-armed downward so a retry
    // (which resets the level to 1) does not fire one on the next level-up's
    // behalf or, worse, on every frame of the new run.
    if (snap.level > this.lastLevel && this.lastLevel > 0) this.levelPop = 1;
    this.lastLevel = snap.level;
    if (this.levelPop > 0) this.levelPop = Math.max(0, this.levelPop - dt * 1.7);

    if (p.dead) return;
    const x = lerp(p.prevX, p.x, alpha);
    const y = lerp(p.prevY, p.y, alpha);

    /*
     * CUTTING IT FINE HAD ALMOST NO PICTURE.
     *
     * A graze is worth 60 points, it feeds `sfxGraze`, it drives the lead's
     * shimmer through the director's graze signal and it moves `tension.flow`
     * — and on screen it was two 2px dots for 0.22s, emitted at the ENEMY
     * rather than at the ship. At the densities `arena` measures (p50 19, p90
     * 56) that is invisible. On a treadmill the whole skill is letting bodies
     * stream past close, so the one thing the player is being scored on had
     * the faintest mark on the field.
     *
     * IT IS DRIVEN BY THE RATE, NOT BY THE EVENT, so that it cannot strobe if
     * grazes ever arrive in a burst. `player.grazeRate` is the already-smoothed
     * per-second rate the ARRANGEMENT reads (`layers.ts` opens the shimmer
     * above 1.2), so the picture and the music say the same thing at the same
     * moment, off the same number.
     *
     * WHAT IT ACTUALLY LOOKS LIKE, measured rather than assumed, because the
     * first version of this note asserted grazes come "several times a second"
     * in a crowd and that was wrong. Sampled at 20Hz for 30s at wave 20 under
     * the dodging bot: 3 grazes, rate p50 0.00, p90 0.20, p99 2.64, max 2.92.
     * So this is dark 83% of the time and reaches 0.91 of full at its peak —
     * a soft flare per graze that decays over about a third of a second, not a
     * standing halo. A human threading traffic deliberately will see it far
     * more often than a bot that kites at 430 px/s; that is NOT measured.
     *
     * An earlier 30s sample read the rate at 0.00 throughout and would have
     * shipped a claim that the halo never fires. Small samples lie.
     */
    const graze = clamp01(p.grazeRate / 3.2);
    if (graze > 0.02) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = `hsla(186, 100%, 72%, ${graze * 0.5})`;
      g.lineWidth = 1 + graze * 2.4;
      g.beginPath();
      g.arc(x, y, 30 + graze * 5, 0, TAU);
      g.stroke();
      g.restore();
    }

    if (this.levelPop > 0) {
      // Expanding gold ring, thinning as it goes. Two of them, a beat apart in
      // radius, so it reads as a pulse rather than as a bubble.
      const t = 1 - this.levelPop;
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const tt = clamp01(t - k * 0.18);
        if (tt <= 0 || tt >= 1) continue;
        g.strokeStyle = `hsla(45, 100%, ${72 - k * 8}%, ${(1 - tt) * (0.75 - k * 0.25)})`;
        g.lineWidth = 3 - tt * 2;
        g.beginPath();
        g.arc(x, y, 22 + tt * 130, 0, TAU);
        g.stroke();
      }
      g.restore();
    }

    const n = snap.pendingOffers;
    if (n <= 0) return;

    /*
     * The plate grows with the queue rather than merely repeating itself.
     *
     * One waiting level is a nudge; eight is the player leaving the whole
     * back half of their build on the floor, and the interface said the same
     * sentence at the same size for both. `lift` is the escalation and it is
     * capped at four so a long run does not end up with a billboard.
     */
    const lift = Math.min(1, (n - 1) / 3);
    const scale = 1 + lift * 0.28;
    const label = n > 1 ? `SPACE  ×${n}` : 'SPACE';
    const beat = this.pulse * (0.35 + lift * 0.4);

    g.save();
    g.translate(x, y - 44 - lift * 6);
    g.scale(scale, scale);
    g.font = '800 11px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const tw = Math.max(64, g.measureText(label).width + 22);

    // Plate: opaque, because a translucent one over a bullet hell is the
    // failure `style.css` records at the top of the HUD block — you half-see
    // the thing that is about to hit you.
    g.fillStyle = 'rgba(6,8,15,0.92)';
    g.strokeStyle = `hsla(45, 95%, ${64 + beat * 25}%, ${0.7 + lift * 0.3})`;
    g.lineWidth = 1.4;
    const h = 17;
    const r = h / 2;
    g.beginPath();
    g.moveTo(-tw / 2 + r, -h / 2);
    g.arcTo(tw / 2, -h / 2, tw / 2, h / 2, r);
    g.arcTo(tw / 2, h / 2, -tw / 2, h / 2, r);
    g.arcTo(-tw / 2, h / 2, -tw / 2, -h / 2, r);
    g.arcTo(-tw / 2, -h / 2, tw / 2, -h / 2, r);
    g.closePath();
    g.fill();
    g.stroke();

    g.fillStyle = `hsla(45, 100%, ${80 + beat * 20}%, 1)`;
    g.fillText(label, 0, 0.5);

    // A caret pointing down at the ship, so the plate is attached to the thing
    // it is about rather than floating over the field.
    g.beginPath();
    g.moveTo(-4, h / 2);
    g.lineTo(0, h / 2 + 5);
    g.lineTo(4, h / 2);
    g.closePath();
    g.fillStyle = `hsla(45, 95%, ${64 + beat * 25}%, ${0.7 + lift * 0.3})`;
    g.fill();
    g.restore();
  }

  /** Floating score text at the point of the kill. */
  private drawPopups(g: CanvasRenderingContext2D): void {
    const pops = this.world.popups;
    if (!pops.length) return;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Canvas text is the most expensive thing in this renderer: `strokeText` in
    // particular re-rasterises the glyph outline every call. Only the big ones
    // (bosses, extends) get an outline; the rest lean on a dark shadow, which
    // costs a fraction and reads the same at 12px.
    let font = '';
    for (const p of pops) {
      const t = p.age / 0.95;
      // Pop out fast, then settle — a linear fade reads as a glitch.
      const scale = p.age < 0.1 ? 0.6 + (p.age / 0.1) * 0.55 : 1.15 - (t - 0.1) * 0.15;
      const alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      const size = (p.big ? 17 : 12) * scale;
      const next = `700 ${size.toFixed(1)}px ui-monospace, monospace`;
      if (next !== font) {
        font = next;
        g.font = next;
      }
      if (p.big) {
        g.lineWidth = 3;
        g.strokeStyle = `rgba(4,5,10,${alpha * 0.85})`;
        g.strokeText(p.text, p.x, p.y);
      } else {
        g.fillStyle = `rgba(4,5,10,${alpha * 0.7})`;
        g.fillText(p.text, p.x + 1, p.y + 1);
      }
      g.fillStyle = `hsla(${p.hue}, 100%, ${p.big ? 78 : 86}%, ${alpha})`;
      g.fillText(p.text, p.x, p.y);
    }
  }

  /** Collectible note shards. Small, gold, unmistakably not a threat. */
  private drawNotes(g: CanvasRenderingContext2D): void {
    const notes = this.world.notes;
    if (!notes.length) return;
    g.globalCompositeOperation = 'lighter';
    for (const n of notes) {
      // Fade the last second so a shard about to expire is visibly leaving.
      const fade = n.age > 10 ? 1 - (n.age - 10) : 1;
      g.globalAlpha = 0.5 * fade;
      /*
       * Per TIER, not a fixed green. See `SHARD_HUES` in world.ts for what was
       * wrong with `dot(150)`: every shard looked the same while they are
       * worth different amounts, so the decision the core loop is built on —
       * is that one worth the trip — had nothing to go on.
       *
       * The mint core below stays common to all three on purpose. Shape and
       * core say "this is a shard"; the halo hue says which kind. Encoding the
       * category in the shape and the identity in the colour is also what
       * keeps this legible without colour vision: a drop is a square with
       * letters, a shard is a round notehead, and that distinction survives
       * any amount of hue collapse. `npm run colourblind` checks the rest.
       */
      /*
       * A DIAMOND, NOT A NOTEHEAD. Reported from play: "xp looks too much like
       * enemies".
       *
       * It did, and the old comment below explains why while getting the
       * conclusion wrong: it says shape carries the category and hue carries
       * the identity, and that a shard is "a round notehead" against a drop's
       * lettered square. That distinction works against DROPS. It does not work
       * against ENEMIES, which are also small round coloured bodies -- and
       * enemies are what fills the screen. The three shard hues are 150-ish
       * mint through gold, and `glissando` is hue 150, `arpeggiator` 45. At
       * thirty bodies a round mint dot IS an enemy until you have looked twice,
       * and looking twice is exactly what a bullet hell does not give you.
       *
       * A diamond has no counterpart anywhere in the roster: every enemy body
       * is round or a rounded polygon, every drop is an upright square with
       * letters. It reads as "not a thing that can hurt me" at a glance and at
       * any hue, which is the property the round version never had.
       *
       * The mint core stays, so a shard is still a shard at close range.
       */
      const s = 7.5;
      g.save();
      g.translate(n.x, n.y);
      g.rotate(Math.PI / 4);
      g.drawImage(this.dot(SHARD_HUES[n.tier]), -9, -9, 18, 18);
      g.globalAlpha = fade;
      g.fillStyle = '#b6ffd9';
      g.fillRect(-s / 2, -s / 2, s, s);
      g.restore();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Nova pulses: expanding ledger lines that agree with the beat grid.
   *
   * Two bugs fixed here, both of the same kind — a value the world took care to
   * publish that the renderer then ignored.
   *
   * `n.hue` was hardcoded to 150, so all six auras were the same green when the
   * world writes a hue per instrument precisely so that six different auras look
   * like six different instruments. And the fade ran against a fixed 155 while
   * `maxR` reaches 520 for REQUIEM, so the largest ring in the game — the payoff
   * of a roughly one-in-240 run — was invisible for four fifths of its
   * expansion. Both now read what the world actually said.
   */
  private drawNovas(g: CanvasRenderingContext2D): void {
    const novas = this.world.novas;
    if (!novas.length) return;
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1.4;
    for (const n of novas) {
      // Against its own ceiling, so a small ring and a huge one both fade
      // across their whole travel rather than one of them vanishing early.
      const fade = clamp01(1 - n.r / Math.max(1, n.maxR));
      for (let k = 0; k < 4; k++) {
        const r = n.r - k * 5;
        if (r <= 0) continue;
        g.strokeStyle = `hsla(${n.hue}, 100%, ${68 - k * 6}%, ${fade * (0.75 - k * 0.16)})`;
        g.beginPath();
        g.arc(n.x, n.y, r, 0, TAU);
        g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Beams, sweeps and fields — the instrument shapes that are not projectiles.
   *
   * `World.effects` carries a doc comment headed "THIS IS THE RENDERER'S
   * CONTRACT" and, until now, **no renderer implemented it**. ROSIN BOW and
   * HARMONICS (`beam`) and SNARE ROLL and BLAST BEAT (`arc` at zero speed,
   * which routes to `sweep`) dealt damage and left no mark whatsoever.
   *
   * That is not a cosmetic gap. In the soloist probe, `snare` is last of the
   * roster at 5.2 kills/min and `bow` third from last at 11.0 — **the two
   * weakest instruments in the game are two of the four you cannot see.** A
   * player cannot learn a weapon that leaves no trace, so they never invest in
   * it, so it stays weak. Drawing them is the balance fix.
   *
   * Geometry is taken verbatim from the contract: a beam is a rectangle from
   * (x,y) along `angle`, `length` long and `radius` half-wide; a sweep is a
   * wedge spanning `arc` about `angle` out to `length`; a field is a circle of
   * `radius`. `age / life` is the fade, and `hue` is the colour — read from the
   * effect rather than hardcoded, which is the mistake `drawNovas` above just
   * had corrected.
   */
  private drawEffects(g: CanvasRenderingContext2D): void {
    const effects = this.world.effects;
    if (!effects.length) return;
    g.save();
    g.globalCompositeOperation = 'lighter';

    for (const e of effects) {
      // Ease the tail rather than cutting it: these persist for whole seconds,
      // so a linear fade to nothing reads as the weapon switching off.
      const t = clamp01(1 - e.age / Math.max(0.0001, e.life));
      const fade = t * t * (3 - 2 * t);
      if (fade <= 0.01) continue;

      if (e.kind === 'beam') this.drawBeam(g, e, fade);
      else if (e.kind === 'sweep') this.drawSweep(g, e, fade);
      else this.drawField(g, e.x, e.y, e.radius, e.hue, e.pull, e.age, fade);
    }

    g.restore();
  }

  /**
   * FIELD POOLS. `World.wells` HAD NO RENDERER AT ALL.
   *
   * `docs/plan-passives.md` §8.8 recorded the finding and nothing acted on it:
   * "`Renderer` reads `novas`, `effects`, `notes`, `popups`, `drops`, both
   * bullet pools and the particles, and no drawing code anywhere reads `wells`.
   * BLACK HOLE and TREMOLO FIELD are invisible damage pools." That is the same
   * defect `drawEffects` two functions down was written to fix, found a second
   * time in a second container, and it has cost the same thing twice: a weapon
   * the player cannot see is a weapon they cannot learn, so they never invest
   * in it, so it stays weak.
   *
   * TREMOLO FIELD is a `trail` now and no longer uses this container. BLACK
   * HOLE and DOWNBEAT still do, and they cannot move — `fieldSwallows` is a
   * hardcoded id list and DOWNBEAT is the only fused instrument that keeps the
   * player-thrown charge, which is the single player-triggered weapon input in
   * the game. Their pool is the thing the player is choosing a moment to throw.
   * It should be visible at the moment they throw it.
   *
   * THE RADIUS IS `updateWells`' RADIUS AND NOT `well.radius`. That routine
   * damages and pulls inside `radius * sin(min(1, age/life) * PI) + 40`, so the
   * pool grows, holds and collapses; drawing the flat stat instead would put a
   * circle on screen that is the wrong size for the whole of the well's life
   * and would be a fresh instance of the bug this fixes — a drawn hitbox that
   * is not the hitbox. The formula is duplicated here and that is a real cost;
   * it is annotated at the site in `world.ts` too, and `tools/effectsdraw.mjs`
   * asserts a well at three ages is drawn at three different sizes so the two
   * cannot silently drift apart.
   *
   * The fade never reaches zero, unlike an `Effect`'s: a well is a hazard the
   * player is deciding whether to stand in, and one that goes transparent
   * before it stops dealing damage is worse than one that is never drawn,
   * because it teaches the wrong thing.
   */
  private drawWells(g: CanvasRenderingContext2D): void {
    const wells = this.world.wells;
    if (!wells.length) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const w of wells) {
      const t = clamp01(w.age / Math.max(0.0001, w.life));
      const radius = w.radius * Math.sin(Math.min(1, t) * Math.PI) + 40;
      // Bright while it is young, never below a third: see above.
      const fade = 0.34 + (1 - t) * 0.5;
      this.drawField(g, w.x, w.y, radius, w.hue, w.pull, w.age, fade);
    }
    g.restore();
  }

  /**
   * A bowed string: a bright core inside a soft halo, dimming toward the tip.
   *
   * The gradient along the beam is the point — a bow has more presence at the
   * frog than at the point, and a flat rectangle of colour reads as a laser,
   * which is the one thing this instrument is not.
   */
  private drawBeam(g: CanvasRenderingContext2D, e: Effect, fade: number): void {
    g.save();
    g.translate(e.x, e.y);
    g.rotate(e.angle);

    const len = Math.max(1, e.length);
    const half = Math.max(1, e.radius);
    const wash = g.createLinearGradient(0, 0, len, 0);
    wash.addColorStop(0, `hsla(${e.hue}, 95%, 62%, ${fade * 0.5})`);
    wash.addColorStop(0.7, `hsla(${e.hue}, 95%, 58%, ${fade * 0.26})`);
    wash.addColorStop(1, `hsla(${e.hue}, 95%, 55%, 0)`);
    g.fillStyle = wash;
    g.fillRect(0, -half, len, half * 2);

    // The string itself. Kept narrow and near-white so it stays legible over
    // the halo at any hue.
    const core = g.createLinearGradient(0, 0, len, 0);
    core.addColorStop(0, `hsla(${e.hue}, 100%, 92%, ${fade * 0.95})`);
    core.addColorStop(1, `hsla(${e.hue}, 100%, 80%, 0)`);
    g.fillStyle = core;
    g.fillRect(0, -half * 0.22, len, half * 0.44);

    // A bright root where the bow meets the ship, so the beam reads as coming
    // from the player rather than floating in the field.
    g.fillStyle = `hsla(${e.hue}, 100%, 88%, ${fade * 0.8})`;
    g.beginPath();
    g.ellipse(0, 0, half * 0.5, half, 0, 0, TAU);
    g.fill();

    g.restore();
  }

  /**
   * A struck arc: dim through the swept area, bright along the leading rim.
   *
   * The contract calls this an annular wedge, and the damage volume it
   * describes reaches all the way in to (x,y). So this fills the **whole**
   * wedge — nothing that damages goes unmarked — and puts the emphasis on the
   * outer rim, which gives the annular read without leaving a hole where a
   * player would be hit by something invisible. A drum is struck at the rim.
   */
  private drawSweep(g: CanvasRenderingContext2D, e: Effect, fade: number): void {
    const len = Math.max(1, e.length);
    const from = e.angle - e.arc / 2;
    const to = e.angle + e.arc / 2;

    g.save();
    g.translate(e.x, e.y);

    const body = g.createRadialGradient(0, 0, 0, 0, 0, len);
    body.addColorStop(0, `hsla(${e.hue}, 90%, 60%, ${fade * 0.06})`);
    body.addColorStop(0.72, `hsla(${e.hue}, 95%, 62%, ${fade * 0.2})`);
    body.addColorStop(1, `hsla(${e.hue}, 100%, 70%, ${fade * 0.34})`);
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, len, from, to);
    g.closePath();
    g.fill();

    // The strike edge.
    g.strokeStyle = `hsla(${e.hue}, 100%, 84%, ${fade * 0.9})`;
    g.lineWidth = 2.2;
    g.beginPath();
    g.arc(0, 0, len, from, to);
    g.stroke();

    // The two radial edges, thinner, so the wedge has a shape rather than
    // fading out sideways into the background.
    g.strokeStyle = `hsla(${e.hue}, 100%, 78%, ${fade * 0.35})`;
    g.lineWidth = 1;
    g.beginPath();
    for (const a of [from, to]) {
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    }
    g.stroke();

    g.restore();
  }

  /**
   * A field: a soft disc with a defined rim, plus inward ticks when it pulls.
   *
   * The rim matters more than the fill. A field's edge is where the player
   * needs to know the boundary is, and a pure radial blur has no edge to read.
   */
  private drawField(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    hue: number,
    pull: number,
    age: number,
    fade: number,
  ): void {
    const r = Math.max(1, radius);
    g.save();
    g.translate(x, y);

    const disc = g.createRadialGradient(0, 0, 0, 0, 0, r);
    disc.addColorStop(0, `hsla(${hue}, 90%, 58%, ${fade * 0.3})`);
    disc.addColorStop(0.65, `hsla(${hue}, 90%, 55%, ${fade * 0.13})`);
    disc.addColorStop(1, `hsla(${hue}, 95%, 60%, ${fade * 0.04})`);
    g.fillStyle = disc;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();

    g.strokeStyle = `hsla(${hue}, 100%, 74%, ${fade * 0.55})`;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();

    /*
     * Six ticks marching inward, so a field that pulls looks like it pulls.
     * Driven by `age` rather than by the transport: this is a property of the
     * effect, not of the beat, and the playfield has one thing keeping time
     * already.
     */
    if (pull > 0) {
      const march = (age * 0.9) % 1;
      g.strokeStyle = `hsla(${hue}, 100%, 82%, ${fade * 0.4})`;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + age * 0.35;
        const outer = r * (1 - march * 0.55);
        const inner = outer - r * 0.14;
        if (inner <= 0) continue;
        g.moveTo(Math.cos(a) * outer, Math.sin(a) * outer);
        g.lineTo(Math.cos(a) * inner, Math.sin(a) * inner);
      }
      g.stroke();
    }

    g.restore();
  }

  /**
   * Drone pods: filled noteheads with a radial stem, on a faint dotted orbit.
   * A pod on cooldown becomes a hollow outline, so "not filled in" reads
   * immediately as "this one already saved you".
   */
  private drawDrones(g: CanvasRenderingContext2D): void {
    const p = this.world.player;
    const n = p.droneAngle.length;
    if (!n || p.dead) return;

    g.save();
    g.translate(p.x, p.y);
    g.strokeStyle = 'rgba(180,140,255,0.16)';
    g.lineWidth = 1;
    g.setLineDash([2, 5]);
    g.beginPath();
    g.arc(0, 0, p.droneRadius(), 0, TAU);
    g.stroke();
    g.setLineDash([]);
    g.restore();

    for (let i = 0; i < n; i++) {
      const pos = p.dronePos(i);
      const live = p.droneCooldown[i] <= 0;
      const a = p.droneAngle[i] + (i / n) * TAU;
      g.save();
      g.translate(pos.x, pos.y);

      // Stem points radially outward, so the pods read as notes in orbit.
      g.strokeStyle = live ? 'hsla(265, 100%, 78%, 0.95)' : 'hsla(265, 40%, 60%, 0.4)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
      g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12);
      g.stroke();

      g.rotate(-0.36);
      g.beginPath();
      g.ellipse(0, 0, 5.4, 4, 0, 0, TAU);
      if (live) {
        g.fillStyle = 'hsla(265, 100%, 86%, 0.98)';
        g.fill();
      } else {
        g.stroke();
      }
      g.restore();

      if (live) {
        g.globalCompositeOperation = 'lighter';
        const d = this.dot(265);
        g.globalAlpha = 0.5;
        g.drawImage(d, pos.x - 11, pos.y - 11, 22, 22);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
      }
    }
  }

  /**
   * DAMPER'S CHARGES, AND THIS IS THE WHOLE OF WHAT THE PLAYER CAN SEE OF IT.
   *
   * Every other weapon in the roster announces itself by putting something in
   * the world — a bolt, a ring, a pool, a line. A `guard` puts nothing
   * anywhere: it deals no damage, spawns no object and its entire output is a
   * hit that did not happen. Without this arc the player holding it has no way
   * to tell a charged shield from a spent one, or from a card that does
   * nothing at all.
   *
   * That is the defect `dadbaad` recorded at length and fixed for the status
   * effects — "a burning body, a poisoned one, a frozen one and an untouched
   * one were the same orange teardrop, the simulation delivering and the
   * screen not". A shield with no readout is the same failure with a smaller
   * denominator, and it is the one weapon where the readout IS the feedback.
   *
   * Drawn as `guardMax` arc segments around the ship, filled for the charges
   * in hand and hollow for the ones refilling, so the count and the refill are
   * one picture. Deliberately a different radius and hue from the drone ring
   * above it — two rings of the same colour would read as one broken one.
   */
  private drawGuard(g: CanvasRenderingContext2D): void {
    const p = this.world.player;
    const max = Math.max(0, Math.round(p.guardMax));
    if (!max || p.dead) return;
    /*
     * 27px AND A WIDE GAP, BOTH FROM LOOKING AT IT. At 21px with a 0.24 gap
     * the three segments closed up into a solid ring sitting on top of the
     * ship's own teal outline, so a full shield and an empty one were the same
     * picture — which is the whole defect this method exists to avoid, drawn
     * one radius too small. Out past the hull and visibly segmented, the count
     * is readable at a glance and the spent slots are readable beside it.
     */
    const r = 27;
    const gap = 0.4;
    const seg = Math.max(0.12, TAU / max - gap);
    g.save();
    g.translate(p.x, p.y);
    g.lineCap = 'round';
    for (let i = 0; i < max; i++) {
      const from = -Math.PI / 2 + i * (TAU / max) + gap / 2;
      const live = i < p.guard;
      // A spent slot is drawn, not omitted: "two of three" and "two of two"
      // are different states and the player is choosing between them.
      /*
       * NEAR-WHITE, AND THE FIRST TRY WAS AMBER. Photographed at wave 16 the
       * amber segments sat in a field of amber enemies and read as three more
       * of them; the drones already own violet and the hull owns teal, so the
       * only unclaimed value in the frame is white. It also says the right
       * thing — this is the ship's own shell, not something in the world.
       */
      g.strokeStyle = live ? 'hsla(188, 95%, 93%, 0.98)' : 'hsla(188, 35%, 68%, 0.35)';
      g.lineWidth = live ? 3.4 : 1.8;
      g.beginPath();
      g.arc(0, 0, r, from, from + seg);
      g.stroke();
    }
    g.restore();
  }

  private drawParticles(g: CanvasRenderingContext2D): void {
    const p = this.world.particles;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < p.count; i++) {
      const life = p.life[i] / p.maxLife[i];
      g.globalAlpha = clamp01(life);
      if (p.shape[i] === ParticleShape.Ring) {
        g.globalAlpha = clamp01(life) * 0.7;
        g.strokeStyle = `hsl(${p.hue[i]}, 100%, 70%)`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p.x[i], p.y[i], p.size[i] * (1.4 - life), 0, TAU);
        g.stroke();
      } else {
        const d = this.dot(p.hue[i]);
        const s = p.size[i] * (0.6 + life);
        g.drawImage(d, p.x[i] - s, p.y[i] - s, s * 2, s * 2);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  private drawDrops(g: CanvasRenderingContext2D): void {
    for (const d of this.world.drops) {
      const def = powerupDef(d.kind);
      const bob = Math.sin(d.age * 6) * 2;
      g.save();
      g.translate(d.x, d.y + bob);
      g.globalCompositeOperation = 'lighter';
      const dot = this.dot(def.hue);
      g.globalAlpha = 0.75;
      g.drawImage(dot, -18, -18, 36, 36);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.strokeStyle = `hsl(${def.hue}, 100%, 70%)`;
      g.lineWidth = 2;
      g.strokeRect(-9, -9, 18, 18);
      g.fillStyle = `hsl(${def.hue}, 100%, 85%)`;
      g.font = 'bold 9px ui-monospace, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(def.label.slice(0, 2), 0, 0.5);
      g.restore();
    }
  }

  /**
   * Centre-screen announcement.
   *
   * A boss phase used to change with no words at all: the pattern simply became
   * different. Naming the moment — and captioning it with the key and groove it
   * just switched into — turns an escalation into an event, and quietly teaches
   * the player that the music and the fight are the same thing.
   */
  private drawBanner(g: CanvasRenderingContext2D): void {
    const w = this.world;
    const age = w.bannerAge;
    if (!w.banner || age > 2.4) return;

    // Slide in fast, hold, fade out.
    const alpha = age < 0.18 ? age / 0.18 : age > 1.7 ? Math.max(0, 1 - (age - 1.7) / 0.7) : 1;
    const slide = age < 0.18 ? (1 - age / 0.18) * 26 : 0;
    // Screen furniture: `drawBanner` runs from `drawOverlay`, outside the
    // camera translate, so this is the middle of the VIEW and not of the field.
    const y = w.viewH * 0.34 + slide;

    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.globalAlpha = alpha * 0.5;
    g.fillStyle = '#05060c';
    g.fillRect(0, y - 30, w.viewW, 60);
    /*
     * Colour by kind, so the type of moment reads before the words do.
     * A boss and a compliment should not look the same.
     */
    /*
     * `fusion` is listed explicitly and takes gold.
     *
     * `docs/progression.md` has the world announce a fusion through this same
     * banner, and an unlisted kind falls through to 210 — the blue of "WAVE 3".
     * The largest payoff in the game would have been drawn exactly like its
     * most routine event. Gold is the colour the offer screen reserves for a
     * fusion, so the two agree.
     */
    const hue =
      w.bannerKind === 'boss' || w.bannerKind === 'phase'
        ? 350
        : w.bannerKind === 'grade'
          ? 45
          : (w.bannerKind as string) === 'fusion'
            ? 45
            : w.bannerKind === 'archetype'
              ? 195
              : w.bannerKind === 'item'
                ? 280
                : 210;
    g.globalAlpha = alpha;
    g.strokeStyle = `hsla(${hue}, 90%, 60%, 0.5)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(w.viewW * 0.18, y - 30);
    g.lineTo(w.viewW * 0.82, y - 30);
    g.moveTo(w.viewW * 0.18, y + 30);
    g.lineTo(w.viewW * 0.82, y + 30);
    g.stroke();

    g.font = '800 30px ui-monospace, monospace';
    g.fillStyle = w.bannerKind === 'grade' ? `hsl(${hue}, 100%, 72%)` : '#ffffff';
    g.fillText(w.banner, w.viewW / 2, y - 6);

    const sub = w.bannerSub || this.bannerDetail;
    if (sub) {
      g.font = '600 12px ui-monospace, monospace';
      g.fillStyle = `hsla(${hue}, 95%, 72%, 0.9)`;
      g.fillText(sub, w.viewW / 2, y + 16);
    }
    g.restore();
  }

  /**
   * Boss bar, XP, damage flash, the vignette, and the level-up screen.
   *
   * All of it is SCREEN space. The overlay context never receives the camera
   * translate, so every rectangle here is measured against the VIEW — and the
   * level-up card layout at the bottom is passed the same two numbers that
   * `main.ts` uses to convert a tap, which is the only thing keeping the cards
   * and their hit test in agreement.
   */
  /**
   * The throttle, as a gauge. Screen space, right edge, on the ship's station.
   *
   * WHY THERE IS ONE AT ALL. The stick's forward axis is the ship's only
   * control in the axis it travels along and the whole of the moment-to-moment
   * decision on a treadmill — and nothing on the screen was a function of it.
   * The starfield and the plume now carry the FEEL of speed; this carries the
   * fact, because "am I above or below cruise" is a question feel cannot
   * answer and the answer decides whether the wave astern catches up.
   *
   * WHY THE RIGHT EDGE AND NOT NEXT TO THE SHIP. Anchored to the ship it would
   * be one more object in the exact spot that is already unreadable at 76
   * bodies, and it would swim about. Pinned to `TRACK_ANCHOR` it sits at the
   * height the ship keeps station at — inside the same glance, never moving —
   * and the right edge is chosen over the left because `.hud-tl` runs to about
   * 200px deep with a full band and eight slot tiles, which reaches the anchor
   * line at a 720-tall window. `.hud-tr` is four short rows and does not.
   *
   * WHY NOT A NUMBER. px/s means nothing to a player. What they need is
   * position against cruise, so the gauge is a track with a notch at the
   * centre and a bar that grows up (faster) or down (slower) from it. Colour
   * moves with it — cool below, hot above — so the direction reads before the
   * length does.
   */
  private drawThrottle(g: CanvasRenderingContext2D): void {
    const w = this.world;
    // Shown from the first frame of the run rather than from `snapshot.running`
    // — the phase stays 'idle' until `beginWave`, which is the far end of the
    // four bars the TUNING UP screen fills, and the ship is under throttle for
    // every one of them. That runway is the best chance the game gets to teach
    // the stick before anything is shooting at the player.
    if (w.choosing || w.isOver || w.snapshot.time <= 0.05) return;
    const H = 96;
    const cx = w.viewW - 26;
    const cy = w.viewH * TRACK_ANCHOR;
    const top = cy - H / 2;
    // Signed distance from cruise: -1 dead slow, 0 cruise, +1 flat out.
    const off = clamp01(this.trimShown) * 2 - 1;
    const notch = cy;

    g.save();
    // Track. Dark enough to read against the blown-out white of a dense kill,
    // which is the case `drawPlayer`'s keyline exists for.
    g.fillStyle = 'rgba(6,8,15,0.82)';
    g.fillRect(cx - 4, top - 3, 8, H + 6);
    g.strokeStyle = 'rgba(150,175,215,0.42)';
    g.lineWidth = 1;
    g.strokeRect(cx - 3.5, top - 2.5, 7, H + 5);

    // The bar, from the cruise notch to where the stick is.
    const y = notch - off * (H / 2);
    const hot = off > 0;
    g.fillStyle = hot ? 'hsla(30, 100%, 64%, 0.95)' : 'hsla(190, 95%, 64%, 0.92)';
    g.fillRect(cx - 3, Math.min(y, notch), 6, Math.abs(y - notch));

    /*
     * Cruise, and the two ends of the range.
     *
     * The datum tick is longer and brighter than the end ones, because the
     * only question the gauge has to answer at a glance is "which side of
     * cruise am I on" — the ends are there to say the track is finite and to
     * stop a bar pinned at the top reading as a bar that has broken. Drawn on
     * a half-pixel so a 1px line lands on one row rather than two grey ones.
     */
    g.strokeStyle = 'rgba(226,234,250,0.78)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - 11, notch + 0.5);
    g.lineTo(cx + 7, notch + 0.5);
    g.stroke();
    g.strokeStyle = 'rgba(226,234,250,0.3)';
    g.beginPath();
    g.moveTo(cx - 8, top + 0.5);
    g.lineTo(cx + 6, top + 0.5);
    g.moveTo(cx - 8, top + H + 0.5);
    g.lineTo(cx + 6, top + H + 0.5);
    g.stroke();

    // The head. A wedge rather than a line so the direction of travel is in
    // the shape as well as in the colour.
    g.fillStyle = hot ? 'hsl(38, 100%, 76%)' : 'hsl(190, 100%, 80%)';
    g.beginPath();
    g.moveTo(cx - 8, y);
    g.lineTo(cx - 14, y - 4);
    g.lineTo(cx - 14, y + 4);
    g.closePath();
    g.fill();

    /*
     * WARP LIVES ON THE THROTTLE, because warp IS the throttle held at its stop
     * and a mode belongs on the control that produces it. Three states, drawn
     * on the same 96px track so the eye never has to look anywhere else:
     *
     *   ARMING     a magenta sleeve grows up the outside of the track as the
     *              1.4s hold accumulates. This is the only warning the player
     *              gets before a mode change, and `WARP_ARM` is chosen on the
     *              assumption that it is drawn — see the constant.
     *   ENGAGED    the sleeve is full, breathing, and captioned WARP. A mode
     *              with no persistent indicator is a mode you can forget you
     *              are in, which for this one means forgetting why the screen
     *              is full.
     *   RELEASING  the sleeve DRAINS as the aft stop is held, so the way out is
     *              as visible as the way in was.
     *
     * A SLEEVE RATHER THAN A SECOND BAR. The track already carries a length
     * (the stick) and a datum (cruise); a second length inside it would be two
     * numbers in one shape. The sleeve is outside the track and reads as a
     * property OF it.
     */
    const charge = w.warpCharge;
    if (charge > 0.001) {
      const lit = w.warping ? 1 - w.warpRelease : charge;
      const h = (H + 6) * clamp01(lit);
      // Breathing only while engaged: an arming sleeve must read as filling,
      // and a pulse on top of a fill makes the fill harder to judge.
      const pulse = w.warping ? 0.78 + Math.sin(w.snapshot.time * 5.4) * 0.18 : 0.9;
      g.fillStyle = `hsla(305, 100%, 66%, ${pulse})`;
      g.fillRect(cx + 6, top + 3 + (H + 6 - h), 3, h);
      g.fillRect(cx - 9, top + 3 + (H + 6 - h), 3, h);
    }
    if (w.warping) {
      g.strokeStyle = `hsla(305, 100%, 72%, ${0.55 + Math.sin(w.snapshot.time * 5.4) * 0.25})`;
      g.lineWidth = 1;
      g.strokeRect(cx - 9.5, top - 3.5, 19, H + 7);
      g.font = '700 9px ui-monospace, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillStyle = 'hsl(305, 100%, 84%)';
      g.fillText('WARP', cx - 1, top - 9);
    }

    g.restore();
  }

  /**
   * How far to the next boss, as a vertical bar up the left edge.
   *
   * THE UNIT IS WAVES AND THAT IS THE FINDING, not a shortcut. The owner asked
   * for "how far away until the next boss", and on a treadmill the obvious
   * reading — distance — is the one quantity that carries no information: the
   * ship travels at `CRUISE_SPEED` for ever, the world is carried with it, and
   * nothing in the boss schedule reads a coordinate. A metre counter would tick
   * up smoothly and correlate with nothing the player can change. What summons
   * a boss is `planWave`'s `index % BOSS_EVERY === 3`, so the honest answer is
   * three waves, or two, or one — and `World.bossProgress` says so.
   *
   * SO IT IS SEGMENTED, one segment per wave, rather than a smooth tube. The
   * segment boundaries ARE the information: a player glancing at it should read
   * "one more wave", not "about three quarters". Inside a segment it advances
   * with that wave's own spawn schedule, which is monotone by construction.
   *
   * WHY THE LEFT EDGE. The throttle took the right edge because `.hud-tl` runs
   * about 200px deep with a full band and eight slot tiles, which reaches the
   * ship's station line at a 720-tall window. This bar is BELOW that: it starts
   * at 0.42 of the view and ends at 0.86, so it clears the tiles above and the
   * XP strip and resume line below, and it is the tallest thing on the screen
   * that is not the field — which is what a progress bar should be when the
   * thing it measures is the only long-term goal the game has.
   *
   * DRAWN ON THE OVERLAY CANVAS rather than added to the DOM HUD. The three
   * corner groups are what `tools/panelshot.mjs` asserts do not collide, and a
   * fourth absolutely-positioned element down the left edge would be a fourth
   * thing to collide. The canvas is measured against the view and cannot push
   * anything.
   */
  private drawBossBar(g: CanvasRenderingContext2D): void {
    const w = this.world;
    if (w.choosing || w.isOver || w.snapshot.time <= 0.05) return;
    const x = 26;
    const top = w.viewH * 0.42;
    const bot = w.viewH * 0.86;
    const H = bot - top;
    if (H < 60) return;
    /*
     * GUARDED THE SAME WAY `vy` AND `tension` ARE AT THE TOP OF `render`, and
     * for the same reason, which `tools/effectsdraw.mjs` demonstrated rather
     * than predicted: a non-finite fraction reaches `hsl(352, NaN%, NaN%)`,
     * which throws inside the colour parser and kills the frame AFTER the
     * background has been cleared — a black screen with no error. It caught
     * this bar on its first run, drawing 128 NaNs, because that harness builds
     * its own world shape and a field it does not know about is `undefined`.
     * The bar simply does not draw rather than drawing wrong: it is a readout,
     * and a readout with nothing behind it should be absent, not zero.
     */
    const frac = Number.isFinite(w.bossProgress) ? clamp01(w.bossProgress) : -1;
    const left = w.wavesToBoss;
    if (frac < 0 || !Number.isFinite(left)) return;
    /*
     * TWO STATES, NOT ONE, and the split was found by photographing it.
     *
     * `wavesToBoss === 0` is "this IS the boss wave" — the escort is on the
     * field and BOSS INCOMING is on the banner. `snapshot.bossActive` is "the
     * boss is here". The first version keyed both the label and the marker to
     * the second, so through the whole four-bar telegraph the bar read
     * `0 WAVES`, which is a countdown that has finished and not an event that
     * has arrived. The label reads the wave and the diamond reads the boss.
     */
    const onBossWave = left === 0;
    const onBoss = w.snapshot.bossActive === true;

    g.save();
    // Track, in the same ink as the throttle's so the two read as one family.
    g.fillStyle = 'rgba(6,8,15,0.82)';
    g.fillRect(x - 4, top - 3, 8, H + 6);
    g.strokeStyle = 'rgba(150,175,215,0.42)';
    g.lineWidth = 1;
    g.strokeRect(x - 3.5, top - 2.5, 7, H + 5);

    /*
     * Fill from the BOTTOM UP, because the boss is drawn at the top and a bar
     * that grows toward its own target is the only arrangement that does not
     * need a legend.
     *
     * ONE HUE, AND IT IS THE BOSS'S OWN. The first version ramped steel blue to
     * red, which looked right in isolation and was wrong on the screen: the
     * ramp passes through magenta at about 0.7, and magenta is WARP — so a bar
     * three quarters of the way to a boss and the warp sleeve on the opposite
     * edge came out the same colour, in the one mode where both are on at once.
     * Photographed, not reasoned about; `tools/_warpshots/b3` is the frame that
     * showed it.
     *
     * So the hue is 352 throughout, which is the boss HP bar's own red, and the
     * fill is carried by SATURATION and LIGHTNESS instead. That also makes the
     * one continuously-varying channel a brightness rather than a hue, which is
     * the channel a colourblind player still has — and the discrete part of the
     * reading (which band, how many waves) was never colour at all: it is the
     * height, the ticks and the numeral.
     */
    const fh = H * frac;
    g.fillStyle = `hsl(352, ${lerp(40, 95, frac)}%, ${lerp(44, 62, frac)}%)`;
    g.fillRect(x - 3, bot - fh, 6, fh);

    // One tick per wave in the cycle. These are the readout: three lines mean
    // four waves, and which band the fill has reached is the answer.
    g.strokeStyle = 'rgba(226,234,250,0.30)';
    g.beginPath();
    for (let i = 1; i < BOSS_EVERY; i++) {
      const ty = Math.round(bot - (H * i) / BOSS_EVERY) + 0.5;
      g.moveTo(x - 7, ty);
      g.lineTo(x + 5, ty);
    }
    g.stroke();

    /*
     * The boss, as a diamond at the top of the climb. Hollow while it is still
     * ahead, filled and breathing once it is on the field — the same two states
     * the bar's own fill has, said again in a shape, because colour alone is
     * not a state a colourblind player can read (`tools/colourblind.mjs`).
     */
    const my = top - 11;
    g.beginPath();
    g.moveTo(x, my - 6);
    g.lineTo(x + 5, my);
    g.lineTo(x, my + 6);
    g.lineTo(x - 5, my);
    g.closePath();
    if (onBoss) {
      g.fillStyle = `hsla(352, 95%, 62%, ${0.7 + Math.sin(w.snapshot.time * 4.2) * 0.28})`;
      g.fill();
    } else {
      g.strokeStyle = 'rgba(226,234,250,0.55)';
      g.lineWidth = 1.2;
      g.stroke();
    }

    /*
     * How many waves are left, under the bar. A numeral rather than a word:
     * the bar carries the shape of the answer and this carries its size, and at
     * 10px in the corner of the eye a digit survives where a sentence does not.
     */
    g.font = '700 13px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = onBossWave ? 'hsl(352, 95%, 72%)' : 'rgba(226,234,250,0.78)';
    g.fillText(onBossWave ? 'BOSS' : String(left), x, bot + 8);
    if (!onBossWave) {
      g.font = '600 8px ui-monospace, monospace';
      g.fillStyle = 'rgba(190,205,235,0.6)';
      g.fillText(left === 1 ? 'WAVE' : 'WAVES', x, bot + 23);
    }
    g.restore();
  }

  private drawOverlay(tension: number, dt: number, beat: number): void {
    const w = this.world;
    const g = this.og;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.clearRect(0, 0, w.viewW, w.viewH);

    const boss = w.enemies.find((e) => e.archetype === 'conductor');
    if (boss) {
      const frac = clamp01(boss.hp / boss.maxHp);
      g.fillStyle = 'rgba(10,12,22,0.75)';
      g.fillRect(40, 22, w.viewW - 80, 12);
      g.fillStyle = `hsl(${lerp(350, 20, 1 - frac)}, 95%, 58%)`;
      g.fillRect(42, 24, (w.viewW - 84) * frac, 8);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 1;
      g.strokeRect(40.5, 22.5, w.viewW - 81, 11);
      // Phase ticks, so the player can see the drops coming.
      g.fillStyle = 'rgba(255,255,255,0.6)';
      for (const t of boss.phaseThresholds) g.fillRect(42 + (w.viewW - 84) * t, 20, 1, 16);
    }

    this.drawBanner(g);

    if (w.camera.flash > 0.01) {
      g.fillStyle = `hsla(${w.camera.flashHue}, 100%, 70%, ${w.camera.flash * 0.5})`;
      g.fillRect(0, 0, w.viewW, w.viewH);
    }

    // Vignette tightens as tension rises — tunnel vision, essentially.
    // Centred on the VIEW: tunnel vision is about where the player is looking,
    // so in a scrolling world it must stay pinned to the middle of the screen
    // rather than to the middle of the arena.
    const step = Math.round(clamp01(tension) * 20);
    let v = this.vignettes.get(step);
    if (!v) {
      const q = step / 20;
      v = g.createRadialGradient(
        w.viewW / 2,
        w.viewH / 2,
        w.viewH * (0.34 - q * 0.12),
        w.viewW / 2,
        w.viewH / 2,
        w.viewH * 0.75,
      );
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(${Math.round(q * 40)},0,${Math.round(q * 20)},${0.45 + q * 0.3})`);
      this.vignettes.set(step, v);
    }
    g.fillStyle = v;
    g.fillRect(0, 0, w.viewW, w.viewH);

    /*
     * AFTER THE VIGNETTE, and this was found by photographing it rather than
     * by reasoning about it.
     *
     * The gauge lives at the right EDGE, which is exactly where the vignette
     * is darkest — up to 0.75 alpha of near-black at high tension. Drawn
     * before it, a 0.92-alpha cyan bar came out grey and the track was
     * invisible against the room's colour. The boss bar above gets away with
     * being under the vignette because it sits across the top middle, where
     * the gradient has barely started.
     */
    /*
     * WARP, AS A FRAME AROUND THE WHOLE PICTURE.
     *
     * The gauge says warp is on and the banner said it once; neither is enough
     * on its own, because the gauge is 20px wide at the far right and the
     * banner is gone in two seconds. An invisible mode is a bug, and the mode
     * this one is easiest to forget being in is the one where the screen is
     * already full of things to look at.
     *
     * A RIM RATHER THAN A TINT. A wash over the field would fight the vignette
     * (which is at its darkest exactly here), would recolour every enemy the
     * player is reading, and would collide with `camera.flash`. The rim is at
     * the edge where nothing is happening, it is the only magenta on the screen
     * outside the gauge, and it breathes so it cannot be mistaken for part of
     * the cabinet. It is drawn from `warpShown`, so it arrives over about a
     * third of a second and leaves over a second — the mode change is an event
     * and the exit is a settle.
     *
     * AFTER the vignette, for the throttle's reason: under 0.75 alpha of
     * near-black a magenta line at the edge is a grey one.
     */
    if (this.warpShown > 0.01) {
      const beat = 0.72 + Math.sin(w.snapshot.time * 5.4) * 0.28;
      g.save();
      g.strokeStyle = `hsla(305, 100%, 68%, ${this.warpShown * beat * 0.5})`;
      g.lineWidth = 3;
      g.strokeRect(2.5, 2.5, w.viewW - 5, w.viewH - 5);
      g.strokeStyle = `hsla(305, 100%, 82%, ${this.warpShown * beat * 0.3})`;
      g.lineWidth = 1;
      g.strokeRect(6.5, 6.5, w.viewW - 13, w.viewH - 13);
      g.restore();
    }

    this.drawThrottle(g);
    /*
     * The boss bar shares the throttle's argument for being drawn after the
     * vignette: it lives at the left EDGE, where the gradient is darkest, and a
     * dark-red bar under 0.75 alpha of near-black is a bar nobody can see.
     */
    this.drawBossBar(g);

    /*
     * THE XP BAR MOVED OUT OF THE CANVAS.
     *
     * `drawXp` used to be here: four pixels along the TOP edge with `LV n` at
     * the left end, written to `docs/progression.md`'s spec — "thin, along an
     * edge, not a widget". That spec is still met; the bar is now `#ui-xp` in
     * the overlay HUD, full width along the BOTTOM edge, with the level and the
     * count centred above it.
     *
     * It moved because the overlay HUD has an XP bar of its own by the owner's
     * brief ("bottom-centre: XP bar") and two of them is worse than either. The
     * top edge lost the argument for two reasons: the HUD's vitals and slot
     * tiles are anchored top-left and `LV 1` was drawing underneath the shield
     * pips, and the bottom edge of a survivor screen is the emptiest part of
     * it — the ship lives near the middle and the threat arrives on the ring.
     *
     * The DOM version is also strictly cheaper: one style write when the
     * fraction changes by a tenth of a percent, against four `fillRect`s and a
     * `fillText` every frame.
     */
    this.attachHook();
    // Last, so the level-up screen sits over the vignette, the boss bar and the
    // banner rather than under them.
    this.levelUp.draw(g, w.snapshot, dt, w.viewW, w.viewH, beat, this.pulse);
  }
}
