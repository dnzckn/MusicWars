/**
 * Music theory, expressed in MIDI numbers.
 *
 * Everything downstream works in raw MIDI integers rather than note names or
 * Strudel's scale strings. It costs a few lines here and buys exact control:
 * the director can transpose, invert and voice chords with plain arithmetic,
 * and there is no string parsing between "the player is in trouble" and "the
 * chord got darker".
 */

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
 * `voiceLead` uses it to keep the pad's top voice from moving WITH the tune.
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

export interface Chord {
  /** MIDI notes of the core triad, low to high. */
  notes: number[];
  /*
   * The 7th and 9th, kept OUT of `notes` on purpose.
   *
   * Extensions used to be selected at build time from a tension threshold, so
   * crossing it rewrote the chord — and everything that reads the chord. The
   * arp walks `notes`, so a fourth tone appearing shifted every pitch in its
   * line: measured, one step of the tension dial left the arp with 44% of its
   * phrase and the chords with 75%.
   *
   * Separating them lets the triad be a pure function of the progression while
   * the colour tones fade in and out on a signal. The harmony still opens up as
   * things get tense — it just does it by getting louder rather than by being
   * replaced. `[seventh, ninth]`, always both, always in that order.
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
}

/**
 * Build a diatonic stack on `degree`, as a core triad plus its colour tones.
 *
 * The 7th and 9th are where most of the "this sounds like a real track" comes
 * from, and they used to be added or withheld here from a tension threshold.
 * They are now always returned, separately, and the caller fades them — see the
 * note on `Chord.colour`.
 */
export function buildChord(tonic: number, mode: ModeName, degree: number, octave = 0): Chord {
  const base = tonic + octave * 12;
  const notes = [0, 2, 4].map((d) => base + degreeToSemitone(mode, degree + d));
  // Both colour tones are always computed. `extensions` decides how much of
  // each is *heard*, which is a gain the caller rides, not a note list.
  const colour = [6, 8].map((d) => base + degreeToSemitone(mode, degree + d));
  // No contour by default: a chord built outside the phrase — for the key
  // readout, the intro's first chord — has no bar to take a shape from.
  return { notes, colour, root: notes[0], degree, contour: 0 };
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
 * floor. Neither is voice leading in the textbook sense; both are the pad
 * remembering that it is the bed and not the tune.
 *
 * The chord's `root` is deliberately left alone — the bass keeps playing the
 * true root while the upper voices lead. That division of labour is the
 * standard one and it is why it works.
 */
export function voiceLead(prev: readonly number[], chord: Chord, low = 55, high = 79): Chord {
  if (!prev.length) return chord;
  const previous = [...prev].sort((a, b) => a - b);
  /*
   * The colour tones are led against the same previous voicing but allowed to
   * sit an octave higher, which is where a keyboard player puts a 9th: on top,
   * out of the way of the triad rather than inside it.
   */
  const lead = (pitches: readonly number[], lo: number, hi: number): number[] => {
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
  const colour = lead(chord.colour, low + 5, high + 12);

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
    if (stack[voices - 1] > high + 6) continue;
    let score = 0;
    for (let v = 0; v < voices; v++) score += Math.abs(stack[v] - was(v));
    /*
     * And a pad that stays under the tune.
     *
     * Voice leading is all relative — every voicing is chosen against the one
     * before it — so nothing here knows how high the whole thing has floated.
     * Measured over ten phrases, dorian and phrygian dominant settled with the
     * pad at 62-74 while the other four sat at 55-65, which is a pad in the
     * middle of the melody's own register in two modes out of six and a
     * different instrument's job in the other four.
     *
     * The melody's floor is the tonic an octave up, which for the range this is
     * always called with is `low + 14`. Above that the pad is competing with the
     * tune rather than supporting it, so it is charged for going there — softly,
     * because the alternative is sometimes genuinely worse voice leading.
     */
    score += 2 * Math.max(0, stack[voices - 1] - (low + 14));


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
   * And the pad may not LEAP the way the tune is going.
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
  return {
    ...chord,
    notes: unique.length ? unique : chord.notes,
    // Never double a triad tone with a colour tone: the fade would then change
    // the loudness of a pitch already sounding rather than adding one.
    colour: colour.filter((n) => !unique.includes(n)),
  };
}

/** Human-readable key label for the HUD, e.g. "A phrygian". */
export function keyLabel(tonic: number, mode: ModeName): string {
  return `${NOTE_NAMES[((tonic % 12) + 12) % 12]} ${mode}`;
}
