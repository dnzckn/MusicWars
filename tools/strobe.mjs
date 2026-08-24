/**
 * How hard does the screen flash on the beat?
 *
 * `flicker` does NOT measure this despite the name — it counts leadRegister
 * flips while the ship hovers on a threshold, which is a musical-state check
 * with no pixels in it. The complaint this tool exists for is visual: "visual
 * clutter is high, maybe reduce the square in the background strobing".
 *
 * Two measurements, and the first one is the evidence:
 *
 * A. DETERMINISTIC. The world is frozen — enemies, bullets and particles stop
 *    dead — and the renderer is then driven by hand at a fixed 60fps with the
 *    transport advanced manually. Nothing on screen can change except the beat
 *    machinery itself, so the luminance trace *is* the background pulse, with
 *    no gameplay noise to average out. Same family as `gating`: reconstruct the
 *    thing rather than listen to its result in a busy mix.
 *
 * B. LIVE. The real game with the real bot, sampled per animation frame and
 *    folded onto beat phase. Noisier, but it is what a player actually sees.
 *
 * The headline number is SWING: fold every sample onto its phase within the
 * beat, average per bin, and take peak-to-trough of that curve in luma units
 * (0-255). It is a periodic modulation at the beat rate, which is exactly what
 * "strobing" means and what no amount of gameplay motion can fake.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import { ensureChromeDeps } from './lib/chromedeps.mjs';
import { autoClose } from './lib/autoclose.mjs';
import { writeFileSync } from 'node:fs';

// No system NSS and no root on this box; without an extracted copy on
// LD_LIBRARY_PATH the launch below fails as "Target page, context or browser
// has been closed", which reads like a crashed page rather than a missing
// library. See lib/chromedeps.mjs.
console.log(await ensureChromeDeps());

const WAVE = Number(process.env.WAVE ?? 4);
const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
autoClose(b);
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await installDriver(p);
await p.evaluate((w) => {
  const wd = window.__musicwars.world;
  wd.jumpToWave(w);
  wd.player.lives = 9;
}, WAVE);
await p.waitForTimeout(7000);

// The sampler is installed once and used by both phases.
await p.evaluate(() => {
  const mw = window.__musicwars;
  const src = document.getElementById('playfield');
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = Math.round((120 * src.height) / src.width);
  const cg = c.getContext('2d', { willReadFrequently: true });
  window.__luma = () => {
    cg.drawImage(src, 0, 0, c.width, c.height);
    const d = cg.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    let hot = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      if (l > 60) hot++;
    }
    const n = d.length / 4;
    return { luma: sum / n, hot: hot / n, beat: mw.world.transport.beat };
  };
});

/**
 * Fixed-step synthetic render, world frozen.
 *
 * Also returns two stills of the SAME frozen scene — one on the downbeat and
 * one at the far end of the beat. Any difference between that pair is the beat
 * response and nothing else, which is the strobe with the game held still. They
 * have to be grabbed from inside the page: the game's own rAF loop repaints as
 * soon as this evaluate returns, and it repaints with the pulse decayed, so a
 * Playwright screenshot taken afterwards would show neither of these frames.
 */
async function deterministic(bloom, shots = false) {
  return await p.evaluate(async ({ bloom, frames, shots }) => {
    const mw = window.__musicwars;
    const w = mw.world;
    const r = mw.renderer;
    const wasBloom = r.bloomEnabled;
    const wasAuto = r.bloomAuto;
    r.bloomAuto = false;
    r.bloomEnabled = bloom;
    w.frozen = true;
    const dt = 1 / 60;
    const step = () => {
      w.transport.advance(dt);
      r.render(1, dt, w.transport, 0.35, 60);
    };
    const out = [];
    // Warm-up so the pulse and the grid settle into their steady cycle.
    for (let i = 0; i < 90; i++) step();
    for (let i = 0; i < frames; i++) {
      step();
      out.push(window.__luma());
    }

    let peak = null;
    let trough = null;
    if (shots) {
      // What the player sees is both canvases stacked, so composite them.
      const pf = document.getElementById('playfield');
      const ov = document.getElementById('overlay');
      const c = document.createElement('canvas');
      c.width = pf.width;
      c.height = pf.height;
      const cg = c.getContext('2d');
      const grab = () => {
        cg.drawImage(pf, 0, 0);
        cg.drawImage(ov, 0, 0);
        return c.toDataURL('image/png');
      };
      let prev = Math.floor(w.transport.beat);
      for (;;) {
        step();
        const b = Math.floor(w.transport.beat);
        if (b !== prev && b % 4 === 0) break;
        prev = b;
      }
      peak = grab();
      // Far side of the same beat, by which time the pulse has fully decayed.
      while (w.transport.beat % 1 < 0.8) step();
      trough = grab();
    }

    w.frozen = false;
    r.bloomEnabled = wasBloom;
    r.bloomAuto = wasAuto;
    return { rows: out, peak, trough };
  }, { bloom, frames: 300, shots });
}

/** Real frames of the real game. */
async function live(ms) {
  return await p.evaluate(async (ms) => {
    const out = [];
    const stop = performance.now() + ms;
    await new Promise((res) => {
      const tick = () => {
        out.push(window.__luma());
        if (performance.now() < stop) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    return out;
  }, ms);
}

const BINS = 12;
function stats(rows, label) {
  const luma = rows.map((r) => r.luma);
  const mean = luma.reduce((a, x) => a + x, 0) / luma.length;
  const deltas = [];
  for (let i = 1; i < rows.length; i++) deltas.push(Math.abs(luma[i] - luma[i - 1]));
  deltas.sort((a, x) => a - x);
  const dMean = deltas.reduce((a, x) => a + x, 0) / deltas.length;
  const dP95 = deltas[Math.floor(deltas.length * 0.95)];
  // Fold onto phase within the beat, and within the bar.
  const fold = (period) => {
    const sum = new Array(BINS).fill(0);
    const n = new Array(BINS).fill(0);
    for (const r of rows) {
      const ph = ((r.beat / period) % 1 + 1) % 1;
      const k = Math.min(BINS - 1, Math.floor(ph * BINS));
      sum[k] += r.luma;
      n[k]++;
    }
    const curve = sum.map((s, i) => (n[i] ? s / n[i] : NaN)).filter((x) => !Number.isNaN(x));
    return { swing: Math.max(...curve) - Math.min(...curve), curve };
  };
  const beat = fold(1);
  const bar = fold(4);
  const hot = rows.reduce((a, r) => a + r.hot, 0) / rows.length;
  console.log(
    `${label.padEnd(22)} mean luma ${mean.toFixed(2)}  beat swing ${beat.swing.toFixed(2)}  ` +
      `bar swing ${bar.swing.toFixed(2)}  |Δframe| mean ${dMean.toFixed(2)} p95 ${dP95.toFixed(2)}  ` +
      `lit px ${(hot * 100).toFixed(1)}%`,
  );
  console.log(`  ${' '.repeat(20)} beat curve: ${beat.curve.map((x) => x.toFixed(1)).join(' ')}`);
  return { mean, swing: beat.swing, barSwing: bar.swing, dMean, dP95, hot };
}

/** Flip the renderer between the current constants and the pre-fix ones. */
const setLegacy = (on) => p.evaluate((v) => { window.__musicwars.renderer.legacyStrobe = v; }, on);

console.log(`wave ${WAVE}\n`);

/*
 * A/B, INTERLEAVED, IN ONE SESSION.
 *
 * `Renderer.legacyStrobe` restores all five of the old beat responses at once,
 * so both screens can be measured against the same frozen scene, the same
 * transport, the same browser and the same machine load. Comparing across two
 * builds would mean comparing two launches on a box whose I/O throughput swings
 * by an order of magnitude — and `hudab` in tools/README.md is the standing
 * warning about exactly that: it measured one unchanged HUD as costing 7.7fps
 * and then as costing nothing.
 *
 * Repeated ABAB rather than measured once each, for the same reason `hudab`
 * needs four pairs: the pair difference is the finding, not either absolute.
 */
const REPS = Number(process.env.REPS ?? 2);
const runs = { now: [], legacy: [] };
let detB = null;
for (let i = 0; i < REPS; i++) {
  for (const mode of ['now', 'legacy']) {
    await setLegacy(mode === 'legacy');
    // Screenshots come from the first pass of each mode.
    const shots = i === 0;
    const d = await deterministic(true, shots);
    runs[mode].push(stats(d.rows, `frozen ${mode} #${i + 1}`));
    if (shots) {
      const OUT = process.env.SHOT_DIR ?? '/tmp';
      for (const [name, url] of [['peak', d.peak], ['trough', d.trough]]) {
        if (!url) continue;
        const file = `${OUT}/strobe-${mode}-${name}.png`;
        writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
        console.log(`  wrote ${file}`);
      }
    }
    if (mode === 'now' && i === 0) detB = d;
  }
}
await setLegacy(false);

const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
const nowSwing = mean(runs.now.map((r) => r.swing));
const legSwing = mean(runs.legacy.map((r) => r.swing));
const nowSpread = Math.max(...runs.now.map((r) => r.swing)) - Math.min(...runs.now.map((r) => r.swing));
const legSpread = Math.max(...runs.legacy.map((r) => r.swing)) - Math.min(...runs.legacy.map((r) => r.swing));

console.log('\nbloom off, current constants (context for the pair above):');
await setLegacy(false);
stats((await deterministic(false)).rows, 'frozen now, bloom off');

const liveRows = await live(14000);
const l = stats(liveRows, 'live, current');

if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run`);
await b.close();

/*
 * The verdict is the ratio, and the spread is what says whether to believe it.
 *
 * The absolute "before" figure is a reconstruction — this repository has no
 * commits and the fixes were already on disk when the switch was written — so
 * the honest claim is "the beat swing fell by this factor", not "it was exactly
 * N before". If either spread is a large fraction of the gap, the run has not
 * resolved anything and needs more REPS; that is a threshold sitting in its own
 * noise, which is the most common way a check in this directory lies.
 */
const gap = legSwing - nowSwing;
console.log(
  `\nBEAT SWING (frozen, bloom on, mean of ${REPS})` +
    `\n  pre-fix constants   ${legSwing.toFixed(2)} luma   (run-to-run spread ${legSpread.toFixed(2)})` +
    `\n  current             ${nowSwing.toFixed(2)} luma   (run-to-run spread ${nowSpread.toFixed(2)})` +
    `\n  reduction           ${gap.toFixed(2)} luma, ${legSwing > 0 ? ((1 - nowSwing / legSwing) * 100).toFixed(0) : '--'}%`,
);
if (Math.max(nowSpread, legSpread) > Math.abs(gap) * 0.5) {
  console.log('  UNRESOLVED: the run-to-run spread is more than half the difference. Raise REPS.');
}
console.log(`\nLIVE beat swing ${l.swing.toFixed(2)} (${((l.swing / l.mean) * 100).toFixed(0)}% of mean)`);
void detB;
