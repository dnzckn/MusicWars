/**
 * Does main-thread load starve the audio scheduler?
 *
 * Strudel's scheduler runs on the main thread, and framewhere measured 12-18
 * long tasks of 50-110ms per 15 seconds from pattern queries alone. If the
 * scheduler is being crowded out, the audio queue runs dry and you hear it as
 * choppiness that gets worse when more is happening on screen — which matches
 * the complaint. But that is a story, not a measurement.
 *
 * This decides it. The scheduler's cycle counter should advance at a constant
 * rate in wall-clock time; if it stalls, it stalls because it did not get the
 * thread. So: sample cycle-advance per 100ms window, then deliberately jam the
 * main thread with synchronous busywork and sample again. If jitter rises with
 * load, starvation is real and reducing main-thread work is a fix. If it does
 * not move, the choppiness lives entirely in the pattern layer and no amount of
 * render or sim optimisation will touch it.
 *
 * Interleaved, because this machine's frame rate drifts on its own.
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
await p.waitForTimeout(11000);

const r = await p.evaluate(async () => {
  const mw = window.__musicwars;
  // Cycle advance per 100ms window. Steady scheduling gives a tight
  // distribution; a starved scheduler gives long zero-advance stretches.
  const sample = async (ms, burn) => {
    const deltas = [];
    let last = mw.audio().cycle;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const t0 = performance.now();
      // Synchronous busywork, so it competes for exactly the resource the
      // scheduler needs: the main thread.
      if (burn) { const stop = performance.now() + burn; let x = 0; while (performance.now() < stop) x += Math.sqrt(x + 1); }
      while (performance.now() - t0 < 100) await new Promise((r) => setTimeout(r, 4));
      const now = mw.audio().cycle;
      deltas.push(now - last);
      last = now;
    }
    const mean = deltas.reduce((a, c) => a + c, 0) / deltas.length;
    const sd = Math.sqrt(deltas.reduce((a, c) => a + (c - mean) ** 2, 0) / deltas.length);
    const stalls = deltas.filter((d) => d < mean * 0.25).length;
    return { mean: +mean.toFixed(4), jitter: +(sd / mean).toFixed(3), stallPct: +((stalls / deltas.length) * 100).toFixed(1), n: deltas.length };
  };
  const idle = [], loaded = [];
  for (let i = 0; i < 3; i++) {
    idle.push(await sample(4000, 0));
    loaded.push(await sample(4000, 55));
  }
  const avg = (a, k) => +(a.reduce((x, y) => x + y[k], 0) / a.length).toFixed(3);
  return {
    idle: { jitter: avg(idle, 'jitter'), stallPct: avg(idle, 'stallPct') },
    loaded: { jitter: avg(loaded, 'jitter'), stallPct: avg(loaded, 'stallPct') },
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table([{ thread: 'idle', ...r.idle }, { thread: 'jammed 55ms/100ms', ...r.loaded }]);
const worse = r.loaded.stallPct > r.idle.stallPct + 5 || r.loaded.jitter > r.idle.jitter * 1.6;
console.log(
  worse
    ? `\n>>> SCHEDULER IS STARVED BY MAIN-THREAD LOAD: stalls ${r.idle.stallPct}% -> ${r.loaded.stallPct}%, jitter ${r.idle.jitter} -> ${r.loaded.jitter}. Reducing render/sim work is a real fix for choppiness. <<<`
    : `\nscheduler holds under load (stalls ${r.idle.stallPct}% -> ${r.loaded.stallPct}%): choppiness is NOT main-thread starvation, look in the pattern layer`,
);
process.exit(0);
