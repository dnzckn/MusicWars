# TURNAROUND

The governing plan for the post-launch overhaul. Launch feedback named four
things: the music is not great, the item mechanics are nowhere near Vampire
Survivors or Ball x Pit, the arena is too small, and the game does not feel
snappy.

This document follows the house style of `docs/MASTER_PLAN.md`: §9 is an
append-only changelog, and every claim is marked MEASURED or HYPOTHESIS. Read
`AGENTS.md` before touching anything — several obvious improvements are already
recorded there as measured failures.

---

## 0. The machine changed, and it changes the strategy

`AGENTS.md` §7 describes a Linux box with a failing disk where **no browser
could be launched**, and concludes that node-only tools "are the whole
verification surface in this state." That is no longer true.

This checkout is on **Windows 11, Node v22.17.0**. Two things follow.

**The disk-failure section does not apply.** There is no `storvsc` read-retry
storm; `tools/lib/chromepath.mjs` and its whole rationale are about hardware
that is not this hardware. The four damaged Chromium builds it works around do
not exist here.

**Therefore the browser gates may run, and if they do the project can HEAR
ITSELF for the first time in its recorded history.** `AGENTS.md` is emphatic
that `tools/render.mjs` must never be used to judge sound — its oscillators are
not superdough's, there is no reverb or delay, the filters are one-pole — and
that the only listening artefact is the browser capture recorder. Every audio
change in the changelog was therefore verified *at the hap level* and never
actually heard. "Music is not great" is exactly the complaint you would expect
from a codebase that has been composing blind.

**Restoring audition is the highest-leverage single action available**, because
it converts the entire music workstream from argument into measurement. It is
tracked as Track M0 and blocks nothing else, so it runs first and in parallel.

### 0.1 The checkout had no dependencies installed — MEASURED

`node_modules/` did not exist. This produced a cascade of misleading signals
that cost real time and is worth recording so it is not re-diagnosed:

- `node node_modules/typescript/bin/tsc --noEmit` printed `MODULE_NOT_FOUND`.
  Piping it into `head` and reading `$?` reports **head's** exit status, which
  is 0 — so the typecheck looked green while never having run at all. Check the
  exit code of the process you care about, not of the pipeline.
- `verify-node` reported **29 FAILED**, every one of them in 0.1s. A suite where
  every failure takes the same suspiciously small time is crashing on startup,
  not failing assertions. `tools/levelup.mjs` passed cleanly when invoked
  directly on the same commit.

Two genuine cross-platform defects were flushed out underneath that and are
fixed in this branch (§1). The rest was the missing install.

---

## 1. Landed: the verification suite runs on Windows

Both defects were systemic rather than incidental, and both are the kind
`AGENTS.md` §3 warns about — a gate that cannot run is strictly worse than no
gate, because a red suite that is red for environmental reasons trains everyone
to ignore it.

**`new URL(x, import.meta.url).pathname` is wrong on Windows.** It yields
`/E:/GitHub/MusicWars/src/` — a leading slash in front of the drive letter —
which then composes into paths like `E:\E:\GitHub\MusicWars\index.html`. That
exact doubled drive letter is what `domwiring` reported. **17 tools** carried
the defective idiom; 10 others already used the correct
`fileURLToPath(new URL(...))`, so the codebase disagreed with itself. All 17 are
converted.

**`verify-node.mjs` spawned `sh` explicitly.** `spawn('sh', ['-c', cmd])` has no
meaning on a stock Windows box. It now uses `shell: true`, which resolves to
cmd.exe or sh per platform, and injects
`NODE_OPTIONS=--experimental-transform-types` so a check runs whether or not its
own npm script spells the flag out. That flag disagreement is real: Node 23.6+
strips types with no flag and 22.x requires it, and the scripts in
`package.json` are inconsistent about carrying it — `discovery` has it,
`levelup` does not.

Neither fix changes any game or audio behaviour. Both are pure tooling.

---

## 2. The four workstreams

| Track | Complaint | Root cause, as established | Status |
|---|---|---|---|
| **S** | Not snappy | **The gun missed.** `fireSeek` fanned bolts as `i/(n-1) − 0.5`, which never takes 0 on an even count, and the starting weapon is `count: 2` — so both bolts straddled the target and nothing was ever fired along the aim. Plus a 0.32px kill shake, a silent XP pickup, and edge inputs spent 2–4× per press | **LANDED** |
| **I** | Item mechanics | Two problems. 13 levels to a fusion, and `catalystHintLevel` silently unreachable. And 27 instruments over **7** verbs with `aura` a quarter of them, 12 passives that were all multipliers, and `Modifiers` with no trigger surface at all | **LANDED** |
| **A** | Arena too small | `PLAYFIELD_W/H = 900×1120` fixed, single screen, **no follow camera**. Blocked on the renderer, which was then unblocked (§2.1) | **LANDED** — 3000×3000 with a follow camera, see §9 |
| **M** | Music is not great | Composed blind — never auditioned in the project's whole history. Four faults, measured: bass spectrally inverted, mix 8 dB quiet, nothing above 2 kHz, and no musical unit longer than 80 s | **3 of 4 fixed**, the fourth is WIP — see §2.3 |

### 2.3 Track M: three faults closed, one open, none heard

Measured off `tools/capture.mjs`, which renders the real superdough chain. Every
comparison below is same-day and paired against a worktree, never against a
remembered number.

| fault | before | after | state |
|---|---|---|---|
| bass spectrally inverted | 99.7% of its energy in the 125 Hz band | +33 / +47 / +52 dB at 250 / 500 / 1k | **fixed** |
| 13 dB too quiet | −27.12 LUFS, peak −13.4 dBFS | **−18.84 LUFS**, crest intact at 17.7 dB | **fixed** |
| no air above 2 kHz | 2.5% | **4.3%**, +2.38 dB vs a 1.3 dB noise floor | **fixed, narrowly** |
| kick below audibility | `c1` = 32.7 Hz, 87.9% under the 44.5 Hz band | `g1` = 49 Hz, 63 Hz band **+12.7 dB at zero level change** | **fixed** |
| no unit longer than 80 s | key 80 s / theme 36 s / groove 18 s | four-act arc, three progression shapes | **WIP, unverified** |

**Two diagnoses in `research-music.md` were refuted along the way** and the
document should be read as a lead rather than as fact. Its "~19 simultaneous
pitched voices per bar" is wrong — 675,840 sampled instants give a mean of 10.4
and a maximum of 15; the 41 it was reaching for is note *events* per bar. And the
mix is not eleven lanes crowded into an octave: reconstructed from soloed stems,
**bass 41.5% + chords 29.2% + lead 25.3% is 96% of all energy**, with six lanes
20–40 dB below the floor.

**The midrange is still congested and that is left open deliberately.** 60.9% →
57.2% is real and small. The honest finding underneath is that the 250 and 500 Hz
bands *are* the pad's and the tune's fundamentals, so cutting the loudest lane
makes the ratio **worse** — measured on the reconstruction, bass at −6 dB gives
65.4%, because the bass owns the 125 band too. The only lever that reaches the
target is moving the bass down an octave, and that is a musical decision that
should not be made by anyone who cannot hear the result.

**Nothing has been heard.** `renders/F-all-32.wav` and `renders/B0-all-32.wav`
are on disk, 61 seconds each, before and after. Every figure above is a rendered
spectrum or arithmetic over one. That has been this project's defining weakness
since before this turnaround started and none of the above closes it.

### Track S and Track I: what actually shipped

**S.** Four archetypes went from unkillable-in-12s to dead in about a second
(`hitrate`, paired against a HEAD worktree on a second port). Kills/min 77.6 →
93.1 at the run level. Kill shake 0.12 → 0.28 — the old value peaked at **0.32
pixels** through `camera.ts`'s `trauma²×22`. `shard:collect` added, because the
game's most frequent reward — 92–108 per two minutes — had no audio channel at
all. Input edges now consume once instead of 2× at 60 Hz and 4× at 30 Hz.

**I.** The ladder is 3 + 3, with power at max **preserved exactly** (439 stat
fields, zero drift). Fusions per run for a naive player **0.33 → 5.67**, and
`combine` puts building at **5.7×** refusing, against 3.2× before the turnaround.
The roster is **14 verbs over 27 instruments**, one per 1.9, largest verb 19%.
Six of twelve passives now install a *rule* rather than scale a number, against a
`Rules` surface that fires in place in `world.ts`.

### 2.1 The arena is no longer blocked by the renderer

`research-camera.md` §2a called `WarpGrid` the one genuine perf cliff and nobody
had measured it. Measured twice, because once gives the wrong answer: the
JavaScript costs 0.156 ms at a 3× field (0.9% of a frame, looks free), while
**rasterising** the same lattice costs **5.0 ms — 30% of a frame**, scaling 48×
where the point count scales 8.5×. The cliff was real and the stated mechanism
was wrong: it is painted area, not point count.

`WarpGrid.draw` now takes an optional view rect. A 3× field clipped to a 1× view
costs **0.198 ms, 1.2%** — 25× cheaper. Field size has stopped being a rendering
question, and Stage 1 (the view/world split) is the next thing to build.

### 2.2 What is deliberately parked

The music overhaul was stopped mid-flight and its work is in
`git stash` — level, register separation and long-form structure, all against
measured targets (−27.39 LUFS, 66.6% of energy in 250–500 Hz, 3.2% above 2 kHz).
It was stopped because running it alongside the item work produced agents that
clobbered each other: one workflow's `git checkout` destroyed a sibling's
completed ladder change. **One agent at a time, in any file set that overlaps**
is the rule that came out of that, and it has held since.

### Track A: the finding that makes it tractable

`src/game/camera.ts` implements screenshake, hitstop and flash — and **no
translation whatsoever**. The world is exactly one screen, 900×1120, and it is a
shmup's portrait aspect ratio rather than a survivor arena's square or
landscape. `world.ts:87` already concedes this in a comment: *"DELIBERATELY
UNCHANGED BY THE ARENA CONVERSION, and this is the wrong shape."*

The encouraging half: `src/render/renderer.ts:383-387` already funnels every
draw through a single `setTransform(scale) → translate(camera.x, camera.y)`
choke point. A follow camera is an addition at one site, not a rewrite of the
renderer. The cost is in the things that assume world-space equals screen-space
— spawning, culling, and the `e.x / this.width` normalisation that feeds the
audio pan.

That comment also names the blast radius for the constant itself: the number
lives in `src/style.css` as a hardcoded `aspect-ratio: 900 / 1120` and in the
two canvas elements in `index.html`, and moving it once silently broke
`tools/contrast.mjs`, which kept its own copy.

---

## 9. Changelog

### The suite runs on Windows

17 tools converted from `.pathname` to `fileURLToPath`; `verify-node` made
cross-platform. Baseline before dependencies were installed: 29 failing, all in
0.1s, all crashes. This entry will be updated with the real post-install
baseline, which is the first honest number this branch has.

### Track M: the bass was lowpassed twice — fixed, and the second lowpass was a highpass

The "bass lowpassed twice" suspicion in the Track M row above is confirmed and
closed. It was not a stylistic duplication, it was a superdough control
collision, and it had gutted the lane.

**Mechanism.** superdough has exactly one filter-model control. `lpMap`
(`superdough.mjs:671`) and `hpMap` (:706) both map `model: 'ftype'`, and
`createFilter` (`helpers.mjs:237`) routes `model === 'ladder'` to the
`ladder-processor` worklet and returns before it reaches `filter.type = type`.
The worklet declares `frequency`, `q`, `drive` and nothing else
(`worklets.mjs:366`); it is a Moog ladder **lowpass**. So every
`.hpf(X).ftype('ladder')` in the score was a second 24 dB/oct lowpass at X Hz,
not a highpass.

**Three live sites, all in the low end**, and no others: `buildBass`
(`.hpf(95)`), and both wobble voices (`wub` `.hpf(74)`, `reese` `.hpf(180)`).
Verified off the emitted haps rather than by grep — 664,460 haps swept across
every builder, feel, section, powerup, movement, bar and boss flag: 453,180
carry `hcutoff`, 60,160 carry `ftype`, **0 carry both**. Re-introducing
`.hpf(95)` alone turns that into 48,960 colliding haps, so the count is a check
that has been seen red.

**Measured, not argued.** The real superdough chain (its dist worklets, real
haps, `OfflineAudioContext` in headless Chromium, Welch spectrum over the bar),
before and after, in dB:

| lane | | rms | 20-95 | 95-250 | 250-1k | 1k-6k |
|---|---|---|---|---|---|---|
| `buildBass` | before | -28.1 | 31.7 | 49.3 | 15.8 | -24.2 |
| | after | -11.6 | 38.2 | 64.5 | 59.1 | 50.0 |
| `wub` | before | -41.0 | 21.3 | 35.7 | -2.0 | -44.6 |
| | after | -21.5 | 29.7 | 55.2 | 47.4 | 28.9 |
| `reese` | before | -51.2 | -10.1 | 25.9 | 12.1 | -41.3 |
| | after | -34.7 | -8.0 | 40.5 | 38.6 | 17.6 |

**The fix keeps the ladder and drops the highpass**, which is the opposite of
the obvious deletion. Dropping `.ftype('ladder')` instead would have given a
working 12 dB/oct highpass, and it was rejected on three measurements: the
highpass is worth 1.6 dB of the bass's 20-95 Hz band against `buildSub`'s
52.5 dB in the same band, so it moves the summed low end by **0.05 dB**;
`.drive()` is only ever read inside the ladder branch, so the biquad render
moved **0.0 dB in every band** across the whole 0.6-1.35 drive range against a
0.0 dB repeat-render noise floor; and on the wobble a Q7 biquad is a ~17 dB peak
where the ladder's q7 is a feedback coefficient of 0.91, putting **+7.0 dB into
1-6 kHz** — the fatigue band the wobble's cutoff ceiling was capped to avoid.
`.ftype('24db')` measured the best low-end separation of the three and was
rejected too: it doubles the biquads, so `.lpq(6)`/`.lpq(7)` become stacked
peaks, and it kills `.drive()` for the same reason.

**Two things this leaves open, both recorded in the code.** Under MAGNET the
bass drops an octave to 55 Hz and now reads 58.9 dB in 20-95 Hz against the
sub's 52.5 — the highpass was worth 5.1 dB there. Accepted, because that octave
drop exists to make the floor sag and a 95 Hz highpass was cancelling the
powerup's own effect. And the lane is now ~16.5 dB louder: soloed it reads
-11.6 dBFS against the kick's -21.8 and the sub's -24.9. `attackfloor` has
always modelled it at -11 dBFS, so the gain staging was right and the filter was
cancelling it — but nobody has heard the result, and re-staging wants the whole
mix, not one soloed lane.

**Nothing here was HEARD.** Every figure above is a rendered spectrum.

**Corroborated by a second, independently built tool.** The figures above come
from a throwaway probe written for this fix. `tools/capture.mjs`, written in
parallel by another hand and pointed at the whole director rather than one
builder, agrees — bass soloed, 8 bars, world seed 0x51ed:

| octave band | before | after | delta |
|---|---|---|---|
| 125 Hz | -36.2 dBFS (99.7% of the lane's energy) | -23.4 | +12.8 |
| 250 Hz | -69.0 | -35.6 | +33.4 |
| 500 Hz | -88.8 | -41.4 | +47.4 |
| 1 kHz | -99.5 | -47.4 | +52.1 |
| rms | -36.3 | -23.1 | +13.2 |
| integrated | -26.74 LUFS | -21.15 LUFS | +5.6 |

**99.7% of the lane's energy in one octave band** is the shortest statement of
what the bug was: a bass reduced to its own fundamental, with everything that
makes a sawtooth sound like an instrument 30 to 50 dB down.

### Track I: the ladder was the reason a normal run never fused

`INSTRUMENT_MAX_LEVEL` 8 -> 3, `RIG_MAX_LEVEL` 5 -> 3, `DUET_INPUT_LEVEL` 6 -> 3,
`OFFER_TUNING.catalystHintLevel` 5 -> 2, and the XP curve re-denominated
(`20 / 18 / 60 / 150`, tiers at 11 and 21). `FUSED_MAX_LEVEL` was already 3 and
is untouched. Owner's brief: *"should basically be only 3 levels to each weapon,
then they combine and can be upgraded 3 more times."*

**The headline, MEASURED.** `tools/arena.mjs`, 20-minute runs, 8 seeds each,
before and after on the same seeds:

| | before | after |
|---|---|---|
| fusions per run, card-0 bot | **0.63** | **3.38** |
| fusions per run, builder | 2.88 | 4.63 |
| runs with any fusion, card-0 | 5/8 | **8/8** |
| level reached | 55.9 | 43.1 |
| offers opened | 54.9 | 42.1 |
| one offer every | 22.3s | 28.7s |

At three seeds — the gate's own default — the card-0 row reads 0.33 -> 3.38.
The naive player finishing a whole run having never combined anything is gone.

**The ladders were RE-AUTHORED, not truncated,** and that is checkable rather
than assertable. A probe folded every instrument and every rig item to max level
before and after and compared all ten stat fields: **319 fields compared, 12
differ, and all twelve are duets.** Every one of the twelve base instruments and
every one of the twelve rig items reaches a byte-identical stat block; the two
surviving rungs carry exactly what the seven deleted ones did. The twelve duet
fields moved because `synthesiseDuet` blends its parents at `DUET_INPUT_LEVEL`,
which is now the parents' true ceiling rather than three quarters of it. The
probe was seen red: perturbing one multiplier from 1.40 to 1.39 took it to 13.

**`catalystHintLevel` would have died silently.** It was 5, against a ceiling
that is now 3, and both of its consumers test `>= catalystHintLevel`. Left
alone it would have disabled the 2x weight on a pursued catalyst *and* the
full-rig swap card, in every state of every run, with every gate still green.
Now 2. This is the fifth constant in this repository found denominated in a unit
that moved underneath it.

**The XP curve had to move with the ladder, and this was measured, not assumed.**
A fully maxed loadout is now 20 picks. The old curve hands out 55. Over 400
simulated runs of pure `progression.ts`, grace cards — the offer generator
admitting it has nothing to sell — went from 0.9-1.2% of dealt cards to
**11.7-27.9%**, and offers that were *entirely* grace from 0.0% to 1.5-14.5%.
The steepened curve lands a 20-minute run near level 43 and puts those back to
2.7-12.3% dealt and 0.0-2.1% *taken*.

**What a player spends levels on in the late run**, measured over 400 runs at
the new offer count: instrument levels 25-32%, rig levels 25-29%, new rig 15-23%,
new instruments 12-15%, **fusion cards 11-12%**, grace 0.0-2.1%. Fusion cards
were 3.5-5.1% of picks before. The late run is no longer "which of twelve owned
things gets +1": it is spending the rig slot a fusion just handed back, and
taking the next combination.

#### Two regressions, stated plainly

**`tools/combine.mjs` fails its intent gate: 3.2x -> 1.5x.** This is the number
`AGENTS.md` §5 names as having caught two previous progression changes, so it
gets the full treatment. **Designed fusions per run went UP on both sides** —
splitting the count by whether the result is actually a row in `FUSIONS`, a
committed builder went 1.63 -> 2.88 authored evolutions per run and an
inattentive card-0 player went 0.63 -> 2.00. The ratio fell because the floor
rose to meet the ceiling, not because the ceiling fell. That is the opposite
mechanism from the 1.63 -> 1.13 incident, and it is a real design cost: with 20
picks of content and 42 offers, a player who is not building at all still
completes most of what their slots line up, so committing buys less than it did.
The gate is left RED rather than relaxed. Fixing it means making picks scarcer
than the level count already makes them, which is a slot-count or offer-size
decision and not this change.

Related, and worth recording because it inflates both columns: `combine.mjs`
counts `ability:union` as designed content, but `readyDuets` emits that event for
*any* two fused instruments, whose result is a synthesised `a+b` id and not one
of the two authored unions. Generic unions per run, committed: 0.38 -> 1.13.

**`tools/arena.mjs` fails its encirclement gate: p90 0.49 -> 0.19 against a floor
of 0.25.** The player completes their build in a third of the time, so they are
much stronger for most of the run — card-0 nominal dps 806 -> 2427, kills/min
110 -> 155, enemies on field p90 28.3 -> 14.1. Max power did not change; the time
to reach it did. Steepening the XP curve recovered most of it (0.03 at the
ladder change alone, 0.19 after) and a further step to ~39 offers bought only
0.21 while costing 0.38 fusions per run, so the curve is not the binding factor.
**The remaining fix is enemy scaling in `world.ts`**, which this change was
forbidden to touch and which is the right place for it anyway.

**`tools/openers.mjs` still passes but the margin narrowed: 81% -> 74% at the
gate's three seeds, 86% -> 79% at eight.** ECHO CHAMBER remains the binding
opener, as the CHIME note in `weapons.ts` predicted it would be. The mechanism is
that all three openers now reach max inside the 240s window, so the measurement
is closer to a pure comparison of ceilings; the ceilings themselves did not move.
The threshold was not relaxed.

**`tools/builds.mjs` moved the other way, and it is the wider question.** Policy
spread in wave reached 0.77 -> 1.30, seed spread 2.91 -> 3.51, ratio 0.27 ->
0.37 — and the gate's own note says a ratio drop only matters if policy spread
fell with it. It rose. Across seven pick policies the choice matters *more* than
it did; what `combine` measures is narrower — chasing one named recipe against
taking card zero — and that specific gap is what closed.

**Fail-tests run, per assertion.** `levelup` was seen red three separate ways
(a steps array one short: "chime has 1 steps, want 2"; a rig ladder one short:
"rig laser has 2 levels, want 3"; a step that loses dps: "tremolo L3 is weaker
than L2"). `mirror` was seen red by making the second copy of the duet threshold
in `render/levelup.ts` disagree by one — 1757 of 4000 loadouts and 3070 of 12274
workbench rows — and green again on restore, with every denominator non-zero.

### Phase review: what survived the skeptics, and what did not

Three build tracks closed in this phase — a capture tool, a bot de-biasing pass
ahead of the arena refactor, and the bass filter fix recorded above — and each
was handed to an independent reader whose only job was to break it. Two were
broken. This entry records the state after that pass, because a changelog that
reports only the builder's own account of a change is the failure mode this
document exists to prevent.

**What is now true, in the project's own vocabulary.** The bass fix is MEASURED
and it is the strongest result of the phase. Its mechanism was re-derived from
`node_modules/superdough@1.3.0` source by someone who had not written it —
`helpers.mjs:219` `createFilter`, the `model === 'ladder'` branch at :237 that
returns before `filter.type = type`, `worklets.mjs:366-370` declaring exactly
`frequency, q, drive`, and `worklets.mjs:404` `Math.min(8, resonance * 0.13)`
giving the q7 feedback coefficient of 0.91 that the wobble argument turns on.
The site list reproduced to the hap: 664,460 haps swept, 453,180 carrying
`hcutoff`, 60,160 carrying `ftype`, **0 carrying both**, and the six
`hcutoff`-without-`ftype` builders at 31,500 / 127,360 / 47,840 / 280 / 158,200 /
88,000 each. Re-injecting `.hpf(95)` produces 48,960 colliding haps. The
after-state render figures reproduced independently — bass -11.6 dBFS at peak
1.28, sub -24.9, kick -21.8, MAGNET 58.9 dB in 20-95 Hz. And a gate the fix's
author never ran, `tools/mixaudit.mjs`, was run against a live dev server and
passes: every layer reaches the speakers, bass is now the loudest stem, no lane
reads BURIED, and its real-mix fader average of 0.22 means nothing clips in
situ. The +16.5 dB does not break the mix gate. Two soloed figures drifted
slightly between runs (chords -23.4 vs -24.3, lead -27.4 vs -27.5), consistent
with concurrent edits in a shared tree rather than with a disagreement.

`tools/capture.mjs` reproduced every headline number on a foreign run: the
octave-band table, the calibrated selftest (1 kHz -20 dBFS sine reading -23.0
dBFS / 100.0% in band), the render non-determinism result of five distinct WAVs
over one identical hap stream with a worst spread of 1.329 dB in the 500 Hz
band, and the reverb impulse-response race — 49 side renders across 4 buses
whose `convolver.buffer` assignment nothing joins on, inherited from
`@strudel/webaudio`'s own `renderPatternAudio`. The bot de-biasing is a
byte-exact no-op today, and that was confirmed the hard way: a foreign `arena`
run diffs against both saved outputs with exactly one differing line, the node
PID in the ExperimentalWarning. `Math.min(900, 1120) * (110/900) === 110` is
exactly true. There is no ninth copy of the wall term. `world.ts` really was
restored, CRLF and all.

**What no amount of this makes true: nothing has been HEARD.** Every audio
figure in this phase is a rendered spectrum out of an `OfflineAudioContext`. The
synthesis path is real — superdough's own worklets, its ladder, its
waveshaper — so these are not `render.mjs` numbers and they are admissible about
tone. But `renders/capture-all-16.wav` sits on disk and no person has played it.
The MAGNET regression and the new lane level were both decided on numbers alone
and both were flagged as wanting a listen by the person who made them.

**Refuted: the capture tool's "dead filter chain" finding.** The tool shipped
with a side finding that `layers.ts`'s `.lpf(m.sig.openness.range(500, 2300))
.ftype('ladder')` "never runs in the state this captures — the `wub` branch
returns first" and that "editing it moved nothing at all." That is false, and it
is false by an order of magnitude over the tool's own noise floor. `m.feel` is
not `halftime` for every bar; `basscheck` prints the wave rota as halftime 38%,
boomchick 25%, chase 13%, gallop 13%, shuffle 13%, and the `return stack(` early
exit for the wobble path is reached only on the first of those. Measured at the
exact sha the finding pins: 12 of the 44 bass haps carry cutoff 1156.0-1674.5 Hz,
which is `range(500, 2300)` evaluated at openness 0.364-0.652; the other 32 carry
679.7-802.9 Hz from the `wub` range. Patching that one line to `range(50, 60)`
moved 125 Hz by -12.4 dB, 250 Hz by -8.4 dB, and integrated loudness by 13.4 LU,
and changed the hap-stream sha1 from `03c063b4f65f` to `a129aa5c9870` — which is
what proves the control reaches superdough rather than being computed and
discarded. Against a 1.4 dB full-mix noise floor and a 0.019 dB bass-stem spread
this is not ambiguous. "Editing it moved nothing" means the edit was made and
never measured. **The false sentence is currently written into `tools/README.md`
in the working tree** and must be corrected before that file is committed; a
wrong statement in the tools doc is worse than no statement, because the next
agent reads it as established.

**Refuted: `--verify-determinism` cannot tell a score change from a render
change.** `capture.mjs` spawns N clean child processes and compares their WAV
bytes; each child prints its own hap-stream sha1, and the parent throws that
output away — `res.stderr` is read, and only when `res.status !== 0`. The score
half of the check re-derives the score in-process, before any child runs, so it
structurally cannot see a source edit that lands *during* the reruns. That is
precisely the incident the tool's own header brags about having caught once.
It was then caught doing it: a `--verify-determinism=4` run printed "score:
reproducible" and "worst octave-band spread 12.646 dB, in the 125 Hz band" while
another session re-added `.hpf(95)` underneath it. The 12.6 dB was a score
change wearing a render change's label. The 1.329 dB figure above is therefore
trustworthy only because that tree happened to be quiet; the check does not
certify itself. The fix is three lines — compare each child's printed sha1
against the parent's and fail on mismatch.

**Refuted: the de-biasing pass converted one constant out of six.**
`tools/lib/bot-brain.mjs:120-122` asserts that "the player model is pinned to a
scale-invariant form BEFORE the field moves." Five other field-scale pixel
constants sit untouched in the same hundred-line function, in all eight copies:
the bullet-fear radius `190` (twice), the danger threshold `90`, the enemy-reach
margin `70`, the pickup-pull radius `300` (twice), and the focus distance `70`.
The reason given for stopping does not hold — `Math.min(900, 1120) * (c/900)`
returns exactly `c` for 190, 90, 70 and 300 as well, re-checked in node, so
every one of them was available as the same zero-diff one-liner. And they matter
as much as the term that was converted. Running the pass's own §3a protocol at
`PLAYFIELD_W = 1080`, wall-only against all-six, moves **118** arena lines,
against the **116** that the wall term itself was credited with. Headline rows
move with it: run 1 goes wave 31→28, kills/min 68.8→59.9, hits taken 1→6. The
silent re-baseline that Stage 0b exists to prevent is still fully in place,
routed through the two largest radii in the brain. This is a scope failure, not
a correctness one — nothing written is wrong except the comment claiming the job
is done.

**Downgraded: "the check has been seen red and restored."** For the hcutoff /
ftype collision this overstates what exists. What went red was a printed integer
in a throwaway probe that is not in the repo, does not run as preserved
(`ERR_MODULE_NOT_FOUND` on a relative import, plus a hardcoded `.probe-tmp/`
path that no longer exists), and whose only `process.exit(1)` fires on a zero
denominator, not on a collision. No tool in `tools/` mentions `hcutoff` except a
comment in `capture.mjs`, which is itself untracked. Nothing in `verify` or
`verify:all` can see a re-introduction of the bug. Worse, `AGENTS.md:136` still
reads *"This is live in `buildBass` today and is unfixed"* — the mandatory
context file now actively misinforms the next agent about the exact defect this
phase repaired. Being seen red once by a human is worth something; it is not a
gate, and it should not be written down as one.

**The suite, honestly.** `tsc --noEmit` exits 0. `verify-node` runs 36 checks in
14.6 minutes with **one** failure, `leadfreeze`, and zero environmental
failures — the 29-crash baseline recorded at the top of this document is fully
cleared. `leadfreeze` is an assertion failure, not a crash: it printed its own
denominators, 3456 rows compared and 1728 differing. It is pre-existing, checked
in a throwaway `git worktree` at HEAD rather than assumed, where it gives the
identical 1728 rows across bass 576 / chords 576 / motor 576. Diffing the row
sets rather than trusting two matching totals: the working tree differs from HEAD
in 576 rows, all bass, and the count of rows that matched the saved baseline at
HEAD but differ in the working tree is **0**. The `.hpf()` removals move
`buildBass` in every one of its 576 states and do not newly break the gate. The
baseline is stale from earlier committed motor/chords drift, and a `--save` now
would bake that drift in as well as the deliberate bass change. `basscheck`,
`arena` and `brain` are green; `contrast` exits 1 against a live dev server at
lowest 30, where HEAD exits 1 at lowest 32 — pre-existing red, though the number
did move, because the synthetic bullet ring was re-centred off the live field.
That is a real behaviour change in a tool reported as a hardening pass, and it
should be called one.

**Verdict on the tree.** Safe to commit, in three separate commits, after two
text corrections: the "dead filter chain" paragraph in `tools/README.md`, and
`AGENTS.md` §4's "live today and unfixed" line. No source change in the tree is
in dispute — what was broken was two claims about source, and one claim about
scope. The single highest-leverage next action is not on this list: it is to
play `renders/capture-all-16.wav`. This phase made the largest audio change in
the project's history on spectra alone, and the artefact that would settle it
already exists and is 31 seconds long.

### The arena's blocker was measured, and one tool would have cleared it wrongly

Recorded because the two-tool result is the transferable part, not the fix.

`docs/research-camera.md` §2a has said since the first day of this turnaround
that `WarpGrid` is *"the one genuine perf cliff"* between this game and a bigger
arena, on the grounds that it materialises the whole field every frame — 285
points now, 2420 at 3×, ~88% of them off screen. Every plan since has sequenced
the arena behind it. Nobody measured it.

**`tools/gridcost.mjs`** times the JavaScript against a recording context:
0.018 ms/frame today, 0.156 at 3×. That is **0.9% of a 60 Hz frame**, and on that
evidence the cliff does not exist and the arena is free.

That evidence is wrong. A recording context counts `lineTo` calls; it does not
draw them. The call count goes 536 → 4741, and strokes are the expensive half of
a Canvas2D frame.

**`tools/gridraster.mjs`** draws the same lattice into a real canvas in Chromium
and flushes with a 1×1 `getImageData` — without which the clock measures how long
it took to *queue* the work:

| field | points | ms/frame | of 60 Hz |
|---|---|---|---|
| 900×1120 | 285 | 0.104 | 0.6% |
| 1800×1800 | 900 | 0.443 | 2.7% |
| 2700×3360 | 2420 | **5.002** | **30.0%** |
| 3× field, **1× view** | 2420 | **0.198** | **1.2%** |

Cost scales 48× where points scale 8.5×. **So the cliff was real and the stated
mechanism was wrong** — it is the area being painted, not the number of points,
and a fix aimed at point count would have missed it entirely.

The lesson generalises and is why both tools are kept rather than the winner: a
stub that counts calls measures the half of a renderer that is usually cheap. It
is the same shape as the `attackfloor` note in `AGENTS.md` §6 — knowing what a
column actually contains — and the same shape as `combine`'s control, which was
accidentally valid until the thing making it valid moved.

Culling is by whole rows and columns rather than per segment, because the two
inner loops are flat passes over a typed array and their speed is in not
branching per point. The view argument is optional, so this is a numeric no-op
until something has a camera to pass; `gridcheck`, `flicker`, `framecheck` and
`effectsdraw` passing is the evidence for that.

### Track A: the arena is 3000x3000 and the camera follows

Stages 4, 5 and 6 of `docs/research-camera.md` §9. The field went 900x1120 ->
**3000x3000, square** — eleven times the area — and a follow camera with a
deadzone shows one 900x1120 window of it. This is the first change in the whole
arena track a player would notice.

**Stage 4 was a bit-exact no-op except where it was meant not to be, and that
is the interesting part.** `edgePoint`/`arenaSpawnPositions` now take a
`SpawnRing { cx, cy, w, h }` instead of a field width and height; `spawnGroup`
passes the VIEW centred on the camera; the boss enters on that ring and orbits
an anchor captured at spawn with a `VIEW`-derived radius; `hasEntered` is
view-relative. With the field still one screen, `tools/arena.mjs` was
**bit-identical to the pre-stage baseline** with every one of those in place.

The one place it was not was `spawnBoss`'s entry point, and the reason is worth
recording. `edgePoint(-Math.PI / 2, ring, 120)` is the same point as
`(cx, cy - h/2 - 120)` in exact arithmetic, but `Math.cos(-Math.PI/2)` is
6.1e-17 rather than 0, which puts the boss **4e-14 px** off centre — and a
twenty-minute run amplified that into a visibly different run (one of three
diverged: level 73 -> 72, kills/min 155.4 -> 155.9). The line is written as
arithmetic instead, which is what makes the no-op provable rather than
plausible. A twenty-minute simulation is a chaotic system and 4e-14 is inside it.

**The retreat vector was the only deliberate behaviour change in Stage 4**, and
it is measurably free: enemies now flee away from the PLAYER rather than
radially out from the middle of the field. `escaped` per wave 8.58 -> 8.53,
kills/min 188.2 -> 188.2, encirclement p90 0.32 -> 0.32.

**The pan was a stereo position wearing a coordinate's name.**
`world.ts` emitted `enemy:fire` with `x: e.x / this.width` and `sfx.ts` used it
as a pan. On a 3000px field the player and everything that can shoot at them
occupy under a third of that range, so it collapses toward whatever fraction of
the arena the player is standing at — the exact `s.playerHeight` failure this
codebase has already diagnosed once. It is `clamp01(0.5 + (e.x - player.x) /
VIEW_W)` now, "which side of me", and **the event field was renamed x -> pan
so `tools/battlefield.mjs` had to be edited rather than inherit a column whose
definition had moved**. That tool measures `panSpread` 0.98-1.00 against a 0.4
threshold.

#### The density result, which is the thing that decides whether this is a win

`docs/research-density.md`'s headline was falsified once already; the risk it
named — spread the same enemies over 11x the floor and the game gets emptier —
was real and had never been measured, because **nothing measured on-screen
population at all**. `tools/arena.mjs` recorded `w.enemies.length` under the
label "enemies", which was honest while the world was one screen and is a
different question now. It reports both:

| p10 / p50 / p90 / max | 900x1120 | 3000x3000 |
|---|---|---|
| enemies **alive** (whole field) | 0.0 / 7.0 / 21.0 / 42.0 | 0.0 / 7.7 / 25.3 / 53.0 |
| enemies **ON SCREEN** | 0.0 / 2.7 / 13.0 / 34.3 | 0.0 / 2.3 / 12.3 / 33.7 |
| **encirclement** | 0.00 / 0.04 / **0.32** / 0.82 | 0.00 / 0.04 / **0.32** / 0.82 |
| bullets on screen | 0.0 / 3.7 / 33.3 / 131.7 | 0.0 / 3.0 / 30.3 / 186.0 |

**Encirclement p90 is identical to three significant figures, against a gate of
0.25.** On-screen population is down 15% at the median and 5% at p90. The arena
is eleven times the size and the player is exactly as surrounded — and the
reason is structural rather than lucky: the spawn ring is the VIEW, so groups
arrive at the same distance from the player they always did. Enemies were never
distributed over the field; they were always distributed around the player.

Note also that on-screen p50 of 2.7 was ALREADY far below alive p50 of 7.0 at
one screen, because enemies spawn 70px outside the rectangle and are culled
320px outside it. A third of the population has always been off screen. Any
future density work should be denominated in the on-screen column.

#### What had to move to the view, and the one thing that deliberately did not

Growing the field silently changed four rectangles that had been the view all
along. Each was measured, not assumed:

- **Bullets, and this one cost real progress.** Player bolts were culled at
  `field + 60`, so they flew 3000px instead of 900 and killed things off screen
  — whose shards were then abandoned, because the pickup pull is 210px. Shards
  collected per kill fell 6.05/6.34 -> 3.82/4.40 and level-at-20-minutes 69.3 ->
  61.0: **more kills, less progress**. Enemy bullets meanwhile accumulated off
  screen, alive p90 39.7 -> 73.3 and peak 148 -> 230, while the number ON SCREEN
  did not move. Both pools are culled against the view now, and so is the
  wall rectangle player bolts bounce off — which is what keeps
  `InstrumentStats.bounces` from going inert again, since "a bounce has to land
  on the wall the player can see" and on an 11x field the only such wall is the
  edge of the view.
- **Drop despawn.** `updateDrop` kills a drop past `height + 40`; that floor is
  the bottom of the view, not of a field two and a half screens further down.
- **The population floor.** `targetOnScreen()` was compared against every enemy
  alive anywhere. It is compared against `populationNearPlayer()` now — the view
  plus 200px, enough to cover the ring and the deepest formation stagger. Worth
  saying that this moved almost nothing (on-screen p90 11.0 -> 11.7), exactly as
  the existing note on that function predicts: the floor pulls scheduled groups
  forward and cannot manufacture enemies a wave does not contain. It is in
  because the comparison was wrong, not because it was the lever.
- **Enemy culling stayed on the FIELD, and that was tested.**
  `research-camera.md` §4 predicted that camera-relative culling would make
  `escaped` fire for enemies that are alive and chasing. It does:

  | cull rect | escaped/wave | on screen p90 | encirclement p90 |
  |---|---|---|---|
  | view +/- 320 | 13.27 | 10.3 | 0.31 |
  | field +/- 320 | 3.48 | 12.3 | 0.32 |
  | (one screen, before) | 8.58 | 13.0 | 0.32 |

  The view version ran 55% ABOVE the one-screen escape rate and was emptier
  with it — it was deleting the crowd the player was outrunning. `CULL_MARGIN`
  is therefore also not retuned: shrinking it is the same move and lands in the
  same place.

**A new gate, because this one stopped being true by construction.**
`tools/spawnring.mjs` asserts that no ARRIVAL lands inside the view rect as it
stood at the moment of the spawn. Until the camera moved that was guaranteed by
`arenaSpawnPositions` casting its ray from the middle of the only rectangle
there was; there are now three ways to break it that do not throw. Its first
draft went red on 427 of 2428 spawns, every one an `echo` appearing on top of
the player — which is not an arrival but a SPLIT, born from a death the player
caused, and appearing in view is the point of it. So the population is
classified and both counts are printed. All four of its assertions have been
seen red on purpose. 8945 arrivals over three 20-minute runs, zero inside the
view, closest 46.4px — which is `SPAWN_MARGIN * cos(corner angle)` and is the
right answer.

#### Stage 6: the tools that were going to lie

`tools/contrast.mjs` has now been broken twice by the same class of mistake, and
the second time is the instructive one. Version one hardcoded 720x960. Version
two read the live field size off the running game — strictly better, still
wrong, because it assumed **the canvas shows the whole field**. It reads the
VIEW RECT now, origin included, and translates every world coordinate by it.
Fail-tested by putting the field mapping back: worst bullet/background distance
collapses from 399 to **0** and the tool reports a total readability failure
that is entirely its own, for the third time.

`levelshot` and `levelupdraw` take the view from the game and from `field.ts`
respectively instead of two hardcoded 900x1120 pairs. `flicker`'s boundary
jitter was `w.height * 0.006` — 6.7px on the old field and 18px on the new one,
so the check would have got 2.7x harsher with no diff; it is 6.7 pixels.

And a note on the Stage 6 gate itself, which asks that each repaired tool be run
with `VIEW_W` 20% off and confirmed to move. `levelupdraw` and `effectsdraw`
both import the constant and both produced **byte-identical output at 900 and at
1080**, because every verdict they hold is deliberately size-invariant — they
sweep four sizes precisely so that no single one matters. An import that cannot
be told apart from a hardcode is not evidence of anything, so both now PRINT the
geometry they read. That is the whole fix and it is the point of the gate.

`tools/battlefield.mjs` was pointed at `jumpToWave(15)` — which, with
`BOSS_EVERY = 8`, is **wave 16, a boss wave**, and a boss wave's `planWave`
emits seven enemies in total. It got away with that while the whole field was on
screen; once enemies only fire in VIEW it produced 3, 20 and 35 volleys across
three consecutive runs against a threshold of 20. Re-pointed at index 16 — wave
17, difficulty saturated, 31 enemies — with **the threshold unchanged**. It now
sees three or four archetypes and a pan spread of 0.98 to 1.00.

#### Feel: judged, not measured

`Camera.follow` snaps on its first frame (`centreOn`). Without it, `reset()`
puts the view at the origin while `World.start()` puts the ship at 1500,1500,
and every run opened with a second of the camera flying across the map — and
worse than cosmetic, because the spawn ring and the bullet cull are both derived
from the view, so the first wave would arrive around a rectangle that was still
moving.

Driven in Chromium for 42 seconds: the view tracks over 448px of x and 382px of
y, the ship holds a **mean 82px / max 140px** offset from the view centre
(inside the 144x157 deadzone), the clamp lands exactly on `(2100, 1880)` at the
far corner, and nothing clips or tears at the view edge. Deadzone, lookahead and
smoothing remain the three numbers in this refactor that no gate can judge.

**Two costs that are findings and not passes.** Level at twenty minutes is
69.3 -> 65.0 and offers arrive every 17.7s -> 18.8s. `docs/progression.md`'s
stated target is "one offer every 18s", so the pacing moved TOWARD the
documented figure; its level-pacing row (`1m L4 3m L12 5m L19 8m L28`) is a
pre-ladder number that the game already overshot before this change and still
overshoots (`1m L4.7 3m L21.0 5m L31.3 8m L41.7`), so that table does not hold
and did not hold before. Fusions per run are **5.67 unchanged on both policies**,
which is the metric the item workstream exists to protect.

---

## 10. Where this stands, and what is left

Twenty-eight commits. Three of the four launch complaints are closed and the
fourth is three-quarters closed.

**Snappy — closed.** The gun straddled its target on every even bolt count and
the starting weapon is `count: 2`, so nothing was ever fired along the aim; four
enemy archetypes went from unkillable-in-twelve-seconds to dead in about one. A
kill shook the screen by 0.32 pixels. The most frequent reward in the game — 92
to 108 shard pickups every two minutes — made no sound at all. One keypress spent
two wells at 60 Hz and four at 30 Hz.

**Items — closed.** 3 + 3 ladder with power at max preserved exactly across 439
stat fields. Fusions per run for a naive player **0.33 → 5.67**, and building is
worth **5.7×** refusing against 3.2× before. Fourteen verbs over twenty-seven
instruments where there were seven, largest verb down from 26% to 19%. Six of
twelve passives install a rule rather than scale a number.

**Arena — closed.** 3000×3000 square with a follow camera, eleven times the area,
and encirclement *identical* at p90 0.32 because the spawn ring is the view.

**Music — 3 of 4.** See §2.3.

### The three things worth doing next, in order

1. **Play the two WAVs.** `renders/B0-all-32.wav` and `renders/F-all-32.wav`.
   Every audio decision in this turnaround was taken on a rendered spectrum, and
   the one remaining lever on the midrange — dropping the bass an octave —
   cannot honestly be pulled by anyone who has not heard it.
2. **Finish the long-form arc, or revert it.** The code is committed and
   unverified. The test is specified: render 96–128 bars and analyse over *time*,
   not as one aggregate. If a long render still reads flat, the form is in the
   source and not in the sound, and it should be said plainly and the commit
   reverted rather than left as a claim.
3. **Fix the five gates that were red before this turnaround started** and have
   stayed red throughout: `attackfloor`, `wellcheck`, `registercheck`,
   `counterpoint`, `subcheck`, plus `leadfreeze`'s stale golden baseline,
   `touchcheck`, and four `levelshot` roster assertions. Every one was verified
   pre-existing rather than assumed, and none was ever a licence to ignore them.

### The rule that came out of this, and it is the transferable part

**One agent at a time in any overlapping file set.** Two workflows running
concurrently produced agents that clobbered each other — one ran `git checkout`
and destroyed a sibling's finished level-ladder change, which had to be rebuilt
from scratch. Every agent brief since carries an explicit prohibition on git
commands that discard working-tree changes, and the instruction to undo a
fail-test with another edit instead. Nothing has been lost since.

**And the other one: measure the thing, not a proxy for it.** This turnaround
found the same failure five separate times — a `combine` control that was
accidentally valid until fusion cards became common; a `LOCKED` figure that
over-counted 2.5× because it never asked whether the card would have been dealt;
a `gridcost` reading that cleared the arena's blocker because a recording context
counts strokes without paying for them; a `deadhunt-ranges` row that reported
`mods.homing` live at 14.98% while every level steered identically; and a
`levelup` assertion that a note is "described and non-empty" passing on four
notes the card physically could not draw. In each case the proxy was reasonable
when written and stopped being reasonable when something underneath moved.
