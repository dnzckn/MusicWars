/**
 * Headless smoke test.
 *
 * Cannot verify that the music sounds good — only a person can do that — but it
 * does verify the things that fail silently: that the AudioContext actually
 * resumes, that Strudel's scheduler advances, that patterns query without
 * throwing, and that the director's state moves in response to the game.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const URL = process.env.URL ?? 'http://localhost:5173/';
const errors = [];
const warnings = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-gl=swiftshader'],
});
const page = await browser.newPage();


page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`));
page.on('console', (m) => {
  const text = `${m.type()}: ${m.text()}`;
  if (m.type() === 'error') errors.push(text);
  else if (m.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack||'').split('\n').slice(0,6).join('\n')}`));

const __reloads = await freezePage(page);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.click('#start-button');

// Peak tracking: sampling at four instants misses everything that happens
// between them, and a screen-clearing bomb makes an instant reading of "0
// bullets" perfectly normal. Poll continuously and keep the maxima.
await page.evaluate(() => {
  const mw = window.__musicwars;
  const peak = { bullets: 0, enemies: 0, tension: 0, near: 0, score: 0, sections: new Set(), keys: new Set(), stems: 0, minFps: 999,
    sectionMs: {}, stemMs: {}, stemSum: {}, stemFull: {}, healthMin: 1, fpsSamples: [], rebuildMax: 0, rebuilds: 0, tensionHist: [0,0,0,0,0], samples: 0 };
  window.__peak = peak;
  setInterval(() => {
    const s = mw.world.snapshot;
    const r = mw.readout();
    peak.bullets = Math.max(peak.bullets, s.bulletCount);
    peak.enemies = Math.max(peak.enemies, s.enemyCount);
    peak.near = Math.max(peak.near, s.bulletsNear);
    peak.tension = Math.max(peak.tension, r.tension); peak.energy = Math.max(peak.energy ?? 0, r.energy);
    peak.score = Math.max(peak.score, s.score);
    peak.stems = Math.max(peak.stems, Object.values(r.levels).filter((v) => v > 0.05).length);
    peak.sections.add(r.section);
    peak.keys.add(r.key);
    peak.sectionMs[r.section] = (peak.sectionMs[r.section] ?? 0) + 100;
    for (const [k, v] of Object.entries(r.levels)) {
      if (v > 0.05) peak.stemMs[k] = (peak.stemMs[k] ?? 0) + 100;
      peak.stemSum[k] = (peak.stemSum[k] ?? 0) + v;
      peak.stemFull[k] = (peak.stemFull[k] ?? 0) + (v > 0.9 ? 1 : 0);
    }
    peak.healthMin = Math.min(peak.healthMin, r.health);
    peak.tensionHist[Math.min(4, Math.floor(r.energy * 5))]++;
    peak.samples++;
    if (mw.loop.fps > 1) { peak.minFps = Math.min(peak.minFps, mw.loop.fps); peak.fpsSamples.push(mw.loop.fps); }
    peak.rebuildMax = Math.max(peak.rebuildMax, mw.director.lastRebuildMs);
    peak.rebuilds = mw.director.rebuildCount;
  }, 100);
});

const sample = async (label, ms) => {
  await page.waitForTimeout(ms);
  const state = await page.evaluate(() => {
    const mw = window.__musicwars;
    if (!mw) return { error: 'no dev handle' };
    const w = mw.world;
    const r = mw.readout();
    return {
      fps: Math.round(mw.loop.fps),
      audio: mw.audio(),
      beat: +w.transport.beat.toFixed(2),
      bpm: r.bpm,
      section: r.section,
      key: r.key,
      tension: +r.tension.toFixed(3),
      rawTension: +r.rawTension.toFixed(3),
      wave: w.snapshot.wave,
      enemies: w.snapshot.enemyCount,
      bullets: w.snapshot.bulletCount,
      near: w.snapshot.bulletsNear,
      score: w.snapshot.score,
      lives: w.snapshot.lives,
      liveStems: Object.entries(r.levels).filter(([, v]) => v > 0.05).map(([k]) => k),
    };
  });
  console.log(`\n--- ${label} ---`);
  console.log(JSON.stringify(state, null, 1));
  return state;
};

const a = await sample('t = 3s', 3000);
const b = await sample('t = 12s', 9000);

// Drive the ship into traffic so tension has a reason to move.
await page.keyboard.down('KeyZ');
await page.keyboard.down('ArrowUp');
const c = await sample('t = 22s, pushing forward + firing', 10000);
await page.keyboard.up('ArrowUp');
await page.keyboard.up('KeyZ');

const d = await sample('t = 34s', 12000);

// --- powerup -> music ------------------------------------------------------
// Two distinct mechanisms to check. Most powerups modify an existing stem
// (rapid doubles the hi-hat subdivision); a few have their own voice in the
// `power` stem (nova, blackhole, bomb). Both paths matter, and testing only the
// second one used to pass for the wrong reason.
const powerFx = await page.evaluate(async () => {
  const mw = window.__musicwars;
  /*
   * Count the notes the power lane actually plays, not its fader.
   *
   * The lane is gated on `bombs > 0 || nova || blackhole`, and the player
   * starts with three bombs — so it is already up before nova is picked up, and
   * both an absolute threshold and a delta on the level were testing something
   * that could not move. Nova adds a *voice*; that is the thing to measure.
   */
  const powerNotes = () => mw.director.sampleBar(mw.world.transport).power.length;

  /*
   * Silence the lane first, or the baseline is not a baseline.
   *
   * The lane is gated on `bombs > 0 || nova || blackhole` and the player starts
   * with three bombs, so "before" was often already a fully voiced 6 and adding
   * nova could not raise it — the check failed roughly one run in three, on the
   * arrangement's timing rather than on anything about nova. Taking the bombs
   * away closes the gate, so the reading afterwards is genuinely nova's.
   */
  mw.world.player.bombs = 0;
  delete mw.world.player.powerups.nova;
  delete mw.world.player.powerups.blackhole;
  await new Promise((r) => setTimeout(r, 2600));
  const powerBefore = powerNotes();

  /*
   * Toggle and read in the same tick.
   *
   * Waiting between the two reads let musical intensity drift, so the hat
   * subdivision could legitimately be the same number before and after and the
   * test failed for a reason that had nothing to do with the powerup. Reading
   * back-to-back holds everything else constant.
   */
  // The lane is `hats` in STEM_IDS but `sourceLines()` labels it 'motor', because
  // it plays a pitched inner voice rather than a hi-hat. This read said 'hats'
  // and had been throwing on `undefined.code` ever since that rename — invisible
  // on a box where the browser could not launch at all. Throw a legible error
  // rather than a TypeError if the label moves again.
  const hats = () => {
    const line = mw.director.sourceLines().find((l) => l.label === 'motor');
    if (!line) throw new Error(`no 'motor' line; labels are: ${mw.director.sourceLines().map((l) => l.label).join(', ')}`);
    return line.code;
  };
  delete mw.world.player.powerups.timewarp;
  const hatsBefore = hats();
  mw.world.player.powerups.timewarp = 1;
  const hatsAfter = hats();
  delete mw.world.player.powerups.timewarp;

  // Now exercise the real pickup path for the voiced-powerup half.

  mw.world.player.addPowerup('nova', 60);
  mw.world.bus.emit('powerup:pickup', { kind: 'nova', level: 1 });

  /*
   * Poll for the voice rather than sleeping a fixed 2.6s.
   *
   * The fixed sleep failed about one run in two. The obvious suspect was the
   * director deferring non-structural rebuilds to the bar line, but the latency
   * this now prints is around 120ms — nowhere near a bar, so that was not it.
   * The actual cause is that `sampleBar` reads whichever bar is currently
   * playing, and the power lane's pattern is eight bars long with notes in some
   * of them and not others. A fixed wait lands on an arbitrary bar and finds an
   * empty one about half the time. Polling catches the first bar that has the
   * voice in it, which is the question being asked.
   */
  const deadline = performance.now() + 8000;
  let powerAfter = powerNotes();
  while (powerAfter <= powerBefore && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    powerAfter = powerNotes();
  }
  const voiceLatencyMs = Math.round(performance.now() - (deadline - 8000));

  return {
    hatsBefore,
    hatsAfter,
    powerBefore,
    powerAfter,
    voiceLatencyMs,
    loadout: Object.keys(mw.world.snapshot.powerups),
  };
});
console.log(`\n--- powerup -> music ---`);
console.log(`  timewarp : hats ${powerFx.hatsBefore} -> ${powerFx.hatsAfter}`);
console.log(`  nova  : power lane notes/bar ${powerFx.powerBefore} -> ${powerFx.powerAfter} (heard after ${powerFx.voiceLatencyMs}ms)`);
console.log(`  loadout: ${powerFx.loadout.join(', ')}`);

const bad = await page.evaluate(async () => {
  const out = await window.__musicwars.probe();
  return out.slice(0, 12);
});
console.log(`\n--- non-finite control scan: ${bad.length} ---`);
bad.forEach((b) => console.log(`  cycle ${b.cycle}  ${b.control} = ${b.value}  (s=${b.sound} note=${b.note})`));

const peak = await page.evaluate(() => {
  const p = window.__peak;
  return { ...p, sections: [...p.sections], keys: [...p.keys], minFps: Math.round(p.minFps) };
});
// Dynamic range is the feature. A stem pinned at full level most of the time is
// the failure mode the user actually reported.
const pinned = Object.entries(peak.stemFull)
  .filter(([k]) => !['fx', 'motifs', 'power'].includes(k))
  .filter(([, v]) => v / peak.samples > 0.6)
  .map(([k]) => k);
console.log('\n--- peaks over the whole run ---');
console.log(JSON.stringify({ ...peak, sectionMs: undefined, stemMs: undefined, stemSum: undefined, stemFull: undefined, fpsSamples: undefined, tensionHist: undefined, samples: undefined }, null, 1));
const pct = (ms) => `${((ms / (peak.samples * 100)) * 100).toFixed(0)}%`;
console.log('section time: ' + Object.entries(peak.sectionMs).map(([k, v]) => `${k} ${pct(v)}`).join('  '));
console.log('stem uptime : ' + Object.entries(peak.stemMs).map(([k, v]) => `${k} ${pct(v)}`).join('  '));
console.log('stem avg lvl: ' + Object.entries(peak.stemSum).map(([k, v]) => `${k} ${(v / peak.samples).toFixed(2)}`).join('  '));
console.log('pinned >0.9 : ' + Object.entries(peak.stemFull).map(([k, v]) => `${k} ${((v / peak.samples) * 100).toFixed(0)}%`).join('  '));
console.log(`health floor: ${peak.healthMin.toFixed(2)}`);
const sorted = peak.fpsSamples.slice().sort((a, b) => a - b);
const q = (f) => sorted.length ? sorted[Math.floor(sorted.length * f)].toFixed(0) : 'n/a';
console.log(`fps p5/p50   : ${q(0.05)} / ${q(0.5)}   (min ${peak.minFps})`);
console.log(`rebuilds     : ${peak.rebuilds} total, worst ${peak.rebuildMax.toFixed(1)}ms`);
console.log('ENERGY dist : ' + peak.tensionHist.map((n, i) => `${(i * 0.2).toFixed(1)}-${((i + 1) * 0.2).toFixed(1)}:${((n / peak.samples) * 100).toFixed(0)}%`).join('  '));

await page.screenshot({ path: 'tools/smoke.png' });
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await browser.close();

// ---- assertions ----------------------------------------------------------
const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); };

check(d.audio.status === 'running', `audio status is "${d.audio.status}", expected "running"`);
check(d.audio.started, 'strudel scheduler never started');
check(d.audio.cycle > 4, `strudel cycle clock stuck at ${d.audio.cycle} — the AudioContext is probably suspended`);
check(d.beat > 20, `transport did not advance (beat=${d.beat}) — audio clock is probably dead`);
/*
 * No absolute fps gates here — framecheck owns frame pacing.
 *
 * These are the last two survivors of a family already removed once from this
 * file. They cannot mean anything on this machine: the headless browser
 * rasterises on SwiftShader, so a frame rate measured here describes ANGLE's
 * software rasteriser at least as much as the game, and it drops further
 * whenever another workstream is running its own browser. `framecheck` answers
 * the question properly by measuring a blank page in the same session and
 * judging the game against that control, which is the only form of it that
 * transfers to a real machine.
 */
console.log(`fps ${d.fps} (not asserted here — see framecheck)`);
check(peak.enemies > 0, 'no enemies ever spawned');
check(peak.bullets > 3, `enemy bullets peaked at only ${peak.bullets} — early waves are meant to be calm, not empty`);
check(peak.score > 0, 'score never moved — player weapons may not be hitting');
check(peak.sections.length > 1, `arrangement never changed section (stuck in ${peak.sections[0]})`);
// The arrangement runs on energy, not danger — see MusicDirector.energy.
check((peak.energy ?? 0) > 0.35, `musical energy peaked at only ${(peak.energy ?? 0).toFixed(3)}`);
check(peak.stems >= 5, `too few simultaneous stems: ${peak.stems}`);
/*
 * Thresholds set against the measured noise floor, not against 60.
 *
 * This runs headless under software rasterisation alongside other browsers, so
 * the absolute numbers mean little: sampled across three consecutive identical
 * runs, p5 came out 41, 45 and 45, and p50 56-58. A gate at p5 > 40 therefore
 * failed roughly one run in three on unchanged code — and an intermittent gate
 * is worse than none, because it teaches you to ignore red.
 *
 * p50 is the primary signal (tail-insensitive); p5 is a floor well below the
 * observed spread, so it only trips on a real collapse.
 */
console.log(`median fps ${q(0.5)} (not asserted here — see framecheck)`);
/*
 * No absolute fps gate here. `framecheck` owns frame pacing.
 *
 * This threshold has been raised and lowered repeatedly and has never been
 * meaningful: the headless browser rasterises on SwiftShader, so an absolute
 * frame rate measured here describes ANGLE's software rasteriser as much as it
 * describes the game. It sat at 40 and read 41/45/45 — passing on noise — then
 * at 32 and read 31, failing on the same noise. framecheck answers this
 * properly by measuring a blank page in the same session and judging the game
 * against that, which is the only version of the question that transfers to a
 * real machine. Two checks asserting the same thing, one of them badly
 * calibrated, is how a suite stops being read.
 */
console.log(`fps p5 ${q(0.05)} (not asserted here — see framecheck)`);
check(peak.rebuildMax < 25, `worst pattern rebuild took ${peak.rebuildMax.toFixed(1)}ms — that is a dropped frame`);
check(pinned.length === 0, `stems pinned at full level >60% of the run: ${pinned.join(', ')}`);
check(bad.length === 0, `${bad.length} non-finite control values in the pattern`);
/*
 * Assert the *change*, not an absolute level.
 *
 * The power stem deliberately fades as the music gets busy — a heartbeat is
 * something you notice in the quiet — so its ceiling of 0.8 drops to about 0.30
 * at high intensity. A threshold of "> 0.3" therefore failed on a perfectly
 * healthy run that happened to be measured during a drop. What matters is that
 * picking up a voiced powerup moves it.
 */
check(
  powerFx.powerAfter > powerFx.powerBefore,
  `nova added no voice to the power lane (${powerFx.powerBefore} -> ${powerFx.powerAfter} notes/bar)`,
);
check(powerFx.hatsAfter !== powerFx.hatsBefore, `timewarp did not change the hi-hat pattern (${powerFx.hatsBefore})`);

const realErrors = errors.filter((e) => !/favicon/i.test(e));
console.log(`\n=== console: ${realErrors.length} errors, ${warnings.length} warnings ===`);
[...new Set(realErrors)].slice(0, 8).forEach((e) => console.log('  ERR ' + e));
warnings.slice(0, 12).forEach((e) => console.log('  WARN ' + e));

if (fail.length || realErrors.length) {
  console.log('\n=== FAILURES ===');
  fail.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\n=== SMOKE TEST PASSED ===');
