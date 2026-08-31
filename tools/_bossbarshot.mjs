import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.evaluate(() => { window.__t = 1; setInterval(() => { if (window.__botInput) window.__botInput.throttle = window.__t; }, 8); });
await p.waitForTimeout(2500);
await p.evaluate(() => { window.__t = 0; });
const probe = () => p.evaluate(() => { const w = window.__musicwars.world; return { phase: w.stagePhase, wave: w.waveIndex, frac: +w.bossProgress.toFixed(2), left: w.wavesToBoss, boss: w.snapshot.bossActive, warp: w.warping, t: +w.snapshot.time.toFixed(0) }; });
for (let i = 0; i < 200; i++) {
  await p.waitForTimeout(2000);
  const s = await probe();
  if (s.phase === 'awaiting-boss') { await p.screenshot({ path: 'E:/GitHub/MusicWars/tools/_warpshots/d-telegraph.png' }); console.log('TELEGRAPH', JSON.stringify(s)); }
  if (s.boss) { await p.screenshot({ path: 'E:/GitHub/MusicWars/tools/_warpshots/d-bossfight.png' }); console.log('BOSS', JSON.stringify(s)); break; }
  if (i % 15 === 0) console.log('   ', JSON.stringify(s));
}
await b.close();
