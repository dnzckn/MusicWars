/**
 * Immediate, unquantised sound effects.
 *
 * The music is quantised to the bar because that is what makes it music. Game
 * feedback is the opposite: a pickup that arrives on the next downbeat feels
 * broken, because the player's hand and the sound have to agree. So SFX skip
 * the pattern scheduler entirely and go straight to `superdough`, which takes
 * an absolute AudioContext time — latency lands around 30ms instead of the
 * scheduler's ~200ms lookahead plus quantisation.
 *
 * They still use the same synth engine and the same orbits as the music, so
 * they sit in the mix rather than on top of it.
 */

import { getAudioContext, superdough } from '@strudel/webaudio';
import { ORBIT_AIR } from './kit';
import { masterVolume } from './volume';

/** Small offset so we are never scheduling into the past. */
const LEAD = 0.02;

type Voice = Record<string, unknown>;

/*
 * Note on values: these objects go straight into superdough, skipping the
 * control layer that patterns go through. That layer is what expands
 * mini-array strings like `"2:0.5"` into `{distort: 2, distortvol: 0.5}`, so
 * here every parameter must already be a plain number. Passing the string form
 * lands as a non-finite AudioParam and throws from inside a worklet
 * constructor, nowhere near the call site.
 */

/**
 * Minimum spacing per SFX channel, in seconds, and the burst credit each one
 * carries.
 *
 * At wave 23 the game triggers about thirty SFX a second — 6.6 enemy hits, 4.3
 * deaths, 3.3 enemy shots, 4.6 spawns, plus ~11 player shots — against about
 * five a second at wave 5. Every one of those builds an audio graph, and the
 * measured node churn is 104 gain nodes a second; not firing at all is worth
 * 4.8fps.
 *
 * Dropping the extras outright would make a big moment quieter than a small
 * one, so a suppressed hit instead lends its weight to the next one that gets
 * through: five deaths in a frame become one louder death. That is also how it
 * should have sounded in the first place — five copies of the same sample
 * inside 80ms is mud, not impact, and this mix already has eleven stems in it.
 */
const CHANNEL_SPACING: Record<string, number> = {
  hit: 0.055,
  death: 0.07,
  enemyFire: 0.06,
  graze: 0.05,
  /*
   * Shards are the densest channel in the game and the one that most needs the
   * merge. 92-108 are collected in a two minute stretch in ordinary play, and a
   * bomb into a packed wave collects thirty inside a single frame. 35ms is
   * tighter than any other channel because a shard tick has to feel like it
   * belongs to the individual pickup rather than to the group -- at 70ms a
   * fast sweep through a trail of them merges into one event and stops reading
   * as "I am hoovering these up". The burst credit above is what stops that
   * being a problem: thirty in a frame become one tick with thirty's weight.
   */
  shard: 0.035,
};

const lastFired: Record<string, number> = {};
const burstCredit: Record<string, number> = {};

function fire(voice: Voice, duration = 0.25, delay = 0, channel?: string): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') return;
    const vol = masterVolume();
    if (vol <= 0) return;
    let gain = typeof voice.gain === 'number' ? voice.gain : 0.8;

    if (channel) {
      const spacing = CHANNEL_SPACING[channel] ?? 0;
      const now = ctx.currentTime;
      if (now - (lastFired[channel] ?? -1) < spacing) {
        // Cap the credit: a wall of enemies should not produce one enormous
        // bang, just a clearly bigger one.
        burstCredit[channel] = Math.min(0.6, (burstCredit[channel] ?? 0) + 0.16);
        return;
      }
      lastFired[channel] = now;
      gain *= 1 + (burstCredit[channel] ?? 0);
      burstCredit[channel] = 0;
    }
    void superdough(
      { orbit: ORBIT_AIR, ...voice, gain: gain * vol },
      ctx.currentTime + LEAD + delay,
      duration,
    );
  } catch {
    // A missing AudioContext before boot is expected; SFX are never critical.
  }
}

/*
 * The player's weapon, as an instrument.
 *
 * Every other sound in the game is derived from the current harmony; the
 * player's own shots were a fixed blip at MIDI 74 regardless of key, which made
 * the one thing under direct control the one thing not participating.
 *
 * Holding fire now walks up the chord and keeps climbing into the octave above,
 * resetting after a short gap — so a sustained burst is an ascending arpeggio
 * the player performs by shooting, and tapping gives repeated root notes. The
 * fire rate is slow enough (5/s) for the individual notes to read.
 */
let shotStep = 0;
let lastShotAt = 0;
const SHOT_RESET_MS = 420;

/**
 * How each instrument SOUNDS when it fires.
 *
 * Every ability in this game is named for a musician, and until now they all
 * made the same blip. PIZZICATO ("dry bolts"), ROSIN BOW ("one held beam"),
 * CHIME ("strikes something from above") and TIMPANI ("a slow, enormous
 * shockwave") were acoustically identical — which is the premise broken at the
 * most-heard point in the whole game, since the player fires continuously and
 * this is the sound they hear more than any other.
 *
 * The parameters are chosen from the blurb, not invented: a pluck is a short
 * bright transient, a bow is a slow bloom with no attack edge, a bell is a long
 * decay with inharmonic content high up, a drum is a low body with almost no
 * pitch. Somebody who has read the ability list should recognise the sound.
 *
 * `octave` shifts the whole figure so instruments occupy different registers —
 * a timpani that fires at the same pitch as a chime is two instruments with one
 * voice. Everything stays derived from the current harmony, which is the rule
 * the rest of this file already follows.
 */
interface ShotVoice {
  s: string;
  decay: number;
  hpf: number;
  lpf: number;
  gain: number;
  octave: number;
  room: number;
}

const SHOT_VOICES: Partial<Record<string, ShotVoice>> = {
  // Dry, short, bright — the sound the default weapon already made.
  pizzicato: { s: 'square', decay: 0.055, hpf: 700, lpf: 6000, gain: 0.04, octave: 0, room: 0.14 },
  // A sweep, not a point: noisier, wider, and lower than the plucked voice.
  snare: { s: 'triangle', decay: 0.085, hpf: 420, lpf: 4200, gain: 0.038, octave: -12, room: 0.2 },
  // Held and unedged. A long decay and a low cutoff is a bow rather than a hit.
  bow: { s: 'sawtooth', decay: 0.22, hpf: 200, lpf: 2600, gain: 0.03, octave: -12, room: 0.26 },
  // A struck bell: the longest decay in the set, high and thin, well above the
  // rest so it rings over the top the way its lane (`lead`) does.
  chime: { s: 'triangle', decay: 0.42, hpf: 900, lpf: 9000, gain: 0.028, octave: 12, room: 0.38 },
  // A gliss is a rush of small bright things.
  harp: { s: 'square', decay: 0.07, hpf: 800, lpf: 7500, gain: 0.032, octave: 12, room: 0.22 },
  // Circling pods: a hollow, sustained hum, low and quiet.
  drones: { s: 'triangle', decay: 0.3, hpf: 120, lpf: 1800, gain: 0.03, octave: -24, room: 0.3 },
  // Body, not pitch. Almost everything above the fundamental removed.
  timpani: { s: 'sine', decay: 0.34, hpf: 40, lpf: 700, gain: 0.055, octave: -24, room: 0.24 },
  // A ring on the beat — short, wide open, no low end to fight the kick.
  nova: { s: 'square', decay: 0.12, hpf: 500, lpf: 8000, gain: 0.034, octave: 0, room: 0.3 },

  /* ---------------------------------------------------------------------- *
   * THE TWELVE ROWS THE TWENTY-WEAPON ROSTER NEEDED, so that every base has
   * its OWN firing sound rather than falling back to its character family.
   *
   * The family table below is the floor and it guarantees coverage; a family
   * covers six words across twenty weapons, so without these twelve rows a
   * run holding EMBER and NOCTURNE would hear one voice for both. Sharing an
   * `ENSEMBLE_MIX` stem lane is fine — that is an arrangement decision and
   * `ensembleLift` sums it — but sharing the sound of pulling the trigger is
   * the thing the `player:shoot` fix was for in the first place.
   *
   * Eight of the twenty already had a row (`pizzicato`, `snare`, `bow`,
   * `chime`, `harp`, `drones`, `timpani`, `nova`) and keep it unchanged, even
   * where the weapon on that id has moved: the voices were written for the
   * TIMBRE the id names, and GLASS on `chime` still wants a struck bell.
   * ---------------------------------------------------------------------- */
  // Coals: short, dirty, no tail. Fire has no pitch.
  ember: { s: 'sawtooth', decay: 0.06, hpf: 900, lpf: 5200, gain: 0.036, octave: 0, room: 0.16 },
  // A body that is not there: soft attack, long room, nothing in the middle.
  phantom: { s: 'sine', decay: 0.3, hpf: 300, lpf: 2400, gain: 0.026, octave: -12, room: 0.42 },
  // Struck metal. Low, loud, and gone.
  anvil: { s: 'square', decay: 0.16, hpf: 60, lpf: 1400, gain: 0.052, octave: -24, room: 0.18 },
  // Grit. Wide noise band, no fundamental worth hearing.
  gravel: { s: 'sawtooth', decay: 0.12, hpf: 140, lpf: 1100, gain: 0.044, octave: -24, room: 0.2 },
  // One low held tone with nothing above it.
  nocturne: { s: 'triangle', decay: 0.38, hpf: 70, lpf: 900, gain: 0.04, octave: -24, room: 0.34 },
  // A breath drawn in: quiet, dark, slightly late.
  siphon: { s: 'sine', decay: 0.2, hpf: 180, lpf: 2000, gain: 0.028, octave: -12, room: 0.3 },
  // A click track pulling ahead — hard, bright, very short.
  accelerando: { s: 'square', decay: 0.035, hpf: 1200, lpf: 9000, gain: 0.03, octave: 12, room: 0.1 },
  // Two voices agreeing: the only entry with any sweetness in it.
  charm: { s: 'triangle', decay: 0.24, hpf: 600, lpf: 6000, gain: 0.03, octave: 12, room: 0.36 },
  // The three re-pointed ids whose old timbre no longer fits the weapon.
  // A poisoned pool: slow, beating, unresolved.
  tremolo: { s: 'sawtooth', decay: 0.26, hpf: 240, lpf: 1800, gain: 0.03, octave: -12, room: 0.3 },
  // Lightning: a crack with a squeal on top.
  feedback: { s: 'square', decay: 0.07, hpf: 1500, lpf: 11000, gain: 0.032, octave: 12, room: 0.22 },
  // The echo unit answering itself: bright, short, a lot of room.
  echoes: { s: 'triangle', decay: 0.1, hpf: 700, lpf: 7000, gain: 0.03, octave: 0, room: 0.46 },
  // A suspension that will not resolve: low, held, no attack.
  blackhole: { s: 'sine', decay: 0.44, hpf: 40, lpf: 600, gain: 0.046, octave: -24, room: 0.3 },

  /* ---------------------------------------------------------------------- *
   * TEN ROWS FOR THE TEN VAMPIRE SURVIVORS DELIVERIES.
   *
   * The family table below already guarantees coverage — every one of the ten
   * declares one of its six words — so none of these is required to make the
   * game make a sound. They are here because a family covers six words across
   * THIRTY weapons now, and the whole argument for `SHOT_VOICES` is that
   * sharing an `ENSEMBLE_MIX` lane is an arrangement decision while sharing
   * the sound of pulling the trigger is not.
   *
   * Two of the ten are the interesting ones to write, because the weapon deals
   * no damage. DAMPER is a REFILL rather than a shot — one low soft thud when
   * a charge comes back, which is the only thing the player needs told — and
   * CAESURA is a line being drawn rather than a hit landing, so it has almost
   * no attack and a long tail.
   * ---------------------------------------------------------------------- */
  // Thrown and caught: a struck rim with a tail that comes back up.
  rondo: { s: 'triangle', decay: 0.18, hpf: 400, lpf: 5200, gain: 0.034, octave: 0, room: 0.3 },
  // Four square strokes: hard, dry, identical every time.
  quadrille: { s: 'square', decay: 0.045, hpf: 900, lpf: 7000, gain: 0.03, octave: 0, room: 0.1 },
  // A figure sinking into the floor. Low, repeating, no edge.
  ostinato: { s: 'sawtooth', decay: 0.3, hpf: 90, lpf: 1200, gain: 0.034, octave: -24, room: 0.26 },
  // The answer, louder than the call: a hard bloom with a long room.
  antiphon: { s: 'sawtooth', decay: 0.26, hpf: 300, lpf: 4000, gain: 0.05, octave: -12, room: 0.44 },
  // The last bar. The lowest, longest thing in the table.
  coda: { s: 'sine', decay: 0.55, hpf: 30, lpf: 520, gain: 0.06, octave: -24, room: 0.4 },
  // A charge coming back, not a shot going out: soft, dark, unhurried.
  damper: { s: 'sine', decay: 0.26, hpf: 100, lpf: 900, gain: 0.024, octave: -12, room: 0.34 },
  // A line drawn rather than a hit landed: no attack edge, a long thin tail.
  caesura: { s: 'triangle', decay: 0.46, hpf: 1100, lpf: 9500, gain: 0.022, octave: 12, room: 0.5 },
  // The crack on two and four. Short, bright, and it wants to be heard.
  backbeat: { s: 'square', decay: 0.05, hpf: 600, lpf: 8000, gain: 0.044, octave: 0, room: 0.18 },
  // Chance events: thin, high, scattered, each one different from the last.
  aleatory: { s: 'triangle', decay: 0.14, hpf: 1400, lpf: 11000, gain: 0.026, octave: 12, room: 0.4 },
  // Every note at once, close and low: the muddiest voice in the set, on purpose.
  cluster: { s: 'sawtooth', decay: 0.2, hpf: 70, lpf: 1600, gain: 0.038, octave: -24, room: 0.22 },
};

/**
 * A voice per character FAMILY, so every instrument has one — not just the
 * eight I happened to write out.
 *
 * `weapons.ts` authors a `character` phrase for each of the 26 instruments and
 * its header states the intent plainly: "the audio side reads it". It did not.
 * Keying on the family the phrase already declares means fusions are covered
 * automatically — CARILLON is "shimmering — bells chaining into each other" and
 * now fires like a bell rather than like the default pluck — and a new
 * instrument gets a sensible voice the moment somebody writes its character
 * line, with nothing to remember to update here.
 *
 * The family arrives on the `player:shoot` event rather than being looked up,
 * because `src/audio/` does not import `src/game/`. A second copy of this
 * mapping living here is exactly the drift this avoids.
 */
const SHOT_FAMILIES: Partial<Record<string, ShotVoice>> = {
  aggressive: { s: 'square', decay: 0.055, hpf: 700, lpf: 6000, gain: 0.04, octave: 0, room: 0.14 },
  mechanical: { s: 'triangle', decay: 0.085, hpf: 420, lpf: 4200, gain: 0.038, octave: -12, room: 0.2 },
  mournful: { s: 'sawtooth', decay: 0.22, hpf: 200, lpf: 2600, gain: 0.03, octave: -12, room: 0.26 },
  shimmering: { s: 'triangle', decay: 0.34, hpf: 900, lpf: 9000, gain: 0.028, octave: 12, room: 0.34 },
  heavy: { s: 'sine', decay: 0.34, hpf: 40, lpf: 700, gain: 0.055, octave: -24, room: 0.24 },
  eerie: { s: 'triangle', decay: 0.3, hpf: 120, lpf: 1800, gain: 0.03, octave: -24, room: 0.3 },
};

const DEFAULT_SHOT: ShotVoice = SHOT_FAMILIES.aggressive as ShotVoice;

/**
 * Returns the MIDI note played, so tooling can verify the figure.
 *
 * `instrument` is optional so every existing caller keeps working unchanged and
 * simply gets the plucked voice — the sound the game already made.
 */
export function sfxShoot(
  chord: readonly number[],
  focused: boolean,
  instrument?: string,
  family?: string,
): number {
  const tones = chord.length ? chord : [57, 60, 64];
  const now = performance.now();
  if (now - lastShotAt > SHOT_RESET_MS) shotStep = 0;
  lastShotAt = now;

  const span = tones.length * 2;
  const idx = shotStep % span;
  const note = tones[idx % tones.length] + (idx >= tones.length ? 12 : 0) + 24;
  shotStep = (shotStep + 1) % span;

  /*
   * Id override first, then the authored family, then the default.
   *
   * The per-id table is not redundant with the family one: CHIME and HARP GLISS
   * are both "shimmering", and a struck bell and a cascading run should not
   * sound the same. The family is the floor that guarantees coverage; the id is
   * where a blurb says something the family word cannot.
   */
  const v = (instrument && SHOT_VOICES[instrument]) || (family && SHOT_FAMILIES[family]) || DEFAULT_SHOT;
  /*
   * Focusing still darkens and drops the voice an octave — concentrating
   * sounds different as well as hitting harder — but it now modifies the
   * instrument's own character rather than replacing it with one fixed tone.
   * A focused bow and a focused chime should still be a bow and a chime.
   */
  const sounded = note + v.octave - (focused ? 12 : 0);
  fire(
    {
      s: focused && v.s === 'square' ? 'triangle' : v.s,
      note: sounded,
      decay: focused ? v.decay * 1.5 : v.decay,
      sustain: 0,
      hpf: focused ? Math.max(40, v.hpf * 0.45) : v.hpf,
      lpf: v.lpf,
      gain: focused ? v.gain * 1.2 : v.gain,
      pan: 0.5,
      room: v.room,
    },
    focused ? Math.max(0.12, v.decay * 1.6) : Math.max(0.07, v.decay * 1.2),
  );
  return sounded;
}

/** A hit answers the shot, an octave above the chord tone that caused it. */
export function sfxEnemyHit(chord: readonly number[]): void {
  const tones = chord.length ? chord : [57, 60, 64];
  fire({
      s: 'sine',
      note: tones[tones.length - 1] + 36,
      decay: 0.06,
      sustain: 0,
      gain: 0.035,
      pan: 0.5,
    }, 0.08, 0, 'hit');
  fire({ s: 'white', decay: 0.025, sustain: 0, hpf: 4200, gain: 0.05 }, 0.04);
}

/**
 * A musician stopping, not just an explosion.
 *
 * The premise of this game is that the enemies ARE the band on the other side —
 * `sfxEnemyFire` already gives each archetype its own timbre, degree and
 * register through `FIRE_VOICE`, so you can hear which one is shooting at you.
 * Death threw all of that away: every enemy died as the same noise burst and
 * sine drop, which is the one moment the player causes most often and the one
 * where knowing *what* you just killed matters most.
 *
 * The impact body stays — it reads as a hit and it should. What is added is the
 * dying voice itself: the archetype's own waveform and pitch, sagging a fourth
 * over 120ms. A player who has learned that the high square chatter is a
 * STUTTER now hears that square go down when they kill one, and a SUBDROP's
 * sawtooth sags an octave lower than everything else. Same information the fire
 * sound carries, at the other end of the enemy's life.
 *
 * `rootMidi` is the current chord root, so the dying note belongs to the
 * harmony like everything else in this file. Both parameters are optional and
 * omitting them gives exactly the previous sound.
 */
export function sfxEnemyDeath(size = 0.5, archetype?: string, rootMidi = 57): void {
  fire({
      s: 'white',
      decay: 0.12 + size * 0.2,
      sustain: 0,
      lpf: 1800 + size * 2600,
      distort: 2,
      distortvol: 0.5,
      gain: 0.16 + size * 0.14,
      room: 0.25,
    }, 0.4, 0, 'death');
  fire({
      s: 'sine',
      note: 40 - size * 8,
      penv: 20,
      pdecay: 0.09,
      pcurve: 1,
      decay: 0.18 + size * 0.2,
      sustain: 0,
      gain: 0.2 + size * 0.2,
    }, 0.4, 0, 'death');

  const v = archetype ? FIRE_VOICE[archetype] : undefined;
  if (!v) return;
  /*
   * The sag. `penv` starts the note that many semitones ABOVE its target and
   * glides down over `pdecay`, so targeting a fourth below the archetype's
   * speaking pitch makes the voice begin exactly where it would have played and
   * fall away from it. Quieter than the fire sound it echoes: this is the same
   * instrument, losing power, not announcing itself.
   */
  const spoken = rootMidi + v.degree + v.octave;
  fire({
      s: v.wave,
      note: spoken - 5,
      penv: 5,
      pdecay: 0.12,
      pcurve: 1,
      decay: 0.16 + size * 0.12,
      sustain: 0,
      lpf: 5200,
      gain: v.level * (0.8 + size * 0.5),
      room: 0.3,
    }, 0.35, 0, 'death');
}

/** Graze: a bright, quiet tick. Fires a lot, so it must never dominate. */
export function sfxGraze(streak: number): void {
  fire({
      s: 'sine',
      note: 88 + Math.min(streak, 12),
      decay: 0.05,
      sustain: 0,
      gain: 0.05,
      pan: 0.6,
      delay: 0.2,
      delaytime: 0.09,
      delayfeedback: 0.2,
    }, 0.08, 0, 'graze');
}

export function sfxPickup(step = 0): void {
  // A rising arpeggio, one voice per note, scheduled a few ms apart.
  const notes = [72, 76, 79, 84];
  notes.forEach((n, i) => {
    fire(
      { s: 'triangle', note: n + step, decay: 0.1, sustain: 0, gain: 0.11, room: 0.2 },
      0.14,
      i * 0.045,
    );
  });
}

/**
 * A note shard collected — the game's most frequent reward, and until now a
 * silent one.
 *
 * WHAT WAS WRONG. Collecting a shard emitted a 2px dot particle and nothing
 * else. Measured in ordinary play, that is 92 to 108 unacknowledged rewards
 * every two minutes, and separately a third to a half of all shards expire
 * uncollected — a player has no way to learn that picking them up matters when
 * picking one up makes no sound. The XP economy read as weather rather than as
 * something the player was doing.
 *
 * WHY IT IS A TICK AND NOT AN ARPEGGIO. `sfxPickup` exists and is a rising
 * four-note figure over 135ms; it is right for a powerup, which happens rarely.
 * Firing it at 50 a minute would be a melody nobody wrote fighting the eleven
 * stems that someone did. This is one short voice, deliberately quiet, sitting
 * an octave above the pad where there is room.
 *
 * `tier` moves the pitch so the three shard grades are audibly different -- a
 * rare shard should sound like a better thing to have chased. `combo` lifts it
 * by up to a fifth across the streak, so a run of pickups walks upward and the
 * streak becomes something you hear rather than something you would have to
 * read off the corner of the screen.
 *
 * The `shard` channel merges bursts; see CHANNEL_SPACING.
 */
export function sfxShard(tier = 0, combo = 0): void {
  // Root an octave above the pickup arpeggio's base, so it sits clear of the
  // pad and the motor rather than competing in the 200-800Hz crowd.
  const step = Math.min(7, Math.round(combo * 0.12));
  fire(
    {
      s: 'triangle',
      note: 84 + tier * 3 + step,
      decay: 0.05,
      sustain: 0,
      gain: 0.055,
      room: 0.12,
    },
    0.07,
    0,
    'shard',
  );
}

export function sfxPlayerHit(): void {
  fire(
    {
      s: 'sawtooth',
      note: 45,
      penv: -18,
      pdecay: 0.35,
      decay: 0.5,
      sustain: 0,
      lpf: 900,
      distort: 4,
      distortvol: 0.6,
      gain: 0.32,
      room: 0.4,
    },
    0.7,
  );
  fire({ s: 'white', decay: 0.3, sustain: 0, lpf: 2200, gain: 0.2 }, 0.4);
}

export function sfxBomb(): void {
  fire(
    { s: 'white', decay: 0.9, sustain: 0, lpf: 6000, gain: 0.3, room: 0.6, roomsize: 8 },
    1.2,
  );
  fire(
    {
      s: 'sine',
      note: 34,
      penv: -26,
      pdecay: 0.7,
      pcurve: 1,
      decay: 1.1,
      sustain: 0,
      gain: 0.42,
      distort: 3,
      distortvol: 0.5,
    },
    1.3,
  );
}

/**
 * A resolving cadence when a wave clears.
 *
 * Clearing a wave previously produced no sound of its own — the arrangement
 * just thinned out. A short rising chord that lands on the tonic gives the
 * moment a full stop, and because it is built from the run's actual key it
 * belongs to the track rather than sitting on top of it.
 */
export function sfxWaveClear(notes: readonly number[], grade: 'perfect' | 'clean' | 'rough' = 'clean'): void {
  const voiced = notes.length ? notes : [60, 64, 67];
  // A flawless wave resolves upward and open; a mauling resolves down and
  // closed. Same chord, different posture — which is how a real player would
  // land the same cadence after a good take versus a bad one.
  const lift = grade === 'perfect' ? 12 : grade === 'rough' ? -12 : 0;
  const bright = grade === 'perfect' ? 1 : grade === 'rough' ? 0.42 : 0.7;
  const stagger = grade === 'perfect' ? 0.045 : 0.075;
  voiced.forEach((n, i) => {
    fire(
      {
        s: 'triangle',
        note: n + 12 + lift,
        attack: 0.01,
        decay: 0.5,
        sustain: 0.25,
        release: 0.7,
        lpf: 1400 + bright * 3600,
        gain: 0.09 + bright * 0.05,
        room: 0.45 + bright * 0.3,
        roomsize: 7,
      },
      1.1,
      i * stagger,
    );
  });
  // A flawless clear earns a bell an octave up — the only place in the game
  // that sound appears, so it is unmistakably a reward.
  if (grade === 'perfect') {
    fire(
      { s: 'sine', note: voiced[voiced.length - 1] + 24, fm: 3, fmh: 2.01, decay: 0.5, sustain: 0,
        gain: 0.12, room: 0.7, roomsize: 8, delay: 0.3, delaytime: 0.16, delayfeedback: 0.35 },
      0.9,
      0.16,
    );
  }
  // The tonic underneath, so it reads as a resolution rather than a chime.
  fire(
    { s: 'sine', note: voiced[0] - 12, attack: 0.02, decay: 0.7, sustain: 0.2, release: 0.6, gain: 0.16 },
    1.2,
    0.05,
  );
}

/**
 * Curtain up.
 *
 * The scheduler needs a moment to spin up, and the intro pad has a 450ms
 * attack, so the first pattern-driven sound of a run measured ~2.9s after the
 * player pressed start — an eternity when you have just clicked a button. This
 * goes through the unquantised path (~30ms) so the game answers the click
 * immediately, and it swells rather than hits, so it reads as the track opening
 * rather than as a sound effect bolted on the front.
 */
export function sfxRunStart(notes: readonly number[]): void {
  const voiced = notes.length ? notes : [57, 60, 64];
  voiced.forEach((n, i) => {
    fire(
      /*
       * The curtain-up is a CHORD, not a supersaw swell.
       *
       * This is the literal first sound of the game — it fires on the click,
       * ahead of the scheduler, before the arrangement has played a note. It
       * was five detuned saws, which meant the very first thing the player
       * heard announced the genre before any music had a chance to.
       *
       * A 50%-duty pulse per voice, spread across the stereo field, gives the
       * same swelling three-part chord without the detune beating. Width comes
       * from the three notes being placed apart rather than from each one being
       * seven of itself — which is how the canon gets width, and is also why
       * this now matches the pad the intro is about to bring in.
       *
       * Envelope untouched: the long attack and tail were right, and the note
       * above them about swelling rather than hitting is the best sentence in
       * this file.
       */
      {
        s: 'pulse',
        pw: 0,
        note: n,
        // Fan the three voices left-to-centre-to-right so the chord opens out.
        pan: voiced.length > 1 ? 0.2 + (i / (voiced.length - 1)) * 0.6 : 0.5,
        attack: 0.5,
        decay: 0.6,
        sustain: 0.35,
        release: 1.4,
        lpf: 900,
        gain: 0.11,
        room: 0.7,
        roomsize: 8,
      },
      2.2,
      i * 0.08,
    );
  });
  fire(
    { s: 'sine', note: voiced[0] - 12, attack: 0.35, decay: 0.8, sustain: 0.3, release: 1.2, gain: 0.14 },
    2.4,
  );
}

/**
 * The sound of an enemy shooting: a pitched note, not a noise.
 *
 * Each archetype gets a fixed scale degree and register, so a screen of them
 * firing produces a chord rather than a clatter — and because volleys are
 * locked to the beat grid, the result is in time without any quantisation
 * here. Panned by screen position, so the battlefield has a stereo image.
 */
const FIRE_VOICE: Record<string, { degree: number; octave: number; wave: string; level: number }> = {
  pluck: { degree: 0, octave: 12, wave: 'triangle', level: 0.055 },
  stutter: { degree: 4, octave: 24, wave: 'square', level: 0.03 },
  arpeggiator: { degree: 2, octave: 12, wave: 'square', level: 0.045 },
  glissando: { degree: 6, octave: 12, wave: 'triangle', level: 0.05 },
  subdrop: { degree: 0, octave: -12, wave: 'sawtooth', level: 0.07 },
  echo: { degree: 4, octave: 12, wave: 'triangle', level: 0.05 },
  rush: { degree: 0, octave: 0, wave: 'sawtooth', level: 0.04 },
  conductor: { degree: 0, octave: 0, wave: 'sawtooth', level: 0.07 },
};

/** Rate limit, so a dense wave stays a texture rather than a wall of clicks. */
let lastFireNote = 0;

export function sfxEnemyFire(archetype: string, rootMidi: number, pan: number): void {
  const v = FIRE_VOICE[archetype];
  if (!v) return;
  const now = performance.now();
  if (now - lastFireNote < 55) return;
  lastFireNote = now;
  fire({
      s: v.wave,
      note: rootMidi + v.degree + v.octave,
      decay: 0.14,
      sustain: 0,
      lpf: 3200,
      gain: v.level,
      pan: Math.min(1, Math.max(0, pan)),
      room: 0.22,
      delay: 0.18,
      delaysync: 3 / 16,
      delayfeedback: 0.22,
    }, 0.2, 0, 'enemyFire');
}

export function sfxExtend(): void {
  [72, 79, 84, 91].forEach((n, i) => {
    fire({ s: 'triangle', note: n, decay: 0.3, sustain: 0, gain: 0.14, room: 0.4 }, 0.4, i * 0.08);
  });
}
