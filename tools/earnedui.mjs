/**
 * The descant has to be visible, not only audible.
 *
 * The lead grows a harmony voice above a multiplier of eight — the only reward
 * in this game that makes the music better rather than merely more intense —
 * and nothing on screen said so, which leaves a player unable to connect the
 * reward to the thing they did to earn it.
 */
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
await p.waitForTimeout(8000);
const read = () => p.evaluate(() => {
  const el = document.getElementById('ui-combo');
  return { text: el.textContent, earned: el.classList.contains('earned') };
});
await p.evaluate(() => { window.__musicwars.world.combo = 0; });
await p.waitForTimeout(700);
const cold = await read();
await p.evaluate(() => { const w = window.__musicwars.world; w.combo = 14; w.comboTimer = 30; });
await p.waitForTimeout(700);
const hot = await read();
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('cold:', JSON.stringify(cold));
console.log('hot :', JSON.stringify(hot));
const ok = !cold.earned && hot.earned && /descant/i.test(hot.text) && !/descant/i.test(cold.text);
if (!ok) console.log('the multiplier does not report the descant');
console.log(ok ? 'THE REWARD IS LEGIBLE' : 'THE REWARD IS INVISIBLE');
process.exit(ok ? 0 : 1);
