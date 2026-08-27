/*
 * fusefire — is each AUTHORED FUSION a new behaviour, or is it two properties
 * in a trench coat?
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS FOR, AND IT IS INVISIBLE TO EVERY OTHER GATE.
 *
 * `synthesiseDuet` already merges both parents' properties, so ANY pair of
 * maxed instruments produces something that burns and freezes if its parents
 * burned and froze. That is the fallback and it is deliberately good. It also
 * means an authored fusion can be written, typed, drawn on a card, announced
 * with a banner and earned in a run while being EXACTLY the fallback wearing a
 * name — and `levelup`, `mirror`, `discovery`, `combine` and `propfire` would
 * every one of them stay green, because each of them is true of the fallback
 * too. Sixty-three names over sixty-three property merges is the third
 * rejected roster in a new costume: "samey weapons wearing modifier tags".
 *
 * So this file asks the one question none of the others can:
 *
 *   WHAT DOES THIS FUSION DO THAT ITS OWN PARENTS DO NOT — and does it fire?
 *
 * ---------------------------------------------------------------------------
 * NINE QUESTIONS.
 *
 *  1. ORDER DOES NOT MATTER. Ball x Pit's rule and `plan-refactor-3.md` §9d's.
 *     Measured both ways round rather than argued from the source.
 *  2. EVERY FUSION FREES A SLOT. Two instruments in, one out.
 *  3. NO PAIR HAS TWO RECIPES, and no authored pair is also reachable as a
 *     generic duet — taking the duet would burn the better result invisibly.
 *  4. A RESULT INHERITS BOTH PARENTS. Never weaker in properties.
 *  5. A RESULT IS NEVER WEAKER THAN THE DUET IT HIDES. `readyDuets` refuses a
 *     named pair, so the player CANNOT take the fallback instead; a weaker
 *     authored result is therefore a trap with no tell.
 *  6. EVERY RESULT IS DISTINCT FROM ITS OWN MERGE — a property neither parent
 *     carries, or a delivery shape the fallback would not have used. This is
 *     the static half of the headline question.
 *  7. EVERY DELTA PROPERTY FIRES IN A REAL RUN, with a denominator. The
 *     dynamic half, and the one that catches a distinctive property installed
 *     on a delivery shape that cannot express it — an `aura` cannot chain, a
 *     `strike` has no bolt to split.
 *  8. EVERY RESULT HAS A LANE AND A VOICE. An unmapped id is silent to the
 *     ensemble, so combining would trade two musicians for none.
 *  9. NO PAIR IS A DEAD END. All C(20,2) pairs resolve to something that
 *     carries properties and deals damage.
 *
 * Usage:  NODE_OPTIONS=--experimental-transform-types node tools/fusefire.mjs [seconds]
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const W = await import(`${R}game/weapons.ts`);
const P = await import(`${R}game/progression.ts`);
const O = await import(`${R}audio/orchestration.ts`);

const DT = 1 / 120;
/*
 * 45s per fusion, and the number is set by the RAREST delta.
 *
 * The thinnest denominators in the table are ASSASSIN's 7% execute and
 * VAMPIRE LORD's, on weapons that fire two to five bolts every half second.
 * The denominator is printed either way, so "the run never asked" and "the
 * property is broken" stay distinguishable — and both are failures.
 */
const SECS = Number(process.env.SECS ?? process.argv[2] ?? 45);
const SEED = 0x51f2;

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

const LATTICE = W.FUSIONS.filter((f) => f.kind === 'lattice');
const NAMES = W.PROPERTY_NAMES;
const FIELDS_OF = W.PROPERTIES;
const LOWER = new Set(W.PROP_LOWER_IS_STRONGER);

console.log(`\nfusefire — are the ${LATTICE.length} authored fusions new behaviours, or property merges? ${SECS}s each\n`);

/** Which property names a set actually installs. */
function propNames(p) {
  return NAMES.filter((n) => FIELDS_OF[n].some((f) => p[f] !== 0));
}

/** The merged parent set, exactly as `synthesiseDuet` builds it. */
function mergeOf(f) {
  return W.mergeProps(
    W.instrumentProps(f.base, W.maxLevelOf(f.base)),
    W.instrumentProps(f.catalyst, W.maxLevelOf(f.catalyst)),
  );
}

const dpsOf = (s) => (s.interval > 0 ? (s.damage * s.count) / s.interval : 0);

/* ==================================================================== 1-3 */

console.log('STRUCTURE — order, slots, and one recipe per pair');

{
  /*
   * ORDER INDEPENDENCE, AND THE FIRST VERSION OF THIS CHECK WAS VACUOUS.
   *
   * It built the books twice with the two ids inserted in the opposite order
   * and compared what `readyFusions` offered. That can never differ:
   * `readyFusions` iterates the FUSIONS table and looks each id up, so the
   * insertion order of a plain object is not an input to it. Planted an
   * asymmetric level requirement to check — and the check stayed green, which
   * is AGENTS.md 3's "a ready row has away: 0 and every aim has at least 1"
   * reproduced exactly.
   *
   * What "order does not matter" actually means for a lattice is that the
   * table's own choice of which half to call `base` is arbitrary. So the
   * recipes are SWAPPED IN PLACE and the whole readiness surface is compared:
   * every recipe against every combination of levels its two inputs can hold,
   * 0 through their ceilings. An asymmetric requirement now shows up as a pair
   * that is ready one way round and not the other, which is what a player
   * would experience as "I levelled them in the wrong order".
   *
   * The mutation is undone in the same block, so nothing downstream sees it.
   */
  let checked = 0;
  let mismatched = 0;
  const levelsOf = (id) => Array.from({ length: W.maxLevelOf(id) + 1 }, (_, n) => n);

  /*
   * THE AXES ARE THE TWO IDS, NOT THE RECIPE'S BASE AND CATALYST, and getting
   * that wrong made the first rewrite vacuous too. Indexing the surface by
   * `f.base`/`f.catalyst` swaps the axes at the same moment the recipe swaps,
   * so an asymmetric requirement produces an identical string. Planted
   * `need(catalyst) = 1` and the check stayed green; pinned to `idA`/`idB` it
   * goes red, which is the second time this one assertion had to be broken
   * deliberately before it was worth anything.
   */
  function surface(f, idA, idB) {
    const out = [];
    for (const la of levelsOf(idA)) {
      for (const lb of levelsOf(idB)) {
        const st = P.createProgression(1);
        st.instruments = {};
        if (la > 0) st.instruments[idA] = la;
        if (lb > 0) st.instruments[idB] = lb;
        out.push(P.readyFusions(st).some((r) => r.result === f.result) ? '1' : '0');
      }
    }
    return out.join('');
  }

  for (const f of LATTICE) {
    const idA = f.base;
    const idB = f.catalyst;
    const before = surface(f, idA, idB);
    // Swap which half the table calls the base. `FUSIONS` is `readonly` to the
    // type system and a plain mutable object at runtime, which is what lets
    // this be a measurement rather than a re-implementation.
    const b = f.base;
    f.base = f.catalyst;
    f.catalyst = b;
    const after = surface(f, idA, idB);
    f.catalyst = f.base;
    f.base = b;
    checked++;
    if (before !== after) {
      mismatched++;
      fail(`${f.result}: ready-surface ${before} with ${idA} as base, ${after} with ${idB} as base — the order the pair was levelled in matters`);
    }
    if (!before.endsWith('1')) {
      fail(`${f.result}: both inputs at their ceiling and the recipe is not ready — it can never be made`);
    }
  }
  console.log(`  ${checked} recipes, each over every level pair its inputs can hold, tested with the recipe written both ways round`);
  console.log(`  ${mismatched} disagreed`);
  if (checked === 0) fail('no recipe was checked for order independence — this proved nothing');
  else if (mismatched === 0) pass('which half the table calls the base changes nothing a player can reach');
}

{
  /*
   * EVERY FUSION FREES A SLOT. Two instruments go in, one comes out, so the
   * stand has room for something else. `applyFusion` is the only place the
   * books are mutated by a fusion, so it is what is run — not a re-derivation
   * of what it is supposed to do.
   */
  let checked = 0;
  let bad = 0;
  for (const f of LATTICE) {
    const st = P.createProgression(2);
    st.instruments = { [f.base]: W.maxLevelOf(f.base), [f.catalyst]: W.maxLevelOf(f.catalyst) };
    const before = Object.keys(st.instruments).length;
    const ready = P.readyFusions(st).find((r) => r.result === f.result);
    if (!ready) { fail(`${f.result}: not ready with both inputs maxed`); continue; }
    if (!ready.freedSlot) { bad++; fail(`${f.result}: does not report freeing a slot`); }
    P.applyFusion(st, ready);
    const after = Object.keys(st.instruments).length;
    checked++;
    if (after !== before - 1) {
      bad++;
      fail(`${f.result}: held ${before} instruments before and ${after} after — a fusion must give a chair back`);
    }
    if (st.instruments[f.base] || st.instruments[f.catalyst]) {
      bad++;
      fail(`${f.result}: an input survived the fusion`);
    }
    if (st.instruments[f.result] !== W.maxLevelOf(f.result)) {
      bad++;
      fail(`${f.result}: seated at ${st.instruments[f.result]} rather than its ceiling ${W.maxLevelOf(f.result)}`);
    }
  }
  console.log(`  ${checked} fusions applied for real, ${bad} failed to free a chair or spend an input`);
  if (checked === 0) fail('no fusion was applied — the slot claim proved nothing');
  else if (bad === 0) pass('every fusion spends both inputs and hands a stand slot back');
}

{
  // One recipe per unordered pair, and no authored pair also reachable as a duet.
  const byPair = new Map();
  let dupes = 0;
  for (const f of W.FUSIONS) {
    const key = W.duetId(f.base, f.catalyst);
    if (byPair.has(key)) { dupes++; fail(`the pair ${key} has two recipes: ${byPair.get(key)} and ${f.result}`); }
    byPair.set(key, f.result);
  }
  /*
   * And the shadowing actually works. `readyDuets` skips any pair named in
   * `FUSIONS`; if it did not, a player could take `A × B` and burn the
   * authored result for the run without the two cards looking any different.
   */
  let shadowed = 0;
  for (const f of LATTICE) {
    const st = P.createProgression(3);
    st.instruments = { [f.base]: W.maxLevelOf(f.base), [f.catalyst]: W.maxLevelOf(f.catalyst) };
    const duets = P.readyDuets(st);
    if (duets.some((d) => W.duetId(d.base, d.catalyst) === W.duetId(f.base, f.catalyst))) {
      fail(`${f.result}: its pair is ALSO offered as a generic duet — taking that burns the authored result`);
    } else shadowed++;
  }
  console.log(`  ${byPair.size} distinct pairs across ${W.FUSIONS.length} recipes; ${shadowed} authored pairs shadow their duet`);
  if (dupes === 0 && shadowed === LATTICE.length) pass('one recipe per pair, and each shadows the generic pairing');
}

/* ====================================================================== 4-6 */

console.log('\nDISTINCTNESS — what does each fusion do that its own parents do not?');

/*
 * TWO WAYS TO BE DISTINCT, and both are measured against the FALLBACK rather
 * than against the parents, because the fallback is the thing the authored
 * result replaces:
 *
 *   P  a property neither parent installs. The strong form.
 *   S  a delivery shape the generic duet would not have used. `synthesiseDuet`
 *      takes the FIRST parent's shape by canonical (sorted) id, so this is
 *      computed from the same rule rather than from a guess.
 *
 * A result that is neither is a property merge with a name on it, and that is
 * the defect this file exists to hunt.
 *
 * TWO FIELDS MAY BE DROPPED and only two. `heavy` and `dark` multiply damage
 * inside `fireInstruments` for every shape, while heavy's cost (slower bolts)
 * and dark's cost (the weapon goes silent) are both paid in the BULLET path —
 * so on an aura, a field, a lance or a strike they would be a free 2.75x or
 * 3.6x. Anything else dropped is a result quietly weaker than its fallback.
 */
const DROPPABLE = new Set(['heavy', 'dark', 'darkCooldown']);
const rows = [];
{
  let weaker = 0;
  let merges = 0;
  let dropped = 0;
  const classes = { P: 0, S: 0, PS: 0 };
  for (const f of LATTICE) {
    const def = W.instrumentDef(f.result);
    const merged = mergeOf(f);
    const own = W.instrumentProps(f.result, W.maxLevelOf(f.result));

    // 4. inherits both parents
    for (const k of Object.keys(own)) {
      if (merged[k] === 0) continue;
      const ok = LOWER.has(k) ? own[k] > 0 && own[k] <= merged[k] : own[k] >= merged[k];
      if (ok) continue;
      if (DROPPABLE.has(k) && own[k] === 0) { dropped++; continue; }
      fail(`${f.result}: '${k}' is ${own[k]} where the merge of its parents is ${merged[k]} — weaker than the fallback`);
    }

    // 5. not weaker than the duet it hides
    const duet = W.instrumentDef(W.duetId(f.base, f.catalyst));
    const mine = dpsOf(W.instrumentStats(f.result, W.maxLevelOf(f.result)));
    const theirs = duet ? dpsOf(W.instrumentStats(duet.id, W.maxLevelOf(duet.id))) : 0;
    if (theirs > 0 && mine < theirs) {
      weaker++;
      fail(`${f.result}: ${mine.toFixed(0)} nominal dps against the duet's ${theirs.toFixed(0)} — the authored result is the worse card`);
    }

    // 6. distinct
    const deltaNames = propNames(own).filter((n) => !FIELDS_OF[n].some((k) => merged[k] !== 0));
    const fallbackShape = duet ? duet.shape : def.shape;
    const shapeMoved = def.shape !== fallbackShape;
    const cls = deltaNames.length && shapeMoved ? 'PS' : deltaNames.length ? 'P' : shapeMoved ? 'S' : '-';
    if (cls === '-') {
      merges++;
      fail(`${f.result}: carries no property its parents lack and keeps the fallback's '${def.shape}' — it IS the property merge`);
    } else classes[cls]++;
    rows.push({ f, def, deltaNames, cls, mine, theirs, fallbackShape });
  }
  console.log(
    `  ${LATTICE.length} fusions: ${classes.P} carry a new property, ${classes.PS} carry one AND change shape, ` +
      `${classes.S} change shape only, ${merges} are a bare merge`,
  );
  console.log(`  ${dropped} heavy/dark field(s) dropped on shapes that cannot pay for them; ${weaker} weaker than their own fallback`);
  if (rows.length === 0) fail('no fusion was examined — this proved nothing');
  else if (merges === 0 && weaker === 0) pass('every authored fusion differs from the merge of its own parents');
}

/* ======================================================================== 8 */

console.log('\nVOICE — every result has a stem lane and a firing sound');
{
  const FAMILIES = new Set(['aggressive', 'mechanical', 'mournful', 'shimmering', 'heavy', 'eerie']);
  let unmapped = 0;
  let voiceless = 0;
  for (const f of LATTICE) {
    const def = W.instrumentDef(f.result);
    if (O.abilityStems(f.result).length === 0) { unmapped++; fail(`${f.result} has no ENSEMBLE_MIX lane — silent to the band`); }
    const fam = String(def.character).split('—')[0].trim();
    if (!FAMILIES.has(fam)) { voiceless++; fail(`${f.result}'s character family '${fam}' is not one audio/sfx.ts can voice`); }
  }
  // And the whole roster, not just the new rows, so this cannot pass by only
  // looking at what was added today.
  const all = W.INSTRUMENTS.filter((d) => O.abilityStems(d.id).length === 0);
  console.log(`  ${LATTICE.length} results checked, ${unmapped} unmapped, ${voiceless} with no voiceable family`);
  console.log(`  ${W.INSTRUMENTS.length} instruments in the whole table, ${all.length} unmapped`);
  if (all.length) fail(`instruments with no ensemble lane: ${all.map((d) => d.id).join(', ')}`);
  else pass('0 of the roster is unmapped — every fusion joins the band it came from');
}

/* ======================================================================== 9 */

console.log('\nFALLBACK — no pair of base instruments is a dead end');
{
  const bases = W.INSTRUMENTS.filter((d) => !d.fused).map((d) => d.id);
  const named = new Set(W.FUSIONS.map((f) => W.duetId(f.base, f.catalyst)));
  let pairs = 0;
  let authored = 0;
  let generic = 0;
  let broken = 0;
  for (let i = 0; i < bases.length; i++) {
    for (let j = i + 1; j < bases.length; j++) {
      pairs++;
      const id = W.duetId(bases[i], bases[j]);
      if (named.has(id)) { authored++; continue; }
      const def = W.instrumentDef(id);
      if (!def) { broken++; fail(`${id} resolves to nothing — the pair is a dead end`); continue; }
      const props = W.instrumentProps(id, W.maxLevelOf(id));
      const dps = dpsOf(W.instrumentStats(id, W.maxLevelOf(id)));
      const inherits = propNames(props).length;
      if (!W.hasProps(props)) { broken++; fail(`${id} carries no property at all — the fallback dropped both parents`); }
      if (!(dps > 0)) { broken++; fail(`${id} deals no damage`); }
      if (inherits === 0) broken++;
      generic++;
    }
  }
  console.log(`  C(${bases.length},2) = ${pairs} pairs: ${authored} authored, ${generic} generic duets, ${broken} broken`);
  if (pairs === 0) fail('no pairs were enumerated');
  else if (broken === 0) pass(`every one of the ${pairs} pairs produces something that carries properties and deals damage`);
}

/* ======================================================================== 7 */

/** Force a loadout and hold it there. Same argument as `propfire`'s `force`. */
function force(w, ids) {
  for (const k of Object.keys(w.progression.instruments)) if (!ids.includes(k)) delete w.progression.instruments[k];
  for (const id of ids) w.progression.instruments[id] = W.maxLevelOf(id);
  for (const k of Object.keys(w.progression.rig)) delete w.progression.rig[k];
  w.progression.pending = 0;
  w.progression.offer = null;
}

/*
 * A FLOOR UNDER THE ENEMY COUNT, AND IT IS THE REASON THIS FILE MEASURES
 * ANYTHING AT ALL.
 *
 * Measured first without it: a 20s run holding BOMB produced 15 hits, ended
 * with ONE enemy alive and spent most of its time in `spawning`. A fusion
 * arrives seated at its ceiling with no rig and no second weapon, which is a
 * loadout that clears a wave faster than the wave curve refills it — so the
 * denominators were not small because the properties were rare, they were
 * small because there was nothing to shoot. Every row read 0/0.
 *
 * Holding fourteen bodies in the ring the weapons actually reach is the same
 * kind of harness shaping `propfire` does when it drives the WEAVING brain
 * rather than the dodging one, and `rulefire` when it plants the bot for three
 * seconds in eight: it produces the moment, it does not fake the answer. The
 * chances column is still a real count of real rolls against real bodies, and
 * a property that does not fire against fourteen enemies is broken.
 *
 * Pushed straight into `w.enemies`, exactly as `aimcheck`, `hitrate`, `ttk`
 * and `contactcheck` already do.
 *
 * ---------------------------------------------------------------------------
 * AND THREE IN FOUR OF THEM ARE DURABLE, WHICH IS A SECOND FINDING RATHER THAN
 * A CONVENIENCE. `World.collidePlayerBullets` calls `hurt` BEFORE
 * `applyStatus`, and `applyStatus` returns on `!e.alive` — so a hit that kills
 * writes no status, which is right (a corpse carries nothing) and which means
 * an OVERKILL hit is indistinguishable from a broken property.
 *
 * Measured, that is not hypothetical: at natural wave-1 health every one of
 * HEMORRHAGE, TEMPER, SHADE, ASSASSIN and REAPER one-shot every body it
 * touched, and reported 0 chances on the very property that makes it distinct
 * while its bolts were landing seventy times a minute. A fusion arrives at
 * 2.5x a maxed base and there is nothing in the early field it does not
 * delete.
 *
 * So most bodies are given enough health to survive a fusion-tier hit — the
 * target-dummy trick `ttk.mjs` and `hitrate.mjs` already use — and one in four
 * is left at its natural health so kills, drops and the wave clock still
 * happen. It is worth saying plainly what this does NOT prove: that these
 * statuses matter against trash in a real run. They largely do not, and that
 * is a fact about overkill rather than about the properties.
 */
const FLOOR = 14;
const TOPUP_EVERY = 0.25;
/*
 * The dummy's health is DERIVED FROM THE WEAPON UNDER TEST rather than fixed,
 * and the fixed version is why. At a flat 1,200 the three NOCTURNE-descended
 * results — SACRIFICE, SHADE and EVENT HORIZON, whose inherited `dark` puts a
 * 3.6x multiplier on an already-fusion-tier hit — still one-shot every dummy
 * and still reported 0 chances. Chasing the number upward is how a harness
 * ends up encoding a constant it will be wrong about later; four hits of
 * whatever is actually being measured is the property that was wanted all
 * along.
 */
const DUMMY_HITS = 4;
const ARCHETYPES = ['pluck', 'stutter', 'arpeggiator', 'rush', 'subdrop'];
const { spawnEnemy } = await import(`${R}game/enemies.ts`);

/** What one bolt of `id` actually removes, multipliers included. */
function perHit(id) {
  const s = W.instrumentStats(id, W.maxLevelOf(id));
  const p = W.instrumentProps(id, W.maxLevelOf(id));
  return s.damage * Math.max(1, p.heavy) * Math.max(1, p.dark);
}

function topUp(w, k, hp) {
  let live = 0;
  for (const e of w.enemies) if (e.alive) live++;
  for (let i = live; i < FLOOR; i++) {
    const ang = (k * 2.39996 + i * 0.7) % (Math.PI * 2);
    const rad = 240 + ((i * 37 + k * 13) % 200);
    const e = spawnEnemy(
      ARCHETYPES[(k + i) % ARCHETYPES.length],
      w.player.x + Math.cos(ang) * rad,
      w.player.y + Math.sin(ang) * rad,
      0.5,
      220,
      i % 3 === 0,
    );
    if (i % 4 !== 3) e.hp = e.maxHp = hp;
    w.enemies.push(e);
  }
}

function run(ids, secs = SECS) {
  const w = new World(SEED);
  w.starter = ids[0];
  w.start();
  const drive = makeBrain('weave');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  const steps = Math.round(secs / DT);
  const every = Math.round(TOPUP_EVERY / DT);
  const hp = Math.max(600, Math.round(DUMMY_HITS * perHit(ids[0])));
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    if (i % every === 0) topUp(w, i / every, hp);
    inp.choice = w.choosing ? 0 : -1;
    force(w, ids);
    w.update(DT, inp);
    w.shocks.length = 0;
    w.player.lives = Math.max(3, w.player.lives);
    // Alive, and one point down, so a leech delta has somewhere to put a heal.
    w.player.hp = Math.min(Math.max(1, w.player.hp), Math.max(1, w.player.maxHp - 1));
    w.player.dead = false;
    if (w.phase === 'over') break;
  }
  return w;
}

console.log(`\nFIRES — one ${SECS}s run per fusion, holding nothing but that fusion`);
console.log(
  `  ${'fusion'.padEnd(15)} ${'cls'.padEnd(3)} ${'delta'.padEnd(22)} ${'fired'.padStart(7)} /${'chances'.padStart(8)}` +
    `  ${'ticks'.padStart(8)}  ${'damage'.padStart(8)}`,
);
console.log(`  ${'-'.repeat(15)} ${'-'.repeat(3)} ${'-'.repeat(22)} ${'-'.repeat(7)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}`);

const fired = new Map(NAMES.map((n) => [n, 0]));
let deltasChecked = 0;
let deltasDead = 0;
let deltasUnasked = 0;

for (const r of rows) {
  const id = r.f.result;
  const w = run([id]);
  const cells = [];
  for (const n of r.deltaNames) {
    const f = n === 'accel' ? w.playerBullets.accelerated : w.propFires[n];
    const c = n === 'accel' ? w.playerBullets.bounced : w.propChances[n];
    cells.push({ n, f, c, t: w.propTicks[n], d: w.propDamage[n] });
    fired.set(n, fired.get(n) + f);
  }
  const sum = (k) => cells.reduce((a, x) => a + x[k], 0);
  console.log(
    `  ${id.padEnd(15)} ${r.cls.padEnd(3)} ${(r.deltaNames.join(',') || '(shape only)').padEnd(22)}` +
      ` ${String(sum('f')).padStart(7)} /${String(sum('c')).padStart(8)}  ${String(sum('t')).padStart(8)}  ${sum('d').toFixed(0).padStart(8)}`,
  );
  for (const c of cells) {
    deltasChecked++;
    if (c.c === 0) {
      deltasUnasked++;
      fail(`${id}: its distinctive property '${c.n}' was never even ROLLED in ${SECS}s — the shape cannot express it`);
    } else if (c.f === 0) {
      deltasDead++;
      fail(`${id}: '${c.n}' had ${c.c} chances and fired 0 times — the fusion is its parents' merge in practice`);
    }
  }
  // A shape-only fusion still has to be able to fire SOMETHING, or the shape
  // change was cosmetic and the properties are all inert on it.
  if (r.deltaNames.length === 0) {
    let any = 0;
    for (const n of NAMES) any += n === 'accel' ? w.playerBullets.accelerated : w.propFires[n];
    if (any === 0) fail(`${id}: changes shape and fires no property at all on it — every inherited property is inert`);
  }
}

console.log(`\n  ${deltasChecked} distinctive properties across ${rows.length} fusions; ${deltasUnasked} never rolled, ${deltasDead} rolled and never fired`);
if (deltasChecked === 0) fail('no distinctive property was measured — the FIRES section proved nothing');
else if (deltasUnasked === 0 && deltasDead === 0) pass('every fusion\'s distinctive property fires in a real run');

/* -------------------------------------- the three fusion-only properties */

/*
 * `propfire` hands these over rather than measuring them, because no forced
 * BASE loadout can reach them — they exist only on the lattice. Its assertion
 * and this one are the two halves that replaced its old single "every property
 * has a base carrier". See the note beside `FUSION_ONLY_PROPERTIES`.
 */
console.log('\nFUSION-ONLY PROPERTIES — the three the lattice introduces');
{
  for (const n of W.FUSION_ONLY_PROPERTIES) {
    const total = fired.get(n) ?? 0;
    const carriers = LATTICE.filter((f) => FIELDS_OF[n].some((k) => W.instrumentProps(f.result, W.maxLevelOf(f.result))[k] !== 0));
    console.log(`  ${n.padEnd(8)} installed by ${String(carriers.length).padStart(2)} fusions, fired ${total} times across the runs above`);
    if (carriers.length === 0) fail(`${n} is declared fusion-only and no fusion installs it`);
    if (total === 0) fail(`${n} never fired in any of the ${rows.length} runs — installed and inert`);
  }
  /*
   * AND EACH ONE HAS TO BE WORTH SOMETHING, not merely to have fired. Vuln
   * removes no hit points on its own clock — its whole payoff is what every
   * OTHER source then does to the softened body — so a fire count is not
   * evidence and `propDamage` is. Same argument `propfire` makes for blind.
   */
  const probe = { vuln: 'frostfire', rend: 'hemorrhage', execute: 'assassin' };
  for (const [n, id] of Object.entries(probe)) {
    const w = run([id]);
    const f = w.propFires[n];
    const c = w.propChances[n];
    const d = w.propDamage[n];
    console.log(`  ${n.padEnd(8)} in a ${SECS}s ${id.toUpperCase()} run: ${f}/${c} fires, ${w.propTicks[n]} ticks, ${d.toFixed(0)} hit points`);
    if (c === 0) fail(`${n}: ${id} never produced the moment it waits for — nothing was measured`);
    else if (f === 0) fail(`${n}: ${c} chances and 0 fires on ${id}`);
    else if (!(d > 0)) fail(`${n}: fired ${f} times on ${id} and removed 0 hit points — it fires and does nothing`);
  }
}

console.log('');
if (failures) { console.log(`FUSEFIRE BROKEN — ${failures} failure(s)`); process.exit(1); }
console.log(`FUSEFIRE HOLDS — ${LATTICE.length} authored fusions, each distinct from its own parents and each firing what makes it so`);

/*
 * FAIL-TEST LOG. AGENTS.md §3: a gate never seen red is not evidence, and it
 * must be broken PER ASSERTION rather than once — "a check with five
 * assertions can pass its own fail-test on the strength of one while the rest
 * are dead". Each line is an edit that was MADE, the check run, the named
 * message SEEN, and the edit undone by its inverse. Nothing was committed
 * broken and no file was reverted with git.
 *
 *   A  made `readyFusions`' level requirement asymmetric — `need` returns 1
 *      for the catalyst and `maxLevelOf` for the base
 *      -> exit 1, "detonate: ready-surface 0000000000000111 with ember as
 *         base, 0000000100010001 with anvil as base"
 *   B  made `applyFusion` keep a lattice's catalyst instrument
 *      -> exit 1, "detonate: held 2 instruments before and 2 after"
 *   C  dropped lattice recipes out of `readyDuets`' `named` set
 *      -> exit 1, "detonate: its pair is ALSO offered as a generic duet"
 *   D  set VENOM's inherited freeze to 0.02, below GLASS's 0.12
 *      -> exit 1, "venom: 'freeze' is 0.02 where the merge of its parents is
 *         0.12 — weaker than the fallback"
 *   E  deleted FROSTFIRE's `vuln`, leaving it burn + freeze on `seek`
 *      -> exit 1, "frostfire: carries no property its parents lack and keeps
 *         the fallback's 'seek' — it IS the property merge"
 *   F  cut FROSTFIRE's damage from 37 to 5
 *      -> exit 1, "frostfire: 50 nominal dps against the duet's 346"
 *   G  removed BOMB's `ENSEMBLE_MIX` row
 *      -> exit 1, "detonate has no ENSEMBLE_MIX lane — silent to the band"
 *   H  changed BOMB's character family to a word `audio/sfx.ts` cannot voice
 *      -> exit 1, "detonate's character family 'thunderous' is not one
 *         audio/sfx.ts can voice"
 *   I  guarded `onHit`'s execute roll with `false &&`
 *      -> exit 1, "vampirelord: 'execute' had 343 chances and fired 0 times"
 *   J  made `applyStatus` write 0 vuln stacks instead of accumulating
 *      -> exit 1, "vuln: fired 191 times on frostfire and removed 0 hit
 *         points — it fires and does nothing"
 *   K  replaced `synthesiseDuet`'s merged props with `noProps()`
 *      -> exit 1, "ember+tremolo carries no property at all"
 *   L  added a second recipe over an existing pair
 *      -> exit 1, "the pair chime+ember has two recipes: sun2 and frostfire"
 *
 * FOUR MORE WERE SEEN RED WITHOUT BEING PLANTED, which is better evidence than
 * a plant because none of the four was anticipated:
 *
 *   - the dps floor failed on ALL SIXTY-THREE rows at once, because the
 *     authoring script targeted 1.6x the better parent against
 *     `synthesiseDuet`'s stated 1.5x — and a duet then runs its own two level
 *     steps and lands at 2.31x. The factor is measured off a real duet now.
 *   - "its distinctive property was never even ROLLED" fired on eight rows
 *     whose identity sat on a delivery shape that cannot express it: a `field`
 *     cannot chain or brood, a `strike` has no bolt to burst. LIGHTNING BUG,
 *     CATAPULT, SPIDER QUEEN, FLESH MOUND, ROD and LANDSLIDE all moved shape
 *     because of it.
 *   - the same message fired on five more — HEMORRHAGE, TEMPER, SHADE,
 *     ASSASSIN, REAPER — for a completely different reason: they one-shot
 *     every body they touched, and `applyStatus` returns on `!e.alive`. That
 *     is what `DUMMY_HITS` exists for, and it is a real finding about overkill
 *     rather than a harness detail.
 *   - "changes shape and fires no property at all on it" caught FLICKER,
 *     whose only remaining property was inert on the shape it had been given.
 *
 * AND TWO VERSIONS OF THE ORDER CHECK WERE VACUOUS BEFORE THIS ONE. The first
 * compared object key insertion order, which `readyFusions` cannot read. The
 * second swapped the recipe AND the axes it was measured on, so an asymmetric
 * requirement produced an identical string. Both stayed green under plant A.
 * That is the AGENTS.md §3 lesson twice in one file.
 */
