/*
 * thresholds — every arrangement threshold, against the signal it is compared to.
 *
 * WHY THIS EXISTS. The most common defect in this repository is a constant that
 * was correct when written and was left behind when the signal moved: a guard
 * outside the achievable range, a floor above the median, an exit below the
 * entry. It has been found by hand roughly a dozen times, and the last one was
 * found by an outside reviewer rather than by me — I had re-derived `sustain`'s
 * thresholds against a new distribution in one pass and simply not noticed that
 * `build`'s sat in the same file, untouched, now stranded below the median. Its
 * riser had collapsed from four bars to two and nothing said so.
 *
 * A stranded constant does not announce itself, so this announces them.
 *
 * WHAT IT DOES. Drives the REAL `World` and `MusicDirector`, collects the
 * actual signal `Arranger.onBar` is called with — which is `energy`, not
 * `p.tension`, a distinction worth keeping straight — then greps the live
 * `tension <op> N` comparisons out of `arrangement.ts` and reports the
 * percentile each one sits at.
 *
 * The distribution is MEASURED EVERY RUN rather than pinned to a recorded
 * table, because a hardcoded reference is the very thing that goes stale here.
 *
 * HOW TO READ IT. There is no universally correct percentile — an exit that
 * should fire rarely belongs high, a rest that should be rare belongs low. What
 * this catches is the extreme: a threshold below p2 or above p98 is one arm of
 * a branch that effectively never runs, and two thresholds within a couple of
 * points of each other are a hysteresis band that is not one.
 *
 * THE HORIZON MATTERS, so this defaults to 15 minutes and prints it.
 * `progressFloor` climbs with the wave counter, so a longer run sits higher:
 * measured on the same seed and bot, the median is 0.542 over 8 minutes and
 * 0.600 over 15. Judging a threshold against the wrong horizon moves its
 * percentile by ten points or more, which is enough to turn "fires half the
 * time" into "fires most of the time". 15 matches what `npm run realprobe`
 * reports, so the two tools can be compared.
 *
 * Usage: `node tools/thresholds.mjs [minutes]`   (default 15)
 */
import './lib/headless-audio.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const { World } = await import('../src/game/world.ts');
const { MusicDirector } = await import('../src/audio/director.ts');
const { Transport } = await import('../src/core/transport.ts');

const DT = 1 / 120;
const MINUTES = Number(process.argv[2] ?? 15);
const SEED = 0x51ed;

const w = new World(SEED);
w.start();
const d = new MusicDirector();
d.reset(0);
const t = new Transport();
t.start();
const bus = w.bus;
bus.on('wave:start', (e) => d.onWaveStart(t, e));
bus.on('wave:clear', (e) => d.onWaveClear(t, e));
bus.on('boss:telegraph', (e) => d.onBossTelegraph(t, e));
bus.on('boss:phase', (e) => d.onBossPhase(t, e));
bus.on('boss:defeat', () => d.onBossDefeat(t));
bus.on('player:hit', () => d.onPlayerHit());
bus.on('player:death', () => d.onPlayerDeath(t));
bus.on('player:bomb', () => d.onBomb(t));
bus.on('powerup:pickup', (e) => d.onPickup(t, e.kind));
bus.on('powerup:expire', (e) => d.onPickup(t, e.kind));

// A moving bot: a parked one is the state the game now punishes, so its
// distribution is not the one these thresholds should be judged against.
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
const samples = [];
const bySection = new Map();
for (let i = 0; i < Math.round((MINUTES * 60) / DT); i++) {
  inp.x = Math.sin(i * DT * 3.0) * 0.35;
  inp.y = Math.cos(i * DT * 2.3) * 0.25;
  w.update(DT, inp);
  t.advance(DT);
  d.update(w.snapshot, t, DT);
  // Sampled per bar, because that is when `onBar` reads it.
  if (i % 30 === 0) {
    const r = d.readout(t);
    if (r.section !== 'collapse') {
      samples.push(r.energy);
      // Per section too: a section-scoped floor must be judged against the
      // distribution DURING that section. Measuring `intro`'s floor against
      // the whole run reported it binding 15% of the time when the answer that
      // matters is how often it binds while the intro is actually playing.
      (bySection.get(r.section) ?? bySection.set(r.section, []).get(r.section)).push(r.energy);
    }
  }
}
samples.sort((a, b) => a - b);
const pct = (v) => {
  let lo = 0;
  while (lo < samples.length && samples[lo] < v) lo++;
  return (100 * lo) / samples.length;
};
const q = (f) => samples[Math.min(samples.length - 1, Math.floor(samples.length * f))];

console.log(`thresholds — ${MINUTES} min on the real World, seed 0x${SEED.toString(16)}, ${samples.length} bar samples`);
console.log(
  `  the signal they are compared against (energy): p5 ${q(0.05).toFixed(3)}  p25 ${q(0.25).toFixed(3)}  ` +
    `median ${q(0.5).toFixed(3)}  p75 ${q(0.75).toFixed(3)}  p95 ${q(0.95).toFixed(3)}\n`,
);

const src = readFileSync(join(ROOT, 'src/audio/arrangement.ts'), 'utf8').split('\n');
let caseName = '?';
const rows = [];
for (let i = 0; i < src.length; i++) {
  const line = src[i];
  const trimmed = line.trim();
  // Comments are stripped: this file quotes old thresholds in prose constantly,
  // and grepping them as if they were live is how a tool reports on its own
  // documentation.
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
  const c = line.match(/case '(\w+)'/);
  if (c) caseName = c[1];
  for (const m of line.matchAll(/tension ([<>]) ([0-9.]+)/g)) {
    rows.push({ line: i + 1, caseName, op: m[1], value: Number(m[2]) });
  }
}

console.log('  line  case        test              percentile   verdict');
for (const r of rows) {
  const p = pct(r.value);
  const share = r.op === '>' ? 100 - p : p;
  const verdict =
    share < 2 ? 'DEAD — this arm almost never runs'
    : share > 98 ? 'ALWAYS — the other arm almost never runs'
    : share < 8 || share > 92 ? 'rare, check it is meant to be'
    : 'live';
  console.log(
    `  ${String(r.line).padStart(4)}  ${r.caseName.padEnd(10)}  tension ${r.op} ${String(r.value).padEnd(6)}  ` +
      `${p.toFixed(0).padStart(4)}%   fires ${share.toFixed(0).padStart(3)}% of bars   ${verdict}`,
  );
}

/*
 * `director.ts`'s gate FLOORS, which are compared against the same signal.
 *
 * `updateLevels(tension, ...)` is called as `updateLevels(this.energy, ...)`,
 * so despite the parameter name these floors sit on the very distribution
 * measured above. They belong in the same sweep: a floor above the median is
 * the same defect as a threshold below it, and one of these was added today.
 *
 * Named constants are resolved from their declarations rather than skipped —
 * a sweep that silently ignores `Math.max(tension, SOME_NAME)` would miss
 * exactly the ones someone bothered to name.
 */
const dsrc = readFileSync(join(ROOT, 'src/audio/director.ts'), 'utf8');
const consts = new Map();
for (const m of dsrc.matchAll(/^const ([A-Z][A-Z0-9_]*) = ([0-9.]+);/gm)) consts.set(m[1], Number(m[2]));
const floors = [];
for (const line of dsrc.split('\n')) {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
  for (const m of line.matchAll(/Math\.max\(tension, ([0-9.]+|[A-Z][A-Z0-9_]*)\)/g)) {
    const raw = m[1];
    const v = /^[0-9.]/.test(raw) ? Number(raw) : consts.get(raw);
    if (v === undefined) continue;
    const sec = line.match(/section === '(\w+)'/);
    floors.push({ sec: sec ? sec[1] : '?', raw, v });
  }
}
if (floors.length) {
  console.log('\n  director.ts gate floors, against the same signal:');
  for (const f of floors) {
    const scoped = bySection.get(f.sec);
    const inSection = scoped && scoped.length > 8
      ? (100 * scoped.filter((e) => e < f.v).length) / scoped.length
      : null;
    const p = inSection ?? pct(f.v);
    const verdict = p > 95 ? 'ABOVE almost everything in its section — the floor IS the signal'
      : p < 5 ? 'below almost everything — never binds'
      : 'binds sometimes';
    console.log(
      `    ${f.sec.padEnd(8)} max(energy, ${String(f.raw).padEnd(17)}) = ${f.v.toFixed(2)}  ` +
        `binds ${p.toFixed(0).padStart(3)}% of bars ${inSection === null ? '(whole run — no section samples)' : `IN '${f.sec}' (n=${scoped.length})`}   ${verdict}`,
    );
  }
}

// Pairs that are supposed to form a hysteresis band.
const byCase = new Map();
for (const r of rows) (byCase.get(r.caseName) ?? byCase.set(r.caseName, []).get(r.caseName)).push(r);
console.log('\n  hysteresis check — an entry and an exit within 3 points of each other is not a band:');
const bd = rows.filter((r) => r.value === 0.44);
const bdExit = rows.filter((r) => r.caseName === 'breakdown' && r.op === '>');
if (bd.length && bdExit.length) {
  const gap = Math.abs(pct(bdExit[0].value) - pct(bd[0].value));
  console.log(
    `    breakdown enter ${bd[0].value} (p${pct(bd[0].value).toFixed(0)}) vs exit ${bdExit[0].value} ` +
      `(p${pct(bdExit[0].value).toFixed(0)})  gap ${gap.toFixed(0)} points  ${gap < 3 ? '<-- NOT A BAND' : 'ok'}`,
  );
}
