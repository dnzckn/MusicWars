import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
console.log(JSON.stringify(await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  let lastKey = '', lastMode = '', lastSection = '', keyChanges = 0, modeChanges = 0, sectionChanges = 0;
  const keys = new Set();
  const t0 = performance.now();
  while (performance.now() - t0 < 240000) {
    const rd = mw.readout();
    if (rd.key !== lastKey) { if (lastKey) keyChanges++; lastKey = rd.key; keys.add(rd.key); }
    const mode = rd.key.split(' ')[1];
    if (mode !== lastMode) { if (lastMode) modeChanges++; lastMode = mode; }
    /*
     * A one-bar fill is an ornament, not a section change. Counting it as one
     * reported a change every seven seconds, which is just the once-per-phrase
     * fill being counted twice — in and out — and made the arrangement look
     * far more restless than it is.
     */
    if (rd.section !== 'fill' && rd.section !== lastSection) { if (lastSection) sectionChanges++; lastSection = rd.section; }
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise(r => setTimeout(r, 250));
  }
  const mins = 4;
  return { distinctKeys: keys.size, keyChanges, modeChanges, sectionChanges,
    secondsPerKeyChange: Math.round((mins*60)/Math.max(1,keyChanges)),
    secondsPerSection: Math.round((mins*60)/Math.max(1,sectionChanges)) };
})));
await b.close();
