/**
 * The first sixty seconds, which decide whether anyone plays a second minute.
 *
 * The opening has been tuned twice from complaints — "too much clutter off the
 * get go", then "shoot a lot slower to start but have it 1 shot enemies" — but
 * never measured. This records the milestones a new player actually experiences:
 * how long until they kill something, until they are shot at, until they hold a
 * powerup, and what the music is doing while they wait.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(300);
await installDriver(p, 'dodge');
const r = await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  const t0 = performance.now();
  const at = (x) => +((performance.now() - t0) / 1000).toFixed(1);
  const marks = {};
  const once = (k) => { if (marks[k] === undefined) marks[k] = at(); };
  w.bus.on('enemy:death', (e) => { if (e.byPlayer) once('firstKill'); });
  w.bus.on('enemy:lunge', () => once('firstShotAtYou'));
  w.bus.on('powerup:pickup', () => once('firstPowerup'));
  w.bus.on('player:hit', () => once('firstHitTaken'));
  w.bus.on('enemy:spawn', () => once('firstEnemy'));
  const sections = new Set(), stems = {};
  let samples = 0;
  while (performance.now() - t0 < 60000) {
    const rd = mw.readout();
    sections.add(rd.section);
    for (const [id, v] of Object.entries(rd.levels)) { stems[id] = Math.max(stems[id] ?? 0, v); }
    samples++;
    await new Promise((r) => setTimeout(r, 200));
  }
  const audible = Object.entries(stems).filter(([, v]) => v > 0.12).map(([k]) => k);
  return { ...marks, wave: w.waveIndex + 1, score: w.score,
    sectionsHeard: [...sections], layersHeard: audible.length, layers: audible };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));

/*
 * The opening is deliberately gentle, so this is not about difficulty. It is
 * about whether anything happens: a first minute with no kill, nothing shooting
 * back and no powerup is a minute of flying around an empty room.
 */
const problems = [];
// Observed 7.7s and 9.1s on the same build: the runway is four bars computed at
// a nominal 128bpm, but the tempo drifts and the first group spawns on the frame
// after the wave begins. 10.5s clears that and still catches the six-bar
// version this replaced, which measured 11.5s.
if (!(r.firstEnemy <= 10.5)) problems.push(`first enemy at ${r.firstEnemy ?? 'never'}s`);
if (!(r.firstKill <= 15)) problems.push(`first kill at ${r.firstKill ?? 'never'}s`);
if (!(r.firstPowerup <= 45)) problems.push(`first powerup at ${r.firstPowerup ?? 'never'}s`);
if (r.sectionsHeard.length < 3) problems.push(`only ${r.sectionsHeard.length} sections in the first minute`);
if (r.layersHeard < 6) problems.push(`only ${r.layersHeard} layers audible`);
for (const x of problems) console.log('SLOW START:', x);
console.log(problems.length ? 'THE FIRST MINUTE DRAGS' : 'THE FIRST MINUTE LANDS');
process.exit(problems.length ? 1 : 0);
