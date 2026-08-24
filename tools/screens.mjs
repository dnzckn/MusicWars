/** Screenshots of the framing screens: title, and the run summary. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/t0-title.png' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(20000);
// Force the run to end so the summary is real rather than synthesised.
await p.evaluate(() => { const w = window.__musicwars.world; w.jumpToWave(12); });
await p.waitForTimeout(6000);
/*
 * End the run through the real damage path.
 *
 * Setting `lives = 0; hp = 0` directly never sets `player.dead`, which is what
 * flips the phase to 'over' — so the earlier version of this reported "gameover
 * NOT shown" and looked like a game bug when it was a test bug.
 */
await p.evaluate(async () => {
  const w = window.__musicwars.world;
  const hit = Object.getPrototypeOf(w).onPlayerHit.bind(w);
  for (let i = 0; i < 30 && !w.player.dead; i++) {
    w.player.invuln = 0;
    w.player.bombs = 0; // auto-bomb refunds the fatal hit; that is the point of it
    if (w.player.takeHit()) hit();
    await new Promise((r) => setTimeout(r, 120));
  }
});
await p.waitForTimeout(4000);
await p.screenshot({ path: '/tmp/t1-gameover.png' });
console.log(JSON.stringify(await p.evaluate(() => {
  const w = window.__musicwars.world;
  return { dead: w.player.dead, lives: w.player.lives, hp: w.player.hp,
    phase: w.phase, shown: document.getElementById('gameover-screen')?.classList.contains('hidden') === false,
    ids: [...document.querySelectorAll('.screen')].map((e) => e.id) };
})));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
