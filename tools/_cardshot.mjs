import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
p.on('pageerror', (e) => console.log('PAGE THROW:', String(e).slice(0, 200)));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button').catch(() => {});
await p.waitForTimeout(600);
await installDriver(p, 'weave');
await p.waitForTimeout(6000);
// Stop answering, then force an offer.
await p.evaluate(() => {
  const w = window.__musicwars.world;
  const drive = window.__botInput;
  drive.choice = -1;
  Object.defineProperty(drive, 'choice', { get: () => -1, set: () => {}, configurable: true });
  for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
  w.progression.instruments.ember = 1;
  w.progression.pending = 1;
});
await p.waitForTimeout(2600);
await p.screenshot({ path: 'tools/_shots20/zz-card1.png' });
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => { window.__musicwars.world.rerollOffer?.(); });
  await p.waitForTimeout(1400);
  await p.screenshot({ path: `tools/_shots20/zz-card${i + 2}.png` });
}
// FPS over a busy stretch.
const fps = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  w.progression.offer = null;
  w.jumpToWave?.(22);
  await new Promise((r) => setTimeout(r, 4000));
  let n = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return { fps: (n / ((performance.now() - t0) / 1000)).toFixed(1), enemies: w.enemies.length,
           bullets: w.playerBullets.count, statused: w.enemies.filter((e) => e.status !== 0).length,
           novas: w.novas.length, effects: w.effects.length, propSets: w.propSets.length, overflow: w.propOverflow };
});
console.log('BUSY FRAME:', JSON.stringify(fps));
await p.screenshot({ path: 'tools/_shots20/zz-busy.png' });
await b.close();
