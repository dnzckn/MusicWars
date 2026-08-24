/**
 * How often the director rebuilds its patterns, by wave.
 *
 * framecheck found the in-run median frame time doubling to 33.3ms at waves 15
 * and 23 while holding 16.7ms at waves 1 and 7 — inside a single run, so it is
 * load and not the machine. Rendering is not the cost (1.09ms/frame at wave 23),
 * so the suspect is rebuild thrash: `structureKey` changing so often at high
 * enemy counts that the director is rebuilding eight bars of eleven stems
 * continuously. That would cost frames and, since a rebuild replaces patterns
 * mid-phrase, is also the shape of the "the music got really choppy" complaint.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const rows = [];
for (const wave of [0, 7, 15, 23]) {
  await p.evaluate((wv) => {
    const d = window.__musicwars.director;
    if (wv > 0) window.__musicwars.world.jumpToWave(wv);
    window.__musicwars.world.player.lives = 4;
    if (!d.__wrapped) {
      d.__wrapped = true;
      const q = d.queueRebuild ?? Object.getPrototypeOf(d).queueRebuild;
      Object.getPrototypeOf(d).queueRebuild = function (...a) { window.__rb = (window.__rb ?? 0) + 1; return q.apply(this, a); };
      const dr = Object.getPrototypeOf(d).drainRebuild;
      Object.getPrototypeOf(d).drainRebuild = function (...a) {
        const t = performance.now(); const r = dr.apply(this, a);
        window.__rbMs = (window.__rbMs ?? 0) + (performance.now() - t); return r; };
    }
    window.__rb = 0; window.__rbMs = 0;
  }, wave);
  await p.waitForTimeout(10000);
  rows.push(await p.evaluate(() => {
    const w = window.__musicwars.world;
    return { wave: w.waveIndex + 1, enemies: w.enemies.length,
      rebuildsPer10s: window.__rb, rebuildMsPer10s: Math.round(window.__rbMs) };
  }));
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows);
// A phrase is 8 bars; at ~135bpm that is ~14s. Rebuilding more than a few times
// per phrase means the arrangement is being rewritten under itself.
const thrash = rows.filter((r) => r.rebuildsPer10s > 12);
if (thrash.length) console.log(`REBUILD THRASH at wave ${thrash.map((r) => r.wave).join(', ')}`);
console.log(thrash.length ? 'THE ARRANGEMENT IS BEING REWRITTEN CONSTANTLY' : 'REBUILDS ARE PACED');
process.exit(thrash.length ? 1 : 0);
