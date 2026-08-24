/**
 * Hunts for audio dropouts as the loadout grows.
 *
 * "Choppy" in a Web Audio app almost always means voice stealing: superdough
 * caps polyphony and fades out the oldest voices when the cap is hit, which is
 * audible as notes cutting off mid-sustain. This measures amplitude
 * discontinuities and near-silent frames while forcing more and more powerups.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await p.addInitScript(() => {
  const oc = AudioNode.prototype.connect;
  window.__tap = null;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try { if (d && d.context && d === d.context.destination) {
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 2048; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap);
    } } catch {}
    return res;
  };
});
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(10000);

const probe = async (label, kinds) => {
  if (kinds) await p.evaluate((ks) => {
    const w = window.__musicwars.world;
    for (const k of ks) { w.player.addPowerup(k, 600); w.bus.emit('powerup:pickup', { kind: k, level: 1 }); }
  }, kinds);
  await p.waitForTimeout(3500);
  const r = await p.evaluate(async () => {
    let prev = 0, jumps = 0, quiet = 0, n = 0, sum = 0, worstDrop = 0;
    const end = performance.now() + 7000;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) {
        a.getFloatTimeDomainData(window.__buf);
        let acc = 0;
        for (let i = 0; i < window.__buf.length; i++) acc += window.__buf[i] * window.__buf[i];
        const rms = Math.sqrt(acc / window.__buf.length);
        // A sudden collapse to a fraction of the previous frame is what a
        // stolen voice sounds like.
        if (prev > 0.004 && rms < prev * 0.34) { jumps++; worstDrop = Math.max(worstDrop, prev / Math.max(rms, 1e-6)); }
        if (rms < 0.0015) quiet++;
        prev = rms; sum += rms; n++;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    const L = window.__musicwars.loop;
    return { jumps, quietPct: +((quiet / n) * 100).toFixed(1), rms: +(sum / n).toFixed(4),
      fps: Math.round(L.fps), upd: +L.updateMs.toFixed(1), ren: +L.renderMs.toFixed(1),
      reb: +window.__musicwars.director.lastRebuildMs.toFixed(1) };
  });
  const load = await p.evaluate(() => Object.keys(window.__musicwars.world.snapshot.powerups).length);
  console.log(`${label.padEnd(30)} pu=${load} fps=${String(r.fps).padStart(3)}  update=${String(r.upd).padStart(5)}ms  render=${String(r.ren).padStart(5)}ms  rebuild=${r.reb}ms  dropouts=${r.jumps}`);
  return r;
};

const a = await probe('baseline (no powerups)', null);
const c = await probe('+ drones, nova', ['drones', 'nova']);
const d = await probe('+ magnet, laser, homing', ['magnet', 'laser', 'homing']);
const e = await probe('+ blackhole, bomb, spread', ['blackhole', 'bomb', 'spread']);
const f = await probe('+ overdrive, rapid', ['overdrive', 'rapid']);

await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('\nerrors:', errs.length ? errs.slice(0, 3) : 'none');
const worst = Math.max(a.jumps, c.jumps, d.jumps, e.jumps, f.jumps);
console.log(worst > a.jumps * 2 + 4 ? `\n>>> DROPOUTS SCALE WITH LOADOUT (${a.jumps} -> ${worst}) <<<` : '\nno loadout-dependent dropout trend');
