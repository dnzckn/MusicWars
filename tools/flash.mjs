/*
 * flash — how fast does anything on screen flash, and how deep is the swing?
 *
 * `tools/strobe.mjs` covers the background beat pulse, but it drives a real
 * browser and so is dark whenever this box is stalled. It also only looks at
 * the backdrop. The player sprite's invulnerability blink was never measured
 * by anything, and it was the worst offender in the frame: a hard parity flip
 * between alpha 0.4 and 1.0 sixteen times a second — 8Hz for 3.2s after every
 * hit, 4.8s after losing a life.
 *
 * WCAG 2.3.1 puts the ceiling at three flashes per second. This reimplements
 * the renderer's alpha curve as a pure function of time and measures it
 * directly, so the check runs in plain Node with no canvas.
 *
 * It measures the CURVE, not the pixels, and that is a real limit: it can tell
 * you the ship's alpha oscillates at 2.6Hz, not what the composite frame looks
 * like once particles and the grid are over it. `strobe.mjs` is still the tool
 * for that, on a box where it can run.
 */
import { readFileSync } from 'node:fs';

/*
 * A MIRROR THAT CAN DRIFT IS A GATE THAT LIES.
 *
 * `playerAlpha` below is a hand copy of the renderer's curve, which is the
 * only way to measure it without a canvas — and it would keep reporting 2.3Hz
 * quite happily after someone put an 8Hz parity flip back into `drawPlayer`.
 * So the source is checked too: the expression must still be there, and the
 * parity-blink shape must not be. Same approach `clash.mjs` takes to
 * `theory.ts` — read the file as text rather than trusting a copy of it.
 */
const RENDERER = new URL('../src/render/renderer.ts', import.meta.url).pathname;
const src = readFileSync(RENDERER, 'utf8');
/*
 * Comments stripped first, and that is not a detail. The block above
 * `drawPlayer` documents the defect by QUOTING the old expression, so the
 * parity-blink test matched its own explanation and the tool failed on clean
 * code. A source check that reads prose is testing the documentation.
 */
const drawPlayer = src
  .slice(src.indexOf('private drawPlayer('), src.indexOf('private drawPlayer(') + 6000)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');
const driftFails = [];
if (!drawPlayer.includes('0.55 + 0.45 * (0.5 + 0.5 * Math.cos(')) {
  driftFails.push('renderer.ts drawPlayer no longer contains the pulse expression this tool mirrors — the numbers below are about code that is not running');
}
if (/Math\.floor\([^)]*invuln[^)]*\)\s*%\s*2/.test(drawPlayer)) {
  driftFails.push('renderer.ts drawPlayer has a parity blink on invuln again — that is the 8Hz strobe this tool exists to prevent');
}

const INVULN_ON_HIT = 3.2;
const TAU = Math.PI * 2;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Mirrors `drawPlayer` in src/render/renderer.ts. Keep the two in step. */
function playerAlpha(invuln) {
  if (invuln <= 0) return 1;
  const invulnFrac = clamp01(invuln / INVULN_ON_HIT);
  return 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(invuln * (3 - invulnFrac * 2) * TAU));
}

/** WCAG 2.3.1: three per second. */
const MAX_HZ = 3.0;
/*
 * A gradual change is not a "flash", so a smooth curve is judged on rate
 * alone. This bound is about readability instead: the ship has to stay
 * trackable while the player is recovering from the hit that caused it.
 */
const MIN_ALPHA = 0.5;

const FPS = 240;
const cases = [['after a hit', INVULN_ON_HIT], ['after losing a life', INVULN_ON_HIT * 1.5]];
const fails = [...driftFails];
console.log('\nflash — player invulnerability, reconstructed from the renderer curve\n');
for (const [label, dur] of cases) {
  const xs = [];
  for (let i = 0; i <= dur * FPS; i++) xs.push(playerAlpha(dur - i / FPS));
  // Count local extrema: one full oscillation is two, so peaks = extrema / 2.
  let extrema = 0;
  for (let i = 1; i < xs.length - 1; i++) {
    if ((xs[i] > xs[i - 1] && xs[i] >= xs[i + 1]) || (xs[i] < xs[i - 1] && xs[i] <= xs[i + 1])) extrema++;
  }
  const hz = extrema / 2 / dur;
  // Fastest single oscillation, which is what the rate ramp pushes at the end.
  let peakHz = 0, last = null, lastI = 0;
  for (let i = 1; i < xs.length - 1; i++) {
    if (xs[i] > xs[i - 1] && xs[i] >= xs[i + 1]) {
      if (last !== null) peakHz = Math.max(peakHz, 1 / ((i - lastI) / FPS));
      last = i; lastI = i;
    }
  }
  const lo = Math.min(...xs), hi = Math.max(...xs);
  console.log(`  ${label.padEnd(20)} ${dur.toFixed(1)}s   mean ${hz.toFixed(2)}Hz   peak ${peakHz.toFixed(2)}Hz   alpha ${lo.toFixed(2)}-${hi.toFixed(2)}`);
  if (peakHz > MAX_HZ + 1e-6) fails.push(`${label}: peaks at ${peakHz.toFixed(2)}Hz, over the WCAG 2.3.1 ceiling of ${MAX_HZ}/s`);
  if (lo < MIN_ALPHA) fails.push(`${label}: drops to alpha ${lo.toFixed(2)} — the ship stops being trackable when the player most needs it`);
}
console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  the ship pulses under the flash ceiling and stays readable');
console.log('\n  Before: a hard alpha 0.4/1.0 parity flip at 8Hz for the whole duration.');
console.log('  The rate now rides the remaining time, so quickening IS the warning.');
