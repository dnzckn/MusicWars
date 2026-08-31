/*
 * setlist — can a player actually walk the loop?
 *
 * `node tools/setlist.mjs`   (needs `npm run dev` on :5173)
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. `tools/roster8.mjs` proves the arithmetic and
 * `tools/stages.mjs` proves the economy, and BOTH OF THEM WOULD PASS ON A GAME
 * WHOSE MENU DOES NOT OPEN. Every one of their assertions is about pure
 * functions; not one of them clicks anything. The whole feature is a loop —
 * menu, stage select, run, ending, points, shop, unlock, back — and a loop that
 * is broken at any single joint is worth nothing however correct the parts are.
 *
 * `domwiring` is the cheap half of this and it is not enough either: it proves
 * every id the code reaches for EXISTS, which is a promise about a page that
 * loads, not about a page that works. A button wired to the wrong handler, a
 * purchase that does not reach `localStorage`, a payout that never repaints —
 * all three load fine.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CANNOT MEASURE. Nothing about how the screens LOOK. It reads text and
 * classes; a menu rendered as white-on-white passes every line of it. The
 * screenshots it drops in `tools/_setlist/` are for a person, and they are the
 * only part of this that can answer "is it usable".
 *
 * IT ALSO FORCES THE TWO ENDINGS RATHER THAN PLAYING TO THEM. A real clear is
 * fourteen minutes of wall clock, which is not a check anybody will run. Both
 * endings are driven through the world's own paths — `takeHit` into
 * `onPlayerHit` for the loss, exactly as `tools/finale.mjs` does it, and
 * `winRun` for the win — so what is being tested is the run:over handler and
 * the economy behind it, not the fight. `finale` owns the claim that the
 * endings are reachable by playing.
 *
 * ---------------------------------------------------------------------------
 * THE FAIL-TEST LOG. Each break made, RUN, observed, then undone by the reverse
 * edit. Every figure was printed.
 *
 *   break                                        assertions it turned RED
 *   -----------------------------------------    --------------------------
 *   M  `#setlist-button` opens the shop          the set list opens from the
 *      instead of the set list                   title screen (menu HIDDEN);
 *                                                a fresh save offers one stage
 *                                                (0 open of 0 tiles)
 *   N  the run:over handler drops `saveMeta`     a finished run pays points (no
 *                                                save at all); and clearing
 *                                                stage 1 opens stage 2
 *   O  the buy handler drops `paintShop` and     an affordable unlock can be
 *      `paintMenu`                               bought (0 rows marked OWNED,
 *                                                though the save was correct)
 *   P  `startRun` pins `world.stage = 1`         a DEEPER tile starts that
 *                                                stage (world.stage 1, wanted 2)
 *   Q  every stage unlocked from the first       a fresh save offers one stage
 *      boot                                      (12 of 12); remembers the clear
 *                                                (12 open); NEW GAME wipes
 *   S  NEW GAME confirms and then does nothing   confirming wipes everything
 *                                                (4,866 points and 1 unlock
 *                                                survived)
 *   T  the confirmation panel never opens        NEW GAME asks first
 *
 * ONE ASSERTION WAS PASSING FOR THE WRONG REASON AND BREAK P FOUND IT. The
 * stage-tile check used to click "the first unlocked tile", which on a fresh
 * save is stage 1 — and stage 1 is also `selectedStage`'s default, so a
 * `startRun` that ignored the tile entirely still started stage 1 and the
 * assertion passed. It clicks stage 2 now, which is the only tile that cannot
 * be reached by accident.
 * ---------------------------------------------------------------------------
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freezePage } from './lib/frozen.mjs';

const TARGET = process.env.TARGET ?? 'http://localhost:5173/';
// `fileURLToPath`, never `.pathname`: on Windows the latter yields `/E:/...`
// and every write fails. Roughly seventeen tools in here were fixed for this.
const SHOTS = fileURLToPath(new URL('./_setlist/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

let bad = 0;
const check = (ok, what, detail) => {
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}  — ${detail}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await freezePage(page);
await page.goto(TARGET, { waitUntil: 'networkidle' });

/*
 * A CLEAN SAVE FOR EVERY RUN OF THIS CHECK.
 *
 * Playwright's context is fresh, so storage starts empty anyway — but this file
 * writes a save halfway through and then reloads, and a check whose result
 * depends on whether it was run before is a check nobody can trust. Cleared
 * explicitly and then reloaded, so the page boots against the state this file
 * chose rather than the state it left behind.
 */
await page.evaluate(() => localStorage.removeItem('musicwars.meta'));
await page.reload({ waitUntil: 'networkidle' });

const visible = (id) => page.evaluate((x) => !document.getElementById(x).classList.contains('hidden'), id);
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? '', sel);
const meta = () => page.evaluate(() => JSON.parse(localStorage.getItem('musicwars.meta') ?? 'null'));

console.log('\nsetlist — the between-runs loop, clicked\n');

/* ---------------------------------------------------------------- 1. open */
console.log('THE DOORS');
await page.click('#setlist-button');
await page.waitForTimeout(120);
check(
  (await visible('menu-screen')) && !(await visible('title-screen')),
  'the set list opens from the title screen',
  `menu ${(await visible('menu-screen')) ? 'shown' : 'HIDDEN'}, title ${(await visible('title-screen')) ? 'STILL SHOWN' : 'hidden'}`,
);
await page.screenshot({ path: `${SHOTS}menu-fresh.png` });

/*
 * A FRESH SAVE OFFERS EXACTLY ONE STAGE. The set list's whole promise is that
 * depth is EARNED; a grid where everything is clickable on the first boot is
 * the feature not working, and it looks identical in a screenshot to one where
 * it is.
 */
{
  const tiles = await page.$$eval('#stage-grid .stage', (els) =>
    els.map((e) => ({ locked: e.classList.contains('locked'), disabled: e.disabled, label: e.textContent })),
  );
  const open = tiles.filter((t) => !t.locked);
  check(
    tiles.length >= 8 && open.length === 1,
    'a fresh save offers exactly one stage, and the rest are visibly locked',
    `${open.length} open of ${tiles.length} tiles; every locked tile disabled: ${tiles.filter((t) => t.locked).every((t) => t.disabled)}`,
  );
  /*
   * AND EVERY TILE SAYS WHAT IT PAYS. The risk/reward decision has to be
   * visible at the point it is made — `docs/plan-meta.md` §4 — so a tile
   * without its multiplier is the feature half-built.
   */
  const withMult = tiles.filter((t) => /x\d/.test(t.label)).length;
  check(
    withMult === tiles.length,
    'and every tile shows the multiplier it pays',
    `${withMult}/${tiles.length} tiles carry a reward multiplier`,
  );
}

/* ---------------------------------------------------------------- 2. shop */
await page.click('#shop-button');
await page.waitForTimeout(120);
check(
  (await visible('shop-screen')) && !(await visible('menu-screen')),
  'the shop opens from the set list',
  `${(await page.$$('#shop-grid .shop-row')).length} rows`,
);
await page.screenshot({ path: `${SHOTS}shop-broke.png` });

/*
 * BROKE MEANS BROKE. Every buy button disabled on a zero balance, and the price
 * still shown — a shop that hides its prices when you cannot afford them tells
 * you nothing about what to play for.
 */
{
  const rows = await page.$$eval('#shop-grid .shop-row', (els) =>
    els.map((e) => ({
      label: e.querySelector('h4')?.textContent ?? '',
      note: e.querySelector('p')?.textContent ?? '',
      disabled: e.querySelector('button')?.disabled ?? null,
      price: e.querySelector('button')?.textContent ?? '',
    })),
  );
  check(
    rows.length > 0 && rows.every((r) => r.disabled === true),
    'with nothing banked, nothing can be bought',
    `${rows.filter((r) => r.disabled).length}/${rows.length} rows disabled`,
  );
  /*
   * AND EVERY ROW SAYS WHAT THE THING DOES BEFORE IT IS BOUGHT.
   * `docs/plan-meta.md` §3 requires it. `roster8` asserts the words are the
   * CARD's words; this asserts they reached the page at all, which is the half
   * a pure check cannot see.
   *
   * ---------------------------------------------------------------------
   * THIS ASSERTION WAS `length > 20 && /\d/` AND IT WAS REPLACED, NOT
   * RELAXED. It read 21 of 26 on a build where every row is correct, and the
   * five it flagged say why the test was wrong rather than the shop:
   *
   *   CAESURA   "no damage, ever · a line held along your heading, and
   *              everything standing in it is frozen for as long as it
   *              stands there."                                (122 chars)
   *   SPREAD    "one more of everything that comes out in numbers"
   *   HOMING    "a bolt that finishes something is thrown straight back out
   *              at whatever is nearest, and that one hunts"
   *   MAGNET    "shards jump to you from twice as far out"
   *   TIMEWARP  "anything that gets close to you wades — ..."
   *
   * Four passives and one weapon that deals no damage, all fully described,
   * none of them with a numeral in it. The digit test encoded an assumption
   * about the ROSTER — that everything for sale states a damage figure — and
   * the roster has deliberately not been that since the passives pass. The
   * shortest note in the shop is 40 characters.
   *
   * WHAT REPLACES IT IS NOT WEAKER. Length alone would be, so it is joined by
   * DISTINCTNESS, which catches the failure the digit test could not see at
   * all: a template bug, or a `stepNote` fallback, that gives every row the
   * same sentence. Twenty-six rows all reading "an upgrade" would have sailed
   * through the old test — every one of them over twenty characters — and
   * fails this one on the first line.
   */
  const described = rows.filter((r) => r.note.length >= 30).length;
  const distinct = new Set(rows.map((r) => r.note)).size;
  check(
    described === rows.length && distinct === rows.length,
    'and every row says what it does, in its own words, before you buy it',
    `${described}/${rows.length} rows carry a description of 30+ chars, ${distinct} of them distinct; ` +
      `e.g. "${rows[0].note.slice(0, 56)}..."`,
  );
}

/* ------------------------------------------------------- 3. a run pays out */
console.log('\nA RUN PAYS');
await page.click('#shop-back');
await page.waitForTimeout(80);
/*
 * Start stage 1 from the grid rather than from the title button, because
 * "clicking a tile starts THAT stage" is one of the joints being tested.
 */
await page.click('#stage-grid .stage:not(.locked)');
await page.waitForTimeout(2500);
check(
  await page.evaluate(() => window.__musicwars.world.stage === 1 && !window.__musicwars.world.isOver),
  'a stage tile starts a run at that stage',
  `world.stage ${await page.evaluate(() => window.__musicwars.world.stage)}`,
);

/*
 * FORCE THE WIN. `winRun` is `private` in TypeScript, which is a compile-time
 * word and nothing at runtime — reaching it through the prototype is the same
 * trick `tools/finale.mjs` uses for `onPlayerHit`, and for the same reason: the
 * alternative is fourteen minutes of wall clock per assertion.
 *
 * `totals.wavesCleared` is set to the full run first, because the payout's
 * depth term reads it and a victory credited with two waves would understate
 * the clear. That is the world's own bookkeeping, not the tool's: `winRun`
 * increments it once for the final wave and the other fifteen come from
 * `finishWave` during a real run.
 */
await page.evaluate(() => {
  const w = window.__musicwars.world;
  w.totals.wavesCleared = 16;
  Object.getPrototypeOf(w).winRun.call(w);
});
await page.waitForTimeout(400);
check(await visible('gameover-screen'), 'and it ends', await text('#final-title'));
await page.screenshot({ path: `${SHOTS}victory-payout.png` });

{
  const payout = await text('#final-points');
  const saved = await meta();
  check(
    /\+\d/.test(payout) && saved && saved.points > 0,
    'a finished run pays points, on the screen and in the save',
    `screen says "${payout.replace(/\s+/g, ' ').slice(0, 96)}"; save holds ${saved ? saved.points : 'NOTHING'}`,
  );
  /*
   * THE BREAKDOWN, not just the total. It is the only place the economy
   * explains itself, and a total alone teaches nobody to go deeper or faster.
   */
  check(
    /stage 1/.test(payout) && /x1\.00/.test(payout) && /speed/.test(payout),
    'and it shows WHY — the stage, the multiplier and the speed',
    payout.replace(/\s+/g, ' ').slice(0, 120),
  );
  /*
   * THE LOOP CLOSES. Clearing a stage must open the next one, or the set list
   * is a list of one.
   */
  check(
    saved && saved.highestCleared === 1,
    'and clearing stage 1 opens stage 2',
    `highestCleared ${saved ? saved.highestCleared : 'n/a'}, best ${JSON.stringify(saved ? saved.best : null)}`,
  );
}

/* ------------------------------------------------- 4. spend it, and go again */
console.log('\nSPENDING IT');
/*
 * Top the balance up rather than grinding to it. The economy is measured in
 * `tools/stages.mjs`; what is being tested here is that a purchase reaches the
 * save and then reaches the next run's draft pool, and a real grind would make
 * this check twenty minutes long for no extra evidence.
 */
await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('musicwars.meta'));
  m.points = 5000;
  localStorage.setItem('musicwars.meta', JSON.stringify(m));
});
await page.reload({ waitUntil: 'networkidle' });
await page.click('#setlist-button');
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}menu-rich.png` });

{
  const tiles = await page.$$eval('#stage-grid .stage', (els) => els.filter((e) => !e.classList.contains('locked')).length);
  check(tiles === 2, 'the set list remembers the clear across a reload', `${tiles} stages open`);
}

await page.click('#shop-button');
await page.waitForTimeout(100);
await page.screenshot({ path: `${SHOTS}shop-rich.png` });

const firstRow = await page.$$eval('#shop-grid .shop-row', (els) => ({
  label: els[0].querySelector('h4')?.textContent ?? '',
  price: els[0].querySelector('button')?.textContent ?? '',
  disabled: els[0].querySelector('button')?.disabled,
}));
check(firstRow.disabled === false, 'with points banked, the shop opens up', `${firstRow.label} at ${firstRow.price}`);

await page.click('#shop-grid .shop-row button');
await page.waitForTimeout(150);
{
  const saved = await meta();
  const owned = await page.$$eval('#shop-grid .shop-row.owned', (e) => e.length);
  check(
    saved && saved.unlocked.length === 1 && saved.points === 5000 - 150 && owned === 1,
    'an affordable unlock can be bought, and it is debited and persisted',
    `bought ${JSON.stringify(saved ? saved.unlocked : null)}, balance ${saved ? saved.points : 'n/a'}, ${owned} row marked OWNED`,
  );
  /*
   * AND IT REACHES THE NEXT RUN. The point of the whole shop. Checked against
   * the world's own roster set rather than against the save, because the save
   * is what was just asserted and the interesting failure is the wiring between
   * the two — `resetProgression` re-reading `unlocked` on every `start()`.
   */
  await page.click('#shop-back');
  await page.waitForTimeout(80);
  /*
   * STAGE 2, NOT "the first unlocked one".
   *
   * The earlier tile click was on stage 1, which is also the default
   * `selectedStage` for a save that has cleared nothing — so a `startRun` that
   * ignored the tile entirely would have started stage 1 anyway and the
   * assertion would have passed. That is a gate satisfied without the feature
   * working. Two stages are open by this point, and stage 2 is the only one
   * that could not have been reached by accident.
   */
  await page.click('#stage-grid li:nth-child(2) .stage');
  await page.waitForTimeout(1500);
  const startedAt = await page.evaluate(() => window.__musicwars.world.stage);
  check(startedAt === 2, 'and a DEEPER tile starts that stage, not the default', `world.stage ${startedAt}, wanted 2`);
  const inPool = await page.evaluate(
    (id) => !!window.__musicwars.world.progression.unlocked?.has(id),
    saved.unlocked[0],
  );
  check(inPool, 'and what was bought is in the next run\'s draft pool', `${saved.unlocked[0]} draftable: ${inPool}`);
}

/* -------------------------------------------------------- 5. the loss path */
console.log('\nAND LOSING PAYS TOO');
{
  const before = (await meta()).points;
  await page.evaluate(() => {
    const w = window.__musicwars.world;
    for (let k = 0; k < 80 && !w.player.dead; k++) {
      w.player.invuln = 0;
      w.player.bombs = 0;
      w.player.lives = 1;
      if (w.player.takeHit()) Object.getPrototypeOf(w).onPlayerHit.call(w);
    }
  });
  await page.waitForTimeout(400);
  const after = (await meta()).points;
  const payout = await text('#final-points');
  check(
    after > before,
    'a failed attempt still pays — a hard stage is brave, not just bad',
    `${before} -> ${after} banked, screen says "${payout.replace(/\s+/g, ' ').slice(0, 80)}"`,
  );
  check(
    /did not finish/.test(payout),
    'and the screen says it did not finish',
    payout.replace(/\s+/g, ' ').slice(0, 96),
  );
  await page.screenshot({ path: `${SHOTS}loss-payout.png` });
}

/* --------------------------------------------------------- 6. the reset */
console.log('\nNEW GAME');
await page.click('#gameover-menu');
await page.waitForTimeout(120);
check(await visible('menu-screen'), 'the set list is reachable from the ending', 'gameover -> menu');
await page.click('#newgame-button');
await page.waitForTimeout(100);
{
  const warn = await text('#newgame-warning');
  check(
    (await visible('newgame-confirm')) && /erase/i.test(warn) && /\d/.test(warn),
    'NEW GAME asks first, and names what it destroys',
    warn.slice(0, 110),
  );
  await page.screenshot({ path: `${SHOTS}newgame-confirm.png` });
}
await page.click('#newgame-no');
await page.waitForTimeout(80);
check(
  !(await visible('newgame-confirm')) && (await meta()).unlocked.length === 1,
  'and backing out changes nothing',
  `still ${(await meta()).unlocked.length} unlock, ${(await meta()).points} points`,
);
await page.click('#newgame-button');
await page.waitForTimeout(80);
await page.click('#newgame-yes');
await page.waitForTimeout(150);
{
  const saved = await meta();
  const tiles = await page.$$eval('#stage-grid .stage', (els) => els.filter((e) => !e.classList.contains('locked')).length);
  check(
    saved.points === 0 && saved.unlocked.length === 0 && saved.highestCleared === 0 && tiles === 1,
    'and confirming wipes everything the shop sold',
    `${saved.points} points, ${saved.unlocked.length} unlocks, ${tiles} stage open`,
  );
}

await browser.close();
console.log(`\n  screenshots in tools/_setlist/`);
console.log('');
if (bad) {
  console.log(`SETLIST BROKEN — ${bad} failure(s)\n`);
  process.exit(1);
}
console.log('THE LOOP CLOSES — menu, stage, run, payout, shop, unlock, and back\n');
