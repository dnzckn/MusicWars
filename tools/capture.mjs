/*
 * capture — the game's REAL audio, rendered offline through superdough, to a WAV.
 *
 * WHY THIS EXISTS. `AGENTS.md` says "the listening artefact is the browser
 * capture recorder", and there was no such tool. The two renderers that did
 * exist say in their own headers that they are not the game's sound:
 * `render.mjs` reimplements the oscillators with one-pole filters and no
 * reverb or delay, and `hum.mjs` is smaller still. `render.mjs` in particular
 * applies `cutoff` and IGNORES `hpf`/`hcutoff` and `ftype` altogether — which
 * is exactly why the `.hpf(95).ftype('ladder')` trap documented in AGENTS §4
 * (a second 24 dB/oct LOWPASS where a highpass was intended) has survived in
 * `buildBass` without anybody hearing it. A tool that cannot represent a
 * control cannot see a bug in it.
 *
 * WHAT THIS IS. The real signal chain, not a model of it:
 *
 *   - The score is produced by the real `MusicDirector` driving off a real
 *     seeded `World`, exactly as `main.ts` wires them — same ten bus events,
 *     same `masterPattern()`, same `AUDIBLE_FLOOR` filter.
 *   - The haps are then handed to REAL `superdough` 1.3.0 running in a real
 *     headless Chromium, pointed at an `OfflineAudioContext`. Its own
 *     oscillator worklets, its ladder filter, its reverb, its delay, its
 *     envelope arithmetic, its `setGainCurve(x => x*x)`. Nothing here
 *     re-implements any of it.
 *   - `initAudio()` loads the AudioWorklet modules into the offline context,
 *     so `ftype('ladder')` really is the ladder worklet and not a biquad.
 *
 * OFFLINE, NOT REALTIME. `superdough` gets its context from a module-level
 * variable with a public `setAudioContext()` setter (`audioContext.mjs:17`),
 * so an `OfflineAudioContext` can simply be injected before anything asks for
 * one. `@strudel/webaudio`'s own `renderPatternAudio` does the same thing;
 * this tool does not call it only because it ends by triggering a browser
 * download rather than returning the buffer. So this is NOT a MediaRecorder
 * capture: there is no realtime clock anywhere in the path, rendering is
 * faster than realtime, and the result does not depend on machine load.
 *
 * DETERMINISM, the honest version rather than the hopeful one.
 * `--verify-determinism` checks both halves and prints NUMBERS rather than a
 * verdict, because "non-deterministic" on its own is the least useful true
 * statement available: what a person comparing two captures needs is the noise
 * floor of the instrument.
 *
 * THE RENDER IS NOT DETERMINISTIC, and the useful thing is its size.
 * Five complete runs of the tool over one identical hap stream produced FIVE
 * distinct WAVs. The octave-band table varied by at most 1.329 dB, in the
 * 500 Hz band, every other band tighter. So a band difference under ~1.4 dB is
 * not a result. For scale, deliberately closing the bass filter moves bands by
 * 3-10 dB (see `tools/README.md`), and `render.mjs` cannot represent a filter
 * type at all.
 *
 * `--verify-determinism[=N]` measures that spread rather than announcing a
 * verdict, and it does it by RE-RUNNING THE WHOLE TOOL in clean child
 * processes, N times (default 3). Three cheaper versions were each wrong in
 * the same direction — they made the tool look better than it is:
 *
 *   1. Render twice in one browser: 0.000 dB in every band. The two renders
 *      shared a process.
 *   2. Render the second in a freshly launched browser: a flat 1.329 dB in
 *      the 500 Hz band, every time. That looked like a finding; it is the same
 *      spread the tool has anyway.
 *   3. Re-run the whole tool ONCE: 0.000 dB, and that was luck — a comparison
 *      of two samples cannot tell "reproducible" from "landed in the same
 *      place twice".
 *
 * WHAT WAS RULED OUT, by measurement, in the order it was tried. None of these
 * is the cause, and each cost an experiment, so they are written down:
 *
 *   - The seeded PRNG stream. The page replaces `Math.random` with mulberry32
 *     before superdough loads, which covers the impulse response
 *     (`reverbGen.mjs:131`) and every noise buffer (`noise.mjs:21`). Runs that
 *     produced DIFFERENT audio drew exactly 38,455,685 randoms each. The
 *     stream is identical; the output is not.
 *   - GC of superdough's `WeakRef`s. The polyphony reaper (`superdough.mjs:525`)
 *     spares a voice whose handle the collector already took. `WeakRef` was
 *     replaced with a strong-holding shim: no change.
 *   - Node release timing. `onceEnded` (`helpers.mjs:606`) is a plain
 *     `node.onended = fn` whose callbacks disconnect nodes and zero worklet
 *     `end` params, timed by the main thread, which offline bears no relation
 *     to where the render has got to. Blocked by default as insurance;
 *     `--keep-releases` measures the same ten bands, peak, RMS and LUFS.
 *   - Concurrency. Closing the first browser before launching the second
 *     changed nothing.
 *
 * WHAT IS REAL BUT UNPROVEN AS THE CAUSE. `reverbGen.applyGradualLowpass`
 * (`reverbGen.mjs:85`) renders the impulse response in its OWN
 * `OfflineAudioContext` and assigns `convolver.buffer` from that context's
 * `oncomplete`; nothing joins on it. Sixteen bars of this score start FORTY-
 * NINE such side renders across FOUR reverb buses, so a main render that
 * starts early is quietly drier than the game. This tool counts every
 * `OfflineAudioContext` but its own, tracks every `ConvolverNode`, and will
 * not start until nothing is in flight, no convolver lacks a buffer, and that
 * has held across a quiet window — both counts printed every run. The race is
 * real and visible in the source. It did NOT move the measured spread, so it
 * is a precaution, not a fix, and saying otherwise would be the kind of
 * unearned claim this repo keeps incident reports about.
 *
 * ONE FURTHER KNOWN HOLE: AudioWorkletGlobalScope is a separate JS realm the
 * seeding cannot reach, and `worklets.mjs:559` (supersaw) and `:1388`
 * (wavetable) take a random initial phase. `buildBass` emits `supersaw` today
 * — the tool prints the `s` values it rendered, so you can see when this
 * applies. Bass soloed, 16 bars: two runs differ at -47.6 dB relative, worst
 * band 0.019 dB. Small, and not the 1.3 dB.
 *
 * THE SCORE HALF IS DETERMINISTIC, and is checked separately. `World` takes an
 * explicit seed and nothing under `src/game`, `src/core` or `src/audio` calls
 * `Math.random` — the only four calls in `src/` are in `render/renderer.ts`,
 * never loaded here. Identical hap-stream SHA-1 across twelve processes; the
 * SHA-1 is printed every run so a score that moves shows up as a changed hash
 * rather than as a mystery in the band table. It earned that: two captures
 * during development disagreed and the cause was another session editing
 * `src/audio/layers.ts` underneath the run.
 *
 * WHAT IT STILL CANNOT TELL YOU. It is a spectrum and a file, not an opinion.
 * A band share is not an instrument's share — a sawtooth bass puts its
 * fundamental in `125`/`63` and more total energy than that into `250`..`1k`.
 * `tools/spectrum.mjs` makes the same point at more length and it applies
 * here unchanged. Listen to the WAV; the numbers are for A/B, not for verdicts.
 *
 * USAGE
 *
 *   node --experimental-transform-types tools/capture.mjs
 *   node --experimental-transform-types tools/capture.mjs --bars=32 --stem=bass
 *   node --experimental-transform-types tools/capture.mjs --verify-determinism
 *   node --experimental-transform-types tools/capture.mjs --selftest
 *
 *   --bars=N          bars to render (default 16)
 *   --lead-in=S       seconds of simulation before recording starts (default 30;
 *                     the intro is eight bars with staged entry, so a short
 *                     lead-in records an arrangement with no rhythm section —
 *                     see the same note in render.mjs, which learned it the
 *                     expensive way)
 *   --stem=ID         solo one lane: sub kick clap hats bass chords arp lead
 *                     fx motifs power, or `all` (default). Soloing uses the
 *                     director's own `solo` field, which PINS the lane to unity
 *                     rather than leaving it on its live fader — see the note on
 *                     `MusicDirector.solo`. A soloed render is therefore louder
 *                     than that lane is in the mix, by design.
 *   --seed=N          world seed (default 0x51ed, the seed wiring/deadhunt use)
 *   --audio-seed=N    PRNG seed for superdough's reverb and noise (default 1)
 *   --out=PATH        WAV path (default renders/capture-<stem>-<bars>.wav)
 *   --tail=S          extra seconds rendered after the last note for reverb and
 *                     delay tails (default 2)
 *   --keep-open       leave the browser open on failure for inspection
 *   --keep-releases   let superdough's `onended` teardown run during the
 *                     render. Measured to change nothing once the reverb wait
 *                     is in place — here so that can be re-checked.
 *   --verify-determinism[=N]  re-derive the score, then re-run the whole tool N
 *                     more times (default 3) in clean processes and report the
 *                     spread across every run — see above
 *   --windows=N       split the render into N equal windows and report loudness,
 *                     RMS and the octave bands for each, labelled with the
 *                     section and act that produced them. 0 (default) is off.
 *                     Use with a long render: --bars=128 --windows=8 gives
 *                     sixteen-bar windows over about four minutes.
 *   --selftest        skip the game entirely and push a known 1 kHz -20 dBFS
 *                     stereo sine through the same analyser, so the octave-band
 *                     table can be checked against an answer that is known in
 *                     advance
 *
 * Env equivalents: CAPTURE_BARS, CAPTURE_LEAD_IN, CAPTURE_STEM, CAPTURE_SEED,
 * CAPTURE_AUDIO_SEED, CAPTURE_OUT, CAPTURE_TAIL, CAPTURE_KEEP_RELEASES.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import './lib/headless-audio.mjs';

/* --------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, env, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  if (env && process.env[env] != null) return process.env[env];
  return fallback;
};

const BARS = Number(opt('bars', 'CAPTURE_BARS', 16));
const LEAD_IN = Number(opt('lead-in', 'CAPTURE_LEAD_IN', 30));
const STEM = String(opt('stem', 'CAPTURE_STEM', 'all'));
const SEED = Number(opt('seed', 'CAPTURE_SEED', 0x51ed));
const AUDIO_SEED = Number(opt('audio-seed', 'CAPTURE_AUDIO_SEED', 1));
const TAIL = Number(opt('tail', 'CAPTURE_TAIL', 2));
const SELFTEST = flag('selftest');
const TWICE = argv.some((a) => a === '--verify-determinism' || a.startsWith('--verify-determinism='));
/*
 * --windows=N — ANALYSE OVER TIME RATHER THAN AS ONE AGGREGATE.
 *
 * The band table below reduces a whole render to ten numbers, and ten numbers
 * cannot tell a score with a shape from a score without one. A run with real
 * form is not statistically flat end to end: its loudness, its band profile or
 * its voice count should CHANGE across the render by more than the instrument's
 * own noise floor. A run without form produces the same table in every window,
 * and that is a result too — it means the form was coded and is not audible.
 *
 * The noise floor is stated with the table every time, because it is the whole
 * difference between a reading and a claim. Repeat renders of one identical hap
 * stream differ by up to 1.329 dB in the 500 Hz band (see the determinism note
 * above), so a full-mix difference under about 1.4 dB IS NOT A RESULT. A soloed
 * stem measures 0.00-0.019 dB and is where small differences can live.
 *
 * Each window is labelled with the section and the ACT the director was in
 * while those bars were scheduled, so the table says what changed and not only
 * that something did.
 */
const WINDOWS = Number(opt('windows', 'CAPTURE_WINDOWS', 0));
const KEEP_OPEN = flag('keep-open');
/*
 * ON by default as insurance, not because it was ever caught doing damage:
 * with the reverb wait in place, `--keep-releases` measures identical in every
 * band. See the header. It stays on because the teardown is timed by the main
 * thread, which offline bears no relation to where the render has got to, and
 * a thing that CAN cut a sounding tail should not be left able to.
 */
const SUPPRESS_RELEASE = !(flag('keep-releases') || process.env.CAPTURE_KEEP_RELEASES === '1');

/*
 * 44100, stated once and used everywhere.
 *
 * The rest of the directory reads WAVs at whatever rate they carry, but
 * `spectrum.mjs` and `render.mjs` are both 44.1k, and a capture at a different
 * rate would silently not be comparable with either.
 */
const SR = 44100;

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = resolve(
  ROOT,
  String(opt('out', 'CAPTURE_OUT', `renders/capture-${SELFTEST ? 'selftest' : STEM}-${BARS}.wav`)),
);

/* -------------------------------------------------------------- the score */

/*
 * `STEM_IDS` is imported, never restated.
 *
 * AGENTS §3: "a tool holding its own copy of a constant will lie the day it
 * moves". A hand-written list here would accept `hats` forever and reject a
 * twelfth lane the day one is added.
 */
const { STEM_IDS } = await import('../src/audio/layers.ts');
if (STEM !== 'all' && !STEM_IDS.includes(STEM)) {
  console.error(`capture: unknown stem "${STEM}" — try ${['all', ...STEM_IDS].join(' ')}`);
  process.exit(1);
}

/**
 * Run the real game for `LEAD_IN` seconds, then collect `BARS` bars of haps
 * off the real master pattern, resolved to absolute seconds.
 *
 * Resolving per bar rather than querying the whole span at once is not an
 * optimisation: the director changes tempo during a run, so a single
 * `secPerBar` would smear every bar after the first tempo move. `render.mjs`
 * makes the same argument at more length; this is the same shape of loop for
 * the same reason.
 */
async function buildScore() {
  const { MusicDirector } = await import('../src/audio/director.ts');
  const { Transport } = await import('../src/core/transport.ts');
  const { World } = await import('../src/game/world.ts');

  const director = new MusicDirector();
  director.reset(0);
  if (STEM !== 'all') director.solo = STEM;

  const transport = new Transport();
  transport.start();

  const world = new World(SEED);
  world.start();
  const bus = world.bus;
  // The same ten subscriptions main.ts makes. Mode changes on a new wave, the
  // breakdown on a clean clear and the boss groove all arrive through handlers
  // rather than through `snapshot`, so a capture that skipped them would
  // record an arrangement with no structure in it.
  bus.on('wave:start', (e) => director.onWaveStart(transport, e));
  bus.on('wave:clear', (e) => director.onWaveClear(transport, e));
  bus.on('boss:telegraph', (e) => director.onBossTelegraph(transport, e));
  bus.on('boss:phase', (e) => director.onBossPhase(transport, e));
  bus.on('boss:defeat', () => director.onBossDefeat(transport));
  bus.on('player:hit', () => director.onPlayerHit());
  bus.on('player:death', () => director.onPlayerDeath(transport));
  bus.on('player:bomb', () => director.onBomb(transport));
  bus.on('powerup:pickup', (e) => director.onPickup(transport, e.kind));
  bus.on('powerup:expire', (e) => director.onPickup(transport, e.kind));

  /*
   * A MOVING bot, same policy as render.mjs/realprobe/wiring.
   *
   * A parked stick is treated by `World` as not playing: `campPressure` ramps,
   * bullets speed up and the rescue mechanics switch off, so a long lead-in
   * ends in `collapse` and the capture records a dying run rather than a game.
   */
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: 0, banish: -1, reroll: false, skip: false,
  };
  const steer = (n, dt) => {
    inp.x = Math.sin(n * dt * 3.0) * 0.35;
    inp.y = Math.cos(n * dt * 2.3) * 0.25;
  };

  const warmSteps = Math.round(60 * LEAD_IN);
  for (let i = 0; i < warmSteps; i++) {
    steer(i, 1 / 60);
    world.update(1 / 60, inp);
    transport.advance(1 / 60);
    director.update(world.snapshot, transport, 1 / 60);
  }

  const DT = 1 / 120;
  /*
   * The state is read at BOTH ends of the recording, and printing only one of
   * them would be its own small lie. The arrangement moves — `render.mjs`
   * measured a 12.9 dB p10-p90 loudness range over a live 32 bars against 3.6
   * dB for a frozen snapshot — so a capture that opens in `drop` and ends in
   * `breakdown` is a mix of two different pieces, and the band table is their
   * average. When the two lines below disagree, read the table accordingly.
   */
  /*
   * SNAPSHOT the readout, because `levels` is a live reference.
   *
   * `MusicDirector.readout` returns `levels: this.levels` — the director's own
   * mutable object, not a copy. So the "bar 0" and "bar 128" lines printed
   * below were the SAME eleven numbers every time, both showing the state at
   * the END of the render, while the section, bpm and key beside them were
   * genuine (those are primitives and get copied by the object literal). Two
   * lines that exist precisely to show that the arrangement moved were
   * reporting that it had not.
   *
   * Fixed here rather than in the director: a live reference is the right thing
   * for the HUD, which reads it every frame, and every other caller in `tools/`
   * consumes it immediately. Only a tool that keeps a readout across time needs
   * a copy, and there are two of them, both in this file.
   */
  const snap = (r) => ({ ...r, levels: { ...r.levels } });
  const startReadout = snap(director.readout(transport));
  const startBar = Math.floor(transport.bar) + 1;
  const events = [];
  /*
   * WHERE EACH BAR STARTS, AND WHAT THE SCORE THOUGHT IT WAS DOING THERE.
   *
   * Recorded so `--windows` can label a slice of the WAV with the section and
   * the act that produced it. Without this the time-resolved table would be a
   * loudness curve with no explanation attached, and a loudness curve that
   * cannot be tied to a decision is exactly the "we relabelled it" finding
   * `sections.mjs` warns about in its own footer.
   */
  const timeline = [];
  let sec = 0;
  let guardTotal = 0;
  for (let i = 0; i < BARS; i++) {
    const target = startBar + i;
    let guard = 0;
    while (Math.floor(transport.bar) < target && guard++ < 100000) {
      steer(warmSteps + ++guardTotal, DT);
      world.update(DT, inp);
      transport.advance(DT);
      director.update(world.snapshot, transport, DT);
    }
    const rd = director.readout(transport);
    const spb = (60 / rd.bpm) * 4;
    const cps = 1 / spb;
    timeline.push({
      bar: i,
      t: sec,
      section: rd.section,
      act: rd.act ?? '-',
      bpm: rd.bpm,
      key: rd.key,
      energy: rd.energy,
      tacet: rd.tacet ?? null,
      levels: { ...rd.levels },
    });
    for (const h of director.masterPattern().queryArc(target, target + 1)) {
      if (h.hasOnset && !h.hasOnset()) continue;
      const b = Number(h.whole?.begin ?? h.part.begin);
      const e = Number(h.whole?.end ?? h.part.end);
      if (!Number.isFinite(b) || !Number.isFinite(e)) continue;
      events.push({
        v: h.value ?? {},
        // Absolute seconds into the render.
        t: sec + (b - target) * spb,
        d: Math.max(1 / SR, (e - b) * spb),
        cps,
        // superdough's fifth argument is a CYCLE number, not seconds
        // (`superdough.mjs:807` divides it by cps). Rebased onto the render.
        cyc: sec * cps + (b - target),
      });
    }
    sec += spb;
  }
  events.sort((a, b) => a.t - b.t);

  return { events, span: sec, timeline, startReadout, endReadout: snap(director.readout(transport)) };
}

/* --------------------------------------------------------------- the page */

/*
 * A three-route static server rather than the Vite dev server.
 *
 * The dev server would work and is what every other browser tool here uses,
 * but it exists to serve the GAME, and the game boots a realtime AudioContext
 * on start. All this page needs is superdough's prebuilt ESM bundle — which
 * inlines its AudioWorklets as base64 `data:` URLs, so it is self-contained
 * apart from `nanostores`. Two entries in an import map cover it, and the tool
 * gains no dependency on a dev server being up.
 */
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
const PAGE_HTML = `<!doctype html><meta charset="utf-8"><title>capture</title>
<script type="importmap">{"imports":{
  "nanostores":"/node_modules/nanostores/index.js",
  "superdough":"/node_modules/superdough/dist/index.mjs"
}}</script><body></body>`;

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
      return;
    }
    const file = join(ROOT, url.pathname);
    if (!file.startsWith(ROOT + sep) || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/**
 * Render one hap list through real superdough into an OfflineAudioContext.
 * Returns interleaved 16-bit PCM plus the float peak, measured before
 * quantisation so a clipped render is visible rather than clamped away.
 */
async function renderInBrowser(page, events, seconds) {
  return page.evaluate(
    async ({ events, seconds, sr, maxPoly, audioSeed, suppressRelease }) => {
      /*
       * Optionally stop superdough tearing its own graph down mid-render.
       *
       * `onceEnded` (helpers.mjs:606) is a plain `node.onended = fn`, and the
       * callbacks it installs end in `releaseAudioNode`: `disconnect()`,
       * `cancelScheduledValues(context.currentTime)`, and for worklets
       * `parameters.get('end').setValueAtTime(0, 0)`. In a realtime context
       * those fire after the node is done and are pure housekeeping. Inside
       * `startRendering()` they fire on the MAIN thread while the render
       * proceeds on its own schedule, so which of them lands before which
       * block of samples is decided by wall-clock. Blocking the callback
       * removes the race; nothing else in the chain depends on it, because
       * every `superdough()` call has already happened before rendering
       * starts, so no node is ever recycled into a later note.
       *
       * On by default, and NOT taken on faith. A listening tool that quietly
       * alters the engine is the failure mode `render.mjs`'s 8x-too-long
       * release was, so it is measured both ways and `--keep-releases` stays:
       * with the reverb wait in place the two agree in every band, at the peak,
       * the RMS and the integrated LUFS. See the header.
       */
      if (suppressRelease) {
        Object.defineProperty(AudioScheduledSourceNode.prototype, 'onended', {
          configurable: true,
          get: () => null,
          set: () => {},
        });
      }
      /*
       * Seed Math.random BEFORE superdough is imported.
       *
       * The reverb impulse response and every noise buffer are drawn from it.
       * Unseeded, two runs of the same score differ by a fraction of a dB in
       * every band — small, but exactly the size of the differences this tool
       * exists to adjudicate.
       */
      let s = audioSeed >>> 0;
      let randomCalls = 0;
      Math.random = () => {
        randomCalls++;
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      /*
       * THE REVERB IMPULSE IS RENDERED IN ITS OWN OfflineAudioContext, AND
       * NOBODY WAITS FOR IT.
       *
       * `reverbGen.applyGradualLowpass` (reverbGen.mjs:85) builds the impulse
       * response, runs it through a second `OfflineAudioContext`, and assigns
       * `convolver.buffer` from that context's `oncomplete`. Nothing in
       * superdough joins on it — in a realtime context that is fine, the
       * reverb simply arrives a few milliseconds late. In an offline render it
       * is a coin flip: if `startRendering()` on the main context wins, the
       * convolver is still empty and the whole render comes out with no room
       * on it.
       *
       * This is the single largest source of run-to-run difference in this
       * tool. Measured, 16 bars: unwaited, two renders differ by -10 dB
       * relative with a worst octave-band delta of 1.33 dB; waited, -68 dB and
       * 0.000 dB. It is not a small correction and it is not cosmetic — half
       * the captures were of a dry mix.
       *
       * So every OfflineAudioContext except our own is counted, and the main
       * render does not start until they have all finished and their
       * `oncomplete` callbacks have run.
       */
      /*
       * WeakRef HOLDS STRONGLY HERE, because otherwise the render depends on
       * when the garbage collector ran.
       *
       * superdough's polyphony reaper (`superdough.mjs:525`) walks
       * `activeSoundSources`, whose values are `new WeakRef(soundHandle)`
       * (`:568`), and ramps the oldest voice to zero when the cap is exceeded.
       * If GC has already collected that handle, `deref()` yields undefined
       * and the voice is silently spared instead. So which notes get reaped is
       * decided by the collector, and it is decided ONCE per process: two
       * renders inside one Chromium agreed to 0.000 dB in every band while two
       * consecutive invocations of this tool disagreed by 1.4 dB at 500 Hz.
       * That is not a rounding error, it is a different mix.
       *
       * Holding strongly costs one retained object per scheduled hap — a few
       * hundred for a normal capture — and makes the cap behave the way it
       * reads on the page.
       */
      globalThis.WeakRef = class StrongRef {
        constructor(value) {
          this._v = value;
        }
        deref() {
          return this._v;
        }
      };

      /*
       * Wait on the THING NEEDED, not on a proxy for it.
       *
       * Counting side renders was the first attempt and it was not enough:
       * `convolver.buffer` is assigned from that context's `oncomplete`, which
       * lands some time after the render promise resolves, and under load
       * "some time" is longer. Two browsers running at once produced two
       * different mixes, 1.3 dB apart in the 500 Hz band, from the same haps.
       * Tracking every convolver and waiting for each to actually hold a
       * buffer tests the condition instead of guessing at it.
       */
      const convolvers = [];
      const origCreateConvolver = BaseAudioContext.prototype.createConvolver;
      BaseAudioContext.prototype.createConvolver = function (...args) {
        const c = origCreateConvolver.apply(this, args);
        convolvers.push(c);
        return c;
      };
      const dryConvolvers = () => convolvers.filter((c) => c.buffer == null).length;

      let pendingRenders = 0;
      let sideRenders = 0;
      const origStartRendering = OfflineAudioContext.prototype.startRendering;
      OfflineAudioContext.prototype.startRendering = function (...args) {
        const mine = this.__captureMain === true;
        if (!mine) { pendingRenders++; sideRenders++; }
        const p = origStartRendering.apply(this, args);
        if (!mine) Promise.resolve(p).catch(() => {}).finally(() => pendingRenders--);
        return p;
      };
      const nap = (ms) => new Promise((r) => setTimeout(r, ms));
      const settle = async () => {
        /*
         * Wait for quiet, then keep watching, because an `oncomplete` can
         * start ANOTHER side render. A loop that stops the first time the
         * counter reads zero misses those, and a missing impulse response is
         * a whole reverb bus absent from the capture.
         */
        for (let round = 0; round < 40; round++) {
          for (let g = 0; g < 4000 && (pendingRenders > 0 || dryConvolvers() > 0); g++) await nap(5);
          // `oncomplete` is dispatched separately from the promise; give it turns.
          for (let i = 0; i < 10; i++) await nap(0);
          let quiet = true;
          for (let i = 0; i < 10; i++) {
            await nap(10);
            if (pendingRenders > 0 || dryConvolvers() > 0) { quiet = false; break; }
          }
          if (quiet) return 0;
        }
        return pendingRenders + dryConvolvers();
      };

      const sd = await import('superdough');
      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
      sd.setAudioContext(ctx);
      // engine.ts's boot, minus the parts that only matter to a live context.
      sd.setLogger(() => {});
      await sd.initAudio({ maxPolyphony: maxPoly });
      await sd.registerSynthSounds();
      sd.registerZZFXSounds();
      sd.setGainCurve((x) => x * x);
      sd.setMaxPolyphony(maxPoly);

      const kinds = {};
      let scheduled = 0;
      const errors = [];
      // Ascending onset order matters: controls like `cut` depend on the graph
      // state left by earlier events. `renderPatternAudio` sorts for the same
      // reason.
      for (const ev of events) {
        kinds[ev.v.s ?? '(none)'] = (kinds[ev.v.s ?? '(none)'] ?? 0) + 1;
        try {
          await sd.superdough(ev.v, ev.t, ev.d, ev.cps, ev.cyc);
          scheduled++;
        } catch (err) {
          if (errors.length < 5) errors.push(String(err?.message ?? err));
        }
      }

      const leftover = await settle();
      ctx.__captureMain = true;
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0);
      const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      let peak = 0;
      for (let i = 0; i < L.length; i++) {
        const a = Math.abs(L[i]);
        const b = Math.abs(R[i]);
        if (a > peak) peak = a;
        if (b > peak) peak = b;
      }
      // Interleaved 16-bit, built in the page so only the bytes cross the wire.
      const pcm = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) {
        const l = Math.max(-1, Math.min(1, L[i]));
        const r = Math.max(-1, Math.min(1, R[i]));
        pcm[i * 2] = l < 0 ? l * 0x8000 : l * 0x7fff;
        pcm[i * 2 + 1] = r < 0 ? r * 0x8000 : r * 0x7fff;
      }
      const bytes = new Uint8Array(pcm.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      window.__capture = btoa(bin);
      return { frames: L.length, peak, scheduled, kinds, errors, leftover, sideRenders, convolvers: convolvers.length, randomCalls, chars: window.__capture.length };
    },
    { events, seconds, sr: SR, maxPoly: 96, audioSeed: AUDIO_SEED, suppressRelease: SUPPRESS_RELEASE },
  );
}

/** Pull the base64 payload back in slices; one 15 MB string over CDP is asking for trouble. */
async function drain(page, chars) {
  const CHUNK = 4 << 20;
  const parts = [];
  for (let at = 0; at < chars; at += CHUNK) {
    parts.push(await page.evaluate(([a, n]) => window.__capture.substr(a, n), [at, CHUNK]));
  }
  return Buffer.from(parts.join(''), 'base64');
}

/* ------------------------------------------------------------------- wav */

function wav16(pcm, sr, channels) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/* -------------------------------------------------------------- analysis */

/** In-place iterative radix-2 Cooley-Tukey, same shape as spectrum.mjs's. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Nominal octave-band centres. Edges are centre/√2 .. centre·√2. */
const BAND_CENTRES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Per-band mean square, by Parseval over Hann-windowed frames.
 *
 * `residual` is the share of the signal's total mean square that fell OUTSIDE
 * every band — below 22 Hz or above 22.6 kHz. It is printed rather than
 * discarded, because a band table that silently loses energy is a band table
 * that can be wrong without looking wrong.
 */
function octaveBands(mono, sr) {
  const N = 8192;
  const HOP = N / 2;
  const win = new Float64Array(N);
  let winPow = 0;
  for (let i = 0; i < N; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    winPow += win[i] * win[i];
  }
  winPow /= N;

  const edges = BAND_CENTRES.map((c) => [c / Math.SQRT2, c * Math.SQRT2]);
  const acc = new Float64Array(BAND_CENTRES.length);
  let accAll = 0;
  let frames = 0;
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  for (let start = 0; start + N <= mono.length; start += HOP) {
    for (let i = 0; i < N; i++) {
      re[i] = mono[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    // Single-sided power, normalised so the sum over bins equals the frame's
    // windowed mean square (Parseval), then de-windowed by the window power.
    const scale = 1 / (N * N * winPow);
    for (let k = 1; k < N / 2; k++) {
      const p = 2 * (re[k] * re[k] + im[k] * im[k]) * scale;
      const hz = (k * sr) / N;
      accAll += p;
      for (let b = 0; b < edges.length; b++) {
        if (hz >= edges[b][0] && hz < edges[b][1]) {
          acc[b] += p;
          break;
        }
      }
    }
    frames++;
  }
  if (frames === 0) return { frames: 0, ms: acc, total: 0, residual: 0 };
  for (let b = 0; b < acc.length; b++) acc[b] /= frames;
  accAll /= frames;
  const inBands = acc.reduce((a, b) => a + b, 0);
  return { frames, ms: acc, total: accAll, residual: accAll - inBands };
}

/** RBJ biquad, run forward over one channel. */
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Integrated loudness, BS.1770-4 shape: K-weighting, 400 ms blocks at 75%
 * overlap, absolute gate at -70 LUFS and a relative gate 10 LU below the
 * ungated mean.
 *
 * The two filters are the published prototypes — a +4 dB high shelf at
 * 1681.97 Hz and a highpass at 38.13 Hz, Q 0.5003 — realised with RBJ
 * cookbook formulas at the ACTUAL sample rate rather than by copying the
 * 48 kHz coefficient table out of the standard, which would be wrong at 44.1k
 * in exactly the way a copied constant is always wrong.
 *
 * Calibration is not asserted from the maths: `--selftest` pushes a 1 kHz
 * -20 dBFS stereo sine through this same function and prints what it reads,
 * so the offset can be checked against an answer known in advance rather
 * than trusted.
 */
function lufs(L, R, sr) {
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const A = Math.pow(10, G / 40);
    const w0 = (2 * Math.PI * f0) / sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const tsa = 2 * Math.sqrt(A) * alpha;
    const b0 = A * (A + 1 + (A - 1) * cw + tsa);
    const b1 = -2 * A * (A - 1 + (A + 1) * cw);
    const b2 = A * (A + 1 + (A - 1) * cw - tsa);
    const a0 = A + 1 - (A - 1) * cw + tsa;
    const a1 = 2 * (A - 1 - (A + 1) * cw);
    const a2 = A + 1 - (A - 1) * cw - tsa;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  })();
  const hp = (() => {
    const f0 = 38.13547087602444;
    const Q = 0.5003270373238773;
    const w0 = (2 * Math.PI * f0) / sr;
    const cw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    const b0 = (1 + cw) / 2;
    const b1 = -(1 + cw);
    const b2 = (1 + cw) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cw;
    const a2 = 1 - alpha;
    return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  })();

  const k = (ch) => biquad(biquad(ch, ...shelf), ...hp);
  const kl = k(L);
  const kr = k(R);

  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const blocks = [];
  for (let start = 0; start + block <= kl.length; start += step) {
    let zl = 0;
    let zr = 0;
    for (let i = start; i < start + block; i++) {
      zl += kl[i] * kl[i];
      zr += kr[i] * kr[i];
    }
    blocks.push((zl + zr) / block);
  }
  if (!blocks.length) return { lufs: -Infinity, blocks: 0, gated: 0 };
  const loud = (z) => -0.691 + 10 * Math.log10(Math.max(z, 1e-30));
  const absPass = blocks.filter((z) => loud(z) > -70);
  if (!absPass.length) return { lufs: -Infinity, blocks: blocks.length, gated: 0 };
  const mean = absPass.reduce((a, b) => a + b, 0) / absPass.length;
  const relGate = loud(mean) - 10;
  const relPass = absPass.filter((z) => loud(z) > relGate);
  const use = relPass.length ? relPass : absPass;
  const gmean = use.reduce((a, b) => a + b, 0) / use.length;
  return { lufs: loud(gmean), blocks: blocks.length, gated: use.length };
}

const dB = (ms) => (ms > 0 ? 10 * Math.log10(ms) : -Infinity);
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(7) : '   -inf');

function report(pcm, label) {
  const frames = pcm.length / 4;
  const L = new Float64Array(frames);
  const R = new Float64Array(frames);
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    L[i] = pcm.readInt16LE(i * 4) / 32768;
    R[i] = pcm.readInt16LE(i * 4 + 2) / 32768;
    mono[i] = (L[i] + R[i]) / 2;
  }
  const bands = octaveBands(mono, SR);
  const loud = lufs(L, R, SR);
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const rms = Math.sqrt(mono.reduce((a, v) => a + v * v, 0) / frames);

  if (bands.frames === 0) {
    console.error('capture: 0 analysis frames — the render is shorter than one 8192-sample window');
    process.exitCode = 1;
  }

  console.log('');
  console.log(`  ${label}`);
  console.log(`  ${'Hz'.padStart(7)} ${'dBFS'.padStart(7)}  share  ${''}`);
  const totalMs = bands.ms.reduce((a, b) => a + b, 0);
  for (let b = 0; b < BAND_CENTRES.length; b++) {
    const share = totalMs > 0 ? (bands.ms[b] / totalMs) * 100 : 0;
    const bar = '#'.repeat(Math.round(share / 2));
    console.log(
      `  ${String(BAND_CENTRES[b]).padStart(7)} ${fmt(dB(bands.ms[b]))}  ${share.toFixed(1).padStart(5)}%  ${bar}`,
    );
  }
  console.log(
    `  analysis frames ${bands.frames} (8192-pt Hann, 50% hop) — out-of-band residual ` +
      `${bands.total > 0 ? ((bands.residual / bands.total) * 100).toFixed(2) : '0.00'}% of total energy`,
  );
  console.log(
    `  peak ${peak.toFixed(4)} (${fmt(20 * Math.log10(Math.max(peak, 1e-9))).trim()} dBFS)   ` +
      `rms ${rms.toFixed(4)} (${fmt(20 * Math.log10(Math.max(rms, 1e-9))).trim()} dBFS)   ` +
      `crest ${(20 * Math.log10(peak / Math.max(rms, 1e-9))).toFixed(1)} dB`,
  );
  console.log(
    `  integrated ${loud.lufs.toFixed(2)} LUFS (BS.1770-4 gating; ${loud.gated}/${loud.blocks} blocks kept)`,
  );
  return { bands, loud, peak, rms };
}

/* ------------------------------------------------------------------- run */

if (SELFTEST) {
  /*
   * A known answer, so the analyser is not the thing under test when a real
   * capture looks odd. 1 kHz at -20 dBFS in both channels: every joule should
   * land in the 1000 Hz band and nowhere else.
   */
  const secs = 5;
  const n = SR * secs;
  const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / SR);
    const s = Math.round(v * 32767);
    pcm.writeInt16LE(s, i * 4);
    pcm.writeInt16LE(s, i * 4 + 2);
  }
  console.log('capture --selftest: 1 kHz sine, amplitude 0.1 (-20.0 dBFS), both channels, 5 s');
  console.log('  expected: essentially all energy in the 1000 Hz band; band dBFS about -23.0');
  console.log('            (a sine of amplitude A has mean square A^2/2, i.e. -3 dB from its peak)');
  report(pcm, 'selftest — 1 kHz -20 dBFS sine');
  process.exit(process.exitCode ?? 0);
}

const t0 = Date.now();
const { events, span, timeline, startReadout, endReadout } = await buildScore();
const hapHash = createHash('sha1').update(JSON.stringify(events)).digest('hex').slice(0, 12);

const stateLine = (label, r) =>
  `  ${label.padEnd(6)} ${r.section} ${r.bpm}bpm ${r.key} energy ${r.energy.toFixed(2)} tension ${r.tension.toFixed(2)}` +
  `\n         faders ${Object.entries(r.levels)
    .filter(([, v]) => v > 0.02)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(' ')}`;

console.log('');
console.log(
  `capture — ${BARS} bars, stem=${STEM}, world seed 0x${SEED.toString(16)}, audio seed ${AUDIO_SEED}, ` +
    `node release ${SUPPRESS_RELEASE ? 'BLOCKED (default)' : 'live (--keep-releases)'}`,
);
console.log(stateLine(`bar 0`, startReadout));
console.log(stateLine(`bar ${BARS}`, endReadout));
console.log(`  ${events.length} haps over ${span.toFixed(2)}s  (hap-stream sha1 ${hapHash})`);

/*
 * Zero is a FAILURE, not a quiet pass. AGENTS §3: "print every denominator;
 * treat checked === 0 as a failure". A capture of nothing writes a perfectly
 * valid silent WAV and every band reads -inf, which looks like a result.
 */
if (events.length === 0) {
  console.error('capture: the master pattern produced NO haps — nothing was rendered');
  process.exit(1);
}

const server = await startServer();
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// nanostores' unbundled entry reads process.env.NODE_ENV; Vite would define it
// away, and a bare import map does not.
await page.addInitScript(() => {
  globalThis.process = { env: { NODE_ENV: 'production' } };
});
await page.goto(`http://127.0.0.1:${port}/`);

const seconds = span + TAIL;
const first = await renderInBrowser(page, events, seconds);
const pcm = await drain(page, first.chars);

let secondHash = null;
let secondPcm = null;
let scoreRepeatHash = null;
if (TWICE) {
  /*
   * Re-derive the SCORE in this process, and re-run the WHOLE TOOL in another.
   *
   * Two renders inside one browser is the cheap version of this check and it
   * lied in both directions. It first reported 0.000 dB in every band, which
   * was the two renders sharing a process; moving the second one into a
   * freshly launched browser then reported a flat 1.329 dB in the 500 Hz band,
   * every single time, with the same 0.05292 sample delta — while three
   * consecutive ordinary invocations of the tool produced identical output.
   * Whatever the second browser in one Node process perturbs, it is an
   * artefact of the harness and not of the tool. Closing the first browser
   * first did not remove it; nor did waiting for all 49 impulse-response side
   * renders and all four convolver buffers; nor did holding superdough's
   * `WeakRef`s strongly.
   *
   * So the check now does what a person does: runs `capture` again, from a
   * clean process, and compares the WAVs. A gate that measures a different
   * thing from the one people use is the recurring mistake this whole
   * directory is a monument to.
   */
  const again = await buildScore();
  scoreRepeatHash = createHash('sha1').update(JSON.stringify(again.events)).digest('hex').slice(0, 12);
}

if (!KEEP_OPEN) await browser.close();
server.close();


console.log(
  `  scheduled ${first.scheduled}/${events.length} haps into an OfflineAudioContext ` +
    `(${first.frames} frames, ${(first.frames / SR).toFixed(2)}s); ` +
    `${first.sideRenders} impulse-response render(s) and ${first.convolvers} reverb bus(es) waited for; ` +
    `${first.randomCalls} seeded Math.random draws`,
);
console.log(
  `  sources: ${Object.entries(first.kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}×${n}`)
    .join(' ')}`,
);
if (first.errors.length) console.log(`  superdough errors: ${first.errors.join(' | ')}`);
/*
 * Zero is the expected value and it is printed anyway. A silent "we waited"
 * is indistinguishable from "we never checked"; a non-zero here means an
 * impulse response was still rendering when the capture started, and the
 * reverb on that WAV is wrong.
 */
if (first.leftover !== 0) {
  console.log(`  WARNING: ${first.leftover} side render(s) still in flight when the capture started — reverb may be missing`);
}
if (pageErrors.length) console.log(`  page errors: ${pageErrors.slice(0, 3).join(' | ')}`);

mkdirSync(resolve(OUT, '..'), { recursive: true });
writeFileSync(OUT, wav16(pcm, SR, 2));
const hash = createHash('sha256').update(pcm).digest('hex');
console.log(`  wrote ${OUT} (${(pcm.length / 1e6).toFixed(1)} MB pcm, sha256 ${hash.slice(0, 16)})`);

const analysis = report(pcm, `octave bands — ${STEM === 'all' ? 'full mix' : `${STEM} soloed`}, ${BARS} bars`);

/* ------------------------------------------------- time-resolved analysis */

if (WINDOWS > 1) {
  /*
   * The same analyser, applied to slices instead of to the whole file.
   *
   * `report` is deliberately reused rather than re-implemented: a windowed
   * table computed by a second copy of the octave-band code would drift from
   * the aggregate one the first time either was touched, and this directory
   * keeps an incident log about exactly that. The slice boundaries are on
   * sample counts rather than on bar lines because the tempo moves during a
   * render, so a "16-bar window" is not a fixed number of samples; the labels
   * below come from the timeline instead, which knows.
   */
  const frames = pcm.length / 4;
  const per = Math.floor(frames / WINDOWS);
  const rows = [];
  for (let k = 0; k < WINDOWS; k++) {
    const from = k * per;
    const to = k === WINDOWS - 1 ? frames : (k + 1) * per;
    const slice = pcm.subarray(from * 4, to * 4);
    const L = new Float64Array(to - from);
    const Rr = new Float64Array(to - from);
    const mono = new Float64Array(to - from);
    for (let i = 0; i < to - from; i++) {
      L[i] = slice.readInt16LE(i * 4) / 32768;
      Rr[i] = slice.readInt16LE(i * 4 + 2) / 32768;
      mono[i] = (L[i] + Rr[i]) / 2;
    }
    const bands = octaveBands(mono, SR);
    const loud = lufs(L, Rr, SR);
    let peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
    const rms = Math.sqrt(mono.reduce((a, v) => a + v * v, 0) / mono.length);
    // Which bars of the score produced this slice, and what it was doing.
    const t0 = (from / SR);
    const t1 = (to / SR);
    const inWin = timeline.filter((b) => b.t >= t0 - 1e-9 && b.t < t1);
    const secs = [...new Set(inWin.map((b) => b.section))].join('/');
    const acts = [...new Set(inWin.map((b) => b.act))].map((a) => a.slice(0, 3)).join('/');
    const keys = [...new Set(inWin.map((b) => b.key))].join(' ');
    const fwd = inWin.length
      ? inWin.reduce((a, b) => a + Object.values(b.levels).filter((v) => v > 0.15).length, 0) / inWin.length
      : 0;
    const tacets = [...new Set(inWin.map((b) => b.tacet).filter(Boolean))].join(',');
    rows.push({ k, t0, t1, bands, loud, peak, rms, secs, acts, keys, fwd, bars: inWin.length, tacets });
  }

  console.log('');
  console.log(`  TIME-RESOLVED — ${WINDOWS} windows of ${(span / WINDOWS).toFixed(1)}s over ${BARS} bars`);
  console.log(
    '  NOISE FLOOR: repeat renders of one identical hap stream differ by up to 1.329 dB ' +
      '(500 Hz band).' + String.fromCharCode(10) +
      '  A full-mix window-to-window difference under ~1.4 dB is NOT a result.',
  );
  console.log('');
  const cols = [63, 125, 250, 500, 1000, 2000, 4000];
  console.log(
    `  ${'win'.padStart(3)} ${'act'.padEnd(11)} ${'section'.padEnd(20)} ${'bars'.padStart(4)} ` +
      `${'LUFS'.padStart(7)} ${'rms dB'.padStart(7)} ${'fwd'.padStart(4)}  ` +
      cols.map((c) => `${c}Hz`.padStart(8)).join(''),
  );
  for (const r of rows) {
    console.log(
      `  ${String(r.k).padStart(3)} ${r.acts.padEnd(11)} ${r.secs.padEnd(20)} ${String(r.bars).padStart(4)} ` +
        `${r.loud.lufs.toFixed(2).padStart(7)} ${(20 * Math.log10(Math.max(r.rms, 1e-9))).toFixed(2).padStart(7)} ` +
        `${r.fwd.toFixed(1).padStart(4)}  ` +
        cols.map((c) => fmt(dB(r.bands.ms[BAND_CENTRES.indexOf(c)]))).join(''),
    );
  }
  console.log(`        keys: ${rows.map((r) => r.keys).join(' | ')}`);
  if (rows.some((r) => r.tacets)) console.log(`        tacet lanes seen: ${rows.map((r) => r.tacets || '-').join(' | ')}`);

  /*
   * The spread per column, which is the actual verdict.
   *
   * AGENTS.md §3 asks how a check could be satisfied without changing anything.
   * This one could: a render whose windows all read the same is FLAT, and a
   * flat render means the form is in the source and not in the speakers. So the
   * spread is printed for every column and compared against the instrument's
   * own noise floor rather than against zero.
   */
  const NOISE = 1.4;
  console.log('');
  console.log(`  window-to-window SPREAD (max - min), against a ${NOISE} dB noise floor:`);
  const spreadOf = (vals) => Math.max(...vals) - Math.min(...vals);
  const lufsSpread = spreadOf(rows.map((r) => r.loud.lufs));
  const rmsSpread = spreadOf(rows.map((r) => 20 * Math.log10(Math.max(r.rms, 1e-9))));
  console.log(`    integrated loudness  ${lufsSpread.toFixed(2)} LU${lufsSpread > NOISE ? '   <- above the floor' : ''}`);
  console.log(`    rms                  ${rmsSpread.toFixed(2)} dB${rmsSpread > NOISE ? '   <- above the floor' : ''}`);
  let bandsAbove = 0;
  for (const c of cols) {
    const i = BAND_CENTRES.indexOf(c);
    const sp = spreadOf(rows.map((r) => dB(r.bands.ms[i])));
    if (sp > NOISE) bandsAbove++;
    console.log(`    ${String(c).padStart(5)} Hz band       ${Number.isFinite(sp) ? sp.toFixed(2) : '  inf'} dB${sp > NOISE ? '   <- above the floor' : ''}`);
  }
  console.log(
    `${String.fromCharCode(10)}  ${bandsAbove}/${cols.length} octave bands move by more than the noise floor across the render; ` +
      `loudness ${lufsSpread > NOISE ? 'does' : 'does NOT'}.`,
  );
  if (bandsAbove === 0 && lufsSpread <= NOISE) {
    console.log('  READ THAT PLAINLY: this render is statistically flat end to end. Whatever');
    console.log('  structure is in the source is not reaching the speakers.');
  }
}

if (TWICE) {
  /*
   * N MORE COMPLETE RUNS OF THE TOOL, in clean child processes, and the spread
   * across all of them is what gets reported.
   *
   * Three earlier versions of this check were each wrong in a way that made
   * the tool look better than it is, which is worth recording because they are
   * the same wrongness in three costumes:
   *
   *   1. Render twice in ONE browser: 0.000 dB in every band. The two renders
   *      shared a process.
   *   2. Render the second one in a freshly launched browser: a flat 1.329 dB
   *      in the 500 Hz band, every time — an artefact of two Chromiums in one
   *      Node process, which no user will ever hit.
   *   3. Re-run the whole tool ONCE: 0.000 dB, and that was luck. The render
   *      has two stable modes and a single re-run agrees with the first about
   *      half the time.
   *
   * A comparison of two samples cannot distinguish "reproducible" from "landed
   * in the same mode twice", so this takes several and prints how many
   * distinct outputs it saw. `--verify-determinism=N` sets the count.
   */
  const runsArg = argv.find((a) => a.startsWith('--verify-determinism='));
  const RERUNS = Math.max(1, Number(runsArg ? runsArg.split('=')[1] : 3));
  const seen = [{ hash, pcm, tag: 'run 1' }];
  for (let r = 0; r < RERUNS; r++) {
    const rerunOut = `${OUT}.rerun${r}.wav`;
    const args = [
      '--experimental-transform-types',
      fileURLToPath(new URL('capture.mjs', import.meta.url)),
      ...argv.filter((a) => !a.startsWith('--verify-determinism') && !a.startsWith('--out=')),
      `--out=${rerunOut}`,
    ];
    const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    if (res.status !== 0) {
      console.log(`  determinism: re-run ${r + 2} FAILED (exit ${res.status})`);
      console.log(String(res.stderr ?? '').split(String.fromCharCode(10)).slice(-6).join(' | ').trim());
      process.exitCode = 1;
      break;
    }
    const wav = readFileSync(rerunOut);
    const p2 = wav.subarray(44);
    seen.push({ hash: createHash('sha256').update(p2).digest('hex'), pcm: p2, tag: `run ${r + 2}` });
    rmSync(rerunOut, { force: true });
  }

  console.log('');
  if (scoreRepeatHash === hapHash) {
    console.log(`  score: reproducible — a second full build of ${BARS} bars gives hap-stream sha1 ${scoreRepeatHash}`);
  } else {
    console.log(`  score: NOT reproducible — ${hapHash} vs ${scoreRepeatHash}. The director is carrying state.`);
    process.exitCode = 1;
  }

  const distinct = new Map();
  for (const r of seen) {
    if (!distinct.has(r.hash)) distinct.set(r.hash, []);
    distinct.get(r.hash).push(r.tag);
  }
  if (distinct.size === 1) {
    console.log(
      `  render: ${seen.length}/${seen.length} complete runs BYTE-IDENTICAL (sha256 ${hash.slice(0, 16)})`,
    );
  } else {
    /*
     * More than one output. Print the SPREAD, not a verdict: the number a
     * person needs is how big a band difference has to be before it means
     * something, and that is the width of this distribution.
     */
    const monoOf = (buf) => {
      const n = buf.length / 4;
      const m = new Float64Array(n);
      for (let i = 0; i < n; i++) m[i] = (buf.readInt16LE(i * 4) + buf.readInt16LE(i * 4 + 2)) / 2 / 32768;
      return m;
    };
    const tables = seen.map((r) => octaveBands(monoOf(r.pcm), SR).ms);
    let worst = 0;
    let worstHz = 0;
    for (let b = 0; b < BAND_CENTRES.length; b++) {
      const vals = tables.map((t) => dB(t[b])).filter(Number.isFinite);
      const spread = Math.max(...vals) - Math.min(...vals);
      if (spread > worst) {
        worst = spread;
        worstHz = BAND_CENTRES[b];
      }
    }
    console.log(
      `  render: ${distinct.size} DISTINCT outputs across ${seen.length} complete runs ` +
        `(${[...distinct.values()].map((v) => v.length).join('/')} runs each)`,
    );
    console.log(`    worst octave-band spread ${worst.toFixed(3)} dB, in the ${worstHz} Hz band`);
    console.log('    treat differences smaller than that as noise, not as results');
  }
}

console.log('');
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s wall clock`);

if (first.scheduled === 0) {
  console.error('capture: superdough accepted zero haps — the render is silent by construction');
  process.exit(1);
}
