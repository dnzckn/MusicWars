/**
 * A drum kit synthesised from oscillators and noise.
 *
 * Strudel ships no samples and loads none at boot, so `s("bd")` throws. That
 * turns out to be a feature here: everything below is generated from
 * `superdough`'s built-in sources, so the game has no audio assets, works
 * offline, and every drum is parameterised — the kick can get harder and the
 * hats brighter as a continuous function of how much trouble the player is in.
 *
 * `s("sbd")` is the one built-in synthesised drum, but its pitch envelope is
 * fixed in ways that make it hard to push, so the kick here is built by hand
 * from a sine with a steep downward pitch envelope, which is what a kick is.
 */

import { s, note, stack, type Pattern, type Patternable } from '@strudel/core';

export const ORBIT_DRUMS = 1;
export const ORBIT_LOW = 2;
export const ORBIT_HARMONY = 3;
export const ORBIT_AIR = 4;

/**
 * Kick. `weight` 0..1 moves it from a soft house thump to a distorted
 * hard-dance kick: longer pitch drop, more saturation, tighter body.
 */
export function kick(rhythm: Patternable, weight = 0.5): Pattern {
  // Softened deliberately. The previous settings (penv up to 48, distort up to
  // 14, gain 0.92) were a hard-dance kick, and stacked with the sub they put
  // ~45% of the mix's entire energy below 250Hz — which is what "DUN DUN DUUN"
  // actually sounds like. A kick's job is to mark time, not to be the song.
  const penv = 20 + weight * 10;
  const pdec = 0.1 - weight * 0.03;
  const dec = 0.3 - weight * 0.07;
  const drive = 1.1 + weight * 2.2;
  return note(rhythm)
    .s('sine')
    .penv(penv)
    .pdecay(pdec)
    .pcurve(1)
    .decay(dec)
    .sustain(0)
    .distort(`${drive.toFixed(2)}:0.34`)
    .gain(0.8)
    .orbit(ORBIT_DRUMS);
}

/**
 * The backbeat. Named `clap` because the stem is, but it is a SNARE now.
 *
 * The rhythm this plays — `~ x ~ x`, beats two and four — is right and always
 * was: a rock backbeat is exactly what the 8- and 16-bit canon puts there on
 * the rare occasions it has a kit at all. What was wrong was the sound.
 *
 * `ply(3)` is the tell. Splitting one noise burst into three flams is how you
 * synthesise a TR-909 handclap, and it is the only reason to do it — a clap is
 * several pairs of hands not quite together, and the flam is that. There is no
 * handclap anywhere in Chrono Trigger, Castlevania, Mega Man or Link's
 * Awakening. It is a drum-machine object, it announces itself as one inside a
 * single bar, and it was sitting on half the beats in the game.
 *
 * So: one hit, not three. Noise for the crack, band-limited to where a snare
 * actually speaks, plus a short tuned body underneath — the same two-part
 * construction as `snare()` below, kept deliberately close to it so the kit
 * sounds like one instrument rather than two. The old comment's finding stands
 * and is preserved: the narrow `bpq` was throwing away most of the signal
 * before the gain stage saw it, so the band stays open.
 *
 * `bright` still opens the top, which is what the intensity dial was moving.
 */
export function clap(rhythm: Patternable, bright = 0.5): Pattern {
  return stack(
    /*
     * The crack. 1.6-7kHz is where a snare's information is; above that is
     * spray, and spray on every backbeat is what makes a mix tiring.
     *
     * The ceiling moves up by about an octave anyway, and the reason is a
     * measurement rather than a preference. Rendered through the real chain,
     * the full mix carries **3.2% of its energy above 2 kHz** across the 2k,
     * 4k, 8k and 16k octave bands combined — that is what "dull" is. This
     * burst and the drop-bar crash are the only broadband sources left in the
     * whole score since `buildHats` was deleted, and this one is the only one
     * that plays every bar. At 5200 the old ceiling put the top of the crack
     * inside the 4 kHz band, which measures 0.4% of the mix; 6800 puts it
     * across the 4k band properly and touches the 8k.
     *
     * It is still band-limited and it is still two hits a bar, which is the
     * difference between a bright backbeat and a hi-hat: the fatiguing thing
     * is a continuous high-passed noise source, not a transient one.
     */
    s('white')
      .struct(rhythm)
      .ds(`${(0.095 + bright * 0.03).toFixed(3)}:0`)
      .hpf(1600)
      .lpf(6800 + bright * 2600)
      .hpq(1.4)
      /*
       * 0.42 -> 0.62, and this is where the mix's air actually comes from.
       *
       * The comment above opened the CEILING on this burst and left its level
       * alone, which was half the job. Measured since, with every stem
       * rendered soloed through the real chain and the mix reconstructed from
       * them (`tools/capture.mjs`, 32 bars, world seed 0x51ed):
       *
       *   - This lane is **85% of its own energy above 2 kHz** (2k 26.6%,
       *     4k 26.5%, 8k 31.0%, 16k 1.3%) — the only lane in the score of
       *     which that is remotely true. The three lanes that ARE the mix are
       *     97%, 99% and 92% BELOW 2 kHz.
       *   - It owns **72% of the mix's 8 kHz band and 49% of its 16 kHz band**.
       *   - And it sits at **-48.6 dBFS in-mix, 22 dB under the bass**. A
       *     backbeat 22 dB under the bass is not a backbeat.
       *
       * So the one source of air in the score was turned down 22 dB below the
       * loudest lane, and "there is almost nothing above 2 kHz" is mostly that
       * sentence. Gain is squared by `setGainCurve`, so 0.42 -> 0.80 is
       * +11.2 dB of energy, not +5.6.
       *
       * 0.62 was tried first and measured, which is the only reason 0.80 is
       * here: soloed, the 4k/8k/16k bands moved +5.3/+5.5/+5.4 dB, and in the
       * FULL MIX the 8 kHz band went 0.1% -> 0.2% while "above 2 kHz" went
       * 2.7% -> 3.5%. Right direction and too small, because the 2 kHz band is
       * 86% of "the air" and this lane owns 2% of THAT band — the rest of the
       * gain has to come from a pitched source, and does (see `decor` in
       * `buildLead`). 0.80 puts this lane near -38 dBFS in-mix against the
       * bass's -26: a backbeat 12 dB under the bass.
       */
      .gain(0.8),
    // The body: a short tuned thud so the backbeat has pitch as well as noise.
    // Without it a snare is a hiss, and a hiss does not carry a groove.
    note('e3')
      .struct(rhythm)
      .s('triangle')
      .ds('0.07:0')
      .penv(9)
      .pdecay(0.028)
      .gain(0.22),
  )
    .room(0.2)
    .orbit(ORBIT_DRUMS);
}

/** Snare: noise for the crack plus a tuned triangle for the body. */
export function snare(rhythm: Patternable, weight = 0.5): Pattern {
  return stack(
    // 8.5kHz rather than 11: the crack is defined by the 2-5kHz band, and the
    // octave above it is spray that costs nothing to lose.
    s('white').struct(rhythm).ds('0.13:0').hpf(1500).lpf(8500).hpq(2.2).gain(0.36),
    note('d3').struct(rhythm).s('triangle').ds('0.08:0').penv(12).pdecay(0.03).gain(0.26),
  )
    // Below ~1 this attenuates rather than colours: superdough builds the
    // waveshaper curve from this value, and it collapses to silence at 0.
    .distort(`${(1.1 + weight * 1.4).toFixed(2)}:0.4`)
    .room(0.2)
    .orbit(ORBIT_DRUMS);
}

/**
 * Closed hats. `div` is hits per bar (2, 4, 8, 16...). `openness` lets a few of
 * them ring, which is most of what separates a driving hat line from a
 * metronome.
 */
/**
 * One layer of the hi-hat grid, on a fixed sixteenth-note lattice.
 *
 * The whole hat part used to be `s("white*div")` with `div` chosen from
 * intensity — and that is a REPLACEMENT, not a change of density: at eighths
 * every hap is 1/8 long, at sixteenths every hap is 1/16, so not one hit
 * survives the step even though half of them land at the same instant.
 * `tools/retention.mjs` measured the result as the worst lane in the mix, 45%
 * nested against 100% for the kick and the clap.
 *
 * Fixing it means the lattice has to be constant and the layers have to stack:
 * quarters always, eighths and sixteenths fading in over them. Every hit then
 * keeps its position AND its length as the part gets busier, which is what a
 * producer means by opening up a hi-hat. The envelope is 18ms regardless, so a
 * hap's length was never audible in the first place — only its onset was — and
 * this costs nothing musically.
 */
/*
 * `decay` was the constant `0.018` and the doc comment two blocks up has always
 * promised that "`openness` lets a few of them ring, which is most of what
 * separates a driving hat line from a metronome". That parameter was written
 * for a function that no longer exists; this one had no way to express it, so
 * every hat in the score was the same 18 ms tick. An 18 ms hat is a closed hat
 * and a closed hat only — the open/closed alternation is the single oldest
 * device in hi-hat writing and it was unavailable.
 *
 * A number rather than a signal, because the caller picks it PER LAYER: the
 * grid's accents ring, its bed ticks, and its ratchets tick shorter still. See
 * `percGrid` in `layers.ts`.
 */
export function hatLayer(
  struct: string,
  brightness: number,
  level: Patternable,
  velocity = 1,
  decay = 0.018,
): Pattern {
  return s('white')
    .struct(struct)
    .ds(`${decay.toFixed(3)}:0`)
    /*
     * The top comes down to 10.5kHz.
     *
     * Noise stretching to 13kHz is glare rather than air: nothing musical lives
     * up there, and on small speakers and cheap headphones it is the first
     * thing that turns into hiss. The hat still opens and closes across
     * `brightness`; it just stops reaching for the ceiling.
     */
    .hpf(7000 + brightness * 2400)
    .lpf(10500)
    .hpq(1.4)
    .velocity(velocity)
    .gain(level)
    .pan(0.56)
    .orbit(ORBIT_AIR);
}

/** The sixteenth-note lattice the hat layers interleave on. */
export const HAT_QUARTERS = 'x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~';
export const HAT_EIGHTHS = '~ ~ x ~ ~ ~ x ~ ~ ~ x ~ ~ ~ x ~';
export const HAT_SIXTEENTHS = '~ x ~ x ~ x ~ x ~ x ~ x ~ x ~ x';


/**
 * Ride-ish metallic ping via FM, used to add motion without more noise.
 *
 * `pitch` was `'c6'` and nothing else, because the only caller was a ride
 * cymbal and a ride has no pitch anyone listens to. It is a parameter now
 * because `percGrid` uses this as a BELL — an inharmonic chord tone on the
 * grid — and a bell fixed at C6 against a moving harmony is a wrong note
 * played once a bar. The default is the old value, so the ride reading is
 * unchanged for anything that calls this with two arguments.
 *
 * `fmh(3.7)` is what makes it inharmonic: the modulator sits at 3.7x the
 * carrier, which is not a member of the carrier's harmonic series, so the
 * partials it produces are struck-metal rather than sung. That is the same
 * mechanism as a tubular bell or a prepared piano, and it is the reason this
 * can state a chord tone without reading as another synth lane.
 */
export function metal(rhythm: Patternable, level = 0.2, pitch: Patternable = 'c6'): Pattern {
  /*
   * A triangle carrier, not a square.
   *
   * FM on a square multiplies two harmonic series that are both already dense,
   * which is how you make a bell that sounds like a smoke alarm. A triangle
   * carrier keeps the inharmonic ring — that comes from `fmh`, not from the
   * carrier — with a fraction of the energy in the band the ear is most
   * sensitive to.
   */
  return note(pitch)
    .struct(rhythm)
    .s('triangle')
    .fm(5)
    .fmh(3.7)
    .ds('0.05:0')
    .hpf(6000)
    .gain(level)
    .orbit(ORBIT_AIR);
}

/**
 * Riser. `progress` is a 0..1 pattern (usually a signal reading the build's
 * progress) so the sweep tracks the real length of the build rather than a
 * fixed number of bars.
 */
export function riser(progress: Pattern): Pattern {
  return s('white')
    .struct('x')
    .clip(1)
    .hpf(progress.range(300, 8000))
    // Q6 on a sweeping filter is a howl that tracks straight through the
    // fatigue band. The gesture is the sweep, not the resonance.
    .hpq(2.5)
    .gain(progress.range(0.04, 0.32))
    .room(0.55)
    .roomsize(6)
    .pan(0.5)
    .orbit(ORBIT_AIR);
}

/** Downlifter / impact for the first beat of a drop. */
export function impact(level = 0.6): Pattern {
  return stack(
    s('white').struct('x ~ ~ ~').ds('1.1:0').lpf(5000).gain(level * 0.5).room(0.7).roomsize(8),
    note('c2')
      .struct('x ~ ~ ~')
      .s('sine')
      .penv(-24)
      .pdecay(0.5)
      .pcurve(1)
      .decay(0.9)
      .sustain(0)
      .gain(level * 0.6),
  ).orbit(ORBIT_AIR);
}

/**
 * Sub-bass sine on the given note pattern. The floor of the whole mix.
 *
 * ---------------------------------------------------------------------------
 * THE ENVELOPE IS THE TIMBRE HERE, because a sine has no other one.
 * ---------------------------------------------------------------------------
 *
 * This lane emits MIDI 26-45 — 41 to 110 Hz. One cycle of 50 Hz is TWENTY
 * MILLISECONDS. An `attack(0.006)` therefore gates the oscillator on in under
 * a third of a cycle, which is not an attack at all: it is a step
 * discontinuity, and a step in a waveform is broadband. Every harmonic that
 * click contains is above the note, in the register the ear is most sensitive
 * in, on the loudest lane in the bottom of the mix, two to eight times a bar.
 *
 * The `release(0.08)` did the same thing at the other end — 80 ms is four
 * cycles, so the note is cut off mid-swing and the discontinuity is
 * proportional to wherever in the cycle it happened to be.
 *
 * That is the mechanism behind "the pinging noise is just really bad base type
 * of sound": a pure sine cannot ping, but the switch turning it on and off can,
 * and nothing else in the low end is loud enough to mask it.
 *
 * 24 ms in and 180 ms out is roughly one cycle and nine — enough that the
 * ramp is longer than the waveform it is ramping, which is the actual rule for
 * envelopes below 100 Hz and is why real sub patches are always slow. It costs
 * the transient, and the transient is the kick's job: `buildKick` is a
 * synthesised sine drop with its own 4 ms attack sitting on top of this, so the
 * attack a listener hears on the downbeat is unchanged.
 *
 * The release is BOUNDED BY THE PART, not chosen for its own sake. `buildSub`'s
 * densest lattice puts notes two eighths apart — 460 ms at 130 bpm — and a hap
 * that long plus a 180 ms tail is 410 ms, so the floor is continuous without
 * two different sub pitches ever sounding at once. Intermodulation between two
 * tones an octave and a fifth apart at 50 Hz is the other way this lane can
 * turn to mud, and it is the one a longer tail would cause.
 *
 * NOT `.ds()`. That control sets decay and sustain ONLY and lets attack and
 * release fall through to superdough's grouped defaults (AGENTS.md §4) — which
 * is exactly how the loudest pitched lane in the game ran a 1 ms attack for the
 * project's whole life. All four are set explicitly.
 *
 * AND IT STAYS DRY, deliberately, while the bass, the motor and the arp were
 * all given a room in the same pass.
 *
 * `registermap`'s room column read `room 0.00` on eight of fifteen voice groups
 * and the reference corpus uses `.room()` in 55 songs of 60, so the count is
 * worth moving — but not by moving THIS lane, and a count moved for its own
 * sake is the "gates optimised against" failure. Reverb is a set of delayed,
 * filtered copies; on a source that is a single sine below 110 Hz those copies
 * arrive within a fraction of a cycle of each other and sum as comb filtering
 * on the fundamental, which is a pitch-legibility problem rather than a sense
 * of space. Every mix engineer's rule is the same one: the sub is the driest
 * thing in the record. The three groups left dry after that pass are this one,
 * the kick and the noise clap, and all three are dry on purpose.
 *
 * MEASURED: nothing. This is arithmetic on the period of a 50 Hz wave and a
 * reading of superdough's envelope code. Nobody has heard it.
 */
export function sub(notes: Patternable, level = 0.7): Pattern {
  return note(notes)
    .attack(0.024)
    .decay(0.25)
    .sustain(0.85)
    .release(0.18)
    .s('sine')
    .gain(level)
    .orbit(ORBIT_LOW);
}
