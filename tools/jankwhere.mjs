/**
 * WHERE THE LONG TASKS ARE, by CPU profile rather than by guess.
 *
 * `framewhere.mjs` wraps the functions we already suspect and attributes frame
 * time to them. On the tree this was written against that accounting came to
 * 13% of wall clock, with 17 long tasks of 73-101ms unexplained — so the
 * suspects were the wrong ones and the next step could not be another wrapper.
 *
 * This takes a real V8 CPU profile over the same window and ranks by SELF
 * time, which needs no hypothesis about what is slow.
 *
 * ON SWIFTSHADER, WHICH HAS FAKED FOUR PERFORMANCE PANICS IN THIS PROJECT:
 * rasterisation and compositing are CPU work here and a real browser does them
 * on the GPU. Those frames appear in the profile under V8's `(program)` /
 * `(garbage collector)` / blink internals, so this tool prints the rasteriser
 * and reports the JS-only ranking SEPARATELY from the total. A JavaScript
 * function high in the self-time list is real everywhere; a big `(program)`
 * share is mostly a report on the CPU rasteriser and is labelled as such.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const WAVE = Number(process.env.WAVE ?? 8);
const SECONDS = Number(process.env.SECONDS ?? 15);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

const gpu = await p.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl');
  const e = c && c.getExtension('WEBGL_debug_renderer_info');
  return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const software = /swiftshader|software|llvmpipe/i.test(gpu);
console.log(`rasteriser: ${gpu}${software ? '  (SOFTWARE — see header)' : ''}`);

await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.evaluate((wv) => { window.__musicwars.world.jumpToWave(wv); }, WAVE);
await p.waitForTimeout(2000);

// Long tasks recorded alongside the profile, so the two describe one window.
await p.evaluate(() => {
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(+e.duration.toFixed(1)); })
    .observe({ entryTypes: ['longtask'] });
});

const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); // µs
await cdp.send('Profiler.start');
await p.waitForTimeout(SECONDS * 1000);
const { profile } = await cdp.send('Profiler.stop');
const longTasks = await p.evaluate(() => window.__lt);
await b.close();

// ---- self time per node, from the sample stream -------------------------
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const total = profile.samples.length;
for (const id of profile.samples) self.set(id, (self.get(id) ?? 0) + 1);

const wall = (profile.endTime - profile.startTime) / 1000; // ms
const msPer = wall / Math.max(1, total);

const label = (n) => {
  const f = n.callFrame;
  const fn = f.functionName || '(anonymous)';
  const url = (f.url || '').replace(/^https?:\/\/[^/]+/, '');
  return url ? `${fn}  ${url}:${f.lineNumber + 1}` : fn;
};
// Classify by whether the frame HAS A URL, not by whether its name is
// parenthesised: `(anonymous)` is ordinary JavaScript with a real source
// location, and testing the leading paren hid a 2592ms superdough entry in
// this tool's first run. Only V8's synthetic frames — (program), (idle),
// (garbage collector), (root) — carry no url.
const isJs = (n) => !!n.callFrame.url;

const rows = [...self.entries()]
  .map(([id, n]) => ({ node: byId.get(id), samples: n }))
  .filter((r) => r.node)
  .sort((a, c) => c.samples - a.samples);

const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
const show = (list, n) => {
  for (const r of list.slice(0, n)) {
    console.log(`  ${pct(r.samples).padStart(6)}  ${(r.samples * msPer).toFixed(0).padStart(5)}ms  ${label(r.node)}`);
  }
};

console.log(`\nprofile: ${wall.toFixed(0)}ms wall, ${total} samples @ ${msPer.toFixed(2)}ms/sample`);
console.log(`long tasks: ${longTasks.length} over ${SECONDS}s` +
  (longTasks.length ? `  top=${longTasks.sort((a, c) => c - a).slice(0, 8).join(' ')}` : ''));

const nonJs = rows.filter((r) => !isJs(r.node));
const nonJsShare = nonJs.reduce((a, r) => a + r.samples, 0);
console.log(`\nnon-JS (rasteriser, GC, blink internals): ${pct(nonJsShare)}` +
  (software ? '  — MOSTLY SWIFTSHADER, NOT A FINDING' : ''));
show(nonJs, 5);

console.log(`\nJS self time — real on every rasteriser:`);
show(rows.filter((r) => isJs(r.node)), 25);
