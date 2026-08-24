/** Which component of the director's rebuild key actually changes, and how often. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
/*
 * These names are positional and MUST track `structureKey`'s array exactly.
 * `combo` was missing, so every field after index 12 was reported under its
 * neighbour's name and the enemy counts were being read as powerups.
 */
const FIELDS = ['section','intensity','brightness','mode','tonic','wave','boss','buildBucket','intro','health','grazing','bombs','leadReg','combo','powerups','enemies','tension'];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
for (const wave of [0, 8, 16, 24]) {
  const r = await p.evaluate(async ({ wv, FIELDS }) => {
    const d = window.__musicwars.director;
    window.__musicwars.world.jumpToWave(wv);
    window.__musicwars.world.player.lives = 4;
    await new Promise((r) => setTimeout(r, 1500));
    const counts = {}; for (const f of FIELDS) counts[f] = 0;
    let prev = null, rebuilds = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      const k = d.debugStructureKey ? d.debugStructureKey() : null;
      if (k) {
        const parts = k.split('|');
        if (prev && k !== prev.join('|')) {
          rebuilds++;
          parts.forEach((v, i) => { if (v !== prev[i]) counts[FIELDS[i] ?? `f${i}`]++; });
        }
        prev = parts;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return { rebuilds, counts };
  }, { wv: wave, FIELDS });
  const top = Object.entries(r.counts).filter(([, v]) => v > 0).sort((a, c) => c[1] - a[1]);
  console.log(`wave ${wave + 1}: ${r.rebuilds} accepted rebuilds in 12s ->`, top.map(([k, v]) => `${k}:${v}`).join(' '));
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
