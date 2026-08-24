/**
 * A named wave has to sound named.
 *
 * From wave 9 every third non-boss wave runs under one rule — FLANKED, SOLOIST
 * or HUSHED — announced by a banner and measurably different to play. The
 * premise of this game is that the stage and the score are the same thing, so a
 * wave the player is told about and cannot hear is the premise failing.
 *
 * Each movement is measured against ORDINARY WAVES SAMPLED IN THE SAME RUN, on
 * three axes chosen because each movement claims a different one:
 *
 *   low/air balance — HUSHED pulls the kit back and opens the top.
 *   lead over accompaniment — SOLOIST puts one voice in front of the ensemble.
 *   stereo width — FLANKED throws the line to the wings.
 *
 * THE CONTROL IS ORDINARY AGAINST ORDINARY, and it is the whole reason this
 * tool is trustworthy. Two ordinary waves are measured the same way, and the
 * spread between them is printed before any verdict. `tools/README.md` records
 * what happens without it: `everypowerup` once reported all twelve powerups
 * working because it compared two moments 2.4s apart, and with nothing held at
 * all that comparison differed 6 times out of 6. The arrangement moves on its
 * own. A movement has to beat that, not merely differ.
 *
 * Width is measured as one minus the correlation between the two output
 * channels, taken from a ChannelSplitter on the same tap the other audio checks
 * use. A mono mix reads 0; a hard-panned pair reads near 1.
 *
 * Samples are BUCKETED BY THE MOVEMENT OBSERVED AT EACH TICK, not by the wave
 * that was jumped to. The first version jumped to a wave, held for eleven
 * seconds and attributed everything it heard to that wave — but the bot clears
 * a wave in less than that, so the game had moved on underneath every window
 * and all five rows came back reporting the same movement. Reading the game's
 * own state 25 times a second and filing each sample under whatever is actually
 * running removes the race entirely, and costs nothing.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

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

await p.evaluate(() => {
  const ctx = window.__musicwars.audioCtx();
  const split = ctx.createChannelSplitter(2);
  window.__tapBus.connect(split);
  const mk = () => {
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    return a;
  };
  const L = mk(), R = mk(), M = mk();
  split.connect(L, 0);
  split.connect(R, 1);
  window.__tapBus.connect(M);
  window.__mine.add(split);
  window.__mine.add(L);
  window.__mine.add(R);
  window.__mine.add(M);
  const bl = new Float32Array(L.fftSize), br = new Float32Array(R.fftSize);
  const spec = new Float32Array(M.frequencyBinCount);
  // One bucket per movement, plus `none`, filled by whatever the game says it
  // is running at the instant of the sample.
  const fresh = () => ({ n: 0, corr: 0, low: 0, air: 0, lead: 0, accomp: 0, rms: 0 });
  window.__buckets = { none: fresh(), hush: fresh(), elite: fresh(), flank: fresh() };
  // The `none` bucket is also split by half, so its two halves are a drift band
  // measured under exactly the conditions everything else was measured under.
  window.__noneHalves = [fresh(), fresh()];
  window.__half = 0;
  window.__resetAll = () => {
    for (const k of Object.keys(window.__buckets)) window.__buckets[k] = fresh();
    window.__noneHalves = [fresh(), fresh()];
  };
  setInterval(() => {
    const world = window.__musicwars?.world;
    if (!world || !world.player || world.player.dead) return;
    const a = window.__buckets[world.movement ?? 'none'];
    if (!a) return;
    L.getFloatTimeDomainData(bl);
    R.getFloatTimeDomainData(br);
    let sl = 0, sr = 0, slr = 0;
    for (let i = 0; i < bl.length; i++) {
      sl += bl[i] * bl[i];
      sr += br[i] * br[i];
      slr += bl[i] * br[i];
    }
    const denom = Math.sqrt(sl * sr);
    // Silence has no width; skip it rather than counting it as mono.
    if (denom > 1e-9) {
      a.corr += slr / denom;
      M.getFloatFrequencyData(spec);
      const hz = M.context.sampleRate / 2 / spec.length;
      let low = 0, air = 0;
      for (let i = 0; i < spec.length; i++) {
        const f = i * hz;
        const e = Math.pow(10, spec[i] / 20);
        if (f < 220) low += e;
        else if (f > 4000) air += e;
      }
      a.low += low;
      a.air += air;
      a.rms += Math.sqrt(sl / bl.length);
      const lv = window.__musicwars.readout().levels;
      a.lead += lv.lead;
      a.accomp += lv.arp + lv.chords + lv.motifs;
      a.n++;
      if ((world.movement ?? 'none') === 'none') {
        const h = window.__noneHalves[window.__half];
        h.corr += slr / denom;
        h.low += low;
        h.air += air;
        h.rms += Math.sqrt(sl / bl.length);
        h.lead += lv.lead;
        h.accomp += lv.arp + lv.chords + lv.motifs;
        h.n++;
      }
    }
  }, 40);
});

await installDriver(p, 'dodge');

/*
 * Walk the waves the movements actually live on, letting the bot play each one.
 *
 * Nothing is attributed to a wave index; the in-page sampler files every tick
 * under whatever the game says it is running at that moment, so a wave clearing
 * early or a boss arriving simply moves the samples to another bucket.
 */
await p.evaluate(() => window.__resetAll());
/*
 * Enough waves that both the effect AND the control band settle.
 *
 * At 26 waves the low/air control band read 0%, 12% and 23% on three runs, and
 * HUSHED's 45% effect passed twice and failed once against a `2x the band`
 * gate. That is a threshold sitting inside its own metric's spread, which this
 * repository has been caught by often enough that `tools/README.md` devotes a
 * paragraph to it. The fix is more samples, not a kinder gate: a movement bucket
 * only fills while that movement is actually running, so it collects roughly a
 * tenth of what the ordinary buckets do.
 */
const WAVES = Number(process.env.WAVES ?? 40);
const DWELL = Number(process.env.DWELL ?? 5500);
for (let i = 0; i < WAVES; i++) {
  await p.evaluate(({ wv, half }) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv);
    w.player.lives = 4;
    w.player.hp = w.player.maxHp;
    /*
     * The control alternates waves rather than splitting the run in half.
     *
     * Splitting by time compares waves 9-21 against 22-34, and those differ by
     * design — different grooves, different keys, more on screen — so the band
     * came out at 0.10 of stereo width and swallowed a real effect. Alternating
     * puts neighbouring waves on opposite sides of the control, which measures
     * the arrangement's own variability instead of the run's arc.
     */
    window.__half = half;
  }, { wv: 9 + i, half: i % 2 });
  await p.waitForTimeout(DWELL);
}

const raw = await p.evaluate(() => ({ buckets: window.__buckets, halves: window.__noneHalves }));
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

const stats = (a) =>
  a.n < 40
    ? null
    : {
        n: a.n,
        width: +(1 - a.corr / a.n).toFixed(4),
        lowOverAir: +(a.low / Math.max(a.air, 1e-9)).toFixed(3),
        leadOverAccomp: +(a.lead / Math.max(a.accomp, 1e-6)).toFixed(3),
        rms: +(a.rms / a.n).toFixed(5),
      };

const out = {
  'ordinary A': stats(raw.halves[0]),
  'ordinary B': stats(raw.halves[1]),
  HUSHED: stats(raw.buckets.hush),
  SOLOIST: stats(raw.buckets.elite),
  FLANKED: stats(raw.buckets.flank),
};
for (const [label, r] of Object.entries(out)) {
  console.log(
    r
      ? `${label.padEnd(12)} n=${String(r.n).padStart(5)}  width ${String(r.width).padStart(7)}  ` +
        `low/air ${String(r.lowOverAir).padStart(8)}  lead/accomp ${String(r.leadOverAccomp).padStart(6)}  rms ${r.rms}`
      : `${label.padEnd(12)} NOT ENOUGH SAMPLES`,
  );
}
if (Object.values(out).some((r) => !r)) {
  console.log('\nA bucket never filled — the run did not reach every movement. Raise WAVES.');
  process.exit(2);
}
const A = out['ordinary A'], B = out['ordinary B'];
const drift = {
  width: Math.abs(A.width - B.width),
  lowOverAir: Math.abs(A.lowOverAir - B.lowOverAir) / Math.max(A.lowOverAir, B.lowOverAir),
  leadOverAccomp: Math.abs(A.leadOverAccomp - B.leadOverAccomp) / Math.max(A.leadOverAccomp, B.leadOverAccomp),
};
console.log(
  `\nCONTROL — two ordinary waves differ by: width ${drift.width.toFixed(4)}, ` +
  `low/air ${(drift.lowOverAir * 100).toFixed(0)}%, lead/accomp ${(drift.leadOverAccomp * 100).toFixed(0)}%.`,
);
console.log('Nothing below counts unless it beats that.\n');

const rel = (x, a) => Math.abs(x - a) / Math.max(x, a, 1e-9);
const checks = [
  ['HUSHED', 'low/air', () => rel(out.HUSHED.lowOverAir, A.lowOverAir), drift.lowOverAir,
    () => out.HUSHED.lowOverAir < A.lowOverAir],
  ['SOLOIST', 'lead/accomp', () => rel(out.SOLOIST.leadOverAccomp, A.leadOverAccomp), drift.leadOverAccomp,
    () => out.SOLOIST.leadOverAccomp > A.leadOverAccomp],
  ['FLANKED', 'width', () => Math.abs(out.FLANKED.width - A.width), drift.width,
    () => out.FLANKED.width > A.width],
];

const failed = [];
for (const [name, axis, measure, band, rightWay] of checks) {
  const got = measure();
  const beats = got > band * 2 && rightWay();
  console.log(
    `${name.padEnd(8)} moved ${axis} by ${(axis === 'width' ? got.toFixed(4) : (got * 100).toFixed(0) + '%')} ` +
    `against a control band of ${(axis === 'width' ? band.toFixed(4) : (band * 100).toFixed(0) + '%')} — ` +
    (beats ? 'AUDIBLE' : rightWay() ? 'inside the noise' : 'moved the WRONG WAY'),
  );
  if (!beats) failed.push(name);
}
console.log(
  failed.length
    ? `\n>>> ${failed.join(', ')} DOES NOT SOUND DIFFERENT FROM AN ORDINARY WAVE <<<`
    : '\nEVERY MOVEMENT SOUNDS LIKE ITSELF',
);
process.exit(failed.length ? 1 : 0);
