import './lib/tsnode.mjs';
const W = await import('../src/game/weapons.ts');
const by = new Map();
for (const d of W.INSTRUMENTS) by.set(d.shape, [...(by.get(d.shape) ?? []), d.id]);
const n = W.INSTRUMENTS.length;
const rows = [...by].sort((a, b) => b[1].length - a[1].length);
console.log(`
  ${rows.length} shapes over ${n} instruments = 1 verb per ${(n / rows.length).toFixed(1)}`);
for (const [s, ids] of rows) {
  console.log(`  ${s.padEnd(8)} ${String(ids.length).padStart(2)}  ${String(Math.round((ids.length / n) * 100)).padStart(2)}%  ${ids.join(', ')}`);
}
console.log(`  largest shape holds ${Math.round((rows[0][1].length / n) * 100)}% of the roster`);
let changed = 0;
for (const f of W.FUSIONS) {
  const a = W.instrumentDef(f.base), r = W.instrumentDef(f.result);
  if (a && r && a.shape !== r.shape) changed++;
}
console.log(`  ${changed} of ${W.FUSIONS.length} recipes change the verb`);
const noMix = W.INSTRUMENTS.filter((d) => !W.ENSEMBLE_MIX?.[d.id]).length;
console.log(`  instruments with no ENSEMBLE_MIX lane: ${W.ENSEMBLE_MIX ? noMix : 'n/a here'} of ${n}
`);
