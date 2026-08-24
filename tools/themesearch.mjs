/*
 * themesearch — find a theme that is BOTH constructed and consonant.
 *
 * WHY THIS EXISTS. `tools/motif.mjs` found that `THEMES[2]` has 0% shaped
 * economy: 71% of its intervals are single steps and not one figure containing
 * a leap ever recurs. It is the only theme in the game with no construction at
 * all — harmonically inoffensive and melodically anonymous.
 *
 * I tried to rewrite it by hand twice. Both attempts fixed the construction
 * (0% -> 70%) and broke the harmony: `clash` went 193 -> 217 and then 193 ->
 * 244 against a rule I had already set for that tool, "do not accept a rise in
 * the last column". The second attempt also drove stepwise motion down to 3%,
 * turning the tune into an arpeggio exercise — a different defect, not a fix.
 *
 * That is the signal to stop guessing. The two objectives pull against each
 * other: leaps are what make a figure memorable, and leaps are what land on
 * non-chord tones. Hand-optimising a melody against a cross-product of nine
 * modes and five chord spans is not something to do by eye, and it is trivial
 * to do by enumeration.
 *
 * WHAT IT DOES. Builds candidate themes from a motif and its transformations —
 * state it, sequence it, invert it, restate it at the climax — and scores every
 * one on both axes using the same arithmetic the two gates use:
 *
 *   CLASH   on-beat notes that are not chord tones and do not resolve by step,
 *           summed over the eight ladder modes. Mirrors `clash.mjs`.
 *   SHAPED  the share of notes belonging to a recurring figure that has at
 *           least two distinct intervals and at least one leap. Mirrors
 *           `motif.mjs`, including its correction for scale self-similarity.
 *
 * It reports only candidates that BEAT the incumbent on clash while carrying
 * real construction, so accepting one cannot be the trade I twice talked myself
 * into. This proposes; it does not write. The table is for a human to choose
 * from, and the winner still has to be pasted in and re-gated.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const theorySrc = readFileSync(join(ROOT, 'src/audio/theory.ts'), 'utf8');
const layersSrc = readFileSync(join(ROOT, 'src/audio/layers.ts'), 'utf8');

function literal(src, name) {
  const decl = new RegExp(`^(?:export )?const ${name}\\b[^=]*=\\s*`, 'm');
  const m = decl.exec(src);
  if (!m) throw new Error(`could not find const ${name}`);
  let i = m.index + m[0].length;
  const open = src[i];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inLine = false;
  let inBlock = false;
  const start = i;
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
  const text = src.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\bas const\b/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(`return (${text});`)();
}

const MODES = literal(theorySrc, 'MODES');
const PROGRESSIONS = literal(theorySrc, 'PROGRESSIONS');
const THEMES = literal(layersSrc, 'THEMES');
const ladderMatch = theorySrc.match(/MODE_LADDER[^=]*=\s*\[([^\]]*)\]/);
const LADDER = ladderMatch ? [...ladderMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : Object.keys(PROGRESSIONS);

/* ---- the two scorers, mirroring the gates exactly ---------------------- */

function degreeToSemitone(mode, degree) {
  const steps = MODES[mode];
  const len = steps.length;
  const octave = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return steps[idx] + octave * 12;
}
const triad = (mode, degree) =>
  [0, 2, 4].map((d) => ((degreeToSemitone(mode, degree + d) % 12) + 12) % 12);

function degreeForBar(progression, bar) {
  const bars = progression.reduce((n, s) => n + s[1], 0);
  let at = ((bar % bars) + bars) % bars;
  let degree = progression[progression.length - 1][0];
  for (const span of progression) {
    if (at < span[1]) { degree = span[0]; break; }
    at -= span[1];
  }
  return degree;
}

const phrase = (t) => [t.a, t.a2, t.b, t.b2, t.a, t.a2, t.c, t.tag];

/** Unresolved on-beat clashes for ONE theme, summed over the ladder modes. */
function clashOf(theme) {
  let unresolved = 0;
  for (const mode of LADDER) {
    const prog = PROGRESSIONS[mode];
    if (!prog) continue;
    const cells = phrase(theme);
    cells.forEach((cell, bar) => {
      const chord = triad(mode, degreeForBar(prog, bar));
      for (let slot = 0; slot < cell.length; slot += 2) {
        const d = cell[slot];
        if (d === null || d === undefined) continue;
        const semis = degreeToSemitone(mode, d);
        if (chord.includes(((semis % 12) + 12) % 12)) continue;
        let next = null;
        for (let j = slot + 1; j < cell.length; j++) {
          if (cell[j] !== null && cell[j] !== undefined) { next = cell[j]; break; }
        }
        if (next === null && bar + 1 < cells.length) {
          const nxt = cells[bar + 1];
          for (let j = 0; j < nxt.length; j++) {
            if (nxt[j] !== null && nxt[j] !== undefined) { next = nxt[j]; break; }
          }
        }
        const step = next === null ? null : Math.abs(degreeToSemitone(mode, next) - semis);
        if (!(step !== null && step >= 1 && step <= 2)) unresolved++;
      }
    });
  }
  return unresolved;
}

/** Shaped economy and stepwise fraction, mirroring `motif.mjs`. */
function shapeOf(theme) {
  const notes = [];
  for (const cell of phrase(theme)) for (const d of cell) if (d !== null && d !== undefined) notes.push(d);
  const iv = [];
  for (let i = 1; i < notes.length; i++) iv.push(notes[i] - notes[i - 1]);
  if (iv.length < 4) return { shaped: 0, steps: 0, span: 0 };
  const runs = new Map();
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i + len <= iv.length; i++) {
      const key = `${len}:${iv.slice(i, i + len).join(',')}`;
      if (!runs.has(key)) runs.set(key, []);
      runs.get(key).push(i);
    }
  }
  const covered = new Set();
  for (const [key, at] of runs) {
    if (at.length < 2) continue;
    const len = Number(key.split(':')[0]);
    const vals = key.split(':')[1].split(',').map(Number);
    if (!(new Set(vals).size >= 2 && vals.some((v) => Math.abs(v) >= 2))) continue;
    for (const i of at) for (let k = 0; k <= len; k++) covered.add(i + k);
  }
  return {
    shaped: covered.size / notes.length,
    steps: iv.filter((v) => Math.abs(v) === 1).length / iv.length,
    span: Math.max(...notes) - Math.min(...notes),
  };
}

/**
 * A cheap proxy for the `chords+lead` roughness that dominates `masking`.
 *
 * WHY A PROXY. `masking.mjs` builds every lane and queries real events, which
 * costs seconds per candidate — fine for one theme, hopeless for 2602. But the
 * pad's content is knowable from the same tables `clashOf` already reads: since
 * it opened to fifths under a sounding melody, it holds the chord's ROOT and
 * FIFTH and nothing else. So "is this melody note inside a critical band of
 * what the pad is holding" is arithmetic, not a simulation.
 *
 * This matters because the third gate was missing when `THEMES[2]` was chosen.
 * Two of the 214 qualifying candidates were tested against real `masking` by
 * hand, the better one cost 82 units, and I took it as a documented trade. With
 * the axis in the search there may be no trade to take.
 *
 * WHAT IT IS NOT — and this is not a caveat, it is a measured failure.
 *
 * It ignores the motor, the arp and the bass, ignores gain, and ignores octave
 * placement: a melody note two octaves above the pad's fifth is counted rough
 * here and is not. The intended claim was that it RANKS candidates even though
 * it cannot predict `masking`'s number.
 *
 * **It does not do that either.** Tested: this proxy scored a Pareto candidate
 * at rough 121 against the incumbent's 131, an 8% improvement, and real
 * `masking` came back at 991.8 — identical to three decimal places, unmoved.
 * The candidate was reverted; the only thing it actually bought was +1% mean
 * motivic economy for a span wider than every other theme.
 *
 * So treat this column as untested at best. The reason is almost certainly
 * octaves: `masking` weights by what is genuinely inside a critical band, and
 * pitch-class proximity is not that — two notes a semitone apart in pitch class
 * but two octaves apart in register do not mask, and this counts them.
 *
 * Kept, rather than deleted, because a column that has been shown not to work
 * is more useful than one nobody has checked — and because the fix is known if
 * anyone wants it: model register, not pitch class. Do not choose a theme on
 * this number until then.
 */
function roughOf(theme) {
  let rough = 0;
  for (const mode of LADDER) {
    const prog = PROGRESSIONS[mode];
    if (!prog) continue;
    phrase(theme).forEach((cell, bar) => {
      const deg = degreeForBar(prog, bar);
      // The open fifth the pad actually holds: root and fifth, no third.
      const pad = [0, 4].map((d) => ((degreeToSemitone(mode, deg + d) % 12) + 12) % 12);
      for (const d of cell) {
        if (d === null || d === undefined) continue;
        const pc = ((degreeToSemitone(mode, d) % 12) + 12) % 12;
        for (const p of pad) {
          const gap = Math.min(Math.abs(pc - p), 12 - Math.abs(pc - p));
          if (gap >= 1 && gap <= 2) rough++;
        }
      }
    });
  }
  return rough;
}

/* ---- candidate generation --------------------------------------------- */

/*
 * The rest pattern is FIXED and taken from the incumbent's density, not
 * searched. Rests are what `arpGapsFor` reads to place the arp's answers, so
 * varying them would change the counterpoint as a side effect of changing the
 * tune — a second variable moving silently under the one being measured.
 */
/*
 * FOUR rest patterns, not one — because one collapsed the table.
 *
 * The original fixed layout was justified on its own terms: rests drive
 * `arpGapsFor`, so varying them moves the counterpoint as a side effect of
 * moving the tune. That reasoning is sound for a SINGLE search and wrong across
 * four of them. Every theme this tool produced came out with the identical
 * rhythmic profile, and `motif` now reports the damage: four of seven themes
 * rhythmically indistinguishable, the table down from six rhythms to three.
 *
 * Improving pitch construction on four themes while quietly deleting their
 * rhythmic variety is a real regression, and NO MEASURED NUMBER MOVED THE WRONG
 * WAY while it happened — the dimension simply was not being watched.
 *
 * So the pattern is a search axis now: held fixed within any one candidate, so
 * the arp still answers a consistent set of rests, and varied between them. All
 * four place four notes, so density is constant and a rhythm change cannot
 * smuggle in a busier or sparser tune.
 *
 * `RHYTHM=n` forces one. By default all four are searched and the winner
 * reports which it used, so a theme can be given a rhythm the others lack.
 */
const LAYOUTS = [
  (a, b, c, d) => [a, null, b, c, null, d, null, null],   // 0: the original
  (a, b, c, d) => [a, b, null, c, null, null, d, null],   // 1: pair, gap, late answer
  (a, b, c, d) => [a, null, null, b, c, null, d, null],   // 2: held opening
  (a, b, c, d) => [a, null, b, null, c, d, null, null],   // 3: even, then a pair
];
/*
 * CADENCES, plural, and this was the whole problem with the first sweep.
 *
 * `b2` (the half cadence at bar 4) and `tag` (the close at bar 8) used to be
 * one fixed formula each. Every theme rebuilt by this tool therefore ended
 * both its halves on identical notes: measured across the finished table, `b2`
 * had 2 distinct values across 6 themes and `tag` had 2. Those are the two
 * bars a phrase LANDS on and the most memorable moments in it, so six tunes
 * that cadence identically are one tune in six costumes — the same defect as
 * the rhythmic-variety collapse this tool already caused once, in the one
 * dimension nothing was watching.
 *
 * `b2` must stay OPEN — it is a half cadence, so it should not arrive on the
 * tonic (degree 0). `tag` must CLOSE, so every option ends on 0 relative to
 * `start`, i.e. `start - 1` when start is 1.
 */
const B2_SHAPES = [
  // 0: the plain stepwise release, which is what every theme used to have.
  (s0) => [s0 + 3, null, s0 + 2, null, s0 + 1, null, null, null],
  /*
   * 1: an arch — up, then away. NEVER WINS, and that is a fact rather than a bug.
   *
   * This value has never once appeared in a surviving candidate, which is the
   * same signature the `start` axis showed when its two dead thirds turned out
   * to be a generator artefact (see `TAG_SHAPES`). It is not the same cause,
   * and telling the two apart needs the cost isolated rather than inferred.
   *
   * Measured with cell, rhythm and tag held fixed: shape 0 scores clash 4 and
   * this scores 20 — with the SAME THREE DEGREES, only reordered. `clash`
   * weighs on-beat notes, and an arch necessarily puts the lowest of the three
   * on the downbeat where shape 0 puts the highest. Raising the whole arch does
   * not rescue it: starting a third higher gives 18, a fifth higher 13, still
   * three times shape 0's cost.
   *
   * Kept because the search should offer it and let the harmony refuse it,
   * which is exactly what happens. Do not "fix" it.
   */
  (s0) => [s0 + 1, null, s0 + 3, null, s0 + 2, null, null, null],
  // 2: a drop from the top, then a step back up. Wider, and it breathes.
  (s0) => [s0 + 4, null, null, s0 + 1, null, s0 + 2, null, null],
  // 3: held and sparse — two notes where the others have three.
  (s0) => [s0 + 2, null, null, null, s0 + 1, null, null, null],
];
/*
 * Every tag resolves to degree 0 ABSOLUTELY, not to `start - 1`.
 *
 * They used to end on `start - 1`, which only lands on the tonic when `start`
 * is 1 — so of the three values in the `start` axis, two produced a phrase
 * that never came home and were filtered out on harmony every time. Measured:
 * across 41,632 candidates at a clash budget of 40, EVERY surviving row had
 * start 1. Two thirds of a search axis was dead, and the visible symptom was
 * seven of eight themes opening on the same scale degree — which reads as
 * sameness in the rondo, where a refrain and an episode alternate inside one
 * key.
 *
 * For `start` 1 these are byte-identical to the old shapes, so nothing already
 * chosen moves; the change only unlocks the other two starts.
 */
const TAG_SHAPES = [
  // 0: stepwise onto the tonic, the original.
  (s0) => [s0 + 1, null, s0, null, null, null, 0, null],
  // 1: approached from above, arriving earlier and resting.
  (s0) => [s0 + 2, null, s0 + 1, null, 0, null, null, null],
  // 2: a leap down to the tonic — the most final of the four.
  (s0) => [s0 + 3, null, null, null, 0, null, null, null],
  // 3: sparse, letting the accompaniment finish the sentence.
  (s0) => [s0, null, null, null, null, null, 0, null],
];

const inv = (cell) => cell.map((v) => -v);
const from = (start, iv) => {
  const out = [start];
  for (const v of iv) out.push(out[out.length - 1] + v);
  return out;
};

const INTERVALS = [-4, -3, -2, -1, 1, 2, 3, 4];
const candidates = [];
const ONLY = process.env.RHYTHM !== undefined ? Number(process.env.RHYTHM) : null;
const BUDGET = Number(process.env.BUDGET ?? 0);
for (const [rhythm, lay] of LAYOUTS.entries()) {
if (ONLY === null || rhythm === ONLY)
for (const i0 of INTERVALS) {
  for (const i1 of INTERVALS) {
    for (const i2 of INTERVALS) {
      const cell = [i0, i1, i2];
      // Must be a shape, not a scale: two distinct values and one real leap.
      if (new Set(cell).size < 2 || !cell.some((v) => Math.abs(v) >= 2)) continue;
      for (const start of [0, 1, 2]) {
        for (const seq of [1, 2, -1]) {
          for (const climax of [3, 4]) {
           for (let bi = 0; bi < B2_SHAPES.length; bi++) {
            for (let ti = 0; ti < TAG_SHAPES.length; ti++) {
            const a = from(start, cell);
            const a2 = from(start + seq, cell);
            const b = from(start + 4, inv(cell));
            const cc = from(start + climax, cell);
            const theme = {
              a: lay(...a),
              a2: lay(...a2),
              b: lay(...b),
              b2: B2_SHAPES[bi](start),
              c: lay(...cc),
              tag: TAG_SHAPES[ti](start),
            };
            const all = [...a, ...a2, ...b, ...cc,
              ...theme.b2.filter((x) => x !== null), ...theme.tag.filter((x) => x !== null)];
            // Keep it inside the register the other themes occupy.
            if (Math.min(...all) < -1 || Math.max(...all) > 9) continue;
            candidates.push({ cell, start, seq, climax, rhythm, b2: bi, tag: ti, theme });
          }
         }
          }
        }
      }
    }
  }
}
}

/*
 * Which theme to search for. `motif` names the candidates for replacement; this
 * takes the index so the tool is not welded to the first one that needed it.
 */
const INDEX = Number(process.argv[2] ?? 2);
const incumbent = THEMES[INDEX];
if (!incumbent) throw new Error(`no THEMES[${INDEX}] — there are ${THEMES.length}`);
const baseClash = clashOf(incumbent);
const baseRough = roughOf(incumbent);
const baseShape = shapeOf(incumbent);

console.log(`themesearch — ${candidates.length} candidates for THEMES[${INDEX}]\n`);
console.log(
  `  incumbent: clash ${baseClash}   rough ${baseRough}   shaped ${(baseShape.shaped * 100).toFixed(0)}%   ` +
    `stepwise ${(baseShape.steps * 100).toFixed(0)}%   span ${baseShape.span}`,
);

const scored = candidates
  .map((c) => ({ ...c, clash: clashOf(c.theme), rough: roughOf(c.theme), ...shapeOf(c.theme) }))
  /*
   * Both objectives, and the clash bar is STRICTLY better than the incumbent.
   * A candidate that improves construction while costing harmony is the trade I
   * already rejected twice by hand; letting the search offer it would just be
   * making the same mistake faster.
   *
   * Stepwise is bounded below as well as above: a melody of pure leaps scores
   * beautifully on `shaped` and is an arpeggio exercise, which is exactly what
   * my second hand attempt produced at 3%.
   */
  /*
   * PARETO: no worse on any axis, strictly better on at least one.
   *
   * "Strictly better on clash" was right while the incumbent was the original
   * wander. Once a theme has been improved it stops being a useful filter —
   * re-running against the replacement returned zero candidates purely because
   * nothing beats a clash of 1. What is wanted from here is an upgrade that
   * costs nothing, which is exactly a Pareto improvement.
   *
   * The stepwise band stays absolute rather than relative: it is a bound on
   * what a tune IS, not a comparison. Below 35% it is an arpeggio exercise —
   * measured, from my own second hand attempt at 3% — and above 75% it is a
   * scale.
   */
  /*
   * `BUDGET=n` relaxes the clash bar by n, for one specific purpose: buying a
   * distinct RHYTHM when no strictly-better candidate exists on that layout.
   *
   * Four themes ended up rhythmically identical and the already-rebuilt ones
   * sit at clash 1-8, so nothing can beat them outright on a different rest
   * pattern. Rhythmic sameness across most of the rotation is the "sounds like
   * a loop" complaint in another form, and it is worth a few clash points —
   * but only as an explicit, bounded, stated trade, never as a silent one.
   */
  .filter(
    (c) =>
      c.clash <= baseClash + BUDGET &&
      c.rough <= baseRough + BUDGET * 12 &&
      c.shaped >= baseShape.shaped &&
      (BUDGET > 0 || c.clash < baseClash || c.rough < baseRough || c.shaped > baseShape.shaped) &&
      c.steps >= 0.35 &&
      c.steps <= 0.75,
  )
  /*
   * Ranked by roughness FIRST now, then clash, then construction. All three
   * already clear the incumbent by the filter above, so this is choosing among
   * winners — and roughness is the axis that was missing when the last theme
   * was picked, so it is the one with an unpaid debt against it.
   */
  /*
   * Ranked by CLASH first, not `rough`.
   *
   * This was backwards until now, and the cost was concrete: on the very first
   * relaxed run for THEMES[0] the row with the lowest clash of the whole table
   * (7, beating the incumbent's 8) sorted NINTH, because eight cells with more
   * clash happened to have less `rough`. It was nearly missed.
   *
   * `rough` is a proxy, and it is a proxy this project has already MEASURED as
   * not predictive: a rebuild it scored 131 -> 121 left real cross-lane masking
   * at 991.8, unmoved. Leading the sort with it meant ranking every candidate
   * by the one number known not to track the thing it estimates, while `clash`
   * — counted directly off the notes against the mode — was relegated to a
   * tiebreak. Keep `rough` in the table so it stays visible and so its failure
   * stays checkable, but never let it choose.
   */
  .sort((a, b) => a.clash - b.clash || b.shaped - a.shaped || a.rough - b.rough);

console.log(`\n  ${scored.length} candidates are a Pareto improvement (no worse anywhere).\n`);
if (scored.length === 0) {
  console.log('  None. The incumbent is harmonically better than anything constructed');
  console.log('  that this generator can reach — which is itself a finding: it would mean');
  console.log('  the two objectives genuinely conflict for this progression set.');
  process.exit(0);
}

/*
 * ONE ROW PER DISTINCT CELL, not the top ten overall.
 *
 * Sorted purely by score, the table fills with near-identical variants of
 * whichever cell happens to win — the first run offered ten rows and eight of
 * them opened `[-1,1,...]`. That is useless for the actual job, because the
 * six themes exist to sound different from each other across waves and pasting
 * the same winner into two of them is a worse defect than either being weak.
 * The point of variety is variety.
 */
const byCell = new Map();
for (const c of scored) {
  const k = c.cell.join(',');
  if (!byCell.has(k)) byCell.set(k, c);
}
const diverse = [...byCell.values()];
console.log(`  ${diverse.length} distinct cells among them. Best of each:\n`);
console.log('  cell         start seq clim rhy b2 tag  rough  clash  shaped  stepwise  span');
console.log('  ' + '-'.repeat(66));
for (const c of diverse.slice(0, 12)) {
  console.log(
    `  [${c.cell.join(',').padEnd(9)}] ${String(c.start).padEnd(5)} ${String(c.seq).padEnd(3)} ` +
      `${String(c.climax).padEnd(4)} ${String(c.rhythm).padEnd(3)} ${String(c.b2).padEnd(2)} ${String(c.tag).padEnd(3)} ${String(c.rough).padEnd(6)} ${String(c.clash).padEnd(6)} ${(c.shaped * 100).toFixed(0).padStart(3)}%    ` +
      `${(c.steps * 100).toFixed(0).padStart(3)}%      ${c.span}`,
  );
}

// `CELL=-1,3,1` picks a specific row instead of the top one — the table is
// deliberately one-row-per-cell for variety, so the right pick is sometimes a
// lower row that suits the theme it has to sit beside.
const want = (c) =>
  (!process.env.CELL || c.cell.join(',') === process.env.CELL) &&
  (process.env.B2 === undefined || String(c.b2) === process.env.B2) &&
  (process.env.TAG === undefined || String(c.tag) === process.env.TAG);
/*
 * A constrained request that matches nothing FAILS LOUDLY. The first version
 * fell back to `diverse[0]`, so asking for `B2=1 TAG=3` and being handed
 * `b2 3 tag 1` looked like an answer rather than an empty result.
 */
const constrained = process.env.CELL || process.env.B2 !== undefined || process.env.TAG !== undefined;
const picked = constrained ? scored.find(want) : null;
if (constrained && !picked) {
  const have = [...new Set(scored.map((c) => `b2${c.b2}/tag${c.tag}`))].sort().join(' ');
  console.log(`\n  NO CANDIDATE matches that constraint. Pairs available here: ${have || '(none)'}`);
  process.exit(1);
}
const best = picked ?? diverse[0];
console.log(`\n  best candidate, rhythm ${best.rhythm} b2 ${best.b2} tag ${best.tag} (clash ${baseClash} -> ${best.clash}, shaped ${(baseShape.shaped * 100).toFixed(0)}% -> ${(best.shaped * 100).toFixed(0)}%):\n`);
for (const k of ['a', 'a2', 'b', 'b2', 'c', 'tag']) {
  console.log(`    ${k}: [${best.theme[k].map((v) => (v === null ? 'null' : v)).join(', ')}],`);
}
console.log('\n  Re-run `npm run clash` and `node tools/motif.mjs` after pasting: this');
console.log('  scores one theme in isolation and the gates score the whole table.');
