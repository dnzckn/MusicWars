/**
 * parkdiag — WHY does a parked, holding-fire ship survive? Not just "does it".
 *
 * `deadhunt-horizon.mjs` already established the headline number: 0/3 deaths
 * in 45 minutes, wave 60, hits 91.7, lives lost 6.7, extends 4.7, bombs spent
 * 3.3. That leaves a real gap unexplained: 91.7 registered hits against a
 * 3hp-per-life ship should cost far more than 6.7 lives (roughly 88 real
 * hp-reducing hits / 3 hp per life =~ 29 lives, four times what was measured).
 * This drives the same World and the same parked policy, but logs every
 * mitigation event (ENCORE pickup, auto-bomb rescue, extend, grace rest) next
 * to hp/lives/bombs on a timeline, so the gap is named rather than assumed.
 *
 * node --experimental-transform-types tools/parkdiag.mjs [minutes]
 */
import './lib/tsnode.mjs';

const { World } = await import('../src/game/world.ts');

const DT = 1 / 120;
const MINUTES = Number(process.argv[2] ?? 45);
const STEPS = Math.round((MINUTES * 60) / DT);

const w = new World(0x51ed);
let hits = 0, extends_ = 0, bombEvents = 0, encorePickups = 0, graceRests = 0;
let lastWave = -1;
const waveLog = [];
let waveHits = 0, waveBombs = 0, waveEncores = 0, waveExtends = 0;
let waveStartHp = 0, waveStartLives = 0;
let nearSum = 0, nearMax = 0, veryNearSum = 0, samples = 0;

w.bus.on('player:hit', () => { hits++; waveHits++; });
w.bus.on('player:extend', () => { extends_++; waveExtends++; });
w.bus.on('player:bomb', () => { bombEvents++; waveBombs++; });
w.bus.on('powerup:pickup', (e) => { if (e.kind === 'encore') { encorePickups++; waveEncores++; } });
w.bus.on('level:choice', (e) => { if (e.grace === 'rest') graceRests++; });

w.start();
const inp = {
  x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
  choice: -1, banish: -1, reroll: false, skip: false,
};

function flushWave(endWave) {
  waveLog.push({
    wave: endWave,
    hits: waveHits,
    bombs: waveBombs,
    encores: waveEncores,
    extends: waveExtends,
    hpStart: waveStartHp,
    livesStart: waveStartLives,
    hpEnd: w.player.hp,
    livesEnd: w.player.lives,
    maxHp: w.player.maxHp,
  });
  waveHits = 0; waveBombs = 0; waveEncores = 0; waveExtends = 0;
  waveStartHp = w.player.hp; waveStartLives = w.player.lives;
}

let i = 0;
for (; i < STEPS; i++) {
  inp.choice = w.choosing ? 0 : -1;
  w.update(DT, inp);
  w.shocks.length = 0;
  if (i % 60 === 0) {
    nearSum += w.snapshot.bulletsNear ?? 0;
    nearMax = Math.max(nearMax, w.snapshot.bulletsNear ?? 0);
    veryNearSum += w.snapshot.bulletsVeryNear ?? 0;
    samples++;
  }
  if (w.waveIndex !== lastWave) {
    if (lastWave >= 0) flushWave(lastWave);
    lastWave = w.waveIndex;
  }
  if (w.isOver) break;
}
flushWave(lastWave);

const f = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : String(x));

console.log(`\nPARKDIAG — mitigation events behind the parked-ship survival number\n`);
console.log(`${MINUTES} min parked run: wave ${w.waveIndex + 1}, died ${w.isOver}, elapsed ${f(i * DT)}s`);
console.log(`totals: hits ${hits}  extends ${extends_}  bomb-events(player:bomb) ${bombEvents}  encore pickups ${encorePickups}  grace-rest cards ${graceRests}`);
console.log(`final: hp ${w.player.hp}/${w.player.maxHp}  lives ${w.player.lives}  bombs ${w.player.bombs}`);
console.log(`avg bulletsNear (sampled every 0.5s) ${f(nearSum / samples, 2)}  max ${nearMax}  avg bulletsVeryNear ${f(veryNearSum / samples, 2)}  n=${samples}`);

console.log(`\nreconciliation: of ${hits} 'player:hit' events, ${bombEvents} were auto-bomb rescues (hp restored to max instead of -1)`);
const rawHpLoss = hits - bombEvents;
console.log(`  => ~${rawHpLoss} genuine hp-reducing hits`);
console.log(`  ${encorePickups} ENCORE pickups each fully healed hp to max + granted invuln + cleared the bullet field`);
console.log(`  ${graceRests} 'grace: rest' level-up cards each healed +1 hp`);

console.log('\nper-wave (waves with any hit activity, first 15 shown):');
console.log('  wave  hits  bombRescue  encore  extend  hpStart->hpEnd  livesStart->livesEnd  maxHp');
let shown = 0;
for (const row of waveLog) {
  if (row.hits === 0 && shown >= 3) continue;
  console.log(
    `  ${String(row.wave + 1).padStart(4)}  ${String(row.hits).padStart(4)}  ${String(row.bombs).padStart(10)}  ${String(row.encores).padStart(6)}  ${String(row.extends).padStart(6)}  ` +
    `${row.hpStart}->${row.hpEnd}  ${row.livesStart}->${row.livesEnd}  ${row.maxHp}`,
  );
  shown++;
  if (shown >= 15) break;
}

const early = waveLog.filter((r) => r.wave < waveLog.length * 0.34);
const mid = waveLog.filter((r) => r.wave >= waveLog.length * 0.34 && r.wave < waveLog.length * 0.67);
const late = waveLog.filter((r) => r.wave >= waveLog.length * 0.67);
const sum = (arr, g) => arr.reduce((a, x) => a + g(x), 0);
console.log('\nhits per wave, by run third (is pressure actually escalating on a parked target?)');
console.log(`  early third (waves ${early[0]?.wave + 1}-${early.at(-1)?.wave + 1}): ${f(sum(early, (r) => r.hits) / early.length, 2)} hits/wave`);
console.log(`  mid   third (waves ${mid[0]?.wave + 1}-${mid.at(-1)?.wave + 1}): ${f(sum(mid, (r) => r.hits) / mid.length, 2)} hits/wave`);
console.log(`  late  third (waves ${late[0]?.wave + 1}-${late.at(-1)?.wave + 1}): ${f(sum(late, (r) => r.hits) / late.length, 2)} hits/wave`);
console.log('');
