/** Surveys the difficulty and musical state across a long run. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);
await p.keyboard.down('KeyZ');

const rows = [];
for (const wave of [0, 4, 8, 12, 16, 20, 26]) {
  await p.evaluate((w) => {
    const world = window.__musicwars.world;
    world.jumpToWave(w);
    world.player.hp = world.player.maxHp;
    world.player.lives = 4;
  }, wave);
  // Weave while the wave plays out.
  let dir = 'ArrowLeft';
  for (let i = 0; i < 34; i++) {
    await p.keyboard.down(dir); await p.waitForTimeout(300); await p.keyboard.up(dir);
    dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }
  const r = await p.evaluate(() => {
    const mw = window.__musicwars, s = mw.world.snapshot, rd = mw.readout();
    return {
      wave: s.wave + 1,
      diff: +s.difficulty.toFixed(2),
      enemies: s.enemyCount,
      bullets: s.pressureCount,
      near: s.threatsNear,
      hits: 4 - s.lives + (3 - s.playerHp) / 3,
      energy: +rd.energy.toFixed(2),
      bpm: rd.bpm,
      key: rd.key,
      groove: rd.feel,
      fps: Math.round(mw.loop.fps),
    };
  });
  rows.push(r);
  console.log(JSON.stringify(r));
}
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('\n--- endgame survey ---');
console.table(rows);
