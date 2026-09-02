# The meta layer: points, a shop, and stage select

Design for the between-runs layer. Written while the finite-run work is in
flight, because every part of this depends on a run being able to END.

The owner's ask, verbatim:

> "let's create a point system, speed to finish, etc, user can spend points in
> between rounds to unlock more powerups (weapons and passives), then make the
> initial game limited to only a few so 8 weapons and 8 passives (so we can still
> combine to 4 and 4). that way we have a continue, new game, and weapon shop
> menu before starting up another round, then progressively rounds become
> harder, but the user is selecting which round they would like to attempt,
> should be exponentially more rewards the deeper you go in stages, (not too
> exponential tho)"

---

## 1. What this changes about the game

Today a run is the whole game: you start with everything the roster can offer
and the only progression is inside the twenty minutes. This adds a layer above
it — the run becomes one attempt, and the game is the sequence of attempts.

That is Ball x Pit's shape and it is worth naming why it works there: **the
roster being locked is what makes unlocking feel like anything.** A player who
starts with 30 weapons has no unlock to look forward to; a player who starts
with 8 has 22.

### 1.1 The number the owner chose is the right one, and here is the arithmetic

30 weapons and 12 passives today, 4 + 4 slots. Cutting the starting roster to
8 and 8:

| | pairs available | fusions reachable |
|---|---|---|
| 30 weapons | 435 | 103 authored + the rest generic |
| **8 weapons** | **28** | enough that a run still combines |

28 pairs from 8 weapons is not a poor lattice — it is more combinations than a
four-slot loadout can explore in one run, which is the actual test. The owner's
parenthetical ("so we can still combine to 4 and 4") is the constraint that
matters and 8 clears it comfortably.

---

## 2. Points

### 2.1 What earns them

The owner names speed explicitly. The honest set, in rough order of weight:

- **Stage depth.** The dominant term. Attempting stage 7 and clearing it should
  pay far more than clearing stage 1.
- **Speed to finish.** A clear time bonus, scaled against a par time for that
  stage rather than an absolute — otherwise deep stages, which take longer, are
  punished for being deep.
- **Completion.** Reaching the final boss and winning, versus dying partway.
  A death should still pay something or a failed attempt is pure loss, which
  makes attempting a hard stage feel bad rather than brave.
- Possibly: damage taken (less is more), fusions completed.

### 2.2 "Exponentially more, but not too exponential"

This is the sentence to get right, and it is a real design constraint rather
than a vague one. Two failure modes bracket it:

- **Too flat** (linear in stage): a player grinds stage 1 because it is fast and
  safe, and depth is never worth the risk. The meta collapses into repetition.
- **Too steep** (2^stage): stage 1 becomes worthless the moment stage 4 is
  reachable, every earlier stage is dead content, and the numbers stop meaning
  anything by stage 10.

**Proposal: reward scales as `stage^1.6`, roughly.**

| stage | 1 | 2 | 3 | 5 | 8 | 12 |
|---|---|---|---|---|---|---|
| `stage^1.6` | 1.0 | 3.0 | 5.8 | 13.1 | 27.9 | 52.7 |
| `1.5^stage` (too steep) | 1.5 | 2.3 | 3.4 | 7.6 | 25.6 | 130 |
| linear (too flat) | 1 | 2 | 3 | 5 | 8 | 12 |

At 1.6, stage 8 pays 28x stage 1 — deep runs are clearly worth it — while stage
1 is still worth attempting for a beginner and stage 12 has not run away with
the economy. **These are starting numbers to be measured, not settled.** The
test is whether a rational player ever wants to farm a shallow stage; if they
do, the exponent is too low.

### 2.3 The measurement that decides it

`tools/arena.mjs` drives bot policies through whole runs. The meta question is
answerable the same way: simulate a player who always picks the deepest stage
they can survive against one who farms the safest, and compare points per
minute. If farming wins, the curve is wrong. That gate does not exist and
should be written alongside the feature — this is exactly the kind of economy
that looks fine until someone computes the optimum.

---

## 3. The shop

Spend points to unlock weapons and passives permanently.

Open questions worth deciding deliberately:

- **Price shape.** Flat per unlock, or rising? Rising prices pace the unlock
  curve against the reward curve; flat prices mean the 22nd weapon costs what
  the 9th did, which is generous but makes late points meaningless.
- **Is anything else purchasable?** Starting slots, a revive, a reroll. The
  owner asked specifically for weapons and passives, so anything beyond that is
  scope the ask did not request.
- **Does the shop show what a weapon DOES before purchase?** It must. The card
  text already leads with mechanics ("24 dmg x2 · burns 8/s for 3s") and the
  shop should reuse it rather than inventing a second description.

---

## 4. The menu

Continue / New Game / Weapon Shop, plus stage select.

- **Continue** implies persistent state across sessions — `localStorage`, as the
  autopick preference and best score already use. What persists: points,
  unlocked roster, highest stage reached.
- **New Game** must be a deliberate reset with a confirmation, because it
  discards everything the shop bought.
- **Stage select** shows which stages are unlocked and their reward multiplier,
  so the risk/reward decision is visible at the point it is made.

---

## 5. Order of work, and what blocks what

1. **The run must end first.** In flight. Nothing here is buildable until a run
   has a defined conclusion and a win state.
2. **Points earned from a run**, computed at the end from stage, time and
   outcome. Cheap once (1) exists.
3. **Persistence.** localStorage, wrapped in try/catch like the existing
   preferences — it throws outright in private-mode Safari and a settings read
   is not worth failing a boot over.
4. **Roster gating.** `progression.ts` builds the offer from
   `INSTRUMENTS`/`RIG`; gating is a filter on that list. The risk is the
   ZERO-SUM OFFER (AGENTS.md §5): a smaller pool changes draw odds, and
   `tools/offerpool.mjs` exists precisely to measure that — 8 weapons is a
   dramatically smaller pool than 30 and the fusion rate must be re-measured,
   not assumed.
5. **The shop and menu UI.**
6. **The reward curve**, tuned last against the farming measurement in §2.3.

## 6. What would falsify this plan

- **If 8 weapons makes runs samey.** 28 pairs is the arithmetic, but if the
  same three fusions show up every run the unlock layer is papering over a
  thinner game rather than pacing a rich one. `builds` measures whether the
  pick changes the run and should be checked at 8 as well as at 30.
- **If gating makes early runs unwinnable.** A finite run with a final boss
  needs enough power to beat it. If stage 1 with 8 weapons cannot be cleared,
  the gate is not a pacing device, it is a wall.
- **If points make the run feel like a means rather than an end.** The run
  should still be the game. A meta layer that turns twenty minutes of play into
  a currency-farming chore is a worse game than the endless one it replaced.

---

## 7. What the measurement said — and where it contradicted this plan

Written after building it. Everything above is preserved as it was proposed;
this section is what happened when the proposals were measured, and it
contradicts three of them.

### 7.1 `stage^1.6` is far too steep, and the reason is the column §2.2 has not got

§2.2's table has no TIME in it, and time is what decides the question §2.3
actually asks. A deeper stage contains about six times the bodies (6,925
scheduled across a stage-1 run against 43,849 at stage 12) and takes about twice
the clock (14:00 against 27:21, builder bot, starting roster, 3 seeds). So the
per-run multiplier is only half the fraction.

`tools/stages.mjs` re-prices one set of measured runs under every candidate
curve — exact, because the payout is linear in the multiplier — and prints the
best stage and its points-per-minute advantage over farming the shallowest:

| curve | best stage | best / farm |
|---|---|---|
| `s^0.8` shifted | 6 | 2.3x |
| `s^1.0` shifted | 6 | 2.9x |
| `s^1.2` shifted | 12 | 4.1x |
| **`s^1.35` shifted (shipped)** | **12** | **5.3x** |
| `s^1.6` shifted | 12 | 8.2x |
| `s^2.0` shifted | 12 | 16.3x |
| **`s^1.6` bare — this document's §2.2 proposal** | **12** | **27.8x** |

At the plan's number a stage-12 hour is worth **twenty-eight** stage-1 hours.
That is not "exponentially more, not too exponential"; it is the second failure
mode §2.2 names, arriving at the value §2.2 proposed.

**The measurement did not pick a single exponent. It excluded a region and
bounded the rest.** At 1.0 and below the optimum sits at stage 6 and everything
deeper is a LOSS per minute — the deep half of the set list becomes dead
content, which is the failure mode from the other side. At 1.2 and above the
optimum is the deepest stage. Anywhere in 1.2-1.6 is defensible; 1.35 was chosen
inside that band because it keeps a real gradient across the deep stages
(stage 6 to 12 is 1.23x rather than 1.43x at 1.6), so pushing further still pays
without making stage 6 pointless.

### 7.2 A bare power law has its steepest step where the player is weakest

`s^E` has its largest RELATIVE step between stage 1 and stage 2 and flattens
after: at E=1.35 that first step is 2.55x while stage 11 to 12 is 1.03x. That is
backwards — the one step every new player must take, taken with the weakest
roster they will ever have.

The shipped curve is `((s + 1.4) / 2.4) ^ 1.35`, normalised so stage 1 is exactly
1.0. Worst neighbour ratio 1.60x, whole set list 10.2x. `tools/roster8.mjs`
asserts a ceiling of 2.0 on the largest neighbour ratio, which is "not too
exponential" written as arithmetic rather than as a feeling, and the bare curve
fails it.

### 7.3 The zero-sum offer worry (§5, AGENTS.md §5) did not materialise

It went the other way. `tools/offerpool.mjs` grew a fourth arm at the shipped
starting roster, 400 model runs of 34 offers each:

    30 draftable (as shipped)   3.62 designed fusions per run, builder
     8 draftable (the gate)     3.81                          — UP 5.0%

AGENTS.md §5's finding is about cards ADDED to a fixed-size offer taking slots
from the others. Removing cards is the opposite operation and it CONCENTRATES a
builder's picks onto the two things they are feeding. Grace cards — the way a
thin pool actually goes wrong — sit at 0.9% of 54,400 dealt, so sixteen ids
against four cards is not running dry.

`tools/builds.mjs` at the gated roster: divergence **0.85 against 2.08** at the
full table on the same tree, on a bar of 0.25. Read the decomposition: the
policy spread in wave reached ROSE (0.51 -> 0.79) while the damage spread
compressed (8.5x -> 2.2x), because a sixteen-id pool contains no super-safe corner. The
pick decides progress more and punishment less. §6's "if 8 weapons makes runs
samey" is not what happened.

### 7.4 §6's other falsifier: stage 1 IS winnable on eight weapons

3/3 cleared, 14:00 mean, on the starting roster with a builder bot. Faster than
the full-roster baseline (`finale` reads 16:26 card-0 / 14:19 builder at thirty
instruments), which is consistent with the fusion rate going up rather than
down. The gate is a pacing device, not a wall.

### 7.5 The honest negative: depth is BIGGER and BUSIER, and not measurably more
dangerous

Stage 12 against stage 1: 1.95x the clock, 2.55x the kill rate, 2.8x the mean
crowd on screen, 3.3x the PEAK crowd. Those all move, in both roster arms.

Damage taken does not. This bot takes one to eight hits in a whole run at every
depth and never dies at any of them — `tools/deadhunt-horizon.mjs` explains why
(score extends plus the last-life auto-bomb refund make survival an absorbing
state). The first version of the difficulty gate asserted on hits per minute and
it read 4.09x on one roster arm and 0.09x on the other: the metric's spread is
the whole effect. It was replaced with peak crowd.

So: **the set list demonstrably delivers more, and whether it is frightening is
a question about a human that nothing in `tools/` can answer.**

### 7.6 §3's open questions, decided

- **Price shape.** Rising, linearly, uniform across items: `150 + 50n`, ending
  at 1,400 for the 26th unlock and 20,150 for all of them. Rising because the
  reward curve rises and a flat price empties the shop in one evening; linearly
  rather than geometrically because a power-law reward against a geometric price
  is a wall; uniform because pricing ANVIL above EMBER is a balance claim and
  there is no measurement behind one.
- **Anything else purchasable?** No. The ask was weapons and passives.
- **Does the shop show what a weapon does?** Yes, and it is
  `stepNote(id, 1)` — byte-identical to the note `availableOptions` puts on the
  card the first time that thing is offered, asserted row by row rather than
  claimed.

### 7.7 Which eight, and what the choice cost

The roster is organised on ONE axis: twenty of the thirty instruments own
exactly one entry of `PROPERTY_NAMES` and the other ten re-deliver a property
somebody else owns. So "distinct mechanical roles" has a machine-readable
meaning, and the starting eight are eight different properties —
**ember/burn, bow/lance, timpani/quake, chime/freeze, feedback/chain,
drones/brood, siphon/leech, anvil/heavy**. The three openers are forced by
`STARTERS`; seven of the eight passives are then forced by those weapons'
evolution recipes, because a locked catalyst is a designed reward the player can
never reach. `rapid` takes the one free chair.

It is not the maximum of either objective it was chosen against. The
lattice-densest legal eight (`ember bow timpani chime tremolo anvil gravel harp`)
has **sixteen** authored pair recipes among its twenty-eight pairs against this
set's **nine** — but it is four damage shapes and two damage-over-times with no
chain, no summon and no sustain: a richer fusion tree over a narrower game.
