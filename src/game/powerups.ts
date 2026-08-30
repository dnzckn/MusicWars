/**
 * Powerups.
 *
 * Every kind changes both how the ship fires and how the track sounds — the
 * audio signature lives in `audio/layers.ts`. The rule that makes this project
 * work is that a powerup must be a *persistent change to the arrangement*, not
 * a one-shot sound effect: rapid fire doubling the hi-hat subdivision is the
 * model, not a bleep on pickup.
 *
 * Two of these exist specifically to answer "the game is too hard":
 *   - OVERDRIVE hands the player the engine's best trick — it forces a drop on
 *     demand, so the moment of maximum power is also the moment of maximum
 *     music, and holding it open is a reward for playing well.
 *   - ENCORE is not found, it is *sent*: the game drops it when a run is nearly
 *     over, so a bad patch is recoverable instead of terminal.
 */

import type { PowerupKind } from '../core/events';

export interface PowerupDef {
  kind: PowerupKind;
  label: string;
  /** Seconds; 0 means it does not expire. */
  duration: number;
  hue: number;
  /** Relative drop weight. 0 means it never drops randomly. */
  weight: number;
  /** One-line description of what the player will hear. */
  sound: string;
}

/*
 * Durations run ~45% longer than they used to.
 *
 * They were set when a run made 42-54 kills and a drop arrived every few
 * seconds. The roster rebalance made enemies ~2.5x tougher and cut group sizes,
 * so a run now makes about 20-27 kills — the gaps between pickups grew, the
 * durations did not, and tools/deadair.mjs measured the player holding nothing
 * 59% of the time. This is the third budget in this codebase found to be
 * denominated in an event whose rate we changed: the drop pity-timer, the score
 * multiplier's decay, and now these.
 */
/*
 * NINE OF THE TWELVE STOPPED DROPPING WHEN PROGRESSION LANDED, and the reason
 * is worth writing down because the table below still lists all twelve.
 *
 * `drones`, `nova` and `blackhole` became INSTRUMENTS and `spread`, `laser`,
 * `rapid`, `homing`, `magnet` and `timewarp` became RIG — see
 * `docs/progression.md`. They keep their ids on purpose, so every audio
 * signature already written for them in `layers.ts` keeps firing unchanged; the
 * ids simply arrive on `snapshot.abilities` rather than on `snapshot.powerups`
 * now, and the two maps have the same `id -> level` shape for exactly that
 * reason.
 *
 * What a field drop must NOT be any more is a second, parallel way to acquire
 * something the progression system also grants. A run where LASER can be both
 * a rig item you levelled to 4 and a 26-second pickup off the floor has two
 * economies for one id, and the player cannot tell which one is making their
 * gun better.
 *
 * The three that stay are the ones that were never progression to begin with:
 * OVERDRIVE is a state rather than a dial (the saturation audit in
 * tools/README.md established that), BOMB is a consumable charge, and ENCORE is
 * the game's mercy — not found but *sent*, when a run is nearly over. Keeping
 * them as drops means the drop economy, the pity timer and `Player.maxActive`
 * all keep working untouched.
 *
 * The nine keep their entries rather than being deleted because `powerupDef`
 * is still asked for their hue and label by the renderer and the summary, and
 * because a table with three rows in it would lose the record of what the
 * other nine used to be.
 */
export const POWERUPS: readonly PowerupDef[] = [
  { kind: 'drones', label: 'DRONES', duration: 35, hue: 265, weight: 0, sound: 'the arp splits into panned satellites' },
  { kind: 'spread', label: 'SPREAD', duration: 32, hue: 195, weight: 0, sound: 'wider, more detuned supersaws' },
  { kind: 'rapid', label: 'RAPID', duration: 23, hue: 55, weight: 0, sound: 'hi-hats double in subdivision' },
  { kind: 'nova', label: 'NOVA', duration: 26, hue: 150, weight: 0, sound: 'a room clap on the pulse, harmony opens to add9' },
  { kind: 'magnet', label: 'MAGNET', duration: 29, hue: 95, weight: 0, sound: 'the bass filter inverts into a vacuum' },
  { kind: 'homing', label: 'HOMING', duration: 29, hue: 285, weight: 0, sound: 'arpeggio grows a long delay tail' },
  { kind: 'laser', label: 'LASER', duration: 26, hue: 330, weight: 0, sound: 'lead holds instead of stabbing' },
  { kind: 'blackhole', label: 'BLACK HOLE', duration: 9, hue: 280, weight: 0, sound: 'a sub drone sliding down, resolving into an impact' },
  { kind: 'timewarp', label: 'TIMEWARP', duration: 17, hue: 210, weight: 0, sound: 'half-time, at exactly the same tempo' },
  // The three surges that stayed out of progression, and the only three that
  // a kill can still drop.
  { kind: 'bomb', label: 'BOMB', duration: 0, hue: 20, weight: 1.0, sound: 'a slow sub heartbeat' },
  /*
   * Hue 300, not 15. BOMB is 20 and these are the two commonest things on the
   * floor; five degrees apart they were the same orange dot at a glance, and
   * the only other cue is two letters at 9px on a moving object. The four that
   * can actually reach the floor are now spread across the wheel — BOMB 20,
   * ENCORE 45, WARD 175, OVERDRIVE 300 — so which drop it is can be read from
   * the colour alone, without stopping to parse the glyph mid-dodge.
   */
  { kind: 'overdrive', label: 'OVERDRIVE', duration: 12, hue: 300, weight: 0.8, sound: 'forces a DROP — the whole track goes to its top rung' },
  /*
   * WARD exists because the random pool had a structural hole, and the hole
   * was audible.
   *
   * BOMB has no duration and ENCORE is sent rather than found, so OVERDRIVE
   * was the only sustained buff a kill could produce. "The player is holding
   * something" and "the track is pinned to its top rung" were therefore the
   * SAME EVENT, and the two gates that watch them — tools/deadair.mjs, which
   * wants uptime above 45%, and tools/overdrive.mjs, which wants the top rung
   * to stay rare — could not both pass. Rationing OVERDRIVE alone fixed the
   * mix and pushed empty-handed from 42% to 65%, straight through deadair's
   * threshold: the buff budget had been carried by one kind, and taking it
   * away left nothing behind it.
   *
   * So the third member is not a nicety. It is what lets OVERDRIVE be rare.
   * It deliberately does NOT touch the gun — every offensive dial belongs to
   * progression now (see the note above) — and a defensive one is the only
   * kind of buff left that cannot become a second economy for a rig item.
   */
  { kind: 'ward', label: 'WARD', duration: 20, hue: 175, weight: 0.5, sound: 'a low sustained pad underneath, the only stem that is not an attack' },
  // Never dropped at random; the world hands it to a player who is losing.
  /*
   * Hue 330, not 45. Two reasons, and the first one is not about accessibility.
   *
   * At 45 it was three degrees from the MAJOR shard's 48 — dE 3.8 to a normal
   * eye. The game's mercy drop, the full heal it sends when a run is nearly
   * over, was the same colour as the commonest object on the field. Shape
   * saves it (drops are squares with letters, shards are round noteheads) but
   * nothing else did, and it also sat dE 12.1 from BOMB under deuteranopia,
   * where both are squares and colour is the only thing telling them apart.
   *
   * 330 measures best of any hue against BOMB, WARD and OVERDRIVE across
   * normal vision and all three dichromacies (min dE 25.3, `npm run
   * colourblind`). Rose is also better semantics than gold for a heal — the
   * warm-is-danger contract is about ENEMY fire, and this is the one pickup
   * that exists because you are about to die.
   */
  { kind: 'encore', label: 'ENCORE', duration: 17, hue: 330, weight: 0, sound: 'a full breakdown and rebuild, just for you' },
];

const RANDOM_POOL = POWERUPS.filter((p) => p.weight > 0);

/**
 * Shortest gap between two OVERDRIVE drops, in seconds.
 *
 * The random pool has exactly two members — BOMB, which is a charge and has no
 * duration, and OVERDRIVE, which lasts 12s. So OVERDRIVE is the only sustained
 * buff a kill can produce, and at the measured drop rate (a drop every ~1.4s
 * median) it landed every 3.8s: re-upped three times faster than it decays,
 * 95 pickups worth 1140s of duration inside a 900s run. A 127% duty cycle
 * cannot lapse, and two thirds of those pickups bought nothing at all because
 * the timer they refreshed was still nearly full.
 *
 * Rationing it here rather than by lowering its weight is deliberate: weight
 * governs the LONG-RUN mix, so halving it halves the count but leaves the
 * clustering that causes the pin. A minimum gap attacks the clustering, and it
 * converts a wasted pickup into a BOMB the player can actually use.
 *
 * Kept equal to `OVERDRIVE_DROP_COOLDOWN` in `audio/director.ts` on purpose —
 * the same idea enforced at the source and at the mix. If you change one,
 * change both, and re-run `npm run overdrive` and `npm run drops`.
 */
export const OVERDRIVE_MIN_GAP = 45;

/**
 * @param blocked Kinds that may not drop right now. Their weight is removed
 *   and the rest renormalise; if it would block everything the filter is
 *   ignored, so this can never fail to produce a drop.
 */
export function pickPowerup(roll: number, blocked?: (kind: PowerupKind) => boolean): PowerupDef {
  let pool = RANDOM_POOL;
  if (blocked) {
    const open = RANDOM_POOL.filter((p) => !blocked(p.kind));
    if (open.length) pool = open;
  }
  const total = pool.reduce((a, p) => a + p.weight, 0);
  let acc = roll * total;
  for (const p of pool) {
    acc -= p.weight;
    if (acc <= 0) return p;
  }
  return pool[0];
}

export function powerupDef(kind: PowerupKind): PowerupDef {
  return POWERUPS.find((p) => p.kind === kind) ?? POWERUPS[0];
}

export interface PowerupDrop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: PowerupKind;
  age: number;
  alive: boolean;
  /**
   * True once the drop has been close enough once and is now chasing.
   *
   * See the note in `updateDrop`, and `Shard.committed` in `world.ts` for the
   * same mechanism on the XP side and the measurement that produced it.
   */
  committed: boolean;
}

export const PICKUP_RADIUS = 30;

/**
 * How close a drop has to be before it commits and starts homing, in pixels.
 *
 * 240 + the same 310 of pass allowance `PASS_REACH` gives a shard in
 * `world.ts` — see that constant for the derivation. A powerup has no rig
 * multiplier of its own, so this is written out flat rather than as a sum.
 */
/*
 * The BASE reach. It is now a floor rather than the whole story — see the
 * `reach` parameter on `updateDrop`.
 *
 * Reported from play: "the square items like shield and bomb etc should get
 * attracted just like xp too". They already committed on contact exactly as a
 * shard does, but the range was this CONSTANT while a shard's is
 * `210 * mods.pickupRadius + PASS_REACH` — so MAGNET widened the reach for XP
 * and did nothing at all for the drops. Holding the item that exists to pull
 * things in left half the pickups untouched, which is not a balance decision,
 * it is two code paths that drifted.
 */
const DROP_REACH = 550;
/**
 * The vertical game's auto-collect line — EXPORTED, IMPORTED BY NOTHING.
 *
 * "Above this line the player auto-collects everything, as is traditional" was
 * true of a stage where up was enemy territory and down was safety. The arena
 * deleted the rule and `World.updateDrops` says so at length: on a ring a
 * height threshold is a strip of free pickups along one wall, and the rig's
 * pickup radius does that job now as a decision the player made. The constant
 * survived the deletion of its only reader, and a grep of `src/` finds this
 * declaration and nothing else.
 *
 * Kept for one reason, which is the same reason `waves.ts` keeps
 * `formationPositions`: it is the record of what the geometry used to be, and
 * `updateDrop` below still falls downward and still despawns past
 * `height + 40`, so this file has not finished being converted.
 */
export const AUTO_COLLECT_Y = 130;

export function updateDrop(
  d: PowerupDrop,
  dt: number,
  height: number,
  playerX: number,
  playerY: number,
  magnet: boolean,
  /**
   * How far this drop will notice the ship, in px. Scales with the rig's
   * pickup radius exactly as a shard's does, so MAGNET pulls squares and
   * diamonds alike. Defaults to the base so existing callers are unchanged.
   */
  reach = DROP_REACH,
  /**
   * Scales the passive close-range pull below, 1 normally. `World` drives
   * this down toward 0 the longer the ship has been camping — see its
   * `idleAnchorX` comment. That pull exists so a drop is not missed by a
   * player who is busy dodging; a parked ship is not dodging, and without
   * this a stationary ship auto-collects ENCORE — a full heal, sent
   * specifically because a run looks like it is about to end — for free,
   * every time, which is no longer a mercy so much as a subscription.
   */
  pullScale = 1,
): void {
  d.age += dt;
  if (magnet) {
    const dx = playerX - d.x;
    const dy = playerY - d.y;
    const len = Math.hypot(dx, dy) || 1;
    d.vx += (dx / len) * 1500 * dt;
    d.vy += (dy / len) * 1500 * dt;
    // Cap so a long-range pull does not overshoot and orbit the ship forever.
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > 620) {
      d.vx = (d.vx / sp) * 620;
      d.vy = (d.vy / sp) * 620;
    }
  } else {
    /*
     * Float up briefly, then settle into a slow fall. Gives the player a beat
     * to notice it before deciding whether the trip is worth the risk.
     *
     * "UP" AND "A SLOW FALL" ARE NOW RELATIVE TO A MOVING SHIP, and that is
     * worth stating rather than leaving as an unexamined inheritance: the
     * float is toward the line ahead (-y is forward) and the fall is toward
     * the stern. So a drop leans into the ship's path for a third of a second
     * and then lets the ship overtake it, which is a better read on a
     * treadmill than it was in the round.
     */
    d.vy = d.age < 0.35 ? -110 : Math.min(d.vy + 220 * dt, 96);
    /*
     * A weak always-on attraction once it is close. Without this a drop that
     * spawns two ship-widths away simply sails past while you are dodging, and
     * the player never gets a loadout at all.
     *
     * COMMITTED ON FIRST CONTACT, exactly as an XP shard is (`Shard.committed`
     * in `world.ts` records why), and for a reason the treadmill made sharp.
     * The pull used to re-test `d2 < 240^2` every step, so a drop only kept
     * coming while the player stayed close. On a rail the player never stays
     * close to anything: measured over three 6-minute runs of the dodge bot,
     * drops collected fell from 47.5% before the treadmill to 29.1% after,
     * with the number spawned unchanged. Nearly all of the loss is drops that
     * had started moving toward the ship and then gave up as it went past.
     *
     * The range widens with it, 240 -> `DROP_REACH`, for the reason spelled
     * out at `PASS_REACH` in `world.ts`: a pickup gets one pass, and the reach
     * has to cover a pass rather than an approach.
     */
    const dx = playerX - d.x;
    const dy = playerY - d.y;
    const d2 = dx * dx + dy * dy;
    if (d.age > 0.35 && pullScale > 0) {
      if (!d.committed && d2 < reach * reach) d.committed = true;
      if (d.committed) {
        const len = Math.sqrt(d2) || 1;
        // Once committed the falloff is gone: a drop that has decided to come
        // has to be able to cross ground the ship has already left, which is
        // the same contract a committed shard has.
        d.vx += (dx / len) * 520 * pullScale * dt;
        d.vy += (dy / len) * 520 * pullScale * dt;
      }
    }
    d.vx *= 1 - Math.min(1, dt * 1.2);
  }
  d.x += d.vx * dt;
  d.y += d.vy * dt;
  if (d.y > height + 40) d.alive = false;
}
