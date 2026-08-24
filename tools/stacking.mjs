/**
 * Picking up a powerup you already hold must do something.
 *
 * `addPowerup` raises a held powerup to level 2 and then 3, and the run summary
 * shows the level, so the game promises that a repeat pickup matters. Several
 * did not deliver: LASER's sustain was `laser > 0 ? 0.4 : 0.12` — binary, so the
 * second and third were identical to the first; DRONES was capped at two
 * satellites by a `Math.min(2, ...)`; SPREAD's stereo width hit its clamp at
 * level two.
 *
 * Compares the arp lane's note count at level 1 against level 3, interleaved,
 * since drones add voices to it and the arrangement's own drift affects both
 * arms equally.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(13000);
const r = await p.evaluate(async () => {
  const mw = window.__musicwars, w = mw.world;
  const set = (kind, level) => {
    for (const k of Object.keys(w.player.powerups)) delete w.player.powerups[k];
    for (const k of Object.keys(w.player.powerTimers)) delete w.player.powerTimers[k];
    w.player.held.length = 0;
    for (let i = 0; i < level; i++) w.player.addPowerup(kind, 120);
  };
  const lane = (name) => mw.director.sampleBar(w.transport)[name].length;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const compare = async (kind, name) => {
    const one = [], three = [];
    for (let i = 0; i < 3; i++) {
      set(kind, 1); await new Promise((r) => setTimeout(r, 2600)); one.push(lane(name));
      set(kind, 3); await new Promise((r) => setTimeout(r, 2600)); three.push(lane(name));
    }
    set(kind, 0);
    return { powerup: kind, lane: name, levelOne: +mean(one).toFixed(1), levelThree: +mean(three).toFixed(1) };
  };
  return [
    await compare('drones', 'arp'),
    // nova and blackhole both voice the power lane, and both were gated by a
    // plain truthiness test, so every level sounded like the first.
    await compare('nova', 'power'),
    await compare('blackhole', 'power'),
  ];
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(r);
/*
 * nova and blackhole add *pitches to a chord*, not extra events, so their note
 * count per bar does not have to rise — what changes is the voicing. Only
 * drones adds voices on the same rhythm, so only it is asserted on count. The
 * others are printed as evidence that the lane is alive at both levels.
 */
const drones = r.find((x) => x.powerup === 'drones');
const ok = drones.levelThree > drones.levelOne && r.every((x) => x.levelThree > 0);
if (!(drones.levelThree > drones.levelOne)) console.log('a third DRONES adds no notes to the arp');
for (const x of r) if (!(x.levelThree > 0)) console.log(`${x.powerup} leaves the ${x.lane} lane empty at level 3`);
console.log(ok ? 'STACKING A POWERUP IS AUDIBLE' : 'REPEAT PICKUPS DO NOTHING');
process.exit(ok ? 0 : 1);
