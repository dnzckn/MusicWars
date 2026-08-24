/**
 * How close the mix gets to superdough's voice cap.
 *
 * This matters more than it used to. The arrangement's dynamics used to work by
 * ADDING AND REMOVING notes — the melody's weak beats deleted when calm, the
 * arp's gap-filling switched off, the chord's 7th and 9th withheld. Fading them
 * instead is what fixed the choppiness (see `tools/retention.mjs`), but it means
 * every one of those notes is now scheduled at ALL times, quiet rather than
 * absent. A quiet note still costs a voice.
 *
 * That is the trade this check watches. When `activeSoundSources` exceeds
 * `setMaxPolyphony`, superdough does not refuse the new note: it ramps the
 * OLDEST voices to zero over 0.25s and stops them. The oldest voices are the
 * sustained ones — the pad, the sub — so hitting the cap sounds like chords
 * cutting out mid-sustain, which is the complaint this whole workstream started
 * from. Trading one cause of choppiness for another would be a poor bargain.
 *
 * Counted by wrapping the source-node constructors and tracking start/ended,
 * because `activeSoundSources` is a module-local inside superdough and is not
 * reachable from the page.
 *
 * THE CONTROL is the empty title screen, measured in the same session: nothing
 * is playing, so it must report zero live voices. If it does not, the counter is
 * wrong — most likely counting nodes that never stop — and every number below
 * is inflated.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const CAP = 96; // must match setMaxPolyphony() in src/audio/engine.ts
const HOLD = Number(process.env.HOLD ?? 12000);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.addInitScript(() => {
  window.__live = 0;
  window.__peak = 0;
  window.__started = 0;
  window.__hist = [];
  const wrap = (proto, name) => {
    const orig = proto[name];
    proto[name] = function (...a) {
      const n = orig.apply(this, a);
      const start = n.start;
      let counted = false;
      n.start = function (...b2) {
        if (!counted) {
          counted = true;
          window.__live++;
          window.__started++;
          if (window.__live > window.__peak) window.__peak = window.__live;
        }
        return start.apply(this, b2);
      };
      n.addEventListener('ended', () => {
        if (counted) {
          counted = false;
          window.__live--;
        }
      });
      return n;
    };
  };
  wrap(BaseAudioContext.prototype, 'createOscillator');
  wrap(BaseAudioContext.prototype, 'createBufferSource');
  setInterval(() => {
    window.__hist.push(window.__live);
    if (window.__hist.length > 6000) window.__hist.shift();
  }, 50);
});

const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// CONTROL: the title screen, before anything is playing.
await p.waitForTimeout(3000);
const idle = await p.evaluate(() => ({ live: window.__live, peak: window.__peak }));
console.log(`control (title screen, nothing playing): ${idle.live} live voices, peak ${idle.peak}`);

await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');

const rows = [];
for (const [label, setup] of [
  ['wave 1', (w) => { w.player.lives = 4; }],
  ['wave 9', (w) => { w.jumpToWave(8); w.player.lives = 4; }],
  ['wave 17', (w) => { w.jumpToWave(16); w.player.lives = 4; }],
  ['wave 25', (w) => { w.jumpToWave(24); w.player.lives = 4; }],
  ['wave 25 + five powerups', (w) => {
    w.jumpToWave(24);
    w.player.lives = 4;
    for (const k of ['drones', 'nova', 'laser', 'spread', 'rapid']) {
      for (let i = 0; i < 3; i++) w.player.addPowerup(k, 600);
    }
  }],
]) {
  await p.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    new Function('w', '(' + src + ')(w)')(window.__musicwars.world);
    window.__peak = 0;
    window.__started = 0;
    window.__hist = [];
  }, setup.toString());
  await p.waitForTimeout(HOLD);
  const r = await p.evaluate(() => {
    const h = window.__hist.slice().sort((a, c) => a - c);
    return {
      peak: window.__peak,
      med: h[Math.floor(h.length / 2)] ?? 0,
      p95: h[Math.floor(h.length * 0.95)] ?? 0,
      perSec: window.__started,
      section: window.__musicwars.readout().section,
    };
  });
  rows.push({ label, ...r });
  console.log(
    `${label.padEnd(24)} ${r.section.padEnd(9)} live voices median ${String(r.med).padStart(3)}  ` +
    `p95 ${String(r.p95).padStart(3)}  PEAK ${String(r.peak).padStart(3)} of ${CAP}   ` +
    `(${Math.round(r.perSec / (HOLD / 1000))} new voices/s)`,
  );
}
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

if (idle.live > 2) {
  console.log(`\nCONTROL FAILED: ${idle.live} voices counted with nothing playing. The counter is not tracking 'ended'; ignore every row above.`);
  process.exit(2);
}
console.log('\ncontrol passed: nothing playing counted as 0 live voices.');
const peak = Math.max(...rows.map((r) => r.peak));
const headroom = CAP - peak;
console.log(`worst case ${peak} of ${CAP} voices — ${headroom} spare (${((peak / CAP) * 100).toFixed(0)}% of the cap)`);
console.log(
  peak > CAP * 0.85
    ? `\n>>> THE MIX IS WITHIN ${headroom} VOICES OF THE CAP; SUSTAINED LAYERS WILL BE STOLEN <<<`
    : '\nthere is room: no layer is at risk of having its voices stolen',
);
process.exit(peak > CAP * 0.85 ? 1 : 0);
