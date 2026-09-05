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
 *
 * ---------------------------------------------------------------------------
 * AND NOW A SAMPLED KIT ON TOP OF IT (2026-09-05)
 * ---------------------------------------------------------------------------
 *
 * Everything above is still true and is now the FALLBACK. The owner's word
 * was "music still needs to be a lot better, sounds cheapy", and all four
 * references they pasted play their drums from sampled drum machines
 * (TR909, TR808, LinnDrum — `scratchpad/refs/references.md`). The capture of
 * this score was `white×991` haps against 28 sampled ones, and every one of
 * those white haps was this file. So each drum function below has two
 * bodies: when `kitReady()` is true (`src/audio/samples.ts` — all nine
 * one-shots decoded and resident) it emits `s('mw_bd909')` and friends; when
 * it is not, it emits exactly the oscillator it emitted before this note was
 * written. Offline, and for the first ~0.2-3 s after START, the second body
 * is what plays; `tools/kitcheck.mjs` queries both.
 *
 * WHAT THE SAMPLED BODIES DO NOT CARRY, and why: no `.ds()`, no `penv`, no
 * band-pass. On a sample, `decay` with `sustain 0` is a gain envelope that
 * CUTS the file after `decay` seconds (`sampler.mjs:288`, `:318`), so the 46
 * ms hat decay that shaped a noise burst would truncate a 909 hat to its
 * first 46 ms; and the 7-10 kHz band that turned white noise into a hat
 * would remove most of a hat sample. A sample plays its whole slice unless
 * `clip` is set (`sampler.mjs:314-316`); the open hat is the one drum that
 * sets it. The sidechain, the room sends and the orbits are the same on
 * both bodies, because they are properties of the PART, not of the sound.
 */

import { s, note, silence, stack, type Pattern, type Patternable } from '@strudel/core';
import { articulate } from './articulation';
import { kitReady } from './samples';

export const ORBIT_DRUMS = 1;
export const ORBIT_LOW = 2;
export const ORBIT_HARMONY = 3;
export const ORBIT_AIR = 4;
/*
 * THE FIFTH ORBIT, AND THE NOTE BELOW SAID EXACTLY WHEN IT WOULD BE JUSTIFIED:
 * "if a lane ever genuinely needs a fifth space. Adding one costs one IR
 * built once." The sub is that lane — not for a space (it is dry) but for the
 * SIDECHAIN. The kick ducks the low orbit under every hit, and the genre
 * wants two different depths there: 8-12 dB on the growl, 1-2 dB on the sub
 * (`docs/research-dubstep.md` R1). While both shared ORBIT_LOW the duck was a
 * compromise at -6 dB. Now the growl takes -9.7 dB and the sub is left
 * alone, which is what keeps the low end continuous while the mid-bass
 * breathes.
 */
export const ORBIT_SUB = 5;

/* ===========================================================================
 * THE ROOM IS A PROPERTY OF THE ORBIT, NOT OF THE LANE.
 * ===========================================================================
 *
 * MEASURED, AND IT IS THE LARGEST SINGLE PERFORMANCE DEFECT IN THE PROJECT.
 * A V8 CPU profile of a live wave-8 run puts reverb-impulse-response
 * construction at **4,786 ms of 7,552 ms of all JavaScript in a fifteen-second
 * window — 63% of JS and 31% of wall clock**, measured under SwiftShader, so
 * the share on a real GPU is higher. `tools/reverbchurn.mjs` counts the cause
 * off the haps: **21.4 impulse-response rebuilds per bar**, against a budget of
 * zero.
 *
 * THE MECHANISM, read out of `superdoughoutput.mjs:69` rather than guessed.
 * superdough keeps ONE reverb node per orbit, and any hap whose room SHAPE
 * differs from the previous hap on that orbit calls `reverbNode.generate(...)`
 * synchronously on the main thread. The dominant cost is not even the noise
 * fill: it is `convolver.buffer = ...`, because assigning a buffer to a
 * ConvolverNode makes Web Audio normalise it and build the partitioned FFT
 * kernel inline, and an eight-second stereo IR at 48 kHz is 768k samples of
 * that. There is no cheaper way to rebuild one. Only not rebuilding helps.
 *
 * So the orbits — which already existed and already expressed the intent —
 * become the unit of REVERB as well as of send. Four orbits, four impulse
 * responses, each built once for the life of the page.
 *
 * WHAT THIS DOES NOT FLATTEN. `.room()` is the SEND AMOUNT and is not part of
 * the IR key at all, so it never rebuilds anything: every lane keeps its own
 * depth in the shared space, and the arp's "same room, further from the
 * microphone" (send 0.24 against the pad's 0.58) is untouched. All 32 `.room()`
 * calls in the score are unchanged. What is gone is thirteen lanes each
 * declaring a different room SIZE, including three lanes that disagreed with
 * themselves across sections.
 *
 * THE FOUR SIZES, and why each (two of them halved on 2026-09-05 — see the
 * paragraph after the table):
 *
 *   DRUMS   2.5 Was 5: the half-time snare is the one drum in this score
 *               written for a room ("one enormous hit, and space either side
 *               of it") and it asked for 5 when it was a noise burst alone on
 *               this orbit. It is a 909 snare-and-clap stack now (`clap()`
 *               below), the backbeat on EVERY feel sends 0.2 into this IR and
 *               the rim ghosts send it too — and a 5 s tail under two hits a
 *               bar at 135 bpm is a wash that never clears before the next
 *               hit (a bar is 1.78 s). The references put their claps in a
 *               `room(.1)` to `room(.3)` at superdough's DEFAULT size, which
 *               is 2 (`reverb.mjs:28`, `generate(d = 2, ...)`), and reference B's
 *               `rsize(2)` is the only size any of them names. 2.5 keeps the
 *               half-time hit's tail longer than a bar and lets the ordinary
 *               backbeat read as a hit in a room rather than a hit in a hall.
 *               The half-time send stays 0.44 (`buildClap`): a send is a
 *               ratio, and halving the IR halves the tail's ENERGY on its
 *               own. The timpani roll lives here from the low orbit, which
 *               is where a drum belonged anyway.
 *   LOW     2   Small, and it is the tightest in the table on purpose. A long
 *               tail on a wobble fills the gaps the LFO cuts, and the gaps ARE
 *               the part; a big room on a bass is the classic way to lose a low
 *               end. `wobble.ts` and `buildBass` both already argued for this.
 *   HARMONY 3   Was 6, "the pad's own 'one room, one building' figure". The
 *               pad is deleted (the owner: "the synth sound is really bad i
 *               hate it remove that"), and what is left on this orbit is the
 *               stab, the arp, the lead, the motor and the motifs — short
 *               notes with a tempo-synced delay on most of them. Reference B
 *               puts its arp and its lead in `room(.8).rsize(2)` and
 *               `room(.4).rsize(2)`; 3 is halfway to that from 6, kept above
 *               2 so the harmony's space is audibly a different, larger one
 *               than the bass's on ORBIT_LOW. The sends are unchanged: they
 *               were written as depths in a shared room, and they still are.
 *   AIR     8   Cymbals and risers, the one place a long tail is the gesture.
 *
 * WHY HALVING IS FREE AND SHOULD STILL BE DONE ONCE. A SIZE is the one
 * reverb control that costs a rebuild when it changes, so a size is changed
 * here, in this table, and nowhere else; `tools/reverbchurn.mjs` reads 0
 * rebuilds per bar and `tools/spacecheck.mjs` reads one `roomsize` per orbit
 * off the haps. What halving buys is not measured by ear (nothing in this pass
 * has been heard); it is measured as the references' practice against the
 * audit's reading of this score — "5/6/8-second washes at low sends" against
 * "2-second rooms at high sends" (`scratchpad/cheap/spec-v1.md`) — and by the
 * capture's octave bands before and after (`scratchpad/cheap/after2/`).
 *
 * A FIFTH ORBIT IS THE RIGHT ANSWER IF A LANE EVER GENUINELY NEEDS A FIFTH
 * SPACE. Adding one costs one IR built once; changing a lane's size inside a
 * shared orbit costs one IR rebuild per note.
 */
export const ORBIT_ROOM: Readonly<Record<number, number>> = {
  [ORBIT_DRUMS]: 2.5,
  [ORBIT_LOW]: 2,
  [ORBIT_HARMONY]: 3,
  [ORBIT_AIR]: 8,
  // The sub is dry and sets no room; the entry exists so the table stays a
  // total map over the orbits and reverbchurn's one-shape rule has a value to
  // compare if a send is ever added.
  [ORBIT_SUB]: 2,
};

/* ===========================================================================
 * THE DELAY IS A PROPERTY OF THE ORBIT TOO — ITS TIME AND ITS FEEDBACK.
 * ===========================================================================
 *
 * THE MECHANISM, read out of `superdoughoutput.mjs:53-67` (`Orbit.getDelay`)
 * rather than guessed. superdough keeps ONE feedback-delay node per orbit.
 * Every hap that sends `delay > 0` calls `getDelay(delaytime, feedback, t)`,
 * which creates the node on first use and otherwise RETARGETS it: when the
 * hap's `delaytime` or `feedback` differs from the node's current value it is
 * `setValueAtTime`d at the hap's onset. There is no per-hap delay line on the
 * orbit path (`superdough.mjs:930-935`); the line is shared state, and two
 * lanes on one orbit asking for two times make the node jump between them
 * hap by hap. That is what the lead and the arp were doing on ORBIT_HARMONY:
 * the lead's open-section `1/4 · .52` against the arp's `3/16 · .30`, and the
 * arp's own pods on `1/8`, `1/16` and `1/12` — the audit read it off the haps
 * ("the delay time jumps between them hap by hap. Nothing measures that
 * today", `scratchpad/cheap/reports/audit.md` §2b). Now something does:
 * `tools/spacecheck.mjs` asserts one (sync, feedback) pair per orbit.
 *
 * `delaytime` is derived: superdough computes it as `delaysync` cycles at the
 * current cps (`superdough.mjs:503`), so a hap that sets `delay` and NOT
 * `delaysync`/`delayfeedback` falls to the defaults `3/16` and `0.5`
 * (`superdough.mjs:190-194`) — which on the drums orbit is a silent retarget
 * to a different time. Every `.delay()` in the score therefore chains
 * `.delaysync(ORBIT_DELAY[o].sync).delayfeedback(ORBIT_DELAY[o].feedback)`,
 * and `spacecheck` fails a delayed hap that carries neither.
 *
 * THE FOUR PAIRS, and why each:
 *
 *   DRUMS   1/8 · 0.30   Reference B's arp/lead delay is `.225 s` at 135 bpm,
 *                        which is exactly an eighth (60/135/2 = 0.222). One
 *                        repeat a beat behind the backbeat is the dub-clap
 *                        figure (screenshot 1: `clap ... .delay(.2)`); 0.30
 *                        feedback is two audible repeats and a third under
 *                        the next hit. The nova clap layer already used 1/8
 *                        here (at 0.28), so the drums orbit's time is the
 *                        one it had.
 *   LOW     3/16 · 0.40  A dotted eighth on the sampled pluck alone (the
 *                        one-note-a-bar `gm_electric_bass_finger`): the
 *                        classic dub echo, off the grid the wub's LFO is
 *                        on, so the repeats fall in the wub's gaps. 0.40
 *                        because the pluck is one note a bar and has room to
 *                        ring; the wub/reese/mid never send, because a
 *                        delayed LFO smears the part (`spec-v2.md` STAGE 2).
 *   HARMONY 3/16 · 0.40  The arp's and the motifs' existing time; the lead's
 *                        closed-section time. The lead's open `1/4 · .52`
 *                        variant is GONE (tombstone in `buildLead`): a lead
 *                        that lengthens its echo in the breakdown while the
 *                        arp keeps the dotted eighth on the same node was
 *                        the retarget above. 0.40 sits between the arp's
 *                        0.30 and the echo motif's 0.45, and under reference
 *                        B's 0.45 (which has no other lane on its node).
 *   AIR     1/8 · 0.42   The graze shimmer's own numbers, unchanged; it is
 *                        the only delayed lane on this orbit and stays so
 *                        (hats and shaker NONE: the reference's hat delays
 *                        are on isolated lines, and on a 24-hap-a-bar grid a
 *                        delay is smear, not space).
 *
 * The per-hap LEVEL (`.delay(x)`) stays free, exactly as `.room()` does for
 * the reverb: it is the send, not the line. A lane wanting a different TIME
 * wants a different orbit, and that costs one delay node, not one IR.
 *
 * MEASURED: nothing by ear. The pairs are the references' figures and the
 * score's existing ones reconciled; `spacecheck` reads them off the haps.
 */
export interface OrbitDelay {
  /** Delay time in CYCLES (`.delaysync()`); superdough turns it into seconds at the current cps. */
  readonly sync: number;
  /** Feedback ratio (`.delayfeedback()`), clamped by superdough to 0.98. */
  readonly feedback: number;
}

export const ORBIT_DELAY: Readonly<Record<number, OrbitDelay>> = {
  [ORBIT_DRUMS]: { sync: 1 / 8, feedback: 0.3 },
  [ORBIT_LOW]: { sync: 3 / 16, feedback: 0.4 },
  [ORBIT_HARMONY]: { sync: 3 / 16, feedback: 0.4 },
  [ORBIT_AIR]: { sync: 1 / 8, feedback: 0.42 },
  // The sub never sends a delay (`sub()` below argues it must stay dry, and
  // `spacecheck` asserts it); the entry keeps the table total over the orbits
  // for the same reason ORBIT_ROOM carries one, mirroring the low orbit.
  [ORBIT_SUB]: { sync: 3 / 16, feedback: 0.4 },
};

/**
 * A note rhythm (`g1 ~ [~ g1] ~`) as a struct (`x ~ [~ x] ~`).
 *
 * The sampled kick must NOT carry a note. `superdough` repitches any sample
 * that has one from MIDI 36 (`util.mjs:89-90`, `sampler.mjs:36`): `g1` is
 * MIDI 31, so `note('g1').s('mw_bd909')` would play the 909 five semitones
 * flat at 0.75x speed — a longer, duller kick nobody chose. The fallback kick
 * keeps its note because its sine IS the note. Only the pitch tokens are
 * replaced, so `@2` holds and `[ ]` groupings are untouched.
 */
function asStruct(rhythm: Patternable): Patternable {
  return typeof rhythm === 'string' ? rhythm.replace(/[a-gA-G][#b]?-?\d+/g, 'x') : rhythm;
}

/**
 * Kick. `weight` 0..1 moves it from a soft house thump to a distorted
 * hard-dance kick: longer pitch drop, more saturation, tighter body.
 *
 * SAMPLED: the TR909 kick at native pitch under a 3.5 kHz lowpass, written
 * 0.5 — NOT the sine body's 0.8, and the difference was measured twice, not
 * guessed. Rendered soloed through the real chain (`tools/capture.mjs`, 4
 * drop bars, world seed 0x51ed, unity fader): at written 0.8 the sample
 * read -4.1 dBFS peak / -21.2 dBFS RMS against the oscillator kick's -19.7 /
 * -33.8 at the same number — +12.6 dB of RMS, because the sine body's
 * `distort(x:0.34)` is squared to x0.12 by this project's gain curve (AGENTS
 * §4) and a wav has no such stage. The full mix hit 1.0000 (0.0 dBFS; the
 * old drop peaked at -3.0) and 63-250 Hz rose 4-5 dB. At 0.6 the soloed
 * kick read -26.2 RMS (parity with the sub's -26.8) and a 4-bar window
 * peaked at -1.2 dBFS — but the 32-bar drop, where the kick fader reaches
 * 1.00, clipped again and its 250 Hz band sat 7 dB above the old render's.
 * 0.5 is -8 dB on the sample from the spec's number (amplitude 0.64 ->
 * 0.25), about 3 dB under the sub soloed and level with it in the mix after
 * the two faders: the kick marking time over a continuous floor, which is
 * the balance `buildSub`'s own comment describes. Still 5 dB above the
 * oscillator kick it replaces, which was measured "audible only as the click
 * of its own pitch envelope". The rejected alternatives: the spec's 0.8
 * (clips), and 0.6 (clips over 32 bars).
 * `weight` does nothing to the sample —
 * intensity moves the PATTERN (`kickRhythm`), and the reference kick is one
 * sound at one level for the whole track. The lowpass is the one thing kept
 * from screenshot 1's `s("bd:4").lp(300)`, an octave and a half higher
 * because that reference is a half-time sketch at 50 bpm; the 909's click
 * lives at 2-4 kHz and 3.5 kHz keeps the top of it. The synth click layer is
 * gone on this body: the sample has its own transient, and stacking a second
 * one is the "click on a click" that reads as a typewriter. The sidechain
 * rides the sample exactly as it rode the sine (`.duckorbit` below on both).
 */
export function kick(rhythm: Patternable, weight = 0.5): Pattern {
  if (kitReady()) {
    return s('mw_bd909')
      .struct(asStruct(rhythm))
      .lpf(3500)
      .gain(0.5)
      .orbit(ORBIT_DRUMS)
      .duckorbit(ORBIT_LOW)
      .duckonset(0.004)
      .duckattack(0.17)
      .duckdepth(0.45);
  }
  // Softened deliberately. The previous settings (penv up to 48, distort up to
  // 14, gain 0.92) were a hard-dance kick, and stacked with the sub they put
  // ~45% of the mix's entire energy below 250Hz — which is what "DUN DUN DUUN"
  // actually sounds like. A kick's job is to mark time, not to be the song.
  const penv = 20 + weight * 10;
  const pdec = 0.1 - weight * 0.03;
  const dec = 0.3 - weight * 0.07;
  const drive = 1.1 + weight * 2.2;
  return stack(
    note(rhythm)
      .s('sine')
      .penv(penv)
      .pdecay(pdec)
      .pcurve(1)
      .decay(dec)
      .sustain(0)
      .distort(`${drive.toFixed(2)}:0.34`)
      // Roll off below 50 Hz: nothing down there is reproduced by anything but
      // a subwoofer, and it is the band the sub already owns. No `ftype` is set
      // on this chain, so this is a plain biquad and not a second lowpass
      // (AGENTS.md §4).
      .hpf(40)
      .gain(0.8)
      .orbit(ORBIT_DRUMS)
      /*
       * SIDECHAIN. The low orbit ducks under every kick and swells back over
       * 170 ms — `docs/research-dubstep.md` R1, the most recognisable production
       * signature in the genre and the reason a dubstep low end is huge without
       * being muddy: the kick and the bass stop competing for 125 Hz IN TIME
       * rather than in frequency, and 125 Hz was measured at 45% of this mix.
       * `duckdepth` is a linear gain of `1 - sqrt(depth)`: 0.45 is -9.7 dB,
       * inside the genre's 8-12 dB for the mid-bass. The first version was
       * 0.25 (-6 dB) as a compromise while the sub shared this orbit; the sub
       * is on ORBIT_SUB now and is not ducked at all, so the growl and the
       * mid-bass get the real depth and the sub stays continuous underneath.
       */
      .duckorbit(ORBIT_LOW)
      .duckonset(0.004)
      .duckattack(0.17)
      .duckdepth(0.45),
    /*
     * THE CLICK. The body is a sine at g1 (49 Hz), which a laptop speaker does
     * not reproduce at all — the mix measured 0.5% of its energy at 4 kHz. The
     * sources put the kick's audibility on a short high-frequency transient
     * layered over the sine: only its first few milliseconds matter, and they
     * make the TIMING legible on a phone where the weight never arrives.
     * `docs/research-dubstep.md` R9. 8 ms is a click, not a hat.
     */
    note(rhythm)
      .s('white')
      .ds('0.008:0')
      .hpf(3000)
      .lpf(7000)
      .hpq(1.2)
      .gain(0.34 + weight * 0.2)
      .orbit(ORBIT_DRUMS),
  );
}

/**
 * The TR808 kick, layered UNDER the 909 on half-time bars.
 *
 * Half-time puts one kick where a straight feel puts two or four, and that
 * one hit has to carry the weight of the bar. The 808's is a long sine boom
 * with almost no click — the sub-kick the genre stacks under a punchier one
 * (`docs/research-dubstep.md` R1 is about exactly this low end). Written 0.4,
 * squared to 0.16, under the 909's 0.5: the 909 is the transient, the 808 is
 * the tail. Scaled with the 909 each time that was re-levelled from
 * measurement (see `kick`); the two were 0.7 under 0.8 and keep the ratio.
 *
 * No fallback body, and that is a decision rather than an omission. The
 * oscillator kick above IS a sine with a pitch drop — the thing an 808 is —
 * so a second sine at the same time and pitch would only double the same
 * oscillator, +6 dB on the downbeat. When the kit is not ready this layer is
 * `silence` and the half-time kick is the kick it always was. Not `.duck`ed
 * either: it sounds only where a 909 hap already triggered the sidechain.
 */
export function kick808(rhythm: Patternable): Pattern {
  if (!kitReady()) return silence;
  return s('mw_bd808').struct(asStruct(rhythm)).gain(0.4).orbit(ORBIT_DRUMS);
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
 *
 * ---------------------------------------------------------------------------
 * TOMBSTONE for the paragraph above about `ply(3)` and the drum-machine
 * object. It was right about the canon it named and the canon has changed:
 * the owner's own references (`scratchpad/refs/references.md`) put
 * `<- cp:3>*4` on a TR909 next to `<- sd>*4`, and screenshot 1 is `clap`
 * with room, delay and random pan. A handclap on the backbeat is not a
 * tell any more; it is the brief. So when the kit is ready this function
 * IS the 909 clap (`cp02.wav`) and `snare()` is the 909 snare, and
 * `buildClap` stacks the two on the backbeat exactly as reference B does.
 * The oscillator body below is unchanged and plays when the kit is not
 * ready: one hit, band-limited, tuned body — the argument stands for the
 * sound it describes, it just no longer decides the part.
 * ---------------------------------------------------------------------------
 */
export function clap(rhythm: Patternable, bright = 0.5): Pattern {
  if (kitReady()) {
    /*
     * Written 0.6, not the crack's 0.8, and the number is from the render.
     * The first version inherited 0.8 on the argument that the comment below
     * had measured that level against the bass; then the whole clap stem was
     * rendered soloed (`tools/capture.mjs`, 4 drop bars, 0x51ed): the sampled
     * stem — this clap, the 909 snare, the hats, the rim, the shaker — read
     * -6.0 dBFS peak / -32.3 RMS against the oscillator stem's -13.8 / -39.1,
     * with 19% of its energy in 125-250 Hz where the noise stem had 2%. That
     * is the 909 bodies, and it is +6.8 dB the mix did not have room for (it
     * peaked at 0.0 dBFS). 0.6 is -5 dB on the snare, the clap and the rim —
     * the BODIES. The hats and the shaker stay at the spec's numbers, because
     * the first re-level trimmed them too and the 32-bar render lost its top:
     * 8 kHz fell from -37.9 dBFS (the old noise kit) to -49.9, while at the
     * spec's hat levels the same band had read -38.0. The air was never the
     * problem; the 125-250 Hz bodies were. What it SOUNDS like is unheard.
     */
    return s('mw_cp909').struct(rhythm).gain(0.6).room(0.2).roomsize(ORBIT_ROOM[ORBIT_DRUMS]).orbit(ORBIT_DRUMS);
  }
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
    .roomsize(ORBIT_ROOM[ORBIT_DRUMS])
    .orbit(ORBIT_DRUMS);
}

/**
 * Snare: noise for the crack plus a tuned triangle for the body.
 *
 * SAMPLED: the TR909 snare (`sd02.wav`), written 0.6 (see `clap` for the
 * measurement that set it), room 0.2 on the drums orbit — the same send the
 * oscillator body has. `weight` moved the
 * waveshaper on the noise body and does nothing here: the reference snare is
 * one hit at one level. No `distort`: the 909 snare's noise is already the
 * sound, and the waveshaper below exists to make a triangle-plus-white sound
 * like one.
 */
export function snare(rhythm: Patternable, weight = 0.5): Pattern {
  if (kitReady()) {
    return s('mw_sd909').struct(rhythm).gain(0.6).room(0.2).roomsize(ORBIT_ROOM[ORBIT_DRUMS]).orbit(ORBIT_DRUMS);
  }
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
    .roomsize(ORBIT_ROOM[ORBIT_DRUMS])
    .orbit(ORBIT_DRUMS);
}

/**
 * The ghost note: a TR909 rimshot.
 *
 * A ghost snare is felt between the hits you hear, 12-20 dB under the
 * backbeat (`percLayers` derives the velocity range). On the sampled kit it
 * is a different DRUM rather than the same snare quieter — the rim is what a
 * drummer plays for a ghost on a drum machine, a click with a tuned ring and
 * no noise crack, so it reads as articulation instead of as a second, weaker
 * backbeat. Velocity is the caller's, as before.
 *
 * Fallback: the softest snare in the score, `snare(struct, 0.2)` — exactly
 * the construction the ghosts had before this function existed, so the
 * oscillator kit is unchanged by the rename.
 */
export function rim(struct: Patternable): Pattern {
  // 0.6 like the snare and the clap (the measurement is on `clap`); the
  // caller's velocity takes it 12-20 dB under that.
  if (kitReady()) return s('mw_rim909').struct(struct).gain(0.6).room(0.2).roomsize(ORBIT_ROOM[ORBIT_DRUMS]).orbit(ORBIT_DRUMS);
  return snare(struct, 0.2);
}

/**
 * The shaker: a TR808 cabasa on every eighth.
 *
 * Reference B is `<sh>*8` on the TR808 at one fixed level, and the audit's
 * finding was that nothing in this score played every eighth at one level —
 * `percLayers` even named that shape as the thing to avoid. The tombstone
 * for that sentence is in `percLayers`; the short version is that the
 * references have BOTH: a hat line with articulation AND a shaker with none,
 * and the shaker is the one hat line allowed to be every hit the same.
 * Level is the caller's (written 0.5, squared to 0.25).
 *
 * Fallback: a 12 ms white tick above 8 kHz — a new oscillator body, since
 * no shaker existed to fall back to. It is a tick and not a shaker, and it
 * is the honest fallback: the alternative of `silence` would make the
 * offline kit lose a part rather than a timbre, which is the one thing the
 * fallback rule (`samples.ts`) forbids.
 */
export function shaker(struct: Patternable, level: Patternable): Pattern {
  if (kitReady()) return s('mw_sh808').struct(struct).gain(level).orbit(ORBIT_AIR);
  return s('white').struct(struct).ds('0.012:0').hpf(8000).lpf(12000).hpq(1.2).gain(level).orbit(ORBIT_AIR);
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
/**
 * Which hat, when the kit is sampled. The oscillator body ignores it except
 * for `open`, which lengthens the noise burst.
 *
 *   closed     TR909 closed hat (`hh01.wav`) — the accents and the bed.
 *   sixteenth  LinnDrum closed hat (`Hat Closed-03.wav`) — the fill-bar
 *              sixteenths, and reference B's `<- hh>*8` machine.
 *   open       TR909 open hat (`oh01.wav`) — the last accent of the bar.
 */
export type HatKind = 'closed' | 'sixteenth' | 'open';

/**
 * How long the open hat holds, in HAP LENGTHS, and why it is not the 0.35
 * the design spec wrote.
 *
 * `clip` scales the hap's duration (`@strudel/core/hap.mjs:43-44`,
 * `duration.mul(clip)`), and the sampler then holds the sample for exactly
 * that long before its release (`sampler.mjs:314-318`). The open hat sits on
 * ONE sixteenth step, 111 ms at 135 bpm, so `.clip(0.35)` is 39 ms — shorter
 * than the closed hat's own 46 ms noise burst, i.e. a closed hat. Two hap
 * lengths is 222 ms, plus an 80 ms linear release so the cut is a fade and
 * not a click: about 300 ms, which reaches the next accent when the last
 * accent is on step 14 and stops short of the bar line otherwise. That is
 * what an open hat on the "and" before the downbeat does.
 */
export const OPEN_HAT_CLIP = 2;
export const OPEN_HAT_RELEASE = 0.08;

export function hatLayer(
  struct: string,
  brightness: number,
  level: Patternable,
  velocity = 1,
  decay = 0.018,
  kind: HatKind = 'closed',
): Pattern {
  if (kitReady()) {
    const name = kind === 'open' ? 'mw_oh909' : kind === 'sixteenth' ? 'mw_hhlinn' : 'mw_hh909';
    let p = s(name).struct(struct).velocity(velocity).gain(level).pan(0.56).orbit(ORBIT_AIR);
    // The closed hats play their whole slice (20-30 ms of hat; nothing to
    // cut). The open one is held and released; see `OPEN_HAT_CLIP`.
    if (kind === 'open') p = p.clip(OPEN_HAT_CLIP).release(OPEN_HAT_RELEASE);
    return p;
  }
  // The oscillator open hat: the same noise burst, ringing for 90 ms rather
  // than the accents' 46. A new fallback number, because no open hat existed
  // before; it is the shortest decay that reads as open against a 46 ms
  // closed hat, and it stays under one step so the fallback kit cannot smear.
  const dec = kind === 'open' ? Math.max(decay, 0.09) : decay;
  return s('white')
    .struct(struct)
    .ds(`${dec.toFixed(3)}:0`)
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
    .roomsize(ORBIT_ROOM[ORBIT_AIR])
    .pan(0.5)
    .orbit(ORBIT_AIR);
}

/** Downlifter / impact for the first beat of a drop. */
export function impact(level = 0.6): Pattern {
  return stack(
    s('white').struct('x ~ ~ ~').ds('1.1:0').lpf(5000).gain(level * 0.5).room(0.7).roomsize(ORBIT_ROOM[ORBIT_AIR]),
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
export function sub(notes: Patternable, level = 0.7, bpm = 135): Pattern {
  /*
   * The envelope comes from `articulation.ts`, touch `pedal`, and `bpm` is a
   * parameter for the same reason every touch takes one: a note's onset is a
   * fraction of the note, so the same technique at a different tempo is a
   * different envelope. The default is only for callers that have no transport
   * (`tools/render.mjs` and the two probes), never for the game.
   *
   * `slots: 8`. Every lattice this lane is written on is eighths or slower -
   * `~ root ~ ~ ~ ~ ~ ~` and its two fill layers - so the densest note spacing
   * is 222 ms at 135 bpm and two sub pitches can never overlap.
   *
   * A pure sine cannot ping; the switch turning it on can. One cycle of 50 Hz
   * is twenty milliseconds, which is why `pedal`'s onset floor is a physical
   * constraint rather than a taste.
   */
  return articulate(note(notes).s('sine').gain(level).orbit(ORBIT_SUB), 'pedal', {
    slots: 8,
    bpm,
    shade: 0.5,
  });
}
