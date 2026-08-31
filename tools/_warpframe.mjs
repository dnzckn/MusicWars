/*
 * SCRATCH. What does warp's crowd cost the frame?
 *
 * `Renderer.render` timed directly, the same A/B shape the treadmill commit
 * used ("8.34ms base against 8.45ms"), because fps in a headless Chromium on
 * this box is software-rasterised and its absolute value says nothing. What
 * transfers is the RATIO at a known body count.
 *
 *   NODE_OPTIONS=--experimental-transform-types node tools/_warpframe.mjs
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);

await p.evaluate(() => {
  const r = window.__musicwars.renderer;
  const orig = r.render.bind(r);
  window.__rt = [];
  r.render = (...a) => {
    const t = performance.now();
    orig(...a);
    window.__rt.push(performance.now() - t);
  };
  const w = window.__musicwars.world;
  const origU = w.update.bind(w);
  window.__ut = [];
  w.update = (...a) => {
    const t = performance.now();
    origU(...a);
    window.__ut.push(performance.now() - t);
  };
});
const { installDriver } = await import('./lib/driver.mjs');
await installDriver(p, 'dodge');

const sample = async (label) => {
  await p.evaluate(() => {
    window.__rt.length = 0;
    window.__ut.length = 0;
  });
  await p.waitForTimeout(6000);
  const r = await p.evaluate(() => {
    const a = window.__rt.slice().sort((x, y) => x - y);
    const u = window.__ut.slice().sort((x, y) => x - y);
    const w = window.__musicwars.world;
    return {
      n: a.length,
      p50: a[Math.floor(a.length * 0.5)] ?? -1,
      p90: a[Math.floor(a.length * 0.9)] ?? -1,
      steps: u.length,
      u50: u[Math.floor(u.length * 0.5)] ?? -1,
      usum: u.reduce((x, y) => x + y, 0),
      alive: w.enemies.length,
      warp: w.warping,
    };
  });
  console.log(
    `  ${label.padEnd(13)} frames ${String(r.n).padStart(4)}  render p50 ${r.p50.toFixed(2)}ms p90 ${r.p90.toFixed(2)}ms  |  steps ${String(r.steps).padStart(5)} update p50 ${r.u50.toFixed(2)}ms sum ${(r.usum / 6000 * 100).toFixed(0)}% of wall  |  alive ${r.alive} warp ${r.warp}`,
  );
  return r;
};

console.log('\nRenderer.render, 1280x800, headless software raster\n');
const base = await sample('cruise');
await p.evaluate(() => {
  window.__botThrottle = 1;
  setInterval(() => {
    if (window.__botInput) window.__botInput.throttle = window.__botThrottle;
  }, 8);
});
await p.waitForTimeout(3000);
await p.evaluate(() => {
  window.__botThrottle = 0;
});
const warpA = await sample('warp');
await p.waitForTimeout(8000);
const warpB = await sample('warp, later');
console.log(
  `\n  ratio p50 ${(warpB.p50 / base.p50).toFixed(2)}x at ${warpB.alive} bodies against ${base.alive}\n`,
);
await b.close();
