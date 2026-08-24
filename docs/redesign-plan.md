# MusicWars — implementation plan, two tracks

I measured before planning. Three new numbers drive everything below; all are reproducible from this repo with no browser.

**Measurement 1 — the themes fail exactly the properties nobody built a tool for.** Script run against `THEMES` and `BOSS_THEME` in `src/audio/layers.ts` (8-bar undeveloped period, identity development):

```
theme  ant.end  cons.end  climax   step%  gap-fill  skeleton durations   notes  rhythms/8bars
T0       2 S      0 S     b7 x1     70%    0/8      {8th:12, dot4:6, half:4}   28    2
T1       3 U      0 S     b7 x1     48%    2/6      {8th:14, dot4:1, half:1}   30    3
T2       2 S      0 S     b7 x1     54%    1/10     {8th:14, half:3}           29    3
T3       2 S      0 S     b3 x1     71%    0/7      {8th:14, half:3}           29    3
T4       2 S      0 S     b3 x3     38%    3/4      {8th:16, half:2}           30    3
T5       4 S      0 S     b7 x1     71%    2/4      {8th:26, dot-half:2}       39    5
T6       1 U      0 S     b7 x1     69%    0/0      {8th:16, half:2}           30    2
T7       2 S      0 S     b7 x1     57%    2/3      {8th:14, half:3}           29    3
BOSS     4 S      0 S     b7 x1     50%    4/7      {8th:28, half:2}           31    3
```

- **Gap-fill 14/49 = 29%.** Nearly every leap in the table goes unanswered. This is the "wanders and never lands" sound, and it is the single largest defect.
- **Antecedent lands on a stable degree in 7 of 9 themes** (degree 2 = the mediant). The 8-bar period asks no question, so the answer isn't an answer. Technique #1 in the research — the highest-value one — is absent.
- **Stepwise 59.8% mean** against the canon's ~75%; T4 at 38% is a leap exercise.
- **84% of skeleton events are plain eighths**; T5 and BOSS are 93%. There is no rhythmic figure in any theme.
- Climax and cadence-arrival *pass* in 7/9 — those are precisely the two properties `motif.mjs` and `clash.mjs` already gate. **The measured properties are correct and the unmeasured ones are broken.** That is not a coincidence; it is what happens when a search optimises against the tools that exist.

**Measurement 2 — no tune is ever stated twice in one colour.** Live 8-minute run, seed `0x51ed`, sampling `director.mode` / `director.tonic` / `wave` per bar:

```
bars 256   mode changes 21 (one every 12.2 bars)   tonic changes 4   wave changes 16 (every 16 bars)
longest unbroken (mode, key, theme) run in the whole run: 16 bars = 2 phrases
mode bars: lydian 40, ionian 24, dorian 56, aeolian 40, harmonicMinor 24, phrygian 72
```

`updateMode` fires per phrase; `themeForWave` changes per wave; **the two are not aligned**, so a theme is typically heard for 4–8 bars in one mode and then continues in another. Recognition needs a statement, then a restatement in the same colour. The engine currently guarantees at most two phrases and often one. This costs nothing to fix and it is upstream of every note choice.

**Measurement 3 — the development counter is decoupled from the theme.** `phrase = floor(transport.bar / 8)` counts from run start and never resets, so `developmentFor(phrase)` hands theme *X* development index 5. A theme's first statement is frequently its inverted-and-displaced one. There is no ABA′ arc anywhere in the score.

**Baselines to hold:** `npm run clash` → 67 unresolved ladder / worst 19 / boss 4. `npm run motif` → mean shaped economy 87%, 9 distinct rhythmic profiles across 9 themes. Note the asymmetry `motif` exposes: the table varies well **between** themes and builds nothing **within** one.

---

# TRACK A — MUSIC

## A-0. The verdict on "hand-compose vs. generate"

**Hand-compose. But hand-composing into the current renderer cannot fix it**, because the renderer forbids four of the five highest-priority techniques:

- **No duration control.** `renderSlots` emits `_` only when `tie && sounded && cell[i]===null && runAt[i]>=2`. Duration is a side effect of where you put rests, and a single rest is reserved for the arp. You cannot write a dotted quarter followed by two sixteenths. Technique #6 (motif needs ≥2 durations) and #7 (fixed rhythmic cell, moving pitch) are unreachable.
- **The composer cannot choose which notes are the tune.** Skeleton = even slots, filigree = odd slots, positionally. The source comment already states the consequence as a writing rule: "whatever a bar is *about* has to land on a beat." That is the tail wagging the dog.
- **No anacrusis.** `cellForBar` starts every bar at slot 0. Technique #13 — the thing that makes a loop loop rather than restart — has nowhere to live.
- **8 slots.** No sixteenths, no dotted-eighth figures, no triplets, nothing below an eighth except the hardcoded `[~ n]` ornament at slots 3 and 7.

So the order is: **widen the container (proven no-op) → fix the structural coupling → then compose.** Composing first would produce nine more tunes that are all eighth notes.

Delete `tools/themesearch.mjs` when the themes are rewritten. It is the machine that produced 7 of the 9 current tables, its constraint set (`a = from(start, cell)`, `a2 = from(start+seq, cell)`, `b = from(start+4, inv(cell))`, `c = from(start+climax, cell)`, one fixed rest pattern) is why every theme is the same four-note cell sequenced and inverted, and leaving it in the repo guarantees someone re-runs it.

## A-1. Technique-by-technique verdict

**jrpg-melody dossier.** `HAVE` = present and working. `PARTIAL` = present but defeated by something. `MISSING` = not there.

| # | Technique | Status | Exact change |
|---|---|---|---|
| 1 | Antecedent–consequent, unstable→stable | **MISSING** (7/9 antecedents stable) | Composition rule A-4.2 + progression edit A-6.1 so bar 4 sits on a pre-dominant |
| 2 | One signature leap per phrase, answered smaller | **PARTIAL** — max leaps 2–7 degrees, unbudgeted | Composition rule: exactly one interval > 4 degrees per period, in bars 5–7; answering phrase's max strictly smaller. Gate in `tools/tune.mjs` |
| 3 | Leap-then-step recovery | **MISSING** (29%) | Composition rule, hard gate ≥80%. Highest-value single item |
| 4 | Single climax per phrase | **HAVE** 7/9 | Gate it: `count(max)==1`, bar 7, slot % 4 == 0. Fixes T3, T4 |
| 5 | Melodic arch / balanced ascent–descent | **PARTIAL** | Gate `|total ascent − total descent| ≤ 3` degrees per period |
| 6 | Motif ≥2 durations, ≥2 pitches | **MISSING** — 84% plain eighths | Requires A-2 (16-slot grid). Gate: ≥3 distinct durations, none >65% of events |
| 7 | Fixed rhythmic cell, moving pitch (~44% repeated) | **MISSING** — 2–5 distinct bar rhythms, no cell | Requires A-2. Gate: one declared 4–6 slot rhythmic cell appearing verbatim in ≥5 of 8 bars |
| 8 | Motivic transformation set | **HAVE** — 6 transforms in `DEVELOPMENTS` | But applied to the wrong 2 bars at the wrong time — see A-3 |
| 9 | Harmonic economy (~4 chords) | **HAVE** — every `PROGRESSIONS` row is 4 chords over 8 bars | No change |
| 10 | Major-chord weighting inside minor | **PARTIAL** — aeolian is i·VI·III·v·i (2 of 4 major) | `aeolian: [[0,2],[6,1],[5,1],[2,2],[6,1],[0,1]]` — i \| VII VI \| III \| VII \| i. Frog's-Theme family, 3 of 4 major |
| 11 | Modal colour (Dorian's major IV) | **HAVE** — `dorian: [[0,2],[6,2],[3,2],[4,1],[0,1]]`, IV gets two bars | No change |
| 12 | Royal Road (IVM7–V7–iii7–vi) | **MISSING** | `ionian: [[3,2],[4,2],[2,2],[5,1],[0,1]]`. Highest authenticity per byte in the report |
| 13 | Anacrusis as loop glue | **MISSING** — every theme starts at slot 0 | **Free — no engine change.** Write the pickup into the trailing slots of `theme.tag`; all current tags have ≥3 empty trailing slots |
| 14 | Rests / silence as material | **PARTIAL** — 1.5 beats at bar 4/8, but T3 and T4 have 0.5 beat at bar 8 | Gate: ≥1 beat trailing rest at bars 4 and 8, ≥2 beats combined |
| 15 | Syncopation / off-beat push | **PARTIAL** — filigree is on offbeats but is a fader, not a push | Requires A-2. Composition rule: ≥2 bars per period anticipate the downbeat by a sixteenth |
| 16 | Open voicing on rich waveforms | **HAVE** — pad opened to fifths; `masking` went 1253 → 910 | No change |
| 17 | Constrained range / singability | **HAVE** — spans 5–9 degrees | Gate ambitus ≤ 8 degrees; cap notes per period at 34 (T5 has 39) |
| 18 | Compound meter (12/8) | **MISSING** | **Skip.** A meter change touches the transport, every kit pattern and every `arpGapsFor` consumer. Wrong risk for the payoff |
| 19 | Leitmotif reuse across cues | **HAVE** — `BOSS_THEME` is a genuine leitmotif, mode-locked to `harmonicMinor` | No change |
| 20 | Randomised block ordering | **MISSING** | **Skip deliberately.** Each theme is on stage ~16 bars; randomising within that costs recognition and buys freshness the player never stays long enough to need. Determinism is worth more here |

**Structural findings from MeloForm / MELONS / MorpheuS.** "Declared form filled top-down" is priority #3 in the research and is the one MusicWars gets wrong at the *engine* level, not the note level — see A-3. Tension arc (MorpheuS) is already the best-implemented thing in this codebase (`tension.ts`, `STEM_CURVES`, `orchestration.ts`) and needs nothing.

**chiptune-craft dossier**, compressed — the score already implements most of it:

| # | Item | Status |
|---|---|---|
| 1,2 | Arp-as-chord, voicing reduction | N/A. `buildArp` runs at eighths (~4 Hz), far below the 6.7–20 Hz fusion band — it is a *figure*, and correctly so, because there is a separate `chords` lane. No change |
| **3** | **Single-voice note echo** | **MISSING.** The lead has a delay *bus* (`.delay(0.3).delaysync(3/16)`), which is not the Baldwin note-echo. **Add it** — see A-5.2 |
| 4 | Dual-channel echo | HAVE, effectively (the delay bus + octave doubling) |
| 5 | Tempo-quantised per-voice echo | HAVE — `delaysync(3/16)`, and drums/bass are off the send |
| 6 | Duty motion within phrases | Unverified for `buildChords`/`buildMotor`. Low priority for the melody complaint — defer |
| **7** | **Delayed, phase-centred vibrato** | **PARTIAL AND WRONG.** `.vib(5.1).vibmod(0.09–0.30)` is on *every* note including eighths, with no onset delay. Every note wobbles identically, which is the dossier's named tell. **Fix** — see A-5.1 |
| 8 | Portamento / grace notes | MISSING. Skip — superdough exposes no per-note slide here |
| 9 | Octave-jump bass | Check `buildBass`; out of scope for the melody complaint |
| **10** | **Voice budget / note-stealing** | **HAVE, and it is the best code in the repo.** `orchestration.ts` implements the 8-channel budget, ranked roles, yield-don't-cut. Do not touch |
| 11,12 | Multi-stage drum envelopes, ghost notes, velocity jitter | HAVE — `buildClap` has ghosts at velocity 0.38, `kit.ts` has velocity, feels include swing |
| 13 | Wave-sequencing pads | Partial; low priority |
| 14 | Envelope hard-restart | N/A — Strudel envelopes are per-hap |

Net from the chiptune dossier: **two changes**, #3 and #7.

## A-2. The container change (do this first, prove it is a no-op)

`src/audio/layers.ts`:

```ts
/** One bar: 16 sixteenth-note slots. number = scale degree, null = rest, '_' = tie. */
export type Slot = number | null | '_';
export interface Bar {
  readonly lead: readonly Slot[];   // 16 — the tune. The composer decides what is the tune.
  readonly fill: readonly Slot[];   // 16 — filigree. May be all null.
}
export interface Theme { a: Bar; a2: Bar; b: Bar; b2: Bar; c: Bar; tag: Bar; }
```

- `renderSlots(slots, base, mode)` collapses to: number → `String(base + degreeToSemitone(mode, d))`, `'_'` → `'_'`, `null` → `'~'`. **Delete the `runAt` run-length heuristic and the `keep(i)` predicate entirely.** Duration becomes explicit and the composer owns it.
- `melodyForBar(theme, phrase, bar, base, mode)` → `{ skeleton: render(cell.lead), filigree: render(cell.fill), ornament: renderOrnament(cell), sustained: … }` (the fourth line is A-5.1).
- `renderOrnament` reads `cell.lead`, placing its `[~ n]` neighbour at slots 6 and 14 (the old 3 and 7).
- `arpGapsFor(cell)` reads `cell.lead` and **downsamples 16 → 8 by OR-ing adjacent pairs**, so `buildArp`'s `i % 2` core/fill split still means offbeat/onbeat *eighths* and `counterpoint`/`interlock` keep their semantics. The slope for contrary motion is computed from `cell.lead`'s sounding degrees as today.
- `DEVELOPMENTS` transforms now operate on 32-slot ideas. `displaceIdea` shifts by **4** slots (a quarter, was 2); `augmentIdea` reads the first **16** and interleaves 1 null per slot; the rest are unchanged. `invertIdea` and `retrogradeIdea` must skip `'_'` slots rather than treating them as pitches.

**Migration**: interleave one `null` after every existing slot to lift each 8-slot cell to 16, then convert the run≥2 gaps into explicit `'_'` runs. The score must not change.

**Proof of no-op — build this tool first:**

```
tools/leadfreeze.mjs
  For every theme (9) × phrase 0..9 × bar 0..7, print
  `${themeName} p${phrase} b${bar} skel=<string> fil=<string> orn=<string>`
  for base=69, mode ∈ all 9 modes. ~7,300 lines. Commit the output.
  Re-run after the refactor: `diff` must be empty.
```

Also update `tools/motif.mjs` and `tools/clash.mjs` to read `{lead, fill}` (both brace-match the literal as text and will silently truncate otherwise), and delete `tools/themesearch.mjs`.

## A-3. Fix the form coupling (highest value, zero note changes)

Three edits, all in `src/audio/director.ts` plus one signature in `layers.ts`:

**A-3.1 — Latch mode changes to wave boundaries.** `updateMode` currently applies per phrase. Change it to set `this.pendingMode` and apply in `onWaveStart` — the exact pattern `pendingTonic` already uses at `director.ts:1317` / `:1972`. Effect: mode changes exactly with the theme, so each statement is heard whole in one colour. Measured target: mode-change bars ⊆ wave-change bars; mode changes ≤ 1 per 16 bars (from 12.2).

**A-3.2 — Reset the development counter per theme statement.** Add `themeStartPhrase` to the director, set on `onWaveStart`. Pass `m.themePhrase = phraseIndex - themeStartPhrase` in `musicalState` and have `cellForBar(theme, themePhrase, barInPhrase)` use it. Every theme now begins at its own statement 0.

**A-3.3 — Declare the form; stop generating forward.** Replace `developmentFor(phrase) = DEVELOPMENTS[(phrase-2) % 8]` with a fixed 4-statement plan, indexed by `themePhrase`:

```
statement 0  identity                      — state it plainly
statement 1  transposeIdea(+1) on bars 5-6 — the sequence. Highest-yield single operation
statement 2  fragmentIdea on 5-6, augmentIdea on bar 7 — the climax gets longer
statement 3  invertIdea on 5-6             — then wrap to 0
```

Waves are 16 bars, so the player normally hears statements 0 and 1: **state it, then sequence it.** That is the JRPG shape, and today it is accidental.

## A-4. The composition brief

Nine themes to write by hand: 8 ladder themes plus `BOSS_THEME`. Hand them to a human or an LLM with these rules verbatim.

**Form (fixed by the engine, don't fight it).** Six bars written, expanded to `a | a2 | b | b2 | dev | dev | c | tag`. Bars 1–4, 7, 8 are literal on every statement. So bars 1–4 must be worth hearing eight times, and bar 7 is the climax bar for the whole theme.

**Hard rules (each one is a gate in `tools/tune.mjs`; a candidate that fails any is rejected):**

1. **Question and answer.** Bar 4 (`b2`) ends held on scale degree **1, 3, 5 or 6** (0-indexed — the 2nd, 4th, 6th or 7th). Bar 8 (`tag`) ends on **0** (or **2**, once in the set). Never both stable.
2. **Gap fill.** After any leap of ≥3 degrees, the next sounding note moves 1–2 degrees *in the opposite direction*. Target ≥80% of leaps, hard fail below 70%.
3. **Stepwise ratio 70–80%.** Hard fail below 65%.
4. **One signature leap.** Exactly one interval >4 degrees in the whole period, placed in bars 5–7. The consequent (bars 5–8) must have a strictly smaller maximum leap than the antecedent.
5. **One climax.** `count(max degree) == 1`, in bar 7, on a slot where `i % 4 === 0`, with stepwise descent from it into bar 8.
6. **A rhythmic cell.** Declare one 4–6 slot rhythm with **at least two distinct durations**. It appears *verbatim* (same durations, different pitches) in **at least 5 of the 8 bars**. This is the Frog's Theme rule and it is the thing a player hums.
7. **Duration variety.** ≥3 distinct note lengths across the period; no single length above 65% of events. (Current: 84–93% eighths.)
8. **Anacrusis.** `tag` ends with 1–3 pickup notes on the last 2–4 sixteenths, degree 4 or 6 rising to 0 or 1 on the next downbeat. This costs nothing and it is the difference between a loop and a repeat.
9. **Rests.** ≥1 beat (4 slots) of trailing rest at both bar 4 and bar 8; ≥2 beats combined.
10. **Ambitus ≤8 degrees** across the period; ≤6 distinct pitch classes in bars 1–2 (the hook must be singable).
11. **Density 3–6 sounding notes per bar**, ≤34 notes per period, and the density must *vary* bar to bar — a flat 4 is the current failure.
12. **Syncopation.** ≥2 bars anticipate their downbeat by a sixteenth (a note tied across the barline into slot 0 as `'_'`).
13. **Write the `fill` line as passing tones and neighbours only** — it fades to 20% when the game is calm, so it must never carry an idea the tune needs.

**Per-theme identity.** The nine must differ in *rhythm first*, mode-affinity second, contour third. Assign each a rhythmic character up front:

```
T0 (refrain, even waves)  dotted-eighth + sixteenth pair.  The hook. Most repeated material.
T1  quarter + four eighths (Frog's Theme cell)
T2  syncopated: rest-eighth-quarter, anticipating every downbeat
T3  long-note theme: half notes with sixteenth pickups. Sparse, ~3 notes/bar
T4  triplet-feel via 16ths in groups of 3 across the 16-slot bar
T5  gallop: sixteenth-sixteenth-eighth
T6  even quarters, all four beats — the plainest, so it reads as the "calm" theme
T7  off-beat: everything on the 'and', downbeats rested
BOSS  the hammer. Dotted quarter on beat 1, silence, then a rising tetrachord in eighths
```

`BOSS_THEME` should be preserved in *contour* — tonic ×3 then a leap, descending tetrachord, leading tone → tonic — and rewritten only in rhythm. It is a working leitmotif and it is mode-locked; changing its intervals throws away the only recognition the score currently earns.

## A-5. The two chiptune fixes

**A-5.1 — Vibrato only on long notes.** Today every note gets `.vib(5.1).vibmod(0.09–0.30)`. The dossier's named failure is "vibrato with no onset delay… every note wobbles identically." superdough exposes no delay parameter, so split the line instead:

In `melodyForBar`, produce a fourth string `sustained` containing **only** notes whose duration is ≥3 slots (≥ a dotted eighth), with everything else `~`; and strip those same notes from `skeleton`. In `buildLead`'s `trio`, `skeleton` and `filigree` lose `.vib()`/`.vibmod()` entirely; `sustained` keeps them, at the same gain as `skeleton`. Short notes get a clean attack, long notes sing. One extra render line, no extra composition.

**A-5.2 — Single-voice note echo (Baldwin).** Add a post-pass in `melodyForBar`:

```ts
function noteEcho(lead: readonly Slot[]): string
// For each sounding note followed by >=3 empty/tie slots, emit the SAME pitch
// two slots (one eighth) later. Never at slot 0. Never more than 3 per bar.
```

Render as a fifth line in `buildLead`, gain `0.28 * lead`, `.hpf(500)`, **no `.room()`, no `.delay()`** — it is not a reverb, it is a written repeat. Duty variation isn't available on a triangle, so use the register instead: echo the triangle voice only, not the −12 saw. This is the dossier's #1 "reads as composed rather than generated" item and it costs zero voices.

## A-6. Harmony edits (do these *with* the themes, never separately)

`theory.ts`'s own comment says it: "the change is not 'edit this table'. It is 'rewrite THEMES and this table together, and keep `npm run clash` from rising.'"

1. **Half-cadence bar.** Split the second span so bar 4 lands on a one-bar pre-dominant, per mode:
   - `aeolian: [[0,2],[6,1],[5,1],[2,2],[6,1],[0,1]]` — also delivers technique #10 (3 of 4 chords major: i \| VII VI \| III \| VII \| i)
   - `harmonicMinor: [[0,2],[5,1],[4,1],[3,2],[4,1],[0,1]]` — bar 4 is a real V, the boss's question mark
   - `dorian`, `lydian`, `phrygian`, `phrygianDominant`, `locrian`, `octatonic`: split the second span the same way, keeping the file's existing chord choices
2. **Royal Road on ionian**: `ionian: [[3,2],[4,2],[2,2],[5,1],[0,1]]` = IV–V–iii–vi(–I). It does not start on the tonic; that is the point, and ionian is the "you're doing well" colour, so the lift lands where it should. `Chord.ext` already carries 7ths separately, so the M7/7/m7 qualities come for free.
3. **Non-negotiable gate:** `npm run clash` total unresolved ≤ 67, worst single mode ≤ 19, boss ≤ 4.

## A-7. New verification tooling (Track A)

| Tool | What it does | Gate |
|---|---|---|
| `tools/tune.mjs` | All 13 composition rules from A-4, per theme, pass/fail. Reads `THEMES`/`BOSS_THEME` as text literals, same brace-match technique as `motif.mjs` | Every theme passes every rule |
| `tools/leadfreeze.mjs` | Dumps `melodyForBar` for 9 themes × 10 phrases × 8 bars × all lines × 9 modes | Empty diff across the A-2 refactor |
| `tools/churn.mjs` | Live run, per-bar `(mode, tonic, wave)`; reports change rates and longest unbroken run | Mode changes ⊆ wave boundaries; longest unbroken run ≥ 16 bars |
| `tools/hum.mjs` | `RENDER_STEM=lead` — one 8-bar WAV per theme, melody only, dry. Nine 15-second files | The listener's file. Not automatable; it is the deliverable |

Existing gates that must not regress: `clash` (67/19/4), `motif` (mean shaped economy ≥70%, ≥8 distinct rhythmic profiles), `counterpoint`, `interlock`, `masking` (≤ +5%), `contour`, `leadcheck`, `motorcheck`, `session`.

`tools/hum.mjs` matters more than any of them. Every other tool proves correctness; the user's complaint is not about correctness, and there is currently no artefact they can play.

---

# TRACK B — ABILITIES

**Design frame.** The band is the metaphor and it maps cleanly onto the two things Ball x Pit and Vampire Survivors each get right:

- **THE STAND** — offensive slots. Who is on stage. Small, and combining is how you get a chair back.
- **THE RIG** — passive slots. The room and the gear. Small, and each rig item is somebody's catalyst.

Ball x Pit's load-bearing insight: **combining is a pressure-release valve, and it is the only way to keep drafting.** VS's load-bearing insight: **the catalyst comes from a different currency and is spent.** MusicWars currently has VS's shape without VS's catalyst cost (evolution *keeps* the rig item) and without Ball x Pit's slot-freeing. That is exactly why 91.9–97.2% of late offers are zero-novelty and why banish/reroll measurably hurt.

## B-1. Slots

```ts
// src/game/progression.ts
export const STAND_SLOTS = 4;   // instruments. FIXED for the whole run.
export const RIG_SLOTS   = 3;   // passives.    FIXED for the whole run.
```

Down from 6/6, and **no boss growth**. Rationale:

- A cap only creates decisions while it binds. Growth to 6/6 by minute 5 is what produced the 70% dead-offer state. Ball x Pit ships 3→5 balls / 4→5 passives; Hades ships 5 exclusive slots for a whole run; Dead Cells ships 2+2. Four and three are in the shipped consensus band, and they bind forever.
- Four is the minimum that holds two fusable pairs. Three rig slots means at most three evolutions in flight, which is real exclusion against 12 rig items.
- A run starts with `pizzicato` occupying 1 of 4, so the opening draft has 3 free chairs and 3 free rig slots — the same early feel as today, without the mid-run collapse.
- Bosses stop granting slots. They grant the ARRANGEMENT screen (B-3) and +1 DISMISS.

**Explicit pool ratio.** Today the instrument/rig mix is an accident of table sizes (weight sums 10.30 vs 11.00). Make it a stated constant, the way VS states 8130/1370:

```ts
export const OFFER_TUNING = {
  standShare: 0.70,      // 70% of card draws come from the instrument bag
  minStandCards: 1,      // Brotato-style floor guarantee
  minRigCards: 1,
  catalyst: 2.0,
  catalystHintLevel: 5,
  completes: 3.0,
  encoreShare: 0.35,     // within the instrument bag, once ENCORE is live
};
```

Two bags, drawn per card by `standShare`, with the floor guarantees applied after the draw. 70/30 rather than VS's 86/14 because here the rig items *are* the catalysts, so they must appear often enough to plan around.

## B-2. Combining — "THE ARRANGEMENT"

Three operations. Two are merges; one is the designed empty state.

**REHEARSE** (always legal, Ball x Pit's Fission / VS's Limit Break in one card). Spends the pick, grants +1 level to 1–3 held items, weighted toward the lowest-level. This is what appears when nothing else can — never a grace card.

**ARRANGEMENT** — the authored recipe, cross-pool, **both inputs consumed**:
> instrument at max level **+** rig item at max level **→** named evolved instrument at level 1
> Frees **1 RIG slot**.

The change from today is that the rig catalyst is now *eaten*. That is VS's opportunity cost made real: you spend one of three rig slots on a catalyst you may not otherwise want, and the payoff returns it.

**DUET** — the generative fallback, symmetric, **both inputs consumed**:
> any two held instruments, both at max level **→** `A × B` at level 1
> Frees **1 STAND slot**.

Always legal for any pair, so there is no dead build. Effect text is concatenation: the output keeps A's projectile shape and gains B's on-hit rider and B's stat multipliers. Naming is `A × B` with both icons.

**The five rules that create the strategy** (lifted from Ball x Pit, adapted):

1. Both inputs must be at max level.
2. **ARRANGEMENT outranks DUET.** If the pair you selected has a named recipe, the screen shows and forces the recipe. Fusing a pair that had a recipe would brick it, and players should not be able to do that by accident.
3. **The output starts at level 1 with max level 3.** This is the tempo tax and it is the mechanism that refills the pool — today a fused instrument is max-level-1, unlevellable, and permanently deletes 8 pool entries while keeping its slot. That is the pool-exhaustion bug's largest single contributor.
4. **An ARRANGEMENT output is a live input to anything.** A **DUET output can only DUET again** — never enter a named recipe. So optimal play is *evolve first, fuse second*, which is exactly Ball x Pit's shape and it teaches itself in one run.
5. Order is irrelevant; an instrument cannot combine with itself.

## B-3. The trigger, and how the player discovers it

Ball x Pit gates combining on an enemy-dropped reactor and its #1 complaint is stranded builds. VS gates on a boss chest at 10:00+. MusicWars already stops the world on a bar line for a level-up, so use a **deterministic schedule** and skip the drop RNG entirely.

```
Every 8th level-up, and always on boss death, the four cards are replaced by
THE ARRANGEMENT SCREEN.
```

`progression.ts`: `makeArrangementOffer(state)` when `state.picks % 8 === 7 || state.arrangementPity >= 12 || bossJustDied`. At ~25 s per offer that is one arrangement screen every ~3.5 minutes, plus 4–6 boss ones: **~10–12 per 20-minute run**, against 0.20 fusions/run today.

The screen shows three sections:

1. **LEGAL NOW** — every ready ARRANGEMENT (named, with its `line`), then every legal DUET pair.
2. **ONE STEP AWAY** — the live requirements board. `ROSIN BOW ✓8 + LASER ✗3/5 → HARMONICS · "the fundamental splits"`. This is the single highest-value UI item in the build-design research and it turns a wiki lookup into a glance. It shows *only* recipes where you already hold both ids.
3. **REHEARSE** — always present.

**Discovery, in order of when the player meets it:** the requirements board announces recipes at the moment both pieces are in hand (VS's conditional-pool telegraph, but stronger); the `line` field already carries semantic guessability (`pizzicato + capo → spiccato`, "the bow starts to bounce"); and a **REPERTOIRE** page in the pause screen logs every instrument and fusion ever produced with its line — post-hoc, like the Ball x Pit encyclopedia. **No recipe list at run start.**

## B-4. Fixing 70% zero-novelty and the pool-exhaustion bug

Four changes, in order of effect on the measured number:

**B-4.1 — Combining frees slots** (B-2). Structural. "Inventory full" becomes a state you pass through repeatedly instead of terminate in.

**B-4.2 — Fused instruments become levellable to 3.** `weapons.ts::maxLevelOf` returns `3` for `fused` ids instead of `1`. Give each of the 14 evolved instruments 2 `steps` with real prose notes. Adds 28 pool entries and installs the tempo tax.

**B-4.3 — The ENCORE tier.** When an instrument reaches max level it does **not** leave the pool; it enters a per-stat prestige tier. Six ENCORE cards per instrument, each stackable to a cap expressed relative to that instrument's base, named as playing instructions so they stay in the fiction:

| Card | Effect | Cap |
|---|---|---|
| `DOUBLE-STOP` | `count +1` | base + 3 |
| `CRESCENDO` | `damage ×1.15` | ×2.5 of base |
| `ACCELERANDO` | `cooldown ×0.92` | ×0.50 of base |
| `TENUTO` | `linger +0.35s` | ×3.0 of base |
| `FORTE` | `area ×1.12` | ×2.0 of base |
| `LEGATO` | `pierce +1` | base + 4 |

A maxed instrument therefore generates 6 live cards and roughly 30 total picks before every stat caps. Six maxed instruments cannot exhaust in any reachable run. This is VS's Limit Break, and note that VS *patched it in* to replace exactly the gold-and-a-chicken state MusicWars is currently in.

**B-4.4 — Delete grace cards entirely.** With REHEARSE as the empty state and ENCORE as the prestige tier, `availableOptions` is mathematically unable to return fewer than 4 legal options while the player holds one instrument. Remove `GRACE` and `graceOption` from `progression.ts`, `GRACE_UI` from `levelup.ts`, the three world-side effects from `world.ts:2806-2816`, and the `grace` field from `OfferOption` and the `level:offer` event. The duplicate-grace-in-one-offer bug and the `shards`-grants-score bug (`world.ts:2812` adds 2500 score, not shards) both disappear with it.

**Target:** offers with **zero novel cards below 25%** at every minute of a 20-minute run, where novel = new recruit, new rig, first ENCORE of a stat, or an arrangement screen. From 91.9–97.2%.

## B-5. Making banish and reroll worth using

The audit found both measurably *harmful* because the pool has no slack. B-4 restores the slack; then sharpen both verbs.

**BANISH → DISMISS, and make it the missing verb.** Today there is no swap, no drop, no sell — a mis-drafted build is permanent. Change:

- Dismissing an id you **do not own** → removes it from the pool for the run. (Today's behaviour.)
- Dismissing an id you **do own** → **drops the item, frees its slot, and immediately grants a REHEARSE** carrying half its levels (rounded down) spread across what remains.

That converts DISMISS from a pool-shrinking tool into the build-repair tool, which is what a player actually wants at minute 12 when they realise `TIMEWARP` is dead weight against their build. Stock: **2 at start, +1 per boss** (bosses no longer grant slots, so give them this).

**REROLL — fix the wiring first; it is a live bug.** `World.rerollOffer` and `World.banishOffer` mutate the offer and **emit nothing**, and `LevelUpOverlay.open` is only called from the `level:offer` handler at `renderer.ts:208`. The cards on screen go stale after a reroll. Emit `level:offer` from both. Stock stays 2 + 1/boss.

**Fix the key hints.** The overlay draws `1-4 CHOOSE / R REROLL / B BANISH / S SKIP`; `input.ts:52-63` binds `KeyR`, `Shift`+digit, and `KeyQ` — and `KeyS` is a *movement* key. Two of three printed hints are wrong. That alone is sufficient to explain zero usage.

**Arrangement pity.** `state.arrangementPity` +1 per ordinary offer, triggers the arrangement screen at ≥12 and resets on arrival. StS's pattern: the pity counter sits on the interesting *tier*, not on individual items, and it guarantees a build-defining screen on a bounded schedule without guaranteeing which merge.

**SKIP stays worthless on purpose.** The code comment is right — a consolation prize makes skipping the safe default and deletes the decision.

## B-6. Level-up frequency

The measured rate is **17.5 s** (`node tools/arena.mjs 8 2`), not the 9 s the code comment describes — that figure predates the curve recalibration. VS's band is 20–40 s. But frequency is not the real defect: **68.5% of offers are non-decisions.** Fix the content first (B-4), then trim the count:

1. **Raise the late tier.** `XP_STEP_LATE 55 → 78`, `XP_TIER_LATE 23 → 20`. Target: one offer per ~22 s before level 20, per ~32 s after. Drops a 20-minute run from ~60 offers to ~40.
2. **Batch queued levels.** `state.pending` can exceed 1 and each level is a separate world-stop. When `pending >= 2`, open **one** screen that resolves all of them: pick one card, the remainder auto-REHEARSE. Cuts interruptions without cutting reward.
3. Keep `OFFER_SIZE = 4`. Research puts the band at 3–4 and the fourth card is where the requirements-board telegraph lives.

## B-7. Musical coherence — a fusion must sound like both instruments

This is the part with a precise hook, and it is currently the weakest link between the game and its premise.

`src/audio/orchestration.ts` maps one ability to **one** stem:

```ts
export const ENSEMBLE_MIX: Partial<Record<string, StemId>> = { pizzicato: 'arp', bow: 'chords', ... };
```

Change it to a **blend**, and derive every fusion's blend from its parents rather than hand-authoring it:

```ts
export type StemBlend = Partial<Record<StemId, number>>;   // weights, normalised to sum 1

export const BASE_MIX: Record<string, StemBlend> = {
  pizzicato: { arp: 1 },   snare: { clap: 1 },     bow: { chords: 1 },
  chime:     { lead: 1 },  harp:  { arp: 1 },      drones: { sub: 1 },
  nova:      { kick: 1 },  blackhole: { sub: 1 },  timpani: { kick: 1 },
  feedback:  { fx: 1 },    echoes: { fx: 1 },      tremolo: { motifs: 1 },
};

/** A fusion's voice is the union of its parents' voices. Derived at module load. */
export function blendFor(id: string): StemBlend;
```

Worked results:
- `harmonics` (bow × LASER) → `{chords: 1}` — a rig catalyst contributes no lane, so an evolution deepens its parent's voice.
- `stringsection` (harmonics × crossstrung) → `{chords: 0.5, arp: 0.5}` — the section plays the sustained harmony *and* the figuration. Which is what a string section does.
- `requiem` (chorale × cathedral) → `{chords: 0.5, kick: 0.5}`.
- A DUET of `chime × drones` → `{lead: 0.5, sub: 0.5}` — the bell over a pedal tone. That is audibly those two instruments playing together, and it required no authoring.

Then `ensembleLift(abilities, stem)` sums `level × blendFor(id)[stem]` instead of matching one id, so the lift is continuous and a fusion visibly raises **both** parent lanes on the mixer. Today a fusion changes the bullets and reassigns exactly one fader; after this it is *heard* as two lanes coming up together.

**Second layer, authored:** `FUSION_VOICE: Record<EvolvedId, { stem: StemId; figure: string }>` — one written ostinato per *named* ARRANGEMENT, played through `buildMotifs`. Named recipes get a bespoke sound; generic DUETs get the derived blend. Small authored layer floating on a large generative layer, which is precisely the Ball x Pit economics.

## B-8. Content to author

- **12 base instruments** — unchanged.
- **12 rig items** — unchanged, still a 1:1 catalyst bijection.
- **12 tier-1 ARRANGEMENTS** — the existing 12 evolutions, unchanged tables, new consumption rule.
- **6 tier-2 ARRANGEMENTS** (evolved × evolved). Keep `requiem` and `stringsection`; add four, and the constraint on every name is that the recipe must read:

```
spiccato    × blastbeat  → MOTO PERPETUO   "nothing in the bar is still"
carillon    × canon      → CHANGE RINGING  "the bells start answering each other"
wallofsound × vibrato    → TREMOLANDO      "the hum learns to shake"
downbeat    × tutti      → GRAND PAUSE     "everything stops. then everything at once"
```

- **DUET fallback over every pair.** 12 base + 18 evolved = 30 fusable ids → **435 distinct DUETs**, effect text by concatenation, audio by derived blend. Eighteen authored recipes on a 435-pair generative floor is the same ratio Ball x Pit ships (69 on ~7,900) and it costs one function.

---

# RANKED CHANGES

## Track A — music, highest impact per unit of risk first

| # | Change | Files | Headless verification |
|---|---|---|---|
| **A1** | **Latch mode changes to wave boundaries** (A-3.1). Longest unbroken (mode,key,theme) run goes from 16 bars to a whole wave | `src/audio/director.ts` (`updateMode`, `onWaveStart`) | `tools/churn.mjs`: mode-change bars ⊆ wave-change bars; ≤1 change per 16 bars. No note data touched, so `clash`/`motif` cannot move |
| **A2** | **Reset the development counter per theme + declare the 4-statement form** (A-3.2, A-3.3). Every theme is finally heard as state → sequence | `director.ts` (`themeStartPhrase`, `musicalState`), `layers.ts` (`cellForBar`, `developmentFor`) | `tools/leadfreeze.mjs` shows statement 0 is now identity for every theme; `session`, `rondo`, `variety` unchanged |
| **A3** | **Vibrato only on notes ≥3 slots** (A-5.1). Removes the "every note wobbles identically" tell | `layers.ts` (`melodyForBar`, `buildLead`) | `leadfreeze` diff shows the `sustained` line; `masking` ≤ +5%; `voicecheck`, `leadcheck` unchanged; `tools/hum.mjs` WAV |
| **A4** | **Single-voice note echo** (A-5.2). The dossier's #1 "composed, not generated" item, zero voice cost | `layers.ts` (`noteEcho`, `melodyForBar`, `buildLead`) | `leadfreeze` shows the echo line; `masking` ≤ +5%; `polyphony` unchanged |
| **A5** | **16-slot container refactor, proven no-op** (A-2). Unlocks everything below it | `layers.ts` (`Cell`→`Bar`, `renderSlots`, `melodyForBar`, `renderOrnament`, `arpGapsFor`, `DEVELOPMENTS`, all 9 tables), `tools/motif.mjs`, `tools/clash.mjs`; delete `tools/themesearch.mjs` | **`tools/leadfreeze.mjs` diff must be empty.** `clash` 67/19/4 exactly; `motif` byte-identical output |
| **A6** | **Build `tools/tune.mjs`** — the 13 composition gates | new `tools/tune.mjs` | Run it on the *current* themes first and commit the failing baseline (9/9 fail rule 1 or 3). A gate you haven't seen fail is a gate you don't trust |
| **A7** | **Hand-compose the 9 themes** (A-4) + the three progression edits (A-6), together | `layers.ts` `THEMES`/`BOSS_THEME`, `theory.ts` `PROGRESSIONS` | `tune` all-pass; `clash` ≤67/≤19/≤4; `motif` shaped economy ≥70% and ≥8 distinct rhythmic profiles; `counterpoint`, `interlock`, `contour`, `motorcheck` unchanged; **`tools/hum.mjs` → nine WAVs for the listener** |
| A8 | Duty/PWM motion within phrases on `chords`/`motor` | `layers.ts` | `spectrum`, `texture`. Defer until A7 lands |
| — | 12/8 meter; Kondo block shuffling | — | **Do not do.** Wrong risk, and shuffling actively costs recognition at 16 bars per theme |

`tools/hum.mjs` is the item to build early even though it's ranked with A7: it is the only artefact the user can actually judge, and every one of A1–A7 changes what it sounds like.

## Track B — abilities, highest impact per unit of risk first

| # | Change | Files | Headless verification |
|---|---|---|---|
| **B1** | **Emit `level:offer` from `rerollOffer`/`banishOffer`; fix the three wrong key hints** | `src/game/world.ts`, `src/render/levelup.ts` (hint strings), cross-check `src/core/input.ts:52-63` | `tools/wiring.mjs` — assert an event fires per reroll/banish. Zero risk, and it is why the buttons go unused |
| **B2** | **ENCORE tier + fused ids max level 3 + delete grace entirely** (B-4.2/3/4) | `progression.ts` (`availableOptions`, `ENCORE_STATS`, delete `graceOption`/`GRACE`), `weapons.ts` (`maxLevelOf`, per-stat caps, 2 steps per evolved id), `world.ts` (delete grace effects at 2806-2816), `levelup.ts` (delete `GRACE_UI`) | Extend `tools/levelup.mjs`'s exhaustive check: over 60,000 offers, **`availableOptions().length >= 4` always** and grace count == 0. This closes the reproducible pool-exhaustion bug outright |
| **B3** | **Slots 4/3 fixed, no boss growth; explicit 70/30 two-bag draw with floor guarantees** (B-1) | `progression.ts` (`STAND_SLOTS`, `RIG_SLOTS`, `OFFER_TUNING`, `makeOffer`, `onBossDefeated`), `render/hud.ts` (slot display) | New `tools/novelty.mjs` (extend `tools/decisions.mjs`, which already reads `w.offer` directly): zero-novelty offer share **<25% at every minute** of a 20-min run, from 91.9–97.2%. `tools/builds.mjs`: the `narrow` vs `greedy` policy spread must stay wider than the seed spread |
| **B4** | **`ENSEMBLE_MIX` → `StemBlend`, fusion blends derived from parents** (B-7) | `orchestration.ts` (`BASE_MIX`, `blendFor`, `ensembleLift`), `director.ts` (call site) | New `tools/blend.mjs`: every id has a non-empty blend; every fusion's blend == union of parents'; `ensembleLift` for a DUET is non-zero on **both** parent stems. `tools/instruments.mjs` — no ability reaches the score by zero of its four routes |
| **B5** | **The combining rewrite**: DUET (generic 2→1, frees a stand slot), ARRANGEMENT consumes the rig catalyst, arrangement screen every 8th pick + boss + pity ≥12 (B-2, B-3) | `weapons.ts` (`FusionDef.kind` gains `'duet'`, tier-2 recipes), `progression.ts` (`readyFusions`, `resolveFusions`, `makeArrangementOffer`, `arrangementPity`), `world.ts` (`rewardBoss` is no longer the sole trigger), `levelup.ts` (new screen + requirements board), `events.ts` (widen `level:offer` — today it carries only `{id, grace}` and the overlay rederives everything) | `tools/decisions.mjs` with a new `fuser` policy: **≥6 merges per 20-minute run** for a fusing player, ≥2 for card-0, from 0.20/2.60. `tools/deadhunt-fusion.mjs` for reachability. Largest change on this list — land B2 and B3 first so the pool has slack to absorb it |
| **B6** | **DISMISS: banishing an owned item drops it and refunds half its levels as REHEARSE**; stock 2 + 1/boss | `progression.ts` (`banishOption`), `levelup.ts` | `tools/decisions.mjs`: the two banish-spending policies must now **outperform** their non-spending counterparts, not underperform. That reversal is the whole test |
| **B7** | **XP curve `XP_STEP_LATE 55→78`, `XP_TIER_LATE 23→20`; batch `pending >= 2` into one screen** (B-6) | `progression.ts`, `world.ts` (`openOfferNow`) | `node tools/arena.mjs 20 4`: offers/run ~40 (from ~60), seconds/offer 22 early → 32 late, time-paused share not up |
| B8 | REPERTOIRE page in the pause screen | `levelup.ts` / `render/hud.ts` | `tools/panelshot.mjs` (blocked — no Chromium). Ship last, verify by eye when the browser works |

**One dependency worth stating plainly:** B5 is the change the user actually asked for, and it is the one most likely to regress if landed first. B2 and B3 are what give the pool enough slack for merges to *free* something worth having; without them, freeing a slot just returns you to a pool of level-ups you already own. Land B1 → B2 → B3, measure `novelty.mjs`, then land B5.