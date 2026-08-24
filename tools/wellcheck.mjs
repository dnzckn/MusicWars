/** Confirms black holes are held and deployed rather than spent on pickup. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(4000);
const r = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  w.drops.push({ x: w.player.x, y: w.player.y - 30, vx: 0, vy: 0, kind: 'blackhole', age: 1, alive: true });
  await new Promise((r) => setTimeout(r, 900));
  const afterPickup = { charges: w.player.wells, deployed: w.wells.length };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
  await new Promise((r) => setTimeout(r, 400));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyC' }));
  await new Promise((r) => setTimeout(r, 600));
  const afterDeploy = { charges: w.player.wells, deployed: w.wells.length, banner: w.banner };
  return { afterPickup, afterDeploy };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('after pickup:', JSON.stringify(r.afterPickup));
console.log('after C     :', JSON.stringify(r.afterDeploy));
const ok = r.afterPickup.charges === 1 && r.afterPickup.deployed === 0
        && r.afterDeploy.charges === 0 && r.afterDeploy.deployed === 1;
console.log(ok ? 'BLACK HOLE IS A DECISION NOW' : 'deploy path broken');
if (!ok) process.exit(1);
