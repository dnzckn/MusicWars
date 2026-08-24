/*
 * pickup — compose an anacrusis for each theme's tag, by search.
 *
 * Rule 8 of the brief wants a pickup into the repeat and, until the grid was
 * widened to 16 slots, it could not be satisfied: a pickup needs the last
 * sixteenths of the bar and rule 9 wanted silence there. Both rules were
 * really asking for the same thing — the phrase stops before the next begins —
 * so rule 9 now measures the BREATH wherever it falls and rule 1 reads the
 * phrase's last note BEFORE the pickup window. That leaves room, and this
 * finds what goes in it.
 *
 * Hand-fitting nine tags against fifteen interacting gates is guesswork; the
 * pickup that fixes rule 8 can break rule 6 (the repeated rhythmic cell) or
 * rule 15 (chord tones) in a mode the composer was not thinking about. So
 * enumerate the shapes a pickup can take, score each with tune.mjs's OWN
 * analyse(), and keep only candidates that fail nothing.
 *
 * Ranking among the survivors: KEEP THE MOST WRITTEN MUSIC FIRST, then fewest
 * unresolved clashes, then the stepwise ratio nearest 0.78.
 *
 * That first key is not tidiness, it is a guard against the search cheating.
 * Ranked on stepwise alone it chose shape D for six of nine themes — and D
 * wins there by DELETING notes. T0's tag descends 4-3-2-0; dropping the 3 and
 * the 2 removes two stepwise intervals and the ratio falls without a single
 * leap being added. The brief asks for a tune with more leap in it, and the
 * search answered by making the tune shorter. Preserving the written head
 * first means a shape may only earn its place by what it ADDS, and D survives
 * exactly where nothing else fits.
 */
import { analyse } from './tune.mjs';

const L = await import('../src/audio/layers.ts');
const { THEMES, BOSS_THEME, HOLD } = L;
const H = HOLD;

const ALL = [...THEMES.map((t, i) => [`T${i}`, t]), ['BOSS', BOSS_THEME]];
const SLOTS = THEMES[0].tag.length;
const N = null;

/** Degrees a pickup may use. Wide enough to allow a leap in, narrow enough to stay in range. */
const DEGREES = [-3, -2, -1, 0, 1, 2, 3, 4, 5];

/*
 * The shapes. Each keeps as much of the written tag as it can and rebuilds
 * only the space after the phrase's final tonic.
 *
 *   A  tonic shortened to an eighth at slot 8, breath 10-13, pickup on the
 *      last two sixteenths. The smallest possible edit to a written bar.
 *   B  tonic moved up to slot 6, breath 8-11, pickup on slots 12-13 — which
 *      the skeleton keeps, so the anacrusis is still there when the mix is
 *      calm and the filigree has faded.
 *   C  as B, but a two-note run into the barline.
 */
function shapes(tag) {
  const out = [];
  const head8 = tag.slice(0, 8);
  const head6 = tag.slice(0, 6);
  const head4 = tag.slice(0, 4);
  // `keep` = how many slots of the written tag the shape leaves untouched.
  for (const p of DEGREES) {
    out.push({ k: `A/${p}`, keep: 8, cell: [...head8, 0, H, N, N, N, N, p, H] });
    out.push({ k: `B/${p}`, keep: 6, cell: [...head6, 0, H, N, N, N, N, p, H, N, N] });
    /*
     * D drops a note instead of adding one. T1 already sits on rule 11's
     * 34-note ceiling, so every shape above overflows it by exactly one; this
     * shortens the tag's head to buy the room back.
     */
    out.push({ k: `D/${p}`, keep: 4, cell: [...head4, 0, H, N, N, N, N, N, N, N, N, p, H] });
    /*
     * E is a single sixteenth. BOSS is blocked by rule 7 — 61% of its notes
     * are already one length — so a pickup that reuses that length pushes it
     * over 65%. A one-slot note is a duration BOSS does not otherwise have.
     */
    out.push({ k: `E/${p}`, keep: 8, cell: [...head8, 0, H, N, N, N, N, N, p] });
    for (const q of DEGREES) {
      if (q === p) continue;
      out.push({ k: `C/${p},${q}`, keep: 6, cell: [...head6, 0, H, N, N, N, N, p, q, H, N] });
      // F: two sixteenths into the barline — motion, at a length neither theme leans on.
      out.push({ k: `F/${p},${q}`, keep: 8, cell: [...head8, 0, H, N, N, N, N, p, q] });
    }
  }
  return out;
}

/*
 * A pickup has to MOVE into the downbeat. The gates cannot see this: rule 8
 * only asks whether the last slots sound, so a search ranking on clash alone
 * happily returns the landing note itself — T5's first pick repeated the 0 it
 * was leading into, which is a held note, not an anacrusis. Require a real
 * interval, and cap it at a fourth so the pickup leads rather than lurches.
 */
function leadsIn(cell, theme) {
  const landing = theme.a.find((d) => typeof d === 'number');
  const last = [...cell].reverse().find((d) => typeof d === 'number');
  if (typeof landing !== 'number' || typeof last !== 'number') return false;
  const step = Math.abs(last - landing);
  return step >= 1 && step <= 4;
}

const results = [];
for (const [name, theme] of ALL) {
  const base = analyse(name, theme);
  const cands = [];
  const blocked = new Map();
  for (const s of shapes(theme.tag)) {
    if (s.cell.length !== SLOTS) throw new Error(`${s.k}: ${s.cell.length} slots, want ${SLOTS}`);
    if (!leadsIn(s.cell, theme)) continue;
    let r;
    try { r = analyse(name, { ...theme, tag: s.cell }); } catch { continue; }
    if (r.fails.length) {
      for (const f of r.fails) {
        const rule = f.split(' ')[0];
        blocked.set(rule, (blocked.get(rule) ?? 0) + 1);
      }
      continue;
    }
    /*
     * NO REGRESSION on the two metrics a pickup can quietly wreck.
     *
     * Gap-fill is the subtle one. The interval from the pickup INTO the
     * downbeat is never scored — it crosses out of the eight-bar period — but
     * the interval from the phrase's final tonic INTO the pickup is, and being
     * last it can never be answered. So a pickup that leaps away from the
     * tonic books a permanently unfilled leap: the first search dropped four
     * themes from 100% gap-fill to 75-86% and every gate still passed, because
     * rule 2's floor is 70%. Passing a gate is not the same as not making the
     * music worse. A classical anacrusis steps away from the tonic and steps
     * back in, and that is what this constraint selects for.
     */
    if (r.gapFill < base.gapFill - 1e-9) continue;
    if (r.clashes > base.clashes) continue;
    cands.push({ ...s, clashes: r.clashes, step: r.stepRatio, gap: r.gapFill, warn: r.warn.length });
  }
  cands.sort((a, b) => (b.keep - a.keep) || (a.clashes - b.clashes)
    || (Math.abs(a.step - 0.78) - Math.abs(b.step - 0.78)));
  results.push({ name, base, best: cands[0] ?? null, n: cands.length, blocked });
}

console.log('\npickup — an anacrusis for every tag, searched against the brief\n');
console.log(`  ${'theme'.padEnd(6)} ${'passing'.padStart(8)} ${'shape'.padStart(10)} ${'clash'.padStart(6)} ${'was'.padStart(5)} ${'step'.padStart(6)} ${'was'.padStart(5)} ${'gap'.padStart(5)} ${'was'.padStart(5)}`);
console.log(`  ${'-'.repeat(6)} ${'-'.repeat(8)} ${'-'.repeat(10)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(6)} ${'-'.repeat(5)} ${'-'.repeat(5)} ${'-'.repeat(5)}`);
for (const r of results) {
  const b = r.best;
  console.log(`  ${r.name.padEnd(6)} ${String(r.n).padStart(8)} ${(b ? b.k : '—').padStart(10)} ` +
    `${String(b ? b.clashes : '—').padStart(6)} ${String(r.base.clashes).padStart(5)} ` +
    `${(b ? (100 * b.step).toFixed(0) + '%' : '—').padStart(6)} ${((100 * r.base.stepRatio).toFixed(0) + '%').padStart(5)} ` +
    `${(b ? (100 * b.gap).toFixed(0) + '%' : '—').padStart(5)} ${((100 * r.base.gapFill).toFixed(0) + '%').padStart(5)}`);
}

const fmt = (c) => c.map((x) => (x === null ? 'null' : x === H ? 'HOLD' : String(x))).join(', ');
console.log('\n  tags to paste:\n');
for (const r of results) {
  if (!r.best) {
    const why = [...r.blocked.entries()].sort((a, b) => b[1] - a[1])
      .map(([rule, n]) => `rule ${rule} blocked ${n}`).join(', ');
    console.log(`  ${r.name}: NO CANDIDATE PASSES — ${why || 'no shape even leads in'}`);
    continue;
  }
  console.log(`  ${r.name} [${r.best.k}]\n    tag: [${fmt(r.best.cell)}],`);
}

const missing = results.filter((r) => !r.best);
console.log(missing.length
  ? `\n  FAIL  ${missing.length} theme(s) have no passing anacrusis: ${missing.map((r) => r.name).join(', ')}`
  : '\n  ok  every theme has an anacrusis that breaks no other gate');
process.exit(missing.length ? 1 : 0);
