/**
 * The arena, measured without a browser.
 *
 * `node tools/arena.mjs [minutes] [runs]`
 *
 * The conversion from vertical shmup to survivor arena changed four things that
 * every balance number in this repository was calibrated against — where
 * enemies come from, whether the player has to aim, how long a shape stays on
 * the field, and how many weapons are firing at once — and it changed them all
 * at the same time. `docs/progression.md` warns in as many words that the XP
 * pacing table is built on a kill-rate model and that the arena will move it,
 * and `tools/README.md` records this codebase being caught three separate times
 * by a budget denominated in an event whose rate then changed.
 *
 * So the kill rate had to be measurable, and on this machine it could not be:
 * `/tmp/chromedeps` is gone and there is no Chromium, so every existing balance
 * check fails before it launches. This runs the real `World` in Node at the
 * real fixed timestep with a bot that reads the real field.
 *
 * WHAT IT MEASURES: kills per minute, level pacing against the table in
 * docs/progression.md, how encircled the player actually gets, how much of the
 * roster is on screen, and what a run reaches.
 *
 * WHAT IT CANNOT MEASURE, and do not let a green line here suggest otherwise:
 * anything at all about the music, the renderer, or frame pacing. It also
 * cannot tell you whether the arena is FUN — the bot is a policy, and the whole
 * history of this directory is tools that measured one strategy and reported it
 * as the game.
 *
 * TWO THINGS ABOVE WERE MEASURING THE FIRST FIFTH OF A RUN AND CALLING IT THE
 * RUN. Both are fixed here and both are worth reading before trusting an older
 * number from this file.
 *
 * THE HORIZON. The default was three minutes. Measured with
 * `tools/deadhunt-fusion.mjs`, this bot does not die: 0 deaths in 16 runs of
 * twenty minutes, reaching wave 32-40, staying alive because score extends
 * outrun the lives it loses. So every balance conclusion ever drawn from this
 * file came from the opening three minutes of a run lasting at least twenty.
 * The default is twenty now. Runtime was never the reason it was three —
 * twelve simulated minutes across three runs costs 4.3 seconds of wall clock,
 * so there is no separate long invocation to remember and no short one left
 * lying around as the thing everybody reads.
 *
 * THE CARD POLICY. The bot answers every level-up with `choice = 0`. That is
 * not a neutral default: it is `tools/levelup.mjs`'s RANDOM policy with the
 * dice removed, and random reaches a fusion 26% of the time against a
 * builder's 98% BY DESIGN, because choosing is supposed to be the game. This
 * file's `fusions 0.00` was therefore a fact about the bot and was one report
 * away from entering the record as a fact about the balance.
 *
 * So a BUILDER now runs alongside, and the split is deliberate: card-0 remains
 * the policy every table and every assertion below is computed from, and the
 * builder is reported in its own clearly labelled block and asserted on
 * nowhere. Swapping the gating bot would silently re-baseline both this file's
 * four structural gates and `levelup.mjs`'s INCOME model, and the next person
 * to see a number move could not tell whether the game had changed or the
 * player had.
 */

import '../tools/lib/tsnode.mjs';

const MINUTES = Number(process.argv[2] ?? 20);
const RUNS = Number(process.argv[3] ?? 3);
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const W = await import('../src/game/weapons.ts');

/**
 * The same policy as `tools/lib/driver.mjs`, in-process.
 *
 * Deliberately a copy rather than an import: that file is a string evaluated
 * inside a page and cannot be required from Node. Keeping them in step matters
 * — if they diverge, the browser checks and this one are measuring different
 * players — so any change to one belongs in both, and the shared parts are
 * written the same way on purpose.
 */
function drive(w, inp, pickCard) {
  inp.choice = w.choosing && w.offer ? pickCard(w.offer, w.progression) : -1;

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
  // Wall repulsion, scaled to the field, not a fixed 110px: on a bigger arena
  // a 110px margin goes inert and every number here re-baselines against a
  // player that quietly changed. See tools/lib/bot-brain.mjs for the full
  // reasoning. Math.min(900, 1120) * (110/900) is exactly 110, so this is a
  // no-op at today's field size.
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

/* ------------------------------------------------------------------------ *
 * The two card policies
 *
 * `cardZero` is what this file has always driven and is the one that gates.
 * `builder` is copied verbatim from `tools/levelup.mjs` rather than imported or
 * rewritten — the same argument the movement policy above makes for being a
 * copy. If the two drift, this file and `levelup` are measuring different
 * players and the comparison between their fusion rates stops meaning anything.
 * ------------------------------------------------------------------------ */

const cardZero = () => 0;

function builder(offer, s) {
  const held = Object.entries(s.instruments).filter(([id]) => !W.instrumentDef(id)?.fused);
  held.sort((a, b) => b[1] - a[1]);
  const target = held[0]?.[0] ?? null;
  const recipe = W.FUSIONS.find((fu) => fu.kind === 'evolution' && fu.base === target);
  const catalyst = recipe?.catalyst ?? null;
  const instRoom = Object.keys(s.instruments).length < s.instrumentSlots;
  const rigRoom = Object.keys(s.rig).length < s.rigSlots;

  let best = 0;
  let bestScore = -1;
  offer.options.forEach((o, i) => {
    let score;
    if (o.grace) score = 1;
    else if (o.completes) score = 1000;
    else if (o.id === target) score = 900;
    else if (o.id === catalyst) score = 850;
    else if (o.isNew && o.slot === 'instrument' && instRoom) score = 300;
    else if (o.isNew && o.slot === 'rig' && rigRoom) score = 280;
    else if (o.slot === 'instrument') score = 200 + o.level;
    else score = 150 + o.level;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function quantiles(xs) {
  if (!xs.length) return { p10: 0, p50: 0, p90: 0, max: 0 };
  const a = xs.slice().sort((x, y) => x - y);
  const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9), max: a[a.length - 1] };
}

function runOnce(seed, pickCard) {
  const w = new World(seed);
  // Shared mutable clock: the bus handlers below fire from inside `update` and
  // need the simulated time, which the step loop owns.
  const clock = { t: 0 };
  let kills = 0;
  let hits = 0;
  let offers = 0;
  let choices = 0;
  let evolves = 0;
  /*
   * Boss fights are timed here because `tools/bosslength.mjs` cannot run
   * without a browser, and because the arena is exactly the change most likely
   * to break a boss: the fight is one enemy that the player is running away
   * from, which is the case a facing-based weapon handles worst. The first
   * arena build produced a run that spent four minutes on one boss and the
   * cause was invisible until this column existed.
   */
  const bossFights = [];
  let bossStart = -1;
  w.bus.on('boss:spawn', () => {
    bossStart = clock.t;
  });
  w.bus.on('boss:defeat', () => {
    if (bossStart >= 0) bossFights.push(clock.t - bossStart);
    bossStart = -1;
  });
  w.bus.on('enemy:death', (e) => {
    if (e.byPlayer) kills++;
  });
  w.bus.on('player:hit', () => hits++);
  w.bus.on('level:offer', () => offers++);
  w.bus.on('level:choice', () => choices++);
  w.bus.on('ability:evolve', () => evolves++);

  w.start();
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

  const steps = Math.round((MINUTES * 60) / DT);
  // Level at each whole minute, so the result lines up with the pacing table
  // in docs/progression.md rather than needing to be re-derived.
  const levelAt = [];
  const killsPerMinute = [];
  const hpAt = [];
  let lastMinuteKills = 0;
  const enc = [];
  const near = [];
  /*
   * ALIVE vs ON SCREEN, and they stopped being the same number.
   *
   * This file recorded `w.enemies.length` under the label "enemies" and that
   * was honest while the field was one screen. It is now 3000x3000 with a
   * camera showing 900x1120 — 11% of the area — so `enemies.length` counts
   * shapes the player cannot see, and the density question this whole
   * workstream turns on ("is the arena emptier?") is a question about the
   * screen. Reporting only the field count is precisely the silent re-baseline
   * `docs/research-camera.md` §7b warns about: nothing crashes, the number
   * even goes UP, and it is answering a different question than it was.
   *
   * Both are kept. `alive` is what wave completion and `targetOnScreen()` are
   * denominated in, so it still matters; `onScreen` is what the player
   * experiences.
   */
  const alive = [];
  const onScreen = [];
  const bullets = [];
  const bulletsOnScreen = [];
  const inView = (x, y) =>
    x >= w.camera.viewX && x <= w.camera.viewX + w.viewW && y >= w.camera.viewY && y <= w.camera.viewY + w.viewH;
  let choosingSteps = 0;
  let diedAt = -1;

  for (let i = 0; i < steps; i++) {
    // The bot re-plans at 60Hz against a 120Hz sim, which is roughly what the
    // browser driver's 16ms interval gives it. Planning every step would make
    // this bot sharper than the one every other check in here uses.
    clock.t = i * DT;
    if (i % 2 === 0) drive(w, inp, pickCard);
    w.update(DT, inp);
    if (w.choosing) choosingSteps++;
    if (i % 12 === 0) {
      enc.push(w.encircled);
      near.push(w.threatDistance);
      alive.push(w.enemies.length);
      onScreen.push(w.enemies.reduce((n, e) => n + (inView(e.x, e.y) ? 1 : 0), 0));
      bullets.push(w.enemyBullets.count);
      let bv = 0;
      for (let k = 0; k < w.enemyBullets.count; k++) {
        if (inView(w.enemyBullets.x[k], w.enemyBullets.y[k])) bv++;
      }
      bulletsOnScreen.push(bv);
    }
    // Sampled by step index, not by comparing accumulated float seconds to a
    // whole number — `i * DT` lands on 59.99999 far more often than on 60.
    if (i > 0 && i % Math.round(60 / DT) === 0) {
      levelAt.push(w.progression.level);
      // Kills in THIS minute, not cumulative. The XP model in
      // `tools/levelup.mjs` is a per-second kill rate that ramps, so it can
      // only be calibrated against a per-minute series — a run total hides the
      // ramp entirely and would fit the wrong curve perfectly.
      killsPerMinute.push(kills - lastMinuteKills);
      lastMinuteKills = kills;
      hpAt.push(w.enemies.length ? Math.round(w.enemies.reduce((a, e) => a + e.maxHp, 0) / w.enemies.length) : 0);
    }
    if (w.isOver && diedAt < 0) diedAt = i * DT;
    if (w.isOver) break;
  }

  const elapsed = diedAt >= 0 ? diedAt : MINUTES * 60;
  return {
    elapsed,
    died: diedAt >= 0,
    kills,
    killsPerMin: (kills / elapsed) * 60,
    hits,
    wave: w.waveIndex + 1,
    level: w.progression.level,
    levelAt,
    killsPerMinute,
    hpAt,
    offers,
    choices,
    evolves,
    instruments: Object.keys(w.progression.instruments).length,
    rig: Object.keys(w.progression.rig).length,
    dps: w.ensembleDps(),
    score: w.score,
    shardsLeft: w.notes.length,
    choosingFraction: (choosingSteps * DT) / elapsed,
    bossFights,
    bossStuck: bossStart >= 0 ? elapsed - bossStart : 0,
    enc: quantiles(enc),
    near: quantiles(near),
    alive: quantiles(alive),
    onScreen: quantiles(onScreen),
    bullets: quantiles(bullets),
    bulletsOnScreen: quantiles(bulletsOnScreen),
  };
}

// `rows` is card-0 and is what every table and every assertion below reads.
// The builder set is reported in its own block and gates nothing.
const rows = [];
for (let r = 0; r < RUNS; r++) rows.push(runOnce(0x51ed + r * 7919, cardZero));
const builderRows = [];
for (let r = 0; r < RUNS; r++) builderRows.push(runOnce(0x51ed + r * 7919, builder));

const mean = (f) => rows.reduce((a, x) => a + f(x), 0) / rows.length;
const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);

console.log(`\nARENA — ${RUNS} runs of up to ${MINUTES} min, headless, no browser`);
console.log('Every table and every gate below is the CARD-0 bot. The builder is reported at the end.\n');
console.log('  run   survived  wave  lvl   kills  kills/min  hits   nominal dps  inst/rig');
for (const [i, r] of rows.entries()) {
  console.log(
    `  ${String(i + 1).padStart(3)}   ${f1(r.elapsed).padStart(7)}s  ${String(r.wave).padStart(4)}  ${String(r.level).padStart(3)}   ` +
      `${String(r.kills).padStart(5)}  ${f1(r.killsPerMin).padStart(9)}  ${String(r.hits).padStart(4)}   ` +
      `${f1(r.dps).padStart(11)}  ${r.instruments}/${r.rig}${r.died ? '   DIED' : ''}`,
  );
}

console.log('\nLEVEL PACING (level at each whole minute; compare docs/progression.md)');
const maxMin = Math.max(...rows.map((r) => r.levelAt.length));
for (let m = 0; m < maxMin; m++) {
  const vals = rows.map((r) => r.levelAt[m]).filter((v) => v !== undefined);
  if (!vals.length) continue;
  console.log(`  ${m + 1}m   L${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}   (${vals.join(' ')})`);
}

/*
 * The two columns `tools/levelup.mjs` needs.
 *
 * That tool models a run as a per-second kill rate against a per-wave enemy hp,
 * and both were written as an approximation of the VERTICAL game's numbers
 * because the arena did not exist yet — its own comment says so and says to
 * re-read the pacing table once the arena is measurable. This is that
 * measurement, printed in the shape the model takes so nobody has to derive it.
 */
/*
 * THESE NUMBERS MOVED WHEN THE HORIZON DID, and `levelup.mjs` has not been
 * refitted to them.
 *
 * That model reads "mob hp on the field runs 50-140 across the waves a run
 * reaches" and "kills run 0.48/s at the start rising to..." — both fitted to
 * this file when it stopped at three minutes. Over twenty, mob hp on the field
 * reaches the high hundreds and per-minute kills run three to six times the
 * old figure, because the player's output compounds across a run and the
 * three-minute window only ever saw the start of that.
 *
 * So the shape of the curve changed, not just its scale, and copying the new
 * numbers into the old two-parameter model would fit the wrong thing. Refitting
 * it is a job in itself and it belongs to whoever owns the XP curve; this note
 * is here so the mismatch is found deliberately rather than by someone
 * wondering why the two tools disagree.
 */
console.log('\nINCOME, PER MINUTE (kills that minute / mean enemy maxHp on field)');
console.log('  (levelup.mjs is still fitted to the old 3-minute window — see the note in the source)');
{
  const n = Math.max(...rows.map((r) => r.killsPerMinute.length));
  for (let m = 0; m < n; m++) {
    const k = rows.map((r) => r.killsPerMinute[m]).filter((v) => v !== undefined);
    const h = rows.map((r) => r.hpAt[m]).filter((v) => v !== undefined && v > 0);
    if (!k.length) continue;
    const mk = k.reduce((a, b) => a + b, 0) / k.length;
    const mh = h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
    console.log(`  ${m + 1}m   ${f1(mk).padStart(6)} kills   hp ${String(Math.round(mh)).padStart(4)}   (${k.join(' ')})`);
  }
}

console.log('\nTHE DANGER SIGNAL (p10 / p50 / p90 / max over the run)');
const q = (pick, fmt = f2) => {
  const p10 = mean((r) => pick(r).p10);
  const p50 = mean((r) => pick(r).p50);
  const p90 = mean((r) => pick(r).p90);
  const mx = mean((r) => pick(r).max);
  return `${fmt(p10)} / ${fmt(p50)} / ${fmt(p90)} / ${fmt(mx)}`;
};
console.log(`  encirclement    ${q((r) => r.enc)}`);
console.log(`  nearest threat  ${q((r) => r.near)}`);
console.log(`  enemies alive   ${q((r) => r.alive, f1)}   (anywhere in the ${new World(1).width}x${new World(1).height} field)`);
console.log(`  enemies ON SCREEN ${q((r) => r.onScreen, f1)}   <- the density number`);
console.log(`  bullets alive   ${q((r) => r.bullets, f1)}`);
console.log(`  bullets ON SCREEN ${q((r) => r.bulletsOnScreen, f1)}`);

console.log('\nBOSSES (seconds from arrival to kill; STUCK is a fight still running at the end)');
for (const [i, r] of rows.entries()) {
  const fought = r.bossFights.map((s) => f1(s)).join(', ') || 'none reached';
  console.log(`  run ${i + 1}   ${fought}${r.bossStuck > 0 ? `   STUCK ${f1(r.bossStuck)}s` : ''}`);
}

/*
 * The same seeds, the same movement, one difference: how the level-up is
 * answered.
 *
 * This block exists because `fusions 0.00` was read off the card-0 column and
 * was very nearly recorded as a balance fact. It is a fact about a bot that
 * always presses 1. The floor for the cheapest recipe is twelve picks all
 * landing on the right two cards — PIZZICATO, already held, to level 8 plus
 * CAPO to level 5 — and then a boss has to die, because `resolveFusions` only
 * runs on `onBossDefeated`. A builder clears that; card-0 mostly does not.
 *
 * Nothing here is asserted on. It is the control that says which of this
 * file's numbers are properties of the game and which are properties of the
 * player, and that distinction is the one this directory keeps losing.
 */
console.log('\nTWO PLAYERS (same seeds, same movement; only the level-up answer differs)');
{
  const col = (rs, g) => rs.reduce((a, x) => a + g(x), 0) / rs.length;
  const line = (label, g, fmt = f1) =>
    console.log(`  ${label.padEnd(20)} card-0 ${String(fmt(col(rows, g))).padStart(9)}    builder ${String(fmt(col(builderRows, g))).padStart(9)}`);
  line('survived (s)', (r) => r.elapsed);
  line('wave', (r) => r.wave);
  line('level', (r) => r.level);
  line('kills/min', (r) => r.killsPerMin);
  line('hits taken', (r) => r.hits);
  line('nominal dps', (r) => r.dps);
  line('fusions', (r) => r.evolves, f2);
  const reach = (rs) => `${rs.filter((r) => r.evolves > 0).length}/${rs.length}`;
  console.log(`  ${'runs with a fusion'.padEnd(20)} card-0 ${reach(rows).padStart(9)}    builder ${reach(builderRows).padStart(9)}`);
}

console.log('\nPROGRESSION');
console.log(`  offers opened   ${f1(mean((r) => r.offers))}`);
// The number the XP curve is actually tuned against. A level-up STOPS the world
// and asks the player to read four cards, so how OFTEN it happens is a pacing
// decision in its own right, independent of how far the run gets — and now that
// it is a true pause, frequency is the whole cost: it no longer takes danger
// from the player, only momentum from the run.
console.log(`  one offer every ${f1(mean((r) => r.elapsed / Math.max(1, r.offers)))}s`);
console.log(`  cards taken     ${f1(mean((r) => r.choices))}`);
console.log(`  fusions         ${f2(mean((r) => r.evolves))}`);
console.log(`  time paused     ${(mean((r) => r.choosingFraction) * 100).toFixed(1)}% of the run`);

/*
 * Three properties are asserted and the rest is reported.
 *
 * The bar is deliberately low and it is deliberately about STRUCTURE rather
 * than about balance. Every threshold this repository has ever set on a
 * balance number has ended up sitting inside its own run-to-run spread —
 * `tools/README.md` lists four of them failing on unchanged builds — and the
 * arena's numbers have not been looked at by a person even once yet, so any
 * balance gate written today would be a guess with an exit code.
 *
 * What CAN be asserted is that the machine turns over: things die, levels
 * arrive, and the encirclement is neither absent nor total.
 */
let bad = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) bad++;
};
console.log('\nSTRUCTURE');
const kpm = mean((r) => r.killsPerMin);
check(kpm > 4, 'the player can kill things', `${f1(kpm)} kills/min`);
check(mean((r) => r.level) > 2, 'levels arrive', `L${f1(mean((r) => r.level))} reached`);
const encP90 = mean((r) => r.enc.p90);
const encP10 = mean((r) => r.enc.p10);
check(encP90 > 0.25, 'the player does get surrounded', `p90 encirclement ${f2(encP90)}`);
check(encP10 < 0.9, 'and does get out again', `p10 encirclement ${f2(encP10)}`);

console.log(bad === 0 ? '\nARENA HOLDS\n' : `\n${bad} STRUCTURAL FAILURE(S)\n`);
process.exit(bad === 0 ? 0 : 1);
