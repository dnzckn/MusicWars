/**
 * The voice budget.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 * ---------------------------------------------------------------------------
 *
 * Every stem in this game earns its place on its own terms. `sub` is the floor,
 * `motifs` says which enemies are on stage, `power` says what the player is
 * holding, `arp` is the machine's filigree, `lead` is the tune. Each was
 * designed well and measured honestly. And the result, played, is a mess —
 * "music clutter also high, i think there's a lot of layering thats not
 * coherent causing more jarring music sessions".
 *
 * That is not a bug in any one layer. It is the absence of a decision that no
 * layer is in a position to make: WHO PLAYS RIGHT NOW.
 *
 * `STEM_CURVES` gates each stem on tension independently, and the `in` points
 * are 0.0 to 0.32. So above a tension of about a third — which is ordinary
 * play — all eleven stems are audible simultaneously, and five of them
 * (`chords`, `arp`, `lead`, `motifs`, `power`) are independent *tonal* lines
 * competing for the same few octaves. Worse, `motifs` is up to three ostinatos
 * and `power` up to three more, so the honest worst case is nine unrelated
 * melodies at once. Nothing in that texture is wrong; there is simply too much
 * of it for a listener to hold, and a listener who cannot follow anything hears
 * the whole thing as churn.
 *
 * ---------------------------------------------------------------------------
 * The model: eight channels
 * ---------------------------------------------------------------------------
 *
 * The music this game is trying to be — Chrono Trigger, Mega Man, Castlevania,
 * the whole 8- and 16-bit canon — was written on hardware that could not do
 * this. The SNES' SPC700 had eight voices, total, percussion included. The Game
 * Boy had four. Those scores sound rich, and they sound rich *because* of the
 * limit rather than despite it: when you can only have four things, you choose
 * which four, and the choice is the arrangement. Mitsuda's basslines are tunes
 * because the bass channel had to earn its slot.
 *
 * We are not short of CPU. We are short of the discipline the shortage forced.
 * So this file imposes it artificially: a fixed budget of tonal foreground
 * lanes, a ranked order deciding who gets them, and a smooth yield for whoever
 * loses. Everything still exists, still responds, still gets built — it just
 * stops all shouting at once.
 *
 * ---------------------------------------------------------------------------
 * Three rules, in priority order
 * ---------------------------------------------------------------------------
 *
 * 1. THE TUNE IS NEVER MASKED. `lead` outranks everything in every section
 *    where it sounds at all. This is the whole premise of the "melodic, take
 *    inspiration from the classics" charter: you cannot have a memorable melody
 *    if it is one of nine equals.
 *
 * 2. TWO COMPANIONS, NOT SIX. A tune wants a bass under it, a harmony behind
 *    it, and at most one countersubject beside it. Beyond that the ear stops
 *    hearing lines and starts hearing texture.
 *
 * 3. YIELD, DO NOT CUT. A lane that loses its slot is multiplied down, not
 *    zeroed, and the director's level damping smooths the move over ~0.4s. A
 *    hard mute would be a new source of exactly the choppiness this project has
 *    spent its life removing.
 */

import { duetParents } from '../core/duet';
import type { StemId } from './layers';
import type { SectionName } from '../core/events';

/**
 * What a stem is FOR, musically, as opposed to what it sounds like.
 *
 * The roles are the parts of a score, and they are what the budget is
 * denominated in. Two stems sharing a role are alternatives to each other.
 */
export type Role = 'floor' | 'pulse' | 'harmony' | 'melody' | 'counter' | 'colour';

export const STEM_ROLE: Record<StemId, Role> = {
  // The floor and the kit are not part of the tonal budget: a sub sine below
  // 80Hz and a drum kit occupy bands nothing else is using, and taking them
  // away to make room for a melody would be solving the wrong problem.
  sub: 'floor',
  bass: 'floor',
  kick: 'pulse',
  clap: 'pulse',
  hats: 'pulse',
  chords: 'harmony',
  lead: 'melody',
  // Both of these are countersubjects: independent pitched lines that sit
  // beside the tune rather than under it. They are alternatives to one another
  // and this is the single most important pairing in the file — `arp` and
  // `motifs` running together is the texture the user is hearing as clutter.
  arp: 'counter',
  motifs: 'counter',
  power: 'colour',
  fx: 'colour',
};

/**
 * The lanes that compete. Drums and the sub floor are exempt (see `STEM_ROLE`),
 * so this is every stem that puts *pitched material a listener could follow*
 * into the foreground.
 */
export const TONAL_LANES: readonly StemId[] = ['chords', 'lead', 'arp', 'motifs', 'power'];

/**
 * How many tonal lanes each section will admit.
 *
 * A drop is allowed to be dense — that is what a drop is for, and it is only
 * eight bars. Everything else is written for three or fewer, which is the
 * texture of nearly every 16-bit score worth remembering: melody, harmony,
 * bass, and the bass is not even counted here.
 *
 * `intro` and `breakdown` get two, because both exist to expose the tune.
 */
const SECTION_BUDGET: Record<SectionName, number> = {
  intro: 2,
  build: 3,
  drop: 4,
  sustain: 3,
  breakdown: 2,
  fill: 3,
  // On death everything is being taken away anyway; the budget just stops
  // fighting the collapse.
  collapse: 2,
};

/**
 * Yield is graded, not binary.
 *
 * The lane immediately outside the budget drops to accompaniment — present,
 * supporting, not something you would follow. Everything below that is
 * effectively tacet. That is what an arranger does with a part they have run
 * out of room for: the next-best voice gets to double or pad, and the rest rest.
 *
 * Neither figure is zero, and that is deliberate. A lane at exactly zero fades
 * out, trips the `active` latch, and gets replaced with `silence` at the next
 * rebuild — so when the arrangement wants it back it is not merely quiet, it is
 * *gone*, and it cannot return until the next bar or phrase boundary triggers a
 * rebuild. The orchestration can change faster than that. Holding the deep
 * losers just above the silence threshold keeps every pattern built and
 * instantly recallable, at a cost of -24dB worth of nothing.
 *
 * (Whether the always-running patterns are also a CPU problem — every stem
 * allocates its full node graph per note event regardless of gain — is an
 * open question and a plausible contributor to the choppiness reports. It is an
 * emergent property, so it needs measuring rather than reasoning about, and the
 * machine is too loaded to measure honestly right now.)
 */
const YIELD_NEAR = 0.18;
const YIELD_FAR = 0.06;

/**
 * How much of a head start a lane gets for already holding its slot.
 *
 * Without this the ranking flips whenever two lanes' wants cross, and a lane
 * that oscillates in and out every second is worse than either having it or not
 * having it. The bonus is large enough that displacing an incumbent takes a
 * real change in the game, not a rounding error.
 */
const INCUMBENCY = 0.22;

export interface ScoreContext {
  section: SectionName;
  boss: boolean;
  /** True on a HUSHED wave, where the arrangement is defined by absence. */
  hushed: boolean;
  /** True on a SOLOIST wave: one enemy, so one voice. */
  soloist: boolean;
  /**
   * How many musicians the player has recruited — the size of THE BAND.
   *
   * Caps how many tonal lanes may sound together, so a run is audibly an
   * ensemble assembling. Optional on purpose: `undefined` means "no opinion"
   * and leaves the section budget in sole charge, which keeps every existing
   * caller and every tool that builds a context by hand working unchanged
   * rather than silently getting a one-voice mix.
   */
  ensemble?: number;
}

/**
 * Rank the tonal lanes for the current moment. Earlier is more important.
 *
 * The ordering is a musical opinion and it is meant to be read as one:
 *
 *   - The TUNE first, always. Rule 1.
 *   - Then HARMONY, because a melody with no chord under it has no context and
 *     the pad is also the cheapest way to make a texture sound intentional.
 *   - Then whichever countersubject the moment is actually about. On a normal
 *     stage that is the enemies (`motifs`) — the premise of this game is that
 *     the stage and the score are the same thing, so what is on screen outranks
 *     the machine's own filigree. On a HUSHED wave there are no enemies worth
 *     voicing and the arp gets the slot instead.
 *   - `power` last, because it is a colour rather than a line: it says
 *     something true about the player's state but nobody follows it.
 *
 * A boss inverts the middle: during a fight, the boss's own voice (which rides
 * the motif lane, see the `conductor` motif's tritone pedal) is the second most
 * important thing in the room after the tune. That is the whole idea of a boss
 * theme.
 */
export function rankTonal(ctx: ScoreContext): StemId[] {
  if (ctx.boss) return ['lead', 'motifs', 'chords', 'arp', 'power'];
  if (ctx.hushed) return ['lead', 'chords', 'arp', 'power', 'motifs'];
  // A soloist wave is one enemy carrying the section: its voice is the point.
  if (ctx.soloist) return ['lead', 'motifs', 'chords', 'power', 'arp'];
  return ['lead', 'chords', 'motifs', 'arp', 'power'];
}

/**
 * Apply the budget.
 *
 * Takes the levels the curves and the section overrides asked for, and returns
 * a multiplier per lane. A lane already near silence is not counted against the
 * budget — spending a slot on something inaudible would let genuinely present
 * lanes get cut for no gain, which is how a budget ends up making a mix thinner
 * rather than clearer.
 *
 * `held` is the set of lanes that won last time; it is mutated in place so the
 * incumbency bonus works across frames.
 */
export function allocate(
  want: Readonly<Record<StemId, number>>,
  ctx: ScoreContext,
  held: Set<StemId>,
): Record<StemId, number> {
  /*
   * The band decides how many parts can sound at once.
   *
   * `SECTION_BUDGET` says how many tonal lanes the ARRANGEMENT wants; the
   * ensemble says how many the player has actually recruited. Take the lower.
   * A soloist plays a solo — and then a run is the sound of an ensemble
   * assembling, which is the whole shape of the game expressed in the one
   * medium it claims is primary.
   *
   * `1 + count` rather than `count`: the melody is always somebody's, so one
   * musician still gets a tune plus one accompanying line rather than a bare
   * monophonic part. And the floor lanes — bass, kick, motor — are exempt from
   * this budget entirely (see `Role`), so a thin band is sparse in its
   * *counterpoint* and never hollow underneath. That distinction is what stops
   * this reintroducing the "percussion with decoration" failure: the opening of
   * a run has fewer voices, not less music.
   */
  /*
   * Floored at two, because one is a degenerate mix rather than a sparse one.
   *
   * `session` caught this the moment it was written: with an empty band the
   * budget came out at 1, every tonal lane but the melody fell to `YIELD_FAR`,
   * and `power` sat pinned at 0.03 for a whole run — a dead lane, which is the
   * exact defect `session`'s "alive" check exists to find. The real game always
   * starts the player with one instrument so it would not have happened in
   * play, but a rule that only holds because of a fact somewhere else is a rule
   * waiting to break.
   *
   * Two is also the honest musical minimum. A melody with nothing beside it is
   * not an arrangement, and every other budget in this file bottoms out at two
   * for the same reason.
   */
  /*
   * A RETRACTED FINDING, kept because the mistake is more useful than the note
   * it replaces.
   *
   * An earlier version of this comment claimed the opening of a run is
   * spectrally bass-heavy because the small-band budget starves the
   * counter-lines — 45.2% of energy below 250Hz at 30s against 21.7% four
   * minutes in. **That was wrong**, and every number in it was confounded.
   *
   * Held properly constant — same section, key, wave and danger, varying ONLY
   * `abilities` — a solo band renders 20.6% below 250Hz and a full band 20.9%.
   * Ensemble size does not move the spectral balance at all. What moved it was
   * the section: the early render happened to land in a `drop` and the late
   * one in a `build`, and a drop is legitimately bass-heavier. Worse, the
   * original "late" render was mostly SILENCE — `render.mjs`'s live mode drove
   * a parked ship, which the camping mechanic now kills around wave 9, so two
   * thirds of it measured -40dB of `collapse`.
   *
   * Three hypotheses were tested and all three failed: raising this floor
   * (45.2% -> 44.1%), scaling the kit with the band (44.4% -> 42.6%), and the
   * note register, which was identical throughout (mean pitch 65.9 vs 65.7
   * MIDI). The lesson is the one this codebase keeps relearning: an A/B across
   * two uncontrolled runs is not a measurement. Control the section before
   * comparing anything spectral.
   *
   * The budget floor of 2 stands, on its original design argument rather than
   * on any spectral evidence.
   */
  const ensembleBudget = ctx.ensemble === undefined ? Infinity : Math.max(2, 1 + ctx.ensemble);
  const budget = Math.min(SECTION_BUDGET[ctx.section], ensembleBudget);
  const rank = rankTonal(ctx);

  // Score every lane: its position in the ranking, plus a bonus for holding.
  // Position dominates, so incumbency only ever breaks a near-tie.
  const scored = TONAL_LANES.filter((id) => want[id] > 0.02)
    .map((id) => ({
      id,
      score: (rank.length - rank.indexOf(id)) + (held.has(id) ? INCUMBENCY : 0),
    }))
    .sort((a, b) => b.score - a.score);

  held.clear();
  for (const s of scored.slice(0, budget)) held.add(s.id);

  // Rank position decides the depth of the yield: in the budget plays, the
  // next one out accompanies, everything after that rests.
  const place = new Map(scored.map((s, i) => [s.id, i]));
  const mult = {} as Record<StemId, number>;
  for (const id of TONAL_LANES) {
    const i = place.get(id);
    // A lane with nothing to say was never in the running; leave it alone
    // rather than attenuating a level that is already ~0.
    if (i === undefined) mult[id] = 1;
    else if (i < budget) mult[id] = 1;
    else if (i === budget) mult[id] = YIELD_NEAR;
    else mult[id] = YIELD_FAR;
  }
  return mult;
}

/**
 * Register separation for the two lanes most likely to collide.
 *
 * Winning a slot is not the same as being heard. `arp` and `lead` both live
 * around the octave above the tonic, and when both survive the budget the arp
 * is directly on top of the tune — the classic mistake of doubling your melody
 * with your accompaniment and wondering why neither reads.
 *
 * The oldest fix in orchestration is to move one of them, so when both sound
 * the arp yields the octave and plays under the tune instead of through it.
 * Returned as a semitone offset the arp builder applies, rather than as a gain
 * cut, because the arp is supposed to be *there* — it just is not supposed to
 * be there.
 */
export function arpDisplacement(leadLevel: number, arpLevel: number): number {
  return leadLevel > 0.18 && arpLevel > 0.18 ? -12 : 0;
}

/* -------------------------------------------------------------------------
 * THE BAND — what the player has recruited, and what it does to the score.
 * ---------------------------------------------------------------------- */

/**
 * Which lane each instrument reinforces.
 *
 * WHY THIS EXISTS. The whole premise of the game is that an ability IS a
 * musician: you level up, someone joins the band, and the band is the
 * soundtrack. Every instrument is named for one — PIZZICATO, SNARE ROLL, ROSIN
 * BOW, CHIME, HARP GLISS, TIMPANI — the HUD calls the panel THE BAND, and the
 * offer screen says JOINS THE BAND.
 *
 * And until now not one of them touched the music. `layers.ts` read nine *rig*
 * ids and no instrument id at all, so recruiting a cellist changed the bullets
 * on screen and left the score bit-identical. That is the single largest gap
 * between what this game says it is and what it does.
 *
 * The mapping is by what the instrument IS, not by what it damages. A sweep is
 * a snare, a held beam is a sustained chord, a struck bell rings out over the
 * top, a well is a subsonic weight. Somebody who knows the weapon should be
 * able to predict the lane without being told.
 *
 * Unmapped ids are deliberate: several fusions are dramatic on screen without
 * implying a new voice, and inventing an affinity for them would make the
 * system arbitrary rather than legible.
 */
export const ENSEMBLE_MIX: Partial<Record<string, StemId>> = {
  // The starting six, and the lanes they are named after.
  pizzicato: 'arp', //  dry plucked bolts — plucked figuration
  snare: 'clap', //     a sweep through an arc — the snare lane, literally
  bow: 'chords', //     one held beam that does not stop — sustained harmony
  chime: 'lead', //     struck from above, unaimed — a bell over the top
  harp: 'arp', //       a fan of bolts — a gliss is an arpeggio
  drones: 'sub', //     pods that circle and hold — a drone is a pedal tone

  // The rig abilities that are also plainly instruments.
  nova: 'kick', //      a ring ON THE BEAT — it is the downbeat
  blackhole: 'sub', //  a well that drags everything down
  timpani: 'kick', //   the fx build is already a timpani roll; see `buildFx`
  feedback: 'fx', //    a hum around the hull
  echoes: 'fx', //      bolts returning off the walls — the SPC700 echo unit
  tremolo: 'motifs', // pools that keep working after you leave

  // Evolutions inherit their parent's voice and push it harder.
  spiccato: 'arp',
  blastbeat: 'clap',
  harmonics: 'chords',
  carillon: 'lead',
  crossstrung: 'arp',
  chorale: 'chords',
  cathedral: 'kick',
  downbeat: 'kick',
  wallofsound: 'fx',
  canon: 'fx',
  tutti: 'sub',
  vibrato: 'motifs',
  requiem: 'chords',
  stringsection: 'chords',
};

/**
 * How much a lane is lifted by the musicians playing it.
 *
 * Deliberately small and saturating. This is a *colour* on the arrangement, not
 * a second volume system — the tension curves stay in charge of dynamics, and
 * a player with a full band should hear a richer version of the same piece
 * rather than a louder one. `sqrt` so the first musician on a lane is the one
 * you notice and the fourth is a nuance, which is also how an ensemble works.
 *
 * MEASURED, AND IT SATURATES EARLY — checked, and left alone deliberately.
 *
 * Once real run lengths were established (wave 34-41 over twenty minutes, not
 * the wave 8 the codebase assumed), the obvious question was whether this still
 * does anything late. It does not move much:
 *
 *     wave  6, four pieces      lifts 0.106 - 0.168
 *     wave 20, six plus rig     lifts 0.130 - 0.180
 *     wave 40, everything at 8  lifts 0.168 - 0.180   (cap is 0.180)
 *
 * The cap binds at about level 6 of a single instrument, so the `sqrt` shaping
 * only breathes over the first half of one instrument's ladder and `ensembleSize`
 * stops at 6 because that is how many mapped instruments a player can hold.
 *
 * That reads like the saturated-input defect this codebase is full of, and it
 * is not one. The musical statement here is **that a musician is present**, not
 * how powerful they have become — recruiting is the event, levelling is a power
 * curve and belongs to the game. A band that kept getting louder as its players
 * levelled would be the second volume system this comment already refuses to
 * be, and it would eat the headroom `ensembleTrim` exists to protect.
 *
 * Recorded so the next person does not "fix" it. If it ever should respond to
 * levels late, the lever is `SECTION_BUDGET` and the voice count — more parts —
 * not a bigger number here.
 */
/**
 * The lanes an ability plays — resolving the ids that are made at runtime.
 *
 * `ENSEMBLE_MIX` can only ever list ids that exist in source, and a DUET or a
 * generic UNION is synthesised while the run is going (`pizzicato+snare`). So
 * every fusion of that kind was unmapped, and unmapped means silent to the
 * ensemble: measured, `{pizzicato: 8, snare: 8}` is a band of two lifting the
 * arp and the clap, while the duet those two make is a band of ZERO lifting
 * nothing. Combining is the largest reward in the game and it was making the
 * score thinner — the player traded two musicians for none.
 *
 * A duet takes BOTH parents' lanes, which is not a compromise but the literal
 * reading of the thing: its own blurb calls it "two players on one stand".
 * Nothing in `ENSEMBLE_MIX` changes, and the authored entries still win for
 * every id that has one — this only answers for the ids the table cannot
 * contain.
 */
export function abilityStems(id: string): StemId[] {
  const own = ENSEMBLE_MIX[id];
  if (own) return [own];
  const parents = duetParents(id);
  if (!parents) return [];
  const out: StemId[] = [];
  for (const p of parents) {
    const st = ENSEMBLE_MIX[p];
    if (st && !out.includes(st)) out.push(st);
  }
  return out;
}

export function ensembleLift(abilities: Record<string, number> | undefined, stem: StemId): number {
  if (!abilities) return 0;
  let total = 0;
  for (const [id, level] of Object.entries(abilities)) {
    if (!(level > 0) || !abilityStems(id).includes(stem)) continue;
    total += level;
  }
  return total > 0 ? Math.min(0.18, 0.075 * Math.sqrt(total)) : 0;
}

/**
 * How many musicians are in the band.
 *
 * Counts distinct ids that have a lane in `ENSEMBLE_MIX`, not the total number
 * of abilities — a rig upgrade with no voice is not a musician, and levelling
 * one instrument to 8 is still one player. That is what makes this a headcount
 * of the ensemble rather than a proxy for progress, and it is why the budget it
 * feeds grows in the same steps a band does: one more person, one more part.
 */
export function ensembleSize(abilities: Record<string, number> | undefined): number {
  if (!abilities) return 0;
  let n = 0;
  for (const [id, level] of Object.entries(abilities)) {
    // A duet counts as the two players it is made of, so the headcount does
    // not drop on the frame a fusion lands. A band that shrinks when it
    // combines is the wrong feedback for the best decision in the run.
    if (level > 0) n += abilityStems(id).length;
  }
  return n;
}

/**
 * The trim that keeps a growing band from simply getting louder.
 *
 * `ensembleLift` adds level to every lane a musician staffs, and with a full
 * band that is six lanes lifted at once. Measured on the assembled master
 * pattern, worst-case simultaneous amplitude went from **1.07 solo to 1.77 with
 * a full band** — and after the 0.75 master trim that is 0.80 against 1.33.
 * Over unity, with **no limiter anywhere in the chain**: `engine.ts` says so
 * outright and leans on a polyphony cap instead. Clipping is not a subtle
 * degradation, it is the harshness this whole refactor is trying to remove.
 *
 * The answer is not to take the band away. It is what an engineer does at a
 * desk when parts arrive: pull everything down a little so the section fits.
 * A six-piece is not six times a soloist — it is the same loudness, better
 * furnished. The musical statement the band makes is which lanes are lifted
 * relative to each other, and how many voices may sound at once; loudness was
 * never the point and is the one part of it that will not fit.
 *
 * Deliberately gentle, and not a full normalisation: a full band still ends up
 * louder than a soloist, because some sense of gathering force is correct. It
 * just stops short of the ceiling instead of sailing past it.
 *
 * Measured output after the 0.75 master trim, worst-case simultaneous
 * amplitude:
 *
 *     solo        0.744        (1.33 before this existed, i.e. clipping)
 *     3-piece     0.716
 *     4-piece     0.729
 *     full band   0.864
 *
 * The coefficient is 0.04 rather than 0.06 because 0.06 overshot: it made a
 * three-piece measurably QUIETER than a soloist, which is the wrong shape — a
 * band that grows should never sound like it is shrinking. 0.04 leaves a 4%
 * dip in the middle, small enough to be inaudible, and keeps ~14% headroom at
 * the top.
 */
export function ensembleTrim(count: number): number {
  return 1 / (1 + 0.04 * Math.max(0, count));
}
