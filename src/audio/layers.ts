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
import { note, s, silence, stack, type Pattern, type Patternable } from '@strudel/core';
import type { EnemyArchetype, GameSnapshot, PowerupKind, SectionName } from '../core/events';
import { clamp01, remap } from '../core/math';
import type { Chord, ChordSpan, Extension, ModeName } from './theory';
import { LANE_RANGE, buildChord, contourForBar, degreeToSemitone, foldInto, laneTones } from './theory';
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
import { clap, hatLayer, impact, kick, metal, ORBIT_AIR, ORBIT_HARMONY, ORBIT_LOW, snare, sub } from './kit';
import { reese, wub, wubFor } from './wobble';

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
  sub: { in: 0.44, full: 0.8, ceiling: 0.52, floor: 0.26 },
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
  kick: { in: 0.1, full: 0.68, ceiling: 0.74, floor: 0.3 },
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
  clap: { in: 0.26, full: 0.68, ceiling: 0.66, floor: 0.22 },
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
  hats: { in: 0, full: 0.62, ceiling: 0.4, floor: 0.32 },
  bass: { in: 0.24, full: 0.72, ceiling: 0.6, floor: 0.22 },
  chords: { in: 0.1, full: 0.82, ceiling: 0.9, floor: 0.3 },
  // `full` was 0.8, which energy reaches only in extremis, so the arp lived in
  // the bottom of its own curve. 0.62 lets a busy passage actually open it up.
  arp: { in: 0.32, full: 0.62, ceiling: 0.76, floor: 0.26 },
  lead: { in: 0.2, full: 0.84, ceiling: 0.95, floor: 0.34 },
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
  motifs: { in: 0.0, full: 0.5, ceiling: 0.6, floor: 0.34 },
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
const INTRO_ENTRY: Record<StemId, number> = {
  // Negative, so these two are already partly present on the very first bar.
  // Ramping them from exactly zero measured as a full bar of literal silence
  // after pressing start, which reads as the game failing to boot rather than
  // as an intro.
  sub: -0.14,
  chords: -0.06,
  // Earlier than the drums by a wide margin: the intro exists to state the
  // theme, and a tune that arrives a third of the way through its own
  // introduction has not been introduced.
  lead: 0.16,
  hats: 0.42,
  kick: 0.55,
  bass: 0.68,
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

/** MIDI numbers as a mini-notation sequence. */
const seq = (notes: number[]): string => notes.join(' ');

/** MIDI numbers as a single stacked chord event. */
const chordOf = (notes: number[]): string => `[${notes.join(',')}]`;

/** Repeat a chord `n` times across the bar. */
const chordStabs = (notes: number[], n: number): string => Array(n).fill(chordOf(notes)).join(' ');

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
 * Home base recurs; the excursions are spaced so they stay events.
 *
 * Dubstep gets three of the eight slots, which makes it the most common groove
 * BY WAVE — more than four-to-the-floor. That is a deliberate change of centre
 * of gravity rather than another excursion added to the rota: it is the groove
 * the game was asked for, it arrives on the second wave so nobody has to play
 * for four minutes to meet it, and it is the only feel here whose bass part is
 * written in filter movement instead of in note onsets, so it does not blur
 * into the ones either side of it.
 *
 * BY BAR IT IS NOT THE MOST COMMON, and the difference is worth writing down
 * because the rota alone does not predict it. `feelForWave` returns `gallop`
 * for every boss regardless of the cycle, and a boss fight is long — so
 * measured over five ten-minute runs, the share of BARS came out gallop 30.3%,
 * halftime 27.8%, boomchick 23.2%, chase 10.6%, shuffle 8.1%. Both decisions
 * are deliberate and both stay; what was wrong was this comment claiming an
 * outcome the boss override takes back. Counting slots is not counting time.
 */
const FEEL_CYCLE: readonly Feel[] = [
  'boomchick',
  'halftime',
  'chase',
  'halftime',
  'boomchick',
  'gallop',
  'halftime',
  'shuffle',
];

export function feelForWave(wave: number, isBoss: boolean): Feel {
  return isBoss ? 'gallop' : FEEL_CYCLE[wave % FEEL_CYCLE.length];
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
export const FEEL_HUES: Record<Feel, number> = {
  boomchick: 205,
  chase: 282,
  gallop: 8,
  shuffle: 42,
  // Acid lime, and kept clear of 130-170 on purpose: the collectible notes are
  // green, and a green room to pick green shards out of is a palette that costs
  // the player information.
  halftime: 82,
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
  const core = lpf(sub(pattern, 0.62));
  if (!layered) return core;
  return stack(
    core,
    // The fifth, an eighth before the halfway point.
    lpf(sub(`~ ~ ~ ~ ~ ${fifth} ~ ~`, 0.62)).gain(m.sig.density.range(0, 1)),
    // Passing roots on the remaining offbeats, last to arrive.
    lpf(sub(`~ ~ ~ ${root} ~ ~ ~ ${root}`, 0.62)).gain(m.sig.fill.range(0, 1)),
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
        .roomsize(5),
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
  if (g.bells.length) {
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
   * The offbeat layer keeps `sustain(0)` on purpose. It is garnish at a tenth
   * of the level, it lands between the beat layer's notes, and giving it a body
   * too would fill the gaps that are the whole reason the two layers read as
   * separate. One voice sings, the other ticks.
   */
  const voice = (
    pattern: string,
    level: Patternable,
    velocity: number,
    sustain: Patternable,
    release: Patternable,
  ): Pattern =>
    note(pattern)
      .s('pulse')
      .pw(0.5)
      .ad('0.004:0.07')
      .sustain(sustain)
      .release(release)
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
      .roomsize(3)
      .orbit(ORBIT_HARMONY);

  /*
   * Two layers on one lattice, exactly as the hats were — the retention lesson
   * survives the rewrite. The beat layer always sounds; the sixteenths fade in
   * over it, so getting busier ADDS notes between the ones already playing
   * rather than replacing all of them. `tools/retention.mjs` scored the old
   * division-swapping hat 45% nested, the worst lane in the mix.
   */
  const drive = Math.min(1, (m.barInPhrase % 4 === 3 ? 0.3 : 0) + (rapid > 0 ? 0.25 + rapid * 0.08 : 0));
  /*
   * How much body the beat layer holds, and how long it takes to let go.
   *
   * Both ride `openness`, which is the master filter position — how big and
   * open the mix currently is. When it closes down the motor tightens back
   * towards the pluck it used to be; when the arrangement opens up the inner
   * voice sings a little more. A curve rather than a constant, for the reason
   * this file keeps relearning: a fixed number here would trade one invariant
   * envelope for a different invariant envelope.
   *
   * The release is short by design. On the fill bar's sixteenths (111ms at 135
   * bpm) a 90-160ms release overlaps the next note by about one note's worth at
   * a third of the level, which is a chromatic run smearing into itself very
   * slightly — the intended sound of a run-up. Anything near the 250ms floor
   * §4 proposes would put three notes on top of each other and turn the lane
   * into a drone, which would undo the pulse inversion this whole arrangement
   * is built on. The floor is wrong for this lane and should not be applied to
   * it; see the plan's note on retiring it.
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
  const base = voice(
    line,
    0.42,
    1,
    m.sig.openness.range(0.22, 0.36),
    m.sig.openness.range(0.09, 0.16),
  );
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
    voice(`[~ ${third}]*4`, m.sig.fill.range(drive * 0.14, 0.14), 0.5, 0, 0),
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
  const intensity = half ? 0.3 : 1;

  if (m.feel === 'halftime') {
    /*
     * The wobble, and it is the reason this feel exists.
     *
     * Every other bass part in this file is written as note onsets. This one is
     * not: the notes are two per bar and they are held, and the rhythm is
     * played by an LFO on the filter cutoff. That is not a stylistic flourish,
     * it is what the genre IS — the part is composed in filter movement, and if
     * you write it as onsets you get a synth bass playing eighths, which is a
     * different and much older kind of music.
     *
     * It also happens to be the best fit for this project's own constraints
     * that any layer has had. The rate table in `wobble.ts` is indexed by the
     * bar, so the part develops across the eight-bar phrase without depending
     * on game state at all; and the two things the game DOES drive — how far
     * the filter swings and how hard it is driven — are continuous signals, so
     * intensity moves them without a single note being replaced. A dial that
     * changes how a part sounds rather than which notes it contains is exactly
     * what `tools/retention.mjs` was written to ask for, and here it comes for
     * free rather than having to be engineered around.
     */
    const w = wubFor(m.barInPhrase, m.section === 'drop');
    // TIMEWARP halves the wobble rather than the tempo, for the same reason it
    // halves everything else: the battlefield is scheduled in beats, so the
    // clock may not move. A wobble at half rate over an unchanged kick is
    // exactly what "half-time" means to a listener.
    const shape = half ? { ...w, rate: Math.max(1, w.rate / 2) } : w;
    // Two notes: three beats of root, then somewhere to go. MAGNET still drops
    // the first one an octave, so the floor sags as it sucks.
    const line = `${low}@3 ${leading ? approach : fifthLow}`;
    const opts = {
      shape,
      /*
       * The centre of the sweep, and the ceiling is deliberately low.
       *
       * With `lpdepth` at 1.85 the LFO swings to 1.9x the centre, so a centre of
       * 1050 peaks near 2kHz — under the 2.5-6kHz band `npm run audiocheck`
       * fails on. A resonant peak at Q7 parked in that band is the single most
       * fatiguing thing this mix could contain, and the wobble would otherwise
       * be reaching into it four to twelve times a bar.
       */
      cutoff: m.sig.openness.range(300, 1050),
      // How far it swings is the intensity dial. At 1.15 it is a gentle
      // breathing; at 1.85 the filter slams shut between wobbles, which is the
      // sound of the drop.
      depth: m.sig.drive.range(1.15, 1.85),
      drive: m.sig.drive.range(0.7, 1.4),
      level: 0.82,
    };
    return stack(
      wub(line, opts),
      // The growl, an octave up on its own LFO. Fades in with drive rather than
      // being switched on, so a calm passage is one clean sweep and a busy one
      // is two beating against each other.
      reese(line, { ...opts, level: m.sig.drive.range(0.08, 0.3) }),
      /*
       * The funk: an octave pop on the last sixteenth of the bar.
       *
       * One short, bright note in the gap before the downbeat, which is where a
       * bass player's thumb goes and where nothing else in this arrangement is
       * playing. Its own layer riding `sig.fill`, so it is added to a bar that
       * is already complete rather than replacing anything in it.
       */
      wub(`~ ~ ~ [~ ~ ~ ${octave}]`, {
        ...opts,
        // No wobble on a sixteenth — there is not time for one, and a partial
        // sweep on a stab reads as a wrong note. Fast and shallow so it pops.
        shape: { rate: 16, shape: shape.shape, skew: 0.5 },
        depth: 0.6,
        level: m.sig.fill.range(0, 0.55),
      }),
    );
  }

  /*
   * THE BASS IS A TUNE.
   *
   * This block used to be four one-line patterns built from `root`, `fifth` and
   * `octave` — three pitch classes and a chromatic approach note. That is a
   * functional dance bass: it states the harmony and it keeps time, and it is
   * categorically not the same part as the basslines in the music this score is
   * aiming at. Those are hooks you could sing:
   *
   *   Corridors of Time      the bass IS the piece — a melodic ostinato running
   *                          cross-rhythms against the tune
   *   Battle 1               a syncopated sixteenth riff with octave leaps
   *   Vampire Killer         continuous eighths with chromatic passing tones
   *   Wily Stage 1           the triangle arpeggiating 1-5-8-10 through each
   *                          chord, which is why three voices sound full
   *   Frog's Theme           boom-chick: root on the beat, CHORD TONES on the
   *                          off, so the low register outlines the triad itself
   *
   * The existing comment above about the approach note is right that it is "the
   * single cheapest thing that makes a bass part sound played". It just is not
   * enough on its own, and everything else here was root.
   *
   * So: a library of five named figures, chosen by feel. And — this is the part
   * worth stealing wholesale from Pokémon R/B — INTENSITY CHOOSES THE NOTE
   * LENGTH, NOT THE PITCHES. Its four battle themes run essentially the same
   * bass pitches at four energy levels and vary only the rhythm and how long
   * each note is held. That is exactly the retention property
   * `tools/retention.mjs` exists to measure: a busier passage must ADD to the
   * part rather than replace it, and a figure whose pitches are invariant under
   * the intensity dial passes that by construction rather than by tuning.
   */
  const third = root + degreeToSemitone(m.mode, 2);
  const tenth = root + 12 + degreeToSemitone(m.mode, 2);
  // The chromatic neighbour below the next chord — a leading tone for the bass.
  const lead = leading ? approach : root;

  let pattern: string;
  let layered = false;
  switch (m.feel) {
    case 'chase':
      /*
       * PEDAL. The tonic held while the motor moves above it — Pokémon's
       * Champion theme, and the one figure here that is deliberately static.
       * It reads as menace precisely because everything else is moving.
       */
      pattern = intensity < 0.5 ? `${low}@4` : `${low}@3 ${lead}`;
      break;
    case 'gallop':
      /*
       * ARP UP — 1-5-8-10, the Wily Stage 1 triangle. The single most useful
       * bass figure in the chiptune canon: it never rests, it spells the whole
       * chord including its third, and it climbs, so a repeated chord still
       * has somewhere to go.
       */
      pattern =
        intensity < 0.5
          ? `${low} ${fifthLow} ${octave} ${fifth}`
          : `${low} ${fifthLow} ${octave} ${tenth}`;
      break;
    case 'shuffle':
      /*
       * BOOM-CHICK, in twelve. Root on the dotted beat, third and fifth on the
       * offs — Frog's Theme. The chord tones in the low register are what makes
       * this sound like a band rather than a bass patch.
       */
      pattern = `[${low}@2 ${third}] [${fifthLow}@2 ${third}] [${low}@2 ${fifth}] [${fifthLow}@2 ${lead}]`;
      break;
    default:
      /*
       * OCTAVE PEDAL with a walk out — the Castlevania eighth-note engine.
       * Continuous, octave-displaced, and it leans onto the next chord on the
       * last beat rather than restating the root a fourth time.
       *
       * This replaces `~ low ~ root`, which was an offbeat house anchor: the
       * literal "where a house bass sits", as its own comment said.
       */
      pattern = `${low} ${octave} ${fifthLow} ${lead}`;
      layered = true;
  }
  /*
   * The 808: a sine with a pitch slide into each note.
   *
   * APPLIED LAST, and that is the fix rather than a style choice. This used to
   * be the INNERMOST call — `glide(shaped(note(line))).s('sawtooth').ds(...)` —
   * so every control it set that the chain below also set was overwritten two
   * lines later. `.s('sine')` lost to `.s('sawtooth')`; `.decay(0.7)` and
   * `.sustain(0.35)` lost to `.ds('0.3:0.42')`. Only `attack`, `release` and
   * the pitch envelope survived, because nothing downstream restated those.
   *
   * `tools/attackfloor.mjs` is what proves it, and this is exactly the kind of
   * claim that has to be proven off haps rather than read off the source. Its
   * BY VOICE table lists `bass·sawtooth` and `bass·supersaw` over a 720s sweep
   * and there is NO `bass·sine` row — while that same sawtooth row carries an
   * attack high of 6ms and a release high of 400ms, which are `glide`'s own
   * numbers and appear nowhere else in this function. So the chase haps really
   * do run through here, really do wear this envelope, and have never once been
   * rendered on the oscillator the comment names. An 808 is a sine; this has
   * been a sawtooth wearing an 808's envelope for as long as the line existed.
   *
   * Wrapping the finished chain instead of seeding it means every control here
   * is the last writer, so the feel gets the timbre AND the long tail it says
   * it does.
   */
  const glide = (p: Pattern): Pattern =>
    m.feel === 'chase'
      ? p.s('sine').attack(0.006).decay(0.7).sustain(0.35).release(0.4).penv(-7).pattack(0.11).pcurve(1)
      : p;
  const shaped = (p: Pattern): Pattern =>
    mag > 0
      ? // Filter opens *into* the note rather than out of it — a suck, not a pluck.
        p.lpq(6 + mag * 1.5).lpattack(0.14).lpenv(3.2).lpdecay(0.3)
      : p.lpq(5).lpenv(2).lpdecay(0.09);
  const voice = (line: string): Pattern =>
    glide(
      shaped(note(line))
      .s('sawtooth')
    /*
     * THE ENDS OF THE NOTE, which is where "choppy" and "abrasive" actually
     * live in this lane.
     *
     * `.ds()` sets decay and sustain and says nothing about attack or release,
     * so both used to fall through to superdough's defaults: a 1ms attack and a
     * 10ms release. `attackfloor` measured the consequence — 72% of this lane's
     * haps carrying no attack and no release, a median TAIL of 10ms, the
     * shortest of any pitched lane in the game — on the lane it also measured
     * at -11 dBFS, the LOUDEST pitched lane, 16dB above the motor.
     *
     * The note itself was never short. `sustain(0.42)` holds it for its full
     * length. It was hard-edged at BOTH ends: a 1ms ramp on a sawtooth this
     * loud is a broadband click on every onset, and a 10ms ramp off it is an
     * audible chop before the next note. Loudest lane, sharpest edges, eight
     * times a bar — that is the abrasion, and no amount of `gain` work reaches
     * it because the level was never the problem.
     *
     * Curves, not constants, and that is the point rather than a flourish. Four
     * of the seven pitched lanes measured an IDENTICAL envelope on every hap of
     * a twelve-minute sweep (attack lo/med/hi of 4.0/4.0/4.0, 6.0/6.0/6.0),
     * which is the real clavichord complaint: not that the attacks are fast —
     * the chiptune canon this score is aimed at has instant attacks — but that
     * no note is ever shaped differently from any other. A flat floor typed as
     * `.attack(0.02)` on every lane would satisfy an attack gate while leaving
     * that invariance exactly as it is, which is this project's own recorded
     * "gates optimised against" failure in a new costume.
     *
     * So both ends ride `drive`. Calm: a rounder 14ms onset and a 260ms tail
     * that lets each note bleed into the next, which is the legato a bass
     * wants when there is space for it. Driving: a 6ms onset for definition and
     * a 140ms tail, because `layered` has by then stacked on-beat fills and
     * eighths underneath and a long release across all three smears them into
     * mud. The quiet passages are also where a listener hears each note most
     * clearly, so that is where the long tail is worth most.
     */
    .attack(m.sig.drive.range(0.014, 0.006))
    // 0.16 to silence left a hole under every beat. A bass that stops between
    // notes takes the floor out from under the whole mix eight times a bar.
    .ds('0.3:0.42')
    .release(m.sig.drive.range(0.26, 0.14))
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
      .distort(m.sig.drive.range(1.05, 1.8))
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
      .roomsize(2)
      .orbit(ORBIT_LOW),
    );

  const core = voice(pattern);
  if (!layered) return core;
  return stack(
    core,
    // Fills in the beats the anchor leaves open.
    voice(`${low} ~ ${fifth} ~`).gain(m.sig.density.range(0, 0.86)),
    // Driving eighths underneath, last to arrive.
    voice(`~ ${octave} ~ ~ ~ ${root} ~ ~`).gain(m.sig.fill.range(0, 0.7)),
  );
}

export function buildChords(m: MusicalState): Pattern {
  const spread = m.powerups.spread ?? 0;
  const half = (m.powerups.timewarp ?? 0) > 0;
  const nova = m.powerups.nova ?? 0;
  // FLANKED widens everything harmonic; see MOVEMENT_MIX.
  const wide = m.movement === 'flank' ? 0.45 : 0;
  /*
   * No octave shift. `voiceLead` already places these between MIDI 55 and 79.
   *
   * This added +12 on top of that, so the pad sounded at 67-91 — an octave
   * above the range its own voice leading was designed for, and the same
   * territory as the arp and the lead. With the bass at the floor and every
   * harmonic layer stacked into the top two octaves, the middle of the mix was
   * empty and the top never rested: "too much high pitch synth always playing,
   * its taxing on the ears".
   *
   * A keyboard player's left hand lives here. Leaving the chord where the voice
   * leading already put it is what puts something back in the middle.
   */
  /*
   * A FIX THAT FAILED, THEN SUCCEEDED — and the reason it changed is the point.
   *
   * Read the history below in order. Capping the pad's register was tried,
   * measured, and rejected: it made roughness WORSE (1950 -> 2066 pairs) and
   * left `chords+lead` untouched. That verdict was correct for the pad as it
   * then was: a full triad or tetrad, which cannot move down without the
   * displaced voices colliding with the bass and the motor instead.
   *
   * Opening the pad to fifths changed the object. A two-note dyad is a
   * different thing from a four-note chord, and the register move was re-tested
   * against it rather than left rejected on the strength of a measurement taken
   * on something else:
   *
   *     total audible weight   992 -> 918   (-7.5%)
   *     chords+lead            547 -> 446   (-18%, from 60% of all roughness to 49%)
   *     clash                   142 -> 142   unchanged
   *     interlock pile-up      2.81 -> 2.68
   *
   * The lesson worth keeping is not about pads. **A rejected experiment expires
   * when its premise changes.** This one sat in the source as settled for
   * several hours after the change that unsettled it, and would have stayed
   * settled indefinitely, because a written rejection reads exactly like a
   * closed question.
   *
   * -- the original note, kept because the numbers in it are still the reason
   *    the register move is delicate at all: --
   *
   * A REJECTED FIX, recorded because the numbers are the useful part.
   *
   * `tools/masking.mjs` shows chords-against-lead is **48% of every
   * critical-band collision in the score** (936 of 1950 rough pairs), with 72%
   * of all roughness in MIDI 60-71 — exactly where the tune lives. A held pad
   * tone a semitone under a melody note does not clash and resolve; it beats
   * against the line for the whole bar, and neither low-passing nor level
   * automation touches it, because the two signals are inside one critical band.
   *
   * The obvious fix — cap the pad below the melody by dropping offending voices
   * an octave — was tried and MADE IT WORSE: 1950 -> 2066 rough pairs, with
   * `chords+lead` unchanged at 936 and the displaced voices simply colliding
   * further down instead (`bass+chords` 52 -> 124, `chords+motor` 173 -> 217).
   *
   * It could not have worked, and the arithmetic says so without an experiment:
   * a ceiling of `tonic + 10` is 67, the melody is based at 69, and 67 against
   * 69 is a whole tone — still inside the band. Real separation would need the
   * pad below about `tonic + 5`, which is the motor's register and then the
   * bass's.
   *
   * THE ACTUAL PROBLEM IS STRUCTURAL: there are four sustained pitched lanes
   * and three registers. Bass owns 45-57, the motor owns 57-69, the lead is
   * based at 69 and climbs. There is no octave left for a continuous pad, and
   * no voicing rule can invent one.
   *
   * Which is what `buildMotor`'s own comment already says: the motor "IS the
   * comping — it states the chord continuously... which is what allows the pad
   * to become an occasional colour rather than a permanent bed." That intent
   * was never carried into `STEM_CURVES`, where `chords` still has the
   * second-highest ceiling in the mix (0.9) and enters at 0.1. The fix is a
   * level and arrangement decision, not a voicing one — and `masking.mjs`
   * cannot score it, because it ignores gain by design.
   */

  /*
   * OPEN THE PAD TO FIFTHS ONCE THE MELODY IS PLAYING.
   *
   * With audibility weighting, `chords+lead` is **67% of all the audible
   * roughness in the score** — two thirds of the mud, from one pair of lanes.
   * Cutting the pad's level would score well on that metric and would be
   * cheating: the pad is the only sustained thing in the mix besides the tune,
   * and the last time it was thinned the result was "percussion with
   * decoration". The metric would improve and the music would not.
   *
   * The tone that actually collides is the THIRD. It is a semitone from the
   * fourth and from the flat third, a tone from the second — the intervals a
   * melody moves through constantly — and the pad holds it for a whole bar
   * while the tune walks past. The root and the fifth are the two notes a
   * melody can sit on top of without grinding, which is why open fifths are
   * what every arranger reaches for when the top voice needs room, and why
   * organum, power chords and the entire 8-bit harmony tradition sound the way
   * they do.
   *
   * Dropping the third loses no harmony here, because the MOTOR is already
   * stating it — root, third and fifth, continuously, in its own register.
   * That is precisely the division of labour `buildMotor` claims: it "IS the
   * comping... which is what allows the pad to become an occasional colour
   * rather than a permanent bed." This is the pad taking that seriously while
   * keeping every bit of its sustain.
   *
   * Only once the melody is actually sounding. Below the lead's entry point
   * the pad IS the harmony and needs its third; there is nothing above it to
   * make room for.
   */
  /*
   * ...EXCEPT ON A PIVOT, where the third is the entire chord.
   *
   * The rule above is right and stays. It has one counter-example and this is
   * it: the bar before a modulation plays the incoming key's dominant, whose
   * major third is that key's LEADING TONE — the note that pulls a semitone up
   * onto the new tonic on the next downbeat. Dropping it leaves an open fifth,
   * which is the one sonority that belongs to no key at all, so the arrival
   * would resolve from nowhere in particular.
   *
   * This is the only change the run-level form asked of `layers.ts` besides
   * `themeForWave`'s recapitulation branch, and it is one bar per modulation —
   * about ten bars in a twenty-minute run. The pad's own argument for dropping
   * the third is that the melody is walking past it for a whole bar; on a
   * cadence bar the melody is landing rather than walking, which is what a
   * cadence is.
   */
  /*
   * ---------------------------------------------------------------------
   * IT IS A DYAD NOW, ALWAYS — and that is arithmetic, not taste.
   * ---------------------------------------------------------------------
   *
   * The rule above was `melodyPresent && openTones.length >= 2`, so the pad
   * played its FULL chord below the lead's entry point. That was fine while the
   * chord was a triad and the lane had no ceiling. It stopped being fine on the
   * day the chord became a seventh and the lane got a thirteen-semitone window,
   * and the failure is one a fold cannot avoid:
   *
   *   A window of N semitones can only hold a chord whose span is under N. A
   *   root-position shell {root, fifth, seventh} spans eleven, and its root can
   *   be any of twelve pitch classes, so holding it upright needs 12 + 11 = 23
   *   semitones. Fold the overflow down an octave instead and the seventh lands
   *   a WHOLE TONE UNDER THE ROOT. That is not an inversion, it is a cluster.
   *
   * MEASURED before this line changed, over all nine modes x every degree x two
   * tensions: **38 of 88 pad bars contained two tones a semitone or a tone
   * apart** — `[49,50,54,57]`, `[49,52,54,57]` — held for a whole bar, at 110
   * to 220 Hz, on the one lane in the mix that never stops sustaining. Low
   * seconds are the single most reliable way to make a mix sound muddy.
   *
   * A DYAD IS THE ONE SHAPE THE FOLD CANNOT SPOIL. Two tones a fifth apart fold
   * to a FOURTH — an inversion, consonant, and the interval organum, power
   * chords and the whole 8-bit harmony tradition are built out of. There is no
   * arrangement of {root, fifth} in any window that produces a second.
   *
   * Nothing is lost from the HARMONY, and this is the part worth checking
   * rather than asserting. The third is stated by the motor, continuously, in
   * its own register, under every bar of the game (`motorcheck`: "every note is
   * a chord tone"). The third and the seventh are stated by the stab as guide
   * tones, verified against `@strudel/tonal`'s own `guidetones` dictionary in
   * all 44 chords by `tools/harmony.mjs`. The ninth and the thirteenth are the
   * colour pair above. What the pad contributes is WEIGHT and SUSTAIN, and a
   * dyad contributes exactly as much of both as a tetrad while occupying two
   * voices instead of four — which is also two fewer simultaneous voices in the
   * lane `registermap` measured as the mix's second-largest occupant of the
   * 250 Hz band.
   *
   * The old comment's "below the lead's entry point the pad IS the harmony and
   * needs its third" was true when it was written and is not true now: three
   * other lanes state the third and two of them are gated by nothing.
   */
  const rootPc = (((m.chord.root % 12) + 12) % 12);
  const ivOf = (n: number): number => ((((n % 12) - rootPc) % 12) + 12) % 12;
  const openTones = m.chord.notes.filter((n) => {
    const iv = ivOf(n);
    // Root, perfect fifth, or the diminished fifth locrian gives instead.
    return iv === 0 || iv === 7 || iv === 6;
  });
  /*
   * ...EXCEPT ON A PIVOT, where the pad keeps the ROOT AND THE THIRD.
   *
   * The counter-example below still holds — the incoming dominant's major third
   * is the new key's leading tone and an open fifth belongs to no key at all —
   * and it is now expressed as a different dyad rather than as a whole chord.
   * Root and major third fold to a minor sixth, so this shape is cluster-free
   * for the same reason the fifth is.
   */
  const pivotTones = m.chord.notes.filter((n) => ivOf(n) === 0 || ivOf(n) === 4);
  // Never let the guard empty the pad: a voicing rule that can silence a lane
  // is a bug waiting for the one chord that trips it.
  const chosen = m.chord.pivot ? pivotTones : openTones;
  const opened = chosen.length >= 2 ? chosen.slice(0, 2) : m.chord.notes.slice(0, 2);
  /*
   * THE WINDOW IS `LANE_RANGE.pad`, NOT A CONDITIONAL DROP.
   *
   * This was `n > m.tonic + 5 && n - 12 >= 45 ? n - 12 : n` — a rule that
   * depended on the key, fired only when the melody was sounding, and had no
   * ceiling at all. Two rules were deciding where this lane sits (that one and
   * `voiceLead`'s window) and neither was written anywhere a tool could read,
   * which is how `registermap` came to measure the pad and the stab as the two
   * largest occupants of the same 250 Hz band.
   *
   * Folding into the declared window is unconditional and total: every hap this
   * lane emits is inside `LANE_RANGE.pad` by construction, so the gate that
   * asserts it cannot be satisfied by a chord that happens not to trip a
   * threshold. The open-fifths rule above still decides WHICH tones; this only
   * decides where they sound.
   */
  const voiced = foldInto(opened, LANE_RANGE.pad.lo, LANE_RANGE.pad.hi);

  /*
   * THE STABS ARE NO LONGER THE PAD'S NOTES.
   *
   * Measured, off the haps rather than off this file: `tools/registermap.mjs`
   * groups the `chords` lane by oscillator and duty, and `chords/pulse:pw0`
   * (the pad) and `chords/pulse:pw0.5` (the stab) came back with the IDENTICAL
   * range, MIDI 51-62 at p5-p95, over 21,120 and 46,464 haps. They were in
   * unison, on one orbit, differing only in envelope and pan. Two voice groups
   * playing the same notes in the same octave are not two parts; they are one
   * part with a tremolo, and they were the two largest contributors to a mix
   * with 66.6% of its energy in the 250 and 500 Hz bands.
   *
   * A comping keyboard does not double its own left hand. The pad keeps the
   * low open fifths it was deliberately moved down to — it is the bed — and
   * the stab takes the UPPER STRUCTURE: the full triad, third included, folded
   * into the octave above the pad. Three consequences, and the third is the
   * one that matters:
   *
   *   1. The third comes back into the harmony. `opened` drops it from the pad
   *      whenever the melody is playing, on the grounds that the motor is
   *      already stating it. Now the stab states it too, in its own register,
   *      so the chord is complete without the pad having to hold the interval
   *      that grinds against the tune.
   *   2. The two lanes are audibly two parts: root-and-fifth held low, triad
   *      struck on the offbeats an octave up.
   *   3. It empties the 250 Hz band of one of its two largest occupants
   *      without removing a note from the score.
   *
   * The window is `LANE_RANGE.stab` — 68-80, which is clear of the motor's
   * ceiling of 69 by one semitone and sits under the tune. Against the tune
   * this lane is a 25%-duty pulse lasting 220 ms on the offbeats, which is the
   * one relationship in the file where two lanes in one octave do not fight.
   *
   * THE TONES ARE THE CHORD'S OWN, folded — NOT the iReal spelling.
   *
   * `laneTones` would spell the chord symbol at this lane's anchor, which is
   * the corpus idiom and is what the ARP uses. It is the wrong source HERE, and
   * the reason is worth stating because it is the one place the two designs
   * disagree: a symbol has no way to express which extension the ACT has
   * unlocked. `Extension` replaces the third with the ninth from the
   * intensification on, and that substitution lives in `chord.notes` — a
   * symbol-driven voicing would go on spelling `A-7` and the reserved material
   * would never reach the one lane that states it.
   *
   * So the stab states the chord AS BUILT, in its own window. It still brings
   * the SEVENTH into this lane, which it never had: the pad is open fifths
   * whenever the melody plays, and a chord whose seventh existed only as a
   * fader was, in every lane that mattered, a triad.
   */
  const stabFolded = foldInto(m.chord.notes, LANE_RANGE.stab.lo, LANE_RANGE.stab.hi);
  /*
   * The root goes, and that keeps the ONSET COUNT flat.
   *
   * An upper structure is the chord minus the note the bass and the bed are
   * already holding. Dropping the root is what makes this two parts instead of
   * one: the pad holds root and fifth low, the stab strikes third and fifth an
   * octave up, and between them the triad is complete with no pitch stated
   * twice in the same instant.
   *
   * It is also the difference between an arrangement change and an addition.
   * The pad is a dyad whenever the melody is playing, so folding the full
   * triad into the stab took this lane from two voices to three: measured on
   * the first pass, `chords/pulse:pw0.5` went from 46,464 haps to 69,696 over
   * the identical 10,560-state sweep, and mean pitched note-events per bar
   * from 41.1 to 44.7. `attackfloor` already reads 36 onsets a second and
   * `MASTER_PLAN` §7 names onset density as the leading remaining suspect for
   * "abrasive over time"; paying for register separation in transients would
   * be trading one complaint for another. Back to 46,464.
   *
   * Guarded, because a voicing rule that can empty a lane is a bug waiting for
   * the one chord that trips it — the same guard `opened` carries above.
   *
   * ---------------------------------------------------------------------
   * GUIDE TONES, and this is what keeps the onset count flat.
   * ---------------------------------------------------------------------
   *
   * It was `stabFolded.slice(1)` — the folded chord minus its root, which was
   * two voices while the chord was a triad and would be four now that it is a
   * seventh with an iReal spelling. Four would be a 100% rise in this lane's
   * transient count, and `attackfloor` already reads 36 onsets a second with
   * `MASTER_PLAN` §7 naming onset density as the leading suspect for "abrasive
   * over time". Register separation paid for in transients is one complaint
   * traded for another.
   *
   * So it takes the two tones that a comping player's right hand actually
   * plays: the THIRD and the SEVENTH. Those two are the guide tones — they are
   * what distinguishes a minor seventh from a half-diminished from a dominant,
   * and the root and the fifth are the two the bass and the bed are already
   * holding. Two voices, the same as before, now carrying the information the
   * chord symbol contains instead of a doubling of the pad.
   */
  const stabPc = ((((m.chord.root % 12) + 12) % 12));
  const stabGuide = stabFolded.filter((n) => {
    const iv = ((((n % 12) - stabPc) % 12) + 12) % 12;
    // Everything that is not the root and not a perfect or diminished fifth.
    return iv !== 0 && iv !== 7 && iv !== 6;
  });
  const stabVoiced = stabGuide.length >= 2 ? stabGuide.slice(0, 2) : stabFolded.slice(-2);

  /*
   * A pad first, stabs second.
   *
   * Previously this was stabs only, which left nothing sustaining anywhere in
   * the mix — so between kick hits there was silence, and the track read as
   * percussion with decoration rather than as music. The pad is the bed
   * everything else sits on, heavily low-passed and drenched in room so it adds
   * warmth without adding anything for the ear to fight.
   */
  // Same reasoning as the sub: during the intro the pad restates twice a bar so
  // the opening cannot begin with a bar of silence.
  /*
   * A HOLLOW PULSE, not a supersaw.
   *
   * Timbre is the fastest thing the ear reads genre from — faster than rhythm,
   * far faster than harmony — and a detuned supersaw is a dance-music sound
   * with no equivalent anywhere in the 8- and 16-bit canon. It could not be
   * there: a supersaw is seven voices spent on one note, and these scores had
   * eight voices for the entire arrangement. Width in that music comes from
   * octave doubling and from the SPC700's echo unit, never from detuning.
   *
   * A 50%-duty pulse — `pw(0)`, since superdough's worklet maps duty to
   * `(1 - pw) / 2` — is a hollow, clarinet-ish square. It is the standard
   * harmony timbre on every one of those chips, and against a supersaw it is
   * enormously less fatiguing for the same reason it is less impressive alone:
   * a square has only odd harmonics, and no detuning means no beating. The
   * previous comment here was already chasing that fatigue with a 1900Hz
   * ceiling and `lpq(0.9)`; this removes the cause instead of filtering it.
   *
   * SPREAD keeps its meaning without the detune — but NOT via `.spread()`,
   * which is the mistake this comment used to enshrine. That control is read
   * only in superdough's `supersaw` branch, so from the moment this lane became
   * a pulse the powerup did nothing at all here. It is now real stereo
   * placement of the voices, done by `fanPans` and an explicit `.pan()` per
   * chord tone, which is what the powerup's name says and what a chip would
   * actually have done with a second channel.
   */
  // Fanned across the field rather than stacked in the centre. See `fanPans`
  // for why `.spread()` had to go: it is a supersaw-only control and has done
  // nothing on this lane since it became a pulse.
  const padPans = fanPans(voiced.length, 0.52 + spread * 0.16 + wide);
  /*
   * EACH VOICE BREATHES AT ITS OWN RATE, and the beating between them is the
   * point rather than the wobble on any one of them.
   *
   * `strudel.d.ts`'s own note on `vib` says it plainly: "A pulse or triangle
   * held at a fixed frequency is a test tone — the ear hears an oscillator. The
   * same note with a few cents of periodic movement is heard as *sung*, because
   * every physical instrument and voice does it. Its absence is a large part of
   * what makes a chip melody read as synthetic." That note has been sitting in
   * the type declarations while `.vib()` appeared in exactly ONE place in the
   * whole score — `buildLead` — so every other pitched lane, this bed included,
   * has been a mathematically perfect oscillator.
   *
   * This lane is the worst place for that to be true. It is the bed: held under
   * everything, 27,752 haps, second-loudest pitched lane at -15 dBFS, tails out
   * to 2.2 seconds. A chord of three to five perfectly steady pulses is the
   * single most fatiguing thing a mix can hold under a listener for twelve
   * minutes, and "abrasive on the listener over time" is what that fatigue
   * sounds like when someone describes it.
   *
   * `.detune()` is the obvious fix and is unavailable: superdough only reads it
   * in the `supersaw` branch, and this lane is a pulse on purpose. So the
   * ensemble is built the other way round — each chord tone gets its OWN
   * vibrato rate, 4.6Hz upward in steps of 0.43, and because no two voices
   * return to centre together their sum is never the same twice. That is what a
   * section of players sounds like, and it is the nearest thing to a chorus
   * available without a chorus node.
   *
   * Depth is deliberately far under the 0.1-0.2 the docs call ordinary: at 0.06
   * a semitone is ~6 cents, well inside what a held note can carry without the
   * harmony smearing. Per-voice depth is not what makes this work; the
   * disagreement between the rates is.
   *
   * Both controls are set, always. The oscillator is behind `if (vib > 0)`, so
   * `.vibmod()` alone is silent, and `.vib()` alone takes superdough's default
   * depth of 0.5 — half a semitone, which on a sustained chord would be audibly
   * out of tune. That trap is documented in `strudel.d.ts` and is easy to walk
   * back into.
   */
  const padVoice = (n: number, pan: number, i: number): Pattern =>
    note(m.section === 'intro' ? chordStabs([n], 2) : `${n}`)
    .s('pulse')
    .pw(0)
    .pan(pan)
    .vib(4.6 + i * 0.43)
    .vibmod(m.sig.openness.range(0.045, 0.075))
    .attack(0.45)
    .decay(0.5)
    .sustain(0.75)
    .release(m.sig.hold.range(0.9, 2.2))
    /*
     * The ceiling comes down and the resonance comes off.
     *
     * "too much high pitch synth always playing, its taxing on the ears" is a
     * description of sustained saw harmonics in the 2.5-6kHz fatigue band, and
     * a pad that is held under everything else is the largest single
     * contributor to it. At 1900Hz the chord keeps its body and its width and
     * stops competing with the melody for the top of the spectrum, which is
     * also where it belongs musically: this is the bed, not a voice.
     */
    /*
     * A NEGATIVE RESULT, recorded so it is not re-derived. Opening this
     * ceiling is NOT where the mix's missing air comes from.
     *
     * The reasoning that says it should be is good, which is why it was tried:
     * the argument above is about "sustained SAW harmonics", and this lane is
     * not a saw any more — it is a 50%-duty pulse (`pw(0)`), chosen fifty lines
     * up precisely because a square is "enormously less fatiguing". A ceiling
     * derived for an instrument the lane no longer is, over a group that is
     * **27% of the whole mix** by soloed-stem reconstruction, whose
     * fundamentals are 156-294 Hz behind a cutoff that evaluates to **1230 Hz
     * at mid openness — harmonics 1, 3, 5, 7 and nothing else**.
     *
     * Measured, `range(560, 1900)` against `range(760, 3200)` (1980 Hz at mid),
     * paired, same seed, same day. Soloed, the `chords` stem moved **+1.5 dB at
     * 2 kHz and +0.7 dB at 4 kHz** against a soloed-render noise floor of
     * 0.00 dB, so the filter change is real. In the FULL MIX it was worth
     * **+0.2 dB in the 2 kHz band** — this lane owns about 15% of that band —
     * which is a sixth of `capture.mjs`'s own 1.3 dB full-mix noise floor.
     *
     * So: a real change to one lane, invisible in the mix, bought by putting
     * -19 dB harmonics at 2-3 kHz under a listener continuously — which is the
     * one thing this file has a recorded human complaint about ("too much high
     * pitch synth always playing, its taxing on the ears"). Reverted. The air
     * came from the clap, from the lead's decoration becoming a pulse, and
     * from the arp's filter, all of which are sources rather than filters.
     */
    .lpf(m.sig.openness.range(560, 1900))
    /*
     * 110 Hz, not 20 — a REGISTER BOUNDARY that exists at full health.
     *
     * `thin` is the player-damage signal (`director.ts:955`,
     * `pow(1 - health, 1.35)` through a damp), so it is 0 whenever nobody has
     * been hit. Measured off the haps by `tools/registermap.mjs`: every one of
     * this lane's 21,120 haps carried `hcutoff` exactly 20 at full health.
     * Five highpasses across `layers.ts` read as lane separation and all five
     * were doing nothing in ordinary play; they were a mix-wide thinning
     * gesture wearing a boundary's clothes.
     *
     * The base is now the boundary and the damage signal still rides on top of
     * it. 110 Hz is a fifth below this lane's lowest fundamental (measured
     * MIDI 51 = 156 Hz at p5, and `voiced` will not fold below 45), so it
     * removes only the skirt this pulse puts under the bass and the sub, and
     * not one note.
     *
     * NO `.ftype()` ANYWHERE IN THIS CHAIN, and that is load-bearing rather
     * than incidental: superdough has one shared filter-model control, so an
     * `.hpf()` beside an `.ftype('ladder')` is a second 24 dB/oct LOWPASS
     * (AGENTS.md §4). `registermap` prints the `ftype` count per voice group
     * and this lane reads 0.
     */
    .hpf(m.sig.thin.range(110, 400))
    // A resonant peak is a narrow band the ear cannot stop hearing. On a
    // sustained source it should be nearly flat.
    .lpq(m.sig.ring.range(0.9, 3.4))
    .room(m.sig.space.range(m.section === 'breakdown' ? 0.78 : 0.58, 0.95))
    .roomsize(m.section === 'breakdown' ? 8 : 6)
    .gain(m.section === 'breakdown' ? 0.5 : 0.42)
    .orbit(ORBIT_HARMONY);

  /*
   * One voice per chord tone, each with its own place in the field.
   *
   * The level is unchanged: `chordOf` already produced one simultaneous voice
   * per note at this gain, so stacking them costs nothing extra — the only
   * difference is that they are no longer all in the same speaker.
   */
  const pad = stack(...voiced.map((n, i) => padVoice(n, padPans[i], i)));

  /*
   * The 7th and 9th, as a fade rather than a chord change.
   *
   * `chordForBar` used to add these to the chord above tension thresholds of
   * 0.35 and 0.7, which rewrote the pad AND shifted the arp's pitch walk under
   * it — the arp kept 44% of its phrase across one step of the tension dial and
   * the pad 75%. They now always exist as `chord.colour` and swell in on their
   * own signals, the 7th first, so the harmony opens up continuously and no
   * note is ever replaced.
   *
   * `nova` and the shuffle floor them open: safety should be audible as
   * harmonic space, and a plain triad over a swing feel sounds like a mistake
   * rather than a choice.
   */
  /*
   * HUSHED floors the colour tones open alongside nova and the shuffle.
   *
   * Nova already means "you are safe" as harmonic space, and a wave where
   * nothing shoots is the same statement made by the stage instead of by a
   * powerup. It is the difference between the movement being quieter and the
   * movement being *prettier*, which is the whole idea.
   */
  const floor = m.feel === 'shuffle' || nova > 0 || m.movement === 'hush' ? 1 : 0;
  /*
   * NO `+ 12` ANY MORE, and its removal is half of why this group's measured
   * span was thirty-four semitones.
   *
   * `voiceLead` places the colour tones and this line then moved them an octave
   * further up, so the lane's real register was the sum of two rules neither of
   * which stated a ceiling: `registermap` measured MIDI 56-90 across 50,688
   * haps. `voiceLead` now leads them into `LANE_RANGE.colour` (78-90) and this
   * plays exactly where it is told, with a fold as the belt-and-braces so the
   * window is a guarantee rather than an expectation.
   */
  const colourVoice = (pitch: number, level: Patternable, pan: number, i: number): Pattern =>
    note(String(foldInto([pitch], LANE_RANGE.colour.lo, LANE_RANGE.colour.hi)[0] ?? pitch))
      /*
       * These carry vibrato for the same reason the pad does, and they need it
       * more than the pad does: `release(1.1..2.6)` makes them the LONGEST
       * sustained tones anywhere in the mix, and they are the highest pitched
       * ones as well. A perfectly steady tone held for two and a half seconds
       * at the top of the arrangement is the definition of the test tone
       * `strudel.d.ts` warns about.
       *
       * Rates sit deliberately outside the pad's 4.6-5.46 band so the bed never
       * locks into one collective wobble — the whole value of per-voice rates
       * is that nothing agrees. Depth is slightly wider than the pad's because
       * there are only ever two of these, so there is less mutual beating to do
       * the work, and because the ear forgives more movement in a high colour
       * tone than in the chord's own body.
       *
       * ---------------------------------------------------------------------
       * 5.9-6.4 Hz -> 0.37-0.61 Hz: this is DRIFT now, not vibrato
       * ---------------------------------------------------------------------
       *
       * Same brief as `percGrid`. The reference asked for is analogue
       * instability — tape wow, an oscillator that will not stay put — and
       * that is a SUB-HERTZ movement. At 5.9 Hz the ear integrates the wobble
       * into the tone's identity and hears a singer; at 0.37 Hz a note lasting
       * two and a half seconds gets through about one cycle, so it is heard as
       * the note itself being slightly sharp and then slightly flat. Two tones
       * doing that at 0.37 and 0.61 Hz are never in tune with each other in
       * the same way twice.
       *
       * This is the right pair of voices to spend it on and the only pair. They
       * are the two longest and highest sustained tones in the score — a drift
       * needs a note long enough to drift ACROSS, and nothing else here has
       * one. The pad's three voices keep their 4.6-5.46 Hz vibrato untouched,
       * because they are the bed and a bed that will not hold its pitch is not
       * a bed; the argument three blocks up for per-voice rates is about them
       * and still stands in full.
       *
       * Depth comes down slightly with the rate. At 5.9 Hz a 10-cent excursion
       * is a wobble the ear tracks; at 0.4 Hz the same 10 cents is a slow
       * detune against everything else holding, so a little less of it goes
       * much further. Both controls are still set, always, for the reason the
       * block above gives — `.vibmod()` alone is inert and `.vib()` alone
       * takes a default depth of half a semitone.
       *
       * `tools/vibprobe.mjs` prints rate and depth per stem and has no
       * thresholds, so this shows up there as a changed number rather than as
       * a pass. WHAT IT SOUNDS LIKE IS UNVERIFIED: nobody has heard it, and a
       * drift that is too slow is indistinguishable from being out of tune.
       */
      .vib(0.37 + i * 0.24)
      .vibmod(m.sig.openness.range(0.05, 0.085))
      /*
       * Triangle, not supersaw.
       *
       * These two tones sit above the triad and are the highest sustained
       * pitches in the mix, so they are the worst place in the arrangement for
       * a saw's harmonic series. A triangle carries only odd harmonics falling
       * as 1/n squared: at this register that is close to a flute and it adds
       * colour without adding edge, which is the entire job of a 7th and a 9th.
       */
      .s('triangle')
      .attack(0.6)
      .decay(0.5)
      .sustain(0.8)
      .release(m.sig.hold.range(1.1, 2.6))
      /*
       * THE FILTER WAS BELOW THE NOTE.
       *
       * These are the highest sustained pitches in the arrangement and the
       * whole argument above is about what their harmonics do. Measured off
       * the haps (`tools/registermap.mjs`, 21,120 haps): this group emits
       * MIDI 79-91 at p5-p95 — fundamentals of 784-1568 Hz — behind a lowpass
       * that sat at 1450 Hz at mid openness. The ratio of cutoff to
       * fundamental was **1.4x**, the lowest of any voice group in the score,
       * so for the top of its own range this lane was being attenuated below
       * its fundamental and everywhere else reduced to a sine. A 7th and a 9th
       * written as "colour" were rendered as two test tones.
       *
       * That is also half of "dull", measured: the full mix carries 3.2% of
       * its energy above 2 kHz across four octave bands, and no pitched lane
       * in the file had a lowpass above 2.8 kHz.
       *
       * 2600-6500 lets the 3rd and 5th partials through. On a triangle those
       * fall as 1/n squared — the 3rd is 19 dB down and the 5th 28 dB — so
       * this is air rather than edge, which is exactly why the source is a
       * triangle and not a saw. Two voices, at gain 0.3, on the quietest
       * pitched group in the mix.
       */
      .lpf(m.sig.openness.range(2600, 6500))
      // A real boundary, not the dead one. See the pad's highpass: `thin` is 0
      // at full health, so `range(20, ...)` was 20 Hz on every hap. 420 Hz is
      // well under this group's lowest measured fundamental of 784 Hz.
      .hpf(m.sig.thin.range(420, 900))
      .lpq(m.sig.ring.range(0.9, 3.4))
      .room(m.sig.space.range(0.62, 0.95))
      .roomsize(7)
      .gain(level)
      /*
       * Placed either side, always — not only when FLANKED.
       *
       * `registermap` counted 9 of 15 voice groups sitting inside +/-0.05 of
       * centre, this one among them: `0.5 + pan * wide` is exactly 0.5 unless
       * the wave happens to be a flank, which is one wave in twelve. Two
       * sustained tones a tone or a semitone apart, summed to the same point,
       * beat against each other; the same two tones 36% of the field apart are
       * heard as two voices. FLANKED still widens them further.
       */
      .pan(0.5 + pan * (0.18 + wide))
      .orbit(ORBIT_HARMONY);
  /*
   * 0.3 -> 0.45. The comment above opened this group's LOWPASS to 6.5 kHz on
   * the grounds that it is the highest sustained pitch in the arrangement and
   * "that is also half of dull, measured". Opening a filter over a lane at
   * gain 0.3 buys 0.3-worth of air.
   *
   * Measured since, off soloed renders: the `chords` stem's whole 1 kHz band
   * is -36.1 dBFS in-mix and its 2 kHz band -45.6, and this triangle pair —
   * fundamentals 784-1568 Hz, the only pitched group in the file whose
   * fundamental is above 700 Hz — is what puts anything there at all.
   * +3.5 dB of energy, on the quietest pitched group in the mix, two voices.
   */
  const colourGain = 0.45;
  /*
   * The colour tones are deliberately NOT register-disciplined, and TWO
   * attempts to impose it were measured and refuted.
   *
   * `voiced` above folds pad notes above `tonic + 5` down an octave so the bed
   * sits under the tune, and the obvious next step is to do the same to the
   * 7th and 9th: `masking` reports the `chords` lane spanning MIDI 52 to 87
   * (p5 to p95) against the lead's 53 to 78, with `chords+lead` accounting for
   * 44% of all audible masking weight — the largest pair by a wide margin.
   *
   * Folding them makes it WORSE, monotonically. Measured per-bar masking with
   * a ceiling applied to the colour tones:
   *
   *     none  1137.5      76 -> 1309.4      72 -> 1533.7      68 -> 1856.2
   *
   * The high colour tones are staying OUT of the way. Folding them lands them
   * in the middle, where the pad's own voicing, the bass and the motor already
   * are, and the extra collisions there outweigh the ones removed from the
   * melody's octave. `THEMES[2]`'s note records the same effect from the other
   * direction — a narrower-span melody scored worse, not better.
   *
   * The same was then tried on the BASS, whose octave note is `chord.root` and
   * so lands wherever the harmony puts it — p95 of MIDI 65, which is tenor
   * range, and `bass+chords` plus `bass+lead` are 30% of the weight. Capping
   * it to take the fifth instead (the shape `MOTOR_TOP` already uses next
   * door) also made things worse, if only slightly:
   *
   *     none 1137.5      64 -> 1140.4      60 -> 1153.4      57 -> 1153.5
   *
   * Two experiments, both in the direction the register table suggests, both
   * refuted. The conclusion is not "try a third": five lanes sharing about
   * three octaves will collide, and moving a voice between registers
   * RELOCATES collisions rather than removing them.
   *
   * AND MASKING IS NOT AN OBJECTIVE. It has no target and no zero worth
   * reaching — a mix with one lane in it scores nothing. `THEMES[2]`'s note
   * already accepts a 9% rise as the price of a better tune, on the grounds
   * that "a tune nobody can hum is a worse failure than 9% more critical-band
   * roughness". Treat this number as a diagnostic that says WHERE lanes meet,
   * not as a score to drive down.
   */
  const colourPad = stack(
    ...m.chord.colour.map((pitch, i) =>
      colourVoice(pitch, (i === 0 ? m.sig.colour7 : m.sig.colour9).range(floor * colourGain, colourGain), i === 0 ? -1 : 1, i),
    ),
  );

  if (m.section === 'breakdown') return stack(pad, colourPad);

  /*
   * Offbeat stabs — the classic placement, and it leaves the downbeat to the
   * kick instead of doubling it.
   *
   * The default feel used to pick between "no stabs at all", two stabs and four
   * from thresholds on intensity, so crossing one replaced the lane. The two
   * offbeats are now always present and the downbeats fade in over them, which
   * adds up to the same four-stab bar the busy case played while keeping the
   * offbeats untouched underneath.
   */
  const stabLevel = 0.4;

  if (m.feel === 'halftime') {
    /*
     * A clavinet comp, which is the "funky" half of the brief.
     *
     * Half-time drums and a wobble bass on their own are heavy and slow, and
     * heavy and slow is a mood rather than a groove — there is nothing in the
     * bar moving fast enough to make a body want to move with it. Funk solves
     * this the same way it always has: something short, bright and syncopated
     * playing sixteenths in the space the drums left, which in half-time is
     * nearly the whole bar.
     *
     * A clav rather than the supersaw stab used everywhere else, because the
     * supersaw is a sustained, wide, harmonically dense sound and there is now
     * a sustained, wide, harmonically dense sound already occupying the mids.
     * A clav is the opposite of all three — one narrow band, gone in 80ms — so
     * it cuts through the wobble instead of piling onto it.
     */
    // The upper structure, same as the stab. See `stabVoiced`: a clav is a
    // comping instrument and it was playing the pad's notes in unison too,
    // which on this feel put it under its OWN highpass — measured hcutoff 260
    // against fundamentals of 156-294 Hz, so the bottom two thirds of its
    // range was in the stopband of the filter that was supposed to keep it
    // clear of the wobble. Moving it up is what makes that highpass mean
    // something.
    const chord = chordOf(stabVoiced);
    /*
     * The comp, split so that the eighth-note skeleton and the offbeat
     * sixteenths are separate layers.
     *
     * That split does two jobs at once. It makes the part additive — the
     * sixteenths fade in over a skeleton that never moves, which is the rule
     * every other lane in this file follows — and it means the sixteenths, and
     * only the sixteenths, can be shuffled to sit with the hats. Swinging notes
     * that fall on the eighth-note grid is not a shuffle, it is being late.
     */
    const skeleton = `[~ ~ ${chord} ~] ~ [~ ~ ${chord} ~] [${chord} ~ ${chord} ~]`;
    const offbeats = `~ [~ ${chord} ~ ${chord}] [~ ~ ~ ${chord}] ~`;
    /*
     * The clav voice: a square, a fast filter envelope, and a resonant peak.
     *
     * The envelope is the wah. A clavinet through a pedal is a resonant band
     * being pushed up on every stroke and falling back before the next one, and
     * an eighth of a second is all it gets — past that it stops being a plucked
     * sound. `lpenv` is kept to 1.4 octaves over a ceiling of 950Hz so the peak
     * tops out around 2.5kHz: bright enough to cut, and short of the band
     * `npm run audiocheck` fails a run for living in.
     */
    const clav = (rhythm: string, level: Patternable): Pattern =>
      note(rhythm)
        /*
         * DOWN AN OCTAVE, out of the melody's register.
         *
         * Reported from play: "why are there multiple conflicting melodies and
         * theyre all on different tempos too, very confusing". The register map
         * says exactly where that comes from. `tools/registermap.mjs` over
         * 761,376 haps:
         *
         *   chords/pulse:pw0.5   MIDI 67-75
         *   chords/square        MIDI 67-75   <- this voice, identical window
         *   lead/triangle        MIDI 69-80
         *   lead/pulse           MIDI 70-81
         *   arp/triangle         MIDI 69-83
         *
         * Five voice groups inside one octave, each on its own subdivision.
         * That is not a mix problem and no amount of gain work reaches it: it
         * is an ORCHESTRATION problem, and the rule it breaks is the oldest one
         * there is — voices are separated by register or by rhythmic function,
         * and preferably both. A clav and a pad in the same octave playing
         * different rhythms do not read as two parts, they read as one confused
         * part.
         *
         * The clav is the voice that should move, because it is the RHYTHMIC
         * one. A pad sustains and can hold the alto register without obscuring
         * a melody above it; a stab is transient and competes directly. Down an
         * octave it becomes what a clavinet actually is in an arrangement — an
         * inner rhythmic voice under the tune, not a second tune.
         *
         * This does NOT fix the count. Lead, motor and arp are still three
         * independent lines and the honest fix for that is fewer of them
         * sounding at once, which belongs in orchestration's voice budget
         * rather than here. This moves one voice out of the pile-up and is
         * measurable; the rest is recorded in the changelog as still open.
         *
         * -----------------------------------------------------------------
         * AND THE OCTAVE IS BACK, BECAUSE THE PILE-UP IT AVOIDED IS GONE.
         * -----------------------------------------------------------------
         *
         * A rejected — or in this case an adopted — move expires when its
         * premise changes, and this one's premise was the five-voice-groups
         * table above. Three of those five have moved: `arp/triangle` is at
         * 84-93 now rather than 69-83, and the stab and the clav are voiced
         * from `LANE_RANGE.stab` (68-80) rather than from a hand-written 64-76.
         * What is left in that octave is the tune's own two layers and one
         * upper-structure part, which is an arrangement rather than a pile-up.
         *
         * Meanwhile the `-12` had become a collision of its own, and
         * `registermap` says so: it put this voice at MIDI 56-66 against the
         * motor's 58-65 — and the motor plays under EVERY bar of the halftime
         * feel, which is the only feel this voice exists on. The move that was
         * "out of the pile-up" is now "into the clock".
         *
         * The clav is also, on this feel, not an extra part at all: the
         * halftime branch returns pad + colour + clav and no `stabVoice`, so
         * this IS the stab. A stab belongs in the stab's register.
         */
        /*
         * THIS VOICE IS THE "PINGING", NAMED BY THE OWNER: "the pinging noise
         * is just really bad base type of sound ... i mean clav or whatever
         * that sound is".
         *
         * It was a RAW SQUARE with a 3ms attack, an 80ms decay to SILENCE, a
         * 50ms release and no reverb whatsoever. Every one of those four is a
         * ping generator on its own and together they are nothing else: a
         * square has odd harmonics all the way up with no rolloff, 3ms is below
         * the ear's threshold for hearing an onset as anything but a click, and
         * decaying to zero sustain means the note has no body to speak of. It
         * was doing this in the melody's own octave until this pass moved it
         * down.
         *
         * A real clavinet is a PLUCKED STRING under a pickup. It has an onset
         * you can hear, a short body, and it lives in a room. Three changes:
         *
         *   triangle, not square — a triangle rolls off at 1/k^2 against the
         *   square's 1/k, so the top two thirds of the harmonic ladder that
         *   makes this read as a ping simply is not generated. The `lpf` below
         *   was already trying to remove it after the fact, which is always
         *   more expensive and less complete than not making it.
         *
         *   a 14ms onset and a real sustain — 0.003 to 0.014 puts the attack
         *   where a plucked string actually is, and sustain 0.16 gives the
         *   release something to ramp FROM. AGENTS.md §3 records that lengthening
         *   release on a sustain(0) lane is the archetypal gate-passing no-op,
         *   because superdough ramps release from sustain: 0.05 -> 0.22 only
         *   means anything alongside the sustain change.
         *
         *   and 0.28 of room. 55 of the 60 songs in
         *   eefano/strudel-songs-collection use `.room()`; this lane used none,
         *   in a mix where the pad sits at 0.28 and the lead at 0.34. A dry
         *   voice next to wet ones does not sound like a different instrument,
         *   it sounds like a cheap one.
         *
         * It stays SHORT and it stays a stab. The point is that it is a plucked
         * note rather than a transient, not that it becomes a pad.
         */
        .s('triangle')
        .ad('0.014:0.11')
        .sustain(0.16)
        .release(0.22)
        .room(0.28)
        /*
         * 700-1600, and the envelope peak lands where the comment always said
         * it did. The old ceiling of 950 Hz with `lpenv(1.4)` topped the wah
         * out at 950 * 2^1.4 = 2.5 kHz only at FULL openness; at the mid
         * openness this score spends its time at, the cutoff measured 675 Hz
         * and the peak reached 1.8 kHz — 3.1 harmonics of a note whose
         * fundamental is 330 Hz. A clav with three harmonics is a sine with a
         * wah on it. This puts the peak at 4.2 kHz when the mix is open, which
         * is where a clavinet actually speaks and is the band the whole mix is
         * missing.
         */
        /*
         * 700-1600 -> 1300-3000, BECAUSE THE NOTE MOVED AND THE FILTER HAS TO
         * MOVE WITH IT. This is the third time this exact defect has been
         * found in this file and it is always the same shape: a lane is
         * transposed and its lowpass is left where it was, so the instrument
         * loses its harmonics and turns back into a sine.
         *
         * The paragraph above derives its numbers from "a note whose
         * fundamental is 330 Hz" — the clav at `stab - 12`. Removing the octave
         * puts this voice at MIDI 68-80, 415-830 Hz, and `registermap` read the
         * cutoff-to-fundamental ratio at 1.7x, which is the lowest in the file
         * and the same number the colour tones scored before they were fixed
         * for it.
         *
         * The ratio is what is being kept constant here, not the frequency:
         * 1300-3000 against 415-740 Hz is 3.1x-4.0x, which is where the old
         * pair sat against the old range. With `lpenv(1.4)` the wah peak lands
         * at 3.4-7.9 kHz, which is where a clavinet actually speaks.
         */
        .lpf(m.sig.openness.range(1300, 3000))
        .lpq(3.2)
        .lpenv(1.4)
        .lpattack(0.004)
        .lpdecay(0.085)
        // Well clear of the wobble. Two things chopping at each other in the
        // same octave is mud, however different their envelopes are.
        .hpf(m.sig.thin.range(260, 760))
        .drive(m.sig.drive.range(0.5, 0.95))
        .distort('1.1:0.4')
        .gain(level)
        // Off-centre, opposite the hats' 0.56. The comp and the hi-hat are
        // playing the same sixteenths and they should not be in the same place.
        .pan(0.4)
        .room(0.16)
        .orbit(ORBIT_HARMONY);
    const clavLevel = 0.34;
    return stack(
      pad,
      colourPad,
      clav(skeleton, m.sig.density.range(clavLevel * 0.35, clavLevel)),
      clav(offbeats, m.sig.fill.range(0, clavLevel * 0.8)).late(0.016),
    );
  }

  let coreRhythm: string;
  let fillRhythm: string | null = null;
  if (m.feel === 'shuffle') {
    coreRhythm = `[~ ${chordOf(stabVoiced)}] ~ [~ ${chordOf(stabVoiced)}] ~`;
  } else if (m.feel === 'chase') {
    coreRhythm = `~ ~ ${chordOf(stabVoiced)} ~`;
  } else {
    coreRhythm = `~ ${chordOf(stabVoiced)} ~ ${chordOf(stabVoiced)}`;
    if (!half) fillRhythm = `${chordOf(stabVoiced)} ~ ${chordOf(stabVoiced)} ~`;
  }

  const stabVoice = (rhythm: string, level: Patternable): Pattern =>
    note(rhythm)
    /*
     * The second supersaw, and the last one. See the pad above for the full
     * argument; the short version is that a detuned saw stack is a dance sound
     * that no chip in this canon could produce, and the `chords` lane was two
     * of them at the highest ceiling in the mix.
     *
     * A 25%-duty pulse for the stab rather than the pad's 50% — `pw(0.5)` maps
     * to 25% duty in superdough's worklet. Thinner and reedier than the pad it
     * sits on, which is exactly the relationship a comping chord should have
     * with the bed underneath it: same harmony, different colour, so the ear
     * hears two parts instead of one thing getting louder.
     *
     * The old comment was right that "fewer voices is not a quieter stab, it is
     * a clearer one" — it had already walked seven detuned saws down to four.
     * This finishes the thought: one voice, and the clarity comes free.
     */
    .s('pulse')
    .pw(0.5)
    // Thin duties lose level as well as harmonics; 25% needs about +3dB to sit
    // where the saw stack did.
    .velocity(1.41)
    /*
     * Placed rather than "spread". `.spread()` was inert here for the same
     * reason it was on the pad — supersaw-only — so this lane has had no
     * stereo behaviour since it became a pulse.
     *
     * A single pan rather than a per-voice fan, because this lane's chord is
     * baked into its rhythm strings (`coreRhythm` interpolates `chordOf`), so
     * the voices are not separable here without restructuring the rhythm. One
     * offset is honest and still does the useful thing: it moves the stabs off
     * the pad's centre of mass, so the two harmony lanes stop occupying the
     * same point. It leans right because the pad's lowest voice sits left.
     */
    .pan(0.5 + 0.16 * clamp01(0.5 + spread * 0.16 + wide))
    .ad('0.008:0.22')
    .sustain(0.3)
    .release(0.2)
    .lpf(m.sig.openness.range(1100, 3600))
    // A boundary that exists at full health, and now it can be a real one:
    // `stabVoiced` folds into MIDI 64-76, so 300 Hz is a fourth below this
    // lane's own lowest fundamental of 330 Hz. Against the old unison voicing
    // (MIDI 51 = 156 Hz) it would have eaten the part. See the pad's highpass
    // for why the old base of 20 was doing nothing.
    .hpf(m.sig.thin.range(300, 700))
    // The filter envelope is what makes a stab bite. Halving it keeps the
    // articulation and drops the click that rides on top of it.
    .lpq(m.sig.ring.range(1.5, 4.5))
    .lpenv(1.1)
    .lpattack(0.006)
    .lpdecay(0.16)
    .drive(m.sig.drive.range(0.45, 0.85))
    .gain(level)
    .room(m.sig.space.range(0.28, 0.7))
    .orbit(ORBIT_HARMONY);

  const parts = [pad, colourPad, stabVoice(coreRhythm, m.sig.density.range(0, stabLevel))];
  if (fillRhythm) parts.push(stabVoice(fillRhythm, m.sig.ornament.range(0, stabLevel)));
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
   * Offbeats always; the even gaps fade in as it gets busy.
   *
   * Previously `density > 0.7` switched the even gaps on and off. Splitting the
   * same pitches into two lines lets that be a fader — the arp thickens instead
   * of being re-written — and the two together are exactly the line the busy
   * case used to play.
   */
  const core = pitchAt.map((n, i) => (n !== null && i % 2 === 1 ? n : '~')).join(' ');
  const fill = pitchAt.map((n, i) => (n !== null && i % 2 === 0 ? n : '~')).join(' ');

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
       * Triangle, and the resonant filter comes off with it.
       *
       * `lpq(7)` with `lpenv(4)` on a sawtooth is an acid line — a resonant
       * peak sweeping through the fatigue band on every note. That is a
       * deliberate and very recognisable dance sound, and it is the wrong genre
       * for a score that is being asked to sound melodic. The arp is filigree
       * behind the tune; it needs motion and pitch, not bite.
       */
      .s('triangle')
      /*
       * Legato, not dots.
       *
       * This was a 120ms decay to sustain 0 — at 130bpm an eighth note is
       * 230ms, so more than half of every arp note was silence. Eleven layers
       * of that is not an arrangement, it is morse code, and it is why the
       * music still read as "very choppy" after the rebuild churn was fixed:
       * the churn was gone but the texture was still made of disconnected
       * points.
       *
       * A held sustain lets one note reach the next, which is what turns a
       * sequence of pitches into a line.
       */
      .ad(half ? '0.006:0.26' : '0.004:0.2')
      .sustain(0.4)
      .release(0.18)
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
      .lpf(m.sig.openness.range(1900, 8000))
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
      .roomsize(4)
      .gain(level)
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
  const pod = (transpose: number, pan: number, level: number, sync: number): Pattern[] => [
    voice(core, transpose, clamp01(pan - wing), level, sync),
    voice(fill, transpose, clamp01(pan + wing), m.sig.fill.range(0, level), sync),
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
  const lines = melodyForBar(theme, m.phrase, m.barInPhrase, base, m.mode);

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
  const vibDepth = 0.09 + (held - 0.55) * 0.9;
  // A pushed singer vibrates a little faster. Narrow on purpose: a rate that
  // moves audibly is heard as an effect, and this should only be missed.
  const vibRate = m.boss ? 5.6 + m.bossPhase * 0.4 : 5.1;

  /*
   * THE BOSS LEAD IS LAVENDER TOWN, and the whole point is that it is WRONG.
   *
   * Asked for by name, on tzwaan's cover: "the lavender town example on there
   * would be sick for a boss fight". Its source is four voices, every one of
   * them `pulse` — no warmth anywhere — over a single filtered white-noise hit
   * for percussion. The character is not "heavier", it is THINNER and out of
   * tune:
   *
   *     note("...").s("pulse").vib("2.5:.2").adsr("0:.7:.4:.1").clip(.93)
   *     ...  .s("pulse").fm(15).tremsync("24").tremdepth(.4)
   *     .when("<0!4[1!3 0]>/4", x => x.vib("8:.2").tremdepth(.7)
   *                                   .gain(saw.range(.3, .8).slow(4)))
   *
   * Read what makes it unsettling rather than the notes, which are Junichi
   * Masuda's. `vib("2.5:.2")` is a SLOW two-and-a-half hertz wobble half a
   * semitone deep — deep enough that the pitch stops being one note, which is
   * the thing the ordinary lead's comment above is careful to stay under
   * ("past about 0.5 the pitch stops reading as one note and the melody goes
   * out of tune with the harmony under it"). That defect is the effect here.
   * And `.when(...)` swaps in EIGHT hertz for one phrase in five: the track
   * periodically gets worse, and periodically recovering is what makes it
   * frightening rather than merely dissonant.
   *
   * So the boss lead inverts three of this file's own rules on purpose, and
   * they are inverted here rather than relaxed there: the vibrato goes past the
   * in-tune ceiling, the rate drops to something audible as an effect, and a
   * tremolo runs under it. `bossPhase` drives all three, so the last act is the
   * most out of tune — the boss does not get louder, it gets sicker.
   *
   * `tremolodepth`, `tremolosync` and `tremolophase` are real superdough
   * controls (superdough.mjs:199, :598, :796) with `tremdepth`/`tremsync` as
   * the Strudel aliases; checked before writing rather than assumed, because
   * this file is full of controls that silently do nothing.
   */
  const bossSick = m.boss ? 0.45 + m.bossPhase * 0.35 : 0;
  const bossVibRate = 2.5 + m.bossPhase * 2.4;
  const bossTremDepth = 0.34 + m.bossPhase * 0.3;

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
  const voice = (line: string, transpose: number, level: Patternable, osc: string, pan: number): Pattern =>
    note(line)
      // See the note on `.add(note(n))` in buildArp: a bare number is dropped.
      .add(note(transpose))
      .s(osc)
      /*
       * superdough's worklet maps duty as `(1 - pw) / 2`, so 0.5 is a 25%
       * pulse — the NES melody duty, and the one whose 3rd and 5th partials
       * are strongest. Set unconditionally because `pw` is read only in the
       * pulse branch; on a triangle or a sawtooth it is inert, and a
       * conditional here would be a second place to keep in step with `decor`.
       */
      .pw(0.5)
      .attack(0.006)
      .decay(0.22)
      // Scales with level. This was `laser > 0 ? 0.4 : 0.12` — binary — so the
      // second and third LASER a player picked up sounded exactly like the
      // first. A repeat pickup should be worth hearing, and holding the lead
      // longer is the whole character of the powerup.
      // A soloist sustains; it does not pluck. Floored rather than replaced, so
      // holding LASER on a SOLOIST wave still lengthens it further.
      /*
       * The floor was 0.12 — the melody dropped to a tenth of its level almost
       * as soon as it spoke, so the tune was a row of taps rather than a line
       * anyone could follow. 0.55 is a singing sustain; LASER and SOLOIST still
       * push it further, they just no longer start from a whisper.
       */
      .sustain(held)
      .release(m.sig.hold.range(0.34, 1.1))
      .vib(m.boss ? bossVibRate : vibRate)
      /*
       * ADDED to the sustain-coupled depth, not substituted for it.
       *
       * The first version took `Math.max(vibDepth, bossSick)` and `leadcheck`
       * caught it immediately: "depth does not rise with sustain, 0.55->0.800
       * 0.62->0.153". Pinning the depth to a constant during a boss breaks the
       * rule that a longer note gets more vibrato, which is a real musical
       * coupling and not an artefact of the gate. Adding keeps the coupling
       * monotonic AND makes the boss deeper, so both hold at once — and the
       * gate stays exactly as strict as it was.
       */
      .vibmod(vibDepth + bossSick)
      .tremsync(24)
      // 0 outside a boss. Checked rather than assumed: superdough reads
      // `tremolodepth` through applyGainCurve and 0 is no modulation, NOT the
      // silence that `distort(0)` produces.
      .tremdepth(m.boss ? bossTremDepth : 0)
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
      .lpf(isBody(osc) ? m.sig.openness.range(500, 1400) : m.sig.openness.range(1900, 5000))
      // Real boundaries; `thin` is 0 at full health, so both of these read 20 Hz
      // on every hap until the player is hit. 90 clears the boss octave (the
      // -24 saw bottoms at MIDI 45 = 110 Hz); 300 is under the triangle's
      // lowest fundamental of 440.
      .hpf(isBody(osc) ? m.sig.thin.range(90, 400) : m.sig.thin.range(300, 700))
      .lpq(m.sig.ring.range(1.3, 4))
      .gain(level)
      .pan(pan)
      .orbit(ORBIT_HARMONY);

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
   * The SKELETON keeps its triangle. The tune itself is not being re-voiced —
   * it sings on the flute it always did. The filigree and the ornament are the
   * decoration around it, and giving a decorative line its own instrument is
   * what an arranger does with it. It is also the canon: the melody channels on
   * an NES are the two PULSE channels, and the triangle is the bass. This score
   * had it exactly the other way round.
   *
   * Only when the trio's own oscillator is the triangle — the boss stack and
   * the octave-down body call this with `sawtooth`, and those are deliberately
   * dark (`isBody` gives them a 500-1400 Hz lowpass).
   */
  const decor = (osc: string): string => (osc === 'triangle' ? 'pulse' : osc);
  const trio = (transpose: number, level: number, osc: string, pan: number): Pattern[] => [
    voice(lines.skeleton, transpose, level, osc, pan),
    voice(lines.filigree, transpose, m.sig.density.range(level * 0.2, level), decor(osc), clamp01(pan - 0.14)),
    voice(lines.ornament, transpose, m.sig.ornament.range(0, level * 0.55), decor(osc), clamp01(pan + 0.14)),
  ];
  // The tune sings on a triangle; the octave below is the saw that gives it
  // body. The descant is a triangle too — a sixth above the melody is the
  // highest pitch in the mix and the last place that wants a saw.
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
   * is the last place to put one. What moves is the doubling: the sawtooth
   * body sits at 0.40 and the descant answers at 0.62, so the lead reads as a
   * voice with something behind it rather than as one point source. Stereo
   * placement is the cheapest separation there is, and it costs no notes.
   */
  const voices = [...trio(0, lead * 1.15, 'triangle', 0.5), ...trio(-12, 0.3, 'sawtooth', 0.4)];
  /*
   * A boss is scored for LOW BRASS.
   *
   * The ordinary lead is a triangle with a quiet saw an octave under it — a
   * flute doubled by something with a little more body, which is right for a
   * tune that has to stay legible over a busy stage. It is also, unavoidably,
   * light. Playing the adversary's leitmotif on it makes the biggest moment in
   * the run sound like the smallest.
   *
   * So during a fight the balance inverts: the octave below comes up from 0.3
   * to nearly the level of the tune itself, and a second saw two octaves down
   * is added underneath. That is not a new melody — it is the same notes, three
   * octaves deep, which is exactly how the Imperial March is orchestrated and
   * why it reads as mass rather than as pitch. The triangle stays on top so the
   * line is still followable; everything under it is weight.
   *
   * Deeper with each phase, because a fight should get heavier as it goes and
   * this costs nothing but a gain.
   */
  if (m.boss) {
    voices.push(...trio(-12, 0.34 + m.bossPhase * 0.08, 'sawtooth', 0.6));
    voices.push(...trio(-24, 0.3 + m.bossPhase * 0.07, 'sawtooth', 0.42));
  }
  if (descant > 0.02) voices.push(...trio(9, 0.3 * descant, 'triangle', 0.62));
  return octave(stack(...voices))
    .delay(open ? 0.46 : 0.3)
    .delaysync(open ? 1 / 4 : 3 / 16)
    .delayfeedback(open ? 0.52 : 0.34)
    .room(m.sig.space.range(open ? 0.66 : 0.34, 0.95))
    .roomsize(open ? 8 : 4);
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

/**
 * The neighbour on the fourth slot of each group, as its own line.
 *
 * The old ornament was written `[n n+1]`, which halved the main note to make
 * room. Placing the neighbour on the second half of the slot instead leaves the
 * note it decorates completely untouched, so the ornament can come and go
 * without the phrase underneath it changing at all.
 *
 * Which neighbour is chosen by where the tune goes next: below the note when
 * the line is about to rise, above it when it falls or stops. An ornament is a
 * lead-in, and a lead-in that approaches from the side the melody is leaving is
 * a decoration of the wrong note.
 */
function renderOrnament(m: Cell, base: number, mode: ModeName): string {
  /*
   * Eight tokens, not sixteen — each rendered line is its own mini-notation
   * pattern and divides the cycle by its own token count, so the ornament can
   * keep the granularity it was written for while the melody doubles. Emitting
   * sixteen would halve the grace note's length and move where it lands.
   */
  const beats = m.filter((_, i) => i % 2 === 0);
  return beats
    .map((d, i) => {
      // A HOLD is not a note to decorate, and not a rest either — it is the
      // middle of one. Ornamenting it would put a grace note inside a sustain.
      if (typeof d !== 'number' || i % 4 !== 3) return '~';
      let next: number | null = null;
      // `beats`, not `m` — `i` indexes the sampled beats, so scanning the full
      // 16-slot cell with it looked ahead to the wrong note and picked the
      // wrong neighbour (rendered `[~ 62]` where it should have been `[~ 65]`).
      for (let j = i + 1; j < beats.length; j++) {
        if (typeof beats[j] === 'number') {
          next = beats[j] as number;
          break;
        }
      }
      const neighbour = next !== null && next > d ? d - 1 : d + 1;
      return `[~ ${base + degreeToSemitone(mode, neighbour)}]`;
    })
    .join(' ');
}

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
): { skeleton: string; filigree: string; ornament: string } {
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
    ornament: renderOrnament(cell, base, mode),
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
        .gain(0.06 + m.buildProgress * 0.2)
        .room(0.3)
        .roomsize(5)
        .orbit(ORBIT_LOW),
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
        .roomsize(6)
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
        .roomsize(7)
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
    build: (m) =>
      // A tritone pedal under everything. Unmistakable, and it stops sounding
      // like the normal track the instant a boss appears.
      note(seq([m.tonic + 6, m.tonic + 6]))
        .s('sawtooth')
        .ds('0.5:0.2')
        .lpf(m.sig.openness.range(200, 1400))
        .lpq(3)
        .distort('1.5:0.5')
        .gain(0.4)
        .orbit(ORBIT_LOW),
  },
  {
    archetype: 'subdrop',
    priority: 60,
    build: (m, count) =>
      note(chordOf([m.chord.root - 12, m.chord.root - 5]))
        .struct(count > 1 ? 'x ~ x ~' : 'x ~ ~ ~')
        .s('square')
        .ds('0.22:0')
        .lpf(700)
        .distort('3:0.5')
        .gain(0.34)
        .orbit(ORBIT_LOW),
  },
  {
    archetype: 'arpeggiator',
    priority: 50,
    build: (m, count) => {
      const a = m.chord.root + 12;
      const b = a + 7;
      return note(count > 2 ? seq([a, b, a, b]) : `~ ${a} ~ ${b}`)
        // A square at 2.6kHz with Q4 is a bright blip on top of everything
        // else; a triangle says the same thing without the edge.
        .s('triangle')

        /*
         * A PLUCK, NOT A CLICK.
         *
         * Reported from play: "there's a lot of pinging type sound which isnt
         * great". `tools/attackfloor.mjs` has been reporting exactly this all
         * along and it was repeatedly filed as pre-existing: the motifs stem
         * measured 92% no-attack, 100% no-release, 91% sustain-0, with a 1ms
         * attack and a 31ms tail. That is not a short note, it is a transient.
         *
         * The cause is `.ds('0.07')` and nothing else. Per AGENTS.md §4, ADSR
         * defaults are GROUPED: setting decay and sustain leaves attack and
         * release to fall through to 0.001s and 0.01s. So the envelope was a
         * one-millisecond ramp onto a note that decays to silence and is gone.
         *
         * Appending `.release()` alone would have been the trap AGENTS.md §3
         * names outright — superdough ramps release FROM sustain, so on a
         * sustain(0) lane it is inaudible and would have turned the gate green
         * with no change to the sound. Sustain has to come up with it.
         *
         * These stay SHORT, because a motif that becomes a pad stops being a
         * motif and this lane is how an archetype announces itself. A real
         * plucked string is about 10-15ms onto the note and a tail that decays
         * rather than stopping; that is what these are now.
         */
        .attack(0.012)
        .ds('0.13:0.12')
        .release(0.22)
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
    build: (m, count) => {
      const n = m.chord.root + 12;
      // A stab and its delayed repeat, which is literally what the enemy does.
      return note(count > 2 ? `${n} ~ ${n} ~` : `${n} ~ ~ ~`)
        .s('triangle')
        .ds('0.08:0')
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
    build: (m) =>
      note(seq([m.tonic + 24, m.tonic + 24 + degreeToSemitone(m.mode, 3)]))
        .s('triangle')
        .ad('0.06:0.3')
        .sustain(0.2)
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
    build: (m, count) => {
      const div = count > 8 ? 16 : count > 4 ? 8 : 4;
      return note(`${m.chord.root + 24}*${div}`)
        .s('square')

        /*
         * A PLUCK, NOT A CLICK.
         *
         * Reported from play: "there's a lot of pinging type sound which isnt
         * great". `tools/attackfloor.mjs` has been reporting exactly this all
         * along and it was repeatedly filed as pre-existing: the motifs stem
         * measured 92% no-attack, 100% no-release, 91% sustain-0, with a 1ms
         * attack and a 31ms tail. That is not a short note, it is a transient.
         *
         * The cause is `.ds('0.03')` and nothing else. Per AGENTS.md §4, ADSR
         * defaults are GROUPED: setting decay and sustain leaves attack and
         * release to fall through to 0.001s and 0.01s. So the envelope was a
         * one-millisecond ramp onto a note that decays to silence and is gone.
         *
         * Appending `.release()` alone would have been the trap AGENTS.md §3
         * names outright — superdough ramps release FROM sustain, so on a
         * sustain(0) lane it is inaudible and would have turned the gate green
         * with no change to the sound. Sustain has to come up with it.
         *
         * These stay SHORT, because a motif that becomes a pad stops being a
         * motif and this lane is how an archetype announces itself. A real
         * plucked string is about 10-15ms onto the note and a tail that decays
         * rather than stopping; that is what these are now.
         */
        .attack(0.012)
        .ds('0.09:0.12')
        .release(0.18)
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
    build: (m, count) =>
      note(count > 3 ? `~ ${m.chord.root + 12} ~ ${m.chord.root + 12}` : `~ ${m.chord.root + 12} ~ ~`)
        .s('triangle')

        /*
         * A PLUCK, NOT A CLICK.
         *
         * Reported from play: "there's a lot of pinging type sound which isnt
         * great". `tools/attackfloor.mjs` has been reporting exactly this all
         * along and it was repeatedly filed as pre-existing: the motifs stem
         * measured 92% no-attack, 100% no-release, 91% sustain-0, with a 1ms
         * attack and a 31ms tail. That is not a short note, it is a transient.
         *
         * The cause is `.ds('0.09')` and nothing else. Per AGENTS.md §4, ADSR
         * defaults are GROUPED: setting decay and sustain leaves attack and
         * release to fall through to 0.001s and 0.01s. So the envelope was a
         * one-millisecond ramp onto a note that decays to silence and is gone.
         *
         * Appending `.release()` alone would have been the trap AGENTS.md §3
         * names outright — superdough ramps release FROM sustain, so on a
         * sustain(0) lane it is inaudible and would have turned the gate green
         * with no change to the sound. Sustain has to come up with it.
         *
         * These stay SHORT, because a motif that becomes a pad stops being a
         * motif and this lane is how an archetype announces itself. A real
         * plucked string is about 10-15ms onto the note and a tail that decays
         * rather than stopping; that is what these are now.
         */
        .attack(0.014)
        .ds('0.16:0.14')
        .release(0.26)
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
  return stack(...live.map((mo) => mo.build(m, m.enemies[mo.archetype])));
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
    const voiced = m.chord.notes.map((n) => n + 12);
    if (novaLevel >= 2) voiced.push(m.chord.notes[0] + 24);
    if (novaLevel >= 3) voiced.push(m.chord.notes[1] + 24);
    parts.push(
      note(chordOf(voiced))
        .s('triangle')
        .attack(0.4)
        .decay(0.3)
        .sustain(0.6)
        .release(0.5)
        .lpf(m.sig.openness.range(700, 3000 + novaLevel * 700))
        .room(0.5)
        .roomsize(5)
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
        .roomsize(7)
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
