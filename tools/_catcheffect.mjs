/* Screenshot the exact frame an on-hit line effect exists. */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button').catch(() => {});
await p.waitForTimeout(600);
await installDriver(p, 'weave');
await p.waitForTimeout(4000);
for (const id of ['feedback', 'bow', 'timpani', 'accelerando', 'gravel']) {
  await p.evaluate((id) => {
    const w = window.__musicwars.world;
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    w.progression.instruments[id] = 3;
    w.jumpToWave?.(16);
  }, id);
  await p.waitForTimeout(4000);
  let got = false;
  for (let i = 0; i < 240 && !got; i++) {
    got = await p.evaluate(() => {
      const w = window.__musicwars.world;
      return w.effects.length > 0 || w.novas.length > 0;
    });
    if (!got) await p.waitForTimeout(30);
  }
  console.log(id, got ? 'caught' : 'NOT CAUGHT');
  await p.screenshot({ path: `tools/_shots20/fx-${id}.png` });
}
await b.close();
