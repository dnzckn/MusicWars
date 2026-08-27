/** Confirms the game is playable with touch alone, at phone size. */
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
const before = await p.evaluate(() => ({ x: window.__musicwars.world.player.x, y: window.__musicwars.world.player.y }));

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
  for (let i = 0; i < 60; i++) {
    send('pointermove', r.left + r.width * 0.2, r.top + r.height * 0.6);
    firing = Math.max(firing, mw.world.playerBullets.count);
    await new Promise((res) => setTimeout(res, 16));
  }
  const pos = { x: mw.world.player.x, y: mw.world.player.y };
  send('pointerup', r.left + r.width * 0.2, r.top + r.height * 0.6);
  return { pos, firing, controlsVisible: !document.getElementById('touch-controls').classList.contains('hidden') };
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
console.log('bomb button     :', bombed.before, '->', bombed.after);
console.log('page errors     :', errs.length ? errs.slice(0, 2) : 'none');
const ok = Math.abs(moved.pos.x - before.x) > 60 && moved.firing > 0 && moved.controlsVisible && bombed.after < bombed.before && !errs.length && overlap.length === 0;
console.log(ok ? 'PLAYABLE ON TOUCH' : 'touch controls incomplete');
if (!ok) process.exit(1);
