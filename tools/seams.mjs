/**
 * Is there a hole at the seams — where sections change and where the phrase wraps?
 *
 * `chop` measures the whole output and reports the mix does not stop, but it
 * averages over everything and a seam is a rare event: eight bars apart for a
 * phrase wrap, further for a section. A dip lasting 80ms that happens twice a
 * minute is inaudible in an average and extremely audible to a listener, and it
 * would land in exactly the places a listener is most primed to notice — the
 * downbeat of a new section, the top of a phrase.
 *
 * `retention` cannot see any of this either, because it holds the transport
 * still: no section can change and no phrase can wrap during its sweep.
 *
 * Three kinds of seam are marked, using the game's own state rather than
 * inferred from the audio:
 *
 *   SECTION  — the arranger moved between intro/build/drop/breakdown/fill/...
 *   WRAP     — bar 8 of the phrase became bar 1, where the eight-bar `cat` wraps
 *   FILL     — the one-bar fill section entered or left
 *   BAR      — every bar line, which is the one that matters most
 *
 * BAR was missing from the first version and that was a real hole in the
 * method. The pad is a single hap per cycle, so it RE-ATTACKS every bar with a
 * 0.45s attack over the previous note's 0.9s release; if those two do not sum
 * flat there is a dip or a bump every 1.7 seconds, which is far more audible
 * than anything happening once a phrase. Measuring only the phrase wrap would
 * have missed it seven times out of eight.
 *
 * THE CONTROL IS RANDOM MOMENTS, and it is the whole point. The same window is
 * cut at times chosen uniformly, unaligned to anything, and analysed the same
 * way. Music dips all the time — that is what music does — so a seam only means
 * something if it dips MORE than an arbitrary instant does. Without this null
 * every one of these events would look alarming, because a note ending is a dip
 * and there is always a note ending somewhere.
 *
 * The envelope follower is the same audio-thread AudioWorklet the rest of this
 * directory uses: one value per 128-sample quantum, 2.67ms, on the audio thread
 * where the main thread's stalls cannot reach it.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const HOLD = Number(process.env.HOLD ?? 45000);
const WAVES = (process.env.WAVES ?? '4,12,20').split(',').map(Number);
/** How far either side of a seam to look. */
const WIN_MS = 260;

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

await p.addInitScript(() => {
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
await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);

await p.evaluate(async () => {
  const ctx = window.__musicwars.audioCtx();
  const src = `
    class Env extends AudioWorkletProcessor {
      constructor() { super(); this.env = 0; this.buf = []; this.rel = Math.exp(-128 / (sampleRate * 0.02)); this.i = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        let pk = 0;
        if (ch) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > pk) pk = a; }
        this.env = pk > this.env ? pk : this.env * this.rel;
        this.buf.push(this.env);
        if (this.buf.length >= 256) { this.port.postMessage(this.buf); this.buf = []; }
        return true;
      }
    }
    registerProcessor('mw-seam', Env);`;
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ctx, 'mw-seam', { numberOfOutputs: 1, outputChannelCount: [1] });
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

  /*
   * Seams are timestamped in ENVELOPE SAMPLES, not in wall-clock milliseconds.
   *
   * The envelope arrives in blocks of 256 quanta, so its index is the only
   * clock that is exactly aligned with it. Marking a seam by `performance.now()`
   * and converting would put every mark up to 680ms out — wider than the window
   * being examined, which would smear every seam into the noise and produce a
   * confident null result for the wrong reason.
   */
  window.__marks = [];
  window.__seamReset = () => { window.__env.length = 0; window.__marks.length = 0; };
  let lastSection = null, lastBar = -1;
  setInterval(() => {
    const mw = window.__musicwars;
    const w = mw?.world;
    if (!w || w.player?.dead) return;
    const r = mw.readout();
    const at = window.__env.length;
    if (lastSection !== null && r.section !== lastSection) {
      window.__marks.push({ at, kind: r.section === 'fill' || lastSection === 'fill' ? 'FILL' : 'SECTION' });
    }
    lastSection = r.section;
    const bar = Math.floor(r.bar);
    if (bar !== lastBar) {
      if (lastBar >= 0) window.__marks.push({ at, kind: bar % 8 === 0 ? 'WRAP' : 'BAR' });
      lastBar = bar;
    }
  }, 16);
});

await installDriver(p, 'dodge');

/** Deepest dip in a window, in dB below that window's own peak. */
function dip(env, centre, halfWin) {
  const a = Math.max(0, centre - halfWin);
  const z = Math.min(env.length, centre + halfWin);
  if (z - a < 8) return null;
  let peak = 0, trough = Infinity;
  for (let i = a; i < z; i++) {
    if (env[i] > peak) peak = env[i];
    if (env[i] < trough) trough = env[i];
  }
  if (peak < 1e-5) return null;
  return 20 * Math.log10(Math.max(trough, 1e-7) / peak);
}

const all = { SECTION: [], WRAP: [], FILL: [], BAR: [], RANDOM: [] };
for (const wave of WAVES) {
  await p.evaluate((wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv);
    w.player.lives = 4;
    w.player.hp = w.player.maxHp;
    window.__seamReset();
  }, wave);
  await p.waitForTimeout(HOLD);
  const { env, rate, marks } = await p.evaluate(() => ({
    env: window.__env.slice(),
    rate: window.__envRate,
    marks: window.__marks.slice(),
  }));
  const half = Math.round((WIN_MS / 1000) * rate);
  for (const m of marks) {
    const d = dip(env, m.at, half);
    if (d !== null && all[m.kind]) all[m.kind].push(d);
  }
  // The null: as many random windows as there were seams, from the same audio.
  for (let i = 0; i < marks.length; i++) {
    const c = half + Math.floor(Math.random() * Math.max(1, env.length - 2 * half));
    const d = dip(env, c, half);
    if (d !== null) all.RANDOM.push(d);
  }
  console.log(`wave ${String(wave + 1).padStart(2)}: ${marks.length} seams over ${(env.length / rate).toFixed(0)}s of audio`);
}
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

const stat = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, c) => a - c);
  return {
    n: xs.length,
    median: s[Math.floor(s.length / 2)],
    // The deepest tenth is where an audible hole would hide.
    p10: s[Math.floor(s.length * 0.1)],
    worst: s[0],
  };
};

console.log(`\ndeepest dip inside a +-${WIN_MS}ms window, in dB below that window's own peak`);
console.log('(less negative is smoother; the RANDOM row is what an arbitrary moment looks like)\n');
const rows = ['SECTION', 'WRAP', 'FILL', 'BAR', 'RANDOM'];
const out = {};
for (const k of rows) {
  const st = stat(all[k]);
  out[k] = st;
  console.log(
    st
      ? `  ${k.padEnd(8)} n=${String(st.n).padStart(4)}   median ${st.median.toFixed(1).padStart(6)}dB   ` +
        `deepest tenth ${st.p10.toFixed(1).padStart(6)}dB   worst ${st.worst.toFixed(1).padStart(6)}dB`
      : `  ${k.padEnd(8)} no samples`,
  );
}

if (!out.RANDOM || out.RANDOM.n < 20) {
  console.log('\nnot enough audio to form a null. Nothing can be concluded.');
  process.exit(2);
}
const bad = [];
for (const k of ['SECTION', 'WRAP', 'FILL', 'BAR']) {
  if (!out[k]) continue;
  // A seam has to be more than 6dB deeper than an arbitrary moment before it is
  // worth calling a seam at all.
  const delta = out[k].median - out.RANDOM.median;
  console.log(
    `\n${k}: median ${delta > 0 ? '+' : ''}${delta.toFixed(1)}dB against an arbitrary moment` +
    (delta < -6 ? '  <- DEEPER' : '  (no deeper than anywhere else)'),
  );
  if (delta < -6) bad.push(k);
}
console.log(
  bad.length
    ? `\n>>> THE MIX DIPS AT ${bad.join(' AND ')} MORE THAN IT DOES ANYWHERE ELSE <<<`
    : '\nno seam dips more than an arbitrary moment does',
);
process.exit(bad.length ? 1 : 0);
