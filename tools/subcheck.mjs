/**
 * Two checks:
 *   1. the sub plays a part of its own rather than doubling the kick
 *   2. a bomb produces a one-bar fill and returns to where it was
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(16000);
await p.keyboard.up('KeyZ');

/*
 * Sample several bars, not one.
 *
 * A single sample lands at whatever intensity the run happens to be at, and the
 * sub's pattern changes with intensity — one unlucky reading caught the quiet
 * branch and reported 100% overlap. Averaging across bars covers the ladder.
 */
const overlap = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const at = (rows) => new Set(rows.map((r) => Math.round(r.t * 16)));
  let shared = 0, total = 0;
  let firstKick = [], firstSub = [];
  for (let n = 0; n < 6; n++) {
    const bar = mw.director.sampleBar(mw.world.transport);
    const kick = at(bar.kick), sub = at(bar.sub);
    if (n === 0) { firstKick = [...kick]; firstSub = [...sub]; }
    for (const t of sub) { total++; if (kick.has(t)) shared++; }
    await new Promise((r) => setTimeout(r, 1900));
  }
  return { kick: firstKick.sort((a, c) => a - c), sub: firstSub.sort((a, c) => a - c),
           sharedPct: total ? Math.round((shared / total) * 100) : 100, total };
});
console.log('kick onsets (16ths):', overlap.kick.join(','));
console.log('sub  onsets (16ths):', overlap.sub.join(','));
console.log(`sub notes landing on a kick: ${overlap.sharedPct}%  (across ${overlap.total} sub notes, 6 bars)`);

const fill = await p.evaluate(async () => {
  const mw = window.__musicwars;
  /*
   * Make sure the run is still live.
   *
   * The overlap sampling above now takes six bars, and the bot holding fire can
   * die in that time — a dead run stops updating the arranger, so the fill was
   * never observed and the failure looked like the bomb not working.
   */
  if (mw.world.snapshot.gameOver) mw.startRun();
  await new Promise((r) => setTimeout(r, 2500));
  mw.world.player.lives = 4;
  mw.world.player.hp = mw.world.player.maxHp;
  const before = mw.readout().section;
  mw.world.player.bombs = 3;
  mw.world.player.invuln = 0;
  const seen = [];
  const iv = setInterval(() => seen.push(mw.readout().section), 100);
  // Detonate directly: the point of this check is the arrangement response,
  // not the keyboard path.
  mw.world.detonateBombNow();
  await new Promise((r) => setTimeout(r, 7000));
  clearInterval(iv);
  return { before, sawFill: seen.includes('fill'), after: mw.readout().section, seen: [...new Set(seen)] };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`bomb: ${fill.before} -> saw fill: ${fill.sawFill} -> ${fill.after}   (sections: ${fill.seen.join(', ')})`);
const ok = overlap.sharedPct <= 60 && fill.sawFill;
console.log(ok ? 'SUB HAS ITS OWN PART AND BOMBS FILL' : 'check sub/bomb');
if (!ok) process.exit(1);
