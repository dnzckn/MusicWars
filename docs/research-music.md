# research-music — why "music is not great", ranked

*Diagnosis only. Nothing in `src/` was changed. 2026-08-24.*

Read against `AGENTS.md` (§3 doctrine, §4 superdough traps, §6 measuring),
`README.md`, and `docs/MASTER_PLAN.md` §1 (Track S) and §7 (changelog).

---

## 0. What is and is not verified, stated first

**This checkout has no `node_modules`.** The tree is `AGENTS.md README.md docs
electron index.html package-lock.json package.json src tools tsconfig.json
vite.config.ts` and nothing else. Consequence, established by running them
rather than assumed:

- All 16 node-only music tools fail identically at
  `tools/lib/headless-audio.mjs:46` — `ERR_MODULE_NOT_FOUND: Cannot find package
  '@strudel/mini'`. That file is the shared harness every music tool imports.
- All browser-gated tools fail one step earlier on `playwright`.
- `node --experimental-transform-types tools/render.mjs` fails the same way. **No
  WAV was produced. Nothing was listened to.**
- `tsc` is unavailable, so no typecheck was run either.

**Exactly four tools have no external dependency and two of them are music
tools.** Those two ran clean and are the only fresh measurements in this
document:

| tool | exit | result |
|---|---|---|
| `node tools/clash.mjs` | 0 | 58 unresolved on-beat clashes across the ladder (was 193 at the 2026-08-22 baseline in the tool's own footer). Worst mode locrian 16, phrygianDominant 14. **lydian 0.** Boss leitmotif 2 unresolved of 14 (was 4). |
| `node tools/motif.mjs` | 0 | 9 distinct rhythmic profiles across 9 themes; mean SHAPED economy 61%. Two themes flagged: `THEMES[3]` 33%, **`THEMES[4]` 0% — no shaped figure recurs in it at all.** |

Everything else below is one of:

- **MEASURED (recorded)** — a number a real tool produced, read out of
  `MASTER_PLAN.md` §7, `tools/README.md`, or a tool's own recorded baseline in
  its source. Not re-run today.
- **MEASURED (counted)** — counted off the tables by walking them, the way Track
  G's inventory was counted. Not a listening claim.
- **HYPOTHESIS** — a causal claim about what a person hears. No listening
  artefact exists on this box, so *every* audibility claim here is a hypothesis,
  including the ones I am most confident about.

Also, for §7 of `AGENTS.md`: **the failing-disk story did not manifest here.**
This session ran natively on Windows 11; `Get-PhysicalDisk` reports three disks
all Healthy/OK. The `hv_storvsc` / D-state / `ldd` narrative in AGENTS.md
describes a WSL2 Linux environment. Those may be two different machines. I did
not run a block-level scan, so this is a data point, not a retraction.

**One correction to a premise in the brief.** 200 Hz is **MIDI 55.4**, not 43.4
(MIDI 43.4 ≈ 100 Hz). The 200–800 Hz band is **MIDI 55.4–79.4**. Everything
below uses that.

---

## 1. The verdict in one paragraph

The writing is not the problem. The tune system is a real eight-bar parallel
period with eight themes, a rondo, and eight classical development transforms;
`clash` scores 58 unresolved on-beat notes across nine modes and lydian is
clean; `motif` finds nine distinct rhythmic profiles. Five named bass figures,
five grooves, a voice budget, asymmetric tension smoothing, curves instead of
switches — this is more compositional machinery than most shipped adaptive
scores have. What is wrong is **the rendering and the shape**: one filter bug
deletes the lane that carries the body of the mix, and everything else piles
into the hole it leaves, in one octave, dead centre, at constant density, on a
form whose longest unit is eighty seconds. It is not badly composed. It is badly
mixed and structurally flat, and those two together are what "not great" names.

---

## 2. Ranked diagnosis

Ranked by *expected audible gain per unit of work*, not by size of the gap. By
"size of the gap" the structural item (#3) is first, and it is the one the brief
suspected; I have put it third because #1 and #2 are cheaper and I believe they
are louder.

---

### 1. The bass is spectrally deleted by the ladder-filter bug, and the one listening tool renders it correctly so nobody could hear it

**MEASURED (counted) + HYPOTHESIS on the audible consequence.**

`AGENTS.md` §4 records the routing, verified there against superdough@1.3.0:
`helpers.mjs:238` sends `model === 'ladder'` to the `ladder-processor` worklet
(a four-pole Moog **lowpass** with parameters `frequency`, `q`, `drive` and no
type at all), the `filter.type = type` assignment lives in the dead `else`
branch, and `hpMap` maps `model: 'ftype'` at `superdough.mjs:706` — so the same
control feeds the highpass node. **I could not re-verify this against the
package because `node_modules` is absent.** I am taking the repo's own recorded
reading of superdough as given and reasoning forward from it.

Three call sites, not one:

| site | line | control | notes played | what the node actually is |
|---|---|---|---|---|
| `buildBass` sawtooth voice | `layers.ts:1631` + `:1640` | `.hpf(95).ftype('ladder')` | MIDI 45–72 (110–587 Hz) | 24 dB/oct **lowpass at 95 Hz** |
| `wub()` — the halftime wobble | `wobble.ts:143` + `:156` | `.hpf(74).ftype('ladder')` | MIDI 45–56 (110–208 Hz) | 24 dB/oct **lowpass at 74 Hz** |
| `reese()` — the growl | `wobble.ts:203` + `:206` | `.hpf(180).ftype('ladder')` | MIDI 57–68 (220–415 Hz) | 24 dB/oct **lowpass at 180 Hz** |

Attenuation of the **fundamental**, from `|H| = (1 + (f/fc)²)⁻²`:

```
buildBass, fc = 95 Hz
  MIDI 45  110 Hz   -14.8 dB      <- lowest root
  MIDI 51  156 Hz   -22.6 dB
  MIDI 56  208 Hz   -30.5 dB      <- highest root
  MIDI 57  220 Hz   -32.1 dB      <- lowest octave note
  MIDI 68  415 Hz   -52.1 dB      <- highest octave note

wub(), fc = 74 Hz            reese(), fc = 180 Hz
  110 Hz  -20.3 dB              220 Hz  -15.9 dB
  208 Hz  -37.9 dB              415 Hz  -32.0 dB
```

Every harmonic is further down again. Four consequences, all of which match the
complaint:

1. **There is no body in the mix.** The lane written at the highest gain of any
   low source (`.gain(0.86)` × three layers, `layers.ts:1658/1667/1669`) is 15–52
   dB down across its own range. The sub is fine — it lives at MIDI 33–51
   (55–155 Hz) with a working `lpf` and no `hpf`, and the ceiling doc at
   `layers.ts:96` records it measuring 0.390 against a kick at 0.77 with a full
   band. So the game has *sub-bass at peaks* and **a hole where the body is**.
2. **The bass is not a line, it is a lump.** Attenuation is pitch-dependent, so
   the default feel's octave pedal `${low} ${octave} ${fifthLow} ${lead}`
   (`layers.ts:1546`) plays its octave notes 17 dB below its root notes. The
   Castlevania eighth-note engine the comment is proud of cannot be heard as an
   engine.
3. **The wobble does not wobble.** The halftime bass composes its rhythm in
   filter movement — an LFO sweeping `lpf` between 300 and 1050 Hz at Q7
   (`wobble.ts:145–159`). That sweep operates on a signal already annihilated
   above 74 Hz. `feelForWave`'s rota gives halftime three of eight slots and the
   recorded bar share is **27.8%**, so this is the single most-played bass part
   in the game and its defining gesture is inaudible.
4. **`render.mjs` renders it correctly, which is worse than not rendering it.**
   `tools/render.mjs:473–475` implements exactly one filter — a one-pole lowpass
   on `v.cutoff`. It **never reads `hpf` and never reads `ftype`.** So the only
   listening artefact this box can produce plays the bass with a full 110 Hz
   fundamental and no phantom lowpass at all. This is the same class of error as
   the ADSR bug §7 already caught and fixed: *the listening tool was arguing
   against the defect.* Every spectral figure taken from `render.mjs` — including
   the "sub+low 45–50% → 19–22%" headline in `README.md` — is measuring a bass
   the game does not play.

**The change.** You cannot have a ladder lowpass and a real highpass on one hap:
one `ftype` control feeds both nodes. So it is a choice, per lane:

- `wub()` / `reese()` — the ladder *is* the sound (Q7 resonant sweep). **Keep
  `ftype('ladder')`, delete the `hpf`.** Separation from the sub is already
  provided by register (sub tops out at MIDI 51, wub starts at 45 — 6 semitones,
  which is thin; if that proves audible as a boom, move the sub down rather than
  filtering the wobble).
- `buildBass` — `lpq(5)` and `lpenv(2)` are modest; a 12 dB biquad would serve.
  **Either** delete `.hpf(95)` and keep the ladder, **or** delete `.ftype('ladder')`
  and keep a real `hpf(95)`. Prefer the first: it preserves the drive-linked
  saturation the ladder worklet gives.

Do these as **one commit per lane with a spectrum read between them**, because
this is the largest single change to the mix's low end in the project's history
and it will move `audiocheck`, `mixaudit`, `spectrum` and `masking` all at once.

**Files.** `src/audio/layers.ts:1631,1640` · `src/audio/wobble.ts:143,156,203,206`
· `tools/render.mjs:460–495`.

**Verification gate.** Two, and the first is the important one:

- **New, node-only, ~30 lines: `tools/filtercheck.mjs`.** Query every lane's
  haps and **fail any hap that sets both `hpf` and `ftype`**, printing the lane,
  the hpf value and the note range. This reads the scheduled haps, not the source
  text, so it cannot be satisfied by a comment. It costs nothing and it would
  have caught this on the day the line was written. *How it could be gamed:* by
  setting `hpf(0)` instead of removing it — so also fail `hpf > 0 && ftype` and
  print the count of haps examined (`checked === 0` is a failure, per §3).
- **Teach `render.mjs` to render what plays, not what was written.** Apply `hpf`
  as a one-pole highpass; and when `ftype === 'ladder'` is present, apply the
  `hpf` value as a *lowpass* instead. Then the before/after WAV pair is a real
  A/B. Until that lands, no spectral number from `render.mjs` should be quoted
  about this lane in either direction.

*Prove the gate red before trusting it: re-add `.ftype('ladder')` after the
`hpf` and watch `filtercheck` fail on each of the three lanes separately.*

---

### 2. The mix runs at its architectural maximum for most of the run

**MEASURED (recorded).**

`tools/texture.mjs`'s own recorded baseline (2026-08-22, in the tool's footer):

```
forward voices (fader > 0.15), mean 8.3, spread 5
  intro 3.4 | breakdown 5.3 | build 7.8 | fill 8.0 | sustain 8.8 | drop 9.3
```

`tools/sections.mjs`'s recorded history: drop share **70% → 53.6% → 49.5%**, gate
`MAX_DROP = 0.60`, `MIN_QUIET = 0.05`. `variety`/`tensionprobe` post-fix: drop
47% / quiet 21%, and drop 46% / quiet 26%.

Now count the architecture. `STEM_IDS` is 11. `TONAL_LANES` is 5 (`chords`,
`lead`, `arp`, `motifs`, `power`). The other **six** — `sub`, `kick`, `clap`,
`hats`/motor, `bass`, `fx` — are exempt from the voice budget by design
(`orchestration.ts:77–103`). `SECTION_BUDGET` is 4 in a drop and 3 in sustain
(`orchestration.ts:115`). So the ceiling is:

```
drop     6 exempt + 4 tonal = 10 possible    measured 9.3
sustain  6 exempt + 3 tonal =  9 possible    measured 8.8
```

**The mix sits at 93–98% of its own maximum voice count in its two densest
sections — one of which, the drop, alone holds 46–49.5% of a run.** (The sustain
share is not separately recorded; `sections` prints it but the figure was never
written down. Get it in the same run that re-establishes the baseline.) The
voice budget is barely binding; the
exempt six are what fills the bar. And `sections`' own footer records the honest
version: *"The last change moved the STRUCTURE and not the loudness: rendered
over 64 bars, p10-p90 was 11.4dB both before and after. Do not claim it as
dynamics."* Renaming a section is not orchestrating it.

Two arithmetic details that explain why the subtraction that exists does not
land:

- `YIELD_NEAR = 0.18` (`orchestration.ts:149`) is a **multiplier on the want**.
  `chords` wants ~0.80 at the measured median energy, so its "yield" lands at
  0.144 — right on `texture`'s FORWARD threshold of 0.15. The near-yield is a
  rounding error away from not being a subtraction at all in the terms the
  project's own tool uses.
- The only places anything is genuinely **zeroed** are `breakdown` (kick, clap,
  bass → `want = 0`, `director.ts:1106`) and `collapse`. `MOVEMENT_MIX.hush`
  multiplies rather than zeroes (kick 0.18, clap 0.1). And `movementFor`
  (`world.ts:1860`) gives a movement only on waves where `index >= 5 &&
  index % 4 === 1`, cycling elite/hush/flank — so **HUSHED, the one gesture in
  the game built out of absence, occurs on waves 9, 21, 33: roughly once every
  six minutes.**

**The change.** Not "add another gate on tension" — the curves already do that
and the measurement says it does not produce dynamics. Three things that
subtract structurally:

1. **Put the exempt six under a section rule.** Not the tonal budget — a
   `SECTION_TACET` table naming which of `sub/kick/clap/hats/bass/fx` are *out*
   per section. `sustain` is the place to spend it: it holds the most bars and it
   is currently the second-densest section in the mix. `hats`/motor is the
   pulse-inversion lane and must be exempt from the exemption — see §5 of
   "not proposing", below.
2. **Make `YIELD_NEAR` an absolute target, not a multiplier**, so a yielding
   lane lands at a stated level (say 0.10) rather than at 18% of whatever it
   happened to want.
3. **Raise HUSHED's frequency** — `index % 4 === 1` cycling three movements means
   any one movement is a 1-in-12-wave event. Give the subtractive one its own
   cadence.

**Files.** `src/audio/orchestration.ts:115,149,150` · `src/audio/director.ts:1106`
· `src/audio/layers.ts:493` (`MOVEMENT_MIX`) · `src/game/world.ts:1860`.

**Verification gate.** `texture` already has the right shape and the wrong
threshold: `MIN_SPREAD = 2.0` against a measured spread of 5. Replace it with a
**per-section** assertion — *no section may average more than N forward voices,
and at least one section holding ≥10% of the run must average below M* — with N
and M frozen from a calibration sweep, not invented. *How it could be gamed:*
by pushing a lane to 0.149 so it stops counting while still sounding. So the
same commit must add a **sum-of-levels** column alongside the count; a mix that
keeps its energy while dropping under a counting threshold fails both readings,
not one. `sections` keeps its own drop-share and quiet-share gates unchanged.

---

### 3. There is no musical unit longer than eighty seconds

**MEASURED (counted, from source arithmetic; wave length from `wavelength`'s
recorded figure).** See §3 below for the full treatment — this is the entry in
the ranking.

Every timescale in the score, longest first:

| unit | period | mechanism |
|---|---|---|
| key (tonic) | **~80 s** (4 waves) | `director.ts:2186`, cycle of fourths, deferred to a phrase line |
| theme | ~36 s (2 waves) | `themeForWave`, `layers.ts:2751`, rondo A B A C A D A E |
| **groove (feel)** | **~18 s (1 wave)** | `feelForWave`, `layers.ts:650`, 8-slot rota, **applied immediately** |
| section | 8–15 s (4–8 bars) | `arrangement.ts:39`, chosen by an instantaneous scalar |
| phrase | ~14 s (8 bars) | `BARS_PER_PHRASE`; development transform advances |
| chord | ~3 s (2 bars) | `PROGRESSIONS`, `theory.ts:209` |

`wavelength` records ordinary waves at **18 s (1.2 phrases)** and bosses at 46 s.
`keyrate` records the key at **a modulation every 80 seconds, four keys in four
minutes** (down from every 20 s, eleven keys in four minutes — a real fix).

Nothing in that table accumulates. Every row is a **cycle**: the key walks the
circle of fourths and returns after 48 waves, the theme rotates a rondo, the feel
rotates an 8-slot rota, the section machine is a servo on a scalar with no
memory. **A run has no arc.** Wave 30 is structurally identical to wave 4 — a
different key, a different tune, the same shape at every level. `MASTER_PLAN.md`
§0 already names this from the game side ("runs dissipate instead of climaxing")
and Track S has **no workstream for it**: S1–S8 are envelopes, beds, register,
rooms, onset diet and the composed-not-generated tells. G1's authored coda is a
finale, not an arc.

**Files, the change, and the gate** — see §3.

---

### 4. Register congestion, and the one displacement rule pushes the wrong way

**MEASURED (counted) + MEASURED (recorded) for the roughness share.**

Written ranges as the builders actually produce them:

| lane | written MIDI | Hz | in 200–800 Hz (MIDI 55.4–79.4)? |
|---|---|---|---|
| sub | 33–51 | 55–155 | no (but `lpf` ceiling 720 Hz parks harmonics 4–13 inside it) |
| bass | 45–72 | 110–587 | ~65% |
| motor | 54–71 | 185–494 | **100%** |
| pad | 50–79 (50–67 when the melody plays) | 147–784 | ~85% |
| stabs | 50–79 — **the identical note array** | 147–784 | ~85% |
| arp, lead absent | 67–91 | 392–1568 | ~50% |
| **arp, lead present** | **55–79** | **196–784** | **100%** |
| lead triangle | 60–83 | 262–988 | ~80% |
| lead saw −12 | 48–71 | 131–494 | ~70% |
| colour 7th/9th | 72–103 | 523–3136 | ~25% |

**Eight always-on pitched voice-groups have fundamentals in 200–800 Hz.** Counted
as voices rather than lanes, an ordinary `sustain` bar with no powerups renders
about **19 simultaneous pitched voices** (3 bass layers + 2 motor + 3 pad + 2
colour + 1–2 stabs + 2 arp + 6 lead), of which roughly 15 have a fundamental or
dominant partial in that octave and a half.

Three specific collisions:

- **`pad` and `stabs` are literally the same note array.** `layers.ts:2123–2128`
  interpolates `chordOf(voiced)` into the stab rhythm strings, so the two are in
  perfect unison, on the same orbit, differing only in envelope and pan
  (0.24/0.50/0.76 against 0.58).
- **`arpDisplacement` returns `-12`** (`orchestration.ts:334`) whenever the lead
  and arp are both above 0.18. So the arp drops from 67–91 into 55–79 — the pad's
  exact window and the motor's entire window — precisely when the texture is
  fullest. `MASTER_PLAN.md` §1 S-c names this and prescribes upward displacement
  with an `hpf(2000)` sparkle. **Neither has landed; S3 is unstarted.**
- **The five hpf calls that look like lane separation are not.** `pad:1903`,
  `colour:1978`, `stab:2171`, `arp:2375` and `lead:2519` all read
  `.hpf(m.sig.thin.range(20, …))` — and `thin` is the *player-damage* signal. At
  full health all five sit at **20 Hz**. When they do lift, they lift together:
  a mix-wide thinning, not a lane boundary. The only real always-on boundary EQ
  in the file is the bass's `hpf(95)`, which per #1 is not a highpass.

The recorded roughness measurement: `chords + lead` is **67% of all audible
roughness in the score** with audibility weighting (67% → 49% after the pad was
opened to fifths). The plan's S-c contract (drone 21–36 · bass 45–57 · pad 50–72
· motor 57–69 · lead 69–84 · arp 81–96) exists **only in the plan**; the sole
register constant in the codebase is `MOTOR_BOTTOM = 57 / MOTOR_TOP = 69`
(`layers.ts:1058`), and even that leaks: the `chase` line writes `root+2` with no
re-clamp (`:1158`, reaching MIDI 71) and the fill-bar turnaround writes
`target - step*3` with no re-clamp (`:1208`, reaching 54 or 72), against
`motorcheck.mjs:16`'s assertion that every note lands in 57–69.

**The change.** In order of cost:

1. **Flip `arpDisplacement` to `+12`** and gate the arp's `hpf` on the lead's
   presence rather than on damage. One line and one signal. This is S3's cheapest
   half and it is currently pointing backwards.
2. **Give the stabs their own voicing** — a different inversion or a two-note
   shell of the same chord — so `pad` and `stab` are two parts, not one part
   twice.
3. **Make the register map a constant table**, `LANE_RANGE: Record<StemId, [lo,
   hi]>`, imported by the builders *and* by the gate, per §3's "a tool holding
   its own copy of a constant will lie the day it moves."
4. Re-clamp the motor's two escapes.

**Files.** `src/audio/orchestration.ts:333–335` · `src/audio/layers.ts:1058,1158,
1208,1903,1978,2123–2128,2171,2375,2519`.

**Verification gate.** `masking` is node-only, it is the right tool, and **it has
never recorded a number** — it was run and passed during the S1 bass work with
no figures kept. So: run it, record the baseline in `MASTER_PLAN.md` §7 with the
per-pair table, then gate on the `chords+lead` audibility-weighted share and on
an **absolute** roughness-seconds figure (the plan's `roughness-exposure`, §4).
*How it could be gamed:* by cutting the pad's gain, which scores well on a
zero-sum share and makes the mix worse. Hence the absolute figure alongside the
share, and a floor on the pad's own level in the same assertion. Add a
`registermap` check that fails any hap outside its lane's declared `LANE_RANGE`
— that one would already be red today on the motor.

---

### 5. Onset density: a fresh transient every 28 ms

**MEASURED (recorded).** `attackfloor` over a 720 s / 385-bar sweep: **49.7 haps
per bar ≈ 26.1 onsets/s early, 64.1 per bar ≈ 36.0 onsets/s late** (+29%).

This is `MASTER_PLAN.md` §7's own standing conclusion after the "no gaps"
negative result: *"If 'choppy / abrasive over time' is not gaps, the leading
remaining candidate is onset DENSITY."* It is a count problem, not an envelope
problem, and the plan's own note says reducing it means removing notes, which
collides with the retention doctrine and **must not be started on a hunch**.

I have nothing to add to that analysis and I am not going to re-derive it. What
I *can* add is that #2 and #4 above are the cheap half of it: an onset that is
masked into inaudibility still costs a transient. Cutting the voice count in
`sustain` and un-stacking `pad`/`stab` reduces onsets without touching a single
written figure, which is the version of this that does not fight retention.

**The change.** Do #2 and #4 first, then re-run `attackfloor` and see how much of
the 36/s was the duplicated stab lane and the yielded lanes still sounding.
Only then consider S5's per-lane onset-diet table.

**Files.** As #2 and #4.

**Verification gate.** `attackfloor`'s haps-per-bar and onsets-per-second
columns, before and after, with the denominator printed. Note the caveat
AGENTS.md §6 already records: its `dBFS` column is `gain² · level² ·
masterVolume²` and cannot see anything an envelope or a filter did.

---

### 6. The harmony has one sentence and nine colours of it

**MEASURED (counted).**

`theory.ts:209` — `PROGRESSIONS` is nine entries, one per mode, and **eight of
the nine are the identical rhythmic shape**: `[[x,2],[y,2],[z,2],[w,1],[0,1]]`.
Four chords over six bars, then two chords in two bars. Only `locrian` differs
(`[[0,4],[3,2],[5,1],[0,1]]`). Every chord is a plain diatonic triad on a scale
degree. There are **no secondary dominants, no borrowed chords, no pivot
modulation, no deceptive cadence, no chord that is not `[0,2,4]` on some degree.**
Harmonic rhythm is 1.6 bars per chord in eight modes, 2.0 in locrian.

Which mode you get is `MODE_LADDER[floor(pow(t, 1.8) * 8 + modeBias)]`
(`director.ts:1543`). Against `realprobe`'s recorded distribution (p10 0.354,
median 0.622, p90 0.700) that resolves to:

```
p10  0.354  ->  idx 1   ionian
med  0.622  ->  idx 3   aeolian
p90  0.700  ->  idx 4   phrygian
```

**Lydian — the mode `clash` just scored at zero unresolved, the cleanest in the
game — requires energy below 0.315, which is under the measured p10.** It is
reachable only with a negative `modeBias` from a flawless clear. The bright end
of the palette that `MODES`' own comment argues for at length is, in ordinary
play, nearly unreachable. `variety` recorded the older version of exactly this
defect: *"83% in the dark four modes with dorian never heard once."*

So the harmonic vocabulary a listener actually meets over ten minutes is: three
or four modes, each with one eight-bar sentence of triads, in the same rhythmic
shape, transposed by fourths every eighty seconds.

**The change.** Not "faster harmonic rhythm" — that is measured and rejected,
twice, and the rejection was re-tested after three themes were rebuilt and held
(`theory.ts:150–208`). Three that do not touch harmonic rhythm:

1. **Give each mode two or three progressions and pick by section**, so the
   build and the drop are not harmonically identical to the sustain. This is
   authored content in an existing table and costs no offer slots and no lanes.
   Run `clash` on every candidate *before* adopting it — that is what the tool is
   for and it is one of the two that still runs.
2. **Re-map the mode ladder onto the measured distribution.** `pow(t, 1.8) * 8`
   was chosen against a signal whose median has since moved to 0.622; the same
   defect the `sustain`, `build` and `fx` thresholds all had. Re-derive the
   exponent so lydian and ionian occupy the bottom two deciles the game actually
   produces.
3. **One borrowed chord per mode** — a bVI in ionian, a Picardy third at a boss
   defeat — as a *cadence event*, not a vamp member.

**Files.** `src/audio/theory.ts:209–272` · `src/audio/director.ts:1543–1560`.

**Verification gate.** `clash` (runs today, exit 0, 58 unresolved) must not rise
— that is the guard on adding progressions. Add a **mode-occupancy histogram**
to `session` or `realprobe`: print the share of bars in each of the nine modes
over a 900 s run and fail if any mode in `MODE_LADDER` gets **0%** or if the top
mode exceeds ~40%. *How it could be gamed:* by adding a mode nobody hears, so
print the denominator and the per-mode bar counts, not just percentages.

---

### 7. Everything that carries weight is dead centre and dry

**MEASURED (counted).** Panning, across all thirteen pitched voice-groups:

| dead centre (`pan(0.5)` or absent) | placed |
|---|---|
| **sub** (no `.pan()`) | pad 0.24 / 0.50 / 0.76 (`fanPans`, `:1841`) |
| **bass** and **wub/reese** (no `.pan()`) | stabs 0.58 (`:2166`) |
| **motor** — explicit `.pan(0.5)` (`:1279`) | clav 0.40 (`:2108`) |
| **lead** — explicit `.pan(0.5)` on the whole stack (`:2618`) | arp 0.36, or 0.14/0.86/0.5/0.4 with drones |
| colour tones (0.5 unless FLANKED, `:1985`) | motifs 0.70/0.34/0.66/0.30/0.62/0.38 |
| all four power voices (`:3625,3662,3693,3720`) | fx crash 0.44, graze 0.62 |
| conductor + subdrop motifs (`:3449,3462`) | |

`.jux()` appears nowhere in `src/` outside the type declaration. The only real
width control anywhere is `reese()`'s `.spread(0.7)`, and `buildChords` records
at `:1830` and `:2154` that `.spread()` was inert on the pad and stabs for the
project's entire life because superdough reads it only in the supersaw branch.
`movements` records FLANKED moving stereo width **0.15 against a 0.02 control
band** — a real effect, on one wave in twelve.

Reverb is inverted the same way, and this is `MASTER_PLAN.md` §1 S-e, still
unstarted: **the loud clock lanes are bone dry** (sub, bass, wub/reese, motor —
no `.room()` at all) **and the quiet colour lanes are wet** (pad .58–.95, colour
.62–.95, lead .34–.95). There is no shared room: `ORBIT_HARMONY` alone carries
motor (0), pad (.58–.95), colour (.62–.95), stab (.28–.70), clav (.16), arp (0)
and lead (.34–.95) — **seven different room values on one orbit**, which is seven
different rooms, which is no room at all.

**HYPOTHESIS on the consequence, and it is the one I hold most confidently after
#1:** four of the loudest sources in the mix, including the tune, are summed to
the same point in the stereo field with no shared space behind them. That is
what makes a dense mix read as a wall rather than as a band — not the note count,
the fact that the notes are all in the same place.

**The change.** S-e as written in the plan: one algorithmic room per orbit group
(HARMONY .4/size 6, LOW .12, DRUMS .08, motor joining at .15 with a slow perlin
pan drift), and a small deterministic pan offset per lane so the bass, the motor
and the lead are not stacked at 0.5. Note that `.pan(0.5)` on the lead is applied
to the **whole stack** at `:2618`, so it is a later-writes-win site: any per-voice
pan set upstream is erased. Fix that before trying to place the descant.

**Files.** `src/audio/layers.ts:1279,1907,1980,2180,2612–2618` ·
`src/audio/wobble.ts` · `src/audio/kit.ts:218–227`.

**Verification gate.** **There is no width tool and no whole-mix stereo
measurement anywhere in `tools/`.** Write one, node-only, off the haps: per-lane
`pan` histogram, count of lanes within ±0.05 of centre weighted by written gain,
and the correlation between a lane's gain and its distance from centre. Gate:
no more than N of the top-K lanes by gain may sit at centre. Add a `wetfloor`
check per the plan (motor/bass room ≥ .1, queried off haps). *How it could be
gamed:* by panning a silent lane hard left. Hence the gain weighting, and print
the per-lane table so a reviewer sees which lanes moved.

---

### 8. No microtiming, almost no velocity — every note is machine-placed and machine-loud

**MEASURED (counted).** Across all 3769 lines of `layers.ts`:

- `.late(` — **one** occurrence, `:2116`, 16 ms, on the halftime clav's offbeat
  layer only. No `.early(`, no swing helper, no humanisation of any kind.
- `.velocity(` — **four** occurrences: `:974` (0.38), `:1277` (the motor's
  layer level), `:2153` (1.41, a fixed +3 dB compensation for a 25% duty pulse),
  `:3333` (`'0.5 0.7 0.85 1'`, one fx element). **No pitched mainline has any
  per-note velocity variation.**

To be fair to the file: the *written* rhythms are genuinely good. `kickRhythm`
has five per-feel additive ladders with no four-on-the-floor left in the default;
the gallop is a real dotted-eighth-and-sixteenth (`@3`); the shuffle kick is
`[c1@2 ~] c1` which is a true 2:1 triplet; `motorVoicing`'s boom-chick moves the
inner voice to the offbeat specifically because `interlock` measured the old
version as the most grid-locked feel in the game. This is not a "no syncopation"
problem.

It is a **no-human** problem. Every note lands exactly on its mathematical
subdivision at exactly the same loudness as the last one. `MASTER_PLAN.md` §7
already names the sibling of this from the envelope side — *"four of the seven
pitched lanes measure an identical envelope on every hap of a twelve-minute
sweep… no note ever being shaped differently from any other"* — and correctly
concludes that the fix is a **spread** requirement, not a floor. The same
argument applies one level up: the fix is not "add swing", it is that no lane
should measure the same velocity on every hap.

Note also the **shuffle feel is straight above the drums**: `buildChords`'s
shuffle rhythm is `[~ chord] ~ [~ chord] ~` (`:2122`), even offbeat eighths, and
the arp/pad are not shuffled at all. Only the kick and the bass carry the
triplet. So on a shuffle wave the rhythm section swings and the harmony does not.

**The change.** `velocity(rand.range(.86, 1))` on the motor, arp and lead
mainlines is S-f's own prescription and costs nothing. Then make the shuffle feel
shuffle everywhere, or rename it.

**Files.** `src/audio/layers.ts:1277,2122,2153` and the mainline voice builders.

**Verification gate.** Extend `attackfloor`'s BY VOICE table with a **velocity
spread** column (lo/med/hi per lane, like the attack column) and fail any pitched
mainline whose velocity is identical on every hap. This is the same shape as the
envelope-spread requirement §7 already argues for, and it **cannot be satisfied
by typing a constant**, which is the property that makes it worth having. Pair it
with `interlock`'s off-grid share, which already exists and deliberately has no
threshold.

---

## 3. Long-form musical structure — the dedicated section

The brief's suspicion is correct and it is more specific than "there is no
structure". There is a great deal of structure. **What there is none of is
structure that goes anywhere.**

### 3.1 What exists

Six nested cycles, listed in §2 item 3. Every one of them is well built and
several were fixed at real cost — `keyrate` took the key from a modulation every
20 s to every 80 s; `churn` found no theme was ever stated twice before being
replaced and `themeForWave` now runs on two-wave periods; `arrangement.ts` has
four separate comment blocks about `MIN_BARS` equalling a timeout and killing a
tension branch. This is a lot of careful work.

### 3.2 What is missing, precisely

**(a) The section machine is a servo, not a form.** `Arranger.onBar` switches on
`this.section` and compares `tension` to a constant. It has no memory of what has
already happened in the run: no count of drops so far, no notion of "this is the
third build and it must be bigger than the second", no state that survives a
section change. A form is a *sequence of decisions that reference each other*; a
thermostat is not a form however well its thresholds are tuned. This is why
`sections`' own footer can honestly report that restructuring changed p10-p90 by
0.0 dB — the sections were relabelled, not re-orchestrated.

**(b) The longest unit is 80 seconds and the shortest structural one is 18.**
`feelForWave` changes the groove **every wave**, and unlike the tonic and the
theme it is **not deferred to a phrase line**: `director.ts:2146` assigns
`this.feel = feelForWave(e.index, false)` directly in `onWaveStart`, while the
tonic goes through `pendingTonic` and the theme through `pendingWave` /
`musicalWave` (`:1469`, `:2145`) precisely so that "all three turn together", as
the comment forty lines above claims. They do not. `wave` is in the structure key
and is `IMMEDIATE` (`:1870`), so the groove flips mid-phrase, roughly every 18
seconds. The canon this score names — Chrono Trigger, Wily Stage 1, Frog's Theme
— holds one groove for the whole cue, one to three minutes.

**(c) Nothing is reserved.** Every device the score owns is available at every
moment. The drop is available in the first minute. The full ensemble is available
as soon as the band is recruited. The boss mode and `BOSS_THEME` are the *only*
reserved material in the whole system, and they are reserved by event rather than
by position in the run. A form is largely a schedule of things you have not used
yet.

**(d) There is no ending and no approach to one.** `MASTER_PLAN.md` §0 says so
from the game side. Musically: `collapse` on death, and nothing else. A run that
goes well simply stops.

**(e) `THEMES[4]` has 0% shaped construction** (measured today, `motif`), and
`THEMES[3]` 33%. In a rondo where the episodes are the contrast, an episode with
no recurring figure in it is the one statement a listener cannot hold on to.

### 3.3 The change

The cheapest first, because this is the item most likely to be over-engineered.

1. **Defer `feel` to the phrase line, and hold it for two waves.** One line —
   route it through `pendingWave`/`musicalWave` the way the theme already is, and
   key it on `musicalWave` rather than the live wave. This makes the groove a
   36-second unit instead of an 18-second one and makes the file's own "all three
   turn together" comment true. It is the single highest-leverage structural
   change in the report and it is nearly free.
2. **Give the arranger a memory.** Three fields: `dropsThisRun`, `barsSinceLastQuiet`,
   `peakEnergyThisRun`. Then: a build's length and a drop's ceiling scale with
   `dropsThisRun`; a `breakdown` is *forced* if `barsSinceLastQuiet` exceeds a
   phrase count, regardless of tension. That last one alone converts "quiet is
   what happens when the game is calm" into "quiet is part of the form", which is
   the whole difference. It is also the honest version of the `MIN_QUIET = 0.05`
   gate, which currently only asks that quiet not be *absent*.
3. **Reserve something.** Pick two devices — the descant above combo 8 is already
   half of this — and make them unavailable before a stated point in the run. The
   arp's undisplaced 67–91 register, the colour 9th, the full six-voice lead
   stack: any of these can be a thing the run earns rather than a thing that is
   simply on.
4. **An arc term.** One scalar, `runProgress`, that rises monotonically with
   transport time and gates the *maxima* — the top of the tempo range, the drop's
   ceiling, the number of tonal lanes the budget will admit. Not a difficulty
   ramp (that exists) and not a loudness ramp (`ensembleTrim` deliberately
   refuses one), but a **ceiling ramp**: the same music, with more of its range
   unlocked as the run goes on. This is what makes minute twelve sound like a
   later part of the same piece rather than another instance of it.
5. Then, and only then, G1's authored coda has somewhere to arrive from.

### 3.4 The verification gate

**Nothing in `tools/` measures form.** `sections` measures section *share*,
`variety` measures mode share, `rondo` and `movements` are browser-gated, `churn`
and `phrasechurn` measure rebuild churn. None of them can distinguish a run with
an arc from a run without one, because all of them are distributional and an arc
is an *ordering*.

So the gate is new and it should be node-only:

**`tools/arc.mjs`** — drive a real `World` + `MusicDirector` for 900 s at ≥4
seeds, log per bar: section, energy, tempo, forward-voice count, mode index, key,
feel, theme index. Then assert **ordering properties**, not distributions:

- **Monotone ceiling:** the max of the forward-voice count (and of tempo, and of
  the drop's peak energy) over each successive 2-minute window must be
  non-decreasing across at least ⌈2/3⌉ of the windows. A flat run fails.
- **Correlation with time:** Spearman correlation between bar index and
  per-window peak energy must exceed a calibrated floor. Print the coefficient
  and the window table, always.
- **Enforced rest:** no window of N bars may contain zero bars of
  `breakdown`/`intro`/`collapse`.
- **Unit lengths:** print the median hold time of each of the six units in §2
  item 3 and fail if the groove's median is under a phrase.

*How it could be gamed, and the answer:* by making the first two minutes
artificially thin so everything after it is "rising". So the gate must also
assert an **absolute floor** on the opening windows — a run that starts empty
fails a different assertion — and it must print all four windows so a reviewer
sees the shape rather than a verdict. Per §3, break each assertion deliberately
and watch it go red *individually* before trusting any of them; and print every
denominator, because a tool that examined zero windows currently reports a pass.

---

## 4. Things I am deliberately not proposing

Each of these is a plausible move this repo has already measured and rejected.
Recorded here so the next reader does not spend the day again.

1. **Faster harmonic rhythm** (a chord per bar). Measured twice, twelve
   candidates across four modes, every one worse; re-tested after three themes
   were rebuilt and it held, with the margin narrowing to +1 in phrygian.
   `theory.ts:150–208`. The change is "rewrite `THEMES` and `PROGRESSIONS`
   together", not "edit the table".
2. **A detuned supersaw pad.** Recorded verdict: "a dance-music sound…
   enormously less fatiguing without". `MASTER_PLAN.md` §1 S-d.
3. **Sidechain / ducking, mix-wide.** `gating` measured the melodic buses more
   than 6 dB down 27–32% of the time, closing 2.5–3.7 times a second, and
   `duckdepth(0.9)` is a floor of −25.8 dB, not −0.9. Removed, not retuned. Any
   reintroduction is narrow (bed orbit only, ≤4 dB, ≤15% duty) with `gating`
   re-armed.
4. **Making the motor sustain, or giving it a 250 ms tail floor.** §7 records
   this explicitly: the motor plays 111 ms sixteenths on the fill bar, and a
   250 ms tail would stack three notes and turn the clock into a drone, undoing
   the pulse inversion the whole arrangement rests on. The motor is also the one
   lane that must stay exempt from any new section-tacet rule in #2.
5. **A flat `.attack(0.02)` floor on every lane.** This is the project's own
   recorded "gates optimised against" failure in a new costume: it satisfies an
   attack gate while leaving the invariance — no note ever shaped differently
   from any other — exactly as it is. The correct requirement is a **spread**.
6. **Adding a twelfth stem, or a fifth offer card.** Both are standing doctrines
   (`MASTER_PLAN.md` §5.8). Every proposal above works inside the existing eleven
   chairs.
7. **"The mix has gaps."** Measured negative: the full mix sits more than 12 dB
   below its own median **0.7%** of the time; `chop` reads the full mix at
   0.00–0.12 holes/s against a 6.3–7.0 positive control; `seams` finds section
   boundaries dipping 0.5 dB more than an arbitrary instant. The score does not
   have a silence problem. It has the opposite one, which is #2.

---

## 5. Verification gaps this diagnosis exposed

Worth fixing regardless of which remedies are taken.

1. **No tool reads the filter model off a hap.** The ladder bug is three lines in
   two files and has been live for the project's whole life with every gate
   green. `filtercheck` is ~30 lines and node-only.
2. **`render.mjs` still does not render what plays.** It applies `cutoff` and
   ignores `hpf` and `ftype` entirely (`:473–475`). The ADSR half of this exact
   defect was found and fixed in §7; the filter half was not. Until it is, the
   only listening artefact on this box smooths off the largest defect in the mix.
3. **`masking` has never recorded a number.** It is node-only, it is the correct
   tool for #4, it has been run and passed, and no figures were kept anywhere.
   Run it and write the table into §7.
4. **No width or stereo tool exists at all**, and no whole-mix room/wet
   measurement. #7 is currently unmeasurable by anything in the repo.
5. **No tool measures form** (§3.4).
6. **Fifteen tools the brief assumed were node-only are browser-gated:**
   `faders, subtraction, keychurn, keyrate, repetition, registercheck, voicing,
   bassprobe, subcheck, counterpoint, polyphony, movements, phrasing, variety,
   deadair`. The node-only music surface is 16 tools plus `clash`/`motif`; it is
   smaller than it looks.
7. **`tools/README.md` (2222 lines) documents an older generation.** Mention
   counts in it: `masking 0, registercheck 0, spectrum 0, realprobe 0, texture 0,
   interlock 0, contour 0, attackfloor 0, vibprobe 0, basscheck 0, leadcheck 0`.
   The current numbers live in tool headers and `MASTER_PLAN.md` §7. That is a
   reasonable place for them, but the README's index no longer indexes.
8. **`motorcheck.mjs:16` asserts a range the code does not hold** — MIDI 57–69
   against a `chase` line reaching 71 and a fill-bar turnaround reaching 54/72,
   neither re-clamped. Either the assertion is passing on inputs that never hit
   those branches, or it is dead. Worth breaking deliberately to find out.

---

## 6. Suggested order

`filtercheck` + the `render.mjs` filter fix are Phase 0 of anything here: without
them, #1 cannot be verified and every spectral number is suspect.

```
0.  filtercheck (new) · render.mjs applies hpf and models ftype('ladder')
    -> record a masking baseline and a spectrum baseline in MASTER_PLAN §7
1.  #1 the ladder bug, one lane per commit, spectrum between each
2.  §3.3(1) defer `feel` to the phrase line  — one line, largest structural win
3.  #4 flip arpDisplacement to +12; un-unison pad/stab
4.  #2 section-tacet for the exempt six; YIELD_NEAR as an absolute
5.  #7 rooms per orbit + pan offsets (S-e) — needs a width tool first
6.  §3.3(2) the arranger's memory; then arc.mjs; then (4) the ceiling ramp
7.  #6 mode-ladder remap; second progression per mode (clash gates it)
8.  #8 velocity spread — bundle with the attackfloor column
```

Steps 1, 3 and 5 all move `masking`, `spectrum`, `audiocheck` and `mixaudit`.
Re-establish each baseline in the commit that moves it, per §4's discipline, and
interleave any A/B smaller than its own noise band — `render.mjs` is ±2% on
identical runs and differences under that are not results.

---

## 7. Honest summary of standing

Nothing in this document was heard. No WAV was produced, no browser was launched,
no typecheck was run, and 40 of the 42 tools invoked failed on a missing package.
Two tools ran and their numbers are in §0. Everything else is either a figure
this repo recorded earlier from a real run, or a count taken by walking the
tables, or arithmetic on values read out of the source. The distinction is the
one thing this project's culture insists on, and the largest claim here — that
`.hpf(95).ftype('ladder')` is removing 15 to 52 dB from the lane that carries the
body of the mix — rests on a superdough reading I could not re-verify and on a
filter response I calculated rather than measured. It is the first thing that
should be put in front of an ear.
