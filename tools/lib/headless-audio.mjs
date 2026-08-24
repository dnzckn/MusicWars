/**
 * Import the SCORE — `src/audio/*` — into Node, with no browser and no
 * Web Audio, and query the patterns it builds.
 *
 * WHY THIS IS POSSIBLE AT ALL, because `tools/lib/tsnode.mjs` states the
 * opposite in its own header ("it can say nothing whatever about whether the
 * music is right") and that claim was about the game simulation, not about
 * Strudel. A Strudel `Pattern` is a pure function from a timespan to a list of
 * events. Querying one — `pattern.queryArc(0, 4)` — is arithmetic over plain
 * objects. Web Audio is needed to *hear* a pattern, never to *ask what notes it
 * contains*. Everything the builders decide (which pitches, in which register,
 * on which beats, with which controls attached) is therefore measurable here.
 *
 * What is NOT measurable, and the distinction is the whole value of the tool:
 * anything downstream of the note. Gain staging, filter response, whether two
 * lanes mask each other, whether the mix is loud — those need `audiocheck` and
 * a real destination node. This answers "did the builder emit the notes it was
 * designed to emit", which is exactly the class of bug that a silently-dropped
 * control or a broken mini-notation string produces, and exactly the class no
 * amount of reading catches with confidence.
 *
 * TWO SHIMS ARE NEEDED.
 *
 * 1. `@kabelsalat/web`. Importing `@strudel/core` pulls `repl.mjs`, which
 *    imports `SalatRepl` from a browser-only build, and the import throws
 *    before any of the pattern code loads. Nothing in the score touches the
 *    REPL, so it is stubbed. This is a shim for a packaging detail, not a stub
 *    of anything under test.
 *
 * 2. `tsnode.mjs` for TypeScript and for the extensionless relative imports
 *    that Vite resolves in the browser build.
 *
 * Import this module for its side effects, BEFORE importing anything from
 * `src/audio/`, or `@strudel/core` will already have failed.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@kabelsalat/web') {
      return {
        url: 'data:text/javascript,export class SalatRepl%20%7B%7D',
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

// After the stub, so the TS loader's own resolution sits underneath it.
await import('./tsnode.mjs');

/*
 * Turn every string into mini-notation, exactly as `src/audio/engine.ts` does
 * at startup. This is not optional decoration — it is the difference between a
 * harness that measures the score and one that silently measures nothing.
 *
 * Without it, `note('57 60 64 69')` does not parse. Strudel takes the string as
 * a single atomic value, and the pattern yields ONE event whose `note` is the
 * literal text "57 60 64 69". Every numeric assertion downstream then reads
 * `NaN`, skips the event as unparseable, and the check passes with nothing
 * tested. That is precisely what happened on this harness's first run:
 * `motorcheck` reported 1760 states green while examining, in effect, no notes
 * at all.
 *
 * So: any tool that queries a builder must call this, and any tool whose note
 * count looks implausibly low has probably lost it.
 */
const { miniAllStrings } = await import('@strudel/mini');
miniAllStrings();

/**
 * A `Signals` stand-in.
 *
 * The real ones are `signal(() => this.p.openness)` and friends — live reads
 * off the director, re-evaluated per hap. Here each is pinned to a constant so
 * a query is deterministic, which is what makes an assertion meaningful. Pass
 * overrides to place the score in a particular state.
 *
 * A Proxy rather than a fixed record on purpose: `Signals` has gained fields
 * three times during this refactor (`register`, `arpOctave`, `colour7`...), and
 * a harness that has to be edited every time one is added is a harness that
 * stops being run.
 */
/*
 * NOT every signal is a 0..1 control, and defaulting them all to 0.5 is wrong
 * in a way that silently corrupts results.
 *
 * `register` and `arpOctave` are TRANSPOSITIONS IN SEMITONES — the director
 * feeds them 0 or 12, and 0 or -12. Handing them 0.5 detunes a whole lane by
 * half a semitone against everything else, which does not merely add noise: it
 * manufactures the exact close-interval collisions that `masking.mjs` exists to
 * count. A harness that invents the defect it is measuring is worse than none.
 *
 * So transposition signals default to 0 (no shift) and everything else to 0.5
 * (mid-range). Anything added to `Signals` in semitones must be listed here.
 */
const SEMITONE_SIGNALS = new Set(['register', 'arpOctave']);

/*
 * Signals whose OFF state is 0, not mid-range.
 *
 * `space`, `ring` and `hold` are the REVERB, RESONANCE and FERMATA rig
 * abilities. Unlike tension or openness, which always have some value, these
 * are additive effects that do not exist unless the player is holding the
 * ability — so the mid-range fallback would build every lane in every tool as
 * though half a rig were equipped, and quietly move the baseline of `masking`,
 * `session` and everything else that renders a default mix.
 *
 * The rule: a signal belongs here if 0 means "the score as written".
 */
const OFF_AT_ZERO = new Set(['space', 'ring', 'hold']);

export function makeSignals(strudel, overrides = {}) {
  const { signal } = strudel;
  const cache = new Map();
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!cache.has(prop)) {
          const fallback = SEMITONE_SIGNALS.has(prop) || OFF_AT_ZERO.has(prop) ? 0 : 0.5;
          const v = overrides[prop] ?? fallback;
          cache.set(prop, signal(() => v));
        }
        return cache.get(prop);
      },
      has: () => true,
    },
  );
}

/**
 * Every note event a pattern produces over `cycles`, as plain data.
 *
 * `queryArc` returns haps whose `value` is the merged control object — the
 * union of everything the builder chained on, so `s`, `pw`, `vib`, `gain` and
 * the rest are all inspectable alongside the pitch.
 */
export function notesIn(pattern, cycles = 1, from = 0) {
  return pattern
    .queryArc(from, from + cycles)
    .filter((h) => h.hasOnset?.() ?? true)
    .map((h) => ({
      begin: h.whole?.begin?.valueOf?.() ?? Number(h.part.begin),
      end: h.whole?.end?.valueOf?.() ?? Number(h.part.end),
      ...h.value,
    }))
    .sort((a, b) => a.begin - b.begin);
}

/** Pitch class 0-11 of a MIDI number, always non-negative. */
export const pc = (midi) => ((Math.round(midi) % 12) + 12) % 12;
