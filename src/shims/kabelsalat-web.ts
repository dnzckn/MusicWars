/*
 * A stub for `@kabelsalat/web`, which `@strudel/core` imports and which is not
 * installed.
 *
 * WHY THIS EXISTS. `node_modules/@strudel/core/dist/index.mjs` has a top-level
 * `import { SalatRepl } from '@kabelsalat/web'`. That package is a declared
 * dependency of @strudel/core and is absent from this install, so:
 *
 *   - `vite build` SUCCEEDS, because Rolldown tree-shakes the unused binding
 *     away before it has to resolve it. The production bundle has never needed
 *     it and does not contain it.
 *   - `vite dev` FAILS, because `optimizeDeps` prebundles @strudel/core as one
 *     chunk and the prebundler resolves every import whether the binding is
 *     reachable or not. The overlay reads "Failed to resolve import
 *     '@kabelsalat/web'" and the whole page is dead.
 *
 * So the dev server was broken while every headless gate stayed green, which is
 * exactly the shape of defect this repo keeps finding: the thing nobody runs is
 * the thing that rots.
 *
 * THE NODE SIDE ALREADY DOES THIS. `tools/lib/headless-audio.mjs` installs a
 * resolve hook returning `data:text/javascript,export class SalatRepl {}` for
 * this specifier, with its own note explaining that @strudel/core will
 * otherwise fail before anything can import it. This is the same fix for the
 * browser, aliased in `vite.config.ts`, so both halves of the project agree
 * about a dependency neither of them uses.
 *
 * SalatRepl is a live-coding REPL for the Kabelsalat synthesis language. This
 * game drives superdough directly through its own director and never
 * instantiates one; nothing in `src/` references it. If a future change does
 * want it, install the real package and delete this file rather than growing
 * the stub — a stub that starts acquiring methods is a fake implementation, and
 * that is a different and much worse thing than an honest placeholder.
 */
export class SalatRepl {}
export default { SalatRepl };
