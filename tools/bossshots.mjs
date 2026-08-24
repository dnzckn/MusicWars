/** Screenshots through a boss fight — telegraph, each phase, and the kill. */
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
await p.evaluate(() => { const w = window.__musicwars.world; w.jumpToWave(6); w.player.lives = 4; });
const shots = [];
for (let i = 0; i < 10; i++) {
  await p.waitForTimeout(6000);
  const st = await p.evaluate(() => {
    const w = window.__musicwars.world, s = w.snapshot, rd = window.__musicwars.readout();
    w.player.lives = Math.max(3, w.player.lives);
    return { boss: s.bossActive, phase: s.bossPhase, hp: +s.bossHp.toFixed(2), enemies: w.enemies.length,
      bullets: w.enemyBullets.count, section: rd.section, key: rd.key, wave: w.waveIndex + 1 };
  });
  shots.push(st);
  if (st.boss) await p.screenshot({ path: `/tmp/boss-${i}.png` });
  console.log(i, JSON.stringify(st));
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
