/**
 * How often does a layer appear or disappear, and how hard does it land?
 *
 * `stemLevel` is not continuous. It returns 0 below the stem's `in` threshold
 * and `c.floor` immediately above it, and `c.floor` is 0.16 to 0.34 depending
 * on the stem — so crossing `in` is a STEP from silence to a third of full
 * level, not a fade from nothing. The comment above the function says the old
 * entry/exit hysteresis "is no longer needed for gain"; the function it
 * describes has a cliff in it.
 *
 * `damp` smooths the step over a 0.22s halflife, so it is not a click. What it
 * is, if the driving value sits near a threshold, is a layer that arrives and
 * leaves and arrives again — and a listener does not describe that as a fader
 * being ridden, they describe it as the music breaking up.
 *
 * Nothing else in this directory looks for it. `faders` reports each stem's
 * range and whether it is pinned; `chop` measures the output envelope but a
 * layer entering under ten others barely moves the master; `retention` holds
 * the transport still, so no layer can enter during a sweep at all.
 *
 * Measured here: the number of times each stem's fader crosses into and out of
 * audibility per minute, over a real run with a real player, at several waves.
 *
 * And the range `energy` actually travels at each of those waves, which turned
 * out to be the finding. `faders` reports the mix responding and is not wrong —
 * it plays from wave 1 and never leaves the first minute of a run. Jumping to
 * waves 7, 13 and 21 shows something it has never been in a position to see.
 *
 * TWO CONTROLS, printed every run:
 *
 *   `sub` has `in: 0.0` — there is no threshold for it to cross, so it must
 *   report zero entries. If it does not, this is counting damp's ripple rather
 *   than real crossings.
 *
 *   `fx`, `motifs` and `power` are driven by events rather than by the curve
 *   and are expected to move; they are printed but excluded from the verdict,
 *   the same way `mixaudit` excludes them.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const HOLD = Number(process.env.HOLD ?? 30000);
const WAVES = (process.env.WAVES ?? '0,6,12,20').split(',').map(Number);
// Audible enough to hear arrive; quiet enough to call gone. The gap between
// them is deliberate — without it, damp's own ripple counts as a crossing.
const IN = 0.08;
const OUT = 0.02;
const CURVE_DRIVEN = ['sub', 'kick', 'clap', 'hats', 'bass', 'chords', 'arp', 'lead'];

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

await p.evaluate(({ IN, OUT }) => {
  window.__pop = {};
  window.__popReset = () => {
    window.__pop = {};
    /*
     * Seed `on` from where the fader ALREADY is.
     *
     * Starting it at false makes the first sample of every window look like an
     * entry, so every stem reported exactly one crossing per window — including
     * `sub`, which has no threshold to cross. The control caught it, which is
     * the only reason it is not still in the numbers.
     */
    const lv = window.__musicwars.readout().levels;
    for (const [id, v] of Object.entries(lv)) {
      window.__pop[id] = { on: v > OUT, entries: 0, exits: 0, n: 0, sum: 0, band: 0, jump: 0, prev: v };
    }
    window.__energy = { min: 1, max: 0, sum: 0, n: 0 };
    window.__popT0 = performance.now();
  };
  window.__popReset();
  // 60Hz, which is as fast as the levels themselves move (damped once a frame).
  setInterval(() => {
    const w = window.__musicwars.world;
    if (!w || w.player?.dead) return;
    const ro = window.__musicwars.readout();
    const e = window.__energy;
    if (e) {
      if (ro.energy < e.min) e.min = ro.energy;
      if (ro.energy > e.max) e.max = ro.energy;
      e.sum += ro.energy;
      e.n++;
    }
    const lv = ro.levels;
    for (const [id, v] of Object.entries(lv)) {
      const st = window.__pop[id];
      if (!st) continue;
      if (!st.on && v > IN) { st.on = true; st.entries++; }
      else if (st.on && v < OUT) { st.on = false; st.exits++; }
      // Time spent in the dead band between silence and the curve's floor: the
      // stretch a layer can only be in while arriving or leaving.
      if (v > OUT && v < 0.2) st.band++;
      st.jump = Math.max(st.jump, Math.abs(v - st.prev));
      st.prev = v;
      st.sum += v;
      st.n++;
    }
  }, 16);
}, { IN, OUT });

const rows = [];
for (const wave of WAVES) {
  await p.evaluate((wv) => {
    const w = window.__musicwars.world;
    if (wv > 0) w.jumpToWave(wv);
    w.player.lives = 4;
    window.__popReset();
  }, wave);
  await p.waitForTimeout(HOLD);
  const r = await p.evaluate(() => {
    const secs = (performance.now() - window.__popT0) / 1000;
    const out = {};
    for (const [id, st] of Object.entries(window.__pop)) {
      out[id] = {
        perMin: +(((st.entries + st.exits) / secs) * 60).toFixed(1),
        entries: st.entries,
        mean: +(st.sum / Math.max(1, st.n)).toFixed(2),
        bandPct: +((st.band / Math.max(1, st.n)) * 100).toFixed(0),
        jump: +st.jump.toFixed(3),
      };
    }
    const e = window.__energy;
    return {
      wave: window.__musicwars.world.waveIndex + 1,
      secs: +secs.toFixed(0),
      out,
      energy: { min: +e.min.toFixed(2), max: +e.max.toFixed(2), mean: +(e.sum / Math.max(1, e.n)).toFixed(2) },
    };
  });
  rows.push(r);
  console.log(
    `\n=== wave ${r.wave}, ${r.secs}s — energy ${r.energy.min}..${r.energy.max} ` +
    `(range ${(r.energy.max - r.energy.min).toFixed(2)}, mean ${r.energy.mean}) ===`,
  );
  for (const id of Object.keys(r.out)) {
    const c = r.out[id];
    const tag = CURVE_DRIVEN.includes(id) ? '' : '  (event-driven, not asserted)';
    console.log(
      `  ${id.padEnd(7)} in/out ${String(c.perMin).padStart(5)}/min   mean level ${String(c.mean).padStart(4)}   ` +
      `${String(c.bandPct).padStart(3)}% of the time part-way in${tag}`,
    );
  }
}
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

const sub = Math.max(...rows.map((r) => r.out.sub.perMin));
console.log(`\ncontrol — sub has no threshold to cross (in: 0.0) and reported ${sub}/min`);
if (sub > 0.5) {
  console.log('CONTROL FAILED: a stem with no threshold is still crossing, so this is counting ripple. Ignore the numbers above.');
  process.exit(2);
}

let worst = 0, where = '';
for (const r of rows) {
  for (const id of CURVE_DRIVEN) {
    if (id === 'sub') continue;
    if (r.out[id].perMin > worst) { worst = r.out[id].perMin; where = `${id} at wave ${r.wave}`; }
  }
}
console.log(`worst layer: ${where} enters or leaves ${worst} times a minute`);
console.log(
  worst > 6
    ? `\n>>> A LAYER IS APPEARING AND DISAPPEARING ${worst} TIMES A MINUTE <<<`
    : '\nlayers arrive and leave at a musical rate',
);

/*
 * The second verdict, and the one that turned out to matter.
 *
 * `energy` is what every fader reads. If its range collapses at high waves the
 * mix has stopped responding to the player at all — every layer sits at its
 * ceiling forever, which is a wall rather than an arrangement, and no amount of
 * smoothing or de-chopping can make a wall interesting.
 */
const ranges = rows.map((r) => ({ wave: r.wave, range: +(r.energy.max - r.energy.min).toFixed(2) }));
console.log('\nenergy range by wave: ' + ranges.map((r) => `w${r.wave} ${r.range}`).join('  '));
const late = ranges.filter((r) => r.wave >= 10);
const dead = late.filter((r) => r.range < 0.12);
console.log(
  dead.length
    ? `\n>>> THE MIX STOPS RESPONDING: energy moves less than 0.12 at wave ${dead.map((r) => r.wave).join(', ')} <<<`
    : '\nenergy keeps moving at every wave measured',
);
process.exit(worst > 6 || dead.length ? 1 : 0);
