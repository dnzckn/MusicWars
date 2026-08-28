/*
 * Does the music visual cost frames?
 *
 * Same seed, same wave, interleaved ON/OFF, several rounds — the lesson
 * `hudab` records: measured once each it said the HUD cost 7.7fps, measured
 * again it said nothing, because the machine drifts by ~5fps with the
 * arrangement and the enemy count.
 *
 * THREE conditions, not two, so the answer separates the notation canvas from
 * the rest of the panel:
 *   roll   — everything as shipped
 *   noroll — `drawScore` stubbed (the notation canvas alone)
 *   nohud  — `hud.update` stubbed (the whole DOM panel, roll included)
 *
 * The noise floor is measured by the SAME machinery: `roll` is sampled in
 * every round too, so the spread of the control across rounds is the number
 * any claimed delta has to beat.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';

const ROUNDS = Number(process.argv[2] ?? 5);
const WAVE = Number(process.argv[3] ?? 20);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1512, height: 945 } });
await p.goto('http://localhost:5173/?seed=0x51ed', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.evaluate((w) => window.__musicwars.world.jumpToWave(w), WAVE);
await p.waitForTimeout(4000);

const measure = () =>
  p.evaluate(async () => {
    const f = [];
    let last = performance.now();
    await new Promise((res) => {
      const tick = (t) => {
        f.push(t - last);
        last = t;
        if (f.length < 260) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    const s = f.slice(20);
    return 1000 / (s.reduce((a, c) => a + c, 0) / s.length);
  });

const setMode = (mode) =>
  p.evaluate((mode) => {
    const mw = window.__musicwars;
    const h = mw.hud;
    mw.__orig ??= { update: h.update.bind(h), drawScore: h.drawScore.bind(h) };
    delete h.update;
    delete h.drawScore;
    if (mode === 'noroll') h.drawScore = () => {};
    if (mode === 'nohud') h.update = () => {};
  }, mode);

const MODES = ['roll', 'noroll', 'nohud'];
const acc = Object.fromEntries(MODES.map((m) => [m, []]));
for (let r = 0; r < ROUNDS; r++) {
  for (const m of MODES) {
    await setMode(m);
    acc[m].push(await measure());
  }
}
await setMode('roll');
const stats = await p.evaluate(() => {
  const w = window.__musicwars.world;
  return { enemies: w.enemies.length, bullets: w.playerBullets.count, wave: w.wave };
});
await b.close();

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};
console.log(`\nwave ${stats.wave}, ${stats.enemies} enemies, ${stats.bullets} bullets, ${ROUNDS} rounds\n`);
for (const m of MODES) {
  console.log(
    `  ${m.padEnd(7)} ${acc[m].map((x) => x.toFixed(1).padStart(5)).join(' ')}   mean ${mean(acc[m]).toFixed(2)}  sd ${sd(acc[m]).toFixed(2)}`,
  );
}
console.log('');
console.log(`  notation canvas costs  ${(mean(acc.noroll) - mean(acc.roll)).toFixed(2)} fps`);
console.log(`  the whole DOM HUD costs ${(mean(acc.nohud) - mean(acc.roll)).toFixed(2)} fps`);
console.log(`  noise floor (sd of the control, x2) +/- ${(sd(acc.roll) * 2).toFixed(2)} fps\n`);
