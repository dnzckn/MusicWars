/** Screenshots of a live run, for reviewing the UI as a player actually sees it. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.screenshot({ path: 'renders/shots/s0-title.png' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await p.screenshot({ path: 'renders/shots/s1-open.png' });
await installDriver(p, 'dodge');
for (const [t, n] of [[18000,'s2-mid'],[20000,'s3-late'],[25000,'s4-later']]) {
  await p.waitForTimeout(t);
  const st = await p.evaluate(() => { const w = window.__musicwars.world;
    return { wave: w.waveIndex + 1, lives: w.player.lives, score: w.score, enemies: w.enemies.length, dead: w.player.dead }; });
  console.log(n, JSON.stringify(st));
  await p.screenshot({ path: `renders/shots/${n}.png` });
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
