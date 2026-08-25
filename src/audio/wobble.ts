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

import { note, stack, type Pattern, type Patternable } from '@strudel/core';
import { ORBIT_LOW } from './kit';

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
export const WUB_PHRASE: readonly Wub[] = [
  // 1 — state it plainly. Quarter notes, symmetric, nothing clever.
  { rate: 4, shape: WUB_SINE, skew: 0.5 },
  // 2 — same rate, snapped. Identical rhythm, harder edge: the first thing that
  // changes in the phrase is articulation, not speed.
  { rate: 4, shape: WUB_SINE, skew: 0.3 },
  // 3 — dotted eighths. Six against four is where the funk gets in.
  { rate: 6, shape: WUB_TRI, skew: 0.42 },
  // 4 — the answer, at eighths.
  { rate: 8, shape: WUB_SINE, skew: 0.38 },
  // 5 — the lurch. Three per bar is a dotted quarter, so the wobble crosses the
  // barline's own pulse and drags.
  { rate: 3, shape: WUB_SINE, skew: 0.5 },
  // 6 — back to six, snapped hard.
  { rate: 6, shape: WUB_TRI, skew: 0.24 },
  // 7 — square. Not a sweep at all any more; a gate.
  { rate: 8, shape: WUB_SQUARE, skew: 0.5 },
  // 8 — the run-up. Twelve is a sixteenth-note triplet, and it lands on the
  // fill bar, so the bass tips into the next phrase with everything else.
  { rate: 12, shape: WUB_SAW, skew: 0.5 },
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
  return { ...w, rate: w.rate * 2 };
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
}

/**
 * The bass itself: one sawtooth through a resonant ladder with the LFO on it.
 *
 * Held, not plucked — `sustain(1)` and `clip(1)` so the note lasts its whole
 * hap. A percussive envelope here would fight the LFO for the rhythm and win,
 * and then there is no wobble, only a bass playing the notes it was given.
 */
export function wub(notes: Patternable, o: WubOpts): Pattern {
  return (
    note(notes)
      .s('sawtooth')
      .attack(0.005)
      .decay(0.04)
      .sustain(1)
      .release(0.08)
      .clip(1)
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
      .lpq(7)
      .ftype('ladder')
      .drive(o.drive)
      .lpsync(o.shape.rate)
      .lpdepth(o.depth)
      .lpshape(o.shape.shape)
      .lpskew(o.shape.skew)
      /*
       * Never near zero — superdough builds its waveshaper curve from this
       * value and the curve collapses to silence at 0. 1.15 is barely past
       * unity and adds the second and third harmonics that let a bass read on a
       * laptop speaker at all.
       */
      .distort('1.15:0.42')
      .gain(o.level)
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
    .detune(0.14)
    .spread(0.7)
    .attack(0.012)
    .decay(0.1)
    .sustain(0.95)
    .release(0.12)
    .clip(1)
    .lpf(o.cutoff)
    .lpq(5)
    .ftype('ladder')
    .drive(o.drive)
    .lpsync(rate)
    .lpdepth(o.depth)
    .lpshape(WUB_TRI)
    .lpskew(0.5)
    .distort('1.2:0.4')
    .gain(o.level)
    .orbit(ORBIT_LOW);
}

/** Both halves of the voice, which is how it is nearly always wanted. */
export function wubStack(notes: Patternable, o: WubOpts, reeseLevel: Patternable): Pattern {
  return stack(wub(notes, o), reese(notes, { ...o, level: reeseLevel }));
}
