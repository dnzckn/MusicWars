/** Attributes long frames to renderer / director / hud / audio scheduler. */
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
await p.evaluate((wv) => { window.__musicwars.world.jumpToWave(wv); }, Number(process.env.WAVE ?? 8));
await p.waitForTimeout(2000);

console.log(JSON.stringify(await p.evaluate(async () => {
  const mw = window.__musicwars;
  const acc = {};
  const wrap = (obj, name, key) => {
    const orig = obj[name].bind(obj);
    acc[key] = { total: 0, n: 0, max: 0 };
    obj[name] = (...a) => { const t = performance.now(); const r = orig(...a); const d = performance.now() - t;
      const s = acc[key]; s.total += d; s.n++; if (d > s.max) s.max = d; return r; };
  };
  wrap(mw.renderer, 'render', 'renderer.render');
  wrap(mw.director, 'update', 'director.update');
  wrap(mw.director, 'readout', 'director.readout');
  wrap(mw.director, 'sampleBar', 'director.sampleBar');
  wrap(mw.director, 'sourceLines', 'director.sourceLines');
  wrap(mw.world, 'update', 'world.update');
  if (mw.hud) wrap(mw.hud, 'update', 'hud.update');

  // Anything on the main thread we did not wrap shows up here.
  const longTasks = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(+e.duration.toFixed(1)); })
    .observe({ entryTypes: ['longtask'] });

  await new Promise((r) => setTimeout(r, 15000));
  const out = {};
  for (const [k, v] of Object.entries(acc)) out[k] = { calls: v.n, msPerCall: +(v.total / Math.max(1, v.n)).toFixed(2), maxMs: +v.max.toFixed(1), totalMs: +v.total.toFixed(0) };
  longTasks.sort((a, c) => c - a);
  return { perFrame: out, longTaskCount: longTasks.length, longTasksTop: longTasks.slice(0, 8) };
}), null, 1));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
