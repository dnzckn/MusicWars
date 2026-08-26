/**
 * _spraydraw — the RENDER slope against player-bullet count, in a live browser.
 *
 * `docs/research-weapons.md` Part H names this as the one number the `spray`
 * shape must not ship without: §D.0 measured the SIMULATION cost of a player
 * bullet (110 ns per bullet per step, 3 repetitions, well over the run-to-run
 * spread) and explicitly did not measure what DRAWING them costs.
 * `MAX_PLAYER_BULLETS` moved 400 -> 700 in the same change that added `spray`,
 * so the question is what the extra 300 cost the frame.
 *
 * METHOD. One page, one run, one wave. `renderer.render` is wrapped so the
 * measurement is of the renderer and not of the whole frame — the frame also
 * contains the audio director, which `framewhere` measures at 35% and peaking
 * at 40ms, and which would swamp this. The player pool is then held at a
 * series of target populations by topping it up every frame with bullets that
 * do no damage and never expire on their own, so the enemy count does not move
 * underneath the comparison. Conditions run in ascending and then descending
 * order, so a drift in the machine shows up as a disagreement between the two
 * passes rather than as a slope.
 *
 * Needs the dev server on 5173.
 *
 *   node tools/_spraydraw.mjs
 */

import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const W = Number(process.env.VW ?? 1440);
const H = Number(process.env.VH ?? 900);
const SECS = Number(process.env.SECS ?? 8);
const WAVE = 14;
const TARGETS = [0, 100, 200, 400, 700];

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: W, height: H } });
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');

await p.evaluate((wave) => {
  const mw = window.__musicwars;
  mw.world.jumpToWave(wave);
  const r = mw.renderer;
  const orig = r.render.bind(r);
  window.__rt = [];
  r.render = (...a) => {
    const t0 = performance.now();
    const out = orig(...a);
    window.__rt.push(performance.now() - t0);
    return out;
  };
  window.__hold = 0;
  const pump = () => {
    const w = mw.world;
    w.player.lives = 4;
    w.player.dead = false;
    const pb = w.playerBullets;
    const want = window.__hold;
    // Top up to the target with harmless bullets. `damage: 0` so the enemy
    // population cannot move underneath the comparison, and a long `ttl` with
    // no DespawnOffscreen flag so they persist instead of being culled at the
    // margin and quietly making the low conditions high ones.
    /*
     * SHRINK AS WELL AS TOP UP.
     *
     * The first cut only topped up, and the injected bullets never expire — so
     * the descending pass read 613, 534, 531 and 494 live bullets against
     * targets of 400, 200, 100 and 0. It was not a descending pass at all, it
     * was the same high condition measured four more times, and the drift check
     * the two passes exist for was therefore vacuous. `remove` is swap-remove
     * from the tail, so this is O(1) per bullet.
     */
    while (pb.count > want) pb.remove(pb.count - 1);
    while (pb.count < want) {
      pb.spawn({
        x: 60 + Math.random() * (w.width - 120),
        y: 60 + Math.random() * (w.height - 120),
        angle: Math.random() * Math.PI * 2,
        speed: 40,
        radius: 4.5,
        ttl: 999,
        damage: 0,
        type: 0,
        bounces: 200,
        flags: 0,
      });
    }
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
}, WAVE);

/*
 * Each condition re-jumps to the same wave and then throws away two seconds.
 *
 * Two artefacts made the first version's endpoints unusable. The very first
 * condition read 3.7ms against 0.9 for everything after it — sprite atlases and
 * the first composite, measured once and attributed to "0 bullets". And the
 * ENEMY count wandered from 82 down to 4 across the sweep as the bot cleared
 * the wave, which the renderer also draws, so the bullet slope was being read
 * off a moving baseline in the opposite direction. Re-jumping repopulates the
 * field and the discarded warm-up absorbs both.
 */
const measure = async (target) => {
  await p.evaluate((t) => {
    window.__musicwars.world.jumpToWave(t.wave);
    window.__hold = t.target;
  }, { target, wave: WAVE });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { window.__rt = []; });
  await p.waitForTimeout(SECS * 1000);
  return p.evaluate(() => {
    const f = window.__rt.slice(20).sort((a, c) => a - c);
    const q = (x) => f[Math.floor(f.length * x)];
    const w = window.__musicwars.world;
    return {
      n: f.length,
      bullets: w.playerBullets.count,
      enemies: w.enemies.length,
      particles: w.particles.count,
      p50: +q(0.5).toFixed(3),
      p90: +q(0.9).toFixed(3),
      mean: +(f.reduce((a, c) => a + c, 0) / f.length).toFixed(3),
    };
  });
};

const rows = [];
for (const t of TARGETS) rows.push({ pass: 'up', target: t, ...(await measure(t)) });
for (const t of [...TARGETS].reverse()) rows.push({ pass: 'down', target: t, ...(await measure(t)) });

if (reloads() > 0) console.log(`WARNING: page reloaded ${reloads()}x mid-run`);
await b.close();

console.log(`\n_spraydraw — renderer.render only, ${W}x${H}, wave ${WAVE}, ${SECS}s per condition\n`);
console.log(
  `  ${'pass'.padEnd(5)} ${'target'.padStart(7)} ${'live'.padStart(6)} ${'enemies'.padStart(8)} ` +
    `${'parts'.padStart(6)} ${'frames'.padStart(7)} ${'p50 ms'.padStart(8)} ${'mean ms'.padStart(8)} ${'p90 ms'.padStart(8)}`,
);
for (const r of rows) {
  console.log(
    `  ${r.pass.padEnd(5)} ${String(r.target).padStart(7)} ${String(r.bullets).padStart(6)} ` +
      `${String(r.enemies).padStart(8)} ${String(r.particles).padStart(6)} ${String(r.n).padStart(7)} ` +
      `${String(r.p50).padStart(8)} ${String(r.mean).padStart(8)} ${String(r.p90).padStart(8)}`,
  );
}
const at = (t, pass) => rows.find((r) => r.target === t && r.pass === pass);
for (const pass of ['up', 'down']) {
  const lo = at(0, pass);
  const hi = at(700, pass);
  const d = hi.p50 - lo.p50;
  console.log(
    `\n  ${pass}:   0 -> 700 bullets costs ${d.toFixed(3)} ms per rendered frame ` +
      `(${((d / 700) * 1000).toFixed(2)} us per bullet), ${((d / 16.667) * 100).toFixed(1)}% of a 60Hz frame`,
  );
  const d3 = at(700, pass).p50 - at(400, pass).p50;
  console.log(`         the 300 slots this change added: ${d3.toFixed(3)} ms, ${((d3 / 16.667) * 100).toFixed(1)}% of a frame`);
}
console.log('');
