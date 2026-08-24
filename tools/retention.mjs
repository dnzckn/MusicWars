/**
 * When the arrangement moves one step, how much of the eight-bar phrase survives?
 *
 * This is the number that matters, and it is not the rebuild rate. One rebuild
 * per ten seconds is musically fine IF the material survives it; a rebuild that
 * keeps 4% of the melody is not a rebuild, it is a different tune. A listener
 * does not hear "the arrangement was regenerated", they hear the melody stop and
 * another one start, over and over, which is what "very choppy... makes it
 * unplayable" describes. `rebuildrate` counts the wrong thing, and
 * `rebuildstable` proves only that identical inputs give identical notes — it
 * says nothing about how violent a legitimate change is.
 *
 * `phrasechurn` measures retention during live play and cannot settle it: total
 * churn at wave 17 read 11.5 and then 27.5 on two runs of an unchanged build,
 * because what the game happens to be doing dominates. So this removes the game.
 * It sweeps the arrangement's own dials — intensity, tension, lead register —
 * through their ranges INSIDE ONE SYNCHRONOUS TICK, forces a full rebuild at
 * every step, and measures the Jaccard overlap of the notes either side of each
 * step where they changed. Nothing drifts, because nothing else is allowed to
 * move.
 *
 * TWO CONTROLS, both printed:
 *
 *   NULL — two rebuilds at the same dial position must overlap 100%. If they do
 *   not, the director is non-deterministic and every retention figure is noise.
 *
 *   RESPONSE — the sweep must produce at least two distinct sets of notes. A
 *   director that had stopped responding, or a hash that cannot see a
 *   difference, would otherwise report perfect retention.
 *
 * Retention is reported per DIAL, because the remedy differs: a dial that
 * transposes the whole line wants to become a signal, whereas one that thins a
 * rhythm wants its notes faded rather than deleted.
 *
 * A layer entering or leaving is not churn and is excluded — going from silence
 * to eight bars of music scores 0% overlap and is the arrangement doing its job.
 *
 * The headline is NESTING, not overlap: is one side of a step a subset of the
 * other? That is the rule the music has to follow — a step up ADDS detail to
 * the existing skeleton, a step down removes it, and whatever survives stays
 * where it was. Overlap is the wrong question in both directions: Jaccard
 * punishes a pure addition (eighths becoming sixteenths scores 50% with not one
 * existing hit moved) and directional survival punishes every removal, so
 * optimising against either pushes the arrangement toward not responding at
 * all, which is the opposite of what this game is for. Nesting is 1.0 for any
 * change that only adds or only removes, and falls only when material is
 * genuinely swapped. Directional survival is printed alongside it as `kept`.
 *
 * TRANSPOSITION IS EXEMPT, and detected rather than assumed. If every pitch
 * moved by the same interval and no onset changed, the row prints `TRANSPOSED
 * +12` and is excluded from the verdict: the melody's register follows the ship
 * up the screen, which shares no notes with what came before by definition and
 * is heard as the same tune, moved. Rhythm alone cannot make that call — a line
 * regenerated on the same grid also keeps its rhythm — so the interval is
 * checked directly.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import { retryOnReload, watchReloads } from './lib/reload.mjs';

const WAVES = (process.env.WAVES ?? '0,16').split(',').map(Number);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await freezePage(p);
const reloads = watchReloads(p);
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
    // Past the eight-bar opening, where most stems are still gated to silence.
    await p.waitForTimeout(12000);
    return p.evaluate(() => {
      const mw = window.__musicwars;
      const d = mw.director;
      const t = mw.world.transport;
      const section = mw.readout().section;

      const hash = (pat) => {
        const out = [];
        for (let c = 0; c < 8; c++) {
          let haps = [];
          try { haps = pat.queryArc(c, c + 1, { _cps: 0.55 }); } catch { return []; }
          for (const h of haps) {
            if (!h.hasOnset?.()) continue;
            const v = h.value ?? {};
            // Structure only: onset, length, pitch, sound. Anything a signal
            // writes moves continuously by design and is not "the notes changed".
            out.push({
              slot: (+h.whole.begin).toFixed(4) + ':' + (+h.whole.end).toFixed(4) + ':' + (v.s ?? '') + ':' + (v.n ?? ''),
              note: typeof v.note === 'number' ? v.note : null,
              // Resolved here, not excluded: `gain` is where the response now
              // lives for the layers that stopped changing their notes.
              gain: typeof v.gain === 'number' ? v.gain : 1,
            });
          }
        }
        out.sort((a, c) => (a.slot < c.slot ? -1 : a.slot > c.slot ? 1 : (a.note ?? 0) - (c.note ?? 0)));
        return out;
      };
      const key = (h) => h.slot + ':' + (h.note ?? '');
      const snapAll = () => Object.fromEntries(Object.keys(d.cache).map((id) => [id, hash(d.cache[id])]));
      /** Total sounding energy in the phrase: how loud this lane is, summed. */
      const loudness = (a) => a.reduce((t, h) => t + h.gain, 0);
      const force = () => {
        d.queueRebuild(t, section);
        for (let g = 0; g < 200 && d.pendingQueue.length; g++) d.drainRebuild();
        return snapAll();
      };
      /**
       * How much of what was ALREADY SOUNDING is still sounding.
       *
       * `|A and B| / |A|`, not the symmetric Jaccard. The two answer different
       * questions and only this one matches the rule the music has to follow:
       * a step up should ADD detail to the existing skeleton and a step down
       * should remove it, with whatever was already playing left where it was.
       * Jaccard punishes a pure addition — eighths becoming sixteenths scores
       * 50% even though not one existing hit moved — so optimising against it
       * would push the arrangement toward not responding at all, which is the
       * opposite of what this game is for.
       */
      const survival = (a, c) => {
        if (!a.length || !c.length) return null; // entering or leaving is not churn
        const B = new Set(c.map(key));
        let kept = 0;
        for (const h of a) if (B.has(key(h))) kept++;
        return kept / a.length;
      };
      /**
       * Is the change NESTED — one side a subset of the other?
       *
       * `max(|A and B|/|A|, |A and B|/|B|)`, which is 1.0 exactly when a step
       * only added material or only removed it, and falls as soon as material
       * is swapped. This is the rule: a step up adds detail to the existing
       * skeleton, a step down takes it away, and whatever survives stays where
       * it was. Directional survival alone would mark every legitimate step
       * DOWN as a failure, since removing a note necessarily loses it.
       */
      const nesting = (a, c) => {
        if (!a.length || !c.length) return null;
        const A = new Set(a.map(key)), B = new Set(c.map(key));
        let inter = 0;
        for (const x of A) if (B.has(x)) inter++;
        return Math.max(inter / A.size, inter / B.size);
      };
      /**
       * Is `c` exactly `a` moved by a constant number of semitones?
       *
       * The melody's register follows the ship up the screen, which is the most
       * direct coupling in the game and deliberately audible. A transposition
       * shares no notes with what came before, so any note-based measure calls
       * it a total rewrite — and a listener hears the same tune, moved. Rhythm
       * alone is not enough to tell the two apart either: a line regenerated on
       * the same grid keeps its rhythm and none of its shape. Returns the
       * interval, or null if the pitches did not move as one.
       */
      const transposition = (a, c) => {
        if (a.length !== c.length || !a.length) return null;
        let delta = null;
        for (let i = 0; i < a.length; i++) {
          if (a[i].slot !== c[i].slot) return null;
          if (a[i].note === null || c[i].note === null) {
            if (a[i].note !== c[i].note) return null;
            continue;
          }
          const dd = c[i].note - a[i].note;
          if (delta === null) delta = dd;
          else if (dd !== delta) return null;
        }
        return delta;
      };

      const i0 = d.intensity, t0 = d.p.tension, r0 = d.leadRegister;
      const apply = () => { d.structureKey(d.snapshot, section, 0); return force(); };

      // NULL CONTROL: same dials, twice.
      const n1 = apply(), n2 = apply();
      const ids = Object.keys(n1);
      const nullWorst = Math.min(...ids.map((id) => survival(n1[id], n2[id]) ?? 1));

      const dials = {
        intensity: { set: (v) => { d.intensity = v; }, values: [], restore: i0 },
        tension: { set: (v) => { d.p.tension = v; }, values: [], restore: t0 },
        register: { set: (v) => { d.leadRegister = v; }, values: [0, 12, 0, 12], restore: r0 },
      };
      for (let v = 0; v <= 1.0001; v += 0.05) dials.intensity.values.push(Math.min(1, v));
      for (let v = 1; v >= -0.0001; v -= 0.05) dials.intensity.values.push(Math.max(0, v));
      dials.tension.values = dials.intensity.values.slice();

      const result = {};
      const responded = {};
      let distinctSets = 0;
      for (const [name, dial] of Object.entries(dials)) {
        const per = {};
        for (const id of ids) per[id] = [];
        let prev = null;
        const seen = new Set();
        const energyLow = {}, energyHigh = {};
        for (const v of dial.values) {
          dial.set(v);
          const snap = apply();
          for (const id of ids) {
            const e = loudness(snap[id]);
            if (v <= 0.001) energyLow[id] = e;
            if (v >= 0.999) energyHigh[id] = e;
          }
          seen.add(ids.map((id) => snap[id].map(key).join('|')).join('#'));
          if (prev) {
            for (const id of ids) {
              if (prev[id].map(key).join('|') === snap[id].map(key).join('|')) continue;
              const sv = survival(prev[id], snap[id]);
              const nv = nesting(prev[id], snap[id]);
              if (sv === null || nv === null) continue;
              per[id].push({ kept: sv, nest: nv, moved: transposition(prev[id], snap[id]) });
            }
          }
          prev = snap;
        }
        distinctSets = Math.max(distinctSets, seen.size);
        dial.set(dial.restore);
        apply();
        const median = (xs) => xs.slice().sort((a, c) => a - c)[Math.floor(xs.length / 2)];
        responded[name] = Object.fromEntries(
          ids.map((id) => {
            const lo = energyLow[id], hi = energyHigh[id];
            if (lo === undefined || hi === undefined) return [id, null];
            const denom = Math.max(lo, hi);
            return [id, denom > 0 ? Math.abs(hi - lo) / denom : 0];
          }),
        );
        result[name] = Object.fromEntries(
          ids.map((id) => {
            const xs = per[id];
            if (!xs.length) return [id, null];
            const moves = xs.map((x) => x.moved);
            return [
              id,
              {
                n: xs.length,
                kept: median(xs.map((x) => x.kept)),
                nest: median(xs.map((x) => x.nest)),
                // Only call it a transposition if EVERY step was one.
                moved: moves.every((mv) => mv !== null && mv !== 0) ? moves[0] : null,
              },
            ];
          }),
        );
      }

      d.intensity = i0; d.p.tension = t0; d.leadRegister = r0;
      apply();
      return { wave: mw.world.waveIndex + 1, section, ids, nullWorst, distinctSets, result, responded };
    });
  });

const all = [];
for (const wave of WAVES) {
  const r = await probe(wave);
  all.push(r);
  console.log('\n=== wave ' + r.wave + ' (' + r.section + ') ===');
  for (const dial of ['intensity', 'tension', 'register']) {
    const row = r.result[dial];
    const cells = r.ids
      .map((id) => {
        const c = row[id];
        if (!c) return null;
        if (c.moved !== null) return id + ' TRANSPOSED ' + (c.moved > 0 ? '+' : '') + c.moved;
        return id + ' nested ' + (c.nest * 100).toFixed(0) + '% (kept ' + (c.kept * 100).toFixed(0) + '%)';
      })
      .filter(Boolean);
    console.log('  ' + dial.padEnd(9) + ' ' + (cells.length ? cells.join('  ') : '(no note changed)'));
  }
  /*
   * Nesting at 100% can mean "additive" or it can mean "inert", and those are
   * opposite outcomes. Several lanes now answer intensity purely through gain
   * signals — no rebuild at all, which is better than a nested rebuild — and
   * nothing above can see that. This prints how much each lane's summed
   * loudness moves from one end of the dial to the other, so a lane that has
   * quietly stopped responding cannot hide behind a perfect retention score.
   */
  const resp = r.responded.intensity ?? {};
  const moved = r.ids.filter((id) => (resp[id] ?? 0) > 0.1);
  console.log('  responds to intensity by gain: ' + (moved.length
    ? moved.map((id) => id + ' ' + ((resp[id] ?? 0) * 100).toFixed(0) + '%').join('  ')
    : 'NOTHING'));
}
await b.close();
if (errs.length) console.log('page errors:', errs.slice(0, 3));

const nullOk = all.every((r) => r.nullWorst >= 0.999);
const respOk = all.every((r) => r.distinctSets >= 2);
console.log('\nnull control: two rebuilds at the same dials overlap ' + (Math.min(...all.map((r) => r.nullWorst)) * 100).toFixed(1) + '% (must be 100)');
console.log('response control: the sweep produced ' + all.map((r) => r.distinctSets).join('/') + ' distinct note-sets (must be >1)');
if (!nullOk || !respOk) {
  console.log('\nCONTROLS FAILED - ignore every number above.');
  process.exit(2);
}

/*
 * Every lane, not just the tune lanes.
 *
 * The earlier verdict watched only lead/arp/chords, on the reasoning that
 * percussion changing is the arrangement working. That is true of the CHANGE
 * and not of the REPLACEMENT: a hi-hat going from eighths to sixteenths should
 * keep every eighth-note hit and interleave new ones between them. Measuring
 * survival rather than overlap makes that distinction directly, so the whole
 * mix can be held to it — a step may add or remove detail, but whatever was
 * already sounding stays where it was.
 *
 * A pure transposition is exempt. It shares no notes with what came before by
 * definition, and it is the feature where the melody climbs with the ship.
 */
let worst = 1, worstWhere = 'nothing';
for (const r of all) {
  for (const dial of ['intensity', 'tension', 'register']) {
    for (const id of r.ids) {
      const c = r.result[dial][id];
      if (!c || c.moved !== null) continue;
      if (c.nest < worst) { worst = c.nest; worstWhere = id + ' on ' + dial + ' at wave ' + r.wave; }
    }
  }
}
console.log(
  worstWhere === 'nothing'
    ? '\nno lane changed at all on any dial (or every change was a transposition)'
    : '\nworst lane: ' + worstWhere + ' — ' + ((1 - worst) * 100).toFixed(0) + '% of one step is material swapped rather than added or removed',
);
console.log(
  worst < 0.9
    ? '\n>>> A STEP OF THE ARRANGEMENT REPLACES MATERIAL INSTEAD OF ADDING TO IT <<<'
    : '\nchanges are additive: what was sounding stays where it was',
);
process.exit(worst < 0.9 ? 1 : 0);
