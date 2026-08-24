/**
 * fieldsize — does every surface agree with the one place the world is declared?
 *
 *     node tools/fieldsize.mjs          (needs `npm run dev` on :5173)
 *
 * WHY THIS EXISTS. The world's size used to be written down five times: in
 * `world.ts`, twice in `index.html` as canvas attributes, twice more in
 * `style.css` (an `aspect-ratio` and, on the line under it, a height clamp
 * still carrying the 720x960 field from two sizes ago), and read back out of
 * the source by a regex in `electron/main.cjs` with a hardcoded fallback for
 * when the read failed. Twenty-one tools in this directory mention the
 * dimensions besides.
 *
 * The last time the constant moved, it **silently zeroed `tools/contrast.mjs`**.
 * That tool kept its own copy, every sample landed on background, and it
 * reported a total readability failure that was entirely its own — a confident,
 * precise, wrong answer. `world.ts` then carried a comment saying the field was
 * the wrong shape for a survivor arena and was not being fixed *because* the
 * number lived in three files in two languages. A constant nobody dares move is
 * a constant that has stopped being a constant.
 *
 * `src/game/arena.ts` is now the only declaration. This checks that claim the
 * only way it can be checked — **at the output**, in a real browser, against
 * what the page actually is:
 *
 *   AGREEMENT   the live `world.width/height`, the `--world-w/--world-h` custom
 *               properties the stylesheet lays out against, both canvas backing
 *               stores, and the rendered shape of `#stage` all match the
 *               declared constant.
 *   PLACEMENT   a projectile spawned at a known world coordinate is found at
 *               the matching place in a real screenshot. This is the property
 *               `contrast` lost: not "is the number right" but "does world
 *               (x, y) land where anything reading the page would look for it".
 *   ELECTRON    the value the desktop shell would size its window from, read
 *               through the same code path `main.cjs` uses — including the
 *               packaged-build fallback, which is reached only in the shipped
 *               product and never on a developer's machine, so drift there is
 *               invisible until a player sees a letterboxed game.
 *
 * WHY NOT GREP THE SOURCES. Because a source check tests the prose. A rule that
 * looked for stray `900`s would pass the day somebody writes `9e2`, would trip
 * on `range: 900` in `weapons.ts`, and would say nothing at all about whether
 * the browser agrees — which is the only question that matters. This project
 * has a recorded incident for exactly that (a strobe check that read comments).
 *
 * THE CONTROL. A check that cannot fail is decoration, and this directory has
 * five deleted scripts that proved it. So the tool breaks the page on purpose
 * at the end — it forces `#stage` to a square aspect ratio, which is what a
 * viewport disagreeing with the simulation physically looks like — and FAILS IF
 * ITS OWN ASSERTIONS STAY GREEN.
 */
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { autoClose } from './lib/autoclose.mjs';
import { ensureChromeDeps } from './lib/chromedeps.mjs';
import { freezePage } from './lib/frozen.mjs';
import './lib/ts.mjs';

const { PLAYFIELD_W, PLAYFIELD_H } = await import('../src/game/arena.ts');
const require = createRequire(import.meta.url);
const electronArena = require('../electron/arena.cjs');

let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};
const pass = (m) => console.log(`  ok    ${m}`);

/*
 * TOLERANCES — PROVISIONAL, and stated in the units of the thing they bound.
 *
 * Two of the three numbers below are not thresholds at all: the constant is an
 * integer and the page either reports it or does not, so AGREEMENT is exact
 * equality and cannot be tuned into passing.
 *
 * The other two are measurement slack, and they are marked PROVISIONAL because
 * this build is the only distribution they have been seen against — the
 * master plan's calibration protocol (§4) says a threshold freezes from a
 * measured spread, not from an author's taste, and there is no spread here yet.
 * What this build actually measures is printed beside every one of them, so the
 * next person can see how much room is left rather than trusting the bound.
 *
 *   RATIO_TOL   The rendered `#stage` box is laid out in fractional CSS pixels
 *               and its aspect ratio is compared against W/H. Sub-pixel layout
 *               rounding is the only legitimate source of error here.
 *   PLACE_TOL   How far, in world pixels, the brightest pixel of a spawned
 *               projectile may sit from where the world→screen mapping says it
 *               should be. A projectile sprite is ~5px of core inside a glow,
 *               the screenshot is resampled from a scaled backing store, and
 *               the draw interpolates between simulation ticks — so a few
 *               pixels of honest error is expected and zero would be suspicious.
 *
 * Do not tighten either of these to make a build pass. If the numbers printed
 * below start creeping toward the bound, that is the finding.
 */
const RATIO_TOL = 0.005; // PROVISIONAL: 0.5% of the aspect ratio
const PLACE_TOL = 10; // PROVISIONAL: world pixels
/** A pixel must beat the local background by this much to count as "found". */
const FOUND_MARGIN = 40; // PROVISIONAL: 0-255 luminance

console.log(`fieldsize — src/game/arena.ts declares ${PLAYFIELD_W} x ${PLAYFIELD_H}\n`);

/* ---------------------------------------------------- the desktop shell */

console.log('ELECTRON  the size the desktop window would be built from');
{
  const got = electronArena.playfieldSize();
  if (got.w === PLAYFIELD_W && got.h === PLAYFIELD_H) {
    pass(`electron/arena.cjs reads ${got.w}x${got.h} out of the source`);
  } else {
    fail(`electron/arena.cjs reads ${got.w}x${got.h}, the game is ${PLAYFIELD_W}x${PLAYFIELD_H}`);
  }
  const fb = electronArena.FALLBACK;
  if (fb.w === PLAYFIELD_W && fb.h === PLAYFIELD_H) {
    pass(`its packaged-build fallback is ${fb.w}x${fb.h} — the same field`);
  } else {
    fail(
      `its packaged-build fallback is ${fb.w}x${fb.h}, the game is ${PLAYFIELD_W}x${PLAYFIELD_H} — ` +
        'a shipped build with no src/ would letterbox',
    );
  }
}

/* ------------------------------------------------------------ the page */

console.log(await ensureChromeDeps().then((s) => `\n  ${s}`));

const b = autoClose(
  await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  }),
);

/** Everything the page can be asked about the size of the world, in one trip. */
const readPage = (p) =>
  p.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const stage = document.getElementById('stage');
    const play = document.getElementById('playfield');
    const over = document.getElementById('overlay');
    const sr = stage.getBoundingClientRect();
    const pr = play.getBoundingClientRect();
    const num = (v) => {
      const n = Number(String(v).trim());
      return Number.isFinite(n) ? n : null;
    };
    return {
      world: { w: window.__musicwars.world.width, h: window.__musicwars.world.height },
      cssVar: { w: num(css.getPropertyValue('--world-w')), h: num(css.getPropertyValue('--world-h')) },
      dataArena: document.documentElement.dataset.arena ?? null,
      stageVisible: getComputedStyle(stage).visibility,
      stage: { x: sr.x, y: sr.y, w: sr.width, h: sr.height },
      canvasBox: { x: pr.x, y: pr.y, w: pr.width, h: pr.height },
      backing: { w: play.width, h: play.height },
      overlayBacking: { w: over.width, h: over.height },
      viewport: { w: innerWidth, h: innerHeight },
    };
  });

/**
 * Assert every reported size against the declaration. `label` names the
 * viewport; `strict` is off for the control run, which wants the numbers back
 * rather than the verdict.
 */
function checkAgreement(label, r, { report = pass, complain = fail } = {}) {
  let bad = 0;
  const say = (ok, msg) => {
    if (ok) report(msg);
    else {
      bad++;
      complain(msg);
    }
  };

  say(
    r.world.w === PLAYFIELD_W && r.world.h === PLAYFIELD_H,
    `${label}: the running simulation reports ${r.world.w}x${r.world.h}`,
  );
  say(
    r.cssVar.w === PLAYFIELD_W && r.cssVar.h === PLAYFIELD_H,
    `${label}: the stylesheet lays out against --world-w/--world-h = ${r.cssVar.w}x${r.cssVar.h}`,
  );
  say(r.dataArena === `${PLAYFIELD_W}x${PLAYFIELD_H}`, `${label}: <html data-arena="${r.dataArena}">`);
  say(r.stageVisible === 'visible', `${label}: #stage is ${r.stageVisible} (hidden until the constant is published)`);

  const want = PLAYFIELD_W / PLAYFIELD_H;
  const stageRatio = r.stage.w / r.stage.h;
  const stageErr = Math.abs(stageRatio - want) / want;
  say(
    stageErr <= RATIO_TOL,
    `${label}: #stage renders ${r.stage.w.toFixed(1)}x${r.stage.h.toFixed(1)} — ratio ${stageRatio.toFixed(
      5,
    )} vs the world's ${want.toFixed(5)} (${(stageErr * 100).toFixed(3)}% off, bound ${(RATIO_TOL * 100).toFixed(1)}%)`,
  );

  const backRatio = r.backing.w / r.backing.h;
  const backErr = Math.abs(backRatio - want) / want;
  say(
    backErr <= RATIO_TOL,
    `${label}: the backing store is ${r.backing.w}x${r.backing.h} — ratio ${(backErr * 100).toFixed(3)}% off the world`,
  );
  say(
    r.backing.w === r.overlayBacking.w && r.backing.h === r.overlayBacking.h,
    `${label}: the overlay canvas matches the playfield canvas (${r.overlayBacking.w}x${r.overlayBacking.h})`,
  );
  return bad;
}

/**
 * Spawn projectiles at known world coordinates and find them in a screenshot.
 *
 * The world is frozen first — a bullet travels 200-300 px/s, and an earlier
 * version of `contrast` read coordinates and screenshotted 120ms later, so its
 * samples were 25-35px behind the sprite and it reported readability failures
 * that were entirely its own. This tool would have the same bug in the same
 * place, and it is measuring exactly that class of error, so it is not allowed
 * to make it.
 *
 * It is a BEFORE/AFTER DIFF rather than "find the brightest pixel near where the
 * bullet should be", because the first version of this function was the latter
 * and it reported a worst-case offset of 40px: the brightest thing within 60px
 * of one target was a drifting star, not the projectile. Brightest-nearby
 * answers "is there something bright here", and the question is "did what I put
 * here appear here".
 *
 * `mapW`/`mapH` are the dimensions the *reader* believes the world to be. They
 * default to the declaration, and the control at the bottom of this file passes
 * the previous field size instead — which is the `contrast` incident exactly:
 * the field moved 720x960 -> 900x1120, one reader kept the old pair, and every
 * sample it took landed on background.
 */
async function placement(p, label, { mapW = PLAYFIELD_W, mapH = PLAYFIELD_H, expect = 'found' } = {}) {
  const box = await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.frozen = true;
    w.enemyBullets.count = 0;
    const r = document.getElementById('playfield').getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      player: { x: w.player.x, y: w.player.y },
    };
  });

  /*
   * A grid of sample points, minus everything near the ship.
   *
   * The field is composited with `lighter`, so over an already-bright patch an
   * added sprite changes almost nothing — and the brightest patch on the field
   * is the ship, its aura effects and its orbiting drones. Measured: the two
   * grid points on the ship's own row came back with a peak change of 53
   * against 591-738 everywhere else, and one of them located 61px from where it
   * was spawned, because the largest *change* in that window belonged to
   * something else. The check was accusing the mapping of a displacement that
   * was really a saturated background.
   *
   * The radius is PROVISIONAL: 280px clears the drone orbit and the early
   * auras at the point in the run this tool measures, and is well inside the
   * 60px search windows of its neighbours. What makes it honest rather than
   * arbitrary is that the peak/floor separation for every surviving target is
   * printed, so a build where 280 stops being enough says so out loud instead
   * of quietly reporting a displacement.
   */
  const CLEAR_OF_SHIP = 280;
  const targets = [];
  for (const fx of [0.22, 0.5, 0.78]) {
    for (const fy of [0.18, 0.5, 0.82]) {
      const t = { x: Math.round(PLAYFIELD_W * fx), y: Math.round(PLAYFIELD_H * fy) };
      if (Math.hypot(t.x - box.player.x, t.y - box.player.y) < CLEAR_OF_SHIP) continue;
      targets.push(t);
    }
  }
  if (targets.length < 4) {
    fail(`${label}: only ${targets.length} sample points are clear of the ship — nothing worth measuring`);
    return null;
  }

  const vp = p.viewportSize();
  const inside = box.x >= 0 && box.y >= 0 && box.x + box.w <= vp.width + 0.5 && box.y + box.h <= vp.height + 0.5;
  if (!inside) {
    /*
     * Refusing to measure is the finding, not a skip. A clip that leaves the
     * viewport comes back padded or truncated, and every offset computed from
     * it would be wrong in a way that looks like a real displacement — which is
     * the exact failure this tool exists to catch, arriving from inside the
     * tool.
     */
    fail(
      `${label}: #playfield renders at (${box.x.toFixed(1)}, ${box.y.toFixed(1)}) ${box.w.toFixed(0)}x${box.h.toFixed(
        0,
      )}, outside the ${vp.width}x${vp.height} viewport — the stage overhangs the window, so placement cannot be measured here`,
    );
    return null;
  }

  const clip = { x: box.x, y: box.y, width: box.w, height: box.h };
  await p.waitForTimeout(350);
  const before = PNG.sync.read(await p.screenshot({ clip }));

  /*
   * Five overlapping sprites per target, not one.
   *
   * A single projectile is ~5px of core and the field is drawn with
   * `globalCompositeOperation = 'lighter'`, so over an already-bright patch —
   * a bloom, an explosion, the warp grid at full lightness — adding one sprite
   * can change almost nothing. A first version used one, and at 900x1000 a
   * target came back with a peak change of 53 against peaks of 348-738
   * elsewhere: the sprite was there and all but invisible, and the brightest
   * *changed* pixel in the window was something else entirely, 66px away. The
   * check then accused the mapping of a displacement that never happened.
   * A cluster is bright enough that "did it appear here" has one answer.
   */
  await p.evaluate((pts) => {
    const bl = window.__musicwars.world.enemyBullets;
    const ring = [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5]];
    for (const t of pts) {
      for (const [dx, dy] of ring) {
        bl.spawn({ x: t.x + dx, y: t.y + dy, angle: 0, speed: 0, radius: 5, ttl: 40, type: 0 });
      }
    }
  }, targets);
  await p.waitForTimeout(350);
  const after = PNG.sync.read(await p.screenshot({ clip }));

  await p.evaluate(() => {
    const w = window.__musicwars.world;
    w.enemyBullets.count = 0;
    w.frozen = false;
  });

  if (before.width !== after.width || before.height !== after.height) {
    fail(`${label}: the stage resized mid-measurement (${before.width}x${before.height} -> ${after.width}x${after.height})`);
    return null;
  }

  const sx = after.width / mapW;
  const sy = after.height / mapH;
  /** Sum of the absolute per-channel change at one pixel, 0..765. */
  const delta = (px, py) => {
    if (px < 0 || py < 0 || px >= after.width || py >= after.height) return -1;
    const i = (py * after.width + px) * 4;
    return (
      Math.abs(after.data[i] - before.data[i]) +
      Math.abs(after.data[i + 1] - before.data[i + 1]) +
      Math.abs(after.data[i + 2] - before.data[i + 2])
    );
  };

  // Wide enough to see a real displacement, narrower than the gap between
  // targets so two of them can never be confused for each other.
  const SEARCH = 60;
  const offsets = [];
  const peaks = [];
  const floors = [];
  const detail = [];
  let missing = 0;
  for (const t of targets) {
    let best = -1;
    let bx = 0;
    let by = 0;
    const seen = [];
    for (let dy = -SEARCH; dy <= SEARCH; dy++) {
      for (let dx = -SEARCH; dx <= SEARCH; dx++) {
        const d = delta(Math.round((t.x + dx) * sx), Math.round((t.y + dy) * sy));
        if (d < 0) continue;
        seen.push(d);
        if (d > best) {
          best = d;
          bx = dx;
          by = dy;
        }
      }
    }
    if (!seen.length) {
      missing++;
      continue;
    }
    seen.sort((a, c) => a - c);
    // The median change over the same window is everything that moved for its
    // own reasons — the warp grid, the starfield, the bloom — so it is the
    // noise floor this measurement has to beat.
    const floor = seen[Math.floor(seen.length / 2)];
    peaks.push(best);
    floors.push(floor);

    /*
     * The CENTROID of what changed, not the brightest pixel of it.
     *
     * Argmax put the answer on whichever corner of the sprite cluster happened
     * to be hottest, which is a real 5-10px of its own and had the measured
     * offsets sitting exactly on their own bound — a threshold inside its own
     * noise, which is this harness's most-documented failure. The blob is
     * symmetric about the spawn point, so its centre of mass is the thing that
     * actually answers "where did it appear". Only pixels near the peak and
     * well above it in change are weighed, so a second bright object elsewhere
     * in the window cannot drag the answer toward itself.
     */
    const NEAR = 25;
    const cut = floor + (best - floor) * 0.4;
    let wsum = 0;
    let cx = 0;
    let cy = 0;
    for (let dy = by - NEAR; dy <= by + NEAR; dy++) {
      for (let dx = bx - NEAR; dx <= bx + NEAR; dx++) {
        const d = delta(Math.round((t.x + dx) * sx), Math.round((t.y + dy) * sy));
        if (d < cut) continue;
        const w = d - floor;
        wsum += w;
        cx += dx * w;
        cy += dy * w;
      }
    }
    const off = wsum > 0 ? Math.hypot(cx / wsum, cy / wsum) : Math.hypot(bx, by);
    detail.push(`(${t.x},${t.y}) peak ${best} floor ${floor} off ${off.toFixed(1)}px`);
    if (best - floor < FOUND_MARGIN) {
      missing++;
      continue;
    }
    offsets.push(off);
  }

  const found = targets.length - missing;
  const sep = peaks.length
    ? `peak change ${Math.min(...peaks)}-${Math.max(...peaks)} against a moving-background floor of ` +
      `${Math.min(...floors)}-${Math.max(...floors)} (margin ${FOUND_MARGIN})`
    : 'nothing measurable';

  if (expect === 'found') {
    if (missing) {
      fail(
        `${label}: ${missing}/${targets.length} projectiles were NOT found within ${SEARCH}px of where the ` +
          `world→screen mapping puts them — the page and the simulation disagree about where the world is. ${sep}`,
      );
      for (const d of detail) console.log(`          ${d}`);
      return { found, missing, offsets };
    }
    const worst = Math.max(...offsets);
    const median = offsets.slice().sort((a, c) => a - c)[offsets.length >> 1];
    const line =
      `${label}: all ${targets.length} projectiles found where the mapping predicts — offset ` +
      `median ${median.toFixed(1)}px, worst ${worst.toFixed(1)}px (bound ${PLACE_TOL}px, world pixels). ${sep}`;
    // Every row, every run, pass or fail. The bound below is PROVISIONAL and the
    // only way anyone can tell whether it has room left is to see the spread it
    // is drawn around — an aggregate that hides its distribution is how a
    // threshold ends up sitting inside its own noise.
    console.log(`          per-target offsets: ${offsets.map((o) => o.toFixed(1)).join('  ')}`);
    if (worst <= PLACE_TOL) pass(line);
    else {
      fail(line);
      // Never report a bad aggregate without the rows behind it. An outlier
      // here is either a real displacement or one target that was not visible
      // to begin with, and those want opposite responses.
      for (const d of detail) console.log(`          ${d}`);
    }
    return { found, missing, offsets };
  }

  /*
   * The control path. It runs the same arithmetic and reports whether the
   * verdict above WOULD have failed, rather than re-deciding — a control that
   * asks a slightly different question than the check proves nothing about the
   * check.
   *
   * Note that "found" is the weaker half of the answer and cannot carry the
   * control on its own: the search window is +/-60 world px and the stale field
   * is only 20% smaller, so most targets are still inside the window, just
   * badly displaced. The displacement is the signal.
   */
  const worst = offsets.length ? Math.max(...offsets) : Infinity;
  const wouldFail = missing > 0 || worst > PLACE_TOL;
  console.log(
    `  mapped through ${mapW}x${mapH}: ${found}/${targets.length} found, worst offset ` +
      `${Number.isFinite(worst) ? `${worst.toFixed(1)}px` : 'n/a'} (bound ${PLACE_TOL}px)`,
  );
  return { found, missing, offsets, worst, wouldFail };
}

/**
 * Record the shape of `#stage` on every one of the page's first frames.
 *
 * The claim being tested is that removing the last two hardcoded copies of the
 * constant does not cost a flash. `#stage` has no aspect ratio at all until the
 * boot script publishes one, so a page that painted before that script ran
 * would show a stage collapsed to zero width — trading a stale number for a
 * visible glitch, which is not a trade worth making. That is a claim about
 * frames, so it is measured in frames rather than argued for in a comment.
 */
const TRACE = () => {
  window.__arenaTrace = [];
  const tick = () => {
    const s = document.getElementById('stage');
    const r = s ? s.getBoundingClientRect() : null;
    window.__arenaTrace.push({
      arena: document.documentElement.dataset.arena ?? null,
      vis: s ? getComputedStyle(s).visibility : 'no-stage',
      w: r ? r.width : 0,
      h: r ? r.height : 0,
    });
    if (window.__arenaTrace.length < 40) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/** Boot a page at one viewport, past the title screen, with the world settled. */
async function open(vp) {
  const p = await b.newPage({ viewport: vp });
  await p.addInitScript(TRACE);
  const reloads = await freezePage(p);
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.click('#start-button');
  /*
   * Past the opening panel, which is a DIV over the playfield and would occlude
   * a projectile rather than move it — a "not found" that means the overlay was
   * in the way is a false accusation, and this tool's whole subject is
   * measurements that accuse the wrong thing.
   */
  await p.waitForTimeout(6000);
  return { p, reloads };
}

/*
 * The viewports are chosen for what they do to the layout, not for coverage.
 *
 * 1440x900   what almost every browser check in this directory uses.
 * 900x1000   narrow and tall — the ONE shape where the `#stage` height clamp
 *            actually binds, and therefore the only place the stale 720x960
 *            copy in `style.css` was ever visible. `contrast` and `strobe`
 *            both measure here.
 * 1920x1080  a maximised desktop window, where the stage is taller than the
 *            world and `renderer.ts` scales the backing store up.
 * 390x844    a phone, where the media query replaces the desktop sizing rules
 *            entirely and only the aspect ratio survives.
 */
const VIEWPORTS = [
  { name: '1440x900 ', vp: { width: 1440, height: 900 }, place: true, assert: true },
  { name: '900x1000 ', vp: { width: 900, height: 1000 }, place: true, assert: true },
  { name: '1920x1080', vp: { width: 1920, height: 1080 }, place: false, assert: true },
  /*
   * The phone REPORTS and does not ASSERT, and the reason is a live defect
   * rather than a tolerance.
   *
   * Under the `max-width: 900px` media query `#stage` becomes `flex: 1 1 auto`
   * in a column, which makes its height definite — and `aspect-ratio` has no
   * effect on a box whose width and height are both definite. The stage is
   * therefore free to be the wrong shape, and it is: measured 378x581 against
   * a world of 900x1120, so the playfield is stretched about 24% vertically on
   * a phone. `renderer.ts` warns about exactly this ("if that rule is ever
   * removed this must take the smaller of the two ratios instead, or the
   * playfield will stretch") — the rule was not removed, it was overridden.
   *
   * That predates the constant unification and is not its to fix: the mobile
   * stage sizing belongs to the viewport work in Phase 4, where `mobileshot`
   * and `touchcheck` are already listed as changing baselines. Asserting it
   * here would ship a gate that is red on arrival, which this project's own
   * rule calls decorative. So it is printed as a FINDING every run, with the
   * number, and it becomes an assertion the day the mobile stage is fixed.
   */
  { name: '390x844  ', vp: { width: 390, height: 844 }, place: false, assert: false },
];

let anyReload = 0;
for (const v of VIEWPORTS) {
  console.log(`\nVIEWPORT  ${v.name}`);
  const { p, reloads } = await open(v.vp);
  const r = await readPage(p);
  checkAgreement(v.name, r, v.assert ? {} : { complain: (m) => console.log(`  FINDING  ${m}`) });
  const over = Math.max(0, r.stage.x + r.stage.w - r.viewport.w, -r.stage.x);
  console.log(
    `        the stage sits at x=${r.stage.x.toFixed(1)} w=${r.stage.w.toFixed(1)} in a ${r.viewport.w}px ` +
      `window${over > 0.5 ? ` — OVERHANGING by ${over.toFixed(1)}px` : ''}`,
  );
  if (v.assert) {
    const trace = await p.evaluate(() => window.__arenaTrace ?? []);
    const want = PLAYFIELD_W / PLAYFIELD_H;
    const shown = trace.filter((f) => f.vis === 'visible');
    const wrong = shown.filter((f) => !(f.w > 0) || Math.abs(f.w / f.h - want) / want > RATIO_TOL);
    const settled = trace.findIndex((f) => f.arena !== null);
    if (!trace.length) {
      fail(`${v.name}: no frames were recorded, so the no-flash claim is untested`);
    } else if (wrong.length) {
      const f = wrong[0];
      fail(
        `${v.name}: ${wrong.length}/${trace.length} early frames painted #stage at ` +
          `${f.w.toFixed(1)}x${f.h.toFixed(1)} — the page flashes at a shape the constant never declared`,
      );
    } else {
      pass(
        `${v.name}: ${trace.length} early frames recorded, the constant was published by frame ` +
          `${settled + 1}, and #stage was never visible at any other shape`,
      );
    }
  }
  if (v.place) await placement(p, v.name);
  anyReload += reloads();
  await p.close();
}

/* ------------------------------------------------------------ the control */

/*
 * Does the detector detect?
 *
 * Two controls, because the two halves of this tool fail in different ways and
 * one control would leave the other half unproven.
 *
 * SHAPE. Force `#stage` square while the world stays a rectangle. That is what
 * a viewport disagreeing with the simulation physically looks like — the
 * backing store is still sized from `world.width/height`, so the image is
 * simply stretched into the wrong box, exactly as it would be if `style.css`
 * had kept a stale copy of the ratio.
 *
 * MAPPING. Read the same screenshot through the PREVIOUS field size, 720x960.
 * This is not a hypothetical: it is the recorded incident. `tools/contrast.mjs`
 * kept that pair after the field was widened to 900x1120, every sample landed
 * on background, and it reported a total readability failure that was entirely
 * its own. Note the shape control does NOT trip the placement check and cannot:
 * a uniform stretch preserves proportional coordinates, so a projectile at 22%
 * across the world is still 22% across the image. That is why the mapping
 * control exists — without it the placement half would be untested, and its
 * greenness would mean only that the arithmetic is self-consistent.
 *
 * If either stays green, the corresponding half is decoration, and this tool
 * says so and exits non-zero.
 */
console.log('\nCONTROL 1  #stage forced to a square while the world stays a rectangle');
{
  const { p } = await open({ width: 1440, height: 900 });
  await p.evaluate(() => {
    document.getElementById('stage').style.aspectRatio = '1 / 1';
  });
  await p.waitForTimeout(600);

  const r = await readPage(p);
  const tripped = checkAgreement('control  ', r, {
    report: (m) => console.log(`  (still true) ${m}`),
    complain: (m) => console.log(`  caught  ${m}`),
  });

  if (tripped > 0) pass(`the shape control tripped ${tripped} assertion(s) — the agreement checks can fail`);
  else fail('THE SHAPE CONTROL PASSED. A square stage over a rectangular world went unnoticed.');
  await p.close();
}

console.log('\nCONTROL 2  the same screenshot read through the OLD field size, 720x960');
{
  const { p } = await open({ width: 1440, height: 900 });
  const sane = await placement(p, 'control  ', { expect: 'count' });
  const stale = await placement(p, 'control  ', { mapW: 720, mapH: 960, expect: 'count' });
  await p.close();

  if (!sane || !stale) {
    fail('the mapping control could not be measured');
  } else if (!sane.wouldFail && stale.wouldFail) {
    pass(
      `the mapping control tripped: the same screenshot passes through ${PLAYFIELD_W}x${PLAYFIELD_H} ` +
        `(worst ${sane.worst.toFixed(1)}px) and fails through the stale 720x960 (worst ` +
        `${Number.isFinite(stale.worst) ? `${stale.worst.toFixed(1)}px` : 'nothing found'}, ${stale.missing} missing) — ` +
        'the placement check is sensitive to the constant it claims to test',
    );
  } else if (sane.wouldFail) {
    fail(`the mapping control is unusable: the honest mapping itself failed (worst ${sane.worst.toFixed(1)}px)`);
  } else {
    fail(
      'THE MAPPING CONTROL PASSED. A field size the game has not used for two iterations read the same screenshot ' +
        'without tripping anything, so the placement check does not depend on the constant it claims to test.',
    );
  }
}

await b.close();

if (anyReload > 0) {
  console.log(`\nWARNING: the page reloaded ${anyReload}x mid-run — these numbers span more than one build`);
}
console.log(
  failures === 0
    ? `\nONE ARENA — every surface derives ${PLAYFIELD_W}x${PLAYFIELD_H} from src/game/arena.ts`
    : `\n${failures} SURFACE(S) DISAGREE WITH src/game/arena.ts`,
);
process.exit(failures ? 1 : 0);
