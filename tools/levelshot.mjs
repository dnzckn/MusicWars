/**
 * The level-up screen: does it draw, and does it draw where it thinks it does?
 *
 * `tools/levelup.mjs` is a different check with a confusingly similar name (the
 * same collision `progression.mjs` already has): that one exercises the pure
 * progression system with no browser at all. This one is about pixels.
 *
 * It exists because this screen has a silent failure mode that no amount of
 * playing finds reliably: **the cards draw in one place and `hitTest` believes
 * they are in another**, so the player clicks PIZZICATO and receives SNARE
 * ROLL. Nothing about that looks like a bug — the wrong ability just quietly
 * joins the band — and the only way to catch it is to compare the layout
 * against the hit-test rather than to look at a screenshot.
 *
 * Four things are asserted, and the last of them is the one that needs a
 * control:
 *
 *   1. **Card count equals option count.** This is the grace-card bug, made
 *      permanent. `level:offer` used to be built with `.filter(x => x !== null)`
 *      which dropped grace options and desynchronised every index behind them.
 *      Passing four options must draw four cards, and one of the states below
 *      is deliberately all-grace so a regression cannot hide in a state nobody
 *      tests.
 *   2. **`hitTest` at the centre of card i returns i**, for every card, in
 *      every state. Rectangles are also checked for overlap and for staying on
 *      the canvas.
 *   3. **`completes` is set when a pick would finish a fusion.** The state
 *      below is built one level short of CARILLON on purpose, because
 *      `docs/progression.md` is explicit that the whole evolution table is
 *      worthless if the player cannot see it coming.
 *   4. **The screen actually paints.** Mean alpha over the card region with the
 *      offer open, against the same region with it closed, measured in the same
 *      session. Without that control the check would pass on a screen that
 *      renders nothing, because the vignette alone puts a nonzero value in
 *      every pixel of the overlay — the exact shape of mistake `everypowerup`
 *      made when it compared two moments and called the arrangement's own drift
 *      a change.
 *
 * Screenshots are written for a human as well, because none of the above can
 * say whether the thing is any good to look at.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';
import { ensureChromeDeps } from './lib/chromedeps.mjs';
import { autoClose } from './lib/autoclose.mjs';

const OUT = process.env.OUT ?? '/tmp';

// This box has no system NSS and no root, so Chromium cannot start without an
// extracted copy on LD_LIBRARY_PATH. See lib/chromedeps.mjs — the directory has
// been cleaned out of /tmp once already and took a session with it.
console.log(await ensureChromeDeps());

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
// This tool exists to trip assertions, so it is the likeliest in the directory
// to die before its own `b.close()`. See lib/autoclose.mjs — a leaked headless
// Chromium wedged this box for over two hours and could not be killed.
autoClose(b);
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await installDriver(p, 'dodge');
// Long enough for the arrangement to assemble and for enemies to be on the
// field: the offer backdrop is translucent on purpose, so an empty playfield
// behind it would flatter the screenshots.
await p.waitForTimeout(9000);

/** Mean alpha of the overlay canvas over a rectangle, 0..255. */
const alphaOver = (rect) =>
  p.evaluate((r) => {
    const c = document.getElementById('overlay');
    const g = c.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(r.x | 0, r.y | 0, Math.max(1, r.w | 0), Math.max(1, r.h | 0)).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    return sum / (d.length / 4);
  }, rect);

/**
 * Put a loadout and an offer on screen.
 *
 * The abilities map is written straight into the snapshot the renderer reads.
 * That is the point of building the overlay against the field contract rather
 * than against live data: the arena conversion that will populate these fields
 * for real is landing in another workstream, and this screen had to be
 * developable and checkable before it arrives.
 */
const show = (abilities, offer, slots = { i: 3, r: 3 }) =>
  p.evaluate(
    ({ abilities, offer, slots }) => {
      const s = window.__musicwars.world.snapshot;
      // Mutated in place, never reassigned: the director holds this reference
      // across frames. See `everypowerup` in tools/README.md.
      for (const k of Object.keys(s.abilities)) delete s.abilities[k];
      Object.assign(s.abilities, abilities);
      s.instrumentSlots = slots.i;
      s.rigSlots = slots.r;
      s.level = offer.level;
      s.xp = offer.xp ?? 3;
      s.xpToNext = offer.xpToNext ?? 12;
      /*
       * `choosing` is pinned, not assigned.
       *
       * The overlay closes on the falling edge of `snapshot.choosing`, and the
       * world rewrites the whole snapshot every frame from its own state — so a
       * plain `s.choosing = true` survives exactly one frame and the screen
       * would be gone before the shutter. An accessor that always reads true
       * and swallows writes holds it open until `close()` puts the plain
       * property back.
       */
      Object.defineProperty(s, 'choosing', { configurable: true, get: () => true, set: () => {} });
      window.__musicwars.ui.offer(offer);
    },
    { abilities, offer, slots },
  );

const opt = (id, grace = null) => ({ id, grace });

/*
 * Four states, chosen to cover the ones a run actually passes through and the
 * two that are hardest to reach by playing.
 */
const STATES = [
  {
    name: 'early',
    why: 'level 3, one instrument held, everything on offer is a new recruit',
    abilities: { pizzicato: 2 },
    slots: { i: 3, r: 3 },
    offer: { level: 3, queued: 0, rerolls: 2, banishes: 1, options: [opt('snare'), opt('bow'), opt('capo'), opt('chime')] },
    expect: {},
  },
  {
    name: 'building',
    why: 'mid run, slots filling, a mix of upgrades and recruits, one queued',
    abilities: { pizzicato: 5, chime: 6, drones: 2, capo: 3, resonance: 3 },
    slots: { i: 4, r: 4 },
    offer: {
      level: 14,
      queued: 1,
      rerolls: 1,
      banishes: 1,
      options: [opt('chime'), opt('resonance'), opt('timpani'), opt('laser')],
    },
    expect: {},
  },
  {
    name: 'onefromfusion',
    why: 'CHIME is maxed and RESONANCE is one level short, so a card completes CARILLON',
    abilities: { pizzicato: 8, chime: 8, drones: 4, capo: 5, resonance: 4, laser: 2 },
    slots: { i: 5, r: 5 },
    offer: {
      level: 26,
      queued: 0,
      rerolls: 1,
      banishes: 0,
      // resonance 4 -> 5 maxes the catalyst against a maxed CHIME: CARILLON.
      options: [opt('resonance'), opt('drones'), opt('laser'), opt('bow')],
    },
    // pizzicato 8 + capo 5 are both already maxed, so SPICCATO is standing by.
    expect: { completesOn: 0, readyFusion: true },
  },
  {
    name: 'grace',
    why: 'both inventories full and maxed — the state that used to draw an empty screen',
    abilities: {
      pizzicato: 8, chime: 8, drones: 8, snare: 8, bow: 8, harp: 8,
      capo: 5, resonance: 5, laser: 5, spread: 5, rapid: 5, magnet: 5,
    },
    slots: { i: 6, r: 6 },
    offer: {
      level: 41,
      queued: 2,
      rerolls: 0,
      banishes: 0,
      options: [opt(null, 'rest'), opt(null, 'bomb'), opt(null, 'shards'), opt(null, 'rest')],
    },
    expect: { readyFusion: true },
  },
];

console.log('\nOFFER SCREEN');

// The control: the same region with nothing open, measured in this session
// rather than assumed. Taken first so it cannot include a fading exit.
await p.evaluate(() => {
  // Undo the pinned accessor from `show()` before closing, or the world can
  // never turn `choosing` off again and the next state opens against a lie.
  const s = window.__musicwars.world.snapshot;
  Object.defineProperty(s, 'choosing', { configurable: true, writable: true, value: false });
  window.__musicwars.ui.close();
});
await p.waitForTimeout(700);

/*
 * The view size, read off the running game rather than written down.
 *
 * Read from the page instead of imported from `src/game/field.ts` for the same
 * reason `contrast.mjs` does it: this file has a live world in front of it, and
 * the value the world is laying the cards out with is stronger evidence than
 * the value the source says it should be. It also keeps `levelshot` runnable
 * without the TypeScript transform flag, which the rest of the file does not
 * need.
 */
const { VIEW_W, VIEW_H } = await p.evaluate(() => ({
  VIEW_W: window.__musicwars.world.viewW,
  VIEW_H: window.__musicwars.world.viewH,
}));
console.log(`  view ${VIEW_W}x${VIEW_H} (field ${await p.evaluate(() => `${window.__musicwars.world.width}x${window.__musicwars.world.height}`)})`);

/*
 * THE CARD REGION IS MEASURED, NOT WRITTEN DOWN.
 *
 * This was `{ x: 56, y: 200, w: 788, h: 560 }` — the card column of a 900x1120
 * view, hardcoded. AGENTS.md §3: a tool holding its own copy of a constant will
 * lie the day it moves, and `tools/contrast.mjs` is in this directory precisely
 * because it did exactly this and reported a total readability failure that was
 * its own. `VIEW_W`/`VIEW_H` are the window now, and `layout()` additionally
 * caps the cards at `CARD_MAX_W` and centres them, so a rectangle derived even
 * from the live view would be a second copy of a layout rule.
 *
 * So: open one state, ask the overlay where it actually drew, take the union of
 * those rectangles, close, and measure the closed control over the same union.
 * The region is now whatever the screen says it is.
 */
await show(STATES[0].abilities, STATES[0].offer, STATES[0].slots);
await p.waitForTimeout(900);
const probe = await p.evaluate(() => window.__musicwars.ui.rects());
await p.evaluate(() => {
  const s = window.__musicwars.world.snapshot;
  Object.defineProperty(s, 'choosing', { configurable: true, writable: true, value: false });
  window.__musicwars.ui.close();
});
await p.waitForTimeout(700);
if (!probe.length) {
  fail('the offer drew no cards at all, so there is no region to measure');
}
const CARD_REGION = {
  x: Math.min(...probe.map((r) => r.x)),
  y: Math.min(...probe.map((r) => r.y)),
  w: Math.max(...probe.map((r) => r.x + r.w)) - Math.min(...probe.map((r) => r.x)),
  h: Math.max(...probe.map((r) => r.y + r.h)) - Math.min(...probe.map((r) => r.y)),
};
console.log(
  `  card region, read off the overlay: ${Math.round(CARD_REGION.w)}x${Math.round(CARD_REGION.h)}` +
    ` at ${Math.round(CARD_REGION.x)},${Math.round(CARD_REGION.y)} of a ${VIEW_W}x${VIEW_H} view`,
);
const closedAlpha = await alphaOver(CARD_REGION);
console.log(`  control: overlay alpha over the card region with nothing open = ${closedAlpha.toFixed(1)}`);

for (const st of STATES) {
  await show(st.abilities, st.offer, st.slots);
  // Past the staggered entry (4 cards x 0.07s stagger + 0.26s) and the
  // ensemble/controls fades, so nothing is measured mid-animation.
  await p.waitForTimeout(900);

  const got = await p.evaluate(() => ({
    rects: window.__musicwars.ui.rects(),
    cards: window.__musicwars.ui.summary(),
    hits: window.__musicwars.ui
      .rects()
      .map((r) => window.__musicwars.ui.hitTest(r.x + r.w / 2, r.y + r.h / 2)),
  }));

  console.log(`\n  ${st.name} — ${st.why}`);
  console.log(`    cards: ${got.cards.map((c) => `${c.label}${c.isNew ? '(new)' : ` ${c.from}->${c.level}`}`).join('  ')}`);

  // 1. every option got a card.
  if (got.cards.length !== st.offer.options.length) {
    fail(`${st.name}: ${st.offer.options.length} options offered, ${got.cards.length} cards drawn`);
  } else {
    pass(`${st.name}: ${got.cards.length} options -> ${got.cards.length} cards`);
  }

  // 2. hit-test agrees with the layout.
  const bad = got.hits.map((h, i) => (h === i ? null : `${i}->${h}`)).filter(Boolean);
  if (bad.length) fail(`${st.name}: hitTest disagrees with layout at ${bad.join(', ')}`);
  else pass(`${st.name}: hitTest returns the drawn card at every centre`);

  /*
   * The VIEW, imported, not `900x1120` written down twice in one line.
   *
   * The cards are laid out against `VIEW_W/VIEW_H` — `renderer.ts` passes
   * exactly that pair into `levelUp.draw` and `main.ts` hit-tests in the same
   * space — so this bound has to be the view. It also has to be imported:
   * AGENTS.md §3, a tool holding its own copy of a constant lies the day it
   * moves, and this file said "the 900x1120 field" in its failure message
   * while the field became 3000x3000. It was never the field.
   */
  const off = got.rects.filter((r) => r.x < 0 || r.y < 0 || r.x + r.w > VIEW_W || r.y + r.h > VIEW_H);
  if (off.length) fail(`${st.name}: ${off.length} card(s) fall outside the ${VIEW_W}x${VIEW_H} view`);

  let overlap = 0;
  for (let i = 0; i < got.rects.length; i++) {
    for (let j = i + 1; j < got.rects.length; j++) {
      const a = got.rects[i];
      const c = got.rects[j];
      if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) overlap++;
    }
  }
  if (overlap) fail(`${st.name}: ${overlap} pair(s) of cards overlap`);

  // 3. the fusion preview.
  if (st.expect.completesOn !== undefined) {
    const c = got.cards[st.expect.completesOn];
    if (!c?.completes) fail(`${st.name}: card ${st.expect.completesOn} should complete a fusion and says null`);
    else pass(`${st.name}: card ${st.expect.completesOn} announces ${c.completes}`);
  }

  // 4. it painted, against the control taken above.
  const a = await alphaOver(CARD_REGION);
  if (a < closedAlpha + 40) {
    fail(`${st.name}: card region alpha ${a.toFixed(1)} vs ${closedAlpha.toFixed(1)} closed — the screen did not paint`);
  } else {
    pass(`${st.name}: card region alpha ${a.toFixed(1)} against ${closedAlpha.toFixed(1)} closed`);
  }

  await p.screenshot({ path: `${OUT}/levelup-${st.name}.png` });
  await p.evaluate(() => {
  // Undo the pinned accessor from `show()` before closing, or the world can
  // never turn `choosing` off again and the next state opens against a lie.
  const s = window.__musicwars.world.snapshot;
  Object.defineProperty(s, 'choosing', { configurable: true, writable: true, value: false });
  window.__musicwars.ui.close();
});
  await p.waitForTimeout(700);
}

/* ------------------------------------------------------------- the payoff */

console.log('\nFUSION');

for (const [kind, a, c, to] of [
  ['evolution', 'chime', 'resonance', 'carillon'],
  ['union', 'chorale', 'cathedral', 'requiem'],
]) {
  await p.evaluate((v) => window.__musicwars.ui.celebrate(v.kind, v.a, v.c, v.to), { kind, a, c, to });
  // Past the 0.9s converge and the burst, into the hold.
  await p.waitForTimeout(1500);
  /*
   * The celebration is drawn centred on the view, so its probe is a band across
   * the middle expressed as a FRACTION of the live view rather than the four
   * pixel constants that used to be here. Same reason as the card region above;
   * this one cannot be read back off the overlay because `celebrate()` has no
   * `rects()` of its own.
   */
  const painted = await alphaOver({
    x: VIEW_W * 0.08,
    y: VIEW_H * 0.375,
    w: VIEW_W * 0.84,
    h: VIEW_H * 0.125,
  });
  if (painted < closedAlpha + 40) fail(`${kind} ${to}: the celebration did not paint (alpha ${painted.toFixed(1)})`);
  else pass(`${kind} ${to}: alpha ${painted.toFixed(1)} against ${closedAlpha.toFixed(1)} closed`);
  await p.screenshot({ path: `${OUT}/levelup-fusion-${kind}.png` });
  // A union holds 6.2s; wait it out so the two do not stack in the screenshot.
  await p.waitForTimeout(kind === 'union' ? 5200 : 2600);
}

/* ------------------------------------------------------- the panel readout */

console.log('\nPANEL');

await show(STATES[2].abilities, STATES[2].offer, STATES[2].slots);
await p.waitForTimeout(600);
const panel = await p.evaluate(() => ({
  level: document.getElementById('ui-level').textContent,
  players: [...document.getElementById('ui-players').children].map((n) => n.textContent),
  rig: [...document.getElementById('ui-rig').children].map((n) => n.textContent),
  fusion: document.getElementById('ui-fusion').classList.contains('hidden')
    ? null
    : document.getElementById('ui-fusion').textContent,
  xpWidth: document.getElementById('ui-xp').style.width,
  slots: {
    i: window.__musicwars.world.snapshot.instrumentSlots,
    r: window.__musicwars.world.snapshot.rigSlots,
  },
}));
console.log(`    ${panel.level}   players ${JSON.stringify(panel.players)}`);
console.log(`    rig ${JSON.stringify(panel.rig)}   xp ${panel.xpWidth}`);
console.log(`    fusion line: ${panel.fusion ?? '(none)'}`);

/*
 * The tile count must equal the slot count.
 *
 * `tools/progression.mjs` already asserts this for the powerup row, and it was
 * written because that row once printed "none" *and* four empty chips — the
 * same fact twice. These two rows are the same shape and inherit the same risk.
 *
 * AGAINST THE SNAPSHOT THE HUD ACTUALLY READ, not against `STATES[2].slots`.
 * This compared with the number `show()` wrote and it was wrong twice over.
 * `World.writeSnapshot` rewrites `instrumentSlots`/`rigSlots` from
 * `progression` every frame, so `show()`'s value survives one frame and the
 * HUD never sees it — `choosing` is pinned with an accessor for exactly this
 * reason and the slot pair was not. And the numbers it asked for, 5 and 5,
 * stopped being reachable when slot growth was removed: `STAND_SLOTS` and
 * `RIG_SLOTS` are both a fixed 4.
 *
 * So the assertion is unchanged in meaning — one tile per slot, no more and no
 * fewer — and is now denominated in the value the HUD was handed. A floor of 1
 * keeps it from passing on a snapshot that reported no slots at all, which
 * would otherwise make "0 tiles for 0 slots" a green line.
 */
if (panel.slots.i < 1 || panel.slots.r < 1) {
  fail(`the snapshot reports ${panel.slots.i}/${panel.slots.r} slots — nothing was measured`);
}
if (panel.players.length !== panel.slots.i) {
  fail(`players row has ${panel.players.length} tiles against ${panel.slots.i} slots`);
} else pass(`players row: ${panel.players.length} tiles for ${panel.slots.i} slots`);
if (panel.rig.length !== panel.slots.r) {
  fail(`rig row has ${panel.rig.length} tiles against ${panel.slots.r} slots`);
} else pass(`rig row: ${panel.rig.length} tiles for ${panel.slots.r} slots`);
if (!panel.fusion) fail('SPICCATO is assembled and waiting but the panel does not say so');
else pass('the panel announces the waiting fusion');

await p.screenshot({ path: `${OUT}/levelup-panel.png` });

if (__reloads() > 0) {
  console.log(`\nWARNING: page reloaded ${__reloads()}x mid-run — these results span more than one build`);
}
console.log(`\nscreenshots in ${OUT}/levelup-*.png`);
console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
await b.close();
process.exit(failures ? 1 : 0);
