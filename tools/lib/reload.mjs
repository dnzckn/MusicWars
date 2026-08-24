/**
 * Survive the page reloading underneath a measurement.
 *
 * Vite full-reloads on any edit under src/, and this repo is worked on by more
 * than one process at a time — so a measurement can lose its page through no
 * fault of its own. A reload drops the game to the title screen where nothing
 * is playing, which reads as a perfect score on every audio metric: the two
 * quietest, cleanest rows this project has ever printed were a dead page.
 *
 * `tools/README.md` already warns not to edit src during a run. That warning
 * only helps the person who caused it; this helps the tool that suffered it.
 */
export function watchReloads(page) {
  const st = { count: 0 };
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) st.count++; });
  return st;
}

/**
 * Run `body`, and if the page navigated at any point while it ran, re-run
 * `bootstrap` and try again. Returns whatever `body` returns.
 */
export async function retryOnReload(page, st, bootstrap, body, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const before = st.count;
    const out = await body();
    if (st.count === before) return out;
    if (attempt === tries) throw new Error(`page reloaded on every one of ${tries} attempts`);
    console.log(`   (page reloaded mid-measurement — redoing it)`);
    await page.waitForTimeout(1200);
    await bootstrap();
  }
}
