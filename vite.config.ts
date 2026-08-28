import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      /*
       * `@strudel/core` imports `SalatRepl` from `@kabelsalat/web`, which is a
       * declared dependency of that package and is NOT INSTALLED here.
       *
       * `vite build` survives it — Rolldown tree-shakes the unused binding
       * before it has to resolve it — but `vite dev` does not, because
       * `optimizeDeps` below prebundles @strudel/core as one chunk and the
       * prebundler resolves every import whether or not the binding is
       * reachable. The result was a dev server that served nothing but an
       * error overlay while every headless gate stayed green.
       *
       * `tools/lib/headless-audio.mjs` already installs exactly this stub as a
       * Node resolve hook, for exactly this reason. This is the browser half,
       * so both agree about a dependency neither uses.
       */
      '@kabelsalat/web': fileURLToPath(new URL('./src/shims/kabelsalat-web.ts', import.meta.url)),
    },
  },
  build: {
    // Strudel's dists are modern ESM and inline their AudioWorklets as data:
    // URLs. Downlevelling them buys nothing and risks breaking the worklets.
    target: 'esnext',
    chunkSizeWarningLimit: 900,
  },
  optimizeDeps: {
    // Prebundle Strudel as one chunk rather than a request waterfall in dev.
    // No target override here: Vite 8 prebundles with Rolldown, and `build.target`
    // above already keeps the audio engine from being downlevelled.
    include: ['@strudel/core', '@strudel/mini', '@strudel/webaudio', '@strudel/tonal'],
  },
});
