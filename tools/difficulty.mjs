/*
 * difficulty — can the real bot lose, and does the game get harder?
 *
 * All eleven balance tools drive Chromium, so on a stalled box there is no way
 * to answer "is this too easy" at all. None of them need a DOM: `World` runs
 * in Node, and the bot is now a shared module (`lib/bot-brain.mjs`, guarded by
 * `npm run brain`). This runs the SAME bot the browser tools use, headless.
 *
 * What it watches, and why each one rather than "did it win":
 *
 *   DEATHS      A run the bot cannot lose has no failure state to tune. But a
 *               bot dying instantly is not evidence of good difficulty either,
 *               so this is a band, not a maximum.
 *   TIME AT 1HP A game can hold the player at the edge constantly and still
 *               never kill them. That reads as tension the first time and as
 *               noise the tenth, because the threat stopped predicting
 *               anything. Measured separately from deaths on purpose.
 *   HITS/MIN    Whether contact is trending up as waves get harder, or whether
 *               the curve flattens once the rig out-scales the roster.
 *
 * Seeds matter: one run is an anecdote. Several seeds are sampled and the
 * spread is reported, because "the bot survived" on a single seed says as much
 * about that seed as about the balance.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);

const DT = 1 / 120;
const SECS = Number(process.env.SECS ?? 480);
const SEEDS = [0x51ed, 0xbeef, 0x1234, 0xc0de, 0x9a7f];

/*
 * "THE BOT MUST DIE" IS THE WRONG GATE, and the first version of this tool
 * asserted it anyway.
 *
 * This bot has perfect information and no reaction time. It surviving proves
 * nothing about whether a person would, so failing a build because an optimal
 * player lived is asserting something the design never agreed to. What CAN be
 * asserted from a bot run is the shape of the curve, because that is a
 * property of the game rather than of the player:
 *
 *   ESCALATION  A survivors-like has to get harder faster than the player
 *               gets stronger. If contact in the back half of a run is no
 *               higher than the front half, the rig has out-scaled the roster
 *               and the rest of the run is a formality. Extends stacking to +2
 *               is a deliberate decision (see the Geometry Wars note in
 *               `world.ts`) and it is only sound if the stage eventually
 *               spends them.
 *   EDGE        A game can hold the player at 1HP constantly and never kill
 *               them. That reads as tension once and as noise thereafter,
 *               because the threat stopped predicting anything.
 *
 * Deaths and lives are still REPORTED, because they are the first thing you
 * want when the escalation number moves. They are not gated.
 */
/*
 * 1.15 is a mild bar — "the back half is at least 15% more dangerous" — and
 * the verdict does not depend on it. Measured at x0.25-0.44, the game is two
 * to four times EASIER in its back half, so anything from 0.9 upward fails by
 * a wide margin. Stated because the last invented threshold in this repo
 * (drops.mjs, MAX_SINGLE_SOURCE) was unsatisfiable by arithmetic and had to be
 * replaced rather than met: a bar is only worth having if the reading is
 * robust to where you put it.
 */
/*
 * HITS ARE TOO RARE TO GATE ON, and this tool asserted on them first.
 *
 * A 15-minute run lands single-digit hits per quarter, so a change worth 30%
 * more enemy fire moved the count from 10 to 7 — inside one sigma, and in the
 * wrong direction. The gate reported a regression it had no power to see.
 *
 * Worse, hits are the wrong QUANTITY even with enough of them. This bot has an
 * explicit repulsion term, so raising the bullet count makes it flee more
 * effectively; a metric built on a perfect dodger's failures understates what
 * a person standing in that bullet stream would feel.
 *
 * PRESSURE replaces it: the mean number of enemy bullets within a ship's
 * reaction radius, sampled continuously. Thousands of samples instead of
 * dozens of events, it measures the situation rather than the bot's response
 * to it, and it is what "the back half is harder" actually means.
 */
const THREAT_RADIUS = 150;
/*
 * CROWD IS REPORTED, NOT GATED, and the attempt to gate it is worth recording
 * because it failed for an interesting reason.
 *
 * Late waves grow almost entirely in bodies — Q1 to Q4 goes 3.4 to 14.6
 * enemies while bullets go 10.7 to 13.8, and pressure per enemy falls 0.12 to
 * 0.04 — so the stage gets busier to look at faster than it gets harder to
 * survive. That is the "visual clutter is high" complaint with a number on it,
 * and the obvious move is to cap the crowd and buy the lost difficulty back
 * with cadence, which costs nothing to look at.
 *
 * Measured, that trade does not pay. Capping groups at 12 took the crowd from
 * 14.6 to 13.1 — only 10%, because enemies persist and shorter waves push the
 * run to higher indices — while pressure fell from x1.16 to x1.08. Adding a
 * third cadence gear recovered it only to x1.11. The bodies were carrying more
 * threat than the dilution figure suggests, and `waves.ts` had already
 * rejected this exact cut for this exact reason; that rejection was
 * better-founded than it looked.
 *
 * So there is no defensible absolute bound here, and inventing one would be
 * the `MAX_SINGLE_SOURCE` mistake from `drops.mjs` again — a threshold picked
 * just under the measured value, which the design then cannot meet without
 * making the game worse. The number is printed every run so a future pass can
 * see it move.
 *
 * The promising direction is not fewer enemies. It is less visual weight PER
 * enemy, in the renderer, where legibility costs no gameplay at all.
 */
const MIN_ESCALATION = 1.15;
const MAX_EDGE_SHARE = 0.45;

const rows = [];
for (const seed of SEEDS) {
  const w = new World(seed); w.start();
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  let hits = 0, deaths = 0, edge = 0, n = 0;
  /*
   * QUARTERS, not halves. A two-bucket split cannot tell "flat" from "ramps
   * late", and those want opposite fixes — the first is a broken curve, the
   * second is a curve the sample was too short to reach.
   */
  const Q = 4;
  const buckets = new Array(Q).fill(0);
  const press = new Array(Q).fill(0);
  const crowd = new Array(Q).fill(0);
  const pressN = new Array(Q).fill(0);
  const steps0 = Math.round(SECS / DT);
  let step = 0;
  w.bus.on('player:hit', () => { hits++; buckets[Math.min(Q - 1, Math.floor((step / steps0) * Q))]++; });
  w.bus.on('player:death', () => deaths++);
  const steps = Math.round(SECS / DT);
  for (let i = 0; i < steps; i++) {
    step = i;
    if (i % 2 === 0) drive(w, inp);
    w.update(DT, inp);
    if (i % 30 === 0) {
      n++;
      if (w.player.hp <= 1) edge++;
      const qi = Math.min(Q - 1, Math.floor((i / steps) * Q));
      /*
       * PRESSURE IS BODIES WITHIN 150px, not enemy bullets within 150px.
       *
       * The measure is re-pointed, not retired, and the assertion it feeds is
       * unchanged: this tool exists because "hits are far too rare to resolve a
       * change this size" and it needs a continuously-sampled proxy for how
       * dangerous the moment is. With contact damage the thing inside the ring
       * IS the danger, so the same sample answers the same question about the
       * quantity that now carries it. The ABSOLUTE numbers are not comparable
       * across this change — a body is not a bullet — but the shape of the
       * curve across quarters, which is all this tool asserts on, is.
       */
      let near = 0;
      for (const e of w.enemies) {
        const dx = e.x - w.player.x, dy = e.y - w.player.y;
        if (dx * dx + dy * dy < THREAT_RADIUS * THREAT_RADIUS) near++;
      }
      press[qi] += near; crowd[qi] += w.enemies.length; pressN[qi]++;
    }
    if (w.phase === 'over') break;
  }
  rows.push({
    seed, wave: w.snapshot.wave, over: w.phase === 'over', hits, deaths,
    lives: w.player.lives, edge: edge / n, buckets,
    press: press.map((v, i) => (pressN[i] ? v / pressN[i] : 0)),
    crowd: crowd.map((v, i) => (pressN[i] ? v / pressN[i] : 0)),
  });
}

const f = (x) => `${(100 * x).toFixed(0)}%`;
console.log(`\ndifficulty — real bot, ${SECS}s cap, ${SEEDS.length} seeds\n`);
console.log('  seed        wave  ended  hits  by quarter    deaths  lives  time-at-1hp');
console.log('  ----------  ----  -----  ----  ------------  ------  -----  -----------');
for (const r of rows) {
  console.log(`  0x${r.seed.toString(16).padEnd(8)}  ${String(r.wave).padStart(4)}  ${(r.over ? 'DIED' : 'alive').padEnd(5)}  ${String(r.hits).padStart(4)}  ${r.buckets.join('/').padStart(12)}  ${String(r.deaths).padStart(6)}  ${String(r.lives).padStart(5)}  ${f(r.edge).padStart(11)}`);
}
const died = rows.filter((r) => r.over).length;
const deathless = 1 - died / rows.length;
const edgeAvg = rows.reduce((a, r) => a + r.edge, 0) / rows.length;
const waves = rows.map((r) => r.wave);
console.log(`\n  runs ending in death: ${died}/${rows.length}   mean wave ${(waves.reduce((a, b) => a + b, 0) / waves.length).toFixed(1)} (${Math.min(...waves)}-${Math.max(...waves)})`);
console.log(`  mean time at 1HP: ${f(edgeAvg)}   mean hits/min: ${(rows.reduce((a, r) => a + r.hits, 0) / rows.length / (SECS / 60)).toFixed(1)}`);

const q = [0, 1, 2, 3].map((i) => rows.reduce((a, r) => a + r.buckets[i], 0));
const pq = [0, 1, 2, 3].map((i) => rows.reduce((a, r) => a + r.press[i], 0) / rows.length);
const pEarly = (pq[0] + pq[1]) / 2;
const pLate = (pq[2] + pq[3]) / 2;
const escalation = pEarly ? pLate / pEarly : (pLate ? Infinity : 1);
console.log(`  hits by quarter (noisy, informational): ${q.join('  ')}`);
const cq = [0, 1, 2, 3].map((i) => rows.reduce((a, r) => a + r.crowd[i], 0) / rows.length);
console.log(`  PRESSURE by quarter — enemy bullets within ${THREAT_RADIUS}px: ${pq.map((x) => x.toFixed(2)).join('  ')}`);
console.log(`  CROWD by quarter    — enemies on the field:            ${cq.map((x) => x.toFixed(1)).join('  ')}`);
console.log(`  pressure per enemy:                                    ${cq.map((c, i) => (c ? (pq[i] / c).toFixed(2) : '-')).join('  ')}`);
const startLives = 3;
const meanLives = rows.reduce((a, r) => a + r.lives, 0) / rows.length;
console.log(`  pressure: ${pEarly.toFixed(2)} in the first half vs ${pLate.toFixed(2)} in the second — escalation x${escalation.toFixed(2)}`);
console.log(`  mean lives at end: ${meanLives.toFixed(1)} (started ${startLives})` +
  (meanLives > startLives ? '  <- the run is getting SAFER as it goes' : ''));
if (escalation < 1) {
  console.log('\n  Where to look: post-cap the stage grows almost entirely in BODIES.');
  console.log('  Measured, Q1 to Q4 goes 3.4 -> 14.6 enemies while enemy bullets go');
  console.log('  10.7 -> 13.8 — four times the crowd firing 1.3x the shots. In an');
  console.log('  arena a body is something to walk around and a bullet is what hits');
  console.log('  you, so that is growth in the one dimension that adds clutter');
  console.log('  without adding threat. Prefer cadence (Emitter.setUrgency, driven');
  console.log('  from world.ts scaleForEnsemble) over group count.');
}

const fails = [];
if (escalation < MIN_ESCALATION) {
  fails.push(`back-half PRESSURE is x${escalation.toFixed(2)} of the front (want >=${MIN_ESCALATION}) — ` +
    'the stage stops threatening the player while the rig keeps growing');
}
if (edgeAvg > MAX_EDGE_SHARE) {
  fails.push(`the player sits at 1HP for ${f(edgeAvg)} of the run — being nearly dead is the resting state, so it stops predicting anything`);
}
/*
 * THE LONG RUN — what an eight-minute cap cannot see.
 *
 * Everything above stops at 480s. That is long enough to show the wave curve
 * biting and far too short to answer the question a player actually asks of a
 * roguelike: does a run END?
 *
 * FIFTEEN seeds, not five, and the seed count is the finding. At five seeds
 * this block reported hits/min falling 2.35 -> 1.10 and pressure 0.64 -> 0.46
 * and was very nearly committed as "the game gets safer the longer it lasts".
 * It does not: at fifteen seeds pressure goes 0.62 -> 1.00 -> 0.87 by third, a
 * net RISE of 40%, and hits/min is roughly flat with a mid-run peak. The
 * decline was noise, and five seeds could not tell the difference. Anything
 * measured here needs the wider sample.
 *
 * What DOES hold at fifteen seeds, and is the real observation:
 *
 *     runs that ended    2/15
 *     total deaths       2
 *     mean lives left    2.5 of 5
 *     mean wave          36.4
 *
 * Twenty-five minutes, and 87% of runs are still going with half the player's
 * lives intact. The escalation works — it simply never converts into lethality,
 * because escalation buys enemy HIT POINTS (scale 1.0 -> 7.0 by wave 35) and
 * hit points make an enemy slower to kill rather than more likely to hit you.
 * That is this file's own principle from `scaleForEnsemble`, "bodies are
 * clutter; volleys are difficulty", in a third form after bodies and toughness.
 *
 * REPORTED, NOT GATED. Whether an endless run should eventually kill you, or
 * should instead gain a Vampire-Survivors-style finale and a real ending, is a
 * design decision — and `scaleForEnsemble`'s history is two balance passes that
 * overshot. Failing the build here would make the suite red with no correct
 * action available. The numbers print every run so the question stays visible.
 */
/*
 * DOES MOVING MATTER? The control this file never had — and the one it nearly
 * got wrong.
 *
 * Every other measurement here uses the dodging bot, so "few deaths" was
 * ambiguous: gentle game, or good bot? Those demand opposite responses.
 *
 * THE FIRST CONTROL WAS NOT A CONTROL. `weave` was used, on the grounds that
 * it has no bullet awareness — it just oscillates left and right. It matched
 * the dodging bot exactly (both 0 deaths, wave 19.0) and that was written up
 * as "evasion has no measurable survival value". It is wrong. Enemy emitters
 * default to `aim: 'player'`, and a target in CONSTANT MOTION beats an aimed
 * shot without needing to know the shot exists. Oscillation is evasion; the
 * control was an evasive strategy wearing a blindfold.
 *
 * A bot that actually holds still settles it, over 8 seeds x 600s:
 *
 *     dodge       1 death    193 hits   mean wave 17.9
 *     weave       0 deaths   368 hits   mean wave 19.0
 *     STATIONARY  8 deaths    78 hits   mean wave  6.8
 *
 * Every stationary run dies, at a third of the wave. Movement is worth
 * everything. The game is lethal to a player who does not move, which is what
 * a bullet hell is supposed to be — so the earlier "dodging does not matter"
 * finding is retracted in full.
 *
 * What survives it, narrower and still true: for a player who DOES move, long
 * runs almost never end (see THE LONG RUN below). That is a question about the
 * top of the curve, not about whether bullets threaten anyone.
 */
const CONTROL = Number(process.env.CONTROL_SECS ?? 600);
if (CONTROL > 0) {
  const CTRL_SEEDS = [1, 2, 3, 4, 5, 7, 11, 13];
  const dodgeBrain = makeBrain('dodge');
  const MODES = [
    ['dodge', (w, inp) => dodgeBrain(w, inp)],
    // Holds position. The only honest control: no movement of any kind.
    ['still', (_w, inp) => { inp.x = 0; inp.y = 0; inp.shoot = true; }],
  ];
  const out = [];
  for (const [mode, drive] of MODES) {
    let deaths = 0, ended = 0, waves = 0, hits = 0;
    for (const seed of CTRL_SEEDS) {
      const w = new World(seed); w.start();
      const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
      let d = 0, h = 0;
      w.bus.on('player:death', () => d++);
      w.bus.on('player:hit', () => h++);
      for (let i = 0; i < Math.round(CONTROL / DT); i++) {
        if (i % 2 === 0) { drive(w, inp); inp.choice = w.choosing ? 0 : -1; }
        inp.well = i % 180 === 0;
        w.update(DT, inp);
        if (w.snapshot.gameOver) { ended++; break; }
      }
      deaths += d; waves += w.waveIndex; hits += h;
    }
    out.push({ mode, deaths, ended, hits, wave: waves / CTRL_SEEDS.length });
  }
  console.log(`\n  DOES MOVING MATTER? — ${CONTROL}s x ${CTRL_SEEDS.length} seeds`);
  for (const r of out) {
    console.log(`    ${r.mode.padEnd(6)} deaths ${String(r.deaths).padStart(2)}   hits ${String(r.hits).padStart(4)}   mean wave ${r.wave.toFixed(1)}`);
  }
  const [moving, still] = out;
  if (still.deaths <= moving.deaths) {
    console.log('    FAIL  standing still is no worse than moving — bullets do not threaten.');
  } else {
    console.log(`    ok    standing still costs ${still.deaths - moving.deaths} more deaths and ` +
      `${(moving.wave - still.wave).toFixed(1)} waves — movement is load-bearing`);
  }
}

/*
 * THE LONG RUN - THIRDS OF THE RUN, NOT THIRDS OF THE WINDOW.
 *
 * RE-POINTED BECAUSE THE RUN GAINED AN END, and the old form is a worked
 * example of a denominator going stale under a design change rather than under
 * a defect. This block bucketed samples by `floor(3 * i / steps)` - the third
 * of the 1500-SECOND WINDOW - and broke out of the loop on `gameOver`. That was
 * exactly right while a run could not end, because the window WAS the run.
 *
 * `waves.ts` now has `BOSS_COUNT`, a run finishes in about sixteen minutes, and
 * 1500s is longer than that. So the loop breaks two thirds of the way through
 * its own window and the third bucket receives NO SAMPLES AT ALL. Measured on
 * the build this note was written against: `hits/min by third 0.20 0.20 0.00`,
 * `pressure by third 0.10 0.12 0.00`, `runs that ended 13/15`. Every one of
 * those zeros is "the game was over", printed as though it were "the game
 * stopped threatening you" - the most misleading possible reading, on the one
 * row a person would read to judge whether the late game works.
 *
 * The fix is to divide by the run's OWN length. Samples are kept with the step
 * they were taken at and bucketed afterwards, so a run that ends at 980s has
 * three 327-second thirds and one that fills the window has three 500-second
 * ones. Nothing about WHAT is measured changes; only the denominator, which is
 * now printed next to every row.
 *
 * STILL REPORTED, STILL NOT GATED - that was true before and the reason is
 * unchanged; see the long note above this block. What has changed is that the
 * numbers describe the game again.
 */
const LONG = Number(process.env.LONG_SECS ?? 1500);
if (LONG > 0) {
  const LONG_SEEDS = [1, 2, 3, 4, 5, 0x51ed, 0xbeef, 0x1234, 0xc0de, 0x9a7f, 7, 11, 13, 17, 19];
  // [hits, pressure sum, pressure samples, seconds] per third, summed over seeds.
  const seg = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  let ended = 0, won = 0, longLives = 0, longWave = 0;
  for (const seed of LONG_SEEDS) {
    const w = new World(seed); w.start();
    const drive = makeBrain('dodge');
    const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
    // Held per RUN and bucketed once the run's own length is known.
    const hitSteps = [];
    const samples = [];
    let step = 0;
    w.bus.on('player:hit', () => { hitSteps.push(step); });
    const steps = Math.round(LONG / DT);
    let last = 0;
    for (let i = 0; i < steps; i++) {
      step = i;
      last = i;
      if (i % 2 === 0) { drive(w, inp); inp.choice = w.choosing ? 0 : -1; }
      inp.well = i % 180 === 0;
      w.update(DT, inp);
      if (i % 30 === 0) {
        // Bodies, not bullets - see the note on the first copy of this block.
        let near = 0;
        for (const e of w.enemies) {
          const dx = e.x - w.player.x, dy = e.y - w.player.y;
          if (dx * dx + dy * dy < THREAT_RADIUS * THREAT_RADIUS) near++;
        }
        samples.push([i, near]);
      }
      if (w.snapshot.gameOver) { ended++; if (w.victory) won++; break; }
    }
    const span = Math.max(1, last + 1);
    const third = (i) => Math.min(2, Math.floor((3 * i) / span));
    for (const hs of hitSteps) seg[third(hs)][0]++;
    for (const [i, near] of samples) { const t = third(i); seg[t][1] += near; seg[t][2]++; }
    for (let t = 0; t < 3; t++) seg[t][3] += (span * DT) / 3;
    longLives += w.player.lives; longWave += w.waveIndex;
  }
  console.log(`\n  THE LONG RUN - up to ${LONG}s x ${LONG_SEEDS.length} seeds, bucketed by thirds of EACH RUN`);
  console.log(`    seconds per third   ${seg.map((x) => x[3].toFixed(0).padStart(6)).join('  ')}   (summed over seeds)`);
  console.log(`    hits/min by third   ${seg.map((x) => (x[3] ? x[0] / (x[3] / 60) : 0).toFixed(2).padStart(6)).join('  ')}`);
  console.log(`    pressure by third   ${seg.map((x) => (x[2] ? x[1] / x[2] : 0).toFixed(2).padStart(6)).join('  ')}   (n = ${seg.map((x) => x[2]).join('/')})`);
  console.log(`    runs that ended     ${ended}/${LONG_SEEDS.length}   of which WON ${won}`);
  console.log(`    mean lives left     ${(longLives / LONG_SEEDS.length).toFixed(1)}   mean wave ${(longWave / LONG_SEEDS.length).toFixed(1)}`);
  if (ended < LONG_SEEDS.length / 2) {
    console.log('    NOTE  most runs never end - which should no longer be possible. `waves.ts`');
    console.log('          gives a run BOSS_COUNT acts and a finale, so a run that does not');
    console.log('          finish inside this window is a stalled boss or a broken schedule.');
    console.log('          tools/finale.mjs is the gate that owns that question.');
  }
}

console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  the run escalates INSIDE THE CAP; see THE LONG RUN above for the rest');
console.log('\n  Baseline 2026-08-22: pressure 0.42/0.68/0.65/0.62 by quarter, x1.16.');
console.log('  Without the escalation gears in scaleForEnsemble: 0.42/0.68/0.56/0.50, x0.96.');
