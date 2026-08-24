/**
 * Interleaved A/B: is the frame going into canvas rasterisation?
 *
 * At wave 23 the median frame is 33.3ms while everything measurable in JS —
 * renderer, director, world, hud — accounts for about 2.3ms of it. Raster and
 * composite work does not show up in a performance.now() bracket around
 * render(), so the only way to see it is to stop asking the browser to paint
 * and watch what happens to the frame time.
 */
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
await p.evaluate(() => { window.__musicwars.world.jumpToWave(23); window.__musicwars.world.player.lives = 4; });
await p.waitForTimeout(4000);
const measure = () => p.evaluate(async () => {
  const f = []; let last = performance.now();
  await new Promise((res) => { const tick = (t) => { f.push(t - last); last = t; if (f.length < 220) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const s = f.slice(20).sort((a, c) => a - c);
  return { fps: 1000 / (s.reduce((a, c) => a + c, 0) / s.length), median: s[s.length >> 1],
    enemies: window.__musicwars.world.enemies.length };
});
const on = [], off = [];
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => { const r = window.__musicwars.renderer; if (r.__orig) Object.getPrototypeOf(r).applyBloom = r.__orig; });
  on.push(await measure());
  await p.evaluate(() => {
    const r = window.__musicwars.renderer, proto = Object.getPrototypeOf(r);
    r.__orig = r.__orig ?? proto.applyBloom;
    proto.applyBloom = function () {};
  });
  off.push(await measure());
}
await p.evaluate(() => { const r = window.__musicwars.renderer; Object.getPrototypeOf(r).applyBloom = r.__orig; });
const mean = (a, k) => a.reduce((x, y) => x + y[k], 0) / a.length;
console.log('bloom on :', on.map((x) => x.fps.toFixed(1)).join(' '), '=> mean', mean(on, 'fps').toFixed(1), 'fps, median', mean(on, 'median').toFixed(1), 'ms, enemies', mean(on, 'enemies').toFixed(0));
console.log('bloom off:', off.map((x) => x.fps.toFixed(1)).join(' '), '=> mean', mean(off, 'fps').toFixed(1), 'fps, median', mean(off, 'median').toFixed(1), 'ms');
console.log('bloom costs', (mean(off, 'fps') - mean(on, 'fps')).toFixed(1), 'fps');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
