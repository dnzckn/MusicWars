/**
 * What the stage is actually made of: how many enemies shoot, how fast they
 * move, and how long they take to kill.
 *
 * Every existing balance tool measures the *result* of the roster — bullets on
 * screen, hits taken, wave length — and none of them measures the roster
 * itself. So "enemies that shoot should be rare, they should move slower, and
 * take a few more hits" had no instrument at all: `armedChance` could be read
 * from the source, but the number a player meets is not that function, it is
 * that function plus `spawnGroup`'s guarantee that the first enemy of every
 * group is armed regardless. Measured, those differ by a lot at low chances.
 *
 * Sampled per frame from a continuous run rather than a jumped-to wave, for the
 * reason `curve` was rewritten: a window lands on whichever phase a wave is in.
 *
 * It also buckets pressure by wave, which is what `curve` does. That is
 * deliberate duplication: `curve` cannot complete a run while anybody else is
 * editing src/, and it died twice on "Execution context was destroyed" while
 * this change was being measured. The numbers are computed the same way — mean
 * bullets plus three times mean enemies, integrated over whole waves, last wave
 * dropped as clipped — so they can be read against its history.
 *
 * DO NOT ADD A HITS-TO-KILL COLUMN BACK. This tool had one, and it was wrong
 * in a way that survived a whole rebalance: it counted frames on which hp fell,
 * and the player's two barrels land both bullets on the same frame. Parked one
 * enemy and logged every delta to settle it — an 11hp pluck died in ONE damage
 * frame carrying a delta of 7, and a 29hp arpeggiator took 5 frames for 8
 * bullets landed (7, 7, 7, 3.5, 3.5). The count is quantised by the volley, so
 * it only moves when hp crosses a multiple of ~7 and it reads the same for 3hp
 * and 11hp. It said 1.9-2.0 before a 2.5x hp raise and 1.8-2.0 after, while
 * `ttk.mjs` correctly showed time-to-kill doubling, and it was nearly used to
 * conclude the hp raise had not landed. It was also survivorship-biased on top:
 * it only counted enemies that died, and raising hp pushes the enemies that
 * survive out of that sample.
 *
 * `dmg absorbed` replaces it — total damage actually taken, over every enemy
 * rather than only the dead ones. Time-to-kill belongs to `ttk.mjs`, which
 * parks a target and times it, and is the only honest instrument for it here.
 *
 * Speed is measured as real on-screen displacement, not the `vy` field. Half
 * the archetypes move from a `move` function with its own hard-coded constants
 * (the hop amplitude, the dive speed, the weave), so `vy` describes almost
 * nothing about how fast a stutter or a rush crosses the screen.
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';
import { freezePage } from './lib/frozen.mjs';

const MINUTES = Number(process.env.MINUTES ?? 6);
const MODE = process.env.MODE ?? 'weave';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(2500);
await installDriver(p, MODE);

const raw = await p.evaluate(async ({ mins }) => {
  const w = window.__musicwars.world;
  const live = new Map();
  const done = [];
  const pressure = { bullets: 0, enemies: 0, n: 0 };
  const perWave = {};
  let last = performance.now();
  let stop = false;

  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const seen = new Set();
    for (const e of w.enemies) {
      if (e.archetype === 'conductor') continue;
      seen.add(e.id);
      let r = live.get(e.id);
      if (!r) {
        r = { archetype: e.archetype, armed: !!e.armed && e.emitters.length > 0, maxHp: e.maxHp,
              wave: w.waveIndex, born: now, firstHit: 0, dist: 0, time: 0, lastHp: e.hp,
              x: e.x, y: e.y, hits: 0, dmg: 0 };
        live.set(e.id, r);
      }
      const d = Math.hypot(e.x - r.x, e.y - r.y);
      // A hop is a real displacement; a respawned position is not. Nothing
      // teleports, so anything over a third of the screen in one frame is the
      // sampler, not the enemy.
      if (d < 200) { r.dist += d; r.time += dt; }
      r.x = e.x; r.y = e.y;
      if (e.hp < r.lastHp) {
        r.hits++;
        r.dmg += r.lastHp - e.hp;
        if (!r.firstHit) r.firstHit = now;
      }
      r.lastHp = e.hp;
    }
    for (const [id, r] of live) {
      if (seen.has(id)) continue;
      r.killed = r.lastHp <= 0;
      r.ttl = (now - r.born) / 1000;
      r.ttk = r.firstHit && r.killed ? (now - r.firstHit) / 1000 : null;
      done.push(r);
      live.delete(id);
    }
    pressure.bullets += w.enemyBullets.count;
    pressure.enemies += w.enemies.length;
    pressure.n++;
    const pw = (perWave[w.waveIndex] ??= { bullets: 0, enemies: 0, n: 0, seconds: 0 });
    pw.bullets += w.enemyBullets.count;
    pw.enemies += w.enemies.length;
    pw.seconds += dt;
    pw.n++;
    // Unskilled bot, kept alive so the run keeps reaching new waves — the stage
    // is what is being measured, not the player.
    w.player.lives = Math.max(3, w.player.lives);
    if (!stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  await new Promise((r) => setTimeout(r, mins * 60000));
  stop = true;
  // `player.weapon()` is gone: the ship is six instruments on six clocks now,
  // not one function returning one fan. `ensembleDps` is the replacement and it
  // is a nominal budget rather than a measured rate — read the comment on it
  // before drawing any conclusion about damage from this column.
  return { done, perWave, reached: w.waveIndex, weaponDamage: w.ensembleDps(),
           bullets: pressure.bullets / pressure.n, enemies: pressure.enemies / pressure.n };
}, { mins: MINUTES });
await b.close();

const all = raw.done.filter((r) => r.time > 0.2);
const pct = (a, f) => (a.length ? (100 * a.filter(f).length) / a.length : 0);
const mean = (a, f) => (a.length ? a.reduce((x, y) => x + f(y), 0) / a.length : 0);
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

const kinds = [...new Set(all.map((r) => r.archetype))].sort();
const rows = kinds.map((k) => {
  const g = all.filter((r) => r.archetype === k);
  const killed = g.filter((r) => r.ttk !== null);
  return {
    archetype: k,
    spawned: g.length,
    'armed %': +pct(g, (r) => r.armed).toFixed(0),
    'speed px/s': +mean(g, (r) => r.dist / r.time).toFixed(0),
    hp: +mean(g, (r) => r.maxHp).toFixed(1),
    'dmg absorbed': +mean(g, (r) => r.dmg).toFixed(1),
    'ttk s': +med(killed.map((r) => r.ttk)).toFixed(2),
    'killed %': +pct(g, (r) => r.killed).toFixed(0),
  };
});
console.table(rows);

const early = all.filter((r) => r.wave < 6), late = all.filter((r) => r.wave >= 10);
const band = (g, name) => ({
  band: name, spawned: g.length,
  'armed %': +pct(g, (r) => r.armed).toFixed(0),
  'speed px/s': +mean(g, (r) => r.dist / r.time).toFixed(0),
  hp: +mean(g, (r) => r.maxHp).toFixed(1),
  'dmg absorbed': +mean(g, (r) => r.dmg).toFixed(1),
});
console.table([band(early, 'waves 1-5'), band(late, 'waves 11+'), band(all, 'whole run')]);
/*
 * A wave has to have genuinely happened before its average means anything —
 * `curve` uses twelve seconds for the same reason, and the last wave is always
 * clipped by the end of the window.
 */
const waves = Object.entries(raw.perWave)
  .map(([i, a]) => ({ wave: Number(i) + 1, boss: Number(i) > 0 && Number(i) % 4 === 3,
    seconds: +a.seconds.toFixed(0), bullets: +(a.bullets / a.n).toFixed(1),
    enemies: +(a.enemies / a.n).toFixed(1) }))
  .filter((r) => r.seconds >= 12)
  .sort((a, c) => a.wave - c.wave);
waves.pop();
for (const r of waves) r.pressure = +(r.bullets + r.enemies * 3).toFixed(1);
console.table(waves);
if (waves.length >= 4) {
  const third = Math.ceil(waves.length / 3);
  const pm = (a) => a.reduce((x, y) => x + y.pressure, 0) / a.length;
  const rise = pm(waves.slice(-third)) / Math.max(1, pm(waves.slice(0, third)));
  console.log(`curve: late third is ${rise.toFixed(1)}x the early third (curve.mjs gates this above 1.3)`);
}
console.log(`reached wave ${raw.reached + 1} | ${all.length} enemies observed | mode ${MODE}`);
console.log(`shooters ${pct(all, (r) => r.armed).toFixed(0)}% of enemies | mean screen speed ${mean(all, (r) => r.dist / r.time).toFixed(0)} px/s | mean damage absorbed ${mean(all, (r) => r.dmg).toFixed(1)} (time-to-kill lives in ttk.mjs, not here)`);
if (reloads()) console.log(`WARNING: the page reloaded ${reloads()} times mid-run; these numbers are fiction`);
console.log(`on screen: ${raw.bullets.toFixed(1)} bullets, ${raw.enemies.toFixed(1)} enemies | pressure ${(raw.bullets + raw.enemies * 3).toFixed(1)}`);
