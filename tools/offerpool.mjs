/*
 * offerpool — what does a twenty-weapon roster do to a four-card offer?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. AGENTS.md §5 opens with the finding this tool is here to
 * check: **the four-card offer is zero-sum, and every card type added is taken
 * from the others.** The measurement it records is brutal — letting evolved
 * instruments level, which added no card type and only eligibility, dropped
 * designed fusions per run 1.63 -> 1.13 and the builder-vs-drifter ratio 2.2x
 * -> 1.5x, at three different draw weights, all the same direction. It was
 * reverted.
 *
 * The twenty-weapon roster adds EIGHT DRAFTABLE INSTRUMENTS. That is a much
 * larger change to the pool than the one that got reverted, and it would be
 * dishonest to ship it on the strength of "the gates are green" — none of the
 * gates measures pool dilution directly, which is precisely how the reverted
 * change got as far as it did.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT MEASURES, AND HOW THE COUNTERFACTUAL IS BUILT.
 *
 * The old twelve-base table is gone, so "before" cannot be re-run. What CAN be
 * run is the same code with eight of the twenty held out of the pool: the
 * eight ids that did not exist before this pass are set to `weight: 0`, which
 * is the mechanism the table already uses to keep fusion results undraftable.
 * That gives a genuine A/B inside one build — same offer generator, same
 * weights, same seeds, same everything except how many instruments may be
 * dealt.
 *
 * IT IS NOT A PERFECT COUNTERFACTUAL and the difference is worth naming: the
 * twelve-instrument arm still has the new PROPERTIES, the new stat blocks and
 * the four-slot rig, so it is not the shipped-yesterday game. It isolates the
 * one variable this tool is about — POOL SIZE — and nothing else.
 *
 * Reported, per arm:
 *   - the composition of a card: new instrument / level-up / rig / fusion
 *   - how often a fusion card is on the table at all
 *   - designed fusions landed per run, which is AGENTS.md §5's own metric
 *   - how long a specific instrument waits to be offered
 *
 * Usage:  NODE_OPTIONS=--experimental-transform-types node tools/offerpool.mjs [runs]
 */
import './lib/headless-audio.mjs';

const R = new URL('../src/', import.meta.url).href;
const P = await import(`${R}game/progression.ts`);
const W = await import(`${R}game/weapons.ts`);

/*
 * The eight ids this pass ADDED to `InstrumentId`. Everything else in the
 * draft pool existed before it, whatever it is now called.
 *
 * Listed rather than derived, because there is nothing in the table that
 * records when a row was written — and a comment claiming to derive it would
 * be worse than a list that says plainly what it is.
 */
const ADDED = ['ember', 'phantom', 'anvil', 'gravel', 'nocturne', 'siphon', 'accelerando', 'charm'];

const RUNS = Number(process.env.RUNS ?? process.argv[2] ?? 400);
/*
 * The offer ladder, driven off the real generator rather than off a real run.
 *
 * A real run would fold in the wave curve, the bot's survival and the xp
 * income, and this question is about the DEAL. `levelup.mjs` uses the same
 * model for its own fusion-reachability table and states the caveat there:
 * a model whose random picker fuses in 100% of runs is not describing play. It
 * is describing the pool, which is what is being compared.
 */
const OFFERS_PER_RUN = 34; // `arena.mjs` measures 34.3 offers in a 20-minute run

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

console.log(`\nofferpool — what twenty draftable instruments do to a four-card offer\n`);

const draftable = W.INSTRUMENTS.filter((d) => !d.fused && d.weight > 0);
const rig = W.RIG.filter((d) => d.weight > 0);
console.log(`  draftable instruments ${draftable.length}   rig items ${rig.length}   offer size ${P.OFFER_SIZE}`);
console.log(`  stand slots ${P.STAND_SLOTS}   rig slots ${P.RIG_SLOTS}   authored recipes ${W.FUSIONS.length}`);
console.log(`  of the ${draftable.length}, ${ADDED.length} are ids this pass added: ${ADDED.join(', ')}\n`);

if (draftable.length === 0) fail('nothing is draftable — the pool is empty');

/**
 * One arm: play `RUNS` model runs of `OFFERS_PER_RUN` offers each, taking a
 * card every time, and count what was dealt.
 *
 * `held` is the set of instrument ids allowed into the pool. Ids outside it are
 * skipped by the same test `availableOptions` uses for fusion results, so this
 * is the generator's own exclusion path rather than a second copy of it.
 */
function arm(label, blocked, policy) {
  const totals = {
    cards: 0, offers: 0,
    newInstrument: 0, levelInstrument: 0, rigCard: 0, fusionCard: 0, other: 0,
    offersWithFusion: 0, fusionsTaken: 0, runsWithFusion: 0,
    waitSum: 0, waitRuns: 0,
  };
  for (let r = 0; r < RUNS; r++) {
    const state = P.createProgression(1000 + r);
    /*
     * The blocked ids are removed by BANISHING them, which is the one
     * mechanism `availableOptions` already honours for "this id may not be
     * dealt". Re-implementing the exclusion here would be a second copy of the
     * generator's own rule.
     */
    for (const id of blocked) state.banished.push(id);
    let sawFusion = false;
    let firstSeen = -1;
    for (let i = 0; i < OFFERS_PER_RUN; i++) {
      state.pending = 1;
      const offer = P.openOffer(state);
      if (!offer || !offer.options.length) break;
      totals.offers++;
      let hasFusion = false;
      for (const o of offer.options) {
        totals.cards++;
        if (o.fusion) { totals.fusionCard++; hasFusion = true; }
        else if (o.slot === 'rig') totals.rigCard++;
        else if (o.slot === 'instrument') {
          if ((state.instruments[o.id] ?? 0) > 0) totals.levelInstrument++;
          else totals.newInstrument++;
        } else totals.other++;
        if (firstSeen < 0 && o.id === WATCH) firstSeen = i + 1;
      }
      if (hasFusion) totals.offersWithFusion++;
      const pick = policy(offer, state);
      const before = state.fusions.length;
      P.chooseOption(state, pick);
      if (state.fusions.length > before) { totals.fusionsTaken++; sawFusion = true; }
    }
    if (sawFusion) totals.runsWithFusion++;
    if (firstSeen > 0) { totals.waitSum += firstSeen; totals.waitRuns++; }
  }
  return { label, ...totals };
}

/** A watched instrument, present in BOTH arms, so its wait is comparable. */
const WATCH = 'timpani';

/** Take a fusion whenever one is dealt; otherwise card 0. The `builder`. */
function builder(offer) {
  const i = offer.options.findIndex((o) => o.fusion);
  return i >= 0 ? i : 0;
}
/** Take whatever is first. The drifter — a player who is not planning. */
function drifter() {
  return 0;
}

const arms = [];
for (const [label, blocked] of [
  [`${draftable.length} draftable (as shipped)`, []],
  [`${draftable.length - ADDED.length} draftable (the eight new ids held out)`, ADDED],
]) {
  for (const [pname, policy] of [['builder', builder], ['drifter', drifter]]) {
    arms.push(arm(`${label} / ${pname}`, blocked, policy));
  }
}

console.log(`  ${RUNS} model runs x ${OFFERS_PER_RUN} offers, per arm\n`);
console.log(
  `  ${'arm'.padEnd(52)} ${'new'.padStart(6)} ${'level'.padStart(6)} ${'rig'.padStart(6)} ${'fusion'.padStart(7)}` +
    `   ${'offers w/'.padStart(9)}  ${'fusions'.padStart(8)}  ${'runs w/'.padStart(8)}  ${'wait'.padStart(6)}`,
);
console.log(`  ${'-'.repeat(52)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(7)}   ${'-'.repeat(9)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(6)}`);
for (const a of arms) {
  const pc = (n) => `${((n / Math.max(1, a.cards)) * 100).toFixed(1)}%`;
  console.log(
    `  ${a.label.padEnd(52)} ${pc(a.newInstrument).padStart(6)} ${pc(a.levelInstrument).padStart(6)} ` +
      `${pc(a.rigCard).padStart(6)} ${pc(a.fusionCard).padStart(7)}   ` +
      `${`${((a.offersWithFusion / Math.max(1, a.offers)) * 100).toFixed(1)}%`.padStart(9)}  ` +
      `${(a.fusionsTaken / RUNS).toFixed(2).padStart(8)}  ` +
      `${`${((a.runsWithFusion / RUNS) * 100).toFixed(0)}%`.padStart(8)}  ` +
      `${(a.waitRuns ? (a.waitSum / a.waitRuns).toFixed(1) : 'n/a').padStart(6)}`,
  );
  if (a.cards === 0) fail(`${a.label}: no cards were dealt — nothing was measured`);
}

console.log(`\n  'wait' is the mean number of offers before ${WATCH.toUpperCase()} was first on the table.`);

/*
 * THE ASSERTION, and it is deliberately about the DIRECTION and SIZE of the
 * change rather than about an absolute.
 *
 * There is no correct absolute here — the fusion rate depends on the recipe
 * table, the ladder length and the slot count, all of which moved. What can be
 * asserted is that widening the pool has not collapsed the thing AGENTS.md §5
 * says it collapses: designed fusions per run for a player who is building.
 * The reverted change lost 31% of them (1.63 -> 1.13) and that was judged
 * unacceptable, so 25% is the line here.
 */
{
  const wide = arms.find((a) => a.label.includes('as shipped') && a.label.includes('builder'));
  const narrow = arms.find((a) => a.label.includes('held out') && a.label.includes('builder'));
  const a = wide.fusionsTaken / RUNS;
  const b = narrow.fusionsTaken / RUNS;
  const drop = b > 0 ? (b - a) / b : 0;
  console.log(
    `\n  designed fusions per run, builder: ${a.toFixed(2)} at ${draftable.length} draftable ` +
      `against ${b.toFixed(2)} at ${draftable.length - ADDED.length} — ` +
      `${drop >= 0 ? 'down' : 'up'} ${Math.abs(drop * 100).toFixed(1)}%`,
  );
  if (b === 0) fail('the narrow arm landed no fusions at all, so there is nothing to compare against');
  else if (drop > 0.25) {
    fail(
      `widening the pool to ${draftable.length} costs ${(drop * 100).toFixed(1)}% of a building player's fusions —` +
        ' AGENTS.md §5 reverted a change that cost 31%',
    );
  }
}

console.log('');
if (failures) { console.log(`OFFERPOOL BROKEN — ${failures} failure(s)`); process.exit(1); }
console.log('OFFERPOOL HOLDS — the wider pool has not collapsed the fusion rate');
