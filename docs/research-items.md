# Item mechanics: MusicWars against Vampire Survivors and Ball x Pit

Research and diagnosis for the launch note *"item mechanics are nowhere near those
two games."* No code was changed to produce this. Everything below is either
**MEASURED** (a number this document produced by running something, today, and the
command is named), **READ** (walked out of this repo's source or a reference game's
wiki), or **CLAIMED** (a design judgement — argue with it).

**What ran, and what could not.** `node --experimental-transform-types
tools/levelup.mjs` runs and its output is quoted below. Everything that imports
`world.ts` — `combine`, `builds`, `arena`, `decisions` — **could not run on this
machine**: `node_modules/@strudel/mini` is present as an empty directory, so
`tools/lib/headless-audio.mjs` fails to resolve. So every run-shaped number here
comes from the *pure* progression model, which this repo already records as
disagreeing with real play (`tools/combine.mjs` header: the model had a random
picker fusing in 97% of runs while a real 480 s run produced zero fusion cards
across 26 offers). **Treat model numbers as directional and re-run `combine` and
`builds` on a machine with full deps before acting on any of them.**

---

## 1. MusicWars, counted

MEASURED — `tools/levelup.mjs` plus two read-only probes written to the scratchpad
against the same pure modules.

| | count | source |
|---|---|---|
| base instruments (draftable) | **12** | `weapons.ts:INSTRUMENTS`, `fused !== true` |
| fusion results (never draftable) | **15** | `INSTRUMENTS`, `fused: true` |
| instruments total | **27** | |
| passives (RIG) | **12** | `weapons.ts:RIG` |
| authored recipes | **15** — 13 `evolution`, 2 `union` | `weapons.ts:FUSIONS` |
| instrument × passive recipes | 13 | |
| instrument × instrument recipes | 2 | |
| **passive × passive recipes** | **0** | |
| instruments with more than one ending | **1 of 12** (`pizzicato`) | |
| passives catalysing more than one recipe | **1 of 12** (`compressor`) | |
| generic duet pairs (base × base) | 66 | |
| generic union pairs (fused × fused) | 103 | |
| **distinct behaviour shapes** | **7** for 27 instruments | `InstrumentShape` |
| distinct `Modifiers` fields any passive can move | 13 | |
| instrument levels | 1–8 (7 steps) | `INSTRUMENT_MAX_LEVEL` |
| passive levels | 1–5 | `RIG_MAX_LEVEL` |
| fusion-result levels | seated at 3, never climbs | `FUSED_MAX_LEVEL` |
| slots | **4 instrument + 3 rig**, fixed all run | `STAND_SLOTS` / `RIG_SLOTS` |
| cards per offer | **4** | `OFFER_SIZE` |
| rerolls / banishes | 2 / 1 at start, +1 each per boss | |
| codex entries | 15, derived from `FUSIONS` | `discovery.ts` |
| persistence across runs | codex set + best score + chosen opener, in `localStorage` | |

Two doc corrections fall straight out of this. `docs/MASTER_PLAN.md:903` and
`docs/progression.md:10` both say **14** recipes and 26 instruments; the
PIZZICATO branch made it **15 and 27**. `discovery.ts`'s own header still says
"twelve authored evolutions and two named unions" and "Fourteen is a number a
player can hold in their head" — the code derives the count correctly, the prose
does not. Same file says "157" generic combinations; it is now **169**.

### Offer composition, re-measured

MEASURED — 400 seeds per row, pure `progression.ts`, one offer per level, two
policies (a committed builder that locks onto one recipe, and a random picker).
This is a cruder builder than `levelup.mjs` uses, so its fusion counts run lower;
the *composition* columns are the point.

| run | policy | offers | fusions/run | first fusion | levelup cards | new cards | **fusion cards** | grace |
|---|---|---|---|---|---|---|---|---|
| 5 min (L24) | builder | 23 | 0.87 | L21.2 | 61.8% | 37.3% | **0.9%** | 0.0% |
| 5 min (L24) | random | 23 | 0.01 | — | 72.4% | 27.6% | **0.0%** | 0.0% |
| 8 min (L34) | builder | 33 | 1.00 | L21.8 | 71.9% | 27.3% | **0.8%** | 0.0% |
| 15 min (L49) | builder | 48 | 1.85 | L21.8 | 75.9% | 22.7% | **1.0%** | 0.5% |
| 15 min (L49) | random | 48 | 1.22 | L38.6 | 77.1% | 20.3% | **2.4%** | 0.2% |

- **Offers containing a fusion card: 3.0–3.8% for a builder.** The most
  interesting card in the game appears in roughly one offer in twenty-seven.
- **Zero-novelty offers** (all four cards are +1 to something already held):
  **45.2% at 5 min, 58.0–58.2% at 8–15 min.** This corrects the figure
  MASTER_PLAN G0 is designed against — 91.9–97.2% — by roughly half. The 4+3
  fixed slots did most of that work. Consequence: **the ENCORE prestige tier and
  grace-card deletion in G0 are aimed at a number that has already halved**, and
  grace cards are 0.0–0.5% of dealt cards, so deleting them buys nothing.
- Distinct authored results seen across 400 builder runs at 15 min: **13 of 15**.

### `tools/levelup.mjs`, run today

```
TABLE      12 instruments  12 rig  15 fusions  15 recipes   branching: pizzicato x2
FUSION REACHABILITY (240 runs each)
  as-is  builder  any fusion 100%   fusions/run 3.27   maxed instruments/run 2.18   unions 1
  as-is  random   any fusion  98%   fusions/run 1.28   maxed instruments/run 1.49   unions 0
THE LAST CARD  as written 94% seen, worst wait 2 offers | no completes 79%, worst wait 3
```

The `unions` column counts only `requiem` and `stringsection` (`levelup.mjs:554`).
**One authored union across 240 committed-builder runs.** The comment at
`FUSED_MAX_LEVEL` claims "a committed player lands one in half their runs"; the
model says 0.4%. Either the comment is stale or the model is wrong about the top
of the tree — this is the single largest disagreement between the source's prose
and its own gate, and `combine.mjs` on a full-deps machine is what settles it.

### Power curve

MEASURED, nominal (`damage × count / interval`, before enemy armour and before
anything the world does to it):

- A single base instrument L1 → L8: **×6.2 mean** across the twelve.
- Opening loadout (PIZZICATO L1, no rig) → four fusion results at ceiling with
  three maxed rig items: **36 → 5,244 = ×144**.

×144 is a real power curve. **Nothing on screen reports it.** See gap 4.

### The finding that matters most

MEASURED, by walking `FUSIONS` and comparing each result's `shape` to its base's:

```
evolution pizzicato (seek)  + capo       -> spiccato      (seek)   SAME
evolution snare     (arc)   + rapid      -> blastbeat     (arc)    SAME
evolution bow       (beam)  + laser      -> harmonics     (beam)   SAME
evolution chime     (strike)+ resonance  -> carillon      (strike) SAME
... all 13 evolutions ...
union     chorale   (orbit) + cathedral  -> requiem       (aura)   DIFFERENT
union     harmonics (beam)  + crossstrung-> stringsection (arc)    DIFFERENT
```

**13 of 13 evolutions keep their base's shape.** `shape` is not decoration — it is
what `World` dispatches the firing routine on. The only two recipes that change
what the weapon *does* are the two unions, which fire in ~0.4% of runs.

`weapons.ts`'s own header, lines 27–29, states the design rule:

> **Evolution is the hook.** A maxed instrument plus its maxed catalyst fuses into
> something with a different verb, not a bigger number.

The table does not implement it. Every evolution in the shipped game is the same
verb with a bigger number.

And the generic side is worse: all 66 base duets are renormalised to **exactly
1.50×** the better parent's nominal dps (`synthesiseDuet`'s `target = 1.5 * max(...)`),
and every one keeps parent A's shape. So 66 combinations produce **7 behaviours at
one fixed power level**. There is no reason to prefer any pair over any other.

---

## 2. Vampire Survivors, mechanically

READ, from `vampire.survivors.wiki` (Evolution, Weapons, Passive Items, Level Up,
Arcana, Treasure Chest, Limit Break).

**Inventories.** Six weapon slots, six passive slots. Base game: ~22 weapons and
**21 passive items** (17 normal + 4 ring/metaglio). Weapons cap at level 8 (a few
at 6–7). Passives cap at 5, except Duplicator (2), Tirajisú (2), Torrona's Box (9)
and the rings/metaglios (9).

**Levels are behavioural.** A weapon level typically buys an extra projectile,
an extra pass-through, a longer duration, an extra bounce — not a percentage. The
percentages live on the *passives*, which is the split MusicWars copied correctly.

**Evolution.** Base weapon at max level **+** a specific passive in inventory
(usually needing to be maxed) **+** open a treasure chest, which drops from bosses
at or after 10:00 on most stages. Some stages relax the gate (Dairy Plant, Il
Molise, Cappella Magna, Boss Rash, Laborratory, Abyss Foscari, Hectic Highway:
any chest). Chests give 1, 3 or 5 items; the first six chests in a save are
scripted 1-1-3-1-1-5; Luck raises the odds of multi-item chests.

**Four evolution grammars, not one.**
- *Evolution*: weapon + passive → evolved weapon (Whip + Hollow Heart = Bloody Tear;
  Fire Wand + Spinach = Hellfire; King Bible + Spellbinder = Unholy Vespers; ~17 in base).
- *Union*: weapon + weapon → one weapon, **freeing a slot** (Peachone + Ebony Wings
  = Vandalier; Phiera Der Tuphello + Eight The Sparrow + Tirajisú = Phieraggi;
  Vento Sacro + Bloody Tear = Fuwalafuwaloo).
- *Gift*: conditions met → you receive an **additional** item, nothing is consumed
  (Victory Sword + Torrona's Box = Sole Solution; Candybox + everything = Super
  Candybox II Turbo).
- *Morph*: character transformation at level 80 with the right relics.

Crucially there are **branching and passive-free lines**: Bracelet → Bi-Bracelet →
Tri-Bracelet needs no passive at all, and Penshin Fatcha has **six** evolutional
branches plus a seventh when six+ are obtained. Clock Lancet takes *either* Silver
or Gold Ring. Laurel takes *either* Metaglio.

**Level-up offer.** Three options by default; a fourth appears with probability
`1 − 1/totalLuck`. Weighted draw with an explicit bias toward items already owned
(modulated by Luck and by whether the level is even or odd). **Reroll, Skip and
Banish are purchased PowerUps** in the meta-shop, so how much RNG control you have
is itself a progression axis. Skip **returns some experience**; MusicWars' skip
deliberately grants nothing.

**Arcanas.** 22 (+12 Darkanas). Hold up to **three** per run: one chosen at run
start, one from an Arcana Chest at 11:00, one at 21:00, each picked from four
offered with rerolls available. They are rule mutations, not stats — *Gemini*
duplicates listed weapons; *Twilight Requiem* makes expiring projectiles explode;
*Tragic Princess* reduces cooldown while moving; *Heart of Fire* makes projectiles
explode on impact. This is a **second, orthogonal build layer that costs no
level-up cards.**

**The chest is a slot machine, on purpose.** The developer took the animation from
slot games: everything pauses, rewards cycle past, a gold counter ticks up, special
music surges. The first six are unskippable.

**Numbers.** Gold displays to 9,999,999 and is internally capped at the float32
max; documented endgame runs report ~88 trillion total damage. **Limit Break**
(unlocked with Great Gospel) replaces a maxed build's gold/chicken cards with
per-stat weapon upgrades that stack indefinitely — the offer pool literally never
runs dry.

---

## 3. Ball x Pit, mechanically

READ, from `ballxpit.wiki.gg` (Balls, Passives, Buildings, Blueprints, Characters,
Fusion Reactor, Encyclopedia), the Steam store and discussion threads, ScreenRant's
launch-era recipe table, GameRant's Naturalist-update table, and seven reviews.
**Counts differ by patch** — the game has shipped Regal, Shadow and Naturalist
updates — so each is tagged with its era.

**Inventory.** **4 ball slots + 4 passive slots** by default, expandable to **5+5**
— but only through the base layer (*Bag Maker* = +1 ball slot, *Carpenter* = +1
passive slot, both blueprints dropping from the 7th of 8 pits). Beginner guides
call Bag Maker the single most impactful early building. Characters override the
split: *The Ballbearer* has double ball slots and **no** passives; *The Hoary
Hoarder* has 2 ball slots and turns the rest into passives, for up to 8.
*(One guide says the default is 3, against three review sources saying 4 —
unresolved, but 4 → 5 is the current consensus.)*

**Content (post-Naturalist, wiki.gg's own count).** **21 base balls** (14 default,
7 unlocked by clearing specific pits) + **69 authored ball evolutions** = **90
special balls**. **54 base passives + 17 evolved passives = 71.** At launch it was
18 base balls, 42 ball evolutions and 8 passive evolutions — so the recipe table
roughly doubled across three content updates. Recipes themselves are **never**
locked: all 69 are live from the first run; only your *knowledge* of them
progresses.

**Levels.** Balls and passives both go **1 → 3**, and 3 is the max. A level buys
damage and stronger ability parameters — projectile count comes from passives, not
from levels. **Level 3 on both parents is the only gate on combining.** The meta
layer shortens even that: *Evolution Chamber* makes new balls start at level 2,
*Relic Collector* the same for passives, and endgame players describe a state where
"balls start at level 3".

**The combination moment is a world drop, not a level-up card.** This is the single
most transferable fact in this document. Combining is triggered by picking up a
**Fusion Reactor**, a physical item dropped randomly by enemies and **always by
mini-bosses** (one player estimate: ~9 per level, ~3 per section). Picking it up
opens a modal offering up to three options:

| option | shown when | effect |
|---|---|---|
| **Fission** | always | 1–5 random levels (floor raised to 3 by patch) spread across your equipped balls and passives; pays **Gold** if everything is maxed |
| **Fusion** | you hold ≥2 unfused level-3 balls | pick two; they merge into one ball carrying **both** ability sets |
| **Evolution** | you hold every ingredient of some authored recipe at level 3 | lists which named results you are eligible to make |

So the decision is a real choice made by the player, **and it costs nothing from
the level-up offer.** Combining runs on its own clock. Level-up is a separate
channel entirely: **3 options** by default, 4 with the *Meditation Tent* building.
There is also always a consolation — Fission means picking up a Reactor is never
a dud.

**Slot economics.** Both Fusion and Evolution consume **all** parents and produce
one ball, so 2 → 1 (or 3 → 1, 4 → 1), freeing slots that refill from later
level-ups — and the consumed base types **re-enter the offer pool**. Structurally
the same as MusicWars' `applyFusion`.

**Tiers.** (1) base + base → evolved; (2) evolved + evolved, or evolved + base →
higher evolved (Satan = Incubus + Succubus; Armageddon = Inferno + Storm;
Nuclear Bomb = Bomb + Poison); (3) two ultimates only — **Nosferatu** (3 balls) and
**Elemental** (4 balls). Evolved balls can evolve and fuse again. **Fused balls are
terminal.** A ball cannot combine with itself. **Where an authored recipe exists the
game forces it and forbids generic fusion of that pair** — the same rule MusicWars
implements in `readyDuets` ("ARRANGEMENT OUTRANKS DUET"), arrived at independently.

**Recipes replace the verb, and say so in numbers.** Verbatim effect text:
Bomb (Burn + Iron) "explodes when hitting an enemy, dealing 150–300 damage to
nearby enemies"; Drill (Earthquake + Iron) "pierces enemies and deals 50% bonus
damage until reaching the back of the field"; Assassin (Iron + Ghost *or* Dark)
"passes through the front of enemies, but not the back — backstabs deal 30% bonus
damage"; Black Hole (Sun + Dark *or* Time) "instantly kills the first non-boss
enemy that it hits, but destroys itself afterwards"; Timestop (Time + Freeze)
"freezes everything on the field for 5.0 seconds but destroys itself after hitting
an enemy". **Every one is a different verb, and several are a different verb with a
downside attached.** Note also that Assassin and Black Hole each take *either* of
two catalysts — branching is built into the recipe grammar, as it is in Vampire
Survivors' Clock Lancet and Laurel.

**Passive × passive is a first-class system there.** 17 evolved passives, built
exactly like the ball recipes, including four-ingredient ones: *Deadeye's Cross* =
Diamond + Sapphire + Ruby + Emerald Hilted Daggers, which then feeds *Deadeye's
Impaler* = Deadeye's Cross + Gracious Impaler. **The half of the user's complaint
that MusicWars never built is a shipped system in the game it is being compared
to.**

**The generous fallback, and what it actually merges.** Any two *different* unfused
level-3 balls fuse, and the result **carries both parents' ability sets** — not a
stat blend. The wiki computes the space as 90 × 89 − 89 = **7,921 functionally
different fused balls**. Community phrasing: *"Fusion happens when 2 balls level 3
don't have a specific evolution, which turns them into a ball that has both balls'
properties."* Reviewers on the generous side: Nintendo World Report — "you can
combine every single ball you obtain at the very least once"; FullCleared — "you
don't have to build yourself into a corner if you don't have any compatible
evolutions."

**And the complaint, which is about power, not about stranding.** SirusGaming calls
the fusion system "restrictive" late on: *"if you are not going all-in on an
elemental set, vampire, or a baby ball build, you will suffer greatly."* Forbes
warns freestyle fusion risks "creating a bastardized ball that nerfs previous
effects." So the fallback exists but is **not equally good** as an authored recipe.
**This is the trap MusicWars avoided and then over-corrected into:** renormalising
every duet to exactly 1.50× makes them all equally good, and therefore all equally
uninteresting.

**Discovery.** An in-game **Encyclopedia** (Balls / Passives / Bestiary); filling it
earns the *Scholar* achievement. It is **retrospective, not prospective**: *"in game
will NOT show you all evolutions when selecting a ball, only ones you have
discovered"* — and once discovered it shows every path to that result (that Assassin
is Iron + Ghost *or* Iron + Dark). The only forward hint is an availability light:
the Evolution option simply appears in the Reactor modal when a complete recipe is
in hand. **This is exactly MusicWars' codex asymmetry** (`discovery.ts`: a discovered
row gives up its recipe, an undiscovered one gives up only its existence). That
design is already right and should not be touched.

**Numbers on screen.** Per-hit damage is displayed and **capped at 9,999** — the
developer's stated reason: "we couldn't think of a number higher." Typical strong
late hits land around 3,000; theoretical builds are quoted at 19,000–35,000.
**Damage numbers can be toggled off in settings** for readability, which is the
shipped answer to exactly the legibility objection MASTER_PLAN §5.3 raises. Levels
end with a **DPS report breaking down which of your balls did what.**

**Draft control is a meta axis.** *Meditation Tent* → 4 level-up options instead of
3. *Exorcist* → unlocks banish (players report a cap of 4). *Casino* → cheaper
rerolls; *Gambler's Den* → up to 4 free rerolls. *Gemsmith* → an extra ball pick at
battle start; *Antique Shop* → a passive pick at battle start. Both reference games
treat RNG control as something you invest in across runs.

**The base layer.** New Ballbylon: a grid town with 70+ buildings, 23 of them
character houses. Resources are Wheat / Wood / Stone / Gold, and **the harvest is
itself a ball-bounce minigame** — you launch workers into the town and they ricochet
through it collecting from whatever they touch, so layout is optimisation. Its
mechanical grip on the item system is precise: slots (Bag Maker, Carpenter), level
velocity (Evolution Chamber, Relic Collector, Jeweler), and draft control
(Meditation Tent, Exorcist, Casino, Gambler's Den, Gemsmith, Antique Shop).

**The pit.** A vertical lane; enemies march down in rows like a descending brick
wall. Balls are thrown upward, damage on every contact, and bounce off both enemies
and the side walls; **catching a rebound re-throws it immediately**, losing it
off-screen costs a cooldown. Late-run density is qualitative in every source — "a
million things pinging around the screen", "lights up like a Christmas tree" — and
is driven by spawner balls (Egg Sac, Brood Mother, Cell, Nosferatu "spawns a vampire
bat each bounce") rather than by the 4–5 slots.

Community advice is *"commit to ONE combination per run — a focused build with 2–3
maxed balls beats a scattered build with 7 level-1 balls."* That is precisely the
builder-versus-drifter axis MusicWars' offer bias is tuned around, which is evidence
the tuning is aimed at the right thing.

*(UNVERIFIED: whether the Evolution option shows full effect text before you
confirm; any hard on-screen ball count; and the 3-vs-4 default slot conflict.)*

---

## 4. The primitives, side by side

The claim of this table is that these are the mechanical properties that make a
combination system feel like a combination system. **Bold** marks where MusicWars
is materially behind.

| # | Primitive | Vampire Survivors | Ball x Pit | MusicWars |
|---|---|---|---|---|
| P1 | Two inventories, both binding | 6 weapons + 6 passives, full ~half-way through a 30 min run | 4+4 → 5+5, and the growth is **cross-run only** (Bag Maker / Carpenter) | 4 + 3, **fixed forever — stricter than both** |
| P2 | A level is a behaviour, not a % | yes (extra projectile, extra pierce) | no — levels are damage/parameters; **projectile count comes from passives** | yes — 42 of 84 base steps are additive/behavioural |
| P3 | **Combining changes the verb** | yes (Garlic aura → Soul Eater lifesteal; Runetracer → NO FUTURE explosions) | yes, always, and often with a downside (Black Hole one-shots then destroys itself) | **NO — 13/13 evolutions keep the base's `shape`; only the 2 unions differ** |
| P4 | Combination space **branches** | yes (Penshin Fatcha ×6; Clock Lancet takes either ring; Bracelet chain) | yes (Assassin = Iron + Ghost *or* Dark; Black Hole = Sun + Dark *or* Time) | **1 of 12 instruments branches; 1 of 12 passives serves two recipes** |
| P5 | Authored recipes vs base inputs | ~22 / 22 weapons | **69 ball + 17 passive / 21 balls + 54 passives** | **15 / 12 + 12** |
| P6 | Cheap entry to the combination system | max level 8 + maxed passive + a chest after 10:00 | **level 3 of 3, both parents** | level 8 of 8 + catalyst 5 of 5; duets at 6 of 8 |
| P7 | **Passive × passive combines** | no | **yes — 17 evolved passives, up to 4 ingredients** | **no — zero recipes. Half the user's complaint names a system that was never built.** |
| P8 | Nothing strands | no — a build with no recipe is stuck | yes — any two different L3 balls fuse | **yes — 169 generic pairs always combine** |
| P9 | Combining is **frequent** | 1–3 evolutions per 30 min run | many; ~9 Fusion Reactors per level, guaranteed from every mini-boss | 1.0 per 8 min, 1.85 per 15 min (model) |
| P10 | Combining is a **deliberate act on its own clock** | chest reveal — spectacle, but not a choice | **yes — the Fusion Reactor modal: you pick the pair, and it costs no level-up card** | it is a level-up card you must be *dealt*: 3.0–3.8% of offers, 0.8–1.0% of cards |
| P11 | The generic fallback merges **behaviour** | n/a | **yes — the fused ball carries BOTH parents' ability sets** (7,921 combinations) | **no — parent A's shape, max-of-stats, renormalised to exactly 1.50×** |
| P12 | Telegraphed in-run | implicit; the community wiki does it | availability light only (the Evolution option appears when a recipe is complete) | **yes — pause workbench + `completes` + 94% last-card delivery. Best of the three.** |
| P13 | A codex, retrospective by design | Collection screen | Encyclopedia; shows a recipe only after you have made it | **yes, same asymmetry, arrived at independently.** 15 rows; **excludes the 169 generic results** |
| P14 | Second reward channel outside level-up | treasure chests (1/3/5 items), floor pickups, gold | **Fusion Reactor drops, with Fission as a guaranteed consolation** | **none — every reward in the game is a level-up card** |
| P15 | Orthogonal run-modifier layer | **Arcanas: 3 per run from 22, rule mutations, zero card cost** | characters that rewrite the slot split (Ballbearer: 2× balls, no passives) | **none.** The 3 starters are the nearest thing; MASTER_PLAN G9 is the plan |
| P16 | RNG control is invested in across runs | reroll/skip/banish are meta-shop PowerUps; skip refunds XP | Meditation Tent (3→4 cards), Exorcist (banish), Casino/Gambler's Den (rerolls) | fixed 2/1, +1 each per boss; skip grants nothing, on purpose |
| P17 | Numbers grow enormously and **visibly** | 5–13 digit damage; Limit Break makes the pool unbounded | per-hit damage shown, **capped at 9,999**, and **toggleable off in settings**; a per-ball DPS report at level end | ×144 nominal growth and **no damage numbers at all** — a score popup on kill, capped at 14 on screen |
| P18 | Screen fills with your own output | yes, by ~minute 10 | yes — driven by spawner balls, not by slot count | `MAX_PLAYER_BULLETS = 400`; MASTER_PLAN notes CROSS-STRUNG already hits it silently |
| P19 | Pickups are physical objects you vacuum | XP gems; pickup radius is a passive | yes | yes — shards + MAGNET. Cap 320, **overflow silently dropped** (VS banks it) |
| P20 | Every run pays | gold, unlocks, Golden Eggs | the base, and it feeds slots / level velocity / draft control | **the codex set only; nothing mechanical carries** |
| P21 | The offer pool never dries up | Limit Break | Fission converts a maxed state into gold | grace cards — 0.0–0.5% of dealt cards, so not a live problem |

**Where MusicWars wins: P1, P2, P8, P12, P13.** The slot economy, behavioural level
steps, the no-stranding guarantee, the "one step away" telegraphing, and the
retrospective codex are as good as or better than either reference game — the codex
asymmetry in particular is the *same* design Ball x Pit shipped, arrived at
independently. The fix list below is written not to disturb any of them.

**The one structural difference that explains most of the rest is P10 and P14.**
Both reference games put combining on a **second clock** — a boss chest in Vampire
Survivors, a Fusion Reactor drop in Ball x Pit — so the combination decision does
not compete with the level-up draft for the player's attention or for a card slot.
MusicWars put it *on* the card. The reason is recorded and it is a good one
(`progression.ts:OfferOption.fusion`: fusions used to resolve silently on boss
defeat, so "the most interesting thing in the progression system happened TO the
player" — a random picker reached one in 61% of runs, which is another way of
saying the decision did not exist). But those are not the only two options. The
third — **the one both reference games actually use** — is a *choice*, made by the
player, in its own modal, on a clock that is not the level-up clock. That is the
only structural escape from the zero-sum offer pool that this document found, and
it is Gap 3.

---

## 5. The gaps, ranked by impact ÷ cost

### Gap 1 — Evolution does not change the verb *(highest impact, lowest cost)*

MEASURED: 13/13 evolutions produce a result with the same `shape` as their base.
The player spends thirteen picks (a base to 8, a catalyst to 5), watches a 3.6 s
celebration, and gets the same weapon with better stats and a new name. The
file's own header promises otherwise.

**Proposal.** Re-point 6–8 of the 13 fused rows at a *different existing* shape.
All seven routines are already implemented and dispatched on; this adds **no new
firing routine, no new id, no new card**. Candidates that keep the fantasy honest:

| recipe | today | proposed | reading |
|---|---|---|---|
| `chime + resonance → carillon` | `strike` → `strike` | `strike` → **`aura`** | one bell becomes a tower — a ring that rings outward, not five bigger strikes |
| `blackhole + compressor → downbeat` | `field` → `field` | `field` → **`strike`** | "the collapse lands on the one" — it should *land*, on something |
| `bow + laser → harmonics` | `beam` → `beam` | `beam` → **`arc`** | "the fundamental splits" — one beam into a fan |
| `drones + fermata → chorale` | `orbit` → `orbit` | `orbit` → **`aura`** | "the satellites stop moving and start singing" — the note says it already |
| `snare + rapid → blastbeat` | `arc` → `arc` | `arc` → **`orbit`** | a roll that never lands is a continuous ring, not a sweep |
| `echoes + timewarp → canon` | `seek` → `seek` | `seek` → **`field`** | the echo answers itself from where it was |

Note that in four of these the existing `line` and `character` strings *already
describe the new shape*. The prose was written to the design; only the `shape`
field was not.

**Files.** `src/game/weapons.ts` (the `shape` field and re-tuned `base` stats on
those fused rows — a strike's stats are not a beam's). No id moves, so
`src/audio/layers.ts`, `ENSEMBLE_MIX` and the director are untouched.
**Gates:** `levelup`, `mirror`, `wiring`, `builds`, and `tools/deadhunt-ranges.mjs`
— which exists precisely to catch a stat a routine never reads, and a shape change
is the exact way to create one (a `strike` ignores `speed`; a `beam` ignores `area`
differently; the CHIME incident recorded in `InstrumentShape`'s comment is this
bug happening once already).

**Conflicts:** none. MASTER_PLAN G5 warns that *new* shapes cost a fire routine +
container + render contract + dead-stat audit rows. This adds none of those.

---

### Gap 2 — Committing to an instrument is a lookup, not a decision

MEASURED: 1 of 12 instruments has two endings; 1 of 12 passives catalyses two
recipes. MASTER_PLAN §7 already names this ("here committing is a lookup") and the
PIZZICATO branch is the first fix, landed.

**Proposal.** Finish the job: give every base instrument a second catalyst drawn
from the **existing twelve** rig items, taking 13 recipes to ~24. This is the move
AGENTS.md §5 explicitly blesses — *"Reusing an existing passive as a second
catalyst does not [break the 12×12]"* — and `availableOptions` skips `def.fused`
outright, so **twelve new results add exactly zero cards to the draft pool**.

Pair each branch so the two endings split on a real axis, as SPICCATO/SNAP already
do (crowd-clear vs single-target: 630 vs 375 dmg/s). With Gap 1 landed, the two
endings should also differ in *shape*, so a branch is "which verb do I want",
which is the Ball x Pit decision.

**Files.** `src/game/weapons.ts` (12 rows in `FUSIONS`, 12 rows in `INSTRUMENTS`,
each with `character` + `line`), `src/core/events.ts` (`EvolvedId` union),
`src/audio/layers.ts` + `ENSEMBLE_MIX` (a lane per new id — this is the real cost),
`src/game/discovery.ts` (derives itself). `src/render/levelup.ts` needs no change
but **must be re-verified with `npm run mirror`** — the second copy of the fusion
rules lives there and the one-unknown-row-per-base dedupe was written for exactly
this case.

**Cost driver:** the audio side, not the game side. Twelve new timbres is real
work. A cheaper first slice is six branches, one per shape family.

**Conflicts:** none, and this is the recorded escape from the zero-sum trap.
Watch the metric that killed the last two attempts: designed fusions per run
(1.63 → 1.13 is what "worse" looked like) and the builder-vs-drifter ratio
(2.2× → 1.5×). Both are printed by `levelup`; `combine` is the real-run version.

---

### Gap 3 — The mixing moment is 1% of what the player sees, because it is competing for a card slot it does not need

MEASURED: fusion cards are **0.8–1.0% of all cards dealt**; **3.0–3.8% of offers
contain one**; the first fusion lands around level 21–22, which the pacing table
puts at minute 4–5 of a 15-minute run. The system is not undiscoverable — the
workbench and the `completes` flag are the best-executed part of the whole feature
— it simply **almost never happens**, and when it does it is one of four things
competing for one pick.

**The proposal: give combining its own clock — the CADENZA.**

Vampire Survivors gates evolution on a boss chest. Ball x Pit gates it on a Fusion
Reactor drop, and the modal it opens is a *choice* (Fusion / Evolution / Fission),
not a reveal. Neither game spends a level-up card on it. MusicWars is the only one
of the three that does, and AGENTS §5's zero-sum rule is the direct consequence.

MusicWars already owns the clock and is not using it. `onBossDefeated` currently
pays **+1 reroll and +1 banish and nothing else** — slot growth was removed and
fusion resolution was moved to the card, so the biggest musical event in the game
now hands out two small tokens. Replace that with a **cadenza**: on boss death, a
modal opens on a bar line listing every combination that is ready *right now* —
authored evolutions first, then duets, then unions, using `readyFusions` and
`readyDuets` verbatim — plus one always-present fallback. The player picks one, or
takes the fallback.

This is not the reverted design. The reverted design **resolved every ready fusion
automatically** ("the most interesting event in the progression system arrived as a
notification"; a random picker reached one in 61% of runs). A cadenza is a choice,
it is exclusive (you take one, the others' inputs are still spent or still waiting),
and it is on a clock the player earns. It satisfies every reason the card exists
while costing the level-up offer **nothing**.

- **It adds no card type to the level-up offer.** AGENTS §1 and §5 are satisfied
  literally: `availableOptions` loses its fusion branch entirely, which *returns*
  weight to the base and catalyst cards a builder needs. That is the opposite of
  dilution.
- **The fallback is the Fission lesson.** Ball x Pit's Reactor is never a dud: if
  you cannot combine, it pays 3–5 random levels across what you hold. MusicWars'
  grace cards do this job today at 0.0–0.5% of dealt cards, which is nothing. Move
  them here, where they are the *floor* of a guaranteed reward rather than padding
  on a card that had nothing better.
- **The bar-line requirement is already solved.** Offers open on a bar line and
  stop the world while the transport runs (`world.ts`, the offer block;
  `Emitter.delayBy` absorbs the held beats). A cadenza is the same mechanism.
- **The presentation already exists.** `LevelUpOverlay.celebrate` draws the fusion
  payoff today (3.6 s, 6.2 s for a union). The modal is a list plus that.

**Files.** `src/game/progression.ts` (`onBossDefeated` returns the ready set;
remove the fusion branch from `availableOptions`; a `chooseCadenza(state, i)` beside
`chooseOption`), `src/game/world.ts` (open it on the boss-death bar line, same path
as the offer), `src/render/levelup.ts` (**the mirrored copy of the fusion rules —
`npm run mirror` is mandatory**), `src/core/events.ts` (one event).

**Gates.** `levelup` (fusions/run and the builder-vs-random gap must both improve
or hold), `combine` on a full-deps machine, `builds.mjs` policy spread (the number
that killed the last two offer-shape experiments), and `mirror`.

**The obvious risk, stated plainly:** MusicWars has 6 bosses across waves 4–24, so
a cadenza clock delivers ~6 opportunities per long run against Ball x Pit's ~9 per
*level*. If bosses are the only trigger this may be *fewer* combination moments,
not more. The fix is to also drop a cadenza on elite/mini-boss kills, which
MASTER_PLAN G2 is adding anyway ("elite emitter-variants … every 3–4 waves past 9").
**Measure the moment count before and after; this proposal is worthless if it does
not raise it.**

**Two cheap levers to run first, independently, since they are single constants:**

1. **Lower the entry price, not the payoff.** Ball x Pit fuses at **3 of 3**;
   MusicWars asks 8 of 8 plus 5 of 5. Try catalyst-at-3 for evolutions (the base
   stays at 8 — that is where the investment reads) and `DUET_INPUT_LEVEL` 6 → 5.
   This continues a move already made and measured: it went 8 → 6 because "a core
   verb that does not exist for the first half of the game is not a core verb", and
   the same sentence argues for 5. Guard rail is the builder-vs-random gap (98% vs
   26% real-run) — if random converges on builder, the choosing has stopped being
   the game, and that failure condition is already written down.
2. **Raise `OFFER_TUNING.fusion` from 6.0** (only relevant if the card is kept).
   MASTER_PLAN §7 measured that with two branches ready, **neither is shown 12.4%
   of the time**. Pure weight change; measure "neither shown" and policy spread
   together.
3. **Reserve a card position rather than adding one.** *Conflicts with a measured
   finding — see §7(a).*

---

### Gap 4 — ×144 power growth, invisible

READ + MEASURED: `grep floatingText|damageNumber` over `src/` returns nothing.
`World.popups` exists and is drawn (`renderer.ts:drawPopups`), but it carries
**score**, capped at 14 on screen, pushed only on kill. Meanwhile nominal player
output goes 36 → 5,244 over a built run. Vampire Survivors' entire dopamine
architecture is the number getting absurd where you can see it. **So is Ball x
Pit's**: per-hit damage is displayed, hits 3,000 routinely, and is capped at 9,999
only because the developer "couldn't think of a number higher." Both reference games
put the growth on the screen; MusicWars puts a score popup there instead.

**Proposal.** Reuse the popup channel that already exists rather than building a
new one:
- Aggregate damage **per enemy per ~250 ms** and emit one popup when the
  accumulator crosses a fraction of that enemy's max HP. Keeps the 14-popup cap
  meaningful and stops 100 numbers/second.
- A HUD readout of `World.ensembleDps()` (`world.ts:3971` — it exists and nothing
  renders it), framed as the band's output, next to the existing combo multiplier.
- **Bank the shard overflow.** MASTER_PLAN G2 already specifies this (cap 320,
  overflow silently dropped today; VS's 400-gem law banks it into one growing
  jackpot gem). Three lines, bounded entity count, and it is a *visible* number.

**Files.** `src/game/world.ts` — and note the real cost: **damage is applied in
eight separate places** (`:1311, :1388, :1441, :2429, :2617, :2702, :2740, :3629`),
with no `hurt(enemy, amount, source)` chokepoint. Introducing one is a prerequisite
and is worth doing on its own merits. Then `src/render/renderer.ts` (`drawPopups`
already handles text, hue, big/small) and `src/render/hud.ts`.

- **A per-instrument damage breakdown on the run summary.** Ball x Pit ends every
  level with a DPS report naming which ball did what; MusicWars' summary already
  reads back keys visited, grooves heard and peak section. Adding "what your band
  actually played" is the same gesture and closes the loop on a build the player
  spent fifteen minutes assembling. Cheapest item in this gap.

**Files.** `src/game/world.ts` — and note the real cost: **damage is applied in
eight separate places** (`:1311, :1388, :1441, :2429, :2617, :2702, :2740, :3629`),
with no `hurt(enemy, amount, source)` chokepoint. Introducing one is a prerequisite
and is worth doing on its own merits (it is also what a per-instrument breakdown
needs). Then `src/render/renderer.ts` (`drawPopups` already handles text, hue,
big/small) and `src/render/hud.ts`.

**Conflicts:** MASTER_PLAN §5.3 forbids illegibility-as-victory, and the renderer's
history is a strobe incident — four of five beat-responders were removed so bullets
read cleanly. Damage numbers are exactly the kind of thing that breaks that.
**Ball x Pit's shipped answer is a settings toggle**, plus a hard display cap at
9,999 ("we couldn't think of a number higher"). Take both: aggregate per enemy per
250 ms, keep the existing 14-popup cap, cap the glyph width, and put it behind an
option. `tools/legibility.mjs`, `contrast.mjs` and `flicker.mjs` gate it.

---

### Gap 5 — 66 duets, 7 behaviours, one power level

MEASURED: every generic base duet is renormalised to **exactly 1.50×** the better
parent's nominal dps, and takes parent A's shape. So 66 combinations produce seven
behaviours at one fixed power level.

**The reference implementation is one line of design.** Ball x Pit's generic fusion
— the *fallback*, not the authored recipes — produces a ball that **carries both
parents' ability sets**. Burn's burn *and* Iron's pierce, on one ball. It is a
behavioural union, not a stat blend, and that is why 7,921 unauthored combinations
stay interesting. MusicWars takes the max of each stat field and throws both
behaviours away.

The two reviewer complaints about Ball x Pit's system are also instructive, because
MusicWars has over-corrected past one of them: a generic fusion there is valid but
**weaker** than an authored recipe, so late-game play collapses onto the named
chains. MusicWars renormalised that away — every duet is *exactly* 1.50× — which
removes the trap and installs a different one: **there is no reason to prefer any
pair over any other pair.** The answer is not to un-normalise the number (that guard
is measured; see below) but to make the *behaviours* differ.

**Proposal — a pared-down G4.** MASTER_PLAN G4 specifies riders indexed **per
pair** (66 authored signatures) and explicitly rejects shape-indexed riders because
they collapse to ≤25 distinct behaviours. There is a middle: **index the rider on
the SECOND parent's id only** — twelve authored riders, applied to whichever of the
seven shapes parent A brings. That is 12 × 7 = **84 distinguishable outcomes from a
twelve-row table**, above G4's own stated bar, at a fifth of the authoring. Keep
G4's per-pair exceptions (6–10 trophy discoveries) on top. Read the rider as "what
the second player brings to the stand", which is the Ball x Pit rule — both
parents' behaviour, one object — expressed in twelve rows instead of 7,921.

Concretely, a rider is a trigger + an effect: `× SNARE` = on-hit knockback pulse;
`× NOVA` = on-expiry mini-nova; `× TREMOLO` = leaves a pool where it dies;
`× ECHOES` = on-wall, splits. The invariant G4 asks for still holds if stated as
*no two duets share (shape, rider)*.

**Files.** `src/game/weapons.ts` (a `RIDERS` table + `synthesiseDuet` writing a
`rider` field and a label/blurb that names it), `src/game/bullets.ts` +
`src/game/world.ts` (one dispatch at hit / expiry / wall), `src/game/discovery.ts`
(extend the codex to generic results — G4 already says discoveries the collection
cannot record are not discoveries). **Raise `MAX_PLAYER_BULLETS` (400) in the same
change**, per G4.

**Keep** the 1.5× renormalisation. It is a measured guard: before it,
`PIZZICATO × SNARE` came out at 794 dps against parents of 225 and 86, and
`CHIME × PIZZICATO` reached 4.3×. Spend the spectacle in the rider, not the number.

---

### Gap 6 — Passive × passive does not exist

READ: zero recipes combine two RIG items. This is literally half of the user's
sentence, and it is **not** a gap against Vampire Survivors (which has no
passive×passive either) — it is a gap against **Ball x Pit, which ships 17 evolved
passives built on the same grammar as its ball recipes, including four-ingredient
ones** (Deadeye's Cross = Diamond + Sapphire + Ruby + Emerald Hilted Daggers, which
then feeds Deadeye's Impaler). So the complaint has a concrete referent.

MASTER_PLAN G3's **RACKS** is the designed answer (two maxed rigs → one rack in one
slot, both effects at ~75%, a slot freed, the consumed rigs can no longer catalyse).

**Proposal.** Ship it, and note three things the plan does not:
- A rack card is a **fusion card**, a type that already exists. It is not a new
  card *type* — but it **is** a new entry in `availableOptions`, so it competes in
  `draw()` and the zero-sum rule still bites. **If Gap 3's cadenza lands first this
  problem disappears**: racks go on the cadenza list beside evolutions and duets,
  and cost the level-up offer nothing. That is the right sequencing.
  Otherwise, measure designed-fusions-per-run before and after; 1.63 → 1.13 is the
  shape of the failure to watch for.
- Ball x Pit's passive recipes take **up to four ingredients**. With only 3 rig
  slots, MusicWars can support two-ingredient racks and nothing more — which is
  fine, but it means the rack table is at most C(12,2) = 66 pairs and realistically
  8–12 authored families. Do not plan for a passive tree.
- Racks must not eat catalysts the player is pursuing. `sacrificeFor` already
  protects catalysts via `catalysesPursued`; the rack's ready-check needs the same
  guard, or finishing one plan silently cancels another — a bug this codebase has
  already written the fix for once.

**Files.** `src/game/weapons.ts` (`RACKS` table, `rigModifiers` fold),
`src/game/progression.ts` (`readyRacks` beside `readyFusions`; generalise
`applyFusion`, which is deliberately the single place the books are mutated),
`src/render/levelup.ts` (**the mirrored copy — `npm run mirror` is mandatory**),
`src/game/discovery.ts`. The ~75% magnitude is an open decision (MASTER_PLAN §6.5)
awaiting the 60k-offer sim, which `levelup.mjs` already runs.

---

### Gap 7 — The top of the tree never fires

MEASURED today: **1 authored union across 240 committed-builder runs** at the
as-is income (`levelup.mjs`, `unions` column, which counts only `requiem` and
`stringsection`). The comment on `FUSED_MAX_LEVEL` claims a committed player lands
one in half their runs. One of those two is wrong.

Cause is structural: a union needs two *authored evolutions* held simultaneously
in four slots, each costing thirteen picks. Nothing about the union's own
requirements (possession, level 1) is the obstacle — that was already relaxed and
measured.

**Proposal, in order of cost:**
1. **Land Gap 2 first and re-measure.** Doubling the recipe count roughly doubles
   the chance any given maxed instrument has a reachable ending, which is the input
   to a union. This may be the whole fix, and it costs nothing extra.
2. **Let an authored evolution union with a generic duet.** Today
   `readyDuets` blocks it with `if (duetParents(a) || duetParents(b)) continue`,
   and the comment says why: *"a duet of duets would need `synthesiseDuet` to
   resolve a synthesised parent, which it does not do yet."* That is an
   **implementation limit, not the tier rule** — the tier rule is
   `aFused !== bFused`, and a duet is already `fused: true`. One level of recursive
   resolution in `synthesiseDuet` plus relaxing the guard to allow one level of
   nesting opens the union tier without crossing a tier. **Files:**
   `src/game/weapons.ts`, `src/game/progression.ts:readyDuets`,
   `src/render/levelup.ts:pendingFusions` (the mirror).
   *This one needs the AGENTS §5 tier rule re-read before it is written — see §7.*

---

### Gap 8 — No orthogonal build layer, and no reason to play twice

READ. Vampire Survivors gives three **Arcanas** per run — rule mutations chosen
from four, at run start / 11:00 / 21:00 — that cost **zero level-up cards**. That
is the cleanest known answer to a zero-sum offer pool: put the second build axis
on a different clock. MusicWars' nearest equivalent is the three starters.

MASTER_PLAN covers the pieces (G8 meta, G9 performers) and consciously rejects
Ball x Pit's base-building (§5.10). Nothing here argues with that — and the Ball x
Pit research strengthens the rejection, because that base layer is a *second game*
(a grid town, four resources, a bounce-physics harvesting minigame, 70+ buildings).
What it does **not** support is throwing out what the base layer *does*: in Ball x
Pit the meta touches the item system in exactly three places — **slots**,
**level velocity**, and **draft control** — and all three are one persisted integer
each. None of them requires a town.

Two narrower observations:

**(a) The boss is an unused reward clock.** `onBossDefeated` pays +1 reroll and +1
banish and nothing else, having had slot growth and fusion resolution taken away
from it. If Gap 3's cadenza takes that clock, a run-mutator choice can share it or
alternate with it. Either way it is an Arcana layer that costs the level-up offer
nothing, reusing `LevelUpOverlay.celebrate`.

**(b) Ball x Pit's characters are MASTER_PLAN G9, already validated.** *The
Ballbearer* has double ball slots and **no passives at all**; *The Hoary Hoarder*
has 2 ball slots and up to 8 passives. G9's "soloist (3 instrument slots, +1 rig,
faster fusion thresholds)" is the same move, and the reference game shows the
mutation can be far more extreme than that without breaking.

A second observation from the Ball x Pit side, which resolves an apparent
contradiction: MusicWars removed in-run slot growth and the measurement behind
that is sound (3+3 growing to 6+6 meant both banks were full by character level
10–11 and 91.9–97.2% of later offers held nothing new — *"a cap only creates
decisions while it binds"*). Ball x Pit agrees: its slots **never** grow inside a
run. But it grows them **across** runs, via the Bag Maker building, and beginner
guides call that the biggest early power spike in the game. So "4+3 forever, in
every run you will ever play" is stricter than either reference game.
**Cross-run slot growth is the one form of slot growth no measurement in this
repo argues against**, and it is the cheapest possible answer to "every run pays"
— one persisted integer read by `createProgression`, capped at 6+5 so the cap
never stops binding. Files: `src/game/progression.ts` (`STAND_SLOTS`/`RIG_SLOTS`
become a floor plus an unlock), `src/main.ts` (persistence, beside the codex).

Ranked last here only because it does not fix "the item mechanics feel wrong
*during* a run", which is what the complaint says.

---

## 6. Ranking summary

| rank | gap | impact | cost | conflicts |
|---|---|---|---|---|
| 1 | **Evolutions change the verb** (P3) | very high | **S — data only, no new routine, no new card** | none |
| 2 | **Branch every instrument** (P4/P5) | very high | M — the audio lanes dominate, not the game code | none; explicitly blessed by AGENTS §5 |
| 3a | Gap 3 levers 1–2: lower the entry price, raise the weight (P6/P9) | high | **S — two constants** | none |
| 3b | **The CADENZA — move combining to its own clock** (P10/P14) | very high | M | reframes a reverted design; see §7(h) |
| 4 | Damage numbers, banked overflow, per-instrument run summary (P17/P19) | high | M — needs a `hurt()` chokepoint first | §5.3 legibility; answer is BxP's toggle + cap |
| 5 | Duet riders, id-indexed on parent B (P11) | very high | M–L | narrows MASTER_PLAN G4's design |
| 6 | RACKS — passive × passive (P7) | high | M | zero-sum unless 3b lands first |
| 7 | Make unions reachable (P5 top tier) | medium | S after #2 | tier rule, see §7(d) |
| 8 | Boss-timed run mutators; cross-run slots (P15/P20) | medium | M | none |

If only one thing is done: **Gap 1**. It is a data change, it takes an afternoon,
and it makes the game's own stated design promise true for the first time.
If two: **Gap 1 + Gap 2**. Together they turn "which catalyst arrives" into "which
of two verbs do I want this instrument to become", which is the Ball x Pit decision
and the Vampire Survivors decision at the same time.

---

## 7. Conflicts with recorded measurements

Flagged explicitly, per the brief.

**(a) "Reserve a fusion position in the offer" — conflicts, directly.**
`progression.ts:weightOf` records two tried-and-reverted attempts: forcing fusion
cards into every offer put them at index 0, and the leftmost card is the habitual
pick for a human and for every bot in `tools/`, so a random picker reached a fusion
in **100%** of runs; shuffling positions afterwards fixed that and collapsed
`builds.mjs`'s policy spread from **0.37 to 0.12**. *Route around it:* the untried
variant is a **stable non-leftmost** reservation — always position 4, never
shuffled — which preserves what `first` and `last` mean while making a ready fusion
always visible. It must be gated on both numbers that killed the earlier attempts
(random-picker fusion rate, and `builds.mjs` policy spread), not just one. Until
that is measured, prefer levers 1 and 2 in Gap 3, which are pure constants.

**(b) "Let evolved instruments level" — do not re-propose.** AGENTS §5 and
`applyFusion`'s comment both record it: designed fusions per run **1.63 → 1.13**,
builder-vs-drifter **2.2× → 1.5×**, at three different draw weights, same direction.
Nothing above depends on it. `FUSED_MAX_LEVEL = 3` seating is the accepted
substitute and it is load-bearing for the union tier.

**(c) "Add a thirteenth passive" — do not.** AGENTS §5: the 12×12 is deliberate,
a thirteenth breaks the symmetry and is preferentially spent by `sacrificeFor`.
Gap 2 and Gap 6 are both written to reuse the existing twelve.

**(d) "Combine across tiers" — Gap 7 lever 2 sits on the line.** AGENTS §5 says
*"Two base instruments make a duet, two evolved make a union, a mixed pair makes
nothing"*, and the measurement behind it is real: admitting evolved-plus-base pairs
took designed fusions **1.63 → 1.13** while duets went **4 → 9**. The proposal here
is **not** that — it is duet-plus-evolution, which is *within* tier two by the
code's own `aFused !== bFused` test, and it is blocked only by
`synthesiseDuet`'s inability to resolve a synthesised parent. It should still be
measured against the same metric before it ships, because "widening tier two"
is exactly the shape of the failure that rule was written to stop.

**(e) "Slot-machine chest rituals" — rejected by MASTER_PLAN §5.6.** Vampire
Survivors' chest is one of its two biggest spectacle beats and the developer copied
it from slot games deliberately. The plan rejects it and substitutes
bar-line-quantised rewards. Gap 3b is careful about this distinction and it matters:
**a Fusion Reactor modal is not a slot machine.** VS's chest is a *reveal* — the
outcome is already decided and the animation is theatre. Ball x Pit's Reactor is a
*choice* — three named options, you pick. The cadenza proposal is the second kind.
Gap 4 likewise asks for a bigger *number*, not a bigger *ritual*.

**(f) "Add a card type" — AGENTS §1 and §5, absolute.** Every proposal above is
either data (Gaps 1, 2), a constant (Gap 3 levers 1–2), a **removal** from the
level-up pool (Gap 3b moves the fusion card off it), a non-offer surface (Gap 4), a
change to what an existing card resolves into (Gap 5), or an entry in an existing
card type — and Gap 6 becomes free if 3b lands first. Gap 8 puts its choices on the
boss clock, not the level-up clock.

**(h) The cadenza reframes a design that was deliberately reverted — read this
before writing it.** `progression.ts:OfferOption.fusion` records: *"Fusions used to
fire by themselves the moment their inputs were both at max, resolved in a batch on
boss defeat. That made the most interesting thing in the progression system
something that happened TO the player: measured, picking cards at random reached a
fusion in 61% of runs, which is another way of saying the decision did not exist."*
And `onBossDefeated`: *"A boss no longer fuses FOR you."* The cadenza is the third
option, not a return to the first: **the boss opens a menu, it does not resolve
anything.** The player still chooses which pair to spend and still loses the
alternatives. The check that decides whether it worked is the same one that
condemned the batch resolution — **a random picker must not reach a fusion much more
often than it does today** (`levelup.mjs` prints it; `combine.mjs` is the real-run
version). If a random picker's fusion rate jumps toward a builder's, the cadenza has
recreated the bug and should be reverted like its predecessor.

**(g) A doc/code disagreement worth resolving before anyone plans against it.**
`FUSED_MAX_LEVEL`'s comment says a committed player lands a union in half their
runs; `levelup.mjs` today prints **1 union in 240 builder runs**. And
MASTER_PLAN G0 says the reroll/banish stale-card bug is live at `world.ts:2834`
and `:2970` — **it is not, in today's source.** Both `World.applyOfferInput`
(`world.ts:2853–2861`) and `World.rerollOffer` / `banishOffer`
(`world.ts:2993–3001`) call `this.emitOffer(next)`. That item can be struck from G0.

---

## 8. What is not measured, and should be before anything ships

- Everything world-shaped. `combine`, `builds`, `arena`, `decisions` **could not
  run here** (`@strudel/mini` missing). Every fusion-frequency number above is from
  the pure model, and this repo has already recorded that the model and real play
  disagree by a lot. **`npm run combine` is the gate for Gap 3.**
- Whether the ×144 nominal power curve is what the player experiences. It ignores
  enemy armour, overkill, uptime and accuracy. `tools/ttk.mjs` is named in
  `docs/progression.md` as broken against the instrument system (it reads
  `player.weapon()`, which no longer exists) — that is a prerequisite for judging
  Gap 4 honestly.
- Whether 400 player bullets is a ceiling being hit in real play. MASTER_PLAN says
  CROSS-STRUNG spawns are already being dropped silently; nothing counts them.
- The **number of combination moments per run**, which is the metric Gap 3b lives
  or dies by. Nothing counts it today. Six bosses across waves 4–24 against Ball x
  Pit's ~9 Fusion Reactors *per level* is the comparison to beat, and if the cadenza
  clock delivers fewer opportunities than the card does, the proposal is wrong.
- Whether any of it is fun. `docs/progression.md`'s own last line still applies:
  every number here comes from a bot.

---

## 9. Sources

Vampire Survivors: [Evolution](https://vampire.survivors.wiki/w/Evolution),
[Weapons](https://vampire.survivors.wiki/w/Weapons),
[Passive Items](https://vampire.survivors.wiki/w/Passive_Items),
[Level Up](https://vampire.survivors.wiki/w/Level_Up),
[Arcana](https://vampire.survivors.wiki/w/Arcana),
[Treasure Chest](https://vampire-survivors.fandom.com/wiki/Treasure_Chest),
[Limit Break](https://vampire-survivors.fandom.com/wiki/Limit_Break),
[Gold Coin](https://vampire-survivors.fandom.com/wiki/Gold_Coin_(currency)),
[design analysis](https://www.kokutech.com/blog/gamedev/design-patterns/power-fantasy/vampire-survivors).

Ball x Pit: [wiki.gg](https://ballxpit.wiki.gg/wiki/BALL_x_PIT_Wiki) (Balls,
Passives, Buildings, Blueprints, Characters, Fusion Reactor, Encyclopedia),
[Steam store](https://store.steampowered.com/app/2062430/BALL_x_PIT/) and its
discussion boards, [ScreenRant's launch recipe
table](https://screenrant.com/ball-x-pit-evolution-list-balls-passives-combos/),
[GameRant's Naturalist
table](https://gamerant.com/ball-x-pit-naturalist-update-new-balls-passives-evolutions/),
[Dexerto](https://www.dexerto.com/wikis/ball-x-pit/all-evolution-recipes-combinations/),
[Stevivor](https://stevivor.com/guides/ball-x-pit-ball-evolutions-guide-all-ball-combinations/),
[TheGamer](https://www.thegamer.com/ball-x-pit-complete-guide/).
Reviews: [SirusGaming](https://sirusgaming.com/ball-x-pit-review/),
[TheSixthAxis](https://www.thesixthaxis.com/2025/10/15/ball-x-pit-review-sphere-factor/),
[FullCleared](https://fullcleared.com/reviews/ball-x-pit-review/),
[Nintendo World Report](http://www.nintendoworldreport.com/review/72918/ball-x-pit-switch-review),
[Forbes](https://www.forbes.com/sites/mattgardner1/2025/10/18/ball-x-pit-review-a-surprise-indie-goty-contender/),
[DearGamers](https://www.deargamers.net/reviews/ball-x-pit-review).

Blocked and therefore not used: gamefaqs.gamespot.com (403 — its guide is the only
source claiming 3 default ball slots, hence that conflict is unresolved),
ballxpit.org, ballxpitguide.com, pcgamer.com (paywall), the Ball x Pit Fandom
mirrors.
