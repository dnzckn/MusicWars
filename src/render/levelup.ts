/**
 * The level-up screen, the ensemble readout, and the fusion payoff.
 *
 * The organising idea, and the reason none of this looks like an RPG upgrade
 * menu: **every ability in this game is an instrument, so a level-up is
 * recruiting a musician and an evolution is two players becoming one timbre.**
 * The loadout is not a list of stats, it is the mix — `audio/layers.ts` reads
 * the very same ids — so the screen that grows it is drawn as a page of score.
 * Each card is one system of a conductor's score: the player's name in the left
 * margin, a staff behind it, and their level written on that staff as
 * noteheads. Filling the page is assembling the band.
 *
 * ## Why this screen is allowed to flash and the playfield is not
 *
 * The rest of the renderer had five separate things answering the beat and it
 * read as the screen strobing rather than as the game keeping time; four of
 * them were taken out so that bullets and enemies read cleanly against a calm
 * background. This screen is the deliberate exception, and the reason is
 * mechanical rather than aesthetic: an offer stops the WORLD but never the
 * TRANSPORT. `repl.stop()` rewinds Strudel's cycle counters, so the music is
 * never stopped; it runs at full tempo while the player reads four cards, and
 * the field's beat-scheduled emitters are pushed forward by the held beats so
 * they do not all come due at once on resume. See the offer block in
 * `world.ts`.
 *
 * That is a gift. There is nothing to dodge here, so there is no readability
 * cost to a full-strength beat response — and the player is choosing an
 * instrument *while listening to the band they are choosing it for*. The
 * fermata swells on the bar, the selected card's staff flares on the beat, and
 * the backdrop breathes on the downbeat. It is the one screen in the game where
 * the periphery keeping time is the point rather than the problem.
 *
 * ## What this reads, and what it does not
 *
 * Everything on a card is derived here from the ability id: `labelOf`,
 * `slotOf`, `stepNote`, `characterOf` and `maxLevelOf` out of `game/weapons`,
 * plus the offered level and `completes` computed against
 * `GameSnapshot.abilities`. Nothing is duplicated into the event payload, so a
 * card cannot drift from the table that decides what the pick actually does —
 * the failure `tools/README.md` records for `contrast` (its own copy of the
 * field size) and `voicecheck` (its own copy of the chords), twice.
 *
 * Input lives in `main.ts` and `core/input.ts`, which are outside this
 * workstream, so this class owns layout and hit-testing but never listens for a
 * key or a click. `hitTest` and `hitTestControl` are the seam.
 */

import type { AbilityId, AbilitySlot, EvolvedId, GameSnapshot, GraceKind } from '../core/events';
import { clamp01, TAU } from '../core/math';
import {
  DUET_INPUT_LEVEL,
  FUSIONS,
  characterOf,
  duetId,
  instrumentDef,
  duetParents,
  labelOf,
  maxLevelOf,
  slotOf,
  stepNote,
} from '../game/weapons';

/**
 * One hue per character phrase.
 *
 * `character` is the one field `weapons.ts` writes for the audio side — the
 * phrase whoever voices the instrument is meant to read — so colouring the
 * cards by it means the screen is grouped by *how a thing sounds* rather than
 * by what it does to a number. Six words are in the table (shimmering 11, heavy
 * 7, aggressive 7, eerie 5, mournful 4, mechanical 4) and they are spread
 * around the wheel far enough to be told apart at a glance in peripheral
 * vision, which is the only way anyone reads a card they are about to click.
 */
const CHARACTER_HUE: Record<string, number> = {
  aggressive: 352,
  heavy: 22,
  mechanical: 88,
  shimmering: 182,
  mournful: 224,
  eerie: 292,
};

/** Gold. Reserved for fusions, everywhere, so it only ever means "payoff". */
const GOLD = 45;
/** The neutral of a grace card, which is deliberately the least exciting thing here. */
const GRACE_HUE = 214;
/**
 * The cost line on a swap card.
 *
 * Red, and specifically NOT gold: on this screen gold means "a payoff is one
 * pick away" and a swap line means the opposite, that something already earned
 * is about to be spent. Sitting at 4 it is clear of every character hue (the
 * nearest, `heavy`, is 22) and of both shard tiers that live up near 340.
 *
 * Hue is the weaker half of the signal anyway — the glyph carries the category,
 * `⇄` against the fusion banner's `◈`, so the two lines stay distinguishable
 * without relying on colour vision. See the colour contract in `renderer.ts`.
 */
const SPEND = 4;

/**
 * The grace options, in the game's own voice.
 *
 * A grace card is what the offer generator produces when the pool cannot fill
 * four — both inventories full and everything in them maxed. The honest thing
 * for the card to say is that there is nothing left to learn, so all three say
 * it. Dressing a consolation prize up as an upgrade is how a player stops
 * trusting the other three cards.
 */
const GRACE_UI: Record<GraceKind, { label: string; note: string; character: string }> = {
  rest: { label: 'REST', note: 'nothing new to learn — +1 shield', character: 'a bar of silence' },
  bomb: { label: 'CRASH', note: 'nothing new to learn — +1 bomb', character: 'one more to break' },
  shards: { label: 'SCORE', note: 'nothing new to learn — points instead', character: 'paid in applause' },
};

/** What the event hands over. Accepts the narrow and the wide payload alike. */
/**
 * `string` alongside `AbilityId` because a DUET card's id is synthesised
 * (`a+b`) rather than a member of the union. The overlay only ever passes it
 * back to `labelOf`/`characterOf`, both of which resolve synthesised ids
 * through `instrumentDef`.
 */
export type OfferOptionLike =
  | AbilityId
  | string
  | null
  | {
      id: AbilityId | string | null;
      grace?: GraceKind | null;
      replaces?: AbilityId | string | null;
      /** The level this card lands at, when the game knows better than `from + 1`. */
      level?: number;
    };

export interface OfferPayload {
  level: number;
  options: readonly OfferOptionLike[];
  queued: number;
  /** Levers remaining. Absent on the narrow payload; the glyphs then draw bare. */
  rerolls?: number;
  banishes?: number;
}

/** A card, fully resolved against the loadout at the moment the offer opened. */
interface Card {
  /** A DUET's synthesised id (`a+b`) is a plain string. See OfferOptionLike. */
  id: AbilityId | string | null;
  grace: GraceKind | null;
  slot: AbilitySlot | null;
  label: string;
  note: string;
  character: string;
  /** The level this pick would take the ability to. */
  level: number;
  /** The level it is at now; 0 when the card is a new recruit. */
  from: number;
  max: number;
  isNew: boolean;
  /** Set when this pick puts the last piece of a fusion in place. */
  completes: EvolvedId | null;
  /** What this card brings closer, when it does not finish it. See `advancesToward`. */
  toward: { to: EvolvedId | string; away: number } | null;
  /**
   * Which COMBINING tier this card is, or null for an ordinary recruit.
   *
   * Drawn where an ordinary card prints INSTRUMENT or RIG, and it exists
   * because the lattice made that corner dishonest. A fusion card and a
   * recruit card are laid out identically; while every pairing was generic
   * that cost nothing, but 63 of the 190 pairs now have an AUTHORED result and
   * the other 127 fall through to `synthesiseDuet`. Screenshotted before this
   * field existed, EMBER + ANVIL -> BOMB and the generic EMBER x SIPHON both
   * read "INSTRUMENT", so the card could not tell the player whether they were
   * being offered one of sixty-three written results or the fallback for a
   * pair nobody wrote down — which is the single most useful thing it could
   * say about that pick.
   */
  tier: 'evolution' | 'union' | 'lattice' | 'duet' | null;
  /** The held passive this card spends to make room. See `OfferOption.replaces`. */
  replaces: AbilityId | string | null;
  hue: number;
  /** Filled by `layout()` each frame, and the only thing `hitTest` reads. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Celebration {
  kind: 'evolution' | 'union' | 'lattice' | 'duet';
  a: string;
  b: string;
  to: string;
  line: string;
  hue: number;
  age: number;
  life: number;
}

interface Control {
  key: string;
  label: string;
  count: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The first word of a character phrase is its category; the rest is prose.
 *
 * Exported because the side panel draws the same loadout as DOM chips, and two
 * readouts of one thing in two different colours is worse than either of them
 * alone — the player has to learn that PIZZICATO is red here and red there
 * before the colour means anything at all.
 */
export function characterHue(character: string): number {
  const word = character.split(/[\s—-]/, 1)[0]?.toLowerCase() ?? '';
  return CHARACTER_HUE[word] ?? 200;
}

/**
 * Would taking `id` to `toLevel` complete a fusion?
 *
 * Computed rather than read off the payload so it cannot disagree with
 * `progression.readyFusions`, which runs the same test against the same table
 * when the boss actually dies. `docs/progression.md` is explicit that the
 * player has to be able to see a fusion coming — "a reward a player cannot see
 * coming is a reward they cannot play toward" — and the offer bias exists
 * precisely to put this card in front of them.
 */
/**
 * What this card brings CLOSER, and how close it gets.
 *
 * `completesFusion` marks only the final pick — the one that maxes both inputs
 * at once. Everything before it is unmarked, so a player three picks into a
 * recipe sees three blank cards and then, with no warning, gold. The decision
 * the whole progression is built around was legible only on the move that
 * ended it.
 *
 * Derived by ASKING, not by re-deriving: take `pendingFusions` before and
 * after the hypothetical pick and report what moved. That means this cannot
 * drift from the HUD banner and the pause workbench, which read the same
 * function — a lesson this file has already paid for once, when its copy of
 * the fusion rules fell out of step with the game's and the panel spent an
 * iteration promising combinations the offer could not deal.
 *
 * A DESIGNED recipe outranks a generic duet, and nearness alone does not
 * decide it. Measured over 1500 loadouts, duets advance at a median distance
 * of 3 and designed recipes at 4 — duets are combinatorial, any two
 * instruments make one, so a nearest-first rule surfaces them almost every
 * time and buries the twelve authored evolutions underneath. That is the same
 * crowding that filled the pause workbench with `A × B` rows before it learned
 * to sort designed content first.
 *
 * A generic duet is only named when it is genuinely CLOSE — the p25 of that
 * measured distribution. An evolution is worth pointing at from any distance
 * because a player may not know the recipe exists; a duet nine picks out tells
 * them nothing they could not infer from holding two instruments, and the card
 * has one line to spend.
 */
const DUET_WORTH_SAYING = 2;
export function advancesToward(
  id: string,
  toLevel: number,
  abilities: Readonly<Partial<Record<AbilityId, number>>>,
): { to: EvolvedId | string; away: number } | null {
  const before = new Map(pendingFusions(abilities).map((p) => [p.to, p.away]));
  const after = pendingFusions({ ...abilities, [id]: toLevel } as Partial<Record<AbilityId, number>>);
  const named = new Set(FUSIONS.map((f) => f.result as string));
  let best: { to: EvolvedId | string; away: number; designed: boolean } | null = null;
  for (const p of after) {
    const was = before.get(p.to);
    if (was === undefined || p.away >= was) continue;
    const designed = named.has(String(p.to));
    if (!designed && p.away > DUET_WORTH_SAYING) continue;
    // Designed first, then nearest.
    if (!best || (designed && !best.designed) || (designed === best.designed && p.away < best.away)) {
      best = { to: p.to, away: p.away, designed };
    }
  }
  return best ? { to: best.to, away: best.away } : null;
}

function completesFusion(
  id: AbilityId,
  toLevel: number,
  abilities: Readonly<Partial<Record<AbilityId, number>>>,
): EvolvedId | null {
  for (const f of FUSIONS) {
    if (abilities[f.result]) continue;
    if (f.base !== id && f.catalyst !== id) continue;
    const baseAt = f.base === id ? toLevel : (abilities[f.base] ?? 0);
    const catAt = f.catalyst === id ? toLevel : (abilities[f.catalyst] ?? 0);
    if (baseAt >= maxLevelOf(f.base) && catAt >= maxLevelOf(f.catalyst)) return f.result;
  }
  return null;
}

/**
 * The one-line description of what a fusion sounds like.
 *
 * `ability:evolve` and `ability:union` carry only the three ids, and the line
 * belongs to the recipe rather than to the result, so it is looked up rather
 * than passed. Falling back to a generic phrase keeps an unrecognised id from
 * silencing the biggest moment in the run.
 */
export function fusionLine(to: string): string {
  return FUSIONS.find((f) => f.result === to)?.line ?? 'two players become one';
}

/**
 * Pairs already complete and waiting on the next boss, from the snapshot alone.
 *
 * Exported so the side panel says the same thing the offer screen says. It
 * deliberately reimplements nothing: the test is the same one
 * `progression.readyFusions` runs against the same `FUSIONS` table, just
 * against the snapshot's ability map rather than the private state.
 */
/**
 * Combinations the player could take RIGHT NOW, authored and generative alike.
 *
 * This used to list only the eleven recipes in `FUSIONS`, which was complete
 * when those were the only way to combine. DUETs are generative — any two
 * instruments at `DUET_INPUT_LEVEL` merge — so a player two levels from their
 * first combination had nothing on screen telling them so, which is exactly
 * the "wiki lookup" the design research says a requirements board exists to
 * replace.
 *
 * Named recipes are listed first and shadow the generic one for the same pair:
 * taking the DUET of a pair that has an ARRANGEMENT would burn the better
 * result, and the two read identically on a card.
 */
/*
 * A MIRROR of `progression.ts`'s `readyFusions` + `readyDuets`, and mirrors
 * drift.
 *
 * This one exists because the HUD is handed a flat `abilities` record rather
 * than a `ProgressionState`, so it cannot call the real thing. It has already
 * cost once: when the game side learned to combine only WITHIN a tier, this
 * did not, and the panel spent a whole iteration announcing READY TO COMBINE
 * for base-plus-evolved pairs the offer would never contain. A banner that
 * promises a card the game cannot deal is worse than no banner.
 *
 * `tools/mirror.mjs` now fails the build if the two disagree on any state, so
 * the next divergence is caught by a test rather than by a player.
 */
export function readyFusions(
  abilities: Readonly<Partial<Record<AbilityId, number>>>,
): { to: EvolvedId | string; line: string; kind: 'evolution' | 'union' | 'lattice' | 'duet' }[] {
  const out: { to: EvolvedId | string; line: string; kind: 'evolution' | 'union' | 'lattice' | 'duet' }[] = [];
  const named = new Set<string>();
  for (const f of FUSIONS) {
    named.add(duetId(f.base, f.catalyst));
    if (abilities[f.result]) continue;
    // A union's inputs are themselves evolved, and an evolved instrument is
    // seated at its ceiling and never levelled — possession is the requirement.
    const need = (id: string) => (f.kind === 'union' ? 1 : maxLevelOf(id));
    if ((abilities[f.base] ?? 0) < need(f.base)) continue;
    if ((abilities[f.catalyst] ?? 0) < need(f.catalyst)) continue;
    out.push({ to: f.result, line: f.line, kind: f.kind });
  }
  const all = abilities as Readonly<Record<string, number>>;
  const ready = Object.keys(all).filter(
    (id) => slotOf(id) === 'instrument' && (all[id] ?? 0) >= Math.min(DUET_INPUT_LEVEL, maxLevelOf(id)),
  );
  for (let i = 0; i < ready.length; i++) {
    for (let j = i + 1; j < ready.length; j++) {
      const id = duetId(ready[i], ready[j]);
      if (named.has(id) || all[id] || duetParents(ready[i]) || duetParents(ready[j])) continue;
      // Within a tier only: two base instruments, or two evolved ones.
      const aFused = instrumentDef(ready[i])?.fused === true;
      const bFused = instrumentDef(ready[j])?.fused === true;
      if (aFused !== bFused) continue;
      out.push({
        to: id,
        line: aFused ? 'two sections, one score' : 'two players, one stand',
        kind: aFused ? 'union' : 'duet',
      });
    }
  }
  return out;
}

/**
 * Combinations the player is CLOSE to, with what each still needs.
 *
 * `readyFusions` says what can be taken now. This says what to build toward,
 * which is the harder and more useful half: the design research on
 * survivors-likes is blunt that a player who cannot see a synergy coming does
 * not play toward it, and that a requirements board is what turns a wiki
 * lookup into a glance.
 *
 * Only pairs where BOTH pieces are already held are listed. Suggesting a
 * combination that needs something the player does not own would be a
 * shopping list rather than a plan, and the offer pool decides what they see
 * anyway. Sorted by how close they are, so the top line is the next thing to
 * happen.
 */
/**
 * Everything this loadout can still become, as data.
 *
 * The HUD panel has one line and shows the single most urgent combination;
 * that is right for a line you read mid-fight, and useless for planning. A
 * pause is the one moment a player can actually read something, and until now
 * the pause screen offered a score, a wave number and a list of keys they
 * already know. Meanwhile the fusion tree — the part of the game that rewards
 * intent, worth 2.3x the designed fusions and +11% on wave reached to a player
 * who commits — was invisible unless a card happened to be one pick away.
 *
 * A PURE FUNCTION returning rows, not DOM. Every other piece of fusion logic
 * in this file already exists twice (see the mirror note on `readyFusions`) and
 * the second copy drifted the moment the first changed. Keeping this as data
 * means `tools/mirror.mjs` can check what the player will actually READ against
 * what the game will actually DEAL, rather than checking a function nobody
 * renders and hoping the screen agrees.
 *
 * Sorted: available now, then DESIGNED recipes, then by distance.
 *
 * Distance alone reads worse than it sounds. Duets are combinatorial — four
 * held instruments make six pairs — so ordering purely by how close a thing is
 * fills the whole list with generic `A × B` rows and buries the hand-authored
 * evolution underneath them. Measured on a real 600s run, the one designed
 * recipe in reach sorted third behind three duets; on another, six duets filled
 * every row and nothing designed appeared at all.
 *
 * The twelve written recipes are the content worth planning toward — they are
 * what makes committing pay 2.3x, and each produces a named instrument rather
 * than a stat blend. So they lead, and the generic pairings fill what is left.
 * No distance is misstated by this: every row still prints exactly what it
 * needs, so a nearer duet is still visibly nearer, it simply does not get to
 * push the designed tree off the screen.
 */
export function combinationPlan(
  abilities: Readonly<Partial<Record<AbilityId, number>>>,
  known: ReadonlySet<string> = new Set(),
): { to: EvolvedId | string; label: string; kind: 'evolution' | 'union' | 'lattice' | 'duet'; ready: boolean; needs: string; away: number }[] {
  const rows: { to: EvolvedId | string; label: string; kind: 'evolution' | 'union' | 'lattice' | 'duet'; ready: boolean; needs: string; away: number }[] = [];
  for (const r of readyFusions(abilities)) {
    rows.push({ to: r.to, label: labelOf(r.to as AbilityId), kind: r.kind, ready: true, needs: r.line, away: 0 });
  }
  const readySet = new Set(rows.map((r) => r.to));
  for (const p of pendingFusions(abilities)) {
    if (readySet.has(p.to)) continue;
    rows.push({ to: p.to, label: labelOf(p.to as AbilityId), kind: kindOf(p.to), ready: false, needs: p.needs, away: p.away });
  }
  const designed = (k: string) => (k === 'duet' ? 0 : 1);
  /*
   * THE HALF-DONE RECIPE, which was the loudest silence in this screen.
   *
   * `pendingFusions` only speaks when BOTH inputs are already held, so a
   * player who took PIZZICATO to 8 of 8 and holds no CAPO saw nothing at all —
   * they had done half the work and the game said less than it had before they
   * started. Measured directly: `{pizzicato: 8}` produced an empty plan;
   * `{pizzicato: 8, capo: 1}` produced "SPICCATO, 4 away".
   *
   * What it says depends on whether they have MADE this one before, and that
   * asymmetry matches the codex exactly. Known: name it and name what is
   * missing, because they already know and withholding it is just friction.
   * Unknown: say that the ceiling means something and that a piece is missing,
   * without naming either — a first maxed instrument should teach that
   * combining exists, and spoiling which is what the collection is for.
   */
  const held = abilities as Readonly<Record<string, number>>;
  /*
   * ONE UNKNOWN ROW PER BASE, because a branched instrument has more than one
   * recipe and the unknown wording names the BASE rather than the result.
   *
   * A known row reads "SNAP — needs COMPRESSOR" and is distinct from
   * "SPICCATO — needs CAPO". An UNKNOWN row deliberately names neither, so both
   * of PIZZICATO's recipes render the identical string "PIZZICATO is at its
   * ceiling — something you are not carrying", with the same `away` (both
   * catalysts cap at 5) so they even sort adjacent. The pause overlay draws
   * `plan.slice(0, 6)`, so the duplicate is not merely untidy: it spends one of
   * six rows saying the same sentence twice and can push a real aim under the
   * "+N further off" line.
   *
   * This appeared the moment PIZZICATO branched — before that, one recipe per
   * base made it unreachable. Deduping on `to` (below) cannot catch it: the two
   * rows carry different results, `spiccato` and `snap`. It is the rendered
   * TEXT that collides, which is why `tools/mirror.mjs` passed 11,015 rows
   * without noticing and now has an assertion of its own.
   */
  const ceilingSaid = new Set<string>();
  for (const f of FUSIONS) {
    if (f.kind !== 'evolution') continue;
    if (held[f.result]) continue;
    if ((held[f.base] ?? 0) < maxLevelOf(f.base)) continue;
    if ((held[f.catalyst] ?? 0) > 0) continue;
    if (rows.some((r) => r.to === f.result)) continue;
    const seen = known.has(f.result);
    if (!seen) {
      if (ceilingSaid.has(f.base)) continue;
      ceilingSaid.add(f.base);
    }
    rows.push({
      to: f.result,
      label: seen ? labelOf(f.result) : `${labelOf(f.base)} is at its ceiling`,
      kind: 'evolution',
      ready: false,
      needs: seen ? labelOf(f.catalyst) : 'something you are not carrying',
      // Sorted last among aims: a missing input is further off than any
      // shortfall on something already in hand.
      away: maxLevelOf(f.catalyst) + 1,
    });
  }

  return rows.sort((a, b) =>
    (Number(b.ready) - Number(a.ready))
    || (designed(b.kind) - designed(a.kind))
    || (a.away - b.away)
    || String(a.to).localeCompare(String(b.to)));
}

/**
 * What each tier is CALLED on a card. One table, so the card, the celebration
 * and the workbench cannot end up using three different words for one thing.
 */
export const TIER_WORD: Record<'evolution' | 'union' | 'lattice' | 'duet', string> = {
  union: 'UNION',
  lattice: 'ARRANGEMENT',
  evolution: 'EVOLUTION',
  duet: 'DUET',
};

/** Which tier a result belongs to, from the id alone. */
function kindOf(to: EvolvedId | string): 'evolution' | 'union' | 'lattice' | 'duet' {
  const named = FUSIONS.find((f) => f.result === to);
  if (named) return named.kind;
  const parents = duetParents(String(to));
  if (parents && parents.every((x) => instrumentDef(x)?.fused === true)) return 'union';
  return 'duet';
}

export function pendingFusions(
  abilities: Readonly<Partial<Record<AbilityId, number>>>,
): { to: EvolvedId | string; needs: string; away: number }[] {
  const all = abilities as Readonly<Record<string, number>>;
  const out: { to: EvolvedId | string; needs: string; away: number }[] = [];
  const named = new Set<string>();

  for (const f of FUSIONS) {
    named.add(duetId(f.base, f.catalyst));
    if (all[f.result]) continue;
    const b = all[f.base] ?? 0;
    const c = all[f.catalyst] ?? 0;
    if (b === 0 || c === 0) continue;
    // A union wants possession, not levels — same rule the offer uses. Asking
    // for levels that are not required would send the player to top up
    // something that is already finished.
    const want = (id: string) => (f.kind === 'union' ? 1 : maxLevelOf(id));
    const wb = want(f.base), wc = want(f.catalyst);
    const need = Math.max(0, wb - b) + Math.max(0, wc - c);
    if (need === 0) continue;
    const short = [
      b < wb ? `${labelOf(f.base)} +${wb - b}` : '',
      c < wc ? `${labelOf(f.catalyst)} +${wc - c}` : '',
    ].filter(Boolean).join(' · ');
    out.push({ to: f.result, needs: short, away: need });
  }

  const held = Object.keys(all).filter((id) => slotOf(id) === 'instrument' && (all[id] ?? 0) > 0 && !duetParents(id));
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) {
      const a = held[i], b = held[j];
      const id = duetId(a, b);
      if (named.has(id) || all[id]) continue;
      /*
       * Within a tier only — and this half matters more than the READY banner.
       *
       * "ONE STEP AWAY" is the line that decides where the next two minutes of
       * picks go. Pointing it at a base-plus-evolved pair does not merely
       * mislead, it spends the player's run: they feed an instrument toward a
       * combination the offer will never contain, and nothing ever tells them
       * why it did not arrive.
       */
      if ((instrumentDef(a)?.fused === true) !== (instrumentDef(b)?.fused === true)) continue;
      const ta = Math.min(DUET_INPUT_LEVEL, maxLevelOf(a));
      const tb = Math.min(DUET_INPUT_LEVEL, maxLevelOf(b));
      const need = Math.max(0, ta - (all[a] ?? 0)) + Math.max(0, tb - (all[b] ?? 0));
      if (need === 0) continue;
      const short = [
        (all[a] ?? 0) < ta ? `${labelOf(a)} +${ta - (all[a] ?? 0)}` : '',
        (all[b] ?? 0) < tb ? `${labelOf(b)} +${tb - (all[b] ?? 0)}` : '',
      ].filter(Boolean).join(' · ');
      out.push({ to: id, needs: short, away: need });
    }
  }
  return out.sort((x, y) => x.away - y.away);
}

export class LevelUpOverlay {
  /** Null when no offer is open. */
  private cards: Card[] | null = null;
  private offerLevel = 0;
  private queued = 0;
  private rerolls: number | null = null;
  private banishes: number | null = null;
  private controls: Control[] = [];
  /** Bottom of the last card, written by `layout`, read by the ensemble rows. */
  private bodyBottom = 0;

  /**
   * The column `layout()` chose: left edge and width, in view units.
   *
   * Everything below the cards — YOUR ENSEMBLE, the two chip rows, the fusion
   * line — has to sit in the same column as the cards, and the cards stopped
   * being `W` minus a percentage the moment `CARD_MAX_W` and centring arrived.
   * Recorded rather than recomputed, so there is exactly one place that decides
   * where the page's body is.
   */
  private bodyX = 0;

  private bodyW = 0;

  /** Seconds the current offer has been open, for the staggered entry. */
  private age = 0;
  /**
   * The resolve.
   *
   * A choice does not blank the screen: the chosen card flares and the others
   * fall away over `EXIT`, so the pick reads as an answer to the question
   * rather than as the question disappearing. `chosen` is -1 for a skip.
   */
  private exiting = false;
  private exitAge = 0;
  private chosen = -1;

  /** Keyboard/mouse highlight. Owned here, set from outside via `select`. */
  private sel = 0;

  /**
   * Has `snapshot.choosing` been observed true since this offer opened?
   *
   * The close signal cannot be the events alone. `progression.chooseOption`
   * returns `{ ok, id, grace }`, and `docs/progression.md` emits `level:choice`
   * only `if (c.ok && c.id)` — so **taking a grace card emits nothing at all**,
   * neither a choice nor a skip, and a screen driven purely by events would sit
   * open forever on the one pick that produces no event. `snapshot.choosing` is
   * the authoritative state and closing on its falling edge fixes that.
   *
   * It is latched rather than read directly because the arena conversion that
   * populates `choosing` is landing in another workstream: until it does, the
   * field is a constant `false`, and closing on "not choosing" would shut the
   * screen on the frame it opened. Waiting to see it go true first means this
   * works before that lands and gets stricter for free after it does.
   */
  private sawChoosing = false;

  private celebrations: Celebration[] = [];

  private static readonly ENTRY = 0.26;
  private static readonly STAGGER = 0.07;
  private static readonly EXIT = 0.55;
  /**
   * The widest a card is allowed to get, in view units. See `layout`.
   *
   * A reading-measure bound rather than a taste one, and it only ever bites on
   * a window wide enough that `VIEW_W * 0.876` exceeds it — roughly 1130px and
   * up. It exists because `VIEW_W` stopped being the constant 900.
   */
  private static readonly CARD_MAX_W = 1000;

  /* ---------------------------------------------------------------- state */

  /**
   * Open an offer.
   *
   * Tolerates both the narrow payload (`AbilityId[]`, grace options filtered
   * out) and the wide one (`{ id, grace }[]`), because which one arrives is a
   * decision in `core/events.ts` that belongs to another workstream. Under the
   * narrow payload a grace option is simply absent and this draws three cards;
   * under the wide one it draws four and names the grace.
   */
  open(payload: OfferPayload, snap: GameSnapshot): void {
    this.offerLevel = payload.level;
    this.queued = payload.queued;
    this.rerolls = payload.rerolls ?? null;
    this.banishes = payload.banishes ?? null;
    this.age = 0;
    this.exiting = false;
    this.exitAge = 0;
    this.chosen = -1;
    this.sel = 0;
    this.sawChoosing = false;
    this.cards = payload.options.map((o) => this.card(o, snap));
  }

  private card(option: OfferOptionLike, snap: GameSnapshot): Card {
    const raw = typeof option === 'object' && option !== null ? option : { id: option, grace: null };
    const id = raw.id ?? null;
    const grace = raw.grace ?? null;
    const replaces = (typeof option === 'object' && option !== null ? option.replaces : null) ?? null;

    if (id === null) {
      // A grace card, or an option whose id was filtered away upstream. Either
      // way there is no ability to describe, so say what it actually is.
      const ui = grace ? GRACE_UI[grace] : { label: 'REST', note: 'nothing new to learn', character: 'a bar of silence' };
      return {
        id: null,
        grace,
        slot: null,
        label: ui.label,
        note: ui.note,
        character: ui.character,
        level: 0,
        from: 0,
        max: 0,
        isNew: false,
        completes: null,
        toward: null,
        tier: null,
        replaces: null,
        hue: GRACE_HUE,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
      };
    }

    // `abilities` is keyed by AbilityId; a synthesised duet id is not in that
    // union but is a legitimate key at runtime, so widen the read.
    const from = (snap.abilities as Record<string, number>)[id] ?? 0;
    /*
     * Trust the offer's level when it gives one.
     *
     * `from + 1` is right for every ordinary card and wrong for a fusion: the
     * result is not held yet, so `from` is 0 and this drew a single notehead
     * for something that arrives at its ceiling. The game already worked the
     * level out when it built the option; re-deriving it here was the whole
     * mistake.
     */
    const offered = typeof option === 'object' && option !== null ? option.level : undefined;
    const level = offered ?? from + 1;
    const character = characterOf(id);
    return {
      id,
      grace: null,
      slot: slotOf(id),
      label: labelOf(id),
      note: stepNote(id, level),
      character,
      level,
      from,
      max: maxLevelOf(id),
      isNew: from === 0,
      completes: completesFusion(id as AbilityId, level, snap.abilities),
      toward: advancesToward(id, level, snap.abilities),
      // Only a fusion RESULT has a tier; everything else is a plain recruit.
      tier: instrumentDef(id)?.fused === true ? kindOf(id) : null,
      replaces,
      hue: characterHue(character),
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  }

  /** The player committed. `index` is -1 for a skip, which flares no card. */
  resolve(index: number): void {
    if (!this.cards || this.exiting) return;
    this.exiting = true;
    this.exitAge = 0;
    this.chosen = index;
  }

  /**
   * The player committed, identified by what they took rather than by where it
   * was on screen.
   *
   * `level:choice` carries no index, so the card to flare has to be found by
   * what it was. Using the highlight instead would be wrong the moment anything
   * picks a card without moving the highlight first — a mouse click, or a key
   * handler that maps 1-4 straight to `chooseOption(state, n)` — and it would
   * flare the wrong card silently.
   *
   * A grace pick has a null id and is identified by its `grace` kind instead.
   * Matching on the first card of that kind is right even when an offer holds
   * two of them: they are indistinguishable by construction, so flaring either
   * one is flaring the card the player took.
   */
  resolveChoice(id: AbilityId | string | null, grace: GraceKind | null = null): void {
    const i = this.cards
      ? this.cards.findIndex((c) => (id !== null ? c.id === id : grace !== null && c.grace === grace))
      : -1;
    this.resolve(i);
  }

  /** Highlight a card without committing to it. */
  select(index: number): void {
    if (!this.cards) return;
    this.sel = Math.max(0, Math.min(this.cards.length - 1, index));
  }

  get selected(): number {
    return this.sel;
  }

  /** True while an offer is on screen, including its exit animation. */
  get isOpen(): boolean {
    return this.cards !== null;
  }

  /**
   * A fusion landed. This is the payoff of an entire run, so it gets its own
   * full-screen moment rather than sharing the wave banner's treatment.
   *
   * A union — REQUIEM or STRING SECTION — costs two maxed instruments *and* two
   * maxed rig items and `tools/levelup.mjs` measures it at roughly one run in
   * 240. It holds for two seconds longer than an evolution, washes the whole
   * field gold, and names itself UNION, because a player who reaches one has
   * done something almost nobody will see and must not be able to miss it.
   */
  /**
   * `to` widens to `string` for DUETs, whose result id is synthesised (`a+b`).
   * `labelOf` resolves it through `instrumentDef`, so the banner reads
   * "PIZZICATO × SNARE ROLL" without any special case here.
   */
  celebrate(
    kind: 'evolution' | 'union' | 'lattice' | 'duet',
    a: AbilityId,
    b: AbilityId,
    to: EvolvedId | string,
    line: string,
  ): void {
    /*
     * THE TIER COMES FROM THE RECIPE TABLE, NOT FROM THE EVENT, and that is a
     * defect this screen had until somebody looked at it.
     *
     * `core/events.ts` carries three fusion events and a lattice fires
     * `ability:evolve` — it is an authored, collectable, named result, so it
     * belongs on the path that records a discovery and swells the arrangement.
     * The caller therefore hands this method 'evolution', and the plate
     * announced BOMB as an EVOLUTION while the offer card two seconds earlier
     * had called it an ARRANGEMENT. Screenshotted; no gate could see it,
     * because both strings are legal and neither is empty.
     *
     * `kindOf` reads the same `FUSIONS` table the card read, so the two cannot
     * disagree again without the table itself being wrong. The parameter is
     * kept for the ids `FUSIONS` cannot contain — a synthesised duet or union
     * — where `kindOf` falls back to the parents and agrees anyway.
     */
    const tier = kindOf(to) ?? kind;
    this.celebrations.push({
      kind: tier,
      a: labelOf(a),
      b: labelOf(b),
      to: labelOf(to),
      line,
      hue: tier === 'union' ? GOLD : characterHue(characterOf(to)),
      age: 0,
      life: tier === 'union' ? 6.2 : 3.6,
    });
  }

  /**
   * Hold the screen open with a synthetic offer, for screenshots.
   *
   * Identical to `open` — it exists as a separate name so that the debug hook
   * reads as a debug hook at the call site, and so that grepping for it finds
   * every place this screen is being driven by something other than the game.
   */
  forceOffer(payload: OfferPayload, snap: GameSnapshot): void {
    this.open(payload, snap);
  }

  /** Drop the screen immediately, with no exit animation. */
  clearForced(): void {
    this.cards = null;
    this.exiting = false;
  }

  /* ------------------------------------------------------------ hit-testing */

  /**
   * Which card is under a point, in **playfield canvas coordinates** — the same
   * 900x1120 space the overlay canvas is drawn in, not client pixels. Returns
   * -1 for a miss. Exists so the click mapping in `main.ts` does not have to
   * re-derive this layout and then drift from it.
   */
  hitTest(px: number, py: number): number {
    if (!this.cards || this.exiting) return -1;
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) return i;
    }
    return -1;
  }

  /**
   * The card rectangles as last laid out, for a check to assert against.
   *
   * Exposed because the failure this screen is most likely to have is a silent
   * one: cards that draw somewhere other than where `hitTest` believes they
   * are, so the player clicks PIZZICATO and receives SNARE ROLL. A tool can
   * only catch that by comparing the two, and it cannot compare them if the
   * layout is private.
   */
  rects(): { x: number; y: number; w: number; h: number }[] {
    return (this.cards ?? []).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
  }

  /** What each card resolved to, for the same reason. */
  summary(): { label: string; level: number; from: number; isNew: boolean; completes: string | null }[] {
    return (this.cards ?? []).map((c) => ({
      label: c.label,
      level: c.level,
      from: c.from,
      isNew: c.isNew,
      completes: c.completes,
    }));
  }

  /** The levers, in the same coordinate space. */
  hitTestControl(px: number, py: number): 'reroll' | 'banish' | 'skip' | null {
    if (!this.cards || this.exiting) return null;
    for (const c of this.controls) {
      if (px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) {
        return c.label.toLowerCase() as 'reroll' | 'banish' | 'skip';
      }
    }
    return null;
  }

  /* -------------------------------------------------------------- drawing */

  /**
   * Draw whatever is live. Called last in the overlay pass, so it sits over the
   * boss bar, the banner and the vignette.
   *
   * `beat` is the transport's continuous beat position and `pulse` the
   * renderer's decaying beat lamp; both are passed in rather than recomputed so
   * this screen keeps time with the enemies rather than near them.
   */
  draw(
    g: CanvasRenderingContext2D,
    snap: GameSnapshot,
    dt: number,
    W: number,
    H: number,
    beat: number,
    pulse: number,
  ): void {
    this.step(dt);
    if (this.cards) {
      // The falling edge of `choosing` closes the screen whatever the events
      // did or did not say. See the note on `sawChoosing`.
      if (snap.choosing) this.sawChoosing = true;
      else if (this.sawChoosing && !this.exiting) this.resolve(this.chosen);
      this.drawOffer(g, snap, W, H, beat, pulse);
    }
    if (this.celebrations.length) this.drawCelebrations(g, W, H);
  }

  private step(dt: number): void {
    // Clamped: a frame that ran long must not skip an entry animation entirely,
    // and a backgrounded tab hands back a dt measured in seconds.
    const d = Math.min(0.05, Math.max(0, dt));
    if (this.cards) {
      this.age += d;
      if (this.exiting) {
        this.exitAge += d;
        if (this.exitAge > LevelUpOverlay.EXIT) {
          this.cards = null;
          this.exiting = false;
        }
      }
    }
    for (const c of this.celebrations) c.age += d;
    // Filtered rather than spliced in place: two fusions can land on one boss
    // and both are drawn, stacked, for as long as they each last.
    if (this.celebrations.some((c) => c.age > c.life)) {
      this.celebrations = this.celebrations.filter((c) => c.age <= c.life);
    }
  }

  /* ------------------------------------------------------------ the offer */

  private drawOffer(
    g: CanvasRenderingContext2D,
    snap: GameSnapshot,
    W: number,
    H: number,
    beat: number,
    pulse: number,
  ): void {
    const cards = this.cards!;
    const exit = this.exiting ? clamp01(this.exitAge / LevelUpOverlay.EXIT) : 0;
    // The page as a whole fades on the way out; individual cards then move
    // against that, so the chosen one is still legible while it flares.
    const page = 1 - exit * exit;

    const barPhase = ((beat / 4) % 1 + 1) % 1;
    const downbeat = pulse * (1 - barPhase * 0.7);

    g.save();

    /*
     * The backdrop, and the reason it is not opaque.
     *
     * The world is still moving underneath at 0.12x — enemies drifting, bullets
     * crawling, the grid settling. Blacking it out would throw away the one
     * thing that makes this screen feel like it belongs to this game rather
     * than to a menu system, and it would also hide the fact that the fight is
     * still happening, which is information the player needs to decide how long
     * they can afford to read.
     */
    g.globalAlpha = page;
    g.fillStyle = 'rgba(3,4,9,0.74)';
    g.fillRect(0, 0, W, H);
    // The downbeat, on the whole page. See the note at the top of this file for
    // why the screen with no bullets on it is allowed to do this.
    if (downbeat > 0.01) {
      g.fillStyle = `hsla(212, 80%, 60%, ${downbeat * 0.045})`;
      g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 1;

    this.drawHeader(g, W, H, page, barPhase, downbeat);
    this.layout(cards, W, H);

    for (let i = 0; i < cards.length; i++) {
      this.drawCard(g, cards[i], i, page, exit, pulse);
    }

    this.drawEnsemble(g, snap, H, page);
    this.drawControls(g, W, H, page);

    g.restore();
  }

  /**
   * LEVEL n under a fermata.
   *
   * The fermata is drawn rather than typed because the glyph (U+1D110) is not
   * in any font this game can rely on, and because a drawn one can breathe. It
   * is the right symbol and not decoration: `docs/progression.md` specifies the
   * musical gesture for an open offer as "a fermata over a held dominant,
   * resolving on the choice", so the screen and the arrangement are making the
   * same sign at the same time.
   */
  private drawHeader(
    g: CanvasRenderingContext2D,
    W: number,
    H: number,
    page: number,
    barPhase: number,
    downbeat: number,
  ): void {
    const t = clamp01(this.age / 0.3);
    const a = page * t;
    const cx = W / 2;
    const y = H * 0.062;

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // The fermata swells across the bar and settles on the downbeat: a held
    // note, which is exactly what the world is doing at 0.12x.
    const swell = 1 + Math.sin(barPhase * Math.PI) * 0.09 + downbeat * 0.05;
    g.save();
    g.translate(cx, y);
    g.scale(swell, swell);
    g.strokeStyle = `hsla(${GOLD}, 90%, 66%, ${a * 0.85})`;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, 4, 17, Math.PI * 1.06, Math.PI * 1.94);
    g.stroke();
    g.fillStyle = `hsla(${GOLD}, 95%, 72%, ${a})`;
    g.beginPath();
    g.arc(0, 1, 3.1, 0, TAU);
    g.fill();
    g.restore();

    g.font = '800 30px ui-monospace, monospace';
    g.fillStyle = `rgba(240,246,255,${a})`;
    g.fillText(`LEVEL ${this.offerLevel}`, cx, y + 42);

    g.font = '600 13px ui-monospace, monospace';
    g.fillStyle = `hsla(200, 60%, 78%, ${a * 0.72})`;
    g.fillText('the band is waiting — who joins?', cx, y + 66);

    if (this.queued > 0) {
      // A queued level is a promise the player has already earned. Saying so
      // stops the next offer opening two seconds later reading as a glitch.
      g.font = '700 11px ui-monospace, monospace';
      g.fillStyle = `hsla(${GOLD}, 90%, 70%, ${a * 0.9})`;
      g.fillText(`+${this.queued} MORE WAITING`, cx, y + 88);
    }
  }

  /**
   * Card geometry, recomputed each frame so it survives a field resize and so
   * `hitTest` can never read a stale rectangle.
   */
  private layout(cards: Card[], W: number, H: number): void {
    const padX = Math.round(W * 0.062);
    /*
     * THE CARDS STOP GROWING, AND THEN CENTRE.
     *
     * `W` is `VIEW_W`, which used to be the constant 900 and is now the window.
     * Without a cap a 1512px window gave four 1306x134 cards: a line of 13px
     * text starting at the left rail with 900px of empty plate after it, which
     * reads as a table that failed to load rather than as a card. An ultrawide
     * made it 1580.
     *
     * MEASURE_MAX is a reading-length bound, not a taste one. The longest note
     * a rig rule authors is COMPRESSOR's, which is why `drawCard` wraps notes
     * to two lines at all; at 13px monospace that sentence needs ~700px, and
     * the widest card that keeps a single line of body text inside a
     * comfortable measure is around a thousand. Below the cap nothing changes,
     * so every window narrower than ~1130 lays out exactly as it did.
     *
     * Centred rather than left-aligned, because the offer is a modal page and
     * the eye should not have to travel to a corner for it.
     */
    const w = Math.min(W - padX * 2, LevelUpOverlay.CARD_MAX_W);
    const x = Math.round((W - w) / 2);
    const top = H * 0.175;
    // Room reserved at the bottom for the ensemble rows and the lever line.
    const bottom = H - Math.max(190, H * 0.2);
    const gap = 13;
    const n = Math.max(1, cards.length);
    const h = Math.min(155, Math.max(78, (bottom - top - gap * (n - 1)) / n));

    for (let i = 0; i < cards.length; i++) {
      cards[i].x = x;
      cards[i].y = Math.round(top + i * (h + gap));
      cards[i].w = w;
      cards[i].h = Math.round(h);
    }
    // Where the ensemble rows start. Anchored to the last card rather than to
    // the bottom of the field: the card height is clamped, so with four cards
    // there is slack, and a block pinned to the bottom edge left a 140px hole
    // in the middle of the page.
    this.bodyBottom = top + n * h + (n - 1) * gap;
    this.bodyX = x;
    this.bodyW = w;
  }

  private drawCard(
    g: CanvasRenderingContext2D,
    c: Card,
    i: number,
    page: number,
    exit: number,
    pulse: number,
  ): void {
    // Staggered entry: the players arrive one at a time, which is the same
    // gesture the TUNING UP screen makes while the arrangement assembles.
    const born = clamp01((this.age - i * LevelUpOverlay.STAGGER) / LevelUpOverlay.ENTRY);
    if (born <= 0) return;
    const ease = 1 - (1 - born) * (1 - born) * (1 - born);

    const isChosen = this.exiting && this.chosen === i;
    const isSel = !this.exiting && i === this.sel;
    // On the way out the chosen card holds and brightens; the rest slide away.
    const fade = this.exiting ? (isChosen ? 1 : 1 - exit) : 1;
    const slide = (1 - ease) * 26 + (this.exiting && !isChosen ? exit * 34 : 0);
    const alpha = page * ease * fade;
    if (alpha <= 0.01) return;

    const x = c.x + slide;
    const y = c.y;
    const w = c.w;
    const h = c.h;
    const cy = y + h / 2;
    // A chosen card flares gold for the whole exit; that flash is the receipt.
    const flare = isChosen ? Math.sin(clamp01(exit * 1.6) * Math.PI) : 0;
    const hue = c.completes ? GOLD : c.hue;

    g.save();
    g.globalAlpha = alpha;

    // Plate.
    this.plate(g, x, y, w, h, 10);
    g.fillStyle = 'rgba(7,9,17,0.9)';
    g.fill();

    // A wash of the character's own colour, so the six timbres are separable
    // before a single word has been read.
    const wash = g.createLinearGradient(x, y, x + w * 0.7, y);
    wash.addColorStop(0, `hsla(${hue}, 85%, 55%, ${0.16 + flare * 0.3})`);
    wash.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = wash;
    g.fill();

    // Border. The selected card also takes the beat, at full strength — this is
    // the flash that used to be spread over the whole playfield.
    const beatLift = isSel ? pulse * 0.42 : 0;
    g.strokeStyle = `hsla(${hue}, 90%, ${62 + beatLift * 22}%, ${(isSel ? 0.85 : 0.4) + flare * 0.5})`;
    g.lineWidth = isSel ? 2 : 1;
    g.stroke();

    // The rail: a spine of the character's colour down the left edge.
    g.fillStyle = `hsla(${hue}, 92%, ${58 + beatLift * 20}%, ${0.85 + flare * 0.15})`;
    g.fillRect(x + 1, y + 1, 4, h - 2);

    /*
     * The staff.
     *
     * Five faint lines across the body of the card. It is the cheapest possible
     * way to make the page read as score rather than as a settings panel, and
     * the level pips below sit on it as real noteheads.
     */
    const sx = x + 62;
    const sw = w - 78;
    g.strokeStyle = `hsla(${hue}, 60%, 70%, 0.075)`;
    g.lineWidth = 1;
    g.beginPath();
    for (let k = -2; k <= 2; k++) {
      const ly = Math.round(cy + k * 7) + 0.5;
      g.moveTo(sx, ly);
      g.lineTo(sx + sw, ly);
    }
    g.stroke();

    // The card's number, in a circle. 1-4 select from the keyboard.
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.beginPath();
    g.arc(x + 34, cy, 14, 0, TAU);
    g.strokeStyle = `hsla(${hue}, 90%, 68%, ${0.5 + beatLift})`;
    g.lineWidth = 1.4;
    g.stroke();
    g.font = '700 14px ui-monospace, monospace';
    g.fillStyle = `hsla(${hue}, 95%, 78%, 0.95)`;
    g.fillText(String(i + 1), x + 34, cy + 0.5);

    /*
     * Name, note, character — all placed as fractions of the card height.
     *
     * Fixed pixel offsets read fine at the 142px the cards get on a 1120-tall
     * field and collide at the 78px floor `layout` allows for a short field or
     * a longer offer, which is the sort of thing that only shows up on someone
     * else's window. Proportional keeps the same reading order at every size.
     */
    g.textAlign = 'left';
    const top = cy - h * 0.3;
    /*
     * The LABEL is fitted now, not just the note beneath it.
     *
     * Every authored instrument name is at most 10 characters, so a bare
     * `fillText` was safe for as long as that was the whole vocabulary. DUET
     * names are built by concatenation — `HARP GLISS × SNARE ROLL` is 23 — and
     * would have run off the card and over its neighbour.
     *
     * A duet also drops a size, because two names joined by an × read as one
     * long word at 21px and the ellipsis would eat the second parent — which is
     * exactly the half that tells the player what they made.
     */
    const isDuet = c.label.includes(' × ');
    g.font = `800 ${h > 120 ? (isDuet ? 16 : 21) : (isDuet ? 14 : 18)}px ui-monospace, monospace`;
    g.fillStyle = `hsl(${hue}, 92%, ${76 + flare * 14}%)`;
    if (isDuet && g.measureText(c.label).width > sw - 8) {
      /*
       * TWO LINES rather than an ellipsis, because of WHICH half gets cut.
       *
       * `fit` trims from the right, so a squeezed `HARP GLISS × SNARE ROLL`
       * becomes `HARP GLISS × SNA…` — it eats the second parent, which is the
       * only part telling the player what this card actually combines. The
       * first parent they can already see on their own stage.
       *
       * Measured against the layout's own bounds, a 23-character duet name
       * fits one line on a 320px card and does not on 260px or on the 78px-tall
       * floor `layout` allows. Both of those are reachable on a smaller window.
       */
      const [left, right] = c.label.split(' × ');
      const lh = h > 120 ? 15 : 13;
      g.fillText(this.fit(g, `${left} ×`, sw - 8), sx, top - lh * 0.5);
      g.fillText(this.fit(g, right, sw - 8), sx, top + lh * 0.6);
    } else {
      g.fillText(this.fit(g, c.label, sw - 8), sx, top);
    }

    /*
     * The note wraps to a SECOND LINE rather than taking an ellipsis, for the
     * same reason the fusion label above does: it matters WHICH half gets cut.
     *
     * This was a single `fit()` call. It was fine while every passive was a
     * multiplier — "+12% damage" has nothing to lose — but the rig now installs
     * RULES, and their notes are sentences. COMPRESSOR rendered as
     *
     *     one more shield — and every hit you take blows a ring back out of
     *     you that hurts wha…
     *
     * which drops precisely the clause that says what the item does. An item
     * whose whole purpose is to change how the game plays, described by a
     * sentence the card refuses to finish, is worse than the percentage it
     * replaced: the player cannot even tell that something changed.
     *
     * Two lines, and the ellipsis is kept as the backstop on the second — a
     * note long enough to overrun both is an authoring problem, and `levelup`
     * asserts every rung has a described change so there is somewhere for that
     * to be caught. Breaking on the last space that fits keeps words whole.
     */
    g.font = '600 13px ui-monospace, monospace';
    g.fillStyle = 'rgba(226,234,250,0.9)';
    const noteMax = sw - 96;
    if (g.measureText(c.note).width <= noteMax) {
      g.fillText(c.note, sx, cy - h * 0.09);
    } else {
      let cut = c.note.length;
      while (cut > 1 && g.measureText(c.note.slice(0, cut)).width > noteMax) cut--;
      const space = c.note.lastIndexOf(' ', cut);
      const head = space > 12 ? c.note.slice(0, space) : c.note.slice(0, cut);
      const tail = c.note.slice(head.length).trim();
      g.fillText(head, sx, cy - h * 0.09 - 7);
      g.fillText(this.fit(g, tail, noteMax), sx, cy - h * 0.09 + 7);
    }

    g.font = '400 11px ui-monospace, monospace';
    g.fillStyle = `hsla(${hue}, 55%, 72%, 0.62)`;
    g.fillText(this.fit(g, c.character, sw - 8), sx, cy + h * 0.05);

    /*
     * Slot, so "this competes for an instrument slot" is legible before the
     * player has to learn which names are instruments — EXCEPT on a card that
     * is a combination, where the tier is the more useful word. See `Card.tier`.
     *
     * ARRANGEMENT is the word this file already used in prose for an authored
     * recipe over a pair, and DUET is the generic pairing it shadows. Both
     * still take an instrument slot and both still hand one back, so nothing
     * is being hidden by the swap: a combining card is never a rig card, and
     * the level staff below it already shows it arriving at its ceiling.
     */
    if (c.tier) {
      g.textAlign = 'right';
      g.font = '700 10px ui-monospace, monospace';
      g.fillStyle = `hsla(${hue}, 70%, 78%, 0.72)`;
      g.fillText(TIER_WORD[c.tier], x + w - 16, top);
    } else if (c.slot) {
      g.textAlign = 'right';
      g.font = '700 10px ui-monospace, monospace';
      g.fillStyle = `hsla(${hue}, 50%, 70%, 0.5)`;
      g.fillText(c.slot === 'instrument' ? 'INSTRUMENT' : 'RIG', x + w - 16, top);
    }

    if (c.id) this.drawLevelStaff(g, c, sx, cy + h * 0.22, sw, hue, beatLift);

    /*
     * One pick from a fusion.
     *
     * `docs/progression.md`: "A card with `completes` set is one pick from a
     * fusion and must say so; the whole evolution table is worthless if the
     * player cannot see it coming." The measured effect of the bias that puts
     * this card in front of them is 81% against 53%, so it will happen often
     * enough to be worth recognising instantly — hence gold, which nothing else
     * on this screen is allowed to be.
     */
    if (c.completes || c.replaces || c.toward) {
      const by = y + h - 15;
      g.textAlign = 'left';
      g.font = '800 10px ui-monospace, monospace';
      /*
       * A SWAP MUST STATE ITS PRICE, and it says so before anything else.
       *
       * This card exists because the rig is full; taking it deletes a passive
       * the player chose earlier. Charging that silently would be a worse bug
       * than the dead end it was added to fix — the player would watch a
       * working item vanish and have no way to connect it to the pick. So the
       * cost is on the card, in the warning hue rather than the gold one,
       * because gold on this screen means "something good is one pick away"
       * and this line means "something of yours is about to go".
       */
      if (c.replaces) {
        g.fillStyle = `hsla(${SPEND}, 92%, 68%, ${0.85 + flare * 0.15})`;
        g.fillText(`⇄ REPLACES ${labelOf(c.replaces as AbilityId)}`, sx, by);
      } else if (c.completes) {
        g.fillStyle = `hsla(${GOLD}, 95%, 72%, ${0.85 + flare * 0.15})`;
        g.fillText(`◈ ONE PICK FROM ${labelOf(c.completes)}`, sx, by);
      } else if (c.toward) {
        /*
         * Guidance, and deliberately quieter than the other two.
         *
         * Gold on this screen means "a payoff is one pick away" and must keep
         * meaning exactly that, so progress toward a recipe is drawn in the
         * card's own hue at low alpha — present when you look for it, not
         * competing with the line above. Lowest priority of the three: a swap
         * names a price the player is about to pay and a completed fusion is
         * news, while this is only a direction.
         */
        g.fillStyle = `hsla(${hue}, 60%, 74%, 0.5)`;
        const away = c.toward.away;
        g.fillText(`↗ ${labelOf(c.toward.to as AbilityId)} · ${away} more`, sx, by);
      }
    }

    g.restore();
  }

  /**
   * The level as noteheads on a staff line.
   *
   * `maxLevelOf` decides how many — three for an instrument, three for a rig
   * item, three for a fusion — so how far a thing is from maxing, which is the
   * only number that decides whether an evolution is reachable, is a shape
   * rather than a fraction to be read and subtracted.
   *
   * The count is read off the card and never assumed. It used to be eight and
   * five and this comment used to say so; the code below has always taken
   * `c.max`, which is why the ladders could shorten without the drawing
   * changing at all.
   *
   * WHAT DID CHANGE IS THE WIDTH OF THE ROW, and it is worth knowing before
   * anyone reads the screen and calls it a bug. `step` is
   * `clamp((sw - 150) / n, 8, 17)`; at n = 8 the divisor bound and the 17px
   * ceiling landed near each other, and at n = 3 the ceiling always wins. So
   * the SPACING between noteheads is unchanged and the row is now three of them
   * across ~34px instead of eight across ~119px — a short motif rather than a
   * bar of them. That is the honest picture of a three-rung ladder and it reads
   * correctly, but it has not been looked at by a person; `tools/levelupdraw.mjs`
   * is the check that renders it.
   */
  private drawLevelStaff(
    g: CanvasRenderingContext2D,
    c: Card,
    sx: number,
    y: number,
    sw: number,
    hue: number,
    beatLift: number,
  ): void {
    const n = Math.max(1, c.max);
    // Floored at 8: on a narrow field `(sw - 150) / n` goes negative, and a
    // negative step lays the noteheads out right-to-left on top of each other.
    const step = Math.max(8, Math.min(17, (sw - 150) / n));
    const w = step * (n - 1);

    g.strokeStyle = `hsla(${hue}, 70%, 66%, 0.3)`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(sx, Math.round(y) + 0.5);
    g.lineTo(sx + w + 8, Math.round(y) + 0.5);
    g.stroke();

    for (let k = 0; k < n; k++) {
      const px = sx + k * step;
      const owned = k < c.from;
      const gaining = k === c.from;
      g.beginPath();
      // A real notehead: an ellipse on a slight rake. It costs nothing and it
      // is the difference between a progress bar and a piece of music.
      g.ellipse(px, y, 5.2, 3.7, -0.34, 0, TAU);
      if (owned) {
        g.fillStyle = `hsla(${hue}, 90%, 70%, 0.92)`;
        g.fill();
      } else if (gaining) {
        g.fillStyle = `hsla(${hue}, 100%, ${72 + beatLift * 20}%, ${0.55 + beatLift * 0.45})`;
        g.fill();
        g.strokeStyle = `hsla(${hue}, 100%, 84%, 0.95)`;
        g.lineWidth = 1.4;
        g.stroke();
      } else {
        g.strokeStyle = `hsla(${hue}, 50%, 66%, 0.34)`;
        g.lineWidth = 1.1;
        g.stroke();
      }
    }

    g.textAlign = 'right';
    g.font = '700 12px ui-monospace, monospace';
    if (c.isNew) {
      g.fillStyle = `hsla(${hue}, 95%, 78%, 0.95)`;
      g.fillText('JOINS THE BAND', sx + sw, y + 0.5);
    } else if (c.level >= c.max) {
      g.fillStyle = `hsla(${GOLD}, 95%, 74%, 0.95)`;
      g.fillText(`LV ${c.from} → ${c.level}  MAX`, sx + sw, y + 0.5);
    } else {
      g.fillStyle = `hsla(${hue}, 60%, 76%, 0.8)`;
      g.fillText(`LV ${c.from} → ${c.level}`, sx + sw, y + 0.5);
    }
  }

  /**
   * The ensemble so far, and anything waiting on the next boss.
   *
   * On the screen where the band grows, the band has to be visible: a pick is
   * only a decision if the player can see what it is being added to. Two rows,
   * because the two inventories compete for different slots and confusing them
   * is the one way to waste a level.
   */
  private drawEnsemble(g: CanvasRenderingContext2D, snap: GameSnapshot, H: number, page: number): void {
    const a = page * clamp01((this.age - 0.18) / 0.32);
    if (a <= 0.01) return;
    /*
     * ALIGNED TO THE CARDS, not to the field.
     *
     * This computed its own `padX` from `W` and was right for as long as the
     * cards did too. They stop at `CARD_MAX_W` and centre now, so on a wide
     * window a field-derived pad put YOUR ENSEMBLE and both chip rows several
     * hundred pixels to the left of the column they belong to. `layout()`
     * records the column it chose; this reads it.
     */
    const padX = this.bodyX;
    const bodyRight = this.bodyX + this.bodyW;
    // Below the last card, but never so far down that it collides with the
    // lever line at H - 30.
    const y0 = Math.min(this.bodyBottom + 34, H - 145);

    g.save();
    g.globalAlpha = a;
    g.textAlign = 'left';
    g.textBaseline = 'middle';

    g.font = '800 10px ui-monospace, monospace';
    g.fillStyle = 'rgba(150,170,205,0.55)';
    g.fillText('YOUR ENSEMBLE', padX, y0);
    g.strokeStyle = 'rgba(150,170,205,0.16)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padX + 108, Math.round(y0) + 0.5);
    g.lineTo(bodyRight, Math.round(y0) + 0.5);
    g.stroke();

    const held = Object.entries(snap.abilities) as [AbilityId, number][];
    const instruments = held.filter(([id]) => slotOf(id) === 'instrument');
    const rig = held.filter(([id]) => slotOf(id) === 'rig');
    this.chipRow(g, 'PLAYERS', instruments, snap.instrumentSlots, padX, y0 + 26, this.bodyW);
    this.chipRow(g, 'RIG', rig, snap.rigSlots, padX, y0 + 54, this.bodyW);

    const ready = readyFusions(snap.abilities);
    if (ready.length) {
      const r = ready[0];
      // Not "ON THE NEXT BOSS" — a boss has not resolved a fusion since they
      // became cards you pick. Same false-instruction fix as the HUD banner.
      const head = `◈ ${labelOf(r.to)} IS READY TO COMBINE`;
      g.font = '800 11px ui-monospace, monospace';
      g.fillStyle = `hsla(${GOLD}, 95%, 72%, 0.95)`;
      g.fillText(head, padX, y0 + 84);
      // Measured while the bold font is still set. Measuring after the switch
      // would size the heading with the lighter face and start the tail early.
      const tailX = padX + 8 + g.measureText(head).width;
      g.font = '400 11px ui-monospace, monospace';
      g.fillStyle = `hsla(${GOLD}, 60%, 74%, 0.6)`;
      g.fillText(this.fit(g, `— ${r.line}`, bodyRight - tailX), tailX, y0 + 84);
    }

    g.restore();
  }

  private chipRow(
    g: CanvasRenderingContext2D,
    title: string,
    held: [AbilityId, number][],
    slots: number,
    x: number,
    y: number,
    maxW: number,
  ): void {
    g.font = '700 10px ui-monospace, monospace';
    g.fillStyle = 'rgba(140,160,196,0.5)';
    g.fillText(title, x, y);

    let cx = x + 66;
    const limit = x + maxW;
    for (const [id, level] of held) {
      const hue = characterHue(characterOf(id));
      const max = maxLevelOf(id);
      const text = max > 1 ? `${labelOf(id)} ${level}` : labelOf(id);
      g.font = '700 10px ui-monospace, monospace';
      const w = g.measureText(text).width + 16;
      if (cx + w > limit) break;
      const maxed = level >= max;
      this.plate(g, cx, y - 9, w, 18, 5);
      g.fillStyle = `hsla(${hue}, 80%, 55%, ${maxed ? 0.3 : 0.16})`;
      g.fill();
      // A maxed instrument is half of a fusion, so it is worth being able to
      // pick out of the row without reading the number next to it.
      g.strokeStyle = maxed ? `hsla(${GOLD}, 90%, 66%, 0.8)` : `hsla(${hue}, 85%, 62%, 0.45)`;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = maxed ? `hsl(${GOLD}, 95%, 78%)` : `hsl(${hue}, 90%, 76%)`;
      g.fillText(text, cx + 8, y + 0.5);
      cx += w + 6;
    }

    // The empty slots are drawn, for the same reason the powerup row draws
    // them: a boss permanently widening the band is a reward the player has to
    // be able to see, and three-of-three looks exactly like three-of-four
    // unless the capacity is on screen.
    for (let i = held.length; i < slots; i++) {
      if (cx + 26 > limit) break;
      this.plate(g, cx, y - 9, 22, 18, 5);
      g.strokeStyle = 'rgba(140,160,196,0.26)';
      g.setLineDash([2, 2]);
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);
      cx += 28;
    }
  }

  /** Reroll, banish and skip, with the counts `Offer` already tracks. */
  private drawControls(g: CanvasRenderingContext2D, W: number, H: number, page: number): void {
    const a = page * clamp01((this.age - 0.3) / 0.3);
    this.controls.length = 0;
    if (a <= 0.01) return;

    const items: { key: string; label: string; count: number | null }[] = [
      { key: '1-4', label: 'CHOOSE', count: null },
      { key: 'R', label: 'REROLL', count: this.rerolls },
      /*
       * The keys these actually are. They read 'B' and 'S', and neither was
       * bound: banish is SHIFT plus the card number (`input.ts` sets `banish`
       * only when a digit arrives shifted) and skip is Q. 'S' is worse than
       * merely wrong — it is move-down, so a player following the on-screen
       * prompt drove their ship at the floor instead of skipping.
       */
      { key: '⇧1-4', label: 'BANISH', count: this.banishes },
      { key: 'Q', label: 'SKIP', count: null },
    ];

    g.save();
    g.globalAlpha = a;
    g.textBaseline = 'middle';
    g.font = '700 11px ui-monospace, monospace';

    const y = H - 30;
    const widths = items.map((it) => {
      const text = it.count === null ? it.label : `${it.label} ×${it.count}`;
      return g.measureText(text).width + g.measureText(it.key).width + 30;
    });
    const total = widths.reduce((s, v) => s + v, 0) + (items.length - 1) * 18;
    let cx = (W - total) / 2;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const w = widths[i];
      // A spent lever is drawn, dimmed, rather than removed: a control that
      // vanishes teaches the player nothing about why it is gone.
      const spent = it.count !== null && it.count <= 0;
      g.textAlign = 'left';
      /*
       * The keycap is sized to its TEXT, not to a constant 22.
       *
       * That constant was fine while every key was one character. Correcting
       * the labels to the real bindings put "⇧1-4" on one of them, which
       * overflows a 22px plate and prints outside its own border — a fix for
       * one wrong thing creating a visibly broken other. The row width above
       * already measures `it.key`, so widening the plate keeps the two in step.
       */
      const kw = Math.max(22, g.measureText(it.key).width + 12);
      this.plate(g, cx, y - 11, kw, 22, 4);
      g.strokeStyle = `rgba(170,190,225,${spent ? 0.14 : 0.34})`;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = `rgba(210,224,248,${spent ? 0.3 : 0.85})`;
      g.textAlign = 'center';
      g.fillText(it.key, cx + kw / 2, y + 0.5);
      g.textAlign = 'left';
      g.fillStyle = `rgba(190,206,235,${spent ? 0.28 : 0.7})`;
      g.fillText(it.count === null ? it.label : `${it.label} ×${it.count}`, cx + kw + 8, y + 0.5);
      if (it.label !== 'CHOOSE') {
        this.controls.push({ key: it.key, label: it.label, count: it.count, x: cx, y: y - 13, w, h: 26 });
      }
      cx += w + 18;
    }
    g.restore();
  }

  /* ------------------------------------------------------------- the payoff */

  /**
   * The fusion. Two names converge and become one.
   *
   * This fires on a boss defeat with the world at full speed, so it must not
   * black the field out — it is a plate across the middle third plus a wash
   * that decays inside a second, rather than a screen the player has to wait
   * out while something is shooting at them.
   */
  private drawCelebrations(g: CanvasRenderingContext2D, W: number, H: number): void {
    for (let i = 0; i < this.celebrations.length; i++) {
      const c = this.celebrations[i];
      const t = c.age;
      const inA = clamp01(t / 0.25);
      const outA = clamp01((c.life - t) / 0.6);
      const a = Math.min(inA, outA);
      if (a <= 0.01) continue;

      const union = c.kind === 'union';
      // Converge over the first 0.9s, then hold on the result.
      const merge = clamp01(t / 0.9);
      const eased = merge * merge * (3 - 2 * merge);
      const cx = W / 2;
      const cy = H * 0.44 + i * 128;

      g.save();
      g.globalAlpha = a;

      // The flash of the merge itself, gone inside a second.
      const burst = t < 1.1 ? Math.max(0, 1 - Math.abs(t - 0.9) / 0.22) : 0;
      if (burst > 0) {
        g.fillStyle = `hsla(${c.hue}, 95%, 70%, ${burst * (union ? 0.3 : 0.16)})`;
        g.fillRect(0, 0, W, H);
      }

      const plateH = union ? 138 : 112;
      g.textAlign = 'center';
      g.textBaseline = 'middle';

      this.plate(g, W * 0.08, cy - plateH / 2, W * 0.84, plateH, 12);
      g.fillStyle = 'rgba(6,7,14,0.9)';
      g.fill();
      const glow = g.createLinearGradient(0, cy - plateH / 2, 0, cy + plateH / 2);
      glow.addColorStop(0, `hsla(${c.hue}, 90%, 55%, ${0.3 + burst * 0.4})`);
      glow.addColorStop(1, 'hsla(0,0%,0%,0)');
      g.fillStyle = glow;
      g.fill();
      g.strokeStyle = `hsla(${c.hue}, 95%, ${66 + burst * 20}%, ${0.7 + burst * 0.3})`;
      g.lineWidth = union ? 2.4 : 1.6;
      g.stroke();

      g.font = '800 11px ui-monospace, monospace';
      g.fillStyle = `hsla(${c.hue}, 90%, 74%, 0.9)`;
      /*
       * Name the tier that actually happened.
       *
       * This read `union ? 'UNION' : 'EVOLUTION'`, so a DUET — the generative
       * tier, made from two base instruments — announced itself as an
       * EVOLUTION, which is a different and rarer thing: one of twelve
       * authored recipes. The celebration told the player they had found
       * hand-written content when they had not, and the same banner appeared
       * for both, so the tiers the whole tree is built on were indistinguishable
       * at the one moment they are most visible.
       */
      /*
       * ARRANGEMENT is the word this file already used for "an authored recipe
       * over a pair" (see the note on `combinationPlan`), and the distinction
       * it draws is the one the lattice makes real: DUET is the generic
       * pairing every combination falls back to, ARRANGEMENT is one of the
       * sixty-three somebody wrote. Saying EVOLUTION here would repeat the
       * exact defect the DUET branch was added to fix.
       *
       * Through `TIER_WORD` so the banner and the offer card cannot end up
       * calling one thing two names — the diamonds are this screen's own
       * emphasis and are added around it rather than baked into it.
       */
      const word = TIER_WORD[c.kind];
      const tier = c.kind === 'union' || c.kind === 'lattice' ? `◈ ${word} ◈` : word;
      g.fillText(tier, cx, cy - plateH / 2 + 20);

      if (merge < 1) {
        // The two parents, sliding in from the wings toward each other.
        const spread = (1 - eased) * W * 0.28;
        g.font = '700 17px ui-monospace, monospace';
        g.fillStyle = `hsla(${c.hue}, 60%, 78%, ${1 - eased * 0.85})`;
        g.fillText(c.a, cx - spread - 4, cy + 4);
        g.fillText(c.b, cx + spread + 4, cy + 4);
      }
      if (merge > 0.55) {
        const rise = clamp01((merge - 0.55) / 0.45);
        g.font = `800 ${union ? 34 : 28}px ui-monospace, monospace`;
        g.fillStyle = `hsla(${c.hue}, 98%, ${78 + burst * 18}%, ${rise})`;
        g.fillText(c.to, cx, cy + 4);
        g.font = '500 12px ui-monospace, monospace';
        g.fillStyle = `hsla(${c.hue}, 70%, 76%, ${rise * 0.85})`;
        g.fillText(c.line, cx, cy + plateH / 2 - 22);
      }

      /*
       * A union frees a slot, which is the only time in a run the band gets
       * smaller and stronger at once. It is measured at about one run in 240,
       * so the player seeing it may never see it again.
       */
      if (union && merge > 0.8) {
        g.font = '700 10px ui-monospace, monospace';
        g.fillStyle = `hsla(${GOLD}, 90%, 72%, ${clamp01((merge - 0.8) / 0.2) * 0.8})`;
        g.fillText('A SLOT COMES BACK', cx, cy + plateH / 2 - 6);
      }

      g.restore();
    }
  }

  /* --------------------------------------------------------------- helpers */

  private plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    // Everywhere this game runs has roundRect, but a missing one must not take
    // the frame down with it — the same guard the HUD's note capsules use.
    if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  /** Truncate to fit, with an ellipsis, rather than overrunning the card. */
  private fit(g: CanvasRenderingContext2D, text: string, max: number): string {
    if (max <= 0 || g.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && g.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
  }
}
