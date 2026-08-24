/**
 * Does a run have an arc? Does the player get measurably stronger?
 *
 * Every powerup expires, so before this the player at wave 20 was exactly as
 * capable as the player at wave 4 while facing several times the pressure — the
 * difficulty curve rose and the player's did not. Beating a boss now widens the
 * loadout permanently, which is also the one reward that shows up in the music:
 * each held powerup voices its own signature.
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
const r = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  const marks = [];
  let bosses = 0;
  w.bus.on('boss:defeat', () => { bosses++; marks.push({ bosses, slots: w.player.maxActive }); });
  const start = w.player.maxActive;
  let heldPeak = 0;
  const end = performance.now() + 420000;
  while (performance.now() < end && bosses < 3) {
    heldPeak = Math.max(heldPeak, Object.values(w.snapshot.powerups).filter((v) => v > 0).length);
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 200));
  }
  /*
   * The panel must show exactly as many chips as there are slots.
   *
   * The loadout row grew an empty-slot chip per free slot so the boss reward is
   * visible, and for a while it also kept the older "none" placeholder — so an
   * empty loadout read "none" followed by four empty slots, the same fact twice.
   */
  const chips = document.querySelectorAll('#ui-powerups li').length;
  const held = Object.values(w.snapshot.powerups).filter((v) => v > 0).length;
  return { start, end: w.player.maxActive, bosses, marks, heldPeak, wave: w.waveIndex + 1,
    chips, slots: w.player.maxActive, chipsMatchSlots: chips === w.player.maxActive || held > w.player.maxActive };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
const grew = r.end > r.start;
const capped = r.end <= 5;
if (!r.bosses) console.log('no boss was defeated in the budget — cannot tell');
if (!grew && r.bosses) console.log('beating a boss did not widen the loadout');
if (!capped) console.log(`loadout ran past its ceiling: ${r.end}`);
if (!r.chipsMatchSlots) console.log(`the loadout row shows ${r.chips} chips for ${r.slots} slots`);
const ok = r.bosses > 0 && grew && capped && r.chipsMatchSlots;
console.log(ok ? 'THE RUN HAS AN ARC' : 'NO PERMANENT PROGRESSION');
process.exit(ok ? 0 : 1);
