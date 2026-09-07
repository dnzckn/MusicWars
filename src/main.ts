/**
 * MusicWars — entry point.
 *
 * Wiring, in one place:
 *
 *   World  --events-->  MusicDirector  --patterns-->  Strudel
 *     |                      |
 *     |                      +--> ref()/signal() caches, rebuilt on bar lines
 *     +--> GameSnapshot ---->|
 *     +--> immediate SFX ---> superdough (unquantised)
 *
 * The simulation never imports Strudel and the director never imports the
 * simulation's internals; they meet at `GameSnapshot` and `EventBus`.
 */

import type { MusicalState } from './core/events';
import { Input } from './core/input';
import { FIXED_DT, Loop } from './core/loop';
import { coarsePointer, enterPhoneSession, reholdWake, releaseWake } from './core/platform';
import { MusicDirector } from './audio/director';
import { getAudioContext } from '@strudel/webaudio';
import {
  audioStatus,
  audioSuspended,
  bootAudio,
  getRepl,
  miniCacheStats,
  pauseAudio,
  playPattern,
  resumeAudio,
  startAudio,
  syncTransport,
} from './audio/engine';
import {
  sfxBomb,
  sfxEnemyDeath,
  sfxEnemyFire,
  sfxEnemyHit,
  sfxExtend,
  sfxGraze,
  sfxPickup,
  sfxPlayerHit,
  sfxRunStart,
  sfxShard,
  sfxShoot,
  sfxWaveClear,
} from './audio/sfx';
import { isMuted, nudgeVolume, setVolume, toggleMute, volumeSetting } from './audio/volume';
import { themeForWave } from './audio/layers';
import { Hud } from './render/hud';
import { combinationPlan } from './render/levelup';
import { STARTERS, STARTING_INSTRUMENT } from './game/progression';
import {
  STAGE_COUNT,
  buy,
  defaultMeta,
  deepestOffered,
  loadMeta,
  nextPrice,
  recordRun,
  saveMeta,
  shopRows,
  stageReward,
  stageUnlocked,
  unlockedRoster,
  type MetaState,
} from './game/meta';
import { codex, discoveryLine, loadDiscovered, record, saveDiscovered, summary } from './game/discovery';
import { abilityLevels } from './game/progression';
import { instrumentDef, labelOf } from './game/weapons';
import { Renderer } from './render/renderer';
import { World } from './game/world';
import { PLAYFIELD_W, setView, stageBox, viewForStage } from './game/field';
import { TOTAL_WAVES } from './game/waves';

const playfield = document.getElementById('playfield') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const titleScreen = document.getElementById('title-screen')!;
const pauseScreen = document.getElementById('pause-screen')!;
const gameoverScreen = document.getElementById('gameover-screen')!;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const retryButton = document.getElementById('retry-button') as HTMLButtonElement;
const finalScore = document.getElementById('final-score')!;
const finalWave = document.getElementById('final-wave')!;
const finalBest = document.getElementById('final-best')!;
const pauseStats = {
  score: document.getElementById('pause-score')!,
  wave: document.getElementById('pause-wave')!,
  run: document.getElementById('pause-run')!,
  mult: document.getElementById('pause-mult')!,
  notes: document.getElementById('pause-notes')!,
  music: document.getElementById('pause-music')!,
  combos: document.getElementById('pause-combos')!,
  combosNone: document.getElementById('pause-combos-none')!,
};
const titleBest = document.getElementById('title-best')!;
const uiBest = document.getElementById('ui-best')!;

/* ------------------------------------------------------------------------ *
 * The between-runs layer
 *
 * The save, the set list and the shop. Everything about the ECONOMY lives in
 * `game/meta.ts` — this file only paints it and wires the buttons, which is the
 * same split `progression.ts` has with the level-up card: the rules are pure
 * and testable headless, and the DOM is a view of them.
 * ------------------------------------------------------------------------ */

const menuScreen = document.getElementById('menu-screen')!;
const shopScreen = document.getElementById('shop-screen')!;
const stageGrid = document.getElementById('stage-grid')!;
const shopGrid = document.getElementById('shop-grid')!;
const newgameConfirm = document.getElementById('newgame-confirm')!;

/**
 * The save, loaded once.
 *
 * `loadMeta` cannot throw and cannot fail a boot — see its own note, and the
 * two guards it needs to make that true on two different platforms. A player
 * with no save, a corrupt save or a browser that refuses storage all arrive
 * here with a usable default and no error path to handle.
 */
let meta: MetaState = loadMeta();

/**
 * WHICH STAGE THE NEXT RUN WILL BE, and where it comes from.
 *
 * Not persisted separately. `deepestOffered` is everything cleared plus one, so
 * on boot this is the frontier — the stage a returning player is most likely to
 * want and, for a fresh save, simply stage 1. Persisting a "last played" would
 * be a second source of truth for the same intent and would need its own
 * sanitising; deriving it costs nothing and cannot rot.
 */
let selectedStage = deepestOffered(meta);

/**
 * FULL ROSTER FOR MEASUREMENT, off a query parameter, exactly like `?seed=`.
 *
 * THIS EXISTS BECAUSE THE META LAYER SILENTLY RE-BASELINED 128 CHECKS. Every
 * browser tool in `tools/` does `page.click('#start-button')` against a fresh
 * Playwright context, which means empty storage, which means a default save,
 * which means the gated eight-and-eight roster. Those tools were all
 * calibrated against thirty instruments and twelve passives, and the change
 * that moved them is invisible in their output — the numbers simply describe a
 * different game.
 *
 * Being honest about that is worth more than hiding it. The DEFAULT is the
 * shipped game, because a check that measures a configuration no player has is
 * not measuring the product; and `?roster=full` is the opt-out for a check that
 * genuinely wants the whole table, so re-baselining is a decision somebody
 * makes per tool rather than a thing that happened to them.
 */
const rosterParam = new URLSearchParams(location.search).get('roster');
const forceFullRoster = rosterParam === 'full';

/**
 * Personal best.
 *
 * A run needs somewhere to land. Without a number to beat, a game over is just
 * the music stopping — this is the cheapest possible reason to press AGAIN.
 */
const BEST_KEY = 'musicwars.best';
let bestScore = 0;
try {
  bestScore = Number(localStorage.getItem(BEST_KEY) ?? '0') || 0;
} catch {
  bestScore = 0;
}

/*
 * "Pick upgrades for me, at random." A preference, so it persists across runs.
 *
 * Wrapped in try/catch for the same reason `bestScore` is: localStorage throws
 * outright in a headless context and in private-mode Safari, and a settings
 * checkbox is not worth failing a boot over.
 */
const AUTOPICK_KEY = 'musicwars.autopick';
let autoPick = false;
try {
  autoPick = localStorage.getItem(AUTOPICK_KEY) === '1';
} catch {
  autoPick = false;
}

function paintBest(): void {
  const text = bestScore.toLocaleString('en-US');
  uiBest.textContent = text;
  titleBest.textContent = bestScore > 0 ? `BEST ${text}` : '';
}
paintBest();

/**
 * The run's seed, and why it is reachable from outside.
 *
 * `World` has always accepted one — `constructor(seed = Date.now() & 0xffffffff)`
 * — but this call site never passed anything, so every run was unrepeatable and
 * the only way a tool could pin one was to reach in and overwrite `world.rng`'s
 * internal state before `startRun()`. That works, and the capture tool did
 * exactly that, but it is a trick that depends on a field name rather than a
 * contract, and it silently stops working the day the generator is swapped.
 *
 * The master plan's S1/S2/S5 listening passes are before/after WAV pairs at a
 * FIXED seed. Comparing two mixes recorded from two different runs is not a
 * comparison at all, so this needs to be real. `?seed=0x51ed` — the seed the
 * rest of the harness already uses — is now all it takes.
 *
 * Absent or unparseable, the behaviour is exactly what it was: clock-seeded.
 */
const seedParam = new URLSearchParams(location.search).get('seed');
const parsedSeed = seedParam === null ? NaN : Number(seedParam);
const world = new World(Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : undefined);
const director = new MusicDirector();
/**
 * The arrangement's position, carried from `render` back into `update`.
 *
 * A single mutated object rather than a fresh one per frame: this runs at up to
 * 144 Hz for the length of a run, and `World.setMusicalState` copies its fields
 * out rather than keeping the reference, so nothing downstream can be surprised
 * by it changing.
 */
const lastMusical: MusicalState = { section: 'sustain', energy: 0.45 };
const renderer = new Renderer(playfield, overlay, world);
const hud = new Hud();
const input = new Input();

// ---------------------------------------------------------------------------
// touch
// ---------------------------------------------------------------------------

const touchControls = document.getElementById('touch-controls')!;
const stage = document.getElementById('stage')!;
const app = document.getElementById('app')!;

// ---------------------------------------------------------------------------
// layout — the view is a function of the window
// ---------------------------------------------------------------------------

/**
 * Size the stage to the window and set `VIEW_W/VIEW_H` from it.
 *
 * THIS FUNCTION IS "GIVE THE SCREEN BACK". Everything else in the change is
 * consequence. `VIEW_W/VIEW_H` were hardcoded at 900x1120 beside a sidebar
 * that took 30% of the window; here the playfield takes all of it and the view
 * is derived from what it got.
 *
 * The order matters and is the reason this is one function rather than a
 * resize listener per interested party:
 *
 *   1. measure the box the stage may have — `#app`'s content area, LESS the
 *      touch button row when one is showing. The row is a sibling below the
 *      stage, so on a phone the playfield has to shrink to make room for it;
 *      `touchcheck` asserts the buttons never overlap the field and this
 *      subtraction is what keeps that true.
 *   2. clamp that box's ASPECT (`stageBox`) and write it as an explicit
 *      width/height. Explicit, not `flex: 1`, because a clamp expressed in CSS
 *      would need the other axis's used value and CSS cannot see it.
 *   3. derive the view from the stage box (`viewForStage`) so the two
 *      rectangles are the same shape by construction.
 *   4. tell the renderer, which owns the bloom bitmap and the starfield.
 *
 * Idempotent and cheap enough to call from a `resize` listener directly: two
 * `getBoundingClientRect` reads and at most four style writes, and step 4 is
 * skipped entirely when the view did not actually move.
 */
function layout(): void {
  const cs = getComputedStyle(app);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW = app.clientWidth - padX;
  let availH = app.clientHeight - padY;
  if (!touchControls.classList.contains('hidden')) {
    const gap = parseFloat(cs.rowGap) || 0;
    availH -= touchControls.getBoundingClientRect().height + gap;
  }
  const box = stageBox(availW, availH);
  stage.style.width = `${box.w}px`;
  stage.style.height = `${box.h}px`;
  const v = viewForStage(box.w, box.h);
  // Only when it MOVED. A stage box that changed without moving the view is
  // already covered — `Renderer` keeps a `ResizeObserver` on the canvas for
  // exactly that case, and reallocating the bloom bitmap and rescaling 140
  // stars on every pixel of a window drag would be work for nothing.
  if (setView(v.w, v.h)) renderer.viewChanged();
}

/*
 * THE ROW IS THERE FROM THE FIRST FRAME ON A PHONE.
 *
 * It used to appear on the first touch, which is also the first frame the
 * stage shrinks to make room for it: measured on the iPhone 14 profile, the
 * START tap moved the stage 14 px and cut it 20 px, so the first thing a
 * phone player saw the game do was jump. `(pointer: coarse)` is known at load
 * and is the same gate the stylesheet uses; the pointerdown reveal below
 * stays for a touchscreen laptop, whose primary pointer is fine.
 */
if (coarsePointer()) touchControls.classList.remove('hidden');

addEventListener('resize', layout);
addEventListener('orientationchange', layout);
layout();

/*
 * ONE POINTER, TWO COORDINATE SYSTEMS.
 *
 * These were a single `toPlayfield` because today `VIEW_W/H` and
 * `PLAYFIELD_W/H` are the same numbers, so a tap has the same coordinates in
 * both. They are separated now, before a camera makes them differ, because the
 * two callers want genuinely different things and the failure mode of getting
 * it wrong is invisible — see `routeOfferPointer` below.
 *
 *   toView  — where on the SCREEN the finger landed. The level-up cards, the
 *             reroll and skip controls and everything else on the overlay are
 *             laid out against `viewW`/`viewH` (`renderer.ts` passes exactly
 *             those into `levelUp.draw`), so a hit test must use the same pair.
 *   toWorld — which point in the SIMULATION the finger is pointing at. This is
 *             a steering target and is compared against the ship's own
 *             position in `input.ts`, which is world space.
 */

/** Where on the screen the pointer landed, in view coordinates. */
function toView(e: PointerEvent): { x: number; y: number } {
  const r = playfield.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * world.viewW,
    y: ((e.clientY - r.top) / r.height) * world.viewH,
  };
}

/*
 * TOMBSTONE — `toWorld(e)`, screen -> view -> plus the camera's top-left.
 *
 * Its only caller was the absolute finger steer, which took the pointer's
 * WORLD x and had the ship swim toward it. Relative drag needs no world
 * point: a drag is a difference, and a difference is the same number in view
 * space and world space because the two differ only by an offset. The one
 * place the camera still has to be added is the ship's station, and that is
 * done once per step where the world is already in hand (`input.shipStation`)
 * rather than per pointer event.
 *
 * The rule it carried is still live and still worth knowing if a world-space
 * hit test is ever needed again: use `camera.viewX`/`viewY`, never the
 * composed `camera.x`/`camera.y`, because the composed offset carries
 * screenshake and a target that jitters with every explosion makes the ship
 * twitch exactly when the player most needs it to go where they pointed.
 */

/**
 * A click or tap on the level-up offer.
 *
 * Routed through `renderer.levelUp.hitTest`, which returns a card index in
 * playfield canvas coordinates, rather than re-deriving the card rectangles
 * here. The failure mode of two copies of that layout is silent and nasty: the
 * cards draw in one place, the hit test believes they are in another, and the
 * player clicks PIZZICATO and receives SNARE ROLL with nothing on screen
 * looking wrong.
 *
 * Returns true when the pointer was consumed by the offer, so the same event
 * does not also steer the ship toward the card the player just tapped.
 */
function routeOfferPointer(e: PointerEvent): boolean {
  if (!world.choosing) return false;
  const pt = toView(e);
  const control = renderer.levelUp.hitTestControl(pt.x, pt.y);
  if (control === 'reroll') {
    input.pointerReroll = true;
    return true;
  }
  if (control === 'skip') {
    input.pointerSkip = true;
    return true;
  }
  const card = renderer.levelUp.hitTest(pt.x, pt.y);
  if (card < 0) return false;
  // Banishing needs a target as well as an intent, so it is the modifier on a
  // card rather than a lever of its own: hold shift (or the BANISH control,
  // which arms the same modifier) and click the card you want gone. On touch
  // the modifier is the armed BANISH button in the row below the field — the
  // two-step a thumb can do, since it cannot hold Shift.
  if (control === 'banish' || e.shiftKey || banishArmed) {
    input.pointerBanish = card;
    banishArmed = false;
    paintTouchRow();
  } else {
    input.pointerChoice = card;
  }
  return true;
}

/**
 * A tap on the ship's LEVEL UP badge.
 *
 * The badge is drawn by `renderer.drawShipPrompt` and is the loudest thing on
 * the field while levels are banked; on a keyboard it names the key, on a
 * phone it says TAP and this is what makes that true. The rect comes from the
 * renderer for the same reason the cards' does (`routeOfferPointer`): a hit
 * test that re-derives the layout drifts from it silently.
 *
 * INFLATED TO A THUMB. The plate is 17 view px tall, which is 9 CSS px on a
 * phone (`cssPerView` ≈ 0.54 on both profiles) — a target no finger hits. The
 * hit box is the plate plus 6 px, floored at 48x48 CSS px around its centre;
 * a press just outside it is the boost it always was, so the cost of the
 * floor is a boost that starts 24 px above the ship rather than on it.
 *
 * Touch only: a mouse has Space, and a click on the badge is a boost press on
 * the desktop scheme, where the cursor is often exactly over the ship.
 */
function routePromptPointer(e: PointerEvent): boolean {
  if (e.pointerType === 'mouse') return false;
  if (!inRun || paused || world.isOver || world.choosing) return false;
  const r = renderer.promptRect;
  if (!r || world.snapshot.pendingOffers <= 0) return false;
  const pf = playfield.getBoundingClientRect();
  const k = pf.width / world.viewW;
  const cx = pf.left + (r.x + r.w / 2) * k;
  const cy = pf.top + (r.y + r.h / 2) * k;
  const hw = Math.max(24, (r.w * k) / 2 + 6);
  const hh = Math.max(24, (r.h * k) / 2 + 6);
  if (Math.abs(e.clientX - cx) > hw || Math.abs(e.clientY - cy) > hh) return false;
  input.pointerOpenOffers = true;
  return true;
}

/*
 * THE POINTER SCHEME — one throttle rule for the finger and the mouse button.
 *
 * The owner, after playing on a phone, verbatim: "clicking on the screen
 * makes the ship slow down (if the click is behind the ship), should
 * literally be binary, click to go faster or youre decelerating so a little
 * like flappy bird in a sense, but letting go shouldnt slow down the ship but
 * go back to base line speed, so to slow dowh the ship you need to click and
 * drag backwards".
 *
 * The state lives in `Input` — `pressPointer` / `dragPointer` /
 * `releasePointer` for the throttle both devices share, `engageMouse` /
 * `setMouseX` for the cursor's steer, `setPointerTarget` for the finger's —
 * and is read in `sample()`; these handlers only translate events. Every
 * y handed to the throttle is a VIEW y from `toView`, for both devices, so
 * `BRAKE_DRAG_ENGAGE` means the same distance on the screen whichever hand is
 * on it. The finger's steer stays a WORLD x from `toWorld`, compared with the
 * ship's world x as it always was; the cursor's steer is a view x, see below.
 * The decisions made here rather than in `Input` are about the page, not the
 * axis:
 *
 * MOUSE ENGAGEMENT IS A CLICK ON THE FIELD, IN A RUN. Not a click on the
 * START button (the title screen is inside `#stage`, so that pointerdown
 * bubbles through here — `inRun` is still false at that instant), not a click
 * on a level-up card (`routeOfferPointer` consumes it first), not a click on
 * the pause screen or the game-over screen, and not a click on the HUD's gear
 * — `onField` requires the event to have landed on a canvas or the stage
 * itself. A mouse that is merely resting on the desk must not steer, and a
 * keyboard player who picks cards with the mouse must not find the cursor
 * steering their ship afterwards. Once engaged, the button is tracked
 * physically — any primary-button press over the stage, and the `buttons`
 * bit on every move, so a release that happened over another window is
 * caught the moment the cursor comes back, and a press that began over
 * another window and dragged in counts from where it entered.
 *
 * THE FINGER THAT PRESSED IS THE FINGER THAT RELEASES. A tap on FOCUS, BOMB
 * or WELL is a second pointer: its pointerdown is stopped in `bindTouchButton`
 * and never reaches here, but its pointerup bubbles through the stage — and
 * before this it cleared the steering target, so lifting a thumb off FOCUS
 * stopped the other thumb steering. Under a scheme where a held finger is the
 * BOOST that would have been a second thumb cancelling the first, so the
 * release is keyed on `pointerId`: only the contact that owns the throttle
 * lets it go. A second finger on the FIELD takes ownership (`pressPointer`
 * restarts the gesture from it), which is the least surprising reading of
 * "the newest touch is the one I mean".
 *
 * ONLY THE PRIMARY BUTTON BOOSTS, and the context menu is suppressed while
 * engaged so a right-click mid-fight does not open a menu over the field. A
 * right-click before engagement is inert and opens the menu as it always did.
 *
 * NO POINTER CAPTURE for the mouse. Capture suppresses `pointerleave`, and the
 * steer must go to 0 when the cursor leaves the stage; a release outside the
 * stage is caught by the `window` listener below instead. The touch path keeps
 * its capture because a dragging finger has no leave semantics worth keeping.
 *
 * `toView` FOR THE CURSOR'S X, NOT `toWorld`. The camera follows the ship
 * across the track, so a cursor fixed in world space at its last event drifts
 * away from the pointer as the camera pans — measured as the ship stopping
 * 19 px short of a still cursor. `Input` compares the view x against
 * `shipX - viewX`, which the update hook feeds it every step. A finger sends
 * a `pointermove` whenever it moves, so its world x has not been measured
 * going stale the same way, and it is left in world space.
 *
 * `preventDefault` only when the press landed on the field: the volume slider
 * and the HUD's buttons live inside `#stage`, and cancelling their pointerdown
 * would kill the slider's native drag.
 */
/** Did this pointer event land on the field itself, not on a control over it? */
function onField(e: Event): boolean {
  return e.target === stage || e.target === playfield || e.target === overlay;
}

/** A mouse press over the stage is a control input only while a run is live. */
function mouseLive(): boolean {
  return inRun && !paused && !world.isOver && !world.choosing;
}

/** The pointer id that currently owns the touch throttle and steer, or null. */
let touchContactId: number | null = null;

/**
 * The physical truth of a contact, applied to the shared throttle: down with
 * nothing pressed is a press from here, down while pressed is a drag, up is a
 * release. Idempotent, so it can be fed from every move event.
 */
function pointerContact(down: boolean, viewX: number, viewY: number, touch = false): void {
  if (!down) input.releasePointer();
  else if (input.pointerPressed) input.dragPointer(viewX, viewY);
  else input.pressPointer(viewX, viewY, touch);
}

function mousePointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const v = toView(e);
  if (!input.mouseActive) {
    if (!mouseLive() || !onField(e)) return;
    input.engageMouse();
  }
  input.pressPointer(v.x, v.y);
  if (onField(e)) e.preventDefault();
}

stage.addEventListener('pointerdown', (e) => {
  // Mouse included, deliberately: the offer is the one screen a desktop player
  // is expected to click, and the steering path below ignores mice entirely.
  if (routeOfferPointer(e)) {
    e.preventDefault();
    return;
  }
  if (e.pointerType === 'mouse') {
    mousePointerDown(e);
    return;
  }
  // The ship's badge, before the press becomes a boost: a thumb on TAP ×2
  // means "open the offer", not "go faster".
  if (routePromptPointer(e)) {
    e.preventDefault();
    return;
  }
  if (touchControls.classList.contains('hidden')) {
    touchControls.classList.remove('hidden');
    // The row is a sibling below the stage, so revealing it takes height away
    // from the playfield. Without this the stage keeps its old box and the
    // buttons are pushed off the bottom of the window on the very first touch.
    layout();
  }
  // The press opens a drag and moves nothing: the ship answers the finger's
  // MOVEMENT from here, not its position. See `Input.pressPointer`.
  touchContactId = e.pointerId;
  {
    const v = toView(e);
    input.pressPointer(v.x, v.y, true);
  }
  try {
    stage.setPointerCapture(e.pointerId);
  } catch {
    // A pointer id that is no longer active throws. Capture is an optimisation
    // for drags that leave the element; losing it is not worth a dead frame.
  }
  e.preventDefault();
});
stage.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    if (!input.mouseActive) return;
    const v = toView(e);
    // The physical truth of the button, which `pointerup` alone cannot give:
    // a release over another window never reaches this page's listeners.
    pointerContact((e.buttons & 1) !== 0, v.x, v.y);
    return;
  }
  // Do not steer while an offer is open. The world is paused, so a drag across
  // the cards would bank up a heading the ship then takes the instant play
  // resumes — the player would arrive back in the fight somewhere they did not
  // choose to be. (This mattered more when the world merely slowed to 12% and
  // the ship actually crept across the arena while they read; it still matters,
  // because the input is live even while the simulation is not.)
  if (world.choosing) {
    // RE-BASE rather than ignore. The contact is still down and the finger is
    // wandering across the cards; if the drag were merely dropped, the whole
    // wander would be applied as one jump the moment the offer closed and the
    // ship would teleport. Re-basing every move keeps the origin under the
    // finger and the target under the ship, so the gesture resumes from
    // wherever the thumb happens to have ended up.
    const v = toView(e);
    input.rebaseDrag(v.x, v.y);
    return;
  }
  // Only the finger that pressed the FIELD steers or throttles. Touch
  // implicitly captures to the element a finger lands on, so a thumb wiggling
  // on FOCUS bubbles its moves through here too — and used to steer the ship
  // toward the FOCUS button. A finger this page never saw press the field
  // (its down went to a button, or to a card) is inert until it lifts.
  if (e.pointerId !== touchContactId) return;
  // `buttons` is NOT consulted here, unlike the mouse path: a touch pointermove
  // only exists while the contact does, so the move IS the physical truth —
  // and `tools/touchcheck.mjs` synthesises its moves without `buttons`, which
  // a mouse-style check would have read as sixty releases. Through
  // `pointerContact` rather than `dragPointer` so a press that `blur` let go
  // of while the finger stayed down is taken up again from where it is.
  {
    const v = toView(e);
    pointerContact(true, v.x, v.y, true);
  }
  e.preventDefault();
});
const releasePointer = (e: PointerEvent) => {
  if (e.pointerType === 'mouse') return;
  // Only the contact that owns the throttle releases it — see the note above
  // on FOCUS/BOMB/WELL. A null owner means a press this page never saw; let
  // any lift clear it, as it always did.
  if (touchContactId !== null && e.pointerId !== touchContactId) return;
  touchContactId = null;
  input.releasePointer();
};
stage.addEventListener('pointerup', releasePointer);
stage.addEventListener('pointercancel', releasePointer);
// On `window`, not the stage: a button let go over the HUD, the page margin or
// the browser chrome is still let go. Cheap enough to run unconditionally.
const releaseMouse = (e: PointerEvent) => {
  if (e.pointerType === 'mouse' && e.button === 0) input.releasePointer();
};
window.addEventListener('pointerup', releaseMouse);
window.addEventListener('pointercancel', releaseMouse);
stage.addEventListener('contextmenu', (e) => {
  if (input.mouseActive) e.preventDefault();
});

const bindTouchButton = (id: string, press: () => void, hold?: (down: boolean) => void) => {
  const el = document.getElementById(id)!;
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    press();
    hold?.(true);
  });
  const up = (ev: Event) => {
    ev.preventDefault();
    hold?.(false);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
};
/*
 * FOCUS, BOMB AND WELL ARE NOT IN THE TOUCH ROW. Asked for by name: "remove
 * focus bomb and well".
 *
 * They were three of the four buttons under the field, and on a phone the row
 * is the only furniture the game puts over the playfield — so what it holds
 * is the whole of the second thumb's vocabulary. The owner wants that
 * vocabulary to be the run's decisions (LEVEL UP, and the offer's levers)
 * rather than three panic keys.
 *
 * WHAT A PHONE LOSES, stated rather than buried: FOCUS and the BLACK HOLE are
 * keyboard-only now. The BOMB is not lost — `World.autoBombRescue` spends one
 * for you on the hit that would have killed you ("the panic bomb the player
 * did not have to press"), which is how a phone player's bombs are spent
 * anyway. Restoring any of them is this block plus a button in `index.html`
 * and the field in `Input`; the tombstone there says which.
 *
 * The guard the removed handlers carried is still on LEVEL UP below: a press
 * while paused would bank an edge that fired on the first step after RESUME.
 */
/*
 * THE LEVEL-UP BUTTON, AND THE OFFER'S LEVERS, IN THE SAME ROW.
 *
 * The platform audit's critical finding, in one sentence: on touch there was
 * no way to open the offer — Space was the only path (`OPEN_OFFER_KEYS`) and
 * the HUD told a phone player to press it. LEVEL UP sets the same edge Space
 * sets; the world's `offerEdge` latch cannot tell them apart.
 *
 * REROLL and SKIP set the flags the canvas levers set (`routeOfferPointer`),
 * so the world sees one path. BANISH is the exception: the canvas lever only
 * ever ARMED a modifier for the click that followed, and on touch that click
 * is a second tap on a card — so the button toggles `banishArmed`, reads
 * "BANISH — TAP A CARD" while it is, and `routeOfferPointer` spends it on the
 * next card. A second tap on BANISH disarms.
 *
 * Guarded on `!paused`: the row sits outside `#stage`, under the pause
 * screen's reach, and `pointerOpenOffers` is consumed by `sample()`, which
 * does not run while paused — an unguarded tap here would bank an edge that
 * fired on the first step after RESUME.
 */
bindTouchButton('touch-levelup', () => {
  if (!paused) input.pointerOpenOffers = true;
});
bindTouchButton('touch-reroll', () => (input.pointerReroll = true));
bindTouchButton('touch-skip', () => (input.pointerSkip = true));

/*
 * THE WARP LEVER, the game's one draggable control.
 *
 * The owner: "pulling it up turns on warp then pulling it down turns it off".
 *
 * RELATIVE, LIKE EVERY OTHER GESTURE NOW. The travel moves by the drag's
 * DISTANCE, not to the point the thumb landed on. Absolute would mean a tap on
 * the top of the track engages warp, and a mode you can enter by brushing the
 * right edge of the screen is the accident `WARP_ARM`'s 1.4 s hold was bought
 * to prevent — the deliberateness has to live somewhere, and here it lives in
 * having to pull the thing a track's length.
 *
 * IT STARTS FROM WHERE THE MODE IS, not from zero: grabbing it while warping
 * picks it up at the top, so dropping out is a full downward stroke. That is
 * "dragging backwards for a while turns it off", and it means the control can
 * never disagree with the mode it reports.
 *
 * THE STAGE MUST NOT SEE ANY OF THIS. `main.ts`'s stage pointerdown has no
 * onField guard: without `stopPropagation` a thumb on the lever would ALSO
 * open a drag on the play field and fly the ship while it warped. The capture
 * is what keeps the gesture alive when the thumb wanders off a 46 px box
 * mid-stroke, which on a phone it does.
 */
/*
 * The lever follows the HUD's own visibility rather than re-deriving it.
 * `Hud.update` already owns the question "is the player in a fight right now"
 * — title gone, clock started, no offer, not paused, not dead — and answering
 * it twice is how two answers start disagreeing. A class read is cheap.
 */
const hudElForLever = document.getElementById('hud')!;
const hudHidden = (): boolean => hudElForLever.classList.contains('hidden');

const warpEl = document.getElementById('warp-lever')!;
const warpTrack = warpEl.querySelector('.warp-track') as HTMLElement;
/** The contact dragging the lever, or null. Its own, never the field's. */
let warpPointerId: number | null = null;
let warpFromY = 0;
let warpFromTravel = 0;

const warpTravelNow = (): number => (world.warping ? 1 : world.warpCharge);

warpEl.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  warpPointerId = ev.pointerId;
  warpFromY = ev.clientY;
  warpFromTravel = warpTravelNow();
  input.warpLever = warpFromTravel;
  try {
    warpEl.setPointerCapture(ev.pointerId);
  } catch {
    // A pointer id that is no longer active throws; the move handler still
    // works while the thumb is over the box, which is the common case.
  }
});
warpEl.addEventListener('pointermove', (ev) => {
  if (warpPointerId !== ev.pointerId) return;
  ev.preventDefault();
  ev.stopPropagation();
  /*
   * The track's own height is the full stroke, so the knob stays under the
   * thumb: pull the lever to the top of the bar and it IS at the top. Read
   * from the live box rather than from a constant because the sheet may size
   * it differently on another profile, and a hard-coded 116 would silently
   * change the gearing there.
   */
  const span = warpTrack.getBoundingClientRect().height || 116;
  const t = warpFromTravel + (warpFromY - ev.clientY) / span;
  input.warpLever = Math.max(0, Math.min(1, t));
});
const warpRelease = (ev: PointerEvent) => {
  if (warpPointerId !== ev.pointerId) return;
  ev.stopPropagation();
  warpPointerId = null;
  /*
   * NULL, NOT THE TRAVEL. Letting go of a lever does not move it — see
   * `Input.warpLever`. The world stops hearing an instruction and the latch
   * simply stays where the stroke left it.
   */
  input.warpLever = null;
};
warpEl.addEventListener('pointerup', warpRelease);
warpEl.addEventListener('pointercancel', warpRelease);

/**
 * Paint the lever from the world, once a frame.
 *
 * The bar is a function of `warpCharge` whoever filled it, so the keyboard's
 * 1.4 s hold at the forward stop drives the same picture the thumb drags. One
 * control, one readout, two ways in.
 */
const paintWarpLever = (): void => {
  const show = !hudHidden();
  warpEl.classList.toggle('hidden', !show);
  if (!show) return;
  const t = warpTravelNow();
  warpEl.style.setProperty('--warp', t.toFixed(3));
  warpEl.classList.toggle('on', world.warping);
  warpEl.setAttribute('aria-valuenow', t.toFixed(2));
};
bindTouchButton('touch-banish', () => {
  banishArmed = !banishArmed;
  paintTouchRow();
});

/** The BANISH button has been tapped and is waiting for a card. Touch only. */
let banishArmed = false;

const touchRow = {
  levelup: document.getElementById('touch-levelup') as HTMLButtonElement,
  reroll: document.getElementById('touch-reroll') as HTMLButtonElement,
  banish: document.getElementById('touch-banish') as HTMLButtonElement,
  skip: document.getElementById('touch-skip') as HTMLButtonElement,
};
/** The last state painted, so the row is not touched sixty times a second for nothing. */
let touchRowKey = '';

/**
 * Which face of the touch row is showing, decided once per frame from the
 * world: the play buttons plus LEVEL UP while levels are banked, or the three
 * offer levers while an offer is open on a coarse pointer. Fine pointers keep
 * the canvas levers (`levelup.ts` still draws them there), so the DOM levers
 * are gated on `coarsePointer()` and not on the row being visible — a
 * touchscreen laptop shows the row and keeps its keys. Runs from the render
 * hook; a string key means the DOM is written only when something moved.
 */
function paintTouchRow(): void {
  const live = inRun && !world.isOver;
  const choosing = live && world.choosing;
  const levers = choosing && coarsePointer();
  const pending = live && !paused && !choosing ? world.snapshot.pendingOffers : 0;
  const offer = world.progression.offer;
  const rerolls = choosing ? (offer?.rerollsLeft ?? 0) : 0;
  const banishes = choosing ? (offer?.banishesLeft ?? 0) : 0;
  if (!choosing) banishArmed = false;
  const key = `${live}|${paused}|${levers}|${pending}|${rerolls}|${banishes}|${banishArmed}`;
  if (key === touchRowKey) return;
  touchRowKey = key;
  const r = touchRow;
  // Dimmed between runs and while paused: the row is reserved on the title
  // and the set list, and under the pause screen, and its buttons do nothing
  // in any of those. See `.touch.idle` in style.css.
  touchControls.classList.toggle('idle', !live || paused);
  r.levelup.classList.toggle('hidden', levers || pending <= 0);
  r.levelup.textContent = pending > 1 ? `LEVEL UP ×${pending}` : 'LEVEL UP';
  for (const b of [r.reroll, r.banish, r.skip]) b.classList.toggle('hidden', !levers);
  r.reroll.textContent = `REROLL ×${rerolls}`;
  // A spent lever is dimmed rather than removed — the canvas row's rule, for
  // the same reason: a control that vanishes teaches nothing about why.
  r.reroll.disabled = rerolls <= 0;
  r.banish.textContent = banishArmed ? 'BANISH — TAP A CARD' : `BANISH ×${banishes}`;
  r.banish.disabled = banishes <= 0 && !banishArmed;
  r.banish.classList.toggle('armed', banishArmed);
}

// ---------------------------------------------------------------------------
// volume
// ---------------------------------------------------------------------------

const autoPickBox = document.getElementById('ui-autopick') as HTMLInputElement | null;
/**
 * Who spends the levels, written in one place.
 *
 * Three things set it now — the settings checkbox and the title screen's two
 * doors — and they must agree, because the title says "you can change this any
 * time in the settings menu" and a checkbox that disagreed with the button the
 * player just pressed would make that a lie. So the buttons call this rather
 * than touching `autoPick`, and it drives the checkbox back.
 */
function setAutoPick(on: boolean): void {
  autoPick = on;
  if (autoPickBox) autoPickBox.checked = on;
  try {
    localStorage.setItem(AUTOPICK_KEY, on ? '1' : '0');
  } catch {
    /* Preference is still live for this run; only persistence is lost. */
  }
}
if (autoPickBox) {
  autoPickBox.checked = autoPick;
  autoPickBox.addEventListener('change', () => setAutoPick(autoPickBox.checked));
}

const volumeSlider = document.getElementById('ui-volume') as HTMLInputElement;
const muteButton = document.getElementById('ui-mute') as HTMLButtonElement;
const volumeNumber = document.getElementById('ui-volnum')!;

function paintVolume(): void {
  const v = volumeSetting();
  const pct = Math.round(v * 100);
  volumeSlider.value = String(pct);
  volumeSlider.style.setProperty('--fill', `${pct}%`);
  volumeNumber.textContent = isMuted() ? 'off' : String(pct);
  muteButton.classList.toggle('muted', isMuted());
  muteButton.textContent = isMuted() ? '\u266D' : '\u266B';
}

volumeSlider.addEventListener('input', () => {
  setVolume(Number(volumeSlider.value) / 100);
  paintVolume();
});
muteButton.addEventListener('click', () => {
  toggleMute();
  paintVolume();
});
paintVolume();

let paused = false;
/** True from the moment a run starts until the next one; stays true through the
 *  game-over screen so the music can finish collapsing. */
let inRun = false;
/** Set on the frame the audio clock should be re-read. */
let needsSync = true;

// ---------------------------------------------------------------------------
// game -> music routing
// ---------------------------------------------------------------------------

const t = world.transport;

world.bus.on('wave:start', (e) => director.onWaveStart(t, e));
world.bus.on('wave:clear', (e) => {
  director.onWaveClear(t, e);
  sfxWaveClear(director.currentChordNotes(), e.grade);
});
world.bus.on('boss:telegraph', (e) => director.onBossTelegraph(t, e));
world.bus.on('boss:phase', (e) => {
  director.onBossPhase(t, e);
  sfxBomb();
});
world.bus.on('boss:defeat', () => director.onBossDefeat(t));

world.bus.on('player:hit', () => {
  director.onPlayerHit();
  sfxPlayerHit();
});
world.bus.on('player:death', () => {
  director.onPlayerDeath(t);
  sfxPlayerHit();
});
world.bus.on('player:bomb', () => {
  director.onBomb(t);
  sfxBomb();
});
world.bus.on('player:extend', () => sfxExtend());

world.bus.on('powerup:pickup', (e) => {
  director.onPickup(t, e.kind);
  sfxPickup(e.level * 2);
});
world.bus.on('powerup:expire', (e) => director.onPickup(t, e.kind));

/*
 * The shard tick. See sfx.ts for why this is one short voice and not the
 * four-note pickup arpeggio: it fires roughly fifty times a minute, and a
 * melody nobody wrote would fight the eleven stems somebody did.
 *
 * The tier is mapped to an index here rather than in sfx.ts, because the
 * audio layer must not import from game/ -- the same one-directional rule
 * that makes events.ts restate the ability ids instead of re-exporting them.
 */
const SHARD_STEP: Record<string, number> = { minor: 0, major: 1, rare: 2 };
world.bus.on('shard:collect', (e) => sfxShard(SHARD_STEP[e.tier] ?? 0, e.combo));

/*
 * Progression, answered with sound.
 *
 * Deliberately only SFX here. The arrangement's response to a level-up — the
 * fermata over a held dominant that resolves on the choice — belongs to the
 * director, and calling into it for events it has not declared handlers for
 * would be this file inventing the audio side's interface for it.
 */
world.bus.on('level:offer', () => sfxPickup(7));
world.bus.on('level:choice', (e) => sfxPickup(Math.min(9, e.level)));
/*
 * A fusion gets BOTH a sound and a change to the score, and all three kinds
 * get them.
 *
 * The stinger was already here for `evolve` and `union`; `duet` had no handler
 * at all, so the generative tier landed in silence. And a one-shot is not the
 * same as the music responding — the director had no fusion hook whatsoever,
 * so the band could change shape and the arrangement would not react. See
 * `MusicDirector.onFusion`.
 */
world.bus.on('ability:evolve', (e) => {
  sfxWaveClear(director.currentChordNotes(), 'perfect');
  director.onFusion('evolution');
  if (record(discovered, e.to)) { saveDiscovered(discovered); paintDiscovered(); }
});
world.bus.on('ability:union', (e) => {
  sfxWaveClear(director.currentChordNotes(), 'perfect');
  director.onFusion('union');
  // Generic unions carry a synthesised id and `record` ignores them; only the
  // two authored ones are collectable.
  if (record(discovered, e.to)) { saveDiscovered(discovered); paintDiscovered(); }
});
world.bus.on('ability:duet', () => {
  sfxWaveClear(director.currentChordNotes(), 'clean');
  director.onFusion('duet');
});

// A charge committing is the note a volley used to be; see `enemy:lunge`.
world.bus.on('enemy:lunge', (e) => {
  sfxEnemyFire(e.archetype, director.currentChordNotes()[0] ?? 57, e.pan);
});

// Hits are frequent; throttle so they stay a confirmation rather than a buzz.
let lastHitNote = 0;
world.bus.on('enemy:hit', (e) => {
  if (e.lethal) return; // the death sound covers it
  const now = performance.now();
  if (now - lastHitNote < 70) return;
  lastHitNote = now;
  sfxEnemyHit(director.currentChordNotes());
});

world.bus.on('enemy:death', (e) => {
  if (!e.byPlayer) return;
  // Pass the archetype and the current root: the enemy dies in its own voice,
  // in key. `enemy:death` has always carried the archetype; it was being
  // collapsed into a size number and discarded.
  sfxEnemyDeath(
    e.archetype === 'conductor' ? 1 : e.archetype === 'subdrop' ? 0.8 : 0.35,
    e.archetype,
    director.currentChordNotes()[0],
  );
});

// Grazing is continuous and can fire many times a second; throttle it so it
// stays a texture rather than a wall of clicks.
let lastGraze = 0;
world.bus.on('player:graze', (e) => {
  const now = performance.now();
  if (now - lastGraze < 55) return;
  lastGraze = now;
  sfxGraze(e.total % 13);
});

/*
 * When the run ended, so the restart key can be ignored for a beat. The AGAIN
 * button is unaffected — a deliberate click is never an accident.
 */
const RUN_OVER_GRACE = 700;
let runOverAt = -Infinity;

world.bus.on('run:over', (e) => {
  runOverAt = performance.now();
  // The screen may sleep again; the summary is read at leisure.
  releaseWake();
  finalScore.textContent = e.score.toLocaleString('en-US');
  finalWave.textContent = String(e.wave);

  /*
   * WHICH ENDING THIS IS, and it is read off the event rather than off
   * `world.victory`.
   *
   * Both are true at this instant, so the choice looks arbitrary; it is not.
   * `run:over` is the thing that says a run ended, and a handler that reads the
   * world for the reason is a handler that can be wrong about which run it is
   * describing — this one already keeps `runOverAt`, writes localStorage and
   * repaints a best-score line, and every one of those is about the run that
   * just ended and not about whatever the world holds now.
   *
   * The `.won` class does the colour (see style.css) and these two lines do the
   * words, which is the half a colourblind player reads.
   */
  const won = e.outcome === 'won';
  gameoverScreen.classList.toggle('won', won);
  document.getElementById('final-title')!.textContent = won ? 'SET COMPLETE' : 'RUN OVER';
  /*
   * On a LOSS, how much of the run's shape was covered: `· 1 of 4 bosses
   * down` after the wave number. Its own node beside a bare `#final-wave`
   * (`tools/_finaleshots.mjs` reads that one as a number), and empty on a
   * win, where the outcome line above the score already says ALL 4 BOSSES
   * DOWN — the three channels of 969aa46 (words, an extra line, colour) stay
   * as they were.
   */
  document.getElementById('final-bosses')!.textContent = won
    ? ''
    : ` · ${world.snapshot.bossesBeaten} of ${world.snapshot.acts} bosses down`;
  const outcome = document.getElementById('final-outcome')!;
  outcome.replaceChildren();
  if (won) {
    /*
     * The claim, stated in the game's own units: every boss down, and how long
     * it took. Time is the number a second run is measured against and it is
     * the one thing the old summary never showed, because a run that could not
     * end had no length worth printing.
     */
    const mins = Math.floor(world.snapshot.time / 60);
    const secs = Math.floor(world.snapshot.time % 60);
    const b = document.createElement('b');
    b.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    outcome.append(
      document.createTextNode(`ALL ${world.snapshot.acts} BOSSES DOWN  ·  `),
      b,
    );
  }

  // What the run was, and what it sounded like. The premise of the game is
  // that the fight writes the music, so the end is where that gets read back.
  const t = world.totals;
  const heard = director.heard;
  document.getElementById('final-notes')!.textContent = t.notes.toLocaleString('en-US');
  document.getElementById('final-mult')!.textContent = `x${t.bestMultiplier}`;
  document.getElementById('final-flawless')!.textContent = String(t.flawless);
  document.getElementById('final-grazes')!.textContent = t.grazes.toLocaleString('en-US');

  const keys = [...heard.keys];
  const grooves = [...heard.grooves];
  const el = document.getElementById('final-heard')!;
  el.replaceChildren();
  const add = (label: string, value: string) => {
    const b = document.createElement('b');
    b.textContent = value;
    el.append(document.createTextNode(label), b, document.createTextNode('  '));
  };
  add('you played in ', keys.length === 1 ? keys[0] : `${keys.length} keys`);
  add('through ', grooves.length === 1 ? grooves[0] : `${grooves.length} grooves`);
  // Peak energy and the deepest section: tracked last iteration and then not
  // shown, which is the same "looks implemented, isn't" shape this project has
  // hit repeatedly. Either display it or delete it.
  const deepest = (['drop', 'build', 'sustain', 'breakdown', 'intro'] as const).find((x) =>
    heard.sections.has(x),
  );
  if (deepest) add('peaking at ', `${deepest} · ${Math.round(heard.peakEnergy * 100)}% energy`);
  if (keys.length > 1) {
    el.append(document.createElement('br'));
    const b = document.createElement('b');
    b.textContent = keys.slice(-4).join(' → ');
    el.append(b);
  }
  /*
   * THE BAND, and the one you nearly had.
   *
   * The end screen listed the music and said nothing about the build, which is
   * the half the player actually chose. In a game where committing to a fusion
   * is worth 2.3x the designed combinations and +11% on wave reached, the
   * moment they are deciding whether to go again is the wrong moment to hide
   * what they made.
   *
   * The second line is the hook: the nearest thing they did NOT finish, with
   * what it wanted. `combinationPlan` already sorts designed recipes above
   * generic duets and aims by distance, so its first unfinished row is exactly
   * "the one that got away".
   */
  const bandEl = document.getElementById('final-band')!;
  bandEl.replaceChildren();
  const prog = world.progression;
  const held = Object.entries(prog.instruments as Record<string, number>)
    .filter(([, lv]) => lv > 0)
    .sort((a, b) => b[1] - a[1]);
  if (held.length) {
    bandEl.append(document.createTextNode('your band  '));
    held.forEach(([id, lv], i) => {
      if (i) bandEl.append(document.createTextNode(' · '));
      const fused = prog.fusions.includes(id);
      const node = fused ? document.createElement('b') : document.createElement('span');
      // A fusion is named alone; an ordinary instrument carries how far it got.
      node.textContent = fused ? labelOf(id) : `${labelOf(id)} ${lv}`;
      bandEl.append(node);
    });
    // `abilityLevels` merges instruments and rig, which is the flat record the
    // plan expects — the same read the HUD uses.
    const nearest = combinationPlan(abilityLevels(prog), discovered).find((r) => !r.ready);
    if (nearest) {
      const near = document.createElement('span');
      near.className = 'near';
      near.append(document.createTextNode('one step from '));
      const b = document.createElement('b');
      b.textContent = nearest.label;
      near.append(b, document.createTextNode(` — needed ${nearest.needs}`));
      bandEl.append(near);
    }
  }

  /*
   * WHAT THE RUN PAID, banked and shown.
   *
   * `recordRun` does the arithmetic, the stage unlock and the best-time record;
   * this only paints it. The stage comes off `world.stage` rather than off the
   * event because `run:over` carries the WAVE the run ended on and nothing
   * about which stage it was — and `world.stage` cannot have moved since
   * `start()` clamped it, since nothing else writes it during a run.
   *
   * `saveMeta` is called here and NOT at any point during play. A run in
   * progress has earned nothing yet, and writing the save on every level-up
   * would be a storage write per twenty seconds for no gain. Its return value
   * is deliberately ignored: a browser that refuses storage still played the
   * run and still shows the points, it just will not remember them, and there
   * is nothing useful to say about that at this moment.
   */
  const payout = recordRun(meta, {
    stage: world.stage,
    wavesCleared: world.totals.wavesCleared,
    seconds: world.snapshot.time,
    won,
  });
  saveMeta(meta);
  selectedStage = Math.min(Math.max(selectedStage, world.stage), deepestOffered(meta));
  const pts = document.getElementById('final-points')!;
  pts.replaceChildren();
  const total = document.createElement('b');
  total.textContent = `+${num(payout.points)}`;
  const terms = document.createElement('span');
  /*
   * THE BREAKDOWN, in the order the terms are worth arguing about: how deep the
   * stage was, how far the run got, whether it finished, and how fast. A player
   * who cannot see that depth and speed paid separately has no reason to
   * attempt a deeper stage or to finish a faster one — the breakdown is the
   * only place the economy explains itself.
   */
  terms.textContent =
    `stage ${world.stage} x${payout.multiplier.toFixed(2)}` +
    ` · ${Math.round(payout.depth * 100)}% of the set` +
    (won ? ` · cleared · ${Math.round(payout.speedFraction * 100)}% speed` : ' · did not finish') +
    ` · ${num(meta.points)} banked`;
  pts.append(total, document.createTextNode(' POINTS'), terms);
  paintTitleStage();

  const beaten = e.score > bestScore;
  if (beaten) {
    bestScore = e.score;
    try {
      localStorage.setItem(BEST_KEY, String(bestScore));
    } catch {
      // Nothing to do; the run still counted.
    }
    paintBest();
  }
  finalBest.textContent = beaten ? 'NEW BEST' : `best ${bestScore.toLocaleString('en-US')}`;
  finalBest.style.color = beaten ? 'var(--gold)' : 'var(--dim)';
  gameoverScreen.classList.remove('hidden');
});

// ---------------------------------------------------------------------------
// shooting SFX, throttled at source
// ---------------------------------------------------------------------------

/*
 * The shot sound is keyed to the world now, not to the input.
 *
 * There is no fire button any more, so `input.state.shoot` is false for the
 * whole run on a keyboard and the ship would be silent while firing six
 * instruments. `player:shoot` is emitted by the world on any step where at
 * least one instrument discharged, which is the honest trigger — and it fires
 * far more often than a held button did, because six instruments on six
 * cadences interleave, so the throttle matters more than it used to rather
 * than less.
 */
let lastShot = 0;
let lastShotId: string | undefined;

world.bus.on('player:shoot', (e) => {
  const now = performance.now();
  /*
   * ~11 per second maximum PER VOICE, and never throttled when the voice
   * changes.
   *
   * A flat window was right when every instrument made one identical blip:
   * above about eleven a second a confirmation stops being a confirmation and
   * becomes a texture, which is the arp's job and not this one's. Now that each
   * instrument has its own oscillator and decay, a shared window has a second
   * effect nobody asked for — it drops whichever shot lands inside it, and the
   * shots that land inside it are overwhelmingly the RARE ones. PIZZICATO fires
   * four to ten times a second and TIMPANI about every three, so a shared
   * window silences the timpani roughly in proportion to how busy the pizzicato
   * is. That is exactly backwards, and it would have quietly undone most of the
   * work of giving the instruments distinct voices.
   *
   * The world already resolves a same-tick collision in favour of the rarest
   * instrument; this is the other half of that, making sure the choice survives
   * the trip to the speakers. A repeated voice is still capped, so the texture
   * argument is untouched.
   */
  const changed = e.id !== undefined && e.id !== lastShotId;
  if (!changed && now - lastShot < 88) return;
  lastShot = now;
  lastShotId = e.id;
  // Pass which instrument fired, so a bell sounds like a bell. Without this
  // every ability in the game makes one identical blip, which is the premise
  // broken at the point the player hears most often.
  sfxShoot(director.currentChordNotes(), world.player.focused, e.id, e.voice);
});

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

const loop = new Loop({
  update(dt) {
    /*
     * Freeze while the audio is suspended.
     *
     * A phone can suspend the AudioContext without hiding the tab — a call, the
     * ringer switch — and the game would happily keep simulating in silence.
     * That is bad twice over: this is a music game, so playing it silently is
     * pointless; and the transport keeps advancing off wall-clock while
     * Strudel's clock is frozen, so on resume the two are seconds apart and the
     * correction snaps a whole screen of beat-scheduled enemy fire.
     */
    /*
     * Both early returns discard pending edge presses before they leave.
     *
     * `update` is the only hook that samples the input, so a branch that skips
     * it is a branch where nothing will ever consume the key-down edges the
     * `Input` listener is still collecting. The pause screen and the title
     * screen have their own `window` keydown handler further down this file
     * and keep running throughout, so without this a C pressed while paused —
     * or on the title screen, before the run even starts — would still be
     * sitting in the set and would throw a black hole on the first simulated
     * step after resuming.
     *
     * The old code got this for free from `input.endFrame()` in `render`, and
     * that free lunch was the 144 Hz bug: `render` runs on frames that
     * simulate nothing, so it also cleared presses the simulation had not yet
     * seen. See the long note on `pressed` in `core/input.ts`. The discard has
     * to live here, next to the decision not to simulate, not in `render`.
     */
    if (audioSuspended()) {
      input.discardEdges();
      return;
    }
    if (paused || !inRun) {
      input.discardEdges();
      return;
    }
    // A dev-only input override, so tooling can drive the ship directly rather
    // than through synthetic key events. Balance conclusions drawn from one
    // fixed strategy are conclusions about that strategy, not about the game.
    const injected = import.meta.env.DEV
      ? ((window as unknown as Record<string, unknown>).__botInput as typeof input.state | null)
      : null;
    // Pointer steering needs the ship's x to steer beside it — only x, since
    // the finger no longer pulls in y — and the mouse cursor is held in view
    // space, so it also needs the camera.
    input.shipX = world.player.x;
    // The ship's station in the track window — see `Input.shipStation`. The
    // un-shaken `viewY` for the same reason `toWorld` uses it: screenshake
    // must not reach the steer.
    input.shipStation = world.player.y - world.camera.viewY;
    /*
     * The box the drag target may hold, in the same two spaces the target is
     * kept in. The walls are the ship's own; the back of the track window is
     * converted to a station the same way `shipStation` is. The front is left
     * at Infinity because it is not a bound — pushing past it tows the window.
     */
    input.dragXMin = 12;
    input.dragXMax = PLAYFIELD_W - 12;
    input.dragStationMax = world.trackBack - world.camera.viewY;
    const state = injected ?? input.sample();
    /*
     * THE ONE INBOUND EDGE OF THE GAME/MUSIC BOUNDARY.
     *
     * `core/events.ts` says the simulation emits and never receives, and every
     * musical signal this project publishes has been output-only since it
     * started — which `docs/plan-items-v2.md` §2 identifies as the reason the
     * soundtrack is a beautiful readout of a fight it has no say in. DROP
     * (`feedback`) is the first item that needs it back.
     *
     * A VALUE PUSH, NOT A CALL. `World.setMusicalState` copies two numbers off
     * a readout; the world holds no director, cannot ask it a question, and
     * `src/game/` still never imports `src/audio/`. Either half can still be
     * rewritten without the other, which is the property that boundary exists
     * to protect.
     *
     * ONE FRAME STALE, deliberately: the readout is built in `render`, which
     * runs after this. A section holds for a minimum of four bars
     * (`arrangement.ts` MIN_BARS) — 7.5 seconds at 128 BPM — so a 16ms lag is
     * three orders of magnitude inside the signal, and computing a second
     * readout here would cost more than it could possibly buy.
     */
    world.setMusicalState(lastMusical);
    /*
     * The auto-pick preference rides on the input rather than living in the
     * world, for the same reason the offer request does: `World` is driven by
     * forty headless tools and a preference is not simulation state. It is read
     * fresh every step so toggling it mid-run takes effect immediately, which
     * is what a settings checkbox is expected to do.
     */
    state.autoPick = autoPick;
    world.update(dt, state);
    director.update(world.snapshot, world.transport, dt);
  },
  render(alpha, frameDt) {
    if (needsSync) {
      syncTransport(world.transport);
      needsSync = false;
    }
    const readout = director.readout(world.transport);
    // Handed to the simulation at the top of the next `update`; see there.
    lastMusical.section = readout.section;
    lastMusical.energy = readout.energy;
    // Caption every announcement with what the music just became.
    renderer.bannerDetail = `${readout.key.toUpperCase()} · ${readout.feel.toUpperCase()} · ${readout.bpm} BPM`;
    renderer.targetHue = readout.paletteHue;
    // The HUD decides whether TUNING UP is up (one frame behind, which is
    // the same lag `bannerDetail` has); the run bar reads it for its labels.
    renderer.openerUp = hud.openerUp;
    renderer.render(paused || !inRun ? 1 : alpha, frameDt, world.transport, readout.tension, loop.fps);

    /*
     * `sampleBar` and `sourceLines` are no longer called from here.
     *
     * They fed the notation canvas and the generated-source block, and both are
     * gone with the sidebar — see the header of `render/hud.ts` for what was
     * deleted and what the frame-rate A/B actually said about it. The director
     * still exposes both methods and `tools/capture.mjs` still uses them; this
     * frame hook simply no longer asks once a bar for eleven patterns and five
     * lines of formatted source that nothing renders.
     */
    hud.update(
      world.snapshot,
      readout,
      loop.fps,
      audioSuspended() ? 'tap to resume' : audioStatus(),
      world.transport.barPhase,
    );
    paintTouchRow();
    paintWarpLever();
    /*
     * Nothing touches the input here any more. `input.endFrame()` used to be
     * this line, and it is the reason one tap of the black-hole key spent four
     * wells at 30 Hz and none at all on ~17% of frames at 144 Hz: `render`
     * runs exactly once per displayed frame while `update` runs zero to eight
     * times, so a per-frame clear can never agree with a per-step read. The
     * edge set is now drained by `sample()` itself. Do not put a per-frame
     * input call back in this hook — `tools/inputcheck.mjs` check E will say
     * so, but by then someone has already shipped it.
     */
    needsSync = true;
  },
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/*
 * THE OPENING CHOICE.
 *
 * Built from `STARTERS` rather than hardcoded, so the list cannot drift from
 * the one `resetProgression` will actually honour — it validates against the
 * same array and silently falls back, which would turn a stale button into a
 * player wondering why their pick did nothing.
 *
 * The selection persists: a player who liked ECHOES should not have to re-pick
 * it every run, and the retry button never passes through here at all.
 */
/*
 * The collection, loaded once and written on each new find.
 *
 * Written immediately rather than at run end: a player who closes the tab
 * mid-run has still made the thing, and losing it would be the one bug this
 * feature cannot afford — the whole point is that it survives the run.
 */
const discovered = loadDiscovered();
/*
 * The world asks; this answers. It is consulted one line ABOVE the emits that
 * trigger `record` below — see `rewardBoss`/the fusion card path in world.ts —
 * because a hook read after them would always answer "seen before".
 */
const discoveredEl = document.getElementById('title-discovered')!;
const codexGrid = document.getElementById('codex-grid')!;
function paintDiscovered(): void {
  const s = summary(discovered);
  discoveredEl.textContent = discoveryLine(discovered);
  discoveredEl.classList.toggle('complete', s.found === s.total);
  /*
   * The grid is rebuilt rather than patched. It is fourteen rows, drawn on the
   * title screen and after each find — there is no frame budget here worth
   * protecting, and a rebuild cannot drift out of step with the set.
   */
  codexGrid.replaceChildren();
  for (const row of codex(discovered)) {
    const li = document.createElement('li');
    if (row.found) li.classList.add('found');
    const name = document.createElement('b');
    name.textContent = `${row.found ? '◈' : '·'} ${row.label}`;
    const recipe = document.createElement('em');
    recipe.textContent = row.recipe;
    li.append(name, recipe);
    codexGrid.append(li);
  }
}
paintDiscovered();
paintTitleStage();

world.isFirstDiscovery = (id) => !discovered.has(id);

const OPENER_KEY = 'musicwars.opener';
let chosenOpener: string = STARTING_INSTRUMENT;
try {
  const saved = localStorage.getItem(OPENER_KEY);
  if (saved && STARTERS.includes(saved)) chosenOpener = saved;
} catch {
  // Private browsing. The default opener is a fine answer.
}

/*
 * EVERY `.starter-row` ON THE PAGE, not one element.
 *
 * There are two now — the title screen's and the set list's — because the
 * opening pick and the stage pick are the same decision made at the same
 * moment, and a returning player who goes straight to the set list should not
 * have to walk back to the title to change their gun.
 *
 * TWO COPIES OF THE MARKUP, ONE COPY OF THE STATE AND ONE COPY OF THE CODE.
 * The alternative — a second, different control on the menu — is the shape this
 * repository keeps getting burned by: `src/render/levelup.ts` re-implements the
 * fusion rules and has drifted three times. A `querySelectorAll` costs nothing
 * and makes the drift impossible rather than merely unlikely.
 */
const starterRows = document.querySelectorAll('.starter-row');
function paintOpeners(): void {
  for (const row of starterRows) {
    row.replaceChildren();
    for (const id of STARTERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'starter';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(id === chosenOpener));
      const name = document.createElement('b');
      name.textContent = labelOf(id);
      const desc = document.createElement('em');
      desc.textContent = instrumentDef(id)?.blurb ?? '';
      b.append(name, desc);
      b.addEventListener('click', () => {
        chosenOpener = id;
        try { localStorage.setItem(OPENER_KEY, id); } catch { /* see above */ }
        paintOpeners();
      });
      row.append(b);
    }
  }
}
paintOpeners();

/* ------------------------------------------------------------------------ *
 * Painting the set list and the shop
 * ------------------------------------------------------------------------ */

const num = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Which screen BACK goes to. See `showMenu`. */
let menuReturn: 'title' | 'gameover' = 'title';

function paintTitleStage(): void {
  const deepest = deepestOffered(meta);
  document.getElementById('title-stage')!.textContent =
    deepest > 1 || meta.points > 0
      ? `STAGE ${selectedStage} · x${stageReward(selectedStage).toFixed(2)} REWARD`
      : '';
}

function paintMenu(): void {
  document.getElementById('menu-points')!.textContent = num(meta.points);
  const owned = meta.unlocked.length;
  document.getElementById('menu-cleared')!.textContent =
    `${meta.highestCleared > 0 ? `deepest cleared ${meta.highestCleared}` : 'nothing cleared yet'} · ${owned} unlocked`;

  const deepest = deepestOffered(meta);
  stageGrid.replaceChildren();
  for (let s = 1; s <= STAGE_COUNT; s++) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stage';
    const open = stageUnlocked(meta, s);
    const cleared = s <= meta.highestCleared;
    if (!open) b.classList.add('locked');
    else if (cleared) b.classList.add('cleared');
    else b.classList.add('next');
    b.disabled = !open;

    const n = document.createElement('b');
    n.textContent = String(s);
    const mult = document.createElement('i');
    mult.textContent = `x${stageReward(s).toFixed(2)}`;
    const note = document.createElement('em');
    const best = meta.best[String(s)];
    /*
     * The tile says the ONE thing that is true of it. A locked stage says what
     * would open it — a padlock with no instruction is a dead end — and a
     * cleared one says the time to beat, which is what the speed bonus is
     * measured against and therefore the only number that makes replaying a
     * finished stage interesting.
     */
    note.textContent = !open
      ? `clear ${s - 1}`
      : best
        ? `${Math.floor(best / 60)}:${String(Math.floor(best % 60)).padStart(2, '0')}`
        : cleared
          ? 'cleared'
          : 'NEW';
    b.append(n, mult, note);
    b.title = open
      ? `Stage ${s} — every point this run earns is multiplied by ${stageReward(s).toFixed(2)}`
      : `Stage ${s} — locked. Clear stage ${s - 1} to open it.`;
    if (open) {
      b.addEventListener('click', () => {
        selectedStage = s;
        void startRun();
      });
    }
    li.append(b);
    stageGrid.append(li);
  }

  document.getElementById('stage-hint')!.textContent =
    deepest >= STAGE_COUNT
      ? 'every stage is open — the deepest pays the most per minute'
      : `stage ${deepest} has never been cleared. Beating it opens ${deepest + 1}.`;

  document.getElementById('newgame-warning')!.textContent =
    `This erases ${owned} unlock${owned === 1 ? '' : 's'}, ${num(meta.points)} banked points and every stage you have cleared. There is no undo.`;
  paintTitleStage();
}

function paintShop(): void {
  document.getElementById('shop-points')!.textContent = num(meta.points);
  const price = nextPrice(meta);
  const rows = shopRows(meta);
  const left = rows.filter((r) => !r.owned).length;
  document.getElementById('shop-next')!.textContent =
    left === 0 ? 'everything is yours' : `next unlock ${num(price)} · ${left} left`;

  shopGrid.replaceChildren();
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'shop-row';
    if (row.owned) li.classList.add('owned');

    const h = document.createElement('h4');
    h.textContent = row.label;
    const kind = document.createElement('span');
    kind.textContent = row.slot === 'rig' ? 'PASSIVE' : 'WEAPON';
    h.append(kind);

    const buyCell = document.createElement(row.owned ? 'span' : 'button');
    if (row.owned) {
      buyCell.className = 'price owned';
      buyCell.textContent = 'OWNED';
    } else {
      const btn = buyCell as HTMLButtonElement;
      btn.className = 'ghost';
      btn.type = 'button';
      btn.textContent = `${num(price)} pts`;
      btn.disabled = meta.points < price;
      btn.addEventListener('click', () => {
        if (!buy(meta, row.id)) return;
        saveMeta(meta);
        paintShop();
        paintMenu();
      });
    }

    /*
     * The mechanics line, straight off `stepNote(id, 1)` via `shopRows`. It is
     * the same string the level-up card will show the first time this thing is
     * offered — see the note on `ShopRow.note`, and `tools/roster8.mjs`, which
     * asserts the two are byte-identical row by row.
     */
    const p = document.createElement('p');
    p.textContent = row.note;

    li.append(h, buyCell, p);
    shopGrid.append(li);
  }
}

function hideScreens(): void {
  titleScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  menuScreen.classList.add('hidden');
  shopScreen.classList.add('hidden');
}

function showMenu(from: 'title' | 'gameover'): void {
  menuReturn = from;
  selectedStage = Math.min(selectedStage, deepestOffered(meta));
  newgameConfirm.classList.add('hidden');
  paintMenu();
  hideScreens();
  menuScreen.classList.remove('hidden');
}

function showShop(): void {
  paintShop();
  hideScreens();
  shopScreen.classList.remove('hidden');
}

async function startRun(): Promise<void> {
  // Set before `start()`, which is also the retry path — see `World.starter`.
  world.starter = chosenOpener;
  /*
   * The stage and the roster, both set before `start()` and both for the same
   * reason `starter` is: AGAIN calls this function, and a player who chose
   * stage 6 and bought three weapons must get stage 6 and three weapons back.
   * `World.start()` clamps the stage; `resetProgression` re-reads the roster.
   */
  world.stage = selectedStage;
  world.unlocked = forceFullRoster ? null : unlockedRoster(meta);
  // The mouse is inert again until it is clicked on the field: the AGAIN and
  // START clicks that bring a player here are not that click. The pointer
  // throttle and the finger's steer are let go with it; the finger that
  // tapped START has lifted (the click fires after its pointerup), so nothing
  // real is being dropped.
  input.resetPointer();
  touchContactId = null;
  hideScreens();
  // Drop the victory treatment with the screen. It is re-decided on the next
  // `run:over` either way, but a hidden element carrying the previous run's
  // state is how a screenshot tool ends up photographing a win that is not
  // there — and `.won` also repaints the AGAIN button, which is visible for a
  // frame during the fade on some machines.
  gameoverScreen.classList.remove('won');

  /*
   * The phone session, from inside the same gesture and BEFORE the first
   * await: the audio-session category has to be set before the context
   * starts, the wake lock and fullscreen both need the gesture token, and
   * `bootAudio` is where the gesture is spent. Nothing in it is awaited or
   * can throw — see `core/platform.ts`.
   */
  enterPhoneSession();

  // Audio must be unlocked from inside the gesture that got us here.
  try {
    await bootAudio(128);
    director.reset(0);
    playPattern(director.masterPattern());
  } catch (err) {
    console.error('[musicwars] audio unavailable, running silent', err);
  }

  world.start();
  // Answer the click immediately; the scheduled arrangement joins underneath.
  sfxRunStart(director.currentChordNotes());
  inRun = true;
  paused = false;
  pauseScreen.classList.add('hidden');
  settingsFromPause = false;
}

/*
 * The two title doors. `#start-button` is "I'll pick my powerups" and
 * `#start-autopick` is "pick for me"; both begin the run at once and differ
 * only in the preference they write first, which is the same one the settings
 * checkbox owns (`setAutoPick`). A tool clicking `#start-button` therefore
 * gets exactly what it always got — a run, with the offer screen live.
 */
startButton.addEventListener('click', () => {
  setAutoPick(false);
  void startRun();
});
document.getElementById('start-autopick')?.addEventListener('click', () => {
  setAutoPick(true);
  void startRun();
});
retryButton.addEventListener('click', () => void startRun());

/* ------------------------------------------------------------------------ *
 * The set list's buttons
 * ------------------------------------------------------------------------ */

document.getElementById('setlist-button')!.addEventListener('click', () => showMenu('title'));
document.getElementById('gameover-menu')!.addEventListener('click', () => showMenu('gameover'));
document.getElementById('shop-button')!.addEventListener('click', showShop);
document.getElementById('shop-back')!.addEventListener('click', () => showMenu(menuReturn));
document.getElementById('menu-back')!.addEventListener('click', () => {
  hideScreens();
  (menuReturn === 'gameover' ? gameoverScreen : titleScreen).classList.remove('hidden');
});

/*
 * NEW GAME, behind a confirmation that names what it destroys.
 *
 * Two clicks, and the second one is the only irreversible control in the game:
 * it discards every unlock the shop sold, every point banked and every stage
 * cleared. `docs/plan-meta.md` §4 asks for the confirmation; the wording is in
 * `paintMenu`, in the player's own units, because "are you sure" is a question
 * nobody reads.
 *
 * It deliberately does NOT clear the best score, the opener preference or the
 * discovery codex. Those are records of things that happened rather than
 * progress that can be spent — a player wiping their set list has not un-played
 * the runs they played, and the codex in particular is described in its own
 * source as "the only thing in the game that persists past one run".
 */
document.getElementById('newgame-button')!.addEventListener('click', () => {
  newgameConfirm.classList.toggle('hidden');
});
document.getElementById('newgame-no')!.addEventListener('click', () => {
  newgameConfirm.classList.add('hidden');
});
document.getElementById('newgame-yes')!.addEventListener('click', () => {
  meta = defaultMeta();
  saveMeta(meta);
  selectedStage = 1;
  newgameConfirm.classList.add('hidden');
  paintMenu();
});

window.addEventListener('keydown', (e) => {
  // Volume from the keyboard, so a player mid-run never has to reach for a
  // slider they cannot look at.
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
    nudgeVolume(-0.05);
    paintVolume();
    return;
  }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') {
    nudgeVolume(0.05);
    paintVolume();
    return;
  }
  if (e.code === 'KeyM') {
    toggleMute();
    paintVolume();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    setPaused(!paused);
  }
  /*
   * Enter also starts, so the whole game is playable from the keyboard — but
   * NOT for the first moment the run-over screen is up.
   *
   * `world.isOver` becomes true in the same tick that `run:over` fires and the
   * screen appears, so a player who was holding Space or Enter when they died
   * — which, in a bullet hell, is most of them — restarted instantly and never
   * saw the screen at all. That screen is where the run is read back: the band
   * they assembled and the arrangement they were one pick away from.
   */
  // A held Space auto-repeats ~30x/s, so the grace period alone would be
  // outlasted by a player who died mid-press. Ignore repeats outright.
  if (e.repeat && (e.code === 'Enter' || e.code === 'Space')) return;
  const settled = performance.now() - runOverAt > RUN_OVER_GRACE;
  if ((e.code === 'Enter' || e.code === 'Space') && (!inRun || world.isOver) && settled) {
    if (!titleScreen.classList.contains('hidden') || !gameoverScreen.classList.contains('hidden')) {
      void startRun();
    }
  }
});

/**
 * True while the settings panel was opened FROM the pause screen, so closing
 * it brings the pause screen back rather than dropping the player into a run
 * that is still frozen with nothing on screen saying so.
 */
let settingsFromPause = false;

/**
 * Pause or resume, from any of the five places that can now ask: P / Escape,
 * the ⏸ button in the HUD, RESUME on the pause screen, a tap on the pause
 * screen's backdrop, and `visibilitychange`. One function, because the
 * platform audit's critical row was exactly two of these disagreeing — the
 * visibility handler paused and only the key could unpause, so a phone that
 * received one notification mid-run was paused for good ("press P to
 * resume", on a device with no P). Idempotent: `visibilitychange` can fire
 * hidden twice, and a RESUME tap on a screen already resuming must not pause.
 */
function setPaused(on: boolean): void {
  if (!inRun || world.isOver) return;
  if (on === paused) return;
  paused = on;
  if (paused) {
    // Snapshot the run into the pause screen: a pause is the one moment a
    // player can actually read anything, so it should be worth reading.
    const snap = world.snapshot;
    const readout = director.readout(world.transport);
    pauseStats.score.textContent = snap.score.toLocaleString('en-US');
    pauseStats.wave.textContent = String(snap.wave + 1);
    /*
     * Where the run is, in the run's own units. The screen carried WAVE 2
     * with no denominator, no act and no boss count — the one screen a
     * player reads at leisure said nothing about the run's shape. Every
     * number is the snapshot's: `act`/`acts`/`bossesBeaten` are published
     * exactly so no screen hard-codes four.
     */
    const down = snap.bossesBeaten;
    pauseStats.run.textContent =
      `ACT ${snap.act} OF ${snap.acts} · WAVE ${snap.wave + 1} OF ${TOTAL_WAVES} · ` +
      `${down} ${down === 1 ? 'BOSS' : 'BOSSES'} DOWN`;
    pauseStats.mult.textContent = `x${1 + snap.combo}`;
    /*
     * The run's TOTAL, not the shards lying on the floor right now.
     *
     * `world.notes` is the live array of uncollected shards, so this read as
     * a number that fell as the player collected them — pausing after a
     * clean sweep showed 0 notes for a run that had banked hundreds. The
     * game-over screen already uses `world.totals.notes`; the pause screen
     * was reading a different quantity under the same label.
     */
    pauseStats.notes.textContent = world.totals.notes.toLocaleString('en-US');
    pauseStats.music.textContent =
      `${readout.key.toUpperCase()} · ${readout.feel.toUpperCase()} · ${readout.bpm} BPM · ${readout.section.toUpperCase()}`;

    /*
     * The build plan. Six rows, because the pause screen also carries the
     * control list and a plan you have to scroll is not one you read.
     * `combinationPlan` sorts what is takeable now to the top, so the
     * truncation only ever hides the most distant aims — and it says how
     * many it hid rather than pretending the list is complete.
     */
    const plan = combinationPlan(snap.abilities, discovered);
    const SHOWN = 6;
    pauseStats.combos.replaceChildren();
    for (const row of plan.slice(0, SHOWN)) {
      const li = document.createElement('li');
      if (row.ready) li.classList.add('ready');
      if (row.kind === 'union') li.classList.add('union');
      const b = document.createElement('b');
      // The glyph carries the tier without relying on the colour: filled for
      // a union, open for anything else ready, hollow for an aim.
      b.textContent = `${row.ready ? (row.kind === 'union' ? '◆' : '◈') : '◇'} ${row.label}`;
      const em = document.createElement('em');
      em.textContent = row.ready ? row.needs : `needs ${row.needs}`;
      li.append(b, em);
      pauseStats.combos.append(li);
    }
    if (plan.length > SHOWN) {
      const li = document.createElement('li');
      const em = document.createElement('em');
      em.textContent = `+${plan.length - SHOWN} further off`;
      li.append(em);
      pauseStats.combos.append(li);
    }
    pauseStats.combosNone.classList.toggle('hidden', plan.length > 0);
  }
  settingsFromPause = false;
  pauseScreen.classList.toggle('hidden', !paused);
  // Pause, not stop: stopping resets the scheduler's cycle counters and the
  // transport comes back four bars in the past.
  if (paused) pauseAudio();
  else startAudio();
}

/*
 * THE PAUSE SCREEN'S BUTTONS, and the button that opens it.
 *
 * ⏸ toggles, like P. RESUME resumes; so does a tap on the backdrop, because
 * "tap anywhere to continue" is what a thumb tries first and the audit
 * measured it doing nothing. SETTINGS opens the gear's panel — the pause
 * overlay sits above it at z-index 10 to 8, so the panel is unreachable
 * while paused otherwise — and closing the panel brings the pause screen
 * back. SET LIST quits: see `quitToSetList`.
 */
document.getElementById('ui-pause')!.addEventListener('click', () => setPaused(!paused));
document.getElementById('pause-resume')!.addEventListener('click', () => setPaused(false));
pauseScreen.addEventListener('click', (e) => {
  if (e.target === pauseScreen) setPaused(false);
});
document.getElementById('pause-settings')!.addEventListener('click', () => {
  if (!paused) return;
  settingsFromPause = true;
  pauseScreen.classList.add('hidden');
  hud.setSettings(true);
});
document.getElementById('ui-gear-close')!.addEventListener('click', () => {
  if (settingsFromPause && paused) pauseScreen.classList.remove('hidden');
  settingsFromPause = false;
});

/**
 * Quit to the set list from the pause screen.
 *
 * Through the SAME path a death takes: `world.abandonRun` ends the run and
 * emits `run:over`, the handler above records it, pays out the waves cleared
 * and paints the summary screen, and `showMenu('gameover')` steps straight
 * past that screen to the set list — BACK from there reads the summary, which
 * is what the game-over screen's own SET LIST & SHOP button does. Two
 * alternatives rejected: a bare `showMenu('title')` with the run left frozen
 * behind it, which forfeits the payout and leaves `inRun` true under a menu;
 * and a second `run:over`-like path here, which is the duplicate wiring the
 * game-over screen's own comment in index.html warns against.
 *
 * The audio stays paused — `setPaused(true)` paused it — and the next START
 * restarts the scheduler: `playPattern` autostarts a paused Cyclist
 * (`cyclist.mjs` `setPattern(pat, true)` on `started === false`).
 */
function quitToSetList(): void {
  if (!inRun || world.isOver || !paused) return;
  paused = false;
  settingsFromPause = false;
  pauseScreen.classList.add('hidden');
  world.abandonRun();
  showMenu('gameover');
}
document.getElementById('pause-setlist')!.addEventListener('click', quitToSetList);

/*
 * Recover a suspended context.
 *
 * A phone that backgrounds the tab, takes a call or hits the ringer switch
 * leaves the AudioContext suspended, and it will not come back by itself. Any
 * subsequent gesture is a chance to fix that, so every one of them tries.
 */
for (const evt of ['pointerdown', 'keydown', 'touchend'] as const) {
  window.addEventListener(evt, () => {
    if (inRun && audioSuspended()) resumeAudio();
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && inRun && audioSuspended()) resumeAudio();
  // The wake lock is released by the browser on hide; take it again while a
  // run is live, which is the window the screen must not sleep in.
  if (!document.hidden && inRun && !world.isOver) reholdWake();
  // Through `setPaused`, so the screen that comes up is the one RESUME and a
  // backdrop tap take down — see there for the notification-shade trap.
  if (document.hidden) setPaused(true);
});

loop.start();

// Keep the fixed timestep honest if the display is unusual.
if (import.meta.env.DEV) {
  console.info(`[musicwars] fixed dt ${(FIXED_DT * 1000).toFixed(2)}ms`);
  // Handle for the smoke test; dev-only so it never ships.
  (window as unknown as Record<string, unknown>).__musicwars = {
    world,
    director,
    loop,
    startRun,
    // The pause state lives in this file, not in the world (`writeSnapshot`
    // hardcodes `paused = false`); `tools/touchcheck.mjs` reads it here.
    paused: () => paused,
    setPaused,
    readout: () => director.readout(world.transport),
    miniCacheStats,
    // What ?seed= actually resolved to, so a capture can record the seed that
    // produced the file rather than the one it hoped for.
    seed: () => (Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : null),
    probe: () => {
      // Lazily imported so the validator never reaches a production bundle.
      return import('./audio/probe').then((m) => m.findNonFinite(director.masterPattern(), 8));
    },
    renderer,
    hud,
    // Dev-only: lets the rondo check assert theme recurrence directly.
    themeForWave,
    // The app's own AudioContext. Tooling that imports @strudel/webaudio
    // directly gets a *second* module instance with its own singleton, so it
    // ends up poking a context the game has never heard of.
    audioCtx: () => getAudioContext(),
    audio: () => {
      const repl = getRepl();
      return {
        status: audioStatus(),
        started: !!repl?.scheduler.started,
        cycle: repl?.scheduler.now() ?? -1,
        cps: repl?.scheduler.cps ?? -1,
      };
    },
  };
}
