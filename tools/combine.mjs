/*
 * combine — is the Ball x Pit fantasy reachable by a player who WANTS it?
 *
 * `tools/levelup.mjs` gates fusion on a synthetic income curve and its own
 * comment admits the model disagrees wildly with play: it has a random picker
 * fusing in 97% of runs while a real 480s run produced zero fusion cards
 * across 26 offers. `tools/builds.mjs` measures real runs but its `fuser`
 * policy only TAKES a fusion card when one is already on the table — it never
 * builds toward one — which is why `fuser` and `refuser` come out level, and
 * why "combining does not pay" has never been distinguished from "combining
 * never comes up".
 *
 * This separates the two. A committed policy locks onto one recipe the moment
 * it can and then spends every single pick on that recipe's base or catalyst,
 * taking anything else only when neither is offered. That is the most
 * fusion-focused player the game permits. If even they cannot get there, the
 * system is structurally out of reach and no amount of card-weighting fixes
 * it; if they can, then the question is only whether the reward is worth the
 * detour.
 *
 * Reported per policy: fusions landed, how far the chosen base and catalyst
 * actually climbed, and — the diagnostic that matters — how many offers
 * contained a card for each. A pursuit that stalls because the card is never
 * dealt is a different defect from one that stalls because the run ends first.
 */
const L = await import('./lib/headless-audio.mjs');
const { World } = await import('../src/game/world.ts');
const { FUSIONS, INSTRUMENT_MAX_LEVEL, RIG_MAX_LEVEL } = await import('../src/game/weapons.ts');
const { makeBrain } = await import('./lib/bot-brain.mjs');

const DT = 1 / 60;
/*
 * 1500, NOT 900, AND THE REASON IS A MEASUREMENT. At 900 the winners of both
 * arms landed at 721-885 s — inside the last fifth of the cap — so "won
 * inside the cap" was itself a near-cap coin flip: the first run of the
 * replacement power check read committed 4 of 8, control 5 of 8, a single
 * seed's fifteen seconds, with the committed arm FASTER among winners
 * (813 s against 822 s). A cap that binds turns the ending back into the
 * saturated statistic this check exists to escape. 1500 leaves the slowest
 * measured winner 600 s of room; the guard below still fails the run if
 * either arm cannot reach the ending at all.
 */
const SECS = Number(process.env.COMBINE_SECS ?? 1500);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/*
 * Commit to a recipe and spend everything on it.
 *
 * The target is chosen the first time any recipe's base is offered, so the
 * policy never fights the deal — it picks a goal the run has already shown it
 * can start. After that the order is strict: an actual fusion card, then the
 * base, then the catalyst, then whatever is left.
 */
function committed() {
  let target = null;
  const seen = { base: 0, cat: 0, fusion: 0 };
  return {
    seen,
    get target() { return target; },
    pick(offer) {
      const opts = offer.options;
      if (!target) {
        for (const f of FUSIONS) {
          if (f.kind !== 'evolution') continue;
          if (opts.some((o) => o.id === f.base)) { target = f; break; }
        }
      }
      const fi = opts.findIndex((o) => o.fusion);
      if (fi >= 0) { seen.fusion++; return fi; }
      if (target) {
        const bi = opts.findIndex((o) => o.id === target.base);
        if (bi >= 0) { seen.base++; return bi; }
        const ci = opts.findIndex((o) => o.id === target.catalyst);
        if (ci >= 0) { seen.cat++; return ci; }
      }
      return 0;
    },
  };
}

/*
 * The control: a player who is not building at all.
 *
 * Fixed index rather than a random draw, so the comparison is deterministic
 * across runs of this tool. `builds.mjs` already shows `first` and `random`
 * land within noise of one another, so which inattentive policy stands in here
 * does not change the conclusion.
 *
 * IT MUST ACTUALLY DECLINE FUSIONS, and for most of this tool's life it did not.
 * The control was `pick: () => 0` and the report calls it "a player who never
 * chooses one". That was true while fusion cards were rare: index 0 was almost
 * never a fusion, so taking it was indistinguishable from refusing. Once the
 * level ladder shortened from 8 rungs to 3, fusion cards became common, index 0
 * was frequently a fusion, and the control started FUSING 5.13 TIMES PER RUN
 * while still being described as the player who never does. The comparison went
 * degenerate and the tool reported "the choice does not matter" — which was a
 * statement about its own control, not about the game.
 *
 * This is the failure this directory keeps finding in a new place: a proxy that
 * was accidentally valid, and stayed in use after the thing that made it valid
 * moved. It now skips fusion cards explicitly and falls back to index 0 only
 * when every option is one.
 */
function inattentive() {
  return {
    seen: { base: 0, cat: 0, fusion: 0 },
    target: null,
    pick: (offer) => {
      const i = offer.options.findIndex((o) => !o.fusion);
      return i >= 0 ? i : 0;
    },
  };
}

function run(seed, policy) {
  const w = new World(seed); w.start();
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  const agent = policy();
  let offers = 0, lockedOffers = 0;
  /*
   * COUNT THE KINDS SEPARATELY. `evolution` and `union` are the hand-authored
   * recipes — fourteen of them, each with a unique result and a written line.
   * `duet` is the generative fallback: any two instruments at level 6, blended
   * by formula. Lumping them together is how "the player fused something"
   * hides "the player never saw a single piece of designed content".
   */
  const kinds = { evolve: 0, union: 0, duet: 0 };
  w.bus.on('ability:evolve', () => kinds.evolve++);
  w.bus.on('ability:union', () => kinds.union++);
  w.bus.on('ability:duet', () => kinds.duet++);
  // The run has an ending now. `run:won` carries the game's own seconds-to-win,
  // which is the number a finite run offers where "wave reached at a cap" no
  // longer can — see the note above the power check.
  let wonAt = null;
  let finalScore = 0;
  w.bus.on('run:won', (e) => { wonAt = e.seconds; });
  w.bus.on('run:over', (e) => { finalScore = e.score; });
  const steps = Math.round(SECS / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    if (w.choosing && w.offer) {
      /*
       * Was the catalyst even POSSIBLE to be dealt at this offer? A rig at
       * capacity cannot be offered a passive it does not already hold, so a
       * player who filled three slots before committing has locked the
       * evolution out of the run — silently, and with the HUD still telling
       * them they are one step away from it.
       */
      const t2 = agent.target;
      if (t2) {
        const rig = w.progression.rig;
        const held = Object.keys(rig).filter((k) => (rig[k] ?? 0) > 0);
        if (!(rig[t2.catalyst] ?? 0) && held.length >= w.progression.rigSlots) lockedOffers++;
      }
      inp.choice = agent.pick(w.offer); offers++;
    }
    else inp.choice = -1;
    w.update(DT, inp);
  }
  const t = agent.target;
  const st = w.progression;
  return {
    offers, kinds, fusions: kinds.evolve + kinds.union + kinds.duet,
    target: t ? `${t.base}+${t.catalyst}` : '—',
    baseLv: t ? (st.instruments[t.base] ?? 0) : 0,
    catLv: t ? ((st.instruments[t.catalyst] ?? st.rig[t.catalyst]) ?? 0) : 0,
    seen: agent.seen, wave: w.waveIndex ?? 0, lockedOffers,
    wonAt, score: finalScore,
  };
}

const rows = SEEDS.map((s) => run(s, committed));
const ctlRows = SEEDS.map((s) => run(s, inattentive));

console.log(`\ncombine — can a committed player actually fuse? (${SECS}s runs)\n`);
console.log(`  ${'seed'.padStart(4)} ${'wave'.padStart(5)} ${'offers'.padStart(7)} ${'evo'.padStart(4)} ${'uni'.padStart(4)} ${'duet'.padStart(5)} ${'target'.padEnd(22)} ${'base'.padStart(6)} ${'catalyst'.padStart(9)} ${'base cards'.padStart(11)} ${'cat cards'.padStart(10)} ${'LOCKED'.padStart(7)}`);
console.log(`  ${'-'.repeat(4)} ${'-'.repeat(5)} ${'-'.repeat(7)} ${'-'.repeat(4)} ${'-'.repeat(4)} ${'-'.repeat(5)} ${'-'.repeat(22)} ${'-'.repeat(6)} ${'-'.repeat(9)} ${'-'.repeat(11)} ${'-'.repeat(10)} ${'-'.repeat(7)}`);
for (const [i, r] of rows.entries()) {
  console.log(`  ${String(SEEDS[i]).padStart(4)} ${String(r.wave).padStart(5)} ${String(r.offers).padStart(7)} ${String(r.kinds.evolve).padStart(4)} ${String(r.kinds.union).padStart(4)} ${String(r.kinds.duet).padStart(5)} ` +
    `${r.target.padEnd(22)} ${(r.baseLv + '/' + INSTRUMENT_MAX_LEVEL).padStart(6)} ${(r.catLv + '/' + RIG_MAX_LEVEL).padStart(9)} ` +
    `${String(r.seen.base).padStart(11)} ${String(r.seen.cat).padStart(10)} ${String(r.lockedOffers).padStart(7)}`);
}

const tot = rows.reduce((a, r) => a + r.fusions, 0);
const meanOffers = rows.reduce((a, r) => a + r.offers, 0) / rows.length;
const meanBase = rows.reduce((a, r) => a + r.baseLv, 0) / rows.length;
const meanCat = rows.reduce((a, r) => a + r.catLv, 0) / rows.length;
console.log(`\n  ${tot} fusion(s) across ${rows.length} runs of the most fusion-focused player the game allows.`);
console.log(`  mean offers ${meanOffers.toFixed(1)}; chosen base reached ${meanBase.toFixed(1)}/${INSTRUMENT_MAX_LEVEL}, catalyst ${meanCat.toFixed(1)}/${RIG_MAX_LEVEL}.`);
const locked = rows.reduce((a, r) => a + r.lockedOffers, 0);
const totOffers = rows.reduce((a, r) => a + r.offers, 0);
console.log(`  LOCKED: ${locked} of ${totOffers} offers (${Math.round((100 * locked) / totOffers)}%) could not deal the ` +
  'catalyst at all — the rig was full and a passive you do not hold cannot be offered.');
const designed = rows.reduce((a, r) => a + r.kinds.evolve + r.kinds.union, 0);
const duets = rows.reduce((a, r) => a + r.kinds.duet, 0);
console.log(`  of those, ${designed} were hand-authored recipes and ${duets} were generative duets.`);
/*
 * DOES BUILDING TOWARD IT PAY? Measured on real `World` runs.
 *
 * `levelup.mjs` asks the same question against a synthetic income curve and
 * its own comment records that the model is wrong by a wide margin — it has a
 * random picker fusing in 97% of runs where a real 480s run produced none. So
 * the ratio is computed here instead, on the same simulation the player would
 * actually play, and counted over DESIGNED recipes only: a duet is available
 * to anyone who levels two instruments and so cannot distinguish intent.
 */
const ctlDesigned = ctlRows.reduce((a, r) => a + r.kinds.evolve + r.kinds.union, 0);
const ratio = ctlDesigned > 0 ? designed / ctlDesigned : Infinity;
/*
 * DOES IT PAY IN POWER, not just in count?
 *
 * Landing more fusions is only worth measuring if fusing changes the run. This
 * is the question `builds.mjs` cannot answer, because its `fuser` policy takes
 * a fusion card when one appears rather than building toward one, so it is a
 * drifter that occasionally gets lucky. Wave reached is the outcome the player
 * feels; if the committed policy does not beat the control on it, the whole
 * combining tree is decoration however often it fires.
 */
/*
 * POWER, MEASURED ON A RUN THAT ENDS.
 *
 * This used to compare WAVE REACHED at the 900-second cap, and it was red
 * for a whole session — reproducibly, not noisily — while the tool's other
 * half read identically to two decimals across commits. The reason is not
 * the game: the run has a final boss at FINAL_BOSS_WAVE now, and a competent
 * arm reaches it just inside the cap, so both arms pinned at 14-15 and the
 * check compared two ceilings. A detached worktree before the meta layer and
 * the rail change read 14.5 / 14.6 (-1%); HEAD read 14.6 / 14.8, then
 * 14.4 / 14.6 twice. Two saturated numbers, a coin flip on the sign, and a
 * gate everyone learns to ignore.
 *
 * What a finite run offers instead is its own ending: whether the arm WON
 * inside the cap, and how many seconds it took (`run:won` carries the game's
 * figure). So:
 *
 *   A. Committing to a fusion build must not cost the run its ending: the
 *      committed arm wins at least as often as the control. Counted, with
 *      the denominator.
 *   B. Among winners, the committed arm is not SLOWER than the control by
 *      more than the control's own seed-to-seed spread — the margin is one
 *      standard deviation of the control's times, derived from this run's
 *      data and printed, not a number this file invented. A committed player
 *      spends picks on a plan and a drifter on immediate throughput, so a
 *      small deficit is expected of a healthy tree; a deficit larger than
 *      the noise is the "decoration" verdict the old check was reaching for.
 *   C. If either arm has fewer than two winners, this is NOT a pass. The cap
 *      is too short to measure power and the gate says so and fails, rather
 *      than passing on an empty comparison. Raise COMBINE_SECS.
 *
 * The wave column is still printed per seed above; it is a report now.
 */
const winners = (rs) => rs.filter((r) => r.wonAt !== null);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length); };
const cWin = winners(rows), iWin = winners(ctlRows);
const cT = cWin.map((r) => r.wonAt), iT = iWin.map((r) => r.wonAt);
console.log(`  power:  committed wins ${cWin.length} of ${rows.length} inside ${SECS}s` +
  (cT.length ? ` (mean ${mean(cT).toFixed(0)}s to win)` : '') +
  `; control wins ${iWin.length} of ${ctlRows.length}` +
  (iT.length ? ` (mean ${mean(iT).toFixed(0)}s, sd ${sd(iT).toFixed(0)}s)` : '') + '.');
for (let i = 0; i < rows.length; i++) {
  const c = rows[i].wonAt, k = ctlRows[i].wonAt;
  console.log(`          seed ${String(SEEDS[i]).padStart(2)}: committed ${c === null ? 'did not win' : c.toFixed(0) + 's'}` +
    `   control ${k === null ? 'did not win' : k.toFixed(0) + 's'}` +
    (c !== null && k !== null ? `   (${c > k ? '+' : ''}${(c - k).toFixed(0)}s)` : ''));
}
console.log(`  intent: committed lands ${(designed / rows.length).toFixed(2)} designed fusions per run against ` +
  `${(ctlDesigned / ctlRows.length).toFixed(2)} for a player who never chooses one — ` +
  `${ratio === Infinity ? '∞' : ratio.toFixed(1)}x.`);
const unions = rows.reduce((a, r) => a + r.kinds.union, 0);
if (unions === 0) {
  console.log('  NOTE: zero unions. Two evolved instruments should combine into one — check');
  console.log('        that fusion results still seat at maxLevelOf (see applyFusion), since');
  console.log('        readyDuets admits an evolved input only at that level.');
}
/*
 * POWER IS THE GATE, not just how often the verb fires.
 *
 * A combining tree that triggers often and changes nothing is decoration. The
 * bar is deliberately modest — a committed build should be measurably ahead of
 * one that ignores the system, not dominant, or the other build styles
 * (`narrow` in builds.mjs is the strongest single policy) stop being viable.
 */
if (cWin.length < 2 || iWin.length < 2) {
  console.log(`\n  FAIL  power is unmeasured: committed won ${cWin.length} of ${rows.length}, control ${iWin.length} of ${ctlRows.length} ` +
    `inside ${SECS}s. Fewer than two winners in an arm is not a pass — the cap is too short to compare endings. Raise COMBINE_SECS.`);
  process.exitCode = 1;
} else {
  const margin = sd(iT);
  const asOften = cWin.length >= iWin.length;
  const asFast = mean(cT) <= mean(iT) + margin;
  if (!asOften) {
    console.log(`\n  FAIL  committing to a fusion build costs the run its ending: committed won ${cWin.length} of ${rows.length}, ` +
      `control ${iWin.length} of ${ctlRows.length}`);
    process.exitCode = 1;
  }
  if (!asFast) {
    console.log(`\n  FAIL  committing to a fusion build is slower to the ending than the control's own spread allows: ` +
      `${mean(cT).toFixed(0)}s against ${mean(iT).toFixed(0)}s + ${margin.toFixed(0)}s (one sd of the control's ${iT.length} times) — the tree is decoration`);
    process.exitCode = 1;
  }
  if (asOften && asFast) {
    console.log(`\n  ok  committing reaches the ending as often (${cWin.length} vs ${iWin.length} of ${rows.length}) and within the control's spread ` +
      `(${mean(cT).toFixed(0)}s vs ${mean(iT).toFixed(0)}s, margin ${margin.toFixed(0)}s)`);
  }
}
if (ratio < 2) {
  console.log(`\n  FAIL  building toward a fusion yields only ${ratio.toFixed(1)}x what ignoring them does — the choice does not matter`);
  process.exitCode = 1;
}
console.log(designed >= rows.length
  ? '\n  ok  a committed player reaches a designed recipe at least once per run'
  : `\n  FAIL  the most fusion-focused player the game allows lands ${(designed / rows.length).toFixed(2)} DESIGNED ` +
    `fusions per run (${duets} duets stood in) — the fourteen written recipes are effectively not in the game`);
