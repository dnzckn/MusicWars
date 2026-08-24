/**
 * Confirms wave grade colours the harmony.
 *
 * Independent page loads per grade: run them in one session and the second
 * measurement inherits the first's mode bias, tonic and energy, which produced
 * a confident backwards result the first time I wrote this.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const LADDER = ['dorian', 'aeolian', 'phrygian', 'phrygianDominant', 'locrian', 'octatonic'];

const measure = async (grade) => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
  const p = await b.newPage();
  const __reloads = await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(4000);
  const r = await p.evaluate(async (g) => {
    const mw = window.__musicwars;
    /*
     * Re-assert the grade each tick.
     *
     * The real game clears its own waves during the measurement window and
     * overwrites the bias with whatever grade the player actually earned — an
     * earlier version of this test emitted once, got silently overridden at
     * bar 5, and reported a confident null result.
     */
    const hold = setInterval(() => {
      mw.world.bus.emit('wave:clear', { index: 1, grade: g, peakMultiplier: 20, damageTaken: g === 'rough' ? 2 : 0 });
    }, 300);
    /*
     * Sample at the FIRST phrase boundary after the event.
     *
     * The bias decays by 0.72 every phrase, so averaging across a long window
     * blends the two grades back together — an earlier version of this test
     * reported identical means for both and looked like a null result. The mode
     * only moves on phrase boundaries, so watch the phrase index and read once.
     */
    const phraseOf = () => Math.floor(mw.readout().bar / 8);
    const startPhrase = phraseOf();
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (phraseOf() > startPhrase) {
        clearInterval(hold);
        return [mw.readout().key.split(' ')[1]];
      }
    }
    clearInterval(hold);
    return [mw.readout().key.split(' ')[1]];
  }, grade);
  await b.close();
  const idxs = r.map((m) => LADDER.indexOf(m)).filter((i) => i >= 0);
  const mean = idxs.reduce((a, c) => a + c, 0) / Math.max(1, idxs.length);
  const modes = [...new Set(r)].join(', ');
  console.log(`${grade.padEnd(8)} -> mean ladder index ${mean.toFixed(2)}  (saw: ${modes})`);
  return mean;
};

const perfect = await measure('perfect');
const rough = await measure('rough');
const ok = rough > perfect;
console.log(ok ? `GRADE COLOURS THE HARMONY (perfect ${perfect.toFixed(2)} < rough ${rough.toFixed(2)})` : 'no harmonic response to grade');
if (!ok) process.exit(1);
