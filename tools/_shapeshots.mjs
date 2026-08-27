/**
 * _shapeshots — LOOK at each new shape, in a real browser, on the real canvas.
 *
 * Throwaway probe for the `trail` / `chain` / `mortar` / `spawn` change, and a
 * companion to `_shapecount.mjs`: that one counts what the SIMULATION holds and
 * this one asks whether any of it reaches the screen. The distinction is not
 * academic here — `docs/plan-passives.md` §8.8 recorded a whole container
 * (`World.wells`) that the simulation filled every frame and no drawing code
 * ever read, which meant BLACK HOLE dealt invisible damage for the life of the
 * table and nothing in `tools/` could tell.
 *
 * It forces ONE instrument at max, re-asserting it on an interval for the same
 * reason `_shapecount` re-seats every step (the bot takes cards, and a probe
 * that is not isolated measures the loadout rather than the shape), jumps to a
 * busy wave, and writes a PNG plus the live container counts at the moment the
 * shutter opened. A screenshot with the counts beside it is falsifiable: an
 * empty frame with `novas 0` is a probe that caught nothing, and an empty frame
 * with `novas 24` is a rendering bug.
 *
 *   node tools/_shapeshots.mjs           (needs the dev server on 5173)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freezePage } from './lib/frozen.mjs';
import { installDriver } from './lib/driver.mjs';

const OUT = fileURLToPath(new URL('../renders/shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;

/*
 * id, shape, wave, the container to watch, and HOW MANY of it to wait for.
 *
 * The threshold is not 1 on purpose. One trail drop on a 900x1120 field is a
 * ring the size of a coin and proves only that the code ran; six of them is a
 * WAKE, which is the thing the shape is claiming to be, and a reviewer looking
 * at the PNG can tell those two apart. Same for a chain: one segment is a line,
 * three is a chain.
 */
const CASES = [
  ['tremolo', 'trail', 16, 'novas', 6],
  ['carillon', 'chain', 16, 'effects', 3],
  ['tutti', 'mortar', 16, 'shells', 2],
  ['vibrato', 'spawn', 16, 'summons', 4],
  // The container that had no renderer until this change. BLACK HOLE banks a
  // charge the player throws, so the probe has to press the button.
  ['blackhole', 'field', 16, 'wells', 2],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

for (const [id, shape, wave, key, want] of CASES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const reloads = await freezePage(page);
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.click('#start-button');
  await page.waitForTimeout(1200);

  await page.evaluate(
    ([id, wave]) => {
      const w = window.__musicwars.world;
      w.jumpToWave(wave);
      const seat = () => {
        for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
        w.progression.instruments[id] = 3;
        for (const d of Object.keys(w.progression.rig)) w.progression.rig[d] = 3;
      };
      seat();
      window.__seat = setInterval(seat, 40);
    },
    [id, wave],
  );
  await installDriver(page, 'dodge');
  // BLACK HOLE banks charges rather than placing them; nothing is on screen
  // until the player throws one.
  if (id === 'blackhole') {
    await page.evaluate(() => {
      window.__throw = setInterval(() => {
        window.__botInput.well = window.__musicwars.world.player.wells > 0;
      }, 60);
    });
  }
  /*
   * WAIT FOR THE THING TO BE ON SCREEN, then shoot. A fixed timeout catches a
   * `chain` — a 0.12s flash against a 0.5s interval — about a quarter of the
   * time, and an empty frame proves nothing either way. Polling for the
   * container to be non-empty and screenshotting inside the same 100ms turns
   * "I did not see it" into a real negative: if this times out, the shape
   * genuinely never put anything in its container.
   *
   * `frozen` is NOT used. The world has to keep running for the container to
   * fill, and the shutter is fast enough at these lifetimes.
   */
  let caught = 0;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    /*
     * FREEZE INSIDE THE SAME EVALUATE THAT SEES THE CONDITION.
     *
     * `World.frozen` halts the simulation while rendering continues and exists
     * for exactly this. Without it the first version of this probe reported
     * `effects 5` and photographed an empty field: a chain hop lives 0.12s and
     * the round trip from "the poll saw it" to "the shutter opened" is longer
     * than that, so the flash had expired between the two. The counts and the
     * pixels have to be of the same frame or the PNG is evidence about a
     * different moment than the numbers beside it.
     */
    caught = await page.evaluate(
      ([k, want, shape]) => {
        const w = window.__musicwars.world;
        const n = k === 'summons' ? w.summonsLive : w[k].length;
        /*
         * A MORTAR'S SHELL EXISTS THE INSTANT IT IS FIRED AND ITS TELEGRAPH IS
         * A RING AT r = 0, so freezing on the shell count alone photographs two
         * invisible dots. The telegraph is the thing being checked — it is what
         * the enemy is supposed to be able to react to — so wait until one has
         * actually opened.
         */
        if (shape === 'mortar' && !w.novas.some((ring) => ring.r > 70)) return 0;
        /*
         * AND THERE MUST BE SOMETHING TO SHOOT AT. The first cut froze on the
         * count alone and photographed VIBRATO's four allies stacked on the
         * ship with `enemies: 0` — every one of them had run out of things to
         * hunt and steered home, which is correct behaviour and a useless
         * picture of it.
         */
        if (n >= want && w.enemies.length >= 3) w.frozen = true;
        return w.enemies.length >= 3 ? n : 0;
      },
      [key, want, shape],
    );
    if (caught >= want) break;
    await page.waitForTimeout(30);
  }

  const state = await page.evaluate(() => {
    const w = window.__musicwars.world;
    return {
      wave: w.waveIndex + 1,
      enemies: w.enemies.length,
      bullets: w.playerBullets.count,
      effects: w.effects.length,
      novas: w.novas.length,
      wells: w.wells.length,
      shells: 0 /* shells: the `mortar` shape was cut with the twenty-weapon roster */,
      summons: w.summonsLive,
      held: Object.keys(w.progression.instruments).join(','),
    };
  });
  // The playfield alone. The HUD is two thirds of the window and the question
  // here is only ever "is it drawn on the canvas".
  await page.locator('#playfield').screenshot({ path: `${OUT}shape-${shape}-${id}.png` });
  console.log(
    `  ${shape.padEnd(7)} ${id.padEnd(11)} ${(caught >= want ? 'CAUGHT' : 'MISSED').padEnd(7)}` +
      `${key} ${caught}/${want}   ${JSON.stringify(state)}${reloads() ? '  RELOADED' : ''}`,
  );
  if (caught < want) failures++;
  await page.close();
}

await browser.close();
console.log(`\n  wrote ${CASES.length} PNGs to renders/shots/`);
console.log(failures ? `  ${failures} shape(s) never filled their container\n` : '  every shape was caught live\n');
process.exit(failures ? 1 : 0);
