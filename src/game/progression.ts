/**
 * Progression: XP, levels, slots, offers, and fusion.
 *
 * A Vampire-Survivors-shaped run economy, adapted to a game where the loadout
 * *is* the mix. The whole module is pure: state goes in, events go in, offers
 * and effects come out. Nothing here imports `World` or `Player`, nothing here
 * emits on the bus, and nothing here reads a clock — which is why it is the one
 * system in this repository that can be tested exhaustively without a browser
 * (see `tools/levelup.mjs`).
 *
 * ## What was borrowed, and what was not
 *
 * Borrowed, because it is what makes the genre work:
 *
 *   - **XP shards from every kill, tiered by value** (minor/major/rare, which is
 *     Vampire Survivors' blue/green/red). The pickup radius is a passive, so
 *     "collect more" is itself a build decision.
 *   - **A choice of four on level-up**, drawn from a pool that shrinks as you
 *     commit. The interruption is the beat of the run: it is where the identity
 *     of the run gets decided.
 *   - **Two small inventories.** Instruments and rig have separate slots. Once
 *     they are full the offer pool can only *level what you already hold*, and
 *     that is the entire reason a run becomes a build rather than a list.
 *   - **Reroll, skip and banish**, which are the levers that let a player aim at
 *     an evolution instead of hoping for one.
 *   - **Evolution at max level, gated behind a boss.** In Vampire Survivors the
 *     gate is a treasure chest from a boss after ten minutes. Here it is the
 *     boss itself: the fusion lands on the boss's death, which is already the
 *     biggest musical event the game has.
 *
 * Not borrowed, deliberately:
 *
 *   - **The level-20 and level-40 XP surcharges.** They exist in Vampire
 *     Survivors to pace meta-progression across many runs, which this game does
 *     not have. Copying them would import a wall with no reason behind it. The
 *     curve here keeps VS's *shape* — a step size that increases in tiers — and
 *     drops the surcharges.
 *   - **Pausing the MUSIC on level-up.** Everything on this field runs off the
 *     transport's absolute beat position, and stopping the repl rewinds
 *     Strudel's cycle counters (measured, four bars). The offer opens on a bar
 *     line, the WORLD stops, and the transport keeps running — emitters are
 *     pushed forward by the held beats so the grid never breaks. The world
 *     itself did dilate to 12% for a long time rather than stopping; see the
 *     offer block in `world.ts` for why that was right and why it changed.
 *   - **Slots are narrow and FIXED.** Four instrument slots and three rig
 *     slots, for the whole run — see `STAND_SLOTS`/`RIG_SLOTS` below. This is
 *     not cosmetic: with six of each open, thirty level-ups spread across
 *     twelve tracks and *nothing ever reaches max*, so no evolution is
 *     reachable in a run of realistic length. A cap only creates decisions
 *     while it binds, so these ones never stop binding. Slots used to start at
 *     three and grow by one per boss; that growth was removed, and bosses now
 *     pay rerolls, banishes and fusion resolution instead.
 *
 * ## The one number that must be re-measured
 *
 * `XP_BASE` and the step tiers are calibrated against the shard economy as it
 * stands. The arena conversion changes how many enemies a player meets per
 * minute, which changes XP income, which moves every level-up in the run. Run
 * `node tools/levelup.mjs` after the arena lands and re-read the level-at-time
 * table before trusting any of these constants. A budget denominated in an
 * event whose rate is being changed will move under you — this codebase has
 * been caught by that three times already.
 */

import type { AbilityId, AbilitySlot, EvolvedId, ShardTier } from '../core/events';
import { Rng } from '../core/rng';
import {
  FUSIONS,
  INSTRUMENTS,
  INSTRUMENT_MAX_LEVEL,
  RIG,
  RIG_MAX_LEVEL,
  DUET_INPUT_LEVEL,
  characterOf,
  duetId,
  duetParents,
  instrumentDef,
  labelOf,
  maxLevelOf,
  rigDef,
  rigModifiers,
  rigRules,
  slotOf,
  stepNote,
  type Modifiers,
  type Rules,
} from './weapons';

/* ------------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------------ */

/*
 * RECALIBRATED AGAINST THE ARENA. The old values are in the diff and the
 * reasoning for replacing them is the point of this comment.
 *
 * They were `6 / 4 / 7 / 11` with tiers at 20 and 30, chosen against a modelled
 * income of nine kills a minute rising to thirty — an approximation of the
 * VERTICAL game, written before the arena existed, and honest about it: the
 * comment on `simulateRun` in `tools/levelup.mjs` says in as many words that
 * the arena conversion is going to move all of it and that the pacing table
 * should be re-read afterwards.
 *
 * It moved by a factor of four. Measured headless over four eight-minute runs
 * (`node tools/arena.mjs 8 4`), the arena produces THIRTY kills in the first
 * minute rising past a hundred and thirty by the seventh, because auto-fire
 * plus a seeking starter plus a six-instrument ensemble is simply a different
 * player. Against the old curve that meant **52 level-up offers in eight
 * minutes** — one every nine seconds.
 *
 * That number is the defect, and it is not a difficulty problem. A level-up is
 * the one moment in a run where the world stops and the player reads four
 * cards instead of dodging; at one every nine seconds the interruption stops
 * being a beat in the run and becomes the run. Vampire Survivors' own pacing is
 * closer to one every twenty to forty seconds. These are now a true pause, so
 * they cost the player nothing in danger — but they still cost the RUN its
 * momentum, and one every nine seconds is still too many.
 *
 * So the curve is roughly twice as steep and the late tiers bite earlier. The
 * target was one offer per twenty-plus seconds sustained, which is what
 * `tools/arena.mjs` now measures directly. This is the fourth budget in this
 * codebase to be re-denominated after the event it counts changed rate; the
 * difference this time is that the rate was measured first.
 */

/** Cost of level 1 -> 2. */
/*
 * XP costs raised ~1.7x with the 3-level ladder (base 10 -> 17, and the three
 * step tiers 9/24/55 -> 15/41/94).
 *
 * A level-up now buys about 2.7x what it used to, because an instrument reaches
 * its ceiling in 3 rungs rather than 8. Leaving the XP curve alone meant the
 * same flood of levels each carrying far more power, which is how the arena
 * gate ended up red at 0.02 encirclement. Slowing the clock restores the
 * relationship `scaleForEnsemble` explicitly depends on — its comment calls
 * wave index "the honest proxy" for player power "because levels arrive on a
 * clock the pacing table already fixes", and that clock is this.
 *
 * 1.7x rather than the full 2.7x, and the difference is deliberate. Swept at
 * 1.8x and 2.6x on its own: encirclement reached only 0.12 either way, and the
 * heavier slowdown cost fusions 5.00 -> 3.33 — undoing the thing the ladder
 * change existed to deliver. The pacing problem is not solved here; it is
 * solved by enemy lifetime in `scaleForEnsemble`. This only stops the level
 * torrent making that job impossible, and is kept light for that reason.
 *
 * Measured after, with all three changes in: level 66 in a twenty-minute run
 * against 57 before the ladder change, one offer every 18.5s, fusions 5.67.
 */
export const XP_BASE = 17;
/** How much each further level costs, per tier. Vampire Survivors' 10/13/16. */
const XP_STEP_EARLY = 15;
const XP_STEP_MID = 41;
const XP_STEP_LATE = 94;
const XP_TIER_MID = 14;
const XP_TIER_LATE = 23;

/** Options on the level-up screen. Vampire Survivors offers three or four. */
export const OFFER_SIZE = 4;

/*
 * FOUR ON STAGE, THREE IN THE RIG, AND THEY NEVER GROW.
 *
 * Slots used to start at 3+3 and grow to 6+6, one per boss. Measured over
 * 20-minute runs: both banks were full by character level 10-11 — a few minutes
 * into a run that reaches level 55-65 — and after that point 91.9-97.2% of
 * level-up offers contained nothing the player did not already own. That state
 * is about 70% of a run. Two thirds of every run was spent picking which of
 * twelve owned things got +1.
 *
 * A cap only creates decisions while it BINDS. Growing to 6+6 by minute five is
 * a cap that stops binding, which is the same as not having one. Four and three
 * are inside the shipped consensus — Ball x Pit runs 3-5 balls and 4-5
 * passives, Hades gives 5 exclusive boons for a whole run, Dead Cells 2+2 — and
 * they bind for the entire run.
 *
 * Four is the minimum that can hold two fusable pairs at once, which is what
 * makes combining a plan rather than an accident. Three rig slots against
 * twelve rig items is real exclusion: you cannot carry every catalyst, so
 * choosing one is choosing what you are building toward.
 *
 * A run opens holding `pizzicato`, so the first draft still has 3 free chairs
 * and 3 free rig slots — the early game feels as it did. What changes is that
 * it never stops feeling that way.
 *
 * Bosses no longer grant slots. They grant rerolls, banishes and the fusion
 * resolution; see `onBossDefeated`.
 */
export const STAND_SLOTS = 4;
/*
 * THREE BECAME FOUR, AND THE OWNER ASKED FOR IT: four weapons and four
 * passives.
 *
 * `docs/plan-refactor-3.md` §3 states it in one line — "`STAND_SLOTS` is
 * already 4. `RIG_SLOTS` is 3 and becomes 4" — and it is worth writing down
 * what that costs, because AGENTS.md §5 records a standing objection to
 * widening the rig: a thirteenth PASSIVE breaks the deliberate 12x12 symmetry
 * and is preferentially spent by `sacrificeFor`, which protects catalysts. A
 * fourth SLOT is a different change. It adds no card, displaces nothing in the
 * zero-sum offer, and the twelve items stay twelve.
 *
 * What it does move is `docs/plan-passives.md` §4's LOCKED measurement — 46% of
 * offers could not deal the catalyst a fusion needed, because the rig was full
 * and a passive you do not hold cannot be offered. A fourth chair is the
 * cheapest available answer to that, and it is the one the brief asks for.
 * `tools/combine.mjs` is where the LOCKED rate is read.
 */
export const RIG_SLOTS = 4;

export const REROLLS_START = 2;
export const BANISHES_START = 1;

/**
 * How much the offer pool leans toward the build a player is assembling.
 *
 * Vampire Survivors gets concentration for free from its inventory: six slots
 * fill early in a thirty-minute run, so almost every later offer is necessarily
 * a level-up of something already owned. A MusicWars run is a fraction of that
 * length, which is why the slots here are narrow and fixed — they do most of
 * that work, and these two numbers are what is left over.
 *
 * **Mutable on purpose.** `tools/levelup.mjs` ablates each term against the same
 * seeds, because a bias whose effect has not been measured against its own
 * absence is a taste rather than a decision. That ablation has already deleted
 * one term, and it may yet delete these:
 *
 *   catalyst    earns its keep. Removing it drops a building player's chance of
 *               reaching any fusion from 95% to 89%, and fusions per run from
 *               1.72 to 1.44.
 *   completes   invisible in the aggregate — 95% either way — and decisive in
 *               the tail, which is the only place it was ever meant to act.
 *               With it, a player standing one card away from a fusion draws
 *               that card in 82% of offers and never waits more than 4. Without
 *               it: 52%, and a measured worst case of *fourteen* consecutive
 *               level-ups withholding the last card. No one would call that bad
 *               luck. They would call it the game being broken.
 *
 * There was a third term, a general `focus` multiplier on anything already
 * held. It was **deleted because it measured harmful**: it spread weight evenly
 * over everything in the loadout, which crowded out the one card the player was
 * actually waiting for, and removing it *raised* the fusion rate from 95% to
 * 98%. It is written down rather than silently dropped because it is the
 * obvious thing to reach for and the measurement says not to.
 */
export const OFFER_TUNING = {
  /** Weight multiplier on the rig item that catalyses an instrument you are maxing. */
  catalyst: 2.0,
  /**
   * Instrument level at which the game starts nudging its catalyst toward you.
   *
   * THIS NUMBER MUST STAY BELOW `INSTRUMENT_MAX_LEVEL` OR THE ENTIRE CATALYST
   * PIPELINE GOES DARK, and that is not a theoretical hazard — it is what
   * happens if you shorten the instrument ladder and leave this at 5.
   *
   * Two separate mechanisms read it and both fail SILENTLY when it is
   * unreachable. `weightOf` uses it to raise a catalyst's draw weight, which
   * merely stops helping. `catalysesPursued` uses it to decide whether a FULL
   * rig may be offered a passive it does not hold — and that is the only escape
   * from the dead end `OfferOption.replaces` exists to fix. Set this above the
   * instrument ceiling and `catalysesPursued` returns false for every id
   * forever, every swap card disappears, and a player whose three rig slots
   * filled before they picked a recipe can never fuse again. Nothing throws,
   * no gate goes red, and the HUD keeps saying ONE STEP AWAY.
   *
   * The instrument ladder is three rungs now (see `INSTRUMENT_MAX_LEVEL`), so
   * this is 2: one pick short of the ceiling, which is the same relationship 5
   * had to 8 in spirit and a tighter one in fact. It fires while the player can
   * still act on it, which is the whole promise — "past this level the game
   * says it has noticed what you are building", and it now has one pick's
   * warning rather than three.
   */
  catalystHintLevel: 2,
  /** Weight multiplier on an option that would complete a fusion outright. */
  completes: 3.0,
  /**
   * Absolute weight of a READY fusion card — an ARRANGEMENT or a DUET that
   * could be taken right now.
   *
   * Not a multiplier: a fused instrument's own weight is 0 by design (it must
   * never be draftable as an ordinary card), so there is nothing to multiply.
   * 6.0 against a typical instrument's 1.0 means a ready combination is usually
   * but not always among the four, which is the difference between a decision
   * and an announcement.
   */
  fusion: 6.0,
};

/**
 * World time scale while an offer is open.
 *
 * RETIRED. Kept only as the record of a decision that stood for a long time.
 *
 * The world ran at 12% during an offer rather than stopping, because the
 * transport must keep running or the beat-scheduled stage desynchronises from
 * the track. That reasoning was sound and still is — what changed is that the
 * two clocks can be separated: the world stops, the transport does not, and
 * `Emitter.delayBy` absorbs the difference. See the offer block in `world.ts`.
 *
 * Nothing reads this. It is `0.12` and it means nothing now; do not wire it
 * back up without reading that block first.
 */
export const LEVEL_UP_TIME_SCALE = 0.12;

/** Shard values. Vampire Survivors' blue / green / red. */
/*
 * Re-exported, not re-declared.
 *
 * The layering rule in core/events.ts says core must not import from game/,
 * and GraceKind obeys it by keeping a second copy of a three-member union.
 * ShardTier is now needed on BOTH sides -- the shard:collect event carries it
 * and every prog.ShardTier reference in game/ expects it here -- so it is
 * declared once in core and re-exported from its historical home. That keeps
 * the dependency pointing the right way AND avoids the drift a second copy
 * invites, which is the failure mode this repo has been bitten by before.
 */
export type { ShardTier };
export const SHARD_XP: Readonly<Record<ShardTier, number>> = { minor: 1, major: 4, rare: 12 };

/* ------------------------------------------------------------------------ *
 * The XP curve
 * ------------------------------------------------------------------------ */

/** XP to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  const n = Math.max(1, Math.floor(level));
  if (n < XP_TIER_MID) return XP_BASE + XP_STEP_EARLY * (n - 1);
  const atMid = XP_BASE + XP_STEP_EARLY * (XP_TIER_MID - 1);
  if (n < XP_TIER_LATE) return atMid + XP_STEP_MID * (n - XP_TIER_MID);
  const atLate = atMid + XP_STEP_MID * (XP_TIER_LATE - XP_TIER_MID);
  return atLate + XP_STEP_LATE * (n - XP_TIER_LATE);
}

/** Total XP a run must bank to reach `level` from level 1. */
export function xpToReach(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpToNext(n);
  return total;
}

/**
 * What a kill scatters, split by tier.
 *
 * COUNT AND VALUE ARE DECOUPLED, and the first version of this got that wrong
 * in a way only the arena exposed. It was `3 + toughness * 2` shards, matched
 * to what `World.spawnNotes` already produced so the visual density of the
 * field would not change — a good instinct against a roster whose toughness
 * topped out at 1.85x baseline.
 *
 * The arena scales enemy hp with the run to keep pace with a six-instrument
 * ensemble, so `toughness` now reaches ten or more. Measured headless, that
 * turned a single kill into twenty-three shards and a busy wave into several
 * hundred: the pool cap in `spawnShards` is 320 and runs were sitting on it,
 * which means the field was carpeted, the pickup pull had nothing to
 * discriminate between, and — because every shard is XP — the level curve ran
 * to L50 in five minutes against a table built for L18.
 *
 * So the count grows slowly and CAPS, while the value grows by promoting
 * shards to better tiers. That is what Vampire Survivors does and it is the
 * more legible design anyway: a tough kill drops a red gem, not fifty blue
 * ones, and "that one is worth crossing the arena for" is a thing a player can
 * see. Total XP per kill is close to what the old formula gave — 45 against 49
 * at toughness 10 — so this is a change of shape rather than of income.
 */
export function shardsForKill(maxHp: number, big: boolean): { minor: number; major: number; rare: number } {
  const toughness = Math.max(1, Math.round(maxHp / 12));
  // A boss is the one case where the scatter should read as a payday, so it
  // keeps a large fixed spray rather than being folded into the curve.
  if (big) return { minor: 18, major: 10, rare: 6 };
  const count = Math.min(9, 3 + Math.floor(toughness / 2));
  const rare = toughness >= 10 ? 2 : toughness >= 6 ? 1 : 0;
  const major = Math.max(0, Math.min(count - rare, Math.floor(toughness / 2)));
  return { minor: count - rare - major, major, rare };
}

/** XP a kill is worth if every shard it scattered is collected. */
export function xpForKill(maxHp: number, big: boolean): number {
  const s = shardsForKill(maxHp, big);
  return s.minor * SHARD_XP.minor + s.major * SHARD_XP.major + s.rare * SHARD_XP.rare;
}

/* ------------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------------ */

export type GraceKind = 'rest' | 'bomb' | 'shards';

export interface OfferOption {
  /**
   * Null for a grace option, which is not an ability. A DUET card carries a
   * synthesised id (`a+b`) that is not a member of `AbilityId` — every lookup
   * for it goes through `instrumentDef` in `weapons.ts`, which resolves both.
   */
  id: AbilityId | string | null;
  slot: AbilitySlot | null;
  /** The level this option would take the ability to. 1 means it is new. */
  level: number;
  isNew: boolean;
  label: string;
  /** What the player will notice. Never a bare number. */
  note: string;
  /** For the audio side and the card's colour. */
  character: string;
  /**
   * Set when taking this option puts the last piece of a fusion in place, so
   * the HUD can say so. Announcing the pair is the difference between a system
   * a player discovers and one they merely experience.
   */
  completes: EvolvedId | null;
  /**
   * The held rig item this card would SPEND to make room for itself.
   *
   * A full rig cannot be offered a passive it does not already hold, and that
   * turned out to decide runs. Measured over eight 15-minute runs by the most
   * fusion-focused policy the game permits, 159 of 416 offers — 38% — could
   * not deal the catalyst the player was visibly building toward, because
   * three slots had filled with something else. The split was not gradual: four
   * runs were locked out for 35-44 consecutive offers and four were never
   * locked at all. A coin flip in the first minute silently decided whether
   * the goal was reachable, while the HUD went on saying ONE STEP AWAY.
   *
   * Loosening the slot limit would have fixed it and cost the game the thing
   * that makes a build a build. So the catalyst is offered anyway, and it
   * arrives with a price: the card names the passive it replaces. Scarcity is
   * intact, the dead end is gone, and what was a silent impossibility is now
   * the most interesting decision in the run — give up something working to
   * finish something better.
   *
   * -------------------------------------------------------------------------
   * `tools/combine.mjs` STILL PRINTS A LOCKOUT AND THE NUMBER IS A PROXY. Read
   * this before acting on it.
   *
   * That tool reports "LOCKED: 193 of 424 offers (46%) could not deal the
   * catalyst at all", which reads as an indictment of this mechanism. It is
   * not measuring this mechanism. Its test is `rig is at capacity && the
   * catalyst is not held` — it never asks `availableOptions` whether the swap
   * card would have been dealt, so every offer this block RESCUES is still
   * counted as locked.
   *
   * Asked of `availableOptions` directly, over the same eight 900s runs and the
   * same committed policy, counting only offers where a catalyst was still
   * needed (denominators are the whole point here):
   *
   *     ceilings 8/5   172 pursuit offers   catalyst in the legal pool  82%
   *                                         absent                      18%
   *     ceilings 3/3   198 pursuit offers   catalyst in the legal pool  60%
   *                                         absent                      40%
   *
   * So the true absence rate was 18%, not 46% — the proxy over-counts by two
   * and a half times.
   *
   * AND THE CAUSE IS NOT THE RIG CAP. Every single absence in both trees was
   * `catalysesPursued` declining, and `sacrificeFor` returned null **zero**
   * times out of 31 and zero out of 80. Splitting the refusals by what the
   * target base was actually standing at when they happened: at the 3/3
   * ceilings, 76 of 80 were an instrument the player did not own AT ALL (level
   * 0) and the other 4 were at level 1, one pick under the hint. Not one
   * refusal was aimed at a player who had invested in the base.
   *
   * That is the hint gate doing its job. The committed bot picks its target the
   * first time any recipe's base appears in an OFFER, which is not the same as
   * holding it, so it spends much of the run demanding a swap for an instrument
   * it has never taken. Widening this block to serve that would sell a held
   * passive to chase something the player has shown no commitment to, which is
   * the opposite of what `OfferOption.replaces` is for.
   *
   * The binding constraint on fusion was never this. It was the length of the
   * two ladders: cutting them 8/5 -> 3/3 moved designed fusions per run from
   * 2.00 to 5.75 while the LOCKED proxy barely moved, 46% -> 42%.
   */
  replaces: AbilityId | string | null;
  grace: GraceKind | null;
  /**
   * Set when this card IS the fusion rather than a step toward one.
   *
   * Fusions used to fire by themselves the moment their inputs were both at
   * max, resolved in a batch on boss defeat. That made the most interesting
   * thing in the progression system something that happened TO the player:
   * measured, picking cards at random reached a fusion in 61% of runs, which
   * is another way of saying the decision did not exist. Ball x Pit's whole
   * shape is that combining is an ACT — you choose the pair, and choosing costs
   * you the pick.
   */
  fusion: FusionResult | null;
}

export interface Offer {
  /** The level this offer was earned at. */
  level: number;
  options: OfferOption[];
  /** How many further level-ups are already queued behind this one. */
  queued: number;
  rerollsLeft: number;
  banishesLeft: number;
}

export interface ProgressionState {
  level: number;
  /** XP banked into the current level. */
  xp: number;
  xpTotal: number;
  /** id -> level. Fused instruments sit here at level 1 and are already maxed. */
  instruments: Record<string, number>;
  rig: Record<string, number>;
  instrumentSlots: number;
  rigSlots: number;
  bossesBeaten: number;
  /** Level-ups earned and not yet spent. */
  pending: number;
  offer: Offer | null;
  rerolls: number;
  banishes: number;
  banished: string[];
  /** Fusions completed this run, in order. */
  /**
   * Every fusion produced this run, in order. Widened to `string` because a
   * DUET's id is synthesised (`a+b`) rather than a member of `EvolvedId` — see
   * the DUETS block in `weapons.ts`.
   */
  fusions: (EvolvedId | string)[];
  /**
   * WHICH IDS MAY BE DRAFTED AT ALL, or `null` for "the whole table".
   *
   * The meta layer starts a player with eight instruments and eight passives
   * and sells the rest between runs (`src/game/meta.ts`). This is where that
   * lands, and the shape of it is the load-bearing decision:
   *
   * IT IS A FILTER ON THE DRAFT POOL, NOT AN EDIT TO THE TABLES. `INSTRUMENTS`
   * and `RIG` are unchanged, every FUSION recipe is unchanged, and a locked id
   * can still appear as the RESULT of something — it simply cannot be dealt as
   * a card. AGENTS.md §5's rule is that the way to change progression without
   * paying the zero-sum tax is to change what an existing card is WORTH rather
   * than to add or remove card TYPES, and a pool filter is the one lever that
   * removes cards without touching what a card is.
   *
   * IT IS PER-RUN STATE, NOT A MODULE GLOBAL. A module-level "current roster"
   * would be a hidden input to a pure module — `tools/levelup.mjs` and
   * `tools/offerpool.mjs` build a dozen `ProgressionState`s in one process and
   * compare them, and with a global they would all silently share whichever
   * roster was set last. Every arm of `offerpool` is a different value of this
   * field in the same process.
   *
   * `null` MEANS EVERYTHING, and it is the default. That is what keeps the ~200
   * checks in `tools/` measuring the game they were calibrated against: a tool
   * that never mentions this field sees the full 30-and-12 table exactly as
   * before. Only `World` (via `meta.ts`) ever sets it.
   *
   * FUSION RESULTS ARE NOT GATED BY IT, and must not be. They are excluded from
   * the draft pool already (`def.fused || def.weight <= 0`) and are EARNED, so
   * gating them would make the unlock shop sell things the shop cannot show and
   * would silently brick recipes whose result nobody had bought.
   */
  unlocked: ReadonlySet<string> | null;
  rng: Rng;
}

/**
 * Is `id` draftable under this run's roster?
 *
 * One function, called from the two loops in `availableOptions`, so "locked"
 * has exactly one definition. A second copy of `state.unlocked?.has(id)` in the
 * rig loop is precisely the drift `src/render/levelup.ts` is a standing warning
 * about.
 */
function draftable(state: ProgressionState, id: string): boolean {
  return state.unlocked === null || state.unlocked.has(id);
}

/** The instrument a run starts holding when nothing else is chosen. */
/*
 * THE OPENER IS EMBER NOW, AND THE CHOICE IS PEDAGOGICAL RATHER THAN
 * BALANCED.
 *
 * A run's first second is the only moment the game gets to teach its own
 * organising idea, and the idea after this pass is that a weapon is a
 * PROPERTY: a hit leaves something behind. EMBER is the plainest possible
 * statement of it — you shoot a thing, the thing keeps taking damage, and the
 * card says exactly that in numbers. Every previous default taught a delivery
 * geometry, which is the axis the roster just stopped being organised on.
 */
export const STARTING_INSTRUMENT = 'ember';

/**
 * The openers a player may choose between, and why these three.
 *
 * Every run began with PIZZICATO, so every run opened identically — the first
 * decision came at the first level-up, minutes in. Both games this one is
 * fusing put a choice before the run: a character in Vampire Survivors, a
 * starting ball in Ball x Pit. It is the cheapest possible source of
 * run-to-run variety and it makes the opening pick a plan rather than a
 * default.
 *
 * Chosen by measurement, not taste. Every base instrument was run as the sole
 * opener over three seeds of 240s, and they separate sharply — mean wave
 * reached: pizzicato 8.7, echoes 7.3, chime 6.7, then a drop to timpani and
 * tremolo at 5.3 and a long tail down to feedback at 3.0 with a score of 5033.
 * An arc or a beam alone cannot clear early waves: snare and bow both took ~20
 * hits against pizzicato's 6.7. Offering those would not be a choice, it would
 * be a trap.
 *
 * The three that survive are also the three that play least alike — bolts that
 * seek, bolts that RICOCHET off the walls, and unaimed strikes that land from
 * above — and they lead to three different evolutions (spiccato, canon,
 * carillon), so the opening pick already leans the fusion tree.
 *
 * ---------------------------------------------------------------------------
 * ECHOES AND CHIME ARE OUT, AND THIS IS NOT A BALANCE TWEAK — IT IS TWO ITEMS
 * BECOMING UNPLAYABLE AS OPENERS BY DESIGN.
 *
 * The items pass (`docs/plan-items-v2.md` §3) re-points `chime` to RITARDANDO,
 * which deals no damage at all, and `echoes` to SOSTENUTO, which raises the
 * last enemy you killed. Both fail the one thing an opener has to do:
 *
 *   RITARDANDO cannot kill anything, ever. A run that opens with it reaches
 *   wave one and stops.
 *   SOSTENUTO is a HARD DEADLOCK, which is worse than weak. No other weapon
 *   means no kill; no kill means no ghost; no ghost means no kill. There is no
 *   number that fixes it, because the item's input is its own output.
 *
 * `tools/openers.mjs` asserts the weakest opener reaches 70% of the best and it
 * is RIGHT to — AGENTS.md §3 says a gate that fails because the design changed
 * is replaced with a stronger one and never relaxed. Nothing here relaxes it:
 * the floor is untouched and the LIST is what changed, because the assumption
 * the gate encodes ("every offered opener can fight") is still exactly the
 * assumption we want.
 *
 * The three that replace them are the best statement of the new roster
 * available at the moment of choosing, and they are three different verbs
 * rather than three different geometries:
 *
 *   METRONOME   fires on the downbeat and nowhere else, for eight times a shot
 *   SYNCOPATION fires on the off-beat and never on the beat
 *   CRESCENDO   feeble while you are safe, enormous while you are surrounded
 *
 * Two beat-locked weapons in disjoint halves of the pulse, and one that inverts
 * the risk curve. A player picking between those has met the whole of the new
 * axis before the first enemy arrives, which is the only way an axis this
 * unusual gets learned — and it is three different VERBS rather than three
 * different geometries, which is the complaint this pass exists to answer.
 *
 * LANES, which `openers` also checks: arp, clap and kick. Three distinct
 * `ENSEMBLE_MIX` entries, so the openings are still audibly different from the
 * first bar.
 *
 * CHOSEN BY MEASUREMENT AND NOT BY THEME, and the first attempt was wrong.
 * `bow` was in this list for one revision on the strength of its re-point to
 * `lance`, and `tools/_openersweep.mjs` — every base instrument alone, 3 seeds
 * x 240s — put it at the wave-3 floor along with nine others, against
 * METRONOME's 6.7. Under this roster only METRONOME cleared early waves at all,
 * so two rows were front-loaded to make the menu real: SYNCOPATION's opening
 * throughput 2.4x and CRESCENDO's 1.6x, both paid for out of their own top
 * rungs so the ceilings barely move. See the notes on those rows.
 *
 * WHAT IT COSTS. The wall-bouncing ECHOES brought to the opening menu is
 * genuinely lost; it survives in CANON, which is still `echoes`' evolution, and
 * in SPICCATO. ROSIN BOW remains what it has always been — a strong mid-run
 * pick and a poor opener.
 */
/*
 * THREE OPENERS, ONE PER KIND OF PROPERTY, AND THREE DIFFERENT LANES.
 *
 *   EMBER    burn — a status that keeps working after the hit      (fx)
 *   LANCE    a line of damage through whatever it hits             (chords)
 *   TIMPANI  quake — a splash that reaches what you did not hit    (kick)
 *
 * RASP WAS THE THIRD AND IS NOT, and the reason is measured rather than
 * aesthetic: `tools/openers.mjs` read it at 61% of the best opener's wave
 * against a 70% floor. Its reach was inside `Enemy.standoff` (see its row in
 * `weapons.ts`), which is fixed — but even at 300px a weapon that has to be
 * flown into a pack is a poor thing to hand somebody in their first ten
 * seconds, and a starter that measures as a trap is worse than one less idea
 * on the opening menu.
 *
 * `tools/openers.mjs` asserts all three are playable within 70% of each other
 * and that they lift different stems, so this list cannot quietly become three
 * spellings of the same run.
 */
export const STARTERS: readonly string[] = ['ember', 'bow', 'timpani'];

export function createProgression(
  seed = 1,
  starter?: string,
  unlocked: ReadonlySet<string> | null = null,
): ProgressionState {
  return {
    level: 1,
    xp: 0,
    xpTotal: 0,
    instruments: { [starter && STARTERS.includes(starter) ? starter : STARTING_INSTRUMENT]: 1 },
    rig: {},
    instrumentSlots: STAND_SLOTS,
    rigSlots: RIG_SLOTS,
    bossesBeaten: 0,
    pending: 0,
    offer: null,
    rerolls: REROLLS_START,
    banishes: BANISHES_START,
    banished: [],
    fusions: [],
    unlocked,
    rng: new Rng(seed >>> 0),
  };
}

/**
 * Reset in place.
 *
 * In place, and never by assigning a fresh object: the world hands the director
 * a *reference* to the ability map once per run, and replacing the object left
 * the music reading a stale one for a whole project's worth of powerups. That
 * bug is written up in `tools/README.md` under `everypowerup`; this is the same
 * hazard with a different name.
 */
export function resetProgression(
  state: ProgressionState,
  seed = 1,
  starter?: string,
  unlocked: ReadonlySet<string> | null = null,
): void {
  /*
   * THE ROSTER IS RE-READ ON EVERY RUN, and it has to be.
   *
   * `World.start()` is also the AGAIN path, and a player who buys three
   * weapons in the shop and presses AGAIN must be playing with them. Leaving
   * the previous run's set in place would have shipped a shop whose purchases
   * only take effect after a page reload — the exact "looks implemented,
   * isn't" shape this file's own history is a museum of.
   */
  state.unlocked = unlocked;
  state.level = 1;
  state.xp = 0;
  state.xpTotal = 0;
  for (const k of Object.keys(state.instruments)) delete state.instruments[k];
  for (const k of Object.keys(state.rig)) delete state.rig[k];
  // A chosen opener, falling back to the default. An unknown id would leave the
  // player with no gun at all, so it is checked against the offered set rather
  // than trusted.
  state.instruments[starter && STARTERS.includes(starter) ? starter : STARTING_INSTRUMENT] = 1;
  state.instrumentSlots = STAND_SLOTS;
  state.rigSlots = RIG_SLOTS;
  state.bossesBeaten = 0;
  state.pending = 0;
  state.offer = null;
  state.rerolls = REROLLS_START;
  state.banishes = BANISHES_START;
  state.banished.length = 0;
  state.fusions.length = 0;
  state.rng = new Rng(seed >>> 0);
}

/* ------------------------------------------------------------------------ *
 * XP in
 * ------------------------------------------------------------------------ */

export interface XpResult {
  /** Levels gained by this grant. */
  gained: number;
  level: number;
  xp: number;
  xpToNext: number;
}

/**
 * Bank XP and queue any level-ups it earned.
 *
 * RESONANCE is applied here rather than at the pickup site so there is exactly
 * one place that knows XP can be modified. `pending` is a queue, not a boolean:
 * a bomb into a dense wave can cross two thresholds in one frame, and dropping
 * the second one silently is the kind of loss a player feels and cannot name.
 */
export function grantXp(state: ProgressionState, raw: number): XpResult {
  const scaled = raw * rigModifiers(state.rig).xpGain;
  state.xp += scaled;
  state.xpTotal += scaled;
  let gained = 0;
  // Bounded: a single absurd grant must not spin here forever.
  for (let guard = 0; guard < 200; guard++) {
    const need = xpToNext(state.level);
    if (state.xp < need) break;
    state.xp -= need;
    state.level++;
    state.pending++;
    gained++;
  }
  return { gained, level: state.level, xp: state.xp, xpToNext: xpToNext(state.level) };
}

/** Collect one shard. Convenience for the world's pickup path. */
export function grantShard(state: ProgressionState, tier: ShardTier): XpResult {
  return grantXp(state, SHARD_XP[tier]);
}

/* ------------------------------------------------------------------------ *
 * The offer
 * ------------------------------------------------------------------------ */

function instrumentsHeld(state: ProgressionState): number {
  return Object.keys(state.instruments).length;
}

function rigHeld(state: ProgressionState): number {
  return Object.keys(state.rig).length;
}

/** Which fusion, if any, `id` at `level` would complete. */
function fusionCompletedBy(state: ProgressionState, id: string, level: number): EvolvedId | null {
  for (const f of FUSIONS) {
    if (state.instruments[f.result]) continue;
    const baseLevel = state.instruments[f.base] ?? 0;
    const baseMax = maxLevelOf(f.base);
    const catLevel = (state.instruments[f.catalyst] ?? state.rig[f.catalyst]) ?? 0;
    const catMax = maxLevelOf(f.catalyst);
    if (id === f.base) {
      if (level >= baseMax && catLevel >= catMax) return f.result;
    } else if (id === f.catalyst) {
      if (level >= catMax && baseLevel >= baseMax) return f.result;
    }
  }
  return null;
}

/**
 * Every legal option right now.
 *
 * This function is the guarantee: an option exists here only if it is
 * *takeable*. A new instrument needs a free slot, an owned one needs headroom
 * below its ceiling, a fused instrument is never on the list because it has no
 * ceiling to grow toward, and a banished id is gone for the rest of the run.
 * Nothing downstream re-checks any of that, so nothing downstream can disagree
 * with it.
 */
export function availableOptions(state: ProgressionState): OfferOption[] {
  const out: OfferOption[] = [];

  /*
   * ARRANGEMENT cards first. A ready fusion is always on the table — it is the
   * one card that changes what the band IS rather than how loud it plays, and
   * burying it behind a weighted draw would put the best decision in the game
   * behind a dice roll. It still costs the pick, which is the whole cost.
   */
  for (const f of [...readyFusions(state), ...readyDuets(state)]) {
    out.push({
      id: f.result,
      slot: 'instrument',
      /*
       * The level it ACTUALLY arrives at, which is its ceiling.
       *
       * `applyFusion` seats a result at `maxLevelOf` — it is earned, never
       * drafted, so it can never be levelled afterwards and starting at 1
       * would strand it there. This said 1 anyway, so the card drew one
       * notehead of three for a thing that arrives finished, understating the
       * largest reward in the game at the exact moment it is offered.
       */
      level: maxLevelOf(f.result),
      isNew: true,
      label: `${labelOf(f.base)} × ${labelOf(f.catalyst)}`,
      note: f.line,
      character: characterOf(f.result),
      completes: null,
      replaces: null,
      grace: null,
      fusion: f,
    });
  }
  const instRoom = instrumentsHeld(state) < state.instrumentSlots;
  const rigRoom = rigHeld(state) < state.rigSlots;

  for (const def of INSTRUMENTS) {
    if (def.fused || def.weight <= 0) continue;
    if (!draftable(state, def.id)) continue;
    if (state.banished.includes(def.id)) continue;
    const owned = state.instruments[def.id] ?? 0;
    if (owned === 0 && !instRoom) continue;
    if (owned >= INSTRUMENT_MAX_LEVEL) continue;
    const level = owned + 1;
    out.push({
      id: def.id,
      slot: 'instrument',
      level,
      isNew: owned === 0,
      label: def.label,
      note: stepNote(def.id, level),
      character: def.character,
      completes: fusionCompletedBy(state, def.id, level),
      replaces: null,
      grace: null,
      fusion: null,
    });
  }

  for (const def of RIG) {
    if (def.weight <= 0) continue;
    if (!draftable(state, def.id)) continue;
    if (state.banished.includes(def.id)) continue;
    const owned = state.rig[def.id] ?? 0;
    if (owned >= RIG_MAX_LEVEL) continue;
    /*
     * A full rig normally ends the conversation. It still does, EXCEPT for the
     * one passive the player has spent the run earning the right to want: the
     * catalyst of an instrument they have pushed to the hint level. That card
     * comes anyway and brings its own price tag. See `OfferOption.replaces`.
     */
    let replaces: string | null = null;
    if (owned === 0 && !rigRoom) {
      if (!catalysesPursued(state, def.id)) continue;
      replaces = sacrificeFor(state);
      if (!replaces) continue;
    }
    const level = owned + 1;
    out.push({
      id: def.id,
      slot: 'rig',
      level,
      isNew: owned === 0,
      label: def.label,
      note: stepNote(def.id, level),
      character: def.character,
      completes: fusionCompletedBy(state, def.id, level),
      replaces,
      grace: null,
      fusion: null,
    });
  }

  return out;
}

/**
 * Does this passive unlock an evolution the player is visibly building toward?
 *
 * Deliberately the SAME threshold the offer weighting already uses to start
 * nudging a catalyst forward. That rule and this one are two halves of one
 * promise: past `catalystHintLevel` the game says it has noticed what you are
 * building. Before this existed it could make the promise and then be unable
 * to keep it, which is worse than never having made it.
 */
function catalysesPursued(state: ProgressionState, rigId: string): boolean {
  for (const f of FUSIONS) {
    if (f.kind !== 'evolution' || f.catalyst !== rigId) continue;
    if (state.instruments[f.result]) continue;
    if ((state.instruments[f.base] ?? 0) >= OFFER_TUNING.catalystHintLevel) return true;
  }
  return false;
}

/**
 * Which held passive a swap would spend: the least invested one.
 *
 * Lowest level first, because that is the smallest thing the player loses and
 * it keeps the card honest — a swap should read as trading up, not as being
 * mugged. A passive that is itself the catalyst of another pursued evolution
 * is never taken, or finishing one plan would quietly cancel another.
 *
 * Ties resolve by `RIG` order rather than by anything derived from the run, so
 * the same state always names the same sacrifice; a card that shows a different
 * price each time it is dealt is not a decision the player can reason about.
 */
function sacrificeFor(state: ProgressionState): string | null {
  let best: string | null = null;
  let bestLevel = Infinity;
  for (const def of RIG) {
    const lv = state.rig[def.id] ?? 0;
    if (lv <= 0) continue;
    if (catalysesPursued(state, def.id)) continue;
    if (lv < bestLevel) { bestLevel = lv; best = def.id; }
  }
  return best;
}

/** Draw weight for one option, before the random draw. */
function weightOf(state: ProgressionState, opt: OfferOption): number {
  /*
   * A FUSION CARD GETS ITS OWN WEIGHT, because it cannot inherit one.
   *
   * `weightOf` reads `def.weight`, and a fused or synthesised instrument is
   * defined with weight 0 precisely so it can never be DRAFTED as an ordinary
   * card. The clamp at the bottom turns that into 0.0001, so a ready fusion was
   * about ten thousand times less likely than anything else in the pool:
   * measured, a run holding four instruments past the duet threshold, with six
   * legal combinations, was offered zero fusion cards.
   *
   * Two other fixes were tried and reverted. Forcing fusion cards into every
   * offer put them at index 0, and the leftmost card is the habitual pick for a
   * person and for every bot in `tools/` — a random picker then reached a
   * fusion in 100% of runs. Shuffling the positions afterwards fixed that and
   * broke something else: `first` and `last` stopped meaning anything, and the
   * policy spread `builds.mjs` measures collapsed from 0.37 to 0.12.
   *
   * A weight is the honest instrument. High enough that a ready combination is
   * usually visible, not so high that it is the only thing on the screen, and
   * it competes on the same terms as everything else.
   */
  if (opt.fusion) return OFFER_TUNING.fusion;
  const def = opt.slot === 'instrument' ? instrumentDef(opt.id as string) : rigDef(opt.id as string);
  let w = def?.weight ?? 1;
  // The game notices what you are building: once an instrument is close to its
  // ceiling, its catalyst starts turning up. This is the single mechanism that
  // makes an evolution a plan rather than a coincidence.
  if (opt.slot === 'rig') {
    for (const f of FUSIONS) {
      if (f.kind !== 'evolution' || f.catalyst !== opt.id) continue;
      if ((state.instruments[f.base] ?? 0) >= OFFER_TUNING.catalystHintLevel) w *= OFFER_TUNING.catalyst;
    }
  }
  // An option that completes a fusion should never be the one the draw hides.
  if (opt.completes) w *= OFFER_TUNING.completes;
  return Math.max(0.0001, w);
}

const GRACE: readonly { kind: GraceKind; label: string; note: string; character: string }[] = [
  { kind: 'rest', label: 'REST', note: 'a shield back', character: 'mournful — a bar of rest' },
  { kind: 'bomb', label: 'ENCORE', note: 'one bomb in reserve', character: 'heavy — a struck tam-tam' },
  { kind: 'shards', label: 'RESONATE', note: 'a handful of shards', character: 'shimmering — a ringing tail' },
];

function graceOption(state: ProgressionState): OfferOption {
  const g = GRACE[state.rng.int(0, GRACE.length)];
  return {
    id: null,
    slot: null,
    level: 0,
    isNew: false,
    label: g.label,
    note: g.note,
    character: g.character,
    completes: null,
    replaces: null,
    fusion: null,
    grace: g.kind,
  };
}

/** Weighted draw without replacement. */
function draw(state: ProgressionState, pool: OfferOption[], n: number): OfferOption[] {
  const rest = pool.slice();
  const picked: OfferOption[] = [];
  while (picked.length < n && rest.length > 0) {
    let total = 0;
    for (const o of rest) total += weightOf(state, o);
    let roll = state.rng.next() * total;
    let idx = rest.length - 1;
    for (let i = 0; i < rest.length; i++) {
      roll -= weightOf(state, rest[i]);
      if (roll <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(rest[idx]);
    rest.splice(idx, 1);
  }
  return picked;
}

function makeOffer(state: ProgressionState): Offer {
  const options = draw(state, availableOptions(state), OFFER_SIZE);
  // A short pool is padded rather than shrunk: four cards every time is a
  // rhythm, and a level-up that offers one card reads as the game breaking.
  while (options.length < OFFER_SIZE) options.push(graceOption(state));
  return {
    level: state.level,
    options,
    queued: Math.max(0, state.pending - 1),
    rerollsLeft: state.rerolls,
    banishesLeft: state.banishes,
  };
}

/**
 * Open the next queued offer, if there is one and none is already open.
 *
 * The world should call this on a bar line, not the instant the threshold is
 * crossed — the gesture the music makes here wants to land on the grid like
 * everything else on this field does.
 */
export function openOffer(state: ProgressionState): Offer | null {
  if (state.offer || state.pending <= 0) return state.offer;
  state.offer = makeOffer(state);
  return state.offer;
}

/** True when an offer is open, and therefore when the world should be stopped. */
export function isChoosing(state: ProgressionState): boolean {
  return state.offer !== null;
}

/* ------------------------------------------------------------------------ *
 * Acting on the offer
 * ------------------------------------------------------------------------ */

export interface ChoiceResult {
  ok: boolean;
  /** A synthesised DUET id (`a+b`) is a plain string; see OfferOption.id. */
  id: AbilityId | string | null;
  slot: AbilitySlot | null;
  level: number;
  isNew: boolean;
  grace: GraceKind | null;
  /** Offers still queued after this one closed. */
  queued: number;
}

const NO_CHOICE: ChoiceResult = {
  ok: false,
  id: null,
  slot: null,
  level: 0,
  isNew: false,
  grace: null,
  queued: 0,
};

function closeOffer(state: ProgressionState): number {
  state.offer = null;
  state.pending = Math.max(0, state.pending - 1);
  return state.pending;
}

/**
 * Take one of the four.
 *
 * `index` rather than an id, because two options can never be the same ability
 * but two grace cards can. The world's HUD deals in card positions anyway.
 */
export function chooseOption(state: ProgressionState, index: number): ChoiceResult {
  const offer = state.offer;
  if (!offer) return { ...NO_CHOICE };
  const opt = offer.options[index];
  if (!opt) return { ...NO_CHOICE };

  if (opt.grace) {
    const queued = closeOffer(state);
    return { ok: true, id: null, slot: null, level: 0, isNew: false, grace: opt.grace, queued };
  }

  if (opt.fusion) {
    // Spend both inputs, seat the result. `applyFusion` is shared with the
    // legacy batch path so there is exactly one place that mutates the books.
    applyFusion(state, opt.fusion);
    const queued = closeOffer(state);
    // Report what was actually seated, not a placeholder — see the card above.
    return {
      ok: true, id: opt.id, slot: 'instrument',
      level: state.instruments[opt.fusion.result] ?? maxLevelOf(opt.fusion.result),
      isNew: true, grace: null, queued,
    };
  }

  const id = opt.id as string;
  const book = opt.slot === 'instrument' ? state.instruments : state.rig;
  // A swap frees its slot before it fills it, so the rig never exceeds its cap
  // even for the instant between the two writes.
  if (opt.replaces) delete state.rig[opt.replaces];
  book[id] = opt.level;
  const queued = closeOffer(state);
  return { ok: true, id: opt.id, slot: opt.slot, level: opt.level, isNew: opt.isNew, grace: null, queued };
}

/**
 * Take nothing.
 *
 * Skipping is a real strategy and not a forfeit: with three slots open early, a
 * card you do not want costs you a slot you will want later. It grants nothing,
 * on purpose — a consolation prize would make skipping the safe default and
 * delete the decision.
 */
export function skipOffer(state: ProgressionState): ChoiceResult {
  if (!state.offer) return { ...NO_CHOICE };
  const queued = closeOffer(state);
  return { ok: true, id: null, slot: null, level: 0, isNew: false, grace: null, queued };
}

/** Redraw all four. Costs one reroll. */
export function rerollOffer(state: ProgressionState): Offer | null {
  if (!state.offer || state.rerolls <= 0) return state.offer;
  state.rerolls--;
  const level = state.offer.level;
  const queued = state.offer.queued;
  state.offer = makeOffer(state);
  state.offer.level = level;
  state.offer.queued = queued;
  return state.offer;
}

/**
 * Remove one option from the run's pool and redraw that card.
 *
 * Banishing is the only tool that changes the *future* of a run rather than its
 * present, which is what makes it the interesting one: with twelve instruments
 * and twelve rig items against three slots, taking two dead ends out of the
 * pool visibly sharpens every later offer.
 */
export function banishOption(state: ProgressionState, index: number): Offer | null {
  const offer = state.offer;
  if (!offer || state.banishes <= 0) return offer;
  const opt = offer.options[index];
  if (!opt || !opt.id) return offer;
  state.banishes--;
  state.banished.push(opt.id);
  const exclude = new Set(offer.options.map((o) => o.id).filter((x): x is AbilityId => x !== null));
  const pool = availableOptions(state).filter((o) => !exclude.has(o.id as AbilityId));
  offer.options[index] = draw(state, pool, 1)[0] ?? graceOption(state);
  offer.banishesLeft = state.banishes;
  return offer;
}

/* ------------------------------------------------------------------------ *
 * Fusion — the cadenza
 * ------------------------------------------------------------------------ */

export interface FusionResult {
  /**
   * `evolution` and `union` are the authored recipes in `FUSIONS`. `duet` is
   * the generative fallback: any two maxed instruments, synthesised on demand
   * by `weapons.ts`. See the DUETS block there for why both exist — a table of
   * recipes alone strands any build nobody wrote a recipe for.
   */
  kind: 'evolution' | 'union' | 'lattice' | 'duet';
  base: AbilityId;
  catalyst: AbilityId;
  /** For a duet this is a synthesised id (`a+b`), not a member of EvolvedId. */
  result: EvolvedId | string;
  line: string;
  /** A union removes two instruments and adds one, so a slot comes back. */
  freedSlot: boolean;
}

/**
 * Pairs that are ready and waiting for a boss.
 *
 * The HUD should show this. A reward the player cannot see coming is a reward
 * they cannot play toward, and the entire point of the evolution table is that
 * it is something to aim at.
 */
/**
 * Every pair of maxed instruments that could combine right now.
 *
 * ARRANGEMENT OUTRANKS DUET: if a pair already has an authored recipe in
 * `FUSIONS`, it is not offered as a duet. Letting a player generically fuse a
 * pair that had a written result would brick that result for the run, and it
 * would do so invisibly — the two cards look the same on the screen. Ball x Pit
 * has the same rule for the same reason.
 */
export function readyDuets(state: ProgressionState): FusionResult[] {
  // `DUET_INPUT_LEVEL`, not max — see the note on it in weapons.ts. Capped by
  // the id's own ceiling so a short-laddered fusion still qualifies at its top.
  const held = Object.keys(state.instruments).filter(
    (id) => (state.instruments[id] ?? 0) >= Math.min(DUET_INPUT_LEVEL, maxLevelOf(id)),
  );
  const named = new Set(FUSIONS.map((f) => duetId(f.base, f.catalyst)));
  const out: FusionResult[] = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) {
      const a = held[i], b = held[j];
      const id = duetId(a, b);
      if (named.has(id)) continue;
      if (state.instruments[id]) continue;
      // A duet of duets would need `synthesiseDuet` to resolve a synthesised
      // parent, which it does not do yet. Base and evolved instruments only.
      if (duetParents(a) || duetParents(b)) continue;
      /*
       * COMBINE WITHIN A TIER, never across one.
       *
       * Once a fusion result seats at its ceiling an evolved instrument becomes
       * duet-eligible, and the first version of that let it pair with any base
       * instrument at `DUET_INPUT_LEVEL`. That does not deepen the tree, it widens it: the
       * extra pairings are all tier-two duets wearing a tier-three input, and
       * measured they cost exactly what the last such mistake did — designed
       * fusions 1.63 -> 1.13 per run while duets went 4 -> 9, the four-card
       * offer being zero-sum as ever.
       *
       * So the tiers stay separate. Two base instruments make a DUET; two
       * evolved instruments make a UNION, which is the top of the tree and the
       * generic form of the two hand-written recipes. A mixed pair makes
       * nothing, which also keeps the fantasy legible: you combine things of
       * like kind, and the result is one step further up.
       */
      const aFused = instrumentDef(a)?.fused === true;
      const bFused = instrumentDef(b)?.fused === true;
      if (aFused !== bFused) continue;
      out.push({
        kind: aFused ? 'union' : 'duet',
        base: a as AbilityId,
        catalyst: b as AbilityId,
        result: id,
        line: aFused ? 'two sections, one score' : 'two players, one stand',
        freedSlot: true,
      });
    }
  }
  return out;
}

export function readyFusions(state: ProgressionState): FusionResult[] {
  const out: FusionResult[] = [];
  for (const f of FUSIONS) {
    if (state.instruments[f.result]) continue;
    /*
     * A UNION ASKS ONLY FOR POSSESSION, and not as a discount.
     *
     * Both of a union's inputs are themselves EVOLVED instruments, and an
     * evolved instrument is deliberately kept out of the draft pool — you earn
     * it by combining, you cannot draw it. That also means it can never be
     * levelled: measured over eight 15-minute runs, every evolved instrument a
     * committed player earned still sat at 1 of 3 when the run ended. So a
     * union requiring its inputs at MAX was not merely hard, it was
     * unsatisfiable by construction, and the count agreed — zero unions, ever.
     *
     * Letting earned fused instruments level was tried first, as the fix that
     * addresses the cause rather than the symptom. It is measurably worse: the
     * level-up cards occupy slots in a four-card offer, and designed fusions
     * per run fell from 1.63 to 1.13 while the builder-versus-drifter ratio
     * went 2.2x to 1.5x. Three different weights, same direction. The pool is
     * the scarce resource, and anything added to it is taken from somewhere.
     *
     * So the level requirement goes instead. An evolution still demands a
     * maxed base and a maxed catalyst — that is where the investment is
     * proven, and it is unchanged. Holding two specific evolved instruments is
     * already the rarer achievement of the two.
     */
    const need = (id: string) => (f.kind === 'union' ? 1 : maxLevelOf(id));
    const baseLevel = state.instruments[f.base] ?? 0;
    if (baseLevel < need(f.base)) continue;
    const catLevel = (state.instruments[f.catalyst] ?? state.rig[f.catalyst]) ?? 0;
    if (catLevel < need(f.catalyst)) continue;
    out.push({
      kind: f.kind,
      base: f.base,
      catalyst: f.catalyst,
      result: f.result,
      line: f.line,
      /*
       * Both kinds free a slot now that the catalyst is always spent. An
       * `evolution` returns the RIG slot its catalyst occupied; a `union`
       * returns a STAND slot, because there the catalyst was an instrument.
       * Either way the base is replaced in place, so the count that drops is
       * the catalyst's.
       */
      freedSlot: true,
    });
  }
  return out;
}

/**
 * Resolve every ready fusion.
 *
 * Loops, because a union's two halves can both evolve in the same cadenza — two
 * evolutions and the union that eats them, on one boss death. That is a
 * once-a-run moment and it deserves to be allowed to happen rather than
 * arbitrarily deferred to the next boss.
 *
 * An evolution consumes the instrument and *keeps* the rig item, as in Vampire
 * Survivors: the catalyst is still a global multiplier and taking it away would
 * make the reward a downgrade for everything else in the loadout.
 */
/**
 * Seat a fusion: spend both inputs, put the result on stage at level 1.
 *
 * The single place the books are mutated by a fusion, shared by the card path
 * in `chooseOption` and the legacy batch in `resolveFusions`. Two paths writing
 * the same three deletes independently is how one of them ends up forgetting
 * the catalyst, which is exactly the bug that made evolution free.
 */
export function applyFusion(state: ProgressionState, f: FusionResult): void {
  delete state.instruments[f.base];
  /*
   * THE CATALYST IS ALWAYS SPENT, whichever kind of fusion this is.
   *
   * An `evolution` used to keep its catalyst: you took a rig item to max, it
   * turned your instrument into something better, and you still had the rig
   * item. That is a reward with no cost, and it is the single reason the rig
   * felt like a checklist rather than a set of choices — nothing was ever
   * given up.
   *
   * Vampire Survivors' evolution consumes the passive, and that is what makes
   * carrying a catalyst a decision: three rig slots, twelve rig items, and the
   * one you are holding is the one you are building toward. Spending it also
   * hands the slot back, which is what keeps the draft alive late in a run.
   */
  delete state.instruments[f.catalyst];
  delete state.rig[f.catalyst];
  /*
   * THE RESULT ARRIVES FINISHED, at the top of its own short ladder.
   *
   * It used to seat at 1 and stay there for the rest of the run, because an
   * evolved instrument is deliberately kept out of the draft pool — you earn it
   * by combining, you cannot draw it — and the same exclusion that stops it
   * being drafted stopped it being levelled. Measured over eight 15-minute
   * runs, every evolved instrument a committed player earned still read 1 of 3
   * at the end. That is worse than what was paid for it: an evolution costs a
   * base at max and a catalyst at max — twelve picks under the old eight-and-five
   * ceilings, five picks under the current three-and-three — and handed back a
   * thing at a third of its own ceiling.
   *
   * It also silently closed the top of the tree. `readyDuets` admits an evolved
   * instrument at `min(DUET_INPUT_LEVEL, maxLevelOf(id))` — 3 for a fusion —
   * and its own comment says "base and evolved instruments only", so pairing
   * two evolutions was always meant to work. Stuck at 1 they never qualified,
   * and there were zero unions in every run ever measured.
   *
   * The alternative was to let fused instruments be drafted as level-up cards.
   * That was tried and measurably lost: a four-card offer is zero-sum, the
   * extra cards crowded out the base and catalyst a builder needs, and designed
   * fusions fell 1.63 -> 1.13 per run at three different weights. Seating the
   * result at its ceiling costs no card slots at all, which is the whole
   * argument for it.
   */
  state.instruments[f.result] = maxLevelOf(f.result);
  state.fusions.push(f.result);
}

export function resolveFusions(state: ProgressionState): FusionResult[] {
  const done: FusionResult[] = [];
  for (let guard = 0; guard < FUSIONS.length + 2; guard++) {
    const ready = readyFusions(state);
    if (ready.length === 0) break;
    for (const f of ready) {
      if (state.instruments[f.result]) continue;
      applyFusion(state, f);
      done.push(f);
    }
  }
  return done;
}



export interface BossReward {
  instrumentSlots: number;
  rigSlots: number;
  fusions: FusionResult[];
}

/**
 * A boss died.
 *
 * Three rewards land together and that is deliberate: the band gets bigger, the
 * levers get restocked, and anything you have been building finishes. Vampire
 * Survivors puts evolution behind a boss chest for exactly this reason — the
 * payoff wants to be attached to the moment you already earned, not to a
 * separate errand.
 */
export function onBossDefeated(state: ProgressionState): BossReward {
  state.bossesBeaten++;
  /*
   * No slot growth. The band does not get bigger when you beat a boss — it gets
   * better, because beating one is what lets you combine. See `STAND_SLOTS`.
   * The reward is still real: an extra reroll and an extra banish, plus the
   * fusion resolution below, which is the part that actually frees a chair.
   */
  state.rerolls++;
  state.banishes++;
  return {
    instrumentSlots: state.instrumentSlots,
    rigSlots: state.rigSlots,
    /*
     * A boss no longer fuses FOR you.
     *
     * Beating one used to silently resolve every ready fusion in a batch, so
     * the most interesting event in the progression system arrived as a
     * notification. Now a ready fusion is a card (see `availableOptions`) and
     * taking it costs the pick. `resolveFusions` is kept for the exhaustive
     * checks in `tools/levelup.mjs`, which need to drive the end state directly.
     */
    fusions: [],
  };
}

/* ------------------------------------------------------------------------ *
 * Reading the state
 * ------------------------------------------------------------------------ */

/**
 * The loadout as one id -> level map, for the snapshot.
 *
 * The same shape as `GameSnapshot.powerups`, so anything in `audio/layers.ts`
 * that already reads `m.powerups.drones ?? 0` reads this identically. That is
 * why the six shared ids kept their names.
 */
export function abilityLevels(state: ProgressionState): Record<string, number> {
  return { ...state.instruments, ...state.rig };
}

/**
 * Write the loadout into an existing object instead of returning a new one.
 *
 * The director holds a reference to the snapshot's ability map across frames.
 * Replacing that object leaves the music reading a map that stopped changing —
 * a bug this project has already shipped once, with powerups.
 */
export function writeAbilityLevels(state: ProgressionState, into: Record<string, number>): void {
  for (const k of Object.keys(into)) {
    if (!(k in state.instruments) && !(k in state.rig)) delete into[k];
  }
  for (const [k, v] of Object.entries(state.instruments)) into[k] = v;
  for (const [k, v] of Object.entries(state.rig)) into[k] = v;
}

/**
 * The instruments that should be firing, in slot order.
 *
 * THE ORDER IS LOAD-BEARING NOW. DO NOT SORT THIS.
 *
 * `Object.entries` on a string-keyed object returns insertion order, which here
 * is ACQUISITION order, and COUNTERPOINT (`harp`) reads index 0 as the leader
 * and 1 and 2 as the voices that answer it. Sorting this by id, by level, by
 * damage or by anything else would silently turn that item from a decision the
 * player makes into a coin flip — with no type error, no failing gate, and no
 * visible change anywhere else in the game.
 *
 * `Hud.updateBand` renders `snap.abilities` in the same insertion order, so the
 * chips along the top of the band panel are the order this returns. That is the
 * whole affordance the item has; keep the two in step.
 */
export function activeInstruments(state: ProgressionState): { id: string; level: number }[] {
  return Object.entries(state.instruments).map(([id, level]) => ({ id, level }));
}

/** Every global multiplier the rig currently applies. */
export function modifiers(state: ProgressionState): Modifiers {
  return rigModifiers(state.rig);
}

/**
 * Every rule the rig currently installs. `modifiers`' twin.
 *
 * Folded once per step alongside the modifiers rather than looked up per use,
 * for the same reason: `World` reads these at six different sites and a walk of
 * the rig at each one would be six walks a frame.
 */
export function rules(state: ProgressionState): Rules {
  return rigRules(state.rig);
}

/** For the HUD: filled and empty slot chips. */
export function slotSummary(state: ProgressionState): {
  instruments: { id: string; level: number; max: number; label: string; character: string }[];
  rig: { id: string; level: number; max: number; label: string; character: string }[];
  instrumentSlots: number;
  rigSlots: number;
} {
  const map = (book: Record<string, number>) =>
    Object.entries(book).map(([id, level]) => ({
      id,
      level,
      max: maxLevelOf(id),
      label: labelOf(id),
      character: characterOf(id),
    }));
  return {
    instruments: map(state.instruments),
    rig: map(state.rig),
    instrumentSlots: state.instrumentSlots,
    rigSlots: state.rigSlots,
  };
}

/** Fraction of the way to the next level, for the XP bar. */
export function levelProgress(state: ProgressionState): number {
  const need = xpToNext(state.level);
  return need <= 0 ? 0 : Math.min(1, state.xp / need);
}

/** Sanity: is `id` something this system knows about? */
export function isAbility(id: string): boolean {
  return slotOf(id) !== null;
}
