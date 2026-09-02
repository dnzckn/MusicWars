# Dubstep, for this score

Research for the rewrite of `src/audio/`. Written so a builder can act on it
without re-reading the sources.

**Marking convention.** Every claim carries one of these, and the difference is
the point:

| Mark | Means |
|---|---|
| **[MEASURED]** | I rendered it or queried it in this repo, today. Numbers are from that run. |
| **[READ]** | Read out of `node_modules/superdough@1.3.0` or `@strudel/core@1.2.6` source. Not heard. |
| **[SOURCE]** | Reported from a cited web source. Someone else's claim, in my words. |
| **[REASONING]** | My inference joining the above. Weakest category; treat as a hypothesis with a test attached. |

**Nobody involved in this can hear the game.** Everything below is haps,
rendered spectra and source. The owner's ears are the only ground truth we have
had. §7 says, per recommendation, what would show whether it landed.

Tools used for the measurements: `tools/capture.mjs` (works on this box today —
its `--selftest` returned a calibrated 1 kHz sine at -20.0 dBFS with 100% of
energy in band), plus three throwaway probes run against real superdough in a
real headless Chromium and against `@strudel/core` under
`tools/lib/headless-audio.mjs`. The probes were scratch files; their outputs are
transcribed here in full so nothing has to be re-run to read this.

---

## 0. Three things in the brief are wrong, and one of them is load-bearing

Read this section before anything else. Two of these are in `AGENTS.md`, and a
recommendation that trips a real trap is worse than no recommendation — but so is
a constraint that forbids something safe.

### 0.1 `distort(0)` is a clean bypass. It does not silence the voice. **[MEASURED]**

`AGENTS.md` §4 says:

> **`distort(0)` silences the lane.** The waveshaper's curve is built from the
> control value and collapses to all-zeros at 0. At 0.19 it is still −14.5 dB.
> 1.0 is roughly unity.

That is **not true of superdough 1.3.0**. Rendered through the real chain — one
sawtooth at 110 Hz, `gain 0.5`, ADSR `0.02/0.05/1/0.05`, no gain curve, analysed
over the steady middle of the note:

| `.distort()` | RMS dBFS | peak | h1 | h2 | h3 |
|---|---|---|---|---|---|
| control absent | **-22.69** | **0.1478** | -21.8 | -27.8 | -31.4 |
| `0` | **-22.69** | **0.1478** | -21.8 | -27.8 | -31.4 |
| `0.19` | -21.21 | 0.1734 | -20.3 | -26.4 | -29.9 |
| `1.0` | -15.31 | 0.3204 | -14.2 | -20.9 | -24.3 |
| `3.0` | -5.14 | 0.7769 | -3.2 | -14.5 | -15.0 |

`distort(0)` and "no distort at all" are **bit-identical**. And `0.19` is
+1.5 dB, not −14.5 dB.

The mechanism, **[READ]** from `worklets.mjs:429-462`: the distortion is an
AudioWorklet computing `postgain * algorithm(x, Math.expm1(distort))`
per sample. `expm1(0) === 0`, and the default algorithm is
`_scurve(x, k) = ((1+k)x)/(1+k|x|)`, which at `k = 0` is exactly `x`.
`postgain` is `clamp(distortvol, 0.001, 1)` and `distortvol` defaults to `1`
(`superdough.mjs:188`). There is no curve table any more; the version the
AGENTS entry describes built one with `makeDistortionCurve`.

**Why this matters more than a documentation fix.** The whole score is written
around the hazard. `buildBass` carries `.distort(m.sig.drive.range(1.05, 1.8))`
and `.drive(m.sig.drive.range(0.6, 1.35))`; `wobble.ts` hard-codes
`.distort('3.0:0.30')` and `'3.2:0.28'`. Those floors mean **the bass is
saturated at its calmest moment exactly as much as at its loudest** — there is
no clean state to drop *from*. Removing the floor is the cheapest way to make
the drop a timbre event (§4, R2).

**Do not take my word for it.** The re-measurement is one command
(§7, M1). Update `AGENTS.md` §4 in the same commit that removes the floor, and
say in the commit that the entry was tested and found version-stale, not that
the test was removed.

### 0.2 The circulated "canonical Strudel wobble" is a no-op **[MEASURED]**

The idiom that turns up when you search for dubstep in Strudel is a preset
[documented on strudel.cc](https://strudel.cc/learn/lfo/):

```js
wobble: x => x.lpf(sine.range(200, 1500).fast(4)).lpq(8)
```

Queried against `@strudel/core@1.2.6`:

```
A) note("c2").lpf(sine.range(200,1500).fast(4)).lpq(8)     4 haps
     0.0000..0.2500  note=c2  cutoff=850.0
     0.2500..0.5000  note=c2  cutoff=850.0
     0.5000..0.7500  note=c2  cutoff=850.0
     0.7500..1.0000  note=c2  cutoff=850.0

B) note("c2*4").lpf(sine.range(200,1500).fast(4))          4 haps, all cutoff=850.0

C) note("c2*16").lpf(sine.range(200,1500).fast(4))         16 haps
     cutoff = 850, 1500, 850, 200, 850, 1500, 850, 200, ...   (a 4-step staircase)
```

Two findings:

1. **On a held note it produces a constant filter at 850 Hz.** A continuous
   signal used as a control shatters the note into haps at its own rate, and
   each hap samples the signal at its midpoint — which for `sine.fast(4)`
   against a whole note lands on the zero crossing four times running. 850 is
   the exact midpoint of `range(200, 1500)`. There is no wobble. It is a
   fixed lowpass with a typo's worth of ceremony around it.
2. Even when it *does* vary (C), it is a **four-value staircase with the
   amplitude envelope retriggering under every step**, which is a gate, not a
   sweep.

`src/audio/wobble.ts` already says this in prose and is right. It is now
measured, and the strudel.cc LFO page confirms the distinction from the other
side: *"there are two ways to modulate: signals for pattern-level modulation"*
versus *"lfo … for audio-level modulation"*.

**Conclusion: on the wobble, this score is already ahead of every published
Strudel pattern I could find.** Do not "fix" `wobble.ts` toward the idiom. The
opportunity is in the direction §4 R5 describes — patterning the *rate*, which
nobody appears to have done.

### 0.3 Strudel's randomness is fully reproducible. Stochastic technique is SAFE here. **[MEASURED]**

This was asked as a hard prerequisite. The answer is unambiguous.

`@strudel/core/signal.mjs:449`:

```js
export const rand = signal((t, controls) => getRandsAtTime(t, 1, controls.randSeed));
```

`rand` is a **signal**: a pure function of the query position `t` (a Fraction in
cycles) and an optional `randSeed` control. There is no `Math.random()`, no
wall clock, no mutable stream position. Every other stochastic function in the
library — `irand`, `brand`, `choose`, `wchoose`, `shuffle`, `scramble`,
`randrun`, `degrade`, `degradeBy`, `undegradeBy`, `sometimes`, `sometimesBy`,
`someCycles`, `perlin`, `berlin` — is built on it.

Measured, in this repo, against the installed 1.2.6:

```
same pattern, same arc, queried 3x:      IDENTICAL   (7 haps in bar 0)
REBUILT pattern object, same arc:        IDENTICAL
two DIFFERENT lanes, both degradeBy(.4): SAME ONSETS DROPPED (correlated!)
...and with .seed(7) on the second:      decorrelated

rand at cycle   0: 0.000000000
rand at cycle 300: 0.000000000   <-- IDENTICAL: legacy RNG repeats every 300 cycles
rand at cycle 137: 0.529475303
rand at cycle 437: 0.529475303   <-- IDENTICAL

after useRNG('precise'):
rand at cycle   0: 0.388089305
rand at cycle 300: 0.751419703   <-- no 300-cycle period
still reproducible across queries:       IDENTICAL
```

**So:**

- **Baseline-comparing gates in `tools/` are safe.** `capture.mjs` already
  prints a `hap-stream sha1`; it will stay stable with `degradeBy` in the score,
  because the same bar always produces the same draw. This is the same
  discipline as the project's own `percSeed` hash of `(bar, phrase, wave)`, and
  for the same stated reason — the director rebuilds a phrase several times
  inside it, and a real random draw would give the same bar a different part
  each time. Strudel's randomness does not have that failure mode.
- **`useRNG` selects between two pure hashes** (`signal.mjs:235-279`).
  `'legacy'` is the **default** (`let RNG_MODE = 'legacy'`) and is an xorshift
  over `frac(t/300)·2²⁹`, which **repeats every 300 cycles**. `'precise'` is a
  murmur-hash finaliser over a decorrelated 32-bit key derived from
  `floor(t·2²⁹)` with no period.
- **The 300-cycle period is a real musical fact here.** One cycle is one bar
  (`engine.ts:194`, `setCps(bpm/60/BEATS_PER_BAR)`), so at 140 BPM in 4/4,
  300 cycles is **8 minutes 34 seconds**. `tools/sections.mjs` runs 900-second
  sessions; a 15-minute run would hear the same "random" sequence 1.75 times.
  Whether that matters depends on how much stochastic content is added.
- **`useRNG()` is global module state, not per-pattern** (`RNG_MODE` is a
  module-level `let`). Calling it anywhere changes it everywhere in the
  process, including inside every node tool. If the score switches to
  `'precise'` it must do so once, at boot, in `engine.ts`, and every tool that
  imports the score inherits it. Do not call it per-lane.
- **THE TRAP, and it is a good one: `rand` is a function of time only, so two
  lanes making the same stochastic call at the same cycle get the same
  answer.** Measured above: `s('hh*16').degradeBy(0.4)` and
  `s('rim*16').degradeBy(0.4)` drop *identical* onsets. The library's own
  docstring says so — *"two patterns at the same time will have the same random
  values"*. Fix with `.seed(n)`, a distinct integer per lane
  (`signal.mjs:436`). A score that adds `degradeBy` to three percussion layers
  without seeding them has not added variation, it has added one variation
  three times, and it will look correct in every hap dump that examines one
  lane.
- Edge case: **`rand` at cycle 0 is exactly `0.000000000`** under the legacy
  RNG (`__xorwise(0) === 0`). The first bar of a run is not a representative
  sample of anything stochastic. Any gate that reads bar 0 only will read the
  same value forever.

**Verdict: an entire class of technique is open, and the observation behind the
question is correct** — the score currently has zero occurrences of
`degradeBy`, `sometimes*`, `someCycles*`, `choose`, `irand`, `perlin`,
`shuffle`, `scramble` or `superimpose`, and everything that moves in it moves
because the director told it to from the top down. §4 R8 is the specific
proposal.

---

## 1. What the mix actually is today **[MEASURED]**

`node --experimental-transform-types tools/capture.mjs --bars=8 --lead-in=20`,
world seed `0x51ed`, real superdough in an OfflineAudioContext:

```
octave bands — full mix, 8 bars
     Hz    dBFS  share
   31.5   -36.3    1.2%  #
     63   -24.9   16.8%  ########
    125   -20.6   45.1%  #######################
    250   -22.4   29.5%  ###############
    500   -31.3    3.9%  ##
   1000   -36.4    1.2%  #
   2000   -39.7    0.5%
   4000   -40.0    0.5%
   8000   -36.8    1.1%  #
  16000   -46.3    0.1%
peak 0.6300 (-4.0 dBFS)   rms 0.1391 (-17.1 dBFS)   crest 13.1 dB
integrated -14.98 LUFS
```

**92.6% of the mix lives below 355 Hz. The 500 Hz – 2 kHz span is 5.6%.**

That span is exactly where the sources put the mid-bass — *"the wobble/growl
character sits in the 100-800 Hz range"* **[SOURCE, KAN]** — and it is the band
a phone or a laptop speaker can actually reproduce. The score does not have a
missing low end. **It has nothing else.** One octave band centred on 125 Hz is
45% of the record.

Two caveats on this reading, both real:

- The 8-bar window starts at bar 0, where the intro gate still has most faders
  near zero (`sub:0.90 kick:0.04 clap:0.04 bass:0.05` at bar 0; by bar 8 it is
  `sub:0.59 kick:0.86 clap:0.70 bass:0.82`). So the drum and bass share is if
  anything *understated* here.
- **`gm_electric_bass_finger` failed to load in the offline harness** ("sound
  not found", 5 occurrences, 8 haps dropped). The `buildBass` pluck anchor is
  absent from this render. That is a capture-harness limitation, not
  necessarily a game defect, but do not read the spectrum as complete.

A crest factor of 13.1 dB at -4.0 dBFS peak against -17.1 dBFS RMS means the
transients own the headroom and the body is 13 dB behind them. Genre records
run far flatter. That is a *consequence* of having no mid-bass, not a separate
problem.

---

## 2. The genre, in numbers

### 2.1 Tempo and the half-time feel

- **140 BPM**, and the genre is *felt* at ~70 because **the snare lands on beat
  3 and only beat 3**, instead of on 2 and 4. **[SOURCE: SoS "Dubstep Basics",
  KAN]** That single relationship is what a listener identifies dubstep by
  before any timbre arrives.
- Skeleton: kick on 1 (plus a syncopated push on the "and" of 2 in alternate
  bars), snare on 3 alone, hats at eighths or sixteenths. **[SOURCE: KAN]**
- **The score already does all of this.** `DUBSTEP_BPM = 140` with a
  136-144 ramp; `clapRhythm` returns `'~ ~ x ~'` for `halftime`; `kickRhythm`
  ladders `g1 ~ ~ ~` → `g1 ~ [~ g1] ~` → `g1 ~ [~ g1] [g1 ~ ~ g1]`; and
  `FEEL_CYCLE` is 8 halftime slots of 12 with every boss overridden to
  halftime. **Nothing in §4 asks you to change the groove.**

### 2.2 The structure, in bars

Canonical five-to-six-minute track at 140 **[SOURCE: KAN]** — 32 bars is ~55 s:

| Section | Bars | Seconds |
|---|---|---|
| Intro | 32 | ~55 |
| Build | 16 | ~28 |
| **Drop 1** | 32 | ~55 |
| Mid | 16-32 | 28-55 |
| Breakdown | 32 | ~55 |
| Build 2 | 16 | ~28 |
| **Drop 2** | 32 | ~55 |
| Outro | 32 | ~55 |

The score's `MIN_BARS`/timeouts give intro 8, build 2-4, drop 8, sustain 8,
breakdown 2-8. **The proportions are already right** — build:drop is 4:8 here
and 16:32 in the reference, the same 1:2 — and the absolute compression is
correct for a game that has to respond inside a wave. **[REASONING]**

The genuine structural gap is share, not length: `tools/sections.mjs` measures
the drop at **48.6% of every run**. The reference arrangement above spends
64 of 208 bars in a drop, which is **31%**. The score's drop is 1.6× the
genre's, and `arrangement.ts` already contains the sentence that judges this:
*"A drop that never ends is not a drop, it is the volume knob."*

### 2.3 Sub versus mid-bass: two jobs, not one instrument

**[SOURCE: SoS, KAN, and consistent across every guide I read]**

| | Owns | Job | Timbre |
|---|---|---|---|
| **Sub** | 20-60 Hz (some say C0-C1, ~30-60 Hz) | Weight. Felt, not heard. | A clean sine. Never distorted, never in a reverb, never wide. |
| **Mid-bass / growl** | **100-800 Hz** | The part. The thing you actually hear on a phone. | Destroyed: saturated, filtered, formanted, gated. |

The rule is that the sub stays clean *because* the mid-bass gets ruined — they
are two lanes so that the destruction can be total in one of them without
costing the low end. **[SOURCE]** SoS is explicit that you should not use "a
really bassy 808 kick sample" alongside a real sub, and that the kick should
"hit higher up the frequency spectrum than the sub-bass".

The score has `buildSub` (a sine at MIDI 26-45, 41-110 Hz, `lpf` 150-720) and
`wub` (a sawtooth at 110-165 Hz through a ladder). It therefore has a sub and a
*bass*, but **it has no dedicated mid-bass lane**. The only thing reaching
100-800 Hz is the ladder's resonant peak sweeping through it, which is why §1
measures 5.6% up there.

### 2.4 The wobble, the growl, the reese, the talking bass

These are four different things and the score currently conflates two of them.

**Wobble.** A lowpass cutoff swung by a tempo-synced LFO over a held note.
Rate expressed as a note division — 1/4, 1/8, 1/8T, 1/16 — with "key sync" on
so the LFO phase locks to the bar. **[SOURCE: MusicRadar, ask.video]**
Producers **automate the rate between divisions across the phrase**; that
automation *is* the bassline. **[SOURCE]** Filter wobbles in dubstep proper use
slower rates (half to quarter notes) than the brostep caricature.

**Growl.** A wobble with harmonic destruction in the loop. The order matters:
*"distorting after the filter makes the vowel movement more aggressive, while
distorting before the filter gives you more control over the final tone"*, and
the general principle is that **distortion generates the harmonics and the
filter then cuts moving notches into them — reverse them and all you get is
fizz**. **[SOURCE: monosounds, rocketpoweredsound]** Also: *"Distortion needs
harmonic content to operate on. A clean sine wave through a soft clipper will
not give you a neurofunk bass — start with a rich source."* **[SOURCE: KAN]**

**Reese.** Two (or three) detuned saws beating against each other. The "wub" of
a reese is *phase cancellation* between voices, not a filter. Detune amounts
from three independent sources: **±5-10 cents subtle, ±15-30 cents the useful
range, ±0.300 semitones (30 cents) for the full pulsating rumble**
**[SOURCE: futureproof, emastered]**; and one worked Massive patch tuned at
`-12.12 / -11.92 / -11.99` semitones, a **20-cent total spread**
**[SOURCE: BassGorilla]**. The classic post-processing is a **sweeping notch or
allpass** over the overdriven reese.

**Talking / formant bass.** Skrillex's is described by people who took it apart
as *"filtering instead of vocoding"*: build a fat reese, **automate EQ formants,
then apply mild distortion — about 80% of the sound** — with an extra EQ before
or after the distortion to emphasise the formant. **[SOURCE: dubstepforum,
image-line forum]** "Scary Monsters" began as a test of FM8, which is why FM
keeps being named.

### 2.5 Drums

**[SOURCE: SoS "Dubstep Drums", SoS "Dubstep Basics", ModeAudio]**

- **Kick.** A sine falling rapidly in pitch to ~100 Hz or below, with a volume
  envelope that cuts the tail so no tone lingers. **Layer high-frequency clicks
  with short tails** on top — closed hats, mechanical clicks, short noise
  bursts. Boost ~100 Hz for weight and ~5 kHz for the click; **roll off below
  50 Hz** so headroom is not spent where nothing reproduces.
- **Snare.** Two layers. A weighty body with **plenty around 160-200 Hz**,
  shortened so its low tail does not muddy; and a 909-ish clap on top with
  **everything below 500 Hz removed** to avoid phase cancellation with the
  body. Transients aligned. A **white-noise tail** on the snare gets the
  characteristic articulation with less reverb. Insert reverb on the clap at
  **~40% wet**, high-passed above 500 Hz.
- **Sidechain.** Duck the sub against the kick. A refinement used in the field:
  trigger the compressor from a *duplicate kick track with a closed hat sample
  substituted*, so the ducking follows the kick's timing without the kick's
  low-frequency content smearing the detector.
- **Velocity variation is the swing.** *"Changing the velocity helps swing, it
  can take the edge off highly processed beats."*
- **Sidechain amounts**, from a bass-music-specific guide **[SOURCE: PresetDrive]**:
  heavy dubstep/riddim **8-12 dB** of gain reduction; melodic dubstep **4-6 dB**;
  **the sub itself only 1-2 dB** — "just enough to lock it to the kick".
  Attack 0.1-1 ms, ratio 4:1, and **release 100-250 ms**, longer than in DnB
  because 140 half-time leaves more room between kicks.

### 2.6 The drop: what is REMOVED

This is the half that gets skipped, and it is the half that makes a drop land.

- **Filter the low end out during the build and bring it back at the drop.**
  *"Keep the bass low-pass filtered at 200-400 Hz throughout the intro. Open the
  filter to its full range at the drop."* **[SOURCE: KAN]** The most obvious
  "thinning out" the average listener notices is exactly this.
- **High-pass the non-bass elements** during the build — FX, leads, drum layers
  all carry low-frequency rumble that steals room from the kick and sub at the
  moment they arrive. **[SOURCE: Medium/Betterism]**
- **One or two bars of complete silence immediately before the drop.** *"The
  contrast against the build's intensity makes the drop hit harder than any
  added element could,"* and **this works better in dubstep than in DnB because
  the slower tempo gives the silence time to register.** **[SOURCE: KAN]**
- The "wobble reveal": withhold the bass's *character* — its filter range, its
  LFO, its saturation — until the drop, so the drop is the first time the
  listener hears what the bass actually is. **[SOURCE: KAN]**

### 2.7 Named references, and what each is known for

Production characteristics only, in my own words. **[SOURCE: BassGorilla's
ranked list, Wikipedia, SoS]**

| Track | Known for |
|---|---|
| Digital Mystikz – *AntiWar Dub* | The minimal end of the genre: deep sub, sparse percussion, space as the main material. |
| Mala – *Alicia* | Deep rumbling bass under a sparse, hypnotic rhythm. Nothing is busy. |
| Benga & Coki – *Night* | Precision-engineered sub against syncopation and crisp punchy drums; the arrangement is mostly gaps. |
| Skream – *Midnight Request Line* | The one everyone identifies by its **synth melody**, over a deep sub and a minimalist kit. |
| Pinch – *Punisher* | Rumbling sub, crisp percussion, restraint. |
| Joker – *Purple City* | Thick wobbly synths — the "purple" sound; heavy bass with sparse drums so the synth is the record. |
| Rusko – *Cockney Thug* / Caspa remix | Aggressive gritty bassline and explosive drops; the record that pushed the genre loud. |
| Doctor P – *Sweet Shop* | Iconic wobble **and a memorable melody**; playful against the aggression. |
| Flux Pavilion – *I Can't Stop* | Earth-shaking drops with an instantly recognisable melodic hook. |
| Skrillex – *Scary Monsters and Nice Sprites* | Complex sound design, formant/"talking" bass done by filtering rather than vocoding; began as an FM8 test. |
| Burial – *Archangel* | Atmosphere over impact: pitched vocals, vinyl crackle, muffled beats. |

Note what that column says about melody. §6 returns to it.

---

## 3. What superdough 1.3.0 already gives you and the score has never used

Every row verified twice: **does `@strudel/core@1.2.6` expose it** (as an export
or a `Pattern` method) and **does superdough 1.3.0 read it**. 195 names were
checked this way. **[MEASURED / READ]**

### 3.1 The voice chain, in order **[READ, `superdough.mjs:655-840`]**

```
oscillator (+ noise blend)
  -> gain / ADSR
  -> LOWPASS  (biquad 12db | ladder worklet | 24db cascade)  <- lpsync LFO lives here
  -> HIGHPASS -> BANDPASS
  -> VOWEL          (5 bandpass formants, Q 40-140, fixed x8 makeup)
  -> COARSE -> CRUSH -> SHAPE -> DISTORT
  -> TREMOLO        (tempo-synced amplitude LFO)
  -> COMPRESSOR -> pan
  -> orbit  (dry / room send / delay send)
  -> ORBIT OUTPUT GAIN                                       <- duck lands here
```

Only two things are **pre-filter**: the oscillator itself (including `fm`,
`penv`, `partials`, `phases`) and the `noise` blend. `.drive()` is inside the
ladder's own feedback loop. Everything else is post-filter. That is the
constraint every "distortion before the filter" recommendation has to be
translated through.

### 3.2 Present, working, and unused

| Control | Verified | What it is | Numbers |
|---|---|---|---|
| **`duckorbit` / `duckdepth` / `duckattack` / `duckonset`** | strudel: Pattern method; superdough: `superdough.mjs:511`, `superdoughoutput.mjs:102-125` | **Real sidechain.** A hap on one orbit ducks another orbit's output gain. | `duckedVal = clamp(1 - √depth, 0.01, current)`. Table in §4 R1. `duckonset` = ramp-down time (default 0), `duckattack` = recovery (default 0.1 s, floor 0.002). |
| **`tremolosync` / `tremolodepth` / `tremoloshape` / `tremoloskew` / `tremolophase`** | both | Tempo-synced **amplitude** LFO, phase-locked to the cycle exactly like `lpsync`. | `tremolosync` is cycles-per-cycle, i.e. **gates per bar** (one cycle = one bar here). Shapes `tri|sine|ramp|saw|square` = 0..4. |
| **`vowel`** | both (`vowel.mjs`) | Five parallel bandpass formants. 15 vowels: `a e i o u ae aa oe ue y uh un en an on`. | Q 40-140, fixed ×8 makeup gain. Measured in §4 R6 — it is destructive, and that is the point. |
| **`distorttype`** | both | Nine waveshapers, not one. `scurve`(0, default) `soft` `hard` `cubic` `diode` `asym` `fold` `sinefold` `chebyshev`. | Measured table in §4 R4. |
| **`crush` / `coarse`** | both | Bit depth and sample-rate reduction, as worklets. | `crush`: `x=2^(c-1); out=round(in·x)/x` — 1 drastic, 16 transparent. `coarse`: sample-and-hold every N samples — 2 = 24 kHz, 4 = 12 kHz. Docs warn `coarse` is Chromium-only. |
| **`shape`** | both | A second saturator, ahead of `distort`. | `s' = 2s/(1-s)`, `out = ((1+s')x)/(1+s'|x|)`. **Its `shapevol` postgain is unreachable** — see §3.4. |
| **`lpdc` / `hpdc` / `bpdc`** | both | The LFO's DC offset. Default **-0.5** (sweep centred on the cutoff). | `0` = sweep only **upward** from the cutoff; `-1` = only **downward**. Lets the resting cutoff sit at the top or bottom of the sweep instead of the middle. |
| **`lpdepthfrequency`** | both | Sweep depth in **absolute Hz** instead of as a multiple of the centre. | Use when the centre is a signal and you want the sweep range fixed. |
| **`hpsync`/`hpdepth`/…`bpsync`/`bpdepth`/…** | both | The same worklet LFO on the highpass and bandpass. | A synced **bandpass** sweep is a different animal from a lowpass sweep and nothing here uses it. |
| **`compressor`** | both | `compressor("threshold:ratio:knee:attack:release")`. | Defaults -3 / 10 / 10 / 0.005 / 0.05. |
| **`phaser` / `phaserdepth` / `phasercenter` / `phasersweep`** | both | The **sweeping notch** the reese sources ask for. | `phaserdepth` default 0.75; `phasercenter` in Hz, default 1000; `phasersweep` useful 0-4000. |
| **`noise`** | both | Blends **pink noise into the oscillator, pre-filter**. | Measured near-inert at 0.15-0.35 — see §4 R7. |
| **`partials` / `phases`** with `s('user')` | both (`synth.mjs:457`) | Build an arbitrary harmonic spectrum, **pre-filter**, with per-partial phase. | The only route to "start with a rich source" that the filter can then carve. |
| **`.lfo({c:'…'})`** | both (`modulators.mjs`) | A **generic modulation matrix**: a worklet LFO onto almost any control. | Targets include `distort`, `distortvol`, `crush`, `coarse`, `shape`, `vowel`, `gain`, `pan`, `room`, `delay`, `detune`, `note`, plus every filter parameter. **You can sweep the distortion amount.** |

### 3.3 Present in Strudel, silently ignored by superdough — DO NOT USE

Measured by grepping every `.mjs` in `node_modules/superdough`: **zero
occurrences**, so these attach to a hap and are dropped without a warning.

`ring`, `ringf`, `ringdf` (**there is no ring modulator** — every web guide that
recommends ring mod for growls is describing a tool this stack does not have),
`waveloss`, `squiz`, `triode`.

### 3.4 Absent from `@strudel/core@1.2.6` entirely

`setcpus`, `shapevol`, `wavetable`, `stutter`, `whenmod`, `envL`.

- **`setcpus` does not exist.** Dinofunk calls it. Anything copied from that
  file needs checking name by name.
- **`shapevol` is the interesting absence.** superdough maps it
  (`shapevol → shape.postgain`) but Strudel exposes no control to send it, so
  `.shape()`'s output gain is permanently 1 and unreachable.
- `wt` / `wtsync` / `wtdepth` / `warp` / `warpmode` **are** exposed by Strudel
  and mapped by superdough — but the wavetable source requires
  `registerWaveTable(key, tables)` with external **`.wav` files**
  (`wavetable.mjs:171`). **Wavetable-position scanning is unavailable in an
  asset-free project.** That matters because it is the single most-recommended
  modern-dubstep technique on the web ("automating wavetable position is the
  core of modern neuro bass"). Rule it out and stop looking.

---

## 4. The ranked changes

Most impactful first. Each says what to change, the numbers, and what it should
sound like.

---

### R1 — Sidechain the low end to the kick. `duckorbit`, zero uses today.

**What.** In `kit.ts`, `kick()` gains a duck on the low orbit:

```ts
.duckorbit(ORBIT_LOW)      // 2
.duckonset(0.004)          // 4 ms down
.duckattack(0.17)          // 170 ms back up
.duckdepth(0.36)
```

**The arithmetic**, **[READ, `superdoughoutput.mjs:118`]** —
`duckedVal = clamp(1 - √depth, 0.01, current)`, a linear gain:

| `duckdepth` | gain | dB |
|---|---|---|
| 0.06 | 0.755 | **-2.4** |
| 0.10 | 0.684 | -3.3 |
| 0.15 | 0.613 | -4.3 |
| 0.25 | 0.500 | **-6.0** |
| 0.36 | 0.400 | **-8.0** |
| 0.45 | 0.329 | -9.7 |
| 0.55 | 0.258 | -11.8 |
| 0.64 | 0.200 | **-14.0** |
| 1.00 | 0.010 | -40 |

Target the genre numbers **[SOURCE]**: 8-12 dB on the mid-bass → `depth`
**0.36-0.55**; 4-6 dB melodic → **0.15-0.25**; 1-2 dB on the sub →
**0.03-0.06**. Release 100-250 ms → `duckattack` **0.10-0.25**.

**The one-line version** (do this first): `duckdepth(0.25)` on `ORBIT_LOW`, a
compromise between the sub's 1-2 dB and the growl's 8-12, because that orbit
carries both.

**The right version** (do this second): the sub and the growl want different
depths and they are on the same orbit. Give `buildSub` a **fifth orbit**.
`kit.ts` already sanctions this in its own words — *"A FIFTH ORBIT IS THE RIGHT
ANSWER IF A LANE EVER GENUINELY NEEDS A FIFTH SPACE. Adding one costs one IR
built once."* The sub is already deliberately dry, so it need not set
`roomsize` at all. Then duck the growl orbit at 0.45 (-9.7 dB) and leave the sub
alone.

Note `duckorbit` accepts an array and reads `onset`/`attack`/`depth` per index
(`superdoughoutput.mjs:200-218`), so in principle one kick can duck two orbits at
two depths — but constructing an array-valued hap from a single Strudel control
call is awkward. Two orbits and one duck is simpler and gets the same result.

**Sound.** The growl drops out from under every kick and swells back over the
next 170 ms. At 140 half-time with a kick on 1 and a push after 2, that is the
bar *breathing*. It is the single most recognisable production signature in the
genre and the reason a dubstep low end sounds huge without being muddy: the kick
and the bass stop competing for 125 Hz **in time** rather than in frequency —
which is the band §1 measures at 45% of the whole mix.

**Cost.** `duck()` schedules through `webAudioTimeout`, which allocates a
`ConstantSourceNode` plus a `GainNode` per call (`helpers.mjs:372-390`). At 1-4
kick haps a bar and ~2.3 bars a second that is 5-19 node pairs a second — real,
but two orders of magnitude below the 21.4 reverb-IR rebuilds a bar that
`reverbchurn` exists to police. Measure it anyway (§7 M2).

---

### R2 — Make the drop a **timbre** event. Remove the distortion floors.

**What.** §0.1 removed the reason the floors exist. Change:

| Where | Today | Proposed |
|---|---|---|
| `buildBass` | `.distort(m.sig.drive.range(1.05, 1.8))` | `.distort(m.sig.drive.range(0, 2.6))` |
| `buildBass` | `.drive(m.sig.drive.range(0.6, 1.35))` | unchanged — the ladder drive is level-compensated and is not the crunch |
| `wobble.ts wub()` | `.distort('3.0:0.30')` fixed | `.distort(o.crunch)`, a new `WubOpts` field, `m.sig.drive.range(0.4, 3.4)` |
| `wobble.ts reese()` | `.distort('3.2:0.28')` fixed | same treatment, ~0.2 above the fundamental's |

Keep a **postgain** in the string form (`'3.0:0.30'`) or set `distortvol`
separately — remember `distortvol` is squared by `setGainCurve(x => x*x)`
(`engine.ts:184`), so `0.30` is really 0.09.

Using the measured table in §0.1, `range(0, 2.6)` is about **18 dB of harmonic
travel** on the same notes: at the bottom the bass is a clean filtered saw, at
the top it is at h2 -14.5 / h3 -15.0 relative to a fundamental at -3.2. Today
the range is 1.05→1.8, roughly 4 dB.

**Sound.** The bass gets *cleaner* in the breakdown and the build and *ruins
itself* at the drop, on the same notes, with no change in arrangement. That is
the "wobble reveal" **[SOURCE: KAN]** and it is the mechanism by which a drop
sounds like an arrival rather than a fader move. Right now the drop's only
timbral change is `lpdepth` and a doubled wobble rate on one bar in four
(`wubFor`), which is why it reads as *more* rather than *different*.

---

### R3 — Build the mid-bass lane that does not exist.

§1 measures 5.6% of the mix between 500 Hz and 2 kHz. §2.3 says the mid-bass
owns 100-800 Hz and is the layer a listener on a phone actually hears. There is
no lane whose job that is.

**What.** A third voice in `buildBass`'s stack, on the *same notes* as `wub`,
with the fundamental deliberately removed. Two routes, both measured:

**Route A — `chebyshev`.** **[MEASURED]** At `distort(2.0)` with
`distorttype('chebyshev')`, a 110 Hz saw comes out with **h1 at -19.9 dB and
h3 at -9.7 dB**: the shaper *relocates* the energy up an octave and a fifth,
leaving almost nothing at the fundamental. That is a mid-bass generator from
the note you already have, with no transposition and no second oscillator. Band
it with `.lpf(1800)` and it sits exactly in the 100-800 Hz window without
touching the sub.

**Route B — a second `wub` an octave up**, which is what `reese()` already is,
promoted from 0.10-0.34 to a real level and given its own bandpass. Cheaper to
reason about, but it *is* the "second lead synth" the owner objected to when it
was loud, so it needs to be growl-timbred rather than saw-timbred to survive —
which means R4 and R6.

Prefer A. It cannot be mistaken for a lead, because it has no attack of its own
and no independent line.

**Sound.** The bass becomes audible on a laptop. Today the wobble's only
presence above 250 Hz is the ladder's resonant peak passing through; a
chebyshev layer puts a continuous, harmonically dense band there that the LFO
still sweeps, because it is downstream of the filter and the filter is what is
feeding it.

---

### R4 — Choose a `distorttype`. The default is not the best one here.

**[MEASURED]** — sawtooth at 110 Hz, `distort(2.0)`, no level compensation:

| type | RMS dBFS | peak | h1 | h2 | h3 | note |
|---|---|---|---|---|---|---|
| `scurve` (default) | -9.31 | 0.5617 | -7.8 | -16.1 | -18.9 | what everything uses today |
| `soft` (tanh) | -6.63 | 0.7976 | -5.4 | -12.4 | -16.1 | |
| `hard` | -5.33 | **1.0000** | -4.5 | -10.5 | -14.0 | **clips at 2.0. Never on a bus lane.** |
| `cubic` | -5.14 | 0.8847 | **-3.7** | -11.4 | -14.9 | loudest fundamental |
| **`diode`** | -7.53 | **0.6296** | -5.9 | -14.0 | -17.8 | **best crest of the loud shapers** |
| `asym` | -7.37 | 0.8166 | -6.0 | -14.9 | -18.6 | |
| `fold` | -10.24 | 0.6199 | -9.4 | -15.4 | -18.9 | |
| `chebyshev` | -10.22 | 0.5774 | **-19.9** | -16.9 | **-9.7** | spectral relocator — see R3 |

**Recommendation: `diode` on the bass fundamental.** It reaches -7.5 dBFS RMS
at a peak of 0.63, where `cubic` needs 0.88 and `hard` needs 1.00 for a similar
result. §1 measures the mix's crest at 13.1 dB — the headroom is the scarce
resource, and `diode` is the shaper that buys the most loudness per unit of
peak. Keep `scurve` on the drums, where the existing numbers were tuned.

Never `hard`, and never `fold`/`sinefold`/`chebyshev` on the lane that carries
the fundamental. `wobble.ts` already argues correctly that a soft clipper's
harmonics fall away fast and that this matters because the 2.5-6 kHz band is
the one recorded human complaint about this score's high end; `diode` shares
that property (h3 -17.8, falling faster than `hard`'s -14.0).

---

### R5 — Write the wobble **rate** into the bar. Aligned mini-notation on `lpsync`.

`WUB_PHRASE` gives one rate per bar across eight bars, which is real
composition and is more than any published Strudel pattern does. The genre goes
further: **producers automate the LFO rate between divisions inside the phrase**
**[SOURCE]**. `lpsync` is a patternable control and nothing here patterns it.

**[MEASURED]** — the halftime figure is `low@2 octave walk`, a 2:1:1 division:

```
MISALIGNED  .lpsync("4 8 16")     -> 5 haps; parts split at 1/3 and 2/3,
                                     wholes preserved at 0..0.5, 0.5..0.75, 0.75..1
ALIGNED     .lpsync("4@2 8 16")   -> 3 haps; part == whole on every one
                                     lpsync = 4, 8, 16
```

**The trap, and it is a silent one.** In the misaligned case the extra fragments
have `part.begin !== whole.begin`, so `hasOnset()` is false — and both the live
scheduler (`@strudel/core/cyclist.mjs:63` and `:137`) and `capture.mjs:381`
**drop haps without an onset**. The `lpsync=8` and `lpsync=16` values would
never sound. A control pattern whose divisions do not match the note pattern's
divisions silently loses every value after the first in each note.

**What.** Make `Wub.rate` (and `WubOpts.depth`) accept a `Patternable`, and give
`WUB_PHRASE` rows an optional per-bar string that matches the figure's division:

```ts
// bar 4, the answer: state, accelerate, snap
{ rate: '4@2 8 16', shape: WUB_SAW, skew: 0.3 }
// bar 8, the run-up
{ rate: '6@2 12 16', shape: WUB_SAW, skew: 0.28 }
```

The alignment must be derived from the figure, not written by hand twice — the
figures live in `buildBass` and the rates in `wobble.ts`, and a division that
drifts apart from its figure is exactly the class of defect this project keeps
finding. Emit the rate string from the same place that emits the figure.

Also missing from the rate vocabulary: **2** (a half-note wobble — the slow
yawn that makes the fast bars sound fast) and **16**. The table runs 3-12;
adding 2 at one end costs nothing and doubles the phrase's dynamic range.

**Sound.** The bass stops having one speed per bar and starts having a *shape*
per bar. This is the difference between a wobble that is a texture and a
bassline that is a part, and it needs no new voice, no new lane and no new
control.

---

### R6 — The talking bass. `vowel`, patterned, on the mid layer only.

**[MEASURED]** — a 110 Hz sawtooth, harmonics in dB relative to full scale:

| `.vowel()` | RMS | h1 (110) | h3 (330) | h4 (440) | h6 (660) |
|---|---|---|---|---|---|
| absent | -22.69 | **-21.8** | -31.4 | -33.9 | -37.4 |
| `a` | -22.28 | -54.2 | -52.3 | -50.8 | **-19.3** |
| `e` | -18.81 | -50.4 | -44.0 | **-15.8** | -55.6 |
| `o` | -25.12 | -46.2 | -39.4 | **-22.3** | -53.8 |
| `u` | -33.90 | -45.2 | **-32.5** | -39.0 | -47.8 |

Two facts fall straight out:

1. **`vowel` annihilates the fundamental** — 24 to 32 dB down — and leaves one
   narrow formant band standing. It is five bandpasses at Q 40-140 with a fixed
   ×8 makeup gain (`vowel.mjs:59-66`). **Never put it on the lane that carries
   the low end.** On a mid-bass layer over a clean sub it is precisely the
   effect the sources describe.
2. **The vowels are not level-matched.** `e` is -18.8 and `u` is -33.9 — a
   **15.1 dB** swing. Patterning `"<a e o u>"` without compensation makes the
   lane lurch. Restrict to `{a, e, o}` (-22.3 to -18.8, a 3.5 dB spread) or
   attach a per-vowel gain.

**What.** On the R3 mid-bass layer, `.vowel("<a e o a>")` — one vowel per bar of
a four-bar group, aligned to the bar so no note is fragmented (R5's trap applies
identically). Because the mid layer is post-distortion the formant is carving
harmonics that already exist, which is the order the sources call for: build a
rich reese, move the formant, then apply *mild* distortion. **[SOURCE]** Here
the destruction comes first out of necessity — `vowel` sits before `coarse`,
`crush`, `shape` and `distort` in the chain (§3.1) — so put the heavy shaping in
`.drive()` inside the ladder and keep the post-`vowel` `distort` modest, around
0.6-1.0.

**Sound.** The formant peak moves between 330 and 660 Hz across the phrase. On a
band that is currently 5.6% of the mix, a resonant peak walking through it is
the most legible thing you could put there.

---

### R7 — Amplitude gating on the growl. `tremolosync`, zero uses today.

A real wobble moves in more than one dimension. The score's moves only in
filter. superdough has a tempo-synced amplitude LFO phase-locked to the cycle,
in the same units as `lpsync`, and nothing uses it.

**[MEASURED]** — `tremolosync(8)` on the 110 Hz saw:

| `tremolodepth` | RMS dBFS | cost vs no tremolo |
|---|---|---|
| — (no tremolo) | -22.69 | — |
| 0.3 | -25.08 | -2.4 dB |
| 0.5 | -26.65 | -4.0 dB |
| 0.8 | -28.73 | -6.0 dB |
| 1.0 / absent (default) | -29.48 | -6.8 dB |

**Trap: `tremolodepth` is squared by this project's gain curve**
(`superdough.mjs:610`, `tremolodepth = applyGainCurve(tremolodepth)`, and
`engine.ts:184` sets `setGainCurve(x => x*x)`). Write **`tremolodepth(0.71)`**
to get an effective 0.5. Nothing warns.

**What.** On `wub()`, only where the phrase wants bite:

```ts
.tremolosync(rate)          // the SAME division as lpsync
.tremolophase(0.5 / rate)   // half a wobble out of phase with the filter
.tremoloshape(3)            // saw: hard reset
.tremoloskew(0.3)
.tremolodepth(0.6)          // -> ~0.36 effective
```

and raise the lane gain ~3 dB to pay for it.

The `tremolophase` offset is the point. At the same rate as `lpsync` but half a
cycle out of phase, the amplitude punches at the moment the filter is closing —
so you perceive **two events per LFO cycle** from one rate. That is "munchy"
with no extra speed.

**Restraint.** `wobble.ts` argues, correctly, that an amplitude envelope must
not fight the LFO for the rhythm. This is that argument's exception, not its
refutation: the tremolo runs at the LFO's *own* rate, so it reinforces the
wobble rather than competing with it. If it reads as a stutter, halve the depth
before removing it. Consider gating it to `hard` bars (`wubFor`'s drop flag)
only.

---

### R8 — Let something move from the bottom up. Stochastic variation, now that §0.3 says it is safe.

Zero occurrences of `degradeBy`, `sometimes*`, `someCycles*`, `choose`,
`irand`, `perlin`, `shuffle`, `scramble`, `superimpose` in the score. Everything
that varies varies because the director changed a signal.

§0.3 establishes that all of these are pure functions of cycle position, so
baselines stay stable and `capture.mjs`'s `hap-stream sha1` stays meaningful.

**What, specifically** — three places, smallest first:

1. **Ghost snares.** `buildClap`'s `'~ [~ ~ ~ x] ~ [x ~ x ~]'` layer plays the
   same four ghosts every bar. `.degradeBy(0.25).seed(11)` makes it play three
   of four, differently, every bar — deterministically. **The point of ghost
   notes is that they are not identical.**
2. **The hat grid.** `percGrid`'s sixteenth bed. `.degradeBy(0.18).seed(12)`.
   `percSeed` already hashes the bar, so this is the same idea the file already
   endorses, expressed in one call rather than in arithmetic.
3. **Wobble skew.** `.lpskew(perlin.range(0.20, 0.42).seed(13))` — a slow
   continuous drift in how hard the wobble snaps, which is the parameter
   `WUB_PHRASE` currently steps in eight discrete values.

**Every one needs a distinct `.seed()`.** Without it they share a draw and are
perfectly correlated (§0.3, measured).

**Decide `useRNG` once.** The default `'legacy'` repeats every 300 bars = 8m34s.
If stochastic content becomes load-bearing, call `useRNG('precise')` exactly
once in `engine.ts` and re-baseline every affected gate in the same commit.

---

### R9 — The kick has no click, and the sources say that is where the level goes.

`kit.ts kick()` is a pure sine with `penv 20-30`, `pdecay 0.07-0.1`, `decay
0.23-0.3`, `sustain(0)`, `distort(1.1-3.3 : 0.34)`, `gain(0.8)`, at `g1` (49 Hz).

**[SOURCE]** says: sine falling to ~100 Hz with the tail cut, **plus a layered
high-frequency click with a short tail**; boost ~100 Hz for weight and ~5 kHz
for the click; roll off below 50 Hz. §1 measures the mix at 1.2% in the 31.5 Hz
band, 45% at 125 Hz, and **0.5% at 4 kHz**.

**What.** Add a second element to `kick()`, not a change to the first:

```ts
s('white').struct(rhythm)
  .ds('0.008:0')      // 8 ms — a click, not a hat
  .hpf(3000).lpf(7000).hpq(1.2)
  .gain(0.34 + weight * 0.2)
  .orbit(ORBIT_DRUMS)
```

and a highpass on the sine element at 40 Hz — but **check for an `ftype` on the
chain first** (AGENTS §4: one shared filter-model control). `kick()` sets no
`ftype`, so a biquad highpass there is safe today, and the fix is one line if
that ever changes.

**Sound.** The kick becomes audible on a phone. At `g1` the fundamental is
49 Hz, which a laptop speaker does not reproduce at all — today the only thing
that survives small-speaker playback is the pitch envelope's own transient, and
`kit.ts`'s own comment already records exactly this diagnosis for the previous
`c1` tuning. The click makes the *timing* legible even where the weight is not.

---

### R10 — The build must SUBTRACT. It currently only adds.

**[SOURCE]**, and this is the least-implemented idea in the whole document:
during the build you high-pass everything, pull the sub and bass out, and leave
**one or two bars of silence** — and this works better at 140 half-time than at
any faster tempo because the silence has time to register.

What the score does during `build`: `buildFx` **adds** a crescendoing timpani
roll on the tonic; `director.ts:1329` sets
`openness = lerp(openness * 0.6, 1, arr.buildProgress)`, which **opens** the
filters; and no stem fader is reduced at all (the only build-specific fader term
is `fx *= 1`). The build is the loudest, densest part of the arrangement, and
the drop that follows it can only be quieter by comparison.

**What.** In `director.updateLevels`, gated on `section === 'build'`:

```ts
// The last 40% of the build empties the bottom.
if (section === 'build' && (id === 'sub' || id === 'bass')) {
  want *= 1 - smoothstep(0.6, 1.0, arr.buildProgress);
}
```

and in `buildBass`/`buildSub`, clamp the cutoff during the build to the range
the sources name — **200-400 Hz** — reopening to full at the drop:

```ts
cutoff: m.section === 'build'
  ? lerp(400, 1050, Math.max(0, m.buildProgress * 2 - 1))
  : m.sig.openness.range(300, 1050)
```

Then let `arrangement.ts` place the silence: on the **last bar before
`dropAtBar`**, take `kick`, `clap` and `bass` to zero and leave only the riser
and the timpani. The section machine already knows `dropAtBar` and
`buildProgress`; nothing new has to be computed.

**Sound.** For four seconds there is no low end at all. Then the drop's downbeat
is the first bass note in four seconds, over a crash and an impact that already
exist. **This costs nothing, adds no voices, and is what a drop is.** Right now
the drop's downbeat arrives into a mix that was already full.

---

### R11 — The reese detune is half the canonical amount.

**[READ, `worklets.mjs:38-49, 545-555`]** — `.detune(d)` on `supersaw` sets
`freqspread` in **semitones, total across all voices**, distributed as
`voice_i · d/(unison-1) − d/2`.

`reese()` uses `.unison(2).detune(0.14)`, which is **±0.07 semitones = ±7
cents**. At 220 Hz that is a beat rate of **1.78 Hz**.

The literature: **±5-10 cents subtle, ±15-30 cents the useful range**, and one
worked patch at a **20-cent total spread**. **[SOURCE]** The score sits at the
bottom of "subtle".

**What.** `detune(0.36)` — ±18 cents, **4.57 Hz** of beating at 220 Hz. Reachable
as a signal so the drop widens it: `m.sig.drive.range(0.20, 0.44)`.

**And a caution I could not settle.** `.spread()` is *pan* spread, and
`this.phase[n] = this.phase[n] ?? Math.random()` (`worklets.mjs:559`) with a
**pooled node**, so the two voices' initial phase relationship is random and
sticky across reuse. Measured across eight combinations of
`spread ∈ {0, 0.35, 0.7, 1.0}` × `detune ∈ {0.14, 0.36}`, RMS stayed in a
2 dB band (-23.2 to -26.0) while the **fundamental swung from -21.8 to -41.9 dB**.
The energy is stable; the fundamental's phase is not. **That is the reese
effect, and it also means single-note measurements of this voice are not
reproducible.** Do not tune `spread` against a one-note render; judge it over
32 bars or not at all.

---

### R12 — Two smaller things, both one line

- **`lpdc`.** Default -0.5 centres the sweep on the cutoff. `lpdc(-1)` makes the
  filter rest **closed** and open only in bursts; with `lpshape(WUB_SAW)` that
  is "shut, snap open, fall back", which is the classic aggressive wobble
  contour and is different from anything `skew` can produce. One control, on
  the drop bars only.
- **`phaser`.** The reese sources call for a **sweeping notch over the
  overdriven reese**. `.phaser(0.5).phasercenter(600).phasersweep(1400).phaserdepth(0.6)`
  on the R3 mid layer. Verified present in both packages; not measured here.

---

## 5. The drop, mapped onto the sections this game already has

The arrangement is `intro → build → drop → sustain → breakdown` with `fill` and
`collapse`, driven by tension. A real dubstep drop maps onto it cleanly, and
almost all of the work is in the **two bars before** the state changes.

| Section | Today | What a drop needs it to be |
|---|---|---|
| **`build`** (2-4 bars) | Timpani roll crescendo; openness *rises*; no fader reduced. | **The subtraction.** Sub and bass fade out over the last 40% (R10). Bass cutoff clamped to 200-400 Hz. Distortion at the bottom of its new range (R2) so the bass that *is* audible is clean. Hats and FX high-passed. |
| last bar of `build` | Same as any build bar. | **Near-silence.** Kick, clap, bass, sub at zero. Riser and a single held tonic only. Four seconds of no low end at 140. |
| **`drop` bar 0** | `impact()` + crash; `wubFor(bar, hard)` doubles the rate on bars 3 and 7. | Everything arrives on one downbeat: sub and bass faders snap back, cutoff opens to full, **`distort` jumps to the top of `range(0, 2.6)`**, `lpdepth` to 1.95, the R3 mid-bass layer enters, the sidechain (R1) starts pumping. The impact and crash already there do the rest. |
| **`drop` bars 0-7** | One pass of `WUB_PHRASE`; lead silent except cadence bars. | Correct as designed. Add the within-bar rate writing (R5) so bars 4 and 8 *develop* instead of just doubling. The lead staying out is right (§6). |
| **`sustain`** (8 bars) | Lead still silent; a `TACET_ROTA` lane rests. | This is the genre's "mid section". It is the right place for the drop's *second half* — same groove, different bass rhythm. Give `sustain` its own four rows of `WUB_PHRASE` rather than continuing the drop's. |
| **`breakdown`** | kick, clap, bass forced to 0; pad room 0.78. | Correct, and it is the one place the arrangement already subtracts. This is where the melody belongs (§6) and where the bass should be at `distort(0)` if it sounds at all. |
| **`fill`** (1 bar) | Accelerating snare into a crash. | Right. |

**The number to watch.** `tools/sections.mjs` measures the drop at **48.6% of a
run** against a genre figure of ~31% (§2.2). Every change above makes the drop
*more* different from its neighbours; none of them make it rarer. If the drop
still reads as "the volume knob" after R2 and R10, the fix is in
`maybeAdvance`'s `barsIn >= BARS_PER_PHRASE` arm, not in the sound design.

---

## 6. What to remove — and where I disagree with the standing instruction

### 6.1 Remove, with confidence

1. **The `distort` floors** in `buildBass` (§0.1, R2). They guard a hazard that
   does not exist in 1.3.0 and they cost the drop its timbre.
2. **The lead's vibrato.** `buildLead` sets `.vib(vibRate).vibmod(vibDepth)` on
   the melody. Vibrato is an acoustic-instrument gesture; **no dubstep lead has
   it**. It is also the thing that makes a triangle at A4 read as "a woodwind
   in a video game", which is very close to the words the owner used.
3. **The timpani roll in `build`**, or at least its crescendo. An orchestral
   gesture, and more importantly it makes the build *add* when the build's whole
   job is to take away (R10). Keep the riser.
4. **`metal()` on the perc grid during `drop`.** An inharmonic FM bell stating a
   chord tone is direct competition for the 100-800 Hz band R3 is trying to
   claim. Gate it to `sustain` and `breakdown`.
5. **Any thought of `ring`, `ringf`, `ringdf`, `waveloss`, `squiz` or
   `triode`.** They attach to haps and superdough never reads them (§3.3). Ring
   modulation, which several sources recommend for growls, **is not available in
   this stack.**

### 6.2 Where I think the standing instruction is wrong

> "the bass IS the lead in this genre"

**Half right, and the wrong half is being acted on.**

**The evidence for it.** In the drop, yes, unambiguously. Every source agrees
the drop is bass-led, and `buildLead`'s `yieldToBass` — silencing the melody in
`drop` and `sustain` except on the cadence bar of each four-bar group — is a
good, genre-correct decision. Keep it exactly as it is.

**The evidence against generalising it.** Look at §2.7. The canonical tracks are
overwhelmingly identified by their **melody**, not their bass:

- Skream, *Midnight Request Line* — "iconic synth melody" is the first thing
  anyone says about it.
- Doctor P, *Sweet Shop* — "iconic wobble **and** a memorable melody".
- Flux Pavilion, *I Can't Stop* — "instantly recognisable melody".
- Chase & Status, *Eastern Jam* — the hook is the record.

Dubstep is a melodic genre whose melody does not play over the drop. Deleting
the melody outright would remove the thing that makes people remember a dubstep
record, and the score already has the correct answer — the lead sounds in
`build`, `breakdown`, `intro`, `fill` and on cadence bars, which is 34.4% of a
run plus the cadences.

**So the complaint is about the PATCH, and four re-voicings all moved the wrong
way.** The record: supersaw → triangle → oboe → triangle. Every one of those
moves went **toward sweeter and more acoustic**. The genre's lead recipe is the
opposite **[SOURCE]**:

> the body is a **mono, mid-focused saw or square that actually carries the
> melody** — the layer you'd solo and still recognise the hook from; width is a
> detuned supersaw *behind* it with its mids scooped; bite is a short brighter
> layer where **only the first 40-80 ms really matters**.

The score's lead is a **triangle on top** (a flute) over a **sawtooth an octave
down, lowpassed to 500-1400 Hz** (dark, buried). That is the recipe **inverted**:
the saw is the support and the sweet voice is in front.

**Concretely, instead of removing it:**

| | Today | Proposed |
|---|---|---|
| Body | triangle, `lpf` 1900-5000, at `tonic+12` | **sawtooth or `pulse(0.35)`, mono, `lpf` 1400-3200, at `tonic+12`** — the layer you'd recognise the hook from |
| Support | sawtooth an octave down, `lpf` 500-1400 | **`supersaw` `unison(5) detune(0.5) spread(0.9)`, mids scooped, at the *same* octave, quieter** — width, not a second line |
| Bite | none | a 60 ms `pulse` transient on the note onset, `hpf(1200)`, `.clip(0.08)` |
| Vibrato | `.vib().vibmod()` | **gone** |
| Distortion | none | `.distort(0.8)` with `diode` — a dubstep lead is saturated |

That is a **fifth** re-voicing, which the record says has not worked four times
— so it should be argued for, not assumed. My argument is that the four
previous attempts all explored the same half of the space, and the half they
never touched is the one the genre actually uses. If the owner rejects this one
too, then the conclusion is that the lead should be a **stab**, not a line: two
or three notes a bar, in the gaps, off the same distorted saw. That is the
other thing dubstep leads do and it costs almost nothing to try.

**What I am not recommending:** deleting the melody, or moving it to another
soundfont. The soundfonts are disabled for every role but the bass anyway
(`SAMPLED_ROLES`), so a font change is a bytes decision, not a sound one.

---

## 7. Measurement plan

The whole point. For each recommendation: what would show that it landed, and —
where a gate could be satisfied without changing anything — what stops that.

| # | Change | Measurement | Gate that cannot be optimised against |
|---|---|---|---|
| **M1** | §0.1, `distort(0)` | Re-run the probe: render one sawtooth with `distort` absent / `0` / `0.19` / `1.0` / `3.0` and compare RMS and peak. If absent and `0` differ, AGENTS §4 is right and R2 is void. | Compare **peak as well as RMS**; a silenced voice and a bypassed one differ by 145 dB, so there is no ambiguous middle. Print both. |
| **M2** | R1, sidechain | `tools/capture.mjs --bars=32 --windows=8`. The **crest factor** should rise (the bass now has a hole under each kick) and the 125 Hz band's share should fall from 45%. Also: `jankwhere` for the `webAudioTimeout` node churn, and **`reverbchurn` must stay at its current IR-rebuild count** — a fifth orbit adds one IR built once, not per note. | Assert the **per-bar minimum** of the low-orbit envelope, not the mean. A duck that never fires and a duck at depth 0.01 both leave the mean where it was. Read the envelope in 5 ms frames around each kick onset. |
| **M3** | R2, distortion range | Solo the bass (`--stem=bass`) at a **breakdown** bar and at a **drop** bar and compare h2/h1 and h3/h1. The spread should be ~14 dB, not ~4. | Measure the **ratio** of upper harmonics to the fundamental, not absolute level. A gain change moves everything together and would pass a level test while changing no timbre. |
| **M4** | R3, mid-bass | `--stem=bass`, octave bands. **500 Hz + 1 kHz + 2 kHz combined should go from 5.6% to >15% of that stem**, and the full mix's 500-2 k share should roughly double. | State the denominator. `spectrum.mjs`'s bands and `capture.mjs`'s are both ten octave bands — use one of them, and print the band edges next to the number. |
| **M5** | R4, `distorttype` | The table in §4 R4, re-run at the drive values the score actually uses. **Peak matters as much as RMS** — the recommendation is a crest-factor argument. | Render at the same input level for every type and print peak. Any type reaching peak 1.0000 has clipped and its harmonic numbers are meaningless. |
| **M6** | R5, `lpsync` patterning | `basscheck`-style hap query: for every feel and every bar of `WUB_PHRASE`, assert **`part == whole` on every emitted hap of the wobble lane**. A fragmented hap is a silently-dropped rate. | This is the strongest gate in the table because it catches the failure *mechanically*. Count fragmented haps; assert **zero**, and print the count so `checked === 0` is distinguishable from clean. |
| **M7** | R6, `vowel` | Solo the mid layer and track the **frequency of the spectral peak** across four bars. It should move between ~330 and ~660 Hz. Also assert the **per-vowel RMS spread is under 4 dB** after compensation. | Track the peak's *position*, not its height. A louder static peak passes a level test. |
| **M8** | R7, tremolo | Envelope in 5 ms frames over one bar of the wobble lane: count amplitude minima. With `tremolosync(rate)` at `tremolophase(0.5/rate)` there should be **2×rate** minima per bar, not `rate`. | Count minima, not depth. And check the **effective** depth after `x²` — write the number you want *and* the number you wrote in the comment. |
| **M9** | R8, stochastic | `capture.mjs --verify-determinism=3` must still report identical hap streams. Then: for the seeded lanes, assert **the onset sets of any two stochastic lanes differ** over 32 bars. | The correlation trap is invisible per lane. The gate must compare lanes **against each other**, and it must have been seen red — remove one `.seed()` and watch it fail. |
| **M10** | R9, kick click | Full mix, 4 kHz and 8 kHz bands. Currently 0.5% and 1.1%. Also `--stem=kick` soloed: the kick should stop being ~88% confined to one octave band. | Assert the kick's **band spread** (how many bands hold >5% of its energy), not the 4 kHz level. A gain rise passes the latter. |
| **M11** | R10, the build subtracts | `--bars=32 --windows=8` with a window boundary on the pre-drop bar. That window's **31.5 + 63 + 125 Hz share must fall below 10%**, against 63% today, and the drop window's must jump. | Use `--windows`, which labels each slice with its section — so the assertion is "the bar before the drop", not "some quiet bar". Print the section label with the number. |
| **M12** | R11, reese detune | **Not a single-note render** — the supersaw's per-voice phase is `Math.random()` and pooled (measured: 20 dB of fundamental swing at fixed settings). Render 32 bars and compare the **width of the fundamental's level distribution**, which should widen with detune. | Report the distribution, not a value. This is the one recommendation whose obvious measurement is invalid, and saying so is the finding. |
| **M13** | §6.2, the lead | `leadcheck` for the notes; `--stem=lead` for the tone. The body's energy should move **down** from 1.9-5 kHz into 1.4-3.2 kHz and the lane should acquire harmonics above its own fundamental. | There is no instrument gate for "sounds stupid". **This one goes to the owner.** Render two 32-bar WAVs, one per patch, and ask. That is the only measurement in this table that is ground truth. |

**A standing caution.** `mixbalance` cannot settle differences of ~10 dB (its
own header says so — shared reverb and delay tails mean soloed spreads are
often as large as the medians). Use `capture.mjs` soloed stems for anything
finer than "this lane is absent".

**And the honest ceiling on all of it.** Twelve of these thirteen rows measure
haps or spectra. None of them measures whether it sounds good. The one that
does is M13, and it should be run more often than once.

---

## 8. Dead ends — recorded so nobody re-walks them

- **`eefano/strudel-songs-collection`** (90 files, the corpus this project
  already cites for its release-time median). Analysed for control usage:
  `lpsync` 0, `lpdepth` 0, `lpshape` 0, `lpskew` 0, `ftype` 0, `crush` 0,
  `coarse` 0, `tremolo*` 0, `duck*` 0, `compressor` 0, `phaser` 0, `noise` 0,
  `vowel` 1, `shape` 1, `distort` 8 songs / 10 calls. It is a corpus of
  note-driven pop and game-music covers. **There is no dubstep in it and almost
  no sound design.** What it *is* good for: `clip` (63 of 90 songs, 138 calls),
  `velocity` (40 songs, 147 calls), `pan` (30/105), `mask` (13/35),
  `pickRestart` (53/189) and `ribbon` (21) as the arrangement idiom, and
  `all(x => x.room(.3))` as a global send. **[MEASURED]**
- **`williamzujkowski/strudel-mcp-server` `patterns/examples/`**. Fetched all of
  dnb/neurofunk, dnb/liquid-dnb, trap/modern-trap and techno/hard-techno. They
  are **one machine-generated template with the notes swapped** — identical
  drum string, identical `note(...).s("sawtooth").cutoff(800)` bass, identical
  `.s("triangle").struct("~ 1 ~ 1 1 ~ 1 ~").delay(0.25).room(0.3)` melody. No
  filter LFO, no `ftype`, no distortion, no dynamics. **No value as a
  sound-design reference.** **[MEASURED]**
- **`strudelmarket.com`**. A Next.js client-rendered app. `/api/patterns`,
  `/api/patterns?category=Bass`, `/patterns.json` and `/api/posts` all return
  the same HTML shell to a plain fetch. Would need a real browser session; I did
  not spend one on it.
- **Wavetable position scanning**, which is the top web recommendation for
  modern dubstep/neuro bass. `wt`, `wtsync`, `wtdepth`, `warp`, `warpmode` are
  all exposed and all mapped, but the source requires `registerWaveTable` with
  external `.wav` files. **Unavailable in an asset-free project.** (§3.4)
- **Ring modulation**, recommended by several growl guides. Not implemented in
  superdough 1.3.0 at all. (§3.3)
- **`shape`'s postgain.** superdough maps `shapevol`; Strudel exposes no control
  to send it. `.shape()` always runs at unity output.

---

## 9. Sources

Web, cited where the text says **[SOURCE]**:

- [Sound On Sound — Dubstep Basics](https://www.soundonsound.com/techniques/dubstep-basics)
- [Sound On Sound — Dubstep Drums](https://www.soundonsound.com/techniques/dubstep-drums)
- [KAN Samples — Dubstep Track Arrangement: Halftime, Tension & Drops](https://kansamples.com/blogs/learn/dubstep-track-arrangement)
- [KAN Samples — Sound Design for Drum & Bass and Dubstep](https://kansamples.com/blogs/learn/sound-design-dnb-dubstep)
- [PresetDrive — Sidechain Compression for Bass Music](https://www.presetdrive.com/sidechain-compression-bass-music/)
- [PresetDrive — How to Recreate Famous Dubstep Sounds in Serum](https://www.presetdrive.com/how-to-recreate-famous-dubstep-sounds-in-serum/)
- [MusicRadar — How to build an LFO wobble bass](https://www.musicradar.com/how-to/lfo-wobble-bass)
- [ask.video — Creating Dubstep Wobble-style Bass Lines in Logic](https://ask.video/article/audio/creating-dubstep-wobblestyle-bass-lines-logic)
- [futureproofmusicschool — Reese Bass Sound Design](https://futureproofmusicschool.com/blog/reese-bass-sound-design-everything-you-need-to-know)
- [eMastered — Reese Bass: What It Is & How to Make One](https://emastered.com/blog/reese-bass)
- [BassGorilla — What is a Reese and How to Make One](https://bassgorilla.com/what-is-reese-how-make-one/)
- [BassGorilla — Best Dubstep Songs](https://bassgorilla.com/best-dubstep-songs/)
- [monosounds — Serum 2 Dubstep Growl Tutorial](https://monosounds.studio/serum-2-dubstep-growls/)
- [Rocket Powered Sound — 5 Ways To Make Growl Basses In Serum](https://rocketpoweredsound.com/blogs/production/5-ways-to-make-growl-bass-in-serum)
- [Dubstepforum — Skrillex reveals details on how he makes his basslines](https://www.dubstepforum.com/forum/viewtopic.php?t=210760&start=80)
- [Image-Line forum — Skrillex Scary Monsters Main FM Bass](https://forum.image-line.com/viewtopic.php?t=125747)
- [Medium/Betterism — 8 Simple Tricks EDM Artists Use To Make Their Drops Sound More Powerful](https://medium.com/betterism/8-simple-tricks-edm-artists-use-to-make-their-drops-sound-more-powerful-79b50413fb75)
- [ModeAudio — Drum Synth Sound Design: Kick & Snare](https://modeaudio.com/magazine/drum-synth-sound-design-kick-snare)
- [Strudel docs — Audio effects](https://strudel.cc/learn/effects/)
- [Strudel docs — Low-frequency oscillators (LFO)](https://strudel.cc/learn/lfo/)
- [Strudel docs — Synths](https://strudel.cc/learn/synths/)
- [awesome-strudel](https://github.com/terryds/awesome-strudel) and [eefano/strudel-songs-collection](https://github.com/eefano/strudel-songs-collection)
- [williamzujkowski/strudel-mcp-server](https://github.com/williamzujkowski/strudel-mcp-server)

In-repo, cited where the text says **[READ]** — all line numbers against the
installed versions and version-specific:

- `node_modules/superdough@1.3.0/`: `superdough.mjs` (chain order 655-840,
  duck 511, defaults 180-202, gain curve 606-611), `superdoughoutput.mjs`
  (duck 102-125, 200-218), `helpers.mjs` (`createFilter` 298-290,
  `getADSRValues` 167, `getLfo` 112, `webAudioTimeout` 372, distortion
  algorithms 495-570), `worklets.mjs` (distort 429, crush 225, coarse 193,
  shape 259, supersaw 466-573, detuner 38), `vowel.mjs`, `noise.mjs`,
  `synth.mjs` (supersaw 153-217, `waveformN` 457, oscillator 501),
  `superdoughdata.mjs` (the modulation target map), `modulators.mjs`
- `node_modules/@strudel/core@1.2.6/`: `signal.mjs` (RNG 200-290, `seed` 436,
  `rand` 449, `degradeBy` 699), `cyclist.mjs` (`hasOnset` filtering 63, 137),
  `hap.mjs` (89), `controls.mjs` (2518, `clip`/`legato` alias)
- The score: `src/audio/wobble.ts`, `kit.ts`, `layers.ts`, `arrangement.ts`,
  `director.ts`, `soundfonts.ts`, `engine.ts`; `AGENTS.md` §4;
  `tools/capture.mjs`, `reverbchurn.mjs`, `sections.mjs`, `basscheck.mjs`

Measurements marked **[MEASURED]** were produced today with `tools/capture.mjs`
(full-mix octave bands, 8 bars, seed `0x51ed`) and three scratch probes: real
superdough in headless Chromium against an `OfflineAudioContext` for the
distortion / vowel / tremolo / supersaw / noise tables, and `@strudel/core`
under `tools/lib/headless-audio.mjs` for the hap queries and the RNG proof.
The probes were throwaway; every number they produced is transcribed above.
If any of them is going to be relied on twice, it belongs in `tools/`.
