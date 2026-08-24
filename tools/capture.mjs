/**
 * capture — a WAV of what the game ACTUALLY sounds like, recorded off the
 * running game's own audio graph.
 *
 * WHY. The master plan's Phase 0 (S0) lists this as the blocking dependency for
 * the whole of Track S: the listening pass and the `crest` gate both want
 * "before/after WAV pairs at fixed seeds", and the only WAV writer this
 * repository had is `tools/render.mjs`, whose own header rules itself out for
 * that job in as many words —
 *
 *     "No reverb, no delay, no echo ... one-pole filters ... judge the WRITING
 *      from this ... Do not judge the SOUND."
 *
 * Every single thing Track S changes lives in the half render.mjs discards:
 * per-orbit algorithmic rooms (S-e), the narrow `duckorbit` (S-e), filter-bloom
 * onsets via `lpenv`/`lpattack` (S-b), FM/additive beds (S-d), and envelope
 * floors as superdough's own ADSR renders them (S-a). A before/after pair from
 * render.mjs would be **identical exactly where the work happened** — a
 * listening pass on such a pair would report "no change" and be right, about
 * the wrong file. This tool exists so that never happens.
 *
 * ------------------------------------------------------------ WHAT IT DOES
 *
 *   node tools/capture.mjs [seconds] [out.wav]
 *   SECS=90 WAVE=12 SEED=0x51ed OUT=renders/w12-before.wav node tools/capture.mjs
 *
 * Boots the game headless, plays it with the real bot (`lib/driver.mjs` — never
 * a hand-rolled one; see the `deadair` entry in tools/README.md for what a fake
 * player costs), optionally jumps to a wave, and records the master bus through
 * an AudioWorklet ring buffer into `renders/`. `renders/` is already gitignored.
 *
 * ------------------------------------------------- WHY IT CAN BE BELIEVED
 *
 * A recorder is the one instrument in this directory whose failure mode is a
 * plausible artefact: a file full of zeros plays as "the mix got quiet", a file
 * of stale buffer contents plays as noise, and a WAV header with the wrong
 * sample rate plays the whole run at the wrong pitch — which sounds precisely
 * like a mixing change. So the capture carries four controls, and the tool
 * refuses to claim success if any of them is not met:
 *
 *  1. **A silent state and a loud state, through the identical path, in the
 *     same session.** The recorder is attached at the title screen, before
 *     audio is unlocked, and records a window there — the AudioContext is
 *     running and the worklet is rendering, but nothing is connected to the
 *     tap, so it must come back as *digital* silence. Then the game starts, the
 *     same recorder records gameplay. One path, two states. This is `framecheck`'s
 *     blank-page-control shape, and it is the only version of "is this real"
 *     that survives being wrong about the browser.
 *
 *  2. **The transfer probe** (in `lib/capture.mjs`): the page reports the first
 *     sample of every block as a plain number as well as inside the base64
 *     payload, and the two are compared. Byte order, alignment and truncation
 *     all die here.
 *
 *  3. **Coverage**: samples captured against `sampleRate x wall-clock seconds`.
 *     An audio thread that stalled, or a context that suspended itself, yields
 *     a file that is a time-compressed edit of the run rather than a recording
 *     of it — and it is a perfectly listenable file.
 *
 *  4. **Value diversity**: a constant, a DC offset and a stuck buffer all have
 *     one distinct sample value. Non-zero is not the same as real.
 *
 * ---------------------------------------------------------- ON THRESHOLDS
 *
 * Two of the numbers below are DERIVED, not chosen:
 *
 *   - The silence floor is one 16-bit LSB, 1/32768 = 3.05e-5. Below that RMS
 *     the WAV this tool writes is *literally all zeros*, so it is not a taste
 *     call about loudness; it is the point at which the deliverable stops
 *     existing.
 *   - The silent control must sit under the same floor, for the same reason.
 *
 * One is PROVISIONAL and says so in its own output: COVERAGE_MIN. It needs the
 * master plan's S0 calibration protocol — the current build's figure is printed
 * on every run, and the threshold should be frozen from a measured distribution
 * (repeats, under load, on the machines that will run it), not from this
 * comment. It is set loose on purpose: a capture harness that fails on an
 * unrelated box's scheduling jitter gets disabled, and a disabled gate measures
 * nothing at all.
 *
 * NOTHING HERE JUDGES THE MIX. Peak, RMS, crest and the loudness spread are
 * printed because the `crest` gate and the listening pass will want them, but
 * this tool asserts none of them: their thresholds are the S0 calibration's to
 * set, and a made-up one is a thing to tune toward. `tools/interlock.mjs` has
 * the argument in full.
 *
 * -------------------------------------------------- THE POSITIVE CONTROL
 *
 *   CONTROL=silence node tools/capture.mjs 12
 *
 * attenuates the tap bus to 1e-9 while the game plays normally: the capture
 * path is intact, real render quanta flow through it, and every sample lands
 * below one 16-bit LSB. That is exactly the "recorder returns a plausible file
 * of nothing" failure, and the tool must FAIL on it.
 *
 * **Why 1e-9 and not 0, which is what this was written as first.** At a gain of
 * exactly zero Chrome stops rendering the branch altogether: the worklet's
 * `process` is never called, and the capture comes back with **zero frames**
 * rather than with frames of zeros. The tool still failed — on "nothing was
 * captured at all" — but it failed for the wrong reason, and a positive control
 * that exercises a different branch from the defect it stands for is only
 * pretending to be one. 1e-9 keeps the graph alive and puts the failure where
 * it belongs, on the level. `CONTROL=mute` keeps the old gain-0 behaviour,
 * because "the branch was pruned and nothing rendered" is *also* a real failure
 * worth being able to reproduce. `CONTROL=clip` multiplies the bus by 8, which
 * is the same proof for the clipping counter.
 *
 * Deliberately-bad input in, red verdict out — otherwise this is decoration.
 *
 * ------------------------------------------- WHAT THE FIRST RUNS MEASURED
 *
 * Recorded here so the next person has a baseline to argue with, and so that
 * none of these numbers has to be re-discovered:
 *
 *   context           44100Hz, stereo, `running` at the title screen with
 *                     `--autoplay-policy=no-user-gesture-required`
 *   wave 1, 10s       rms -35.0dBFS  peak -21.8dBFS  crest 13.2dB
 *   wave 12, 45s      rms -31.6dBFS  peak -11.6dBFS  crest 19.9dB
 *   silent control    exactly zero, both runs
 *
 * The crest figures agree with `audiocheck`'s independent AnalyserNode reading
 * (it expects 12-20dB and fails under 9), which is the closest thing to a
 * second opinion this path has.
 *
 * **The master is quiet — about 20dB under what `render.mjs` writes**, because
 * that tool normalises every file to 0.89 peak and this one deliberately does
 * not. Do not read the difference as a mix change between the two; they are
 * measuring the same music at different gains, and only this one is measuring
 * the game's actual output level.
 *
 * **COVERAGE IS NOT ALWAYS 1.0 AND THAT MATTERS TO TRACK S.** The wave-1 run
 * captured 100.1% of wall clock; the wave-12 run captured **92.05%** — 41.4
 * seconds of audio over 45.0 seconds of wall clock — with delivery at 100% and
 * zero ring overruns. Nothing was lost between the audio thread and this
 * process: the audio thread itself rendered 8% fewer quanta than real time,
 * under a busy wave on a loaded box. Two consequences, both load-bearing:
 *
 *   1. A rendered-master onset RATE (the plan's two-sided `onsetflux`) computed
 *      from such a file is biased HIGH by exactly that fraction — 28 onsets/s
 *      would read as ~30 — because the seconds are missing but the onsets are
 *      not evenly missing with them. Cross-calibrating scheduler-side counts
 *      against rendered-side counts on a file with 92% coverage would blame the
 *      score for the harness's stall. Divide by coverage, or refuse the file.
 *   2. Before/after listening pairs must be compared at similar coverage. A
 *      "before" at 100% and an "after" at 92% differ by an audible amount of
 *      dropped audio before anyone changes a note.
 *
 * That is what the coverage line is for, and why it gates rather than decorates.
 */
import { chromium } from 'playwright';
import { ensureChromeDeps } from './lib/chromedeps.mjs';
import { autoClose } from './lib/autoclose.mjs';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import {
  CAPTURE_ARGS,
  analyse,
  attachRecorder,
  installMasterTap,
  record,
  writeWav,
} from './lib/capture.mjs';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

/*
 * `SECS`, not `SECONDS`. `SECONDS` is a special variable in bash — it holds the
 * shell's own uptime and assigning to it resets that timer — so a command-line
 * prefix `SECONDS=90 node tools/capture.mjs` is a coin flip on whether the
 * value reaches this process. It is still accepted, second, for anyone who
 * types it out of habit.
 */
const SECONDS = num(process.env.SECS ?? process.env.SECONDS ?? process.argv[2], 30);
const WAVE = num(process.env.WAVE, 0); // 0 = play from the start, never jump
/*
 * A default seed, not a random one. `render.mjs` pins 0x51ed for the same
 * reason: the plan's listening pass compares before/after pairs, and two files
 * of different runs are not a comparison of anything. `world.rng` is the only
 * seed that matters — `World.start()` reseeds the progression from it, and
 * nothing under src/audio calls Math.random at all, so the music is a function
 * of the game and the game is a function of this number.
 */
const SEED = process.env.SEED === 'random' ? null : (num(process.env.SEED, 0x51ed) >>> 0);
const WARMUP = num(process.env.WARMUP, 25) * 1000;
const SETTLE = num(process.env.SETTLE, 4) * 1000;
/** Seconds of the silent control. Named in seconds like every other knob here. */
const SILENT_MS = num(process.env.SILENT, 3) * 1000;
const GAIN = num(process.env.GAIN, 1);
const KEEPALIVE = process.env.KEEPALIVE !== '0';
const CONTROL = process.env.CONTROL ?? 'none';
const URL = process.env.URL ?? 'http://localhost:5173/';
const OUT =
  process.env.OUT ??
  process.argv[3] ??
  `renders/capture-${WAVE ? `w${WAVE}` : 'run'}-${SECONDS}s.wav`;

/**
 * PROVISIONAL — needs the S0 calibration protocol (plan section 4).
 *
 * Captured samples over `sampleRate x wall-clock`. 1.00 means the audio thread
 * ran in real time for the whole window. This machine's measured figure is
 * printed on every run; freeze this from a distribution of repeats rather than
 * from anyone's intuition, and raise it only once the spread is known.
 */
const COVERAGE_MIN = 0.9;

/** Derived, not chosen: below one 16-bit LSB the WAV is all zeros. */
const LSB = 1 / 32768;

console.log('');
console.log(await ensureChromeDeps());

const browser = autoClose(
  await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: CAPTURE_ARGS,
    timeout: num(process.env.LAUNCH_TIMEOUT, 240) * 1000,
  }),
);
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Before goto: superdough wires its orbits during boot, and a tap installed
// afterwards would miss every one of them.
await installMasterTap(page);
const reloads = await freezePage(page);

await page.goto(URL, { waitUntil: 'domcontentloaded' });
/*
 * Wait for the GAME, not for the document.
 *
 * `#start-button` is static markup in index.html, so `waitForSelector` on it
 * resolves before a line of `main.ts` has run — and then `audioCtx()` is
 * undefined. On this box the dev server's module graph takes ~30s to load off
 * a stalling disk, which is exactly the window where that difference bites.
 * `__musicwars` is assigned at the END of main.ts, so it is the honest signal
 * that the app exists.
 */
await page.waitForFunction(() => !!window.__musicwars?.audioCtx, null, { timeout: 180000 });
await page.waitForSelector('#start-button');

const rec = await attachRecorder(page);
console.log(
  `context: ${rec.sampleRate}Hz, ${rec.channels}ch, state '${rec.contextState}' ` +
    `(the WAV header takes this rate, never a constant)`,
);

/* ------------------------------------------------ control 1: rendered silence */

const silent = await record(page, SILENT_MS);
const sa = analyse(silent.pcm, silent.channels, silent.sampleRate);

/* --------------------------------------------------------------- the run */

if (SEED !== null) {
  await page.evaluate((seed) => {
    // `state` is `private` in TypeScript, which is a compile-time fiction; at
    // runtime it is an ordinary property. Set before `start()`, which reseeds
    // the progression from this generator.
    const w = window.__musicwars.world;
    if (w.rng) w.rng.state = seed >>> 0;
  }, SEED);
}

await page.click('#start-button');
await installDriver(page, 'dodge');

if (KEEPALIVE) {
  /*
   * Keep the run alive, and say so.
   *
   * `chop` learned this the expensive way: its bot died partway through a
   * three-minute sweep, the arrangement went to `collapse`, and every row
   * measured after that was taken against near-silence. A capture that ends in
   * a death is a recording of the death music, which is a real and deliberate
   * part of this game and is not what a "wave 12" listening artefact is for.
   * `KEEPALIVE=0` records the run as it really goes, deaths included.
   */
  await page.evaluate(() => {
    window.__capKeep = setInterval(() => {
      const w = window.__musicwars.world;
      w.player.lives = Math.max(w.player.lives, 3);
      w.player.hp = Math.max(w.player.hp, w.player.maxHp * 0.5);
    }, 500);
  });
}

const tick = setInterval(() => process.stdout.write('.'), 2000);
process.stdout.write(`warm-up ${(WARMUP / 1000).toFixed(0)}s `);
await page.waitForTimeout(WARMUP);

if (WAVE > 0) {
  await page.evaluate((wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv);
    w.player.lives = Math.max(w.player.lives, 3);
  }, WAVE);
  // A wave jump is a transition; the bars either side of it are not what
  // "wave 12" sounds like. `chop` throws away the first window after a jump
  // for the same reason.
  process.stdout.write(` jumped to wave ${WAVE}, settling ${(SETTLE / 1000).toFixed(0)}s `);
  await page.waitForTimeout(SETTLE);
}
clearInterval(tick);
console.log('');

/* ------------------------------------------- the deliberately-bad controls */

const CONTROL_GAIN = { silence: 1e-9, mute: 0, clip: 8 };
if (CONTROL in CONTROL_GAIN) {
  const g = CONTROL_GAIN[CONTROL];
  await page.evaluate((g) => {
    window.__capBus.gain.value = g;
  }, g);
  const what = {
    silence: 'inaudible — every sample below one 16-bit LSB, but the graph still renders',
    mute: 'pruned — at gain 0 Chrome stops calling the worklet at all',
    clip: 'clipped — 8x, so the clipping counter has something to count',
  }[CONTROL];
  console.log(
    `\n*** POSITIVE CONTROL ACTIVE: tap bus gain forced to ${g}. ` +
      `The game plays normally; the recording is deliberately ${what}. ` +
      `A verdict of PASS below would mean this tool cannot fail. ***`,
  );
}

/* -------------------------------------------------------------- recording */

// A running log of what the arrangement was doing, so a WAV can never be
// mistaken for a state it was not recorded in. render.mjs prints the same thing
// for the same reason: "a render of the wrong state should be visible in its
// own output rather than inferred three tools later".
await page.evaluate(() => {
  window.__capLog = [];
  window.__capLogT = setInterval(() => {
    try {
      const r = window.__musicwars.readout();
      const s = window.__musicwars.world.snapshot;
      window.__capLog.push({
        section: r.section,
        tension: r.tension,
        bpm: r.bpm,
        wave: s.wave,
        enemies: s.enemyCount,
        bullets: s.bulletCount,
      });
    } catch {
      /* a frame where the world is mid-reset */
    }
  }, 500);
});

process.stdout.write(`recording ${SECONDS}s `);
const run = await record(page, SECONDS * 1000, {
  onTick: () => process.stdout.write('.'),
});
console.log('');

const log = await page.evaluate(() => {
  clearInterval(window.__capLogT);
  if (window.__capKeep) clearInterval(window.__capKeep);
  return window.__capLog;
});
const reloadCount = reloads();
await browser.close();

/* --------------------------------------------------------------- verdict */

const a = analyse(run.pcm, run.channels, run.sampleRate);
const bytes = writeWav(OUT, run.pcm, {
  sampleRate: run.sampleRate,
  channels: run.channels,
  gain: GAIN,
});

const expected = run.sampleRate * (run.wallMs / 1000);
const coverage = expected > 0 ? a.frames / expected : 0;
const delivery = run.rendered > 0 ? a.frames / run.rendered : 0;

const sections = [...new Set(log.map((l) => l.section))];
const meanOf = (k) => (log.length ? log.reduce((s, l) => s + (l[k] ?? 0), 0) / log.length : 0);

console.log(`\ncapture — ${OUT}  (${(bytes / 1048576).toFixed(2)} MB)`);
console.log(
  `  ${a.seconds.toFixed(2)}s of ${run.channels}-channel 16-bit PCM at ${run.sampleRate}Hz` +
    (GAIN !== 1 ? `, gain ${GAIN}x applied` : ', no normalisation'),
);
console.log(
  `  seed ${SEED === null ? 'random (SEED=random)' : `0x${SEED.toString(16)}`}` +
    `  ·  ${WAVE ? `jumped to wave ${WAVE}` : 'played from the start'}` +
    `  ·  warm-up ${(WARMUP / 1000).toFixed(0)}s`,
);
console.log(
  `  while recording: wave ${Math.round(meanOf('wave'))}, sections [${sections.join(' ')}], ` +
    `tension ${meanOf('tension').toFixed(2)}, ${meanOf('bpm').toFixed(0)}bpm, ` +
    `${meanOf('enemies').toFixed(1)} enemies / ${meanOf('bullets').toFixed(0)} bullets on screen`,
);

console.log('\nLEVEL  (reported, never asserted — the S0 calibration owns these thresholds)');
console.log(
  `  rms ${a.rms.toFixed(5)} (${a.fmtDb(a.rms)})   peak ${a.peak.toFixed(4)} (${a.fmtDb(a.peak)})` +
    `   crest ${a.crestDb.toFixed(1)}dB`,
);
console.log(
  `  loudness spread p10 ${a.fmtDb(a.loudP10)} -> p90 ${a.fmtDb(a.loudP90)} ` +
    `= ${Number.isFinite(a.dynamicRangeDb) ? a.dynamicRangeDb.toFixed(1) : 'inf'}dB over 400ms windows`,
);
console.log(
  `  clipped ${a.clipped} samples (${a.clippedPct.toFixed(3)}%)   ` +
    `DC ${a.dc.map((d) => d.toFixed(5)).join(' / ')}`,
);

console.log('\nINTEGRITY  (this is the half that can fail)');
console.log(
  `  coverage      ${(coverage * 100).toFixed(2)}%  of ${run.sampleRate}Hz x ${(run.wallMs / 1000).toFixed(2)}s wall clock` +
    `   [threshold ${(COVERAGE_MIN * 100).toFixed(0)}% is PROVISIONAL — calibrate it]`,
);
/*
 * Requested against armed, printed separately, because they are two different
 * ways to lose audio and a single percentage hides which one happened. The
 * drain loop checks its clock after each transfer, so on a loaded box a
 * transfer that takes longer than `drainMs` overshoots the requested window —
 * the recorder stayed armed longer than asked, which inflates the denominator
 * of coverage without anything being wrong with the audio. Seeing both numbers
 * is the difference between "the audio thread stalled" and "the harness was
 * slow to collect", and only the first is a fact about the game.
 */
console.log(
  `  window        asked ${SECONDS.toFixed(1)}s, armed ${(run.wallMs / 1000).toFixed(2)}s, ` +
    `captured ${a.seconds.toFixed(2)}s of audio`,
);
console.log(`  delivery      ${(delivery * 100).toFixed(2)}%  of the samples the audio thread rendered`);
console.log(`  ring overruns ${run.overruns}`);
console.log(`  distinct sample values in a 4096-point subsample: ${a.distinct}`);
console.log(`  exactly-zero samples: ${a.zeroPct.toFixed(2)}%`);

console.log('\nCONTROL  (the same recorder, the same graph, a state that must be silent)');
console.log(
  `  title screen, nothing connected : ${silent.frames} frames, rms ${sa.rms.toFixed(8)} (${sa.fmtDb(sa.rms)}), peak ${sa.peak.toFixed(8)}`,
);
console.log(
  `  gameplay                        : ${a.frames} frames, rms ${a.rms.toFixed(8)} (${a.fmtDb(a.rms)}), peak ${a.peak.toFixed(8)}`,
);
console.log(
  `  separation                      : ${
    sa.rms > 0 ? (20 * Math.log10(a.rms / sa.rms)).toFixed(1) + 'dB' : 'the silent state is EXACTLY zero'
  }`,
);

const fail = [];
const controlFail = [];

if (silent.frames === 0) {
  controlFail.push(
    'the silent control captured ZERO frames — the worklet never ran, so it proves nothing. ' +
      'Silence and "no recording at all" are different states and this cannot tell them apart.',
  );
}
if (sa.rms >= LSB) {
  controlFail.push(
    `the "silent" state measured rms ${sa.rms.toExponential(2)}, at or above one 16-bit LSB (${LSB.toExponential(2)}). ` +
      'Something is connected to the tap before the game starts, or the recorder is inventing signal. Ignore every number above.',
  );
}
if (reloadCount > 0) {
  controlFail.push(
    `the page reloaded ${reloadCount}x mid-capture — part of this WAV is a title screen with no audio in it`,
  );
}

if (a.frames === 0) fail.push('nothing was captured at all: the file has no samples');
else if (a.rms === 0) fail.push('THE CAPTURE IS ALL ZEROS — this tool would be handing you silence and calling it the mix');
else if (a.rms < LSB)
  fail.push(
    `rms ${a.rms.toExponential(2)} is below one 16-bit LSB (${LSB.toExponential(2)}): the WAV written from it is all zeros`,
  );
if (a.distinct <= 2 && a.frames > 0)
  fail.push(`only ${a.distinct} distinct sample values — a constant or a stuck buffer, not audio`);
if (coverage < COVERAGE_MIN)
  fail.push(
    `coverage ${(coverage * 100).toFixed(1)}% under the provisional ${(COVERAGE_MIN * 100).toFixed(0)}%: the file is an edit of the window, not a recording of it`,
  );
if (run.overruns > 0)
  fail.push(`${run.overruns} ring-buffer overruns: the recording has holes this harness put there`);
if (errors.length) fail.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);

console.log('');
if (controlFail.length) {
  controlFail.forEach((f) => console.log('  ✗ CONTROL FAILED: ' + f));
  console.log('\n=== THE CONTROLS DID NOT HOLD — DO NOT LISTEN TO THIS FILE AS EVIDENCE ===');
  process.exit(reloadCount > 0 && controlFail.length === 1 ? 3 : 2);
}
if (fail.length) {
  fail.forEach((f) => console.log('  ✗ ' + f));
  console.log('\n=== THE CAPTURE IS NOT REAL AUDIO ===');
  process.exit(1);
}
console.log(
  `=== CAPTURE VERIFIED: ${a.seconds.toFixed(1)}s of real master output at ${run.sampleRate}Hz ===`,
);
console.log(
  `    silence recorded as silence, gameplay as ${a.fmtDb(a.rms)} rms / ${a.fmtDb(a.peak)} peak, ` +
    `${(coverage * 100).toFixed(1)}% coverage, ${run.overruns} overruns.`,
);
if (a.clipped > 0)
  console.log(
    `    NOTE: ${a.clipped} samples (${a.clippedPct.toFixed(3)}%) hit or passed full scale before the 16-bit write. ` +
      'Reported, not gated — plan section 5.3 says a fortissimo must resolve in curves, never clipping.',
  );
console.log(`    Listen: ${OUT}`);
