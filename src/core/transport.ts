/**
 * The shared musical clock.
 *
 * Both halves of the game read this. The music director writes tempo into it;
 * enemy emitters read `beat` out of it so their volleys land on the grid. That
 * closes the loop: the battlefield writes the music, and the music times the
 * battlefield.
 *
 * It free-runs off wall time by default so the simulation never blocks on
 * audio. When Strudel is alive, `syncToCycle()` gently pulls it onto the audio
 * clock instead of snapping, because a hard correction would make a whole
 * screen of bullets jump.
 */

import { clamp } from './math';

/** Beats per bar. Everything here assumes 4/4, which is fair for EDM. */
export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 8;

export class Transport {
  /** Continuous position in quarter-note beats since the transport started. */
  beat = 0;
  bpm = 128;
  running = false;

  /** Set when an external (audio) clock is driving us. */
  private slaved = false;
  /** Beats of correction still to be smeared in. */
  private drift = 0;

  private lastBeat = 0;

  get bar(): number {
    return this.beat / BEATS_PER_BAR;
  }

  get phrase(): number {
    return this.bar / BARS_PER_PHRASE;
  }

  /** Position within the current bar, 0..1. */
  get barPhase(): number {
    const b = this.beat / BEATS_PER_BAR;
    return b - Math.floor(b);
  }

  /** Position within the current phrase, 0..1. */
  get phrasePhase(): number {
    const p = this.phrase;
    return p - Math.floor(p);
  }

  /** Cycles-per-second, the unit Strudel thinks in (1 cycle == 1 bar here). */
  get cps(): number {
    return this.bpm / 60 / BEATS_PER_BAR;
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  reset(): void {
    this.beat = 0;
    this.lastBeat = 0;
    this.drift = 0;
    this.slaved = false;
  }

  setBpm(bpm: number): void {
    this.bpm = clamp(bpm, 40, 260);
  }

  /**
   * Advance the free-running clock. Always called, even when slaved: the audio
   * clock only arrives in ~50ms chunks, so we interpolate between corrections.
   */
  advance(dt: number): void {
    if (!this.running) return;
    this.lastBeat = this.beat;
    let step = (this.bpm / 60) * dt;
    if (this.drift !== 0) {
      // Smear the correction over roughly a quarter second, capped so we never
      // run backwards (which would re-fire beat-synced emitters).
      const fix = clamp(this.drift * 0.25, -step * 0.5, step * 0.5);
      step += fix;
      this.drift -= fix;
    }
    this.beat += step;
  }

  /** Called by the audio engine with Strudel's authoritative cycle position. */
  syncToCycle(cycle: number): void {
    const target = cycle * BEATS_PER_BAR;
    const delta = target - this.beat;
    if (!this.slaved || Math.abs(delta) > BEATS_PER_BAR * 2) {
      // First sync, or we drifted more than two bars (tab was backgrounded):
      // snapping is less bad than a very long smear.
      this.beat = target;
      this.lastBeat = target;
      this.drift = 0;
      this.slaved = true;
      return;
    }
    this.drift = delta;
  }

  /**
   * How many boundaries of `1/div` beats were crossed by the last `advance()`.
   * `div = 1` is quarter notes, `4` is sixteenths, `0.25` is bars.
   */
  crossings(div: number): number {
    const a = Math.floor(this.lastBeat * div);
    const b = Math.floor(this.beat * div);
    return Math.max(0, b - a);
  }

  /**
   * Beats added by the last `advance()`, drift correction included.
   *
   * Exposed for the level-up pause: the world stops while the transport does
   * not, so anything scheduled against the absolute beat has to be pushed
   * forward by exactly this much or it comes due all at once on resume. Read
   * it in the same frame as the `advance()` it describes.
   */
  get lastStep(): number {
    return this.beat - this.lastBeat;
  }

  /** True if a bar line was crossed by the last `advance()`. */
  crossedBar(): boolean {
    return this.crossings(1 / BEATS_PER_BAR) > 0;
  }

  crossedPhrase(): boolean {
    return this.crossings(1 / (BEATS_PER_BAR * BARS_PER_PHRASE)) > 0;
  }

  /** Beats remaining until the next bar line. */
  beatsToNextBar(): number {
    return BEATS_PER_BAR - (this.beat % BEATS_PER_BAR);
  }

  /** Seconds remaining until the next bar line, at the current tempo. */
  secondsToNextBar(): number {
    return (this.beatsToNextBar() * 60) / this.bpm;
  }

  secondsPerBeat(): number {
    return 60 / this.bpm;
  }
}
