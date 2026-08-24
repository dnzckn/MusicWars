/**
 * How long a wave lasts, against how long a musical phrase lasts.
 *
 * The arrangement's unit is an eight-bar phrase — about fifteen seconds at
 * these tempos — and the theme is designed to state itself over one: a-a'-b-tag,
 * with the statement left undeveloped for the first two phrases so a listener
 * can learn it. A wave shorter than a phrase never gets to say anything.
 *
 * Whole-wave measurement showed ordinary waves running 8-27 seconds against a
 * boss's 50-130, which also means most of a run's clock is boss fights.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
import { freezePage } from './lib/frozen.mjs';
const MINUTES = Number(process.env.MINUTES ?? 7);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const r = await p.evaluate(async (mins) => {
  const w = window.__musicwars.world;
  const spb = () => w.transport.secondsPerBeat();
  const per = {};
  const end = performance.now() + mins * 60000;
  while (performance.now() < end) {
    const a = (per[w.waveIndex] ??= { n: 0 });
    a.n++;
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { per, phraseSeconds: +(spb() * 4 * 8).toFixed(1), reached: w.waveIndex };
}, MINUTES);
const reloadCount = reloads();
if (reloadCount > 0) console.log(`WARNING: the page reloaded ${reloadCount}x mid-run; these numbers span more than one build`);
await b.close();
const rows = Object.entries(r.per)
  .map(([i, a]) => ({ wave: Number(i) + 1, boss: Number(i) > 0 && Number(i) % 4 === 3, seconds: +(a.n * 0.1).toFixed(0) }))
  .sort((a, c) => a.wave - c.wave);
rows.pop(); // clipped by the end of the window
rows.shift(); // clipped by the start
for (const row of rows) row.phrases = +(row.seconds / r.phraseSeconds).toFixed(1);
console.table(rows);
const normal = rows.filter((x) => !x.boss), boss = rows.filter((x) => x.boss);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y.seconds, 0) / a.length : 0);
const bossShare = boss.reduce((a, x) => a + x.seconds, 0) / Math.max(1, rows.reduce((a, x) => a + x.seconds, 0));
console.log(`phrase = ${r.phraseSeconds}s | normal wave mean ${mean(normal).toFixed(0)}s | boss mean ${mean(boss).toFixed(0)}s`);
console.log(`short waves (under one phrase): ${normal.filter((x) => x.phrases < 1).length}/${normal.length}`);
console.log(`boss share of the clock: ${Math.round(bossShare * 100)}%`);
const problems = [];
// 0/11 and 3/13 on separate runs, so a 40% gate sat inside the spread. This
// asks whether short waves are the *rule*, which is the thing that would stop
// the theme ever stating itself.
if (normal.filter((x) => x.phrases < 1).length > normal.length * 0.55) problems.push('most ordinary waves are shorter than a musical phrase');
if (bossShare > 0.55) problems.push(`bosses hold ${Math.round(bossShare * 100)}% of the clock`);
for (const x of problems) console.log('PACING:', x);
console.log(problems.length ? 'THE WAVES ARE TOO SHORT TO SAY ANYTHING' : 'WAVES AND PHRASES LINE UP');
process.exit(problems.length ? 1 : 0);
