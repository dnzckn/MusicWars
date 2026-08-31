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
 * THE FAIL-TEST LOG. Every break was made, RUN at `STAGES=1,12 SEEDS=1`,
 * observed, and undone by the reverse edit. Every figure was printed.
 *
 *   break                                        assertions it turned RED
 *   ------------------------------------------   ---------------------------
 *   J  the starting roster cut to EMBER alone,   stage 1 is winnable (0/1
 *      no passives at all                        cleared); depth is bigger
 *                                                (0.97x the clock, both runs
 *                                                timed out); par is a target
 *                                                (0 winning runs); par grows
 *   K  `REWARD_EXPONENT` set to 0                depth beats farming (best is
 *                                                stage 1 at 1.00x)
 *   L  `stagePressure` pinned at 0 — every       depth is bigger (1.00x the
 *      stage term dead at once                   clock, 1.00x the kill rate);
 *                                                it is BUSIER (peak crowd
 *                                                69.0 -> 69.0, 1.00x); depth
 *                                                beats farming; par grows
 *                                                (0.0% per stage)
 *   R  par set to 60s — unreachably fast         par is a target (0% of the
 *                                                speed bonus earned, 2 runs)
 *   R2 par set to 6000s — absurdly slow          par is a target (100% earned)
 *   R3 `PAR_GROWTH` set to 1.0                   par grows at roughly the rate
 *                                                clear times grow (measured
 *                                                9.4%, constant says 100%)
 *
 * ONE BREAK THAT STAYED GREEN, AND IT IS A FINDING RATHER THAN A GAP:
 *
 *   L2 `STAGE_FLOOR` alone set to 0 — GREEN. The population floor is NOT what
 *   makes a deep stage busier; the group count and group size are. The floor
 *   pulls scheduled groups forward and cannot manufacture bodies a wave does
 *   not contain, exactly as `World.targetOnScreen`'s own comment says and as
 *   its 24-to-36 sweep already measured. Worth knowing before anybody reaches
 *   for it as a difficulty dial.
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
  /*
   * HITS TAKEN IS THE ONLY RISK CURRENCY THIS BOT CAN SPEND.
   *
   * `tools/deadhunt-horizon.mjs` measured no deaths at any competence,
   * including a ship that never moves, so a difficulty gate denominated in
   * DEATHS is a gate that can never go red — decoration, in AGENTS.md §3's
   * word. Damage taken is the same quantity one level up and it does move:
   * `tools/builds.mjs` gates on it for exactly this reason and records a 6.5x
   * spread across pick policies on an unchanged build.
   *
   * It is also the column that separates "harder" from "longer", which is the
   * distinction this whole feature turns on. A stage that only takes more
   * minutes is a worse stage, not a deeper one — and it would still pay more,
   * which makes it the most attractive possible bug.
   */
  let hits = 0;
  w.bus.on('player:hit', () => hits++);
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
    hits,
    fusions,
    cards,
    kills,
    level: w.progression.level,
    wave: w.waveIndex + 1,
    /*
     * THE MEAN, AND THE MEDIAN IS REPORTED BESIDE IT BECAUSE THEY DISAGREE
     * WILDLY AND THE DISAGREEMENT IS THE FINDING.
     *
     * `tools/arena.mjs` reads an on-screen p50 of 21.3 and treats it as the
     * density number; the first version of this file copied that and read
     * 1.0 at every stage, which looks like the stage lever doing nothing.
     * It is not. Arena drives the CARD-0 bot over twenty minutes; this drives
     * the BUILDER, which kills 693 bodies a minute at stage 1 and 1655 at
     * stage 12. A player deleting things that fast has an empty screen
     * whatever arrives, so the standing population is a measurement of the
     * bot's damage rather than of the stage's supply.
     *
     * `kills` is the supply number here and it rises 5x across the set list.
     * The population columns are kept because a build where they DID rise
     * would mean something, and because reporting only the flattering one is
     * how a tool starts agreeing with whoever built it.
     */
    onScreen: mean(onScreen),
    onScreenMedian: median(onScreen),
    onScreenPeak: Math.max(0, ...onScreen),
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
  const minutes = mean(rows.map((r) => r.seconds)) / 60;
  console.log(
    `  stage ${String(stage).padStart(2)}  ` +
      `cleared ${wonRows.length}/${rows.length}  ` +
      `${(wonRows.length ? mmss(mean(wonRows.map((r) => r.seconds))) : ' -- ').padStart(6)}  ` +
      `waves ${f1(mean(rows.map((r) => r.wavesCleared))).padStart(4)}  ` +
      `hits ${String(Math.round(mean(rows.map((r) => r.hits)))).padStart(4)} (${f1(mean(rows.map((r) => r.hits)) / minutes).padStart(5)}/min)  ` +
      `deaths ${rows.reduce((a, r) => a + r.deaths, 0)}  ` +
      `t/o ${rows.filter((r) => r.timedOut).length}  ` +
      `crowd ${f1(mean(rows.map((r) => r.onScreen))).padStart(4)} mean / ${f1(mean(rows.map((r) => r.onScreenPeak))).padStart(5)} peak  ` +
      `kills ${String(Math.round(mean(rows.map((r) => r.kills)))).padStart(5)} (${String(Math.round(mean(rows.map((r) => r.kills)) / minutes)).padStart(4)}/min)  ` +
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
console.log(`  curve  ${STAGES.map((s) => `s${s}`.padStart(7)).join('')}    best   best/farm`);
/**
 * Re-price the measured runs under an arbitrary multiplier function.
 *
 * The payout is LINEAR in the multiplier, so dividing out the one that was
 * applied and multiplying in another is exact rather than an approximation.
 * That is what makes one set of runs answer the question for every candidate.
 */
const rateUnder = (multOf) =>
  STAGES.map((stage) => {
    const rows = byStage.get(stage);
    const minutes = mean(rows.map((r) => r.seconds)) / 60;
    const points = mean(rows.map((r) => (r.payout.points / r.payout.multiplier) * multOf(stage)));
    return points / minutes;
  });
const showCurve = (label, rates, tag = '') => {
  const bestIdx = rates.indexOf(Math.max(...rates));
  console.log(
    `  ${label.padEnd(5)}  ${rates.map((r) => f1(r).padStart(7)).join('')}   ` +
      `${String(STAGES[bestIdx]).padStart(5)}   ${(rates[bestIdx] / rates[0]).toFixed(2).padStart(8)}x${tag}`,
  );
  return { best: STAGES[bestIdx], ratio: rates[bestIdx] / rates[0] };
};
for (const exp of [0.8, 1.0, 1.2, 1.35, 1.6, 2.0]) {
  showCurve(
    exp.toFixed(2),
    rateUnder((stage) => M.stageRewardWith(stage, exp)),
    exp === M.REWARD_EXPONENT ? '   <- shipped' : '',
  );
}
/*
 * THE PLAN'S LITERAL PROPOSAL, PRICED THE SAME WAY.
 *
 * `docs/plan-meta.md` §2.2 proposes `stage^1.6` with no shift and prints a
 * table of multipliers — 1.0, 3.0, 5.8, 13.1, 27.9, 52.7 — that has no time
 * column in it. This row is that table divided by the clock, and it is the
 * reason the shipped curve is not it.
 *
 * A BARE `Math.pow` IS NOT A COPY OF A SHIPPED CONSTANT. AGENTS.md §3's rule
 * is that a tool must not hold its own copy of a value the program owns, and
 * this is the opposite: it is a quotation from a design document, reproduced
 * here so the rejection is visible rather than asserted. Nothing in `src/`
 * computes it, and if the shipped curve ever became `s^1.6` this row would
 * simply agree with the one above it.
 */
showCurve('plan', rateUnder((stage) => Math.pow(stage, 1.6)), '   <- docs/plan-meta.md §2.2, s^1.6 with no shift');

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
 * 2. DEPTH IS HARDER, NOT MERELY LONGER. Two separate assertions, and the
 * second is the one that matters.
 *
 * A set list where stage 12 plays like stage 1 is twelve buttons that do
 * nothing, and it would pass every economy assertion below — the payout would
 * rise for free, which is the most attractive possible bug.
 *
 * BUT "IT TAKES LONGER" IS NOT ENOUGH, and gating on time alone would have
 * accepted the defect this feature most plausibly ships. A stage that only
 * costs more minutes is a stage that is worse to play and pays more for it;
 * points per minute would still favour it as long as the multiplier outran the
 * clock, so the economy gate below cannot see the difference. The difficulty
 * has to be asserted in a currency that is about DANGER.
 *
 * DAMAGE TAKEN PER MINUTE is that currency, and it is the only one available:
 * `deadhunt-horizon` measured no deaths at any competence, so a gate on deaths
 * could never go red. `builds.mjs` gates on the same quantity and records a
 * 6.5x spread across pick policies, so it is known to move on this simulation.
 *
 * The bar is 1.3x across the whole set list rather than something bolder
 * because eleven stage steps of a linear term is a modest multiplier by
 * design — the terms are deliberately small (`waves.ts` records a difficulty
 * pass that overshot by raising three compounding factors at once) — and
 * because two seeds of a hit count is a noisy statistic. It is a floor on
 * "the danger moved at all", not a claim about how much.
 */
{
  const first = byStage.get(STAGES[0]);
  const last = byStage.get(STAGES[STAGES.length - 1]);
  const t0 = mean(first.map((r) => r.seconds));
  const t1 = mean(last.map((r) => r.seconds));
  const clear0 = first.filter((r) => r.won).length / first.length;
  const clear1 = last.filter((r) => r.won).length / last.length;
  const hit0 = mean(first.map((r) => r.hits)) / (t0 / 60);
  const hit1 = mean(last.map((r) => r.hits)) / (t1 / 60);
  const kill0 = mean(first.map((r) => r.kills)) / (t0 / 60);
  const kill1 = mean(last.map((r) => r.kills)) / (t1 / 60);
  const peak0 = mean(first.map((r) => r.onScreenPeak));
  const peak1 = mean(last.map((r) => r.onScreenPeak));
  check(
    t1 / t0 >= 1.3 || clear1 < clear0,
    `depth is bigger — stage ${STAGES[STAGES.length - 1]} contains more than stage ${STAGES[0]}`,
    `${(t1 / t0).toFixed(2)}x the clock (${mmss(t0)} -> ${mmss(t1)}), ` +
      `${(kill1 / kill0).toFixed(2)}x the kill rate (${Math.round(kill0)} -> ${Math.round(kill1)}/min), ` +
      `clear rate ${(clear0 * 100).toFixed(0)}% -> ${(clear1 * 100).toFixed(0)}%`,
  );
  /*
   * PEAK CROWD, AND DAMAGE TAKEN IS REPORTED BESIDE IT AS A MEASURED
   * NON-RESULT.
   *
   * THIS ASSERTION WAS DAMAGE TAKEN PER MINUTE AND IT WAS REPLACED, NOT
   * RELAXED — AGENTS.md §3's second case, where the gate was measuring
   * something that turns out to have no resolution here.
   *
   * The argument for it was good and is the argument `builds.mjs` makes: hits
   * are directly attributable to what the player is facing, and `builds`
   * records a 6.5x spread across pick policies on an unchanged build. It does
   * not transfer. `builds` runs the DODGE brain against a 900-second cap with
   * seven different loadouts; this runs one loadout to a natural end, and this
   * bot takes ONE TO EIGHT HITS IN A WHOLE RUN. Measured over both roster arms:
   *
   *     base roster   1, 1, 1, 2, 2, 4, 5, 8 hits at stages 1..12   (rises)
   *     full roster   3, 4, 6, 4, 4, 2, 2, 1 hits at stages 1..12   (falls)
   *
   * The base arm reads 4.09x and the full arm reads 0.09x on the same eleven
   * stage steps. That is a statistic whose run-to-run spread is the whole
   * effect, which is precisely the defect `tools/README.md` lists four separate
   * gates failing on — a threshold sitting inside its own metric's noise. A
   * gate that goes green or red depending on which roster it was pointed at is
   * not measuring the stage.
   *
   * WHAT REPLACES IT IS NOT WEAKER, and the reason is that peak crowd cannot be
   * satisfied by the thing the old gate was there to catch. "The stage is
   * merely longer" is exactly the state that leaves the biggest simultaneous
   * crowd unchanged: a longer wave with the same population is a longer queue,
   * not a bigger one. It is also a peak over roughly seventeen hundred samples
   * per run rather than a count of single-digit events, so it has resolution:
   * 80 -> 227 on the base roster and 51 -> 108 on the full one, in the same
   * direction in both arms.
   *
   * WHAT THE HONEST NEGATIVE RESULT IS: at no depth is this bot in danger. It
   * takes a couple of hits a run and never dies at stage 12 any more than at
   * stage 1. The set list gets BIGGER and BUSIER, measurably; whether it gets
   * frightening is a question about a human and nothing in this directory can
   * answer it. That sentence belongs in the report rather than behind a green
   * line.
   */
  check(
    peak0 > 0 && peak1 / peak0 >= 1.5,
    'and it is BUSIER, not merely longer — the worst moment of the run gets worse',
    `peak crowd ${f1(peak0)} -> ${f1(peak1)} on screen, ${(peak1 / Math.max(0.001, peak0)).toFixed(2)}x` +
      `; mean crowd ${f1(mean(first.map((r) => r.onScreen)))} -> ${f1(mean(last.map((r) => r.onScreen)))}`,
  );
  console.log(
    `  ..    damage taken ${f1(hit0)} -> ${f1(hit1)} hits/min and ${first.reduce((a, r) => a + r.deaths, 0)}/${last.reduce((a, r) => a + r.deaths, 0)} deaths` +
      ' — REPORTED, not gated: single-digit counts per run, and the two roster arms disagree on the sign. See the note above.',
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
