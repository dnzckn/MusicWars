/*
 * pause — does a level-up actually stop the world, and does it resume cleanly?
 *
 * The offer used to run the world at 12% rather than stopping, for a reason
 * that is still true: every emitter on this field schedules against the
 * transport's ABSOLUTE beat, and `repl.stop()` rewinds Strudel's cycle
 * counters, so the music can never be paused. Stop the world while the music
 * runs on and every volley on the field falls overdue — the player reads their
 * cards in peace and then resumes into all of them firing at once.
 *
 * `World.update` therefore pushes every emitter forward by the beats that pass
 * while the offer is open. This checks all three halves of that:
 *
 *   FROZEN    Nothing in the world moves. Enemy positions, bullet positions and
 *             `snapshot.time` are all identical across the whole pause.
 *   PLAYING   The transport is NOT frozen. `beat` advances the entire time, or
 *             the music has stopped and the whole design is defeated.
 *   NO DUMP   The bullets fired in the second after resuming do not scale with
 *             how long the pause lasted. This is the one that fails if the
 *             `delayBy` hold is removed, and it is the reason dilation was
 *             chosen in the first place.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).pathname;
const { World } = await import(`${R}game/world.ts`);

const DT = 1 / 120;
/** Offers to answer before holding one, so the field has armed shooters on it. */
const SKIP_OFFERS = 12;
const inputs = () => ({ x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false });

/** Run until an offer opens, holding it `holdSecs`, then answer and watch. */
function trial(holdSecs, seed = 0x51ed) {
  const w = new World(seed); w.start();
  const drive = makeBrain('dodge');
  const inp = inputs();
  let fired = 0;
  w.bus.on('enemy:fire', () => fired++);

  /*
   * Skip past the early offers. The FIRST one lands in wave 1-2, where almost
   * nothing on the field is armed — the first version of this tool held that
   * offer and measured 0 volleys after resume in every case, so the no-dump
   * check was vacuous and passed on nothing. Answer offers until the run is
   * deep enough to have shooters, then hold the next one.
   */
  let steps = 0;
  let answered = 0;
  while ((answered < SKIP_OFFERS || !w.choosing) && steps < 120 * 900) {
    if (steps % 2 === 0) { drive(w, inp); inp.choice = -1; }
    if (w.choosing && answered < SKIP_OFFERS) { inp.choice = 0; answered++; }
    w.update(DT, inp); steps++;
    inp.choice = -1;
  }
  if (!w.choosing) return null;
  const armed = w.enemies.filter((e) => e.emitters && e.emitters.length).length;

  const before = {
    time: w.snapshot.time,
    beat: w.transport.beat,
    enemies: w.enemies.map((e) => [e.x, e.y]),
    bullets: w.enemyBullets.count,
  };

  // Hold the offer open. `choice` stays -1, so nothing is picked.
  inp.choice = -1;
  for (let i = 0; i < holdSecs * 120; i++) w.update(DT, inp);

  const during = {
    time: w.snapshot.time,
    beat: w.transport.beat,
    enemies: w.enemies.map((e) => [e.x, e.y]),
    bullets: w.enemyBullets.count,
  };

  // Answer it, then count fire for one second of play.
  fired = 0;
  inp.choice = 0;
  w.update(DT, inp);
  inp.choice = -1;
  /*
   * FOUR seconds, and bullets counted directly as well as volleys. A one-second
   * window caught zero volleys on every hold even with armed enemies present,
   * which made the comparison meaningless; enemy cadences here are measured in
   * bars, so the window has to be long enough for one to come round.
   */
  let peakBullets = w.enemyBullets.count;
  for (let i = 0; i < 480; i++) {
    if (i % 2 === 0) { drive(w, inp); inp.choice = -1; }
    w.update(DT, inp);
    peakBullets = Math.max(peakBullets, w.enemyBullets.count);
  }
  const moved = before.enemies.length === during.enemies.length
    ? before.enemies.reduce((a, p, i) => a + Math.abs(p[0] - during.enemies[i][0]) + Math.abs(p[1] - during.enemies[i][1]), 0)
    : NaN;
  return {
    holdSecs,
    armed,
    worldTimeAdvanced: during.time - before.time,
    beatAdvanced: during.beat - before.beat,
    enemyDrift: moved,
    bulletDelta: during.bullets - before.bullets,
    firedAfterResume: fired,
    peakBullets,
  };
}

console.log('\npause — a level-up offer stops the world, not the music\n');
const rows = [];
for (const hold of [0.5, 4, 12]) {
  const r = trial(hold);
  if (!r) { console.log(`  hold ${hold}s: never reached an offer`); continue; }
  rows.push(r);
  console.log(`  held ${String(hold).padStart(4)}s   world time +${r.worldTimeAdvanced.toFixed(4)}s   ` +
    `transport +${r.beatAdvanced.toFixed(1)} beats   enemy drift ${r.enemyDrift.toFixed(3)}px   ` +
    `bullets ${r.bulletDelta >= 0 ? '+' : ''}${r.bulletDelta}   armed enemies ${r.armed}   after resume: ${r.firedAfterResume} volleys, peak ${r.peakBullets} bullets`);
}

const fails = [];
for (const r of rows) {
  if (r.worldTimeAdvanced > 1e-9) fails.push(`held ${r.holdSecs}s: world time advanced ${r.worldTimeAdvanced.toFixed(4)}s — the world is not stopped`);
  if (r.enemyDrift > 1e-6) fails.push(`held ${r.holdSecs}s: enemies drifted ${r.enemyDrift.toFixed(3)}px — the world is not stopped`);
  if (r.bulletDelta !== 0) fails.push(`held ${r.holdSecs}s: ${r.bulletDelta} bullets appeared or expired during the pause`);
  if (!(r.beatAdvanced > 0.5)) fails.push(`held ${r.holdSecs}s: the transport only advanced ${r.beatAdvanced.toFixed(2)} beats — the MUSIC stopped, which is the one thing that must not happen`);
}
/*
 * The dump test. A long pause must not buy the stage a backlog of volleys, so
 * post-resume fire is compared against the shortest hold rather than against a
 * fixed number — the absolute rate depends on what happens to be on the field.
 */
/*
 * A no-dump result only means anything if something was loaded to dump. If the
 * field had no armed emitters the comparison below is vacuous, and saying so is
 * better than printing a pass.
 */
if (rows.length && rows.every((r) => r.armed === 0)) {
  fails.push('no armed enemies were on the field during any hold — the no-dump check measured nothing; raise SKIP_OFFERS');
}
if (rows.length && rows.every((r) => r.firedAfterResume === 0 && r.peakBullets === 0)) {
  fails.push('nothing fired and no bullets existed after ANY resume — the no-dump comparison is vacuous, not passing');
}
if (rows.length >= 2) {
  const base = rows[0].firedAfterResume + rows[0].peakBullets;
  const worst = Math.max(...rows.map((r) => r.firedAfterResume + r.peakBullets));
  console.log(`\n  volleys + peak bullets after resume: ${rows.map((r) => `${r.holdSecs}s->${r.firedAfterResume}/${r.peakBullets}`).join('  ')}`);
  if (worst > base * 2 + 3) {
    fails.push(`a longer pause produced ${worst} volleys on resume against ${base} for the shortest — ` +
      'the emitters banked their overdue beats and dumped them, which is exactly what the delayBy hold exists to stop');
  }
}
console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  world frozen, music running, no volley dump on resume');
