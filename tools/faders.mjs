/**
 * Where the stem faders actually sit over a run.
 *
 * The tension model was found to be capped at half its range and fixed; the
 * arranger's thresholds turned out to have been calibrated against that broken
 * signal and were fixed too. The stem curves read the same signal, so this asks
 * the same question of them: does each layer use its range, or does it pin?
 *
 * A layer that sits at its ceiling most of the time is not being mixed, it is
 * switched on — and eleven of those at once is what "it constantly full
 * throttles all sound type channels" describes.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
import { freezePage } from './lib/frozen.mjs';
const MINUTES = Number(process.env.MINUTES ?? 4);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const rows = await p.evaluate(async (mins) => {
  const mw = window.__musicwars;
  const acc = {};
  const end = performance.now() + mins * 60000;
  let n = 0;
  while (performance.now() < end) {
    const lv = mw.readout().levels;
    for (const [id, v] of Object.entries(lv)) {
      const a = (acc[id] ??= { sum: 0, min: 1, max: 0, high: 0, low: 0 });
      a.sum += v; a.min = Math.min(a.min, v); a.max = Math.max(a.max, v);
      if (v > 0.85) a.high++;
      if (v < 0.15) a.low++;
    }
    mw.world.player.lives = Math.max(3, mw.world.player.lives);
    n++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return Object.entries(acc).map(([id, a]) => ({
    stem: id, mean: +(a.sum / n).toFixed(2), min: +a.min.toFixed(2), max: +a.max.toFixed(2),
    pctNearTop: +((a.high / n) * 100).toFixed(0), pctNearZero: +((a.low / n) * 100).toFixed(0),
    range: +(a.max - a.min).toFixed(2),
  }));
}, MINUTES);
const reloadCount = reloads();
if (reloadCount > 0) console.log(`WARNING: the page reloaded ${reloadCount}x mid-run; these numbers span more than one build`);
await b.close();
console.table(rows);

/*
 * Two failures, opposite in shape. A stem pinned near the top has stopped
 * being an arrangement decision; a stem whose whole run fits in a narrow band
 * is not responding to the game at all, whatever its level.
 */
const pinned = rows.filter((r) => r.pctNearTop > 60);
const inert = rows.filter((r) => r.range < 0.15);
if (pinned.length) console.log(`PINNED near the top: ${pinned.map((r) => `${r.stem} ${r.pctNearTop}%`).join(', ')}`);
if (inert.length) console.log(`BARELY MOVES: ${inert.map((r) => `${r.stem} range ${r.range}`).join(', ')}`);
const ok = pinned.length === 0 && inert.length === 0;
console.log(ok ? 'THE FADERS ARE MIXING' : 'THE FADERS ARE SWITCHES');
process.exit(ok ? 0 : 1);
