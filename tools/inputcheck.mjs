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
// C3. The pointer is a RELATIVE DRAG on both axes, it never touches the
//     throttle, and warp is a lever.
//
//     REPLACES the binary pointer throttle and the absolute steer. This block
//     had 29 assertions and a recorded 21-mutation red pass, and roughly half
//     of them asserted the OPPOSITE of what the game now does: "engaged,
//     pressed: throttle at the forward stop", "finger directly behind the
//     ship, pressed: throttle +1", "finger 100 px right, pressed: steer +1"
//     (a still finger, steering by position), and the whole BRAKE_DRAG
//     hysteresis ladder. Those did not fail — they encoded an assumption the
//     owner deliberately changed:
//
//       "clicking on the screen moves the ship forward it shouldn't do that,
//        only dragging moves the ship"
//
//     and, choosing between the ship following the pointer's POSITION or only
//     its MOVEMENT, they chose movement. So the assertions are REPLACED here
//     rather than relaxed or deleted, and the replacements are stronger: the
//     old block could not have caught a press that flew the ship, because it
//     required one.
//
//     `main.ts` writes `pressPointer(x, y, touch)` / `dragPointer(x, y)` /
//     `releasePointer()` from BOTH device paths in view px, and the warp
//     lever writes `input.warpLever`. What has to hold, none of it visible
//     from the browser:
//
//       - A PRESS THAT DOES NOT MOVE DOES NOTHING. Not a boost, not a steer,
//         not a warp charge. This is the headline and it is asserted first.
//       - The drag moves the ship by the DISTANCE dragged: the stick is the
//         remaining gap over DRAG_RANGE, so a gap of RANGE is full lock and
//         half a RANGE is half lock, on both axes.
//       - The drag NEVER writes `throttle`. If it did, dragging the ship
//         forward would arm warp 1.4 s later and the coupling the owner asked
//         to remove would be back through the other axis.
//       - The keys and the pad still own `throttle`, so the keyboard way into
//         warp is untouched and every stage assertion in `tools/warp.mjs`
//         still enters the mode it says it does.
//       - The target is LEASHED to the ship, so a drag into a wall cannot
//         wind up and leave the control unresponsive.
//       - Pressing re-bases; `rebaseDrag` re-bases without ending the
//         contact (the offer-open case); releasing clears.
//       - `warpLever` passes through, and NULL SURVIVES as null — null is
//         "no opinion" and 0 is "at the bottom", and collapsing the two would
//         drop every bot out of warp on its first step.
//
//     FAIL-TESTED by `tools/inputmutate.mjs`: twelve mutations of
//     `src/core/input.ts`, all twelve caught. THREE OF THEM CAUGHT NOTHING ON
//     THE FIRST PASS, and what they exposed is worth keeping:
//
//       - Doubling DRAG_RANGE reddened nothing, because every assertion here
//         dragged DRAG_RANGE and expected full lock — true of any value. A
//         check that imports the constant it is checking measures a ratio, not
//         a number. Fixed by asserting the band in LITERAL pixels (40 px is
//         full lock, 20 px is half) and the gain in literal pixels too (a 250
//         px drag is answered by 250 px of ship), so the two numbers a player
//         can feel are pinned independently of the source.
//       - Zeroing DRAG_DEAD reddened nothing for the same reason. Fixed with a
//         literal 2 px drift.
//       - Removing the clamp on the drag term reddened nothing, because BOTH
//         the clamp at the end of the steering block AND the diagonal
//         normalise hide an over-range term on their own. It is only visible
//         when a key pulls the other way: clamped, A plus a ten-range drag
//         cancels to 0; unclamped it reads 9, clamps to +1, and the ship turns
//         RIGHT while the player holds LEFT. That case is now asserted.
//
//     The mutation that reddens each assertion, after those fixes:
//       - press writes y again (`y += -1` on pointerDown): "a still press ...
//           throttle 0, x 0, y 0" and "a still press 700 px right"
//       - drag summed into `y` before the throttle read (`y += dragY` moved
//           above the read): "dragging forward ... throttle STILL 0"
//       - `DRAG_RANGE` doubled: "one RANGE ... +1", "half a RANGE ... -0.5",
//           "dragged UP one RANGE", "dragged DOWN one RANGE"
//       - `DRAG_DEAD` set to 0: "exactly 3 px (the dead zone) ... 0"
//       - the outer clamp removed: "ten RANGEs ... clamped to +1"
//       - the leash clamp removed: "leash: the ship catches the target"
//       - `pressPointer` stopped re-basing: "a second press re-bases"
//       - `rebaseDrag` made a no-op: "rebase under an open offer"
//       - `releasePointer` left the targets set: "lifted: x 0, y 0"
//       - `pressPointer` set touchActive for the mouse too: "the mouse path
//           never set touchActive"
//       - `warpLever` published as `?? 0`: "an untouched lever reads null"
//       - `resetPointer` left the lever set: "resetPointer clears the lever"
// ---------------------------------------------------------------------------
console.log('\nC3. the pointer is a relative drag; it never writes the throttle; warp is a lever');
{
  const { DRAG_RANGE, DRAG_DEAD, WARP_STICK } = await import('../src/core/input.ts');
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
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const zero = (v) => Math.abs(v) < 1e-9;
  const cruise = (st) => zero(st.throttle);
  /** A press point, in view px. Nothing about it should matter any more. */
  const PX = 400;
  const PY = 300;

  // ---- 1. THE HEADLINE: a press that does not move does nothing. ----------
  const still = new Input(win);
  still.engageMouse();
  still.pressPointer(PX, PY);
  const inert = run(still, (st) => cruise(st) && zero(st.x) && zero(st.y));
  check(
    inert === SAMPLES,
    `a still press: throttle 0, x 0, y 0 on ${inert}/${SAMPLES} ("clicking on the screen moves the ship forward it shouldn't do that")`,
  );
  // Where it landed is irrelevant — it was already irrelevant, and it stays so
  // for the opposite reason: not "a press behind the ship is still a boost"
  // but "a press behind the ship is still nothing".
  still.releasePointer();
  still.pressPointer(PX + 700, PY + 600);
  const inertFar = run(still, (st) => cruise(st) && zero(st.x) && zero(st.y));
  check(
    inertFar === SAMPLES,
    `a still press 700 px right and 600 px below the ship: still nothing on ${inertFar}/${SAMPLES} (position at press time is irrelevant)`,
  );
  still.releasePointer();

  // ---- 2. The drag, on both axes, proportional to the gap. ----------------
  const input = new Input(win);
  input.engageMouse();
  /** Press and drag by exactly dx,dy view px, from a fresh re-based press. */
  const drag = (dx, dy) => {
    input.pressPointer(PX, PY);
    input.dragPointer(PX + dx, PY + dy);
  };
  drag(DRAG_RANGE, 0);
  const fullRight = run(input, (st) => near(st.x, 1) && zero(st.y));
  check(fullRight === SAMPLES, `dragged right one RANGE (${DRAG_RANGE} px): steer +1, y 0 on ${fullRight}/${SAMPLES}`);
  drag(-DRAG_RANGE / 2, 0);
  const halfLeft = run(input, (st) => near(st.x, -0.5));
  check(halfLeft === SAMPLES, `dragged left half a RANGE: steer -0.5 on ${halfLeft}/${SAMPLES} (proportional to the gap)`);
  drag(DRAG_RANGE * 10, 0);
  const clamped = run(input, (st) => near(st.x, 1));
  check(clamped === SAMPLES, `dragged right ten RANGEs: steer clamped to +1 on ${clamped}/${SAMPLES}`);
  drag(DRAG_DEAD, 0);
  const dead = run(input, (st) => zero(st.x));
  check(dead === SAMPLES, `dragged right exactly ${DRAG_DEAD} px (the dead zone): steer 0 on ${dead}/${SAMPLES} (a thumb resting on glass is not still to the pixel)`);
  /*
   * THE GAIN, STATED IN LITERAL PIXELS AND NOT IN DRAG_RANGE.
   *
   * The three assertions above are RATIOS — they drag DRAG_RANGE and expect
   * full lock — so they are true for any value of DRAG_RANGE and cannot catch
   * a change to it. That was found by fail-testing: doubling the constant
   * reddened nothing. The property a player actually has is the GAIN, which is
   * a different statement: the ship travels AS FAR AS THE FINGER DID. It is
   * asserted here against a literal 250 px so nothing in the check can move
   * with the source.
   */
  /*
   * THE EASING BAND, IN LITERAL PIXELS. Same lesson as the gain: dragging
   * DRAG_RANGE and expecting full lock is true of every DRAG_RANGE. These two
   * pin the band itself, so widening it — which changes how sharply the ship
   * answers the last few pixels of a stroke — has to be a deliberate edit
   * here as well as in the source.
   */
  drag(40, 0);
  const band40 = run(input, (st) => near(st.x, 1));
  check(band40 === SAMPLES, `a 40 px gap is full lock on ${band40}/${SAMPLES} (literal: the band cannot widen without this failing)`);
  drag(20, 0);
  const band20 = run(input, (st) => near(st.x, 0.5));
  check(band20 === SAMPLES, `a 20 px gap is half lock on ${band20}/${SAMPLES}`);

  const g0 = input.shipX;
  drag(250, 0);
  input.sample();
  input.shipX = g0 + 250;
  const gainArrived = run(input, (st) => zero(st.x));
  check(gainArrived === SAMPLES, `gain: a 250 px drag is answered by 250 px of ship — steer 0 on ${gainArrived}/${SAMPLES} (1:1, and this is the one assertion here that does not move with DRAG_RANGE)`);
  input.shipX = g0 + 230;
  const gainShort = run(input, (st) => Math.abs(st.x) > 0.1);
  check(gainShort === SAMPLES, `gain: 20 px short of that, the ship is still pulling on ${gainShort}/${SAMPLES} (or the gain could be anything and the check above would still pass)`);
  input.shipX = g0;
  /*
   * A LITERAL TREMOR FLOOR, for the same reason: dragging exactly DRAG_DEAD is
   * true of any dead zone including none. A finger resting on glass drifts a
   * pixel or two, and that must steer nothing.
   */
  drag(2, 0);
  const tremor = run(input, (st) => zero(st.x));
  check(tremor === SAMPLES, `a 2 px drift steers nothing on ${tremor}/${SAMPLES} (literal, so a dead zone shrunk to nothing fails here)`);
  /*
   * THE CLAMP IS BEFORE THE NORMALISE, and only a DIAGONAL can tell. Dragging
   * ten ranges straight right reads +1 whether or not the clamp is there,
   * because the normalise divides a lone x=10 by its own hypot. Add a second
   * axis and the two differ: clamped gives (1, 0.5)/1.118; unclamped gives
   * (10, 0.5)/10.01, which is a ship that has stopped steering aft at all.
   */
  drag(DRAG_RANGE * 10, DRAG_RANGE / 2);
  const diag = run(input, (st) => near(st.x, 1 / Math.hypot(1, 0.5)) && near(st.y, 0.5 / Math.hypot(1, 0.5)));
  check(diag === SAMPLES, `a far diagonal drag is clamped BEFORE the normalise on ${diag}/${SAMPLES} (unclamped the aft component is divided away and the ship stops answering one axis)`);

  drag(0, -DRAG_RANGE);
  const fwdDrag = run(input, (st) => near(st.y, -1) && zero(st.x));
  check(fwdDrag === SAMPLES, `dragged UP one RANGE: y -1 (forward) on ${fwdDrag}/${SAMPLES} — the axis the press used to own`);
  drag(0, DRAG_RANGE);
  const aftDrag = run(input, (st) => near(st.y, 1));
  check(aftDrag === SAMPLES, `dragged DOWN one RANGE: y +1 (pull back) on ${aftDrag}/${SAMPLES} — this is the brake now, and it is the same gesture as everything else`);

  // ---- 3. THE SEPARATION: the drag must never reach the throttle. ---------
  drag(0, -DRAG_RANGE * 10);
  const noWarp = run(input, (st) => near(st.y, -1) && cruise(st));
  check(
    noWarp === SAMPLES,
    `dragging forward as hard as possible: y -1 but throttle STILL 0 on ${noWarp}/${SAMPLES} (or warp would arm off the steer and the coupling would be back)`,
  );
  drag(0, DRAG_RANGE * 10);
  const noWarpAft = run(input, (st) => near(st.y, 1) && cruise(st));
  check(noWarpAft === SAMPLES, `dragging back as hard as possible: throttle still 0 on ${noWarpAft}/${SAMPLES} (the aft stop drops warp; a drag must not)`);

  // ---- 4. The keyboard still owns the throttle, so warp still has a way in.
  input.releasePointer();
  keydown('KeyW');
  const wFwd = run(input, (st) => st.throttle >= WARP_STICK);
  check(wFwd === SAMPLES, `W held: throttle at the forward stop on ${wFwd}/${SAMPLES} (the keyboard way into warp is untouched)`);
  keyup('KeyW');
  keydown('KeyS');
  const sAft = run(input, (st) => st.throttle <= -WARP_STICK);
  check(sAft === SAMPLES, `S held: throttle at the aft stop on ${sAft}/${SAMPLES} (and the keyboard way out)`);
  keyup('KeyS');
  // A key and a drag on the same axis are summed and clamped, not fought over.
  keydown('KeyD');
  drag(DRAG_RANGE, 0);
  const summed = run(input, (st) => near(st.x, 1));
  check(summed === SAMPLES, `D held plus a full-lock drag right: steer 1 on ${summed}/${SAMPLES} (the sum is clamped; unclamped reads 2)`);
  keyup('KeyD');
  keydown('KeyA');
  const cancelled = run(input, (st) => zero(st.x));
  check(cancelled === SAMPLES, `A held plus a full-lock drag right: steer 0 on ${cancelled}/${SAMPLES} (the key ADDS, it does not win)`);
  /*
   * THE DRAG IS CLAMPED BEFORE THE KEY IS ADDED, and only this case can tell.
   * A lone drag of ten ranges reads +1 either way — the clamp at the end of
   * the block, and the diagonal normalise, both hide an unclamped term. Add a
   * key pulling the other way and they separate: clamped, -1 + 1 cancels to 0;
   * unclamped, -1 + 10 is 9, which clamps to +1 and the ship turns RIGHT while
   * the player holds LEFT.
   */
  drag(DRAG_RANGE * 10, 0);
  const cancelledFar = run(input, (st) => zero(st.x));
  check(cancelledFar === SAMPLES, `A held plus a TEN-range drag right: steer still 0 on ${cancelledFar}/${SAMPLES} (unclamped the drag overwhelms the key and the ship turns the wrong way)`);
  keyup('KeyA');

  // ---- 5. The ship closes the gap, and the leash bounds it. ---------------
  /*
   * The ship is what makes a drag finite: `main.ts` feeds its position back
   * every step, the gap shrinks as it travels, and the stick falls to 0 when
   * it arrives. Simulated here by moving `shipX` the way the flight model
   * would, because `Input` has no world.
   */
  input.releasePointer();
  const base = input.shipX;
  drag(DRAG_RANGE * 2, 0);
  input.sample();
  input.shipX = base + DRAG_RANGE * 2; // the ship arrives
  const arrived = run(input, (st) => zero(st.x));
  check(arrived === SAMPLES, `the ship reaches the point it was dragged to: steer back to 0 on ${arrived}/${SAMPLES} (a drag is a distance, not a direction held)`);
  input.shipX = base;
  /*
   * THE REACHABLE BOX, REPLACING THE LEASH.
   *
   * The leash held the target within a fixed distance of the SHIP, and the
   * owner felt what that cost: "i can only travel so far before i need to
   * click again and start a new drag". A thumb moves several times faster
   * than the ship flies, so on a quick stroke the ship falls behind, the
   * leash truncated the target, and the rest of the gesture was thrown away —
   * 31% of a fast 300 px stroke arrived, against 101% of a slow one.
   *
   * The wind-up it was really there to stop is a property of the WALLS, not
   * of the ship, so the target is clamped into the box the ship can reach.
   * Asserted the only way it is observable from here: park the ship ON the
   * clamp and the gap must be gone. An unclamped target is still nine
   * box-widths further out and the steer is still pinned.
   */
  input.dragXMin = base - 200;
  input.dragXMax = base + 200;
  drag(4000, 0);
  input.sample(); // the clamp is applied in sample()
  input.shipX = base + 200;
  const boxed = run(input, (st) => zero(st.x));
  check(
    boxed === SAMPLES,
    `reachable box: a 4000 px drag stops at the wall 200 px away, steer 0 on ${boxed}/${SAMPLES} (unclamped the ship is 3800 px short and still pulling)`,
  );
  input.shipX = base;
  input.dragXMin = -Infinity;
  input.dragXMax = Infinity;
  /*
   * AND THE STATION CLAMP IS ONE-SIDED. The back of the track window is a
   * wall; the front is not one — `World.update` drags the window forward to
   * follow a ship that passes it. Clamping the forward end too would zero the
   * stick at the front edge and silently delete "drag forward and the stage
   * comes at you faster", which is the whole of the sustained-boost gesture.
   */
  const sBase = input.shipStation;
  input.dragStationMax = sBase + 100;
  drag(0, 4000); // dragged BACKWARD, into the wall
  input.sample();
  input.shipStation = sBase + 100;
  const backWall = run(input, (st) => zero(st.y));
  check(backWall === SAMPLES, `station: a 4000 px drag backward stops at the window's back edge, y 0 on ${backWall}/${SAMPLES}`);
  input.shipStation = sBase;
  drag(0, -4000); // dragged FORWARD, where there is no wall
  const noFrontWall = run(input, (st) => near(st.y, -1));
  check(
    noFrontWall === SAMPLES,
    `station: a 4000 px drag FORWARD is not clamped — y stays -1 on ${noFrontWall}/${SAMPLES} (the front of the window is not a bound; the ship tows it)`,
  );
  input.dragStationMax = Infinity;
  input.releasePointer();

  // ---- 6. Re-basing: on press, on demand, and on release. -----------------
  drag(DRAG_RANGE, 0);
  input.sample();
  input.pressPointer(PX, PY); // a second press, without a release
  const rebased = run(input, (st) => zero(st.x));
  check(rebased === SAMPLES, `a second press re-bases the target onto the ship: steer 0 on ${rebased}/${SAMPLES} (lift and re-place is how a stroke that ran out of glass is continued)`);
  drag(DRAG_RANGE, 0);
  input.sample();
  input.rebaseDrag(PX + DRAG_RANGE, PY);
  const offerRebase = run(input, (st) => zero(st.x));
  check(
    offerRebase === SAMPLES,
    `rebase under an open offer: steer 0 on ${offerRebase}/${SAMPLES} (a thumb that wandered across the cards must not be applied as one jump when they close)`,
  );
  /*
   * LIFTING KEEPS THE TARGET, and that is a deliberate reversal.
   *
   * It used to clear it, and the assertion here was "lifted: x 0, y 0". That
   * threw away the part of the stroke the ship had not caught up with yet,
   * which is the second half of what the owner reported. So the contract is
   * now: the contact ends, the intent does not — the ship coasts the rest of
   * the way and stops when it ARRIVES, not when the thumb leaves the glass.
   * Firing does stop, because that is about the finger and not the ship.
   */
  drag(DRAG_RANGE * 4, 0);
  input.sample();
  input.releasePointer();
  const coasting = run(input, (st) => near(st.x, 1) && !st.shoot);
  check(
    coasting === SAMPLES,
    `lifted mid-stroke: the ship keeps going to where it was dragged, steer +1 on ${coasting}/${SAMPLES}, and firing has stopped (clearing the target here is what lost 69% of a fast stroke)`,
  );
  // Moving the pointer after the lift must add nothing: the contact is over.
  input.dragPointer(PX + 9999, PY);
  const afterLift = run(input, (st) => near(st.x, 1));
  check(afterLift === SAMPLES, `a move after the lift adds nothing on ${afterLift}/${SAMPLES} (the gesture ended; only its result is still in flight)`);
  input.shipX = input.shipX + DRAG_RANGE * 4; // the ship arrives
  const settled = run(input, (st) => zero(st.x));
  check(settled === SAMPLES, `and when it arrives it stops: steer 0 on ${settled}/${SAMPLES} (it holds the place the player left it in — this is not the recentre spring coming back)`);

  // ---- 7. The warp lever. -------------------------------------------------
  const untouched = run(input, (st) => st.warpLever === null);
  check(untouched === SAMPLES, `an untouched lever reads null on ${untouched}/${SAMPLES} — NULL, not 0: null is "no opinion", 0 is "at the bottom", and collapsing them drops every caller out of warp on its first step`);
  input.warpLever = 1;
  const up = run(input, (st) => st.warpLever === 1);
  check(up === SAMPLES, `the lever at the top publishes 1 on ${up}/${SAMPLES}`);
  input.warpLever = 0;
  const down = run(input, (st) => st.warpLever === 0 && st.warpLever !== null);
  check(down === SAMPLES, `the lever at the bottom publishes 0, distinct from null, on ${down}/${SAMPLES}`);
  input.warpLever = 0.5;
  const mid = run(input, (st) => near(st.warpLever, 0.5) && cruise(st));
  check(mid === SAMPLES, `a half-pulled lever publishes 0.5 and leaves the throttle at 0 on ${mid}/${SAMPLES} (the lever is not the throttle)`);

  // ---- 8. Device provenance, and a new run. -------------------------------
  check(input.touchActive === false, `the mouse path never set touchActive (want false): ${input.touchActive}`);
  input.pressPointer(PX, PY);
  input.resetPointer();
  check(input.pointerPressed === false, `resetPointer (a new run): pointerPressed false (want false): ${input.pointerPressed}`);
  check(input.warpLever === null, `resetPointer clears the lever (want null): ${input.warpLever}`);
  const reset = run(input, (st) => cruise(st) && zero(st.x) && zero(st.y) && st.warpLever === null);
  check(reset === SAMPLES, `resetPointer (a new run): throttle 0, x 0, y 0, lever null on ${reset}/${SAMPLES}`);

  const touch = new Input(win);
  touch.pressPointer(PX, PY, true);
  touch.dragPointer(PX + DRAG_RANGE, PY);
  const firing = run(touch, (st) => near(st.x, 1) && st.shoot);
  check(firing === SAMPLES, `a finger dragging: steer +1 and firing on ${firing}/${SAMPLES}`);
  check(touch.touchActive === true, `touch set touchActive (want true): ${touch.touchActive}`);
  touch.releasePointer();
  // Same contract as the mouse above: the finger's INTENT outlives the
  // contact, its trigger does not.
  const touchLifted = run(touch, (st) => near(st.x, 1) && !st.shoot);
  check(touchLifted === SAMPLES, `finger lifted mid-stroke: still steering to where it was dragged, not firing, on ${touchLifted}/${SAMPLES}`);
  touch.shipX = touch.shipX + DRAG_RANGE;
  const touchSettled = run(touch, (st) => zero(st.x));
  check(touchSettled === SAMPLES, `and it stops on arrival: x 0 on ${touchSettled}/${SAMPLES}`);
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
