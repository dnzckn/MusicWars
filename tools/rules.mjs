/**
 * The three wave rules, and the panel under a maximum-width run.
 *
 * From wave 9 a third of the non-boss waves run under FLANKED, SOLOIST or
 * HUSHED. They are the game's most distinctive moments and they are announced
 * by `world.announce(label, sub, 'wave')` — the same centre-screen treatment,
 * in the same blue, as the wave counter — drawn in `renderer.drawBanner`. Both
 * of those are outside the UI workstream, so what this captures is the part
 * that is inside it: the light around the cabinet, and the rule strip, which
 * last the whole wave rather than 2.4 seconds.
 *
 * The last frames are a stress case rather than a rule: a seven-figure score
 * beside x50 and the descant tag, which is where the score group runs out of
 * room. Powerup uptime went from ~41% to ~95% and multipliers from a peak of x7
 * to x50+, so the crowded case is now the ordinary one. Asserts nothing — this
 * is for looking at.
 *
 * The score group used to be a `.block` inside a 268-460px sidebar and the
 * spill was measured against that block's right edge. The sidebar is gone
 * (`docs/plan-refactor-3.md` §5); the equivalent bound is now the playfield,
 * because `.hud-tr` is anchored to its top-right corner and there is nothing
 * to the right of it to spill into.
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
    const g = document.querySelector('.hud-tr').getBoundingClientRect();
    const field = document.getElementById('playfield').getBoundingClientRect();
    return {
      spillRight: Math.round(g.right - field.right),
      spillLeft: Math.round(field.left - g.left),
      w: Math.round(g.width),
      h: Math.round(g.height),
    };
  });
  await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/wide-${w}.png` });
  console.log(`${w}x${h} score group ${over.w}x${over.h}px, spill right=${over.spillRight}px left=${over.spillLeft}px -> wide-${w}.png`);
  await p.close();
}
await b.close();
