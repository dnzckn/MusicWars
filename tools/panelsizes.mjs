/**
 * The panel, looked at rather than measured, at the three widths it has.
 *
 * `panelshot` asserts the code block is not clipped and the page does not
 * scroll sideways, which is the failure that has actually happened — but a
 * layout can satisfy both and still look wrong, and this session has twice
 * shipped a change that measured as an improvement and read as a regression.
 * These are for looking at. It asserts nothing on purpose.
 *
 * 1440 -> the panel at its 460px cap. 1200 -> mid, 440px. 1000 -> the 268px
 * floor, where the type has the least room and the source has to fit anyway.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
for (const [w, h] of [[1440, 900], [1200, 800], [1000, 800]]) {
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
  });
  await p.waitForTimeout(1500);
  const box = await p.locator('#panel').boundingBox();
  await p.screenshot({ path: `/tmp/panel-${w}.png`, clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 } });
  console.log(`${w}x${h} panel ${Math.round(box.width)}x${Math.round(box.height)} -> /tmp/panel-${w}.png`);
  if (reloads() > 0) console.log(`  WARNING: page reloaded ${reloads()}x mid-run`);
  await p.close();
}
await b.close();
