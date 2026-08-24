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
import type { Chord, ChordSpan, ModeName } from './theory';
import { buildChord, contourForBar, degreeToSemitone } from './theory';
// `riser` is no longer imported: the build is a timpani roll now, and a
// white-noise uplifter has no equivalent in the canon this score is aiming at.
// The function is left in `kit.ts` rather than deleted — it is a correct
// implementation of a thing we have simply stopped wanting.
// `HAT_EIGHTHS`, `HAT_QUARTERS`, `HAT_SIXTEENTHS`, `hatLayer` and `metal` went
// with `buildHats` — see the tombstone where that function used to be. They are
// the hi-hat's subdivision ladder and its noise voices, and there is no hi-hat
// any more: the pulse moved into a pitched inner voice. They stay exported from
// `kit.ts` rather than being deleted, for the same reason `riser` did — they are
// correct implementations of a thing this score has stopped wanting.
import { clap, impact, kick, ORBIT_AIR, ORBIT_HARMONY, ORBIT_LOW, snare, sub } from './kit';
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
  sub: { in: 0.44, full: 0.8, ceiling: 0.2, floor: 0.1 },
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
export function kickRhythm(intensity: number, fill: boolean, feel: Feel = 'boomchick'): string {
  if (fill) {
    if (feel === 'chase') return 'c1 ~ [c1 c1] [c1 c1 c1]';
    // Dubstep's fill is a stutter, not a roll: the last beat triplets in place
    // rather than accelerating, which is the gesture that says "here it comes"
    // in this genre specifically.
    if (feel === 'halftime') return 'c1 ~ [~ c1] [c1 c1 c1]';
    return 'c1 c1 c1 [c1 c1 c1]';
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
    if (intensity < 0.38) return 'c1 ~ ~ ~';
    if (intensity < 0.72) return 'c1 ~ [~ c1] ~';
    return 'c1 ~ [~ c1] [c1 ~ ~ c1]';
  }
  if (feel === 'chase') {
    // Half-time: the kick leaves room, and the space is the sound.
    if (intensity < 0.4) return 'c1 ~ ~ ~';
    if (intensity < 0.75) return 'c1 ~ ~ [~ c1]';
    return 'c1 ~ [~ c1] [c1 ~]';
  }
  if (feel === 'gallop') {
    // da  da-da  da  da-da
    if (intensity < 0.35) return 'c1 ~ c1 ~';
    if (intensity < 0.7) return 'c1 [~ c1 c1] c1 ~';
    return 'c1 [~ c1 c1] c1 [~ c1 c1]';
  }
  if (feel === 'shuffle') {
    if (intensity < 0.4) return 'c1 ~ c1 ~';
    return '[c1@2 ~] c1 [c1@2 ~] c1';
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
  if (intensity < 0.14) return 'c1 ~ ~ ~';
  if (intensity < 0.34) return 'c1 ~ c1 ~';
  if (intensity < 0.62) return 'c1 ~ [~ c1] ~';
  if (intensity < 0.82) return 'c1 ~ [~ c1] c1';
  return 'c1 ~ [~ c1] [~ c1]';
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

/** Hats per bar. Deliberately a ladder, not a smooth ramp — halving/doubling. */

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
  return stack(...layers);
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
const MOTOR_BOTTOM = 57;
const MOTOR_TOP = 69;

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
  const tones = m.chord.notes
    .map((n) => {
      let v = n;
      while (v > MOTOR_TOP) v -= 12;
      while (v < MOTOR_BOTTOM) v += 12;
      return v;
    })
    .sort((a, b) => a - b);
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
      // The chromatic run. Directional, and it buzzes rather than pulses.
      line = `${root} ${root + 1} ${root + 2} ${third}`;
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
    let target = m.nextChord.root;
    while (target > MOTOR_TOP) target -= 12;
    while (target < MOTOR_BOTTOM) target += 12;
    const step = target > third ? 1 : -1;
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
  const voice = (pattern: string, level: Patternable, velocity: number): Pattern =>
    note(pattern)
      .s('pulse')
      .pw(0.5)
      .ad('0.004:0.07')
      .sustain(0)
      .lpf(m.sig.openness.range(1400, 4000))
      .hpf(220)
      .lpq(1)
      .velocity(velocity)
      .gain(level)
      .pan(0.5)
      .orbit(ORBIT_HARMONY);

  /*
   * Two layers on one lattice, exactly as the hats were — the retention lesson
   * survives the rewrite. The beat layer always sounds; the sixteenths fade in
   * over it, so getting busier ADDS notes between the ones already playing
   * rather than replacing all of them. `tools/retention.mjs` scored the old
   * division-swapping hat 45% nested, the worst lane in the mix.
   */
  const drive = Math.min(1, (m.barInPhrase % 4 === 3 ? 0.3 : 0) + (rapid > 0 ? 0.25 + rapid * 0.08 : 0));
  const base = voice(line, 0.22, 1);
  if (half) return base;
  return stack(
    base,
    // The offbeat sixteenths, quieter and thinner: this is what turns a pulse
    // into a motor. Rides `sig.fill`, so pressure drives it rather than a
    // threshold rewriting the part.
    voice(`[~ ${third}]*4`, m.sig.fill.range(drive * 0.14, 0.14), 0.5),
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
  // The 808: long tail with a pitch slide into each note.
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
    glide(shaped(note(line)))
      .s('sawtooth')
    // 0.16 to silence left a hole under every beat. A bass that stops between
    // notes takes the floor out from under the whole mix eight times a bar.
    .ds('0.3:0.42')
    // Out of the sub's way. Without this the two low sources sum into a boom
    // that swamps the kick and reads as distortion rather than weight.
    .hpf(95)
    /*
     * The floor was 240Hz. Against hpf(95) that is barely an octave of window,
     * so at low openness — which is most of a fight — the layer had almost no
     * band to speak in and measured -22.5dB under the kick. A bass needs its
     * second and third harmonics to read at all on a laptop speaker. 500 keeps
     * it dark when the mix closes down without muting it.
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
      .gain(0.86)
      .orbit(ORBIT_LOW);

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
  const melodyPresent = m.tension > STEM_CURVES.lead.in;
  const rootPc = (((m.chord.root % 12) + 12) % 12);
  const openTones = m.chord.notes.filter((n) => {
    const iv = ((((n % 12) - rootPc) % 12) + 12) % 12;
    // Root, perfect fifth, or the diminished fifth locrian gives instead.
    return iv === 0 || iv === 7 || iv === 6;
  });
  // Never let the guard empty the pad: a voicing rule that can silence a lane
  // is a bug waiting for the one chord that trips it.
  const opened = melodyPresent && openTones.length >= 2 ? openTones : m.chord.notes;
  // TEST: with the third gone the pad is a dyad, so it can sit lower without
  // the mud that a full triad down there would make. Re-testing the register
  // move that failed before the pad opened to fifths.
  const voiced = melodyPresent && openTones.length >= 2
    ? opened.map((n) => (n > m.tonic + 5 && n - 12 >= 45 ? n - 12 : n))
    : opened;

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
  const padVoice = (n: number, pan: number): Pattern =>
    note(m.section === 'intro' ? chordStabs([n], 2) : `${n}`)
    .s('pulse')
    .pw(0)
    .pan(pan)
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
    .lpf(m.sig.openness.range(560, 1900))
    .hpf(m.sig.thin.range(20, 400))
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
  const pad = stack(...voiced.map((n, i) => padVoice(n, padPans[i])));

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
  const colourVoice = (pitch: number, level: Patternable, pan: number): Pattern =>
    note(String(pitch + 12))
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
      .lpf(m.sig.openness.range(700, 2200))
      .hpf(m.sig.thin.range(20, 400))
      .lpq(m.sig.ring.range(0.9, 3.4))
      .room(m.sig.space.range(0.62, 0.95))
      .roomsize(7)
      .gain(level)
      // FLANKED puts the two colour tones on opposite sides, so the harmony
      // itself arrives from the wings rather than only the arp.
      .pan(0.5 + pan * wide)
      .orbit(ORBIT_HARMONY);
  const colourGain = 0.3;
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
      colourVoice(pitch, (i === 0 ? m.sig.colour7 : m.sig.colour9).range(floor * colourGain, colourGain), i === 0 ? -1 : 1),
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
    const chord = chordOf(voiced);
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
        .s('square')
        .ad('0.003:0.08')
        .sustain(0)
        .release(0.05)
        .lpf(m.sig.openness.range(400, 950))
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
    coreRhythm = `[~ ${chordOf(voiced)}] ~ [~ ${chordOf(voiced)}] ~`;
  } else if (m.feel === 'chase') {
    coreRhythm = `~ ~ ${chordOf(voiced)} ~`;
  } else {
    coreRhythm = `~ ${chordOf(voiced)} ~ ${chordOf(voiced)}`;
    if (!half) fillRhythm = `${chordOf(voiced)} ~ ${chordOf(voiced)} ~`;
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
    .lpf(m.sig.openness.range(700, 2800))
    .hpf(m.sig.thin.range(20, 400))
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
export function themeForWave(wave: number, boss = false): Theme {
  if (boss) return BOSS_THEME;
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
  // Sorted, because the walk below starts from the top or the bottom of it.
  const tones = [...m.chord.notes].sort((a, b) => a - b).map((n) => n + 12);

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
  const theme = themeForWave(m.wave, m.bossTheme);
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
       * ...and out of the melody's octave when the melody is present.
       *
       * A signal, so it slides the already-scheduled notes rather than
       * replacing the phrase. Same `note()` wrapping rule as above applies —
       * `sig.arpOctave` is built with `signal()` in the director and is a plain
       * value pattern, so it needs the control wrapper to have a field to add
       * against. See `Signals.arpOctave`.
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
      .lpf(m.sig.openness.range(450, 2800))
      .hpf(m.sig.thin.range(20, 520))
      .lpq(m.sig.ring.range(2, 5))
      .lpenv(1.4)
      .lpdecay(0.11)
      .delay(0.26 + homing * 0.3)
      .delaysync(sync)
      .delayfeedback(0.3 + homing * 0.22)
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
  if (drones <= 0) return stack(...pod(0, 0.36, 0.4, 3 / 16));
  // One voice per orbiting pod, hard-panned and on a different delay division
  // so they audibly lag each other. You can count your drones with your ears.
  const parts = [...pod(0, 0.14, 0.34, 3 / 16), ...pod(7, 0.86, 0.26, 1 / 8)];
  if (drones >= 2) parts.push(...pod(12, 0.5, 0.2, 1 / 16));
  if (drones >= 3) parts.push(...pod(-12, 0.4, 0.8, 1 / 12));
  return stack(...parts);
}

export function buildLead(m: MusicalState): Pattern {
  const theme = themeForWave(m.wave, m.bossTheme);
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

  const voice = (line: string, transpose: number, level: Patternable, osc: string): Pattern =>
    note(line)
      // See the note on `.add(note(n))` in buildArp: a bare number is dropped.
      .add(note(transpose))
      .s(osc)
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
      .vib(vibRate)
      .vibmod(vibDepth)
      /*
       * 4000 rather than 6500. Above about 4kHz a melody gains no pitch
       * information, only edge — the ear locates a note from its fundamental
       * and low harmonics, and everything above that is texture. Taking the
       * ceiling down loses nothing of the tune.
       */
      .lpf(m.sig.openness.range(1100, 4000))
      .hpf(m.sig.thin.range(20, 600))
      .lpq(m.sig.ring.range(1.3, 4))
      .gain(level)
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
  const trio = (transpose: number, level: number, osc: string): Pattern[] => [
    voice(lines.skeleton, transpose, level, osc),
    voice(lines.filigree, transpose, m.sig.density.range(level * 0.2, level), osc),
    voice(lines.ornament, transpose, m.sig.ornament.range(0, level * 0.55), osc),
  ];
  // The tune sings on a triangle; the octave below is the saw that gives it
  // body. The descant is a triangle too — a sixth above the melody is the
  // highest pitch in the mix and the last place that wants a saw.
  const voices = [...trio(0, lead * 1.15, 'triangle'), ...trio(-12, 0.3, 'sawtooth')];
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
    voices.push(...trio(-12, 0.34 + m.bossPhase * 0.08, 'sawtooth'));
    voices.push(...trio(-24, 0.3 + m.bossPhase * 0.07, 'sawtooth'));
  }
  if (descant > 0.02) voices.push(...trio(9, 0.3 * descant, 'triangle'));
  return octave(stack(...voices))
    .delay(open ? 0.46 : 0.3)
    .delaysync(open ? 1 / 4 : 3 / 16)
    .delayfeedback(open ? 0.52 : 0.34)
    .room(m.sig.space.range(open ? 0.66 : 0.34, 0.95))
    .roomsize(open ? 8 : 4)
    .pan(0.5);
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
 */
export const MAX_MOTIFS = 3;

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
        .ds('0.07:0')
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
        .ds('0.03:0')
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
        .ds('0.09:0')
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
  return { ...buildChord(tonic, mode, degree), contour: contourForBar(bar) };
}
