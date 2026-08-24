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
 *    and noise (see `kit.ts`), which also means the game works offline.
 *  - `sync: true` would select a SharedWorker-based clock whose worker file
 *    Vite inlines as a `data:` URL, which Chrome rejects. Never pass it.
 *  - Mini-notation in plain TypeScript requires `miniAllStrings()`; without it
 *    `note('c e g')` is one note literally named "c e g".
 */

import { setTime, type Pattern, type Repl } from '@strudel/core';
import { miniAllStrings } from '@strudel/mini';
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
import { BEATS_PER_BAR, type Transport } from '../core/transport';

// Safe at module load: pure string-parser wiring, no AudioContext, no DOM.
miniAllStrings();

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

    // Quadratic faders. Linear gain sounds wrong when the director rides a
    // layer's level continuously: half the number is nowhere near half as loud.
    setGainCurve((x) => x * x);
    // There is no master limiter anywhere in superdough, and this game stacks
    // ~11 layers with long release tails. Capping polyphony is the cheapest
    // insurance against a pile-up turning into clipping — but too low a cap
    // steals voices from the sustained pad, which is audible as notes cutting
    // out mid-chord.
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
