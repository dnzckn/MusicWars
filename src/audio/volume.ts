/**
 * Master volume.
 *
 * superdough connects its output straight to `AudioContext.destination` and
 * exposes no master fader, so there is nothing to turn down after the fact.
 * Instead both paths into it read this value: the director scales every stem's
 * postgain by it, and the SFX helpers scale their gain. That covers everything
 * the game can make a sound with.
 *
 * Persisted, because being told "it's too loud" and then making the player fix
 * it again on every reload is not a fix.
 *
 * It is also, since the output stage below was added, the whole master section:
 * `musicTrim()` is the calibrated makeup gain that puts the mix at a normal
 * listening level, and `ensureMasterCeiling()` is the soft ceiling that makes
 * the top of the fader safe. The fader is the player's control; those two are
 * the engineer's, and they are constants rather than settings.
 */

const KEY = 'musicwars.volume';
const MUTE_KEY = 'musicwars.muted';

let volume = 0.75;
let muted = false;

try {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) {
    const v = Number(stored);
    if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
  }
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  // Private browsing or a blocked origin; defaults are fine.
}

/**
 * The multiplier to apply at the audio call sites, already accounting for mute.
 *
 * Note the square root. `setGainCurve(x => x * x)` squares every gain-like
 * control, so passing the raw setting through makes the slider quartic overall
 * — 40% on the slider measured as 9% of the amplitude, which feels broken.
 * Pre-compensating here makes the fader behave like a fader.
 */
export function masterVolume(): number {
  return muted ? 0 : Math.sqrt(volume);
}

/* ---------------------------------------------------------------------------
 * The output stage: makeup gain, and the ceiling that makes it safe.
 * ------------------------------------------------------------------------ */

/**
 * Calibrated makeup gain for the MUSIC bus, in dB of amplitude.
 *
 * WHY THIS EXISTS. Rendered through the real superdough chain (`capture.mjs`,
 * 32 bars, world seed 0x51ed) the finished mix measured **-27.67 LUFS
 * integrated with a peak of -13.5 dBFS**. A streaming reference is -14 LUFS and
 * ordinary game music sits around -18 to -20, so the track was roughly 9 dB
 * under anything else the player has open, and more than half the available
 * headroom was simply never used. That is the single loudest reason it sounded
 * weak, and it is not a mixing problem — the balance between the lanes is fine
 * — it is a missing gain stage.
 *
 * WHY IT WAS MISSING. Measured off the emitted haps, every multiplier between
 * a builder and the speakers is <= 1, and `setGainCurve(x => x*x)` squares each
 * of them, so they compound quadratically:
 *
 *     amplitude = gain^2 * (stemLevel * masterVolume)^2
 *
 *     gain       (per hap, written in layers.ts)   p50 0.34   max 1.00
 *     stemLevel  (STEM_CURVES ceiling * faders)    p50 0.43   max 0.86
 *     masterVolume                                 0.87 (i.e. 0.75 of amplitude)
 *
 * Nothing anywhere in that chain is ever greater than unity, so there is no
 * point at which the mix can be brought back up. The loudest SINGLE hap in the
 * whole score reaches an amplitude of 0.21 (-13.5 dBFS), measured across five
 * world seeds and 64 bars each (0.203 / 0.212 / 0.215 / 0.220 / 0.233); the
 * rendered peak of the full mix was 0.19. The peak of this music IS its loudest
 * one note, and that note was written 13 dB below full scale.
 *
 * WHY IT IS NOT IN `masterVolume()`. The SFX path scales by `masterVolume()`
 * too, and it is already the hottest thing in the game: `fire()` sends
 * `gain 0.8 * 0.87 = 0.69`, which superdough squares to an amplitude of
 * **0.48** — 7.1 dB ABOVE the loudest music voice in the whole score. Folding
 * the makeup in there would send every gunshot to 1.5 and clip. The correct
 * reading of that number is the other way round: the gameplay layer was never
 * quiet, the music was, and bringing the music up to meet it is the fix. The
 * loudest music voice ends up at 0.56, 1.3 dB above a shot instead of 7.1 dB
 * below one, and the gunshots do not move at all.
 *
 * THE VALUE, and how it was arrived at. It is quoted at the DEFAULT setting,
 * because that is where `capture.mjs` renders — a headless page has no
 * localStorage, so `volume` is its 0.75 default — and therefore where every
 * number below can be checked.
 *
 * 9.9 was tried first and measured -17.49 LUFS with a peak of -3.2 dBFS: 1.5 dB
 * hotter than intended, because the calibration had been done against a
 * baseline taken from a different working tree. 8.4 is that same render minus
 * 1.5 dB, and the scaling is exact rather than approximate — `postgain` is
 * superdough's LAST node (`superdough.mjs:925`, and the reverb, delay and bus
 * sends are all taken from it), everything nonlinear in a voice is upstream of
 * it, and the hap set does not move because `AUDIBLE_FLOOR` scales with the
 * makeup. Multiplying it therefore multiplies the finished waveform.
 *
 * At 8.4: -18.99 LUFS and a peak of 0.585 (-4.7 dBFS) at the default, which is
 * the middle of the -18..-20 band. The top of the fader is +2.5 dB above that
 * — peak 0.78, the first point at which `ensureMasterCeiling()` does anything
 * at all, and there it costs 0.3% of the peak.
 *
 * The divisor is 40 rather than 20 for the same reason `masterVolume()` takes a
 * square root: this number is multiplied into `postgain`, and superdough
 * squares it. 40 = 20 * 2, so the constant reads in dB of the thing you can
 * hear rather than in dB of a control.
 */
const MUSIC_OUTPUT_DB = 8.4;
const MUSIC_TRIM = Math.pow(10, MUSIC_OUTPUT_DB / 40);

/**
 * The makeup factor the director multiplies into every stem's `postgain`.
 *
 * Constant, not a setting. It is a calibration of this score against a loudness
 * target, so a player moving it would be undoing a measurement rather than
 * expressing a preference — that is what `setVolume` is for. Exported as a
 * function so `director.ts` can also scale `AUDIBLE_FLOOR` by the same amount
 * and keep the voice-economy threshold where it was.
 */
export function musicTrim(): number {
  return MUSIC_TRIM;
}

/**
 * Where the soft ceiling starts, as an amplitude.
 *
 * Below this the shaper below is EXACTLY the identity function, which is the
 * property that makes it honest to install: the measured peak at the default
 * setting is 0.585, so nothing in any number this change reports has passed
 * through a nonlinearity. It exists for the top of the fader (peak 0.78) and
 * for whatever moment of the game the 32-bar render did not happen to sample.
 */
const CEILING_KNEE = 0.7;

/**
 * A master ceiling on superdough's own output bus.
 *
 * WHAT IT IS. `SuperdoughOutput` (`superdoughoutput.mjs:134`) does have a
 * master node — `destinationGain`, a `GainNode` between the channel merger and
 * `AudioContext.destination` — reachable through the exported
 * `getSuperdoughAudioController()`. `engine.ts` says "there is no master
 * limiter anywhere in superdough" and that is true of a *limiter*; the bus to
 * hang one on does exist. A `WaveShaperNode` is spliced in after it.
 *
 * THE CURVE is `x` up to `CEILING_KNEE` and `knee + (1-knee)*tanh((|x|-knee) /
 * (1-knee))` above it. The tanh has unit slope at zero, so the two halves meet
 * with matching value AND matching first derivative — there is no corner for
 * the ear to find. A `WaveShaperNode` also clamps its INPUT to [-1, 1] before
 * the lookup, so the largest value the curve can ever return is its own last
 * entry: this is a hard brickwall at 0.928, i.e. -0.65 dBFS, no matter how
 * hard the bus is driven.
 *
 * A `DynamicsCompressorNode` was the obvious alternative and was rejected:
 * Chrome's implementation carries a lookahead delay, and this game locks enemy
 * volleys, telegraphs and the warping grid to the transport, so a few
 * milliseconds of output latency is a few milliseconds of audio-visual skew
 * across the whole game rather than a mixing nicety. A memoryless shaper has
 * none, and it also cannot pump.
 *
 * WHAT WAS MEASURED, in the live game through a headless browser:
 *
 *   - It is really in the path. Every `connect()` into the live
 *     `AudioContext.destination` was recorded over ten seconds of play: 122 of
 *     them, and exactly one has a non-zero gain — superdough's own
 *     `destinationGain`, which this function then disconnects and re-routes
 *     through the shaper. The other 121 are `GainNode`s whose `gain.value` is
 *     exactly 0: superdough's `webAudioTimeout` keep-alives
 *     (`helpers.mjs:376-378`), muted by construction. Nothing audible
 *     bypasses the ceiling.
 *   - Seen red on purpose. Overwriting the INSTALLED node's curve with zeros
 *     takes the analyser on `destination` to peak 0.00000 and rms 0.000000 —
 *     total silence — and writing the real curve back restores sound. If any
 *     path went round it, that test could not go silent.
 *   - Its transfer function, read back off the installed node and rendered
 *     through: 0.1 -> 0.1, 0.3 -> 0.3, 0.5 -> 0.5, 0.6 -> 0.6, 0.69 -> 0.69,
 *     0.7 -> 0.7, 0.8 -> 0.796, 0.9 -> 0.875, 1.0 -> 0.928. Exactly the
 *     identity below the knee, to five decimal places.
 *
 * WHAT IT IS NOT. It is not measured by `tools/capture.mjs`, and that must be
 * said plainly. `capture.mjs` boots superdough itself inside its page and never
 * imports `src/audio`, so this code does not run in a capture: every LUFS and
 * peak figure recorded for this change is of the UNLIMITED signal. That is the
 * conservative direction — below 0.7 the shaper is provably the identity, and
 * the measured peak is 0.585 — but it does mean no gate in `tools/` will notice
 * if this stops working. The break-it test above is the only thing that has
 * ever seen it, and it was run by hand.
 *
 * Idempotent, and it re-arms itself: `resetGlobalEffects()` rebuilds
 * `destinationGain`, so the identity of that node is what is remembered rather
 * than a boolean.
 */
let ceilingFor: unknown = null;
let ceilingNode: WaveShaperNode | null = null;
/*
 * A synchronous in-flight flag as well as the node identity.
 *
 * The director calls this once a frame and the body is async, so without it
 * sixty attempts would be in flight before the first one had anything to
 * remember, and each would splice its own shaper onto the bus.
 */
let ceilingPending = false;

export function ensureMasterCeiling(): void {
  // Node has no Web Audio; every headless tool in `tools/` imports the director
  // and would otherwise pull superdough into a process that cannot run it.
  if (typeof window === 'undefined' || ceilingPending) return;
  ceilingPending = true;
  void (async () => {
    try {
      /*
       * Through `@strudel/webaudio`, which does `export * from 'superdough'`
       * (`index.mjs:11`), so this is the same module instance `engine.ts`
       * booted rather than a second copy — and it is the specifier
       * `src/types/strudel.d.ts` already describes. The cast is because that
       * hand-written declaration does not list this export; the shape asserted
       * is the two fields actually read, so a superdough that moves them fails
       * here rather than silently doing nothing.
       */
      const sd = (await import('@strudel/webaudio')) as unknown as {
        getSuperdoughAudioController?: () => {
          output: { destinationGain: GainNode | null };
        };
      };
      if (!sd.getSuperdoughAudioController) return;
      const out = sd.getSuperdoughAudioController().output;
      const bus = out.destinationGain;
      if (!bus || bus === ceilingFor) return;

      const ctx = bus.context;
      const N = 4096;
      const curve = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        const a = Math.abs(x);
        const y =
          a <= CEILING_KNEE
            ? a
            : CEILING_KNEE + (1 - CEILING_KNEE) * Math.tanh((a - CEILING_KNEE) / (1 - CEILING_KNEE));
        curve[i] = x < 0 ? -y : y;
      }
      const shaper = new WaveShaperNode(ctx, { curve, oversample: 'none' });
      // A previous ceiling is left dangling off `destination` by
      // `resetGlobalEffects()`, which rebuilds the bus underneath it. Silent,
      // because its input is gone, but there is no reason to keep it.
      ceilingNode?.disconnect();
      ceilingNode = shaper;
      // `disconnect()` with no argument also drops the analyser taps the browser
      // gates install on this node; reconnecting the shaper to `destination`
      // re-triggers their patched `connect`, so the tap follows the signal.
      bus.disconnect();
      bus.connect(shaper);
      shaper.connect(ctx.destination);
      ceilingFor = bus;
    } catch {
      // Before boot there is no controller and no context. Not fatal, and the
      // next frame tries again — `ceilingFor` is only set on success.
    } finally {
      ceilingPending = false;
    }
  })();
}

/** The slider position, ignoring mute, so the UI can restore it. */
export function volumeSetting(): number {
  return volume;
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  if (volume > 0) muted = false;
  persist();
}

export function nudgeVolume(delta: number): number {
  setVolume(volume + delta);
  return volume;
}

export function toggleMute(): boolean {
  muted = !muted;
  persist();
  return muted;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, String(volume));
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Not worth failing over.
  }
}
