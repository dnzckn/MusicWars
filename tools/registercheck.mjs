/** Confirms flying up the screen lifts the melody's register. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(9000);

const at = async (frac, label) => {
  const notes = await p.evaluate(async (f) => {
    const mw = window.__musicwars;
    mw.world.player.y = mw.world.height * f;
    mw.world.player.x = mw.world.width * 0.5;
    // Hold position while the director rebuilds on the next bar.
    const hold = setInterval(() => { mw.world.player.y = mw.world.height * f; }, 16);
    await new Promise((r) => setTimeout(r, 5200));
    clearInterval(hold);
    const bar = mw.director.sampleBar(mw.world.transport);
    const pitched = bar.lead.map((n) => n.n).filter((n) => typeof n === 'number');
    // The register offset is the mechanism; the sampled notes also carry the
    // theme's own contour, which varies bar to bar and would otherwise be
    // mistaken for the effect under test.
    return { median: pitched.sort((a, c) => a - c)[Math.floor(pitched.length / 2)] ?? null,
             count: pitched.length, register: mw.readout().leadRegister };
  }, frac);
  console.log(`${label.padEnd(14)} register ${String(notes.register).padStart(3)}  median note ${notes.median}  (${notes.count} notes)`);
  return notes.register;
};

const low = await at(0.94, 'bottom');
const high = await at(0.06, 'top');
const mid = await at(0.5, 'middle');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`\nregister — bottom ${low}, middle ${mid}, top ${high}`);
const ok = low === 0 && high === 12;
console.log(ok ? 'THE MELODY CLIMBS WITH THE PLAYER' : 'register not responding');
if (!ok) process.exit(1);
