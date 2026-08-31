/**
 * Surveys the difficulty and musical state across a whole run.
 *
 * RE-POINTED WHEN THE RUN GAINED AN END. The sample was
 * `[0, 4, 8, 12, 16, 20, 26]`, chosen when a run was endless and 26 was simply
 * "further out than anyone gets". Two of those seven indices are now PAST the
 * finale (`waves.FINAL_BOSS_WAVE` is 19), which is worse than useless: those
 * rows survey a stretch of the game no player can reach, and — because
 * `index % BOSS_EVERY` puts neither 20 nor 26 on a boss — they were also the
 * only two rows that could never contain a set piece. A third of the survey was
 * measuring content that does not ship.
 *
 * The sample is the BOSS SCHEDULE now, plus wave 1: every act of the run, at
 * the wave the act culminates in, ending on the finale. It is read off
 * `waves.ts` rather than written out, so a change to `BOSS_COUNT` re-points
 * this file automatically instead of leaving it surveying the old shape — which
 * is precisely the drift that produced the stale list it replaces.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import './lib/tsnode.mjs';
const { BOSS_EVERY, BOSS_COUNT } = await import('../src/game/waves.ts');
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);
await p.keyboard.down('KeyZ');

const rows = [];
// Wave 1, then every boss wave to the finale. `n * BOSS_EVERY - 1` is where
// `planWave` puts the n-th boss; see the header for why the old fixed list had
// to go.
const SURVEY = [0, ...Array.from({ length: BOSS_COUNT }, (_, n) => (n + 1) * BOSS_EVERY - 1)];
for (const wave of SURVEY) {
  await p.evaluate((w) => {
    const world = window.__musicwars.world;
    world.jumpToWave(w);
    world.player.hp = world.player.maxHp;
    world.player.lives = 4;
  }, wave);
  // Weave while the wave plays out.
  let dir = 'ArrowLeft';
  for (let i = 0; i < 34; i++) {
    await p.keyboard.down(dir); await p.waitForTimeout(300); await p.keyboard.up(dir);
    dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }
  const r = await p.evaluate(() => {
    const mw = window.__musicwars, s = mw.world.snapshot, rd = mw.readout();
    return {
      wave: s.wave + 1,
      diff: +s.difficulty.toFixed(2),
      enemies: s.enemyCount,
      bullets: s.pressureCount,
      near: s.threatsNear,
      hits: 4 - s.lives + (3 - s.playerHp) / 3,
      energy: +rd.energy.toFixed(2),
      bpm: rd.bpm,
      key: rd.key,
      groove: rd.feel,
      fps: Math.round(mw.loop.fps),
    };
  });
  rows.push(r);
  console.log(JSON.stringify(r));
}
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('\n--- endgame survey ---');
console.table(rows);
