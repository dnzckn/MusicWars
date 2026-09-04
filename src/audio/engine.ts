/**
 * Strudel boot and transport bridge.
 *
 * Notes that cost real time to discover, kept here so they are not rediscovered:
 *
 *  - `initAudio()` does NOT resume the AudioContext. Its guard reads
 *    `(!audioCtx) instanceof OfflineAudioContext`, which is always false, so the
 *    branch is dead. Without an explicit `resume()` the context stays suspended,
 *    `currentTime` never advances, the scheduler clock never ticks, and you get
 *    total silence with no error at all.
 *  - No samples are loaded by default and none ship with the packages, so
 *    `s("bd")` throws. Every drum in this game is synthesised from oscillators
 *    and noise (see `kit.ts`), which also means the drums work offline. The
 *    PITCHED lanes now fetch General MIDI soundfonts at runtime and fall back
 *    to their oscillators when that fails — see `soundfonts.ts` and the call
 *    to `beginSoundfontLoad` below.
 *  - `sync: true` would select a SharedWorker-based clock whose worker file
 *    Vite inlines as a `data:` URL, which Chrome rejects. Never pass it.
 *  - Mini-notation in plain TypeScript requires `miniAllStrings()`; without it
 *    `note('c e g')` is one note literally named "c e g".
 */

import { setTime, type Pattern, type Repl } from '@strudel/core';
import { mini, miniAllStrings } from '@strudel/mini';
import {
  getAudioContext,
  initAudio,
  registerSynthSounds,
  registerZZFXSounds,
  setGainCurve,
  setLogger,
  setMaxPolyphony,
  webaudioRepl,
} from '@strudel/webaudio';
import { setStringParser } from '@strudel/core';
import { BEATS_PER_BAR, type Transport } from '../core/transport';
import { beginSoundfontLoad } from './soundfonts';

// Safe at module load: pure string-parser wiring, no AudioContext, no DOM.
miniAllStrings();

/*
 * MEMOISE THE MINI-NOTATION PARSER. A frame-time fix, not an audio one.
 *
 * `npm run jank` measures the frame-time TAIL rather than the median, and found
 * p99 60-69ms with a locked 16.7ms median. A CDP allocation profile put
 * essentially all of it in Strudel, the single largest site being
 * `@strudel/mini` at 25% of everything sampled. `mini()` runs a full krill PEG
 * parse on every call, and `miniAllStrings()` installs it as the parser for
 * EVERY string used as a pattern. The score is built almost entirely from
 * string literals, so the same handful are re-parsed continuously, each parse
 * allocating an AST and a pattern tree that is discarded moments later.
 *
 * THIS WAS TRIED ONCE AND SILENTLY DID NOTHING. The first attempt imported
 * `setStringParser` from '@strudel/core/pattern.mjs' because the package's
 * hand-written type declarations were missing it. That deep path resolves to a
 * DIFFERENT module instance from the one `@strudel/mini` mutates, so the
 * override was installed on a copy nobody reads: counters showed parses 0,
 * hits 0, size 0 while the frame numbers moved by less than noise and could
 * have been read either way. index.mjs line 19 does `export * from
 * './pattern.mjs'`, so the package index has it and only the TYPE was absent —
 * which is now declared instead of routed around.
 *
 * WHY CACHING IS SAFE. A Strudel pattern is a pure function of a time span, and
 * every operator returns a NEW pattern rather than mutating the receiver, so
 * two call sites handed the same parsed pattern cannot observe each other. If
 * that ever stopped being true the symptom would be one lane inheriting
 * another's controls, which `wiring` and `stemprobe` both watch for.
 *
 * The cache is unbounded deliberately: the keys are the score's own string
 * literals plus the small set the director generates, so the population is
 * bounded by the source rather than by the run.
 */
const miniCache = new Map<string, unknown>();
let miniParses = 0;
let miniHits = 0;

setStringParser((...strings: string[]) => {
  const key = strings.length === 1 ? strings[0] : strings.join('|~|');
  const hit = miniCache.get(key);
  if (hit !== undefined) {
    miniHits++;
    return hit;
  }
  miniParses++;
  const pat = mini(...strings);
  miniCache.set(key, pat);
  return pat;
});

/** Parser-cache counters. A cache that never fires must be visible as one. */
export function miniCacheStats(): { parses: number; hits: number; size: number } {
  return { parses: miniParses, hits: miniHits, size: miniCache.size };
}

export type AudioStatus = 'idle' | 'booting' | 'running' | 'failed';

let repl: Repl | null = null;
let booting: Promise<Repl> | null = null;
let status: AudioStatus = 'idle';

export function audioStatus(): AudioStatus {
  return status;
}

/**
 * Must be called from inside a real user gesture. Idempotent: repeated calls
 * return the same promise.
 *
 * Strudel's own `initAudioOnFirstClick` listens for `mousedown` only, which a
 * keyboard-driven title screen never fires, so we do the unlocking ourselves.
 */
export function bootAudio(bpm: number): Promise<Repl> {
  /*
   * A FAILED boot is not remembered; a successful one is.
   *
   * `if (booting) return booting` memoises the promise, which is right for the
   * success path — two clicks must not build two contexts. It also memoised
   * REJECTION: one transient failure (a context that would not resume because
   * the gesture was consumed elsewhere, a device that was busy for a moment)
   * was permanent for the life of the page. Every later press of START handed
   * back the same rejected promise, and a game whose entire premise is that
   * the fight writes the music played in total silence with no way back short
   * of a reload.
   *
   * Retrying is safe: the body below creates the context synchronously and
   * `status` gates the rest, so a second attempt after a failure starts clean.
   */
  if (booting && status !== 'failed') return booting;
  status = 'booting';

  /*
   * Create and resume the context SYNCHRONOUSLY, before any await.
   *
   * Safari — and iOS Safari especially — only honours `resume()` while the
   * call stack is still inside the user gesture that triggered it. The first
   * `await` spends that token, so resuming afterwards can be rejected with no
   * error surfaced: the context stays suspended, `currentTime` never advances,
   * and the game runs in total silence. This code previously awaited
   * `initAudio()` first, which is exactly that mistake.
   *
   * The promise is captured and awaited later; only the *call* has to be
   * synchronous.
   */
  const ctx = getAudioContext();
  const resumed = ctx.resume().catch(() => undefined);

  booting = (async () => {
    // Strudel logs every evaluation to the console; the game has its own HUD.
    setLogger(() => {});

    await resumed;
    await initAudio();
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);

    await registerSynthSounds();
    registerZZFXSounds();

    /*
     * REAL INSTRUMENTS, FETCHED, AND DELIBERATELY NOT AWAITED.
     *
     * `src/audio/soundfonts.ts` explains the whole mechanism. What matters at
     * this call site is the ORDER and the absence of an `await`:
     *
     *   - It runs after the context is resumed, because the warm-up decodes
     *     samples and needs one. It does not need a RUNNING context — decoding
     *     works on a suspended one — but this is the first point where the
     *     context is certainly built and the gesture is certainly spent.
     *   - It is not awaited, so START still starts the music within a frame.
     *     Every lane plays the oscillator it always played until its samples
     *     are resident, then one rebuild swaps them in. A 300 ms wait on a
     *     title screen is a bug report; 300 ms of the old score is not.
     *   - It cannot reject. Every failure path inside resolves to a report
     *     with the failed roles marked, and those lanes keep their oscillator.
     *     `.catch` is here only because an unhandled rejection would be logged
     *     even from a promise nobody reads.
     */
    void beginSoundfontLoad(ctx).catch((err: unknown) => {
      console.warn('[audio] soundfonts unavailable; every lane keeps its oscillator', err);
    });

    // Quadratic faders. Linear gain sounds wrong when the director rides a
    // layer's level continuously: half the number is nowhere near half as loud.
    setGainCurve((x) => x * x);
    // There is no master limiter anywhere in superdough, and this game stacks
    // ~11 layers with long release tails. Capping polyphony is the cheapest
    // insurance against a pile-up turning into clipping — but too low a cap
    // steals voices from the sustained lanes (the sub, the lead's open tail;
    // the chords pad, when there was one), audible as notes cutting out.
    setMaxPolyphony(96);

    const r = webaudioRepl({ audioContext: ctx, sync: false });
    setTime(() => r.scheduler.now());
    r.setCps(bpm / 60 / BEATS_PER_BAR);

    repl = r;
    status = 'running';
    return r;
  })();

  booting.catch((err) => {
    status = 'failed';
    // Drop the rejected promise so the next attempt builds a fresh one rather
    // than re-serving this failure. See the note at the top of this function.
    booting = null;
    console.error('[audio] boot failed', err);
  });

  return booting;
}

export function getRepl(): Repl | null {
  return repl;
}

/** Install the master pattern. Called exactly once per run. */
export function playPattern(pattern: Pattern): void {
  void repl?.setPattern(pattern, true);
}

/** Pause playback, keeping the transport position. Use this for the pause key. */
export function pauseAudio(): void {
  repl?.pause();
}

export function startAudio(): void {
  repl?.start();
}

export function setTempo(bpm: number): void {
  repl?.setCps(bpm / 60 / BEATS_PER_BAR);
}

/**
 * True when the browser has suspended the context out from under us.
 *
 * Mobile browsers suspend audio when a tab is backgrounded, on a call, or when
 * the ringer switch is flipped, and they do not resume on their own. The game
 * has to notice and offer a way back.
 */
export function audioSuspended(): boolean {
  if (!repl) return false;
  try {
    return getAudioContext().state !== 'running';
  } catch {
    return false;
  }
}

/** Attempt a resume. Must be called from inside a user gesture to be reliable. */
export function resumeAudio(): void {
  if (!repl) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  } catch {
    // Nothing useful to do; the HUD will keep showing the state.
  }
}


/**
 * Pull the game transport onto Strudel's clock. One cycle is one bar.
 * Called every frame; `Transport` smooths the correction internally.
 */
/*
 * Note for anyone syncing to this clock: Cyclist runs a fixed ~0.2s of lookahead
 * plus trigger latency, so `scheduler.now()` reports the position being
 * *queried*, not the one being *heard*. Anything drawn or fired "on the beat"
 * from it is that far ahead of the audio.
 */
export function syncTransport(t: Transport): void {
  if (!repl || !repl.scheduler.started) return;
  const cycle = repl.scheduler.now();
  if (!Number.isFinite(cycle)) return;
  /*
   * Ignore negative cycles.
   *
   * Cyclist computes `now()` as `lastBegin + (audioTime - lastTick - tickLen) *
   * cps`, and before its first tick `lastTick` is still 0 — so it reports a
   * position *behind* zero. Snapping the transport onto that made a fresh run
   * start at bar -1 and spend a second and a half climbing back to the
   * downbeat, which the player experiences as dead air after pressing start.
   */
  if (cycle < 0) return;
  t.syncToCycle(cycle);
}
