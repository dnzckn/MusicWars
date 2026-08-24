/**
 * Which game-state signals never actually vary, and which never reach the
 * values the code tests against.
 *
 * Three consecutive iterations found the same shape of defect by accident:
 * tension capped at half its range so every consumer read only the bottom half;
 * the arp's `full` point set at an energy the game never produces; and
 * `playerFiring`, which reads true 100% of the time, used as the trigger for a
 * "dynamic" duck. Each was a condition or range that looked responsive in the
 * source and was a constant in play. This looks for the rest of them on
 * purpose instead of stumbling over them one per iteration.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const MINUTES = Number(process.env.MINUTES ?? 4);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');

const r = await p.evaluate(async (mins) => {
  const mw = window.__musicwars;
  const bools = {}, nums = {};
  const end = performance.now() + mins * 60000;
  let n = 0;
  while (performance.now() < end) {
    const s = mw.world.snapshot;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'boolean') {
        const a = (bools[k] ??= { t: 0 });
        if (v) a.t++;
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        const a = (nums[k] ??= { min: Infinity, max: -Infinity, sum: 0 });
        a.min = Math.min(a.min, v); a.max = Math.max(a.max, v); a.sum += v;
      }
    }
    mw.world.player.lives = Math.max(3, mw.world.player.lives);
    n++;
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    samples: n,
    bools: Object.fromEntries(Object.entries(bools).map(([k, a]) => [k, Math.round((a.t / n) * 100)])),
    nums: Object.fromEntries(Object.entries(nums).map(([k, a]) => [k, { min: +a.min.toFixed(2), max: +a.max.toFixed(2), mean: +(a.sum / n).toFixed(2) }])),
  };
}, MINUTES);
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

const constants = Object.entries(r.bools).filter(([, pct]) => pct >= 99 || pct <= 1);
const varying = Object.entries(r.bools).filter(([, pct]) => pct > 1 && pct < 99);
console.log(`samples: ${r.samples}`);
console.log('\nbooleans that never vary:');
for (const [k, pct] of constants) console.log(`  ${k.padEnd(16)} ${pct === 100 || pct >= 99 ? 'always true' : 'never true'}`);
console.log('\nbooleans that vary:');
for (const [k, pct] of varying.sort((a, c) => c[1] - a[1])) console.log(`  ${k.padEnd(16)} ${pct}%`);
console.log('\nnumeric ranges:');
for (const [k, a] of Object.entries(r.nums).sort()) console.log(`  ${k.padEnd(18)} min ${String(a.min).padStart(7)}  mean ${String(a.mean).padStart(7)}  max ${String(a.max).padStart(7)}`);

/*
 * A constant boolean is not automatically a bug — `gameOver` should be false
 * for a whole run. It is a bug when something branches on it expecting
 * variation, which is a judgement call, so this reports rather than fails.
 */
console.log('\n(reported, not asserted: a constant boolean is only a defect if something branches on it)');
