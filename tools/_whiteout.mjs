/**
 * _whiteout — scratch. How much of the frame goes white when everything is
 * being hit at once?
 *
 * `drawEnemies` filled a flashing body with `#ffffff`. At the densities `arena`
 * measures that is a lot of solid white under a renderer that composites
 * everything else with `lighter`, and the claim under test — "the ship
 * disappears" — is a claim about pixels.
 *
 * Every enemy is pinned mid-flash so the comparison is of the SAME field in the
 * same frame, not of two different fights.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { installDriver } from './lib/driver.mjs';

const out = process.argv[2] ?? 'shots';
const label = process.argv[3] ?? 'now';
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(1400);
await installDriver(p, 'dodge');
await p.waitForTimeout(14000);
await p.evaluate(() => {
  const w = window.__musicwars.world;
  w.beginWave(22);
  Object.defineProperty(window.__botInput, 'x', { get: () => 0, set: () => {} });
  Object.defineProperty(window.__botInput, 'y', { get: () => 1, set: () => {} });
});
await p.waitForTimeout(22000);
// Pin the flash. `hitFlash` decays in the sim step, so it is re-pinned on an
// interval rather than set once — otherwise the screenshot lands on a frame
// where half of them have already faded and the measurement is of the decay.
const on = await p.evaluate(() => {
  const w = window.__musicwars.world;
  setInterval(() => { for (const e of w.enemies) e.hitFlash = 0.2; }, 8);
  return w.enemies.filter(
    (e) => Math.abs(e.x - w.player.x) < w.viewW / 2 && Math.abs(e.y - w.player.y) < w.viewH / 2,
  ).length;
});
await p.waitForTimeout(900);
const f = `${out}/white-${label}.png`;
await p.screenshot({ path: f });
await b.close();

const img = PNG.sync.read(readFileSync(f));
let white = 0, bright = 0;
const total = img.width * img.height;
for (let i = 0; i < img.data.length; i += 4) {
  const r = img.data[i], g = img.data[i + 1], bl = img.data[i + 2];
  const mn = Math.min(r, g, bl);
  if (mn > 210) white++;
  if (mn > 150) bright++;
}
console.log(
  `${label}: ${on} enemies on screen, all mid-flash — ` +
    `near-white (min channel > 210) ${((white / total) * 100).toFixed(2)}% of ${total} px, ` +
    `bright (>150) ${((bright / total) * 100).toFixed(2)}%`,
);
