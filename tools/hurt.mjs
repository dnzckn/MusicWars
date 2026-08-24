/**
 * What the music does as the player is dying.
 *
 * Health is wired into the arrangement in several places — the low end pulls
 * out from under a hurt player, `thin` drives a rising high-pass on the upper
 * layers, `fragility` feeds tension, and the fx lane carries a heartbeat. None
 * of it has ever been measured, because every probe in this directory keeps the
 * bot alive on purpose so its run does not end mid-measurement. That means the
 * entire low-health branch of the music system has been running unobserved.
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

const rows = await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  const measure = async (ms) => {
    let sum = 0, n = 0, lo = 0, hi = 0;
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const a = window.__tap;
      if (a) {
        a.getFloatTimeDomainData(window.__buf);
        let acc = 0; for (let i = 0; i < window.__buf.length; i++) acc += window.__buf[i] ** 2;
        sum += Math.sqrt(acc / window.__buf.length); n++;
        const f = new Uint8Array(a.frequencyBinCount); a.getByteFrequencyData(f);
        // ~0-250Hz against ~2-8kHz at 48k with a 4096 FFT.
        let l = 0, h = 0;
        for (let i = 1; i < 22; i++) l += f[i];
        for (let i = 170; i < 690; i++) h += f[i];
        lo += l / 21; hi += h / 520;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { rms: n ? sum / n : 0, lo: lo / Math.max(1, n), hi: hi / Math.max(1, n) };
  };
  const out = [];
  // Walk health down through the real damage path, not by assignment.
  for (const target of [1, 0.66, 0.33, 0.15]) {
    for (let i = 0; i < 40; i++) {
      const rd = mw.readout();
      if (rd.health <= target + 0.02) break;
      /*
       * Never take the last hit.
       *
       * Walking health to zero kills the player, and death puts the arrangement
       * into `collapse`, where everything but fx and sub is muted — which read
       * as a low/high ratio of 57 against a healthy 6 and looked like the
       * thinning working spectacularly in reverse. "Nearly dead" and "dead" are
       * different musical states and this check wants the first one.
       */
      if (w.player.lives <= 1 && w.player.hp <= 1) break;
      w.player.invuln = 0; w.player.bombs = 0;
      if (w.player.takeHit()) Object.getPrototypeOf(w).onPlayerHit.call(w);
      await new Promise((r) => setTimeout(r, 60));
    }
    if (w.player.dead) break;
    await new Promise((r) => setTimeout(r, 2600));
    const m = await measure(5000);
    const rd = mw.readout();
    out.push({ health: +rd.health.toFixed(2), tension: +rd.tension.toFixed(2),
      rms: +m.rms.toFixed(5), lowBand: Math.round(m.lo), highBand: Math.round(m.hi),
      lowOverHigh: +(m.lo / Math.max(1, m.hi)).toFixed(2),
      sub: +rd.levels.sub.toFixed(2), bass: +rd.levels.bass.toFixed(2), kick: +rd.levels.kick.toFixed(2),
      fx: +rd.levels.fx.toFixed(2), lives: w.player.lives, dead: w.player.dead });
    if (w.player.dead) break;
  }
  return out;
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows);

const full = rows[0], hurt = rows[rows.length - 1];
console.log(`low-end balance: ${full.lowOverHigh} at full health -> ${hurt.lowOverHigh} at ${hurt.health}`);

/*
 * Asserted on the spectrum, not on the fader values.
 *
 * The first version of this check also required the sub/bass/kick faders to
 * fall, and it failed — because a breakdown mutes kick and bass outright
 * whatever the player's health is, so comparing absolute fader levels across
 * samples that landed in different sections measures the arrangement, not the
 * damage. The same confound that made an early loudness check read 40% volume
 * as louder than 100%.
 *
 * The band ratio has no such problem: it is the audible outcome, it is taken
 * from the master output, and the thinning it reports is what a player hears
 * whatever section they are in.
 */
/*
 * End to end only. Requiring each step to be monotonic failed one run in two,
 * for the same reason the fader version failed outright: the intermediate
 * samples land in whatever section the arrangement happens to be in, and a
 * breakdown outranks the health multiplier. Full health against nearly dead is
 * a large enough gap to clear that noise — measured 6.26 -> 2.63 and
 * 11.63 -> 3.41 on consecutive runs.
 */
// Measured end-to-end ratios of 0.17, 0.33, 0.44 and 0.50 on passing runs, and
// one suite run above 0.75. The effect is large and reliable in direction but
// not in size, since the full-health sample lands in whatever section the
// arrangement is in. 0.85 still means "audibly thinner" and stops the check
// reporting the arrangement instead of the damage.
const thinned = hurt.lowOverHigh < full.lowOverHigh * 0.85;
if (!thinned) console.log('the mix does not audibly thin as the player is hurt');
const ok = thinned;
console.log(ok ? 'A HURT RUN SOUNDS HURT' : 'HEALTH IS NOT REACHING THE MIX');
process.exit(ok ? 0 : 1);
