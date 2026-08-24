/** Does the cosmetic physics survive a long interruption? */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(9000);
await p.keyboard.up('KeyZ');

const probe = () => p.evaluate(() => {
  const r = window.__musicwars.renderer;
  const g = r.grid ?? r['grid'];
  const out = { maxOffset: 0, maxVel: 0, nonFinite: 0 };
  if (g) {
    for (let i = 0; i < g.x.length; i++) {
      const dx = g.x[i] - g.homeX[i], dy = g.y[i] - g.homeY[i];
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(g.vx[i])) out.nonFinite++;
      out.maxOffset = Math.max(out.maxOffset, Math.hypot(dx, dy) || 0);
      out.maxVel = Math.max(out.maxVel, Math.hypot(g.vx[i], g.vy[i]) || 0);
    }
  }
  const pt = window.__musicwars.world.particles;
  for (let i = 0; i < pt.count; i++) {
    if (!Number.isFinite(pt.x[i]) || !Number.isFinite(pt.y[i])) out.nonFinite++;
  }
  return { ...out, particles: pt.count, gridFound: !!g };
});

const before = await probe();
// Freeze the tab hard: block the main thread so rAF stalls, as a backgrounded
// tab or a stalled phone would.
await p.evaluate(() => { const end = Date.now() + 2600; while (Date.now() < end); });
const first = await probe();
await p.waitForTimeout(600);
const settled = await probe();
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('before stall :', JSON.stringify(before));
console.log('first frames :', JSON.stringify(first));
console.log('settled      :', JSON.stringify(settled));
const ok = first.nonFinite === 0 && settled.nonFinite === 0 && first.maxOffset < 200 && first.maxVel < 20000;
console.log(ok ? 'PHYSICS SURVIVES A STALL' : 'physics blew up');
if (!ok) process.exit(1);
