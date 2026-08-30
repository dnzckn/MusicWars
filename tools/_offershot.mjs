/**
 * _offershot — scratch. The offer screen with a queue behind it, at several
 * window sizes, through the same `__musicwars.ui.offer` hook `levelshot` uses.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

for (const [w, h, queued] of [[1280, 720, 4], [1100, 620, 2], [1920, 1080, 0]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(2200);
  await p.evaluate(({ queued }) => {
    const mw = window.__musicwars;
    const s = mw.world.snapshot;
    for (const k of Object.keys(s.abilities)) delete s.abilities[k];
    Object.assign(s.abilities, { ember: 3, chime: 2, nocturne: 1, resonance: 2, laser: 2 });
    s.instrumentSlots = 4;
    s.rigSlots = 4;
    s.level = 17;
    Object.defineProperty(s, 'choosing', { configurable: true, writable: true, value: true });
    mw.ui.offer({
      level: 17,
      queued,
      rerolls: 2,
      banishes: 1,
      options: [
        { id: 'resonance', label: 'RESONANCE', level: 3, isNew: false, slot: 'rig' },
        { id: 'chime', label: 'CHIME', level: 3, isNew: false, slot: 'instrument' },
        { id: 'timpani', label: 'TIMPANI', level: 1, isNew: true, slot: 'instrument' },
        { id: 'laser', label: 'LASER', level: 3, isNew: false, slot: 'rig' },
      ],
    });
  }, { queued });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${out}/offer-${w}x${h}-q${queued}.png` });
  console.log(`wrote offer-${w}x${h}-q${queued}.png`);
  await p.close();
}
await b.close();
