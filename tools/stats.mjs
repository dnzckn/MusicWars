/*
 * stats — does every declared weapon stat actually reach the simulation?
 *
 * `InstrumentStats` declares ten numbers and the table sets all of them, which
 * looks like proof of nothing once you know the history. `bounces` was "a
 * declared stat with no consumer for the whole life of the instrument table"
 * — the comment in bullets.ts is the repo's own — and `area` was silently
 * dropped for every strike-shaped weapon because `fireSeek` read `speed` and
 * ignored it, so CHIME's "strikes land wider" moved a number nothing read.
 *
 * Both were found by hand, late, and both had passed every gate in the suite.
 * `tools/instruments.mjs` asks the same question of the SCORE — does each
 * ability reach the music — and there was no equivalent for the GAME.
 *
 * METHOD. Force one instrument into a real `World`, run a fixed number of
 * deterministic steps, and fingerprint what the simulation did: bullets
 * spawned, wall reflections, enemies killed, damage dealt, and where the
 * bullets ended up. Then multiply one stat and require the fingerprint to
 * MOVE. A stat that can be changed by a factor of four with no observable
 * consequence is not a stat, it is a comment.
 *
 * The perturbations are deliberately coarse. This is not a balance test — it
 * asks only whether the wire is connected, and a subtle nudge would report a
 * dead stat and a nearly-dead one the same way.
 *
 * BOTH DIRECTIONS, and that correction is the whole reason this tool is
 * trustworthy. Multiplying alone reported CHIME's and BLACK HOLE's damage as
 * inert. They are not: at level 3 both already one-shot an early-wave enemy,
 * so quadrupling the damage changes nothing that can be observed — SATURATION
 * looks exactly like a disconnected wire from above. Dividing separates them,
 * because a saturated stat starts mattering again as soon as it is small
 * enough to stop killing in one hit, and a dead one still does nothing.
 *
 * Three earlier readings from this tool were harness faults, not findings: the
 * `well` input was never pressed so BLACK HOLE never fired and reported all
 * ten stats dead; the kill listener was on `enemy:kill`, which the bus does
 * not emit, so the damage observable was always zero; and the `dodge` bot
 * flees, which starves a 460px strike of targets. Each produced a confident,
 * wrong answer.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
/*
 * `weave` and not the default: the default brain flees, and a strike that
 * reaches 460px finds nothing to land on when the player is running away.
 * Measured, CHIME fires 15 times in 45s under `weave` and its stats become
 * observable; under the fleeing brain it barely fires at all.
 */
const { INSTRUMENTS } = await import(`${R}game/weapons.ts`);

const DT = 1 / 60;
const SECS = Number(process.env.STATS_SECS ?? 45);

/*
 * One representative per shape, so every firing path is exercised. A stat can
 * be live for `seek` and dead for `strike` — that is exactly what happened to
 * `area` — so testing one instrument would prove nothing about the rest.
 */
const SUBJECTS = [];
const seenShape = new Set();
for (const d of INSTRUMENTS) {
  if (d.fused || seenShape.has(d.shape)) continue;
  seenShape.add(d.shape);
  SUBJECTS.push(d);
}

/** What the simulation did, as one comparable string. */
function fingerprint(id, level) {
  const w = new World(11); w.start();
  // A clean, forced loadout: only the instrument under test.
  for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
  w.progression.instruments[id] = level;
  const drive = makeBrain('weave');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
  /*
   * `enemy:death` and `enemy:hit` — the names the bus actually emits.
   *
   * The first version listened for `enemy:kill`, which does not exist, so the
   * counter read 0 for every subject and the fingerprint was blind to the one
   * thing damage changes. It still "worked": the probe ran, produced numbers,
   * and reported four stats dead. A listener on a misspelled event is silent
   * in exactly the way a correct listener on a broken feature is.
   *
   * `hit` matters as much as `death`: raising damage kills the same enemies
   * with FEWER hits, so the hit count moves even when the kill count does not.
   */
  let kills = 0, hits = 0;
  w.bus.on('enemy:death', () => kills++);
  w.bus.on('enemy:hit', () => hits++);
  for (let i = 0; i < Math.round(SECS / DT); i++) {
    if (i % 2 === 0) drive(w, inp);
    // Never take a card: a new ability would swamp the stat under test.
    inp.choice = -1;
    /*
     * PULSE THE WELL, or the field weapons never fire at all.
     *
     * BLACK HOLE is thrown, not automatic — `pendingWell` / `throwWell` in
     * world.ts wait on this input. With it left false the first version of
     * this probe reported all TEN of its stats inert, which is not a dead
     * stat table, it is a weapon that was never switched on. A harness that
     * forgets an input reports the most alarming possible result.
     */
    inp.well = i % 120 === 0;
    w.update(DT, inp);
  }
  const b = w.playerBullets;
  let px = 0;
  for (let k = 0; k < Math.min(b.count, 64); k++) px += Math.round(b.x[k]) + Math.round(b.y[k]) * 7;
  // Non-bullet shapes (arc, beam, aura, field) spawn no player bullets at all,
  // so `spawned` and the position hash are blind for them; the hit and death
  // counts are what carry those.
  return `${b.spawned}|${b.bounced}|${kills}|${hits}|${Math.round(w.snapshot.score)}|${px}`;
}

const STATS = ['interval', 'count', 'damage', 'area', 'arc', 'speed', 'pierce', 'bounces', 'linger', 'range'];
/* Multiplied, except `interval` where smaller means more — a 4x interval fires less. */
const FACTOR = 4;

const rows = [];
const dead = [];
for (const def of SUBJECTS) {
  const base = fingerprint(def.id, 3);
  const moved = [];
  for (const stat of STATS) {
    const was = def.base[stat];
    // A stat the instrument declares as 0 is opted out of, not broken: an
    // orbit has no arc. Give it a real value instead of scaling zero.
    const up = was > 0 ? was * FACTOR : (stat === 'arc' ? 1.2 : stat === 'area' ? 120 : 3);
    const down = was > 0 ? was / FACTOR : 0;
    let changed = false;
    for (const v of [up, down]) {
      def.base[stat] = v;
      try { if (fingerprint(def.id, 3) !== base) { changed = true; } } catch { /* keep going */ }
      if (changed) break;
    }
    def.base[stat] = was;
    if (changed) moved.push(stat);
  }
  rows.push([def.id, def.shape, moved]);
  for (const stat of STATS) {
    if (!moved.includes(stat)) dead.push(`${def.shape}/${def.id}: ${stat}`);
  }
}

console.log(`\nstats — does each declared stat reach the sim? (${SECS}s per probe, one per shape)\n`);
console.log(`  ${'instrument'.padEnd(12)} ${'shape'.padEnd(8)} stats with no observable effect`);
console.log(`  ${'-'.repeat(12)} ${'-'.repeat(8)} ${'-'.repeat(46)}`);
for (const [id, shape, moved] of rows) {
  const missing = STATS.filter((s) => !moved.includes(s));
  console.log(`  ${id.padEnd(12)} ${shape.padEnd(8)} ${missing.length ? missing.join(', ') : '— all ten land —'}`);
}
console.log(`\n  ${dead.length} (shape, stat) pairs are inert.`);
console.log('\n  Not every pair SHOULD move: an orbit has no travel speed and a beam has no');
console.log('  bounces. This prints the matrix so a stat that quietly stops working is');
console.log('  visible as a change to it, which is what nothing could see when `bounces`');
console.log('  and `area` were dead. The gate below is on the stats that must always land.');

/*
 * The gate is narrow ON PURPOSE. Asserting the whole matrix would encode
 * today's shape table as a requirement, and the first person to add a shape
 * would be told their correct code is broken. These four are the stats every
 * firing path in the game reads, whatever it looks like.
 */
const UNIVERSAL = ['interval', 'count', 'damage'];
const fails = [];
for (const [id, shape, moved] of rows) {
  for (const stat of UNIVERSAL) {
    if (!moved.includes(stat)) fails.push(`${shape}/${id}: "${stat}" can be multiplied by ${FACTOR} with no effect on the simulation`);
  }
}
for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) console.log('\n  ok  every shape reads interval, count and damage');
process.exit(fails.length ? 1 : 0);
