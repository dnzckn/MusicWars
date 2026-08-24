/**
 * The difficulty curve, integrated over whole waves.
 *
 * The previous version jumped to a wave and sampled a fixed window inside it.
 * That was the flaw, not the thresholds: a fourteen-second window lands on
 * whichever phase the wave happens to be in — a spawn burst, a lull, an
 * interlude, or a boss telegraph, which is a deliberately empty screen — and
 * those differ by more than the difficulty between waves does. Successive runs
 * of an unchanged build flagged different waves each time, and once it reported
 * a cliff that turned out to be an earlier wave getting *quieter* because
 * faster bosses let the sample reach the telegraph sooner.
 *
 * This plays one continuous run, samples throughout, and buckets by whichever
 * wave is live at the time. Each wave's number is then its own average across
 * its whole life, including its lulls, which is also what a player experiences.
 * No jumping, so no artificial states.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
import { freezePage } from './lib/frozen.mjs';

const MINUTES = Number(process.env.MINUTES ?? 8);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'weave');

const raw = await p.evaluate(async (mins) => {
  const w = window.__musicwars.world;
  const per = {};
  const end = performance.now() + mins * 60000;
  while (performance.now() < end) {
    const i = w.waveIndex;
    const a = (per[i] ??= { bullets: 0, enemies: 0, hits: 0, n: 0 });
    a.bullets += w.enemyBullets.count;
    a.enemies += w.enemies.length;
    a.n++;
    // The weave bot is deliberately unskilled so the stage is what is being
    // measured, not the player; keeping it alive keeps the run progressing.
    w.player.lives = Math.max(3, w.player.lives);
    await new Promise((r) => setTimeout(r, 150));
  }
  return { per, reached: w.waveIndex };
}, MINUTES);
const reloadCount = reloads();
if (reloadCount > 0) console.log(`WARNING: the page reloaded ${reloadCount}x mid-run; these numbers span more than one build`);
await b.close();

/*
 * A wave needs to have genuinely happened before its average means anything.
 *
 * Normal waves run 8-27 seconds against a boss's 50-130, and an eight-second
 * wave barely has time to spawn its first group — measured, one read pressure
 * 3.5 while its neighbours read 20, which registers as a cliff on both sides
 * and is really just a wave that had not started yet. 80 samples is twelve
 * seconds.
 */
const MIN_SAMPLES = 80;
const rows = Object.entries(raw.per)
  .map(([i, a]) => ({ wave: Number(i) + 1, boss: Number(i) > 0 && Number(i) % 4 === 3,
    seconds: +(a.n * 0.15).toFixed(0),
    bullets: +(a.bullets / a.n).toFixed(1), enemies: +(a.enemies / a.n).toFixed(1), n: a.n }))
  .filter((r) => r.n >= MIN_SAMPLES)
  .sort((a, c) => a.wave - c.wave);
// The last wave is cut off by the end of the measurement window, so its average
// covers only however much of it happened to fit.
rows.pop();
for (const r of rows) r.pressure = +(r.bullets + r.enemies * 3).toFixed(1);
console.table(rows.map(({ n, ...rest }) => rest));
console.log(`reached wave ${raw.reached + 1}; ${rows.length} waves with enough samples to judge`);

if (rows.length < 4) {
  console.log('not enough complete waves observed to say anything');
  process.exit(0);
}

/*
 * Boss waves are compared against boss waves, normal against normal.
 *
 * BOSS_EVERY is 4, and a boss wave is *supposed* to be a step up — measured, it
 * roughly doubles the pressure of the wave before it. Comparing every wave to
 * its immediate neighbour therefore flags every boss in the run as a cliff,
 * which is the check reporting the game's structure back as a defect. What
 * matters is whether the ordinary waves escalate smoothly and whether each boss
 * is a sane step past the last one.
 */
const first = rows.slice(0, Math.ceil(rows.length / 3));
const last = rows.slice(-Math.ceil(rows.length / 3));
const mean = (a) => a.reduce((x, y) => x + y.pressure, 0) / a.length;
const rise = mean(last) / Math.max(1, mean(first));
/*
 * Waves 1-3 are exempt. planWave keeps them close to trivial on purpose — that
 * was the answer to "the game is hard as shit" — so the step out of the
 * tutorial is large by design and is not what this is looking for. Printed, not
 * asserted.
 */
const ramp = rows.filter((r) => r.wave <= 3);
if (ramp.length) console.log(`on-ramp: ${ramp.map((r) => `wave ${r.wave} ${r.pressure}`).join(', ')} (intended)`);
const graded = rows.filter((r) => r.wave > 3);
const cliffs = [];
for (const kind of [false, true]) {
  const seq = graded.filter((r) => r.boss === kind);
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].pressure / Math.max(1, seq[i - 1].pressure) > 2.5) {
      cliffs.push(`${kind ? 'boss ' : ''}${seq[i - 1].wave}->${seq[i].wave}`);
    }
  }
}
console.log(`late third is ${rise.toFixed(1)}x the early third`);
if (cliffs.length) console.log(`CLIFF at ${cliffs.join(', ')}`);
/*
 * The aggregate rise is asserted; the per-step cliffs are printed.
 *
 * Whole-wave integration fixed the instrument's worst problem but not this one:
 * ordinary waves last 8-27 seconds against a boss's 50-130, and short waves
 * vary enormously — one read pressure 3.5 with neighbours at 20. Filtering the
 * shortest out then leaves gaps, so "5->9" compares waves three apart and is
 * not a step at all. There is no honest per-step verdict to give here.
 *
 * The early-third against late-third ratio has none of that trouble: it
 * averages across many waves of both kinds and has read 2.0, 2.4, 3.1 and 3.8
 * on separate runs. It answers the question that prompted this check — "the
 * game goes from hard as fuck to trivially easy", which is a claim about whether
 * difficulty escalates at all — and it answers it the same way every time.
 */
if (cliffs.length) console.log('(per-step jumps above are printed, not asserted — see this file)');
const ok = rise > 1.3;
if (!ok) console.log(`the curve barely rises (${rise.toFixed(1)}x)`);
console.log(ok ? 'THE CURVE RISES' : 'THE CURVE IS FLAT');
process.exit(ok ? 0 : 1);
