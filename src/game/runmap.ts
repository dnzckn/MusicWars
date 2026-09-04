/**
 * The run bar's LOGIC, as a pure function over public numbers.
 *
 * WHY THIS IS A SEPARATE FILE AND NOT A METHOD ON THE RENDERER. The bar on
 * the left edge is the one widget that says where a run IS — which wave of
 * sixteen, which act, which boss is next, whether the boss is on the field —
 * and every one of those readings used to be arithmetic inside
 * `Renderer.drawBossBar`, where nothing in `tools/` could reach it without
 * dragging `levelup.ts`, `grid.ts` and the sprite atlas into node. So the
 * readings were never checked against the world that produced them, and the
 * map that preceded this file found the corner counter and the bar both
 * saying WAVE for different numbers (`WAVE 7` top-right, `1 WAVE` under the
 * bar), a `1 OF 3` under four pips, and a bar that read BOSS for two bars of
 * a RETRIED run because `plan` was never reset.
 *
 * The renderer and `tools/runmap.mjs` import THIS function, so the string the
 * tool asserts is the string the player reads. The tool drives a headless
 * `World` through a whole run and feeds its PUBLIC getters in; `World.phase`
 * itself is private, which is why the input is a plain record rather than
 * the world.
 *
 * NOTHING HERE IS A LITERAL. `waves.ts` says "ONE CONSTANT, AND EVERYTHING
 * ELSE IS DERIVED", and the map found the last widget that forgot it (`OF 3`
 * from `BOSS_COUNT - 1` under `BOSS_COUNT` pips). Segment count, group count,
 * the diamond labels, `OF 16` and `OF 4` all come from `BOSS_COUNT` and
 * `BOSS_EVERY`; move either and the bar follows.
 *
 * DOM-free on purpose: `renderer.ts` is the only render-side importer, and
 * `tools/_warpshots.mjs` imports the geometry below to measure clearance
 * instead of holding its own copy — which it did, at `0.42·H − 17` and
 * `0.86·H + 31`, and would have kept reporting CLEAR after the bar moved.
 */

import { actOf, BOSS_COUNT, BOSS_EVERY, TOTAL_WAVES } from './waves';

/**
 * The world's wave-cycle phase, written once. `World.phase` is typed from
 * this so the bar's table below and the state machine cannot disagree about
 * the set of states.
 */
export type StagePhase = 'idle' | 'spawning' | 'awaiting-boss' | 'conductor' | 'interlude' | 'over';

export const STAGE_PHASES: readonly StagePhase[] = [
  'idle',
  'spawning',
  'awaiting-boss',
  'conductor',
  'interlude',
  'over',
];

/*
 * WHERE THE BAR IS, in fractions of the VIEW and view px.
 *
 *   x            the track's centre line, view px from the left edge
 *   top / bot    the ends of the track as fractions of `viewH`. The bottom
 *                stays at 0.86: at 1280x600 (view 728 tall) a lower bottom
 *                plus the two-line stack collides with the resume pill
 *                (`#ui-resume`, ~39 view px tall) whenever it shows — the
 *                reviewer computed a 3 px overlap at 0.88 and this file's own
 *                photo pass measured the 0.86 clearance. The top moved UP
 *                from 0.42 to 0.40 to buy the diamonds their gaps.
 *   headroom     CSS px the widget reaches ABOVE `top`. ZERO: the FINAL
 *                diamond sits INSIDE the track, in `finalSlot` reserved at
 *                the top of it, so the bar's top edge is the widget's top
 *                edge. It floated `FINAL_R + 2` above the track first, and
 *                at 1280x600 under the deepest `.hud-tl` (a movement pill
 *                plus the fusion aim line, bottom at 210 CSS px) its top
 *                cleared by 2 CSS px — photographed. Seating it costs each
 *                segment about 1.4 CSS px and buys 22 there.
 *   finalSlot    CSS px of the track's top reserved for the FINAL diamond
 *                (2·FINAL_R + 4). The top segment ends below it.
 *   stackHeight  CSS px the two-line stack reaches BELOW `bot`. CSS, not
 *                view, because the stack's type is sized in CSS px (see
 *                `cssPerView` in the renderer) and does not scale with the
 *                bar. Line 1 sits at `bot + 8` (12 px), line 2 at `bot + 23`
 *                (9 px): 8 + 15 + 9 + 2 of descender air.
 *   diamondGap   CSS px between one group's top segment and the next
 *                group's bottom one, holding a mini diamond (2·MINI_R + 4).
 *                CSS, like the diamonds themselves: a diamond is a glyph the
 *                player reads as a state, and a glyph that shrank with the
 *                view was 2.6 CSS px across on a phone.
 *   segmentGap   CSS px between segments inside a group.
 *
 * `tools/_warpshots.mjs` measures `stage.height · top − headroom` against
 * `.hud-tl` and `stage.height · bot + stackHeight` against the resume pill,
 * all in CSS px.
 */
export const MINI_R = 5;
export const FINAL_R = 9;
export const RUN_BAR = {
  x: 26,
  top: 0.4,
  bot: 0.86,
  headroom: 0,
  finalSlot: FINAL_R * 2 + 4,
  stackHeight: 34,
  diamondGap: MINI_R * 2 + 4,
  segmentGap: 2,
  /** Below this many view px per segment the gaps go and the groups are solid. */
  minSegment: 10,
} as const;

export interface RunMapInput {
  /** `World.waveIndex`, 0-based. */
  waveIndex: number;
  /** `World.stagePhase`. */
  stagePhase: StagePhase;
  /** `snapshot.waveProgress`: how far through this wave's spawn schedule, 0..1. */
  waveProgress: number;
  /** `World.bossesBeaten`, 0..BOSS_COUNT. */
  bossesBeaten: number;
  /** `snapshot.bossActive`: a conductor is on the field. */
  bossActive: boolean;
  /** `World.wavesToBoss === 0`: this wave IS a boss wave, escort and all. */
  onBossWave: boolean;
  /** `World.onFinalWave`: this wave is the one the run ends on. */
  onFinalWave: boolean;
  /** `World.victory`. */
  victory: boolean;
}

export type DiamondState = 'ahead' | 'next' | 'active' | 'beaten';

export interface RunMap {
  /** One fill fraction per wave, index 0 at the bottom. Length `TOTAL_WAVES`. */
  segments: number[];
  /** The segment the run is on: `waveIndex`, clamped. The renderer outlines it. */
  current: number;
  /** One per boss, index 0 lowest. Length `BOSS_COUNT`; the last is the finale. */
  diamonds: DiamondState[];
  /** The text to the right of each diamond: `1`, `2`, …, `FINAL`. */
  labels: string[];
  /** `WAVE 6 OF 16`. The number is `#ui-wave`'s number; the two must agree. */
  line1: string;
  /** `BOSS IN 2` / `BOSS` / `BOSS 2/4` / `FINAL` / `FINAL 4/4`. */
  line2: string;
  /** What line 2 is, so the renderer colours it without parsing it. */
  line2Kind: 'count' | 'boss' | 'final';
  /** The boss HP bar's caption: `BOSS 2 OF 4` or `THE FINAL SET`. */
  hpLabel: string;
  /** Which act the current wave belongs to, 1-based. */
  act: number;
  /** The boss the player is heading for, 1-based; `bossesBeaten + 1`, capped. */
  nextBoss: number;
  /** Whole waves before the boss wave, derived here so the tool can cross-check `World.wavesToBoss`. */
  wavesToBoss: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * True when every field is something the bar can draw from.
 *
 * `tools/effectsdraw.mjs` builds its own world shape, and a field it does not
 * know about arrives as `undefined` — which becomes NaN two multiplications
 * later and `hsl(352, NaN%, NaN%)` after that, and a NaN in a colour string
 * throws inside the parser AFTER the background has been cleared: a black
 * frame with no error. The renderer bails on `false` here rather than drawing
 * wrong, because a readout with nothing behind it should be absent, not zero.
 */
export function runMapInputOk(i: Partial<RunMapInput> | null | undefined): i is RunMapInput {
  return (
    !!i &&
    Number.isFinite(i.waveIndex) &&
    Number.isFinite(i.waveProgress) &&
    Number.isFinite(i.bossesBeaten) &&
    typeof i.stagePhase === 'string' &&
    (STAGE_PHASES as readonly string[]).includes(i.stagePhase) &&
    typeof i.bossActive === 'boolean' &&
    typeof i.onBossWave === 'boolean' &&
    typeof i.onFinalWave === 'boolean' &&
    typeof i.victory === 'boolean'
  );
}

/**
 * How full segment `i` is, from PUBLIC inputs only — this is the table the
 * review asked for, so the rule can be read in one place.
 *
 *   i < waveIndex        1      cleared
 *   i === waveIndex      by phase:
 *     spawning           0.9 · waveProgress
 *     awaiting-boss      0.9    the escort is spent; the boss is the last tenth
 *     conductor          0.9
 *     interlude          1      the wave is cleared; `waveIndex` still points
 *                               at it until `beginWave(index + 1)`
 *     idle               0      the TUNING UP runway, before wave 1 begins
 *     over               1 on a victory; otherwise the spawning/boss value,
 *                               which is the last thing the bar showed
 *   i > waveIndex        0
 *
 * THE 0.9 IS THE POINT. `waveProgress` is the SPAWN SCHEDULE, which saturates
 * when the last group is scheduled, not when it is dead — measured at 22.3%
 * of a run with the segment full while the wave was still going (32.6 s of
 * wave 9's 99.6 s). A full segment reads as "done", so the last tenth is
 * reserved for the clear, and the bar cannot say a wave is over before it is.
 * Monotone within a wave: `waveProgress` is a cursor over a fixed list, the
 * boss phases are 0.9 after a spawning value ≤ 0.9, and the interlude is 1.
 */
function segmentFill(i: number, input: RunMapInput): number {
  const { waveIndex, stagePhase, waveProgress, bossActive, victory } = input;
  if (i < waveIndex) return 1;
  if (i > waveIndex) return 0;
  const running = bossActive ? 0.9 : 0.9 * clamp01(waveProgress);
  switch (stagePhase) {
    case 'spawning':
      return running;
    case 'awaiting-boss':
    case 'conductor':
      return 0.9;
    case 'interlude':
      return 1;
    case 'idle':
      return 0;
    case 'over':
      return victory ? 1 : running;
  }
}

export function runMap(input: RunMapInput): RunMap {
  const waveIndex = Math.max(0, Math.floor(input.waveIndex));
  const beaten = Math.max(0, Math.min(BOSS_COUNT, Math.floor(input.bossesBeaten)));
  const act = actOf(waveIndex);
  /*
   * NEXT IS `bossesBeaten + 1`, NOT `actOf(waveIndex)`. They disagree through
   * every post-boss interlude: the kill increments `bossesBeaten` at once
   * while `waveIndex` stays on the boss wave until the next one begins, so
   * for that bar the act still says 1 and the boss just beaten is 1 — and the
   * diamond that should brighten is the SECOND one. The player just killed a
   * boss; the next thing on the bar has to be the next boss.
   */
  const nextBoss = Math.min(BOSS_COUNT, beaten + 1);

  const segments: number[] = [];
  for (let i = 0; i < TOTAL_WAVES; i++) segments.push(segmentFill(i, input));

  const diamonds: DiamondState[] = [];
  const labels: string[] = [];
  for (let n = 1; n <= BOSS_COUNT; n++) {
    diamonds.push(
      beaten >= n ? 'beaten' : n === nextBoss ? (input.bossActive ? 'active' : 'next') : 'ahead',
    );
    labels.push(n === BOSS_COUNT ? 'FINAL' : String(n));
  }

  /*
   * Line 2 keys on `bossActive` AS WELL AS the wave, and that bends the "two
   * states" finding the old bar recorded (label reads the wave, diamond reads
   * the boss) without breaking its point. The point was that the label must
   * not read as a FINISHED COUNTDOWN through the four-bar telegraph — `0
   * WAVES` — and it does not: it reads BOSS, the same word it has carried
   * since the wave began, until the boss is on the field, and only then does
   * it number the fight. The diamond still fills on `bossActive` alone.
   */
  const wavesToBoss = input.onBossWave ? 0 : BOSS_EVERY - 1 - (waveIndex % BOSS_EVERY);
  let line2: string;
  let line2Kind: RunMap['line2Kind'];
  if (input.onFinalWave) {
    line2 = input.bossActive ? `FINAL ${BOSS_COUNT}/${BOSS_COUNT}` : 'FINAL';
    line2Kind = 'final';
  } else if (input.onBossWave) {
    line2 = input.bossActive ? `BOSS ${nextBoss}/${BOSS_COUNT}` : 'BOSS';
    line2Kind = 'boss';
  } else {
    line2 = `BOSS IN ${wavesToBoss}`;
    line2Kind = 'count';
  }

  return {
    segments,
    current: Math.min(TOTAL_WAVES - 1, waveIndex),
    diamonds,
    labels,
    line1: `WAVE ${waveIndex + 1} OF ${TOTAL_WAVES}`,
    line2,
    line2Kind,
    hpLabel: input.onFinalWave ? 'THE FINAL SET' : `BOSS ${nextBoss} OF ${BOSS_COUNT}`,
    act,
    nextBoss,
    wavesToBoss,
  };
}
