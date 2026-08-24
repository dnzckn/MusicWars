/*
 * wiring — does the real game actually feed the real score?
 *
 * THE GAP THIS FILLS. `tools/arena.mjs` runs the real `World` and says nothing
 * about music. `tools/session.mjs` runs the real `MusicDirector` but against a
 * snapshot this repository fabricates, so it agrees with whatever the harness
 * believes. Nothing ran one into the other, and that seam is exactly where the
 * worst class of bug in this project lives.
 *
 * It is not hypothetical. The progression rewrite moved nine of the twelve
 * powerups from `snapshot.powerups` onto `snapshot.abilities` — same ids, same
 * `id -> level` shape, different field. `layers.ts` reads all nine as
 * `m.powerups.nova`, `m.powerups.laser` and so on, so from that moment DRONES,
 * NOVA, BLACKHOLE, LASER, SPREAD, RAPID, HOMING, MAGNET and TIMEWARP were
 * reading zero forever and every powerup-driven behaviour in the score was
 * dead. Nothing warned, and nothing could: the lookups are on a
 * `Partial<Record<...>>`, so a missing key is a legal `undefined` and the
 * `?? 0` beside it turns silence into a plausible default.
 *
 * That is the shape to guard against — **a field the score reads that the game
 * never writes**. A rename cannot break it loudly, only quietly, and no
 * typecheck sees it because both sides are individually valid.
 *
 * HOW. Drive the real `World` with the real bot, hand each real snapshot to a
 * real `MusicDirector`, and afterwards ask: of the ids and fields the score
 * actually reads — discovered by reading `layers.ts` as text, so the list
 * cannot drift from the source — which ones never once arrived?
 *
 * WHAT A PASS DOES NOT MEAN. This proves the wiring carries a signal, not that
 * the signal is musical. It also cannot see anything a bot never does: if the
 * bot never picks up BOMB, BOMB reads as unwired here and is merely untested.
 * Unreached ids are reported separately from unwired ones for that reason.
 */
// `headless-audio` rather than `tsnode` directly: it imports `tsnode` itself
// AND stubs `@kabelsalat/web`, which `@strudel/core` pulls in via its REPL and
// which throws on import in Node. Using the game loader alone gets you as far
// as `World` and then dies on the first audio import.
import './lib/headless-audio.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const { World } = await import('../src/game/world.ts');
const { MusicDirector } = await import('../src/audio/director.ts');
const { Transport } = await import('../src/core/transport.ts');

const DT = 1 / 120;
const MINUTES = Number(process.argv[2] ?? 6);
const STEPS = Math.round((MINUTES * 60) / DT);

/*
 * The ids the score reads, taken from the source rather than restated here.
 * A hand-maintained copy of this list would drift, and a guard that drifts
 * from the thing it guards is worse than none — it reports on a past version.
 */
const layersSrc = readFileSync(join(ROOT, 'src/audio/layers.ts'), 'utf8');
/*
 * Comments stripped BEFORE matching, and this is not a nicety.
 *
 * `deadhunt` hit the same shape from the game side: their per-shape table
 * grepped `world.ts` bodies for `s.<stat>`, and an annotation they had written
 * explaining that a routine IGNORES `s.count` contained the literal text
 * `s.count` — so the regex read their writeup of the defect as evidence the
 * defect was gone, and the dead-step count fell from 8 to 3 on a change that
 * touched no behaviour at all.
 *
 * This file had it too. `layers.ts:3114` documents an old bug in a comment
 * reading "The gate was `if (m.powerups.nova)`", which this regex counted as a
 * live read. A comment-only id would be reported as NEVER ARRIVED — a wiring
 * break that is really a docstring — and, worse, deleting the real read while
 * leaving the comment would leave the gate perfectly quiet.
 *
 * Note the direction both failures point: they make the number look BETTER, or
 * make a real break look like noise. Neither prompts a second look.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*/gm, ' ');
const layersCode = stripComments(layersSrc);
const readIds = (prop) =>
  [...new Set([...layersCode.matchAll(new RegExp(`m\\.${prop}\\.([a-zA-Z]+)`, 'g'))].map((m) => m[1]))].sort();
const POWERUP_IDS = readIds('powerups');
/*
 * NOT read by regex. `layers.ts` addresses archetypes dynamically —
 * `m.enemies[mo.archetype]`, driven by the MOTIFS table — so a `m.enemies.X`
 * pattern finds nothing and a check built on it would pass vacuously forever.
 * The honest question is simply whether ANY archetype ever reaches the score.
 */

let picks = 0;
/** Minimal bot: answer offers, run from the nearest threat, keep firing. */
function drive(w, inp) {
  // Vary the pick. Always taking option 0 means the bot earns one ability and
  // eight ids read as "never arrived" — a coverage gap that looks exactly like
  // the wiring break this tool exists to find.
  inp.choice = w.choosing ? picks++ % 4 : -1;
  const px = w.player.x;
  const py = w.player.y;
  let rx = 0;
  let ry = 0;
  for (const e of w.enemies) {
    const dx = px - e.x;
    const dy = py - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 260 * 260 || d2 === 0) continue;
    const d = Math.sqrt(d2);
    rx += dx / d / d;
    ry += dy / d / d;
  }
  // Head for the widest gap when nothing is close enough to flee.
  if (rx === 0 && ry === 0 && typeof w.wayOut === 'number') {
    rx = Math.cos(w.wayOut);
    ry = Math.sin(w.wayOut);
  }
  const m = Math.hypot(rx, ry) || 1;
  inp.x = rx / m;
  inp.y = ry / m;
}

const w = new World(0x51ed);
/*
 * BOTH systems have to be switched on, and neither says so if you forget.
 *
 * `w.start()` begins the run; without it the World updates happily, spawns
 * nothing, and reports level 1 / wave 0 forever. `director.reset(0)` sets the
 * director's `started` flag; without it `update` returns immediately and every
 * level reads a plausible 0.
 *
 * The first version of this tool omitted `w.start()` and confidently declared a
 * wiring break — nine ids "never arrived" because nothing ever happened. That
 * is the third time today a harness has measured a switched-off system and
 * produced numbers that looked like findings.
 */
w.start();

const director = new MusicDirector();
director.reset(0);
const transport = new Transport();
transport.start();

/*
 * THE EVENT PATH, which the snapshot check above says nothing about.
 *
 * `main.ts` connects ten of the world's bus events to director handlers —
 * `wave:start`, `wave:clear`, `boss:telegraph`, `boss:phase`, `boss:defeat`,
 * `player:hit`, `player:death`, `player:bomb`, `powerup:pickup`,
 * `powerup:expire`. Those handlers are where the *structural* musical decisions
 * live: the mode change and modulation on a new wave, the breakdown on a clean
 * clear, the boss groove, the drop lined up with the boss's first attack.
 *
 * None of it is reachable from the snapshot. A snapshot says what the world IS;
 * these say what just HAPPENED, and the arrangement is driven by the second
 * one. So a handler could be disconnected — a renamed event, a subscription
 * dropped in a refactor — and every measurement in this repository would still
 * pass while the score quietly stopped reacting to the game's structure. That
 * is the same silent shape as the powerups bug, one layer up.
 *
 * Subscribing here exactly as `main.ts` does, and counting. An event the world
 * never fires is reported, not failed: a six-minute bot run legitimately never
 * dies and may never see a boss.
 */
const fired = new Map();
const tally = (name) => fired.set(name, (fired.get(name) ?? 0) + 1);
const bus = w.bus;
bus.on('wave:start', (e) => { tally('wave:start'); director.onWaveStart(transport, e); });
bus.on('wave:clear', (e) => { tally('wave:clear'); director.onWaveClear(transport, e); });
bus.on('boss:telegraph', (e) => { tally('boss:telegraph'); director.onBossTelegraph(transport, e); });
bus.on('boss:phase', (e) => { tally('boss:phase'); director.onBossPhase(transport, e); });
bus.on('boss:defeat', () => { tally('boss:defeat'); director.onBossDefeat(transport); });
bus.on('player:hit', () => { tally('player:hit'); director.onPlayerHit(); });
bus.on('player:death', () => { tally('player:death'); director.onPlayerDeath(transport); });
/*
 * The bomb is checked for its EFFECT, not just for arriving.
 *
 * Everything else here proves an event reaches a handler. That is a weaker
 * claim than it looks, and this is the one path where the difference has
 * already bitten: `Arranger.fill` records that routing the fill through
 * `request()` put it in `pending`, where a queued section outranked it, so
 * pressing bomb during a `build` produced no fill at all. The handler was
 * reached every single time. A tally would have shown `player:bomb 5x` and
 * proved nothing.
 *
 * So record what the section actually was on either side of the call. A bomb
 * owes a fill unless the arranger is locked (the death `collapse` holds the
 * section deliberately) or a fill is already running.
 */
const bombs = [];
bus.on('player:bomb', () => {
  tally('player:bomb');
  const before = director.readout(transport).section;
  director.onBomb(transport);
  bombs.push({ before, after: director.readout(transport).section });
});
bus.on('powerup:pickup', (e) => { tally('powerup:pickup'); director.onPickup(transport, e.kind); });
bus.on('powerup:expire', (e) => { tally('powerup:expire'); director.onPickup(transport, e.kind); });

const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

/** Highest value each id ever reached, across BOTH maps the score might read. */
const seen = new Map();
/** Archetype names seen with a live count, for the motif check. */
const enemyKeys = new Set();
const note = (obj) => {
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && v > 0) seen.set(k, Math.max(seen.get(k) ?? 0, v));
  }
};

const levels = [];
let waves = 0;
let lastWave = -1;
let nonFinite = 0;

/*
 * The bot MOVES and deliberately BOMBS, and both are load-bearing.
 *
 * It used to hold the stick at zero and never press bomb. Two consequences,
 * both discovered by this file reporting them rather than by anything failing:
 *
 *   - `World` now punishes a parked ship (`campPressure`), so a stationary bot
 *     measures the one state the game treats as not playing.
 *   - The `bomb -> fill` check below began reporting "path unexercised". It
 *     exists specifically to catch a bug where the handler ran and produced no
 *     fill, and a guard that only runs when a random bot happens to press the
 *     button is not a guard. Pressing it on a schedule makes the coverage
 *     deterministic.
 *
 * The bomb is held for a single frame every ~9s: `World` edge-triggers it, and
 * a held button would either repeat or be swallowed depending on that detail,
 * neither of which is what a player does.
 */
const steer = (i) => {
  const tSec = i * DT;
  inp.x = Math.sin(tSec * 3.0) * 0.35;
  inp.y = Math.cos(tSec * 2.3) * 0.25;
  inp.bomb = i % Math.round(9 / DT) === 0 && i > 0;
};

/*
 * BANNERS THAT NEVER GET SEEN.
 *
 * `world.announce` overwrites whatever was there, so two calls inside one
 * `update` mean the first was never rendered. This has happened twice, both
 * times hiding written content nobody noticed was missing:
 *
 *   - every fusion announced itself as "JOINS THE BAND", because the generic
 *     card banner ran after the fusion branch — twelve authored lines ("the
 *     bow starts to bounce") set and replaced inside one call;
 *   - every wave with a MOVEMENT announced FLANKED / SOLOIST / HUSHED and was
 *     overwritten by "WAVE N" forty lines later, so three named mechanics were
 *     announced every time and seen never.
 *
 * SAMPLING THE BANNER PER FRAME CANNOT SEE THIS, and the first version of this
 * check did exactly that: both writes land inside one `update`, so the sampler
 * only ever observes the winner. Re-introducing the movement clobber
 * deliberately produced "0 overwritten" — a check that could not fail for the
 * bug it was written for.
 *
 * So instrument the call instead. Two announces between one frame's updates is
 * the defect, whatever the banners say.
 *
 * COVERAGE CAVEAT: this sees only the banners a six-minute run on one seed
 * actually raises — verified at 12 intercepted announces, and an injected
 * unconditional clobber is caught 3x. A clobber on a rarer path (a movement
 * wave that this run does not reach) would slip through. It is a tripwire on
 * the common paths, not a proof over all of them.
 */
let frameAnnounces = [];
let totalAnnounces = 0;
const clobbered = new Map();
const realAnnounce = w.announce.bind(w);
w.announce = (text, sub = '', kind = 'wave') => {
  frameAnnounces.push(`${text}|${sub}`);
  totalAnnounces++;
  return realAnnounce(text, sub, kind);
};

for (let i = 0; i < STEPS; i++) {
  steer(i);
  if (i % 2 === 0) drive(w, inp);
  frameAnnounces = [];
  w.update(DT, inp);
  // Everything but the last was written over before it could render.
  for (const lost of frameAnnounces.slice(0, -1)) clobbered.set(lost, (clobbered.get(lost) ?? 0) + 1);


  transport.advance(DT);
  director.update(w.snapshot, transport, DT);

  if (i % 30 === 0) {
    const s = w.snapshot;
    note(s.powerups);
    note(s.abilities);
    note(s.enemies);
    for (const [k, v] of Object.entries(s.enemies ?? {})) if (v > 0) enemyKeys.add(k);
    // Wave starts arrive on the bus now, like they do in the real game.
    if (s.wave !== lastWave) { lastWave = s.wave; waves++; }
  }
  if (i % 240 === 0) {
    const r = director.readout(transport);
    for (const v of Object.values(r.levels)) if (!Number.isFinite(v)) nonFinite++;
    levels.push({ ...r.levels });
  }
}

console.log(`wiring — ${MINUTES} simulated minutes of the real World into the real MusicDirector\n`);
let failed = false;

// 1. Does the score's view of the player's kit ever arrive?
const missing = POWERUP_IDS.filter((id) => !seen.has(id));
const arrived = POWERUP_IDS.filter((id) => seen.has(id));
console.log(`  powerup/ability ids read by layers.ts: ${POWERUP_IDS.length}`);
console.log(`    arrived: ${arrived.length ? arrived.map((id) => `${id}=${seen.get(id)}`).join(' ') : '(none)'}`);
if (missing.length) {
  /*
   * Not automatically a failure. An id can be absent because the wiring is
   * broken (the bug this tool exists for) or because the bot never earned it
   * in this run. Those are different problems and conflating them would make
   * the tool cry wolf until nobody reads it.
   */
  console.log(`    NEVER ARRIVED: ${missing.join(' ')}`);
  console.log('      Either the field moved out from under the score, or the bot never earned them.');
  console.log('      Check against `snapshot.abilities` and `snapshot.powerups` before assuming a bug.');
  if (arrived.length === 0) {
    failed = true;
    console.log('      NONE arrived at all — that is a wiring break, not a coverage gap.');
  }
}

// 2. The enemy archetypes the motif layer keys its leitmotifs off.
const archetypes = [...enemyKeys].sort();
console.log(`\n  enemy archetypes that reached the score: ${archetypes.length}`);
console.log(`    ${archetypes.join(' ') || '(none)'}`);
if (archetypes.length === 0) {
  failed = true;
  console.log('    NONE — `snapshot.enemies` is empty, so every enemy leitmotif is silent.');
}

// 3. The director actually responded to a real game.
const stems = Object.keys(levels[0] ?? {});
const moved = stems.filter((id) => {
  const vs = levels.map((l) => l[id] ?? 0);
  return Math.max(...vs) - Math.min(...vs) > 0.02;
});
console.log('\n  director event handlers reached from the real bus:');
for (const name of ['wave:start','wave:clear','boss:telegraph','boss:phase','boss:defeat',
                    'player:hit','player:death','player:bomb','powerup:pickup','powerup:expire']) {
  const n = fired.get(name) ?? 0;
  console.log(`    ${name.padEnd(18)} ${n === 0 ? 'not fired this run' : `${n}x`}`);
}
const owed = bombs.filter((b) => b.before !== 'collapse' && b.before !== 'fill');
const paid = owed.filter((b) => b.after === 'fill');
if (bombs.length === 0) {
  console.log('\n  bomb -> fill: no bomb fired this run, path unexercised');
} else if (paid.length === owed.length) {
  console.log(
    `\n  ok  bomb -> fill: ${paid.length}/${owed.length} bombs produced a fill ` +
      `(from ${[...new Set(owed.map((b) => b.before))].sort().join(', ') || 'no eligible section'})`,
  );
} else {
  failed = true;
  const missed = owed.filter((b) => b.after !== 'fill');
  console.log(`\n  BOMB PRODUCED NO FILL in ${missed.length} of ${owed.length} cases:`);
  for (const m of missed.slice(0, 5)) console.log(`    during '${m.before}' the section stayed '${m.after}'`);
  console.log("    This is the `pending` bug in `Arranger.fill` — the handler ran and did nothing.");
}

if ((fired.get('wave:start') ?? 0) === 0) {
  failed = true;
  console.log('    wave:start NEVER FIRED — the score cannot be hearing the game\'s structure.');
}

console.log(`\n  director driven by real snapshots: ${waves} waves, ${levels.length} samples`);
console.log(`    stems that moved: ${moved.length}/${stems.length}`);
if (nonFinite) {
  failed = true;
  console.log(`    NON-FINITE levels seen ${nonFinite} times`);
} else {
  console.log('    ok  no non-finite levels');
}
if (moved.length === 0) {
  failed = true;
  console.log('    NOTHING MOVED — the director is not seeing the game.');
}

console.log(failed ? '\nWIRING BROKEN' : '\nWIRING HOLDS — the game reaches the score');
console.log(`\n  announces intercepted: ${totalAnnounces}`);
console.log(`  banners overwritten inside one update: ${clobbered.size}`);
if (clobbered.size) {
  failed = true;
  for (const [b, n] of [...clobbered].slice(0, 6)) {
    console.log(`  FAIL  "${b.split('|')[0]}" was overwritten before it rendered (${n}x)`);
  }
} else {
  console.log('  ok  no banner is written over inside the frame that set it');
}

process.exit(failed ? 1 : 0);
