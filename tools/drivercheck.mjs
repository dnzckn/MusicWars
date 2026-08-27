/**
 * Confirms the readout names a real driver and that it changes with the state.
 *
 * `#ui-driver` and `#ui-reason` moved out of the sidebar and behind the gear
 * (`docs/plan-refactor-3.md` §5), and `hud.ts` does not write anything in that
 * panel while it is shut — eleven text nodes a frame for something nobody has
 * open is the one real frame saving in that rewrite. So the panel is opened
 * here before the readout is read.
 *
 * The assertion is unchanged: at least two distinct drivers must occur while
 * the player weaves, and the one the HUD names must be non-empty. What changed
 * is that the check now has to ask for the readout instead of assuming it is
 * always painted — which is a fair thing to have to do, and the alternative
 * (writing it every frame regardless) is work the player never sees.
 */
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
// Open the gear panel, or `ui-driver` and `ui-reason` are never written.
await p.evaluate(() => window.__musicwars.hud.setSettings(true));
await p.waitForTimeout(400);
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
