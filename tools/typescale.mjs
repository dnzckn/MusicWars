/*
 * typescale — does the HUD shrink its text on small screens?
 *
 * Small-screen CSS should hold type size or raise it. A phone is not a small
 * desktop: it has less physical area at a similar viewing distance, so the
 * usual reason a rule gets a smaller font in a narrow breakpoint is that
 * something did not fit — which solves a layout problem by making the content
 * harder to read, on the device where reading is already hardest.
 *
 * This compares each selector's base `font-size` with the value it is given
 * inside the small-screen media block and reports every selector that goes
 * DOWN. That is a mechanical, objective check; whether any individual shrink
 * is acceptable is a judgement that needs eyes on the layout, so this reports
 * and ranks rather than failing on a size threshold nobody can defend.
 *
 * It gates on one thing only: text that would be too small to read on ANY
 * device. Below about 9px a monospace HUD label stops being readable at arm's
 * length regardless of layout, and the smallest here was 7px.
 *
 * LIMITS, stated because a CSS parser this small is easy to over-trust: it
 * matches flat `selector { ... }` blocks by text and does not resolve
 * inheritance, shorthand `font:`, `em`/`rem`/`clamp()` units, or specificity.
 * A selector it cannot pair up simply does not appear.
 */
import { readFileSync } from 'node:fs';

/*
 * COMMENTS ARE STRIPPED FIRST, and that was a real blind spot rather than
 * tidiness.
 *
 * `sizes()` below matches `selector { body }` by taking everything since the
 * last brace as the selector. A CSS comment contains no braces, so a rule with
 * a comment above it — which in this stylesheet is most of them, deliberately —
 * had `/* ... *​/ .foo` as its captured "selector" and never matched the same
 * rule's entry in another block. The pairing that finds shrinks is keyed on
 * that string, so every commented rule was silently exempt from the whole
 * check.
 *
 * Found while adding the overlay HUD: `.hud-score` shrinks 24px -> 20px on a
 * small screen and this tool did not list it, while its uncommented neighbour
 * `.slots li b` was listed correctly. Two rules, same block, different verdict,
 * for no reason a reader could see.
 *
 * WHICH HALF THIS STRENGTHENS. The 9px floor was never affected — it reads the
 * px value and does not care what the selector was called — and it has been
 * fail-tested (an 8px `.hud-run` is reported and exits 1). What was blind is
 * the SHRINK pairing, which is the informational half. Stripping comments took
 * that list from four selectors to eight; `.hud-score`, `.eyebrow`, `.tagline`
 * and `.controls` had been exempt the whole time.
 *
 * The shrink list still reports rather than fails, deliberately, and that is
 * this file's own decision rather than an oversight: "whether any individual
 * shrink is acceptable is a judgement that needs eyes on the layout". Making it
 * visible is the fix; making it fatal would be a different argument.
 *
 * Replaced with spaces rather than removed, so line positions are unchanged if
 * anything downstream ever wants them.
 */
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Split into (mediaQuery|null, body) chunks, one level deep. */
function chunks(src) {
  const out = [];
  let i = 0, base = '';
  while (i < src.length) {
    const at = src.indexOf('@media', i);
    if (at < 0) { base += src.slice(i); break; }
    base += src.slice(i, at);
    const open = src.indexOf('{', at);
    let depth = 0, j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (!depth) break; }
    }
    out.push({ query: src.slice(at, open).replace(/\s+/g, ' ').trim(), body: src.slice(open + 1, j) });
    i = j + 1;
  }
  out.unshift({ query: null, body: base });
  return out;
}

/** selector -> px, for flat rules that set a px font-size. */
function sizes(body) {
  const m = new Map();
  for (const r of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = r[1].replace(/\s+/g, ' ').trim();
    const fs = r[2].match(/font-size\s*:\s*([0-9.]+)px/);
    if (fs) for (const one of sel.split(',')) m.set(one.trim(), Number(fs[1]));
  }
  return m;
}

const parts = chunks(css);
const base = sizes(parts.find((p) => p.query === null).body);
const small = parts.filter((p) => p.query && /max-width/.test(p.query) && !/min-width:\s*9/.test(p.query));

const MIN_READABLE = 9;
const shrinks = [];
const tiny = [];
/*
 * The floor is checked over EVERY block, base included. The first version
 * looped only the small-screen blocks while printing "below 9px anywhere",
 * and a planted 8px in a base rule sailed through it. The heading was making
 * a claim the loop did not check — which is worse than a missing check,
 * because the passing line reads as coverage.
 */
for (const blk of parts) {
  for (const [sel, px] of sizes(blk.body)) {
    if (px < MIN_READABLE) tiny.push({ sel, px, q: blk.query ?? '(base)' });
  }
}
for (const blk of small) {
  for (const [sel, px] of sizes(blk.body)) {
    const b = base.get(sel);
    if (b !== undefined && px < b) shrinks.push({ sel, from: b, to: px, q: blk.query });
  }
}

console.log('\ntypescale — base vs small-screen font sizes\n');
console.log(`  base rules with a px font-size: ${base.size}`);
console.log(`  small-screen blocks examined:   ${small.length}`);

console.log(`\n  selectors that get SMALLER on a small screen (${shrinks.length}):`);
for (const s of shrinks.sort((a, b) => a.to - b.to)) {
  console.log(`    ${s.sel.padEnd(30)} ${String(s.from).padStart(5)}px -> ${String(s.to).padStart(5)}px`);
}
if (!shrinks.length) console.log('    (none)');

console.log(`\n  text below ${MIN_READABLE}px anywhere (${tiny.length}):`);
for (const t of tiny.sort((a, b) => a.px - b.px)) console.log(`    ${t.sel.padEnd(30)} ${String(t.px).padStart(5)}px   ${t.q}`);
if (!tiny.length) console.log('    (none)');

console.log('');
if (tiny.length) {
  for (const t of tiny) console.log(`  FAIL  ${t.sel} is ${t.px}px in ${t.q} — below ${MIN_READABLE}px is not readable on any device`);
  process.exit(1);
}
console.log(`  ok  nothing is under ${MIN_READABLE}px`);
