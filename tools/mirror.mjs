/*
 * mirror — the HUD's fusion logic must agree with the game's.
 *
 * `progression.ts` decides what can actually be combined; `render/levelup.ts`
 * carries a SECOND copy of that decision, because the HUD is handed a flat
 * `abilities` record rather than a `ProgressionState` and cannot call the real
 * one. Two implementations of the same rule is a standing invitation to drift,
 * and it has already been accepted once: when the game learned to combine only
 * within a tier — two base instruments, or two evolved ones, never a mix — the
 * render copy did not, and the panel announced READY TO COMBINE for pairs the
 * offer could never contain. Nothing failed. Every gate stayed green.
 *
 * A banner that promises a card the game cannot deal is worse than no banner:
 * the player builds toward it, waits for it, and it never comes.
 *
 * So this enumerates loadouts — including the evolved instruments that only
 * became reachable once fusion results seated at their ceiling — and asserts
 * the two agree on every one, by result id AND by kind. It is deterministic:
 * a seeded generator, so a failure reproduces exactly.
 */
const L = await import('./lib/headless-audio.mjs');
const P = await import('../src/game/progression.ts');
const R = await import('../src/render/levelup.ts');
const W = await import('../src/game/weapons.ts');

const BASE = W.INSTRUMENTS.filter((d) => !d.fused).map((d) => d.id);
const EVOLVED = W.INSTRUMENTS.filter((d) => d.fused).map((d) => d.id);
const RIG = W.RIG.map((d) => d.id);

/** Seeded LCG — a mirror test that cannot be reproduced is not much of a test. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function stateFor(rand) {
  const instruments = {};
  const rig = {};
  /*
   * Deliberately NOT slot-limited. The mirror must agree on every state the
   * two functions could ever be handed, and the render copy sees a snapshot it
   * does not police. Over-generating states is free; missing the one that
   * diverges is the whole failure mode.
   */
  const nBase = Math.floor(rand() * 5);
  const nEvo = Math.floor(rand() * 4);
  const nRig = Math.floor(rand() * 4);
  for (let i = 0; i < nBase; i++) {
    const id = BASE[Math.floor(rand() * BASE.length)];
    instruments[id] = 1 + Math.floor(rand() * W.INSTRUMENT_MAX_LEVEL);
  }
  for (let i = 0; i < nEvo; i++) {
    const id = EVOLVED[Math.floor(rand() * EVOLVED.length)];
    instruments[id] = 1 + Math.floor(rand() * W.maxLevelOf(id));
  }
  for (let i = 0; i < nRig; i++) {
    const id = RIG[Math.floor(rand() * RIG.length)];
    rig[id] = 1 + Math.floor(rand() * W.RIG_MAX_LEVEL);
  }
  return { instruments, rig };
}

const key = (id, kind) => `${kind}:${id}`;

let checked = 0, bad = 0;
const examples = [];
for (let seed = 1; seed <= 4000; seed++) {
  const rand = rng(seed);
  const st = stateFor(rand);
  const game = new Set([
    ...P.readyFusions(st).map((f) => key(f.result, f.kind)),
    ...P.readyDuets(st).map((f) => key(f.result, f.kind)),
  ]);
  const hud = new Set(R.readyFusions(P.abilityLevels(st)).map((f) => key(f.to, f.kind)));
  checked++;
  const onlyGame = [...game].filter((k) => !hud.has(k));
  const onlyHud = [...hud].filter((k) => !game.has(k));
  if (onlyGame.length || onlyHud.length) {
    bad++;
    if (examples.length < 4) {
      examples.push({ seed, st, onlyGame, onlyHud });
    }
  }
}

console.log('\nmirror — does the HUD promise what the game can deal?\n');
console.log(`  ${checked} loadouts checked, ${bad} disagreed`);
for (const e of examples) {
  console.log(`\n  seed ${e.seed}`);
  console.log(`    instruments ${JSON.stringify(e.st.instruments)}`);
  console.log(`    rig         ${JSON.stringify(e.st.rig)}`);
  if (e.onlyGame.length) console.log(`    game offers, HUD silent:   ${e.onlyGame.join(', ')}`);
  if (e.onlyHud.length) console.log(`    HUD promises, game cannot: ${e.onlyHud.join(', ')}`);
}
/*
 * THE SECOND HALF: is "ONE STEP AWAY" telling the truth?
 *
 * `pendingFusions` is the line that decides where the next two minutes of
 * picks go, so a wrong entry does not merely mislead — it spends the run. The
 * check is the strongest one available: take what the panel says is pending,
 * PAY exactly what it asks for, and require that the game then actually offers
 * that combination. A promise the player can fulfil and still not receive is
 * the failure this catches.
 */
const RIG_SET = new Set(RIG);
const place = (st, id, level) => {
  const book = RIG_SET.has(id) ? st.rig : st.instruments;
  if ((book[id] ?? 0) < level) book[id] = level;
};

let pChecked = 0, pBad = 0;
const pExamples = [];
for (let seed = 1; seed <= 4000; seed++) {
  const st = stateFor(rng(seed));
  for (const p of R.pendingFusions(P.abilityLevels(st))) {
    // Pay the price this entry names, by raising its inputs to what the rule
    // requires — derived from the ids, never parsed back out of the label.
    const paid = { instruments: { ...st.instruments }, rig: { ...st.rig } };
    const kids = W.duetParents(p.to);
    if (kids) {
      for (const k of kids) place(paid, k, Math.min(W.DUET_INPUT_LEVEL, W.maxLevelOf(k)));
    } else {
      const f = W.FUSIONS.find((x) => x.result === p.to);
      if (!f) continue;
      const want = (id) => (f.kind === 'union' ? 1 : W.maxLevelOf(id));
      place(paid, f.base, want(f.base));
      place(paid, f.catalyst, want(f.catalyst));
    }
    const now = new Set([
      ...P.readyFusions(paid).map((f) => f.result),
      ...P.readyDuets(paid).map((f) => f.result),
    ]);
    pChecked++;
    if (!now.has(p.to)) {
      pBad++;
      if (pExamples.length < 4) pExamples.push({ seed, to: p.to, needs: p.needs, st });
    }
  }
}

console.log(`\n  ${pChecked} "one step away" promises checked, ${pBad} could not be fulfilled`);
for (const e of pExamples) {
  console.log(`    seed ${e.seed}: panel says ${e.to} needs "${e.needs}" — paying it does not make it available`);
  console.log(`      instruments ${JSON.stringify(e.st.instruments)}  rig ${JSON.stringify(e.st.rig)}`);
}

/*
 * THE THIRD CHECK: the pause screen's WORKBENCH, which is what a player
 * actually reads when planning.
 *
 * `combinationPlan` composes the two functions above, and composing correct
 * parts is not the same as being correct — the plan de-duplicates, tags a
 * tier, and sorts, and any of those can lie on its own. A row marked ready
 * that the game will not deal is the same broken promise as before, just on a
 * different screen.
 */
let planRows = 0, planBad = 0;
const planExamples = [];
for (let seed = 1; seed <= 4000; seed++) {
  const st = stateFor(rng(seed));
  const plan = R.combinationPlan(P.abilityLevels(st));
  const offerable = new Set([
    ...P.readyFusions(st).map((f) => f.result),
    ...P.readyDuets(st).map((f) => f.result),
  ]);
  const seen = new Set();
  const shown = new Set();
  let sawPending = false;
  for (const row of plan) {
    planRows++;
    const fail = (why) => {
      planBad++;
      if (planExamples.length < 5) planExamples.push(`seed ${seed}: ${row.label} (${row.kind}) — ${why}`);
    };
    if (seen.has(row.to)) fail('listed twice');
    seen.add(row.to);
    /*
     * The RENDERED TEXT must be unique, not just the result id.
     *
     * These are two different assertions and the difference is a real bug this
     * check missed. An unknown half-done recipe deliberately names neither its
     * result nor its catalyst — it reads "<BASE> is at its ceiling — something
     * you are not carrying" — so once an instrument has TWO recipes, both rows
     * render the identical sentence while carrying different `to` values
     * (`spiccato` and `snap`). The id check above passes; the player reads the
     * same line twice, and the pause overlay draws only `plan.slice(0, 6)`, so
     * the duplicate can push a real aim off the screen.
     *
     * 11,015 rows passed this check on the day that shipped. What a person sees
     * is the text, so that is what has to be asserted.
     */
    const rendered = `${row.label}|${row.needs}|${row.ready}`;
    if (shown.has(rendered)) fail(`renders identically to another row: "${row.label} — ${row.needs}"`);
    shown.add(rendered);
    // Ready must mean ready.
    if (row.ready && !offerable.has(row.to)) fail('marked ready but the game will not deal it');
    if (!row.ready && offerable.has(row.to)) fail('shown as an aim while already available');
    /*
     * Ready rows must sort above aims, or the pause screen's six-row cut hides
     * a card the player could take right now.
     *
     * This assertion is currently IMPLIED: a ready row has `away: 0` and every
     * aim has at least 1, so ordering by distance alone already satisfies it.
     * Verified by weakening the comparator, which this did not catch. It is
     * kept because it states the property the UI depends on, and the line
     * below is the one with teeth — it pins the `away === 0` precondition that
     * makes the ordering work by accident today. Give a ready row a nonzero
     * distance and the sort breaks silently; this catches that instead.
     */
    if (row.ready && sawPending) fail('a ready row sorted below an aim');
    if (row.ready && row.away !== 0) fail('a ready row has a nonzero distance — the sort no longer holds it first');
    if (!row.ready) sawPending = true;
    if (!row.label || row.label === String(row.to)) fail('no human label');
    /*
     * A HALF-DONE recipe must not spoil itself.
     *
     * The workbench now speaks when a base is maxed and its catalyst is not
     * held, and what it says depends on whether the player has made that
     * arrangement before — named for a known one, deliberately vague for an
     * unknown one. This loop passes NO known set, so every row here is the
     * unknown case and must name neither the result nor the catalyst. Same
     * asymmetry the codex is gated on, and the same easy mistake: a row that
     * says "something you are not carrying" while the label reads SPICCATO has
     * given the game away.
     */
    if (!row.ready && /ceiling/.test(row.label)) {
      const recipe = W.FUSIONS.find((f) => f.result === row.to);
      if (recipe) {
        const secret = [W.labelOf(recipe.result), W.labelOf(recipe.catalyst)];
        for (const word of secret) {
          if (row.label.includes(word) || row.needs.includes(word)) {
            fail(`an undiscovered half-done recipe leaks "${word}"`);
          }
        }
      }
    }
  }
}
console.log(`\n  ${planRows} workbench rows checked, ${planBad} wrong`);
for (const e of planExamples) console.log('    ' + e);

/*
 * THE FOURTH CHECK: does a card deliver the level it advertises?
 *
 * Every option carries a `level` and the card draws it as noteheads on a
 * staff — "how far a thing is from maxing, which is the only number that
 * decides whether an evolution is reachable". So the number has to be the one
 * the player actually receives.
 *
 * It was not, for fusions. `applyFusion` seats a result at `maxLevelOf`
 * because an evolved instrument is earned rather than drafted and can never be
 * levelled afterwards — but the card still said 1, drawing a single notehead
 * for something that arrives finished, and the renderer independently derived
 * the same wrong 1 from a loadout that does not hold the result yet. Two
 * places computing a number nobody checked.
 *
 * Taking the option for real is the only honest test: clone the state, run
 * `chooseOption`, and compare the books against what the card promised.
 */
let lvlChecked = 0, lvlBad = 0;
const lvlExamples = [];
for (let seed = 1; seed <= 1500; seed++) {
  /*
   * A REAL `ProgressionState`, not the two-book stub the checks above use.
   *
   * `availableOptions` reads slots, the banish list and the run's rng, and the
   * stub has none of them — the first version of this check built one anyway
   * and quietly examined ZERO cards while reporting a pass. A count of 0 is
   * printed for exactly that reason: a check that never ran must not look the
   * same as a check that found nothing.
   */
  const st = P.createProgression(seed);
  const seeded = stateFor(rng(seed));
  Object.assign(st.instruments, seeded.instruments);
  Object.assign(st.rig, seeded.rig);
  let opts;
  try { opts = P.availableOptions(st); } catch { continue; }
  for (const opt of opts) {
    if (opt.grace || opt.id === null) continue;
    const clone = { ...st, instruments: { ...st.instruments }, rig: { ...st.rig }, fusions: [...st.fusions] };
    clone.offer = { level: 1, options: [opt], queued: 0, rerollsLeft: 0, banishesLeft: 0 };
    let res;
    try { res = P.chooseOption(clone, 0); } catch { continue; }
    if (!res.ok) continue;
    lvlChecked++;
    const got = (clone.instruments[opt.id] ?? clone.rig[opt.id]) ?? 0;
    if (got !== opt.level) {
      lvlBad++;
      if (lvlExamples.length < 5) {
        lvlExamples.push(`seed ${seed}: ${opt.id}${opt.fusion ? ' (fusion)' : ''} card promised level ${opt.level}, state got ${got}`);
      }
    }
    // A swap must also have actually spent what it named.
    if (opt.replaces && (clone.rig[opt.replaces] ?? 0) !== 0) {
      lvlBad++;
      if (lvlExamples.length < 5) lvlExamples.push(`seed ${seed}: ${opt.id} named ${opt.replaces} as its price and did not spend it`);
    }
  }
}
console.log(`\n  ${lvlChecked} cards taken for real, ${lvlBad} delivered a different level than promised`);
if (lvlChecked === 0) { console.log('    (this check examined nothing — treat as a failure, not a pass)'); lvlBad++; }
for (const e of lvlExamples) console.log('    ' + e);

/*
 * THE FIFTH CHECK: does "↗ X · N more" on a card come true?
 *
 * The level-up card now names what a pick brings closer and how far is left.
 * That is a promise made at the moment of the decision, which makes it the
 * most load-bearing text on the screen — and the easiest to get subtly wrong,
 * because it is computed from a hypothetical loadout rather than a real one.
 *
 * So take the pick for real and re-ask. If a card says a recipe will be N
 * away, then after taking it the recipe must be exactly N away — or ready, if
 * N is 0. A number that is merely in the right direction is not good enough
 * here: the player is using it to decide how many picks to commit.
 */
let towardChecked = 0, towardBad = 0;
const towardExamples = [];
for (let seed = 1; seed <= 2000; seed++) {
  const st = stateFor(rng(seed));
  const ab = P.abilityLevels(st);
  for (const id of Object.keys(ab)) {
    const next = (ab[id] ?? 0) + 1;
    if (next > W.maxLevelOf(id)) continue;
    const claim = R.advancesToward(id, next, ab);
    if (!claim) continue;
    towardChecked++;
    const after = { ...ab, [id]: next };
    const pend = R.pendingFusions(after).find((p) => p.to === claim.to);
    const ready = R.readyFusions(after).some((r) => r.to === claim.to);
    const actual = pend ? pend.away : (ready ? 0 : -1);
    if (actual !== claim.away) {
      towardBad++;
      if (towardExamples.length < 5) {
        towardExamples.push(`seed ${seed}: taking ${id}->${next} claimed ${claim.to} would be ${claim.away} away; it is ${actual < 0 ? 'not reachable at all' : actual}`);
      }
    }
  }
}
console.log(`\n  ${towardChecked} "brings closer" claims checked, ${towardBad} wrong`);
if (towardChecked === 0) { console.log('    (this check examined nothing — treat as a failure, not a pass)'); towardBad++; }
for (const e of towardExamples) console.log('    ' + e);

const ok = bad === 0 && pBad === 0 && planBad === 0 && lvlBad === 0 && towardBad === 0;
console.log(ok
  ? '\n  ok  panel, workbench and offer agree, and every promise can be kept'
  : `\n  FAIL  ${bad} loadouts disagree, ${pBad} promises cannot be kept, ${planBad} workbench rows wrong, ${lvlBad} cards mis-stated their level, ${towardBad} progress claims wrong`);
process.exit(ok ? 0 : 1);
