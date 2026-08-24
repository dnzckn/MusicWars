/**
 * A rebuild that changes nothing must change nothing.
 *
 * The director rewrites all eight bars of all eleven stems whenever its
 * `structureKey` changes, and that key is deliberately coarse — its own comment
 * says "the difference between intensity 0.61 and 0.64 does not change a single
 * note of the patterns these values select". That claim had never been tested,
 * and it was false: the key was coarse but the builders were handed the raw
 * values, which they threshold in nine places. So a rebuild triggered by an
 * enemy dying could and did rewrite the melody.
 *
 * `tools/phrasechurn.mjs` measures the same thing during live play, and cannot
 * settle it: total churn at wave 17 read 11.5 and then 27.5 on two runs of an
 * unchanged build, because what the game is doing dominates. This tool removes
 * the game from the experiment. Everything runs INSIDE ONE SYNCHRONOUS TICK, so
 * no frame passes and nothing varies except the one value being tested. There
 * is no drift to control for, because nothing is allowed to drift.
 *
 * The question it asks: HOW MANY DIFFERENT SETS OF NOTES CAN ONE REBUILD KEY
 * PRODUCE? The answer has to be one. The key is what the director uses to
 * decide whether anything has changed, so two rebuilds that compute the same
 * key and produce different music mean the key is not describing the music.
 *
 * `intensity` is swept across its whole range in small steps, up and then back
 * down (the buckets are sticky, so direction matters). At every step the real
 * `structureKey` runs, a full rebuild is forced, and the notes are hashed.
 * Group the hashes by the key that produced them: any key with more than one
 * distinct note-set is a rebuild that rewrote the music for a reason the
 * director does not believe is a change.
 *
 * Two earlier designs were weaker and are worth recording:
 *
 *  1. Rebuilding twice with every input held still. It passed on the broken
 *     build, because holding every input still cannot detect over-sensitivity
 *     to inputs. It does still catch path-dependent state — the chord voicing
 *     was carried from the previous *rebuild* rather than the previous phrase —
 *     so it is kept as the first of the two checks.
 *  2. Nudging intensity by a fixed 0.02 and requiring nothing to change. The
 *     nudge sometimes straddled a bucket edge, which is a real change, so both
 *     the broken and the fixed build scored a few hits and the comparison was
 *     luck. Grouping by the key removes the confound entirely: a step that
 *     moves the key is simply a different group.
 *
 * THE CONTROL is that the sweep must produce SEVERAL distinct keys and several
 * distinct note-sets overall. A director that had stopped rebuilding, or a
 * comparison that always answers "same", would otherwise score perfectly.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import { retryOnReload, watchReloads } from './lib/reload.mjs';

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
const bootstrap = async () => {
  await p.waitForSelector('#start-button', { timeout: 15000 });
  await p.click('#start-button');
  await p.waitForTimeout(2500);
  await installDriver(p, 'dodge');
};
await bootstrap();

const probe = async (wave) =>
  retryOnReload(p, reloads, bootstrap, async () => {
    await p.evaluate((wv) => {
      const w = window.__musicwars.world;
      if (wv > 0) w.jumpToWave(wv);
      w.player.lives = 4;
    }, wave);
    /*
     * Settle long enough to be OUT of the intro.
     *
     * A wave jump restarts the arrangement, and during the intro most stems are
     * still gated to silence — so the control moved only 2 of 11 stems and the
     * tool declared itself blind. It was not blind; there was nothing there to
     * move yet. Twelve seconds is past the eight-bar opening at every tempo the
     * director uses.
     */
    await p.waitForTimeout(12000);
    return p.evaluate(() => {
      const mw = window.__musicwars;
      const d = mw.director;
      const t = mw.world.transport;
      const section = mw.readout().section;

      /*
       * Structure only. Everything a `signal` writes — filter, drive, gain,
       * postgain — moves continuously by design and is not what "the notes
       * changed" means.
       */
      const hash = (pat) => {
        const out = [];
        for (let c = 0; c < 8; c++) {
          let haps = [];
          try { haps = pat.queryArc(c, c + 1, { _cps: 0.55 }); } catch { return '<throw>'; }
          for (const h of haps) {
            if (!h.hasOnset?.()) continue;
            const v = h.value ?? {};
            out.push(`${(+h.whole.begin).toFixed(4)}:${(+h.whole.end).toFixed(4)}:${v.note ?? ''}:${v.n ?? ''}:${v.s ?? ''}`);
          }
        }
        return out.join(',');
      };
      const snapAll = () => Object.fromEntries(Object.keys(d.cache).map((id) => [id, hash(d.cache[id])]));

      // Force a complete rebuild and drain it to completion, all without
      // yielding: `drainRebuild` normally does two stems per frame.
      const force = () => {
        d.queueRebuild(t, section);
        for (let guard = 0; guard < 200 && d.pendingQueue.length; guard++) d.drainRebuild();
        return snapAll();
      };

      /*
       * Go through the real key path. Writing `d.intensity` alone would not
       * update the sticky buckets, and the fixed build reads the bucket — so
       * skipping `structureKey` would make it pass for the wrong reason.
       */
      const rebuildAt = (intensity) => {
        d.intensity = intensity;
        const key = d.structureKey(d.snapshot, section, 0);
        return { key, snap: force() };
      };

      const i0 = d.intensity;

      // First: two rebuilds with nothing touched at all. Catches state carried
      // from one rebuild to the next.
      const a = rebuildAt(i0).snap;
      const b = rebuildAt(i0).snap;
      const ids = Object.keys(a);
      const identical = ids.filter((id) => a[id] !== b[id]);

      // Then the sweep, up and back down because the buckets are sticky.
      const steps = [];
      for (let v = 0; v <= 1.0001; v += 0.025) steps.push(Math.min(1, v));
      for (let v = 1; v >= -0.0001; v -= 0.025) steps.push(Math.max(0, v));

      /** key -> stem -> Set of distinct note-hashes seen under that key */
      const groups = new Map();
      const keysSeen = new Set();
      const setsSeen = new Set();
      for (const v of steps) {
        const { key, snap } = rebuildAt(v);
        keysSeen.add(key);
        setsSeen.add(ids.map((id) => snap[id]).join('\u0001'));
        let g = groups.get(key);
        if (!g) { g = {}; for (const id of ids) g[id] = new Set(); groups.set(key, g); }
        for (const id of ids) g[id].add(snap[id]);
      }

      // Per stem, the worst number of distinct note-sets any single key produced.
      const ambiguous = {};
      for (const g of groups.values()) {
        for (const id of ids) ambiguous[id] = Math.max(ambiguous[id] ?? 1, g[id].size);
      }
      const offenders = ids.filter((id) => ambiguous[id] > 1);
      const worstFanout = Math.max(...ids.map((id) => ambiguous[id]));

      d.intensity = i0;
      d.structureKey(d.snapshot, section, 0);
      force();

      return {
        wave: mw.world.waveIndex + 1,
        section,
        stems: ids.length,
        identical,
        offenders,
        worstFanout,
        keys: keysSeen.size,
        sets: setsSeen.size,
        steps: steps.length,
      };
    });
  });

const rows = [];
for (const wave of WAVES) {
  const r = await probe(wave);
  rows.push(r);
  console.log(
    `wave ${String(r.wave).padStart(2)} ${r.section.padEnd(9)}  ` +
    `repeat-rebuild drift ${r.identical.length}/${r.stems}   ` +
    `${String(r.offenders.length).padStart(2)}/${r.stems} stems have more than one note-set per key ` +
    `(worst key produces ${r.worstFanout})` +
    (r.offenders.length ? `  [${r.offenders.join(' ')}]` : '') +
    `   {${r.keys} keys over ${r.steps} steps}`,
  );
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

const controlOk = rows.every((r) => r.keys >= 3 && r.sets >= 3);
if (!controlOk) {
  console.log(`\nCONTROL FAILED: the sweep produced ${rows.map((r) => `${r.keys} keys/${r.sets} note-sets`).join(', ')} — too few to tell a stable director from one that has stopped rebuilding. Ignore every row above.`);
  process.exit(2);
}
console.log(`\ncontrol passed: the sweep moved through ${rows.map((r) => r.keys).join('/')} distinct keys and ${rows.map((r) => r.sets).join('/')} distinct note-sets.`);
const offending = rows.reduce((a, r) => a + r.offenders.length, 0);
const worst = Math.max(...rows.map((r) => r.worstFanout));
console.log(
  offending > 0
    ? `\n>>> ${offending} STEM-AND-WAVE COMBINATIONS PRODUCE UP TO ${worst} DIFFERENT SETS OF NOTES UNDER ONE REBUILD KEY <<<`
    : `\nevery rebuild key maps to exactly one set of notes. Material can only change when the key says it changed.`,
);
process.exit(offending > 0 ? 1 : 0);
