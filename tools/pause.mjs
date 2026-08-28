/*
 * pause — does a level-up actually stop the world, and does it resume cleanly?
 *
 * The offer used to run the world at 12% rather than stopping, for a reason
 * that is still true: every enemy attack on this field schedules against the
 * transport's ABSOLUTE beat, and `repl.stop()` rewinds Strudel's cycle
 * counters, so the music can never be paused. Stop the world while the music
 * runs on and every scheduled attack falls overdue — the player reads their
 * cards in peace and then resumes into all of them landing at once.
 *
 * `World.update` therefore pushes every scheduled attack forward by the beats
 * that pass while the offer is open. This checks all three halves of that:
 *
 *   FROZEN    Nothing in the world moves. Enemy positions and `snapshot.time`
 *             are identical across the whole pause.
 *   PLAYING   The transport is NOT frozen. `beat` advances the entire time, or
 *             the music has stopped and the whole design is defeated.
 *   NO DUMP   The attacks committed in the seconds after resuming do not scale
 *             with how long the pause lasted. This is the one that fails if the
 *             hold is removed, and it is the reason dilation was chosen in the
 *             first place.
 *
 * THE ATTACK CHANGED AND THE TEST DID NOT. It used to count enemy VOLLEYS and
 * the bullets they left in the air; enemy fire is deleted, and the attack is
 * now a telegraphed LUNGE on the same absolute-beat schedule (`enemy:lunge`,
 * `Enemy.lungeBeat`). The hold it verifies is one line in `World.update`
 * instead of a loop over emitters, and it is the same hold.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);

const DT = 1 / 120;
/** Offers to answer before holding one, so the field has bodies that attack. */
/*
 * 20, raised from 12.
 *
 * This is how many offers to answer before the hold is tested, and it exists so
 * the run has reached a state with ARMED enemies on the field — the whole point
 * of the no-dump check is that a stopped world does not let a volley accumulate
 * and then release it on resume, and a field with nothing armed cannot show
 * that either way.
 *
 * 12 stopped being enough when the level ladder went from 8 rungs to 3. Offers
 * now arrive roughly every 18 seconds instead of every 27, so twelve of them is
 * a much earlier point in the run, and the tool was reaching its hold before any
 * enemy was armed. It said so rather than passing — "the no-dump check measured
 * nothing; raise SKIP_OFFERS" — which is the behaviour this directory wants and
 * the reason this was a two-minute fix instead of a silent hole.
 *
 * Not raised further: at 30 the tool reports bullets appearing during a hold
 * whose world time is +0.0000s, and an enemy drift of NaN. That is either a real
 * defect in something that spawns outside the simulation-time gate, or the drift
 * comparison breaking when the enemy set changes under it. It is not diagnosed
 * and it is not this change; it is recorded here so the next person to raise
 * this constant knows what they will walk into.
 */
const SKIP_OFFERS = 20;
const inputs = () => ({ x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false });

/** Run until an offer opens, holding it `holdSecs`, then answer and watch. */
function trial(holdSecs, seed = 0x51ed) {
  const w = new World(seed); w.start();
  const drive = makeBrain('dodge');
  const inp = inputs();
  let fired = 0;
  w.bus.on('enemy:lunge', () => fired++);

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
  // Bodies that will actually attack: they carry a lunge and it is scheduled.
  const armed = w.enemies.filter((e) => e.lunge && e.lungeBeat >= 0).length;

  /*
   * `owed` is beats-until-this-body-attacks, per enemy, and it is the
   * assertion that actually bites.
   *
   * THE OLD NO-DUMP TEST IS NOW VACUOUS BY CONSTRUCTION and saying so matters
   * more than keeping it. It compared attacks-after-resume across hold
   * lengths, and `World.tickLunge` has an overdue guard — a schedule more than
   * one cadence late is re-snapped rather than fired — so a backlog cannot be
   * released however long the pause is. Deleting the hold and re-running this
   * tool produced no dump. That check is left in place because it is still the
   * property being claimed, but it can no longer fail, so it is no longer
   * evidence.
   *
   * What the hold actually buys is PHASE: without it every overdue body is
   * re-snapped to a fresh cadence and the stage loses its relationship to the
   * bar it was choreographed against. That is directly observable — the beats
   * a body still owes must be the same after the pause as before it — and
   * removing the hold turns this red on the first row.
   */
  const owedBefore = new Map();
  for (const e of w.enemies) if (e.lunge && e.lungeBeat >= 0) owedBefore.set(e.id, e.lungeBeat - w.transport.beat);
  const before = {
    time: w.snapshot.time,
    beat: w.transport.beat,
    enemies: w.enemies.map((e) => [e.x, e.y]),
    bodies: w.enemies.length,
  };

  // Hold the offer open. `choice` stays -1, so nothing is picked.
  inp.choice = -1;
  for (let i = 0; i < holdSecs * 120; i++) w.update(DT, inp);

  let owedChecked = 0;
  let owedWorst = 0;
  for (const e of w.enemies) {
    const was = owedBefore.get(e.id);
    if (was === undefined || !e.lunge || e.lungeBeat < 0) continue;
    owedChecked++;
    owedWorst = Math.max(owedWorst, Math.abs(e.lungeBeat - w.transport.beat - was));
  }
  const during = {
    time: w.snapshot.time,
    beat: w.transport.beat,
    enemies: w.enemies.map((e) => [e.x, e.y]),
    bodies: w.enemies.length,
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
  let peakBodies = w.enemies.length;
  for (let i = 0; i < 480; i++) {
    if (i % 2 === 0) { drive(w, inp); inp.choice = -1; }
    w.update(DT, inp);
    peakBodies = Math.max(peakBodies, w.enemies.length);
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
    bodyDelta: during.bodies - before.bodies,
    owedChecked,
    owedWorst,
    firedAfterResume: fired,
    peakBodies,
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
    `bodies ${r.bodyDelta >= 0 ? '+' : ''}${r.bodyDelta}   enemies that attack ${r.armed}   ` +
    `owed drift ${r.owedWorst.toFixed(3)} beats over ${r.owedChecked}   after resume: ${r.firedAfterResume} lunges`);
}

const fails = [];
for (const r of rows) {
  if (r.worldTimeAdvanced > 1e-9) fails.push(`held ${r.holdSecs}s: world time advanced ${r.worldTimeAdvanced.toFixed(4)}s — the world is not stopped`);
  if (r.enemyDrift > 1e-6) fails.push(`held ${r.holdSecs}s: enemies drifted ${r.enemyDrift.toFixed(3)}px — the world is not stopped`);
  if (r.bodyDelta !== 0) fails.push(`held ${r.holdSecs}s: ${r.bodyDelta} bodies appeared or died during the pause`);
  // Print the denominator, and treat zero as a failure: a hold that checked
  // nothing looks exactly like a hold that held.
  if (r.owedChecked === 0) fails.push(`held ${r.holdSecs}s: no scheduled attack survived the pause — the phase check measured nothing`);
  else if (r.owedWorst > 1e-6) {
    fails.push(`held ${r.holdSecs}s: a body's next attack moved ${r.owedWorst.toFixed(3)} beats relative to the transport — ` +
      'the stage lost its phase against the bar it was choreographed to');
  }
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
  fails.push('no attacking enemies were on the field during any hold — the no-dump check measured nothing; raise SKIP_OFFERS');
}
if (rows.length && rows.every((r) => r.firedAfterResume === 0)) {
  fails.push('nothing attacked after ANY resume — the no-dump comparison is vacuous, not passing');
}
if (rows.length >= 2) {
  const base = rows[0].firedAfterResume;
  const worst = Math.max(...rows.map((r) => r.firedAfterResume));
  console.log(`\n  lunges after resume: ${rows.map((r) => `${r.holdSecs}s->${r.firedAfterResume}`).join('  ')}`);
  if (worst > base * 2 + 3) {
    fails.push(`a longer pause produced ${worst} lunges on resume against ${base} for the shortest — ` +
      'the schedule banked its overdue beats and dumped them, which is exactly what the hold exists to stop');
  }
}
console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  world frozen, music running, no volley dump on resume');
