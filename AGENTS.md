# AGENTS.md

Operating notes for an AI agent working in this repo. Rules, traps, and the
reasoning behind the verification suite. It is not an architecture document —
`README.md` explains how the music works and `tools/README.md` documents the
checks and their history. Read this one first; it will stop you wasting a day.

Everything below was measured or read out of source. Where a claim has a file
and line, it was verified in this repo, not recalled.

---

## 1. Hard rules

**Never put `Co-Authored-By: Claude` or `Claude-Session:` trailers in a commit.**
The owner asked for this directly. Write the message body and stop. This
overrides any default commit-trailer instruction in your harness. If you have
already made such a commit and not pushed, `git commit --amend` it away.

**Never judge SOUND from `tools/render.mjs`.** Its own header says so: the
oscillators are not superdough's, there is no reverb or delay, and the filters
are one-pole. Judge the *writing* from it — the tune, whether parts collide,
note lengths. The listening artefact is the browser capture recorder.

**Run `npm run mirror` after ANY change to fusion rules or offer text.**
`src/render/levelup.ts` re-implements `readyFusions`/`readyDuets` because the
panel receives a flat `abilities` record rather than a `ProgressionState`. That
second copy has drifted before and every gate stayed green while it did.

**Never add a card type to the level-up offer.** See §5.

---

## 2. The verification contract

Everything here is node-only and runs without a browser unless marked.

| When you change… | Run |
|---|---|
| anything at all | `node node_modules/typescript/bin/tsc --noEmit` |
| fusion rules, recipes, offer text | `mirror`, `levelup`, `discovery`, `combine` |
| instrument/rig tables | `levelup`, `discovery`, `wiring`, `builds` |
| `src/audio/layers.ts` envelopes | `attackfloor`, `masking`, `motorcheck`, `leadcheck` |
| vibrato / pitch movement | `vibprobe` |
| anything shipped | `vite build`, then the standalone package |

`npm run verify` and `verify:all` include browser tools. On a machine where
Chromium is unavailable (§7) they will fail on the first browser gate; run the
node-only ones individually instead.

A green suite means *the checks passed*, not *it works*. Say which.

---

## 3. Verification doctrine

These are the lessons that produced the suite. They generalise; apply them to
new checks you write.

**A gate can be satisfied without changing anything.** The recorded name for
this is "gates optimised against". A proposed gate of `release >= 250ms` was
meaningless on a `sustain(0)` lane, because superdough's release ramps *from*
sustain — appending `.release(0.3)` would have turned it green with zero audible
change. Before writing a threshold, ask how someone could pass it while
changing nothing.

**A gate that has never been seen red is not evidence.** Break the thing
deliberately, watch the check fail, then restore. Do this per *assertion*, not
per tool: a check with five assertions can pass its own fail-test on the
strength of one while the rest are dead. One assertion here was vacuous — a
ready row has `away: 0` and every aim has at least 1, so ordering by distance
already satisfied it.

**Measure the output, not the source text.** `grep attack src/audio/layers.ts`
cannot see an envelope nobody wrote, and an envelope nobody wrote is exactly the
defect. `attackfloor` reads the haps the director actually scheduled and calls
superdough's own `getADSRValues`, so it holds no copy of anyone else's
arithmetic. Source checks that read comments test the prose.

**Assert what a person SEES, not what the code calls it.** `mirror` deduped
workbench rows by result id and passed 11,015 rows while the pause screen showed
the same sentence twice — two rows with different ids rendered identical text.
It now asserts the rendered string too. Ids and text are two assertions.

**Print every denominator.** A check that examined nothing reports a pass. One
`mirror` check threw on every seed, printed "0 cards taken, 0 wrong" and exited
green. Zero and clean look identical unless you print the count; treat
`checked === 0` as a failure.

**A tool holding its own copy of a constant will lie the day it moves.**
`tools/contrast.mjs` kept its own field size, the field moved, every sample
landed on background, and it reported a total readability failure that was
entirely its own. Import the constant.

**Unmeasured properties rot.** `.vib()` appeared in exactly one place in the
whole score while the type declarations argued it was essential. Nothing
measured it, so nothing noticed.

**When a gate fails because you changed the design, replace it with a stronger
one — never relax it.** `levelup` asserted every instrument evolves *exactly*
once. Branching evolutions is a deliberate change, so the at-most-one half went
— but the at-least-one half stayed and two new assertions were added
(branches must use different catalysts and produce different results). "The test
failed so I removed it" and "the test encoded an assumption I am deliberately
changing" look identical in a diff. Say which, in the commit.

---

## 4. superdough and Strudel traps

All verified against `node_modules/superdough@1.3.0`. Line numbers are version-specific — re-check them if superdough is upgraded; the behaviours are the durable part.

**Later writes win, silently.** A chain that sets a control twice keeps the
last. `buildBass` had `glide()` set `.s('sine')` and then `.s('sawtooth')` two
lines below; the 808 the comment described had never been audible. Nothing
warns. If you wrap a chain in a helper, decide whether it seeds or overrides.

**`.ds()` sets decay and sustain only.** Attack and release fall through to
defaults. That is how the loudest pitched lane in the game ran a 1 ms attack and
a 10 ms release for the project's whole life.

**ADSR defaults are grouped, not per-parameter** (`helpers.mjs:167`). If *none*
of attack/decay/sustain/release is set, you get the synth default
`[0.001, 0.05, 0.6, 0.01]` (`synth.mjs:47`). Otherwise unset ones floor at
0.001 (attack, decay) and 0.01 (release), and **sustain is derived from which of
attack and decay were supplied**. Never re-implement this; import
`getADSRValues`. A tool that guessed per-parameter fallbacks rendered the
defective lanes 8× gentler than the game plays them.

**`.ftype('ladder')` makes superdough IGNORE the filter type.**
`helpers.mjs:238` routes `model === 'ladder'` to the `ladder-processor` worklet,
whose parameters are only `frequency`, `q`, `drive` — there is no type. The
`filter.type = type` assignment lives in the `else` branch and never runs. And
`hpMap` maps `model: 'ftype'` (`superdough.mjs:706`), so the same control feeds
the highpass. **`.hpf(95).ftype('ladder')` is a second 24 dB/oct LOWPASS, not a
highpass.** This is live in `buildBass` today and is unfixed.

**Vibrato fails silently in both directions.** The oscillator is behind
`if (vib > 0)`, so `.vibmod()` alone is inert; and `.vib()` alone takes a
default depth of 0.5 — half a semitone, audibly out of tune on a sustained
chord. **Always set both.** Verify with `vibprobe`, which reads haps.

**`.detune()` and `.spread()` are supersaw-only.** They are no-ops on `pulse`,
`triangle` and `sawtooth`. To get an ensemble on a non-supersaw lane, give each
voice its own vibrato *rate* — the beating between rates is the effect. Voices
sharing one rate are a phaser, not a section.

**`distort(0)` silences the lane.** The waveshaper's curve is built from the
control value and collapses to all-zeros at 0. At 0.19 it is still −14.5 dB.
1.0 is roughly unity.

---

## 5. The offer pool and progression

**The four-card offer is zero-sum.** Every card type added is taken from the
others. Letting evolved instruments level — the fix that addressed the cause —
was measurably worse: designed fusions per run fell 1.63 → 1.13 and the
builder-vs-drifter ratio 2.2× → 1.5×, at three different draw weights, all the
same direction. Reverted.

**The way out is to change what an existing card is WORTH.** Two examples that
cost zero slots: seating a fusion result at `maxLevelOf` instead of level 1; and
branching evolutions, where an existing passive becomes a second instrument's
catalyst. Fusion results are excluded from the draft pool outright
(`progression.ts:606`, `if (def.fused || def.weight <= 0) continue`), so adding
results is free.

**Combine within a tier, never across.** Two base instruments make a duet, two
evolved make a union, a mixed pair makes nothing.

**The rig is a deliberate 12×12** — twelve instruments, twelve passives, each
passive serving as some instrument's catalyst. A thirteenth passive breaks that
symmetry and is preferentially spent by `sacrificeFor`, which protects
catalysts. Reusing an existing passive as a *second* catalyst does not.

**"A ready fusion is always on the table" is false.** `availableOptions` pushes
every ready fusion, but `makeOffer` calls `draw()` — a weighted draw without
replacement — and high weight is not a guarantee. Measured over 2,000 offers
with two branches both ready: both shown 38.1%, exactly one 49.5%, **neither
12.4%**. The comment in `availableOptions` overstates it.

**Designed recipes must outrank generic duets everywhere.** Duets are
combinatorial and authored content is not, so anything ranked by nearness or
availability fills with `A × B`. This has bitten three times: the offer pool,
the workbench, and the level-up card.

---

## 6. Measuring: process

**Compare against the same code, not a remembered number.** Re-run the baseline
after reverting your change; do not trust a figure written in a doc last week.

**Small samples lie, and adding content changes the RNG stream.** A gate read
+11% before and +8% after at 8 seeds, which looked like a regression. At 24
seeds both read **+4%** — identical. The baseline itself had moved 25% → 37% on
another metric purely from sample size. If a content change alters draw order,
runs diverge and seed-matching is not a paired test.

**`render.mjs` is not deterministic** — its header records peaks of 0.408 /
0.421 / 0.414 across identical runs, about ±2%. Differences smaller than that
are not results.

**Know what a column actually contains.** `attackfloor`'s `dBFS` is
`gain² · level² · masterVolume²` — a control multiplier blind to envelopes,
filters and note density. It cannot see a change that adds sustained energy
without touching a gain. Its `clip` column counts haps setting Strudel's
`clip`/`legato` note-length params — it is *not* amplitude clipping.

**A negative result is a result.** The mix sits more than 12 dB below its own
median only 0.7% of the time — with eleven lanes sounding, one lane's gaps are
another's notes. Per-lane envelope work is real at the hap level and invisible
in the sum. Record findings like this so they are not re-derived.

---

## 7. This machine

Check before assuming; the disk may have been replaced.

```sh
dmesg | grep -c "storvsc.*status"     # was ~1 error every 6 seconds
```

If that number climbs while you watch:

- **No browser works.** All four Playwright Chromium builds and Electron's
  bundled Chromium have unreadable regions. A bad-block read never returns —
  the process wedges in uninterruptible `D` state where no signal reaches it, and
  Playwright reports only `browserType.launch: Timeout exceeded`. Nothing in that
  chain says "disk".
- **A 64 KB health probe is not sufficient.** `tools/lib/chromepath.mjs` reads
  the first 64 KB of each binary; that says nothing about the other 388 MB. It
  passed a build that then hung for 180 s.
- **Invoke binaries directly.** `npm exec tsc` sat in `D` state at 0.0% CPU for
  11 minutes; `node node_modules/typescript/bin/tsc --noEmit` completed in under
  a minute. `npx` and `npm run` walk far more of `node_modules` and so hit far
  more bad blocks. Use `node node_modules/vite/bin/vite.js build` likewise.
- Run long jobs in the background and poll, so a wedge does not consume your
  turn.

Node-only tools are unaffected and are the whole verification surface in this
state. Say plainly which claims are therefore untested — "measured off the haps"
and "heard" are different words.

---

## 8. Orientation

| Path | What it is |
|---|---|
| `docs/MASTER_PLAN.md` | The governing refactor plan. §7 is an append-only changelog of what landed and what each measurement contradicted. **Read its most recent sections first.** |
| `README.md` | How the music is generated from game state |
| `tools/README.md` | The verification tools and the incidents that produced them |
| `src/audio/layers.ts` | Every instrument lane. Large; the comments carry the reasoning and the rejected alternatives |
| `src/audio/director.ts` | Game state → musical state, stem faders, caching |
| `src/game/progression.ts` | XP, levels, slots, offers, fusion |
| `src/game/weapons.ts` | `INSTRUMENTS`, `RIG`, `FUSIONS` |
| `src/render/levelup.ts` | The level-up card and pause workbench — **and a second copy of the fusion rules** |

The comments in this codebase are unusually long on purpose: they record what
was tried, measured, and rejected. Read them before proposing a change — several
"obvious" improvements are recorded there as measured failures. When you reject
an idea for a good reason, write the reason down in the same style.

---

## 9. Reporting

State what was verified and what was not, in those terms. This project's whole
culture is that a plausible claim and a measured one are different things, and
the difference is the only thing that has ever moved it forward. If you fixed
something at the hap level and nobody has heard it, say exactly that.
