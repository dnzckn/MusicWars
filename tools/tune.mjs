/*
 * tune — are the themes WRITTEN, or merely correct?
 *
 * Every existing music gate passes on the current tables and the score still
 * does not sound composed. That is not bad luck: `tools/themesearch.mjs`
 * generated seven of the nine themes under constraints shaped by `motif.mjs`
 * and `clash.mjs`, so the properties those tools measure are satisfied and the
 * ones nobody measured are not. Climax placement and cadence arrival — the two
 * things the old tools check — pass in 7 of 9 themes. Gap-fill sits at 29% and
 * 84% of the tune's events are plain eighths.
 *
 * A search optimises against the tools that exist. So these are the tools that
 * did not exist: thirteen rules taken from analysis of the reference canon
 * (Mitsuda, Uematsu, Kondo), each one a property of melodies people actually
 * hum. They are documented in `docs/redesign-plan.md` section A-4.
 *
 * THIS TOOL IS EXPECTED TO FAIL ON THE CURRENT THEMES. It is committed failing
 * on purpose — a gate nobody has watched fail is a gate nobody should trust,
 * and this one exists to be the target for a rewrite rather than a rubber stamp
 * for what is already there.
 *
 * SCOPE LIMIT, stated rather than hidden: a bar is 8 slots, so rules that need
 * sixteenth resolution (triplet groupings, sixteenth-level anacrusis and
 * anticipation) are measured at eighth resolution instead, and one rule — the
 * filigree carrying only passing tones and neighbours — is not mechanically
 * checkable and is reported, not gated.
 */
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { PROGRESSIONS, degreeToSemitone } = await import('../src/audio/theory.ts');

/* ---------------------------------------------------------------------------
 * RULE 15 — DOES IT FIT THE CHORDS?
 *
 * The first set composed against this brief satisfied every melodic rule and
 * quadrupled the score's dissonance: `npm run clash` went from 67 unresolved
 * on-beat clashes to 270. That was not the composers' failure, it was the
 * brief's — fourteen rules about melody and not one word about the harmony
 * underneath, so nine writers optimised exactly what they were given.
 *
 * This is `clash.mjs`'s scoring inlined, so a composer sees it while iterating
 * instead of discovering it after installation. Same definition: an on-beat
 * note that is not a chord tone is a CLASH, and one that then moves by a step
 * is RESOLVED. Unresolved clashes are the defect — a passing dissonance is
 * normal and wanted; a dissonance that just sits there is a wrong note.
 *
 * Scored across every mode, because a theme is played in all of them and the
 * progression differs per mode. That is what makes this hard, and it is why
 * the previous tables were SEARCHED rather than written.
 * ------------------------------------------------------------------------- */

const triadClasses = (mode, degree) =>
  [0, 2, 4].map((d) => ((degreeToSemitone(mode, degree + d) % 12) + 12) % 12);

function degreeForBar(progression, bar) {
  const bars = progression.reduce((n, span) => n + span[1], 0);
  let at = ((bar % bars) + bars) % bars;
  let degree = progression[progression.length - 1][0];
  for (const span of progression) {
    if (at < span[1]) { degree = span[0]; break; }
    at -= span[1];
  }
  return degree;
}

/** Unresolved on-beat clashes for one theme, summed over every mode. */
function clashScore(bars) {
  let unresolved = 0;
  for (const mode of Object.keys(PROGRESSIONS)) {
    const prog = PROGRESSIONS[mode];
    bars.forEach((cell, bar) => {
      const chord = triadClasses(mode, degreeForBar(prog, bar));
      // Four beats to a bar however finely the cell divides it.
      for (let slot = 0; slot < cell.length; slot += cell.length / 4) {
        const d = cell[slot];
        if (typeof d !== 'number') continue;
        const semis = degreeToSemitone(mode, d);
        if (chord.includes(((semis % 12) + 12) % 12)) continue;
        let nextD = null;
        for (let j = slot + 1; j < cell.length && nextD === null; j++) {
          if (typeof cell[j] === 'number') nextD = cell[j];
        }
        if (nextD === null && bar + 1 < bars.length) {
          for (const v of bars[bar + 1]) { if (typeof v === 'number') { nextD = v; break; } }
        }
        const step = nextD === null ? null : Math.abs(degreeToSemitone(mode, nextD) - semis);
        if (!(step !== null && step >= 1 && step <= 2)) unresolved++;
      }
    });
  }
  return unresolved;
}

const { THEMES, BOSS_THEME, HOLD, cellForBar } = L;

/*
 * `--theme <file.json>` validates ONE candidate instead of the shipped tables.
 *
 * Composing to a thirteen-rule brief without being able to check a draft is
 * writing blind. The file is `{ a, a2, b, b2, c, tag }`, each a 16-slot array of
 * scale degrees, `null` for a rest and the string `"_"` for a HOLD that extends
 * the previous note. Exit code is 0 only when every gate passes, so a composer
 * can iterate against it.
 */
const themeArg = process.argv.indexOf('--theme');
let ALL;
if (themeArg >= 0) {
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(process.argv[themeArg + 1], 'utf8'));
  const fix = (row) => row.map((v) => (v === '_' ? HOLD : v));
  ALL = [[process.argv[themeArg + 1].split('/').pop(), {
    a: fix(raw.a), a2: fix(raw.a2), b: fix(raw.b), b2: fix(raw.b2), c: fix(raw.c), tag: fix(raw.tag),
  }]];
} else {
  ALL = [...THEMES.map((t, i) => [`T${i}`, t]), ['BOSS', BOSS_THEME]];
}

/** The literal 8-bar period, undeveloped — the statement a listener meets first. */
function period(theme) {
  const bars = [];
  for (let b = 0; b < 8; b++) bars.push(cellForBar(theme, 0, b));
  return bars;
}

/**
 * Flatten a period into sounding notes with WRITTEN durations.
 *
 * Duration is `1 + trailing HOLDs`. That is the composer's decision, which is
 * what these rules are about — `renderSlots` separately ties a note through
 * runs of rests, but that is the engine filling a gap rather than the writer
 * choosing a length, and gating on it would let a theme pass rule 7 by
 * accident.
 */
function notes(bars) {
  const out = [];
  bars.forEach((cell, bar) => {
    cell.forEach((d, slot) => {
      if (typeof d !== 'number') return;
      let dur = 1;
      for (let j = slot + 1; j < cell.length && cell[j] === HOLD; j++) dur++;
      out.push({ bar, slot, deg: d, dur, abs: bar * cell.length + slot });
    });
  });
  return out.sort((a, b) => a.abs - b.abs);
}

/** Trailing rest of a bar, in slots — HOLD counts as sounding, not silence. */
function trailingRest(cell) {
  let n = 0;
  for (let i = cell.length - 1; i >= 0; i--) {
    if (cell[i] === null) n++;
    else break;
  }
  return n;
}

/*
 * The BREATH in a bar's second half: the longest unbroken run of rest slots.
 *
 * Rule 9 used `trailingRest`, which asks for silence running to the barline —
 * and that is what made rule 8 unsatisfiable, because a pickup is by
 * definition a note AT the barline. Both rules want the same thing, a phrase
 * that stops before the next one starts; only one of them insisted the silence
 * be last. A bar that rests through slots 8-11 and picks up on 12-15 breathes
 * exactly as well as one that rests through 12-15, so measure the rest itself
 * and let the pickup sit after it.
 */
function breathRest(cell) {
  let best = 0, run = 0;
  for (let i = cell.length / 2; i < cell.length; i++) {
    run = cell[i] === null ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/** The rhythm of one bar as a comparable string: onset slots and durations. */
function barRhythm(cell) {
  const parts = [];
  cell.forEach((d, slot) => {
    if (typeof d !== 'number') return;
    let dur = 1;
    for (let j = slot + 1; j < cell.length && cell[j] === HOLD; j++) dur++;
    parts.push(`${slot}:${dur}`);
  });
  return parts.join(',');
}

function analyse(name, theme) {
  const bars = period(theme);
  const ns = notes(bars);
  const fails = [];
  const warn = [];
  const iv = [];
  for (let i = 1; i < ns.length; i++) iv.push(ns[i].deg - ns[i - 1].deg);

  const SLOTS = bars[0].length;
  /*
   * Where the anacrusis lives: the last quarter of the tag.
   *
   * Rules 1 and 8 both concern the end of bar 8 and they mean different notes.
   * A pickup belongs to the phrase it leads INTO, not the one it trails, so
   * the note that answers the question is the last one BEFORE this window.
   * Without the distinction, gating rule 8 would make rule 1 unsatisfiable —
   * every theme would end on its own pickup and be told it missed the tonic.
   */
  const PICKUP_FROM = SLOTS - SLOTS / 4;
  const lastOf = (bar, before = SLOTS) => [...ns].reverse().find((n) => n.bar === bar && n.slot < before);

  // 1. Question and answer.
  const antEnd = lastOf(3), consEnd = lastOf(7, PICKUP_FROM);
  const UNSTABLE = [1, 3, 5, 6];
  const antOk = antEnd && UNSTABLE.includes(((antEnd.deg % 7) + 7) % 7);
  const consOk = consEnd && [0, 2].includes(((consEnd.deg % 7) + 7) % 7);
  if (!antOk) fails.push(`1 question/answer: bar 4 ends on degree ${antEnd ? antEnd.deg : '—'}, which is stable; the period asks nothing`);
  if (!consOk) fails.push(`1 question/answer: bar 8 ends on degree ${consEnd ? consEnd.deg : '—'}, not the tonic`);

  // 2. Gap fill.
  let leaps = 0, filled = 0;
  for (let i = 0; i < iv.length; i++) {
    if (Math.abs(iv[i]) < 3) continue;
    leaps++;
    const nxt = iv[i + 1];
    if (nxt !== undefined && Math.sign(nxt) === -Math.sign(iv[i]) && Math.abs(nxt) <= 2 && Math.abs(nxt) >= 1) filled++;
  }
  const gapFill = leaps ? filled / leaps : 1;
  if (gapFill < 0.7) fails.push(`2 gap-fill: ${filled}/${leaps} leaps answered by a step back (${(100 * gapFill).toFixed(0)}%, need >=70%)`);

  // 3. Stepwise ratio.
  const steps = iv.filter((x) => Math.abs(x) >= 1 && Math.abs(x) <= 2).length;
  const stepRatio = iv.length ? steps / iv.length : 0;
  if (stepRatio < 0.65) fails.push(`3 stepwise: ${(100 * stepRatio).toFixed(0)}% (need >=65%, canon ~75%)`);
  /*
   * ...AND AN UPPER BOUND, which the first version of this rule lacked.
   *
   * A melody of nothing but steps satisfies every other gate here and is dull —
   * a hand-written test candidate scored 90% and was obviously boring. That was
   * known when this brief was written and left ungated anyway, and the omission
   * bit twice: the searched tables were smooth because a search finds the safe
   * answer, and the hand-composed set became smooth again the moment rule 15
   * started pushing notes onto chord tones. Both times the same force, arriving
   * by different routes.
   *
   * 85% is above the canon's 70-80% band, so this is a tripwire against
   * blandness rather than a target. It is satisfiable alongside rule 15 — a
   * leap that LANDS ON A CHORD TONE costs nothing harmonically, which is the
   * whole trick, and T7 clears both at 78% stepwise and 8 clashes.
   */
  if (stepRatio > 0.85) {
    /*
     * A FAILURE now, and the history is the argument for gating it.
     *
     * It was a warning for as long as it was unsatisfiable. Rules 3-upper and
     * 15 genuinely pull against each other — a leap has to land somewhere, and
     * across nine modes the landing note is a chord tone in some and a clash in
     * others — so failing seven themes on a taste threshold that fights a
     * correctness one would have made the suite say "broken" about the best
     * score the game had yet had.
     *
     * What changed is that the work got done rather than the number moved.
     * `tools/leaps.mjs` writes leap-and-answer pairs into bars 1-7 by
     * hill-climbing single- and two-note substitutions, refusing any move that
     * regresses clash or gap-fill, and it brought all nine themes from 79-92%
     * to 77-83% while unresolved clashes FELL from 63 to 58. Only T4 paid
     * anything, and its two clashes are named in that tool's own report.
     *
     * So the bound is now enforced. A gate that cannot be met teaches nothing;
     * one that has been met, and is then left ungated, invites the next
     * composition pass to quietly undo it.
     */
    fails.push(`3 stepwise ${(100 * stepRatio).toFixed(0)}% is above the canon band (70-80%) — smooth and bland; ` +
      'add leap-and-answer pairs (see tools/leaps.mjs)');
  }

  // 4. One signature leap, in the consequent's first half, answered smaller.
  const big = iv.map((v, i) => ({ v, i })).filter((x) => Math.abs(x.v) > 4);
  if (big.length !== 1) fails.push(`4 signature leap: ${big.length} intervals >4 degrees, want exactly 1`);
  const antMax = Math.max(0, ...ns.filter((n) => n.bar < 4).map((n, i, a) => (i ? Math.abs(n.deg - a[i - 1].deg) : 0)));
  const consMax = Math.max(0, ...ns.filter((n) => n.bar >= 4).map((n, i, a) => (i ? Math.abs(n.deg - a[i - 1].deg) : 0)));
  if (!(consMax < antMax || big.length === 1)) warn.push(`4 consequent max leap ${consMax} is not smaller than antecedent ${antMax}`);

  // 5. One climax, in bar 7, on a beat, descending into bar 8.
  const top = Math.max(...ns.map((n) => n.deg));
  const tops = ns.filter((n) => n.deg === top);
  if (tops.length !== 1) fails.push(`5 climax: the highest note appears ${tops.length}x, want once`);
  else if (tops[0].bar !== 6) fails.push(`5 climax: highest note is in bar ${tops[0].bar + 1}, want bar 7`);
  else if (tops[0].slot % (bars[0].length / 2) !== 0) {
    warn.push(`5 climax lands off the beat (slot ${tops[0].slot} of ${bars[0].length})`);
  }

  // 6. A rhythmic cell repeated verbatim.
  const rhythms = bars.map(barRhythm).filter((r) => r);
  const counts = new Map();
  for (const r of rhythms) counts.set(r, (counts.get(r) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const cellDurs = new Set(best[0].split(',').filter(Boolean).map((p) => p.split(':')[1]));
  if (best[1] < 5) fails.push(`6 rhythmic cell: the most repeated bar rhythm appears ${best[1]}/8 times, want >=5`);
  else if (cellDurs.size < 2) fails.push(`6 rhythmic cell: the repeated rhythm "${best[0]}" uses one note length; a cell needs >=2`);

  // 7. Duration variety.
  const durCount = new Map();
  for (const n of ns) durCount.set(n.dur, (durCount.get(n.dur) ?? 0) + 1);
  const commonest = Math.max(...durCount.values());
  const share = commonest / ns.length;
  if (durCount.size < 3) fails.push(`7 durations: ${durCount.size} distinct note length(s), want >=3`);
  if (share > 0.65) fails.push(`7 durations: ${(100 * share).toFixed(0)}% of notes are the same length (max 65%)`);

  /*
   * 8. Anacrusis — GATED, once the grid was widened and rule 9 was reworded.
   *
   * It sat ungated for a long time behind a real conflict: a pickup wants the
   * tag's last sixteenths and rule 9 wanted trailing silence in the same bar,
   * so on an 8-slot grid the two competed for the same two slots and no theme
   * could satisfy both. Widening to 16 slots was the necessary half of the
   * fix. It was not the whole fix — rule 9 still asked for silence at the
   * BARLINE, which a pickup occupies by definition. Both rules were really
   * asking for one thing, that the phrase stop before the next begins, so rule
   * 9 now measures the breath wherever it falls (`breathRest`) and rule 1
   * reads the phrase's last note from before the pickup window. With that,
   * `tools/pickup.mjs` found an anacrusis for all nine themes that regresses
   * neither gap-fill nor clash.
   */
  const tag = bars[7];
  const tail = tag.slice(PICKUP_FROM).filter((d) => typeof d === 'number');
  const hasPickup = tail.length > 0;
  if (!hasPickup) {
    fails.push(`8 anacrusis: the tag's last ${SLOTS / 4} slots are silent, want a pickup into the repeat`);
  }

  // 9. Rests — the breath, wherever it falls, not silence at the barline.
  const r4 = breathRest(bars[3]), r8 = breathRest(bars[7]);
  const wantRest = SLOTS / 4;
  if (r4 < wantRest || r8 < wantRest) {
    fails.push(`9 rests: the breath is ${r4} slots at bar 4 and ${r8} at bar 8, want >=${wantRest} each`);
  }

  /*
   * 14. THE STRUCTURAL NOTES MUST BE IN THE TUNE, not the decoration.
   *
   * `renderSlots` splits a cell by slot parity: even slots are the SKELETON,
   * which is the melody, and odd slots are the FILIGREE, which fades to a fifth
   * of its level whenever the game is calm. A theme can therefore satisfy every
   * other rule here and still have its best moments vanish in a quiet passage.
   *
   * Found in review of the first composed set: one theme put 13 of its 29 notes
   * on odd slots, leaving a two-note skeleton per bar, with the target of its
   * one signature leap in the decoration. The leap was real, gated, and
   * inaudible half the time.
   *
   * Both ends of the signature leap, and at least half of all notes, belong on
   * skeleton slots.
   */
  // `renderSlots` keeps the first half of every group of four for the
  // skeleton; at 8 slots that reduced to "even slots". Derive it, don't restate it.
  const grp = bars[0].length / 4;
  const onBeat = ns.filter((n) => n.slot % grp < grp / 2).length;
  if (onBeat / ns.length < 0.5) {
    fails.push(`14 skeleton: only ${Math.round((100 * onBeat) / ns.length)}% of notes are on skeleton slots — ` +
      'the rest are filigree, which fades out when the game is calm');
  }
  if (big.length === 1) {
    const bi = big[0].i;
    const from = ns[bi], to = ns[bi + 1];
    if (to && to.slot % 2 !== 0) {
      fails.push(`14 skeleton: the signature leap lands on slot ${to.slot} (filigree) — ` +
        'the one gesture the theme is built around is in the decoration layer');
    }
    /*
     * Only the LANDING is gated, not the departure — and softening that was a
     * correction, not a convenience.
     *
     * A theme whose rhythmic cell puts a note on slot 3 cannot place a leap
     * between two even slots at all: something is always in between. Gating
     * both ends made a legal cell illegal. And the arrival is the half that
     * matters: with the departure faded, a calm listener hears the previous
     * SKELETON note leap to the target instead — a different interval, but
     * still a leap, still landing where the theme wants it. With the target
     * faded there is no gesture at all.
     */
  }

  /*
   * 15. Harmonic fit. The shipped tables averaged about 7 unresolved clashes
   * per theme across the nine modes before this brief existed; the first
   * composed set averaged 30. 12 is a deliberate middle — tight enough that a
   * theme cannot wander outside the harmony, loose enough not to force the
   * search-derived blandness the hand-composition was meant to escape.
   */
  const clashes = clashScore(bars);
  if (clashes > 12) {
    fails.push(`15 harmony: ${clashes} unresolved on-beat clashes across the nine modes (max 12) — ` +
      'on-beat notes that are neither chord tones nor resolved by step');
  }

  // 10. Ambitus and hook singability.
  const ambitus = top - Math.min(...ns.map((n) => n.deg));
  if (ambitus > 8) fails.push(`10 ambitus: spans ${ambitus} degrees, want <=8`);
  const hookPcs = new Set(ns.filter((n) => n.bar < 2).map((n) => ((n.deg % 7) + 7) % 7));
  if (hookPcs.size > 6) fails.push(`10 hook: bars 1-2 use ${hookPcs.size} pitch classes, want <=6`);

  // 11. Density, and that it varies.
  const perBar = bars.map((c) => c.filter((d) => typeof d === 'number').length);
  const varied = new Set(perBar).size >= 3;
  if (ns.length > 34) fails.push(`11 density: ${ns.length} notes in the period, want <=34`);
  if (!varied) fails.push(`11 density: only ${new Set(perBar).size} distinct bar densities (${perBar.join('/')}) — a flat tune`);

  /*
   * 12. Syncopation — REMOVED, because it scored a construct that renders as
   * SILENCE.
   *
   * This counted bars whose first slot is a HOLD, calling that an anticipated
   * downbeat. `renderSlots` cannot produce one: it initialises `sounded = false`
   * per bar (`mine`) and a slot-0 HOLD has nothing before it to extend, so it emits
   * `'~'` — a rest. Its own source says as much: "It never leads a line".
   *
   * So a theme could satisfy rule 12 by opening bars with silence, and two of
   * the nine composed against this brief did exactly that — they were the only
   * two without the warning, and the reason was that their downbeats were gone.
   * A gate that rewards an intent the renderer discards is worse than no gate:
   * it actively steers composition toward a hole in the engine.
   *
   * Real syncopation needs the 16-slot grid, which is the third rule now
   * waiting on it alongside 8 and the triplet characters.
   */
  const leadingHolds = bars.filter((c) => c[0] === HOLD).length;
  if (leadingHolds) {
    fails.push(`12 leading HOLD in ${leadingHolds} bar(s) — a HOLD in slot 0 has nothing to extend and renders as a REST, ` +
      'so those downbeats are silent');
  }

  return { name, fails, warn, gapFill, stepRatio, durs: durCount.size, share, cell: best, notes: ns.length, perBar, ambitus, hasPickup, clashes };
}

export { analyse, period };

/*
 * Imported by `tools/pickup.mjs`, which scores candidate tags against these
 * same gates. Only print the report when run directly — a library that writes
 * to stdout on import makes the importing tool's output unreadable.
 */
if (!process.argv[1]?.endsWith('tune.mjs')) {
  // eslint-disable-next-line no-empty
} else {

const rows = ALL.map(([n, t]) => analyse(n, t));

console.log('\ntune — are the themes written, or merely correct?\n');
console.log(`  ${'theme'.padEnd(6)} ${'gapfill'.padStart(8)} ${'step'.padStart(6)} ${'durs'.padStart(5)} ${'top dur'.padStart(8)} ${'cell'.padStart(6)} ${'notes'.padStart(6)} ${'clash'.padStart(6)}  fails`);
console.log(`  ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(8)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(6)}  -----`);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(6)} ${((100 * r.gapFill).toFixed(0) + '%').padStart(8)} ${((100 * r.stepRatio).toFixed(0) + '%').padStart(6)} ` +
    `${String(r.durs).padStart(5)} ${((100 * r.share).toFixed(0) + '%').padStart(8)} ${(r.cell[1] + '/8').padStart(6)} ${String(r.notes).padStart(6)} ${String(r.clashes).padStart(6)}  ${r.fails.length}`);
}

const total = rows.reduce((a, r) => a + r.fails.length, 0);
console.log(`\n  ${rows.filter((r) => !r.fails.length).length}/${rows.length} themes pass all gates; ${total} failures total\n`);
for (const r of rows) {
  if (!r.fails.length && !r.warn.length) continue;
  console.log(`  ${r.name}`);
  for (const f of r.fails) console.log(`    FAIL  ${f}`);
  for (const w of r.warn) console.log(`    warn  ${w}`);
}

console.log('\n  NOT GATED, and why:');
console.log('    13  the filigree carrying only passing tones and neighbours — not');
console.log('        mechanically checkable, so it is a review item rather than a gate.');
console.log('    12  syncopation is GONE, not relaxed: it counted a leading HOLD as an');
console.log('        anticipated downbeat, and renderSlots emits a REST for one. The');
console.log('        gate was steering composition into a hole in the engine. A leading');
console.log('        HOLD is now a hard failure instead.');
console.log('     15  the filigree carrying only passing tones is still a review item,');
console.log('        and rule 3-upper is no longer here: it became a hard failure once');
console.log('        tools/leaps.mjs got every theme under 85% without spending');
console.log('        gap-fill and while LOWERING total clash 63 -> 58.');

if (total) {
  console.log(`\n  FAIL  ${total} composition failures across ${rows.length} themes.`);
  process.exit(1);
}
console.log('\n  ok  every theme is written to the brief');

}
