/*
 * motif — is a theme BUILT from something, or is it just a row of notes?
 *
 * Every other music check in this directory asks whether the score is correct.
 * `clash` checks the melody against the harmony, `motion` checks the lines
 * against each other, `interlock` checks the rhythm, `masking` checks the
 * spectrum. All of them can pass on a tune nobody could hum.
 *
 * This asks the only question that separates the canon from competent
 * background music: **motivic economy.** The pieces this score is aiming at are
 * built from very little. Frog's Theme is one dotted figure. Wily Stage 1 is one
 * ascending arpeggio. The Chrono Trigger main theme states a four-note cell and
 * then spends two minutes turning it over. You remember them because there is
 * one small thing to remember, and everything else is that thing again from a
 * different angle.
 *
 * A tune with no repeated cell is not wrong. It is unmemorable, which for a
 * game whose stated premise is that the music is the primary experience is a
 * worse failure than a wrong note — a wrong note is noticed.
 *
 * HOW IT IS MEASURED. Motifs are matched on INTERVALS, not pitches, so a cell
 * restated a third higher still counts — that is the entire point of a
 * sequence, and matching on pitch would score Bach as incoherent. For each
 * theme the tool takes every run of 2-4 consecutive intervals, counts which
 * recur, and reports what share of the theme's notes belong to at least one
 * recurring figure.
 *
 * WHAT IT CANNOT TELL YOU. Whether the motif is any good. A theme that repeats
 * a dull cell six times scores 100% and is still dull. This finds the absence
 * of construction, not the presence of quality — the one direction a number can
 * honestly point.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'src/audio/layers.ts'), 'utf8');

/*
 * The tables are read as text and brace-matched, the same technique
 * `clash.mjs` uses and for the same reason: importing `layers.ts` would drag in
 * Strudel, and a theme table is a plain literal that does not need it.
 */
function literal(name) {
  const decl = new RegExp(`^(?:export )?const ${name}\\b[^=]*=\\s*`, 'm');
  const m = decl.exec(src);
  if (!m) throw new Error(`could not find const ${name}`);
  let i = m.index + m[0].length;
  const open = src[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inLine = false;
  let inBlock = false;
  let start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { i++; break; } }
  }
  // `HOLD` is an identifier the evaluator has no binding for. Substituted as
  // `null`, not as its literal '_': this tool tests `d === null` to mean "no
  // note", and passing the string made a continuation read as a pitch. See the
  // longer note in clash.mjs.
  const text = src
    .slice(start, i)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\bas const\b/g, '')
    .replace(/\bHOLD\b/g, 'null');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text});`)();
}

const THEMES = literal('THEMES');
const BOSS_THEME = literal('BOSS_THEME');

/** The eight bars of a phrase, undeveloped — same shape `clash` measures. */
const phrase = (t) => [t.a, t.a2, t.b, t.b2, t.a, t.a2, t.c, t.tag];

/**
 * A theme's notes in order, rests dropped.
 *
 * Rests are structural — they are what makes a figure a figure — but a motif is
 * a shape in pitch, and threading rests into the interval sequence would make
 * the same shape fail to match itself across two rhythmic settings. `interlock`
 * and `counterpoint` are where rhythm is measured; this is about contour.
 */
function degrees(theme) {
  const out = [];
  for (const cell of phrase(theme)) {
    for (const d of cell) if (d !== null && d !== undefined) out.push(d);
  }
  return out;
}

function analyse(theme) {
  const notes = degrees(theme);
  const iv = [];
  for (let i = 1; i < notes.length; i++) iv.push(notes[i] - notes[i - 1]);
  if (iv.length < 4) return null;

  /** interval-run -> the note indices it covers, for every length 2..4 */
  const runs = new Map();
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i + len <= iv.length; i++) {
      const key = `${len}:${iv.slice(i, i + len).join(',')}`;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key).push(i);
    }
  }

  /*
   * DISTINCTIVE figures only, and this correction matters more than the
   * original measurement did.
   *
   * The first version counted every recurring interval-run and reported 98%
   * mean economy across all seven themes — a number so saturated it could not
   * discriminate. Looking at WHAT recurred explained it: the strongest figure
   * in `THEMES[0]` was `[-1,-1,-1,-1]` appearing eight times. That is four
   * consecutive descending steps. It is a scale, not a motif.
   *
   * Stepwise motion is self-similar: any run of +/-1 matches any other run of
   * +/-1, so a melody that mostly walks will always score near 100% and the
   * metric measures "is this stepwise" rather than "is this constructed".
   *
   * A figure therefore counts only if it has SHAPE — at least two different
   * interval values, and at least one leap of a third or more. That is the
   * difference between a motif somebody could hum back and a passage that
   * happens to repeat because scales resemble scales.
   */
  const distinctive = (shape) => {
    const vals = shape.split(',').map(Number);
    return new Set(vals).size >= 2 && vals.some((v) => Math.abs(v) >= 2);
  };

  const covered = new Set();
  const coveredStrict = new Set();
  const recurring = [];
  for (const [key, at] of runs) {
    if (at.length < 2) continue;
    const len = Number(key.split(':')[0]);
    const shape = key.split(':')[1];
    const strict = distinctive(shape);
    recurring.push({ shape, len, times: at.length, strict });
    // A run of `len` intervals spans `len + 1` notes.
    for (const i of at) {
      for (let k = 0; k <= len; k++) {
        covered.add(i + k);
        if (strict) coveredStrict.add(i + k);
      }
    }
  }
  const steps = iv.filter((v) => Math.abs(v) === 1).length / iv.length;

  // Longest recurring figure is the headline: a theme whose only repeats are
  // two-interval fragments is repeating accidentally, not by construction.
  const strictOnly = recurring.filter((r) => r.strict);
  const longest = strictOnly.reduce((a, r) => Math.max(a, r.len), 0);
  return {
    notes: notes.length,
    economy: covered.size / notes.length,
    strict: coveredStrict.size / notes.length,
    steps,
    longest,
    best: strictOnly.sort((a, b) => b.len - a.len || b.times - a.times).slice(0, 2),
    span: Math.max(...notes) - Math.min(...notes),
  };
}

const named = [...THEMES.map((t, i) => [`THEMES[${i}]`, t]), ['BOSS_THEME', BOSS_THEME]];

console.log('motif — how much of each theme is built from a recurring cell?\n');
console.log('  theme         notes  span  stepwise  any    shaped  strongest shaped figure');
console.log('  ' + '-'.repeat(80));

let total = 0;
let counted = 0;
for (const [name, t] of named) {
  const r = analyse(t);
  if (!r) { console.log(`  ${name.padEnd(13)} too short to analyse`); continue; }
  total += r.strict;
  counted++;
  const fig = r.best[0] ? `[${r.best[0].shape}] x${r.best[0].times}` : '(no shaped figure recurs)';
  const flag = r.strict < 0.4 ? '  <- little construction' : '';
  console.log(
    `  ${name.padEnd(13)} ${String(r.notes).padEnd(6)} ${String(r.span).padEnd(5)} ` +
      `${(r.steps * 100).toFixed(0).padStart(3)}%      ${(r.economy * 100).toFixed(0).padStart(3)}%   ` +
      `${(r.strict * 100).toFixed(0).padStart(3)}%    ${fig}${flag}`,
  );
}

/*
 * RHYTHMIC VARIETY ACROSS THE TABLE — the dimension the pitch searches were
 * quietly eating.
 *
 * `themesearch` generates candidates over one fixed rest pattern, because
 * rests drive `arpGapsFor` and varying them would move the counterpoint as a
 * side effect of moving the tune. That is right for a single search and wrong
 * across four of them: every theme it produces has the identical rhythmic
 * profile, so improving pitch construction on four themes collapsed the table
 * from six rhythms to three without any measured number getting worse.
 *
 * Six themes exist to sound different across waves. Two of them differing only
 * in pitch is a weaker kind of different than two differing in pitch AND
 * rhythm, and nothing here was watching.
 */
{
  const shape = (cell) => cell.map((v) => (v === null || v === undefined ? '.' : 'x')).join('');
  const sig = (t) => ['a', 'a2', 'b', 'b2', 'c', 'tag'].map((k) => shape(t[k])).join('|');
  const sigs = named.map(([, t]) => sig(t));
  const distinct = new Set(sigs).size;
  const groups = new Map();
  for (const [i, g] of sigs.entries()) {
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(named[i][0]);
  }
  console.log(`\n  rhythmic profiles: ${distinct} distinct across ${sigs.length} themes`);
  for (const [, members] of groups) {
    if (members.length > 1) console.log(`    identical rhythm: ${members.join(', ')}`);
  }
  if (distinct < sigs.length - 1) {
    console.log(
      '    Two themes may legitimately share a rhythm. More than that means the\n' +
        '    table is varying in one dimension where it could vary in two.',
    );
  }
}

console.log(`\n  mean SHAPED economy ${((total / Math.max(1, counted)) * 100).toFixed(0)}%  —  the 'any' column is the saturated one; ignore it`);
console.log(
  '\n  Economy is the share of a theme\'s notes belonging to a figure that occurs\n' +
    '  more than once, matched on intervals so a sequence counts. High is not\n' +
    '  automatically good — a dull cell repeated six times scores 100%. This\n' +
    '  detects the ABSENCE of construction, which is the direction a number can\n' +
    '  honestly point; whether the cell is worth hearing is not measurable here.',
);
