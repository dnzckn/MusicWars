/*
 * discovery — the cross-run collection, and whether it can be finished.
 *
 * `game/discovery.ts` gives the player a target: fourteen authored
 * arrangements, counted on the title screen and persisted between runs. A
 * collection is only worth offering if every entry can actually be obtained,
 * and that is not obvious here — the two named UNIONS take evolved
 * instruments as inputs, which are themselves earned rather than drafted, so
 * finishing the set depends on a chain three levels deep. One undraftable
 * input anywhere in that chain would leave a permanently empty slot in a
 * counter the player is being invited to fill.
 *
 * Checks, in order of how badly they would hurt:
 *   1. every recipe's inputs are OBTAINABLE — drafted for a base instrument or
 *      rig item, produced by another recipe for an evolved one;
 *   2. the counting logic is right, including that it ignores ids it does not
 *      own (a synthesised duet, or a stale save from an older table);
 *   3. the line the title screen shows says something true at 0, mid and full.
 */
import './lib/headless-audio.mjs';
const R = new URL('../src/', import.meta.url).pathname;
const W = await import(`${R}game/weapons.ts`);
const D = await import(`${R}game/discovery.ts`);

const fails = [];
const draftableInstruments = new Set(W.INSTRUMENTS.filter((d) => !d.fused && d.weight > 0).map((d) => d.id));
const draftableRig = new Set(W.RIG.filter((d) => d.weight > 0).map((d) => d.id));
const producedByRecipe = new Set(W.FUSIONS.map((f) => f.result));

/** Can this id ever end up in a loadout? */
function obtainable(id, depth = 0) {
  if (depth > 6) return false;
  if (draftableInstruments.has(id) || draftableRig.has(id)) return true;
  const recipe = W.FUSIONS.find((f) => f.result === id);
  if (!recipe) return false;
  return obtainable(recipe.base, depth + 1) && obtainable(recipe.catalyst, depth + 1);
}

const rows = [];
for (const f of W.FUSIONS) {
  const baseOk = obtainable(f.base);
  const catOk = obtainable(f.catalyst);
  rows.push([f.result, f.kind, f.base, baseOk, f.catalyst, catOk]);
  if (!baseOk) fails.push(`${f.result} needs "${f.base}", which can never be obtained`);
  if (!catOk) fails.push(`${f.result} needs "${f.catalyst}", which can never be obtained`);
}

/* 2. The counting logic. */
const seen = new Set();
if (D.record(seen, 'spiccato') !== true) fails.push('record() did not report a first discovery as new');
if (D.record(seen, 'spiccato') !== false) fails.push('record() reported a repeat as new');
if (D.record(seen, 'pizzicato+snare') !== false) fails.push('record() accepted a synthesised duet id');
if (D.record(seen, 'not-a-thing') !== false) fails.push('record() accepted an unknown id');
if (seen.size !== 1) fails.push(`the set holds ${seen.size} after one real find and three rejects, want 1`);
const mid = D.summary(seen);
if (mid.found !== 1 || mid.total !== W.FUSIONS.length) {
  fails.push(`summary said ${mid.found}/${mid.total}, want 1/${W.FUSIONS.length}`);
}
if (mid.missing.includes('spiccato')) fails.push('summary listed a found arrangement as missing');

const all = new Set(D.DISCOVERABLE);
const full = D.summary(all);
if (full.found !== full.total || full.missing.length) fails.push('a complete set did not read as complete');

/*
 * 3. The codex grid, and the one property it must never break.
 *
 * A discovered row hands over its recipe; an undiscovered row hands over
 * nothing but the fact that it exists. That asymmetry IS the feature — print
 * the recipes up front and the tree is given away, print nothing and the count
 * means nothing. The leak is the easy mistake: a row that shows `???` but
 * names `PIZZICATO + CAPO` underneath has told the player everything.
 */
const partial = new Set(['spiccato', 'requiem']);
const grid = D.codex(partial);
if (grid.length !== W.FUSIONS.length) fails.push(`codex has ${grid.length} rows, want ${W.FUSIONS.length}`);
const allLabels = W.FUSIONS.map((f) => W.labelOf(f.result));
for (const row of grid) {
  if (row.found) {
    if (!row.recipe.includes('+')) fails.push(`${row.label} is found but shows no recipe`);
    if (row.id === null) fails.push(`${row.label} is found but carries no id`);
    continue;
  }
  if (row.id !== null) fails.push('an undiscovered row carries the result id');
  if (allLabels.includes(row.label)) fails.push(`an undiscovered row leaks its name: "${row.label}"`);
  // The inputs must not appear either — naming them is the recipe.
  for (const f of W.FUSIONS) {
    const inputs = [W.labelOf(f.base), W.labelOf(f.catalyst)];
    for (const i of inputs) {
      if (row.recipe.includes(i)) fails.push(`an undiscovered row leaks an input: "${row.recipe}"`);
    }
  }
}
const foundRows = grid.filter((r) => r.found).length;
if (foundRows !== partial.size) fails.push(`codex marked ${foundRows} rows found, want ${partial.size}`);

/* 4. The line, at each end. */
const lines = [D.discoveryLine(new Set()), D.discoveryLine(seen), D.discoveryLine(all)];
if (lines[0] === lines[1] || lines[1] === lines[2]) fails.push('the title line does not change between empty, partial and complete');
if (!/\ball\b/.test(lines[2])) fails.push(`the complete line does not say so: "${lines[2]}"`);

console.log(`\ndiscovery — ${W.FUSIONS.length} authored arrangements\n`);
console.log(`  ${'result'.padEnd(14)} ${'kind'.padEnd(10)} inputs`);
console.log(`  ${'-'.repeat(14)} ${'-'.repeat(10)} ${'-'.repeat(40)}`);
for (const [res, kind, base, bOk, cat, cOk] of rows) {
  console.log(`  ${res.padEnd(14)} ${kind.padEnd(10)} ${base}${bOk ? '' : ' (UNOBTAINABLE)'} + ${cat}${cOk ? '' : ' (UNOBTAINABLE)'}`);
}
console.log('\n  title line at each stage:');
for (const l of lines) console.log(`    "${l}"`);

for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) console.log(`\n  ok  all ${W.FUSIONS.length} are obtainable and the counter tells the truth`);
process.exit(fails.length ? 1 : 0);
