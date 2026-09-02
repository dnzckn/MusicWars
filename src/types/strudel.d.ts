/**
 * Hand-written type surface for Strudel 1.2.6 / 1.3.0.
 *
 * The packages ship no .d.ts, and the real API is generated at runtime by
 * `register()`, so nothing can be inferred. This declares only the methods this
 * project actually uses — which is the point: a typo like `.lpfq()` becomes a
 * compile error instead of a silent no-op inside the audio graph, where it
 * would be very hard to notice.
 *
 * Names and semantics were read out of @strudel/core/controls.mjs and
 * superdough/*.mjs rather than from documentation.
 */

declare module '@strudel/core' {
  /*
   * Re-exported from `pattern.mjs` by index.mjs line 19, but absent from the
   * hand-written half of these declarations. Needed to memoise the
   * mini-notation parser — see the note in `src/audio/engine.ts`.
   */
  export function setStringParser(parser: (...strings: string[]) => unknown): void;
  /** Anything accepted where a pattern is expected. Strings go through mini-notation. */
  export type Patternable = number | string | Pattern;

  export interface Pattern {
    // ---- structure / time -------------------------------------------------
    fast(n: Patternable): Pattern;
    slow(n: Patternable): Pattern;
    ply(n: Patternable): Pattern;
    /** Layer a time-shifted copy through a transform. */
    off(t: Patternable, fn: (p: Pattern) => Pattern): Pattern;
    early(t: Patternable): Pattern;
    late(t: Patternable): Pattern;
    rev(): Pattern;
    iter(n: number): Pattern;
    /** Impose a rhythm from a boolean pattern. */
    struct(p: Patternable): Pattern;
    mask(p: Patternable): Pattern;
    euclid(pulses: Patternable, steps: Patternable, rotation?: Patternable): Pattern;
    euclidLegato(pulses: Patternable, steps: Patternable, rotation?: Patternable): Pattern;
    segment(n: Patternable): Pattern;
    superimpose(fn: (p: Pattern) => Pattern): Pattern;
    layer(...fns: ((p: Pattern) => Pattern)[]): Pattern;
    every(n: number, fn: (p: Pattern) => Pattern): Pattern;
    when(test: Patternable | boolean, fn: (p: Pattern) => Pattern): Pattern;
    /**
     * The probability is a PATTERN, not a number — `'0 0.5'` is twice as likely
     * in the second half of the bar as in the first. Widened from `number`
     * when the first stochastic control in this score was written; see
     * `buildBass`'s stutter.
     */
    sometimesBy(prob: Patternable, fn: (p: Pattern) => Pattern): Pattern;
    sometimes(fn: (p: Pattern) => Pattern): Pattern;
    often(fn: (p: Pattern) => Pattern): Pattern;
    rarely(fn: (p: Pattern) => Pattern): Pattern;
    degradeBy(prob: number): Pattern;
    jux(fn: (p: Pattern) => Pattern): Pattern;
    chunk(n: number, fn: (p: Pattern) => Pattern): Pattern;

    // ---- arithmetic -------------------------------------------------------
    add(v: Patternable): Pattern;
    sub(v: Patternable): Pattern;
    mul(v: Patternable): Pattern;
    div(v: Patternable): Pattern;
    round(): Pattern;
    /** Scale a 0..1 pattern into [min,max]. */
    range(min: number, max: number): Pattern;
    /** Exponential variant; correct choice for frequencies. */
    rangex(min: number, max: number): Pattern;

    // ---- pitch ------------------------------------------------------------
    note(v: Patternable): Pattern;
    n(v: Patternable): Pattern;
    freq(v: Patternable): Pattern;
    /** From @strudel/tonal. */
    scale(v: Patternable): Pattern;
    transpose(v: Patternable): Pattern;

    // ---- source -----------------------------------------------------------
    s(v: Patternable): Pattern;
    sound(v: Patternable): Pattern;
    /** Additive partials for the "user" waveform. */
    partials(v: number[]): Pattern;
    noise(v: Patternable): Pattern;
    density(v: Patternable): Pattern;
    /** supersaw: number of stacked voices. */
    unison(v: Patternable): Pattern;
    /** supersaw / pulse: stereo width 0..1. */
    spread(v: Patternable): Pattern;
    /** supersaw: detune in semitones. */
    detune(v: Patternable): Pattern;
    /**
     * pulse only: rate in Hz of the LFO that sweeps the duty cycle.
     *
     * superdough builds it as `getLfo(ac, {frequency: pwrate, depth: pwsweep})`
     * on the pulse worklet's `pulsewidth` parameter (`synth.mjs`), and the two
     * controls default each other in: setting `pwrate` alone gives a sweep of
     * 0.3, setting `pwsweep` alone gives a rate of 1 Hz. Setting neither means
     * a duty cycle that never moves, which is what this score had on the
     * most-heard sound in it. Set BOTH, for the same reason `vib`/`vibmod`
     * must both be set.
     */
    pwrate(v: Patternable): Pattern;
    /** pulse only: depth of the duty-cycle LFO. See `pwrate`. */
    pwsweep(v: Patternable): Pattern;
    /**
     * Vibrato rate in Hz. Registered in `@strudel/core` as
     * `registerControl(['vib', 'vibmod'], 'vibrato', 'v')`, so `.vib()` sets
     * the rate and `.vibmod()` the depth.
     *
     * This is the single most characteristic articulation in the reference
     * canon and the score had none of it. A pulse or triangle held at a fixed
     * frequency is a test tone — the ear hears an oscillator. The same note
     * with a few cents of periodic movement is heard as *sung*, because every
     * physical instrument and voice does it. Its absence is a large part of
     * what makes a chip melody read as synthetic.
     *
     * Useful range is 4.5-6.5Hz. Below 4 it is a wobble, above 8 a trill.
     */
    vib(v: Patternable): Pattern;
    /*
     * Tremolo — amplitude modulation, distinct from `vib` which is pitch.
     *
     * `tremsync` is the rate as a subdivision of the cycle and `tremdepth` the
     * amount. superdough registers them as `tremolosync`/`tremolodepth`
     * (superdough.mjs:199, :598, :796) and Strudel exposes the short aliases;
     * both were checked in node_modules before this declaration was written,
     * because a control that does not exist fails SILENTLY here — which is how
     * `.vibmod()` sat inert in this codebase for its whole life.
     *
     * Depth 0 is no modulation, NOT silence. (An earlier version of this note
     * contrasted it with `distort(0)`, which it said silenced the lane. It does
     * not, in superdough 1.3.0 — measured bit-identical to no distort at all,
     * `docs/research-dubstep.md` §0.1 — so the two behave alike after all.)
     */
    tremsync(v: Patternable): Pattern;
    tremdepth(v: Patternable): Pattern;
    /**
     * Vibrato depth in SEMITONES, not cents — 1.0 is a whole semitone of
     * sweep either way, which is far more than any instrument does.
     *
     * Keep it small: 0.1-0.2 for an ordinary sustained note, up to ~0.4 for a
     * deliberately expressive one. Above ~0.5 the pitch stops being heard as
     * one note and the melody goes out of tune with the harmony under it.
     *
     * Two things confirmed by reading `superdough/helpers.mjs`, both of which
     * would otherwise bite:
     *
     *   - **Nothing happens unless `vib` is also set.** The whole vibrato
     *     oscillator is behind `if (vib > 0)`, so `.vibmod()` alone is silent —
     *     the same failure mode as an undeclared control, and just as quiet.
     *   - **The default depth is 0.5, which is half a semitone.** Setting
     *     `.vib()` and leaving `vibmod` alone gives a 50-cent wobble, far wider
     *     than any instrument. Always set both.
     *
     * The oscillator is wired into the `detune` AudioParam at `vibmod * 100`
     * cents, and it is applied in all three synth paths — the plain oscillator,
     * the pulse branch, and the wavetable one — so `s('pulse')`, `s('triangle')`
     * and `s('sawtooth')` all respond to it.
     */
    vibmod(v: Patternable): Pattern;
    /**
     * Pulse width for `s('pulse')`, and the most important control in the
     * chiptune palette — duty cycle is what separates the three classic NES
     * and Game Boy square timbres from each other.
     *
     * NOTE THE MAPPING, because it is not what the name suggests: superdough's
     * pulse worklet computes duty as `(1 - pw) / 2`. So
     *
     *     pw(0)     -> 50%   hollow, clarinet-ish — harmony and inner voices
     *     pw(0.5)   -> 25%   the workhorse melody/comping timbre
     *     pw(0.75)  -> 12.5% thin, nasal, reedy — counter-melody
     *
     * Thinner duties are also quieter, because the fundamental carries less of
     * the energy: 25% wants about +3dB and 12.5% about +8dB to sit where a
     * 50% pulse did.
     */
    pw(v: Patternable): Pattern;
    fm(v: Patternable): Pattern;
    fmh(v: Patternable): Pattern;

    // ---- amplitude envelope ----------------------------------------------
    attack(v: Patternable): Pattern;
    decay(v: Patternable): Pattern;
    sustain(v: Patternable): Pattern;
    release(v: Patternable): Pattern;
    adsr(v: string): Pattern;
    ad(v: string): Pattern;
    /** decay:sustain — the percussive one. */
    ds(v: string): Pattern;
    ar(v: string): Pattern;
    clip(v: Patternable): Pattern;

    // ---- pitch envelope ---------------------------------------------------
    penv(v: Patternable): Pattern;
    pattack(v: Patternable): Pattern;
    pdecay(v: Patternable): Pattern;
    psustain(v: Patternable): Pattern;
    /** 0 linear, 1 exponential. Use 1 for kicks. */
    pcurve(v: Patternable): Pattern;
    panchor(v: Patternable): Pattern;

    // ---- filters ----------------------------------------------------------
    lpf(v: Patternable): Pattern;
    lpq(v: Patternable): Pattern;
    /** Filter env depth in octaves. */
    lpenv(v: Patternable): Pattern;
    lpattack(v: Patternable): Pattern;
    lpdecay(v: Patternable): Pattern;
    lpsustain(v: Patternable): Pattern;
    lprelease(v: Patternable): Pattern;
    /*
     * The low-pass LFO. This is a genuine AudioWorklet oscillator wired to the
     * filter's frequency param, so it modulates continuously over a held note
     * rather than once per hap — which is the entire difference between a
     * wobble bass and a gated one. See `audio/wobble.ts`.
     */
    /** LFO rate in cycles-per-cycle, so 4 is a quarter-note wobble. */
    lpsync(v: Patternable): Pattern;
    /** LFO rate in Hz. Prefer `lpsync`, which stays locked when tempo moves. */
    lprate(v: Patternable): Pattern;
    /** Sweep width as a multiple of the cutoff: 1.6 sweeps 0.2x to 1.8x. */
    lpdepth(v: Patternable): Pattern;
    /** Sweep width in Hz, instead of `lpdepth`. */
    lpdepthfrequency(v: Patternable): Pattern;
    /** 0 tri, 1 sine, 2 ramp, 3 saw, 4 square. */
    lpshape(v: Patternable): Pattern;
    /** Where the LFO turns around, 0..1. Below 0.5 snaps open, closes slowly. */
    lpskew(v: Patternable): Pattern;
    /** DC offset of the LFO, default -0.5 (centred on the cutoff). */
    lpdc(v: Patternable): Pattern;
    hpf(v: Patternable): Pattern;
    hpq(v: Patternable): Pattern;
    bpf(v: Patternable): Pattern;
    bpq(v: Patternable): Pattern;
    /** '12db' | 'ladder' | '24db'. */
    ftype(v: string): Pattern;
    /** Ladder-filter drive. */
    drive(v: Patternable): Pattern;

    // ---- effects ----------------------------------------------------------
    room(v: Patternable): Pattern;
    roomsize(v: Patternable): Pattern;
    dry(v: Patternable): Pattern;
    delay(v: Patternable): Pattern;
    delaytime(v: Patternable): Pattern;
    delayfeedback(v: Patternable): Pattern;
    /** Delay time in cycles rather than seconds. */
    delaysync(v: Patternable): Pattern;
    distort(v: Patternable): Pattern;
    /**
     * Post-distortion gain (the `:vol` half of the `'amount:vol'` string form),
     * registered in @strudel/core controls.mjs as `distortvol`. Squared by
     * this project's gain curve — see AGENTS.md §4.
     */
    distortvol(v: Patternable): Pattern;
    /**
     * Waveshaper algorithm: 'scurve' (default), 'soft', 'hard', 'cubic',
     * 'chebyshev', 'diode', ... — superdough helpers.mjs. Registered in
     * @strudel/core controls.mjs. `chebyshev` relocates energy up the series
     * and nearly removes the fundamental (docs/research-dubstep.md R3/R4).
     */
    distorttype(v: Patternable): Pattern;
    /**
     * Offsets the random stream this pattern's stochastic functions draw from
     * (@strudel/core signal.mjs). Two lanes calling degradeBy/sometimes at
     * the same cycle get the SAME draw unless seeded apart —
     * docs/research-dubstep.md §0.3, measured.
     */
    seed(n: Patternable): Pattern;
    crush(v: Patternable): Pattern;
    coarse(v: Patternable): Pattern;
    vowel(v: Patternable): Pattern;
    phaser(v: Patternable): Pattern;
    compressor(v: string): Pattern;
    tremolosync(v: Patternable): Pattern;
    tremolodepth(v: Patternable): Pattern;
    tremoloshape(v: Patternable): Pattern;
    tremoloskew(v: Patternable): Pattern;
    /** Phase offset of the tempo-synced tremolo, in cycles of its own rate. */
    tremolophase(v: Patternable): Pattern;

    // ---- routing / levels -------------------------------------------------
    gain(v: Patternable): Pattern;
    velocity(v: Patternable): Pattern;
    postgain(v: Patternable): Pattern;
    pan(v: Patternable): Pattern;
    orbit(v: Patternable): Pattern;
    bus(v: Patternable): Pattern;
    busgain(v: Patternable): Pattern;
    /** Sidechain: duck the given orbit(s) when this pattern triggers. */
    duckorbit(v: Patternable): Pattern;
    duckdepth(v: Patternable): Pattern;
    duckattack(v: Patternable): Pattern;
    duckonset(v: Patternable): Pattern;

    // ---- introspection ----------------------------------------------------
    queryArc(begin: number, end: number, controls?: Record<string, unknown>): Hap[];
  }

  export interface Hap {
    whole?: { begin: { valueOf(): number }; end: { valueOf(): number } };
    part: { begin: { valueOf(): number }; end: { valueOf(): number } };
    value: Record<string, unknown>;
    hasOnset(): boolean;
  }

  export interface Scheduler {
    /** Current position in cycles. Ahead of what is audible by the latency. */
    now(): number;
    cps: number;
    started: boolean;
    setCps(cps: number): void;
    start(): Promise<void>;
    stop(): void;
    pause(): void;
  }

  export interface Repl {
    scheduler: Scheduler;
    setPattern(pattern: Pattern, autostart?: boolean): Promise<Pattern>;
    setCps(cps: number): void;
    start(): void;
    stop(): void;
    pause(): void;
    evaluate(code: string, autostart?: boolean): Promise<unknown>;
  }

  // ---- top-level constructors --------------------------------------------
  export function stack(...pats: Patternable[]): Pattern;
  export function cat(...pats: Patternable[]): Pattern;
  export function slowcat(...pats: Patternable[]): Pattern;
  export function fastcat(...pats: Patternable[]): Pattern;
  export function sequence(...pats: Patternable[]): Pattern;
  export function pure(v: unknown): Pattern;
  export const silence: Pattern;
  /**
   * Lift a number, mini-notation string or Pattern into a Pattern — the
   * runtime export used so a Patternable level can be scaled with .mul()
   * whatever form it arrived in. Verified present in @strudel/core.
   */
  export function reify(thing: Patternable): Pattern;
  /** Re-reads `accessor` on every query — the live-control primitive. */
  export function ref(accessor: () => Pattern | Patternable): Pattern;
  /** Continuous value; `func` receives the query-span start as a Fraction. */
  export function signal(func: (t: { valueOf(): number }, controls?: Record<string, unknown>) => number): Pattern;

  export const sine: Pattern;
  export const saw: Pattern;
  export const tri: Pattern;
  export const square: Pattern;
  export const perlin: Pattern;
  export const rand: Pattern;
  export function irand(n: number): Pattern;
  export function run(n: number): Pattern;

  // ---- controls as free functions -----------------------------------------
  export function note(v: Patternable): Pattern;
  export function n(v: Patternable): Pattern;
  export function s(v: Patternable): Pattern;
  export function sound(v: Patternable): Pattern;
  export function gain(v: Patternable): Pattern;

  export function setTime(fn: () => number): void;
  export function evalScope(...args: unknown[]): Promise<void>;
  export function repl(options: Record<string, unknown>): Repl;

  /**
   * Note name to MIDI number. `'Bb3'` -> 58, `'c'` -> 48 at the default octave.
   *
   * Declared because `renderVoicing` returns note NAMES and everything in
   * `theory.ts` is MIDI integers; this is the one conversion between them.
   */
  export function noteToMidi(name: string, defaultOctave?: number): number;
}

declare module '@strudel/mini' {
  import type { Pattern } from '@strudel/core';
  /** Parse a mini-notation string into a pattern. */
  export function mini(...strings: string[]): Pattern;
  /** Route every bare string through the mini parser. Call once, at module load. */
  export function miniAllStrings(): void;
}

declare module '@strudel/tonal' {
  import type { Pattern, Patternable } from '@strudel/core';
  export function scale(name: Patternable, pat?: Pattern): Pattern;
  export function voicing(pat: Pattern): Pattern;
  export function transpose(v: Patternable, pat?: Pattern): Pattern;
}

/**
 * The iReal chord dictionary, as pure data.
 *
 * `voicings.mjs` does `registerVoicings('ireal', simple)` and
 * `setDefaultVoicings('ireal')`, so this object IS what `dict('ireal')` names
 * and what a bare `.voicing()` uses. Each key is a chord symbol suffix
 * (`'^7'`, `'-7'`, `'h7'`, ...) and each value is a list of alternative
 * voicings written as interval strings (`'1P 5P 7M 10M 12P'`).
 */
declare module '@strudel/tonal/ireal.mjs' {
  /** The default ("simple") iReal dictionary. */
  export const simple: Record<string, readonly string[]>;
  /** The extended iReal dictionary, `dict('ireal-ext')`. */
  export const complex: Record<string, readonly string[]>;
}

/**
 * The pure-function half of Strudel's voicing machinery.
 *
 * `Pattern.voicing()` unwraps a hap and then calls exactly this
 * (`voicings.mjs`). Calling it directly is how `theory.ts` gets a voicing as
 * MIDI numbers without going through a pattern.
 */
declare module '@strudel/tonal/tonleiter.mjs' {
  export function renderVoicing(opts: {
    /** A chord symbol: root plus suffix, e.g. `'A-7'`, `'C#^7'`. */
    chord: string;
    /** Symbol suffix -> alternative voicings, as interval strings. */
    dictionary: Record<string, readonly string[]>;
    /** Shifts the choice up or down the dictionary's list. */
    offset?: number;
    /** If set, returns a single note: the voicing played as a scale. */
    n?: number;
    /**
     * How the voicing is aligned to the anchor.
     * `'below'`/`'duck'` put the TOP note at or under it; `'above'` and
     * `'root'` put the BOTTOM note at or under it, and `'root'` always takes
     * the dictionary's first voicing rather than searching.
     */
    mode?: 'below' | 'duck' | 'above' | 'root';
    /** Note name or MIDI number the voicing is aligned to. */
    anchor?: string | number;
    octaves?: number;
  }): string[];
}

declare module '@strudel/webaudio' {
  import type { Repl } from '@strudel/core';
  export function webaudioRepl(options?: Record<string, unknown>): Repl;
  export function getAudioContext(): AudioContext;
  export function initAudio(options?: Record<string, unknown>): Promise<void>;
  export function registerSynthSounds(): Promise<void> | void;
  export function registerZZFXSounds(): void;
  export function setLogger(fn: (...args: unknown[]) => void): void;
  /** Global remap applied to every gain-like control. */
  export function setGainCurve(fn: (x: number) => number): void;
  export function setMaxPolyphony(n: number): void;
  /**
   * Fire a single voice directly, bypassing the pattern scheduler.
   * `t` is an absolute AudioContext time and must be in the future.
   */
  export function superdough(
    value: Record<string, unknown>,
    t: number,
    hapDuration: number,
    cps?: number,
    cycle?: number,
  ): Promise<void>;
}

/*
 * `@strudel/soundfonts`, IMPORTED BY SUBPATH AND NOT BY PACKAGE NAME.
 *
 * The package root (`dist/index.mjs`) pulls in `sfumato` -> `soundfont2`, whose
 * `module` field is a WEBPACK UMD BUNDLE. Vite serves it to the browser as an
 * ES module, it declares no exports, and the page dies with
 * "does not provide an export named 'SoundFont2'". `sfumato` is the loader for
 * user-supplied .sf2 FILES, which this game does not use; the General MIDI path
 * is `fontloader.mjs` and it imports only @strudel/core and @strudel/webaudio.
 * See the header of `src/audio/soundfonts.ts`.
 *
 * The package declares no `exports` map, so these subpaths are supported
 * imports rather than paths that only happen to resolve.
 */
declare module '@strudel/soundfonts/fontloader.mjs' {
  /**
   * Register all 129 General MIDI names with superdough's sound map. No
   * network: each font is fetched on the first note that needs it.
   */
  export function registerSoundfonts(): void;
  /** Where the `<file>.js` sample bundles are fetched from. Trailing slash off. */
  export function setSoundfontUrl(url: string): void;
  /**
   * Fetch (once per font) and decode (once per pitch) one sample, returning a
   * playable source. Used here to WARM the cache — superdough drops any hap
   * whose handler resolves after its deadline, so a lane must not be switched
   * to a font until every pitch it can play is resident.
   */
  export function getFontBufferSource(
    name: string,
    value: { note?: number | string; freq?: number },
    ac: BaseAudioContext,
  ): Promise<AudioBufferSourceNode>;
}

declare module '@strudel/soundfonts/gm.mjs' {
  /** General MIDI name -> the list of sample-set file names `n` indexes into. */
  const gm: Record<string, string[]>;
  export default gm;
}
