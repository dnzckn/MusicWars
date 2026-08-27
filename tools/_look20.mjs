/*
 * A LOOK, not a gate. Drives the real game in a real Chromium with each of the
 * twenty weapons forced into the loadout, and screenshots what it looks like on
 * the field — plus the level-up card, which is where the new mechanics-first
 * text has to read.
 *
 * No assertions: nothing here can measure whether a weapon is interesting, and
 * pretending otherwise is the failure this whole workstream is a record of.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { installDriver } from './lib/driver.mjs';

const OUT = process.env.OUT ?? fileURLToPath(new URL('./_shots20/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
p.on('pageerror', (e) => console.log('  PAGE THROW:', String(e).slice(0, 300)));

await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button').catch(() => {});
await p.waitForTimeout(800);
await installDriver(p, 'weave');
await p.waitForTimeout(6000);

const list = process.env.WHICH
  ? process.env.WHICH.split(',')
  : ['ember', 'chime', 'tremolo', 'pizzicato', 'feedback', 'snare', 'phantom', 'anvil',
     'gravel', 'nocturne', 'nova', 'blackhole', 'siphon', 'echoes', 'harp', 'drones',
     'timpani', 'accelerando', 'bow', 'charm'];

for (const id of list) {
  const label = await p.evaluate(async (id) => {
    const w = window.__musicwars.world;
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    w.progression.instruments[id] = 3;
    // A crowd to shoot at, so the effect has something to happen to.
    w.jumpToWave?.(14);
    return w.progression.instruments[id] ? id : '??';
  }, id);
  await p.waitForTimeout(4500);
  const stats = await p.evaluate(() => {
    const w = window.__musicwars.world;
    const st = {};
    for (const e of w.enemies) if (e.status) st[e.status] = (st[e.status] ?? 0) + 1;
    return {
      enemies: w.enemies.length,
      statused: Object.values(st).reduce((a, c) => a + c, 0),
      bullets: w.playerBullets.count,
      effects: w.effects.length,
      novas: w.novas.length,
      wells: w.wells.length,
      fires: Object.fromEntries(Object.entries(w.propFires).filter(([, v]) => v > 0)),
      overflow: w.propOverflow,
    };
  });
  console.log(`${label.padEnd(12)} ${JSON.stringify(stats)}`);
  await p.screenshot({ path: `${OUT}w-${id}.png` });
}

/* The card, with the offer open. */
await p.evaluate(() => {
  const w = window.__musicwars.world;
  window.__botInput.choice = -1;
  w.progression.pending = 1;
});
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}zz-offer.png` });

await b.close();
console.log('shots in', OUT);
