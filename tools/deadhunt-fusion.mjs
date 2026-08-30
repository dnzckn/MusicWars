/**
 * Is the evolution system reachable in a run anybody actually plays?
 *
 * `tools/arena.mjs` reports `fusions 0.00`, and `tools/levelup.mjs` reports that
 * a building player reaches one in 98% of runs. Both are true and they are not
 * in conflict, which is the whole point of this file: they are measuring
 * different things and neither one alone can say whether the feature works.
 *
 * TWO CONFOUNDS HAVE TO BE SEPARATED BEFORE THE QUESTION MEANS ANYTHING.
 *
 *   1. THE HORIZON. `levelup.mjs` sweeps `minutes: 15`. A mortal run in the
 *      real `World` ends somewhere around three to five. A gate that passes at
 *      fifteen minutes says nothing about a game that ends at four, and this
 *      repository has been caught four times by a budget denominated in an
 *      event whose rate then changed — `tools/README.md` lists them.
 *
 *   2. THE POLICY. The arena bot answers every offer with `choice = 0`. That is
 *      not a builder, it is `levelup`'s RANDOM policy with the dice removed,
 *      and random reaches a fusion 26% of the time against builder's 98% BY
 *      DESIGN — the whole thesis of the offer screen is that choosing is the
 *      game. So `arena`'s 0.00 is partly a statement about the bot, and
 *      `arena.mjs` warns about exactly this failure in its own header: "the
 *      whole history of this directory is tools that measured one strategy and
 *      reported it as the game."
 *
 * So this runs the REAL `World` — real kill rate, real XP, real boss pacing,
 * real death — to death rather than to a time cap, under both policies. The
 * builder is copied from `tools/levelup.mjs` rather than reinvented, so any
 * difference between the two tools is the world and not the player.
 *
 * What it cannot tell you: whether a HUMAN builds as well as this policy does.
 * The builder is an ordinary informed player, not an optimal one, but it is
 * still a policy and a policy is not a person.
 *
 *   node --experimental-transform-types tools/deadhunt-fusion.mjs [runs] [maxMinutes]
 */

import './lib/tsnode.mjs';

const RUNS = Number(process.argv[2] ?? 12);
const MAX_MINUTES = Number(process.argv[3] ?? 20);
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const W = await import('../src/game/weapons.ts');
const P = await import('../src/game/progression.ts');

const f = (x, n = 1) => (Number.isFinite(x) ? x.toFixed(n) : String(x));

/* ------------------------------------------------------------------------ *
 * The floor: how many picks the cheapest fusion costs, before any luck
 * ------------------------------------------------------------------------ */

function cheapestFusion() {
  let best = null;
  for (const fu of W.FUSIONS) {
    if (fu.kind !== 'evolution') continue;
    // The starting instrument is already at level 1, so its ladder is one pick
    // shorter than everything else's.
    const baseHeld = fu.base === P.STARTING_INSTRUMENT ? 1 : 0;
    const picks = W.INSTRUMENT_MAX_LEVEL - baseHeld + W.RIG_MAX_LEVEL;
    if (!best || picks < best.picks) best = { ...fu, picks, baseHeld };
  }
  return best;
}

/* ------------------------------------------------------------------------ *
 * Policies
 * ------------------------------------------------------------------------ */

/** What `tools/lib/driver.mjs` and `tools/arena.mjs` do today. */
const cardZero = () => 0;

/**
 * Copied from `tools/levelup.mjs`'s `builder`, deliberately verbatim.
 *
 * If these two drift, the two tools are measuring different players and the
 * comparison between them stops meaning anything — the same argument
 * `arena.mjs` makes for copying the movement policy rather than importing it.
 */
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

/* ------------------------------------------------------------------------ *
 * The movement policy, copied from tools/arena.mjs for the reason it gives
 * ------------------------------------------------------------------------ */

function drive(w, inp, pickCard) {
  inp.choice = w.choosing && w.offer ? pickCard(w.offer, w.progression) : -1;
  const px = w.player.x;
  const py = w.player.y;
  let rx = 0;
  let ry = 0;
  let danger = 0;
  let closest = 1e9;
  // Bodies, not bullets — enemies damage by contact now and there is no enemy
  // bullet pool. Kept written out rather than imported, exactly as the eight
  // copies of the old bullet policy were; `tools/lib/bot-brain.mjs` carries the
  // full reasoning and is the version to keep this in step with.
  for (const e of w.enemies) {
    const dx = px - e.x;
    const dy = py - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 240 * 240) continue;
    const d = Math.sqrt(d2) || 1;
    const edge = Math.max(1, d - e.radius * 0.62);
    closest = Math.min(closest, edge);
    const closing = (-dx * (e.x - e.prevX) - dy * (e.y - e.prevY)) / d;
    const weight =
      (1 - Math.min(1, edge / 240)) ** 2 * (1 + Math.max(0, closing) / 2.5) * (e.lungeTime > 0 ? 2.4 : 1);
    rx += (dx / d) * weight;
    ry += (dy / d) * weight;
    if (edge < 110) danger += weight;
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
  /*
   * TWO WALLS AND A WINDOW. `w.height` is `Infinity` — the arena is bounded
   * across the track and unbounded along it — so the two y terms this
   * replaces were `py < 366`, which is true for every step after the first
   * second of a run: the bot would have held the brake for the whole run. The
   * travel axis is bounded by the TRACK WINDOW instead, read off `World` so
   * this file does not hold its own copy of it. See tools/lib/bot-brain.mjs.
   */
  const wall = w.width * (110 / 900);
  if (px < wall) mx += 1;
  if (px > w.width - wall) mx -= 1;
  const room = (w.trackBack - w.trackFront) * 0.22;
  if (py < w.trackFront + room) my += 1;
  if (py > w.trackBack - room) my -= 1;
  const len = Math.hypot(mx, my);
  inp.x = len > 0.05 ? mx / len : 0;
  inp.y = len > 0.05 ? my / len : 0;
  inp.focus = closest < 70;
  inp.bomb = danger > 3.2 && w.player.bombs > 0;
  inp.well = danger > 2.2 && w.player.wells > 0;
}

/* ------------------------------------------------------------------------ *
 * One run, to death rather than to a clock
 * ------------------------------------------------------------------------ */

function runOnce(seed, pickCard) {
  const w = new World(seed);
  const clock = { t: 0 };
  let offers = 0;
  let bosses = 0;
  const fusionsAt = [];
  // The moment the pair was assembled, which is NOT the moment it resolves:
  // `resolveFusions` only runs on a boss death, so a run can hold a complete
  // recipe and die before the cadenza that would have paid it out.
  let readyAt = -1;

  /*
   * Hits and lives are tracked for one reason: the first run of this tool
   * reported 0 deaths in 12 runs of 20 minutes, and a harness that reports an
   * immortal player is far more likely to have made the player immortal than to
   * have found an immortal player. Nothing here tops up lives — but "nothing
   * here does X" is an inspection, and the point of this directory is to
   * measure instead.
   */
  let hits = 0;
  w.bus.on('player:hit', () => hits++);
  w.bus.on('level:offer', () => offers++);
  w.bus.on('boss:defeat', () => bosses++);
  w.bus.on('ability:evolve', () => fusionsAt.push(clock.t));
  w.bus.on('ability:union', () => fusionsAt.push(clock.t));

  w.start();
  const inp = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    choice: -1, banish: -1, reroll: false, skip: false,
  };

  const steps = Math.round((MAX_MINUTES * 60) / DT);
  let i = 0;
  for (; i < steps; i++) {
    clock.t = i * DT;
    if (i % 2 === 0) drive(w, inp, pickCard);
    w.update(DT, inp);
    w.shocks.length = 0; // the renderer's job; see deadhunt-ranges.mjs
    if (readyAt < 0 && P.readyFusions(w.progression).length > 0) readyAt = clock.t;
    if (w.isOver) break;
  }

  const elapsed = i * DT;
  return {
    elapsed,
    died: w.isOver,
    hits,
    wave: w.waveIndex + 1,
    score: w.score,
    livesLeft: w.player.lives,
    hpLeft: w.player.hp,
    offers,
    bosses,
    level: w.progression.level,
    instruments: Object.keys(w.progression.instruments).length,
    topInstrument: Math.max(0, ...Object.values(w.progression.instruments)),
    topRig: Math.max(0, ...Object.values(w.progression.rig), 0),
    fusions: fusionsAt.length,
    firstFusionAt: fusionsAt.length ? fusionsAt[0] : -1,
    readyAt,
  };
}

/* ------------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------------ */

console.log(`\nDEADHUNT/FUSION — is the evolution system reachable? ${RUNS} runs per policy, to death, cap ${MAX_MINUTES} min\n`);

const cheap = cheapestFusion();
console.log('STATIC — the floor, before any luck at all');
console.log(
  `  cheapest recipe: ${cheap.base} (starts at L${cheap.baseHeld}) -> L${W.INSTRUMENT_MAX_LEVEL}` +
    ` + ${cheap.catalyst} L0 -> L${W.RIG_MAX_LEVEL} = ${cheap.picks} picks, ALL on the right two cards`,
);
console.log(`  every other recipe costs ${W.INSTRUMENT_MAX_LEVEL + W.RIG_MAX_LEVEL} picks`);
console.log(`  ${cheap.picks} picks means reaching level ${cheap.picks + 1}, which costs ${P.xpToReach(cheap.picks + 1)} XP`);
console.log('  and then a BOSS must be beaten afterwards: resolveFusions only runs on a boss death');

const results = {};
for (const [name, pick] of [
  ['card-0 (what arena drives today)', cardZero],
  ['builder (copied from levelup.mjs)', builder],
]) {
  const rows = [];
  for (let r = 0; r < RUNS; r++) rows.push(runOnce(0x51ed + r * 7919, pick));
  results[name] = rows;
  const mean = (g) => rows.reduce((a, x) => a + g(x), 0) / rows.length;
  const withFusion = rows.filter((x) => x.fusions > 0);
  const wasReady = rows.filter((x) => x.readyAt >= 0);
  console.log(`\n${name}`);
  console.log(`  survived            ${f(mean((x) => x.elapsed))}s   (died in ${rows.filter((x) => x.died).length}/${rows.length})`);
  // Lives are shown against maxLives + 2, which is where score extends cap
  // them — not against maxLives, or a healthy run reads as impossible.
  console.log(`  hits taken          ${f(mean((x) => x.hits))}   lives left ${f(mean((x) => x.livesLeft), 2)}/5, hp ${f(mean((x) => x.hpLeft), 2)}`);
  console.log(`  wave reached        ${f(mean((x) => x.wave))}   score ${Math.round(mean((x) => x.score))}`);
  console.log(`  offers taken        ${f(mean((x) => x.offers))}   against ${cheap.picks} needed`);
  console.log(`  level reached       ${f(mean((x) => x.level))}`);
  console.log(`  bosses beaten       ${f(mean((x) => x.bosses), 2)}`);
  console.log(`  best instrument     L${f(mean((x) => x.topInstrument))} of ${W.INSTRUMENT_MAX_LEVEL}    best rig L${f(mean((x) => x.topRig))} of ${W.RIG_MAX_LEVEL}`);
  console.log(`  recipe ever ready   ${wasReady.length}/${rows.length}${wasReady.length ? `  first at ${f(mean(() => 0) + wasReady.reduce((a, x) => a + x.readyAt, 0) / wasReady.length)}s` : ''}`);
  console.log(`  FUSIONS REACHED     ${withFusion.length}/${rows.length}${withFusion.length ? `  first at ${f(withFusion.reduce((a, x) => a + x.firstFusionAt, 0) / withFusion.length)}s` : ''}`);
}

/* ------------------------------------------------------------------------ *
 * The verdict, stated as which of the two confounds it is
 * ------------------------------------------------------------------------ */

console.log('\nVERDICT');
const z = results['card-0 (what arena drives today)'];
const b = results['builder (copied from levelup.mjs)'];
const zf = z.filter((x) => x.fusions > 0).length;
const bf = b.filter((x) => x.fusions > 0).length;
const meanLife = b.reduce((a, x) => a + x.elapsed, 0) / b.length;
const meanOffers = b.reduce((a, x) => a + x.offers, 0) / b.length;

if (bf === 0 && zf === 0) {
  console.log('  NEITHER policy reaches a fusion before the run ends.');
  console.log(`  A building player banks ${f(meanOffers)} offers in ${f(meanLife)}s and the cheapest recipe costs ${cheap.picks}.`);
  console.log('  This is a GATE, not a policy problem: the horizon is too short for the ladder.');
  console.log(`  Note that tools/levelup.mjs sweeps 15 minutes and reports 98%, which is why it passes.`);
} else if (bf > 0 && zf === 0) {
  console.log(`  The BOT was the confound, not the pacing: builder reaches ${bf}/${b.length} where card-0 reaches none.`);
  console.log('  arena.mjs should drive a building policy before its `fusions 0.00` is read as a balance fact.');
} else {
  console.log(`  Both reach fusions (card-0 ${zf}/${z.length}, builder ${bf}/${b.length}); pacing looks live.`);
}
console.log('');
