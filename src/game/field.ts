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
 * WHAT DOES NOT MOVE WITH IT. `src/style.css`'s `aspect-ratio: 900 / 1120` and
 * the two `<canvas>` elements in `index.html` describe the VIEW. They stay.
 * Both files now say so in a comment, because the previous version of this
 * note warned that moving the field without moving them makes the simulation
 * and the viewport disagree — that warning was correct about the coupling and
 * wrong about the direction, and a reader arriving from either file needs to
 * be told which of the two pairs it belongs to before they "fix" it.
 */
export const PLAYFIELD_W = 3000;
export const PLAYFIELD_H = 3000;

/*
 * WHAT THE CANVAS SHOWS, as opposed to what the simulation contains.
 *
 * These two numbers used to be the same concept as `PLAYFIELD_W/H` and are
 * still the same VALUE, so nothing on screen moves by their existence. The
 * split is what lets the field grow later without the viewport growing with
 * it: `PLAYFIELD_*` is simulation extent and `VIEW_*` is the rectangle the
 * camera shows.
 *
 * THE RULE FOR CHOOSING BETWEEN THEM. If the number decides where something
 * *is* — a spawn ring, a cull margin, the wall a bullet bounces off — it is
 * `PLAYFIELD_*`. If it decides where something is *drawn on the screen* or
 * where a tap lands — the backing-store size, the boss bar, the XP bar, the
 * vignette, the level-up cards and their hit test — it is `VIEW_*`. Getting
 * the second group wrong is silent: `main.ts` spells out the failure, where
 * the cards draw in one place and the hit test believes they are in another.
 *
 * `src/style.css`'s `aspect-ratio: 900 / 1120` and the two `<canvas>` elements
 * in `index.html` describe the VIEW, not the world. They stay at 900x1120 when
 * the field grows.
 */
export const VIEW_W = 900;
export const VIEW_H = 1120;
