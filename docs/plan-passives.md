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

---

## 8. WHAT LANDED — steps 2 and 3 of §6, measured

Step 1 (LOCKED) is **NOT done**; see §8.6. Steps 2 and 3 are.

### 8.1 The surface, and the one deviation from §3.1

`Rules` is in `weapons.ts` beside `Modifiers`, folded by `rigRules` once per step
into `World.rules`, and every rule fires **in place inside `world.ts` at the line
that already emits the matching event** — no bus subscription, exactly as §3.1
demanded.

**It is a flat record of numbers, not `{ onKill: RuleSpec[] }`.** The reason is
the one `Modifiers` gives two declarations above it: a flat record FOLDS.
`rigRules` is `rigModifiers`' twin, order-independent by construction and
diffable by a tool holding no copy of anyone's arithmetic; a bag of specs needs
an interpreter, an ordering rule and a dispatch table, which is machinery for a
table with one contributor per rule. What makes these rules is not the container
— it is that each is consumed by a BRANCH at a moment the player can act on,
rather than by a multiplication in `applyModifiers`.

**`onGraze` and `onCollect` were dropped from the draft.** No passive wanted
them, and a declared field nobody installs is the defect this whole document is
about. `tools/rulefire.mjs` fails on exactly that condition, so a future rule has
to be wired before it can be declared.

### 8.2 §7's first falsifier, tested: NO container was needed

| passive | rule | container | worst case, extra objects |
|---|---|---|---|
| `laser` | every Nth activation of each instrument pierces everything and seeks | none | **0** — it re-flags bolts that were going to be fired anyway |
| `homing` | a bullet-kill throws 1-3 bolts back out at the next target | `BulletPool` | **+3 per bullet-kill**, non-recursive (`BulletFlag.Echo`); ~61 bullet-kills per 300s against a 700 cap |
| `timewarp` | enemies within 150-250px run at 0.72-0.5 speed | none | **0** — one squared-distance test per enemy per step |
| `compressor` | taking a hit releases a ring | `novas[]` | **+1 per player hit**; ~21 hits per 300s |
| `fermata` | standing still charges every activation to x2.6 | none | **0** — one scalar |
| `tempo` | a damaging ring dropped every 60-80px travelled | `novas[]` | **≤11 alive**, by `life / (every / topSpeed)`; `novas.length` already means 29 and peaks at 310 |

Nothing new was allocated. The cost model in §3.1 holds.

### 8.3 Two `Modifiers` fields were DELETED, and one of them was already dead

- **`pierce`** — fed by LASER alone. Its rule sets `InstrumentStats.pierce`
  directly on the overcharged activation, so the modifier field had no feeder
  left and would have folded to 0 forever.
- **`homing`** — fed by HOMING alone, **and it was already a dead ladder.** Its
  one consumer, `World.steerPlayerBullets`, tested `mods.homing > 0` and then
  turned every bullet at a hardcoded 6 rad/s. **L1, L2 and L3 steered
  identically; two of that item's three rungs bought nothing.**
  `deadhunt-ranges` reported `world: mods.homing > 0` at 14.98% and was
  satisfied — a field being READ is not a field being USED, and nothing in the
  suite could tell the difference. Steering is `BulletFlag.Seeking` per bullet
  now.

The other four re-pointed passives **keep the one modifier field nothing else
feeds**, held flat at its old level-1 value, with the rule supplying all three
rungs. Dropping them would have orphaned `linger`, `moveSpeed`, `maxHp` and
`enemyTime` and taken their consumers in `world.ts` dead with them — which is a
worse defect than a passive with a small number on it. COMPRESSOR additionally
keeps `damage: 1.05`, because LASER's departure left it the last feeder of
`Modifiers.damage`; the rig's largest flat damage percentage went from 95% to 5%.

### 8.4 LASER is power-neutral by arithmetic, not by hope

An overcharge every Nth activation at xM is a mean multiplier of `(N-1+M)/N`:

| level | new | old |
|---|---|---|
| 1 | every 5th at x2.0 = **x1.20** | x1.24 |
| 2 | every 4th at x2.5 = **x1.375** | x1.50, +1 pierce |
| 3 | every 3rd at x3.0 = **x1.667** | x1.70, +2 pierce |

Slightly under on the mean, with infinite pierce and homing on the charged volley
where the two pierce rungs went. The total did not move; the SHAPE it arrives in
did, and that shape is something the player can time.

### 8.5 The gates, before against after

| gate | before | after |
|---|---|---|
| `arena` | ARENA HOLDS, encirclement p90 **0.33**, 184.1 kills/min | ARENA HOLDS, **0.35**, 188.8 |
| `builds` | ok, ratio 0.21, hit spread **2.8x** | ok, ratio **0.23**, hit spread **2.3x** (bar 2.0) |
| `openers` | 85% | **88%** (min 70) |
| `deadhunt-ranges` | 6 DEAD rows, 0/24 dead steps | **6 DEAD rows, 0/24** — unchanged, and every `mods.*` field still has a live range |
| `wiring` | ok | ok, **after fixing a latent bug it exposed** (§8.7) |
| `combine` | **FAIL 1.3x** | **FAIL 1.4x** — see §8.6 |

`levelup`, `mirror`, `discovery`, `aimcheck`, `offerchurn`, `stats` all green
both sides. The `builds` hit spread narrowing from 2.8x to 2.3x is the one
number that moved the wrong way and it is worth watching: a rule applies whatever
you picked, so builds converge slightly. The ratio the tool prints as its
diagnostic went the other way.

`npm run verify:node` — 40 checks — ends **3 FAILED: `leadfreeze`, `pause`,
`combine`.** All three were re-run against a pristine `git archive HEAD` tree
and **all three are red at HEAD too**, so none is caused by this work:

- `leadfreeze` — 1728 of 3456 rows differ, identical both sides. Audio, unrelated.
- `pause` — red at HEAD with TWO failures and red after with ONE. The vacuity
  failure ("nothing fired and no bullets existed after ANY resume") cleared: the
  run now produces 5 volleys and 30 bullets after a resume where it produced
  none. The remaining failure is the tool's own `SKIP_OFFERS` setting putting
  the hold on a stretch with no armed enemies.
- `combine` — §8.6.

### 8.6 §6 step 1 IS STILL OPEN, and `combine` still says so

`combine` fails at HEAD **and** after this change — 1.3x before, 1.4x after,
against a bar it does not reach either side. LOCKED is 42% both times. §4 said
"any passive work that does not fix this is decoration"; that is too strong —
the passives were independently a stat sheet and are not now — but the sentence
is right about fusions, and nothing here touched it.

### 8.7 A latent bug this work surfaced

A boss phase commits on a bar line and `openOfferNow` opens on a bar line, so the
two fire in the SAME `update` whenever a level and a phase gate come due
together, and `announce` overwrites: "LEVEL 17 / CHOOSE A MUSICIAN" was written
and replaced by "PHASE II" before either rendered. `wiring` caught it at steps
20699 and 31500 the moment the rules work moved the boss damage curve. Always
reachable; nothing had lined the two clocks up before. The phase now waits for
the first bar after the cards close, which is also correct on its own terms —
the world is stopped during an offer, so committing there spends the bullet
clear, the camera strike and 1.4s of invulnerability on a frame the player
cannot act in.

### 8.8 Findings for whoever comes next

- **`World.wells` is never rendered.** `Renderer` reads `novas`, `effects`,
  `notes`, `popups`, `drops`, both bullet pools and the particles, and no
  drawing code anywhere reads `wells`. BLACK HOLE and TREMOLO FIELD are
  invisible damage pools. It is why UP-TEMPO's trail is built on `novas[]`.
- **A held nova is invisible while it holds.** `drawNovas` fades on
  `1 - r/maxR`, which is 0 for the whole of a ring's `hold`. Every aura's
  `linger` is therefore an invisible hang.
- **Every aura silently cancels enemy bullets** (`clears: true` +
  `updateNova`'s annulus), still undocumented in the instrument table.
  COMPRESSOR's ring takes it deliberately; UP-TEMPO's trail refuses it, because
  six bullet-cancelling rings a second following the ship would be the strongest
  defensive item in the game bought by holding a direction.
- **`tools/effectsdraw.mjs` WAS DEAD and has been repaired.** `Renderer`'s
  constructor grew `new ResizeObserver(...)` which the tool's DOM stub did not
  provide, so every invocation threw before the first assertion — confirmed
  against a pristine HEAD tree, so it is not a regression from this work.
  Underneath that was a second one: `fitCanvases` guards on
  `clientHeight <= 0`, `undefined <= 0` is **false**, and the stub's canvas had
  no `clientHeight`, so `this.scale` was NaN and every frame opened with
  `setTransform(NaN, …)`. Both stubbed. It passes, and it now also asserts that
  UP-TEMPO's trail drop and COMPRESSOR's ring are actually DRAWN (6 and 8 draw
  ops over an otherwise identical frame) — fail-tested by making `drawNovas`
  skip rings under 60px, which took the trail to `MISSING +0 ops`.
- **Two node-only checks were not in the node-only suite.** `effectsdraw` and
  `levelupdraw` drive the real `Renderer` with no browser and were reachable
  only through `npm run verify`, which dies on its second step on a machine
  without Chromium. That is exactly the failure `verify-node`'s own header names
  — "which is how a check gets quietly left out for weeks" — and it is why the
  `ResizeObserver` breakage went unnoticed. Both are in the `static` group now,
  at 0.3s and 0.4s.
