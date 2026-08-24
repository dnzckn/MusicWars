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
   */
  /** 0-3, or -1 for no card chosen this frame. */
  choice: number;
  /** 0-3, or -1. Shift + the same digit. */
  banish: number;
  reroll: boolean;
  skip: boolean;
}

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
  /** Keys pressed since the last `endFrame()`, for edge-triggered actions. */
  private pressed = new Set<string>();
  private gamepadIndex: number | null = null;

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

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  anyPressed(): boolean {
    return this.pressed.size > 0;
  }

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
    // Edge-triggered: a well is a decision, not something you hold down.
    for (const code of this.pressed) if (WELL_KEYS.has(code)) well = true;

    // Offer controls, likewise edge-triggered. Shift is the focus key, which is
    // free while an offer is open — the ship is barely moving and there is
    // nothing to focus on — so it doubles as the banish modifier rather than
    // spending four more keys on a screen that appears for two seconds.
    let choice = this.pointerChoice;
    let banish = this.pointerBanish;
    let reroll = this.pointerReroll;
    let skip = this.pointerSkip;
    this.pointerChoice = -1;
    this.pointerBanish = -1;
    this.pointerReroll = false;
    this.pointerSkip = false;
    const shifted = this.down.has('ShiftLeft') || this.down.has('ShiftRight');
    for (const code of this.pressed) {
      const card = CHOICE_KEYS[code];
      if (card !== undefined) {
        if (shifted) banish = card;
        else choice = card;
      }
      if (REROLL_KEYS.has(code)) reroll = true;
      if (SKIP_KEYS.has(code)) skip = true;
    }

    const pad = this.gamepadIndex !== null ? navigator.getGamepads?.()[this.gamepadIndex] : null;
    if (pad) {
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
      well ||= !!pad.buttons[1]?.pressed;
      focus ||= !!(pad.buttons[6]?.pressed || pad.buttons[7]?.pressed);
    }

    // Normalise so diagonals are not faster than cardinals.
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    this.state.x = x;
    this.state.y = y;
    this.state.shoot = shoot;
    this.state.bomb = bomb;
    this.state.focus = focus;
    this.state.well = well;
    this.state.choice = choice;
    this.state.banish = banish;
    this.state.reroll = reroll;
    this.state.skip = skip;
    return this.state;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
