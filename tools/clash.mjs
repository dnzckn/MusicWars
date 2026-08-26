/**
 * Harmonic clash meter — and the point is that it needs no browser.
 *
 * `theory.ts` is full of comments like "measured over all six themes, the other
 * order left seventeen on-beat notes clashing with the chord and only nine of
 * them resolving. This way there are eight and all eight resolve." Those numbers
 * decided the ordering of every progression in the file, and nothing in the repo
 * could reproduce them — they were measured once, by hand, and then trusted.
 *
 * That mattered the moment the score refactor reached item 11 of its work order:
 * halve the harmonic rhythm so chords change every bar instead of every two.
 * The spec's own warning was "re-measure — do not just paste new arrays", and
 * without this tool there was no way to obey it.
 *
 * It reads the SOURCE as text and evaluates the table literals, rather than
 * importing the modules. `layers.ts` pulls in Strudel and superdough, which
 * need a DOM and an AudioContext; the melodic data inside it does not. Reading
 * the literals directly means the tool cannot drift from the source the way a
 * hand-copied table would, and it runs in Node in about a second on a machine
 * that currently cannot launch Chromium at all.
 *
 * WHAT IT MEASURES
 *
 * For each mode, for each theme, for each bar of the eight-bar phrase: take the
 * melody's ON-BEAT notes (every `length / 4`th slot — `melodyForBar` calls these the
 * skeleton, and they are what the tune is *about*; the slots between are filigree
 * written as passing tones and are supposed to be dissonant), find the chord
 * sounding under that bar, and ask whether each on-beat pitch class is a chord
 * tone.
 *
 * A non-chord tone on a beat is not automatically wrong — that is most of what
 * makes music move. What makes it wrong is not going anywhere. So every clash
 * is followed to the next sounding note and counted as RESOLVED if it moves by
 * a step (one or two semitones) in either direction, and UNRESOLVED otherwise.
 *
 * The headline number is the unresolved count. Resolved clashes are a feature.
 *
 * Usage:  node tools/clash.mjs            compare current progressions
 *         node tools/clash.mjs --verbose  list every clash
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/**
 * Pull a top-level `export const NAME ... = <literal>;` out of a TypeScript
 * source file and evaluate it.
 *
 * Brace-matching rather than a regex for the closing delimiter: these tables
 * contain nested arrays and objects, and every regex that "works" on them is
 * one added chord away from silently truncating the data. A tool that measures
 * half a table and reports a clean result is worse than no tool.
 */
// `export` is optional: `BOSS_THEME` is deliberately module-private so nothing
// can put the leitmotif into the ordinary rotation, and widening its visibility
// to satisfy a measurement tool would be the tool dictating the design.
function extractLiteral(source, name) {
  const decl = new RegExp(`^(?:export )?const ${name}\\b[^=]*=\\s*`, 'm');
  const m = decl.exec(source);
  if (!m) throw new Error(`could not find "const ${name}" — has it been renamed?`);
  const start = m.index + m[0].length;

  const open = source[start];
  const close = open === '[' ? ']' : '}';
  if (open !== '[' && open !== '{') {
    throw new Error(`${name} does not start with an array or object literal (found "${open}")`);
  }

  let depth = 0;
  let inLine = false;
  let inBlock = false;
  let end = -1;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (c === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error(`unbalanced literal for ${name}`);

  const text = source
    .slice(start, end)
    // Strip TypeScript-only syntax the evaluator will not accept. The tables
    // use `as const` and typed tuple annotations in places.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\bas const\b/g, '')
    /*
     * `HOLD` is an identifier in the source, not a literal, and this evaluator
     * has no bindings — so a table containing one threw `HOLD is not defined`
     * the moment the melody grammar gained written durations. It is the string
     * '_' in the source, and it is substituted as `null` rather than as that
     * string — BOTH TOOLS TEST `d === null` TO MEAN "no note here". Passing the
     * literal '_' through made it read as a PITCH: it reached
     * `degreeToSemitone` as a string and the unresolved-clash count went from
     * 67 to 787 on tables that had barely changed harmonically. A HOLD is a
     * continuation, not an attack, and neither tool is measuring sustain.
     */
    .replace(/\bHOLD\b/g, 'null');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text});`)();
}

const theorySrc = readFileSync(join(ROOT, 'src/audio/theory.ts'), 'utf8');
const layersSrc = readFileSync(join(ROOT, 'src/audio/layers.ts'), 'utf8');

const MODES = extractLiteral(theorySrc, 'MODES');
const PROGRESSIONS = extractLiteral(theorySrc, 'PROGRESSIONS');
const THEMES = extractLiteral(layersSrc, 'THEMES');

/*
 * THE OTHER SHAPES, and why they are scored here rather than trusted.
 *
 * `theory.ts` used to hold ONE harmonic sentence and nine colours of it. It now
 * holds three, chosen by where in the RUN a phrase falls: `period` (states,
 * asks, restates, closes), `turn` (the same chords entered from elsewhere) and
 * `climb` (a deceptive cadence that refuses to land). Two thirds of the harmony
 * a player meets over a long run is therefore material this tool could not see,
 * which is exactly the "unmeasured properties rot" failure AGENTS.md §3 names.
 *
 * The tables are optional so this file still runs against a checkout that has
 * only `PROGRESSIONS` — the same reason `arc.mjs` degrades on a build with no
 * act table. A missing table is reported, not assumed away.
 */
const SHAPE_TABLES = [['period', PROGRESSIONS]];
for (const [name, ident] of [['turn', 'PROGRESSIONS_TURN'], ['climb', 'PROGRESSIONS_CLIMB']]) {
  try {
    SHAPE_TABLES.push([name, extractLiteral(theorySrc, ident)]);
  } catch {
    console.log(`  (no ${ident} in theory.ts — this build has one harmonic shape)`);
  }
}

/*
 * The boss leitmotif, and why it needs its own row.
 *
 * `BOSS_THEME` is declared outside `THEMES` on purpose — `themeForWave` returns
 * it for `boss` and never puts it in the rotation. The director pairs it with a
 * mode kept out of `MODE_LADDER` for the same reason (`harmonicMinor`), so the
 * raised seventh announces the fight.
 *
 * Those two exclusions together mean the naive cross-product lies in BOTH
 * directions. Scoring every theme against every mode measured `harmonicMinor`
 * against six themes that can never sound in it — 32 unresolved clashes
 * describing pairings the game cannot produce — while the leitmotif itself,
 * the newest melodic material in the score, was never measured at all.
 *
 * So: regular themes are scored against the ladder modes, and the boss theme is
 * scored against the boss modes, and the two are reported separately.
 */
const BOSS_THEME = extractLiteral(layersSrc, 'BOSS_THEME');
const ladderMatch = theorySrc.match(/MODE_LADDER[^=]*=\s*\[([^\]]*)\]/);
const MODE_LADDER = ladderMatch
  ? [...ladderMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
  : [];
if (!MODE_LADDER.length) {
  console.error('clash: could not read MODE_LADDER from theory.ts — boss/ladder split disabled');
}

/** Mirrors `theory.degreeToSemitone`, including its negative-octave handling. */
function degreeToSemitone(mode, degree) {
  const steps = MODES[mode];
  const len = steps.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return steps[idx] + octave * 12;
}

/** The triad on a scale degree, as pitch classes. Mirrors `theory.buildChord`. */
function triadClasses(mode, degree) {
  return [0, 2, 4].map((d) => ((degreeToSemitone(mode, degree + d) % 12) + 12) % 12);
}

/** Which chord degree sounds in a given bar. Mirrors `layers.chordForBar`. */
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

/**
 * The eight bars of a phrase, undeveloped.
 *
 * Mirrors `cellForBar` for `phrase < 2`, which is the case the source calls
 * "the statement is left alone so the listener learns it before it starts
 * changing". Measuring the developed forms would measure the transforms rather
 * than the themes, and the transforms are chosen for melodic reasons that this
 * tool has no opinion about.
 */
function phraseCells(theme) {
  return [theme.a, theme.a2, theme.b, theme.b2, theme.a, theme.a2, theme.c, theme.tag];
}

function analyseMode(mode, themes = THEMES, table = PROGRESSIONS) {
  const progression = table[mode];
  if (!progression) throw new Error(`no progression for mode ${mode}`);
  let onBeat = 0;
  let clashes = 0;
  let resolved = 0;
  const detail = [];

  themes.forEach((theme, ti) => {
    const cells = phraseCells(theme);
    cells.forEach((cell, bar) => {
      const chord = triadClasses(mode, degreeForBar(progression, bar));
      /*
       * DERIVED, never hardcoded. A bar is four beats however finely the cell
       * divides it, so the on-beat slots are every `length / 4`. This read
       * `slot += 2`, correct only while a cell was 8 slots long; at 16 it
       * sampled the off-16ths as downbeats and reported 161 unresolved
       * clashes where the music had not changed at all.
       */
      const stride = cell.length / 4;
      for (let slot = 0; slot < cell.length; slot += stride) {
        const d = cell[slot];
        if (d === null || d === undefined) continue;
        onBeat++;
        const semis = degreeToSemitone(mode, d);
        const pc = ((semis % 12) + 12) % 12;
        if (chord.includes(pc)) continue;
        clashes++;

        // Follow it to the next sounding note, anywhere in the cell.
        let nextD = null;
        for (let j = slot + 1; j < cell.length; j++) {
          if (cell[j] !== null && cell[j] !== undefined) { nextD = cell[j]; break; }
        }
        // A clash on the last note of a bar resolves into the next bar.
        if (nextD === null && bar + 1 < cells.length) {
          const nxt = cells[bar + 1];
          for (let j = 0; j < nxt.length; j++) {
            if (nxt[j] !== null && nxt[j] !== undefined) { nextD = nxt[j]; break; }
          }
        }
        const step = nextD === null ? null : Math.abs(degreeToSemitone(mode, nextD) - semis);
        const ok = step !== null && step >= 1 && step <= 2;
        if (ok) resolved++;
        if (VERBOSE) {
          detail.push(
            `      theme ${ti} bar ${bar + 1} slot ${slot}: degree ${d} vs chord ` +
              `[${chord.join(',')}] -> ${ok ? `resolves by ${step}` : 'UNRESOLVED'}`,
          );
        }
      }
    });
  });

  const bars = progression.reduce((n, s) => n + s[1], 0);
  return { mode, onBeat, clashes, resolved, unresolved: clashes - resolved, chords: progression.length, bars, detail };
}

const allModes = Object.keys(PROGRESSIONS);
// A mode the ladder never selects is reachable only via the boss branch in the
// director, and the boss branch always pairs it with the leitmotif.
const ladderModes = MODE_LADDER.length ? allModes.filter((m) => MODE_LADDER.includes(m)) : allModes;
const bossModes = MODE_LADDER.length ? allModes.filter((m) => !MODE_LADDER.includes(m)) : [];

const row = (label, r) => {
  const rate = r.clashes ? Math.round((r.resolved / r.clashes) * 100) : 100;
  console.log(
    `  ${label.padEnd(20)}${String(`${r.chords}/${r.bars}`).padEnd(16)}` +
      `${String(r.onBeat).padEnd(10)}${String(r.clashes).padEnd(10)}` +
      `${String(`${r.resolved} (${rate}%)`).padEnd(11)}${r.unresolved}`,
  );
  if (VERBOSE && r.detail.length) console.log(r.detail.join('\n'));
};

console.log(
  `clash — ${THEMES.length} themes x ${ladderModes.length} ladder modes` +
    (bossModes.length ? `, plus the leitmotif x ${bossModes.length} boss mode(s)` : '') +
    ', on-beat notes only\n',
);
console.log('  mode                chords/phrase   on-beat   clashes   resolved   UNRESOLVED');
console.log('  ' + '-'.repeat(78));

let worst = 0;
let totalUnresolved = 0;
for (const mode of ladderModes) {
  const r = analyseMode(mode);
  totalUnresolved += r.unresolved;
  worst = Math.max(worst, r.unresolved);
  row(mode, r);
}

// The boss pairing, scored on its own terms. Held to the same standard: a
// leitmotif is allowed to be dark, but an on-beat non-chord-tone that never
// moves is a wrong note in any mode.
let bossWorst = 0;
let bossUnresolved = 0;
if (bossModes.length && BOSS_THEME) {
  console.log('  ' + '-'.repeat(78));
  for (const mode of bossModes) {
    const r = analyseMode(mode, [BOSS_THEME]);
    bossUnresolved += r.unresolved;
    bossWorst = Math.max(bossWorst, r.unresolved);
    row(`${mode} *`, r);
  }
}

/*
 * --shapesearch — score every candidate SHAPE before adopting one.
 *
 * The same discipline `--candidates` exists for, applied to the other axis. The
 * first `climb` shape written for the run form put a DECEPTIVE cadence under
 * the `tag` cell — musically the right idea, and it scored worse in all nine
 * modes (dorian 3 -> 18) for a reason the tool made obvious the moment it was
 * asked: the tag is the cadence figure and it is written to land on the tonic,
 * so a chord that is not the tonic under it leaves the phrase's final note
 * hanging. Guessing would have shipped that.
 *
 * The space searched is deliberately small and structural rather than creative:
 *
 *   - every permutation of the phrase's BODY spans (everything before the
 *     two-bar cadence), which reorders which chord each melodic cell meets
 *     without inventing a chord;
 *   - each of those with the CADENCE TARGET (the final one-bar span) replaced
 *     by a degree the shape already uses.
 *
 * Both stay inside the degree set the period shape uses, which is the invariant
 * ten other tools depend on — see the SHAPES section below.
 */
if (process.argv.includes('--shapesearch')) {
  const permute = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => permute([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));
  console.log('');
  console.log('  SHAPE SEARCH — body permutations and cadence targets, scored against the live themes');
  console.log('  (baseline is the period shape; only candidates at or under it are listed)');
  for (const mode of [...ladderModes, ...bossModes]) {
    const themes = bossModes.includes(mode) && BOSS_THEME ? [BOSS_THEME] : THEMES;
    const period = PROGRESSIONS[mode];
    const base = analyseMode(mode, themes, PROGRESSIONS).unresolved;
    const body = period.slice(0, period.length - 2);
    const cadence = period.slice(period.length - 2);
    const degrees = [...new Set(period.map(([d]) => d))];
    const seen = new Map();
    for (const perm of permute(body)) {
      for (const target of degrees) {
        const cand = [...perm, cadence[0], [target, cadence[1][1]]];
        const key = JSON.stringify(cand);
        if (seen.has(key)) continue;
        const r = analyseMode(mode, themes, { [mode]: cand }).unresolved;
        seen.set(key, r);
      }
    }
    const ok = [...seen.entries()].filter(([k, v]) => v <= base && k !== JSON.stringify(period));
    ok.sort((a, b) => a[1] - b[1]);
    console.log(`
  ${mode}  period ${base} unresolved, ${seen.size} candidates, ${ok.length} at or under it`);
    for (const [k, v] of ok.slice(0, 12)) console.log(`    ${String(v).padStart(3)}  ${k}`);
  }
  console.log('');
  process.exit(0);
}

/* ==========================================================================
 * THE SHAPES — every harmonic sentence the run can produce, scored.
 * ==========================================================================
 *
 * TWO ASSERTIONS, and both are exit-code failures. This file used to print and
 * never fail, which made "do not accept a rise in the last column" a request
 * rather than a gate; adding harmony without a gate on it would have been
 * adding unmeasured material to a file whose whole premise is that the orderings
 * were chosen by counting.
 *
 * 1. NO ALTERNATIVE SHAPE MAY SCORE WORSE THAN THAT MODE'S `period` SHAPE.
 *    The period shape is what shipped and what the themes were written against,
 *    so it is the standard the new material has to meet. It is a strict
 *    inequality with no margin, because `turn` is a permutation of `period`'s
 *    spans and therefore scores IDENTICALLY by construction in every mode whose
 *    exchanged spans are the same length — a margin would only hide a mistake
 *    in the two that are authored rather than permuted.
 *
 * 2. NO ALTERNATIVE SHAPE MAY INTRODUCE A DEGREE THE `period` SHAPE DOES NOT
 *    USE. Ten tools in this directory enumerate a mode's chords by sweeping
 *    `for (const [degree] of PROGRESSIONS[mode])` — `masking`, `motorcheck`,
 *    `leadcheck`, `basscheck`, `registermap`, `tune`, `contour`, `rhythm`,
 *    `motion`, `instruments`. A new degree would silently make every one of
 *    them incomplete, and none of them would go red saying so. Holding the
 *    degree SET fixed while varying the ORDER and the CADENCE keeps all ten
 *    total without editing any of them, and this is the check that keeps that
 *    promise honest.
 *
 * BOTH SEEN RED, SEPARATELY, before either was trusted — per AGENTS.md §3,
 * which warns that a multi-assertion check can pass its own fail-test on the
 * strength of one while the rest are dead. That nearly happened here: the first
 * attempt at breaking assertion 1 (`PROGRESSIONS_TURN.aeolian` opened on the
 * dominant) scored 6 against the period's 7 and stayed GREEN, which is the tool
 * being right rather than the tool being broken, and the second attempt tripped
 * both assertions at once and would have proved nothing about either.
 *
 *   assertion 1, alone: `PROGRESSIONS_CLIMB.aeolian` set to the deceptive
 *     cadence `[[0,2],[5,2],[2,2],[4,1],[5,1]]` — every degree already in the
 *     period shape, so only the consonance check can fire. RED: "aeolian climb
 *     scores 12 unresolved against period's 7", exit 1.
 *   assertion 2 (with 1): the same table's last span set to degree 6, which
 *     aeolian's period shape does not use. RED on both lines, exit 1.
 *
 * Restored after each, and the file exits 0 again.
 */
let shapeFails = 0;
if (SHAPE_TABLES.length > 1) {
  console.log('');
  console.log(`  SHAPES — ${SHAPE_TABLES.map(([n]) => n).join(' / ')}, scored against the same themes`);
  console.log('  ' + '-'.repeat(78));
  console.log('  mode                 ' + SHAPE_TABLES.map(([n]) => `${n} unresolved`.padEnd(20)).join(''));
  let compared = 0;
  for (const mode of [...ladderModes, ...bossModes]) {
    const themes = bossModes.includes(mode) && BOSS_THEME ? [BOSS_THEME] : THEMES;
    const scores = SHAPE_TABLES.map(([, table]) => analyseMode(mode, themes, table).unresolved);
    const degreesOf = (table) => new Set(table[mode].map(([d]) => d));
    const periodDegrees = degreesOf(SHAPE_TABLES[0][1]);
    console.log(
      `  ${mode.padEnd(20)}` +
        scores.map((v, i) => `${v}${i === 0 ? '' : v > scores[0] ? ' WORSE' : v < scores[0] ? ' better' : ' same'}`.padEnd(20)).join(''),
    );
    for (let i = 1; i < SHAPE_TABLES.length; i++) {
      compared++;
      const [name, table] = SHAPE_TABLES[i];
      if (scores[i] > scores[0]) {
        shapeFails++;
        console.log(
          `    FAIL  ${mode} ${name} scores ${scores[i]} unresolved against period's ${scores[0]}. ` +
            'A shape that fits the themes worse than the one they were written against is not free.',
        );
      }
      const extra = [...degreesOf(table)].filter((d) => !periodDegrees.has(d));
      if (extra.length) {
        shapeFails++;
        console.log(
          `    FAIL  ${mode} ${name} uses degree(s) ${extra.join(',')} that the period shape does not. ` +
            'Ten tools enumerate the chords of a mode from PROGRESSIONS and would silently stop being complete.',
        );
      }
    }
  }
  // AGENTS.md §3: print the denominator; `checked === 0` is a failure.
  console.log(`  ${compared} shape/mode pairs compared against the period shape`);
  if (compared === 0) {
    shapeFails++;
    console.log('    FAIL  zero pairs compared — the shape tables were not read');
  }
  if (!shapeFails) {
    console.log('    ok  every alternative shape is at least as consonant as the period shape,');
    console.log('        and none of them introduces a chord degree the period shape does not use');
  }
}

/*
 * Candidate progressions, for the harmonic-rhythm question.
 *
 * The work order's item 11 wants chords changing every bar rather than every
 * two — "the cheapest single lever you have on 'this sounds like a loop, not a
 * piece'" — and every score in the reference canon does exactly that. But the
 * comments in `theory.ts` record that the CURRENT orderings were chosen by
 * counting clashes, so a faster harmonic rhythm has to be shown not to undo
 * that work rather than assumed not to.
 *
 * Each candidate is one chord per bar across the eight-bar phrase, drawn from
 * the progressions the canon actually uses:
 *
 *   frog   i - VII - VI - VII, from Frog's Theme, cycled and then cadenced
 *   wily   i - VI - VII, from Mega Man 2's Wily Stage 1, three-bar cycle
 *   walk   the descending tetrachord, i - VII - VI - v, the lament shape
 *
 * Run with --candidates to score them against the live tables.
 */
const CANDIDATES = {
  aeolian: {
    frog: [[0, 1], [6, 1], [5, 1], [6, 1], [0, 1], [6, 1], [5, 1], [4, 1]],
    wily: [[0, 1], [5, 1], [6, 1], [0, 1], [5, 1], [6, 1], [4, 1], [0, 1]],
    walk: [[0, 1], [6, 1], [5, 1], [4, 1], [0, 1], [6, 1], [5, 1], [4, 1]],
  },
  dorian: {
    frog: [[0, 1], [6, 1], [3, 1], [6, 1], [0, 1], [6, 1], [3, 1], [4, 1]],
    wily: [[0, 1], [3, 1], [6, 1], [0, 1], [3, 1], [6, 1], [4, 1], [0, 1]],
    walk: [[0, 1], [6, 1], [5, 1], [4, 1], [0, 1], [6, 1], [3, 1], [4, 1]],
  },
  harmonicMinor: {
    frog: [[0, 1], [5, 1], [3, 1], [4, 1], [0, 1], [5, 1], [3, 1], [4, 1]],
    wily: [[0, 1], [3, 1], [5, 1], [4, 1], [0, 1], [3, 1], [4, 1], [0, 1]],
    walk: [[0, 1], [6, 1], [5, 1], [4, 1], [0, 1], [5, 1], [3, 1], [4, 1]],
  },
  phrygian: {
    frog: [[0, 1], [6, 1], [3, 1], [1, 1], [0, 1], [6, 1], [3, 1], [1, 1]],
    wily: [[0, 1], [3, 1], [6, 1], [1, 1], [0, 1], [3, 1], [6, 1], [1, 1]],
    walk: [[0, 1], [6, 1], [5, 1], [1, 1], [0, 1], [3, 1], [6, 1], [1, 1]],
  },
};

if (process.argv.includes('--candidates')) {
  console.log('');
  console.log('  CANDIDATES — one chord per bar. Lower unresolved is better.');
  console.log('  ' + '-'.repeat(78));
  for (const [mode, set] of Object.entries(CANDIDATES)) {
    // Score each candidate against the themes that mode can actually be heard
    // with. Getting this wrong is what made the first pass reject a faster
    // harmonic rhythm for harmonicMinor on a number that described nothing.
    const themes = bossModes.includes(mode) && BOSS_THEME ? [BOSS_THEME] : THEMES;
    const scope = themes === THEMES ? 'rotation themes' : 'leitmotif only';
    const before = analyseMode(mode, themes);
    console.log(
      `\n  ${mode} (${scope})   current ${before.chords} chords/${before.bars} bars ` +
        `-> ${before.unresolved} unresolved`,
    );
    for (const [name, prog] of Object.entries(set)) {
      const saved = PROGRESSIONS[mode];
      PROGRESSIONS[mode] = prog;
      const r = analyseMode(mode, themes);
      PROGRESSIONS[mode] = saved;
      const delta = r.unresolved - before.unresolved;
      const mark = delta < 0 ? 'BETTER' : delta === 0 ? 'same  ' : 'worse ';
      console.log(
        `    ${name.padEnd(6)} ${String(`${r.chords}/${r.bars}`).padEnd(6)}` +
          `clashes ${String(r.clashes).padEnd(5)}resolved ${String(r.resolved).padEnd(5)}` +
          `unresolved ${String(r.unresolved).padEnd(5)}${mark} (${delta >= 0 ? '+' : ''}${delta})`,
      );
    }
  }
}

console.log('');
console.log(`  total unresolved on-beat clashes: ${totalUnresolved}`);
console.log(`  worst single mode:                ${worst}`);
if (bossModes.length && BOSS_THEME) {
  console.log(`  boss leitmotif unresolved:        ${bossUnresolved} (worst ${bossWorst})`);
  console.log(
    '\n  * The boss row scores BOSS_THEME alone against the mode the director\n' +
      '    forces for it. Both are excluded from the ordinary rotation, so the\n' +
      '    two are only ever heard together and no other pairing is measurable.',
  );
}
console.log('');
console.log('  A clash is an on-beat melody note that is not a chord tone. Those are');
console.log('  normal and desirable; an UNRESOLVED one — that does not then move by a');
console.log('  step — is the defect. Compare this table before and after any change to');
console.log('  PROGRESSIONS or THEMES, and do not accept a rise in the last column.');
console.log(
  '\n  Baseline, 2026-08-22, after the boss/ladder split:\n' +
    '    ladder total 193, worst single mode 33 (phrygian, phrygianDominant),\n' +
    '    best 15 (lydian, 78%); boss leitmotif 4 unresolved of 14 clashes (71%).\n' +
    '  The earlier figure of 225 is not comparable — it included harmonicMinor\n' +
    '  scored against six themes that can never sound in it.',
);

/*
 * THIS FILE NOW HAS AN EXIT CODE, and only for the shapes.
 *
 * The ladder total and the boss row are still reported rather than gated: the
 * right threshold for them is "not worse than last time", which is a comparison
 * across commits that a single run cannot make, and inventing an absolute
 * number for them now would be picking a target rather than measuring one. The
 * shape assertions are different — each one is a comparison this run can make
 * for itself, against a baseline that is in the same file.
 */
process.exit(shapeFails ? 1 : 0);
