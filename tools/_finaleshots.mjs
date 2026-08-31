/*
 * Scratch: photograph the run's new set pieces in a real browser.
 *
 * Underscore-prefixed like the other one-off shot tools in here. Not a gate,
 * not in package.json — it exists so a person can LOOK at the mini boss, the
 * final boss and the victory screen, which is the half of this change that no
 * headless assertion can reach.
 *
 * Output: tools/_finaleshots/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
// Without this the vite dev server's watcher reloads the page mid-run the
// moment anything in the repo root changes, and `window.__musicwars` vanishes
// under the script. Every gate in this directory uses it; this one has to too.
import { freezePage } from './lib/frozen.mjs';

const OUT = new URL('./_finaleshots/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    // AGENTS/brief: SwiftShader has caused four separate performance panics in
    // this project. These shots are not a perf measurement, but the renderer
    // path should be the real one.
    '--use-gl=angle',
    '--enable-gpu-rasterization',
    '--ignore-gpu-blocklist',
  ],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

const reloads = await freezePage(p);
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);

const shot = async (name) => {
  await p.screenshot({ path: new URL(`${name}.png`, OUT).pathname.replace(/^\//, '') });
  console.log(`  shot ${name}`);
};

const state = () =>
  p.evaluate(() => {
    const w = window.__musicwars.world;
    const s = w.snapshot;
    const boss = w.enemies.find((e) => e.archetype === 'conductor');
    return {
      wave: s.wave + 1,
      act: s.act,
      acts: s.acts,
      runProgress: +s.runProgress.toFixed(3),
      bossKind: s.bossKind,
      bossesBeaten: s.bossesBeaten,
      runOutcome: s.runOutcome,
      victory: w.victory,
      bossHp: boss ? `${boss.hp}/${boss.maxHp}` : null,
      bossPhases: boss?.phases ?? null,
      bossFinal: boss?.bossFinal ?? null,
      bossHue: boss?.hue ?? null,
      banner: w.banner?.title ?? null,
      wavesToBoss: w.wavesToBoss,
      bossesLeft: w.bossesLeft,
    };
  });

// Park the ship so the boss can be photographed rather than fled.
const arrive = async (wave, label) => {
  await p.evaluate((wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv);
    w.player.lives = 5;
    w.player.hp = w.player.maxHp;
  }, wave);
  // Let the escort clear and the boss arrive. Nudge with a bomb if it stalls.
  for (let i = 0; i < 240; i++) {
    const s = await p.evaluate(() => ({
      boss: window.__musicwars.world.snapshot.bossActive,
      n: window.__musicwars.world.enemies.length,
    }));
    if (s.boss) break;
    if (i % 20 === 19) await p.evaluate(() => { const w = window.__musicwars.world; w.player.bombs = 3; w.detonateBombNow(); });
    await p.evaluate(() => { const w = window.__musicwars.world; w.player.lives = 5; w.player.hp = w.player.maxHp; });
    await p.waitForTimeout(250);
  }
  // Let it actually ENTER. `bossActive` is true the frame it is pushed onto
  // the enemy list, which is off the bottom edge — a shot taken then photographs
  // an empty arena with a full health bar.
  await p.waitForTimeout(4000);
  await p.evaluate(() => { const w = window.__musicwars.world; w.player.lives = 5; w.player.hp = w.player.maxHp; });
  const st = await state();
  console.log(`${label}: ${JSON.stringify(st)}`);
  await shot(label);
  return st;
};

// 1. A MINI BOSS — the second one, so the bar shows one act already down.
await arrive(7, 'mini-boss');

// 2. Mid-run, no boss: the bar and the act pips.
await p.evaluate(() => { const w = window.__musicwars.world; w.jumpToWave(9); w.player.lives = 5; });
await p.waitForTimeout(3000);
console.log(`bar: ${JSON.stringify(await state())}`);
await shot('boss-bar-midrun');

// 3. THE FINAL BOSS.
const fin = await arrive(15, 'final-boss');
if (!fin.bossFinal) console.log('  WARNING: the boss on the field is not flagged final');

// 4. Kill it and photograph the VICTORY screen.
await p.evaluate(async () => {
  const w = window.__musicwars.world;
  // Through the phase gates rather than in one blow: `markBossPhasePending`
  // holds a boss above a threshold it has not played, so a single huge hit
  // cannot skip acts. Chip it down and let the gates commit on their bar lines.
  for (let i = 0; i < 400; i++) {
    const boss = w.enemies.find((e) => e.archetype === 'conductor');
    if (!boss) break;
    boss.hp -= Math.max(4, boss.maxHp * 0.02);
    if (boss.hp <= 0) boss.hp = 1;
    w.player.lives = 5;
    w.player.hp = w.player.maxHp;
    await new Promise((r) => setTimeout(r, 40));
  }
  // Now let the last act actually finish.
  for (let i = 0; i < 300 && !w.victory; i++) {
    const boss = w.enemies.find((e) => e.archetype === 'conductor');
    if (boss) boss.hp -= boss.maxHp * 0.05;
    w.player.lives = 5;
    await new Promise((r) => setTimeout(r, 40));
  }
});
await p.waitForTimeout(1500);
console.log(`after the kill: ${JSON.stringify(await state())}`);
await shot('victory');

const dom = await p.evaluate(() => {
  const el = document.getElementById('gameover-screen');
  return {
    hidden: el.classList.contains('hidden'),
    won: el.classList.contains('won'),
    title: document.getElementById('final-title').textContent,
    outcome: document.getElementById('final-outcome').textContent,
    wave: document.getElementById('final-wave').textContent,
    score: document.getElementById('final-score').textContent,
    button: document.getElementById('retry-button').textContent,
    titleColour: getComputedStyle(document.getElementById('final-title')).color,
  };
});
console.log(`victory DOM: ${JSON.stringify(dom)}`);

// 5. And the LOSING screen, from the same page, for the A/B.
await p.click('#retry-button');
await p.waitForTimeout(2500);
await p.evaluate(async () => {
  const w = window.__musicwars.world;
  for (let i = 0; i < 60 && !w.player.dead; i++) {
    w.player.invuln = 0; w.player.bombs = 0; w.player.lives = 1;
    if (w.player.takeHit()) Object.getPrototypeOf(w).onPlayerHit.call(w);
    await new Promise((r) => setTimeout(r, 40));
  }
});
await p.waitForTimeout(1200);
await shot('death');
const dom2 = await p.evaluate(() => {
  const el = document.getElementById('gameover-screen');
  return {
    won: el.classList.contains('won'),
    title: document.getElementById('final-title').textContent,
    outcome: document.getElementById('final-outcome').textContent,
    titleColour: getComputedStyle(document.getElementById('final-title')).color,
  };
});
console.log(`death DOM:   ${JSON.stringify(dom2)}`);

await b.close();
if (reloads() > 0) console.log(`WARNING: the page reloaded ${reloads()}x — these shots span more than one build`);
console.log(errs.length ? `PAGE ERRORS:\n  ${errs.join('\n  ')}` : 'no page errors');
