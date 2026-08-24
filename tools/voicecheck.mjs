/**
 * Confirms voice leading actually reduces chord movement.
 *
 * Two things about this file are worth knowing.
 *
 * It used to build its chords itself, from `PROGRESSIONS.aeolian[i % length]`
 * as a bare degree. When the progressions became spans — a degree AND how many
 * bars it lasts — that read an array where it wanted a number and every pitch
 * in the table came out `NaN`, which it reported as "voice leading not
 * effective". It now asks `chordForBar` for the chord, which is the function
 * the director calls, so it cannot drift from the thing it is measuring again.
 *
 * And it used to print its verdict and exit 0 no matter what it saw, so it
 * would have passed in any automated gate however badly the harmony behaved —
 * including on the NaN run above. It fails now.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const t = await p.evaluate(async () => {
  const T = await import('/src/audio/theory.ts');
  const L = await import('/src/audio/layers.ts');
  const prog = T.PROGRESSIONS.aeolian;
  const raw = [], led = [];
  let prev = [];
  for (let bar = 0; bar < 8; bar++) {
    const c = L.chordForBar(57, 'aeolian', prog, bar);
    raw.push(c.notes);
    const v = T.voiceLead(prev, c);
    led.push(v.notes);
    prev = v.notes;
  }
  const move = (list) => {
    let total = 0;
    for (let i = 1; i < list.length; i++) {
      for (const n of list[i]) {
        let d = Infinity;
        for (const q of list[i - 1]) d = Math.min(d, Math.abs(n - q));
        total += d;
      }
    }
    return total;
  };
  return { rawMove: move(raw), ledMove: move(led), rawFirst: raw.slice(0, 3), ledFirst: led.slice(0, 3) };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('total semitone movement across 8 chords');
console.log('  root position :', t.rawMove);
console.log('  voice led     :', t.ledMove, `(${((1 - t.ledMove / t.rawMove) * 100).toFixed(0)}% less movement)`);
console.log('  before:', JSON.stringify(t.rawFirst));
console.log('  after :', JSON.stringify(t.ledFirst));
const ok = Number.isFinite(t.ledMove) && Number.isFinite(t.rawMove) && t.rawMove > 0 && t.ledMove < t.rawMove * 0.5;
console.log(ok ? 'VOICE LEADING REDUCES MOVEMENT' : 'voice leading not effective');
process.exit(ok ? 0 : 1);
