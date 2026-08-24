/**
 * The world's dimensions, for a CommonJS main process that cannot import them.
 *
 * WHY THIS IS A SEPARATE FILE, AND WHY IT IS THE ONE COPY THAT IS ALLOWED.
 * `src/game/arena.ts` is the single declaration of the field size and everything
 * else in the project derives from it by importing it or by reading a CSS
 * custom property the boot script publishes from it. Electron's main process
 * can do neither: it is CommonJS, it runs before any renderer exists, and it
 * needs the size *to decide how big to make the window* — which is the one
 * moment there is no page to ask.
 *
 * So it parses the declaration out of the source, which is what
 * `electron/main.cjs` already did inline. Two things changed:
 *
 *   1. It reads `src/game/arena.ts` rather than `src/game/world.ts`, because
 *      that is where the declaration lives now.
 *   2. It lives here, exported, so `tools/fieldsize.mjs` can require it and
 *      compare what Electron would actually use against what the game actually
 *      is — including `FALLBACK`. That fallback is the genuinely dangerous
 *      line in this file: it is reached only in a packaged build with no
 *      `src/`, i.e. in the shipped product and never on a developer's machine,
 *      so drift there is invisible until a player sees a letterboxed game.
 *      A number nobody can observe going wrong is exactly the shape of every
 *      disaster this project has recorded, so it is measured instead.
 *
 * The parse is deliberately narrow. It matches an exported `const` assignment
 * of a plain integer and nothing else; if `arena.ts` ever grows an expression
 * there, this returns the fallback and `fieldsize` fails loudly rather than
 * shipping a window built on a guess.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src/game/arena.ts');

/**
 * What a packaged build uses when there is no `src/` to read.
 *
 * Kept in sync by `tools/fieldsize.mjs`, which fails if it stops matching
 * `arena.ts`. Do not edit it by hand without running that.
 */
const FALLBACK = { w: 900, h: 1120 };

/** The declared field size, or `FALLBACK` if the source cannot be read. */
function playfieldSize() {
  try {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const w = /export const PLAYFIELD_W\s*=\s*(\d+)\s*;/.exec(src);
    const h = /export const PLAYFIELD_H\s*=\s*(\d+)\s*;/.exec(src);
    if (w && h) return { w: Number(w[1]), h: Number(h[1]) };
    // Present but unparseable is worth saying out loud: it means the shape of
    // the declaration changed and this reader did not.
    console.warn(`[arena] could not parse PLAYFIELD_W/H from ${SOURCE}; using the packaged fallback`);
  } catch {
    /* Packaged builds have no src/; the fallback is the shipped size. */
  }
  return { ...FALLBACK };
}

module.exports = { playfieldSize, FALLBACK, SOURCE };
