import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args:['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport:{width:1280,height:720} });
await p.goto('http://localhost:5173/', { waitUntil:'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(1400);
await installDriver(p, 'dodge');
await p.waitForTimeout(12000);
await p.evaluate(() => { window.__musicwars.world.beginWave(20); });
const r = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  const s = [];
  let levels = 0, last = w.snapshot.level, tot = 0; const t0 = w.player.grazeTotal;
  const id = setInterval(() => {
    s.push(w.player.grazeRate); tot = w.player.grazeTotal;
    if (w.snapshot.level > last) { levels++; last = w.snapshot.level; }
  }, 50);
  await new Promise((r) => setTimeout(r, 30000));
  clearInterval(id);
  s.sort((a, b) => a - b);
  const q = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  return { grazes: tot - t0, n: s.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length-1], zero: s.filter((v)=>v<=0.02).length, levels };
});
console.log(`grazes ${r.grazes} | grazeRate over ${r.n} samples: p50 ${r.p50.toFixed(2)} p90 ${r.p90.toFixed(2)} p99 ${r.p99.toFixed(2)} max ${r.max.toFixed(2)}; halo dark on ${(r.zero/r.n*100).toFixed(1)}% of samples; ${r.levels} level-ups in 30s`);
await b.close();
