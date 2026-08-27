/* A/B the substrate's frame cost: the same wave, the same seed, one loadout
 * carrying properties and one carrying none. */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button').catch(() => {});
await p.waitForTimeout(600);
await installDriver(p, 'weave');
await p.waitForTimeout(4000);

async function measure(ids, label) {
  const r = await p.evaluate(async ([ids, label]) => {
    const w = window.__musicwars.world;
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    for (const id of ids) w.progression.instruments[id] = 3;
    w.jumpToWave?.(24);
    await new Promise((r) => setTimeout(r, 6000));
    const samples = [];
    for (let pass = 0; pass < 3; pass++) {
      let n = 0; const t0 = performance.now();
      await new Promise((res) => {
        const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); };
        requestAnimationFrame(tick);
      });
      samples.push(n / ((performance.now() - t0) / 1000));
    }
    samples.sort((a, c) => a - c);
    return { label, fps: samples[1].toFixed(1), enemies: w.enemies.length,
      statused: w.enemies.filter((e) => e.status !== 0).length,
      bullets: w.playerBullets.count, novas: w.novas.length, effects: w.effects.length,
      wells: w.wells.length, propSets: w.propSets.length };
  }, [ids, label]);
  console.log(JSON.stringify(r));
}

await measure(['snap'], 'no properties (SNAP)');
await measure(['ember', 'tremolo', 'pizzicato', 'feedback'], 'four property weapons');
await measure(['snap'], 'no properties again (drift control)');
await b.close();
