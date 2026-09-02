/*
 * throttlefeel — what does each half of the throttle actually DO to the screen?
 *
 * WHY THIS EXISTS, verbatim from the owner:
 *
 *   "currently always moving forward yet moving backward feels sluggish, i
 *    want that same level of snappy control i had in the original arena"
 *
 * The obvious suspects are all innocent, and this file exists partly to record
 * that so nobody spends another session on them:
 *
 *   - The damping is not slow. ACCEL_HALFLIFE is 35ms, BRAKE 55ms, FOCUS 22ms.
 *   - The band is not lopsided. TRACK_ANCHOR 0.34 sits between TRACK_AHEAD
 *     0.16 and TRACK_BEHIND 0.56, so there is 0.18 of a view ahead of the ship
 *     and 0.22 behind it — backward actually has MORE room.
 *   - The trim is not lopsided either. `wantY = -CRUISE + input.y * trimTop`
 *     is symmetric by construction, +-430 about the cruise.
 *
 * WHAT IS LOPSIDED IS WHAT HAPPENS AT THE TWO ENDS, and it is structural
 * rather than numeric. `world.ts` runs, in this order:
 *
 *     this.trackY -= CRUISE_SPEED * simDt;              // the rail advances
 *     this.player.update(simDt, input, this.trackBounds(), ...);
 *     this.trackY = Math.min(this.trackY, this.player.y - VIEW_H*TRACK_AHEAD);
 *
 * The third line is a DRAG with no counterpart. Push forward and the ship
 * reaches the front of the window and then TOWS IT: travel is unbounded and
 * the whole stage accelerates behind it. Pull back and the ship reaches
 * `bounds.y1` — a hard clamp inside `player.update` — and simply stops, while
 * the rail keeps advancing at exactly the speed it always did.
 *
 * So one half of the stick changes the speed of the world and the other half
 * moves the ship a fifth of a screen and then goes dead. That is the whole
 * complaint, and no amount of tuning the halflives can reach it.
 *
 * WHAT THIS MEASURES. The real `Player.update` against a faithful replay of
 * the three lines above at the real `FIXED_DT`, holding each stick position
 * for a few seconds, then releasing. It reports, per direction:
 *
 *   - how long the stick keeps producing SCREEN motion before the ship pins
 *   - where on the screen it pins
 *   - what the STAGE speed does while it is pinned (the other half of the
 *     feedback, and the half the back of the stick does not have)
 *   - how long the ship then takes to drift home when the stick is released
 *
 * THE ASYMMETRY RATIO at the bottom is the number to watch. It is not a
 * physics constant; it is a design choice, and the assertion encodes the
 * choice rather than discovering it.
 *
 * JUDGED, NOT MEASURED — as `field.ts` says of the band itself, no node-only
 * gate can tell you whether a throttle FEELS like travel. What this gate can
 * do is refuse to let the two halves of one stick diverge silently again.
 *
 *   node --experimental-transform-types tools/throttlefeel.mjs
 */
import './lib/ts.mjs';

const { Player, CRUISE_SPEED, RAIL_FLOOR } = await import('../src/game/player.ts');
const { TRACK_AHEAD, TRACK_BEHIND, TRACK_ANCHOR, VIEW_H } = await import('../src/game/field.ts');
const { FIXED_DT } = await import('../src/core/loop.ts');

const HOLD = 3.0;
/*
 * Eight seconds, because the recentre is slower than it looks. `settle` decays
 * with a time constant of RECENTRE_SPAN/RECENTRE_SPEED = 220/160 = 1.375s, so
 * closing 90% of the gap needs about 3.2s and a 3s window reported "never" for
 * the forward case — the window, not the game.
 */
const RELEASE = 8.0;

/* `InputState` carries fields the simulation no longer reads (`shoot`) and one
 * it does (`throttle`, the pre-normalise axis). Only x/y/focus reach the
 * player, so this is the whole of what `Player.update` can see. */
const stick = (y) => ({ x: 0, y, shoot: false, focus: false, throttle: -y });

/*
 * WHAT "RAIL SPEED" MEANS HERE, since the label changed. The thing the back of
 * the throttle eases is the TRACK WINDOW (`World.railSpeed`), not the stage:
 * `carryStage` and the crowd stay at `CRUISE_SPEED`. For one commit all three
 * eased together and `arena` lost two thirds of its crowd — bodies must sweep
 * PAST a braking ship for the recycler to keep the screen full. So this gate
 * measures the window's speed, which is the thing the player feels as "the
 * world answers the stick", while the world itself keeps coming at cruise.
 *
 * The four lines of `world.ts`'s step that decide this, in their real order.
 * Reproduced rather than imported because `World` drags in the entire
 * simulation — but reproduced EXACTLY, and the header quotes the original so
 * the two can be diffed by eye when either moves.
 *
 * `RAIL_FLOOR` is IMPORTED rather than retyped, because a tool holding its own
 * copy of a constant will lie: the first version of this file hardcoded the
 * rail at `CRUISE_SPEED` and would have gone on reporting a 0% backward swing
 * after `world.ts` was fixed, which is the exact failure it exists to catch.
 * The formula below is still a duplicate of one line of `world.ts` and that is
 * the residual risk here; it is one line, and it is quoted in the header.
 */
function run(inputY, seconds, st) {
  const rows = [];
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const prevTrack = st.trackY;
    /* world.ts: stageSpeed = CRUISE_SPEED * (1 - max(0, -throttle) * (1 - RAIL_FLOOR))
     * `throttle` is +1 forward / -1 back and this harness's `inputY` is the
     * raw stick axis, -1 forward / +1 back, so `-throttle` IS `inputY`. */
    const stageSpeed = CRUISE_SPEED * (1 - Math.max(0, inputY) * (1 - RAIL_FLOOR));
    st.trackY -= stageSpeed * FIXED_DT;
    st.player.update(
      FIXED_DT,
      stick(inputY),
      { x0: -1e9, y0: -Infinity, x1: 1e9, y1: st.trackY + VIEW_H * TRACK_BEHIND, yHome: st.trackY + VIEW_H * TRACK_ANCHOR },
      1,
    );
    st.trackY = Math.min(st.trackY, st.player.y - VIEW_H * TRACK_AHEAD);
    rows.push({
      t: (i + 1) * FIXED_DT,
      /* Where the ship sits IN THE WINDOW: 0 at the very top of the view, and
       * the only position the player can actually see. */
      screen: (st.player.y - st.trackY) / VIEW_H,
      /* How fast the world is scrolling underneath everything. The back of the
       * stick never changes this and the front of it doubles it. */
      stage: (prevTrack - st.trackY) / FIXED_DT,
    });
  }
  return rows;
}

function fresh() {
  const player = new Player();
  const trackY = -VIEW_H * TRACK_ANCHOR;
  player.x = 0;
  player.y = trackY + VIEW_H * TRACK_ANCHOR;
  player.vx = 0;
  player.vy = -CRUISE_SPEED;
  return { player, trackY };
}

/* Pinned = the ship has stopped moving across the SCREEN. Half a pixel per
 * step at 120 Hz is 60 px/s, which is under a tenth of the trim and well below
 * anything a player reads as travel. */
const PIN_EPS = 0.5 / VIEW_H;

function analyse(name, inputY) {
  const st = fresh();
  const held = run(inputY, HOLD, st);
  const start = held[0].screen;

  let pinAt = null;
  for (let i = 1; i < held.length; i++) {
    if (Math.abs(held[i].screen - held[i - 1].screen) < PIN_EPS) {
      /* Must STAY pinned — a single slow step mid-acceleration is not a pin. */
      const rest = held.slice(i, i + 60);
      if (rest.every((r, k) => k === 0 || Math.abs(r.screen - rest[k - 1].screen) < PIN_EPS)) {
        pinAt = held[i];
        break;
      }
    }
  }

  const settled = held[held.length - 1];
  const stageHeld = settled.stage;

  /*
   * Release and time the drift home — as a 90%-of-the-gap settling time, not
   * as an absolute epsilon.
   *
   * The first version of this asked for the ship to land within 0.005 of a
   * view of `TRACK_ANCHOR` and reported "never" for BOTH directions, which
   * read like a defect and is not one. `settle` scales with the remaining
   * distance (`clamp((yHome - y) / RECENTRE_SPAN, -1, 1)`), so the approach is
   * exponential and the last half-percent takes longer than the whole trip;
   * traced from 0.560 it reaches 0.374 at 2.5s and keeps closing. An absolute
   * tolerance cannot be reached by an asymptote, so it was measuring its own
   * threshold rather than the game.
   */
  const rel = run(0, RELEASE, st);
  const home = TRACK_ANCHOR;
  const gap0 = Math.abs((rel.length ? rel[0].screen : home) - home);
  let homeAt = null;
  for (const r of rel) {
    if (Math.abs(r.screen - home) <= gap0 * 0.10) { homeAt = r.t; break; }
  }

  return {
    name,
    start,
    pinTime: pinAt ? pinAt.t : null,
    pinScreen: pinAt ? pinAt.screen : settled.screen,
    travel: Math.abs((pinAt ? pinAt.screen : settled.screen) - start),
    stageHeld,
    stageRatio: stageHeld / CRUISE_SPEED,
    homeAt,
  };
}

const fwd = analyse('forward', -1);
const back = analyse('backward', +1);

console.log(`constants: CRUISE ${CRUISE_SPEED} px/s, VIEW_H ${VIEW_H}, band ${TRACK_AHEAD}..${TRACK_BEHIND} anchor ${TRACK_ANCHOR}`);
console.log(`sim: real Player.update at FIXED_DT=${FIXED_DT.toFixed(5)}s, ${HOLD}s held then ${RELEASE}s released\n`);

const f3 = (v) => (v === null ? '   never' : v.toFixed(3).padStart(8));
for (const r of [fwd, back]) {
  console.log(`${r.name}:`);
  console.log(`   screen travel before pinning : ${r.travel.toFixed(3)} of a view (${(r.travel * VIEW_H).toFixed(0)} px)`);
  console.log(`   time until it pins           : ${f3(r.pinTime)} s   at screen ${r.pinScreen.toFixed(3)}`);
  console.log(`   rail speed while held         : ${r.stageHeld.toFixed(0)} px/s  = ${r.stageRatio.toFixed(2)}x cruise`);
  console.log(`   90% back to station          : ${f3(r.homeAt)} s`);
}

const travelRatio = fwd.travel / Math.max(1e-6, back.travel);
const stageSwingF = Math.abs(fwd.stageRatio - 1);
const stageSwingB = Math.abs(back.stageRatio - 1);

console.log(`\nASYMMETRY`);
console.log(`   screen travel  forward/backward : ${travelRatio.toFixed(2)}x`);
console.log(`   rail-speed swing forward        : ${(stageSwingF * 100).toFixed(0)}% of cruise`);
console.log(`   rail-speed swing backward      : ${(stageSwingB * 100).toFixed(0)}% of cruise`);

/* ---- assertions ------------------------------------------------------- */
const fails = [];

/*
 * BOTH HALVES OF THE STICK MUST DO SOMETHING TO THE WORLD.
 *
 * This is the assertion that matters and it is the one the current build
 * fails. Forward tows the rail, so holding it changes the stage speed by a
 * large fraction of cruise; backward does not touch the rail at all, so its
 * swing is exactly zero and the only feedback is a fifth of a screen of slide.
 * A tenth of cruise is a deliberately generous floor — it is asking for the
 * back of the stick to have SOME authority over the world, not equal
 * authority.
 */
if (stageSwingB < 0.10) {
  fails.push(
    `holding back changes the stage speed by ${(stageSwingB * 100).toFixed(0)}% of cruise, ` +
      `against ${(stageSwingF * 100).toFixed(0)}% for holding forward. The back of the throttle ` +
      `has no authority over the world: the ship slides ${(back.travel * VIEW_H).toFixed(0)}px ` +
      `in ${back.pinTime === null ? '?' : back.pinTime.toFixed(2)}s, pins against ` +
      `TRACK_BEHIND, and from then on the stick is dead. Forward tows the rail ` +
      `(world.ts: trackY = Math.min(trackY, player.y - VIEW_H*TRACK_AHEAD)) and has no such limit.`,
  );
}

/*
 * Asserted separately from the cause, so that a fix which gives the back of
 * the stick authority some OTHER way than by slowing the rail still passes,
 * and so that this cannot be satisfied by nerfing the forward half.
 */
if (travelRatio > 2.0 || travelRatio < 0.5) {
  fails.push(
    `the two halves of the stick move the ship ${travelRatio.toFixed(2)}x differently across ` +
      `the screen (${(fwd.travel * VIEW_H).toFixed(0)}px forward vs ${(back.travel * VIEW_H).toFixed(0)}px back) ` +
      `despite a band that is 0.18 ahead and 0.22 behind the anchor.`,
  );
}

if (fails.length) {
  console.log(`\nFAIL`);
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nok — both halves of the throttle have authority over the rail`);
