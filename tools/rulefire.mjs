/*
 * rulefire — does each passive's RULE actually fire?
 *
 * THE DEFECT THIS EXISTS FOR. Until the passive overhaul, every rig item was a
 * multiplier, and a multiplier cannot be silently absent: `applyModifiers`
 * folds it into every stat block on every frame, so if the number is wrong you
 * see the wrong number. A RULE is different in kind. It waits for a moment —
 * a kill, a hit, an activation, a step taken — and if that moment never
 * arrives, or the branch guarding it is never true, the item does nothing at
 * all and everything downstream is perfectly happy. It type-checks, it appears
 * on the level-up card, it appears in the HUD, and it is inert. That is this
 * repository's single most recorded defect class and `docs/plan-passives.md`
 * flags it as the specific risk of the design it proposes.
 *
 * `tools/deadhunt-ranges.mjs` is the same idea for INSTRUMENT stats: it slices
 * each `fire*` routine out of `world.ts` and greps it for the stat names its
 * shape's instruments set. That technique cannot work here, because a rule is
 * not a stat name in a routine — it is a branch at a moment. So this measures
 * the OUTPUT instead: `World` keeps a monotonic `ruleFires` counter beside a
 * `ruleChances` denominator, and this drives a real world and reads them.
 *
 * FOUR QUESTIONS, in the order they matter:
 *
 *   1. **Is every `Rules` field installed by somebody?** A field declared in
 *      the interface and set by no passive is dead on arrival. Static.
 *   2. **Is every rule a passive installs actually WIRED?** Every key some
 *      passive sets must map to a counter, and every counter must map to a
 *      key. A rule with no counter cannot be measured and will rot.
 *   3. **Does each rule FIRE in a real run?** One run per rule-bearing passive,
 *      that passive alone forced to max, real `World`, real bot. Reported as
 *      fires over chances, and a chances count of zero is a FAILURE — a run
 *      that never produced the moment has measured nothing.
 *   4. **Is the counter measuring the RULE and not the run?** A control run
 *      with an empty rig must produce zero of everything. Without this, a
 *      counter incremented in the wrong place passes question 3 for free.
 *
 * Usage:  NODE_OPTIONS=--experimental-transform-types node tools/rulefire.mjs [seconds]
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const W = await import(`${R}game/weapons.ts`);

const DT = 1 / 120;
/*
 * 300s, and the number is set by the RAREST moment rather than by patience.
 * COMPRESSOR's ring needs the bot to be HIT, which `builds` measures at 25-67
 * times per 900s across pick policies — so a run much shorter than this can
 * legitimately produce zero hits and the tool would report a broken rule when
 * the run simply never asked. The denominator is printed so that case is
 * distinguishable, and it is a FAILURE either way: a check that examined
 * nothing must not report a pass.
 */
const SECS = Number(process.env.SECS ?? process.argv[2] ?? 300);
const STEPS = Math.round(SECS / DT);
const SEED = 0x51ed;

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

console.log(`\nrulefire — do the passives' rules actually fire? ${SECS}s per rule\n`);

/* ------------------------------------------------------- 1. the table wires up */

console.log('STATIC — every rule field, and who installs it');

/*
 * Read the field list off `noRules()` rather than restating it. A tool holding
 * its own copy of a constant will lie the day it moves, and the exact shape of
 * that lie here would be the worst one available: a rule added to `Rules` and
 * forgotten in this list would not be reported as broken, it would not be
 * reported at all.
 */
const RULE_FIELDS = Object.keys(W.noRules());
const installers = new Map(RULE_FIELDS.map((k) => [k, []]));
for (const def of W.RIG) {
  if (!def.rules) continue;
  for (const rung of def.rules) {
    for (const k of Object.keys(rung)) {
      if (!installers.has(k)) { fail(`rig ${def.id} sets '${k}', which is not a Rules field`); continue; }
      if (!installers.get(k).includes(def.id)) installers.get(k).push(def.id);
    }
  }
}
for (const k of RULE_FIELDS) {
  const who = installers.get(k);
  console.log(`  ${k.padEnd(18)} ${who.length ? who.join(', ') : 'NOBODY'}`);
  if (!who.length) fail(`Rules.${k} is declared and no passive installs it — dead on arrival`);
}
const ruleItems = W.RIG.filter((d) => d.rules);
console.log(`  ${ruleItems.length} of ${W.RIG.length} passives install a rule: ${ruleItems.map((d) => d.id).join(', ')}`);
if (failures === 0) pass('every rule field has an owner, and every owner sets a real field');

/*
 * The counter set and the rule set have to line up. `World.ruleFires` is the
 * only thing that can observe a rule, so a rule with no counter is unmeasurable
 * and a counter with no rule is measuring something this file does not know
 * about. Both are named here explicitly, and the mapping is asserted rather
 * than assumed — this is the hand-maintained seam and `deadhunt-ranges` records
 * what happens to those when nothing checks them.
 */
const COUNTER_OF = {
  overcharge: ['overchargeEvery', 'overchargeDamage'],
  killEcho: ['killEcho'],
  slowed: ['slowRadius'],
  hitNova: ['hitNova', 'hitNovaRadius'],
  charged: ['chargeSeconds', 'chargeDamage'],
  trail: ['trailDamage', 'trailRadius', 'trailLife', 'trailEvery'],
};
{
  const probe = new World(1);
  const counters = Object.keys(probe.ruleFires);
  const chances = Object.keys(probe.ruleChances);
  const mapped = new Set(Object.values(COUNTER_OF).flat());
  const missingCounter = counters.filter((c) => !COUNTER_OF[c]);
  const unknownCounter = Object.keys(COUNTER_OF).filter((c) => !counters.includes(c));
  const unmapped = RULE_FIELDS.filter((k) => !mapped.has(k));
  const noDenominator = counters.filter((c) => !chances.includes(c));
  if (missingCounter.length) fail(`World.ruleFires has counters this tool does not know: ${missingCounter.join(', ')}`);
  if (unknownCounter.length) fail(`this tool names counters World.ruleFires does not have: ${unknownCounter.join(', ')}`);
  if (unmapped.length) fail(`Rules fields with no counter, so unmeasurable: ${unmapped.join(', ')}`);
  if (noDenominator.length) fail(`counters with no denominator in ruleChances: ${noDenominator.join(', ')}`);
  if (!missingCounter.length && !unknownCounter.length && !unmapped.length && !noDenominator.length) {
    pass(`all ${counters.length} counters map to rule fields, and each has a denominator`);
  }
}

/* ---------------------------------------------------------- 2. a run per rule */

/**
 * Force one rig item to max and hold it there.
 *
 * Re-asserted every step rather than set once: the bot answers offers, so it
 * will happily pick up other passives, and an evolution CONSUMES its catalyst
 * (`applyFusion` deletes it). Either would make the run measure a different rig
 * from the one named in the column.
 */
function forceRig(w, id) {
  for (const k of Object.keys(w.progression.rig)) if (k !== id) delete w.progression.rig[k];
  if (id) w.progression.rig[id] = W.RIG_MAX_LEVEL;
}

/*
 * The bot PLANTS for three seconds out of every eight, and the plant is
 * load-bearing rather than flavour.
 *
 * FERMATA's charge is read off `World.idleTime`, which resets whenever the ship
 * leaves a 60px anchor — a bot that never stops never charges, and the check
 * would report FERMATA dead for a reason that is the harness's fault rather
 * than the rule's. Three seconds is inside `World.IDLE_GRACE_S` (4s), so the
 * plant is ordinary play and not camping; the arena does not start punishing it
 * and the run stays comparable to every other tool's.
 */
const PLANT_PERIOD = Math.round(8 / DT);
const PLANT_FOR = Math.round(3 / DT);

function run(rigId) {
  const w = new World(SEED);
  w.start();
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  for (let i = 0; i < STEPS; i++) {
    if (i % 2 === 0) drive(w, inp);
    /*
     * NEVER TAKE A RIG CARD. `forceRig` deletes foreign rig items every step,
     * but it runs BEFORE `update`, and `applyOfferInput` installs the card
     * inside `update` and a few lines before the rules are folded — so a rig
     * item the bot picked is live for exactly one step, and the counters see
     * it. Measured: the CONTROL run, which is supposed to prove that no rule
     * fires when no passive installs it, reported `killEcho fired 1`.
     *
     * Refusing rig cards closes the window at the source and costs the run
     * nothing this tool is measuring: the item under test is force-installed at
     * max every step regardless, and a second rig item was always noise
     * `forceRig` existed to delete.
     */
    if (w.choosing && w.offer) {
      const at = w.offer.options.findIndex((o) => o.slot !== 'rig');
      inp.choice = at >= 0 ? at : -1;
    } else {
      inp.choice = -1;
    }
    forceRig(w, rigId);
    if (i % PLANT_PERIOD < PLANT_FOR) { inp.x = 0; inp.y = 0; }
    w.update(DT, inp);
    if (w.phase === 'over') break;
  }
  return w;
}

/**
 * Make the moments HAPPEN, so a control run's zero means something.
 *
 * `ruleChances.hitNova` is incremented in `World.onPlayerHit`, which is to say
 * its denominator is "times the player was hit". That was a reliable event
 * while enemies fired: a bot planted for three seconds out of every eight was
 * shot several times in a five-minute run, and the control read `0 / 3`.
 *
 * With contact-only damage it is not reliable at all. Measured over three
 * 300-second runs of the same bot against a mean of 15-21 live enemies, hits
 * came out 0, 6 and 3 — the crowd closes at 245-330 px/s and the ship runs at
 * 430, so whether it is ever caught depends on the seed. On the seed this file
 * uses it was zero, and the control's own vacuity guard said so rather than
 * printing a pass, which is the behaviour this directory wants.
 *
 * The right fix is not a different seed and not a weaker guard: it is to stop
 * the guard depending on luck. Six bodies are parked ON the ship with its
 * invulnerability cleared, which exercises the real `collidePlayer` ->
 * `onPlayerHit` path and guarantees the denominator. Lives and bombs are
 * topped up so the run cannot end and no auto-bomb rescue intervenes.
 */
async function forceHits(w, n = 6) {
  const E = await import(`${R}game/enemies.ts`);
  const inp = { x: 0, y: 0, shoot: false, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  for (let k = 0; k < n; k++) {
    w.player.invuln = 0;
    w.player.dead = false;
    w.player.hp = w.player.maxHp;
    w.player.lives = 5;
    w.player.bombs = 0;
    const e = E.spawnEnemy('pluck', w.player.x, w.player.y, 0.5, false);
    e.move = () => {};
    w.enemies.push(e);
    for (let i = 0; i < 8; i++) w.update(DT, inp);
  }
}

console.log('\nDYNAMIC — one run per rule-bearing passive, that passive alone, forced to max');
/*
 * READ THE RATE COLUMN CAREFULLY; it is a diagnostic and not a gate, and three
 * of the six rows do not mean what a percentage usually means.
 *
 *   homing   counts BOLTS against KILLS, and level 3 throws three bolts per
 *            kill — so anything up to 300% is correct and 155% here is the
 *            ladder being partly below max early in the run.
 *   fermata  is sensitive to the harness: the bot plants on a schedule (see
 *            PLANT_PERIOD) and the `dodge` brain idles whenever nothing is
 *            near, so this number says more about the bot's habits than about
 *            the item. The assertion is that it is NOT ZERO.
 *   tempo    is per STEP at 120Hz against a drop every 60-80px, so a low
 *            single-digit percentage is the design working.
 */
console.log(`  ${'passive'.padEnd(12)} ${'counter'.padEnd(11)} ${'fired'.padStart(9)} / ${'chances'.padEnd(9)}  rate`);
console.log(`  ${'-'.repeat(12)} ${'-'.repeat(11)} ${'-'.repeat(9)}   ${'-'.repeat(9)}  ----`);

/** Which counter each rule-bearing passive is expected to move. */
const EXPECT = {};
for (const def of ruleItems) {
  const keys = new Set(def.rules.flatMap((r) => Object.keys(r)));
  for (const [counter, fields] of Object.entries(COUNTER_OF)) {
    if (fields.some((f) => keys.has(f))) EXPECT[def.id] = counter;
  }
}
if (Object.keys(EXPECT).length !== ruleItems.length) {
  fail(`only ${Object.keys(EXPECT).length} of ${ruleItems.length} rule passives map to a counter`);
}

for (const def of ruleItems) {
  const counter = EXPECT[def.id];
  if (!counter) continue;
  const w = run(def.id);
  const fired = w.ruleFires[counter];
  const chances = w.ruleChances[counter];
  const rate = chances ? ((fired / chances) * 100).toFixed(2) + '%' : '     n/a';
  console.log(
    `  ${def.id.padEnd(12)} ${counter.padEnd(11)} ${String(fired).padStart(9)} / ${String(chances).padEnd(9)}  ${rate}`,
  );
  /*
   * A zero DENOMINATOR is a failure and not a skip. AGENTS.md §3: zero and
   * clean look identical unless you print the count, and `treat checked === 0
   * as a failure` is the rule that came out of a check which threw on every
   * seed and exited green.
   */
  if (chances === 0) fail(`${def.id}: the run never produced the moment '${counter}' waits for — nothing was measured`);
  else if (fired === 0) fail(`${def.id}: ${chances} chances and the rule fired 0 times — installed and inert`);
}

/* --------------------------------------------------- 3. the control, which is the point */

/*
 * WITHOUT THIS THE WHOLE FILE IS DECORATION. A counter incremented one line too
 * high — outside its own `if` — passes every row above and measures the run
 * rather than the rule. The empty rig is the falsification: no passive, no
 * rule, and therefore no fire, whatever else the run does.
 *
 * The DENOMINATORS must still be non-zero here, and that is the second half of
 * the same argument: it proves the control run really did produce every moment,
 * so the zeros above it are the rules being absent rather than the run being
 * quiet.
 */
console.log('\nCONTROL — the same run with an EMPTY rig; every counter must read zero');
{
  const w = run(null);
  await forceHits(w);
  let clean = true;
  for (const counter of Object.keys(w.ruleFires)) {
    const fired = w.ruleFires[counter];
    const chances = w.ruleChances[counter];
    console.log(`  ${counter.padEnd(11)} ${String(fired).padStart(9)} / ${String(chances).padEnd(9)}`);
    if (fired !== 0) { clean = false; fail(`${counter} fired ${fired} times with no passive installing it`); }
    if (chances === 0) { clean = false; fail(`${counter}: the control run produced no chances, so its zero proves nothing`); }
  }
  if (clean) pass('no rule fires when no passive installs it, and every moment still occurred');
}

/* --------------------------------------------------------------- 4. the fold */

/*
 * The ladder has to MOVE. A rule whose three rungs fold to the same numbers is
 * HOMING's old `{homing:0.36/0.64/0.8}` in a new costume: three level-ups, one
 * behaviour, and nothing able to see it because the field was read.
 */
console.log('\nLADDERS — the folded rule set at each level of each rule passive');
const lower = new Set(W.RULE_LOWER_IS_STRONGER);
for (const def of ruleItems) {
  const at = [1, 2, 3].map((lv) => W.rigRules({ [def.id]: lv }));
  const keys = [...new Set(def.rules.flatMap((r) => Object.keys(r)))];
  console.log(`  ${def.id.padEnd(12)} ${keys.map((k) => `${k} ${at.map((r) => r[k]).join('/')}`).join('   ')}`);
  for (let lv = 1; lv < W.RIG_MAX_LEVEL; lv++) {
    if (keys.every((k) => at[lv][k] === at[lv - 1][k])) {
      fail(`${def.id} L${lv + 1} folds to exactly L${lv} — the rung buys nothing`);
    }
    /*
     * A LADDER MUST NOT GO BACKWARDS, and which direction is "backwards"
     * depends on the field — "every 3rd shot" is stronger than "every 5th".
     * `RULE_LOWER_IS_STRONGER` is imported rather than restated here, because a
     * tool holding its own copy of a constant will lie the day it moves, and a
     * copy of THIS one would lie by declaring a real regression to be an
     * improvement. `levelup.mjs` makes the same assertion for instrument dps.
     */
    for (const k of keys) {
      const worse = lower.has(k) ? at[lv][k] > at[lv - 1][k] : at[lv][k] < at[lv - 1][k];
      if (worse) fail(`${def.id} L${lv + 1} makes '${k}' weaker than L${lv} (${at[lv - 1][k]} -> ${at[lv][k]})`);
    }
  }
}
if (failures === 0) pass('every rung of every rule ladder changes the folded rule set, and none goes backwards');

console.log('');
if (failures) { console.log(`RULEFIRE BROKEN — ${failures} failure(s)`); process.exit(1); }
console.log('RULEFIRE HOLDS — every rule is installed, wired, and fires in a real run');
