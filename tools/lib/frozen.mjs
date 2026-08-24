/**
 * Hold a measuring page still while somebody else is editing the source.
 *
 * The README's warning — do not edit src/ while a browser check is running,
 * because Vite HMR full-reloads the page and wipes the check's state — assumes
 * one person at a time. With two workstreams editing concurrently a six-minute
 * continuous run cannot finish: the first attempt at a baseline died on
 * "Execution context was destroyed, most likely because of a navigation",
 * which is that warning arriving as a crash rather than as bad numbers.
 *
 * Vite's client only reloads on a message over its HMR websocket, so mocking
 * the websocket makes the page immune. The page then keeps running whatever it
 * loaded at navigation time, which is what a measurement needs: one build,
 * start to finish. Nothing in this game opens a websocket of its own, so
 * mocking all of them is safe.
 *
 * It does NOT protect against loading a half-saved file at startup — check the
 * hashes of the files you are not changing around the run for that.
 */
export async function freezePage(page) {
  await page.routeWebSocket(/.*/, () => {
    // Accepted, never connected to the server: no update, no full-reload.
  });
  let reloads = 0;
  page.on('load', () => reloads++);
  return () => Math.max(0, reloads - 1);
}
