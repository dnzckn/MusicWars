/**
 * The wub.
 *
 * Its own module rather than another entry in `kit.ts`, because a wobble bass
 * is not a drum: it is a whole voice design plus the phrase of LFO rates that
 * makes it a part rather than an effect. Eight bars of rate, waveform and skew
 * is composition, and it wants somewhere to live.
 *
 * The important discovery is that superdough has a real LFO on the low-pass
 * cutoff — `lpsync`, `lpdepth`, `lpshape`, `lpskew` — running in an AudioWorklet
 * and phase-locked to the cycle. That matters more than it sounds:
 *
 *   - It modulates the filter CONTINUOUSLY over a held note. The obvious
 *     alternative is to chop the bass into sixteenths and pattern `lpf` per
 *     hap, which is what you get from `lpf(sine.fast(8).range(...))` — but a
 *     control value in Strudel is read once per hap, so that is a sequence of
 *     stepped cutoffs with an amplitude envelope retriggering under every one
 *     of them. It sounds like a gate, not like a wobble. The difference between
 *     dubstep and a stutter effect is exactly this.
 *   - `lpsync` is in cycles, so the wobble is locked to the transport for free
 *     and stays locked when the director changes tempo.
 *
 * So: long notes, and the LFO plays the rhythm. That is what the genre actually
 * is — the bass part is written in filter movement, not in note onsets.
 */

import { note, perlin, sine, stack, type Pattern, type Patternable } from '@strudel/core';
import { ORBIT_LOW, ORBIT_ROOM } from './kit';

/** LFO waveform, as superdough's `lpshape` numbers them. */
export const WUB_TRI = 0;
export const WUB_SINE = 1;
export const WUB_RAMP = 2;
export const WUB_SAW = 3;
export const WUB_SQUARE = 4;

export interface Wub {
  /**
   * LFO cycles per bar. 4 is a quarter-note wobble, 8 is eighths, and 3 and 6
   * are the ones that lurch — three against a bar of four is the oldest funk
   * trick there is, and it is what stops a wobble sounding like a machine.
   */
  rate: number;
  /** Waveform: one of the WUB_* constants above. */
  shape: number;
  /**
   * Where the LFO turns around, 0..1. 0.5 is symmetric; below that it snaps
   * open and closes slowly, which reads as an accent rather than a sweep.
   */
  skew: number;
  /**
   * Where the LFO RESTS, -1..0 (superdough `lpdc`). Default -0.5 centres the
   * sweep on the cutoff. -1 rests the filter closed and opens it only in
   * bursts; with a saw shape that is "shut, snap open, fall back" — the
   * aggressive wobble contour, and different from anything `skew` can make.
   * Set by `wubFor` on the drop's answering bars only.
   */
  rest?: number;
}

/**
 * Eight bars of wobble, as a phrase.
 *
 * Every layer in this project is written across the eight-bar `cat` rather than
 * as a one-bar loop, and the bass has more to gain from that than anything
 * else: the notes barely move, so if the LFO does not develop then nothing
 * does. Read down the rate column and it is a period — a statement at a quarter
 * note, an answer at eighths, a middle that goes into three-against-four, and a
 * run-up on the last bar.
 *
 * Every rate is an integer, deliberately. The LFO takes its phase from the
 * cycle number, so an integer rate starts each bar at the same point in its
 * sweep and a fractional one does not — 16/3 is a lovely dotted-eighth wobble
 * and it arrives somewhere different every bar, which is indistinguishable from
 * sloppy.
 */
/*
 * ---------------------------------------------------------------------------
 * RE-CUT FOR CHEW: "i want my dubstep to be, chrunchy, munchy, juicy,
 * delicious wubs and dubs".
 * ---------------------------------------------------------------------------
 *
 * The SHAPE of the phrase is unchanged - statement, answer, three-against-four
 * in the middle, run-up on the fill bar - and the reasoning above it stands.
 * What changed is the ARTICULATION of every bar, which is `skew` and `shape`,
 * and it is the half of this table that carries "munchy".
 *
 * `lpskew` is where the LFO turns around, 0..1. At 0.5 the sweep is symmetric:
 * the filter takes as long to open as it does to close, which is a wobble that
 * BREATHES. Below that it snaps open and closes slowly, which is a wobble that
 * BITES - an accent with a decay rather than a swell. The old table sat at 0.5
 * on four of its eight bars and never went below 0.24; it is now 0.20-0.42 on
 * seven of eight, with the square gate the one thing left at 0.5 (a square has
 * no ramp for a skew to shorten, so the control does nothing there anyway).
 *
 * Two waveform swaps for the same reason. `WUB_SAW` is a ramp with a hard
 * reset - the filter falls away and then snaps back - which is the single most
 * characteristic wobble shape there is, and it appeared on exactly one bar of
 * eight. Bars 2 and 4 take it, so the phrase now alternates sweep and snap
 * rather than only changing speed.
 *
 * NOT HEARD. This is a written change to eight rows of a table.
 */
export const WUB_PHRASE: readonly Wub[] = [
  // 1 - state it plainly. Quarter notes, nearly symmetric, nothing clever.
  { rate: 4, shape: WUB_SINE, skew: 0.42 },
  // 2 - same rate, snapped, and on a ramp. Identical rhythm, hard edge: the
  // first thing that changes in the phrase is articulation, not speed.
  { rate: 4, shape: WUB_SAW, skew: 0.26 },
  // 3 - dotted eighths. Six against four is where the funk gets in.
  { rate: 6, shape: WUB_TRI, skew: 0.34 },
  // 4 - the answer, at eighths, and it bites rather than breathes.
  { rate: 8, shape: WUB_SAW, skew: 0.3 },
  // 5 - the lurch. Three per bar is a dotted quarter, so the wobble crosses
  // the barline's own pulse and drags.
  { rate: 3, shape: WUB_SINE, skew: 0.4 },
  // 6 - back to six, snapped as hard as this table goes.
  { rate: 6, shape: WUB_TRI, skew: 0.2 },
  // 7 - square. Not a sweep at all any more; a gate. Skew is inert on a square
  // and is left at 0.5 to say so.
  { rate: 8, shape: WUB_SQUARE, skew: 0.5 },
  // 8 - the run-up. Twelve is a sixteenth-note triplet, and it lands on the
  // fill bar, so the bass tips into the next phrase with everything else.
  { rate: 12, shape: WUB_SAW, skew: 0.28 },
];

/**
 * The wobble for one bar.
 *
 * `hard` is the drop. It doubles the rate on the answering bars only, rather
 * than on all of them — doubling the whole phrase turns a wobble into a hornet,
 * and the point of a drop is that it goes somewhere, which needs the bars
 * either side of it to have stayed put.
 */
export function wubFor(barInPhrase: number, hard: boolean): Wub {
  const w = WUB_PHRASE[barInPhrase % WUB_PHRASE.length];
  if (!hard || barInPhrase % 4 !== 3) return w;
  // Doubled rate AND a closed resting point: the answering bars of a drop do
  // not just go faster, they change contour. `docs/research-dubstep.md` R12.
  return { ...w, rate: w.rate * 2, rest: -1 };
}

export interface WubOpts {
  /** Which wobble this bar plays. */
  shape: Wub;
  /**
   * Centre cutoff — normally a signal, so the master filter still owns the
   * overall openness and the LFO swings around wherever it puts us.
   */
  cutoff: Patternable;
  /**
   * How far the LFO swings, as a multiple of the centre cutoff. superdough
   * offsets by ±depth/2, so 1.6 sweeps 0.2x to 1.8x. Ride this off intensity:
   * depth is the one dimension of a wobble that can move continuously without
   * changing a single note.
   */
  depth: Patternable;
  /** Ladder-filter drive. */
  drive: Patternable;
  level: Patternable;
  /**
   * Post-filter distortion amount, the "crunch". A SIGNAL, so the growl can be
   * clean in a breakdown and ruined at the drop on the same notes. This used to
   * be a fixed `'3.0:0.30'` because of a hazard AGENTS.md recorded for an older
   * superdough — see `wub()`.
   */
  crunch: Patternable;
  /** Reese spread in semitones, total across the two voices. See `reese()`. */
  width?: Patternable;
}

/**
 * The bass itself: one sawtooth through a resonant ladder with the LFO on it.
 *
 * Held, not plucked — `sustain(1)` and `clip(1)` so the note lasts its whole
 * hap. A percussive envelope here would fight the LFO for the rhythm and win,
 * and then there is no wobble, only a bass playing the notes it was given.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE TWO VOICES DO NOT WEAR A `TOUCH`, and what changed anyway
 * ---------------------------------------------------------------------------
 *
 * `articulation.ts` owns the amplitude envelope of every pitched lane in the
 * score. These two are the exception and it is the same exception the `rush`
 * motif takes: their rhythm is not made of note onsets. The part is composed in
 * FILTER MOVEMENT — `lpsync`/`lpdepth` on a ladder — so `clip` and `sustain`
 * are structural here rather than expressive, and a touch would replace the
 * instrument rather than articulate it.
 *
 * What DID change is the onset. 5 ms on a sawtooth at 110 Hz is half a cycle:
 * a step discontinuity, which is broadband, on the loudest thing in the bottom
 * of the mix, and `attackfloor` was reading it as 34% of the bass stem's haps
 * under the 20 ms floor. 32 ms is three and a half cycles of 110 Hz — still
 * instant against a note held for half a bar, and no longer a click. The
 * release is untouched: at 80 ms it already clears the recalibrated floor, and
 * on a lane whose notes are two per bar there is nothing for it to smear into.
 */
export function wub(notes: Patternable, o: WubOpts): Pattern {
  return (
    note(notes)
      /*
       * TWO OSCILLATORS, ONE VOICE — taken from the reference track the owner
       * sent (`dubbyflux`'s "dub"), whose bass is `.s("sawtooth,sine")`.
       *
       * A comma in `s()` is a mini-notation STACK, so this is the same note
       * sounded twice in the same lane, through the same ladder, the same LFO
       * and the same saturation. It costs one hap and no fader, and it is the
       * thing the genre is built on: a fundamental with body underneath the
       * part the filter is chewing. When the LFO slams the cutoff shut the
       * sawtooth's harmonics go with it and a sine at 110-220 Hz barely
       * notices, so the note keeps its weight through the closed half of every
       * wobble instead of disappearing into it.
       *
       * NOT THE SUB, and the distinction matters because the sub must stay
       * clean: `buildSub` is a separate lane, two octaves down, with no
       * distortion anywhere in its chain (`kit.sub`). This is the bass's own
       * fundamental and it is meant to be driven.
       */
      .s('sawtooth,sine')
      // 32 ms, not 5. See the note above: at 110 Hz, 5 ms is half a cycle.
      .attack(0.032)
      .decay(0.04)
      .sustain(1)
      .release(0.08)
      /*
       * `clip(0.72)`, NOT 1, AND THIS IS "MUNCHY".
       *
       * superdough starts the release at `begin + duration * clip`, so this is
       * how long the note actually IS. At 1 the note holds its whole slot and
       * the next one begins where it ends: the lane is a continuous tone that a
       * filter happens to be moving over. At 0.72, a quarter note at 140 BPM
       * (428 ms) sounds for 308 ms and releases over 80, leaving about 40 ms of
       * air before the next - so each note of the figure is a separate BITE
       * with the wobble inside it, rather than one unbroken sound with the
       * wobble printed across the bar.
       *
       * The paragraph below still holds: the amplitude envelope must not fight
       * the LFO for the rhythm. It does not. The LFO runs at four to twelve
       * cycles a bar and the figure is three or four events a bar, so what
       * `clip` cuts is the JOIN between notes and not the wobble inside one -
       * every note still gets a complete sweep at the phrase's slowest rate.
       */
      .clip(0.72)
      /*
       * NO HIGHPASS. There was a `.hpf(74)` here, "out of the sub's way, same
       * as the house bass" — and it was the same bug as the house bass, with
       * the same fix and the same reasoning. `buildBass` carries the long
       * version; the short one is that superdough has a single `ftype` control
       * shared by the lowpass and the highpass (`superdough.mjs:671` and :706
       * both map `model: 'ftype'`), and the ladder path in `createFilter`
       * returns before `filter.type = type` ever runs. `.hpf(74).ftype('ladder')`
       * was therefore a SECOND 24 dB/oct lowpass at 74 Hz, under a wobble
       * playing 110-165 Hz. Measured on this voice alone, real superdough
       * chain, before and after removing it:
       *
       *            rms   20-95Hz  95-250  250-1k   1k-6k
       *   with    -41.0    21.3    35.7    -2.0   -44.6
       *   without -21.5    29.7    55.2    47.4    28.9
       *
       * The lane was 20 dB down and had no harmonics at all, which for a part
       * whose entire content is a resonant peak sweeping through its harmonics
       * means it was not playing.
       *
       * KEEPING THE LADDER AND LOSING THE HIGHPASS IS THE RIGHT WAY ROUND HERE
       * even more clearly than on the house bass, because of `.lpq(7)` below.
       * A ladder turns q into a feedback coefficient — `k = min(8, q * 0.13)`,
       * so 7 becomes 0.91 — while a biquad turns Q7 into a ~17 dB peak. Swap
       * the model and the sweep stops being a filter you follow and becomes a
       * whistle: measured, dropping `.ftype('ladder')` puts +7.0 dB into
       * 1-6 kHz on this voice, which is the fatigue band the cutoff ceiling in
       * `buildBass` was capped to stay out of. And the highpass was buying
       * 2.5 dB of 20-95 Hz on notes whose lowest fundamental is 110 Hz — a
       * sawtooth has nothing below its own fundamental to remove.
       */
      .lpf(o.cutoff)
      /*
       * Q7 on a ladder, which is a lot, and is the sound.
       *
       * Everywhere else in this mix resonance is kept near flat, because a
       * resonant peak is a narrow band the ear cannot stop hearing. That is
       * exactly why it works here: the peak is what you follow as the LFO drags
       * it up and down, and it is the difference between a filter opening and a
       * bass talking. It stays under 2.2kHz (see the cutoff range in
       * `buildBass`) so it never parks in the fatigue band.
       */
      /* ====================================================================
        * ...AND IT DRIFTS, WHICH IS THE FIRST CONTINUOUS MODULATOR IN THE SCORE.
        * ==================================================================
        *
        * Counted across `src/audio` before this line: `sine.range` 0 uses,
        * `saw.range` 0, `tri.range` 0, `perlin` 0. **Every dial in five
        * thousand lines of score is driven top-down from game state or from
        * the bar number.** So every one of them is predictable, and a
        * standing hypothesis for why this music keeps reading as generated
        * through four rounds of re-voicing is not the timbres at all — it is
        * that nothing moves except when the game moves it.
        *
        * `perlin` is smooth random: a deterministic function of cycle time
        * (`@strudel/core/signal.mjs`, `getRandsAtTime(t, ...)` — no
        * `Math.random`, no wall clock, so every gate and every
        * `capture --verify-determinism` run still reproduces exactly). Over
        * seven bars it wanders the resonance between a firm peak and a very
        * sharp one, so no two passes of the eight-bar wobble phrase have the
        * same voice even where they have the same rate.
        *
        * The RANGE is the constraint. 7 is the number every paragraph in this
        * file is written about: `k = min(8, q * 0.13)` makes it 0.91 of
        * feedback in the ladder, which is a peak you follow rather than a
        * whistle. 5.5-8.5 keeps that character at both ends — 0.72 to 1.10 of
        * feedback — and 8.5 is where a ladder starts to sing rather than
        * merely resonate, which on a bass is the "juicy" the owner asked for
        * and is why it is the top of the range and not the middle.
        *
        * Seven bars, and the reese below runs eleven. Coprime, so the pair
        * never lines up inside a run.
        */
      .lpq(perlin.range(5.5, 8.5).slow(7))
      .ftype('ladder')
      .drive(o.drive)
      .lpsync(o.shape.rate)
      .lpdepth(o.depth)
      .lpshape(o.shape.shape)
      .lpskew(o.shape.skew)
      .lpdc(o.shape.rest ?? -0.5)
      /*
       * A REAL WOBBLE MOVES IN MORE THAN ONE DIMENSION. This one moved only in
       * filter. superdough has a tempo-synced amplitude LFO phase-locked to the
       * cycle, in the SAME units as `lpsync`, and nothing used it —
       * `docs/research-dubstep.md` R7.
       *
       * Same rate as the filter LFO, half a wobble OUT OF PHASE with it: the
       * amplitude punches at the moment the filter is closing, so the ear
       * hears two events per LFO cycle from one rate. That is "munchy" with
       * no extra speed, and it is why this reinforces the wobble rather than
       * competing with it — the argument elsewhere in this file that an
       * amplitude envelope must not fight the LFO for the rhythm is right, and
       * this is its one exception, because the tremolo runs at the LFO's own
       * rate.
       *
       * ONLY ON THE DROP'S ANSWERING BARS, which `wubFor` marks with
       * `rest: -1` alongside the doubled rate: the bars that already change
       * contour are the bars that get the bite. Elsewhere the depth is 0 and
       * the control is inert.
       *
       * TRAP: `tremolodepth` is squared by this project's gain curve
       * (engine.ts setGainCurve(x => x*x)), so 0.71 written is 0.5 effective.
       * 0.6 here is ~0.36 effective, the research's recommended -4 dB of
       * chew. Nothing warns.
       */
      .tremolosync(o.shape.rate)
      .tremolophase(0.5 / o.shape.rate)
      .tremoloshape(WUB_SAW)
      .tremoloskew(0.3)
      .tremolodepth(o.shape.rest === -1 ? 0.6 : 0)
      /*
       * (An earlier note here said this must never be near zero because the
       * waveshaper collapsed to silence at 0. Measured false for superdough
       * 1.3.0 — `docs/research-dubstep.md` §0.1 — and the crunch is a signal
       * that may reach 0.4 in a breakdown on purpose now.)
       */
      /*
       * 3.0, not 1.15 — AND THIS IS WHERE THE CRUNCH ACTUALLY IS, which was
       * settled by a render rather than by reading the source.
       *
       * superdough's voice chain is oscillator -> gain -> FILTER -> vowel ->
       * coarse -> crush -> DISTORT, so everything this makes is post-filter:
       * the ladder never sees it and the LFO cannot sweep across it. That
       * argues for putting the crunch in `.drive()` instead — and `buildBass`
       * records, with numbers, that doing so made the lane darker in every
       * band and 1.4 dB quieter, because the ladder's four poles sit after its
       * own saturation.
       *
       * Measured through the real chain, level-matched, this control does what
       * the drive could not: +6.1 dB at 2 kHz, +13.3 at 4 kHz, +19.4 at 8 kHz,
       * against +2.7 at the fundamental. See `buildBass` for the full table.
       *
       * THE SECOND NUMBER IS THE POSTGAIN AND IT IS DOING REAL WORK. At the
       * old 0.42 this change was +8 dB of overall level, which is a different
       * mix rather than a different timbre. 0.30 puts the lane 2.2 dB above
       * where it was and leaves the harmonics where the table above says.
       * `distortvol` is squared by superdough's gain curve, so it moves faster
       * than it looks.
       *
       * `distorttype` IS DELIBERATELY NOT SET, so this stays superdough's
       * default `scurve` soft clipper. `fold`, `sinefold` and `chebyshev` make
       * far more upper-order content and there is nothing after this node to
       * remove it; at 4 kHz this already reads -59 dBFS soloed, and the
       * 2.5-6 kHz band is the one `audiocheck` fails on and the one recorded
       * human complaint about this score's high end. A soft clipper's
       * harmonics fall away fast, which is the property that makes this
       * amount safe.
       *
       * IT MAY GO TO ZERO. The previous version of this comment said
       * `distort(0)` silences the voice; `docs/research-dubstep.md` §0.1
       * rendered it through superdough 1.3.0 and found `distort(0)` bit-identical
       * to no distort at all. The fixed `'3.0:0.30'` this replaces meant the
       * wub was as saturated in a breakdown as at the drop. `distortvol` is the
       * postgain the string form used to carry, and it is squared by this
       * project's gain curve (engine.ts) — 0.30 is really 0.09, as before.
       */
      .distort(o.crunch)
      .distortvol(0.30)
      .gain(o.level)
      /*
       * The same small room `buildBass` sends to, for the same reason.
       *
       * `registermap` grouped this voice as `bass/sine` and read `room 0.00`.
       * The halftime feel is 27.8% of the bars in the game by the recorded
       * rota, so a bone-dry lane here is a bone-dry low end for a quarter of
       * every run while the pad above it sends 0.58. One room, one building.
       * Small (size 2) because a long tail on a wobble fills the gaps the LFO
       * cuts, and the gaps ARE the part.
       */
      .room(0.1)
      .roomsize(ORBIT_ROOM[ORBIT_LOW])
      .orbit(ORBIT_LOW)
  );
}

/**
 * The Reese on top: two detuned saws an octave up, on their own LFO.
 *
 * Two things make this worth a second voice rather than more gain on the first.
 * The detune beats at a few Hz, which is the growl — a single saw through a
 * moving filter is clean, and clean is the one thing this bass must not be. And
 * its LFO runs at a *related but different* rate to the main one, so the two
 * sweeps drift in and out of phase across the bar. That interference is the
 * whole reason a real wobble sounds alive; one LFO is a siren.
 *
 * Octave up, so it is all growl and no weight: the bottom belongs to the layer
 * below and to the sub, and this is the part you actually hear on a phone.
 *
 * THE REGISTER DOES THAT JOB, NOT A FILTER. This used to say "and high-passed
 * at 180" and carry a `.hpf(180)`, which — with `.ftype('ladder')` below and
 * superdough's one shared filter model — was a 24 dB/oct LOWPASS at 180 Hz on
 * a voice sounding at 220-330 Hz. Measured on this voice alone it cost 21 dB
 * of level and 30 dB of the 250 Hz-1 kHz band: rms -51.2 with it, -34.7
 * without. See `wub` above and `buildBass` for the mechanism.
 *
 * Removing it loses nothing it claimed to do. With no highpass at all this
 * voice measures -8.0 dB in 20-95 Hz against 40.5 dB in 95-250 — 48 dB of
 * separation that the octave transpose had already produced. A highpass at
 * 180 Hz under a 220 Hz supersaw was always close to a no-op; the comment was
 * crediting the filter for what the `.add(note(12))` above it was doing.
 */
export function reese(notes: Patternable, o: WubOpts): Pattern {
  // Two thirds the main rate, rounded to something that still divides the bar.
  // Not half, which locks in phase and cancels the point of the exercise.
  const rate = o.shape.rate === 3 ? 4 : Math.max(2, Math.round((o.shape.rate * 2) / 3));
  return note(notes)
    .add(note(12))
    .s('supersaw')
    .unison(2)
    /*
     * `.detune(d)` on supersaw is `freqspread` in SEMITONES, total across the
     * voices — so 0.14 was +-0.07 semitones = +-7 cents, a 1.78 Hz beat at
     * 220 Hz, the bottom of "subtle" in every source and half the canonical
     * spread. 0.36 is +-18 cents, 4.57 Hz of beating, inside the +-15..30
     * cent range the literature calls useful. A signal from `buildBass` so
     * the drop widens it. `docs/research-dubstep.md` R11, which also warns:
     * the two voices' phase relationship is random and sticky across pooled
     * reuse, so single-note renders of this voice do not reproduce — judge it
     * over bars, not notes.
     */
    .detune(o.width ?? 0.36)
    .spread(0.7)
    // 36 ms, not 12. The growl is an octave up, so it can afford a slightly
    // longer onset than the fundamental and still arrive with it.
    .attack(0.036)
    .decay(0.1)
    .sustain(0.95)
    .release(0.12)
    // Shorter than the fundamental's 0.72, so the growl lets go before the note
    // underneath it does and the join between notes is the fundamental alone.
    // See the `clip` note in `wub`.
    .clip(0.66)
    .lpf(o.cutoff)
    /*
     * 6.5, not 5 - "juicy" is resonance, and this is the voice that can afford
     * it. A ladder turns q into a feedback coefficient (`k = min(8, q * 0.13)`,
     * so 6.5 is 0.845) which is a peak you follow, rather than the ~16 dB spike
     * a biquad would give at the same number. It stays under the fundamental's
     * 7 so the two peaks are not sitting on top of each other.
     */
    /*
     * 5.2-7.4 on an eleven-bar sine, against the fundamental's seven-bar
     * perlin. Two resonances drifting on coprime periods is the same trick as
     * the two LFO rates below and for the same reason: one modulator is an
     * effect, two that never line up are a voice. It stays under the
     * fundamental's range so the two peaks are not sitting on top of each
     * other. See the note in `wub`.
     */
    .lpq(sine.range(5.2, 7.4).slow(11))
    .ftype('ladder')
    .drive(o.drive)
    .lpsync(rate)
    .lpdepth(o.depth)
    .lpshape(WUB_TRI)
    .lpskew(0.5)
    // Shares the wub's crunch signal; the octave-up growl takes the same drive
    // and a hair less postgain, as its fixed string form did.
    .distort(o.crunch)
    .distortvol(0.28)
    .gain(o.level)
    // See `wub`. The growl sits an octave up and takes slightly more of the
    // room for it, which is the ordinary way a mix is depth-staged: the higher
    // a source, the more of the space you hear around it.
    .room(0.14)
    .roomsize(ORBIT_ROOM[ORBIT_LOW])
    .orbit(ORBIT_LOW);
}

/** Both halves of the voice, which is how it is nearly always wanted. */
export function wubStack(notes: Patternable, o: WubOpts, reeseLevel: Patternable): Pattern {
  return stack(wub(notes, o), reese(notes, { ...o, level: reeseLevel }));
}
