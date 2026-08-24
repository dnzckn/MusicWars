/**
 * How long a boss fight actually lasts.
 *
 * "The boss is insane, extremely high hp" was a direct complaint, and the
 * bullet side of it has been fixed — a fight now runs about 14 bullets on
 * screen. Nobody has since measured the other half. Sampled during a fight the
 * boss lost 15% of its health in 24 seconds, which extrapolates to something
 * close to three minutes against a single enemy.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, 'dodge');
const rows = [];
for (const wave of [7, 15]) {
  rows.push(await p.evaluate(async (wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv);
    w.player.lives = 4; w.player.hp = w.player.maxHp;
    // Wait for the boss to actually arrive.
    const spawnDeadline = performance.now() + 60000;
    while (!w.snapshot.bossActive && performance.now() < spawnDeadline) {
      w.player.lives = Math.max(3, w.player.lives);
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!w.snapshot.bossActive) return { wave: wv + 1, arrived: false };
    const t0 = performance.now();
    let phases = 0, lastPhase = -1;
    while (w.snapshot.bossActive && performance.now() - t0 < 300000) {
      if (w.snapshot.bossPhase !== lastPhase) { lastPhase = w.snapshot.bossPhase; phases++; }
      w.player.lives = Math.max(3, w.player.lives);
      await new Promise((r) => setTimeout(r, 250));
    }
    return { wave: wv + 1, arrived: true, seconds: +((performance.now() - t0) / 1000).toFixed(0),
      phasesSeen: phases, killed: !w.snapshot.bossActive };
  }, wave));
}
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows);
/*
 * A boss that never dies is the WORST outcome, not an exempt one.
 *
 * This filtered to `killed` fights before checking duration, so a fight that
 * ran the full 300s budget without the boss dying was dropped from the sample
 * and the check printed "BOSSES END". It did exactly that the first time the
 * roster was made tougher: the wave-8 boss survived five minutes and the gate
 * said everything was fine. A timeout has to fail louder than a slow kill, not
 * quieter.
 */
const timedOut = rows.filter((r) => r.arrived && !r.killed);
const fights = rows.filter((r) => r.arrived && r.killed);
for (const f of fights) console.log(`wave ${f.wave}: ${f.seconds}s, ${f.phasesSeen} phases`);
/*
 * READ tools/bossdps.mjs BEFORE ACTING ON A FAILURE HERE. This check depends on
 * the dodging bot getting shots onto a laterally weaving boss, and measured
 * against one unchanged build that is close to a coin flip: 90% of the boss's
 * health gone in 75s on one run, 0% in 149s on the next. A failure here is
 * evidence that the bot did not engage, not that the boss is too tough.
 *
 * Two minutes is the line. A boss is the climax of a wave cycle, not a war of
 * attrition — and the arrangement holds its boss material for the whole fight,
 * so an over-long boss is an over-long piece of music too.
 */
const tooLong = fights.filter((f) => f.seconds > 120);
for (const t of timedOut) console.log(`NEVER DIED: wave ${t.wave} boss survived the full ${t.seconds}s budget`);
if (tooLong.length) console.log(`OVER-LONG: ${tooLong.map((f) => `wave ${f.wave} ${f.seconds}s`).join(', ')}`);
const ok = fights.length > 0 && tooLong.length === 0 && timedOut.length === 0;
if (!fights.length) console.log('no boss fight completed within the budget');
console.log(ok ? 'BOSSES END' : 'THE BOSS OUTSTAYS ITS WELCOME');
process.exit(ok ? 0 : 1);
