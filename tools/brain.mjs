/*
 * brain — do the browser bot and the Node bot still play the same game?
 *
 * `tools/lib/bot-brain.mjs` exists so the headless harness can run the REAL
 * bot instead of a hand-written stand-in. `driver.mjs` keeps its own inline
 * copy inside `page.evaluate`, and that duplication is deliberate rather than
 * lazy: the browser path cannot be exercised on a box where Chromium wedges in
 * D state, and rewriting untestable code to inject the shared source would
 * risk all eleven balance tools to remove a duplication this check can remove
 * for free.
 *
 * What must never happen is the two drifting. A bot that dodges differently
 * from the one the thresholds were calibrated against makes every number
 * downstream of it fiction — which is the exact failure `driver.mjs` was
 * created to stop, and its header says so.
 *
 * So: compare the two bodies with whitespace and comments normalised away. If
 * this fails, sync them; do not "fix" it by loosening the comparison.
 */
import { readFileSync } from 'node:fs';

const norm = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

const driver = readFileSync(new URL('./lib/driver.mjs', import.meta.url), 'utf8');
const brain = readFileSync(new URL('./lib/bot-brain.mjs', import.meta.url), 'utf8');

/* The shared logic, from `let t = 0;` to the end of the drive function. */
const cut = (src, openTag) => {
  const a = src.indexOf(openTag);
  if (a < 0) return null;
  const b = src.indexOf('inp.well =', a);
  if (b < 0) return null;
  return norm(src.slice(a, src.indexOf('\n', b)));
};

const dBody = cut(driver, 'let t = 0;');
const bBody = cut(brain, 'let t = 0;');

console.log('\nbrain — browser bot vs headless bot\n');
const fails = [];
if (!dBody) fails.push('could not find the bot body in tools/lib/driver.mjs');
if (!bBody) fails.push('could not find the bot body in tools/lib/bot-brain.mjs');

if (dBody && bBody) {
  /* The one intended difference: how each host reaches its input object. */
  /*
   * Re-normalise AFTER the removals. Cutting a substring out of an
   * already-normalised string leaves the spaces that surrounded it adjacent,
   * so the two sides differed by one space and the check reported a drift that
   * was entirely its own doing.
   */
  const tidy = (x) => x.replace(/\s+/g, ' ').trim();
  const dCmp = tidy(dBody.replace('const inp = window.__botInput;', '').replace('const drive = () => {', ''));
  const bCmp = tidy(bBody.replace('return (w, inp) => {', ''));
  console.log(`  driver.mjs body    ${dCmp.length} chars`);
  console.log(`  bot-brain.mjs body ${bCmp.length} chars`);
  if (dCmp !== bCmp) {
    fails.push('the two bot implementations have DRIFTED');
    for (let i = 0; i < Math.max(dCmp.length, bCmp.length); i++) {
      if (dCmp[i] !== bCmp[i]) {
        console.log(`\n  first difference at char ${i}:`);
        console.log(`    driver: ...${dCmp.slice(Math.max(0, i - 60), i + 60)}`);
        console.log(`    brain : ...${bCmp.slice(Math.max(0, i - 60), i + 60)}`);
        break;
      }
    }
  }
}

/* The browser path depends on nothing else: prove the factory is closure-free. */
const { makeBrain, BRAIN_SOURCE } = await import('./lib/bot-brain.mjs');
try {
  const revived = new Function(`return (${BRAIN_SOURCE})`)()('dodge');
  if (typeof revived !== 'function') fails.push('BRAIN_SOURCE did not revive into a function');
} catch (err) {
  fails.push(`BRAIN_SOURCE does not round-trip through toString(): ${err.message} — it has captured a free variable`);
}
if (typeof makeBrain('dodge') !== 'function') fails.push('makeBrain did not return a drive function');

console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  one bot, two hosts, no drift');
