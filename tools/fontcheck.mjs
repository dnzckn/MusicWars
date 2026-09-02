/*
 * fontcheck — the soundfont load, MEASURED IN A BROWSER, and the fallback
 * proved by taking the network away.
 *
 * `tools/fontlanes.mjs` is the node half: it proves the builders emit the right
 * source in each mode. It cannot see any of the things that decide whether this
 * feature is a good idea — how many bytes cross the wire, how long the player
 * waits, whether the packaging actually resolves under Vite, whether a lane
 * that fails to load makes a sound. All four are runtime facts and all four
 * need a real page.
 *
 * FOUR PASSES, each with its own verdict:
 *
 *   1. BOOT. Load the game, press start, and fail on any page error or console
 *      error. The whole reason `@strudel/soundfonts` was never installed is
 *      that its package entry does not load under Vite at all, so "the page
 *      still works" is the first thing to check and not a formality.
 *   2. LOAD. Read `window.__soundfonts.report()` and print per-role bytes,
 *      milliseconds and outcome. Fail if a role did not load with a working
 *      network, because that is either a dead URL or a broken warm-up.
 *   3. AUDIBLE. Tap the audio graph and confirm sound is coming out AFTER the
 *      promotion. A lane switched to a font it cannot play is silent, not
 *      loud — superdough drops a hap whose handler resolves late
 *      (`superdough.mjs:581`) — so "it loaded" and "it sounds" are two claims.
 *   4. OFFLINE. Reload with `page.route` aborting every request to the font
 *      host, and require: no page error, every role reported unavailable,
 *      every lane back on its oscillator, and the game STILL MAKING SOUND at a
 *      level comparable to the online run. A silent lane is far worse than a
 *      synth lane and this is the pass that proves it does not happen.
 *
 * Usage: the dev server must already be running on 5173.
 *   node tools/fontcheck.mjs
 *   node tools/fontcheck.mjs --spectrum    # also decode each font and report
 *                                          # its octave bands (see below)
 */
import { chromium } from 'playwright';

const SPECTRUM = process.argv.includes('--spectrum');
/*
 * `--probe=gm_electric_guitar_clean:3:68:80,...` measures a CANDIDATE the same
 * way, so a variant can be chosen on evidence instead of on its file size. That
 * is not hypothetical: the first choice for the stab was picked because six
 * zones for 16 KB of base64 looked like a bargain, and this tool then measured
 * it at 82% of its energy above 2 kHz over a 30 ms sample — a wavetable, not a
 * recording of a guitar.
 */
const PROBE = (process.argv.find((a) => a.startsWith('--probe=')) ?? '')
  .slice('--probe='.length)
  .split(',')
  .filter(Boolean)
  .map((spec) => {
    const [font, n, lo, hi] = spec.split(':');
    return [font, Number(n ?? 0), Number(lo ?? 60), Number(hi ?? 72)];
  });
const HOST = 'felixroos.github.io';
const URL = 'http://127.0.0.1:5173/';

const fails = [];
const line = (s) => console.log(s);

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

/** Tap everything that reaches the destination, exactly as `audiocheck` does. */
const TAP = () => {
  const origConnect = AudioNode.prototype.connect;
  window.__tap = null;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    try {
      if (dest && dest.context && dest === dest.context.destination) {
        if (!window.__tap) {
          const a = dest.context.createAnalyser();
          a.fftSize = 2048;
          window.__tap = a;
          window.__buf = new Float32Array(a.fftSize);
        }
        origConnect.call(this, window.__tap);
      }
    } catch {
      /* a node type that refuses the extra fan-out is not worth failing over */
    }
    return result;
  };
};

async function rms(page, ms) {
  return page.evaluate(async (durationMs) => {
    let peak = 0;
    let sum = 0;
    let n = 0;
    const end = performance.now() + durationMs;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) {
        a.getFloatTimeDomainData(window.__buf);
        let acc = 0;
        let mx = 0;
        for (let i = 0; i < window.__buf.length; i++) {
          const v = window.__buf[i];
          acc += v * v;
          const av = Math.abs(v);
          if (av > mx) mx = av;
        }
        peak = Math.max(peak, mx);
        sum += Math.sqrt(acc / window.__buf.length);
        n++;
      }
      await new Promise((r) => setTimeout(r, 8));
    }
    return { peak, rms: n ? sum / n : 0, samples: n };
  }, ms);
}

async function openGame(block) {
  const page = await browser.newPage();
  const errors = [];
  /*
   * BYTES ARE COUNTED HERE AND NOT IN THE PAGE, and that is not a style
   * preference. The Resource Timing API zeroes `transferSize` and
   * `encodedBodySize` for a cross-origin response without a
   * `Timing-Allow-Origin` header, and GitHub Pages sends none — the first
   * version of this tool reported "0 bytes over the wire" for a load that
   * plainly fetched six files. Playwright sees the socket, so it can answer.
   */
  const wire = new Map();
  page.on('requestfinished', async (req) => {
    if (!req.url().includes(HOST)) return;
    try {
      const sizes = await req.sizes();
      wire.set(req.url(), {
        body: sizes.responseBodySize,
        headers: sizes.responseHeadersSize,
      });
    } catch {
      /* a request that finished after the page closed cannot be sized */
    }
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.addInitScript(TAP);
  await page.addInitScript((probe) => {
    window.__probe = probe;
  }, PROBE);
  if (block) {
    // Everything the font host serves, refused at the network layer — which is
    // what an offline player, a firewall or a dead CDN all look like from here.
    await page.route(`**://${HOST}/**`, (route) => route.abort('failed'));
  }
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.click('#start-button');
  const startedAt = Date.now();
  return { page, errors, wire, startedAt };
}

/*
 * MEASURE BOTH RUNS AT THE SAME POINT IN THE ARRANGEMENT.
 *
 * The first version sampled as soon as the font load settled, which is 4 s
 * after START online and 0.2 s offline — so it compared the middle of the intro
 * against its first bar and reported the fallback as four times quieter. That
 * was the tool, not the music: the intro ramps. Both runs now wait to the same
 * wall-clock offset before listening.
 */
const LISTEN_AT_MS = 8000;
async function settle(run) {
  const wait = LISTEN_AT_MS - (Date.now() - run.startedAt);
  if (wait > 0) await run.page.waitForTimeout(wait);
}

/** Poll until the load has settled, or give up and report what it settled on. */
async function waitForFonts(page, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const state = await page.evaluate(() => window.__soundfonts?.state?.() ?? 'missing');
    if (state === 'ready' || state === 'partial' || state === 'unavailable') return state;
    if (Date.now() > deadline) return state;
    await page.waitForTimeout(120);
  }
}

/* ============================================================ 1-3. ONLINE */

line('');
line('fontcheck — the soundfont load, in a real browser');
line('');

const online = await openGame(false);
const stateOnline = await waitForFonts(online.page, 30000);
const reportOnline = await online.page.evaluate(() => window.__soundfonts?.report?.() ?? null);

if (!reportOnline) {
  fails.push('window.__soundfonts is missing — src/audio/soundfonts.ts did not load in the page at all');
} else {
  line(`  state: ${stateOnline}   base: ${reportOnline.baseUrl}`);
  /*
   * The page's own byte count is expected to be 0 against the CDN and is
   * printed anyway, because it is the number that would become real the day the
   * fonts are self-hosted: Resource Timing only reports sizes same-origin or
   * with `Timing-Allow-Origin`, and GitHub Pages sends neither. The MEASURED
   * total further down comes from Playwright, which watches the socket.
   */
  line(`  total: ${reportOnline.totalMs.toFixed(0)} ms  (page-side byte count ${reportOnline.transferred}; cross-origin Resource Timing reports 0)`);
  line('');
  line('  role        font                        ok   first ms   warm ms  pitches  error');
  let okRoles = 0;
  for (const r of reportOnline.roles) {
    if (r.ok) okRoles++;
    line(
      `  ${r.role.padEnd(10)} ${r.font.padEnd(26)} ${r.ok ? 'yes' : 'NO '} ${String(Math.round(r.firstMs)).padStart(9)} ${String(Math.round(r.ms)).padStart(9)} ${String(r.pitches).padStart(8)}  ${r.error ?? ''}`,
    );
  }
  line('');
  line(`  ${okRoles} of ${reportOnline.roles.length} enabled roles loaded`);
  if (reportOnline.roles.length === 0) {
    fails.push('the report names no roles at all. A check with no denominator is not a pass.');
  }
  if (okRoles < reportOnline.roles.length) {
    fails.push(
      `${reportOnline.roles.length - okRoles} role(s) did not load WITH a working network. That is a dead URL, ` +
        `a wrong variant index, or a warm-up that throws — not a fallback working as designed.`,
    );
  }
  /*
   * ONLY THE ENABLED ROLES ARE EXPECTED TO BE SAMPLED.
   *
   * `SAMPLED_ROLES` in `soundfonts.ts` gates which lanes may use an instrument
   * at all; the rest keep a table entry and emit their oscillator. Asserting
   * "every role is sampled" would fail the deliberate configuration, and
   * asserting nothing would miss an enabled lane that quietly did not promote.
   * Both directions are checked, and the enabled list is READ from the page
   * rather than restated here.
   */
  const live = await online.page.evaluate(() => window.__soundfonts.roles());
  const enabled = new Set(await online.page.evaluate(() => window.__soundfonts.enabled()));
  line(`  enabled roles: ${[...enabled].join(', ') || '(none)'} of ${live.length} in the table`);
  if (enabled.size === 0) fails.push('no role is enabled; the loader is wired to nothing');
  const notSampled = live.filter((r) => enabled.has(r.role) && !r.sampled).map((r) => r.role);
  if (notSampled.length) {
    fails.push(`after a successful load these ENABLED roles are still on their oscillator: ${notSampled.join(', ')}`);
  }
  const unexpected = live.filter((r) => !enabled.has(r.role) && r.sampled).map((r) => r.role);
  if (unexpected.length) {
    fails.push(`these roles are NOT enabled but resolve to a soundfont: ${unexpected.join(', ')}`);
  }
  const fetched = new Set([...online.wire.keys()].map((u) => u.split('/').pop().replace('.js', '')));
  const wanted = new Set(
    live.filter((r) => enabled.has(r.role)).map((r) => r.s),
  );
  line(`  files fetched: ${[...fetched].join(', ') || '(none)'}`);
  if (fetched.size > wanted.size) {
    fails.push(
      `${fetched.size} font files were fetched for ${wanted.size} enabled instrument(s). A font no lane plays ` +
        `is bytes and latency spent on silence.`,
    );
  }
}

await settle(online);
const soundOnline = await rms(online.page, 2500);
const wireTotal = [...online.wire.values()].reduce((a, w) => a + w.body + w.headers, 0);
const wireBody = [...online.wire.values()].reduce((a, w) => a + w.body, 0);
line('');
line(`  MEASURED over the wire: ${online.wire.size} responses, ${wireBody} body bytes, ${wireTotal} including headers`);
for (const [u, w] of online.wire) line(`     ${String(w.body).padStart(8)} B  ${u.split('/').pop()}`);
if (online.wire.size === 0) fails.push('no request to the font host was observed at all — is the loader running?');
line('');
line(`  audio after promotion: rms ${soundOnline.rms.toFixed(4)}, peak ${soundOnline.peak.toFixed(4)} over ${soundOnline.samples} frames`);
if (soundOnline.samples === 0) fails.push('the audio tap never produced a frame — nothing connected to the destination');
else if (soundOnline.peak < 0.01) fails.push(`the game is SILENT with soundfonts loaded (peak ${soundOnline.peak.toFixed(5)})`);

if (online.errors.length) {
  for (const e of online.errors.slice(0, 8)) line(`  ERROR ${e}`);
  fails.push(`${online.errors.length} console/page error(s) with the network up`);
}

/* ------------------------------------------------------- optional: spectra */

/*
 * WHAT THE INSTRUMENTS ACTUALLY SOUND LIKE, in the only sense a machine can
 * report: where their energy sits.
 *
 * `registermap`'s band table is a Fourier series over a named waveform, and a
 * recording has no series — so every soundfont row there is modelled from the
 * oscillator it replaced and says nothing about the change. This decodes the
 * real sample through the page's own loader and integrates its spectrum, which
 * is the only octave-band figure in this repository that describes an actual
 * instrument. It is still not HEARING it.
 */
if (SPECTRUM && reportOnline) {
  line('');
  line('  MEASURED octave bands of each instrument, decoded from the real sample,');
  line('  against the THEORETICAL bands of the oscillator it replaced, at the same pitch.');
  const spec = await online.page.evaluate(async () => {
    const mod = await import('/src/audio/soundfonts.ts');
    const fl = await import('/node_modules/@strudel/soundfonts/fontloader.mjs');
    const gm = (await import('/node_modules/@strudel/soundfonts/gm.mjs')).default;
    const ctx = new OfflineAudioContext(1, 8, 44100);
    const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    const bandOf = (f) => {
      for (let i = 0; i < BANDS.length; i++) if (f < BANDS[i] * Math.SQRT2) return i;
      return -1;
    };

    /*
     * A REAL FFT, because the first version of this decimated the bin grid by
     * four and that is not a small error on a harmonic sound: a Hann-windowed
     * partial occupies about three bins, so sampling every fourth bin misses
     * narrow peaks outright while broadband content — which the high bands are
     * full of — is sampled uniformly. It reported a clean electric guitar with
     * 43% of its energy above 8 kHz. Radix-2, in place.
     */
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
          const tr = re[i]; re[i] = re[j]; re[j] = tr;
          const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
      }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const ur = re[i + k], ui = im[i + k];
            const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
            const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
            re[i + k] = ur + vr; im[i + k] = ui + vi;
            re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            const ncr = cr * wr - ci * wi;
            ci = cr * wi + ci * wr;
            cr = ncr;
          }
        }
      }
    }

    /*
     * The same textbook Fourier coefficients `tools/registermap.mjs` uses. Not
     * imported: that file runs in Node and this runs in the page. They are the
     * closed forms for the waveform, so there is nothing to drift.
     */
    const oscAmp = (src, k, pw, uni) => {
      switch (src) {
        case 'sine': return k === 1 ? 1 : 0;
        case 'triangle': return k % 2 === 1 ? 8 / (Math.PI * Math.PI * k * k) : 0;
        case 'square': return k % 2 === 1 ? 4 / (Math.PI * k) : 0;
        case 'pulse': {
          const d = (1 - (pw ?? 0)) / 2;
          return (4 / (Math.PI * k)) * Math.abs(Math.sin(k * Math.PI * d));
        }
        case 'sawtooth': return 2 / (Math.PI * k);
        case 'supersaw': return (2 / (Math.PI * k)) * Math.sqrt(uni ?? 1);
        default: return 0;
      }
    };
    const oscBands = (osc, midi) => {
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const b = new Array(BANDS.length).fill(0);
      for (let k = 1; k <= 400; k++) {
        const f = f0 * k;
        if (f > 22050) break;
        const i = bandOf(f);
        if (i < 0) continue;
        const a = oscAmp(osc.s, k, osc.pw, osc.unison);
        b[i] += (a * a) / 2;
      }
      const t = b.reduce((x, y) => x + y, 0) || 1;
      return b.map((v) => (v / t) * 100);
    };

    const measureOne = async (font, n, midi) => {
      const src = await fl.getFontBufferSource(gm[font][n], { note: midi }, ctx);
      const buf = src.buffer;
      const data = buf.getChannelData(0);
      const sr = buf.sampleRate * src.playbackRate.value;
      if (data.length < 1024) throw new Error(`sample is only ${data.length} frames`);
      /*
       * Window the SUSTAIN, not the attack. A pick, a breath or a bow onset is
       * broadband, lasts a tenth of a second, and would otherwise be reported
       * as the instrument's timbre.
       */
      let N = 16384;
      while (N > 1024 && Math.floor(data.length * 0.25) + N > data.length) N >>= 1;
      const off = Math.max(0, Math.min(Math.floor(data.length * 0.25), data.length - N));
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = data[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      fft(re, im);
      const bands = new Array(BANDS.length).fill(0);
      for (let k = 1; k < N / 2; k++) {
        const b = bandOf((k * sr) / N);
        if (b < 0) continue;
        bands[b] += re[k] * re[k] + im[k] * im[k];
      }
      const tot = bands.reduce((a, x) => a + x, 0) || 1;
      return {
        bands: bands.map((v) => (v / tot) * 100),
        N,
        frames: data.length,
        ms: (data.length / buf.sampleRate) * 1000,
      };
    };

    /*
     * AVERAGE OVER THE LANE'S RANGE, because one pitch is not an instrument.
     *
     * The first run of this measured `gm_oboe` at MIDI 79 as 97.6% above 2 kHz
     * and at MIDI 76 as 2.2%. Both are correct and neither is a fact about the
     * oboe: its 2nd harmonic carries nearly all its energy, and the 2 kHz band
     * edge at 1414 Hz falls BETWEEN that harmonic's frequency at the two
     * pitches. A single-pitch reading of a band share is a reading of where the
     * band edges are.
     */
    const measure = async (font, n, midis) => {
      const acc = new Array(BANDS.length).fill(0);
      let ok = 0;
      let frames = 0;
      let ms = 0;
      let err = null;
      for (const midi of midis) {
        try {
          const m = await measureOne(font, n, midi);
          for (let i = 0; i < acc.length; i++) acc[i] += m.bands[i];
          ok++;
          frames = Math.max(frames, m.frames);
          ms = Math.max(ms, m.ms);
        } catch (e) {
          err = e;
        }
      }
      if (ok === 0) throw err ?? new Error('no pitch decoded');
      return { bands: acc.map((v) => v / ok), pitches: ok, frames, ms };
    };
    /** Five pitches spread across a range, inclusive. */
    const spread5 = (lo, hi) => [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(lo + (hi - lo) * t));
    const avgOsc = (osc, midis) => {
      const a = new Array(BANDS.length).fill(0);
      for (const mi of midis) {
        const ob = oscBands(osc, mi);
        for (let i = 0; i < a.length; i++) a[i] += ob[i] / midis.length;
      }
      return a;
    };

    const out = [];
    for (const role of mod.VOICE_ROLES) {
      const inst = mod.INSTRUMENTS[role];
      const midis = spread5(inst.warm[0], inst.warm[1]);
      try {
        const m = await measure(inst.font, inst.n, midis);
        out.push({
          role,
          font: inst.font,
          midi: `${midis[0]}-${midis[4]}`,
          bands: m.bands,
          frames: m.frames,
          ms: m.ms,
          osc: `${inst.osc.s}${inst.osc.pw !== undefined ? ` pw${inst.osc.pw}` : ''}${inst.osc.unison !== undefined ? ` u${inst.osc.unison}` : ''}`,
          oscBands: avgOsc(inst.osc, midis),
        });
      } catch (e) {
        out.push({ role, midi: `${midis[0]}-${midis[4]}`, error: String(e?.message ?? e).slice(0, 80) });
      }
    }
    /*
     * THE LEAD'S DECORATION, which is the one open question this measurement
     * exists to answer. `buildLead` keeps the filigree and the ornament on a
     * 25%-duty pulse because that pulse is where the mix's air was measured to
     * come from, and moving them onto the tune's instrument on an EXPECTATION
     * of brightness would trade a measured property for a plausible one. MIDI
     * 76 is the middle of the tune's own window.
     */
    const lead = mod.INSTRUMENTS.leadTune;
    const decorMidis = spread5(69, 83);
    try {
      const m = await measure(lead.font, lead.n, decorMidis);
      out.push({
        role: 'decor?',
        font: lead.font,
        midi: '69-83',
        bands: m.bands,
        frames: m.frames,
        ms: m.ms,
        osc: 'pulse pw0.5',
        oscBands: avgOsc({ s: 'pulse', pw: 0.5 }, decorMidis),
      });
    } catch (e) {
      out.push({ role: 'decor?', midi: '69-83', error: String(e?.message ?? e).slice(0, 80) });
    }

    /* Candidates, so a variant can be chosen on evidence. See `--probe`. */
    for (const spec of window.__probe ?? []) {
      const [font, n, lo, hi] = spec;
      const label = `${font} n=${n}`;
      try {
        const m = await measure(font, n, spread5(lo, hi));
        out.push({
          role: 'probe', font: label, midi: `${lo}-${hi}`, bands: m.bands,
          frames: m.frames, ms: m.ms, osc: '-', oscBands: new Array(BANDS.length).fill(0),
        });
      } catch (e) {
        out.push({ role: 'probe', font: label, midi: `${lo}-${hi}`, error: String(e?.message ?? e).slice(0, 80) });
      }
    }
    return out;
  });
  const air = (b) => b.slice(6).reduce((a, x) => a + x, 0);
  line('  role       source                          midi     31.5     63    125    250    500     1k     2k     4k     8k    16k  |  >2kHz  sample');
  let decoded = 0;
  for (const r of spec) {
    if (r.error) {
      line(`  ${r.role.padEnd(10)} (could not decode: ${r.error})`);
      continue;
    }
    decoded++;
    line(
      `  ${r.role.padEnd(10)} ${r.font.padEnd(31)} ${String(r.midi).padStart(5)} ` +
        r.bands.map((v) => v.toFixed(1).padStart(6)).join(' ') +
        `  | ${air(r.bands).toFixed(1).padStart(5)}%  ${Math.round(r.ms)}ms`,
    );
    if (r.osc !== '-') {
      line(
        `  ${''.padEnd(10)} ${`(was ${r.osc}, theoretical)`.padEnd(31)} ${String(r.midi).padStart(5)} ` +
          r.oscBands.map((v) => v.toFixed(1).padStart(6)).join(' ') +
          `  | ${air(r.oscBands).toFixed(1).padStart(5)}%`,
      );
    }
  }
  line(`  ${decoded} of ${spec.length} sources decoded`);
  if (decoded === 0) fails.push('no font could be decoded for a spectrum — the measurement examined nothing');
}

await online.page.close();

/* =========================================================== 4. OFFLINE */

line('');
line(`  --- with every request to ${HOST} aborted ---`);
const offline = await openGame(true);
const stateOffline = await waitForFonts(offline.page, 30000);
const reportOffline = await offline.page.evaluate(() => window.__soundfonts?.report?.() ?? null);
const rolesOffline = await offline.page.evaluate(() => window.__soundfonts?.roles?.() ?? []);

line(`  state: ${stateOffline}, ${reportOffline ? reportOffline.totalMs.toFixed(0) : '?'} ms to give up`);
if (stateOffline !== 'unavailable') {
  fails.push(`with the font host blocked the state is "${stateOffline}", expected "unavailable"`);
}
for (const r of reportOffline?.roles ?? []) {
  line(`  ${r.role.padEnd(10)} ${r.ok ? 'LOADED (should not have)' : 'fell back'}  ${(r.error ?? '').slice(0, 70)}`);
  if (r.ok) fails.push(`role "${r.role}" reports loaded with the host blocked`);
}
line('');
line(`  resolved sources offline: ${rolesOffline.map((r) => `${r.role}=${r.s}`).join(' ')}`);
const stillSampled = rolesOffline.filter((r) => r.sampled).map((r) => r.role);
if (rolesOffline.length === 0) fails.push('could not read the resolved sources offline. Nothing was checked.');
if (stillSampled.length) {
  fails.push(
    `offline, these roles still resolve to a soundfont: ${stillSampled.join(', ')}. Every one of their notes ` +
      `throws "sound not found" in superdough (superdough.mjs:577).`,
  );
}

await settle(offline);
const soundOffline = await rms(offline.page, 2500);
line(`  audio offline: rms ${soundOffline.rms.toFixed(4)}, peak ${soundOffline.peak.toFixed(4)} over ${soundOffline.samples} frames`);
if (soundOffline.samples === 0) fails.push('the audio tap never produced a frame offline');
else if (soundOffline.peak < 0.01) {
  fails.push(`THE GAME IS SILENT OFFLINE (peak ${soundOffline.peak.toFixed(5)}). The fallback does not work.`);
}
/*
 * Not a ratio against the online run: the two runs are different seeds, sit at
 * different points in the arrangement, and a sampled string section and a
 * supersaw do not have the same RMS. The claim being checked is "there is
 * music", so the threshold is an absolute floor an empty mix cannot clear.
 */
const RATIO_MIN = 0.3;
const ratio = soundOnline.rms > 0 ? soundOffline.rms / soundOnline.rms : 0;
line(`  offline/online RMS ratio at the same point in the arrangement: ${ratio.toFixed(2)}`);
if (ratio < RATIO_MIN) {
  fails.push(
    `offline RMS is ${(ratio * 100).toFixed(0)}% of online (${soundOffline.rms.toFixed(5)} vs ` +
      `${soundOnline.rms.toFixed(5)}); under ${RATIO_MIN * 100}% means lanes are MISSING rather than merely ` +
      `sounding different. A sampled string section and a supersaw are not the same loudness, which is why ` +
      `this is a wide band and not an equality.`,
  );
}

const offlineErrors = offline.errors.filter(
  // A blocked fetch logs a network error of its own; that is the thing being
  // simulated, not a defect. Anything else is.
  (e) => !/net::ERR_FAILED|Failed to fetch|felixroos\.github\.io/i.test(e),
);
if (offline.errors.length) line(`  ${offline.errors.length} console message(s) offline, ${offlineErrors.length} not attributable to the blocked host`);
for (const e of offlineErrors.slice(0, 8)) line(`  ERROR ${e}`);
if (offlineErrors.length) fails.push(`${offlineErrors.length} unexplained console/page error(s) offline`);

await offline.page.close();
await browser.close();

/* --------------------------------------------------------------- verdict */

line('');
if (fails.length) {
  for (const f of fails) line(`  FAIL  ${f}`);
  line('');
  line(`fontcheck: ${fails.length} failure(s)`);
  process.exit(1);
}
line('fontcheck: ok');
