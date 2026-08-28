/**
 * Time-to-kill per archetype, and the player's damage per second.
 *
 * Needed as a baseline before enemy hp goes up: the player's weapon lives in
 * player.ts and the roster in enemies.ts, and those are being changed by
 * different hands. If enemy hp rises without this number in view, "tougher"
 * turns into "spongy" — the same encounter, just longer, which is the failure
 * mode of every difficulty patch that only edits one side.
 *
 * Measured by parking a single enemy of each type in front of a firing ship,
 * rather than inferred from hp/damage constants, because drones, spread and
 * focus all change what actually lands.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const TYPES = ['stutter', 'pluck', 'rush', 'arpeggiator', 'echo', 'subdrop'];
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);
const rows = await p.evaluate(async (TYPES) => {
  const w = window.__musicwars.world;
  const out = [];
  /*
   * THE TEST PAIR IS A FIXED PIXEL SEPARATION, NOT A FRACTION OF THE FIELD.
   *
   * This read `w.player.y = w.height * 0.8` and `target.y = w.height * 0.35`.
   * Time-to-kill is distance-sensitive — bullets have travel time and a spread
   * weapon widens with range — so a separation defined as 45% of the field
   * height makes TTK a property of the ARENA SIZE. Grow the field and every
   * number in this table moves with no weapon change at all, which is exactly
   * the silent re-baseline a field refactor must not be allowed to hide behind.
   *
   * The two offsets below reproduce today's 900x1120 positions EXACTLY
   * (560 + 336 = 896 = 1120*0.8; 896 - 504 = 392 = 1120*0.35), so this is a
   * numeric no-op right now and the historical readings stay comparable. They
   * are anchored to the field CENTRE rather than the bottom edge so that on a
   * larger arena the pair still sits where the game is played instead of being
   * pinned against a far wall.
   */
  const SEPARATION = 504;                 // px between ship and target
  const SHIP_Y = w.height / 2 + 336;      // px below the field centre
  const TARGET_Y = SHIP_Y - SEPARATION;
  const LANE_X = w.width / 2;             // both on one vertical line
  /*
   * `standoff` is the radius the archetype holds at (enemies.ts:680), and it
   * was `w.height * 0.35` = 392 — a third field-scaled px quantity, and one
   * that does not even equal SEPARATION. The mismatch is harmless here because
   * the loop below re-pins the target's position every 50ms, so the archetype's
   * own hold behaviour never gets to act. Pinned at 392 to keep this a no-op;
   * it is not a claim that 392 is the right radius.
   */
  const STANDOFF = 392;
  for (const t of TYPES) {
    w.enemies.length = 0;
    w.player.x = LANE_X; w.player.y = SHIP_Y;
    w.player.invuln = 999;
    // Park one directly above the ship so every shot connects.
    const e = w.spawnOne ? w.spawnOne(t) : null;
    if (!e) {
      const mod = await import('/src/game/enemies.ts');
      const spawned = mod.spawnEnemy(t, LANE_X, TARGET_Y, 0.5, STANDOFF, false);
      w.enemies.push(spawned);
    }
    const target = w.enemies[0];
    if (!target) { out.push({ archetype: t, error: 'could not spawn' }); continue; }
    target.x = LANE_X; target.y = TARGET_Y;
    const hp0 = target.hp;
    window.__botInput = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false };
    const t0 = performance.now();
    while (w.enemies.includes(target) && performance.now() - t0 < 20000) {
      target.x = LANE_X; target.y = TARGET_Y;
      target.hitFlash = target.hitFlash;
      await new Promise((r) => setTimeout(r, 50));
    }
    const secs = (performance.now() - t0) / 1000;
    out.push({ archetype: t, hp: hp0, seconds: +secs.toFixed(2), dps: +(hp0 / secs).toFixed(1),
      speed: +(target.speed ?? 0).toFixed(0) });
  }
  window.__botInput = null;
  w.player.invuln = 0;
  return out;
}, TYPES);
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows);
const killed = rows.filter((r) => r.seconds !== undefined && r.seconds < 19);
if (killed.length) {
  const dps = killed.reduce((a, r) => a + r.dps, 0) / killed.length;
  console.log(`mean player dps against a stationary target: ${dps.toFixed(1)}`);
  console.log(`time-to-kill range: ${Math.min(...killed.map((r) => r.seconds)).toFixed(2)}s - ${Math.max(...killed.map((r) => r.seconds)).toFixed(2)}s`);
}
