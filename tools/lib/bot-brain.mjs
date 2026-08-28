/**
 * The bot's brain, as a self-contained factory with no free variables.
 *
 * This logic used to live inside a `page.evaluate` callback in `driver.mjs`,
 * which meant it could only run inside a browser — and that is why every one
 * of the eleven balance tools (`ttk`, `starve`, `retention`, `forgiveness`,
 * `bossdps`, `deadconditions`, `hurt`, `gating`, `content`, `roster`,
 * `economy`) drives Chromium. None of them need a DOM. They need a `World`
 * and something to play it, and `World` has run in plain Node all along; the
 * browser was there purely to hand over `window.__musicwars.world`.
 *
 * On a box where Chromium wedges in D state that meant the ENTIRE gameplay
 * verification surface was dark while the sim itself was perfectly runnable.
 *
 * `makeBrain` is deliberately free of imports and closures so that
 * `makeBrain.toString()` can be evaluated inside a page as-is. That is the
 * whole trick: one implementation, injected into the browser for the tools
 * that still want a real page, imported directly by the Node harness. A second
 * hand-written bot is exactly the failure `driver.mjs` was created to stop —
 * its own header says a tool with the wrong input shape "produced numbers that
 * described nothing".
 *
 * If you change this, run `npm run brain` — it checks the source still
 * round-trips through `toString()`, which is what the browser path depends on.
 */
export function makeBrain(mode) {
  let t = 0;

  return (w, inp) => {

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

    /*
     * BODIES, NOT BULLETS, AND THIS IS THE WHOLE POLICY NOW.
     *
     * The block this replaces was a 190px sweep over `w.enemyBullets` doing
     * distance-and-closing-rate repulsion, with a five-line afterthought that
     * pushed weakly off enemies "because they are solid too". Enemies are the
     * only thing that can hurt the player any more, so the afterthought becomes
     * the policy and inherits the bullet loop's shape exactly: inverse-square
     * distance weight, scaled by how fast the thing is closing.
     *
     * WHY THE VELOCITY COMES FROM `prevX`/`prevY`. Three of the six movers
     * (`ringHold`, `weave`, `stutterHop`) write positions directly and never
     * touch `vx`/`vy`, so those fields are zero for most of the roster. The
     * per-step displacement is the only honest source, and it is also the one
     * that sees a committed lunge — which is the case this term exists for.
     * Units are px per 120Hz step: a mob walks 1.1-2.0, a charge moves 4-6.
     *
     * THE RANGE IS 240, NOT 190. A bullet had to be dodged; a body has to be
     * outrun, and 190px is under half a second of walking for the fast half of
     * the roster. Distance is measured to the contact EDGE rather than the
     * centre so a subdrop is not treated as a stutter.
     *
     * A body sitting on the ship at zero closing speed is still a threat, which
     * a passed bullet was not — hence the floor of 1 on the closing term rather
     * than the bullet loop's `continue`.
     */
    for (const e of w.enemies) {
      const dx = px - e.x, dy = py - e.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 240 * 240) continue;
      const d = Math.sqrt(d2) || 1;
      const edge = Math.max(1, d - e.radius * 0.62);
      closest = Math.min(closest, edge);
      const closing = (-dx * (e.x - e.prevX) - dy * (e.y - e.prevY)) / d;
      // x2.4 while a charge is committed: it is the one thing on the field that
      // can cover the gap faster than the ship can open it.
      const weight = (1 - Math.min(1, edge / 240)) ** 2 * (1 + Math.max(0, closing) / 2.5) * (e.lungeTime > 0 ? 2.4 : 1);
      rx += (dx / d) * weight; ry += (dy / d) * weight;
      if (edge < 110) danger += weight;
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
    /*
     * Stay off all four walls, not just the two vertical ones: being pinned
     * against any edge in the round means half the escape directions are gone.
     *
     * THE MARGIN IS A FRACTION OF THE FIELD, NOT 110 PIXELS.
     *
     * This read `if (px > w.width - 110)`, in this file and in seven verbatim
     * copies. 110px was tuned against a 900x1120 field, where it is 12.2% of
     * the short side. On a 3x arena it is 3.7%, and a bot that stays near the
     * action is never inside it — the term does nothing, silently. Nothing
     * fails; every balance number every tool driving this brain prints just
     * re-baselines, against a player that changed at the same moment as the
     * thing being measured. That is exactly the reading a field refactor
     * cannot afford, so the player model is pinned to a scale-invariant form
     * BEFORE the field moves.
     *
     * The SHORT side, not per-axis. A per-axis margin would be 1120*110/900 =
     * 136.9 vertically and would therefore change the bot today; this change
     * has to be a numeric no-op at 900x1120, and `Math.min(900, 1120) *
     * (110/900)` is exactly 110 in IEEE754 (checked, not assumed).
     *
     * Written the same way in all eight copies. `makeBrain` still takes no
     * imports and no closures, because `makeBrain.toString()` is what the
     * browser path evaluates — a shared constant module would break that.
     */
    const wall = Math.min(w.width, w.height) * (110 / 900);
    if (px < wall) mx += 1; if (px > w.width - wall) mx -= 1;
    if (py < wall) my += 1; if (py > w.height - wall) my -= 1;

    const len = Math.hypot(mx, my);
    inp.x = len > 0.05 ? mx / len : 0;
    inp.y = len > 0.05 ? my / len : 0;
    inp.focus = closest < 70;
    inp.shoot = true;
    inp.bomb = danger > 3.2 && w.player.bombs > 0;
    inp.well = danger > 2.2 && w.player.wells > 0;
  };
}

/** The source the browser path injects. See the note above. */
export const BRAIN_SOURCE = makeBrain.toString();
