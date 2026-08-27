/*
 * _latticeperf — worst-case live object counts for the fusions that SPAWN.
 *
 * Not a gate; a measurement, because the brief for this phase asks for the
 * worst case in objects rather than in frames and the caps are what decide it:
 * MAX_PLAYER_BULLETS 700, MAX_EFFECTS 96, MAX_SUMMONS 12.
 *
 * Holds the four most prolific results at once — every one of them a brood,
 * a burst or a split — in a field held at a floor, for 60s, and reports the
 * peak of every pool plus whatever the caps refused.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const W = await import(`${R}game/weapons.ts`);
const { spawnEnemy } = await import(`${R}game/enemies.ts`);

const DT = 1 / 120;
const SECS = Number(process.env.SECS ?? 60);
const FLOOR = 24;
const ARCH = ['pluck', 'stutter', 'arpeggiator', 'rush', 'subdrop'];

/* The four heaviest spawners in the table, by what they put into a pool. */
const LOADOUTS = {
  'spawn-heavy': ['maggot', 'spiderqueen', 'clutch', 'sforzando'],
  'splash-heavy': ['xray', 'flash', 'armageddon', 'landslide'],
  'control (four bases)': ['harp', 'drones', 'echoes', 'feedback'],
};

console.log(`\n_latticeperf — worst-case live objects, ${SECS}s each, ${FLOOR} bodies held\n`);
console.log(`  ${'loadout'.padEnd(22)} ${'bullets'.padStart(8)} ${'summons'.padStart(8)} ${'effects'.padStart(8)} ${'novas'.padStart(7)} ${'enemies'.padStart(8)}   caps refused`);

for (const [name, ids] of Object.entries(LOADOUTS)) {
  const w = new World(0x51f2);
  w.starter = ids[0];
  w.start();
  const drive = makeBrain('weave');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  const peak = { bullets: 0, summons: 0, effects: 0, novas: 0, enemies: 0 };
  const steps = Math.round(SECS / DT);
  const every = Math.round(0.25 / DT);
  for (let i = 0; i < steps; i++) {
    if (i % 2 === 0) drive(w, inp);
    if (i % every === 0) {
      let live = 0;
      for (const e of w.enemies) if (e.alive) live++;
      for (let k = live; k < FLOOR; k++) {
        const ang = (i * 0.019 + k * 0.7) % (Math.PI * 2);
        const e = spawnEnemy(ARCH[(i + k) % ARCH.length], w.player.x + Math.cos(ang) * (240 + k * 9),
          w.player.y + Math.sin(ang) * (240 + k * 9), 0.5, 220, k % 3 === 0);
        e.hp = e.maxHp = 1600;
        w.enemies.push(e);
      }
    }
    for (const k of Object.keys(w.progression.instruments)) if (!ids.includes(k)) delete w.progression.instruments[k];
    for (const id of ids) w.progression.instruments[id] = W.maxLevelOf(id);
    w.progression.pending = 0;
    w.progression.offer = null;
    w.update(DT, inp);
    w.shocks.length = 0;
    w.player.lives = Math.max(3, w.player.lives);
    w.player.hp = Math.max(1, w.player.hp);
    w.player.dead = false;
    peak.bullets = Math.max(peak.bullets, w.playerBullets.count);
    peak.summons = Math.max(peak.summons, w.summonsLive ?? 0);
    peak.effects = Math.max(peak.effects, w.effects.length);
    peak.novas = Math.max(peak.novas, w.novas.length);
    peak.enemies = Math.max(peak.enemies, w.enemies.length);
  }
  console.log(
    `  ${name.padEnd(22)} ${String(peak.bullets).padStart(8)} ${String(peak.summons).padStart(8)} ` +
      `${String(peak.effects).padStart(8)} ${String(peak.novas).padStart(7)} ${String(peak.enemies).padStart(8)}   ` +
      `propOverflow ${w.propOverflow}`,
  );
}
// The bullet cap is module-private in `world.ts`; the pool it built knows its
// own size, so read it off there rather than keeping a second copy here.
const probe = new World(1);
console.log(`\n  caps: player bullets ${probe.playerBullets.capacity}  MAX_EFFECTS ${World.MAX_EFFECTS}  MAX_SUMMONS ${World.MAX_SUMMONS}  MAX_NOVAS ${World.MAX_NOVAS}`);
console.log('  note: `summonsLive` is refreshed once per frame by `updateSummons` while `onHit` can');
console.log('  fire several times inside one, so the summon peak may sit one over its cap for a frame.\n');
