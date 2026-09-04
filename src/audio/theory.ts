/**
 * Music theory, expressed in MIDI numbers.
 *
 * Everything downstream works in raw MIDI integers rather than note names or
 * Strudel's scale strings. It costs a few lines here and buys exact control:
 * the director can transpose, invert and voice chords with plain arithmetic,
 * and there is no string parsing between "the player is in trouble" and "the
 * chord got darker".
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT IS A DIFFERENT KIND OF HARMONY
 * ---------------------------------------------------------------------------
 *
 * This file used to build every chord as `[0, 2, 4]` — a bare diatonic triad on
 * a scale degree — and treat the 7th and the 9th as `colour`, "a gain the caller
 * rides, not a note list". A corpus of sixty published Strudel pieces
 * (eefano/strudel-songs-collection) was diffed against every function this
 * project's `src/audio/` calls, and the gap was not one of degree:
 *
 *     technique              songs using it (of 60)     this project
 *     voicing()                      39                      0
 *     anchor()                       37                      0
 *     chord()                        29                      0
 *     mode()                         16                      0
 *
 * They compose with CHORD SYMBOLS and let a voicing dictionary spell them; this
 * project hand-assembled note arrays. A chord symbol is not decoration — it is
 * the thing that makes a seventh and a ninth STRUCTURAL rather than an
 * afterthought, and structural extensions are most of the distance between
 * "video game music" and the reference this score keeps naming.
 *
 * So: every (mode, degree) pair now resolves to a real chord symbol, and the
 * symbol is spelled by `renderVoicing` against the iReal dictionary that ships
 * inside `@strudel/tonal` — the identical function `Pattern.voicing()` calls,
 * used directly rather than through a pattern because everything here is plain
 * arithmetic over MIDI and stays that way. `dict('ireal')` resolves; it is in
 * fact the package's DEFAULT dictionary (`voicings.mjs`, `setDefaultVoicings`).
 *
 * All 61 (mode, degree) pairs across the nine modes map onto seven symbols —
 * `^7 7 -7 h7 o7 -^7 ^7#5` — and every one of the seven is a key of the iReal
 * dictionary. There is no fallback branch because nothing reaches one; see
 * `chordSuffix`.
 *
 * ---------------------------------------------------------------------------
 * AND THE SECOND HALF: ONE CHORD, MANY ANCHORS
 * ---------------------------------------------------------------------------
 *
 * The corpus idiom is not only `chord(...).voicing()`. It is
 *
 *     .layer(
 *       x => n("<0 -3>").chord(x).anchor('f#2').mode('root').voicing()...,
 *       x => n("<[0,3] [2,3]>").chord(x).anchor('c#3').mode('root').voicing()...,
 *       x => chord(x).anchor('f4').voicing()...,
 *       x => chord(x).anchor('f5').voicing()...,
 *     )
 *
 * — ONE chord source, four `anchor`s, four registers. That is the mechanism
 * this score has never had. `tools/registermap.mjs` over 761,376 haps measured
 * nine of twelve pitched voice groups with MOST of their notes in 200-800 Hz,
 * with `chords/pulse:pw0.5` and the lead on overlapping MIDI windows. The
 * owner hears it directly: "why are there multiple conflicting melodies and
 * theyre all on different tempos too, very confusing".
 *
 * `LANE_RANGE` is that table of anchors, and it is exported so the builders and
 * the gate read the SAME numbers — AGENTS.md §3, "a tool holding its own copy
 * of a constant will lie the day it moves."
 */

// Imported rather than restated: `pivotChord` always lands on the last bar of a
// phrase and has to take its melodic contour from the same table every other
// bar does. AGENTS.md §3, "a tool holding its own copy of a constant will lie
// the day it moves" — the same applies inside `src/`.
import { BARS_PER_PHRASE } from '../core/transport';
/*
 * The iReal voicing dictionary and the function that spells a symbol with it.
 *
 * Deep imports rather than the package index, deliberately. `@strudel/tonal`'s
 * index pulls `tonal.mjs`, `voicings.mjs` and `ireal.mjs` and registers pattern
 * methods on `Pattern.prototype` as a side effect; nothing here patterns
 * anything. `ireal.mjs` is pure data with no imports at all, and
 * `tonleiter.mjs` is the pure-function half of the voicing machinery —
 * `renderVoicing` is exactly what `voicing()` calls once it has unwrapped the
 * hap (`voicings.mjs`, the `voicing` register block). The package has no
 * `exports` map, so both paths resolve identically under Node and under Vite.
 *
 * `simple` is the dictionary `registerVoicings('ireal', simple)` installs, so
 * asking for it by object is the same thing as asking for it by the name
 * `dict('ireal')`.
 */
import { simple as IREAL } from '@strudel/tonal/ireal.mjs';
import { renderVoicing } from '@strudel/tonal/tonleiter.mjs';
import { noteToMidi } from '@strudel/core';

export type ModeName =
  | 'lydian'
  | 'ionian'
  | 'dorian'
  | 'aeolian'
  | 'phrygian'
  | 'phrygianDominant'
  | 'locrian'
  | 'octatonic'
  | 'harmonicMinor';

/** Semitone offsets from the tonic. */
export const MODES: Record<ModeName, readonly number[]> = {
  /*
   * THE BRIGHT END, and its absence was the largest hole in this palette.
   *
   * Before these two, every mode in this game was minor or diminished:
   * dorian, aeolian, phrygian, phrygianDominant, locrian, octatonic. The
   * ladder ran from "slightly sad" to "everything is wrong", and a player
   * doing well heard the least dark of six dark colours.
   *
   * That is not how the music this score is aiming at works. Chrono Trigger
   * is full of major and Lydian, and its dark moments land precisely BECAUSE
   * the rest is bright — Magus' theme is frightening in a game whose overworld
   * is radiant. Darkness with no light to measure it against is not menace, it
   * is just the ambient colour, and a palette with no bright end cannot get
   * darker in a way anyone notices.
   *
   * LYDIAN is the raised fourth: the "wonder" sound, brighter than major
   * because the sharp four pulls upward against the tonic instead of settling
   * onto it. It is the sound of an overworld opening up.
   *
   * IONIAN is plain major, and it earns its place by being the one colour a
   * listener can hear as HOME. Every other mode here is a departure from
   * something; without major in the set there is nothing to depart from.
   *
   * MEASURED with `npm run clash` when they were added, because adding a mode
   * means the six existing THEMES have to sit over harmony they were not
   * written against, and that is exactly the risk that killed the
   * faster-harmonic-rhythm change (see the note above PROGRESSIONS):
   *
   *     lydian    68 clashes, 53 resolved (78%), 15 unresolved   <- best in set
   *     ionian    82 clashes, 57 resolved (70%), 25 unresolved
   *     (mean of the seven pre-existing modes: 26.4 unresolved)
   *
   * Both come in at or below the existing average and Lydian is the cleanest
   * mode in the whole game — better than any of the dark ones. The worst single
   * mode did not move (33, phrygian). So the themes take these two better than
   * they take most of what was already here, which is the opposite of what the
   * harmonic-rhythm experiment found and the reason this change shipped and
   * that one did not.
   */
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  // Half-whole diminished: not a church mode, but the standard "everything is
  // wrong now" colour and it still contains a usable minor triad on the tonic.
  octatonic: [0, 1, 3, 4, 6, 7, 9, 10],
  /*
   * THE VILLAIN SCALE, and it is reserved for bosses.
   *
   * Aeolian with a raised seventh. Two consequences, and they are the entire
   * reason this mode exists in this file:
   *
   * 1. The augmented second between the flat sixth and the natural seventh
   *    (8 -> 11) is the widest step in any scale here. It is an interval you
   *    cannot sing accidentally, and it is the single most recognisable sound
   *    in villain music — Wily's castle, Magus, every Castlevania stage.
   *
   * 2. The raised seventh is a LEADING TONE, so the chord on the fifth degree
   *    comes out MAJOR. That gives this mode the one thing none of the others
   *    have: a real authentic cadence, V-i, with the leading tone pulling a
   *    semitone up into the tonic. Every other mode here darkens by removing
   *    tension; this one darkens by adding a pull.
   *
   * Deliberately NOT in MODE_LADDER. The ladder is indexed by tension and runs
   * the whole run through it, and a colour that turns up in ordinary play stops
   * being a signal. The director selects this one explicitly for a boss, so it
   * is heard nowhere else — the harmony itself announces the fight.
   */
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

/**
 * Modes ordered by how threatening they sound. The director indexes into this
 * with the tension scalar, so the harmony darkens as the screen fills up.
 */
export const MODE_LADDER: readonly ModeName[] = [
  /*
   * The ladder now STARTS bright and darkens, rather than starting slightly
   * sad and darkening. A player who is on top of the stage hears major; a
   * player in real trouble hears the octatonic. See MODES for why a palette
   * with no bright end cannot get meaningfully darker.
   */
  'lydian',
  'ionian',
  'dorian',
  'aeolian',
  'phrygian',
  'phrygianDominant',
  'locrian',
  'octatonic',
];

/* -------------------------------------------------------------------------
 * THE REGISTER MAP — one chord, one anchor per lane.
 * ---------------------------------------------------------------------- */

/**
 * A lane's home register, as an `anchor` and the window it may occupy.
 *
 * `anchor` is the note `renderVoicing` aligns the chord to. In `'root'` mode
 * that means the voicing's BOTTOM note lands in `[anchor - 11, anchor]` and the
 * rest stacks above it, so an anchor is "roughly where this part's bass sits",
 * which is how the corpus songs read.
 *
 * `lo`/`hi` are the hard window. Anything the voicing puts outside is folded by
 * octaves until it fits, so the window is a guarantee and not a hope.
 */
export interface LaneWindow {
  anchor: number;
  lo: number;
  hi: number;
}

export type LaneId = 'sub' | 'bass' | 'pad' | 'motor' | 'stab' | 'lead' | 'colour' | 'arp';

/**
 * WHERE EACH PART LIVES. The single most valuable table in this file.
 *
 * MEASURED, before this existed (`tools/registermap.mjs`, 761,376 haps over a
 * 10,560-state sweep). Written as p5-p95 MIDI, sorted by median:
 *
 *     sub/sine             33-47
 *     bass/sine            45-54     bass/sawtooth  45-64
 *     chords/pulse:pw0     51-62     <- the pad
 *     chords/triangle      56-90     <- the 7th and 9th, a 34-semitone smear
 *     lead/sawtooth:pw0.5  57-68
 *     motor/pulse:pw0.5    58-69
 *     chords/pulse:pw0.5   67-75     <- the stab
 *     lead/triangle:pw0.5  69-80     lead/pulse:pw0.5  70-81
 *     arp/triangle         69-83     <- ON TOP OF THE TUNE
 *
 * Nine of twelve pitched groups had MOST of their notes between 200 and 800 Hz
 * (MIDI 55.4-79.4). The arp and the lead shared a window outright, which is the
 * oldest mistake in orchestration — doubling your melody with your
 * accompaniment — and `arpDisplacement` "fixed" it by moving the arp DOWN into
 * the motor's window instead, which trades one collision for another.
 *
 * THE SHAPE THIS IMPOSES is a real band, bottom to top:
 *
 *     sub      the floor, one note, nothing above its own second harmonic
 *     bass     the line
 *     pad      the BED: low, open, sustained — a keyboard player's left hand
 *     motor    the CLOCK: chord tones, eighths, the part that never stops
 *     stab     the UPPER STRUCTURE: what the left hand is not holding
 *     lead     the TUNE, and it owns its octave
 *     colour   the 9th and the 13th, on top of the chord, not wandering
 *     arp      SPARKLE, above the tune AND above the extensions
 *
 * TWO OF THOSE ROWS NO LONGER SOUND. The pad and the colour pair were deleted
 * from `buildChords` on the owner's word (the tombstone there has the
 * measurements). Their windows STAY in this table, and the reason is written
 * beside each: `pad` is `voiceLead`'s window and scoring ceiling, `colour` is
 * where `voiceLead` leads `chord.colour` and where the arp's floor was
 * measured against. A window a lane is placed AGAINST is a contract even when
 * no lane is placed IN it. The band, bottom to top, as it sounds now: sub,
 * bass, motor, stab, lead, arp.
 *
 * Overlaps that remain are deliberate and they are the ones an arranger keeps:
 * the bass line crosses the bed, and the upper structure sits under the tune.
 * What is gone is two lanes occupying the SAME window with the same pitches,
 * which is the thing that reads as congestion rather than as harmony.
 *
 * A NOTE ON THE ONE NUMBER THAT DID NOT MOVE. `motor` stays 57-69: it is a
 * contract `tools/motorcheck.mjs` already asserts and `buildMotor`'s gallop
 * ceiling is derived from it. Everything else moved around it.
 */
export const LANE_RANGE: Record<LaneId, LaneWindow> = {
  // 41-110 Hz. The `lpf` is at 435 Hz, so this lane is fundamental plus two.
  sub: { anchor: 33, lo: 26, hi: 45 },
  // 87-220 Hz. `buildBass` writes `root - 12` and reaches an octave above it.
  bass: { anchor: 45, lo: 38, hi: 57 },
  /*
   * THE VOICE-LEADING WINDOW. No lane sounds it.
   *
   * 116-233 Hz, and it is DOWN from a measured 51-62. This was the chords pad's
   * register — a sustained root-and-fifth dyad under everything — and the pad
   * is deleted (`buildChords`). The window stays because it was never only
   * the pad's: it is `voiceLead`'s default `low`/`high`, the ceiling its
   * scoring charges a stack for climbing above, and the register `chord.notes`
   * arrive in before the stab folds them into `LANE_RANGE.stab` and the motor
   * into its own. Move it and every lane's fold starts from a different place.
   *
   * The pad's own history, kept because it is the only register in this table
   * measured twice with opposite verdicts: capping it as a full triad made
   * roughness WORSE (1950 -> 2066 pairs) because the displaced voices simply
   * collided further down; opening it to fifths changed the object, and the
   * same move re-tested against a DYAD was worth -18% on `chords+lead`. The
   * floor is 46 and not 45 because the pad highpassed at 80 Hz to keep off the
   * sub, and MIDI 46 is 116 Hz. The next sustained lane anyone writes here
   * inherits both facts.
   */
  pad: { anchor: 52, lo: 46, hi: 58 },
  // 220-440 Hz. Unchanged, and named in `layers.ts` as MOTOR_BOTTOM/MOTOR_TOP.
  motor: { anchor: 57, lo: 57, hi: 69 },
  // 415-830 Hz. Above the motor's ceiling, under the tune.
  stab: { anchor: 68, lo: 68, hi: 80 },
  // 440-988 Hz. The tune's own octave, and nothing else sustains in it.
  lead: { anchor: 69, lo: 69, hi: 83 },
  /*
   * NO LANE SOUNDS THIS WINDOW EITHER. The colour pair — the chords lane's
   * two-voice supersaw on the ninth and the thirteenth — is deleted
   * (`buildChords`). `LANE_RANGE.colour` and `chord.colour` stay: `voiceLead`
   * leads the two tones into this window every bar, `pivotChord` and
   * `buildChord` spell them, `tools/phrasing.mjs` scores melody clashes
   * against them, and the arp's floor of 87 (below) was chosen by measuring
   * against this window's top. They exist for voice-leading and placement,
   * not for sound. The measurement below is the record of how the window was
   * chosen and is kept as such.
   *
   * 740-1480 Hz, and it was the largest single narrowing in the table: the
   * extension pair measured 56-90, a 34-semitone spread for TWO voices.
   *
   * They are extensions of a chord, so they belong on top of that chord and
   * nowhere else. `buildChords` records a measurement that folding them DOWN
   * made masking monotonically worse (1137 -> 1856); this pins them UP, which
   * is the direction that measurement pointed and which nobody tried.
   *
   * THE FLOOR OF 78 IS THE MEASURED CHOICE AND IT IS NOT OBVIOUS. Four
   * (colour, arp) pairs were run through `tools/masking.mjs`, same 660 states,
   * same 2,143,944 overlapping pairs, changing nothing else:
   *
   *     colour   arp      total weight   chords+lead   share
   *     56-90    69-83        1565.5        6036.8      48%   <- before
   *     78-91    84-96        1768.8        5054.2      36%
   *     74-86    84-96        1709.9        6300.6      46%
   *     76-88    87-99        1549.7        6059.7      49%
   *     78-90    87-99        1572.5        5054.2      40%   <- this
   *
   * `chords+lead` is the pair this project has spent two years reducing — the
   * loudest pair in the mix and, with audibility weighting, most of its
   * roughness. It is driven almost entirely by the colour FLOOR: at 78 it
   * clears the lead's p95 of 79 and the pair drops 16%; at 76 and 74 it does
   * not and the pair goes back above where it started. The arp's floor drives
   * the `arp+chords` pair instead, and 87 is where it stops meeting the top of
   * this window.
   *
   * The total is flat against a baseline of 1565.5 (+0.4%, inside the noise of
   * the two runs either side of it) while the loudest pair is down 16% and its
   * share of everything from 48% to 40%. `masking`'s own header says the total
   * is a diagnostic and not a score; the pair ordering is what it says to act
   * on, and that is what moved.
   */
  colour: { anchor: 78, lo: 78, hi: 90 },
  /*
   * 1245-2489 Hz — ABOVE the tune AND above the chord's extensions, which is
   * the whole point and is three semitones higher than the first attempt.
   *
   * `docs/MASTER_PLAN.md` §1 S-c prescribed exactly this and it was never
   * built; `arpDisplacement` shipped pointing the other way. When the lead is
   * silent the arp drops into the tune's empty octave instead (see
   * `arpDisplacement`), so the octave is never simply abandoned.
   *
   * 84 WAS TRIED AND MEASURED FIRST, and it landed on the colour pair's new
   * home: `masking` reported a lane pair that had not existed before,
   * `arp+chords` at weight 3200 — the largest single new collision in the
   * whole pass, and a textbook case of the effect `research-music.md` warns
   * about, that moving a voice RELOCATES collisions rather than removing them.
   * 87 clears `LANE_RANGE.colour.hi` by minus three and takes that pair to
   * 1630. See the table on `colour` for the four configurations.
   */
  arp: { anchor: 87, lo: 87, hi: 99 },
};

/*
 * EVERY WINDOW IS AT LEAST THIRTEEN SEMITONES WIDE, and that is a correctness
 * requirement rather than an aesthetic one.
 *
 * `foldInto` moves a pitch by octaves until it fits. A window narrower than an
 * octave cannot contain every pitch class, so on such a window the fold has no
 * legal answer and has to return something outside it — which makes the window
 * a suggestion and makes any gate asserting it a gate that fails at random on
 * one chord in twelve. It was caught exactly that way: `stab` at 68-78 and
 * `arp` at 84-95 were eleven and twelve semitones when first written, and
 * `motorcheck` went red on 80 notes at MIDI 55-56 the first time a sub-octave
 * window was used for the fill turnaround's approach room.
 *
 * `tools/registermap.mjs` asserts this span, so a window narrowed below it in
 * future fails before it can produce a stray note.
 */
export const MIN_LANE_SPAN = 12;

/* -------------------------------------------------------------------------
 * CHORD SYMBOLS — the harmony as something with a NAME.
 * ---------------------------------------------------------------------- */

/**
 * The seventh chord on a scale degree, as an iReal symbol suffix.
 *
 * Built from the mode's own intervals rather than from a lookup of "what chord
 * does aeolian have on III" — the modes table is the authority and this reads
 * it, so adding a mode cannot silently produce a wrong symbol.
 *
 * VERIFIED EXHAUSTIVELY rather than assumed: the nine modes give 61
 * (mode, degree) pairs and they resolve to seven symbols —
 *
 *     ^7 x14   -7 x20   7 x8   h7 x8   o7 x10   -^7 x2   ^7#5 x2
 *
 * — every one of which is a key of the iReal dictionary. Octatonic comes out
 * `o7` on all eight degrees, which is not a defect: every seventh chord built
 * in scale-thirds on the half-whole diminished scale IS a diminished seventh,
 * and "there is no chord here that is not diminished" is exactly what that mode
 * is in the ladder for.
 *
 * The fallback exists for a mode nobody has written yet. If it ever fires the
 * chord still sounds — as a plain triad — rather than throwing inside a pattern
 * build, which is the failure `progressionFor` already guards against.
 */
const SEVENTH_SUFFIX: Record<string, string> = {
  '4/7/11': '^7', // major 7
  '4/7/10': '7', //  dominant 7
  '3/7/10': '-7', // minor 7
  '3/6/10': 'h7', // half-diminished
  '3/6/9': 'o7', //  fully diminished
  '3/7/11': '-^7', // minor-major 7 — the tonic of harmonic minor
  '4/8/11': '^7#5', // augmented major 7 — harmonic minor's III
  '4/8/10': '7#5',
  '4/6/10': '7b5',
  '3/7/9': '-6',
  '4/7/9': '6',
};

const TRIAD_SUFFIX: Record<string, string> = {
  '4/7': '^',
  '3/7': '-',
  '3/6': 'o',
  '4/8': '+',
};

export function chordSuffix(mode: ModeName, degree: number): string {
  const root = degreeToSemitone(mode, degree);
  const iv = (d: number): number =>
    ((((degreeToSemitone(mode, degree + d) - root) % 12) + 12) % 12);
  const third = iv(2);
  const fifth = iv(4);
  const seventh = iv(6);
  return (
    SEVENTH_SUFFIX[`${third}/${fifth}/${seventh}`] ??
    TRIAD_SUFFIX[`${third}/${fifth}`] ??
    '-'
  );
}

/**
 * The chord symbol for a (tonic, mode, degree), e.g. `"A-7"`, `"C#h7"`.
 *
 * Sharps rather than flats because `NOTE_NAMES` is the file's one spelling and
 * `tokenizeChord` accepts either.
 */
export function chordSymbol(tonic: number, mode: ModeName, degree: number): string {
  const pc = ((((tonic + degreeToSemitone(mode, degree)) % 12) + 12) % 12);
  return NOTE_NAMES[pc] + chordSuffix(mode, degree);
}

/**
 * Spell a chord symbol as MIDI notes, anchored to a lane's register.
 *
 * This is `Pattern.voicing()` with the pattern taken off: `renderVoicing` is
 * the function `voicings.mjs` calls once it has unwrapped the hap, and `IREAL`
 * is the dictionary `dict('ireal')` names. `mode: 'root'` is the corpus
 * setting — it takes the dictionary's first (closest, most idiomatic) voicing
 * and puts its bottom note at or just under the anchor, which is what makes an
 * anchor readable as "where this part sits".
 *
 * MEMOISED because the same handful of (symbol, anchor) pairs recur every bar
 * of a run and `renderVoicing` parses strings on every call. The cache is
 * unbounded on purpose and cannot grow past 12 pitch classes x 7 suffixes x 8
 * lanes = 672 entries.
 *
 * DEFENSIVE, and for the reason `progressionFor` gives: an unrecognised symbol
 * used to throw from deep inside a pattern build, killing the frame with a
 * message that pointed nowhere near the cause. A symbol the dictionary does not
 * know returns an empty array and every caller falls back to the plain stack it
 * was built from.
 */
const voicingCache = new Map<string, readonly number[]>();

export function voicingAt(symbol: string, anchor: number): readonly number[] {
  const key = `${symbol}@${anchor}`;
  const hit = voicingCache.get(key);
  if (hit) return hit;
  let out: readonly number[] = [];
  try {
    out = renderVoicing({ chord: symbol, dictionary: IREAL, anchor, mode: 'root', octaves: 1 })
      .map((name) => noteToMidi(name))
      .filter((m) => Number.isFinite(m))
      .sort((a, b) => a - b);
  } catch {
    out = [];
  }
  voicingCache.set(key, out);
  return out;
}

/**
 * Fold a set of pitches into a window by octaves, and drop the duplicates the
 * fold creates.
 *
 * The idiom already existed three times in `layers.ts` — the motor's
 * `MOTOR_BOTTOM/TOP` fold, the stab's `STAB_BOTTOM/TOP` fold, and the pad's
 * conditional drop — each written out longhand with its own bounds. One
 * function, and the bounds come from `LANE_RANGE`, so a lane cannot drift out
 * of its own declared window without the table saying so.
 */
export function foldInto(pitches: readonly number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (const p of pitches) {
    let v = p;
    // A window narrower than an octave cannot contain every pitch class, so the
    // loops are bounded rather than trusting `hi - lo >= 12`.
    let guard = 0;
    while (v > hi && guard++ < 12) v -= 12;
    guard = 0;
    while (v < lo && guard++ < 12) v += 12;
    if (v > hi) v -= 12;
    if (!out.includes(v)) out.push(v);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The tones a LANE plays for a chord: an iReal voicing at the lane's anchor,
 * folded into the lane's window.
 *
 * Each lane therefore gets a genuinely different subset of the same harmony
 * rather than the same three notes at a different octave. That distinction is
 * the one the measurement kept pointing at: two lanes playing the same pitch
 * classes an octave apart are one part with a doubling, and the mix reads them
 * as thickness rather than as counterpoint.
 *
 * ONE LANE USES THIS, AND THE REASON THE OTHERS DO NOT IS WORTH KNOWING.
 * `buildArp` walks it, because an arpeggio over a real five-note voicing is a
 * different and better thing from an arpeggio over a triad — it picks up the
 * seventh and often the ninth for free, which is what makes a walk sound like
 * a chord rather than like a scale fragment.
 *
 * The pad, the stab and the motor deliberately fold `chord.notes` instead. A
 * SYMBOL cannot express which extension the act has unlocked: `Extension`
 * replaces the third with the ninth from the intensification on, and a
 * symbol-driven voicing would go on spelling `A-7` while the reserved material
 * never reached the lanes that state it. `tools/harmony.mjs` asserts that the
 * partition survives voicing precisely so that distinction stays visible.
 *
 * Falls back to the chord's own `notes` if the dictionary had nothing, so a
 * lane can never go silent because of a spelling.
 */
export function laneTones(chord: Chord, lane: LaneId): number[] {
  const w = LANE_RANGE[lane];
  const spelled = chord.symbol ? voicingAt(chord.symbol, w.anchor) : [];
  const source = spelled.length ? spelled : chord.notes;
  const folded = foldInto(source, w.lo, w.hi);
  return folded.length ? folded : foldInto(chord.notes, w.lo, w.hi);
}

/** One chord, and how many bars it lasts. */
export type ChordSpan = readonly [degree: number, bars: number];

/**
 * The harmony of one eight-bar phrase, written as spans rather than per bar.
 *
 * It was four degrees looped twice — a chord per bar, which is exactly the rate
 * the tune's own phrase unit changes at. A melody only sounds like a melody
 * when it has something to move *over*: if the chord turns every time the tune
 * turns, every note lands on a chord tone and the line reads as an arpeggio
 * with the harmony spelling it out. It was then eight degrees, one per bar,
 * which held the tonic for two by repeating it — better, and still an array
 * that could only say "a chord per bar" and happened to say the same one twice.
 *
 * Addressing bars directly is what lets the harmonic rhythm be composed:
 *
 *     [0, 2]  two bars of tonic       the basic idea sings over one chord
 *     [5, 2]  two bars of the colour  the contrasting idea gets its own
 *     [2, 2]  two bars of another     the restatement, recoloured
 *     [4, 1]  one bar of dominant     the harmony suddenly moves
 *     [0, 1]  one bar of tonic        and the arrival lands on the move
 *
 * Four chords over six bars and then two chords in two bars. That change of
 * gear is most of what makes a cadence sound like an ending rather than like a
 * chord that happened next: the arrival has weight because the harmony started
 * moving twice as fast to get there. Locrian slows down further still and holds
 * one chord for four bars, which is what a mode with no stable tonic is for.
 *
 * The chords themselves keep each mode's identity, because that is what the
 * mode ladder is for — this only changes when they land.
 */
/*
 * MEASURED: do not halve these spans on their own.
 *
 * The 2026-08 score refactor's work order ranked "chords change every bar
 * instead of every two" as a high-value change, on the correct observation that
 * every score in the 8- and 16-bit canon does exactly that — Wily Stage 1
 * cycles i-VI-VII per bar, Frog's Theme runs i-VII-VI-VII in 12/8 — and that
 * harmonic rhythm is the cheapest lever there is on "this sounds like a loop
 * rather than a piece".
 *
 * `tools/clash.mjs` was written to check it before doing it, because the
 * comments below record clash counts that decided each ordering and there was
 * nothing in the repo that could reproduce them. Twelve one-chord-per-bar
 * candidates were scored against the live tables — the Frog progression, the
 * Wily progression and the descending tetrachord, in each of four modes:
 *
 *     aeolian        13 unresolved  ->  best candidate 16   (+3)
 *     dorian         17            ->  best candidate 21   (+4)
 *     phrygian       26            ->  best candidate 27   (+1)
 *     harmonicMinor   4            ->  best candidate  5   (+1)
 *
 * Every one is worse. Not one is better.
 *
 * RE-TESTED after three of the six themes were rebuilt, because the reason
 * given below — "THESE THEMES WERE WRITTEN AGAINST A TWO-BAR HARMONIC RHYTHM"
 * — stopped being true of half of them. A rejection whose premise has changed
 * is not a rejection any more, and two others recorded the same day flipped
 * when re-run (the pad register in `layers.ts`, `BPM_STEP` in `director.ts`).
 *
 * This one held, and the numbers above are the fresh ones. What moved is the
 * MARGIN: it was +4 / +4 / +5, and phrygian is now +1. Every absolute figure
 * fell too, because the rebuilt themes are more consonant. So the answer is
 * still no, and it is no by less than it was — worth re-running again if the
 * remaining three themes are ever rewritten, rather than treating this as
 * settled for good.
 *
 * The harmonicMinor row was originally recorded as "32 -> 32 (+0)", and that
 * pair of numbers described nothing real. `harmonicMinor` is kept out of
 * MODE_LADDER so the director reaches it only on the boss branch, and that
 * branch also forces `BOSS_THEME` — which is kept out of THEMES. The tool was
 * scoring the mode against six themes that can never sound in it, and scoring
 * the leitmotif against nothing at all. `clash.mjs` now pairs them correctly,
 * and the honest figure is 4 unresolved of 14 clashes (71% resolution), which
 * is healthier than phrygian (66%) or phrygianDominant (62%).
 *
 * The verdict survived the correction — a faster harmonic rhythm is still
 * worse for the boss — but it now rests on a measurement of the music that
 * actually plays.
 *
 * The reason is not that the canon is wrong; it is that THESE THEMES WERE
 * WRITTEN AGAINST A TWO-BAR HARMONIC RHYTHM. Each cell is shaped so its on-beat
 * notes land inside one chord, and doubling the rate makes every bar straddle a
 * change it was not written for. The canon's melodies were composed the other
 * way round, over their own faster harmony.
 *
 * So the change is not "edit this table". It is "rewrite THEMES and this table
 * together, and keep `npm run clash` from rising." Anyone attempting it should
 * start from the themes, not from here.
 */
/**
 * Which of the three harmonic sentences a phrase is built from.
 *
 * There was ONE sentence and nine colours of it — `[[x,2],[y,2],[z,2],[w,1],
 * [0,1]]` in eight of the nine modes, every chord a plain diatonic triad. A
 * listener meeting three or four modes over ten minutes therefore met one
 * eight-bar sentence, transposed. That is not a harmonic vocabulary; it is a
 * template with a colour dial.
 *
 * The three shapes are chosen by WHERE IN THE RUN the phrase falls (see
 * `ACT_SHAPE` in `arrangement.ts`), not by tension — that is the point. Tension
 * already drives the mode ladder; adding a second tension consumer would only
 * make the harmony a louder version of the same information.
 *
 *   period  the sentence that shipped. States, asks, restates, closes.
 *   turn    the same chords, entered from somewhere else, ARRIVING home in the
 *           middle of the phrase instead of starting there.
 *   climb   the period's first six bars, then a DECEPTIVE cadence: the dominant
 *           resolves anywhere but the tonic, so the phrase refuses to close and
 *           pushes into the next one.
 *
 * TWO INVARIANTS, both deliberate and both checkable:
 *
 * 1. **No alternative shape uses a degree the period shape does not.** A great
 *    many tools in `tools/` sweep `for (const [degree] of PROGRESSIONS[mode])`
 *    to enumerate the chords a mode can produce — `masking`, `motorcheck`,
 *    `leadcheck`, `basscheck`, `registermap`, `tune`, `contour`, `rhythm`,
 *    `motion`, `instruments`. If a new shape introduced a new degree, every one
 *    of those would silently stop being complete, which is precisely the
 *    "unmeasured properties rot" failure AGENTS.md §3 warns about. Holding the
 *    degree SET fixed and varying only the ORDER and the CADENCE keeps all ten
 *    tools total without editing any of them. `clash --shapes` asserts it.
 *
 * 2. **`turn` is a permutation of `period`'s spans.** Every mode's turn shape
 *    is the period shape with span 0 and span 2 exchanged (locrian exchanges
 *    its two unequal spans). Because `clash` scores (melodic cell, chord) pairs
 *    and the eight cells are the same eight cells in the same order, the
 *    multiset of pairs is unchanged and the unresolved-clash count is IDENTICAL
 *    by construction for every mode whose two swapped spans are the same
 *    length. That is not luck; it is why the swap was chosen over an invented
 *    progression. Lydian is the one mode where the swap is a no-op (spans 0 and
 *    2 are both `[0,2]`), so it is authored instead and measured like any other.
 */
export type ProgressionShape = 'period' | 'turn' | 'climb';

export const PROGRESSIONS: Record<ModeName, readonly ChordSpan[]> = {
  /*
   * I | II | I | V I : the Lydian cadence, and it is unlike every other entry
   * here. Lydian's whole identity is the raised fourth, and the only chord
   * that contains it is the MAJOR II — so a Lydian progression that avoids II
   * is just major with an accident in the melody. Alternating I and II is the
   * standard way to state the mode without leaving it, and the V at the end
   * closes the phrase the way the rest of this file does.
   */
  lydian: [[0, 2], [1, 2], [0, 2], [4, 1], [0, 1]],
  /*
   * I | vi | IV | V I : the most singable progression in Western music, and
   * that is exactly why it is here. This is the one colour in the game that
   * should sound like a tune the player could hum back, and the sentence shape
   * matches every other mode's — four chords over six bars, then two in two, so
   * the cadence arrives with the same change of gear.
   */
  ionian: [[0, 2], [5, 2], [3, 2], [4, 1], [0, 1]],
  // i | VII | IV | v i : the bright one. Dorian is the major IV and the major
  // VII and both get two whole bars rather than a passing one. VII goes under
  // the contrasting idea and IV under the restatement rather than the other way
  // round, which is not a preference: measured over all six themes, the other
  // order left seventeen on-beat notes clashing with the chord and only nine of
  // them resolving. This way there are eight and all eight resolve.
  dorian: [[0, 2], [6, 2], [3, 2], [4, 1], [0, 1]],
  // i | VI | III | v i : the workhorse minor chords, in a sentence.
  aeolian: [[0, 2], [5, 2], [2, 2], [4, 1], [0, 1]],
  // i | iv | VII | bII i : rising fourths, A - D - G, and then the flat second
  // falls onto the tonic. bII - i IS the Phrygian cadence — it does the work
  // that V - i does elsewhere — and it lands on the one bar where it matters
  // most rather than sitting under the whole phrase. Two bars of it in the
  // middle read as twenty-seven clashing on-beat notes with barely half of them
  // resolving; the mode's flat second is in the tune either way, because that
  // is what the second degree of the scale IS here.
  phrygian: [[0, 2], [3, 2], [6, 2], [1, 1], [0, 1]],
  // I | iv | bII | v° I : Spanish-cadence menace. The tonic triad is major
  // here and only I, bII and iv are consonant — everything else in the mode
  // stacks to diminished or augmented — so the vamp is built from those three
  // and the diminished fifth is saved for the one bar that has to push.
  phrygianDominant: [[0, 2], [3, 2], [1, 2], [4, 1], [0, 1]],
  // Barely a progression. Locrian has no stable tonic, so we pedal for four
  // bars and let the upper voices grind against it — and then it cadences in
  // the same two bars as everything else, so the phrase still has a shape.
  locrian: [[0, 4], [3, 2], [5, 1], [0, 1]],
  // Every triad in the octatonic scale is diminished, so there is no cadence to
  // write. It keeps the sentence's rhythm instead: hold, hold, hold, arrive.
  octatonic: [[0, 2], [3, 2], [6, 2], [4, 1], [0, 1]],
  /*
   * i | VI | iv | V i : the lament, and the only real cadence in this file.
   *
   * Everywhere else the fifth degree gives a minor chord and "V - i" is a
   * gesture rather than a resolution. Here the raised seventh makes it MAJOR,
   * so the last two bars are an actual authentic cadence with the leading tone
   * a semitone under the tonic. That is what a boss fight's harmony should do:
   * not drift darkly, but pull — hard — toward an arrival it keeps postponing.
   *
   * VI and iv under the middle four bars are the descending-tetrachord shape
   * every villain theme since Purcell has been built on, and they set up the
   * dominant without ever touching it early. The V is saved for one bar, once
   * per phrase, which is what stops the cadence from wearing out over a fight
   * that lasts a minute and a half.
   */
  harmonicMinor: [[0, 2], [5, 2], [3, 2], [4, 1], [0, 1]],
};

/**
 * THE TURN — the same sentence entered from somewhere else.
 *
 * The phrase opens on a colour chord and the TONIC ARRIVES under bars 5-6, the
 * restatement, instead of being where the music started. That is what a
 * development section does to material a listener already knows: it does not
 * give them a new tune, it takes the tune somewhere.
 *
 * EVERY ROW WAS SEARCHED, NOT WRITTEN. `node tools/clash.mjs --shapesearch`
 * scores every permutation of a phrase's body spans and every cadence target
 * inside the mode's own degree set, against the live themes. These are the
 * best-scoring candidate in each mode that also ends by arriving home. Five of
 * the nine are strictly BETTER than the period shape they sit beside and the
 * other four are identical:
 *
 *     mode              period   turn
 *     lydian                 0      0   (unchanged — see below)
 *     ionian                 3      0
 *     dorian                 3      3
 *     aeolian                7      6
 *     phrygian               9      8
 *     phrygianDominant      14     11
 *     locrian               16     16
 *     octatonic              6      6
 *     harmonicMinor          2      1
 *
 * LYDIAN KEEPS THE PERIOD SHAPE IN EVERY ACT, and that is a measurement rather
 * than an oversight. Its period scores ZERO unresolved clashes — the only mode
 * in the game that does — so nothing can beat it and everything differs from it
 * by being worse: all nine candidates the search produced score 13 or more.
 * A mode whose harmony is already perfect against every theme does not get a
 * development, because there is no version of it that is not a regression.
 * Lydian also requires energy under the measured p10 to be selected at all, so
 * this costs a listener almost nothing.
 */
export const PROGRESSIONS_TURN: Record<ModeName, readonly ChordSpan[]> = {
  lydian: [[0, 2], [1, 2], [0, 2], [4, 1], [0, 1]],
  // vi IV I V I — the tonic arrives in the middle of its own phrase.
  ionian: [[5, 2], [3, 2], [0, 2], [4, 1], [0, 1]],
  dorian: [[3, 2], [6, 2], [0, 2], [4, 1], [0, 1]],
  aeolian: [[2, 2], [5, 2], [0, 2], [4, 1], [0, 1]],
  phrygian: [[6, 2], [3, 2], [0, 2], [1, 1], [0, 1]],
  phrygianDominant: [[3, 2], [1, 2], [0, 2], [4, 1], [0, 1]],
  // The pedal ARRIVES rather than opening: four bars of it under bars 3-6.
  locrian: [[3, 2], [0, 4], [5, 1], [0, 1]],
  octatonic: [[6, 2], [3, 2], [0, 2], [4, 1], [0, 1]],
  harmonicMinor: [[5, 2], [3, 2], [0, 2], [4, 1], [0, 1]],
};

/**
 * THE CLIMB — the inner pair exchanged, so the middle of the phrase turns.
 *
 * The period's contrasting idea and its restatement meet each other's harmony.
 * In aeolian that takes `i VI III v i` to `i III VI v i` — the middle rises by
 * fourths where it used to fall by thirds — and in every mode it changes which
 * chord the phrase's high point is approached from. The tonic still opens and
 * the cadence still closes, so it reads as the same sentence said with a
 * different emphasis rather than as a third tune.
 *
 * A DECEPTIVE CADENCE WAS THE FIRST DESIGN AND IT WAS MEASURED AND REJECTED,
 * which is the useful half of this entry. The idea was right — a run's late act
 * should have a harmony that keeps promising an arrival and postponing it — and
 * `V` to the submediant is the textbook way to write one. Scored with
 * `clash.mjs`, it was worse in all nine modes and badly so:
 *
 *     lydian 0 -> 15    ionian 3 -> 8     dorian 3 -> 18
 *     aeolian 7 -> 12   phrygian 9 -> 18  phrygianDominant 14 -> 24
 *     locrian 16 -> 25  octatonic 6 -> 11 harmonicMinor 2 -> 2
 *
 * The cause is not subtle once the tool says it out loud: bar 8 carries the
 * `tag` cell, which is the cadence figure, and it is written to land on the
 * tonic. Put any other chord under it and the phrase's last note is left
 * hanging in eight modes out of nine. This is the same lesson as the
 * faster-harmonic-rhythm rejection above — the themes were written against a
 * specific harmony and the melody is the constraint, not the table.
 *
 * IT SURVIVES IN EXACTLY ONE MODE, and the exception proves the rule.
 * `harmonicMinor` scores 1 with `V - VI` against the period's 2, because it is
 * the only mode here with a real leading tone: the deception lands *because*
 * the ear was pulled hard toward a tonic that then does not come. So the one
 * deceptive cadence in the game belongs to the boss, is measurably better than
 * what it replaces, and is heard nowhere else.
 *
 * LOCRIAN AND OCTATONIC KEEP THE PERIOD SHAPE HERE. The search found exactly
 * one candidate at or under the period score in each, and the turn shape
 * already uses it. A third distinct sentence does not exist in those two
 * without a rise, and inventing one anyway is what the gate exists to stop.
 * Lydian keeps it for the reason given above.
 */
export const PROGRESSIONS_CLIMB: Record<ModeName, readonly ChordSpan[]> = {
  lydian: [[0, 2], [1, 2], [0, 2], [4, 1], [0, 1]],
  // I IV vi V I — the middle rises to the submediant instead of falling from it.
  ionian: [[0, 2], [3, 2], [5, 2], [4, 1], [0, 1]],
  // VII IV i v i — opens on dorian's bright major VII, which the period buries.
  dorian: [[6, 2], [3, 2], [0, 2], [4, 1], [0, 1]],
  aeolian: [[0, 2], [2, 2], [5, 2], [4, 1], [0, 1]],
  phrygian: [[0, 2], [6, 2], [3, 2], [1, 1], [0, 1]],
  phrygianDominant: [[0, 2], [1, 2], [3, 2], [4, 1], [0, 1]],
  locrian: [[0, 4], [3, 2], [5, 1], [0, 1]],
  octatonic: [[0, 2], [3, 2], [6, 2], [4, 1], [0, 1]],
  // i iv VI V VI — the one deceptive cadence in the game. See above.
  harmonicMinor: [[0, 2], [3, 2], [5, 2], [4, 1], [5, 1]],
};

const SHAPES: Record<ProgressionShape, Record<ModeName, readonly ChordSpan[]>> = {
  period: PROGRESSIONS,
  turn: PROGRESSIONS_TURN,
  climb: PROGRESSIONS_CLIMB,
};

/**
 * The progression for a mode in a given shape.
 *
 * Defensive in both arguments for the same reason `buildSlots` already guards
 * the mode: an unrecognised value used to throw from deep inside a pattern
 * build, killing the frame with a message that pointed nowhere near the cause.
 */
export function progressionFor(mode: ModeName, shape: ProgressionShape): readonly ChordSpan[] {
  const table = SHAPES[shape] ?? PROGRESSIONS;
  return table[mode] ?? PROGRESSIONS[mode] ?? PROGRESSIONS.aeolian;
}

/**
 * THE PIVOT — the chord that makes a modulation something you hear ARRIVE.
 *
 * The key moved every four waves and it moved by simply being different on the
 * next phrase. A listener does not hear that as a modulation; they hear it as
 * the music being in a new place, which is a much weaker event and is most of
 * why a run reads as a sequence of loops rather than as a piece going
 * somewhere. A modulation is a JOURNEY, and a journey needs the moment where
 * you can tell you are about to arrive.
 *
 * The geometry is free here and it is worth spelling out, because it is the
 * reason this costs one function instead of a modulation planner.
 * `onWaveStart` walks the cycle of fourths: the new tonic is always five
 * semitones above the old one (mod 12). So
 *
 *     V of the new key  =  newTonic + 7  =  oldTonic + 12  ≡  oldTonic
 *
 * — the outgoing tonic IS the incoming dominant. Nothing has to be searched
 * for; the pivot is the note the music is already sitting on, re-spelled. Make
 * it major with a flat seventh and the phrase's last bar becomes a dominant
 * seventh that resolves up a fourth onto the downbeat of the new key, which is
 * the single most recognisable arrival in Western music.
 *
 * The major third is the other half of it: `oldTonic + 4 = newTonic + 11`, the
 * new key's LEADING TONE. In every minor mode in `MODES` that note is foreign —
 * the scale has a flat seventh — so the pivot bar is also the one moment in the
 * run where a note from outside the mode sounds, and it sounds exactly where it
 * belongs, pulling a semitone up onto the new tonic.
 *
 * Register: anchored within a tritone of the outgoing tonic so the bass does
 * not leap an octave to play it. The upper voices are voice-led like any other
 * chord, so the pivot joins the phrase rather than interrupting it.
 */
export function pivotChord(fromTonic: number, toTonic: number): Chord {
  let root = toTonic + 7;
  while (root > fromTonic + 6) root -= 12;
  while (root < fromTonic - 6) root += 12;
  return {
    /*
     * A DOMINANT SEVENTH, spelled as one: root, LEADING TONE of the incoming
     * key, fifth, flat seventh.
     *
     * The flat seventh used to be `colour` — a tone that faded in on a signal
     * — which meant the one chord in the run whose entire job is to PULL was
     * built as a plain major triad most of the time. A dominant without its
     * seventh is not a dominant; the tritone between the third and the seventh
     * is the tension, and the resolution up a fourth is the release. Now that
     * `Chord.notes` carries sevenths everywhere, this one is no longer the
     * exception it should never have been.
     */
    notes: [root, root + 4, root + 7, root + 10],
    // Root, leading tone, fifth — and the flat seventh as the tension. The
    // same partition every other chord carries; see `Chord.core`.
    core: [root, root + 4, root + 7],
    tensions: [root + 10],
    // The ninth and the thirteenth above it. Unsounded — the colour pair that
    // faded them on `sig.colour7/9` is deleted — but led by `voiceLead` like
    // every other chord's, so the arp's placement and `phrasing` see them.
    colour: [root + 14, root + 21],
    // The symbol the stab spells it from (and the pad did). `7` is the iReal
    // key for a dominant seventh, so a pivot voices like every other chord.
    symbol: NOTE_NAMES[(((root % 12) + 12) % 12)] + '7',
    root,
    /*
     * Degree 4 — a dominant, stated as one.
     *
     * This is read by `buildBass` and `motorVoicing` to decide how a bar
     * behaves, and a pivot that reported degree 0 would tell the bass it was
     * sitting on the tonic in the bar where it is most emphatically not.
     */
    degree: 4,
    // The last bar of a phrase, where the tune falls into its cadence.
    contour: contourForBar(BARS_PER_PHRASE - 1),
    // The pad kept its third here, and only here. See `Chord.pivot`.
    pivot: true,
  };
}

/**
 * Which way the TUNE moves into each bar of a phrase. Measured, not assumed.
 *
 * The mean scale degree of each bar, averaged over all six themes, runs
 *
 *     bar   1     2     3     4     5     6     7     8
 *          1.9   3.1   3.5   3.8   1.9   3.1   5.2   1.0
 *
 * and every theme individually peaks at bar 7 and bottoms at bar 8, because
 * that is the period's shape rather than any one tune's: the high point falls
 * into the cadence. So the melody's direction bar by bar is a property of the
 * form, which is the only reason the harmony is allowed to know it — the pitches
 * stay a pure function of (theme, phrase, bar) and this is a constant.
 *
 * `voiceLead` uses it to keep the voicing's top voice from moving WITH the tune.
 * That is the rule counterpoint actually has: contrary motion is best, oblique
 * motion — one part moving while the other holds its common tone — is the
 * second best and is most of what a real inner voice does, and only similar
 * motion in both parts at once collapses them into one thickened line.
 *
 * Written first as "move down at bar 7, up at bars 5 and 8" with a bonus for
 * displacement, which was wrong twice over. It ratcheted, because those three
 * nudges do not sum to zero over a phrase and nothing pulled back: measured over eight
 * phrases the pad had climbed an octave, top voice at MIDI 81, in a project
 * whose standing complaint is that it sits too high. And once the register was
 * pinned it could only move the top voice in 2 of the 6 modes at any weight —
 * three-note triads in compact stacks anchored on the previous bar simply do
 * not offer a lower candidate most of the time. Forbidding the wrong direction
 * is a rule the available voicings can always obey; demanding a particular one
 * is not.
 */
const MELODY_CONTOUR: readonly number[] = [1, 1, 1, 1, -1, 1, 1, -1];

/** Which way the tune moves into this bar of the phrase. */
export function contourForBar(bar: number): number {
  return MELODY_CONTOUR[((bar % MELODY_CONTOUR.length) + MELODY_CONTOUR.length) % MELODY_CONTOUR.length];
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/**
 * Nth degree of a mode as a semitone offset, wrapping into higher octaves for
 * degrees past the end of the scale (and lower for negatives).
 */
export function degreeToSemitone(mode: ModeName, degree: number): number {
  const steps = MODES[mode];
  const len = steps.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return steps[idx] + octave * 12;
}

/**
 * The scale tone nearest a wanted interval above a chord's root.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `degree + 8`
 * ---------------------------------------------------------------------------
 *
 * Stacking thirds by scale STEPS — 0, 2, 4, 6 for the seventh chord and 8, 12
 * for the ninth and the thirteenth — is right in a seven-note scale and wrong
 * in any other, because "eight steps up" only means "a second above the
 * octave" when the octave is seven steps. `MODES.octatonic` has EIGHT, so
 * `degree + 8` is the octave itself: the ninth collapsed onto the root, the
 * chord's third was replaced by a doubling of its own bass, and
 * `tools/harmony.mjs` caught it as two bars that "unlock the ninth and do not
 * play it".
 *
 * An interval is a distance in semitones, so the search is over semitones. The
 * ninth is the scale tone nearest fourteen above the root and the thirteenth
 * the one nearest twenty-one — which reproduces `degree + 8` and `degree + 12`
 * exactly in all eight heptatonic modes (phrygian correctly gets a FLAT ninth,
 * because its second degree is flat) and gives the octatonic a b9 and a natural
 * 13 instead of a unison and a fifth.
 *
 * Ties go to the LOWER candidate: a flat ninth is a colour this palette already
 * has (phrygian, phrygian dominant) and a sharp ninth is a blues sound that
 * belongs to a different tradition than the one this score is imitating.
 */
export function extensionSemitone(mode: ModeName, degree: number, want: number): number {
  const root = degreeToSemitone(mode, degree);
  let best = degreeToSemitone(mode, degree + 1) + 12;
  let bestDist = Infinity;
  for (let d = degree + 1; d <= degree + 13; d++) {
    const semi = degreeToSemitone(mode, d);
    const dist = Math.abs(semi - root - want);
    if (dist < bestDist) {
      bestDist = dist;
      best = semi;
    }
  }
  return best;
}

export interface Chord {
  /**
   * MIDI notes of the chord's CORE, low to high. Four of them: 1, 3, 5, 7.
   *
   * It was three — a bare diatonic triad — with the seventh living in `colour`
   * as "a gain the caller rides, not a note list". That is the difference this
   * refactor is largely about. A seventh that only exists as a level is a
   * seventh the harmony does not have: the motor cannot comp it, the arp cannot
   * walk it, the stab cannot voice it, and every lane in the mix spells a triad
   * while one quiet triangle plays the tone that would have made it a chord.
   *
   * Four tones, always, structurally. `colour` moves up to the 9th and the 13th
   * — genuine colour, which is what that field was always supposed to be.
   */
  notes: number[];
  /**
   * The three tones that are the chord's body, and the one that is its
   * TENSION — a partition of `notes`, never a second copy of it.
   *
   * `tools/harmony.mjs` asserts `core.length === 3`, `tensions.length === 1`,
   * that the tension is 9, 10 or 11 semitones above the root, and that
   * `[...core, ...tensions]` reconstructs `notes` exactly AFTER `voiceLead` has
   * re-octaved and re-sorted everything. That last one is the assertion with
   * teeth: voicing destroys position, so without an explicit partition there is
   * no way for any tool downstream to tell a seventh from a fifth, and "the
   * chord has a seventh" would be a claim about the source rather than about
   * the object.
   *
   * Both are derived from pitch class after voicing rather than carried
   * through it, so they cannot go stale.
   */
  core: number[];
  tensions: number[];
  /**
   * The chord symbol, e.g. `"A-7"`. See `chordSymbol` and `laneTones`.
   *
   * Optional so the six tools that construct a `Chord` by hand, and
   * `voiceLead`'s spread, keep compiling — `laneTones` falls back to `notes`
   * when it is absent, which is the same fallback it uses for a symbol the
   * dictionary cannot spell.
   */
  symbol?: string;
  /*
   * The 9th and the 13th, kept OUT of `notes` on purpose.
   *
   * Extensions used to be selected at build time from a tension threshold, so
   * crossing it rewrote the chord — and everything that reads the chord. The
   * arp walks `notes`, so a fourth tone appearing shifted every pitch in its
   * line: measured, one step of the tension dial left the arp with 44% of its
   * phrase and the chords with 75%.
   *
   * Separating them lets the core be a pure function of the progression while
   * the colour tones fade in and out on a signal. The harmony still opens up as
   * things get tense — it just does it by getting louder rather than by being
   * replaced. `[ninth, thirteenth]`, always both, always in that order; the
   * SEVENTH is no longer here, because a seventh is not colour, it is the
   * chord.
   */
  colour: number[];
  /** MIDI note of the chord root, for the bass line. */
  root: number;
  degree: number;
  /*
   * Which way the TUNE moves into this bar. -1 down, +1 up, 0 unknown.
   *
   * `voiceLead` sees a chord and the voicing before it and nothing else — it
   * cannot know what the melody is doing, and the director, which does, is not
   * ours to change. But the melody's shape over a phrase is a property of the
   * period rather than of any one theme (see MELODY_CONTOUR), so the bar can
   * carry it: `chordForBar` knows which bar it is building and writes the
   * contour into the chord, and it arrives here through the same value the
   * director already passes.
   */
  contour: number;
  /**
   * True on the one bar per modulation that is the incoming key's dominant.
   *
   * READ BY THE STAB since the pad was deleted: `stabGuideTones` spells the
   * dominant's root and the leading tone on a pivot instead of the guide
   * tones, and `buildChords` lets the stab play a pivot bar inside a breakdown
   * — the one bar that lane otherwise rests. Measured by `tools/arc.mjs`
   * ARRIVAL: 12/12 modulations announced with the pad, 10/12 with guide tones
   * alone, 12/12 owed back by this. The flag existed
   * because of a collision between two good rules. The pad dropped the THIRD
   * whenever the melody was sounding — the
   * third is the tone that grinds against a tune held for a whole bar, and the
   * motor is stating it anyway (see the open-fifths note in `buildChords`). On
   * a pivot that rule deletes the only note that matters: the major third of
   * the incoming dominant IS the new key's leading tone, and a dominant without
   * its third is a suspended chord that pulls nowhere.
   *
   * Measured off the haps before this field existed: over four twenty-minute
   * runs, the leading tone reached the `chords` lane on 9 of 42 modulations —
   * exactly the ones where tension happened to sit under `STEM_CURVES.lead.in`
   * so the open-fifths rule was not engaged. The bass and the motor carried it
   * on the other 33, so the harmony was never wrong; the pad simply was not
   * helping on the one bar it should have been loudest.
   *
   * Optional so every other construction site — `buildChord`, and the six tools
   * that build chords by hand — is unchanged and reads `undefined`.
   */
  pivot?: boolean;
}

/**
 * Build a diatonic stack on `degree`, as a core triad plus its colour tones.
 *
 * The 7th and 9th are where most of the "this sounds like a real track" comes
 * from, and they used to be added or withheld here from a tension threshold.
 * They are now always returned, separately, and the caller fades them — see the
 * note on `Chord.colour`.
 */
/**
 * How far up the stack of thirds a chord is spelled.
 *
 * `seventh` is 1-3-5-7. `ninth` REPLACES THE THIRD with the ninth — 1-9-5-7 —
 * rather than adding it, and that is the whole reason this is an enum rather
 * than a boolean.
 *
 * WHY REPLACE. `buildChords` records a version of "add the ninth" being
 * reverted for taking the stab from two voices to three: 46,464 haps to 69,696
 * over an identical sweep, and 41.1 to 44.7 pitched note-events per bar,
 * against `MASTER_PLAN` §7's standing suspicion that ONSET DENSITY is what
 * "abrasive over time" means. A ninth that costs a transient is harmony bought
 * with the complaint it is supposed to answer.
 *
 * Replacing the third is also what a keyboard player does. The third is the
 * tone that grinds against a sustained melody a semitone or a tone away — the
 * pad dropped it for exactly that reason, when there was one — and the MOTOR states it
 * continuously in its own register, so the chord's quality is never in doubt.
 * What the substitution buys is the sound of a ninth chord, at the same voice
 * count, in the one lane a listener follows the harmony in.
 *
 * WHICH ONE IS PLAYED is a property of the ACT: `ACT_SHAPE.ninth` is false in
 * the exposition and the development and true from the intensification on, so
 * the ninth is RESERVED MATERIAL — a thing the run earns rather than a thing
 * that is simply on. See `arrangement.ts`.
 */
export type Extension = 'seventh' | 'ninth';

export function buildChord(
  tonic: number,
  mode: ModeName,
  degree: number,
  octave = 0,
  extend: Extension = 'seventh',
): Chord {
  const base = tonic + octave * 12;
  /*
   * `[0, 2, 4, 6]` — a SEVENTH chord, not a triad.
   *
   * The seventh is the tone that tells you what kind of chord you are hearing.
   * A minor triad and a half-diminished are the same three notes plus one, and
   * `PROGRESSIONS` is full of degrees whose whole identity is their seventh:
   * dorian's major VII, phrygian dominant's bII, harmonic minor's V. Without
   * it every mode in the ladder reduces to major-or-minor and the ladder does
   * not sound like a ladder.
   *
   * The pitch classes here are the same ones `chordSuffix` reads to name the
   * chord and the same ones the iReal dictionary spells in `laneTones`, because
   * both derive from `degreeToSemitone` rather than from a table. There is one
   * definition of "the chord on this degree" in this file.
   */
  const at = (d: number): number => base + degreeToSemitone(mode, degree + d);
  /*
   * The ninth and the thirteenth are found by INTERVAL, not by scale step. See
   * `extensionSemitone` — `degree + 8` is the octave in an eight-note scale,
   * and `MODES.octatonic` is one.
   */
  const ninth = base + extensionSemitone(mode, degree, 14);
  const thirteenth = base + extensionSemitone(mode, degree, 21);
  // The body: root, the third OR the ninth that stands in for it, and the
  // fifth. Three tones, whichever extension is in play — see `Extension`.
  const core = [at(0), extend === 'ninth' ? ninth : at(2), at(4)].sort((a, b) => a - b);
  // The tension: the seventh, always, and always exactly one.
  const tensions = [at(6)];
  const notes = [...core, ...tensions].sort((a, b) => a - b);
  /*
   * The 9th and the 13th, and the field's meaning moved up a rung with the
   * chord.
   *
   * `Signals.colour7` and `colour9` were the faders on these two — named for
   * the seventh and the ninth they used to fade, riding the ninth and the
   * thirteenth by the end. Both signals are gone with the colour pair that
   * read them (`buildChords`). Nothing SOUNDS `colour` now; it is led by
   * `voiceLead` into `LANE_RANGE.colour` so that the arp's window placement
   * and `phrasing.mjs`'s clash scoring keep seeing the same two tones. The
   * ordering is unchanged — the lower extension first — for whoever sounds
   * them next.
   */
  const colour = [ninth, thirteenth];
  // No contour by default: a chord built outside the phrase — for the key
  // readout, the intro's first chord — has no bar to take a shape from.
  return {
    notes,
    core,
    tensions,
    colour,
    symbol: chordSymbol(tonic, mode, degree),
    root: at(0),
    degree,
    contour: 0,
  };
}

/**
 * Re-voice a chord as three continuing VOICES rather than three nearest notes.
 *
 * This is the difference between a progression that lurches and one that
 * moves. Root-position triads on every degree jump the whole upper structure
 * around by fourths and fifths; voice leading keeps common tones put and moves
 * everything else by a step or two, which is what a keyboard player does
 * without thinking about it.
 *
 * The first version measured each new pitch against the *nearest* pitch of the
 * previous chord, whichever one that was. That minimises total movement, which
 * is what `tools/voicecheck.mjs` asks about, and it is not the same thing as
 * voice leading: with no memory of which pitch belonged to which voice, the
 * middle voice was free to land where the top voice had been. Total motion
 * stayed low and every line was discontinuous, so the pad read as one block
 * changing shape instead of as three parts moving. A listener follows the top
 * note of a chord whether or not anyone meant them to.
 *
 * So all three inversions are built as compact stacks, each is scored against
 * the previous voicing voice by voice — bottom to bottom, top to top — and the
 * one whose parts move least wins. Nothing can cross, because a stack is built
 * upward. Two consecutive voices moving the same direction into the same
 * perfect interval are penalised: consecutive fifths and octaves are the one
 * thing that reliably collapses independent parts back into one thickened
 * line, which is why the rule exists at all.
 *
 * Two more things are scored, and both are about the pad's relationship to
 * things this function cannot see. It may not LEAP in the direction the tune is
 * going (`Chord.contour`), and it is charged for climbing above the melody's
 * floor. Neither is voice leading in the textbook sense; both are the voicing
 * remembering that it is the bed and not the tune. (The pad that SOUNDED this
 * voicing is deleted — `buildChords` — but the voicing is still where the
 * stab's fold and the arp's placement start from, so the rules stay.)
 *
 * The chord's `root` is deliberately left alone — the bass keeps playing the
 * true root while the upper voices lead. That division of labour is the
 * standard one and it is why it works.
 */
/*
 * The window comes from `LANE_RANGE.pad`, not from two literals.
 *
 * It was `low = 55, high = 79` — twenty-four semitones, which is not a pad's
 * register, it is the whole of the middle of the mix. `registermap` measured
 * the result at 51-62 because `buildChords` then folded voices down again on
 * its own; two rules were arguing about where this lane sits and neither of
 * them was written down anywhere a tool could read.
 *
 * `high` is `LANE_RANGE.pad.hi + 6` because this function's own ceiling test is
 * `stack[top] > high + 6` — a soft allowance for the top voice of a stack whose
 * bottom is already inside the window. `buildChords` folds what is left.
 */
export function voiceLead(
  prev: readonly number[],
  chord: Chord,
  low = LANE_RANGE.pad.lo,
  high = LANE_RANGE.pad.hi,
): Chord {
  if (!prev.length) return chord;
  const previous = [...prev].sort((a, b) => a - b);
  /*
   * The colour tones are led against the same previous voicing but allowed to
   * sit an octave higher, which is where a keyboard player puts a 9th: on top,
   * out of the way of the triad rather than inside it.
   */
  const leadVoices = (pitches: readonly number[], lo: number, hi: number): number[] => {
    const out: number[] = [];
    for (const n of pitches) {
      let best = n;
      let bestDist = Infinity;
      for (let octave = -3; octave <= 3; octave++) {
        const candidate = n + octave * 12;
        if (candidate < lo || candidate > hi) continue;
        let d = Infinity;
        for (const q of previous) d = Math.min(d, Math.abs(candidate - q));
        if (out.includes(candidate)) d += 6;
        if (d < bestDist) {
          bestDist = d;
          best = candidate;
        }
      }
      out.push(best);
    }
    return out;
  };
  /*
   * The colour tones are led into `LANE_RANGE.colour`, not into "somewhere
   * above the pad".
   *
   * It was `low + 5 .. high + 12` — a window derived from the pad's, so moving
   * the pad moved the 9th, and `registermap` measured the result at MIDI 56-90:
   * a thirty-four-semitone spread for two voices, the widest of any group in
   * the score and wider than the pad, the motor and the stab put together. A
   * tone that can be anywhere is not a register, and two of them wandering
   * across three octaves is why "chords" collided with every other lane in the
   * masking table at once.
   */
  const colour = leadVoices(chord.colour, LANE_RANGE.colour.lo, LANE_RANGE.colour.hi);

  /*
   * Every inversion is tried, and the one whose voices move least wins.
   *
   * Choosing an octave per tone independently is not enough: rank the tones and
   * insist each voice sits above the one below and you have re-derived root
   * position for every chord, which is the lurching this function exists to
   * remove. What varies between voicings of a triad is which tone is on the
   * bottom, so that is what gets searched.
   */
  const tones = [...chord.notes].sort((a, b) => a - b);
  const voices = tones.length;
  const was = (v: number): number => {
    const idx = Math.min(v, previous.length - 1);
    return previous[idx] + (v > idx ? 12 : 0);
  };
  const candidates: { stack: number[]; score: number }[] = [];
  for (let rotation = 0; rotation < voices; rotation++) {
    const stack: number[] = [];
    for (let v = 0; v < voices; v++) {
      const pitch = tones[(rotation + v) % voices];
      if (v === 0) {
        /*
         * The bottom voice anchors the stack near where the bottom voice was,
         * inside ONE octave from the bottom of the range.
         *
         * Every voicing is chosen relative to the one before it, so nothing was
         * stopping the whole pad from walking, and measured over eight phrases
         * it did: three of the six modes settled with the bottom voice at MIDI
         * 72 and the top at 81, an octave above where they started, because
         * each phrase's cadence handed the next phrase a higher seed. A
         * relative rule needs an absolute anchor somewhere or it is a random
         * walk with good manners. Twelve semitones exactly, because a narrower
         * window would not contain every pitch class and some chord would have
         * nowhere legal to put its bass.
         *
         * A soft penalty on the distance from home was tried first and could
         * not do it: all three candidate voicings anchor near the same previous
         * pitch, so there was never a lower candidate for it to prefer.
         */
        let best = pitch;
        let dist = Infinity;
        for (let octave = -4; octave <= 4; octave++) {
          const candidate = pitch + octave * 12;
          if (candidate < low || candidate > low + 11) continue;
          if (Math.abs(candidate - was(0)) < dist) {
            dist = Math.abs(candidate - was(0));
            best = candidate;
          }
        }
        stack.push(best);
        continue;
      }
      // Everything above sits in the closest octave that clears the voice
      // below: a compact stack, which is how a chord is actually played.
      let placed = pitch;
      while (placed <= stack[v - 1]) placed += 12;
      while (placed - 12 > stack[v - 1]) placed -= 12;
      stack.push(placed);
    }
    /*
     * PENALISED, NOT REJECTED — and the difference became load-bearing the day
     * the chord grew a seventh.
     *
     * This was `if (stack[voices - 1] > high + 6) continue`. A three-note
     * compact stack is at most eight semitones tall and always fitted; a
     * FOUR-note stack of a seventh chord is ten or eleven, so against a window
     * this narrow every rotation could overshoot, `candidates` would come back
     * empty, and the function would silently return the chord unvoiced — the
     * exact lurching it exists to remove, arriving as a fallback rather than as
     * a bug anyone would see.
     *
     * 40 per semitone is heavy enough that any voicing inside the window beats
     * any voicing outside it (the movement terms are single digits), and finite
     * so there is always something to choose from.
     */
    let score = 40 * Math.max(0, stack[voices - 1] - (high + 6));
    for (let v = 0; v < voices; v++) score += Math.abs(stack[v] - was(v));
    /*
     * And a voicing that stays under the tune.
     *
     * Voice leading is all relative — every voicing is chosen against the one
     * before it — so nothing here knows how high the whole thing has floated.
     * Measured over ten phrases, dorian and phrygian dominant settled with the
     * pad at 62-74 while the other four sat at 55-65, which is a pad in the
     * middle of the melody's own register in two modes out of six and a
     * different instrument's job in the other four.
     *
     * The ceiling was `low + 14` — the melody's floor expressed relative to a
     * window that has since moved and is now written down. `LANE_RANGE.pad.hi`
     * is the same intent stated once, in the table both the builders and the
     * gate read, rather than as arithmetic on this function's argument.
     */
    score += 2 * Math.max(0, stack[voices - 1] - LANE_RANGE.pad.hi);


    for (let v = 1; v < voices; v++) {
      const gap = (stack[v] - stack[v - 1]) % 12;
      const wasGap = (was(v) - was(v - 1)) % 12;
      const bothRise = stack[v] > was(v) && stack[v - 1] > was(v - 1);
      const bothFall = stack[v] < was(v) && stack[v - 1] < was(v - 1);
      /*
       * A perfect fifth or an octave approached in parallel from the same
       * interval: the two voices stop being two.
       *
       * Measured, this term never fires for any of the six progressions in
       * `PROGRESSIONS` — the inversion search reaches zero parallels on its
       * own, and `tools/phrasing.mjs` asserts that it still does. It stays
       * because it constrains the search rather than describing the result, and
       * the progressions above get edited far more often than this function
       * does. Two other refinements tried here did NOT stay: weighting the top
       * voice's movement, and charging it for standing still, both produced
       * byte-identical voicings in all six modes. A rule that changes nothing
       * is a claim the code does not deliver, and it was deleted.
       */
      if ((gap === 7 || gap === 0) && gap === wasGap && (bothRise || bothFall)) score += 9;
    }
    candidates.push({ stack, score });
  }
  /*
   * And the voicing may not LEAP the way the tune is going.
   *
   * A flat penalty on similar motion rather than a bonus for contrary motion:
   * it removes an option instead of pushing a direction, so it cannot lurch and
   * it cannot ratchet the register the way a displacement bonus did.
   *
   * Only leaps, though, and that correction came from the measurement. Banning
   * similar motion outright left aeolian and phrygian failing their own rule
   * two bars in eight, and the "offending" voicing was 57,60,65 against
   * 57,60,64 — two common tones held and the top moving one semitone, which is
   * the best voice leading available and does not stop being that because the
   * melody also happens to rise. The rule counterpoint actually has is about
   * both parts leaping together, and about approaching a perfect interval in
   * similar motion, which the neighbouring-voice check above already covers.
   */
  if (chord.contour) {
    for (const c of candidates) {
      const moved = c.stack[voices - 1] - was(voices - 1);
      if (Math.abs(moved) >= 3 && Math.sign(moved) === Math.sign(chord.contour)) c.score += 6;
    }
  }
  let notes = tones;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.score < bestScore) {
      bestScore = c.score;
      notes = c.stack;
    }
  }
  const unique = [...new Set(notes)].sort((a, b) => a - b);
  const voiced = unique.length ? unique : chord.notes;
  /*
   * RE-DERIVE THE PARTITION, by pitch class, from the voicing that won.
   *
   * Voicing destroys position: every tone has been re-octaved and the whole
   * stack re-sorted, so `core` and `tensions` as `buildChord` wrote them no
   * longer name any note in `notes`. Carrying them through unchanged would make
   * them a claim about a chord that no longer exists — and `harmony.mjs`'s
   * PARTITION assertion exists precisely because that failure is invisible:
   * three numbers and one number, both plausible, neither pointing at anything.
   *
   * Pitch class is the right key because an octave transposition is exactly
   * what voicing is allowed to do and exactly what it must not be allowed to
   * hide. The tension is whichever voiced note shares a pitch class with the
   * seventh; everything else is the body.
   */
  const tensionPcs = new Set(chord.tensions.map((n) => (((n % 12) + 12) % 12)));
  const ledTensions = voiced.filter((n) => tensionPcs.has((((n % 12) + 12) % 12)));
  const ledCore = voiced.filter((n) => !tensionPcs.has((((n % 12) + 12) % 12)));
  return {
    ...chord,
    notes: voiced,
    /*
     * The partition falls back to the unvoiced one if the fold collapsed two
     * tones onto the same pitch, which `unique` can do. A partition that does
     * not reconstruct `notes` is worse than no partition, so the fallback keeps
     * the two halves consistent with each other rather than with the original.
     */
    core: ledCore.length && ledTensions.length ? ledCore : voiced.slice(0, Math.max(1, voiced.length - 1)),
    tensions: ledCore.length && ledTensions.length ? ledTensions : voiced.slice(-1),
    // Never double a chord tone with a colour tone: the fade would then change
    // the loudness of a pitch already sounding rather than adding one.
    colour: colour.filter((n) => !voiced.includes(n)),
  };
}

/** Human-readable key label for the HUD, e.g. "A phrygian". */
export function keyLabel(tonic: number, mode: ModeName): string {
  return `${NOTE_NAMES[((tonic % 12) + 12) % 12]} ${mode}`;
}
