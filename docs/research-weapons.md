# The weapon archetype catalogue

Research and design for the owner's note: *"item diversity hasn't changed basically
at all… we are severely lacking in item diversity, these items should change up play
style significantly, like laser, something short range, more fun with projectiles…
look to Ball x Pit or Vampire Survivors… needs a large item overhaul."*

**No game code was changed to produce this.** One temporary one-line edit to
`world.ts` was made to falsify a probe and was reverted; see §0.2. `tsc --noEmit`
exits 0 in the tree as it stands.

House style, per `docs/MASTER_PLAN.md` and `docs/research-items.md`: every claim is
**MEASURED** (a number this document produced by running something today, with the
command named), **READ** (walked out of this repo's source or a reference game's
wiki), or **CLAIMED** (a design judgement — argue with it).

This document does **not** re-derive the progression diagnosis. `docs/research-items.md`
owns that, and its ranked gap list stands. This one answers the other half of the
sentence: not *how often* do you combine, but *what are you combining*, and *why are
there only seven of them*.

---

## 0. What ran, and what could not

### 0.1 What ran

| Probe | What it did | Result |
|---|---|---|
| `census.mjs` | Read `INSTRUMENTS` and `FUSIONS` through `tools/lib/tsnode.mjs`; printed the shape census and the shape-change count per recipe | §C.2, §E.2 |
| `budget.mjs` | Ran the real `World.update` at the real 1/120 step, injected N zero-damage player bullets per step, 4,000 measured steps × 3 repetitions × 4 conditions | §D.0 |
| `voiceprobe.mjs` | Ran a real 10-minute `World` and captured every `player:shoot` payload | §0.2 |
| `tools/framewhere.mjs` | The repo's own live-browser frame attribution, at wave 12 and wave 20 | §D.0 |

Chromium launches on this machine and the vite dev server answered 200 on 5173, so
`framewhere` is a **live browser** number, not a headless model. `AGENTS.md` §7's
disk-failure section does not apply here; `docs/TURNAROUND.md` §0 already recorded
that.

**The tree moved underneath these measurements, and that is disclosed rather than
hidden.** The working tree was clean when this work started (`git status --porcelain`
empty). Partway through, **another session landed a change to `src/game/weapons.ts` and
`src/game/progression.ts`** taking `INSTRUMENT_MAX_LEVEL` 8 → 3 and `RIG_MAX_LEVEL`
5 → 3 — the other half of the owner's brief, the "three levels then combine then three
more" ladder. `docs/TURNAROUND.md` records this exact hazard ("consistent with
concurrent edits in a shared tree rather than with a disagreement"), so:

- **The census is unaffected, and this was checked rather than assumed.** The
  concurrent diff touches **zero** lines matching `shape:`, `FUSIONS`, `id: '`, or
  `fused: true` — it re-authors `steps` and `levels` arrays and the two caps, nothing
  else. `census.mjs` was re-run against the modified tree and printed byte-identical
  output: 7 shapes, 27 instruments, 26% largest, 4 of 15 recipes changing the verb.
- **`budget.mjs` and `framewhere` ran before that landing and are not re-runnable
  against it here.** A shorter ladder changes the loadout a bot reaches and therefore
  the enemy count and bullet count, so those figures describe the 8/5 tree. The
  *shares* in §D.0 (world 13%, renderer 28%, director 35%) are structural and were
  reproduced at two different waves, so they are unlikely to move; the absolute
  ms figures should be re-taken after the ladder change settles.
- Nothing in Parts D–G depends on either cap.
- **HEAD also moved five commits during this work** (`35f5cb0` → `0c23d74`), shifting
  `world.ts` by ~32 lines. **Every source citation in this document is therefore by
  symbol or comment heading, not by line number.** That is deliberate: `AGENTS.md` §3's
  lesson that "a tool holding its own copy of a constant will lie the day it moves"
  applies to a document's line references too. `census.mjs` was re-run after the last of
  those commits and reproduced exactly.

### 0.2 A defect found on the way, and the gate seen red

The brief states as a constraint that *"a new instrument needs a voice written."*
That is true of the **stem lane** and materially weaker than assumed of the **shot
voice**, and there is a live defect underneath it.

MEASURED — `voiceprobe.mjs`, one real 10-minute run, seed 1234:

```
INSTRUMENTS 27  base 12  fused 15
SHOT_VOICES ids 8: pizzicato, snare, bow, chime, harp, drones, timpani, nova
SHOT_FAMILIES keys 6: aggressive, mechanical, mournful, shimmering, heavy, eerie
instruments with NO SHOT_VOICES row: 19 of 27
  base:  blackhole, feedback, echoes, tremolo
  fused: spiccato, snap, blastbeat, harmonics, carillon, crossstrung, chorale,
         cathedral, downbeat, wallofsound, canon, tutti, vibrato, requiem,
         stringsection
character first-word matches a SHOT_FAMILIES key: 27 of 27

player:shoot events emitted: 6185
  carrying `id`:    6185
  carrying `voice`: 0
RESULT: SHOT_FAMILIES is UNREACHABLE at runtime -- 0 of 6185 events carried `voice`.
```

`src/audio/sfx.ts` builds a per-**family** voice table precisely so that every
instrument gets a sensible sound without anyone remembering to add a row, and its
comment says so: *"a new instrument gets a sensible voice the moment somebody writes
its character line, with nothing to remember to update here."* `src/core/events.ts`
declares `'player:shoot': { id?, voice? }` with a nine-line comment explaining that
`voice` is sent through the event rather than looked up, because `src/audio/` must
not import `src/game/`.

**`fireInstruments` in `world.ts` never sets it.** The emit is
`this.bus.emit('player:shoot', { id: firedId ?? undefined })`. So the family fallback
has never run, and the 19 instruments without a `SHOT_VOICES` row all fall through to
`DEFAULT_SHOT`, which is pizzicato's. Every fusion in the game fires with the starting
weapon's sound.

**Seen red, deliberately, then restored.** A gate that has never failed is not
evidence (`AGENTS.md` §3). A one-line temporary edit to that emit adding
`voice: instrumentDef(firedId)?.character.split('—')[0].trim().split(/\s+/)[0]` flipped
the probe from `0 of 6185` to `6185 of 6185`. The edit was reverted with
`git checkout -- src/game/world.ts`, `git status --porcelain` is clean apart from
`.claude/`, and `tsc --noEmit` exits 0. So the probe distinguishes the two states; it
is not vacuous.

**Why this belongs in a weapons document.** It changes the cost model this catalogue
is written against. Adding an instrument costs an `ENSEMBLE_MIX` lane (one line
picking an existing stem — all 27 ids are mapped today, 0 unmapped) and, if you want
it to *sound* distinct, a `SHOT_VOICES` row. But the roster already ships 19
instruments without one. Fixing the emit is a one-line change that hands a distinct
voice to all 19 at once, and it is a prerequisite for any roster work that cares about
being heard. It is **not** proposed here as part of the overhaul; it is reported as a
found defect. Nobody has *heard* any of this — the measurement is of emitted events,
not of audio.

---

## Part A — the reference rosters, classified by mechanical verb

A **verb** here is a rule about *where the hitbox appears and how it behaves*, not a
theme and not a stat. "Deals fire damage" is not a verb. "Goes out and comes back" is.
Two weapons share a verb when swapping one for the other would not change how you
play. That criterion is stated so the counts can be argued with.

### A.1 Vampire Survivors

READ, from `vampire.survivors.wiki` (Weapons, Evolution, Passive Items, Level Up,
Arcana). The shipped base game is now **47 weapons** and ~88 across all DLC; the
original launch roster was 22. Both counts are useful and they say different things.

**The launch 22, and their verbs:**

| # | Verb | Weapons |
|---|---|---|
| 1 | Melee arc at your body, along your facing | Whip |
| 2 | Auto-fires at the **nearest** enemy | Magic Wand |
| 3 | Fires along your **facing** | Knife |
| 4 | Fires in **fixed compass directions**, ignoring facing | Phiera Der Tuphello, Eight The Sparrow, Song of Mana |
| 5 | Lobbed arc that rises and falls | Axe |
| 6 | Out and back — **boomerang** | Cross |
| 7 | **Orbits** you | King Bible |
| 8 | An **orbiting bombardment** that circles independently | Peachone, Ebony Wings |
| 9 | Damaging **aura** at your body | Garlic |
| 10 | **Places a persistent zone** in the world | Santa Water |
| 11 | **Bounces off walls** and pierces | Runetracer |
| 12 | Strikes a **random** target instantly, anywhere — including offscreen | Fire Wand, Lightning Ring |
| 13 | **Screen-wide clear** | Pentagram |
| 14 | **Summons an autonomous ally** that acts on its own | Gatti Amari |
| 15 | Behaves **differently moving vs standing still** | Shadow Pinion |
| 16 | A **no-damage control** effect (freeze, lock) | Clock Lancet |
| 17 | A **defensive charge** that blocks damage | Laurel |
| 18 | **Grows while a condition holds** (movement speed) | Vento Sacro |
| 19 | (Bracelet's three-at-a-random-target folds into 12) | — |

**19 distinct verbs across 22 weapons — one verb per 1.2 weapons.**

The shipped 47 adds roughly five more that are genuinely new rather than reskins:
a **cone of flame** (Flames of Misspell), a **thin persistent laser zone** (Phas3r),
**triggers when you take damage** (Victory Sword, Pako Battiliar, Eskizzibur, Night
Sword — four weapons on one trigger), **charges while withheld then dumps** (Ammo
Appalate), and **a zone that follows you** (Clear Debris). Call it **~24 verbs across
47 weapons — one per 2.0.** Vampire Survivors' variety density actually *fell* as it
grew; the launch roster is the tighter design and is the better target.

### A.2 Ball x Pit

READ, from `ballxpit.wiki.gg` (Balls, Fusion Reactor), corroborated against the
launch-era and Naturalist-era recipe tables in `docs/research-items.md` §3.
**21 base balls + 69 evolved = 90.**

Classifying the same way produces a different-shaped answer, and it is the most
transferable finding in this document.

**Ball x Pit's variety is almost entirely on the TRIGGER axis, not the spatial one.**
Every ball does the same thing spatially: it is thrown up the pit and bounces. What
differs is *what fires, and when*. The roster is essentially `trigger × effect`.

**Spatial verbs — 13:**

| Verb | Balls |
|---|---|
| Bounces off walls and enemies (the substrate) | all |
| Pierces enemies | Ghost, Wind, Drill, Erosion, Soul Sucker |
| **Positional** pierce — through the front, not the back | Assassin |
| Splits into clones | Cell, Offspring |
| Bursts into sub-projectiles **on hit** | Egg Sac, Fireworks, Voluptuous Egg Sac |
| Bursts into sub-projectiles **on hitting a wall** | Shotgun, Sniper |
| Spawns an **autonomous ally** per hit or per bounce | Brood Mother, Mosquito King/Swarm, Nosferatu, Lightning Bug, Flesh Mound, Catapult |
| Chains to nearby enemies | Lightning, Storm |
| Hits an entire **row or column** | Laser Horizontal, Laser Vertical, Holy Laser |
| Emits a **beam on hit** | Laser Beam, Freeze Ray, Radiation Beam, X Ray |
| **Constantly emits a beam** in front of itself | Laser Cutter |
| Places a persistent **zone** | Time, Landslide, Armageddon, Inferno |
| Leaves a **trail** of hazard blobs over time | Magma, Swamp, Glacier |
| Teleports | Warp |

**Trigger and status verbs — 17:**
stacking damage-over-time (Burn/Poison/Bleed/Venom/Virus); detonate accumulated
stacks for % health (Hemorrhage, Overgrowth); % of current health (Erosion); execute
chance (Reaper, Black Hole); freeze/slow/petrify (Freeze, Timestop, Petrify, Wraith,
Blizzard); blind and vulnerability (Light, Sun, Flash, Radiation); **conversion —
enemies fight for you** (Charm, Incubus, Berserk, Zombie, Maggot); attaches a
persistent thing *to an enemy* (Leech, Lightning Rod, Tumor); lifesteal (Vampire,
Succubus, Soul Sucker); curse that pays off after N hits (Phantom, Banshee,
Sacrifice); screen-wide tick damage (Flicker, Satan); front-loaded then decaying
(Stone); ramping per hit (Steel); speeds up per bounce (Flesh); self-destructs after
one big hit (Dark, Black Hole, Timestop); aura around the ball itself (Sandstorm,
Brimstone); on-launch AoE (Petrify, Banshee).

**~30 distinct verbs across 90 balls — one per 3.0.** But the split is the point:
**13 spatial, 17 trigger-and-status.**

And the trigger *slots* are enumerable. Ball x Pit fires things **on hit, on bounce,
on hitting a wall, on launch, on kill, on a timer while alive, on reaching N stacks,
and on self-destruction** — eight hooks. Almost every evolved ball is one of those
eight crossed with one effect.

### A.3 The number that names the problem

| | weapons | verbs | one verb per |
|---|---|---|---|
| Vampire Survivors, launch | 22 | 19 | **1.2** |
| Vampire Survivors, shipped | 47 | ~24 | 2.0 |
| Ball x Pit | 90 | ~30 | 3.0 |
| **MusicWars** | **27** | **7** | **3.9** |

MEASURED for the MusicWars row — `census.mjs`, §3.1.

MusicWars is behind Ball x Pit on the ratio and three times behind launch-era Vampire
Survivors. And the comparison flatters MusicWars, because Ball x Pit's 3.0 is bought
with a **second orthogonal axis** — 17 trigger/status verbs composing freely with 13
spatial ones — that MusicWars does not have at all. MusicWars has one axis, seven
values on it, and a quarter of the roster sitting on one value.

**Target, CLAIMED: 14 spatial verbs and a trigger axis.** 14 is not arbitrary — it is
what §4's re-points produce for free (1 verb per 1.9), and it puts the ratio between
launch-VS and Ball x Pit without adding one instrument.

---

## Part B — Ball x Pit's combination system, concretely

READ. `docs/research-items.md` §3 covers the economics of this in detail and is not
repeated. What matters *for weapon design* is four things.

**How they fuse.** Both parents at **level 3 of 3** — that is the entire gate. The
moment is a **Fusion Reactor**, a physical item dropped by enemies and guaranteed by
mini-bosses, which opens a modal offering up to three options: **Fission** (always
available, pays levels or gold — so a Reactor is never a dud), **Fusion** (any two
unfused level-3 balls), and **Evolution** (an authored recipe you hold the ingredients
for). Combining costs **nothing** from the level-up draft, which runs on its own
separate clock at 3 cards (4 with the Meditation Tent building).

**How many.** 21 base balls, **69 authored ball evolutions**, plus 54 base and 17
evolved passives. All 69 recipes are live from the first run; only the player's
*knowledge* progresses.

**Does a fusion produce a new verb or a bigger number? A NEW VERB, essentially always,
and often a new verb with a downside attached.** This is not a matter of degree. Read
the effect text:

- **Bomb** (Burn + Iron): *"explodes when hitting an enemy, dealing 150–300 damage to
  nearby enemies."* Neither parent exploded.
- **Drill** (Earthquake + Iron): *"pierces enemies and deals 50% bonus damage until
  reaching the back of the field."* Neither parent pierced.
- **Assassin** (Iron + Ghost *or* Dark): *"passes through the front of enemies, but
  not the back — backstabs deal 30% bonus damage."* A brand-new positional rule.
- **Black Hole** (Sun + Dark *or* Time): *"instantly kills the first non-boss enemy it
  hits, but destroys itself afterwards."* A new verb **and** a cost.
- **Timestop** (Time + Freeze): *"freezes everything on the field for 5.0 seconds but
  destroys itself after hitting an enemy."* Same pattern.
- **Shotgun** (Iron + Egg Sac): *"shoots 3–7 iron baby balls after hitting a wall."*
  A new **trigger** — on-wall — that neither parent had.
- **Warp** (Time + Light): *"after each hit, warps to a random spot on the field."*

Note also that **Assassin, Black Hole, Berserk, Brimstone, Blizzard, Sandstorm,
Vampire Lord, Lovestruck, Virus, Freeze Ray, Laser Beam, Radiation Beam and Noxious
each take *either* of two catalysts.** Branching is built into the recipe grammar,
exactly as Vampire Survivors' Clock Lancet takes either ring. `docs/research-items.md`
Gap 2 already proposes this for MusicWars and it is blessed by `AGENTS.md` §5.

**How the player discovers recipes.** Retrospectively. The in-game Encyclopedia shows
a recipe only *after* you have made it, and then shows every path to that result. The
only forward hint is an availability light: the Evolution option simply appears in the
Reactor modal when a complete recipe is in hand. MusicWars' `discovery.ts` implements
the identical asymmetry, arrived at independently, and its pause workbench plus
`completes` flag is *better* than either reference game's. That part is not broken and
this document proposes nothing for it.

**Does the "carries BOTH parents' abilities" fallback model fit MusicWars? Partly —
and the part that does not fit is the interesting half.** See §5.1.

---

## Part C — MusicWars' seven shapes, and the gap

### C.1 The seven firing routines, by their real names

READ, `src/game/world.ts`. `fireInstruments` dispatches on `def.shape`
through a seven-arm switch. One routine runs per instrument per tick; there
is no composition.

| Shape | Routine | What the player actually experiences |
|---|---|---|
| `seek` | `fireSeek` | Bolts leave the ship and **converge on the nearest N enemies, one each** — with nothing in range they fan along your facing. You never aim it; you only position. |
| `arc` | `fireArc` | Two different weapons behind one name. With `speed > 0` it throws a **travelling fan** across your facing; with `speed === 0` it cuts an **instant 0.16 s wedge at your body**, and `count` adds further strokes evenly around the compass rather than more projectiles. |
| `beam` | `fireBeam` | A rectangle from the ship along the aim, alive for `linger`, re-fired on the interval; `count` spreads beams evenly around the whole compass. `dps` is `damage / life`, so it reads as a stroke you drag, not a hit that lands. |
| `orbit` | `firePods` | Pods circle you, **each eats one enemy bullet**, and they fire radially outward on a clock. The only defensive shape in the game, and the only one with a body that is not the ship. |
| `aura` | `fireAura` | An expanding ring from the ship that **deletes enemy bullets**, holds at full radius for `linger`, then fades. Omnidirectional, unaimed, and centred on you always. |
| `strike` | `fireStrike` | `count` unaimed hits land **ON random live enemies** within range and burn a circle each. The only shape that reaches something you are not pointing at, and the only one that can hit through a crowd. |
| `field` | `fireField` | Pools placed in the world. The two that swallow bullets (`blackhole`, `downbeat` — a hardcoded id list in `fieldSwallows`) instead **bank a charge the player throws** with a button. That throw is the only player-triggered weapon input in the entire game. |

### C.2 The census

MEASURED — `census.mjs`, reading `INSTRUMENTS` through `tools/lib/tsnode.mjs`:

```
TODAY  (7 shapes over 27 instruments = 1 verb per 3.9)
  aura        7  26%  nova, feedback, timpani, cathedral, wallofsound, tutti, requiem
  seek        5  19%  pizzicato, echoes, spiccato, snap, canon
  arc         5  19%  snare, harp, blastbeat, crossstrung, stringsection
  beam        3  11%  bow, harmonics, chorale
  strike      3  11%  chime, carillon, vibrato
  field       3  11%  blackhole, tremolo, downbeat
  orbit       1   4%  drones
  largest shape holds 26% of the roster
```

Three of the seven auras (CATHEDRAL, REQUIEM, TUTTI) are, by their own stat blocks, "a
very large ring". `weapons.ts` already refuses a fourth on exactly that ground.

And, MEASURED by the same probe walking `FUSIONS`: **4 of 15 recipes change the shape;
11 keep it.** All four that move are `drones → chorale`, `tremolo → vibrato`, and the
two unions — and `levelup.mjs` reports **1 union across 240 committed-builder runs**,
so in practice a player sees a verb change roughly never.

### C.3 What the codebase already promises and does not deliver

This is worth its own list because it is free evidence. Five instruments carry blurbs
that describe a verb the simulation has no routine for. `weapons.ts` names them itself, under the comment heading *"NOT SHAPE BUGS, BUT PROSE THE
SIMULATION DOES NOT DELIVER"*,
itself under *"NOT SHAPE BUGS, BUT PROSE THE SIMULATION DOES NOT DELIVER"*:

| Instrument | Its own blurb | What actually happens |
|---|---|---|
| CARILLON | *"Every strike chains to two more."* | `fireStrike` picks random targets. There is no chain. |
| TREMOLO FIELD | *"Pools left in your wake."* | `fireField` drops on the **nearest enemy**, not in your wake. |
| WALL OF SOUND | *"The field grows with your speed."* | No shape reads player speed. |
| TUTTI | *"Everything is pulled to the centre first."* | `Effect.pull` exists and is never read; `wells.pull` is reachable only through two hardcoded ids. |
| CANON | *"Every bounce spawns a delayed copy."* | The pool reflects. It does not spawn. |

**Five weapons are already designed. Nobody has implemented their verbs.** Four of the
nine shapes in Part D exist to deliver one of these, which means those four are
*repairs* to an already-authored design rather than new content — the cheapest kind of
diversity available.

### C.4 The reference verbs MusicWars has no equivalent of

MusicWars **has**: fires at nearest (`seek` ≈ Magic Wand), melee arc at body
(`arc` sweep ≈ Whip), fires along facing (travelling `arc` ≈ Knife), orbits you
(`orbit` ≈ King Bible), aura at body (`aura` ≈ Garlic), random-target offscreen strike
(`strike` ≈ Lightning Ring), places a zone (`field` ≈ Santa Water), and bounces off
walls (`bounces` on `seek`/`arc`/`orbit` spawns ≈ Runetracer). That is **8 of the
19 launch-VS verbs**, and it is a respectable core.

It has **no equivalent of these eleven**:

| # | Missing verb | Reference | Note |
|---|---|---|---|
| 1 | **A persistent, aimable, continuous laser** | Laser Cutter (BxP), Phas3r (VS) | `fireBeam` is a re-fired 0.12–0.9 s flash spread around the compass by `count`. Nothing holds. **The owner asked for this by name.** |
| 2 | **A short-range, high-density cone** | Flames of Misspell (VS), Shotgun (BxP) | Nothing in the game rewards closing. **The owner asked for this by name.** |
| 3 | **Chains between enemies** | Lightning, Storm (BxP) | CARILLON's blurb promises it. |
| 4 | **An autonomous ally that acts on its own** | Gatti Amari (VS); Brood Mother, Mosquito King, Nosferatu (BxP) | Every MusicWars hitbox is welded to the ship. Pods included. |
| 5 | **A trail laid behind you as you move** | Magma, Swamp (BxP); Shadow Pinion (VS) | TREMOLO's blurb promises it. |
| 6 | **Out and back — boomerang** | Cross (VS) | Nothing returns. |
| 7 | **A lobbed arc that lands past what is in front** | Axe (VS), Bomb (BxP) | Only `strike` reaches past a crowd, and it is unaimed. |
| 8 | **Splits or spawns sub-projectiles on hit / on wall** | Cell, Egg Sac, Shotgun, Fireworks (BxP) | CANON's blurb promises it. |
| 9 | **Triggers when you take damage** | Victory Sword, Pako Battiliar (VS) | No weapon in the game fires on any event but a timer. |
| 10 | **Grows while a condition holds** | Vento Sacro (VS), Flesh, Steel (BxP) | WALL OF SOUND's blurb promises it. |
| 11 | **Any status, stack, DoT, debuff or conversion** | over half of Ball x Pit | `Modifiers` has 13 fields and not one is a status. There is no burn, no slow-on-hit, no vulnerability, no charm. |

**And the structural one, which subsumes 8, 9 and 11: MusicWars has no TRIGGER axis at
all.** Every one of the seven routines fires on the same event — an interval timer
counting down in `fireInstruments`. Ball x Pit's roster is eight triggers crossed with
its effects. That is where its 90 balls come from, and it is why 66 MusicWars duets
produce seven behaviours.

---

## Part D — nine new shapes

Ranked by (impact × cheapness). Each gives: the verb, the reference weapon it echoes,
what the player **does differently**, an implementation sketch against the real
machinery, a **projectile budget**, and which existing instruments should be
re-pointed to it.

### D.0 First, the performance ceiling — measured, and it is not where the brief assumed

The brief warns: *"56 fps at 39 enemies headless, 40-57 fps observed live. Do NOT
design a shape putting hundreds of projectiles on screen without costing it."* The
instruction stands. But the constraint is not the simulation, and that changes which
designs are affordable.

**MEASURED — `tools/framewhere.mjs`, live Chromium against the dev server on 5173, run
twice at two different waves.**

Wave 20, 483 rendered frames, 1,647 world steps, 1,981 ms of work attributed:

| | ms per call | calls | total ms | share | ms per rendered frame |
|---|---|---|---|---|---|
| `director.update` | 0.42 (max **40.6**) | 1647 | 692 | **34.9%** | 1.43 |
| `renderer.render` | 1.13 (max 9.9) | 483 | 544 | **27.5%** | 1.13 |
| `hud.update` | 0.88 (max 5.7) | 483 | 426 | **21.5%** | 0.88 |
| `world.update` | 0.16 (max 3.7) | 1647 | 259 | **13.1%** | 0.54 |
| `director.sampleBar` | 6.99 (max 12.0) | 8 | 56 | 2.8% | 0.12 |
| **accounted total** | | | **1981** | | **4.10** |

Wave 12 reproduces it: renderer 592 ms, `director.update` 607 ms, hud 434 ms,
`world.update` **227 ms = 11.8%**. Two runs, two waves, same ordering.

Three things follow, and all three are load-bearing for this catalogue.

1. **The simulation is the cheapest of the four things in the frame — 12–13%.** The
   audio director costs more per frame than the renderer does.
2. **The accounted steady-state work is 4.10 ms per rendered frame, which is 244 fps
   of headroom.** It does not explain 40–57 fps. What does is the tail: **30 long
   tasks with a top of 149 ms**, `director.update` peaking at 40.6 ms, and
   `sampleBar` at 7 ms mean. **The frame problem is spikes, not steady-state cost**,
   and the spikes are in the audio path.
3. Therefore the projectile budget is a **render** budget, not a simulation one — and
   nobody has measured the render slope against bullet count.

**And the simulation slope itself is measured.** `budget.mjs`, real `World.update`,
4,000 measured steps × 3 repetitions per condition, zero-damage injected bullets so
the enemy count does not move:

| target | mean enemies | mean bullets | ms/step | run-to-run spread |
|---|---|---|---|---|
| baseline | 12.4 | 32.8 | 0.0224 | 1.7 µs |
| 100 | 12.4 | 105.9 | 0.0304 | 2.1 µs |
| 200 | 12.4 | 202.6 | 0.0483 | 12.4 µs |
| 400 | 17.9 | 396.2 | 0.0908 | 35.8 µs |

→ **+73 bullets costs +8.0 µs/step (110 ns per bullet per step)** at a fixed 12.4
enemies, against a 2.1 µs run-to-run spread — signal over noise, not a coin flip. At
two sim steps per 60 Hz frame that is **16 µs per frame for 100 extra bullets, 0.1% of
a 16,667 µs budget.** Scaling the collision term pessimistically to 39 enemies
(×39/12.4, assuming the entire increment is `bullets × enemies`) gives **~1.0% of a
frame for 200 extra player bullets.**

**CLAIMED conclusion: `MAX_PLAYER_BULLETS = 400` is not a simulation constraint. The
budgets below are stated anyway** — because the render slope is unmeasured, because
`MASTER_PLAN` G4 already records CROSS-STRUNG silently hitting the cap, and because a
shape that cannot state its number is not designed.

---

### D.1 `lance` — the held laser *(the owner asked for this by name)*

**Verb.** One continuous beam, anchored to the ship, **tracking your aim in real time**
and burning whatever it crosses. It does not re-fire. It never stops. Its cost is that
it is one line and you have to point it.

**Echoes.** Laser Cutter (BxP — *"constantly emits a laser in front of it"*), Phas3r
(VS).

**What the player does differently.** Today not one weapon rewards continuous aiming.
`seek` picks targets for you, `aura` is omnidirectional, `arc` sprays, `strike` is
explicitly unaimable. A held lance makes your **heading** the weapon: you strafe
sideways to keep the line on a boss, you rotate through a pack like a scythe, and
standing still with the line off-target is the worst thing you can do. It is a
different left hand, not a different damage number.

**Implementation.** `Effect{kind:'beam', attached:true}` already exists, is already
drawn by the renderer, and `updateEffects` **already rewrites `x`/`y` from
the player every frame for attached effects**. The change is: also rewrite `angle` from
`p.aim`, set `life` long, and have the fire routine re-spawn only when the instrument's
beam is missing rather than every interval. `dps = damage / interval` keeps power
comparable to today's `fireBeam`.

**Projectile budget: 1 `Effect` object, permanently. Zero `BulletPool` entries.** The
cheapest shape in the catalogue. Collision is one segment-versus-circle test per enemy
per frame, which is exactly what `updateEffects`' beam branch already does.

**Re-point.** **ROSIN BOW** (`bow`) — whose blurb is already *"One held beam along your
facing. **It does not stop.**"* — and **HARMONICS**, its evolution (*"Three parallel
beams, held"*), which becomes three parallel lances. `bow + laser → harmonics` has
LASER as its literal catalyst. Zero new ids, zero offer slots, zero audio.

---

### D.2 `trail` — hazard laid down by moving

**Verb.** While you move you drip a lingering pool behind you every N pixels. Standing
still lays nothing.

**Echoes.** Magma / Swamp / Glacier (BxP), Shadow Pinion's moving half (VS).

**What the player does differently.** Your **movement path becomes the weapon**. You
stop running in straight lines away from a pack and start drawing loops around it, then
walking it through your own trail. It is the only shape whose output the player authors
directly with the stick, and it is the natural counterweight to the camp-pressure
system already in `World` (`IDLE_GRACE_S` and friends) — a trail instrument makes
moving *pay* rather than merely making standing still *cost*.

**Implementation. Zero new machinery.** `wells[]` already carries `x, y, age, life,
radius, dps, pull, swallows, hue, id`, and `pushWell` already places one. The
fire routine becomes distance-triggered instead of interval-triggered: accumulate
`hypot(dx, dy)` since the last drop, call `pushWell` every ~90 px. The
`if (this.wells.length >= 14) return` guard in `pushWell` is already the cap.

**Projectile budget: capped at 14 wells by the existing guard, with a steady state
of ~6.** At a typical 400 px/s and 90 px spacing that is one drop every 0.22 s, so
`life ≈ 1.4 s` gives six live. Zero bullets.

> **CORRECTION, WRITTEN AFTER THIS SHIPPED. The container above is wrong and the
> reason was not knowable when this section was written.** `docs/plan-passives.md`
> §8.8 later measured that **nothing in `Renderer` read `World.wells`** — BLACK HOLE
> and TREMOLO FIELD were invisible damage pools — so a trail built on `pushWell`
> would have been a weapon whose whole design is "your movement path is the weapon"
> and which the player could not see. The shipped `trail` uses **`novas[]`**, the
> same container UP-TEMPO's trail rule took for the same reason, and `fireTrail` is
> distance-gated on the ship's velocity rather than on an accumulator because an
> instrument has an interval and a passive does not.
>
> `Renderer.drawWells` landed in the same change, so `wells[]` is drawn now — the
> trail still keeps the ring, because a well grows and collapses on a sine over its
> life and a wake wants something that opens once and fades. MEASURED, one
> instrument at max with the whole rig at max (`tools/_shapecount.mjs`): **24 rings
> at base rig, 69 at the rig ceiling**, against the ~6 estimated here. The estimate
> was low because it did not fold REVERB's `area` or the rig's `linger` into `life`.
> Zero bullets, as predicted.

**Re-point.** **TREMOLO FIELD**, whose blurb already reads *"Pools left in your wake
that keep working after you have gone."* This is a repair, not an addition.

---

### D.3 `chain` — arcs from body to body

**Verb.** One bolt to the nearest enemy, which jumps to the next nearest inside a
radius, N times, losing a fraction of its damage each hop.

**Echoes.** Lightning and Storm (BxP).

**What the player does differently.** Its value depends on enemy **density and
spacing**, not on your position. It is the first weapon that makes you want the crowd
*tight* — so you stop kiting a pack apart and start letting it bunch, which is the
exact opposite of what every current shape teaches. Against a lone boss it is the worst
weapon in the game, which is a real, legible trade.

**Implementation.** No `BulletPool` at all. A chain is a list of segments rendered as
`Effect{kind:'beam', attached:false, life:0.12}`, one per hop. Damage is applied
instantly in the fire routine, exactly as `fireStrike` already iterates
enemies and subtracts `hp`. Structurally this is `fireStrike` with a nearest-next walk
instead of a random pick.

**Projectile budget: at most ~8 `Effect` objects live** (`count` hops × 0.12 s life ÷
0.6 s interval). Zero bullets.

**Re-point.** **CARILLON**. Its blurb is verbatim *"Every strike chains to two more.
The ringing does not stop"*, and the same comment heading already lists it as prose the
simulation does not deliver. **This is the single highest-value re-point available:**
one `shape` field, a promise already written and paid for, and it makes
`chime + resonance → carillon` a genuine verb change — which is the file header's own
stated design rule. It also takes `strike` from 3 to 1 without touching CHIME, whose
`strike` was split out of `seek` *for* the chime family (the *"Rejected on the census"* bullet in `weapons.ts`'s
`FUSIONS` preamble refuses to move it, and this proposal does not).

---

### D.4 `cone` — the short-range burst *(the owner asked for this by name)*

**Verb.** A dense, short, wide spray of fast pellets along your facing that dies at
~200 px. Enormous at contact range, literally nothing beyond it.

**Echoes.** Flames of Misspell (VS), Shotgun (BxP).

**What the player does differently.** **It is the only weapon in the game that would
ask the player to close.** Everything today is safe-at-range or omnidirectional, and
the arena's whole risk model is "stay away and let the auto-aim work". A cone inverts
it: you dive into the group, dump, and leave — and you cannot camp with one, which
lines up with the camp-pressure system rather than fighting it.

**Implementation.** `fireSeek`'s spawn loop with the convergence removed, a short
`range`, and `s.arc` used as the spread — which finally gives `arc` a consumer outside
`fireArc`. `BulletPool.spawn` unchanged, `type: 0`, `ttl` already derived from
`range / speed` by the existing code.

**Projectile budget: 16 bullets worst case.** At `count` 12, `speed` 900, `range` 200
each pellet lives 0.22 s; at `interval` 0.55 s only one generation is ever alive. Push
to SPREAD-max `count` 16 and RAPID-max `interval` 0.28 s and 0.22/0.28 is still under
one generation. **4% of `MAX_PLAYER_BULLETS`.**

**Re-point.** **FEEDBACK** (`aura`, *"A hum around the hull that burns whatever comes
close"*) — already a short-range weapon, one of seven auras, and it keeps its blurb
while gaining a facing — and **WALL OF SOUND**, its evolution, whose dead blurb *"the
field grows with your speed"* finally has an axis to grow along. HARP GLISS was
considered and rejected: it is the game's mid-range fan and shortening it is a reach
nerf dressed as a re-point.

---

### D.5 `mortar` — the lobbed arc that lands

**Verb.** A shell aimed at a target's **predicted** position that ignores everything in
between, telegraphs where it will land, and detonates there.

**Echoes.** Axe (VS), Bomb and Landslide (BxP).

**What the player does differently.** It is the only shape that hits *past* a wall of
bodies. Today a bolt stops on the first thing it touches and `strike` is the sole
exception, unaimed. A mortar means the dangerous back rank is reachable, so you stop
retreating from a pack and start hitting through it. And because the landing is
telegraphed and an enemy can walk out of it, it is the first weapon whose output the
*enemy* can respond to.

**Implementation.** `novas[]`, exactly as `fireStrike` already uses it — that routine
already pushes a `dps: 0, clears: false` ring purely as a visual, so the
telegraph is a container that exists and is already drawn. The damage is instantaneous
and area-flat, as `fireStrike`'s already is. The only new state is a small list of
pending detonations with a timer.

**Projectile budget: 10 `novas` entries** (5 telegraphs + 5 detonations). Zero bullets.
**Risk to record: `novas` has no cap today** — the two `novas.push` sites (`fireAura` and
`fireStrike`) carry no length guard, unlike `wells`' 14. A mortar should add one.

**Re-point.** **TUTTI** (`timpani + magnet → tutti`), whose blurb *"Everything is
pulled to the centre first, and then struck"* is a telegraph that pulls followed by a
landing, and which `weapons.ts` lists as undeliverable prose. TIMPANI itself stays
`aura`. This takes `aura` from 7 to 4 in combination with D.4.

---

### D.6 `boomerang` — out and back

**Verb.** A heavy projectile that travels out to `range`, decelerates through zero, and
returns along its own line, damaging on both legs.

**Echoes.** Cross (VS), and Ball x Pit's whole catch-the-rebound loop.

**What the player does differently.** It is the only projectile whose second half
depends on where **you** are when it turns around. You kite differently: you pull back
*through* your own returning shot rather than away from it, and hovering near the
turnaround point doubles your output. Combined with `pierce` it is the game's first
line-clear-both-ways weapon.

**Implementation.** `BulletPool` already carries `accel`, `minSpeed` and `maxSpeed` and
already integrates them in `BulletPool.update`. A boomerang is
`speed: +700, accel: -1400, minSpeed: -700` — it decelerates through zero and comes
back with **no new field at all**. The pool's existing `turn` gives an adequate
approximation of homing the return leg onto a moving ship.

**Projectile budget: 6 bullets.** `count` 3, life ≈ 2 × range ÷ mean speed ≈ 1.6 s,
interval 0.9 s → two overlapping generations.

**Re-point — and this is the one with no free owner.** ECHO CHAMBER is thematically the
return, but re-pointing it off `seek` re-kills `bounces`, which is this repo's flagship
dead-stat repair and which only `fireSeek`, `fireArc` and `firePods` forward. SNARE and
HARP are both wanted elsewhere or are worse fits. **So `boomerang` is the one shape
that argues for a new base instrument, and the cost must be stated** — see §6.1.

---

### D.7 `spray` — your own bullet pattern *(the owner asked for "more fun with projectiles")*

**Verb.** A continuous, unaimed, high-rate stream of small bolts thrown in a **rotating**
pattern around the ship, bouncing off the walls.

**Echoes.** 108 Bocce (VS); and, more to the point, the thing every Ball x Pit review
names — *"a million things pinging around the screen"*, *"lights up like a Christmas
tree"*.

**What the player does differently.** The reason MusicWars does not *feel* like a
projectile game is that its highest-`count` shapes are auras and beams, which are not
objects — they are rings and rectangles that appear and fade. A spray puts the player's
own output on screen as a **physical field you can watch move**. You stop pointing and
start timing: the pattern rotates whether you like it or not, so you position against
its phase, and the walls mean your own shots come back through where you were standing.
It is the only shape that gives the player a *pattern* rather than a *volley*.

**Implementation.** `BulletPool.spawn` with a rotating base angle plus `turn`, which the
pool already integrates, and `bounces` forwarded so it ricochets — the wall reflection
is already implemented in angle space in `BulletPool.update` and already counted by
`BulletPool.bounced`.

**Projectile budget — this is the one that has to be costed hard.** At `count` 8,
`interval` 0.12 s and `ttl` 1.6 s the steady state is 8 × (1.6 / 0.12) = **107 bullets
from one instrument.** Four instruments cannot all be sprays. Recommendation:

- exactly **one** spray in the roster, `ttl` tuned so its steady state is ≤ 90;
- raise `MAX_PLAYER_BULLETS` from 400 to 700 **in the same change** (MASTER_PLAN G4
  already asks for this and records CROSS-STRUNG silently hitting the cap today), and
- gate it on `BulletPool.overflow`, which already exists as a counter for exactly this.

At the measured 110 ns per bullet per step, 90 bullets is 20 µs per 60 Hz frame — 0.12%
of budget in simulation. **The render slope is the unmeasured half and must be measured
before this ships**; `tools/perf.mjs` isolates renderer cost by toggling features on a
live run and is the tool for it.

**Re-point.** **CROSS-STRUNG** (`harp + spread → crossstrung`, *"A full circle of
strings, swept continuously"*) already is this and already saturates the pool. Making it
a spray formally, with a budget and a raised cap, is a **repair**.

---

### D.8 `tether` — the short-range leash *(second answer to "short range")*

**Verb.** A line locks onto the nearest enemy inside a short radius and stays locked
while it is in range, dealing damage per second and **dragging the enemy toward you**.

**Echoes.** Clock Lancet's lock (VS); Leech and Lightning Rod (BxP — *"attaches a
persistent thing to an enemy"*).

**What the player does differently.** You choose to hold something **close**, which
fights the game's entire keep-away instinct. It also makes crowd position a resource:
tethering the front shape of a pack and backing off drags the pack out of formation.

**Implementation.** `Effect{kind:'beam', attached:true}` with `x/y/angle/length`
rewritten each frame from the ship to the locked enemy — the `attached` branch in
`updateEffects` already does two thirds of that. And it gives **`Effect.pull` its first
reader**: the field is declared on the `Effect` interface and read nowhere,
because `Effect{kind:'field'}` is a declared kind that no site ever pushes.

**Projectile budget: at most 4 `Effect` objects.** Zero bullets.

**Re-point.** No clean free owner. BLACK HOLE must not move (`fieldSwallows` is a
hardcoded id list and DOWNBEAT is the only fused instrument that keeps the throw).
FEEDBACK is spent on `cone`. Ranked below `boomerang` for that reason.

---

### D.9 `spawn` — the autonomous ally

**Verb.** Something detaches from you and fights on its own: flies to a target, hits,
picks a new one, expires after N hits or T seconds.

**Echoes.** Gatti Amari (VS); Brood Mother, Mosquito King, Nosferatu (BxP — and note
that the wiki attributes Ball x Pit's late-game screen-fill to **spawners, not slot
count**).

**What the player does differently.** For the first time something is fighting in a
place you are not. Every existing shape is welded to the ship, pods included. A summon
means a corner stays defended while you leave it, and it splits the player's attention
across two positions — which is a genuinely different cognitive load, not a bigger
number.

**Implementation — and this is the only shape needing anything new.** `BulletPool` has
no per-bullet target. But `World.steerPlayerBullets` **already exists**: it is
an O(live × enemies) per-frame re-target loop over the whole player pool, run whenever
`mods.homing > 0`, and `Modifiers.homing` is already documented as *"0..1 seek strength
applied to projectiles that do not already home"*. So the machinery to home a bullet at
the nearest enemy every frame is shipped and running. What a summon adds on top is
persistence: a long `ttl`, `pierce` that does not consume it, and **one `Int16Array`
target index on `BulletPool`** so a summon keeps its target between frames instead of
re-picking. One array, one loop.

**Projectile budget: 12 bullets, capped.** `count` 4 alive × `ttl` 6 s ÷ `interval` 3 s
= 8 steady state; cap the shape at 12. The re-aim cost is 12 × 39 = 468 distance tests
per frame at the stated enemy ceiling, which is **less than `steerPlayerBullets` already
does today** whenever HOMING is held.

**Re-point.** **VIBRATO** (`tremolo + homing → vibrato`, blurb *"The pools go hunting"*,
catalyst literally HOMING). A pool that hunts is a summon. Stated honestly: **this
re-points a row that was itself re-pointed one change ago** (field → strike), so it
should be argued on `deadhunt-ranges` output the way that change was, not on taste.

---

### D.10 The nine, summarised

| # | Shape | Container | New machinery | Budget (worst case) | Owner | Owner is free? |
|---|---|---|---|---|---|---|
| 1 | `lance` | `Effect{beam}` | rewrite `angle` in the existing `attached` branch | **1 Effect** | bow, harmonics | yes |
| 2 | `trail` | `wells[]` | none — `pushWell` verbatim, distance-triggered | 14 wells (cap exists) | tremolo | yes |
| 3 | `chain` | `Effect{beam}` | none | 8 Effects | carillon | yes |
| 4 | `cone` | `BulletPool` | none | 16 bullets | feedback, wallofsound | yes |
| 5 | `mortar` | `novas[]` | a pending-detonation list; **add a `novas` cap** | 10 novas | tutti | yes |
| 6 | `boomerang` | `BulletPool` | none — negative `accel`/`minSpeed` | 6 bullets | **none** | **no — see §6.1** |
| 7 | `spray` | `BulletPool` | none; **raise `MAX_PLAYER_BULLETS`** | **90–107 bullets** | crossstrung | yes |
| 8 | `tether` | `Effect{beam}` | first reader of `Effect.pull` | 4 Effects | **none** | **no** |
| 9 | `spawn` | `BulletPool` | **one `Int16Array`** target index | 12 bullets | vibrato | yes |

**Nine shapes. Zero new containers. Zero new render contracts. One new typed array.**

MASTER_PLAN G5 caps this at *"2–3 new shapes, not 20"* on the ground that *"each new
shape = fire routine + container + render contract + dead-stat audit rows — the
documented choke point."* That cost model is right about the choke point and wrong that
it is uniform. **Six of these nine need no container and no render contract**, because
`wells[]`, `novas[]`, `Effect{beam}`, `Effect{sweep}` and `BulletPool` already exist and
are already drawn. **The cap belongs on containers, not on shapes.** G5's own three
named candidates — *movement-trail, wall/barrier, facing-stream* — are D.2, an
unaddressed gap, and D.1/D.4 respectively; this list is a sharpening of G5, not a
contradiction of it.

**The dead-stat audit rows are the real remaining cost, and they are pre-answerable.**
`tools/deadhunt-ranges.mjs` prints, per shape, which declared stats the routine never
reads — and the CHIME incident recorded in `InstrumentShape`'s comment is exactly a
shape change creating a dead stat. Every re-point above must be run through it. Which
stats each new shape reads:

| shape | reads | deliberately ignores |
|---|---|---|
| `lance` | interval, damage, area (half-width), range, linger | count, speed, pierce, bounces, arc |
| `trail` | damage, area, linger, count (drops per step) | speed, pierce, bounces, arc, range |
| `chain` | interval, count (hops), damage, area (hop radius), range | speed, linger, bounces, arc |
| `cone` | interval, count, damage, arc, speed, range, pierce, bounces | area, linger |
| `mortar` | interval, count, damage, area, range, linger (telegraph delay) | speed, pierce, bounces, arc |
| `boomerang` | interval, count, damage, speed, range, pierce, bounces | area, arc, linger |
| `spray` | interval, count, damage, speed, range, bounces, arc (rotation step) | area, linger, pierce |
| `tether` | interval, count, damage, area, range, linger | speed, pierce, bounces, arc |
| `spawn` | interval, count, damage, speed, range, linger (lifetime), pierce | area, arc, bounces |

---

## Part E — the combination matrix

### E.1 Does Ball x Pit's "carries BOTH parents' abilities" model fit MusicWars?

**On the shape axis: no, and the reason is structural.** `synthesiseDuet`
(`synthesiseDuet` in `weapons.ts`) takes `shape: a.shape` and the better half of each stat. A
MusicWars shape is a **dispatch**, not an ability — `fireInstruments` runs exactly one
routine per instrument per tick. "Carry both shapes" therefore means "run two
routines", which is precisely what holding both instruments already does. A duet built
that way would be a slot saving and not a new thing, which is the failure Ball x Pit's
own reviewers name from the other direction (*"a bastardized ball that nerfs previous
effects"*).

**On the trigger axis: yes, exactly, and this is the whole answer.** Ball x Pit gets
free composition because its abilities are **on-hit riders attached to one bouncing
ball**. The motion is shared, so two effects compose at no cost. The MusicWars-shaped
version of "carries both abilities" is therefore **the rider**, not the shape.

That converges independently with two things already written down:
`docs/research-items.md` Gap 5 (*"index the rider on the SECOND parent's id only —
twelve authored riders applied to whichever shape parent A brings"*), and MASTER_PLAN
G4 (*"the trigger event — on-hit / on-wall / on-expiry / on-beat — is assigned per
pair; no two duets share (shape, rider, trigger)"*). Part A's finding — that 17 of Ball
x Pit's ~30 verbs are triggers and statuses rather than spatial shapes — is the
evidence those two proposals were missing.

**CLAIMED: the trigger axis is cheaper than the shape axis and should ship first.**
Six trigger points already exist in this codebase as events or as branches:

| Trigger | Where it already exists |
|---|---|
| on hit | 8 damage sites in `world.ts`; needs the `hurt(enemy, amount, source)` chokepoint `research-items.md` Gap 4 already asks for |
| on expiry | `BulletPool.update`'s `t <= 0` branch |
| on wall | `BulletPool.update`'s `hit` branch — already increments `bounced` |
| on graze | `player:graze` is emitted by `collidePlayer`; `BulletFlag.Grazed` exists |
| on kill | `enemy:death { byPlayer }` is emitted on every player kill |
| on player hit | `player:hit` is emitted |

**12 riders × 14 shapes = 168 distinguishable duet outcomes from a twelve-row table**,
against the 66 pairs producing 7 behaviours at one fixed power level today. And it
answers the two missing verbs Part C.4 flagged as structural — *triggers when you take
damage* (#9) and *splits on hit or on wall* (#8) — without a new shape for either.

This also retires D.8-adjacent thinking about a "riposte shape". Firing on damage is a
**trigger**, not a shape; as a rider it composes with all fourteen routines, and as a
shape it would need its own instrument. That is the general rule this section
establishes: **if a proposed verb is about *when*, it belongs on the rider table; if it
is about *where*, it belongs on the shape table.**

### E.2 The authored recipes: which fuse into which verb

A fusion **must** change the verb. Today, MEASURED by `census.mjs`, **4 of 15 recipes
do** — and two of those four are unions, which `levelup.mjs` reaches once in 240
builder runs.

Applying the nine re-points from Part D:

| recipe | today | proposed | why the verb changes |
|---|---|---|---|
| `bow + laser → harmonics` | beam → beam | **lance → lance** | both move; the catalyst is literally LASER and the blurb already says "it does not stop" |
| `chime + resonance → carillon` | strike → strike | strike → **chain** | the blurb is verbatim "every strike chains to two more" |
| `feedback + tempo → wallofsound` | aura → aura | **cone → cone** | both move; "the field grows with your speed" needs a facing to grow along |
| `timpani + magnet → tutti` | aura → aura | aura → **mortar** | "everything is drawn in before the strike" is a telegraph that pulls, then lands |
| `tremolo + homing → vibrato` | field → strike | **trail → spawn** | "pools left in your wake" then "the pools go hunting" — the two blurbs are two different verbs and always were |
| `harp + spread → crossstrung` | arc → arc | arc → **spray** | "a full circle of strings, swept continuously"; it already saturates the pool |
| `drones + fermata → chorale` | orbit → beam | unchanged | argued at length one change ago; do not re-litigate |
| `snare + rapid → blastbeat` | arc → arc | unchanged | the *"Blocked, concretely"* bullet in `weapons.ts` — "the roll never lands" is already satisfied inside `arc`: the sweep's life is 0.16 s and the interval is 0.16 s |
| `echoes + timewarp → canon` | seek → seek | unchanged | `bounces: 8` is the flagship dead-stat repair and only `fireSeek` forwards it |
| `blackhole + compressor → downbeat` | field → field | unchanged | `fieldSwallows` is a hardcoded id list; DOWNBEAT is the only fused instrument that keeps the player's throw |
| `nova + reverb → cathedral` | aura → aura | unchanged | NOVA's ring is on the beat and the beat is the game's premise |
| `pizzicato + capo → spiccato` / `+ compressor → snap` | seek → seek | unchanged | the branch note on SNAP records the decision |
| `chorale + cathedral → requiem` (union) | beam → aura | unchanged | already changes |
| `harmonics + crossstrung → stringsection` (union) | beam → arc | **lance → arc** | still changes |

MEASURED — `census.mjs` re-run with the nine re-points applied:

```
AFTER THE 9 PROPOSED RE-POINTS  (14 shapes over 27 instruments = 1 verb per 1.9)
  seek        5  19%    arc         4  15%    aura        4  15%
  lance       2   7%    field       2   7%    cone        2   7%
  strike      1   4%    orbit       1   4%    trail       1   4%
  chain       1   4%    spray       1   4%    beam        1   4%
  mortar      1   4%    spawn       1   4%
  largest shape holds 19% of the roster
AFTER: 7 of 15 recipes change the verb; 8 keep it.   (today 4 of 15)

re-points naming an id that does not exist: 0
instruments with no ENSEMBLE_MIX lane: 0 of 27
```

| | today | after |
|---|---|---|
| distinct shapes | 7 | **14** |
| instruments per verb | 3.9 | **1.9** |
| largest shape's share of the roster | 26% | **19%** |
| recipes that change the verb | 4 of 15 | **7 of 15** |
| new instrument ids | — | **0** |
| offer slots consumed | — | **0** |
| `ENSEMBLE_MIX` lanes touched | — | **0** |

1.9 sits between launch-Vampire-Survivors (1.2) and Ball x Pit (3.0), and it costs
nine `shape` fields plus seven fire routines.

### E.3 Branching, which is free and doubles the matrix

Both reference games branch: Assassin takes Iron + **Ghost or Dark**; Black Hole takes
Sun + **Dark or Time**; Clock Lancet takes **either** ring; Penshin Fatcha has six
branches. MusicWars has **1 of 12** instruments with two endings.

With fourteen shapes, a branch becomes *"which verb do I want this instrument to
become"* — which is exactly the Ball x Pit decision and exactly the Vampire Survivors
decision. `research-items.md` Gap 2 already proposes giving every base instrument a
second catalyst from the **existing twelve** rig items, `AGENTS.md` §5 explicitly
blesses reusing a passive as a second catalyst, and `availableOptions` skips
`def.fused` outright — so **twelve new results add exactly zero cards to the draft
pool.** Part D's shapes are what make that proposal worth doing: without them, a branch
is a choice between two stat blocks.

The natural pairings, given the new shapes: BOW → `lance` or (with SPREAD) `spray`;
FEEDBACK → `cone` or `tether`; CHIME → `chain` or `mortar`; TREMOLO → `trail` or
`spawn`; SNARE → `arc` or `boomerang`. Each is one recipe row plus one result row.

---

## Part F — the constraints, addressed explicitly

### F.1 The four-card offer is zero-sum

`AGENTS.md` §5 is absolute and the measurement behind it is real: letting evolved
instruments level took designed fusions per run **1.63 → 1.13** and the
builder-vs-drifter ratio **2.2× → 1.5×**, at three draw weights, all the same
direction.

**Every re-point in Part D costs zero offer slots.** A re-point changes a `shape`
field. It does not add an id, and fusion results are excluded from the draft pool
outright (`availableOptions` in `progression.ts`: `if (def.fused || def.weight <= 0) continue`). Nine
re-points, seven new fire routines, fourteen shapes: **zero cards added.**

### F.2 If a new instrument is added, what it displaces

Two shapes in Part D have no free owner: **`boomerang`** and **`tether`**. If either is
wanted, the cost, stated:

- **Draft dilution.** The draftable pool is 12 base instruments. A thirteenth takes
  every existing instrument's share from 1/12 to 1/13 — **−7.7% each**, before weights.
  That is the number to watch alongside designed-fusions-per-run.
- **One `ENSEMBLE_MIX` line**, picking an existing stem. No new stem.
- **One `SHOT_VOICES` row** — or, given §0.2, one line in `world.ts` that would give
  this instrument *and the other nineteen* a distinct voice at the same time.
- **One `EvolvedId` / `InstrumentId` union entry** in `src/core/events.ts`, one
  `FUSIONS` row reusing an **existing** passive as a second catalyst, one `INSTRUMENTS`
  row for the result, and `character` + `line` strings.
- **`npm run mirror` is mandatory** — `src/render/levelup.ts` holds a second copy of
  the fusion rules and has drifted before.

**Recommendation, CLAIMED: add at most one, and make it `boomerang`.** It is the more
distinct verb, it needs no new machinery at all (negative `accel` and `minSpeed` on the
existing pool), and `tether` overlaps `cone` in the short-range role the owner asked
for. If the answer is zero new instruments, the catalogue still delivers **13 shapes
and 1 verb per 2.1**, which is most of the win.

### F.3 The rig is a deliberate 12×12

Untouched. **No new passive is proposed.** `AGENTS.md` §5: a thirteenth passive breaks
the symmetry and is preferentially spent by `sacrificeFor`, which protects catalysts.
Every branch in §E.3 reuses one of the existing twelve as a second catalyst, which the
same section explicitly permits.

### F.4 Every instrument is also a musical lane — weighed explicitly

This is the strongest argument for re-pointing over adding, and the measurement
sharpens it in both directions.

**For re-pointing.** MEASURED, `census.mjs`: **0 of 27** instruments lack an
`ENSEMBLE_MIX` lane, and **every re-point changes `shape` only, so `ENSEMBLE_MIX` is
untouched by construction.** A re-pointed instrument keeps its id, its stem, its
`character` phrase, its `abilityStems` behaviour and its `ensembleSize` contribution.
The audio side cannot tell the difference. Nine new verbs for zero lines in
`src/audio/`.

**Against the "a new instrument needs a voice written" framing.** MEASURED, §0.2:
19 of 27 instruments already ship with no bespoke shot voice, the family fallback
designed to cover them is unreachable because the `player:shoot` emit never sets `voice`, and
all 27 `character` first-words already match a family key. So the *marginal* audio cost
of a new instrument is one `ENSEMBLE_MIX` line — the shot voice is either free (family
fallback, once the emit is fixed) or is a cost 19 existing instruments are already
paying.

**The honest weighing.** Re-pointing is still strictly better, because it is free on
both axes and because it repairs promises the game has already made. But the audio
argument is a reason to prefer re-pointing, not a prohibition on adding — and it should
not be used as one, because the premise it rests on is currently a defect rather than a
design.

### F.5 Things this document does not re-propose

- **Letting evolved instruments level.** `AGENTS.md` §5. Measured worse. Nothing here
  depends on it.
- **Adding a card type.** `AGENTS.md` §1 and §5. Nothing here touches the offer pool.
- **A thirteenth passive.** `AGENTS.md` §5.
- **Combining across tiers.** `AGENTS.md` §5; admitting evolved-plus-base took designed
  fusions 1.63 → 1.13 while duets went 4 → 9.
- **`chime → aura`, `blackhole → strike`, `snare → orbit`, `echoes → field`,
  `bow → arc`.** All five are proposed in `research-items.md` §5 Gap 1 and all five are
  refused with concrete reasons in the `FUSIONS` preamble comment in `weapons.ts`, under
  *"THE OTHER ELEVEN WERE EXAMINED AND LEFT"*. Those objections are
  **correct and stand**. This document routes around every one of them: it moves CHIME's
  *evolution* rather than CHIME, leaves BLACK HOLE and CANON alone entirely, leaves
  BLAST BEAT alone, and moves BOW to `lance` rather than to `arc` — which preserves
  STRING SECTION as a shape change instead of collapsing it.
- **The "evolution `line` text already names the target shape" claim.** That was checked
  and refuted, 0 of 6. This document argues from **`blurb` and `character`**, which are
  different fields, and quotes them verbatim each time rather than asserting a pattern.

---

## Part G — ranking, and what to do first

| rank | item | impact | cost | why |
|---|---|---|---|---|
| 1 | **`trail`** (TREMOLO) | high | **S** — `wells[]` verbatim, ~20 lines | delivers a written promise; movement becomes the weapon |
| 2 | **`chain`** (CARILLON) | very high | **S** — `fireStrike` with a nearest-next walk | delivers the most-quoted broken blurb; makes CHIME's evolution a real verb change |
| 3 | **`lance`** (BOW, HARMONICS) | very high | **S** — one line in the existing `attached` branch | the owner asked for a laser by name; the blurb already promises it |
| 4 | **`cone`** (FEEDBACK, WALL OF SOUND) | very high | **S** — `fireSeek` without convergence | the owner asked for short range by name; the only shape that asks you to close |
| 5 | **The rider / trigger table** (§E.1) | very high | **M** — needs the `hurt()` chokepoint first | 168 duet outcomes from 12 rows; the axis both reference games actually use |
| 6 | **`spray`** (CROSS-STRUNG) | high | **M** — plus `MAX_PLAYER_BULLETS` and a render measurement | "more fun with projectiles", and a repair of a cap already being hit |
| 7 | **`mortar`** (TUTTI) | medium | **M** — `novas[]` plus a cap it needs anyway | the only shape that hits past a crowd |
| 8 | **Branch every instrument** (§E.3) | very high | **M** — audio lanes dominate | zero offer slots; makes the branch a choice of verb |
| 9 | **`spawn`** (VIBRATO) | high | **M–L** — one new typed array | the only genuinely absent archetype both games share |
| 10 | **`boomerang`** (+1 instrument) | medium | **M** — free machinery, costly slot | the one shape worth a new id; see §F.2 |
| 11 | **`tether`** | medium | **M** — no free owner | overlaps `cone`; last |

**WHAT HAS LANDED, and where to read it.** `lance`, `cone` and `spray` shipped
first (items 3, 4, 6). `trail`, `chain`, `mortar` and `spawn` shipped second (items
1, 2, 7, 9), taking the roster to **14 shapes over 27 instruments, 1 verb per 1.9,
largest share 19%** — exactly §E.2's projection, and with **zero instrument ids
added**. `boomerang` and `tether` (items 10, 11) are **deliberately not done**, on
§F.2's own arithmetic: both need a thirteenth base instrument, which costs every
existing one 7.7% of the draft, and §F.2 concludes that zero new instruments still
delivers most of the win. Items 5 and 8 — the rider/trigger table and branching
every instrument — are the remaining work and are untouched. Two of this section's
budgets were wrong and are corrected in place: `trail`'s in §D.2 and `spray`'s in
`weapons.ts` (105 measured against 93 by arithmetic).

**If only one thing is done: items 1–4.** Four `shape` fields and four fire routines,
every one of which reuses a container that already exists and already draws. They cover
two of the owner's three named asks, deliver four blurbs the game has been printing and
not honouring, take the roster from 7 shapes to 11, and cost the level-up offer nothing.

**Before any of it ships:** `node node_modules/typescript/bin/tsc --noEmit`,
`npm run mirror` (the second copy of the fusion rules in `src/render/levelup.ts`),
`levelup`, `discovery`, `wiring`, `builds`, and above all
`node --experimental-transform-types tools/deadhunt-ranges.mjs` — a shape change is the
exact way to create a dead stat, and the CHIME incident is that happening once already.

---

## Part H — what is not measured

Listed so nothing here is mistaken for settled.

- **The render slope against bullet count.** §D.0 measures the *simulation* cost of a
  player bullet (110 ns per bullet per step at 12.4 enemies, 3 repetitions, spread well
  under signal) and attributes the *live* frame (`world.update` 13.1% at wave 20,
  reproduced at wave 12). It does **not** measure what drawing 400 bullets costs.
  `tools/perf.mjs` isolates renderer cost by toggling features on a live run and is the
  tool that would settle it. **`spray` must not ship before that number exists.**
- **Whether the long tasks are the frame problem.** 30 long tasks with a top of 149 ms
  against 4.10 ms of accounted steady-state work is strong circumstantial evidence, and
  `director.update` peaking at 40.6 ms points at the audio path. It is not a diagnosis
  and it is outside this document's scope; it is recorded because it changes what the
  performance constraint on weapon design actually is.
- **Whether any of these shapes is fun.** Every number here comes from a bot, source, or
  a wiki. Nothing was played.
- **Whether re-pointing moves the balance.** A `strike` reads different stats from a
  `chain`; the stat blocks on the nine re-pointed rows will need re-tuning, and
  power-neutrality should be argued the way CHORALE's was (nominal
  `damage × count / interval` held constant) rather than eyeballed.
- **Nothing here was HEARD.** §0.2's finding is measured off emitted events, not off
  audio. `renders/capture-all-16.wav` still sits on disk unplayed.
- **The verb counts in Part A are a classification, not a census.** The criterion is
  stated at the top of Part A so the boundaries can be argued with. The MusicWars row
  of the §A.3 table is the only one produced by running something.

---

## Sources

Vampire Survivors: [Weapons](https://vampire.survivors.wiki/w/Weapons),
[Evolution](https://vampire.survivors.wiki/w/Evolution),
[Passive Items](https://vampire.survivors.wiki/w/Passive_Items),
[Level Up](https://vampire.survivors.wiki/w/Level_Up),
[Arcana](https://vampire.survivors.wiki/w/Arcana).

Ball x Pit: [Balls](https://ballxpit.wiki.gg/wiki/Balls) (base balls and all 69 evolved
balls with effect text), [Fusion Reactor](https://ballxpit.wiki.gg/wiki/Fusion_Reactor),
[wiki.gg](https://ballxpit.wiki.gg/wiki/BALL_x_PIT_Wiki).

In-repo: `docs/research-items.md` (the progression half of this diagnosis),
`docs/MASTER_PLAN.md` G4/G5, `AGENTS.md` §5, `src/game/weapons.ts`,
`src/game/world.ts`, `src/game/bullets.ts`, `src/audio/sfx.ts`,
`src/audio/orchestration.ts`, `tools/deadhunt-ranges.mjs`, `tools/framewhere.mjs`,
`tools/perf.mjs`.
