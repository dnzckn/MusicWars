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
 *
 * THE MOBILE BLOCKERS, since 2026-09-06 (stage 1 of the mobile programme).
 * The owner: "make this game mobile ready; the majority audience will play
 * this on the phone" — "i don't mean working on mobile = done, i mean really
 * make the mobile experience premium and polished". The platform audit's
 * critical row was that on touch there was NO way to open the level-up offer
 * (Space only) and no way to unpause (P only) — and `visibilitychange` pauses
 * on every notification. Every assertion below is measured through REAL
 * Playwright touch taps (`touchscreen.tap`, a CDP touch under the hood), not
 * synthetic PointerEvents, except where a block says otherwise, and each was
 * seen red once by a deliberate mutation, then restored:
 *
 *   row-before-touch   `#touch-controls` visible before any touch on a coarse
 *                      pointer — red with the `coarsePointer()` reveal in
 *                      main.ts changed to `false` (the row appeared only on
 *                      the first touch, the old 20 px stage jump).
 *   levelup-visible    the LEVEL UP button is shown while `pending > 0`,
 *                      ≥ 52 px tall and the widest button in the row — red
 *                      with `paintTouchRow` never un-hiding it (`|| true`),
 *                      and red on height with `#touch-levelup { height: 40px }`.
 *   hud-says-tap       the XP line reads `— TAP`, not `— SPACE` — red with
 *                      `offerKeyWord()` returning 'SPACE' unconditionally.
 *   levelup-tap        a real tap on LEVEL UP opens the offer (`world.choosing`)
 *                      — red with the `touch-levelup` binding made a no-op.
 *   levers-size        REROLL / BANISH / SKIP are DOM buttons ≥ 44 CSS px tall
 *                      while choosing — red with `.touch .lever { height: 30px }`.
 *   no-canvas-levers   `hitTestControl` finds nothing along the canvas lever
 *                      row on a coarse pointer (they would duplicate the DOM
 *                      ones) — red with the `coarsePointer()` return removed
 *                      from `drawControls`.
 *   banish-armed       a tap on BANISH arms it (text says TAP A CARD) and a
 *                      tap on card 0 then spends a banish, the offer staying
 *                      open on a fresh set — red with `banishArmed` dropped
 *                      from `routeOfferPointer`'s modifier test (the card was
 *                      chosen instead: choosing false, banishes unchanged).
 *   skip-tap           a real tap on SKIP closes the offer — red with the
 *                      `touch-skip` binding made a no-op.
 *   badge-tap          a real tap on the ship's TAP badge opens the offer —
 *                      red with `routePromptPointer` returning false.
 *   pause-button       the ⏸ button is ≥ 44 px and a tap on it pauses (the
 *                      pause screen up, `paused()` true, the clock frozen) —
 *                      red with the `ui-pause` listener removed.
 *   resume-tap         a tap on RESUME resumes, and the clock moves — red
 *                      with the `pause-resume` listener removed.
 *   visibility-resume  a simulated `visibilitychange` hidden→visible leaves
 *                      the pause screen up and a RESUME tap takes it down —
 *                      red twice: with the handler's `setPaused(true)` gated
 *                      off ("hidden paused false"), and with the RESUME
 *                      listener removed ("RESUME by tap -> paused true").
 *   min-target         all four `#touch-controls` buttons (measured with
 *                      `.hidden` lifted — the row is empty in ordinary play
 *                      since FOCUS/BOMB/WELL went) and every pause-screen
 *                      button are ≥ 44 CSS px on both axes — red with the
 *                      mobile block's `.touch button { height: 40px }` and
 *                      with `.pause-actions button { min-height: 0 }`.
 *   row-holds          `#touch-controls` contains exactly LEVEL UP, REROLL,
 *                      BANISH and SKIP, and `touch-focus` / `touch-bomb` /
 *                      `touch-well` are absent from the document — red by
 *                      putting any one of the three back in `index.html`,
 *                      which is the way they would come back.
 *   gesture-css        computed `overscroll-behavior: none` on html/body,
 *                      `contain` + `touch-action: pan-y` on `.screen`,
 *                      `pan-x pan-y` + `user-select: none` on `#app`, `none`
 *                      on `#touch-controls` — red with each declaration
 *                      deleted in turn.
 *   volume-drags       a real touch drag on `#ui-volume` still moves it
 *                      under the new rules — red with
 *                      `#ui-volume { pointer-events: none }`.
 *
 * The mutations were run in four batches (eleven, four, three and two reds,
 * every one the expected assertion and no other), which is why each block
 * below carries a keyboard FALLBACK: a red in one block must not cascade into
 * the next, or a batch would show one defect as six. The first green run also
 * found a real defect the layout pass had mis-measured as height: BOMB and
 * WELL were 40.8 px WIDE, because the row shrank to fit its content and
 * `flex: 1` had nothing to grow into — `min-target` measures both axes.
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

/*
 * BEFORE THE FIRST TOUCH. The row used to be revealed by the first pointerdown,
 * which shrank the stage 20 px under the START tap; on a coarse pointer it is
 * now there from load. Measured here, before `tap('#start-button')`, or it
 * measures nothing.
 */
const rowBeforeTouch = await p.evaluate(() => ({
  coarse: matchMedia('(pointer: coarse)').matches,
  visible: !document.getElementById('touch-controls').classList.contains('hidden'),
  height: document.getElementById('touch-controls').getBoundingClientRect().height,
}));

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
/*
 * WHAT THE ROW HOLDS — replacing the bomb-button tap, which had no button left
 * to tap.
 *
 * That probe pressed `#touch-bomb` and asserted `player.bombs` went down. The
 * button is gone: "remove focus bomb and well". The assertion is REPLACED
 * rather than dropped, because the thing worth pinning is now the opposite —
 * that the row holds the run's decisions and nothing else, so a future button
 * cannot creep back in unnoticed. Every id must be one of the four, and the
 * three removed ids must be absent from the whole document (not merely hidden:
 * a hidden button is one CSS rule away from being back on the field).
 */
const rowIds = await p.evaluate(() => ({
  present: [...document.querySelectorAll('#touch-controls button')].map((b) => b.id),
  removed: ['touch-focus', 'touch-bomb', 'touch-well'].filter((id) => document.getElementById(id) !== null),
}));
const ROW_ALLOWED = ['touch-levelup', 'touch-reroll', 'touch-banish', 'touch-skip'];
const rowStray = rowIds.present.filter((id) => !ROW_ALLOWED.includes(id));
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

/* ------------------------------------------------------------------------ *
 * The mobile blockers. Each block is independent and records its own
 * verdict, so a mutation pass shows every red at once rather than the first.
 * ------------------------------------------------------------------------ */
const bad = [];
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) bad.push(name);
};
/** Centre of an element, in CSS px, for a real tap. */
const centre = (sel) => p.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
}, sel);
/** Every visible button under a root, with its box. */
const buttons = (root) => p.evaluate((root) => {
  return [...document.querySelectorAll(`${root} button`)]
    .filter((b) => b.getClientRects().length > 0)
    .map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent.trim(), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; });
}, root);

console.log('\nmobile blockers');
check('row-before-touch', rowBeforeTouch.coarse && rowBeforeTouch.visible && rowBeforeTouch.height >= 44,
  `coarse ${rowBeforeTouch.coarse}, visible ${rowBeforeTouch.visible}, ${Math.round(rowBeforeTouch.height)}px tall before any touch`);

// A banked level, one, so SKIP leaves nothing queued to reopen behind it.
const lvl = await p.evaluate(async () => {
  const mw = window.__musicwars;
  mw.world.progression.pending = 1;
  // Two frames for the render hook's `paintTouchRow` and the HUD.
  await new Promise((r) => setTimeout(r, 120));
  const row = [...document.querySelectorAll('#touch-controls button')]
    .filter((b) => b.getClientRects().length > 0)
    .map((b) => ({ id: b.id, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
  const me = row.find((r) => r.id === 'touch-levelup');
  return {
    visible: !!me,
    h: me?.h ?? 0,
    w: me?.w ?? 0,
    widest: !!me && row.every((r) => r.id === 'touch-levelup' || r.w < me.w),
    text: document.getElementById('touch-levelup').textContent,
    hud: document.getElementById('ui-xpnum').textContent,
  };
});
check('levelup-visible', lvl.visible && lvl.h >= 52 && lvl.widest,
  `${lvl.visible ? `"${lvl.text}" ${Math.round(lvl.w)}x${Math.round(lvl.h)}, widest ${lvl.widest}` : 'not shown with pending 1'}`);
check('hud-says-tap', /LEVEL UP — TAP$/.test(lvl.hud), `xp line "${lvl.hud}"`);

let opened = { choosing: false };
if (lvl.visible) {
  const c = await centre('#touch-levelup');
  await p.touchscreen.tap(c.x, c.y);
  await p.waitForTimeout(400);
  opened = await p.evaluate(() => ({ choosing: window.__musicwars.world.choosing, pending: window.__musicwars.world.progression.pending }));
}
check('levelup-tap', opened.choosing, `choosing ${opened.choosing} after a real tap on LEVEL UP`);
/*
 * FALLBACKS, so one red does not cascade into six. Each block below measures
 * its own thing; if the block before it failed to leave the world in the
 * state it needs, the keyboard puts it there and says so. The fallback is
 * never what is asserted.
 */
const fallback = async (what, key) => {
  console.log(`        (fallback: ${what} via ${key})`);
  await p.keyboard.press(key);
  await p.waitForTimeout(400);
};
if (!opened.choosing) {
  await fallback('opening the offer', 'Space');
  opened = await p.evaluate(() => ({ choosing: window.__musicwars.world.choosing }));
}

let levers = [];
let canvasLevers = null;
if (opened.choosing) {
  // Give the overlay its 0.6 s entry, which is when the canvas row would appear.
  await p.waitForTimeout(700);
  levers = await buttons('#touch-controls');
  canvasLevers = await p.evaluate(() => {
    const mw = window.__musicwars;
    const W = mw.world.viewW, H = mw.world.viewH;
    // The canvas row sits at H - 30 (levelup.ts drawControls); scan its whole width.
    let hits = 0;
    for (let x = 0; x < W; x += 4) if (mw.renderer.levelUp.hitTestControl(x, H - 30)) hits++;
    return { hits, text: [...document.querySelectorAll('#touch-controls .lever')].map((b) => b.textContent) };
  });
}
const leverIds = ['touch-reroll', 'touch-banish', 'touch-skip'];
const leverOk = leverIds.every((id) => levers.some((l) => l.id === id && l.h >= 44)) && levers.every((l) => leverIds.includes(l.id));
check('levers-size', leverOk, `row while choosing: ${JSON.stringify(levers)}`);
check('no-canvas-levers', canvasLevers !== null && canvasLevers.hits === 0,
  canvasLevers ? `${canvasLevers.hits} canvas lever hits along the old row; DOM levers ${JSON.stringify(canvasLevers.text)}` : 'offer never opened');

// BANISH, two-step: arm it, then tap card 0 through the same hit-test the
// cards are drawn with, converted view -> CSS px through the playfield box.
let banish = { armed: false, spent: false, stillOpen: false };
if (opened.choosing) {
  const beforeB = await p.evaluate(() => window.__musicwars.world.progression.offer?.banishesLeft ?? -1);
  const bc = await centre('#touch-banish');
  await p.touchscreen.tap(bc.x, bc.y);
  await p.waitForTimeout(150);
  const armedText = await p.evaluate(() => document.getElementById('touch-banish').textContent);
  const card = await p.evaluate(() => {
    const mw = window.__musicwars;
    const r = mw.renderer.levelUp.rects()[0];
    const pf = document.getElementById('playfield').getBoundingClientRect();
    const k = pf.width / mw.world.viewW;
    return r ? { x: pf.left + (r.x + r.w / 2) * k, y: pf.top + (r.y + r.h / 2) * k } : null;
  });
  if (card) {
    await p.touchscreen.tap(card.x, card.y);
    await p.waitForTimeout(400);
  }
  const afterB = await p.evaluate(() => ({
    left: window.__musicwars.world.progression.offer?.banishesLeft ?? -1,
    choosing: window.__musicwars.world.choosing,
    text: document.getElementById('touch-banish').textContent,
  }));
  banish = {
    armed: /TAP A CARD/.test(armedText),
    spent: beforeB > 0 && afterB.left === beforeB - 1,
    stillOpen: afterB.choosing,
    detail: `armed "${armedText}", banishes ${beforeB} -> ${afterB.left}, choosing ${afterB.choosing}, now "${afterB.text}"`,
  };
}
check('banish-armed', banish.armed && banish.spent && banish.stillOpen, banish.detail ?? 'offer never opened');

// Re-read `choosing` right before the tap: a mutation that closed the offer
// earlier (a banish that chose instead) must not make this pass for free.
let skipped = { was: false, choosing: true };
if (opened.choosing) {
  const was = await p.evaluate(() => window.__musicwars.world.choosing);
  const sc = await centre('#touch-skip');
  await p.touchscreen.tap(sc.x, sc.y);
  await p.waitForTimeout(400);
  skipped = { was, ...(await p.evaluate(() => ({ choosing: window.__musicwars.world.choosing, pending: window.__musicwars.world.progression.pending }))) };
}
check('skip-tap', skipped.was && !skipped.choosing, `choosing ${skipped.was} -> ${skipped.choosing} across a real tap on SKIP`);
if (skipped.choosing) await fallback('closing the offer', 'KeyQ');

// The ship's badge. One more banked level, then a tap on the plate the
// renderer says it drew, inflated to a thumb by main.ts.
const badge = await p.evaluate(async () => {
  const mw = window.__musicwars;
  mw.world.progression.pending = 1;
  await new Promise((r) => setTimeout(r, 120));
  const r = mw.renderer.promptRect;
  if (!r) return null;
  const pf = document.getElementById('playfield').getBoundingClientRect();
  const k = pf.width / mw.world.viewW;
  return { x: pf.left + (r.x + r.w / 2) * k, y: pf.top + (r.y + r.h / 2) * k, cssH: r.h * k };
});
let badgeOpened = false;
if (badge) {
  await p.touchscreen.tap(badge.x, badge.y);
  await p.waitForTimeout(400);
  badgeOpened = await p.evaluate(() => window.__musicwars.world.choosing);
  if (badgeOpened) {
    const sc = await centre('#touch-skip');
    await p.touchscreen.tap(sc.x, sc.y);
    await p.waitForTimeout(400);
  }
}
check('badge-tap', badgeOpened, badge ? `plate ${badge.cssH.toFixed(1)} CSS px tall at ${Math.round(badge.x)},${Math.round(badge.y)}; choosing ${badgeOpened}` : 'no promptRect with pending 1');
// Whatever happened, leave no offer open and no level banked for the pause blocks.
if (await p.evaluate(() => window.__musicwars.world.choosing)) await fallback('closing the offer', 'KeyQ');
await p.evaluate(() => { window.__musicwars.world.progression.pending = 0; });
await p.waitForTimeout(120);

// Pause by the button, resume by the button.
const pb = await centre('#ui-pause');
await p.touchscreen.tap(pb.x, pb.y);
await p.waitForTimeout(250);
const pausedNow = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const t0 = mw.world.snapshot.time;
  await new Promise((r) => setTimeout(r, 300));
  return { paused: mw.paused(), screen: !document.getElementById('pause-screen').classList.contains('hidden'), frozen: mw.world.snapshot.time === t0 };
});
check('pause-button', pb.w >= 44 && pb.h >= 44 && pausedNow.paused && pausedNow.screen && pausedNow.frozen,
  `⏸ ${Math.round(pb.w)}x${Math.round(pb.h)}; paused ${pausedNow.paused}, screen ${pausedNow.screen}, clock frozen ${pausedNow.frozen}`);
if (!pausedNow.paused) await fallback('pausing', 'KeyP');
const pauseButtons = await buttons('#pause-screen');
const rc = await centre('#pause-resume');
await p.touchscreen.tap(rc.x, rc.y);
await p.waitForTimeout(250);
const resumed = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const t0 = mw.world.snapshot.time;
  await new Promise((r) => setTimeout(r, 300));
  return { paused: mw.paused(), screen: !document.getElementById('pause-screen').classList.contains('hidden'), moved: mw.world.snapshot.time > t0 };
});
check('resume-tap', !resumed.paused && !resumed.screen && resumed.moved,
  `RESUME ${Math.round(rc.w)}x${Math.round(rc.h)}; paused ${resumed.paused}, screen ${resumed.screen}, clock moved ${resumed.moved}`);
if (resumed.paused) await fallback('resuming', 'KeyP');

// The notification shade: hidden, then visible, then a RESUME tap.
const vis = await p.evaluate(async () => {
  const mw = window.__musicwars;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 100));
  const pausedByHide = mw.paused();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise((r) => setTimeout(r, 100));
  delete document.hidden;
  return { pausedByHide, stillPausedOnReturn: mw.paused(), screen: !document.getElementById('pause-screen').classList.contains('hidden') };
});
let visResumed = { paused: true };
if (vis.screen) {
  const rc2 = await centre('#pause-resume');
  await p.touchscreen.tap(rc2.x, rc2.y);
  await p.waitForTimeout(250);
  visResumed = await p.evaluate(() => ({ paused: window.__musicwars.paused(), screen: !document.getElementById('pause-screen').classList.contains('hidden') }));
}
check('visibility-resume', vis.pausedByHide && vis.stillPausedOnReturn && vis.screen && !visResumed.paused && !visResumed.screen,
  `hidden paused ${vis.pausedByHide}, still paused on return ${vis.stillPausedOnReturn}, then RESUME by tap -> paused ${visResumed.paused}`);
if (await p.evaluate(() => window.__musicwars.paused())) await fallback('resuming', 'KeyP');

/*
 * Nothing tappable under 44 px, in the row or on the pause screen.
 *
 * THE ROW IS EMPTY IN ORDINARY PLAY and that is the design: FOCUS / BOMB /
 * WELL were removed ("remove focus bomb and well"), so the row shows LEVEL UP
 * only while a level is banked and the three levers only while an offer is
 * open. A visible-buttons count would therefore read zero here and the old
 * `>= 3` floor would fail on a correct build — so the four are un-hidden for
 * the measurement and restored immediately. That measures the CSS sizing,
 * which is what this assertion is about; whether each is shown at the right
 * moment is what `levelup-visible`, `levers-size` and the row-holds probe
 * above already pin. The denominator is printed either way: four row buttons
 * and three pause buttons, or the check has stopped examining anything.
 */
const rowButtons = await p.evaluate(() => {
  const row = [...document.querySelectorAll('#touch-controls button')];
  const was = row.map((b) => b.classList.contains('hidden'));
  row.forEach((b) => b.classList.remove('hidden'));
  const out = row.map((b) => {
    const r = b.getBoundingClientRect();
    return { id: b.id, w: Math.round(r.width), h: Math.round(r.height) };
  });
  row.forEach((b, i) => { if (was[i]) b.classList.add('hidden'); });
  return out;
});
const small = [...rowButtons, ...pauseButtons].filter((b) => b.w < 44 || b.h < 44);
check('min-target', rowButtons.length === 4 && pauseButtons.length >= 3 && small.length === 0,
  `${rowButtons.length} row buttons (measured un-hidden), ${pauseButtons.length} pause buttons; under 44: ${small.length ? JSON.stringify(small) : 'none'}`);

// The gesture rules, as computed, on the elements the audit measured.
const css = await p.evaluate(() => {
  const cs = (sel) => getComputedStyle(document.querySelector(sel));
  return {
    html: cs('html').overscrollBehavior,
    body: cs('body').overscrollBehavior,
    screenOverscroll: cs('#pause-screen').overscrollBehavior,
    screenTouch: cs('#pause-screen').touchAction,
    appTouch: cs('#app').touchAction,
    appSelect: cs('#app').userSelect,
    appHighlight: cs('#app').webkitTapHighlightColor,
    rowTouch: cs('#touch-controls').touchAction,
    meta: document.querySelector('meta[name=viewport]').content,
  };
});
const cssOk = css.html === 'none' && css.body === 'none' && css.screenOverscroll === 'contain' && css.screenTouch === 'pan-y'
  && css.appTouch === 'pan-x pan-y' && css.appSelect === 'none' && css.rowTouch === 'none' && /maximum-scale=1/.test(css.meta);
check('gesture-css', cssOk, JSON.stringify(css));

// The volume slider still drags under a real touch, through CDP.
const vol = await (async () => {
  await p.evaluate(() => window.__musicwars.hud.setSettings(true));
  await p.waitForTimeout(100);
  const r = await centre('#ui-volume');
  const before = await p.evaluate(() => Number(document.getElementById('ui-volume').value));
  const cdp = await ctx.newCDPSession(p);
  const x0 = r.x - r.w * 0.3, x1 = r.x + r.w * 0.3;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: r.y, id: 7 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y: r.y, id: 7 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: x1, y: r.y, id: 7 }] });
  await p.waitForTimeout(100);
  const after = await p.evaluate(() => Number(document.getElementById('ui-volume').value));
  await cdp.detach();
  await p.evaluate(() => window.__musicwars.hud.setSettings(false));
  return { before, after };
})();
check('volume-drags', vol.after > vol.before, `slider ${vol.before} -> ${vol.after} under a real touch drag`);

await p.screenshot({ path: 'tools/shot-mobile.png' });
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('\nship before drag:', JSON.stringify(before));
console.log('ship after drag :', JSON.stringify({ x: Math.round(moved.pos.x), y: Math.round(moved.pos.y) }));
console.log('auto-firing     :', moved.firing > 0, ' controls visible:', moved.controlsVisible);
console.log('throttle held   : min', moved.thrMin, 'max', moved.thrMax, '(want 1, 1 — a held finger is the boost, wherever it landed)');
console.log('vy during hold  : min', Math.round(moved.minVy), 'vs cruise before', Math.round(before.vy), '(want at least 200 past it)');
console.log('after the lift  : throttle', moved.after, '(want 0 — cruise, not -1)');
console.log('touch row holds :', rowIds.present.join(', ') || '(nothing)', rowStray.length ? `STRAY: ${rowStray.join(', ')}` : '');
console.log('removed buttons :', rowIds.removed.length ? `STILL IN THE DOM: ${rowIds.removed.join(', ')}` : 'focus/bomb/well absent');
console.log('page errors     :', errs.length ? errs.slice(0, 2) : 'none');
const throttleOk = moved.thrMin === 1 && moved.thrMax === 1 && moved.minVy < before.vy - 200 && moved.after === 0;
const ok =
  Math.abs(moved.pos.x - before.x) > 60 &&
  moved.firing > 0 &&
  throttleOk &&
  moved.controlsVisible &&
  rowStray.length === 0 &&
  rowIds.removed.length === 0 &&
  !errs.length &&
  overlap.length === 0 &&
  bad.length === 0;
console.log(`mobile blockers : ${bad.length ? `${bad.length} red (${bad.join(', ')})` : 'all green'}`);
console.log(ok ? 'PLAYABLE ON TOUCH' : 'touch controls incomplete');
if (!ok) process.exit(1);
