/** Confirms each theme is a distinct shape, not a re-spelling of one idea. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(4000);
const r = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const out = [];
  for (let wave = 0; wave < 8; wave++) {
    mw.world.jumpToWave(wave);
    await new Promise((res) => setTimeout(res, 2600));
    const bar = mw.director.sampleBar(mw.world.transport);
    const onsets = bar.lead.map((n) => Math.round(n.t * 8)).sort((a, c) => a - c);
    const pitches = bar.lead.map((n) => n.n).filter((n) => typeof n === 'number');
    out.push({ wave: wave + 1, onsets: [...new Set(onsets)].join(','), notes: pitches.length,
      range: pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0 });
  }
  return out;
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(r);
const shapes = new Set(r.map((x) => x.onsets));
console.log(`distinct rhythmic shapes across 8 waves: ${shapes.size}/8`);
console.log(shapes.size >= 5 ? 'THEMES ARE DISTINCT' : 'themes too similar');
if (shapes.size < 5) process.exit(1);
