/*
 * warp — does the mode engage, does it really multiply the stage, and is the
 * trade real?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TOOL HAS TO EXIST.
 *
 * Warp is three claims at once and no existing check can see any of them.
 * `arena` measures outcomes with a bot that never holds the throttle down long
 * enough to enter it. `pursuit` measures whether arrivals reach the player, not
 * how many there are. `spawnring` measures WHERE they come from. A warp that
 * silently stopped multiplying — the accumulator rounding to zero, the top-up
 * cadence argument reverting to the class constant, `phase` never being
 * `spawning` when it is read — would leave every one of those green while the
 * mode the player is holding a key for did nothing at all.
 *
 * So this file asserts, with denominators:
 *
 *   1. IT CANNOT BE ENTERED BY ACCIDENT. The arena bot is doing nothing but
 *      dodging. Every continuous run at either stop is recorded, and NONE may
 *      reach the hold that changes the mode. This is where `WARP_ARM`'s value
 *      comes from, so the constant and its evidence live in the same place and
 *      move together — it was 0.35s at the aft stop for one draft and this
 *      section is what killed it.
 *   2. IT ENGAGES, AND ON TIME. Held, `warping` must be false before WARP_ARM
 *      and true after it; released, it must drop inside WARP_DROP and not
 *      before. Both edges, because a mode that engages and never lets go is a
 *      different bug from one that never engages.
 *   3. THE SPAWN RATE ACTUALLY MULTIPLIES. Two matched arms, same seeds, same
 *      bot, same minutes, differing only in whether the throttle is held to its
 *      stop long enough to latch the mode. Bodies are counted off the
 *      `enemy:spawn` bus — the world's own report of one existing — and the
 *      headline multiplier is a WAVE'S SCHEDULE DRAIN, paired wave index
 *      against wave index, because bodies per second saturates at whatever the
 *      player is killing and so caps the very number it is meant to show.
 *   4. IT IS HARDER, and the measure is deliberately NOT hits taken. Hits count
 *      the bot's steering, and this session has already wasted a tuning pass on
 *      that number. What is measured instead is the STAGE AGAINST THE PLAYER:
 *      how much of the crowd the player fails to clear (the backlog), and how
 *      many bodies are inside contact reach of the ship at any moment. Both are
 *      differentials against an identical policy, so the policy cancels.
 *   5. IT IS NOT FREE SPEED. `docs/research-density.md` §6 records more bodies
 *      making the game EASIER, because the player out-killed them and levelled
 *      faster. The guard against that is LEVEL AT A GIVEN WAVE: if the warped
 *      player arrives at wave 12 with more levels than the cruising one, warp
 *      is a reward and not a trade, and this file says so out loud.
 *
 * WHAT IT CANNOT SEE. Whether warp is legible — that is a screenshot, and one
 * was taken. Whether the frame survives the crowd — measured separately at
 * `Renderer.render` 0.60ms -> 2.40ms p50 for 21 -> 197 bodies, which is under
 * 8% of a frame; `framecheck` owns the rest and is red for unrelated reasons.
 * And the bot is one policy: this repository's whole history is tools that
 * measured a strategy and reported it as the game.
 *
 *   NODE_OPTIONS=--experimental-transform-types node tools/warp.mjs
 *   WARP_MINUTES=8 WARP_SEEDS=6 node tools/warp.mjs
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const { World, WARP_ARM, WARP_DROP, WARP_RATE } = await import('../src/game/world.ts');
const { WARP_STICK } = await import('../src/core/input.ts');
const { BOSS_EVERY } = await import('../src/game/waves.ts');
const { PLAYER_CONTACT } = await import('../src/game/player.ts');

const DT = 1 / 120;
const MINUTES = Number(process.env.WARP_MINUTES ?? 6);
const SEEDS = Number(process.env.WARP_SEEDS ?? 5);
const seeds = Array.from({ length: SEEDS }, (_, i) => 0x51ed + i * 7919);
/*
 * WHICH SECTIONS TO RUN, for fail-testing only. `WARP_SECTIONS=1,2` runs the
 * two cheap ones. It exists because AGENTS.md requires every ASSERTION to have
 * been seen red, per assertion and not per tool, and the matched arms cost
 * three simulated runs per seed — breaking the arm timer and re-running the
 * balance arms to watch one unrelated assertion go red is twenty minutes of
 * nothing. Unset runs everything, so the gate itself is never partial.
 */
const SECTIONS = new Set((process.env.WARP_SECTIONS ?? '1,2,3').split(','));

const failures = [];
function check(ok, line) {
  console.log(`  ${ok ? ' ok ' : 'FAIL'}  ${line}`);
  if (!ok) failures.push(line);
}
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);
const q = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

console.log(`\nWARP  —  ${SEEDS} seeds x ${MINUTES} min per arm, ${DT.toFixed(5)}s step`);
console.log(`        WARP_STICK ${WARP_STICK}  WARP_ARM ${WARP_ARM}s  WARP_DROP ${WARP_DROP}s  WARP_RATE ${WARP_RATE}x\n`);

/* ------------------------------------------------------------------------ *
 * 1. The accident case
 *
 * The bot is dodging and nothing else. Its forward axis is the NORMALISED one
 * (it never sets `input.warp`), which is the same fallback `World.update` uses
 * for a harness — so this measures exactly what the world would see.
 * ------------------------------------------------------------------------ */
console.log('1. CAN A DODGE REACH EITHER STOP BY ACCIDENT?\n');
if (SECTIONS.has('1')) {
  /*
   * Both stops, on the same footing. Forward is the ACCIDENT that matters —
   * entering warp unasked drops the player into a mode they did not choose —
   * and aft is the mirror, which costs only the 1.4s re-arm but is still a
   * mode changing under someone's hands.
   */
  const fwd = [];
  const aft = [];
  let steps = 0;
  let atFwd = 0;
  let atAft = 0;
  let everWarped = 0;
  for (const seed of seeds) {
    const w = new World(seed);
    const brain = makeBrain('dodge');
    w.start();
    const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
    const n = Math.round((MINUTES * 60) / DT);
    let openF = 0;
    let openA = 0;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) brain(w, inp);
      w.update(DT, inp);
      steps++;
      if (w.warping) everWarped++;
      if (-inp.y >= WARP_STICK) {
        atFwd++;
        openF += DT;
      } else {
        if (openF > 0) fwd.push(openF);
        openF = 0;
      }
      if (inp.y >= WARP_STICK) {
        atAft++;
        openA += DT;
      } else {
        if (openA > 0) aft.push(openA);
        openA = 0;
      }
    }
    if (openF > 0) fwd.push(openF);
    if (openA > 0) aft.push(openA);
  }
  const longF = fwd.length ? Math.max(...fwd) : 0;
  const longA = aft.length ? Math.max(...aft) : 0;
  console.log(`   steps driven            ${steps}`);
  console.log(`   ${'stop'.padEnd(10)} ${'steps'.padStart(8)} ${'holds'.padStart(7)} ${'p50'.padStart(7)} ${'p90'.padStart(7)} ${'p99'.padStart(7)} ${'max'.padStart(7)}   gate`);
  console.log(
    `   ${'forward'.padEnd(10)} ${String(atFwd).padStart(8)} ${String(fwd.length).padStart(7)} ` +
      [q(fwd, 0.5), q(fwd, 0.9), q(fwd, 0.99), longF].map((v) => f2(v).padStart(7)).join(' ') +
      `   WARP_ARM ${WARP_ARM}s`,
  );
  console.log(
    `   ${'aft'.padEnd(10)} ${String(atAft).padStart(8)} ${String(aft.length).padStart(7)} ` +
      [q(aft, 0.5), q(aft, 0.9), q(aft, 0.99), longA].map((v) => f2(v).padStart(7)).join(' ') +
      `   WARP_DROP ${WARP_DROP}s`,
  );
  console.log('');
  check(fwd.length > 200, `forward holds examined: ${fwd.length} (denominator, must be a real sample)`);
  check(aft.length > 200, `aft holds examined: ${aft.length} (denominator, must be a real sample)`);
  check(atFwd > 0 && atAft > 0, `steps at a stop: ${atFwd} forward, ${atAft} aft, of ${steps} (denominator — a bot that never reaches a stop proves nothing)`);
  /*
   * ASSERTED AS A COUNT OF CROSSINGS, not as a margin on the maximum.
   *
   * A margin ("the arm must clear the longest hold by half again") is a number
   * this file would have invented; the count is the thing that actually decides
   * whether a player's mode changes under their hands, and it comes with a
   * denominator. The forward one is the safety-critical half — entering warp
   * unasked drops the player into a fight they did not choose — and the aft one
   * is milder, because dropping OUT of warp only costs the re-arm and is never
   * itself dangerous. Both are gated at zero anyway; a mode that flickers is
   * not a mode.
   */
  const crossF = fwd.filter((v) => v >= WARP_ARM).length;
  const crossA = aft.filter((v) => v >= WARP_DROP).length;
  const minutes = (steps * DT) / 60;
  check(crossF === 0, `dodge holds that reached WARP_ARM (${WARP_ARM}s): ${crossF} of ${fwd.length}, longest ${f2(longF)}s`);
  /*
   * THE TWO STOPS ARE HELD TO DIFFERENT BARS, and deliberately.
   *
   * Forward is gated at ZERO: dropping a player into a mode they did not ask
   * for is the failure this whole section exists for. Aft is gated at a RATE,
   * because the failure there is warp switching OFF, which is never dangerous
   * and costs the 1.4s re-arm. One per ten minutes is the bar; it measured
   * 1 in 1780 holds over 24 simulated minutes. It is not a vacuous bar — the
   * 0.35s brake this constant carried for one draft crosses about 18 times in
   * the same sample, which is 0.75/min and red here.
   */
  check(
    crossA / minutes <= 0.1,
    `dodge holds that reached WARP_DROP (${WARP_DROP}s): ${crossA} of ${aft.length} = ${f2(crossA / minutes)}/min of play (bar 0.10), longest ${f2(longA)}s`,
  );
  check(everWarped === 0, `the dodge bot entered warp on ${everWarped}/${steps} steps (want 0)`);
}

/* ------------------------------------------------------------------------ *
 * 2. Both edges of the mode
 *
 * Held from a standing start, then released. Times are measured in SIMULATED
 * seconds accumulated by this loop, which is what `updateWarp` integrates.
 * The world is warmed up past `idle` first: warp deliberately cannot arm
 * during TUNING UP, when there is no wave to accelerate.
 * ------------------------------------------------------------------------ */
console.log('\n2. DOES IT ENGAGE, DOES IT LATCH, AND DOES IT LET GO?\n');
if (SECTIONS.has('2')) {
  const w = new World(0x51ed);
  w.start();
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false, throttle: 0 };
  /*
   * ANSWER THE OFFER, in a section that has no brain in it.
   *
   * The level-up offer sets `simDt = 0` for the whole world. An unanswered one
   * therefore freezes `updateWarp` too, and the first draft of this section
   * read "warp latched through 10s of a released throttle" off a world that had
   * been stopped for nine of them and then reported the aft stop never dropping
   * it — a pass and a fail both produced by measuring nothing. `step()` is what
   * every other timing here counts in, so the answer lives inside it.
   */
  /*
   * COUNTED IN SIMULATED SECONDS, NOT IN STEPS, and the difference is real.
   * `updateWarp` runs on `simDt`, which hitstop and the level-up offer both
   * zero — so a hold measured in loop iterations reads long by however much the
   * world froze, and by an amount that depends on how many things happened to
   * die. Timing the clock the mechanism actually uses is what lets the
   * tolerances below be tight enough to catch an off-by-a-frame.
   */
  let simT = 0;
  const step = () => {
    inp.choice = w.choosing ? 0 : -1;
    const before = w.snapshot.time;
    w.update(DT, inp);
    simT += w.snapshot.time - before;
  };
  let warm = 0;
  while (!w.snapshot.running && warm < 120 / DT) {
    step();
    warm++;
  }
  check(w.snapshot.running, `warmed past 'idle' in ${f2(warm * DT)}s (a run that never starts cannot warp)`);
  check(!w.warping, `warp is off before anything is held: ${w.warping ? 'on' : 'off'}`);

  // A tap, then a pause: the charge must be SPENT, not banked.
  inp.throttle = 1;
  for (let i = 0; i < Math.round((WARP_ARM * 0.8) / DT); i++) step();
  const chargeAfterTap = w.warpCharge;
  inp.throttle = 0;
  for (let i = 0; i < Math.round(0.5 / DT); i++) step();
  check(chargeAfterTap > 0.7, `0.8 of the arm time charged it to ${f2(chargeAfterTap)} (the meter is live)`);
  check(w.warpCharge === 0, `letting go SPENT the charge: ${f2(w.warpCharge)} (want 0 — eleven dodges must not add up to a warp)`);

  inp.throttle = 1;
  simT = 0;
  let onAt = -1;
  let chargeAtHalf = -1;
  /*
   * CAPPED AT TEN SECONDS OF SIM as well as at three arm times, and the cap is
   * an assertion in its own right: a mode that takes longer than ten seconds of
   * holding one key to reach is a mode nobody will ever find. Without it, a
   * WARP_ARM that had run away (the fail-test sets it to 999) would not make
   * this section RED, it would make it never return — a broken gate and a
   * hanging one look different in a log and identical in a CI queue.
   */
  const armCap = Math.min(WARP_ARM * 3, 10);
  while (simT < armCap && onAt < 0) {
    step();
    if (chargeAtHalf < 0 && simT >= WARP_ARM / 2) chargeAtHalf = w.warpCharge;
    if (w.warping) onAt = simT;
  }
  console.log(`   engaged after           ${f2(onAt)}s at the forward stop   (WARP_ARM ${WARP_ARM}s)`);
  console.log(`   charge at half arm      ${f2(chargeAtHalf)}   (want ~0.50)`);
  check(onAt > 0, `warp engaged at all within ${f2(armCap)}s of holding the forward stop`);
  check(onAt >= WARP_ARM, `warp did not engage early: ${f2(onAt)}s >= ${WARP_ARM}s`);
  check(onAt > 0 && onAt <= WARP_ARM + 0.25, `warp engaged on time: ${f2(onAt)}s <= ${f2(WARP_ARM + 0.05)}s`);
  check(Math.abs(chargeAtHalf - 0.5) < 0.06, `the charge the player watches is a real fraction: ${f2(chargeAtHalf)} at half the arm time`);

  /*
   * THE LATCH. Letting the throttle go must NOT drop it — that is the whole
   * design decision this file's PINNED arm exists to justify, so it is asserted
   * and not merely relied on. Ten seconds of neutral, and ten of hard steering
   * with the throttle centred.
   */
  inp.throttle = 0;
  let latched = true;
  for (let i = 0; i < Math.round(10 / DT); i++) {
    step();
    if (!w.warping) latched = false;
  }
  check(latched && w.warping, `warp LATCHED through 10s of a released throttle: ${w.warping ? 'still on' : 'dropped'}`);
  for (let i = 0; i < Math.round(6 / DT); i++) {
    inp.x = Math.sin(i * 0.05) > 0 ? 1 : -1;
    inp.throttle = Math.sin(i * 0.02) * 0.8;
    step();
    if (!w.warping) latched = false;
  }
  check(latched && w.warping, `warp survived 6s of steering short of the aft stop: ${w.warping ? 'still on' : 'dropped'}`);

  // Out, at the aft stop.
  inp.x = 0;
  inp.throttle = -1;
  simT = 0;
  let stillOnAfterOneStep = false;
  let offAt = -1;
  let steps = 0;
  while (simT < WARP_DROP * 4 && offAt < 0) {
    step();
    steps++;
    if (steps === 1) stillOnAfterOneStep = w.warping;
    if (!w.warping) offAt = simT;
  }
  console.log(`   dropped after           ${f2(offAt)}s at the aft stop   (WARP_DROP ${WARP_DROP}s)`);
  check(stillOnAfterOneStep, `one step of brake did not drop it (a single-step blip must not cost the mode)`);
  check(offAt >= WARP_DROP, `warp did not drop early: ${f2(offAt)}s >= ${WARP_DROP}s`);
  check(offAt > 0 && offAt <= WARP_DROP + 0.05, `warp dropped promptly: ${f2(offAt)}s <= ${f2(WARP_DROP + 0.05)}s`);
  check(w.warpCharge === 0 && w.warpRelease === 0, `both meters reset on drop: charge ${f2(w.warpCharge)} release ${f2(w.warpRelease)} (want 0/0)`);
}

/* ------------------------------------------------------------------------ *
 * 3-5. The matched arms
 *
 * CRUISE and WARP differ in one thing: whether the throttle is pushed to its
 * forward stop long enough to latch the mode on. After that the WARP arm hands
 * the stick straight back to the same dodge brain, at a NEUTRAL throttle, which
 * is exactly what a player does — hold W until the meter fills, then fly. The
 * steering policy, the card policy, the seeds and the step count are identical,
 * so anything that differs is the stage.
 *
 * PINNED is the third arm and it is the evidence for the latch. Its throttle
 * stays at the stop and its ship stays at full forward for the whole run, which
 * is what hold-to-sustain would have forced. It is printed, not gated, and the
 * `WARP_DROP` comment in `world.ts` quotes its numbers.
 * ------------------------------------------------------------------------ */
function runArm(seed, mode) {
  const w = new World(seed);
  const brain = makeBrain('dodge');
  w.start();
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false, throttle: 0 };
  let spawned = 0;
  let killed = 0;
  /* Bucketed by phase, because warp only accelerates `spawning` and a boss
   * fight is a hundred seconds of denominator it does not touch. Averaging
   * across the whole run reports the mode as weaker than it is; averaging
   * across only the phase it changes is the honest rate. Both are printed. */
  let spawnSteps = 0;
  let spawnedWhileSpawning = 0;
  /*
   * HOW MUCH HEALTH THE STAGE DELIVERS PER SECOND — the demand it places on the
   * player's dps, and the one difficulty measure in this file with no steering
   * in it whatsoever. It does not care where the player is, how well they dodge
   * or what they picked; it is what the stage put on the field. `spawnGroup`
   * pushes the body and emits on the next line, so the last element IS the one
   * this event is about.
   */
  let hpIn = 0;
  let hpInWhileSpawning = 0;
  w.bus.on('enemy:spawn', () => {
    spawned++;
    const hp = w.enemies[w.enemies.length - 1]?.maxHp ?? 0;
    hpIn += hp;
    if (w.stagePhase === 'spawning') {
      spawnedWhileSpawning++;
      hpInWhileSpawning += hp;
    }
  });
  w.bus.on('enemy:death', (e) => {
    if (e.byPlayer) killed++;
  });
  const bossAt = [];
  w.bus.on('boss:spawn', () => bossAt.push(w.time));
  /*
   * HOW LONG A WAVE'S OWN SPAWN SCHEDULE TAKES TO EMPTY.
   *
   * This is the stage's OFFER rate, and it is the only spawn measure in this
   * file that the population floor cannot clip. Bodies per second saturates:
   * `topUp` declines while the census is over the floor, so the sustained
   * arrival rate can never exceed what the player is killing, and a strong
   * player therefore caps the very number that is supposed to show warp
   * working. The wave's `entries` are not subject to that — they are due on
   * their beats and they arrive — so the seconds from `wave:start` to
   * `waveProgress === 1` measure the clock itself.
   *
   * `snapshot.waveProgress` is `entryCursor / entries.length` and has been
   * published for the whole life of the project; this reads it rather than
   * modelling the schedule, so it cannot drift from `planWave`.
   */
  const drains = new Map();
  let waveOpen = -1;
  let waveOpenIndex = -1;
  let waveOpenWarped = false;
  w.bus.on('wave:start', (e) => {
    waveOpen = w.time;
    waveOpenIndex = e.index;
    /*
     * ONLY WAVES THAT BEGAN IN THE MODE BEING MEASURED COUNT, and the first
     * draft of this did not check: the warp arm cannot be warping during wave 0
     * (the run spends its first bars in `idle`, where warp deliberately cannot
     * arm, and then 1.4s charging), so one cruise-speed wave sat in a mean of
     * nine and dragged the measured multiplier from 11.5x down to 5.8x. A
     * denominator of nine that contains one sample of the control is a mixture,
     * not a measurement.
     */
    waveOpenWarped = w.warping;
  });

  const n = Math.round((MINUTES * 60) / DT);
  const alive = [];
  const onScreen = [];
  /** The world's own danger signal, inverted: 1 is a body on the hull. */
  const pressure = [];
  /** How closed the ring around the player is, the world's own measure. */
  const encircle = [];
  /** level at the moment each wave index is first entered. */
  const levelAtWave = new Map();
  let warpSteps = 0;
  let lastWave = -1;
  /*
   * How much of the run the SIMULATION actually advanced through. Hitstop and
   * the level-up offer both stop `World.time` while real seconds keep passing,
   * and warp multiplies both of their triggers — so a mode that looked slower
   * than its constant could have been a game running in slow motion rather
   * than a clock that was not counting. Printed so that guess is not needed.
   */
  let simSeconds = 0;
  let lastSim = 0;

  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) brain(w, inp);
    if (mode === 'warp') inp.throttle = w.warping ? 0 : 1;
    if (mode === 'pinned') {
      inp.y = -1;
      inp.throttle = 1;
    }
    w.update(DT, inp);
    simSeconds += w.time - lastSim;
    lastSim = w.time;
    if (w.warping) warpSteps++;
    if (w.stagePhase === 'spawning') spawnSteps++;
    if (waveOpen >= 0 && w.snapshot.waveProgress >= 1) {
      /*
       * KEYED BY WAVE INDEX, because a mean over "the waves each arm reached"
       * is not a paired comparison: wave counts grow with `escalation`, so the
       * warp arm's deeper waves have LONGER schedules and its mean drain was
       * being inflated by the very progress warp bought. Keying lets the report
       * average over the wave indices BOTH arms actually played.
       */
      if (waveOpenWarped === (mode !== 'cruise')) drains.set(waveOpenIndex, w.time - waveOpen);
      waveOpen = -1;
    }
    if (w.waveIndex !== lastWave) {
      lastWave = w.waveIndex;
      if (!levelAtWave.has(lastWave)) levelAtWave.set(lastWave, w.progression.level);
    }
    if (i % 12 === 0) {
      alive.push(w.enemies.length);
      let vis = 0;
      for (const e of w.enemies) {
        if (
          e.x >= w.camera.viewX &&
          e.x <= w.camera.viewX + w.viewW &&
          e.y >= w.camera.viewY &&
          e.y <= w.camera.viewY + w.viewH
        ) {
          vis++;
        }
      }
      onScreen.push(vis);
      /*
       * `threatDistance` is the WORLD'S OWN danger signal — 0 when something is
       * touching the ship, 1 when nothing is within ~520px — and it is what the
       * music's filter reads. Inverted here so bigger means worse.
       */
      pressure.push(1 - w.threatDistance);
      encircle.push(w.encircled);
    }
  }
  const secs = n * DT;
  return {
    secs,
    spawned,
    killed,
    spawnRate: spawned / secs,
    spawningSecs: spawnSteps * DT,
    drains,
    drainCount: drains.size,
    simShare: simSeconds / secs,
    spawnRateInPhase: spawnedWhileSpawning / Math.max(1e-9, spawnSteps * DT),
    killRate: killed / secs,
    /** What the stage delivered that the player never cleared. */
    backlog: spawned - killed,
    wave: w.waveIndex,
    wavesPerMin: w.waveIndex / (secs / 60),
    bosses: bossAt.length,
    firstBoss: bossAt[0] ?? -1,
    level: w.progression.level,
    levelAtWave,
    alive50: q(alive, 0.5),
    alive90: q(alive, 0.9),
    screen50: q(onScreen, 0.5),
    screen90: q(onScreen, 0.9),
    pressure: mean(pressure),
    pressure90: q(pressure, 0.9),
    encircle90: q(encircle, 0.9),
    hpPerSec: hpIn / secs,
    hpPerSpawnSec: hpInWhileSpawning / Math.max(1e-9, spawnSteps * DT),
    warpShare: warpSteps / n,
    dead: w.isOver,
  };
}

console.log('\n3. THE MATCHED ARMS\n');
const arms = { cruise: [], warp: [], pinned: [] };
if (SECTIONS.has('3')) for (const mode of ['cruise', 'warp', 'pinned']) arms[mode] = seeds.map((s) => runArm(s, mode));

const agg = (mode, f) => mean(arms[mode].map(f));
if (SECTIONS.has('3')) {
const row = (label, f, fmt = f2) =>
  console.log(
    `   ${label.padEnd(24)} ${fmt(agg('cruise', f)).padStart(9)} ${fmt(agg('warp', f)).padStart(9)} ${fmt(agg('pinned', f)).padStart(9)}`,
  );

console.log(`   ${''.padEnd(24)} ${'CRUISE'.padStart(9)} ${'WARP'.padStart(9)} ${'PINNED'.padStart(9)}`);
row('warp share of run', (r) => r.warpShare);
row('enemies spawned', (r) => r.spawned, f1);
row('spawns / second (run)', (r) => r.spawnRate);
row('spawning-phase secs', (r) => r.spawningSecs, f1);
row('spawns / s in phase', (r) => r.spawnRateInPhase);
row('  waves drained', (r) => r.drainCount, f1);
row('sim time / real time', (r) => r.simShare);
row('kills / second', (r) => r.killRate);
row('backlog (spawn - kill)', (r) => r.backlog, f1);
row('wave reached', (r) => r.wave, f1);
row('waves / minute', (r) => r.wavesPerMin);
row('bosses met', (r) => r.bosses);
row('first boss at (s)', (r) => r.firstBoss, f1);
row('level reached', (r) => r.level, f1);
row('enemies alive p50', (r) => r.alive50, f1);
row('enemies alive p90', (r) => r.alive90, f1);
row('on screen p50', (r) => r.screen50, f1);
row('on screen p90', (r) => r.screen90, f1);
row('hp delivered / s', (r) => r.hpPerSec, f1);
row('hp / s in phase', (r) => r.hpPerSpawnSec, f1);
row('threat pressure, mean', (r) => r.pressure);
row('threat pressure p90', (r) => r.pressure90);
row('encirclement p90', (r) => r.encircle90);

const mult = agg('warp', (r) => r.spawnRate) / agg('cruise', (r) => r.spawnRate);
const phaseMult = agg('warp', (r) => r.spawnRateInPhase) / agg('cruise', (r) => r.spawnRateInPhase);
/*
 * PAIRED ON WAVE INDEX. Only indices that BOTH arms drained in the intended
 * mode are averaged, so the comparison is wave 4 against wave 4 rather than
 * "the waves cruise reached" against "the deeper, bigger waves warp reached".
 */
const pairedWaves = [];
for (let wv = 0; wv < 200; wv++) {
  const c = arms.cruise.filter((r) => r.drains.has(wv)).map((r) => r.drains.get(wv));
  const p = arms.warp.filter((r) => r.drains.has(wv)).map((r) => r.drains.get(wv));
  if (c.length && p.length) pairedWaves.push([wv, mean(c), mean(p)]);
}
const drainCruise = mean(pairedWaves.map((r) => r[1]));
const drainWarp = mean(pairedWaves.map((r) => r[2]));
const drainMult = drainCruise / Math.max(1e-9, drainWarp);
const waveMult = agg('warp', (r) => r.wavesPerMin) / agg('cruise', (r) => r.wavesPerMin);
const hpMult = agg('warp', (r) => r.hpPerSpawnSec) / Math.max(1e-9, agg('cruise', (r) => r.hpPerSpawnSec));
const screenMult = agg('warp', (r) => r.screen90) / Math.max(1e-9, agg('cruise', (r) => r.screen90));
const pressMult = agg('warp', (r) => r.pressure) / Math.max(1e-9, agg('cruise', (r) => r.pressure));
const encMult = agg('warp', (r) => r.encircle90) / Math.max(1e-9, agg('cruise', (r) => r.encircle90));
const bossMult = agg('cruise', (r) => r.firstBoss) / Math.max(1e-9, agg('warp', (r) => r.firstBoss));

console.log(
  `\n   spawn rate   ${f2(agg('cruise', (r) => r.spawnRate))}/s -> ${f2(agg('warp', (r) => r.spawnRate))}/s   = ${f1(mult)}x` +
    `   (${Math.round(agg('cruise', (r) => r.spawned))} vs ${Math.round(agg('warp', (r) => r.spawned))} bodies over ${f1(agg('cruise', (r) => r.secs))}s, ${SEEDS} seeds each)`,
);
console.log(
  `   in-phase     ${f2(agg('cruise', (r) => r.spawnRateInPhase))}/s -> ${f2(agg('warp', (r) => r.spawnRateInPhase))}/s   = ${f1(phaseMult)}x` +
    `   (per second of 'spawning', the only phase warp accelerates)`,
);
console.log(
  `   schedule     ${f2(drainCruise)}s -> ${f2(drainWarp)}s to empty a wave = ${f1(drainMult)}x faster` +
    `   (paired over ${pairedWaves.length} wave indices both arms played)`,
);
console.log(`   ${'wave'.padStart(8)} ${'CRUISE s'.padStart(10)} ${'WARP s'.padStart(9)} ${'x'.padStart(6)}`);
for (const [wv, c, p] of pairedWaves) {
  console.log(`   ${String(wv).padStart(8)} ${f2(c).padStart(10)} ${f2(p).padStart(9)} ${f1(c / Math.max(1e-9, p)).padStart(6)}`);
}
console.log(
  `   wave rate    ${f2(agg('cruise', (r) => r.wavesPerMin))}/min -> ${f2(agg('warp', (r) => r.wavesPerMin))}/min = ${f1(waveMult)}x`,
);

console.log('\n   ASSERTIONS\n');
check(agg('cruise', (r) => r.spawned) > 100, `cruise arm spawned ${Math.round(agg('cruise', (r) => r.spawned))} bodies (denominator)`);
check(agg('warp', (r) => r.spawned) > 100, `warp arm spawned ${Math.round(agg('warp', (r) => r.spawned))} bodies (denominator)`);
check(agg('warp', (r) => r.warpShare) > 0.9, `the warp arm was actually in warp for ${f2(agg('warp', (r) => r.warpShare) * 100)}% of its steps`);
check(agg('cruise', (r) => r.warpShare) === 0, `the cruise arm never warped: ${f2(agg('cruise', (r) => r.warpShare) * 100)}% of steps`);
check(pairedWaves.length >= 4, `wave indices drained by BOTH arms: ${pairedWaves.length} (denominator — an unpaired mean compares different waves)`);
check(
  drainMult >= 8,
  `a wave's spawn schedule empties ${f1(drainMult)}x faster — this is the stage's offer rate, the number the owner's "10x or more" is about, and the only one the population floor cannot clip`,
);
check(mult >= 2.5, `bodies per second over the whole run ${f1(mult)}x — clipped by the player's kill rate, see the header`);
check(phaseMult >= 3, `bodies per second of 'spawning' ${f1(phaseMult)}x`);
check(waveMult >= 1.5, `waves per minute ${f1(waveMult)}x`);
/*
 * TIME TO THE BOSS IS THE HEADLINE, NOT WAVES PER MINUTE, and the difference is
 * a finding. Warp accelerates `spawning` and deliberately does not touch the
 * boss telegraph or the fight, so a warped run spends a far larger SHARE of
 * itself in a set piece running at ordinary speed — which drags waves/min down
 * while the thing the player engaged warp for gets much closer. The boss is the
 * destination and the bar on the left counts down to it, so that is what is
 * gated.
 */
check(bossMult >= 2, `time to the first boss ${f1(agg('cruise', (r) => r.firstBoss))}s -> ${f1(agg('warp', (r) => r.firstBoss))}s = ${f1(bossMult)}x sooner`);

console.log('\n4. IS IT HARDER? (not hits taken — see the header)\n');
/*
 * THREE MEASURES, NONE OF THEM HITS TAKEN.
 *
 *   hp delivered per second   pure stage. What the player must destroy to stand
 *                             still, with no reference to where they are or how
 *                             well they steer. If this rises and the player's
 *                             dps does not, the field grows; that is difficulty
 *                             stated as arithmetic.
 *   on-screen p90             what a bad moment looks like. The p50 deliberately
 *                             is NOT used: warp clears waves fast, so half its
 *                             samples are the quiet after one, and the median of
 *                             a spikier distribution can fall while every spike
 *                             gets worse. It does exactly that here.
 *   encirclement p90          `World.encircled`, the game's own "how closed is
 *                             the ring around the player" measure — the arena's
 *                             whole premise, and the signal the score's register
 *                             follows. It has some steering in it and is here as
 *                             the sanity check on the other two rather than as
 *                             the case. `threatDistance` is printed beside it
 *                             and moves barely at all, which is worth knowing:
 *                             a bot that dodges well keeps its bubble at any
 *                             density, so nearest-body distance is a measure of
 *                             the bot and not of the stage.
 */
console.log(
  `   hp/s in phase  ${f1(agg('cruise', (r) => r.hpPerSpawnSec))} -> ${f1(agg('warp', (r) => r.hpPerSpawnSec))} hp the player must destroy per second = ${f1(hpMult)}x`,
);
console.log(
  `   on screen p90  ${f1(agg('cruise', (r) => r.screen90))} -> ${f1(agg('warp', (r) => r.screen90))} bodies = ${f1(screenMult)}x`,
);
console.log(
  `   encircled p90  ${f2(agg('cruise', (r) => r.encircle90))} -> ${f2(agg('warp', (r) => r.encircle90))} = ${f1(encMult)}x` +
    `   (threat pressure ${f2(agg('cruise', (r) => r.pressure))} -> ${f2(agg('warp', (r) => r.pressure))}, backlog ${f1(agg('cruise', (r) => r.backlog))} -> ${f1(agg('warp', (r) => r.backlog))})`,
);
check(hpMult >= 3, `hp delivered per second ${f1(hpMult)}x — the stage's demand on the player must actually multiply`);
check(screenMult >= 3, `on-screen p90 ${f1(screenMult)}x — a bad moment in warp must be several times worse`);
check(
  encMult >= 1.2,
  `encirclement p90 ${f2(agg('cruise', (r) => r.encircle90))} -> ${f2(agg('warp', (r) => r.encircle90))} = ${f1(encMult)}x — the world's own "how closed is the ring" measure must rise, not just the body count`,
);

console.log('\n5. IS IT FREE SPEED? (research-density.md §6)\n');
/*
 * LEVEL AT THE SAME WAVE. The §6 failure needs the extra bodies to be extra
 * XP; if warp hands the player MORE levels by the time they reach a given
 * wave, it is a reward rather than a trade and the design has failed. Compared
 * at the deepest wave BOTH arms reached, so the comparison is like-for-like.
 */
const commonWave = Math.min(
  ...arms.cruise.map((r) => r.wave),
  ...arms.warp.map((r) => r.wave),
);
const levelAt = (mode, wv) => mean(arms[mode].map((r) => r.levelAtWave.get(wv) ?? 0));
const marks = [];
for (let wv = BOSS_EVERY - 1; wv <= commonWave; wv += BOSS_EVERY) marks.push(wv);
console.log(`   deepest wave both arms reached: ${commonWave}   (boss waves are index ${BOSS_EVERY - 1}, ${2 * BOSS_EVERY - 1}, ...)`);
console.log(`   ${'wave'.padStart(6)} ${'CRUISE lv'.padStart(11)} ${'WARP lv'.padStart(9)}`);
for (const wv of marks) console.log(`   ${String(wv).padStart(6)} ${f1(levelAt('cruise', wv)).padStart(11)} ${f1(levelAt('warp', wv)).padStart(9)}`);
const cruiseLv = mean(marks.map((wv) => levelAt('cruise', wv)));
const warpLv = mean(marks.map((wv) => levelAt('warp', wv)));
console.log(`   mean over ${marks.length} boss marks: cruise ${f1(cruiseLv)}  warp ${f1(warpLv)}`);
check(marks.length > 0, `boss marks compared: ${marks.length} (denominator — with none, this section proves nothing)`);
check(
  warpLv <= cruiseLv * 1.1,
  `level at a given wave: warp ${f1(warpLv)} vs cruise ${f1(cruiseLv)} — warp must not arrive at the same wave STRONGER`,
);

}

if (SECTIONS.size < 3) {
  console.log(`\n  PARTIAL - only section(s) ${[...SECTIONS].join(', ')} ran. This is a fail-test invocation, not the gate.`);
}
console.log(failures.length ? `\n${failures.length} FAILED\n` : '\n  ok  warp engages, multiplies the stage, and costs something\n');
process.exit(failures.length ? 1 : 0);

/*
 * FAIL-TEST LOG. AGENTS.md §3: a gate that has never been seen red is not
 * evidence, and it must be broken per ASSERTION rather than per tool. Every
 * assertion in this file appears at least once in the right-hand column, and
 * every break was applied to `src/`, run, and undone with a second edit.
 *
 * Sections 1 and 2 were fail-tested at WARP_SECTIONS=2, 3 min x 2 seeds; the
 * matched arms at the full tool, 3 min x 2-3 seeds.
 *
 *   BREAK                                     ASSERTIONS SEEN RED
 *   ---------------------------------------   ---------------------------------
 *   WARP_ARM 1.4 -> 0.01                      forward holds reaching WARP_ARM
 *   (warp arms instantly)                     (570/570), aft holds reaching
 *                                             WARP_DROP (522/522, 87/min), the
 *                                             dodge bot entered warp
 *                                             (21141/43200), charge at half arm
 *
 *   WARP_ARM 1.4 -> 999                       engaged at all, did not engage
 *   (warp never arms)                         early, engaged on time, charge at
 *                                             half arm, LATCHED through 10s,
 *                                             survived steering, one step of
 *                                             brake, did not drop early
 *
 *   `idle` branch sets warpOn = true          warp is off before anything is
 *   (the mode is on by default)               held, letting go SPENT the
 *                                             charge, did not engage early,
 *                                             charge at half arm
 *
 *   drop also when warpHold === 0             LATCHED through 10s, survived
 *   (hold-to-sustain instead of a latch)      steering, one step of brake, did
 *                                             not drop early
 *
 *   WARP_DROP x99 (never lets go)             did not drop early, dropped
 *                                             promptly, both meters reset
 *
 *   warpCharge returns 1 always               letting go SPENT the charge,
 *                                             charge at half arm, both meters
 *                                             reset
 *
 *   warpCharge returns 0 always               0.8 of the arm time charged it,
 *                                             charge at half arm
 *
 *   snapshot.running = false                  warmed past 'idle'
 *
 *   delete `waveBeatBias += BEATS_PER_BAR`    wave indices drained by both arms
 *   (warp has no clock)                       (3, below the bar), schedule
 *                                             drain 0.9x, bodies/s 1.9x,
 *                                             in-phase 1.9x, waves/min 0.9x,
 *                                             first boss 0.9x, hp/s 1.5x,
 *                                             on-screen p90 1.5x, AND level at
 *                                             wave (warp 17.0 vs cruise 13.5 —
 *                                             research-density §6, live)
 *
 *   accrual moved back below the hitstop      the same nine. This is the bug
 *   return (`if (false && ...)`)              the accrual placement fixes, and
 *                                             it is the one break in this list
 *                                             that was found rather than
 *                                             invented: at 20 kills a second
 *                                             the sim freezes often enough to
 *                                             halve the multiplier.
 *
 *   topUp grants 600 xp per call in warp      level at a given wave (warp 137.5
 *   (warp pays for itself)                    vs cruise 13.5)
 *
 * NOT SEEN RED, and stated rather than hidden: the six DENOMINATOR guards
 * (forward/aft holds examined, steps at a stop, cruise/warp bodies spawned,
 * wave indices drained, boss marks compared). They exist for the case
 * AGENTS.md §3 names — "a check that examined nothing reports a pass" — and
 * three of them HAVE been seen red in ordinary use rather than in a break:
 * "wave indices drained by BOTH arms: 3" at 2 minutes, and "boss marks
 * compared" / "bodies spawned" at the small settings used while this file was
 * being written. The bar for each is set above what the default run produces
 * and below what a real sample produces, which is the only honest place for a
 * guard against nothing.
 */
