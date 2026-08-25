# Density: why the arena is not actually the problem

Written during the turnaround pass. Companion to `research-camera.md`, which
scoped the mechanics of growing the field. This one argues the field size is the
*second* problem and that growing it first would make the game worse.

Everything below is MEASURED off `tools/arena.mjs` (3 runs x 20 simulated
minutes) or read out of source with a file:line, except where marked
HYPOTHESIS.

---

## 1. The measurement that reframes the complaint

`tools/arena.mjs` on the pre-refactor tree, both bot policies:

| | card-0 | builder |
|---|---|---|
| survived | 1200.0 s | 1200.0 s |
| wave | 33.0 | 40.7 |
| level | 47.7 | 62.0 |
| kills/min | 77.6 | 152.8 |
| hits taken | 14.0 | 31.3 |
| nominal dps | 867.8 | 1868.0 |
| fusions | 0.33 | 3.67 |

And the distribution that matters most, as p10 / p50 / p90 / max:

```
enemies         0.0 / 6.0 / 31.0 / 56.3
enemy bullets   0.0 / 8.0 / 51.0 / 147.3
encirclement    0.00 / 0.05 / 0.52 / 0.88
```

**Median enemies on screen: 6.** Ten percent of the run has *none*. Vampire
Survivors is routinely holding 100+ on screen by minute 10, and the whole
sensation of that game — the reason a bigger map reads as "more room to kite"
rather than "more empty floor" — depends on the field being full.

The complaint "the map is too small" is real but it is downstream. A 3x field
holding a median of six enemies is a median of six enemies in nine times the
floor space. **Growing the arena before fixing density makes the game emptier,
not bigger.** These two changes have to land together or in the order
density-then-size.

## 2. Why the field is empty: it is a wave shmup wearing a survivors costume

Two structural facts, both in source, both deliberate, both recorded by their
own authors as compromises.

### 2a. Every enemy has an 18-second deadline — `enemies.ts:737`

```ts
e.leaveAt = archetype === 'rush' ? Infinity : 18;
```

The comment above it is unusually honest and worth quoting in full because it
contains its own refutation:

> In the round there is no bottom — every mover holds a ring around the player
> instead of crossing the field — so an unbounded `leaveAt` means the stage only
> ever accumulates, and a player who cannot clear a group is followed by it for
> the rest of the run.

That is an exact description of Vampire Survivors. Accumulation *is* the
mechanic. "A player who cannot clear a group is followed by it for the rest of
the run" is not a bug in a survivors-like; it is the fail state, and outrunning
it is the verb. The conversion inherited a shmup's instinct that an enemy which
has had its turn should exit, and that instinct is what caps the population.

The comment also flags its own weakness — *"18 seconds is a GUESS standing in
for a measurement"* — and says it should be re-read off `tools/wavelength.mjs`.
It never was.

### 2b. Spawning is a discrete wave script, not a population controller

`waves.ts` generates a `WavePlan` of `SpawnEntry` records — `atBeat`,
`archetype`, `count`, `formation` — and `World.updateWave` ends a wave when the
entry cursor is exhausted *and* `enemies.length === 0` (`waves.ts:44-58`
documents this). So the loop is: script a batch, wait for it to be cleared or to
time out, script the next batch.

A survivors-like does not do this. It runs a **spawn director** that continuously
tops the field up toward a target population which climbs with elapsed time,
with the wave concept demoted to a difficulty/flavour curve rather than a gate.
The current design guarantees the trough between waves — and the p10 of 0.0
enemies is that trough, measured.

There is a corroborating dead field here: `WavePlan.spawnTimeout` is
**written and never read** (`waves.ts:41-58`, the comment says so explicitly and
`tools/deadhunt-branches.mjs` confirms only the declaration and two writes). The
real wave length is set by `leaveAt` in `enemies.ts`. So wave pacing is
controlled by a constant in a different file from the one that appears to own
it, and that constant is a guess.

## 3. What this implies for the other three complaints

**"Gameplay doesn't feel snappy" is partly a density symptom.** HYPOTHESIS, but
a strong one: at a median of six enemies, most of a player's moment-to-moment
input produces no feedback at all, because there is nothing within range to hit.
Snappiness is not only frame latency and hitstop — it is the rate at which
inputs produce visible consequences. 77.6 kills/min is 1.3 kills per second
across the *whole* run; VS in its second half is an unbroken stream. No amount
of hitstop tuning fixes an empty screen.

**The item complaint compounds it.** `fusions 0.33` on the card-0 policy means a
typical non-optimising player finishes a twenty-minute run having seen **no
fusion at all**. The build never arrives. That is a progression problem, and it
is tracked separately, but note the interaction: builds in VS are legible
*because* the screen is full — you see your new weapon carve a lane through a
crowd. With six enemies you cannot see what an item did.

## 4. The coherent change, and why it is one change and not four

Ordered by dependency, not by value:

1. **Retire the 18-second deadline** as the primary population control, or push
   it far out. Replace it with pressure the player can act on. `rush` already
   proves the engine is fine with `Infinity`.
2. **Add a spawn director** that maintains a target on-screen population as a
   function of elapsed time, and demote `WavePlan` to the flavour/archetype
   curve it already is. The wave-end condition `enemies.length === 0` has to go
   with it — with accumulation, that condition may never be true.
3. **Then** grow the field (`research-camera.md` Stage 5), because now there is
   something to put in it.
4. **Scale clear-rate to match.** If population climbs and DPS does not, the
   result is not Vampire Survivors, it is being swarmed and dying at minute
   four. This is the coupling that makes the four complaints one project: item
   power is the answer to density, density is the answer to arena size, and
   arena size is what stops density becoming a solid wall.

**The performance question is real and unanswered.** HYPOTHESIS: the current
renderer draws one `drawImage` per bullet with no batching and the peak measured
is 147 bullets / 56 enemies. A target population of 100+ enemies is a different
order. `research-camera.md` §2a already identifies `WarpGrid` as a cliff at 3x
(285 points today, 2420 at 3x, ~88% off screen). Density and field growth both
push on the same budget and neither has been profiled at the target.

## 5. What would falsify this

The honest counter-case, recorded so it is not skipped:

- If `tools/arena.mjs`'s bot is a poor stand-in for a human — it may kite less,
  or clear faster than a person — then the p50 of 6 is the *bot's* experience,
  not a player's. The bot's wall-repulsion logic is known to be hardcoded to the
  current field (`research-camera.md` §7b, eight copies), so it is already
  suspect. Stage 0b fixes that; these numbers should be re-read afterwards.
- The encirclement p90 of 0.52 and max of 0.88 say the player *does* get
  surrounded, which is evidence the game is not uniformly empty. The mean may be
  the wrong statistic — six enemies clustered on one side is a different
  experience from six spread around a ring.
- Nobody has watched this game run. Every number here is off a headless
  simulation. A browser is available now; `tools/levelshot.mjs` and the other
  browser gates should be used before any of section 4 is committed.
