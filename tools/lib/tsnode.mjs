/**
 * Import the game's TypeScript sources straight into Node, with no browser.
 *
 * WHY THIS EXISTS. Every check in this directory that touches the simulation
 * drives a real Chromium through Playwright, because the simulation and the
 * audio engine used to be inseparable. They are not: `src/game/*` and
 * `src/core/*` import nothing from the DOM, from Strudel or from Web Audio —
 * the whole point of the `GameSnapshot` boundary is that the world can be run
 * without any of it. Nothing had ever taken that up.
 *
 * It became worth doing when this machine lost its Chromium: `/tmp/chromedeps`
 * is gone, `libnss3`/`libnspr4`/`libasound2t64` are not installed and there is
 * no root, so every browser check fails before it launches. A harness that
 * needs no browser is not a workaround for that — it is faster, it is
 * deterministic, and it can run a hundred simulated minutes in the time
 * Playwright takes to open a page.
 *
 * WHAT IT CANNOT DO, and this matters as much as what it can: there is no
 * audio, no renderer and no frame pacing here. It can measure the ARENA — kill
 * rate, XP pacing, how encircled the player gets, whether a wave ends — and it
 * can say nothing whatever about whether the music is right. `smoke`,
 * `audiocheck`, `mixaudit` and the rest are not replaced by this and never
 * will be.
 *
 * Two Node features do the work. `--experimental-transform-types` compiles TS
 * rather than merely stripping it, which is required because `bullets.ts` uses
 * a `const enum` and that is not erasable syntax. `registerHooks` resolves the
 * extensionless relative imports the browser build gets from Vite.
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXTENSIONS = ['.ts', '.mjs', '.js'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
      const parent = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
      for (const ext of EXTENSIONS) {
        const candidate = new URL(specifier + ext, parent);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
