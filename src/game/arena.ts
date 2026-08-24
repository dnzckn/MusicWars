/**
 * The size of the world. The only place it is written down.
 *
 * WHY THIS FILE EXISTS. These two numbers used to live in five places at once:
 * `world.ts` declared them, both `<canvas>` elements in `index.html` carried
 * their own copies as attributes, `src/style.css` restated the ratio in an
 * `aspect-ratio` rule *and* — with a different, stale pair — in the height
 * clamp beside it, and `electron/main.cjs` regex-read the declaration back out
 * of `world.ts` with a hardcoded fallback for when the read failed. Twenty-one
 * tools mention the dimensions besides.
 *
 * That is not a tidiness complaint. **The last time this constant moved it
 * silently zeroed `tools/contrast.mjs`**: the field went 720x960 -> 900x1120,
 * the tool kept its own copy, every sample landed on background, and the check
 * reported a total readability failure that was entirely its own. The tool was
 * right about everything except the one number nobody thought of as an input.
 * `world.ts`'s own comment block records the same trap from the other side —
 * the arena conversion left the field the wrong SHAPE for a survivor game and
 * said so in writing, because moving it meant editing three files in two
 * languages and hoping.
 *
 * So: one declaration, and every other surface derives from it at run time.
 *
 *   - TypeScript, and every tool that imports the simulation: `import` it.
 *   - `index.html`: the boot script publishes `--world-w` / `--world-h` on
 *     `<html>` and sizes both canvases from these values. Neither canvas
 *     carries width/height attributes any more.
 *   - `src/style.css`: reads those two custom properties. `#stage` stays
 *     `visibility: hidden` until the boot script has published them, so the
 *     page can never paint a stage at a shape that came from anywhere else —
 *     there is no fallback pair to drift, because there is no fallback pair.
 *   - `electron/arena.cjs`: parses the two lines below (a CJS main process
 *     cannot import TypeScript). It is the one derived copy that is a *read*
 *     rather than a reference, and `tools/fieldsize.mjs` fails if it drifts.
 *
 * `tools/fieldsize.mjs` measures the agreement at the output — live world
 * dimensions, the rendered stage box, both canvas backing stores, and a pixel
 * drawn at a known world coordinate located in a real screenshot — because a
 * check that greps the sources for stray numbers would pass the day someone
 * writes the stale number as `9e2`.
 *
 * MOVING THE WORLD. Change the two numbers here and nothing else: that is the
 * whole point of the file, and it is what Stage 1 of the master plan's G6 is
 * meant to be able to do. It is not free, though — the tuning that is
 * calibrated *against* the old size does not derive from anything. Spawn rings,
 * threat radii, bullet caps, the follow camera that does not exist yet, and the
 * baselines listed under "Track G" in `docs/MASTER_PLAN.md` §4 all have to move
 * with it, in the same change.
 *
 * ---
 *
 * The history of the numbers themselves, kept from `world.ts`:
 *
 * The field was widened from 720x960. "Perhaps expand the map size", asked for
 * alongside "enemies that shoot should be rare, they should move slower, and
 * take a few more hits" — the same wish from two directions. A bigger field is
 * what makes fewer, tougher enemies read as a stage you pick apart instead of a
 * swarm you flinch at: there is somewhere to go, and a bullet crossing it gives
 * you time to decide. It was widened proportionally more than it was heightened
 * (0.75 -> 0.80 aspect) because lateral room is the axis dodging actually uses.
 *
 * And it is still the wrong shape, unchanged by the arena conversion and
 * deliberately unchanged by this one. A survivor arena wants to be square or
 * landscape; 900x1120 is a shmup's aspect ratio, and it means the ring the
 * enemies arrive on is 25% further away north and south than east and west.
 * `edgePoint` spawns against the rectangle so the geometry is correct, it is
 * just not symmetric. THIS FILE DOES NOT FIX THAT. Unifying the constant and
 * moving it are two changes, and they ship separately on purpose: this one has
 * to be provably a no-op before the one that changes the game is safe to judge.
 */

/** The world's width in simulation pixels. */
export const PLAYFIELD_W = 900;

/** The world's height in simulation pixels. */
export const PLAYFIELD_H = 1120;
