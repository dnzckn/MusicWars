/*
 * stages — is the set list worth climbing, or should a rational player farm?
 *
 * `NODE_OPTIONS=--experimental-transform-types node tools/stages.mjs`
 * `STAGES=1,4,8,12 SEEDS=3 ROSTER=full CAP=60 node tools/stages.mjs`
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT `docs/plan-meta.md` §2.3 NAMES AND DID NOT HAVE.
 *
 * The plan proposes that a stage pays `stage^1.6` and then says, in as many
 * words, that these are starting numbers to be measured and that the test is
 * whether a rational player ever wants to farm a shallow stage. That test is
 * not answerable from the multiplier table, and the reason is the one thing the
 * table has no column for: TIME.
 *
 * A deeper stage contains far more enemies (`waves.ts` `STAGE_GROUPS`), and a
 * wave does not end until the field is clear, so a deep run is LONGER by
 * construction. "Stage 8 pays 6x" is therefore not an answer — 6x the points
 * for 3x the minutes is a worse hour than farming, and any positive exponent
 * makes the per-run number look good. The only currency that decides it is
 * POINTS PER MINUTE, and getting it needs whole runs played to their own end at
 * every depth.
 *
 * So this file plays them. It is the same machinery `tools/finale.mjs` uses —
 * the shared `dodge` brain, the builder card policy, a run driven to `isOver`
 * rather than to a clock — with the stage and the roster as inputs.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT TELL YOU, and a green line here must not be read as more:
 *
 *   - THE BOT DOES NOT DIE at shallow depths. `tools/deadhunt-horizon.mjs`
 *     measured no deaths at any competence, including a ship that never moves,
 *     because score extends plus the last-life auto-bomb refund make survival
 *     an absorbing state. So "risk" at stage 1 is not measurable here and the
 *     risk column is honest only where it is non-zero. What IS measurable at
 *     every depth is TIME, and time is what the economy is denominated in.
 *   - IT IS ONE POLICY. The builder is a bot. `builds.mjs` exists because a
 *     conclusion drawn from one pick policy is a conclusion about that policy.
 *   - NOTHING ABOUT THE MUSIC, the renderer or frame pacing.
 *
 * ---------------------------------------------------------------------------
 * THE FAIL-TEST LOG. Every break was made, observed, and undone by a second
 * edit.
 *
 *   break                                         assertions it turned RED
 *   ------------------------------------------    -------------------------
 *   J  `BASE_INSTRUMENTS` cut to `['ember']`      stage 1 is winnable on the
 *      alone (a one-weapon starting roster)       starting roster (0/2 cleared)
 *   K  `REWARD_EXPONENT` set to 0 (every stage    depth beats farming (best
 *      pays the same)                             stage 1, 1.00x)
 *   L  `STAGE_GROUPS`/`STAGE_SIZE`/`STAGE_FLOOR`  depth costs something (stage
 *      all set to 0 (a set list that is twelve    12 ran 1.02x stage 1's clock
 *      spellings of stage 1)                      at a 100% clear rate)
 * ---------------------------------------------------------------------------
 */
import './lib/tsnode.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const { World } = await import('../src/game/world.ts');
const M = await import('../src/game/meta.ts');
const waves = await import('../src/game/waves.ts');
const W = await import('../src/game/weapons.ts');

const DT = 1 / 120;
const CAP_MIN = Number(process.env.CAP ?? 45);
const SEEDS = Number(process.env.SEEDS ?? 2);
const ROSTER = (process.env.ROSTER ?? 'base').toLowerCase();
/*
 * NOT EVERY STAGE, BY DEFAULT.
 *
 * Twelve stages at two seeds is twenty-four whole runs, and a deep run carries
 * six times the bodies of a shallow one — the wall clock is dominated by the
 * deep end. Eight sampled depths still resolve the SHAPE of the curve, which is
 * what the verdict turns on, and `STAGES=1,2,3,4,5,6,7,8,9,10,11,12` runs the
 * lot when somebody wants the full table.
 */
const STAGES = (process.env.STAGES ?? '1,2,3,4,6,8,10,12')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((s) => Number.isInteger(s) && s >= 1 && s <= M.STAGE_COUNT);

/*
 * THE BUILDER, copied from `tools/finale.mjs`, which copied it from
 * `tools/arena.mjs`.
 *
 * A copy rather than an import, and both of those files say why in their own
 * headers: if the policies drift, the three files are measuring different
 * players and their numbers stop being comparable. This one is the third copy
 * and the argument is unchanged — any edit to one belongs in all three.
 */
function builder(offer, s) {
  const held = Object.entries(s.instruments).filter(([id]) => !W.instrumentDef(id)?.fused);
  held.sort((a, b) => b[1] - a[1]);
  const target = held[0]?.[0] ?? null;
  const recipe = W.FUSIONS.find((fu) => fu.kind === 'evolution' && fu.base === target);
  const catalyst = recipe?.catalyst ?? null;
  const instRoom = Object.keys(s.instruments).length < s.instrumentSlots;
  const rigRoom = Object.keys(s.rig).length < s.rigSlots;
  let best = 0;
  let bestScore = -1;
  offer.options.forEach((o, i) => {
    let score;
    if (o.grace) score = 1;
    else if (o.completes) score = 1000;
    else if (o.id === target) score = 900;
    else if (o.id === catalyst) score = 850;
    else if (o.isNew && o.slot === 'instrument' && instRoom) score = 300;
    else if (o.isNew && o.slot === 'rig' && rigRoom) score = 280;
    else if (o.slot === 'instrument') score = 200 + o.level;
    else score = 150 + o.level;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/** The roster a run is played with. `full` is `null` — the whole table. */
function rosterFor(kind) {
  if (kind === 'full') return null;
  return M.unlockedRoster(M.defaultMeta());
}

function median(xs) {
  if (!xs.length) return 0;
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function runOnce(seed, stage, roster) {
  const w = new World(seed);
  w.stage = stage;
  w.unlocked = roster;
  const brain = makeBrain('dodge');
  let deaths = 0;
  let fusions = 0;
  let cards = 0;
  let kills = 0;
  w.bus.on('player:death', () => deaths++);
  w.bus.on('ability:evolve', () => fusions++);
  w.bus.on('level:choice', () => cards++);
  w.bus.on('enemy:death', (e) => {
    if (e.byPlayer) kills++;
  });
  w.start();
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };
  const steps = Math.round((CAP_MIN * 60) / DT);
  const onScreen = [];
  const inView = (x, y) =>
    x >= w.camera.viewX && x <= w.camera.viewX + w.viewW && y >= w.camera.viewY && y <= w.camera.viewY + w.viewH;
  let endedAt = -1;
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) {
      brain(w, inp);
      inp.choice = w.choosing && w.offer ? builder(w.offer, w.progression) : -1;
    }
    w.update(DT, inp);
    if (i % 60 === 0) onScreen.push(w.enemies.reduce((n, e) => n + (inView(e.x, e.y) ? 1 : 0), 0));
    if (w.isOver) {
      endedAt = i * DT;
      break;
    }
  }
  const finished = endedAt >= 0;
  const seconds = finished ? endedAt : CAP_MIN * 60;
  const result = {
    stage,
    wavesCleared: w.totals.wavesCleared,
    seconds,
    won: w.victory === true,
  };
  return {
    seed,
    ...result,
    finished,
    timedOut: !finished,
    deaths,
    fusions,
    cards,
    kills,
    level: w.progression.level,
    wave: w.waveIndex + 1,
    onScreen: median(onScreen),
    payout: M.computeRunPoints(result),
  };
}

/* ------------------------------------------------------------------------ */

const f1 = (x) => x.toFixed(1);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

const roster = rosterFor(ROSTER);
console.log(`\nstages — whole runs at every depth, ${SEEDS} seeds each, cap ${CAP_MIN} min, headless`);
console.log(
  `Roster: ${ROSTER.toUpperCase()} — ${roster ? roster.size : W.INSTRUMENTS.filter((d) => !d.fused && d.weight > 0).length + W.RIG.filter((d) => d.weight > 0).length} ids draftable.` +
    `  Set list: ${M.STAGE_COUNT} stages, ${waves.TOTAL_WAVES} waves each.`,
);
console.log(`Reward curve: exponent ${M.REWARD_EXPONENT}, stage 12 pays ${M.stageReward(12).toFixed(2)}x stage 1.\n`);

const byStage = new Map();
for (const stage of STAGES) {
  const rows = [];
  for (let s = 0; s < SEEDS; s++) rows.push(runOnce(0x51ed + s * 7919, stage, roster));
  byStage.set(stage, rows);
  const wonRows = rows.filter((r) => r.won);
  console.log(
    `  stage ${String(stage).padStart(2)}  ` +
      `cleared ${wonRows.length}/${rows.length}  ` +
      `${(wonRows.length ? mmss(mean(wonRows.map((r) => r.seconds))) : ' -- ').padStart(6)}  ` +
      `waves ${f1(mean(rows.map((r) => r.wavesCleared))).padStart(4)}  ` +
      `deaths ${rows.reduce((a, r) => a + r.deaths, 0)}  ` +
      `timeouts ${rows.filter((r) => r.timedOut).length}  ` +
      `on screen ${f1(mean(rows.map((r) => r.onScreen))).padStart(5)}  ` +
      `kills ${String(Math.round(mean(rows.map((r) => r.kills)))).padStart(5)}  ` +
      `L${String(Math.round(mean(rows.map((r) => r.level)))).padStart(2)}  ` +
      `fus ${f1(mean(rows.map((r) => r.fusions)))}`,
  );
}

/* ------------------------------------------------------------------------ *
 * THE TABLE THE DECISION IS MADE FROM
 * ------------------------------------------------------------------------ */
console.log('\nPOINTS PER MINUTE — the only column that answers "should I farm?"');
console.log('  stage   mult   run time    points   points/min   vs stage 1   par    fast?');
const ppm = new Map();
for (const stage of STAGES) {
  const rows = byStage.get(stage);
  const minutes = mean(rows.map((r) => r.seconds)) / 60;
  const points = mean(rows.map((r) => r.payout.points));
  const rate = points / minutes;
  ppm.set(stage, rate);
  const par = M.parSeconds(stage);
  console.log(
    `  ${String(stage).padStart(5)}  ${M.stageReward(stage).toFixed(2).padStart(5)}  ` +
      `${mmss(minutes * 60).padStart(8)}  ${String(Math.round(points)).padStart(8)}  ` +
      `${f1(rate).padStart(10)}  ${(rate / ppm.get(STAGES[0])).toFixed(2).padStart(11)}x  ` +
      `${mmss(par).padStart(6)}  ${f1(mean(rows.map((r) => r.payout.speedFraction)) * 100).padStart(5)}%`,
  );
}

/*
 * THE EXPONENT SWEEP.
 *
 * The measured RUN TIMES do not depend on the exponent at all — the exponent is
 * a payout coefficient and nothing in the simulation reads it — so one set of
 * runs answers the question for every candidate. That is the whole reason this
 * is a sweep rather than a re-run: the expensive half is shared.
 *
 * `stageRewardWith` is imported rather than reimplemented; see its note in
 * meta.ts.
 */
console.log('\nTHE EXPONENT, SWEPT AGAINST THE SAME RUNS');
console.log('  (the run times above are fixed; only the payout coefficient moves)');
console.log(`  exp    ${STAGES.map((s) => `s${s}`.padStart(7)).join('')}    best   best/farm`);
const sweep = [];
for (const exp of [0.8, 1.0, 1.2, 1.35, 1.6, 2.0]) {
  const rates = STAGES.map((stage) => {
    const rows = byStage.get(stage);
    const minutes = mean(rows.map((r) => r.seconds)) / 60;
    // Re-price the same runs at this exponent: the payout is linear in the
    // multiplier, so scaling the measured points by the ratio of multipliers is
    // exact rather than an approximation.
    const points = mean(
      rows.map((r) => (r.payout.points / r.payout.multiplier) * M.stageRewardWith(stage, exp)),
    );
    return points / minutes;
  });
  const bestIdx = rates.indexOf(Math.max(...rates));
  sweep.push({ exp, rates, best: STAGES[bestIdx], ratio: rates[bestIdx] / rates[0] });
  console.log(
    `  ${exp.toFixed(2).padStart(4)}   ${rates.map((r) => f1(r).padStart(7)).join('')}   ` +
      `${String(STAGES[bestIdx]).padStart(5)}   ${(rates[bestIdx] / rates[0]).toFixed(2).padStart(8)}x` +
      `${exp === M.REWARD_EXPONENT ? '   <- shipped' : ''}`,
  );
}

/* ------------------------------------------------------------------------ *
 * The gates
 * ------------------------------------------------------------------------ */
let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}  — ${detail}`);
};
console.log('\nVERDICT');

/*
 * 1. STAGE 1 IS WINNABLE ON THE STARTING ROSTER.
 *
 * `docs/plan-meta.md` §6 names this as the thing that would falsify the whole
 * design: "if stage 1 with 8 weapons cannot be cleared, the gate is not a
 * pacing device, it is a wall". A finite run ends on a final boss with 2488hp
 * and a build assembled from a pool of sixteen; nothing else in this repository
 * has ever played that configuration.
 */
{
  const rows = byStage.get(STAGES[0]) ?? [];
  const won = rows.filter((r) => r.won).length;
  check(
    STAGES[0] === 1 && rows.length > 0 && won === rows.length,
    'stage 1 is winnable on the starting roster — the gate is a pacing device, not a wall',
    `${won}/${rows.length} cleared, ${mmss(mean(rows.filter((r) => r.won).map((r) => r.seconds)) || 0)} mean`,
  );
}

/*
 * 2. DEPTH COSTS SOMETHING.
 *
 * A set list where stage 12 plays like stage 1 is twelve buttons that do
 * nothing, and it would pass every economy assertion below — the payout would
 * simply rise for free, which is the most attractive possible bug. So the
 * DIFFICULTY has to be measured, and it is measured in the two currencies the
 * bot can actually spend: TIME and CLEARS. Not in deaths, because
 * `deadhunt-horizon` says this bot does not die and a gate on deaths would be a
 * gate that can never go red.
 */
{
  const first = byStage.get(STAGES[0]);
  const last = byStage.get(STAGES[STAGES.length - 1]);
  const t0 = mean(first.map((r) => r.seconds));
  const t1 = mean(last.map((r) => r.seconds));
  const clear0 = first.filter((r) => r.won).length / first.length;
  const clear1 = last.filter((r) => r.won).length / last.length;
  const crowd0 = mean(first.map((r) => r.onScreen));
  const crowd1 = mean(last.map((r) => r.onScreen));
  check(
    t1 / t0 >= 1.5 || clear1 < clear0,
    `depth costs something — stage ${STAGES[STAGES.length - 1]} is not stage ${STAGES[0]} with a bigger number`,
    `${(t1 / t0).toFixed(2)}x the clock (${mmss(t0)} -> ${mmss(t1)}), clear rate ${(clear0 * 100).toFixed(0)}% -> ${(clear1 * 100).toFixed(0)}%, ` +
      `crowd ${f1(crowd0)} -> ${f1(crowd1)} on screen`,
  );
}

/*
 * 3. FARMING THE SAFEST STAGE IS NOT OPTIMAL.
 *
 * The measurement §2.3 asks for, stated as an exit code. If the best points per
 * minute is at the shallowest stage on offer, the reward curve has failed at
 * its only job and the meta layer collapses into repetition.
 *
 * The margin is 15% rather than 0 because a dead heat is not a reason to go
 * deep either: the deep run is riskier, longer per attempt and less forgiving
 * of a mistake, so it has to pay a visible premium to be the rational choice
 * rather than merely a tied one.
 */
{
  const best = STAGES.reduce((a, b) => (ppm.get(b) > ppm.get(a) ? b : a), STAGES[0]);
  const ratio = ppm.get(best) / ppm.get(STAGES[0]);
  check(
    best > STAGES[0] && ratio >= 1.15,
    'depth beats farming — the deepest sensible stage pays more per minute than the safest',
    `best is stage ${best} at ${f1(ppm.get(best))} pts/min against stage ${STAGES[0]}'s ${f1(ppm.get(STAGES[0]))} — ${ratio.toFixed(2)}x`,
  );
}

/*
 * 4. PAR IS HONEST.
 *
 * The speed bonus is worthless if par is unreachable and automatic if par is
 * generous, and both look identical in the source. Asserted against the
 * measured clear times rather than against a remembered number: the mean speed
 * fraction across every winning run must sit away from both ends.
 */
{
  const winners = STAGES.flatMap((s) => byStage.get(s)).filter((r) => r.won);
  const frac = mean(winners.map((r) => r.payout.speedFraction));
  check(
    winners.length > 0 && frac > 0.05 && frac < 0.95,
    'par is a target, not a formality — the speed bonus is neither unreachable nor automatic',
    `${(frac * 100).toFixed(0)}% of the speed bonus earned on average across ${winners.length} winning runs`,
  );
  /*
   * AND THE SLOPE IS RIGHT. Par grows with depth because deep runs are longer;
   * if the growth constant disagrees with the measured growth, every deep clear
   * reads as slow (or every one reads as fast) and the term stops discriminating
   * at exactly the depths it matters most.
   */
  const winStages = STAGES.filter((s) => byStage.get(s).some((r) => r.won));
  if (winStages.length >= 2) {
    const lo = winStages[0];
    const hi = winStages[winStages.length - 1];
    const tLo = mean(byStage.get(lo).filter((r) => r.won).map((r) => r.seconds));
    const tHi = mean(byStage.get(hi).filter((r) => r.won).map((r) => r.seconds));
    const measured = (tHi / tLo - 1) / Math.max(1, hi - lo);
    const modelled = M.PAR_GROWTH;
    const ok = measured > 0 && modelled / measured > 0.5 && modelled / measured < 2;
    check(
      ok,
      'and par grows at roughly the rate clear times actually grow',
      `measured ${(measured * 100).toFixed(1)}% per stage (${mmss(tLo)} at ${lo} -> ${mmss(tHi)} at ${hi}), ` +
        `PAR_GROWTH is ${(modelled * 100).toFixed(1)}%`,
    );
  } else {
    check(false, 'and par grows at roughly the rate clear times actually grow', 'fewer than two stages produced a win — nothing to fit');
  }
}

console.log('');
if (bad) {
  console.log(`STAGES BROKEN — ${bad} failure(s)\n`);
  process.exit(1);
}
console.log('THE SET LIST IS WORTH CLIMBING\n');
