/*
 * vibprobe — which lanes actually carry a live vibrato, measured off the haps.
 *
 * WHY THIS EXISTS. `src/types/strudel.d.ts` makes an unusually strong claim in
 * its note on `vib`, and it is the right one: "A pulse or triangle held at a
 * fixed frequency is a test tone — the ear hears an oscillator. The same note
 * with a few cents of periodic movement is heard as *sung*, because every
 * physical instrument and voice does it. Its absence is a large part of what
 * makes a chip melody read as synthetic."
 *
 * That note sat in the type declarations while `.vib()` appeared in exactly ONE
 * place in the entire score. Nothing measured it, so nothing noticed. This is
 * the repo's recurring failure — an unmeasured property rots — and the standing
 * complaint it feeds is "abrasive on the listener over time", which is what
 * spectral fatigue sounds like when a listener describes it.
 *
 * WHY IT READS HAPS AND NOT SOURCE. superdough puts the whole vibrato
 * oscillator behind `if (vib > 0)`, so `.vibmod()` without `.vib()` is SILENT —
 * a control that fails without saying so. And `.vib()` without `.vibmod()`
 * takes superdough's default depth of 0.5, which is half a semitone and audibly
 * out of tune on a sustained chord. Both failures look completely fine in the
 * source. So the question "is this lane actually vibrating, and by how much" can
 * only be answered from the values the scheduler will really see.
 *
 * WHAT TO READ. `with vib` is the share of a stem's haps carrying `vib > 0`; a
 * stem at 0% is a mathematically perfect oscillator. `distinct rates` is the
 * important column for any lane voiced more than once: an ensemble sounds like
 * an ensemble because no two players return to centre together, so a chord
 * showing ONE rate across its voices has vibrato but no ensemble — they all
 * wobble in lockstep, which is a phaser, not a section.
 *
 * This tool has no thresholds and no verdict on purpose. There is no defensible
 * a priori answer to "what fraction of haps should vibrate" — a sub bass should
 * be 0% and a pad should not — and inventing one here would be the third
 * invented threshold this phase has had to retract. It prints; you judge.
 */
import './lib/headless-audio.mjs';

const R = new URL('../src/', import.meta.url).pathname;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport, BARS_PER_PHRASE } = await import(`${R}core/transport.ts`);
const { STEM_IDS } = await import(`${R}audio/layers.ts`);
const { makeBrain } = await import('./lib/bot-brain.mjs');

const argv = process.argv.slice(2);
const SECS = Number(argv.find((a) => /^\d+$/.test(a)) ?? 180);
const SEED = 0x51ed;
const DT = 1 / 120;

const w = new World(SEED);
w.start();
const d = new MusicDirector();
d.reset(0);
const t = new Transport();
t.start();
for (const [ev, fn] of [
  ['wave:start', (e) => d.onWaveStart(t, e)],
  ['wave:clear', (e) => d.onWaveClear(t, e)],
  ['boss:telegraph', (e) => d.onBossTelegraph(t, e)],
  ['boss:phase', (e) => d.onBossPhase(t, e)],
  ['boss:defeat', () => d.onBossDefeat(t)],
  ['player:hit', () => d.onPlayerHit()],
  ['player:death', () => d.onPlayerDeath(t)],
  ['player:bomb', () => d.onBomb(t)],
  ['powerup:pickup', (e) => d.onPickup(t, e.kind)],
  ['powerup:expire', (e) => d.onPickup(t, e.kind)],
]) w.bus.on(ev, fn);

const drive = makeBrain('dodge');
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

const stat = new Map();
let lastBar = -1;
for (let i = 0; i < Math.round(SECS / DT); i++) {
  if (i % 2 === 0) drive(w, inp);
  w.update(DT, inp);
  t.advance(DT);
  d.update(w.snapshot, t, DT);
  const bar = Math.floor(t.bar);
  if (bar === lastBar) continue;
  lastBar = bar;
  for (const id of STEM_IDS) {
    const p = d.cache?.[id];
    if (!p) continue;
    let haps;
    try {
      haps = p.queryArc(0, BARS_PER_PHRASE);
    } catch {
      continue;
    }
    let a = stat.get(id);
    if (!a) {
      a = { haps: 0, withVib: 0, rates: new Set(), depths: new Set() };
      stat.set(id, a);
    }
    for (const h of haps) {
      const v = h.value ?? {};
      a.haps++;
      if (typeof v.vib === 'number' && v.vib > 0) {
        a.withVib++;
        a.rates.add(+v.vib.toFixed(3));
        if (typeof v.vibmod === 'number') a.depths.add(+v.vibmod.toFixed(4));
      }
    }
  }
}

console.log(`\nvibprobe — haps carrying a live vibrato (vib > 0), ${SECS}s seed 0x${SEED.toString(16)}\n`);
console.log('  stem            haps   with vib   distinct rates            depth range');
for (const id of STEM_IDS) {
  const a = stat.get(id);
  if (!a || !a.haps) continue;
  const rates = [...a.rates].sort((x, y) => x - y);
  const dep = [...a.depths].sort((x, y) => x - y);
  const pct = `${((a.withVib / a.haps) * 100).toFixed(0)}%`;
  const rs = rates.length ? (rates.length > 5 ? `${rates.length} values ${rates[0]}..${rates.at(-1)}` : rates.join(' ')) : '-';
  const ds = dep.length ? `${dep[0]}..${dep.at(-1)}` : '-';
  console.log(`  ${id.padEnd(14)}${String(a.haps).padStart(6)}${pct.padStart(11)}   ${rs.padEnd(26)}${ds}`);
}
const silent = STEM_IDS.filter((id) => (stat.get(id)?.withVib ?? 0) === 0 && (stat.get(id)?.haps ?? 0) > 0);
console.log(`\n  ${silent.length} of ${[...stat.keys()].length} scheduled stems are fixed-frequency: ${silent.join(' ')}`);
console.log('  A drum or a sub belongs in that list. A sustained pitched lane does not.\n');
