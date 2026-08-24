/**
 * Interleaved A/B: how much of the frame at high waves is SFX?
 *
 * The wave-23 median frame is 33.3ms while waves 1-15 hold 16.7ms, and
 * everything instrumented — renderer, director, world, hud — is 10.7% of the
 * main thread combined. SFX are the obvious uninstrumented thing that scales
 * with enemy count: every superdough call builds an audio graph, and at 20
 * enemies the shoot/hit/death traffic is constant.
 *
 * Interleaved because frame rate here drifts ~5fps on its own; measured once
 * each, an effect this size is indistinguishable from the arrangement moving.
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
await p.waitForTimeout(3000);

const measure = () => p.evaluate(async () => {
  const f = []; let last = performance.now();
  await new Promise((res) => { const tick = (t) => { f.push(t - last); last = t; if (f.length < 240) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const s = f.slice(20).sort((a, c) => a - c);
  return { fps: 1000 / (s.reduce((a, c) => a + c, 0) / s.length), median: s[s.length >> 1] };
});

// Count the calls first, so the A/B is interpretable.
const rate = await p.evaluate(async () => {
  const ac = window.__musicwars.audioCtx();
  let n = 0;
  const orig = ac.createGain.bind(ac);
  ac.createGain = (...a) => { n++; return orig(...a); };
  await new Promise((r) => setTimeout(r, 5000));
  ac.createGain = orig;
  return { gainNodesPerSecond: +(n / 5).toFixed(0), enemies: window.__musicwars.world.enemies.length };
});
console.log('audio node churn:', JSON.stringify(rate));

const on = [], off = [];
for (let i = 0; i < 4; i++) {
  await p.evaluate(() => { const w = window.__musicwars; if (w.__sfxOff) { w.__sfxOff = false; } });
  on.push(await measure());
  await p.evaluate(() => {
    const w = window.__musicwars;
    if (!w.__origDough) {
      // superdough is reached through the module the sfx layer imported; the
      // cheapest reliable cut is to mute the AudioContext's node factory calls
      // by making the shoot path a no-op via the input state.
      w.__origDough = true;
    }
    w.__sfxOff = true;
    w.world.player.__noShoot = true;
  });
  // Stop firing entirely: no shoot SFX, no player bullets, no hit/death SFX.
  await p.evaluate(() => { window.__botInput.shoot = false; window.__botFreeze = true; });
  off.push(await measure());
  await p.evaluate(() => { window.__botFreeze = false; window.__botInput.shoot = true; });
}
const mean = (a, k) => a.reduce((x, y) => x + y[k], 0) / a.length;
console.log('firing    :', on.map((x) => x.fps.toFixed(1)).join(' '), '=> mean', mean(on, 'fps').toFixed(1), 'fps, median', mean(on, 'median').toFixed(1), 'ms');
console.log('not firing:', off.map((x) => x.fps.toFixed(1)).join(' '), '=> mean', mean(off, 'fps').toFixed(1), 'fps, median', mean(off, 'median').toFixed(1), 'ms');
console.log('difference:', (mean(off, 'fps') - mean(on, 'fps')).toFixed(1), 'fps');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
