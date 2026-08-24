/**
 * Does playing well sound different from being in trouble?
 *
 * Combo fed exactly one thing — the `flow` tension term — so a chained,
 * grazing, high-multiplier run pushed the music in the same direction as being
 * about to die: darker and busier. Above a multiplier of eight the lead now
 * grows a descant a sixth above, fading in with the combo. This confirms the
 * extra voice actually reaches the pattern, since the rebuild key had to learn
 * to watch the multiplier before it could.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(12000);
const r = await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  const leadNotes = () => mw.director.sampleBar(w.transport).lead.map((n) => n.n).filter((n) => n !== null);
  /*
   * Poll for up to 30s, not a fixed 6.
   *
   * The director now defers non-urgent rebuilds to a lazy tier that coalesces
   * per phrase — a phrase being eight bars, about fifteen seconds. A six-second
   * window was shorter than the latency the design deliberately introduced, so
   * this reported "THE DESCANT NEVER ARRIVES" for a feature that arrives
   * reliably: measured directly, the lead goes from 8 notes cold to 15 with the
   * multiplier up, it just takes longer than the old check waited. Failing on
   * someone else's intentional latency is not a finding.
   */
  const settle = async (combo) => {
    w.combo = combo;
    const end = performance.now() + 30000;
    let seen = leadNotes();
    while (performance.now() < end) {
      w.combo = combo;
      w.comboTimer = 120;
      await new Promise((r) => setTimeout(r, 150));
      const now = leadNotes();
      if (now.length > seen.length) seen = now;
    }
    return seen;
  };
  const low = await settle(0);
  const high = await settle(30);
  const pitches = (a) => [...new Set(a)].sort((x, y) => x - y);
  return { lowCount: low.length, highCount: high.length, lowPitches: pitches(low).slice(0, 12), highPitches: pitches(high).slice(0, 14) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
// The descant is a third voice on the same rhythm, so a high multiplier should
// put strictly more distinct pitches in the bar than a cold one.
const ok = r.highCount > r.lowCount;
if (!ok) console.log('a high multiplier adds no voice to the lead');
console.log(ok ? 'PLAYING WELL SOUNDS DIFFERENT' : 'THE DESCANT NEVER ARRIVES');
process.exit(ok ? 0 : 1);
