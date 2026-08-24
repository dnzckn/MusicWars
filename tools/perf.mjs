/** Isolates renderer cost by toggling features on a live run. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(14000);

const measure = async (label, setup) => {
  await p.evaluate(setup);
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const mw = window.__musicwars;
    let frames = 0; const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => { frames++; performance.now() - t0 > 3000 ? res() : requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    return { fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
             bullets: mw.world.snapshot.bulletCount, enemies: mw.world.snapshot.enemyCount };
  });
  console.log(`${label.padEnd(28)} fps=${String(r.fps).padStart(5)}  bullets=${r.bullets} enemies=${r.enemies}`);
  return r.fps;
};

await measure('everything on', () => {});
await measure('bloom off', () => { window.__musicwars.renderer.bloomEnabled = false; });
await measure('bloom on again', () => { window.__musicwars.renderer.bloomEnabled = true; });
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
