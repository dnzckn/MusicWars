/* Is the current tree actually playable? Boot, play, level up, warp, check state. */
import { chromium } from 'playwright';

const b = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-gl=angle', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 150)); });

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const title = await p.evaluate(() => !!document.getElementById('start-button'));
await p.click('#start-button');

// Play, spending level-ups as they bank.
let dir = 'ArrowRight';
for (let i = 0; i < 40; i++) {
  await p.keyboard.down(dir);
  await p.waitForTimeout(280);
  await p.keyboard.up(dir);
  if (i % 6 === 5) { await p.keyboard.press('Space'); await p.waitForTimeout(220); await p.keyboard.press('Digit1'); }
  dir = dir === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
}

const mid = await p.evaluate(() => {
  const w = window.__musicwars.world;
  return { wave: w.waveIndex + 1, level: w.progression.level, score: w.score, alive: w.enemies.length, victory: !!w.victory };
});

// Latch warp and let it run.
await p.keyboard.down('KeyW');
await p.waitForTimeout(2200);
await p.keyboard.up('KeyW');
await p.waitForTimeout(12000);

const warped = await p.evaluate(() => {
  const w = window.__musicwars.world;
  return { warping: !!w.warping, wave: w.waveIndex + 1, alive: w.enemies.length, victory: !!w.victory, phase: w.phase };
});

const f = await p.evaluate(() => new Promise((res) => {
  const t = []; let last = performance.now(); const end = last + 2500;
  const tick = () => { const n = performance.now(); t.push(n - last); last = n;
    if (n < end) requestAnimationFrame(tick); else { t.sort((a, b) => a - b); res(t[t.length >> 1]); } };
  requestAnimationFrame(tick);
}));

await p.screenshot({ path: 'renders/shots/playable.png' });
console.log('title screen  :', title ? 'renders' : 'MISSING');
console.log('after play    :', JSON.stringify(mid));
console.log('after warp    :', JSON.stringify(warped));
console.log('frame         :', f.toFixed(2) + 'ms = ' + (1000 / f).toFixed(1) + 'fps');
console.log('errors        :', errs.length ? errs.slice(0, 3) : '(none)');
await b.close();
