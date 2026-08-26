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
 * The field, widened from 720x960.
 *
 * "Perhaps expand the map size", asked for alongside "enemies that shoot should
 * be rare, they should move slower, and take a few more hits" — the same wish
 * from two directions. A bigger field is what makes fewer, tougher enemies read
 * as a stage you pick apart instead of a swarm you flinch at: there is somewhere
 * to go, and a bullet crossing it gives you time to decide.
 *
 * Widened proportionally more than it is heightened (0.75 -> 0.80 aspect)
 * because lateral room is the axis dodging actually uses, and because the stage
 * is height-limited on screen — a wider field is physically larger in the
 * window as well as in simulation units, which puts the horizontal space a
 * 1440px window was wasting to work.
 *
 * Everything downstream reads `world.width`/`world.height`; only the two canvas
 * elements and the CSS aspect-ratio carry the numbers separately.
 */
/*
 * DELIBERATELY UNCHANGED BY THE ARENA CONVERSION, and this is the wrong shape.
 *
 * A survivor arena wants to be square or landscape; 900x1120 is a shmup's
 * aspect ratio and it means the ring the enemies arrive on is 25% further away
 * north and south than east and west. The conversion works anyway — `edgePoint`
 * spawns against the rectangle so the geometry is correct, it is just not
 * symmetric — but a squarer field would be better and 1000x1000 is the
 * recommendation.
 *
 * It is not changed here because the number lives in three places and only one
 * of them is in this file: `src/style.css` carries a hardcoded
 * `aspect-ratio: 900 / 1120` and the two canvas elements in `index.html` carry
 * their own copies, and both belong to another workstream. Moving the field
 * without moving those makes the simulation and the viewport disagree, and the
 * last time this constant moved it silently broke `tools/contrast.mjs`
 * completely — that tool kept its own copy and then reported a total
 * readability failure that was entirely its own.
 *
 * Those two files describe the VIEW, though, not the field — see below. When
 * the field finally grows it is `VIEW_W/H` that must stay pinned to them.
 */
export const PLAYFIELD_W = 900;
export const PLAYFIELD_H = 1120;

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
