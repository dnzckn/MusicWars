/**
 * Import the game's TypeScript straight into Node, with no browser.
 *
 * Every other check in this directory reaches its module through the dev server
 * (`page.evaluate(() => import('/src/...'))`), because Vite is what resolves the
 * extensionless imports the source is written with, and because most of what
 * they measure needs a live AudioContext anyway.
 *
 * Progression needs neither. It is pure logic with no DOM, no Strudel and no
 * clock, so making it depend on a headless browser would import three failure
 * modes for nothing — and this directory's README already documents two
 * separate sessions lost to browsers interfering with each other. Node 22.6+
 * strips types on its own; the only thing missing is that Node's resolver will
 * not try `./weapons.ts` for a specifier written `./weapons`. That is what this
 * hook adds, and it is the whole file.
 *
 * Usage — the static import must come first so the hook is registered before
 * any dynamic import is evaluated:
 *
 *     import './lib/ts.mjs';
 *     const P = await import('../src/game/progression.ts');
 *
 * Limits worth knowing before reaching for this elsewhere: type stripping
 * refuses `enum` and `namespace`, and it does not typecheck. `npm run
 * typecheck` is still the thing that decides whether the source is correct;
 * this only decides whether it runs.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
