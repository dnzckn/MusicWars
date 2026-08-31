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
