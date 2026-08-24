/** Confirms enemies can hurt the player on contact, and rushes in particular. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3500);
const r = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const w = mw.world;
  const out = {};

  const trial = async (archetype) => {
    w.enemies.length = 0;
    w.enemyBullets.clear();
    w.player.hp = w.player.maxHp;
    w.player.lives = 4;
    w.player.invuln = 0;
    w.player.bombs = 0;               // no auto-bomb rescue muddying the result
    let hit = 0;
    const off = w.bus.on('player:hit', () => hit++);
    // Park an enemy directly on the ship.
    const mod = await import('/src/game/enemies.ts');
    const e = mod.spawnEnemy(archetype, w.player.x, w.player.y, 0.5, w.player.y, false);
    e.move = () => {};
    e.y = w.player.y;
    e.x = w.player.x;
    w.enemies.push(e);
    await new Promise((r) => setTimeout(r, 900));
    off();
    const survived = e.alive && e.hp > 0;
    w.enemies.length = 0;
    return { hit, enemyDamaged: !survived || e.hp < e.maxHp };
  };

  out.pluck = await trial('pluck');
  out.rush = await trial('rush');
  w.player.bombs = 3;
  return out;
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
const ok = r.pluck.hit > 0 && r.rush.hit > 0 && r.rush.enemyDamaged;
console.log(ok ? 'ENEMIES HURT ON CONTACT, AND TAKE DAMAGE FOR IT' : 'contact damage not working');
if (!ok) process.exit(1);
