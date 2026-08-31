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
   * the d-pad and the touch layer's steering vector all push this axis and all
   * should be able to warp; a key-code test would have made warp a
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
   * Touch/pointer steering.
   *
   * The game is shared as a link, and a link opened on a phone was completely
   * unplayable — there is no keyboard. Dragging anywhere on the playfield steers
   * the ship toward the finger, which is the convention every mobile shmup uses
   * because it keeps the ship visible instead of under your thumb.
   */
  private pointerTarget: { x: number; y: number } | null = null;
  private pointerFiring = false;
  /** True once any touch has been seen, so the UI can adapt. */
  touchActive = false;

  setPointerTarget(x: number | null, y = 0): void {
    if (x === null) {
      this.pointerTarget = null;
      this.pointerFiring = false;
      return;
    }
    this.touchActive = true;
    this.pointerTarget = { x, y };
    this.pointerFiring = true;
  }

  /** Momentary actions from on-screen buttons. */
  touchBomb = false;
  touchWell = false;
  touchFocus = false;

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
   *   also folds in pointer steering, which reads `shipX`/`shipY` and must be
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

  /** The ship's current position, so pointer steering knows where it is. */
  shipX = 450;
  shipY = 560;

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

    if (this.pointerTarget) {
      // Steer toward the finger, easing off as we arrive so the ship settles
      // instead of jittering around the target.
      const dx = this.pointerTarget.x - this.shipX;
      const dy = this.pointerTarget.y - this.shipY;
      const d = Math.hypot(dx, dy);
      if (d > 3) {
        const speed = Math.min(1, d / 46);
        x += (dx / d) * speed;
        y += (dy / d) * speed;
      }
    }
    for (const code of this.down) {
      const v = MOVE_KEYS[code];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }

    // Touch state first; the keyboard scan below ORs on top of it.
    let shoot = this.pointerFiring;
    let bomb = this.touchBomb;
    let focus = this.touchFocus;
    let well = this.touchWell;
    this.touchBomb = false;
    this.touchWell = false;
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
    let openOffers = false;
    this.pointerChoice = -1;
    this.pointerBanish = -1;
    this.pointerReroll = false;
    this.pointerSkip = false;
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
     * See `InputState.warp`. Every source that can push the ship forward has
     * added into `y` by this line — keys, d-pad, stick, and the touch layer's
     * steering vector — and none of them has been scaled down yet by a lateral
     * component the player is also holding. Clamped, because two sources can
     * push the same axis at once — a d-pad and a stick, or a key and a finger —
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
