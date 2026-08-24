/**
 * How much distinct content does a five-minute run actually show?
 *
 * "Game play feels short, rather uninteresting currently." Short and
 * uninteresting are different complaints and this separates them: how far a run
 * gets, against how much of the game's material it puts in front of you. The
 * game holds 6 enemy archetypes, 8 themes, 4 grooves, 12 powerups and 2 boss
 * variants — if a run only ever meets a third of that, the problem is exposure
 * rather than quantity.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
import { freezePage } from './lib/frozen.mjs';
const MINUTES = Number(process.env.MINUTES ?? 5);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const r = await p.evaluate(async (mins) => {
  const mw = window.__musicwars, w = mw.world;
  const seen = { archetypes: new Set(), grooves: new Set(), keys: new Set(), sections: new Set(), powerups: new Set() };
  let bosses = 0, kills = 0, pickups = 0;
  w.bus.on('enemy:spawn', (e) => seen.archetypes.add(e.archetype));
  w.bus.on('enemy:death', (e) => { if (e.byPlayer) kills++; });
  w.bus.on('boss:defeat', () => bosses++);
  w.bus.on('powerup:pickup', (e) => { seen.powerups.add(e.kind); pickups++; });
  const end = performance.now() + mins * 60000;
  while (performance.now() < end) {
    const rd = mw.readout();
    seen.grooves.add(rd.feel); seen.keys.add(rd.key); seen.sections.add(rd.section);
    // Measure exposure, not survival: a run that ends early tells us about the
    // bot, not about how much material the game holds.
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { wave: w.waveIndex + 1, score: w.score, kills, pickups, bosses,
    archetypes: [...seen.archetypes], grooves: [...seen.grooves], keys: seen.keys.size,
    sections: [...seen.sections], powerups: [...seen.powerups] };
}, MINUTES);
const reloadCount = reloads();
if (reloadCount > 0) console.log(`WARNING: the page reloaded ${reloadCount}x mid-run; these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
const TOTAL = { archetypes: 6, grooves: 4, powerups: 12 };
const pct = (n, d) => `${Math.round((n / d) * 100)}%`;
console.log(`\nin ${MINUTES} minutes: wave ${r.wave}, ${r.bosses} bosses, ${r.kills} kills`);
console.log(`archetypes ${r.archetypes.length}/${TOTAL.archetypes} (${pct(r.archetypes.length, TOTAL.archetypes)})  ` +
  `grooves ${r.grooves.length}/${TOTAL.grooves}  powerups ${r.powerups.length}/${TOTAL.powerups} (${pct(r.powerups.length, TOTAL.powerups)})`);
const thin = [];
if (r.archetypes.length < 4) thin.push(`only ${r.archetypes.length} of 6 archetypes met`);
if (r.powerups.length < 5) thin.push(`only ${r.powerups.length} of 12 powerups seen`);
if (r.bosses < 1) thin.push('no boss defeated');
for (const x of thin) console.log('THIN:', x);
console.log(thin.length ? 'A RUN SHOWS TOO LITTLE OF THE GAME' : 'A RUN SHOWS ITS MATERIAL');
process.exit(thin.length ? 1 : 0);
