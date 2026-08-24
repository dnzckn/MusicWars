/** Confirms the heartbeat tracks bombs and yields when the music gets busy. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(5000);
const r = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const read = () => {
    const bar = mw.director.sampleBar(mw.world.transport);
    return { power: +mw.readout().levels.power.toFixed(2), notes: bar.power.length };
  };
  const withBombs = [];
  const without = [];
  for (let i = 0; i < 14; i++) {
    mw.world.player.bombs = i % 2 === 0 ? 3 : 0;
    await new Promise((r) => setTimeout(r, 1400));
    (i % 2 === 0 ? withBombs : without).push(read());
  }
  mw.world.player.bombs = 3;
  const mean = (a, k) => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : 0);
  return {
    bombsLevel: +mean(withBombs, 'power').toFixed(2), bombsNotes: +mean(withBombs, 'notes').toFixed(1),
    noneLevel: +mean(without, 'power').toFixed(2), noneNotes: +mean(without, 'notes').toFixed(1),
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
const ok = r.bombsLevel > r.noneLevel + 0.2;
console.log(ok ? 'THE HEARTBEAT TRACKS YOUR RESERVES' : 'power stem not responding to bombs');
if (!ok) process.exit(1);
