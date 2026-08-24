/** Confirms enemy groups now arrive on bar lines rather than drifting off-grid. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  const mw = window.__musicwars;
  window.__spawns = [];
  const seen = new Set();
  mw.world.bus.on('enemy:spawn', () => {
    // Group spawns fire many events in one frame; record the beat once.
    const beat = mw.world.transport.beat;
    const key = beat.toFixed(2);
    if (seen.has(key)) return;
    seen.add(key);
    window.__spawns.push(beat);
  });
});
await p.keyboard.down('KeyZ');
await p.waitForTimeout(70000);
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const s = window.__spawns;
  // Distance from the nearest bar line, in beats (a bar is 4 beats).
  const off = s.map((b) => { const f = b % 4; return Math.min(f, 4 - f); });
  const mean = off.reduce((a, c) => a + c, 0) / Math.max(1, off.length);
  const onGrid = off.filter((o) => o < 0.35).length;
  return { groups: s.length, meanOffBeats: +mean.toFixed(3), onGridPct: Math.round((onGrid / Math.max(1, off.length)) * 100) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
const ok = r.onGridPct >= 70;
console.log(ok ? 'SPAWNS ARE ON THE MUSICAL GRID' : 'spawns still drifting');
if (!ok) process.exit(1);
