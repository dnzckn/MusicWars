/*
 * sections — how much of a run does the arrangement spend in each section?
 *
 * `arrangement.ts` states the failure mode itself: "A drop that never ends is
 * not a drop, it is the volume knob." It records the arrangement once spending
 * 70% of a run in the drop and 5% in a breakdown, and the section machine was
 * rebuilt around that. Nothing has measured it since — the tools that touch
 * arrangement shape (`movements`, `variety`, `rondo`) all drive Playwright, so
 * on a box where the browser suite is dark the whole axis is unwatched.
 *
 * This runs in plain Node off a real `World` and a real `MusicDirector`.
 *
 * A RATCHET, NOT AN ASPIRATION. The bar below is set between the known-bad 70%
 * and where the game measures today, so it catches a regression toward the
 * pathology without asserting that today's figure is the right one. Picking a
 * number the game already fails, on the theory that lower must be better,
 * would be inventing a target — and an unsatisfiable gate teaches a reader to
 * ignore the output. If the drop share should come down, that is a change to
 * `maybeAdvance` measured here, not a threshold edited here.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport } = await import(`${R}core/transport.ts`);

const DT = 1 / 60;
const SECS = Number(process.env.SECTIONS_SECS ?? 900);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/* The share above which the drop stops being an event. See the header. */
const MAX_DROP = 0.60;
/* A run with no quiet in it has no dynamics, whatever its peak level says. */
const MIN_QUIET = 0.05;

const share = {};
let bars = 0;
/*
 * WHAT SOUNDS IN A COLLAPSE — an ordering hazard, guarded.
 *
 * `updateLevels` silences every lane but `fx` and `sub` when the section is
 * `collapse`, and that rule used to sit forty lines ABOVE the per-lane
 * override blocks. Two of those blocks assign (`want = ...`) rather than
 * multiply, so they wrote straight over the zero: measured after a real game
 * over, `motifs` sat at 0.35-0.61 and `power` at 0.69 while the band was
 * supposed to have stopped. The two loudest lanes on the death screen were the
 * two the collapse existed to remove.
 *
 * The fix was to state the rule once, after every per-lane override. The
 * hazard is structural though — the next lane to gain an assignment will do
 * the same thing — so the outcome is checked here rather than the ordering.
 *
 * SAMPLED PAST THE RAMP, and the ramp is why the first version of this check
 * misfired. Faders glide rather than jump, so a collapse decays instead of
 * cutting: measured, the loudest non-fx/sub lane goes 0.477 at entry, 0.189 at
 * 1s, 0.075 at 2s, 0.030 at 3s and 0.000 by 8s. Sampling two bars in caught it
 * at 0.06-0.13 and reported six lanes "still sounding" when they were simply
 * on their way down. Four bars (~7.5s at 128bpm) is past the knee, where a
 * genuine leak — a lane an override is holding UP — is the only thing that can
 * still be above the floor.
 */
const collapseLeak = {};
let collapseSamples = 0;
const perSeed = [];
for (const SEED of SEEDS) {
  const w = new World(SEED); w.start();
  const d = new MusicDirector(); d.reset(0);
  const t = new Transport(); t.start();
  for (const [ev, fn] of [
    ['wave:start', (e) => d.onWaveStart(t, e)], ['wave:clear', (e) => d.onWaveClear(t, e)],
    ['boss:telegraph', (e) => d.onBossTelegraph(t, e)], ['boss:phase', (e) => d.onBossPhase(t, e)],
    ['boss:defeat', () => d.onBossDefeat(t)], ['player:hit', () => d.onPlayerHit()],
    ['player:death', () => d.onPlayerDeath(t)], ['player:bomb', () => d.onBomb(t)],
    ['powerup:pickup', (e) => d.onPickup(t, e.kind)], ['powerup:expire', (e) => d.onPickup(t, e.kind)],
    ['ability:evolve', () => d.onFusion('evolution')], ['ability:union', () => d.onFusion('union')],
    ['ability:duet', () => d.onFusion('duet')],
  ]) w.bus.on(ev, fn);
  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  let lastBar = -1, mine = 0, myDrop = 0, collapseAge = 0;
  for (let i = 0; i < Math.round(SECS / DT); i++) {
    if (i % 2 === 0) { drive(w, inp); inp.choice = w.choosing ? 0 : -1; }
    w.update(DT, inp); t.advance(DT); d.update(w.snapshot, t, DT);
    const bar = Math.floor(t.bar);
    if (bar === lastBar) continue;
    lastBar = bar; bars++; mine++;
    const s = d.readout(t).section;
    share[s] = (share[s] ?? 0) + 1;
    if (s === 'drop') myDrop++;
    collapseAge = s === 'collapse' ? collapseAge + 1 : 0;
    if (s === 'collapse' && collapseAge > 4) {
      collapseSamples++;
      const lv = d.levels ?? {};
      for (const [id, v] of Object.entries(lv)) {
        if (id === 'fx' || id === 'sub') continue;
        if (v > 0.05) collapseLeak[id] = Math.max(collapseLeak[id] ?? 0, v);
      }
    }
  }
  perSeed.push(myDrop / mine);
}

console.log(`\nsections — where a run actually spends its bars (${SEEDS.length} x ${SECS}s, ${bars} bars)\n`);
const ordered = Object.entries(share).sort((a, b) => b[1] - a[1]);
for (const [k, v] of ordered) {
  const pct = v / bars;
  const bar = '#'.repeat(Math.round(pct * 50));
  console.log(`  ${k.padEnd(11)} ${(100 * pct).toFixed(1).padStart(5)}%  ${bar}`);
}

const drop = (share.drop ?? 0) / bars;
const quiet = ((share.breakdown ?? 0) + (share.intro ?? 0) + (share.collapse ?? 0)) / bars;
perSeed.sort((a, b) => a - b);
console.log(`\n  drop share per seed: ${perSeed.map((x) => (100 * x).toFixed(0) + '%').join(' ')}`);
console.log(`  quiet sections (breakdown + intro + collapse): ${(100 * quiet).toFixed(1)}%`);

const fails = [];
const leaked = Object.entries(collapseLeak).sort((a, b) => b[1] - a[1]);
console.log(`\n  collapse: ${collapseSamples} bars sampled, ${leaked.length} lane(s) still sounding` +
  (leaked.length ? `  (${leaked.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ')})` : ''));
if (leaked.length) {
  fails.push(`${leaked.map(([k]) => k).join(', ')} still sound during a collapse — the band is supposed to have stopped ` +
    '(a per-lane `want =` after the section rule will do this)');
}
if (drop > MAX_DROP) {
  fails.push(`the drop holds ${(100 * drop).toFixed(1)}% of every run (max ${(100 * MAX_DROP).toFixed(0)}%) — ` +
    'arrangement.ts: "a drop that never ends is not a drop, it is the volume knob"');
}
if (quiet < MIN_QUIET) {
  fails.push(`only ${(100 * quiet).toFixed(1)}% of the run is quiet (min ${(100 * MIN_QUIET).toFixed(0)}%) — ` +
    'a score with no rest is relentless however good the notes are');
}
for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) {
  console.log(`\n  ok  the drop is ${(100 * drop).toFixed(1)}% of a run and ${(100 * quiet).toFixed(1)}% is quiet`);
}
console.log('\n  History of this axis:');
console.log('    70.0 drop / 5 breakdown  — what arrangement.ts was rebuilt to fix');
console.log('    53.6 drop                — first Node measurement, 2026-08-23');
console.log('    49.5 drop                — after the build timeout stopped forcing a drop');
console.log('  The last change moved the STRUCTURE and not the loudness: rendered over 64');
console.log('  bars, p10-p90 was 11.4dB both before and after. Do not claim it as dynamics.');
process.exit(fails.length ? 1 : 0);
