/**
 * How big the world is, and how much of it the screen shows.
 *
 * WHY THIS IS ITS OWN FILE. These four numbers used to live at the top of
 * `world.ts`, which was the right place while `Camera` was a pure screenshake
 * accumulator that needed no idea where it was. A camera with a POSITION has
 * to clamp itself to the field, so `camera.ts` needs them — and `world.ts`
 * imports `camera.ts`, so putting them there makes an import cycle whose
 * failure mode is a temporal-dead-zone crash that depends on which module the
 * bundler happens to evaluate first. A leaf module with no imports of its own
 * cannot have that problem.
 *
 * `world.ts` re-exports all four, so `import { PLAYFIELD_W } from './world'`
 * keeps working and nothing outside this file had to change.
 *
 * A second, smaller reason: a tool that wants the viewport size can import
 * THIS and get four numbers, rather than importing `world.ts` and evaluating
 * the whole simulation to find out how wide the canvas is.
 */

/*
 * The field: 720x960, then 900x1120, now 3000x3000.
 *
 * "The arena is too small" was one of the four launch complaints, and until
 * this line the field WAS the screen — one static rectangle, no scrolling, no
 * camera. It is now eleven times the area and the camera shows one screen of
 * it, which is the change a player actually notices.
 *
 * SQUARE, AND NOT 3x OF 900x1120. The comment this replaces argued the case
 * against itself for two revisions: a survivor arena wants to be square or
 * landscape, 900x1120 is a shmup's portrait aspect, and it meant the ring the
 * enemies arrive on was 25% further away north and south than east and west.
 * Keeping 0.80 while multiplying by three would have preserved that asymmetry
 * at three times the scale. The spawn ring is the VIEW now, so the arrival
 * geometry is symmetric-or-not independently of this number — but the FIELD's
 * shape still decides which corners exist, how far a run can go in each
 * direction, and where the camera clamps. Square is the honest answer to all
 * three.
 *
 * 3000, not the 1000x1000 the old comment recommended. 1000x1000 was written
 * when the field and the screen were the same rectangle, so it was a proposal
 * about the SCREEN. With a camera the two numbers are free of each other, and
 * 3000 is 3.3 screens wide by 2.7 tall — big enough to have somewhere to run
 * to, small enough that `CULL_MARGIN` and the wall-bounce rectangle still mean
 * something and a wave can still end.
 *
 * WHAT DOES NOT MOVE WITH IT. The two `<canvas>` elements in `index.html`
 * describe the VIEW. They stay. That file now says so in a comment, because
 * the previous version of this note warned that moving the field without
 * moving them makes the simulation and the viewport disagree — that warning
 * was correct about the coupling and wrong about the direction, and a reader
 * arriving from either file needs to be told which of the two pairs it
 * belongs to before they "fix" it.
 */
export const PLAYFIELD_W = 3000;
export const PLAYFIELD_H = 3000;

/*
 * WHAT THE CANVAS SHOWS, as opposed to what the simulation contains.
 *
 * `PLAYFIELD_*` is simulation extent and `VIEW_*` is the rectangle the camera
 * shows. THE RULE FOR CHOOSING BETWEEN THEM. If the number decides where
 * something *is* — a spawn ring, a cull margin, the wall a bullet bounces off
 * — it is `PLAYFIELD_*`. If it decides where something is *drawn on the
 * screen* or where a tap lands — the backing-store size, the boss bar, the XP
 * bar, the vignette, the level-up cards and their hit test — it is `VIEW_*`.
 * Getting the second group wrong is silent: `main.ts` spells out the failure,
 * where the cards draw in one place and the hit test believes they are in
 * another.
 *
 * THESE TWO ARE NO LONGER CONSTANTS, and that is the whole of "give the screen
 * back". They were 900x1120 — a portrait strip on a landscape monitor, beside
 * a sidebar that took 30% of the window and 150px of dead margin that took
 * another 10%. Measured on a 1512x945 window before this change: the playfield
 * element was 737px wide, 48.7% of the window. It is the window now.
 *
 * `let`, not `const`, on purpose. Every reader imports the binding rather than
 * copying it (`camera.ts`, `enemies.ts`, `world.ts`'s `viewW`/`viewH`
 * accessors), and an ES module binding is live — reassigning here is seen by
 * all of them on their next read. The alternative, threading a size through
 * six constructors, is the same coupling written out longhand.
 *
 * They still hold 900x1120 until something calls `setView`, so every node-only
 * tool that imports them keeps measuring the same rectangle it always did.
 */
export let VIEW_W = 900;
export let VIEW_H = 1120;

/*
 * FIXED ZOOM, NOT FITTED — bigger window, more world.
 *
 * The two candidate policies:
 *
 *   FITTED   — the view is always 900x1120 of world and a bigger window draws
 *              it at bigger pixels. Balance is untouched by definition. It is
 *              also not what was asked for: the complaint was "the screen is
 *              too small", and a fitted scale answers it with a magnifying
 *              glass.
 *   FIXED    — one world unit is one CSS pixel, so a bigger window SEES more.
 *              This is the one the brief wants and the one taken here.
 *
 * Fixed zoom has a balance consequence, because six things in `world.ts` are
 * defined against the view rectangle: the spawn ring (`spawnRing`), the
 * population census (`populationNearPlayer`), the bullet cull, the
 * player-bullet wall rectangle, `hasEntered` and the drop magnet horizon. A
 * wider view means enemies arrive from further away, spread over more ground
 * for the same target population, and player bolts reach further before they
 * are culled.
 *
 * MEASURED, NOT ASSUMED. `tools/arena.mjs` takes `ARENA_VIEW=WxH` for exactly
 * this; 8 runs x 10 simulated minutes at each of four viewports, card-0 bot:
 *
 *     view          area   kills/min  wave  level  encircle p50/p90  on screen p90
 *     900x1120     1.00x        67.4  17.4   36.6       0.09 / 0.48           25.3
 *     1205x836     1.00x        68.8  17.3   37.9       0.09 / 0.48           25.0
 *     1492x925     1.37x        66.1  17.3   36.5       0.08 / 0.48           27.5
 *     1709x900     1.53x        63.6  17.1   36.1       0.07 / 0.48           29.6
 *
 * Read three things out of that. **Encirclement p90 does not move at all** —
 * 0.48 at every viewport — so the danger signal the whole arena refactor was
 * built around is untouched, and p50 drifts only 0.09 to 0.07. **Shape is
 * free**: 1205x836 is the same AREA as 900x1120 in a landscape rectangle and is
 * within noise of it on every column. **Area costs about 4% of the kill rate
 * per 50% of extra view** (67.4 -> 63.6 at 1.53x), because the spawn ring is
 * the view and a bigger ring is a longer walk; level at ten minutes follows it
 * down by 1.4% and the offer cadence by 0.2s. Hits taken went 12.6 / 12.4 /
 * 16.3 / 14.0 — not monotone, so at eight runs that column is noise rather than
 * a trend, and it is the one worth re-measuring if difficulty is ever tuned.
 *
 * The one number that moves a lot is bullets on screen at p90, 17.1 -> 24.3
 * (+42%), because the cull rectangle is the view: a bolt lives longer before it
 * is discarded. That is range, and it is also frame cost.
 *
 * `VIEW_SPAN_MAX` is what keeps all of the above bounded. Without it a 4K
 * screen would be at 2.7x area rather than 1.53x, off the end of this table.
 *
 * SO IT IS CLAMPED, on the quantity that actually matters — visible AREA, not
 * width or height separately. `VIEW_SPAN_*` are the square root of the visible
 * area, in world units, which is the same thing as "the side of the square
 * that shows as much as this view does". Clamping the span rather than each
 * axis is what keeps the view's aspect ratio equal to the element's aspect
 * ratio at every window size — and if those two ever disagree the world is
 * drawn stretched, because the canvas is `width: 100%; height: 100%` of a box
 * the renderer scales uniformly.
 *
 *   VIEW_SPAN_MIN  sqrt(900 x 1120) = 1004. THE FLOOR IS TODAY. No window,
 *                  however small, may show less world than 900x1120 did; a
 *                  small window zooms out instead. Otherwise "responsive"
 *                  would mean a 1000x700 laptop got a HARDER game than the
 *                  fixed layout it replaced.
 *   VIEW_SPAN_MAX  1240, which is 1.53x today's area. Chosen so a 1080p window
 *                  lands almost exactly on it (its span is 1411) and every
 *                  larger monitor gets the same view at bigger pixels. Without
 *                  a ceiling a 4K screen would show 2.7x the area and a 3000
 *                  wide field would be two thirds visible at once, which is
 *                  the "ultrawide trivialises it" failure.
 */
export const VIEW_SPAN_MIN = 1004;
export const VIEW_SPAN_MAX = 1240;

/*
 * How out-of-square the view is allowed to get.
 *
 * The spawn ring IS the view rect (`world.spawnRing`), so the view's aspect
 * ratio is also the ratio between how far away an enemy arrives from the side
 * and how far away one arrives from above. Today's 900x1120 puts north-south
 * arrivals 25% further out than east-west ones; this file's own note on
 * `PLAYFIELD_*` calls that asymmetry a wart.
 *
 * A window's aspect is not ours to choose, so the honest options are to accept
 * whatever it is or to bound it. Bounded: past 1.9:1 the stage stops widening
 * and gets pillarboxed instead, and past 1:2.1 it stops getting taller. 16:9
 * (1.78) and 16:10 (1.60) are inside the band and untouched, so the clamp
 * costs an ordinary monitor nothing and only bites on a 21:9 ultrawide — where
 * the alternative is arrivals from the east 2.4x further out than from the
 * north, on a view already at the area ceiling.
 *
 * 0.47 rather than a round 0.5 so a modern phone in portrait (390x844, 0.462)
 * fills its window rather than sitting in a letterbox.
 */
export const VIEW_ASPECT_MAX = 1.9;
export const VIEW_ASPECT_MIN = 0.47;

/**
 * How big the playfield ELEMENT should be, in CSS pixels, inside a box of the
 * given size. Aspect-clamped per `VIEW_ASPECT_*`; otherwise the whole box.
 *
 * Separate from `viewForStage` below because they answer different questions
 * and one of them is CSS. This one is "how much of the window does the game
 * occupy"; that one is "how much world does that occupancy show".
 */
export function stageBox(availW: number, availH: number): { w: number; h: number } {
  let w = Math.max(1, availW);
  let h = Math.max(1, availH);
  const a = w / h;
  if (a > VIEW_ASPECT_MAX) w = h * VIEW_ASPECT_MAX;
  else if (a < VIEW_ASPECT_MIN) h = w / VIEW_ASPECT_MIN;
  return { w: Math.round(w), h: Math.round(h) };
}

/**
 * The world rectangle a stage box of this size shows — the policy above,
 * as arithmetic.
 *
 * Pure, and exported, so a tool can ask what a given window would produce
 * without opening a browser. `tools/gridview.mjs` uses it to drive the view to
 * sizes no monitor on this machine has.
 */
export function viewForStage(stageW: number, stageH: number): { w: number; h: number } {
  const w = Math.max(1, stageW);
  const h = Math.max(1, stageH);
  const span = Math.sqrt(w * h);
  const zoom = Math.min(VIEW_SPAN_MAX, Math.max(VIEW_SPAN_MIN, span)) / span;
  return { w: Math.round(w * zoom), h: Math.round(h * zoom) };
}

/**
 * Move the view. Returns true when it actually moved.
 *
 * Everything downstream reads the live binding, so this is the entire plumbing
 * — but two consumers hold DERIVED state that has to be rebuilt, and they are
 * the reason this returns a boolean rather than being a bare assignment:
 * `Renderer` owns a bloom canvas sized at VIEW/4 and a starfield seeded across
 * the view, and both would be the wrong size until something told them.
 * `Renderer.viewChanged()` is that something and `main.ts` calls it.
 *
 * Guarded against nonsense — a zero or NaN width would divide through the
 * whole renderer — because the caller is a resize handler and a resize handler
 * runs while the element is mid-layout.
 */
export function setView(w: number, h: number): boolean {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return false;
  const nw = Math.round(w);
  const nh = Math.round(h);
  if (nw === VIEW_W && nh === VIEW_H) return false;
  VIEW_W = nw;
  VIEW_H = nh;
  return true;
}
