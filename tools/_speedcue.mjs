/**
 * _speedcue — scratch. Does the screen change when the throttle does?
 *
 * The claim under test is "speed is the core verb and nothing communicates
 * it". That is a claim about PIXELS, so it is settled by photographing the
 * same field at three throttle settings and differencing the frames, not by
 * reading the renderer.
 *
 * Ground speed range is [0, 2*CRUISE] px/s: `wantY = -CRUISE + input.y * TRIM`
 * with CRUISE === TRIM === 430.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { installDriver } from './lib/driver.mjs';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(1500);
await installDriver(p, 'dodge');
await p.waitForTimeout(2000);

const rows = [];
for (const [name, ty] of [['full back', 1], ['cruise', 0], ['full forward', -1]]) {
  await p.evaluate((ty) => {
    const i = window.__botInput;
    for (const k of ['x', 'y']) {
      try { delete i[k]; } catch { /* first pass */ }
    }
    Object.defineProperty(i, 'x', { configurable: true, get: () => 0, set: () => {} });
    Object.defineProperty(i, 'y', { configurable: true, get: () => ty, set: () => {} });
  }, ty);
  await p.waitForTimeout(1600);
  const a = await p.evaluate(() => ({
    vy: window.__musicwars.world.player.vy,
    viewY: window.__musicwars.world.camera.viewY,
    t: performance.now(),
  }));
  const f1 = `${out}/spd-${ty}-a.png`;
  await p.screenshot({ path: f1 });
  await p.waitForTimeout(250);
  const f2 = `${out}/spd-${ty}-b.png`;
  await p.screenshot({ path: f2 });
  const c = await p.evaluate(() => ({
    viewY: window.__musicwars.world.camera.viewY,
    t: performance.now(),
  }));

  // How much of the frame CHANGED in 250ms, counted only in the upper third,
  // where nothing but background lives — enemies and effects would swamp it.
  const A = PNG.sync.read(readFileSync(f1));
  const B = PNG.sync.read(readFileSync(f2));
  let moved = 0, seen = 0, sum = 0;
  for (let y = 0; y < Math.floor(A.height / 3); y++) {
    for (let x = 0; x < A.width; x++) {
      const i = (y * A.width + x) << 2;
      const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
      seen++;
      sum += d;
      if (d > 18) moved++;
    }
  }
  const ground = Math.abs(a.vy);
  const camRate = Math.abs((c.viewY - a.viewY) / ((c.t - a.t) / 1000));
  rows.push({ name, ground, camRate, movedPct: (moved / seen) * 100, meanDelta: sum / seen });
  console.log(
    `${name.padEnd(13)} ground ${ground.toFixed(0).padStart(4)} px/s  camera ${camRate.toFixed(0).padStart(4)} px/s` +
      `  upper-third pixels changed in 250ms: ${((moved / seen) * 100).toFixed(2)}%  mean delta ${(sum / seen).toFixed(2)}/765`,
  );
}
console.log(`\n${rows.length} throttle settings sampled, ${1280 * 240} pixels each`);
await b.close();
