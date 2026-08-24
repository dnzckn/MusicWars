/**
 * How much each layer's own level swings, measured on the output rather than
 * inferred from the arrangement.
 *
 * "very choppy... makes it unplayable" was the complaint, and every existing
 * probe answered a proxy for it: `rebuildrate` counts pattern rebuilds,
 * `choppy` polls an AnalyserNode from the main thread at 16ms, `mixaudit`
 * measures level. None of them can see a 30ms hole, and a main-thread poll
 * cannot even be trusted to sample evenly in a page running at 30fps. This runs
 * an envelope follower in an AudioWorklet — on the audio thread, one value per
 * 128-sample quantum (2.67ms) — and solos each stem in turn.
 *
 * The headline number is SWING: the 90th percentile of the layer's envelope
 * minus the 10th, in dB. A hi-hat swings enormously because it is mostly
 * silence; a pad or a drone should barely swing at all. A held layer swinging
 * like a hi-hat is the sound of something cutting it up.
 *
 * Swing is a distribution statistic on purpose. The first version counted
 * dip *events* against a threshold, and the full mix read 11.4% and then 0.0%
 * on consecutive measurements of an unchanged build — one deep transition
 * carried the whole number. This project has been burned by a threshold sitting
 * inside its own metric's spread often enough that `tools/README.md` has a
 * paragraph about it.
 *
 * THE CONTROL IS THE TABLE ITSELF, which is why all eleven stems are measured
 * rather than a chosen few:
 *
 *  - `hats` and `clap` are percussion and MUST swing hard. If they do not, the
 *    follower is broken and every other row is noise.
 *  - `fx` is a held noise wash on the air bus, which nothing ducks. It is the
 *    reference for what an un-gated sustained layer looks like.
 *  - Every stem is measured twice, interleaved, and the two passes are printed.
 *    A difference between builds that is smaller than that spread is not a
 *    difference.
 *
 * Three earlier versions of this tool were wrong, all instructively:
 *
 *  1. The follower's own monitor path was routed to the destination through
 *     the same patched `connect` that builds the tap, so the graph contained
 *     the cycle tap -> follower -> mute -> tap. Chrome renders a cycle with no
 *     DelayNode in it as silence, so every condition scored exactly zero.
 *  2. Conditions were applied by passing `() => {...}` to `page.evaluate` as a
 *     TEMPLATE STRING. Playwright evaluates a string as an expression, so each
 *     one produced a function object that was never called: eleven rows all
 *     silently measured the same untouched run and looked plausible.
 *  3. A `> -55dBFS` guard meant to stop silence counting as a chop deleted
 *     exactly the gaps between hi-hat hits, so the positive control came out
 *     quieter than the drone it was supposed to outrank.
 *
 * Only the first was visible in the output. The controls caught the other two.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const HOLD = Number(process.env.HOLD ?? 8000);
const REPS = Number(process.env.REPS ?? 2);
const WAVE = Number(process.env.WAVE ?? 16);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

await p.addInitScript(() => {
  /*
   * The tap has to exist before the first `connect`, but the worklet cannot be
   * added until the context is running — so a plain GainNode collects
   * everything bound for the destination now, and the follower is hung off it
   * later. The instrument's own monitor path is exempt (see note 1 above).
   */
  window.__tapBus = null;
  window.__mine = new WeakSet();
  const oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try {
      if (d && d.context && d === d.context.destination && !window.__mine.has(this)) {
        if (!window.__tapBus) window.__tapBus = d.context.createGain();
        oc.call(this, window.__tapBus);
      }
    } catch {}
    return res;
  };
});

const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);

await p.evaluate(async () => {
  const ctx = window.__musicwars.audioCtx();
  const src = `
    class Env extends AudioWorkletProcessor {
      constructor() { super(); this.env = 0; this.buf = []; this.rel = Math.exp(-128 / (sampleRate * 0.02)); }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        let pk = 0;
        if (ch) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > pk) pk = a; }
        // Fast attack, 20ms release: a chop is the envelope failing to be held
        // up, so the follower must fall faster than the music's own decay but
        // slower than one cycle of the bass.
        this.env = pk > this.env ? pk : this.env * this.rel;
        this.buf.push(this.env);
        if (this.buf.length >= 256) { this.port.postMessage(this.buf); this.buf = []; }
        return true;
      }
    }
    registerProcessor('mw-env', Env);`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ctx, 'mw-env', { numberOfOutputs: 1, outputChannelCount: [1] });
  window.__env = [];
  node.port.onmessage = (e) => { for (const v of e.data) window.__env.push(v); };
  window.__tapBus.connect(node);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  window.__mine.add(node);
  window.__mine.add(mute);
  node.connect(mute);
  mute.connect(ctx.destination);
  window.__envRate = ctx.sampleRate / 128;
});

await installDriver(p, 'dodge');

/**
 * A gap this deep, lasting between these two, is what a listener calls a chop.
 *
 * The upper bound matters as much as the lower. Without it the metric counted
 * breakdowns: the full mix came back at 0.21 holes/s covering 14.3% of the
 * time, which is gaps averaging 0.68 seconds — a musical rest, an arrangement
 * doing its job, and the opposite of a defect. A chop is short by definition.
 */
const HOLE_DB = 18;
const HOLE_MS = 25;
const HOLE_MAX_MS = 400;

function analyse(env, rate) {
  if (env.length < 500) return null;
  const raw = env.map((v) => 20 * Math.log10(Math.max(v, 1e-7)));
  const sorted = raw.slice().sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];

  /*
   * Holes, counted in time rather than inferred from the spread.
   *
   * Swing says how far a layer's level travels; it cannot say whether that
   * travel is a smooth fade or the sound stopping, and only the second one is
   * what "choppy" means. A hole is the envelope sitting HOLE_DB under the
   * layer's own 90th percentile for at least HOLE_MS. The follower runs on the
   * audio thread at one value per 2.67ms, so a 25ms gap is nine samples deep
   * and cannot be missed by sampling luck the way a main-thread poll would.
   *
   * The reference is the layer's own loud level rather than a fixed floor, so a
   * quiet passage does not read as one continuous hole.
   */
  /*
   * The reference is the LOCAL peak, over a second either side, not one level
   * for the whole window.
   *
   * A single reference for eight seconds is wrong whenever the arrangement
   * changes inside the window: a breakdown eight decibels down reads as one
   * continuous hole, and the full mix scored 14.3% "holed" on nothing but
   * section changes. A second either side is far longer than any chop and far
   * shorter than any section, so it tracks how loud the music is right there.
   *
   * An earlier attempt at a rolling reference used +-250ms and failed the
   * opposite way — the reference sank into the gaps between hi-hat hits and
   * reported a pattern that is mostly silence as continuous. The window has to
   * be long compared to the thing being measured.
   */
  const w = Math.round(rate);
  const local = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    let peak = -Infinity;
    for (let j = Math.max(0, i - w), z = Math.min(raw.length, i + w); j < z; j++) {
      if (raw[j] > peak) peak = raw[j];
    }
    local[i] = peak;
  }
  const minLen = Math.max(2, Math.round((HOLE_MS / 1000) * rate));
  const maxLen = Math.round((HOLE_MAX_MS / 1000) * rate);
  let holes = 0, held = 0, run = 0, rests = 0;
  const close = () => {
    if (run >= minLen && run <= maxLen) { holes++; held += run; }
    else if (run > maxLen) rests++;
    run = 0;
  };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] < local[i] - HOLE_DB) run++;
    else close();
  }
  close();
  const secs = raw.length / rate;
  return {
    swing: +(q(0.9) - q(0.1)).toFixed(1),
    peak: +q(0.95).toFixed(1),
    holesPerSec: +(holes / secs).toFixed(2),
    holedPct: +((held / raw.length) * 100).toFixed(1),
    // Reported, never asserted: a gap longer than HOLE_MAX_MS is a rest.
    restsPerSec: +(rests / secs).toFixed(2),
  };
}

/*
 * Keep the run alive between conditions, or the sweep measures a death.
 *
 * `lives` was set once before the sweep, and a two-pass sweep runs for three
 * minutes: the bot died partway through pass 2, the arrangement went to
 * `collapse`, and every stem measured after that read against near-silence.
 * That is what produced an 84dB spread on the kick and made the whole table
 * unreadable.
 */
const setSolo = (id) => {
  const w = window.__musicwars.world;
  w.player.lives = 4;
  w.player.hp = w.player.maxHp;
  window.__musicwars.director.solo = id;
};
const setWave = (wv) => {
  const w = window.__musicwars.world;
  w.jumpToWave(wv);
  w.player.lives = 4;
  window.__musicwars.director.solo = null;
};

async function measure(soloId) {
  await p.evaluate(setSolo, soloId);
  await p.evaluate(() => { window.__env.length = 0; });
  await p.waitForTimeout(HOLD);
  const { env, rate, section } = await p.evaluate(() => ({
    env: window.__env.slice(),
    rate: window.__envRate,
    section: window.__musicwars.readout().section,
  }));
  const r = analyse(env, rate) ?? { swing: 0, peak: -99, holesPerSec: 0, holedPct: 0, restsPerSec: 0 };
  r.section = section;
  return r;
}

const BUS = { sub: 'low*', kick: 'drums', clap: 'drums', hats: 'drums', bass: 'low*',
  chords: 'harm*', arp: 'harm*', lead: 'harm*', fx: 'air', motifs: 'air', power: 'air' };
// Layers whose material is held rather than struck. These are the ones a gate
// is audible on; percussion is supposed to swing.
const HELD = new Set(['sub', 'chords', 'lead', 'fx']);
const STEMS = Object.keys(BUS);

await p.evaluate(setWave, WAVE);
await measure(null); // warm up; the first window after a wave jump is a transition

const passes = [];
for (let rep = 0; rep < REPS; rep++) {
  const pass = {};
  for (const id of STEMS) pass[id] = await measure(id);
  pass.__full = await measure(null);
  passes.push(pass);
  console.log(`pass ${rep + 1} done`);
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

console.log('\nstem      bus     swing dB (p90-p10), one column per pass');
const rows = [];
for (const id of [...STEMS, '__full']) {
  const vals = passes.map((x) => x[id].swing);
  const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
  const spread = Math.max(...vals) - Math.min(...vals);
  const avg = (xs) => xs.reduce((a, c) => a + c, 0) / xs.length;
  const holes = avg(passes.map((x) => x[id].holesPerSec));
  const holed = avg(passes.map((x) => x[id].holedPct));
  rows.push({ id, mean, spread, holes, holed, held: HELD.has(id) });
  const tag = id === '__full' ? 'FULL MIX' : id;
  console.log(
    `${tag.padEnd(9)} ${(BUS[id] ?? '-').padEnd(7)} ${vals.map((v) => String(v).padStart(6)).join('')}` +
    `  mean ${mean.toFixed(1).padStart(5)} spread ${spread.toFixed(1).padStart(4)}` +
    `  holes ${holes.toFixed(2).padStart(5)}/s (${holed.toFixed(1).padStart(4)}%)` +
    (HELD.has(id) ? '  <- held' : '') + ((BUS[id] ?? '').endsWith('*') ? ' (ducked)' : ''),
  );
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
if (__reloads() > 0) {
  console.log(`\nABORTED: the page reloaded ${__reloads()} time(s) mid-sweep, so some rows measured a title screen with no audio.`);
  process.exit(3);
}

const get = (id) => rows.find((r) => r.id === id);
const perc = Math.max(get('hats').mean, get('clap').mean);
if (perc < 20) {
  console.log(`\nCONTROL FAILED: percussion measured only ${perc.toFixed(1)}dB of swing. The follower is broken; ignore every row above.`);
  process.exit(2);
}
/*
 * The hole count has its own controls, and they run the opposite way from the
 * swing controls: percussion is SUPPOSED to be full of holes, and a sustained
 * pad is supposed to have none. If the kick does not register as holed the
 * detector cannot see a gap at all; if the pad does, something is cutting it.
 */
/*
 * The positive control is the HI-HAT, not the kick.
 *
 * The kick was the obvious choice and is the wrong one: four-on-the-floor at
 * 130bpm leaves ~450ms between hits, which is longer than HOLE_MAX_MS, so its
 * gaps are correctly classified as rests and it scored 0.70/s against a
 * `> 1/s` control gate. The detector was working perfectly and the control said
 * it was broken. A hi-hat at sixteenths leaves ~100ms, which is squarely inside
 * the window a chop lives in, so it is the pattern that proves this can see a
 * gap of the size being hunted.
 */
const hatHoles = get('hats').holes;
console.log(`\nHOLE DETECTOR  (a gap ${HOLE_DB}dB down, lasting ${HOLE_MS}-${HOLE_MAX_MS}ms)`);
console.log(`  positive control — hats, gaps of ~100ms    : ${hatHoles.toFixed(2)}/s, ${get('hats').holed.toFixed(1)}% of the time`);
console.log(`  (kick is not the control: its gaps are ~450ms, longer than a chop, and count as rests)`);
console.log(`  negative control — chords, a sustained pad : ${get('chords').holes.toFixed(2)}/s, ${get('chords').holed.toFixed(1)}% of the time`);
if (get('chords').holes > 1) {
  console.log('  NOTE: the pad is being cut. That is the defect this tool exists to find.');
}
if (hatHoles < 2) {
  console.log('  CONTROL FAILED: the hi-hat did not register as holed, so this cannot see a gap. Ignore the hole numbers.');
} else {
  const mix = rows.find((r) => r.id === '__full');
  console.log(`  FULL MIX                                  : ${mix.holes.toFixed(2)}/s, ${mix.holed.toFixed(1)}% of the time`);
  console.log(mix.holed > 2 ? `  >>> THE MIX STOPS ${mix.holed.toFixed(1)}% OF THE TIME <<<` : '  the mix does not stop');
}
console.log(`\npercussion reference (hats/clap, should swing): ${perc.toFixed(1)}dB`);
console.log(`un-ducked held reference (fx): ${get('fx').mean.toFixed(1)}dB`);
const worstHeld = rows.filter((r) => r.held && r.id !== 'fx').sort((a, b) => b.mean - a.mean)[0];
console.log(`worst held layer on a ducked bus: ${worstHeld.id} at ${worstHeld.mean.toFixed(1)}dB`);
const verdict = worstHeld.mean > get('fx').mean + 10;
console.log(
  verdict
    ? `\n>>> A HELD LAYER SWINGS ${(worstHeld.mean - get('fx').mean).toFixed(1)}dB MORE THAN THE UN-GATED REFERENCE — SOMETHING IS CUTTING IT UP <<<`
    : `\nheld layers stay held`,
);
process.exit(verdict ? 1 : 0);
