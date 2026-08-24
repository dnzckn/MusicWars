import { defineConfig } from 'vite';

export default defineConfig({
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
