/**
 * How often the notes of the eight-bar phrase are replaced under the listener,
 * and how much of the phrase survives when they are.
 *
 * `rebuildrate` counts calls to `queueRebuild`. That is not the same question:
 * a rebuild that produces byte-identical patterns is inaudible, and one that
 * rewrites the melody is not, so a rebuild count cannot distinguish the two.
 * This queries each stem's cached pattern over all eight bars and hashes only
 * the *structural* fields — onset, duration, note, sound. Everything driven by
 * a `signal` (filter, drive, gain, postgain) is deliberately excluded, because
 * those move continuously by design and are not what "the music changed" means.
 *
 * CONTROL, printed every run: each stem is hashed TWICE in the same tick. Those
 * two hashes must be identical for every stem on every sample. If they are not,
 * a continuously-varying control has leaked into the hash and every churn
 * number below is really measuring the filter sweep.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import { retryOnReload, watchReloads } from './lib/reload.mjs';

const HOLD = Number(process.env.HOLD ?? 20000);
const WAVES = (process.env.WAVES ?? '0,8,16,24').split(',').map(Number);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const reloads = watchReloads(p);
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });

// The page can be reloaded out from under a run by any edit under src/, and
// these helpers live on `window`, so they are part of the bootstrap rather than
// a one-off. See tools/lib/reload.mjs.
const bootstrap = async () => {
  await p.waitForSelector('#start-button', { timeout: 15000 });
  await p.click('#start-button');
  await p.waitForTimeout(2500);
  await installDriver(p, 'dodge');
  await p.evaluate(() => {
  const d = window.__musicwars.director;
  window.__snapHaps = (pat) => {
    const out = [];
    for (let c = 0; c < 8; c++) {
      let haps = [];
      try { haps = pat.queryArc(c, c + 1, { _cps: 0.55 }); } catch { return '<throw>'; }
      for (const h of haps) {
        if (!h.hasOnset?.()) continue;
        const v = h.value ?? {};
        // Structure only. Anything a signal writes is excluded on purpose.
        out.push(`${(+h.whole.begin).toFixed(4)}:${(+h.whole.end).toFixed(4)}:${v.note ?? ''}:${v.n ?? ''}:${v.s ?? ''}`);
      }
    }
    return out;
  };
  window.__sampleStems = () => {
    const res = {};
    for (const id of Object.keys(d.cache)) {
      const a = window.__snapHaps(d.cache[id]);
      const b = window.__snapHaps(d.cache[id]);
      res[id] = { haps: a, stable: JSON.stringify(a) === JSON.stringify(b), level: +d.readout(window.__musicwars.world.transport).levels[id].toFixed(2) };
    }
    return res;
  };
  });
};
await bootstrap();

/*
 * A layer entering or leaving is not churn.
 *
 * Going from silence to eight bars of music scores 0% overlap and drags the
 * median down, but it is the arrangement doing its job rather than the material
 * being replaced under the listener. Those transitions are counted separately
 * and reported as `!n`; `null` here keeps them out of the retention figure.
 */
const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return null;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

console.log('churn = how many times in 10s a stem\'s eight bars of notes were replaced');
console.log('kept  = median fraction of the phrase that survived such a replacement');
console.log('!n    = n of those were the layer going to or coming back from silence, not new notes\n');
let controlFailures = 0;
for (const wave of WAVES) {
 const { changes, kept, secs, st, prev, blanked } = await retryOnReload(p, reloads, bootstrap, async () => {
  await p.evaluate((wv) => {
    const w = window.__musicwars.world;
    if (wv > 0) w.jumpToWave(wv);
    w.player.lives = 4;
  }, wave);
  await p.waitForTimeout(1200);

  let prev = null;
  const changes = {}, kept = {}, blanked = {};
  const t0 = Date.now();
  while (Date.now() - t0 < HOLD) {
    const cur = await p.evaluate(() => window.__sampleStems());
    for (const id of Object.keys(cur)) {
      if (!cur[id].stable) controlFailures++;
      if (prev && prev[id]) {
        const a = prev[id].haps, c = cur[id].haps;
        if (JSON.stringify(a) !== JSON.stringify(c)) {
          changes[id] = (changes[id] ?? 0) + 1;
          const j = jaccard(a, c);
          if (j !== null) (kept[id] ??= []).push(j);
          /*
           * A stem whose cache is swapped for `silence` and back scores 0%
           * survival, which looks identical to "the notes were all replaced"
           * and is a completely different defect: the layer disappeared. Count
           * them separately or the two are indistinguishable in the table.
           */
          if (a.length === 0 || c.length === 0) blanked[id] = (blanked[id] ?? 0) + 1;
        }
      }
    }
    // Keep the run alive: a death drops the arrangement into `collapse`, where
    // every stem is silence and the churn reads as zero.
    await p.evaluate(() => { const w = window.__musicwars.world; w.player.lives = 4; w.player.hp = w.player.maxHp; });
    prev = cur;
    await p.waitForTimeout(400);
  }
  const secs = (Date.now() - t0) / 1000;
  const st = await p.evaluate(() => ({ wave: window.__musicwars.world.waveIndex + 1, sec: window.__musicwars.readout().section }));
  return { changes, kept, secs, st, prev, blanked };
 });
  const line = Object.keys(prev)
    .map((id) => {
      const n = ((changes[id] ?? 0) / secs) * 10;
      const k = kept[id]?.length ? kept[id].slice().sort((x, y) => x - y)[Math.floor(kept[id].length / 2)] : null;
      const bl = blanked[id] ? `!${blanked[id]}` : '';
      return `${id} ${n.toFixed(1)}${k === null ? '' : `/${(k * 100).toFixed(0)}%`}${bl}`;
    })
    .join('  ');
  const total = Object.values(changes).reduce((a, c) => a + c, 0) / secs * 10;
  console.log(`wave ${String(st.wave).padStart(2)} ${st.sec.padEnd(9)} total churn ${total.toFixed(1)}/10s`);
  console.log(`   ${line}\n`);
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

console.log(controlFailures === 0
  ? 'CONTROL PASSED: no stem hashed differently twice in the same tick, so the hash contains no signal-driven values.'
  : `CONTROL FAILED: ${controlFailures} unstable hashes — a continuous control leaked into the hash. Ignore every number above.`);
if (errs.length) console.log('page errors:', errs.slice(0, 3));
process.exit(controlFailures === 0 ? 0 : 2);
