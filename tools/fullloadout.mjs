/**
 * What a full loadout does to the mix.
 *
 * Beating bosses now widens the loadout to five slots. Only three powerups have
 * their own voice in the `power` stem; the other nine *modify* existing layers —
 * rapid doubles the hat subdivision, spread widens the supersaws, drones splits
 * the arp into panned satellites, homing grows a delay tail on it, laser makes
 * the lead hold instead of stab. Five of those at once is a lot of simultaneous
 * modification, and "as i got more powerup the music got really choppy as in
 * SHITTY" is a complaint this game has already had once.
 *
 * Interleaved, because the arrangement's own loudness swings by more between
 * sections than a loadout is likely to.
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
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 4096; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap); } } catch {}
    return res; };
});
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(12000);

const out = await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  const measure = async (ms) => {
    let sum = 0, n = 0, peak = 0, harsh = 0, total = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) {
        a.getFloatTimeDomainData(window.__buf);
        let acc = 0;
        for (let i = 0; i < window.__buf.length; i++) { const v = window.__buf[i]; acc += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
        sum += Math.sqrt(acc / window.__buf.length); n++;
        const f = new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(f);
        // ~2-6kHz is where harshness lives at 48k with a 4096 FFT.
        for (let i = 0; i < f.length; i++) { total += f[i]; if (i >= 170 && i < 512) harsh += f[i]; }
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    const rms = n ? sum / n : 0;
    return { rms, crestDb: 20 * Math.log10(peak / Math.max(1e-6, rms)), harshPct: (harsh / Math.max(1, total)) * 100 };
  };
  const setLoadout = (kinds) => {
    w.player.powerups = {}; w.player.powerTimers = {}; w.player.held = [];
    w.player.maxActive = 5;
    for (const k of kinds) w.player.addPowerup(k, 90);
  };
  const empty = [], full = [];
  for (let i = 0; i < 3; i++) {
    setLoadout([]);
    await new Promise((r) => setTimeout(r, 2200));
    empty.push(await measure(4200));
    setLoadout(['rapid', 'spread', 'drones', 'homing', 'laser']);
    await new Promise((r) => setTimeout(r, 2200));
    full.push(await measure(4200));
  }
  setLoadout([]);
  const mean = (a, k) => a.reduce((x, y) => x + y[k], 0) / a.length;
  return {
    empty: { rms: +mean(empty, 'rms').toFixed(5), crestDb: +mean(empty, 'crestDb').toFixed(1), harshPct: +mean(empty, 'harshPct').toFixed(1) },
    full: { rms: +mean(full, 'rms').toFixed(5), crestDb: +mean(full, 'crestDb').toFixed(1), harshPct: +mean(full, 'harshPct').toFixed(1) },
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table([{ loadout: 'empty', ...out.empty }, { loadout: 'five', ...out.full }]);
const louder = out.full.rms / Math.max(1e-9, out.empty.rms);
const harshDelta = out.full.harshPct - out.empty.harshPct;
console.log(`five powerups: ${louder.toFixed(2)}x louder, harsh band ${harshDelta >= 0 ? '+' : ''}${harshDelta.toFixed(1)} points, crest ${out.full.crestDb}dB vs ${out.empty.crestDb}dB`);
const problems = [];
if (louder > 1.8) problems.push(`a full loadout is ${louder.toFixed(1)}x louder`);
if (harshDelta > 6) problems.push(`a full loadout adds ${harshDelta.toFixed(1)} points of harshness`);
if (out.full.crestDb < out.empty.crestDb - 5) problems.push('a full loadout flattens the dynamics');
for (const x of problems) console.log('LOADOUT MIX:', x);
console.log(problems.length ? 'A FULL LOADOUT MUDDIES THE MIX' : 'A FULL LOADOUT STILL SOUNDS LIKE MUSIC');
process.exit(problems.length ? 1 : 0);
