/*
 * barvariety — does the arrangement ever literally repeat a bar?
 *
 * WHY A SECOND ONE. `tools/repetition.mjs` already asks a version of this, and
 * it cannot run on this machine: 109 of the 135 tools in here drive Playwright,
 * and Chromium does not start (see `tools/README.md` on the extracted libs).
 * This asks the narrow part of the question that needs no browser, by querying
 * the master pattern directly — a Strudel `Pattern` is a pure function from a
 * timespan to events, so the notes can be read without ever making a sound.
 *
 * WHAT IT MEASURES: the real `World` drives a real `MusicDirector`, and on each
 * bar line the master pattern is queried and reduced to a signature — onsets
 * quantised to 16ths, pitches rounded, grouped by orbit. Then: how many bars
 * are distinct, how often a bar equals the one before it, and the longest run
 * of identical bars.
 *
 * HOW TO READ IT, because the headline number is not good-or-bad on its own.
 * A high uniqueness score is NOT automatically a pass. Music needs repetition
 * to be memorable; a score in which nothing ever comes back has no tune, which
 * is a different failure from a score that loops. What this can distinguish is
 * only the crude case: an arrangement that plays the same bar over and over.
 *
 * Measured 2026-08-22 over an 8-minute real run reaching wave 17: 254 distinct
 * signatures out of 256 bars, longest identical run 2, no signature occurring
 * more than twice. So the texture does not loop. The melody does recur, but by
 * construction rather than by anything this measures — `themeForWave` returns
 * `THEMES[0]` on every even wave, which is a static fact you can read in
 * `layers.ts` and should not simulate.
 *
 * TWO INSTRUMENT BUGS THIS HAD, both caught by an implausible count rather than
 * by the code looking wrong, which is the reliable way to catch them:
 *   - `Transport.bar` is a FLOAT (beats / 4), so `bar !== lastBar` fired every
 *     frame and the tool sampled 28800 "bars" in four minutes. Needs a floor.
 *   - Signatures keyed on exact event times made every bar unique through
 *     micro-timing alone, measuring the humaniser rather than the music.
 *
 * Usage: `node tools/barvariety.mjs [minutes]`   (default 8)
 */
import './lib/headless-audio.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const R = join(new URL('.', import.meta.url).href, '..', 'src');
const { World } = await import(`${R}/game/world.ts`);
const { MusicDirector } = await import(`${R}/audio/director.ts`);
const { Transport } = await import(`${R}/core/transport.ts`);

const DT = 1 / 120, MIN = Number(process.argv[2] ?? 12);
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
const w = new World(SEED); w.start();
const d = new MusicDirector(); d.reset(0);
const t = new Transport(); t.start();
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
const inp = { x:0,y:0,shoot:true,focus:false,bomb:false,well:false,choice:0,banish:-1,reroll:false,skip:false };

// One signature per bar, per lane: the pitched content actually scheduled.
const bars = [];
let lastBar = -1;
for (let i = 0; i < Math.round((MIN*60)/DT); i++) {
  w.update(DT, inp); t.advance(DT); d.update(w.snapshot, t, DT);
  const bar = Math.floor(t.bar);
  if (bar !== lastBar) {
    lastBar = bar;
    let evs;
    try { evs = d.masterPattern().queryArc(bar, bar + 1); } catch { continue; }
    const byLane = {};
    for (const h of evs) {
      const v = h.value ?? {};
      const lane = v.orbit ?? v.s ?? '?';
      const n = typeof v.note === 'number' ? v.note : Number(v.note);
      if (!Number.isFinite(n)) continue;
      // Quantise to 16ths and round the pitch: exact times made every bar
      // unique through micro-timing alone, which measures the humaniser, not
      // the music.
      const step = Math.round(Number(h.part.begin - bar) * 16);
      (byLane[lane] ??= []).push(`${step}:${Math.round(n)}`);
    }
    const sig = Object.entries(byLane).sort().map(([k, a]) => `${k}[${[...new Set(a)].sort().join(',')}]`).join('|');
    bars.push(sig);
  }
}
const uniq = new Set(bars);
let sameAsPrev = 0, longestRun = 1, run = 1;
for (let i = 1; i < bars.length; i++) {
  if (bars[i] === bars[i-1]) { sameAsPrev++; run++; longestRun = Math.max(longestRun, run); } else run = 1;
}
// How often does a bar reappear later at all?
const counts = new Map();
for (const b of bars) counts.set(b, (counts.get(b) ?? 0) + 1);
const repeated = [...counts.values()].filter(c => c > 1).length;
const topN = [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3);
console.log(`barvariety — ${MIN} min real run, wave ${w.snapshot.wave}, ${bars.length} bars sampled`);
console.log(`  distinct bar signatures: ${uniq.size} of ${bars.length}  (${(100*uniq.size/bars.length).toFixed(1)}% unique)`);
console.log(`  bar identical to the one before it: ${(100*sameAsPrev/bars.length).toFixed(1)}%`);
console.log(`  longest run of identical consecutive bars: ${longestRun}`);
console.log(`  signatures that occur more than once: ${repeated}`);
console.log(`  most repeated bar appears ${topN[0]?.[1] ?? 0}x  (next ${topN[1]?.[1] ?? 0}x, ${topN[2]?.[1] ?? 0}x)`);
