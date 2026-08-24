/**
 * The grammar of a synthesised ability id.
 *
 * A duet or a generic union has no entry in any source table — its id is built
 * at runtime from its two parents (`pizzicato+snare`), and anything that wants
 * to know what such an id MEANS has to take it apart again. That happens in
 * three layers now: `game/` decides what may combine, `render/` describes it,
 * and `audio/` has to work out which lanes it plays.
 *
 * It lives in `core/` because `audio/` needed it and `audio/` and `game/` do
 * not import each other — a dependency edge from the score to the rules, for
 * the sake of one string split, is a bad trade. The alternative was a second
 * copy of the parsing, and this repo has already paid twice for a duplicated
 * rule that drifted from its original (see `readyFusions`, which exists in
 * both `game/progression.ts` and `render/levelup.ts` and is pinned together by
 * `tools/mirror.mjs`). One definition, imported by everyone.
 *
 * `game/weapons.ts` re-exports all three so existing call sites are unchanged.
 */

/**
 * The separator, and the reason a bare `indexOf` is safe.
 *
 * No ability id contains it, so the FIRST occurrence always splits a duet into
 * its two parents. A duet of duets would break that, which is exactly why
 * `readyDuets` refuses to make one.
 */
export const DUET_SEP = '+';

/** Canonical id for the duet of two instruments, order-independent. */
export function duetId(a: string, b: string): string {
  return a < b ? `${a}${DUET_SEP}${b}` : `${b}${DUET_SEP}${a}`;
}

/** The two parents of a duet id, or null if this is not one. */
export function duetParents(id: string): [string, string] | null {
  const i = id.indexOf(DUET_SEP);
  if (i <= 0) return null;
  return [id.slice(0, i), id.slice(i + 1)];
}
