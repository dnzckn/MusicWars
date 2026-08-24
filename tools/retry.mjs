/**
 * The second run.
 *
 * Every measurement in this project has been of a first run, but a player who
 * dies presses RETRY immediately — so the second run is at least as common as
 * the first. Death puts the arrangement into `collapse`: the tempo sags to its
 * floor, the filter shuts to 0.02, every layer but fx and sub is muted, and now
 * a collapse timer decays the noise wash. All of that has to come back.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(14000);

const snapshot = () => p.evaluate(() => {
  const mw = window.__musicwars, w = mw.world, rd = mw.readout();
  const audible = Object.values(rd.levels).filter((v) => v > 0.05).length;
  return { section: rd.section, bpm: rd.bpm, tension: +rd.tension.toFixed(2), key: rd.key,
    audibleLayers: audible, wave: w.waveIndex + 1, score: w.score, dead: w.player.dead,
    lives: w.player.lives, slots: w.player.maxActive, cycle: mw.audio().cycle };
});
const first = await snapshot();

// Die for real.
await p.evaluate(async () => {
  const w = window.__musicwars.world;
  for (let i = 0; i < 40 && !w.player.dead; i++) {
    w.player.invuln = 0; w.player.bombs = 0;
    if (w.player.takeHit()) Object.getPrototypeOf(w).onPlayerHit.call(w);
    await new Promise((r) => setTimeout(r, 60));
  }
});
await p.waitForTimeout(6000);
const dead = await snapshot();

// Retry through the button a player would press.
await p.click('#retry-button');
/*
 * Read the score immediately, before the new run has earned any.
 *
 * The first version compared the second run's score against the first run's at
 * the same elapsed time and called them equal a failure — but two independent
 * runs of the same length naturally score about the same, so that assertion was
 * measuring nothing except that the game is consistent. What matters is that
 * the counter starts from zero.
 */
await p.waitForTimeout(400);
const atRetry = await p.evaluate(() => ({ score: window.__musicwars.world.score, wave: window.__musicwars.world.waveIndex + 1 }));
console.log('immediately after retry:', JSON.stringify(atRetry));
await p.waitForTimeout(2100);
await installDriver(p, 'dodge');
await p.waitForTimeout(14000);
const second = await snapshot();
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

console.table([{ when: 'first run', ...first }, { when: 'after death', ...dead }, { when: 'second run', ...second }]);
console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');

const problems = [];
if (second.section === 'collapse') problems.push('the second run is still in the collapse section');
if (second.bpm < first.bpm - 12) problems.push(`tempo did not recover (${second.bpm} vs ${first.bpm})`);
if (second.audibleLayers < first.audibleLayers - 2) problems.push(`only ${second.audibleLayers} layers audible against ${first.audibleLayers} on the first run`);
if (atRetry.score !== 0) problems.push(`score did not reset (${atRetry.score} at retry)`);
if (atRetry.wave !== 1) problems.push(`wave did not reset (${atRetry.wave} at retry)`);
if (second.lives < first.lives) problems.push(`lives did not reset (${second.lives})`);
if (second.slots !== 3) problems.push(`loadout slots carried over from the last run (${second.slots})`);
if (!(second.cycle > dead.cycle)) problems.push('the audio scheduler did not advance into the second run');
if (errs.length) problems.push(`${errs.length} page errors`);
for (const x of problems) console.log('RETRY:', x);
console.log(problems.length ? 'THE SECOND RUN IS NOT A FRESH RUN' : 'RETRY GIVES A CLEAN RUN');
process.exit(problems.length ? 1 : 0);
