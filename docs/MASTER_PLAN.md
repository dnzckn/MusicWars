# MusicWars Master Plan — the sound, the game, the world

*v2, 2026-08-24. Built from: (1) a Vampire Survivors design deep-dive, (2) a Ball x Pit design
deep-dive, (3) generative-music/psychoacoustics research with superdough source verification,
(4) full codebase maps of the gameplay, audio, and render/verification layers, (5) two
cross-domain gap analyses, and (6) a four-lens adversarial review of the v1 draft (completeness,
consistency, design, verification) whose ~35 confirmed findings are folded in below.*

*Supersedes `docs/redesign-plan.md`: its Track A leftovers are absorbed in S7; its Track B is
dispositioned in G0 (part shipped, part re-scoped, one live bug). Phase 0 archives it and
rewrites `docs/progression.md`, which currently contradicts the shipped code (3→6 boss-grown
slots vs. the actual fixed 4+3; boss-gated fusion vs. the actual weight-6.0 offer card).*

---

## 0. The verdict

MusicWars has quietly solved the **hard, invisible** parts of this genre — and is missing the
**visible shape** of it.

Already genuinely good (do not re-litigate): the slot economy (4+3 fixed, catalyst-spending
fusions that refund slots — VS-grade), the two-tier fusion structure (authored recipes over a
generic duet floor — exactly Ball x Pit's shape), threshold pacing, the offer discipline, the
tension model, the bar-line-quantised world (offers, boss phases, novas all commit on the grid),
the readability contracts, and a 171-tool verification culture no indie ships.

Missing, in one line each:

| Complaint | What the research says it actually is |
|---|---|
| "Music is choppy, clavichord, abrasive" | Not gaps (five discontinuity causes already fixed and instrumented). It is **~28 musical onsets/s plus an unquantised SFX stream (~30 triggers/s at busy waves, throttled to ~15–25 sounding), nearly all on 1–10ms attacks**, an always-on sustain-0 pulse clock, five pitched lanes crammed into three octaves, no sustained bed, and a dry loud foreground over a wet quiet background. superdough's *default* envelope (1ms attack / 10ms release) is literally a clavichord; three of the four most-heard pitched voices use it or worse **by design**. |
| "Very limited weapon and passive types, no mixing concept" | Count is not the problem — 12 instruments, 12 rigs, 14 authored fusions, generic pairwise duets and unions all ship. The problem is **7 behaviour shapes serving 26 ids** (VS has ~20 distinct spatial verbs), **duets that are stat-merges** (parent A's shape with bigger numbers — never "bolts that sweep"), **1:1 hint-fed recipes** that leave nothing to deduce, and **no rig-side mixing at all**. The mixing *system* exists; the mixing *moment* is hollow. |
| "Map is static and too small" | Correct, and it's an assumption, not a line of code: arena == viewport, `camera.ts` is screenshake only, and the field constant lives in three copies plus a runtime reader (world.ts, index.html, style.css — electron regex-reads world.ts at launch, with a stale fallback). The answer is **bounded: yes; generated: also yes** — a world ≥2× the viewport per axis under a follow camera, with per-run *generated* layouts inside the walls. What's rejected is only the *infinite* scroll (walls are load-bearing: ECHO/CANON bounces, encirclement/escape-corridor, readable bullet patterns). |
| (unstated but structural) | **No ending, no persistence, no composition escalation.** Runs dissipate instead of climaxing (VS's Reaper is one enemy definition); nothing carries between runs (VS: "no run earns nothing"); and **boss escalation is flat** — measured, see §7: ladder threat actually rises 3.66× past wave 9, but the six bosses from wave 4 to 24 alternate two patterns at a dead-flat 1.05× threat. The clutter-and-easiness defect is real and it lives in the bosses, not the ladder. |

The standing lesson that shapes everything below: **every prior disaster here was an unmeasured
property** (themes optimised against existing gates; the 8Hz strobe; the drop economy feeding its
own gate). So each workstream lands its instruments at the *start of its own phase* — with a
calibration protocol (§4) so the thresholds are measured, not invented.

---

## 1. TRACK S — the sound (fixes "choppy / clavichord / abrasive")

### The six ranked causes → remedies

| # | Cause (measured) | Remedy |
|---|---|---|
| S-a | **Transient density**: ~49 audible musical onsets/bar ≈ 28/s at 138bpm (director's own audit) + an unquantised SFX stream already half-managed by channel spacing/burst credit (sfx.ts) but still off-grid and pluck-timbred | Envelope floors on every pitched lane (attack ≥ 20–80ms, release ≥ 250ms–1.2s); an explicit **onset diet** with a per-lane table (§ S5); SFX split into classes and grid-quantised (§ S6); a global simultaneity cap of **6**, flam/velocity-duck overflow. **Placement rule (rebuild-stability contract):** the music-side budget is computed at *build time* as a deterministic function of the structure key — one key still maps to one note-set; the runtime half touches only SFX and *gain* (velocity-duck, never delete a scheduled hap) |
| S-b | **The always-on pluck clock**: MOTOR is a 25%-duty pulse, ad .004/.07, sustain 0, dry, centred, restruck 4–8×/bar, floor level .32 (layers.ts:1214–35) — the most-heard sound in the game | Keep its role (pulse-inversion fix stands — a *pitched* timekeeper), change its skin: `adsr(".02:.08:.35:.22").clip(.95)`, onset carried by **filter bloom not amp spike** (`lpf(900).lpenv(2.5).lpattack(.025)`), `room(.15)`, duty motion `pw(perlin…)` (the deferred A8 item), offbeat 16ths become velocity ghosts. The optional held-note filter-rhythm clock (wobble.ts machinery) is flagged against `motorcheck`'s CONTINUITY assertion — resolve the onset-vs-hap counting question before adopting it |
| S-c | **Register congestion**: five pitched lanes in ~3 octaves; the arp is folded *down into the motor's octave exactly when the lead plays* (orchestration.ts:333); chords+lead = 44–67% of measured roughness — an exposure quantity ("abrasive over time") | **The real contract is boundary attenuation, not exclusive octaves** (nested always-on lanes make "no two lanes share an octave" arithmetically unsatisfiable, and both fold-down experiments measurably worsened roughness). Lane centres: drone 21–36 · bass 45–57 · pad 50–72 · motor 57–69 (contract preserved) · lead 69–84 · arp 81–96. Enforcement: lane-boundary lpf/hpf so partials crossing into a neighbour's band attenuate **≥12dB**; displacement always resolves **upward** (arp lives 81–96 with `hpf(2000)` low-gain sparkle whenever the lead is present, 69–81 otherwise); pad ceiling MIDI 72 via lpf 1200; colour tones above the lead only in its rests |
| S-d | **Sustain deficit**: the only sustained material is a quiet open-fifth dyad thinned whenever the melody plays; the sub is an accent (ceiling .2); no low bed exists at all (layers.ts:1613–24 says so outright) | Two beds whose audibility is **section-owned, never intensity-gated** (floor ≈ .1 during play; explicitly *silent* in the death collapse, ducked in breakdown/HUSHED — the beds obey section overrides, so "the band is meant to stop" still stops). **Two deliberate reversals, named:** (1) this reinstates a sub floor the director once removed — the difference is the old floor was an unconditional `max(want,.22)` fighting the curve architecture; the new bed is a *designed lane* with its own curve, section overrides, and a duck under drums. (2) The harmony bed is **not** the removed supersaw — the codebase's measured verdict ("a detuned supersaw is a dance-music sound… enormously less fatiguing without") stands: primary timbre is FM (`fm(1.5–2).fmh(1–2)`) or additive `partials([1,.4,.2,.08])` — warm, non-detuned; width/detune is an *intensity curve* (0→.2), and supersaw is reserved for drop sections at most. Pad thinning under the melody becomes a **gain curve, not note removal** — the third comes back |
| S-e | **Dry/wet inversion**: the loud clock lanes (motor/bass/kick) are bone dry and centred; the quiet pad/lead are wet; no shared room | One algorithmic room per orbit group (reverbGen — zero assets): HARMONY room .4/size 6/roomlp 7k, LOW .12, DRUMS .08, motor joins at .15 with slow perlin pan drift. Reintroduce ducking **narrowly**: DRUMS → bed orbit only, depth .4, attack .25 — a shallow pump on sustain, not the deleted mix-wide gate; the `gating` tool re-arms to bound it (≤4dB, ≤15% duty, one target) |
| S-f | **Intensity = more onsets** ("getting busier ADDS notes" across seven lanes) + machine tells (identical vib on every lead note; no note echo; no mainline velocity variation) | Intensity re-mapping per S5 below. Vibrato only on notes ≥ dotted quarter at a perlin-varied rate (`leadcheck` is **rewritten in the same commit** — it currently asserts vib on *every* note); `velocity(rand.range(.86,1))` on motor/arp/lead mainlines; written note-echo on phrase-final longs |

### The target mix architecture (same 11 stems — never add chairs)

- **Beds (section-owned, curve-driven):** drone (the reforged `sub`, promoted from accent to
  floor), harmony bed (the `chords` pad rebuilt per S-d), colour 7th/9th on top.
- **Rhythm tier (owns the grid):** kick, clap, bass, motor — re-skinned per S-b/S-e, roles unchanged.
- **Lead tier (phrase identity):** lead (theme system untouched — `tune` passes 9/9), arp as the
  answering voice per the S-c displacement rule, motifs under the voice budget.
- **Furniture:** fx, power — rare event punctuation; S-0 envelopes acceptable *only* here.

**Roster-scaling orchestration laws** (imported verbatim from the gap analysis — Track G
multiplies ids over these 11 chairs, so they are Track S law):
1. **Register by lane, not weapon** — every id inherits its lane's octave slot, envelope class,
   and room send; new weapons are figures/timbres-within-class, so the register map and masking
   budget are invariant under roster growth.
2. **Max 4 simultaneous pitched voices** — SECTION_BUDGET becomes hard law, not a tuning knob.
3. **Chair-sharing priority ducking** — when two ids share a chair, the most recently levelled
   speaks; the other yields via the existing YIELD curves (continuous fades, never mutes).
4. **Call-and-response rotation** — chair-sharers alternate on a 2-bar call/answer cycle
   scheduled by arrangement.ts; which staffed lane answers the lead rotates per phrase.

**Intensity re-mapping (S5, restated after review):** the doctrine stays **nested/additive** —
"frozen per section" is the recorded dead end the retention tooling exists to reject (lanes went
inert). Instead: pitched-lane onset *changes* remain nested additions that commit on section
boundaries; percussion keeps intra-section density response; and the **onset diet** shrinks the
*maximum* additions at the top of the range (fewer added layers at full intensity), with a
per-lane table (motor offbeats → velocity ghosts; arp even-gap fill trimmed; stab fill trimmed;
motifs cap unchanged) naming which lanes lose how many onsets/bar — the diet is where the 28/s →
target reduction actually lives, and the S0 calibration decides the target. Envelope lengths are
**rendering, not note selection**: driven per-hap from the *raw* intensity signal via `ref()`,
never keyed into the rebuild key — so `retention`/`rebuildstable` verdicts stand and `envcurve`
(§4) is measurable. The fast channel (openness/threat) keeps riding brightness/width/drive/
duck-depth/vibmod as continuous curves.

**Feasibility:** everything above is pure offline superdough — FM, `partials`, supersaw,
algorithmic reverb, real `duckorbit` sidechain, patternable `pw`, full envelope set, `ref()`
continuous control. No chorus node (fake with width/phaser), no portamento (`penv` glide is the
serviceable fake), no soundfonts (not installed; would fetch — do not add). If synthesis proves
insufficient *after* the S5 listening pass: single-cycle AKWF wavetables inline as `data:` URIs
at <1KB each (~20KB for twenty warm shapes) via `samples()` — the loader is a bare `fetch()` and
accepts data URIs with zero code changes. Sampled one-shots are the last resort with an explicit
size budget. **Staging decision: pure synthesis first.**

### Workstreams

| ID | Work | Size | Notes |
|---|---|---|---|
| **S0** | **Instruments first**: the §4 gate set *plus* the **browser-capture recorder** (AudioWorklet ring buffer → WAV, per the `chop` pattern, with a silence/glitch control) — `tools/render.mjs`'s own header forbids judging sound on it ("no reverb, no delay… judge the WRITING"), so the listening artefact needs a real capture path. Plus the **calibration protocol** (§4) | M–L | The plan's insurance policy |
| **S1** | Envelope floors everywhere + motor re-skin + **bass** + **the chord stab** (S-a amp half + S-b) | M | Music-only `onsetflux` arms here. `attackfloor` is built and exits 1 on today's build — the S1 baseline is recorded in §7 |
| **S6** | SFX classes + grid quantisation + simultaneity cap (moved up — no dependency on S2–S5): survival-critical feedback (player-hit, graze) stays **immediate** and is allowlisted; reward/ambient SFX snap to the next 16th; combined `onsetflux`/`budget` arm here; a **latency assertion** (event→audible ≤50ms for the immediate class) lands in `sfxcheck` in the same commit | M | Quantising *damage feedback* in a dodging game is the one thing the case studies (Rez, Peggle) never did — hence the class split |
| **S2** | The two beds + pad thinning → gain curve (S-d, with both named reversals and the collapse/HUSHED behaviour) | M | `spectrum`/`mixaudit`/`polyphony` baselines re-established |
| **S3** | Register boundary attenuation + upward displacement (S-c) | S | `masking` chords+lead share target from calibration |
| **S4** | Rooms per orbit + narrow duck + motor wet/pan (S-e) | S | `gating` re-armed with the new bounds |
| **S5** | Intensity re-mapping + the onset-diet table (S-f) | M | `envcurve` + the diet table make it falsifiable |
| **S7** | **Absorb redesign-plan Track A leftovers:** A-3.3 declared 4-statement form; A-5.1 vibrato only on longs (with the `leadcheck` rewrite); A-5.2 note echo; A-6.1 half-cadence bar-4 splits; A-6.2 Royal Road ionian; A8 duty motion | M | The composed-not-generated tells |
| **S8** | *(optional)* inline AKWF wavetables (~20KB) | S | Decision after the post-S5 listening pass |

Order: **S0 → S1 → S6 → S2 → S3/S4 (parallel) → S5 → S7 → listen → S8?** Gates *ratchet on* as
their workstream lands (music-only flux at S1; combined at S6) — a gate is never decorative-red.

**The listening pass, specified:** after S1, S2, and S5 — before/after WAV pairs from the
browser-capture recorder at fixed seeds (waves 4 / 12 / 22, 90s each), three named questions
(*abrasive over three minutes? does the pad have character? any machine tells?*), verdict
recorded in this document's changelog. Machines gate regressions; ears gate the deliverable.
`leadfreeze` is **re-baselined per S-step with the diff reviewed before `--save`** — it hashes
every hap field, so S1/S3/S4/S7 each legitimately move it; a rubber-stamped re-baseline would
hollow it out.

---

## 2. TRACK G — the game (fixes "limited types / no mixing / small static map")

### G0. Run-economy remainder — the old plan's Track B, dispositioned *(S–M, zero dependencies)*

Track B's structural items shipped (fixed 4+3 slots, catalyst-spending fusions, fusion-as-offer-
card, duets/unions). What remains:
- **The reroll/banish stale-card bug is live** (verified): `world.ts:2834` and `:2970` mutate the
  offer and emit nothing; the overlay refreshes only on `level:offer` (renderer.ts:208). Fix
  unconditionally — it is why the buttons feel dead.
- **Re-measure** the zero-novelty offer share (`decisions.mjs`/`novelty`) on today's build; then
  apply the surviving B-4/B-5/B-6 remedies **as the measurement dictates**: grace-card deletion,
  the ENCORE prestige tier (maxed instruments generate per-stat cards), DISMISS-as-build-repair
  (banishing an owned item drops it and refunds half its levels), and batching `pending ≥ 2`
  levels into one screen. These were designed against a 91.9–97.2% zero-novelty measurement that
  predates the current code; adopt what the fresh number justifies, record what it doesn't.

### G1. The Finale — runs get an executioner *(M; coda after S5; win-state after G2's gate is green)*

At the 20:00 phrase line (transport time — base tempo is 128, so never hardcode a bar count), an
unkillable-by-design entity enters. **It conducts, it doesn't chase** — a chaser fails in a
bounded box (slower than the 430px/s player = kited forever; faster = a 4-second execution).
Each 8-bar phrase it sweeps a telegraphed bar-line wall across the arena, shrinking the safe
region; a second sweep lane joins every N phrases. Musically the stems converge into an
**authored coda** as it advances — the one moment the generative system plays composed music
(this is arrangement/layers work: sequence it *after* S5, and give it an authored-section
carve-out in the `tune`/`leadfreeze`/`rebuildstable` gates). Survive the coda's final cadence =
a win with a full-ensemble tutti; dying mid-coda is a cliffhanger, not a loss. The impossible
chase (killing it) is G8's flagship unlock. The win state ships only after G2's threat envelope
is green — a rubber-stamp victory over the current too-easy lategame would be worse than no
ending.

### G2. Escalate composition, not bodies *(M, zero dependencies)*

The full archetype roster is in play by wave 9. **`threatdensity` has now measured what happens after that, and it is not what this plan assumed.** Ladder waves *do* escalate: threat 1.65/s at wave 5 → 14.74/s at wave 23, a 3.66× rise against a 2.34× population rise, so threat outpaces bodies (ratio 1.56) and threat-per-body roughly doubles. **The flat part is the bosses**: six bosses across waves 4–24 alternate exactly two patterns at 6.9 · 4.8 · 7.5 · 4.8 · 7.5 · 4.9 — 1.05× escalation over twenty waves, with boss population slightly *falling*. Re-ordered accordingly:
- **Gate first:** `threatdensity`, built to the rewritten-`curve` design (§4) — whole-wave
  integration, boss-vs-boss comparison, bot-independent probe.
- Elite emitter-variants of existing archetypes (same silhouette + tier marker, new declarative
  `EmitterSpec`) every 3–4 waves past 9; more urgency gears; second emitters.
- **Population budget — do NOT naively declare a flat constant.** v2 said to. The measurement
  says today's budget is `World.targetOnScreen()` = `round(4 + difficulty*5 + min(10,
  escalation)*1.5)`, it is a *floor* that group spawns overshoot by ~2×, and it is **not** flat
  past 13 (9 at wave 13 → 11 at wave 25). Capping it flat would roughly halve late-wave
  population — a balance change wearing bookkeeping's clothes. Make it an explicit named
  constant read by the gate, keep its current shape, and change the shape only as a deliberate,
  separately-measured decision.
- **FIRST PRIORITY — boss patterns.** This was one bullet among several when the plan was
  written blind; the measurement says the two-pattern alternation *is* the whole boss escalation
  story. The conductor's two alternates grow to four+, each boss cycle escalates rather than
  repeats, and every 8th wave gets a distinct spec whose mechanic teaches dodging grammar (e.g.
  a boss whose safe spot is the off-beat).
- **SOLOIST/ELITE waves are unintended threat sinks** — waves 6 and 18 read 0.26 and 3.56
  arrivals/s against neighbours at 3–10, because the movement collapses the group to one enemy.
  Nothing says SOLOIST is meant to be a lull; wave 18 is a hole in the escalation band.
- **Shard overflow banks into a jackpot** (VS's 400-gem law, currently: cap 320, overflow
  silently dropped): past the cap, value accrues into one growing rare shard — bounded entities,
  visible jackpot, three lines of code.
- Every rate this changes (kills/min, wave length) re-denominates pity timers, multiplier decay,
  XP curve, and the stale levelup income model **in the same change**.

### G3. Rig depth — deduction space, tradeoffs, and rig-mixing *(S–M, zero dependencies)*

- **Many-to-one catalysts:** each rig catalyses 2–3 instruments (RAPID → any percussion-family
  instrument), restoring "what does FERMATA do to a *beam*?" deduction. Changes card *worth*,
  never card count.
- **The hint policy that makes deduction real:** full hints (catalyst weighting, the "one step
  away" HUD line) only for **codex-discovered** recipes; undiscovered pairings get no weight
  boost and no HUD line. Discovery is the reward; then the machine remembers for you. (Without
  this, the ×2/×3 weights and HUD line keep answering the riddle before it's asked.)
- 1–2 **tradeoff rigs** (ACCELERANDO: enemy time ×1.15, XP ×1.4) — reward channel audited
  against whatever gate reads the cost channel (drop-economy lesson).
- 1–2 **build-defining rigs** (a Duplicator analogue: +1 count) creating rig-first builds.
- **RACKS — the answer to "mixing passives together":** two maxed rigs fuse into one **rack**
  occupying one slot — both effects at ~75% magnitude, one slot freed, and the consumed rigs can
  no longer catalyse (a real cost, mirroring the instrument-side catalyst spend). Validate
  against the 60k-offer sim before shipping; authored names per pair family. This answers the
  half of the complaint v1 silently dropped.

### G4. Duets become discoveries — the rider vocabulary *(M–L, before G5)*

`synthesiseDuet` keeps parent A's shape and max-of-stats — PIZZICATO×SNARE is "bolts with
snare's numbers". Commit to the **Ball x Pit matrix**: in a game where every weapon is an
instrument, pairwise combination *is* orchestration.

- **Riders are indexed on instrument id, not shape.** Shape-indexed riders collapse C(12,2)=66
  pairs into ≤25 distinct behaviours (aura×3 and seek×2 alias each other) — the discovery engine
  would run dry in a session. Each of the 12 instruments defines its own rider signature
  (NOVA's ≠ FEEDBACK's ≠ TIMPANI's even though all are auras), the trigger event (**on-hit /
  on-wall / on-expiry / on-beat**) is assigned per *pair*, and the invariant is explicit: **no
  two duets share (shape, rider, trigger)**. 6–10 authored per-pair exceptions on top as
  BxP-style trophy discoveries (the Dark+Sun=Black Hole class).
- **First-run guarantee** (BxP's "watch the first 30%"): offer weighting on a fresh save
  guarantees two instruments reach the duet threshold by ~minute 5–6 — the first "X+Y made
  WHAT?" moment lands in run one.
- **Keep** the 1.5×-DPS renormalisation (a measured guard); the rider is the un-normalised
  spectacle. **Keep** the two-tier depth blocks (no duet-of-duet, no mixed tiers).
- **Raise `MAX_PLAYER_BULLETS` here** (400 today, already silently dropping CROSS-STRUNG
  spawns) — rider novas/pools hit the cap before G5 does.
- **Fusion audio — one richer voice, and the band never shrinks.** A duet maps to **one lane**
  whose timbre is the crossbreed (parent A's oscillator/figure driven by parent B's filter
  motion, register from the deeper parent, onsets = max of parents, never the sum) — but it
  **still counts as two musicians** for headcount, `ensembleSize`, SECTION_BUDGET and
  `ensembleTrim` (the measured lesson stands: "a band that shrinks when it combines is the wrong
  feedback for the best decision in the run"). The fused voice must get audibly **bigger**, not
  merely cleaner — unison/width/register-span scale with fusion tier, and the freed chair's
  headroom is banked for climaxes (tutti, boss phases), gated so width/sustain *rises* on
  fusion, never falls. In-scope surfaces for the same commit: `abilityStems`, `ensembleSize`,
  SECTION_BUDGET, `ensembleTrim`, ENSEMBLE_MIX, and the HUD band panel.
- **Id contract, corrected:** authored ids get `AbilityId` union entries + ENSEMBLE_MIX lane +
  `character` phrase in the same commit; synthesised duet ids (runtime strings, deliberately
  outside the union) get a **typed registration path** plus a `duetParents` coverage assertion.
  **The codex extends to generic duets and riders** — discoveries the collection can't record
  aren't discoveries (it deliberately tracks only the 14 authored results today).

### G5. Verb breadth — 2–3 new shapes, not 20 *(M, after G4)*

Riders carry most of the breadth; add only shapes the current set cannot fake:
a **movement-trail** verb (punishes standing still), a **wall/barrier** verb, a
**facing-stream** verb (aim with your feet). Each new shape = fire routine + container + render
contract + dead-stat audit rows — the documented choke point — so three, not ten. With riders ×
shapes × 12 instruments the *perceived* roster multiplies without the audit surface exploding.

### G6. The world — a real zoom-out over a generated bounded arena *(L, the heavy lift)*

**Decision: bounded yes, generated also yes; infinite no.** Walls are load-bearing (bounces,
escape corridor, readable patterns) — but a *static generated* map keeps its walls, so
generation is not what gets rejected; only endless scroll is.

- **Stage 0 — unify the constant** (ships alone, proven no-op): `PLAYFIELD_W/H` in world.ts +
  index.html + style.css (with the stale 960/720 at style.css:125), electron deriving the
  *viewport* (not world) dims. The last move of this constant silently zeroed `contrast`.
- **Stage 1 — follow camera with a real acceptance criterion:** **hidden world ≥ 1 full viewport
  per axis** (world ≥ 2× view per axis). Initial numbers for the feel pass: viewport ~1100×1200
  (a genuine zoom-out — sprites ~18% smaller, so a sprite-legibility re-check gates it),
  world ~2200×2400 (≈5× today's area). v1's 1440×1440/1000×1100 delivered +9% visible area and
  one second of hidden travel — a compromise achieving neither half of the complaint; these
  numbers are the floor, and the feel pass may push larger.
- **Off-screen fairness policy** (the decision that makes the bigger world playable): emitters
  **hold fire unless on-screen** (or telegraph via an edge marker); `wayOut`/encirclement compute
  against the *viewport*; gate: **zero player damage from a projectile whose source was never
  rendered**.
- **Stage 2 — generated venues:** procedural layout inside the walls, seeded per run — pillar
  fields, corridors, broken colonnades; ECHO bounces and beam occlusion make geometry
  weapon-revaluing (VS's cheapest trick). One procedural layout ships in the Stage-1 prototype
  so the feel pass evaluates the destination, not the waypoint.
- **Blast radius (one change-set, from the render map):** pointer→world inversion (`toPlayfield`)
  + level-up hit-testing; spawn geometry → camera-relative rings; bullet cull/bounce rects (and
  `MAX_ENEMY_BULLETS=3000` re-derived — it was sized for one screen); world-sized WarpGrid/
  starfield/bloom become view-local; screen-space UI to viewport space; SFX pan and the
  deprecated `snapshot.playerHeight` re-anchor; THREAT_RADIUS/ranges/areas re-tune; the
  `driver.mjs` wall-avoidance bot.
- **Mobile is in scope, not a regression list:** drag-to-fly steering changes *semantics* under
  a moving camera (the drag target is consumed against ship position) — decide screen-relative
  vs world-relative steering explicitly; the stage aspect-ratio CSS changes with the viewport;
  G7 pickups must be discoverable on a phone showing half the world (edge markers);
  `mobileshot`/`touchcheck` are *changing* baselines here, not guards.

### G7. A world worth crossing *(S, after G6)*

2–3 fixed pickups per run at the far walls (a free rig level, a banked bomb) with edge markers;
rare destructibles dropping panic verbs (a VACUUM/freeze analogue) — VS's law: panic buttons
live in the world, not on the HUD. In generated venues, position becomes strategy for free.

### G8. Meta-progression — every run pays *(M, semi-independent)*

- **Repertoire unlocks:** new instruments/rigs/racks/shapes (supplied by G3/G4/G5) enter the
  draft pool across runs — unlocks change what the zero-sum pool *contains*, never how many
  cards are offered. **Supply target: 15–20 unlockables** by Phase 5 so "every run pays" is
  checkable, with a first-run floor: the fresh-save pool keeps enough breadth that run one still
  hits the G4 duet guarantee (unlocks must never thin run one into a tutorial).
- **Audible unlocks carry mechanical riders:** a new mode/key ships *on* a theme variant with a
  gameplay perk attached — the ear gets the flavour, the build gets the reason.
- **The soundcheck shop** — small, **refundable** (VS's law: refunds make meta-shops
  laboratories), and it also sells **control over RNG** (reroll/banish stock ranks — VS law 5),
  priced in a currency every run pays; the currency source must not be a signal any in-run gate
  reads.
- **The Finale-killer is named content:** an unlockable authored union (the VS
  Infinite-Corridor class) whose recipe is the long meta-chase — G1's "impossible" gets a path.
- Persistence: `localStorage`, schema-versioned. The codex (extended in G4) is the visible
  collection.

### G9. Performers — starters that mutate rules *(M, after G8 currency + audio gates)*

5–6 performers whose mutations are musical rules with mechanical teeth: a **3/4-time performer**
(the whole game re-quantises — needs its own audio gates first), a **rubato performer** (focus
also slows enemy time), a **soloist** (3 instrument slots, +1 rig, faster fusion thresholds —
the deep-beats-wide lesson as a character). Per-performer first-clear currency feeds G8.

### G10. Horde readiness — 2–3×, never 300 *(M, after G6)*

Enemy count is the mix (polyphony cap 96); VS-scale hordes would be mud. Even 2–3× needs:
enemies on the sprite-atlas path, one spatial hash feeding all five O(n·m) pair loops, enemy
pooling, and a real-hardware frame gate at target density **before** any count rises. G10 is the
named event that re-baselines G2's population-budget constant — in the open, not quietly.

---

## 3. Sequencing

```
Phase 0  INSTRUMENTS + HOUSEKEEPING   S0 gate set + browser recorder + calibration protocol ·
                                      threatdensity · G6-Stage-0 constant unification ·
                                      archive redesign-plan.md · rewrite progression.md ·
                                      delete tools/themesearch.mjs (standing hazard — now, not S7)
Phase 1  THE SOUND                    S1 → S6 → S2 → S3+S4 → S5 → S7   (listening passes after S1, S2, S5)
Phase 2  QUICK GAME WINS              G0 economy remainder · G2 escalation · G3 rigs+racks · G1 Finale entity
                                      (G1's coda + win-state land at the end, per their dependencies)
Phase 3  THE MIXING MOMENT            G4 riders + fusion audio → G5 new verbs
Phase 4  THE WORLD                    camtest/spawnring/off-screen gates first → G6 Stage 1 →
                                      G7 world content → G6 Stage 2 venues
Phase 5  THE LONG GAME                G8 meta-progression → G9 performers
Phase 6  DENSITY                      G10 (only after G6, only with the frame gate)
```

Dependency rules (each is a lesson with a scar):
1. **Instruments at the start of their own phase** — S0's audio gates and `threatdensity` are
   measurable now and belong in Phase 0; `camtest`/`spawnring`/off-screen-source cannot have a
   positive control until the camera prototype exists, so they open **Phase 4**, not Phase 0.
2. **Constant unification ships alone** before any camera work (the `contrast` incident).
3. **Phase 1 ∥ Phase 2 only via the frozen fixture:** every S gate is denominated against a
   **recorded load fixture** (a serialized wave-12 world trace replayed into the director), not
   live waves — otherwise G2 redefines "wave-12 load" under Track S mid-flight. Any
   `threatdensity` increase re-runs `onsetflux` in the same change. G1's coda waits for S5.
4. **Riders (G4) before roster growth (G5)**; camera (G6) before world content (G7) before
   density (G10).
5. **Every rate-changing feature re-denominates every budget counted in that rate** (done four
   times already): G1/G2/G6 shift kills/min and wave length — pity timers, multiplier decay, XP
   curve, levelup income model re-audit in the same change.

**Phase exit criteria (who decides):**
- Phase 1: the listening pass verdicts (three named questions) + all armed S gates green.
- Phase 2: `threatdensity` green through wave 25 + G0's re-measured novelty target met.
- Phase 3: a blind playtest where the tester **names what a duet did without reading the card**,
  + rider-coverage gate green.
- Phase 4: feel pass at the acceptance criterion + zero-unrendered-source gate green + mobile
  steer decision validated on a phone.
- Phase 5: a fresh-save run and a 10-run save both produce non-empty "earned this run" screens.
- Phase 6: frame gate at target density on real hardware.

---

## 4. Verification plan

**The calibration protocol (Phase 0, before any threshold freezes):** run every new meter on
(i) the current build, (ii) 2–3 reference tracks (a canon game mix, a modern adaptive mix),
(iii) a deliberately bad control, with interleaved repeats to measure run-to-run spread.
Thresholds are frozen **from that distribution** (e.g. HARSH tightens to post-fix median +
spread, not to an invented 6%). A detector that cannot reproduce the current build's known
figures (~28 musical onsets/s) is in the wrong unit. This is the antidote to the harness's
most-documented failure: thresholds sitting inside their own noise.

**New gates** (armed per the ratchet schedule; browser gates live in `suite` — `verify:node`'s
charter is browserless):

| Gate | Property | Design notes (post-review) |
|---|---|---|
| `onsetflux` | audible onset rate | **Two-sided**: scheduler-side audible-onset count (the diagnosis unit, past AUDIBLE_FLOOR) *and* rendered-master flux from the browser recorder, cross-calibrated on the current build. Music-only arms at S1; +SFX at S6. Target set by calibration; the *reduction* is owned by S5's onset-diet table |
| `sustainshare` | sustained-vs-transient energy | **Banded 55–75%**, K-weighted, with a cap on any single stem's share of sustained loudness — an unbounded loud drone must not be able to satisfy it (drop-economy shape) |
| `attackfloor` | envelope params on scheduled haps (never source text) | **BUILT + MEASURED.** Gates attack ≥20ms and **TAIL** ≥250ms, where tail = attack+decay on a `sustain(0)` lane and release on a sustaining one. Gating `release` literally — as this row said in v2 — is **pre-gamed**: superdough only runs the release ramp *from* sustain, so on the 100%-sustain-0 motor `.release(0.3)` turns the row green with zero audible change. Allowlist is `clap`/`fx` only — `kick` (263ms) and `power` (400/500ms) already pass |
| `wetfloor` | dry/wet inversion guard | motor/bass room ≥.1 (queried) + harmony-orbit tail ≥ −20dB vs onsets (rendered) |
| `roughness-exposure` | roughness integrated over 3 simulated minutes | **Absolute** roughness-seconds/min ceiling (not only the zero-sum chords+lead share); gain-weighted; **ERB-width bands below MIDI ~48** so drone-vs-bass beating is visible to it |
| `envcurve` | intensity→envelope continuity | Envelope lengths are per-hap **rendering from the raw signal** (never in the rebuild key — stated in S5); the gate pins the intensity bucket, sweeps the raw signal both directions (hysteresis-aware) |
| `crest` + listening artefact | full-mix WAVs, human-judged | Rendered by the **browser-capture recorder** (S0) — `render.mjs` stays writing-only, per its own header |
| `budget` | quantisation + pile-up | off-grid share ≤10% **excluding the allowlisted immediate class**; zero instants > **6** simultaneous onsets (one number, everywhere) |
| `sfxlatency` | combat feedback immediacy | event→audible ≤50ms for player-hit/graze — the property S6's quantisation would otherwise silently trade away |
| `threatdensity` | bullets-per-second near the player, per wave | Built to the rewritten-`curve` design: whole-wave integration from one continuous run, boss waves compared to boss waves, **bot-independent probe** (parked-ship/fixed-ring), ≥4 reps; reads the declared population-budget constant |
| `ridercoverage` | every rider/duet id fires, renders, and sounds | extends `effectsdraw` + the `instruments` 38/38 audit; per-rider `world.effects` entry AND draw call AND stem route — the declared-never-rendered incident class |
| `economyaudit` | G8 currency source ⊥ every in-run gate signal | the drop-economy check made mechanical |
| `camtest` / `spawnring` / `unrendered-source` | camera correctness (Phase 4) | draw==hitTest at 3 zoom levels; spawns 60–120px off-view; **zero damage from a source never rendered** |
| authored-section carve-out | G1's coda | explicit exemption rows in `tune`/`leadfreeze`/`rebuildstable` so the coda doesn't force gate rewrites |

**Baselines that intentionally move — Track S:** `spectrum`, `mixaudit`, `audiocheck` HARSH
(tighten from calibration after the fix), `masking`, `interlock`, `texture`, `sfxrate`,
`polyphony` (long releases raise sustained voices — verify peak <90/96 or raise the cap
deliberately), `gating` (re-armed: ≤4dB, ≤15% duty, bed orbit only), **`leadfreeze`
(re-baselined per S-step, diff reviewed)**, **`leadcheck` (rewritten with S-f: vib on longs
only, depth still bounded)**, `motorcheck` (CONTINUITY question resolved if the held-note clock
is adopted).

**Baselines that intentionally move — Track G:** `curve`, `roster`, `ttk`, `bosslength`,
`movements` (asserts literal pixel geometry), `content`, `wavelength`, `progression`, `deadair`,
`economy`/`drops`, `variety`/`tensionprobe` (G6 shifts the signal ranges they're calibrated on),
both bullet caps, the committed screenshot goldens (`shot-*.png`, `smoke.png` — whole-field
framing), and `threatdensity` itself at G10. Each re-established in the same change that moves
it, per phase.

**Must not regress:** `chop` (holes), `retention` (nesting + gain-response), `rebuildstable`,
`voicing`, `tune` 9/9, `clash`, `counterpoint`, the a11y set (`strobe`, `flash`, `contrast`,
`colourblind`, `touchcheck`, `typescale`) — noting `contrast`/`touchcheck`/`mobileshot` become
*changing* baselines inside Phase 4 only.

**Harness discipline:** the five choppiness gates (`gating`, `rebuildstable`, `voicing`,
`retention`, `chop`) are in no suite today — add them plus the S0 set to `suite`; `verify:all`
is `&&`-chained, use `suite` for a full board; interleave any A/B smaller than its noise band.

---

## 5. What NOT to do (each rejects a plausible move)

1. **No infinite scrolling map** — walls are load-bearing. (Generated *bounded* layouts are in — G6.)
2. **No VS horde scale** — enemy count is the mix; 300 musicians is mud. Threat scales through
   bullet grammar; the ensemble stays "large band".
3. **No illegibility-as-victory** — a screen-filling build must resolve into an *orchestrated*
   fortissimo (curves, never clipping). Fusion specifically must sound **bigger**, never thinner.
4. **No "balance out the window"** — keep the duet DPS renormalisation; spend spectacle in
   riders and audio.
5. **No 7,921 free-form stat staples** — riders are id-indexed and invariant-guarded instead.
6. **No slot-machine chest rituals** — bar-line-quantised rewards *are* the dopamine
   architecture.
7. **No fire button** — dodging + focus already provide the per-second micro-decision.
8. **No new stems, no added offer cards, no on/off stem thresholds, no second timekeeping
   percussion** — the four standing doctrines (chairs, offer pool, curves, pulse inversion).
9. **No soundfont dependency** — the single-file build stays self-contained; samples only as
   inlined data URIs, only after synthesis is exhausted.
10. **No base-building meta layer** (BxP law 5 consciously rejected — MusicWars's meta verb is
    the repertoire/codex, not a second game) and **no cross-run speed tiers for now** (BxP law 8
    deferred until after the Finale ships — time compression needs an ending to compress toward).
11. **No re-litigating the ruled-out** — dropouts, sidechain gating, rebuild churn, voice
    stealing, scheduler starvation are instrumented dead ends.

---

## 6. Open decisions (owner input wanted; none block Phase 0–1)

1. **Run length** — 20:00 Finale entry assumed; revisit after G2.
2. **World/viewport numbers** — acceptance criterion is fixed (hidden ≥ 1 viewport per axis);
   the initial 2200×2400 / 1100×1200 pair is the floor for the feel pass, which may push larger.
   Sprite legibility at the smaller scale gates the zoom half.
3. **Meta scope** — thin first (repertoire + codex + audible-unlocks-with-perks); the refundable
   shop with RNG-control ranks follows once `economyaudit` exists.
4. **S8 wavetables** — only if the post-S5 listening pass finds the pad characterless (~20KB).
5. **Rack magnitudes** — the ~75% figure is a placeholder for the 60k-offer sim to validate.
6. **The Finale-killer's identity** — which authored union carries the meta-chase.
7. **G9 performer count and the 3/4-time performer's scope** — flagship of Phase 5 or a
   post-1.0 content update.

---

## 7. Changelog — what has actually landed

Append-only. Each entry names the commit, what was verified, and anything found
that changes the plan above.

### 2026-08-24 — Phase 0 opened

**Baseline commit.** The repo had *zero commits*; the entire tree was untracked.
Committed as-is first so every step below has a rollback point. Typecheck clean
at baseline.

**G0 — reroll/banish stale cards: FIXED.** Confirmed live exactly as the review
predicted: `applyOfferInput`'s reroll and banish paths, and the public
`rerollOffer`/`banishOffer`, all mutated the offer and emitted nothing, while
`LevelUpOverlay` rebuilds its cards only inside `open()`, reached only from the
`level:offer` handler. All offer-changing paths now route through one
`World.emitOffer`. Verified: typecheck clean, `npm run wiring` holds.
*Plan correction:* the old plan also blamed three wrong key hints. **They are
already correct** — `levelup.ts` prints `R` / `⇧1-4` / `Q` and `input.ts` binds
`KeyR` / `Shift`+digit / `KeyQ`. That fix landed at some point and the plan
inherited a stale claim. G0's scope shrinks accordingly.

**Housekeeping done.** `tools/themesearch.mjs` deleted (nothing but prose
referenced it); `docs/redesign-plan.md` marked superseded;
`docs/progression.md` corrected.

**New finding — the prose has drifted further than the review caught.**
`src/game/progression.ts` *contradicted itself*: its header paragraph said
"slots start at three of each and grow by one per boss" while `STAND_SLOTS = 4`
/ `RIG_SLOTS = 3` sat forty lines below, and a third paragraph said bosses no
longer grant slots at all. Corrected. This is the "mirrors drift" lesson
applying to source comments, not just docs.

**New finding — dead code describing a removed mechanic (not yet fixed).**
`prog.onBossDefeated` now returns `fusions: []` by design ("a boss no longer
fuses FOR you"), but `World.rewardBoss` still loops over `reward.fusions` and
emits `ability:union`/`ability:evolve` from inside that loop — unreachable — and
that branch has no `ability:duet` case at all. The live emits are on the offer
path (`world.ts:2906-2908`), which does cover all three. Deferred only because
`world.ts` was being edited by the G6-Stage-0 workstream at the time.
*Add to G0's scope.*

**Open at end of entry:** the four parallel Phase 0 workstreams (`attackfloor`,
`threatdensity`, the browser capture recorder, and the arena-constant
unification), each with an independent adversarial verifier.

### 2026-08-24 — Phase 0: the first two instruments exist, and they corrected the plan

`tools/attackfloor.mjs` and `tools/threatdensity.mjs` are built, run, and **fail
loudly on today's build** — which is what a gate on an unfixed build should do.
Both carry working positive controls (attackfloor's runs game-free; threatdensity
has `starve`/`boost`/`half`, and `boost` flips it green, proving it is not stuck
at FAIL). Neither reads source text. Numbers below are the recorded baselines
Track S and G2 will be judged against. *Pending the adversarial verifiers.*

**attackfloor baseline** (seed 0x51ed, 720s, 385 bars, waves 0–21). Scheduled-hap
rate **49.7/bar ≈ 26.1/s early, 64.1/bar ≈ 36.0/s late** — brackets the plan's
quoted ~28/s, so the unit check passes, *and* the 29% early→late rise is
"intensity = more onsets" measured in a single number.

| stem | attack (ms) | sustain | tail lo/med/hi (ms) | no-attack | room | dBFS |
|---|---|---|---|---|---|---|
| hats (MOTOR) | 4.0 flat | **0** | **74 flat** | 0% | **0.00** | −27 |
| bass | 1.0–12 | 0.42 | **10**/10/400 | **72%** | **0.00** | **−11** |
| motifs | 1.0–60 | 0 (84%) | 10/71/221 | 92% | — | — |
| lead | 6.0 flat | 0.55 | 340/720/910 | 0% | yes | — |
| sub | 6.0 flat | 0.80 | 80 flat | 0% | 0.00 | −24 |
| chords | 3–600 | 0.30 | 83/200/2225 | — | yes | — |
| arp | 4.0 flat | 0.40 | 180 flat | 0% | delay | — |

**Four corrections to Track S, all folded in above:**
1. **§4's gate row was pre-gamed as written.** It said "release ≥250ms". superdough
   only runs the release ramp *from* sustain, so on the 100%-sustain-0 motor,
   appending `.release(0.3)` would have turned the gate green with **zero audible
   change** — the "gates optimised against" failure, caught before it happened.
   The gate measures **tail** (attack+decay when sustain is 0). Row rewritten.
2. **BASS is the second offender and no S-step named it.** 72% of its haps set no
   attack at all (inheriting superdough's 1ms), median tail **10ms**, and at
   **−11 dBFS it is the loudest pitched lane in the mix — 16dB above the motor.**
   Added to S1.
3. **The pad is already fine; the square STAB is not** (3ms, sustain 0, 83ms tail,
   26% of the chords lane). S-d's gain-curve remedy does not reach it. Added to S1.
4. The plan's "three of four voices use the default envelope by design" conflates
   two populations: `bass`/`motifs` genuinely *inherit* the default (omission);
   `hats`/`arp`/`lead`/`sub` set explicit but tiny 4–6ms attacks (decision). The
   remedies differ. Also: `power` and `kick` already pass, so the furniture
   exemption the plan grants is only load-bearing for `clap` and `fx`.

**threatdensity baseline** (6 seeds × 22 min, bot-independent probe, whole-wave
integration, boss-vs-boss). **G2's central premise was half wrong:**
- **Ladder waves escalate fine** — 1.65/s at wave 5 → 14.74/s at wave 23, a
  **3.66× threat rise against a 2.34× population rise** (ratio 1.56, 6/6 seeds).
  Threat-per-body roughly doubles. "Waves 9+ only add bodies" is not true of the
  ladder.
- **The bosses are the defect.** Six bosses, waves 4→24: `6.9 · 4.8 · 7.5 · 4.8 ·
  7.5 · 4.9` — two alternating patterns, **1.05× escalation over twenty waves**,
  repeating to within ~1%, with boss population slightly falling. G2 re-ordered:
  boss patterns are now first priority, not one bullet among several.
- **The "declared population constant" instruction was wrong.** Today's budget is
  a *floor* (`targetOnScreen`), overshot ~2× by group spawns, and still climbing
  at wave 25. Declaring it flat would halve late-wave population — a balance
  change disguised as bookkeeping. Instruction rewritten.
- **SOLOIST/ELITE waves are unintended lulls** (0.26 and 3.56 arrivals/s at waves
  6 and 18 against neighbours at 3–10).
- **`curve` structurally cannot see any of this**: its headline is
  `pressure = bullets + enemies * 3`, which folds bodies into the number. The two
  tools are not redundant.

**Also found:** `src/game/arena.ts` and `src/style.css` both cite
`tools/fieldsize.mjs` as the check that proves the world size agrees across
surfaces — **and that file does not exist**. A comment naming a gate nobody wrote
is the same drift defect this codebase keeps getting bitten by, freshly minted.
Blocking the arena change until it is written or the claims are removed.
