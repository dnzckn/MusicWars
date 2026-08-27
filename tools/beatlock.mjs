/*
 * beatlock — does a beat-locked weapon actually fire on the beat it claims?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TOOL HAS TO EXIST, AND WHY NO EXISTING ONE CAN ANSWER IT.
 *
 * `docs/plan-items-v2.md` §3 re-points five instruments onto the musical axis,
 * and two of them are defined ENTIRELY by when they fire: METRONOME on the
 * downbeat, SYNCOPATION on the off-beat. If the lock silently stops gating,
 * every one of those weapons keeps dealing exactly the damage its stat block
 * says, every existing gate stays green, and the item is simply gone — the
 * player gets a gun that fires on a timer with a strange number on it.
 *
 * Nothing in `tools/` can see that. `rulefire` watches the rig's trigger
 * surface. `deadhunt-ranges` proves a STAT is read, which is not the same
 * question — `interval` would still be read by a lock that had rotted, and the
 * lock is not a stat at all. `arena` and `builds` measure outcomes, and a
 * weapon that fires uniformly for the same total damage produces almost
 * identical outcomes. This repository's own name for the defect class is a
 * property nobody measures, and a firing PHASE was one.
 *
 * So: count activations into bar-phase buckets, with denominators, and assert
 * the shape of the distribution rather than its total.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT ASSERTS, and every one of these has been seen red (see the fail-test
 * log at the bottom of this file).
 *
 *   1. a `bar` lock puts nearly everything in the first eighth of the bar
 *   2. an `offbeat` lock puts nearly nothing there, and lands on odd eighths
 *   3. the two distributions are genuinely DIFFERENT — total variation >= 0.8 —
 *      so the tool cannot pass by calling two identical histograms distinct
 *   4. an UNLOCKED instrument is spread out, which is the control: without it,
 *      a bug that jammed every weapon onto the downbeat would pass 1 and 2
 *   5. every denominator is non-zero. AGENTS.md §3: "a check that examined
 *      nothing reports a pass"
 *
 * It also PRINTS, without asserting, the three things that decide whether the
 * other new items are alive at all: CRESCENDO's danger multiplier over a real
 * run (a swell that is a constant is a swell that is off), DROP's section
 * share, and the fire counts for COUNTERPOINT, SOSTENUTO, TACET and
 * RITARDANDO with their denominators.
 *
 *   node --experimental-transform-types tools/beatlock.mjs
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const W = await import(`${R}game/weapons.ts`);
const { BEATS_PER_BAR } = await import(`${R}core/transport.ts`);

const DT = 1 / 120;
const SECS = Number(process.env.BEATLOCK_SECS ?? 240);
const SEEDS = [0x51ed, 0xbeef, 0x1234];
/** Eighth notes. Two per beat, eight per bar: the finest grid any lock uses. */
const BUCKETS = 8;

let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

/*
 * A run with ONE instrument in it, held at a fixed level, re-asserted every
 * step.
 *
 * Solo, because the question is about one weapon's own clock and a band would
 * make every histogram a mixture. Re-asserted, because a level-up would
 * otherwise recruit a second voice into the sample and the tool would be
 * measuring the offer generator.
 */
function solo(id, level, seed, secs = SECS) {
  const w = new World(seed);
  w.starter = 'pizzicato';
  w.start();
  const force = () => {
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    w.progression.instruments[id] = level;
  };
  force();
  const buckets = new Array(BUCKETS).fill(0);
  let n = 0;
  let damageSum = 0;
  w.onActivation = (fid, barPhase, damage) => {
    if (fid !== id) return;
    n++;
    damageSum += damage;
    buckets[Math.min(BUCKETS - 1, Math.floor(barPhase * BUCKETS))]++;
  };
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  const steps = Math.round(secs / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    inp.choice = w.choosing ? 0 : -1;
    force();
    w.update(DT, inp);
    w.shocks.length = 0;
    // Immortal: a solo RITARDANDO cannot kill anything, so a mortal harness
    // would measure four minutes of the first one and forty seconds of the
    // second. The question is about firing phase, not survival.
    w.player.lives = Math.max(3, w.player.lives);
    w.player.dead = false;
    if (w.phase === 'over') break;
  }
  return { buckets, n, damageSum, world: w };
}

function pct(buckets, n) {
  return buckets.map((b) => (n ? b / n : 0));
}

function histogram(label, buckets, n) {
  const p = pct(buckets, n);
  const bars = p.map((x) => String(Math.round(x * 100)).padStart(4)).join('');
  const art = p.map((x) => (x > 0.4 ? '#' : x > 0.12 ? '+' : x > 0.005 ? '.' : ' ')).join('');
  console.log(`  ${label.padEnd(24)} n=${String(n).padStart(6)}  [${art}] ${bars}`);
}

/** Total variation distance between two histograms, 0 (same) .. 1 (disjoint). */
function tvd(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

console.log(`\nbeatlock — where in the bar each instrument actually fires`);
console.log(`  ${SEEDS.length} seeds x ${SECS}s, solo loadouts, eighth-note buckets\n`);
console.log(`  ${'instrument'.padEnd(24)} ${''.padEnd(8)}  [ bar phase 0 -> 1 ]  % per eighth`);

/*
 * The roster's declared locks, read out of the table rather than listed here.
 * A tool holding its own copy of a constant will lie the day it moves
 * (AGENTS.md §3) — and this one would lie in the most flattering direction,
 * by continuing to check a lock the table had dropped.
 */
/*
 * THREE SHAPES HAVE NO ACTIVATION OF THEIR OWN and are excluded here rather
 * than allowed to report an empty histogram. UNISON and COUNTERPOINT modify
 * other instruments and RITARDANDO is a continuous bubble; all three are
 * resolved in `fireInstruments`' first pass and never reach the dispatcher, so
 * a bar-phase distribution for them is not "zero", it is not a question. They
 * are checked in the fire-count block below instead, which is the assertion
 * that actually applies to them.
 *
 * A shape set and not an id list, so the day one of them moves ids this
 * exclusion moves with it.
 */
const NO_ACTIVATION = new Set(['unison', 'counterpoint', 'drag']);
const LOCKED = [];
const FREE = [];
for (const d of W.INSTRUMENTS) {
  if (d.fused || NO_ACTIVATION.has(d.shape)) continue;
  for (let lv = 1; lv <= W.INSTRUMENT_MAX_LEVEL; lv++) {
    const lock = W.beatLockOf(d.id, lv);
    (lock ? LOCKED : FREE).push({ id: d.id, label: d.label, lv, lock });
  }
}
console.log(`  (${LOCKED.length} locked instrument-levels in the table, ${FREE.length} free)\n`);
if (LOCKED.length === 0) fail('no instrument in the table declares a beat lock — the whole axis is gone');

const dist = new Map();
for (const row of [...LOCKED, ...FREE]) {
  const key = `${row.id}@${row.lv}`;
  if (dist.has(key)) continue;
  const buckets = new Array(BUCKETS).fill(0);
  let n = 0;
  for (const seed of SEEDS) {
    const r = solo(row.id, row.lv, seed);
    for (let i = 0; i < BUCKETS; i++) buckets[i] += r.buckets[i];
    n += r.n;
  }
  dist.set(key, { ...row, buckets, n, p: pct(buckets, n) });
}

for (const [, r] of dist) {
  histogram(`${r.label} L${r.lv} ${r.lock ?? '-'}`, r.buckets, r.n);
}

console.log('');
const freeOnOne = [];
/* ---------------------------------------------------------------- 1, 2, 5 */
for (const [key, r] of dist) {
  if (r.n === 0) {
    fail(`${key} never fired in ${SEEDS.length * SECS}s — nothing was measured, so nothing was proved`);
    continue;
  }
  const onBeatOne = r.p[0];
  const odd = r.p[1] + r.p[3] + r.p[5] + r.p[7];
  if (r.lock === 'bar') {
    if (onBeatOne < 0.9) {
      fail(`${key} declares a BAR lock and puts only ${(100 * onBeatOne).toFixed(1)}% of ${r.n} activations in the first eighth`);
    }
  } else if (r.lock === 'halfbar') {
    const halves = r.p[0] + r.p[4];
    if (halves < 0.9) {
      fail(`${key} declares a HALF-BAR lock and puts only ${(100 * halves).toFixed(1)}% of ${r.n} activations on the 1 and the 3`);
    }
  } else if (r.lock === 'offbeat') {
    if (odd < 0.9) {
      fail(`${key} declares an OFF-BEAT lock and puts only ${(100 * odd).toFixed(1)}% of ${r.n} activations off the beat`);
    }
    if (r.p[0] > 0.02) {
      fail(`${key} declares an OFF-BEAT lock and still puts ${(100 * r.p[0]).toFixed(1)}% on the downbeat`);
    }
  } else {
    /*
     * THE CONTROL, and it is the assertion that makes the other two mean
     * anything. Without it a bug that jammed the whole band onto bar lines —
     * a `grid` object stuck at all-true, say — would pass every check above
     * while destroying nine instruments.
     *
     * IT ASKS ABOUT THE DOWNBEAT AND NOT ABOUT THE PEAK, because an unlocked
     * instrument whose interval is commensurate with the bar ALIASES: BLACK
     * HOLE at 4.68s against a 1.875s bar advances 0.496 of a bar per shot and
     * alternates between two phases, measured at 38/46% in two buckets with
     * nothing gating it at all. That is a property of the arithmetic, not a
     * defect, and a peak threshold would be a gate against it. Every failure
     * this control exists to catch concentrates on bucket 0 specifically.
     */
    freeOnOne.push(r.p[0]);
    if (r.p[0] > 0.7) {
      fail(`${key} declares NO lock and still puts ${(100 * r.p[0]).toFixed(1)}% of ${r.n} activations on the downbeat — something is gating an unlocked weapon`);
    }
  }
}
{
  const mean = freeOnOne.length ? freeOnOne.reduce((a, b) => a + b, 0) / freeOnOne.length : 0;
  console.log(
    `  unlocked instruments put ${(100 * mean).toFixed(1)}% of their shots on the downbeat, ` +
      `over ${freeOnOne.length} instrument-levels (max 35%)`,
  );
  if (freeOnOne.length === 0) fail('there are no unlocked instruments left to use as a control');
  else if (mean > 0.35) {
    fail(`unlocked instruments average ${(100 * mean).toFixed(1)}% on the downbeat — the lock is reaching shapes that never declared one`);
  }
}

/* -------------------------------------------------------------------- 3 */
{
  /*
   * THE PAIR IS FOUND BY ITS LOCK, NOT BY ITS NAME.
   *
   * This used to read `dist.get('pizzicato@1')` and `dist.get('snare@1')` and
   * fail with "METRONOME or SYNCOPATION is missing from the table". Both ids
   * are still in the table and both moved to different weapons in the
   * twenty-weapon roster, so a hardcoded pair would have gone on testing
   * whichever weapons happened to inherit two ids — the `tools/contrast.mjs`
   * failure (a tool holding its own copy of a constant lies the day it moves)
   * in its most flattering direction: still green, measuring nothing.
   *
   * The ASSERTION is unchanged and the search is stronger: take the busiest
   * bar-locked instrument-level and the busiest off-beat one, whatever they
   * are called, and require their distributions to be nearly disjoint. If the
   * roster ever loses one of the two locks this reports that instead, which is
   * the real finding.
   */
  const busiest = (want) => {
    let best = null;
    for (const row of LOCKED) {
      if (row.lock !== want) continue;
      const d = dist.get(`${row.id}@${row.lv}`);
      if (d && (!best || d.n > best.d.n)) best = { row, d };
    }
    return best;
  };
  const met = busiest('bar');
  const syn = busiest('offbeat');
  if (!met || !syn) {
    fail(
      `the roster has ${met ? 'no OFF-BEAT' : 'no BAR'}-locked instrument — the pair the musical axis is built on is gone`,
    );
  } else {
    const d = tvd(met.d.p, syn.d.p);
    console.log(
      `  ${met.row.label} (bar) vs ${syn.row.label} (offbeat): total variation ${d.toFixed(3)} ` +
        `over ${met.d.n} + ${syn.d.n} activations (min 0.80)`,
    );
    if (d < 0.8) {
      fail(`the downbeat weapon and the off-beat weapon fire in the same places (TVD ${d.toFixed(3)}) — the anti-metronome is not anti anything`);
    }
  }
}

/* ------------------------------------------------------------------------ *
 * The other four items, printed with denominators rather than asserted.
 *
 * A threshold here would be a threshold on how a BOT plays: SOSTENUTO's ghosts
 * need kills, COUNTERPOINT's copies need two instruments, and forcing either
 * would make the number a property of the harness. What the numbers have to
 * show is that the branch is REACHED at all, which zero would disprove.
 * ------------------------------------------------------------------------ */
console.log('\n  the items whose identity is a branch — fires against chances\n');
{
  const rows = [];
  /*
   * EVERY ONE OF THESE NEEDS A COMPANION, and the reason is the design rather
   * than the harness. SOSTENUTO has no hitbox and cannot produce the corpse it
   * feeds on; COUNTERPOINT needs something to lead and something to answer;
   * RITARDANDO cannot kill and would otherwise be measured against an empty
   * field. A level-1 METRONOME is the smallest loadout in which each branch is
   * reachable at all — and if a branch needs more than that to happen, that is
   * a finding about the item rather than about this list.
   */
  /*
   * THE FIVE MODIFIER SHAPES MOVED FROM BASE INSTRUMENTS TO FUSION RESULTS.
   *
   * None of the twenty property weapons is a `ghost`, `counterpoint`, `tacet`,
   * `drag` or `unison` — see `InstrumentShape`'s note on why those six shapes
   * survive as evolutions rather than as picks — so the ids here are the
   * RESULTS now. Forcing a fused id straight into `progression.instruments` is
   * what this harness already does for every other row; the assertion under it
   * is unchanged.
   */
  for (const [ids, label] of [
    [['revenant', 'ember'], 'REVENANT ghosts raised'],
    [['fugue', 'ember', 'timpani'], 'FUGUE copies fired'],
    [['sordino', 'ember'], 'SORDINO discharges'],
    [['adagio', 'ember'], 'ADAGIO bullets dragged'],
    [['maestro', 'ember', 'timpani'], 'UNISON conducted activations'],
  ]) {
    const w = new World(0x51ed);
    w.starter = 'ember';
    w.start();
    const force = () => {
      for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
      for (const id of ids) w.progression.instruments[id] = W.maxLevelOf(id);
      // The companion stays at level 1: it is there to produce kills and
      // volleys, not to be the thing under test.
      if (ids.length > 1) w.progression.instruments.ember = 1;
    };
    force();
    let acts = 0;
    w.onActivation = () => acts++;
    const drive = makeBrain('dodge');
    const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
    for (let i = 0; i < Math.round(SECS / DT); i++) {
      if (i % 2 === 0) drive(w, inp);
      inp.choice = w.choosing ? 0 : -1;
      force();
      w.update(DT, inp);
      w.shocks.length = 0;
      w.player.lives = Math.max(3, w.player.lives);
      w.player.dead = false;
    }
    const got =
      label.startsWith('REVENANT') ? w.ghostsRaised
      : label.startsWith('FUGUE') ? w.counterpointCopies
      : label.startsWith('SORDINO') ? w.tacetDischarges
      : label.startsWith('ADAGIO') ? w.dragsApplied
      : w.beatFires.bar + w.beatFires.halfbar;
    const steps = Math.round(SECS / DT);
    rows.push({ label, got, acts, steps });
    console.log(
      `  ${label.padEnd(32)} ${String(got).padStart(6)}   over ${String(acts).padStart(6)} activations ` +
        `/ ${steps} steps, ${w.beatFires.held} instrument-steps waiting for a grid line`,
    );
  }
  for (const r of rows) {
    /*
     * Two denominators on purpose. RITARDANDO has no activation of its own, so
     * "over 0 activations" is the correct reading of a working item; what must
     * be non-zero for it is the number of steps the harness actually ran.
     */
    if (r.steps === 0) fail(`${r.label}: the harness ran 0 steps — nothing was measured`);
    else if (r.got === 0) {
      fail(`${r.label}: 0 in ${SECS}s over ${r.acts} activations and ${r.steps} steps — the item's whole identity never happened`);
    }
  }
}

/* ------------------------------------------------------------------------ *
 * CRESCENDO's swell, and DROP's section share.
 *
 * Printed, not gated, and both are here because the same failure would kill
 * them: a multiplier whose input never moves is a multiplier that is off, and
 * that is invisible in every outcome-based tool because the item still deals
 * SOME damage. The raw encirclement signal reads p50 0.04 in `arena`, which is
 * exactly why `World.dangerSwell` is a blend of three views and not that one.
 * ------------------------------------------------------------------------ */
/*
 * THE DANGER-SWELL INSTRUMENT IS FOUND BY ITS `swell` FIELD.
 *
 * It used to be the literal `timpani` and the label CRESCENDO. The roster moved
 * both — TIMPANI is an earthquake now and the danger swell rides on GLARE — so
 * a hardcoded id would have been measuring an instrument that does not swell
 * and reporting a flat multiplier as a broken one.
 */
const SWELLED = W.INSTRUMENTS.find((d) => d.swell === 'danger' && !d.fused);
if (!SWELLED) fail('no draftable instrument carries the danger swell — the encirclement multiplier is unreachable');
console.log(`\n  ${SWELLED?.label ?? '???'} — the danger multiplier over a real run\n`);
if (SWELLED) {
  const w = new World(0xbeef);
  w.starter = 'ember';
  w.start();
  const force = () => {
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    w.progression.instruments[SWELLED.id] = W.INSTRUMENT_MAX_LEVEL;
    w.progression.instruments.ember = 1;
  };
  force();
  const swells = [];
  w.onActivation = (id, _phase, damage) => {
    if (id === SWELLED.id) swells.push(damage);
  };
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  for (let i = 0; i < Math.round(SECS / DT); i++) {
    if (i % 2 === 0) drive(w, inp);
    inp.choice = w.choosing ? 0 : -1;
    force();
    w.update(DT, inp);
    w.shocks.length = 0;
    w.player.lives = Math.max(3, w.player.lives);
    w.player.dead = false;
  }
  swells.sort((a, b) => a - b);
  const q = (p) => (swells.length ? swells[Math.min(swells.length - 1, Math.floor(p * swells.length))] : NaN);
  const flat = W.instrumentStats(SWELLED.id, W.INSTRUMENT_MAX_LEVEL).damage;
  console.log(`  n=${swells.length}   damage per wave  p10 ${q(0.1).toFixed(0)}  p50 ${q(0.5).toFixed(0)}  p90 ${q(0.9).toFixed(0)}  max ${q(1).toFixed(0)}`);
  console.log(`  the stat block alone would be ${flat.toFixed(0)} at every one of them`);
  if (swells.length === 0) fail(`${SWELLED.label} never fired — the swell was not measured`);
  else if (q(0.9) / Math.max(0.001, q(0.1)) < 1.6) {
    fail(`${SWELLED.label}'s p90/p10 is only ${(q(0.9) / Math.max(0.001, q(0.1))).toFixed(2)}x — the swell is a constant with extra steps`);
  }
}

console.log('\n  DROP — where the world thinks the arrangement is, with nobody conducting\n');
{
  const w = new World(0x1234);
  w.starter = 'ember';
  w.start();
  const share = {};
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  let n = 0;
  for (let i = 0; i < Math.round(SECS / DT); i++) {
    if (i % 2 === 0) drive(w, inp);
    inp.choice = w.choosing ? 0 : -1;
    w.update(DT, inp);
    w.shocks.length = 0;
    w.player.lives = Math.max(3, w.player.lives);
    w.player.dead = false;
    share[w.musical.section] = (share[w.musical.section] ?? 0) + 1;
    n++;
  }
  for (const [k, v] of Object.entries(share).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(11)} ${(100 * v / n).toFixed(1).padStart(5)}%  of ${n} steps`);
  }
  console.log('  the real arranger, from tools/sections.mjs at 8 x 300s:');
  console.log('  drop 42.5%  build 17.2%  breakdown 16.5%  sustain 16.2%  intro 4.1%  fill 3.4%');
  if (n === 0) fail('the section sampler ran zero steps');
  if (!share.drop) fail('the free-running form never reaches a drop — DROP would be inert in every headless gate');
}

console.log(failures ? `\n${failures} FAILED\n` : '\n  ok  every beat lock fires where its card says it does\n');
/*
 * FAIL-TEST LOG. AGENTS.md §3: a gate that has never been seen red is not
 * evidence, and it has to be broken per ASSERTION rather than per tool. Each
 * case below was applied to the working tree, run at BEATLOCK_SECS=40, seen
 * red, and undone with a second edit. Nothing was reverted with git.
 *
 *   1  removed `beat: 'bar'` from METRONOME's row
 *        exit 1 — "the downbeat weapon and the off-beat weapon fire in the
 *        same places (TVD 0.552)". Note which assertion caught it: METRONOME
 *        becomes a FREE row, so the lock checks stop applying to it entirely
 *        and only the PAIR check is left. That is exactly why the pair check
 *        exists.
 *   2  changed SYNCOPATION's lock from 'offbeat' to 'bar'
 *        exit 1 — "... fire in the same places (TVD 0.000)"
 *   3  made the lock permissive: `if (lock && !grid[lock])` -> `if (false && ...)`
 *        exit 1, 14 FAIL lines — "pizzicato@1 declares a BAR lock and puts only
 *        14.5% of 248 activations in the first eighth", the half-bar rung at
 *        28.7%, and every off-beat rung with it
 *   4  made the lock universal: `grid[lock]` -> `grid.bar` for every shape
 *        exit 1, 27 FAIL lines — "snare@1 declares an OFF-BEAT lock and still
 *        puts 100.0% on the downbeat", plus the unlocked control firing on the
 *        free instruments it was written for
 *   5  returned a constant from `World.dangerSwell`
 *        exit 1 — "CRESCENDO's p90/p10 is only 1.00x"
 *   6  made `fireGhost` return early
 *        exit 1 — "SOSTENUTO ghosts raised: 0 in 40s over 83 activations and
 *        4800 steps"
 *
 * The numbers above are from the runs that produced them; re-running will move
 * them, and a rewrite that cannot reproduce the DIRECTION is a rewrite that has
 * broken the tool.
 */
process.exit(failures ? 1 : 0);
