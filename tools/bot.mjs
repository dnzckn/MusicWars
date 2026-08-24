/**
 * A bot that actually plays.
 *
 * Every balance number in this project has come from a bot that weaves left and
 * right along the bottom holding fire — a fixed strategy, so every conclusion
 * has really been about that strategy. This one reads the field: it is repelled
 * by bullets on a collision course, attracted to notes and drops when it is
 * safe, focuses when threading, and bombs when boxed in.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const WAVES = (process.env.WAVES ?? '0,6,12,18,24').split(',').map(Number);
const SECONDS = Number(process.env.SECS ?? 30);
const MODE = process.env.MODE ?? 'dodge';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);

await installDriver(p, MODE);

const rows = [];
for (const wave of WAVES) {
  await p.evaluate((wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv);
    w.player.hp = w.player.maxHp;
    w.player.lives = 4;
    w.player.bombs = 3;
    window.__hits0 = 0;
    w.bus.on('player:hit', () => window.__hits0++);
  }, wave);
  await p.waitForTimeout(SECONDS * 1000);
  const r = await p.evaluate(() => {
    const mw = window.__musicwars, s = mw.world.snapshot;
    return { wave: s.wave + 1, hits: window.__hits0 ?? 0, lives: s.lives, score: s.score,
      enemies: s.enemyCount, bullets: s.bulletCount, fps: Math.round(mw.loop.fps) };
  });
  rows.push(r);
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`mode: ${MODE}, ${SECONDS}s per wave`);
console.table(rows);
const totalHits = rows.reduce((a, c) => a + c.hits, 0);
console.log(`total hits taken: ${totalHits}`);
