/** Confirms stutters actually step on the beat rather than gliding. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  const w = window.__musicwars.world;
  // Guarantee a stutter to observe.
  const e = window.__musicwars.spawnStutter?.();
  void e;
  window.__samples = [];
  setInterval(() => {
    const s = w.enemies.find((x) => x.archetype === 'stutter');
    if (s) window.__samples.push({ b: w.warpedBeatNow, x: s.x, y: s.y });
  }, 16);
});
await p.keyboard.down('KeyZ');
await p.waitForTimeout(45000);
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const s = window.__samples;
  // Speed per sample, bucketed by position within the eighth-note subdivision.
  const early = [], late = [];
  for (let i = 1; i < s.length; i++) {
    const db = s[i].b - s[i - 1].b;
    if (db <= 0 || db > 0.1) continue;
    const d = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) / db;
    if (!Number.isFinite(d)) continue;
    const frac = (s[i].b * 2) % 1;
    (frac < 0.33 ? early : late).push(d);
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return { samples: s.length, earlySpeed: Math.round(mean(early)), lateSpeed: Math.round(mean(late)) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
const ok = r.earlySpeed > r.lateSpeed * 1.8;
console.log(ok ? 'STUTTERS HOP ON THE BEAT' : 'movement still smooth');
if (!ok) process.exit(1);
