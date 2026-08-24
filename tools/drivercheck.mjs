/** Confirms the panel names a real driver and that it changes with the state. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  window.__drivers = {};
  setInterval(() => {
    const d = window.__musicwars.readout().driver;
    window.__drivers[d] = (window.__drivers[d] ?? 0) + 1;
  }, 120);
});
await p.keyboard.down('KeyZ');
let dir = 'ArrowLeft';
for (let i = 0; i < 130; i++) {
  await p.keyboard.down(dir); await p.waitForTimeout(300); await p.keyboard.up(dir);
  dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
}
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const d = window.__drivers;
  const total = Object.values(d).reduce((a, c) => a + c, 0);
  const rows = Object.entries(d).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`);
  return { distinct: Object.keys(d).length, rows, reason: document.getElementById('ui-reason').textContent,
           shown: document.getElementById('ui-driver').textContent };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('drivers seen:', r.rows.join('  '));
console.log('panel shows :', JSON.stringify(r.shown), ' harmony reason:', JSON.stringify(r.reason));
console.log(r.distinct >= 2 && r.shown.length > 0 ? 'DRIVER READOUT IS LIVE AND VARIES' : 'driver readout static');
if (r.distinct < 2 || !r.shown) process.exit(1);
