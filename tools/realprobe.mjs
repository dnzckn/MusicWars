/*
 * realprobe — what the REAL game does to the score, measured not assumed.
 *
 * This exists because `tools/session.mjs` spent its whole life measuring a
 * state the game cannot produce. It invents snapshots, and four of the tension
 * model's eight terms (crowding, imminence, density, momentum — 0.60 of the
 * total weight) were never set, while the player's health was modelled on a
 * 0-100 scale when `game/player.ts` uses three hearts and three lives. The
 * result was that energy could not exceed `progressFloor`'s arithmetic maximum
 * of 0.54, and the gate reported that eight stems "never reach their ceiling"
 * — a conclusion about the music that was purely an artefact of the harness.
 *
 * So: drive the real `World` with a real `MusicDirector` subscribed to the
 * real bus, exactly as `main.ts` does, and report the distributions. No
 * invention anywhere in the path.
 *
 * WHAT IT IS FOR:
 *   - re-measuring the `REAL` reference block in `session.mjs` when the game's
 *     balance changes, which it does constantly. That block is a snapshot of
 *     one run on one date and it will go stale.
 *   - answering "does this stem ever reach its ceiling" and "is this threshold
 *     inside the achievable range" with the game's own numbers.
 *
 * WHAT IT IS NOT: a gate. It asserts nothing and fails nothing. It is a
 * measuring instrument, and one run of one bot is not the distribution of all
 * play — the ship here parks and holds fire down, which `deadhunt` measured as
 * survivable to wave 60. A player who moves will see a different mix.
 *
 * Usage: `node tools/realprobe.mjs [minutes]`   (default 15)
 */
import './lib/headless-audio.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = new URL('../src', import.meta.url).href;
const { World } = await import(`${R}/game/world.ts`);
const { MusicDirector } = await import(`${R}/audio/director.ts`);
const { Transport } = await import(`${R}/core/transport.ts`);
const { STEM_CURVES, stemLevel } = await import(`${R}/audio/layers.ts`);

const DT = 1 / 120;
const MIN = Number(process.argv[2] ?? 15);
const STEPS = Math.round((MIN * 60) / DT);

/*
 * An EXPLICIT SEED, and the second argument is gone because it never existed.
 *
 * This said `new World(960, 540)`, which reads like a playfield size and is
 * not one: `World`'s constructor takes `(seed = Date.now() & 0xffffffff)` and
 * nothing else — `width` and `height` are fixed constants. So this passed a
 * SEED of 960 and silently discarded 540. It happened to be harmless because
 * a constant is still reproducible, but it was reproducible by accident, and
 * the moment anyone "fixed" the apparent size argument the seed would have
 * moved with it.
 *
 * Verified reproducible: the same seed gives an identical state hash across
 * separate processes at both 120s and 300s of simulation, and different seeds
 * diverge (wave 7 / 9 / 10 at 300s). `0x51ed` is what `wiring` and the
 * `deadhunt` tools already use, so measurements can be compared across tools.
 */
const SEED = 0x51ed;
const w = new World(SEED);
w.start();
const director = new MusicDirector();
director.reset(0);
const transport = new Transport();
transport.start();
const bus = w.bus;
bus.on('wave:start', (e) => director.onWaveStart(transport, e));
bus.on('wave:clear', (e) => director.onWaveClear(transport, e));
bus.on('boss:telegraph', (e) => director.onBossTelegraph(transport, e));
bus.on('boss:phase', (e) => director.onBossPhase(transport, e));
bus.on('boss:defeat', () => director.onBossDefeat(transport));
bus.on('player:hit', () => director.onPlayerHit());
bus.on('player:death', () => director.onPlayerDeath(transport));
bus.on('player:bomb', () => director.onBomb(transport));
bus.on('powerup:pickup', (e) => director.onPickup(transport, e.kind));
bus.on('powerup:expire', (e) => director.onPickup(transport, e.kind));

/*
 * The bot MOVES, and it has to.
 *
 * This used to hold the stick at zero. That was fine when it was written and
 * is not any more: `World` now treats a ship that stops moving as one that has
 * stopped playing — `campPressure` ramps to 1, bullets speed up by half, both
 * rescue mechanics switch off — and `tension.ts` floors the score's tension on
 * it. So a parked bot measures the one state the game is designed to punish,
 * and every "typical play" number taken from it is inflated.
 *
 * Measured: parked gives campPressure 0.94 and energy p50 0.563; this policy
 * gives campPressure 0.000. Small, tight movements rather than a full
 * traversal, because that is what a bullet-hell player actually does and
 * because roaming across the field crosses more streams and takes more hits
 * (14 against 10 over five minutes).
 */
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
const steer = (tSec) => {
  inp.x = Math.sin(tSec * 3.0) * 0.35;
  inp.y = Math.cos(tSec * 2.3) * 0.25;
};

const en = [], te = [], rw = [], fl = [], drivers = new Map();
const FIELDS = ['threatsNear','threatsVeryNear','timeToContact','pressureCount','combo','killRate','bossHp','bossPhases','timeSinceHit','grazeRate','enemyThreat','enemyCount','playerHp','lives','maxLives','playerMaxHp','waveProgress'];
const samples = Object.fromEntries(FIELDS.map((f) => [f, []]));
const lv = {};
let hits = 0;
bus.on('player:hit', () => hits++);
for (let i = 0; i < STEPS; i++) {
  (steer(i * DT), w.update(DT, inp));
  transport.advance(DT);
  director.update(w.snapshot, transport, DT);
  if (i % 30 === 0) {
    const r = director.readout(transport);
    en.push(r.energy ?? 0); te.push(r.tension ?? 0); rw.push(r.rawTension ?? 0);
    fl.push(r.progressFloor ?? 0); // from the director, not a copy of its formula
    drivers.set(r.driver, (drivers.get(r.driver) ?? 0) + 1);
    for (const f of FIELDS) { const v = w.snapshot[f]; if (typeof v === 'number' && Number.isFinite(v)) samples[f].push(v); }
    for (const [k, v] of Object.entries(r.levels ?? {})) { (lv[k] ??= []).push(v); }
  }
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * p)] ?? 0; };
const f = (x) => x.toFixed(3);
const f2 = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)).padStart(6);
console.log(`real World, ${MIN} min, wave ${w.snapshot.wave}, hits ${hits}, lives ${w.snapshot.lives}`);
console.log(`  energy   min ${f(Math.min(...en))}  p50 ${f(q(en,.5))}  p90 ${f(q(en,.9))}  p99 ${f(q(en,.99))}  max ${f(Math.max(...en))}`);
console.log(`  tension  min ${f(Math.min(...te))}  p50 ${f(q(te,.5))}  p90 ${f(q(te,.9))}  p99 ${f(q(te,.99))}  max ${f(Math.max(...te))}`);
console.log(`  share of samples with energy > 0.54: ${(100*en.filter(x=>x>0.54).length/en.length).toFixed(1)}%`);
console.log(`  share of samples with energy > 0.62: ${(100*en.filter(x=>x>0.62).length/en.length).toFixed(1)}%`);
const deciles = [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,.95,.99,1].map((d)=>`p${(d*100).toFixed(0)} ${f(q(en,d===1?0.999:d))}`);
console.log('  energy deciles: ' + deciles.join('  '));
const band = (lo,hi) => (100*en.filter(x=>x>=lo&&x<hi).length/en.length).toFixed(1);
console.log(`  time in 0.60-0.72: ${band(0.60,0.72)}%   below 0.45: ${band(0,0.45)}%   above 0.75: ${band(0.75,2)}%`);
/*
 * THE ENVELOPE, separated from the signal it smooths.
 *
 * `raw` is what the eight terms say right now. `sustained` is `raw` through a
 * damper with a 0.45s attack and a 2.6s release, and it is `sustained` that
 * every fader, section choice and mode lookup actually reads. A fast attack
 * with a slow release is a peak-HOLD: it jumps to each new maximum and then
 * leaks down slowly, so if peaks arrive more often than the release time it
 * never gets back down and the arrangement has no quiet. Comparing the two
 * distributions says whether the flatness is in the game or in the damper.
 *
 * `energy = max(sustained, progressFloor)`, so the floor is reported too — a
 * sample sitting exactly on it is one where danger contributed nothing.
 */
console.log('\n  the master signal, decomposed:');
const row = (n, a) => console.log(`    ${n.padEnd(10)} p10 ${f(q(a,.1))}  p50 ${f(q(a,.5))}  p90 ${f(q(a,.9))}  max ${f(Math.max(...a))}   p10-p90 span ${f(q(a,.9)-q(a,.1))}`);
row('raw', rw); row('sustained', te); row('floor', fl); row('energy', en);
const pinned = (100 * en.filter((e, i) => e <= fl[i] + 0.002).length) / en.length;
console.log(`    floor is binding (danger contributes nothing) in ${pinned.toFixed(1)}% of samples`);
let flips = 0;
for (let i = 1; i < te.length; i++) if (Math.abs(te[i] - te[i - 1]) > 0.05) flips++;
console.log(`    sustained moves >0.05 between samples in ${((100 * flips) / te.length).toFixed(1)}% of steps`);

/*
 * Does each stem's level actually TRACK energy?
 *
 * Every curve in `STEM_CURVES` is written as "quiet at `in`, full at `full`",
 * which asserts a positive relationship. Nothing has ever checked it, and two
 * static renders at 0.254 and 0.635 energy disagreed about the kick by a
 * factor of two in the wrong direction. Pearson correlation over a real run
 * answers it directly: a lane whose r is near zero is deaf to intensity, and a
 * lane whose r is NEGATIVE gets quieter as the game gets more dangerous, which
 * would be the opposite of an arrangement.
 */
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
/*
 * A verdict here is a PROMPT TO GO AND READ THE SOURCE, not a bug report.
 * The tool cannot see intent, and twice now it has flagged a lane that was
 * behaving exactly as designed: `power` is deliberately inverse — its override
 * computes `room = 1 - remap(intensity, ...)` because a heartbeat is something
 * you notice in the quiet — and `hats` and `sub` read low only because their
 * floor and ceiling are 0.08 and 0.10 apart. The one real defect this column
 * found was `fx`, which had 0.26 of travel available and correlated +0.11
 * because its level was a two-valued section switch that threw the curve away.
 * That is the shape to look for: room to move, and not moving.
 */
console.log('\n  does each stem follow energy? (Pearson r against energy)');
console.log('    stem        r     travel   verdict');
for (const [k, a] of Object.entries(lv)) {
  const r = pearson(en, a);
  const c = STEM_CURVES[k];
  // How much level the curve is even ALLOWED to move. A lane with almost no
  // travel cannot correlate with anything, and that is a different finding
  // from a lane that has room and does not use it — `hats` spans 0.08 between
  // its floor and ceiling by design, so its low r is a consequence of the
  // design rather than a signal being lost on the way in.
  const travel = c ? Math.abs((c.ceiling ?? 0) - (c.floor ?? 0)) : NaN;
  const verdict =
    !Number.isFinite(travel) ? ''
    : travel < 0.12 ? `near-constant by design (only ${travel.toFixed(2)} of travel)`
    : r < -0.1 ? 'inverse — quieter when hotter; CHECK INTENT in updateLevels'
    : r < 0.2 ? 'DEAF — has room to move and does not use it'
    : r < 0.4 ? 'follows loosely'
    : 'follows intensity';
  console.log(`    ${k.padEnd(8)} ${(r >= 0 ? '+' : '') + r.toFixed(2)}   ${Number.isFinite(travel) ? travel.toFixed(2) : ' n/a'}     ${verdict}`);
}

/*
 * WHERE EACH CURVE SITS RELATIVE TO THE SIGNAL.
 *
 * A `StemCurve` ramps from `in` (silent) to `full` (at its ceiling). That only
 * expresses anything in the window between them, so the question that decides
 * whether a curve works is not what its numbers are but how much of the run
 * lands inside that window. Two ways to get it wrong, and this project has now
 * hit both:
 *
 *   `full` ABOVE the signal's maximum — the top of the curve is unreachable.
 *     `sub` had `full: 0.9` against a measured max of 0.851.
 *   `full` BELOW the signal's median — the lane pins at its ceiling and stops
 *     responding. `fx` has `full: 0.5` against a median of 0.622.
 *
 * Both look fine in isolation and both are invisible without the measured
 * distribution, which is the whole reason this tool exists.
 *
 * READ THIS BEFORE ACTING ON A ROW. Some lanes' levels are overwritten in
 * `director.updateLevels` after `stemLevel` has run, so their curve is an
 * input that nothing uses and these zone numbers describe a discarded value.
 * `motifs` is replaced by a `presence` term built from enemy count and threat;
 * `power` is event-gated. Both are documented at their entries in `layers.ts`,
 * and raising `full` on `motifs` was already tried once and changed nothing
 * for exactly this reason.
 *
 * An earlier version of this tool tried to DETECT that automatically by
 * correlating the curve's prediction against the observed level. That does not
 * work and the column was removed: `stemLevel` is monotone in energy, so the
 * correlation it produced was almost identical to the energy correlation
 * reported above — it measured the same thing twice while claiming to measure
 * something else. Which lanes are overridden is a static fact about the source
 * and belongs in a comment like this one, not in a statistic.
 */
console.log('\n  is each curve aimed at the signal? (share of run in each zone)');
console.log('    stem      in    full   below-in  ACTIVE  saturated');
for (const k of Object.keys(lv)) {
  const c = STEM_CURVES[k];
  if (!c) continue;
  const below = (100 * en.filter((e) => e < c.in).length) / en.length;
  const sat = (100 * en.filter((e) => e >= c.full).length) / en.length;
  const active = 100 - below - sat;
  const note = sat > 60 ? ' <-- pinned at ceiling, barely responds' : active < 25 ? ' <-- rarely in its working range' : '';
  console.log(
    `    ${k.padEnd(8)} ${c.in.toFixed(2)}  ${c.full.toFixed(2)}   ${below.toFixed(0).padStart(5)}%  ${active.toFixed(0).padStart(5)}%   ${sat.toFixed(0).padStart(5)}%${note}`,
  );
}

console.log('\n  stem levels in the REAL game (what the mix actually does):');
console.log('    stem      min    p50    p90    max    span');
for (const [k, a] of Object.entries(lv)) {
  console.log(`    ${k.padEnd(8)} ${f(Math.min(...a))}  ${f(q(a,.5))}  ${f(q(a,.9))}  ${f(Math.max(...a))}  ${f(Math.max(...a)-Math.min(...a))}`);
}
console.log('\n  real snapshot fields the tension terms read:');
for (const f of FIELDS) {
  const a = samples[f];
  if (!a.length) { console.log(`    ${f.padEnd(16)} never finite`); continue; }
  console.log(`    ${f.padEnd(16)} min ${f2(Math.min(...a))}  p50 ${f2(q(a,.5))}  p90 ${f2(q(a,.9))}  max ${f2(Math.max(...a))}`);
}
console.log('  drivers:', [...drivers.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${(100*v/en.length).toFixed(0)}%`).join('  '));
