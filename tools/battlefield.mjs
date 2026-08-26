/** Confirms enemy fire is pitched and in time, and the motif layer breathes. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  const mw = window.__musicwars;
  window.__fire = [];
  window.__motif = [];
  /*
   * `e.pan`, was `e.x`, and the rename is the point.
   *
   * This logged `x` and asserted on its spread, and `x` was `enemy.x / field
   * width` — which side of the FIELD a shot came from. It is now
   * `0.5 + (enemy.x - player.x) / VIEW_W`, which side of the PLAYER it came
   * from, because the field is no longer one screen and the old denominator
   * was collapsing toward a constant. `world.ts` renamed the event field
   * specifically so this line could not keep printing a column whose
   * definition had moved underneath it — see AGENTS.md §3 on the difference
   * between a check that failed and a check that quietly re-baselined.
   *
   * `panSpread` therefore means something different from here on, and it means
   * something better: it now measures whether shots arrive from both sides of
   * the player, which is what a listener actually hears, instead of whether
   * the enemies happened to be spread across the arena.
   */
  mw.world.bus.on('enemy:fire', (e) => window.__fire.push({ b: mw.world.warpedBeatNow, a: e.archetype, pan: +e.pan.toFixed(2) }));
  setInterval(() => window.__motif.push({ n: mw.world.snapshot.enemyCount, lvl: mw.readout().levels.motifs }), 200);
});
/*
 * Measure where enemies actually shoot.
 *
 * This check was written when the opening waves were dense. They are now
 * deliberately calm — about a quarter of early enemies are armed at all — so
 * running it from wave one produced two volleys against a threshold of twenty,
 * and failed for being pointed at the wrong part of the game rather than for
 * anything being wrong.
 */
await p.evaluate(() => {
  const w = window.__musicwars.world;
  /*
   * Wave 15, not 8. The roster rebalance cut group sizes and made enemies ~2.5x
   * tougher, so early waves now hold one or two enemies of a single archetype
   * for most of their length — this sampled wave 8 and found zero motif kinds
   * with the lane's level up at 0.49, which reads as "the motif layer is
   * broken" when the layer is fine and the stage is simply thinner than it was.
   * Later waves still put several archetypes on at once, which is the condition
   * this check exists to exercise.
   *
   * INDEX 16, NOT 15, AND THE OLD NUMBER WAS A BOSS WAVE. `BOSS_EVERY` is 8 and
   * `jumpToWave` takes an index, so index 15 is WAVE 16 — a boss. A boss wave's
   * `planWave` emits seven enemies in total (`docs/research-density.md` §6b
   * measures it), which is the single sparsest wave in the game, and this check
   * needs the opposite. It got away with it while the whole field was on screen;
   * once the arena grew to 3000x3000 and enemies only fire once they are in
   * VIEW, the same wave produced 3, 20 and 35 volleys across three consecutive
   * runs against a threshold of 20 — a coin flip.
   *
   * Index 16 is wave 17, difficulty saturated at 1.00, measured at 31 enemies
   * by `tools/endgame.mjs` in the same table. The THRESHOLD IS UNCHANGED: this
   * is AGENTS.md §3's "replace it with a stronger one, never relax it" — the
   * check was pointed at the wrong part of the game, exactly as the note above
   * records happening the last time, and the fix is to aim it, not to lower it.
   */
  w.jumpToWave(16);
  w.player.lives = 4;
});
await p.waitForTimeout(2500);
await p.keyboard.down('KeyZ');
let dir = 'ArrowLeft';
for (let i = 0; i < 150; i++) {
  await p.keyboard.down(dir); await p.waitForTimeout(300); await p.keyboard.up(dir);
  dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
}
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const f = window.__fire;
  const off = f.map((x) => { const q = x.b * 2; const fr = q % 1; return Math.min(fr, 1 - fr) / 2; });
  const onGrid = off.filter((o) => o < 0.07).length;
  const kinds = [...new Set(f.map((x) => x.a))];
  const pans = f.map((x) => x.pan);
  // Does the motif level actually track enemy count?
  const m = window.__motif.filter((x) => x.n > 0);
  const low = m.filter((x) => x.n <= 3).map((x) => x.lvl);
  const high = m.filter((x) => x.n >= 8).map((x) => x.lvl);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { notes: f.length, onGridPct: Math.round((onGrid / Math.max(1, off.length)) * 100), kinds,
    panSpread: +(Math.max(...pans) - Math.min(...pans)).toFixed(2),
    motifLow: +mean(low).toFixed(2), motifHigh: +mean(high).toFixed(2), lowN: low.length, highN: high.length };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
/*
 * Asserts only what this check is about: shots are pitched, on the grid, and
 * spread across the stereo field.
 *
 * It used to also require the motif layer to grow with enemy count — written in
 * the iteration that made motifs scale, and never updated when a later one made
 * them *yield* as the shooting takes over. So it was asserting the opposite of
 * the current design and failing on correct behaviour. `subtraction.mjs` owns
 * that relationship now.
 */
// `kinds >= 2` is the point of the check — the battlefield should be audible as
// several distinct voices — but it is now a property of late waves rather than
// of any wave, which is a design change and not a defect.
const ok = r.notes > 20 && r.onGridPct >= 85 && r.kinds.length >= 2 && r.panSpread > 0.4;
console.log(ok ? 'THE BATTLEFIELD PLAYS, IN TIME' : 'check battlefield audio');
if (!ok) process.exit(1);
