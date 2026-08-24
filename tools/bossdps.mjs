/**
 * How fast does a boss's health actually fall, and where does the fight go?
 *
 * The wave-8 boss stopped dying inside a 300s budget after the roster was made
 * ~2.5x tougher, while boss hp itself was untouched. That looked like a clear
 * regression worth correcting boss hp for.
 *
 * IT IS NOT. Run twice against the same build, this measured 90.3% of the
 * boss's health drained in 75 seconds, and then 0.0% drained in 149 seconds —
 * the health bar pinned at 100% the whole time, phase 0, escorts absent. Player
 * bullets carry a 2s ttl at 1150-1500 px/s, which is 2300-3000px of range
 * against a 700px gap, so nothing is out of reach. What differs between the two
 * runs is only whether the dodging bot happened to line up under a boss that
 * weaves laterally while it evades.
 *
 * So `bosslength` cannot measure boss difficulty: it measures whether a bot
 * that prioritises survival over aim got shots on target, and that is close to
 * a coin flip. A human positions to aim; the bot does not. Do not tune boss hp
 * against this number — the first version of this tool projected an 83s kill by
 * extrapolating a rate measured over a stretch where the bot was engaging, and
 * that projection was worthless.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const r = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  w.jumpToWave(7);
  w.player.lives = 4;
  const deadline = performance.now() + 90000;
  while (!w.snapshot.bossActive && performance.now() < deadline) {
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!w.snapshot.bossActive) return { arrived: false };
  const hp0 = w.snapshot.bossHp;
  const t0 = performance.now();
  let escortFrames = 0, frames = 0;
  /*
   * Log the curve, never extrapolate from a slope.
   *
   * The first version reported "90.3% drained in 75s, projected kill 83s" while
   * the boss was still alive — and bosslength was simultaneously watching the
   * same fight run 300 seconds without ending. Both were right: a rate measured
   * over the easy part of a fight says nothing about the part that stalls. The
   * curve shows where it stops.
   */
  const curve = [];
  while (w.snapshot.bossActive && performance.now() - t0 < 150000) {
    frames++;
    if (w.enemies.length > 1) escortFrames++;
    if (frames % 20 === 0) {
      curve.push({ t: Math.round((performance.now() - t0) / 1000), hp: +w.snapshot.bossHp.toFixed(3), phase: w.snapshot.bossPhase });
    }
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 150));
  }
  const secs = (performance.now() - t0) / 1000;
  const drained = hp0 - w.snapshot.bossHp;
  return { arrived: true, seconds: +secs.toFixed(0), drainedFrac: +drained.toFixed(3),
    projectedKillSeconds: drained > 0.001 ? Math.round(secs / drained) : null,
    escortPresentPct: Math.round((escortFrames / Math.max(1, frames)) * 100),
    stillAlive: w.snapshot.bossActive, curve };
});
await b.close();
console.log(JSON.stringify(r, null, 1));
if (r.arrived) {
  console.log(`\nboss lost ${(r.drainedFrac * 100).toFixed(1)}% of its health in ${r.seconds}s`);
  console.log(`projected full kill: ${r.projectedKillSeconds ?? 'never'}s`);
  console.log(`escorts on screen for ${r.escortPresentPct}% of the fight`);
  console.log('\nhealth curve (t / hp / phase):');
  console.log(r.curve.map((c) => `${String(c.t).padStart(4)}s ${(c.hp * 100).toFixed(1).padStart(5)}% p${c.phase}`).join('\n'));
}
