/**
 * The stems.
 *
 * Vertical remixing: every layer is always *defined*, and the director decides
 * which ones are audible. Each builder takes the current musical state and
 * returns a Strudel pattern for one bar-loop's worth of that instrument.
 *
 * Two rules keep this from turning to mush:
 *   1. A layer never decides its own volume. The director owns levels so it can
 *      apply hysteresis and stop layers flickering at a threshold.
 *   2. Anything that varies continuously (filter cutoff, drive, width) is fed a
 *      `signal`, not a number, so it can move without the pattern being rebuilt.
 */

// `saw` went with the downlifter — the only thing in this file that swept a
// filter across a bar. See the cymbal note in `buildFx`.
import { note, reify, s, silence, sine, stack, type Pattern, type Patternable } from '@strudel/core';
import type { EnemyArchetype, GameSnapshot, PowerupKind, SectionName } from '../core/events';
import { clamp01, lerp, remap } from '../core/math';
import type { Chord, ChordSpan, Extension, LaneId, ModeName } from './theory';
import { LANE_RANGE, buildChord, contourForBar, degreeToSemitone, foldInto, laneTones } from './theory';
import { articulate, type TouchName } from './articulation';
// `riser` is no longer imported: the build is a timpani roll now, and a
// white-noise uplifter has no equivalent in the canon this score is aiming at.
// The function is left in `kit.ts` rather than deleted — it is a correct
// implementation of a thing we have simply stopped wanting.
/*
 * `hatLayer` and `metal` ARE IMPORTED AGAIN, and the reason is a brief and not
 * a bug fix.
 *
 * The comment that used to sit here said "there is no hi-hat any more: the
 * pulse moved into a pitched inner voice", and that argument — recorded at
 * length in the `buildHats` tombstone further down — is still correct about
 * the canon it was written against. The Game Boy has four channels and Pokemon
 * R/B has no drum channel at all, so in that canon the pulse is always carried
 * by something with a pitch, and a hi-hat is garnish.
 *
 * The owner has since asked for Aphex Twin, which is a DIFFERENT canon and
 * inverts exactly that premise. On Selected Ambient Works and on Drukqs the
 * drums are the lead instrument: sixteenth and thirty-second hat figures with
 * rolls and ratchets, ghost snares between the backbeats, and grid positions
 * that are deliberately a step early or late. That is not garnish and it
 * cannot be played by a pitched inner voice, because half of what identifies
 * it is that the sound has no pitch to follow.
 *
 * So the hi-hat comes back, and it comes back as a DIFFERENT OBJECT. What was
 * deleted was `s("white*div")` with `div` chosen from an intensity threshold —
 * a subdivision dial. What is here now is `percGrid`: a fixed sixteenth
 * lattice, an additive accent grouping that does not divide 16 evenly, and
 * ratchets placed from the bar's own coordinates. The tombstone's reasoning is
 * left in place below and amended rather than deleted, because the reasoning
 * was never wrong — the target moved.
 *
 * `HAT_QUARTERS`, `HAT_EIGHTHS` and `HAT_SIXTEENTHS` stay unimported. They are
 * the old subdivision ladder's three fixed lattices and `percGrid` computes its
 * own step sets, so importing them would be importing the thing that was the
 * problem.
 */
import {
  clap,
  hatLayer,
  impact,
  kick,
  metal,
  ORBIT_AIR,
  ORBIT_DRUMS,
  ORBIT_HARMONY,
  ORBIT_LOW,
  ORBIT_ROOM,
  snare,
  sub,
} from './kit';
import { reese, wub, wubFor } from './wobble';
import { applyVoice, type ResolvedVoice, type SynthOnly, type VoiceRole, voiceSource } from './soundfonts';

export type StemId =
  | 'sub'
  | 'kick'
  | 'clap'
  | 'hats'
  | 'bass'
  | 'chords'
  | 'arp'
  | 'lead'
  | 'fx'
  | 'motifs'
  | 'power';

export const STEM_IDS: readonly StemId[] = [
  'sub',
  'kick',
  'clap',
  'hats',
  'bass',
  'chords',
  'arp',
  'lead',
  'fx',
  'motifs',
  'power',
];

export const STEM_LABELS: Record<StemId, string> = {
  sub: 'SUB',
  kick: 'KICK',
  clap: 'CLAP',
  hats: 'MOTOR',
  bass: 'BASS',
  chords: 'CHORD',
  arp: 'ARP',
  lead: 'LEAD',
  fx: 'FX',
  motifs: 'ENEMY',
  power: 'POWER',
};

/**
 * Per-stem gain curves.
 *
 * This replaces an on/off threshold per stem, which was the single worst thing
 * about the mix: every layer was either silent or at full level, so as soon as
 * tension crossed a line the whole arrangement slammed to 100% and stayed
 * there. Measured uptime was kick 94%, hats 89%, bass 86% — a track with no
 * dynamic range is not dynamic music, however cleverly it was assembled.
 *
 * Now each stem *fades* across a band. `in` is where it first becomes audible,
 * `full` is where it reaches `ceiling`, and the interpolation is smoothstepped
 * so nothing has an audible corner. At a mid tension of 0.5 this yields a real
 * mix — drums up, bass moderate, chords just arriving, lead still absent —
 * instead of everything shouting at once.
 */
export interface StemCurve {
  /** Tension at which the stem starts to come up. */
  in: number;
  /** Tension at which it reaches its ceiling. */
  full: number;
  /**
   * Loudest this stem gets FROM TENSION ALONE, 0..1 — not its absolute maximum.
   *
   * This said "loudest this stem ever gets" and that is measurably false.
   * `updateLevels` adds `ensembleLift` on top of the curve and clamps nothing,
   * so a full band pushes lanes past their ceiling: measured over eight
   * ten-minute runs, peak levels reached sub 0.390 against a ceiling of 0.2
   * (195%), motifs 126%, arp 122%, fx 117%, and only bass and power stayed
   * under.
   *
   * The lift is not a leak; it is the point. A bigger band is supposed to
   * colour the lanes it plays, and `ensembleTrim` — not this number — is what
   * keeps the total bounded, by pulling the whole mix down as the band grows
   * "so a full ensemble is richer rather than louder". Clamping here as well
   * would double up on that constraint and cancel the redistribution: at high
   * energy a lane already at its ceiling would gain nothing from recruiting,
   * which is exactly when the reward should read.
   *
   * Trialled anyway, because the old wording deserved a test rather than an
   * assumption: clamping to the ceiling produced a byte-identical spectrum
   * over 32 bars (37.3% below 250Hz, 62.1% tune band, 8.8dB range), so there
   * was no measured case for it and a clear design case against.
   *
   * Read this as the shape of the tension response. For the absolute maxima,
   * measure — and the sub's "cannot become a bed" below is still true in
   * effect at 0.39 against a kick at 0.77, even though the number is passed.
   */
  ceiling: number;
  /** Level it jumps to the moment it becomes audible, to avoid a mush of 0.02s. */
  floor: number;
}

export const STEM_CURVES: Record<StemId, StemCurve> = {
  /*
   * Ceilings rebalanced so the *music* is the loudest thing and the drums keep
   * time underneath it. Measured spectral balance previously put 45-50% of all
   * energy below 250Hz with the melody averaging 0.13 — a thumping loop with
   * nothing to listen to on top of it.
   *
   * The melody now enters at 0.14 rather than 0.55: a track with no tune is
   * just a beat, and gating the only tune behind "the player is in serious
   * danger" meant it was absent for most of a run.
   */
  /*
   * Bands are spread across the *energy* range, which now has a floor of ~0.22
   * that rises through a run. Curves tuned for raw danger bunched everything at
   * its ceiling the moment the floor lifted, so these are re-spaced to use the
   * whole 0.2-0.9 span the arrangement actually travels.
   */
  /*
   * The sub is an ACCENT now, not a bed.
   *
   * A sustained sine two octaves under the chord root, present at all times, is
   * a dance-music object and one of the four lanes that were jointly carrying
   * the pulse. Nothing in the 8- and 16-bit canon has meaningful sustained
   * energy below about 45Hz — the NES triangle bottoms out near 55Hz and the
   * SPC700's bass samples are electric-bass or pizzicato. A permanent sub is
   * also, physically, the reason a mix "feels like a club track" before a single
   * note is identified: it is felt rather than heard, continuously.
   *
   * The ceiling drops from 0.5 to 0.2 and `in` rises off zero, so the sub only
   * appears when the game is genuinely loud and never as a floor. Its one real
   * job — weight under a downbeat at the top of the arrangement — survives; its
   * job as a bed does not. The always-on override in `director.updateLevels`
   * went with it.
   */
  /*
   * `in` is 0.44, not 0.55, because 0.55 was just past the end of the scale.
   *
   * The intent above is right and it stands: the sub is an accent that appears
   * when the game is genuinely loud, never a bed. It simply never happened.
   * `tools/session.mjs` measures peak `energy` across every frame of a
   * twelve-minute run at **0.54**, and energy is what these curves are read
   * against — so an entry point of 0.55 is not "rare", it is unreachable. The
   * only thing that ever sounded this lane was the unrelated override in
   * `director.updateLevels` that forces it to 0.3 during `collapse`, which is
   * the death sequence. The accent was dead and the funeral was the whole part.
   *
   * 0.44 puts entry in roughly the top fifth of what play can actually produce.
   * The ceiling stays at 0.2, so it is still an accent and still cannot become
   * a floor; it can now simply occur. `full` is left at 0.9 deliberately — an
   * unreachable `full` means the lane only ever climbs the early, shallow part
   * of its curve, which is exactly the gentle behaviour an accent wants.
   */
  /*
   * `full` is 0.80, not 0.90, because 0.90 is not a number this game produces.
   *
   * Driven by the real `World` for fifteen minutes, energy peaks at 0.851 and
   * its 99th percentile is 0.802 — so a `full` of 0.90 sat outside the input
   * range entirely and the sub could never reach its own ceiling. Measured, it
   * topped out at 0.181 against a ceiling of 0.2. The cost is small because
   * the ceiling is deliberately small, but a curve whose top is unreachable is
   * the same defect this codebase keeps finding: a condition that cannot be
   * evaluated.
   *
   * 0.80 is the measured p99, which keeps the sub what it is meant to be — an
   * accent for the loudest 1% of moments — while letting it actually arrive.
   * The comment above about curves spanning "the whole 0.2-0.9 range the
   * arrangement travels" was an estimate; the measured span is 0.20 to 0.851,
   * with 54% of the run inside 0.60-0.72.
   */
  /*
   * THE CEILING GOES 0.2 -> 0.52, AND THE MEASUREMENT IS THE WHOLE ARGUMENT.
   *
   * The comment above is about `full` and it is still right. This is about
   * `ceiling`, which was never measured in situ — only reasoned about, as "an
   * accent for the loudest 1% of moments".
   *
   * Measured: `tools/capture.mjs`, 32 bars, world seed 0x51ed, every stem
   * rendered soloed and the mix reconstructed from them (the reconstruction
   * reproduces the full-mix RMS to 0.2 dB, so it is not a guess). At the live
   * fader of 0.08 this lane contributes **0.0% of every octave band**, and its
   * in-mix RMS is **-62.7 dBFS against the bass's -26.1** — 36 dB down. The
   * "floor of the whole mix" (`kit.ts`) was 36 dB under the thing it is meant
   * to be the floor of.
   *
   * The arithmetic that hid this: `postgain` is squared by
   * `setGainCurve(x => x*x)`, so a stem fader moves ENERGY by 40*log10, not
   * 20. A ceiling of 0.2 against `chords`' 0.9 is not a 13 dB difference, it
   * is a 26 dB one, and half the table's apparent range does not exist.
   *
   * 0.52 puts it at about -42 dBFS in-mix: still 16 dB under the bass, still
   * gated to `in: 0.44` so it is still an accent and not a bed, and now
   * actually present in the 63 Hz octave — which measured 0.2% of the whole
   * mix, the emptiest band in the score. See `KICK_NOTE` for the other half of
   * that hole.
   */
  /* ==========================================================================
   * ...AND THEN THE OWNER LISTENED: "its missing a base,/ kick, lets add more
   * base". THE SUB IS A BED AGAIN, AND EVERY PARAGRAPH ABOVE IS WHY IT WAS NOT.
   * ==========================================================================
   *
   * Read the five notes above as one argument and they are internally
   * consistent and, for the score they were written for, right: a permanent
   * sub "is a dance-music object", nothing in the 8/16-bit canon has sustained
   * energy below 45 Hz, and "it is felt rather than heard, continuously" was
   * listed as the FAULT.
   *
   * Every one of those sentences is an argument against dubstep. The genre's
   * whole identity is the bottom of the spectrum; "felt rather than heard,
   * continuously" is not a defect there, it is the specification. This is the
   * clearest case in the file of a decision that was correct under one brief
   * and inverted by the next, so the old reasoning is kept above rather than
   * deleted — if the target ever moves back, it moves back with it.
   *
   * WHAT THE OLD ROW ACTUALLY PRODUCED, which is worse than "an accent":
   *   in 0.44        measured energy has a median of 0.62 and a p99 of 0.79, so
   *                  the lane existed only in roughly the top third of play.
   *   ceiling 0.52   about 16 dB under the bass after `postgain` squares it.
   *   ActShape.sub   FALSE for the whole exposition, and `updateLevels`
   *                  multiplied by 0.3 for it — another 21 dB down. So for the
   *                  first three minutes of every run, which is most runs, the
   *                  sub was 37 dB under the bass whenever it was audible at
   *                  all, and silent the rest of the time.
   *
   *   in 0        it is a bed. There is no dubstep without one.
   *   full 0.5    reached in ordinary play rather than in extremis.
   *   ceiling 0.86  under the bass's 0.95 and above the kick's, which is the
   *                 order these three want: growl on top, sub under it, kick
   *                 punching through both.
   *   floor 0.55  the moment it opens it is already a floor, not a hint.
   *
   * The one thing that has NOT changed is that it is a sine two octaves under
   * the chord root and it stays one. See `kit.sub`.
   */
  sub: { in: 0, full: 0.5, ceiling: 0.86, floor: 0.55 },
  /*
   * The kick reaches full at 0.68, not 0.52 — because it was a switch.
   *
   * `tools/session.mjs` measures where each lane actually sits inside its own
   * range over a twelve-minute run. The kick spent **84% of the run parked at
   * its ceiling and only 15% anywhere in the middle**. That is not a fader, and
   * a kick permanently at full is the single most literal definition of a dance
   * floor there is.
   *
   * The cause was arithmetic, not taste. Measured tension has a median of 0.49
   * and reaches about 0.65 only under sustained near-death; `full: 0.52` sat
   * barely above the median, so the curve saturated in ordinary play and stayed
   * there for the rest of the game. Every remaining bit of the band above it
   * was unreachable in one direction and unused in the other.
   *
   * 0.68 places full at the top of what play can actually produce, so the kick
   * climbs through its band instead of starting at the end of it. Nothing else
   * changes: same ceiling, same floor, same pattern ladder. See the headroom
   * section of `session` for why a `full` value has to be read against measured
   * tension rather than against the 0..1 the table appears to offer.
   */
  /*
   * ...AND THE OTHER HALF OF "its missing a base,/ kick".
   *
   * The reasoning above about `full` stands untouched — it is about the SHAPE
   * of the curve and it was measured. What moves is where the curve sits.
   *
   *   in 0.1 -> 0.02   half-time is kick-on-1, snare-on-3. There is no
   *                    intensity at which that kick should be absent; it is the
   *                    clock the whole feel is read against.
   *   ceiling 0.74 -> 0.92  level with the bass rather than 4 dB under it.
   *                    `KICK_NOTE` is `g1` = 49 Hz and the wobble's lowest
   *                    fundamental is 110 Hz, so these two are an octave and a
   *                    bit apart and are not competing for the same band — the
   *                    kick was simply quiet.
   *   floor 0.3 -> 0.44  a kick that fades up is not a kick.
   *
   * VERIFIED RATHER THAN ASSUMED, because the pitch is the thing that made
   * this lane inaudible once already: `KICK_NOTE` is still `g1`. The move off
   * `c1` (32.7 Hz, under the reproduction range of every speaker this game is
   * played on) survived this pass — see the long note on that constant.
   */
  kick: { in: 0.02, full: 0.68, ceiling: 0.92, floor: 0.44 },
  /*
   * `clap` IS THE WHOLE KIT ABOVE THE KICK, and since `percGrid` that is more
   * than a name.
   *
   * This lane carries the backbeat, the half-time snare, the ghost snares, the
   * sixteenth hat grid, its thirty-second ratchets and the bell — everything
   * `percLayers` returns. There is deliberately no twelfth stem (see the note
   * on `percGrid`), so this one curve decides when all of it arrives, and
   * `in: 0.26` is therefore also the sentence "the drum programme is not a
   * bed": below a quarter of the way up the scale there is no hat line at all.
   * Measured by `tools/faders.mjs` over a real run, this lane sits at zero for
   * **24% of the time** with a mean of 0.38 — which is where the arrangement's
   * dynamic range comes from now that its busiest part is behind this fader.
   *
   * The lane still LABELLED `hats` is the motor, a pitched inner voice. That
   * has been confusing since `buildHats` was deleted and it is more confusing
   * now that there are hi-hats again; renaming it still costs the HUD,
   * `MOVEMENT_MIX`, `INTRO_ENTRY`, `STEM_CURVES` and a dozen tools, and still
   * buys no music.
   */
  /*
   * ...AND IT COMES UP, BECAUSE THE AIR HAS TO COME FROM SOMEWHERE.
   *
   * Rendered through the real chain (`tools/capture.mjs --bars=4`, full mix)
   * after the melody was demoted and the bass promoted, the spectrum reads
   * 63 Hz 18.7%, 125 Hz 49.7%, 250 Hz 25.0% — **93.4% of the mix below 500 Hz**
   * — and 1.7% above 2 kHz. The low end is what the owner asked for twice and
   * it stays; the top is a hole, and this project has measured a dull mix
   * before and knows what it costs.
   *
   * This lane is where the answer is. It is the whole kit above the kick — the
   * backbeat, the ghost snares, the sixteenth hat grid, its thirty-second
   * ratchets and the bell — and `registermap` reads it as **98.6% of all the
   * energy in the mix above 2 kHz**. It is the only broadband source left, and
   * a transient one, which is exactly the kind of air a half-time track wants:
   * the space between the hits is the arrangement, so the thing filling the top
   * has to be the hits themselves rather than a sustained line.
   *
   * `in` 0.26 -> 0.18 and ceiling 0.66 -> 0.82. The hat grid arrives earlier and
   * the kit sits about 4 dB up after gain-squaring. Nothing sustained was added
   * to do it, which is the constraint that made this the right lane.
   */
  clap: { in: 0.18, full: 0.68, ceiling: 0.82, floor: 0.26 },
  /*
   * The motor is the CLOCK, so it is very nearly flat.
   *
   * Every other lane fades across a band because dynamic range is the point.
   * This one must not: it is what the listener is keeping time against now that
   * the kick has stopped hitting all four beats, and a metronome that fades out
   * when the screen goes quiet takes the floor out from under the whole
   * arrangement. `in: 0` and a floor two thirds of the ceiling means it is
   * always present and only leans in a little when things get busy.
   *
   * Quieter than the old hats (0.40 against 0.52) precisely BECAUSE it never
   * stops. A continuous sixteenth line at hi-hat level is a buzz; the same line
   * under everything else is a pulse you feel rather than listen to.
   */
  /*
   * ...AND IT COMES DOWN, BECAUSE IT IS SITTING ON THE BASSLINE.
   *
   * `tools/masking.mjs` names it: over 660 states and 1.7 million overlapping
   * cross-lane pairs, **bass+motor is the worst pair in the mix** — 23,769
   * collisions, 39% of all of them, carrying 40% of the total audible weight.
   * The motor's own window is MIDI 57-69 and the bass now plays 45-69 with a
   * plucked electric bass ON the line rather than under it. Two pitched parts
   * in one octave, one of which never stops, is the collision no fader
   * ordering fixes and the exact thing the owner reached for when he wrote
   * "the second lead synth could be improved... need a baseline, not just
   * leads".
   *
   * DEMOTED, NOT DELETED, and the argument above is why: it is the clock, and
   * a metronome that fades out takes the floor from under the arrangement. It
   * keeps `in: 0` and a floor two thirds of its ceiling, so it is still always
   * there; it is simply no longer competing with the part it sits on top of.
   * 0.4 -> 0.26 is about -7 dB after gain-squaring.
   *
   * The kick at 0.92 and the hats in `clap` are what keep time now, which they
   * can afford to do in half-time in a way they could not at four-to-the-floor.
   */
  hats: { in: 0, full: 0.62, ceiling: 0.26, floor: 0.2 },
  /*
   * THE BASS IS THE PROTAGONIST, and this row is where that is actually true.
   *
   * `buildBass` is the wobble on four feels of five now, but a part is only the
   * centre of a mix if its FADER says so, and this row said the opposite: an
   * `in` of 0.24 meant the bass did not exist at all until the game was a
   * quarter of the way up its danger scale, and a ceiling of 0.6 put it a
   * distant third behind `chords` (0.9) and `lead` (0.95).
   *
   * Read those three as ENERGY, which is what they are — `postgain` is squared
   * by `setGainCurve(x => x*x)`, so the table's apparent range is doubled in
   * dB. 0.6 against 0.95 is not 4 dB down, it is 8. The lane the brief calls
   * the protagonist was 8 dB under the tune.
   *
   *   in 0.04     it is the FLOOR of the arrangement. There is no dubstep
   *               without the bass, so it arrives with the first bar rather
   *               than being earned; only the intro's entry order holds it
   *               back now (`INTRO_ENTRY.bass`).
   *   full 0.58   just under the measured median energy of 0.62, so the lane
   *               spends most of a run at or near its ceiling. That is the
   *               opposite of what a fader is normally for and it is correct
   *               here for the same reason `hats` is nearly flat: this is the
   *               part, not a colour on it. The wobble's own dynamics come
   *               from `lpdepth` and `drive`, which are continuous and inside
   *               the voice.
   *   ceiling 0.95  level with what the lead used to hold. The two swap.
   *   floor 0.4   audible the instant it opens; a wobble fading up from 0.22
   *               is a synth pad.
   */
  bass: { in: 0.04, full: 0.58, ceiling: 0.95, floor: 0.4 },
  /*
   * THE PAD COMES DOWN 0.9 -> 0.62, and it is the second-largest subtraction
   * in this table after the melody.
   *
   * `buildChords` is three parts — a sustained open-fifth bed, a sustained
   * colour pair, and a comping stab — and all three are CONTINUOUS. A bed that
   * never stops is the thing the genre has least of: dubstep is defined as much
   * by what is not playing as by what is, and a sustained supersaw under a
   * half-time wobble fills exactly the gaps the LFO is cutting. The gaps ARE
   * the part (`wobble.ts` says so about its own reverb send).
   *
   * Not deleted, and deliberately not: the harmony is what stops the wobble
   * being one note, `harmony` holds seven assertions over this lane's voicing,
   * and `breakdown`/`intro`/HUSHED are built out of it opening up. It goes from
   * the loudest sustained thing in the mix to a bed you notice when the bass
   * lets go of it.
   */
  chords: { in: 0.1, full: 0.82, ceiling: 0.62, floor: 0.24 },
  /*
   * `full` was 0.8, which energy reaches only in extremis, so the arp lived in
   * the bottom of its own curve. 0.62 lets a busy passage actually open it up.
   *
   * THE CEILING CAME DOWN 0.76 -> 0.44 AND THE ENTRY WENT UP 0.32 -> 0.5.
   * `registermap` measures this lane at 19.4% of all the air in the mix and
   * the second-loudest source above 2 kHz after the hats — a continuous
   * sixteenth-note sparkle at 1.1-2.5 kHz over a half-time wobble is the
   * "bing bong" complaint almost by definition, and the genre has no
   * arpeggio in it. It is not deleted: it is a colour that arrives when the
   * screen is genuinely busy, which is what `in: 0.5` buys.
   */
  /*
   * ...AND AGAIN, AFTER THE FOURTH MELODY COMPLAINT: `in` 0.5 -> 0.66 and
   * the ceiling 0.44 -> 0.26.
   *
   * Measured energy has a median of 0.62 and a p99 of 0.79, so an `in` of
   * 0.66 means this lane is SILENT for a little over half of a run and
   * present only when the screen is genuinely full. At 0.26 against the
   * bass's 0.95 it is 22 dB down after gain-squaring.
   *
   * WHY THE STEM IS NOT DELETED, since that is what a reading of the
   * complaint would suggest. Removing an id from `STEM_IDS` touches the HUD
   * lane readout, `MOVEMENT_MIX`, `INTRO_ENTRY`, `TONAL_LANES`, the long
   * rota in `orchestration.ts` and about a dozen tools that address lanes by
   * name - and `registermap`, `masking`, `motion` and `interlock` all sweep
   * `section: 'sustain'` only, so a lane that emits no haps there loses its
   * coverage in four gates at once. A fader that is at zero for half the run
   * and 22 dB down for the rest is the same music with none of that cost.
   *
   * `buildArp` also drops its second line per pod - see there.
   */
  /*
   * ...AND `in` COMES BACK DOWN TO 0.4, BECAUSE 0.66 KILLED THE LANE OUTRIGHT.
   *
   * `tools/faders.mjs` caught it over a four-minute run in a real browser: this
   * lane sat at **zero for 100% of the samples**, mean 0.01, range 0.01 against
   * the gate's floor of 0.15 — "BARELY MOVES: arp range 0.01". Measured energy
   * has a median of 0.62 and a p99 of 0.79, so an entry of 0.66 is inside the
   * top fifth of what play produces and in practice the lane simply never
   * arrived. `tools/subtraction.mjs` saw the same thing from the other side:
   * there were not enough audible samples left to measure the focus duck.
   *
   * That is a lane deleted by the back door, and this file has a name for it —
   * a threshold set past the end of the signal, which it has now found five
   * times (`STEM_CURVES.sub`'s old 0.55, the kick's `full`, the fx `full`, the
   * build's tension arm). The DEMOTION is the ceiling, and the ceiling stays:
   * 0.26 against the bass's 0.95 is 22 dB down after gain-squaring, and
   * `buildArp` plays half the notes it used to. What `in: 0.4` restores is the
   * lane's ability to answer the game at all, which is the difference between a
   * quiet colour and dead content.
   */
  arp: { in: 0.4, full: 0.72, ceiling: 0.26, floor: 0.12 },
  /*
   * THE MELODY IS NO LONGER THE LOUDEST THING IN THE GAME.
   *
   * "sounds so whack like carnival, its got beats in the background, then a
   * foreground melody offa funny instrument it's just no" — that is a
   * description of an ARRANGEMENT, not of a timbre: a rhythm section with a
   * tune on top is a pop shape, and this row is where the shape was written
   * down. A ceiling of 0.95 was the highest in the table, above the bass, the
   * pad and the kick.
   *
   * In this genre the bass carries the hook and a lead is a stab that answers
   * it. `buildLead` is now sparse by construction (see the mask there); this
   * makes it quiet as well, and the two together are the demotion. 0.52
   * against the bass's 0.95 is about 10 dB after gain-squaring.
   *
   * `in` rises 0.2 -> 0.34 so the tune is something the run reaches rather
   * than something it opens with — except during the intro, where
   * `INTRO_ENTRY` and the intro floor still stage it deliberately.
   */
  lead: { in: 0.34, full: 0.84, ceiling: 0.4, floor: 0.2 },
  // `motifs` and `power` are driven by events rather than by tension: the
  // director replaces their level outright in `updateLevels`.
  //
  // `fx` USED to belong in that group and no longer does — its section
  // decision is now a multiplier over `stemLevel`, not a replacement for it,
  // so it tracks intensity like any other lane (see the note on its entry
  // below, and `director.updateLevels`). Leaving it named here would point the
  // next reader straight back at the two-valued switch that was removed.
  /*
   * The fx lane carries risers, fills, impacts, the low-health heartbeat and
   * the graze shimmer — mostly noise, and mostly transient. It ended up the
   * loudest thing in the mix at 0.72 average, above the melody, purely because
   * its level was set early and never revisited while everything around it was
   * rebalanced. Noise that loud is what eats a mix's clarity.
   */
  /*
   * `full` is 0.78, not 0.5. Measured on the real game (`npm run realprobe`),
   * energy has a median of 0.622, so a `full` of 0.5 left this lane pinned at
   * its ceiling for 68% of the run — the curve's whole working range sat below
   * the signal. 0.78 is just under the measured p99 of 0.792, which spreads
   * the lane across the range it will actually see. The ceiling is unchanged,
   * so the loudness concern above is untouched: this changes when fx is loud,
   * not how loud it is allowed to get.
   */
  fx: { in: 0.0, full: 0.78, ceiling: 0.5, floor: 0.24 },
  /*
   * `session` reports this lane parked at the top 52% of the run, and that is
   * NOT the same defect the kick had. Raising `full` here was tried and changed
   * nothing, because the motifs level does not come from this curve:
   * `director.updateLevels` overrides it with a `presence` term computed from
   * enemy count and threat, deliberately flattened so the loop yields to the
   * shooting on a busy stage. See the comment there. Near-constant is the
   * intent — leave the curve alone and read the override instead.
   */
  /*
   * ...AND THE CEILING COMES DOWN 0.6 -> 0.36.
   *
   * Three of the eight rows in `MOTIFS` - `arpeggiator`, `echo` and `pluck` -
   * are TRIANGLE STABS AT `chord.root + 12`, which is MIDI 69, 440 Hz: the
   * melody's own register and the melody's own waveform. Two of them can
   * sound at once (`MAX_MOTIFS`), two to four notes a bar each, continuously,
   * for as long as those enemies are on the field. Summed, that is a second
   * melody the score never wrote down, and it survived every demotion of the
   * `lead` lane because it is not in that lane.
   *
   * NOT DELETED AND NOT RE-VOICED, and both halves of that are deliberate.
   * The layer is DIEGETIC - it is how a player hears which archetypes are on
   * screen, which is the premise of the whole game - and `tools/bosscheck.mjs`
   * pins two of these rows to specific waveforms, so a re-voicing takes that
   * gate red and owes it a replacement assertion. Level is the change that
   * costs nothing it should not cost: -8.9 dB after gain-squaring, still
   * plainly audible as signalling, no longer a line you would follow.
   *
   * NAMED FOR THE NEXT PASS: if a melodic complaint survives this, these
   * three rows are the first place to look, and the answer there is to make
   * them percussive rather than pitched.
   */
  motifs: { in: 0.0, full: 0.5, ceiling: 0.36, floor: 0.22 },
  power: { in: 0.0, full: 0.5, ceiling: 0.85, floor: 0.6 },
};

/**
 * When each layer arrives during the opening phrase.
 *
 * A track does not begin with everything playing; it begins with one thing and
 * earns the rest. The order is chosen so the opening states the harmony first
 * and the rhythm last — you hear what key you are in before you hear the beat,
 * which is the opposite of how the rest of the run behaves and makes the intro
 * feel like an intro.
 */
/*
 * THE ORDER IS REVERSED FOR THE TWO LANES THAT SWAPPED ROLES.
 *
 * The note above is still exactly right about what an intro is for — one thing
 * first, everything else earned — and the ORDER is still harmony before rhythm.
 * What changed is which part the intro exists to introduce. It used to be the
 * tune, entering at 0.16, before the kick, before the bass, before everything
 * except the pad and the sub; the bass came in at 0.68, seventh of nine.
 *
 * The bass is the hook now, so the bass is what gets introduced: 0.2, third,
 * straight after the two beds. The tune goes last of the pitched lanes at 0.72
 * — a stab arriving over an established groove, which is how this genre states
 * a lead when it states one at all. Nothing else in the order moves.
 */
const INTRO_ENTRY: Record<StemId, number> = {
  // Negative, so these two are already partly present on the very first bar.
  // Ramping them from exactly zero measured as a full bar of literal silence
  // after pressing start, which reads as the game failing to boot rather than
  // as an intro.
  sub: -0.14,
  chords: -0.06,
  bass: 0.2,
  hats: 0.42,
  kick: 0.55,
  lead: 0.72,
  clap: 0.8,
  arp: 0.9,
  fx: 0,
  motifs: 0,
  power: 0,
};

/** 0..1 multiplier for a stem at a given point in the opening phrase. */
export function introGate(id: StemId, progress: number): number {
  const at = INTRO_ENTRY[id];
  if (progress <= at) return 0;
  // Fade in over a quarter of the phrase so nothing snaps on.
  return clamp01((progress - at) / 0.18);
}

/**
 * Level for a stem at a given tension. Smoothstepped, so a player hovering near
 * a boundary hears a layer breathing rather than chattering — which is also why
 * the old entry/exit hysteresis is no longer needed for gain. Hysteresis still
 * applies to *pattern rebuilds*, which are discrete and must not thrash.
 */
export function stemLevel(id: StemId, tension: number): number {
  const c = STEM_CURVES[id];
  if (tension <= c.in) return 0;
  const t = clamp01((tension - c.in) / Math.max(1e-4, c.full - c.in));
  const eased = t * t * (3 - 2 * t);
  return c.floor + (c.ceiling - c.floor) * eased;
}

/** Continuous controls the director drives; layers read them as patterns. */
export interface Signals {
  /** Sustained tension, 0..1. */
  tension: Pattern;
  /** Build progress, 0..1; flat 0 outside a build. */
  build: Pattern;
  /** Master low-pass position, 0..1. Collapses on death. */
  openness: Pattern;
  /** Extra drive/saturation, 0..1. */
  drive: Pattern;
  /**
   * How badly hurt the player is, 0 (fine) .. 1 (one hit from dead). Drives a
   * rising high-pass so the track physically loses its body as you take damage.
   */
  thin: Pattern;
  /**
   * REVERB (rig): extra room send, 0..1, added on top of whatever a lane
   * already sends. 0 when the ability is not held, so the written mix is
   * unchanged. See the note on `p` in director.ts.
   */
  space: Pattern;
  /** RESONANCE (rig): extra filter resonance, 0..1. */
  ring: Pattern;
  /** FERMATA (rig): how much longer notes ring on, 0..1. */
  hold: Pattern;

  /* -------------------------------------------------------------------------
   * Dials that used to CHOOSE NOTES and are now read per hap.
   *
   * Each of these previously sat in `MusicalState` as a number, was compared
   * against a threshold inside a builder, and so decided which notes existed.
   * Crossing the threshold rewrote all eight bars. Measured with
   * `tools/retention.mjs`, one step of the intensity dial left the arp with 15%
   * of its phrase, the hats with 18%, the bass with 33% and the lead with 50%;
   * one flip of the lead's register left the melody with 33%.
   *
   * As signals they change how a note SOUNDS rather than whether it exists —
   * including notes already scheduled — so the material is identical either
   * side of the move and the response is a fade instead of a cut.
   * ---------------------------------------------------------------------- */

  /**
   * Semitones the melody is transposed by, from the player's height on screen.
   *
   * This was baked into the note numbers, so flying up the screen replaced
   * every pitch in the phrase. Transposition is the clearest case there is of
   * something that should ride on the notes rather than define them.
   */
  register: Pattern;
  /**
   * Semitones the arp is transposed by: 0, or -12 when it must get out of the
   * melody's way.
   *
   * Winning a slot in the voice budget is not the same as being heard. The arp
   * sits on `chord.notes + 12` and the melody on `tonic + 12` — the same
   * octave — so whenever both survive the budget the accompaniment runs
   * straight through the tune. That is the oldest mistake in orchestration,
   * doubling your melody with your accompaniment and wondering why neither
   * reads, and it does not present as a level problem, which is why no amount
   * of fader work was ever going to fix it.
   *
   * A signal rather than a rebuild-time decision, for the same reason every
   * dial in this block is a signal: the two lanes' levels move continuously, so
   * baking the octave into the note numbers would rewrite the arp's entire
   * phrase every time the melody came forward. See
   * `orchestration.arpDisplacement`.
   */
  arpOctave: Pattern;
  /** 0..1: how much of the melody's weak-beat filigree is heard. */
  density: Pattern;
  /** 0..1: the melodic ornament on the fourth slot of each group. */
  ornament: Pattern;
  /** 0..1: how much of the arp's gap-filling is heard. */
  fill: Pattern;
  /** 0..1: the chord's 7th. */
  colour7: Pattern;
  /** 0..1: the chord's 9th, which arrives after the 7th. */
  colour9: Pattern;
}

export interface MusicalState {
  tension: number;
  immediate: number;
  section: SectionName;
  buildProgress: number;
  fillBar: boolean;
  bar: number;
  tonic: number;
  mode: ModeName;
  chord: Chord;
  /** The chord this bar is heading toward, so the bass can walk into it. */
  nextChord: Chord;
  chordIndex: number;
  /** 0..7 position within the eight-bar phrase this pattern slot represents. */
  barInPhrase: number;
  /** How many eight-bar phrases into the run we are; drives motivic development. */
  phrase: number;
  /** Rhythmic character for this wave. See `FEELS`. */
  feel: Feel;
  bpm: number;
  /** Rhythmic intensity, 0..1. Derived from tension but floored by section. */
  intensity: number;
  brightness: number;
  powerups: Partial<Record<PowerupKind, number>>;
  enemies: Record<EnemyArchetype, number>;
  boss: boolean;
  /**
   * The boss flag as the HARMONY sees it, latched to a phrase line.
   *
   * `boss` is live and must stay so — the extra octaves and the faster vibrato
   * below should thicken the moment a fight starts. But WHICH TUNE plays is a
   * harmonic decision, and the mode it needs is chosen in `updateHarmony`,
   * which only runs on phrase boundaries. With the theme following the live
   * flag, `BOSS_THEME` began up to eight bars before `harmonicMinor` did, so
   * the leitmotif opened every fight in the wrong scale — the augmented second
   * it is written around simply absent until the next phrase.
   *
   * That is the desync the mode's own comment warns about, arriving from the
   * other side: "changing modes underneath it mid-fight would rewrite its
   * intervals and throw away the recognition the leitmotif exists to buy."
   */
  bossTheme: boolean;
  bossPhase: number;
  wave: number;
  /**
   * True once the run has reached its recapitulation. See `themeForWave`.
   *
   * A property of WHERE IN THE RUN this bar falls, not of the wave — it is the
   * only field in this interface that is, and that is the point. Everything
   * else here is a cycle; this is the one term that knows the run has been
   * going for sixteen minutes.
   */
  recap: boolean;
  /** Bombs in reserve. */
  bombs: number;
  /** 1 = untouched, 0 = one hit from a game over. */
  health: number;
  /** Grazes per second, smoothed. Drives the shimmer. */
  grazeRate: number;
  /** Score multiplier, 1 upward. Above eight the lead grows a descant. */
  combo: number;
  /** Register offset in semitones, from how far up the field the player is. */
  leadRegister: number;
  /** The named rule this wave runs under, or null on an ordinary wave. */
  movement: Movement | null;
  sig: Signals;
}

/**
 * The named wave variations, from wave 9 on.
 *
 * Taken from `GameSnapshot` rather than redeclared, so the two cannot drift:
 * `flank` is announced as FLANKED, `elite` as SOLOIST, `hush` as HUSHED.
 *
 * The premise of this game is that the stage and the score are the same thing,
 * so a wave that is announced by a banner and plays by its own rule cannot
 * sound like an ordinary wave. Each one gets a gesture rather than a effect:
 * something an arranger would do, not something a synthesiser would do.
 */
export type Movement = NonNullable<GameSnapshot['movement']>;

/**
 * Per-stem level multipliers, applied on top of the ordinary faders.
 *
 * These are the part of a movement that is pure mix, kept in one table so the
 * balance can be read at a glance instead of being scattered through eleven
 * builders. The parts that are not mix — how open the lead is, how wide the
 * chords sit — live in the builders, because they change how a note is made
 * rather than how loud it is.
 */
export const MOVEMENT_MIX: Record<Movement, Partial<Record<StemId, number>>> = {
  /*
   * HUSHED: nothing shoots. The quietest the stage ever gets, so the
   * arrangement OPENS rather than subtracting — the kit steps back and the tune
   * and its harmony come forward into the space. Fourteen iterations of this
   * project only ever added layers; a movement that is defined by absence is
   * the one place where taking the drums out is the gesture.
   */
  /*
   * HUSHED subtracts. It does not add reverb to a room that just emptied.
   *
   * The first version pulled the kit back a little and pushed the pad, the lead
   * and the fx wash UP, and `tools/movements.mjs` could not tell it from an
   * ordinary wave. That is the right answer to the wrong question: on an
   * ordinary wave the enemy fire fills the middle of the mix, and on a hushed
   * one it does not, so the arrangement's job is to USE that space rather than
   * to pour more into it. Boosting the noise lane was filling the silence the
   * movement is made of.
   *
   * So the kit very nearly goes, the two activity layers go with it, the wash
   * comes down rather than up, and the tune and its harmony are left standing
   * almost alone. The lead keeps the long-tailed `open` treatment in
   * `buildLead` — a tail is exposure rather than clutter — but nothing else is
   * added. This is the one wave in the run that gets to be quiet.
   */
  hush: { kick: 0.18, clap: 0.1, hats: 0.28, bass: 0.55, arp: 0.4, motifs: 0.45, fx: 0.6, chords: 1.15, lead: 1.15 },
  /*
   * SOLOIST: one enemy carries the whole section's health and score, so one
   * voice carries the line and the ensemble drops behind it. The lead also
   * lengthens (see buildLead) — a soloist sustains, it does not pluck.
   */
  elite: { lead: 1.35, arp: 0.4, chords: 0.7, motifs: 0.45, hats: 0.8 },
  /*
   * FLANKED: they arrive from the wings, so the music arrives from the wings.
   * Almost all of this one is stereo placement rather than level; see the pan
   * split in buildArp and the widened pad in buildChords.
   */
  flank: { arp: 1.2, chords: 1.1 },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * WHAT SOUND EACH PITCHED VOICE GROUP IS, as data, exported, and read by both
 * the builders and the tools.
 *
 * `AGENTS.md` §3: "A tool holding its own copy of a constant will lie the day
 * it moves." It did, twice, in this pass. `tools/harmony.mjs` selected the stab
 * with `e.s === 'pulse' && e.pw === 0.5` and the pad with `pw === 0`, and
 * `tools/registermap.mjs` kept a `GROUP_WINDOW` table keyed on the same
 * strings. The moment the pad stopped being a square, both gates went red while
 * reporting things about the harmony that were not true — "the pad produced no
 * bar with two tones", on a pad producing two tones in all 88 bars.
 *
 * The identity of a voice group is (oscillator, duty, unison). Those three and
 * nothing else: `detune`, `spread`, `pwrate` and the filters are how a voice is
 * SET UP, and they move without the group becoming a different instrument.
 *
 * `unison` is in the key because two lanes are supersaws now — the bed at three
 * voices and the upper structure at two — and a grouping that could not tell
 * them apart would merge a 47-57 window with a 78-90 one and report a single
 * group sprawling forty-three semitones.
 */
/*
 * FOUR OF THESE FIVE ARE NOW REAL INSTRUMENTS, and the group identity is the
 * SOURCE rather than the oscillator.
 *
 * `src/audio/soundfonts.ts` owns which instrument each role plays and why, and
 * owns the fallback: a lane whose samples do not load keeps the oscillator it
 * had before, per-lane, so a flaky connection costs a timbre and never a part.
 * `s`/`pw`/`unison` below are the WRITTEN source — what the score says, which
 * in Node is also what the builders emit, so the gates measure the shipping
 * path rather than the fallback. `resolveTag` is what the builders and any tool
 * that wants the RUNTIME answer should call.
 */
export interface VoiceTag {
  /** The `theory.LANE_RANGE` window this group is folded into. */
  readonly lane: LaneId;
  readonly s: string;
  readonly pw?: number;
  readonly unison?: number;
  /**
   * The instrument role, when this group has one. `arp` deliberately does not:
   * every sampled candidate in its register is a struck metal bar, which is the
   * complaint rather than the cure. See the tombstone in `soundfonts.ts`.
   */
  readonly role?: VoiceRole;
}

/*
 * THE TAG'S `s` IS THE SOURCE THE SCORE IS WRITTEN WITH, WHICH IS NOT ALWAYS
 * THE INSTRUMENT.
 *
 * `soundfonts.ts`'s `SAMPLED_ROLES` decides which roles are allowed a sampled
 * instrument at all, and it is currently the bass alone — the harmony and
 * melody lanes went back to synthesis after the first build that shipped them
 * was heard ("sounds so whack like carnival"). A role that is not enabled has
 * an entry in `INSTRUMENTS`, so re-enabling it is one line, but it emits its
 * oscillator.
 *
 * So this table asks `voiceSource` rather than reading `INSTRUMENTS[x].font`.
 * Written as a literal it would have said `gm_synth_strings_1` while the
 * builders emitted `supersaw`, and `registermap` builds its window table from
 * exactly these entries — the gate would have gone red reporting "a lane is
 * silent", which is AGENTS.md §3's own recorded failure mode for the third
 * time in this file.
 */
const roled = (lane: LaneId, role: VoiceRole): VoiceTag => {
  const v = voiceSource(role);
  return { lane, role, s: v.s, pw: v.pw, unison: v.unison };
};

export const VOICE_TAGS = {
  pad: roled('pad', 'pad'),
  colour: roled('colour', 'colour'),
  stab: roled('stab', 'stab'),
  motor: roled('motor', 'motor'),
  arp: { lane: 'arp', s: 'triangle' },
} satisfies Record<string, VoiceTag>;

/**
 * The source controls this tag emits RIGHT NOW.
 *
 * In Node that is always the written source; in the browser it is the
 * oscillator until the samples are resident. Exported so a tool can build a
 * group key for either mode from one definition instead of a copy.
 */
export function resolveTag(t: VoiceTag): ResolvedVoice {
  if (t.role) return voiceSource(t.role);
  return { s: t.s, pw: t.pw, unison: t.unison, sampled: false };
}

/**
 * Apply a voice tag. The controls that decide WHICH INSTRUMENT this is.
 *
 * `extra` carries the controls superdough reads only inside one oscillator's
 * branch, and it is passed IN rather than chained by the caller so that it
 * disappears with the oscillator. `.detune()`/`.spread()` are supersaw-only and
 * `.pwrate()`/`.pwsweep()` are pulse-only (AGENTS.md §4); set on a soundfont
 * they are silently inert, which is a defect this project has already shipped
 * once and which `tools/session.mjs` now counts.
 */
export function tagVoice(p: Pattern, t: VoiceTag, extra?: SynthOnly): Pattern {
  const v = resolveTag(t);
  let out = p.s(v.s);
  if (v.n !== undefined) out = out.n(v.n);
  if (v.pw !== undefined) out = out.pw(v.pw);
  if (v.unison !== undefined) out = out.unison(v.unison);
  if (!extra) return out;
  if (v.s === 'supersaw') {
    if (extra.detune !== undefined) out = out.detune(extra.detune);
    if (extra.spread !== undefined) out = out.spread(extra.spread);
  }
  if (v.s === 'pulse') {
    if (extra.pwrate !== undefined) out = out.pwrate(extra.pwrate);
    if (extra.pwsweep !== undefined) out = out.pwsweep(extra.pwsweep);
  }
  return out;
}

/** MIDI numbers as a mini-notation sequence. */
const seq = (notes: number[]): string => notes.join(' ');

/** MIDI numbers as a single stacked chord event. */
const chordOf = (notes: number[]): string => `[${notes.join(',')}]`;

/*
 * `chordStabs` used to live here — "repeat a chord n times across the bar".
 * It is gone because repetition is a RHYTHM, and a rhythm is now written as a
 * `struct` rather than baked into a note string. Its one caller was the pad's
 * intro restatement, which is `.struct('x x')`.
 */

/**
 * Pan positions fanning a chord across the stereo field, lowest voice leftmost.
 *
 * THIS EXISTS BECAUSE `.spread()` DOES NOTHING HERE, and that was my mistake.
 * superdough reads `spread` only inside its `supersaw` registerSound branch —
 * grep `synth.mjs` and it appears once, in the supersaw destructure. When the
 * harmony lanes were converted from supersaw to `s('pulse')`, every
 * `.spread()` on them silently became inert, including the SPREAD powerup's
 * contribution and the FLANKED movement's widening. The comment left behind
 * claimed the powerup was "now genuinely wider — real stereo placement of the
 * voices", which is precisely what stopped happening.
 *
 * So place the voices for real. This is also what the hardware did: the Game
 * Boy's stereo is literally a per-channel left/right assignment, and the
 * SPC700 has per-voice panning — a chip chord is spread across the field by
 * construction, never a stack of centred voices.
 *
 * It matters beyond authenticity. `tools/masking.mjs` attributes the largest
 * share of critical-band roughness in the score to the pad against the melody,
 * and two sounds a semitone apart mask each other far less when they are not
 * in the same speaker. This buys separation without moving a single note.
 *
 * Width 0 collapses to centre. It is capped at 0.76, so the outer voices reach
 * 0.12 and 0.88 and never the hard edges: a sustained chord tone sitting
 * entirely in one ear is disembodied on headphones rather than wide, and it
 * also means a listener on one earbud loses a whole voice of the harmony.
 * Measured before the cap, three SPREAD pickups put the outer voices at exactly
 * 0 and 1. The melody stays centred throughout — it is the thing being listened
 * to — so only the accompaniment fans.
 */
const FAN_MAX = 0.76;
const fanPans = (count: number, width: number): number[] => {
  if (count <= 1) return [0.5];
  const w = Math.min(FAN_MAX, clamp01(width));
  return Array.from({ length: count }, (_, i) => 0.5 + (i / (count - 1) - 0.5) * w);
};

// ---------------------------------------------------------------------------
// feel — the rhythmic character of a wave
// ---------------------------------------------------------------------------

/**
 * Each wave gets a groove, and the run moves between them.
 *
 * Four-on-the-floor is home base; the others are excursions, so a long run
 * stops being one loop and becomes a set. Boss waves always gallop, because a
 * boss should announce itself with a different rhythm before you have finished
 * reading the screen.
 *
 *   fourfloor — straight EDM: kick on every beat, offbeat bass
 *   trap      — half-time backbeat, hat rolls and triplets, gliding 808
 *   gallop    — the palm-muted da-da-dum, at home in phrygian
 *   swing     — shuffled eighths and lush extended voicings
 *   dubstep   — half-time, a wobble bass playing the rhythm, funk on top
 */
/*
 * The grooves, named for what they are rather than for a dance genre.
 *
 * These were `fourfloor`, `trap`, `gallop`, `swing` and `dubstep`, and
 * `FEEL_LABELS` put "four-to-the-floor", "half-time trap" and "half-time
 * wobble" **on screen, in the HUD, where the player reads them** — in a game
 * whose standing complaint is that it sounds like cheap techno. The score was
 * announcing the genre it was trying to stop being.
 *
 * Worse, they had stopped being true. The literal four-on-the-floor kick is
 * gone (see `kickRhythm`), and that feel's inner voice is now a boom-chick;
 * `trap`'s motor is Pokemon's chromatic run over a pedal bass. A name that is
 * both off-brief and inaccurate is worth the churn of changing.
 *
 * The new names are what a musician would call them, and each one now matches
 * the figure the builders actually produce.
 */
export type Feel = 'boomchick' | 'chase' | 'gallop' | 'shuffle' | 'halftime';

/**
 * HALF-TIME IS THE POSTURE, and the other four are excursions from it.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED AND WHY, because this rota has been re-weighted twice
 * ---------------------------------------------------------------------------
 *
 * It was eight slots with three of them `halftime`, and the comment that stood
 * here called that "a deliberate change of centre of gravity". It was — for a
 * score with no named genre. There is one now: **"i mean it should be like dub
 * step lol"**, which is the first time in seven rounds of feedback that the
 * target has been a thing rather than the absence of a complaint.
 *
 * Half-time at 140 IS the genre. Kick on 1, snare on 3, so the bar reads at 70
 * against a grid running at 140 — that single relationship is what a listener
 * identifies dubstep by before any timbre arrives. A groove rota that spends
 * two thirds of its slots somewhere else is not a dubstep score with variety in
 * it; it is a variety score that visits dubstep.
 *
 * Twelve slots, eight of them half-time. The other four are one each, spaced so
 * that no two excursions are adjacent and every one of them is a single wave —
 * you leave home, you notice, you come back. `basscheck` asserts all five are
 * reachable FROM THE ROTA (not merely from the boss override), which is what
 * stops this collapsing to one entry.
 *
 * AND THE BOSS IS HALF-TIME NOW, not `gallop`. That is the larger half of this
 * change by BARS rather than by waves: bosses are long, and the previous
 * override made `gallop` the most-played groove in the game — measured over
 * five ten-minute runs, the share of BARS was gallop 30.3%, halftime 27.8%,
 * boomchick 23.2%, chase 10.6%, shuffle 8.1%. So the single heaviest, longest
 * stretch of every run was the one groove furthest from the brief.
 *
 * A boss is the drop. In this genre that is not an analogy — the drop is where
 * the bass takes over completely, and a boss fight is the only event in the
 * game long enough and loud enough to be one. `gallop` stays in the rota as an
 * excursion so nothing is deleted and `basscheck` still reaches it.
 *
 * WRITTEN, NOT MEASURED: the bar shares above are from the old rota. The new
 * expected share by WAVE is halftime 67%, everything else 8.3% each, and by BAR
 * it will be higher still because the boss override now points here. Nothing in
 * this change has been heard.
 */
const FEEL_CYCLE: readonly Feel[] = [
  'halftime',
  'halftime',
  'chase',
  'halftime',
  'halftime',
  'boomchick',
  'halftime',
  'gallop',
  'halftime',
  'halftime',
  'shuffle',
  'halftime',
];

export function feelForWave(wave: number, isBoss: boolean): Feel {
  return isBoss ? 'halftime' : FEEL_CYCLE[wave % FEEL_CYCLE.length];
}

/**
 * A hue per groove.
 *
 * The playfield has looked the same for thirty-four iterations while the music
 * moved through four distinct grooves, so a run had no sense of *place* — every
 * wave was the same blue room with different notes in it. Tying the palette to
 * the groove means the trap waves look like trap waves, and the change lands on
 * the same bar the rhythm does.
 */
/*
 * THE TWO HUES SWAPPED WHEN THE ROTA DID, and this is a real cost avoided
 * rather than a tidy-up.
 *
 * `halftime` held 82 — acid lime — because it was an excursion, and an
 * excursion is allowed a loud room. It is now two thirds of the waves and every
 * boss, so leaving it there would have painted about three quarters of a
 * twenty-minute run lime. A palette is a sense of PLACE (that is what the note
 * below it says), and a place you never leave is not one.
 *
 * So home base keeps the home hue: 205, the blue the arena has always mostly
 * been, moves onto `halftime`, and `boomchick` — now one slot of twelve —
 * takes the lime. No new colours, the same five values, and the lime's own
 * constraint is unaffected: it is still clear of the 130-170 band the green
 * collectible shards live in, and so is 205.
 */
export const FEEL_HUES: Record<Feel, number> = {
  // Acid lime, and kept clear of 130-170 on purpose: the collectible notes are
  // green, and a green room to pick green shards out of is a palette that costs
  // the player information.
  boomchick: 82,
  chase: 282,
  gallop: 8,
  shuffle: 42,
  halftime: 205,
};

/*
 * What the HUD tells the player they are listening to.
 *
 * These are read on screen, and they used to say "four-to-the-floor",
 * "half-time trap" and "half-time wobble" — three dance-music genre names, in
 * the readout, of a game whose one standing complaint is that it sounds like
 * cheap techno. Whatever the score actually did, the interface was naming the
 * genre for the player.
 *
 * They were also no longer accurate. There is no four-on-the-floor kick left in
 * `kickRhythm`, and that groove's inner voice is a boom-chick; the `chase`
 * motor is Pokemon's chromatic run over a pedal bass, which is not trap in any
 * sense. Each label now names the figure the builders actually produce, in the
 * terms the reference canon uses for it.
 */
export const FEEL_LABELS: Record<Feel, string> = {
  boomchick: 'boom-chick',
  chase: 'chromatic chase',
  gallop: 'gallop',
  shuffle: 'shuffle',
  halftime: 'half-time',
};

// ---------------------------------------------------------------------------
// rhythm ladders
// ---------------------------------------------------------------------------

/** Kick rhythm as a function of intensity and feel, in mini-notation over one bar. */
/*
 * THE KICK'S PITCH, and it is one constant because it used to be sixteen.
 *
 * It was `c1` — MIDI 24, 32.7 Hz — in every branch below. Measured through the
 * real chain (`tools/capture.mjs`, 32 bars, world seed 0x51ed, the kick
 * soloed): **87.9% of this lane's energy sat in the 31.5 Hz octave band**, and
 * that band is 3.8% of the whole mix. Reconstructing the mix from the soloed
 * stems, the kick is **100% of the 31.5 Hz band and 84% of the 63 Hz band**,
 * and the 63 Hz band is **0.2% of the mix**.
 *
 * So the mix had a hole exactly one octave wide, from 45 Hz to 89 Hz, with the
 * kick's whole fundamental sitting an octave BELOW it. 32.7 Hz is not a kick
 * drum, it is a sub-drop: a laptop speaker, a phone and most headphones
 * reproduce nothing there, so on the hardware this game is played on the kick
 * was audible only as the click of its own pitch envelope. That is the second
 * half of "no low end" — the first half is that `buildSub`, the only other
 * source below 125 Hz, sits at a fader of 0.08 (in-mix -62.7 dBFS, 0.0% of
 * every band).
 *
 * `g1` is MIDI 31, 49 Hz — the middle of the 63 Hz octave and the tuning a
 * kick drum actually has. Nothing else about the lane changes: same rhythms,
 * same envelope, same `penv` sweep from 20-30 semitones above, same gain. The
 * energy moves from a band nobody can hear into the band directly under the
 * bass, which is where the weight of a mix comes from.
 *
 * Below `buildSub`'s lowest note (MIDI 33 = 55 Hz) on purpose, so the two low
 * sources are not on the same pitch.
 */
const KICK_NOTE = 'g1';

export function kickRhythm(intensity: number, fill: boolean, feel: Feel = 'boomchick'): string {
  const k = KICK_NOTE;
  if (fill) {
    if (feel === 'chase') return `${k} ~ [${k} ${k}] [${k} ${k} ${k}]`;
    // Dubstep's fill is a stutter, not a roll: the last beat triplets in place
    // rather than accelerating, which is the gesture that says "here it comes"
    // in this genre specifically.
    if (feel === 'halftime') return `${k} ~ [~ ${k}] [${k} ${k} ${k}]`;
    return `${k} ${k} ${k} [${k} ${k} ${k}]`;
  }

  if (feel === 'halftime') {
    /*
     * Half-time, and the kick's job is to leave a hole for the snare on 3.
     *
     * Each step ADDS: the downbeat is always there, the push after the backbeat
     * arrives next, and the last beat fills in with a sixteenth pickup. Nothing
     * moves when it gets busier, which is what `tools/retention.mjs` is
     * measuring — and in half-time it matters more than anywhere else, because
     * there are so few hits that replacing one is replacing the bar.
     */
    if (intensity < 0.38) return `${k} ~ ~ ~`;
    if (intensity < 0.72) return `${k} ~ [~ ${k}] ~`;
    return `${k} ~ [~ ${k}] [${k} ~ ~ ${k}]`;
  }
  if (feel === 'chase') {
    // Half-time: the kick leaves room, and the space is the sound.
    if (intensity < 0.4) return `${k} ~ ~ ~`;
    if (intensity < 0.75) return `${k} ~ ~ [~ ${k}]`;
    return `${k} ~ [~ ${k}] [${k} ~]`;
  }
  if (feel === 'gallop') {
    // da  da-da  da  da-da
    if (intensity < 0.35) return `${k} ~ ${k} ~`;
    if (intensity < 0.7) return `${k} [~ ${k} ${k}] ${k} ~`;
    return `${k} [~ ${k} ${k}] ${k} [~ ${k} ${k}]`;
  }
  if (feel === 'shuffle') {
    if (intensity < 0.4) return `${k} ~ ${k} ~`;
    return `[${k}@2 ~] ${k} [${k}@2 ~] ${k}`;
  }

  /*
   * Home base, and the single most literal thing in this file that said
   * "techno": `c1*4` — a kick on all four beats — sat in the MIDDLE of the
   * ladder, which is to say it was the most-played state in the game.
   *
   * There is no four-on-the-floor anywhere in the canon this score is aiming
   * at. Not in Chrono Trigger, not in Castlevania, not in Mega Man 2, not in
   * Link's Awakening, not in Pokémon R/B. Where a kit exists at all it plays a
   * rock backbeat; where it does not, the pulse is entirely pitched.
   *
   * The ladder is now capped at three onsets and stays additive — a step never
   * moves a hit that was already sounding, it only adds one between them, which
   * is the property `tools/retention.mjs` measures. And it can afford to be this
   * sparse because the kick is no longer what keeps time: `buildMotor` is. That
   * is the whole trade, and it is why this change is cheap here and would have
   * been impossible before.
   */
  if (intensity < 0.14) return `${k} ~ ~ ~`;
  if (intensity < 0.34) return `${k} ~ ${k} ~`;
  if (intensity < 0.62) return `${k} ~ [~ ${k}] ~`;
  if (intensity < 0.82) return `${k} ~ [~ ${k}] ${k}`;
  return `${k} ~ [~ ${k}] [~ ${k}]`;
}

export function clapRhythm(intensity: number, fill: boolean, feel: Feel = 'boomchick', bar = 0): string {
  if (fill) return '~ x ~ [x x x]';
  // A ghost note on the second and sixth bars: small, but it is the difference
  // between a groove and a metronome.
  if (bar % 4 === 1 && intensity > 0.45 && feel !== 'chase') return '~ x [~ x] x';
  // Trap puts the backbeat on 3 alone — the half-time signature. So does
  // dubstep; its ghost notes are a separate layer in `buildClap` rather than a
  // busier string here, so that getting busier adds hits instead of moving them.
  if (feel === 'chase' || feel === 'halftime') return '~ ~ x ~';
  if (intensity < 0.6) return '~ x ~ x';
  return '~ x ~ [x ~ x]';
}

// ---------------------------------------------------------------------------
// programmed percussion
// ---------------------------------------------------------------------------

/*
 * THE SIXTEENTH GRID.
 *
 * This is the part of the score that is aimed at Aphex Twin, and it is aimed
 * at four mechanical properties rather than at a mood:
 *
 *   1. INTRICATE PROGRAMMED PERCUSSION. Sixteenths and thirty-seconds with
 *      ratchets, and ghost snares between the backbeats. The drums are a part,
 *      not a click track with decoration on it.
 *   2. RHYTHMIC DISPLACEMENT. The accent figure is an ADDITIVE GROUPING that
 *      does not divide sixteen evenly — 3+3+3+3+4, 3+3+2+3+3+2, 5+3+5+3 — so
 *      the bar is legible and permanently slightly wrong-footed against a kick
 *      that is still marking beat one. On some bars the whole figure starts a
 *      sixteenth late.
 *   3. EXTREME DYNAMIC RANGE. Three densities, not one texture: the accents
 *      are structural and always sound, the eighth bed rides `sig.density`
 *      (intensity 0.18-0.50) and the sixteenth bed rides `sig.fill`
 *      (0.58-0.82). At a calm moment this lane is five hits a bar; under
 *      pressure it is sixteen with thirty-second ratchets on top. Those are
 *      SIGNALS, so the change is a fade over the notes already scheduled and
 *      not a rebuild that replaces the part — the lesson `tools/retention.mjs`
 *      exists to enforce.
 *   4. BELL TIMBRE. `metal` is an FM triangle with an inharmonic 3.7x
 *      modulator, which is a struck-metal spectrum: tubular bell, prepared
 *      piano. It states a chord tone on the grid, so the percussion carries
 *      harmony without becoming another synth lane.
 *
 * WHY THIS IS IN THE `clap` STEM AND NOT A TWELFTH ONE. A new stem id costs
 * `STEM_IDS`, `STEM_LABELS`, `STEM_CURVES`, `INTRO_ENTRY`, `MOVEMENT_MIX`,
 * `orchestration`'s role table, the HUD, and every tool that enumerates lanes —
 * and buys nothing, because `clap` is already the stem that means "the kit
 * other than the kick" and its curve (`in: 0.26`) is already the statement
 * "percussion arrives when something is happening". Hats behind the clap fader
 * is the same fader decision a drummer makes.
 *
 * NOTHING HERE IS HARDCODED TO A BAR NUMBER. Every choice below is a function
 * of state the director already publishes: the grouping and the ratchet
 * placements come from `percSeed`, which is a hash of the bar's coordinates in
 * the run; how many ratchets there are comes from `intensity` and from the
 * STUTTER count, which is the archetype the README already calls "hi-hat"; and
 * the three densities are signals read per hap.
 */

/** Steps in the percussion lattice: one bar of sixteenths. */
const PERC_STEPS = 16;

/*
 * The additive groupings. Every one sums to sixteen and only the first divides
 * it evenly.
 *
 * This is the whole of trait 2 in one table. `[4,4,4,4]` is the square anchor
 * and is what plays when the stage is calm, so the ear has something to be
 * wrong-footed AGAINST — a bar that is always odd is not displaced, it is just
 * a different meter. The rest are the standard additive cells: `[3,3,3,3,4]` is
 * the tresillo run with a long tail, `[3,3,2,3,3,2]` is the tresillo doubled,
 * `[5,3,5,3]` is the wide one that lands a full eighth off the beat twice a
 * bar.
 *
 * They are ordered by how far they sit from square, because `percGrid` selects
 * from a PREFIX of this list whose length is set by intensity. That way a calm
 * bar cannot draw `[5,3,5,3]` and the ladder is monotone: getting busier can
 * only ever open the vocabulary, never close it.
 */
const PERC_GROUPINGS: readonly (readonly number[])[] = [
  [4, 4, 4, 4],
  [3, 3, 3, 3, 4],
  [4, 3, 3, 3, 3],
  [3, 3, 4, 3, 3],
  [3, 3, 2, 3, 3, 2],
  [2, 3, 3, 3, 3, 2],
  [5, 3, 5, 3],
  [3, 5, 3, 5],
];

/**
 * A deterministic 32-bit hash of where this bar sits in the run.
 *
 * NOT `Math.random`. Two reasons, and the second is the one that matters: the
 * director rebuilds a phrase several times inside it (see `phraseSeedVoicing`),
 * so a random draw would give the same bar a different drum part every time an
 * enemy died — the exact churn `tools/phrasechurn.mjs` measured on the lead and
 * that the intensity bucket exists to stop. A hash of `(bar, phrase, wave)` is
 * stable across rebuilds and still different in every bar of the run.
 *
 * `Math.imul` throughout, because the mixing constants overflow 2^53 under
 * ordinary multiplication and the low bits — which is what the modulos below
 * read — would come out zero.
 */
function percSeed(m: MusicalState): number {
  let h = Math.imul(m.bar + 1, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  h ^= Math.imul(m.phrase + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  h ^= Math.imul(m.wave + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return h >>> 0;
}

/** One bar of the grid, as step sets. Exported so tooling can measure it. */
export interface PercGrid {
  /** The additive grouping this bar used. Sums to `PERC_STEPS`. */
  grouping: readonly number[];
  /** Sixteenths the whole figure is displaced by: 0 or 1. */
  shift: number;
  /** Accent steps — the grouping, displaced. Always sound. */
  accents: number[];
  /** Even steps not taken by an accent. Ride `sig.density`. */
  eighths: number[];
  /** Odd steps not taken by an accent. Ride `sig.fill`. */
  sixteenths: number[];
  /** Ghost-snare steps, off the beat and off the backbeat. Ride `sig.fill`. */
  ghosts: number[];
  /** Step -> how many hits it splits into (2 or 3). A ratchet. */
  ratchets: Record<number, number>;
  /** Steps carrying the bell. The pitch is chosen in `buildClap`. */
  bells: number[];
}

/** Render a step set as one bar of mini-notation, honouring ratchets. */
function stepStruct(steps: readonly number[], ratchets: Record<number, number> = {}): string {
  const slots = new Array<string>(PERC_STEPS).fill('~');
  for (const i of steps) {
    const n = ratchets[i] ?? 1;
    // `[x x]` keeps the first hit exactly where the plain `x` was, so a ratchet
    // ADDS a hit rather than moving one. Same nesting property the sub and the
    // motor are built on, applied to the thirty-second grid.
    slots[i] = n > 1 ? `[${new Array(n).fill('x').join(' ')}]` : 'x';
  }
  return slots.join(' ');
}

/**
 * The bar's drum programme.
 *
 * Pure, deterministic and free of Strudel, so `tools/` can measure onset
 * density and grid distribution without building a pattern or making a sound.
 */
export function percGrid(m: MusicalState): PercGrid {
  const seed = percSeed(m);
  const stutter = m.enemies?.stutter ?? 0;

  /*
   * How far from square this bar is allowed to be.
   *
   * Intensity is the quantised bucket the rebuild key already tracks
   * (`director.intensityQ`), so this cannot change without a rebuild — which is
   * the contract that makes the key's own comment true. STUTTER is the
   * archetype the README describes as "hi-hat: sixteenth-note cluster, density
   * scales with swarm size", so a swarm of them opening the grid's vocabulary
   * is the ensemble premise applied to the one enemy that is literally this
   * instrument.
   */
  const reach = Math.min(
    PERC_GROUPINGS.length,
    1 + Math.floor(m.intensity * 5) + Math.min(2, Math.floor(stutter / 3)),
  );
  const grouping = PERC_GROUPINGS[seed % reach];

  /*
   * "A figure that starts a sixteenth late", on about a quarter of bars.
   *
   * Deliberately 0 or 1 and never more. Two sixteenths is an eighth, which the
   * ear re-hears as a different but still square placement; one sixteenth is
   * heard as the same figure arriving wrong, which is the effect being aimed
   * at. Suppressed on the fill bar because the fill is already the event.
   */
  const shift = !m.fillBar && (seed >>> 5) % 4 === 0 ? 1 : 0;

  const accents: number[] = [];
  for (let at = 0, g = 0; g < grouping.length; g++) {
    accents.push((at + shift) % PERC_STEPS);
    at += grouping[g];
  }
  accents.sort((a, b) => a - b);
  const isAccent = new Set(accents);

  const eighths: number[] = [];
  const sixteenths: number[] = [];
  for (let i = 0; i < PERC_STEPS; i++) {
    if (isAccent.has(i)) continue;
    (i % 2 === 0 ? eighths : sixteenths).push(i);
  }

  /*
   * Ratchets. One to three a bar, plus a roll on the fill bar.
   *
   * They alternate between the ACCENT ITSELF and the step BEFORE it, and both
   * halves of that are load-bearing.
   *
   * The step before an accent is the placement that reads as a flam INTO the
   * accent rather than as a stray thirty-second, and it is where the first
   * version put all of them. That was wrong for a reason nothing in the source
   * shows: the step before an accent is always a bed step (no grouping cell is
   * shorter than 2, so two accents are never adjacent), and the beds ride
   * `sig.density` and `sig.fill`. At low intensity those are zero, the haps
   * fall under `AUDIBLE_FLOOR`, and **every ratchet in a calm bar was
   * silent** — the trait the whole brief is about, unavailable in exactly the
   * passages that would show it off.
   *
   * So odd draws land on the accent, which always sounds. `stepStruct` applies
   * a ratchet to whichever layer owns that step, so an accent ratchet is two
   * thirty-seconds at the accent's own level and 46 ms decay — a buzz — while
   * a bed ratchet stays a quiet flam. Two articulations from one mechanism.
   *
   * The candidate list is derived from the grouping either way, so it moves
   * with it; that is what stops the ratchets reading as a separate fixed
   * pattern laid over a moving one.
   */
  const ratchets: Record<number, number> = {};
  const candidates: number[] = [];
  for (let i = 0; i < accents.length; i++) {
    candidates.push(i % 2 === 0 ? accents[i] : (accents[i] + PERC_STEPS - 1) % PERC_STEPS);
  }
  /*
   * RATCHET COUNT IS CAPPED, and the cap is a frame-time fix as much as a
   * musical one.
   *
   * `npm run jank` measures the frame-time tail. Silencing the two percussion
   * stems halves the dropped frames — 5.5% -> 2.7% over 33ms, 2.6% -> 1.5%
   * visible hitches, p99 73.1 -> 59.8ms — which makes this the densest thing
   * the 10Hz scheduler has to query and the only stem whose cost is visible in
   * the tail at all.
   *
   * A ratchet is the expensive part: `[x x x]` puts three haps where one was,
   * and the old formula grew them with BOTH intensity and the stutter count.
   * Those are the same conditions under which the field is fullest and the
   * frame budget is tightest, so the score was at its most expensive exactly
   * when the game could least afford it.
   *
   * Capped at three slots rather than five, and the stutter term is gone. It
   * is defensible on its own terms too: by the time intensity is high the
   * arrangement already has ghost snares, a sixteenth grid and the bell
   * running, and stacking five thirty-second subdivisions on top of that is
   * where a groove stops being legible and becomes a texture.
   */
  const want = Math.min(candidates.length, 3, Math.round(m.intensity * 2.0));
  for (let k = 0; k < want; k++) {
    const at = candidates[(seed >>> (3 * k + 7)) % candidates.length];
    // 2 or 3: a thirty-second pair, or a sixteenth-note triplet in one slot.
    ratchets[at] = ((seed >>> (2 * k + 11)) & 1) === 0 ? 2 : 3;
  }
  if (m.fillBar) {
    /*
     * The stutter fill. The last beat of the phrase ratchets in place rather
     * than accelerating — the same gesture `kickRhythm`'s half-time fill uses,
     * and the one Drukqs opens bars with.
     */
    /*
     * All four slots still roll, but never as triplets.
     *
     * The first attempt at this cut the fill to its last two sixteenths and
     * `perccheck` caught it immediately: "3300 fill bars did not roll". It was
     * right — the roll is a gesture with a shape, and two slots is not that
     * shape, it is two ratchets near the end of a bar. The gate was asserting
     * something real rather than a threshold, so the fix moved rather than the
     * gate.
     *
     * `2` instead of `2 + ((seed >>> i) & 1)` keeps every slot rolling and
     * removes only the thirty-second TRIPLETS, which is where the hap count
     * doubles for the least legible gain — a triplet inside a sixteenth at
     * 138bpm is 22 events a second in one slot.
     */
    for (let i = 12; i < PERC_STEPS; i++) ratchets[i] = 2;
  }

  /*
   * Ghost snares.
   *
   * The eight candidate steps are everything that is neither a beat (0 4 8 12)
   * nor a backbeat, which is the definition of a ghost: a snare you feel
   * between the ones you hear. Two or three of them, chosen per bar, so the
   * backbeat stays exactly where `clapRhythm` put it and the space around it
   * changes.
   */
  const ghostSlots = [2, 3, 6, 7, 10, 11, 14, 15];
  const ghosts: number[] = [];
  const ghostCount = 2 + ((seed >>> 17) & 1);
  for (let k = 0; k < ghostCount; k++) {
    const at = ghostSlots[(seed >>> (3 * k + 19)) % ghostSlots.length];
    if (!ghosts.includes(at)) ghosts.push(at);
  }
  ghosts.sort((a, b) => a - b);

  /*
   * The bell, and it is deliberately rare.
   *
   * Two steps at most, on half the bars, on chord tones folded high. A struck
   * inharmonic tone is the most identifiable thing in this whole block and it
   * is also the fastest to become wallpaper; the version that plays every bar
   * was written first and reads as a ride cymbal, which is the one thing it
   * must not be.
   */
  const bells: number[] = [];
  if (m.barInPhrase % 2 === 1 && accents.length > 1) {
    bells.push(accents[0]);
    if (m.intensity > 0.5) bells.push(accents[Math.floor(accents.length / 2)]);
  }

  return { grouping, shift, accents, eighths, sixteenths, ghosts, ratchets, bells };
}

// ---------------------------------------------------------------------------
// stems
// ---------------------------------------------------------------------------

export function buildSub(m: MusicalState): Pattern {
  const root = m.chord.root - 24;
  const nova = m.powerups.nova ?? 0;
  const half = (m.powerups.timewarp ?? 0) > 0;
  const fifth = root + degreeToSemitone(m.mode, 4);
  /** True when the default feel's layered lattice applies. */
  let layered = false;
  /*
   * Layered on one eighth-note lattice, so getting busier ADDS notes.
   *
   * Three lines used to be selected from thresholds on intensity, and they did
   * not nest: the quiet line put its note a quarter into the bar and the busier
   * ones put theirs an eighth in, so a step swapped every note rather than
   * adding one. Freezing the whole part to the section fixed the churn and
   * threw away the response with it, which is the wrong trade in a game whose
   * music is supposed to answer the play.
   *
   * The lattice is fixed at eighths and the notes stack: the anchor always
   * sounds, the fifth arrives as it fills out, the passing roots last. Every
   * note keeps its position and its length as the part gets busier, which is
   * what `tools/retention.mjs` calls a nested change.
   */

  /*
   * A part, not a shadow.
   *
   * The sub used to play the root wherever the kick played, which makes it a
   * thickener rather than an instrument — and wastes the one voice with the
   * whole bottom octave to itself. It now syncopates *against* the kick, which
   * is what a sub actually does: the kick marks the beat, the sub fills the
   * space between the marks. That also matters mechanically here, because the
   * low end carries the player's health, so it needs to be legible on its own.
   */
  let pattern: string;
  if (nova > 0) {
    // Nova holds a pedal — safety as a continuous floor.
    pattern = `${root}@3 ${fifth}`;
  } else if (half) {
    pattern = `${root}@3 ~`;
  } else if (m.section === 'intro') {
    /*
     * Two notes a bar during the opening, not one.
     *
     * Strudel patterns are installed live, and a hap whose onset is already in
     * the past never fires — so a one-note-per-bar intro can wait a whole bar
     * before making any sound. Measured: pressing start gave four seconds of
     * literal silence before the first note landed, which reads as the game
     * failing to boot. Halving the gap bounds that wait to one beat.
     */
    pattern = `${root} ~ ${root} ~`;
  } else {
    switch (m.feel) {
      case 'halftime':
        /*
         * The sub holds, and that is the whole part.
         *
         * Everywhere else in this file the sub is written to syncopate against
         * the kick, because a sub that doubles the kick is a thickener rather
         * than an instrument. Half-time inverts that argument: the wobble on
         * top is doing every bit of the rhythmic work in this octave, and a sub
         * answering it puts two parts in the same register arguing over the same
         * job. So it becomes a floor — one note, most of a bar — and the second
         * bar of each pair leans onto the fifth so the pair is a phrase rather
         * than a drone.
         */
        pattern = m.barInPhrase % 2 === 1 ? `${root}@3 ${fifth}` : `${root}`;
        break;
      case 'chase':
        // Long, then a late pickup into the next bar.
        pattern = `${root}@2 ~ [~ ${fifth}]`;
        break;
      case 'gallop':
        // Sits in the gallop's gaps rather than on its accents.
        pattern = `~ ${root} ~ ${root} ~ ${fifth} ~ ${root}`;
        break;
      case 'shuffle':
        pattern = `[${root}@2 ~] ~ [${fifth}@2 ~] ~`;
        break;
      default:
        /*
         * Four-to-the-floor: the sub lands on the *offbeats*, the eighths the
         * kick leaves open.
         *
         * This needs eight slots, not four. With four, `~ x ~ x` puts notes on
         * beats two and four — which are kick positions, so the sub was still
         * doubling it. Eight slots put them on the "and" of each beat, which is
         * the actual gap.
         */
        /*
         * The anchor, and nothing else, at all intensities.
         *
         * Still off the kick: this used to be `root ~ ~ ~` when calm — the
         * downbeat, exactly where the kick is — so the quiet sub went straight
         * back to doubling it, which is the thing this part exists to avoid.
         * The fifth and the passing roots are added by `layers` below.
         */
        pattern = `~ ${root} ~ ~ ~ ~ ~ ~`;
        layered = true;
        break;
    }
  }

  const lpf = (p: Pattern): Pattern =>
    p.lpf(half ? m.sig.openness.range(105, 505) : m.sig.openness.range(150, 720));
  const core = lpf(sub(pattern, 0.62, m.bpm));
  if (!layered) return core;
  return stack(
    core,
    // The fifth, an eighth before the halfway point.
    lpf(sub(`~ ~ ~ ~ ~ ${fifth} ~ ~`, 0.62, m.bpm)).gain(m.sig.density.range(0, 1)),
    // Passing roots on the remaining offbeats, last to arrive.
    lpf(sub(`~ ~ ~ ${root} ~ ~ ~ ${root}`, 0.62, m.bpm)).gain(m.sig.fill.range(0, 1)),
  );
}

export function buildKick(m: MusicalState): Pattern {
  const half = (m.powerups.timewarp ?? 0) > 0;
  // Half-time is a *feel* at constant tempo, not a tempo change: enemy volleys
  // are scheduled in beats, so touching BPM would move the battlefield too.
  /*
   * The kick DOES follow intensity, unlike the sub and the bass.
   *
   * A drop is defined by the kit arriving; a kick that only changed at section
   * boundaries would take the drop away. The retention cost is real and
   * accepted — `tools/retention.mjs` measures the kick keeping 65% of its
   * phrase across one step of the dial — because a busier kick pattern is the
   * arrangement working, not the tune being replaced. That distinction is the
   * whole point of the split: percussion may change, the melody may not.
   *
   * This was briefly broken by an unbounded string replace: the line below is
   * character-for-character identical to one in `buildBass`, so a single edit
   * meant for the bass silently landed here too and the kick stopped responding
   * to intensity at all. `tools/README.md` has a paragraph about exactly this.
   */
  const intensity = half ? Math.min(m.intensity, 0.3) : m.intensity;
  const weight = clamp01(intensity * 0.7 + m.tension * 0.3);
  return kick(kickRhythm(intensity, m.fillBar, m.feel), weight);
}

export function buildClap(m: MusicalState): Pattern {
  const half = (m.powerups.timewarp ?? 0) > 0;
  const nova = m.powerups.nova ?? 0;
  const rhythm = half ? '~ ~ ~ x' : clapRhythm(m.intensity, m.fillBar, m.feel, m.barInPhrase);
  const layers: Pattern[] = [clap(rhythm, m.brightness)];
  if (nova > 0) {
    // A wide room clap on the nova pulse beats, so the defensive ring and the
    // backbeat are audibly the same event.
    layers.push(
      clap('x ~ x ~', m.brightness)
        .ply(5)
        .bpf(1600)
        .room(0.42)
        .delay(0.22)
        .delaysync(1 / 8)
        .delayfeedback(0.28)
        .gain(0.3),
    );
  }
  if (m.feel === 'halftime' && !half) {
    /*
     * A dubstep snare is two sounds hitting together, not one.
     *
     * In half-time the backbeat lands once a bar, so it is carrying the pulse
     * on its own and it has to be big enough to do that — a clap alone is a
     * spray with no pitch in it, and at this spacing the ear hears a gap rather
     * than a beat. Stacking the tuned snare body under the clap and giving it a
     * real room is the standard trick and it is the whole character of the
     * genre's drums: one enormous hit, and space either side of it.
     *
     * Unlike the tension-gated snare below, this is not conditional. If the
     * backbeat comes and goes with intensity then half-time has no anchor.
     */
    layers.push(
      snare(m.fillBar ? '~ ~ x [x x x]' : '~ ~ x ~', 0.72)
        .room(0.44)
        .roomsize(ORBIT_ROOM[ORBIT_DRUMS]),
    );
    /*
     * Ghost sixteenths, and this is where the funk is.
     *
     * Half-time drums are mostly silence, which is the point, but silence with
     * nothing moving in it is a metronome at half speed. The ghosts sit on the
     * "a" of 2 and either side of 4 — the classic funk placements, under the
     * beat rather than on it — and they ride `sig.fill`, so a busy screen
     * fills the gaps in without touching the backbeat that defines the groove.
     */
    layers.push(
      clap('~ [~ ~ ~ x] ~ [x ~ x ~]', m.brightness)
        /*
         * THE POINT OF GHOST NOTES IS THAT THEY ARE NOT IDENTICAL. This layer
         * played the same four ghosts every bar. `degradeBy(0.25)` plays three
         * of four, differently, every bar — and DETERMINISTICALLY: Strudel's
         * randomness is a pure function of the query time
         * (`docs/research-dubstep.md` §0.3, measured), so the same bar always
         * draws the same ghosts and every baseline-comparing gate stays
         * stable. `.seed(11)` because two lanes calling the same stochastic
         * function at the same cycle get the SAME draw unless seeded apart;
         * the seed is what makes this a variation rather than a copy of any
         * other lane's.
         */
        .degradeBy(0.25)
        .seed(11)
        .velocity(0.38)
        .gain(m.sig.fill.range(0, 0.42))
        .pan(0.42),
    );
  } else if (m.intensity > 0.7 && !half) {
    layers.push(snare(m.fillBar ? 'x x x [x x]' : '~ ~ ~ x', m.tension));
  }
  if (!half) layers.push(...percLayers(m));
  return stack(...layers);
}

/**
 * The hat grid, the ghost snares and the bell, as patterns.
 *
 * Split out from `buildClap` so the step arithmetic in `percGrid` stays free of
 * Strudel and can be measured on its own — `tools/` reads the grid directly for
 * onset density and grid distribution, and building a `Pattern` to count its
 * onsets would be measuring the scheduler instead of the writing.
 *
 * Silent under TIMEWARP, which is the one state where adding hits is the wrong
 * answer: the powerup's whole gesture is the arrangement holding its breath,
 * `buildMotor` already collapses to a dotted-eighth displacement for it, and a
 * thirty-second ratchet under half-time is an argument rather than a groove.
 */
function percLayers(m: MusicalState): Pattern[] {
  const g = percGrid(m);
  const out: Pattern[] = [];

  /*
   * THREE HAT LAYERS ON ONE LATTICE, and the levels are three separate
   * decisions rather than one dial.
   *
   * Gain is squared by superdough's `setGainCurve`, so these are further apart
   * than they look: 0.82 / 0.48 / 0.34 is 0 / -4.7 / -7.7 dB, not 0 / -2.3 /
   * -3.8. That spread is the articulation. A hat line where every hit is the
   * same level is a shaker.
   *
   * The decays are the open/closed alternation `hatLayer`'s own comment has
   * promised since it was written and could not express until it took a decay
   * argument: the accents ring for 46 ms, the eighth bed for 22, the
   * sixteenths for 14. At 128 bpm a sixteenth is 117 ms, so nothing overlaps
   * and the difference is heard as weight rather than as smear.
   *
   * ---------------------------------------------------------------------
   * 0.52 -> 0.82, and the first number was measured and found to be nothing
   * ---------------------------------------------------------------------
   *
   * The grid was written at 0.52 / 0.30 / 0.21 and rendered through the real
   * chain (`tools/capture.mjs`, 16 bars, world seed 0x51ed, this stem soloed,
   * against a soloed-stem noise floor of 0.019 dB). It moved the stem's total
   * RMS by **+0.2 dB** and its 8 kHz octave band by **+0.4 dB**. That is a
   * real difference and a musically irrelevant one: in the full mix, whose own
   * repeat-render spread is 1.3 dB, it would not have been visible at all. An
   * entire drum programme had been added and the instrument could not see it.
   *
   * The arithmetic of why, because it is not obvious from the gains. This lane
   * is white noise through `hpf(7000..9400)` and `lpf(10500)` — about 16% of
   * the spectrum — against the backbeat's crack through 1600-6800, about 24%
   * of it; and a hat decays in 46 ms against the crack's 95-125. Per hit that
   * is roughly 8-9 dB before either gain is applied. Five accents a bar
   * against two backbeats does not close a gap that size.
   *
   * 0.82 is +3.9 dB of energy on the accents and the beds move with it. It is
   * deliberately near the crack's own 0.80: through a band a third as wide
   * with a decay half as long, the same NUMBER is a hat sitting well under a
   * snare, which is the balance being aimed at. WHAT IT SOUNDS LIKE IS
   * UNVERIFIED — this is a level chosen from a spectrum by someone who cannot
   * hear it, and it is the single number in this block most likely to be
   * wrong.
   */
  out.push(
    hatLayer(stepStruct(g.accents, g.ratchets), m.brightness, 0.82, 1, 0.046),
  );
  out.push(
    hatLayer(stepStruct(g.eighths, g.ratchets), m.brightness, m.sig.density.range(0, 0.48), 0.8, 0.022)
      // Opposite the accents' 0.56. The two hat densities are separated in the
      // field rather than in the spectrum, because they are the same noise
      // source through the same filter and there is nowhere else to put them.
      .pan(0.44),
  );
  out.push(
    hatLayer(stepStruct(g.sixteenths, g.ratchets), m.brightness, m.sig.fill.range(0, 0.34), 0.6, 0.014)
      .pan(0.62),
  );

  /*
   * Ghost snares.
   *
   * `.velocity()` and not `.gain()`. `snare()` is a two-part construction — a
   * band-limited noise crack at 0.36 over a tuned triangle body at 0.26 — and
   * a `.gain()` on the outside REPLACES both of those with one number, which
   * is the "later writes win" trap in AGENTS §4 and would flatten the two
   * halves into one. Velocity multiplies, so the internal balance survives.
   *
   * `weight` 0.2 makes this the softest snare in the score. `snare()` maps it
   * to `distort(1.1 + weight * 1.4)` = **1.38**, against the half-time
   * backbeat's 2.11 and the tension snare's ~1.8. Note that 1.38 is ABOVE
   * unity, so it is a little saturation and not the attenuation `distort`
   * gives below ~1 — the softness of this layer comes from the velocity, not
   * from the waveshaper. Never zero either way: superdough builds the curve
   * from this value and it collapses to silence at 0.
   */
  if (g.ghosts.length) {
    out.push(
      /*
       * 0.14-0.46, and the range is arithmetic rather than taste. superdough
       * passes velocity through the same `applyGainCurve(x => x*x)` as gain
       * (`superdough.mjs:609`) and then multiplies, so a velocity is squared
       * exactly like a fader is. Against the backbeat's crack at gain 0.80,
       * this lane's crack at 0.36 sits at `(0.36/0.80)^2` = -6.9 dB before
       * velocity; at 0.46 that becomes -13.7 dB and at 0.14 it is -24 dB. A
       * ghost note lives 12-20 dB under the backbeat — audible as weight
       * rather than as a hit — so the busy end lands in the band and the calm
       * end is the fade-in below it. Read as an unsquared 0.14-0.46 this
       * would be about twice as loud as it is.
       */
      snare(stepStruct(g.ghosts), 0.2)
        .velocity(m.sig.fill.range(0.14, 0.46))
        .pan(0.38),
    );
  }

  /*
   * The bell, on a chord tone folded above the motor.
   *
   * MIDI 81-92 — above the motor's 57-69 window and above the lead's measured
   * 57-68 doubling, so it cannot mask either. It reads as percussion because
   * of its spectrum rather than because of its register: `fmh(3.7)` is
   * inharmonic, so the ear files it with the struck things even though it is
   * stating the harmony.
   */
  /*
   * NOT IN THE DROP. `metal()` is an inharmonic FM bell stating a chord tone
   * at 1.3-2.5 kHz — direct competition for the band the mid-bass layer is
   * there to claim, in the one section where the bass is supposed to own the
   * record. Sustain and breakdown keep it. `docs/research-dubstep.md` §6.1.
   */
  if (g.bells.length && m.section !== 'drop') {
    const tone = m.chord.notes[g.bells.length > 1 ? 2 % m.chord.notes.length : 0];
    let pitch = tone;
    while (pitch < 81) pitch += 12;
    while (pitch > 92) pitch -= 12;
    out.push(
      metal(stepStruct(g.bells), 0.2, String(pitch))
        .velocity(m.sig.density.range(0.35, 0.85))
        .room(0.3)
        .pan(0.5),
    );
  }

  return out;
}

/**
 * THE MOTOR — the pulse, as a pitched voice.
 *
 * ---------------------------------------------------------------------------
 * Why this replaced the hi-hats
 * ---------------------------------------------------------------------------
 *
 * The user's complaint was that the score "feels like cheap techno", and six
 * independent analyses of this engine converged on one root cause:
 *
 *     TIME IS KEPT BY PERCUSSION, SO EVERY PITCHED LANE IS FREE TO BECOME
 *     TEXTURE.
 *
 * Everything else follows from that single inversion. Because four drum lanes
 * carried the pulse they all had to sound at once; because the floor was
 * carrying the beat it had to be loud and continuous, which is what forced the
 * sidechain ducking; and because the pitched lanes were no longer responsible
 * for time, they degenerated into functions of the harmony rather than lines —
 * a bass with three pitch classes, an arp whose rhythm is the exact complement
 * of the melody's so that the two can never sound together, a pad holding one
 * chord for two bars. With nothing moving harmonically and nothing moving
 * contrapuntally, the only dimension left for the game state to express is
 * loudness and filter position. That is the definition of a dance production.
 *
 * The canon this game is aiming at does the opposite, without exception. On the
 * SNES a voice can only sound one drum at a time, so the entire kit is one or
 * two of eight voices; Pokémon R/B has no drum channel at all, because the noise
 * channel is needed for cries. What keeps time in those scores is a
 * CONTINUOUSLY MOVING PITCHED LINE in the middle register that is simultaneously
 * the harmony — Pokémon's chromatic sixteenth runs, Bloody Tears' second pulse,
 * Wily Stage 1's arpeggiating triangle, the "chick" trumpets in Frog's Theme.
 * The kit is garnish on top of that, which is precisely why removing it costs
 * nothing.
 *
 * So this lane stops being four bars of white noise a second and becomes the
 * metronome that is also a part. Two things fall out for free: the kick becomes
 * optional, because something else is already keeping time; and the sidechain
 * has nothing left to duck against.
 *
 * ---------------------------------------------------------------------------
 * Why the motor is THIS lane and not the arp
 * ---------------------------------------------------------------------------
 *
 * The arp is the more obviously "musical" candidate and it is the wrong one.
 * `hats` already carries `Role: 'pulse'` in `orchestration.ts`, which means it
 * is exempt from the tonal voice budget — and a metronome must never be
 * something `allocate` can push down to `YIELD_FAR`. Converting the arp would
 * put the clock inside the budget and throw away the interlocking-rhythm and
 * contrary-motion work in `buildArp`, which is good and which becomes the
 * counter-melody. Converting the hats throws away only noise.
 *
 * ---------------------------------------------------------------------------
 * The register, which is the whole trick
 * ---------------------------------------------------------------------------
 *
 * Folded into MIDI 57..69 — the octave between the bass and the tune, and
 * nothing else in the arrangement lives there. That is what lets the motor run
 * continuously at every intensity without masking anything: it is not competing
 * for the melody's octave (see `Signals.arpOctave` for what happens when two
 * lanes do) and it is an octave above where the bass speaks.
 *
 * It never drops out during play. It is the clock.
 */
/*
 * The motor's register: the octave between the bass and the tune.
 *
 * The bass sits at `chord.root - 12` and reaches an octave above that; the lead
 * is based at `tonic + 12` and climbs. This window is the gap between them, and
 * keeping the motor inside it is what lets a lane that plays under every single
 * bar of the game do so without ever masking the melody or muddying the bass.
 *
 * Named because they are a contract, not a tuning preference — `motorcheck`
 * asserts them, and they are the reason the gallop's ascent has a ceiling.
 */
/*
 * Read out of `LANE_RANGE` rather than restated here.
 *
 * These two numbers are unchanged — the motor's window is the one register in
 * the score that did not move — but they now live in the same table every other
 * lane's window does, so `registermap`'s window assertion and `motorcheck`'s
 * range assertion are reading the same source as the builder. AGENTS.md §3:
 * "a tool holding its own copy of a constant will lie the day it moves."
 */
const MOTOR_BOTTOM = LANE_RANGE.motor.lo;
const MOTOR_TOP = LANE_RANGE.motor.hi;

/**
 * The motor's note line and the tones it was built from.
 *
 * Extracted from `buildMotor` so the SCORE PANEL can print the same string
 * the pattern is built from. `director.sourceLines` used to describe this
 * lane as `white(4) + white(8)*...` — a hi-hat — which it has not been since
 * `buildHats` was deleted and the pulse inverted: `STEM_LABELS.hats` reads
 * MOTOR, `director` maps the lane to this function, and `motorcheck` asserts
 * every note is a chord tone inside 57-69. The panel was showing noise for
 * the one lane the whole refactor was about.
 *
 * That comment block records the mirror drifting from the mix four times
 * before this. Four is enough: sharing the string is the only version of
 * this that cannot drift again, because there is now one source for it.
 */
export function motorVoicing(m: MusicalState): {
  line: string;
  root: number;
  third: number;
  fifth: number;
} {
  const half = (m.powerups.timewarp ?? 0) > 0;
  const nova = m.powerups.nova ?? 0;

  /*
   * Chord tones, folded into the motor's octave.
   *
   * The pitches come from the harmony rather than from a scale run, so the
   * motor IS the comping — it states the chord continuously, the way a boom-
   * chick keyboard part or an NES triangle does. Nothing else in the mix has to
   * hold the chord for it to be present, which is what allows the pad to become
   * an occasional colour rather than a permanent bed.
   */
  /*
   * `foldInto` rather than a hand-rolled loop, and it DEDUPES — which matters
   * now that the chord is a seventh.
   *
   * The old loop mapped every note and kept duplicates, so a chord whose fold
   * put two tones on the same pitch handed `third` and `fifth` the same number
   * and the comping quietly became a two-note figure. Four tones folded into
   * thirteen semitones makes that likely rather than rare.
   */
  const tones = foldInto(m.chord.notes, MOTOR_BOTTOM, MOTOR_TOP);
  const root = tones[0];
  const third = tones[Math.min(1, tones.length - 1)];
  const fifth = tones[Math.min(2, tones.length - 1)];

  /*
   * The shape, by feel. Each is a real idiom rather than a subdivision:
   *
   *   driving   one tone per beat, restruck — the NES inner voice
   *   gallop    1-3-5-8, the arpeggiating triangle of Wily Stage 1
   *   lurch     a chromatic ascent, Pokémon's buzzing run
   *   shuffle12 the offbeat "chick" of Frog's Theme, on the third and fifth
   *   march     triplets, which is what makes a march feel processional
   */
  /*
   * The top of the gallop's ascent, and why it is not simply `root + 12`.
   *
   * The figure is 1-3-5-8, Wily Stage 1's arpeggiating triangle, and an octave
   * ascent needs twelve semitones of headroom. The motor's window is thirteen
   * — so the 8 only fits when the folded root happens to land at the very
   * bottom of it, and on every other chord it overshoots into the melody's
   * register. `tools/motorcheck.mjs` measured exactly that: 50 notes reaching
   * MIDI 75 across the mode/degree space, against a stated ceiling of 69.
   *
   * That is the one thing this lane must never do. The whole reason the motor
   * can run under every bar without fatiguing anyone is that it occupies the
   * octave between the bass and the tune and stays there.
   *
   * So the ascent tops out on the octave when there is room and turns back to
   * the third when there is not: 1-3-5-3 instead of 1-3-5-8. That is a turn
   * rather than a restrike — still an arpeggio, still ascending for three of
   * its four notes, and it keeps the lane where it belongs.
   */
  const octave = root + 12 <= MOTOR_TOP ? root + 12 : third;
  let line: string;
  switch (m.feel) {
    case 'gallop':
      /*
       * A gallop is a RHYTHM, and this feel did not have one.
       *
       * The pitches were right — 1-3-5-8, Wily Stage 1's arpeggiating triangle
       * — but they were four even quarter notes, which is a metronome climbing
       * a chord. `tools/interlock.mjs` scored `gallop` the most grid-locked
       * feel in the game once the default was fixed: 28% of onsets off the
       * quarter-note against 63% for `swing`.
       *
       * A gallop is long-short: a dotted eighth and a sixteenth, the figure in
       * the William Tell Overture and in every chiptune chase cue written
       * since. `@3` gives that 3:1 ratio, so the four notes land on 1, the back
       * half of 2, 3, and the back half of 4. The ascent is untouched; it now
       * has the rhythm its own name promises, and half its onsets fall where
       * the kick and the bass are not.
       */
      line = `[${root}@3 ${third}] [${fifth}@3 ${octave}]`;
      break;
    case 'chase':
      /*
       * The chromatic run. Directional, and it buzzes rather than pulses.
       *
       * RUNS DOWN FROM THE THIRD rather than up from the root, and that is a
       * fix rather than a preference. `${root} ${root+1} ${root+2}` is written
       * relative to a note that is only bounded ABOVE by `MOTOR_TOP`, so on any
       * chord whose fold puts the bottom voice near the ceiling the third note
       * of the run left the lane's window — `research-music.md` §2.4 records it
       * reaching MIDI 71 against a stated ceiling of 69, with
       * `motorcheck.mjs`'s range assertion passing because the branch was never
       * reached in the states it sampled. A rule the code can break and the
       * gate cannot see is worse than no rule.
       *
       * Descending onto the root arrives somewhere, which is also the better
       * chromatic approach: a run that lands on the tonic reads as an approach,
       * and one that leaves it reads as drift. The top of the run is
       * `min(root + 3, MOTOR_TOP)`, so every note is inside `[root, MOTOR_TOP]`
       * and therefore inside the window BY CONSTRUCTION rather than by luck.
       */
      {
        const runTop = Math.min(root + 3, MOTOR_TOP);
        line = `${runTop} ${runTop - 1} ${runTop - 2} ${root}`;
      }
      break;
    case 'shuffle':
      line = `[~ ${third} ${fifth}] [~ ${third} ${fifth}] [~ ${third} ${fifth}] [~ ${third} ${fifth}]`;
      break;
    default:
      /*
       * Home base: a boom-chick inner voice, not a chord tone on every beat.
       *
       * This was `root third fifth third` — one tone squarely under each of the
       * four beats. `tools/interlock.mjs` measured what that costs: with the
       * kick, the bass and the melody all also accenting the beat, the
       * `fourfloor` feel came out the most grid-locked in the game — 28% of
       * onsets off the quarter-note and 3.88 lanes attacking per instant,
       * against 63% and 2.19 for `swing`. The default feel was the worst one,
       * and it is the one that plays most.
       *
       * The fix is the oldest texture there is: the beat belongs to the bass and
       * the kick, and the inner voice answers between them. Beats one and three
       * keep the clock so nothing is lost; two and four move to the offbeat,
       * where nothing else is playing. Same notes, same density, half the
       * collisions — and it is what a comping keyboard or an NES triangle
       * actually does, rather than a metronome with pitches on it.
       */
      line = `${root} [~ ${third}] ${fifth} [~ ${third}]`;
  }

  /*
   * NOVA collapses the motor to a bare root-and-fifth pedal.
   *
   * The powerups move here rather than to the kit, because this is now the lane
   * a player actually hears keeping time — RAPID doubling a hi-hat was a change
   * to garnish. A pedal under a nova is the arrangement holding its breath.
   */
  if (nova > 0) line = `${root} ${fifth} ${root} ${fifth}`;
  // Half-time halves the motor rather than the kit: dotted-eighth displacement,
  // same tempo, and the clock itself is what feels slowed.
  if (half) line = `${root} ~ ~ ${fifth} ~ ~ ${third} ~`;

  /*
   * On the last bar of a phrase, the final beat becomes a chromatic run into
   * the next chord's root. This is the turnaround, and it belongs to the motor
   * rather than to a drum fill: a pitched lead-in tells the ear where the music
   * is going, and a snare roll only tells it that something is ending.
   */
  if (m.fillBar) {
    /*
     * The turnaround approaches from WHICHEVER SIDE FITS.
     *
     * `target - step * 3` reaches three semitones outside the target, and the
     * target itself is only folded to the window's edge — so on a next-chord
     * root that folds to 57 the run started at 54, and on one that folds to 69
     * it started at 72. `research-music.md` §2.4 named this as the second of
     * the motor's two escapes, against `motorcheck`'s assertion that every note
     * lands in 57-69, and the check was passing because the sampled states did
     * not happen to reach those chords.
     *
     * Narrowing the fold to leave approach room was tried first and was WORSE,
     * measured: `foldInto` into a seven-semitone window has no legal octave for
     * five pitch classes out of twelve, so it returned notes BELOW the window
     * and `motorcheck` went red on 80 of them at MIDI 55-56. A fold cannot
     * promise a window narrower than an octave; see `MIN_LANE_SPAN`.
     *
     * The window is thirteen semitones and the run is three, so at least one
     * direction always fits: if `target - 3` is under the floor then the target
     * is at most 59 and `target + 3` is at most 62, and symmetrically at the
     * top. Preferring the direction the melody suggests and flipping only when
     * it does not fit keeps the gesture and makes the range total.
     */
    const target = foldInto([m.nextChord.root], MOTOR_BOTTOM, MOTOR_TOP)[0];
    const wanted = target > third ? 1 : -1;
    const step = target - wanted * 3 < MOTOR_BOTTOM || target - wanted * 3 > MOTOR_TOP ? -wanted : wanted;
    line = `${root} ${third} ${fifth} [${target - step * 3} ${target - step * 2} ${target - step} ${target}]`;
  }

  return { line, root, third, fifth };
}

export function buildMotor(m: MusicalState): Pattern {
  const rapid = m.powerups.rapid ?? 0;
  const half = (m.powerups.timewarp ?? 0) > 0;
  const { line, third } = motorVoicing(m);
  /*
   * A 25%-duty pulse, low and dark.
   *
   * superdough's pulse worklet maps duty = (1 - pw)/2, so `pw(0.5)` is 25% —
   * the workhorse chiptune timbre, reedy enough to read through a mix without
   * any of the 2.5-6kHz edge that made the old supersaws fatiguing. Low-passed
   * at 4kHz because above that a repeated note contributes nothing but hiss,
   * and this one repeats sixteen times a bar.
   *
   * Quiet on purpose. It runs constantly, so it has to sit under everything;
   * a metronome you notice is a metronome that is too loud.
   */
  /*
   * ARTICULATION, and until now this lane had exactly one.
   *
   * `sustain(0)` means the amplitude is already zero at attack+decay and stays
   * there until the note ends, so a note's WRITTEN LENGTH changes nothing about
   * how long it sounds. Every note in this lane was the same 74ms blip —
   * `attackfloor` measured its tail as a flat 74/74/74 over a twelve-minute
   * sweep, the same number on every one of 25,340 haps.
   *
   * Look at what `motorVoicing` writes against that. The gallop is
   * `[root@3 third]`: a dotted-eighth and a sixteenth, 667ms against 222ms, the
   * William Tell figure its own comment is proud of. `shuffle` is triplets.
   * Half-time is a dotted-eighth displacement. The fill bar ends in four
   * sixteenths. Five distinct articulations were written and all five came out
   * as the same blip — the long-short of a gallop survived only in WHEN the
   * next note started, never in the notes themselves. That is the audible
   * difference between a line that is played and one that is sequenced, and it
   * is this lane's share of "clavichord": not that the attack is fast, but that
   * nothing about a note ever varies.
   *
   * So the beat layer gets a sustain, and the written length becomes audible
   * for the first time. The 70ms decay is untouched, so the percussive front
   * that makes it a motor is exactly as it was; what follows it is now a body
   * that lasts as long as the note asked to. A held 0.3 under a 0.22 gain is
   * 0.066 — this stays the quiet inner voice its comment below insists on.
   *
   * ---------------------------------------------------------------------
   * AND NEITHER LAYER IS `sustain(0)` ANY MORE.
   * ---------------------------------------------------------------------
   *
   * The offbeat used to be, argued as "one voice sings, the other ticks". The
   * argument is right about the character and was implemented with the one
   * control that makes a note's written length UNREADABLE: at sustain 0 the
   * amplitude is already zero at attack+decay, so `clip`, `release` and the
   * mini-notation length all say nothing. `attackfloor` measured this lane at
   * 45% sustain-0 haps with a flat 74/74/74 ms tail on every one of 25,340.
   *
   * Both layers carry a touch now. The beat layer is `ticked` at eighths and
   * the offbeat is `struck` at sixteenths, so the difference between them falls
   * out of the arithmetic - a shorter note gets a faster onset and a shorter
   * tail - instead of out of one of them being switched off. At 135 bpm that is
   * 52-40 ms on / 170-144 ms off for the beat against 26-20 ms on / 105-85 ms
   * off for the offbeat: further apart than the old pair, and both audible as
   * lengths rather than one of them being a fixed blip.
   */
  const voice = (
    pattern: string,
    level: Patternable,
    velocity: number,
    touch: TouchName,
    slots: number,
  ): Pattern =>
    articulate(
      tagVoice(note(pattern), VOICE_TAGS.motor, { pwrate: 0.35, pwsweep: 0.3 })
      /*
       * THE DUTY CYCLE MOVES. `pwrate`/`pwsweep` are pulse-only (AGENTS.md
       * §4) and are handed to `tagVoice` rather than chained, so they apply
       * only when a pulse is what is actually sounding. Today it always is:
       * this lane's `motor` role maps to `gm_overdriven_guitar` and is NOT in
       * `SAMPLED_ROLES`, so that instrument is mapped and switched off. If it
       * is ever switched on these two go with the waveform, which is the whole
       * reason they are passed in rather than chained.
       *
       * `pw(0.5)` is a 25% duty (superdough maps duty as `(1 - pw)/2`) held
       * perfectly still for the whole project's life, on the most-heard sound
       * in the game - 92,928 haps, under every bar. A static narrow pulse
       * repeating eight to sixteen times a bar is, as an object, a harpsichord
       * jack: the same waveform, the same length, the same spectrum, every
       * time. Two of the owner's reports name a "clavichord" and this lane is
       * the only thing in the mix that never stops making that shape.
       *
       * `pwrate`/`pwsweep` are superdough's own pulse-width LFO
       * (`synth.mjs`, `getLfo(ac, {frequency: pwrate, depth: pwsweep})` on the
       * worklet's `pulsewidth` parameter) and they were unused anywhere in this
       * score. A duty sweeping slowly between roughly 20% and 35% is the
       * string-machine sound - the harmonic ladder rearranges itself under a
       * held pitch, which is heard as chorus rather than as vibrato because the
       * FREQUENCY never moves. It costs no voices and no extra nodes.
       *
       * 0.35 Hz is one full sweep per five bars at 135 bpm, so no two bars of
       * the clock have the same timbre and nothing about it is fast enough to
       * be noticed as an effect. The centre moves 0.5 -> 0.34 (a 33% duty)
       * because 25% is the thinnest point of the pulse family and a sweep
       * should not be centred on the extreme of its own range.
       */
      /*
       * A little more top, because this is the only continuous voice left.
       *
       * The comment above justifies a 4 kHz ceiling on the grounds that above
       * it "a repeated note contributes nothing but hiss", and that is right
       * about the ceiling and silent about the floor: at the mid openness the
       * score actually sits at, `range(1400, 4000)` evaluates to 2700 Hz.
       * Measured over the whole mix, everything above 2 kHz — four octave
       * bands — comes to 3.2% of total energy, because `buildHats` was deleted
       * (see its tombstone below) and nothing replaced it as a source of air.
       * Nothing is wrong with deleting it; what is wrong is that the lane that
       * took its job kept its darkness as well as its rhythm.
       *
       * 1800-4800 leaves the ceiling essentially where its own argument put it
       * and lifts the middle of the range by about 900 Hz. On a 25%-duty pulse
       * that is the 8th to 12th partial, at -18 to -22 dB — presence, which is
       * what the inner voice of a chip score is FOR, and a long way from the
       * unbounded high-passed white noise the hi-hat used to be.
       */
      .lpf(m.sig.openness.range(1800, 4800))
      .hpf(220)
      .lpq(1)
      .velocity(velocity)
      .gain(level)
      /*
       * Off centre, opposite the lead's sawtooth body at 0.40.
       *
       * Those two lanes share an octave and always will: the motor's window is
       * MIDI 57-69 by contract and the lead's doubling measures 57-68. They
       * cannot be separated in register without breaking one of them, so they
       * are separated in the field instead — 28% of the width apart, which is
       * the cheapest separation available and costs no notes. The clock being
       * slightly to one side is also simply how a rhythm section is recorded.
       */
      .pan(0.68)
      /*
       * A SMALL ROOM ON THE CLOCK, and the argument is about coherence rather
       * than about ambience.
       *
       * `registermap`'s room column read 0.00 on this lane over 92,928 haps —
       * the busiest pitched group in the score, dry, on the same orbit as a pad
       * sending 0.58 and a stab sending 0.28. The reference corpus uses
       * `.room()` in 55 songs of 60, and what it buys is not "reverb": it is
       * that every source is heard in the same place. A dry eighth-note pulse
       * against a wet chord is two recordings played at once.
       *
       * 0.15 and a SMALL room (size 3), because this lane plays eight to
       * sixteen notes a bar and anything longer than the gap between them
       * cancels the pulse inversion the arrangement is built on. It is the
       * smallest send in the file and it is deliberately the smallest.
       */
      .room(m.sig.space.range(0.15, 0.4))
      .roomsize(ORBIT_ROOM[ORBIT_HARMONY])
      .orbit(ORBIT_HARMONY),
      touch,
      { slots, bpm: m.bpm, shade: m.sig.openness },
    );

  /*
   * Two layers on one lattice, exactly as the hats were — the retention lesson
   * survives the rewrite. The beat layer always sounds; the sixteenths fade in
   * over it, so getting busier ADDS notes between the ones already playing
   * rather than replacing all of them. `tools/retention.mjs` scored the old
   * division-swapping hat 45% nested, the worst lane in the mix.
   */
  const drive = Math.min(1, (m.barInPhrase % 4 === 3 ? 0.3 : 0) + (rapid > 0 ? 0.25 + rapid * 0.08 : 0));
  /*
   * The envelope is no longer written here at all - see `articulation.ts`.
   *
   * What used to be four hand-tuned signals in this function is a touch name
   * and a subdivision. The reasoning the old comment carried is preserved in
   * `TOUCH.ticked`, including the part that was right and is still right: a
   * 250 ms tail on a lane playing sixteenths puts three notes on top of each
   * other and turns the clock into a drone. It is arithmetic there rather than
   * an exemption here, so a lane that slows down gets a longer tail without
   * anybody editing a table.
   */
  /*
   * 0.22 -> 0.42, because the clock could not be heard.
   *
   * The comment on `STEM_CURVES.hats` argues this lane should be quiet
   * "precisely BECAUSE it never stops", and that argument is about the FADER
   * (0.40 against the old hats' 0.52). Nothing had ever measured what the
   * written gain did on top of it.
   *
   * Measured: `tools/capture.mjs`, 32 bars, world seed 0x51ed, this stem
   * soloed, and the mix reconstructed from all nine soloed stems (the
   * reconstruction reproduces the full-mix RMS to 0.2 dB). Soloed at unity
   * this lane reads **-53.3 dBFS**, the second quietest in the score; at its
   * live fader of 0.34 it reads **-63.6 dBFS in-mix, 37 dB under the bass**,
   * and it contributes **0.0% of every one of the ten octave bands**.
   *
   * That is not a quiet clock, it is an absent one — and this is the lane the
   * entire pulse-inversion rests on, the one whose tombstone says "`buildMotor`
   * is what took its place... the same clock, moved into an inner voice". The
   * hi-hat was deleted in favour of a lane 37 dB below the bass.
   *
   * The reason it hid: `setGainCurve(x => x*x)` squares gain, so 0.22 against
   * the pad's 0.42 is 11.2 dB apart and not 5.6, and the fader squares again
   * on top of that. Half of every level difference in this file is larger than
   * it looks.
   *
   * 0.42 is +11.2 dB and puts it at about -52 dBFS in-mix. Still 26 dB under
   * the bass; still, on the octave-band table, worth **0.0%** — this change
   * cannot flatter the mud or air numbers and is not made for them.
   */
  const base = voice(line, 0.42, 1, 'ticked', 8);
  if (half) return base;
  return stack(
    base,
    // The offbeat sixteenths, quieter and thinner: this is what turns a pulse
    // into a motor. Rides `sig.fill`, so pressure drives it rather than a
    // threshold rewriting the part. Stays a pluck — see the note on the two
    // articulations above.
    // Kept at a third of the beat layer, as it was: 0.14/0.42 against the old
    // 0.14/0.22, so the two articulations are further apart than before rather
    // than closer. One voice sings, the other ticks.
    voice(`[~ ${third}]*4`, m.sig.fill.range(drive * 0.14, 0.14), 0.5, 'struck', 16),
  );
}

/*
 * `buildHats` used to live here, and its removal is the point of the refactor.
 *
 * It was the four-lane drum kit's top voice: a hi-hat on a division that
 * swapped from eighths to sixteenths as intensity rose, opening up when RAPID
 * was held. There is nothing wrong with the code — it was measured, tuned, and
 * `tools/retention.mjs` scored it honestly. It is gone because of what it *was*,
 * not how it was written.
 *
 * The diagnosis behind this whole pass: time was kept by percussion, so every
 * pitched lane was free to become texture. Four drum lanes carrying the pulse
 * meant all four had to sound, which meant the floor had to be loud, which
 * forced a sidechain, which left the pitched lanes with nothing to be
 * responsible for. Nothing in the reference canon does this — the Game Boy has
 * four channels and Pokemon R/B has no drum channel at all, so the pulse is
 * *always* carried by something with a pitch.
 *
 * `buildMotor` is what took its place: the same clock, moved into an inner
 * voice between the bass and the tune, where it keeps time AND states harmony.
 * The `hats` stem id survives because renaming it would touch the HUD,
 * MOVEMENT_MIX, STEM_CURVES, INTRO_ENTRY and a dozen tools for no musical gain.
 *
 * The function was left behind marked `@deprecated ... until the stem rename
 * lands`. That rename was subsequently, deliberately rejected, so its exit
 * condition could never occur and it would have sat here forever — 130 lines of
 * working code inviting someone to wire the pulse back into the drum kit.
 *
 * ---------------------------------------------------------------------------
 * AMENDMENT: there is a hi-hat again, and the argument above is not what moved
 * ---------------------------------------------------------------------------
 *
 * The owner asked for Aphex Twin. That reference does the opposite of the
 * canon this tombstone was written against — the drums ARE the lead instrument
 * — so `percGrid` puts a sixteenth hat grid back into the `clap` stem. Read
 * the two decisions together rather than as a reversal, because three of the
 * four claims above survive intact and one does not:
 *
 *   SURVIVES: the pulse stays in `buildMotor`. Nothing here keeps time. The
 *   grid's accent figure is an additive grouping that does not divide sixteen
 *   evenly, which only works as displacement BECAUSE a pitched inner voice is
 *   holding the clock underneath it. This is the thing the tombstone's own
 *   refactor made possible.
 *
 *   SURVIVES: the floor does not have to be loud and there is still no
 *   sidechain. The hats sit behind `clap`'s fader, which enters at tension
 *   0.26 and is not a bed.
 *
 *   SURVIVES: the deleted function's actual defect. `s("white*div")` with
 *   `div` chosen from an intensity threshold replaced every hit on every step
 *   of the dial (`tools/retention.mjs`: 45% nested, the worst lane in the
 *   mix). `percGrid` fixes the lattice at sixteen and rides `sig.density` and
 *   `sig.fill` for the two bed layers, so pressure fades notes in over the
 *   ones already sounding. That defect is not being re-imported.
 *
 *   DOES NOT SURVIVE: "the kit is garnish, which is precisely why removing it
 *   costs nothing." True of the SNES and the Game Boy, false of the reference
 *   the score is now aiming at, and it is the only sentence above that the new
 *   brief actually contradicts.
 */

export function buildBass(m: MusicalState): Pattern {
  const root = m.chord.root - 12;
  const fifth = root + degreeToSemitone(m.mode, 4);
  const octave = root + 12;
  /*
   * Approach note.
   *
   * The last beat of every second bar leans onto a chromatic neighbour of the
   * *next* chord's root. This is the single cheapest thing that makes a bass
   * part sound played rather than generated: the line stops being a series of
   * unrelated roots and starts going somewhere.
   */
  const target = m.nextChord.root - 12;
  const approach = target + (target > root ? -1 : 1);
  const leading = m.barInPhrase % 2 === 1 && target !== root;
  // Offbeat at low intensity (house), driving sixteenths when it gets hot.
  const mag = m.powerups.magnet ?? 0;
  const half = (m.powerups.timewarp ?? 0) > 0;
  /*
   * Layered on the beat grid, so getting busier ADDS notes.
   *
   * Three lines were selected from thresholds on intensity and they did not
   * nest — the sparse line put its notes on the offbeats and the busier ones
   * put theirs on the beats, so a step swapped the bar rather than filling it
   * in. `tools/retention.mjs` measured 33% nested. Freezing the part to the
   * section fixed that and threw away the response, which is the wrong trade:
   * the point of this game is that the music answers the play.
   *
   * So the offbeat pair is the anchor, the on-beat pair fills in around it, and
   * a pair of eighths drives underneath when it is really busy. Note that
   * `low === root` unless MAGNET is held, which is what lets the anchor and the
   * fill agree on the beat they share.
   */
  // Magnet drops the bar's first note an octave, so the floor sags as it sucks.
  /*
   * Magnet drops the bar's first note an octave, so the floor sags as it sucks.
   * At level 2 it takes the fifth down with it, at level 3 the whole bar sits
   * low — the binary version meant a second MAGNET changed nothing.
   */
  const low = mag > 0 ? root - 12 : root;
  const fifthLow = mag >= 2 ? fifth - 12 : fifth;
  const third = root + degreeToSemitone(m.mode, 2);
  const tenth = root + 12 + degreeToSemitone(m.mode, 2);
  // The chromatic neighbour below the next chord — a leading tone for the bass.
  const lead = leading ? approach : root;
  /*
   * The last beat, and it is what makes every figure below a LINE rather than
   * a loop: on the odd bars it is the chromatic approach to the next chord's
   * root, and otherwise the fifth. Either way the bar goes somewhere.
   */
  const walk = leading ? approach : fifthLow;

  /* ==========================================================================
   * THE BASS IS A LINE, AND IT IS PLAYED TWICE.
   * ==========================================================================
   *
   * TWO ROUNDS OF FEEDBACK BUILT THIS AND THE SECOND CORRECTED THE FIRST, so
   * both are recorded.
   *
   * ROUND ONE was "i mean it should be like dub step lol", and the answer was
   * to make the wobble the bass on every feel. The genre's bass part is
   * composed in FILTER MOVEMENT: superdough runs a real LFO on the ladder
   * cutoff (`lpsync`/`lpdepth`/`lpshape`/`lpskew`) inside an AudioWorklet,
   * phase-locked to the cycle, so a held note is swept continuously rather
   * than re-struck. Write the same rhythm as note onsets and you get a synth
   * bass playing eighths with an amplitude envelope retriggering under every
   * one of them, which is a different and much older kind of music. That is
   * right and it stands. See `wobble.ts`.
   *
   * ROUND TWO was the owner hearing it: **"nice progress toward music, i like
   * the dub step direction, its missing a base,/ kick, lets add more base,
   * also the second lead synth could be improved, maybe a base guitar instead?
   * need a baseline, not just leads"**.
   *
   * "NEED A BASELINE, NOT JUST LEADS" IS THE PART THAT CHANGED THE CODE, and
   * it is the same complaint as "beats in the background, then a foreground
   * melody" arriving from underneath. The first pass took each feel's figure
   * down to its skeleton — one or two held notes a bar, a pedal on `chase` —
   * on the reasoning that the LFO would supply the rhythm. It does supply the
   * rhythm. It does not supply a PART. A bassline has notes that move, lands
   * on the chord changes, and is the thing you would hum if you hummed the
   * bottom of the track; a wobbled pedal tone is a texture, and the owner
   * named the difference exactly.
   *
   * So the figures come back as figures — three or four notes a bar, chord
   * tones, every one of them walking onto the next chord — and the LFO plays
   * ACROSS them instead of instead of them. A quarter note at 140 BPM is
   * 428 ms and the phrase's slowest LFO rate is four cycles a bar, so every
   * note still gets at least one complete sweep. That is the constraint the
   * figures are written to: this is why they are quarters and not eighths, and
   * why the sixteenth-note pop at the end of the bar sets its own rate of 16
   * (a partial sweep on a short note reads as a wrong note, not as a wobble).
   *
   * AND THE LINE IS DOUBLED BY A PLUCKED ELECTRIC BASS, which is the other
   * half of the owner's note — "the second lead synth could be improved, maybe
   * a base guitar instead?". `gm_electric_bass_finger` was already wired and
   * already the only entry in `SAMPLED_ROLES`; it used to be the bass on four
   * feels and then, for one pass, on `gallop` alone. It now plays the SAME
   * NOTES as the growl, on every feel, as the layer that supplies the attack.
   *
   * That is not a compromise between two designs, it is how a dubstep bass is
   * actually built: a transient layer that states the note, a growl that gives
   * it character, and a sine underneath that gives it weight. Three layers,
   * one line. A sawtooth through a ladder cannot fake a plucked string's
   * attack (26da78d's reason for keeping this font, unchanged), and a plucked
   * string cannot growl.
   *
   *   pluck    `gm_electric_bass_finger`, touch `played`, the notes
   *   wub      sawtooth -> resonant ladder + LFO, the growl
   *   reese    two detuned saws an octave up, quiet, the beating
   *   pop      one sixteenth before the downbeat, the thumb
   *   (and `buildSub` two octaves down, which is a separate lane and a sine)
   *
   * THE REESE IS THE "SECOND LEAD SYNTH" AND IT IS CUT BACK RATHER THAN
   * REMOVED. It is a detuned supersaw an octave above the bass, at 220-500 Hz,
   * and the first pass raised it from a peak of 0.30 to 0.66 — at which point
   * it is a synth line sitting over the bass, which is the thing the owner
   * asked to replace with a bass guitar. It is the interference between its
   * LFO rate and the main one that makes a wobble sound alive rather than like
   * a siren, so it stays; at 0.10-0.34 it is a colour on the growl instead of
   * a part of its own.
   *
   * `gallop` IS NO LONGER AN EXCEPTION. It kept the plucked bass alone for one
   * pass, as the last consumer of the soundfont path. Now every feel has the
   * pluck, so the font reaches 100% of the game instead of 8% of the waves,
   * and `fontlanes` measures the fallback on a lane that is always sounding.
   *
   * WHAT IS STILL DELETED: the `chase` 808 (see the tombstone below), and the
   * boom-chick's two extra layered fill lines. Getting busier now adds
   * `lpdepth`, `drive` and the pop rather than two more plucked lines — a dial
   * that changes how a part SOUNDS rather than which notes it contains, which
   * is the property `tools/retention.mjs` exists to ask for.
   */
  const figure =
    m.feel === 'chase'
      ? /*
         * PEDAL, but a pedal with a pulse. Pokémon's Champion theme: the tonic
         * restated while everything above it moves, and it reads as menace
         * precisely because it does not go anywhere until the last beat.
         */
        `${low}@2 ${low} ${walk}`
      : m.feel === 'boomchick'
        ? /*
           * OCTAVE PEDAL with a walk out — the Castlevania eighth-note engine
           * at quarters. Four notes, all of them moving, and it leans onto the
           * next chord on the last beat rather than restating the root.
           */
          `${low} ${octave} ${fifthLow} ${lead}`
        : m.feel === 'shuffle'
          ? /*
             * The one figure that spells the chord in the low register — root,
             * THIRD, walk. Frog's Theme, and the third is what makes a bass
             * part sound like a band rather than like a bass patch.
             */
            `${low}@2 ${third} ${walk}`
          : m.feel === 'gallop'
            ? /*
               * ARP UP — 1-5-8-10, the Wily Stage 1 triangle. The single most
               * useful bass figure in the chiptune canon: it never rests, it
               * spells the whole chord including its third, and it climbs, so a
               * repeated chord still has somewhere to go.
               */
              `${low} ${fifthLow} ${octave} ${leading ? approach : tenth}`
            : /*
               * HALF-TIME, home base, and the figure the whole score is built
               * on now. Root through the first half of the bar, the octave on
               * three where the snare is, and the walk on four. Two thirds of
               * the game plays this.
               *
               * MAGNET still drops the bar's first note an octave (`low`), so
               * the floor sags as it sucks.
               */
              `${low}@2 ${octave} ${walk}`;

  const w = wubFor(m.barInPhrase, m.section === 'drop');
  // TIMEWARP halves the wobble rather than the tempo, for the same reason it
  // halves everything else: the battlefield is scheduled in beats, so the
  // clock may not move. A wobble at half rate over an unchanged kick is
  // exactly what "half-time" means to a listener.
  const shapeBase = half ? { ...w, rate: Math.max(1, w.rate / 2) } : w;
  /*
   * THE RATE IS WRITTEN INTO THE BAR ON THE ANSWERING BARS. `WUB_PHRASE` gives
   * one rate per bar across eight bars, which is already more than any
   * published Strudel pattern does. The genre goes further and automates the
   * LFO rate between divisions inside the phrase — `docs/research-dubstep.md`
   * R5 — so on the answering bars (the fourth of each four, the ones `wubFor`
   * already doubles and rests closed) the wobble states, accelerates and
   * snaps across the figure's slots: base, twice, four times.
   *
   * THE DIVISION COMES FROM THE FIGURE, HERE, NOT FROM A SECOND TABLE. The
   * figures above are either `x@2 y z` (2:1:1 — chase, shuffle, halftime) or
   * `w x y z` (1:1:1:1 — boomchick, gallop), and a rate string whose
   * divisions do not match the figure's silently loses every value after the
   * first in each note (the research measured it; see `wub()`). So the
   * string is emitted from the same branch structure as the figure, and the
   * probe that checks it counts onsets, not source.
   */
  const division: readonly number[] = m.feel === 'boomchick' || m.feel === 'gallop' ? [1, 1, 1, 1] : [2, 1, 1];
  /*
   * HALF, ONE, TWO — OF THE ROW'S OWN RATE, CAPPED AT 16. The first version
   * escalated 1x/2x/4x on top of the rate `wubFor` had ALREADY doubled for
   * the drop, and the probe read 16 -> 32 -> 64 on bar 3: sixty-four cycles
   * a bar is 37 Hz at 140 BPM, which is a pitch, not a wobble. The research's
   * own examples are `'4@2 8 16'` for the rate-8 row and `'6@2 12 16'` for
   * the rate-12 row — state at half, accelerate to the row's rate, snap to
   * twice it, and never past 16, the top of the vocabulary. So the pattern is
   * built from the ROW's rate (undoing wubFor's doubling where it applied,
   * which `rest: -1` marks) and clamped to the 2..16 the table speaks.
   */
  const rateString = (row: number, div: readonly number[]): string => {
    const mult = div.length === 4 ? [0.5, 0.5, 1, 2] : [0.5, 1, 2];
    const at = (i: number): number => Math.max(2, Math.min(16, row * mult[i]));
    return div.map((d, i) => `${at(i)}${d > 1 ? `@${d}` : ''}`).join(' ');
  };
  const rowRate = shapeBase.rest === -1 ? shapeBase.rate / 2 : shapeBase.rate;
  const shape =
    m.barInPhrase % 4 === 3 ? { ...shapeBase, ratePattern: rateString(rowRate, division) } : shapeBase;
  const opts = {
    shape,
    /*
     * The crunch: post-filter distortion as a SIGNAL riding `drive`, so the
     * bass is a clean filtered saw in a breakdown and saturated at the drop
     * on the same notes. 0.4..3.4 is about 18 dB of harmonic travel; the
     * fixed `'3.0:0.30'` this replaces sat at the top of that range always.
     * `docs/research-dubstep.md` R2.
     */
    crunch: m.sig.drive.range(0.4, 3.4),
    /*
     * Reese width, in semitones of total spread across the two voices. The
     * fixed 0.14 was +-7 cents — the bottom of "subtle" in every source, half
     * the canonical amount. 0.20..0.44 is +-10 to +-22 cents, so the drop
     * WIDENS the growl rather than only driving it. `docs/research-dubstep.md`
     * R11.
     */
    width: m.sig.drive.range(0.2, 0.44),
    /*
     * The centre of the sweep, and the ceiling is deliberately low.
     *
     * With `lpdepth` at 1.9 the LFO swings to nearly twice the centre, so a
     * centre of 1050 peaks near 2kHz — under the 2.5-6kHz band `npm run
     * audiocheck` fails on. A resonant peak at Q7 parked in that band is the
     * single most fatiguing thing this mix could contain, and the wobble would
     * otherwise be reaching into it four to twelve times a bar.
     *
     * UNCHANGED BY THE PROMOTION, on purpose. Making this lane the loudest
     * thing in the mix is a LEVEL decision; moving the cutoff up as well would
     * have spent the same change twice and put the resonant peak exactly where
     * the one recorded human complaint about this score's high end lives.
     */
    /*
     * ...PLUS A SLOW DRIFT, which is the reference track's own idiom:
     * `cutoff(sine.range(400, 2000).slow(16))`.
     *
     * `sig.openness` is a game signal — it answers the play, which is the
     * point of this project — but it is the ONLY thing that moved this centre,
     * so a stretch of steady play was a stretch of identical wobbles. A slow
     * sine added on top means the sweep is never twice in the same place: the
     * LFO's swing is unchanged and where it swings drifts under it.
     *
     * +/-110 Hz over thirteen bars. Small against a 300-1050 range because the
     * game's own answer has to stay legible through it, and thirteen because it
     * is coprime with the eight-bar wobble phrase, the seven-bar resonance
     * drift and the eleven-bar reese drift — four modulators, no common period
     * shorter than a run.
     *
     * The CEILING argument below is unaffected: 1050 + 110 = 1160, and at
     * `lpdepth` 1.95 that peaks around 2.2 kHz, still under the 2.5-6 kHz band
     * `audiocheck` fails on.
     */
    /*
     * THE BUILD SUBTRACTS. During `build` the cutoff is clamped to the 200-400
     * Hz the sources name for the run-up and only reopens across the last half
     * of the build, so the drop's first bar is the first time the bass is fully
     * open — `docs/research-dubstep.md` R10. `buildProgress` is a plain number
     * per bar, so the build branch is a number too, not a signal.
     */
    cutoff:
      m.section === 'build'
        ? lerp(400, 1050, Math.max(0, m.buildProgress * 2 - 1))
        : m.sig.openness.range(300, 1050).add(sine.range(-110, 110).slow(13)),
    /*
     * How far it swings is the intensity dial. At 1.15 it is a gentle
     * breathing; at 1.9 the filter slams shut between wobbles, which is the
     * sound of the drop.
     *
     * AND IT IS THE ESCALATION THE TEMPO USED TO BE. `updateTempo` gave up
     * sixteen BPM of wave ramp and six of tension when the score was anchored
     * at `DUBSTEP_BPM`; this is where that energy went. A dubstep track that
     * answered pressure by speeding up would stop being one.
     */
    depth: m.sig.drive.range(1.3, 1.95),
    /* ======================================================================
     * CRUNCH, AND THE FIRST ANSWER WAS MEASURABLY WRONG.
     * ====================================================================
     *
     * "i want my dubstep to be, chrunchy, munchy, juicy, delicious wubs and
     * dubs." Crunch is saturation, not level. WHERE the saturation sits
     * relative to the filter decides what it sounds like, and superdough's
     * answer is not the one reasoning from first principles gives you.
     *
     * READ OFF THE SOURCE. `superdough.mjs` builds the voice chain as
     * oscillator -> gain -> LOWPASS -> vowel -> `coarse` -> `crush` -> `shape`
     * -> `distort`. Every one of superdough's distortion controls is
     * POST-FILTER. `.drive()` is the exception: it is the LADDER'S OWN
     * parameter, read only inside the `ladder-processor` worklet
     * (`worklets.mjs:370`), applied inside the filter's feedback loop as
     * `p0 += (fast_tanh(input * drive - k * out) - ...)` with a `fast_tanh` at
     * all four poles, and exponential — `clamp(Math.exp(drive), 0.1, 2000)`,
     * so 1.5 is 4.5x and 3.7 is 40x. It is also level-compensated:
     * `makeupgain = (1 / drive) * min(1.75, 1 + k)`.
     *
     * FROM THAT I CONCLUDED THAT `drive` WAS WHERE THE CRUNCH HAD TO GO —
     * saturation inside the filter, so the LFO sweeps across the harmonics it
     * makes — AND PUT IT AT 1.9-3.7. Rendered through the real chain
     * (`tools/capture.mjs --bars=4 --stem=bass`, four bars, real superdough
     * worklets in an OfflineAudioContext) that is what it did:
     *
     *                       125Hz   250    500     1k     2k     4k     8k    rms
     *   drive 0.7-1.5      -34.5  -35.2  -40.3  -45.8  -57.4  -72.5  -88.1  -31.1
     *   drive 1.9-3.7      -35.2  -36.8  -44.7  -51.8  -61.8  -78.9  -95.5  -32.5
     *
     * **Every band got DARKER and the lane got 1.4 dB quieter.** The model was
     * wrong in a way that is obvious once measured: the four poles are AFTER
     * each tanh, so the harmonics a hard drive creates are removed by the
     * filter that created them, and what is left is a rounder wave at the
     * cutoff with the makeup gain pulling the level down. Driving a ladder hard
     * COMPRESSES; it does not brighten.
     *
     * So the crunch is the POST-FILTER `distort`, which is exactly the control
     * the paragraph above talked me out of, and for exactly the reason it gave:
     * nothing filters what it makes. Same render, level-matched:
     *
     *                       125Hz   250    500     1k     2k     4k     8k    rms
     *   before             -34.5  -35.2  -40.3  -45.8  -57.4  -72.5  -88.1  -31.1
     *   after              -31.8  -33.2  -40.0  -44.6  -51.3  -59.2  -68.7  -28.9
     *   delta               +2.7   +2.0   +0.3   +1.2   +6.1  +13.3  +19.4   +2.2
     *
     * The fundamental moves with the level and the upper harmonics move six to
     * nineteen decibels more than it does, which is the signature of harmonic
     * generation rather than of a fader. That is measured crunch. `wobble.ts`
     * carries the `distort` numbers and the reason `scurve` is kept.
     *
     * `drive` STAYS, at 1.0-2.2 rather than 0.7-1.5 or 1.9-3.7: some saturation
     * inside the filter is the difference between a sweep and a growl, and the
     * measurement says a lot of it is a loss. It rides `sig.drive` so a calm
     * passage growls and a drop tears, and it never goes near zero at either
     * end — the other half of AGENTS.md §4's distortion trap.
     *
     * The bands above are a SOLOED lane rendered offline. Nothing has been
     * heard.
     */
    drive: m.sig.drive.range(1.0, 2.2),
    /*
     * 0.9. `registermap`'s summed model measured this voice at **2.6% of the
     * mix** and its growl at **0.0%** while the melody's triangle took 9.1% —
     * the lane the brief calls the protagonist was the quietest pitched thing
     * in the file. The lane fader moved too (`STEM_CURVES.bass`, 0.6 -> 0.95)
     * and that is the larger half, because `postgain` is squared; both are
     * stated so the change is not mistaken for one dial.
     */
    /*
     * 0.62, not 0.9, and the reason is the second oscillator rather than a
     * change of mind. `wobble.ts` now sounds `s('sawtooth,sine')` - the same
     * note twice in one voice - and the sine sits exactly on the fundamental,
     * so it adds coherently: measured through the real chain, four bars soloed,
     * adding it took this lane from -28.9 to -22.1 dBFS rms and its peak to
     * -12.1. That is 6.8 dB of level for a timbre change, which is a different
     * mix rather than a fatter bass.
     *
     * 0.62 puts the soloed lane back at about -28.6. The promotion this lane
     * was given is in `STEM_CURVES.bass` (ceiling 0.6 -> 0.95), which is where
     * it belongs: the fader is the arrangement's decision about how loud the
     * bass is, and this number is the voice's own staging.
     */
    level: 0.62,
  };
  /*
   * THE 808 IS DELETED, and this is the fourth and last disposition of it.
   *
   * What stood here was `glide`: `p.s('sine').penv(-7).pattack(0.11).pcurve(1)`
   * applied on the `chase` feel only, wrapping the finished chain so that it
   * would be the LAST writer — which is itself a fix this file records at
   * length, because for the project's whole life it had been the innermost
   * call and `.s('sine')` was silently overwritten by `.s('sawtooth')` two
   * lines below (AGENTS.md §4, "later writes win, silently"). The evidence
   * that it had never once sounded came off `attackfloor`'s BY VOICE table:
   * `bass·sawtooth` and `bass·supersaw` over a 720 s sweep, and no
   * `bass·sine` row at all.
   *
   * It goes because `chase` is a wobble now. Every reason it was kept — a
   * pitch slide is a statement about PITCH and not about amplitude, and an 808
   * is a sine — is still true, and none of them survives the lane it lived on
   * becoming a held sawtooth through a resonant ladder. A pitch envelope on a
   * note whose entire content is a filter sweep fights the LFO for the part
   * and wins, and then there is no wobble.
   *
   * The sine is not lost. `buildSub` is one, two octaves down, and the sub
   * staying separate from the growl is a rule of the genre rather than an
   * accident of this refactor. What this lane actually had was two low sines
   * a note apart.
   */
  const shaped = (p: Pattern): Pattern =>
    mag > 0
      ? // Filter opens *into* the note rather than out of it — a suck, not a pluck.
        p.lpq(6 + mag * 1.5).lpattack(0.14).lpenv(3.2).lpdecay(0.3)
      : p.lpq(5).lpenv(2).lpdecay(0.09);
  const voice = (line: string): Pattern =>
    (
      /*
       * A FINGERED ELECTRIC BASS, not a sawtooth — see `soundfonts.ts`. THE ONE
       * LANE IN THE SCORE THAT IS A RECORDING, and the only role in
       * `SAMPLED_ROLES`.
       *
       * The part was already written as a bass guitar part: the default figure
       * is an octave pedal in eighth notes that walks onto the next chord,
       * which is a bass GUITAR idiom, and it was being played on a sawtooth
       * through a Moog ladder. `gm_electric_bass_finger` is the corpus's
       * most-used font, 12 songs of 60.
       *
       * The ladder, the drive and the distortion below all STAY. They are the
       * amp, and a bass guitar goes through one; the measurement that removed
       * this lane's highpass (33-52 dB across its own range) is about the
       * filter chain and is untouched by the source changing. The `chase`
       * `chase` feel's 808 is GONE rather than moved: that feel plays the
       * wobble now, and the paragraph above this function records why a pitch
       * envelope cannot share a lane with an LFO that is playing the rhythm.
       */
      applyVoice(shaped(note(line)), 'bass')
    /*
     * THE ENDS OF THE NOTE ARE NOT WRITTEN HERE ANY MORE - see
     * `articulation.ts`, touch `played`.
     *
     * What stood here was a long and correct account of why a 1 ms attack on
     * the loudest pitched lane in the game is a broadband click and a 10 ms
     * ramp off it is an audible chop, and a fix of `attack(0.014..0.006)` /
     * `ds('0.3:0.42')` / `release(0.26..0.14)`. That fix was real and it did
     * not go far enough in either direction, which is the whole finding of this
     * pass: 6-14 ms is still four to eight times faster than the corpus median
     * of 50 ms, and 140-260 ms of release on top of a note that already held
     * its FULL slot at sustain 0.42 meant every note ran into the next one.
     * Eight notes a bar with no silence anywhere in the bar is not a bass part,
     * and "the base sounds are like too drawn out" is what that is called from
     * the outside.
     *
     * The missing control was never attack or release. It was `clip`: this lane
     * never stated how long a note IS, so length was whatever `sustain` and the
     * mini-notation slot happened to leave. `played` holds 62-74% of the slot
     * and releases in 155-205 ms, which is a finger damping a string.
     *
     * The old comment's other point survives and is now structural rather than
     * hand-typed: four of seven pitched lanes measured an IDENTICAL envelope on
     * every hap of a twelve-minute sweep, and a flat `.attack(0.05)` everywhere
     * would have been that same defect in a new costume. Every number in a
     * touch is a fraction of the note's own length and rides a signal, so no
     * two lanes and no two intensities get the same envelope.
     */
    /*
     * NO HIGHPASS HERE, AND IT IS NOT AN OVERSIGHT. There used to be a
     * `.hpf(95)` on this line, commented "out of the sub's way — without this
     * the two low sources sum into a boom that swamps the kick". It did the
     * exact opposite of that, and then the measurement said the boom was never
     * there in the first place.
     *
     * WHAT IT ACTUALLY DID. superdough has ONE filter-model control. `hpMap`
     * maps `model: 'ftype'` (`superdough.mjs:706`), the same key `lpMap` uses
     * at :671, so `.ftype('ladder')` below chose the model for BOTH filters —
     * and `createFilter` (`helpers.mjs:237`) routes `model === 'ladder'` to the
     * `ladder-processor` worklet and returns before ever reaching
     * `filter.type = type`. The worklet declares three parameters, `frequency`,
     * `q`, `drive` (`worklets.mjs:366`); there is no type, and it is a Moog
     * ladder LOWPASS. So `.hpf(95).ftype('ladder')` was a second 24 dB/oct
     * lowpass at 95 Hz sitting under a bass whose notes are 110-220 Hz. Every
     * note of this lane was in the stopband of its own filter.
     *
     * MEASURED, rendering the real superdough chain (dist worklets, real haps
     * off `buildBass`, OfflineAudioContext, Welch spectrum over the bar).
     * Removing the highpass against leaving it:
     *
     *              rms   20-95Hz  95-250  250-1k   1k-6k
     *   with       -28.1    31.7    49.3    15.8   -24.2
     *   without    -11.6    38.2    64.5    59.1    50.0
     *
     * 17 dB of overall level and 43 dB of the 250 Hz-1 kHz band — the second
     * and third harmonics the `distort` comment below exists to produce. The
     * lane was audible only as its own sub content, which is precisely the
     * thing the deleted comment was trying to remove.
     *
     * WHY NOT KEEP THE HIGHPASS AND DROP `.ftype('ladder')` INSTEAD. That is
     * the other side of the fork and it was measured, not argued.
     *
     *   1. It buys almost nothing. With the ladder gone and a real 12 dB/oct
     *      biquad highpass at 95 Hz, this lane's 20-95 Hz band reads 36.6 dB
     *      against 38.2 without any highpass — 1.6 dB. `buildSub` alone reads
     *      52.5 dB in that band, so the two summed come to 52.65 dB with the
     *      highpass and 52.60 without. The highpass moves the low end of the
     *      mix by 0.05 dB. It could not have been swamping anything: a
     *      sawtooth at 110 Hz has no partial below 110 Hz, and `distort` is a
     *      per-voice waveshaper, so it makes harmonics and never a difference
     *      tone between two notes.
     *   2. It silently kills `.drive()`. superdough hands `drive` to
     *      `createFilter` and `createFilter` reads it only inside the ladder
     *      branch. Pinned to each end of its 0.6-1.35 range, the biquad render
     *      moved 0.0 dB in every band — against a repeat-render noise floor of
     *      0.0 dB, so that is a dead control, not a small one. The ladder moved
     *      0.6 dB in 1-6 kHz over the same range.
     *   3. It is brighter, not just different: the biquad pair reads 53.1 dB
     *      in 1-6 kHz against the ladder's 50.0.
     *
     * `.ftype('24db')` was the third candidate and measured the best low-end
     * separation of all (fund-minus-sub 7.8 dB under MAGNET, against 5.7 for
     * the biquad pair and 28.8/28.7 with no MAGNET). Rejected anyway: it is two
     * cascaded biquads, so `.lpq(6)` becomes two stacked Q6 peaks (+4.1 dB in
     * 1-6 kHz here, +6.6 dB on the wobble), it kills `.drive()` for the same
     * reason as (2), and it swaps a tone every comment in this lane was written
     * about for one nobody has heard.
     *
     * THE ONE CASE WHERE THE HIGHPASS WAS WORTH SOMETHING, recorded because it
     * is a real regression and not a rounding error. Under MAGNET the bar's
     * first note drops an octave to MIDI 33 = 55 Hz, on top of the sub. There
     * the biquad highpass was worth 5.1 dB of 20-95 Hz band, and without it
     * this lane reads 58.9 dB there against `buildSub`'s 52.5 — the bass
     * becomes the louder of the two low sources. That is accepted rather than
     * filtered, because the octave drop exists to make the floor SAG as MAGNET
     * sucks (see `low` above); a 95 Hz highpass removing the sag is the
     * powerup's own effect being cancelled by a guard against it.
     */
    /*
     * The floor was 240Hz. Against the old hpf(95) that was barely an octave of
     * window, so at low openness — which is most of a fight — the layer had
     * almost no band to speak in and measured -22.5dB under the kick. A bass
     * needs its second and third harmonics to read at all on a laptop speaker.
     * 500 keeps it dark when the mix closes down without muting it. The
     * highpass is gone now and the floor stays where it is: 500 was chosen for
     * the tone at low openness, not as clearance above a highpass.
     */
    .lpf(m.sig.openness.range(500, 2300))
    .ftype('ladder')
    /*
     * Never let `distort` approach zero.
     *
     * superdough's distortion is a waveshaper whose curve is built from the
     * control value: at 0 the curve collapses to all-zeros and the signal is
     * *silenced*, and at 0.19 it is still -14.5dB. This layer used
     * `range(0, 0.95)`, and `drive` tracks energy — which sits near zero during
     * ordinary play. Soloing the stems revealed the bass sitting at -44dB, 0.2%
     * of the mix: it has been inaudible for essentially the whole project, and
     * no amount of adjusting its `gain` was ever going to help.
     *
     * 1.0 is roughly unity; above that it saturates.
     */
      // Saturation adds harmonics all the way up. The bass needs its second
      // and third to read on a laptop speaker, not its tenth.
      .drive(m.sig.drive.range(0.6, 1.35))
      /*
       * THE FLOOR IS GONE, AND THE HAZARD IT GUARDED WAS VERSION-STALE.
       *
       * This read `range(1.05, 1.8)` because AGENTS.md said `distort(0)`
       * silences the voice. `docs/research-dubstep.md` §0.1 rendered it through
       * real superdough 1.3.0: `distort(0)` and no distort at all are
       * BIT-IDENTICAL (-22.69 dBFS both; the worklet computes
       * `algorithm(x, expm1(distort))` and `expm1(0) === 0` is the identity).
       * The old entry described a curve-table build that no longer exists.
       *
       * What the floor cost: the bass was saturated at its calmest bar exactly
       * as much as at its loudest, so there was no clean state to drop FROM —
       * the drop could only be "more", never "different". `range(0, 2.6)` is
       * about 18 dB of harmonic travel on the same notes (h2 -14.5 / h3 -15.0
       * relative to a -3.2 fundamental at the top; a clean filtered saw at the
       * bottom), against roughly 4 dB before.
       */
      .distort(m.sig.drive.range(0, 2.6))
      /*
       * 0.86 IS NOW LOAD-BEARING IN A WAY IT WAS NOT BEFORE, and this is an
       * open question rather than a settled number.
       *
       * Until the highpass above was removed, the lowpass-at-95Hz bug was
       * acting as a 17 dB pad nobody knew was there. Soloed and rendered
       * through the real chain — one bar, no stem fader and no master volume,
       * so these are relative figures and not what a player hears:
       *
       *   buildMotor -41.7   buildArp -36.9   buildLead -27.4
       *   buildSub   -24.9   buildChords -23.4  buildKick -21.8
       *   buildBass  -11.6 dBFS, peak 1.28   (it was -28.1, peak 0.20)
       *
       * So the lane now measures ~10 dB above the sub and ~13 dB above the
       * kick, and clips on its own before any fader touches it. That is not
       * obviously wrong: `attackfloor` has always modelled this lane at
       * -11 dBFS as the loudest pitched lane in the game, because its dBFS
       * column is a control multiplier that is blind to filters — it was
       * reporting the level the gain staging intended all along, and the
       * filter bug was quietly cancelling it. The gain was never the defect.
       *
       * It is left alone deliberately. Re-staging it wants the whole mix, the
       * stem faders and the master volume in the measurement, not one soloed
       * lane, and nobody has HEARD any of this yet.
       */
      .gain(0.86)
      /*
       * A ROOM ON THE BASS, and it is small on purpose.
       *
       * `registermap` read `room 0.00` on all three of this lane's voice groups
       * — 57,024 haps, the loudest pitched source in the mix, bone dry, on an
       * orbit with nothing else sending either. The reference corpus reverses
       * that: `.room()` in 55 of 60 songs, and the low parts are in the room
       * with everything else.
       *
       * 0.12 with `roomsize(2)`. A large room on a bass is the classic way to
       * lose a low end — the tail arrives under the next note and the pitch
       * stops being legible — so this is a short one, at a send small enough
       * that it reads as "the same space as the pad" rather than as reverb.
       * The tone still comes from the ladder filter and the saturation above;
       * this only puts the lane in the same building as the rest of the band.
       */
      .room(m.sig.space.range(0.12, 0.3))
      .roomsize(ORBIT_ROOM[ORBIT_LOW])
      .orbit(ORBIT_LOW)
    );

  /*
   * `articulate` is applied HERE, outside `voice`, and that is deliberate: it
   * has to be the last writer for all five of the controls it owns
   * (AGENTS.md 4, "later writes win, silently" - the defect that cost this very
   * lane its 808 for the project's whole life, and the reason the 808 was
   * applied outside this chain right up until it was deleted).
   *
   * `slots: 4`, not 8. Every figure this lane plays is now four quarter-note
   * slots (see `figure` above) and the eighth-note fill layers that set the
   * old value of 8 are gone. A touch is scaled by the FASTEST note a lane can
   * play, so leaving it at 8 would have gone on articulating a sixteenth-note
   * lane that no longer exists - every note half as long as the part is.
   */
  const played = (p: Pattern): Pattern =>
    articulate(p, 'played', {
      slots: 4,
      bpm: m.bpm,
      shade: m.sig.drive,
      /*
       * NO BREAKDOWN `ring`, AND IT WAS AN INERT CONTROL AS WELL AS A DEFECT.
       *
       * This was `1 + (section === 'breakdown' ? 0.3 : 0)`, and `attackfloor`
       * caught it the moment `slots` went 8 -> 4: at four slots and 140 BPM a
       * slot is 428 ms, so `played`'s tail hits its own 250 ms ceiling, and
       * 250 x 1.3 = 325 ms — five milliseconds past the 320 ms the recalibrated
       * tail window allows. 1% of this lane's haps, and the gate is zero
       * tolerance, correctly.
       *
       * The reason it can simply GO rather than needing a smaller number is
       * better: `director.updateLevels` sets this lane's fader to exactly zero
       * during a breakdown (`section === 'breakdown' && id === 'bass'`). So the
       * multiplier was lengthening notes on a lane that is silent whenever the
       * condition is true. It has never been audible and it never could be.
       *
       * A control that cannot change its own output is the shape of defect this
       * project keeps finding, and this is the first time one has been found by
       * a threshold rather than by reading.
       */
      hold: m.sig.hold,
    });
  return stack(
    /* ======================================================================
     * THE ANCHOR. One note a bar, and it is a TRANSIENT, not a part.
     * ====================================================================
     *
     * This played the whole figure for exactly one pass, and the owner heard it
     * immediately: **"what is the curently melody instrument? is that trying to
     * be a guitar? lol it sounds so bad"**.
     *
     * `gm_electric_bass_finger` is the only recording in the entire score. It
     * is a fingered electric bass, and a fingered electric bass is a very good
     * rhythm-section instrument and a very bad lead: a fixed pluck transient,
     * almost no sustain, and no way to change its tone with a filter because
     * the harmonics are baked into the sample. Give it a moving line in the
     * foreground and it reads as a badly played guitar, which is precisely the
     * sentence above.
     *
     * So it goes back to the one job a sample does better than synthesis here,
     * which is 26da78d's own reason for keeping it: THE ATTACK. One note on the
     * downbeat, dark, and under the growl. You hear a finger on a string at the
     * top of the bar and then the wobble takes the bar; the LINE is the
     * wobble's, which is a synthesised, distorted, filter-swept voice and is
     * what the genre wants carrying it.
     *
     * Kept rather than deleted because a sample is genuinely the right tool for
     * a transient, and because `SAMPLED_ROLES` and the whole loader path behind
     * it are measured through this lane by `fontlanes` - which fails a declared
     * role that emits no haps. One note a bar is a real note.
     */
    played(voice(`${low} ~ ~ ~`).gain(0.62)),
    /*
     * THE GROWL, on the same notes. Held through the ladder with the LFO
     * playing across them - see `wobble.ts` and the `drive` note above for
     * where the crunch comes from.
     */
    wub(figure, opts),
    /*
     * THE BEATING. Two detuned saws an octave up on a related-but-different
     * LFO rate, so the two sweeps drift in and out of phase across the bar.
     * One LFO is a siren; the interference is what makes a wobble sound alive.
     *
     * 0.10-0.34, down from the 0.24-0.66 the first pass gave it. At the higher
     * figure it stopped being a colour on the bass and became a synth line
     * above it, which is what "the second lead synth could be improved, maybe
     * a base guitar instead?" is pointing at. The bass guitar took that job;
     * this went back to being the growl's own texture.
     */
    reese(figure, { ...opts, level: m.sig.drive.range(0.1, 0.34) }),
    /*
     * THE MID-BASS, WHICH DID NOT EXIST. The mix measured 5.6% of its energy
     * between 500 Hz and 2 kHz — the band the sources put the growl's
     * CHARACTER in (100-800 Hz) and the only band a phone or laptop speaker
     * actually reproduces. There was no lane whose job that was; the wobble's
     * only presence up there was the ladder's resonant peak passing through.
     *
     * A third voice on the SAME notes as the wub, with the fundamental
     * deliberately removed. `docs/research-dubstep.md` R3 measured the
     * shaper: at distort(2.0) with distorttype('chebyshev') a 110 Hz saw comes
     * out with h1 at -19.9 dB and h3 at -9.7 — the waveshaper RELOCATES the
     * energy an octave and a fifth up, leaving almost nothing at the
     * fundamental. So this is a mid-bass generated from the note we already
     * have: no transposition, no second oscillator, no independent line, and
     * therefore nothing that can be mistaken for a lead. Banded to 1.8 kHz so
     * it sits in the window without touching the sub; the 90 Hz highpass is
     * belt-and-braces against whatever fundamental survives (no ftype on this
     * chain, so it is a plain biquad — AGENTS.md §4).
     *
     * Same room shape as the wub, because reverbchurn requires one shape per
     * orbit and this is ORBIT_LOW. Level is a signal on drive: the layer
     * arrives with the drop and is a shadow in a breakdown. Conservative to
     * start; the 500 Hz-2 kHz band of a full render is the number to tune it
     * against.
     */
    note(figure)
      .s('sawtooth')
      /*
       * THE WUB'S OWN ENVELOPE, COPIED. The first version of this layer set no
       * envelope at all and took superdough's grouped defaults — a ~1 ms
       * attack and a short decay — which took `attackfloor` red: 7% of pitched
       * haps attacking under 20 ms and falling silent inside 80 ms, which is
       * exactly this layer's three of the bass's fourteen haps a bar. The
       * wobble voices do not go through `articulate()`; they carry these
       * numbers explicitly (`wobble.ts wub()`), and a layer that rides the
       * wub's notes should open and close when the wub does.
       */
      .attack(0.032)
      .decay(0.04)
      .sustain(1)
      .release(0.08)
      .clip(0.72)
      /*
       * THE TALKING BASS. `vowel` is five bandpasses at Q 40-140 with a fixed
       * makeup gain: it annihilates the fundamental (24-32 dB down, measured)
       * and leaves one formant standing — which is exactly wrong on the lane
       * carrying the low end and exactly right on this one, whose job is the
       * 300-800 Hz character over a clean sub. `docs/research-dubstep.md` R6.
       *
       * One vowel per BAR of a four-bar group — `<>` alternates per cycle, so
       * no note is fragmented (the aligned-division trap at `wub()`'s
       * `.lpsync()` applies to any control pattern). Restricted to a, e, o:
       * the research measured u at -33.9 dBFS against e at -18.8, a 15 dB
       * lurch, while a/e/o sit within 3.5 dB of each other. The formant peak
       * walks 330 -> 440 -> 660 Hz across the group, through the band this
       * layer exists to fill.
       *
       * superdough's chain is oscillator -> filter -> vowel -> ... -> distort
       * (superdough.mjs:768 before :790), so the chebyshev shaper below works
       * on the formant-shaped signal: "build the harmonics, move the formant,
       * then shape" is the order the sources call for.
       */
      .vowel('<a e o a>')
      .distorttype('chebyshev')
      .distort(2.0)
      .distortvol(0.35)
      .hpf(90)
      .lpf(1800)
      .gain(m.sig.drive.range(0.18, 0.42))
      .room(0.1)
      .roomsize(ORBIT_ROOM[ORBIT_LOW])
      .orbit(ORBIT_LOW),
    /*
     * THE THUMB: an octave pop on the last sixteenth of the bar.
     *
     * One short, bright note in the gap before the downbeat, which is where a
     * bass player's thumb goes and where nothing else in this arrangement is
     * playing. Its own layer riding `sig.fill`, so it is ADDED to a bar that is
     * already complete rather than replacing anything in it - which is how this
     * lane answers a busier stage now that the two extra plucked fill lines are
     * gone.
     */
    wub(`~ ~ ~ [~ ~ ~ ${octave}]`, {
      ...opts,
      // No wobble on a sixteenth - there is not time for one, and a partial
      // sweep on a stab reads as a wrong note. Fast and shallow so it pops.
      shape: { rate: 16, shape: shape.shape, skew: 0.5 },
      depth: 0.6,
      level: m.sig.fill.range(0, 0.62),
    }),
  )
    /* ======================================================================
     * A STUTTER THAT IS NOT ON THE GRID — the score's first stochastic control.
     * ====================================================================
     *
     * Counted across `src/audio` before this line existed: `sometimesBy` 0,
     * `sometimes` 0, `rarely` 0, `often` 0. **Not one probabilistic operator in
     * five thousand lines of score.** Every variation in this project is a
     * function of game state or of the bar number, which means every variation
     * is predictable, which is a large part of why a generated score reads as
     * generated. The reference track the owner sent has two of these in eight
     * lines: `sometimesBy("0 .5", add(note("12")))` and `rarely(ply("2"))`.
     *
     * `ply(2)` retriggers the hap in place - one note becomes two of half the
     * length - so a wobbled quarter occasionally comes out as a pair of
     * stuttered eighths. That is the genre's own gesture and it is the right
     * one to randomise here, because it changes RHYTHM and not PITCH: an
     * `add(note(12))` would put the bass on `chord.root + 24` on the bars where
     * the figure is already at the octave, which `basscheck` correctly calls a
     * note belonging to no chord in the bar.
     *
     * THE PROBABILITY IS ITSELF A PATTERN, which is the part worth stealing.
     * `'0 0 0.22 0.34'` is silent through the first half of the bar and gets
     * steadily more likely through the second, so the stutters cluster where a
     * player would put them - into the turnaround - rather than being sprinkled
     * evenly, which is what randomness sounds like when it is applied flat.
     *
     * Applied to the STACK rather than to any one layer, so the pluck, the
     * growl and the reese all stutter together. Strudel samples `rand` at the
     * hap's own whole-time, so three voices sharing an onset get the same
     * draw - they cannot disagree about whether a note doubled.
     *
     * Deterministic, which the gates need: the draw is a function of cycle
     * position, so `capture --verify-determinism` and `basscheck`'s figure
     * comparison both still hold.
     */
    /*
     * SEEDED, AND THE REASON IS A MEASURED EDGE, NOT STYLE. Under the default
     * legacy RNG, rand at cycle 0 (and every 300th cycle) is EXACTLY 0
     * (docs/research-dubstep.md section 0.3). With the probability pattern
     * at 0 for the first half of the bar, a hap whose draw is exactly 0 falls
     * into NEITHER partition of sometimesBy and is deleted: tools/_probe_
     * sometimes.mjs measured cycle 0 of 8 losing its entire first half, every
     * bass voice at once - and since every gate and probe in tools/ queries
     * cycle 0, every one of them had been reading a bass with no downbeat.
     * A distinct seed moves the draw off the exact zero; 8 of 8 cycles keep
     * the downbeat with it. Distinct from the clap's 11, because two lanes
     * at the same cycle otherwise get the same draw.
     */
    .sometimesBy('0 0 0.22 0.34', (x) => x.ply(2))
    .seed(21);
}

/**
 * The comping rhythms, one row per feel, stated as `struct` and NOT as notes.
 *
 * THIS TABLE IS THE POINT OF THE REWRITE. Every rhythm in this lane used to be
 * a mini-notation string with the CHORD SPELLED INTO IT — `[~ ${chord}] ~ [~
 * ${chord}] ~` — five times over, once per feel, plus two more for the
 * half-time comp. Pitch and time were the same string, so a change to the
 * voicing was a change to seven rhythm strings and a change to a rhythm was a
 * place the voicing could be typed differently. That is the shape the reference
 * corpus does not have: `struct("<[~ x] [~ x _ ~]>/2")` states WHEN, `chord(x)
 * .anchor(...).voicing()` states WHAT, and the two are composed.
 *
 * Here the notes come from one source (`m.chord`, spelled per lane by
 * `theory.laneTones`/`foldInto`) and the time comes from this table. Adding a
 * feel is one row. Revoicing the chord touches nothing here at all.
 *
 * `core` always sounds; `fill` fades in over it on `sig.ornament`, so pressure
 * ADDS onsets between the ones already playing rather than replacing the bar —
 * the nesting rule `tools/retention.mjs` exists to measure.
 */
const COMP_STRUCT: Record<Feel, { readonly core: string; readonly fill: string | null }> = {
  /* Offbeat stabs, downbeats filling in: the classic placement, and it leaves
   * the downbeat to the kick instead of doubling it. */
  boomchick: { core: '~ x ~ x', fill: 'x ~ x ~' },
  /* One late stab a bar under a running bass pedal. Nothing fills it: the point
   * of `chase` is that the harmony is nearly static while the motor moves. */
  chase: { core: '~ ~ x ~', fill: null },
  /* With the beat, since the gallop's own bass figure is already continuous. */
  gallop: { core: '~ x ~ x', fill: 'x ~ x ~' },
  /* Inside the swung twelve, so the stab lands with the shuffle rather than
   * across it. */
  shuffle: { core: '[~ x] ~ [~ x] ~', fill: '~ [~ x] ~ [~ x]' },
  /*
   * THE HALF-TIME COMP SURVIVES ITS INSTRUMENT.
   *
   * These two rows are, to the sixteenth, the rhythm the deleted clavinet
   * played (`skeleton` and `offbeats` in the removed block). The owner's
   * complaint was never about the rhythm — half-time drums and a wobble bass
   * with nothing moving fast in the bar is a mood rather than a groove, and
   * something syncopated in the space the drums leave is what fixes that. What
   * was wrong was the SOUND. So the figure is preserved verbatim and the voice
   * that played it is gone; the upper structure plays it now, on the same
   * filtered saw every other feel uses.
   */
  /*
   * ...AND THEN IT DID NOT SURVIVE ITS INSTRUMENT AFTER ALL. The paragraph
   * above is kept because its reasoning is the thing that turned out to be
   * wrong, and that is worth more than a tidy row.
   *
   * The claim was that "the owner's complaint was never about the rhythm ...
   * what was wrong was the SOUND". Four hits a bar on the sixteenth grid, plus
   * four more on the fill, at MIDI 68-79 (415-830 Hz), on a sawtooth through a
   * resonant filter envelope - that is not an accompaniment, it is a
   * syncopated line in the register a listener calls the melody, and it went on
   * playing through every demotion of the `lead` lane because it is not in that
   * lane. Measured on the current tree, `chords` was the BUSIEST pitched voice
   * group in the score: 144 haps over 12 bars against the lead's 6.
   *
   * The clavinet was deleted three complaints ago and its FIGURE was kept. Of
   * course it still sounded like the clavinet.
   *
   * Two hits a bar now, both in the hole the half-time drums leave. The
   * downbeat belongs to the kick and beat 3 to the snare, so the core lands on
   * the "and" of 3 - the single most characteristic stab placement in the genre
   * - and the fill adds one on 2 when the stage is busy. `COMP_SLOTS` follows
   * it down from 16 to 8, because a touch is scaled by the fastest note a lane
   * can play and this lane can no longer play a sixteenth.
   */
  halftime: {
    core: '~ ~ [~ x] ~',
    fill: '~ x ~ ~',
  },
};

/**
 * How fast this lane's fastest note is, per feel, for `articulate`.
 *
 * Read off `COMP_STRUCT` rather than guessed: the densest cell in each row.
 * Half-time and shuffle subdivide, everything else is on eighths. This is the
 * number that makes a touch portable — the same `plucked` at 16 slots is a
 * shorter, faster-speaking note than at 8, computed rather than typed.
 */
const COMP_SLOTS: Record<Feel, number> = {
  boomchick: 8,
  chase: 8,
  gallop: 8,
  shuffle: 12,
  // 8, not 16 — see the note on `COMP_STRUCT.halftime`. The sixteenth grid went
  // with the figure that needed it.
  halftime: 8,
};

export function buildChords(m: MusicalState): Pattern {
  const spread = m.powerups.spread ?? 0;
  const half = (m.powerups.timewarp ?? 0) > 0;
  const nova = m.powerups.nova ?? 0;
  // FLANKED widens everything harmonic; see MOVEMENT_MIX.
  const wide = m.movement === 'flank' ? 0.45 : 0;

  /* ==========================================================================
   * ONE CHORD SOURCE, THREE PARTS.
   *
   * The harmony below is unchanged and deliberately so — it is the one part of
   * this lane a previous pass measured hard and got right, and `tools/harmony
   * .mjs` holds seven assertions over it (guide tones against @strudel/tonal's
   * own `guidetones` dictionary in all 44 chords; pad spacing; the core/tension
   * partition surviving `voiceLead`). What changed is everything downstream: the
   * three parts are now derived from this one source and differ by ANCHOR,
   * TIMBRE, STRUCT and TOUCH, which is the corpus's shape, instead of each
   * hand-assembling its own note strings.
   * ======================================================================== */

  /*
   * THE PAD IS A DYAD, ALWAYS — and that is arithmetic, not taste.
   *
   * A window of N semitones can only hold a chord whose span is under N. A
   * root-position shell {root, fifth, seventh} spans eleven and its root can be
   * any of twelve pitch classes, so holding it upright needs 23 semitones; fold
   * the overflow down an octave instead and the seventh lands a WHOLE TONE
   * UNDER THE ROOT. Measured the day the chord grew its seventh: 38 of 88 pad
   * bars held two tones a second apart, at 110-220 Hz, on the one lane that
   * never stops sustaining, with every register gate green.
   *
   * Two tones a fifth apart fold to a FOURTH. There is no arrangement of
   * {root, fifth} in any window that produces a second, which is why the pad is
   * this shape unconditionally. Nothing is lost: the motor states the third
   * continuously, the stab states the third and the seventh as guide tones, and
   * the colour pair states the ninth and the thirteenth.
   *
   * ...EXCEPT ON A PIVOT, where the pad keeps ROOT AND THIRD. The bar before a
   * modulation plays the incoming key's dominant, whose major third is that
   * key's LEADING TONE. An open fifth belongs to no key at all, so the arrival
   * would resolve from nowhere in particular. Root and major third fold to a
   * minor sixth, so that shape is cluster-free for the same reason.
   */
  const rootPc = (((m.chord.root % 12) + 12) % 12);
  const ivOf = (n: number): number => ((((n % 12) - rootPc) % 12) + 12) % 12;
  // Root, perfect fifth, or the diminished fifth locrian gives instead.
  const openTones = m.chord.notes.filter((n) => ivOf(n) === 0 || ivOf(n) === 7 || ivOf(n) === 6);
  const pivotTones = m.chord.notes.filter((n) => ivOf(n) === 0 || ivOf(n) === 4);
  // Never let a voicing rule empty a lane: that is a bug waiting for the one
  // chord that trips it.
  const chosen = m.chord.pivot ? pivotTones : openTones;
  const opened = chosen.length >= 2 ? chosen.slice(0, 2) : m.chord.notes.slice(0, 2);
  const voiced = foldInto(opened, LANE_RANGE.pad.lo, LANE_RANGE.pad.hi);

  /*
   * THE UPPER STRUCTURE IS THE GUIDE TONES — the third and the seventh, the
   * two notes that distinguish a minor seventh from a half-diminished from a
   * dominant, and the two the bass and the bed are NOT holding.
   *
   * The tones are the chord's own, folded — not the iReal spelling, and this is
   * the one place this file's design and the corpus's disagree on purpose. A
   * SYMBOL cannot express which extension the act has unlocked: `Extension`
   * replaces the third with the ninth from the intensification on, and that
   * substitution lives in `chord.notes`. A symbol-driven voicing would go on
   * spelling `A-7` while the reserved material never reached the lane that
   * states it. `buildArp` uses `laneTones` precisely because it has no such
   * obligation.
   */
  const stabFolded = foldInto(m.chord.notes, LANE_RANGE.stab.lo, LANE_RANGE.stab.hi);
  const stabGuide = stabFolded.filter((n) => {
    const iv = ((((n % 12) - rootPc) % 12) + 12) % 12;
    // Everything that is not the root and not a perfect or diminished fifth.
    return iv !== 0 && iv !== 7 && iv !== 6;
  });
  const stabVoiced = stabGuide.length >= 2 ? stabGuide.slice(0, 2) : stabFolded.slice(-2);

  /* ==========================================================================
   * PART 1 — THE BED.
   * ======================================================================== */

  /*
   * ---------------------------------------------------------------------
   * THE PAD IS A SUPERSAW NOW, AND THE ARGUMENT AGAINST IT HAS EXPIRED.
   * ---------------------------------------------------------------------
   *
   * What stood here was a long, careful case for a 50%-duty pulse — "a hollow
   * pulse, not a supersaw" — resting on one premise: that this score is aimed at
   * the 8- and 16-bit canon, where "a supersaw is seven voices spent on one note
   * and these scores had eight voices for the entire arrangement". That premise
   * is no longer true and has not been for two briefs. The reference moved to
   * Aphex Twin (see the `buildHats` tombstone's own amendment) and then to
   * `eefano/strudel-songs-collection`, where `supersaw` appears in 8 of 60
   * pieces and the rest of the harmony is carried by `gm_*` soundfonts this
   * install does not have. `AGENTS.md` §8's rule applies to itself: a rejected
   * experiment expires when its premise changes, and a written rejection reads
   * exactly like a closed question.
   *
   * And the argument was, in the end, an argument for a SQUARE WAVE under the
   * whole game. `pw(0)` maps to duty `(1 - 0) / 2` = 50%: this bed — 27% of all
   * mix energy by soloed-stem reconstruction, sounding under every bar — was a
   * bare square oscillator. The owner's report, three times and finally by name,
   * is that "the base instruments havent changed" and that something "sounds
   * like a clavichord". A square wave held under everything is the largest
   * single reason a score sounds like a chip rather than like a record, and no
   * envelope or filter pass reaches it because the source is the problem.
   *
   * `supersaw` is the ONE rich source available here. `.detune()` and
   * `.spread()` are supersaw-only (AGENTS.md §4) and this is the only lane in
   * the file that can use them, so it is also the only lane that can have an
   * ensemble without spending extra voices: superdough's supersaw is a single
   * pooled `supersaw-oscillator` worklet with a `unison` parameter, not N
   * oscillator nodes (`synth.mjs:154-190`). Three detuned saws for one node.
   *
   * IT IS ALSO THE MIX'S ONLY SOURCE OF REAL WIDTH. `tools/widthcheck.mjs`
   * measured the rendered file at 4.13% side energy and L/R correlation 0.918 —
   * a mono file with a hint of width. The supersaw worklet declares
   * `outputChannelCount: [2]` and pans its unison voices across the field by
   * `spread`, so this is stereo generated at the source rather than a pan.
   *
   * THE FILTER DOES NOT MOVE, and that is deliberate rather than an oversight.
   * A saw has every harmonic at 1/k where a square has odd ones at 1/k, so at
   * an unchanged 560-1900 Hz this lane gets BRIGHTER, which is the direction
   * the mix wants (2.7% of energy above 2 kHz, measured on a render) and also
   * the direction the owner has previously complained about ("too much high
   * pitch synth"). The resolution is to buy the harmonics at the source and pay
   * for them in LEVEL. The gain drops 0.42 -> 0.30.
   *
   * THE LEVEL ARITHMETIC, because the supersaw worklet DOES NOT NORMALISE and
   * this is exactly the sort of thing this file gets wrong by assuming. Read
   * `worklets.mjs`'s `SuperSawOscillatorProcessor.process`: it sums `voices`
   * sawblep oscillators into the output with alternating L/R gains and there is
   * no `1/sqrt(voices)` anywhere (the OTHER supersaw implementation further
   * down that file has a `normalizer`; the one `registerSound('supersaw')`
   * instantiates does not). So:
   *
   *   old   50%-duty pulse, peak +-1, RMS 1.000, gain^2 = 0.42^2 = 0.176
   *   new   3 detuned saws, RMS 0.577 each, incoherent so x sqrt(3) = 1.000,
   *         gain^2 = 0.30^2 = 0.090
   *
   * The two sources come out at the same RMS per unit gain, so the level change
   * is the gain change and nothing else: -5.9 dB. NOT HEARD. The brightness
   * trade is arithmetic and a judgement, and it is the first thing to
   * re-measure with an ear.
   *
   * The per-voice vibrato rates stay. They were built as a substitute for the
   * detune this lane could not have, and now that it can have both, they do
   * different jobs: `detune` beats WITHIN a note, `vib` at different rates beats
   * BETWEEN the chord tones. Both controls are set, always — the oscillator is
   * behind `if (vib > 0)` so `.vibmod()` alone is silent, and `.vib()` alone
   * takes a default depth of half a semitone (AGENTS.md §4).
   */
  const padPans = fanPans(voiced.length, 0.52 + spread * 0.16 + wide);
  const padVoice = (n: number, pan: number, i: number): Pattern =>
    articulate(
      /*
       * Three saws, not superdough's default five: this is a bed under a whole
       * arrangement, and five at this detune is a trance lead. The oscillator
       * and the voice count are the group's IDENTITY, so they come from
       * `VOICE_TAGS` and the gates read that same table rather than a copy.
       *
       * The bed restates twice a bar during the intro, and that is a RHYTHM
       * rather than a note list, so it is a `struct`. Strudel patterns are
       * installed live and a hap whose onset is already past never fires, so a
       * one-note-per-bar intro can wait a whole bar before making a sound —
       * measured at four seconds of literal silence after pressing start.
       */
      /*
       * 14 cents. Wide enough to beat slowly, narrow enough that a held fourth
       * is still a fourth — past about 0.3 the chord goes sour.
       *
       * Passed to `tagVoice` rather than chained, because both are
       * supersaw-only (AGENTS.md §4) and this lane has a `pad` role in
       * `soundfonts.ts` mapping it to `gm_synth_strings_1`. That role is
       * switched off, so the supersaw and both controls are live; if it is ever
       * switched on they go with the waveform instead of sitting inert on a
       * sample, which is what `session` counts.
       */
      tagVoice(note(`${n}`).struct(m.section === 'intro' ? 'x x' : 'x'), VOICE_TAGS.pad, {
        detune: 0.14,
        spread: 0.7,
      })
        .pan(pan)
        .vib(4.6 + i * 0.43)
        .vibmod(m.sig.openness.range(0.045, 0.075))
        /*
         * A NEGATIVE RESULT, kept so it is not re-derived: opening this ceiling
         * is not where the mix's missing air comes from. `range(560,1900)`
         * against `range(760,3200)`, paired, same seed: the soloed stem moved
         * +1.5 dB at 2 kHz and the FULL MIX moved +0.2 dB, a sixth of
         * `capture.mjs`'s own 1.3 dB noise floor. Reverted then and unchanged
         * now — with the source change above, the harmonics arrive without the
         * filter having to be opened for them.
         */
        .lpf(m.sig.openness.range(560, 1900))
        /*
         * 110 Hz is a REGISTER BOUNDARY that exists at full health. `thin` is
         * the player-damage signal and is 0 until somebody is hit, so every one
         * of this lane's haps used to carry `hcutoff` exactly 20. 110 is a fifth
         * below the lane's lowest fundamental, so it removes the skirt this
         * source puts under the bass and not one note.
         *
         * NO `.ftype()` ANYWHERE IN THIS CHAIN, and that is load-bearing:
         * superdough has one shared filter-model control, so an `.hpf()` beside
         * an `.ftype('ladder')` is a second 24 dB/oct LOWPASS (AGENTS.md §4).
         */
        .hpf(m.sig.thin.range(110, 400))
        // A resonant peak is a narrow band the ear cannot stop hearing. On a
        // sustained source it should be nearly flat.
        .lpq(m.sig.ring.range(0.9, 3.4))
        .room(m.sig.space.range(m.section === 'breakdown' ? 0.78 : 0.58, 0.95))
        /*
         * The size no longer moves with the section, and that removal is the
         * point rather than a simplification. `roomsize(breakdown ? 8 : 6)`
         * rebuilt this orbit's whole impulse response on the first hap of
         * every section change and again on the way out - see `ORBIT_ROOM`.
         * The breakdown still opens up: `.room()` above is the SEND and it
         * still goes 0.58 -> 0.78 there, which is the same gesture and costs
         * nothing, because the send is not part of superdough's IR key.
         */
        .roomsize(ORBIT_ROOM[ORBIT_HARMONY])
        .gain(m.section === 'breakdown' ? 0.36 : 0.3)
        .orbit(ORBIT_HARMONY),
      'bowed',
      {
        slots: m.section === 'intro' ? 2 : 1,
        bpm: m.bpm,
        shade: m.sig.openness,
        ring: 1 + (m.section === 'breakdown' ? 0.25 : 0),
        hold: m.sig.hold,
      },
    );
  const pad = stack(...voiced.map((n, i) => padVoice(n, padPans[i], i)));

  /* ==========================================================================
   * PART 2 — THE UPPER STRUCTURE THAT SUSTAINS: the ninth and the thirteenth.
   * ======================================================================== */

  /*
   * `nova`, the shuffle and a HUSHED wave floor the colour tones open: safety
   * should be audible as harmonic space, and a plain triad over a swing feel
   * sounds like a mistake rather than a choice.
   */
  const floor = m.feel === 'shuffle' || nova > 0 || m.movement === 'hush' ? 1 : 0;
  /*
   * AN ENSEMBLE, NOT A SINE WITH AN EDGE.
   *
   * This pair was a `triangle`, and a triangle at 740-1480 Hz behind a 4550 Hz
   * cutoff keeps its 3rd partial at -19 dB and its 5th at -28 dB and has
   * nothing else to give — the previous pass had to move the filter twice to
   * find those two, and both moves are recorded in this file as "THE FILTER WAS
   * BELOW THE NOTE". You cannot filter in what the source never made.
   *
   * A two-voice supersaw at a very small detune is what an arranger means by an
   * upper structure: two players a few cents apart, which beats slowly and
   * never sits still. `unison(2)` and `detune(0.06)` — half the bed's — because
   * this pair sits above the tune, where a wide detune is heard as being out of
   * tune rather than as an ensemble. `spread(0.9)` puts the two voices at
   * opposite edges of the field, which is where a high sustained part belongs
   * and is width the mix does not otherwise have.
   *
   * THE LOWPASS IS UNCHANGED AT 2600-6500 and the level pays for the source, as
   * in the bed. `registermap`'s `harm@lpf` column reads the cutoff against the
   * fundamental and a saw needs the same ratio a triangle does to keep three
   * partials; moving the filter down to compensate for a brighter source would
   * be the exact defect this file has now caught four times. 0.45 -> 0.34 of
   * gain is -5.1 dB after gain-squaring. NOT HEARD.
   */
  const colourVoice = (pitch: number, level: Patternable, pan: number, i: number): Pattern =>
    articulate(
      tagVoice(
        note(String(foldInto([pitch], LANE_RANGE.colour.lo, LANE_RANGE.colour.hi)[0] ?? pitch)),
        VOICE_TAGS.colour,
        // supersaw-only; see `tagVoice`. Live today — the `colour` role maps to
        // `gm_choir_aahs` and is switched off (`SAMPLED_ROLES`).
        { detune: 0.06, spread: 0.9 },
      )
        // Slow, and slower than the bed's: an inner voice moving faster than
        // the part above it reads as nervousness. Both controls set, always.
        .vib(0.37 + i * 0.24)
        .vibmod(m.sig.openness.range(0.05, 0.085))
        /*
         * 3200, NOT 6500. This was the brightest lowpass in the whole score,
         * on a supersaw pair whose fundamentals already sit at 740-1480 Hz
         * and whose stem is faded up in every section (STEM_CURVES.chords
         * ceiling 0.62). Heard: "the synth high pitch sound is not good."
         * Measured (tools/_probe_register.mjs): the second-highest pitched
         * group in the mix, and the highest the director fades up in
         * ordinary play — the arp above it is capped at 0.26 and needs the
         * DRONES powerup. Same treatment as the arp: the register and its
         * measured masking pairs do not move; the harmonics above 3 kHz do.
         */
        .lpf(m.sig.openness.range(2600, 3200))
        .hpf(m.sig.thin.range(420, 900))
        .lpq(m.sig.ring.range(0.9, 3.4))
        .room(m.sig.space.range(0.62, 0.95))
        .roomsize(ORBIT_ROOM[ORBIT_HARMONY])
        .gain(level)
        .pan(clamp01(0.5 + pan * (0.18 + wide)))
        .orbit(ORBIT_HARMONY),
      'breathed',
      { slots: 1, bpm: m.bpm, shade: m.sig.openness, ring: 1 + floor * 0.2, hold: m.sig.hold },
    );
  const colourGain = 0.34;
  const colourPad = stack(
    ...m.chord.colour.map((pitch, i) =>
      colourVoice(
        pitch,
        (i === 0 ? m.sig.colour7 : m.sig.colour9).range(floor * colourGain, colourGain),
        i === 0 ? -1 : 1,
        i,
      ),
    ),
  );

  if (m.section === 'breakdown') return stack(pad, colourPad);

  /* ==========================================================================
   * PART 3 — THE UPPER STRUCTURE THAT MOVES: one voice, five rhythms.
   * ======================================================================== */

  /*
   * ---------------------------------------------------------------------
   * THE CLAVINET IS DELETED, AND THIS IS THE THIRD DISPOSITION OF IT.
   * ---------------------------------------------------------------------
   *
   * Its history, because two of the three attempts were reasonable and both
   * failed the same way:
   *
   *   1. `s('square').ad('0.003:0.08').sustain(0).release(0.05)`, no room. The
   *      owner named it: "the pinging noise is just really bad base type of
   *      sound ... i mean clav or whatever that sound is".
   *   2. Rebuilt as a plucked string — `triangle`, a 14 ms onset, sustain 0.16,
   *      a 220 ms release, 0.28 of room, and a wah from `lpenv`. Every one of
   *      those changes was right about what a clavinet IS.
   *   3. The owner's report after (2): "theres still the annoying instrument
   *      that kind of sounds like a clavichord".
   *
   * Two passes of making it a better clav did not make anyone want a clav. The
   * defect was never the envelope and never the waveform — THE VOICE DOES NOT
   * BELONG. It is one more sustained-register stab doubling harmony that four
   * other parts already carry, and it existed only on `halftime`, which is 27.8%
   * of bars in a measured run and the feel of wave 1.
   *
   * So it is gone, and the half-time groove is carried by the SAME part that
   * comps on every other feel, on the same filtered saw, with the clav's own
   * sixteenth-note figure moved verbatim into `COMP_STRUCT.halftime`. That is
   * the whole disposition: delete an instrument, keep a rhythm, and stop having
   * a special case. It removes a voice group from `registermap`, a timbre from
   * the roster, and about 120 lines including the two long comments arguing for
   * a sound nobody wanted.
   *
   * ---------------------------------------------------------------------
   * AND THE VOICE THAT REPLACES IT IS NOT A PULSE EITHER.
   * ---------------------------------------------------------------------
   *
   * The stab was `pulse` at `pw(0.5)` — a 25%-duty square, the same oscillator
   * family as the bed it is supposed to contrast with and the same family as
   * the motor running underneath it. Three of this score's loudest pitched voice
   * groups were square waves at different duties, which is precisely the "the
   * base instruments havent changed" report: the roster had two oscillators in
   * it wearing four names.
   *
   * A sawtooth through a resonant filter with an envelope on the cutoff is the
   * other classic way to make a comping stab, it shares nothing with the bed or
   * the motor, and the filter envelope was already here — `lpenv(1.1)`,
   * `lpattack(0.006)`, `lpdecay(0.16)` were doing almost nothing to a pulse
   * whose harmonics stop at the 7th. On a saw they are the instrument.
   */
  /*
   * 0.3, not 0.4. The stab is two hits a bar now rather than eight (see
   * `COMP_STRUCT.halftime`), and a sparse part is heard more clearly at the
   * same level than a busy one - so the level comes down with the note count
   * rather than being left to compensate for it.
   */
  const stabLevel = 0.3;
  const grid = COMP_STRUCT[m.feel];
  const stabChord = `[${stabVoiced.join(',')}]`;
  const stabVoice = (rhythm: string, level: Patternable): Pattern =>
    articulate(
      tagVoice(note(stabChord).struct(rhythm), VOICE_TAGS.stab)
        /*
         * `velocity`, not `gain`. superdough multiplies the two and squares the
         * result, so this is the per-note weight and `gain` stays the lane's
         * fader — two dials that mean different things, kept apart on purpose.
         */
        .velocity(1.41)
        .pan(clamp01(0.5 + 0.16 * clamp01(0.5 + spread * 0.16 + wide)))
        .lpf(m.sig.openness.range(1100, 3600))
        .hpf(m.sig.thin.range(300, 700))
        /*
         * The filter envelope IS the stab now. On the old pulse a 1.1-octave
         * sweep over a source with no harmonics above the 7th moved almost
         * nothing; on a saw it opens and shuts across the whole harmonic ladder,
         * which is what makes a comp bite without being loud.
         */
        .lpq(m.sig.ring.range(1.5, 4.5))
        .lpenv(1.1)
        .lpattack(0.006)
        .lpdecay(0.16)
        .drive(m.sig.drive.range(0.45, 0.85))
        .gain(level)
        .room(m.sig.space.range(0.28, 0.7))
        .orbit(ORBIT_HARMONY),
      'plucked',
      { slots: COMP_SLOTS[m.feel], bpm: m.bpm, shade: m.sig.drive, hold: m.sig.hold },
    );

  const parts = [pad, colourPad, stabVoice(grid.core, m.sig.density.range(0, stabLevel))];
  /*
   * TIMEWARP suppresses the fill everywhere, not only on `boomchick`. Half the
   * events at the same tempo is what half-time means to a listener, and the
   * fill is the half that goes.
   */
  if (grid.fill && !half) {
    parts.push(
      stabVoice(grid.fill, m.sig.ornament.range(0, stabLevel * 0.8))
        // Sixteen milliseconds behind the grid. A comping player is always a
        // little late on the offbeat and dead on the beat; this was written for
        // the deleted clav's offbeats and is the one thing about it worth
        // keeping.
        .late(m.feel === 'halftime' ? 0.016 : 0),
    );
  }
  return stack(...parts);
}

/**
 * Which theme a wave plays. A rondo, not a playlist.
 *
 * This was `THEMES[wave % THEMES.length]`, which guarantees that no theme is
 * ever heard twice until all eight have gone by — several minutes apart. Eight
 * tunes cycling once each is how you make sure none of them becomes a hook, and
 * "the music is where the player gets their entertainment" needs a hook.
 *
 * So one theme is the run's signature and comes back every other wave, with the
 * others as episodes between: A B A C A D A E. That is the oldest structure
 * there is for making a tune stick, and it composes with the development that
 * already happens inside a wave — by its third appearance the signature is
 * recognisably itself and audibly transformed, which is the whole point.
 *
 * Five episodes rather than seven, since the themes became eight-bar periods
 * carrying six bars of material each rather than three: `tools/content.mjs`
 * measured a five-minute run reaching wave 8, so anything past the fourth
 * episode was material most runs never met, while the ones they did meet came
 * round every fourteen waves. Now it is every ten, and there is more inside
 * each of them.
 *
 * A boss gets its OWN theme, not the signature.
 *
 * It used to get the signature, on the reasoning that a climax should sound
 * like the thing the run has been teaching you. That is a real argument and it
 * is wrong here, because the signature is also what plays on every even wave —
 * so the biggest moment in the run sounded like the most familiar one, and the
 * only thing that changed when a boss appeared was that it got faster. The
 * user's note was "bosses should be more pronounced, maybe dark themes, evil
 * sinister, think dark side Star Wars", and no amount of tempo does that.
 *
 * So the adversary gets a leitmotif of its own, in a mode heard nowhere else.
 * See `BOSS_THEME`.
 */
/**
 * A theme lasts TWO waves, not one.
 *
 * Measured with `tools/churn.mjs`: over 256 bars, 17 of 26 (key, wave) segments
 * were exactly 8 bars — one phrase. A wave is about a phrase long, and the tune
 * changed every wave, so **no theme was ever stated twice before it was
 * replaced.** Recognition is statement plus restatement; a melody heard once is
 * not a melody the listener can learn, however well it is written. That is
 * upstream of every note in the tables below, which is why it is fixed before
 * any of them are rewritten.
 *
 * The rondo survives intact — it just runs on periods instead of waves, so the
 * signature returns every fourth wave rather than every second, and each
 * statement is a real 16-bar period instead of a single phrase.
 */
/**
 * ...and in the RECAPITULATION it is the signature, whatever the rota says.
 *
 * One of the two changes the run-level form asked of `layers.ts` (the other is
 * the pivot exception in `buildChords`), and it is
 * here rather than in the director because `buildLead` and `buildArp` both
 * resolve the theme themselves from `MusicalState` — routing the decision
 * around them would have meant two call sites agreeing about the rondo, which
 * is the shape of the `render/levelup.ts` mirror bug.
 *
 * A recapitulation is not a fifth episode. The whole content of the gesture is
 * that the material is one the listener met in the first minute and has not
 * heard for a while, arriving in the key it was first heard in (see
 * `MusicDirector.onWaveStart`) with the forces the run has since earned.
 * `THEMES[0]` is the rondo's A — the most-heard tune in the game by
 * construction, which is exactly what makes it the one worth coming home to.
 *
 * A BOSS STILL WINS. The leitmotif outranks the form: a boss that arrived in
 * the last four minutes and played the signature would throw away the one
 * piece of reserved material the score had before any of this existed.
 */
export function themeForWave(wave: number, boss = false, recap = false): Theme {
  if (boss) return BOSS_THEME;
  if (recap) return THEMES[0];
  const period = Math.floor(wave / 2);
  if (period % 2 === 0) return THEMES[0];
  const episodes = THEMES.length - 1;
  return THEMES[1 + (((period - 1) >> 1) % episodes)];
}

export function buildArp(m: MusicalState): Pattern {
  /*
   * NOT IN THE DROP. Heard: "the synth high pitch sound is not good."
   * Measured (tools/_probe_register.mjs): this lane is the highest pitched
   * thing in the mix by half an octave — a triangle at MIDI 93, 1760 Hz, at
   * gain 0.60 with its lowpass open to 4950 Hz — and it plays sixteenths.
   * In the one section the genre gives to the bass, a bright sixteenth-note
   * arpeggio in the top octave is the opposite of what the sources describe
   * (docs/research-dubstep.md §5: the lead itself stays out of the drop except
   * on cadence bars). The register is NOT lowered: LANE_RANGE.arp was placed
   * at 87 by a masking measurement to clear the chord voices, and an octave
   * down would re-create that collision. Brightness and level move instead,
   * below.
   */
  if (m.section === 'drop') return silence;
  const homing = m.powerups.homing ?? 0;
  // Capped at 3, not 2. `Math.min(2, ...)` meant a third DRONES added nothing —
  // and drones are the powerup whose whole idea is more satellites.
  const drones = Math.min(3, m.powerups.drones ?? 0);
  const half = (m.powerups.timewarp ?? 0) > 0;
  /*
   * `LANE_RANGE.arp` — 87-99, ABOVE the tune, and this is the largest single
   * register move in the refactor.
   *
   * It was `chord.notes + 12`, which put the arp at a measured MIDI 69-83
   * against the lead's 69-81: the same window, the same pitches, an
   * accompaniment running straight through the melody. That is the oldest
   * mistake in orchestration and it does not present as a level problem, which
   * is why no amount of fader work ever fixed it.
   *
   * `arpDisplacement` existed to fix it and pointed the wrong way — it moved
   * the arp DOWN twelve semitones, into the motor's 57-69 and the lead's own
   * sawtooth doubling at 57-68. `docs/MASTER_PLAN.md` §1 S-c prescribed upward
   * displacement with a highpass and it was never built. This is that: the arp
   * lives above the tune, and `arpDisplacement` now drops it INTO the tune's
   * octave on the bars where the tune is not there to be collided with.
   *
   * The tones are `laneTones`, so they are an iReal spelling of the chord
   * symbol at this lane's anchor rather than the pad's notes moved up. A walk
   * over a real voicing includes the seventh and often the ninth, which is what
   * makes an arpeggio sound like an arpeggio of a chord rather than a triad
   * spelled out.
   *
   * Sorted, because the walk below starts from the top or the bottom of it —
   * `laneTones` already returns ascending, and this is the assertion of that.
   */
  const tones = laneTones(m.chord, 'arp').sort((a, b) => a - b);

  /*
   * Rhythm from the melody's rests; pitches walking the chord.
   *
   * The walk is computed over EVERY gap, not over the gaps currently switched
   * on. That distinction is the whole fix: `step` used to advance only on
   * sounding slots, so the moment a busier passage filled the even-numbered
   * gaps, every pitch after the first shifted to a different chord tone.
   * `tools/retention.mjs` measured the result — one step of the intensity dial
   * left the arp with 15% of its phrase, the worst lane in the mix. Binding a
   * pitch to its slot index instead means filling a gap adds a note without
   * moving any of the others.
   */
  const theme = themeForWave(m.wave, m.bossTheme, m.recap);
  const cell = cellForBar(theme, m.phrase, m.barInPhrase);
  const gaps = arpGapsFor(cell);
  /*
   * And the walk goes the other way from the tune.
   *
   * The arp already answered the melody rhythmically — it plays where the
   * melody rests — but it climbed the chord in the same direction whatever the
   * melody was doing, so two lines that take turns were still one shape.
   * Contrary motion is what makes a second part sound like a second part rather
   * than like the first one continuing: when the tune rises the arp starts at
   * the top of the chord and walks down, and when it falls the arp climbs.
   *
   * Which way the tune goes is the majority of its steps, not its first note
   * against its last. The signature theme's opening bar leaps up a sixth and
   * then walks down four times: measured end to end it "rises", and what a
   * listener follows is a descent. Read the wrong way round, the arp moved WITH
   * the melody in a third of the bars — `tools/counterpoint.mjs` read 4 of 6
   * rather than 6 of 6.
   *
   * All of it comes off the bar's own cell, which is a pure function of
   * (theme, phrase, bar) — the same thing the rhythm is derived from — so none
   * of this adds a dependency on game state.
   */
  const sung = cell.filter((d): d is number => d !== null);
  const slope = sung.slice(1).reduce((a, d, i) => a + Math.sign(d - sung[i]), 0);
  const rises = slope >= 0;
  const from = rises ? tones.length - 1 : 0;
  const walk = rises ? -1 : 1;
  let step = 0;
  const pitchAt = gaps.map((gap) => {
    if (!gap) return null;
    /*
     * No second octave. The walk used to add another +12 once it passed the top
     * chord tone, which put the arp's ceiling at MIDI 103 — G7. It now stays
     * inside one octave, decorating the harmony instead of screaming over it.
     */
    const n = tones[(((from + walk * step) % tones.length) + tones.length) % tones.length];
    step++;
    return String(n);
  });
  if (step === 0) return silence;
  /*
   * OFFBEATS, AND NOTHING ELSE ANY MORE.
   *
   * There were two lines here: `core` on the odd slots and a `fill` on the even
   * ones, faded in by `sig.fill` as the stage got busy, and together they were a
   * continuous sixteenth-note line. The `fill` half is deleted - see the note on
   * `pod` below, and `STEM_CURVES.arp`. What is left is the half that was always
   * sounding and the half that interlocks with the tune rather than filling in
   * around it: `arpGapsFor` gives this lane the melody's silences, and the odd
   * slots are where those silences are.
   *
   * The old note, kept because the reasoning is still the right shape for
   * anything else in this file: `density > 0.7` used to switch the even gaps on
   * and off, and splitting one line into two made that a FADER instead of a
   * rewrite. That trade was correct; the lane simply should not be playing both
   * halves of it at all now.
   */
  const core = pitchAt.map((n, i) => (n !== null && i % 2 === 1 ? n : '~')).join(' ');

  const voice = (line: string, transpose: number, pan: number, level: Patternable, sync: number): Pattern =>
    note(line)
      /*
       * `.add(note(n))`, never `.add(n)`.
       *
       * Adding a bare number to a control pattern does nothing at all. Strudel
       * unions the two hap values, sees `{note: 77}` against `{value: -12}`,
       * has no field in common, logs `[warn]: Can't do arithmetic on control
       * pattern` and returns the left side unchanged — so the transposition is
       * silently discarded and the voice sounds in unison with the one it was
       * supposed to be an octave below. Wrapping the number in the same control
       * gives the union a field to add.
       *
       * This had been the case for the whole project. A query of the lead's
       * cached pattern returned `[77,77]`, `[80,80]`, `[82,82]`: two voices, one
       * pitch. The warning fired 52 times in a twelve-second run and went to the
       * console, where nothing was reading it.
       */
      .add(note(transpose))
      /*
       * ...and out of the melody's octave when the melody is present — UPWARD.
       *
       * A signal, so it slides the already-scheduled notes rather than
       * replacing the phrase. Same `note()` wrapping rule as above applies —
       * `sig.arpOctave` is built with `signal()` in the director and is a plain
       * value pattern, so it needs the control wrapper to have a field to add
       * against. See `Signals.arpOctave`.
       *
       * THE `.mul(-1)` IS GONE, AND SO IS THE ARGUMENT IT SETTLED.
       *
       * A previous pass found `arpDisplacement` pointing the wrong way — it
       * moved the arp DOWN into the motor's window whenever the lead came
       * forward — and fixed it HERE, by negating the signal in the builder,
       * with a comment ending "if the sign is ever fixed upstream, delete the
       * `.mul(-1)`". Two functions then disagreed about which direction a
       * positive number meant, which is the sort of thing that stays correct
       * exactly until somebody reads one of them on its own.
       *
       * The sign is fixed upstream now, and the reason it could be is that this
       * lane's HOME moved: `tones` is `laneTones(m.chord, 'arp')`, so the arp is
       * based at `LANE_RANGE.arp` (87-99) rather than at `chord.notes + 12`.
       * `arpDisplacement` therefore returns a plain semitone offset with the
       * obvious meaning — 0 to stay above the tune, -12 to drop into the tune's
       * octave on the bars where the tune is not using it.
       */
      .add(note(m.sig.arpOctave))
      /*
       * THE ONE LANE THAT KEEPS ITS OSCILLATOR IN THIS PASS, and the reason is
       * measured rather than conservative.
       *
       * The pad, the upper structure, the comping stab and the motor all
       * changed source in this pass because they were four square waves at
       * three duties. This one is a triangle at MIDI 87-99 — 1244-2489 Hz,
       * the only lane in the score whose energy peaks above 1 kHz. A triangle
       * has ODD harmonics only, falling as 1/k squared, so its third partial is
       * 19 dB down and there is nothing above the fifth; a saw or a supersaw in
       * that register puts -6 dB partials at 7 kHz, under a listener, for the
       * whole run. The one human complaint this file has on the subject is "too
       * much high pitch synth always playing, its taxing on the ears".
       *
       * What DID change here is everything about how it is played: a 4 ms
       * onset became 26-40 ms, and the lane states a note length for the first
       * time. See `TOUCH.plucked`.
       *
       * Triangle, and the resonant filter comes off with it.
       *
       * `lpq(7)` with `lpenv(4)` on a sawtooth is an acid line — a resonant
       * peak sweeping through the fatigue band on every note. That is a
       * deliberate and very recognisable dance sound, and it is the wrong genre
       * for a score that is being asked to sound melodic. The arp is filigree
       * behind the tune; it needs motion and pitch, not bite.
       */
      .s(VOICE_TAGS.arp.s)
      /*
       * The envelope moved to `articulation.ts`, touch `plucked`.
       *
       * The old comment here argued against dots and for legato, and it was
       * answering a real defect - a 120 ms decay to sustain 0 on a 230 ms note
       * is morse code. It over-corrected into the opposite one: sustain 0.4
       * across the whole slot plus 180 ms of release is 1.8 notes of overlap on
       * a sixteenth-note filigree, which is not legato, it is a wash.
       *
       * `plucked` holds 50-62% of the slot and lets go over 135-175 ms. That is
       * a note that reaches most of the way to the next one and then stops,
       * which is what a plucked line does; and because the release is allowed
       * to exceed the hold, the ringing-on is a property of the instrument
       * rather than of the note length.
       */
      /*
       * Brighter, because this lane is now the sparkle.
       *
       * Measured before: fundamentals 440-988 Hz behind a cutoff of 1625 Hz at
       * mid openness — 2.5 harmonics, on a triangle, which is a sine with a
       * slight edge. Filigree that the ear cannot separate from the pad is not
       * filigree. 900-4600 lets the 3rd, 5th and 7th partials through at
       * -19/-28/-34 dB, which is what makes a triangle read as a bell rather
       * than as a flute, and it is deliberately the brightest lowpass in the
       * file because this is the highest-pitched repeating line in it.
       */
      /*
       * 900-4600 -> 1500-7000, BECAUSE THE FILTER MOVED UNDER THE NOTE.
       *
       * The comment above computes "the 3rd, 5th and 7th partials at
       * -19/-28/-34 dB" from a measured range of 440-988 Hz. That range is the
       * UNDISPLACED one. `registermap --arp-oct=-12` — the state this lane is
       * actually in whenever the tune is playing, which is most of the game —
       * measures MIDI 81-95, **880-1976 Hz**, and against a cutoff of 2750 Hz
       * at mid openness that is a cutoff-to-fundamental ratio of **2.1x, and
       * 1.4x for the top of its own range**: the lowest in the file since the
       * colour tones were fixed for the identical mistake ("THE FILTER WAS
       * BELOW THE NOTE"). Displacing a lane up an octave and leaving its
       * lowpass where it was turns a bell back into a sine.
       *
       * Confirmed twice, independently: `registermap` prints `harm@lpf 2.1x`
       * displaced against 4.2x undisplaced, and the soloed render puts 49.7%
       * of this lane's energy in the 1 kHz band and 0.7% above 4 kHz.
       *
       * 1500-7000 is 3050 at mid... which is still only 2.2x displaced, so the
       * range has to move by more than the note did: at 7000 the top of the
       * openness sweep finally clears the 3rd partial of the highest displaced
       * note. Undisplaced this reads 3.5x-7x, brighter than before on a lane
       * whose source is a triangle (3rd partial -19 dB), which is the least
       * fatiguing way there is to spend a filter.
       */
      /*
       * 1500-7000 -> 1900-8000, AND THIS IS THE THIRD TIME IN THIS FILE.
       *
       * The comment above is about a lane being transposed and its lowpass
       * left where it was. That happened again, to this lane, in the same pass
       * that wrote the comment's own fix: `LANE_RANGE.arp` moved the walk to
       * 87-99 and `registermap` immediately read `harm@lpf 2.7x` — and 2.7 on a
       * TRIANGLE is nothing at all, because a triangle has only ODD harmonics,
       * so the first one above the fundamental is the THIRD. A cutoff under 3x
       * removes every partial this oscillator has and leaves a sine.
       *
       * 1900-8000 puts mid openness at 4950 Hz, which is 3.2x the median
       * fundamental (MIDI 91, 1568 Hz) and clears its third partial at 4704.
       * The third partial of a triangle is -19 dB, so this is the cheapest air
       * in the file: it is what makes this read as a bell rather than as a
       * flute, and it is the only lane in the score whose energy peaks above
       * 1 kHz at all.
       *
       * The rule this keeps failing is worth stating once more as a rule: a
       * lane's filter is defined RELATIVE TO ITS FUNDAMENTAL, so a register
       * change is a filter change. `registermap`'s `harm@lpf` column exists to
       * make it visible and it is the number to read after any transposition.
       */
      /*
       * 3200, NOT 8000. A triangle's character above 3 kHz is the "bing" —
       * odd harmonics of a fundamental already at 1.2-2.5 kHz. Capping the
       * ceiling at 3.2 kHz keeps the note and takes the glassiness; the
       * register (and so every masking pair measured for it) does not move.
       */
      .lpf(m.sig.openness.range(1900, 3200))
      /*
       * A boundary rather than the dead 20 Hz this used to sit at whenever the
       * player was undamaged — see the pad's highpass.
       *
       * Deliberately NOT raised with the register. 330 Hz was a fifth below the
       * old floor of MIDI 69 and is now nearly two octaves below MIDI 87, so it
       * removes strictly less than it used to. That is correct: this control's
       * job is to keep the lane's low SKIRT off the pad, and a highpass placed
       * just under a fundamental of 1245 Hz would be shaping the tone rather
       * than separating the lanes, which is what the lowpass above is for.
       */
      .hpf(m.sig.thin.range(330, 700))
      .lpq(m.sig.ring.range(2, 5))
      .lpenv(1.4)
      .lpdecay(0.11)
      .delay(0.26 + homing * 0.3)
      .delaysync(sync)
      .delayfeedback(0.3 + homing * 0.22)
      /*
       * A ROOM, at last. This lane measured `room 0.00` — bone dry.
       *
       * `registermap` prints a room column and it read 0.00 on eight of fifteen
       * voice groups, this one among them, while the pad next door on the SAME
       * ORBIT sent 0.58. Seven different sends on one orbit is seven different
       * rooms, which is to say no room at all: the ear places sources by their
       * shared reverberation, and a mix where the loud clock lanes are dry and
       * the quiet colour lanes are wet reads as a wall of unrelated objects
       * rather than as a band in a space. 55 of the 60 songs in the reference
       * corpus use `.room()`; this score used it on four lanes of eleven.
       *
       * Small, because this lane has a tempo-synced delay already and a wet
       * sixteenth-note line turns to porridge. 0.24 against the pad's 0.58 is
       * "the same room, further from the microphone", which is what a
       * high filigree part should sound like.
       */
      .room(m.sig.space.range(0.24, 0.55))
      .roomsize(ORBIT_ROOM[ORBIT_HARMONY])
      // 0.75x: the loudest gain in the register table sat on the highest lane.
      // Lower level also lowers this lane's weight in every masking pair, which
      // is the safe direction for the collision gates.
      .gain(reify(level).mul(0.75))
      .pan(pan)
      .orbit(ORBIT_HARMONY);

  // Each satellite plays both lines, so the fill fades in across all of them
  // together rather than only on the lead pod.
  /*
   * FLANKED throws the two halves of the line to opposite wings.
   *
   * The core and the fill interleave on the same lattice, so panning them apart
   * makes one line arrive from either side and meet in the middle — which is
   * what the wave itself does. It is the same notes; only where they come from
   * changes, which is why this belongs here rather than in MOVEMENT_MIX.
   */
  const wing = m.movement === 'flank' ? 0.45 : 0;
  /*
   * `slots: 8`. The walk is written on the melody's eight eighth-note slots
   * (`arpGapsFor` reads the same cell the tune does), and `core`/`fill` are
   * that lattice split into odds and evens - so the fastest note this lane can
   * emit is an eighth even when both halves are sounding.
   */
  const plucked = (p: Pattern): Pattern =>
    articulate(p, 'plucked', {
      slots: 8,
      bpm: m.bpm,
      shade: m.sig.drive,
      /*
       * TIMEWARP and HOMING both lengthen the note, and both used to do it by
       * hand: `half` chose `ad('0.006:0.26')` over `ad('0.004:0.2')`, which is
       * a 60 ms difference in DECAY on a lane whose sustain is 0.38 - i.e. a
       * control the powerup could barely be heard through. `ring` scales the
       * hold and the release together, which is what "notes ring on longer"
       * actually means and is clamped in `articulate` so no combination can
       * reach the overhang this pass exists to remove.
       */
      ring: 1 + (half ? 0.3 : 0) + homing * 0.12,
      hold: m.sig.hold,
    });
  /*
   * ONE LINE PER POD, NOT TWO.
   *
   * `core` and `fill` are the same lattice split into odd and even slots, so
   * a pod sounding both is a continuous sixteenth-note line at 1245-2489 Hz.
   * `registermap` measured this lane at **19.4% of all the air in the mix**,
   * second only to the snare's noise burst, and a continuous high sparkle
   * over a half-time wobble is the "bing bong" complaint almost by
   * definition. The genre has no arpeggio in it.
   *
   * Dropping `fill` halves the note count and turns the line from sixteenths
   * into eighths, which is the difference between a texture and a
   * decoration. `arpGapsFor` still decides WHERE those eighths fall, so the
   * interlocking with the tune - the property `interlock` measures - is
   * unchanged in kind.
   */
  const pod = (transpose: number, pan: number, level: number, sync: number): Pattern[] => [
    plucked(voice(core, transpose, clamp01(pan - wing), level, sync)),
  ];
  /*
   * EVERY POD LEVEL GOES UP BY HALF, and the reason is where this lane sits
   * rather than how loud it feels.
   *
   * The comment above calls this lane "the sparkle" and "the highest-pitched
   * repeating line in the file", and the upward displacement puts it at
   * MIDI 81-95 — 1109-2489 Hz — whenever the tune is also playing, which is
   * most of the game. Measured through the real chain (`tools/capture.mjs`,
   * 32 bars, world seed 0x51ed, this stem soloed) it is the ONLY pitched lane
   * whose energy peaks above 1 kHz: 500 Hz 22.2%, 1 kHz 49.7%, 2 kHz 27.3%.
   *
   * And it was at **-43.4 dBFS in-mix, 15 dB under the tune and 17 under the
   * bass**, contributing 0.8% of the mix. The one lane written to occupy the
   * register the mix has none of was inaudible in it.
   *
   * 0.4 -> 0.6 is +7.0 dB of energy (gain is squared), which is where the
   * predicted "above 2 kHz" share picks up about a point on its own. The
   * relative balance BETWEEN the pods is unchanged, so a player can still
   * count their drones.
   */
  if (drones <= 0) return stack(...pod(0, 0.36, 0.6, 3 / 16));
  // One voice per orbiting pod, hard-panned and on a different delay division
  // so they audibly lag each other. You can count your drones with your ears.
  const parts = [...pod(0, 0.14, 0.51, 3 / 16), ...pod(7, 0.86, 0.39, 1 / 8)];
  if (drones >= 2) parts.push(...pod(12, 0.5, 0.3, 1 / 16));
  if (drones >= 3) parts.push(...pod(-12, 0.4, 1, 1 / 12));
  return stack(...parts);
}

export function buildLead(m: MusicalState): Pattern {
  const theme = themeForWave(m.wave, m.bossTheme, m.recap);
  /*
   * The melody's register follows the player up the screen.
   *
   * Flying high is the risky place to be — it is where the enemies are and
   * where the bullets are densest — so the tune answers by climbing with you.
   * It is the most direct coupling in the game: not a threshold or a smoothed
   * average of anything, just where you are, right now, transposed into the
   * part everyone is listening to.
   *
   * Quantised to octaves and applied only at a rebuild, because a melody that
   * slides continuously with the ship is a theremin, not a tune.
   */
  /*
   * One octave lower than it was.
   *
   * `tonic + 24` put the melody at A5 with three simultaneous voices on it and
   * a descant a sixth above that, reaching F#6. A tune that high is a whistle
   * rather than a melody, and it left nothing in the register a listener
   * actually follows. `tonic + 12` is A4 — the octave a voice sings in.
   */
  const base = m.tonic + 12;
  const laser = m.powerups.laser ?? 0;
  const written = melodyForBar(theme, m.phrase, m.barInPhrase, base, m.mode);
  /* ==========================================================================
   * IN A DROP THE BASS IS THE LEAD, AND THE TUNE GETS OUT OF ITS WAY.
   * ==========================================================================
   *
   * This is the one place in the score where a whole lane stops emitting for a
   * structural reason rather than a dynamic one, and it is the thing the genre
   * is actually built on: at the drop, everything except the bass and the kit
   * gets out of the way, and the growl carries the eight bars on its own.
   *
   * `tools/sections.mjs` measures the drop at **48.6% of every run** (8 x 900 s,
   * 3840 bars; per-seed 43-55%). So this is not a rare gesture: for about half
   * of a run there is now no continuous melody at all, which is the arrangement
   * the owner asked for described as a number.
   *
   * NOT ALL OF IT. The tune still sounds on the CADENCE BAR of each four-bar
   * group — `barInPhrase % 4 === 3`, the bar the themes are written to arrive
   * on (three of the six cells reach it through a prepared suspension; see
   * `melodyForBar`). One bar in four is a stab answering the bass, which is
   * what a lead is for in this music. Every theme therefore still states its
   * cadences during a drop, and outside the drop nothing is masked at all — the
   * material is untouched, which is why `tune`, `motif` and `rondo` read the
   * same tables they always have.
   *
   * A BOSS IS EXEMPT, and it is the only exemption. The leitmotif is the one
   * piece of reserved material in the whole system (`themeForWave`), the boss
   * stack below is the one place the melody is scored for weight rather than
   * for prettiness, and a fight is where a tune earns the right to be over the
   * bass. Every boss is half-time now, so without this the leitmotif would have
   * been silent for half of every fight.
   *
   * A rest string rather than a `silence` return, so the lane keeps its shape:
   * the fader, the room, the delay and the articulation all still exist and the
   * director never sees the level collapse, which is what would force a rebuild
   * and turn a written rest into an audible cut.
   */
  /*
   * ...AND IT IS `sustain` AS WELL AS `drop`, WHICH IS THE FOURTH TIME.
   *
   * The owner, having heard the build: **"the meleody is driven by an
   * instrumen that sounds stupid lol"**. That is the same complaint for the
   * fourth time in one session, in four different sets of words:
   *
   *   "too muc hsynth to much bing bong"
   *   "a foreground melody offa funny instrument i'ts just no"
   *   "need a baseline, not just leads"
   *   "the meleody is driven by an instrumen that sounds stupid"
   *
   * Four rounds of RE-VOICING this lane have not answered it - supersaw to
   * triangle, triangle to oboe, oboe back to triangle. The signal in that is
   * that the patch was never the problem: a foreground tune over a beat is a
   * pop arrangement, and it is the ARRANGEMENT that keeps reading as wrong.
   * So the melody stops being the protagonist rather than being dressed
   * differently again.
   *
   * `drop` and `sustain` are **65.6% of every run** by `tools/sections.mjs`
   * (48.6 + 17.0, over 8 x 900 s). Across those bars the tune sounds on the
   * CADENCE BAR of each four-bar group and nowhere else - one bar in four, a
   * stab answering the bass, which is what a lead is for in this music. The
   * other 34.4% - build, breakdown, intro, fill, collapse - keeps the whole
   * melody, because those are the sections that exist to expose it.
   *
   * TWO EXEMPTIONS, and no more. A BOSS keeps its leitmotif: it is the one
   * piece of reserved material in the system and the one place the melody is
   * scored for weight rather than for prettiness. A HUSHED or SOLOIST wave
   * keeps the tune because both movements are announced by a banner and both
   * are built around the melody coming forward; taking it away there would
   * leave the gesture with nothing to be.
   *
   * NOTHING IS MASKED OUT OF THE MATERIAL. Every theme still states every
   * bar it has, somewhere - which is why `tune`, `motif` and `rondo` are
   * still reading the tables they always did.
   */
  const yieldToBass =
    (m.section === 'drop' || m.section === 'sustain') &&
    !m.boss &&
    m.movement !== 'hush' &&
    m.movement !== 'elite' &&
    m.barInPhrase % 4 !== 3;
  const lines = yieldToBass
    ? { skeleton: '~', filigree: '~' }
    : written;

  // Two voices an octave apart, the lower one quieter: a single thin saw line
  // sounds like a test tone, and the octave is what makes it read as a lead.
  /*
   * The melody is a triangle over a filtered saw, not a supersaw.
   *
   * "too much high pitch synth always playing, its taxing on the ears" is about
   * this layer more than any other: it is the highest thing in the mix, it now
   * sustains rather than plucking, and it was seven detuned saws. A triangle
   * has only odd harmonics falling as 1/n squared, which at this register is a
   * flute rather than a synth — it carries a tune beautifully and has almost
   * nothing in the 2.5-6kHz fatigue band.
   *
   * A triangle alone is too polite to lead, so the octave below stays a
   * sawtooth, low-passed hard. That is the oldest trick in orchestration: the
   * bright instrument doubles the sweet one an octave down and gives it a body
   * the ear reads as one voice. It costs no extra voices, because the octave
   * doubling was already there.
   */
  /*
   * How long the note is actually held. Lifted out of `.sustain()` because the
   * vibrato below is driven by the same thing, and they must not drift apart.
   */
  const held = Math.max(
    m.movement === 'elite' ? 0.62 : 0,
    laser > 0 ? Math.min(0.78, 0.5 + laser * 0.12) : 0.55,
  );

  /*
   * Vibrato — the articulation that makes a held note sound sung rather than
   * generated, and the score had none of it anywhere.
   *
   * A pulse or triangle held at a fixed frequency is a test tone: the ear
   * hears an oscillator, because nothing physical sustains a pitch that
   * perfectly. A few cents of periodic movement is heard as a voice. Its
   * absence is a large part of why a chip melody reads as synthetic, and it
   * costs no voices — this lane already sustains at 0.55 and upward, so almost
   * every note is long enough to carry it.
   *
   * Depth follows `held` rather than being a constant, which is what a player
   * does: there is no room for vibrato in a fast run, and a long note without
   * it sounds dead. So LASER and a SOLOIST wave lengthen the note AND open the
   * vibrato as one gesture. Range is 0.09-0.30 semitones; the ceiling matters,
   * because past about 0.5 the pitch stops reading as one note and the melody
   * goes out of tune with the harmony under it.
   *
   * Both voices get identical rate and depth. They are a doubling, not two
   * players — detuning their vibrato against each other would beat.
   */
  // `vibDepth` and `vibRate` used to be computed here from `held` and the boss
  // phase. The lead no longer has vibrato (see the note at the chain below), and
  // nothing else read them.

  /*
   * THE LAVENDER TOWN BOSS TREATMENT IS GONE, at the owner's word: "lol the
   * lavendar town boss fight is so awful lets just forget about that spec".
   *
   * It was asked for by name and built faithfully — a slow 2.5 Hz wobble half a
   * semitone deep, deepening to 0.89 through the phases, with a tremolo under
   * it, taken from tzwaan's cover. Every number was measured and the gate that
   * watched it was strengthened rather than relaxed.
   *
   * And it sounded bad, which no measurement here could have told anyone. The
   * cover works because it is a LULLABY made wrong: sparse, slow, four thin
   * pulse voices and one noise hit. Dropped onto a lane that is doubling a
   * melody across three oscillators over an eleven-lane arrangement at fighting
   * tempo, "deliberately out of tune" is just out of tune. The reference was
   * right about itself and wrong about here, and the only instrument that could
   * detect that is an ear.
   *
   * Worth keeping as a note rather than a silent deletion: this is the clearest
   * case this session of a change that was correct at every step of its
   * reasoning and still wrong. `leadcheck`'s boss assertion goes with it.
   */

  /*
   * THE SAWTOOTH DOUBLING HAD THE TRIANGLE'S FILTER.
   *
   * The comment above says "the octave below stays a sawtooth, low-passed
   * hard". It was not. `voice()` set one lowpass for both oscillators, and
   * `tools/registermap.mjs` reads the same number off both groups' haps:
   * `lead/sawtooth` and `lead/triangle` each carried cutoff 2550 at mid
   * openness, 52,800 haps apiece. So the "body" layer was three sawtooth
   * lines at MIDI 57-68 — 220-415 Hz, which is the motor's exact octave — with
   * eleven harmonics reaching 2.5 kHz, in the loudest stem in the game
   * (`lead` has the highest ceiling in `STEM_CURVES`, 0.95, and rendered at a
   * fader of 0.74 in the 32-bar capture). Soloed, this lane measures 64.4% of
   * its energy in the 500 Hz band and 22.7% in the 1 kHz band; the 250/500
   * pair holds 66.6% of the whole mix. This layer is the largest single
   * contributor to that, and it is a contribution nobody wrote.
   *
   * A body is a fundamental and its first two or three partials. That is what
   * an orchestrator means by doubling at the octave, and it is why the trick
   * costs nothing: the bright instrument on top supplies the harmonics, the
   * one underneath supplies the weight. Eleven harmonics of the doubling is
   * not a body, it is a second lead in the wrong octave.
   */
  const isBody = (osc: string): boolean => osc === 'sawtooth';
  /*
   * THE SOURCE IS A TOKEN, NOT A WAVEFORM — see `soundfonts.ts`.
   *
   * `'tune'` and `'decor'` resolve at build time to the role's instrument when
   * it is enabled and its samples are resident, and to the oscillator this lane
   * always had when it is not. Everything else here that branches on the source
   * (`isBody`, `decor`) still branches on `'sawtooth'` and the tokens, so the
   * boss stack and the octave-down body are untouched.
   *
   * TODAY BOTH TOKENS RESOLVE TO OSCILLATORS. `leadTune` maps to `gm_oboe` and
   * `leadDecor` to the same, and neither is in `SAMPLED_ROLES`: the tune is the
   * triangle it always was and the decoration the 25%-duty pulse. The mapping
   * is kept rather than unwound because the mapping is the thing being argued
   * about, and deleting it would delete the argument along with it.
   */
  const tuneVoice = voiceSource('leadTune');
  const decorVoice = voiceSource('leadDecor');
  const resolved = (osc: string): ResolvedVoice =>
    osc === 'tune' ? tuneVoice : osc === 'decor' ? decorVoice : { s: osc, sampled: false };
  const voice = (line: string, transpose: number, level: Patternable, osc: string, pan: number): Pattern => {
    const v = resolved(osc);
    const src = v.s;
    let p = note(line)
      // See the note on `.add(note(n))` in buildArp: a bare number is dropped.
      .add(note(transpose))
      .s(src);
    if (v.n !== undefined) p = p.n(v.n);
    /*
     * `pw` IS PULSE-ONLY AND IS NOW SET ONLY ON A PULSE.
     *
     * It used to be unconditional, with a comment arguing that "on a triangle
     * or a sawtooth it is inert, and a conditional here would be a second
     * place to keep in step with `decor`". That was true and it is the exact
     * shape of defect `tools/session.mjs` counts — a control that parses,
     * type-checks, reaches the hap and does nothing. There is no second place
     * to keep in step now: the condition is on the RESOLVED source, so it
     * cannot disagree with what `.s()` was handed.
     */
    if (src === 'pulse') p = p.pw(v.pw ?? 0.5);
    /*
     * THE WIDTH LAYER. A supersaw is only ever the support here — never the
     * line — so it gets the genre's numbers straight: five voices, half a
     * semitone of total spread, hard-panned. `.detune()`/`.spread()` are
     * supersaw-only (AGENTS.md §4), which is why this is gated on the source.
     */
    if (src === 'supersaw') p = p.unison(5).detune(0.5).spread(0.9);
    /*
     * THE LEAD RECIPE, THE RIGHT WAY ROUND. Four re-voicings of this lane —
     * supersaw, triangle, oboe, triangle — all moved toward SWEETER and more
     * acoustic, and the owner rejected every one ("sounds stupid", four
     * times). The genre's recipe (`docs/research-dubstep.md` §6.2) is the
     * opposite: a mono, MID-FOCUSED body that carries the hook, saturated;
     * width from a detuned supersaw BEHIND it, quieter; no vibrato. So the
     * tune and its decoration are band-limited to 1.4-3.2 kHz instead of
     * 1.9-5 kHz (below) and saturated through a diode curve; the boss's
     * octave-down sawtooth body keeps its darker 500-1400 band and, like the
     * width layer, stays clean.
     */
    const saturate = osc === 'tune' || osc === 'decor';
    return p
      /*
       * superdough's worklet maps duty as `(1 - pw) / 2`, so the 0.5 set above
       * is a 25% pulse — the NES melody duty, and the one whose 3rd and 5th
       * partials are strongest. That is why the decoration lines are pulses;
       * see `decor`.
       */
      /*
       * The envelope is `articulation.ts`'s, touch `sung`, applied at the
       * bottom of this function so it is the last writer.
       *
       * What was here: `attack(0.006)`, `decay(0.22)`, `sustain(held)` where
       * `held` is 0.55-0.78, and `release(sig.hold.range(0.34, 1.1))`. That is
       * a 6 ms onset and up to 1100 ms of tail on eighth notes 222 ms long -
       * FIVE melody notes overlapping, times three lines, times two to four
       * octave doublings, on the loudest pitched stem in the game
       * (`STEM_CURVES.lead` ceiling 0.95). Both of the owner's complaints come
       * out of that one pair of numbers: 6 ms is the "ping", 1100 ms is the
       * "drawn out".
       *
       * `sung` is 56-36 ms on and 210-160 ms off, which is the corpus median
       * (50 / 200) to within a few milliseconds, and it holds 80-88% of the
       * slot instead of all of it. One note still reaches the next; five no
       * longer stack.
       */
      /*
       * NO VIBRATO. This carried `.vib(vibRate).vibmod(vibDepth)`, and vibrato
       * is an acoustic-instrument gesture no dubstep lead has — it is also the
       * single thing that makes a triangle at A4 read as "a woodwind in a video
       * game", which is close to the owner's own words. `docs/research-dubstep.md`
       * §6.1.
       */
      /*
       * 4000 rather than 6500. Above about 4kHz a melody gains no pitch
       * information, only edge — the ear locates a note from its fundamental
       * and low harmonics, and everything above that is texture. Taking the
       * ceiling down loses nothing of the tune.
       */
      /*
       * The tune keeps the top; the doubling gets a body's worth and stops.
       *
       * 4000 was the ceiling and the argument for it stands — above about
       * 4 kHz a melody gains no pitch information, only edge. What was missing
       * is the FLOOR: at the mid openness the score spends most of its time
       * at, `range(1100, 4000)` evaluates to 2550 Hz, and a triangle at
       * 440-830 Hz behind 2550 keeps its 3rd partial and loses its 5th. That
       * is a flute with the lid on, and it is the other half of "dull".
       * 1900-5000 puts the 5th and 7th back at mid openness without moving the
       * top of the range far.
       */
      .lpf(isBody(osc) ? m.sig.openness.range(500, 1400) : m.sig.openness.range(1400, 3200))
      // Real boundaries; `thin` is 0 at full health, so both of these read 20 Hz
      // on every hap until the player is hit. 90 clears the boss octave (the
      // -24 saw bottoms at MIDI 45 = 110 Hz); 300 is under the triangle's
      // lowest fundamental of 440.
      .hpf(isBody(osc) ? m.sig.thin.range(90, 400) : m.sig.thin.range(300, 700))
      .lpq(m.sig.ring.range(1.3, 4))
      /*
       * distort(0.8) through 'diode' is about +5 dB (research §0.1 / R4);
       * distortvol(0.75) is squared by the gain curve to 0.56, -5 dB, so the
       * saturation changes the timbre and not the fader. The unsaturated
       * voices get distort(0) — a bypass in 1.3.0 — and distortvol(1), because
       * the postgain multiplies inside the worklet regardless of the amount
       * and 0.75 would have quietly cut them by 5 dB too.
       */
      .distort(saturate ? 0.8 : 0)
      .distorttype('diode')
      .distortvol(saturate ? 0.75 : 1)
      .gain(level)
      .pan(pan)
      .orbit(ORBIT_HARMONY);
  };

  /*
   * The melody's register follows the player up the screen — as a signal.
   *
   * This used to be added into `base`, so flying up the screen transposed every
   * pitch in the phrase and the rebuild key had to watch it. Applied here it
   * rides on the notes instead of defining them: `tools/retention.mjs` measured
   * a register flip leaving the melody with 33% of its phrase, and the whole
   * point of the feature — the tune climbing with the ship — is unchanged.
   *
   * `sig.register` is quantised to octaves in the director. A melody that slides
   * continuously with the ship is a theremin, not a tune.
   */
  const octave = (p: Pattern): Pattern => p.add(note(m.sig.register));

  /*
   * A breakdown is a highlight, not an absence.
   *
   * It used to be defined purely by what it removed — drums out, and the track
   * just got quieter. Here the melody instead opens right up: long tails, a big
   * room, heavy feedback. The moment the kit drops away is the moment the tune
   * is most exposed, so it should be the prettiest thing in the run.
   */
  /*
   * HUSHED joins the breakdown and the intro in getting the open treatment.
   *
   * All three are moments when nothing is shooting at the player, and the
   * source already calls the breakdown "the moment the tune is most exposed".
   * A hushed wave is that moment stretched over a whole stage, so it gets the
   * same long tails and the same big room rather than merely being quieter.
   */
  const open = m.section === 'breakdown' || m.section === 'intro' || m.movement === 'hush';
  /*
   * A descant, earned.
   *
   * Playing well fed exactly one thing: `flow`, a tension term. So a chained,
   * grazing, high-multiplier run made the music *darker and busier* — which is
   * the same direction being in trouble pushes it. Skill and danger were
   * pointing the same way, and the player had no way to hear the difference.
   *
   * Above a multiplier of eight the tune grows a second voice a sixth above it,
   * fading in with the combo rather than switching on. A sixth because it is
   * consonant against every degree these modes produce, so it thickens the line
   * without deciding anything harmonically — the melody stays the melody. It is
   * the oldest way there is to say "this is the good part", and it is the first
   * thing in this game that gets *better* rather than merely more intense.
   */
  const descant = clamp01(remap(m.combo, 8, 26, 0, 1));
  const lead = open ? 0.62 : 0.54;
  /*
   * Three lines per voice, not one, each on its own fader.
   *
   * The skeleton always sounds. The filigree never disappears — at rest it sits
   * a fifth of the way up as a ghost note — and the ornament fades in on top.
   * All three are the same notes at every intensity; only their balance moves.
   */
  /*
   * THE THREE LINES ARE THREE PLACES, not one place three times.
   *
   * All three used to take the trio's single `pan`, so the tune, its filigree
   * and its ornament were summed to one point. Measured off the rendered WAV
   * rather than off the written pans (`tools/widthcheck.mjs`, 32 bars, both
   * channels of the real file): the whole mix carries **4.13% side energy,
   * L/R correlation 0.918** — that is a mono file with a hint of width, and
   * the 500 Hz band, which this lane OWNS (58.6% of it), reads 4.56%.
   *
   * The skeleton stays at the trio's pan, because the tune belongs where the
   * arranger put it. The two decorative lines move a tenth of the field either
   * side of it. Same notes, same level, same count — the only thing that
   * changes is that three lines stop arriving from one speaker, which is the
   * cheapest separation available and the one this mix has none of.
   *
   * `clamp01`, because the boss stack calls this at 0.6 and the descant at
   * 0.62 and a pan outside 0..1 is not a wider pan.
   */
  /*
   * AND THREE TIMBRES, WHICH IS WHERE THE MIX'S AIR HAS TO COME FROM.
   *
   * Measured, and the measurement is the whole reason: rendered through the
   * real chain, the full mix carries **2.7% of its energy above 2 kHz** across
   * four octave bands. Reconstructed from the soloed stems, the 2 kHz band —
   * which is 86% of all of that — is **57% this lane**, 20% the bass and 15%
   * the chords. So "there is no air" is very largely a statement about the
   * melody's oscillator, and no filter can fix it: a triangle's harmonics fall
   * as 1/k squared, so at a fundamental of 440-830 Hz the 3rd partial is 19 dB
   * down and the 5th is 28 dB down BEFORE the lowpass is applied. Opening the
   * ceiling was tried in the commit above (1900-5000 from 1100-4000) and the
   * band moved 2.5% -> 2.8%. You cannot filter in what the source never made.
   *
   * A 25%-duty pulse falls as 1/k instead: 3rd partial -9.5 dB, 5th -14, 7th
   * -17. And its FUNDAMENTAL is within 0.9 dB of the triangle's at the same
   * gain ((4/pi)*sin(pi/4) = 0.900 against 8/pi^2 = 0.811), so this adds
   * harmonics without adding anything to the 500 Hz band the tune already
   * dominates. That is the property that makes it the right change rather than
   * simply a louder one.
   *
   * THE DECORATION FOLLOWS THE TUNE ONTO THE OBOE, AND IT WAS MEASURED BEFORE
   * IT MOVED — against the paragraph above, which is the only quantitative
   * handle this project has on brightness and which argues for the pulse.
   *
   * The first draft of this pass LEFT the two lines on the pulse and wrote out
   * a deferral: the air measurement says the 2 kHz band is 57% this lane and
   * that the pulse put it there, and `registermap`'s band model is a Fourier
   * series over a named waveform, so nothing here could say what a recording
   * does. Trading a measured property for a plausible one is the trade
   * `AGENTS.md` exists to refuse.
   *
   * `tools/fontcheck.mjs --spectrum` then settled it, decoding the real sample
   * and averaging five pitches across this lane's own window, MIDI 69-83:
   *
   *     source                    500     1k     2k     4k     8k   | >2 kHz
   *     gm_oboe                   3.7   58.3   34.7    3.4    0.0   |  38.1%
   *     pulse pw0.5 (theory)     32.9   39.7   16.2    5.9    3.7   |  27.4%
   *
   * The oboe is brighter than the pulse by half again, so the AIR objection is
   * gone. `leadDecor` is a separate role from `leadTune` purely so that the
   * fallback is right — a lane not playing its sample gets the 25%-duty pulse
   * the air measurement was taken on, not a second triangle.
   *
   * BOTH ROLES ARE CURRENTLY SWITCHED OFF (`SAMPLED_ROLES` in `soundfonts.ts`),
   * so this function plays the triangle and the pulse it always did. The oboe
   * was heard and rejected — "a foreground melody offa funny instrument it's
   * just no". The measurement above is kept because it is still true and is
   * what a re-enable would argue from, but it should be read for what it is: it
   * was never evidence that an oboe SUITS this game, only that it is not darker
   * than the pulse, which is a far smaller claim than the swap needed.
   *
   * The old argument, kept because it is the argument for the pulse if this is
   * ever revisited: the melody channels on an NES are the two PULSE channels
   * and the triangle is the bass, and giving a decorative line its own
   * instrument is what an arranger does with it.
   *
   * Only when the trio's own source is the tune's — the boss stack and the
   * octave-down body call this with `sawtooth`, and those are deliberately
   * dark (`isBody` gives them a 500-1400 Hz lowpass).
   */
  const decor = (osc: string): string => (osc === 'tune' ? 'decor' : osc);
  /* ==========================================================================
   * THE TRIO IS A DUO, AND OUTSIDE THE OPEN SECTIONS IT IS ONE LINE.
   * ==========================================================================
   *
   * "its got beats in the background, then a foreground melody offa funny
   * instrument it's just no." Read that as a description of a SHAPE and not of
   * a timbre — it is a rhythm section with a tune sitting on top of it, which
   * is a pop arrangement, and it is what this function built. Dubstep is not
   * that: the bass carries the hook and a lead, when there is one, answers it.
   *
   * WHAT WAS HERE. Three lines per call — skeleton on the even slots, filigree
   * on the odd ones, ornament on top — and `trio` was called TWICE
   * unconditionally, once on the tune and once an octave down on a sawtooth
   * "body". So an ordinary bar of ordinary play was SIX simultaneous melodic
   * lines, going to twelve during a boss and fifteen with a descant. The
   * melody's own stem also held the highest ceiling in `STEM_CURVES` (0.95).
   *
   * WHAT IS LEFT:
   *
   *   - THE SKELETON, always. `melodyForBar`'s own note says the even slots are
   *     the tune and "whatever a bar is *about* has to land on a beat", so the
   *     skeleton alone is not a fragment of the theme — it IS the motif, with
   *     the connective tissue taken out. Every bar of every theme still sounds;
   *     nothing has been masked out of the material, which is why `tune`,
   *     `motif` and `rondo` are measuring the same tables they always were.
   *   - THE FILIGREE, in the OPEN sections only — breakdown, intro and a HUSHED
   *     wave. Those are the three moments the arrangement exists to expose the
   *     tune ("the moment the kit drops away is the moment the tune is most
   *     exposed"), and they are the only places a continuous melodic line still
   *     belongs. Everywhere else the odd slots are rests, and the rests are
   *     what make this a motif rather than a line.
   *   - THE ORNAMENT IS DELETED. It was a third line at up to 55% of the
   *     tune's own level on the fourth slot of each group, which is the
   *     definition of decoration on a part that is no longer the subject.
   *
   * THE OCTAVE-DOWN SAWTOOTH BODY IS DELETED OUTRIGHT, and that is the single
   * biggest subtraction in this function. Its own comment above records what it
   * measured as: three sawtooth lines at MIDI 57-68 — 220-415 Hz, the motor's
   * octave and now the WOBBLE'S — with eleven harmonics reaching 2.5 kHz. A
   * "body" under the melody is an orchestration trick for a score whose melody
   * is the subject. Here the thing that needs the 200-400 Hz octave to itself
   * is the growl, and a doubling of the tune parked in it is the one collision
   * a fader cannot fix.
   */
  const duo = (transpose: number, level: number, osc: string, pan: number): Pattern[] => [
    voice(lines.skeleton, transpose, level, osc, pan),
    /*
     * THE FILIGREE'S FLOOR IS ZERO NOW, and that is the whole demotion of it.
     *
     * It used to sit at `range(level * 0.2, level)` — a fifth of the tune's
     * level even when the game was completely calm, rising to full — which is
     * what made the melody a continuous line rather than a motif: the odd
     * slots were always sounding.
     *
     * `range(0, level * 0.34)` in an ordinary section means a calm stage hears
     * the SKELETON ONLY, which is the motif, and a busy one grows the
     * connecting notes back at a third of the tune's level. `melodyForBar`'s
     * own note says the even slots are what a bar is about; this makes that
     * true of the mix and not only of the writing.
     *
     * The OPEN sections keep the old behaviour, because those three moments —
     * breakdown, intro, a HUSHED wave — exist to expose the tune and are the
     * only places a continuous melodic line still belongs.
     *
     * WHY THE VOICE IS UNCONDITIONAL RATHER THAN BEHIND `if (open)`, which is
     * how the first version of this was written: `tools/fontlanes.mjs` walks
     * every declared voice role in both soundfont and fallback mode and fails
     * a role that emits no haps at all — "a disabled role that emits nothing is
     * a silent lane". `leadDecor` has exactly one consumer and it is this line,
     * so gating the line on a section made the role unmeasurable in every state
     * the sweep visits. A gain that rides to zero is a fade; a line that is not
     * built is a lane the gates cannot see. This file prefers the fade
     * everywhere else for the same reason.
     */
    voice(
      lines.filigree,
      transpose,
      open ? m.sig.density.range(level * 0.2, level) : m.sig.density.range(0, level * 0.34),
      decor(osc),
      clamp01(pan - 0.14),
    ),
  ];
  /*
   * WIDTH, and where it is NOT applied.
   *
   * `tools/registermap.mjs` counted 9 of 15 voice groups sitting within 0.05
   * of centre, weighted by written gain, and the two loudest pitched groups in
   * the mix were both of these. The whole lead stack then had `.pan(0.5)`
   * applied to it at the end, which is a later-writes-win site: any per-voice
   * pan set here would have been silently erased by it. That line is gone.
   *
   * The TUNE stays dead centre and always will — a melody that wanders across
   * the field is a production effect, and the one lane a listener is following
   * is the last place to put one. The doubling that used to answer it at 0.40
   * is gone with the body; the descant at 0.62 and the boss weight below still
   * move, so the lane is not a single point source when it has more than one
   * voice in it.
   */
  const voices = [...duo(0, lead * 1.15, 'tune', 0.5)];
  /*
   * Width BEHIND the body: the same skeleton line, same octave, on the
   * supersaw at under half the body's level. It adds no second line — one
   * pattern, five detuned oscillators — and it is what makes a mono saturated
   * pulse read as a lead rather than a test tone. `docs/research-dubstep.md`
   * §6.2.
   */
  voices.push(voice(lines.skeleton, 0, lead * 0.5, 'supersaw', 0.5));
  /*
   * A boss is scored for LOW BRASS.
   *
   * The ordinary lead is a flute-ish tune with nothing under it now, and it is
   * unavoidably light. Playing the adversary's leitmotif on it would make the
   * biggest moment in the run sound like the smallest, so during a fight the
   * octaves come back: one saw an octave down and one two octaves down. That is
   * not a new melody — it is the same notes, three octaves deep, which is
   * exactly how the Imperial March is orchestrated and why it reads as mass
   * rather than as pitch.
   *
   * ONE LINE EACH, not a trio each. This used to push six voices and it now
   * pushes two, for the same reason the ordinary stack went from six to one:
   * the weight is the octave, not the note count. Deeper with each phase,
   * because a fight should get heavier as it goes and this costs nothing but a
   * gain.
   *
   * The `-24` saw bottoms at MIDI 45 = 110 Hz, which is inside the wobble's
   * own register, so it is quieter than it was: 0.24 rather than 0.30, and the
   * boss is the one place in the score where that collision is wanted — a
   * leitmotif and a growl in the same octave is what a boss should sound like.
   */
  if (m.boss) {
    voices.push(voice(lines.skeleton, -12, 0.34 + m.bossPhase * 0.08, 'sawtooth', 0.6));
    voices.push(voice(lines.skeleton, -24, 0.24 + m.bossPhase * 0.06, 'sawtooth', 0.42));
  }
  /*
   * THE DESCANT SURVIVES AS ONE LINE. It is the only thing in the game that
   * gets BETTER rather than merely more intense when the player plays well, and
   * that property is worth more than the voice it costs. It was a trio; a sixth
   * above the melody is the highest pitch in the mix and the last place that
   * wants three of anything.
   */
  if (descant > 0.02) voices.push(voice(lines.skeleton, 9, 0.3 * descant, 'tune', 0.62));
  return articulate(
    octave(stack(...voices))
      .delay(open ? 0.46 : 0.3)
      .delaysync(open ? 1 / 4 : 3 / 16)
      .delayfeedback(open ? 0.52 : 0.34)
      .room(m.sig.space.range(open ? 0.66 : 0.34, 0.95))
      /*
       * Not `open ? 8 : 4` any more. Same reason as the pad's: that
       * conditional rebuilt the harmony orbit's impulse response every time
       * a breakdown, an intro or a HUSHED wave began or ended. The opening
       * is entirely intact and lives in the three lines above this one -
       * the delay lengthens, the feedback rises and the room SEND goes
       * 0.34 -> 0.66, none of which touches the IR. See `ORBIT_ROOM`.
       */
      .roomsize(ORBIT_ROOM[ORBIT_HARMONY]),
    'sung',
    {
      // Eight eighth-note slots per bar; `melodyForBar` writes on that grid and
      // `HOLD` ties across it, so an eighth is the shortest note the tune has.
      slots: 8,
      bpm: m.bpm,
      shade: m.sig.drive,
      /*
       * `held` no longer sets `sustain` - it is the LENGTH dial, which is what
       * LASER and a SOLOIST wave were always reaching for. It ran 0.55 to 0.78,
       * so it maps to a ring of 1.0 to 1.36: a soloist's note holds a third
       * longer and lets go a third later, and `articulate` clamps `clip` at 1
       * so it can never exceed its slot. The vibrato depth still tracks `held`,
       * which keeps `leadcheck`'s "depth rises with sustain" assertion pointing
       * at the same coupling it always did.
       *
       * FERMATA (`sig.hold`) used to be the release's own range, 0.34 to 1.1
       * seconds, which is the single largest tail in this file after the pad's.
       * It is not read here at all any more - a rig ability that can add three
       * quarters of a second of overhang to the loudest lane in the game is the
       * defect wearing a feature's clothes. Its remaining home is the breakdown
       * and HUSHED, which open the room instead.
       */
      ring: 1 + (held - 0.55),
      /*
       * FERMATA. It used to be this lane's RELEASE range, 0.34-1.1 s; it is now
       * the note's LENGTH, which is what the ability's name says and what the
       * recalibrated tail ceiling permits. See `ArticulateOpts.hold`.
       */
      hold: m.sig.hold,
    },
  );
}

/**
 * Melodic material.
 *
 * Eight eighth-note slots per bar; `null` is a rest, and the rests are the
 * point. The previous version was eight even notes with no gaps, which is a
 * scale exercise rather than a tune — nothing to remember and nowhere to
 * breathe.
 *
 * A cell is one bar. Six of them make a theme, laid out as an eight-bar
 * PERIOD — see `cellForBar` for why that replaced a-a'-b-tag.
 *
 * Two things about the grid decide how these are written, and both are
 * consequences of how the melody is rendered rather than of taste:
 *
 * 1. EVEN SLOTS ARE THE TUNE. `melodyForBar` splits a cell into a skeleton on
 *    the even slots and a filigree on the odd ones, and the filigree is faded
 *    down to a fifth of its level when the game is calm. So whatever a bar is
 *    *about* has to land on a beat: the old themes put two thirds of their
 *    notes on offbeats and one of them was entirely offbeat, which meant its
 *    skeleton was empty and the bar all but vanished in a quiet passage.
 *    Written the other way round the fader stops being a volume control and
 *    becomes a musical one — the same tune plays plainly when calm and in
 *    eighth-note diminution when hot, which is what a player does.
 * 2. THE OFFBEATS MUST CONNECT. A filigree note sits between two skeleton
 *    notes, so it is written as a passing tone or a neighbour: a note that
 *    fills the frame in rather than a second idea competing with it.
 *
 * The rest is ordinary melodic writing, and it is what was missing: steps
 * mostly, one leap per idea answered by a step back the other way, a single
 * high point in the whole phrase, and an ending that arrives.
 *
 * Three of the six now arrive through a SUSPENSION, which is the most
 * characteristic cadential gesture there is and costs two notes to write. The
 * last note of bar 7 is a tone of the dominant; the downbeat of bar 8 sounds it
 * again over the tonic, where it is a dissonance; the next beat resolves it
 * down by step. Prepared, struck, resolved. It is why those cadences sound
 * arrived at rather than merely reached, and only three have it because a
 * cadence that is always the same gesture stops being a gesture.
 */
/**
 * A slot that CONTINUES the note before it, rather than sounding a new one.
 *
 * Duration used to be a side effect: `renderSlots` tied a note across the
 * following slots only when the CELL happened to leave them empty, and a
 * single empty slot was reserved for the arp to answer in. So the composer
 * could not choose a dotted quarter — they could only choose a rest and accept
 * whatever length fell out. Measured, that produced a score where 84% of the
 * tune's events were plain eighths and no theme contained a rhythmic figure.
 *
 * `HOLD` makes length a written decision, and since the fix below it is the
 * ONLY thing that decides length: the automatic tie is gone. It was added to
 * compensate for HOLD chains being truncated, so once they were honoured both
 * mechanisms fired at once and the tune filled every gap — measured rest fell
 * to 0% in all nine modes. Removing the tie put it back to 22% and changed no
 * other metric.
 *
 * `HOLD` makes length a written decision. `[0, HOLD, 2, null, ...]` is a
 * quarter note followed by an eighth and an eighth rest; the same cell without
 * it is two eighths. Nothing else changes: a HOLD is not a rest, so
 * `arpGapsFor` correctly refuses to let the arp play through a held note.
 *
 * A string rather than a symbol so the theme tables stay readable as data, and
 * so `erasableSyntaxOnly` has nothing to strip.
 */
export const HOLD = '_' as const;
export type Slot = number | null | typeof HOLD;

type Cell = readonly Slot[];

/** Two bars of it — the unit the development transforms work on. */
type Idea = readonly Slot[];

interface Theme {
  /**
   * Bars 1-2: the basic idea. Two bars of actual material, not one bar played
   * twice — see `cellForBar`. It comes back, developed, at bars 5-6.
   */
  a: Cell;
  a2: Cell;
  /** Bars 3-4: the contrasting idea. `b2` ends open, on the half cadence. */
  b: Cell;
  b2: Cell;
  /** Bars 7-8: the phrase's high point falling into the cadence, and the arrival. */
  c: Cell;
  tag: Cell;
}

/*
 * EIGHT themes — and the header here said "six" for long enough to be worth a
 * warning rather than a silent correction.
 *
 * The argument it made is still the right argument: each theme carries six
 * distinct bars instead of three, so a smaller table holds more written music
 * than a larger one did, and `tools/content.mjs` measured a five-minute run
 * reaching wave 8, at which point the late episodes of a big set are material
 * almost nobody hears. What the comment did not do was survive contact with
 * the table, which has eight entries.
 *
 * That is not a cosmetic slip, because `themeForWave` derives its cycle from
 * `THEMES.length - 1`: at eight entries an episode returns every FOURTEEN
 * waves, which is the exact interval this comment names as "too far apart to
 * recognise". The doc described the fix and the code kept the defect, and
 * reading either one alone would tell you the problem was solved.
 *
 * Left at eight deliberately rather than cut to six, because the recurrence
 * argument only bites for the EPISODES. The signature is `THEMES[0]` and
 * `themeForWave` returns it on every even wave, so the tune the run is built
 * on comes back every other wave no matter how long the table is; the episodes
 * are the contrast between statements of it. Deleting written music to make a
 * number smaller is the wrong direction, and shortening the cycle is a change
 * to `themeForWave`, not to the size of the table. Whoever takes that on
 * should read the recurrence note above `themeForWave` first — it is arguing
 * about a six-theme table that does not exist.
 */
export const THEMES: readonly Theme[] = [
  /*
   * THE REFRAIN — heard on every other period and on nothing else as often.
   * Holds the tonic, reaches up a third, walks back down. The answering phrase
   * starts a step higher and does the same, so bar 2 rhymes with bar 1. Cell:
   * a quarter and two eighths, in 6 of 8 bars. 86% gap-fill, 78% stepwise.
   */
  {
    a: [2, HOLD, HOLD, HOLD, 3, HOLD, 2, HOLD, 0, HOLD, HOLD, HOLD, null, null, null, null],
    a2: [4, HOLD, HOLD, HOLD, 3, HOLD, 2, HOLD, 0, HOLD, HOLD, HOLD, null, null, null, null],
    b: [1, HOLD, HOLD, HOLD, 0, HOLD, -1, HOLD, 2, HOLD, HOLD, HOLD, null, null, null, null],
    b2: [1, HOLD, 0, HOLD, 3, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    c: [6, HOLD, HOLD, HOLD, 5, HOLD, 4, HOLD, 7, HOLD, HOLD, HOLD, 6, HOLD, 5, HOLD],
    tag: [4, HOLD, HOLD, HOLD, 3, HOLD, 2, HOLD, 0, HOLD, null, null, null, null, 0, HOLD],
  },
  /*
   * MARCHING. A quarter on the downbeat then four eighths — the Frog's Theme
   * shape. Opens with a reach up a fourth and spends the phrase walking home.
   * 100% gap-fill, 82% stepwise.
   */
  {
    a: [0, HOLD, HOLD, HOLD, 4, HOLD, 3, HOLD, 2, HOLD, 3, HOLD, null, null, null, null],
    a2: [4, HOLD, HOLD, HOLD, 5, HOLD, 6, HOLD, 3, HOLD, 4, HOLD, null, null, null, null],
    b: [5, HOLD, HOLD, HOLD, 6, HOLD, HOLD, HOLD, 5, HOLD, HOLD, HOLD, 4, HOLD, HOLD, HOLD],
    b2: [3, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, null, null, null, null],
    c: [0, HOLD, HOLD, HOLD, 1, HOLD, 2, HOLD, 7, HOLD, 6, HOLD, null, null, null, null],
    tag: [4, HOLD, HOLD, HOLD, 0, HOLD, null, null, null, null, null, null, null, null, 1, HOLD],
  },
  /*
   * LILTING. A dotted quarter, a passing eighth, then a quarter — long-short-
   * medium, which is as close to a swing as an eighth grid can express. True
   * syncopation needs 16 slots; see the note above renderSlots. 75% / 83%.
   */
  {
    a: [0, HOLD, HOLD, HOLD, HOLD, HOLD, 1, HOLD, 4, HOLD, HOLD, HOLD, null, null, null, null],
    a2: [3, HOLD, HOLD, HOLD, HOLD, HOLD, 2, HOLD, 1, HOLD, HOLD, HOLD, null, null, null, null],
    b: [0, HOLD, HOLD, HOLD, HOLD, HOLD, 1, HOLD, 3, HOLD, HOLD, HOLD, null, null, null, null],
    b2: [2, HOLD, HOLD, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    c: [2, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, 7, HOLD, HOLD, HOLD, 6, HOLD, null, null],
    tag: [4, HOLD, HOLD, HOLD, HOLD, HOLD, 2, HOLD, 0, HOLD, null, null, null, null, 0, -1],
  },
  /*
   * SPARSE. Half notes and quarters, three notes to a bar, the most air of the
   * nine. This is the one that breathes, and it is deliberately the least busy
   * thing in the game. 100% gap-fill, 81% stepwise.
   */
  {
    a: [0, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, 2, HOLD, HOLD, HOLD],
    a2: [3, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, 2, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD],
    b: [0, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, -1, HOLD, HOLD, HOLD, -2, HOLD, HOLD, HOLD],
    b2: [-1, HOLD, 0, HOLD, 0, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, null, null, null, null],
    c: [0, HOLD, HOLD, HOLD, -1, HOLD, HOLD, HOLD, 5, HOLD, 4, HOLD, 3, HOLD, HOLD, HOLD],
    tag: [2, HOLD, 1, HOLD, 0, HOLD, HOLD, HOLD, 0, HOLD, null, null, null, null, -3, -2],
  },
  /*
   * DRIVING. The busiest: an eighth, a quarter, an eighth, a quarter, and a
   * reach up a fourth in every bar answered by a step back. Leap-heavy on
   * purpose — the other eight are conjunct. 100% gap-fill, 79% stepwise.
   */
  {
    a: [2, HOLD, HOLD, HOLD, 3, HOLD, null, null, 4, HOLD, HOLD, HOLD, null, null, null, null],
    a2: [5, HOLD, HOLD, HOLD, 4, HOLD, null, null, 3, HOLD, HOLD, HOLD, null, null, null, null],
    b: [4, HOLD, HOLD, HOLD, 5, HOLD, null, null, 6, HOLD, HOLD, HOLD, null, null, null, null],
    b2: [5, HOLD, HOLD, HOLD, 5, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    c: [2, HOLD, HOLD, HOLD, 1, HOLD, null, null, 7, HOLD, HOLD, HOLD, 6, HOLD, null, null],
    tag: [4, HOLD, HOLD, HOLD, 2, HOLD, null, null, 0, HOLD, null, null, null, null, 0, HOLD],
  },
  /*
   * GALLOP. Two eighths then a quarter, repeated — a lopsided lurch that never
   * quite settles. 100% gap-fill, 72% stepwise, the most leap-tolerant of the set.
   */
  {
    a: [0, HOLD, 1, HOLD, 4, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, null, null, null, null],
    a2: [2, HOLD, 3, HOLD, 5, HOLD, HOLD, HOLD, 4, HOLD, HOLD, HOLD, null, null, null, null],
    b: [3, HOLD, 4, HOLD, 1, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    b2: [2, HOLD, 1, HOLD, 4, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, null, null, null, null],
    c: [3, HOLD, 2, HOLD, 1, HOLD, HOLD, HOLD, 7, HOLD, 6, HOLD, 3, HOLD, HOLD, HOLD],
    tag: [4, HOLD, 3, HOLD, 2, HOLD, HOLD, HOLD, 0, HOLD, null, null, null, null, -1, HOLD],
  },
  /*
   * THE PLAINEST. Even quarters, one to a beat, no rhythmic trick at all. It has
   * to earn its keep on contour alone, which makes it the hardest of the nine to
   * write and the right shape for the calm theme. 100% gap-fill, 80% stepwise.
   */
  {
    a: [0, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, 0, HOLD, HOLD, HOLD, HOLD, HOLD, 1, HOLD],
    a2: [4, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, 2, HOLD, HOLD, HOLD, HOLD, HOLD, 1, HOLD],
    b: [4, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, 4, HOLD, HOLD, HOLD, HOLD, HOLD, 5, HOLD],
    b2: [2, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, null, null, null, null],
    c: [2, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, 7, HOLD, HOLD, HOLD, 6, HOLD, null, null],
    tag: [4, HOLD, HOLD, HOLD, 2, HOLD, HOLD, HOLD, 0, HOLD, null, null, null, null, 0, -1],
  },
  /*
   * THE ARCH. Defined by shape rather than rhythm: rises through the antecedent,
   * turns at bar 3 and falls home. Four distinct note lengths, the most of any.
   * 100% gap-fill, 74% stepwise — squarely in the canon band.
   */
  {
    a: [0, HOLD, HOLD, HOLD, 1, HOLD, 2, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    a2: [2, HOLD, HOLD, HOLD, 3, HOLD, 4, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    b: [4, HOLD, HOLD, HOLD, 5, HOLD, 3, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    b2: [0, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, null, null],
    c: [2, HOLD, HOLD, HOLD, 1, HOLD, HOLD, HOLD, 7, HOLD, HOLD, HOLD, 6, HOLD, null, null],
    tag: [4, HOLD, HOLD, HOLD, 2, HOLD, HOLD, HOLD, 0, HOLD, null, null, null, null, -1, HOLD],
  },
];

/**
 * THE ADVERSARY — the boss leitmotif.
 *
 * Kept out of `THEMES` on purpose. The rondo rotates through those and puts the
 * signature on every even wave, so anything in that array is something the
 * player hears while doing ordinary things. This one is heard ONLY during a
 * boss fight, which is what makes it a leitmotif rather than a seventh tune:
 * the first two bars are enough to tell you what has just walked on stage.
 *
 * It is written in `harmonicMinor` (see `theory.ts`) and it is built from the
 * three gestures every villain theme in this idiom is built from — the Imperial
 * March, Magus, Wily's castle, every Castlevania stage:
 *
 * 1. THE HAMMER. Bar 1 is the tonic struck three times on the beat and then a
 *    leap to the flat sixth. Repeated notes are the most menacing rhythm there
 *    is because they are not going anywhere: the tune refuses to move, and then
 *    moves all at once. No other theme in this game opens on a repeated note.
 *
 * 2. THE DESCENDING TETRACHORD. Bars 3-4 walk 5 - 4 - b3 - 2, the lament figure
 *    that has meant exactly one thing since Purcell. It goes DOWN, in step,
 *    without hurrying, which is the opposite of everything else in this score.
 *
 * 3. THE LEADING TONE. The tag falls to the semitone *below* the tonic (degree
 *    -1 — `degreeToSemitone` handles the negative octave) and is pulled back up
 *    into it. That semitone only exists because harmonic minor raises the
 *    seventh, and it is the reason this mode is here: every other mode in this
 *    game darkens by taking tension away, and this one darkens by adding a
 *    pull. The boss theme is the only music in the run that actually resolves.
 *
 * The peak is bar 7 at the octave, same as every theme here — that is the
 * period's shape rather than any one tune's, and a leitmotif that broke it
 * would sit oddly against everything around it.
 */
// Exported so `tools/tune.mjs` and `tools/churn.mjs` can analyse it alongside
// the ladder themes. `clash.mjs` reads it as text and does not need this.
export const BOSS_THEME: Theme = {
  a: [0, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, 1, HOLD, 2, HOLD, 4, HOLD, null, null],
  a2: [5, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, 4, HOLD, 3, HOLD, 2, HOLD, null, null],
  b: [5, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, 4, HOLD, 3, HOLD, 6, HOLD, null, null],
  b2: [5, HOLD, HOLD, HOLD, 4, HOLD, HOLD, HOLD, 3, HOLD, HOLD, HOLD, null, null, null, null],
  c: [1, HOLD, HOLD, HOLD, HOLD, HOLD, null, null, 7, HOLD, 6, HOLD, 3, HOLD, 4, HOLD],
  tag: [2, HOLD, HOLD, HOLD, -1, HOLD, HOLD, HOLD, 0, HOLD, null, null, null, null, 0, -1],
};

/*
 * The cell, rendered three ways, none of which knows anything about the game.
 *
 * There used to be one renderer taking a `density`, and it used that density to
 * DELETE notes below 0.34 and to ADD an ornament above 0.78. Both are edits to
 * the material, so crossing either threshold replaced the phrase: measured with
 * `tools/retention.mjs`, one step of the intensity dial left the melody with
 * 50% of its notes.
 *
 * Splitting it into a skeleton, its filigree and its ornament — each a pure
 * function of (cell, base, mode) — lets the same three patterns exist at all
 * times with the density riding their gains instead. Calm no longer removes the
 * weak beats, it plays them as ghost notes, which is what a player does and is
 * a fade rather than a cut.
 */
/**
 */
function renderSlots(
  m: Cell,
  base: number,
  mode: ModeName,
  keep: (i: number) => boolean,
): string {
  /** True while the note currently sounding belongs to THIS line. */
  let mine = false;
  return m
    .map((d, i) => {
      if (typeof d === 'number') {
        if (keep(i)) {
          mine = true;
          return String(base + degreeToSemitone(mode, d));
        }
        // The other line just took the note; anything held after it is theirs.
        mine = false;
        return '~';
      }
      /*
       * A written HOLD extends whatever this line last sounded. It belongs to
       * the note before it, so it only applies on the line that played that
       * note — on the other line it is somebody else's business and renders as
       * a rest, exactly as a note in that slot would.
       */
      /*
       * `mine`, not `keep(i - 1)`.
       *
       * The old test looked back exactly ONE slot, so a HOLD only extended a
       * note when the slot behind it was also kept by this line. Since the
       * skeleton keeps alternating slots, that made the SECOND link of every
       * chain fail: `[0, HOLD, HOLD, ...]` — a written dotted quarter —
       * rendered `60 _ ~`, silently becoming a quarter plus a rest. Every note
       * written longer than two slots was shortened, on the 8-slot grid as
       * well as at 16; widening the grid only made the chains longer and the
       * damage more visible.
       *
       * Ownership is the real question: this line owns the sounding note until
       * a note it does NOT play takes over, or a rest ends it.
       *
       * Proven separately from the 16-slot change: applying this fix alone to
       * the old grid reproduced all 249 differing rows, after which the grid
       * swap itself was byte-identical across 3456 states.
       */
      if (d === HOLD) return mine ? HOLD : '~';
      // A written rest ends the note, so a later HOLD cannot reach back over it.
      mine = false;
      return '~';
    })
    .join(' ');
}

/*
 * ---------------------------------------------------------------------------
 * `renderOrnament` IS DELETED, and this is what it was.
 * ---------------------------------------------------------------------------
 *
 * A third melodic line: a grace note on the second half of the fourth slot of
 * each group, choosing its neighbour by where the tune went next — below the
 * note when the line was about to rise, above it when it fell. It was good, and
 * the reason it is not here any more has nothing to do with its quality.
 *
 * It was the THIRD simultaneous line of a melody that is now a sparse motif at
 * about a tenth of its former level (`buildLead`, and `STEM_CURVES.lead`). A
 * decoration on a decoration is what "too much bing bong" is; and once
 * `buildLead` stopped calling it, `melodyForBar` was returning a field nobody
 * read, which is AGENTS.md §3's "unmeasured properties rot" waiting to happen.
 *
 * Deleted rather than left dangling on purpose. Its one non-obvious lesson is
 * worth keeping without the code: the grace note is written as `[~ n]` on its
 * OWN eight-token line rather than as `[n n+1]` inside the tune's, so it can
 * come and go without altering the length of the note it decorates. If a stab
 * or a siren ever wants a lead-in, that is the shape to write it in.
 */

/* ---------------------------------------------------------------------------
 * Motivic development.
 *
 * This is the difference between a generated loop and something that sounds
 * composed. Rather than repeating a phrase forever, a small cell is put through
 * classical transformations — transposition, inversion, retrograde,
 * augmentation, fragmentation, rhythmic displacement — and which transformation
 * applies is a function of *which phrase of the run you are in*. So the tune is
 * recognisably the same tune ten phrases later, and recognisably not identical.
 *
 * Beethoven is the reference for the technique (four notes, an entire
 * symphony); the Grateful Dead are the reference for never playing it the same
 * way twice.
 *
 * Two things changed about how they are applied, and both were breaking the
 * material they were supposed to be developing.
 *
 * They now transform the two-bar IDEA rather than each bar on its own. A
 * retrograde of one bar, then a retrograde of the next bar, is not a retrograde
 * of the idea — it is two local reversals that leave the idea's own shape
 * exactly where it was. The unit of development has to be the unit of meaning.
 *
 * And they preserve the beat. `retrograde` mapped slot i to slot 7-i and
 * `displace` pushed everything one slot late; both send every on-beat note to
 * an offbeat, which empties the skeleton (see the note above the themes) and
 * silences the variation the moment the game is calm. Reversing about a
 * half-beat later, and displacing by a whole beat, are the same devices with
 * the downbeats intact.
 * ------------------------------------------------------------------------- */

type Transform = (c: Idea) => Idea;

/** Move every note up or down the scale. */
// Transforms carry HOLD through untouched: it is a duration, not a pitch, so
// transposing or inverting one is meaningless and would corrupt the rhythm.
const transposeIdea = (n: number): Transform => (c) => c.map((d) => (typeof d === 'number' ? d + n : d));

/** Flip the contour around its first note: what went up now goes down. */
const invertIdea: Transform = (c) => {
  const pivot = c.find((d): d is number => typeof d === 'number') ?? 0;
  return c.map((d) => (typeof d === 'number' ? pivot - (d - pivot) : d));
};

/**
 * Play it backwards. Reversed about slot 7 rather than slot 7.5, so a note on a
 * beat comes back on a beat.
 */
// Offset 4, not 2: the constant is a number of SLOTS and a slot is now half
// as long, so preserving the musical offset means doubling it.
const retrogradeIdea: Transform = (c) => c.map((_, i) => c[(c.length - 4 - i + c.length) % c.length]);

/** Half speed: the first bar stretched over both. Adds weight. */
const augmentIdea: Transform = (c) => {
  const out: Slot[] = [];
  // Each slot becomes a slot plus a HOLD, which is what "half speed" means now
  // that a continuation can be written down. It used to push a null, which
  // made the stretched note depend on the tie rule finding a long enough gap.
  for (let i = 0; i < c.length / 2; i++) out.push(c[i] ?? null, c[i] === null || c[i] === undefined ? null : HOLD);
  return out;
};

/** Say the first bar twice. Insistent — the "and again" gesture. */
const fragmentIdea: Transform = (c) => [...c.slice(0, c.length / 2), ...c.slice(0, c.length / 2)];

/** Push the whole line a beat late, so it lands across the beat it was on. */
// Four slots — a quarter note — for the same reason as `retrogradeIdea`.
const displaceIdea: Transform = (c) => [null, null, null, null, ...c.slice(0, c.length - 4)];

/*
 * Transpositions go DOWN, with one exception.
 *
 * The phrase has exactly one high point, at bar 7, and that is most of what
 * gives it a shape. Bars 5-6 are a restatement of the opening, so transposing
 * them up a third puts a second note at the same height in the middle of the
 * phrase — and on the themes that already reach the sixth degree it goes over
 * the top of the apex entirely, which is both a flatter shape and a higher
 * ceiling in a project whose standing complaint is "too much high pitch
 * synth". Restating an idea lower is just as much a development and it leaves
 * the climax where it was written.
 */
const DEVELOPMENTS: readonly Transform[] = [
  transposeIdea(-2),
  invertIdea,
  fragmentIdea,
  transposeIdea(-1),
  retrogradeIdea,
  displaceIdea,
  augmentIdea,
  transposeIdea(1),
];

/**
 * The eight-bar period, and where the tune is allowed to change.
 *
 * This was `a - a' - b - tag`, two bars each. Two bars each meant the SAME
 * one-bar cell played twice before anything new happened, so the longest run of
 * new material anywhere in the tune was one bar — a shorter loop than the pop
 * writing this was supposed to be an alternative to. Worse, the development
 * transform was picked per two-bar section, so a single phrase could open with
 * an inversion and answer it with a retrograde: two different transformations
 * of one cell standing next to each other do not read as statement and answer,
 * they read as unrelated.
 *
 * It is now a parallel period, which is what a classical eight-bar sentence
 * actually is:
 *
 *     bars 1-2  basic idea            two bars of material
 *     bars 3-4  contrasting idea      ends open — the question
 *     bars 5-6  basic idea, developed the same opening, somewhere new
 *     bars 7-8  high point, cadence   the answer, and it closes
 *
 * so the tune states something, asks, says it again, and finishes — over eight
 * bars, against a harmony that changes every two (see `PROGRESSIONS`).
 *
 * Exactly one slot in the phrase is the variation slot. The opening two bars
 * are literal every single time, because that is what makes a theme a theme,
 * and the cadence is literal every time, because a refrain that closes
 * differently on each repeat never teaches anyone where the end is. Bars 5-6
 * carry the development, and being the third and fourth hearing of an idea is
 * exactly where a variation belongs.
 */
function developmentFor(phrase: number): Transform {
  // The statement is left alone for the first two phrases so the listener
  // learns it before it starts changing. You cannot develop a theme nobody has
  // heard yet.
  if (phrase < 2) return (c) => c;
  return DEVELOPMENTS[(phrase - 2) % DEVELOPMENTS.length];
}

/**
 * The developed cell for a given bar, before rendering.
 *
 * Split out from `melodyForBar` so the arp can see where the melody's rests
 * are and play into them. That is what turns two independent parts into
 * counterpoint — and it means the arp's rhythm is *derived* from the tune
 * rather than being a second thing happening at the same time.
 */
export function cellForBar(theme: Theme, phrase: number, barInPhrase: number): Cell {
  switch (barInPhrase) {
    case 0:
      return theme.a;
    case 1:
      return theme.a2;
    case 2:
      return theme.b;
    case 3:
      return theme.b2;
    case 4:
    case 5: {
      const idea = developmentFor(phrase)([...theme.a, ...theme.a2]);
      const half = idea.length / 2;
      return barInPhrase === 4 ? idea.slice(0, half) : idea.slice(half);
    }
    case 6:
      return theme.c;
    default:
      return theme.tag;
  }
}

/**
 * One bar of the period, rendered as its three layers.
 *
 * `phrase` advances every eight bars and is the only thing that varies between
 * one statement of a theme and the next.
 */
export function melodyForBar(
  theme: Theme,
  phrase: number,
  barInPhrase: number,
  base: number,
  mode: ModeName,
): { skeleton: string; filigree: string } {
  const cell = cellForBar(theme, phrase, barInPhrase);
  return {
    /*
     * A bar is 16 slots now, not 8, so the skeleton owns slots 0-1 of each
     * group of four and the filigree owns 2-3. Doubling the grid is what makes
     * a sixteenth expressible at all, which three rules in `tools/tune.mjs`
     * were waiting on: an anacrusis needs somewhere to sit inside the last
     * beat, syncopation needs a note to land off it, and a leap needs room to
     * resolve before the bar ends.
     *
     * The existing tables were mechanically doubled — every note became a note
     * plus a HOLD — so this change is a pure container swap and
     * `tools/leadfreeze.mjs` proves it: 3456 rendered states, byte-identical.
     */
    skeleton: renderSlots(cell, base, mode, (i) => i % 4 < 2),
    filigree: renderSlots(cell, base, mode, (i) => i % 4 >= 2),
    /*
     * THE ORNAMENT IS GONE — see the tombstone above `renderSlots`'s
     * neighbour helper, which went with it.
     */
  };
}

/**
 * The arp's rhythm: the melody's silences, PLUS the downbeat.
 *
 * The interlocking is good and it stays. Where the tune rests the arp answers,
 * where the tune sings the arp gets out of the way, and the reasoning behind it
 * was sound: the arp used to be a constant six-note figure running underneath
 * everything, which is why it had to be mixed to 0.15 to stop it fighting the
 * lead, which is what made it decoration rather than a part.
 *
 * But taken literally — `cell.map(d => d === null)` — it made the two lines an
 * exact set-complement, and that has a consequence nobody intended: **the two
 * voices never articulate together, anywhere, ever.** The score contained
 * structurally zero simultaneous counterpoint. Not "not much"; none. Two parts
 * taking strict turns is antiphony, which is a real texture and not the one the
 * canon runs on — Bloody Tears' second pulse moves *with* its melody, and
 * Pokémon's chromatic inner voice buzzes underneath the tune rather than
 * between its notes.
 *
 * The fix is one slot, and it is the one slot that always sounds intentional.
 * On the DOWNBEAT both voices speak together. That is how an ensemble locks: a
 * bar starts with everyone agreeing where it starts, and every other beat is
 * where they can disagree interestingly. It gives the arrangement a point of
 * simultaneity per bar without reopening the masking problem the interlocking
 * was invented to solve.
 *
 * It is only safe now because of `Signals.arpOctave`: when the lead is present
 * the arp drops an octave and stops sitting in the tune's register. Making this
 * change before that existed would have put two voices on the same note at the
 * same instant, which is not counterpoint — it is one thicker voice.
 */
export function arpGapsFor(cell: Cell): boolean[] {
  /*
   * Sampled on the beats, returning eight, for the same reason the ornament
   * does: the arp is its own line at its own subdivision, and answering a
   * sixteenth grid would double its density. A HOLD is not a gap — the melody
   * is still sounding through it — and a doubled rest lands `null` on the even
   * slot, so reading the even slots alone gets both cases right.
   */
  const beats = cell.filter((_, i) => i % 2 === 0);
  return beats.map((d, i) => d === null || i === 0);
}

/**
 * Section furniture: risers, impacts, fills. This is the layer that makes the
 * track sound arranged rather than looped.
 */
export function buildFx(m: MusicalState): Pattern {
  const parts: Pattern[] = [];

  /*
   * A TIMPANI ROLL, not a noise riser.
   *
   * This used to be `riser(m.sig.build)` — a white-noise uplifter — plus an
   * accelerating snare roll whose own comment called it "the oldest trick in
   * EDM". Both are correct about the genre and both are why a build announced
   * itself as a dance-music build. There is no white-noise uplifter anywhere in
   * the 8- and 16-bit canon; the hardware could not have made one and the idiom
   * has no use for it.
   *
   * What an orchestra does instead is a TIMPANI ROLL: a pitched low drum,
   * tremolo, crescendoing into the downbeat. It is the same gesture — pressure
   * accumulating toward an arrival — built from a note rather than from noise,
   * and it is everywhere in the music this score is aiming at.
   *
   * It rolls on the TONIC, so the build states the key it is arriving in rather
   * than smearing across the spectrum. That is the other half of what a riser
   * throws away: a noise sweep tells you something is coming, a timpani roll
   * tells you what.
   *
   * The subdivision accelerates exactly as the snare roll did, because that part
   * was right — it is how a roll tightens. Only the source changed.
   */
  if (m.section === 'build') {
    const rollDiv = m.buildProgress < 0.4 ? 4 : m.buildProgress < 0.7 ? 8 : 16;
    parts.push(
      note(`${m.tonic - 24}*${rollDiv}`)
        .s('sine')
        // A struck skin, not a tone: fast attack, short body, pitch dropping
        // away as the head relaxes. The same recipe as the kick, tuned lower
        // and hit far more softly.
        .attack(0.002)
        .decay(0.11)
        .sustain(0)
        .penv(5)
        .pdecay(0.05)
        .pcurve(1)
        .lpf(320)
        // The crescendo is the whole gesture; a roll at constant level is a
        // texture, and a roll that grows is a build.
        /*
         * DECRESCENDO, NOT CRESCENDO. This was `0.06 + buildProgress * 0.2`,
         * a roll that got louder as the build went on — an orchestral gesture
         * in a section whose whole job, in this genre, is to take things away
         * (`docs/research-dubstep.md` R10, §6.1). The roll now starts present
         * and thins out, so that by the last bar the riser is nearly alone and
         * the drop's downbeat arrives into space rather than into a climax.
         */
        .gain(0.22 - m.buildProgress * 0.18)
        .room(0.3)
        /*
         * ON THE DRUM ORBIT, NOT THE LOW ONE. It is a timpani: a struck skin
         * with a pitch envelope, built from the same recipe as the kick. It
         * sat on `ORBIT_LOW` asking for a room three sizes bigger than the
         * bass's, which is one of the disagreements `reverbchurn` counts.
         * The drum orbit's room is the 5 this line already wanted.
         */
        .roomsize(ORBIT_ROOM[ORBIT_DRUMS])
        .orbit(ORBIT_DRUMS),
    );
  }

  /*
   * A CYMBAL, not a downlifter.
   *
   * The impact stays — a hit on the downbeat of a new section is universal, and
   * every score in the canon marks a big arrival with a crash. What goes is the
   * downlifter that sat under it: white noise with its cutoff swept from 9kHz
   * down to 300Hz over a bar. That sweep is a pure dance-production object, it
   * has no acoustic counterpart, and the comment defending it — "a riser
   * without a fall is only half the gesture" — was reasoning inside the idiom
   * we are leaving. There is now no riser for it to answer either.
   *
   * A crash cymbal does the same structural work: it says THIS BAR, loudly,
   * and then decays out of the way over a couple of seconds instead of dragging
   * a filter sweep across everything the arrangement is trying to state.
   */
  if (m.section === 'drop' && m.barInPhrase === 0) {
    parts.push(impact(0.6));
    parts.push(
      s('white')
        .struct('x ~ ~ ~')
        // Long, bright, and left to ring. A cymbal is defined by its decay —
        // shorten this and it becomes a hi-hat.
        .attack(0.001)
        .decay(1.8)
        .sustain(0)
        // Band-limited high rather than swept: cymbals live in a fixed region
        // and get darker as they decay, which the amplitude envelope already
        // implies. A moving cutoff is what made the old version read as a
        // studio effect rather than as an instrument.
        .hpf(3800)
        .lpf(11000)
        .hpq(0.8)
        .gain(0.13)
        .room(0.45)
        .roomsize(ORBIT_ROOM[ORBIT_AIR])
        .pan(0.44)
        .orbit(ORBIT_AIR),
    );
  }

  if (m.section === 'fill') {
    // An actual drum fill: accelerating snare into a crash.
    parts.push(
      s('white*16')
        .ds('0.045:0')
        .hpf(1600)
        .lpf(11000)
        .velocity('0.5 0.7 0.85 1')
        .gain(0.2)
        .orbit(ORBIT_AIR),
      s('white')
        .struct('~ ~ ~ x')
        .clip(1)
        .ds('0.9:0')
        .hpf(3800)
        .gain(0.24)
        .room(0.6)
        .roomsize(ORBIT_ROOM[ORBIT_AIR])
        .orbit(ORBIT_AIR),
    );
  }

  if (m.fillBar && m.section !== 'build' && m.section !== 'collapse' && m.section !== 'fill') {
    parts.push(s('white*8').ds('0.04:0').hpf(3000).gain(0.14).orbit(ORBIT_AIR));
  }

  // Nearly dead: a slow sub heartbeat under everything. This is deliberately
  // the same information the HUD shows, in a channel the player is already
  // paying attention to — you feel your health before you read it.
  if (m.health < 0.34) {
    const urgency = clamp01((0.34 - m.health) / 0.34);
    parts.push(
      note(seq([m.tonic - 24]))
        .struct(urgency > 0.55 ? 'x ~ x ~' : 'x ~ ~ ~')
        .s('sine')
        .penv(14)
        .pdecay(0.14)
        .pcurve(1)
        .decay(0.3 + urgency * 0.2)
        .sustain(0)
        .gain(0.24 + urgency * 0.22)
        .orbit(ORBIT_LOW),
    );
  }

  /*
   * The graze shimmer.
   *
   * Grazing is the game's highest-skill act — deliberately flying close enough
   * to a bullet to feel it — and until now it paid only in score, which is a
   * number in a panel. A bright bell figure that only exists while you are
   * threading fire makes skill audible, and it is the one layer a player can
   * summon purely by playing well.
   */
  if (m.grazeRate > 1.2) {
    const heat = clamp01(remap(m.grazeRate, 1.2, 8, 0, 1));
    const top = m.chord.notes.map((n) => n + 24);
    parts.push(
      note(seq([top[0], top[2] ?? top[0], top[1] ?? top[0], (top[2] ?? top[0]) + 5]))
        .s('sine')
        .fm(2.5)
        .fmh(3.01)
        .ad('0.002:0.14')
        .sustain(0)
        .hpf(1800)
        .delay(0.34)
        .delaysync(1 / 8)
        .delayfeedback(0.42)
        .room(0.5)
        .gain(0.05 + heat * 0.09)
        .pan(0.62)
        .orbit(ORBIT_AIR),
    );
  }

  if (m.section === 'collapse') {
    parts.push(
      s('white')
        .struct('x')
        .clip(1)
        .ds('1.6:0')
        .lpf(m.sig.openness.range(120, 1800))
        .gain(0.3)
        .room(0.7)
        .orbit(ORBIT_AIR),
    );
  }

  return parts.length ? stack(...parts) : silence;
}

// ---------------------------------------------------------------------------
// enemy motifs — the battlefield, audible
// ---------------------------------------------------------------------------

interface Motif {
  archetype: EnemyArchetype;
  /** Higher wins when we run out of motif slots. */
  priority: number;
  /**
   * How this leitmotif is PLAYED, as data beside the priority rather than as
   * five envelope calls inside `build`.
   *
   * Three of these voices used to carry a near-identical hand-written triple
   * (`attack(0.012).ds('0.13:0.12').release(0.22)` and two variants of it),
   * written three times, each with its own copy of the same eleven-line comment
   * explaining why. Two more set `.ds()` alone and so inherited superdough's
   * grouped defaults - a 1 ms attack and a 10 ms release - which is the trap
   * AGENTS.md 4 records and which `attackfloor` reported as "23% no-attack,
   * 30% no-release" on this stem.
   *
   * Declaring it here means the table can be READ as an orchestration: which
   * archetype is struck, which is bowed, which is a transient with no body.
   */
  touch: TouchName | null;
  /**
   * Subdivisions of the bar this motif's fastest note occupies. Ignored when
   * `touch` is null.
   */
  slots: number;
  build(m: MusicalState, count: number): Pattern;
}

/**
 * At most this many enemy motifs sound at once. Without a cap, a swarm wave
 * turns the mix into noise and the information the motifs carry is lost — which
 * defeats the purpose of having them.
 *
 * ---------------------------------------------------------------------------
 * THREE -> TWO, and this is the cheapest half of the voice-count problem.
 * ---------------------------------------------------------------------------
 *
 * `orchestration.ts` opens by naming "nine unrelated melodies at once" as the
 * honest worst case and builds a budget of TONAL LANES to fix it. But `motifs`
 * is ONE lane holding up to three independent ostinatos, so winning a single
 * slot in that budget bought three lines — and the budget could not see it.
 * The owner's report is the arithmetic read back: "why are there multiple
 * conflicting melodies and theyre all on different tempos too, very confusing".
 * They ARE on different tempos: `glissando` is a `seq` of two, `stutter` is
 * `*4`/`*8`/`*16` chosen by enemy count, and the others have their own
 * subdivisions again.
 *
 * Two is the number a counter-lane can be and still be counterpoint. Three
 * lines against a tune and a comp is five parts, which is more than the ear
 * follows and more than the SNES could physically play — the constraint this
 * whole file argues the score should be imitating.
 *
 * It costs INFORMATION, and that cost is real rather than hand-waved: the
 * motifs are how the stage is audible, so a third archetype on screen is now
 * silent instead of quiet. The `priority` ordering is what makes it acceptable
 * — the two that sound are the two that matter most, and `conductor` (100) is
 * never the one that drops.
 */
export const MAX_MOTIFS = 2;

const MOTIFS: readonly Motif[] = [
  {
    archetype: 'conductor',
    priority: 100,
    // A tritone PEDAL under everything: two half-notes, bowed, the one motif that is not an event.
    touch: 'bowed',
    slots: 2,
    build: (m) =>
      // A tritone pedal under everything. Unmistakable, and it stops sounding
      // like the normal track the instant a boss appears.
      note(seq([m.tonic + 6, m.tonic + 6]))
        .s('sawtooth')
        .lpf(m.sig.openness.range(200, 1400))
        .lpq(3)
        .distort('1.5:0.5')
        .gain(0.4)
        .orbit(ORBIT_LOW),
  },
  {
    archetype: 'subdrop',
    priority: 60,
    // Two low tones struck on the beat; `ds('0.22:0')` gave it a 1 ms attack it never asked for.
    touch: 'struck',
    slots: 4,
    build: (m, count) =>
      note(chordOf([m.chord.root - 12, m.chord.root - 5]))
        .struct(count > 1 ? 'x ~ x ~' : 'x ~ ~ ~')
        .s('square')
        .lpf(700)
        .distort('3:0.5')
        .gain(0.34)
        .orbit(ORBIT_LOW),
  },
  {
    archetype: 'arpeggiator',
    priority: 50,
    // Four notes a bar at most - `seq([a,b,a,b])`.
    touch: 'struck',
    slots: 4,
    build: (m, count) => {
      const a = m.chord.root + 12;
      const b = a + 7;
      return note(count > 2 ? seq([a, b, a, b]) : `~ ${a} ~ ${b}`)
        // A square at 2.6kHz with Q4 is a bright blip on top of everything
        // else; a triangle says the same thing without the edge.
        .s('triangle')

        /*
         * A PLUCK, NOT A CLICK - and the envelope now comes from
         * `articulation.ts`, touch `struck`, applied at the end of this chain
         * so it is the last writer (AGENTS.md 4).
         *
         * The old fix here was right about the cause and wrote it out by hand:
         * `.ds('0.07')` set decay and sustain only, so attack fell through to
         * superdough's 1 ms default and release to 10 ms, and appending a
         * release alone would have been the archetypal gate-passing no-op
         * because release ramps FROM sustain. All three lanes that had it now
         * share one technique instead of three near-identical triples.
         */
        // See the room note on the first motif voice above.
        .room(0.3)
        .lpf(2600)
        .lpq(1.8)
        .gain(0.26)
        .pan(0.7)
        .orbit(ORBIT_HARMONY);
    },
  },
  {
    archetype: 'echo',
    priority: 45,
    // A stab and its delayed repeat; the DELAY is the character, so the note itself is short.
    touch: 'struck',
    slots: 4,
    build: (m, count) => {
      const n = m.chord.root + 12;
      // A stab and its delayed repeat, which is literally what the enemy does.
      return note(count > 2 ? `${n} ~ ${n} ~` : `${n} ~ ~ ~`)
        .s('triangle')
        .lpf(2600)
        .delay(0.5)
        .delaysync(3 / 16)
        .delayfeedback(0.45)
        .gain(0.2)
        .pan(0.34)
        .orbit(ORBIT_HARMONY);
    },
  },
  {
    archetype: 'rush',
    priority: 35,
    /*
     * THE ONE VOICE THAT KEEPS ITS OWN SHAPE, and the reason is that it is not
     * a note. It is filtered white noise with a REVERSE envelope - a 220 ms
     * attack into a 60 ms collapse - which is the whoosh itself and not an
     * articulation of a pitch. A touch would replace the instrument.
     *
     * Stated as `null` rather than by omission, so the table cannot be read as
     * "somebody forgot this row".
     */
    touch: null,
    slots: 4,
    build: (m, count) =>
      // A short rising whoosh per dive. Noise, so it never fights the harmony.
      s('white')
        .struct(count > 2 ? 'x ~ x ~' : 'x ~ ~ ~')
        .clip(1)
        .attack(0.22)
        .decay(0.06)
        .sustain(0)
        .release(0.02)
        .hpf(m.sig.openness.range(900, 3200))
        .hpq(4)
        .gain(0.18)
        .pan(0.66)
        .orbit(ORBIT_AIR),
  },
  {
    archetype: 'glissando',
    priority: 40,
    // Two long tones sliding; `plucked` because the delay carries the rest.
    touch: 'plucked',
    slots: 2,
    build: (m) =>
      note(seq([m.tonic + 24, m.tonic + 24 + degreeToSemitone(m.mode, 3)]))
        .s('triangle')
        .lpf(3000)
        .delay(0.4)
        .delaysync(3 / 16)
        .delayfeedback(0.4)
        .gain(0.24)
        .pan(0.3)
        .orbit(ORBIT_HARMONY),
  },
  {
    archetype: 'stutter',
    priority: 30,
    // A machine-gun repeat, up to sixteen a bar - the fastest motif and the shortest note.
    touch: 'struck',
    slots: 16,
    build: (m, count) => {
      const div = count > 8 ? 16 : count > 4 ? 8 : 4;
      return note(`${m.chord.root + 24}*${div}`)
        .s('square')

        /*
         * A PLUCK, NOT A CLICK - and the envelope now comes from
         * `articulation.ts`, touch `struck`, applied at the end of this chain
         * so it is the last writer (AGENTS.md 4).
         *
         * The old fix here was right about the cause and wrote it out by hand:
         * `.ds('0.03')` set decay and sustain only, so attack fell through to
         * superdough's 1 ms default and release to 10 ms, and appending a
         * release alone would have been the archetypal gate-passing no-op
         * because release ramps FROM sustain. All three lanes that had it now
         * share one technique instead of three near-identical triples.
         */
        /*
         * AND PUT IT IN A ROOM.
         *
         * "the pinging noise is just really bad base type of sound" — the
         * timbre, not the envelope, and `attackfloor` prints the cause beside
         * the one it printed for the envelope: motifs `room 0.00, dry 100%`.
         * So do sub, bass, arp and hats. Five of seven pitched lanes were bare
         * oscillators with no space around them at all, against chords at 0.28
         * and lead at 0.34.
         *
         * Measured against real practice rather than taste: of the 60 songs in
         * eefano/strudel-songs-collection, 55 use `.room()` — 92%. The common
         * values are 0.2, 0.3, 0.5, 0.8 and 1.0. A dry raw triangle sitting
         * next to two wet lanes does not read as a different instrument, it
         * reads as a cheap one, because nothing in a physical space is dry.
         *
         * 0.3 rather than the 0.6+ the pads run, because these are SHORT and a
         * long tail on a fast repeating motif smears into the next one — the
         * same reason `buildBass` shortens its release when `layered` stacks
         * eighths underneath.
         */
        .room(0.3)
        .lpf(4200)
        .hpf(600)
        .gain(0.17)
        .pan(0.62)
        .orbit(ORBIT_HARMONY);
    },
  },
  {
    archetype: 'pluck',
    priority: 20,
    // Two notes a bar on the offbeats.
    touch: 'struck',
    slots: 4,
    build: (m, count) =>
      note(count > 3 ? `~ ${m.chord.root + 12} ~ ${m.chord.root + 12}` : `~ ${m.chord.root + 12} ~ ~`)
        .s('triangle')

        /*
         * A PLUCK, NOT A CLICK - and the envelope now comes from
         * `articulation.ts`, touch `struck`, applied at the end of this chain
         * so it is the last writer (AGENTS.md 4).
         *
         * The old fix here was right about the cause and wrote it out by hand:
         * `.ds('0.09')` set decay and sustain only, so attack fell through to
         * superdough's 1 ms default and release to 10 ms, and appending a
         * release alone would have been the archetypal gate-passing no-op
         * because release ramps FROM sustain. All three lanes that had it now
         * share one technique instead of three near-identical triples.
         */
        // See the room note on the first motif voice above.
        .room(0.3)
        .lpf(2000)
        .gain(0.22)
        .pan(0.38)
        .orbit(ORBIT_HARMONY),
  },
];

export function buildMotifs(m: MusicalState): Pattern {
  const live = MOTIFS.filter((mo) => (m.enemies[mo.archetype] ?? 0) > 0)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_MOTIFS);
  if (!live.length) return silence;
  /*
   * ONE PLACE APPLIES THE ENVELOPE, and it is after `build` so it is the last
   * writer for all five controls it owns. A motif that wants a different shape
   * changes a word in the table, not a chain.
   */
  return stack(
    ...live.map((mo) =>
      mo.touch === null
        ? mo.build(m, m.enemies[mo.archetype])
        : articulate(mo.build(m, m.enemies[mo.archetype]), mo.touch, {
            slots: mo.slots,
            bpm: m.bpm,
            shade: m.sig.drive,
          }),
    ),
  );
}

// ---------------------------------------------------------------------------
// powerup signatures
// ---------------------------------------------------------------------------

/**
 * Persistent musical signatures for held powerups.
 *
 * Most of the powerup mapping is done *inside* the stems above — rapid fire
 * doubles the hats, spread widens the supersaws — because a modifier the player
 * hears woven through the track reads as "my loadout" far better than a
 * separate bleep. These are the ones that need their own voice.
 */
/**
 * Powerups that actually get their own voice in the `power` stem.
 *
 * Most powerups deliberately modify an existing stem instead — rapid doubles
 * the hats, spread widens the supersaws, magnet inverts the bass envelope —
 * which is the better design but means the `power` lane was showing a full
 * level while producing silence. Gating on this list keeps the score panel
 * honest about what is being played.
 */
export const VOICED_POWERUPS: readonly PowerupKind[] = ['nova', 'blackhole', 'bomb', 'ward'];

export function hasVoicedPowerup(powerups: Partial<Record<PowerupKind, number>>, bombs = 0): boolean {
  return bombs > 0 || VOICED_POWERUPS.some((k) => (powerups[k] ?? 0) > 0);
}

export function buildPowerupVoices(m: MusicalState): Pattern {
  const parts: Pattern[] = [];

  const novaLevel = m.powerups.nova ?? 0;
  if (novaLevel > 0) {
    /*
     * A held pad an octave up: audible safety.
     *
     * The gate was `if (m.powerups.nova)`, so a second and third NOVA sounded
     * exactly like the first — the same saturation that made RAPID silent in a
     * busy fight and a repeat DRONES do nothing. Level widens the voicing
     * upward and opens the filter, so stacking safety sounds like more safety.
     */
    /*
     * THE CHORD'S OWN OCTAVE, NOT ONE ABOVE IT. This voiced the harmony at
     * chord+12, adding chord+24 at levels 2 and 3 — a triangle pad up to two
     * octaves above the chords, on a stem whose curve floors at 0.6 and
     * ceilings at 0.85 (STEM_CURVES.power), which made it the loudest melodic
     * thing in the mix whenever NOVA was held. A triangle two octaves up is
     * exactly the short, pitched, high, synthetic "bing" the research names
     * as the remaining offender (docs/research-dubstep.md §6.1), and a
     * powerup's presence does not need to be announced from the top of the
     * spectrum. Levels 2 and 3 now add the octave the pad used to START at.
     */
    const voiced = m.chord.notes.map((n) => n);
    if (novaLevel >= 2) voiced.push(m.chord.notes[0] + 12);
    if (novaLevel >= 3) voiced.push(m.chord.notes[1] + 12);
    parts.push(
      note(chordOf(voiced))
        .s('triangle')
        .attack(0.4)
        .decay(0.3)
        .sustain(0.6)
        .release(0.5)
        // Capped at 2600 where it used to open to 5100 at level 3; the pad
        // sits an octave lower now and does not need the air.
        .lpf(m.sig.openness.range(700, Math.min(2600, 2200 + novaLevel * 200)))
        .room(0.5)
        .roomsize(ORBIT_ROOM[ORBIT_HARMONY])
        .gain(0.16 + novaLevel * 0.02)
        .orbit(ORBIT_HARMONY),
    );
  }

  const wardLevel = Math.min(3, m.powerups.ward ?? 0);
  if (wardLevel > 0) {
    /*
     * A low sustained pad — the one voice here that is not an attack.
     *
     * Deliberately the mirror of NOVA above: same held-chord idea, but voiced
     * an octave DOWN with the filter kept shut, where NOVA goes up and opens.
     * Two reasons. Musically, every other signature in this file is a transient
     * or a bright top — the score kept being described as fatiguing high synth,
     * and a warm sustained floor is the direct answer to that; it also gives the
     * lead something to sit on instead of hanging in open air. Mechanically,
     * WARD is the only defensive drop, so it should sound like ground rather
     * than like more energy, and the player should be able to tell WARD from
     * NOVA with their eyes shut.
     *
     * The root is dropped a further octave so it reads as a floor and not as a
     * second chord competing with `chords` for the same register.
     */
    const voiced = m.chord.notes.slice(0, 3).map((n) => n - 12);
    voiced[0] -= 12;
    parts.push(
      note(chordOf(voiced))
        .s('triangle')
        .attack(0.9)
        .decay(0.4)
        .sustain(0.85)
        .release(1.2)
        // Stays shut. `openness` still moves it, but between two dark values —
        // this must never become another bright layer.
        .lpf(m.sig.openness.range(260, 620 + wardLevel * 120))
        .room(0.42)
        .roomsize(ORBIT_ROOM[ORBIT_HARMONY])
        .gain(0.13 + wardLevel * 0.015)
        .orbit(ORBIT_HARMONY),
    );
  }

  const wellLevel = m.powerups.blackhole ?? 0;
  if (wellLevel > 0) {
    // A sub drone sliding downward for as long as the well is open. It does not
    // resolve until the well collapses, which makes the whole thing feel like
    // one held breath.
    parts.push(
      note(seq([m.tonic - 12]))
        .struct('x')
        .clip(1)
        .s('sawtooth')
        /*
         * The slide deepens with level. The gate was `if (powerups.blackhole)`,
         * so a stacked well sounded identical to a single one — and this is the
         * powerup whose whole character is the size of the drop.
         */
        .penv(-16 - wellLevel * 5)
        .pattack(0.9)
        .pcurve(1)
        .attack(0.25)
        .decay(0.4)
        .sustain(0.6)
        .release(0.5)
        .lpf(m.sig.openness.range(180, 900))
        .lpq(3)
        .distort('1.3:0.5')
        .room(0.45)
        .gain(0.34)
        .orbit(ORBIT_LOW),
    );
  }

  /*
   * The heartbeat: you are carrying something that can end the screen.
   *
   * Gated on bombs actually in reserve, not on having *picked up* a bomb
   * powerup — the player starts with three, so the old condition meant the
   * layer was silent through most of a run despite the resource being there.
   * That is why this stem averaged 0.05.
   *
   * It also fades as the music gets busy. A heartbeat is something you notice
   * in the quiet; masking it under a drop is both realistic and the only way to
   * make a near-constant element bearable.
   */
  if (m.bombs > 0) {
    parts.push(
      note(seq([m.tonic - 12]))
        .s('sine')
        .struct('x ~ ~ ~')
        .penv(16)
        .pdecay(0.18)
        .pcurve(1)
        .decay(0.45)
        .sustain(0)
        .gain(0.2)
        .orbit(ORBIT_LOW),
    );
  }

  return parts.length ? stack(...parts) : silence;
}

/** Chord for a given bar of the eight-bar phrase. */
export function chordForBar(
  tonic: number,
  mode: ModeName,
  progression: readonly ChordSpan[],
  bar: number,
  /*
   * Which extension the ACT has unlocked. Optional and defaulting to the
   * seventh, so every tool that builds a bar by hand — and there are six —
   * keeps working and gets the ordinary chord rather than silently getting the
   * reserved one. See `theory.Extension` and `ACT_SHAPE.ninth`.
   */
  extend: Extension = 'seventh',
): Chord {
  /*
   * The phrase is the unit, and the progression addresses bars rather than
   * being indexed by them.
   *
   * `PROGRESSIONS` used to hold four degrees and this indexed them twice, with
   * a `TURNAROUNDS` table overriding the last bar so that the eight bars closed
   * instead of merely stopping. Both are gone: each progression now spells out
   * how long every chord lasts, so a chord that holds for two bars says so and
   * the cadence can move twice as fast as the rest of the phrase. A table that
   * patched the last bar could only ever produce one cadence shape for every
   * mode, and the Phrygian cadence is not the same gesture as a dominant one.
   */
  const bars = progression.reduce((n, span) => n + span[1], 0);
  let at = ((bar % bars) + bars) % bars;
  let degree = progression[progression.length - 1][0];
  for (const span of progression) {
    if (at < span[1]) {
      degree = span[0];
      break;
    }
    at -= span[1];
  }
  /*
   * Pure in (tonic, mode, progression, bar), and deliberately nothing else.
   *
   * Extensions used to be selected here from tension — triad, then 7th, then
   * 9th — which meant the chord's pitches, and every line derived from them,
   * were rewritten when a threshold was crossed. The triad and its colour tones
   * now both come back every time and `buildChords` fades the colour, so the
   * harmony still opens up as things get tense without any note being replaced.
   */
  // The contour is the one thing here that depends on WHERE in the phrase we
  // are rather than on which chord it is: it is how the pad gets told which way
  // the tune is going, so it can avoid going the same way. See MELODY_CONTOUR.
  return { ...buildChord(tonic, mode, degree, 0, extend), contour: contourForBar(bar) };
}
