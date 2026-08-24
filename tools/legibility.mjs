/*
 * legibility — can you read the HUD?
 *
 * `tools/contrast.mjs` asks whether BULLETS are visible against the room. It
 * samples rendered pixels and it is the right tool for that. Nothing asks the
 * same question about TEXT, which is the other half of "visual clutter is
 * high": a label you have to squint at is clutter even when nothing is moving.
 *
 * WCAG 2.1 contrast is pure arithmetic on two sRGB colours, so this needs no
 * browser — which matters, because the browser tools are dark whenever this
 * box stalls. AA wants 4.5:1 for body text and 3:1 for large or bold text;
 * AAA wants 7:1. A game HUD is small, dense and read under time pressure, so
 * body-text AA is the right bar rather than the large-text exception.
 *
 * WHAT IT CANNOT DO: resolve the CSS cascade. It does not know which
 * foreground actually lands on which background, so it scores every text
 * colour against every surface and reports the matrix. A colour that fails
 * against ALL surfaces is unreadable wherever it is used; one that fails
 * against some is a question for whoever knows the layout. Reported honestly
 * rather than guessed at — `contrast.mjs` is the tool that can see real
 * pixels, on a box where it can run.
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const vars = new Map();
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/gm)) vars.set(m[1], m[2]);

function rgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
/** WCAG relative luminance. */
function lum(hex) {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/* Surfaces things are drawn on, and inks drawn with. Split by role, not value. */
const SURFACES = ['--bg', '--panel', '--sunk'].filter((k) => vars.has(k));
const INKS = ['--ink', '--ink-2', '--dim', '--hot', '--cool', '--gold', '--green', '--violet'].filter((k) => vars.has(k));
const AA = 4.5;

console.log('\nlegibility — WCAG 2.1 contrast of the HUD palette\n');
console.log(`  ${'ink'.padEnd(10)} ${'hex'.padEnd(9)} ${SURFACES.map((s) => s.replace('--', '').padStart(8)).join(' ')}   verdict`);
console.log(`  ${'-'.repeat(10)} ${'-'.repeat(9)} ${SURFACES.map(() => '-'.repeat(8)).join(' ')}   -------`);

const fails = [];
for (const ink of INKS) {
  const rs = SURFACES.map((s) => ratio(vars.get(ink), vars.get(s)));
  const worst = Math.min(...rs);
  const best = Math.max(...rs);
  const verdict = best < AA ? 'FAILS EVERYWHERE' : worst < AA ? 'fails on some' : 'AA';
  console.log(`  ${ink.replace('--', '').padEnd(10)} ${vars.get(ink).padEnd(9)} ${rs.map((r) => r.toFixed(2).padStart(8)).join(' ')}   ${verdict}`);
  /*
   * Judged against the WORST surface, not the best. The first version passed
   * anything clearing AA somewhere, which is the wrong reading when the tool
   * cannot resolve the cascade: "readable on one of the three backgrounds it
   * might be on" is not a guarantee of anything. Every surface in this palette
   * is within 0.3 of the others in luminance, so demanding all three costs
   * nothing real and removes the ambiguity.
   */
  if (worst < AA) {
    fails.push(`${ink} (${vars.get(ink)}) is below AA ${AA}:1 — worst surface is ${worst.toFixed(2)}:1` +
      (best < AA ? ', and it fails against every surface' : ''));
  }
}

/* Which inks are actually used as text, so a failure can be weighted. */
console.log('\n  usage as a text colour in style.css:');
for (const ink of INKS) {
  const n = [...css.matchAll(new RegExp(`color\\s*:\\s*var\\(${ink}\\)`, 'g'))].length;
  if (n) console.log(`    ${ink.replace('--', '').padEnd(10)} ${n} rule(s)`);
}

/*
 * TRANSLUCENT TEXT, which the palette table cannot see.
 *
 * Several rules set `color: rgba(r, g, b, a)` directly instead of using a
 * variable, and alpha destroys contrast — a colour that clears AA at full
 * strength can be far below it at 45%, because what the eye receives is the
 * composite against whatever is behind. Checking only the variables would have
 * declared the palette clean while the actual rendered text failed.
 *
 * Composited over each surface with the standard source-over blend. Opaque
 * literals are checked too; they are just the a=1 case.
 */
console.log('\n  literal rgba() text colours, composited over each surface:');
const overSurface = (r, g, b, a, surf) => {
  const s2 = rgb(surf).map((c) => c * 255);
  const out = [r, g, b].map((c, i) => c * a + s2[i] * (1 - a));
  return '#' + out.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
};
const seen = new Set();
/*
 * `(^|[;{\s])color` — anchored, because `border-color` ends in "color".
 *
 * The unanchored pattern matched `border-color:` and `outline-color:` too, and
 * reported six failing "text" colours of which four were borders. WCAG 4.5:1
 * is a TEXT requirement; borders fall under non-text contrast at 3:1 and a
 * purely decorative one is exempt entirely. Four fabricated defects, from one
 * missing anchor.
 */
for (const m of css.matchAll(/(?:^|[;{\s])color\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)/gm)) {
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  const a = Number(m[4]);
  const key = `${r},${g},${b},${a}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const rs = SURFACES.map((surf) => ratio(overSurface(r, g, b, a, vars.get(surf)), vars.get(surf)));
  const worst = Math.min(...rs);
  console.log(`    rgba(${r},${g},${b},${a})`.padEnd(28) + rs.map((x) => x.toFixed(2).padStart(8)).join(' ') +
    `   ${worst < AA ? 'BELOW AA' : 'AA'}`);
  if (worst < AA) {
    fails.push(`rgba(${r},${g},${b},${a}) composites to ${worst.toFixed(2)}:1 — alpha is what breaks it, not the colour`);
  }
}
if (!seen.size) console.log('    (none)');

console.log('');
if (fails.length) {
  for (const m of fails) console.log(`  FAIL  ${m}`);
  console.log('\n  A HUD is small, dense and read under time pressure. A colour that clears');
  console.log('  no surface in the palette is not a style choice, it is text nobody reads.');
  process.exit(1);
}
console.log('  ok  every ink clears AA on every surface');
console.log('\n  Baseline 2026-08-22: worst ink is --dim at 4.95:1 on --panel.');
console.log('  It was #5c6688 / 3.40:1 — the most-used text colour in style.css');
console.log('  (23 rules) and the least readable thing in the HUD.');
