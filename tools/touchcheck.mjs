/**
 * Confirms the game is playable with touch alone, at phone size.
 *
 * THE THROTTLE RULE, since 2026-09-06. The owner, from a phone: "clicking on
 * the screen makes the ship slow down (if the click is behind the ship),
 * should literally be binary, click to go faster or youre decelerating … but
 * letting go shouldnt slow down the ship but go back to base line speed, so
 * to slow dowh the ship you need to click and drag backwards". The touch
 * layer used to steer toward the finger in y as well as x, which is that bug.
 * This tool never asserted the y-following — its one movement assertion is
 * the x displacement of the drag, which survives unchanged — so nothing was
 * replaced; three assertions were ADDED for the rule that took its place:
 * while the finger is down and not dragged, `world.throttle` reads exactly
 * +1 on every sample (binary: a held finger is the boost, wherever it
 * landed — here it lands at 60% of the field's height, below the ship), the
 * ship's `vy` goes at least 200 px/s past its pre-touch cruise (the trim is
 * `TRIM_SPEED` = 430 at full throttle, less the settle term's 160 at the
 * top clamp; measured -700 against a cruise of -430), and 150 ms after the
 * lift the throttle reads 0 — cruise, not the -1 the previous day's mouse
 * rule would have given. Read off the world, not the input, so the whole
 * path from a synthetic `PointerEvent` through `main.ts` to `World.update`
 * is under the assertion. Seen red by running this file against a mutated
 * `input.ts`: pressed-reads-0 ("throttle held" min 0, "vy" not past the
 * cruise) and released-reads-minus-1 ("after lift" -1), then restored.
 */
import { chromium, devices } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const ctx = await b.newContext({ ...devices['Pixel 5'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.tap('#start-button');
await p.waitForTimeout(2500);

const box = await p.locator('#playfield').boundingBox();
const cx = box.x + box.width / 2;
const before = await p.evaluate(() => ({
  x: window.__musicwars.world.player.x,
  y: window.__musicwars.world.player.y,
  vy: window.__musicwars.world.player.vy,
}));

// Drag: down near the middle, move left, hold.
await p.touchscreen.tap(cx, box.y + box.height * 0.8);
await p.waitForTimeout(200);
const moved = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const el = document.getElementById('stage');
  const r = document.getElementById('playfield').getBoundingClientRect();
  const send = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true }));
  send('pointerdown', r.left + r.width * 0.2, r.top + r.height * 0.6);
  /*
   * The bullet count is a HIGH-WATER MARK over the whole drag, not the value at
   * the instant the drag ends.
   *
   * It was the instant, and that made this check flaky in a way that looked
   * like a real failure: instruments are beat-locked, so `playerBullets.count`
   * is legitimately 0 between volleys, and one run in four sampled a gap and
   * reported "touch controls incomplete" on a game that was firing perfectly.
   * Measured 3 passes and 1 failure across four consecutive runs with no code
   * change between them.
   *
   * "Did the ship fire while the finger was down" is the question the check
   * means to ask, and a maximum over the second the finger was down answers it
   * without depending on where in the bar the shutter fell.
   */
  let firing = 0;
  // The throttle over the hold, min and max: binary means both read 1.
  let thrMin = Infinity;
  let thrMax = -Infinity;
  let minVy = Infinity;
  for (let i = 0; i < 60; i++) {
    send('pointermove', r.left + r.width * 0.2, r.top + r.height * 0.6);
    // Sample AFTER the wait: a read in the same tick as the pointerdown sees
    // the world before any simulation step has looked at the finger, and
    // reported the pre-touch throttle as the hold's minimum (-0 on the first
    // run of this assertion). The harness being early, not the game being
    // slow.
    await new Promise((res) => setTimeout(res, 16));
    firing = Math.max(firing, mw.world.playerBullets.count);
    thrMin = Math.min(thrMin, mw.world.throttle);
    thrMax = Math.max(thrMax, mw.world.throttle);
    minVy = Math.min(minVy, mw.world.player.vy);
  }
  const pos = { x: mw.world.player.x, y: mw.world.player.y };
  send('pointerup', r.left + r.width * 0.2, r.top + r.height * 0.6);
  // Long enough for several simulation steps; the release is level state, not an edge.
  await new Promise((res) => setTimeout(res, 150));
  const after = mw.world.throttle;
  return {
    pos,
    firing,
    thrMin,
    thrMax,
    minVy,
    after,
    controlsVisible: !document.getElementById('touch-controls').classList.contains('hidden'),
  };
});
// Tap the bomb button.
const bombed = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const before = mw.world.player.bombs;
  const el = document.getElementById('touch-bomb');
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 500));
  el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true, cancelable: true }));
  return { before, after: mw.world.player.bombs };
});
/*
 * The buttons must not sit on the playfield.
 *
 * They were absolutely positioned at the stage's bottom-right corner, so three
 * 72%-opaque blocks covered the lower-right of the play area for the whole of
 * this project's history — the region a right thumb already hides, and one
 * bullets still travel through. Nothing caught it because every touch check
 * asked whether the controls *worked*, never where they were.
 */
const overlap = await p.evaluate(() => {
  const field = document.getElementById('playfield').getBoundingClientRect();
  const hits = [];
  for (const b of document.querySelectorAll('#touch-controls button')) {
    const r = b.getBoundingClientRect();
    const w = Math.min(field.right, r.right) - Math.max(field.left, r.left);
    const h = Math.min(field.bottom, r.bottom) - Math.max(field.top, r.top);
    if (w > 0 && h > 0) hits.push({ id: b.id, area: Math.round(w * h) });
  }
  return hits;
});
console.log('over the playfield:', overlap.length ? JSON.stringify(overlap) : 'none');

await p.screenshot({ path: 'tools/shot-mobile.png' });
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('ship before drag:', JSON.stringify(before));
console.log('ship after drag :', JSON.stringify({ x: Math.round(moved.pos.x), y: Math.round(moved.pos.y) }));
console.log('auto-firing     :', moved.firing > 0, ' controls visible:', moved.controlsVisible);
console.log('throttle held   : min', moved.thrMin, 'max', moved.thrMax, '(want 1, 1 — a held finger is the boost, wherever it landed)');
console.log('vy during hold  : min', Math.round(moved.minVy), 'vs cruise before', Math.round(before.vy), '(want at least 200 past it)');
console.log('after the lift  : throttle', moved.after, '(want 0 — cruise, not -1)');
console.log('bomb button     :', bombed.before, '->', bombed.after);
console.log('page errors     :', errs.length ? errs.slice(0, 2) : 'none');
const throttleOk = moved.thrMin === 1 && moved.thrMax === 1 && moved.minVy < before.vy - 200 && moved.after === 0;
const ok =
  Math.abs(moved.pos.x - before.x) > 60 &&
  moved.firing > 0 &&
  throttleOk &&
  moved.controlsVisible &&
  bombed.after < bombed.before &&
  !errs.length &&
  overlap.length === 0;
console.log(ok ? 'PLAYABLE ON TOUCH' : 'touch controls incomplete');
if (!ok) process.exit(1);
