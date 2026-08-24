/** The pause screen, and the game at phone size. Two surfaces never looked at. */
import { chromium, devices } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });

const desk = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(desk);
await desk.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await desk.click('#start-button');
await desk.waitForTimeout(2500);
await installDriver(desk, 'dodge');
await desk.waitForTimeout(9000);
await desk.keyboard.press('KeyP');
await desk.waitForTimeout(900);
await desk.screenshot({ path: '/tmp/p0-pause.png' });
console.log('pause shown:', await desk.evaluate(() => document.getElementById('pause-screen')?.classList.contains('hidden') === false));

const phone = await b.newPage({ ...devices['iPhone 13'] });
await phone.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await phone.waitForTimeout(900);
await phone.screenshot({ path: '/tmp/p1-phone-title.png' });
await phone.tap('#start-button');
await phone.waitForTimeout(3000);
await installDriver(phone, 'dodge');
await phone.waitForTimeout(12000);
await phone.screenshot({ path: '/tmp/p2-phone-run.png' });
console.log('phone:', JSON.stringify(await phone.evaluate(() => {
  const w = window.__musicwars.world;
  return { wave: w.waveIndex + 1, enemies: w.enemies.length, score: w.score,
    audio: window.__musicwars.audio().status, fps: Math.round(window.__musicwars.loop.fps),
    bodyScrollW: document.body.scrollWidth, innerW: window.innerWidth };
})));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
