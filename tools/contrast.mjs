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
// Assigned from the running game before anything reads it (see `field = pts.field`
// below). Deliberately NOT seeded with a copy of the field size: a fallback that
// is never used is still a constant waiting to be believed.
let field = null;
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.keyboard.down('KeyZ');

const rows = [];
for (const [wave, name] of [[0, 'fourfloor'], [2, 'trap'], [4, 'gallop'], [6, 'swing']]) {
  await p.evaluate((w) => { const wd = window.__musicwars.world; wd.jumpToWave(w); wd.player.lives = 4; }, wave);
  await p.waitForTimeout(7000);
  // Guarantee bullets to sample.
  const pts = await p.evaluate(async () => {
    const w = window.__musicwars.world;
    const bl = w.enemyBullets;
    // The ring centre was (360, 420) — the middle of the 720x960 field this was
    // written against. On today's 900x1120 it sits up and to the left of centre,
    // and on a larger arena it would be in a corner. Centre it on the field the
    // game reports, like everything else here.
    const cx = w.width / 2, cy = w.height / 2;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      bl.spawn({ x: cx + Math.cos(a) * 180, y: cy + Math.sin(a) * 180, angle: a, speed: 0,
        radius: 5, ttl: 30, type: i % 4 });
    }
    /*
     * Freeze the world before reading positions.
     *
     * A first version read coordinates and screenshotted 120ms later: real
     * bullets travel 200-300 px/s, so they had moved 25-35px and the sampler
     * was reading empty background, reporting a contrast of 2 on palettes where
     * the bullets are plainly visible.
     */
    w.frozen = true;
    await new Promise((r) => setTimeout(r, 250));
    const out = [];
    for (let i = 0; i < bl.count; i++) out.push({ x: bl.x[i], y: bl.y[i], t: bl.type[i] });
    const wd = window.__musicwars.world;
    return { pts: out, rect: document.getElementById('playfield').getBoundingClientRect().toJSON(),
      groove: window.__musicwars.readout().feel, field: { w: wd.width, h: wd.height } };
  });
  field = pts.field;
  const shot = await p.screenshot({ clip: pts.rect });
  const png = PNG.sync.read(shot);
  /*
   * Read the field size from the game, never hardcode it.
   *
   * These were 720 and 960 — the playfield dimensions at the time this was
   * written. When the field was widened to 900x1120 the mapping silently went
   * wrong and every sample landed on background, so the check reported a
   * contrast of 0 against every groove: a total readability failure that was
   * entirely the measurement's. A tool that carries its own copy of a constant
   * the program owns will lie the day that constant moves.
   */
  const sx = png.width / field.w, sy = png.height / field.h;
  const px = (x, y) => { const i = ((Math.round(y * sy) * png.width) + Math.round(x * sx)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
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
   * arena grew to 900x1120 nobody moved them, so for the whole time since, this
   * check has sampled the top-left three quarters of the room and called it
   * "the room". Same defect as the one the comment above already records about
   * `sx`/`sy`, in the same file, twenty lines further down: the fix was applied
   * to the mapping and not to the window. `field` comes from the running game,
   * which is stronger than importing PLAYFIELD_W/H would be — it is the value
   * the pixels were actually drawn from, and it is the same value the mapping
   * uses, so the two can no longer disagree.
   */
  const INSET = 70;   // px off every edge; the vignette darkens the extreme border
  const STEP = 90;
  const bgSamples = [];
  for (let gy = INSET; gy < field.h - INSET; gy += STEP) {
    for (let gx = INSET; gx < field.w - INSET; gx += STEP) {
      if (pts.pts.some((q) => Math.hypot(q.x - gx, q.y - gy) < 60)) continue;
      bgSamples.push(px(gx, gy));
    }
  }
  if (bgSamples.length === 0) throw new Error('no background samples — the window is wrong again');
  bgSamples.sort((a, c) => lum(a) - lum(c));
  const bg = bgSamples[Math.floor(bgSamples.length / 2)] ?? [0, 0, 0];
  /*
   * Skip bullets within EDGE of a wall: `brightestNear` reads a 9x9 box, and
   * off-image reads come back as NaN and would win the "brightest" comparison
   * with garbage. The bound was `q.x > 670 || q.y > 890` — the old 720x960
   * field again, which quietly discarded every bullet in the right quarter and
   * bottom fifth of today's arena, i.e. exactly the region a check for
   * "can you see it" most wants to look at.
   */
  const EDGE = 50;
  let worst = 1e9, worstType = -1, checked = 0;
  for (const q of pts.pts) {
    if (q.x < EDGE || q.x > field.w - EDGE || q.y < EDGE || q.y > field.h - EDGE) continue;
    checked++;
    const c = brightestNear(q.x, q.y, 4);
    const d = Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);
    if (d < worst) { worst = d; worstType = q.t; }
  }
  // AGENTS.md: print every denominator. `checked === 0` reported a clean pass
  // before, because `worst` stays at 1e9 and 1e9 >= 60.
  if (checked === 0) throw new Error(`${name}: 0 bullets in the sample window — nothing was measured`);
  rows.push({ groove: pts.groove, worstContrast: Math.round(worst), worstType });
  console.log(`${name.padEnd(11)} ${pts.groove.padEnd(20)} worst bullet/background distance: ${Math.round(worst)} (type ${worstType})  [${checked} bullets, ${bgSamples.length} bg samples, field ${field.w}x${field.h}]`);
}
await p.keyboard.up('KeyZ');
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
const min = Math.min(...rows.map((r) => r.worstContrast));
console.log(`\nlowest across grooves: ${min}`);
console.log(min >= 60 ? 'BULLETS READ AGAINST EVERY ROOM' : 'READABILITY PROBLEM');
if (min < 60) process.exit(1);
