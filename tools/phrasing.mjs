/**
 * Is the melodic writing any good?
 *
 * Not "does the lead make a sound" — `opening`, `themecheck` and `counterpoint`
 * already cover that, and all three passed throughout the period when the tune
 * was one bar of material played twice. Everything this asks about is a static
 * property of THEMES and the cell functions, so it reads them straight off the
 * dev server rather than listening to anything. There is nothing here a browser
 * is needed for except module resolution.
 *
 * What it asserts, and why each one is a thing that was actually wrong:
 *
 *   distinct bars    a-a'-b-tag repeated every cell, so eight bars contained
 *                    three bars of material and the longest stretch before
 *                    something repeated was one bar.
 *   skeleton         the melody's odd slots are faded to a fifth when the game
 *                    is calm, so a bar whose notes are all on offbeats has
 *                    nothing left. One old theme was entirely offbeat.
 *   filigree         and the notes on those offbeats have to be passing or
 *                    neighbour tones of the frame around them, or the fader
 *                    switches between two different tunes instead of between a
 *                    plain one and its diminution.
 *   steps / leaps    a line that leaps and does not come back is a chord being
 *                    spelled out, not a melody.
 *   one high point   a phrase with three equal-highest notes has no shape.
 *   cadence          the last bar has to reach the tonic and stop on it.
 *   harmonic rhythm  a chord per bar changes as often as the tune does, which
 *                    leaves the tune nothing to move over.
 *
 * Thresholds are exact rather than generous because every number here is
 * deterministic: same source, same answer, every run. Nothing in this file can
 * land in its own noise.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const r = await p.evaluate(async () => {
  const L = await import('/src/audio/layers.ts');
  const T = await import('/src/audio/theory.ts');
  const BARS = 8;

  const phraseOf = (theme, phrase) => {
    const bars = [];
    for (let i = 0; i < BARS; i++) bars.push(L.cellForBar(theme, phrase, i));
    return bars;
  };

  const themes = [];
  for (let t = 0; t < 32; t++) {
    // themeForWave is the only way in from outside; even waves are the
    // signature, odd ones walk the episodes.
    const theme = L.themeForWave(t, false);
    const id = JSON.stringify(theme);
    if (!themes.some((x) => x.id === id)) themes.push({ id, theme });
  }

  const rows = themes.map(({ theme }, index) => {
    const bars = phraseOf(theme, 0);
    const shapes = new Set(bars.map((c) => JSON.stringify(c)));

    // Every sounding note in phrase order, with the slot it lands on.
    const notes = [];
    bars.forEach((cell, bar) => cell.forEach((d, slot) => d !== null && notes.push({ d, bar, slot })));

    // On-beat notes are the skeleton; that is the layer that never fades.
    const skeletonPerBar = bars.map((c) => c.filter((d, i) => d !== null && i % 2 === 0).length);

    // An offbeat note must connect to the frame: a step from the note before it
    // or the note after it, or strictly between them.
    let filigree = 0;
    let connected = 0;
    bars.forEach((cell) => {
      cell.forEach((d, i) => {
        if (d === null || i % 2 === 0) return;
        filigree++;
        const before = i > 0 ? cell.slice(0, i).reverse().find((x) => x !== null) : undefined;
        const after = cell.slice(i + 1).find((x) => x !== null);
        const near = [before, after].filter((x) => x !== undefined && x !== null);
        const passing = before !== undefined && after !== undefined && after !== null && before !== null
          && ((before < d && d < after) || (after < d && d < before));
        if (passing || near.some((x) => Math.abs(x - d) <= 1)) connected++;
      });
    });

    /*
     * Melodic intervals across the whole phrase, in scale degrees.
     *
     * Intervals that span a rest of two slots or more are counted for the step
     * ratio but exempted from the leap rule. "A leap is answered by a step back"
     * is a rule about a continuous line; a rest ends the gesture, and every
     * exempted interval here is the one where the antecedent has breathed and
     * the consequent starts somewhere new. Requiring an answer there would be
     * requiring the phrase not to have a comma in it.
     */
    const steps = [];
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1];
      const gap = (notes[i].bar - prev.bar) * 8 + notes[i].slot - prev.slot;
      steps.push({ iv: notes[i].d - prev.d, joined: gap <= 2 });
    }
    const stepwise = steps.filter((s) => Math.abs(s.iv) <= 2).length;
    const leaps = [];
    steps.forEach((s, i) => {
      if (Math.abs(s.iv) <= 2 || !s.joined) return;
      // Answered by a step the other way, or by a step on and then the turn:
      // a leap up to a peak one note short of the top still comes back down.
      const a = steps[i + 1];
      const c = steps[i + 2];
      const back = (x) => x !== undefined && Math.abs(x.iv) <= 2 && Math.sign(x.iv) === -Math.sign(s.iv);
      const on = (x) => x !== undefined && Math.abs(x.iv) <= 2 && Math.sign(x.iv) === Math.sign(s.iv);
      leaps.push({ size: s.iv, answered: back(a) || (on(a) && back(c)) });
    });

    const top = Math.max(...notes.map((n) => n.d));
    const apex = notes.filter((n) => n.d === top);
    const low = Math.min(...notes.map((n) => n.d));

    const antecedent = bars[3];
    const lastAnte = [...antecedent].reverse().find((x) => x !== null);
    /*
     * The arrival. The last bar has to reach the tonic and stay there — the one
     * thing allowed after it is a note a step away, which is an upbeat leading
     * back into the top of the next phrase rather than the phrase carrying on.
     */
    const tag = bars[7];
    const tonicAt = tag.findIndex((x) => x === 0);
    const afterTonic = tonicAt >= 0 ? tag.slice(tonicAt + 1).filter((x) => x !== null && Math.abs(x) > 1).length : -1;

    return {
      theme: index,
      distinctBars: shapes.size,
      notes: notes.length,
      minSkeleton: Math.min(...skeletonPerBar),
      filigreeConnected: filigree ? Math.round((connected / filigree) * 100) : 100,
      stepwisePct: steps.length ? Math.round((stepwise / steps.length) * 100) : 0,
      leaps: leaps.length,
      leapsAnswered: leaps.filter((l) => l.answered).length,
      range: `${low}..${top}`,
      apexCount: apex.length,
      apexBar: apex[0].bar + 1,
      anteEndsOpen: lastAnte !== 0 && antecedent[7] === null,
      cadence: tonicAt >= 0 && afterTonic === 0,
    };
  });

  /*
   * Harmonic rhythm, per mode, read off the real `chordForBar` rather than off
   * the table — the spans say how long a chord lasts and this asks what a
   * listener actually gets, bar by bar.
   */
  const degreesOf = (mode) => {
    const prog = T.PROGRESSIONS[mode];
    const out = [];
    for (let bar = 0; bar < BARS; bar++) out.push(L.chordForBar(57, mode, prog, bar).degree);
    return out;
  };
  const harmony = Object.keys(T.PROGRESSIONS).map((mode) => {
    const degrees = degreesOf(mode);
    const runs = [];
    for (const d of degrees) {
      if (runs.length && runs[runs.length - 1].degree === d) runs[runs.length - 1].bars++;
      else runs.push({ degree: d, bars: 1 });
    }
    return {
      mode,
      chords: runs.length,
      barsPerChord: (BARS / runs.length).toFixed(2),
      // Bars sitting under a chord that lasts two or more, and the profile the
      // cadence is supposed to break: the last two bars move twice as fast as
      // the rest, which is the change of gear that makes an arrival an arrival.
      heldBars: runs.filter((r) => r.bars >= 2).reduce((a, r) => a + r.bars, 0),
      longestHold: Math.max(...runs.map((r) => r.bars)),
      rhythm: runs.map((r) => r.bars).join(' '),
      cadenceFaster: runs[runs.length - 1].bars === 1 && runs[runs.length - 2].bars === 1 && Math.max(...runs.map((r) => r.bars)) >= 2,
      endsOnTonic: degrees[BARS - 1] === 0,
      progression: degrees.join(' '),
    };
  });

  /*
   * The vertical dimension: where the tune sits against the chord under it.
   *
   * Two different questions, and only the second is a pass/fail.
   *
   * `chordTone` is how much of the tune lands on a note of the chord under it,
   * on a beat. A melody that is all chord tones is the harmony being spelled
   * out — pretty, and not a tune. A melody that is none of them is not in the
   * key. What you want is a line that is mostly independent of the chord and
   * touches it at the ends of gestures.
   *
   * `clash` is the subset that actually grates: an on-beat note a semitone or a
   * tritone from a chord tone. Those are suspensions and appoggiaturas if they
   * step to a resolution and mistakes if they leap away, which is the one thing
   * here worth asserting on.
   */
  const vertical = [];
  for (const mode of Object.keys(T.PROGRESSIONS)) {
    const prog = T.PROGRESSIONS[mode];
    const chordAt = (bar) => L.chordForBar(57, mode, prog, bar);
    let accented = 0;
    let chordTone = 0;
    let clash = 0;
    let resolved = 0;
    themes.forEach(({ theme }) => {
      const bars = [];
      for (let i = 0; i < BARS; i++) bars.push(L.cellForBar(theme, 0, i));
      bars.forEach((cell, bar) => {
        const chord = chordAt(bar);
        /*
         * The 7th and the 9th count as part of the chord here. They used to be
         * sounded by the chords lane's colour pair — `Chord.colour` was the
         * same two notes, faded rather than withheld — and a melody note on
         * the chord's own major 7th read as a semitone clash needing
         * resolution, so every "unresolved dissonance" in the two consonant
         * modes turned out to be a colour tone the harmony was already
         * sounding. The colour pair is deleted now; `Chord.colour` survives
         * for `voiceLead` and the arp's window placement, and the extensions
         * still count as chord tones here because they are members of the
         * seventh chord the stab and the bass spell.
         */
        const tones = [...chord.notes, ...chord.colour].map((n) => (((n - 57) % 12) + 12) % 12);
        // A clash is measured against the TRIAD only. The colour tones are a
        // fader — mostly down — so a semitone against one of them is not a
        // dissonance anybody reliably hears, and counting it means asserting on
        // a note that is usually silent.
        const core = chord.notes.map((n) => (((n - 57) % 12) + 12) % 12);
        cell.forEach((d, slot) => {
          if (d === null || slot % 2 !== 0) return;
          accented++;
          const pc = ((T.degreeToSemitone(mode, d) % 12) + 12) % 12;
          if (tones.includes(pc)) {
            chordTone++;
            return;
          }
          const ic = Math.min(...core.map((t) => {
            const x = Math.abs(pc - t) % 12;
            return Math.min(x, 12 - x);
          }));
          if (ic !== 1 && ic !== 6) return;
          clash++;
          // The next note anywhere in the phrase, including over the barline.
          let next = cell.slice(slot + 1).find((x) => x !== null);
          if (next === undefined) next = bars[(bar + 1) % BARS].find((x) => x !== null);
          if (next !== undefined && next !== null && Math.abs(next - d) <= 1) resolved++;
        });
      });
    });
    vertical.push({
      mode,
      accented,
      chordTonePct: Math.round((chordTone / accented) * 100),
      clash,
      resolved,
      resolvedPct: clash ? Math.round((resolved / clash) * 100) : 100,
    });
  }

  /*
   * The pad as parts rather than as a block.
   *
   * `voiceLead` matches the chord's tones to the previous chord's VOICES by
   * rank and searches the inversions, where it used to take the nearest pitch
   * to anything in the previous chord — which minimises total movement (what
   * `voicecheck` asks about) while letting the middle voice land where the top
   * voice was. Three properties say whether the result is three parts: nobody
   * crosses, nobody moves in parallel fifths or octaves with their neighbour,
   * and every voice actually moves sometimes.
   */
  const voicing = Object.keys(T.PROGRESSIONS).map((mode) => {
    const prog = T.PROGRESSIONS[mode];
    const bars = [];
    let prev = [];
    /*
     * Twelve phrases, and only the last one is read. Voice leading is relative,
     * so where the pad ends up is a settled cycle rather than a first move —
     * and an earlier version of this that read the second phrase missed a slow
     * upward walk that only showed itself by the eighth.
     */
    for (let i = 0; i < BARS * 12; i++) {
      const v = T.voiceLead(prev, L.chordForBar(57, mode, prog, i % BARS));
      prev = v.notes;
      if (i >= BARS * 11) bars.push(v.notes);
    }
    let parallels = 0;
    let crossings = 0;
    let moved = 0;
    let semitones = 0;
    // How the pad's top voice moves against the direction the tune is going in
    // that bar. Contrary is best, oblique (holding a common tone) is normal and
    // correct, and a LEAP in the same direction is the one that welds two parts
    // into one thickened line.
    let contrary = 0;
    let oblique = 0;
    let similarStep = 0;
    let similarLeap = 0;
    for (let i = 1; i < bars.length; i++) {
      const now = bars[i];
      const before = bars[i - 1];
      for (let v = 0; v < now.length; v++) {
        semitones += Math.abs(now[v] - before[v]);
        if (now[v] !== before[v]) moved++;
        if (v && now[v] <= now[v - 1]) crossings++;
      }
      for (let v = 1; v < now.length; v++) {
        const gap = (now[v] - now[v - 1]) % 12;
        const wasGap = (before[v] - before[v - 1]) % 12;
        const up = now[v] > before[v] && now[v - 1] > before[v - 1];
        const down = now[v] < before[v] && now[v - 1] < before[v - 1];
        if ((gap === 7 || gap === 0) && gap === wasGap && (up || down)) parallels++;
      }
      const move = now[now.length - 1] - before[before.length - 1];
      const tune = T.contourForBar(i);
      if (move === 0) oblique++;
      else if (Math.sign(move) !== Math.sign(tune)) contrary++;
      else if (Math.abs(move) >= 3) similarLeap++;
      else similarStep++;
    }
    const top = bars.map((b) => b[b.length - 1]);
    return {
      mode,
      parallels,
      crossings,
      voiceMoves: moved,
      semitones,
      register: `${Math.min(...bars.map((b) => b[0]))}-${Math.max(...top)}`,
      contrary,
      oblique,
      similarStep,
      similarLeap,
      topVoice: top.join(' '),
    };
  });

  /*
   * Cadential suspensions: the last note of bar 7 sounded again on the downbeat
   * of bar 8, where the tonic chord has arrived under it and it is a
   * dissonance, resolving down by step. Prepared, struck, resolved.
   */
  const suspensions = themes.map(({ theme }, index) => {
    const seven = L.cellForBar(theme, 0, 6);
    const eight = L.cellForBar(theme, 0, 7);
    const prepared = [...seven].reverse().find((x) => x !== null);
    const struck = eight.find((x) => x !== null);
    const strikeAt = eight.findIndex((x) => x !== null);
    const next = eight.slice(strikeAt + 1).find((x) => x !== null);
    const chord = L.chordForBar(57, 'aeolian', T.PROGRESSIONS.aeolian, 7);
    const tones = chord.notes.map((n) => (((n - 57) % 12) + 12) % 12);
    const pc = ((T.degreeToSemitone('aeolian', struck) % 12) + 12) % 12;
    return {
      theme: index,
      prepared: prepared === struck,
      onDownbeat: strikeAt === 0,
      dissonant: !tones.includes(pc),
      resolvesDown: next !== undefined && next !== null && struck - next === 1,
      suspension: prepared === struck && strikeAt === 0 && !tones.includes(pc) && next !== undefined && struck - next === 1,
    };
  });

  // What the development does to the phrase across a run  // What the development does to the phrase across a run: bars 1-4 and 7-8 are
  // meant to be identical every time, bars 5-6 different every time.
  const drift = [];
  for (const { theme } of themes.slice(0, 1)) {
    for (let phrase = 0; phrase < 10; phrase++) {
      const bars = phraseOf(theme, phrase);
      drift.push({
        phrase,
        fixed: JSON.stringify([bars[0], bars[1], bars[2], bars[3], bars[6], bars[7]]),
        varied: JSON.stringify([bars[4], bars[5]]),
      });
    }
  }

  /*
   * And the same questions asked of every phrase of a long run, not just the
   * first. Bars 5-6 are a transformation of the opening, so a development that
   * transposes upward can put a second note as high as the phrase's one high
   * point — or over it, which raises the ceiling of the whole melody in a
   * project whose standing complaint is that it sits too high.
   */
  let developed = 0;
  let apexKept = 0;
  let ceiling = -99;
  themes.forEach(({ theme }) => {
    for (let phrase = 0; phrase < 24; phrase++) {
      const notes = [];
      for (let i = 0; i < BARS; i++) L.cellForBar(theme, phrase, i).forEach((d) => d !== null && notes.push(d));
      const top = Math.max(...notes);
      ceiling = Math.max(ceiling, top);
      developed++;
      if (notes.filter((d) => d === top).length === 1) apexKept++;
    }
  });
  /*
   * The signature theme written out, so the numbers above can be read as music.
   * Note names rather than degrees, with the chord under each bar and the
   * on-beat notes in capitals — the capitals alone are the tune that survives a
   * quiet passage.
   */
  const score = [];
  {
    const mode = 'aeolian';
    const prog = T.PROGRESSIONS[mode];
    const theme = L.themeForWave(0, false);
    for (let bar = 0; bar < BARS; bar++) {
      const cell = L.cellForBar(theme, 0, bar);
      const chord = L.chordForBar(57, mode, prog, bar);
      const name = (n) => T.NOTE_NAMES[(((n % 12) + 12) % 12)] + (Math.floor(n / 12) - 1);
      score.push({
        bar: bar + 1,
        chord: name(chord.notes[0]).replace(/\d/, '') + ' ' + chord.notes.map(name).join(' '),
        tune: cell
          .map((d, i) => {
            if (d === null) return '  .  ';
            const n = name(69 + T.degreeToSemitone(mode, d));
            return (i % 2 === 0 ? n.toUpperCase() : n.toLowerCase()).padStart(4).padEnd(5);
          })
          .join(''),
      });
    }
  }

  return {
    rows,
    harmony,
    vertical,
    voicing,
    suspensions,
    score,
    developed,
    apexKept,
    ceiling,
    fixedStable: new Set(drift.map((d) => d.fixed)).size,
    variedShapes: new Set(drift.map((d) => d.varied)).size,
    phrases: drift.length,
  };
});

if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

console.log('\nTHE SIGNATURE THEME, IN A AEOLIAN  (capitals are on the beat; lower case fades out when the game is calm)');
console.table(r.score);
console.log('\nTHE TUNE  (one phrase of each theme, bars 1-8)');
console.table(r.rows);
console.log('\nHARMONIC RHYTHM');
console.table(r.harmony);
console.log('\nTHE TUNE AGAINST THE CHORD  (on-beat notes: how many are chord tones, and whether the harsh ones resolve)');
console.table(r.vertical);
// The voice-leading window (`LANE_RANGE.pad`, theory.ts) — no lane sustains it
// any more; `voiceLead` still leads through it and the stab and arp read the
// result, so the writing is still asserted.
console.log('\nTHE VOICE-LEADING WINDOW, AS PARTS  (one phrase, after the voicing has settled over twelve)');
console.table(r.voicing);
console.log('\nCADENTIAL SUSPENSIONS  (bar 7\'s last note struck again on bar 8\'s downbeat, and resolved)');
console.table(r.suspensions);
console.log(`\nacross ${r.developed} developed phrases: ${r.apexKept} keep a single high point, and none goes above degree ${r.ceiling}`);
console.log(`across ${r.phrases} phrases of the signature: ${r.fixedStable} shape(s) of the fixed bars, ${r.variedShapes} of the varied ones`);

const fails = [];
for (const t of r.rows) {
  const at = `theme ${t.theme}`;
  if (t.distinctBars < 6) fails.push(`${at}: ${t.distinctBars} distinct bars in the phrase, want 6+`);
  if (t.minSkeleton < 1) fails.push(`${at}: a bar with no on-beat note at all`);
  if (t.filigreeConnected < 90) fails.push(`${at}: only ${t.filigreeConnected}% of offbeat notes connect to the frame`);
  if (t.stepwisePct < 70) fails.push(`${at}: only ${t.stepwisePct}% of intervals are steps`);
  if (t.leaps !== t.leapsAnswered) fails.push(`${at}: ${t.leaps - t.leapsAnswered} leap(s) not answered by a step back`);
  if (t.apexCount !== 1) fails.push(`${at}: the phrase's highest note sounds ${t.apexCount} times, want exactly 1`);
  if (!t.anteEndsOpen) fails.push(`${at}: the antecedent does not end open with a rest`);
  if (!t.cadence) fails.push(`${at}: the last bar does not arrive on the tonic and stop`);
}
for (const h of r.harmony) {
  if (Number(h.barsPerChord) < 1.5) fails.push(`${h.mode}: ${h.barsPerChord} bars per chord — as fast as the tune`);
  if (!h.cadenceFaster) fails.push(`${h.mode}: harmonic rhythm ${h.rhythm} — the cadence does not change gear`);
  if (h.heldBars < 4) fails.push(`${h.mode}: only ${h.heldBars} of 8 bars sit under a chord held for two`);
  if (!h.endsOnTonic) fails.push(`${h.mode}: the phrase does not end on the tonic`);
}
/*
 * The dark half of the mode ladder is judged more leniently, on purpose.
 *
 * MODE_LADDER is ordered by how threatening a mode sounds and the director
 * climbs it as the screen fills up, so phrygian, locrian and octatonic are
 * *selected* for the fact that they grind — in phrygian the fifth degree of the
 * tune is a semitone from the third of the bII chord, and there is no way to
 * write a melody that avoids that in phrygian and still works in dorian. A gate
 * demanding they behave would be a gate against the mode ladder doing its job.
 * The two consonant modes are where an actual wrong note would show up.
 */
const CONSONANT = ['dorian', 'aeolian'];
for (const v of r.vertical) {
  const floor = CONSONANT.includes(v.mode) ? 90 : 60;
  if (v.resolvedPct < floor) fails.push(`${v.mode}: only ${v.resolvedPct}% of the harsh on-beat notes resolve by step (want ${floor})`);
  if (v.chordTonePct > 85) fails.push(`${v.mode}: ${v.chordTonePct}% of on-beat notes are chord tones — that is an arpeggio`);
}
for (const v of r.voicing) {
  if (v.parallels) fails.push(`${v.mode}: ${v.parallels} parallel fifth(s)/octave(s) in the voice-leading window`);
  if (v.crossings) fails.push(`${v.mode}: ${v.crossings} voice crossing(s) in the voice-leading window`);
  if (v.similarLeap) fails.push(`${v.mode}: the voice-leading window's top voice leaps ${v.similarLeap} time(s) in the same direction as the tune`);
  if (Number(v.register.split('-')[1]) > 74) fails.push(`${v.mode}: the voice-leading window has floated up to ${v.register} — it belongs under the tune`);
}
const withSuspension = r.suspensions.filter((x) => x.suspension).length;
if (withSuspension < 3) fails.push(`only ${withSuspension} theme(s) cadence with a prepared suspension`);
if (r.apexKept < r.developed * 0.8) fails.push(`only ${r.apexKept}/${r.developed} developed phrases keep a single high point`);
if (r.ceiling > 7) fails.push(`a development reaches degree ${r.ceiling} — above the written apex`);
if (r.fixedStable !== 1) fails.push(`the theme's fixed bars take ${r.fixedStable} shapes across a run — the hook is not stable`);
if (r.variedShapes < 6) fails.push(`only ${r.variedShapes} different developments across ${r.phrases} phrases`);

console.log('');
if (fails.length) {
  for (const f of fails) console.log('  FAIL ' + f);
  console.log('THE WRITING DOES NOT HOLD UP');
  process.exit(1);
}
console.log('EIGHT-BAR PERIODS, ONE HIGH POINT EACH, AND THEY CADENCE');
