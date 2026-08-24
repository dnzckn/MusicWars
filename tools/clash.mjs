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

function analyseMode(mode, themes = THEMES) {
  const progression = PROGRESSIONS[mode];
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
