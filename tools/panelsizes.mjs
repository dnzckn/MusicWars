/**
 * The HUD, looked at rather than measured, at four window sizes.
 *
 * `panelshot` asserts the corner groups stay inside the playfield, do not
 * overlap each other and do not let the page scroll — but a layout can satisfy
 * all three and still look wrong, and this session has twice shipped a change
 * that measured as an improvement and read as a regression. These are for
 * looking at. It asserts nothing on purpose.
 *
 * It used to shoot the 268-460px sidebar at the three widths that sidebar had.
 * The sidebar is gone (`docs/plan-refactor-3.md` §5), so the sizes here are now
 * the ones where the VIEW policy in `field.ts` does something different: 1000
 * is under the span floor and zooms out, 1512 is inside the band at 1:1, 1920
 * is at the span ceiling, and 3440 is where the aspect clamp pillarboxes.
 *
 * The whole window is captured rather than a clipped box: the point of the
 * change was that the playfield IS the window, so a crop of one corner would
 * hide the thing being judged.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const OUT = process.env.OUT ?? '/tmp';
for (const [w, h] of [[1000, 800], [1512, 945], [1920, 1080], [3440, 1440]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const reloads = await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(2200);
  await installDriver(p, 'dodge');
  await p.waitForTimeout(9000);
  // Crowd it the way panelshot does: a full loadout and a wave rule are the
  // states where the panel has the least room left.
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.player.maxActive = 5;
    for (const k of ['drones', 'rapid', 'nova', 'spread']) w.player.addPowerup(k, 90);
    w.movement = 'flank';
    w.combo = 14;
    w.comboTimer = 60;
    // A full 4+4 band, so the slot tiles are the crowded case rather than one
    // tile and seven dashes. Fresh object per read — `writeSnapshot` clears
    // `abilities` in place; see the same note in `panelshot`.
    const full = { ember: 3, chime: 2, tremolo: 3, nocturne: 1, capo: 3, resonance: 2, laser: 2, spread: 1 };
    Object.defineProperty(w.snapshot, 'abilities', {
      configurable: true, get: () => ({ ...full }), set: () => {},
    });
  });
  await p.waitForTimeout(1500);
  const m = await p.evaluate(() => ({
    stage: document.getElementById('stage').getBoundingClientRect().width,
    view: `${window.__musicwars.world.viewW}x${window.__musicwars.world.viewH}`,
  }));
  await p.screenshot({ path: `${OUT}/hud-${w}.png` });
  console.log(`${w}x${h}  stage ${Math.round(m.stage)}px wide, view ${m.view} -> ${OUT}/hud-${w}.png`);
  if (reloads() > 0) console.log(`  WARNING: page reloaded ${reloads()}x mid-run`);
  await p.close();
}
await b.close();
