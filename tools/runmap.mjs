/**
 * Does the run bar say where the run IS?
 *
 *     node --experimental-transform-types tools/runmap.mjs [runs]
 *
 * WHY THIS FILE EXISTS. The bar on the left edge is the only thing on screen
 * that answers "how far through the run am I", and until `src/game/runmap.ts`
 * every one of its readings was arithmetic inside `Renderer.drawBossBar`,
 * where no node check could reach it without loading the sprite atlas. The
 * progression map that preceded this change found, by photographing a run,
 * the corner counter and the bar both saying WAVE for different numbers, a
 * boss banner reading `1 OF 3` under four pips, no words at all for a boss
 * that was seven seconds away, and a retried run whose bar described the
 * previous run's last wave for two bars. None of those had a gate.
 *
 * HOW. Drive the real `World` with the real brain through a WHOLE run — a
 * run that ends, the way `finale.mjs` does — and at every step feed the
 * world's PUBLIC getters into the same `runMap` the renderer draws from.
 * Then assert what a player would read against what the world knows. The
 * strings are asserted, not the ids (AGENTS.md §3: "assert what a person
 * SEES"), because the map found two readouts with the same word on different
 * numbers.
 *
 * WHAT IT CANNOT SEE: whether any of it is legible, or drawn at all — that is
 * `tools/effectsdraw.mjs` (draws in a stub) and the photo pass (a browser).
 * A green line here means the bar's arithmetic agrees with the world, and
 * nothing more.
 *
 * ------------------------------------------------------------------------
 * THE FAIL-TEST LOG — AGENTS.md §3: a gate that has never been seen red is
 * not evidence, and the unit is the ASSERTION. Each break was made in the
 * source, this file was run at 1 run, the red line was read, and the break
 * was undone. Every entry is a state that was observed.
 *
 *   break                                            assertion turned RED
 *   ---------------------------------------------    ------------------------
 *   1  `segmentFill` returns 0.5 for `interlude`     segments never retreat
 *                                                    (retreats > 0); the sum
 *                                                    never retreats
 *   2  `line1` prints `WAVE ${waveIndex}`            line 1 is the wave the
 *                                                    counter shows (0 agree)
 *   3  `wavesToBoss` derived as `BOSS_EVERY - (i %   line 2 agrees with the
 *      BOSS_EVERY)` (off by one)                     world's wavesToBoss; and
 *                                                    the derivation cross-check
 *   4  `nextBoss = beaten` (no +1)                   diamonds agree with
 *                                                    bossesBeaten (the lit
 *                                                    diamond is not the next)
 *   5  `hpLabel` numbers the boss from `beaten`      the HP caption names the
 *                                                    boss on the field
 *   6  `finishWave` keeps the grade banner on a      the boss-down banner fires
 *      boss wave                                     BOSS_COUNT-1 times (0)
 *   7  the telegraph announce removed from           the telegraph banner fires
 *      `awaiting-boss`                               BOSS_COUNT times (0)
 *   8  an unconditional second `announce` after      no update announces twice
 *      the telegraph                                 (clobbered > 0)
 *   9  `beginWave`'s yield branch removed            a WAVE banner never writes
 *                                                    over a live act banner
 *   10 `beginWave` announces `WAVE ${index + 1}`     every WAVE banner carries
 *      without the denominator                       OF <TOTAL_WAVES>
 *   11 `runMapInputOk` returns true                  the guard rejects a stub
 *                                                    world missing a field
 *   12 `start()` no longer resets `plan`             a retried run's first
 *                                                    frame reads wave 1 of the
 *                                                    NEW run
 *
 * The denominators are printed on every line; `checked === 0` is a failure
 * on every count, because zero and clean are the same green otherwise.
 * ------------------------------------------------------------------------
 */

import './lib/tsnode.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const RUNS = Number(process.argv[2] ?? 2);
const MINUTES = 40;
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const { BOSS_COUNT, BOSS_EVERY, TOTAL_WAVES, FINAL_BOSS_WAVE } = await import('../src/game/waves.ts');
const { runMap, runMapInputOk, RUN_BAR } = await import('../src/game/runmap.ts');

let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}  — ${detail}`);
};

/** The world's public getters, in the shape the renderer feeds the function. */
const inputOf = (w) => ({
  waveIndex: w.waveIndex,
  stagePhase: w.stagePhase,
  waveProgress: w.snapshot.waveProgress,
  bossesBeaten: w.bossesBeaten,
  bossActive: w.snapshot.bossActive === true,
  onBossWave: w.wavesToBoss === 0,
  onFinalWave: w.onFinalWave,
  victory: w.victory,
});

/**
 * One run to its own end, sampling the map every step.
 *
 * Card 0 on every offer, the policy `finale.mjs` calls `cardZero`: it wins on
 * every seed that file has ever run, and this file is about the READOUT, not
 * the build, so the cheapest winning policy is the right one.
 */
function runOnce(seed) {
  const w = new World(seed);
  const brain = makeBrain('dodge');
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };

  /* --- banners, instrumented at the call the way wiring.mjs does --- */
  const announces = []; // { text, sub, kind, step, waveIndex, overKind, overAge }
  let frame = [];
  let clobbered = 0;
  const real = w.announce.bind(w);
  w.announce = (text, sub = '', kind = 'wave') => {
    announces.push({
      text, sub, kind, step: frame.step, waveIndex: w.waveIndex,
      overKind: w.bannerKind, overAge: w.bannerAge,
    });
    frame.push(text);
    return real(text, sub, kind);
  };

  w.start();

  const r = {
    seed,
    steps: 0,
    samples: 0,
    retreats: 0,
    sumRetreats: 0,
    line1Agree: 0,
    line1Checked: 0,
    line2Agree: 0,
    line2Checked: 0,
    wtbAgree: 0,
    diamondsAgree: 0,
    diamondsChecked: 0,
    hpAgree: 0,
    hpChecked: 0,
    phasesSeen: new Set(),
    bossSteps: 0,
    ended: false,
    victory: false,
    announces,
    clobbered: 0,
    waveOverAct: 0,
    waveOverActChecked: 0,
    waveDenominator: 0,
    waveBanners: 0,
    guardRejected: 0,
    world: w,
  };

  let prev = null;
  let prevSum = -1;
  const steps = Math.round((MINUTES * 60) / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) {
      brain(w, inp);
      inp.choice = w.choosing && w.offer ? 0 : -1;
    }
    frame = [];
    frame.step = i;
    w.update(DT, inp);
    // Everything but the last was written over before it could render.
    if (frame.length > 1) clobbered += frame.length - 1;
    r.steps++;

    const input = inputOf(w);
    if (!runMapInputOk(input)) {
      r.guardRejected++;
      continue;
    }
    const m = runMap(input);
    r.samples++;
    r.phasesSeen.add(input.stagePhase);

    // A. Every segment only ever fills, and so does their sum.
    if (prev) {
      for (let k = 0; k < m.segments.length; k++) if (m.segments[k] < prev[k] - 1e-9) r.retreats++;
    }
    const sum = m.segments.reduce((a, b) => a + b, 0);
    if (sum < prevSum - 1e-9) r.sumRetreats++;
    prev = m.segments;
    prevSum = sum;

    // B. Line 1 is the same number `#ui-wave` prints (`snap.wave + 1`), over TOTAL_WAVES.
    r.line1Checked++;
    if (m.line1 === `WAVE ${w.snapshot.wave + 1} OF ${TOTAL_WAVES}`) r.line1Agree++;

    // C. Line 2 against the world's own wavesToBoss / bossActive, and the
    //    function's derivation of wavesToBoss against the world's getter.
    r.line2Checked++;
    if (m.wavesToBoss === w.wavesToBoss) r.wtbAgree++;
    const boss = w.enemies.find((e) => e.archetype === 'conductor');
    let want;
    if (w.wavesToBoss > 0) want = `BOSS IN ${w.wavesToBoss}`;
    else if (!input.bossActive) want = w.onFinalWave ? 'FINAL' : 'BOSS';
    else if (boss?.bossFinal) want = `FINAL ${BOSS_COUNT}/${BOSS_COUNT}`;
    else want = `BOSS ${w.bossesBeaten + 1}/${BOSS_COUNT}`;
    if (m.line2 === want) r.line2Agree++;

    // D. The diamonds: as many gold as bosses beaten, the lit one is the next,
    //    and it is filled exactly while a boss is on the field.
    r.diamondsChecked++;
    const gold = m.diamonds.filter((d) => d === 'beaten').length;
    const lit = m.diamonds.findIndex((d) => d === 'next' || d === 'active');
    const active = m.diamonds.filter((d) => d === 'active').length;
    const litOk = w.bossesBeaten >= BOSS_COUNT ? lit === -1 : lit === w.bossesBeaten;
    if (gold === w.bossesBeaten && litOk && active === (input.bossActive ? 1 : 0)) r.diamondsAgree++;

    // E. The HP caption names the boss that is actually on the field.
    if (input.bossActive && boss) {
      r.hpChecked++;
      r.bossSteps++;
      const wantHp = boss.bossFinal ? 'THE FINAL SET' : `BOSS ${w.bossesBeaten + 1} OF ${BOSS_COUNT}`;
      if (m.hpLabel === wantHp) r.hpAgree++;
    }

    if (w.isOver) {
      r.ended = true;
      r.victory = w.victory;
      break;
    }
  }
  r.clobbered = clobbered;

  // F. The banners a run raised, read back from the intercepted calls.
  for (const a of announces) {
    if (a.kind === 'wave' && a.text.startsWith('WAVE ')) {
      r.waveBanners++;
      if (a.text === `WAVE ${a.waveIndex + 1} OF ${TOTAL_WAVES}`) r.waveDenominator++;
    }
    // The yield rule: nothing of kind 'wave' may write over an act banner
    // younger than its own life. `overAge` is the age of the banner it
    // replaced, read before the call.
    if (a.kind === 'wave') {
      r.waveOverActChecked++;
      if (a.overKind === 'act' && a.overAge < 2.4) r.waveOverAct++;
    }
  }
  return r;
}

/* ------------------------------------------------------------------------ */

console.log(`\nRUNMAP — ${RUNS} run(s) to their own end, headless, sampling the run bar every step`);
console.log(
  `The shape it must describe: ${TOTAL_WAVES} waves in ${BOSS_COUNT} acts of ${BOSS_EVERY}, ` +
    `finale on wave ${FINAL_BOSS_WAVE + 1}; bar at x ${RUN_BAR.x}, ${RUN_BAR.top}–${RUN_BAR.bot} of the view.\n`,
);

const seeds = [];
for (let k = 0; k < RUNS; k++) seeds.push(0x51ed + k * 7919);
const runs = seeds.map(runOnce);

console.log('  run   ended   victory   steps    samples   phases seen');
for (const [i, r] of runs.entries()) {
  console.log(
    `  ${String(i + 1).padStart(3)}   ${String(r.ended).padEnd(5)}   ${String(r.victory).padEnd(7)}   ` +
      `${String(r.steps).padStart(6)}   ${String(r.samples).padStart(7)}   ${[...r.phasesSeen].join(' ')}`,
  );
}

const sum = (f) => runs.reduce((a, r) => a + f(r), 0);
const steps = sum((r) => r.steps);
const samples = sum((r) => r.samples);

console.log('\nTHE RUN');
check(runs.every((r) => r.ended && r.victory), 'every run ends in a win, so the whole bar was exercised', `${runs.filter((r) => r.victory).length}/${runs.length} won in ${steps} steps`);
const allPhases = new Set(runs.flatMap((r) => [...r.phasesSeen]));
const wanted = ['idle', 'spawning', 'awaiting-boss', 'conductor', 'interlude', 'over'];
check(
  wanted.every((p) => allPhases.has(p)),
  'every phase of the fill table was sampled',
  `${[...allPhases].length}/${wanted.length}: ${[...allPhases].join(' ')}`,
);
check(samples > 0 && sum((r) => r.guardRejected) === 0, 'the guard accepted every real frame', `${sum((r) => r.guardRejected)} rejected of ${samples + sum((r) => r.guardRejected)}`);

console.log('\nTHE SEGMENTS');
check(samples > 0 && sum((r) => r.retreats) === 0, 'segments never retreat', `${sum((r) => r.retreats)} retreats in ${samples} samples × ${TOTAL_WAVES} segments`);
check(samples > 0 && sum((r) => r.sumRetreats) === 0, 'and their sum never retreats', `${sum((r) => r.sumRetreats)} retreats in ${samples} samples`);

console.log('\nTHE STACK');
check(
  sum((r) => r.line1Checked) > 0 && sum((r) => r.line1Agree) === sum((r) => r.line1Checked),
  `line 1 is the wave the corner counter shows, OF ${TOTAL_WAVES}`,
  `${sum((r) => r.line1Agree)}/${sum((r) => r.line1Checked)} agree`,
);
check(
  sum((r) => r.line2Checked) > 0 && sum((r) => r.wtbAgree) === sum((r) => r.line2Checked),
  "the function's wavesToBoss is the world's",
  `${sum((r) => r.wtbAgree)}/${sum((r) => r.line2Checked)} agree`,
);
check(
  sum((r) => r.line2Checked) > 0 && sum((r) => r.line2Agree) === sum((r) => r.line2Checked),
  "line 2 agrees with the world's wavesToBoss and bossActive",
  `${sum((r) => r.line2Agree)}/${sum((r) => r.line2Checked)} agree`,
);

console.log('\nTHE DIAMONDS');
check(
  sum((r) => r.diamondsChecked) > 0 && sum((r) => r.diamondsAgree) === sum((r) => r.diamondsChecked),
  'gold = bosses beaten, the lit one is the next, filled only while a boss is on the field',
  `${sum((r) => r.diamondsAgree)}/${sum((r) => r.diamondsChecked)} agree`,
);
check(
  sum((r) => r.hpChecked) > 0 && sum((r) => r.hpAgree) === sum((r) => r.hpChecked),
  'the HP caption names the boss on the field',
  `${sum((r) => r.hpAgree)}/${sum((r) => r.hpChecked)} boss frames agree`,
);

console.log('\nTHE BANNERS');
const acts = runs.map((r) => r.announces.filter((a) => a.kind === 'act').length);
const tele = runs.map((r) => r.announces.filter((a) => a.sub === 'INCOMING' && a.kind === 'boss').length);
const total = sum((r) => r.announces.length);
check(
  runs.every((r, i) => r.victory && acts[i] === BOSS_COUNT - 1),
  `the boss-down banner fires ${BOSS_COUNT - 1} times per winning run`,
  `[${acts.join(' ')}] of ${total} announces`,
);
check(
  runs.every((r, i) => r.victory && tele[i] === BOSS_COUNT),
  `the telegraph banner fires ${BOSS_COUNT} times per winning run`,
  `[${tele.join(' ')}] of ${total} announces`,
);
check(total > 0 && sum((r) => r.clobbered) === 0, 'no update announces twice', `${sum((r) => r.clobbered)} clobbered of ${total}`);
check(
  sum((r) => r.waveOverActChecked) > 0 && sum((r) => r.waveOverAct) === 0,
  'a WAVE banner never writes over a live act banner',
  `${sum((r) => r.waveOverAct)} of ${sum((r) => r.waveOverActChecked)} wave-kind banners`,
);
check(
  sum((r) => r.waveBanners) > 0 && sum((r) => r.waveDenominator) === sum((r) => r.waveBanners),
  `every WAVE banner carries OF ${TOTAL_WAVES}`,
  `${sum((r) => r.waveDenominator)}/${sum((r) => r.waveBanners)}`,
);
for (const a of runs[0].announces.filter((x) => x.kind === 'act' || x.sub === 'INCOMING')) {
  console.log(`        wave ${String(a.waveIndex + 1).padStart(2)}  [${a.kind.padEnd(4)}] ${a.text} / ${a.sub}`);
}

console.log('\nTHE GUARD');
{
  const good = inputOf(runs[0].world);
  const rejected = [
    { ...good, waveProgress: undefined },
    { ...good, waveIndex: NaN },
    { ...good, bossesBeaten: undefined },
    { ...good, stagePhase: 'nope' },
    { ...good, bossActive: undefined },
    { ...good, onBossWave: 0 },
    { ...good, onFinalWave: undefined },
    { ...good, victory: 'yes' },
  ].filter((x) => !runMapInputOk(x)).length;
  check(runMapInputOk(good) && rejected === 8, 'the guard rejects a stub world missing a field, and accepts a real one', `${rejected}/8 broken inputs rejected`);
}

console.log('\nTHE RETRY');
{
  // AGAIN is `start()`. The very first frame of the new run has to describe
  // the new run: the old bug left `plan` on the previous run's last wave.
  const w = runs[0].world;
  w.start();
  const m = runMap(inputOf(w));
  const fresh =
    w.stagePhase === 'idle' &&
    w.wavesToBoss === BOSS_EVERY - 1 &&
    !w.onFinalWave &&
    w.bossProgress === 0 &&
    m.line1 === `WAVE 1 OF ${TOTAL_WAVES}` &&
    m.line2 === `BOSS IN ${BOSS_EVERY - 1}` &&
    m.segments.every((s) => s === 0) &&
    m.diamonds.every((d, i) => d === (i === 0 ? 'next' : 'ahead'));
  check(fresh, "a retried run's first frame reads the NEW run", `${m.line1} / ${m.line2}, wavesToBoss ${w.wavesToBoss}, onFinalWave ${w.onFinalWave}, bossProgress ${w.bossProgress}`);
}

console.log(bad === 0 ? '\nTHE BAR SAYS WHERE THE RUN IS\n' : `\n${bad} FAILURE(S)\n`);
process.exit(bad === 0 ? 0 : 1);
