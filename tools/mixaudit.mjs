/**
 * Every stem, soloed in turn, across a real run.
 *
 * stemprobe measures one stem per browser launch, so nobody had ever looked at
 * all eleven together — and a layer that never rises above the noise floor is
 * both a hole in the mix and a piece of design nobody is hearing. This solos
 * each one twice at different points in the arrangement and reports what is
 * actually reaching the speakers.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await p.addInitScript(() => {
  const oc = AudioNode.prototype.connect; window.__tap = null;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try { if (d && d.context && d === d.context.destination) {
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 2048; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap); } } catch {}
    return res; };
});
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(12000);

const rows = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const ids = mw.director.stemIds ? mw.director.stemIds() : Object.keys(mw.readout().levels);
  /*
   * Peak over several bars, not mean RMS over a moment.
   *
   * The bass plays two notes a bar. Averaging RMS across a 1.6s window at
   * ~135bpm therefore lands mostly on its rests, and the same stem measured
   * -41dB here and -17.9dB under a 9s window — a 23dB spread that made every
   * threshold meaningless. Peak asks the question the check actually cares
   * about ("does this layer ever reach the speakers") and is indifferent to how
   * sparse the part is, as long as the window spans enough bars to contain one.
   */
  const measure = async (ms) => {
    let peak = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) { a.getFloatTimeDomainData(window.__buf);
        for (let i = 0; i < window.__buf.length; i++) { const v = Math.abs(window.__buf[i]); if (v > peak) peak = v; } }
      await new Promise((r) => setTimeout(r, 16));
    }
    return peak;
  };
  const acc = {};
  for (const id of ids) acc[id] = { solo: [], fader: [], notes: [], sections: [] };
  /*
   * Three passes, and the reported figure is the *max* of them.
   *
   * Even with the fader pinned, a stem's part thins out by section — hats in a
   * breakdown play a fraction of what they play in a drop, and a single pass
   * that lands there read -25.8dB against -16.9dB one run earlier. Sampling the
   * same layer at several points in the arrangement and keeping the loudest
   * answers "can this layer reach the speakers at all", which is the question,
   * rather than "was it busy at the moment I looked".
   *
   * Two passes was not enough. Hats measured -30.4dB, -27.9dB and -2.5dB on
   * three consecutive runs of an unchanged build — a 28dB spread, which makes
   * any threshold inside it a coin flip. This was flagged as "slightly tight"
   * when the gate was written and shipped anyway; a third pass is the fix,
   * rather than widening the gate until the flake stops.
   */
  for (let pass = 0; pass < 3; pass++) {
    for (const id of ids) {
      mw.director.solo = id;
      await new Promise((r) => setTimeout(r, 900));
      const solo = await measure(4500);
      const rd = mw.readout();
      acc[id].solo.push(solo);
      acc[id].fader.push(rd.levels[id]);
      acc[id].sections.push(rd.section);
      acc[id].notes.push(mw.director.sampleBar(mw.world.transport)[id].length);
    }
  }
  mw.director.solo = null;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return ids.map((id) => ({
    stem: id,
    peakSolo: +Math.max(...acc[id].solo).toFixed(5),
    fader: +mean(acc[id].fader).toFixed(2),
    notes: Math.max(...acc[id].notes),
    sections: [...new Set(acc[id].sections)].join('/'),
  }));
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows);
const FLOOR = 0.001;
const silent = rows.filter((r) => r.peakSolo <= FLOOR);
const noNotes = rows.filter((r) => r.notes === 0);
if (silent.length) console.log(`SILENT (never above the noise floor): ${silent.map((r) => r.stem).join(', ')}`);
if (noNotes.length) console.log(`NO EVENTS in the sampled bar: ${noNotes.map((r) => r.stem).join(', ')}`);

/*
 * Silence is not the only way to lose a layer, and it is not the way this has
 * actually failed. The bass once sat at -44dB and the clap at -27.7dB: both
 * were technically above the noise floor and both were inaudible in practice.
 * A stem buried 30dB under the loudest is a stem nobody hears.
 *
 * But the threshold only applies to the continuous bed. fx (risers, fills,
 * impacts, the low-health heartbeat), power (only while a voiced powerup is
 * held) and motifs are event-driven: they are *supposed* to read as nothing
 * most of the time, and a 1.6s window lands between their events more often
 * than not. The first version of this check failed all three on a run where an
 * earlier pass had measured fx perfectly audible at 0.00386 — it was asserting
 * a continuous floor on layers designed to be intermittent, which is the same
 * mistake that has made several checks in this directory useless in the past.
 * Sampling luck is not a mix problem. They are reported, not asserted.
 */
const EVENT_DRIVEN = new Set(['fx', 'power', 'motifs']);
const loudest = Math.max(...rows.map((r) => r.peakSolo));
const withDb = rows.map((r) => ({ ...r, dbDown: +(20 * Math.log10(r.peakSolo / loudest)).toFixed(1) }));
const bed = withDb.filter((r) => !EVENT_DRIVEN.has(r.stem));
const buried = bed.filter((r) => r.dbDown < -30);
if (buried.length) console.log(`BURIED: ${buried.map((r) => `${r.stem} ${r.dbDown}dB`).join(', ')}`);
console.log('bed, quietest first: ' + bed.slice().sort((a, b) => a.dbDown - b.dbDown).map((r) => `${r.stem} ${r.dbDown}dB`).join(', '));
console.log('event-driven (not asserted): ' + withDb.filter((r) => EVENT_DRIVEN.has(r.stem)).map((r) => `${r.stem} ${r.dbDown}dB`).join(', '));
const ok = silent.filter((r) => !EVENT_DRIVEN.has(r.stem)).length === 0 && buried.length === 0;
console.log(ok ? 'EVERY LAYER REACHES THE SPEAKERS' : 'DEAD LAYERS IN THE MIX');
process.exit(ok ? 0 : 1);
