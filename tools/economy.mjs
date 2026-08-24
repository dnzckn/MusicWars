/**
 * Does the multiplier still climb, and does the descant ever fire?
 *
 * Combo comes from collecting the notes enemies drop, so it is downstream of
 * the kill rate — and the roster rebalance took a run from 42-54 kills to about
 * 20. The descant, the one reward that makes the music *better* rather than
 * merely more intense, needs combo >= 8. If the economy no longer reaches that,
 * a feature built and verified in isolation is dead in the actual game.
 *
 * Same shape as the drop pity-timer, which was denominated in kills and
 * silently tightened when kills got rarer.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const MINUTES = Number(process.env.MINUTES ?? 4);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const r = await p.evaluate(async (mins) => {
  const w = window.__musicwars.world;
  let peak = 0, descantFrames = 0, frames = 0, notesCollected = 0;
  w.bus.on('note:collect', () => notesCollected++);
  const end = performance.now() + mins * 60000;
  while (performance.now() < end) {
    peak = Math.max(peak, w.combo);
    if (w.combo >= 8) descantFrames++;
    frames++;
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 200));
  }
  return { peakCombo: peak, descantPct: Math.round((descantFrames / frames) * 100),
    wave: w.waveIndex + 1, score: w.score, notesTotal: w.totals.notes };
}, MINUTES);
await b.close();
console.log(JSON.stringify(r, null, 1));
console.log(`\npeak multiplier x${r.peakCombo + 1}; the lead's descant was earned for ${r.descantPct}% of the run`);
const problems = [];
if (r.peakCombo < 8) problems.push(`the multiplier never reached the descant threshold (peak x${r.peakCombo + 1}, needs x9)`);
if (r.descantPct < 5) problems.push(`the descant was audible for only ${r.descantPct}% of the run`);
for (const x of problems) console.log('ECONOMY:', x);
console.log(problems.length ? 'THE REWARD NEVER ARRIVES' : 'THE ECONOMY REACHES ITS REWARDS');
process.exit(problems.length ? 1 : 0);
