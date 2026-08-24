/**
 * The three wave rules, and the panel under a maximum-width run.
 *
 * From wave 9 a third of the non-boss waves run under FLANKED, SOLOIST or
 * HUSHED. They are the game's most distinctive moments and they are announced
 * by `world.announce(label, sub, 'wave')` — the same centre-screen treatment,
 * in the same blue, as the wave counter — drawn in `renderer.drawBanner`. Both
 * of those are outside the UI workstream, so what this captures is the part
 * that is inside it: the light around the cabinet, and the rule strip in the
 * panel, which last the whole wave rather than 2.4 seconds.
 *
 * The last frame is a stress case rather than a rule: a seven-figure score
 * beside x50 and the descant tag, at the panel's 268px floor, which is where
 * the score line runs out of room. Powerup uptime went from ~41% to ~95% and
 * multipliers from a peak of x7 to x50+, so the crowded case is now the
 * ordinary one. Asserts nothing — this is for looking at.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });

for (const rule of ['flank', 'elite', 'hush']) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const reloads = await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(2200);
  await installDriver(p, 'dodge');
  await p.waitForTimeout(9000);
  await p.evaluate((rule) => {
    const w = window.__musicwars.world;
    w.movement = rule;
    w.player.maxActive = 5;
    for (const k of ['drones', 'rapid', 'nova']) w.player.addPowerup(k, 90);
  }, rule);
  // Past the 2.4s banner, so what is left in frame is this workstream's half.
  await p.waitForTimeout(3000);
  const seen = await p.evaluate(() => ({
    stage: document.getElementById('stage').dataset.movement ?? null,
    strip: document.getElementById('ui-movement').textContent,
  }));
  await p.screenshot({ path: `/tmp/rule-${rule}.png` });
  console.log(`${rule.padEnd(6)} stage=${seen.stage} strip="${seen.strip}" -> /tmp/rule-${rule}.png`);
  if (reloads() > 0) console.log(`  WARNING: page reloaded ${reloads()}x mid-run`);
  await p.close();
}

// The widest the score block ever gets, at the width where it has least room.
for (const [w, h] of [[1000, 800], [1440, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(2200);
  await installDriver(p, 'dodge');
  await p.waitForTimeout(7000);
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.score = 1234567;
    w.combo = 57;
    w.comboTimer = 90;
    w.player.maxActive = 5;
    for (const k of ['drones', 'rapid', 'nova', 'spread']) w.player.addPowerup(k, 90);
  });
  await p.waitForTimeout(1200);
  const over = await p.evaluate(() => {
    const el = document.getElementById('ui-score').parentElement;
    const block = el.closest('.block').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { spill: Math.round(r.right - block.right), lines: Math.round(r.height) };
  });
  const box = await p.locator('#panel').boundingBox();
  await p.screenshot({ path: `/tmp/wide-${w}.png`, clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 } });
  console.log(`${w}x${h} score line spill=${over.spill}px height=${over.lines}px -> /tmp/wide-${w}.png`);
  await p.close();
}
await b.close();
