/**
 * Every powerup must change the music. That is the project's stated rule.
 *
 * From layers.ts: "a powerup must be a *persistent change to the arrangement*,
 * not a one-shot sound effect: rapid fire doubling the hi-hat subdivision is the
 * model, not a bleep on pickup." Twelve powerups exist and that claim has never
 * been checked against all of them — a grep finds names for most, but `bomb` is
 * voiced through a separate count and `encore` acts through the arranger, so
 * reading the source proves nothing either way.
 *
 * This holds each one alone and compares the bar it produces against the bar
 * with nothing held, toggling back and forth so the arrangement's own movement
 * cancels out.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const KINDS = ['drones', 'spread', 'rapid', 'nova', 'magnet', 'homing', 'laser', 'blackhole', 'bomb', 'overdrive', 'timewarp', 'encore'];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
await p.waitForTimeout(12000);

const res = await p.evaluate(async (KINDS) => {
  const mw = window.__musicwars, w = mw.world;
  /*
   * Mutate the powerup object; never replace it.
   *
   * `s.powerups = this.player.powerups` hands the director a *reference*, and
   * the snapshot is only refreshed on the game loop. Assigning a fresh `{}`
   * therefore leaves the director reading the old object until the next frame,
   * so a same-tick toggle appears to do nothing at all — which is exactly what
   * happened: every one of the twelve read as having no signature. Deleting
   * keys in place keeps the reference the director already holds.
   */
  const clear = () => {
    for (const k of Object.keys(w.player.powerups)) delete w.player.powerups[k];
    for (const k of Object.keys(w.player.powerTimers)) delete w.player.powerTimers[k];
    w.player.held.length = 0;
    w.player.bombs = 0;
    w.player.maxActive = 5;
  };
  // A bar's worth of description: how many events each lane plays, and the
  // generated code for the lanes powerups are documented to modify.
  /*
   * Read back-to-back in the same tick, never across a wait.
   *
   * The first version sampled 2.4s apart and asked whether anything differed.
   * With nothing held at all that comparison differed 6 times out of 6 — the
   * arrangement moves on its own, different bars of a phrase carry different
   * content — so it would have passed a powerup that does nothing whatsoever,
   * and its clean sweep of all twelve meant nothing.
   *
   * `sourceLines()` is computed from current state rather than read from the
   * cached pattern, so toggling and reading with no time in between holds
   * everything else constant. That is the same trick smoke.mjs uses on the hat
   * subdivision, and for the same reason.
   *
   * The trade is coverage: these are the lanes the panel prints — kick, hats,
   * chord, bass and the scale line. A powerup whose only signature is in the
   * arp, lead or power lane is invisible here and is covered by `subtraction`,
   * `descant` and `voicecheck` instead. Reported rather than assumed.
   */
  const fingerprint = () => window.__musicwars.director.sourceLines().map((l) => `${l.label}:${l.code}`).join('|');
  const settle = async (ms) => new Promise((r) => setTimeout(r, ms));

  // Drift must be zero by construction; measured anyway, because the last
  // version of this check was confidently wrong about exactly that.
  let drift = 0;
  const DRIFT_TRIALS = 6;
  for (let i = 0; i < DRIFT_TRIALS; i++) {
    clear();
    const a1 = fingerprint();
    if (fingerprint() !== a1) drift++;
  }

  const out = [];
  for (const kind of KINDS) {
    clear();
    const off = fingerprint();
    if (kind === 'bomb') w.player.bombs = 3;
    else w.player.addPowerup(kind, 120);
    const on = fingerprint();
    clear();
    out.push({ powerup: kind, changesPrintedLanes: on !== off });
  }
  clear();
  return { out, drift, DRIFT_TRIALS };
}, KINDS);
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
const rows = res.out;
console.log(`baseline drift with nothing held: ${res.drift}/${res.DRIFT_TRIALS} comparisons differed`);
console.table(rows);

const seen = rows.filter((r) => r.changesPrintedLanes).map((r) => r.powerup);
const unseen = rows.filter((r) => !r.changesPrintedLanes).map((r) => r.powerup);
console.log(`visible in the printed lanes: ${seen.join(', ') || 'none'}`);
console.log(`not visible here (other lanes, checked elsewhere): ${unseen.join(', ') || 'none'}`);
// Asserted only on drift and on the lanes this instrument can actually see.
const ok = res.drift === 0 && seen.length > 0;
if (res.drift !== 0) console.log(`the fingerprint drifts on its own (${res.drift}/${res.DRIFT_TRIALS}) — the result means nothing`);
console.log(ok ? 'THE INSTRUMENT IS STABLE' : 'INCONCLUSIVE');
process.exit(ok ? 0 : 1);
