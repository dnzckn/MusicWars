# Track S: why it does not feel snappy

Research only. **No source file was changed.** Every `file:line` was read out of
this tree at commit `35f5cb0` (`git status` shows zero modifications under
`src/`), and `node node_modules/typescript/bin/tsc --noEmit` exits 0 on it, so
the line numbers are against a compiling baseline.

**What is MEASURED here and what is not.** Unlike `docs/research-camera.md`,
most of this document is measured rather than derived. Six throwaway harnesses
were run against the *real* `World`, `Player` and `Input` in Node at the real
`1/120` step, using the `tools/lib/tsnode.mjs` loader — the same route
`arena.mjs` and `parkdps.mjs` take. Anything marked MEASURED came out of one of
those runs. Anything marked DERIVED is arithmetic on constants. Anything marked
HYPOTHESIS is a taste judgement and is labelled as such.

**What was NOT measured, and no line below should be read as if it were:**
nothing was rendered, nothing was heard, and no real browser frame was timed.
The display-side latency in §1 is the one number in this document taken from
general knowledge rather than from this machine. The audio path (`sfx.ts`'s
claim of "around 30ms") was read, not measured — there is no `latencyHint` set
anywhere in `src/audio/engine.ts`, so the output latency is whatever the
browser's default is.

The harnesses live in the session scratchpad, not in `tools/`. Anything worth
keeping should be re-landed as a proper gate; §10 says which.

---

## 0. The one-paragraph version

The engine is **not** where the lag is. Input is sampled *inside* the fixed
step, before render, in the same `requestAnimationFrame` callback — there is no
buffered frame, no smoothing, no input queue, and the total engine-controlled
input-to-pixel budget at 60 Hz is **8.3–25.0 ms**, which is good. The mush comes
from three other places, in this order of magnitude:

1. **The reward channels are empty.** The most frequent positive event in the
   game — collecting an XP shard, 92–108 times per 120 s (MEASURED) — makes
   **no sound at all**, produces **one 2.2 px dot** (`world.ts:1520`), and its
   only other readout is a 4 px bar along the top edge of a 1120 px field. An
   ordinary enemy death has **no hitstop** and a screenshake whose peak
   amplitude is **0.32 pixels** (`camera.ts:52`: `amp = trauma² × 22`, and an
   ordinary kill passes `trauma = 0.12`).
2. **The starting gun mostly misses.** MEASURED against a genuinely stationary
   target with its `move` replaced by a no-op: PIZZICATO L1 unfocused scores
   **zero hits at every range from 120 px outward**, because the two-bolt fan
   straddles the thing it is aimed at. Live hit rate over six 90 s runs:
   **16%**. Median range to the nearest enemy in play: **170 px**.
3. **Everything at the start of a run is slow.** 7.50 s of empty arena
   (`world.ts:723`, identical across 5 seeds), then 2.84 s of shooting before
   anything dies, so the **first kill lands at 10.34 s** and the first level-up
   at 25.5 s.

The movement acceleration is a real but smaller contributor: it costs a
permanent **19.97 px / 46.4 ms** of positional lag versus an instant-velocity
ship, and in the first rendered 60 Hz frame after a keypress the ship moves
**1.55 px**.

There is also one outright **correctness bug**: edge-triggered inputs are
*doubled* at 60 Hz and *dropped* at 144 Hz and above (§6.2, MEASURED against the
real `Input` class).

---

## 1. Input latency: the chain, end to end

### 1.1 The chain is clean

`src/core/loop.ts` is a fixed-timestep accumulator with an interpolating render.
`FIXED_DT = 1/120` (`loop.ts:10`), `MAX_STEPS = 8` (`loop.ts:12`).

```
loop.ts:62   frameDt = min((now - lastTime)/1000, 0.25)
loop.ts:64   accumulator += frameDt
loop.ts:69   while (accumulator >= FIXED_DT && steps < 8) hooks.update(FIXED_DT)
loop.ts:77   if (steps === MAX_STEPS) accumulator = 0
loop.ts:85   hooks.render(accumulator / FIXED_DT, frameDt)
```

`main.ts:563` calls `input.sample()` at the top of **every** fixed step, and
`main.ts:564` feeds the result straight into `world.update`. Update runs before
render inside the same rAF callback. So:

- there is **no frame of buffered input**;
- there is **no smoothing or filtering** on the movement axes — `Input.sample()`
  reads the live `down` set, sums the direction vectors, and normalises anything
  longer than 1 (`input.ts:242-246`). The only smoothing in the whole path is
  the pointer/touch easing at `input.ts:172-176`, which keyboard play never
  touches;
- there **is** interpolation on render (`renderer.ts:565,731`:
  `lerp(prevX, x, alpha)`), which is correct and costs less than one step.

### 1.2 The ladder, at 60 Hz

MEASURED where marked; the loop row comes from simulating `loop.ts`'s exact
accumulator arithmetic over 20,000 frames.

| Stage | Cost at 60 Hz | Source |
|---|---|---|
| keydown → the rAF callback that samples it | 0–16.67 ms, mean 8.33 | DERIVED from rAF cadence |
| rAF → `input.sample()` | 0 | `main.ts:563`, sampled at the top of each step |
| `sample()` → world state advanced | 0 | same call, `main.ts:564` |
| render interpolation staleness | **8.33 ms** (mean alpha `0.000` at 60 Hz) | MEASURED |
| canvas present → photons | 16.7–33.3 ms typical | **NOT MEASURED** — browser/OS |
| **engine-controlled subtotal** | **8.3 – 25.0 ms** | |

That subtotal is good. It is not the complaint.

### 1.3 The interpolation alpha, by refresh rate — MEASURED

Simulating `loop.ts` exactly, 20,000 frames per row:

| Refresh | steps/frame | zero-step frames | multi-step frames | mean alpha | interp. lag |
|---|---|---|---|---|---|
| 30 Hz | 4.000 | 0.0% | 100.0% | 0.000 | 8.33 ms |
| 50 Hz | 2.400 | 0.0% | 100.0% | 0.400 | 5.00 ms |
| **60 Hz** | **2.000** | **0.0%** | **100.0%** | **0.000** | **8.33 ms** |
| 75 Hz | 1.600 | 0.0% | 60.0% | 0.400 | 5.00 ms |
| 120 Hz | 1.000 | 0.0% | 0.0% | 0.000 | 8.33 ms |
| **144 Hz** | 0.833 | **16.7%** | 0.0% | 0.583 | 3.47 ms |
| 165 Hz | 0.727 | **27.3%** | 0.0% | 0.545 | 3.79 ms |
| 240 Hz | 0.500 | **50.0%** | 0.0% | 0.250 | 6.25 ms |

The two highlighted columns are the bug in §6.2. Note the pathological
resonance at 60 and 120 Hz: mean alpha lands on exactly 0.000, so the renderer
draws the *previous* fixed step's state on every single frame — a full 8.33 ms
of staleness with none of the interpolation's smoothing benefit. It is small,
but it is the worst case and it is where nearly every player is.

### 1.4 dt clamping

`loop.ts:62` clamps `frameDt` to 0.25 s and `loop.ts:77` throws away the
accumulator backlog once 8 steps have run in a frame. That means the simulation
silently slows below **15 fps** (8 × 8.33 ms = 66.7 ms of sim per frame). Above
15 fps neither clamp ever fires. **Not a contributor at 60 Hz.**

---

## 2. Player movement — MEASURED

Driven against the real `Player` at `dt = 1/120`, with `bounds` set to 10⁷ so
the wall clamp at `player.ts:372-378` never bites (it zeroes velocity, which
silently corrupted the first version of this measurement — worth knowing).

Constants: `PLAYER_SPEED = 430` (`player.ts:25`), `ACCEL_HALFLIFE = 0.035`,
`BRAKE_HALFLIFE = 0.055`, `FOCUS_HALFLIFE = 0.022` (`player.ts:39-41`),
`TURN_RATE = 18` (`player.ts:55`).

### 2.1 Acceleration

| | unfocused (430 px/s) | focused (190 px/s) |
|---|---|---|
| 50% of top speed | 41.7 ms | 25.0 ms |
| 63% | 58.3 ms | 33.3 ms |
| **90%** | **116.7 ms** | 75.0 ms |
| 95% | 158.3 ms | 100.0 ms |
| 99% | 233.3 ms | 150.0 ms |

**How far the ship has actually moved, versus an instant-velocity ship:**

| after | v (px/s) | moved | instant ship | deficit |
|---|---|---|---|---|
| 1 step (8.33 ms) | 65.4 | 0.55 px | 3.58 px | 3.04 px |
| **2 steps = 1 frame at 60 Hz (16.67 ms)** | 120.9 | **1.55 px** | 7.17 px | 5.61 px |
| 4 steps (33.3 ms) | 207.8 | 4.68 px | 14.33 px | 9.65 px |
| 12 steps (100 ms) | 370.7 | 25.79 px | 43.00 px | 17.21 px |
| 60 steps (500 ms) | 430.0 | 195.03 px | 215.00 px | **19.97 px** |

**The single most useful number in this section: the ramp costs a permanent
19.97 px of positional lag, which is 46.4 ms of travel at top speed.** That is
*added on top of* the 8.3–25.0 ms engine budget in §1.2, and it never goes away
— it is a constant offset, not a transient. Focus mode costs 5.27 px / 27.8 ms.

And on the very first rendered frame after a keypress the ship moves **1.55
pixels**. `renderer.ts:344` clamps the canvas scale to 0.6–1.5, so that is
between one and two device pixels however the window is sized. The player
presses a key and, for one frame, nothing visibly happens.

### 2.2 Release, reversal, facing

- **Slide after release: 32.36 px**, down to 10% speed in 183.3 ms and 1% in
  366.7 ms. The comment at `player.ts:34` claims "about 40px of slide from top
  speed"; the measured figure is 32.4 px. Close, and the comment is not the
  problem — see §2.4.
- **Reversal** (full speed right, then hold left): velocity crosses zero at
  41.7 ms, reaches 90% the other way at **158.3 ms**, and the ship travels
  4.97 px past the turn point.
- **180° nose swing at `TURN_RATE = 18`: 175.0 ms.** The comment at
  `player.ts:47` says "about a sixth of a second" — 167 ms. That one is accurate.

### 2.3 Is 430 px/s fast? — MEASURED against the roster

| | px/s | ratio to the player |
|---|---|---|
| player, unfocused | 430 | 1.00 |
| player, focused | 190 | 0.44 |
| `rush` committed dive (`enemies.ts:280-281`) | 300 | 0.70 |
| `stutter` hop, mean (`enemies.ts:199-224`, 128 BPM) | ~266 | 0.62 |
| `glissando` weave, peak lateral (`enemies.ts:245`) | ~158 | 0.37 |
| `echo` (`enemies.ts:704`) | 68 + 58 sway | ~0.21 |
| `pluck` (`enemies.ts:704` + `driftIn` tangent 26) | ~61 | 0.14 |

Field crossing at top speed: 900 px in **2.09 s**, 1120 px in 2.61 s, the
diagonal in 3.34 s.

**The top speed is not the problem.** 430 px/s is 1.4× the fastest thing on the
field and 7× the slowest, and the arena is two seconds wide. The felt-speed
complaint is the *ramp*, not the ceiling.

One comparison that is worth having in front of you: a `stutter` hop covers
62 px in 234 ms with an eased curve that puts most of the travel in the first
third — so it moves roughly 40 px in its first ~78 ms while the ship, from a
standstill, has managed **9 px**. The hi-hat out-accelerates the player.

### 2.4 Does the code's argument for acceleration survive?

The comment at `player.ts:6-24` argues, at length and well, that instantaneous
velocity "means the ship has no weight" and that "every survivor-shaped game
that feels good has some carry in it." That argument is **about release**, not
about onset — it is the *slide* that reads as mass, and slide is governed by
`BRAKE_HALFLIFE`, not `ACCEL_HALFLIFE`. The comment at `player.ts:30-33` in fact
says exactly this: *"Answering the stick has to be nearly immediate or the ship
feels broken; letting go is where the weight lives."*

**It says the right thing and then sets a number that does not do it.** 116.7 ms
to 90% is not "nearly immediate"; it is about seven frames at 60 Hz. The
asymmetry the comment wants is present (0.035 vs 0.055) but both halves are set
an order of magnitude apart from what "nearly immediate" means in this genre.

HYPOTHESIS: dropping `ACCEL_HALFLIFE` to 0.012–0.015 and leaving
`BRAKE_HALFLIFE` at 0.055 keeps every word of that comment true while removing
two thirds of the onset lag. DERIVED table of what the alternatives buy:

| `ACCEL_HALFLIFE` | t to 90% | positional lag | first-60Hz-frame travel |
|---|---|---|---|
| **0.035 (current)** | **116.3 ms** | **50.5 ms** | **1.55 px** |
| 0.022 | 73.1 ms | 31.7 ms | ~2.4 px |
| 0.018 | 59.8 ms | 26.0 ms | ~2.8 px |
| 0.015 | 49.8 ms | 21.6 ms | ~3.2 px |
| 0.012 | 39.9 ms | 17.3 ms | ~3.6 px |
| 0 (Vampire Survivors) | 0 ms | 0 ms | 7.17 px |

(The analytic `h/ln2` column reads 50.5 ms where the driven measurement reads
46.4 ms. The 4 ms gap is real and is the discrete integrator: `player.ts:369-372`
updates velocity and *then* integrates position with the new value, which gains
half a step. Both numbers are correct; the 46.4 is the one the player gets.)

---

## 3. Firing and hit registration

### 3.1 The starting weapon, on paper

`STARTING_INSTRUMENT = 'pizzicato'` (`progression.ts:405`), base stats at
`weapons.ts:254`:

```
interval 0.22 s · count 2 · damage 4 · speed 1150 px/s · range 620 px
```

- 4.55 volleys/s, 9.09 bolts/s
- nominal 8 damage per volley, **36.4 dps if every bolt lands**
- a bolt's ttl is `(620/1150) × 1.05` = **566 ms**, crossing 651 px

Wave-0 roster (`waves.ts:89`) at difficulty 0 (`waves.ts:119-120`, `index/13`
raised to 1.25, so wave 0 is exactly 0): `pluck` hp 12, `stutter` hp 4, `rush`
hp 12 (`enemies.ts:403,425,521`; `enemies.ts:682` scales by `1 + d×0.85`).

On paper that is a 2-volley kill on a pluck — 0.22 s of firing plus ~0.21 s of
flight at 240 px. **In practice it is not, and this is the finding.**

### 3.2 The seek fan straddles its target — MEASURED

`world.ts:3355`:

```ts
const spreadTotal = p.focused ? 0.1 : 0.26 + n * 0.03;   // n = 2  ->  0.32 rad
```

with `t = i/(n-1) - 0.5` giving **±0.16 rad (±9.17°)**, plus a lateral spawn
offset of ±7 px (`world.ts:3360`). `computeAim` (`world.ts:3073`, and
specifically `p.seekAim` at `world.ts:3126`) sets the aim to the *exact bearing
of the target's centre*, so the two bolts leave **evenly straddling it**.

Harness: park the ship, park the target with `e.move = () => {}` so it genuinely
cannot drift into a bolt, give it 10⁹ hp so it never dies, fire for 15 s
(≈132 bolts), count `enemy:hit`.

| target (effective hit radius) | 80 px | 120 | 140 | 160 | 200 | 240 | 300 | 400 |
|---|---|---|---|---|---|---|---|---|
| `pluck` (20.3 px) | **hit** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `stutter` (19.3 px) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `arpeggiator` (24.5 px) | **hit** | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| the same, **focused** (0.1 rad) | hit | hit | hit | hit | hit | hit | hit | 2 of 3 |

("hit" = 100% of bolts connect. Effective radius is
`e.radius + max(0, 16 - e.radius)×0.8 + bolt radius 4.5`, `world.ts:2415-2416`.)

The crossover model that reproduces every cell exactly is
`range × sin(0.16) + 7 ≤ effectiveRadius`, giving **77 px for a stutter, 84 px
for a pluck, 110 px for an arpeggiator**. Beyond that, unfocused, *neither bolt
can hit a target that is not moving*.

**And the player is almost never that close.** MEASURED over a 120 s run,
sampling the nearest enemy at 10 Hz (947 samples): p10 **97 px**, p25 160 px,
**median 170 px**, p75 398 px, p90 611 px. Only **18.8%** of samples are inside
140 px.

Everything the weapon does land in real play, it lands because the *enemy* or
the *ship* crossed a bolt line. That is why the felt relationship between
pressing a direction and something dying is so weak: it genuinely is weak.

### 3.3 Live hit rate and time-to-kill — MEASURED

Six 90 s runs of the real `World`, three seeds × two policies (PARKED never
moves, KITE walks a slow circle). Bolts counted by wrapping
`playerBullets.spawn`; hits counted off the `enemy:hit` bus.

| policy | bolts | hits | hit rate | kills | kills/min | median kill gap | p90 kill gap |
|---|---|---|---|---|---|---|---|
| parked (3 seeds) | 2763 | 479 | **17.3%** | 94 | 20.9 | 0.53 s | 5.68 s |
| kite (3 seeds) | 2955 | 502 | **17.0%** | 87 | 19.3 | 1.09 s | 5.36 s |

**84% of the starting weapon's output hits nothing.** Effective dps is
36.4 × 0.17 ≈ **6.2**, against a 12 hp wave-0 pluck — about 1.9 s per kill,
which matches the 2.84 s measured in §3.4 once flight time and the fan's
duty cycle are included.

Kills arrive at **~20 per minute** — one every three seconds — in bursts
separated by gaps whose 90th percentile is **5.4 s**. A survivors-like needs
kills to be a near-continuous texture; three seconds apart with five-second
holes is a different genre.

### 3.4 The opening of a run — MEASURED, 5 seeds, identical

| | seed 1 | 2 | 3 | 4 | 5 | mean |
|---|---|---|---|---|---|---|
| first bolt fired | 0.00 s | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 s |
| **first enemy on the field** | **7.50 s** | 7.50 | 7.50 | 7.50 | 7.50 | **7.50 s** |
| first bolt connects | 9.91 s | 10.35 | 10.63 | 10.14 | 10.35 | 10.28 s |
| **first kill** | 9.92 s | 10.36 | 10.82 | 10.15 | 10.45 | **10.34 s** |
| first level-up | 46.87 s | 22.49 | 13.12 | 22.49 | 22.49 | 25.49 s |

The 7.50 s is `world.ts:723`:

```ts
this.phaseTimer = 4 * BEATS_PER_BAR * (60 / 128);   // 4 bars at 128 BPM = 7.5 s
```

**A run opens with seven and a half seconds of empty arena, then 2.84 s of
shooting before anything dies.** For comparison, the XP economy behind the
25.5 s first level-up: a wave-0 kill scatters 3 minor shards worth 1 XP each
(`progression.ts:240,287`), and L1→L2 costs 10 XP — four kills, at three
seconds a kill, if you collect every shard, which §7 shows you do not.

### 3.5 The other two starters — MEASURED

`STARTERS = ['pizzicato', 'echoes', 'chime']` (`progression.ts:435`). 90 s,
3 seeds each:

| starter | shape | hit rate | first kill | kills/min |
|---|---|---|---|---|
| pizzicato | seek, count 2 | 17.3% | 10.36 s | 20.9 |
| echoes | seek, count 2, bounces 2 | 27.1% | 11.07 s | 18.4 |
| chime | strike (no projectile) | n/a | **9.87 s** (identical every seed) | 20.0 |

ECHOES is the same `seek` shape with the same `0.32` fan (`weapons.ts:419`), so
it straddles too; its better rate comes from the bounces giving each bolt a
second and third pass. CHIME sidesteps the whole problem by not having a
projectile — and is the only starter whose first kill is *identical* across
seeds, because it is the only one that does not depend on an enemy wandering
into a bolt.

**The 10 s first kill is not a pizzicato problem. It is the 7.5 s opener plus a
kill rate of 20/min, and all three starters have it.**

---

## 4. The impact-feedback matrix

This is the table Track S was waiting for. Every cell was read from source and
the counts in §4.2 were measured off a live run.

Channels: **stop** = `camera.freeze` hitstop; **shake** = peak camera offset in
px, from `camera.ts:52` `amp = min(1,trauma)² × 22`; **flash** = `camera.strike`
full-screen flash; **local** = something drawn on the object itself;
**particles**; **sound**; **HUD**.

| Event | stop | shake (px) | flash | local | particles | sound | HUD |
|---|---|---|---|---|---|---|---|
| **enemy hit (non-lethal)** | — | — | — | white body 70 ms (`world.ts:2430`) | 1 Dot, size 3, 160 ms (`world.ts:2431`) | `sfxEnemyHit`, throttled 70 ms (`main.ts:355`) + 55 ms channel (`sfx.ts:50`) | — |
| **enemy hit (lethal)** | — | — | — | white 70 ms | 1 Dot | **none** — `main.ts:353` returns early | — |
| **enemy death (ordinary)** | **—** | **0.32** | **—** | — | burst 18 + 1 ring (`world.ts:2257-2258`) | `sfxEnemyDeath(0.35)` | score popup |
| **enemy death (big)** | 60 ms | 6.66 | **—** | — | burst 60 + ring | `sfxEnemyDeath(0.8–1.0)` | big popup |
| **player hit** | 90 ms | 15.89 | red 0.65 | invuln pulse 3.2 s | burst 40 | `sfxPlayerHit` | hearts |
| **pickup — powerup drop** | — | 5.50, *overdrive only* (`world.ts:2779`) | — | — | burst 16 | `sfxPickup(level×2)` | slot |
| **pickup — XP shard** | **—** | **—** | **—** | **—** | **1 Dot, size 2.2, 240 ms** | **NONE** | 4 px bar, top edge |
| **level-up (offer opens)** | **—** | **—** | **—** | — | **—** | `sfxPickup(7)` | banner + overlay; world stops |
| **level-up (card chosen)** | **—** | **—** | **—** | — | **—** | `sfxPickup(level)` | overlay closes |
| **fusion (from a card)** | — | — | — | — | — | `sfxWaveClear('perfect')` | banner |
| **fusion (from a boss)** | — | 14.08 | white 1.0 | — | — | `sfxWaveClear` | banner |
| **wave clear** | — | **—** | **—** | — | — | `sfxWaveClear(grade)` | banner |
| **bomb** | 120 ms | 22.00 | 0.9 | — | burst 120 | `sfxBomb` | bomb count |
| **auto-bomb rescue** | 160 ms | 22.00 | 1.0 | — | burst 140 | `sfxBomb` | — |

### 4.1 The empty cells, in priority order

1. **XP shard collection has no sound and no impact channel of any kind.**
   `world.ts:1489-1521`. It is the most frequent reward in the game and its
   entire feedback is a 2.2 px dot with a 240 ms life, plus a 4 px bar drawn at
   `y = 0` on a 1120 px field (`renderer.ts:1371-1385` — and that bar is
   *deliberately* non-reactive, by its own comment at `renderer.ts:1367`, which
   is the right call for legibility and the wrong one for feel, because nothing
   else took the job).
2. **Ordinary enemy death has no hitstop and an invisible shake.**
   `world.ts:2259-2260`.
3. **Level-up has nothing in any impact channel.** `main.ts:317`,
   `world.ts:2803-2810`. One pickup blip and a banner, for the biggest decision
   point in the run.
4. **Wave clear has no impact channel.** `world.ts:1794`.
5. **The killing blow is the one hit that makes no hit sound** (`main.ts:353`).
   The death sound is supposed to cover it, and it does — but the death sound is
   on a 70 ms channel spacing (`sfx.ts:51`) and a burst of kills collapses into
   one louder death by design (`sfx.ts:40-48`).

### 4.2 The shake curve is why "there is a screenshake" is not true — DERIVED

`camera.ts:52`: `amp = min(1, trauma)² × 22`, gated at 0.01 px, decaying
linearly at 1.6/s (`camera.ts:51`).

| `shake(x)` | peak offset | decay | site |
|---|---|---|---|
| 0.02 × heat | **0.00 px — below the gate, draws nothing** | 6 ms | camping heat, `world.ts:2563` |
| 0.04 | 0.04 px | 25 ms | field placed, `world.ts:3649` |
| 0.05 | 0.06 px | 31 ms | strike fired, `world.ts:3439` |
| **0.12** | **0.32 px** | 75 ms | **ordinary enemy death, `world.ts:2259`** |
| 0.25 | 1.38 px | 156 ms | boss phase pending, `world.ts:1130` |
| 0.35 | 2.69 px | 219 ms | well thrown, `world.ts:3739` |
| 0.50 | 5.50 px | 313 ms | well collapse 1325 / overdrive pickup 2779 |
| 0.55 | 6.66 px | 344 ms | big enemy death, `world.ts:2259` |
| 0.70 | 10.78 px | 437 ms | boss phase commit, `world.ts:1164` |
| 0.85 | 15.89 px | 531 ms | player hit, `world.ts:2627` |
| 1.00 | 22.00 px | 625 ms | bomb, `world.ts:2735` |
| 1.10 | **22.00 px** (clamped at `camera.ts:28`) | 688 ms | auto-bomb rescue, `world.ts:2697` |

The squaring is doing exactly what its comment says — *"small hits are subtle
and big ones are violent"* — but the curve is so steep that **the bottom five
call sites are all sub-pixel**, i.e. they cost a `Math.sin` and draw nothing.
Three of them are on the routine, every-few-seconds events. Note also that
`shake(1.1)` and `shake(1.0)` are the same picture, so the auto-bomb rescue is
*not* bigger than a manual bomb despite asking to be.

### 4.3 Census over a real run — MEASURED

120 s parked runs, every `shake`/`freeze`/`strike` call intercepted:

| | seed 1 | seed 2 |
|---|---|---|
| enemy hits | 279 | 431 |
| kills | 40 | 51 |
| player hits | 7 | 6 |
| XP shards collected | 92 | 108 |
| `shake()` calls | 54 | 75 |
| `freeze()` calls | 10 (930 ms total) | 9 (840 ms total) |
| `strike()` calls | 9 | 8 |
| **freezes per kill** | **0.250** | **0.176** |
| **flashes per kill** | 0.225 | 0.157 |
| **shakes per enemy hit** | 0.194 | 0.174 |
| **freezes per enemy hit** | 0.036 | 0.021 |
| **flashes per enemy hit** | 0.032 | 0.019 |
| hitstop as a share of the run | **0.77%** | **0.70%** |

Read: **over 80% of kills produce no hitstop, and 97% of hits produce no
camera response at all.** The screen is essentially inert during ordinary play.

---

## 5. Hitstop: not too much in aggregate, too much per event

`camera.ts:41-45` and `world.ts:855-856`:

```ts
let simDt = this.camera.consumeHitstop(dt);
if (simDt <= 0) return;                       // world.ts:856
```

The early return happens **before `player.update`**, so during hitstop the
player's input is completely dead. `camera.update(dt)` and `transport.advance`
run first (`world.ts:853-854`), so shake and flash still animate and the music
keeps time — that part is right, and the comment at `camera.ts:5-7` earns it.

| `freeze(s)` | ms | steps frozen | 60 Hz frames frozen | site |
|---|---|---|---|---|
| 0.06 | 60 | 8 | 3.6 | big enemy death, `world.ts:2260` |
| 0.09 | 90 | 11 | 5.4 | **player hit**, `world.ts:2628` |
| 0.12 | 120 | 15 | 7.2 | bomb `2737` / boss phase `1165` |
| 0.16 | 160 | 20 | 9.6 | **auto-bomb rescue**, `world.ts:2699` |

MEASURED total: 0.70–0.77% of a run is frozen. **In aggregate hitstop is not the
problem.** Per event it is: 90 ms of dead input at the exact moment the player
has just been hit and is trying to leave, and 160 ms on the auto-bomb, are both
past the point where a freeze reads as impact and into where it reads as the
game having hiccupped. There is no player exemption — the ship is as frozen as
everything else.

HYPOTHESIS, and it is the interesting one: the right fix is probably not
shortening these but **exempting the player from hitstop** — advance
`player.update` with the true `dt` and everything else with `simDt`. That gets
the heavy freeze *and* keeps the one object the player is holding responsive.
Doing that would mean moving the `world.ts:856` early return below the player
block, which is a real change with a real risk of desyncing the emitters, so it
belongs in its own commit with its own measurement.

---

## 6. Two input defects

### 6.1 Where `endFrame` is called

`main.ts:596` calls `input.endFrame()` inside **render**, not inside update.
`Input.endFrame` (`input.ts:261-263`) clears the `pressed` set that every
edge-triggered action reads. But update runs 0, 1, 2 or 4 times per render
depending on refresh rate (§1.3). So `pressed` is neither one-shot per press nor
reliably observed.

### 6.2 MEASURED, against the real `Input` class

Harness: construct the real `Input` with a stub `EventTarget`, dispatch a real
`keydown` for `KeyC` (a `WELL_KEYS` member, `input.ts:66`), then run `loop.ts`'s
exact accumulator and call `sample()` once per step and `endFrame()` once per
frame. 100 presses per row.

| refresh | `well: true` seen per press | presses that never reached the world |
|---|---|---|
| 30 Hz | **4.00** | 0% |
| 60 Hz | **2.00** | 0% |
| 120 Hz | 1.00 | 0% |
| 144 Hz | 0.83 | **17%** |
| 240 Hz | 0.50 | **50%** |

Consequences:

- **`world.ts:963-966` has no idempotence guard**, so one press of `C` spends
  **two** black-hole charges at 60 Hz and **four** at 30 Hz. `input.bomb`
  survives only by accident: `world.ts:951` tests `player.invuln <= 0` and
  `detonateBomb` sets `invuln = 1.6` (`world.ts:2734`), so the second sub-step
  is refused. The offer inputs survive because `applyOfferInput` returns early
  once `isChoosing` is false (`world.ts:2853`).
- **On a 144 Hz monitor, one press in six of `C`, `R`, `Q` or `1`–`4` is
  silently swallowed**; on 240 Hz, half of them.

This is a correctness bug, not a taste call, and it is the cheapest thing in
this document to fix: drain `pressed` inside `sample()` (or call `endFrame()`
after the last update sub-step rather than in render).

---

## 7. Enemy death latency and the XP loop

### 7.1 Death is one sim step late — DERIVED

`world.update` runs `updateEnemies` at `world.ts:1013` and
`collidePlayerBullets` at `world.ts:1077`. A bullet sets `e.alive = false` at
`world.ts:2435`, but the removal and `onEnemyKilled` — which is where the
particles, the shake, the shard scatter and the `enemy:death` sound all live —
happen at `world.ts:1253-1255`, i.e. at the **top of the next step**.

Cost: **8.33 ms**, plus (at 60 Hz, where the last sub-step of a frame is
followed immediately by render ~50% of the time) **one rendered frame in which a
dead enemy is still drawn at full health colour**. Small, cheap to fix, and it
is on the single most important event in the game.

There is otherwise **no death animation or fade** — the enemy is spliced out of
the array the moment it is processed. That part is correct and snappy.

### 7.2 XP shards — MEASURED

`world.ts:1466-1524`:

- pull range `210 × mods.pickupRadius` (base 1.0) = **210 px**, versus a field
  diagonal of 1437 px
- homing does not start until `n.age > 0.28` (`world.ts:1477`) — **a hardcoded
  280 ms wait**
- collection radius **26 px** (`world.ts:1489`)
- shards **expire at age 11 s** (`world.ts:1523`)
- scatter speed 90–250 px/s (`world.ts:1562`)

Measured over 90 s runs, tracking every shard from spawn to disappearance:

| policy | median kill→XP | p90 | collected | expired | collection rate |
|---|---|---|---|---|---|
| parked | **711 ms** | 825–1275 ms | 24 / 88 / 30 | 48 / 79 / 27 | 33% / 53% / 53% |
| kite | **2161 ms** | 6.8–8.6 s | 61 / 48 / 41 | 29 / 45 / 39 | 68% / 52% / 51% |

Two things fall out:

1. **280 ms of the 711 ms parked pickup latency is a hardcoded wait** — 39% of
   it, before physics has done anything. The comment at `world.ts:1449-1451`
   defends the delay as "the whole risk/reward beat of the mechanic", and that
   argument is about *drops*, which have their own separate 0.35 s float
   (`powerups.ts:246`). For XP shards there is no decision to make — you always
   want them — so the delay buys nothing and costs the confirmation tick.
2. **Between a third and a half of all XP on the floor rots.** 210 px on a
   900×1120 arena, with an 11 s fuse, is not the Vampire Survivors vacuum; VS's
   gems sit forever and its pickup radius is a *build*, which this codebase
   knows (`world.ts:1455-1465` says so explicitly) but has set the base value of
   too low for the base case to feel like anything.

---

## 8. Ranked findings

Confidence key: **MEASURED** = driven against this tree; **DERIVED** = arithmetic
on constants read from this tree; **HYPOTHESIS** = a taste judgement about what
would feel better, which nobody has played.

| # | Finding | file:line | current | proposed | evidence | confidence in the *fix* |
|---|---|---|---|---|---|---|
| 1 | XP shard collection is silent and near-invisible | `world.ts:1489-1521` | 1 Dot particle (2.2 px, 240 ms); no bus event; no sound | emit `shard:collect`; short chord-derived tick on a ~35 ms channel; ring particle at the ship | MEASURED: 92–108 per 120 s | High |
| 2 | Ordinary kills have no hitstop | `world.ts:2260` | `freeze` only when `big` | `freeze(0.03–0.04)` on every kill | MEASURED: 0.18–0.25 freezes/kill; total hitstop 0.7% of a run | High |
| 3 | Ordinary-kill screenshake is 0.32 px | `world.ts:2259` + `camera.ts:52` | `shake(0.12)` → `0.12²×22` | `shake(0.30)` (2.0 px), or change the curve to `t^1.5` | DERIVED, exact | High |
| 4 | The seek fan straddles its target past ~85 px | `world.ts:3355` | `0.26 + n*0.03` = 0.32 rad | `0.10 + n*0.01` = 0.12 rad, or converge the bolts on the target | MEASURED: 0 hits at ≥120 px stationary; 17% live | High (that it is broken); Medium (that 0.12 is the right number) |
| 5 | Runs open with 7.5 s of empty arena | `world.ts:723` | `4 * BEATS_PER_BAR * (60/128)` | `1 * BEATS_PER_BAR * (60/128)` = 1.875 s | MEASURED, identical across 5 seeds | High |
| 6 | Movement onset costs 46.4 ms / 20 px | `player.ts:39` | `ACCEL_HALFLIFE = 0.035` | `0.015`; leave `BRAKE_HALFLIFE` at `0.055` | MEASURED | High on the numbers; Medium on the taste |
| 7 | Edge inputs doubled at 60 Hz, dropped at 144 Hz+ | `main.ts:596`, `input.ts:261` | `endFrame()` in render | drain `pressed` in `sample()`; add a guard at `world.ts:963` | MEASURED: 2.00/press at 60 Hz, 17% lost at 144 Hz | Very high — a bug |
| 8 | Shards wait 280 ms before homing; ⅓–½ expire | `world.ts:1477,1466,1523` | `age > 0.28`, range 210, fuse 11 s | `age > 0.10`, range 300, fuse 20 s | MEASURED: 711 ms / 2161 ms median | Medium-high |
| 9 | Player-hit hitstop kills input for 90 ms | `world.ts:2628,2699,856` | `0.09` / `0.16`, world returns before `player.update` | 0.05 / 0.09, or exempt the player from hitstop | DERIVED + MEASURED share | Medium-high |
| 10 | Level-up has nothing in any impact channel | `main.ts:317`, `world.ts:2809` | `sfxPickup(7)` + banner | `strike(hue, 0.55)` + `freeze(0.08)` on the offer opening | read from source | Medium-high |
| 11 | Kill fx and removal are one sim step late | `world.ts:1013` vs `1077` | collide after `updateEnemies` | sweep dead enemies after `collidePlayerBullets`, or move collision above `updateEnemies` | DERIVED: 8.33 ms + up to 1 rendered frame | Medium (small win, small risk) |
| 12 | The killing hit makes no hit sound | `main.ts:353` | `if (e.lethal) return` | leave alone unless #2 lands without it | read from source | Low — it is defensible |
| 13 | Kills are 3 s apart with 5 s holes | measured, no single site | 19–21 kills/min | a consequence of #4 and enemy hp, not its own fix | MEASURED | — |

### The six to do first

Cheap, independent, and each is a single number or a single call:

**#7** (correctness, one line), **#1** (the highest-frequency empty cell),
**#2 + #3** (the second-highest), **#5** (one constant), **#4** (one constant,
and the only one that changes the *mechanics* rather than the presentation),
**#6** (one constant).

---

## 9. Things worth knowing that were not asked for

- **`camera.shake(1.1)` and `camera.shake(1.0)` are the same picture**
  (`camera.ts:28` clamps trauma at 1). The auto-bomb rescue asks to be bigger
  than a manual bomb and is not.
- **`camera.kick()` (`camera.ts:65`) has no callers in `src/`.** A directional
  recoil primitive exists, is documented, and is dead. It is exactly the channel
  an enemy hit is missing.
- **`AUTO_COLLECT_Y` (`powerups.ts:210`) is exported and imported by nothing** —
  its own comment says so.
- **The XP bar is drawn at `y = 0` of a 1120 px field** (`renderer.ts:1378`)
  while the ship's median position is mid-field. Every XP gain is confirmed
  500+ px away from where the player is looking.
- **No `latencyHint` is set on the AudioContext** anywhere in `src/audio/`.
  `sfx.ts:8` claims SFX latency "lands around 30ms"; `sfx.ts:20` adds a
  deliberate 20 ms `LEAD` on top of whatever the browser's default output
  latency is. **This was not measured** and is the one obvious remaining hole in
  the input-to-feedback chain. `docs/MASTER_PLAN.md:388` already specifies a
  `sfxlatency` gate for exactly this and it has never been built.
- **`stutter` out-accelerates the player.** A hop covers ~40 px in its first
  78 ms; the ship covers 9 px in the same window from a standstill.

---

## 10. If any of this should become a gate

Four of the harnesses used here are worth landing in `tools/`, because each one
would have caught its finding automatically and each is node-only (no browser,
no audio) so it can run in `verify-node`:

| would-be tool | asserts | would have caught |
|---|---|---|
| `feel.mjs` | ms to 90% speed, slide, first-frame travel, all driven off the real `Player` | #6, and any future halflife edit |
| `fan.mjs` | every `seek` instrument lands ≥1 bolt on a stationary target at the median engagement range | #4 |
| `feedback.mjs` | every event in the §4 matrix has ≥2 non-empty channels; peak shake ≥ 1 px wherever `shake()` is called on a routine event | #1, #2, #3, #10 |
| `edgeinput.mjs` | one synthetic press of every edge-triggered key produces exactly one `true` at 30/60/120/144/240 Hz | #7 |

Two AGENTS.md §3 warnings apply directly to writing them. **Print every
denominator** — `fan.mjs` in particular must fail if it fired zero bolts, since
"0 bolts, 0 misses" and "clean" look identical. And **measure the output, not
the source text** — a gate that greps for `camera.freeze` in `onEnemyKilled`
tests the prose; a gate that intercepts `Camera.freeze` over a real run and
divides by the kill count tests the game. Every number in §4.3 came from the
second kind.
