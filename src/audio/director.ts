/**
 * The music director: game state in, a live EDM track out.
 *
 * How the live control works, since it is the non-obvious part:
 *
 *   - The master pattern is handed to Strudel exactly ONCE, at the start of a
 *     run. It is a `stack` of `ref(() => cache[stem])` — `ref` re-reads its
 *     accessor on every scheduler query (~20Hz), so swapping what `cache[stem]`
 *     points at swaps the music with no re-evaluation and no retrigger.
 *   - Continuously-varying controls (filter openness, drive, build progress)
 *     are `signal`s closed over this object's fields, so they move every frame
 *     without rebuilding anything.
 *   - Structural changes (which layers exist, how busy the drums are, what
 *     chord it is) rebuild the cached patterns, and only on bar lines.
 *
 * The one subtlety worth stating: each cached stem is an eight-bar `cat`, not a
 * one-bar loop. Strudel's `cat` advances with its own cycle counter, so the
 * chord progression and the phrase-end fills stay locked to the transport
 * regardless of *when* a rebuild happens. Without that, a rebuild landing a few
 * milliseconds either side of a bar line could repeat or skip a chord — a race
 * that would be intermittent, subtle, and miserable to debug.
 */

import { cat, ref, signal, silence, stack, type Pattern } from '@strudel/core';
import type { AbilityId, GameEvents, GameSnapshot, PowerupKind, SectionName } from '../core/events';
import { clamp, clamp01, damp, Latch, lerp, remap, StickyBucket } from '../core/math';
import { BARS_PER_PHRASE, type Transport } from '../core/transport';
import { ACT_SHAPE, Arranger, actForPhrase, type Act } from './arrangement';
import { setTempo } from './engine';
import { soundfontGeneration } from './soundfonts';
import { ensureMasterCeiling, masterVolume, musicTrim } from './volume';
import {
  MOVEMENT_MIX,
  stabGuideTones,
  buildArp,
  buildBass,
  buildChords,
  buildClap,
  buildFx,
  buildMotor,
  motorVoicing,
  buildKick,
  buildLead,
  buildMotifs,
  buildPowerupVoices,
  buildSub,
  chordForBar,
  feelForWave,
  hasVoicedPowerup,
  introGate,
  kickRhythm,
  FEEL_HUES,
  FEEL_LABELS,
  STEM_IDS,
  stemLevel,
  type Feel,
  type Movement,
  type MusicalState,
  type Signals,
  type StemId,
} from './layers';
import { allocate, arpDisplacement, ensembleLift, ensembleSize, ensembleTrim, longRest } from './orchestration';
import { TensionModel, TERM_LABELS } from './tension';
import {
  keyLabel,
  MODE_LADDER,
  pivotChord,
  progressionFor,
  voiceLead,
  type Chord,
  type ModeName,
} from './theory';

type StemBuilder = (m: MusicalState) => Pattern;

/**
 * The player's kit as the score sees it: abilities and field powerups in one map.
 *
 * ONE function because there were two copies and they drifted. The progression
 * rewrite moved nine of the twelve ids from `snapshot.powerups` onto
 * `snapshot.abilities`; the builders were taught to read both, and
 * `sourceLines` — the panel that exists to show the player the code that is
 * actually playing — was not. So the panel printed a kick pattern nobody was
 * hearing, and nothing warned, because a missing key on a `Partial<Record>` is
 * a legal `undefined` and the `?? 0` beside it turns that into a plausible zero.
 *
 * Field drops win on a collision: they are the transient thing, and if an id
 * ever exists in both maps the temporary one is the one currently true.
 */
function kitOf(snap: GameSnapshot | null | undefined): Partial<Record<PowerupKind, number>> {
  return { ...(snap?.abilities ?? {}), ...(snap?.powerups ?? {}) } as Partial<Record<PowerupKind, number>>;
}

const BUILDERS: Record<StemId, StemBuilder> = {
  sub: buildSub,
  kick: buildKick,
  clap: buildClap,
  /*
   * The `hats` slot plays THE MOTOR — a pitched inner voice, not a hi-hat.
   *
   * The id is left alone deliberately. Renaming the stem would touch the HUD's
   * lane readout, `MOVEMENT_MIX`, `STEM_CURVES`, `INTRO_ENTRY` and a dozen tools
   * in `tools/` that address lanes by name, for no musical gain — the id is
   * internal and `STEM_LABELS` is what a player actually reads. See
   * `buildMotor` for why the pulse moved out of the drum kit in the first
   * place; it is the single change this refactor is built on.
   */
  hats: buildMotor,
  bass: buildBass,
  chords: buildChords,
  arp: buildArp,
  lead: buildLead,
  fx: buildFx,
  motifs: buildMotifs,
  power: buildPowerupVoices,
};

/** How fast a stem fades in / out when it crosses its threshold, in halflife seconds. */
const LEVEL_ATTACK = 0.22;
const LEVEL_RELEASE = 0.75;

/*
 * The sidechain constants lived here and are gone. Two things worth keeping
 * from what they taught us, because both cost real measurement to learn:
 *
 * 1. `tools/gating.mjs` reconstructs the automation superdough actually writes,
 *    and found the melodic buses held more than 6dB down for 27-32% of the
 *    time, closing 2.5-3.7 times a second. At that depth the tune does not duck
 *    under the kick, it VANISHES under it — and "the whole tune disappearing
 *    three times a second" is a large part of what every "choppy" report in
 *    this project's history was describing.
 *
 * 2. superdough's `duckdepth` control is NOT the floor. It ducks to
 *    `1 - sqrt(depth)`, so `duckdepth(0.9)` is a floor of 0.051 — about -26dB.
 *    Values that read like a gentle sidechain were an order of magnitude
 *    stronger than they looked. If ducking is ever reintroduced, state the
 *    floor and invert it at the call site.
 *
 * See `applyDuck` for why the feature itself was removed rather than retuned.
 */
/*
 * 100, not 118 — because a floor of 118 means the score has no repose in it.
 *
 * `tools/session.mjs` measures a twelve-minute run at median 138 BPM, p10 129,
 * and **0% of bars under 120**. The music spends its entire life inside dance
 * tempo, and tempo is the first thing an ear reads genre from after timbre. No
 * amount of work on voicing, register or rhythm can undo a track that is never
 * allowed to slow down.
 *
 * The canon this score is aiming at is nowhere near this narrow. Chrono
 * Trigger's most-remembered cues are slow — "Secret of the Forest" sits around
 * 92, "Corridors of Time" around 112, Frog's Theme around 120 — and Wily Stage
 * 1 is up at 150. The RANGE is the point: those soundtracks earn their fast
 * music by having somewhere slow to come from.
 *
 * 100 is a floor the breakdown and the collapse can actually reach, not a new
 * resting tempo — `base` still starts at 122 and climbs with the wave, so
 * ordinary play is unchanged. This only opens a door that was nailed shut.
 */
const BPM_MIN = 100;
const BPM_MAX = 150;
/**
 * THE TEMPO OF THE GENRE. 140, and it is not negotiable by anything above it.
 *
 * Dubstep is one of the very few popular forms with a canonical BPM rather than
 * a range: 140, half-time, so the bar reads at 70. Everything the genre does
 * with energy it does in the BASS — the LFO rate, the filter depth, the drive —
 * and not in the clock. That is the opposite of how this score has always
 * escalated, and it is the change that had to be made first, because a tempo
 * curve running 122-150 makes every other decision here a decision about a
 * different piece of music.
 *
 * `base` was `122 + 16 * wave/(wave + 20)` — 122 at wave 0, 138 asymptotically
 * — plus `tension * 10`, which is a 28 BPM working range. It is now a 12 BPM
 * one centred here. See `updateTempo` for the arithmetic and for what was kept.
 *
 * BPM_MIN and BPM_MAX are unchanged and still bind: the breakdown's -20 and the
 * collapse still reach down out of dance tempo entirely, which is the one thing
 * in this score allowed to leave the genre.
 */
const DUBSTEP_BPM = 140;
/**
 * Largest tempo change allowed in one bar. Bigger steps read as a mistake.
 *
 * 4, and the history matters because 5 was tried and REJECTED earlier the same
 * day. That rejection was correct at the time: with every breakdown being cut
 * to 2-3 bars by the next wave, a bigger step bought exactly one BPM (118 ->
 * 117) in exchange for tempo moves large enough to be noticed as moves.
 *
 * Widening the automatic breakdown gate changed the premise. Breakdowns now
 * reach their full 8 bars, which is long enough for a step to actually spend
 * itself, and the same experiment re-run gives a different answer:
 *
 *     step 3    min 104 BPM    spread 40
 *     step 4    min 100 BPM    spread 44      <- reaches BPM_MIN exactly
 *     step 5    min 100 BPM    spread 44      <- buys nothing further
 *
 * 4 rather than 5 because it is the SMALLEST step that reaches the floor.
 * Where two values produce the same result, the gentler one is right — the
 * constant exists to stop tempo changes reading as mistakes, so any step
 * beyond what the music needs is pure cost.
 *
 * Second instance today of a rejected experiment expiring when its premise
 * moved; see the pad-register note in `layers.ts` for the first. A written
 * rejection reads like a closed question and neither of these would have been
 * revisited without going back and asking what had changed underneath them.
 *
 * THOSE THREE ROWS ARE NOW HISTORY, NOT A CURRENT MEASUREMENT, and the premise
 * has moved again — twice. `TEMPO_DEADBAND` below means the tempo ignores
 * small gaps entirely, and `MIN_BARS` is now enforced against explicit
 * requests, which changed how long a breakdown actually gets. Re-measured on
 * the real game: min 110, median 134, max 141, so the "reaches BPM_MIN
 * exactly" claim no longer holds — nothing in ordinary play descends to 100,
 * and even the death `collapse`, whose target IS `BPM_MIN`, arrives at 108.
 *
 * The choice of 4 still stands on its own argument (the smallest step that
 * does not read as a mistake), which is why the value is unchanged. But do not
 * re-derive anything from the table above without re-running the sweep: it
 * describes a configuration that no longer exists.
 */
const BPM_STEP = 4;
/**
 * How far the target must diverge before the tempo bothers to follow it.
 * See the note in `updateTempo`: without this the tempo tracks the noise in
 * `tension` and reverses direction on nearly half of all moves.
 *
 * Swept on a real 420s run (moves / share that reverse direction):
 *   none 136 / 44%    3 -> 108 / 46%    5 -> 83 / 34%    8 -> 66 / 27%
 *
 * 8 halves the number of tempo changes and cuts reversals from 44% to 27%,
 * and — the part that decided it — the tempo RANGE is unchanged at every
 * setting: min 113, median 134, max 141. So this is removing jitter, not
 * flattening the curve, which is the thing worth checking before widening a
 * deadband. It is also comfortably below the two deliberate tempo moves in the
 * score, the breakdown's -20 and the boss's -16, so neither is suppressed.
 */
const TEMPO_DEADBAND = 8;
/**
 * Seconds between OVERDRIVE-forced drops. See `onPickup`: the pickup arrives
 * roughly every 9.5s and lasts 12s, so without this the arrangement is pinned.
 */
const OVERDRIVE_DROP_COOLDOWN = 45;
/** How long one OVERDRIVE burst holds the arrangement at its top rung. */
const OVERDRIVE_PEAK_SECONDS = 10;

/**
 * Halflife, in seconds, of the smoothing on the lead register's input.
 *
 * SWEPT, NOT PICKED, and the first value tried was four times too long and
 * would have shipped a dead feature. See `Director.encSlow` for why any
 * smoothing is needed at all.
 *
 * The measurement replays the exact chain the director runs — damp, then
 * `Latch(0.58, 0.42)`, then applied on the bar line — against two 8-minute
 * headless runs of the dodge bot, and reports both halves of the trade: how
 * often the octave changes, and whether it ever gets there.
 *
 *     halflife    octave changes / 18s     high octave, share of run   reached
 *     0 (raw)              1.37                      8.9%               2/2
 *     0.25                 1.23                      8.1%               2/2
 *     0.50 (this)          0.72                      5.9%               2/2
 *     0.75                 0.27                      2.6%               2/2
 *     1.0                  0.11                      1.0%               2/2
 *     1.5                  0.04                      0.4%               1/2
 *     4.0                  0.00                      0.0%               0/2
 *
 * And the same table on the pre-treadmill tree, which is what 0.5 is chosen
 * against: raw gave 0.82 changes per 18s and 5.5% of the run in the high
 * octave. So 0.5 puts BOTH columns back where they were — 0.72 against 0.82,
 * 5.9% against 5.5% — rather than trading one for the other.
 *
 * FOUR SECONDS WAS THE FIRST GUESS AND IT PASSED `flicker` THREE TIMES OUT OF
 * THREE, with zero octave changes. It also never reached the high octave once
 * in sixteen simulated minutes, on either tree: a gate satisfied by deleting
 * the thing it was watching, which is AGENTS.md §3's "ask how someone could
 * pass it while changing nothing" arriving from the other side. The sweep is
 * here so the next person does not have to re-derive that.
 */
const REGISTER_HALFLIFE = 0.5;
/**
 * Tension floor during the intro, so `INTRO_ENTRY`'s order can be heard.
 *
 * 0.38 rather than higher because an introduction should sit under the drop it
 * builds into. Measured at 6s into a run: chords 0.48 and lead 0.44 here,
 * against 0.62 and 0.59 in a steady-state drop — present and clearly not the
 * climax. At 0.50 the intro reached drop levels, which is not an intro.
 */
const INTRO_GATE_FLOOR = 0.38;
/**
 * Amplitude below which a scheduled event is not worth a voice, as
 * `gain^2 * postgain^2` — about -52dB. See `masterPattern`.
 *
 * The value is not arbitrary: it falls between the two yield levels in
 * `orchestration.ts` by construction. A lane held at `YIELD_NEAR` (0.18)
 * reaches roughly 0.016 here and survives; one at `YIELD_FAR` (0.06) reaches
 * roughly 0.0018 and is dropped. That is exactly the distinction the yield
 * comment already draws — "the next-best voice gets to double or pad, and the
 * rest rest" — so this makes the resting lanes actually rest instead of
 * allocating a voice each to produce, in that comment's words, "-24dB worth of
 * nothing".
 *
 * A more conservative -60dB was measured and rejected: it saves 5% of voice
 * allocations against 21% here, because almost all of the waste sits in that
 * 8dB band, which is precisely the `YIELD_FAR` population.
 */
/*
 * EXPORTED for `tools/opening.mjs`, which counts the intro's bass and stab by
 * this same test rather than by onset count — a hap the director would refuse
 * a voice must not count as "harmony present". The tool imports it; a copy
 * would lie the day it moved (AGENTS.md §3).
 */
export const AUDIBLE_FLOOR = 0.0025;

export interface DirectorReadout {
  section: SectionName;
  /*
   * THE FORM, exposed because nothing in `tools/` could measure one.
   *
   * `sections` measures section share, `variety` measures mode share, `churn`
   * and `phrasechurn` measure rebuild churn — every one of them is a
   * DISTRIBUTION, and an arc is an ORDERING. A tool can only ask "did this rise
   * across the run" if the run's own idea of where it is is readable, and until
   * these four fields existed it was not. See `tools/arc.mjs`.
   */
  /** Which part of the run's arc this instant belongs to. */
  act: Act;
  /** Eight-bar phrases since the run started. The run clock. */
  runPhrase: number;
  /** The lane resting this phrase, or null. */
  tacet: StemId | null;
  /** Bars since the arrangement last rested. */
  barsSinceQuiet: number;
  /** Rests the form insisted on, as opposed to tension allowing. */
  forcedRests: number;
  bpm: number;
  key: string;
  /** Human-readable groove, e.g. "half-time trap". */
  feel: string;
  /** Base hue for the playfield, from the current groove. */
  paletteHue: number;
  tension: number;
  /** The value the arrangement runs on. Shown in the HUD as ENERGY. */
  energy: number;
  /** Harmonic colour carried from the last wave's grade; negative is brighter. */
  modeBias: number;
  /** What is driving the music right now, in words. */
  driver: string;
  /** Semitone offset the melody is currently transposed by. */
  leadRegister: number;
  /** Why the harmony is where it is, in words. Empty when neutral. */
  harmonyReason: string;
  rawTension: number;
  /**
   * The baseline `energy` is held at at this instant, before danger.
   * Exposed so measuring tools never have to restate the formula — a
   * hardcoded copy in `session.mjs` went stale the moment it was retuned.
   */
  progressFloor: number;
  immediate: number;
  levels: Record<StemId, number>;
  active: Record<StemId, boolean>;
  /** 1 = untouched, 0 = one hit from a game over. */
  health: number;
  bar: number;
  beat: number;
}

export class MusicDirector {
  private tensionModel = new TensionModel();
  private arranger = new Arranger();
  private progressFloor = 0;

  /** The motor's line as last built — mirrored by `sourceLines`. */
  private motorLineText = '';

  /** True while the tempo is completing a move — see `updateTempo`. */
  private tempoMoving = false;
  /* ==========================================================================
   * THE DROP, AS TWO BARS THE MIX TREATS DIFFERENTLY FROM EVERY OTHER BAR.
   * ==========================================================================
   *
   * -1 ordinary   0 the GAP   1 the SLAM
   *
   * The genre is built on one gesture and this score did not have it. A drop is
   * BUILD, then a bar where almost everything stops, then the heaviest bar in
   * the track — and the silence is the load-bearing half. Without it the
   * "drop" is only the arrangement continuing at a slightly higher gate, which
   * is exactly what `tools/sections.mjs` has been measuring: the drop is
   * **48.6% of every run**, entered a couple of times a minute, and a listener
   * cannot hear it arrive.
   *
   * WHY IT IS HERE AND NOT IN A BUILDER. Every builder sees `section` but none
   * of them sees how many bars into that section it is, and the fader layer
   * does (`ArrangementState.barsIn`). Adding `barsInSection` to `MusicalState`
   * would have been the other route and it was rejected: sixteen tools in
   * `tools/` construct that interface as an object literal, so a new required
   * field arrives at all sixteen as `undefined` and every comparison against it
   * silently reads false. A gesture that is invisible to the gates measuring
   * the thing it changes is not one worth having.
   *
   * It is also the right layer on its own terms. The gap is not a change of
   * material — every lane goes on playing exactly what it was playing, and
   * comes back mid-phrase without a rebuild. It is the mix being pulled out
   * from under the track for one bar, which is what a hand on a fader does.
   *
   * See `updateLevels` for the two rules and for why they SET the level rather
   * than damping toward it.
   */
  private dropPhase = -1;

  /** Set by a boss telegraph: take the whole tempo change on the next bar. */
  private tempoSnap = false;

  /** Seconds elapsed this run, for rate-limiting event-driven section forces. */
  private runSeconds = 0;

  /* ---------------------------------------------------------------------
   * THE RUN CLOCK — the term the score did not have.
   *
   * Before this, exactly ONE thing in the entire director read elapsed run
   * time: `OVERDRIVE_DROP_COOLDOWN`. Everything else was a function of the
   * wave, and the wave is a cycle — `feelForWave` is an eight-slot rota,
   * `themeForWave` is a rondo, the tonic walks the circle of fourths and
   * returns after forty-eight waves. So a twenty-minute run had no arc,
   * because it had no term that could carry one.
   *
   * MEASURED IN BARS, RELATIVE TO THE RUN. The transport free-runs from page
   * load and is never reset — `main.ts`'s retry path calls `director.reset`
   * and `world.start` and nothing else — so `transport.bar` is page time, and
   * a second run would have opened in whatever act the first one had reached.
   * Stamping the bar the run began at is one field and makes the clock
   * musical (it is bars, so an act boundary lands on a phrase line) AND
   * run-relative.
   *
   * -1 rather than 0 as the empty value, because bar 0 is a legal start.
   * ------------------------------------------------------------------ */

  /** Transport bar this run started on, or -1 before the first update. */
  private runStartBar = -1;
  /** Eight-bar phrases elapsed since this run started. */
  private runPhrase = 0;
  /** Which part of the arc the run has reached. See `ACT_SHAPE`. */
  private act: Act = 'exposition';
  /**
   * The tonic the run OPENED in, so the recapitulation has somewhere to return.
   *
   * `reset()` sets the tonic to 57 and `onWaveStart` walks it away from there;
   * this is read rather than hardcoded so the two cannot drift, which is the
   * same reason `reset()` reads `MODE_LADDER[0]` instead of naming a mode.
   */
  private homeTonic = 57;
  /**
   * The groove the run OPENED with, held again through the recapitulation.
   *
   * `feelForWave(0, false)` is `boomchick`, and reading it rather than naming
   * it means re-ordering `FEEL_CYCLE` cannot silently make the recap return to
   * a groove the opening never played.
   */
  private homeFeel: Feel = 'boomchick';

  /** When OVERDRIVE last earned a forced drop. See `onPickup`. */
  private lastOverdriveDrop = -999;

  /** A modulation waiting for the next phrase boundary. See `onWaveStart`. */
  private pendingTonic: number | null = null;
  /**
   * The phrase whose last bar was built as a PIVOT. See `updateHarmony`.
   *
   * Written by `buildSlots` when it actually places the chord, and read by
   * `updateHarmony` to decide whether the modulation has been announced yet.
   * Deliberately a record of what was BUILT rather than of what was intended:
   * a pivot that was computed and then lost to a later rebuild must not count,
   * and this is the only field in the class that can tell the difference.
   */
  private pivotPhrase = -1;
  /** Phrases a handover has been held waiting for its pivot. Capped at 2. */
  private heldForPivot = 0;
  /** The wave the current mode was chosen for; see `updateHarmony`. */
  private modeWave = -1;
  /*
   * The wave the SCORE is playing, which lags the wave the GAME is fighting.
   *
   * `themeForWave` is the only consumer of `wave` in `MusicalState`, and it was
   * reading the live value — so the tune changed the instant a wave did, while
   * the key and mode waited for the next phrase line. For the bars in between,
   * a new theme played in the old colour. Measured, that split a run into 32
   * (key, wave) segments of 8 bars where there were only 15 waves.
   *
   * Deferring it costs nothing: a theme is a whole-phrase object anyway, and
   * starting one mid-phrase was never coherent.
   */
  private musicalWave = 0;
  private pendingWave: number | null = null;
  /*
   * The global phrase index at which the CURRENT theme began.
   *
   * `developmentFor` leaves a theme alone for its first two phrases — "you
   * cannot develop a theme nobody has heard yet" — but it was handed the phrase
   * index counted from RUN START, which never resets. A theme entering at
   * global phrase 17 therefore received `DEVELOPMENTS[15 % n]` on its very
   * first bar: its opening statement was its inverted-and-displaced variation,
   * and no theme in the game ever had an ABA' arc.
   *
   * Subtracting this makes the index theme-relative, which is what the
   * development schedule was always written against.
   */
  private themeStartPhrase = 0;

  /** The pattern currently cached for each stem; what `ref` hands to Strudel. */
  private cache: Record<StemId, Pattern>;
  /** Smoothed 0..1 fader per stem. */
  private levels: Record<StemId, number>;
  /** Hysteresis latch per stem. */
  private active: Record<StemId, boolean>;

  /** Values read by the `signal`s. Mutated every frame. */
  /*
   * `space`, `ring` and `hold` are the rig's three audio abilities, as signals.
   *
   * REVERB, RESONANCE and FERMATA name effects the score has no dial for, so
   * `tools/instruments.mjs` found them reaching the mix by no route at all —
   * along with COMPRESSOR, which is handled in `applyGlue` instead because
   * compression is a property of the LEVEL SET rather than of any one lane.
   *
   * All three default to 0, meaning "the score as written". They are additive
   * on top of whatever a lane already does, so an unheld rig changes nothing
   * and the baseline mix is bit-identical to before they existed.
   */
  private p = {
    tension: 0, build: 0, openness: 1, drive: 0, thin: 0, concussion: 0,
    /** REVERB: extra room send, 0..1. */
    space: 0,
    /** RESONANCE: extra filter resonance, 0..1. */
    ring: 0,
    /** FERMATA: how much longer notes are held, 0..1. */
    hold: 0,
  };
  /** COMPRESSOR: how hard stem levels are pulled toward their mean, 0..1. */
  private glue = 0;
  /** 1 = untouched, 0 = one hit from a game over. */
  private health = 1;
  /** What the arrangement actually runs on: danger or progress, whichever wins. */
  private energy = 0;
  /** 0..1 through the opening phrase; gates which layers have arrived. */
  private introProgress = 1;
  /** Advances once per phrase; drives endgame mode rotation. */
  private phraseIndex = 0;
  /** What the run sounded like, for the summary. */
  readonly heard = { keys: new Set<string>(), grooves: new Set<string>(), sections: new Set<string>(), peakEnergy: 0 };

  /**
   * Semitones the arp is displaced by so the melody has its octave to itself.
   *
   * Smoothed rather than switched: a part that jumps an octave between one hap
   * and the next is a glitch, and this project's standing complaint is
   * choppiness. See `orchestration.arpDisplacement`.
   */
  private arpOctave = 0;

  /** Octave offset for the lead, from the player's height on the field. */
  private leadRegister = 0;
  /** Where the ship says the register should be; applied on the next bar line. */
  private wantRegister = 0;
  /** Latched so hovering on the halfway line does not flip the octave. */
  private highField = new Latch(0.58, 0.42);

  /**
   * `encirclement`, smoothed to the timescale the register is supposed to move
   * on. Halflife in `REGISTER_HALFLIFE`.
   *
   * WHY THIS EXISTS: THE TREADMILL BROKE AN ASSUMPTION THAT WAS WRITTEN DOWN.
   * The note at the assignment below says the register uses `encirclement`
   * "specifically because it is SLOW ... it needs a term that changes on the
   * timescale of a wave, not of a dodge". That was true of an arena, where the
   * crowd converged on a player who could stand still and the ring closed and
   * opened over a wave. It is not true of a track: the ship flies THROUGH each
   * group, so encirclement rises as it enters the traffic and falls as it
   * leaves, several times a minute, by design.
   *
   * MEASURED, TWICE OVER. `tools/flicker.mjs` holds the ship in place and
   * counts how often the lead's octave changes over 18 seconds: 1, 2, 4 across
   * three runs of the pre-treadmill tree, and 3, 3, 6, 7 across four runs of
   * the treadmill before this field existed. A melody that changes octave
   * every three seconds is the "theremin" the note below warns against — it is
   * not the register following the fight, it is the register unable to decide.
   *
   * An 18-second browser window is a small sample of a rare event, so the
   * quantity was re-measured headlessly over sixteen simulated minutes as
   * well; that sweep is at `REGISTER_HALFLIFE` and it agrees — 0.82 octave
   * changes per 18 s before the treadmill, 1.37 after.
   *
   * The `Latch`'s 0.58/0.42 band is untouched and is still doing its job; the
   * problem is not chatter ON the boundary, which is what hysteresis fixes, it
   * is a real signal that now genuinely crosses the boundary more often. So
   * the fix is upstream of the latch, on the input, and it is a smoothing
   * rather than a wider band because a wider band would make the register
   * unreachable at one end rather than merely slower.
   */
  private encSlow = 0;

  /*
   * The rebuild key's continuous terms, quantised with hysteresis.
   *
   * Plain rounding here meant a value sitting on a bucket edge rewrote the
   * whole arrangement every frame. See StickyBucket.
   */
  private intensityBucket = new StickyBucket(6);
  private brightnessBucket = new StickyBucket(3);
  private healthBucket = new StickyBucket(5);

  /*
   * The multiplier, coarsely, so the lead's descant can appear at all.
   *
   * Without this the descant would only ever arrive when some *other* term
   * changed the rebuild key — a musical feature keyed to a value the rebuild
   * did not watch. Four steps with hysteresis, because a raw combo ticks
   * constantly and the descant fades across a range rather than switching.
   */
  private comboBucket = new StickyBucket(4);
  /** Latched so a graze rate hovering at the threshold does not chatter. */
  private grazing = new Latch(1.4, 0.9);
  /** Dominant tension term, refreshed each frame for the readout. */
  private driver: keyof import('./tension').TensionTerms = 'crowding';
  private readonly sig: Signals;

  /*
   * The sidechain's depth and recovery signals are gone with the duck itself.
   *
   * They were genuinely good engineering — reading per hap rather than being
   * baked in at build time, so the pump tracked tempo and the kick's own fader
   * continuously. The problem was never the implementation; it was that the
   * feature should not exist in this score at all. See `applyDuck`.
   *
   * `duckDepth()` and `duckRecovery()` are left in place below: they are pure
   * functions with no callers, and if a deliberate one-off pumped section is
   * ever wanted they are the correct implementation of it.
   */

  private tonic = 57; // A3
  private mode: ModeName = 'aeolian';
  private bpm = 128;
  private targetBpm = 128;
  /*
   * The two rig abilities that name a thing the DIRECTOR owns.
   *
   * `tools/instruments.mjs` found six abilities that reach the score by no
   * route at all — no note content, no `ENSEMBLE_MIX` lift, no sfx — and they
   * are exactly the six named after audio processes: REVERB, COMPRESSOR, CAPO,
   * FERMATA, UP-TEMPO, RESONANCE. Their `character` strings in weapons.ts read
   * like a spec nobody implemented: "everything up a step", "pushed ahead of
   * the beat", "tail and space", "rings on after the strike".
   *
   * CAPO and UP-TEMPO are wired here because key and tempo are this class's
   * own state, so they cost one term each and nothing else has to change. The
   * other four want signals `layers.ts` does not have yet — there is no room,
   * resonance or note-length signal in `p` — and inventing half of one to make
   * a gate green would be worse than leaving the gate red. `instruments` still
   * fails on those four, deliberately.
   */
  private capo = 0;
  /**
   * Where the capo is GOING, applied on the next phrase line.
   *
   * `capo` transposes the whole key, and it is driven straight off the
   * player's rig — so levelling the CAPO item used to modulate the entire
   * score on the frame the card was taken, mid-bar, mid-phrase. Every other
   * harmonic decision in this file waits for a phrase boundary (see
   * `updateHarmony`, which early-returns on `crossedPhrase`), and this one had
   * quietly opted out.
   *
   * Measured over five 480s runs, capo accounted for 7 segment cuts and 6 of
   * them ended a run SHORTER than a single 8-bar phrase — the highest ratio of
   * any cause, so almost every capo change cut a tune off before it had been
   * stated even once.
   */
  private pendingCapo: number | null = null;
  /**
   * The boss flag the TUNE follows, turned only on a phrase line.
   *
   * See `MusicalState.bossTheme`. Kept here rather than derived at the call
   * site because `updateHarmony` is the only place allowed to move harmony,
   * and the tune and its mode have to leave on the same bar as well as arrive
   * on it.
   */
  private themeBoss = false;
  /**
   * Armed by the boss telegraph, so the leitmotif can arrive BEFORE the fight.
   *
   * `boss:telegraph` leads `bossActive` by exactly 4.0 bars — measured over 19
   * fights across five seeds, min, median and max all 4.0. Waiting for the
   * fight itself and then for the next phrase line put the tune a median 3.8
   * bars and a worst case 8.0 bars late, which at 128bpm is fifteen seconds of
   * a boss on screen with the ordinary theme still playing.
   *
   * Arming here spends that lead instead: the change still lands on a phrase
   * line, but the line it lands on is the first one after the TELEGRAPH, so
   * about half the time the leitmotif announces the boss rather than trailing
   * it. That is what a telegraph is for.
   */
  private bossArmed = false;
  private tempoLift = 0;
  private wave = 0;
  private feel: Feel = 'boomchick';
  private boss = false;
  private bossPhase = 0;
  /**
   * The named rule this wave runs under, or null.
   *
   * Read once per rebuild rather than per hap, exactly as the field's own
   * comment in `events.ts` asks: it selects material — how open the lead is,
   * where the arp sits in the stereo field — rather than modulating it.
   */
  private movement: Movement | null = null;

  /*
   * THE TACET — which lane sits out this phrase.
   *
   * A drop only lands if something was taken away first, and until the run
   * form existed the only lanes this arrangement ever genuinely ZEROED were
   * kick/clap/bass in a `breakdown` and everything in a `collapse`. The
   * research pass counted the consequence: the mix sat at 93-98% of its own
   * maximum voice count in its two densest sections, one of which holds nearly
   * half a run — and the "yield" the voice budget applies to a losing tonal
   * lane lands at 0.144, a rounding error away from `texture`'s 0.15 FORWARD
   * threshold, which is to say a subtraction the project's own tool cannot see.
   *
   * So one of the exempt lanes rests through every `sustain` phrase, by rota.
   * Not by tension — by position in the form, which is the whole difference
   * between "quiet is what happens when the game is calm" and "quiet is part of
   * the piece".
   *
   * `hats` IS NOT IN THE ROTA AND MUST NOT BE. It plays the motor, which is the
   * clock the whole arrangement is kept by now that the kick no longer hits all
   * four beats — see `buildMotor`. The plan already records that the motor is
   * the one lane that must stay exempt from any section-tacet rule. `sub` is
   * out for a different reason: it is an accent gated at `in: 0.44` and absent
   * most of the time, so resting it would subtract something usually not there.
   *
   * `null` in the fourth slot on purpose. Three phrases in four are missing a
   * part and the fourth is the whole band, so the full texture is itself an
   * event that recurs rather than the default everything else deviates from.
   */
  private static readonly TACET_ROTA: readonly (StemId | null)[] = ['clap', 'bass', 'kick', null];
  /** The lane resting this phrase, or null. Named in the structure key. */
  private tacetLane: StemId | null = null;

  /**
   * Which tonal lanes currently hold a slot in the voice budget.
   *
   * Carried across frames so an incumbent gets a head start and the ranking
   * cannot flip on a rounding error. See `orchestration.allocate`.
   */
  private readonly tonalHeld = new Set<StemId>();
  private intensity = 0;
  private brightness = 0.5;
  private lastKey = '';

  /** Bar index of the last rebuild, so non-structural changes coalesce per bar. */
  private lastRebuildBar = -1;
  /** Phrase index of the last rebuild, so the lazy tier coalesces per phrase. */
  private lastRebuildPhrase = -1;

  private started = false;
  private collapsing = false;

  /** Seconds since the collapse began, so the ending can actually end. */
  private collapseSeconds = 0;

  private snapshot: GameSnapshot | null = null;
  /**
   * Solo a single stem, or null to clear.
   *
   * Only meaningful for measurement: fader position is not loudness, because
   * each stem carries its own internal gains. Soloing and measuring RMS is the
   * only honest way to compare layers, and reasoning about balance from fader
   * numbers alone has already misled me twice.
   */
  solo: StemId | null = null;

  /** Wall-clock cost of the last rebuild slice, for the perf overlay. */
  lastRebuildMs = 0;
  rebuildCount = 0;
  /** Recent structure keys, for detecting rebuild thrash in tooling. */
  readonly keyHistory: string[] = [];
  /**
   * Rebuilds are spread over several frames.
   *
   * Rebuilding all eleven stems at once cost ~29ms — two dropped frames, about
   * once a second. Because `ref` reads each stem's cache independently, the
   * stems do not have to swap together: a few frames where the hats are one
   * structure-revision behind the kick is inaudible, since every stem is
   * cycle-aligned to the same chord grid regardless.
   */
  private pendingSlots: MusicalState[] | null = null;
  private pendingQueue: StemId[] = [];
  /** Upper-voice pitches that ended the last phrase, for voice leading. */
  private lastVoicing: number[] = [];
  /*
   * The voicing THIS phrase starts from, and which phrase it belongs to.
   *
   * `buildSlots` voice-leads all eight chords from wherever the previous build
   * left off, and then stored where it ended. Since a rebuild happens several
   * times per phrase, each one started from the *previous rebuild's* last
   * chord rather than the previous phrase's — so every rebuild walked the
   * voicing further and rewrote all eight chords with different inversions.
   * Pinning the seed per phrase makes a mid-phrase rebuild reproduce exactly
   * the chords already sounding.
   */
  private phraseSeedVoicing: number[] = [];
  private phraseSeedIndex = -1;

  constructor() {
    this.cache = Object.fromEntries(STEM_IDS.map((id) => [id, silence])) as Record<StemId, Pattern>;
    this.levels = Object.fromEntries(STEM_IDS.map((id) => [id, 0])) as Record<StemId, number>;
    this.active = Object.fromEntries(STEM_IDS.map((id) => [id, false])) as Record<StemId, boolean>;

    this.sig = {
      tension: signal(() => this.p.tension),
      build: signal(() => this.p.build),
      openness: signal(() => this.p.openness),
      drive: signal(() => this.p.drive),
      thin: signal(() => this.p.thin),
      space: signal(() => this.p.space),
      ring: signal(() => this.p.ring),
      hold: signal(() => this.p.hold),

      /*
       * These six replace thresholds that used to live inside the builders.
       *
       * The shapes are stated here rather than in `layers.ts` because they are
       * arrangement decisions — where the melody starts filling in, where the
       * ninth arrives — and because the crossover points have to line up with
       * the switch points they replace, or the music changes character. Each
       * one is centred on the threshold it stands in for: the melody's filigree
       * was `density < 0.34`, its ornament `density > 0.78`, the arp's fill
       * `density > 0.7`, and the chord extensions `tension > 0.35` and `> 0.7`.
       */
      register: signal(() => this.leadRegister),
      arpOctave: signal(() => this.arpOctave),
      density: signal(() => clamp01(remap(this.intensity, 0.18, 0.5, 0, 1))),
      ornament: signal(() => clamp01(remap(this.intensity, 0.68, 0.9, 0, 1))),
      fill: signal(() => clamp01(remap(this.intensity, 0.58, 0.82, 0, 1))),
      /*
       * `colour7` and `colour9` stood here — the faders on the chords lane's
       * colour pair: the ninth on `tension` 0.2-0.5 and, once
       * `ACT_SHAPE.ninth` unlocked it, the thirteenth on 0.55-0.85. The pair
       * is deleted (the tombstone in `buildChords`) and nothing read either
       * signal once it was gone; an unread signal is the "unmeasured
       * properties rot" case (AGENTS.md §3), so both went with the voices
       * rather than staying as two live reads per hap on nothing.
       *
       * The act still spends the ninth, and this is the stronger half of the
       * idea that survives: from the intensification on it is a MEMBER of the
       * chord (`chordForBar`'s extension, where the phrase chords are built below), which
       * the stab states in the register a listener follows. A colour tone
       * swelling in over four minutes was a colour tone nobody noticed
       * arriving; a chord that changes on the phrase line the act changes on
       * is heard.
       */
    };
  }

  /**
   * The pattern to hand to Strudel. Built once; everything after this happens
   * through the caches and signals.
   */
  masterPattern(): Pattern {
    const master = stack(
      ...STEM_IDS.map((id) =>
        // `postgain` rather than `gain`: the stems set their own `gain`, and a
        // second `gain` would overwrite it instead of scaling it.
        // Master volume folds in here rather than at a master bus, because
        // superdough wires its output straight to the destination and offers no
        // master fader to attenuate.
        ref(() => this.cache[id]).postgain(
          /*
           * Solo mutes the others *and* pins the soloed stem to full.
           *
           * It used to leave the stem on its live fader, which meant a solo
           * measurement was really measuring the arrangement: the same layer
           * read -15.8dB and -43.1dB on consecutive runs purely because its
           * fader happened to be open in one and closed in the other. Since the
           * only caller is diagnostic tooling asking "what does this layer
           * actually sound like", the fader is the wrong thing to include.
           */
          /*
           * `musicTrim()` is the calibrated makeup gain for the whole music
           * bus — see `volume.ts` for the measurement that fixes its value.
           * It multiplies in here, at the one place every stem passes
           * through, so the balance the builders wrote is untouched: every
           * lane moves by exactly the same number of dB.
           *
           * NOT on the solo path, for the same reason the fader is not on it.
           * Solo asks what one LANE sounds like, pinned to unity; the makeup
           * is a property of the MIX. Including it would put a soloed lane at
           * 2.3 in amplitude, well into `ensureMasterCeiling`'s knee, so every
           * diagnostic reading — `mixaudit`, `stemprobe`, `capture --stem=` —
           * would come back through a nonlinearity, and none of the soloed
           * figures already recorded in `docs/` would still be comparable.
           */
          signal(() =>
            this.solo
              ? this.solo === id
                ? masterVolume()
                : 0
              : this.levels[id] * masterVolume() * musicTrim(),
          ),
        ),
      ),
      /*
       * Drop events nobody can hear before they reach superdough.
       *
       * `YIELD_FAR` holds a deeply-yielded lane at 0.06 rather than 0 on
       * purpose — a lane at exactly zero trips the `active` latch and gets
       * replaced with `silence` at the next rebuild, so it is not merely quiet
       * but *gone* until a bar or phrase boundary brings it back. That reason
       * is sound and this does not disturb it: the per-stem patterns in
       * `cache` are untouched and still instantly recallable. What changes is
       * only whether a voice is ALLOCATED for a hap that will be silent.
       *
       * The note on `YIELD_FAR` flagged this as an open question and "a
       * plausible contributor to the choppiness reports", needing measurement
       * rather than argument. Measured over 160 bars of a real run: 74.5
       * events per bar, of which 7.4% carried a gain of zero and another 26.5%
       * sat at or below -52dB. A THIRD of every voice allocation was for
       * something inaudible.
       *
       * The threshold is applied to `gain^2 * postgain^2` because superdough
       * runs `setGainCurve(x => x*x)`, so that product is the amplitude that
       * actually reaches the graph — comparing against the raw controls would
       * be off by a square.
       */
    );
    /*
     * `filterValues` is real at runtime but absent from `@strudel/core`'s type
     * declarations, so it needs a cast. Narrowed to the one signature used
     * rather than `as any`, so a future version that changes it fails here
     * instead of silently doing nothing.
     */
    /* ========================================================================
     * THE GROOVE, AND IT IS ONE LINE FOR THE WHOLE BAND.
     * ======================================================================
     *
     * `all(x => x.late("[0 .033]*4"))` is the last line of the reference track
     * the owner sent, and it is the difference between a sequencer and a band:
     * every voice in the piece is nudged behind the grid on alternate eighths,
     * TOGETHER. Counted across `src/audio` before this, the score had exactly
     * ONE `.late()` in it, on one line of one lane.
     *
     * `late` IS IN CYCLES, not seconds, and the existing call site has a
     * comment ("sixteen milliseconds behind the grid") that reads as though
     * somebody believed otherwise - `pattern.mjs:2081` documents the parameter
     * as "number of cycles to nudge right". A cycle here is a bar, so at the
     * 140 BPM this score is now anchored at, 1 cycle is 1.714 s:
     *
     *     0.033 cycles  = 57 ms   (the reference's value, at our tempo)
     *     0.018 cycles  = 31 ms   <- this
     *
     * An eighth note at 140 is 214 ms, so 31 ms is about 14% swing on the
     * offbeat eighths. The reference's own figure would be 26%, which is a
     * shuffle you hear as a shuffle; half-time wants the pocket rather than the
     * swing, because the whole feel depends on the hits being far apart and
     * landing exactly where the ear is waiting for them.
     *
     * `[0 0.018]*4` is eight values across the bar: the on-beat eighths stay on
     * the grid and the off-beat ones are late. Applied to the MASTER STACK, so
     * the kick, the wobble and everything else move as one - a groove that only
     * some lanes have is not a groove, it is a timing error.
     *
     * NO GAMEPLAY EFFECT. Every beat-locked system in the game reads the
     * transport (`core/transport.ts`), not the audio graph: `beatlock` gates
     * weapons on the transport's own beat, enemy volleys are scheduled in
     * beats, and none of them can see a hap's onset. Verified green after this
     * change rather than assumed.
     */
    const grooved = master.late('[0 0.018]*4');
    const filterable = grooved as Pattern & {
      filterValues(f: (v: Record<string, unknown>) => boolean): Pattern;
    };
    /*
     * The floor moves with the makeup gain, so the SET of haps dropped is
     * unchanged.
     *
     * `AUDIBLE_FLOOR`'s value is not a loudness, it is a position between the
     * two yield levels in `orchestration.ts` — `YIELD_NEAR` survives,
     * `YIELD_FAR` does not. `postgain` now carries `musicTrim()`, which is a
     * factor of 3.1 in `pg * pg`, and comparing against the raw constant
     * would have quietly promoted every `YIELD_FAR` lane back above it: the
     * measured 0.0018 becomes 0.0056 against a floor of 0.0025. That is the
     * 21% of voice allocations the floor exists to refuse, reinstated as a
     * side effect of a level change. Scaling the threshold by the same
     * constant keeps the decision where it was written — measured: 1493 haps
     * over 32 bars before the makeup and 1493 after, the identical set.
     *
     * Read per hap rather than hoisted because the makeup is not on the solo
     * path, so the scaling must not be either; a soloed render has to drop
     * exactly the haps it dropped before.
     */
    return filterable.filterValues((v) => {
      const g = typeof v.gain === 'number' ? v.gain : 1;
      const pg = typeof v.postgain === 'number' ? v.postgain : 1;
      const t = this.solo ? 1 : musicTrim();
      return g * g * pg * pg > AUDIBLE_FLOOR * t * t;
    });
  }

  reset(wave = 0): void {
    this.tensionModel.reset();
    this.arranger.reset();
    for (const id of STEM_IDS) {
      this.cache[id] = silence;
      this.levels[id] = 0;
      this.active[id] = false;
    }
    this.p.tension = 0;
    this.p.build = 0;
    this.p.openness = 1;
    this.p.drive = 0;
    this.p.thin = 0;
    this.p.concussion = 0;
    this.health = 1;
    this.energy = 0;
    this.modeBias = 0;
    this.leadRegister = 0;
    this.heard.keys.clear();
    this.heard.grooves.clear();
    this.heard.sections.clear();
    this.heard.peakEnergy = 0;
    this.highField.reset(false);
    this.encSlow = 0;
    this.grazing.reset(false);
    this.lastVoicing = [];
    this.phraseSeedVoicing = [];
    this.phraseSeedIndex = -1;
    this.wave = wave;
    this.feel = feelForWave(wave, false);
    this.homeFeel = this.feel;
    this.tonic = 57;
    this.homeTonic = this.tonic;
    this.runStartBar = -1;
    this.runPhrase = 0;
    this.act = 'exposition';
    this.tacetLane = null;
    /*
     * Start where the ladder says, not at a hardcoded default.
     *
     * `modeForTension` picks from `MODE_LADDER`, which runs brightest-first —
     * lydian at index 0, octatonic at the end — so a run beginning at zero
     * energy belongs at the top of it. This said `'aeolian'`, which is index 3,
     * and the mode is only recomputed on a phrase boundary. The measurable
     * consequence: **every run opened with eight bars in the wrong mode and
     * then modulated for no reason.** Worse, it modulated the wrong way — the
     * intro got BRIGHTER as tension rose across it, which is backwards for a
     * ladder whose whole design is that pressure darkens the harmony.
     *
     * `MODE_LADDER[0]` rather than the literal, so this cannot drift if the
     * ladder is ever reordered. It is also, incidentally, the most consonant
     * choice available: `tools/clash.mjs` scores lydian the best mode in the
     * game at 15 unresolved on-beat clashes and 78% resolution.
     */
    this.mode = MODE_LADDER[0] ?? 'aeolian';
    this.modeWave = -1;
    this.musicalWave = 0;
    this.pendingWave = null;
    this.themeStartPhrase = 0;
    this.themeBoss = false;
    this.bossArmed = false;
    // A queued modulation must not survive a restart — it would fire on the
    // first phrase boundary of the new run and move a key nothing had set.
    this.pendingTonic = null;
    this.pendingCapo = null;
    this.pivotPhrase = -1;
    this.heldForPivot = 0;
    this.tempoSnap = false;
    this.runSeconds = 0;
    this.lastOverdriveDrop = -999;
    this.bpm = 128;
    this.targetBpm = 128;
    this.boss = false;
    this.bossPhase = 0;
    this.movement = null;
    this.collapsing = false;
    this.collapseSeconds = 0;
    this.lastKey = '';
    this.started = true;
    setTempo(this.bpm);
  }

  /** Called every frame, after the transport has advanced. */
  update(snap: GameSnapshot, transport: Transport, dt: number): void {
    if (!this.started) return;
    /*
     * Arm the master ceiling.
     *
     * Here rather than in `bootAudio` because superdough builds its output
     * controller lazily, on the first sound, so at boot there is nothing to
     * splice into. After the first success this is a node-identity comparison,
     * and in Node it returns immediately. See `ensureMasterCeiling`.
     */
    ensureMasterCeiling();
    this.snapshot = snap;
    // Wall-clock for this run, used to rate-limit event-driven section forces.
    this.runSeconds += dt;

    /*
     * The run clock. See `runStartBar`.
     *
     * Stamped here rather than in `reset()` because `reset()` is not handed a
     * transport — and giving it one to set a field would put a second
     * definition of "when the run started" in a codebase whose recurring
     * defect is exactly that.
     */
    if (this.runStartBar < 0) this.runStartBar = Math.floor(transport.bar);
    this.runPhrase = Math.max(0, Math.floor((transport.bar - this.runStartBar) / BARS_PER_PHRASE));
    this.act = actForPhrase(this.runPhrase);

    /*
     * The rig's audio abilities, read once per step.
     *
     * Levels are capped at 3 to match every other stacking rule in the file,
     * and the coefficients are chosen so a maxed rig is clearly audible without
     * becoming the whole sound: REVERB reaches 0.45 of extra room, RESONANCE
     * 0.6, FERMATA 0.75, COMPRESSOR pulls levels 45% of the way to their mean.
     */
    const rig = snap.abilities ?? {};
    const lv = (id: AbilityId): number => Math.min(3, rig[id] ?? 0) / 3;
    // Latched, not applied: a key change lands on a phrase line like every
    // other one. See `pendingCapo`.
    const wantCapo = Math.min(3, rig.capo ?? 0) * 2;
    if (wantCapo !== this.capo) this.pendingCapo = wantCapo;
    this.tempoLift = Math.min(3, rig.tempo ?? 0) * 0.03;
    this.p.space = lv('reverb') * 0.45;
    this.p.ring = lv('resonance') * 0.6;
    this.p.hold = lv('fermata') * 0.75;
    this.glue = lv('compressor') * 0.45;

    if (this.collapsing) this.collapseSeconds += dt;

    const t = this.tensionModel.update(snap, dt);
    this.lastTension = t;
    this.driver = t.driver;
    /*
     * The gear change is armed when the boss actually ARRIVES, not when it is
     * telegraphed. `this.boss` is read from the snapshot here, and the -16bpm
     * offset in `updateTempo` is gated on it — so arming the snap in
     * `onBossTelegraph` set a flag that was consumed a bar later while the
     * target still had no boss offset in it, a no-op followed by the same slow
     * glide. Measured before and after that mistake, the trace was identical:
     * 130 130 127 127 127 127 127 127 127 123 123 119. Watching the flag
     * change here is the only place that lines the snap up with the change it
     * is meant to make audible.
     */
    if (snap.bossActive && !this.boss) this.tempoSnap = true;
    this.boss = snap.bossActive;
    // Consumed once the fight is real; `this.boss` carries it from here.
    if (this.boss) this.bossArmed = false;
    this.bossPhase = snap.bossPhase;
    this.movement = snap.movement;

    const arr = this.arranger.state(transport);
    this.introProgress = arr.introProgress;

    /*
     * Musical energy is NOT the same thing as danger.
     *
     * Once the game was made genuinely chill, measured tension sat below 0.2 for
     * 70% of a run — which would have left the soundtrack permanently in its
     * intro. That is backwards for a game whose entertainment is the music.
     *
     * So the arrangement runs on `energy`: danger *or* progress, whichever is
     * higher. A wave builds musically as it proceeds and each wave starts from a
     * higher floor, exactly like a set does, and combat pushes it further. A
     * player who never gets into trouble still hears the track develop.
     */
    /*
     * The floor is a BASELINE, and it must never reach the ceiling.
     *
     * This was `0.22 + wave * 0.035 + waveProgress * 0.22`, which has no cap:
     * it reaches 1.0 by wave 23 and stays there. Measured with
     * `tools/layerpop.mjs`, energy ran 0.22-0.47 at wave 2, 0.64-0.86 at wave
     * 13 and **0.86-1.00 with a mean of 0.99 at wave 21** — so from about a
     * third of the way into a run the arrangement is at full and nothing the
     * player does moves it. Every stem's `full` is between 0.5 and 0.84, so the
     * faders saturate even earlier than energy does: at waves 13 and 21 they
     * sat at 0.87-0.98 and spent 0% of the time anywhere in between.
     *
     * Eleven layers at their ceiling, continuously, for the rest of the run, is
     * a wall rather than an arrangement — and it is the same shape as the
     * powerup-saturation audit in `tools/README.md`: a contribution that
     * saturates, so the response exists in the code and not in the speakers.
     *
     * Capping the wave term at 0.2 keeps everything the floor was for — a run
     * that grows, a wave that builds as it proceeds, a track that develops for
     * a player who never gets into trouble — while leaving half the range for
     * danger to push into at every wave. `faders` reports the mix responding
     * and is not wrong; it plays from wave 1 and never leaves the opening
     * minute, so it has never been in a position to see any of this.
     */
    /*
     * Retuned against the real game, and the previous values were the single
     * biggest thing flattening the score.
     *
     * `npm run realprobe` decomposes the master signal over a 15-minute run of
     * the actual `World`. The danger terms produce a p10-p90 span of 0.490.
     * The damper in `tension.ts` takes that to 0.317. THIS LINE took it to
     * 0.238 — so more than half the dynamic range the game generates was gone
     * before a single fader saw it, and the floor alone was binding (danger
     * contributing literally nothing) in 21.6% of samples.
     *
     * The old maximum was 0.54, which sits only 0.11 under the median of the
     * signal it is supposed to be a floor for. A floor that close to the
     * middle is not a floor, it is a second signal, and it was winning.
     *
     * Swept on the real game: floor max 0.54 -> span 0.277, 0.43 -> 0.308,
     * 0.34 -> 0.343, 0.26 -> 0.343 (saturated — below this `sustained` binds
     * again, so lowering further buys nothing and only makes calm quieter).
     * 0.34 is the knee.
     *
     * What it audibly fixes: `arp` has an `in` of 0.32, so the old floor held
     * the arpeggio permanently switched ON — its median level was 0.705 and it
     * never left. A continuous arpeggio under everything is the cheap-techno
     * signature in one lane. Measured after this change its median is 0.427
     * while its peak is unchanged at 0.898, which is the difference between a
     * texture that is always there and one the arrangement decides about.
     *
     * Everything the floor was for survives: a safe player still gets a track
     * that grows across a run (0.12 to 0.36) and builds through each wave.
     */
    const progressFloor = clamp01(0.12 + Math.min(0.14, this.wave * 0.014) + snap.waveProgress * 0.1);
    this.progressFloor = progressFloor;
    this.energy = clamp01(Math.max(t.sustained, progressFloor));

    // Rhythmic intensity is energy with a floor imposed by the section, so a
    // drop stays a drop even if the player has briefly found a safe corner.
    const sectionFloor =
      arr.section === 'drop' ? 0.62 : arr.section === 'build' ? 0.3 : arr.section === 'breakdown' ? 0.05 : 0.2;
    const sectionCeil = arr.section === 'breakdown' ? 0.4 : arr.section === 'collapse' ? 0.15 : 1;
    // Overdrive shoves every driver to its top rung for its duration: the kick
    // pattern, the hat subdivision, the clap, the chord stabs and the lead gate
    // all read from these two numbers, so nothing new has to be synthesised.
    /*
     * A MOMENT, not a state — gated on the same clock as the forced drop.
     *
     * Holding OVERDRIVE used to pin `intensity` at 0.88 and `drive` at 0.8 for
     * as long as it lasted. That was right when the pickup was occasional. It
     * arrives every 9.5s and lasts 12s (see `onPickup`), so it never lapses:
     * measured, it was active in 52.8% of sampled bars, and the floors it sets
     * bypass the section machine, the stem curves and every threshold tuned
     * against the real distribution.
     *
     * These floors and the forced `drop` are two separate leaks, and they show
     * up in different meters. The arranger picks sections from `tension`,
     * which never sees OVERDRIVE — so rate-limiting the forced `drop` alone
     * moved section share (drop 64.2% -> 58.5%) and left the mix untouched,
     * and gating these floors moves the mix and leaves section share at
     * 58.5%. Measuring one while changing the other reads as a no-op; it is
     * not. Measured over 900s with the floors gated to the same clock:
     *
     *   intensity pinned >= 0.87   49.7%  ->  14.6%
     *   drive median               0.800  ->  0.383   (ceiling is 0.800)
     *   OVERDRIVE held 52.8% of the run, with arrangement authority 14.9%
     *
     * Drive sitting AT its ceiling for half the run is the concrete form of
     * "cheap techno" — a distortion parameter welded open is not an accent.
     *
     * The pickup still does everything else it did for its full duration; what
     * is bounded is only its authority over the ARRANGEMENT.
     */
    const overdrive =
      (snap.powerups.overdrive ?? 0) > 0 &&
      this.runSeconds - this.lastOverdriveDrop < OVERDRIVE_PEAK_SECONDS;
    this.intensity = clamp(Math.max(this.energy, sectionFloor, overdrive ? 0.88 : 0), 0, sectionCeil);
    this.brightness = clamp01(this.energy * 0.7 + (this.boss ? 0.3 : 0));

    /*
     * The melody climbs as the RING CLOSES, not as the ship goes up the screen.
     *
     * `playerHeight` was an honest danger proxy in a vertical shmug — up the
     * screen is where the enemies and the bullets were. In the arena the player
     * lives near the middle and that axis carries no information at all, so the
     * feature would have quietly become a coin flip driven by nothing.
     *
     * `encirclement` is the largest angular gap in the ring of enemies around
     * the player, inverted: 0 is a wide-open escape corridor, 1 is surrounded.
     * It is the right signal for this specifically because it is SLOW. Register
     * is quantised to octaves and applied at a rebuild — a melody that slides
     * continuously with the ship is a theremin, not a tune — so it needs a term
     * that changes on the timescale of a wave, not of a dodge. `nearestThreat`
     * moves several times a second and is spent below on filter openness, where
     * it can follow the action without touching a single note.
     *
     * Still one octave, not two. Two put the top of the range at MIDI 122,
     * which is shrill rather than exciting.
     */
    /*
     * NOT dropped an octave for a boss. That was tried and reverted.
     *
     * `tools/sinister.mjs` appeared to show a boss sitting at the same register
     * as a normal wave, so a `this.boss ? -12 : climbed` override was added.
     * The reading was wrong: it was the median across ALL pitched lanes, which
     * sub, bass, motor and chords dominate and none of them move. Measured on
     * the LEAD alone, `BOSS_THEME` already sits at 60 against the normal
     * theme's 67 — seven semitones lower, written into the theme itself.
     *
     * The override took it to 48, below the bass at 52 and the chords at 57,
     * so the melody played underneath its own harmony. That is mud, not
     * menace. The tool now measures the lead and prints the per-lane registers
     * beside it, so the same mistake cannot be made from the same number.
     */
    /*
     * SMOOTHED FIRST. See `encSlow` — on a treadmill the raw signal moves on
     * the timescale of a pass, and this parameter is documented as needing the
     * timescale of a wave.
     *
     * The halflife is a quarter of a bar at 128bpm and the register is applied
     * on the bar line anyway, so it costs no response at all in practice —
     * what it removes is the sub-bar excursions that a pass through a group
     * produces. `REGISTER_HALFLIFE` carries the sweep, including the value
     * that made the high octave unreachable.
     */
    this.encSlow = damp(this.encSlow, clamp01(snap.encirclement), REGISTER_HALFLIFE, dt);
    this.wantRegister = this.highField.update(this.encSlow) ? 12 : 0;
    this.grazing.update(snap.grazeRate);

    // --- health, as a musical parameter ------------------------------------
    // Counted in hits remaining across every life, not the current life's HP,
    // so the mix keeps thinning across a whole run rather than resetting each
    // time the player respawns.
    const maxHits = Math.max(1, snap.maxLives * snap.playerMaxHp);
    const hitsLeft = Math.max(0, (snap.lives - 1) * snap.playerMaxHp + snap.playerHp);
    this.health = clamp01(hitsLeft / maxHits);
    this.p.thin = damp(this.p.thin, Math.pow(clamp01(1 - this.health), 1.35), 0.7, dt);
    // Concussion: a short, violent duck after a hit. Spiked in `onPlayerHit`.
    this.p.concussion = damp(this.p.concussion, 0, 0.3, dt);

    // --- continuous params -------------------------------------------------
    this.heard.keys.add(keyLabel(this.tonic, this.mode));
    this.heard.grooves.add(FEEL_LABELS[this.feel]);
    this.heard.sections.add(this.arranger.section);
    if (this.energy > this.heard.peakEnergy) this.heard.peakEnergy = this.energy;

    this.p.tension = t.sustained;
    this.p.build = arr.buildProgress;
    this.p.drive = clamp01(Math.max(this.energy * 0.6 + arr.buildProgress * 0.25, overdrive ? 0.8 : 0));

    let openness = 0.45 + this.energy * 0.55;
    /*
     * Something close CLAMPS DOWN on the mix, in real time.
     *
     * This is where `nearestThreat` is spent — the fast danger axis, 0 when an
     * enemy is touching the ship and 1 when nothing is near. It moves several
     * times a second, which makes it useless for anything that selects notes
     * and ideal for a filter: the track physically closes as something bears
     * down on the player and opens again the moment they break away, and not a
     * single scheduled note changes.
     *
     * It is the only place in the arrangement that responds at the speed of a
     * dodge. Everything else — register, mode, section, the voice budget — is
     * quantised to bars or phrases on purpose, and that deliberate slowness is
     * what leaves room for one term that is allowed to be twitchy.
     *
     * Capped at a third so a brush past cannot mute the track.
     */
    openness *= 1 - 0.34 * (1 - clamp01(snap.nearestThreat));
    // Focusing leans the mix in slightly — a small brightening that rewards the
    // player for concentrating without announcing itself.
    if (snap.focused) openness = Math.min(1, openness + 0.08);
    if (arr.section === 'breakdown') openness *= 0.55;
    if (arr.section === 'build') openness = lerp(openness * 0.6, 1, arr.buildProgress);
    if (this.collapsing) openness = 0.02;
    // Getting hit slams the filter shut for a moment. It reads as the wind
    // being knocked out of the track, and it makes damage impossible to miss.
    openness *= 1 - this.p.concussion * 0.82;
    this.p.openness = damp(this.p.openness, clamp01(openness), this.collapsing ? 0.35 : 0.16, dt);

    // --- faders ------------------------------------------------------------
    /*
     * `barsIn` is floored to the bar, so each of these holds for a whole bar
     * and then releases on its own. A drop is at least `MIN_BARS.drop` = 4
     * bars long, so the gap and the slam always both fit inside one.
     */
    this.dropPhase =
      arr.section === 'drop' && arr.barsIn <= 1 && !this.collapsing ? arr.barsIn : -1;
    this.updateLevels(this.energy, arr.section, snap, dt);

    // --- bar-quantised structural work -------------------------------------
    if (transport.crossedBar()) {
      /*
       * The melody transposes on a bar line, never mid-bar.
       *
       * The register is latched against the ship's height, but the ship crosses
       * the latch wherever it happens to be — so the tune could jump an octave
       * in the middle of a phrase, which reads as the melody breaking off rather
       * than as it climbing. Holding the change to the bar costs at most a bar
       * of response and is where a player would move a line anyway. It is free
       * now that the register is `sig.register`: no rebuild is involved, so
       * there is nothing to gain by applying it sooner.
       */
      this.leadRegister = this.wantRegister;
      this.arranger.onBar(transport, this.energy, this.runPhrase);
      this.updateHarmony(transport, this.energy);
      this.updateTempo(this.energy);
      this.rebuildIfNeeded(transport);
    } else if (this.lastKey === '') {
      // First frame of a run: get something playing without waiting for a bar.
      this.rebuildIfNeeded(transport);
    }

    this.drainRebuild();
  }

  private updateLevels(tension: number, section: SectionName, snap: GameSnapshot, dt: number): void {
    /*
     * A drop is defined by having everything in it. Gating purely on measured
     * stress meant a competent player who kept the screen tidy got a drop with
     * no lead in it, which is not a drop.
     *
     * The floor is 0.50, down from 0.64, and the old value was flattening the
     * whole rhythm section.
     *
     * The real game's energy has a median of 0.622 (`npm run realprobe`), so a
     * floor of 0.64 sat ABOVE the middle of the signal it was clamping. Inside
     * a drop — and `drop` is the longest section, roughly half the run — every
     * stem therefore received a constant instead of a level. Correlating each
     * lane's level against energy over a real run showed the damage: kick
     * r=+0.07, hats +0.10, bass +0.11. The entire rhythm section was deaf to
     * intensity, playing the same way whether the player was safe or one hit
     * from dead. That is what a drum machine does, and it is a large part of
     * what "cheap techno" means — the melodic lanes tracked fine (chords +0.61,
     * lead +0.53), so the mix was expressive on top and rigid underneath.
     *
     * Swept on the real game (kick / bass / chords r):
     *   0.64 -> +0.12 / +0.13 / +0.61      0.56 -> +0.18 / +0.27 / +0.73
     *   0.50 -> +0.25 / +0.41 / +0.79      0.44 -> +0.33 / +0.52 / +0.83
     *
     * It keeps improving all the way down, because the floor's whole job is to
     * destroy information. 0.50 is chosen rather than 0.44 because the floor
     * does have a real purpose: every stem's `in` threshold except `sub`'s
     * 0.44 lies below 0.50, so a drop still guarantees the full band arrives,
     * which is the thing the original comment was protecting. Below that the
     * guarantee starts to go.
     */
    /*
     * The intro gets a floor too, because otherwise its design never happens.
     *
     * `INTRO_ENTRY` encodes a deliberate order — when this was written, pad and
     * sub from bar 0, the tune at 16% ("a tune that arrives a third of the way through its own
     * introduction has not been introduced"), drums after. But levels are
     * `stemLevel(id, gate) * introGate(...)`, and at the start of a run
     * `tension` sits near `progressFloor`, around 0.15. `STEM_CURVES.lead.in`
     * is 0.2, so `stemLevel` returned ZERO for the melody no matter what
     * `introGate` said, and the whole entry order was multiplied by a curve
     * that had not opened yet.
     *
     * Measured before this: the first 7.5 seconds of a run were a pad at 0.29
     * and nothing else, with the lead arriving at 9s. (The pad is deleted now
     * — `buildChords` — and the order is sub, bass, stab, motor, kick, tune;
     * the floor below is unchanged and still what lets that order be heard.) The file's own note says
     * a bar of silence after pressing start "reads as the game failing to boot
     * rather than as an intro" — this was seven seconds of nearly that.
     *
     * The floor gives the curves something to open against and leaves
     * `introGate` in charge of ORDER, which is the division of labour the two
     * were written for.
     */
    const gate =
      section === 'drop' ? Math.max(tension, 0.5)
      : section === 'intro' ? Math.max(tension, INTRO_GATE_FLOOR)
      : tension;

    /*
     * Levels are now computed in two passes rather than one.
     *
     * The first pass is what was always here: each stem asks for a level based
     * on tension, the section, the movement and its own event rules. The second
     * pass is `orchestration.allocate`, which reads all eleven answers together
     * and decides which of the *tonal* lanes actually gets the foreground.
     *
     * That decision cannot be made stem by stem, which is why the mix had this
     * problem for fourteen iterations: every layer was individually correct
     * about whether it wanted to play, and nothing was responsible for the fact
     * that five of them wanting to play at once is a texture no listener can
     * follow. See `orchestration.ts` for the whole argument.
     */
    const wants = {} as Record<StemId, number>;

    /*
     * Which lane is resting this phrase. See `TACET_ROTA`.
     *
     * Keyed on the RUN phrase rather than the transport's, so the rota starts
     * at the top of every run instead of wherever the page clock happens to be
     * — the same reason the acts are counted from `runStartBar`.
     *
     * `sustain` only. A `drop` is defined by having everything in it; a
     * `breakdown` already zeroes three lanes and a second rule fighting it
     * would be two definitions of the same gesture; a `build` is a promise and
     * an `intro` is already staged. Sustain is where the bars are and it is the
     * second-densest section in the mix, which is exactly the combination that
     * makes it the right place to spend a rest.
     */
    const tacet =
      section === 'sustain'
        ? MusicDirector.TACET_ROTA[this.runPhrase % MusicDirector.TACET_ROTA.length]
        : null;
    this.tacetLane = tacet;
    const shape = ACT_SHAPE[this.act];

    for (const id of STEM_IDS) {
      // Continuous, not a switch. See STEM_CURVES for why this matters.
      let want = stemLevel(id, gate);

      // Section overrides. A breakdown is defined by what it removes.
      if (section === 'breakdown' && (id === 'kick' || id === 'clap' || id === 'bass')) want = 0;
      /*
       * THE BUILD SUBTRACTS. Before this the build only ADDED — a timpani
       * crescendo, openness rising to 1, no fader reduced — so it was the
       * densest part of the arrangement and the drop after it could only be
       * quieter by comparison. The genre empties the bottom before the drop:
       * sub and bass fade out over the last 40% of the build, and the drop's
       * downbeat is the first bass note in seconds. `docs/research-dubstep.md`
       * R10. Linear ramp on `buildProgress`, which is 0..1 across the build.
       */
      if (section === 'build' && (id === 'sub' || id === 'bass')) {
        want *= 1 - clamp01((this.p.build - 0.6) / 0.4); // `this.p.build` is `arr.buildProgress`, set each tick above
      }
      // The intro admits one layer at a time rather than muting everything and
      // then dumping the whole arrangement in at once.
      if (section === 'intro') want *= introGate(id, this.introProgress);

      /*
       * Movement overrides sit ABOVE the section's, and below nothing.
       *
       * A movement is announced by a banner and lasts a whole wave, so it is
       * the coarsest thing in the mix — but it must not resurrect a layer the
       * section has deliberately silenced, or a breakdown inside a HUSHED wave
       * would put the kick back. Multiplying rather than assigning keeps every
       * `want = 0` above it final.
       */
      if (this.movement) want = clamp01(want * (MOVEMENT_MIX[this.movement][id] ?? 1));

      // Event-driven layers ignore tension entirely.
      /*
       * fx follows intensity, and until now it did not.
       *
       * This line was `want = <section> ? 0.58 : 0.3` — a two-valued switch
       * that discarded whatever `stemLevel` had just computed, which made the
       * whole `fx` entry in `STEM_CURVES` dead code. Measured against a real
       * run the lane correlated +0.11 with energy while having 0.26 of level
       * available to move through: it had room and did not use it, because
       * nothing was asking it to. A lane that takes two values by section is
       * the on/off threshold this file keeps warning against, and `fx` carries
       * the risers, fills and impacts — the things whose entire job is to say
       * "this is getting bigger".
       *
       * Now the section decision is a MULTIPLIER over the curve instead of a
       * replacement for it, so the original intent survives (fx leans in
       * during a build, a drop and the collapse, and sits back otherwise)
       * while the lane still tracks how dangerous things actually are.
       *
       * It also comes out slightly quieter on average, which the note on the
       * `fx` curve in `layers.ts` explicitly wants: noise sitting above the
       * melody is what eats a mix's clarity.
       */
      if (id === 'fx') want *= section === 'build' || section === 'drop' || section === 'collapse' ? 1 : 0.55;
      if (section === 'collapse' && id === 'fx') {
        /*
         * The wash has to settle, or the run has no ending — only a fade.
         *
         * On death the arrangement fades out over about four seconds, which is
         * a good gesture. What was left afterwards was this noise lane holding
         * at 0.58 over a sub drone at 0.13 — indefinitely. The loudest thing in
         * the final mix was undirected noise and it never resolved, so a run did
         * not finish so much as stop being played. Decaying it over six seconds
         * leaves the sub's tonic as the last thing standing, which is a full
         * stop rather than a held breath.
         */
        want *= 1 - 0.8 * clamp01(this.collapseSeconds / 6);
      }
      if (id === 'motifs') {
        /*
         * Scale with the battlefield — then get out of the way of it.
         *
         * The motif layer voices "these archetypes are present". Since every
         * volley now also plays a pitched note, a busy screen says the same
         * thing twice: the loop and the shots are both describing the same
         * enemies. So the loop yields as the shots take over. Quiet stage, the
         * motifs carry it; loud stage, the shooting does, and the loop steps
         * back to a bed.
         *
         * Fourteen iterations of only ever adding voices produced a mix where
         * nothing ever stopped playing. Subtraction is a feature.
         */
        /*
         * Flatter than it looks like it should be, on purpose.
         *
         * A busy stage has both more enemies *and* more shots, so a presence
         * term that climbs steeply with count grows faster than the yield can
         * pull it back — measured, the loop got *louder* on busy stages, which
         * is the opposite of the intent. The goal is constant enemy presence
         * whose *composition* shifts: quiet stage, the loop carries it; loud
         * stage, the shooting does.
         */
        const presence = clamp01(0.3 + remap(snap.enemyCount, 1, 10, 0, 0.3) + clamp01(snap.enemyThreat) * 0.16);
        /*
         * Recalibrated: enemy volleys now run mean 1.37, max 7.6 per second.
         *
         * The old 0.3-1.5 window was measured when volleys peaked near 1.85, and
         * that comment is still in the git history as evidence of doing this
         * right at the time. The game moved — more enemies, and a higher armed
         * fraction — and the window did not, so the yield saturated at ordinary
         * fire rates: the motif layer averaged a 54% cut rather than stepping
         * back only when the shooting genuinely took over. It is the layer that
         * voices which musicians are on stage, and it was running at half
         * strength nearly all the time.
         *
         * The window is 0.3-2.5, not 0.3-4. The first version of this threshold
         * was too high and never engaged; 0.3-1.5 was too low and never
         * disengaged; 0.3-4 left the motif layer measuring *louder* on a busy
         * stage than a quiet one, 0.48 against a 0.484 limit — passing the
         * subtraction check by four thousandths, which is not passing it. 2.5
         * sits between the fire rate's mean and its peak, so the yield engages
         * during real pressure and releases the rest of the time.
         */
        const yieldToFire = 1 - clamp01(remap(snap.enemyFireRate, 0.3, 2.5, 0, 0.6));
        want = snap.enemyCount > 0 ? presence * yieldToFire : 0;
      }

      /*
       * The player's own arpeggio outranks the machine's — but keyed to focus,
       * not to firing.
       *
       * This was `if (snap.playerFiring) want *= 0.62`, and in a bullet hell the
       * fire button is held down: measured across 789 samples of real play,
       * `playerFiring` was true 100% of the time. A rule written as a dynamic
       * response was a permanent 38% cut, and it capped the arp at 0.44 against
       * a ceiling of 0.76 — more than half the layer's range was unreachable.
       *
       * Focus does vary, and it is the better cue anyway: focused fire is a
       * purer tone an octave down, sitting exactly where the arp lives, so
       * that is the moment the machine should step back.
       */
      if (id === 'arp' && snap.focused) want *= 0.7;
      if (id === 'power') {
        /*
         * The fade lives in the fader, not in the pattern's gain.
         *
         * Putting it inside the pattern made the score panel report 0.79 while
         * the layer was near-inaudible — the third time in this project that a
         * readout has drifted from what is actually being played. If the panel
         * says a lane is loud, the lane has to be loud.
         *
         * Powerup voices sit back as the music gets busy: a heartbeat is
         * something you notice in the quiet.
         */
        const room = 1 - clamp01(remap(this.intensity, 0.35, 0.85, 0, 0.62));
        want = hasVoicedPowerup(snap.powerups, snap.bombs) ? 0.8 * room : 0;
      }
      /*
       * The sub is no longer floored on.
       *
       * This was `Math.max(want, 0.22)` — an unconditional floor that made the
       * lane permanently audible regardless of its own curve, which is what
       * turned it from an accent into a bed. Removing the floor is most of what
       * makes `STEM_CURVES.sub`'s new band mean anything at all; leaving it in
       * would have overridden the change entirely.
       *
       * The collapse still gets its drone: on death everything else is being
       * taken away and the sub's tonic is the last thing standing, which is the
       * full stop at the end of a run.
       */
      /*
       * COLLAPSE, APPLIED LAST, because it was being undone.
       *
       * This rule used to sit up with the other section overrides, forty lines
       * above the per-lane blocks — and two of those blocks ASSIGN rather than
       * multiply, so they wrote straight over the zero. Measured four seconds
       * after a real game over: sub 0.11 and fx 0.16 as intended, but motifs
       * at 0.35-0.61 and power at 0.69 — the two loudest lanes on the screen
       * were the two the collapse was supposed to silence. `motifs` survives
       * whenever enemies are still on the field, which at a death is always,
       * and `power` whenever a powerup is still running.
       *
       * The band is meant to stop. Stating the whole rule once, after every
       * per-lane override rather than before them, is what makes it true —
       * and it puts the collapse's three cases in one place instead of two
       * lines forty apart.
       */
      if (section === 'collapse') want = id === 'fx' ? want : id === 'sub' ? 0.3 : 0;

      /*
       * THE FORM RESERVES THE SUB, and it attenuates rather than muting.
       *
       * "A form is largely a schedule of things you have not used yet", and
       * before this the only reserved material in the entire system was the
       * boss leitmotif — reserved by EVENT rather than by position in the run.
       * The sub is the right thing to hold back: it is the only source in the
       * 63 Hz octave apart from the kick, so withholding it is a change to the
       * spectrum a listener feels rather than a change to the note count, and
       * it gives the development somewhere to arrive from.
       *
       * 0.3 rather than 0, and the difference is not cosmetic. `postgain` is
       * squared by `setGainCurve(x => x*x)`, so a 0.3 multiplier on the fader
       * is 0.09 on the energy — about 21 dB down, which is reserved by any
       * musical standard. A hard zero would additionally take the lane's
       * `active` latch down, `drainRebuild` would replace its cache with
       * `silence`, and the lane would then be un-soloable: `tools/mixaudit.mjs`
       * pins each stem to unity in turn and would report the sub as a DEAD
       * LAYER for the whole of its three-minute run, which sits entirely
       * inside the exposition. That is a real property of this architecture and
       * not a gate being worked around — a lane at exactly zero is *gone*, not
       * quiet, and cannot return until the next rebuild.
       */
      /*
       * ...AND IT IS 0.8 NOW, NOT 0.3. The form still reserves the bottom
       * octave; it no longer reserves it by taking it away.
       *
       * Everything above is right about WHY the sub is the thing to hold back —
       * it is the only source in the 63 Hz octave apart from the kick, so
       * withholding it is a change to the spectrum rather than to the note
       * count. It is wrong about how much, now that the genre is dubstep. 0.3
       * on the fader is 0.09 on the energy, about 21 dB, and stacked on the old
       * `STEM_CURVES.sub` (`in: 0.44`, ceiling 0.52) it meant the first three
       * minutes of every run had no bottom octave at all. The owner heard
       * exactly that: "its missing a base,/ kick".
       *
       * 0.8 is -1.9 dB of fader and -3.9 dB of energy. Audible as the
       * exposition being a little less deep than the development, which is what
       * an arc dial is supposed to be, and it cannot make the lane absent.
       *
       * `ActShape.sub` therefore still does something and is still a live
       * field, which is the other reason for a multiplier rather than deleting
       * the reservation outright: a boolean that is true in all four rows is
       * dead content wearing a design's clothes.
       */
      if (id === 'sub' && !shape.sub) want *= 0.8;

      // The low end is where health lives. As the player gets hurt the bottom
      // of the mix is pulled out from under them; combined with the rising
      // high-pass on the upper layers, a badly hurt run sounds thin and
      // brittle without anyone having to read a number.
      if (id === 'sub' || id === 'bass' || id === 'kick') want *= 0.44 + 0.56 * this.health;

      // Everything ducks for a moment after a hit.
      want *= 1 - this.p.concussion * 0.5;

      /*
       * THE BAND. Added last, and added rather than multiplied.
       *
       * Every ability in this game is named for a musician and the HUD calls
       * the panel THE BAND, but until now no instrument touched the score —
       * recruiting a cellist changed the bullets and left the music
       * bit-identical. `ENSEMBLE_MIX` gives each instrument the lane it is
       * named after, so a SNARE ROLL thickens the snare and a ROSIN BOW
       * sustains the harmony.
       *
       * Added, so a lane the player has staffed is present even when tension
       * is low — that is the whole point, a recruited musician plays. Capped at
       * 0.18 and rising as a square root, so it stays a colour on the
       * arrangement rather than a second volume system competing with the
       * curves. It goes after the health and concussion terms deliberately: a
       * full band should not undo the mix thinning out when the player is
       * nearly dead.
       */
      /*
       * ...but NOT during the collapse, and this was a real bug.
       *
       * The death sequence zeroes every lane except `fx` and `sub` at the top
       * of this loop. This line runs 150 lines later and ADDS, so a staffed
       * lane came straight back: measured, the first time anyone exercised a
       * player death, the collapse still had `clap:0.12 chords:0.12 arp:0.15`
       * — the snare, the bow and the pizzicato, i.e. precisely the lanes THE
       * BAND puts musicians on.
       *
       * Being added late is right for every other term here. Health and
       * concussion are dynamics, and a recruited musician should play through
       * them. A collapse is not a dynamic — it is the arrangement being taken
       * away, the one moment the score is supposed to stop — and a band that
       * keeps playing through the player's death is the wrong statement
       * however good the reason for the ordering was.
       *
       * Nobody found this by reading, and nothing found it for a day: `session`
       * reports five sections and `collapse` is not among them, because the
       * player is functionally immortal (see `deadhunt`'s horizon work) so the
       * death path is unreachable in normal play. An unreachable path is still
       * a path.
       */
      if (section !== 'collapse') want += ensembleLift(snap?.abilities, id);
      // ...and then the whole mix comes down a little as the band grows, so a
      // full ensemble is richer rather than louder. See `ensembleTrim`: without
      // it, worst-case amplitude runs past unity and there is no limiter.
      want *= ensembleTrim(ensembleSize(snap?.abilities));

      /*
       * THE TACET, APPLIED LAST, for exactly the reason the collapse is.
       *
       * The note forty lines above records what happened the first time a
       * "this lane is silent" rule was stated before the per-lane blocks: two
       * of them ASSIGN rather than multiply and wrote straight over the zero,
       * so the two loudest lanes on the death screen were the two the collapse
       * existed to remove. `ensembleLift` ADDS, twenty lines above this, and
       * `clap`, `bass` and `kick` are all lanes THE BAND staffs (SNARE ROLL,
       * DRONES/BLACKHOLE, NOVA/TIMPANI) — so a tacet stated any earlier would
       * have been silently undone for any player holding those instruments,
       * and only for them. That is the same bug in a new costume, and
       * `tools/sections.mjs` says the hazard is structural rather than
       * incidental: state the rule once, after everything.
       *
       * A hard zero is right here, unlike the sub's reservation above, because
       * this one is transient by construction — the rota moves every phrase and
       * the lane is named in the structure key, so leaving a tacet forces the
       * rebuild that brings the part back on the phrase line.
       */
      if (id === tacet) want = 0;
      /*
       * THE PLAYER'S OWN TACET, applied after the arrangement's, and last of
       * everything for the reason the two rules above it are.
       *
       * `GameSnapshot.tacetStems` is the one channel by which an ITEM reaches
       * into the mix — TACET (`tremolo`) takes a lane out and banks the silence,
       * REST (`nova`) takes the whole band out for the bar it is invulnerable.
       * `SILENCEABLE_STEMS` keeps `sub`, `hats`, `fx` and `power` out of reach,
       * so what is left is a drone rather than digital silence: the cost has to
       * read as the band stopping and not as the audio crashing.
       *
       * A hard zero, like the rota's, and for the same reason: it is transient
       * by construction — the world rebuilds the array from state every step
       * and clears it on death — so there is nothing here that can stick.
       *
       * `includes` over an array of at most seven strings, once per lane per
       * frame. The guard in front of it is what makes the ordinary case (nobody
       * holding either item) a single length check.
       *
       * MEASURED AT THE FADER, in a real browser, with TACET and REST both at
       * their ceiling — 3,810 frames, 2,360 of them with something hushed:
       *
       *     lane      fader while hushed    otherwise
       *     arp                   0.0041       0.3220
       *     clap                  0.0048       0.6684
       *     kick                  0.0143       1.1726
       *     chords                0.0341       0.8975
       *     lead                  0.0270       0.8439
       *     motifs                0.0025       0.7414
       *     bass                  0.0169       0.5095
       *     sub / hats / fx / power   never hushed
       *
       * The residue is the fader glide rather than a leak. Recorded because the
       * chain from an ITEM to a lane crosses three files and nothing in
       * `tools/` walks it: everything node-only stops at the snapshot, and a
       * mute that never reached this line would be an item whose entire
       * identity was a comment.
       */
      if (snap.tacetStems.length > 0 && (snap.tacetStems as readonly string[]).includes(id)) {
        want = 0;
      }

      wants[id] = want;
    }

    /*
     * Second pass: who actually gets the foreground.
     *
     * The multiplier comes back as 1 for a lane that won a slot and a small
     * fraction for one that did not — never zero, because a lane that vanishes
     * and reappears is a cut, and cuts are what this project has spent its life
     * removing. The damping below turns the multiplier into a fade of about
     * half a second either way.
     */
    const mult = allocate(wants, {
      section,
      boss: this.boss,
      hushed: this.movement === 'hush',
      soloist: this.movement === 'elite',
      // How many parts may sound at once: the arrangement's wish, capped by
      // how many musicians have actually been recruited. See `allocate`.
      ensemble: ensembleSize(snap?.abilities),
      /*
       * ...and narrowed by how far into the run we are. The ceiling ramp: the
       * opening is a smaller band than the endgame by the FORM's decision
       * rather than by how many cards the player has taken. See `ACT_SHAPE`.
       *
       * EXCEPT ON A HUSHED WAVE, and that exception was measured rather than
       * reasoned. HUSHED is the one movement in the game built out of absence:
       * `MOVEMENT_MIX` already takes the kit to 0.1-0.28 and pushes the stab
       * (the pad, before `buildChords` lost it) and the tune up, and `rankTonal` hands the spare slot to the ARP because
       * there are no enemies worth voicing. Stacking the act's reservation on
       * top of that took the arp out too — and the arp is the movement's air
       * source, so the thing HUSHED is supposed to open closed instead.
       *
       * `tools/movements.mjs`, which measures each movement against ordinary
       * waves sampled in the same run: HUSHED's low/air ratio ran 3.02 against
       * an ordinary 2.41-2.78 at HEAD (already the wrong way by 20% against a
       * 13% control band — a pre-existing failure), and 4.44 against 2.03-2.35
       * with the delta applied, which is the wrong way by 54%. Two subtractions
       * of the same lane are not twice the gesture; they are the gesture
       * cancelling itself.
       */
      budgetDelta: this.movement === 'hush' ? 0 : shape.budget,
      /*
       * THE LONG ROTA — which parts are out for this stretch of the run.
       *
       * A unit of three waves, about 54 seconds, cycling over four slots whose
       * CONTENTS are chosen by the act. Every other clock in the score is
       * shorter than 80 s and none of them accumulates; this one is the game's
       * own answer to the `mask("<x ~ x ~ ~>/128")` that gives the reference
       * corpus its long form. See `orchestration.longRest`.
       *
       * Suppressed on a HUSHED wave for the same reason `budgetDelta` is: the
       * movement is already built out of absence and two subtractions of the
       * same lane are the gesture cancelling itself. Suppressed during a boss
       * inside `longRest` itself, where the reason belongs.
       */
      resting: this.movement === 'hush' ? [] : longRest(this.act, this.wave, this.boss),
    }, this.tonalHeld);

    /*
     * COMPRESSOR, applied to the level SET rather than to any lane.
     *
     * "Heavy — glued, dense, nothing peaks." That is a statement about the
     * relationship between the parts, not about any one of them, so there is
     * nothing sensible to hang it on inside a builder: a compressor pulls the
     * loud things down toward the quiet ones until the mix reads as one body.
     * Here that is literally a lerp of every stem toward the mean of the
     * stems that are actually sounding.
     *
     * The mean is taken over AUDIBLE stems only. Including the silent ones
     * would drag the mean toward zero and make the ability a volume cut, which
     * is the opposite of gluing — and it would get quieter the more sparse the
     * arrangement was, which is exactly backwards.
     */
    let glueMean = 0;
    if (this.glue > 0) {
      let sum = 0, n = 0;
      for (const id of STEM_IDS) {
        const t = wants[id] * (mult[id] ?? 1);
        if (t > AUDIBLE_FLOOR) { sum += t; n++; }
      }
      glueMean = n ? sum / n : 0;
    }

    for (const id of STEM_IDS) {
      let target = wants[id] * (mult[id] ?? 1);
      if (this.glue > 0 && target > AUDIBLE_FLOOR) {
        target += (glueMean - target) * this.glue;
      }
      /* ======================================================================
       * THE GAP AND THE SLAM. See `dropPhase`.
       * ==================================================================== */
      if (this.dropPhase === 0) {
        /*
         * BAR ONE OF EVERY DROP: the arrangement stops.
         *
         * `sub` is not merely spared, it is PUSHED — to 0.9, well above any
         * ceiling `STEM_CURVES` would give it. A bar of nothing but the low
         * sine under the room tail is the sub drop, and it is the half of this
         * gesture that makes the next bar land: the ear needs something to
         * measure the silence against or it reads as a dropout.
         *
         * `fx` is spared at its own level so the crash and the room tail from
         * the section boundary ring through the hole instead of being cut off
         * by it.
         *
         * NOT A HARD ZERO for anything else, and the reason is architectural
         * rather than musical — the sub's reservation forty lines above states
         * it in full. A lane at exactly zero drops its `active` latch,
         * `drainRebuild` replaces its cached pattern with `silence`, and it
         * cannot return until the next rebuild — so a hard zero here would not
         * be a one-bar gap, it would be a lane leaving for the rest of the
         * phrase. 0.03 is the floor and it is -60 dB after `postgain` squares
         * it: inaudible, and still comfortably above the 0.02 the latch
         * watches.
         *
         * The `target > 0.05` guard preserves every hard zero written above —
         * the tacet rota, the player's TACET/REST items, the breakdown's kit —
         * so this cannot resurrect a lane something else has silenced.
         */
        if (id === 'sub') target = Math.max(target, 0.9);
        else if (id !== 'fx' && target > 0.05) target = Math.max(target * 0.06, 0.03);
      } else if (this.dropPhase === 1) {
        /*
         * BAR TWO: the heaviest bar in the track.
         *
         * The three lanes that carry weight get a quarter more than the
         * arrangement asked for, clamped. Everything else simply arrives at
         * full at once, which after a bar at -60 dB is the whole gesture — the
         * lift is there so that the bar is measurably bigger than the drop's
         * own third and fourth bars rather than merely un-muted.
         */
        if (id === 'bass' || id === 'kick' || id === 'sub') target = clamp01(target * 1.25);
      }
      /*
       * THE TWO DROP BARS SET THE LEVEL INSTEAD OF DAMPING TOWARD IT.
       *
       * `LEVEL_RELEASE` is a 0.75 s halflife and a bar at 140 BPM is 1.71 s, so
       * a damped gap would spend its first half fading out — which is a duck,
       * and a duck is the thing a drop is not. `LEVEL_ATTACK` is 0.22 s, gentle
       * enough that the slam's downbeat would arrive at about half level and
       * grow into itself.
       *
       * These are the only two bars in the run where a level is assigned. Every
       * other transition in this file is damped on purpose, because "a lane
       * that vanishes and reappears is a cut, and cuts are what this project
       * has spent its life removing" — the exception is legitimate exactly
       * because here the cut IS the music, it is quantised to the bar, and it
       * lasts one of them.
       */
      this.levels[id] =
        this.dropPhase >= 0
          ? target
          : damp(
              this.levels[id],
              target,
              target > this.levels[id] ? LEVEL_ATTACK : LEVEL_RELEASE,
              dt,
            );

      // `active` only decides whether a pattern is worth *building*; the latch
      // deadband stops a level hovering near zero from thrashing rebuilds.
      if (!this.active[id] && this.levels[id] > 0.06) this.active[id] = true;
      else if (this.active[id] && this.levels[id] < 0.02) this.active[id] = false;
    }

    /*
     * Give the tune its octave back.
     *
     * Both lanes can win a slot, and when they do they are in each other's
     * register. Damped toward the target over about a second, because the fix
     * for one part covering another must not itself be an audible jump.
     */
    this.arpOctave = damp(
      this.arpOctave,
      arpDisplacement(this.levels.lead, this.levels.arp),
      1.4,
      dt,
    );
  }

  private updateHarmony(transport: Transport, tension: number): void {
    // Mode moves only at phrase boundaries: changing the scale every bar sounds
    // like indecision rather than escalation.
    if (!transport.crossedPhrase()) return;
    this.phraseIndex++;

    /*
     * The tune's boss flag turns HERE, with the mode, and nowhere else.
     *
     * `bossChanged` is read before the latch moves, because entering or
     * leaving a fight has to count as a boundary in its own right. Without
     * that, the exit was broken in the mirror image of the entry: the boss
     * branch below sets `modeWave = period` on every phrase of the fight, so
     * the moment it ended `waveHeld` was true and the early return kept
     * `harmonicMinor` running under the ordinary theme until the tune next
     * changed — a normal theme playing in boss harmony, sometimes for a whole
     * period.
     */
    const wantBossTheme = this.boss || this.bossArmed;
    const bossChanged = wantBossTheme !== this.themeBoss;
    this.themeBoss = wantBossTheme;

    /*
     * A MODULATION WAITS FOR ITS OWN ANNOUNCEMENT.
     *
     * `onWaveStart` arms `pendingTonic` and this method spends it on the very
     * next phrase line. The pivot is written into the last bar of the phrase
     * (see `buildSlots`), so if the wave happens to start DURING that bar there
     * is nowhere left to put it and the key moves unprepared. Measured off the
     * haps over four twenty-minute runs, that is about one modulation in eight
     * — small, and it is the difference between "usually announced" and
     * "announced", which is the difference between a device and an accident.
     *
     * So the handover is held for one more phrase when the pivot did not get
     * built for the phrase that just ended. Held ENTIRELY — tonic, capo and
     * wave together — rather than just the tonic, because forty lines below
     * this file insists the key, the mode and the tune "all turn together", and
     * deferring one of the three would break that to fix something smaller.
     *
     * Two escapes, both mandatory:
     *
     *   - `bossChanged` overrides it. A fight starting or ending is a boundary
     *     in its own right and the leitmotif's mode has to turn on the bar the
     *     tune does; a deferred handover would open a fight in the wrong scale,
     *     which is the exact desync `bossArmed` exists to remove.
     *   - A hard cap of two phrases. A modulation must never be LOST, and a
     *     condition that can only be satisfied by a rebuild is a condition that
     *     can in principle never be satisfied. After two phrases the key moves
     *     whether or not anything announced it.
     */
    const endedPhrase = Math.floor(transport.bar / BARS_PER_PHRASE) - 1;
    if (
      this.pendingTonic !== null &&
      !bossChanged &&
      this.pivotPhrase !== endedPhrase &&
      this.heldForPivot < 2
    ) {
      this.heldForPivot++;
      this.modeBias *= 0.72;
      return;
    }
    this.heldForPivot = 0;

    /*
     * A PHRASE BOUNDARY IS NOT ENOUGH. The mode also has to hold for the whole
     * WAVE, because the wave is what chooses the tune.
     *
     * Measured over an 8-minute run: 21 mode changes (one per 12.2 bars) and 16
     * wave changes (one per 16 bars), on separate clocks. The longest unbroken
     * run of the same (mode, key, theme) in the entire run was 16 bars — two
     * phrases, and usually one. So a theme was stated in one colour, and then
     * continued in another before it could ever be restated in the first.
     *
     * Recognition is statement plus restatement. A tune heard once and then
     * recoloured is not a tune the listener can learn, however well written it
     * is — which is why this is worth fixing BEFORE rewriting a single note.
     * `themeForWave` changes per wave, so the mode now waits for the wave too:
     * the choice is still made on a phrase line, it just cannot be made twice
     * inside one wave.
     */
    /*
     * Latched to the THEME's unit, not the wave's. `themeForWave` holds a tune
     * for two waves, so a mode that turned every wave would recolour the tune
     * halfway through its own restatement — which is the exact desync this
     * whole change exists to remove, reintroduced one level down.
     */
    const period = Math.floor(this.musicalWave / 2);
    const waveHeld = period === this.modeWave;
    // The tonic obeys the same rule — see the note in `onWaveStart`. Applied
    // before the mode is chosen so both halves of the key land on one boundary.
    if (this.pendingTonic !== null) {
      this.tonic = this.pendingTonic;
      this.pendingTonic = null;
      this.lastKey = '';
    }
    // The capo rides with the tonic — both are the key, and they must not turn
    // on different bars or one held run becomes two.
    if (this.pendingCapo !== null) {
      this.capo = this.pendingCapo;
      this.pendingCapo = null;
      this.lastKey = '';
    }
    // The tune turns on the same line as the key. See `musicalWave`.
    if (this.pendingWave !== null) {
      const wasTheme = Math.floor(this.musicalWave / 2);
      this.musicalWave = this.pendingWave;
      this.pendingWave = null;
      // Restart the development clock when the TUNE changes, not when the wave
      // does — a theme spans two waves. See `themeStartPhrase`.
      if (Math.floor(this.musicalWave / 2) !== wasTheme) {
        this.themeStartPhrase = Math.floor(transport.bar / BARS_PER_PHRASE);
      }
    }
    /*
     * The ladder is climbed on a curve, not linearly.
     *
     * Measured over a straight five-minute run: phrygianDominant 40% of the
     * time, locrian 27%, phrygian 16%, aeolian 13%, dorian never once. Eighty
     * three percent of a run in the darkest four modes, and the bright end of a
     * palette that exists was simply never heard — the harmonic version of "it
     * constantly full throttles all sound type channels".
     *
     * Linear mapping is why: tension only has to reach 0.5 to land on
     * phrygianDominant, and ordinary combat sits there. Raising tension to a
     * power widens the bottom of the ladder, so calm play is dorian, ordinary
     * play is aeolian, and the dark colours are held back for genuine trouble.
     * That is the same dynamic-range argument the stem curves are built on,
     * applied to harmony instead of level.
     */
    const t = Number.isFinite(tension) ? clamp01(tension) : 0;

    /*
     * A boss is not a darker point on the ladder. It is off the ladder.
     *
     * This used to clamp the tension index upward during a fight, so a boss
     * sounded like ordinary play in trouble — the same six modes the rest of
     * the run cycles through, entered from a higher rung. That is escalation
     * without identity, and it is why bosses did not announce themselves.
     *
     * `harmonicMinor` appears nowhere else in the game (it is deliberately not
     * in MODE_LADDER), so the moment a fight starts, the harmony itself changes
     * category: the augmented second arrives, the chord on the fifth turns
     * major, and the music gains a leading tone it has had no access to for the
     * entire run. The boss leitmotif is written for exactly these intervals —
     * see `BOSS_THEME` in layers.ts.
     *
     * It holds for the whole fight rather than escalating per phase. The theme
     * means what it means because of this scale; changing modes underneath it
     * mid-fight would rewrite its intervals and throw away the recognition the
     * leitmotif exists to buy. Phases escalate tempo, density and register
     * instead — the things that can move without changing what the tune IS.
     */
    if (this.themeBoss) {
      /*
       * `themeBoss`, not `boss` — the mode goes where the tune goes.
       *
       * The leitmotif is written around the augmented second this scale has
       * and no other in the game does, so the two must turn on the same bar.
       * Reading the live flag here while the tune read a latched one is what
       * opened every fight with `BOSS_THEME` in the wrong mode.
       */
      this.mode = 'harmonicMinor';
      this.modeWave = period;
      this.modeBias *= 0.72;
      return;
    }

    // Same colour until the tune changes. The bias still decays on schedule so
    // a flawless wave's reward does not outlive its wave.
    // `bossChanged` overrides the hold: a fight ending is a boundary even when
    // the wave has not moved, and the mode must leave with the tune.
    if (waveHeld && !bossChanged) {
      this.modeBias *= 0.72;
      return;
    }
    this.modeWave = period;

    let idx = Math.floor(Math.pow(t, 1.8) * MODE_LADDER.length + this.modeBias);
    // Decay the reward so it colours a wave or two, not the whole run.
    this.modeBias *= 0.72;

    if (idx >= MODE_LADDER.length - 1) {
      /*
       * At the top of the ladder, rotate instead of parking.
       *
       * Energy pins at 1.0 from about wave 17, and the mode was simply clamped
       * to the last entry — so the entire endgame played in octatonic, forever.
       * The darkest colours should still move against each other; sitting on one
       * of them is not intensity, it is monotony.
       */
      const dark: ModeName[] = ['phrygian', 'phrygianDominant', 'locrian', 'octatonic'];
      this.mode = dark[Math.floor(this.phraseIndex) % dark.length];
      return;
    }
    this.mode = MODE_LADDER[clamp(idx, 0, MODE_LADDER.length - 1)] ?? 'aeolian';
  }

  private updateTempo(tension: number): void {
    /*
     * The base cap used to be 140, reached at wave 11 — so every wave from
     * there on shared one tempo range, the same flatline the difficulty curve
     * had. Tempo is the cheapest escalation there is and it costs no extra
     * enemies, so it keeps climbing, slowly, to a ceiling that is fast but
     * still danceable.
     */
    /*
     * Ceiling 138, not 152 — and tension moves it 10bpm, not 22.
     *
     * Measured in play, late waves were running 154 to 176bpm. That is a rave,
     * not a score: at 176 an eighth note is 170ms, so every line becomes a blur
     * of short events no matter how long its envelope is, and there is no room
     * left for a melody to phrase. Tempo is cheap escalation and it was being
     * spent freely; the difficulty now comes from the stage rather than from
     * playing everything faster.
     */
    /*
     * The ramp reaches its ceiling at wave 32, not wave 18.
     *
     * This was `122 + wave * 0.9`, which caps at 138 by wave 18 — and that was
     * calibrated when `waves.ts` believed "runs end around wave 8". `deadhunt`
     * has since measured real runs to death rather than to a clock: **0 deaths
     * in 16 runs of 20 minutes, reaching wave 32-40.** So the tempo pinned at
     * its ceiling for the entire second half of every run, and `wave` — the one
     * input here that only ever goes up — was dead for more of the game than it
     * was alive.
     *
     * THEN IT WAS FIXED AGAIN, because a linear ramp was the wrong shape.
     *
     * The first correction used `wave * 0.5`, reaching 138 at wave 32 — picked
     * because that was where runs "actually end". `deadhunt` then re-derived
     * the horizon properly and the answer is that **there is no horizon**. Not
     * wave 8, not 32, not 60: the bot does not die at any competence, and a
     * ship nobody is flying at all reaches wave 60 in forty-five minutes. Score
     * extends carry the player to exactly one life, and at one life the
     * auto-bomb rescue refunds every lethal hit while bomb income swamps the
     * drain. The game supplies no ending.
     *
     * So ANY linear ramp saturates somewhere and re-creates the defect further
     * out — `wave * 0.5` would have pinned from wave 32 for the back half of a
     * long session, less badly than wave 18 and the same shape. Picking a
     * bigger number would just move the wall.
     *
     * `122 + 16 * wave/(wave + 20)` has no wall. It approaches 138 and never
     * arrives: 126.6 at wave 8, 132 at wave 34, 134 at wave 60, still climbing
     * at wave 200. Diminishing returns are correct here — the difference
     * between wave 4 and wave 12 should be worth more than between 50 and 58 —
     * and `wave` stays a live input for as long as anyone keeps playing.
     *
     * The general lesson, which is `deadhunt`'s: when the quantity driving a
     * ramp has no natural maximum, do not calibrate the ramp against a measured
     * one. Measure again and it will have moved.
     */
    /*
     * ...AND THEN THE GENRE FIXED IT AT 140, which is a smaller change to this
     * expression than the four paragraphs above it suggest.
     *
     * Everything those notes establish about the SHAPE of the ramp is kept —
     * `wave/(wave + 20)` has no wall, `wave` stays a live input at wave 200,
     * and the diminishing return is still the right curve. What changes is the
     * range it spans. It was 122 -> 138, sixteen BPM of climb; it is now
     * 136 -> 144, eight BPM of climb centred on `DUBSTEP_BPM`. Wave 8 reads
     * 138.3, wave 20 reads 140.0, wave 60 reads 142.0.
     *
     * The escalation the sixteen BPM was buying does not disappear, it moves:
     * `wobble.ts`'s LFO rate phrase and `lpdepth` are what get faster and
     * harder now, and those are the genre's own escalation. A dubstep track
     * that answered pressure by speeding up would stop being one.
     */
    const base = DUBSTEP_BPM - 4 + 8 * (this.wave / (this.wave + 20));
    /*
     * A boss opens SLOWER than the wave that led to it, and accelerates.
     *
     * The old rule added a flat +4bpm, on the theory that a boss is the most
     * intense thing in the run and intensity means fast. Menace does not work
     * that way. The Imperial March is slow; so is nearly every theme that has
     * ever made an audience nervous. Weight is what reads as threat, and weight
     * needs time between the notes — at 142bpm the leitmotif's hammered tonic
     * is a stutter rather than a knock at the door.
     *
     * So phase 0 drops the tempo well under the surrounding music, which is
     * also the single most audible thing that can happen at a section boundary:
     * everything slams down a gear the moment the fight starts. Each phase then
     * takes some of it back, and the last phase overshoots — the fight ends
     * faster than the run was before it began. The gallop feel bosses already
     * use turns from a heavy dotted march into a genuine Castlevania drive
     * without a single note changing.
     */
    /*
     * `tension * 4`, not `tension * 10`, and the boss drop is -10 rather
     * than -16.
     *
     * Same reason as `base`: the working range is the genre's, not the
     * arrangement's. Ten BPM of tension on top of sixteen of wave meant the
     * tempo was the score's loudest escalation dial, and it is now its
     * quietest. Four still moves — 136 to 146 across the whole run — which is
     * inside what a listener hears as one track getting more urgent rather
     * than as a different track.
     *
     * The boss keeps its SHAPE, which is the part that was measured and right:
     * it opens under the wave that led to it and takes the tempo back a phase
     * at a time, ending faster than it began. -16 at 122 was a move to 106;
     * -10 at 140 is a move to 130, which is the same gesture as a fraction of
     * the clock and still well clear of the half-time floor where the ghost
     * notes stop being separate events.
     */
    let target = base + tension * 4 + (this.boss ? -10 + this.bossPhase * 6 : 0);
    /*
     * THE HALF-TIME PULL IS GONE, and its absence is the point.
     *
     * It was `if (feel === 'halftime') target = lerp(target, 140, 0.5)` — a
     * per-feel correction, because half-time was one entry in a rota of five
     * and the other four were being played at 122-138. Half-time is now the
     * posture of the whole score (`FEEL_CYCLE`, and every boss), and `base` is
     * anchored at `DUBSTEP_BPM`, so the correction has nothing left to correct:
     * it would be pulling 140 halfway toward 140.
     *
     * Deleted rather than left as a no-op, because a conditional that cannot
     * change its output is exactly the dead control this project keeps finding.
     * The reasoning it carried is preserved in `DUBSTEP_BPM`.
     */
    if (this.arranger.section === 'drop') target += 4;
    /*
     * A breakdown drops 20 BPM, not 6.
     *
     * Six is inside the range a listener reads as drift rather than as a
     * decision — at 138 it is a move to 132, which is the same music slightly
     * more relaxed. The section is supposed to be the arrangement taking a
     * breath, and it is the only place in the whole score where the tempo is
     * free to leave dance territory at all.
     *
     * 20 is not a taste number, it is the budget. The deepest drop a breakdown
     * can actually complete is `BPM_STEP * MIN_BARS.breakdown` = 3 * 8 = 24
     * BPM, so -20 arrives with a bar to spare and then holds. A deeper target
     * would be strictly worse: the tempo would ramp for the whole section and
     * never settle anywhere, which reads as drifting rather than as arriving.
     *
     * Raising `BPM_STEP` to 5 to buy more depth was tried and rejected — it
     * bought one BPM (min 118 -> 117) in exchange for tempo moves large enough
     * to read as a mistake, which is exactly what that constant exists to
     * prevent. If a deeper breakdown is ever wanted, the lever is
     * `MIN_BARS.breakdown`, not the step — but note that MIN_BARS is a floor
     * the arranger cannot leave early, so a long breakdown would persist into
     * the next wave's combat.
     */
    if (this.arranger.section === 'breakdown') target -= 20;
    if (this.collapsing) target = BPM_MIN;
    // UP-TEMPO: "pushed ahead of the beat". 3% a level, so three levels is a
    // shade under 10% — audible as urgency without becoming a different song.
    /*
     * ...and the FORM owns the top of the range.
     *
     * Every term above this line is a cycle or a scalar: `base` climbs with the
     * wave and saturates, tension is noise on the timescale of a bar, the feel
     * and the section rotate. Measured at HEAD over four twenty-minute runs,
     * peak BPM per two-minute window read 134-150 in the FIRST window of every
     * seed and 139-150 in the last — the whole tempo range was available in
     * minute one, so a late run could not be faster than an early one in any
     * way a listener could hear.
     *
     * `ACT_SHAPE.tempo` is a CEILING and not an offset, so it takes nothing
     * away from calm play: an exposition that never asks for more than 132 is
     * unclamped, and the breakdown's -20 and the boss's -16 are untouched in
     * every act. What it removes is the ability to spend the top of the range
     * before the run has earned it. `BPM_MAX` still binds above all of it.
     */
    const actCeiling = Math.min(BPM_MAX, ACT_SHAPE[this.act].tempo);
    this.targetBpm = clamp(Math.round(target * (1 + this.tempoLift)), BPM_MIN, actCeiling);

    /*
     * A DEADBAND, because the tempo was hunting rather than travelling.
     *
     * This was `if (this.bpm !== this.targetBpm)`, so any difference at all —
     * one BPM — moved the tempo on the next bar. `target` is
     * `base + tension * 10 + ...` and tension is noisy bar to bar, so the
     * tempo chased the noise. Measured over 224 bars of a real run: it moved
     * on 61% of bars, and 44% of those moves REVERSED DIRECTION, with a mean
     * step of 2.96 BPM. Fifty percent reversals is a random walk; 44% is
     * barely distinguishable from one. That is not a tempo curve, it is
     * jitter, and an unsteady tempo is one of the clearest tells that a score
     * is being generated rather than played.
     *
     * A Schmitt trigger rather than a smaller step: the same shape as `Latch`
     * in `core/math.ts`, which exists in this codebase precisely because "any
     * boolean derived from a continuous value" flaps without one. A small gap
     * is ignored entirely; once a move is genuinely worth making, it runs to
     * completion rather than stalling at the edge of the band. Shrinking
     * `BPM_STEP` instead would have made the wobble slower, not rarer.
     */
    const gap = this.targetBpm - this.bpm;
    // A boss telegraph takes the whole tempo change at once — see above.
    if (this.tempoSnap) {
      this.tempoSnap = false;
      this.tempoMoving = false;
      if (this.bpm !== this.targetBpm) {
        this.bpm = this.targetBpm;
        setTempo(this.bpm);
      }
      return;
    }
    if (Math.abs(gap) >= TEMPO_DEADBAND) this.tempoMoving = true;
    if (this.tempoMoving) {
      const step = clamp(gap, -BPM_STEP, BPM_STEP);
      this.bpm = Math.round(this.bpm + step);
      setTempo(this.bpm);
      if (this.bpm === this.targetBpm) this.tempoMoving = false;
    }
  }

  /**
   * A compact description of everything that affects how patterns are *built*
   * (as opposed to how loud or how bright they are). When it changes, rebuild.
   * This keeps rebuilds to a handful per wave instead of one per bar.
   */
  /** Test hook: the tension model's channels and terms, for range checking. */
  private lastTension: unknown = null;

  debugTension(): unknown {
    return this.lastTension;
  }

  /** Test hook: the key as last computed, for attributing rebuild churn. */
  debugStructureKey(): string {
    return this.lastKey;
  }

  private structureKey(snap: GameSnapshot | null, section: SectionName, buildBucket: number): string {
    // Coarse on purpose: a finer bucket means a rebuild on almost every bar,
    // and the difference between intensity 0.61 and 0.64 does not change a
    // single note of the patterns these values select.

    const pu = snap ? Object.keys(snap.powerups).sort().join('') : '';
    /*
     * THE LOADOUT WAS MISSING FROM THE KEY, and the patterns read it.
     *
     * `structureKey` decides when the score is rebuilt, so it has to name
     * everything the built pattern depends on — that is the whole contract of
     * a cache key. Abilities were absent, yet they demonstrably shape the
     * output: `tools/instruments.mjs` proves every one of the 38 reaches the
     * score, and several signatures gate on LEVEL rather than mere presence,
     * which is why the level is in here and not just the id.
     *
     * Nothing was permanently silent, because enemy counts and intensity churn
     * constantly and any rebuild picks the new loadout up. That is luck, not
     * design, and it measured like luck: after taking a card the score noticed
     * a median of 0.99 bars later but a worst case of 4.98 — nine seconds at
     * 128bpm during which the instrument the player just chose is not playing.
     * A random powerup pickup, meanwhile, forces an immediate rebuild in
     * `onPickup`. The permanent, chosen thing deserved at least the same.
     *
     * Not in IMMEDIATE and not in LAZY, so it lands on the next bar — the tier
     * the comment below reserves for "things the player did and should hear
     * about promptly", which is exactly what taking a card is. Churn is a
     * non-issue: a loadout changes about forty times in a run, against enemy
     * counts that changed the key thirteen times in forty-five seconds.
     */
    // Widened: a synthesised DUET id (`a+b`) is a legitimate runtime key that
    // is not a member of the `AbilityId` union. Same read as `render/levelup.ts`.
    const abLevels = (snap?.abilities ?? {}) as Record<string, number>;
    const ab = snap
      ? Object.keys(abLevels).sort().map((k) => `${k}${abLevels[k] ?? 0}`).join('')
      : '';
    /*
     * Enemy counts, bucketed at the boundaries the motifs actually test.
     *
     * The exact per-archetype count was in the key, so every single death
     * rebuilt all eleven stems — measured, enemy counts caused more key churn
     * than anything else (13 of 34 rebuilds over 45 seconds). The motif
     * builders only ever compare against 1, 2, 3, 4 and 8, so anything finer
     * than that is rebuilding for a distinction no pattern can express.
     */
    const bucketCount = (n: number): number => (n <= 4 ? n : n < 8 ? 5 : 6);
    const en = snap
      ? (Object.keys(snap.enemies) as (keyof GameSnapshot['enemies'])[])
          .map((k) => `${k[0]}${bucketCount(snap.enemies[k])}`)
          .join('')
      : '';
    /*
     * Named, not positional.
     *
     * The tiers below used to select parts of this key by array index, and
     * `tools/keychurn.mjs` kept a parallel list of names to label them. That
     * list went stale — `combo` was missing, so every field after it was
     * reported under its neighbour's name and the enemy counts were being read
     * as powerups — and no field could be removed without silently renumbering
     * the tiers. Names cost one `map` and make both safe.
     *
     * `leadRegister` and the tension bucket were both here and are both gone:
     * neither selects a note any more, so neither can justify a rebuild. The
     * register rides on the melody as `sig.register`; the chord's ninth is
     * spelled into the chord itself from the intensification on
     * (`ACT_SHAPE.ninth`, where the phrase chords are built) and stated by the stab — the
     * `colour7`/`colour9` faders it used to ride went with the colour pair.
     */
    this.keyFields = [
      ['section', section],
      /*
       * The ACT and the TACET, both structural, both IMMEDIATE.
       *
       * The act selects the harmonic sentence (`progressionFor`) and the theme
       * (`MusicalState.recap`), so a phrase built before the act turned would
       * go on playing the previous act's chords for up to eight bars after the
       * form had moved — the same desync `pendingWave`/`pendingTonic` exist to
       * prevent, arriving one level up. It changes three times in a run, so
       * naming it costs three rebuilds.
       *
       * The tacet has to be here for a different and sharper reason: a lane at
       * `want = 0` fades out, drops its `active` latch, and `drainRebuild`
       * replaces its cache with `silence`. Without a key field the part could
       * not come back until some unrelated change happened to trigger a
       * rebuild, so a one-phrase rest would have been an indefinite one. It
       * only ever moves on a phrase line, and `rebuildIfNeeded` is only reached
       * on a bar crossing, so IMMEDIATE here is exact rather than eager.
       */
      ['act', this.act],
      ['tacet', this.tacetLane ?? '-'],
      /*
       * WHICH INSTRUMENTS ARE PLAYING, and it belongs here for the same reason
       * everything else does: "a cache key has to name everything the built
       * pattern depends on", and a pattern's OSCILLATOR now depends on whether
       * its samples have finished loading.
       *
       * `soundfontGeneration()` is a counter bumped by `soundfonts.ts` each
       * time a role is promoted from its fallback oscillator to its real
       * instrument. Without it the swap would land whenever some unrelated
       * change next forced a rebuild — the same "noticed a median of 0.99 bars
       * later but a worst case of 4.98" defect the abilities field records
       * below, except that here the worst case is the whole intro.
       *
       * IMMEDIATE, and it costs at most seven rebuilds in a run: one when the
       * load starts, one per role that lands, one when it finishes. They all
       * happen inside the first second or two of the first wave.
       */
      ['voices', soundfontGeneration()],
      ['intensity', this.intensityBucket.update(this.intensity)],
      ['brightness', this.brightnessBucket.update(this.brightness)],
      ['mode', this.mode],
      ['tonic', this.tonic],
      ['wave', this.wave],
      ['boss', this.boss ? `b${this.bossPhase}` : '-'],
      ['movement', this.movement ?? '-'],
      ['buildBucket', buildBucket],
      ['intro', section === 'intro' ? Math.round(this.introProgress * 6) : '-'],
      ['health', this.healthBucket.update(this.health)],
      ['grazing', this.grazing.value ? 'g' : '-'],
      ['bombs', Math.min(3, this.snapshot?.bombs ?? 0)],
      ['combo', this.comboBucket.update(clamp01(remap(this.snapshot?.combo ?? 0, 6, 28, 0, 1)))],
      ['powerups', pu],
      ['abilities', ab],
      ['enemies', en],
    ];
    return this.keyFields.map(([, v]) => v).join('|');
  }

  /** Field names of the last computed key, in order. Read by tooling. */
  private keyFields: [string, string | number][] = [];

  debugKeyFields(): string[] {
    return this.keyFields.map(([n]) => n);
  }

  private rebuildIfNeeded(transport: Transport): void {
    const arr = this.arranger.state(transport);
    const buildBucket = arr.section === 'build' ? Math.round(arr.buildProgress * 4) : 0;
    const key = this.structureKey(this.snapshot, arr.section, buildBucket);
    if (key === this.lastKey) return;

    /*
     * Three tiers, by how long a change can wait.
     *
     * A rebuild swaps the pattern the scheduler is reading, so the question for
     * each part of the key is how late the music is allowed to notice it.
     *
     *   IMMEDIATE — the arrangement's own structure: section, mode, key, wave,
     *   boss phase. These already land on boundaries and delaying them would
     *   make the drop arrive late, which is worse than any glitch.
     *
     *   NEXT BAR — things the player did and should hear about promptly: a
     *   powerup, the energy band, where the ship is on the screen. Waiting for
     *   the bar coalesces everything inside it into one rebuild.
     *
     *   NEXT PHRASE — things nothing musical is waiting on: how many enemies
     *   are on screen, the combo, bombs in hand, the health band. Enemy counts
     *   alone were the dominant source of key churn (14 of 18 changes over 12s
     *   at wave 24), and nobody needs the motif layer to reflect a kill inside
     *   the same phrase. A phrase is eight bars, which is the unit the tune is
     *   written in, so this is also the boundary where a change is least
     *   audible as an interruption.
     *
     * The tier only decides WHEN. What survives a rebuild is a separate
     * problem, fixed in `buildSlots` — before that, deferring merely made the
     * rewrites less frequent rather than less destructive.
     */
    const prev = this.lastKey.split('|');
    const next = key.split('|');
    const names = this.keyFields.map(([n]) => n);
    // `movement` is immediate because the game announces it with a banner: a
    // stage that says FLANKED and goes on sounding like the last one is worse
    // than any glitch.
    const IMMEDIATE = new Set(['section', 'mode', 'tonic', 'wave', 'boss', 'movement', 'act', 'tacet', 'voices']);
    const LAZY = new Set(['health', 'grazing', 'bombs', 'combo', 'enemies']);
    const movedFields = names.filter((_, i) => prev[i] !== next[i]);
    const structural = this.lastKey === '' || movedFields.some((n) => IMMEDIATE.has(n));
    // Anything neither immediate nor lazy is prompt.
    const hasPrompt = !structural && movedFields.some((n) => !LAZY.has(n));

    const bar = Math.floor(transport.bar);
    const phrase = Math.floor(transport.bar / BARS_PER_PHRASE);
    // No need to stash the pending key: it is recomputed every frame, so once
    // the boundary passes this same check runs again and lets it through.
    if (!structural) {
      if (bar === this.lastRebuildBar) return;
      if (!hasPrompt && phrase === this.lastRebuildPhrase) return;
    }

    this.lastKey = key;
    this.lastRebuildBar = bar;
    this.lastRebuildPhrase = phrase;
    if (this.keyHistory.push(key) > 40) this.keyHistory.shift();
    this.queueRebuild(transport, arr.section);
    this.rebuildCount++;
  }

  /**
   * Capture the musical state for all eight bars of the phrase and queue every
   * stem for rebuilding. Loudest stems first, so if a rebuild does straddle a
   * few frames the lag lands on whatever is least audible.
   */
  private queueRebuild(transport: Transport, section: SectionName): void {
    this.pendingSlots = this.buildSlots(transport, section);
    this.pendingQueue = [...STEM_IDS].sort((a, b) => this.levels[b] - this.levels[a]);
  }

  /**
   * Build ONE queued stem per frame. Called every frame; usually a no-op.
   *
   * It was two. The themes then grew from four cells to six — longer phrases
   * with a real antecedent and consequent, which is what the writing needed —
   * and the extra material pushed the worst rebuild to 28.5ms, a dropped frame,
   * which `smoke` caught. Two stems in one frame is a choice that only made
   * sense while a stem was cheap to build; one keeps the same total work and
   * spreads it, at the cost of a rebuild taking eleven frames instead of six.
   * Nothing hears the difference — rebuilds already land on bar lines — and a
   * dropped frame in a bullet hell is felt.
   */
  private drainRebuild(): void {
    if (!this.pendingSlots || this.pendingQueue.length === 0) return;
    const t0 = performance.now();
    const slots = this.pendingSlots;
    for (let n = 0; n < 1 && this.pendingQueue.length > 0; n++) {
      const id = this.pendingQueue.shift()!;
      // Skip anything inaudible and staying that way; a silent pattern costs
      // nothing to query and this is the common case for most stems.
      if (this.levels[id] < 0.02 && !this.active[id] && id !== 'fx' && id !== 'motifs' && id !== 'power') {
        this.cache[id] = silence;
        continue;
      }
      const build = BUILDERS[id];
      /*
       * Capture the motor's line from the SAME state the pattern is built
       * from, so the panel cannot describe something else. See `sourceLines`.
       */
      if (id === 'hats' && slots[0]) this.motorLineText = motorVoicing(slots[0]).line;
      let pat = cat(...slots.map((m) => build(m)));
      if (id === 'kick') pat = this.applyDuck(pat);
      this.cache[id] = pat;
    }
    if (this.pendingQueue.length === 0) this.pendingSlots = null;
    this.lastRebuildMs = performance.now() - t0;
  }

  /**
   * Each slot is built with the chord and phrase position that Strudel will
   * actually be at when it plays that slot, so the harmony is carried by the
   * pattern rather than by our timing.
   */
  private buildSlots(transport: Transport, section: SectionName): MusicalState[] {
    const snap = this.snapshot;
    /*
     * WHICH SENTENCE, not just which colour.
     *
     * `progressionFor` is defensive in both arguments for the reason the old
     * line here was defensive in one: an unrecognised mode used to throw from
     * deep inside a pattern build, killing the frame with a message that
     * pointed nowhere near the cause.
     *
     * The shape is chosen by the ACT and never by tension. Tension already
     * drives the mode ladder — nine colours of harmony — and hanging a second
     * harmonic decision on the same signal would make the two move together
     * and produce one louder version of the same information rather than two
     * independent axes. Where you are in the run and how much trouble you are
     * in are different questions and the harmony now answers both.
     */
    const act = ACT_SHAPE[this.act];
    const progression = progressionFor(this.mode, act.shape);
    const arr = this.arranger.state(transport);

    // Which eight-bar phrase of the run we are in. Motivic development reads
    // this, so the tune evolves across a run rather than looping.
    const phrase = Math.floor(transport.bar / BARS_PER_PHRASE);

    /*
     * Every rebuild inside one phrase must produce the same eight chords.
     *
     * The seed is pinned to the phrase rather than carried from the last
     * rebuild; see phraseSeedVoicing.
     */
    if (phrase !== this.phraseSeedIndex) {
      this.phraseSeedIndex = phrase;
      this.phraseSeedVoicing = this.lastVoicing;
    }

    /*
     * The values that SELECT NOTES are quantised; the ones that only set gains
     * and filters are not.
     *
     * The rebuild key says intensity to six sticky steps and claims, in its own
     * comment, that "the difference between intensity 0.61 and 0.64 does not
     * change a single note of the patterns these values select". That was not
     * true: the key was coarse but the builders were handed the raw value, and
     * they threshold it in nine places — the kick rhythm, the hat subdivision,
     * the bassline, the chord rhythm, and `renderCell`'s melodic density. So a
     * rebuild triggered by an enemy count could and did rewrite the tune.
     *
     * `tools/phrasechurn.mjs` measured the result: at wave 25 the lead's eight
     * bars were replaced 3.4 times per ten seconds and only 11% of its notes
     * survived each replacement. Passing the bucket the key already tracks
     * makes the key's claim true — material can now only change when the key
     * says it changed.
     */
    const intensityQ = this.intensityBucket.value / 6;

    // Build every chord first, so each bar knows what it is heading toward and
    // the bass can write an approach into it.
    /*
     * THE PIVOT — the last bar of a phrase that is about to modulate.
     *
     * `pendingTonic` is non-null exactly while a key change is queued and
     * waiting for the next phrase line, so this is the outgoing phrase and
     * `BARS_PER_PHRASE - 1` is its last bar. Substituting the incoming key's
     * dominant there turns a modulation from a fact into an EVENT: the ear
     * hears the pull, then the arrival, instead of simply finding itself
     * somewhere new. See `pivotChord` for why this costs one function — the
     * cycle of fourths makes the outgoing tonic the incoming dominant, so the
     * chord is the one the music is already sitting on, re-spelled.
     *
     * Voice-led like every other chord in the phrase, so it joins the sentence
     * rather than interrupting it, and the bass and the stab both take it for
     * free because they read `chord.root` and `chord.notes` (the stab's guide
     * tones on a pivot are the leading tone and the flat seventh).
     *
     * NOT gated on the act. A modulation is an arrival wherever it happens,
     * and the exposition is precisely where a listener is still learning where
     * home is — announcing the first departure is worth more than announcing
     * the fifth.
     */
    const pivotAt = this.pendingTonic !== null ? BARS_PER_PHRASE - 1 : -1;
    // Record that this phrase's last bar carries the announcement, so
    // `updateHarmony` can hold the key back if it does not.
    if (pivotAt >= 0) this.pivotPhrase = phrase;
    const chords: Chord[] = [];
    let previousVoicing: number[] = this.phraseSeedVoicing;
    for (let i = 0; i < BARS_PER_PHRASE; i++) {
      const raw =
        i === pivotAt
          ? // Raw tonics, matching `chordForBar` on the line below. The capo is
            // applied to `MusicalState.tonic` and not to the chord grid, so a
            // pivot that added it would sit a whole step off the chords either
            // side of it.
            pivotChord(this.tonic, this.pendingTonic ?? this.tonic)
          : /*
             * The NINTH is reserved material, and this is where the act spends
             * it.
             *
             * `ACT_SHAPE.ninth` is false through the exposition and the
             * development and true from the intensification on. It used to
             * gate a second thing as well: `sig.colour9`, a FADER on the
             * chords lane's colour pair, which swelled the thirteenth in over
             * tension 0.55-0.85. That pair is deleted (`buildChords`) and the
             * signal with it, so this is now the ONLY thing the flag does — and
             * it was always the strong version of the idea: a colour tone
             * swelling in is not a different chord, it is the same chord with
             * a twinkle. Passing it here makes the ninth a member of the chord
             * itself for the second half of a run, which the stab states in
             * the register a listener follows. Same voice count either side;
             * see `theory.Extension` for why it replaces the third instead of
             * joining it.
             */
            chordForBar(this.tonic, this.mode, progression, i, ACT_SHAPE[this.act].ninth ? 'ninth' : 'seventh');
      const led = voiceLead(previousVoicing, raw);
      previousVoicing = led.notes;
      chords.push(led);
    }

    const slots: MusicalState[] = [];
    for (let i = 0; i < BARS_PER_PHRASE; i++) {
      slots.push({
        tension: this.p.tension,
        immediate: this.tensionModel.rawValue,
        section,
        buildProgress: arr.buildProgress,
        fillBar: i === BARS_PER_PHRASE - 1,
        bar: i,
        barInPhrase: i,
        // Theme-relative, so a theme's first two phrases are its plain
        // statement and restatement. See `themeStartPhrase`.
        phrase: Math.max(0, phrase - this.themeStartPhrase),
        feel: this.feel,
        // CAPO: "everything up a step". A capo transposes; it does not
        // re-voice, so every interval in the score is untouched and only the
        // pitch centre moves. That is why this rides the tonic rather than
        // anything in `theory.ts`.
        tonic: this.tonic + this.capo,
        mode: this.mode,
        chord: chords[i],
        nextChord: chords[(i + 1) % BARS_PER_PHRASE],
        chordIndex: i % progression.length,
        bpm: this.bpm,
        intensity: intensityQ,
        brightness: this.brightness,
        /*
         * Abilities AND powerups, merged — because the progression rewrite
         * moved nine of the twelve ids out from under the score's feet.
         *
         * `snapshot.powerups` now carries only the three that still drop in the
         * field (OVERDRIVE, BOMB, ENCORE). DRONES, NOVA, BLACKHOLE, LASER,
         * SPREAD, RAPID, HOMING, MAGNET and TIMEWARP arrive on
         * `snapshot.abilities` instead, with the same `id -> level` shape and
         * the same ids. Every one of those nine is read by `layers.ts` —
         * `m.powerups.nova`, `m.powerups.laser` and the rest — so from the
         * moment progression landed, all nine were reading 0 forever and every
         * powerup-driven musical behaviour in the score was dead. Nothing warns
         * about this: the lookups are on a `Partial<Record<...>>`, so a missing
         * key is a legal `undefined` and the `?? 0` swallows it.
         *
         * Merging here rather than renaming nine call sites, because musically
         * they are the same question — "how much of this does the player have"
         * — and the split is a progression-system concern that the score has no
         * reason to know about. Field drops win on any id collision, since they
         * are the transient thing.
         */
        powerups: kitOf(snap),
        enemies: snap?.enemies ?? { pluck: 0, stutter: 0, arpeggiator: 0, glissando: 0, subdrop: 0, echo: 0, rush: 0, conductor: 0 },
        boss: this.boss,
        bossTheme: this.themeBoss,
        bossPhase: this.bossPhase,
        wave: this.musicalWave,
        // The one field here that is a property of the RUN rather than of the
        // wave. See `themeForWave` and `ACT_SHAPE`.
        recap: this.act === 'recapitulation',
        bombs: snap?.bombs ?? 0,
        health: this.health,
        // Latched rather than raw, so the shimmer cannot chatter on and off.
        grazeRate: this.grazing.value ? Math.max(1.5, snap?.grazeRate ?? 0) : 0,
        combo: snap?.combo ?? 0,
        leadRegister: this.leadRegister,
        movement: this.movement,
        sig: this.sig,
      });
    }
    // Carry the last voicing into the next rebuild so phrases join up rather
    // than resetting to root position every eight bars.
    this.lastVoicing = previousVoicing;

    return slots;
  }

  /**
   * Sidechain. Only ducks orbits that are actually playing — superdough warns
   * (and does nothing useful) when told to duck an orbit that no hap has
   * created yet.
   */
  private applyDuck(kickPattern: Pattern): Pattern {
    /*
     * THE SIDECHAIN IS GONE. This is now a no-op, kept as a seam.
     *
     * Ducking the mix against the kick is the single most recognisable
     * production gesture in modern dance music, and it appears nowhere in the
     * canon this score is aiming at — not in Chrono Trigger, not in Castlevania,
     * not on any hardware that had eight voices and no compressor. It said
     * "club track" independently of any note played.
     *
     * Three separate reasons to remove it, and any one of them would do:
     *
     * 1. IT WAS MEASURABLY BROKEN. The depth scaled by
     *    `clamp01(levels.kick / DUCK_KICK_FLOOR)`, and `DUCK_KICK_FLOOR` is
     *    0.3 — exactly `STEM_CURVES.kick.floor`. So the moment the kick was
     *    audible at all that ratio hit 1 and stayed there. What reads in the
     *    source as "duck harder when the kick is loud" was, for the whole run,
     *    a constant full-depth gain cut. It was not a groove device; it was a
     *    fader nobody knew was pulled down.
     *
     * 2. THERE IS NOTHING LEFT TO DUCK AGAINST. `kickRhythm` no longer plays
     *    four on the floor — the ladder caps at three onsets and the pulse has
     *    moved to `buildMotor`. Sidechaining exists to carve a hole for a
     *    relentless kick; without one it is just periodic amplitude modulation.
     *
     * 3. IT WOULD NOW DAMAGE THE MOTOR. The motor is a sustained pitched line
     *    on ORBIT_HARMONY running sixteen notes a bar. Periodic ducking of a
     *    sustained pitched voice is not groove, it is tremolo — and this
     *    project has spent its entire life chasing reports of "choppy".
     *
     * The bass/kick argument the old comment made is real — they do compete for
     * the same octaves — but the answer is the fixed high-pass already on the
     * bass and the kick's own narrowed band, which are static and audible-free,
     * rather than an envelope that opens and closes several times a second.
     *
     * Left as a function rather than deleted at the call site so that
     * `drainRebuild`'s `if (id === 'kick')` seam survives: if a future feel
     * genuinely wants a pumped section as a deliberate one-off gesture, this is
     * where it goes, and it goes gated on that section rather than on always.
     */
    return kickPattern;
  }

  /*
   * `duckDepth()` and `duckRecovery()` were deleted along with the sidechain.
   *
   * Recorded here rather than left as dead code, because the *finding* is worth
   * more than the implementation was: the depth scaled by
   * `clamp01(levels.kick / DUCK_KICK_FLOOR)` where `DUCK_KICK_FLOOR` was 0.3 —
   * exactly `STEM_CURVES.kick.floor`. The ratio therefore hit 1 the instant the
   * kick was audible at all and never came back down, so what read in the
   * source as "duck harder when the kick is loud" was a constant full-depth
   * gain cut for the whole run.
   *
   * That is the third time in this project a control has been found pinned at
   * one end of its range by a threshold that matched the floor of the thing it
   * was reading. Worth checking for directly the next time a dial seems to do
   * nothing: compare its divisor against the source's own minimum.
   */

  // -------------------------------------------------------------------------
  // game events
  // -------------------------------------------------------------------------

  onWaveStart(t: Transport, e: GameEvents['wave:start']): void {
    // Do not drag a drop back down into a build just because a new wave arrived.
    this.wave = e.index;
    // The SCORE takes the new wave at the next phrase line, with the key and
    // the mode, so all three turn together. See `musicalWave`.
    this.pendingWave = e.index;
    /*
     * THE RECAPITULATION HOLDS THE OPENING GROOVE.
     *
     * `feelForWave` is an eight-slot rota — measured median hold nineteen bars,
     * about thirty-six seconds, the shortest structural unit in the score after
     * the section. Holding one groove across the whole final act makes it the
     * LONGEST-held unit of the run by a wide margin, which is the simplest
     * available statement that the piece has arrived somewhere rather than
     * carried on rotating. The canon this score names holds one groove for a
     * whole cue: one to three minutes.
     *
     * `homeFeel` rather than a literal, so re-ordering `FEEL_CYCLE` cannot
     * silently make the recapitulation return to a groove the opening never
     * played. Bosses still gallop — `onBossTelegraph`/`update` set the feel
     * from `feelForWave(wave, true)` elsewhere and a boss in the last four
     * minutes is still the biggest event on the field.
     */
    this.feel = this.act === 'recapitulation' ? this.homeFeel : feelForWave(e.index, false);
    /*
     * Modulate every FOURTH wave, not every wave.
     *
     * A fourth per wave meant the key changed every time a wave did — measured
     * over four minutes: eleven distinct keys, a modulation every twenty
     * seconds. A listener never gets long enough in one tonality to know where
     * home is, and music that keeps relocating reads as unsettled no matter how
     * smooth each individual layer is. This is the structural half of "choppy",
     * and no envelope or rebuild fix could ever have touched it.
     *
     * Four waves is roughly ninety seconds to two minutes at the current pacing
     * — long enough to establish a key and then genuinely leave it, which is
     * what a modulation is supposed to feel like. The cycle of fourths is kept
     * because it is the strongest relation between two keys; it just gets used
     * as an event rather than as a metronome.
     */
    /*
     * The new tonic is QUEUED, not applied here, and that is the other half of
     * a rule this file already states.
     *
     * `updateHarmony` opens with "Mode moves only at phrase boundaries:
     * changing the scale every bar sounds like indecision rather than
     * escalation" and returns unless `crossedPhrase()`. The tonic had no such
     * guard and was assigned right here, on whatever beat the wave happened to
     * start — so half of "the key" was quantised and half was not.
     *
     * Measured, that is audible. Logging every key span over a real run, the
     * spans quantise cleanly to 15s and 30s (8 and 16 bars) with one
     * exception: a 1.3s span, `D harmonicMinor -> D aeolian -> G aeolian`, at
     * a boss handover. Under a bar in a key nothing else agrees with is not a
     * modulation, it is a wrong note — and it is exactly the kind of seam that
     * makes an arrangement sound assembled rather than played.
     *
     * Deferring costs at most one phrase, and only on the every-fourth-wave
     * that actually modulates; the other three set the same value and queue
     * nothing.
     */
    /*
     * ...and THE RECAPITULATION COMES HOME.
     *
     * The circle of fourths is a cycle: it visits twelve keys and returns after
     * forty-eight waves, which is longer than any run anyone plays, so in
     * practice a run simply walks away from where it started and never comes
     * back. That is the harmonic form of the whole fault — a departure with no
     * return is a sequence, not a journey.
     *
     * In the final act the walk stops and the key returns to the one the run
     * opened in. It arrives through the same `pendingTonic` machinery as every
     * other modulation, which means it also gets the PIVOT: the phrase before
     * it ends on the dominant of home and resolves onto the downbeat. That
     * cadence, the signature theme returning with it and the opening groove
     * holding underneath are the three halves of the recapitulation, and they
     * all land on one phrase line.
     *
     * The bare `57` below is the tonic `reset()` chooses, and `homeTonic` is
     * read from it rather than restated so the two cannot drift.
     */
    const modulation = Math.floor(e.index / 4);
    const walked = 57 + ((modulation * 5) % 12) - (((modulation * 5) % 12) > 6 ? 12 : 0);
    const nextTonic = this.act === 'recapitulation' ? this.homeTonic : walked;
    if (nextTonic !== this.tonic) this.pendingTonic = nextTonic;
    this.lastKey = '';
    /*
     * Do not interrupt the opening.
     *
     * The first wave fires `wave:start`, which queued a build — and since the
     * runway before wave one was four bars, that cut the eight-bar intro in
     * half every single run. The lead enters 28% of the way through the intro,
     * so it never played a single note before the opening was over: measured,
     * zero lead notes across the whole intro. The first thing anyone heard was
     * a pad and then a build.
     */
    /*
     * ...and do not restart the machinery on every wave either.
     *
     * `sustain` is added to the exemption list alongside `drop` and `intro`.
     * With the wave-clear breakdown removed (see `onWaveClear`), the remaining
     * half of the wave-cycle churn was this: every wave began by demanding a
     * build, so a track that had just settled into a sustain was pulled back
     * into a riser fifteen seconds later, forever.
     *
     * A build is a promise that something is about to happen. Making it on a
     * schedule, twice a minute, is how a promise stops being believed. A wave
     * starting while the track is already in a settled section is not news —
     * the enemies arriving are the news, and the motif lane says so.
     */
    const settled =
      this.arranger.section === 'drop' ||
      this.arranger.section === 'intro' ||
      this.arranger.section === 'sustain';
    if (!settled) this.arranger.request(t, 'build', 'bar');
  }

  /** The chord the run is currently sitting on, for the wave-clear cadence. */
  currentChordNotes(): number[] {
    // The shape the run is actually in, not the period shape. This is the
    // chord `sfxWaveClear` cadences on, and a cadence onto a chord the score
    // is not playing is worse than no cadence.
    return chordForBar(this.tonic, this.mode, progressionFor(this.mode, ACT_SHAPE[this.act].shape), 0).notes;
  }

  /**
   * Carried into the next wave's harmony: negative is brighter, positive
   * darker. Earned by how the last wave went, and decays back to neutral so a
   * single great wave does not brighten the rest of the run.
   */
  private modeBias = 0;

  /**
   * A cleared wave is PUNCTUATION, not a new paragraph.
   *
   * This used to request a breakdown every single time. Combined with
   * `onWaveStart` requesting a build every single time, the arrangement was
   * slaved to the wave cycle: clear, breakdown, start, build, drop, clear,
   * breakdown — a full sectional round trip per wave. Waves run about half a
   * minute, so the track restructured itself roughly every fifteen seconds no
   * matter what the MIN_BARS floors said, because an explicit `request` bypasses
   * them by design.
   *
   * That is the user's "jarring music sessions" at its source, and raising the
   * section minimums alone would not have touched it. Nothing here stutters;
   * the arrangement simply never stays anywhere long enough for a listener to
   * settle into it, which is the one thing every score this game is trying to
   * sound like does effortlessly.
   *
   * So the ordinary case gets a one-bar fill — a comma. The wave-clear cadence
   * (see `currentChordNotes`) already lands on the boundary, and a cadence plus
   * a fill is ample punctuation for "that group is gone".
   *
   * A breakdown is now something the player EARNS. Clearing a wave without
   * being touched drops the track into its most exposed, prettiest section, and
   * that is the only way to get one outside a boss defeat. The quiet moment
   * becomes a reward rather than a scene change that happens to everyone twice
   * a minute.
   */
  onWaveClear(t: Transport, e: GameEvents['wave:clear']): void {
    this.modeBias = e.grade === 'perfect' ? -1.5 : e.grade === 'rough' ? 0.8 : this.modeBias * 0.5;
    this.lastKey = '';
    /*
     * A cleared wave is where the rest belongs, and only a PERFECT clear was
     * getting one.
     *
     * Measured over three seeds, grades come out roughly `rough 6, clean 2,
     * perfect 1` per seven minutes — so this fired about once every seven
     * minutes, and with the section-minimum bug (see `Arranger.onBar`) the
     * breakdown it asked for lasted 1.9s. Total rest in the arrangement: 0.4%
     * of a run. A score with no rest is relentless however good the notes are,
     * and it is the structural half of the "cheap techno" complaint.
     *
     * Widening this to `clean` as well is the smallest change that puts the
     * rest somewhere musically true. The gap between waves IS the breath —
     * the screen is empty and the player has a moment — and a clean clear has
     * earned it. `rough` is deliberately left out: taking damage should not be
     * rewarded with the arrangement relaxing, which is the same argument as
     * the camping floor in `tension.ts`.
     *
     * Note what did NOT work, so it is not retried: recalibrating the tension
     * thresholds in `Arranger.maybeAdvance` to the current distribution is
     * correct on its own terms and changed the measured rest by nothing at
     * all. Explicit `request()`s from the wave handlers are evaluated before
     * that function's own arms, and a wave arrives every ~60s, so the section
     * machine is driven by events and the tension arms rarely get a vote.
     */
    /*
     * ...but not before the arrangement has arrived anywhere.
     *
     * Wave 1 clears fast and usually cleanly, and the request landed while the
     * intro was still building. Measured across five seeds, four of them ran
     * `intro -> breakdown` at 15s having never reached a drop, and one rested
     * from 15s to 30s — a quarter of the first minute of the game. The opening
     * therefore built for fourteen seconds, stopped, and built again.
     *
     * A breakdown is a rest FROM something. `hasDropped` is the cheapest
     * honest test of whether there is anything to rest from yet.
     */
    if ((e.grade === 'perfect' || e.grade === 'clean') && this.arranger.hasDropped) {
      this.arranger.request(t, 'breakdown', 'bar');
    } else {
      // Anything that has not earned a rest still gets a fill to mark the
      // clear — including a clean wave 1, which now lands here rather than
      // resting the opening before it has arrived.
      this.arranger.fill(t);
    }
  }

  onBossTelegraph(t: Transport, e: GameEvents['boss:telegraph']): void {
    // A boss changes the groove before it changes anything else.
    this.bossArmed = true;
    this.feel = feelForWave(this.wave, true);
    this.lastKey = '';
    /*
     * The tempo drops in ONE step, at the next bar line, instead of gliding.
     *
     * `updateTempo` describes this moment as "everything slams down a gear the
     * moment the fight starts", and it was not slamming: the boss offset is
     * -16bpm and `BPM_STEP` moves 4 per bar, so the gear change arrived over
     * four bars — about seven seconds. Measured, the trace from a telegraph
     * read 130 130 127 127 127 127 127 127 127 123 123 119. That is the tempo
     * drifting, and drift is the one thing that reading was meant to avoid.
     *
     * Snapped at the next BAR rather than instantly, because a tempo change
     * inside a bar moves every scheduled event under itself. The bar line is
     * where the listener already expects something to happen, which is what
     * makes a discontinuity there read as a decision rather than a glitch.
     */
    // The whole point: line the drop up with the boss's first attack.
    this.arranger.scheduleDrop(t, e.etaSeconds);
  }

  onBossPhase(t: Transport, e: GameEvents['boss:phase']): void {
    this.bossPhase = e.phase;
    this.lastKey = '';
    this.tensionModel.jolt(0.35);
    this.arranger.request(t, 'drop', 'bar');
  }

  onBossDefeat(t: Transport): void {
    this.boss = false;
    this.arranger.request(t, 'breakdown', 'bar');
  }

  onPlayerHit(): void {
    this.tensionModel.jolt(0.4);
    this.p.concussion = 1;
    this.lastKey = '';
  }

  onPlayerDeath(t: Transport): void {
    this.collapsing = true;
    this.collapseSeconds = 0;
    this.arranger.collapse(t);
  }

  onRevive(): void {
    this.collapsing = false;
    this.collapseSeconds = 0;
    this.arranger.release();
    this.lastKey = '';
  }

  onPickup(t: Transport, kind: PowerupKind): void {
    this.tensionModel.jolt(0.15);
    // Force a rebuild so the new powerup's signature enters on the next bar.
    this.lastKey = '';

    // OVERDRIVE is the one powerup that does not add a sound — it forces a
    // section. It hands the player the engine's best trick: the drop is
    // normally something the game schedules for a boss, and this puts it on a
    // pickup. Maximum power and maximum music become the same moment.
    if (kind === 'overdrive') {
      this.tensionModel.jolt(0.55);
      /*
       * RATE-LIMITED, because OVERDRIVE stopped being an event.
       *
       * The comment above is the design and it is a good one: hand the player
       * the engine's best trick, make maximum power and maximum music the same
       * moment. It assumes OVERDRIVE is occasional. It is not, any more.
       *
       * `powerups.ts` moved nine of the eleven kinds onto the progression and
       * left them in the table at weight 0, so the random field pool is now
       * just BOMB (1.0) and OVERDRIVE (0.8) — 44% of every drop. Measured over
       * a 900s run: 95 OVERDRIVE pickups, one every 9.5 seconds, against a
       * duration of 12 seconds. **Its duration exceeds its own inter-arrival
       * time**, so it is not a powerup that fires often, it is a state that
       * never lapses: 52.8% of sampled bars had it active, and `drop` occupied
       * 64.2% of the run.
       *
       * That is worse than the 70% figure the arrangement rewrite was built to
       * fix, and it bypasses all of it — the section machine and the continuous
       * floors both. Every threshold tuned today governs what happens when
       * nothing is overriding the arrangement, and something was overriding it
       * more than half the time.
       *
       * A forced drop stays available, but no more than once per
       * `OVERDRIVE_DROP_COOLDOWN`. A trick the player sees every nine seconds
       * is not a trick, and the arrangement cannot mean anything if it is
       * pinned to its top rung by an item that is always held. The real fix is
       * the drop economy in `powerups.ts` — a 126% duty cycle is a gameplay
       * bug, not a mixing one — and that belongs to whoever owns balance; this
       * stops the music being the thing that shows it.
       */
      const now = this.runSeconds;
      if (now - this.lastOverdriveDrop >= OVERDRIVE_DROP_COOLDOWN) {
        this.lastOverdriveDrop = now;
        this.arranger.request(t, 'drop', 'immediate');
      }
    }
    // ENCORE arrives when the player is nearly dead: give them the full
    // breakdown-and-rebuild rather than a stinger, so the rescue is a musical
    // event and not just a health top-up.
    if (kind === 'encore') {
      this.arranger.request(t, 'breakdown', 'immediate');
      this.arranger.scheduleDrop(t, 4 * (60 / this.bpm) * BARS_PER_PHRASE * 0.25);
    }
  }

  /**
   * The band changed shape. Two musicians became one better one.
   *
   * The director had ten event hooks and none for this — a wave starting, a
   * boss telegraphing, a bomb, a powerup picked up off the floor all moved the
   * score, and the rarest and most deliberate decision in a run did not. In a
   * game whose premise is that the state generates the music, the biggest
   * state change was the one it could not hear.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO: request a section. `arranger.request(t,
   * 'drop', …)` is the engine's best trick and it is exactly what a union
   * deserves, but the drop economy has been expensive before — `drop` once
   * occupied 64.2% of a run and OVERDRIVE's duty had to be cut from 127% to
   * 13%. Fusions land about three times a run between them, which is enough to
   * matter. Forcing sections is the lever to reach for only with the section
   * share in front of you, and the response below is audible without it.
   *
   * Nor does it force a rebuild. It used to need to; it does not now that the
   * loadout is part of `structureKey`, which quantises the change to the next
   * bar — the tier this file reserves for "things the player did and should
   * hear about promptly".
   *
   * So: a swell, and a colour that outlasts it. The jolt sits on the scale
   * `onPickup` established (0.15 for a powerup, 0.55 for OVERDRIVE) and the
   * mode bias on the one `onWaveClear` established (-1.5 for a flawless wave,
   * negative being brighter). A union is worth both of their maxima, because
   * nothing else in a run costs as much to earn.
   *
   * BE HONEST ABOUT THE JOLT: measured, it does almost nothing HERE.
   *
   * `energy = max(sustained, progressFloor)`, and a jolt only lifts the danger
   * term. Fusions land at a median energy of 0.634 across eight runs, and at
   * that point the progress floor is what is setting it — so the swell raises
   * a number that is already being out-voted, and the measured change 0.5s
   * after a fusion was +0.003 for an evolution and -0.003 for a union. It is
   * kept because it is real where the floor is low (a jolt of 1.0 at energy
   * 0.12 lifts it to 0.39, so an early fusion does swell) and it costs
   * nothing, but it is NOT what makes a fusion audible mid-run.
   *
   * What does, today: the stinger in `main.ts`, the loadout entering the score
   * within a bar now that it is in `structureKey`, the ensemble gaining the
   * new voice, and the mode brightening at the next period. A section request
   * would be the immediate one and is deliberately refused above — measured,
   * the drop already holds 52.6% of every run (`tools/sections.mjs`), and the
   * comment in `arrangement.ts` calls a drop that never ends the volume knob.
   */
  onFusion(kind: 'evolution' | 'union' | 'lattice' | 'duet'): void {
    // A lattice is an AUTHORED result, so it swells like an evolution rather
    // than like the generic duet it replaces. Same tier of achievement, same
    // size of moment.
    const authored = kind === 'evolution' || kind === 'lattice';
    const swell = kind === 'union' ? 0.5 : authored ? 0.3 : 0.2;
    const lift = kind === 'union' ? -1.5 : authored ? -0.8 : -0.4;
    this.tensionModel.jolt(swell);
    // Brightening ACCUMULATES onto whatever the last wave earned rather than
    // replacing it, so fusing during a good run compounds instead of resetting.
    this.modeBias = clamp(this.modeBias + lift, -2.5, 2);
  }

  onBomb(t: Transport): void {
    this.tensionModel.jolt(0.5);
    // The screen-clear earns a drum fill on the spot.
    this.arranger.fill(t);
    this.lastKey = '';
  }

  // -------------------------------------------------------------------------

  /**
   * The actual notes each stem will play in the coming bar, by querying the
   * live patterns exactly as the scheduler does.
   *
   * This is the honest visualisation: a level meter shows how loud a layer is,
   * which is not what music *is*. This shows what is being played.
   */
  sampleBar(transport: Transport): Record<StemId, { t: number; n: number | null }[]> {
    const cycle = Math.floor(transport.bar);
    const out = {} as Record<StemId, { t: number; n: number | null }[]>;
    for (const id of STEM_IDS) {
      const rows: { t: number; n: number | null }[] = [];
      try {
        for (const hap of this.cache[id].queryArc(cycle, cycle + 1)) {
          if (!hap.hasOnset || !hap.hasOnset()) continue;
          const begin = hap.whole ? Number(hap.whole.begin.valueOf()) : Number(hap.part.begin.valueOf());
          const t = begin - cycle;
          if (t < 0 || t >= 1) continue;
          const raw = (hap.value as { note?: unknown }).note;
          rows.push({ t, n: typeof raw === 'number' ? raw : null });
          if (rows.length > 64) break;
        }
      } catch {
        // A stem that cannot be queried simply shows empty; never break the HUD.
      }
      out[id] = rows;
    }
    return out;
  }

  /**
   * The mini-notation this bar was actually built from, re-derived from the
   * same helpers the builders use. Showing the generated code is the most
   * direct way to make "this music is being written right now" legible.
   */
  sourceLines(): { label: string; code: string }[] {
    // The act's shape, for the same reason every other mirror in this method
    // reads the bucket rather than the raw value: the panel exists to show the
    // code that is playing, and this file and the builders have drifted apart
    // five times already.
    const progression = progressionFor(this.mode, ACT_SHAPE[this.act].shape);
    const chord = chordForBar(this.tonic, this.mode, progression, 0);
    const root = chord.root - 12;

    // Mirror the modifiers the builders apply, or the panel shows code that is
    // not the code being played — which defeats the point of showing it.
    /*
     * The MERGED kit, not `snapshot.powerups`.
     *
     * This read the raw field while the builders read the merge, so after the
     * progression migration `rapid` and `timewarp` — both rig ids, both
     * arriving only on `abilities` — were permanently 0 and false here. The
     * panel printed a kick pattern nobody was hearing, which is precisely the
     * failure the comment two lines up warns about, arriving by a route nobody
     * was watching. Found by `deadhunt` from the game side.
     */
    const powerups = kitOf(this.snapshot);
    const half = (powerups.timewarp ?? 0) > 0;
    /*
     * The bucket, not the raw value — the builders read the bucket.
     *
     * The panel exists to show the code that is actually playing, so a mirror
     * that quantises differently from the builder prints a kick pattern nobody
     * is hearing whenever the raw value sits the other side of a threshold from
     * its bucket. This file and the builders have drifted apart three times in
     * this project's history; see `tools/rapidair.mjs`.
     */
    const quantised = this.intensityBucket.value / 6;
    const kickIntensity = half ? Math.min(quantised, 0.3) : quantised;
    /*
     * THE FIFTH DRIFT, and the last one this line can have.
     *
     * This printed `white(4) + white(8)*n + white(16)*n` — a hi-hat. That lane
     * has not been a hi-hat since `buildHats` was deleted and the pulse
     * inverted: `STEM_LABELS.hats` reads MOTOR, `BUILDERS.hats` is
     * `buildMotor`, and `motorcheck` asserts all 15,092 of its note events are
     * chord tones inside MIDI 57-69. The panel was showing noise for the one
     * lane the entire refactor was about, in the UI whose whole purpose is to
     * show the player the code that is playing.
     *
     * The note above records three earlier drifts and was itself written while
     * fixing one. Restating the builders in this function is the bug; the line
     * now comes from `motorVoicing`, captured in `drainRebuild` from the exact
     * state the pattern was built from, so there is one source and no copy to
     * fall out of date.
     */

    return [
      { label: 'kick', code: `"${kickRhythm(kickIntensity, false, this.feel)}"` },
      { label: 'motor', code: `note("${this.motorLineText}").s("pulse")` },
      /*
       * THE STAB'S GUIDE TONES, from the function the lane itself calls.
       *
       * This line printed `chord.notes` as a `note("[...]")` voicing. It was
       * the fourth drift of this mirror when it added an octave the pad had
       * stopped adding, and it became the sixth the day the pad was deleted:
       * a voicing no lane sustains, shown as the code that is playing. The
       * chords lane IS the stab now, so what the stab plays is what the panel
       * shows — `stabGuideTones` in `layers.ts`, one function for both. Built
       * at bar 0 without voice leading, as before, so it is the phrase's first
       * chord as the stab would state it.
       */
      { label: 'chord', code: `note("[${stabGuideTones(chord).join(',')}]")` },
      { label: 'bass', code: `note("${root} ~ ${root} ~")` },
      { label: 'scale', code: `"${keyLabel(this.tonic, this.mode)}" · ${FEEL_LABELS[this.feel]}` },
    ];
  }

  readout(transport: Transport): DirectorReadout {
    const arr = this.arranger.state(transport);
    return {
      section: this.arranger.section,
      act: this.act,
      runPhrase: this.runPhrase,
      tacet: this.tacetLane,
      barsSinceQuiet: arr.barsSinceQuiet,
      forcedRests: arr.forcedRests,
      bpm: this.bpm,
      /*
       * The SOUNDING key, so `+ capo`. The transposition is applied where the
       * musical state is built, and reading the raw tonic here would print a
       * key the score is not in — the HUD would be confidently wrong for any
       * player holding CAPO, which is worse than not showing a key at all.
       */
      key: keyLabel(this.tonic + this.capo, this.mode),
      feel: FEEL_LABELS[this.feel],
      paletteHue: FEEL_HUES[this.feel],
      tension: this.p.tension,
      energy: this.energy,
      modeBias: this.modeBias,
      driver: TERM_LABELS[this.driver],
      leadRegister: this.leadRegister,
      harmonyReason:
        this.modeBias < -0.25 ? 'lifted — flawless wave' : this.modeBias > 0.25 ? 'darkened — took hits' : '',
      rawTension: this.tensionModel.rawValue,
      progressFloor: this.progressFloor,
      immediate: this.tensionModel.value,
      levels: this.levels,
      active: this.active,
      health: this.health,
      bar: Math.floor(transport.bar),
      beat: transport.beat,
    };
  }
}
