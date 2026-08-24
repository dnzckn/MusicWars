/**
 * capture — record the game's REAL Web Audio master output to a file on disk.
 *
 * WHY THIS EXISTS, in the words of the tool it replaces for this job.
 * `tools/render.mjs` writes a WAV without a browser by re-synthesising the
 * scheduled events in plain JavaScript, and its own header forbids using it for
 * the question this helper answers:
 *
 *     "No reverb, no delay, no echo. ... One-pole filters rather than the real
 *      resonant ladder ... judge the WRITING from this ... Do not judge the
 *      SOUND."
 *
 * Every remedy the master plan's Track S proposes lives in exactly the half
 * `render.mjs` throws away: algorithmic rooms per orbit group, the narrow
 * `duckorbit` sidechain, filter-bloom onsets (`lpenv`/`lpattack`), FM and
 * additive beds, envelope floors as superdough actually renders them. A
 * before/after pair rendered by `render.mjs` would be **identical in exactly
 * the places the work happened**, and a listening pass run on such a pair would
 * conclude — correctly, and uselessly — that nothing changed.
 *
 * So this attaches to the running game's own AudioContext, taps whatever is
 * bound for `ctx.destination`, and records the real thing.
 *
 * ------------------------------------------------------------------ HOW
 *
 * 1. `installMasterTap` patches `AudioNode.prototype.connect` before the page
 *    boots — the same trick `audiocheck` uses for its AnalyserNode and `chop`
 *    uses for its envelope follower. Anything connected to the destination is
 *    also connected to a GainNode we own (`window.__capBus`). The patch must be
 *    installed as an init script, because superdough wires its orbits during
 *    boot and a tap added afterwards would miss them.
 *
 * 2. `attachRecorder` installs an AudioWorkletProcessor that copies its input
 *    into a **ring buffer on the audio thread** and posts fixed-size blocks to
 *    the page. The audio thread is the only place this can be done honestly: a
 *    main-thread `getFloatTimeDomainData` poll (what `choppy` does) samples
 *    whatever the 2048-sample analyser window happens to hold at the moment the
 *    timer fires, so it both duplicates and drops samples. A WAV built that way
 *    would be a plausible-sounding lie.
 *
 * 3. `record` drains the page's queue about once a second, so the browser never
 *    holds more than a second of audio and a long capture cannot blow the
 *    page's heap.
 *
 * 4. `writeWav` writes 16-bit PCM at **the context's own sample rate**, read
 *    off `ctx.sampleRate` and carried through every step. It is never assumed:
 *    this box's Chromium runs at 48000 and `render.mjs` writes 44100, and a
 *    header claiming the wrong one plays the music at the wrong speed and the
 *    wrong pitch — which sounds like a mixing change and is not one.
 *
 * ------------------------------------------------- THE CONTROLS IT CARRIES
 *
 * This file's whole reason for existing is to produce evidence a human will
 * judge by ear, and the worst possible failure is a file full of zeros or of
 * garbage that nobody notices is garbage until a conclusion has been drawn from
 * it. Three controls are therefore built into the path itself, not bolted on:
 *
 *  - **The transfer probe.** The page sends the first sample of every drained
 *    block twice: once inside the base64 payload and once as a plain JSON
 *    number. `drainCapture` compares them and throws if they differ. That
 *    catches a byte-order mistake, a mis-aligned `Float32Array` view, and a
 *    truncated base64 string — three ways to produce a file that is technically
 *    audio and musically noise.
 *
 *  - **Coverage.** The processor counts every render quantum it was handed.
 *    `frames / (sampleRate * wallClockSeconds)` must be ~1.0. Below that, the
 *    audio thread stalled or the context was suspended, and the WAV is a
 *    time-compressed edit of the run rather than a recording of it.
 *
 *  - **Overruns.** The ring buffer counts the render quanta in which it had to
 *    refuse samples because the page was not draining fast enough. It should
 *    always be zero; if it is not, the file has holes that are the harness's,
 *    and any `chop`-style measurement taken from it would blame the game.
 *
 * The silent-state / loud-state comparison is the fourth control and lives in
 * `tools/capture.mjs`, because it needs to drive the game.
 *
 * ------------------------------------------------------------ WHAT IT IS NOT
 *
 * The tap sits at the destination, so it hears the master bus *after* every
 * orbit, room and duck — which is the point — but it cannot solo a stem.
 * `mixaudit`, `chop` and `stemprobe` remain the instruments for per-stem
 * questions. This one answers "what would a player have heard", once.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The Chromium flags a capture needs.
 *
 * `--autoplay-policy=no-user-gesture-required` is not optional: without it the
 * AudioContext created before the click stays `suspended`, the render quantum
 * callback never fires, and the recorder produces a file of length zero while
 * every other part of the tool reports success.
 *
 * `--mute-audio` mutes the *output device*, not the graph. Chromium still runs
 * the audio thread and still renders every quantum — which is why `audiocheck`
 * and `chop` both measure real signal with it set. This box has no sound card
 * to speak of; without the flag Chromium hunts for one at startup.
 */
export const CAPTURE_ARGS = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];

/**
 * Route everything bound for the destination into a bus we own.
 *
 * Call BEFORE `page.goto`. The `__capMine` set exempts the recorder's own
 * monitor path: `chop`'s first version routed its follower back through the
 * patched `connect` and built the cycle tap -> follower -> mute -> tap, which
 * Chrome renders as **silence**, so every measurement it took was exactly zero
 * and looked like a finding about the game.
 */
export async function installMasterTap(page) {
  await page.addInitScript(() => {
    window.__capMine = new WeakSet();
    window.__capBus = null;
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest, ...rest) {
      const result = origConnect.call(this, dest, ...rest);
      try {
        if (dest && dest.context && dest === dest.context.destination && !window.__capMine.has(this)) {
          if (!window.__capBus) window.__capBus = dest.context.createGain();
          origConnect.call(this, window.__capBus);
        }
      } catch {
        /* a node type that refuses the extra fan-out is not worth failing over */
      }
      return result;
    };
  });
}

/**
 * Install the ring-buffer recorder on the tap bus.
 *
 * Returns `{ sampleRate, channels, contextState }` — the sample rate is the
 * context's own and everything downstream must use this value rather than a
 * constant.
 *
 * Safe to call at the title screen, before the game has unlocked audio: it
 * creates the context (the same singleton `bootAudio` will use — `main.ts`
 * exposes `audioCtx()` precisely so tooling does not end up with a second
 * one), resumes it, and creates the bus eagerly if no source has connected
 * yet. That is what makes a *rendered silence* control possible, as opposed to
 * a "nothing happened" control, which proves nothing.
 */
export async function attachRecorder(page, { ringSeconds = 4, blockFrames = 4096 } = {}) {
  return page.evaluate(
    async ({ ringSeconds, blockFrames }) => {
      const ctx = window.__musicwars.audioCtx();
      if (ctx.state !== 'running') {
        try {
          await ctx.resume();
        } catch {
          /* reported below via contextState */
        }
      }
      if (!window.__capBus) window.__capBus = ctx.createGain();
      /*
       * One context, or nothing works and the reason is invisible.
       *
       * `main.ts` exposes `audioCtx()` precisely because a tool that imports
       * `@strudel/webaudio` itself gets a SECOND module instance with its own
       * singleton and ends up poking a context the game has never heard of.
       * If the tap bus were built on one context and the recorder on another,
       * `connect` throws a DOMException whose message says nothing about which
       * two contexts differ.
       */
      if (window.__capBus.context !== ctx) {
        throw new Error(
          'capture: the tap bus and the recorder are on different AudioContexts. ' +
            'Something created a second context — use window.__musicwars.audioCtx() everywhere.',
        );
      }

      const src = `
        /*
         * A ring buffer on the audio thread. Interleaved stereo, so one WAV
         * frame is two consecutive slots and no de-interleave step can get the
         * channels out of order later.
         */
        class Cap extends AudioWorkletProcessor {
          constructor(opts) {
            super();
            const o = opts.processorOptions;
            this.ch = 2;
            this.cap = Math.max(2, Math.round(o.ringSeconds * sampleRate) * this.ch);
            this.ring = new Float32Array(this.cap);
            this.w = 0; this.r = 0; this.pending = 0;
            this.block = o.blockFrames * this.ch;
            this.overruns = 0;
            this.quanta = 0;
            this.on = false;
            /*
             * Arming lives here rather than in a flag on the page, because the
             * page and the audio thread do not share memory. The handler is
             * installed once, in the constructor: nothing is allocated per
             * quantum, which is the rule the audio thread cares about.
             */
            this.port.onmessage = (e) => {
              if (e.data === 'start') {
                this.on = true;
                this.w = 0; this.r = 0; this.pending = 0;
                this.overruns = 0; this.quanta = 0;
              } else if (e.data === 'stop') {
                this.on = false;
                /*
                 * Flush what is left, or every capture is short by up to one
                 * block — 85ms at 4096 frames — at its end. A systematic bias
                 * no listener would notice and every duration check would.
                 */
                if (this.pending > 0) {
                  const out = new Float32Array(this.pending);
                  for (let i = 0; i < out.length; i++) { out[i] = this.ring[this.r]; this.r = (this.r + 1) % this.cap; }
                  this.pending = 0;
                  this.port.postMessage({ pcm: out, overruns: this.overruns, quanta: this.quanta }, [out.buffer]);
                }
              }
            };
          }
          process(inputs) {
            const inp = inputs[0];
            /*
             * With nothing connected Chrome hands us an EMPTY input array, not
             * an array of zeroed channels. Writing zeros in that case is what
             * makes the silent control a real recording of silence rather than
             * a recording of nothing: the frame count still advances.
             */
            const L = (inp && inp[0]) || null;
            const R = (inp && inp[1]) || L;
            /*
             * The render quantum is 128 today and the spec reserves the right
             * to change it, so the length is read rather than assumed — an
             * off-by-a-quantum here would fill the file with undefined, which
             * arrives as NaN and writes as a click on every block boundary.
             */
            const n = L ? L.length : 128;
            if (this.on) {
              for (let i = 0; i < n; i++) {
                if (this.pending + this.ch > this.cap) { this.overruns++; break; }
                this.ring[this.w] = L ? L[i] : 0; this.w = (this.w + 1) % this.cap;
                this.ring[this.w] = R ? R[i] : (L ? L[i] : 0); this.w = (this.w + 1) % this.cap;
                this.pending += this.ch;
              }
              this.quanta += n;
              while (this.pending >= this.block) {
                const out = new Float32Array(this.block);
                for (let i = 0; i < this.block; i++) { out[i] = this.ring[this.r]; this.r = (this.r + 1) % this.cap; }
                this.pending -= this.block;
                this.port.postMessage({ pcm: out, overruns: this.overruns, quanta: this.quanta }, [out.buffer]);
              }
            }
            return true;
          }
        }
        registerProcessor('mw-capture', Cap);`;

      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const node = new AudioWorkletNode(ctx, 'mw-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        // Explicit, so the file is stereo whatever happens to be connected. A
        // recorder whose channel count depends on the arrangement writes WAVs
        // that cannot be compared with each other.
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { ringSeconds, blockFrames },
      });

      window.__cap = {
        node,
        chunks: [],
        frames: 0,
        overruns: 0,
        quanta: 0,
        sampleRate: ctx.sampleRate,
        channels: 2,
      };
      node.port.onmessage = (e) => {
        const c = window.__cap;
        c.chunks.push(e.data.pcm);
        c.frames += e.data.pcm.length / c.channels;
        c.overruns = e.data.overruns;
        c.quanta = e.data.quanta;
      };

      /*
       * The monitor path, muted, and marked as ours so the patched `connect`
       * above does not feed it back into the tap. It exists because Web Audio
       * is pull-based: a node with no route to the destination is never
       * rendered, so a recorder that is not connected to anything records
       * nothing and says so only by returning an empty file.
       */
      window.__capBus.connect(node);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      window.__capMine.add(node);
      window.__capMine.add(mute);
      node.connect(mute);
      mute.connect(ctx.destination);

      return { sampleRate: ctx.sampleRate, channels: 2, contextState: ctx.state };
    },
    { ringSeconds, blockFrames },
  );
}

/**
 * Record for `ms` milliseconds, draining the page about once a second.
 *
 * Returns interleaved Float32 samples plus the integrity counters. `onTick` is
 * called with `(elapsedMs, framesSoFar)` after each drain, so a caller can show
 * progress on a long capture without polling the page itself.
 */
export async function record(page, ms, { onTick, drainMs = 1000 } = {}) {
  await page.evaluate(() => {
    const c = window.__cap;
    c.chunks.length = 0;
    c.frames = 0;
    c.overruns = 0;
    c.quanta = 0;
    c.node.port.postMessage('start');
  });

  const parts = [];
  let frames = 0;
  let overruns = 0;
  let quanta = 0;
  const started = Date.now();
  while (Date.now() - started < ms) {
    await page.waitForTimeout(Math.min(drainMs, Math.max(50, ms - (Date.now() - started))));
    const d = await drainCapture(page);
    if (d.pcm.length) parts.push(d.pcm);
    frames += d.pcm.length / d.channels;
    overruns = Math.max(overruns, d.overruns);
    quanta = Math.max(quanta, d.quanta);
    onTick?.(Date.now() - started, frames);
  }
  const wallMs = Date.now() - started;
  /*
   * Disarm FIRST, then drain. The stop message flushes the partial block, and
   * whatever the game plays while the last transfer is in flight must not be
   * appended to a window that has already ended — otherwise every capture is
   * a quarter-second longer than it claims and the two ends of an A/B pair are
   * not the same length.
   */
  await page.evaluate(() => window.__cap.node.port.postMessage('stop'));
  await page.waitForTimeout(250);
  const tail = await drainCapture(page);
  if (tail.pcm.length) parts.push(tail.pcm);
  frames += tail.pcm.length / tail.channels;
  overruns = Math.max(overruns, tail.overruns);
  quanta = Math.max(quanta, tail.quanta);

  const total = parts.reduce((a, p) => a + p.length, 0);
  const pcm = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    pcm.set(p, o);
    o += p.length;
  }
  return {
    pcm,
    frames,
    overruns,
    /*
     * Frames the processor was HANDED while armed. Against the wall clock this
     * says whether the audio thread ran in real time; against `frames` it says
     * whether every sample it rendered actually reached this process. Two
     * different failures, two different numbers.
     */
    rendered: quanta,
    sampleRate: tail.sampleRate,
    channels: tail.channels,
    wallMs,
  };
}

/**
 * Pull everything queued in the page across as raw float samples.
 *
 * Base64 rather than a JSON array of numbers: one second of 48kHz stereo is
 * 96,000 numbers, and CDP would serialise that as ~800KB of decimal text per
 * second of audio. The bytes go over as-is and are re-viewed here.
 *
 * THE TRANSFER PROBE. The page also returns `first` — the first float of the
 * payload, as an ordinary number — and this function checks it against the
 * decoded array. A byte-order mismatch, an unaligned view, or a truncated
 * string all survive every other check in this file and produce a WAV that
 * sounds like broken-glass noise; this catches all three in one comparison.
 */
export async function drainCapture(page) {
  const got = await page.evaluate(() => {
    const c = window.__cap;
    const chunks = c.chunks.splice(0, c.chunks.length);
    let total = 0;
    for (const k of chunks) total += k.length;
    const merged = new Float32Array(total);
    let o = 0;
    for (const k of chunks) {
      merged.set(k, o);
      o += k.length;
    }
    const bytes = new Uint8Array(merged.buffer, merged.byteOffset, merged.byteLength);
    let s = '';
    const STEP = 0x8000; // apply() has an argument-count limit; 32k is safe
    for (let i = 0; i < bytes.length; i += STEP) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
    }
    return {
      b64: btoa(s),
      count: total,
      first: total ? merged[0] : 0,
      overruns: c.overruns,
      quanta: c.quanta,
      sampleRate: c.sampleRate,
      channels: c.channels,
    };
  });

  const raw = Buffer.from(got.b64, 'base64');
  const pcm = new Float32Array(got.count);
  // Copy rather than view: a Buffer from base64 is a slice of a shared pool and
  // its byteOffset is not guaranteed to be 4-byte aligned, which `new
  // Float32Array(buf.buffer, buf.byteOffset, n)` would reject at random.
  Buffer.from(pcm.buffer).set(raw.subarray(0, pcm.byteLength));
  if (got.count && Math.abs(pcm[0] - got.first) > 1e-9) {
    throw new Error(
      `capture transfer is corrupting samples: page says first=${got.first}, ` +
        `decoded ${pcm[0]}. Suspect byte order or a truncated payload — do not trust the WAV.`,
    );
  }
  return {
    pcm,
    overruns: got.overruns,
    quanta: got.quanta,
    sampleRate: got.sampleRate,
    channels: got.channels,
  };
}

/** 20*log10, with a floor so digital silence prints as a number and not NaN. */
export const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x) => (x > 0 ? `${dbfs(x).toFixed(1)}dBFS` : '-inf dBFS');

/**
 * Everything that can be said about a block of samples without listening.
 *
 * `clipped` counts samples at or beyond full scale in the FLOAT domain, before
 * the 16-bit conversion, because the conversion clamps and would hide them.
 * `distinct` is the number of different sample values in a subsample — a stuck
 * buffer, a DC offset and a constant all collapse it to 1, which is the shape
 * of "the recorder returned garbage that happens not to be zero".
 */
export function analyse(pcm, channels, sampleRate) {
  const frames = Math.floor(pcm.length / channels);
  let peak = 0;
  let sumSq = 0;
  let clipped = 0;
  let zeros = 0;
  const dc = new Array(channels).fill(0);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 1) clipped++;
    if (a === 0) zeros++;
    sumSq += v * v;
    dc[i % channels] += v;
  }
  const rms = pcm.length ? Math.sqrt(sumSq / pcm.length) : 0;

  // Short-window loudness, for the dynamics half of the listening artefact.
  const win = Math.max(1, Math.round(sampleRate * 0.4)) * channels;
  const wins = [];
  for (let i = 0; i + win <= pcm.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += pcm[j] * pcm[j];
    wins.push(Math.sqrt(s / win));
  }
  wins.sort((a, b) => a - b);
  const q = (f) => (wins.length ? wins[Math.min(wins.length - 1, Math.floor(wins.length * f))] : 0);

  // Value diversity, on a subsample: 4096 points is plenty to tell a signal
  // from a constant and costs nothing on a 60-second file.
  const step = Math.max(1, Math.floor(pcm.length / 4096));
  const seen = new Set();
  for (let i = 0; i < pcm.length; i += step) seen.add(pcm[i]);

  return {
    frames,
    seconds: sampleRate ? frames / sampleRate : 0,
    peak,
    rms,
    crestDb: rms > 0 && peak > 0 ? 20 * Math.log10(peak / rms) : 0,
    clipped,
    clippedPct: pcm.length ? (clipped / pcm.length) * 100 : 0,
    zeroPct: pcm.length ? (zeros / pcm.length) * 100 : 100,
    dc: dc.map((s) => (frames ? s / frames : 0)),
    loudP10: q(0.1),
    loudP90: q(0.9),
    dynamicRangeDb: q(0.1) > 0 ? 20 * Math.log10(q(0.9) / q(0.1)) : Infinity,
    distinct: seen.size,
    fmtDb,
  };
}

/**
 * 16-bit PCM WAV at the context's real sample rate.
 *
 * NOT normalised, deliberately, and this is a reversal of what `render.mjs`
 * does (it scales every file to 0.89 peak "for listening"). A capture is
 * evidence about the mix's own level: normalising destroys the one number that
 * says whether the master got louder between two builds, and `sustainshare`'s
 * single-stem cap and any clipping check would both read the normalisation
 * instead of the game. The measured peak is printed by the caller so a quiet
 * file is visible rather than silently boosted; `GAIN=` exists for the listener
 * who just wants it louder, and prints what it applied.
 */
export function writeWav(path, pcm, { sampleRate, channels, gain = 1 }) {
  const frames = Math.floor(pcm.length / channels);
  const bytesPerFrame = channels * 2;
  const buf = Buffer.alloc(44 + frames * bytesPerFrame);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + frames * bytesPerFrame, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytesPerFrame, 28);
  buf.writeUInt16LE(bytesPerFrame, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * bytesPerFrame, 40);
  for (let i = 0; i < frames * channels; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i] * gain));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  return buf.length;
}
