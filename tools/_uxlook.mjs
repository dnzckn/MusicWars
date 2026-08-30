/**
 * _uxlook — scratch. Drive the game and photograph it at native resolution.
 *
 * Not a gate. It exists so a UI change can be LOOKED AT rather than reasoned
 * about: the Browser pane hands back an 800x450 downscale, which is the one
 * resolution at which a legibility question cannot be answered.
 *
 * argv: WxH  seconds  outdir  label  [mode]
 *   mode `dense` forces the crowd up so the busy case is photographed rather
 *   than waited for; `offer` opens the level-up screen with a real build.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { installDriver } from './lib/driver.mjs';

const [size = '1280x720', secs = '30', out = 'shots', label = 'shot', mode = 'play'] =
  process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: W, height: H } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
if (mode === 'title') {
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${label}-title.png` });
  await b.close();
  process.exit(0);
}
await p.click('#start-button');
await p.waitForTimeout(1400);
await p.screenshot({ path: `${out}/${label}-open.png` });
await installDriver(p, 'dodge');

const report = async (tag) => {
  const m = await p.evaluate(() => {
    const w = window.__musicwars.world;
    const s = w.snapshot;
    const on = w.enemies.filter(
      (e) =>
        Math.abs(e.x - w.player.x) < w.viewW / 2 + e.radius &&
        Math.abs(e.y - w.player.y) < w.viewH / 2 + e.radius,
    ).length;
    return { t: Math.round(w.time), wave: s.wave + 1, lvl: s.level, pend: s.pendingOffers, on, alive: w.enemies.length, hp: s.playerHp };
  });
  console.log(`${label}/${tag} t=${m.t}s wave ${m.wave} lv ${m.lvl} banked ${m.pend} on-screen ${m.on} alive ${m.alive} hp ${m.hp}`);
  return m;
};

if (mode === 'dense') {
  // Sit still and let them arrive: the dodging bot kites at 430px/s and never
  // lets the field close, so ordinary driving never photographs the busy case.
  await p.waitForTimeout(20000);
  // Jump to a late wave and stop kiting. `beginWave` is TS-private, which is
  // erased at runtime; the alternative is waiting eight minutes for wave 20.
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.beginWave(22);
    Object.defineProperty(window.__botInput, 'x', { get: () => 0, set: () => {} });
    Object.defineProperty(window.__botInput, 'y', { get: () => 1, set: () => {} });
  });
  await p.waitForTimeout(Number(secs) * 1000);
  const m = await report('dense');
  await p.screenshot({ path: `${out}/${label}-dense-on${m.on}.png` });
  await b.close();
  process.exit(0);
}

if (mode === 'offer') {
  await p.waitForTimeout(Number(secs) * 1000);
  await report('pre');
  await p.evaluate(() => {
    // The driver answers every offer on the frame it opens; pin the answer to
    // "none" so the screen stays up long enough to be photographed.
    Object.defineProperty(window.__botInput, 'choice', { get: () => -1, set: () => {} });
  });
  let st = { choosing: false };
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(400);
    st = await p.evaluate(() => ({ choosing: window.__musicwars.world.choosing }));
    if (st.choosing) break;
  }
  await p.waitForTimeout(1100);
  console.log(`${label}/offer ${JSON.stringify(st)}`);
  await p.screenshot({ path: `${out}/${label}-offer.png` });
  await b.close();
  process.exit(0);
}

const marks = Number(secs);
const step = 15;
let shot = 0;
for (let t = step; t <= marks; t += step) {
  await p.waitForTimeout(step * 1000);
  const m = await report(`t${t}`);
  await p.screenshot({ path: `${out}/${label}-${String(shot).padStart(2, '0')}-t${m.t}-on${m.on}.png` });
  shot++;
}
await b.close();
console.log(`wrote ${out}/${label}-*.png at ${W}x${H}`);
