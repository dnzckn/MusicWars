# Refactor 3: sixteen weapons, slots and elites, and giving the screen back

The owner's brief, in seven parts: items still are not interesting; 4+4 slots
that free up as you combine, ~16 weapons and a full factorial of combinations;
enemies stop shooting and damage only by touch; weapon descriptions that state
damage and effect so a player can reason; the view should expand to the
available screen; elites drop weapons while trash gives XP; delete the music
visual; replace the sidebar with a clean overlay HUD.

And the fair question underneath: *"i thought you looked up vampire survivors
and ball x pit, why did none of that make it into this game?"*

---

## 0. Answering that question first, because it determines everything below

The research happened. `docs/research-weapons.md` classified both games by
mechanical verb and the resulting work built **delivery geometries** — seek,
lance, cone, spray, chain, mortar, trail — and later **musical timing**. Both
passes were real, and both produced a roster the owner found boring.

**The first draft of this section got the reason wrong too**, and the correction
is the most important sentence in this document. It claimed the missing piece was
a status-effect vocabulary — fire burns, ice slows, lightning chains — and
proposed a `4 families × 4 elements` grid. The owner's answer:

> *"those games status effects arent the biggest impact, they just have rich
> weapon diversity that makes it interesting"*

That is right, and the grid would have been **the same mistake a third time**.
Fourteen delivery shapes produced fourteen ways of saying "damage happens near
enemies". Sixteen `family × element` cells would produce sixteen samey weapons
wearing modifier tags. A systematic axis makes a roster *enumerable*, not
*interesting*.

**What actually makes those rosters good is that each weapon has an identity you
can picture from one sentence, and no two are the same kind of thing.**

> Runetracer ricochets forever and accelerates every bounce.
> Santa Water carpet-bombs random spots around you.
> King Bible orbits your body.
> Pentagram deletes everything on the screen.
> Garlic is a stink cloud that shoves things off you.
> Clock Lancet freezes a line and deals nothing.

Not one of those is a variant of another. They are not points on a grid; they are
**sixteen separate ideas**, hand-authored, and the variety is the content rather
than a property of the content. Ball x Pit is the same: its balls are individually
characterful and its fusions produce genuinely new balls, not "both parents'
tags".

**So: hand-author sixteen weapons, each picturable in one line, each mechanically
unlike the other fifteen.** Effects like burn and chill still exist — they are
useful supporting vocabulary and some weapons will carry them — but they are
NOT the organising principle and no weapon is defined by one. The organising
principle is that every weapon is its own idea.

This is more work than a grid. That is the point; the grid was cheap and would
have failed.

---

## 1. Two pairs of asks that are secretly one ask each

### 1a. "The screen is too small" is the HUD, not the world

The world is already 3000×3000 with a follow camera. What is small is the
**viewport**: `#app` is a flex row where the sidebar takes roughly 40% of the
window, and `VIEW_W/VIEW_H` are hardcoded at 900×1120 — a portrait strip on a
landscape monitor.

Deleting the sidebar and making the view responsive is therefore **one change
that satisfies three of the seven asks at once**: kill the music visual, replace
the sidebar with an overlay, and give the player the screen. Roughly **+70%
horizontal playfield** on a 1512px window before any world change at all.

Stages 1–3 of the arena refactor already did the hard part: `VIEW_W/VIEW_H` are
separated from `PLAYFIELD_W/H`, every render- and UI-side reference reads the
view, and `WarpGrid.draw` clips to a view rect. **Making the view dynamic is now
a matter of feeding it different numbers**, which was the whole point of doing
that work as a no-op.

### 1b. "Enemies stop shooting" pays for "more enemies"

`MAX_ENEMY_BULLETS = 3000`, against a measured peak of 186 on screen. Removing
enemy fire deletes a whole subsystem — the pool, its update, its collision
sweep, its rendering, `Emitter` specs on every archetype, the telegraph, the
graze mechanic that exists to reward near-misses of bullets that will no longer
exist.

That is a large frame and simulation budget handed straight to enemy count. The
two asks fund each other, and they should land in the same phase so the
measurement is honest: density rises into a budget that just got cheaper.

**It also finally settles the genre.** This codebase's whole history is a
vertical bullet-hell converted to an arena. Contact-damage-only is the last
shmup organ, and removing it is what makes it a survivors-like rather than a
survivors-shaped shmup.

---

## 2. Sixteen weapons, sixteen ideas

The test for every entry: **can you picture it from one sentence, and is it
unlike the other fifteen?** If two rows could be described by the same sentence
with a word swapped, one of them is not pulling its weight.

Draft roster. It is a starting point for argument, not a specification — the
owner should cut the ones that do not appeal, because "does this sound fun"
is the only test that matters here and no tool in this repo can run it.

| # | weapon | the one sentence |
|---|---|---|
| ~~1~~ | ~~RICOCHET~~ | one bolt that never stops bouncing and gets faster with every wall it hits |
| 2 | **METRONOME** | fires only on the downbeat, for an enormous volley |
| 3 | **DRUM FILL** | carpet-bombs random spots around you, faster the longer you hold still |
| 4 | **THUNDERSHEET** | strikes random enemies on screen with no projectile at all |
| 5 | **HARP GLISS** | a cascading wall of bolts that sweeps the whole field once |
| 6 | **DRONE PODS** | pods orbit your body and eat one enemy each |
| 7 | **FEEDBACK** | a short shotgun cone, murderous inside arm's length and useless past it |
| 8 | **BLACK HOLE** | drags everything toward one point and crushes what arrives |
| 9 | **SIREN** | a beam that sweeps a rotating line around you like a lighthouse |
| 10 | **CANON** | every shot you fire is repeated a beat later, in the same place |
| 11 | **TIMPANI** | one enormous slow shockwave you can see coming |
| 12 | **SUSTAIN** | a damage aura that grows the longer you do not move, and resets if you do |
| 13 | **PIZZICATO SWARM** | dozens of tiny fast bolts, individually pathetic |
| 14 | **TREMOLO** | pools left in your wake that keep working after you have gone |
| 15 | **CRESCENDO** | feeble when you are safe, enormous when you are surrounded |
| 16 | **CODA** | deals nothing until it kills, then detonates the corpse for its whole life's damage |

Some of these exist today and are worth keeping — that is a feature, not
laziness. What changes is that the roster is now chosen for **spread of idea**
rather than spread of geometry, and the ones that are only geometry (a second
arc, a third seek) are cut.

Two properties the current roster lacks that this one needs, and they matter as
much as the list:

- **Scale.** VS weapons become absurd — by minute 20 the screen is a wall of your
  own effects. Ours are polite. Level 3 of a weapon should look like a different
  weapon, not like level 1 with a bigger number.
- **Visual distinctness.** You should be able to tell at a glance which of your
  four weapons is doing what. Today they are mostly small bright dots.

### 2a. Combinations

`C(16,2) = 120` pairs. Authored where an obvious idea exists — RICOCHET × CANON
is a bouncing bolt that leaves a copy of itself at every bounce; BLACK HOLE ×
TIMPANI is a shockwave that fires inward — and a systematic fallback otherwise so
every pair produces *something*, which is what makes experimenting safe.

**Combining frees a slot**: two weapons become one, so 4/4 used becomes 3/4. That
is the mechanism the owner asked for, and it makes slot pressure the engine of
the progression rather than a cap on it.

Effects like burn, chill and chain still exist as supporting vocabulary — several
of the sixteen will carry one — but **no weapon is defined by its effect**, and
there is no grid.

---

## 3. Two currencies: elites drop weapons, trash gives XP

Today one offer stream carries everything — new instruments, levels, rig items,
fusions — into a four-card draw governed by a zero-sum weight table that
AGENTS.md §5 records as having resisted every attempt to improve it.

The brief splits it, and the split dissolves that constraint rather than fighting
it:

| source | gives |
|---|---|
| **trash enemies** | XP → levels → **level up a weapon you already hold** |
| **elites** | **a weapon drop** — the only way to acquire |
| **bosses** | as now, plus a guaranteed combination opportunity |

Consequences worth stating plainly, because they are the design:

- **You cannot churn weapons.** With 4 slots full, an elite drop is a real
  decision: decline it, or combine two held weapons first to make room. That is
  the owner's "you should not be able to keep on replacing weapons".
- **The level-up screen gets simpler and better.** It stops being a lottery
  across four different card types and becomes "which of your four weapons gets
  stronger", which is a decision a player can actually reason about.
- **Elites need to be worth hunting.** They should be visible, distinct, and
  slower — a target you choose to engage, not one that arrives on a schedule.

`STAND_SLOTS` is already 4. `RIG_SLOTS` is 3 and becomes 4.

---

## 4. Descriptions that let a player reason

Every card states, in this order: **damage number**, **effect line**, **what
levelling adds**. No poetry above the numbers — the current blurbs are lovely and
tell you nothing actionable. Keep the flavour line, demote it below the mechanics.

The existing `steps[].note` field already carries a per-rung description and
`levelup` already asserts it is non-empty; this is a rewrite of content plus one
new line on the card, not new machinery.

---

## 5. The HUD

Delete: the music notation canvas, the stem roll, the live-code panel, the whole
right sidebar.

Overlay instead, on the playfield, minimal:
- top-left: HP / shield pips, and the four weapon slots as small icons with level
- top-right: wave, timer, score
- bottom-centre: XP bar
- a **gear icon** for volume and settings, opening a panel over the game

Everything the sidebar showed that is not one of those is diagnostic, and belongs
behind the gear or in the pause screen. The music visual costs frames and buys
nothing the player acts on — the owner is right about that and it is the easiest
call in the brief.

---

## 6. Order of work

Each phase is independently commitable and independently playable, which matters
because the last two passes both shipped a lot at once and found out afterwards.

1. **HUD + responsive view.** Delete the sidebar and the music visual, make
   `VIEW_W/H` follow the window. Biggest visible change for the least risk, and
   it is the one that makes everything after it easier to look at. *Gate:*
   `gridview` already asserts the drawn point count follows VIEW and not
   PLAYFIELD — it was built for exactly this and has never yet seen VIEW move.
2. **Enemies stop shooting; density rises.** Delete the enemy bullet subsystem,
   convert every archetype to contact damage, then raise counts into the budget
   that frees up. *Gate:* `arena` encirclement must hold; frame cost measured
   before and after, since this is the phase that claims to be cheaper.
3. **The sixteen weapons.** Hand-authored, one idea each, with the new card
   format. Supporting effects (burn, chill, chain) built only where a weapon
   needs one. Ship four first and play them before authoring the other twelve.
4. **Slots, elites, two currencies.** The progression rewrite.
5. **The 120 combinations**, once the roster is stable. Largest surface, so last.



---

## 7. Risks, and the ones I would bet on going wrong

- **Contact-only damage may make the game trivial.** Bullets are what make
  standing still dangerous; without them, kiting may beat everything. Enemy
  *speed* and *count* have to carry the whole difficulty curve, and this repo has
  a recorded history of overshooting difficulty passes in both directions. This
  is the risk I would rate highest.
- **The graze mechanic dies with enemy bullets** and it currently feeds the music
  director. Something has to replace it as a "you are cutting it fine" signal, or
  the soundtrack loses one of its inputs.
- **120 combinations is a lot of surface for the level-up UI** and for `mirror`,
  which already re-implements the fusion rules in a second place. That second
  copy is the thing most likely to drift under this change.
- **The HUD rewrite touches `contrast`, `legibility`, `typescale`, `panelshot`,
  `uisheet`, `levelshot` and `hudab`** — seven browser gates whose assertions are
  about a layout that will no longer exist. Expect to rewrite them, and expect
  that to be where the bugs hide.
- **`sections`, `wiring`, `stemprobe` and friends read the stem roll's DOM.**
  Deleting the music visual may take out gates that were measuring the music
  through it.

---

## 8. What this plan does not do

It does not touch the music. Track M has one open fault (no musical unit longer
than 80 seconds) and one open question (whether the bass wants to move an octave,
which needs ears). Both are parked deliberately: this refactor is large enough,
and the two workstreams share no files.

---

## 9. The roster, taken from the source material rather than invented

The owner: *"i wouldnt do too many odd weapons, like literally just look at those
games i mentioned ... shouldnt be that hard to get a lot of these in, no need to
stop at 16 either if you can imagine a very rich item space"*.

Both wikis were read in full. §2's draft roster is **withdrawn** — it was sixteen
invented ideas, which is the third variation on the same mistake. What follows is
taken from what those games actually ship.

### 9a. What the wikis actually show

**Ball x Pit: 21 base balls, 69 hand-authored fusions, ~7,921 reachable
combinations.** And the crucial detail — **its base balls are mostly simple
composable PROPERTIES**, not elaborate weapons: Bleed, Burn, Freeze, Poison,
Ghost, Iron, Stone, Lightning, Wind, Time, Vampire, Cell, Egg Sac, Brood Mother,
Charm, Dark, Light, Earthquake, Flesh, Laser. Each is one sentence. The
INTEREST is in the 69 fusions, every one of which is a genuinely new named
behaviour rather than a stat blend:

> Nuclear Bomb, Timestop, Laser Cutter, Tumor, Banshee, Mosquito Kingdom,
> Black Hole, Armageddon, Frozen Flame, Sandstorm, Zombie, Reaper.

**It works because delivery is UNIFORM.** Every ball is launched the same way, so
the ball's property IS the weapon, and properties compose without a combinatorial
explosion of firing code. That is the architectural lesson and this codebase has
been ignoring it: we have fourteen delivery shapes and no properties, which is
exactly backwards for a combination game.

**Vampire Survivors: ~70 weapons**, and its contribution is the DELIVERY
vocabulary — attacks horizontally, fires at nearest, fires in faced direction,
boomerangs, orbits, damages nearby, generates zones, bounces around, strikes at
random, erases everything in sight, freezes in a line, shields, fires in four
fixed directions, zones while moving and strikes when stopping.

### 9b. The architecture that follows

**A modest set of delivery shapes, ~20 composable properties, ~60 authored
fusions.** Base weapons carry a property and a delivery; fusions are named and
hand-authored, exactly as Ball x Pit does it.

Twenty bases give `C(20,2) = 190` pairs. Author sixty of them as named results
with real behaviour, and give the remaining 130 a systematic fallback that
carries both parents' properties so nothing is a dead end. That is a genuinely
rich item space and it is the shape both reference games converged on.

### 9c. The twenty bases, mapped

Musical names, mechanics taken from the wikis rather than invented:

| base | mechanic (from source) | source |
|---|---|---|
| **EMBER** | adds burn stacks; damage over time | BxP Burn |
| **GLASS** | chance to freeze; frozen take +25% | BxP Freeze |
| **DETUNE** | poison stacks, damage per second | BxP Poison |
| **RASP** | bleed stacks; damage per stack when hit | BxP Bleed |
| **ARC** | chains to up to 3 nearby | BxP Lightning |
| **SWELL** | passes through, slows 30%, less damage | BxP Wind |
| **PHANTOM** | passes through enemies | BxP Ghost |
| **ANVIL** | double damage, 40% slower | BxP Iron |
| **GRAVEL** | 300% damage, erodes 40% per hit | BxP Stone |
| **NOCTURNE** | 3x damage, destroys itself, cooldown | BxP Dark |
| **GLARE** | blinds; blinded enemies miss half the time | BxP Light |
| **FERMATA** | drops a snare that freezes what enters it | BxP Time |
| **SIPHON** | chance to heal on hit | BxP Vampire |
| **CANON** | splits into a clone on hit, twice | BxP Cell |
| **TUTTI** | explodes into 2-4 lesser bolts | BxP Egg Sac |
| **ENSEMBLE** | chance to spawn a helper on hit | BxP Brood Mother |
| **TIMPANI** | damages everything in a radius | BxP Earthquake |
| **ACCELERANDO** | speed +25% per bounce | BxP Flesh |
| **LANCE** | damages everything in a line | BxP Laser |
| **DUET** | chance to charm an enemy into fighting for you | BxP Charm |

Delivery ideas from VS attach to these rather than multiplying them: nearest-target,
faced-direction, orbit, boomerang, four-fixed-directions, random-strike,
zones-while-moving, erase-in-sight.

### 9d. Fusions, hand-authored

Sixty named results, each a new behaviour. The source list is the model and many
port directly:

> EMBER+ANVIL → **BOMB** · BOMB+DETUNE → **FALLOUT** · FERMATA+GLASS → **TIMESTOP**
> LANCE+GRAVEL → **CUTTER** · ARC+SWELL → **STORM** · EMBER+GLASS → **FROSTFIRE**
> NOCTURNE+PHANTOM → **WRAITH** · SIPHON+PHANTOM → **LEECH** · CANON+TIMPANI → **OVERGROWTH**
> GRAVEL+TIMPANI → **LANDSLIDE** · ARC+ENSEMBLE → **ROD** · DETUNE+GLASS → **VENOM**

Order does not matter, per Ball x Pit. Every fusion frees a slot.
