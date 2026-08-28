/**
 * The stress model: game state in, two numbers out.
 *
 * This is the bit the whole project turns on, so it is deliberately explicit
 * rather than clever. Each term is a normalised 0..1 reading of one kind of
 * pressure; they are combined with fixed weights and then smoothed
 * asymmetrically.
 *
 * The asymmetry matters. Fear arrives faster than relief: when a wall of
 * bullets appears the music should tighten within a beat, but when the screen
 * clears it should ease off over several seconds. A symmetric filter makes the
 * track twitch on every near miss and sounds broken.
 */

import { clamp01, damp, remap } from '../core/math';
import type { GameSnapshot } from '../core/events';

export interface TensionTerms {
  /** Bullets crowding the player's personal space. */
  crowding: number;
  /** How soon something is going to hit them. */
  imminence: number;
  /** Low health is stressful even when the screen is empty. */
  fragility: number;
  /** Raw amount of stuff on screen. */
  density: number;
  /** Enemy presence and remaining HP. */
  threat: number;
  /** Boss fights get their own floor so the music never relaxes mid-fight. */
  boss: number;
  /** Playing well is its own kind of intensity: reward it, do not calm it. */
  flow: number;
  /** Rate of destruction. Winning loudly should sound like winning loudly. */
  momentum: number;
}

/** Human-readable name for each driver, shown in the MIX panel. */
export const TERM_LABELS: Record<keyof TensionTerms, string> = {
  crowding: 'crowded',
  imminence: 'incoming',
  fragility: 'hurt',
  density: 'busy',
  threat: 'outnumbered',
  boss: 'boss',
  flow: 'in the zone',
  momentum: 'on a tear',
};

export interface TensionOutput {
  /** Slow, arrangement-driving stress. 0..1 */
  sustained: number;
  /** Fast, transient spike used for one-shot musical gestures. 0..1 */
  immediate: number;
  /** Unsmoothed instantaneous value, for the debug overlay. */
  raw: number;
  terms: TensionTerms;
  /** Which term is contributing most right now, weight included. */
  driver: keyof TensionTerms;
}

/*
 * Weights.
 *
 * Danger used to be almost the whole story, which had an unfortunate
 * consequence: making the game fairer made the music duller, because a player
 * who was no longer drowning never pushed the arrangement past its middle.
 * `flow` and `momentum` fix that — grazing, comboing and killing quickly are
 * now worth a quarter of the total, so a player who is *dominating* gets a drop
 * rather than a lull. Intensity and danger are related but they are not the
 * same axis, and only tracking the second one makes a competent player's music
 * worse the better they get.
 */
const WEIGHTS: Record<keyof TensionTerms, number> = {
  crowding: 0.22,
  imminence: 0.17,
  fragility: 0.12,
  density: 0.1,
  threat: 0.08,
  boss: 0.07,
  flow: 0.13,
  momentum: 0.11,
};

/**
 * Mild expansion applied to the weighted sum.
 *
 * Seven terms rarely peak together, so a plain weighted average spends its whole
 * life between 0.2 and 0.5 and the top layers never cross their thresholds.
 * An exponent below 1 lifts the middle without touching the ends, so ordinary
 * combat lands where it should and 1.0 still means "about to die".
 */
const CURVE = 0.72;

/** Seconds for the sustained value to close half the gap while rising / falling. */
const SUSTAINED_ATTACK = 0.45;
/*
 * 1.8, down from 2.6, measured rather than guessed.
 *
 * Attack and release are deliberately asymmetric — danger should register at
 * once and ebb slowly — but 2.6s was slow enough that the signal never got
 * back down between bursts. Measured on the real game, `raw` has a p10 of
 * 0.209 and `sustained` a p10 of 0.386: the damper was lifting the QUIET end
 * by 0.18 while leaving the loud end alone. The music could not get calm.
 *
 * Swept with the floor at its new value: 2.6 -> energy span 0.343, 1.8 ->
 * 0.361, 1.2 -> 0.358. 1.8 is the knee, and the churn cost is real but small —
 * the share of steps where `sustained` moves more than 0.05 goes from 0.9% to
 * 1.5%, against 4.3% at 0.8s, which is where it would start rewriting patterns
 * faster than they can be heard.
 */
const SUSTAINED_RELEASE = 1.8;
/** The transient channel snaps up almost instantly and decays over ~0.6s. */
const IMMEDIATE_ATTACK = 0.04;
const IMMEDIATE_RELEASE = 0.55;

export class TensionModel {
  private sustained = 0;
  private immediate = 0;
  private lastRaw = 0;
  private terms: TensionTerms = {
    crowding: 0,
    imminence: 0,
    fragility: 0,
    density: 0,
    threat: 0,
    boss: 0,
    flow: 0,
    momentum: 0,
  };

  reset(): void {
    this.sustained = 0;
    this.immediate = 0;
    this.lastRaw = 0;
  }

  update(s: GameSnapshot, dt: number): TensionOutput {
    const t = this.terms;

    /*
     * CROWDING NOW COUNTS BODIES. Was `bulletsNear` / `bulletsVeryNear`.
     *
     * The thresholds move with the quantity, and the reason is the lesson the
     * old comment here already records: its ceiling was 18 bullets near the
     * ship, the term peaked at 0.23 and averaged 0.01 across a real run, and it
     * carried 22% of the total weight while contributing essentially nothing —
     * because 18 near misses at once is not a situation this game creates.
     * Leaving 1..8 in place against a body count would repeat that in the
     * opposite direction: contact damage means the crowd IS the danger, and a
     * ring of a dozen holding station on the ship would saturate a scale built
     * for bullets and pin the term at 1.
     *
     * 2..16 within DANGER_RADIUS (300px) and 0..6 within PANIC_RADIUS (110px).
     * The second is the one that means something now — six bodies inside 110px
     * is a body every sixty degrees at arm's length, which is the moment the
     * arrangement should be at its most frantic.
     */
    t.crowding = clamp01(remap(s.threatsNear, 2, 16, 0, 1) * 0.6 + remap(s.threatsVeryNear, 0, 6, 0, 1) * 0.4);

    // Inverted time-to-contact. Under ~0.3s the player is reacting, not planning.
    t.imminence = Number.isFinite(s.timeToContact) ? clamp01(remap(s.timeToContact, 0.9, 0.1, 0, 1)) : 0;

    // Fragility must count lives, not just the current life's HP: a player on
    // their last life at full health is in far more danger than the HP bar says,
    // and that is exactly when the music should refuse to relax.
    const maxHits = Math.max(1, s.maxLives * s.playerMaxHp);
    // clamp01 BEFORE the pow, not after. Extra lives from score extends can push
    // `lives` above `maxLives`, which made this ratio exceed 1, which made the
    // base negative, which made Math.pow return NaN — and a NaN here poisoned
    // the tension scalar, the mode lookup and finally the renderer's colour
    // string, which is what the random black screen actually was.
    const hitsLeft = Math.max(0, (s.lives - 1) * s.playerMaxHp + s.playerHp);
    t.fragility = Math.pow(clamp01(1 - hitsLeft / maxHits), 1.15);

    /*
     * DENSITY NOW COUNTS BODIES. Was `bulletCount`, on a scale of 8..90.
     *
     * Same problem as `crowding` above and the same fix: a scale has to be
     * calibrated to what the game actually produces or the term is dead at one
     * end. Measured off `tools/arena.mjs` after the density rise, enemies alive
     * across a twenty-minute run run p10 / p50 / p90 of roughly 1 / 20 / 90, so
     * the scale is the crowd's own range rather than the bullets'.
     */
    t.density = clamp01(remap(s.pressureCount, 4, 70, 0, 1));

    t.threat = clamp01(remap(s.enemyCount, 1, 9, 0, 0.6) + clamp01(s.enemyThreat) * 0.4);

    if (s.bossActive) {
      // Ramps through the fight, with a step at each phase change, and spikes
      // when the boss is nearly dead — the desperate final pattern.
      const phaseFloor = s.bossPhases > 1 ? s.bossPhase / (s.bossPhases - 1) : 0;
      t.boss = clamp01(0.45 + phaseFloor * 0.35 + (1 - s.bossHp) * 0.2);
    } else {
      t.boss = 0;
    }

    // Grazing means the player is deliberately dancing through fire. That is a
    // high-energy state even though nothing has hit them.
    t.flow = clamp01(remap(s.grazeRate, 0, 7, 0, 0.65) + remap(s.combo, 0, 30, 0, 0.35));

    // Sustained destruction. Three kills a second is a good run; six is a rout.
    t.momentum = clamp01(remap(s.killRate, 0.15, 3.5, 0, 1));

    let raw = 0;
    let best = -1;
    let strongest = 0;
    for (const key of Object.keys(WEIGHTS) as (keyof TensionTerms)[]) {
      const contribution = t[key] * WEIGHTS[key];
      raw += contribution;
      if (t[key] > strongest) strongest = t[key];
      if (contribution > best) {
        best = contribution;
        this.driver = key;
      }
    }

    /*
     * The mean, lifted by the single strongest term.
     *
     * A weighted mean of eight terms that rarely peak together cannot reach the
     * top of its own range — measured over a real run, tension never once
     * exceeded 0.5, so every consumer of the master musical signal (mode
     * selection, section choice, every stem fader) only ever saw the bottom half
     * of its input. CURVE was meant to compensate and is not enough on its own.
     *
     * Blending in the largest single term is also the musically right answer,
     * not just an arithmetic patch: one bullet about to hit you *is* maximum
     * tension, whatever the other seven terms happen to be doing. The mean
     * keeps the baseline honest; the peak lets a single emergency speak.
     */
    raw = raw * 0.72 + strongest * 0.38;

    // A recent hit briefly floors the music: the player is reeling, so should
    // the track be. Decays over ~1.5s.
    if (s.timeSinceHit < 1.5) raw = Math.max(raw, remap(s.timeSinceHit, 1.5, 0, 0, 0.55));

    /*
     * Camping is danger the player has chosen, and the score was contradicting
     * the game about it.
     *
     * `World` treats a ship that stops moving as one that has stopped playing:
     * past a four-second grace it ramps `campPressure` to 1 over twenty
     * seconds, speeds every bullet up by half, and withdraws both rescue
     * mechanics (ENCORE and the last-life auto-bomb). Measured with a parked
     * bot, that is enough to turn a run that used to reach wave 60 unharmed
     * into a death around wave 9.
     *
     * None of the eight terms above can see any of it. They read kills,
     * grazes, combo and crowding — all of which FALL when the player stops
     * engaging. So the mix measured its calmest at exactly the moment the game
     * was at its most lethal: energy p50 of 0.410 parked, against 0.476
     * micro-dodging and 0.502 roaming. A score that relaxes while the world
     * arms itself is not just off-concept for a game whose premise is that the
     * state generates the music — it misinforms the player.
     *
     * A floor rather than a ninth weighted term, for the same reason the
     * post-hit line above is one: this is not an eighth opinion to average in,
     * it is a fact that overrides the average.
     *
     * Measured after the change, energy p50 by movement policy: parked 0.563,
     * roaming 0.502, micro-dodging 0.476, against a whole-run maximum of about
     * 0.849. So camping now reads as MORE tense than ordinary play and far
     * short of a peak, which is the honest ordering — a camped ship is in more
     * danger than a moving one, and less than one in a boss fight's worst
     * moment. `raw` is pre-curve here, so the 0.45 coefficient lands near 0.56
     * after `CURVE`.
     *
     * Note the sign, because the intuitive design goes the other way: it is
     * tempting to have the band lose interest and thin out for a player who
     * has stopped playing. That would sound like a reward for camping and
     * would repeat the original defect — a score disagreeing with the world
     * about how dangerous the situation is.
     */
    raw = Math.max(raw, clamp01(s.campPressure ?? 0) * 0.45);

    // Between waves nothing is happening; let it breathe properly.
    if (s.enemyCount === 0 && s.pressureCount < 4 && !s.bossActive) raw *= 0.35;

    // Belt and braces: one non-finite term must never be able to poison the
    // whole arrangement again.
    raw = Number.isFinite(raw) ? Math.pow(clamp01(raw), CURVE) : 0;
    this.lastRaw = raw;

    this.sustained = damp(this.sustained, raw, raw > this.sustained ? SUSTAINED_ATTACK : SUSTAINED_RELEASE, dt);

    // The immediate channel tracks *increases* only; it is a spike detector.
    const spike = Math.max(raw, this.immediate);
    this.immediate = damp(this.immediate, raw, spike > this.immediate ? IMMEDIATE_ATTACK : IMMEDIATE_RELEASE, dt);

    return { sustained: this.sustained, immediate: this.immediate, raw, terms: t, driver: this.driver };
  }

  /**
   * The largest weighted contribution.
   *
   * Displayed in the MIX panel so the coupling is legible: "the track is going
   * hard because you are ON A TEAR" is a different — and much more interesting —
   * piece of information than a number moving.
   */
  private driver: keyof TensionTerms = 'crowding';

  /** Nudge the transient channel for a discrete event (explosion, pickup). */
  jolt(amount: number): void {
    this.immediate = clamp01(this.immediate + amount);
  }

  get value(): number {
    return this.sustained;
  }

  get rawValue(): number {
    return this.lastRaw;
  }
}
