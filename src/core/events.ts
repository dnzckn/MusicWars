/**
 * The game/music contract.
 *
 * The simulation never talks to Strudel. It emits these events and publishes a
 * numeric snapshot each frame; the music director is the only thing that knows
 * what a chord is. Keeping the boundary this narrow means either half can be
 * rewritten without touching the other.
 *
 * Events are *transient* (something happened at an instant). Continuous state
 * lives in `GameSnapshot` and is polled instead, because sending "there are now
 * 412 bullets" down an event bus 60 times a second would be silly.
 */

export type EnemyArchetype =
  | 'pluck'
  | 'stutter'
  | 'arpeggiator'
  | 'glissando'
  | 'subdrop'
  | 'echo'
  | 'rush'
  | 'conductor';

/**
 * Shard grades. Vampire Survivors blue / green / red.
 *
 * Defined here rather than in progression.ts because this file is where the
 * shared vocabulary lives -- AbilityId, PowerupKind and GraceKind are all
 * declared here and imported by game/, never the other way round. The
 * shard:collect event needs the type, and a core module reaching into
 * game/ for it would invert that. progression.ts re-exports it, so every
 * existing prog.ShardTier reference is unchanged.
 */
export type ShardTier = 'minor' | 'major' | 'rare';

export type PowerupKind =
  | 'spread'
  | 'laser'
  | 'homing'
  | 'rapid'
  | 'drones'
  | 'nova'
  | 'magnet'
  | 'timewarp'
  | 'overdrive'
  | 'encore'
  | 'blackhole'
  | 'bomb'
  | 'ward';

/**
 * The progression system's abilities.
 *
 * Every one of these is an INSTRUMENT before it is a weapon. That is not
 * flavour text: the mix reads the loadout, so what the player is holding is
 * literally what the band is playing, and a level-up is recruiting a musician
 * rather than incrementing a stat. The ids are named for what they sound like
 * for exactly that reason.
 *
 * Six ids are shared verbatim with `PowerupKind` — `drones`, `nova` and
 * `blackhole` carry across as instruments, and `laser`, `spread`, `rapid`,
 * `homing`, `magnet` and `timewarp` as rig items. The overlap is deliberate:
 * those already have voices written in `audio/layers.ts` and reusing the id
 * means the existing voice keeps working untouched. `overdrive`, `encore` and
 * `bomb` stay outside the progression system entirely as field-dropped surges.
 */
export type InstrumentId =
  /*
   * TWELVE BECAME TWENTY, AND TWELVE OF THE TWENTY ARE THESE IDS RE-POINTED.
   *
   * `docs/plan-refactor-3.md` §9 takes the roster from Ball x Pit rather than
   * from imagination: twenty base weapons that are each ONE COMPOSABLE
   * PROPERTY, delivered by a small shared set of shapes. The twelve ids below
   * the divider are unchanged and keep their `ENSEMBLE_MIX` lane, their
   * per-id shot voice and their place in `layers.ts`; what moved is what each
   * one DOES. Re-pointing is the move AGENTS.md §5 names — change what a card
   * is worth, do not add a card — and it is why this pass adds eight ids
   * rather than twenty.
   */
  | 'pizzicato'
  | 'snare'
  | 'bow'
  | 'chime'
  | 'harp'
  | 'drones'
  | 'nova'
  | 'blackhole'
  | 'feedback'
  | 'echoes'
  | 'timpani'
  | 'tremolo'
  /*
   * The eight genuinely new ones. Each takes an EXISTING stem lane in
   * `ENSEMBLE_MIX` and an authored voice in `audio/sfx.ts` — no new lane, no
   * new synth, and `tools/instruments.mjs` is what proves it.
   *
   * These EIGHT ARE THE WHOLE OFFER-POOL COST of the pass: twenty draftable
   * instruments against twelve is a real dilution and it is measured rather
   * than waved at. See `tools/offerpool.mjs`.
   */
  | 'ember'
  | 'phantom'
  | 'anvil'
  | 'gravel'
  | 'nocturne'
  | 'siphon'
  | 'accelerando'
  | 'charm';

/**
 * Fusions. Never offered at a level-up — only earned, by taking an instrument
 * to its ceiling and holding the one rig item that catalyses it. The two
 * unions at the end cost two maxed instruments *and* two maxed rig items, and
 * are meant to be near-unreachable: a run that reaches REQUIEM has produced a
 * timbre nothing else in the game can make.
 */
export type EvolvedId =
  | 'spiccato'
  | 'blastbeat'
  | 'harmonics'
  | 'carillon'
  | 'crossstrung'
  | 'chorale'
  | 'cathedral'
  | 'downbeat'
  | 'wallofsound'
  | 'canon'
  | 'tutti'
  | 'vibrato'
  | 'requiem'
  | 'stringsection'
  /*
   * The first BRANCH: a second destination for an instrument that already had
   * one. Every other id above is the sole evolution of its base, so committing
   * to an instrument determined its ending and the only question was whether
   * its one catalyst ever showed up. `snap` makes PIZZICATO the first
   * instrument you can take two ways. See the note beside it in `weapons.ts`.
   */
  | 'snap'
  /*
   * EIGHT MORE RESULTS, AND THEY COST NOTHING IN THE OFFER.
   *
   * `progression.ts:606` skips `def.fused` outright when building the draft
   * pool, so a fusion result is never a card — AGENTS.md §5 states this as the
   * one free move the system has. Twenty bases need twenty recipes (
   * `tools/levelup.mjs` fails any instrument that is a dead end to commit to),
   * so eight new results is arithmetic rather than appetite.
   *
   * Six of them exist to KEEP THE MODIFIER SHAPES ALIVE. `rest`, `drag`,
   * `ghost`, `counterpoint`, `unison` and `tacet` are `docs/plan-items-v2.md`'s
   * second axis — items that change a rule rather than where a hitbox appears
   * — and none of the twenty property weapons is one. Rather than delete six
   * working shapes on the way past, each becomes a fusion result: still
   * reachable, still measured, and `tools/builds.mjs`' damage-taken spread
   * (which they are the reason for) keeps its contributors.
   */
  | 'pyre'
  | 'revenant'
  | 'maestro'
  | 'sordino'
  | 'adagio'
  | 'interlude'
  | 'fugue'
  | 'consort'
  /*
   * THE LATTICE. Sixty-three authored results for INSTRUMENT PAIRS, which is
   * the tier `docs/plan-refactor-3.md` 9d asks for and the one Ball x Pit
   * actually spends its variety on: 21 base balls, 69 hand-authored fusions.
   *
   * THEY COST NOTHING IN THE OFFER, which is the only reason there can be
   * sixty-three of them. `progression.ts` skips `def.fused` when it builds
   * the draft pool, so not one of these is ever a card — AGENTS.md 5 names
   * that as the system's one free move and this is it spent in full.
   *
   * `C(20,2)` is 190 pairs. Sixty-three are named here; the other 127 fall
   * through to the generic DUET, which merges both parents' properties, so
   * no pair is a dead end. See `synthesiseDuet` in `weapons.ts`.
   */
  | 'detonate'
  | 'frostfire'
  | 'inferno'
  | 'magma'
  | 'brimstone'
  | 'sun'
  | 'fireworks'
  | 'timestop'
  | 'frostray'
  | 'blizzard'
  | 'glacier'
  | 'venom'
  | 'wraith'
  | 'swamp'
  | 'virus'
  | 'noxious'
  | 'radiation'
  | 'hemorrhage'
  | 'sacrifice'
  | 'heartswallower'
  | 'vampirelord'
  | 'berserk'
  | 'storm'
  | 'flash'
  | 'rod'
  | 'lightningbug'
  | 'sandstorm'
  | 'erosion'
  | 'shade'
  | 'assassin'
  | 'soulsucker'
  | 'temper'
  | 'drill'
  | 'sforzando'
  | 'cutter'
  | 'catapult'
  | 'petrify'
  | 'landslide'
  | 'flicker'
  | 'incubus'
  | 'warp'
  | 'succubus'
  | 'zombie'
  | 'mosquitoswarm'
  | 'mosquitoking'
  | 'offspring'
  | 'clutch'
  | 'overgrowth'
  | 'maggot'
  | 'spiderqueen'
  | 'leeches'
  | 'fleshmound'
  | 'lovestruck'
  | 'beam'
  | 'fallout'
  | 'timebomb'
  | 'armageddon'
  | 'banshee'
  | 'reaper'
  | 'eventhorizon'
  | 'xray'
  | 'sniper'
  | 'diabolus';

/**
 * Passive items. Global multipliers, so their honest voicing is to MODIFY an
 * existing stem rather than to add a lane of their own — the same rule the
 * original powerups follow, and the reason the mix has stayed legible.
 */
export type RigId =
  | 'laser'
  | 'spread'
  | 'rapid'
  | 'homing'
  | 'magnet'
  | 'timewarp'
  | 'reverb'
  | 'compressor'
  | 'capo'
  | 'fermata'
  | 'tempo'
  | 'resonance';

export type AbilityId = InstrumentId | EvolvedId | RigId;
export type AbilitySlot = 'instrument' | 'rig';

/**
 * What a level-up offers when it has nothing left to offer.
 *
 * Restated here rather than imported from `game/progression.ts`, deliberately:
 * `core/` is the layer both `game/` and `audio/` depend on, and a dependency
 * pointing the other way would make the event bus need the game to compile.
 * It is a three-member union and the duplication is cheaper than the cycle.
 */
export type GraceKind = 'rest' | 'bomb' | 'shards';

export type SectionName = 'intro' | 'build' | 'drop' | 'sustain' | 'breakdown' | 'fill' | 'collapse';

/**
 * WHERE THE ARRANGEMENT IS, AS A PLAIN VALUE THE SIMULATION MAY READ.
 *
 * The whole game flows one way — the world emits, the director listens, and the
 * comment at the top of this file says that narrow boundary is why either half
 * can be rewritten. `docs/plan-items-v2.md` §2 measured the consequence: every
 * musical signal this project publishes is output only, so the soundtrack is a
 * readout of a fight it has no say in.
 *
 * DROP (`feedback`) is the first item that needs it back. It is near-inert
 * outside the drop and the strongest thing in the game inside one, and there is
 * no way to know which without asking the arrangement.
 *
 * IT IS A PUSHED VALUE OBJECT, NOT A CALL. `main.ts` writes a snapshot into
 * `World` once a frame — the same direction `GameSnapshot` already travels in,
 * only inbound — and `src/game/` still never imports `src/audio/`. The world
 * does not hold a director, cannot ask it a question, and works with nobody
 * conducting at all (see `World.musical`).
 *
 * TWO FIELDS, AND BOTH ARE READ. `DirectorReadout` also publishes `act`,
 * `tension`, `tacet`, `runPhrase`, `modeBias` and six more; none of them has a
 * reader on this side, and a field nothing reads is the single most-recorded
 * defect in this repository (AGENTS.md §3, "unmeasured properties rot"). Add
 * one when an item wants it, not before.
 */
export interface MusicalState {
  /** Which part of the arrangement is sounding. */
  section: SectionName;
  /** 0..1. The value the arrangement runs its dynamics on. */
  energy: number;
}

/**
 * The lanes an ITEM is allowed to silence, and the four it may not.
 *
 * TACET (`tremolo`) and REST (`nova`) both work by taking parts out of the
 * arrangement, which means the game layer has to be able to name a lane. The
 * names live here rather than in `audio/layers.ts` for the same reason
 * `ShardTier` does: this is the shared vocabulary, and `src/game/` may not
 * import `src/audio/`. The director validates the strings against its own
 * `StemId` before acting on them, so a typo here silences nothing rather than
 * throwing.
 *
 * `sub`, `hats`, `fx` and `power` are DELIBERATELY ABSENT. An item that can
 * produce literal digital silence is an item that reads as the audio having
 * crashed — `docs/plan-items-v2.md` §7 names exactly that risk ("the silence
 * reads as dramatic rather than as a bug"). Leaving the drone, the pad and the
 * hats means REST sounds like the band stopping and not like the game
 * stopping.
 */
export const SILENCEABLE_STEMS = ['kick', 'clap', 'bass', 'chords', 'arp', 'lead', 'motifs'] as const;
export type SilenceableStem = (typeof SILENCEABLE_STEMS)[number];

export type GameEvents = {
  'run:start': { seed: number };
  'run:over': { score: number; wave: number };

  'wave:start': { index: number; difficulty: number };
  /**
   * `grade` is how the wave went, which the director turns into a different
   * resolution: a flawless clear lifts the music, a scrape darkens it.
   */
  'wave:clear': {
    index: number;
    grade: 'perfect' | 'clean' | 'rough';
    peakMultiplier: number;
    damageTaken: number;
  };
  /** Fired ~2 bars before a boss becomes active so the music can build into it. */
  'boss:telegraph': { id: string; phases: number; etaSeconds: number };
  'boss:spawn': { id: string; phases: number };
  'boss:phase': { phase: number; of: number };
  'boss:defeat': { id: string };

  'enemy:spawn': { id: number; archetype: EnemyArchetype };
  'enemy:death': { id: number; archetype: EnemyArchetype; byPlayer: boolean };
  /**
   * An enemy just committed a LUNGE — the telegraphed dash that replaced its
   * volley. The audio side turns this into a pitched note, so the charge you
   * see winding up is the note you hear.
   *
   * WAS `enemy:fire`, and the rename is the same discipline that renamed `pan`
   * below: nothing shoots any more, so a listener called "fire" would be
   * describing a subsystem that does not exist while quietly still working.
   * `tools/battlefield.mjs`, `tools/firstminute.mjs`, `tools/pause.mjs` and
   * `main.ts` all had to be edited to keep receiving it, which is the point.
   *
   * `pan` is 0..1, hard left to hard right, and is **which side of the PLAYER**
   * the attack came from — not a position in the world and not a fraction of
   * the field. It was called `x` and was `e.x / world.width`, which meant the
   * same thing only while the field was exactly one screen wide. Renamed rather
   * than redefined in place so that every reader has to look: the old name let
   * `tools/battlefield.mjs` keep printing a column after its definition moved.
   */
  'enemy:lunge': { archetype: EnemyArchetype; pan: number };
  /** A player shot connected. Answers the shot musically. */
  'enemy:hit': { archetype: EnemyArchetype; lethal: boolean };

  /**
   * `id` is the instrument that fired. Several can fire in one tick and only
   * one event is emitted, so this is the FIRST of them — enough for the audio
   * layer to give the shot that instrument's voice, which is the whole reason
   * the field exists. Optional so nothing that emits a bare `{}` breaks.
   */
  'player:shoot': {
    id?: InstrumentId;
    /**
     * The instrument's character FAMILY, from the `character` phrase authored
     * in `weapons.ts` ("aggressive", "mechanical", "mournful", "shimmering",
     * "heavy", "eerie").
     *
     * Sent through the event rather than looked up, because `src/audio/` must
     * not import `src/game/` — that one-directional layering is why this file
     * restates the ids instead of re-exporting them. Deriving the family here
     * keeps the authored text as the single source: `weapons.ts` says "the
     * audio side reads it", and this is how it reads it without reaching
     * across the boundary or keeping a second copy that would drift.
     */
    voice?: string;
  };
  'player:hit': { hpLeft: number };
  'player:death': Record<string, never>;
  'player:graze': { total: number };
  'player:bomb': Record<string, never>;
  'player:extend': { livesLeft: number };

  /**
   * A note shard was collected.
   *
   * The single most frequent reward in the game — 92 to 108 of them in a two
   * minute stretch — and until this event existed it had NO audio channel at
   * all. Collecting one emitted a 2px dot particle and nothing else, which is
   * why the XP economy read as something happening to the player rather than
   * something they were doing.
   *
   * `tier` selects the pitch so the three shard grades are distinguishable by
   * ear, and `combo` lets the sound climb with the streak — the streak is
   * otherwise visible only as a number in the corner.
   */
  'shard:collect': { tier: ShardTier; combo: number };

  'powerup:pickup': { kind: PowerupKind; level: number };
  'powerup:expire': { kind: PowerupKind };

  /**
   * A level-up offer opened.
   *
   * This is the one moment in a run where the player is looking at the
   * arrangement instead of at the bullets, so it is the one moment the music
   * gets to hold still: the gesture is a fermata over a held dominant, which
   * resolves on `level:choice`. The WORLD stops but the transport never does —
   * a `repl.stop()` rewinds Strudel's counters and a `pause()` breaks the
   * beat-scheduled world, so the music keeps running underneath and the
   * emitters are pushed forward by the beats the pause costs them.
   */
  'level:offer': {
    level: number;
    /**
     * The cards, in the order `progression.chooseOption(state, index)` indexes
     * them. A `null` id is a GRACE card — `rest`, `bomb` or `shards` — which
     * `progression.ts` generates whenever the pool cannot fill four slots.
     *
     * This used to be `AbilityId[]`, built by mapping the offer and then
     * `.filter(x => x !== null)`. That was wrong twice over, and both failures
     * only appear in late-run states that are hard to reach in testing:
     *
     * 1. It DROPPED the grace cards. Once both inventories are full and
     *    everything held is maxed, grace options are the only thing on offer —
     *    so the choice screen got emptier the deeper the run went, and was at
     *    its emptiest exactly when the run was most interesting.
     * 2. It DESYNCHRONISED THE INDICES. `chooseOption` indexes the unfiltered
     *    array, so a grace at index 1 made the UI's card 2 the engine's card 1,
     *    and the player silently received an ability they did not pick.
     */
    options: { id: AbilityId | string | null; grace: GraceKind | null }[];
    queued: number;
    /** Remaining rerolls and banishes, so the offer screen can show the counts. */
    rerolls: number;
    banishes: number;
  };
  /**
   * The player committed.
   *
   * `id` is NULLABLE, and that is load-bearing rather than defensive. A grace
   * card — `rest`, `bomb`, `shards` — has no `AbilityId` by definition, and the
   * emit was originally specified as
   *
   *     if (c.ok && c.id) bus.emit('level:choice', ...)
   *
   * so taking one emitted NOTHING: not `level:choice`, because the id was null,
   * and not `level:skip`, because it was not a skip. Any screen driven purely by
   * these events therefore stayed open forever on that one pick — with the world
   * still paused underneath it. A soft-lock, reachable
   * exactly in the late-game state where grace cards are the *only* thing on
   * offer, which is also the state hardest to reach while testing.
   *
   * So: emit this for EVERY committed pick, grace included, with a null id.
   *
   * `grace` says which one it was, for a screen that wants to report what the
   * player actually received. `slot` is meaningless for a grace pick and may be
   * either value; do not branch on it.
   *
   * BELT AND BRACES: `GameSnapshot.choosing` is the authoritative signal for
   * "an offer is open". Anything closing an offer screen should watch its
   * falling edge rather than trusting an event to arrive, because a missed
   * event here does not degrade — it locks the game.
   */
  'level:choice': {
    /** A synthesised DUET id (`a+b`) is a plain string; see OfferOption.id. */
    id: AbilityId | string | null;
    grace: GraceKind | null;
    slot: AbilitySlot;
    level: number;
    isNew: boolean;
  };
  /** The offer was skipped or rerolled away. */
  'level:skip': { level: number };
  /** A pair fused on a boss defeat. The payoff; it earns a new timbre. */
  'ability:evolve': { from: AbilityId; catalyst: AbilityId; to: EvolvedId | string };
  /** Two evolved instruments merged and freed a slot. */
  'ability:union': { a: AbilityId; b: AbilityId; to: EvolvedId | string };
  /** Two maxed instruments combined generically; `to` is a synthesised id. */
  'ability:duet': { a: AbilityId; b: AbilityId; to: string };
  /** The band got bigger. */

  'combo:milestone': { value: number };
  'combo:break': { was: number };
};

export type GameEventName = keyof GameEvents;
export type Handler<K extends GameEventName> = (payload: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<GameEventName, Set<(p: never) => void>>();

  on<K extends GameEventName>(name: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(fn as (p: never) => void);
    return () => set!.delete(fn as (p: never) => void);
  }

  emit<K extends GameEventName>(name: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of set) {
      try {
        (fn as Handler<K>)(payload);
      } catch (err) {
        // A broken listener must never take down the frame.
        console.error(`[events] handler for "${name}" threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

/**
 * Everything the music director is allowed to know about the world, refreshed
 * once per frame. All fields are plain numbers so the director can be tested
 * without a running game.
 */
export interface GameSnapshot {
  /** Seconds since the run began. */
  time: number;
  running: boolean;
  paused: boolean;
  gameOver: boolean;

  playerHp: number;
  playerMaxHp: number;
  lives: number;
  maxLives: number;
  /** Bombs in reserve. Voiced as a heartbeat in the quiet. */
  bombs: number;
  /** Black-hole charges in hand. */
  wells: number;
  /** Seconds since the player last took damage; large when safe. */
  timeSinceHit: number;
  invulnerable: boolean;
  focused: boolean;
  /** How far up the playfield the player is, 0 at the bottom, 1 at the top. */
  playerHeight: number;

  /* ---------------------------------------------------------------------- *
   * PRESSURE — four numbers that used to count enemy bullets and now count
   * bodies. All four were renamed rather than repointed in place.
   *
   * `bulletCount`, `bulletsNear`, `bulletsVeryNear` and `timeToImpact` fed
   * `tension.density`, `tension.crowding` and `tension.imminence` — three of
   * the arrangement's inputs. With enemy fire deleted they would all have read
   * zero forever, and the music would have gone quietly slack while every
   * declaration in this file still argued they were live. That is exactly the
   * failure `tools/deadconditions.mjs` exists to find.
   *
   * The thresholds they are read against MOVED with them (see `tension.ts`),
   * because a screen holding 30 bodies is not the same number as a screen
   * holding 30 bullets.
   * ---------------------------------------------------------------------- */
  /** Live enemies anywhere in the field — the crowd term. Was `bulletCount`. */
  pressureCount: number;
  /** Enemies within the "danger" radius of the player. Was `bulletsNear`. */
  threatsNear: number;
  /** Enemies within the tighter "panic" radius. Was `bulletsVeryNear`. */
  threatsVeryNear: number;
  /**
   * Seconds until the soonest body on a collision course reaches the ship;
   * Infinity when clear. Was `timeToImpact`.
   */
  timeToContact: number;

  enemyCount: number;
  /** Sum of remaining enemy HP as a fraction of the wave's starting HP. */
  enemyThreat: number;
  /** Per-archetype live counts, used to pick motifs. */
  enemies: Record<EnemyArchetype, number>;

  /**
   * 0..1. Ramps up the longer the ship sits within `IDLE_RESET_DIST` of where
   * it stopped, floored at 0 by `IDLE_GRACE_S` seconds and any real
   * reposition. See `World`'s idle tracking for what it drives.
   */
  campPressure: number;

  bossActive: boolean;
  bossPhase: number;
  bossPhases: number;
  /** Boss HP fraction, 1 -> 0. */
  bossHp: number;

  wave: number;
  /** 0..1 progress through the current wave. */
  waveProgress: number;
  difficulty: number;

  score: number;
  combo: number;
  /** Grazes per second, smoothed. */
  grazeRate: number;
  /** Kills per second, smoothed. Drives the music's "you are winning" channel. */
  killRate: number;
  /** Enemy volleys per second, smoothed. Each one already plays a note. */
  enemyFireRate: number;
  /** True while the player is holding fire, i.e. performing their own line. */
  playerFiring: boolean;
  /** Active powerups and their levels. */
  powerups: Partial<Record<PowerupKind, number>>;
  /**
   * How many timed powerups can be held at once.
   *
   * DOES NOT GROW WITH BOSSES, whatever this doc used to say. It is written
   * from `Player.maxActive`, which is set from `Player.MAX_ACTIVE` at reset and
   * never touched again — measured constant at 3 across 115,200 simulated steps
   * by `tools/deadhunt-ranges.mjs`. What grows with each boss is the
   * PROGRESSION slot count, `instrumentSlots` / `rigSlots` below, and that is
   * almost certainly what the old sentence was reaching for. `src/render/hud.ts`
   * draws its chip row from this field, so it draws three chips forever.
   */
  loadoutSlots: number;
  /**
   * The named rule this wave runs under, from wave 9 onward, or null.
   *
   * A string rather than a set of numbers because the director should read it
   * once per rebuild, not once per hap: it selects material, it does not
   * modulate it. Anything that needs to change continuously with the movement
   * belongs in a signal, not here.
   */
  movement: 'flank' | 'elite' | 'hush' | null;

  /* -------------------------------------------------------------------------
   * The arena's danger signals, replacing `playerHeight`.
   *
   * `playerHeight` meant "how far up the field the player is", which in a
   * vertical shmup was an honest danger proxy — up the screen is where the
   * enemies and the bullets are. In an arena the player lives near the middle
   * and that axis carries no information at all. It is still populated so
   * nothing breaks on the day the arena lands, but it is DEPRECATED and the
   * music no longer reads it.
   *
   * Two signals replace it because there are two different feelings and the
   * vertical game could not tell them apart.
   * ---------------------------------------------------------------------- */

  /**
   * Distance to the nearest live enemy, 0 (touching) .. 1 (nothing near).
   *
   * The FAST axis — it moves several times a second. Spent on things that can
   * follow it continuously without touching note content: filter openness, the
   * noise bed. Driving anything that selects pitches from this would rewrite
   * the phrase every time something flew past.
   */
  nearestThreat: number;

  /**
   * How closed the ring is, 0 (a wide-open escape corridor) .. 1 (surrounded).
   *
   * Computed from the largest ANGULAR GAP in the enemies around the player,
   * inverted. The SLOW axis, and the one that is genuinely new: it says "you
   * are surrounded" rather than "something is close".
   *
   * This is what the melody's register follows. A tune climbing as the ring
   * closes is a musical statement; a tune climbing because something flew past
   * is a theremin.
   */
  encirclement: number;

  /** Where the ship is pointing, in radians. Its last non-zero movement vector. */
  facing: number;
  /**
   * `facing`, damped.
   *
   * The raw value swings hard when the player weaves, and the mix pans off this
   * — panning off the raw angle is jitter. Damped on the game's side rather
   * than the director's, because the game knows how fast the ship actually
   * turns and the director would only be guessing at a time constant.
   */
  facingSettled: number;

  /** Player level, 1-based. */
  level: number;
  /** XP banked into the current level, and what the next one costs. */
  xp: number;
  xpToNext: number;
  /** Level-ups banked and unspent. The HUD shows these; space opens them. */
  pendingOffers: number;
  /**
   * Everything owned, id -> level. This is the loadout, and so it is the mix.
   *
   * Same shape as `powerups` on purpose, so the six shared ids keep working in
   * `layers.ts` unchanged if the world mirrors them across. Whoever wires this
   * must MUTATE this object in place rather than reassigning it — the director
   * holds the reference across frames, and `tools/everypowerup.mjs` exists
   * because that exact mistake was made once already.
   */
  abilities: Partial<Record<AbilityId, number>>;
  /** Slot capacities: 3 each at the start, +1 per boss, capped at 6. */
  instrumentSlots: number;
  rigSlots: number;
  /** True while a level-up offer is open. The world stops; the music does not. */
  choosing: boolean;
  /** Fusions completed this run. */
  fusions: number;
  /**
   * Lanes the PLAYER is currently holding silent, from `SILENCEABLE_STEMS`.
   *
   * The only channel in this file by which an item reaches into the mix. TACET
   * banks charge while a lane is out and spends it when the lane returns; REST
   * takes the whole band out for the bar it is invulnerable. Both are supposed
   * to be heard, so this is a mute the director applies rather than a duck the
   * game applies — the arrangement keeps playing the part, it just does not
   * sound, which is what a tacet is.
   *
   * MUTATED IN PLACE, like `abilities` and `powerups` above and for the same
   * reason: the director holds this reference across frames.
   */
  tacetStems: SilenceableStem[];
}

export function emptySnapshot(): GameSnapshot {
  return {
    time: 0,
    running: false,
    paused: false,
    gameOver: false,
    playerHp: 3,
    playerMaxHp: 3,
    lives: 3,
    maxLives: 3,
    bombs: 3,
    wells: 0,
    timeSinceHit: 999,
    invulnerable: false,
    focused: false,
    playerHeight: 0,
    pressureCount: 0,
    threatsNear: 0,
    threatsVeryNear: 0,
    timeToContact: Infinity,
    enemyCount: 0,
    enemyThreat: 0,
    enemies: { pluck: 0, stutter: 0, arpeggiator: 0, glissando: 0, subdrop: 0, echo: 0, rush: 0, conductor: 0 },
    campPressure: 0,
    bossActive: false,
    bossPhase: 0,
    bossPhases: 0,
    bossHp: 1,
    wave: 0,
    waveProgress: 0,
    difficulty: 0,
    score: 0,
    combo: 0,
    grazeRate: 0,
    killRate: 0,
    enemyFireRate: 0,
    playerFiring: false,
    powerups: {},
    loadoutSlots: 3,
    movement: null,
    // 1 = nothing near, 0 = no ring at all: an empty arena is the safest state.
    nearestThreat: 1,
    encirclement: 0,
    // Pointing "up" the field, matching where the ship starts and fired before.
    facing: -Math.PI / 2,
    facingSettled: -Math.PI / 2,
    level: 1,
    xp: 0,
    xpToNext: 6,
    pendingOffers: 0,
    abilities: {},
    // 4, mirroring STAND_SLOTS in game/progression.ts — core cannot import it
    // without a cycle. At 3 the panel told a new player on the title screen
    // that the band holds three players and drew three empty chairs, then
    // silently became four the instant they pressed START.
    instrumentSlots: 4,
    rigSlots: 3,
    choosing: false,
    fusions: 0,
    tacetStems: [],
  };
}
