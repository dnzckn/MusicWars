/**
 * The section state machine — horizontal re-sequencing.
 *
 * Vertical layering (in `layers.ts`) handles "how intense is it right now".
 * This handles "what part of the song are we in", which is a different question
 * and the one that makes the track feel authored rather than generated.
 *
 * Sections only ever change on a bar line, and the big ones only on a phrase
 * line. The one thing worth being fussy about is the riser: when a boss is
 * telegraphed we schedule the build so that the drop lands on the exact bar the
 * boss starts firing. That coincidence is the whole reason to do this at all.
 */

import { clamp } from '../core/math';
import type { SectionName } from '../core/events';
import { BARS_PER_PHRASE, type Transport } from '../core/transport';
import type { ProgressionShape } from './theory';

/* ==========================================================================
 * THE FORM — the layer above the section machine.
 * ==========================================================================
 *
 * WHY THIS EXISTS, measured before it was written.
 *
 * Every timescale in this score was a CYCLE, and none of them was longer than
 * ninety seconds. Driven over four twenty-minute runs (2560 bars, mean bar
 * 1.87s), the median hold of each unit came out:
 *
 *     key (tonic)   48 bars   90.0s      n=46
 *     theme         32 bars   60.0s      n=86
 *     mode          16 bars   30.0s      n=99
 *     groove        19 bars   35.6s      n=143
 *     section        4 bars    7.5s      n=643
 *
 * Nothing in that table accumulates. The key walks the circle of fourths and
 * returns; the theme rotates a rondo; the groove rotates an eight-slot rota;
 * this file's own state machine is a servo on a scalar with NO MEMORY OF THE
 * RUN AT ALL. So wave 30 was structurally identical to wave 4 — a different
 * key, a different tune, the same shape at every level — and a twenty-minute
 * run was fifteen repetitions of an eighty-second loop with layers switching on
 * and off. A generative score that never modulates toward anything, never
 * resolves and never remembers what it already played is wallpaper.
 *
 * The one thing in the whole director that read elapsed run time was
 * OVERDRIVE's forty-five-second drop cooldown. That is the fault, and it is a
 * fault of ARCHITECTURE rather than of any note: there was no term to hang an
 * arc on, so there was no arc.
 *
 * THE FORM IS A CLOCK, NOT A DIFFICULTY CURVE. `runProgress`-style ramps were
 * considered and are not what this is. An act does not make the music louder
 * (`ensembleTrim` deliberately refuses that) and it does not make it faster on
 * its own. It moves the CEILINGS and it changes the MATERIAL: how many parts
 * the budget will admit, which harmonic sentence the phrases are built from,
 * whether the sub accent and the chordal ninth exist yet, how long the
 * arrangement may work before the form insists on a rest. The same music, with
 * more of its range unlocked as the run goes on — so minute twelve sounds like
 * a later part of the same piece rather than another instance of it.
 *
 * MEASURED IN PHRASES, NOT SECONDS, and relative to the RUN rather than to the
 * page. A phrase is eight bars, about fifteen seconds at the tempi this game
 * actually plays, so the boundaries below fall at roughly 3, 9 and 16 minutes
 * of a twenty-minute run. The transport free-runs from page load and is never
 * reset on retry (`main.ts` calls `director.reset` and `world.start` and
 * nothing else), so the director stamps the bar the run began at and counts
 * from there. Using wall-clock seconds instead would have been the easier
 * option and the wrong one: everything else in this file quantises to bars, and
 * an act boundary that lands mid-phrase is the same defect as a groove that
 * changes mid-phrase.
 */

/** Which part of the run's arc a phrase belongs to. */
export type Act = 'exposition' | 'development' | 'intensification' | 'recapitulation';

export interface ActShape {
  /**
   * Added to the section's tonal-lane budget. Negative RESERVES parts.
   *
   * This is the ceiling ramp and it is the cheapest half of the arc: the same
   * eleven lanes, the same curves, the same rules — the opening simply may not
   * spend as many of them at once. See `orchestration.allocate`.
   */
  budget: number;
  /**
   * The top of the tempo range this act will ask for.
   *
   * `updateTempo` already computes a target from wave, feel, section and
   * tension; this clamps it. Measured at HEAD, peak BPM per two-minute window
   * ran 134-150 from the first window onward, so the tempo's top was available
   * in minute one and there was nowhere left for a late run to go.
   *
   * RE-CENTRED ON THE GENRE, AND IT IS NEARLY A FLAT COLUMN NOW. See
   * `director.DUBSTEP_BPM`: the whole tempo range is 136-146 rather than
   * 122-150, so a ceiling of 132 in the exposition — which was one of the four
   * dials the arc was built out of — would have clamped the FIRST THREE
   * MINUTES OF EVERY RUN eight BPM under the tempo the genre is defined at.
   * That is not reserving the top of the range, it is playing the wrong music
   * until minute three.
   *
   * So tempo stops being much of an arc dial. It still moves 140 -> 146, which
   * is real but small; the arc's weight now sits entirely on `budget`, `sub`,
   * `ninth`, `shape` and `restAfter`, which are all changes of MATERIAL and are
   * the half of the form this file's own header calls the point.
   */
  tempo: number;
  /** Is the sub accent unlocked yet? See `STEM_CURVES.sub` for what it is. */
  sub: boolean;
  /** Is the chordal ninth unlocked yet? See `Signals.colour9`. */
  ninth: boolean;
  /** Which harmonic sentence the phrases are built from. See `theory.ts`. */
  shape: ProgressionShape;
  /**
   * Bars of continuous work before the form INSISTS on a rest.
   *
   * The old arrangement had exactly one route to quiet: tension falling below
   * a threshold. Measured over four twenty-minute runs, that left whole
   * two-minute windows with ZERO quiet bars out of sixty-four — five such
   * windows in one seed. "Quiet is what happens when the game is calm" is not
   * dynamics; it is the absence of a decision. This makes rest part of the
   * form, which is the whole difference.
   */
  restAfter: number;
}

/**
 * What each act is allowed to be.
 *
 * Read down a column and you get the arc. Budget -1, -1, 0, 0: the opening is
 * genuinely a smaller band and the second half is genuinely the full one.
 * Tempo 140, 142, 146, 146: there is still somewhere for a late run to go, but
 * it is eight BPM rather than eighteen — see `ActShape.tempo`. The sub
 * and the ninth are RESERVED — a form is largely a schedule of things you have
 * not used yet, and before this the only reserved material in the whole system
 * was the boss leitmotif.
 *
 * The recapitulation deliberately does NOT go further than the intensification
 * on any dial. It is the same forces, spent on the opening material in the
 * opening key: an arrival, not an escalation. A recap that was simply the
 * biggest thing yet would be a fourth act of intensification wearing a
 * classical name.
 */
export const ACT_SHAPE: Record<Act, ActShape> = {
  exposition: { budget: -1, tempo: 140, sub: false, ninth: false, shape: 'period', restAfter: 24 },
  development: { budget: -1, tempo: 142, sub: true, ninth: false, shape: 'turn', restAfter: 24 },
  intensification: { budget: 0, tempo: 146, sub: true, ninth: true, shape: 'climb', restAfter: 32 },
  // Home: the opening sentence, the opening key, the opening groove, at the
  // forces the run has earned. See `MusicDirector.onWaveStart`.
  recapitulation: { budget: 0, tempo: 146, sub: true, ninth: true, shape: 'period', restAfter: 28 },
};

/**
 * Where each act begins, in phrases since the run started.
 *
 * 12 / 36 / 64 phrases is about 3 / 9 / 16 minutes at the tempi measured in
 * play. A run that ends before a boundary simply never reaches that act, which
 * is correct: the arc is a property of a long run and a short one is an
 * exposition that stopped.
 */
export const ACT_AT_PHRASE: readonly (readonly [Act, number])[] = [
  ['recapitulation', 64],
  ['intensification', 36],
  ['development', 12],
  ['exposition', 0],
];

export function actForPhrase(phrase: number): Act {
  for (const [act, from] of ACT_AT_PHRASE) if (phrase >= from) return act;
  return 'exposition';
}

export interface ArrangementState {
  section: SectionName;
  /** Bars elapsed inside the current section. */
  barsIn: number;
  /** For `build`: 0..1 progress toward the drop. 0 elsewhere. */
  buildProgress: number;
  /** For `intro`: 0..1 through the opening phrase. 1 everywhere else. */
  introProgress: number;
  /** Bars remaining in a scheduled build; -1 when not building to a deadline. */
  barsToDrop: number;
  /** True on the final bar of a phrase, where fills belong. */
  fillBar: boolean;
  /** Which part of the run's arc this bar belongs to. */
  act: Act;
  /** Bars since the arrangement last rested. See `ActShape.restAfter`. */
  barsSinceQuiet: number;
  /** How many drops this run has reached. The arranger's run memory. */
  dropsThisRun: number;
  /** How many rests the FORM has insisted on, as opposed to tension allowing. */
  forcedRests: number;
}

interface Pending {
  section: SectionName;
  /** Absolute bar index at which to switch. */
  atBar: number;
}

/** Minimum bars a section must hold before it may be replaced automatically. */
const MIN_BARS: Record<SectionName, number> = {
  // A full phrase. Two bars is not an intro, it is a hiccup — and the opening
  // is the one moment the arrangement can start from actual silence, which is
  // the largest dynamic range the track will ever have.
  intro: 8,
  /*
   * Longer minimums, because the arrangement was changing section every seven
   * seconds — 33 changes in four minutes, measured. A section that lasts two
   * bars is not a section, it is a gesture, and a track that keeps announcing a
   * new one never lets the listener settle into any of them. Four bars is the
   * shortest unit that reads as a passage rather than as a transition.
   */
  /*
   * A build is the one section that SHOULD be short — it is a transition, and
   * a riser you have time to get bored of has already failed. Four bars.
   */
  /*
   * 2, not 4. This is a MINIMUM, and it was equal to the build's timeout — so
   * the guard held the section until bar 4 and the timeout then released it at
   * bar 4, making the tension exit dead code for any threshold. See the note in
   * `maybeAdvance`. Two bars is still long enough that a build cannot flicker.
   */
  build: 2,
  /*
   * 4, not 8 — a MINIMUM equal to a section's TIMEOUT makes that section's
   * tension exit dead code. The guard at the top of `maybeAdvance` returns
   * until the bar count is reached, and then the timeout fires regardless of
   * tension. This was 8 against a timeout of `BARS_PER_PHRASE` (8), so
   * `tension < 0.35` — "leave the drop when the fight eases" — had never once
   * been evaluated, and `session` measured every drop at exactly 8 bars.
   *
   * Be clear about the result: making it reachable changed NOTHING measurable.
   * Drops are still 8 bars, all 18 of them. That is not a failed fix so much as
   * a fact about the condition — tension is high during a drop by construction,
   * because high tension is what put us here, and it only falls below 0.35 in
   * the lull between waves, by which time the timeout has already fired. The
   * branch is now evaluable rather than dead code, which is worth having, but
   * nobody should expect it to shorten a drop in ordinary play.
   */
  drop: 4,
  /*
   * Eight bars, not four, for both of the resting sections.
   *
   * With `build: 4` and these two at 4, the shortest possible cycle was
   * build - drop - sustain - build, which at 130bpm is about seven seconds,
   * fifteen, seven. Every one of those boundaries rebuilds every pattern and
   * re-runs the voice budget, so the arrangement was re-orchestrating itself
   * roughly every ten seconds for an entire run. That is the "jarring music
   * sessions" in the user's note, and it is a different complaint from the
   * choppiness — nothing here stutters, it just never stops changing its mind.
   *
   * The scores this game is aiming at hold a section for thirty seconds or
   * more. Eight bars is fifteen, which is the least that reads as a passage
   * you are inside rather than one you are passing through. It is also now
   * affordable in a way it was not before: the voice budget in
   * `orchestration.ts` supplies dynamics WITHIN a section by moving which
   * lanes hold the foreground, so a section no longer has to end in order for
   * anything to change. That is what the old four-bar floors were compensating
   * for.
   */
  /*
   * 4, not 8 — and this one is a bug I introduced.
   *
   * Same defect as `drop`: the guard equalled the timeout, so `tension > 0.52`
   * (lift out of sustain when it heats up) was unreachable. But sustain proves
   * it outright — its body tests `barsIn >= 4`, a condition that cannot be true
   * while the guard holds until 8. That branch was written when this value WAS
   * 4. I raised it to 8 to stop sections flickering and killed the branch
   * without noticing; the flicker partly went away because the arrangement had
   * stopped responding to anything.
   *
   * Four keeps a real anti-flicker floor — half a phrase — while letting the
   * game influence structure again. `intro` deliberately stays at 8: the
   * opening is the one place a fixed length is right, and combat should not be
   * able to cut it short.
   */
  sustain: 4,
  /*
   * 2, not 8 — the last instance of the guard-equals-timeout defect.
   *
   * `maybeAdvance`'s breakdown case is `tension > 0.44 || barsIn >= 8`, and the
   * guard was also 8, so the tension arm could never be evaluated. In practice
   * breakdowns already ran 2-3 bars because an explicit request from the next
   * `onWaveStart` cut them short — the section was being ended by an event
   * while its own "combat resumed, get back to work" condition sat unreachable.
   *
   * Two lets that condition do its job, and cannot shorten anything below what
   * the requests were already producing.
   */
  breakdown: 2,
  fill: 1,
  collapse: 2,
};

/**
 * How long a rest the FORM asked for holds, in bars.
 *
 * Four, not two, and not eight. Two is `MIN_BARS.breakdown` and is the length a
 * tension-driven breakdown already gets; a form whose rest was the same length
 * as an accident would be indistinguishable from one. Eight is a whole phrase
 * with the kick, the clap and the bass gone, which at 130bpm is fifteen
 * seconds — long enough that combat would visibly be waiting for the music.
 *
 * Four bars is about seven and a half seconds. `breakdown`'s own eight-bar
 * timeout is untouched above it, so this can only ever shorten the range a
 * breakdown occupies, never extend it past what the section already allowed.
 */
const FORCED_REST_BARS = 4;

export class Arranger {
  section: SectionName = 'intro';
  private sectionStartBar = 0;
  private pending: Pending | null = null;
  /** Bar index the current build is aiming at, or -1. */
  private dropAtBar = -1;
  private buildStartBar = 0;
  /** Set while the player is dead/dying so nothing overrides the collapse. */
  private locked = false;
  /** Where a one-bar fill returns to. */
  private afterFill: SectionName = 'drop';

  /* ---------------------------------------------------------------------
   * THE RUN MEMORY.
   *
   * "A form is a sequence of decisions that reference each other; a thermostat
   * is not a form however well its thresholds are tuned." Everything above
   * this line is the thermostat. These six fields are the only state in the
   * arrangement that outlives a section, and they are what lets a decision
   * made at minute twelve know what happened at minute two.
   * ------------------------------------------------------------------ */

  /** Which part of the arc we are in. Written by the director each bar. */
  private act: Act = 'exposition';
  /** Bars since the arrangement last held a resting section. */
  private barsSinceQuiet = 0;
  /** How many drops this run has reached. */
  private dropsThisRun = 0;
  /** How many rests the FORM insisted on, rather than tension allowing. */
  private forcedRests = 0;
  /**
   * Bar index a forced rest holds until, so the form's rest is not ejected on
   * the bar it starts.
   *
   * The breakdown's own exit is `tension > 0.55 || barsIn >= 8`, and the
   * measured median energy is 0.622 — so a breakdown entered while the game is
   * doing anything at all leaves on its two-bar minimum. That is the right
   * behaviour for a breakdown the TENSION asked for and the wrong one for a
   * rest the FORM asked for: the whole point is that it happens whether or not
   * the game is calm. Four bars is about seven and a half seconds with the
   * kick, the clap and the bass gone, which is long enough to be a passage
   * rather than a stumble, and short enough that combat never waits on it.
   */
  private restHold = -1;
  /** A rest the form has asked for and has not been able to place yet. */
  private restDue = false;

  /** Which of the resting sections count as the arrangement having stopped. */
  private static readonly RESTING = new Set<SectionName>(['breakdown', 'intro', 'collapse']);

  /**
   * Drop a one-bar fill in immediately and come back to whatever we were doing.
   *
   * Used by the bomb: detonating clears the screen and *earns* a drum fill, so
   * the panic button is also the most musical thing the player can press.
   */
  fill(t: Transport): void {
    if (this.locked || this.section === 'fill') return;
    this.afterFill = this.section === 'collapse' ? 'collapse' : this.section;
    /*
     * Enter directly rather than queueing.
     *
     * Going through `request()` put the fill in `pending`, where it lost to
     * both a scheduled drop (checked first in `onBar`) and to any later request
     * — so pressing bomb during a build produced no fill at all. A fill is a
     * one-bar ornament responding to something the player just did; it should
     * outrank whatever was queued, and it should be audible immediately rather
     * than at the next bar line.
     */
    this.pending = null;
    /*
     * Starting immediately is right; ending at the next bar line is not.
     *
     * `enter` stamps `sectionStartBar`, and `maybeAdvance` leaves once
     * `bar - sectionStartBar >= MIN_BARS.fill`, which is 1. Stamping the
     * CURRENT bar therefore gave the fill only whatever was left of it — a
     * bomb pressed three quarters of the way through a bar bought a quarter
     * bar of fill. Measured in a real run, fills came out at 0.6, 1.2, 1.4,
     * 1.6 and 1.8 seconds against a bar of about 1.76s at 136bpm. The short
     * ones are not a fill, they are a stutter, and this is the arrangement's
     * direct answer to a button the player just pressed.
     *
     * Stamping the NEXT bar when we are past the first fraction of this one
     * keeps the fill audible on the instant — the comment above is right that
     * it must be — while making it long enough to read as a fill. Length falls
     * between about 0.85 and 1.85 bars depending on where in the bar the bomb
     * landed.
     *
     * NOT a guarantee of a full bar, and an earlier version of this note
     * claimed one two sentences after stating the 0.85 floor that contradicts
     * it. A bomb pressed just under `barPhase` 0.15 still buys 0.85 of a bar.
     * Making it a real guarantee means stamping `bar + 1` unconditionally,
     * which costs up to a full bar of onset delay on the input the player most
     * expects to be instant — deliberately not taken.
     */
    const bar = this.currentBar(t);
    this.enter('fill', t.barPhase > 0.15 ? bar + 1 : bar);
  }

  reset(): void {
    this.dropped = false;
    this.section = 'intro';
    this.sectionStartBar = 0;
    this.pending = null;
    this.dropAtBar = -1;
    this.locked = false;
    this.act = 'exposition';
    this.barsSinceQuiet = 0;
    this.dropsThisRun = 0;
    this.forcedRests = 0;
    this.restHold = -1;
    this.restDue = false;
  }

  /** Bar index the transport is currently in. */
  private currentBar(t: Transport): number {
    return Math.floor(t.bar);
  }

  /**
   * Ask for a section change. `quantize` picks how long we are willing to wait:
   * 'immediate' switches on the next bar, 'phrase' waits for the next multiple
   * of 8 bars, which is what keeps big moves feeling intentional.
   */
  request(t: Transport, section: SectionName, quantize: 'immediate' | 'bar' | 'phrase' = 'bar'): void {
    if (this.locked && section !== 'collapse') return;
    const bar = this.currentBar(t);
    let atBar: number;
    if (quantize === 'immediate') atBar = bar;
    else if (quantize === 'bar') atBar = bar + 1;
    else atBar = (Math.floor(bar / BARS_PER_PHRASE) + 1) * BARS_PER_PHRASE;
    this.pending = { section, atBar };
    if (section === 'drop') {
      this.dropAtBar = atBar;
      this.buildStartBar = bar;
    }
  }

  /**
   * Schedule a build that culminates in a drop `seconds` from now, snapped to
   * the nearest bar. Used when a boss is telegraphed: the riser and the boss
   * arrive together.
   */
  scheduleDrop(t: Transport, seconds: number): void {
    if (this.locked) return;
    /*
     * A BOSS OUTRANKS THE FORM'S REST, in both directions.
     *
     * The forced rest refuses to start while a drop is scheduled (see `onBar`),
     * and a rest already running is released here. Without the second half, a
     * telegraph that arrived during a four-bar rest would have its build held
     * until the rest was served, and the drop would land after the boss had
     * already opened fire — losing the one coincidence this file exists for.
     * The boss telegraph leads `bossActive` by exactly 4.0 bars (measured over
     * 19 fights across five seeds), and `FORCED_REST_BARS` is 4, so the overlap
     * is not hypothetical.
     */
    this.restHold = -1;
    this.restDue = false;
    const barsAway = Math.max(1, Math.round(seconds / (t.secondsPerBeat() * 4)));
    const bar = this.currentBar(t);
    this.buildStartBar = bar;
    this.dropAtBar = bar + barsAway;
    // Start building on the next bar, then hand over to the drop on schedule.
    this.pending = { section: 'build', atBar: bar + 1 };
  }

  /** The player died: collapse and hold until explicitly released. */
  collapse(t: Transport): void {
    this.locked = true;
    this.dropAtBar = -1;
    this.pending = { section: 'collapse', atBar: this.currentBar(t) };
  }

  release(): void {
    this.locked = false;
  }

  /**
   * Called once per bar crossing. `tension` is the sustained stress value.
   * `runPhrase` is how many eight-bar phrases into THIS RUN we are — the only
   * term in the whole arrangement that knows how long the run has been going.
   * Returns the new state.
   */
  onBar(t: Transport, tension: number, runPhrase = 0): void {
    const bar = this.currentBar(t);
    this.act = actForPhrase(runPhrase);

    /*
     * The rest counter, advanced before anything can change the section.
     *
     * Counted in bars of WORK, so a run that has been resting reads zero and
     * one that has been driving for forty seconds reads twenty-something. It
     * is deliberately not a timer: a breakdown that the game happened to allow
     * counts exactly as much as one the form insisted on, because the listener
     * cannot tell them apart and the point is how long it has been since they
     * last heard the band stop.
     */
    if (Arranger.RESTING.has(this.section)) this.barsSinceQuiet = 0;
    else this.barsSinceQuiet++;

    // A scheduled build that reached its deadline becomes the drop.
    if (this.section === 'build' && this.dropAtBar >= 0 && bar >= this.dropAtBar) {
      this.enter('drop', bar);
      this.dropAtBar = -1;
      return;
    }

    /*
     * A pending request now waits for the current section's MIN_BARS.
     *
     * It did not, and that made `MIN_BARS` not a minimum. The check below at
     * `barsIn < MIN_BARS[this.section]` only ever guarded this function's OWN
     * transitions; an explicit `request()` was applied here, above it,
     * unconditionally. Any handler could therefore cut a section off at one
     * bar.
     *
     * Measured, that is precisely what happened to every breakdown in the
     * game. `onWaveClear` requests one on a perfect clear, and `onWaveStart`
     * requests a build — and the real gap between those two events is about
     * two seconds. So the breakdown ran 1.9s against its own two-bar minimum,
     * once per seven minutes, for 0.4% of the run. The arrangement had no rest
     * in it at all, and raising the tension thresholds did nothing because
     * tension was never what ended it.
     *
     * The request is HELD rather than dropped, so nothing is lost: it lands as
     * soon as the minimum is served, one or two bars later than asked. Two
     * exceptions. `collapse` overrides everything, because the player is dead
     * and the score has to stop arguing. And a `fill` is entered through
     * `enter()` directly rather than through `request()`, so the bomb's
     * one-bar answer is unaffected by any of this.
     */
    /*
     * A FORCED REST OUTRANKS A PENDING REQUEST, and it has to.
     *
     * The comment below explains that a `request()` used to bypass `MIN_BARS`
     * entirely and that every breakdown in the game was consequently ended by
     * `onWaveStart`'s build about two seconds after it began. `MIN_BARS` fixed
     * that for the general case, but `MIN_BARS.breakdown` is 2 — so the form's
     * four-bar rest would still have been cut in half by the next wave, which
     * is the same bug with a smaller number. `collapse` still wins, because
     * the player is dead and the score has to stop arguing.
     */
    if (this.pending && bar >= this.pending.atBar && this.pending.section !== 'collapse' && bar < this.restHold) {
      // Held, not dropped: it lands the moment the rest is served.
    } else if (this.pending && bar >= this.pending.atBar) {
      const next = this.pending.section;
      if (next === 'collapse' || bar - this.sectionStartBar >= MIN_BARS[this.section]) {
        this.pending = null;
        this.enter(next, bar);
        return;
      }
    }

    if (this.locked) return;

    const barsIn = bar - this.sectionStartBar;

    /*
     * THE FORM INSISTS ON A REST, and this is the subtractive half of the arc.
     *
     * A drop only lands if something was taken away first, and until this
     * existed the only route to quiet was tension falling under 0.44. Measured
     * at HEAD over four twenty-minute runs, that produced two-minute windows
     * containing ZERO quiet bars out of sixty-four — five such windows in one
     * seed, three in another. An arrangement that only ever accumulates has no
     * dynamics at any timescale longer than a bar, whatever its peak level
     * says.
     *
     * Five guards, and each one is there because the alternative is worse:
     *
     *   - ARMED ONLY ON A PHRASE LINE. Every big move in this file waits for
     *     one; a rest that ARRIVED on bar 3 of a phrase would cut the tune off
     *     mid-sentence, which is the defect the `pendingWave`/`pendingTonic`
     *     machinery exists to prevent. See the latch note below for why arming
     *     and firing are separate.
     *   - NOT DURING `build`. A build is a promise, and breaking it to rest is
     *     the one thing a riser must never do. The latch keeps the debt, so the
     *     rest lands as soon as the drop it was promising is over.
     *   - NOT DURING `intro`, `fill` or `collapse`. The first two are already
     *     short fixed shapes and the third is the player being dead.
     *   - NOT WHILE A DROP IS STILL SCHEDULED AHEAD OF US. `scheduleDrop` sizes
     *     a build so the drop lands on the exact bar a boss starts firing, and
     *     this file's own header calls that coincidence "the whole reason to do
     *     this at all". A rest that delayed it by up to four bars would trade
     *     the score's best moment for the form's most routine one.
     *
     *     `dropAtBar >= bar`, NOT `dropAtBar >= 0`, and the difference is a bug
     *     I wrote and then measured. **`dropAtBar` IS NEVER CLEARED EXCEPT ON
     *     ONE PATH.** Only the branch at the top of this method that converts a
     *     timed build into its drop resets it; a drop entered any other way —
     *     a `pending` request landing, the automatic build exit, an OVERDRIVE
     *     force — leaves the field pointing at a bar in the past, for the rest
     *     of the run. Written as `>= 0` the guard therefore switched the forced
     *     rest OFF PERMANENTLY from the first boss telegraph onward: measured
     *     on seed 1, `restDue` latched true at bar 608 and was still true at
     *     bar 640, with `dropAtBar` stuck at 616 and 80 bars of unbroken work.
     *     Comparing against `bar` asks the question that was meant — "is a drop
     *     still coming" — and is immune to the stale value.
     *
     *     THE STALE FIELD IS A PRE-EXISTING DEFECT AND IS NOT FIXED HERE. Its
     *     other consumer is that same conversion branch, so a stale past value
     *     means the NEXT timed build is converted to a drop on its first bar,
     *     since `bar >= dropAtBar` is trivially true. Clearing it in `enter`
     *     would be a one-line fix and a real change to the section machine's
     *     timing, which wants its own baseline against `sections` and is a
     *     different piece of work from this one.
     *   - THE CURRENT SECTION'S `MIN_BARS` IS SERVED. Without this, the rest
     *     could cut a two-bar-old drop, and a drop that is interrupted is not a
     *     drop. It costs at most a phrase of delay.
     *
     * Entered directly rather than through `request()` because a `pending` can
     * be outranked by any later caller, and the whole value of this rule is
     * that it is not negotiable. That is the same reasoning `fill()` gives.
     */
    /*
     * LATCHED, because the first version could miss for a whole run.
     *
     * Written as a single condition — "at a phrase line, if it has been long
     * enough, rest" — it fired on the phrase line or not at all, and `build`
     * is excluded. Measured over four twenty-minute runs, one two-minute window
     * still contained zero resting bars out of sixty-four: whenever the
     * section machine happened to be in a build at every phrase line the debt
     * simply carried on growing. A rule that is only checked at eight-bar
     * intervals against a state machine with its own eight-bar cycle can
     * resonate with it, and this one did.
     *
     * So the phrase line ARMS it and the next legal bar fires it. The musical
     * intent is unchanged — the rest still wants to land on a phrase line and
     * usually does, since `build` is two to four bars — and it can no longer be
     * starved. The latch is cleared by the rest itself, so it cannot stack.
     */
    if (
      bar % BARS_PER_PHRASE === 0 &&
      !Arranger.RESTING.has(this.section) &&
      this.barsSinceQuiet >= ACT_SHAPE[this.act].restAfter
    ) {
      this.restDue = true;
    }
    if (
      this.restDue &&
      !Arranger.RESTING.has(this.section) &&
      this.section !== 'build' &&
      this.section !== 'fill' &&
      !(this.dropAtBar >= 0 && this.dropAtBar >= bar) &&
      barsIn >= MIN_BARS[this.section]
    ) {
      this.restDue = false;
      this.forcedRests++;
      this.restHold = bar + FORCED_REST_BARS;
      this.enter('breakdown', bar);
      return;
    }

    if (barsIn < MIN_BARS[this.section]) return;

    /*
     * Automatic progression when nothing has been requested. The thresholds
     * overlap deliberately so a track sitting near a boundary does not
     * oscillate between sections every phrase.
     *
     * These numbers were recalibrated when the tension model was fixed. Every
     * one of them was chosen against a signal that could not exceed 0.5 — so
     * "leave the drop when tension < 0.24" and "break down when tension < 0.14"
     * described the bottom half of the bottom half, and were effectively
     * unreachable. Measured, the arrangement spent 70% of a run in the drop and
     * 5% in a breakdown: the cycle was drop for its full sixteen bars, a moment
     * of sustain, four bars of build, drop again. A drop that never ends is not
     * a drop, it is the volume knob.
     */
    switch (this.section) {
      case 'intro':
        // Leaves on its own schedule once the phrase is done; combat can pull it
        // out early, but only if things are genuinely happening.
        if (tension > 0.42 || barsIn >= 8) this.enter('build', bar);
        break;
      case 'build':
        // Four bars, not eight. A build long enough to feel like a proper riser
        // is longer than most waves last, so the drop it is building toward
        // never arrived and the track spent its life climbing.
        /*
         * 0.50, not 0.62 — because 0.62 could not happen.
         *
         * 0.62 was unreachable — `tools/session.mjs` measures peak tension over
         * a twelve-minute run at 0.54 — but that was NOT why this never fired,
         * and the distinction matters because changing the number alone fixed
         * nothing.
         *
         * The real cause was structural: `MIN_BARS.build` was also 4. The guard
         * at the top of `maybeAdvance` returns for bars 0-3, and at bar 4 the
         * timeout below fires regardless of tension — so the tension arm could
         * never be evaluated at any value whatsoever. Two constants that have
         * to differ for a condition to mean anything were equal, and `session`
         * caught it: every build in the run was exactly 4 bars, 18 of 18, the
         * only section in the arrangement with no spread at all.
         *
         * `MIN_BARS.build` is now 2, so bars 2 and 3 can exit early while 4
         * stays the cap. 0.50 sat just above the measured median of 0.49 WHEN THAT WAS THE MEDIAN;
     * it is 0.62 now and here is why, so a
         * genuinely hot moment cuts the build short and drops early — which is
         * the entire point of having a threshold here.
         */
        /*
         * 0.62, re-derived. The median moved and this threshold did not.
         *
         * The note above was written when energy had a median of 0.49, so 0.50
         * fired about half the time and the riser varied. Widening the master
         * signal moved the real median to 0.593 (`npm run realprobe`, moving
         * bot), which stranded 0.50 BELOW it: the tension arm then fired almost
         * every time the two-bar minimum opened, and the build stopped being a
         * riser. Measured in the real game, its durations collapsed to 1.9,
         * 3.8 and 5.6 seconds — the full four-bar build never happened.
         *
         * 0.62 restores it (1.9 / 3.8 / 5.6 / 7.5). 0.68 gives the same set, so
         * 0.62 is taken as the smallest value that does the job, the same rule
         * `BPM_STEP` is chosen by.
         *
         * Found by an adversarial review, not by me: this threshold was not
         * touched in the recalibration pass that re-derived `sustain`'s, and a
         * stranded constant does not announce itself.
         */
        /*
         * THE DROP HAS TO BE EARNED, and on the timeout arm it was not.
         *
         * `barsIn >= 4` sent every build to the drop regardless of what the
         * game was doing, so the drop was not something tension won — it was
         * guaranteed by the cycle. Measured, the arrangement runs
         * sustain(8) -> build(4) -> drop(8) whenever tension sits in the broad
         * middle band, which is where the median (0.588) lives, and the drop
         * came out holding 52.6% of every run. `tools/sections.mjs` has the
         * figures; the complaint is this file's own: "a drop that never ends is
         * not a drop, it is the volume knob."
         *
         * So a build that times out at LOW tension lands back on the sustain
         * instead. The tension arm above is untouched — a wave that heats up
         * still drops immediately, which is the whole point of that constant
         * and the reason it was restored to 0.62.
         *
         * 0.44 is not a new number. It is the line this file already uses, four
         * cases down, to decide whether a sustain has anything happening under
         * it or should fall to a breakdown. Reusing it keeps one definition of
         * "the game has gone quiet" rather than adding a second that can drift
         * away from the first.
         */
        if (tension > 0.62) this.enter('drop', bar);
        else if (barsIn >= 4) this.enter(tension < 0.44 ? 'sustain' : 'drop', bar);
        break;
      case 'drop':
        // One phrase, not two. Sixteen bars is half a minute of everything at
        // once, and it was the single biggest reason the track had no dynamics.
        if (tension < 0.35 || barsIn >= BARS_PER_PHRASE) this.enter('sustain', bar);
        break;
      case 'sustain':
        // Sustain had no timeout at all: with tension resting between its two
        // thresholds there was no exit, so it depended on a tension excursion to
        // move at all. It is a landing, not a destination.
        // 0.52, not 0.55 — same reason as the build's threshold below: measured
        // peak tension is 0.54, so 0.55 was one hundredth outside the range and
        // this early exit never fired. Sustain could only ever leave on its
        // eight-bar timeout, which is what "a landing, not a destination" was
        // trying to avoid. 0.52 sits between the median (0.49) and the p90
        // (0.53), so a wave that genuinely heats up lifts the track out.
        /*
         * RECALIBRATED, because the signal these numbers describe moved.
         *
         * The note above records the old distribution in its own words:
         * "0.52 sits between the median (0.49) and the p90 (0.53)". That was
         * true. It is no longer: retuning `progressFloor`, the tension
         * envelope's release and the drop gate widened the master signal from
         * a p10-p90 span of 0.238 to 0.340, and the real distribution measured
         * with `npm run realprobe` is now p10 0.354, MEDIAN 0.622, p90 0.700.
         *
         * Against that, 0.52 is roughly the 30th percentile, so "a wave that
         * genuinely heats up" became "almost always", and 0.36 sits BELOW the
         * p10, so the breakdown arm was very nearly dead. Measured over three
         * seeds before this change: one breakdown per seven minutes, lasting
         * 1.9s — 0.4% of the run spent resting. An arrangement with no rest is
         * relentless whatever the notes are doing, and it is the structural
         * half of the same complaint the stem curves address.
         *
         * The replacements keep the ORIGINAL INTENT by percentile rather than
         * by absolute value: 0.66 sits between the new median and p90 exactly
         * as 0.52 sat between the old ones, and 0.44 is the new p20, which is
         * the same "genuinely calm" the old 0.36 was reaching for.
         */
        if (tension > 0.66) this.enter('build', bar);
        else if (tension < 0.44 && barsIn >= 4) this.enter('breakdown', bar);
        else if (barsIn >= BARS_PER_PHRASE) this.enter(tension < 0.44 ? 'breakdown' : 'build', bar);
        break;
      case 'breakdown':
        // Leave early and often. A breakdown is a comma, not a paragraph — the
        // track was spending a third of its life in one because the gaps
        // between waves grew when the game got easier.
        // Still short, but 0.16 meant "the instant anything at all happens",
        // which is why a breakdown could not survive the gap between two waves.
        /*
         * 0.55, up from 0.44, for the same reason as the entry thresholds.
         *
         * The exit has to sit clear of the entry or a breakdown is ejected on
         * the bar it starts. With entry at 0.44 and the median now 0.622, an
         * exit of 0.44 meant "leave immediately, always" — the measured
         * breakdown lasted 1.9s, shorter than its own two-bar minimum. 0.55 is
         * the new p35: comfortably above the 0.44 entry, comfortably below the
         * median, so a breakdown ends when the game genuinely picks back up
         * rather than on the first flicker.
         */
        /*
         * ...unless the FORM put us here, in which case it holds.
         *
         * `restHold` is the one place a section's own exit is overruled, and
         * it is overruled in the direction of less music rather than more,
         * which is the direction this arrangement has never once been pushed
         * in. The eight-bar timeout is untouched, so a forced rest can still
         * only ever be four bars long. See `restHold`.
         */
        if (bar < this.restHold) break;
        if (tension > 0.55 || barsIn >= 8) this.enter('build', bar);
        break;
      case 'fill':
        // A fill is one bar and then back to work.
        this.enter(this.afterFill, bar);
        break;
      case 'collapse':
        break;
    }
  }

  /**
   * True once the arrangement has reached a drop in this run.
   *
   * A breakdown is a rest FROM something, so it needs something to rest from.
   * See `MusicDirector.onWaveClear`, which will not ask for one before this.
   */
  private dropped = false;

  /** Has the arrangement arrived anywhere yet? See `dropped`. */
  get hasDropped(): boolean {
    return this.dropped;
  }

  private enter(section: SectionName, bar: number): void {
    if (this.section === section) return;
    if (section === 'drop') {
      this.dropped = true;
      this.dropsThisRun++;
    }
    // Entering a rest satisfies the form immediately, so a rest the game
    // allowed on bar 20 resets the clock exactly as one the form forced does.
    if (Arranger.RESTING.has(section)) this.barsSinceQuiet = 0;
    this.section = section;
    this.sectionStartBar = bar;
    if (section === 'build' && this.dropAtBar < 0) this.buildStartBar = bar;
  }

  state(t: Transport): ArrangementState {
    const barF = t.bar;
    const bar = Math.floor(barF);
    const barsIn = bar - this.sectionStartBar;
    const introProgress =
      this.section === 'intro' ? clamp((barF - this.sectionStartBar) / MIN_BARS.intro, 0, 1) : 1;

    let buildProgress = 0;
    let barsToDrop = -1;
    if (this.section === 'build') {
      if (this.dropAtBar >= 0) {
        const span = Math.max(1, this.dropAtBar - this.buildStartBar);
        buildProgress = clamp((barF - this.buildStartBar) / span, 0, 1);
        barsToDrop = this.dropAtBar - bar;
      } else {
        buildProgress = clamp((barF - this.sectionStartBar) / 8, 0, 1);
      }
    }

    return {
      section: this.section,
      barsIn,
      buildProgress,
      introProgress,
      barsToDrop,
      // Last bar of every phrase gets a fill, which is what stops an eight-bar
      // loop from sounding like an eight-bar loop.
      fillBar: Math.floor(barF) % BARS_PER_PHRASE === BARS_PER_PHRASE - 1,
      act: this.act,
      barsSinceQuiet: this.barsSinceQuiet,
      dropsThisRun: this.dropsThisRun,
      forcedRests: this.forcedRests,
    };
  }
}
