/**
 * Fail-test the new touchcheck contract: the still-press inversion, the drag
 * gain, and the two properties only the warp lever has.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FILES = ['src/core/input.ts', 'src/main.ts'];
/*
 * NORMALISED TO LF FOR MATCHING, RESTORED BYTE-FOR-BYTE. `core.autocrlf` is
 * true here, so the working tree carries CRLF while the repository stores LF,
 * and the LF anchors below stopped matching the first time the tree came back
 * from a `git stash`. The no-op case is reported loudly for that reason: a
 * harness that applies nothing would otherwise call an unchallenged gate green.
 */
const raw = Object.fromEntries(FILES.map((f) => [f, readFileSync(f, 'utf8')]));
const original = Object.fromEntries(FILES.map((f) => [f, raw[f].split('\r\n').join('\n')]));

const CHR10 = String.fromCharCode(10);

const MUTATIONS = [
  [
    'a press is a boost again (input.ts)',
    'src/core/input.ts',
    (s) =>
      s.replace(
        '    if (this.pointerDown) {' + CHR10 + '      if (Math.abs(this.dragDX)',
        '    if (this.pointerDown) dragY -= 1;' + CHR10 + '    if (this.pointerDown) {' + CHR10 + '      if (Math.abs(this.dragDX)',
      ),
  ],
  [
    'the stick is consumed on read, so it decays (input.ts)',
    'src/core/input.ts',
    (s) =>
      s.replace(
        '      if (Math.abs(this.dragDY) > DRAG_DEAD) dragY += Math.max(-1, Math.min(1, this.dragDY / DRAG_RANGE));' + CHR10 + '    }',
        '      if (Math.abs(this.dragDY) > DRAG_DEAD) dragY += Math.max(-1, Math.min(1, this.dragDY / DRAG_RANGE));' + CHR10 + '      this.dragDX = 0;' + CHR10 + '      this.dragDY = 0;' + CHR10 + '    }',
      ),
  ],
  /*
   * NOT HERE: doubling DRAG_RANGE. Fail-testing showed touchcheck cannot see
   * it, and correctly so — halving the speed halves both measurement windows
   * equally, so their ratio is unchanged and the floor is still cleared. The
   * throw is pinned by `inputcheck`'s literal "a 90 px offset is full lock,
   * 45 is half", which is where a number belongs. A row here that proves
   * nothing is worse than no row.
   */
  [
    'the lever stops stopping propagation (main.ts)',
    'src/main.ts',
    (s) =>
      s.replace(
        "warpEl.addEventListener('pointerdown', (ev) => {\n  ev.preventDefault();\n  ev.stopPropagation();",
        "warpEl.addEventListener('pointerdown', (ev) => {\n  ev.preventDefault();",
      ),
  ],
  [
    'letting go of the lever reports 0 instead of null (main.ts)',
    'src/main.ts',
    (s) => s.replace('  input.warpLever = null;\n};\nwarpEl.addEventListener', '  input.warpLever = 0;\n};\nwarpEl.addEventListener'),
  ],
];

let missed = 0;
try {
  for (const [name, file, mutate] of MUTATIONS) {
    const mutated = mutate(original[file]);
    if (mutated === original[file]) {
      console.log(`!! ${name}: MUTATION DID NOT APPLY — anchor moved, this row proves nothing`);
      missed++;
      continue;
    }
    writeFileSync(file, mutated);
    let out = '';
    let failed = false;
    try {
      out = execSync('node tools/touchcheck.mjs', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      failed = true;
    }
    writeFileSync(file, raw[file]);
    const lines = out
      .split('\n')
      .filter((l) => /^(STILL PRESS|REAL DRAG|warp lever)/.test(l))
      .map((l) => l.trim().slice(0, 150));
    if (!failed) {
      console.log(`!! ${name}: touchcheck STAYED GREEN — the contract does not test this`);
      missed++;
    } else {
      console.log(`ok ${name}`);
    }
    for (const l of lines) console.log(`     ${l}`);
  }
} finally {
  for (const f of FILES) writeFileSync(f, original[f]);
}
console.log(`\n${MUTATIONS.length} mutations, ${missed} caught nothing (want 0). Sources restored.`);
