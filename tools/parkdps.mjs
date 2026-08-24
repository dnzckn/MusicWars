/**
 * parkdps — does a parked ship's OWN output outrun the escalation, which
 * would explain hits/wave falling from 1.23 (early third) to 0.38 (late
 * third) in parkdiag.mjs rather than rising as difficulty climbs?
 *
 * Same parked policy as deadhunt-horizon/parkdiag. Samples ensembleDps(),
 * progression level, live enemyCount and kills-by-player at wave boundaries.
 *
 * node --experimental-transform-types tools/parkdps.mjs [minutes]
 */
import './lib/tsnode.mjs';

const { World } = await import('../src/game/world.ts');

const DT = 1 / 120;
const MINUTES = Number(process.argv[2] ?? 45);
const STEPS = Math.round((MINUTES * 60) / DT);

const w = new World(0x51ed);
let kills = 0;
w.bus.on('enemy:death', (e) => { if (e.byPlayer) kills++; });

w.start();
const inp = {
  x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
  choice: -1, banish: -1, reroll: false, skip: false,
};

const rows = [];
let lastWave = -1;
let killsAtWaveStart = 0;
let enemySum = 0, enemySamples = 0;

let i = 0;
for (; i < STEPS; i++) {
  inp.choice = w.choosing ? 0 : -1;
  w.update(DT, inp);
  w.shocks.length = 0;
  enemySum += w.snapshot.enemyCount ?? 0;
  enemySamples++;
  if (w.waveIndex !== lastWave) {
    if (lastWave >= 0) {
      rows.push({
        wave: lastWave + 1,
        dps: w.ensembleDps(),
        level: w.progression.level,
        kills: kills - killsAtWaveStart,
        avgEnemies: enemySum / Math.max(1, enemySamples),
      });
    }
    lastWave = w.waveIndex;
    killsAtWaveStart = kills;
    enemySum = 0; enemySamples = 0;
  }
  if (w.isOver) break;
}

const f = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : String(x));
console.log(`\nPARKDPS — player output vs wave, parked+holding-fire, ${MINUTES} min\n`);
console.log('  wave   ensembleDps   prog.level   kills-this-wave   avgLiveEnemies');
for (const r of rows) {
  if (r.wave % 4 !== 1 && r.wave !== rows.length) continue;
  console.log(`  ${String(r.wave).padStart(4)}   ${String(f(r.dps, 0)).padStart(11)}   ${String(r.level).padStart(10)}   ${String(r.kills).padStart(15)}   ${f(r.avgEnemies, 2)}`);
}
const thirds = (arr) => {
  const n = arr.length;
  return [arr.slice(0, Math.floor(n / 3)), arr.slice(Math.floor(n / 3), Math.floor((2 * n) / 3)), arr.slice(Math.floor((2 * n) / 3))];
};
const [e, m, l] = thirds(rows);
const avg = (arr, g) => arr.reduce((a, x) => a + g(x), 0) / arr.length;
console.log('\nby run third:');
for (const [label, arr] of [['early', e], ['mid', m], ['late', l]]) {
  console.log(`  ${label.padEnd(6)} waves ${arr[0]?.wave}-${arr.at(-1)?.wave}   dps ${f(avg(arr, (r) => r.dps), 0)}   level ${f(avg(arr, (r) => r.level), 1)}   kills/wave ${f(avg(arr, (r) => r.kills), 2)}   avgLiveEnemies ${f(avg(arr, (r) => r.avgEnemies), 2)}`);
}
console.log('');
