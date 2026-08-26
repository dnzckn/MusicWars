/**
 * _shapecount — what does ONE instrument of each shape actually put on screen?
 *
 * Throwaway probe for the `lance` / `cone` / `spray` change. The budgets in
 * `docs/research-weapons.md` Part D are arithmetic; this runs the real
 * `World.update` at the real 1/120 step with a forced single-instrument
 * loadout and the whole rig at max, and reports the high-water mark of the
 * container that shape actually uses.
 *
 * A single-instrument loadout is the point: `deadhunt-ranges` measures the
 * whole pool with everything held at once, which answers "does the cap bite"
 * and cannot answer "how much of that is the spray". Rig at max is not a claim
 * about play — it is the worst case the tables permit, which is what a budget
 * is about.
 *
 *   node --experimental-transform-types tools/_shapecount.mjs [seconds]
 */

import './lib/tsnode.mjs';

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const W = await import(`${R}game/weapons.ts`);

const SECS = Number(process.argv[2] ?? 90);
const DT = 1 / 120;
const WAVE = 18;

/* The arena bot policy, copied from tools/deadhunt-ranges.mjs for the reason
 * that file gives: the browser driver is a string evaluated in a page. */
function drive(w, inp) {
  /*
   * SKIP EVERY OFFER, never take one.
   *
   * `inp.choice = 0` is what `arena` and `deadhunt-ranges` do and it is wrong
   * here: the pick is applied INSIDE `w.update`, on the same step as
   * `fireInstruments`, so re-seating around the call cannot keep the loadout
   * clean and the probe reported FEEDBACK at 48 bullets with WALL OF SOUND —
   * its own evolution — in the shot log. Skipping closes the offer without
   * granting anything, which is the only way this stays a one-instrument run.
   */
  inp.skip = w.choosing;
  inp.choice = -1;
  const px = w.player.x;
  const py = w.player.y;
  let rx = 0;
  let ry = 0;
  let danger = 0;
  let closest = 1e9;
  const bl = w.enemyBullets;
  for (let i = 0; i < bl.count; i++) {
    const dx = px - bl.x[i];
    const dy = py - bl.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 > 190 * 190) continue;
    const d = Math.sqrt(d2) || 1;
    closest = Math.min(closest, d);
    const vx = Math.cos(bl.angle[i]) * bl.speed[i];
    const vy = Math.sin(bl.angle[i]) * bl.speed[i];
    const closing = (-dx * vx - dy * vy) / d;
    if (closing <= 0) continue;
    const weight = (1 - d / 190) ** 2 * (1 + closing / 300);
    rx += (dx / d) * weight;
    ry += (dy / d) * weight;
    if (d < 90) danger += weight;
  }
  for (const e of w.enemies) {
    const dx = px - e.x;
    const dy = py - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > e.radius + 70) continue;
    rx += (dx / d) * 1.5;
    ry += (dy / d) * 1.5;
  }
  let ax = 0;
  let ay = 0;
  for (const n of [...w.notes, ...w.drops]) {
    const dx = n.x - px;
    const dy = n.y - py;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 300) continue;
    const pull = (n.kind ? 1.6 : 0.5) * (1 - d / 300);
    ax += (dx / d) * pull;
    ay += (dy / d) * pull;
  }
  const calm = Math.max(0, 1 - danger);
  let mx = rx * 2.2 + ax * calm;
  let my = ry * 2.2 + ay * calm;
  const enc = w.encircled;
  if (enc > 0.35) {
    mx += Math.cos(w.wayOut) * enc * 1.8;
    my += Math.sin(w.wayOut) * enc * 1.8;
  }
  const wall = Math.min(w.width, w.height) * (110 / 900);
  if (px < wall) mx += 1;
  if (px > w.width - wall) mx -= 1;
  if (py < wall) my += 1;
  if (py > w.height - wall) my -= 1;
  const len = Math.hypot(mx, my);
  inp.x = len > 0.05 ? mx / len : 0;
  inp.y = len > 0.05 ? my / len : 0;
  inp.focus = closest < 70;
  inp.bomb = danger > 3.2 && w.player.bombs > 0;
  inp.well = danger > 2.2 && w.player.wells > 0;
}

function probe(id, rig) {
  const def = W.instrumentDef(id);
  const w = new World(0x5ba7e);
  w.start();
  w.jumpToWave(WAVE);
  const seat = () => {
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    w.progression.instruments[id] = W.maxLevelOf(id);
    for (const k of Object.keys(w.progression.rig)) delete w.progression.rig[k];
    if (rig) for (const d of W.RIG) w.progression.rig[d.id] = W.RIG_MAX_LEVEL;
  };
  seat();
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };
  let bullets = 0;
  let effects = 0;
  let novas = 0;
  let wells = 0;
  let shells = 0;
  let summons = 0;
  let enemies = 0;
  let shots = 0;
  const voices = new Set();
  w.bus.on('player:shoot', (e) => {
    shots++;
    voices.add(`${e.id ?? '-'}/${e.voice ?? 'NONE'}`);
  });
  const steps = Math.round(SECS / DT);
  for (let i = 0; i < steps; i++) {
    /*
     * EVERY STEP, not every sixtieth.
     *
     * The first version of this probe re-seated twice a second and reported
     * crossstrung at 119 bullets — with `echoes`, `tremolo` and `drones` in its
     * own `player:shoot` log, because the bot takes every card it is offered
     * and the instruments it picked up fired in the gap before the next
     * re-seat. An isolation probe that is not isolated measures the loadout,
     * not the shape.
     */
    seat();
    if (i % 2 === 0) drive(w, inp);
    w.update(DT, inp);
    w.shocks.length = 0;
    w.player.lives = Math.max(3, w.player.lives);
    w.player.dead = false;
    if (w.playerBullets.count > bullets) bullets = w.playerBullets.count;
    if (w.effects.length > effects) effects = w.effects.length;
    if (w.novas.length > novas) novas = w.novas.length;
    if (w.wells.length > wells) wells = w.wells.length;
    if (w.shells.length > shells) shells = w.shells.length;
    if (w.summonsLive > summons) summons = w.summonsLive;
    if (w.enemies.length > enemies) enemies = w.enemies.length;
  }
  return {
    id,
    shape: def.shape,
    rig: rig ? 'max' : 'none',
    bullets,
    effects,
    novas,
    wells,
    shells,
    summons,
    enemies,
    shots,
    overflow: w.playerBullets.overflow,
    voices: [...voices].join(' '),
  };
}

console.log(`\n_shapecount — one instrument at max, ${SECS}s at wave ${WAVE}, real World.update at 1/120\n`);
console.log(
  `  ${'instrument'.padEnd(14)} ${'shape'.padEnd(7)} ${'rig'.padEnd(5)} ` +
    `${'bullets'.padStart(8)} ${'effects'.padStart(8)} ${'novas'.padStart(6)} ${'wells'.padStart(6)} ` +
    `${'shells'.padStart(7)} ${'summons'.padStart(8)} ` +
    `${'enemies'.padStart(8)} ${'overflow'.padStart(9)} ${'shots'.padStart(7)}`,
);
const rows = [];
for (const id of [
  // The `lance` / `cone` / `spray` change this file was written for.
  'crossstrung', 'wallofsound', 'feedback', 'harmonics', 'bow', 'pizzicato', 'chorale',
  /*
   * The `trail` / `chain` / `mortar` / `spawn` change.
   *
   * `tremolo` is the one to watch: its live ring count is
   * `drops x life / interval` and both halves move under the rig, so the
   * arithmetic that says 4 x 17 = 68 has to be checked against a run before
   * it is believed. The other three are bounded by construction — `chain` by
   * a 0.12s flash against a 0.31s floor interval, `mortar` by `MAX_SHELLS`,
   * `spawn` by a top-up against `MAX_SUMMONS` — and are here so that
   * 'bounded by construction' is a measurement rather than a claim.
   */
  'tremolo', 'carillon', 'tutti', 'vibrato',
]) {
  for (const rig of [false, true]) {
    const r = probe(id, rig);
    rows.push(r);
    console.log(
      `  ${r.id.padEnd(14)} ${r.shape.padEnd(7)} ${r.rig.padEnd(5)} ` +
        `${String(r.bullets).padStart(8)} ${String(r.effects).padStart(8)} ${String(r.novas).padStart(6)} ` +
        `${String(r.wells).padStart(6)} ${String(r.shells).padStart(7)} ${String(r.summons).padStart(8)} ` +
        `${String(r.enemies).padStart(8)} ${String(r.overflow).padStart(9)} ` +
        `${String(r.shots).padStart(7)}`,
    );
  }
}
console.log(`\n  cap MAX_PLAYER_BULLETS: ${new World(1).playerBullets.capacity}`);
console.log('\n  player:shoot payloads seen (id/voice) — NONE means the family fallback is still unreachable');
for (const r of rows) console.log(`    ${r.id.padEnd(14)} ${r.rig.padEnd(5)} ${r.voices || 'NO SHOTS'}`);
console.log('');
