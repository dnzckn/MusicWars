/**
 * Detects rebuild thrash: the structure key alternating A-B-A-B.
 *
 * The key buckets continuous values with plain rounding, so anything resting on
 * a bucket edge would rebuild every bar, flipping between two neighbouring
 * keys. Cheaper than an octave flip but not free — each rebuild is ~8ms of
 * pattern construction spread across frames.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(45000);
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const h = window.__musicwars.director.keyHistory.slice();
  let alternations = 0;
  for (let i = 2; i < h.length; i++) if (h[i] === h[i - 2] && h[i] !== h[i - 1]) alternations++;
  // Which field differs between consecutive keys?
  const fields = ['section','intensity','brightness','mode','tonic','wave','boss','build','intro','health','graze','bombs','register','pu','en'];
  const churn = {};
  for (let i = 1; i < h.length; i++) {
    const a = h[i - 1].split('|'), c = h[i].split('|');
    for (let f = 0; f < Math.min(a.length, c.length); f++) {
      if (a[f] !== c[f]) churn[fields[f] ?? `f${f}`] = (churn[fields[f] ?? `f${f}`] ?? 0) + 1;
    }
  }
  return { rebuilds: window.__musicwars.director.rebuildCount, sampled: h.length, alternations,
    churn: Object.entries(churn).sort((x, y) => y[1] - x[1]) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`rebuilds in 45s: ${r.rebuilds}   A-B-A-B alternations in last ${r.sampled}: ${r.alternations}`);
console.log('what changes between consecutive keys:');
for (const [k, n] of r.churn) console.log(`  ${k.padEnd(12)} ${n}`);
