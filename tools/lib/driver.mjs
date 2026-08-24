/**
 * The bot that actually plays, as a function any tool can install.
 *
 * This lived inline in bot.mjs. A second tool then needed a player and got a
 * hand-written one with the wrong input shape — booleans instead of the real
 * {x, y, shoot} axes — so the ship sat frozen at spawn and never fired, and the
 * numbers it produced described nothing. Measuring tools need a *real* player
 * or their output is fiction, so there is now exactly one of them.
 */
export async function installDriver(page, mode = 'dodge') {
  await page.evaluate((mode) => {
  const mw = window.__musicwars;
  const w = mw.world;
  window.__botInput = {
    x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
    // The arena's level-up offer STOPS the world, so a bot that never picks a
    // card halts the run outright. The world has its own safety pick (45s, up
    // from 12s now that it is a true pause rather than a 12% crawl), but a
    // check that reaches it has spent 45 seconds per level-up measuring
    // nothing at all. Answer every offer.
    choice: -1, banish: -1, reroll: false, skip: false,
  };
  let t = 0;

  const drive = () => {
    const inp = window.__botInput;

    // Always answer an open offer, in every mode. Card 0 is legal in every
    // state the offer generator can produce; a bot picking greedily would be
    // measuring one build rather than the game, which is the same mistake the
    // weaving bot made about dodging.
    inp.choice = w.choosing ? 0 : -1;

    if (mode === 'weave') {
      t += 0.05;
      inp.x = Math.sin(t * 2) > 0 ? 1 : -1;
      inp.y = 0;
      inp.shoot = true;
      return;
    }

    const px = w.player.x, py = w.player.y;
    let rx = 0, ry = 0, danger = 0, closest = 1e9;

    const bl = w.enemyBullets;
    for (let i = 0; i < bl.count; i++) {
      const dx = px - bl.x[i], dy = py - bl.y[i];
      const d2 = dx * dx + dy * dy;
      if (d2 > 190 * 190) continue;
      const d = Math.sqrt(d2) || 1;
      closest = Math.min(closest, d);
      // Only fear bullets that are actually closing on us.
      const vx = Math.cos(bl.angle[i]) * bl.speed[i], vy = Math.sin(bl.angle[i]) * bl.speed[i];
      const closing = (-dx * vx - dy * vy) / d;
      if (closing <= 0) continue;
      const weight = (1 - d / 190) ** 2 * (1 + closing / 300);
      rx += (dx / d) * weight; ry += (dy / d) * weight;
      if (d < 90) danger += weight;
    }
    // Enemies are solid too.
    for (const e of w.enemies) {
      const dx = px - e.x, dy = py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > e.radius + 70) continue;
      rx += (dx / d) * 1.5; ry += (dy / d) * 1.5;
    }

    // Collect when it is cheap to do so.
    let ax = 0, ay = 0;
    const want = [...w.notes, ...w.drops];
    for (const n of want) {
      const dx = n.x - px, dy = n.y - py;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 300) continue;
      const pull = (n.kind ? 1.6 : 0.5) * (1 - d / 300);
      ax += (dx / d) * pull; ay += (dy / d) * pull;
    }
    const calm = Math.max(0, 1 - danger);
    let mx = rx * 2.2 + ax * calm;
    let my = ry * 2.2 + ay * calm;

    /*
     * THE OLD BIAS WAS A SHMUP ASSUMPTION AND HAD TO GO.
     *
     * It read `my += (py < h * 0.62 ? 0.8 : 0) - (py > h * 0.93 ? 0.8 : 0)` —
     * "prefer the lower half; drifting to the top is how runs end" — which was
     * true when every threat entered from the top. In the arena it makes the
     * bot hug the bottom wall with enemies closing from three sides, so every
     * number this driver produces would describe a bot pinned in a corner
     * rather than a player. Left in, it would have quietly re-run the original
     * sin of this file: measuring one bad strategy and calling it the game.
     *
     * The replacement is the arena's own danger signal. `w.wayOut` is the
     * bearing of the widest gap in the ring of enemies, so heading for it is
     * the closest thing to a correct policy that costs nothing, and it is
     * weighted by how closed the ring actually is — an unencircled bot should
     * be collecting, not running.
     */
    const enc = w.encircled;
    if (enc > 0.35) {
      const out = w.wayOut;
      mx += Math.cos(out) * enc * 1.8;
      my += Math.sin(out) * enc * 1.8;
    }
    // Stay off all four walls, not just the two vertical ones: being pinned
    // against any edge in the round means half the escape directions are gone.
    if (px < 110) mx += 1; if (px > w.width - 110) mx -= 1;
    if (py < 110) my += 1; if (py > w.height - 110) my -= 1;

    const len = Math.hypot(mx, my);
    inp.x = len > 0.05 ? mx / len : 0;
    inp.y = len > 0.05 ? my / len : 0;
    inp.focus = closest < 70;
    inp.shoot = true;
    inp.bomb = danger > 3.2 && w.player.bombs > 0;
    inp.well = danger > 2.2 && w.player.wells > 0;
  };
  setInterval(drive, 16);
}, mode);
}
