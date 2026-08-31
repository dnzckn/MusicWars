/**
 * The between-runs layer: points, a shop, a set list of stages.
 *
 * The owner's ask, verbatim, and every decision below answers some clause of
 * it:
 *
 * > "let's create a point system, speed to finish, etc, user can spend points
 * > in between rounds to unlock more powerups (weapons and passives), then make
 * > the initial game limited to only a few so 8 weapons and 8 passives (so we
 * > can still combine to 4 and 4). that way we have a continue, new game, and
 * > weapon shop menu before starting up another round, then progressively
 * > rounds become harder, but the user is selecting which round they would like
 * > to attempt, should be exponentially more rewards the deeper you go in
 * > stages, (not too exponential tho)"
 *
 * ## What this module is, and what it deliberately is not
 *
 * PURE, AND IT HAS TO BE. Everything here is arithmetic over plain values plus
 * two functions that touch `localStorage` behind a `try`. Nothing imports
 * `World`, nothing reads a clock, nothing emits. That is the same property
 * `progression.ts` has and for the same reason: it is what lets
 * `tools/stages.mjs` compute the payout of a simulated run without a browser
 * and without a second copy of the formula.
 *
 * HEADLESS-SAFE BY CONSTRUCTION, not by luck. `world.ts` states it plainly —
 * headless runs have no `localStorage` — and every gate in `tools/` is
 * headless. So the storage functions are the ONLY two that mention it, they
 * both guard on `typeof localStorage` *and* wrap in `try`, and nothing else in
 * this file calls them. Importing this module cannot throw in Node; the module
 * body reads no storage at all.
 *
 * ## Layering
 *
 *   meta.ts  ->  waves.ts   (TOTAL_WAVES, STAGE_COUNT — never the other way)
 *   meta.ts  ->  weapons.ts (the tables, read-only, for validation and text)
 *
 * `waves.ts` must not import this file. The stage TERMS live there because
 * `planWave` needs them sixteen times a run; the stage ECONOMY lives here
 * because nothing in the simulation needs it. A cycle between the two would be
 * the one import loop in `src/game/`.
 */

import { STAGE_COUNT, TOTAL_WAVES, stagePressure } from './waves';
import { INSTRUMENTS, RIG, characterOf, labelOf, slotOf, stepNote } from './weapons';

export { STAGE_COUNT };

/* ------------------------------------------------------------------------ *
 * The starting roster
 * ------------------------------------------------------------------------ */

/**
 * The eight instruments a new player starts with.
 *
 * ## Why gate at all
 *
 * `docs/plan-meta.md` §1: the roster being locked is what makes unlocking feel
 * like anything. A player who starts with all thirty has nothing to look
 * forward to; a player who starts with eight has twenty-two.
 *
 * ## Why THESE eight
 *
 * NOT A SLICE OF THE ARRAY. The roster is organised on ONE AXIS and the axis is
 * legible in the table itself: every one of the twenty instruments from the
 * property pass owns exactly one entry of `PROPERTY_NAMES`, and the ten added
 * by the delivery pass after it re-use a property somebody else already owns
 * with a different geometry. `STARTING_INSTRUMENT`'s note in `progression.ts`
 * says it in as many words — "a weapon is a PROPERTY: a hit leaves something
 * behind".
 *
 * So the starting eight are eight DIFFERENT PROPERTIES, and the twenty-two for
 * sale are the twelve remaining properties plus ten re-deliveries of properties
 * the player has already met. That ordering is the right way round: the first
 * hour teaches the axis, and every purchase after it is either a new idea or a
 * new way to throw an idea you understand.
 *
 *   ember      BURN    damage that keeps working after the hit    (starter)
 *   bow        LANCE   a line of damage through what it hits      (starter)
 *   timpani    QUAKE   a splash that reaches what you did not hit (starter)
 *   chime      FREEZE  hard control — the only stop in the set
 *   feedback   CHAIN   one hit reaching many bodies
 *   drones     BROOD   something that fights on its own
 *   siphon     LEECH   the only weapon that pays you back in health
 *   anvil      HEAVY   one enormous slow bolt, for the thing with the health bar
 *
 * THE THREE STARTERS ARE FORCED. `prog.STARTERS` is `['ember','bow','timpani']`
 * and the opening menu is built from it; an opener that is not in the base
 * roster is a run that begins with a gun the shop has not sold yet.
 * `tools/roster8.mjs` asserts the containment rather than trusting this comment.
 *
 * FIVE ROLES ARE DELIBERATELY HELD BACK and it is worth naming what the early
 * game therefore does not have, because it is the shape of the unlock curve:
 * no poison, no bleed, no blind, no hold, no charm, no ghost, no split, no
 * burst, no erode, no dark, no accel. The early game is burn, freeze and chain
 * over a lance and a drum — direct, legible, and short of tricks.
 *
 * ## What the choice cost, measured
 *
 * `tools/roster8.mjs` reports the numbers; the short version is that this set
 * was chosen against two competing objectives and is not the maximum of either.
 * The lattice-densest legal eight (`ember bow timpani chime tremolo anvil gravel
 * harp`) has SIXTEEN authored pair recipes among its twenty-eight pairs against
 * this set's nine — but it is four damage shapes and two damage-over-times with
 * no chain, no summon and no sustain, which is a richer fusion tree over a
 * narrower game. Nine authored pairs plus eight evolutions plus every generic
 * duet is a long way from thin, and the diversity is the thing the first hour
 * is for.
 */
export const BASE_INSTRUMENTS: readonly string[] = [
  'ember',
  'bow',
  'timpani',
  'chime',
  'feedback',
  'drones',
  'siphon',
  'anvil',
];

/**
 * The eight passives a new player starts with.
 *
 * SEVEN OF THE EIGHT ARE DETERMINED BY THE WEAPONS, and that is the point
 * rather than an accident. Every starting instrument has one authored
 * `evolution` recipe and that recipe names a passive; if the passive is locked,
 * the evolution is unreachable and the base roster's designed reward — the
 * thing `progression.ts` calls "the most interesting decision in the run" — is
 * content the player cannot see until they have bought their way to it.
 *
 *   ember    -> laser        bow      -> laser       (the two share one)
 *   timpani  -> reverb       chime    -> resonance
 *   feedback -> tempo        drones   -> fermata
 *   siphon   -> compressor   anvil    -> capo
 *
 * That is seven distinct catalysts, which leaves exactly one free chair.
 *
 * THE FREE CHAIR IS `rapid`, and the argument is that the seven above are all
 * side-effects — pierce, radius, xp, a trail, a stand-still bonus, a shield,
 * projectile speed — and not one of them is the dial every player in this genre
 * reaches for first. `rapid` is fire rate. Without it the starting rig has no
 * cadence lever at all, and cadence is the one axis a new player can feel
 * inside ten seconds.
 *
 * WHAT IS HELD BACK: `spread` (projectile count), `homing`, `magnet` (pickup
 * radius) and `timewarp`. Four passives against twenty-two instruments is a
 * lopsided shop and it is lopsided because the table is: there are only twelve
 * rig items in the whole game. The owner asked for "8 weapons and 8 passives"
 * and eight of twelve is what that sentence buys.
 *
 * `tools/roster8.mjs` asserts the evolution-reachability property directly off
 * `FUSIONS`, so a recipe re-pointed at a locked passive goes red rather than
 * quietly deleting an evolution.
 */
export const BASE_RIG: readonly string[] = [
  'laser',
  'reverb',
  'resonance',
  'tempo',
  'fermata',
  'compressor',
  'capo',
  'rapid',
];

/** Everything a run may draft before a single point has been spent. */
export const BASE_ROSTER: readonly string[] = [...BASE_INSTRUMENTS, ...BASE_RIG];

/**
 * Everything the shop can ever sell, in the order it is shown.
 *
 * DERIVED FROM THE TABLES, never listed. A second hand-written list of ids is
 * the failure this repository has been bitten by repeatedly — a new instrument
 * would be added to `weapons.ts`, be absent here, and be permanently
 * undraftable with nothing to say so. `tools/roster8.mjs` asserts that base
 * plus locked equals the whole draftable table, with the counts printed.
 */
export function lockedIds(): string[] {
  const base = new Set(BASE_ROSTER);
  const out: string[] = [];
  for (const d of INSTRUMENTS) if (!d.fused && d.weight > 0 && !base.has(d.id)) out.push(d.id);
  for (const d of RIG) if (d.weight > 0 && !base.has(d.id)) out.push(d.id);
  return out;
}

/** Every id that may ever be drafted, unlocked or not. */
export function allDraftableIds(): string[] {
  return [...BASE_ROSTER, ...lockedIds()];
}

/* ------------------------------------------------------------------------ *
 * Points
 * ------------------------------------------------------------------------ */

/**
 * What a run pays, before the stage multiplier.
 *
 * `docs/plan-meta.md` §2.1 names four terms and this is all four, with the
 * weights chosen so that each one is visible in the total rather than lost in
 * it. Read them as a stage-1 run:
 *
 *   a clear at par time      10 + 70 + 120 + 36  = 236
 *   a fast clear (0.6x par)  10 + 70 + 120 + 60  = 260
 *   a slow clear (1.6x par)  10 + 70 + 120 +  0  = 200
 *   died on wave 8            10 + 35             =  45
 *   died on wave 1            10 +  4             =  14
 *
 * THE FLOOR IS NOT DECORATION. A failed attempt that pays nothing makes trying
 * a hard stage feel bad rather than brave, which is the one thing that would
 * make the whole set list pointless: the reward curve can be as steep as it
 * likes and nobody will climb it if a miss is worth zero. It is small enough
 * that dying on purpose is never a strategy — a stage-1 death is 6% of a
 * stage-1 clear, and the run still costs the same minutes.
 *
 * SPEED IS SCALED AGAINST A PAR TIME FOR THAT STAGE, never against an absolute.
 * Deep stages contain far more enemies (`waves.ts` `STAGE_GROUPS`) and a wave
 * does not end until the field is clear, so a deep run is LONGER by
 * construction. An absolute clock would have paid the speed bonus almost
 * exclusively to shallow runs — the exact inversion of what the owner asked
 * for.
 */
const LOSS_FLOOR = 10;
const PROGRESS_POINTS = 70;
const CLEAR_POINTS = 120;
const SPEED_POINTS = 60;

/** A clear at this fraction of par earns the whole speed bonus. */
const SPEED_FAST = 0.6;
/** A clear at this fraction of par earns none of it. */
const SPEED_SLOW = 1.6;

/**
 * How long a stage-1 clear is expected to take, in seconds.
 *
 * MEASURED, NOT CHOSEN. `tools/stages.mjs` plays whole runs to their own end
 * with the base roster and prints the clear time per stage; this is fitted to
 * that table, and the tool asserts that par sits inside the measured spread so
 * it cannot silently drift into "nobody ever earns the speed bonus" or "the
 * speed bonus is automatic".
 *
 * The number to beat is not the mean: par is deliberately a little under it, so
 * the bonus is something a good run earns rather than something every run
 * collects.
 */
export const PAR_BASE_SECONDS = 900;

/**
 * How much longer par gets per stage step, as a fraction of `PAR_BASE_SECONDS`.
 *
 * Also measured. A deep stage is longer because it contains more enemies, and
 * `tools/stages.mjs` reports the slope of clear time against stage depth; this
 * is that slope. Getting it wrong in either direction is a real defect and both
 * are silent: too small and every deep clear reads as slow, too large and every
 * deep clear reads as fast.
 */
export const PAR_GROWTH = 0.16;

/** The par clear time for a stage, in seconds. */
export function parSeconds(stage: number): number {
  return PAR_BASE_SECONDS * (1 + stagePressure(stage) * PAR_GROWTH);
}

/**
 * "exponentially more rewards the deeper you go in stages, (not too exponential
 * tho)".
 *
 * A POWER LAW, WHICH IS THE HONEST READING OF THAT SENTENCE. `1.5^stage` is the
 * literal exponential and `docs/plan-meta.md` §2.2 rules it out with arithmetic
 * — 130x at stage 12, at which point every earlier stage is dead content and
 * the numbers have stopped meaning anything. `stage^E` grows fast and stays
 * finite; the whole question is E.
 *
 * ## The exponent was MEASURED and the plan's proposal did not survive
 *
 * `docs/plan-meta.md` proposed 1.6 and said in as many words that it was a
 * starting number to be measured. `tools/stages.mjs` is that measurement: it
 * plays whole runs at every stage, records clear time and outcome, and computes
 * POINTS PER MINUTE — because the question is not "does stage 8 pay more than
 * stage 1" (any positive exponent says yes) but "does an hour spent at stage 8
 * beat an hour spent farming stage 1". A deep stage takes longer, so the time
 * denominator is what decides it, and the plan's table has no time in it at
 * all.
 *
 * The two failure modes bracket the answer and both are checked:
 *
 *   too flat   farming the shallowest stage wins on points per minute, the
 *              depth decision is never worth making, and the meta collapses
 *              into repetition
 *   too steep  the ratio between neighbouring stages runs away, so every stage
 *              but the deepest reachable one is dead content
 *
 * The second one bites `stage^1.6` at the FIRST STEP, which is where nobody
 * looks: `2^1.6 / 1^1.6` is 3.03. One step of depth triples the payout at the
 * exact moment the player is weakest and has bought nothing. The far end is
 * tame by comparison — `12^1.6 / 11^1.6` is 1.15.
 *
 * See `tools/stages.mjs` for the measured table and the exponent it settled on.
 */
export const REWARD_EXPONENT = 1.35;

/**
 * A constant added to the stage before the power, and it is why the curve is
 * usable at the shallow end.
 *
 * `(stage + SHIFT) ^ E`, normalised so stage 1 is exactly 1.0. A bare `s^E` has
 * its steepest RELATIVE step between stage 1 and stage 2 and flattens from
 * there, which is backwards: that is the one step a new player must take, with
 * the weakest roster they will ever have. Shifting the origin evens the steps
 * out — the first ratio falls and the last ones rise slightly — without
 * changing the shape of the curve or its top end much at all.
 *
 * `tools/stages.mjs` prints the full multiplier table and the neighbour ratios
 * and asserts a ceiling on the largest of them, which is "not too exponential"
 * written as arithmetic rather than as a feeling.
 */
const REWARD_SHIFT = 1.4;

/**
 * The curve with the exponent supplied, so it can be SWEPT.
 *
 * Exported for `tools/stages.mjs`, which has to compare candidate exponents
 * against measured run times. The alternative was for the tool to re-implement
 * `((s + shift) / (1 + shift)) ^ E`, and AGENTS.md §3 is unambiguous about
 * that: a tool holding its own copy of a formula will lie the day the formula
 * moves, and it will lie in the direction of confirming whatever it was built
 * to test.
 */
export function stageRewardWith(stage: number, exponent: number): number {
  const s = stagePressure(stage) + 1;
  return Math.pow((s + REWARD_SHIFT) / (1 + REWARD_SHIFT), exponent);
}

/** How much a stage multiplies everything a run earns. Stage 1 is exactly 1. */
export function stageReward(stage: number): number {
  return stageRewardWith(stage, REWARD_EXPONENT);
}

export interface RunResult {
  /** 1-based. */
  stage: number;
  /** `World.totals.wavesCleared`. */
  wavesCleared: number;
  /** `World.snapshot.time`, in seconds. */
  seconds: number;
  won: boolean;
}

export interface RunPayout {
  points: number;
  /** Every term, unrounded and before the stage multiplier, for the summary. */
  floor: number;
  progress: number;
  clear: number;
  speed: number;
  /** The multiplier that was applied. */
  multiplier: number;
  /** 0..1: how much of the speed bonus was earned. */
  speedFraction: number;
  /** 0..1: how far into the run the player got. */
  depth: number;
}

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/**
 * What a finished run pays.
 *
 * PURE, AND THE ONLY PLACE THE FORMULA EXISTS. `main.ts` calls it on
 * `run:over`; `tools/stages.mjs` calls it on a headless run's result. Two
 * copies of an economy is how a shop ends up charging prices the game cannot
 * pay, and this repository's standing rule (AGENTS.md §3) is that a tool
 * holding its own copy of a constant will lie.
 */
export function computeRunPoints(r: RunResult): RunPayout {
  const depth = clamp01(r.wavesCleared / TOTAL_WAVES);
  const par = parSeconds(r.stage);
  const speedFraction = r.won ? clamp01((SPEED_SLOW * par - r.seconds) / ((SPEED_SLOW - SPEED_FAST) * par)) : 0;
  const floor = LOSS_FLOOR;
  const progress = PROGRESS_POINTS * depth;
  const clear = r.won ? CLEAR_POINTS : 0;
  const speed = r.won ? SPEED_POINTS * speedFraction : 0;
  const multiplier = stageReward(r.stage);
  return {
    points: Math.max(0, Math.round((floor + progress + clear + speed) * multiplier)),
    floor,
    progress,
    clear,
    speed,
    multiplier,
    speedFraction,
    depth,
  };
}

/* ------------------------------------------------------------------------ *
 * The shop
 * ------------------------------------------------------------------------ */

/**
 * What the next unlock costs, given how many have already been bought.
 *
 * RISING, LINEARLY, AND UNIFORM ACROSS ITEMS. Three decisions, each of which
 * `docs/plan-meta.md` §3 leaves open:
 *
 * RISING rather than flat, because the reward curve rises. A flat price means
 * the twenty-sixth unlock costs what the first did, at a point where the player
 * is clearing stages worth twenty times as much — so the last two thirds of the
 * shop empties itself in one evening and points stop meaning anything for the
 * rest of the game. Rising prices are what pace the unlock curve against the
 * reward curve.
 *
 * LINEARLY rather than geometrically, because the reward curve is a power law
 * and not an exponential. `1.15^n` over twenty-six unlocks is a final price
 * forty times the first, which is a wall; `150 + 50n` ends at 1400, which is
 * roughly a third of one clear of stage 6. The shop should slow down, not stop.
 *
 * UNIFORM ACROSS ITEMS rather than per-item, and this one is a refusal rather
 * than a preference. Pricing ANVIL above EMBER would be a balance claim, and
 * this project's whole culture is that a balance claim needs a measurement
 * behind it. There is no measurement of relative item value here and inventing
 * one from taste would be a number nobody could ever check. What the player
 * chooses is WHICH, not how much — and "which" is the interesting half.
 */
export const UNLOCK_BASE = 150;
export const UNLOCK_STEP = 50;

export function unlockPrice(bought: number): number {
  return UNLOCK_BASE + UNLOCK_STEP * Math.max(0, Math.floor(bought));
}

export interface ShopRow {
  id: string;
  label: string;
  slot: 'instrument' | 'rig';
  /**
   * The mechanics line, taken from `stepNote(id, 1)`.
   *
   * THE SAME STRING THE LEVEL-UP CARD SHOWS. `availableOptions` builds a new
   * option's `note` as `stepNote(def.id, level)` with `level === 1`, so this is
   * byte-identical to what the player will read on the card the first time the
   * thing is offered to them. `docs/plan-meta.md` §3 requires exactly this and
   * says why: a second description invented for the shop is a second
   * description to keep in step, and this repository has watched two copies of
   * one string drift three separate times.
   *
   * `tools/roster8.mjs` asserts the equality against `availableOptions` rather
   * than trusting the call above.
   */
  note: string;
  character: string;
  owned: boolean;
}

/**
 * The shop's contents: everything not in the base roster, owned first.
 *
 * Owned rows are kept rather than filtered out, because a shop that hides what
 * you bought cannot show you what you have — and the collection IS the
 * meta-progression the player is buying.
 */
export function shopRows(meta: MetaState): ShopRow[] {
  const owned = new Set(meta.unlocked);
  return lockedIds().map((id) => ({
    id,
    label: labelOf(id),
    slot: slotOf(id) === 'rig' ? 'rig' : 'instrument',
    note: stepNote(id, 1),
    character: characterOf(id),
    owned: owned.has(id),
  }));
}

/* ------------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------------ */

export interface MetaState {
  /** Bumped when the shape changes. A mismatch is treated as no save at all. */
  version: number;
  /** Unspent points. */
  points: number;
  /** Ids bought in the shop. Never includes the base roster. */
  unlocked: string[];
  /** The deepest stage ever CLEARED. 0 before the first win. */
  highestCleared: number;
  /** Stage -> best clear time in seconds. Only winning runs write here. */
  best: Record<string, number>;
  /** Lifetime points earned, for the menu's own readout. */
  earned: number;
}

export const META_VERSION = 1;
export const META_KEY = 'musicwars.meta';

export function defaultMeta(): MetaState {
  return { version: META_VERSION, points: 0, unlocked: [], highestCleared: 0, best: {}, earned: 0 };
}

/**
 * Turn anything at all into a usable `MetaState`.
 *
 * ## The policy for a corrupt or partial payload, stated
 *
 * **A settings read is never worth failing a boot over**, which is the rule
 * `main.ts` already follows for `bestScore` and the autopick preference and
 * which `docs/plan-meta.md` §5 restates. So there is no error path out of here:
 * every input produces a state, and the only question is how much of the
 * player's save survives.
 *
 *   not an object / null / a string / an array   -> a fresh save
 *   `version` absent or not `META_VERSION`       -> a fresh save
 *   a field missing or the wrong type            -> that field's default, the
 *                                                   rest of the save kept
 *   a number that is NaN, Infinity or negative   -> 0
 *   an id that is not in the table, or is base,
 *   or is a duplicate                            -> dropped from `unlocked`
 *   a `best` entry outside the set list, or not
 *   a positive finite number                     -> dropped
 *
 * FIELD-BY-FIELD RATHER THAN ALL-OR-NOTHING, and the difference matters: a
 * player whose `best` map got mangled should not lose the twenty weapons they
 * bought. Only a payload whose SHAPE cannot be trusted — a different version,
 * or not an object — is discarded whole, because in that case nothing inside it
 * has a known meaning.
 *
 * A DROPPED UNLOCK IS NOT REFUNDED. An id that no longer exists in the table
 * cannot be sold back for a price that depends on how many were bought, and a
 * refund path is a second way for points to appear. It is dropped silently; the
 * player keeps their points balance and can buy something that does exist.
 */
export function sanitiseMeta(raw: unknown): MetaState {
  const out = defaultMeta();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (o.version !== META_VERSION) return out;

  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  out.points = num(o.points);
  out.earned = Math.max(num(o.earned), out.points);
  out.highestCleared = Math.min(STAGE_COUNT, num(o.highestCleared));

  if (Array.isArray(o.unlocked)) {
    const legal = new Set(lockedIds());
    const seen = new Set<string>();
    for (const id of o.unlocked) {
      if (typeof id !== 'string' || !legal.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.unlocked.push(id);
    }
  }

  if (typeof o.best === 'object' && o.best !== null && !Array.isArray(o.best)) {
    for (const [k, v] of Object.entries(o.best as Record<string, unknown>)) {
      const stage = Number(k);
      if (!Number.isInteger(stage) || stage < 1 || stage > STAGE_COUNT) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      out.best[String(stage)] = v;
    }
  }
  return out;
}

/**
 * Read the save.
 *
 * The one function in this module that touches storage, together with
 * `saveMeta`. Both guard on `typeof localStorage` — which is what makes them
 * safe in Node, where the identifier is not merely empty but ABSENT, so a bare
 * mention is a `ReferenceError` rather than a null — and both then wrap in
 * `try`, which is what makes them safe in private-mode Safari, where the
 * identifier exists and the CALL throws.
 *
 * Two guards, two different failures. Either one alone is a boot crash on some
 * real platform.
 */
export function loadMeta(): MetaState {
  try {
    if (typeof localStorage === 'undefined') return defaultMeta();
    const text = localStorage.getItem(META_KEY);
    if (!text) return defaultMeta();
    return sanitiseMeta(JSON.parse(text));
  } catch {
    /* A corrupt save, a full quota, a browser that refuses. Start fresh. */
    return defaultMeta();
  }
}

/** Write the save. Returns whether it actually landed. */
export function saveMeta(meta: MetaState): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return true;
  } catch {
    /* The run still counted; only the record of it is lost. */
    return false;
  }
}

/* ------------------------------------------------------------------------ *
 * Acting on the save
 * ------------------------------------------------------------------------ */

/**
 * Everything this save may draft, as the set `ProgressionState.unlocked` wants.
 *
 * Built fresh on each run rather than cached: the shop mutates `meta.unlocked`
 * between runs, and a cached set is how a purchase ends up taking effect only
 * after a reload.
 */
export function unlockedRoster(meta: MetaState): Set<string> {
  return new Set([...BASE_ROSTER, ...meta.unlocked]);
}

/** How many stages the save may attempt: everything cleared, plus one. */
export function deepestOffered(meta: MetaState): number {
  return Math.min(STAGE_COUNT, Math.max(1, meta.highestCleared + 1));
}

export function stageUnlocked(meta: MetaState, stage: number): boolean {
  return stage >= 1 && stage <= deepestOffered(meta);
}

/** The price of the next unlock for this save. */
export function nextPrice(meta: MetaState): number {
  return unlockPrice(meta.unlocked.length);
}

/**
 * Buy one thing. Returns false and changes nothing if it cannot be bought.
 *
 * The three refusals are separate on purpose: an id that is not for sale is a
 * bug in the caller, an id already owned is a double-click, and not enough
 * points is the ordinary case. All three leave the save untouched.
 */
export function buy(meta: MetaState, id: string): boolean {
  if (!lockedIds().includes(id)) return false;
  if (meta.unlocked.includes(id)) return false;
  const price = nextPrice(meta);
  if (meta.points < price) return false;
  meta.points -= price;
  meta.unlocked.push(id);
  return true;
}

/**
 * Bank a finished run.
 *
 * Returns the payout so the caller can show the breakdown; mutates the save
 * with the points, the stage unlock and the best time. The caller is
 * responsible for persisting — the split exists so `tools/stages.mjs` can run
 * thousands of these without ever mentioning storage.
 */
export function recordRun(meta: MetaState, r: RunResult): RunPayout {
  const payout = computeRunPoints(r);
  meta.points += payout.points;
  meta.earned += payout.points;
  if (r.won) {
    const stage = stagePressure(r.stage) + 1;
    meta.highestCleared = Math.max(meta.highestCleared, stage);
    const key = String(stage);
    const prev = meta.best[key];
    if (!prev || r.seconds < prev) meta.best[key] = r.seconds;
  }
  return payout;
}
