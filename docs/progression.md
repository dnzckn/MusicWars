# Progression: the band you assemble

A Vampire-Survivors-shaped run economy, adapted to a game where the loadout
*is* the mix.

Two files, both pure:

| file | holds |
|---|---|
| `src/game/weapons.ts` | the data: 12 instruments, 12 rig items, 14 fusion recipes |
| `src/game/progression.ts` | the logic: XP curve, slots, offers, choices, fusion |

Neither imports `World` or `Player`, neither emits on the bus, neither reads a
clock. State goes in, offers and effects come out. That is why the whole system
is exercised 60,000 offers deep by `node tools/levelup.mjs` in under a minute
with no browser, no dev server and no AudioContext.

---

## The loop

1. Kills scatter **shards** — the existing note shards, now carrying XP. Tiered
   minor / major / rare by what the enemy cost to kill, which is Vampire
   Survivors' blue / green / red.
2. Enough XP is a **level**. A level opens a **choice of four**.
3. Choices go into two small inventories: **instruments** (they attack) and
   **rig** (global multipliers). **Four instrument slots and three rig slots,
   fixed for the whole run** — see `STAND_SLOTS`/`RIG_SLOTS`. A cap only
   creates decisions while it binds, so these never stop binding.
4. An instrument maxed at **8**, plus its one catalyst rig item maxed at **5**,
   makes a **fusion card**, which arrives in a normal offer at a heavy weight.
   Taking it costs the pick, spends the catalyst, frees that rig slot, and
   seats a new instrument with a different verb and a different timbre.
5. Any two instruments held at level **6** can **duet**; two evolved instruments
   can **union**. Both consume their inputs and free a chair. That is the
   ceiling.

The one sentence that matters: **a level-up is recruiting a musician, and an
evolution is two instruments becoming a new timbre.** Every ability id below is
read by `audio/layers.ts`, so the loadout is audibly the band.

---

## What was taken from Vampire Survivors, and what was not

Taken, because it is what makes the genre work:

- **XP gems from every kill, tiered by value.** Pickup radius is a passive, so
  "collect more" is itself a build decision.
- **A choice of four on level-up**, from a pool that narrows as you commit. The
  interruption is the beat of the run — it is where a run's identity is decided.
- **Two small inventories.** Once they are full, offers can only *level what you
  already hold*. That is the entire mechanism that turns a run into a build.
- **Reroll, skip and banish**, the levers that let a player aim at an evolution
  rather than hope for one.
- **Evolution at max level.** In VS the gate is a treasure chest dropped by a
  boss after ten minutes. Here the gate is the level-up itself: a ready fusion
  becomes a card you can see and must *choose*, at a weight that makes it hard
  to miss. It was once resolved silently on boss defeat, which delivered the
  most interesting event in the system as a notification; making it a pick
  costs the player something and so means something.

Deliberately *not* taken:

- **The level-20 and level-40 XP surcharges.** They exist in VS to pace
  meta-progression across many runs, which this game does not have. Copying them
  would import a wall with no reason behind it. The curve here keeps VS's
  *shape* — a step size that increases in tiers — and drops the surcharges.
- **Stopping the MUSIC on level-up.** Everything on this field runs off the
  transport's absolute beat position, and `repl.stop()` rewinds Strudel's cycle
  counters by a measured four bars. The offer opens on a bar line, the WORLD
  stops, and the transport keeps running — beat-scheduled emitters are pushed
  forward by the held beats so the grid never breaks. (The world itself ran at
  `LEVEL_UP_TIME_SCALE` = 0.12 rather than stopping until 2026-08-23; the
  constant is retired and the reasoning is in the offer block in `world.ts`.)
  This is
  the one moment in a run where the player is looking at the arrangement rather
  than the bullets, which makes it the one moment the music gets to hold still —
  a fermata over a held dominant, resolving on the choice.
- **Six slots from the start.** With six of each open immediately, a run's ~30
  picks spread across twelve tracks and *nothing ever reaches max*, so no
  evolution is reachable at all. Starting at three forces the early
  specialisation the payoff depends on.

  > **Superseded.** This paragraph argued for growth from three, reusing an
  > "ENSEMBLE GROWS" reward. Slots are now FIXED at four instruments and three
  > rig and never grow: a boss makes the band *better* rather than bigger,
  > because beating one is what lets you combine. The `slots:grow` event, its
  > sound effect, and the always-false `slotsGrew` flag were removed once it
  > became clear they were also feeding a HUD tooltip that told players to
  > "beat a boss to widen the band".

---

## The existing powerups, mapped across

Nothing was removed or renamed. All twelve `PowerupKind`s still exist and every
audio signature already written for them still fires, because the ids did not
move.

| powerup | becomes | why |
|---|---|---|
| `drones` | **instrument** — orbit | pods circle, shoot, and each eat one bullet. The canonical arena orbit shape. |
| `nova` | **instrument** — aura | a ring on the beat. Already locked to the transport, which is exactly right. |
| `blackhole` | **instrument** — field | a vortex that pulls and crushes. |
| `laser` | **rig** | +damage, and pierce at level 4. |
| `spread` | **rig** | +projectile count. VS's Duplicator. |
| `rapid` | **rig** | −cooldown. VS's Empty Tome. |
| `homing` | **rig** | projectiles seek. |
| `magnet` | **rig** | +pickup radius. VS's Attractorb, and the reason MAGNET now matters. |
| `timewarp` | **rig** | enemies run slow. |
| `overdrive` | **unchanged** | stays a field-dropped timed surge. |
| `encore` | **unchanged** | stays the game's mercy, sent rather than found. |
| `bomb` | **unchanged** | stays a consumable charge. |

The last three are deliberately kept out of progression. They are the game's
*temporary surges and its mercy*, which is a different verb from permanent
progression, and OVERDRIVE in particular is a state rather than a dial — the
audit in `tools/README.md` already established that. Keeping them as field drops
means the drop economy, the pity timer and `Player.maxActive` all keep working
untouched.

New ids: 9 instruments, 6 rig items, 14 fusions. All are in
`src/core/events.ts` as `InstrumentId | EvolvedId | RigId = AbilityId`.

---

## Integration points

### What the world loop must call

Everything below is pure and returns a description of what happened. The world
emits the bus events; progression never touches the bus.

```ts
import * as prog from './progression';

// once per run
this.progression = prog.createProgression(seed);   // or prog.resetProgression(state, seed)
```

**On a shard being collected** — replaces nothing, adds to the existing
`notes` pickup path in `World.updateNotes`:

```ts
const r = prog.grantShard(this.progression, shard.tier);
// r.gained > 0 means one or more levels were earned; they are queued, not lost.
```

`World.spawnNotes` should ask `prog.shardsForKill(enemy.maxHp, isBig)` for the
tier split. **The total count it returns is the same count `spawnNotes` already
produces**, so the visual density of the field does not change — only the value
each shard carries is new. Shards want colouring by tier (VS's blue/green/red;
here the collectible green stays for `minor`, with `major` and `rare` brighter
and larger).

**Every frame**, on a bar line, when a level is queued:

```ts
if (this.transport.crossedBar() && !prog.isChoosing(this.progression)) {
  const offer = prog.openOffer(this.progression);
  if (offer) this.bus.emit('level:offer', {
    level: offer.level,
    // UNFILTERED, and index-aligned with `chooseOption(state, index)`.
    options: offer.options.map((o) => ({ id: o.id, grace: o.grace })),
    queued: offer.queued,
    rerolls: offer.rerollsLeft,
    banishes: offer.banishesLeft,
  });
}
```

> **This spec used to say `.map((o) => o.id).filter((x) => x !== null)` and that
> was wrong twice over.** It dropped the grace cards, so the choice screen got
> emptier the deeper a run went and was at its emptiest exactly when a run was
> most interesting — grace options are the *only* thing on offer once both
> inventories are full and everything in them is maxed. Worse, it desynchronised
> the indices: `chooseOption` indexes the unfiltered array, so a grace card at
> index 1 made the UI's card 2 into the engine's card 1 and the player silently
> received an ability they did not pick. Emit the full list, holes included.

**While an offer is open**, stop the world and hold the stage's beat schedule:

```ts
const heldBeats = this.transport.lastStep;
if (heldBeats > 0) {
  for (const e of this.enemies) for (const em of e.emitters) em.delayBy(heldBeats);
}
simDt = 0;
```

Never `repl.pause()`. The transport must keep advancing or the beat-scheduled
emitters desynchronise from the track — but they must also be pushed forward by
the beats that pass while the world is held, or every volley on the field comes
due at once the moment play resumes.

**On the player picking a card** (0–3):

```ts
const c = prog.chooseOption(this.progression, index);
if (!c.ok) return;
// EVERY committed pick, grace included, with a null id when it is one.
this.bus.emit('level:choice', {
  id: c.id, grace: c.grace, slot: c.slot ?? 'rig', level: c.level, isNew: c.isNew,
});
if (c.grace) { /* 'rest' -> +1 hp, 'bomb' -> +1 bomb, 'shards' -> score */ }
```

> **The `&& c.id` guard this spec used to carry was a soft-lock.** A grace card
> has `id === null` by definition, so taking one emitted *nothing*: not
> `level:choice`, because the id was null, and not `level:skip`, because it was
> not a skip. Any screen driven by these events stays open forever on that one
> pick — with the world still paused underneath it.
> Reachable exactly in the late-game state where grace cards are all that is on
> offer, which is also the state hardest to reach while testing.
>
> `slot` is meaningless for a grace pick; pass either value and do not branch on
> it. And `GameSnapshot.choosing` remains the authoritative "an offer is open"
> signal — anything closing a screen should watch its falling edge rather than
> trust an event to arrive, because a missed event here does not degrade, it
> locks the game.

Also available: `prog.skipOffer(state)`, `prog.rerollOffer(state)`,
`prog.banishOption(state, index)`.

**On a boss defeat** — this is the cadenza:

```ts
const reward = prog.onBossDefeated(this.progression);
// No slot growth, and no fusing FOR you: `reward.fusions` is always empty.
// A boss pays one reroll and one banish. The fusion is a card, resolved on the
// pick — see the `ability:evolve`/`union`/`duet` emits on the offer path.
```

**Firing** — `Player.weapon()` is replaced by iterating the ensemble:

```ts
const mods = prog.modifiers(this.progression);
for (const { id, level } of prog.activeInstruments(this.progression)) {
  const def = instrumentDef(id)!;
  const s = applyModifiers(instrumentStats(id, level), mods);
  // dispatch on def.shape: 'seek' | 'arc' | 'beam' | 'orbit' | 'aura' | 'field'
}
```

Six shapes, so the world needs six firing routines and not twenty-six. Every
instrument in the table is one of them; that is the point of the field.

`mods` also carries `moveSpeed`, `maxHp`, `pickupRadius`, `enemyTime` and
`xpGain`, which belong to the player, the drop pull and the enemy update
respectively. `xpGain` is applied inside `grantXp` — do not apply it twice.

### What `GameSnapshot` must expose

All of these are in `src/core/events.ts` and all of them are now written by
`World.writeSnapshot`:

```ts
  level: number;
  xp: number;
  xpToNext: number;
  abilities: Partial<Record<AbilityId, number>>;
  instrumentSlots: number;
  rigSlots: number;
  choosing: boolean;
  fusions: number;
```

The arena added four more, and they matter more than they look because the
music steers off them — the melody's register follows `encirclement` and the
filter's openness follows `nearestThreat`:

```ts
  nearestThreat: number;   // 0 = touching, 1 = nothing within ~520px
  encirclement: number;    // 0 = wide-open escape corridor, 1 = ring closed
  facing: number;          // radians, the last non-zero movement vector
  facingSettled: number;   // the same, damped, for anything that would jitter
```

`encirclement` is the largest **angular gap** among nearby enemies, inverted —
deliberately not a count. Eight enemies clustered on one bearing read LOW,
because there is a corridor and the player can leave; three spaced 120 degrees
apart read HIGH. A count divided by some maximum would look plausible, move in
roughly the right direction, and mean something else entirely. Enemies still
outside the arena or already retreating are excluded, or the music would tense
during the calm before a wave and relax as the wave landed.

`playerHeight` is still populated and is **deprecated**: in the round the player
lives near the middle, so it hovers at 0.5 forever. It is exactly the shape
`tools/deadconditions.mjs` exists to catch — responsive in the source, constant
in play.

Fill `abilities` with **`prog.writeAbilityLevels(state, s.abilities)`**, never
`s.abilities = prog.abilityLevels(state)`. The director holds a reference to
that object across frames; replacing it leaves the music reading a map that
stopped changing. That bug already shipped once in this project, with
`player.powerups`, and is written up under `everypowerup` in `tools/README.md`.

`abilities` is the same `id -> level` shape as `powerups`, which is why the six
shared ids kept their names: everything in `layers.ts` reading
`m.powerups.drones ?? 0` reads `m.abilities.drones ?? 0` identically.

### What the HUD must render

1. **An XP bar.** `prog.levelProgress(state)` and `state.level`. It is the most
   frequently-changing number in the game and it has to be readable without
   looking away from the bullets — thin, along an edge, not a widget.
2. **Slot chips**, from `prog.slotSummary(state)`: two rows, instruments and
   rig, each showing filled slots with their level (`SNARE ROLL 6/8`) and empty
   slots as placeholders. `tools/progression.mjs` already asserts that the chip
   count equals the slot count — it was written because the loadout row once
   printed "none" *and* four empty chips, the same fact twice.
3. **The offer screen.** Four cards. Each card needs `label`, `note` (what the
   player will notice — never a bare number), `level`, and whether it `isNew`.
   A card with `completes` set is one pick from a fusion and must say so; the
   whole evolution table is worthless if the player cannot see it coming.
   Reroll / skip / banish with their remaining counts.
4. **Ready fusions.** `prog.readyFusions(state)` returns the pairs waiting on
   the next boss. Show them. A reward a player cannot see coming is a reward
   they cannot play toward.

---

## The tables

12 instruments for 6 slots, 12 rig items for 6 slots, and **every rig item is
the catalyst for exactly one instrument**. That last part is a deliberate
divergence from Vampire Survivors, where several passives catalyse nothing. Here
it means every rig card you are offered has a reason beyond its own numbers, and
the whole table is learnable — a combination you cannot anticipate is not a
decision, it is a surprise.

| instrument | shape | catalyst | fuses into |
|---|---|---|---|
| PIZZICATO | seek | CAPO | SPICCATO |
| SNARE ROLL | arc | RAPID | BLAST BEAT |
| ROSIN BOW | beam | LASER | HARMONICS |
| CHIME | seek | RESONANCE | CARILLON |
| HARP GLISS | arc | SPREAD | CROSS-STRUNG |
| DRONE PODS | orbit | FERMATA | CHORALE |
| NOVA | aura | REVERB | CATHEDRAL |
| BLACK HOLE | field | COMPRESSOR | DOWNBEAT |
| FEEDBACK | aura | UP-TEMPO | WALL OF SOUND |
| ECHO CHAMBER | seek | TIMEWARP | CANON |
| TIMPANI | aura | MAGNET | TUTTI |
| TREMOLO FIELD | field | HOMING | VIBRATO |

Unions: **CHORALE + CATHEDRAL → REQUIEM**, **HARMONICS + CROSS-STRUNG → STRING
SECTION**. Each costs two maxed instruments and two maxed rig items and frees a
slot. They are meant to be rare — measured at roughly one run in 240.

Every entry carries a `character` phrase (*aggressive / eerie / heavy /
shimmering / mechanical / mournful*) that the audio side reads to write the
voice. A fusion that cannot be described in one musical phrase is probably not a
fusion, it is a stat.

---

## What was measured

`node tools/levelup.mjs`, no browser required. Full output in the tool; the
parts that decided something:

```
LEVEL PACING (median level at elapsed minutes)
  lean   1m L4   2m L6   3m L13  5m L16  8m L24  10m L29  15m L43
  as-is  1m L5   2m L8   3m L14  5m L18  8m L27  10m L33  15m L48
  rich   1m L5   2m L9   3m L16  5m L21  8m L30  10m L36  15m L54

FUSION REACHABILITY (240 runs each, 15 minutes)
  builder  any fusion 99%   fusions/run 1.77   maxed instruments/run 2.97
  random   any fusion 21%   fusions/run 0.21   maxed instruments/run 0.63

OFFER LEGALITY
  60,000 offers, 240,000 cards, states from empty to fully maxed: zero illegal
```

The gap between 99% and 21% is the design working: a player who decides what
they are building gets there almost always, and a player picking at random
almost never does. If those numbers converge, the choosing has stopped being the
game.

Three income levels rather than one because **the arena conversion is going to
move all of it.** `XP_BASE` and the step tiers are calibrated against the shard
economy as it stands; more enemies per minute means more XP means every level-up
in the run moves. Re-run this tool after the arena lands and re-read the pacing
table before trusting any of those constants. A budget denominated in an event
whose rate is being changed will move under you — this codebase has been caught
by that three times already (the drop pity timer, the multiplier decay, and the
powerup durations).

### The offer bias, ablated

One bias term was deleted by its own measurement. A general `focus` multiplier
on anything already held *looked* obviously right and measured actively harmful:
it spread weight evenly across the loadout, crowding out the specific card the
player was waiting for. Removing it raised the fusion rate from 95% to 99%.

Two terms survive, and they survive for different reasons:

```
BIAS ABLATION (same seeds, one term off at a time)
  as written     builder any 99%  fus 1.77   |   random any 21%
  no catalyst    builder any 95%  fus 1.51   |   random any 16%
  no completes   builder any 99%  fus 1.76   |   random any 16%
  flat           builder any 95%  fus 1.47   |   random any 13%
```

`catalyst` moves the aggregate. `completes` does not — and would, by this
repository's own standard, be a threshold sitting in its own noise. It survives
because the number it was written to move is a different one:

```
THE LAST CARD (offers presented while one card from a fusion)
  as written    needed card among the four 81%   worst wait 4 offers
  no completes  needed card among the four 53%   worst wait 14 offers
```

Fourteen consecutive level-ups withholding the last card is not variance. Nobody
would experience that as bad luck; they would experience it as the game
refusing. No run-length average can see it, which is why the tool measures it
separately.

---

## Landed, and what the arena did to the numbers

All of it is wired. The eight snapshot fields are written (`abilities` through
`writeAbilityLevels`, mutated in place), the six firing routines exist in
`World`, the offer opens on a bar line and stops the world under it, boss
defeats resolve fusions, and `levelup` is
in the fast `verify` gate alongside a new `arena`.

**The recalibration warned about above happened, and it was a factor of four.**
`node tools/arena.mjs 8 4` runs the real `World` headless — no browser, no
audio — and measures the arena producing **30 kills in the first minute rising
past 130 by the eighth**, against a model that had assumed nine rising to
thirty. Against the old curve that was **52 offers in eight minutes, one every
nine seconds**, which is the level-up screen becoming the run.

    XP_BASE / EARLY / MID / LATE      6 / 4 / 7 / 11   ->   10 / 9 / 24 / 55
    tier boundaries                   20 / 30          ->   14 / 23

    measured after                    one offer every 18s
    level pacing (arena, measured)    1m L4   3m L12   5m L19   8m L28
    level pacing (levelup, modelled)  1m L6   3m L16   5m L24   8m L34  15m L49
    fusion reach                      builder 98%   random 26%

The gap between 98% and 26% is the thing to watch: it was 99%/21% before, and
it is the design working. Four times the income nearly closed it — at the
intermediate curve a random picker reached a fusion **75%** of the time, which
means the choosing had stopped being the game — and steepening the late tiers
is what reopened it. If those two numbers ever converge again, the curve is
wrong however good the pacing looks.

`shardsForKill` also had to change shape. It returned `3 + toughness * 2`
shards, matched to the old note scatter; with enemy hp now scaling to keep pace
with a six-instrument ensemble, toughness reaches ten and one kill scattered
twenty-three shards. The count caps at nine now and the VALUE rides the tier
split instead — a tough kill drops a red gem rather than fifty blue ones. Total
XP per kill is close to what it was (45 against 49 at toughness 10), so this is
a change of shape and not of income.

## Still outstanding

- **The offer screen itself.** Everything behind it works and nothing draws it.
  `World.offer` is the open offer, `World.chooseOffer(i)` / `skipOffer()` /
  `rerollOffer()` / `banishOffer(i)` are the verbs, and keyboard 1-4 / Shift+1-4
  / R / Q are wired. `Input.pointerChoice` and friends exist for a click.
- **The XP bar and the slot chips.** `prog.levelProgress`, `prog.slotSummary`
  and `prog.readyFusions` are all ready to render and nothing renders them.
- **`ttk` against the instrument system.** It reads `player.weapon()`, which no
  longer exists. `World.ensembleDps()` is a nominal budget, not a substitute.
- **Whether any of it is fun.** Every number here comes from a bot.
