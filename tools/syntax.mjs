/*
 * syntax — a parse-only check of the TypeScript sources, in about a second.
 *
 * WHY, given `npm run typecheck` exists and is stricter: because on this
 * machine `tsc --noEmit` regularly does not finish. It reads the whole source
 * tree plus the TypeScript lib files to build a Program, and during an I/O
 * stall (see `tools/README.md`) that runs past twenty minutes or never returns.
 * A gate that cannot be run is not a gate, and the temptation when it times out
 * is to land the edit unverified — which is how a call to an undeclared control
 * like `.pw()` or `.vib()` reaches a lane and silently compiles to nothing.
 *
 * HOW: `module.stripTypeScriptTypes()` — the exact transform Node runs when it
 * loads a `.ts` file — so this needs no parser dependency at all. That matters:
 * this repo is on TypeScript 7, the native Go port, whose ESM surface no longer
 * exposes `createSourceFile` or any of the JS compiler API — `import ts from
 * 'typescript'` yields an object with `version` on it and nothing else.
 *
 * IT ALSO CHECKS THAT EACH FILE CAN BE LOADED, not merely parsed, and those are
 * different things. This used to shell out to `node --check`, which parses a
 * `.ts` file but never runs the erasability transform. A TypeScript PARAMETER
 * PROPERTY (`constructor(private riseAt: number)`) parses perfectly and cannot
 * be stripped — the feature emits an assignment, so there is no type to erase
 * down to — and Node refuses the file at load with
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. The same is true of `enum`, `const enum`
 * and `namespace`.
 *
 * So this gate printed "35 files parsed, no errors" in the same run in which
 * `session` died on `core/math.ts`. That is the failure mode this project keeps
 * finding: a measurement reporting confidently on something it was not looking
 * at. Calling the real transform closes it, because the question the tool now
 * asks is the same question Node asks.
 *
 * It is also strictly faster: the transform runs in-process, so a check that
 * was ~35 process spawns is now none — which matters on a box whose disk
 * stalls (see `tools/README.md`).
 *
 * `erasableSyntaxOnly` in `tsconfig.json` enforces the same rule at the type
 * level. That is the authority; this is the copy that still runs when `tsc`
 * will not finish.
 *
 * WHAT IT CANNOT CATCH, so a pass is never mistaken for a typecheck: unknown
 * properties, wrong argument types, undeclared identifiers, missing imports,
 * unused variables. `.vib(5.1)` on a Pattern with no `vib` declared parses
 * perfectly. This catches the class an automated edit actually introduces —
 * unbalanced braces, a broken method chain, a stray comma, a half-applied
 * replacement. Run `npm run typecheck` when the box allows; run this when not.
 *
 * Usage: `node tools/syntax.mjs [paths...]`  (default: src)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const EXT = /\.(ts|tsx|mts)$/;
// Node's type stripping only handles erasable syntax. `.d.ts` files are all
// declaration and produce an empty program, so checking them proves nothing.
const SKIP = /\.d\.ts$/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name) && !SKIP.test(name)) out.push(p);
  }
  return out;
}

const args = process.argv.slice(2);
const targets = args.length ? args : ['src'];
const files = targets.flatMap((t) => {
  const p = join(ROOT, t);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const check = (file) => {
  try {
    // `mode: 'strip'` is what Node itself uses for a `.ts` import. Anything it
    // refuses here is a file Node would refuse to load.
    stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip', fileName: file });
    return null;
  } catch (err) {
    return { file, code: err?.code ?? '', message: String(err?.message ?? err).split('\n')[0] };
  }
};

const failures = files.map(check).filter(Boolean);

for (const f of failures) {
  console.log(`  ${relative(ROOT, f.file)}\n    ${f.message}`);
  if (f.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX') {
    console.log(
      '    ^ parses fine, but cannot be LOADED by the headless tools. Rewrite it\n' +
        '      erasably: an explicit field instead of a parameter property, an\n' +
        "      `as const` object instead of an `enum`.",
    );
  }
}

console.log(
  failures.length === 0
    ? `syntax — ${files.length} files parse and strip cleanly`
    : `\nsyntax — ${failures.length} file(s) failed of ${files.length}`,
);
console.log('  Parse-only; it does not check types. Use `npm run typecheck` for that.');
process.exit(failures.length === 0 ? 0 : 1);
