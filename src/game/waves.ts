/**
 * Stage scripting.
 *
 * Waves are generated rather than hand-authored so a run keeps going, but the
 * generator is deterministic in the wave index: wave 7 is always wave 7. That
 * matters because the music seeds its lead melody from the same number, so a
 * given wave always sounds like itself.
 *
 * Spawn times are in *beats*, not seconds. The wave and the track therefore
 * stay locked together even as the director changes tempo, which is what makes
 * enemy volleys land on the grid instead of near it.
 */

import type { EnemyArchetype } from '../core/events';
import { Rng } from '../core/rng';

export type Formation = 'line' | 'arc' | 'columns' | 'sides' | 'centre' | 'rhythm';

export interface SpawnEntry {
  atBeat: number;
  archetype: Exclude<EnemyArchetype, 'conductor'>;
  count: number;
  formation: Formation;
  homeY: number;
}

export interface WavePlan {
  index: number;
  /** 0..1, used for HP and emitter scaling. Saturates around wave 17. */
  difficulty: number;
  /**
   * Escalation beyond the difficulty cap, 0 at wave 17 and climbing after.
   *
   * Difficulty was clamped to 1 and every downstream system read only that, so
   * wave 17 and wave 40 were literally the same fight. This keeps the per-enemy
   * numbers sane while letting the *stage* keep growing.
   */
  escalation: number;
  isBoss: boolean;
  entries: SpawnEntry[];
  /**
   * Beats after the last spawn before the wave gives up waiting — WRITTEN AND
   * NEVER READ.
   *
   * Both `planWave` branches set it (32 for a boss wave, `beat + 16` otherwise)
   * and nothing consumes it: `World.updateWave` ends a wave on "the entry
   * cursor is exhausted AND `enemies.length === 0`", with no timeout anywhere.
   * `tools/deadhunt-branches.mjs` greps `src/game` for the name and finds only
   * the declaration and the two writes.
   *
   * The wave still terminates, but by a different mechanism than this field
   * describes: `spawnEnemy` gives everything except `rush` a `leaveAt` of 18
   * seconds, and a shape that gives up flies radially out to the 320px cull
   * margin. So the real "gives up waiting" is per-enemy, in seconds, and lives
   * in `enemies.ts` — which means a wave's length is set by that constant and
   * not by anything in this file. Kept, because a wave-level timeout is a
   * reasonable thing to want and the number is a reasonable starting value; the
   * doc corrected, because a field that reads live and is inert is how a
   * balance pass ends up editing something with no effect.
   */
  lengthBeats: number;
}

/** Every fourth wave is a boss. */
/*
 * Four. Three was tried and measured worse.
 *
 * Bosses are the only set piece and a five-minute run meets one, so more of
 * them looked like the obvious answer to "rather uninteresting". But a boss
 * fight runs 100-150s against ordinary waves at 26-31s, so one every three
 * waves makes a run *mostly boss*: tools/content.mjs went from wave 8 with 42
 * kills to wave 6 with 18. Set pieces stop being set pieces when they are most
 * of the game.
 */
export const BOSS_EVERY = 4;

/*
 * Tier 2 — waves 7-9 — had no unarmed shape in it at all.
 *
 * `pluck`, `arpeggiator`, `glissando` and `echo` are four shapes that all
 * answer the same question, which is where to stand. `rush` and `stutter` are
 * the two that ask where to MOVE, and both were absent from exactly the band
 * that "gets easy fast" is about. Adding `rush` back raises pressure in waves
 * 7-9 without adding a single bullet — which matters, because the fog of aimed
 * fire is a complaint this project has already answered once and does not want
 * back.
 */
const POOLS: Record<number, readonly Exclude<EnemyArchetype, 'conductor'>[]> = {
  0: ['pluck', 'stutter', 'rush'],
  1: ['pluck', 'stutter', 'glissando', 'rush'],
  2: ['pluck', 'arpeggiator', 'glissando', 'echo', 'rush'],
  3: ['stutter', 'arpeggiator', 'glissando', 'subdrop', 'echo', 'rush'],
};

export function planWave(index: number): WavePlan {
  const rng = new Rng(0x5eed ^ (index * 0x9e3779b9));
  /*
   * The old ramp (index * 0.085) put wave 1 at 8.5% of full difficulty and wave
   * 5 at 42%, which is far too steep — a new player was fighting near-endgame
   * patterns before they had learned to read one. This curve keeps the first
   * three waves close to trivial and pushes the real difficulty out past wave 8,
   * where someone still playing has actually earned it.
   *
   * `(index/14)^1.35` became `(index/13)^1.25` because the complaint is that
   * the game gets easy fast and stays easy, and the middle of this curve is
   * where "fast" lives. It lifts waves 4-12 by roughly a sixth and reaches the
   * cap a wave earlier, while leaving the on-ramp alone:
   *
   *   wave       1     3     4     6     8    10    12    13
   *   before  0.03  0.13  0.18  0.32  0.47  0.64  0.81  0.90
   *   after   0.04  0.16  0.23  0.38  0.55  0.72  0.91  1.00
   *
   * Deliberately a small move. The player's damage ceiling came down from 22x
   * to under 3x in the same pass (see player.ts `weapon`), so the difficulty
   * felt at wave 8 rises a great deal more than these two rows suggest, and
   * two hands tightening at once is how a difficulty pass overshoots. Enemy hp
   * scaling below is untouched for the same reason.
   */
  const raw = Math.pow(index / 13, 1.25);
  const difficulty = Math.min(1, raw);
  const escalation = Math.max(0, raw - 1);
  const isBoss = index > 0 && index % BOSS_EVERY === BOSS_EVERY - 1;

  if (isBoss) {
    // A short escort before the boss: gives the director something to build
    // over, and gives the player a chance to top up powerups first.
    return {
      index,
      difficulty,
      escalation,
      isBoss: true,
      entries: [
        // Four and three, not six and four: the escort is 2.5x tougher than it
        // was, and a boss wave cannot start until the stage is empty. The old
        // counts at the new hp pushed the telegraph minutes out.
        { atBeat: 0, archetype: 'stutter', count: 4, formation: 'arc', homeY: 150 },
        { atBeat: 8, archetype: 'pluck', count: 3, formation: 'line', homeY: 170 },
      ],
      lengthBeats: 32,
    };
  }

  /*
   * New archetypes keep arriving to wave 16, not wave 9.
   *
   * `floor(index / 3)` put the entire enemy pool in play by wave 9, and
   * tools/content.mjs measured a five-minute run meeting 6/6 archetypes by wave
   * 8. So a player had met everything the game has before the difficulty curve
   * starts to bite, and from there only the quantity changed — a novelty curve
   * that flattens exactly where the challenge one steepens. That is "rather
   * uninteresting" in one line of arithmetic.
   *
   * BUT /5 WAS MEASURED WORSE AND IS NOT THE ANSWER. Runs end around wave 8, so
   * delaying the full pool to wave 16 does not spread novelty across a run — it
   * removes novelty from the only part of the run anybody sees: 6/6 archetypes
   * met became 3/6. Content that arrives after the run ends is not content.
   *
   * The real gap is that nothing new arrives *after* wave 8, and the fix for
   * that is new material there, not later delivery of the material we have.
   * Left at /3 deliberately, with the measurement recorded so it is not
   * re-attempted.
   *
   * ------------------------------------------------------------------------
   * THE PREMISE ABOVE NO LONGER HOLDS: THERE IS NO DEATH HORIZON AT ALL.
   *
   * "Runs end around wave 8" is the load-bearing clause in that rejection, and
   * it is cited again at the group-size comment below, in `World.movementFor`,
   * and — without ever naming this file — it had propagated into
   * `tools/session.mjs` as a tempo ramp saturating at wave 18. One stale
   * number, four consumers. `tools/deadhunt-horizon.mjs` re-derives it once.
   *
   * Measured across a competence ladder rather than at one skill, because the
   * arena bot does not die and a single bot's result is not a horizon:
   *
   *   reacting at 60Hz (the arena driver)   0 deaths / 5   wave 34 at 20 min
   *   reacting at  6Hz                      0 deaths / 5   wave 34
   *   reacting at 0.8Hz                     0 deaths / 5   wave 32
   *   moving at random, not looking         0 deaths / 5   wave 33
   *   PARKED, never moving at all           0 deaths / 3   wave 60 at 45 min
   *
   * A ship that is not being flown reaches wave 60. The mechanism is an
   * absorbing state rather than raw survivability: score extends carry the
   * player down to exactly one life (measured 6 lives lost against 4 extends,
   * ending on 1.0 in every run), and at one life `Player.takeHit`'s auto-bomb
   * branch refunds every otherwise-lethal hit for a bomb. Bomb income vastly
   * exceeds that drain — 3 bombs spent across thirty minutes while holding the
   * cap of 5, because BOMB is 55% of the drop pool and the pity timer
   * guarantees a drop every 30 seconds. `takeHit`'s comment says the rescue was
   * narrowed to the last life so it would be "a save rather than a routine
   * refund"; at one life it is permanent.
   *
   * WHAT THIS DOES AND DOES NOT SETTLE. It does not say `/5` is right. It says
   * the sentence the rejection rests on is false: both divisors now complete
   * the roster well inside any run — `/3` shows all seven by wave 9 and `/5` by
   * wave 16, enumerated exactly rather than sampled — so "content that arrives
   * after the run ends" describes neither option any more. The trade is now
   * genuinely between showing everything early and spreading it over twice the
   * span, which is a taste question for someone who can play the game. Left at
   * /3, and the rejection above is left standing but should not be quoted as
   * measurement.
   */
  const tier = Math.min(3, Math.floor(index / 3));
  const pool = POOLS[tier];
  // Past the difficulty cap the stage keeps growing even though each enemy does
  // not: more groups, arriving closer together.
  /*
   * Past the difficulty cap, the stage grows in one dimension, not three.
   *
   * Group count, group size and per-enemy difficulty were all climbing at once,
   * and three rising factors multiply: from wave 6 to wave 22 that is roughly
   * six times the enemies with each one individually harder. Measured with the
   * dodging bot, waves 2-13 cost 0-10 hits and then wave 16 cost 24 — the
   * "hard as fuck to trivially easy" complaint is this compounding, felt from
   * the other side.
   *
   * So `scale` no longer takes an escalation term (see below) and the group
   * count grows more slowly. The early game is almost untouched — at wave 13
   * this is 9 groups against the old 10 — while the top end comes down by about
   * 40%, which is where the cliff actually was.
   */
  /*
   * Fewer bodies, because each one now stays much longer.
   *
   * Enemies move 30% slower and take about 2.5x the hits, so a group occupies
   * the screen far longer than the schedule that spawned it assumes — spawn
   * count and on-screen count are not the same number, and only the second one
   * is what a player faces. Measured before this change: 1.8 and 2.4 enemies on
   * screen at any moment across two runs, against 21.6 and 24.3 bullets. The
   * intent is to swap those round, and holding the old group count while
   * lengthening every enemy's stay would have added a traffic jam on top.
   *
   * The first attempt cut this to index / 2.4 with a matching cut to group
   * size, and that was too much: measured, ordinary-wave pressure fell 33%
   * (mean 23.4 to 15.8 across the ordinary waves of a nine-minute run) and
   * enemies on screen fell with it, 6.2 to 4.0 on wave 9. Slower and tougher
   * does not add up to fuller on its own — a longer stay is worth less than a
   * body, because an enemy the player never shoots at leaves on a timer either
   * way. The complaint being answered here is that the game is too *easy*, so a
   * third of the stage is not a trade worth making for legibility. This is ~20%
   * fewer bodies than the old formula rather than ~40%.
   */
  /*
   * CAPPING THIS WAS TRIED AND REVERTED. Do not retry it without reading this.
   *
   * The premise looked sound. `scaleForEnsemble` now buys escalation with
   * firing CADENCE, which costs nothing to look at, so the stage should be
   * able to get harder and quieter at once — and the numbers said the crowd
   * was padding: over the last quarter of a 15-minute run the field averages
   * 14.6 enemies while each contributes a third as much threat as in the first
   * (pressure per enemy 0.12 -> 0.04).
   *
   * It does not pay. Capping at 12 groups moved the crowd only 14.6 -> 13.1,
   * because enemies persist and a thinner stage lets the run reach higher wave
   * indices which spawn more groups again — while back-half pressure fell from
   * x1.16 to x1.08 (`npm run difficulty`). A third cadence gear bought back
   * only x1.11. Ten percent of the clutter for a third of the escalation.
   *
   * So the paragraph above was better-founded than it looked: these bodies
   * carry more threat than the per-enemy dilution figure suggests. The crowd
   * is still worth reducing — it is the "visual clutter is high" complaint —
   * but the answer is less visual weight PER enemy in the renderer, where
   * legibility costs no gameplay, not fewer of them here.
   */
  /*
   * index / 1.35 and escalation * 2.2, up from / 2.0 and * 1.5.
   *
   * Part of the rebalance that followed the level ladder going from 8 rungs to
   * 3. The player's power now arrives about 2.7x sooner in wall-clock terms, so
   * the schedule that fed the old curve leaves the field empty — measured,
   * enemies on screen p50 fell 7.3 to 2.0 and the arena "does the player get
   * surrounded" gate went red at 0.02 against a 0.25 bar.
   *
   * MORE BODIES IS NOT THE MAIN LEVER and is deliberately the smaller half of
   * the change. Raising group count and size ALONE moved p50 only 2.0 -> 3.0
   * and pushed kills/min 167 -> 231: bodies arriving at a player who deletes
   * them on contact are more kills, not more pressure. The term that actually
   * broke is enemy LIFETIME, and that is fixed in `scaleForEnsemble`. This
   * exists so there is something for the population floor to pull forward once
   * enemies live long enough to accumulate — the file's own warning that group
   * count and group size compound is why it is 1.35 and not 1.0.
   */
  /*
   * More groups, and smaller/weaker bodies in them.
   *
   * "increase the monster count by a lot ... monsters shouldnt be that tanky".
   * Those are one change: the field's total health is roughly held while the
   * number of things carrying it goes up, so a screen that used to be six
   * sponges becomes thirty things that die when hit. That is the survivors
   * shape and it is what makes a crowd readable as a crowd.
   */
  const groups = 9 + Math.floor(index / 0.42) + Math.floor(escalation * 6.0);
  const entries: SpawnEntry[] = [];

  let beat = 0;
  for (let g = 0; g < groups; g++) {
    const archetype = rng.pick(pool);
    // Group sizes scale with difficulty rather than being flat. Six enemies all
    // firing on wave one is what "too much clutter off the get-go" looks like.
    // The early game is untouched (0.55 at wave 1, as before); the cut is all
    // in the top end, where the group size and the group count were compounding.
    /*
     * Trimmed a further ~10% to pay for the second hp raise.
     *
     * A wave does not end until the stage is clear, so per-enemy hp and group
     * size multiply into wave duration, and duration is what `content.mjs`
     * spends: runs end around wave 8, and everything that lengthens a wave
     * removes waves from the part of the run anybody sees. Enemies are the
     * thing the user asked to be tougher, so the group size is what pays for
     * it rather than the toughness being trimmed to fit.
     *
     * "Runs end around wave 8" is stale — see the tier comment above, which
     * re-derives it: there is no death horizon, and a parked ship reaches wave
     * 60. The trim itself is not invalidated, because a longer wave still costs
     * waves per unit time and that is what this argument actually needs. What
     * is invalidated is the idea that those waves fall off the end of the run;
     * they do not, so the cost is pacing rather than content never seen.
     */
    /*
     * Group sizes, raised for the arena.
     *
     * They were `0.52 + difficulty * 0.5` — about two enemies at wave 1 and
     * four at the cap — which was right for a stage where a group entered from
     * the top in a readable row and the player picked it apart from below. In
     * the round a group is spread across an arc of the ring, so the same count
     * arrives as one or two shapes per bearing and the encirclement the whole
     * design rests on cannot form: encirclement is the largest angular GAP
     * around the player, and three enemies can only ever leave three gaps.
     *
     * Measured headless, the old scale gave a median of one enemy on the field
     * and a 90th-percentile encirclement of 0.18. This roughly doubles the
     * bodies per group without touching the number of groups, so total wave
     * content — and therefore wave duration, which `tools/wavelength.mjs` gates
     * against the eight-bar phrase — moves far less than the concurrency does.
     *
     * The early game is deliberately raised least in relative terms: wave 1
     * goes from about two to about four, which is still a group you can read.
     */
    // 1.05 + d*1.9, up from 0.9 + d*1.5, for the reason on `groups` above: the
    // supply side of the post-3-level-ladder rebalance, deliberately modest,
    // because this file's own history is two difficulty passes that overshot by
    // tightening several hands at once.
    const scale = 3.4 + difficulty * 6.0;
    const count = Math.max(
      1,
      Math.round(
        (archetype === 'stutter'
          ? 4 + rng.int(0, 3)
          : archetype === 'subdrop'
            ? 1
            : archetype === 'arpeggiator'
              ? 2 + rng.int(0, 2)
              : archetype === 'rush'
                ? 2 + rng.int(0, 3)
                : archetype === 'echo'
                  ? 2 + rng.int(0, 2)
                  : 3 + rng.int(0, 3)) * scale,
      ),
    );
    entries.push({
      atBeat: beat,
      archetype,
      count,
      formation: rng.pick(['line', 'arc', 'columns', 'sides', 'centre', 'rhythm', 'rhythm'] as const),
      homeY: 120 + rng.int(0, 4) * 40,
    });
    // Whole bars only. Six beats is a bar and a half, which put every other
    // group on an off-beat and quietly undid the point of scheduling in beats.
    beat += escalation > 0.4 ? 4 : rng.bool(0.45) ? 8 : 4;
  }

  return { index, difficulty, escalation, isBoss: false, entries, lengthBeats: beat + 16 };
}

/* ------------------------------------------------------------------------ *
 * Arena placement
 *
 * The whole spawn geometry changed with the conversion, and the reason is
 * not cosmetic. Bolting auto-aim onto a top-spawning layout produces a game
 * where dodging DOWNWARD means shooting away from everything on the screen —
 * the two verbs point in opposite directions and the player is punished for
 * playing correctly. Enemies have to arrive from everywhere or the facing
 * mechanic is a tax rather than a tool.
 *
 * The formations survive; they are laid out along the ring instead of along
 * the top edge. `rhythm` in particular gets better rather than worse: sixteen
 * slots wrapped around the arena is a bar of music with the player standing
 * inside it.
 * ------------------------------------------------------------------------ */

/**
 * The rectangle enemies arrive from the outside of.
 *
 * WHY THIS IS A STRUCT AND NOT FOUR MORE POSITIONAL ARGUMENTS. `edgePoint` used
 * to be `(angle, width, height, margin)` and read the field's own size, so a
 * caller could not get it wrong — there was only one rectangle in the program.
 * There are two now (the field and the view) and they no longer share a centre,
 * so the call site has to say which, and `edgePoint(a, 900, 1120, 70)` next to
 * `edgePoint(a, 450, 560, 900, 1120, 70)` is exactly the kind of silent
 * argument-order defect this repo keeps a tools directory to catch. A named
 * `{ cx, cy, w, h }` cannot be transposed by accident.
 *
 * `cx`/`cy` are the CENTRE, not the top-left, because that is what the ray cast
 * below actually uses and converting at every call site is where a sign error
 * would live.
 */
export interface SpawnRing {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * Where a ray from `ring.cx, ring.cy` at `angle` leaves the ring, pushed out by
 * `margin`.
 *
 * Against the RECTANGLE rather than an inscribed circle, so a spawn at 45
 * degrees comes from the corner rather than from a point floating in open play.
 * A circular ring inside a 900x1120 rectangle would put every diagonal spawn
 * nearly 200px inside it, which reads as enemies materialising in the room.
 *
 * The ring is the VIEW, centred on the camera — not the field. Those were the
 * same rectangle when the field was one screen; once it is not, spawning
 * against the field would put a group off the far corner of a 3000px arena
 * while the player is at the near one, and the wave would simply never arrive.
 * `tools/spawnring.mjs` asserts the consequence that matters: nothing is ever
 * placed inside the rectangle the player is looking at.
 */
export function edgePoint(angle: number, ring: SpawnRing, margin: number): { x: number; y: number } {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const tx = Math.abs(c) > 1e-6 ? ring.w / 2 / Math.abs(c) : Infinity;
  const ty = Math.abs(s) > 1e-6 ? ring.h / 2 / Math.abs(s) : Infinity;
  const t = Math.min(tx, ty) + margin;
  return { x: ring.cx + c * t, y: ring.cy + s * t };
}

/**
 * How wide an arc of the ring each formation occupies, in radians, and how much
 * it staggers in depth.
 *
 * `sides` is two wings rather than two opposite points on purpose: opposite
 * points would put half the group across the escape gap every time, which
 * silently deletes the gap the whole design depends on.
 */
const FORMATION_ARC: Record<Formation, number> = {
  line: 0.55,
  arc: 0.95,
  columns: 0.7,
  sides: 2.4,
  centre: 0.18,
  rhythm: 1.7,
};

/** The angular width a group of `count` needs, so a caller can avoid the gap. */
export function formationWidth(formation: Formation): number {
  return FORMATION_ARC[formation];
}

/**
 * Ring positions for a formation of `count`, centred on `baseAngle`.
 *
 * Depth stagger is expressed as extra margin OUTSIDE the ring rather than as
 * a position inside it: everything enters, nothing is ever placed on top of the
 * player, and a group arrives as a wave rather than as a wall that appeared.
 * That property is what `tools/spawnring.mjs` checks — every branch below adds
 * to `margin` and none of them subtracts, and a future formation that did
 * would place a group on the player's head with nothing else noticing.
 */
export function arenaSpawnPositions(
  formation: Formation,
  count: number,
  ring: SpawnRing,
  baseAngle: number,
  margin = 70,
): { x: number; y: number; angle: number }[] {
  const out: { x: number; y: number; angle: number }[] = [];
  const span = FORMATION_ARC[formation];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    let angle = baseAngle + (t - 0.5) * span;
    let depth = margin;
    switch (formation) {
      case 'arc':
        // Bowed: the middle of the group leads.
        depth = margin + (1 - Math.sin(t * Math.PI)) * 90;
        break;
      case 'columns':
        // Three files, each a little further back than the last.
        angle = baseAngle + ((i % 3) - 1) * (span / 2);
        depth = margin + Math.floor(i / 3) * 64;
        break;
      case 'sides':
        // Two wings, alternating, each file stepping back.
        angle = baseAngle + (i % 2 === 0 ? -span / 2 : span / 2);
        depth = margin + Math.floor(i / 2) * 72;
        break;
      case 'centre':
        angle = baseAngle + (t - 0.5) * span;
        depth = margin + i * 48;
        break;
      case 'rhythm': {
        /*
         * The group laid out as a bar of music, wrapped around the arena: each
         * enemy sits on a sixteenth of the ring and `spawnGroup` staggers their
         * first volley to match, so they fire around the player in sequence.
         * It is the clearest statement of what this game is — the formation IS
         * a bar, and in the round the player is standing in the middle of it.
         */
        const step = Math.max(1, Math.floor(16 / Math.max(1, count)));
        const slot = (i * step) % 16;
        angle = baseAngle + (slot / 15 - 0.5) * span;
        depth = margin + (i % 2) * 40;
        break;
      }
      case 'line':
      default:
        depth = margin + (i % 2) * 26;
        break;
    }
    const p = edgePoint(angle, ring, depth);
    out.push({ x: p.x, y: p.y, angle });
  }
  return out;
}

/**
 * Screen positions for a formation of `count` enemies.
 *
 * Kept for the vertical layout that the arena replaced. Nothing in the
 * simulation calls it any more; `arenaSpawnPositions` is what `spawnGroup`
 * uses. It stays because the two are worth reading side by side — the
 * difference between them is the whole conversion in thirty lines — and
 * because deleting it would take the `y: -40` convention with it, which is
 * still what the boss's off-field entry assumes.
 */
export function formationPositions(formation: Formation, count: number, width: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const margin = 70;
  const span = width - margin * 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    switch (formation) {
      case 'line':
        out.push({ x: margin + t * span, y: -40 });
        break;
      case 'arc':
        out.push({ x: margin + t * span, y: -40 - Math.sin(t * Math.PI) * 90 });
        break;
      case 'columns':
        out.push({ x: margin + (i % 3) * (span / 2), y: -40 - Math.floor(i / 3) * 60 });
        break;
      case 'sides':
        out.push({ x: i % 2 === 0 ? margin : width - margin, y: -40 - Math.floor(i / 2) * 70 });
        break;
      case 'rhythm': {
        /*
         * The group laid out as a bar of music: each enemy sits on a sixteenth
         * of the screen's width, and `spawnGroup` staggers their first volley to
         * match. They then fire left to right, playing their own rhythm across
         * the playfield. It is the clearest possible statement of what this game
         * is — the formation IS a bar.
         */
        const step = Math.max(1, Math.floor(16 / Math.max(1, count)));
        const slot = (i * step) % 16;
        out.push({ x: margin + (slot / 15) * span, y: -40 - (i % 2) * 34 });
        break;
      }
      case 'centre':
      default:
        out.push({ x: width / 2 + (t - 0.5) * 160, y: -40 - i * 46 });
        break;
    }
  }
  return out;
}
