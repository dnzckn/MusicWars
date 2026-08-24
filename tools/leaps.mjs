/*
 * leaps — write leap-and-answer pairs into the body of each theme.
 *
 * THE PROBLEM. Every theme passes all fifteen gates and all nine are still
 * smooth: 79-92% stepwise against a 70-80% canon band, and a histogram of
 * every interval in every theme says why — 73% of them are a single scale
 * degree. The tunes walk. `tools/pickup.mjs` could not fix this and said so:
 * a pickup is one interval at the very end of a period, and rule 2 scores the
 * one going INTO it and never the one coming out, so a leaping anacrusis only
 * books an unfillable gap. Smoothness lives in bars 1-7 and has to be fixed
 * there.
 *
 * THE LEVER, which is not the obvious one. Rule 4 allows exactly ONE interval
 * wider than four degrees, so big leaps are not available — but rule 3 counts
 * a step as 1-2 degrees and rule 2 counts a leap as 3 or more. The whole
 * argument therefore turns on FOURTHS: an interval of 3-4 degrees is a leap
 * for gap-fill, is under rule 4's ceiling, and is the only currency that moves
 * the stepwise ratio. Each one wants an answering step back, which is the
 * gap-fill principle and also just how a tune breathes after a jump.
 *
 * THE METHOD. Hill-climb on single-note substitutions. Only the degree of an
 * EXISTING note may change: no note is added, moved or deleted, so every
 * rhythm, every duration and every rest survives untouched, and rules 6, 7, 9
 * and 11 cannot be disturbed at all. That restriction is deliberate — the
 * pickup search, left free to delete, "improved" the stepwise ratio by
 * removing stepwise notes rather than adding leaps, and a search will always
 * find the cheapest lie you leave available to it.
 *
 * WHAT IT REFUSES TO TRADE. A move must keep every gate passing AND must not
 * regress unresolved clashes or gap-fill. Both are the same lesson learned in
 * pickup.mjs: rule 2's floor is 70%, so a candidate can drop gap-fill from
 * 100% to 75% and still be told it passed. Passing a gate is not the same as
 * not making the music worse.
 */
import { analyse } from './tune.mjs';

const L = await import('../src/audio/layers.ts');
const { THEMES, BOSS_THEME } = L;

const ALL = [...THEMES.map((t, i) => [`T${i}`, t]), ['BOSS', BOSS_THEME]];
/* The body. `tag` is excluded — the anacrusis there was just composed. */
const CELLS = ['a', 'a2', 'b', 'b2', 'c'];
const TARGET = 0.78;

/** Every (cell, slot) holding a note, i.e. every degree a move may rewrite. */
function sites(theme) {
  const out = [];
  for (const c of CELLS) {
    theme[c].forEach((d, i) => { if (typeof d === 'number') out.push([c, i]); });
  }
  return out;
}

/*
 * Consecutive note pairs WITHIN a cell — the unit a leap-and-answer actually
 * occupies.
 *
 * Single-note moves got eight themes into the band and left T4 at 92% with
 * literally zero legal moves: 89 of its rejections were rule 15, the on-beat
 * chord-tone rule, scored across all nine modes at once. That is the expected
 * shape of the problem rather than bad luck. Moving one note has to leave a
 * consonance and arrive at another consonance while changing the interval on
 * BOTH sides of itself, and in a 25-note theme there is rarely such a slot.
 * A leap and the step that answers it are one gesture, so offer them as one
 * move and the pair can step through a dissonance that neither could cross
 * alone.
 */
function pairs(theme) {
  const out = [];
  for (const c of CELLS) {
    const ix = [];
    theme[c].forEach((d, i) => { if (typeof d === 'number') ix.push(i); });
    for (let k = 0; k + 1 < ix.length; k++) out.push([c, ix[k], ix[k + 1]]);
  }
  return out;
}

/*
 * The anacrusis lands on the first note of `a`. Moving it would silently
 * invalidate the pickup that was just written to lead into it, and no gate
 * here can see across that seam, so hold it fixed.
 */
function landingSite(theme) {
  const i = theme.a.findIndex((d) => typeof d === 'number');
  return `a:${i}`;
}

/*
 * The harmonic concession, and why it is not just a retuned threshold.
 *
 * Eight themes reach the band at zero cost. T4 reaches it at NO price: with
 * clash held at its starting value there is not one legal single or paired
 * move, because 89 of its rejections are rule 15 — the on-beat chord-tone
 * test, scored across nine modes simultaneously. Rule 3's own comment records
 * this tension ("rules 3-upper and 15 pull against each other"), and T4 is
 * where it binds.
 *
 * So the fallback allows two more unresolved clashes, and ONLY for a theme
 * still above 85% after the free climb has run. Measured, that buys T4
 * 92% -> 83%: nine points of the metric that decides whether a tune is bland,
 * for two clashes that put it at 10 — the same as T6, and inside the spread
 * the other themes already occupy. Both numbers are taste proxies and this is
 * a judgement between them, so the report names every theme that used it
 * rather than folding the cost into a total where nobody would find it.
 */
const STUCK = 0.85;
const SLACK = 2;

function climb(name, theme, slack = 0) {
  const base = analyse(name, theme);
  if (base.fails.length) return { name, base, best: theme, moves: [], blocked: 'already failing' };
  const degs = [];
  for (const c of CELLS) for (const d of theme[c]) if (typeof d === 'number') degs.push(d);
  const lo = Math.min(...degs) - 1, hi = Math.max(...degs) + 1;

  let cur = { ...theme }, curR = base;
  const moves = [];
  const fixed = landingSite(theme);

  for (let pass = 0; pass < 24; pass++) {
    let bestMove = null;
    for (const [c, i] of sites(cur)) {
      if (`${c}:${i}` === fixed) continue;
      const was = cur[c][i];
      for (let d = lo; d <= hi; d++) {
        if (d === was) continue;
        const cell = [...cur[c]]; cell[i] = d;
        let r;
        try { r = analyse(name, { ...cur, [c]: cell }); } catch { continue; }
        if (r.fails.length) continue;
        if (r.clashes > base.clashes + slack) continue;
        if (r.gapFill < base.gapFill - 1e-9) continue;
        // Only accept a move that actually walks toward the band.
        const gain = Math.abs(curR.stepRatio - TARGET) - Math.abs(r.stepRatio - TARGET);
        if (gain <= 1e-9) continue;
        if (!bestMove || gain > bestMove.gain
          || (gain === bestMove.gain && r.clashes < bestMove.r.clashes)) {
          bestMove = { c, i, d, was, gain, r };
        }
      }
    }
    if (!bestMove) {
      // Singles are exhausted; try the two-note gesture before giving up.
      for (const [c, i, j] of pairs(cur)) {
        if (`${c}:${i}` === fixed) continue;
        const wasI = cur[c][i], wasJ = cur[c][j];
        for (let d1 = lo; d1 <= hi; d1++) {
          for (let d2 = lo; d2 <= hi; d2++) {
            if (d1 === wasI && d2 === wasJ) continue;
            const cell = [...cur[c]]; cell[i] = d1; cell[j] = d2;
            let r;
            try { r = analyse(name, { ...cur, [c]: cell }); } catch { continue; }
            if (r.fails.length) continue;
            if (r.clashes > base.clashes + slack) continue;
            if (r.gapFill < base.gapFill - 1e-9) continue;
            const gain = Math.abs(curR.stepRatio - TARGET) - Math.abs(r.stepRatio - TARGET);
            if (gain <= 1e-9) continue;
            if (!bestMove || gain > bestMove.gain
              || (gain === bestMove.gain && r.clashes < bestMove.r.clashes)) {
              bestMove = { c, i, d: d1, was: wasI, j, d2, wasJ, gain, r, pair: true };
            }
          }
        }
      }
    }
    if (!bestMove) break;
    const cell = [...cur[bestMove.c]]; cell[bestMove.i] = bestMove.d;
    if (bestMove.pair) cell[bestMove.j] = bestMove.d2;
    cur = { ...cur, [bestMove.c]: cell };
    curR = bestMove.r;
    moves.push(bestMove.pair
      ? `${bestMove.c}[${bestMove.i},${bestMove.j}] ${bestMove.was},${bestMove.wasJ}->${bestMove.d},${bestMove.d2}`
      : `${bestMove.c}[${bestMove.i}] ${bestMove.was}->${bestMove.d}`);
    if (Math.abs(curR.stepRatio - TARGET) < 0.005) break;
  }
  return { name, base, best: cur, final: curR, moves };
}

const results = ALL.map(([n, t]) => {
  const free = climb(n, t);
  if ((free.final ?? free.base).stepRatio <= STUCK) return free;
  const paid = climb(n, t, SLACK);
  if ((paid.final ?? paid.base).stepRatio >= (free.final ?? free.base).stepRatio) return free;
  return { ...paid, paid: true };
});

console.log('\nleaps — leap-and-answer pairs written into bars 1-7\n');
console.log(`  ${'theme'.padEnd(6)} ${'moves'.padStart(6)} ${'step'.padStart(6)} ${'was'.padStart(6)} ${'clash'.padStart(6)} ${'was'.padStart(5)} ${'gap'.padStart(5)}`);
console.log(`  ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(5)}`);
for (const r of results) {
  const f = r.final ?? r.base;
  console.log(`  ${r.name.padEnd(6)} ${String(r.moves.length).padStart(6)} ` +
    `${((100 * f.stepRatio).toFixed(0) + '%').padStart(6)} ${((100 * r.base.stepRatio).toFixed(0) + '%').padStart(6)} ` +
    `${String(f.clashes).padStart(6)} ${String(r.base.clashes).padStart(5)} ${((100 * f.gapFill).toFixed(0) + '%').padStart(5)}` +
    `${r.paid ? '   <- spent ' + (f.clashes - r.base.clashes) + ' clash to leave 85%' : ''}`);
}

const H = L.HOLD;
const fmt = (c) => c.map((x) => (x === null ? 'null' : x === H ? 'HOLD' : String(x))).join(', ');
console.log('\n  cells to paste (only those that changed):\n');
for (const r of results) {
  if (!r.moves.length) { console.log(`  ${r.name}: unchanged — no move improves it without a regression`); continue; }
  console.log(`  ${r.name}  (${r.moves.join(', ')})`);
  const orig = ALL.find(([n]) => n === r.name)[1];
  for (const c of CELLS) {
    if (r.best[c].join() !== orig[c].join()) console.log(`    ${c}: [${fmt(r.best[c])}],`);
  }
}

/* `--json` feeds the patcher; the human report above is the default. */
if (process.argv.includes('--json')) {
  const dump = {};
  for (const r of results) {
    dump[r.name] = {};
    for (const c of CELLS) dump[r.name][c] = r.best[c].map((x) => (x === H ? '_' : x));
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/leaps.json', JSON.stringify(dump));
}

const still = results.filter((r) => (r.final ?? r.base).stepRatio > 0.85);
console.log(still.length
  ? `\n  ${still.length} theme(s) still above 85%: ${still.map((r) => r.name).join(', ')}`
  : '\n  ok  every theme is at or under 85% stepwise');
