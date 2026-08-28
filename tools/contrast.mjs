/**
 * Can you see the bullets against the room?
 *
 * The colour contract says warm = hurts you, cool = yours, green = collect.
 * Iteration 35 then made the room hue follow the groove, and gallop landed on
 * hue 8 while enemy fire sits at 5-28 — so the contract may now be violated by
 * the background itself. This samples real rendered pixels at bullet positions
 * and nearby background, rather than reasoning about hue numbers.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage({ viewport: { width: 900, height: 1000 } });
/*
 * THE VIEW, NOT THE FIELD.
 *
 * This tool has now been broken twice by the same class of mistake and the
 * second time is worth naming precisely, because the first fix looked complete
 * and was not. Version one hardcoded 720x960 and lied when the field became
 * 900x1120. Version two read the live field size off the running game — which
 * is strictly better and still wrong, because it assumed the CANVAS SHOWS THE
 * WHOLE FIELD. It does not any more: the field is 3000x3000 and the canvas
 * shows one 900x1120 rectangle of it, positioned by `camera.viewX/viewY`.
 * Left alone, every sample would land two thirds of an arena away from the
 * pixel it meant and the check would once again report a total readability
 * failure that was entirely its own.
 *
 * So what is read from the game is now the VIEW RECT — origin and size — and
 * every world coordinate is translated by its origin before being scaled to
 * the screenshot. Assigned before anything reads it; deliberately NOT seeded
 * with a fallback, because a fallback that is never used is still a constant
 * waiting to be believed.
 */
let view = null;
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');

const rows = [];
for (const [wave, name] of [[0, 'fourfloor'], [2, 'trap'], [4, 'gallop'], [6, 'swing']]) {
  await p.evaluate((w) => { const wd = window.__musicwars.world; wd.jumpToWave(w); wd.player.lives = 4; }, wave);
  await p.waitForTimeout(7000);
  /*
   * Guarantee THREATS to sample.
   *
   * It used to plant a ring of 40 enemy bullets, one of each of the four
   * sprite types. There are no enemy bullets: the thing a player has to see
   * against the playfield is now the BODY, so the ring is a ring of enemies —
   * one of each of the four hues the roster actually uses, which is the same
   * question ("is the threat legible on this palette") asked of the object that
   * carries the threat.
   */
  const pts = await p.evaluate(async () => {
    const w = window.__musicwars.world;
    const mod = await import('/src/game/enemies.ts');
    /*
     * The ring centre was (360, 420) — the middle of the 720x960 field this was
     * written against — then `w.width/2, w.height/2`, the middle of the field.
     * On a 3000x3000 arena the middle of the FIELD is wherever the player is
     * not, so the ring would be drawn off screen and nothing would be sampled.
     * It is the middle of the VIEW now, which is the only rectangle the
     * screenshot contains.
     */
    const cx = w.camera.viewX + w.viewW / 2, cy = w.camera.viewY + w.viewH / 2;
    const kinds = ['pluck', 'arpeggiator', 'glissando', 'subdrop'];
    w.enemies.length = 0;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const e = mod.spawnEnemy(kinds[i % 4], cx + Math.cos(a) * 180, cy + Math.sin(a) * 180, 0.5, false);
      e.move = () => {};
      w.enemies.push(e);
    }
    /*
     * Freeze the world before reading positions.
     *
     * A first version read coordinates and screenshotted 120ms later: real
     * threats travel 200-300 px/s, so they had moved 25-35px and the sampler
     * was reading empty background, reporting a contrast of 2 on palettes where
     * they are plainly visible.
     */
    w.frozen = true;
    await new Promise((r) => setTimeout(r, 250));
    const out = [];
    for (const e of w.enemies) out.push({ x: e.x, y: e.y, t: kinds.indexOf(e.archetype) });
    const wd = window.__musicwars.world;
    // Read AFTER the freeze, so the rect returned is the one the screenshot
    // below is taken of. A camera that was still following would put every
    // sample out by however far it travelled in those 250ms.
    return { pts: out, rect: document.getElementById('playfield').getBoundingClientRect().toJSON(),
      groove: window.__musicwars.readout().feel,
      view: { x: wd.camera.viewX, y: wd.camera.viewY, w: wd.viewW, h: wd.viewH },
      field: { w: wd.width, h: wd.height } };
  });
  view = pts.view;
  const shot = await p.screenshot({ clip: pts.rect });
  const png = PNG.sync.read(shot);
  /*
   * WORLD -> SCREENSHOT, through the camera.
   *
   * `png.width / view.w` scales, and subtracting `view.x/y` first is the part
   * that was missing: the screenshot's top-left pixel is world point
   * `(view.x, view.y)`, not the world origin. At one screen `view.x` was
   * always 0 and the subtraction was invisible, which is exactly why it was
   * never written. See the note on `view` at the top of the file.
   */
  const sx = png.width / view.w, sy = png.height / view.h;
  const px = (x, y) => {
    const i = ((Math.round((y - view.y) * sy) * png.width) + Math.round((x - view.x) * sx)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  /*
   * Sample the brightest pixel in a small window around each bullet, not the
   * exact centre. Camera shake, sub-pixel positions and the interpolated draw
   * all mean the sprite is rarely centred on the coordinate the simulation
   * holds — a first version sampled the centre and reported contrast of 2 on a
   * palette where the bullets are plainly visible, which was the measurement
   * being wrong rather than the game.
   */
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const brightestNear = (x, y, r) => {
    let best = null, bestL = -1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = px(x + dx, y + dy);
        const l = lum(c);
        if (l > bestL) { bestL = l; best = c; }
      }
    }
    return best;
  };
  /*
   * Background: the median luminance of points well away from any bullet.
   *
   * THE WINDOW IS DERIVED FROM THE FIELD, NOT WRITTEN DOWN.
   *
   * This read `gy < 900` and `gx < 680` — the 720x960 field, inset. When the
   * arena grew to 900x1120 nobody moved them, so for a long time this check
   * sampled the top-left three quarters of the room and called it "the room".
   * That was fixed by deriving the window from the live field size, and then
   * broken again by the camera: the field is now 3000x3000 and the screenshot
   * contains one 900x1120 window onto it, so two thirds of a field-sized grid
   * would read off the end of the image.
   *
   * The window is the VIEW, in world coordinates — `px()` maps it into the
   * screenshot. It comes from the running game rather than from an import of
   * `VIEW_W/H`, which is stronger: it is the rectangle the pixels were
   * actually drawn from, and it is the same rectangle the mapping uses, so the
   * two can no longer disagree.
   */
  const INSET = 70;   // px off every edge; the vignette darkens the extreme border
  const STEP = 90;
  const bgSamples = [];
  for (let gy = view.y + INSET; gy < view.y + view.h - INSET; gy += STEP) {
    for (let gx = view.x + INSET; gx < view.x + view.w - INSET; gx += STEP) {
      if (pts.pts.some((q) => Math.hypot(q.x - gx, q.y - gy) < 60)) continue;
      bgSamples.push(px(gx, gy));
    }
  }
  if (bgSamples.length === 0) throw new Error('no background samples — the window is wrong again');
  bgSamples.sort((a, c) => lum(a) - lum(c));
  const bg = bgSamples[Math.floor(bgSamples.length / 2)] ?? [0, 0, 0];
  /*
   * Skip bullets within EDGE of the edge of the IMAGE: `brightestNear` reads a
   * 9x9 box, and off-image reads come back as NaN and would win the
   * "brightest" comparison with garbage. The bound was `q.x > 670 || q.y > 890`
   * — the old 720x960 field, which quietly discarded every bullet in the right
   * quarter and bottom fifth of the arena — then the live field size, which is
   * the wrong rectangle again now that the image is a window onto the field.
   * It is the view rect, which is what "off the image" actually means.
   */
  const EDGE = 50;
  let worst = 1e9, worstType = -1, checked = 0;
  for (const q of pts.pts) {
    if (q.x < view.x + EDGE || q.x > view.x + view.w - EDGE || q.y < view.y + EDGE || q.y > view.y + view.h - EDGE) continue;
    checked++;
    const c = brightestNear(q.x, q.y, 4);
    const d = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
    if (d < worst) { worst = d; worstType = q.t; }
  }
  // AGENTS.md: print every denominator. `checked === 0` reported a clean pass
  // before, because `worst` stays at 1e9 and 1e9 >= 60.
  if (checked === 0) throw new Error(`${name}: 0 bullets in the sample window — nothing was measured`);
  rows.push({ groove: pts.groove, worstContrast: Math.round(worst), worstType });
  console.log(`${name.padEnd(11)} ${pts.groove.padEnd(20)} worst bullet/background distance: ${Math.round(worst)} (type ${worstType})  [${checked} bullets, ${bgSamples.length} bg samples, view ${view.w}x${view.h} at ${Math.round(view.x)},${Math.round(view.y)} of field ${pts.field.w}x${pts.field.h}]`);
}
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
const min = Math.min(...rows.map((r) => r.worstContrast));
console.log(`\nlowest across grooves: ${min}`);
console.log(min >= 60 ? 'BULLETS READ AGAINST EVERY ROOM' : 'READABILITY PROBLEM');
if (min < 60) process.exit(1);
