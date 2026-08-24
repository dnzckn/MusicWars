/**
 * The panel fits its contents at every window size.
 *
 * The panel was a fixed 268px while roughly 490px of a 1440px window sat empty:
 * the playfield is a fixed 3:4 portrait (conventional for the genre, and the
 * simulation is 900x1120, so stretching it would distort the game), which makes
 * the leftover space horizontal. It now grows to 420px when there is room.
 *
 * That immediately broke something: the score canvas was width:100% of a
 * 520x300 intrinsic, so a wider panel made it proportionally taller — 140px to
 * 227px — and pushed the generated code out of the panel, losing the `scale`
 * line entirely. This checks both halves: nothing overflows the window, and the
 * code still fits inside the panel.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const bad = [];
// Counted across every viewport, not per page: the per-page const was read
// after the loop had closed over it, so this check crashed with a ReferenceError
// before it ever printed its verdict.
let reloads = 0;
for (const [w, h] of [[1920, 1080], [1440, 900], [1200, 800], [1000, 800]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const pageReloads = await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(2200);
  if (w === 1440) { await installDriver(p, 'dodge'); await p.waitForTimeout(9000); await p.screenshot({ path: '/tmp/panel.png' }); }
  console.log(`${w}x${h}`, JSON.stringify(await p.evaluate(() => {
    const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return Math.round(b.width); };
    const over = document.body.scrollWidth > window.innerWidth;
    if (over) window.__over = true;
    return { stage: r('stage'), panel: r('panel'), score: r('ui-notation'), bodyOverflow: over };
  })));
  if (await p.evaluate(() => !!window.__over)) bad.push(`${w}x${h}: the page scrolls sideways`);
  /*
   * Force a crowded panel before measuring.
   *
   * This check passed for three iterations while the code block was clipped in
   * ordinary play, because it happened to sample moments when ON STAGE listed a
   * single archetype. The panel's height budget depends on its content, so a
   * fixed-content check tests the easy case only.
   */
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.player.maxActive = 5;
    for (const k of ['drones', 'rapid', 'nova', 'spread']) w.player.addPowerup(k, 90);
  });
  await p.waitForTimeout(1200);

  const fit = await p.evaluate(() => {
    const panel = document.getElementById('panel').getBoundingClientRect();
    const code = document.querySelector('.code');
    const cr = code.getBoundingClientRect();
    return { clipped: cr.bottom > panel.bottom + 1, lines: code.textContent.trim().split('\n').length };
  });
  if (fit.clipped) bad.push(`${w}x${h}: the code block is clipped out of the panel`);
  if (fit.lines < 5) bad.push(`${w}x${h}: only ${fit.lines} code lines visible`);
  reloads += pageReloads();
  await p.close();
}
if (reloads > 0) console.log(`WARNING: page reloaded ${reloads}x mid-run — these numbers span more than one build`);
await b.close();
for (const x of bad) console.log('PANEL:', x);
console.log(bad.length ? 'THE PANEL DOES NOT FIT' : 'THE PANEL FITS AT EVERY SIZE');
process.exit(bad.length ? 1 : 0);
