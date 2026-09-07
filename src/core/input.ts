/** Keyboard + gamepad state, sampled by the simulation rather than event-driven. */

export interface InputState {
  x: number; // -1..1
  y: number; // -1..1
  /**
   * Retained for tooling and touch, and no longer read by the simulation.
   *
   * The arena has no fire button: "maybe just always shoot, so user doesn't
   * need to shoot but also can move in all directions". Every instrument in the
   * ensemble runs on its own cadence and the world fires them whether or not
   * anything is held down. The field stays because `tools/lib/driver.mjs` and
   * the touch layer both set it, and because a stale `shoot` that nothing reads
   * is cheaper than eleven tools that no longer compile.
   */
  shoot: boolean;
  focus: boolean;
  bomb: boolean;
  /** Deploy a black hole. */
  well: boolean;

  /*
   * Level-up offer controls, all edge-triggered.
   *
   * The offer PAUSES the world but is not a modal menu: these are sampled by
   * the same loop as everything else, and there is no separate mode to be in.
   * That is deliberate and survives the pause — a modal menu would need its
   * own input path and its own way of not desynchronising the transport, and
   * the transport is the one clock that never stops here. See the offer block
   * in `world.ts`: the world holds, the music does not.
   *
   * "Edge-triggered" here means: exactly ONE call to `sample()` will ever see
   * a given press. See the long note on the edge set below for why that
   * sentence has to be about `sample()` calls rather than about frames.
   */
  /** 0-3, or -1 for no card chosen this frame. */
  choice: number;
  /** 0-3, or -1. Shift + the same digit. */
  banish: number;
  reroll: boolean;
  skip: boolean;
  /** Edge-triggered: show the banked level-up offers. */
  openOffers: boolean;
  /*
   * Preference, not a key: "pick upgrades for me, at random".
   *
   * It lives on the input state rather than in `World` because it is a setting
   * and not simulation state, and because `World.update` already takes every
   * other per-step intent this way. `Input` never writes it -- `main.ts` sets
   * it from the settings checkbox each step -- so it is declared here purely so
   * the shape the world receives is one type.
   */
  autoPick: boolean;

  /**
   * The throttle's position on its own axis: +1 hard forward, -1 hard back.
   *
   * WHY THIS EXISTS WHEN THERE IS ALREADY A `y`.
   *
   * `y` is NORMALISED — the block at the bottom of `sample()` divides by
   * `hypot(x, y)` so a diagonal is not faster than a cardinal. W alone gives
   * y = -1; W and A together give y = -0.707. Anything that asks "is the
   * throttle at its stop" off the normalised axis is really asking "is the
   * throttle at its stop AND is the player not steering", which is the wrong
   * question for a mode whose whole premise is more bodies to steer through.
   *
   * So this is the fore-and-aft component BEFORE the normalise, sign-flipped so
   * that forward is positive and it reads like a throttle rather than like a
   * screen coordinate. `y` is untouched and still drives the ship; nothing in
   * the flight model reads this.
   *
   * Deliberately an AXIS reading rather than "is KeyW down". The pad's stick,
   * the d-pad, the mouse button and a finger on the field all push this axis
   * and all should be able to warp; a key-code test would have made warp a
   * keyboard-only feature by accident.
   */
  throttle: number;

  /**
   * The warp lever's travel, 0 (down) to 1 (up), or null while untouched.
   *
   * Warp's second and now primary way in, beside the throttle stop above:
   * "let's just make a side bar the user can drag instead... pulling it up
   * turns on warp then pulling it down turns it off". A number is an
   * instruction and null is silence — see `Input.warpLever` for why the
   * difference is the whole latch, and `World.updateWarp` for what reads it.
   */
  warpLever: number | null;
}

/**
 * How far along the throttle axis counts as "at a stop", before normalisation.
 *
 * Not 1.0. A gamepad stick that reads 0.97 at the top of its travel is a
 * common and boring hardware fact, and a mode that a worn pad cannot enter is
 * a mode that does not exist for that player. 0.92 is comfortably past the
 * 0.22 deadzone and past anything a player produces without meaning to — see
 * the hold measurement in `World`'s warp block for the evidence that the
 * threshold does not have to carry the accident case on its own.
 *
 * Used for BOTH stops: forward engages warp, aft leaves it.
 */
export const WARP_STICK = 0.92;

/**
 * THE DRAG BAND: how far the ship must still travel, in view px, for the
 * stick to reach full lock.
 *
 * The pointer no longer says where the ship should BE (that was
 * `pointerTargetX` and the cursor steer, both tombstoned above); it says how
 * far the player has dragged it from where it was. Inside this band the stick
 * eases off so the ship settles onto the target instead of arriving at full
 * lateral speed and stopping dead — the same easing the absolute steer had
 * over its last 46 px, kept for the same reason.
 *
 * CHOSEN, NOT MEASURED, and deliberately SMALL. The band is not the gain:
 * the gain is 1:1 by construction, because a drag of N view px moves the
 * target N view px and the ship chases the target at up to `PLAYER_SPEED`,
 * which is far quicker than a thumb. The band only decides the last few
 * pixels. At 40 view px it is about 21 CSS px on a 390-wide phone — under a
 * fingertip, so a player never feels it as lag — and wide enough that the
 * ship is not bang-bang against a target the thumb is jittering around.
 * Larger and the ship lags a fast stroke; smaller and it hunts.
 */
export const DRAG_RANGE = 40;

/**
 * Movement under this many view px of gap steers nothing.
 *
 * A thumb resting on glass is not still to the pixel, and a capacitive screen
 * reports drift on a finger that has not moved. Without a dead zone the ship
 * would twitch for as long as a thumb sat on it. 3 view px is the same floor
 * the absolute finger steer used, and it is well inside `DRAG_RANGE` so the
 * proportional band keeps almost all of its travel.
 */
export const DRAG_DEAD = 3;

/**
 * How far ahead of the ship the drag target may sit, in view px.
 *
 * TWO JOBS, and the second one is easy to delete by accident.
 *
 * WIND-UP. `player.ts` clamps the ship to the arena walls. A target dragged
 * into a wall would otherwise accumulate arbitrarily far outside the field,
 * and the player would then have to drag hundreds of px back before the ship
 * moved at all — a control that has stopped answering. The leash is applied
 * every step against the ship's LIVE position, so the target can never get
 * further than this from a ship that is not moving.
 *
 * THE SUSTAINED BOOST. Once the ship reaches the front of the track window it
 * stops closing on the target and TOWS THE RAIL instead — that is what
 * "forward" means at the front edge, and it is how the stage is made to come
 * at you faster. The leash holds the target this far ahead of the pinned
 * ship, the gap never closes, the stick stays saturated at -1, and the tow
 * continues. A target clamped into the window instead of leashed to the ship
 * would zero the stick at the front edge and silently delete the gesture.
 *
 * CHOSEN, NOT MEASURED. It has to be bigger than any single thumb stroke or
 * long drags would be truncated and stop being 1:1 — a comfortable stroke is
 * 120-200 CSS px, which is 220-370 view px on a phone — and small enough that
 * one stroke recovers from a wall. 420 covers both. This and `DRAG_RANGE` are
 * the two numbers to move when the owner reports the feel from the phone.
 */
export const DRAG_LEASH = 420;

/*
 * TOMBSTONE — `MOUSE_STEER_RANGE` (120) and `MOUSE_DEAD_ZONE` (10).
 *
 * The cursor's horizontal offset from the ship, proportional to full lock over
 * 120 view px, live without a button. From "clicking should boost, not
 * clicking should decelerate then holding left or right to turn wth mouse".
 * Deleted with the cursor steer itself: asked whether the ship should follow
 * the pointer's position or only its movement, the owner chose movement, and
 * a position steer for the mouse alone would have meant the two devices
 * disagreed about what a pointer means. See the tombstone on `mouseEngaged`.
 *
 * TOMBSTONE — `BRAKE_DRAG_ENGAGE` (40) and `BRAKE_DRAG_RELEASE` (20), the
 * binary throttle's brake gesture, with its 20 px hysteresis band.
 *
 * They existed because a press was a boost and something had to be able to
 * say "slower" without letting go: "to slow dowh the ship you need to click
 * and drag backwards". A press is no longer a boost, so there is nothing to
 * back off from — dragging back now simply drags the ship back, on the same
 * axis and with the same gain as dragging it forward, and the hysteresis that
 * kept a thumb from chattering across one threshold has no threshold left to
 * guard. The two rejections recorded with them still stand and should not be
 * retried: a brake ZONE ("the bottom fifth of the screen brakes") reads
 * position, which is what must not matter; and a velocity flick is an edge a
 * player has to have noticed rather than a state they can see.
 */

const MOVE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
};

const SHOOT_KEYS = new Set(['KeyZ', 'Space', 'KeyJ']);
/** Card 1-4 on the level-up offer. Shift + the same key banishes it instead. */
const CHOICE_KEYS: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
};
const REROLL_KEYS = new Set(['KeyR']);
const SKIP_KEYS = new Set(['KeyQ']);
/* Space asks for the level-ups banked so far. See `World.update`'s openOffers. */
const OPEN_OFFER_KEYS = new Set(['Space']);
const BOMB_KEYS = new Set(['KeyX', 'KeyK']);
const WELL_KEYS = new Set(['KeyC', 'KeyI']);
const FOCUS_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'KeyL']);

export class Input {
  /**
   * THE POINTER MOVES THE SHIP BY HOW FAR IT DRAGS, NOT BY WHERE IT IS.
   *
   * The owner, playing on a phone: "clicking on the screen moves the ship
   * forward it shouldn't do that, only dragging moves the ship". Asked
   * whether the ship should follow the finger's POSITION or only its
   * MOVEMENT, they chose movement — "a tap that doesn't move does nothing".
   *
   * TOMBSTONE — `pointerTargetX`, the absolute steer this replaces. It held
   * the finger's world x and the ship swam toward it, which is the convention
   * most mobile shmups use, and it had two faults the owner met in one
   * session: a tap anywhere teleported the ship's intent to that column (a
   * still press 30 px from the left wall walked the ship 336 px, measured),
   * and the thumb had to sit ON the ship's line to fly straight, which is
   * where the arrivals land. Relative drag lets the thumb rest anywhere.
   *
   * A RE-BASING VIRTUAL TARGET, NOT A POSITION DELTA, and that distinction is
   * the whole design. Writing the drag straight onto `player.x` would bypass
   * the flight model, and four things downstream read VELOCITY rather than
   * the stick: the bank (`player.ts`), the camera's lookahead (`camera.ts`),
   * the gauge/starfield/plume off `player.vy` (`renderer.ts`), and the facing,
   * which is gated on `push > FACING_DEADZONE` — a 200 px stroke over half a
   * second is 3.3 px per step, so a raw delta would never clear that gate and
   * the nose would stop turning. A delta is also EDGE-shaped, and `sample()`
   * runs up to `MAX_STEPS` times per frame: it would apply 4x at 30 Hz and 0x
   * on a spare frame, which is the multi-step bug this file already documents
   * on `pressed`. A target is a POSITION, so `sample()` stays idempotent and
   * every downstream reader keeps getting a real stick.
   *
   * TWO SPACES, ON PURPOSE. `dragX` is a WORLD x, because view px and world px
   * are the same size and the arena's walls are the only clamp x needs — so
   * nothing about the camera enters the lateral steer. `dragStation` is a
   * VIEW y, because the fore-and-aft axis is a place in a track window that
   * SLIDES FORWARD at the rail speed: a world-space y target would be
   * overtaken by the window every step and a resting thumb would read as
   * "brake". Station is the only frame in which "hold what I have" is
   * stationary. It is also the one place the camera reaches the simulation;
   * see `shipStation`.
   */
  private dragX: number | null = null;
  private dragStation: number | null = null;
  /** Where the pointer was last seen, in view px, so a move becomes a delta. */
  private dragLastX = 0;
  private dragLastY = 0;
  private pointerFiring = false;
  /** True once any touch has been seen, so the UI can adapt. */
  touchActive = false;

  /*
   * TOMBSTONE — `touchBomb`, `touchWell`, `touchFocus`.
   *
   * Three booleans set by the FOCUS / BOMB / WELL buttons in the touch row and
   * consumed below. The buttons were removed on the owner's word ("remove
   * focus bomb and well") and these went with them rather than staying as
   * controls nothing writes: `tools/session.mjs` counts inert controls, and
   * this file's own history is that an unread field is a field that rots.
   * Restoring one is this declaration, its read in `sample()`, a button in
   * `index.html` and a `bindTouchButton` in `main.ts`.
   */
  /**
   * "Show me the level-ups I have banked", from a tap rather than from Space.
   *
   * On touch there was NO way to open the offer: `OPEN_OFFER_KEYS` is Space
   * and nothing else set `openOffers` — the platform audit's critical row, in
   * the owner's words "the majority audience will play this on the phone".
   * `main.ts` sets this from the LEVEL UP button in the touch row and from a
   * tap on the ship's badge; `sample()` reads it once and clears it, exactly
   * as `touchBomb` is consumed, so one tap is one edge whatever the frame
   * rate — the same contract the key path has (see `pressed`). The world's
   * own latch (`offerEdge`) then sees a single rising edge.
   */
  pointerOpenOffers = false;

  /*
   * THE MOUSE IS THE SAME GESTURE AS THE THUMB NOW: press and drag.
   *
   * TOMBSTONE — the CURSOR STEER, `mouseX` and `MOUSE_STEER_RANGE`. The
   * cursor's horizontal offset from the ship was the steer, proportional over
   * 120 view px, live whenever the mouse was engaged and the button was not
   * needed for it. It came from "holding left or right to turn wth mouse" and
   * it is exactly the scheme the owner voted against a session later, when
   * asked whether the ship should follow the pointer's POSITION or only its
   * MOVEMENT: only its movement. Keeping it for the mouse alone would have
   * meant the two devices disagreed about what the pointer means, and the
   * cursor-position steer is the one the owner has now rejected twice — once
   * for the finger ("only dragging moves the ship") and once by choosing
   * movement over position. The drag path serves both devices.
   *
   * ENGAGED SURVIVES, and it is still the piece that keeps this from being a
   * regression for keyboard players: before the first primary-button press on
   * the field during a run the mouse is inert, and a mouse resting on the desk
   * cannot steer. It is now nearly redundant — a drag needs a press anyway —
   * but it still gates the FIRST press, so a click that lands on the field to
   * dismiss something does not also grab the ship. `main.ts` resets it in
   * `startRun`.
   */
  private mouseEngaged = false;

  /** True once a mouse click on the field has taken the ship this run. */
  get mouseActive(): boolean {
    return this.mouseEngaged;
  }

  /** The deliberate act: the first primary-button press on the field. */
  engageMouse(): void {
    this.mouseEngaged = true;
  }

  /*
   * THE PRESS ITSELF DOES NOTHING. It only opens a drag.
   *
   * TOMBSTONE — the BINARY POINTER THROTTLE, which lived here for two days.
   * Pressed was +1, released was 0, and pressed-and-dragged-back past
   * `BRAKE_DRAG_ENGAGE` was -1. It came from the owner's own words ("click to
   * go faster or youre decelerating... a little like flappy bird") and it was
   * replaced by the owner's own words a session later: "clicking on the
   * screen moves the ship forward it shouldn't do that". Measured on the
   * iPhone 14 profile before the change, a press whose finger NEVER MOVED ran
   * the ship 1729 px in 2 s against 828 px cruising — 109% faster — and
   * carried `warpCharge` to 1.00, so a player who touched the glass to steer
   * was boosted and warped without asking for either.
   *
   * What is left is contact state: whether a pointer is down, and where it
   * was last seen, so a move can be turned into a delta. The ship's velocity
   * now comes only from `dragX`/`dragStation` above, and warp comes from the
   * lever (`warpLever`) or from the keyboard's own fore/aft stop.
   *
   * Kept apart from `touchActive` on purpose: the mouse presses this and must
   * never flip the UI's touch switch.
   */
  private pointerDown = false;

  /** True while a finger or the primary button is down on the field. */
  get pointerPressed(): boolean {
    return this.pointerDown;
  }

  /**
   * A press begins at a view point, and RE-BASES the drag onto the ship.
   *
   * Re-basing is what makes the thumb able to rest anywhere: the target
   * starts wherever the ship already is, so the first pixel of drag moves the
   * ship one pixel from where it was rather than hauling it to the finger.
   * It is also the recovery gesture — lift and press again and the target is
   * back under the ship, which is how a stroke that ran out of glass is
   * continued.
   *
   * A second press without a release in between (a second finger) re-bases
   * again: the newest contact owns the ship, and `main.ts` gives it the
   * pointer id so the older finger stops being heard.
   *
   * `touch` marks the contact as a finger rather than the mouse button. Only
   * a finger sets `touchActive` and only a finger fires the guns.
   */
  pressPointer(viewX: number, viewY: number, touch = false): void {
    this.pointerDown = true;
    this.dragLastX = viewX;
    this.dragLastY = viewY;
    this.dragX = this.shipX;
    this.dragStation = this.shipStation;
    if (touch) {
      this.touchActive = true;
      this.pointerFiring = true;
    }
  }

  /**
   * The pressed pointer moved to a view point: the delta goes onto the target.
   *
   * Ignored when nothing is pressed, so a mouse moving across the field with
   * no button down steers nothing — "only dragging moves the ship" is true of
   * the cursor as well as of the thumb.
   */
  dragPointer(viewX: number, viewY: number): void {
    if (!this.pointerDown || this.dragX === null || this.dragStation === null) return;
    this.dragX += viewX - this.dragLastX;
    this.dragStation += viewY - this.dragLastY;
    this.dragLastX = viewX;
    this.dragLastY = viewY;
  }

  /**
   * The finger lifted or the button let go.
   *
   * The targets go with it, so the ship holds the place in the window the
   * player left it in and the stick falls to zero — the same "no settle, no
   * recentre" rule `player.ts` records. A target that outlived the contact
   * would keep steering after the thumb was gone.
   */
  releasePointer(): void {
    this.pointerDown = false;
    this.dragX = null;
    this.dragStation = null;
    this.pointerFiring = false;
  }

  /**
   * Re-base the drag under the ship WITHOUT ending the contact.
   *
   * For the case where the pointer was doing something else for a while and
   * is now steering again — the level-up offer is open over the field, and
   * `main.ts` drops drag events while it is. Without this the thumb's wander
   * across the cards would be applied as one jump the moment the offer
   * closed.
   */
  rebaseDrag(viewX: number, viewY: number): void {
    if (!this.pointerDown) return;
    this.dragLastX = viewX;
    this.dragLastY = viewY;
    this.dragX = this.shipX;
    this.dragStation = this.shipStation;
  }

  /**
   * A new run: the mouse is inert again until it is clicked, no pointer is
   * pressed, no finger is steering, and the warp lever has no opinion.
   * `touchActive` is deliberately kept — it is the UI's memory that this is a
   * touch device, not run state.
   */
  resetPointer(): void {
    this.mouseEngaged = false;
    this.releasePointer();
    this.warpLever = null;
  }

  private down = new Set<string>();
  /**
   * Key-down edges that no simulation step has been told about yet.
   *
   * ONE PRESS, ONE ACTION — and getting that right is entirely about who
   * empties this set. It used to be emptied by `endFrame()`, which `main.ts`
   * called from the loop's `render` hook, i.e. exactly once per DISPLAYED
   * frame. `sample()` is called from the `update` hook, and `core/loop.ts` is
   * a fixed-timestep loop: it runs `update` however many `FIXED_DT` slices fit
   * in the frame delta and then `render` once. The number of `sample()` calls
   * per clear is therefore whatever the player's monitor happens to be, and
   * that broke the edge in both directions at once.
   *
   * Measured on this class, before the change, 3000 presses per rate, one tap
   * of the black-hole key per displayed frame:
   *
   *   30 Hz  4.000 steps/frame   4.000 wells thrown per press
   *   60 Hz  2.000 steps/frame   2.000 wells thrown per press
   *  120 Hz  1.000 steps/frame   1.000 — correct only by coincidence
   *  144 Hz  0.833 steps/frame   0.833 (16.7% of presses never seen at all)
   *  240 Hz  0.500 steps/frame   0.500 (50.0% never seen)
   *
   * Below 120 Hz every step in the frame re-read the same edge, so one tap of
   * C spent two black holes at 60 Hz and four at 30 Hz. Above 120 Hz a frame
   * can run ZERO steps — the accumulator has not reached `FIXED_DT` yet — and
   * `render` still ran, so the clear happened before any `sample()` had looked
   * and the press was dropped with no trace. Even at a nominally matched
   * 120 Hz, float drift in the accumulator produced 6 zero-step frames in
   * 3000 and lost those presses too.
   *
   * The fix is that the CONSUMER clears it: `sample()` drains this set at the
   * point it reads it, so the first simulation step to see an edge is the only
   * one that ever will, and a press made during a zero-step frame simply waits
   * for the next step instead of being thrown away. Nothing in the loop, and
   * nothing about the refresh rate, enters into it.
   *
   * Rejected alternatives, recorded so they are not re-tried:
   *
   * - Move `endFrame()` from `render` to the top of `update`. Fixes the
   *   double-fire and makes the loss WORSE: a zero-step frame still never
   *   clears, but the first step of the next frame now clears before sampling.
   * - Timestamp each press and expire it after ~50 ms. Turns a correctness
   *   property into a tuning constant, and still fires twice inside 50 ms.
   * - Have `main.ts` call `sample()` once per frame and hand the same state
   *   object to every step. That is a bigger change than it looks: `sample()`
   *   also folds in pointer steering, which reads `shipX`/`viewX` and must be
   *   re-evaluated per step or touch steering stutters at low frame rates.
   *
   * Two presses of the SAME key with no `sample()` between them still collapse
   * into one action — this is a Set of key codes, not a queue. That is left
   * alone deliberately: the window is one frame, a second press inside 8 ms is
   * not a human, and a queue would let a stuck key bank actions.
   */
  private pressed = new Set<string>();
  private gamepadIndex: number | null = null;
  /**
   * Gamepad buttons that were already down at the previous `sample()`.
   *
   * The pad is POLLED inside `sample()` and never touches the `pressed` set
   * above, so it reached the same actions by a completely different route and
   * the drain fixes nothing for it. Holding B therefore threw a black hole on
   * every simulation step for as long as it was held — 200 wells in 200
   * samples, measured. The pad needs its own edge memory, and this is it.
   */
  private padDown = new Set<number>();

  readonly state: InputState = {
    x: 0,
    y: 0,
    shoot: false,
    focus: false,
    bomb: false,
    well: false,
    choice: -1,
    banish: -1,
    reroll: false,
    skip: false,
    openOffers: false,
    autoPick: false,
    throttle: 0,
    warpLever: null,
  };

  /** Set by the HUD when a card is clicked or tapped; drained by `sample()`. */
  pointerChoice = -1;
  pointerBanish = -1;
  pointerReroll = false;
  pointerSkip = false;

  /**
   * The ship's world x, so the drag target knows where to re-base and how far
   * it still has to pull. Set by `main.ts` every step.
   */
  shipX = 450;
  /**
   * The ship's y IN THE VIEW — its station in the track window, not its world
   * y. Set by `main.ts` every step as `player.y - camera.viewY`.
   *
   * A `shipY` was deleted from here once, with the note that "a field nobody
   * reads is a promise nobody keeps". This is not that field coming back: the
   * old one was a WORLD y for an absolute steer, and the reason the vertical
   * steer was removed is that a thumb resting below the ship read as a pull
   * backwards. Station is a different quantity and it exists for a stated
   * reason — see `dragStation`, which cannot be expressed in world space
   * because the window it lives in slides forward every step.
   *
   * THIS IS THE ONE PLACE THE CAMERA REACHES THE SIMULATION, and `camera.ts`
   * records that the camera is meant to be strictly downstream — `arena.mjs`
   * producing bit-identical output is what established it. That property is
   * intact where it is measured: every bot harness drives `World.update` with
   * an input literal and never calls `sample()` at all, so no balance
   * measurement can see this. If a bot is ever taught to steer through
   * `Input`, this is the line to suspect first.
   */
  shipStation = 0;

  /**
   * The warp lever's travel, 0 (down, out) to 1 (up, engaged) — or NULL while
   * nobody is touching it, which means "no opinion" rather than "zero".
   *
   * The owner: "let's just make a side bar the user can drag instead, make it
   * look cool but small, so pulling it up turns on warp then pulling it down
   * turns it off". So warp is no longer something the throttle does at its
   * stop; it is a control of its own, at the right edge, dragged.
   *
   * NULL IS NOT 0, and the distinction is the whole latch. `World.updateWarp`
   * treats a number as an instruction and null as silence: while the lever is
   * held, its travel drives the charge directly; when it is let go the field
   * goes back to null and the mode simply STAYS where the lever left it. A
   * lever that reported 0 on release would drop the player out of warp the
   * instant they took their thumb off, which is the opposite of a lever.
   *
   * The keyboard's fore/aft stop still arms and drops warp on its own timers,
   * untouched — see `World.updateWarp`. Two ways in, one latch.
   */
  warpLever: number | null = null;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      // Space and arrows scroll the page otherwise.
      if (ev.code === 'Space' || ev.code.startsWith('Arrow')) ev.preventDefault();
      this.down.add(ev.code);
      this.pressed.add(ev.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete((e as KeyboardEvent).code));
    target.addEventListener('blur', () => {
      this.down.clear();
      this.pressed.clear();
      // The pointer goes the way the keys do: a window that lost focus will
      // never see the pointerup. Mouse engagement stays — the ship simply
      // falls to cruise, which is what an unpressed pointer means.
      this.releasePointer();
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = (e as GamepadEvent).gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /*
   * `wasPressed(code)` and `anyPressed()` used to live here and are gone.
   *
   * They read the edge set from outside `sample()`, which is the exact shape
   * of the bug documented on `pressed` — under the drain-on-read rule their
   * answer depends on whether a simulation step has happened yet this frame,
   * so "was this pressed" has no stable meaning to ask from anywhere else.
   * Nothing in `src/`, `tools/` or `electron/` called either of them; they had
   * been dead for the whole life of the file. If something needs a key that is
   * not an action, add it to `sample()` and put it on `InputState`.
   */

  /**
   * Read the current input, CONSUMING any edge-triggered presses.
   *
   * Called once per simulation step, so it must be idempotent for held keys
   * and one-shot for edges — see the note on `pressed`. The returned object is
   * the same `state` instance every time; callers that need to keep a value
   * past the next step must copy it.
   */
  sample(): InputState {
    let x = 0;
    let y = 0;
    /**
     * The DRAG's fore-and-aft term, held apart from `y` until the throttle has
     * been read — which is the one line that keeps the owner's rule true.
     *
     * `throttle` is what `World.updateWarp` arms and drops warp on, and it is
     * taken off `y` a few dozen lines below. If the drag were summed into `y`
     * with the keys, then dragging the ship forward would pin the throttle at
     * its forward stop and warp would engage 1.4 s later — which is precisely
     * the "the press flies the ship AND warps it" coupling being removed, put
     * back through the other axis. So the keys and the pad own `throttle`, the
     * drag owns the ship, and the two meet only after the read.
     */
    let dragY = 0;

    for (const code of this.down) {
      const v = MOVE_KEYS[code];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }

    /*
     * THE DRAG, ON BOTH AXES, AS A SATURATING CONTROLLER ON A LEASHED TARGET.
     *
     * `dragX` and `dragStation` are where the player has dragged the ship TO;
     * the stick is how far that still is, over `DRAG_RANGE`, clamped. Under
     * `DRAG_RANGE` of the target the ship eases in instead of arriving at
     * full lateral speed and stopping dead, which is the same easing the
     * absolute steer had over its last 46 px and for the same reason.
     *
     * THE LEASH IS APPLIED HERE, EVERY STEP, AGAINST THE SHIP'S LIVE
     * POSITION — not at the moment of the drag. Two things need it. A target
     * driven into a wall would otherwise wind up arbitrarily far outside the
     * arena, and coming back would need hundreds of px of drag against a
     * ship that had not moved; and the whole sustained-boost gesture depends
     * on the target being ALLOWED to sit ahead of a ship that cannot reach
     * it. Once the ship pins at the front of the track window it stops
     * closing the gap, the leash holds the target `DRAG_LEASH` ahead of it,
     * the stick stays saturated at -1, and the ship goes on towing the rail —
     * which is what "hold forward and the stage comes at you faster" is made
     * of. A target clamped into the window instead would zero the stick at
     * the front edge and quietly delete that.
     *
     * KEYS AND PAD ADD TO THE SAME AXES AND THE SUM IS CLAMPED. The clamp
     * cannot be left to the normalise below: the normalise scales x and y
     * together, so D held on top of a full-lock drag would push x to 2 and
     * come out of the hypot as a MORE lateral heading than full lock. The
     * steer is a position, not a sum. There is no longer a keys-beat-pointer
     * override — with both clamped into the same axis, holding W while
     * dragging forward is already full forward, and holding W while dragging
     * back is a player asking for two opposite things and getting neither.
     */
    if (this.dragX !== null) {
      this.dragX = Math.max(this.shipX - DRAG_LEASH, Math.min(this.shipX + DRAG_LEASH, this.dragX));
      const dx = this.dragX - this.shipX;
      if (Math.abs(dx) > DRAG_DEAD) x += Math.max(-1, Math.min(1, dx / DRAG_RANGE));
    }
    if (this.dragStation !== null) {
      const s = this.shipStation;
      this.dragStation = Math.max(s - DRAG_LEASH, Math.min(s + DRAG_LEASH, this.dragStation));
      const dy = this.dragStation - s;
      if (Math.abs(dy) > DRAG_DEAD) dragY += Math.max(-1, Math.min(1, dy / DRAG_RANGE));
    }
    x = Math.max(-1, Math.min(1, x));

    // Touch state first; the keyboard scan below ORs on top of it.
    let shoot = this.pointerFiring;
    // Keyboard only since the touch row lost its three panic buttons; the
    // scan below is now the sole writer of all three.
    let bomb = false;
    let focus = false;
    let well = false;
    for (const code of this.down) {
      if (SHOOT_KEYS.has(code)) shoot = true;
      if (BOMB_KEYS.has(code)) bomb = true;
      if (FOCUS_KEYS.has(code)) focus = true;
    }
    // Offer controls, edge-triggered like the well. Shift is the focus key,
    // which is free while an offer is open — the ship is barely moving and
    // there is nothing to focus on — so it doubles as the banish modifier
    // rather than spending four more keys on a screen that appears for two
    // seconds. Read from `down`, not from the edge set: the modifier is a state
    // the digit is pressed *in*, and it went down before the digit did.
    let choice = this.pointerChoice;
    let banish = this.pointerBanish;
    let reroll = this.pointerReroll;
    let skip = this.pointerSkip;
    let openOffers = this.pointerOpenOffers;
    this.pointerChoice = -1;
    this.pointerBanish = -1;
    this.pointerReroll = false;
    this.pointerSkip = false;
    this.pointerOpenOffers = false;
    const shifted = this.down.has('ShiftLeft') || this.down.has('ShiftRight');

    /*
     * THE ONE PLACE THE EDGE SET IS READ, AND THE ONE PLACE IT IS EMPTIED.
     *
     * Every edge-triggered action is decoded in this single loop and the set
     * is drained immediately after it, so a press cannot be seen by a second
     * simulation step and cannot be discarded before the first one. It was two
     * loops with the clear living in another file; keeping the read and the
     * drain adjacent is the thing that makes the invariant checkable by eye.
     * Do not add a read of `this.pressed` below this block.
     *
     * A well is a decision, not something you hold down — see the black-hole
     * comment in `world.ts` — which is why it is here rather than in the
     * `down` scan above with shoot, focus and bomb.
     */
    for (const code of this.pressed) {
      if (WELL_KEYS.has(code)) well = true;
      const card = CHOICE_KEYS[code];
      if (card !== undefined) {
        if (shifted) banish = card;
        else choice = card;
      }
      if (REROLL_KEYS.has(code)) reroll = true;
      if (SKIP_KEYS.has(code)) skip = true;
      if (OPEN_OFFER_KEYS.has(code)) openOffers = true;
    }
    this.pressed.clear();

    const pad = this.gamepadIndex !== null ? navigator.getGamepads?.()[this.gamepadIndex] : null;
    if (pad) {
      /** True on the sample a pad button goes down, and only that one. */
      const padEdge = (i: number): boolean => {
        const now = !!pad.buttons[i]?.pressed;
        const was = this.padDown.has(i);
        if (now) this.padDown.add(i);
        else this.padDown.delete(i);
        return now && !was;
      };
      const dead = 0.22;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > dead) x += ax;
      if (Math.abs(ay) > dead) y += ay;
      if (pad.buttons[12]?.pressed) y -= 1;
      if (pad.buttons[13]?.pressed) y += 1;
      if (pad.buttons[14]?.pressed) x -= 1;
      if (pad.buttons[15]?.pressed) x += 1;
      shoot ||= !!pad.buttons[0]?.pressed;
      bomb ||= !!pad.buttons[2]?.pressed;
      focus ||= !!(pad.buttons[6]?.pressed || pad.buttons[7]?.pressed);
      /*
       * B is edge-triggered, because a black hole is. Everything above is
       * level-triggered on purpose: shoot and focus are held, and bomb is
       * self-gated by the 1.6 s invulnerability `detonateBomb` grants
       * (`world.ts`), so re-reading it costs nothing. Wells have no such gate
       * and were being emptied at 120 spends a second by a held button.
       *
       * Written as a statement rather than `well ||= padEdge(1)` on purpose:
       * `||=` short-circuits when `well` is already true, which would skip the
       * call and leave `padDown` never updated for that button — the edge
       * would then fire again the moment the keyboard let go.
       */
      if (padEdge(1)) well = true;
    } else {
      // Unplugged mid-press: forget the buttons, or reconnecting with the
      // stick still held would swallow the first real press.
      this.padDown.clear();
    }

    /*
     * READ BEFORE THE NORMALISE AND BEFORE THE DRAG, and both halves of that
     * matter.
     *
     * Before the normalise: see `InputState.throttle`. Nothing that has added
     * into `y` by this line has been scaled down yet by a lateral component
     * the player is also holding, so the stop is a stop however the ship is
     * turning. Clamped, because a d-pad and a stick can push the same axis at
     * once and the throttle is a position, not a sum.
     *
     * Before the drag: `throttle` is the WARP axis, and only the keyboard and
     * the pad may speak on it. See `dragY` at the top of this method — this
     * is the line its comment is about, and the reason the two are separate
     * quantities at all.
     */
    const throttle = Math.max(-1, Math.min(1, -y));

    // Now the drag joins the ship's axis, clamped for the same reason x was.
    y = Math.max(-1, Math.min(1, y + dragY));

    // Normalise so diagonals are not faster than cardinals.
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    this.state.x = x;
    this.state.y = y;
    this.state.throttle = throttle;
    this.state.warpLever = this.warpLever;
    this.state.shoot = shoot;
    this.state.bomb = bomb;
    this.state.focus = focus;
    this.state.well = well;
    this.state.choice = choice;
    this.state.banish = banish;
    this.state.reroll = reroll;
    this.state.skip = skip;
    this.state.openOffers = openOffers;
    return this.state;
  }

  /**
   * Throw away pending edges because nothing is going to simulate this step.
   *
   * `endFrame()`, which `main.ts` called from the loop's `render` hook, used
   * to do this every frame unconditionally. That was the bug — see `pressed`.
   * But deleting it outright had a second-order cost that only shows up in the
   * real app: `main.ts`'s `update` hook returns early when the game is paused,
   * on the title screen, or when the AudioContext is suspended, so `sample()`
   * stops being called while the pause screen and the title screen keep their
   * OWN `window` keydown listener running. With nothing draining the set, a C
   * pressed while paused, or on the title screen before the run starts, sat
   * there and threw a black hole on the first simulated step after unpausing.
   * `endFrame()` had been hiding that by accident.
   *
   * So the discard moved from "every frame, always" to "every step that
   * decides not to simulate", which is where it belongs and where it cannot
   * race a `sample()`. It is idempotent, so the several steps a paused frame
   * runs through the early return cost nothing.
   *
   * The held keys in `down` are deliberately untouched: holding right through
   * a pause and expecting to still be moving on resume is correct, and `blur`
   * already clears them when the window actually loses focus.
   *
   * `padDown` is untouched too, and that leaves one residual case: the pad is
   * only polled inside `sample()`, so a button first pressed DURING a pause is
   * unseen, and the first sample after resuming reads it as a fresh edge. The
   * honest fix would be to poll the pad from here, which is a `getGamepads()`
   * call on every step of every paused frame to cover a player who pressed and
   * held B on the pause screen. Not worth it; written down so the next person
   * to find it knows it was considered rather than missed.
   */
  discardEdges(): void {
    this.pressed.clear();
  }
}
