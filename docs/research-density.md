# Density: why the arena is not actually the problem

> **CORRECTION, added after the claims below were tested. Read this first.**
>
> The headline of this document — that the field is empty and that the
> 18-second `leaveAt` deadline is what keeps it empty — is **WRONG in its
> mechanism and overstated in its conclusion**. Both halves were falsified by
> the experiments §6 records. The analysis of `p50 = 6` is arithmetically
> correct and materially misleading, which is worse than being wrong, and it is
> left standing below so the error is legible rather than quietly deleted.
>
> What is actually true: the field ramps 2 → 39 enemies between waves 2 and 27,
> it plateaus in the middle, the opening is very slow, and the frame rate is
> **already dropping at 39**. The real ceiling is the renderer, not the
> deadline. §6 has the numbers.

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

---

## 6. The experiments, and what they falsified

Everything in §1–§5 was reasoning from a static read of the source plus one
aggregate statistic. Both of its load-bearing claims were then tested directly
and both failed. Recorded in full, because this repo's rule is that a plausible
claim and a measured one are different things — and §1–§5 is a worked example of
the first being mistaken for the second.

### 6a. FALSIFIED: the 18-second deadline is not what limits density

§2a argued that `enemies.ts:737`'s `leaveAt = 18` is the primary population
control and that retiring it was step one of the whole plan. Tested by setting
it to 90 — five times longer, effectively "enemies do not leave" for any wave
that is not badly stalled — and re-running `arena`, 3 runs x 20 simulated
minutes:

| | leaveAt 18 | leaveAt 90 |
|---|---|---|
| enemies p50 | 6.0 | **6.7** |
| enemies p90 | 31.0 | **27.7** |
| kills/min (card-0) | 93.1 | 103.3 |
| kills/min (builder) | 161.2 | 161.7 |

The p90 went **down**. Density did not move. The deadline almost never fires,
because enemies are killed long before eighteen seconds elapse — and that is
even more true now the gun has been repaired. The comment on that line calls the
number "a GUESS standing in for a measurement", which is honest and correct; it
is simply a guess about a quantity that turns out not to matter.

The reasoning error is worth naming: §2a inferred a CAUSE from a MECHANISM that
exists. A deadline that could cap the population does not cap it if nothing ever
reaches the deadline. Nothing in a static read of the file can tell you which,
and the experiment costs four minutes.

### 6b. OVERSTATED: `p50 = 6` is arithmetically right and materially misleading

Time-resolved, via `tools/endgame.mjs`, which jumps to a wave and samples it:

| wave | 2 | 5 | 9 | 13 | 17 | 21 | 27 |
|---|---|---|---|---|---|---|---|
| enemies | 2 | 9 | 23 | 23 | 31 | 32 | **39** |
| difficulty | 0.04 | 0.23 | 0.55 | 0.90 | 1.00 | 1.00 | 1.00 |
| fps | 60 | 60 | 60 | 60 | 60 | 60 | **56** |

The field does fill up. The median of six is an average over a twenty-minute run
that includes a very sparse opening, the trough between every wave, and boss
waves — a boss wave's `planWave` emits **7** enemies total. Quoting a median
against Vampire Survivors' late-game screen, as §1 did, compares a whole-run
average to another game's peak. That is not a like-for-like comparison and the
conclusion drawn from it — "a 3x arena would hold six enemies in nine times the
floor space" — does not follow.

### 6c. What the time-resolved data DOES show, and it is a different plan

Three real problems, none of which is the deadline:

**The opening is far too slow.** Wave 2 puts *two* enemies on the field.
`docs/research-feel.md` separately measured 7.5 s of empty arena before anything
arrives and a first kill at 10.34 s. Vampire Survivors is sparse at minute zero
too, but it is not *two enemies* — and a survivors-like is judged in its first
ninety seconds.

**There is a plateau in the middle.** Waves 9 and 13 both sit at 23 enemies
while difficulty climbs 0.55 → 0.90, so four waves of stated escalation put
nothing extra on screen. Difficulty then saturates at 1.00 by wave 17 and the
`escalation` term is the only thing still moving.

**The renderer is the real ceiling.** 56 fps at 39 enemies, and that is before
any arena growth. `docs/research-camera.md` §2a independently found `WarpGrid`
materialising the whole field every frame with no culling — 285 points now,
~2420 at 3x, about 88% of them off screen. Any plan that targets Vampire
Survivors' on-screen counts is a RENDERER project before it is a spawner
project, and the honest order is: profile and batch first, then raise the
ceiling, then grow the field.

### 6d. What survives from §1–§5

The structural observations are still true and still worth acting on; only the
causal claim and the priority ordering were wrong. Spawning really is a discrete
wave script gated on `enemies.length === 0`, which really does guarantee the
inter-wave trough. `WavePlan.spawnTimeout` really is written and never read. And
the coupling argument in §4 — that item power, density and arena size have to
move together — is unaffected by any of this.

What changes is the order and the target. Not "retire the deadline, then add a
spawn director, then grow the field", but: **fix the opening, fill the mid-game
plateau, profile the renderer, and only then discuss the ceiling.**


### 6e. ANSWERED: the bigger arena did not empty the screen

Added after `docs/research-camera.md` Stage 5 landed. The one claim in this
document that survived §6a and §6b — that growing the field would spread the
same enemies over more floor — was finally testable, and it is **false as
stated**, for a reason neither the original nor the correction anticipated.

`tools/arena.mjs` had to be repaired first, and the repair is the finding.
It reported `w.enemies.length` under the label "enemies", which is every enemy
alive anywhere in the world. That was the same number as "on screen" while the
world was one screen, and it is a different question now. Both are printed:

| p10 / p50 / p90 / max | 900x1120 | 3000x3000 |
|---|---|---|
| enemies alive (whole field) | 0.0 / 7.0 / 21.0 / 42.0 | 0.0 / 7.7 / 25.3 / 53.0 |
| enemies ON SCREEN | 0.0 / 2.7 / 13.0 / 34.3 | 0.0 / 2.3 / 12.3 / 33.7 |
| encirclement | 0.00 / 0.04 / 0.32 / 0.82 | 0.00 / 0.04 / 0.32 / 0.82 |

Eleven times the floor area; encirclement p90 unchanged at 0.32 against a gate
of 0.25; on-screen population down 15% at the median and 5% at p90.

**Why it does not spread out.** Enemies were never distributed over the field.
They arrive on a ring and then hold a standoff of 120-280px from the PLAYER, and
Stage 4 made that ring the VIEW centred on the camera rather than the field
rectangle. So the geometry that decides density is player-relative from spawn to
death, and the field size does not enter it. §1's arithmetic — "a median of six
enemies in nine times the floor space" — assumed a uniform scatter that this
game has never had.

**The genuinely useful number this produced** is that on-screen p50 was ALREADY
2.7 against an alive p50 of 7.0 at one screen. Enemies spawn 70px outside the
rectangle and are culled 320px outside it, so roughly a third of the population
has always been off camera. Every density figure in §1 and §6b is an alive
figure. Future work on this should be denominated in the on-screen column,
which is now printed.
