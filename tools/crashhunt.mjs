/** Long adversarial session hunting for the random black screen. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 5).join('\n')));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
let dir = 'ArrowLeft';
const end = Date.now() + Number(process.env.SECS ?? 90) * 1000;
let i = 0;
while (Date.now() < end) {
  await p.keyboard.down(dir); await p.waitForTimeout(260); await p.keyboard.up(dir);
  dir = dir === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  // Stress every powerup path, bombs, and deaths.
  if (++i % 9 === 0) await p.evaluate(() => {
    const w = window.__musicwars.world;
    const kinds = ['drones','nova','magnet','laser','homing','spread','rapid','blackhole','timewarp','overdrive','bomb','encore'];
    const k = kinds[Math.floor(Math.random() * kinds.length)];
    w.player.addPowerup(k, 12); w.bus.emit('powerup:pickup', { kind: k, level: 1 });
  });
  if (i % 23 === 0) await p.keyboard.press('KeyX');
}
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => ({
  loopErrors: window.__musicwars.loop.errors,
  fps: Math.round(window.__musicwars.loop.fps),
  wave: window.__musicwars.world.snapshot.wave + 1,
  over: window.__musicwars.world.snapshot.gameOver,
}));
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.log(JSON.stringify(r, null, 1));
console.log('\npage errors:', errs.length);
[...new Set(errs)].slice(0, 6).forEach((e) => console.log('---\n' + e));
