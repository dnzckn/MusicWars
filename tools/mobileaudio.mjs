/**
 * Audio on a phone: boots from a real touch, and recovers from suspension.
 *
 * Cannot run iOS Safari here, so this checks the two things that are testable
 * and were actually wrong: that the context is resumed synchronously inside the
 * gesture, and that a suspended context comes back on the next interaction.
 */
import { chromium, devices } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--mute-audio'] });
const ctx = await b.newContext({ ...devices['Pixel 5'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.addInitScript(() => {
  // Record whether resume() was called while still inside the gesture task.
  window.__resumeSync = null;
  const orig = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function (...a) {
    if (window.__resumeSync === null) window.__resumeSync = !!window.__inGesture;
    return orig.apply(this, a);
  };
  // The start button is a click handler, so track click — and clear the flag on
  // a macrotask, which is the boundary that actually matters for Safari's
  // gesture token.
  document.addEventListener('click', () => { window.__inGesture = true;
    setTimeout(() => { window.__inGesture = false; }, 0); }, true);
});
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.tap('#start-button');
await p.waitForTimeout(6000);

const booted = await p.evaluate(() => ({
  state: window.__musicwars.audio().status,
  started: window.__musicwars.audio().started,
  cycle: +window.__musicwars.audio().cycle.toFixed(1),
  resumeInGesture: window.__resumeSync,
  hud: document.getElementById('ui-audio').textContent,
}));
console.log('after touch start:', JSON.stringify(booted));

// Now force a suspension, as a phone would, and see whether a tap recovers it.
const recovered = await p.evaluate(async () => {
  const c = window.__musicwars.audioCtx();
  await c.suspend();
  // Give the render loop a couple of frames to notice before reading the HUD.
  await new Promise((r) => setTimeout(r, 250));
  return { state: c.state, hud: document.getElementById('ui-audio').textContent };
});
// A real tap: synthetic events carry no user activation, so resume() would be
// refused and the test would blame the game for the harness.
await p.touchscreen.tap(200, 300);
await p.waitForTimeout(1200);
const after = await p.evaluate(() => ({
  state: window.__musicwars.audioCtx().state,
  hud: document.getElementById('ui-audio').textContent,
}));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('suspended        :', JSON.stringify(recovered));
console.log('after a real tap :', JSON.stringify(after));
console.log('page errors      :', errs.length ? errs.slice(0, 2) : 'none');
const ok = booted.state === 'running' && booted.cycle > 1 && booted.resumeInGesture === true
  && recovered.hud === 'tap to resume' && after.state === 'running';
console.log(ok ? 'MOBILE AUDIO BOOTS IN-GESTURE AND RECOVERS' : 'mobile audio path incomplete');
if (!ok) process.exit(1);
