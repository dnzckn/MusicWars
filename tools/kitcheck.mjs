/*
 * kitcheck — the sampled drum kit's contract, in Node, in BOTH modes.
 *
 * `src/audio/samples.ts` put nine drum-machine one-shots under `kit.ts`, with
 * the oscillator kit as the fallback and one switch (`kitReady()`) deciding
 * which body a drum function emits. Like the soundfonts before it, the half
 * nobody will notice breaking is the fallback — a broken fallback looks
 * exactly like a slow connection — and the half nobody can hear in Node is
 * the sampled one. So this queries the drum builders twice, flipping the
 * module's own mode, and asserts what each mode may emit.
 *
 * THE ASSERTIONS, each with its denominator printed:
 *
 *   BYTES     Every URL in the map answers a HEAD on the CDN with 200 and the
 *             byte count the table declares; the sum is at most 300 KB. The
 *             second base is HEADed too and printed, not asserted (it is the
 *             backstop, and GitHub raw is slower). `--no-net` skips this and
 *             says so in red.
 *   FALLBACK  With the kit forced off, no drum hap carries an `mw_` name and
 *             every drum hap is `sine`, `triangle` or `white` — the shipped
 *             oscillator kit and nothing else.
 *   SAMPLED   With the kit forced on, every `mw_` name emitted exists in the
 *             table; the kick, the snare AND the clap (stacked), the closed
 *             and open hats, the rim and the shaker all appear, with counts
 *             per bar per feel; the 808 appears on half-time and nowhere
 *             else; the LinnDrum hat appears on the fill bar.
 *   TRAPS     No sampled hap carries a `note` (superdough repitches a sample
 *             from MIDI 36 — `util.mjs:89` — so `g1` on the 909 kick would
 *             play it five semitones flat), none carries `attack`/`decay`/
 *             `sustain` (a decay with sustain 0 CUTS a sample after that many
 *             seconds, `sampler.mjs:318`), and `clip` appears only on the
 *             open hat, with the hold `kit.ts` names.
 *   SAME      The set of onset times per builder per bar is identical in both
 *             modes. The mode changes the SOUND; a different onset set is a
 *             different piece of music.
 *   BUDGET    Drum haps per ordinary bar in the drop (sampled mode, where one
 *             drum is one hap): mean over feels x intensities x bars 0-6 at
 *             most 28, and no single bar above 30. The fill bar is printed and
 *             not bounded. 28 is the spec's aim from reference B's 20-24; 30
 *             is the ceiling that catches a layer coming back (the per-bar
 *             ratchets were +2-6, the sixteenth layer +6-8). The fallback
 *             count is printed for scale and is not bounded: an oscillator
 *             drum is two haps (crack + body), so its number is not a hit
 *             count.
 *
 * SEEN RED, once per assertion, 2026-09-05 (each break made and reverted by
 * hand; the lines quoted are what the tool printed):
 *
 *   BYTES     table byte for the 808 cabasa set to 7041 ->
 *             "mw_sh808: HEAD says 7040 B, the table says 7041"
 *   FALLBACK  `kick()`'s `if (kitReady())` made unconditional ->
 *             "fallback mode emitted 272 'mw_bd909' haps; the fallback is not
 *             the shipped kit"
 *   SAMPLED   `shaker()` returned `silence` in sampled mode ->
 *             "sampled mode never emitted mw_sh808 (shaker)"
 *   TRAPS     `.ds('0.05:0')` added to the sampled snare ->
 *             "'mw_sd909' carries decay; a decay with sustain 0 cuts a sample"
 *   SAME      `kick808('x ~ x ~')` (the 808 on beat 3 as well) ->
 *             "buildKick halftime/0.7/bar0: onsets differ between modes"
 *   BUDGET    per-bar ratchets restored in `percGrid` (want = 2) ->
 *             "drop bars 0-6: max 35 > 30" and "mean 29.6 > 28"
 *
 * No browser. `--landing` adds one: it opens the game on the dev server,
 * presses START, and prints how long after that the kit and the fonts landed
 * — cold (a fresh browser) and warm (a second context in the same browser).
 * That is the only honest measurement of `beginKitLoad` and it is a reading,
 * not an assertion; a slow CDN is not a defect in this repo.
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const argv = process.argv.slice(2);
const NO_NET = argv.includes('--no-net');
const LANDING = argv.includes('--landing');

const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const S = await import('../src/audio/samples.ts');
const K = await import('../src/audio/kit.ts');
const { buildChord } = await import('../src/audio/theory.ts');

const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const SECTIONS = ['intro', 'build', 'drop', 'sustain', 'breakdown', 'fill'];
const INTENSITIES = [0.3, 0.5, 0.7, 0.9];
const remap01 = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/** A `MusicalState` good enough to build one bar of drums with. */
function state(over = {}) {
  const tonic = 57;
  const mode = 'aeolian';
  const i = over.intensity ?? 0.7;
  return {
    tension: i,
    immediate: 0.5,
    section: over.section ?? 'drop',
    buildProgress: 1,
    fillBar: over.fillBar ?? false,
    bar: over.bar ?? 0,
    tonic,
    mode,
    chord: buildChord(tonic, mode, 0),
    nextChord: buildChord(tonic, mode, 4),
    chordIndex: 0,
    barInPhrase: over.bar ?? 0,
    phrase: 0,
    feel: over.feel ?? 'boomchick',
    bpm: 136,
    intensity: i,
    brightness: 0.5,
    powerups: {},
    enemies: { pluck: 0, stutter: 0, arpeggiator: 0, glissando: 0, subdrop: 0, echo: 0, rush: 0, conductor: 0 },
    boss: false,
    bossTheme: false,
    bossPhase: 0,
    wave: 4,
    recap: false,
    bombs: 0,
    health: 1,
    grazeRate: 0,
    combo: 0,
    leadRegister: 0,
    movement: null,
    // The director's own intensity -> signal ladders (perccheck checks these
    // literals against director.ts; this tool does not repeat that check).
    sig: makeSignals(strudel, {
      density: remap01(i, 0.18, 0.5),
      fill: remap01(i, 0.58, 0.82),
      ornament: remap01(i, 0.68, 0.9),
    }),
    ...over,
  };
}

const fails = [];
const line = (s) => console.log(s);
const OSC = new Set(['sine', 'triangle', 'white']);
const KIT = new Set(S.KIT_NAMES);

line('');
line('kitcheck — the sampled drum kit and its fallback');
line('');

/* ------------------------------------------------------------------ BYTES */

line(`  BYTES — ${S.KIT_SAMPLES.length} files, table total ${S.KIT_WIRE_BYTES} B, budget 300000 B`);
if (NO_NET) {
  fails.push('--no-net: the byte table was NOT verified against the CDN; this run cannot be green');
} else {
  const head = async (url) => {
    const t = Date.now();
    try {
      const r = await fetch(url, { method: 'HEAD' });
      return { status: r.status, bytes: Number(r.headers.get('content-length') ?? -1), ms: Date.now() - t, acao: r.headers.get('access-control-allow-origin') };
    } catch (err) {
      return { status: 0, bytes: -1, ms: Date.now() - t, error: String(err?.message ?? err) };
    }
  };
  for (const [bi, base] of S.KIT_BASE_URLS.entries()) {
    line(`    base ${bi}: ${base}${bi === 0 ? '  (asserted)' : '  (backstop, printed)'}`);
    let sum = 0;
    let checked = 0;
    const rows = await Promise.all(S.KIT_SAMPLES.map(async (k) => [k, await head(base + k.path)]));
    for (const [k, r] of rows) {
      checked++;
      line(`      ${k.name.padEnd(10)} ${String(r.status).padStart(3)} ${String(r.bytes).padStart(7)} B ${String(r.ms).padStart(5)} ms  acao=${r.acao ?? '-'}  ${k.path}`);
      if (bi !== 0) continue;
      if (r.status !== 200) fails.push(`${k.name}: HEAD ${base + k.path} -> ${r.status}${r.error ? ` (${r.error})` : ''}`);
      else if (r.bytes !== k.bytes) fails.push(`${k.name}: HEAD says ${r.bytes} B, the table says ${k.bytes}`);
      if (r.acao !== '*') fails.push(`${k.name}: access-control-allow-origin is ${r.acao}, not *; the browser could not fetch it`);
      sum += Math.max(0, r.bytes);
    }
    if (bi === 0) {
      line(`    live total ${sum} B over ${checked} files`);
      if (checked !== S.KIT_SAMPLES.length) fails.push(`HEADed ${checked} of ${S.KIT_SAMPLES.length} files`);
      if (sum > 300000) fails.push(`the kit is ${sum} B on the wire, over the 300 KB budget`);
      if (sum !== S.KIT_WIRE_BYTES) fails.push(`KIT_WIRE_BYTES ${S.KIT_WIRE_BYTES} disagrees with the live sum ${sum}`);
    }
  }
}

/* ---------------------------------------------------- the drum builders */

/** Every drum hap for one bar, tagged with which builder emitted it. */
function drumHaps(m) {
  return [
    ...notesIn(L.buildKick(m), 1).map((h) => ({ ...h, builder: 'buildKick' })),
    ...notesIn(L.buildClap(m), 1).map((h) => ({ ...h, builder: 'buildClap' })),
  ];
}

const cases = [];
for (const feel of FEELS) {
  for (const section of SECTIONS) {
    for (const intensity of INTENSITIES) {
      for (let bar = 0; bar < 8; bar++) {
        cases.push({ feel, section, intensity, bar, fillBar: bar === 7 });
      }
    }
  }
}

function sweep() {
  const out = new Map();
  for (const c of cases) out.set(`${c.feel}/${c.section}/${c.intensity}/${c.bar}`, drumHaps(state(c)));
  return out;
}

S.setKitModeForTesting('fallback');
if (S.kitReady()) fails.push('setKitModeForTesting("fallback") left kitReady() true');
const fb = sweep();
S.setKitModeForTesting('ready');
if (!S.kitReady()) fails.push('setKitModeForTesting("ready") left kitReady() false');
const sm = sweep();
S.setKitModeForTesting('written');
if (!S.kitReady()) fails.push('in Node the WRITTEN score must be the sampled kit (kitReady() false after reset)');

/* --------------------------------------------------------------- FALLBACK */

line('');
const fbSources = new Map();
let fbHaps = 0;
for (const haps of fb.values()) {
  for (const h of haps) {
    fbHaps++;
    fbSources.set(h.s, (fbSources.get(h.s) ?? 0) + 1);
  }
}
line(`  FALLBACK — ${fbHaps} drum haps over ${fb.size} bars: ${[...fbSources].map(([k, v]) => `${k}×${v}`).join(' ')}`);
for (const [src, n] of fbSources) {
  if (KIT.has(src)) fails.push(`fallback mode emitted ${n} '${src}' haps; the fallback is not the shipped kit`);
  else if (!OSC.has(src)) fails.push(`fallback mode emitted ${n} '${src}' haps, which is neither a sample nor a shipped oscillator`);
}
if (fbHaps === 0) fails.push('fallback mode emitted nothing; a check with no denominator is not a pass');

/* ---------------------------------------------------------------- SAMPLED */

line('');
const smSources = new Map();
let smHaps = 0;
let smOsc = 0;
const perFeel = new Map();
const traps = new Set();
let bd808OffHalftime = 0;
let bd808Halftime = 0;
let linnOffFill = 0;
let linnFill = 0;
let ohPerBar = [];
for (const [key, haps] of sm) {
  const [feel, section, , bar] = key.split('/');
  const counts = perFeel.get(feel) ?? new Map();
  perFeel.set(feel, counts);
  let oh = 0;
  for (const h of haps) {
    smHaps++;
    smSources.set(h.s, (smSources.get(h.s) ?? 0) + 1);
    if (!KIT.has(h.s)) {
      smOsc++;
      if (!OSC.has(h.s)) fails.push(`sampled mode emitted '${h.s}', which is neither in the table nor a shipped oscillator`);
      continue;
    }
    counts.set(h.s, (counts.get(h.s) ?? 0) + 1);
    if (h.s === 'mw_oh909') oh++;
    if (h.s === 'mw_bd808') (feel === 'halftime' ? bd808Halftime++ : bd808OffHalftime++);
    if (h.s === 'mw_hhlinn') (bar === '7' ? linnFill++ : linnOffFill++);
    // TRAPS
    if (h.note !== undefined) traps.add(`'${h.s}' carries note ${h.note}; superdough would repitch the sample from MIDI 36`);
    for (const k of ['attack', 'decay', 'sustain']) {
      if (h[k] !== undefined) traps.add(`'${h.s}' carries ${k}; a decay with sustain 0 cuts a sample (sampler.mjs:318)`);
    }
    if (h.clip !== undefined && h.s !== 'mw_oh909') traps.add(`'${h.s}' carries clip ${h.clip}; only the open hat is meant to be held`);
    if (h.s === 'mw_oh909') {
      if (h.clip !== K.OPEN_HAT_CLIP) traps.add(`open hat clip is ${h.clip}, kit.ts says OPEN_HAT_CLIP = ${K.OPEN_HAT_CLIP}`);
      if (h.release !== K.OPEN_HAT_RELEASE) traps.add(`open hat release is ${h.release}, kit.ts says OPEN_HAT_RELEASE = ${K.OPEN_HAT_RELEASE}`);
    }
    if (h.s === 'mw_bd909' && (h.duckorbit === undefined || h.duckdepth === undefined)) {
      traps.add(`the sampled kick carries no sidechain (duckorbit/duckdepth); the low orbit would stop ducking`);
    }
    if (h.s === 'mw_sh808' && section !== 'build' && section !== 'drop' && section !== 'sustain' && section !== 'fill') {
      traps.add(`the shaker sounds in '${section}'; it belongs to build/drop/sustain/fill only`);
    }
  }
  ohPerBar.push(oh);
}
line(`  SAMPLED — ${smHaps} drum haps over ${sm.size} bars (${smOsc} still on oscillators: the bell): ${[...smSources].map(([k, v]) => `${k}×${v}`).join(' ')}`);
line('');
line(`  ${'feel'.padEnd(10)} ${S.KIT_NAMES.map((n) => n.replace('mw_', '').padStart(7)).join('')}   (haps per bar, mean over ${SECTIONS.length} sections x ${INTENSITIES.length} intensities x 8 bars)`);
const barsPerFeel = SECTIONS.length * INTENSITIES.length * 8;
for (const feel of FEELS) {
  const counts = perFeel.get(feel) ?? new Map();
  line(`  ${feel.padEnd(10)} ${S.KIT_NAMES.map((n) => ((counts.get(n) ?? 0) / barsPerFeel).toFixed(2).padStart(7)).join('')}`);
  const need = ['mw_bd909', 'mw_sd909', 'mw_cp909', 'mw_hh909', 'mw_oh909', 'mw_rim909', 'mw_sh808', 'mw_hhlinn'];
  for (const n of need) {
    if (!(counts.get(n) > 0)) fails.push(`sampled mode never emitted ${n} on ${feel}`);
  }
}
for (const n of S.KIT_NAMES) {
  if (!smSources.has(n)) fails.push(`sampled mode never emitted ${n} (${n === 'mw_sh808' ? 'shaker' : n === 'mw_bd808' ? 'the half-time 808' : n})`);
}
if (bd808OffHalftime > 0) fails.push(`the 808 sounded ${bd808OffHalftime} times outside half-time`);
if (bd808Halftime === 0) fails.push('the 808 never sounded on half-time');
if (linnOffFill > 0) fails.push(`the LinnDrum hat sounded ${linnOffFill} times off the fill bar; the sixteenth layer is the fill bar's`);
if (linnFill === 0) fails.push('the LinnDrum hat never sounded on a fill bar');
const ohBad = ohPerBar.filter((n) => n !== 1).length;
line(`  open hat: exactly one per bar in ${ohPerBar.length - ohBad}/${ohPerBar.length} bars`);
if (ohBad > 0) fails.push(`${ohBad} bars did not carry exactly one open hat (the last accent)`);
for (const t of traps) fails.push(`TRAP: ${t}`);
line(`  traps: ${traps.size === 0 ? 'none' : `${traps.size} (see FAIL lines)`}`);
if (smHaps === 0) fails.push('sampled mode emitted nothing; a check with no denominator is not a pass');

/* ------------------------------------------------------------------- SAME */

let sameChecked = 0;
let sameBad = 0;
for (const [key, a] of sm) {
  const b = fb.get(key);
  for (const builder of ['buildKick', 'buildClap']) {
    sameChecked++;
    const onsets = (haps) => [...new Set(haps.filter((h) => h.builder === builder).map((h) => h.begin.toFixed(5)))].sort().join(',');
    if (onsets(a) !== onsets(b)) {
      sameBad++;
      if (sameBad <= 3) fails.push(`${builder} ${key}: onsets differ between modes — sampled [${onsets(a)}] vs fallback [${onsets(b)}]`);
    }
  }
}
line('');
line(`  SAME — ${sameChecked} builder-bars compared by onset set, ${sameBad} differ`);
if (sameBad > 3) fails.push(`${sameBad} builder-bars differ in onset set between modes (first 3 listed)`);
if (sameChecked === 0) fails.push('nothing compared between modes');

/* ----------------------------------------------------------------- BUDGET */

line('');
line('  BUDGET — drum haps per bar in the DROP, sampled mode (one drum = one hap); fallback in brackets (crack+body = two)');
line(`  ${'feel'.padEnd(10)} ${'i'.padStart(4)}  bars 0..7${' '.repeat(22)} mean0-6  max0-6`);
let budgetSum = 0;
let budgetN = 0;
let budgetMax = 0;
let budgetMaxWhere = '';
let fillMax = 0;
for (const feel of FEELS) {
  for (const intensity of [0.5, 0.7, 0.9]) {
    const row = [];
    let sum = 0;
    let max = 0;
    for (let bar = 0; bar < 8; bar++) {
      const key = `${feel}/drop/${intensity}/${bar}`;
      const n = sm.get(key).length;
      const f = fb.get(key).length;
      row.push(`${String(n).padStart(2)}[${f}]`);
      if (bar === 7) {
        fillMax = Math.max(fillMax, n);
        continue;
      }
      sum += n;
      budgetSum += n;
      budgetN++;
      if (n > max) max = n;
      if (n > budgetMax) {
        budgetMax = n;
        budgetMaxWhere = `${feel} i=${intensity} bar ${bar}`;
      }
    }
    line(`  ${feel.padEnd(10)} ${intensity.toFixed(1).padStart(4)}  ${row.join(' ')}  ${(sum / 7).toFixed(1).padStart(7)}  ${String(max).padStart(6)}`);
  }
}
const budgetMean = budgetSum / Math.max(1, budgetN);
line(`  drop bars 0-6: mean ${budgetMean.toFixed(1)} over ${budgetN} bars, max ${budgetMax} (${budgetMaxWhere}); fill bar max ${fillMax} (printed, not bounded)`);
if (budgetN === 0) fails.push('the budget examined 0 bars');
if (budgetMean > 28) fails.push(`drop bars 0-6: mean ${budgetMean.toFixed(1)} > 28 — the spec's aim is 24-28 (reference B is 20-24)`);
if (budgetMax > 30) fails.push(`drop bars 0-6: max ${budgetMax} > 30 at ${budgetMaxWhere} — a layer has come back`);

/* --------------------------------------------------------------- LANDING */

if (LANDING) {
  const { chromium } = await import('playwright');
  const URL = process.env.MUSICWARS_URL ?? 'http://localhost:5173/';
  line('');
  line(`  LANDING — ${URL}: press START, then poll window.__kit / window.__soundfonts`);
  /*
   * The same launch and the same START as `fontcheck.mjs`: a click on
   * `#start-button` inside a browser that needs no gesture to start audio.
   * Bytes are metered at the socket for the same reason that tool gives —
   * Resource Timing reports 0 for both hosts.
   *
   * COLD is a fresh browser process; WARM is a second context in the same
   * process, which shares sockets and DNS (the samples report measured the
   * two "cold" shapes 13x apart for exactly that reason). Neither includes
   * the HTTP cache: contexts do not share one, and `samples.ts` fetches with
   * whatever the browser does by default.
   */
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const runOnce = async (label) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    const wire = { requests: 0, bytes: 0 };
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('requestfinished', async (req) => {
      if (!/strudel\.b-cdn\.net|raw\.githubusercontent\.com|felixroos\.github\.io/.test(req.url())) return;
      try {
        const s = await req.sizes();
        wire.requests++;
        wire.bytes += s.responseBodySize;
      } catch {
        /* finished after close */
      }
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__kit !== 'undefined' && typeof window.__soundfonts !== 'undefined', null, { timeout: 30000 });
    await page.click('#start-button');
    const t0 = Date.now();
    const deadline = t0 + 15000;
    let kit = null;
    let sf = null;
    let landedAt = null;
    while (Date.now() < deadline) {
      const r = await page.evaluate(() => ({ kit: window.__kit.report(), sf: window.__soundfonts.report() }));
      kit = r.kit;
      sf = r.sf;
      if (kit.state !== 'loading' && landedAt === null) landedAt = Date.now() - t0;
      if (kit.state !== 'loading' && sf.state !== 'loading') break;
      await page.waitForTimeout(25);
    }
    // A moment for the last `requestfinished` to be sized.
    await page.waitForTimeout(200);
    line(
      `    ${label.padEnd(5)} kit ${kit?.state}: first buffer ${kit?.firstMs?.toFixed(0)} ms, all nine ${kit?.totalMs?.toFixed(0)} ms after beginKitLoad ` +
        `(${landedAt ?? '>15000'} ms after the START click) via ${kit?.baseUrl || '-'}; ` +
        `fonts ${sf?.state} ${sf?.totalMs?.toFixed(0)} ms; wire ${wire.bytes} B over ${wire.requests} requests; page errors ${errs.length}`,
    );
    if (kit?.samples) {
      for (const s of kit.samples.filter((x) => !x.ok)) line(`      ${s.name} FAILED: ${s.error}`);
    }
    if (errs.length) line(`      ${errs.slice(0, 3).join(' | ')}`);
    await ctx.close();
    return { kit, sf };
  };
  const cold = await runOnce('cold');
  const warm = await runOnce('warm');
  await browser.close();
  if (cold.kit?.state !== 'ready') fails.push(`cold landing: kit state ${cold.kit?.state}`);
  if (warm.kit?.state !== 'ready') fails.push(`warm landing: kit state ${warm.kit?.state}`);
}

/* ---------------------------------------------------------------- verdict */

line('');
if (fails.length) {
  for (const f of fails) line(`  FAIL  ${f}`);
  line('');
  line(`kitcheck: ${fails.length} failure(s)`);
  process.exit(1);
}
line('kitcheck: ok');
