/** Confirms the player's shots walk the current chord and reset after a gap. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(5000);
const r = await p.evaluate(async () => {
  const mod = await import('/src/audio/sfx.ts');
  const mw = window.__musicwars;
  const chord = mw.director.currentChordNotes();
  const burst = [];
  for (let i = 0; i < 8; i++) burst.push(mod.sfxShoot(chord, false));
  // Wait past the reset window, then fire again.
  await new Promise((r) => setTimeout(r, 700));
  const afterGap = mod.sfxShoot(chord, false);
  const focused = mod.sfxShoot(chord, true);
  return { chord, burst, afterGap, focused };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('chord      :', r.chord.join(', '));
console.log('held fire  :', r.burst.join(' -> '));
console.log('after gap  :', r.afterGap, '(should equal the first note of the burst)');
console.log('focused    :', r.focused, '(an octave below the unfocused equivalent)');

const tones = r.chord;
const expected = [...tones, ...tones.map((n) => n + 12)].map((n) => n + 24);
const walks = r.burst.every((n, i) => n === expected[i % expected.length]);
const resets = r.afterGap === expected[0];
const ok = walks && resets;
console.log(ok ? 'THE WEAPON PLAYS THE CHORD' : 'shot pitches do not follow the chord');
if (!ok) process.exit(1);
