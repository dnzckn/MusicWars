/**
 * inputcheck — one keypress must produce exactly one edge-triggered action,
 * whatever the monitor is doing.
 *
 * THE DEFECT THIS EXISTS FOR. `src/core/loop.ts` is a fixed-timestep loop:
 * `FIXED_DT` is 1/120 s, and each animation frame it runs
 * `while (accumulator >= FIXED_DT && steps < MAX_STEPS) hooks.update(FIXED_DT)`
 * and then `hooks.render(...)` once. So the number of simulation steps per
 * displayed frame is `refreshRate`-dependent: 4 at 30 Hz, 2 at 60 Hz, 1 at
 * 120 Hz, and — the case nobody thought about — **0 on some frames above
 * 120 Hz**.
 *
 * `main.ts` used to call `input.sample()` from `update` and `input.endFrame()`
 * from `render`. `endFrame()` cleared the `pressed` set that carries the
 * edge-triggered actions (well, the four offer cards, banish, reroll, skip).
 * Both halves of that arrangement were wrong, in opposite directions:
 *
 * Measured on the real `Input` and the real `Loop` before the fix — one tap of
 * the black-hole key per displayed frame, 3000 frames per rate, so the
 * denominator is 3000 presses in every row:
 *
 *   30 Hz   4.000 steps/frame   11999 wells for 3000 presses   4.000 per press
 *   60 Hz   2.000 steps/frame    5999 wells                    2.000 per press
 *  120 Hz   1.000 steps/frame    2999 wells                    1.000 per press
 *  144 Hz   0.833 steps/frame    2500 wells                    16.7% lost
 *  240 Hz   0.500 steps/frame    1499 wells                    50.0% lost
 *
 *   - Below 120 Hz every simulation step in the frame saw the same edge still
 *     set, so ONE tap spent two wells at 60 Hz and four at 30 Hz.
 *   - Above 120 Hz a frame can run zero steps. `render` still ran, so
 *     `endFrame()` cleared the edge before any `sample()` had ever looked at
 *     it and the press was silently DROPPED. 500 of 3000 at 144 Hz, 1501 of
 *     3000 at 240 Hz.
 *   - 120 Hz was right only by luck. Float drift in the accumulator still
 *     produced 6 zero-step frames in 3000, and those 6 presses were lost too.
 *
 * WHAT THIS TOOL ASSERTS, and why it is shaped the way it is.
 *
 * It drives the REAL `Input` and the REAL `Loop`. That matters more than usual
 * here: the whole bug lives in the arithmetic relating `FIXED_DT`, `MAX_STEPS`
 * and the frame delta, and a tool holding its own copy of that arithmetic
 * would keep passing the day someone changed `FIXED_DT`. `MAX_STEPS` is not
 * even exported — the only way to be sure of it is to run the real loop. So
 * `Loop` is driven through stubbed `requestAnimationFrame`/`performance.now`
 * with a virtual clock, which is exact and takes milliseconds.
 *
 * The one thing it must model rather than import is `main.ts`'s hook wiring,
 * because `main.ts` cannot be imported outside a browser. That model is
 * `frameBoundary()` below, and check E re-reads `main.ts` to confirm the model
 * still matches the file.
 *
 * Check A is deliberately loop-free: it calls `sample()` by hand N times for
 * N = 0..10 and asserts the edge is reported exactly once. That is the
 * `Input` contract stated without reference to any loop at all, so it survives
 * a rewrite of `loop.ts` and it covers step counts no real refresh rate
 * produces.
 *
 *   node --experimental-transform-types tools/inputcheck.mjs
 */

// ---------------------------------------------------------------------------
// Browser globals. `Input` listens on `window` and polls `navigator`; `Loop`
// wants `requestAnimationFrame` and `performance.now`. All four are stubs with
// a virtual clock, so the whole run is deterministic and instant.
// ---------------------------------------------------------------------------
const win = new EventTarget();
/*
 * Every `new Input(win)` below adds three listeners and there is no
 * `destroy()` to take them off again — a browser throws the whole `Input`
 * away with the page, so the class has never needed one. Node's EventTarget
 * warns past ten, which here is noise, not a leak.
 */
const { setMaxListeners } = await import('node:events');
setMaxListeners(0, win);
Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });

/** Gamepad buttons, indexed as the browser indexes them. Driven by check D. */
let padButtons = null;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  writable: true,
  value: {
    getGamepads: () =>
      padButtons ? [{ axes: [0, 0], buttons: padButtons.map((pressed) => ({ pressed })) }] : [null],
  },
});

let clockMs = 0;
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  writable: true,
  value: { now: () => clockMs },
});

let rafPending = null;
globalThis.requestAnimationFrame = (cb) => {
  rafPending = cb;
  return 1;
};
globalThis.cancelAnimationFrame = () => {
  rafPending = null;
};

const { Input } = await import('../src/core/input.ts');
const { Loop, FIXED_DT } = await import('../src/core/loop.ts');

// ---------------------------------------------------------------------------
// Synthetic key events. A real browser delivers keydown BETWEEN animation
// frames, never in the middle of one, and that timing is the whole story here
// — so every press below is dispatched before a frame is run, not during it.
// ---------------------------------------------------------------------------
function keydown(code, { repeat = false, shift = false } = {}) {
  if (shift) keyRaw('keydown', 'ShiftLeft');
  keyRaw('keydown', code, repeat);
}
function keyup(code, { shift = false } = {}) {
  keyRaw('keyup', code);
  if (shift) keyRaw('keyup', 'ShiftLeft');
}
function keyRaw(type, code, repeat = false) {
  const ev = new Event(type);
  ev.code = code;
  ev.repeat = repeat;
  win.dispatchEvent(ev);
}
/** A tap: down and up with no frame in between, which is what a fast press is. */
function tap(code, opts) {
  keydown(code, opts);
  keyup(code, opts);
}

/**
 * What `main.ts`'s `render` hook does to the input each frame.
 *
 * The fix removed `Input.endFrame()` outright, so on fixed code this is a
 * no-op — which is exactly the point. It is written as a feature test rather
 * than deleted so that this gate can be pointed at the PRE-fix shape of
 * `input.ts` and be watched going red; a gate that cannot be run against the
 * defect it describes is a gate nobody has seen fail.
 *
 * It must never call `discardEdges()`. That method exists for the branch of
 * `update` that does not simulate (paused, title screen, audio suspended) and
 * calling it once per frame regardless would rebuild the 144 Hz half of the
 * bug precisely.
 */
function frameBoundary(input) {
  if (typeof input.endFrame === 'function') input.endFrame();
}

const failures = [];
function check(ok, line) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${line}`);
  if (!ok) failures.push(line);
}

// ---------------------------------------------------------------------------
// A. The contract, with no loop involved: N sample() calls, one press, one
//    report — for every N from 0 to 10, including the 0 that only exists above
//    120 Hz and the 8 that is `MAX_STEPS`.
// ---------------------------------------------------------------------------
console.log('\nINPUTCHECK — one press, one action, at any refresh rate\n');
console.log('A. sample() called N times per frame, one press per frame (no Loop, pure contract)');
{
  let pressesA = 0;
  const PRESSES = 50;
  for (let steps = 0; steps <= 10; steps++) {
    const input = new Input(win);
    let fired = 0;
    let late = 0;
    for (let p = 0; p < PRESSES; p++) {
      tap('KeyC'); // black hole: the edge action with the most obvious cost
      for (let s = 0; s < steps; s++) if (input.sample().well) fired++;
      frameBoundary(input);
      /*
       * Then one more frame, running a single step and making no new press.
       *
       * A press made on a frame that ran ZERO steps has not been delivered yet
       * and must not have been thrown away — it is allowed to arrive one frame
       * late, and above 120 Hz that is the normal case, not an error. Giving
       * every N the same follow-up frame keeps the assertion a flat "exactly
       * one" instead of a table of expected counts.
       *
       * It also stops the measurement lying to itself: `pressed` is a Set keyed
       * by key code, so two undelivered presses of the same key genuinely
       * collapse into one action. Pressing again before the previous press has
       * been consumed would count two presses and one firing and report a bug
       * that is really the harness pressing faster than 4 ms.
       */
      if (input.sample().well) {
        fired++;
        late++;
      }
      frameBoundary(input);
      pressesA++;
    }
    check(
      fired === PRESSES,
      `${String(steps).padStart(2)} step${steps === 1 ? ' ' : 's'}/frame: ` +
        `well fired ${fired}/${PRESSES} presses` +
        (late ? ` (${late} arrived on the following frame)` : ''),
    );
  }
  check(pressesA === 11 * PRESSES, `presses examined: ${pressesA} (denominator, must be non-zero)`);
}

// ---------------------------------------------------------------------------
// B. The real Loop at real refresh rates. This is the integration half: it
//    reproduces `main.ts`'s two hooks and lets `loop.ts` decide how many
//    simulation steps each frame gets.
// ---------------------------------------------------------------------------
console.log('\nB. real Loop, real Input, black-hole key tapped between frames');
{
  const RATES = [30, 50, 60, 72, 100, 120, 144, 165, 240, 360];
  const FRAMES = 900;
  /*
   * A press is allowed to be delivered on the frame it was made or on a later
   * one — above 120 Hz "later" is unavoidable. After this many frames with no
   * delivery it is not late, it is gone.
   */
  const LATE_LIMIT = 4;
  let totalPresses = 0;

  for (const hz of RATES) {
    clockMs = 0;
    rafPending = null;
    const input = new Input(win);
    /** Frames since the outstanding press was made; -1 when nothing is pending. */
    let waiting = -1;
    let presses = 0;
    let fired = 0;
    let lost = 0;
    let steps = 0;
    let frameFired = 0;
    const perFrame = new Map(); // firings within one frame -> how many frames

    const loop = new Loop({
      update() {
        steps++;
        if (input.sample().well) {
          fired++;
          frameFired++;
          waiting = -1;
        }
      },
      render() {
        frameBoundary(input);
      },
    });

    loop.start();
    const frameMs = 1000 / hz;
    for (let f = 0; f < FRAMES; f++) {
      /*
       * Only ever ONE press outstanding. Two undelivered presses of the same
       * key collapse in the `pressed` Set — see the note in check A — so
       * pressing again before the last one landed would measure the Set, not
       * the loop. Waiting for delivery instead means every press in the
       * denominator is a press whose fate is unambiguous.
       */
      if (waiting < 0) {
        tap('KeyC');
        presses++;
        waiting = 0;
      } else if (waiting > LATE_LIMIT) {
        lost++;
        tap('KeyC');
        presses++;
        waiting = 0;
      }
      frameFired = 0;
      clockMs += frameMs;
      rafPending(clockMs); // the browser's next animation frame
      perFrame.set(frameFired, (perFrame.get(frameFired) ?? 0) + 1);
      if (waiting >= 0) waiting++;
    }
    // Drain: LATE_LIMIT more frames with no new press, so a press made on the
    // last frame is not scored as lost merely because the run ended.
    for (let f = 0; f <= LATE_LIMIT; f++) {
      clockMs += frameMs;
      rafPending(clockMs);
    }
    if (waiting >= 0) lost++;
    loop.stop();
    totalPresses += presses;

    const spf = (steps / FRAMES).toFixed(2);
    const shape = [...perFrame.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, c]) => `${n}x:${c}`)
      .join(' ');
    check(
      fired === presses && lost === 0 && presses > 0,
      `${String(hz).padStart(3)} Hz: ${steps} steps / ${FRAMES} frames (${spf} per frame) — ` +
        `wells thrown ${fired} for ${presses} presses, ${lost} lost ` +
        `[firings per frame ${shape}]`,
    );
  }
  check(totalPresses > 0, `presses examined across all rates: ${totalPresses} (denominator)`);
}

// ---------------------------------------------------------------------------
// C. Held keys must keep working. The fix makes the EDGE set one-shot; the
//    level-triggered actions read `down` and must be unaffected, or the ship
//    stops moving and focus stops focusing.
// ---------------------------------------------------------------------------
console.log('\nC. held keys stay held across every step of every frame');
{
  const input = new Input(win);
  keydown('KeyZ'); // shoot
  keydown('KeyL'); // focus (Shift also focuses, but Shift is the banish modifier)
  keydown('KeyD'); // move right
  keydown('KeyX'); // bomb — level-triggered from the keyboard, deliberately
  let shootOn = 0;
  let focusOn = 0;
  let moveOn = 0;
  let bombOn = 0;
  let wellOn = 0;
  const FRAMES = 200;
  const STEPS_PER_FRAME = 4; // the 30 Hz case: the most steps a real rate gives
  let samples = 0;
  for (let f = 0; f < FRAMES; f++) {
    for (let s = 0; s < STEPS_PER_FRAME; s++) {
      const st = input.sample();
      samples++;
      if (st.shoot) shootOn++;
      if (st.focus) focusOn++;
      if (st.x > 0.99) moveOn++;
      if (st.bomb) bombOn++;
      if (st.well) wellOn++;
    }
    frameBoundary(input);
  }
  check(shootOn === samples, `shoot held: true on ${shootOn}/${samples} samples`);
  check(focusOn === samples, `focus held: true on ${focusOn}/${samples} samples`);
  check(moveOn === samples, `move x=+1 held: true on ${moveOn}/${samples} samples`);
  check(bombOn === samples, `bomb held (level-triggered by design): true on ${bombOn}/${samples} samples`);
  /*
   * The other direction of the same rule: a key that is merely HELD must never
   * re-arm an edge action. `KeyC` went down once, several thousand samples
   * ago, and was consumed there.
   */
  keyup('KeyZ');
  keyup('KeyL');
  keyup('KeyD');
  keyup('KeyX');
  check(wellOn === 0, `held keys re-armed the well edge on ${wellOn}/${samples} samples (want 0)`);
}

// ---------------------------------------------------------------------------
// C2. The throttle axis, which is the input warp is entered on.
//
//     `InputState.throttle` is the fore-and-aft component BEFORE the diagonal
//     normalise, and `World` turns "held at a stop for 1.4s" into a mode. Two
//     things about it have to hold or the mode is unreachable or unstoppable,
//     and NEITHER is visible from `y`:
//
//       1. It is LEVEL-TRIGGERED, like shoot and focus. If it were one-shot the
//          hold could never accumulate and warp would be unenterable.
//       2. STEERING MUST NOT REDUCE IT. `y` is divided by `hypot(x, y)`, so
//          W+A gives y = -0.707 — under the 0.92 stop. Read off `y`, "hold W"
//          would silently mean "hold W and do not steer", in a mode whose whole
//          premise is more bodies to steer through. This is the assertion that
//          catches someone deleting the field and pointing `World` back at `y`.
// ---------------------------------------------------------------------------
console.log('\nC2. the throttle axis survives the diagonal normalise');
{
  const { WARP_STICK } = await import('../src/core/input.ts');
  const input = new Input(win);
  const SAMPLES = 240;

  keydown('KeyW');
  let fwd = 0;
  let yUnderStop = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const st = input.sample();
    if (st.throttle >= WARP_STICK) fwd++;
    if (-st.y < WARP_STICK) yUnderStop++;
    if (i % 4 === 3) frameBoundary(input);
  }
  check(fwd === SAMPLES, `W held: throttle at the forward stop on ${fwd}/${SAMPLES} samples`);
  check(yUnderStop === 0, `W alone: y also reaches the stop on ${SAMPLES - yUnderStop}/${SAMPLES} (the control — W alone is not a diagonal)`);

  // Now steer while holding it. This is the case `y` cannot answer.
  keydown('KeyA');
  let fwdDiag = 0;
  let yDiag = 0;
  let steered = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const st = input.sample();
    if (st.throttle >= WARP_STICK) fwdDiag++;
    if (-st.y >= WARP_STICK) yDiag++;
    if (st.x < -0.5) steered++;
    if (i % 4 === 3) frameBoundary(input);
  }
  check(steered === SAMPLES, `W+A: the ship is actually steering on ${steered}/${SAMPLES} samples (denominator)`);
  check(fwdDiag === SAMPLES, `W+A held: throttle STILL at the forward stop on ${fwdDiag}/${SAMPLES} samples`);
  check(
    yDiag === 0,
    `W+A: the normalised y reaches the stop on ${yDiag}/${SAMPLES} samples (want 0 — this is why throttle exists)`,
  );
  keyup('KeyW');
  keyup('KeyA');

  keydown('KeyS');
  let aft = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const st = input.sample();
    if (st.throttle <= -WARP_STICK) aft++;
    if (i % 4 === 3) frameBoundary(input);
  }
  check(aft === SAMPLES, `S held: throttle at the AFT stop on ${aft}/${SAMPLES} samples (the way out of warp)`);
  keyup('KeyS');

  let idle = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const st = input.sample();
    if (Math.abs(st.throttle) < 1e-9) idle++;
    if (i % 4 === 3) frameBoundary(input);
  }
  check(idle === SAMPLES, `nothing held: throttle is 0 on ${idle}/${SAMPLES} samples`);
}

// ---------------------------------------------------------------------------
// C3. The mouse scheme. "clicking should boost, not clicking should decelerate
//     then holding left or right to turn wth mouse."
//
//     `main.ts` writes three pieces of state (`engageMouse`, `setMouseHeld`,
//     `setMouseX`) and `sample()` folds them into the SAME axes the keys
//     drive, so nothing downstream — the flight model, warp, the gauge — knows
//     a mouse exists. What has to hold, none of it visible from the browser:
//
//       1. The button IS the throttle axis warp reads. Held is the forward
//          stop; released is the BACK stop, not zero ("not clicking should
//          decelerate"). A released button that read 0 would make the mouse a
//          boost key, and warp would be unleavable from it.
//       2. Before the click the mouse is INERT — a held button and an offset
//          cursor produce nothing — so a keyboard player is not regressed by a
//          mouse resting on the desk, and `resetMouse` (a new run) puts it back.
//       3. Keys win while held, and the mouse resumes when they let go.
//       4. The cursor's horizontal offset steers: proportional to the range,
//          clamped past it, dead near the ship, zero off the stage; A/D add to
//          it and the SUM is clamped. And the offset is taken from the ship's
//          VIEW position — the camera follows the ship across the track, and
//          a still cursor must keep pointing where it points.
//       5. Touch keeps its path and its UI switch (`touchActive`), and the
//          mouse path never flips that switch.
//
//     THE STEER IS READ BACK THROUGH THE NORMALISE, and this is the one piece
//     of arithmetic the check has to know. `x` is divided by `hypot(x, y)` when
//     that exceeds 1, and with the mouse engaged y is pinned at ±1 (by the
//     button or by a held key), so a full-lock cursor comes out as x = 0.707 —
//     the same number W+D gives, which is correct: a diagonal is not faster.
//     The pre-normalise steer is recovered as `x / |y|`, because both were
//     divided by the same length and |y| was exactly 1 before it. That makes
//     the clamp assertion real rather than satisfied by the normalise: an
//     UNCLAMPED D-plus-full-lock sum is (2, 1) → (0.894, 0.447) and reads 2
//     here, where the clamped (1, 1) → (0.707, 0.707) reads 1.
//
//     SEEN RED, per assertion, by mutating `src/core/input.ts` one defect at
//     a time and restoring it byte-identical (a scratch script, deleted;
//     2026-09-05). Eleven mutations, seventeen assertions, every one red at
//     least once, all at 0/240 unless noted:
//       - gate removed (`if (this.mouseEngaged)` → `if (true)`):
//           "not engaged … inert", "resetMouse (a new run)", and "touch drag
//           … x +1" — the un-engaged touch input inherited a mouse throttle
//       - throttle sign flipped (`mouseHeld ? -1 : 1` → `? 1 : -1`):
//           "button held … forward stop", "released … AFT",
//           "W let go … resumes", "cursor off the stage"
//       - `!keyThrottle` dropped: "W held over a released mouse",
//           "S held over a held button"
//       - range doubled: "cursor +120 … steer +1", "60 px left … -0.5", and
//           "A held plus a full-lock cursor" (0.5 - 1 is not 0)
//       - both clamps removed: "360 px right … clamped",
//           "D held plus a full-lock cursor" (reads 2, as predicted above)
//       - dead zone removed: "inside the 10 px dead zone"
//       - key x ignored while engaged: "A held plus a full-lock cursor", and
//           the dead zone again (the rewrite dropped it too)
//       - camera ignored (`shipX - viewX` → `shipX`): "camera panned … view
//           space, not world" — the defect the browser pass found first
//       - null check removed (null coerces to x = 0, i.e. 450 px left of the
//           ship): "cursor off the stage"
//       - `resetMouse` left `mouseEngaged` set: "resetMouse (a new run)"
//       - `engageMouse` set `touchActive`: "never set touchActive" (read true)
//       - `setPointerTarget` no longer set `touchActive`, and its `d > 3`
//           arrive test raised to 3000: "touch drag … x +1",
//           "touch drag set touchActive" (read false)
// ---------------------------------------------------------------------------
console.log('\nC3. the mouse scheme: the button is the throttle, the cursor side is the steer');
{
  const { MOUSE_STEER_RANGE, MOUSE_DEAD_ZONE, WARP_STICK } = await import('../src/core/input.ts');
  const SAMPLES = 240;
  /** Samples on which `pred` held, over SAMPLES steps at 4 per frame. */
  const run = (input, pred) => {
    let n = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const st = input.sample();
      if (pred(st)) n++;
      if (i % 4 === 3) frameBoundary(input);
    }
    return n;
  };
  /** The pre-normalise steer, recovered as described above. */
  const steerOf = (st) => (Math.abs(st.y) < 1e-9 ? st.x : st.x / Math.abs(st.y));
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const zero = (v) => Math.abs(v) < 1e-9;

  // 2. Inert before the click: everything set EXCEPT engagement.
  const idle = new Input(win);
  idle.setMouseHeld(true);
  idle.setMouseX(idle.shipX + MOUSE_STEER_RANGE);
  const inert = run(idle, (st) => zero(st.throttle) && zero(st.x));
  check(
    inert === SAMPLES,
    `not engaged: a held button and a cursor ${MOUSE_STEER_RANGE} px off are inert (throttle 0, x 0) on ${inert}/${SAMPLES}`,
  );

  // 1. The button is the throttle.
  const input = new Input(win);
  input.engageMouse(input.shipX); // the click, on the ship
  input.setMouseHeld(true);
  const fwd = run(input, (st) => st.throttle >= WARP_STICK);
  check(fwd === SAMPLES, `engaged, button held: throttle at the forward stop on ${fwd}/${SAMPLES} ("clicking should boost")`);
  input.setMouseHeld(false);
  const aft = run(input, (st) => st.throttle <= -WARP_STICK);
  check(aft === SAMPLES, `engaged, button released: throttle at the AFT stop on ${aft}/${SAMPLES} ("not clicking should decelerate")`);

  // 3. Keys win while held; the mouse resumes.
  keydown('KeyW');
  const wWins = run(input, (st) => st.throttle >= WARP_STICK);
  check(wWins === SAMPLES, `W held over a released mouse: throttle +1 on ${wWins}/${SAMPLES} (keys win)`);
  keyup('KeyW');
  const resumed = run(input, (st) => st.throttle <= -WARP_STICK);
  check(resumed === SAMPLES, `W let go: the mouse throttle resumes at -1 on ${resumed}/${SAMPLES}`);
  input.setMouseHeld(true);
  keydown('KeyS');
  const sWins = run(input, (st) => st.throttle <= -WARP_STICK);
  check(sWins === SAMPLES, `S held over a held button: throttle -1 on ${sWins}/${SAMPLES} (warp is still leavable from the keyboard)`);
  keyup('KeyS');

  // 4. The cursor side steers. Button released, so |y| = 1 from the mouse alone.
  input.setMouseHeld(false);
  input.setMouseX(input.shipX + MOUSE_STEER_RANGE);
  const full = run(input, (st) => near(steerOf(st), 1));
  check(full === SAMPLES, `cursor +${MOUSE_STEER_RANGE} px right of the ship: steer +1 on ${full}/${SAMPLES}`);
  input.setMouseX(input.shipX - MOUSE_STEER_RANGE / 2);
  const half = run(input, (st) => near(steerOf(st), -0.5));
  check(half === SAMPLES, `cursor ${MOUSE_STEER_RANGE / 2} px left: steer -0.5 on ${half}/${SAMPLES} (proportional)`);
  input.setMouseX(input.shipX + MOUSE_STEER_RANGE * 3);
  const far = run(input, (st) => near(steerOf(st), 1));
  check(far === SAMPLES, `cursor ${MOUSE_STEER_RANGE * 3} px right: steer clamped to +1 on ${far}/${SAMPLES}`);
  const inside = Math.floor(MOUSE_DEAD_ZONE * 0.9);
  input.setMouseX(input.shipX + inside);
  const dead = run(input, (st) => zero(st.x));
  check(dead === SAMPLES, `cursor ${inside} px right, inside the ${MOUSE_DEAD_ZONE} px dead zone: steer 0 on ${dead}/${SAMPLES}`);
  input.setMouseX(input.shipX + MOUSE_STEER_RANGE);
  keydown('KeyD');
  const summed = run(input, (st) => near(steerOf(st), 1));
  check(summed === SAMPLES, `D held plus a full-lock cursor right: steer 1 on ${summed}/${SAMPLES} (the sum is clamped; unclamped reads 2)`);
  keyup('KeyD');
  keydown('KeyA');
  const cancelled = run(input, (st) => zero(st.x));
  check(cancelled === SAMPLES, `A held plus a full-lock cursor right: steer 0 on ${cancelled}/${SAMPLES} (the key ADDS)`);
  keyup('KeyA');
  /*
   * THE CAMERA PANS AND THE CURSOR DOES NOT MOVE. The cursor is a VIEW x and
   * the ship a world x; with the camera's left edge at `viewX` the ship is
   * drawn at `shipX - viewX`, so a cursor sitting exactly on the ship's world
   * x is half a range to its RIGHT once the camera has panned half a range
   * left. Stored in world space (the first draft) this reads 0 — the ship
   * stopped 19 px short of a still cursor in the browser, because the camera
   * had followed it and the cursor's world x was the one from the last event.
   */
  input.setMouseX(input.shipX);
  input.viewX = MOUSE_STEER_RANGE / 2;
  const panned = run(input, (st) => near(steerOf(st), 0.5));
  check(panned === SAMPLES, `camera panned ${MOUSE_STEER_RANGE / 2} px with the cursor still: steer +0.5 on ${panned}/${SAMPLES} (view space, not world)`);
  input.viewX = 0;
  input.setMouseX(null);
  const left = run(input, (st) => zero(st.x) && st.throttle <= -WARP_STICK);
  check(left === SAMPLES, `cursor off the stage: steer 0 while the throttle stays at its stop on ${left}/${SAMPLES}`);

  // 2 again. A new run puts the mouse back to inert.
  input.setMouseX(input.shipX + MOUSE_STEER_RANGE);
  input.setMouseHeld(true);
  input.resetMouse();
  const reset = run(input, (st) => zero(st.throttle) && zero(st.x));
  check(reset === SAMPLES, `resetMouse (a new run): throttle 0, x 0 on ${reset}/${SAMPLES}`);

  // 5. The mouse never flips the UI's touch switch; touch still does, and still steers.
  check(input.touchActive === false, `the mouse path never set touchActive (want false): ${input.touchActive}`);
  const touch = new Input(win);
  touch.setPointerTarget(touch.shipX + 100, touch.shipY);
  const dragged = run(touch, (st) => st.x > 0.99 && st.shoot);
  check(dragged === SAMPLES, `touch drag 100 px right: x +1 and firing on ${dragged}/${SAMPLES} (unchanged)`);
  check(touch.touchActive === true, `touch drag set touchActive (want true): ${touch.touchActive}`);
}

// ---------------------------------------------------------------------------
// D. The other edge paths: the offer cards, and the gamepad.
// ---------------------------------------------------------------------------
console.log('\nD. the remaining edge actions, 2 steps per frame (the 60 Hz case)');
{
  const input = new Input(win);
  const PRESSES = 100;
  /**
   * One press, then the frame's two steps, then a third step standing in for
   * the next frame — the same shape as check A, for the same two reasons.
   *
   * Shift is held DOWN across the samples rather than tapped with the digit.
   * It has to be: `shifted` is read from the `down` set at sample time, not
   * from the edge set, so releasing it in the same instant as the digit (which
   * an earlier draft of this harness did) makes Shift+3 read as a plain 3 and
   * banish silently score 0/100. That is the harness being wrong about the
   * browser, not the game being wrong — a real player's shift is still down.
   */
  const count = (code, shift) => {
    const tally = { choice: 0, banish: 0, reroll: 0, skip: 0 };
    for (let p = 0; p < PRESSES; p++) {
      if (shift) keyRaw('keydown', 'ShiftLeft');
      tap(code);
      for (let s = 0; s < 3; s++) {
        const st = input.sample();
        if (st.choice >= 0) tally.choice++;
        if (st.banish >= 0) tally.banish++;
        if (st.reroll) tally.reroll++;
        if (st.skip) tally.skip++;
        if (s === 1) frameBoundary(input);
      }
      frameBoundary(input);
      if (shift) keyRaw('keyup', 'ShiftLeft');
    }
    return tally;
  };
  const c = count('Digit2', false);
  check(c.choice === PRESSES, `card choice fired ${c.choice}/${PRESSES} presses of Digit2`);
  check(c.banish === 0, `unshifted Digit2 did not banish: ${c.banish}/${PRESSES} (want 0)`);
  const b = count('Digit3', true);
  check(b.banish === PRESSES, `banish fired ${b.banish}/${PRESSES} presses of Shift+Digit3`);
  check(b.choice === 0, `Shift+Digit3 did not also take the card: ${b.choice}/${PRESSES} (want 0)`);
  const r = count('KeyR', false);
  check(r.reroll === PRESSES, `reroll fired ${r.reroll}/${PRESSES} presses of KeyR`);
  const q = count('KeyQ', false);
  check(q.skip === PRESSES, `skip fired ${q.skip}/${PRESSES} presses of KeyQ`);

  /*
   * The gamepad reaches the same actions by a completely different route: it
   * is POLLED inside `sample()`, so it never touches the `pressed` set and the
   * fix above does nothing for it. Holding the B button therefore used to
   * throw a black hole on every simulation step for as long as it was held —
   * the same defect, found while fixing the first one, arriving through the
   * other door. The pad's own edge detection lives in `input.ts` beside the
   * keyboard's.
   */
  const gp = new Input(win);
  const gcEv = new Event('gamepadconnected');
  gcEv.gamepad = { index: 0 };
  win.dispatchEvent(gcEv);
  const HOLD_FRAMES = 100;
  const STEPS = 2;
  let padWell = 0;
  let padBomb = 0;
  padButtons = [false, true, false]; // B held down for the whole run
  let padSamples = 0;
  for (let f = 0; f < HOLD_FRAMES; f++) {
    for (let s = 0; s < STEPS; s++) {
      const st = gp.sample();
      padSamples++;
      if (st.well) padWell++;
      if (st.bomb) padBomb++;
    }
    frameBoundary(gp);
  }
  padButtons = null;
  check(padWell === 1, `gamepad B held ${padSamples} samples: well fired ${padWell}x (want exactly 1)`);
  check(
    padBomb === 0,
    `gamepad B is not the bomb button: bomb fired ${padBomb}/${padSamples} samples (want 0)`,
  );
}

// ---------------------------------------------------------------------------
// E. The model in `frameBoundary()` above is a hand copy of `main.ts`'s hooks,
//    and a hand copy is exactly the thing that goes stale. This reads the file.
//    It is a source check and it knows it: it cannot see whether the input is
//    RIGHT, only whether the arrangement this whole tool assumes still holds.
// ---------------------------------------------------------------------------
console.log('\nE. main.ts still wires the hooks the way A–D assume');
{
  const { readFileSync } = await import('node:fs');
  /*
   * Comments are stripped first, and that is not a nicety. This file's own
   * house style is long explanatory comments, so the render hook now CONTAINS
   * the sentence "`input.endFrame()` used to be this line" — the first draft
   * of this check matched that and reported the bug it was reading the
   * gravestone of. Assert on code, not on prose that mentions the code.
   */
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const loopArg = src.slice(src.indexOf('new Loop({'));
  const renderAt = loopArg.indexOf('render(');
  const updateBody = loopArg.slice(0, renderAt);
  const renderBody = loopArg.slice(renderAt, loopArg.indexOf('\n});'));
  check(updateBody.includes('input.sample()'), 'update() hook samples the input');
  check(
    !/input\.(endFrame|discardEdges|clearEdges)\s*\(/.test(renderBody),
    'render() hook does not clear the edge set (that is the 144 Hz bug)',
  );
  check(
    /input\.discardEdges\s*\(/.test(updateBody),
    'update() hook discards edges on the branches where it does not simulate',
  );
}

console.log('');
if (failures.length) {
  console.log(`FAIL — ${failures.length} assertion${failures.length === 1 ? '' : 's'}:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log('ONE PRESS, ONE ACTION — at 30..360 Hz, and held keys still held\n');
