/**
 * ARTICULATION — how long a note lasts and what its two ends look like.
 *
 * This module exists because that question had no owner. Every lane in
 * `layers.ts` wrote its own `.attack()/.ds()/.sustain()/.release()` chain
 * inline, fourteen of them, none agreeing on units, none stating a note's
 * LENGTH at all. Length was an emergent property of the mini-notation slot
 * times `sustain` plus whatever `release` happened to be — which is why the
 * owner's complaint is "too drawn out" and why five parameter passes inside
 * those chains never moved it.
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT THAT FORCED THIS, and it is an inversion, not a magnitude
 * ---------------------------------------------------------------------------
 *
 * Sixty published pieces from `eefano/strudel-songs-collection` against this
 * tree, read through `tools/attackfloor.mjs`:
 *
 *                    corpus median      this score (before)
 *   attack                  50 ms       6 ms   (lead)
 *   release                200 ms       530 ms (lead), 1475 ms (chords)
 *   clip                      .95       NOT USED — 0% of haps on 6 of 7 lanes
 *
 * We were faster on and slower off than the reference, on BOTH ends, on every
 * lane. That combination is the worst one available: a step discontinuity at
 * the onset (which is broadband, and is heard as a click or a "ping") followed
 * by a tail that outlives the note (which is heard as smear). A played note is
 * the other way round — it takes time to speak and it stops when the player
 * stops. Both of the owner's standing complaints, "pinging" and "too drawn
 * out", are the two halves of this one inversion.
 *
 * THE ARITHMETIC OF THE SMEAR, because it is worth having as a number. At
 * 135 bpm a bar is 1.778 s. The pad's release was up to 2.2 s and the colour
 * lane's up to 2.6 s, on lanes that hold a whole bar: every chord therefore
 * went on sounding through 1.2 to 1.5 bars of the NEXT chord, two voices each,
 * so four to eight pad tones from two different harmonies were audible at any
 * instant. The lead's was up to 1.1 s against an eighth-note slot of 0.222 s —
 * five melody notes overlapping, times three lines, times two to four octave
 * doublings. Nothing about that is a gain-staging problem and no filter
 * reaches it.
 *
 * ---------------------------------------------------------------------------
 * WHY A TABLE OF CONSTANTS WOULD HAVE BEEN THE SAME BUG IN A NEW COSTUME
 * ---------------------------------------------------------------------------
 *
 * `AGENTS.md` §3 records the failure mode by name — "gates optimised against"
 * — and `buildBass`'s own comment states the specific version of it that
 * applies here: four of seven pitched lanes measured an IDENTICAL envelope on
 * every hap of a twelve-minute sweep (attack lo/med/hi of 4.0/4.0/4.0,
 * 6.0/6.0/6.0). Typing `.attack(0.05)` on every lane would turn
 * `tools/attackfloor.mjs` green and leave that invariance exactly where it is.
 *
 * So a touch is not five numbers. It is five numbers PER UNIT OF NOTE LENGTH,
 * plus absolute bounds. The attack of a bowed whole note is not the attack of
 * a bowed sixteenth; an instrument's onset is a roughly fixed FRACTION of the
 * note, floored by how fast the body can actually start and ceilinged by how
 * long a listener will wait for a pitch. Given a lane's subdivision and the
 * tempo, `articulate` computes the milliseconds. Two lanes wearing the same
 * touch at different subdivisions therefore get different envelopes, and one
 * lane changing subdivision changes its own — which is the property the old
 * code had no way to express.
 *
 * And every value spans a range driven by a SIGNAL, so the same lane's notes
 * differ from each other within a bar. `attackfloor`'s lo/med/hi columns are
 * the readout of that: a lane reporting one number in all three is a lane
 * whose articulation is dead, whatever the number is.
 *
 * ---------------------------------------------------------------------------
 * `clip` IS THE CONTROL THIS SCORE NEVER HAD
 * ---------------------------------------------------------------------------
 *
 * `@strudel/core`'s `Hap.duration` getter multiplies the hap's whole-duration
 * by `value.clip` (dist/index.mjs:407), and superdough's `getADSRValues`
 * consumers use that duration as the moment the sustain phase ends and the
 * release begins (`helpers.mjs:55-100`, `end = begin + duration`). So `clip`
 * is the one control that states a note's LENGTH as a decision rather than
 * letting `release` decide it by accident. The corpus uses it on essentially
 * every voice — `clip(.3).rel(.2)` on all four layers of E-V-1 — and this
 * score used it on one lane, at 34% of its haps.
 *
 * THE TRAP, from `AGENTS.md` §4: `clip` cannot be heard on a lane whose
 * sustain is 0, because the amplitude is already at zero by the end of the
 * decay and shortening the hold changes nothing. `articulate` therefore
 * refuses to write a `clip` under `SILENT_SUSTAIN`, and says so rather than
 * writing a control that does nothing. That is the same class of defect as the
 * `release >= 250ms` gate §3 records as meaningless on a `sustain(0)` lane.
 *
 * ---------------------------------------------------------------------------
 * LAST WRITER, ALWAYS
 * ---------------------------------------------------------------------------
 *
 * `AGENTS.md` §4: "Later writes win, silently." `buildBass` lost its 808 for a
 * whole project lifetime to a `.s()` two lines further down, and `.decay(0.7)`
 * and `.sustain(0.35)` to a `.ds()`. `articulate` is written to be applied to
 * a FINISHED chain — `articulate(voice(...).lpf(...).gain(...), 'sung', ...)`
 * — so it is the last writer for all five of the controls it owns and no lane
 * can quietly disagree with it. Nothing else in `src/audio/` may set
 * `attack`, `decay`, `sustain`, `release` or `clip` on a pitched lane;
 * `tools/attackfloor.mjs` reads the haps, so a lane that does will show up as
 * an envelope this table does not contain.
 */
import type { Pattern, Patternable } from '@strudel/core';

/**
 * Under this sustain, a note's amplitude is zero before the hold ends, so both
 * `clip` and `release` are inaudible. Named rather than inlined because two
 * separate checks depend on it and `AGENTS.md` §3 records a proposed gate that
 * was meaningless for exactly this reason.
 */
export const SILENT_SUSTAIN = 0.02;

/**
 * One playing technique.
 *
 * `onset`, `fall` and `tail` are FRACTIONS OF THE SOUNDING LENGTH, each given
 * as `[calm, driven]` and interpolated by the shade signal. `*Ms` are absolute
 * clamps in milliseconds — the floor is how fast the instrument can physically
 * speak, the ceiling is how long a listener will wait before hearing a pitch.
 *
 * `hold` is `clip`: the fraction of its SLOT the note occupies. It is the only
 * entry here that states length directly, and it is the one this score never
 * had.
 */
export interface Touch {
  readonly onset: readonly [number, number];
  readonly onsetMs: readonly [number, number];
  readonly fall: readonly [number, number];
  readonly fallMs: readonly [number, number];
  readonly body: readonly [number, number];
  readonly tail: readonly [number, number];
  readonly tailMs: readonly [number, number];
  readonly hold: readonly [number, number];
}

export type TouchName =
  | 'pedal'
  | 'bowed'
  | 'breathed'
  | 'sung'
  | 'played'
  | 'plucked'
  | 'struck'
  | 'ticked';

/**
 * The vocabulary. Eight techniques for eleven lanes, and the fact that it is
 * fewer than the lanes is the point — two parts sharing a technique at
 * different subdivisions still get different envelopes, so a shared name is
 * not a shared sound.
 *
 * Ordered from the longest gesture to the shortest. Every `tailMs` ceiling is
 * at or under 300 ms, against a corpus median of 200 ms and a previous worst
 * case of 2600 ms; every `onsetMs` floor is at or above 20 ms, against a
 * corpus median of 50 ms and a previous best of 24 ms.
 */
export const TOUCH: Record<TouchName, Touch> = {
  /*
   * PEDAL — the sub, and the one lane where a long hold is the instrument.
   *
   * One cycle of 50 Hz is twenty milliseconds, so this lane's onset floor is a
   * physical constraint and not a taste: anything faster is a step
   * discontinuity in the loudest thing at the bottom of the mix. The hold is
   * near-total because the bottom octave is the floor everything else stands
   * on and a gap there takes the whole mix with it.
   */
  pedal: {
    onset: [0.297, 0.215],
    onsetMs: [28, 150],
    fall: [0.861, 0.718],
    fallMs: [70, 400],
    body: [0.88, 0.8],
    tail: [0.981, 0.795],
    tailMs: [110, 280],
    hold: [0.94, 0.88],
  },
  /*
   * BOWED — written for the pad; the CONDUCTOR motif's tritone pedal is its
   * one user now (the pad is deleted, `buildChords`). A bed that speaks
   * slowly and STOPS.
   *
   * Was attack 450 ms / release 900-2200 ms with no hold at all. The attack was
   * never the defect and is barely changed; the release is, because a 2.2 s
   * tail on a lane whose note is 1.778 s long is not a pad, it is two chords
   * sounding at once. `hold` at 0.78-0.86 gives the bar a seam, which is what
   * makes a repeated chord read as a repeated chord.
   */
  bowed: {
    onset: [0.144, 0.092],
    onsetMs: [60, 300],
    fall: [0.231, 0.17],
    fallMs: [90, 520],
    body: [0.74, 0.66],
    tail: [0.162, 0.108],
    tailMs: [100, 300],
    hold: [0.78, 0.86],
  },
  /*
   * BREATHED — written for the colour tones, the upper structure, and it has
   * NO USER since that pair was deleted (`buildChords`). Kept: a touch is a
   * named envelope, and the next lane that wants the slowest onset in the file
   * should find it here rather than write a fourth copy. `vibprobe` and
   * `attackfloor` read haps, so an unused row costs them nothing.
   * The slowest onset in the
   * file, because a tone that arrives after the chord under it is heard as an
   * inflection of that chord rather than as a fifth voice. Its tail is shorter
   * than the pad's despite being the gentler part: it sits above the tune,
   * where an overhang is heard immediately.
   */
  breathed: {
    onset: [0.195, 0.123],
    onsetMs: [70, 340],
    fall: [0.25, 0.19],
    fallMs: [100, 540],
    body: [0.7, 0.62],
    tail: [0.152, 0.102],
    tailMs: [90, 260],
    hold: [0.72, 0.8],
  },
  /*
   * SUNG — the tune, and this is the corpus median almost exactly: a 50 ms
   * class of onset and a 200 ms class of tail.
   *
   * This lane was 6 ms on and 340-1100 ms off, on eighth notes 222 ms long. The
   * tail alone put up to five melody notes on top of each other, and the 6 ms
   * onset is where "pinging" comes from — the tune is the loudest pitched stem
   * in the game (`STEM_CURVES.lead` has the highest ceiling, 0.95).
   *
   * `hold` is high because a melody is legato by default; the gaps in this tune
   * are written as rests in the theme tables, not taken out of the notes.
   */
  sung: {
    onset: [0.315, 0.184],
    onsetMs: [26, 110],
    fall: [0.759, 0.511],
    fallMs: [60, 300],
    body: [0.58, 0.5],
    tail: [1.181, 0.818],
    tailMs: [110, 260],
    hold: [0.8, 0.88],
  },
  /*
   * PLAYED — the bass. A finger on a string: it speaks in a few tens of
   * milliseconds and it is damped by the next note.
   *
   * `hold` at 0.62-0.74 is the change the owner is most likely to hear. The
   * lane held its full slot at sustain 0.42 and then released for a further
   * 140-260 ms, so every note ran into the next one and the line had no rhythm
   * of its own — eight notes a bar with no silence anywhere in the bar. A bass
   * part is as much the gaps as the notes, and this lane is the one the owner
   * named: "the base sounds are like too drawn out".
   */
  played: {
    onset: [0.348, 0.183],
    onsetMs: [24, 100],
    fall: [0.87, 0.579],
    fallMs: [60, 280],
    body: [0.46, 0.38],
    tail: [1.486, 0.945],
    tailMs: [110, 250],
    hold: [0.62, 0.74],
  },
  /*
   * PLUCKED — the arp and the stab. Short, and its release is allowed to exceed
   * its hold, which is what a plucked string does: the note is let go early and
   * rings out past the point the finger left it.
   */
  plucked: {
    onset: [0.36, 0.188],
    onsetMs: [20, 90],
    fall: [0.856, 0.522],
    fallMs: [50, 240],
    body: [0.38, 0.3],
    tail: [1.577, 0.978],
    tailMs: [90, 220],
    hold: [0.5, 0.62],
  },
  /*
   * STRUCK — the motifs and the motor's offbeat. A hammer: the fastest onset
   * this file allows, still three times the 6 ms the score used to run, and a
   * hold under half its slot so the figure is heard as a figure.
   */
  struck: {
    onset: [0.586, 0.346],
    onsetMs: [20, 110],
    fall: [1.396, 0.83],
    fallMs: [40, 200],
    body: [0.26, 0.2],
    tail: [2.365, 1.47],
    tailMs: [70, 200],
    hold: [0.4, 0.52],
  },
  /*
   * TICKED — the motor, the fastest repeating thing in the score that has a
   * pitch, and the one lane a long tail would genuinely ruin.
   *
   * `buildMotor`'s own comment argues, correctly, that a 250 ms tail on a lane
   * playing sixteenths (111 ms at 135 bpm) would stack three notes and turn the
   * clock into a drone. That argument survives here as arithmetic rather than
   * as an exemption: the tail is a fraction of the note, so the beat layer's
   * eighths come out at 170-144 ms and anything faster gets proportionately
   * less, without anybody editing a table. The `tailMs` ceiling of 170 is the
   * backstop, not the mechanism.
   */
  ticked: {
    onset: [0.586, 0.327],
    onsetMs: [20, 70],
    fall: [1.126, 0.655],
    fallMs: [35, 160],
    body: [0.28, 0.2],
    tail: [2.027, 1.178],
    tailMs: [60, 170],
    hold: [0.4, 0.55],
  },
};

/**
 * How long one slot of a lane's lattice lasts, in seconds.
 *
 * `slots` is subdivisions per BAR, and a bar is four beats everywhere in this
 * score (`feelForWave` changes the character of the four, never the count).
 * Deriving this rather than passing milliseconds is what makes a touch
 * portable between lanes: the same technique at 4 slots and at 16 slots is two
 * genuinely different envelopes, which is how instruments behave.
 */
export function slotSeconds(bpm: number, slots: number): number {
  return 240 / (bpm * Math.max(1, slots));
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The two ends of a touch, resolved to seconds at a given tempo and lattice.
 *
 * Exported as data so a gate can read the intended envelope rather than
 * restating the arithmetic — `AGENTS.md` §3, "a tool holding its own copy of a
 * constant will lie the day it moves", which this pass watched happen twice in
 * `harmony` and `registermap`. Returns both ends of each range, so a check can
 * assert on the SPREAD as well as on the value: a lane whose lo and hi are the
 * same number has a dead articulation whatever the number is.
 */
export interface Shaped {
  attack: readonly [number, number];
  decay: readonly [number, number];
  sustain: readonly [number, number];
  release: readonly [number, number];
  clip: readonly [number, number];
  /** Seconds of one slot, for a caller that wants to reason about overlap. */
  slot: number;
}

export function shape(touch: TouchName, bpm: number, slots: number): Shaped {
  const t = TOUCH[touch];
  const slot = slotSeconds(bpm, slots);
  const end = (i: 0 | 1): { a: number; d: number; r: number; c: number } => {
    const c = t.hold[i];
    const sounding = slot * c;
    return {
      a: clamp(sounding * t.onset[i], t.onsetMs[0] / 1000, t.onsetMs[1] / 1000),
      d: clamp(sounding * t.fall[i], t.fallMs[0] / 1000, t.fallMs[1] / 1000),
      r: clamp(sounding * t.tail[i], t.tailMs[0] / 1000, t.tailMs[1] / 1000),
      c,
    };
  };
  const lo = end(0);
  const hi = end(1);
  return {
    attack: [lo.a, hi.a],
    decay: [lo.d, hi.d],
    sustain: [t.body[0], t.body[1]],
    release: [lo.r, hi.r],
    clip: [lo.c, hi.c],
    slot,
  };
}

export interface ArticulateOpts {
  /** Subdivisions of the bar this lane's fastest note occupies. */
  slots: number;
  bpm: number;
  /**
   * 0..1, calm to driven — a SIGNAL, so the envelope moves without the pattern
   * being rebuilt and no two haps in a bar need be identical. Pass a plain
   * number only where the lane genuinely has one articulation (an ornament
   * that exists at one intensity), and expect `attackfloor` to print it as a
   * flat lo/med/hi.
   */
  shade: Patternable;
  /**
   * The breakdown and a SOLOIST wave lengthen notes. A multiplier on `release`
   * and on `clip` only — never on attack, because "ring on longer" is a
   * statement about the end of a note. Clamped to 1.6 so no combination can
   * reach the overhang this module exists to remove.
   */
  ring?: number;
  /**
   * FERMATA, the rig ability, 0..1 — a SIGNAL, so picking it up does not
   * rebuild the phrase.
   *
   * It applies to `clip` and to `clip` only, and the reason is a gate. This
   * ability used to be `release(sig.hold.range(0.34, 1.1))` on the lead: at
   * full it added three quarters of a second of tail to the loudest lane in the
   * game, which is the defect this module exists to remove wearing a feature's
   * clothes. Putting it back on `release` would also fail the recalibrated
   * `attackfloor` tail ceiling — the pad's 306 ms high times any useful factor
   * is past 320 ms — so the choice is forced as well as right: FERMATA HOLDS a
   * note, it does not smear it.
   *
   * Bounded at build time rather than clamped at runtime. A pattern cannot be
   * `Math.min`'d, so the ceiling of the multiplier is computed from the touch's
   * own largest `clip`, and the product is therefore provably at most 1 — a
   * note can be held for its whole slot and never longer.
   *
   * `tools/instruments.mjs` asserts that every signal the director sets is read
   * by some lane. It went RED the moment `sig.hold` came off the lead's release
   * ("signal 'hold' is set by the director and read by no lane — it is an inert
   * control"), which is the check working: an unmeasured property rots, and
   * this one was caught inside the same pass that orphaned it.
   */
  hold?: Patternable;
}

/** The most FERMATA may lengthen a note, before the per-touch clip ceiling. */
export const FERMATA_MAX = 1.4;

/**
 * Apply a touch. **Call this LAST in the chain.**
 *
 * Five controls, one place. A lane declares a technique and a lattice; the
 * milliseconds are arithmetic. Nothing downstream may restate any of these
 * five — see the module header on later-writes-win.
 */
export function articulate(p: Pattern, touch: TouchName, o: ArticulateOpts): Pattern {
  const s = shape(touch, o.bpm, o.slots);
  const ring = clamp(o.ring ?? 1, 1, 1.6);
  const sig = typeof o.shade === 'number' ? null : (o.shade as Pattern);
  /*
   * `range` on a signal, a plain lerp on a number. Written out rather than
   * hidden in a helper because the two branches produce genuinely different
   * objects — a Pattern control and a scalar — and Strudel will accept either
   * silently, which is exactly how a dead control gets written.
   */
  const span = (a: number, b: number): number | Pattern =>
    sig ? sig.range(a, b) : a + (b - a) * (o.shade as number);

  let out = p
    .attack(span(s.attack[0], s.attack[1]))
    .decay(span(s.decay[0], s.decay[1]))
    .sustain(span(s.sustain[0], s.sustain[1]))
    .release(span(s.release[0] * ring, s.release[1] * ring));

  /*
   * `clip` only where it can be heard. Both ends of the sustain range have to
   * clear the floor: a lane that drops to silence at one end of its shade has
   * a hold that is audible at the other, and writing the control for half its
   * range is worse than not writing it, because `attackfloor`'s clip column
   * would then report coverage the lane does not have.
   */
  if (s.sustain[0] > SILENT_SUSTAIN && s.sustain[1] > SILENT_SUSTAIN) {
    const c0 = Math.min(1, s.clip[0] * ring);
    const c1 = Math.min(1, s.clip[1] * ring);
    const base = span(c0, c1);
    if (o.hold === undefined || typeof o.hold === 'number') {
      const f = 1 + (typeof o.hold === 'number' ? o.hold : 0) * (FERMATA_MAX - 1);
      out = out.clip(typeof base === 'number' ? Math.min(1, base * f) : base.mul(f));
    } else {
      /*
       * The ceiling is computed from the touch, so the product cannot exceed a
       * whole slot however hard the ability is pushed. `.mul` between two
       * VALUE patterns is ordinary arithmetic; the AGENTS.md §4 warning about
       * "can't do arithmetic on control patterns" applies to `note()` and its
       * relatives, not to the plain signals `range()` produces.
       */
      const ceiling = Math.min(FERMATA_MAX, 1 / Math.max(c0, c1, 0.01));
      const f = (o.hold as Pattern).range(1, ceiling);
      out = out.clip(typeof base === 'number' ? f.mul(base) : base.mul(f));
    }
  }
  return out;
}

/**
 * A percussive tail with no body: attack, decay, and gone.
 *
 * The drums and the one-shot furniture are NOT pitched lanes and do not wear a
 * touch — a kick's shape is its whole identity and belongs with the kick. This
 * is here only so that `sustain(0)` lanes have a single named way to say "and
 * therefore no clip and no release", instead of each of them omitting the
 * controls and inheriting superdough's grouped defaults, which is the trap
 * `AGENTS.md` §4 records as costing this project its loudest lane's envelope
 * for the whole of its life.
 */
export function transient(p: Pattern, attack: number, decay: number): Pattern {
  return p.attack(attack).decay(decay).sustain(0).release(0.01);
}
