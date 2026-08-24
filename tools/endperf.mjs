/** Where the frame goes at high wave counts. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);
await p.evaluate(() => { const w = window.__musicwars.world; w.jumpToWave(26); w.player.lives = 4; });
await p.keyboard.down('KeyZ');
await p.waitForTimeout(16000);
const probe = async (label, setup) => {
  await p.evaluate(setup);
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const mw = window.__musicwars;
    let frames = 0; const t0 = performance.now();
    await new Promise((res) => { const tick = () => { frames++; performance.now() - t0 > 2600 ? res() : requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const s = mw.world.snapshot;
    return { fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
      upd: +mw.loop.updateMs.toFixed(2), ren: +mw.loop.renderMs.toFixed(2),
      enemies: s.enemyCount, bullets: s.bulletCount, particles: mw.world.particles.count, notes: mw.world.notes.length };
  });
  console.log(`${label.padEnd(24)} fps=${String(r.fps).padStart(5)} update=${String(r.upd).padStart(5)}ms render=${String(r.ren).padStart(5)}ms  e=${r.enemies} b=${r.bullets} p=${r.particles} n=${r.notes}`);
  return r.fps;
};
await probe('wave 27, everything', () => {});
await probe('bloom off', () => { window.__musicwars.renderer.bloomEnabled = false; });
await probe('bloom on again', () => { window.__musicwars.renderer.bloomEnabled = true; });
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
