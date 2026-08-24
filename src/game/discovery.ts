/**
 * What the player has ever made, across runs.
 *
 * The fusion tree is the deepest system in the game — twelve authored
 * evolutions and two named unions, each with its own result and its own line —
 * and every trace of it vanished when the run ended. A player who spent a
 * fifteen-minute run assembling CARILLON had nothing afterwards to say they
 * had, and no way to know that eleven others exist. Both games this one is
 * fusing keep a collection for exactly that reason: it is what turns "that run
 * went well" into "I have not made STRING SECTION yet".
 *
 * Deliberately only the AUTHORED recipes. Generic duets and unions are
 * combinatorial — 157 of them — and a counter that reads "9 of 157" is a chore
 * rather than a goal. Fourteen is a number a player can hold in their head and
 * finish.
 *
 * The set logic lives here rather than in `main.ts` so it can be tested without
 * a browser; the only thing the caller supplies is storage.
 */
import { FUSIONS, labelOf } from './weapons';

/** Every result a player can collect, in table order. */
export const DISCOVERABLE: readonly string[] = FUSIONS.map((f) => f.result);

export interface Discovery {
  found: number;
  total: number;
  /** Results not yet made, in table order. */
  missing: string[];
}

/**
 * Fold an id into the set.
 *
 * Returns whether it was NEW, so the caller can celebrate a first discovery
 * without having to diff the set itself. Unknown ids — a synthesised duet, a
 * stale save from an older table — are ignored rather than stored, so the
 * counter can never exceed its own total.
 */
export function record(seen: Set<string>, id: string): boolean {
  if (!DISCOVERABLE.includes(id) || seen.has(id)) return false;
  seen.add(id);
  return true;
}

export function summary(seen: ReadonlySet<string>): Discovery {
  const missing = DISCOVERABLE.filter((id) => !seen.has(id));
  return { found: DISCOVERABLE.length - missing.length, total: DISCOVERABLE.length, missing };
}

/**
 * The collection, as rows to draw.
 *
 * A count alone is a scoreboard, not a collection: "7 of 14" tells a player
 * they are missing seven and nothing about which, or how any of them is made.
 * Both games this borrows from show the grid, and the grid is what turns the
 * number into a plan.
 *
 * A DISCOVERED row gives up its recipe; an undiscovered one gives up nothing
 * but its existence. That asymmetry is the whole design — knowing that
 * fourteen exist is the hook, and learning `pizzicato + capo` by having done
 * it once is the reward. Printing every recipe up front would hand over the
 * tree and delete the discovery; printing nothing would leave the count
 * meaningless.
 */
export interface CodexRow {
  /** The result id, or null when it has not been made. */
  id: string | null;
  /** What to show as the name: the label, or a placeholder. */
  label: string;
  /** The recipe, once earned. Empty until then. */
  recipe: string;
  found: boolean;
}

export function codex(seen: ReadonlySet<string>): CodexRow[] {
  return FUSIONS.map((f) => {
    const found = seen.has(f.result);
    return {
      id: found ? f.result : null,
      label: found ? labelOf(f.result) : '???',
      // The kind is safe to show either way: it says how deep in the tree a
      // thing sits without saying what it is or what makes it.
      recipe: found ? `${labelOf(f.base)} + ${labelOf(f.catalyst)}` : f.kind === 'union' ? 'a union of two evolutions' : 'an evolution',
      found,
    };
  });
}

/** One line for the title screen. Names the next thing to aim at, if any. */
export function discoveryLine(seen: ReadonlySet<string>): string {
  const { found, total, missing } = summary(seen);
  if (found === 0) return `${total} arrangements to discover`;
  if (found === total) return `all ${total} arrangements discovered`;
  return `${found} of ${total} arrangements discovered · ${labelOf(missing[0])} still unmade`;
}

/*
 * Storage is separated from the logic above so a private-browsing failure
 * degrades to "nothing discovered yet" rather than taking the title screen
 * down with it. Everything above is pure and testable; only these two touch
 * the browser.
 */
const KEY = 'musicwars.discovered';

export function loadDiscovered(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const ids: unknown = JSON.parse(raw);
    // Filtered on load as well as on record: a table can lose an entry between
    // versions, and a saved id that no longer exists must not inflate the count.
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string' && DISCOVERABLE.includes(x)) : []);
  } catch {
    return new Set();
  }
}

export function saveDiscovered(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    // Nothing to do; the run still counted for the player who played it.
  }
}
