# The passive overhaul: from a stat sheet to an item ecosystem

Companion to `docs/research-weapons.md`, which covers the twelve INSTRUMENTS. This
one covers the twelve RIG passives, which nothing in the turnaround has touched
and which are half of the owner's brief: *"item diversity ... these items should
change up play style significantly"*.

Everything below is MEASURED off the source or the emitted haps, or marked
HYPOTHESIS.

---

## 1. The finding: the rig cannot express a rule

**All twelve passives are flat stat multipliers. MEASURED.** Every entry in `RIG`
is a `levels` array of scalar factors. LASER, the item the owner reached for when
naming what a weapon should be, is:

```js
[{damage:1.12},{damage:1.24},{damage:1.36},{damage:1.5,pierce:1},{damage:1.7,pierce:2}]
```

That is the whole item. On the level-up screen it renders as **"LASER — +12%
damage"**, which is what the owner saw and why they asked for a laser: the game
has the word and none of the weapon.

**This is not an authoring failure, it is a structural one.** `Modifiers`
(`weapons.ts:159`) has thirteen fields — damage, cooldown, area, count, speed,
linger, pickupRadius, moveSpeed, maxHp, pierce, homing, enemyTime, xpGain — and
**every one is a `number`**. There is no boolean, no rule, and above all **no
trigger surface**: nothing for "on kill", "on hit", "on taking damage", "on
level-up", "while standing still", "on graze". A passive physically cannot say
anything except *a number is bigger*.

So the twelve items are twelve entries in one spreadsheet column-set, and no
amount of rewriting their blurbs changes that. `applyModifiers` folds them into
the instrument stat block and nothing downstream can tell which item contributed
what.

### 1.1 Why this is the bigger half of the diversity problem

The weapons at least have seven distinct verbs and `research-weapons.md` shows how
to reach sixteen. The passives have **one** verb — *multiply* — across twelve
items, and a passive is on screen in the offer as often as an instrument. Half of
every four-card draw is currently a percentage.

---

## 2. What the reference games actually do

**Vampire Survivors' passives are also mostly stats** — Spinach is +damage,
Candelabrador is +area — and that is worth admitting rather than pretending
otherwise. Two things make them work anyway, and both are missing here:

1. **They gate evolutions.** A VS passive is not chosen for its number, it is
   chosen because it is the key to a weapon's evolved form. MusicWars already has
   this — the 12x12 rig where each passive catalyses one instrument — and it is
   the best thing in the current design. It is undermined by the LOCKED problem
   (§4), not by the passives themselves.
2. **Arcanas exist alongside them.** VS's real playstyle-changing items are a
   SEPARATE class of run-modifying rules — "weapons no longer need to be aimed",
   "every 10th projectile is a critical" — and they are what the owner is
   describing when they say items should change how the game plays.

**Ball x Pit leans further into rules.** Its balls carry behaviours that compose,
and the fusion system is explicitly about combining behaviours rather than adding
numbers. That is the model the owner named.

**The conclusion.** MusicWars does not need more passives. It needs a second KIND
of passive: one that changes a rule rather than a number. And it can have that for
zero offer slots, by the same trick that works for instruments.

---

## 3. The free move: re-point a passive, do not add one

`AGENTS.md` §5 is emphatic and has the measurement to back it: **the four-card
offer is zero-sum, and every card type added is taken from the others.** Letting
evolved instruments level — a change that added no card type, only eligibility —
still dropped designed fusions per run from 1.63 to 1.13 and the
builder-vs-drifter ratio from 2.2x to 1.5x, at three different draw weights, all
the same direction. It was reverted.

The exit AGENTS.md itself names is *"change what an existing card is WORTH"*. That
is exactly what re-pointing an instrument's `shape` does, and it is what this plan
does for passives:

> **Change what a passive DOES, not how many there are.** Twelve stays twelve. The
> 12x12 catalyst lattice is untouched, because the catalyst relationship is keyed
> on `id` and does not care what the item's effect is. Zero new cards, zero
> displaced cards, zero new audio lanes.

### 3.1 What has to be built first

A **trigger surface**. This is the one piece of real engineering in the plan, and
it is small:

```ts
/** Rules a passive can install, as opposed to numbers it can scale. */
export interface Rules {
  /** Fires after an enemy dies to the player. */
  onKill: RuleSpec[];
  /** Fires when the player takes a hit. */
  onDamaged: RuleSpec[];
  /** Fires on a shard pickup. */
  onCollect: RuleSpec[];
  /** Evaluated continuously; gates a conditional bonus. */
  whileStill: RuleSpec[];
  /** Fires on a graze. */
  onGraze: RuleSpec[];
}
```

**VERIFIED:** `World` already emits every one of those moments —
`enemy:death` (`events.ts:168`), `player:hit` (:199), `player:graze` (:201) and
`shard:collect` (:218) — and every one is consumed ONLY in `main.ts`, and only to
play a sound or a particle. Nothing reads any of them for gameplay.

**One refinement, because the obvious implementation is the wrong one.** Do not
subscribe to the bus. `main.ts` listening for `enemy:death` and then reaching back
into the world to spawn a nova would invert the layering the whole codebase is
built on — `events.ts` says in as many words that the simulation emits and never
receives, and that keeping the boundary narrow is why either half can be rewritten.
The rules should fire **in place inside `world.ts`, at the same lines that already
emit those events**. That is strictly less machinery than a subscription: no
listener, no ordering question, no risk of a rule running a frame late.

So the cost is a `Rules` object folded alongside `Modifiers`, and roughly five
`if (this.rules.onKill)` branches at points `world.ts` already reaches. No new
container, no new event, no bus traffic. HYPOTHESIS remaining: that each rule's
EFFECT is cheap — a nova, a re-fire, a trail drop all reuse existing containers,
but that must be confirmed per rule before committing to six.

---

## 4. The LOCKED problem, which is upstream of all of this

**MEASURED, from `tools/combine.mjs`'s own output:**

> LOCKED: 193 of 424 offers (46%) could not deal the catalyst at all — the rig was
> full and a passive you do not hold cannot be offered.

**Nearly half of all level-ups cannot offer the passive a fusion needs**, because
the rig is full of other passives and an item you do not hold cannot be drawn.
This is why fusions are rare, and it is why shortening the level ladder from 8 to
3 moved the arena `fusions` row **not at all** — 0.33 for the naive player before
and after.

That is a stronger result than it looks. It means the owner's *"take way too long
to unlock"* is not a pacing complaint that tuning can answer. It is structural: the
game routinely puts the player in a state where the thing they are building toward
**can never be drawn**. Any passive work that does not fix this is decoration.

Candidate fixes, in increasing order of intervention, all to be measured rather
than argued:

1. **Let a ready fusion's catalyst displace.** If a fusion is one passive away and
   the rig is full, allow that passive to be offered as a swap for the
   lowest-value held one. `sacrificeFor` already exists and already protects
   catalysts, so the machinery is half there.
2. **Widen the rig by one slot,** which AGENTS.md warns breaks the deliberate
   12x12 symmetry and is preferentially spent by `sacrificeFor` — recorded as a
   known objection, not a recommendation.
3. **Loosen the recipe** so the catalyst must be HELD rather than MAXED. This is
   the largest change to the fusion feel and the most likely to make fusions
   frequent; it also removes the "both maxed" coincidence that makes them feel
   like an accident rather than a plan.

---

## 5. Twelve passives, re-pointed

Draft. Each keeps its id, its label, its catalyst relationship and its audio. Six
stay numeric on purpose — an ecosystem where everything is a rule is as flat as one
where nothing is.

| id | today | proposed | kind |
|---|---|---|---|
| `laser` | +damage, +pierce | **every Nth shot pierces everything and cannot miss** | rule |
| `spread` | +1 projectile | unchanged — the cleanest numeric item in the set | number |
| `rapid` | -cooldown | unchanged | number |
| `homing` | seek strength | **shots that kill re-fire once at a new target** | rule |
| `magnet` | +pickup radius | unchanged, but see §4 — it is doing real work | number |
| `timewarp` | enemy time | **enemies near you are slowed; the field is not** | rule |
| `reverb` | +area | unchanged | number |
| `compressor` | +maxHp | **on taking damage, release a nova** | rule |
| `capo` | +speed | unchanged | number |
| `fermata` | +linger | **standing still charges the next activation** | rule |
| `tempo` | +move speed | **you leave a damaging trail while moving** | rule |
| `resonance` | +xp | unchanged | number |

Six rules, six numbers. Every rule is a thing the player DOES something about:
`fermata` rewards planting, `tempo` rewards kiting, and those two pull in opposite
directions, which is what a build is.

**`tempo`'s trail is `research-weapons.md`'s D.2 `trail` shape** reused as a
passive rather than a weapon — the machinery (`wells[]`, `pushWell`, a distance
trigger, an existing cap) is built either way, so whichever lands first pays for
the other.

---

## 6. Order of work

1. **Fix LOCKED.** Nothing else in this document matters if the catalyst cannot be
   drawn. Measure `fusions` per run before and after; that number has refused to
   move once already and it is the honest gate on the whole item workstream.
2. **Build the trigger surface.** Small, and every hook already exists as an event.
3. **Re-point six passives.** Zero offer slots, zero new ids, zero audio.
4. **Then** the weapon shapes from `research-weapons.md`, which are independent.

## 7. What would falsify this plan

- If the trigger surface turns out to need a container per rule, the cost model
  collapses and this becomes a much bigger project than §3.1 claims. Verify before
  committing to six rules.
- If fixing LOCKED alone moves `fusions` substantially, the passives may not be
  the bottleneck at all and this plan should be re-prioritised behind the shapes.
- The claim that six-rules-six-numbers is the right mix is taste, not measurement.
  `tools/builds.mjs` measures whether the pick changes the run and is the closest
  thing to a test of it.
