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
 * The mouse scheme's steering range: the cursor's horizontal offset from the
 * ship, in VIEW pixels, at which the steer reaches full lock.
 *
 * The owner's ask, verbatim: "clicking should boost, not clicking should
 * decelerate then holding left or right to turn wth mouse". So the button is
 * the throttle (see `BRAKE_DRAG_ENGAGE` for what it became a day later) and
 * the cursor's side of the ship is the steer, proportional up to this range
 * and clamped past it.
 *
 * CHOSEN, NOT MEASURED, and here is the arithmetic it was chosen on. The
 * cursor sits still while the ship moves toward it, so the steer is a
 * proportional controller on the gap: lateral speed is `PLAYER_SPEED *
 * dx / MOUSE_STEER_RANGE`, which closes the gap with a time constant of
 * `MOUSE_STEER_RANGE / PLAYER_SPEED` = 120/430 = 0.28 s, on top of the flight
 * model's 35 ms acceleration half-life. That is an order of magnitude slower
 * than the velocity damping, so the ship settles under the cursor rather than
 * hunting around it, and fast enough that a cursor flicked to the far side of
 * the ship is answered inside a third of a second. A range under the touch
 * layer's 46 px ramp would make the mouse bang-bang — full lock for any
 * cursor not on the ship — which is a keyboard with worse ergonomics; a range
 * over ~250 would leave the ship lagging a cursor a quarter-screen away at
 * half speed. Nobody has flown it by hand yet; when someone does, this is the
 * number to move.
 *
 * VIEW pixels, and the cursor is kept in view space too — not world space
 * like the touch target — for a reason that was measured rather than
 * foreseen. The camera FOLLOWS the ship across the track (`camera.ts`,
 * `follow`), so a cursor converted to world space at its last `pointermove`
 * goes stale the moment the ship moves and the camera pans after it; a still
 * mouse sends no further events. The first draft stored world x and the ship
 * stopped 19 px short of a cursor 200 px to its right after a 2 s hold — the
 * camera had panned 11 px and the ship was inside the dead zone of a point
 * that was no longer under the pointer. In view space the cursor's offset is
 * `mouseX - (shipX - viewX)`, re-evaluated every step against wherever the
 * camera is now, and `main.ts` hands `viewX` over beside `shipX`. View rather
 * than screen pixels so the feel does not change with the window; `main.ts`
 * converts through the same `toView` the offer's hit test uses.
 */
export const MOUSE_STEER_RANGE = 120;

/**
 * Cursor offsets smaller than this steer nothing, in view pixels.
 *
 * A hand resting on a mouse is not still to the pixel, and without a dead
 * zone the ship would twitch a pixel left and right for as long as the cursor
 * sat on it. 10 view px is about 10 screen px at a 1440-wide window
 * (`viewForStage` gives zoom 1 there) — under the width of a cursor arrow,
 * over any tremor. Kept well under the range so the proportional band still
 * covers 92% of its travel.
 */
export const MOUSE_DEAD_ZONE = 10;

/**
 * THE POINTER THROTTLE IS BINARY, and the brake is a DRAG, not a place.
 *
 * The owner, after playing on a phone, verbatim: "clicking on the screen
 * makes the ship slow down (if the click is behind the ship), should
 * literally be binary, click to go faster or youre decelerating so a little
 * like flappy bird in a sense, but letting go shouldnt slow down the ship but
 * go back to base line speed, so to slow dowh the ship you need to click and
 * drag backwards".
 *
 * Three positions on the one axis `World` reads warp from, for the finger and
 * the mouse button alike:
 *
 *   pressed                → +1, the forward stop (hold `WARP_ARM` to warp)
 *   released               →  0, cruise — the baseline, NOT the back stop
 *   pressed + dragged back → -1, the back stop (hold `WARP_DROP` to leave warp)
 *
 * "Dragged back" is measured from where the PRESS STARTED, in view px, along
 * the screen's y — the ship flies up the screen, so backwards is +y. Where
 * the press landed relative to the ship is irrelevant: a press behind the
 * ship is a boost like any other press. That is the whole of the phone bug —
 * the touch layer steered toward the finger in y as well as x, so a thumb
 * resting below the ship (where a thumb rests) was read as "pull back", and a
 * player who had never been told the ship could slow down found it slowing
 * down whenever they touched the screen.
 *
 * TWO LINES, NOT ONE. A finger held near a single threshold crosses it every
 * few frames — a thumb is not still to the pixel — and the throttle would
 * chatter between +1 and -1, which zeroes BOTH warp timers on every crossing
 * (`updateWarp` spends the charge whenever the stop is left). So the brake
 * engages past ENGAGE and only lets go under RELEASE: a 20 px band the
 * gesture has to be deliberately reversed across. Dragging forward again past
 * RELEASE returns to boost while still pressed; lifting returns to cruise.
 *
 * CHOSEN, NOT MEASURED — the phone is in the owner's hand, not on this desk.
 * 40 view px is about 40 screen px at a 1440-wide window (`viewForStage` gives
 * zoom 1 there) and around 6 mm on a phone: past any tremor, past the wobble
 * of a thumb pressing harder, and under the ~80 px a thumb covers in a
 * deliberate flick. RELEASE at half of it so the band is wide enough that
 * hunting on the line is impossible and narrow enough that "drag back a bit
 * less" still reads as "stop braking". View px rather than screen px so the
 * feel does not change with the window, the same reasoning as
 * `MOUSE_STEER_RANGE`; `main.ts` hands both devices the y from the same
 * `toView` the offer's hit test uses. When someone flies it and reports the
 * brake as too eager or too far, these are the two numbers to move.
 *
 * REJECTED: a brake ZONE — "the bottom fifth of the screen brakes". It reads
 * position, and position is exactly what the owner said should not matter;
 * a thumb that lives at the bottom of a phone screen would brake by default.
 * REJECTED: a velocity gesture (a fast flick back). A hold is a state a
 * player can see on the gauge; a flick is an edge they have to have noticed.
 */
export const BRAKE_DRAG_ENGAGE = 40;
/** See `BRAKE_DRAG_ENGAGE`: the drag, in view px, under which the brake lets go. */
export const BRAKE_DRAG_RELEASE = 20;

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
   * Touch steering: the finger's WORLD x, or null while no finger is down.
   *
   * The game is shared as a link, and a link opened on a phone was completely
   * unplayable — there is no keyboard. Dragging anywhere on the playfield
   * steers the ship toward the finger, which is the convention every mobile
   * shmup uses because it keeps the ship visible instead of under your thumb.
   *
   * X ONLY. This was a point, `{x, y}`, and the ship was steered toward it in
   * both axes — so a thumb resting below the ship, which is where a thumb
   * rests, pulled the ship backwards, and that is the bug the owner reported
   * from a phone ("clicking on the screen makes the ship slow down (if the
   * click is behind the ship)"). The fore-and-aft axis now belongs to the
   * pointer throttle below, for the finger and the mouse alike; the finger's
   * vertical position steers nothing. World space, compared with `shipX`,
   * exactly as before: the finger sends a `pointermove` whenever it moves,
   * unlike a still mouse, so the camera-pan staleness that pushed the cursor
   * into view space (`MOUSE_STEER_RANGE`) has not been measured here.
   */
  private pointerTargetX: number | null = null;
  private pointerFiring = false;
  /** True once any touch has been seen, so the UI can adapt. */
  touchActive = false;

  setPointerTarget(x: number | null): void {
    if (x === null) {
      this.pointerTargetX = null;
      this.pointerFiring = false;
      return;
    }
    this.touchActive = true;
    this.pointerTargetX = x;
    this.pointerFiring = true;
  }

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
   * THE MOUSE STEER. "holding left or right to turn wth mouse."
   *
   * Two pieces of state, both written by `main.ts`'s pointer handlers and
   * READ here in `sample()` — the same shape as `pointerTargetX`, so the
   * per-step contract on `sample()` (idempotent for held state) holds for the
   * mouse for free: nothing here is an edge.
   *
   * ENGAGED is the piece that keeps this from being a regression for everyone
   * else. Before the first mouse-button press on the field during a run the
   * mouse is exactly as inert as it was — a keyboard player who never clicks
   * never meets this, and a mouse resting on the desk cannot steer. Once
   * engaged it stays engaged for the run: `main.ts` only forwards the button
   * to the pointer throttle below while engaged, and the cursor only steers
   * while engaged, so the one decision is made once, on the deliberate click.
   * `main.ts` resets it in `startRun`.
   *
   * X is the cursor in VIEW space (see `MOUSE_STEER_RANGE` for why not world
   * space), or null while it is off the stage. Only the horizontal offset
   * from the ship is read ("holding left or right to turn"); the vertical is
   * the brake gesture's axis and belongs to the pointer throttle.
   *
   * There used to be a HELD here — the button as a two-position throttle,
   * down the forward stop and UP THE BACK STOP, on "not clicking should
   * decelerate". It lasted a day. The owner, from a phone: "letting go
   * shouldnt slow down the ship but go back to base line speed, so to slow
   * dowh the ship you need to click and drag backwards". The button is now
   * one pressure on the shared pointer throttle below, and the engagement
   * argument that depended on the scheme having "no neutral" is gone with it:
   * released IS the neutral.
   */
  private mouseEngaged = false;
  private mouseX: number | null = null;

  /** True once a mouse click on the field has taken the ship this run. */
  get mouseActive(): boolean {
    return this.mouseEngaged;
  }

  /** The deliberate act: the first primary-button press on the field, at view x. */
  engageMouse(viewX: number): void {
    this.mouseEngaged = true;
    this.mouseX = viewX;
  }

  /** The cursor's view x, or null when it has left the stage. */
  setMouseX(viewX: number | null): void {
    this.mouseX = viewX;
  }

  /*
   * THE POINTER THROTTLE — one state for the finger and the mouse button.
   * See `BRAKE_DRAG_ENGAGE` for the rule and the owner's words.
   *
   * Pressed is +1, released is 0, pressed-and-dragged-back is -1. `main.ts`
   * feeds it from both device paths, in VIEW px along the screen's y (the
   * mouse path already converted through `toView`; the touch path now does
   * the same for this axis while its x steer stays in world space). The
   * flags are LEVEL state, like a held key, and the brake's hysteresis is
   * evaluated in `sample()` against the latest drag rather than in the
   * setters — so it is decided at the same cadence as everything else that
   * reads it, and a burst of `pointermove`s between two steps that crosses
   * the line and comes back is read as where the finger IS, not as a brake
   * that engaged and released unseen.
   *
   * Kept apart from `touchActive` on purpose: the mouse presses this and must
   * never flip the UI's touch switch; only `setPointerTarget` does that.
   */
  private pointerDown = false;
  /** View y where the current press began; the brake is measured from here. */
  private pointerPressY = 0;
  /** View y the pointer was last seen at during the current press. */
  private pointerLatestY = 0;
  /** The hysteresis state: true between crossing ENGAGE and re-crossing RELEASE. */
  private pointerBraking = false;

  /** True while a finger or the primary button is down on the field. */
  get pointerPressed(): boolean {
    return this.pointerDown;
  }

  /**
   * A press begins at view y. A second press without a release in between (a
   * second finger) RESTARTS the gesture from the new point: the newest
   * contact owns the throttle, and its drag is measured from where it landed.
   */
  pressPointer(viewY: number): void {
    this.pointerDown = true;
    this.pointerPressY = viewY;
    this.pointerLatestY = viewY;
    this.pointerBraking = false;
  }

  /** The pressed pointer moved to view y. Ignored when nothing is pressed. */
  dragPointer(viewY: number): void {
    if (this.pointerDown) this.pointerLatestY = viewY;
  }

  /** The finger lifted or the button let go: back to cruise, brake forgotten. */
  releasePointer(): void {
    this.pointerDown = false;
    this.pointerBraking = false;
  }

  /**
   * A new run: the mouse is inert again until it is clicked, no pointer is
   * pressed, and no finger is steering. `touchActive` is deliberately kept —
   * it is the UI's memory that this is a touch device, not run state.
   */
  resetPointer(): void {
    this.mouseEngaged = false;
    this.mouseX = null;
    this.releasePointer();
    this.setPointerTarget(null);
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
  };

  /** Set by the HUD when a card is clicked or tapped; drained by `sample()`. */
  pointerChoice = -1;
  pointerBanish = -1;
  pointerReroll = false;
  pointerSkip = false;

  /**
   * The ship's world x, so pointer steering knows where it is. There was a
   * `shipY` beside it; it went with the touch layer's vertical steer, since
   * nothing here reads the ship's y any more and a field nobody reads is a
   * promise nobody keeps.
   */
  shipX = 450;
  /**
   * The camera's left edge, in world px, so the mouse cursor — held in VIEW
   * space — can be compared with the ship, which is in world space. Set by
   * `main.ts` every step beside `shipX`; the touch target does not need it
   * because it is stored in world space and compared there.
   */
  viewX = 0;

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

    /** A fore-or-aft key is down, so the keyboard owns the throttle this step. */
    let keyThrottle = false;
    for (const code of this.down) {
      const v = MOVE_KEYS[code];
      if (v) {
        x += v[0];
        y += v[1];
        if (v[1] !== 0) keyThrottle = true;
      }
    }

    /*
     * POINTER STEERING IS HORIZONTAL ONLY, for the finger and the cursor.
     *
     * The finger: toward its world x, easing off over the last 46 px so the
     * ship settles under it instead of jittering around it, dead inside 3 px.
     * This is the old two-axis steer with its y term deleted — "clicking on
     * the screen makes the ship slow down (if the click is behind the ship)"
     * was that y term, and nothing else. The cursor: proportional to the
     * horizontal gap up to `MOUSE_STEER_RANGE`, dead inside `MOUSE_DEAD_ZONE`,
     * and null — steer 0 — while it is off the stage: a pointer that has left
     * the window is not pointing at anything, and the last x it was seen at
     * is a guess about the player's intent that would keep the ship turning
     * toward a wall. The cursor is compared against the ship's VIEW position
     * so a panning camera cannot leave a still cursor pointing at a stale
     * world x; the finger is compared in world space, see `pointerTargetX`.
     *
     * A/D ADD to either and the sum is CLAMPED, before the normalise below.
     * The normalise alone would not do: it scales x and y together, so D held
     * on top of a full-lock cursor would push x to 2 and come out of the
     * hypot as a MORE lateral heading than full lock — the steer is a
     * position, not a sum, for the same reason the throttle is. The clamp is
     * unconditional now that two pointer sources exist; for the keyboard
     * alone it only ever touches ArrowLeft-plus-A, which read -2 and came out
     * of the hypot at -1 anyway.
     */
    if (this.pointerTargetX !== null) {
      const dx = this.pointerTargetX - this.shipX;
      const d = Math.abs(dx);
      if (d > 3) x += Math.sign(dx) * Math.min(1, d / 46);
    }
    if (this.mouseEngaged && this.mouseX !== null) {
      const dx = this.mouseX - (this.shipX - this.viewX);
      if (Math.abs(dx) > MOUSE_DEAD_ZONE) x += Math.max(-1, Math.min(1, dx / MOUSE_STEER_RANGE));
    }
    x = Math.max(-1, Math.min(1, x));

    /*
     * THE POINTER IS THE THROTTLE, and the keys win while one is down.
     *
     * Pressed is the forward stop, released is CRUISE, and pressed-and-
     * dragged-back is the back stop — see `BRAKE_DRAG_ENGAGE` for the rule
     * and the owner's words. The brake's hysteresis is decided here, once per
     * step, on the drag since the press began: engage past ENGAGE, let go
     * under RELEASE, hold the current answer in between. `main.ts` only feeds
     * the mouse button in here while the mouse is engaged, so before the
     * first click on the field the mouse is as inert as it ever was.
     *
     * W/S/arrows override the pointer for as long as they are held, so a
     * player who reaches for the keyboard mid-fight gets the keyboard, and
     * the pointer resumes the instant they let go. `y` is the screen axis
     * here (-1 is up the screen, i.e. forward), which is why +1 on the
     * throttle is `y -= 1`.
     */
    if (this.pointerDown) {
      const drag = this.pointerLatestY - this.pointerPressY;
      if (this.pointerBraking ? drag < BRAKE_DRAG_RELEASE : drag > BRAKE_DRAG_ENGAGE) {
        this.pointerBraking = !this.pointerBraking;
      }
      if (!keyThrottle) y += this.pointerBraking ? 1 : -1;
    }

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
     * READ BEFORE THE NORMALISE, and that is the whole point of the field.
     *
     * See `InputState.throttle`. Every source that can push the ship forward
     * has added into `y` by this line — keys, d-pad, stick, and the pointer
     * throttle — and none of them has been scaled down yet by a lateral
     * component the player is also holding. Clamped, because two sources can
     * push the same axis at once — a d-pad and a stick, or a key and a pad —
     * and the throttle is a position, not a sum.
     */
    const throttle = Math.max(-1, Math.min(1, -y));

    // Normalise so diagonals are not faster than cardinals.
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    this.state.x = x;
    this.state.y = y;
    this.state.throttle = throttle;
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
