/*
 * SCRATCH. Photograph warp and the boss bar, and drive them with real keys.
 *
 * Two things this proves that no node harness can: that `Input` turns an actual
 * KeyW down into `state.throttle` and the world into warp (the whole DOM path),
 * and what the mode LOOKS like — which is the half of "an invisible mode is a
 * bug" that only a picture can answer.
 *
 *   NODE_OPTIONS=--experimental-transform-types node tools/_warpshots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import './lib/tsnode.mjs';

/*
 * The run bar's geometry, IMPORTED. This file held its own copy — `0.42·H −
 * 17` and `0.86·H + 31` — which would have kept reporting CLEAR after the bar
 * moved (AGENTS.md §3: a tool holding its own copy of a constant will lie the
 * day it moves). `headroom` and `stackHeight` are CSS px, which is the unit
 * the DOM rects below are in.
 */
const { RUN_BAR } = await import('../src/game/runmap.ts');

const OUT = new URL('./_warpshots/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.evaluate(() => {
  let n = 0;
  let t0 = performance.now();
  const tick = () => {
    n++;
    const now = performance.now();
    if (now - t0 > 500) {
      window.__fps = Math.round((n * 1000) / (now - t0));
      n = 0;
      t0 = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await p.click('#start-button');
await p.waitForTimeout(3000);

const probe = () =>
  p.evaluate(() => {
    const w = window.__musicwars.world;
    return {
      t: +w.snapshot.time.toFixed(1),
      phase: w.stagePhase,
      wave: w.waveIndex,
      warp: w.warping,
      charge: +w.warpCharge.toFixed(2),
      release: +w.warpRelease.toFixed(2),
      frac: +w.bossProgress.toFixed(3),
      left: w.wavesToBoss,
      enemies: w.enemies.length,
      thr: +w.throttle.toFixed(2),
      fps: window.__fps ?? -1,
    };
  });

const shot = async (name) => {
  await p.screenshot({ path: new URL(name + '.png', OUT).pathname.replace(/^\//, '') });
  console.log(name.padEnd(16), JSON.stringify(await probe()));
};

// ---------------------------------------------------------------------------
// A. REAL KEYS. No driver installed, so `input.sample()` is the only source.
// ---------------------------------------------------------------------------
console.log('\nA. real keyboard, no bot\n');
await p.waitForTimeout(4000);
await shot('a1-cruise');

await p.keyboard.down('w');
await p.waitForTimeout(700);
await shot('a2-arming');
await p.waitForTimeout(1200);
await shot('a3-engaged');
await p.keyboard.up('w');
await p.waitForTimeout(1500);
await shot('a4-latched-hands-off');
/*
 * NO SCREENSHOT INSIDE THE BRAKE HOLD. Playwright's capture blurs the page for
 * a moment and `Input`'s blur handler clears every held key, so the first
 * draft's mid-hold shot silently released S and the mode never dropped —
 * a harness artifact that looked exactly like a broken latch.
 */
await p.keyboard.down('s');
await p.waitForTimeout(600);
console.log('mid-brake      ', JSON.stringify(await probe()));
await p.waitForTimeout(1600);
console.log('end-brake      ', JSON.stringify(await probe()));
await p.keyboard.up('s');
await shot('a6-dropped');

// ---------------------------------------------------------------------------
// B. THE BOT FLIES, THE THROTTLE IS HELD. What warp looks like with a field in
//    it, and what the bar looks like as it climbs.
// ---------------------------------------------------------------------------
console.log('\nB. bot driving, warp held\n');
const { installDriver } = await import('./lib/driver.mjs');
await installDriver(p, 'dodge');
await p.waitForTimeout(8000);
await shot('b1-cruise-crowd');

await p.evaluate(() => {
  window.__botThrottle = 1;
  const t = setInterval(() => {
    if (window.__botInput) window.__botInput.throttle = window.__botThrottle;
  }, 8);
  window.__botThrottleTimer = t;
});
await p.waitForTimeout(2200);
await shot('b2-warp-on');
await p.waitForTimeout(9000);
await shot('b3-warp-crowd');
// Hands off the stop: warp is latched, the bot flies.
await p.evaluate(() => {
  window.__botThrottle = 0;
});
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(7000);
  const s = await probe();
  if (s.frac > 0.6 || s.phase === 'conductor') break;
}
await shot('b4-bar-high');
await p.waitForTimeout(9000);
await shot('b5-bar-higher');
await p.evaluate(() => {
  window.__botThrottle = -1;
});
await p.waitForTimeout(700);
await shot('b6-releasing');
await p.waitForTimeout(1200);
await shot('b7-dropped');

// ---------------------------------------------------------------------------
// C. The bar at other windows. The throttle gauge chose the right edge because
//    `.hud-tl` reaches the ship's station line at a 720-tall window; the boss
//    bar sits below that band, so the case to photograph is a SHORT window.
// ---------------------------------------------------------------------------
console.log('\nC. other windows\n');
// 1280x600 is the shortest window the run bar is measured at: the stack under
// the bar against the resume pill, which is un-hidden for the measurement.
for (const [vw, vh] of [[1000, 800], [1920, 1080], [1280, 720], [900, 600], [1280, 600]]) {
  const q = await b.newPage({ viewport: { width: vw, height: vh } });
  await q.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await q.click('#start-button');
  await q.waitForTimeout(2500);
  await installDriver(q, 'dodge');
  await q.waitForTimeout(9000);
  await q.evaluate(() => {
    window.__botThrottle = 1;
    setInterval(() => {
      if (window.__botInput) window.__botInput.throttle = window.__botThrottle;
    }, 8);
  });
  await q.waitForTimeout(2200);
  await q.evaluate(() => {
    window.__botThrottle = 0;
  });
  await q.waitForTimeout(14000);
  const name = 'c-' + vw + 'x' + vh;
  await q.screenshot({ path: new URL(name + '.png', OUT).pathname.replace(/^\//, '') });
  const st = await q.evaluate((bar) => {
    const wd = window.__musicwars.world;
    const tl = document.querySelector('.hud-tl').getBoundingClientRect();
    const foot = document.querySelector('.hud-foot').getBoundingClientRect();
    const stage = document.querySelector('#stage').getBoundingClientRect();
    // The resume pill, shown for the measurement with the text hud.ts gives
    // it: it is the lowest thing the stack under the bar can hit, and it is
    // hidden unless the AudioContext is suspended.
    const res = document.querySelector('#ui-resume');
    const wasHidden = res.classList.contains('hidden');
    const hadText = res.textContent;
    res.classList.remove('hidden');
    if (!res.textContent) res.textContent = '♪ tap to resume the music';
    const resumeTop = Math.round(res.getBoundingClientRect().top - stage.top);
    res.textContent = hadText;
    if (wasHidden) res.classList.add('hidden');
    return {
      frac: +wd.bossProgress.toFixed(2),
      left: wd.wavesToBoss,
      warp: wd.warping,
      stageH: Math.round(stage.height),
      hudTlBottom: Math.round(tl.bottom - stage.top),
      footTop: Math.round(foot.top - stage.top),
      resumeTop,
      barTop: Math.round(stage.height * bar.top) - bar.headroom,
      barBottom: Math.round(stage.height * bar.bot) + bar.stackHeight,
    };
  }, RUN_BAR);
  const clear = st.hudTlBottom < st.barTop && st.barBottom < Math.min(st.footTop, st.resumeTop);
  console.log(name.padEnd(14), JSON.stringify(st), clear ? 'CLEAR' : '*** COLLIDES');
  await q.close();
}

await b.close();
console.log('\nshots in tools/_warpshots/\n');
