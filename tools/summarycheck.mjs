/**
 * The run summary's stats must actually count something.
 *
 * NOTES and BEST MULT were initialised at reset and never written again, so
 * every run in the project's history ended on "NOTES 0 / BEST MULT x1" — two
 * dead numbers on the one screen whose entire job is to tell the player what
 * their run was.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');

/*
 * Two windows, and a stat counts if it moved in EITHER.
 *
 * This exists because NOTES and BEST MULT were initialised at reset and never
 * written again — every run in the project's history ended on "NOTES 0 / BEST
 * MULT x1". The question is whether a stat is permanently dead, not whether all
 * four move inside one arbitrary window, and no single window produces all
 * four: early waves clear quickly but the rebalance left them almost nothing to
 * graze past, while a later wave has real fire and does not finish inside a
 * minute. Demanding all four at once made the check fail on whichever regime it
 * happened to sit in.
 */
await p.waitForTimeout(30000);
const early = await p.evaluate(() => ({ ...window.__musicwars.world.totals }));
await p.evaluate(() => { const w = window.__musicwars.world; w.jumpToWave(11); w.player.lives = 4; });
await p.waitForTimeout(45000);

const late = await p.evaluate(() => ({ ...window.__musicwars.world.totals, wave: window.__musicwars.world.waveIndex + 1 }));
// Best of both windows: a stat is alive if it ever moved.
const t = { ...late };
for (const k of ['notes', 'bestMultiplier', 'flawless', 'wavesCleared', 'grazes']) {
  t[k] = Math.max(early[k] ?? 0, late[k] ?? 0);
}
console.log('early window:', JSON.stringify(early));
console.log('late window :', JSON.stringify(late));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(t));
const dead = Object.entries({ notes: t.notes, bestMultiplier: t.bestMultiplier - 1, grazes: t.grazes, wavesCleared: t.wavesCleared })
  .filter(([, v]) => v === 0)
  .map(([k]) => k);
if (dead.length) console.log(`STATS THAT NEVER MOVED: ${dead.join(', ')}`);
console.log(dead.length ? 'THE SUMMARY IS LYING' : 'EVERY SUMMARY STAT COUNTS SOMETHING');
process.exit(dead.length ? 1 : 0);
