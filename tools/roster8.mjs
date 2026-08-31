/*
 * roster8 — is the eight-and-eight starting roster legal, complete and honest?
 *
 * `NODE_OPTIONS=--experimental-transform-types node tools/roster8.mjs`
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The meta layer gates the draft pool from thirty instruments
 * and twelve passives down to eight and eight, and almost everything that can
 * go wrong with that gate is SILENT:
 *
 *   - a starter that is not in the base roster leaves the run with no gun and
 *     nothing throws (`resetProgression` falls back to `STARTING_INSTRUMENT`,
 *     which might also be locked)
 *   - an evolution whose catalyst is locked simply never happens; the HUD keeps
 *     saying ONE STEP AWAY at a passive the game will never deal
 *   - an id added to `weapons.ts` and not to either list is undraftable
 *     FOREVER, in both the run and the shop
 *   - the shop's description and the level-up card's description are two
 *     strings, and `src/render/levelup.ts` is a standing monument to what
 *     happens to two copies of one string
 *
 * None of those is a crash, a type error or a red gate anywhere else.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT MEASURE, and the split is deliberate. Nothing here plays the
 * game. Whether stage 1 is WINNABLE with eight weapons, what a run costs in
 * minutes at each depth, and whether the reward curve beats farming are all
 * questions about real runs and they live in `tools/stages.mjs`, which is slow.
 * This file is arithmetic and offer generation, it runs in a couple of seconds,
 * and it is the one to put in a loop.
 *
 * ---------------------------------------------------------------------------
 * THE FAIL-TEST LOG. AGENTS.md §3: a gate never seen red is not evidence, and
 * the unit is the ASSERTION. Every break below was made, RUN, observed, and
 * then undone by the reverse edit. Every figure is one that was printed, not
 * one that was expected.
 *
 *   break                                        assertions it turned RED
 *   ------------------------------------------   ---------------------------
 *   A  BASE_INSTRUMENTS drops `bow`              8+8 (read 7 and 8); every
 *                                                opener is in the base roster
 *                                                (2/3)
 *   B  BASE_RIG swaps `laser` for `magnet`       every base weapon reaches its
 *                                                evolution (6/8); AND four real
 *                                                cards (grace 2.92%)
 *   C  `siphon` swapped for `coda` — a SECOND    eight distinct properties
 *      freeze                                    (7 across 8; freeze shared by
 *                                                chime+coda)
 *   C2 `lockedIds` skips one id, so it is in     base + locked is the whole
 *      neither list                              table (41 of 42, tremolo lost)
 *   D  the INSTRUMENT loop loses its gate        the gate holds (19,706 of
 *                                                27,200 cards legal; leaked
 *                                                rondo coda pizzicato charm...)
 *   D2 the RIG loop loses its gate               the gate holds (24,214 of
 *                                                27,200; leaked magnet homing
 *                                                spread timewarp)
 *   Q  the base roster cut to two ids            four real cards (85.58% of
 *                                                27,200 dealt were grace)
 *   E  `shopRows` uses `blurb` for rig rows      the shop reads the card (22 of
 *                                                26; spread homing magnet
 *                                                timewarp differ)
 *   P  every shop note emptied                   the shop reads the card (0 of
 *                                                26); and none is blank (0/26)
 *   F  `REWARD_SHIFT` set to 0 (bare `s^E`)      no step more than doubles
 *                                                (2.55x at 1 -> 2, set list
 *                                                spans 28.6x)
 *   K1 `stageReward` not normalised at stage 1   stage 1 pays exactly 1x
 *                                                (3.260507)
 *   J  `REWARD_EXPONENT` set to 0                deeper always pays more (1.00x
 *                                                to 1.00x); stage 8 worth
 *                                                attempting (1.0x)
 *   G  `LOSS_FLOOR` set to 0                     a failed attempt still pays
 *                                                (0 points)
 *   O  `PROGRESS_POINTS` set to 0                getting further pays more
 *                                                (10 -> 10 -> 166)
 *   N  `SPEED_POINTS` set to 0                   speed is worth something
 *                                                (200 / 200 / 200)
 *   Q2 `CLEAR_POINTS` set to -100                no failed run out-earns a
 *                                                clear (worst clear 0, best
 *                                                loss 45); and getting further
 *   H  `sanitiseMeta` returns `raw` when the     a corrupt save cannot brick a
 *      version matches, unvalidated              boot (5 of 9); and one bad
 *                                                field costs only that field
 *   W  `sanitiseMeta` drops the best map         a clean save round-trips ({})
 *   V  `loadMeta` loses the typeof guard AND     headless has no storage, which
 *      the try                                   is not an error (it THREW)
 *   I  `buy` forgets `meta.points -= price`      buying debits exactly the
 *                                                price (spent 150, left 150)
 *   S  `buy` allows a duplicate                  you cannot buy twice (2 owned)
 *   Z  `buy` allows a base-roster id             nor buy what you started with
 *   T  `unlockPrice` is flat                     the next one costs more
 *                                                (150 -> 150)
 *   U  `unlockedRoster` forgets purchases        it is in the next run's pool
 *                                                (16 ids, tremolo absent)
 *   K  every stage unlocked from the start       a fresh save offers stage 1
 *                                                only (12 of 12 offered)
 *   L  `recordRun` does not open the next stage  clearing one opens the next
 *                                                (cleared 0)
 *   X  `recordRun` banks a clear for a LOST run  losing opens nothing
 *                                                (cleared 2)
 *
 * TWO THINGS THE LOG FOUND THAT THE ASSERTIONS DID NOT, and both were gates
 * passing for the wrong reason:
 *
 *   `a failed attempt still pays something` probed a run that had cleared ONE
 *   wave, so the depth term paid 4 points and break G stayed GREEN. The probe
 *   is `wavesCleared: 0` now — the only state where the floor is the whole
 *   payout.
 *
 *   the two `buy` refusals ran on a wallet the previous purchase had emptied,
 *   so breaks S and Z BOTH stayed green: the affordability check was refusing
 *   every call before either rule was consulted. The wallet is funded first now.
 *
 * ONE BREAK THAT STAYED GREEN AND IS RECORDED RATHER THAN FIXED:
 *
 *   V2 `loadMeta` keeps the `try` but loses the `typeof` guard — GREEN. The
 *   `try` catches Node's ReferenceError as happily as it catches Safari's
 *   SecurityError, so the guard is redundant rather than load-bearing. The
 *   comment in `meta.ts` claimed the opposite and has been corrected; the guard
 *   is kept for reasons that are now stated honestly as the smaller ones.
 * ---------------------------------------------------------------------------
 */
import './lib/tsnode.mjs';

const M = await import('../src/game/meta.ts');
const P = await import('../src/game/progression.ts');
const W = await import('../src/game/weapons.ts');
const waves = await import('../src/game/waves.ts');

let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}  — ${detail}`);
};

const draftableInstruments = W.INSTRUMENTS.filter((d) => !d.fused && d.weight > 0);
const draftableRig = W.RIG.filter((d) => d.weight > 0);

console.log('\nroster8 — the eight-and-eight starting roster, the shop, and the save\n');
console.log(`  the whole table   ${draftableInstruments.length} draftable instruments, ${draftableRig.length} passives`);
console.log(`  the base roster   ${M.BASE_INSTRUMENTS.length} instruments, ${M.BASE_RIG.length} passives`);
console.log(`  for sale          ${M.lockedIds().length} ids`);
console.log(`  slots             ${P.STAND_SLOTS} on stage, ${P.RIG_SLOTS} in the rig\n`);
console.log(`  instruments  ${M.BASE_INSTRUMENTS.join(' ')}`);
console.log(`  passives     ${M.BASE_RIG.join(' ')}\n`);

/* ------------------------------------------------------------------------ *
 * 1. THE LISTS ARE LEGAL
 * ------------------------------------------------------------------------ */
console.log('THE LISTS');

check(
  M.BASE_INSTRUMENTS.length === 8 && M.BASE_RIG.length === 8,
  'the base roster is 8 instruments and 8 passives — the number the owner asked for',
  `${M.BASE_INSTRUMENTS.length} and ${M.BASE_RIG.length}`,
);

{
  const instOk = M.BASE_INSTRUMENTS.filter((id) => draftableInstruments.some((d) => d.id === id));
  const rigOk = M.BASE_RIG.filter((id) => draftableRig.some((d) => d.id === id));
  check(
    instOk.length === M.BASE_INSTRUMENTS.length && rigOk.length === M.BASE_RIG.length,
    'every id in it is a real, draftable row of the right table',
    `${instOk.length}/${M.BASE_INSTRUMENTS.length} instruments and ${rigOk.length}/${M.BASE_RIG.length} passives resolve`,
  );
}

/*
 * BASE + LOCKED = THE WHOLE TABLE, with nothing counted twice.
 *
 * This is the assertion that catches an instrument added to `weapons.ts` and
 * forgotten here — which is not a crash, it is a row that can never be drafted
 * and can never be bought, i.e. content that exists in the source and nowhere
 * else. `lockedIds` is derived from the tables precisely so this can hold, and
 * the check exists because "derived" is a claim about code that someone will
 * one day replace with a list.
 */
{
  const all = new Set(M.allDraftableIds());
  const table = [...draftableInstruments.map((d) => d.id), ...draftableRig.map((d) => d.id)];
  const missing = table.filter((id) => !all.has(id));
  const dupes = M.allDraftableIds().length - all.size;
  check(
    missing.length === 0 && dupes === 0 && all.size === table.length,
    'base + locked is exactly the whole draftable table, each id once',
    `${all.size} of ${table.length} covered, ${missing.length} missing (${missing.join(' ') || 'none'}), ${dupes} duplicated`,
  );
}

/*
 * EVERY OPENER IS IN THE BASE ROSTER.
 *
 * `progression.ts` validates a chosen starter against `STARTERS` and silently
 * falls back to `STARTING_INSTRUMENT` — neither of which knows anything about
 * unlocks. An opener outside the base roster therefore produces a run holding
 * an instrument the pool will never level and, if the fallback is locked too, a
 * run holding a gun that is not in the game. Nothing throws either way.
 */
{
  const inBase = P.STARTERS.filter((id) => M.BASE_INSTRUMENTS.includes(id));
  check(
    inBase.length === P.STARTERS.length && M.BASE_INSTRUMENTS.includes(P.STARTING_INSTRUMENT),
    'every opener on the title screen is in the base roster, and so is the fallback',
    `${inBase.length}/${P.STARTERS.length} starters (${P.STARTERS.join(' ')}) plus ${P.STARTING_INSTRUMENT}`,
  );
}

/*
 * EVERY BASE WEAPON CAN REACH ITS DESIGNED EVOLUTION.
 *
 * An `evolution` recipe is a base instrument plus a specific passive, and it is
 * the authored reward the whole progression system points at. If the passive is
 * locked, the recipe is unreachable: `catalysesPursued` keeps returning true,
 * the offer weighting keeps trying to nudge a card that can never be dealt, and
 * the player's plan simply never completes. This is the reason seven of the
 * eight passives are determined by the weapon list rather than chosen.
 */
{
  const rows = [];
  for (const id of M.BASE_INSTRUMENTS) {
    const f = W.FUSIONS.find((x) => x.kind === 'evolution' && x.base === id);
    rows.push({ id, catalyst: f?.catalyst ?? null, result: f?.result ?? null, ok: !!f && M.BASE_RIG.includes(f.catalyst) });
  }
  for (const r of rows) {
    console.log(`        ${r.id.padEnd(10)} + ${String(r.catalyst).padEnd(11)} => ${String(r.result).padEnd(12)} ${r.ok ? '' : '  <-- CATALYST LOCKED'}`);
  }
  const ok = rows.filter((r) => r.ok).length;
  check(ok === rows.length, 'every base weapon can reach its designed evolution with a base passive', `${ok}/${rows.length}`);
}

/*
 * EIGHT DIFFERENT PROPERTIES. The design claim, asserted rather than asserted
 * in prose.
 *
 * Twenty of the thirty instruments own exactly one entry of `PROPERTY_NAMES`
 * and the other ten re-deliver a property somebody else owns. "Distinct
 * mechanical roles" therefore has a machine-readable meaning here, and a future
 * edit that swaps one base weapon for a second spelling of a property it
 * already has goes red instead of quietly narrowing the opening.
 */
{
  const propsOf = (id) => {
    const def = W.instrumentDef(id);
    return W.PROPERTY_NAMES.filter((n) => W.PROPERTIES[n].some((k) => (def?.props ?? {})[k]));
  };
  const seen = new Map();
  for (const id of M.BASE_INSTRUMENTS) for (const p of propsOf(id)) seen.set(p, [...(seen.get(p) ?? []), id]);
  const clashes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  console.log(`        properties: ${[...seen.keys()].join(' ')}`);
  check(
    seen.size === M.BASE_INSTRUMENTS.length && clashes.length === 0,
    'and the eight cover eight DISTINCT properties — eight ideas, not eight guns',
    `${seen.size} distinct across ${M.BASE_INSTRUMENTS.length} weapons` +
      (clashes.length ? `; shared: ${clashes.map(([p, ids]) => `${p}(${ids.join('+')})`).join(' ')}` : ''),
  );
}

/* ------------------------------------------------------------------------ *
 * 2. THE FUSION LATTICE THE EIGHT CAN REACH
 *
 * REPORTED, NOT GATED, and the reason is that there is no defensible absolute.
 * `docs/plan-meta.md` §1.1 does the arithmetic — 28 pairs from 8 weapons — and
 * §6 says in as many words that arithmetic is not evidence. What decides
 * whether the run is samey is `tools/builds.mjs` at 8, which measures whether
 * the PICK still changes the run, and `tools/offerpool.mjs` at 8, which
 * measures whether fusions still land. Both are separate files with their own
 * gates. Printing the lattice here is diagnosis, not a verdict.
 * ------------------------------------------------------------------------ */
console.log('\nWHAT THE EIGHT CAN COMBINE INTO');
{
  const pairs = [];
  const authored = [];
  for (let i = 0; i < M.BASE_INSTRUMENTS.length; i++) {
    for (let j = i + 1; j < M.BASE_INSTRUMENTS.length; j++) {
      const a = M.BASE_INSTRUMENTS[i];
      const b = M.BASE_INSTRUMENTS[j];
      pairs.push([a, b]);
      const f = W.FUSIONS.find(
        (x) => (x.base === a && x.catalyst === b) || (x.base === b && x.catalyst === a),
      );
      if (f) authored.push(`${a}x${b}=${f.result}`);
    }
  }
  console.log(`  authored pair recipes  ${authored.length} of ${pairs.length} pairs`);
  console.log(`    ${authored.join('  ')}`);
  console.log(`  designed evolutions    ${M.BASE_INSTRUMENTS.length} (one per weapon, above)`);
  console.log(`  generic duets          ${pairs.length - authored.length} pairs with no recipe fall through to DUET`);
}

/* ------------------------------------------------------------------------ *
 * 3. THE GATE ACTUALLY HOLDS
 *
 * Measured off the OFFER GENERATOR rather than off the source. AGENTS.md §3:
 * grep cannot see a filter nobody wrote, and a filter nobody wrote is exactly
 * the defect.
 * ------------------------------------------------------------------------ */
console.log('\nTHE GATE, MEASURED OFF THE DEALER');
{
  const RUNS = 200;
  const OFFERS = 34; // `arena.mjs` measures 34.3 offers in a twenty-minute run
  const roster = M.unlockedRoster(M.defaultMeta());
  let cards = 0;
  let illegal = 0;
  let grace = 0;
  let offers = 0;
  const illegalIds = new Set();
  for (let r = 0; r < RUNS; r++) {
    const s = P.createProgression(4000 + r, undefined, roster);
    for (let i = 0; i < OFFERS; i++) {
      s.pending = 1;
      const offer = P.openOffer(s);
      if (!offer) break;
      offers++;
      for (const o of offer.options) {
        cards++;
        if (o.grace) {
          grace++;
          continue;
        }
        // A fusion card carries a RESULT id, which is earned rather than
        // drafted and is deliberately not gated. Anything else must be in the
        // roster.
        if (o.fusion) continue;
        if (!roster.has(o.id)) {
          illegal++;
          illegalIds.add(o.id);
        }
      }
      P.chooseOption(s, 0);
    }
  }
  check(
    cards > 0 && illegal === 0,
    'the gate holds: no locked id is ever dealt',
    `${cards - illegal} of ${cards} cards legal across ${offers} offers` +
      (illegal ? `; leaked ${[...illegalIds].join(' ')}` : ''),
  );
  /*
   * AND THE OFFER IS STILL FOUR REAL CARDS.
   *
   * `makeOffer` pads a short pool with GRACE options, and grace is not an
   * ability — a shrunken pool would therefore not fail anything above, it would
   * quietly turn the level-up screen into a consolation menu. Sixteen ids
   * against four cards is a wide margin on paper; this is the check that says
   * so off the dealer, with the denominator printed.
   *
   * The bar is 2% rather than 0 because grace is a legitimate card late in a
   * run: once both banks are full and everything held is at its ceiling the
   * legal pool genuinely does run short, and demanding zero would be demanding
   * the pool never exhaust rather than never be thin.
   */
  const rate = grace / Math.max(1, cards);
  check(
    rate < 0.02,
    'and it is still four real cards, not a consolation menu',
    `${grace} grace cards in ${cards} (${(rate * 100).toFixed(2)}%)`,
  );
}

/* ------------------------------------------------------------------------ *
 * 4. THE SHOP READS THE CARD
 * ------------------------------------------------------------------------ */
console.log('\nTHE SHOP');
{
  const meta = M.defaultMeta();
  const rows = M.shopRows(meta);
  /*
   * Every shop row's text must be byte-identical to the note the LEVEL-UP CARD
   * will carry the first time that id is offered. Taken from
   * `availableOptions` rather than from `stepNote`, so this compares the shop
   * against the thing the player actually reads and not against the function
   * the shop happens to call today.
   */
  const full = P.createProgression(1, undefined, null);
  // Slots wide open, so every id is legal to offer and appears in the pool.
  full.instrumentSlots = 99;
  full.rigSlots = 99;
  const notes = new Map(P.availableOptions(full).map((o) => [o.id, o.note]));
  let matched = 0;
  let checked = 0;
  const wrong = [];
  for (const row of rows) {
    const card = notes.get(row.id);
    if (card === undefined) continue;
    checked++;
    if (card === row.note) matched++;
    else wrong.push(row.id);
  }
  check(
    checked === rows.length && matched === checked,
    'every shop row shows the same words the level-up card will',
    `${matched}/${checked} matched, ${rows.length} rows offered` + (wrong.length ? `; differ: ${wrong.join(' ')}` : ''),
  );
  check(
    rows.every((r) => r.note.length > 0 && r.label.length > 0),
    'and none of them is blank',
    `${rows.filter((r) => r.note && r.label).length}/${rows.length} rows carry a label and a mechanics line`,
  );

  const prices = [];
  for (let n = 0; n < rows.length; n++) prices.push(M.unlockPrice(n));
  const total = prices.reduce((a, b) => a + b, 0);
  console.log(`  prices  ${prices[0]} for the first, ${prices[prices.length - 1]} for the last, ${total} for all ${rows.length}`);
}

/* ------------------------------------------------------------------------ *
 * 5. THE POINTS
 * ------------------------------------------------------------------------ */
console.log('\nTHE REWARD CURVE');
{
  const mults = [];
  for (let s = 1; s <= M.STAGE_COUNT; s++) mults.push(M.stageReward(s));
  console.log(`  stage      ${Array.from({ length: M.STAGE_COUNT }, (_, i) => String(i + 1).padStart(6)).join('')}`);
  console.log(`  multiplier ${mults.map((m) => m.toFixed(2).padStart(6)).join('')}`);
  const ratios = mults.slice(1).map((m, i) => m / mults[i]);
  console.log(`  step ratio ${'      '}${ratios.map((r) => r.toFixed(2).padStart(6)).join('')}`);

  check(Math.abs(mults[0] - 1) < 1e-9, 'stage 1 pays exactly 1x — the game as it was', `${mults[0].toFixed(6)}`);
  check(
    mults.every((m, i) => i === 0 || m > mults[i - 1]),
    'deeper always pays more',
    `${mults[0].toFixed(2)}x at stage 1 rising to ${mults[mults.length - 1].toFixed(2)}x at stage ${M.STAGE_COUNT}`,
  );
  /*
   * "NOT TOO EXPONENTIAL", WRITTEN AS ARITHMETIC.
   *
   * The failure mode is that one step of depth makes everything shallower than
   * it worthless, and the place it bites is not the deep end — it is stage 1 to
   * stage 2, where a bare `s^E` at E=1.35 already pays 2.55x for one step. A
   * ceiling on the LARGEST neighbour ratio is the direct statement of the
   * constraint, and it is what `REWARD_SHIFT` exists to satisfy.
   *
   * 2.0 rather than something tighter because the curve does have to feel like
   * a curve: at a ceiling of 1.5 the whole set list spans only 12x, which is
   * flat enough that the owner's word "exponentially" stops describing it.
   */
  const worst = Math.max(...ratios);
  check(
    worst <= 2.0,
    'and no single step of depth more than doubles the payout',
    `worst neighbour ratio ${worst.toFixed(2)}x (stage ${ratios.indexOf(worst) + 1} -> ${ratios.indexOf(worst) + 2}), ` +
      `whole set list spans ${(mults[mults.length - 1] / mults[0]).toFixed(1)}x`,
  );
}

console.log('\nWHAT A RUN PAYS');
{
  const row = (label, r) => {
    const p = M.computeRunPoints(r);
    console.log(
      `  ${label.padEnd(34)} ${String(p.points).padStart(6)}  ` +
        `= (${p.floor} floor + ${p.progress.toFixed(0)} depth + ${p.clear} clear + ${p.speed.toFixed(0)} speed) x ${p.multiplier.toFixed(2)}`,
    );
    return p;
  };
  const T = waves.TOTAL_WAVES;
  const par1 = M.parSeconds(1);
  const fast = row('stage 1, cleared at 0.6x par', { stage: 1, wavesCleared: T, seconds: par1 * 0.6, won: true });
  const atPar = row('stage 1, cleared at par', { stage: 1, wavesCleared: T, seconds: par1, won: true });
  const slow = row('stage 1, cleared at 1.6x par', { stage: 1, wavesCleared: T, seconds: par1 * 1.6, won: true });
  const half = row('stage 1, died half way', { stage: 1, wavesCleared: T / 2, seconds: 400, won: false });
  const nowhere = row('stage 1, died on wave 1', { stage: 1, wavesCleared: 1, seconds: 40, won: false });
  /*
   * THE WORST POSSIBLE RUN, and the probe is `wavesCleared: 0` rather than 1
   * BECAUSE THE FAIL-TEST SAID SO.
   *
   * The floor assertion below used to read the "died on wave 1" row, and
   * setting `LOSS_FLOOR = 0` LEFT IT GREEN: that row still cleared one wave of
   * sixteen, so the depth term paid 4 points and the floor was never the thing
   * being measured. A gate that passes with the constant it is named after set
   * to zero is decoration — AGENTS.md §3, found exactly the way it says to
   * find it.
   *
   * Zero waves cleared is the only state in which the floor is the ENTIRE
   * payout, so it is the only probe that can see it.
   */
  const nothing = row('stage 1, died before clearing a wave', { stage: 1, wavesCleared: 0, seconds: 20, won: false });
  const deep = row('stage 8, cleared at par', { stage: 8, wavesCleared: T, seconds: M.parSeconds(8), won: true });

  check(
    nothing.points > 0,
    'a failed attempt still pays something, even the worst one',
    `${nothing.points} points for dying with nothing cleared`,
  );
  check(
    half.points > nowhere.points && nowhere.points > nothing.points && atPar.points > half.points,
    'and getting further pays more, win or lose',
    `${nothing.points} -> ${nowhere.points} -> ${half.points} -> ${atPar.points}`,
  );
  check(
    fast.points > atPar.points && atPar.points > slow.points,
    'speed to finish is worth something, scaled against the stage par',
    `${fast.points} fast / ${atPar.points} at par / ${slow.points} slow`,
  );
  /*
   * A LOSS MUST NEVER OUT-EARN A WIN AT THE SAME STAGE. The floor exists to
   * make a brave attempt non-zero and it must not turn into an exploit — dying
   * early and restarting has to be strictly worse per attempt than finishing.
   */
  check(
    half.points < atPar.points && nowhere.points < atPar.points,
    'and no failed run out-earns a clear of the same stage',
    `worst clear ${slow.points} against best loss ${half.points}`,
  );
  /*
   * THE DEEP STAGE PAYS MORE PER RUN. This is the weak half of the depth
   * question and it is asserted here only because it is cheap; the half that
   * actually decides the design is points per MINUTE, which needs real runs and
   * lives in `tools/stages.mjs`.
   */
  check(
    deep.points > atPar.points * 3,
    'stage 8 is worth attempting on the per-run number alone',
    `${deep.points} against stage 1's ${atPar.points} — ${(deep.points / atPar.points).toFixed(1)}x`,
  );
}

/* ------------------------------------------------------------------------ *
 * 6. THE SAVE
 * ------------------------------------------------------------------------ */
console.log('\nTHE SAVE');
{
  /*
   * A CORRUPT SAVE MUST NOT BRICK A BOOT. Nine payloads, each a real thing a
   * `localStorage` slot can contain: a truncated write, a value from an older
   * build, somebody's console experiment, an id that has since been renamed.
   * None may throw and none may produce a state the rest of the game can
   * choke on.
   */
  const good = M.defaultMeta();
  good.points = 500;
  good.unlocked = [M.lockedIds()[0]];
  good.highestCleared = 3;
  good.best = { 1: 800 };

  const payloads = [
    ['null', null],
    ['a string', 'nonsense'],
    ['an array', [1, 2, 3]],
    ['{}', {}],
    ['wrong version', { ...good, version: 999 }],
    ['negative points', { ...good, points: -5 }],
    ['NaN points', { ...good, points: NaN }],
    ['unknown + duplicate unlocks', { ...good, unlocked: ['not_a_thing', M.lockedIds()[0], M.lockedIds()[0], 'ember'] }],
    ['garbage best map', { ...good, best: { 0: 1, 99: 1, abc: 5, 2: -3, 3: 'x', 4: 120 } }],
  ];
  let survived = 0;
  const legal = new Set(M.lockedIds());
  for (const [label, raw] of payloads) {
    let s;
    let threw = false;
    try {
      s = M.sanitiseMeta(raw);
    } catch {
      threw = true;
    }
    const sane =
      !threw &&
      s.version === M.META_VERSION &&
      Number.isFinite(s.points) &&
      s.points >= 0 &&
      Array.isArray(s.unlocked) &&
      s.unlocked.every((id) => legal.has(id)) &&
      new Set(s.unlocked).size === s.unlocked.length &&
      s.highestCleared >= 0 &&
      s.highestCleared <= M.STAGE_COUNT &&
      Object.entries(s.best).every(([k, v]) => Number(k) >= 1 && Number(k) <= M.STAGE_COUNT && v > 0);
    if (sane) survived++;
    else console.log(`        ${label} produced ${threw ? 'a THROW' : JSON.stringify(s)}`);
  }
  check(survived === payloads.length, 'a corrupt save cannot brick a boot', `${survived}/${payloads.length} payloads sanitised`);

  /*
   * FIELD BY FIELD, NOT ALL OR NOTHING. A mangled `best` map must not cost the
   * player the twenty weapons they bought — the policy in `sanitiseMeta`'s
   * header, asserted.
   */
  const partial = M.sanitiseMeta({ ...good, best: { nonsense: true }, highestCleared: 'four' });
  check(
    partial.points === 500 && partial.unlocked.length === 1 && Object.keys(partial.best).length === 0,
    'and one bad field costs only that field',
    `points ${partial.points}, unlocks ${partial.unlocked.length}, best entries ${Object.keys(partial.best).length}`,
  );

  /* A clean save round-trips through JSON unchanged. */
  const back = M.sanitiseMeta(JSON.parse(JSON.stringify(good)));
  check(
    back.points === good.points && back.highestCleared === good.highestCleared && back.unlocked.length === 1 && back.best['1'] === 800,
    'a clean save round-trips',
    `${JSON.stringify(back.best)} kept, ${back.unlocked.length} unlock kept`,
  );

  /*
   * NEITHER STORAGE FUNCTION MAY THROW IN NODE. This is the assertion the whole
   * `tools/` directory depends on: `localStorage` is not merely empty here, the
   * identifier does not exist, so a bare mention is a `ReferenceError`. Every
   * gate in this directory imports the game, and a module that touched storage
   * at import time would take the entire suite red.
   */
  let storageThrew = false;
  let loaded = null;
  let saved = null;
  try {
    loaded = M.loadMeta();
    saved = M.saveMeta(good);
  } catch {
    storageThrew = true;
  }
  check(
    !storageThrew && loaded !== null && loaded.points === 0 && saved === false,
    'and headless has no storage, which is not an error',
    `loadMeta returned a default (${loaded ? loaded.points : 'THREW'} points), saveMeta returned ${saved}`,
  );
}

console.log('\nBUYING');
{
  const meta = M.defaultMeta();
  const id = M.lockedIds()[0];
  const price = M.nextPrice(meta);
  check(!M.buy(meta, id), 'you cannot buy what you cannot afford', `${meta.points} points against a price of ${price}`);
  meta.points = price;
  const bought = M.buy(meta, id);
  check(
    bought && meta.points === 0 && meta.unlocked.length === 1,
    'buying debits exactly the price and grants exactly one thing',
    `spent ${price}, left ${meta.points}, own ${meta.unlocked.length}`,
  );
  /*
   * FUNDED FIRST, AND THE FAIL-TEST IS WHY.
   *
   * These two used to run on a wallet the previous purchase had just emptied,
   * and removing the duplicate guard AND the base-roster guard from `buy` both
   * left them GREEN — the affordability check was refusing every call before
   * either rule was consulted, so two assertions were passing on the wrong
   * reason. A gate satisfied by an unrelated mechanism is the "gates optimised
   * against" shape AGENTS.md §3 opens with, and it was hiding here in the
   * cheapest possible form: an empty wallet.
   *
   * With the wallet full, the only thing that can refuse these calls is the
   * rule each one is named after.
   */
  meta.points = 10_000;
  check(!M.buy(meta, id), 'and you cannot buy the same thing twice', `still ${meta.unlocked.length} owned, ${meta.points} points untouched`);
  check(
    !M.buy(meta, 'ember'),
    'nor buy something you started with',
    `ember is ${M.BASE_INSTRUMENTS.includes('ember') ? 'base' : 'NOT BASE'}; ${meta.unlocked.length} owned`,
  );
  check(
    M.nextPrice(meta) === price + M.UNLOCK_STEP,
    'and the next one costs more',
    `${price} -> ${M.nextPrice(meta)}`,
  );
  /* A bought id joins the run's roster. The whole point of the shop. */
  const roster = M.unlockedRoster(meta);
  check(
    roster.has(id) && roster.size === M.BASE_ROSTER.length + 1,
    'and it is in the next run\'s draft pool',
    `${roster.size} ids draftable, ${id} included`,
  );
}

console.log('\nTHE SET LIST');
{
  const meta = M.defaultMeta();
  check(
    M.stageUnlocked(meta, 1) && !M.stageUnlocked(meta, 2),
    'a fresh save may attempt stage 1 and nothing deeper',
    `deepest offered ${M.deepestOffered(meta)} of ${M.STAGE_COUNT}`,
  );
  M.recordRun(meta, { stage: 1, wavesCleared: waves.TOTAL_WAVES, seconds: 700, won: true });
  check(
    meta.highestCleared === 1 && M.deepestOffered(meta) === 2 && meta.best['1'] === 700,
    'clearing one opens the next and records the time',
    `cleared ${meta.highestCleared}, offered ${M.deepestOffered(meta)}, best ${meta.best['1']}s`,
  );
  const before = meta.points;
  M.recordRun(meta, { stage: 2, wavesCleared: 4, seconds: 300, won: false });
  check(
    meta.points > before && meta.highestCleared === 1 && meta.best['2'] === undefined,
    'and losing pays, but does not open anything or record a time',
    `+${meta.points - before} points, still cleared ${meta.highestCleared}`,
  );
}

console.log('');
if (bad) {
  console.log(`ROSTER8 BROKEN — ${bad} failure(s)\n`);
  process.exit(1);
}
console.log('ROSTER8 HOLDS — eight and eight is legal, the gate holds, and the save survives abuse\n');
