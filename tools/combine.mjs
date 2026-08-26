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
const SECS = Number(process.env.COMBINE_SECS ?? 900);
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
const meanWave = (rs) => rs.reduce((a, r) => a + r.wave, 0) / rs.length;
const cw = meanWave(rows), iw = meanWave(ctlRows);
console.log(`  power:  committed reaches wave ${cw.toFixed(1)} against ${iw.toFixed(1)} for the control ` +
  `(${cw > iw ? '+' : ''}${(100 * (cw - iw) / iw).toFixed(0)}%).`);
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
if (cw <= iw) {
  console.log(`\n  FAIL  committing to a fusion build reaches wave ${cw.toFixed(1)} against ${iw.toFixed(1)} ` +
    'for a player who ignores fusions — the tree is decoration');
  process.exitCode = 1;
}
if (ratio < 2) {
  console.log(`\n  FAIL  building toward a fusion yields only ${ratio.toFixed(1)}x what ignoring them does — the choice does not matter`);
  process.exitCode = 1;
}
console.log(designed >= rows.length
  ? '\n  ok  a committed player reaches a designed recipe at least once per run'
  : `\n  FAIL  the most fusion-focused player the game allows lands ${(designed / rows.length).toFixed(2)} DESIGNED ` +
    `fusions per run (${duets} duets stood in) — the fourteen written recipes are effectively not in the game`);
