/**
 * The renderer runs sandboxed with context isolation, so nothing from Node
 * reaches the page. This exposes one read-only object, and it exists for the
 * verification tools rather than for the game: `tools/desktopcheck.mjs` attaches
 * over CDP and needs to know it is looking at the desktop shell and not a
 * stray browser tab pointed at the same dev server.
 *
 * The game itself does not read this. src/ has no idea it is in Electron, which
 * is the property worth keeping: the same bundle is the web build.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('musicwarsDesktop', {
  shell: 'electron',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform,
});
