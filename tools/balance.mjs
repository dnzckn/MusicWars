/** Plays a long run and reports the things the user complained about. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  const mw = window.__musicwars;
  const st = { maxBullets: 0, bulletSum: 0, n: 0, powerupsSeen: new Set(), maxWave: 0, bossSeen: false, bossStart: 0, bossEnd: 0 };
  window.__bal = st;
  mw.world.bus.on('powerup:pickup', (e) => st.powerupsSeen.add(e.kind));
  mw.world.bus.on('boss:spawn', () => { st.bossSeen = true; st.bossStart = performance.now(); });
  mw.world.bus.on('boss:defeat', () => { st.bossEnd = performance.now(); });
  setInterval(() => {
    const s = mw.world.snapshot;
    st.maxBullets = Math.max(st.maxBullets, s.pressureCount);
    st.bulletSum += s.pressureCount; st.n++;
    st.maxWave = Math.max(st.maxWave, s.wave);
  }, 100);
});
// Dodge along the bottom, firing.
await p.keyboard.down('KeyZ');
let dir = 'ArrowLeft';
const end = Date.now() + 105000;
while (Date.now() < end) {
  await p.keyboard.down(dir); await p.waitForTimeout(300); await p.keyboard.up(dir);
  dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
}
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const st = window.__bal, s = window.__musicwars.world.snapshot;
  return { maxBullets: st.maxBullets, avgBullets: +(st.bulletSum / Math.max(1, st.n)).toFixed(0),
    powerups: [...st.powerupsSeen], maxWave: st.maxWave + 1, bossSeen: st.bossSeen,
    bossKillSeconds: st.bossEnd > st.bossStart ? +((st.bossEnd - st.bossStart) / 1000).toFixed(0) : null,
    livesLeft: s.lives, score: s.score, over: s.gameOver };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
