/**
 * What a player actually hears over a long, uninterrupted run.
 *
 * Generative game music fails by repetition long before it fails by any single
 * bad sound: ten minutes of the same groove in the same key is boring however
 * well mixed it is. This plays straight through — no wave jumping, because
 * jumping is what made an earlier reading say "2 grooves" when the cycle has
 * four — and reports the distribution, not just the count.
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
  const mw = window.__musicwars;
  const keys = {}, grooves = {}, sections = {}, modes = {}, tension = {}, energy = {};
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  const end = performance.now() + mins * 60000;
  let n = 0;
  while (performance.now() < end) {
    const rd = mw.readout();
    bump(keys, rd.key); bump(grooves, rd.feel); bump(sections, rd.section); bump(modes, rd.key.split(' ')[1] ?? '?');
    // Tension drives modes, sections and every stem fader, so its own
    // distribution explains all of theirs.
    bump(tension, Math.min(9, Math.floor(rd.tension * 10)));
    bump(energy, Math.min(9, Math.floor(rd.energy * 10)));
    // Keep the run alive: this measures the music, not the bot's survival.
    mw.world.player.lives = Math.max(3, mw.world.player.lives);
    n++;
    await new Promise((r) => setTimeout(r, 250));
  }
  const pct = (o) => Object.fromEntries(Object.entries(o).sort((a, c) => c[1] - a[1]).map(([k, v]) => [k, +((v / n) * 100).toFixed(0)]));
  const decile = (o) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`0.${i}`, +(((o[i] ?? 0) / n) * 100).toFixed(0)]));
  return { samples: n, wave: mw.world.waveIndex + 1, keys: pct(keys), grooves: pct(grooves), sections: pct(sections), modes: pct(modes),
    tensionByDecile: decile(tension), energyByDecile: decile(energy) };
}, MINUTES);
const reloadCount = reloads();
if (reloadCount > 0) console.log(`WARNING: the page reloaded ${reloadCount}x mid-run; these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));

/*
 * The bar is "no single thing dominates", not "everything is equal". A home
 * groove that plays half the time is a structure; one that plays 90% of the
 * time is a rut. Same for keys.
 */
const top = (o) => Math.max(...Object.values(o));
const problems = [];
if (top(r.grooves) > 70) problems.push(`one groove for ${top(r.grooves)}% of the run`);
if (top(r.keys) > 70) problems.push(`one key for ${top(r.keys)}% of the run`);
if (Object.keys(r.grooves).length < 3) problems.push(`only ${Object.keys(r.grooves).length} grooves heard`);
if (Object.keys(r.keys).length < 3) problems.push(`only ${Object.keys(r.keys).length} keys heard`);
if (top(r.sections) > 75) problems.push(`stuck in ${Object.entries(r.sections).sort((a, c) => c[1] - a[1])[0][0]}`);

/*
 * The bright end of the mode ladder has to be heard.
 *
 * Dorian and aeolian are the two usable-sounding modes; phrygian through
 * octatonic are the menace colours. A run measured 83% in the dark four with
 * dorian never appearing once, which is the harmonic version of the mix running
 * at full throttle the whole time — the palette existed and the player never
 * met half of it. 20% is a floor, not a target.
 */
const bright = (r.modes.dorian ?? 0) + (r.modes.aeolian ?? 0);
console.log(`bright modes (dorian + aeolian): ${bright}% of the run`);
/*
 * Two conditions, because the share alone is too variable to gate on: it has
 * measured 18%, 31% and 35% across runs of the same build. The defect this
 * exists to catch was sharper than a percentage — dorian was heard *zero*
 * times in a five-minute run, the bright end of the palette simply absent. So
 * require that it appears at all, and keep a loose floor under the share.
 */
if (!(r.modes.dorian > 0)) problems.push('dorian never appears');
if (bright < 12) problems.push(`only ${bright}% of the run in a bright mode`);
if (top(r.modes) > 55) problems.push(`one mode for ${top(r.modes)}% of the run`);

/*
 * The quiet sections have to exist.
 *
 * The arrangement spent 70% of a run in the drop against 5% in a breakdown,
 * which is the "it constantly full throttles all sound type channels" complaint
 * expressed as structure rather than as levels: a drop that never ends is just
 * the volume knob. The cause was the arranger's thresholds having been tuned
 * against a tension signal that could not exceed 0.5, so its exits were
 * unreachable once tension was fixed. Now asserted, because it regressed
 * silently once already.
 */
const quiet = (r.sections.breakdown ?? 0) + (r.sections.sustain ?? 0);
console.log(`sections: drop ${r.sections.drop ?? 0}%, quiet (breakdown + sustain) ${quiet}%`);
if ((r.sections.drop ?? 0) > 60) problems.push(`the drop holds ${r.sections.drop}% of the run`);
if (quiet < 10) problems.push(`only ${quiet}% of the run is a quiet section`);
for (const x of problems) console.log('NARROW:', x);
console.log(problems.length ? 'THE RUN REPEATS ITSELF' : 'THE RUN KEEPS MOVING');
process.exit(problems.length ? 1 : 0);
