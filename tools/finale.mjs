/**
 * Does a run actually END, and does it end in a WIN?
 *
 * `node --experimental-transform-types tools/finale.mjs [minutes] [runs]`
 *
 * WHY THIS FILE EXISTS. Until `waves.ts` grew `BOSS_COUNT`, this game had no
 * ending except dying: `planWave` answers for any index, `finishWave` always
 * queues another wave, and the only route to `Phase = 'over'` was
 * `player.dead`. Every gate in this directory was therefore written against a
 * run with no shape — `arena` asserts the player survives twenty simulated
 * minutes and stops there because twenty minutes is where the TOOL gives up,
 * not where the GAME does. `tools/deadhunt-horizon.mjs` says the same thing
 * from the other side: no policy dies, at any competence, and a ship that is
 * never flown reaches wave 60.
 *
 * So the claim "the run ends in a victory" is exactly the kind of claim this
 * repository has learned to distrust: it is easy to write, it is invisible in
 * a diff, and no existing check can see it. Three things have to be true and
 * none of them is implied by the others:
 *
 *   1. THE FINAL BOSS IS REACHABLE. A finale nobody arrives at is a finale
 *      that does not exist, and it would look identical to one that works in
 *      every screenshot and every unit test.
 *   2. BEATING IT ENDS THE RUN IN A WIN, and the win is DISTINCT FROM DEATH —
 *      not merely a different string on the same screen. The world shares the
 *      `'over'` phase between the two endings on purpose (see `World.winRun`),
 *      which is exactly the design decision most likely to collapse a win into
 *      a death somewhere downstream.
 *   3. IT TAKES A SENSIBLE AMOUNT OF TIME, and the player has a build by then.
 *      `docs/plan-refactor-3.md` is an entire document arguing the build is the
 *      content; a run that ends before the build arrives is strictly worse than
 *      an endless one.
 *
 * WHAT IT CANNOT MEASURE, and do not let a green line here suggest otherwise:
 * anything about the music, the renderer, or whether the finale is FUN. The bot
 * is a policy. It also cannot tell you a HUMAN reaches the finale — this bot
 * does not die (see `deadhunt-horizon`), so "the run ends in a win" here means
 * "the run ends in a win for a player who never dies", which is the ceiling
 * case and not the median one.
 *
 * ------------------------------------------------------------------------
 * THE FAIL-TEST LOG
 *
 * AGENTS.md §3: a gate that has never been seen red is not evidence, and the
 * unit is the ASSERTION, not the tool. Each break below was made in the source,
 * this file was run, and the break was then UNDONE. Every line is a state that
 * was actually observed, not one that was reasoned about.
 *
 *   break                                         assertions it turned RED
 *   ------------------------------------------    --------------------------
 *   1  `winRun` sets `phase = 'interlude'`         reaches an end (0/2);
 *      instead of `'over'`                         win-is-not-a-death (0/2,
 *                                                  gameOver false); exactly 4
 *                                                  bosses (1/2); one final
 *                                                  (3 finals); it is the last
 *                                                  one (2/3)
 *   2  `winRun` never called — the finale takes    reaches an end (0/2); ends in
 *      `finishWave` like every other boss          a VICTORY (0/2); win-is-not-
 *                                                  a-death (0/0 denominator);
 *                                                  reaches 1 on a win (0/0)
 *   3  `winRun` emits `outcome: 'lost'` and no     win-is-not-a-death (0/2)
 *      `run:won`
 *   4  the DEATH path emits `outcome: 'won'`       a death is not a win (0/1)
 *   5  `bossVariantFor` always returns             the finale changes it at
 *      `e.bossVariant`                             EVERY act (0/8)
 *   6  `bossVariantFor` always returns `phase`     a mini never changes attack
 *                                                  pattern (12 seen of 12)
 *   7  the finale's HP multiplier 1.9 -> 0.03      survives long enough to play
 *                                                  them (0/2); and the swap
 *                                                  count guard fired at 0/0
 *   8  `BOSS_COUNT = 1` — the run ends at the      the player has a build by
 *      first boss                                  the finale (12.8 < 15); both
 *                                                  mini assertions on their 0
 *                                                  denominators
 *   9  `runProgress` returns 0.99 on victory       reaches exactly 1 on a win
 *                                                  (0/2)
 *
 * TWO ENTRIES THAT ARE NOT SYNTHETIC, and they are the reason the file exists:
 *
 *   `runProgress never goes backwards` WAS RED ON THE FIRST BUILD IT RAN
 *   AGAINST — 62,270 retreats in 78,506 samples. `World.runProgress` counted
 *   the act twice for the length of every post-boss interlude, because
 *   `bossesBeaten` increments on the kill while `bossProgress` stays saturated
 *   until the next wave. Fixed at the source; the note is in `runProgress`.
 *
 *   `a mini has N acts` and `the finale has M` WERE VACUOUS in their first
 *   form. Their fail-test was to swap `BOSS_PHASES` and `FINAL_BOSS_PHASES`,
 *   and BOTH STAYED GREEN — the gate imports the same constants the spawner
 *   reads, so the expectation moves with the game. They are kept, because they
 *   do catch a spawner that ignores the constant (which the `boss:telegraph`
 *   literal `3` really was), but the design claim now has its own assertion
 *   above them that references neither value.
 *
 * DELIBERATELY NOT BROKEN, and why, so the list is honest about its own gaps:
 *
 *   - the two `denominator > 0` guards are not separately fail-tested; they
 *     were observed firing as a side effect of breaks 2, 7 and 8, which is the
 *     same evidence.
 *   - `every run meets exactly BOSS_COUNT bosses` cannot be broken by editing
 *     `BOSS_COUNT`, for the same reason the phase pair could not: the gate
 *     imports it. It went red under breaks 1 and 2, which are the failures it
 *     is actually for — a run that does not stop where it should.
 * ------------------------------------------------------------------------
 */

import '../tools/lib/tsnode.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const MINUTES = Number(process.argv[2] ?? 40);
const RUNS = Number(process.argv[3] ?? 3);
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const waves = await import('../src/game/waves.ts');
const enemies = await import('../src/game/enemies.ts');
const W = await import('../src/game/weapons.ts');

const { BOSS_COUNT, BOSS_EVERY, FINAL_BOSS_WAVE, MINI_BOSSES } = waves;
const { BOSS_PHASES, FINAL_BOSS_PHASES } = enemies;

/*
 * THE BUILDER CARD POLICY, copied from `tools/arena.mjs` verbatim.
 *
 * A copy, not an import, for the reason arena states about its own copy of the
 * driver: if the two drift, the two files are measuring different players and
 * the fusion counts stop being comparable. The MOVEMENT policy is imported
 * (`makeBrain`) precisely because it CAN be — that is the one part of the bot
 * that is already a shared module, and a ninth hand-written copy of it is the
 * failure `bot-brain.mjs` exists to prevent.
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
const cardZero = () => 0;

/**
 * One run, played to its own end rather than to a clock.
 *
 * `kill` forces the player dead at `kill` seconds; it is how the LOSING ending
 * is measured on the same footing as the winning one, which matters because
 * the whole question here is whether the two are distinguishable.
 */
function runOnce(seed, pickCard, kill = -1) {
  const w = new World(seed);
  const brain = makeBrain('dodge');
  const clock = { t: 0 };

  /* --- everything the ending has to be judged on, recorded as it happens --- */
  let deaths = 0;
  let wonEvents = 0;
  let overEvents = 0;
  let overOutcome = null;
  let overWave = -1;
  const bosses = []; // one row per boss encounter
  let cur = null;
  let cards = 0;
  let fusions = 0;

  w.bus.on('player:death', () => deaths++);
  w.bus.on('run:won', () => wonEvents++);
  w.bus.on('run:over', (e) => {
    overEvents++;
    overOutcome = e.outcome;
    overWave = e.wave;
  });
  w.bus.on('level:choice', () => cards++);
  w.bus.on('ability:evolve', () => fusions++);
  w.bus.on('boss:spawn', () => {
    const e = w.enemies.find((x) => x.archetype === 'conductor');
    cur = {
      wave: w.waveIndex + 1,
      at: clock.t,
      final: !!e?.bossFinal,
      phases: e?.phases ?? 0,
      maxHp: e?.maxHp ?? 0,
      hue: e?.hue ?? -1,
      radius: e?.radius ?? 0,
      level: w.progression.level,
      cards,
      fusions,
      /*
       * THE FINAL BOSS'S EXTRA MECHANIC, RECORDED AS AN OBSERVATION.
       *
       * A mini keeps one attack variant for its whole fight; the finale swaps
       * variant at every phase gate. That is the design claim, and the only
       * honest way to check it is to read the lunge spec the fight is actually
       * running at each act — not to grep `bossVariantFor`, which cannot see a
       * call site that was never wired. `windupBeats` is the field the two
       * variants differ in most (1.0 for TIMING, 0.5 for ROTATION), so a
       * sequence of windups IS the sequence of variants.
       */
      windups: [e?.lunge?.windupBeats ?? -1],
      gates: 0,
      len: -1,
    };
    bosses.push(cur);
  });
  w.bus.on('boss:phase', () => {
    if (!cur) return;
    cur.gates++;
    const e = w.enemies.find((x) => x.archetype === 'conductor');
    cur.windups.push(e?.lunge?.windupBeats ?? -1);
  });
  w.bus.on('boss:defeat', () => {
    if (cur) cur.len = clock.t - cur.at;
    cur = null;
  });

  w.start();
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };

  const steps = Math.round((MINUTES * 60) / DT);
  /*
   * MONOTONICITY IS SAMPLED, NOT ASSUMED. `runProgress` is a derived getter
   * over `bossesBeaten` and `bossProgress`, and a progress bar that retreats is
   * a bug report — `World.bossProgress`'s own note says so. Every backward step
   * is counted, with the number of samples as the denominator.
   */
  let prog = 0;
  let backwards = 0;
  let progSamples = 0;
  let endedAt = -1;
  let killed = false;

  for (let i = 0; i < steps; i++) {
    clock.t = i * DT;
    if (kill >= 0 && !killed && clock.t >= kill) {
      // Through the real damage path, the way `tools/ending.mjs` does it.
      killed = true;
      for (let k = 0; k < 60 && !w.player.dead; k++) {
        w.player.invuln = 0;
        w.player.bombs = 0;
        w.player.lives = 1;
        if (w.player.takeHit()) Object.getPrototypeOf(w).onPlayerHit.call(w);
      }
    }
    if (i % 2 === 0) {
      brain(w, inp);
      inp.choice = w.choosing && w.offer ? pickCard(w.offer, w.progression) : -1;
    }
    w.update(DT, inp);
    if (i % 12 === 0) {
      const p = w.runProgress;
      progSamples++;
      if (p < prog - 1e-9) backwards++;
      prog = Math.max(prog, p);
    }
    if (w.isOver) {
      endedAt = clock.t;
      break;
    }
  }

  const s = w.snapshot;
  return {
    seed,
    ended: endedAt >= 0,
    endedAt,
    wave: w.waveIndex + 1,
    level: w.progression.level,
    score: w.score,
    victory: w.victory,
    outcome: s.runOutcome,
    gameOver: s.gameOver,
    runProgress: w.runProgress,
    bossesBeaten: w.bossesBeaten,
    snapActs: s.acts,
    snapAct: s.act,
    deaths,
    wonEvents,
    overEvents,
    overOutcome,
    overWave,
    cards,
    fusions,
    bosses,
    backwards,
    progSamples,
    forcedKill: kill >= 0,
  };
}

/* ------------------------------------------------------------------------ */

const f1 = (x) => x.toFixed(1);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

console.log(`\nFINALE — ${RUNS} runs, played to their own end, cap ${MINUTES} min, headless`);
console.log(
  `The run as designed: ${MINI_BOSSES} mini bosses then the final boss — ` +
    `bosses every ${BOSS_EVERY} waves, finale at wave ${FINAL_BOSS_WAVE + 1}, ${BOSS_COUNT} acts.\n`,
);

const seeds = [];
for (let r = 0; r < RUNS; r++) seeds.push(0x51ed + r * 7919);

const zero = seeds.map((s) => runOnce(s, cardZero));
const build = seeds.map((s) => runOnce(s, builder));
/*
 * ONE LOSING RUN PER ARM, forced at 90 seconds.
 *
 * The win is only meaningful if the loss is DIFFERENT, and "different" cannot
 * be checked from winning runs alone — a build in which `outcome` were hard-
 * coded to `'won'` would pass every assertion above this line. 90s is early
 * enough to be cheap and late enough to be a real run with a real wave index.
 */
const lost = seeds.slice(0, 1).map((s) => runOnce(s, cardZero, 90));

const all = [...zero, ...build];

console.log('  arm       run   ended    outcome   wave  lvl  cards  fus   bosses  runProgress');
const show = (label, rows) => {
  for (const [i, r] of rows.entries()) {
    console.log(
      `  ${label.padEnd(8)}  ${String(i + 1).padStart(3)}   ` +
        `${(r.ended ? mmss(r.endedAt) : '  --').padStart(6)}   ` +
        `${String(r.outcome).padEnd(8)}  ${String(r.wave).padStart(4)}  ${String(r.level).padStart(3)}  ` +
        `${String(r.cards).padStart(5)}  ${String(r.fusions).padStart(3)}   ` +
        `${r.bossesBeaten}/${r.snapActs}     ${r.runProgress.toFixed(3)}`,
    );
  }
};
show('card-0', zero);
show('builder', build);
show('KILLED', lost);

console.log('\nEVERY BOSS OF EVERY RUN (card-0 arm)');
console.log('   wave  kind    arrives  phases  gates  hp     radius  hue   fight     lvl  cards  fus   windups per act');
for (const r of zero) {
  for (const b of r.bosses) {
    console.log(
      `   ${String(b.wave).padStart(4)}  ${(b.final ? 'FINAL' : 'mini').padEnd(6)}  ` +
        `${mmss(b.at).padStart(7)}  ` +
        `${String(b.phases).padStart(6)}  ${String(b.gates).padStart(5)}  ${String(b.maxHp).padStart(5)}  ` +
        `${String(b.radius).padStart(6)}  ${String(b.hue).padStart(3)}   ` +
        `${(b.len >= 0 ? `${f1(b.len)}s` : 'STUCK').padStart(7)}   ${String(b.level).padStart(3)}  ` +
        `${String(b.cards).padStart(5)}  ${String(b.fusions).padStart(3)}   [${b.windups.join(' ')}]`,
    );
  }
}

/* ------------------------------------------------------------------------ *
 * The gates.
 *
 * EVERY ONE PRINTS ITS DENOMINATOR, because `checked === 0` and `wrong === 0`
 * are the same green line otherwise — AGENTS.md §3, and the `mirror` incident
 * where a check that examined nothing reported a pass. Where a denominator can
 * legitimately be zero on a broken build (there are no bosses to inspect if the
 * finale is unreachable) the count itself is asserted rather than assumed.
 * ------------------------------------------------------------------------ */
let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}  — ${detail}`);
};

console.log('\nSTRUCTURE');

// 1. THE RUN ENDS AT ALL. The single thing this whole change is for.
const ended = all.filter((r) => r.ended).length;
check(ended === all.length, 'every run reaches an end', `${ended}/${all.length} ended inside ${MINUTES} min`);

// 2. AND IT ENDS IN A WIN. The bot does not die (deadhunt-horizon), so any run
//    that ends and is not a win is a run that ended some third way.
const won = all.filter((r) => r.victory).length;
check(won === all.length, 'and it ends in a VICTORY', `${won}/${all.length} won, ${all.filter((r) => r.deaths > 0).length} died`);

// 3. THE WIN IS DISTINCT FROM DEATH, in four separate ways, because the two
//    endings deliberately share `Phase = 'over'` and the summary element.
const wins = all.filter((r) => r.victory);
const clean = wins.filter(
  (r) => r.deaths === 0 && r.wonEvents === 1 && r.overOutcome === 'won' && r.gameOver === true,
).length;
check(
  wins.length > 0 && clean === wins.length,
  'a win is not a death: no player:death, one run:won, run:over says won, gameOver still true',
  `${clean}/${wins.length} victories clean`,
);
check(
  lost.length > 0 && lost.every((r) => r.deaths === 1 && r.wonEvents === 0 && r.overOutcome === 'lost' && !r.victory),
  'and a death is not a win',
  `${lost.filter((r) => r.overOutcome === 'lost' && !r.victory).length}/${lost.length} forced deaths reported lost`,
);

// 4. THE SHAPE OF THE RUN IS THE ONE waves.ts DESCRIBES.
const bossRows = all.flatMap((r) => r.bosses);
const finals = bossRows.filter((b) => b.final);
const minis = bossRows.filter((b) => !b.final);
check(
  all.every((r) => r.bosses.length === BOSS_COUNT),
  `every run meets exactly ${BOSS_COUNT} bosses`,
  `${all.filter((r) => r.bosses.length === BOSS_COUNT).length}/${all.length} runs, ${bossRows.length} bosses total`,
);
check(
  all.every((r) => r.bosses.filter((b) => b.final).length === 1),
  'exactly one of them is the final boss',
  `${finals.length} finals and ${minis.length} minis across ${all.length} runs`,
);
check(
  finals.length > 0 && finals.every((b) => b.wave === FINAL_BOSS_WAVE + 1),
  'and it is the last one',
  `${finals.filter((b) => b.wave === FINAL_BOSS_WAVE + 1).length}/${finals.length} finals on wave ${FINAL_BOSS_WAVE + 1}`,
);

// 5. THE FINAL BOSS IS A DIFFERENT FIGHT FROM A MINI. Three properties, and
//    they are separate assertions because a build could get any one right and
//    the others wrong — more phases with the mini's attack pattern is exactly
//    the "same fight with a bigger number" this design is trying not to be.
/*
 * THE FIRST DRAFT OF THIS PAIR WAS VACUOUS AND ITS OWN FAIL-TEST SAID SO.
 *
 * They were only the two `b.phases === CONSTANT` checks below, and the
 * fail-test for them was to swap `BOSS_PHASES` and `FINAL_BOSS_PHASES`. Both
 * stayed GREEN — of course they did: the gate imports the same constants the
 * spawner reads, so any edit to the constant moves the expectation with the
 * game. What they can catch is a spawner that IGNORES the constant, which is a
 * real defect and the one the `boss:telegraph` literal `3` actually was; what
 * they could not catch is the design claim itself going away.
 *
 * So the design claim is now its own assertion, above the wiring ones, stated
 * in the only terms that do not reference either constant's value: whatever the
 * numbers are, the finale must have MORE acts than a mini. That is the line
 * that goes red when someone quietly makes the last fight the same fight.
 */
check(
  FINAL_BOSS_PHASES > BOSS_PHASES,
  'the finale is a longer fight in ACTS, not just in HP',
  `${FINAL_BOSS_PHASES} phases against a mini's ${BOSS_PHASES}`,
);
check(
  minis.length > 0 && minis.every((b) => b.phases === BOSS_PHASES),
  `and the spawner honours it: a mini has ${BOSS_PHASES} acts`,
  `${minis.filter((b) => b.phases === BOSS_PHASES).length}/${minis.length} minis`,
);
check(
  finals.length > 0 && finals.every((b) => b.phases === FINAL_BOSS_PHASES),
  `the finale has ${FINAL_BOSS_PHASES}`,
  `${finals.filter((b) => b.phases === FINAL_BOSS_PHASES).length}/${finals.length} finals`,
);
/*
 * THE MECHANIC, MEASURED AT THE OUTPUT. AGENTS.md §3: "measure the output, not
 * the source text". A mini runs ONE attack variant for its whole fight, so its
 * windup is constant across acts; the finale alternates, so its windup changes
 * at every gate it plays. Reading the live `lunge` spec is what makes this
 * check see a `bossVariantFor` that was written and never called.
 */
const swaps = (b) => {
  let n = 0;
  for (let i = 1; i < b.windups.length; i++) if (b.windups[i] !== b.windups[i - 1]) n++;
  return n;
};
const miniSwaps = minis.reduce((a, b) => a + swaps(b), 0);
const miniGates = minis.reduce((a, b) => a + b.gates, 0);
const finalSwaps = finals.reduce((a, b) => a + swaps(b), 0);
const finalGates = finals.reduce((a, b) => a + b.gates, 0);
check(
  miniGates > 0 && miniSwaps === 0,
  'a mini never changes attack pattern',
  `0 expected, ${miniSwaps} seen across ${miniGates} mini phase gates`,
);
check(
  finalGates > 0 && finalSwaps === finalGates,
  'the finale changes it at EVERY act — the mechanic no mini has',
  `${finalSwaps}/${finalGates} finale phase gates swapped the variant`,
);
/*
 * AND IT LIVES LONG ENOUGH TO PLAY THEM. Five acts the player never sees is
 * five acts that do not exist — the same defect as an unreachable finale, one
 * level down. Four gates are available; three is the bar, so a fight that is
 * merely fast still passes and one that evaporates does not.
 */
const ACTS_WANTED = FINAL_BOSS_PHASES - 1; // the second-to-last act
const played = finals.filter((b) => b.gates >= ACTS_WANTED - 1).length;
check(
  finals.length > 0 && played === finals.length,
  'and it survives long enough to play them',
  `${played}/${finals.length} finales reached act ${ACTS_WANTED} of ${FINAL_BOSS_PHASES}`,
);

// 6. THE BUILD ARRIVES BEFORE THE RUN DOES. The failure mode that is WORSE
//    than an endless run.
const atFinal = all.map((r) => r.bosses.find((b) => b.final)).filter(Boolean);
const meanCards = atFinal.reduce((a, b) => a + b.cards, 0) / Math.max(1, atFinal.length);
const meanLevel = atFinal.reduce((a, b) => a + b.level, 0) / Math.max(1, atFinal.length);
/*
 * FIFTEEN, AND THE NUMBER WAS SET BY ITS FAIL-TEST RATHER THAN BY TASTE.
 *
 * It was 10 for one draft and 10 could not go red: at `BOSS_COUNT = 1` — a run
 * that ends at the FIRST boss, which is the shortest run this design can
 * express and unambiguously too short — the player arrives with 11.0 cards, so
 * a bar of 10 passes the broken case. That is AGENTS.md §3's "a gate that can
 * be satisfied without changing anything", found the way it says to find it.
 *
 * At 15 the same break reads RED (11.0 against 15) while the shipped run reads
 * 24.3, which is 62% of headroom. The bar is a bar on the MEAN across both card
 * policies and every seed, because the per-run spread is enormous — 12 to 35
 * cards at the finale on three seeds — and a gate on a minimum would be a gate
 * on the unluckiest seed's XP luck rather than on the run's length.
 */
check(
  atFinal.length > 0 && meanCards >= 15,
  'the player has a build by the finale',
  `${f1(meanCards)} cards taken and L${f1(meanLevel)} on average at the final boss, ${atFinal.length} runs`,
);

// 7. THE RUN-LEVEL PROGRESS READOUT DOES NOT LIE. It is what the act pips and
//    anything the music reads are drawn from.
const back = all.reduce((a, r) => a + r.backwards, 0);
const samples = all.reduce((a, r) => a + r.progSamples, 0);
check(back === 0, 'runProgress never goes backwards', `${back} retreats in ${samples} samples`);
check(
  wins.length > 0 && wins.every((r) => Math.abs(r.runProgress - 1) < 1e-9 && r.bossesBeaten === BOSS_COUNT),
  'and reaches exactly 1 on a win',
  `${wins.filter((r) => r.runProgress === 1).length}/${wins.length} victories at 1.000`,
);

console.log('\nHOW LONG A RUN IS');
const t0 = zero.filter((r) => r.victory).map((r) => r.endedAt);
const t1 = build.filter((r) => r.victory).map((r) => r.endedAt);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`  card-0    ${t0.length ? mmss(avg(t0)) : '--'} mean of ${t0.length} wins   (${t0.map(mmss).join(' ')})`);
console.log(`  builder   ${t1.length ? mmss(avg(t1)) : '--'} mean of ${t1.length} wins   (${t1.map(mmss).join(' ')})`);
const miniLen = minis.filter((b) => b.len >= 0).map((b) => b.len);
const finLen = finals.filter((b) => b.len >= 0).map((b) => b.len);
console.log(
  `  boss fights: mini ${f1(avg(miniLen))}s mean of ${miniLen.length}, ` +
    `FINAL ${f1(avg(finLen))}s mean of ${finLen.length}` +
    `  (bosslength gates a boss at 120s)`,
);

console.log(bad === 0 ? '\nTHE RUN ENDS, AND IT ENDS IN A WIN\n' : `\n${bad} FAILURE(S)\n`);
process.exit(bad === 0 ? 0 : 1);
