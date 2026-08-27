import './lib/ts.mjs';
const W = await import('../src/game/weapons.ts');
const O = await import('../src/audio/orchestration.ts');
const rows = [];
for (const d of W.INSTRUMENTS) {
  if (d.fused) continue;
  const p1 = W.instrumentProps(d.id, 1);
  const props = Object.entries(p1).filter(([, v]) => v !== 0).map(([k, v]) => `${k}=${v}`).join(' ');
  const s1 = W.instrumentStats(d.id, 1), s3 = W.instrumentStats(d.id, 3);
  const dps = (s) => (s.interval > 0 ? (s.damage * s.count) / s.interval : 0);
  rows.push({ id: d.id, label: d.label, shape: d.shape, lane: O.ENSEMBLE_MIX[d.id], props,
    dps1: dps(s1).toFixed(0), dps3: dps(s3).toFixed(0), blurb: d.blurb });
}
console.log(`${'label'.padEnd(12)} ${'id'.padEnd(12)} ${'shape'.padEnd(7)} ${'lane'.padEnd(7)} ${'dps L1'.padStart(6)} ${'L3'.padStart(6)}  props`);
for (const r of rows) console.log(`${r.label.padEnd(12)} ${r.id.padEnd(12)} ${r.shape.padEnd(7)} ${String(r.lane).padEnd(7)} ${r.dps1.padStart(6)} ${r.dps3.padStart(6)}  ${r.props}`);
console.log('\nCARD LINES\n');
for (const r of rows) console.log(`  ${r.label}\n    ${r.blurb}`);
