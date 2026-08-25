/*
 * overdrive — does a held pickup pin the mix at its ceiling?
 *
 * OVERDRIVE sets floors on `intensity` (0.88) and `drive` (0.8). Those floors
 * are only meaningful if the pickup is occasional. It is not: at the measured
 * spawn economy it arrives every ~9.5s and lasts 12s, a >100% duty cycle, so
 * without a gate it never lapses and the two loudest mix parameters sit at
 * their ceilings for half the run. That is what "cheap techno" sounds like
 * from the inside — not a bad pattern, a welded-open fader.
 *
 * This tool measures the two parameters the gate actually controls. Note that
 * section share is NOT one of them: the arranger reads `tension`, which never
 * sees OVERDRIVE. Changing the floors and then checking section share reads as
 * a no-op and is a trap this repo has already fallen into once.
 */
import './lib/headless-audio.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport } = await import(`${R}core/transport.ts`);

const DT = 1 / 120;
const SECS = Number(process.argv[2] ?? 900);
/* Ceilings the floors clamp to, from director.ts. */
const DRIVE_CEIL = 0.8;
const INTENSITY_FLOOR = 0.88;
/* A burst is an accent; half the run is a setting. */
const MAX_PINNED_SHARE = 0.25;

const w = new World(0x51ed); w.start();
const d = new MusicDirector(); d.reset(0);
const t = new Transport(); t.start();
for (const [ev, fn] of [
  ['wave:start', (e) => d.onWaveStart(t, e)], ['wave:clear', (e) => d.onWaveClear(t, e)],
  ['boss:telegraph', (e) => d.onBossTelegraph(t, e)], ['boss:phase', (e) => d.onBossPhase(t, e)],
  ['boss:defeat', () => d.onBossDefeat(t)], ['player:hit', () => d.onPlayerHit()],
  ['player:death', () => d.onPlayerDeath(t)], ['player:bomb', () => d.onBomb(t)],
  ['powerup:pickup', (e) => d.onPickup(t, e.kind)], ['powerup:expire', (e) => d.onPickup(t, e.kind)],
]) w.bus.on(ev, fn);

const picks = new Map();
w.bus.on('powerup:pickup', (e) => picks.set(e.kind, (picks.get(e.kind) ?? 0) + 1));

const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
const iv = [], dv = [];
let n = 0, pinned = 0, atCeil = 0, held = 0;
for (let i = 0; i < Math.round(SECS / DT); i++) {
  inp.x = Math.sin(i * DT * 3) * 0.35;
  inp.y = Math.cos(i * DT * 2.3) * 0.25;
  w.update(DT, inp); t.advance(DT); d.update(w.snapshot, t, DT);
  if (i % 30) continue;
  n++;
  const I = d.intensity, D = d.p.drive;
  if (!Number.isFinite(I) || !Number.isFinite(D)) throw new Error(`non-finite at ${(i * DT).toFixed(1)}s: intensity=${I} drive=${D}`);
  iv.push(I); dv.push(D);
  if (I >= INTENSITY_FLOOR - 0.01) pinned++;
  if (D >= DRIVE_CEIL - 1e-6) atCeil++;
  if ((w.snapshot.powerups?.overdrive ?? 0) > 0) held++;
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (x) => x.toFixed(3);
const pct = (x) => `${(100 * x).toFixed(1)}%`;

console.log(`\noverdrive — ${SECS}s, wave ${w.snapshot.wave}, ${n} samples`);
console.log('  pickups: ' + [...picks.entries()].map(([k, v]) => `${k} ${v}`).join('  '));
const dur = 12, odCount = picks.get('overdrive') ?? 0;
console.log(`  OVERDRIVE held ${pct(held / n)} of the run  (${odCount} pickups x ${dur}s = ${odCount * dur}s of ${SECS}s => ${pct(odCount * dur / SECS)} duty cycle)`);
console.log(`  intensity  p10 ${f(q(iv, .1))}  med ${f(q(iv, .5))}  p90 ${f(q(iv, .9))}   at/над floor ${INTENSITY_FLOOR}: ${pct(pinned / n)}`.replace('над', 'above'));
console.log(`  drive      p10 ${f(q(dv, .1))}  med ${f(q(dv, .5))}  p90 ${f(q(dv, .9))}   at ceiling ${DRIVE_CEIL}: ${pct(atCeil / n)}`);

const fails = [];
if (pinned / n > MAX_PINNED_SHARE) fails.push(`intensity sits at its OVERDRIVE floor ${pct(pinned / n)} of the run (max ${pct(MAX_PINNED_SHARE)})`);
if (atCeil / n > MAX_PINNED_SHARE) fails.push(`drive sits AT its ceiling ${pct(atCeil / n)} of the run (max ${pct(MAX_PINNED_SHARE)})`);
if (q(dv, .5) >= DRIVE_CEIL - 1e-6) fails.push(`drive MEDIAN is the ceiling ${DRIVE_CEIL} — the fader is welded open`);

console.log('');
if (fails.length) {
  for (const m of fails) console.log(`  FAIL  ${m}`);
  console.log('\n  The fix is not to lower the floors — they are right for an occasional');
  console.log('  pickup. Either gate their authority (OVERDRIVE_PEAK_SECONDS in');
  console.log('  director.ts) or fix the drop economy in game/powerups.ts.');
  process.exit(1);
}
console.log('  ok  OVERDRIVE reads as an accent, not as the ambient setting');
console.log(`\n  Baseline 2026-08-22, gated: pinned 14.6%, drive median 0.383.`);
console.log(`  Ungated it was pinned 49.7%, drive median 0.800 (== ceiling).`);
