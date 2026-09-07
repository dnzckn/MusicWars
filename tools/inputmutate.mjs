/**
 * Fail-test C3: mutate the source, run inputcheck, report which assertions go
 * red. A replacement assertion that has never been seen red is not evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SRC = 'src/core/input.ts';
/*
 * NORMALISED TO LF FOR MATCHING, RESTORED BYTE-FOR-BYTE.
 *
 * `core.autocrlf` is true on the machine this was written on, so the working
 * tree carries CRLF while the repository stores LF. Every anchor below is
 * written with LF, and they silently stopped matching the first time the tree
 * came back from a `git stash` — the harness then reported "MUTATION DID NOT
 * APPLY", which is the only reason it was noticed. A mutation harness that
 * quietly applies nothing reports a gate as green when the gate was never
 * challenged, so the no-op case is loud on purpose.
 */
const raw = readFileSync(SRC, 'utf8');
const original = raw.split('\r\n').join('\n');

const NL = String.fromCharCode(10);

const MUTATIONS = [
  ['press writes y again', (s) =>
    s.replace('    if (this.pointerDown) {' + NL + '      if (Math.abs(this.dragDX)',
      '    if (this.pointerDown) dragY -= 1;' + NL + '    if (this.pointerDown) {' + NL + '      if (Math.abs(this.dragDX)')],
  ['drag summed before the throttle read', (s) =>
    s.replace('    const throttle = Math.max(-1, Math.min(1, -y));',
      '    y = Math.max(-1, Math.min(1, y + dragY));' + NL + '    const throttle = Math.max(-1, Math.min(1, -y));')],
  ['DRAG_RANGE doubled', (s) => s.replace('export const DRAG_RANGE = 90;', 'export const DRAG_RANGE = 180;')],
  ['DRAG_DEAD zeroed', (s) => s.replace('export const DRAG_DEAD = 3;', 'export const DRAG_DEAD = 0;')],
  ['the clamp removed on the x offset', (s) =>
    s.replace('x += Math.max(-1, Math.min(1, this.dragDX / DRAG_RANGE));', 'x += this.dragDX / DRAG_RANGE;')],
  /*
   * THE ONE THAT MATTERS. A stick that is CONSUMED on read is a displacement
   * model wearing a stick's clothes: it answers once and then centres itself,
   * which is exactly the maximum-travel-per-drag defect the owner reported
   * twice. Only the hold assertion can see it — every ratio check in C3 samples
   * the first step and would stay green.
   */
  ['the offset is consumed on read (the stick decays)', (s) =>
    s.replace('      if (Math.abs(this.dragDY) > DRAG_DEAD) dragY += Math.max(-1, Math.min(1, this.dragDY / DRAG_RANGE));' + NL + '    }',
      '      if (Math.abs(this.dragDY) > DRAG_DEAD) dragY += Math.max(-1, Math.min(1, this.dragDY / DRAG_RANGE));' + NL + '      this.dragDX = 0;' + NL + '      this.dragDY = 0;' + NL + '    }')],
  ['pressPointer stops re-basing the origin', (s) =>
    s.replace('    this.dragOriginX = viewX;' + NL + '    this.dragOriginY = viewY;' + NL + '    this.dragDX = 0;' + NL + '    this.dragDY = 0;' + NL + '    if (touch) {',
      '    this.dragDX = 0;' + NL + '    this.dragDY = 0;' + NL + '    if (touch) {')],
  ['rebaseDrag made a no-op', (s) =>
    s.replace('  rebaseDrag(viewX: number, viewY: number): void {' + NL + '    if (!this.pointerDown) return;',
      '  rebaseDrag(viewX: number, viewY: number): void {' + NL + '    if (this.pointerDown) return;')],
  ['the pointerDown guard removed from sample()', (s) =>
    s.replace('    if (this.pointerDown) {' + NL + '      if (Math.abs(this.dragDX)',
      '    if (true) {' + NL + '      if (Math.abs(this.dragDX)')],
  ['the mouse path sets touchActive', (s) =>
    s.replace('    if (touch) {' + NL + '      this.touchActive = true;', '    if (true) {' + NL + '      this.touchActive = true;')],
  ['warpLever published as ?? 0', (s) =>
    s.replace('this.state.warpLever = this.warpLever;', 'this.state.warpLever = this.warpLever ?? 0;')],
  ['resetPointer leaves the lever', (s) =>
    s.replace('    this.releasePointer();' + NL + '    this.warpLever = null;', '    this.releasePointer();')],
];

const reds = (out) =>
  out
    .split('\n')
    .filter((l) => /^\s*(RED|FAIL|not ok|✗)/i.test(l) || (l.includes('  ') && /^\s*(RED|red)\b/.test(l)))
    .map((l) => l.trim());

/** inputcheck prints `ok` for passes; anything else at that indent is a fail. */
const failing = (out) =>
  out
    .split('\n')
    .filter((l) => /^\s{2}\S/.test(l) && !/^\s{2}ok\s/.test(l))
    .map((l) => l.trim().slice(0, 110));

let clean = 0;
try {
  for (const [name, mutate] of MUTATIONS) {
    const mutated = mutate(original);
    if (mutated === original) {
      console.log(`!! ${name}: MUTATION DID NOT APPLY — the anchor moved, this row proves nothing`);
      clean++; // a row that proves nothing is not a row that caught something
      continue;
    }
    writeFileSync(SRC, mutated);
    let out = '';
    try {
      out = execSync('node --experimental-transform-types tools/inputcheck.mjs', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    const bad = failing(out).filter((l) => !l.startsWith('C') && !l.startsWith('A') && !l.startsWith('B') && !l.startsWith('D') && !l.startsWith('E'));
    if (bad.length === 0) {
      clean++;
      console.log(`!! ${name}: NOTHING WENT RED — the assertion does not test this`);
    } else {
      console.log(`ok ${name}`);
      for (const b of bad.slice(0, 3)) console.log(`     red: ${b}`);
    }
  }
} finally {
  writeFileSync(SRC, raw);
}
console.log(`\n${MUTATIONS.length} mutations, ${clean} of them caught NOTHING (want 0). Source restored.`);
