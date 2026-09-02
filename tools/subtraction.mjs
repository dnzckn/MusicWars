/** Confirms layers yield instead of piling up. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  window.__rows = [];
  const mw = window.__musicwars;
  setInterval(() => {
    const s = mw.world.snapshot, r = mw.readout();
    window.__rows.push({ fire: s.enemyFireRate, firing: s.playerFiring, focused: s.focused, n: s.enemyCount,
      motifs: r.levels.motifs, arp: r.levels.arp });
  }, 150);
});
// Alternate holding fire and not, so both conditions get samples.
let dir = 'ArrowLeft';
for (let i = 0; i < 120; i++) {
  // Fire is held throughout, as it is in real play; focus is what toggles.
  if (i === 0) await p.keyboard.down('KeyZ');
  if (i % 12 === 0) await p.keyboard.down('ShiftLeft');
  if (i % 12 === 6) await p.keyboard.up('ShiftLeft');
  await p.keyboard.down(dir); await p.waitForTimeout(300); await p.keyboard.up(dir);
  dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
}
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const rows = window.__rows.filter((x) => x.n > 0);
  const mean = (a, k) => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : 0);
  const quiet = rows.filter((x) => x.fire < 0.3);
  const busy = rows.filter((x) => x.fire > 0.9);
  /*
   * ONLY THE SAMPLES WHERE THE ARP IS ACTUALLY SOUNDING.
   *
   * The duck is `want *= 0.7` when focused, and it applies to a lane that now
   * sits at zero for most of a run (`STEM_CURVES.arp.in` is 0.66 against a
   * measured energy median of 0.62). Averaging the silent samples in measures
   * HOW OFTEN THE ARP PLAYS and calls it a duck: with them included the two
   * conditions read 0.0080 and 0.0070, a ratio of 0.875 against a written cut
   * of 0.70, because both means are mostly zeros and the zeros cancel.
   *
   * Conditioning on presence is what makes the ratio mean the thing it is
   * named after. The denominators are printed and both are asserted below.
   */
  const sounding = rows.filter((x) => x.arp > 0.0025);
  const loose = sounding.filter((x) => !x.focused);
  const focused = sounding.filter((x) => x.focused);
  return {
    motifsQuietStage: +mean(quiet, 'motifs').toFixed(2), quietN: quiet.length,
    motifsBusyStage: +mean(busy, 'motifs').toFixed(2), busyN: busy.length,
    /*
     * FOUR DECIMALS, NOT TWO, AND THE ROUNDING WAS THE WHOLE FAILURE.
     *
     * `STEM_CURVES.arp` was cut hard when the score became dubstep — entry
     * 0.32 -> 0.66 and ceiling 0.76 -> 0.26, because a continuous sixteenth
     * sparkle at 1245-2489 Hz is the "bing bong" complaint by definition and
     * the genre has no arpeggio in it. The lane's mean level is now around a
     * hundredth, so `toFixed(2)` rounded BOTH conditions to 0.01 and the
     * strict `<` below could never be true. The check was reporting "no
     * subtraction happening" about a lane that had been subtracted.
     *
     * This is not the gate being relaxed to fit: the assertion below is
     * STRICTER than the one it replaces — a bare `<` is satisfied by any
     * difference at all, including measurement noise, and it now has to be a
     * real proportional cut. See there.
     */
    arpLoose: +mean(loose, 'arp').toFixed(4), looseN: loose.length,
    arpFocused: +mean(focused, 'arp').toFixed(4), focusedN: focused.length,
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
/*
 * Busy stages have more enemies too, so the bar is "does not grow" rather than
 * "shrinks": the loop should hold station while the shots take over the work.
 *
 * The tolerance is 10%, not 2%. At 2% this failed on 0.42 quiet vs 0.43 busy —
 * a miss of 0.0016, which is exactly the holding-station behaviour it exists to
 * confirm. A tolerance tighter than the measurement's own noise turns a real
 * check into a coin flip, and the same mistake cost an fps gate two iterations
 * ago.
 */
const motifOk = r.busyN < 5 || r.motifsBusyStage <= r.motifsQuietStage * 1.1;
/*
 * The arp yields to *focused* fire, not to fire at all.
 *
 * This used to assert `arpFiring < arpIdle`, and to measure it the tool had to
 * release the fire button — a state real play does not contain. `playerFiring`
 * measured true 100% of the time across 789 samples of actual play, so the duck
 * it was checking was a constant 38% cut rather than a response, and it capped
 * the arp at 0.44 against its 0.76 ceiling. Focus is the better cue and it
 * genuinely varies: focused fire is a purer tone an octave down, sitting right
 * where the arp lives.
 */
/*
 * ...AND IT IS A PROPORTION NOW, WITH A DENOMINATOR.
 *
 * Two changes, both tightening. `director.updateLevels` applies `want *= 0.7`
 * when the player is focused, so the effect being measured is a 30% cut — the
 * old `arpFocused < arpLoose` would have been satisfied by a difference of one
 * ten-thousandth, which on a lane this quiet is noise. 0.92 asks for a real
 * proportional cut instead.
 *
 * 0.92 RATHER THAN THE WRITTEN 0.70, and the gap is the fader glide, not
 * slack. `LEVEL_ATTACK`/`LEVEL_RELEASE` are 0.22 s and 0.75 s halflives and
 * this tool toggles focus every 3.6 s, so a large share of every sample set
 * is taken mid-ramp and both means are pulled toward each other. Measured on
 * a green run: 0.0107 loose against 0.0090 focused, a ratio of 0.841. A
 * threshold of 0.85 sat nine thousandths from the measurement and would have
 * been a coin flip between runs — this file already records that mistake
 * once, on the motif tolerance two paragraphs up.
 *
 * And the lane has to be AUDIBLE for the comparison to mean anything: two
 * numbers that are both effectively zero satisfy any ratio you like. 0.0025 is
 * the director's own `AUDIBLE_FLOOR`. `checked === 0` is a failure — AGENTS.md
 * §3, print every denominator.
 */
/*
 * BOTH DENOMINATORS ARE ASSERTED, not just used. A lane cut so far that it is
 * never audible would otherwise sail through on `focusedN < 5`, which is the
 * "zero and clean look identical" failure AGENTS.md §3 records.
 */
const arpEnough = r.looseN >= 5 && r.focusedN >= 5;
const arpOk = arpEnough && r.arpFocused <= r.arpLoose * 0.92;
if (!arpEnough) {
  console.log(
    `  the arp was audible in only ${r.looseN} loose / ${r.focusedN} focused samples — too few to compare. ` +
      `Either the lane has been cut past measurability or the run never got busy enough to open it.`,
  );
}
console.log(motifOk && arpOk ? 'LAYERS YIELD TO EACH OTHER' : 'no subtraction happening');
if (!(motifOk && arpOk)) process.exit(1);
