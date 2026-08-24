/** Screenshots of states that only appear on specific events. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(9000);

/*
 * A 'grade' banner, fired directly so the treatment can be seen.
 *
 * This used to stage an ENSEMBLE GROWS, which was a real event until slot
 * growth was removed — so the shot documented a state the game can no longer
 * reach. The banner style is still worth capturing; the wave-clear grade is
 * what actually uses it now.
 */
await p.evaluate(() => { const w = window.__musicwars.world;
  w.announce('FLAWLESS', 'WAVE CLEARED', 'grade'); });
await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/s-ensemble.png' });

// A flawless clear.
await p.evaluate(() => { const w = window.__musicwars.world;
  w.announce('FLAWLESS', 'UNTOUCHED · x12', 'grade'); });
await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/s-flawless.png' });

// High combo, descant earned, full loadout.
await p.evaluate(() => { const w = window.__musicwars.world;
  w.combo = 18; w.comboTimer = 60; w.player.maxActive = 5;
  for (const k of ['drones', 'rapid', 'nova', 'spread']) w.player.addPowerup(k, 90); });
await p.waitForTimeout(1400);
await p.screenshot({ path: '/tmp/s-loaded.png' });
console.log('captured');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
