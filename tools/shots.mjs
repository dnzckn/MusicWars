/** Screenshots at chosen moments, playing defensively so the run survives. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const __reloads = await freezePage(page);
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'tools/shot-title.png' });
await page.click('#start-button');

// Dodge along the bottom and keep firing, which is what a real player does.
await page.keyboard.down('KeyZ');
let dir = 'ArrowLeft';
const weave = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.keyboard.down(dir);
    await page.waitForTimeout(360);
    await page.keyboard.up(dir);
    dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }
};

await weave(13000);
await page.screenshot({ path: 'tools/shot-combat.png' });
await weave(9000);
await page.screenshot({ path: 'tools/shot-late.png' });
await page.keyboard.up('KeyZ');

const state = await page.evaluate(() => {
  const r = window.__musicwars.readout();
  const s = window.__musicwars.world.snapshot;
  return { section: r.section, bpm: r.bpm, key: r.key, tension: +r.tension.toFixed(2),
    bullets: s.pressureCount, enemies: s.enemyCount, wave: s.wave, lives: s.lives, score: s.score };
});
console.log(JSON.stringify(state));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await browser.close();
