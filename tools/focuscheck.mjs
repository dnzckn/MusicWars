/** Confirms focus concentrates fire rather than merely slowing the ship. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);
const sample = async (focus) => {
  return p.evaluate(async (f) => {
    const w = window.__musicwars.world;
    w.player.powerups.spread = 2;            // widest case, so spread is visible
    w.player.focused = f;
    w.playerBullets.clear();
    const before = w.playerBullets.count;
    void before;
    // Fire one volley by hand through the same path the game uses.
    w.player['fireTimer'] = 0;
    // `Player.update` takes a world RECTANGLE now, not a `{ w, h }` field size:
    // the travel axis is unbounded and the ship is bounded by the track
    // window instead. `{ w, h }` would silently clamp the ship to (NaN, NaN).
    w.player.update(1 / 120, { x: 0, y: 0, shoot: true, focus: f },
      { x0: 12, y0: -Infinity, x1: w.width - 12, y1: w.trackBack, yHome: w.player.y },
      w.playerBullets, () => {});
    const n = w.playerBullets.count;
    let minA = Infinity, maxA = -Infinity, dmg = 0;
    for (let i = 0; i < n; i++) { minA = Math.min(minA, w.playerBullets.angle[i]); maxA = Math.max(maxA, w.playerBullets.angle[i]); dmg = w.playerBullets.damage[i]; }
    return { shots: n, spreadDeg: +(((maxA - minA) * 180) / Math.PI).toFixed(1), damage: +dmg.toFixed(2) };
  }, focus);
};
const wide = await sample(false);
const tight = await sample(true);
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log('unfocused:', JSON.stringify(wide));
console.log('focused  :', JSON.stringify(tight));
const ok = tight.spreadDeg < wide.spreadDeg * 0.3 && tight.damage > wide.damage * 1.3;
console.log(ok ? 'FOCUS CONCENTRATES FIRE' : 'focus not working');
if (!ok) process.exit(1);
