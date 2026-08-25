/*
 * texture — does the arrangement ever thin out, or is everything always on?
 *
 * The stems each have a dynamic CURVE rather than an on/off threshold, which
 * was a deliberate decision and a good one: gating a lane on a threshold makes
 * it pop in and out, and the fix for a thin mix is never a noise gate. But a
 * curve with a non-zero floor means a lane is always *sounding*, and an
 * arrangement where all eleven voices are present in every bar is a wall — it
 * is what "cheap techno" describes even when every individual lane is well
 * written. Real scores drop instruments and bring them back; the contrast is
 * the point.
 *
 * So this asks the question the per-lane tools cannot: at any given bar, how
 * many voices are actually AUDIBLE, and does that count move?
 *
 * IT READS FADERS, NOT SOUND, and that distinction bit this tool on its first
 * run. `readout().levels` is the director's mix level for a stem — where the
 * fader sits — which is NOT the same as whether the lane emits anything. `fx`
 * is section-gated and produces literally no events in sustain, intro or
 * breakdown, yet its fader is open the whole time, so an earlier version of
 * the table below reported `fx` as "0% silent" while it was silent for most of
 * the run. Anything here phrased as audibility would be a lie; the columns say
 * "fader" and mean it.
 *
 * The FORWARD count is still the number worth having. A stem whose fader is
 * down is definitely not prominent, so the count is an upper bound on how many
 * voices compete, and its movement is what "the arrangement breathes" means.
 *
 * Two thresholds, because they answer different questions:
 *   open      above the director's own AUDIBLE_FLOOR — the fader is up at all
 *   forward   above 0.15 — loud enough to compete for attention
 *
 * The number that matters is the SPREAD of the forward count. A mix that sits
 * at nine voices forever and one that swings between four and ten can have the
 * same average and sound nothing alike.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport } = await import(`${R}core/transport.ts`);

const DT = 1 / 120;
const SECS = Number(process.env.SECS ?? 600);
const AUDIBLE = 0.0025;
const FORWARD = 0.15;
/* A mix that never varies its voice count by at least this is a wall. */
const MIN_SPREAD = 2.0;

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

const drive = makeBrain('dodge');
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
const fwd = [], pres = [];
const bySection = new Map();
const everQuiet = new Map();
for (let i = 0; i < Math.round(SECS / DT); i++) {
  if (i % 2 === 0) drive(w, inp);
  w.update(DT, inp); t.advance(DT); d.update(w.snapshot, t, DT);
  if (i % 60) continue;
  const r = d.readout(t);
  const lv = r.levels || {};
  const names = Object.keys(lv);
  let f = 0, p = 0;
  for (const k of names) {
    const v = lv[k];
    if (v > AUDIBLE) p++;
    if (v > FORWARD) f++;
    if (!everQuiet.has(k)) everQuiet.set(k, 0);
    if (v <= AUDIBLE) everQuiet.set(k, everQuiet.get(k) + 1);
  }
  fwd.push(f); pres.push(p);
  const s = r.section;
  if (!bySection.has(s)) bySection.set(s, []);
  bySection.get(s).push(f);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

console.log(`\ntexture — ${SECS}s of a real run, ${fwd.length} samples, ${Object.keys(everQuiet).length || everQuiet.size} stems\n`);
console.log(`  faders OPEN (>${AUDIBLE}):     mean ${mean(pres).toFixed(1)}  p10 ${q(pres, .1)}  p90 ${q(pres, .9)}   (fader, not audibility — see header)`);
console.log(`  faders FORWARD (>${FORWARD}):   mean ${mean(fwd).toFixed(1)}  p10 ${q(fwd, .1)}  p90 ${q(fwd, .9)}  min ${Math.min(...fwd)}  max ${Math.max(...fwd)}`);
console.log(`  forward spread (p90-p10): ${q(fwd, .9) - q(fwd, .1)}`);
console.log('\n  forward voices by section:');
for (const [s, a] of [...bySection.entries()].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`    ${s.padEnd(10)} mean ${mean(a).toFixed(1)}   ${a.length} samples`);
}
console.log('\n  share of the run each stem has its FADER DOWN (a lane can also be');
console.log('  silent with the fader up — fx emits nothing outside build/drop/fill):');
const tot = fwd.length;
for (const [k, v] of [...everQuiet.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(10)} ${((100 * v) / tot).toFixed(0).padStart(3)}%`);
}
const spread = q(fwd, .9) - q(fwd, .1);
console.log('');
if (spread < MIN_SPREAD) {
  console.log(`  FAIL  the forward voice count only moves by ${spread} between p10 and p90 — every bar has the same number of things in it`);
  process.exit(1);
}
console.log(`  ok  the arrangement thins and thickens (spread ${spread})`);
console.log('\n  Baseline 2026-08-22: forward mean 8.3, spread 5, by section');
console.log('  intro 3.4 / breakdown 5.3 / build 7.8 / fill 8.0 / sustain 8.8 / drop 9.3.');
