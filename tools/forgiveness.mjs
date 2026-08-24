/**
 * How many hits does a run actually absorb before it ends?
 *
 * The safety net was built up in answer to "give me a chance": four lives at
 * three shields each, an auto-bomb that refunded the fatal hit whenever a bomb
 * was in reserve, an ENCORE drop the game sends when a run is nearly over, and
 * score extends. The complaint is now "too easy very quickly", so the total
 * needs a number rather than an intuition.
 *
 * Counts hits landed on the player from a fresh run until the run actually
 * ends, driving damage through the real hit path.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  const hit = Object.getPrototypeOf(w).onPlayerHit.bind(w);
  let hits = 0, autoBombs = 0;
  for (let i = 0; i < 200 && !w.player.dead; i++) {
    w.player.invuln = 0;
    if (w.player.takeHit()) {
      hits++;
      if (w.player.lastHitAutoBombed) autoBombs++;
      hit();
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return { hitsAbsorbed: hits, autoBombSaves: autoBombs, dead: w.player.dead };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
console.log(`a run absorbs ${r.hitsAbsorbed} hits before it ends (${r.autoBombSaves} of them refunded by a bomb)`);
process.exit(r.dead ? 0 : 1);
