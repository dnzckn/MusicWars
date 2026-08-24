/*
 * domwiring — does every element the code reaches for actually exist?
 *
 * The UI is wired with `document.getElementById('x')!`, and that `!` is a
 * promise made to the compiler that nobody checks. A single mistyped id
 * returns null, the non-null assertion waves it through, and the game throws
 * on load — a total failure, from a typo, that no other check in this repo can
 * see. `syntax` parses, `tsc` type-checks, and neither knows what is in
 * `index.html`.
 *
 * That gap has been carried for a while: five UI features were added while the
 * browser suite was down, every one of them reaching for new ids. This is the
 * cheapest possible substitute for opening the page — it cannot tell you the
 * layout is ugly, but it can tell you the page will not blow up.
 *
 * Three directions, because each catches a different mistake:
 *   1. code -> markup: an id the code wants and the HTML does not have. A
 *      crash on load.
 *   2. markup -> code: an id in the HTML nothing references. Usually harmless,
 *      sometimes the leftover of a removed feature, always worth seeing.
 *   3. classes: a class the code toggles that no stylesheet defines. Silent —
 *      the state change happens and looks identical, which is how a selected
 *      item ends up indistinguishable from an unselected one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const css = readFileSync(join(ROOT, 'src/style.css'), 'utf8');

function sources(dir, out = [], ext = '.ts') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out, ext);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}
const files = sources(join(ROOT, 'src'));
const code = files.map((f) => ({ f: f.slice(ROOT.length), text: readFileSync(f, 'utf8') }));

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const fails = [];
const warns = [];

/* 1. Every id the code asks for must exist. */
const wanted = new Map();
for (const { f, text } of code) {
  for (const m of text.matchAll(/getElementById\('([^']+)'\)/g)) wanted.set(m[1], f);
  /*
   * `$('ui-score')` — hud.ts wraps `getElementById` in a helper that THROWS on
   * a miss, which is stricter than the `!` elsewhere and equally invisible
   * here. Missing this pattern meant the twenty-five ids the HUD updates every
   * frame — the busiest elements in the game — were the only ones this tool
   * did not check. It reported them as unreferenced markup instead, which is
   * the opposite of the truth.
   */
  for (const m of text.matchAll(/\B\$\('([\w-]+)'\)/g)) wanted.set(m[1], f);
  // `bindTouchButton('touch-focus', ...)` — a third wrapper. Each new helper
  // that takes an id string is invisible to a call-shape regex, which is why
  // direction 2 below does NOT use this list.
  for (const m of text.matchAll(/bindTouchButton\('([\w-]+)'/g)) wanted.set(m[1], f);
  // `querySelector('#a .b')` — take the leading id, which is the part that
  // must exist for the lookup to resolve at all.
  for (const m of text.matchAll(/querySelector(?:All)?\('#([\w-]+)/g)) wanted.set(m[1], f);
}
for (const [id, f] of wanted) {
  if (!htmlIds.has(id)) fails.push(`${f} reaches for #${id}, which index.html does not contain — this throws on load`);
}

/*
 * 2. Markup nothing reaches for — from ANY direction.
 *
 * The first version only looked at `src/*.ts` and reported 38, which is not a
 * finding, it is noise: an id can be perfectly alive as a CSS selector
 * (`#panel`), as a Playwright handle in `tools/` (`#start-button`), or as a
 * label target. A warning list that is mostly false is how a real one gets
 * skipped, so every way of referring to an element counts as a reference.
 */
/*
 * ANY literal mention counts here, not just a recognised lookup.
 *
 * Direction 1 has to be strict — it fails the build, so it may only assert on
 * calls it is certain are lookups. Direction 2 is the opposite: it is asking
 * "is this markup dead?", and a call-shape regex answers that badly. It
 * reported `#touch-focus` as unreferenced when the button is bound through
 * `bindTouchButton`, a wrapper the pattern did not know. Every new helper
 * would add another false accusation, so this side looks for the id anywhere
 * at all.
 */
const toolText = sources(join(ROOT, 'tools'), [], '.mjs').map((f) => readFileSync(f, 'utf8')).join('\n');
const allCode = code.map((c) => c.text).join('\n');
for (const id of htmlIds) {
  const referenced = allCode.includes(`'${id}'`)
    || allCode.includes(`"${id}"`)
    // `querySelector('#openers .opener-row')` — the id appears inside a
    // compound selector, so an exact-literal test misses it.
    || allCode.includes(`#${id}`)
    || new RegExp(`#${id}\\b`).test(css)
    || new RegExp(`#${id}\\b`).test(toolText)
    || html.includes(`for="${id}"`)
    || html.includes(`aria-labelledby="${id}"`)
    || html.includes(`aria-describedby="${id}"`);
  if (!referenced) warns.push(`#${id} — no literal in src/, no style, no tool`);
}

/*
 * 3. Classes the code toggles must be styled.
 *
 * Only `classList` calls with a literal — a computed class name cannot be
 * resolved here and guessing would produce noise. `hidden` is excluded: it is
 * a global utility, not a component class.
 */
const SKIP = new Set(['hidden']);
const toggled = new Map();
for (const { f, text } of code) {
  for (const m of text.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g)) {
    if (!SKIP.has(m[1])) toggled.set(m[1], f);
  }
}
for (const [cls, f] of toggled) {
  if (!cssClasses.has(cls)) fails.push(`${f} toggles .${cls}, which style.css never defines — the state change is invisible`);
}

/*
 * 4. A CENTRED COLUMN THAT CAN OUTGROW ITS BOX MUST BE ABLE TO SCROLL.
 *
 * `justify-content: center` on a column overflows both edges, and the half
 * that goes off the TOP is unreachable — there is no scrollbar unless the rule
 * asks for one, and plain `center` will not release the top edge even when
 * there is. The failure is invisible until someone opens the page on a short
 * window, which on this box is nobody.
 *
 * It nearly happened here: `.screen` is a full-bleed centred column and the
 * pause screen grew a workbench of up to eight rows on top of a heading, four
 * stats, a now-playing line and a seven-row control list. The fix is `safe
 * center` plus `overflow-y: auto`; this makes sure it stays fixed, and catches
 * the next full-screen overlay that forgets.
 */
/*
 * Comments stripped FIRST. `[^{}]+` before a brace happily swallows the
 * comment block above a rule, so the first version of this reported a
 * paragraph of prose as a selector.
 */
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
/*
 * Innermost rules only, and the selector must start with `.` or `#`.
 *
 * A flat `([^{}]+)\{([^}]*)\}` cannot see nesting, so an `@media` wrapper
 * pairs its own condition with the first inner body and every rule after it
 * shifts by one — which is how the first version accused `.opener`, a 10px
 * button, of centring a full-height column. Requiring a class or id selector
 * and a brace-free body matches only leaf rules and steps over at-rule
 * wrappers entirely.
 */
const rules = [...bareCss.matchAll(/([.#][\w-][^{}]*)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim(), body: m[2] }));
for (const { sel, body } of rules) {
  const centred = /justify-content:\s*(safe\s+)?center/.test(body);
  const column = /flex-direction:\s*column/.test(body);
  const fullBleed = /inset:\s*0/.test(body) || /height:\s*100(%|vh)/.test(body);
  if (!(centred && column && fullBleed)) continue;
  /*
   * A scrollbar is only meaningful on something the player can reach. A
   * `pointer-events: none` display overlay cannot be scrolled by anyone, so
   * demanding `overflow: auto` there would be a rule satisfied by a lie; safe
   * centring is the whole fix for those, because it stops the TOP clipping and
   * lets the surplus fall off the bottom where nothing important lives.
   */
  const interactive = !/pointer-events:\s*none/.test(body);
  if (interactive && !/overflow(-y)?:\s*(auto|scroll)/.test(body)) {
    fails.push(`"${sel}" centres a full-height column with no overflow — content taller than the viewport is unreachable off the top`);
  }
  if (!/justify-content:\s*safe\s+center/.test(body)) {
    fails.push(`"${sel}" uses plain "center"; add a "safe center" line after it or the top still clips when it overflows`);
  }
}

/*
 * 5. TWO RULES FOR ONE CLASS NAME.
 *
 * This is here because it happened. The title-screen starting-choice buttons
 * were given `class="opener"`, and `.opener` already existed 150 lines up for
 * the TUNING UP intro overlay: `position: absolute; inset: 0; z-index: 5;
 * pointer-events: none`. The buttons became full-screen, stacked and
 * click-through — the feature was dead and invisible, and nothing could see it
 * because the page does not load here.
 *
 * It was caught sideways, by the overflow rule above firing on the wrong
 * target. That is luck, and luck is not a check.
 *
 * DEPTH MATTERS. A flat scan reports 26 "duplicates" because a base rule and
 * its `@media` override look identical once the wrapper is gone. Only two
 * definitions at the SAME top level are a collision; everything nested is a
 * deliberate override.
 */
const topLevel = [];
{
  let depth = 0, buf = '';
  for (const ch of bareCss) {
    if (ch === '{') { if (depth === 0) topLevel.push(buf.trim()); depth++; buf = ''; }
    else if (ch === '}') { depth--; buf = ''; }
    else buf += ch;
  }
}
const seenClass = new Map();
for (const sel of topLevel) {
  const m = sel.match(/^\.([\w-]+)$/);
  if (!m) continue;
  const n = (seenClass.get(m[1]) ?? 0) + 1;
  seenClass.set(m[1], n);
  if (n === 2) {
    fails.push(`.${m[1]} is defined twice at the top level — one of them is a name collision, and the loser inherits properties it never asked for`);
  }
}

/*
 * 6. AN ELEMENT WITH NO STYLED CLASS AT ALL.
 *
 * Not "a class with no rule" — that fires on every modifier. `.b-score` sits
 * beside `.block`, which does the styling, and warning about it would be noise
 * of exactly the kind that makes a warning list unreadable. What is worth
 * knowing is an element where NONE of its classes resolves to anything, which
 * means it renders with browser defaults and almost certainly should not.
 */
for (const m of html.matchAll(/class="([^"]+)"/g)) {
  const classes = m[1].split(/\s+/).filter(Boolean).filter((c) => c !== 'hidden');
  if (!classes.length) continue;
  if (classes.every((c) => !cssClasses.has(c))) {
    warns.push(`an element carries only unstyled classes (${classes.map((c) => '.' + c).join(' ')}) — it renders with browser defaults`);
  }
}

console.log('\ndomwiring — the page the code expects\n');
console.log(`  ids the code reaches for   ${wanted.size}`);
console.log(`  ids present in the markup  ${htmlIds.size}`);
console.log(`  classes toggled from code  ${toggled.size}`);
if (warns.length) {
  console.log(`\n  unreferenced markup (${warns.length}):`);
  for (const w of warns.slice(0, 10)) console.log(`    ${w}`);
  if (warns.length > 10) console.log(`    ...and ${warns.length - 10} more`);
}
for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) console.log('\n  ok  every element and class the code depends on exists');
process.exit(fails.length ? 1 : 0);
