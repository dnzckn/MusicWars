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
    // The crack. 1.6-7kHz is where a snare's information is; above that is
    // spray, and spray on every backbeat is what makes a mix tiring.
    s('white')
      .struct(rhythm)
      .ds(`${(0.095 + bright * 0.03).toFixed(3)}:0`)
      .hpf(1600)
      .lpf(5200 + bright * 1800)
      .hpq(1.4)
      .gain(0.42),
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
export function hatLayer(struct: string, brightness: number, level: Patternable, velocity = 1): Pattern {
  return s('white')
    .struct(struct)
    .ds('0.018:0')
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


/** Ride-ish metallic ping via FM, used to add motion without more noise. */
export function metal(rhythm: Patternable, level = 0.2): Pattern {
  /*
   * A triangle carrier, not a square.
   *
   * FM on a square multiplies two harmonic series that are both already dense,
   * which is how you make a bell that sounds like a smoke alarm. A triangle
   * carrier keeps the inharmonic ring — that comes from `fmh`, not from the
   * carrier — with a fraction of the energy in the band the ear is most
   * sensitive to.
   */
  return note('c6')
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

/** Sub-bass sine on the given note pattern. The floor of the whole mix. */
export function sub(notes: Patternable, level = 0.7): Pattern {
  return note(notes)
    .s('sine')
    .attack(0.006)
    .decay(0.2)
    .sustain(0.8)
    .release(0.08)
    .gain(level)
    .orbit(ORBIT_LOW);
}
