/**
 * The first ten seconds, as a player sees them.
 *
 * `firstminute` measures the opening — 7.7s to the first enemy, four bars of
 * runway while the arrangement assembles — and says nothing about what is on
 * the screen during it, which for most of that time was an empty playfield. The
 * wait is deliberate and the music is the reason for it, but a new player who
 * does not know the premise reads an empty field as a broken game.
 *
 * Frames at the moments that matter: immediately after START, then each bar of
 * the intro, then just after the first enemy arrives. For looking at.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await installDriver(p, 'dodge');

const t0 = Date.now();
for (const at of [0.6, 2.5, 4.5, 6.5, 8.5, 11]) {
  const wait = at * 1000 - (Date.now() - t0);
  if (wait > 0) await p.waitForTimeout(wait);
  const st = await p.evaluate(() => {
    const mw = window.__musicwars, w = mw.world, r = mw.readout();
    const live = Object.entries(r.levels).filter(([, v]) => v > 0.05).map(([k]) => k);
    return { section: r.section, enemies: w.enemies.length, live };
  });
  await p.screenshot({ path: `/tmp/open-${String(at).replace('.', '_')}s.png` });
  console.log(`${at}s  section=${st.section} enemies=${st.enemies} live=[${st.live.join(' ')}]`);
}
if (reloads() > 0) console.log(`WARNING: page reloaded ${reloads()}x mid-run`);
await b.close();
