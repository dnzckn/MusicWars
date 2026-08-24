/** Forces a loadout so a screenshot actually shows the new toys. */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');
await p.waitForTimeout(11000);
await p.evaluate(() => {
  const w = window.__musicwars.world;
  for (const [k, d] of [['drones', 24], ['nova', 18], ['magnet', 20], ['spread', 22]]) {
    w.player.addPowerup(k, d);
    w.bus.emit('powerup:pickup', { kind: k, level: 1 });
  }
});
await p.waitForTimeout(5000);
await p.screenshot({ path: 'tools/shot-loadout.png' });
await p.evaluate(() => {
  const w = window.__musicwars.world;
  w.player.addPowerup('overdrive', 8);
  w.bus.emit('powerup:pickup', { kind: 'overdrive', level: 1 });
});
await p.waitForTimeout(3200);
await p.screenshot({ path: 'tools/shot-overdrive.png' });
const st = await p.evaluate(() => {
  const r = window.__musicwars.readout(); const s = window.__musicwars.world.snapshot;
  return { section: r.section, bpm: r.bpm, key: r.key, tension: +r.tension.toFixed(2),
    lead: +r.levels.lead.toFixed(2), notes: window.__musicwars.world.notes.length,
    mult: s.combo, bullets: s.bulletCount, lives: s.lives, hp: s.playerHp };
});
console.log(JSON.stringify(st));
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
