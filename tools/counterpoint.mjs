/**
 * Confirms the arp fills the melody's rests instead of running over it.
 *
 * Measured at SIXTEENTHS, not eighths. It used to bucket onsets with
 * `Math.round(t * 8)`, which was right while every note in both lanes sat on an
 * eighth — and the melody now carries an ornament, an upper neighbour placed on
 * the second half of its slot. At eighth resolution `Math.round` rounds that
 * half-slot up into the NEXT bucket, which is an arp slot, so the check
 * reported the two lanes colliding when they are a sixteenth apart.
 *
 * The distinction is not academic and it was settled by measurement rather than
 * argument: over 180 arp notes at wave 17, 22% collided under the old bucketing
 * and 0% landed at the same instant, with the only off-grid lead onset at
 * eighth-position 3.500. A passing note a sixteenth ahead of the arp is not the
 * arp doubling the lead — it is the melody leading into it, which is the thing
 * this check exists to encourage.
 *
 * Kept as a warning about resolution: a rhythmic assertion is only as true as
 * the grid it quantises to, and the grid has to keep up with the music.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(24000);
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const mw = window.__musicwars;
  /*
   * The top pitch at each instant, which is the line either lane is heard as.
   * Both stack parallel voices — the lead an octave below itself and a descant
   * a sixth above, the arp one per drone — so taking the highest at each onset
   * follows one part instead of averaging several. Any of them would give the
   * same direction, since they are all parallel.
   */
  const line = (rows) => {
    const byTime = new Map();
    for (const x of rows) {
      if (typeof x.n !== 'number') continue;
      const t = Math.round(x.t * 16);
      byTime.set(t, Math.max(byTime.get(t) ?? -Infinity, x.n));
    }
    return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  };
  // Majority direction of the steps inside the bar, not first-to-last: the arp
  // walks a three-note chord, so a fourth note wraps back and a net reading
  // would call a descending walk ascending.
  const dir = (seq) => Math.sign(seq.slice(1).reduce((a, n, i) => a + Math.sign(n - seq[i]), 0));

  const bars = [];
  for (let k = 0; k < 8; k++) {
    const bar = mw.director.sampleBar({ bar: Math.floor(mw.readout().bar) + k, barPhase: 0 });
    const at = (rows) => new Set(rows.map((x) => Math.round(x.t * 16)));
    bars.push({
      lead: [...at(bar.lead)],
      arp: [...at(bar.arp)],
      leadDir: dir(line(bar.lead)),
      arpDir: dir(line(bar.arp)),
    });
  }
  let collide = 0, arpTotal = 0;
  for (const b of bars) {
    const L = new Set(b.lead);
    for (const a of b.arp) { arpTotal++; if (L.has(a)) collide++; }
  }
  const moving = bars.filter((b) => b.leadDir && b.arpDir);
  const contrary = moving.filter((b) => b.leadDir !== b.arpDir).length;
  return {
    sample: bars[0],
    collidePct: arpTotal ? Math.round((collide / arpTotal) * 100) : -1,
    arpTotal,
    moving: moving.length,
    contrary,
    motion: bars.map((b) => `${b.leadDir >= 0 ? 'up' : 'dn'}/${b.arpDir >= 0 ? 'up' : 'dn'}`).join(' '),
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('bar 0  lead onsets (16ths):', r.sample.lead.sort((a, c) => a - c).join(','));
console.log('bar 0  arp  onsets (16ths):', r.sample.arp.sort((a, c) => a - c).join(','));
console.log(`arp notes landing on a lead note: ${r.collidePct}%  (of ${r.arpTotal})`);
console.log(`lead/arp direction per bar         : ${r.motion}`);
console.log(`bars moving against each other     : ${r.contrary}/${r.moving}`);
/*
 * Rhythm was only half of it. The arp answered in the melody's rests and then
 * climbed the chord in whatever direction it always climbed, so two lanes that
 * take turns were still one shape. It now starts at the top of the chord and
 * walks down when the tune rises, and the reverse when it falls — which is the
 * difference between an accompaniment and a second part.
 */
const ok = r.arpTotal > 4 && r.collidePct <= 20 && r.moving >= 4 && r.contrary >= Math.ceil(r.moving * 0.7);
console.log(ok ? 'ARP AND LEAD INTERLOCK, AND MOVE APART' : 'arp still doubling the lead');
if (!ok) process.exit(1);
