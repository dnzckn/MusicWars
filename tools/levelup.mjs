/**
 * Does the progression system actually progress?
 *
 * `tools/progression.mjs` is a different check with a confusingly similar name:
 * it drives a browser and asks whether a *run* has an arc. This one never opens
 * a browser. `src/game/progression.ts` and `src/game/weapons.ts` are pure — no
 * DOM, no Strudel, no clock — so the whole system can be exercised directly,
 * hundreds of thousands of times, in under a second. That is the entire reason
 * it was designed as data plus pure functions: this project's culture is that
 * nothing counts until it is measured, and a pure system is the cheapest thing
 * in the repository to actually measure.
 *
 * Five questions, in the order they matter:
 *
 *   1. **Is the table coherent?** Every non-fused instrument needs exactly one
 *      evolution, every rig item needs to catalyse exactly one thing, and every
 *      fusion result needs to exist. An orphan id is a build path that silently
 *      does not exist, and no amount of play-testing finds one reliably.
 *   2. **Can the offer generator produce an illegal card?** A seventh instrument
 *      against six slots, a maxed ability with nowhere to grow, a banished id,
 *      a fusion offered directly, the same card twice. Fuzzed against
 *      deliberately awkward states, including every slot full and everything
 *      maxed.
 *   3. **Does the XP curve level a player at a sane rate?** Reported as a table
 *      of level against elapsed time rather than a single number, because the
 *      answer depends on an income the arena conversion is about to change.
 *   4. **Are evolutions reachable?** Measured under two policies — a player who
 *      is building toward something, and one picking at random — because a
 *      reward only a perfect player can reach is not in the game.
 *   5. **Is the offer bias earning its keep?** The same seeds are re-run with
 *      `OFFER_TUNING` flattened to 1.0. A bias that has not been measured
 *      against its own absence is a taste, not a decision.
 *
 * The kill model below is the one soft thing here, and it is soft on purpose:
 * it is run at three income levels rather than one, so the verdict says how
 * sensitive it is instead of pretending to a precision it has not got.
 */
import './lib/ts.mjs';

const P = await import('../src/game/progression.ts');
const W = await import('../src/game/weapons.ts');

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

/* ---------------------------------------------------------------- 1. table */

console.log('\nTABLE');

{
  const instruments = W.INSTRUMENTS.filter((d) => !d.fused);
  const fused = W.INSTRUMENTS.filter((d) => d.fused);
  console.log(`  ${instruments.length} instruments  ${W.RIG.length} rig  ${fused.length} fusions  ${W.FUSIONS.length} recipes`);

  /*
   * COVERAGE, not uniqueness — and the difference is a design change, so it is
   * spelled out rather than quietly relaxed.
   *
   * This used to assert `n === 1` in both directions: every instrument evolves
   * exactly once, every rig item catalyses exactly once. The at-LEAST-one half
   * is the part worth having and is unchanged below — an instrument with no
   * evolution is a dead end a player can commit to and never be paid for, and a
   * rig item that catalyses nothing is filler competing for the same four card
   * slots as everything else.
   *
   * The at-MOST-one half was never justified in this file beyond restating the
   * table, and it encoded the flaw rather than a requirement: with one ending
   * per instrument, committing to an instrument also chose its ending, and the
   * only open question was whether its single catalyst ever appeared. That is a
   * lookup. Branches are the fix, so a gate forbidding them has to go — but it
   * is replaced by a STRONGER check, not deleted, because "the test failed so I
   * removed it" and "the test encoded an assumption I am deliberately changing"
   * look identical in a diff and only one of them is honest.
   *
   * What replaces it: a branch must be UNAMBIGUOUS. Two recipes sharing a base
   * must ask for different catalysts, or the game could not tell which one a
   * player meant; and they must produce different results, or the branch is
   * cosmetic. Both are checked below, and the branch count is printed so a
   * second one cannot appear by accident and go unnoticed.
   */
  const evolutions = W.FUSIONS.filter((f) => f.kind === 'evolution');
  const unions = W.FUSIONS.filter((f) => f.kind === 'union');
  for (const d of instruments) {
    const mine = evolutions.filter((f) => f.base === d.id);
    if (mine.length === 0) fail(`${d.id} has no evolution — a dead end to commit to`);
    const cats = new Set(mine.map((f) => f.catalyst));
    if (cats.size !== mine.length) fail(`${d.id} has two evolutions sharing a catalyst — ambiguous`);
    const outs = new Set(mine.map((f) => f.result));
    if (outs.size !== mine.length) fail(`${d.id} has two evolutions with the same result`);
  }
  for (const d of W.RIG) {
    const n = evolutions.filter((f) => f.catalyst === d.id).length;
    if (n === 0) fail(`rig ${d.id} catalyses nothing — filler in a zero-sum offer`);
  }
  const branched = instruments
    .map((d) => [d.id, evolutions.filter((f) => f.base === d.id).length])
    .filter(([, n]) => n > 1);
  console.log(
    branched.length
      ? `  branching: ${branched.map(([id, n]) => `${id} x${n}`).join(' ')}`
      : '  branching: none — every instrument has exactly one ending',
  );
  const results = new Set(W.FUSIONS.map((f) => f.result));
  if (results.size !== W.FUSIONS.length) fail('two recipes produce the same fusion');
  for (const f of W.FUSIONS) {
    const def = W.instrumentDef(f.result);
    if (!def) fail(`recipe result ${f.result} is not an instrument`);
    else if (!def.fused) fail(`recipe result ${f.result} is offerable; it must be fused-only`);
    if (!W.instrumentDef(f.base)) fail(`recipe base ${f.base} is not an instrument`);
    if (f.kind === 'union' && !W.instrumentDef(f.catalyst)?.fused) {
      fail(`union catalyst ${f.catalyst} must itself be a fusion`);
    }
    if (f.kind === 'evolution' && !W.rigDef(f.catalyst)) fail(`evolution catalyst ${f.catalyst} is not a rig item`);
  }
  for (const d of fused) {
    if (!results.has(d.id)) fail(`${d.id} is fused-only but no recipe produces it`);
    if (d.weight !== 0) fail(`${d.id} is fused-only but has a nonzero offer weight`);
    if (d.steps.length !== 0) fail(`${d.id} is fused-only but carries level steps`);
  }
  if (failures === 0) pass(`every instrument evolves, every rig item catalyses, ${unions.length} unions close the top`);

  // Level steps must exist and describe something.
  for (const d of instruments) {
    if (d.steps.length !== W.INSTRUMENT_MAX_LEVEL - 1) {
      fail(`${d.id} has ${d.steps.length} steps, want ${W.INSTRUMENT_MAX_LEVEL - 1}`);
    }
    for (const s of d.steps) if (!s.note || s.note.length < 4) fail(`${d.id} has a step with no note`);
    for (const s of d.steps) if (!s.add && !s.mul) fail(`${d.id} has a step that changes nothing`);
  }
  /*
   * A RIG ITEM'S THREE RUNGS MUST EACH BUY SOMETHING, and since passives can
   * now install RULES as well as scale numbers, "something" is the union of the
   * two. The old form of this check only counted `levels`, so a rule-only
   * passive with `[{}, {}, {}]` would have sailed through it — which is the
   * whole defect class, dressed as the fix for it.
   *
   * The test is per RUNG and against the rung below, because `levels` and
   * `rules` are both CUMULATIVE: an entry identical to its predecessor is a
   * level-up that changes nothing, and that is exactly what a passive looks
   * like when someone adds a rung and forgets to move a dial.
   */
  const differs = (a, b) => {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const k of keys) if ((a?.[k] ?? null) !== (b?.[k] ?? null)) return true;
    return false;
  };
  let ruleItems = 0;
  for (const d of W.RIG) {
    if (d.levels.length !== W.RIG_MAX_LEVEL) fail(`rig ${d.id} has ${d.levels.length} levels, want ${W.RIG_MAX_LEVEL}`);
    if (d.notes.length !== W.RIG_MAX_LEVEL) fail(`rig ${d.id} has ${d.notes.length} notes, want ${W.RIG_MAX_LEVEL}`);
    if (d.rules) {
      ruleItems++;
      if (d.rules.length !== W.RIG_MAX_LEVEL) fail(`rig ${d.id} has ${d.rules.length} rule rungs, want ${W.RIG_MAX_LEVEL}`);
      // Every key a rule rung names has to be a real `Rules` field, or it is a
      // typo that folds to nothing and fires never.
      const known = new Set(Object.keys(W.noRules()));
      for (const r of d.rules) {
        for (const k of Object.keys(r)) if (!known.has(k)) fail(`rig ${d.id} sets unknown rule '${k}'`);
      }
    }
    for (let lv = 1; lv < W.RIG_MAX_LEVEL; lv++) {
      const movedNumber = differs(d.levels[lv - 1], d.levels[lv]);
      const movedRule = d.rules ? differs(d.rules[lv - 1], d.rules[lv]) : false;
      if (!movedNumber && !movedRule) fail(`rig ${d.id} L${lv + 1} moves neither a modifier nor a rule`);
    }
    // A note per rung, and each one has to say something different — three
    // rungs sharing a sentence is three cards that read the same.
    if (new Set(d.notes).size !== d.notes.length) fail(`rig ${d.id} repeats a level note`);
  }
  console.log(`  ${ruleItems} of ${W.RIG.length} passives install a rule; ${W.RIG.length - ruleItems} are pure numbers`);
  if (ruleItems === 0) fail('no passive installs a rule — the trigger surface is unused');
  if (ruleItems === W.RIG.length) fail('every passive is a rule — the numeric baseline they read against is gone');
  /*
   * A NOTE THAT DOES NOT FIT THE CARD IS NOT A DESCRIBED CHANGE.
   *
   * The assertion above only asks that a note is non-empty, and that was enough
   * while every passive was a multiplier -- "+12% damage" has nothing to lose.
   * The rig now installs RULES and their notes are sentences, and the level-up
   * card rendered COMPRESSOR as
   *
   *     one more shield -- and every hit you take blows a ring back out of you
   *     that hurts wha...
   *
   * dropping exactly the clause that says what the item does. The card wraps to
   * two lines now, but four notes were long enough to overrun BOTH (144, 134,
   * 134 and 133 characters) and were trimmed. Nothing stopped them being written
   * that long, and nothing would stop the next one.
   *
   * The budget is derived from the drawn geometry rather than guessed: the note
   * box is `sw - 96` at 13px ui-monospace, whose advance is almost exactly 0.6em,
   * over two lines. It is deliberately a CHARACTER budget and not a pixel
   * measurement, because this check must run without a canvas -- so it carries a
   * small safety margin and the real backstop stays the ellipsis in the
   * renderer. What it catches is the case that matters: prose written at
   * paragraph length for a space that holds a sentence.
   */
  {
    const CARD_W = 610;            // narrowest card drawn by LevelUpOverlay
    const PER_CHAR = 13 * 0.6;     // 13px ui-monospace advance
    const BUDGET = Math.floor(((CARD_W - 96) / PER_CHAR) * 2);
    let longest = 0;
    let longestId = '';
    let checked = 0;
    for (const d of W.INSTRUMENTS) {
      for (const st of d.steps ?? []) {
        if (!st.note) continue;
        checked++;
        if (st.note.length > longest) { longest = st.note.length; longestId = d.id; }
        if (st.note.length > BUDGET) fail(`${d.id} note is ${st.note.length} chars, over the ${BUDGET} the card can draw`);
      }
    }
    for (const d of W.RIG) {
      for (const n of d.notes ?? []) {
        if (!n) continue;
        checked++;
        if (n.length > longest) { longest = n.length; longestId = d.id; }
        if (n.length > BUDGET) fail(`${d.id} note is ${n.length} chars, over the ${BUDGET} the card can draw`);
      }
    }
    if (checked === 0) fail('no notes were measured against the card width — this check proved nothing');
    console.log(`  ${checked} notes measured against a ${BUDGET}-char card; longest ${longest} (${longestId})`);
  }

  if (failures === 0) pass('every level of every ability has a described, non-empty change that fits its card');

  /*
   * The rule fold has to be order-independent for the same reason the modifier
   * fold does, and it is checked the same way. Two passives are two behaviours;
   * if the order they were taken in changes what the rig does, the system is
   * lying to the player about their build.
   */
  {
    const ids = W.RIG.map((d) => d.id);
    const owned = {};
    for (const id of ids) owned[id] = 1 + (ids.indexOf(id) % W.RIG_MAX_LEVEL);
    const a = W.rigRules(owned);
    const shuffled = {};
    for (const id of [...ids].reverse()) shuffled[id] = owned[id];
    const b = W.rigRules(shuffled);
    let ok = true;
    for (const k of Object.keys(a)) if (Math.abs(a[k] - b[k]) > 1e-9) ok = false;
    if (!ok) fail('rigRules depends on the order items were taken');
    else pass('rule folding is order-independent');
  }

  // Every ability carries a musical character, because the audio side reads it.
  for (const d of [...W.INSTRUMENTS, ...W.RIG]) {
    if (!d.character || !d.character.includes('—')) fail(`${d.id} has no musical character phrase`);
  }
  if (failures === 0) pass('every ability names its musical character');
}

/* --------------------------------------------------- 2. folding is sensible */

console.log('\nFOLDING');

{
  // A stat block must not degrade as an instrument levels. This catches a
  // mistyped multiplier, which is otherwise invisible until someone plays it.
  for (const d of W.INSTRUMENTS.filter((x) => !x.fused)) {
    let prev = W.instrumentStats(d.id, 1);
    let dpsPrev = (prev.damage * prev.count) / prev.interval;
    for (let lvl = 2; lvl <= W.INSTRUMENT_MAX_LEVEL; lvl++) {
      const s = W.instrumentStats(d.id, lvl);
      const dps = (s.damage * s.count) / s.interval;
      if (dps < dpsPrev - 1e-9) fail(`${d.id} L${lvl} is weaker than L${lvl - 1} (${dpsPrev.toFixed(1)} -> ${dps.toFixed(1)})`);
      prev = s;
      dpsPrev = dps;
    }
  }
  pass('no instrument gets worse when it levels');

  // Rig folding must not depend on pickup order. Two passives are two numbers;
  // if the order they were taken in changes the result, the system is lying to
  // the player about what their build does.
  const ids = W.RIG.map((d) => d.id);
  const owned = {};
  for (const id of ids) owned[id] = 1 + (ids.indexOf(id) % W.RIG_MAX_LEVEL);
  const a = W.rigModifiers(owned);
  const shuffled = {};
  for (const id of [...ids].reverse()) shuffled[id] = owned[id];
  const b = W.rigModifiers(shuffled);
  let orderOk = true;
  for (const k of Object.keys(a)) if (Math.abs(a[k] - b[k]) > 1e-9) orderOk = false;
  if (!orderOk) fail('rigModifiers depends on the order items were taken');
  else pass('rig folding is order-independent');

  const full = W.rigModifiers(Object.fromEntries(ids.map((id) => [id, W.RIG_MAX_LEVEL])));
  console.log(
    `  all 12 rig items maxed: dmg x${full.damage.toFixed(2)}  cd x${full.cooldown.toFixed(2)}  area x${full.area.toFixed(2)}` +
      `  +${full.count} shots  xp x${full.xpGain.toFixed(2)}  enemies x${full.enemyTime.toFixed(2)}`,
  );
}

/* -------------------------------------------------- 3. offers are always legal */

console.log('\nOFFER LEGALITY');

{
  const rand = mulberry(0xc0ffee);
  const instIds = W.INSTRUMENTS.filter((d) => !d.fused).map((d) => d.id);
  const fusedIds = new Set(W.INSTRUMENTS.filter((d) => d.fused).map((d) => d.id));
  const rigIds = W.RIG.map((d) => d.id);

  let offers = 0;
  let cards = 0;
  const bad = new Map();
  const note = (why) => bad.set(why, (bad.get(why) ?? 0) + 1);

  for (let i = 0; i < 60000; i++) {
    const s = P.createProgression((rand() * 1e9) | 0);
    /*
     * Deliberately awkward: books anywhere from empty to entirely maxed, and a
     * banish list. Slot counts are FIXED now (4 stand / 3 rig, no boss growth),
     * so there is no range to sample — but the exhaustive check still explores
     * every fill level from empty to full below, which is where the offer
     * generator actually gets into trouble.
     */
    s.instrumentSlots = P.STAND_SLOTS;
    s.rigSlots = P.RIG_SLOTS;
    for (const k of Object.keys(s.instruments)) delete s.instruments[k];
    const nInst = (rand() * (s.instrumentSlots + 1)) | 0;
    for (const id of shuffle(instIds.slice(), rand).slice(0, nInst)) {
      s.instruments[id] = 1 + ((rand() * W.INSTRUMENT_MAX_LEVEL) | 0);
    }
    const nRig = (rand() * (s.rigSlots + 1)) | 0;
    for (const id of shuffle(rigIds.slice(), rand).slice(0, nRig)) {
      s.rig[id] = 1 + ((rand() * W.RIG_MAX_LEVEL) | 0);
    }
    if (rand() < 0.35) s.banished.push(...shuffle([...instIds, ...rigIds], rand).slice(0, 1 + ((rand() * 4) | 0)));
    // Occasionally hand it a loadout that is already entirely finished.
    if (rand() < 0.05) {
      for (const id of instIds.slice(0, s.instrumentSlots)) s.instruments[id] = W.INSTRUMENT_MAX_LEVEL;
      for (const id of rigIds.slice(0, s.rigSlots)) s.rig[id] = W.RIG_MAX_LEVEL;
    }

    s.pending = 1;
    const offer = P.openOffer(s);
    offers++;
    if (!offer) {
      note('openOffer returned null with a level pending');
      continue;
    }
    if (offer.options.length !== P.OFFER_SIZE) note(`offer had ${offer.options.length} cards, want ${P.OFFER_SIZE}`);

    const seen = new Set();
    const instHeld = Object.keys(s.instruments).length;
    const rigHeld = Object.keys(s.rig).length;
    for (const o of offer.options) {
      cards++;
      if (o.grace) {
        if (o.id !== null) note('a grace card carried an ability id');
        continue;
      }
      if (o.id === null) note('a non-grace card had no id');
      if (seen.has(o.id)) note('the same ability appeared twice in one offer');
      seen.add(o.id);
      /*
       * A FUSION CARD IS NOW THE POINT, not a leak.
       *
       * This used to assert that a fused id could never appear on the level-up
       * screen, because fusions resolved by themselves on boss defeat. They do
       * not any more: a ready fusion is offered as a card and taking it costs
       * the pick, which is what turns the most interesting event in the
       * progression system from something that happens TO the player into
       * something they do. `o.fusion` is set only on those cards.
       *
       * What is still worth asserting is that a fused id never appears as an
       * ordinary level-up card.
       */
      if (fusedIds.has(o.id) && !o.fusion) note('a fusion was offered as an ordinary card');
      if (o.fusion) {
        if (o.fusion.result !== o.id) note('a fusion card disagreed with its own recipe');
        /*
         * A fusion card must advertise its CEILING, not 1.
         *
         * `applyFusion` seats a result at `maxLevelOf` because an evolved
         * instrument is earned rather than drafted and can never be levelled
         * afterwards. This used to assert 1 and was right to, back when 1 was
         * what the state received; once the seating changed, the card was
         * drawing a single notehead of three for something that arrives
         * finished. Asserting the ceiling keeps the two ends pinned together
         * rather than merely allowing whatever they happen to say.
         */
        if (o.level !== W.maxLevelOf(o.id)) {
          note(`a fusion card offered level ${o.level}, not its ceiling of ${W.maxLevelOf(o.id)}`);
        }
        continue;
      }
      if (s.banished.includes(o.id)) note('a banished ability was offered');
      const max = W.maxLevelOf(o.id);
      const held = o.slot === 'instrument' ? (s.instruments[o.id] ?? 0) : (s.rig[o.id] ?? 0);
      if (held >= max) note('an already-maxed ability was offered');
      if (o.level !== held + 1) note('a card offered a level that is not the next one');
      if (o.level > max) note('a card offered a level past the ceiling');
      if (o.isNew !== (held === 0)) note('isNew disagreed with what is held');
      // A fusion card is exempt: it replaces its base in place, so the stand
      // count does not rise and a full stage is no obstacle. It is filtered out
      // above, so anything reaching here is an ordinary draft card.
      if (o.isNew && o.slot === 'instrument' && instHeld >= s.instrumentSlots) {
        note('a new instrument was offered with no slot free');
      }
      /*
       * A SWAP is the one legal way past a full rig, and it pays for itself.
       *
       * `OfferOption.replaces` names a held passive the card spends to make
       * room, so the count after taking it is unchanged. What must still be
       * impossible is a new rig card arriving with no slot AND no price, and
       * a swap naming something the player does not actually hold — either
       * would let the rig grow past its cap. Both are checked, so this stays a
       * real invariant rather than an exemption.
       */
      if (o.isNew && o.slot === 'rig' && rigHeld >= s.rigSlots) {
        if (!o.replaces) note('a new rig item was offered with no slot free and no swap');
        else if ((s.rig[o.replaces] ?? 0) <= 0) note('a swap card named a passive that is not held');
      }
      if (o.replaces && (o.slot !== 'rig' || !o.isNew)) note('a non-new or non-rig card carried a swap');
      if (!o.note) note('a card had no player-facing note');
    }
  }

  console.log(`  ${offers.toLocaleString()} offers, ${cards.toLocaleString()} cards, states from empty to fully maxed`);
  if (bad.size === 0) pass('no illegal card was ever generated');
  else for (const [why, n] of bad) fail(`${why} (${n}x)`);
}

/* ------------------------------------------------------------- 4. the curve */

console.log('\nXP CURVE');

{
  let prev = 0;
  let monotonic = true;
  for (let n = 1; n <= 60; n++) {
    const c = P.xpToNext(n);
    if (c <= prev) monotonic = false;
    prev = c;
  }
  if (!monotonic) fail('xpToNext is not strictly increasing');
  else pass('each level costs more than the last');

  const row = [5, 10, 15, 20, 25, 30, 35, 40]
    .map((l) => `L${l} ${P.xpToReach(l)}`)
    .join('   ');
  console.log(`  cumulative XP:  ${row}`);
  console.log(
    `  a kill is worth: pluck(16hp) ${P.xpForKill(16, false)}   mid(34hp) ${P.xpForKill(34, false)}` +
      `   heavy(72hp) ${P.xpForKill(72, false)}   boss ${P.xpForKill(900, true)}`,
  );
}

/* ------------------------------------------------------- the run simulation */

/**
 * A run, in one-second ticks.
 *
 * THE KILL MODEL IS NOW MEASURED RATHER THAN ASSUMED, and that is the whole
 * change to this file.
 *
 * It used to approximate the numbers in tools/README.md — a five-minute run
 * reaching wave 8 with a few dozen kills — and it said so, and it warned that
 * the arena conversion was going to move all of it. It did: `node
 * tools/arena.mjs 8 4` runs the real `World` headless and reports 29 kills in
 * the first minute rising past 60 by the eighth, against enemies whose hp
 * scales with the run to keep pace with a six-instrument ensemble. That is
 * roughly four times the income this model used to assume, in both terms.
 *
 * The three income levels stay. A measurement of a bot is not a measurement of
 * a player, the bot's own policy moves the number by a factor of five between
 * a good build and a bad one, and a single point estimate would read as more
 * certain than it is.
 */
function simulateRun({ seed, minutes, income, policy, watchLastCard = false, censusAtMinute = 0 }) {
  const s = P.createProgression(seed);
  const rand = mulberry(seed ^ 0x5bf03635);
  let killFraction = 0;
  let wave = 1;
  let bossesDue = 0;
  const marks = {};
  let firstFusionAt = null;
  let violations = 0;
  /* Offers where card 0 could not be taken. See the note at the probe below. */
  let unresolvable = 0;
  const lastCard = { chances: 0, drawn: 0, worstWait: 0 };
  let wait = 0;
  let census = null;

  for (let t = 0; t < minutes * 60; t++) {
    const nextWave = 1 + Math.floor(t / 22);
    if (nextWave > wave) {
      for (let w = wave + 1; w <= nextWave; w++) if (w % 8 === 0) bossesDue++;
      wave = nextWave;
    }

    // Both fitted to `tools/arena.mjs`: mob hp on the field runs 50-140 across
    // the waves a run reaches, and kills run 0.48/s at the start rising to
    // about 1.1/s by the eighth minute.
    const hp = 20 + 6 * wave;
    killFraction += income * (0.48 + 0.62 * Math.min(1, t / 480));
    while (killFraction >= 1) {
      killFraction -= 1;
      // Not every shard is collected. MAGNET is what closes the gap, which is
      // the whole reason a pickup-radius passive is interesting.
      const reach = P.modifiers(s).pickupRadius;
      const collected = Math.min(1, 0.78 + 0.22 * Math.min(1, (reach - 1) / 4));
      if (rand() < collected) P.grantXp(s, P.xpForKill(hp, false));
    }

    if (bossesDue > 0 && t % 22 === 10) {
      bossesDue--;
      P.grantXp(s, P.xpForKill(900, true));
      const reward = P.onBossDefeated(s);
      if (reward.fusions.length && firstFusionAt === null) firstFusionAt = t;
    }

    // Spend every queued level-up. The world opens these on a bar line; the
    // simulation does not model bar lines because they cannot change the
    // outcome, only when it lands.
    let guard = 0;
    while (s.pending > 0 && guard++ < 50) {
      // Asked *before* the draw: was the completing card in the pool at all?
      // Comparing against the pool rather than against hindsight is what makes
      // this a measurement of the draw and not of the build.
      const inPool = watchLastCard && P.availableOptions(s).some((o) => o.completes);
      const offer = P.openOffer(s);
      if (!offer) break;
      if (inPool) {
        lastCard.chances++;
        if (offer.options.some((o) => o.completes)) {
          lastCard.drawn++;
          wait = 0;
        } else {
          wait++;
          lastCard.worstWait = Math.max(lastCard.worstWait, wait);
        }
      }
      /*
       * CARD 0 MUST ALWAYS BE TAKEABLE, and something real depends on it.
       *
       * `world.ts` leans on this by name: its offer timeout picks card 0 as a
       * backstop because "card 0 is a legal pick in every state the offer
       * generator can produce, so it can never leave a level unspent". If that
       * stops being true the world can sit frozen on an offer it cannot
       * resolve — a hang, not a mis-scored card. The claim was checked by hand
       * over 600 generated offers and held; this keeps it checked.
       *
       * Verified on a CLONE so the policy under test still gets the real
       * choice. Cloning `offer` too, because `chooseOption` closes it.
       */
      const probe = { ...s, instruments: { ...s.instruments }, rig: { ...s.rig }, fusions: [...s.fusions], offer };
      if (!P.chooseOption(probe, 0).ok) unresolvable++;

      const idx = policy(offer, s, rand);
      P.chooseOption(s, idx);
    }

    if (Object.keys(s.instruments).length > s.instrumentSlots) violations++;
    if (Object.keys(s.rig).length > s.rigSlots) violations++;
    for (const [id, lvl] of Object.entries({ ...s.instruments, ...s.rig })) {
      if (lvl > W.maxLevelOf(id)) violations++;
    }

    const min = (t + 1) / 60;
    if (Number.isInteger(min)) marks[min] = s.level;
    if (censusAtMinute && min === censusAtMinute) census = loadoutCensus(s);
  }

  return {
    state: s,
    level: s.level,
    fusions: s.fusions.slice(),
    firstFusionAt,
    marks,
    violations,
    unresolvable,
    lastCard,
    census,
    maxedInstruments: Object.entries(s.instruments).filter(([id, l]) => l >= W.maxLevelOf(id)).length,
  };
}

/**
 * What the band actually looks like at a moment in time.
 *
 * `hits` is the number that matters to the mix: activations per second times
 * projectiles per activation, i.e. how many note events an instrument would
 * demand if every one of its hits were voiced 1:1. It is not the same question
 * as "how many instruments are held", and it is the one the arrangement's voice
 * budget is actually spent against — six pods firing every 0.34s is not one
 * lane, it is seventeen events a second.
 */
function loadoutCensus(s) {
  const mods = P.modifiers(s);
  const held = [];
  for (const [id, level] of Object.entries(s.instruments)) {
    const def = W.instrumentDef(id);
    if (!def) continue;
    const st = W.applyModifiers(W.instrumentStats(id, level), mods);
    held.push({
      id,
      level,
      shape: def.shape,
      fused: !!def.fused,
      rate: 1 / Math.max(0.01, st.interval),
      hits: (st.count * 1) / Math.max(0.01, st.interval),
    });
  }
  held.sort((a, b) => b.hits - a.hits);
  return { instruments: held, rig: Object.entries(s.rig).map(([id, level]) => ({ id, level })) };
}

const POLICIES = {
  /** Picks at random. The floor: what a player who is not paying attention gets. */
  random: (offer, _s, rand) => (rand() * offer.options.length) | 0,

  /**
   * Builds toward one instrument and its catalyst.
   *
   * Not an optimal player — an ordinary one who has decided what they are doing.
   * It fills the band first, then mains whatever it happens to hold most of,
   * which is how anyone plays a run-based game once they know the table.
   */
  builder: (offer, s) => {
    const held = Object.entries(s.instruments).filter(([id]) => !W.instrumentDef(id)?.fused);
    held.sort((a, b) => b[1] - a[1]);
    const target = held[0]?.[0] ?? null;
    const recipe = W.FUSIONS.find((f) => f.kind === 'evolution' && f.base === target);
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
  },
};

function sweep({ minutes, income, policy, runs, seed0 = 1000 }) {
  const out = { levels: [], fusions: 0, anyFusion: 0, unions: 0, violations: 0, maxed: 0, marks: {} };
  for (let i = 0; i < runs; i++) {
    const r = simulateRun({ seed: seed0 + i, minutes, income, policy: POLICIES[policy] });
    out.levels.push(r.level);
    out.fusions += r.fusions.length;
    if (r.fusions.length > 0) out.anyFusion++;
    out.unions += r.fusions.filter((f) => f === 'requiem' || f === 'stringsection').length;
    out.violations += r.violations;
    out.maxed += r.maxedInstruments;
    for (const [m, lvl] of Object.entries(r.marks)) (out.marks[m] ??= []).push(lvl);
  }
  out.levels.sort((a, b) => a - b);
  return out;
}

const median = (xs) => xs[Math.floor(xs.length / 2)];

/* --------------------------------------------------------- 5. level pacing */

console.log('\nLEVEL PACING  (median level at elapsed minutes, 240 runs each)');

const INCOMES = [
  ['lean  ', 0.7],
  ['as-is ', 1.0],
  ['rich  ', 1.4],
];
const MARKS = [1, 2, 3, 5, 8, 10, 15];

let pacingRef = null;
for (const [name, income] of INCOMES) {
  const r = sweep({ minutes: 15, income, policy: 'builder', runs: 240 });
  if (income === 1.0) pacingRef = r;
  const cells = MARKS.map((m) => `${m}m L${median(r.marks[m].slice().sort((a, b) => a - b))}`.padEnd(8)).join('');
  console.log(`  ${name} ${cells}`);
}

{
  const l5 = median(pacingRef.marks[5].slice().sort((a, b) => a - b));
  const l15 = median(pacingRef.marks[15].slice().sort((a, b) => a - b));
  // A wide band on purpose. The income model is an approximation and the arena
  // conversion will move it; this gate exists to catch a curve that is broken
  // by an order of magnitude, not to pin a number the model cannot support.
  if (l5 < 8 || l5 > 26) fail(`5-minute run reaches L${l5}; want 8-26 (10-16 choices is the design target)`);
  else pass(`a 5-minute run reaches L${l5} — ${l5 - 1} choices made`);
  if (l15 < 20 || l15 > 55) fail(`15-minute run reaches L${l15}; want 20-55`);
  else pass(`a 15-minute run reaches L${l15}`);
}

/* ------------------------------------------------------ 6. reaching a fusion */

console.log('\nFUSION REACHABILITY  (240 runs each)');

const table = [];
for (const [name, income] of INCOMES) {
  for (const policy of ['builder', 'random']) {
    const r = sweep({ minutes: 15, income, policy, runs: 240 });
    table.push({ name: name.trim(), policy, r });
    console.log(
      `  ${name} ${policy.padEnd(8)} any fusion ${String(Math.round((r.anyFusion / 240) * 100)).padStart(3)}%` +
        `   fusions/run ${(r.fusions / 240).toFixed(2)}   maxed instruments/run ${(r.maxed / 240).toFixed(2)}` +
        `   unions ${r.unions}`,
    );
  }
}

{
  const builderAsIs = table.find((t) => t.name === 'as-is' && t.policy === 'builder').r;
  const randomAsIs = table.find((t) => t.name === 'as-is' && t.policy === 'random').r;
  const rate = builderAsIs.anyFusion / 240;
  if (rate < 0.55) fail(`a player building toward a fusion reaches one in only ${Math.round(rate * 100)}% of runs`);
  else pass(`a player who is building reaches a fusion in ${Math.round(rate * 100)}% of runs`);
  /*
   * THE RATE, NOT THE BINARY — and the reason is that the binary saturates.
   *
   * This used to fail when a random picker reached ANY fusion in more than 50%
   * of runs. That was a good test at 6+6 slots, where picks spread thin across
   * twelve ids and maxing a pair by accident was genuinely unlikely. At 4 stand
   * slots every policy concentrates its levels, so "did you ever fuse once"
   * approaches 100% for everyone and stops separating anything. It will
   * saturate further under DUET, where any two maxed instruments combine.
   *
   * What still separates a player who is building from one who is not is HOW
   * OFTEN they fuse. Measured with fusion as a card the player must choose:
   * builder 1.55 fusions per run against random 0.61, a 2.5x gap. The binary is
   * still printed above because it is worth seeing; the gate is on the ratio.
   *
   * Care taken not to simply weaken this: the previous threshold was failing at
   * 53% against a 50% bar, which is close enough that relaxing the number would
   * have been the easy and wrong move. The metric is replaced because it stopped
   * discriminating, not because it stopped passing.
   */
  const rrate = randomAsIs.anyFusion / 240;
  const bPer = builderAsIs.fusions / 240;
  const rPer = randomAsIs.fusions / 240;
  const gap = rPer > 0 ? bPer / rPer : Infinity;
  console.log(`  fusions/run: builder ${bPer.toFixed(2)} vs random ${rPer.toFixed(2)} — ${gap.toFixed(1)}x`);
  /*
   * A WARNING ABOUT THIS WHOLE SECTION'S INCOME MODEL.
   *
   * These sweeps grant XP from a synthetic income curve, not from a real
   * `World`. Measured against an actual playthrough on 2026-08-23 the two
   * disagree wildly: this model has a random picker reaching a fusion in 97%
   * of runs, while a real 480s run produced ZERO fusion cards across 26 offers
   * and a real 900s run produced one across 45. Base instruments max at level
   * 8, and reaching two maxed instruments inside a run is far harder than the
   * model thinks.
   *
   * So treat the ratio below as a statement about REACHABILITY IN PRINCIPLE.
   * `tools/builds.mjs` measures what a real run does, and its `fuser` and
   * `refuser` policies currently return identical numbers to `first` — which
   * is the honest signal that combining almost never comes up in play.
   */
  /*
   * NOT A GATE ANY MORE, and the reason is the warning directly above rather
   * than the number below it.
   *
   * This ratio is computed on the synthetic income curve, and that model is
   * documented here as disagreeing with a real playthrough by a wide margin —
   * it has a random picker fusing in 97% of runs where a real 480s run produced
   * zero fusion cards in 26 offers. A gate is only worth as much as its model,
   * and failing the build on a simulation we have already written down as wrong
   * teaches nothing except to stop reading the output.
   *
   * `tools/combine.mjs` now asks the same question of the real `World`: it runs
   * a policy that commits to one recipe and spends every pick on it against one
   * that never chooses a fusion, and counts DESIGNED recipes only, since a duet
   * is available to anyone who levels two instruments and cannot show intent.
   * Measured there, committing pays 2.2x. That is the gate; this stays as a
   * cross-check, because a large gap between the two is itself informative.
   */
  console.log(`  (model-based; the real-run ratio is gated in tools/combine.mjs — run \`npm run combine\`)`);
  if (rrate > 0.999) {
    console.log('  NOTE: this model has a random picker fusing in ~100% of runs, which is the');
    console.log('        clearest sign it is not describing play. See the warning above.');
  }
  const violations = table.reduce((a, t) => a + t.r.violations, 0);
  if (violations > 0) fail(`${violations} slot or level-ceiling violations during simulated play`);
  else pass('no slot or ceiling was ever exceeded across every simulated run');
  /*
   * CARD 0 MUST ALWAYS BE TAKEABLE — a hang, not a mis-scored card.
   *
   * `world.ts`'s offer timeout picks card 0 as its backstop, by name: "card 0
   * is a legal pick in every state the offer generator can produce, so it can
   * never leave a level unspent". If that stops holding, the world sits frozen
   * on an offer it cannot resolve.
   *
   * BE HONEST ABOUT WHAT THIS CAN CATCH. In THIS harness it is nearly
   * unreachable: the policies above pick index 0 often, so any break of card 0
   * stalls the simulation before this line is ever printed — both a total
   * break and two partial ones (grace-only, rig-only) were tried and all three
   * timed out rather than reporting. The real detector is that hang, and the
   * runner's per-tool timeout is what surfaces it.
   *
   * It is kept because it costs one clone per offer and it is the only thing
   * that would catch the case the hang cannot: a policy set that never picks 0
   * while card 0 is quietly illegal. It is a belt, not the braces. Do not read
   * a passing line here as proof the invariant was exercised.
   */
  const unresolved = table.reduce((a, t) => a + (t.r.unresolvable ?? 0), 0);
  if (unresolved > 0) {
    fail(`card 0 was not a legal pick in ${unresolved} offer(s) — the world's offer timeout could not resolve them`);
  } else {
    pass("card 0 was takeable in every offer sampled (see the caveat in the source)");
  }
}

/* ---------------------------------------------- 7. is the bias earning its keep */

/*
 * Each term of OFFER_TUNING, switched off against the same seeds.
 *
 * This is a control, so it reports rather than asserts: if a term turns out to
 * do nothing the right response is to delete it, and that is a judgement.
 *
 * It has already made one such call. A general `focus` multiplier on anything
 * already held used to sit alongside these, and this table is what killed it —
 * removing it *raised* the fusion rate, because weighting everything in the
 * loadout equally crowded out the specific card the player was waiting for.
 */
console.log('\nBIAS ABLATION  (same seeds, one term switched off at a time)');

{
  const before = { ...P.OFFER_TUNING };
  const variants = [
    ['as written    ', {}],
    ['no catalyst   ', { catalyst: 1 }],
    ['no completes  ', { completes: 1 }],
    ['flat          ', { catalyst: 1, completes: 1 }],
  ];
  for (const [name, patch] of variants) {
    Object.assign(P.OFFER_TUNING, before, patch);
    const b = sweep({ minutes: 15, income: 1.0, policy: 'builder', runs: 240 });
    const r = sweep({ minutes: 15, income: 1.0, policy: 'random', runs: 240 });
    console.log(
      `  ${name} builder any ${String(Math.round((b.anyFusion / 240) * 100)).padStart(3)}%  fus ${(b.fusions / 240).toFixed(2)}` +
        `  maxed ${(b.maxed / 240).toFixed(2)}   |   random any ${String(Math.round((r.anyFusion / 240) * 100)).padStart(3)}%`,
    );
  }
  Object.assign(P.OFFER_TUNING, before);
}

/*
 * The tail the aggregate cannot see.
 *
 * `completes` moves the fusion rate by nothing measurable, which by this
 * directory's own standard would make it a threshold sitting in its own noise.
 * It survives because the number it was written to move is not that one: it is
 * how long a player who is *one card away* has to wait. A build that stalls for
 * ten level-ups holding the last card back does not read as variance, it reads
 * as the game refusing, and no run-length average will ever show it.
 */
console.log('\nTHE LAST CARD  (offers presented while one card from a fusion, 240 runs)');

{
  const before = { ...P.OFFER_TUNING };
  for (const [name, patch] of [
    ['as written  ', {}],
    ['no completes', { completes: 1 }],
  ]) {
    Object.assign(P.OFFER_TUNING, before, patch);
    let chances = 0;
    let drawn = 0;
    let worst = 0;
    for (let i = 0; i < 240; i++) {
      const r = simulateRun({ seed: 1000 + i, minutes: 15, income: 1.0, policy: POLICIES.builder, watchLastCard: true });
      chances += r.lastCard.chances;
      drawn += r.lastCard.drawn;
      worst = Math.max(worst, r.lastCard.worstWait);
    }
    const pct = chances === 0 ? 0 : Math.round((drawn / chances) * 100);
    console.log(`  ${name}  the needed card was among the four ${String(pct).padStart(3)}% of the time   worst wait ${worst} offers`);
    if (patch.completes === undefined) {
      if (pct < 70) fail(`a player one card from a fusion only sees it ${pct}% of the time`);
      else if (worst > 8) fail(`a player one card from a fusion waited ${worst} level-ups for it`);
      else pass(`one card away is seen ${pct}% of the time, never waiting more than ${worst} offers`);
    }
  }
  Object.assign(P.OFFER_TUNING, before);
}

/* -------------------------------------------------------------- 8. verdict */

console.log('');
if (failures === 0) console.log('PROGRESSION OK');
else console.log(`PROGRESSION: ${failures} failure${failures === 1 ? '' : 's'}`);
process.exit(failures === 0 ? 0 : 1);

/* ------------------------------------------------------------------ helpers */

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(xs, rand) {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
