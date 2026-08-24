/**
 * What a run sounds like when it ends.
 *
 * The last thing a player hears is the strongest impression they keep, and the
 * collapse had never been listened to. On death everything mutes except a white
 * noise wash and the sub, the tempo sags and the filter closes — a good
 * gesture, but there is no pitched content in it at all, so the tune the run
 * spent ten minutes teaching simply vanishes rather than finishing.
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
  /*
   * Read the faders, not the patterns.
   *
   * The first version of this counted notes in `sampleBar`, and every lane
   * still had notes right through the collapse — so it reported a melodic
   * ending that nobody can hear. The collapse silences layers at the mixer
   * (`want = 0` for everything but fx and sub), leaving the patterns intact
   * underneath. What reaches the speakers is the level, so that is the thing to
   * ask about.
   */
  const lanes = () => {
    const lv = mw.readout().levels;
    return Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, +v.toFixed(2)]));
  };
  const before = lanes();
  // Kill through the real damage path.
  for (let i = 0; i < 40 && !w.player.dead; i++) {
    w.player.invuln = 0; w.player.bombs = 0;
    if (w.player.takeHit()) Object.getPrototypeOf(w).onPlayerHit.call(w);
    await new Promise((r) => setTimeout(r, 60));
  }
  const samples = [];
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 1600));
    const rd = mw.readout();
    samples.push({ t: (i + 1) * 1.6, section: rd.section, bpm: rd.bpm, lanes: lanes() });
  }
  return { dead: w.player.dead, before, samples };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`lanes before death: ${JSON.stringify(r.before)}`);
for (const s of r.samples) {
  const live = Object.entries(s.lanes).filter(([, n]) => n > 0.05).map(([k, n]) => `${k}:${n}`).join(' ');
  console.log(`+${s.t.toFixed(1)}s  ${s.section.padEnd(9)} ${String(s.bpm).padStart(3)}bpm  ${live || '(nothing)'}`);
}
/*
 * The ending has to settle.
 *
 * The arrangement fading over four seconds was never the problem — that is the
 * gesture working. What was wrong is what remained: the fx noise lane held at
 * 0.58 over a sub drone at 0.13, indefinitely, so the loudest thing in the last
 * mix a player hears was undirected noise that never resolved. A run stopped
 * being played rather than finishing.
 *
 * So this asks whether the wash comes down to the drone it is sitting on, which
 * leaves the tonic as the last thing standing.
 */
const last = r.samples[r.samples.length - 1];
const first = r.samples[0];
const fxSettled = (last.lanes.fx ?? 0) <= (last.lanes.sub ?? 0) * 1.6;
const fxFell = (last.lanes.fx ?? 0) < (first.lanes.fx ?? 1) * 0.5;
const tonicHolds = (last.lanes.sub ?? 0) > 0.05;
console.log(`fx ${first.lanes.fx} -> ${last.lanes.fx}, sub holds at ${last.lanes.sub}`);
if (!fxFell) console.log('the noise wash does not decay');
if (!fxSettled) console.log('the noise wash is still louder than the drone it ends on');
if (!tonicHolds) console.log('nothing pitched is left at the end');
const ok = fxFell && fxSettled && tonicHolds;
console.log(ok ? 'THE RUN ENDS' : 'THE RUN ONLY STOPS');
process.exit(ok ? 0 : 1);
