/**
 * decisions — characterises the level-up decision space over real runs.
 *
 * "The game is too simple" is the user's third standing complaint (after the
 * music and "standing still wins", both addressed). This measures the one
 * place a MusicWars run asks the player to decide anything outside aim/dodge:
 * the level-up offer. Drives the REAL `World` and the REAL `progression.ts`
 * offer generator headlessly — no approximated kill/XP model, unlike
 * `tools/levelup.mjs`'s `simulateRun`, which this project's own README already
 * flags as fitted to a stale three-minute window. Movement and the two base
 * card policies (`cardZero`, `builder`) are copied verbatim from
 * `tools/arena.mjs` for the reason its own comment gives: a second hand-rolled
 * driver would measure a different player.
 *
 * Adds two things arena.mjs does not: it reads `w.offer` directly (the full
 * object — level, isNew, completes, character — not the stripped `level:offer`
 * bus payload, which only carries id+grace) at the moment each offer opens,
 * and it adds two policies that actually spend banish/reroll, since neither
 * existing policy in this codebase ever presses those buttons.
 *
 * node --experimental-transform-types tools/decisions.mjs [minutes] [runs]
 */
import '../tools/lib/tsnode.mjs';

const MINUTES = Number(process.argv[2] ?? 20);
const RUNS = Number(process.argv[3] ?? 5);
const DT = 1 / 120;

const { World } = await import('../src/game/world.ts');
const W = await import('../src/game/weapons.ts');

/* Movement: verbatim copy of tools/arena.mjs's `drive`, for the same reason
 * that file gives — a different driver measures a different player. */
function drive(w, inp, pickCard) {
  inp.choice = w.choosing && w.offer ? pickCard(w.offer, w.progression, w) : -1;
  const px = w.player.x, py = w.player.y;
  let rx = 0, ry = 0, danger = 0, closest = 1e9;
  const bl = w.enemyBullets;
  for (let i = 0; i < bl.count; i++) {
    const dx = px - bl.x[i], dy = py - bl.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 > 190 * 190) continue;
    const d = Math.sqrt(d2) || 1;
    closest = Math.min(closest, d);
    const vx = Math.cos(bl.angle[i]) * bl.speed[i], vy = Math.sin(bl.angle[i]) * bl.speed[i];
    const closing = (-dx * vx - dy * vy) / d;
    if (closing <= 0) continue;
    const weight = (1 - d / 190) ** 2 * (1 + closing / 300);
    rx += (dx / d) * weight; ry += (dy / d) * weight;
    if (d < 90) danger += weight;
  }
  for (const e of w.enemies) {
    const dx = px - e.x, dy = py - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > e.radius + 70) continue;
    rx += (dx / d) * 1.5; ry += (dy / d) * 1.5;
  }
  let ax = 0, ay = 0;
  for (const n of [...w.notes, ...w.drops]) {
    const dx = n.x - px, dy = n.y - py;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 300) continue;
    const pull = (n.kind ? 1.6 : 0.5) * (1 - d / 300);
    ax += (dx / d) * pull; ay += (dy / d) * pull;
  }
  const calm = Math.max(0, 1 - danger);
  let mx = rx * 2.2 + ax * calm, my = ry * 2.2 + ay * calm;
  const enc = w.encircled;
  if (enc > 0.35) { mx += Math.cos(w.wayOut) * enc * 1.8; my += Math.sin(w.wayOut) * enc * 1.8; }
  if (px < 110) mx += 1; if (px > w.width - 110) mx -= 1;
  if (py < 110) my += 1; if (py > w.height - 110) my -= 1;
  const len = Math.hypot(mx, my);
  inp.x = len > 0.05 ? mx / len : 0;
  inp.y = len > 0.05 ? my / len : 0;
  inp.focus = closest < 70;
  inp.bomb = danger > 3.2 && w.player.bombs > 0;
  inp.well = danger > 2.2 && w.player.wells > 0;
}

const cardZero = () => 0;

function builderScore(offer, s) {
  const held = Object.entries(s.instruments).filter(([id]) => !W.instrumentDef(id)?.fused);
  held.sort((a, b) => b[1] - a[1]);
  const target = held[0]?.[0] ?? null;
  const recipe = W.FUSIONS.find((fu) => fu.kind === 'evolution' && fu.base === target);
  const catalyst = recipe?.catalyst ?? null;
  const instRoom = Object.keys(s.instruments).length < s.instrumentSlots;
  const rigRoom = Object.keys(s.rig).length < s.rigSlots;
  const scores = offer.options.map((o) => {
    if (o.grace) return 1;
    if (o.completes) return 1000;
    if (o.id === target) return 900;
    if (o.id === catalyst) return 850;
    if (o.isNew && o.slot === 'instrument' && instRoom) return 300;
    if (o.isNew && o.slot === 'rig' && rigRoom) return 280;
    if (o.slot === 'instrument') return 200 + o.level;
    return 150 + o.level;
  });
  return { scores, target, catalyst };
}

function builder(offer, s) {
  const { scores } = builderScore(offer, s);
  let best = 0, bestScore = -1;
  scores.forEach((sc, i) => { if (sc > bestScore) { bestScore = sc; best = i; } });
  return best;
}

/* ------------------------------------------------------------------------ *
 * The two policies nobody in this codebase has measured yet: ones that
 * actually spend banish and reroll, so "is banish/reroll ever right" has an
 * answer instead of a guess. Both otherwise play exactly like `builder`.
 * ------------------------------------------------------------------------ */

/**
 * Real per-option EV proxy: same ladder `builder` uses, just exposed as a
 * threshold. 209 sits just above the highest possible "level up something you
 * already hold, off-plan" score (200 + level 8 = 208), so it excludes those
 * but still counts a new-instrument (300) or new-rig (280) opportunity, or the
 * on-plan target/catalyst/completes scores (850+), as NOT junk.
 */
const JUNK_CEILING = 209;

function builderBanish(offer, s, w) {
  const { scores } = builderScore(offer, s);
  const allJunk = scores.every((sc) => sc < JUNK_CEILING);
  if (allJunk && s.banishes > 0) {
    // Banish the worst non-grace option, freeing that slot for a redraw.
    let worst = -1, worstScore = Infinity;
    offer.options.forEach((o, i) => {
      if (o.grace) return;
      if (scores[i] < worstScore) { worstScore = scores[i]; worst = i; }
    });
    if (worst >= 0) return { banish: worst };
  }
  return { choice: builder(offer, s) };
}

function builderReroll(offer, s, w) {
  const { scores } = builderScore(offer, s);
  const allJunk = scores.every((sc) => sc < JUNK_CEILING);
  if (allJunk && s.rerolls > 0) return { reroll: true };
  return { choice: builder(offer, s) };
}

/**
 * A sparing use of banish: exactly once, on the very first offer of the run,
 * to remove the single lowest-weight item from the pool for good — the
 * "sharpen the pool early" reading of the mechanic's own doc comment in
 * `progression.ts`, as opposed to `builderBanish`'s "banish on sight of
 * anything junky" reflex, which the measured numbers below show is a trap.
 */
function makeBuilderBanishOnce() {
  let used = false;
  return (offer, s) => {
    if (!used && s.banishes > 0) {
      let worst = -1, worstW = Infinity;
      offer.options.forEach((o, i) => {
        if (o.grace || !o.id) return;
        const def = o.slot === 'instrument' ? W.instrumentDef(o.id) : W.rigDef(o.id);
        const wgt = def?.weight ?? 1;
        if (wgt < worstW) { worstW = wgt; worst = i; }
      });
      if (worst >= 0) { used = true; return { banish: worst }; }
    }
    return { choice: builder(offer, s) };
  };
}

function classify(o, instRoom, rigRoom) {
  if (o.grace) return `grace:${o.grace}`;
  if (o.completes) return 'completes-fusion';
  if (o.isNew && o.slot === 'instrument') return instRoom ? 'new-instrument' : 'new-instrument(no-room!)';
  if (o.isNew && o.slot === 'rig') return rigRoom ? 'new-rig' : 'new-rig(no-room!)';
  return o.slot === 'instrument' ? 'level-instrument' : 'level-rig';
}

function runOnce(seed, pickCard, useLevers = false) {
  const w = new World(seed);
  w.start();
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

  const offerLog = [];
  let wasChoosing = false;
  let banishesUsed = 0, rerollsUsed = 0;
  let evolves = 0;
  w.bus.on('ability:evolve', () => evolves++);

  /*
   * `applyOfferInput` reads `input.reroll`/`input.banish` on EVERY simulation
   * step while an offer is open, not once per press — that is correct for a
   * real keypress (down for one frame, driver.mjs-style) but means holding
   * either field `true` across more than one `w.update` call spends the lever
   * again each step. `actedSignature` makes each decision a one-frame pulse:
   * it fingerprints the current offer (its option ids + levers remaining), and
   * a new decision is only made when that fingerprint changes, which happens
   * exactly once per genuine offer/redraw. Every other step, the offer inputs
   * go neutral.
   */
  let actedSignature = null;
  const offerSignature = (o) => `${o.options.map((x) => x.id ?? x.grace).join(',')}|${o.rerollsLeft}|${o.banishesLeft}`;

  const steps = Math.round((MINUTES * 60) / DT);
  for (let i = 0; i < steps; i++) {
    // Detect a freshly opened offer BEFORE acting, so we log it once, fully.
    if (w.choosing && !wasChoosing && w.offer) {
      const o = w.offer;
      const instRoom = Object.keys(w.progression.instruments).length < w.progression.instrumentSlots;
      const rigRoom = Object.keys(w.progression.rig).length < w.progression.rigSlots;
      offerLog.push({
        level: o.level,
        instHeld: Object.keys(w.progression.instruments).length,
        rigHeld: Object.keys(w.progression.rig).length,
        instSlots: w.progression.instrumentSlots,
        rigSlots: w.progression.rigSlots,
        options: o.options.map((opt) => ({ id: opt.id, kind: classify(opt, instRoom, rigRoom), completes: !!opt.completes })),
        rerollsLeft: o.rerollsLeft,
        banishesLeft: o.banishesLeft,
      });
    }
    wasChoosing = w.choosing;

    inp.choice = -1; inp.banish = -1; inp.reroll = false;
    if (w.choosing && w.offer) {
      const sig = offerSignature(w.offer);
      if (sig !== actedSignature) {
        actedSignature = sig;
        if (useLevers) {
          const act = pickCard(w.offer, w.progression, w);
          if (act.banish !== undefined) { inp.banish = act.banish; banishesUsed++; }
          else if (act.reroll) { inp.reroll = true; rerollsUsed++; }
          else { inp.choice = act.choice; }
        } else {
          inp.choice = pickCard(w.offer, w.progression, w);
        }
      }
    } else {
      actedSignature = null;
    }
    // Movement only. `drive`'s first line re-sets `inp.choice`, so pass a
    // "policy" that just echoes back whatever we already decided above rather
    // than clobbering it — the offer decision for this frame is already final.
    if (i % 2 === 0) drive(w, inp, () => inp.choice);
    w.update(DT, inp);
    if (w.isOver) break;
  }

  return { offerLog, level: w.progression.level, evolves, wave: w.waveIndex + 1, banishesUsed, rerollsUsed, instruments: { ...w.progression.instruments }, rig: { ...w.progression.rig } };
}

console.log(`\nDECISIONS — ${RUNS} runs x ${MINUTES}min, headless, real World + real progression.ts\n`);

function summarize(label, rows) {
  const allOffers = rows.flatMap((r) => r.offerLog);
  const n = allOffers.length;
  const perRun = n / rows.length;
  console.log(`\n=== ${label} ===`);
  console.log(`offers/run: ${perRun.toFixed(1)}   final level (mean): ${(rows.reduce((a, r) => a + r.level, 0) / rows.length).toFixed(1)}   fusions (mean): ${(rows.reduce((a, r) => a + r.evolves, 0) / rows.length).toFixed(2)}`);

  const kindCounts = {};
  for (const o of allOffers) for (const opt of o.options) kindCounts[opt.kind] = (kindCounts[opt.kind] ?? 0) + 1;
  console.log('option kinds, across all offered CARDS (4 per offer):');
  for (const [k, v] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${v.toString().padStart(5)}  (${((100 * v) / (4 * n)).toFixed(1)}%)`);
  }

  const zeroNovelty = allOffers.filter((o) => o.options.every((opt) => opt.kind.startsWith('level-'))).length;
  const hasCompletes = allOffers.filter((o) => o.options.some((opt) => opt.completes)).length;
  const anyNew = allOffers.filter((o) => o.options.some((opt) => opt.kind.startsWith('new-'))).length;
  const allGrace = allOffers.filter((o) => o.options.every((opt) => opt.kind.startsWith('grace'))).length;
  const graceOffers = allOffers.filter((o) => o.options.some((opt) => opt.kind.startsWith('grace')));
  const graceDup = graceOffers.filter((o) => {
    const g = o.options.filter((opt) => opt.kind.startsWith('grace')).map((opt) => opt.kind);
    return new Set(g).size < g.length;
  }).length;

  console.log(`offers where all 4 options are "level up something you hold": ${zeroNovelty}/${n} (${((100 * zeroNovelty) / n).toFixed(1)}%)`);
  console.log(`offers with >=1 new-instrument/new-rig option: ${anyNew}/${n} (${((100 * anyNew) / n).toFixed(1)}%)`);
  console.log(`offers with a fusion-completing card present: ${hasCompletes}/${n} (${((100 * hasCompletes) / n).toFixed(1)}%)`);
  console.log(`offers padded with grace cards (pool ran dry): ${graceOffers.length}/${n} (${((100 * graceOffers.length) / n).toFixed(1)}%), all-grace: ${allGrace}`);
  console.log(`grace-padded offers with a DUPLICATE grace kind shown twice: ${graceDup}/${graceOffers.length || 1}`);

  // Split by whether slots (6/6, 6/6) are already full at the moment of the offer.
  const full = allOffers.filter((o) => o.instHeld >= o.instSlots && o.rigHeld >= o.rigSlots);
  console.log(`offers AFTER both slot banks are full (6/6, 6/6): ${full.length}/${n} (${((100 * full.length) / n).toFixed(1)}%)`);
  const fullZeroNovelty = full.filter((o) => o.options.every((opt) => opt.kind.startsWith('level-'))).length;
  console.log(`  of those, all-4-are-"level up" too: ${fullZeroNovelty}/${full.length || 1} (${((100 * fullZeroNovelty) / (full.length || 1)).toFixed(1)}%)`);
  const firstFullAtLevel = full.length ? full[0].level : null;
  console.log(`  first offer at which both banks were already full: level ${firstFullAtLevel}`);

  const banishUsed = rows.reduce((a, r) => a + r.banishesUsed, 0);
  const rerollUsed = rows.reduce((a, r) => a + r.rerollsUsed, 0);
  if (banishUsed || rerollUsed) console.log(`banishes used: ${banishUsed}   rerolls used: ${rerollUsed}`);
}

const seeds = Array.from({ length: RUNS }, (_, r) => 0x51ed + r * 7919);

const rowsZero = seeds.map((s) => runOnce(s, cardZero, false));
summarize('card-0 (the project-standard bot; never rerolls/banishes)', rowsZero);

const rowsBuilder = seeds.map((s) => runOnce(s, builder, false));
summarize('builder (skilled, on-plan; never rerolls/banishes)', rowsBuilder);

const rowsBanish = seeds.map((s) => runOnce(s, builderBanish, true));
summarize('builder+banish (banishes junk cards when the whole offer is junk)', rowsBanish);

const rowsReroll = seeds.map((s) => runOnce(s, builderReroll, true));
summarize('builder+reroll (rerolls when the whole offer is junk)', rowsReroll);

const rowsBanishOnce = seeds.map((s) => runOnce(s, makeBuilderBanishOnce(), true));
summarize('builder+banish-once (one banish, first offer only, lowest-weight item)', rowsBanishOnce);

/**
 * The opposite theory: banish the item COMPETING with your target/catalyst for
 * draw weight, not the weakest one — removing a heavy-weight rival should
 * raise the relative odds of drawing what you actually want. Also fires once,
 * on the first offer that has an identifiable target.
 */
function makeBuilderBanishRival() {
  let used = false;
  return (offer, s) => {
    const { target, catalyst } = builderScore(offer, s);
    if (!used && s.banishes > 0 && target) {
      let worst = -1, worstW = -1;
      offer.options.forEach((o, i) => {
        if (o.grace || !o.id || o.id === target || o.id === catalyst) return;
        const def = o.slot === 'instrument' ? W.instrumentDef(o.id) : W.rigDef(o.id);
        const wgt = def?.weight ?? 1;
        if (wgt > worstW) { worstW = wgt; worst = i; }
      });
      if (worst >= 0) { used = true; return { banish: worst }; }
    }
    return { choice: builder(offer, s) };
  };
}
const rowsBanishRival = seeds.map((s) => runOnce(s, makeBuilderBanishRival(), true));
summarize('builder+banish-rival (one banish, highest-weight non-target competitor)', rowsBanishRival);

console.log('\n=== effect of banish/reroll on the builder (same seeds) ===');
const mean = (rows, g) => rows.reduce((a, r) => a + g(r), 0) / rows.length;
console.log(`  level      builder ${mean(rowsBuilder, (r) => r.level).toFixed(1)}   +banish ${mean(rowsBanish, (r) => r.level).toFixed(1)}   +reroll ${mean(rowsReroll, (r) => r.level).toFixed(1)}   +banish-once ${mean(rowsBanishOnce, (r) => r.level).toFixed(1)}   +banish-rival ${mean(rowsBanishRival, (r) => r.level).toFixed(1)}`);
console.log(`  fusions    builder ${mean(rowsBuilder, (r) => r.evolves).toFixed(2)}   +banish ${mean(rowsBanish, (r) => r.evolves).toFixed(2)}   +reroll ${mean(rowsReroll, (r) => r.evolves).toFixed(2)}   +banish-once ${mean(rowsBanishOnce, (r) => r.evolves).toFixed(2)}   +banish-rival ${mean(rowsBanishRival, (r) => r.evolves).toFixed(2)}`);
console.log(`  wave       builder ${mean(rowsBuilder, (r) => r.wave).toFixed(1)}   +banish ${mean(rowsBanish, (r) => r.wave).toFixed(1)}   +reroll ${mean(rowsReroll, (r) => r.wave).toFixed(1)}   +banish-once ${mean(rowsBanishOnce, (r) => r.wave).toFixed(1)}   +banish-rival ${mean(rowsBanishRival, (r) => r.wave).toFixed(1)}`);

console.log('\n=== final loadout, card-0 run 1 (what a run actually converges on) ===');
console.log('instruments:', rowsZero[0].instruments);
console.log('rig:', rowsZero[0].rig);
console.log('');
