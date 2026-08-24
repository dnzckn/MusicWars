/** Confirms boss phase changes land on bar lines, not on whichever bullet hit. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  const mw = window.__musicwars;
  window.__phases = [];
  mw.world.bus.on('boss:phase', () => window.__phases.push(mw.world.transport.bar));
});
// Force bosses repeatedly rather than waiting for wave 4 three times over.
for (let round = 0; round < 4; round++) {
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.enemies.length = 0;
    w['entryCursor'] = 99;
    w['phase'] = 'awaiting-boss';
    w['phaseTimer'] = 0.05;
  });
  await p.waitForTimeout(1500);
  // Chip the boss down so it crosses both thresholds.
  for (let i = 0; i < 24; i++) {
    await p.evaluate(() => {
      const boss = window.__musicwars.world.enemies.find((e) => e.archetype === 'conductor');
      if (boss && boss.invuln <= 0) boss.hp -= boss.maxHp * 0.06;
    });
    await p.waitForTimeout(320);
  }
}
const r = await p.evaluate(() => {
  const ph = window.__phases;
  // Distance from the nearest bar line, in bars.
  const off = ph.map((b) => { const f = b % 1; return Math.min(f, 1 - f); });
  const onBar = off.filter((o) => o < 0.08).length;
  return { transitions: ph.length, onBarPct: Math.round((onBar / Math.max(1, off.length)) * 100),
           meanOffBars: +(off.reduce((a, c) => a + c, 0) / Math.max(1, off.length)).toFixed(3) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r));
const ok = r.transitions > 2 && r.onBarPct >= 80;
console.log(ok ? 'BOSS PHASES LAND ON THE DOWNBEAT' : 'phases still off-grid');
if (!ok) process.exit(1);
