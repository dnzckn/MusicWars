/**
 * The sampled drum kit: nine drum-machine one-shots, fetched at runtime, with
 * the oscillator kit in `kit.ts` as the fallback.
 *
 * ---------------------------------------------------------------------------
 * WHY A SAMPLED KIT AT ALL
 * ---------------------------------------------------------------------------
 *
 * The owner's word on 2026-09-04 was "music still needs to be a lot better,
 * sounds cheapy", with four references pasted (`scratchpad/refs/references.md`).
 * Every one of them plays its drums from a sampled drum machine — TR909,
 * TR808, LinnDrum, Strudel's default kit — and the score's kit was one white-
 * noise generator at 30-34 haps a bar (`scratchpad/cheap/reports/audit.md`
 * §3): measured over the 32-bar capture, `white×991` against
 * `gm_electric_bass_finger×28`, 98.9% oscillators and noise. The kit is the
 * densest lane in the score and the one the references disagree with most.
 *
 * `kit.ts`'s header says "Strudel ships no samples and loads none at boot",
 * which is still true, and it lists the reasons the oscillator kit was a
 * feature: no assets, works offline, every drum parameterised. All three
 * survive: this file adds a network kit ON TOP of the oscillator one, with
 * the same rule `soundfonts.ts` enforces for the pitched lanes — the
 * oscillator plays until the samples are resident, and forever if they never
 * are.
 *
 * ---------------------------------------------------------------------------
 * THE MECHANISM, read out of `superdough` 1.3.0 and measured in the page
 * (`scratchpad/cheap/reports/samples.md` §3d, all four rows)
 * ---------------------------------------------------------------------------
 *
 *   - `samples(map, base)` (`superdough/sampler.mjs:249-263`) registers each
 *     name SYNCHRONOUSLY and fetches nothing: `getSound('mwkick')` was truthy
 *     0.3 ms after the call with zero requests on the wire.
 *   - `loadBuffer(url, ac, name, n)` (`sampler.mjs:86-105`, exported from
 *     `superdough/index.mjs:8`) fetches and decodes one file and caches the
 *     PROMISE (`sampler.mjs:92`), so a failed URL is failed for the life of
 *     the page: a 404 rejected in 336 ms the first time and 0.10 ms the
 *     second. `getLoadedBuffer(url)` (`sampler.mjs:116`) is truthy only after
 *     the decode.
 *   - A hap whose buffer is not resident is DROPPED, twice: `sampler.mjs:297-
 *     302` returns when `ac.currentTime > t` after the await, and
 *     `superdough.mjs:580` does it again. Both log through `logger`, which
 *     `engine.ts:150` has silenced, so a stuck load prints nothing.
 *
 * So the rule is the one at `soundfonts.ts:107-113`: NEVER emit a sample name
 * before every buffer it could need is resident. `kitReady()` is the one
 * switch, it goes true only when all nine URLs have `getLoadedBuffer` truthy,
 * and `Director.structureKey` names `kitGeneration()` so the promotion lands
 * as one rebuild rather than whenever something else forces one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MAP IS INLINED AND NOT FETCHED
 * ---------------------------------------------------------------------------
 *
 * Strudel's REPL loads `tidal-drum-machines.json` (684 keys, 14 KB gzipped)
 * and then the wavs on first use. Measured cold in a fresh Chromium
 * (`samples.md` §5): the JSON took **2,830 ms** and the eight wavs 127 ms as
 * a batch. The JSON is the long pole and it carries 675 entries this game
 * will never play; nine URLs in source cost nothing and remove that request
 * entirely. The cold-#2 row of the same table — new context, sockets shared —
 * had the whole kit resident at 225 ms, which is what an inlined map buys.
 *
 * The rejected alternative was fetching the JSON so that the names would not
 * exist offline (`samples()` rejects and nothing registers). Safer in one
 * narrow way, and it puts a 2.8 s request on the critical path of every cold
 * start. The gate here (`kitReady`) makes the offline case identical to the
 * "still loading" case, which the pitched lanes already live with.
 *
 * ---------------------------------------------------------------------------
 * WHICH NINE, and why these variants
 * ---------------------------------------------------------------------------
 *
 * Reference B (`references.md`, script B) is `<bd>*4, <- sd>*4, <- cp:3>*4`
 * on the TR909, `<- hh>*8` on the LinnDrum and `<sh>*8` on the TR808 — three
 * machines layered. The kit below is that, plus a 909 open hat, a 909 rim for
 * the ghost notes and an 808 kick to sit under the 909 on half-time bars.
 *
 * The variants are the SMALLEST of each (`samples.md` §3c): Strudel's `n=0`
 * picks would be 502,392 B (the 909's `Bassdrum-01` alone is 82 KB, its
 * `Clap` 136 KB); these nine are 266,688 B. Every name and size below was
 * confirmed on 2026-09-05 by fetching the drum-machine JSON once and HEADing
 * each file on the CDN — all 200, `access-control-allow-origin: *`, 20-69 ms
 * each — so `tools/kitcheck.mjs` can HEAD them again and compare. `n` is the
 * index in that JSON's array, recorded so a `.bank()` user can find the same
 * file; the game does not use it.
 *
 * `Hat%20Closed-03.wav` is stored already percent-encoded. `loadBuffer` only
 * escapes `#`, and the URL is built by plain string concatenation
 * (`sampler.mjs:158`, `baseUrl + v`), so the space would be handed to
 * `fetch` raw; browsers and Node both tolerate that, but the encoded form
 * is what was measured and is the same bytes on the wire either way.
 *
 * ---------------------------------------------------------------------------
 * WHY NODE AND THE BROWSER START IN DIFFERENT STATES
 * ---------------------------------------------------------------------------
 *
 * Same argument as `soundfonts.ts:116-130`, and it is not restated at length:
 * the WRITTEN score is the sampled kit, Node reads it as written so that every
 * gate measures the kit the player is meant to hear, and the browser is the
 * only place that downgrades — from measurement, starting at `loading`.
 * `MUSICWARS_KIT=fallback` runs any node gate against the oscillator kit, and
 * `tools/kitcheck.mjs` queries the drum builders in both modes.
 *
 * MEASURED: the mechanism rows above, the byte counts, and the cold/warm
 * timings. NOT MEASURED: what any of it sounds like. Nobody has heard it.
 */

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

export type KitName =
  | 'mw_bd909'
  | 'mw_sd909'
  | 'mw_cp909'
  | 'mw_hh909'
  | 'mw_oh909'
  | 'mw_rim909'
  | 'mw_sh808'
  | 'mw_bd808'
  | 'mw_hhlinn';

export interface KitSample {
  /** The name `s()` uses. Prefixed so it can never collide with a synth. */
  readonly name: KitName;
  /** Path under a base URL, already percent-encoded. */
  readonly path: string;
  /** `content-length` by HEAD on 2026-09-05. Wavs are not compressed. */
  readonly bytes: number;
  /** The drum-machine JSON key this came from, and the index within it. */
  readonly bank: string;
  readonly n: number;
}

export const KIT_SAMPLES: readonly KitSample[] = [
  { name: 'mw_bd909', path: 'RolandTR909/rolandtr909-bd/Bassdrum-03.wav', bytes: 36252, bank: 'RolandTR909_bd', n: 2 },
  { name: 'mw_sd909', path: 'RolandTR909/rolandtr909-sd/sd02.wav', bytes: 24138, bank: 'RolandTR909_sd', n: 2 },
  { name: 'mw_cp909', path: 'RolandTR909/rolandtr909-cp/cp02.wav', bytes: 77364, bank: 'RolandTR909_cp', n: 2 },
  { name: 'mw_hh909', path: 'RolandTR909/rolandtr909-hh/hh01.wav', bytes: 21228, bank: 'RolandTR909_hh', n: 0 },
  { name: 'mw_oh909', path: 'RolandTR909/rolandtr909-oh/oh01.wav', bytes: 55206, bank: 'RolandTR909_oh', n: 1 },
  { name: 'mw_rim909', path: 'RolandTR909/rolandtr909-rim/rs02.wav', bytes: 12672, bank: 'RolandTR909_rim', n: 2 },
  { name: 'mw_sh808', path: 'RolandTR808/rolandtr808-sh/Cabasa.wav', bytes: 7040, bank: 'RolandTR808_sh', n: 0 },
  { name: 'mw_bd808', path: 'RolandTR808/rolandtr808-bd/BD0000.WAV', bytes: 22096, bank: 'RolandTR808_bd', n: 0 },
  { name: 'mw_hhlinn', path: 'LinnDrum/linndrum-hh/Hat%20Closed-03.wav', bytes: 10692, bank: 'LinnDrum_hh', n: 2 },
];

/** The map `samples()` takes: name -> relative path. */
export const KIT_MAP: Readonly<Record<KitName, string>> = Object.fromEntries(
  KIT_SAMPLES.map((k) => [k.name, k.path]),
) as Record<KitName, string>;

export const KIT_NAMES: readonly KitName[] = KIT_SAMPLES.map((k) => k.name);

/** 266,688 on 2026-09-05. `kitcheck` asserts the live sum against 300 KB. */
export const KIT_WIRE_BYTES = KIT_SAMPLES.reduce((a, k) => a + k.bytes, 0);

/**
 * Where the files come from, tried in order.
 *
 * Bunny CDN first: one wav measured at 47 ms against 273 ms from GitHub raw
 * (`samples.md` §3b, one GET each — a reading, not a benchmark). GitHub raw is
 * the JSON's own `_base` and the origin the CDN mirrors, so it is the honest
 * second choice rather than a guess. Both send `access-control-allow-origin:
 * *`. A trailing slash on each, because `superdough` concatenates.
 */
export const KIT_BASE_URLS: readonly string[] = [
  'https://strudel.b-cdn.net/tidal-drum-machines/machines/',
  'https://raw.githubusercontent.com/ritchse/tidal-drum-machines/main/machines/',
];

/**
 * How long the whole kit may take before the oscillators are kept.
 *
 * The same six seconds `soundfonts.ts` gives a role. The kit is 267 KB and has
 * never taken more than 127 ms as a batch on a warm socket or 2.96 s cold
 * INCLUDING the JSON this file does not fetch; six seconds is a stalled
 * connection, not a slow one. The cost of waiting is nothing audible — the
 * oscillator kit is already playing — so this only bounds how long the
 * promotion can be held up.
 */
export const KIT_TIMEOUT_MS = 6000;

/** `s()` names the kit may emit. Exported so tools can assert the set. */
export function isKitName(s: unknown): s is KitName {
  return typeof s === 'string' && (KIT_NAMES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

/**
 * `written`     — no browser: the score as authored, which is the sampled
 *                 kit. What every node gate measures.
 * `loading`     — a browser has started the load. Oscillators, so nothing can
 *                 throw and nothing can be dropped while files are in flight.
 * `ready`       — all nine buffers decoded and resident.
 * `unavailable` — the load finished and at least one file is missing. The
 *                 kit is all-or-nothing: a bar with a sampled kick and a
 *                 noise snare is a third kit nobody chose.
 */
export type KitState = 'written' | 'loading' | 'ready' | 'unavailable';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/** Node only, read once: `MUSICWARS_KIT=fallback` runs any gate on the oscillator kit. */
const ENV_MODE = !IS_BROWSER && typeof process !== 'undefined' ? (process.env?.MUSICWARS_KIT ?? '') : '';

let started = false;
let finished = false;
let resident = false;
let generation = 0;

export interface KitSampleLoad {
  readonly name: KitName;
  readonly url: string;
  readonly ok: boolean;
  /** Wall-clock ms from `beginKitLoad()` to this buffer being decoded. */
  readonly ms: number;
  readonly bytes: number;
  readonly error?: string;
}

export interface KitLoadReport {
  readonly state: KitState;
  /** The base that succeeded, or the last one tried. */
  readonly baseUrl: string;
  /** ms from `beginKitLoad()` to the verdict. */
  readonly totalMs: number;
  /** ms to the first decoded buffer — the honest half of the latency question. */
  readonly firstMs: number;
  /**
   * Bytes the map DECLARES for the files that loaded. Resource Timing reports
   * 0 for these: neither host sends `Timing-Allow-Origin` (`samples.md` §1),
   * so `transferSize`/`encodedBodySize` are both zero cross-origin and a
   * measured number would be a lie. `tools/kitcheck.mjs` measures the real
   * bytes by HEAD from Node.
   */
  readonly bytes: number;
  readonly samples: readonly KitSampleLoad[];
}

let report: KitLoadReport = {
  state: IS_BROWSER ? 'loading' : 'written',
  baseUrl: '',
  totalMs: 0,
  firstMs: 0,
  bytes: 0,
  samples: [],
};

export function kitState(): KitState {
  if (ENV_MODE === 'fallback' && !started) return 'unavailable';
  if (!IS_BROWSER && !started) return 'written';
  if (!finished) return 'loading';
  return resident ? 'ready' : 'unavailable';
}

export function kitReport(): KitLoadReport {
  return { ...report, state: kitState() };
}

/**
 * Does the kit play its samples right now? The ONE switch `kit.ts` reads.
 *
 * All-or-nothing, unlike `usingSoundfont`, which is per role. A pitched lane
 * that falls back alone still plays the same notes on a different timbre; a
 * kit where the snare fell back and the kick did not is two kits at once.
 */
export function kitReady(): boolean {
  if (ENV_MODE === 'fallback' && !started) return false;
  if (!IS_BROWSER && !started) return true; // `written`
  return resident;
}

/**
 * Bumped whenever the answer to `kitReady` changes. `Director.structureKey`
 * names it beside `soundfontGeneration()`, for the same reason.
 */
export function kitGeneration(): number {
  return generation;
}

/**
 * Test hook. `tools/kitcheck.mjs` queries the drum builders in both modes so
 * the fallback is measured rather than assumed.
 */
export function setKitModeForTesting(mode: 'written' | 'fallback' | 'ready'): void {
  started = mode !== 'written';
  finished = mode !== 'written';
  resident = mode === 'ready';
  generation++;
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

/** The three superdough exports this file uses, typed narrowly. */
interface SamplerModule {
  samples: (map: Record<string, string>, base: string) => Promise<void>;
  loadBuffer: (url: string, ac: BaseAudioContext, s?: string, n?: number) => Promise<AudioBuffer>;
  getLoadedBuffer: (url: string) => AudioBuffer | undefined;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e as Error);
      },
    );
  });
}

/**
 * Register the map under one base and warm every file. Returns the per-file
 * outcomes; the caller decides whether all nine made it.
 *
 * Registration and warming use the SAME base, deliberately. The bank a name
 * is registered with holds full URLs (`sampler.mjs:158`), and `loadBuffer`
 * caches by URL, so a name registered under base B with buffers warmed under
 * base A would fetch again on its first trigger — and drop that hap. If the
 * second base is needed, everything is fetched again under it; 267 KB on a
 * path that only runs when the CDN is down.
 */
async function loadUnder(
  sd: SamplerModule,
  base: string,
  ctx: BaseAudioContext,
  t0: number,
  first: { ms: number },
): Promise<KitSampleLoad[]> {
  await sd.samples({ ...KIT_MAP }, base);
  return Promise.all(
    KIT_SAMPLES.map(async (k): Promise<KitSampleLoad> => {
      const url = base + k.path;
      try {
        await withTimeout(sd.loadBuffer(url, ctx, k.name, 0), KIT_TIMEOUT_MS);
        // `loadBuffer` resolving is not the same as the buffer being in
        // `bufferCache` — it is, today, but the gate below is on the thing the
        // trigger path actually reads (`sampler.mjs:44` -> `:89`), not on a
        // promise that stands for it.
        if (!sd.getLoadedBuffer(url)) throw new Error('resolved but not resident');
        const ms = performance.now() - t0;
        if (first.ms === 0) first.ms = ms;
        return { name: k.name, url, ok: true, ms, bytes: k.bytes };
      } catch (err) {
        return {
          name: k.name,
          url,
          ok: false,
          ms: performance.now() - t0,
          bytes: 0,
          error: String((err as Error)?.message ?? err).slice(0, 160),
        };
      }
    }),
  );
}

/**
 * Start the load. Safe to call more than once; only the first call does work.
 *
 * Called from `bootAudio` after `beginSoundfontLoad` and, like it, NOT
 * awaited: the bass font is the more important download (one lane's whole
 * timbre, 9.7 KB) and goes first; the kit's nine requests follow on the same
 * sockets. START still starts the music within a frame, on the oscillator
 * kit, and the samples land underneath it as one rebuild.
 *
 * It cannot reject. Every failure path resolves to a report with the failed
 * files named and the kit stays on its oscillators; `.catch` at the call site
 * exists only so an unhandled rejection is never logged from a promise nobody
 * reads.
 */
export function beginKitLoad(ctx: BaseAudioContext): Promise<KitLoadReport> {
  if (started) return Promise.resolve(kitReport());
  started = true;
  generation++;
  const t0 = performance.now();
  const first = { ms: 0 };

  return (async () => {
    let samples: KitSampleLoad[] = [];
    let baseUrl = '';
    try {
      // The same module instance `engine.ts` boots: `@strudel/webaudio`
      // re-exports superdough, and the sound map is module state. A dynamic
      // import so that Node, which reads the score without a browser, never
      // touches superdough on the way to `kit.ts`.
      const sd = (await import('@strudel/webaudio')) as unknown as SamplerModule;
      for (const base of KIT_BASE_URLS) {
        baseUrl = base;
        samples = await loadUnder(sd, base, ctx, t0, first);
        if (samples.every((s) => s.ok)) {
          resident = true;
          break;
        }
      }
    } catch (err) {
      samples = KIT_SAMPLES.map((k) => ({
        name: k.name,
        url: baseUrl + k.path,
        ok: false,
        ms: performance.now() - t0,
        bytes: 0,
        error: String((err as Error)?.message ?? err).slice(0, 160),
      }));
    }
    finished = true;
    generation++;
    report = {
      state: kitState(),
      baseUrl,
      totalMs: performance.now() - t0,
      firstMs: first.ms,
      bytes: samples.reduce((a, s) => a + s.bytes, 0),
      samples,
    };
    return report;
  })();
}

/*
 * A read-only window hook, for the same reason `soundfonts.ts` has one: how
 * long the kit took to land after START, and whether it landed at all, are
 * browser facts no node gate can see. `tools/kitcheck.mjs --browser` and the
 * settings panel read this.
 */
if (IS_BROWSER) {
  (window as unknown as Record<string, unknown>).__kit = {
    report: kitReport,
    state: kitState,
    ready: kitReady,
    generation: kitGeneration,
    names: () => [...KIT_NAMES],
    bytes: KIT_WIRE_BYTES,
  };
}
