/**
 * How many different eight-bar melodies does a player actually hear?
 *
 * Every other instrument in this directory was built to prove that the music
 * changes too MUCH — that a rebuild rewrote the phrase, that a fader popped a
 * layer in, that a duck chopped the harmony. Those are all fixed, and the
 * complaint has not moved. So this asks the opposite question, which nothing
 * here has ever asked: between the changes, how long does the listener spend
 * hearing the same eight bars over and over?
 *
 * The cached pattern is an eight-bar `cat` and it repeats verbatim until
 * something rebuilds it into different material. `phrasechurn` counts how often
 * that happens; it cannot tell you that the thing being repeated is the same
 * eight bars the listener heard two minutes ago, because it only ever compares
 * consecutive samples. This keeps every distinct melody it has seen, so
 * returning to an earlier one is recognised as a return rather than as a
 * change.
 *
 * Reported per lane: how many distinct eight-bar patterns were heard, how long
 * each was held, and — the number that matters — the longest unbroken stretch
 * of one pattern looping.
 *
 * TWO CONTROLS:
 *
 *   The hash is taken TWICE in the same tick and both must agree, which proves
 *   no continuously-varying control has leaked into it and inflated the count.
 *
 *   `sub` and `kick` are included as a floor: their material is genuinely
 *   simple and repeating, so they SHOULD show few distinct patterns. If they
 *   show many, the hash is too sensitive and the melodic counts are inflated.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const HOLD = Number(process.env.HOLD ?? 180000);
const STEP = Number(process.env.STEP ?? 500);
const LANES = ['lead', 'arp', 'chords', 'bass', 'kick', 'sub'];

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');

await p.evaluate(() => {
  const d = window.__musicwars.director;
  window.__hashLane = (id) => {
    const pat = d.cache[id];
    const out = [];
    for (let c = 0; c < 8; c++) {
      let haps = [];
      try { haps = pat.queryArc(c, c + 1, { _cps: 0.55 }); } catch { return '<throw>'; }
      for (const h of haps) {
        if (!h.hasOnset?.()) continue;
        const v = h.value ?? {};
        // Structure only. Anything a signal writes moves continuously and is
        // not what "a different melody" means.
        out.push(`${(+h.whole.begin).toFixed(4)}:${(+h.whole.end).toFixed(4)}:${v.note ?? ''}:${v.s ?? ''}`);
      }
    }
    return out.join(',');
  };
});

const lanes = {};
for (const id of LANES) lanes[id] = { seen: new Map(), order: [], cur: null, curStart: 0, dwells: [], longest: 0 };
let unstable = 0;
const t0 = Date.now();
let waveMarks = new Set();

while (Date.now() - t0 < HOLD) {
  const snap = await p.evaluate((ids) => {
    const w = window.__musicwars.world;
    w.player.lives = 4;
    w.player.hp = w.player.maxHp;
    const out = {};
    for (const id of ids) {
      const a = window.__hashLane(id);
      const b2 = window.__hashLane(id);
      out[id] = { h: a, stable: a === b2 };
    }
    return { out, wave: w.waveIndex + 1, key: window.__musicwars.readout().key };
  }, LANES);
  waveMarks.add(snap.wave);
  const now = Date.now();
  for (const id of LANES) {
    const L = lanes[id];
    const { h, stable } = snap.out[id];
    if (!stable) unstable++;
    if (h !== L.cur) {
      if (L.cur !== null) {
        const dwell = (now - L.curStart) / 1000;
        L.dwells.push(dwell);
        if (dwell > L.longest) L.longest = dwell;
      }
      L.cur = h;
      L.curStart = now;
      if (!L.seen.has(h)) { L.seen.set(h, L.seen.size); L.order.push(h); }
    }
  }
  await p.waitForTimeout(STEP);
}
// Close the final dwell so a long tail is not silently discarded.
for (const id of LANES) {
  const L = lanes[id];
  if (L.cur !== null) {
    const dwell = (Date.now() - L.curStart) / 1000;
    L.dwells.push(dwell);
    if (dwell > L.longest) L.longest = dwell;
  }
}
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

const mins = HOLD / 60000;
console.log(`\n${mins.toFixed(1)} minutes of continuous play, waves ${Math.min(...waveMarks)}-${Math.max(...waveMarks)}\n`);
console.log('lane      distinct 8-bar patterns   median hold   LONGEST unbroken loop   revisits');
const stats = {};
for (const id of LANES) {
  const L = lanes[id];
  const d = L.dwells.slice().sort((a, c) => a - c);
  const med = d.length ? d[Math.floor(d.length / 2)] : 0;
  // A revisit is a return to a pattern already heard: real repetition rather
  // than simply holding one.
  const revisits = Math.max(0, L.dwells.length - L.seen.size);
  stats[id] = { distinct: L.seen.size, med, longest: L.longest, revisits };
  console.log(
    `${id.padEnd(9)} ${String(L.seen.size).padStart(12)}          ${med.toFixed(1).padStart(5)}s   ` +
    `${L.longest.toFixed(1).padStart(14)}s   ${String(revisits).padStart(8)}`,
  );
}

console.log(
  unstable === 0
    ? '\ncontrol passed: no lane hashed differently twice in the same tick.'
    : `\nCONTROL FAILED: ${unstable} unstable hashes; a continuous control leaked in. Ignore the counts.`,
);
if (unstable > 0) process.exit(2);
if (stats.kick.distinct > stats.lead.distinct) {
  console.log('CONTROL FAILED: the kick shows more distinct patterns than the melody, so the hash is too sensitive to be measuring tunes.');
  process.exit(2);
}
console.log(`control passed: kick ${stats.kick.distinct} distinct against lead ${stats.lead.distinct} — the hash tracks material, not noise.`);

const lead = stats.lead;
console.log(
  `\nthe melody: ${lead.distinct} distinct eight-bar patterns in ${mins.toFixed(1)} minutes, ` +
  `median hold ${lead.med.toFixed(1)}s, longest unbroken loop ${lead.longest.toFixed(1)}s`,
);
console.log(
  lead.longest > 30
    ? `\n>>> THE SAME EIGHT BARS LOOP FOR ${lead.longest.toFixed(0)} SECONDS UNBROKEN <<<`
    : '\nthe melody moves on before it wears out',
);
process.exit(lead.longest > 30 ? 1 : 0);
