/*
 * propfire — does each WEAPON PROPERTY actually apply, and then tick, on a
 * real enemy in a real run?
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS FOR, WHICH IS THIS REPOSITORY'S MOST RECORDED ONE.
 *
 * `tools/rulefire.mjs` makes the argument for passives and every word of it
 * transfers, harder: a multiplier cannot be silently absent, because
 * `applyModifiers` folds it into every stat block on every frame. A PROPERTY
 * is different in kind. It waits for a hit, then a roll, then a body that can
 * carry it, then a tick loop that has to keep carrying it — and any one of the
 * four can be missing while the type checks, the card renders, the HUD reads
 * correctly and the weapon still deals its listed damage. `weapons.ts` calls
 * this out in as many words: "the ability that type-checks, appears in the HUD
 * and does nothing".
 *
 * `rulefire` is the model and this goes one step further than it does, because
 * a status effect has a second failure mode a rule does not: it can be APPLIED
 * and never TICK. A burn written onto an enemy that is cleared on the next
 * frame, or whose timer is decremented before it is read, fires its counter
 * once per hit and deals nothing at all. Every fire count in the world would
 * be healthy. So this measures four things per property, not one:
 *
 *   propChances   the property was present and was rolled
 *   propFires     the roll landed and the property was written
 *   propTicks     enemy-steps actually spent carrying it
 *   propDamage    hit points actually removed BY THE PROPERTY
 *
 * ---------------------------------------------------------------------------
 * SIX QUESTIONS, in the order they matter:
 *
 *   1. Is every `Props` field owned by somebody? A field in the interface that
 *      no weapon sets is dead on arrival. Static.
 *   2. Does every DRAFTABLE instrument carry a property? "The property is the
 *      weapon" is the architecture of the whole roster; a base weapon with no
 *      property is a delivery shape wearing a name, which is the roster the
 *      owner rejected. Static.
 *   3. Is every property WIRED to a counter? A property no counter observes
 *      cannot be measured and will rot. Static.
 *   4. Does each property FIRE in a real run, with the weapons that carry it
 *      forced into the loadout? Reported as fires over chances, with the
 *      unconditional moment count beside it. A zero denominator is a FAILURE.
 *   5. Does each one TICK and DEAL? A status that expires the frame it lands
 *      is not a status; a splash that fires and removes no hit points is not a
 *      splash.
 *   6. THE CONTROL. A run holding SNAP — the roster's one deliberately
 *      property-free weapon — must fire NOTHING, while still producing every
 *      moment. Without this the whole file is decoration: a counter
 *      incremented one line too high, outside its own `if`, passes questions 4
 *      and 5 for free and is measuring the run rather than the property.
 *
 * Usage:  NODE_OPTIONS=--experimental-transform-types node tools/propfire.mjs [seconds]
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const W = await import(`${R}game/weapons.ts`);

const DT = 1 / 120;
/*
 * 180s per property, and the number is set by the RAREST of them.
 *
 * GLASS rolls a 5% freeze on a hit; DUET a 5% charm; SIPHON a 5% heal. At the
 * hit rates a forced loadout produces that is hundreds of rolls a run, so this
 * is comfortable — but the denominator is printed either way, so a run that
 * simply never asked is distinguishable from a property that is broken, and
 * both are failures.
 */
const SECS = Number(process.env.SECS ?? process.argv[2] ?? 180);
const STEPS = Math.round(SECS / DT);
const SEED = 0x9f0d;

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

console.log(`\npropfire — do the twenty weapons' properties apply, tick and deal? ${SECS}s per property\n`);

/* --------------------------------------------------- 1-3. the table wires up */

console.log('STATIC — every property, and which weapons install it');

/*
 * The field list and the property/field mapping are both READ OFF `weapons.ts`
 * rather than restated here. A tool holding its own copy of a constant lies
 * the day it moves (AGENTS.md §3), and the shape of the lie here would be the
 * worst available: a property added to `Props` and forgotten in this list
 * would not be reported as broken, it would not be reported at all.
 */
const PROP_FIELDS = Object.keys(W.noProps());
/*
 * Imported rather than restated. Two `Props` fields get STRONGER as they get
 * smaller — GRAVEL's erosion rate and NOCTURNE's silence — and a copy of that
 * list here would lie by calling a real regression an improvement the day
 * somebody moved a field between the two categories. AGENTS.md §3.
 */
const LOWER_IS_STRONGER = new Set(W.PROP_LOWER_IS_STRONGER);
const NAMES = W.PROPERTY_NAMES;
const FIELDS_OF = W.PROPERTIES;

{
  const mapped = new Set(Object.values(FIELDS_OF).flat());
  const unmapped = PROP_FIELDS.filter((f) => !mapped.has(f));
  if (unmapped.length) fail(`Props fields with no property name, so unmeasurable: ${unmapped.join(', ')}`);
  const bogus = [...mapped].filter((f) => !PROP_FIELDS.includes(f));
  if (bogus.length) fail(`PROPERTIES names fields that are not in Props: ${bogus.join(', ')}`);
}

/** Every instrument that sets any field of a given property, at any level. */
const carriers = new Map(NAMES.map((n) => [n, []]));
const fieldOwners = new Map(PROP_FIELDS.map((f) => [f, []]));
for (const def of W.INSTRUMENTS) {
  const levels = def.fused ? [1] : [1, W.INSTRUMENT_MAX_LEVEL];
  const seen = new Set();
  for (const lv of levels) {
    const p = W.instrumentProps(def.id, lv);
    for (const f of PROP_FIELDS) if (p[f] !== 0) seen.add(f);
  }
  for (const f of seen) fieldOwners.get(f).push(def.id);
  for (const n of NAMES) {
    if (FIELDS_OF[n].some((f) => seen.has(f)) && !carriers.get(n).includes(def.id)) carriers.get(n).push(def.id);
  }
}

for (const n of NAMES) {
  const who = carriers.get(n);
  const bases = who.filter((id) => !W.instrumentDef(id).fused);
  console.log(`  ${n.padEnd(8)} ${String(who.length).padStart(2)} weapons   bases: ${bases.join(', ') || 'NONE'}`);
  if (!who.length) fail(`property '${n}' is declared and no instrument installs it — dead on arrival`);
  if (!bases.length) fail(`property '${n}' is only ever reachable through a fusion — no base weapon carries it`);
}
for (const f of PROP_FIELDS) {
  if (!fieldOwners.get(f).length) fail(`Props.${f} is declared and nobody sets it`);
}

/*
 * EVERY DRAFTABLE INSTRUMENT CARRIES A PROPERTY. This is the architecture
 * assertion and it is the one that would catch the roster quietly sliding back
 * into "fourteen ways of saying damage happens near enemies" — a base weapon
 * added later with a novel geometry and no property would be exactly that, and
 * nothing else in the suite would notice.
 *
 * Fusion results are exempt on purpose: SNAP is deliberately bare (see its row)
 * and is this file's control.
 */
{
  const draftable = W.INSTRUMENTS.filter((d) => !d.fused);
  const bare = draftable.filter((d) => !W.hasProps(W.instrumentProps(d.id, 1)));
  console.log(`\n  ${draftable.length} draftable instruments, ${draftable.length - bare.length} carrying a property at level 1`);
  if (bare.length) fail(`draftable instruments with no property: ${bare.map((d) => d.id).join(', ')}`);
  if (draftable.length === 0) fail('there are no draftable instruments — nothing was examined');
}

/*
 * The counter set and the property set have to line up. `World.propFires` is
 * the only thing that can observe a property, so a name with no counter is
 * unmeasurable and a counter with no name is measuring something this file
 * does not know about.
 */
{
  const probe = new World(1);
  for (const table of ['propFires', 'propChances', 'propTicks', 'propDamage']) {
    const keys = Object.keys(probe[table]);
    const missing = NAMES.filter((n) => !keys.includes(n));
    const extra = keys.filter((k) => !NAMES.includes(k));
    if (missing.length) fail(`World.${table} has no counter for: ${missing.join(', ')}`);
    if (extra.length) fail(`World.${table} has counters for unknown properties: ${extra.join(', ')}`);
  }
  const moments = Object.keys(probe.propMoments);
  if (moments.length === 0) fail('World.propMoments is empty — the control run would have no denominator');
  console.log(`  ${NAMES.length} properties, 4 counter tables each, ${moments.length} unconditional moments`);
}
if (failures === 0) pass('every property has an owner, a base carrier and a counter, and every base has a property');

/* ------------------------------------------------------- 4-5. a run per property */

/**
 * Force a loadout and hold it there.
 *
 * Re-asserted every step rather than set once, exactly as `rulefire` does it:
 * the bot answers offers, so it will happily pick up other instruments, and a
 * fusion CONSUMES its base (`applyFusion` deletes it). Either would make the
 * run measure a different loadout from the one named in the column, and for
 * this check that is fatal rather than untidy — a second weapon carrying a
 * second property would put fires in a column it does not belong to.
 */
function force(w, ids) {
  for (const k of Object.keys(w.progression.instruments)) if (!ids.includes(k)) delete w.progression.instruments[k];
  for (const id of ids) w.progression.instruments[id] = W.maxLevelOf(id);
  for (const k of Object.keys(w.progression.rig)) delete w.progression.rig[k];
  /*
   * OFFERS ARE SUPPRESSED OUTRIGHT, not answered.
   *
   * Re-asserting the loadout before each `update` is not enough and the gap is
   * exactly one frame wide: `applyOfferInput` runs early in `update` and
   * `fireInstruments` runs later in the SAME update, so a card taken on that
   * step gets one activation with a weapon this column does not name. Measured,
   * that was six stray `poison` fires inside the run that is supposed to hold
   * nothing but RASP — the cross-contamination check below caught it, and it
   * was the harness rather than the game.
   *
   * Zeroing the queue and clearing any open offer means no card is ever dealt,
   * so the forced loadout is the only loadout the run ever has.
   */
  w.progression.pending = 0;
  w.progression.offer = null;
}

function run(ids, secs = SECS) {
  const w = new World(SEED);
  // The opener carries burn; forcing the loadout below removes it, but the
  // starter has to be something that exists or `createProgression` falls back.
  w.starter = ids[0];
  w.start();
  /*
   * 'weave' RATHER THAN 'dodge', AND THE CHOICE IS LOAD-BEARING.
   *
   * The dodging brain is the right harness for tools that ask how far a run
   * gets. It is the wrong one here, because it holds the enemies at arm's
   * length: measured at 30s, RASP (210px reach) landed ONE hit and the control
   * run produced ZERO body contacts, so two of the moments this file depends on
   * never happened and a third was measured off a sample of one. The weaving
   * brain stands in the fight and shoots, which is what produces hits, contacts
   * and volleys in the quantity these denominators need.
   *
   * It is not a brain that plays well, and it does not need to be — the harness
   * is immortal below, so what is being measured is the property, not the run.
   */
  const drive = makeBrain('weave');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  const steps = Math.round(secs / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    inp.choice = w.choosing ? 0 : -1;
    force(w, ids);
    w.update(DT, inp);
    w.shocks.length = 0;
    /*
     * IMMORTAL, and it matters here more than in any other tool. Several of
     * these loadouts are one weapon with no rig and no fusion, which is a much
     * weaker run than the game normally produces; a mortal harness would
     * measure four minutes of the strong properties and forty seconds of the
     * weak ones, and the denominators would then be a statement about survival
     * rather than about the property.
     */
    w.player.lives = Math.max(3, w.player.lives);
    /*
     * ALIVE, AND DELIBERATELY NOT AT FULL HEALTH.
     *
     * The floor keeps the run going; the ceiling is what makes SIPHON
     * measurable. A leech that rolls successfully at full health heals nothing,
     * so an immortal harness that also topped the player up would report
     * `propDamage.leech` as zero forever and there would be no way to tell that
     * from a broken heal. Holding the player one point down is the same kind of
     * harness shaping `rulefire` does when it plants the bot for three seconds
     * in eight so FERMATA's charge can exist at all — it produces the moment,
     * it does not fake the answer.
     */
    w.player.hp = Math.min(Math.max(1, w.player.hp), Math.max(1, w.player.maxHp - 1));
    w.player.dead = false;
    if (w.phase === 'over') break;
  }
  return w;
}

/*
 * WHICH PROPERTIES MUST SHOW WHAT.
 *
 * `tick` — the property writes state onto a body that the per-step tick then
 * has to keep carrying. These are the ones with the extra failure mode this
 * whole file exists for, and a zero here with a healthy fire count is the
 * exact defect: applied, and gone before anything read it.
 *
 * `damage` — the property removes hit points ITSELF, as opposed to changing
 * what something else does. A fire count without damage is a splash that
 * landed on nothing, or one whose arithmetic multiplies by zero.
 *
 * `ghost`, `erode`, `split`, `burst`, `brood`, `accel`, `heavy`, `dark` and
 * `leech` are in neither list, and each for a stated reason: they change the
 * BOLT or the PLAYER rather than the body, so there is no enemy-step to count
 * and no damage that is attributable to them rather than to the hit they
 * modified. Their fire counts are the whole of what is observable, which is
 * why the control below has to be airtight.
 */
const TICKS = new Set(['burn', 'poison', 'bleed', 'freeze', 'slow', 'blind', 'charm', 'hold']);
/*
 * `blind` and `leech` are in DEALS with a different UNIT, which `World`'s own
 * `propDamage` note spells out: attacks prevented and health restored. Both
 * belong here for the same reason the rest do — a blind that never causes a
 * miss and a leech that never restores anything have fired and done nothing,
 * and the fire count alone cannot say so.
 */
const DEALS = new Set(['burn', 'poison', 'bleed', 'chain', 'quake', 'lance', 'charm', 'freeze', 'leech']);
/*
 * `blind` is asserted SEPARATELY, against its own denominator.
 *
 * Its payoff is attacks prevented, and enemies in this build attack rarely: a
 * 60s GLARE run produced three blinded attacks and prevented none, which a
 * bare "prevented > 0" reported as "it fires and does nothing" — a false
 * negative about a working property. `World.propMoments.blindedAttack` counts
 * the volleys and contacts a blinded body actually attempted, so the run can
 * say "nothing was measured" when that is the truth and "prevented none of N"
 * when that is.
 */

console.log('\nDYNAMIC — one run per property, holding the base weapons that carry it, all forced to max');
console.log(
  `  ${'property'.padEnd(8)} ${'weapons'.padEnd(22)} ${'fired'.padStart(8)} /${'chances'.padStart(9)}   ` +
    `${'rate'.padStart(7)}  ${'ticks'.padStart(9)}  ${'damage'.padStart(9)}`,
);
console.log(`  ${'-'.repeat(8)} ${'-'.repeat(22)} ${'-'.repeat(8)}  ${'-'.repeat(9)}   ${'-'.repeat(7)}  ${'-'.repeat(9)}  ${'-'.repeat(9)}`);

const rows = [];
for (const n of NAMES) {
  const bases = carriers.get(n).filter((id) => !W.instrumentDef(id).fused);
  if (!bases.length) continue;
  /*
   * At most two carriers, and the STAND_SLOTS cap is why: forcing more
   * instruments than the game has chairs for would measure a loadout the game
   * cannot produce. Two is enough to get a workable hit rate for the slow
   * weapons without diluting the column.
   */
  const ids = bases.slice(0, 2);
  const w = run(ids);
  const fired = n === 'accel' ? w.playerBullets.accelerated : w.propFires[n];
  const chances = n === 'accel' ? w.playerBullets.bounced : w.propChances[n];
  const ticks = w.propTicks[n];
  const dmg = w.propDamage[n];
  const rate = chances ? `${((fired / chances) * 100).toFixed(1)}%` : '    n/a';
  console.log(
    `  ${n.padEnd(8)} ${ids.join('+').padEnd(22)} ${String(fired).padStart(8)} /${String(chances).padStart(9)}   ` +
      `${rate.padStart(7)}  ${String(ticks).padStart(9)}  ${dmg.toFixed(0).padStart(9)}`,
  );
  rows.push({ n, ids, fired, chances, ticks, dmg, w });
}

if (rows.length !== NAMES.length) {
  fail(`only ${rows.length} of ${NAMES.length} properties had a base carrier to measure`);
}

for (const r of rows) {
  /*
   * A zero DENOMINATOR is a failure and not a skip. AGENTS.md §3: zero and
   * clean look identical unless you print the count.
   */
  if (r.chances === 0) {
    fail(`${r.n}: ${SECS}s holding ${r.ids.join('+')} never produced the moment it waits for — nothing was measured`);
    continue;
  }
  if (r.fired === 0) {
    fail(`${r.n}: ${r.chances} chances and it applied 0 times — installed and inert`);
    continue;
  }
  if (TICKS.has(r.n) && r.ticks === 0) {
    fail(`${r.n}: applied ${r.fired} times and ticked on 0 enemy-steps — it is written and never carried`);
  }
  if (DEALS.has(r.n) && !(r.dmg > 0)) {
    fail(`${r.n}: applied ${r.fired} times and removed 0 hit points — it fires and does nothing`);
  }
}

{
  const r = rows.find((x) => x.n === 'blind');
  if (!r) fail('no run measured blind');
  else {
    const attempts = r.w.blindedAttacks;
    const prevented = r.w.propDamage.blind;
    console.log(
      `\n  blind, against its own denominator: ${prevented} of ${attempts} attacks by a blinded body were prevented` +
        ` (${attempts ? ((prevented / attempts) * 100).toFixed(1) : '  n/a'}%, PROP.blindMiss is ${(W.PROP.blindMiss * 100).toFixed(0)}%)`,
    );
    if (attempts === 0) {
      fail('blind: no blinded body ever attempted an attack, so the miss chance was never exercised — nothing was measured');
    } else if (prevented === 0) {
      fail(`blind: ${attempts} attacks by blinded bodies and not one missed — the miss chance does nothing`);
    }
  }
}

/*
 * CROSS-CONTAMINATION. Each run holds only the weapons that carry ONE
 * property, so every OTHER property's fire count must be zero.
 *
 * This is the per-property half of the control, and it catches something the
 * global control cannot: a counter incremented in the wrong branch, or a
 * property leaking out of the weapon that declares it. Fusion-only properties
 * are not exempt — nothing in these loadouts fuses, because the rig is emptied
 * every step.
 *
 * Two exceptions, both structural rather than excused. `freeze` and `hold`
 * deliberately SHARE the freeze timer, so a run holding either ticks both; the
 * FIRE counts stay separate and are what is asserted.
 */
console.log('\nCROSS-CONTAMINATION — a run holding one property must fire no other');
{
  let leaks = 0;
  let checked = 0;
  for (const r of rows) {
    const held = new Set([r.n]);
    // Some weapons legitimately carry two properties (SWELL slows and CANON
    // splits are one each, but the fusion results and duets merge). Credit
    // every property the forced loadout actually declares.
    for (const id of r.ids) {
      const p = W.instrumentProps(id, W.maxLevelOf(id));
      for (const n of NAMES) if (FIELDS_OF[n].some((f) => p[f] !== 0)) held.add(n);
    }
    for (const n of NAMES) {
      if (held.has(n)) continue;
      checked++;
      const fired = n === 'accel' ? r.w.playerBullets.accelerated : r.w.propFires[n];
      if (fired !== 0) {
        leaks++;
        fail(`${r.n}'s run (${r.ids.join('+')}) fired '${n}' ${fired} times, and nothing in it carries '${n}'`);
      }
    }
  }
  console.log(`  ${checked} property-run pairs checked for leakage`);
  if (checked === 0) fail('no cross-contamination pairs were checked — this proved nothing');
  else if (leaks === 0) pass('no property fired in a run whose loadout does not carry it');
}

/* ------------------------------------------- 6. the control, which is the point */

/*
 * SNAP is the roster's one deliberately property-free weapon and this is what
 * it is for. A run holding it kills things, takes hits, is shot at and bounces
 * bolts off walls — every moment a property could hook into — and must fire
 * none of them.
 *
 * The MOMENTS must be non-zero, and that is the second half of the same
 * argument: it proves the control run really did produce every opportunity, so
 * the zeros above it are the properties being absent rather than the run being
 * quiet. This is the assertion `rulefire`'s own control block calls "the
 * point", and the reason `World.propMoments` exists as a separate table from
 * `propChances`.
 */
console.log('\nCONTROL — the same harness holding SNAP, which carries nothing');
{
  const w = run(['snap']);
  let clean = true;
  const hot = [];
  for (const n of NAMES) {
    const fired = n === 'accel' ? w.playerBullets.accelerated : w.propFires[n];
    const dmg = w.propDamage[n];
    const ticks = w.propTicks[n];
    if (fired !== 0 || dmg !== 0 || ticks !== 0) {
      clean = false;
      hot.push(`${n} fires=${fired} ticks=${ticks} dmg=${dmg.toFixed(1)}`);
    }
  }
  for (const [k, v] of Object.entries(w.propMoments)) {
    console.log(`  moment ${k.padEnd(11)} ${String(v).padStart(9)}`);
    if (v === 0) {
      clean = false;
      fail(`the control run produced 0 '${k}' moments, so its zeros prove nothing`);
    }
  }
  console.log(`  bolt bounces ${String(w.playerBullets.bounced).padStart(12)}`);
  for (const h of hot) fail(`a property fired with nothing installing it — ${h}`);
  if (w.propOverflow !== 0) fail(`${w.propOverflow} property sets could not be interned — bolts silently lost their properties`);
  if (clean) pass('no property fires when no weapon carries one, and every moment still occurred');
}

/* ------------------------------------------------------------ 7. the ladders */

/*
 * A LADDER HAS TO MOVE. A weapon whose three rungs fold to the same property
 * set is HOMING's old `{homing:0.36/0.64/0.8}` in a new costume: three
 * level-ups, one behaviour, and nothing able to see it because the field was
 * read. `rulefire` makes the same assertion for the rig.
 *
 * Only the PROPERTY half is asserted here — `levelup.mjs` already checks that
 * no instrument's dps goes backwards — so a rung that buys stats and leaves
 * the property alone is legal, and several deliberately do.
 */
console.log('\nLADDERS — how each base weapon\'s property set moves across its three levels');
{
  let moved = 0;
  let flat = 0;
  for (const def of W.INSTRUMENTS) {
    if (def.fused) continue;
    const at = [1, 2, 3].map((lv) => W.instrumentProps(def.id, lv));
    const keys = PROP_FIELDS.filter((f) => at.some((p) => p[f] !== 0));
    const same = keys.every((k) => at[0][k] === at[2][k]);
    if (same) flat++;
    else moved++;
    console.log(
      `  ${def.label.padEnd(12)} ${keys.map((k) => `${k} ${at.map((p) => p[k]).join('/')}`).join('   ')}`,
    );
    for (const k of keys) {
      for (let lv = 1; lv < 3; lv++) {
        const worse = LOWER_IS_STRONGER.has(k) ? at[lv][k] > at[lv - 1][k] : at[lv][k] < at[lv - 1][k];
        if (worse) {
          fail(`${def.id} L${lv + 1} makes '${k}' weaker than L${lv} (${at[lv - 1][k]} -> ${at[lv][k]})`);
        }
      }
    }
  }
  console.log(`  ${moved} of ${moved + flat} base weapons move their property across the ladder`);
  if (moved + flat === 0) fail('no ladders were examined');
  else if (moved === 0) fail('not one base weapon changes its property when it levels — the ladder is stats only');
}

console.log('');
if (failures) { console.log(`PROPFIRE BROKEN — ${failures} failure(s)`); process.exit(1); }
console.log('PROPFIRE HOLDS — every property is installed, wired, applies, ticks and deals in a real run');

/*
 * FAIL-TEST LOG. AGENTS.md §3: a gate that has never been seen red is not
 * evidence, and it must be broken PER ASSERTION rather than once — "a check
 * with five assertions can pass its own fail-test on the strength of one while
 * the rest are dead". Each line below is an edit that was made, the check run,
 * the named message SEEN, and the edit undone by its inverse.
 *
 *   A  deleted `propFires.burn++` from `applyStatus`
 *      -> exit 1, "burn: N chances and it applied 0 times — installed and inert"
 *   B  guarded the whole `st & Status.Burn` tick branch with `false`
 *      -> exit 1, "burn: applied N times and ticked on 0 enemy-steps"
 *   C  deleted `propDamage.burn += d` from the tick
 *      -> exit 1, "burn: applied N times and removed 0 hit points"
 *   D  moved `propFires.bleed++` one line up, outside its own `if`
 *      -> exit 1, "a property fired with nothing installing it — bleed ..."
 *      This is the assertion the whole file rests on; without it every DYNAMIC
 *      row above passes for free.
 *   E  deleted PHANTOM's `props: { ghost: 1 }`
 *      -> exit 1, "draftable instruments with no property: phantom"
 *   F  set EMBER's L3 `burn` to 4, below its L2 of 10
 *      -> exit 1, "ember L3 makes 'burn' weaker than L2 (10 -> 4)"
 *   G  made `applyStatus`' poison branch also fire on `p.bleed`
 *      -> exit 1, "bleed's run (pizzicato) fired 'poison' N times, and nothing
 *         in it carries 'poison'"
 *   H  set `PROP.blindMiss` to 0
 *      -> exit 1, "blind: 44 attacks by blinded bodies and not one missed"
 *
 * TWO MORE WERE SEEN RED WITHOUT BEING PLANTED, which is better evidence than
 * a plant because neither was anticipated:
 *
 *   - the CROSS-CONTAMINATION block caught the harness itself: answering an
 *     offer let a card's instrument fire once inside the same `update`, and six
 *     `poison` fires appeared in the run that holds nothing but RASP. `force`
 *     suppresses offers outright now.
 *   - the CONTROL's moment check caught a `contact` count of zero under the
 *     dodging brain, which is why this file drives 'weave'.
 */
