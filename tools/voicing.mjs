/**
 * A stacked voice has to be at a different pitch from the voice it is stacked on.
 *
 * `buildLead` stacks its line an octave below itself — the source says why: "a
 * single thin saw line sounds like a test tone, and the octave is what makes it
 * read as a lead" — and adds a descant a sixth above once the multiplier is
 * earned. `buildArp` gives each DRONES satellite its own transposition so, in
 * its own words, "you can count your drones with your ears".
 *
 * None of it sounded. Every one of those voices was written `.add(transpose)`
 * with a bare number, and adding a bare number to a control pattern does
 * nothing: Strudel unions `{note: 77}` with `{value: -12}`, finds no field in
 * common, logs `[warn]: Can't do arithmetic on control pattern` and returns the
 * left side unchanged. A query of the lead returned `[77,77]`, `[80,80]`,
 * `[82,82]` — two voices, one pitch, for the whole life of the project. The
 * warning fired 52 times in twelve seconds, to a console nobody was reading.
 *
 * Every other check in this directory would have passed a broken build:
 * `voicecheck` and `descant` count events and compare levels, `mixaudit`
 * measures loudness, `stacking` counts how many notes a powerup adds — and the
 * note count was right. Only the pitches were wrong.
 *
 * THE CONTROL is the sub, which is deliberately a single voice and must report
 * exactly one distinct pitch per onset. Without it a check that merely counted
 * haps would pass, which is precisely the mistake that let this through.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import { retryOnReload, watchReloads } from './lib/reload.mjs';

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
// Freeze first — `freezePage` mocks Vite's HMR websocket so the reload never
// happens — and keep the retry as a backstop for anything that gets through.
await freezePage(p);
const reloads = watchReloads(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const bootstrap = async () => {
  await p.waitForSelector('#start-button', { timeout: 15000 });
  await p.click('#start-button');
  await p.waitForTimeout(2500);
  await installDriver(p, 'dodge');
};
await bootstrap();

const r = await retryOnReload(p, reloads, bootstrap, async () => {
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.jumpToWave(18);
    w.player.lives = 4;
    // Three DRONES so every satellite voice exists, and a high multiplier so
    // the lead's descant is present too.
    for (let i = 0; i < 3; i++) w.player.addPowerup('drones', 600);
    w.bus.emit('powerup:pickup', { kind: 'drones', level: 3 });
    w.player.combo = 30;
  });
  await p.waitForTimeout(10000);
  /*
   * Re-assert DRONES immediately before sampling.
   *
   * The bot plays properly, which means it collects powerups, and the loadout
   * cap evicts the oldest held kind to make room — so DRONES set up ten seconds
   * earlier was gone by the time the arp was queried, and the check reported the
   * satellites sounding in unison when they were simply not there. The powerup
   * is in the rebuild key, so a fresh pickup rebuilds the arp on the next bar.
   */
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    for (let i = 0; i < 3; i++) w.player.addPowerup('drones', 600);
    w.bus.emit('powerup:pickup', { kind: 'drones', level: 3 });
    w.player.combo = 30;
  });
  await p.waitForTimeout(3500);
  return p.evaluate(() => {
    const d = window.__musicwars.director;
    const out = {};
    for (const id of ['lead', 'arp', 'sub', 'bass']) {
      const haps = d.cache[id].queryArc(0, 8, { _cps: 0.55 }).filter((h) => h.hasOnset?.());
      const byOnset = new Map();
      for (const h of haps) {
        const k = (+h.whole.begin).toFixed(4);
        if (!byOnset.has(k)) byOnset.set(k, new Set());
        if (h.value?.note !== undefined) byOnset.get(k).add(h.value.note);
      }
      const sizes = [...byOnset.values()].map((s) => s.size).filter((n) => n > 0);
      out[id] = {
        onsets: sizes.length,
        maxVoices: sizes.length ? Math.max(...sizes) : 0,
        medVoices: sizes.length ? sizes.sort((a, c) => a - c)[Math.floor(sizes.length / 2)] : 0,
        sample: [...byOnset.entries()].slice(0, 3).map(([k, s]) => `${k}:[${[...s].join(',')}]`),
      };
    }
    out.combo = window.__musicwars.world.player.combo;
    out.drones = window.__musicwars.world.snapshot.powerups.drones ?? 0;
    return out;
  });
});
await b.close();

for (const id of ['lead', 'arp', 'sub', 'bass']) {
  const v = r[id];
  console.log(`${id.padEnd(6)} onsets ${String(v.onsets).padStart(3)}  distinct pitches per onset: median ${v.medVoices}, max ${v.maxVoices}   ${v.sample.join('  ')}`);
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));

if (r.sub.onsets === 0) {
  console.log('\nCONTROL UNAVAILABLE: the sub played nothing, so the single-voice reference is missing. Re-run.');
  process.exit(2);
}
if (r.sub.maxVoices !== 1) {
  console.log(`\nCONTROL FAILED: the sub is one voice and reported ${r.sub.maxVoices} distinct pitches per onset. This check is counting something other than pitch; ignore the rows above.`);
  process.exit(2);
}
const fail = [];
if (r.lead.onsets === 0) fail.push('the lead played nothing at all');
else if (r.lead.maxVoices < 2) fail.push(`the lead stacks an octave and a descant but sounds ${r.lead.maxVoices} pitch per onset`);
// The arp only stacks when DRONES is held, and it is faded by the arrangement,
// so a silent arp is reported rather than failed.
if (r.arp.onsets === 0) console.log('\nnote: the arp was faded out during the window, so its drone voices were not exercised.');
else if (r.drones < 1) console.log(`\nnote: DRONES was not held at sample time (level ${r.drones}), so the arp's satellite voices were not exercised.`);
else if (r.arp.maxVoices < 3) fail.push(`DRONES level ${r.drones} should give the arp several transposed voices; it sounds ${r.arp.maxVoices} pitches`);

console.log(`\ncontrol passed: the sub, a single voice, reports exactly 1 pitch per onset.`);
if (fail.length) {
  console.log(`\n>>> STACKED VOICES ARE SOUNDING IN UNISON: ${fail.join('; ')} <<<`);
  process.exit(1);
}
console.log('\nSTACKED VOICES SOUND AT DIFFERENT PITCHES');
