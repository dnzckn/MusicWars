/**
 * panelshot — does the readout fit the window, at every window?
 *
 * WHAT THIS USED TO CHECK, AND WHY IT IS NOT A DELETION. The readout was a
 * 268-460px sidebar and this file asserted two things about it: that the page
 * never scrolls sideways, and that the generated-source block is not clipped
 * out of the bottom of the panel. The second one existed because widening the
 * panel made the notation canvas proportionally taller and silently pushed the
 * `scale` line off the end — a content-dependent failure, which is why this
 * file forces a crowded state before measuring rather than sampling whatever
 * the run happened to be doing.
 *
 * The sidebar is gone (`docs/plan-refactor-3.md` §5) and with it `#panel`,
 * `#ui-notation` and `.code`, so those two assertions have nothing left to
 * point at. THE ASSERTIONS ARE KEPT AND RE-AIMED, per AGENTS.md §3 — a gate
 * that fails because the design changed is replaced with a stronger one, never
 * relaxed. The overlay HUD inherits the same two risks in a new shape, and
 * gains a third that the sidebar could not have:
 *
 *   1. The page still must not scroll. Unchanged, and still the cheapest way to
 *      catch a layout that has escaped its container.
 *   2. NOTHING IN THE HUD MAY LEAVE THE PLAYFIELD. The old failure was content
 *      pushing the code block out of the bottom of the panel; the new one is
 *      eight slot tiles plus five powerup chips pushing the corner group off
 *      the edge of the field. Same defect, different box.
 *   3. THE THREE CORNER GROUPS MAY NOT OVERLAP EACH OTHER. A sidebar's blocks
 *      were in flow and could only ever push one another; three absolutely
 *      positioned corners can collide silently, and a score printed across a
 *      row of slot tiles is unreadable in a way no single-element check sees.
 *
 * And one genuinely new assertion, because it is the thing this whole pass
 * exists to deliver and nothing measured it: THE STAGE TAKES THE WINDOW. Before
 * this change a 1512x945 window gave a 737px playfield — 48.7% of the width.
 * The floor below is deliberately well under what the layout achieves, because
 * it is guarding against a regression to a sidebar rather than pinning a
 * number: the aspect clamp legitimately pillarboxes an ultrawide, so the bar is
 * on AREA and is set to comfortably admit the 21:9 case.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const bad = [];
// Counted across every viewport, not per page: the per-page const was read
// after the loop had closed over it, so this check crashed with a ReferenceError
// before it ever printed its verdict.
let reloads = 0;
let checked = 0;

/*
 * The share of the window the stage must cover, by area.
 *
 * 0.80 rather than something near 1.0 because two things legitimately eat into
 * it: `#app` carries 10px of padding on every side for the cabinet's box-shadow
 * ring, and `field.ts`'s `VIEW_ASPECT_MAX` pillarboxes anything wider than
 * 1.9:1. On the 21:9 row below those two together leave 0.78 of the window, so
 * that viewport is exempted from the ratio and checked for its aspect clamp
 * instead. Everything else has to clear 0.80, against the 0.47 the sidebar
 * layout produced.
 */
const MIN_STAGE_SHARE = 0.8;

const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [1200, 800],
  [1000, 800],
  // The wide case, where the aspect clamp is expected to bite.
  [3440, 1440],
];

for (const [w, h] of VIEWPORTS) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const pageReloads = await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  await p.waitForTimeout(2200);
  await installDriver(p, 'dodge');
  await p.waitForTimeout(2500);

  /*
   * FORCE A CROWDED HUD BEFORE MEASURING.
   *
   * The original file's own lesson, kept verbatim in spirit: it passed for
   * three iterations while the code block was clipped in ordinary play, because
   * it happened to sample moments when ON STAGE listed a single archetype. A
   * fixed-content check tests the easy case only.
   *
   * The crowded case for an overlay HUD is a full band — four instruments and
   * four rig items, which is every tile drawn rather than one tile and seven
   * dashes — plus every field-dropped surge, a seven-figure score and a
   * two-digit multiplier with its descant tag. That is the widest the top-left
   * and top-right groups can ever be, which is when they collide if they ever
   * will.
   */
  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.score = 1234567;
    w.combo = 57;
    w.comboTimer = 90;
    w.player.maxActive = 5;
    for (const k of ['drones', 'rapid', 'nova', 'spread']) w.player.addPowerup(k, 90);
    const s = w.snapshot;
    /*
     * A FRESH OBJECT PER READ, and that is not a style choice.
     *
     * `writeSnapshot` does not reassign `s.abilities`; it CLEARS the object in
     * place and refills it from progression, which is why `levelshot` warns
     * "mutated in place, never reassigned". A getter handing back one shared
     * object therefore gets that object emptied on the very next frame, and the
     * first version of this check measured a HUD holding one instrument while
     * reporting that it had pinned eight.
     */
    // Real ids from `weapons.ts`, four of each pool. The `held === 8`
    // assertion below is what catches a rename: the first draft of this line
    // used two ids that do not exist, `labelOf` fell back to uppercasing them,
    // and the cards looked plausible while the HUD silently drew six tiles.
    const full = { ember: 3, chime: 2, tremolo: 3, nocturne: 1, capo: 3, resonance: 2, laser: 2, spread: 1 };
    Object.defineProperty(s, 'abilities', { configurable: true, get: () => ({ ...full }), set: () => {} });
  });
  await p.waitForTimeout(1400);

  const m = await p.evaluate(() => {
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom };
    };
    return {
      win: { w: window.innerWidth, h: window.innerHeight },
      stage: box('#stage'),
      field: box('#playfield'),
      groups: {
        'top-left': box('.hud-tl'),
        'top-right': box('.hud-tr'),
        'bottom': box('.hud-foot'),
      },
      tiles: document.querySelectorAll('#ui-players li').length + document.querySelectorAll('#ui-rig li').length,
      /*
       * FILLED tiles, counted separately from the total.
       *
       * The total is always eight — four held-or-empty plus four — so asserting
       * on it is satisfied by an empty band and proves nothing about whether the
       * crowded state took. `.slot` is the class an EMPTY tile carries.
       */
      held: document.querySelectorAll('#ui-players li:not(.slot)').length
        + document.querySelectorAll('#ui-rig li:not(.slot)').length,
      chips: document.querySelectorAll('#ui-powerups li').length,
      scrolls: document.body.scrollWidth > window.innerWidth || document.body.scrollHeight > window.innerHeight,
      view: [window.__musicwars.world.viewW, window.__musicwars.world.viewH],
    };
  });

  const share = (m.stage.w * m.stage.h) / (m.win.w * m.win.h);
  console.log(
    `${String(w).padStart(4)}x${String(h).padEnd(4)} stage ${Math.round(m.stage.w)}x${Math.round(m.stage.h)}` +
      ` (${(share * 100).toFixed(1)}% of the window)  view ${m.view[0]}x${m.view[1]}` +
      `  ${m.held}/${m.tiles} tiles held, ${m.chips} surges`,
  );

  checked++;
  if (m.scrolls) bad.push(`${w}x${h}: the page scrolls`);

  // 1. The stage takes the window.
  const wide = m.win.w / m.win.h > 1.9;
  checked++;
  if (wide) {
    // Pillarboxed on purpose. What must hold is that the CLAMP is what did it,
    // not that the layout forgot to grow: the stage should be at its widest
    // allowed aspect and full height.
    const aspect = m.stage.w / m.stage.h;
    if (Math.abs(aspect - 1.9) > 0.02) {
      bad.push(`${w}x${h}: a ${(m.win.w / m.win.h).toFixed(2)}:1 window gave a ${aspect.toFixed(2)}:1 stage — the aspect clamp is not what shaped it`);
    }
  } else if (share < MIN_STAGE_SHARE) {
    bad.push(`${w}x${h}: the stage is ${(share * 100).toFixed(1)}% of the window, under the ${MIN_STAGE_SHARE * 100}% floor`);
  }

  // 2. Nothing in the HUD leaves the playfield.
  for (const [name, g] of Object.entries(m.groups)) {
    checked++;
    if (!g) {
      bad.push(`${w}x${h}: the ${name} HUD group is not in the page at all`);
      continue;
    }
    if (g.w <= 0 || g.h <= 0) {
      bad.push(`${w}x${h}: the ${name} HUD group has no size — it is drawing nothing`);
      continue;
    }
    const out = [
      g.x < m.field.x - 1 && 'left',
      g.y < m.field.y - 1 && 'top',
      g.r > m.field.r + 1 && 'right',
      g.b > m.field.b + 1 && 'bottom',
    ].filter(Boolean);
    if (out.length) {
      bad.push(`${w}x${h}: the ${name} HUD group hangs off the ${out.join(' and ')} of the playfield`);
    }
  }

  // 3. The corner groups do not overlap each other.
  const names = Object.keys(m.groups);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = m.groups[names[i]];
      const c = m.groups[names[j]];
      if (!a || !c) continue;
      checked++;
      const ow = Math.min(a.r, c.r) - Math.max(a.x, c.x);
      const oh = Math.min(a.b, c.b) - Math.max(a.y, c.y);
      if (ow > 0 && oh > 0) {
        bad.push(`${w}x${h}: the ${names[i]} and ${names[j]} HUD groups overlap by ${Math.round(ow)}x${Math.round(oh)}px`);
      }
    }
  }

  // A full band is what makes the crowded case crowded. If the pin above stops
  // working, every measurement here is of an almost-empty HUD and the check
  // would go on passing while testing nothing — AGENTS.md, print the denominator.
  checked++;
  if (m.tiles !== 8) bad.push(`${w}x${h}: ${m.tiles} slot tiles drawn, not the 8 a 4+4 band gives`);
  checked++;
  if (m.held !== 8) bad.push(`${w}x${h}: only ${m.held} of 8 tiles are filled — the crowded state did not take, so nothing above was measured under load`);
  checked++;
  if (m.chips < 4) bad.push(`${w}x${h}: ${m.chips} surge chips — the powerups did not take`);

  if (w === 1440) await p.screenshot({ path: `${process.env.OUT ?? '/tmp'}/hud-1440.png` });
  reloads += pageReloads();
  await p.close();
}
if (reloads > 0) console.log(`WARNING: page reloaded ${reloads}x mid-run — these numbers span more than one build`);
await b.close();
console.log(`\nassertions checked ${checked}, failed ${bad.length}`);
if (checked === 0) {
  console.log('HUD: nothing was measured — this check proved nothing');
  process.exit(1);
}
for (const x of bad) console.log('HUD:', x);
console.log(bad.length ? 'THE HUD DOES NOT FIT' : 'THE HUD FITS AT EVERY SIZE');
process.exit(bad.length ? 1 : 0);
