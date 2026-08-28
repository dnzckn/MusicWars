/** SFX trigger rate by category at a busy wave. */
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
for (const wave of [4, 12, 22]) {
  console.log(JSON.stringify(await p.evaluate(async (wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv); w.player.lives = 4;
    await new Promise((r) => setTimeout(r, 2500));
    const c = {};
    const names = ['enemy:hit','enemy:death','enemy:lunge','enemy:spawn','player:hit','graze','powerup:pickup'];
    const offs = names.map((n) => { c[n] = 0; const h = () => c[n]++; w.bus.on(n, h); return [n, h]; });
    const secs = 8;
    await new Promise((r) => setTimeout(r, secs * 1000));
    const out = { wave: w.waveIndex + 1, enemies: w.enemies.length };
    for (const n of names) out[n.replace(':', '_') + '_perSec'] = +(c[n] / secs).toFixed(1);
    return out;
  }, wave)));
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
