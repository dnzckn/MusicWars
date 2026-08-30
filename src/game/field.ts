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
 * The field: 720x960, then 900x1120, then 3000x3000 — and now 3000 x INFINITE.
 *
 * THE STAGE IS A TREADMILL. The ship always moves forward; the track never
 * ends. So the field is bounded ACROSS the direction of travel and unbounded
 * ALONG it, and these two constants say exactly that. `PLAYFIELD_W` is a real
 * wall the player can reach, see (`Renderer.drawBounds`) and be stopped by.
 * `PLAYFIELD_H` is not a wall at all.
 *
 * FORWARD IS -Y. The art, the horizon gradient, the starfield's downward
 * scroll and the boss's entry bearing all already assumed "up the screen is
 * where you are going"; travelling toward -y is the only direction that costs
 * none of them a change. A run therefore drives `player.y` steadily NEGATIVE
 * and it never comes back.
 *
 * UNBOUNDED, NOT WRAPPED, and the reason is risk rather than elegance.
 *
 *   The alternative is a periodic rebase: keep a finite period, and whenever
 *   the camera passes it add the period back to the y of everything alive.
 *   That keeps every coordinate small — and it requires finding EVERY array
 *   that holds a world y on the frame it happens. In this file's world that is
 *   enemies (x, y AND prevX/prevY AND hopFrom/hopTo AND lungeVX targets), two
 *   bullet pools, particles, drops, shards, wells, novas, summons, effects,
 *   popups, shocks, the grid's lattice state and the camera. Missing one is a
 *   body that teleports a whole period once every few minutes, in a build that
 *   otherwise looks perfect, and there is no gate in this repository that
 *   would catch it. Unbounded has no such failure: it either works everywhere
 *   or nowhere.
 *
 *   The cost of unbounded is float precision, and it was worked out rather
 *   than waved at. The simulation is float64 throughout: at cruise (300 px/s)
 *   a twenty-minute run reaches 360,000 px, where a double's spacing is
 *   6e-11 px. Even a ten-hour session reaches 1.1e7, spacing 2e-9. Nothing in
 *   the simulation is float32.
 *
 *   Two places are NOT float64 and both were checked. `WarpGrid` stores its
 *   lattice in `Float32Array`s — so its rows scroll with the camera and its
 *   home positions are integer multiples of `SPACING` (62); float32 holds
 *   every integer exactly to 16,777,216, i.e. 15.5 hours at cruise, and the
 *   displaced positions sit within 44 px of home where the spacing at 1e6 is
 *   0.0625 px. And Skia's path coordinates are 32-bit: the renderer hands it
 *   world y plus a `translate` of -y, so the cancellation error is one ulp of
 *   the magnitude — 0.03 px at 5e5, 0.5 px at 1e7. The picture degrades at
 *   about eight hours of continuous play and is exact long before that.
 *
 * `Infinity` RATHER THAN A LARGE FINITE NUMBER, deliberately. A field height
 * of 1e9 would let every `clamp(y, 60, height - 60)` and every
 * `y > height + CULL_MARGIN` keep compiling and keep being wrong quietly —
 * exactly the silent re-baseline `docs/research-camera.md` §7b describes.
 * Infinity makes each one either obviously inert or obviously broken:
 * `clamp(y, 60, Infinity)` on a negative y snaps to 60, which is thousands of
 * pixels behind the ship and impossible to miss. Every site that read
 * `this.height` was found this way and converted; `EnemyContext.width/height`
 * were deleted outright because nothing read them.
 *
 * WHAT DOES NOT MOVE WITH IT. The two `<canvas>` elements in `index.html`
 * describe the VIEW. They stay.
 */
export const PLAYFIELD_W = 3000;
export const PLAYFIELD_H = Infinity;

/*
 * THE WINDOW THE SHIP LIVES IN, as fractions of the view height.
 *
 * Star Fox's contract, and the owner's: "you can move forward and backwards
 * too but not too far". The camera advances on its own; the ship may push
 * ahead of it or fall back behind it, inside a band, and may never leave the
 * frame or stop.
 *
 *   TRACK_ANCHOR   where the ship sits with the stick centred: 34% down the
 *                  view. Not the middle, because the screen is not symmetric
 *                  in what it is FOR — and the direction that matters is
 *                  BEHIND. Everything arrives from the stern (`ARRIVAL_ANGLE`
 *                  in `world.ts`), so the ship rides high in the frame and the
 *                  pursuit fills the two thirds below it: 739 px of visible
 *                  chase at the default view, which is where the player has to
 *                  be looking.
 *
 *                  IT WAS 0.60 FOR ONE REVISION, with the ship low and the
 *                  screen ahead of it, because arrivals were ahead. The owner
 *                  reversed that — "enemies spawn infront of me, they should
 *                  only spawn behind me" — and the anchor has to follow the
 *                  threat or the game is played in the strip of screen nobody
 *                  is looking at.
 *   TRACK_AHEAD    the front of the window, 0.16.
 *   TRACK_BEHIND   the back of the window, 0.56. Symmetric about the anchor,
 *                  so the two halves of the stick cost the same to travel.
 *
 * The band is 0.40 of the view — 448 px at 1120 — and at `TRIM_SPEED` either
 * end is 0.8 s away. Deliberately quick: with the crowd travelling WITH the
 * stage, this axis is a dodge and not only a throttle, and a dodge that takes
 * two seconds is not one. Sideways is still faster, at 430 px/s.
 *
 * FRACTIONS OF THE VIEW, not pixels, because the view is responsive: the same
 * band has to mean the same thing on a phone in portrait and on a 1080p
 * window, and `VIEW_SPAN_*` above already bounds how far those two can differ.
 *
 * JUDGED, NOT MEASURED — the same status as the camera's deadzone and
 * lookahead, and for the same reason: no node-only gate can tell you whether a
 * throttle feels like travel. What IS measured is everything downstream of
 * them, because the spawn line, the population census and the cull are all
 * derived from the view these fractions cut up.
 */
export const TRACK_ANCHOR = 0.34;
export const TRACK_AHEAD = 0.16;
export const TRACK_BEHIND = 0.56;

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
