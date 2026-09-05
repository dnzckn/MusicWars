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
| `onsetflux` | audible onset rate | **Two-sided**: scheduler-side audible-onset count (the diagnosis unit, past AUDIBLE_FLOOR) *and* rendered-master flux from the browser recorder, cross-calibrated on the current build. Music-only arms at S1; +SFX at S6. Target from calibration; the *reduction* is owned by S5's onset-diet table. **The rendered side MUST divide by capture coverage or refuse the file.** The audio thread does not always run in real time here — measured coverage 100.1 / 100.0 / 92.1 / **66.4**% across four runs, with delivery 100% and zero ring overruns every time, i.e. the graph itself rendered 41.4s of audio in 45.0s of wall clock. A rate taken from such a file is biased high by exactly 1/coverage, and cross-calibration would then blame the score for the harness stalling |
| `sustainshare` | sustained-vs-transient energy | **Banded 55–75%**, K-weighted, with a cap on any single stem's share of sustained loudness — an unbounded loud drone must not be able to satisfy it (drop-economy shape) |
| `attackfloor` | envelope params on scheduled haps (never source text) | **BUILT + MEASURED.** Gates attack ≥20ms and **TAIL** ≥250ms, where tail = attack+decay on a `sustain(0)` lane and release on a sustaining one. Gating `release` literally — as this row said in v2 — is **pre-gamed**: superdough only runs the release ramp *from* sustain, so on the 100%-sustain-0 motor `.release(0.3)` turns the row green with zero audible change. Allowlist is `clap`/`fx` only — `kick` (263ms) and `power` (400/500ms) already pass |
| `wetfloor` | dry/wet inversion guard | motor/bass room ≥.1 (queried) + harmony-orbit tail ≥ −20dB vs onsets (rendered) |
| `roughness-exposure` | roughness integrated over 3 simulated minutes | **Absolute** roughness-seconds/min ceiling (not only the zero-sum chords+lead share); gain-weighted; **ERB-width bands below MIDI ~48** so drone-vs-bass beating is visible to it |
| `envcurve` | intensity→envelope continuity | Envelope lengths are per-hap **rendering from the raw signal** (never in the rebuild key — stated in S5); the gate pins the intensity bucket, sweeps the raw signal both directions (hysteresis-aware) |
| `crest` + listening artefact | full-mix WAVs, human-judged | **BUILT.** `tools/capture.mjs` produces real 44.1kHz stereo WAVs off the live master, verified by re-reading from disk, with a control that forces failure. **The ≤14dB crest threshold in v2 was invented and is already wrong:** today's unmodified build measures 13.2 / 14.0 / **19.9** dB at waves 4 / 6 / 12, so the gate would fail for reasons unrelated to choppiness. Calibrate it. Also do **not** compare these levels to `render.mjs`, which normalises every file to 0.89 peak and so runs ~20dB hotter for the same music |
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

### 2026-08-24 — the browser half of the harness was never running

**The verification harness was half-dark and nobody knew.** 109 of the 171 tools
drive a real Chromium. On this box they did not fail — they **hung**, because
the machine's disk is failing and the corruption landed inside the Playwright
cache. Three of the four installed Chromium builds have unreadable files
(different files each), and a bad-block read never returns: Chrome blocks
forever in `folio_wait_bit_common` mmapping the snapshot, Playwright reports
only "Timeout exceeded", and the zygote is left unkillable in D state (twelve
had accumulated, up to an hour old, and they are what inflated this box's load
average to 20). `chromedeps.mjs` could not see it — it picks the highest build
number, which is one of the broken ones, and validates with `ldd`, which reads
ELF headers out of the good part of the file and answers yes.

`tools/lib/chromepath.mjs` health-probes each build plus the two data files
Chrome mmaps at startup, keeps only fully readable ones, prefers a tmpfs copy,
and publishes `CHROME_PATH` — which all 109 tools already pass to
`chromium.launch`. It also sets `LD_LIBRARY_PATH` for the no-root native libs,
which only 4 of the 109 were doing. Hooked via `lib/frozen.mjs` (107 of 109
import it, and ES imports evaluate before the importing module's body). Inert on
a healthy machine; its header says to delete it once the disk is replaced.

**Consequence, immediately:** with the browser finally starting, `npm run smoke`
— which is inside `npm run verify` — turned out to have been **broken since the
hats→MOTOR rename**. It read `sourceLines().find(l => l.label === 'hats').code`
and threw on `undefined`. A dead gate in the primary suite. Fixed, and it now
throws a legible error listing the real labels if the name moves again. Assume
other browser gates have rotted the same way and re-run the board before
trusting any of them.

**The capture recorder is built and verified.** Real 44.1kHz stereo WAVs off the
live master, re-read from disk to confirm, with a positive control that forces a
failure the tool correctly refuses to pass. Three corrections it forced:
1. **`onsetflux`'s rendered side must divide by coverage or refuse the file.**
   The audio thread does not always run in real time (coverage 100.1 / 100.0 /
   92.1 / 66.4% with delivery at 100% and no ring overruns). §4 updated.
2. **The `crest ≤14dB` threshold was invented and is already wrong** — the
   unmodified build measures 13.2 / 14.0 / 19.9 dB. §4 updated to demand
   calibration. This is the third invented threshold this phase has caught.
3. `render.mjs` normalises to 0.89 peak, so it runs ~20dB hotter than the real
   master. Never compare the two.

**A real seed contract now exists.** `World` always accepted
`constructor(seed = Date.now() & 0xffffffff)`, but `main.ts` never passed one, so
the capture tool had to overwrite `world.rng`'s internals — a trick that depends
on a field name. `?seed=0x51ed` now works, and `__musicwars.seed()` reads back
what it resolved to. The S1/S2/S5 listening passes need fixed seeds to mean
anything, so this was load-bearing.

### S1 — first landing: the bass, and it was two defects, not one

The lane the corrected S1 named as the unnamed second offender is now measured,
fixed, and re-measured. `tools/attackfloor.mjs` over a 720s / 385-bar sweep,
before → after:

| bass | before | after |
|---|---|---|
| attack ms lo/med/hi | `1.0/1.0/12` | `5.0/11/13` |
| TAIL ms lo/med/hi | `10/10/400` | `80/217/400` |
| haps with no attack set | 72% | 0% |
| haps with no release set | 72% | 0% |

**Defect 1 — both ends of the note were superdough's defaults.** `.ds()` sets
decay and sustain and says nothing about attack or release, so the loudest
pitched lane in the game (−11 dBFS, 16dB above the motor) got a 1ms attack and a
10ms release. The note was never *short* — `sustain(0.42)` holds it for its full
length — it was hard-edged at both ends: a 1ms ramp on a sawtooth that loud is a
broadband click on every onset, and a 10ms ramp off it is an audible chop before
the next note. Loudest lane, sharpest edges, eight times a bar. No amount of
`gain` work could ever have reached it, because the level was never the problem.

Both ends now ride `drive` as curves, not constants — 14ms/260ms when calm,
6ms/140ms when driving. **The curve is the point, not the floor.** Four of the
seven pitched lanes measure an *identical* envelope on every hap of a
twelve-minute sweep (`4.0/4.0/4.0`, `6.0/6.0/6.0`). That invariance is the real
clavichord complaint — the chiptune canon this score aims at has instant
attacks, so speed was never the defect; *no note ever being shaped differently
from any other* is. A flat `.attack(0.02)` typed onto every lane would satisfy
an attack gate and leave the invariance untouched: this project's own recorded
"gates optimised against" failure in a fresh costume. **§4's provisional
attack ≥20ms floor should be retired in calibration and replaced with a spread
requirement.** An 11ms median on a bass is musically right; 20ms would cost it
its definition.

**Defect 2 — the 808 has never once been heard.** `glide()` was the *innermost*
call, so every control it set that the chain below also set was overwritten two
lines later: `.s('sine')` lost to `.s('sawtooth')`, `.decay(0.7).sustain(0.35)`
lost to `.ds('0.3:0.42')`. Only `attack`, `release` and the pitch envelope
survived, because nothing downstream restated those. Applying it to the finished
chain instead of seeding it makes every control the last writer.

This is a source-reading claim that had to be proven off haps, and was: the BY
VOICE table listed `bass·sawtooth` and `bass·supersaw` and **no `bass·sine` row
at all**, while that sawtooth row carried an attack high of 6ms and a release
high of 400ms — `glide()`'s own numbers, which appear nowhere else in the
function. After the fix a `bass·sine` row exists (624 haps, `decay 700,
sustain 0.35, release 400` — exactly its intended values) and `bass·sawtooth`
fell 12712 → 12088. 12712 − 624 = 12088, exactly.

Verified: `tsc --noEmit` exit 0, `masking` exit 0, attackfloor before/after.
NOT verified: nothing has been listened to, and every browser gate remains
blocked (see below).

### The disk, corrected twice

A reboot did **not** fix it, and two things I reported earlier were wrong.
Post-reboot every previously-unreadable file reads clean, but `storvsc` errors
still accrue at ~1 per 6.4s — the same rate as before. What the reboot cleared
was the *wedged* state, not the fault. Processes still enter unkillable D-state
on a bad read: `npm exec tsc` sat in `D` with 0.0 CPU for 11 minutes and had to
be abandoned.

**Operational workaround that works:** invoke binaries directly
(`node node_modules/typescript/bin/tsc`) instead of via `npx`/`npm run`. npm's
file-walking maximises exposure to bad blocks; the same typecheck completed in
under a minute run directly.

**`chromepath.mjs`'s 64KB health probe is insufficient** and this is the second
thing I got wrong. It passed all four builds, and the browser still hung 180s on
launch — reading 64KB of a 389MB binary proves nothing about the rest of it. The
probe should be treated as a necessary-not-sufficient screen. The tmpfs copy its
own header recommends is the actual remedy, and it is not created automatically.

### S1 — the MOTOR, and §4's tail floor is wrong for it

`attackfloor`, before → after:

| hats / MOTOR | before | after |
|---|---|---|
| sustain | 0.00 | 0.26 |
| release ms lo/med/hi | `10/10/10` | `10/112/160` |
| TAIL ms lo/med/hi | `74/74/74` | `74/112/160` |
| haps with no release set | 100% | 0% |
| sustain-0 | 100% | 48% |

**The defect was articulation, not length.** `sustain(0)` puts the amplitude at
zero by attack+decay and holds it there until the note ends, so a note's WRITTEN
length changes nothing about how long it sounds. Every one of 25,340 haps was
the same 74ms blip — the tool measured a tail of `74/74/74`, the same number on
every hap of a twelve-minute sweep.

Read that against what `motorVoicing` actually writes. `gallop` is
`[root@3 third]` — a dotted eighth and a sixteenth, 667ms against 222ms, the
William Tell figure its own comment is proud of. `shuffle` is triplets.
Half-time is a dotted-eighth displacement. The fill bar ends in four sixteenths.
**Five distinct articulations were written and all five came out as the same
blip.** The gallop's long-short survived only in *when the next note started* —
never in the notes themselves. That is the audible difference between a line
that is played and one that is sequenced, and it is this lane's share of
"clavichord": not that the attack is fast, but that nothing about a note varies.

The beat layer now sustains, so written length is audible for the first time.
The 70ms decay is untouched, so the percussive front that makes it a motor is
unchanged. The offbeat layer deliberately keeps `sustain(0)` — it is garnish at
a tenth of the level landing between the beat layer's notes, and giving it a
body would fill the very gaps that make the two layers read as separate. That is
the 48% sustain-0 in the table, and it is intended.

**§4's `tail ≥ 250ms` floor must NOT be applied to this lane, and this is now
the second §4 threshold measurement has contradicted.** The motor plays down to
111ms sixteenths on the fill bar. A 250ms tail would put three notes on top of
each other and turn the lane into a drone — which would undo the *pulse
inversion* the entire arrangement rests on (percussion stopped keeping time so
the pitched lanes could stop being texture). The floor encodes an assumption
that every pitched lane wants to ring, and the lane whose job is the clock does
not. Calibration should replace both §4 envelope floors with a **spread**
requirement — no lane may measure the same tail on every hap — which is what
actually distinguishes a played part from a sequenced one, and which cannot be
satisfied by typing a constant.

**Caveat, stated because the tool cannot see it:** `attackfloor`'s dBFS column
is derived from `gain`, so it reads −27 both before and after and is blind to
the sustained energy this change adds. The mix-balance consequence is unmeasured
and needs `mixaudit`, which is browser-gated.

### Browser tools: not viable on this box, and the reason is now pinned down

`cp` of `chromium-1234/chrome-linux64` to tmpfs wedged in D-state **inside the
`chrome` binary itself, ~3MB in**, and made zero progress over 20 minutes. That
is the direct proof that `chromepath.mjs`'s 64KB health probe is
necessary-but-not-sufficient: it validated this exact build, and the browser
then hung 180s on launch. A probe that reads 64KB of a 389MB file says nothing
about the other 388MB.

Treat every browser gate as unavailable until the disk is replaced. Node-only
tools (`attackfloor`, `masking`) run fine and are the whole verification surface
for now — which means S1's mix-balance and listening checks are deferred, not
passed.

### S1 — the whole score was a test tone, and nothing was measuring it

`src/types/strudel.d.ts` already contains the diagnosis, written before any of
this work: *"A pulse or triangle held at a fixed frequency is a test tone — the
ear hears an oscillator. The same note with a few cents of periodic movement is
heard as **sung**, because every physical instrument and voice does it. Its
absence is a large part of what makes a chip melody read as synthetic."*

That note sat in the type declarations while `.vib()` appeared in **exactly one
place in the entire score** — `buildLead`, line 2388. Every other pitched lane
was a mathematically perfect oscillator. Nothing measured it, so nothing
noticed: the repo's own "unmeasured properties rot" law, caught in the act, and
feeding the exact complaint S1 exists to answer.

`tools/vibprobe.mjs` (new, node-only) measures it off haps, because this control
fails silently in both directions — superdough puts the vibrato oscillator
behind `if (vib > 0)` so `.vibmod()` alone is inert, and `.vib()` alone takes a
default depth of 0.5, half a semitone, audibly out of tune on a sustained chord.
Both look completely fine in the source.

| chords | before | after |
|---|---|---|
| haps with `vib > 0` | 0% | 34% |
| distinct rates | — | `4.6 5.03 5.46 5.9 6.4` |
| depth range | — | `0.053..0.099` |

The pad's three chord tones and the two colour tones each get their **own** rate.
That is the whole mechanism: `.detune()` is unavailable (superdough reads it only
in the `supersaw` branch, and this lane is a pulse on purpose), so the ensemble
is built out of disagreement instead. No two voices return to centre together,
so their sum is never the same twice — which is what a section of players is,
and the nearest thing to a chorus available without a chorus node. **A chord
showing one shared rate would be a phaser, not a section**, which is why
`vibprobe`'s `distinct rates` column matters more than its percentage.

This lane deserved it most: the bed, held under everything, 27,752 haps,
second-loudest pitched lane at −15 dBFS, and the colour tones tail out to 2.6s —
the longest and highest sustained tones in the mix.

`vibprobe` deliberately has **no thresholds and no verdict**. There is no
defensible a priori answer to "what fraction of haps should vibrate" — a sub
should be 0% and a pad should not — and inventing one would be the third
invented threshold this phase has had to retract.

**Still fixed-frequency, and this is the standing list:** `sub kick clap hats
bass arp fx motifs power`. Drums and the sub belong there. `arp` (1,340 haps,
180ms tails) and the motor (now sustaining to 160ms) are the two open questions;
`bass` should probably stay steady, since bass players do not vibrato much.

### The listening tool was arguing against the defect

`tools/render.mjs` is the only artefact anybody can actually hear on this box —
Chromium is dead, so the S0 browser capture recorder is unavailable and this WAV
is the whole listening surface. It was computing envelopes wrong, in the one
direction that mattered.

It read each ADSR control with an independent fallback (`attack 0.005,
decay 0.1, sustain 0, release 0.08`). superdough does not work that way:
`helpers.mjs:167` treats the four as a group — if none is set it uses the
synth's default `[0.001, 0.05, 0.6, 0.01]` (`synth.mjs:47`), and otherwise it
floors the unset ones at 0.001 for attack/decay and 0.01 for release, deriving
sustain from *which* of attack and decay were supplied.

Measured side by side:

| hap | render OLD | superdough truth |
|---|---|---|
| bass pre-fix `.ds('0.3:0.42')` | a 5ms, r **80ms** | a 1ms, r **10ms** |
| motor pre-fix `.ad('0.004:0.07').sustain(0)` | r 80ms | r 10ms |
| **no envelope set at all** | 5 / 100 / **0** / 80 | 1 / 50 / **0.6** / 10 |
| chord stab (all four set) | identical | identical |
| pad (all four set) | identical | identical |

**The pattern is the finding.** Lanes that set all four controls rendered
correctly. Lanes that relied on defaults — which is exactly the set of lanes
that were defective — rendered with an EIGHT TIMES longer release. The one tool
available for listening was smoothing off the precise chop the score was being
criticised for. It did not merely fail to show the problem; it rendered evidence
against it. The "nothing set" row is worse in kind: render made such a hap a
pluck where the game holds it at 0.6 sustain.

Fixed by importing superdough's own `getADSRValues` and deleting the fallbacks,
which is the decision `attackfloor.mjs` already made and states in its header: a
tool holding its own copy of somebody else's arithmetic is a mirror that drifts.
Passing `null` for unset controls is load-bearing, not tidiness — superdough
picks the sustain branch from which controls are present, so a substituted
number selects the wrong branch.

**This is a caution about the last three commits, not a retraction of them.**
Every claim in S1 so far came from `attackfloor`, which has always called
`getADSRValues` and was never affected. But it does mean nothing rendered before
today can be trusted as a "before" recording.

### A negative result: the mix has no gaps, so "choppy" is probably not gaps

With `render.mjs` corrected, an honest A/B is possible — same renderer, same
composition (1764 events queried and 1484 synthesised in BOTH runs), pre-S1
`layers.ts` against current. Measured off the audio in 5ms frames, thresholds
relative to each file's own median frame:

| metric | before | after |
|---|---|---|
| % of time >12dB under median | 0.7 | 0.7 |
| % of time >20dB under median | 0.4 | 0.4 |
| mean per-frame level drop | 2.309 dB | 2.284 dB |
| crest | 6.38 dB | 6.32 dB |

**Nothing moved above the noise floor**, and `render.mjs`'s own header sets that
floor: it says in capitals that the tool is not deterministic and that identical
runs gave peaks of 0.408 / 0.421 / 0.414. A 0.025dB difference in mean drop is
not a result.

The interesting number is not the comparison, it is the level: **the full mix
sits more than 12dB below its own median only 0.7% of the time.** With eleven
lanes sounding at once, one lane's gaps are another lane's notes. Per-lane
envelope work is real at the hap level and largely invisible in the sum, and
more importantly *the score does not have a silence problem to fix*.

So the S-a framing needs re-examining. If "choppy / abrasive over time" is not
gaps, the leading remaining candidate is **onset DENSITY** — `attackfloor`
measures 64.1 haps per bar, **36.0 onsets per second**, a fresh transient every
28ms. That is a lot even against the chiptune canon, it is cumulative in exactly
the way "over time" describes, and it is a *count* problem rather than an
*envelope* problem. Reducing it means removing notes, which is an arrangement
change and collides directly with the retention doctrine, so it must not be
started on a hunch.

**What is and is not established.** The hap-level defects were real and are
fixed: a 1ms attack and 10ms release on the loudest pitched lane, a `.s('sine')`
that never reached the output, five written articulations rendered as one, and a
score containing a single vibrato. That those fixes improve what a person hears
is **unproven**. Both WAVs have been handed to the user, who is the only
instrument available for the question that actually matters.

**Do not tune further envelope numbers until that comes back.** Continuing to
optimise a quantity with no demonstrated link to the complaint is precisely the
"gates optimised against" failure, and it would be self-inflicted this time.

## Track G — the combination inventory, counted

"the concept of mixing weapons together or passives together isn't really
there" is measurable, so it has been measured. Counted off `weapons.ts` by
walking the tables rather than eyeballing them:

| | count |
|---|---|
| base instruments | 12 |
| passives (RIG) | 12 |
| instruments total | 26 (12 base + 14 fusion results) |
| fusion recipes | 14 (12 `evolution`, 2 `union`) |
| instrument × passive recipes | 12 |
| instrument × instrument recipes | 2 |
| **passive × passive recipes** | **0** |
| generic duet pairs reachable | C(12,2) = 66 |

**Three findings, in descending order of how directly they answer the
complaint.**

1. **Mixing passives together does not exist.** Zero recipes combine two RIG
   items. Half of the user's sentence describes a mechanic that was never
   built, so this is not a discoverability problem and no amount of surfacing
   fixes it.

2. **Every instrument has exactly one evolution, and it takes one specific
   passive.** Twelve evolutions for twelve instruments, 1:1, each keyed to a
   named catalyst. There is therefore no *choice* of evolution path — given
   your instrument, the evolution is determined, and the only question is
   whether you happen to draw its catalyst. Ball x Pit's entire appeal is the
   opposite: one ball branches many ways, so committing to it is a decision
   that stays interesting. Here committing is a lookup.

3. **The generic duet is the one broad system and it almost never fires.** 66
   pairs are reachable in principle, but both inputs must reach
   `DUET_INPUT_LEVEL = 6`, and the source's own comment beside that constant
   records the measurement: **13-16% of 900-second runs contained a fusion
   card, and a 480s run essentially never did.** Its own note draws the right
   conclusion — "a core verb that does not exist for the first half of the game
   is not a core verb" — and then sets the constant to 6 rather than solving it.

**What this implies for G-work, stated as a hypothesis and not yet a plan.** The
shortfall is structural, not volumetric: adding a thirteenth instrument would
not change any of the three findings. Branching evolutions (one instrument, more
than one destination, chosen by which catalyst you take) attacks 2 directly and
reuses the existing recipe machinery. Passive×passive is a genuinely new system
and needs its own design pass. Neither should start before the offer-pool
constraint is re-read: **the 4-card offer is zero-sum**, so anything that adds
card types dilutes everything already competing for those four slots — the
recorded rule is to change what a card is WORTH, never to add cards.

Counted with a table-walking parse rather than by reading, because `RIG` and
`INSTRUMENTS` both contain `id:` fields and a naive grep returns 38 for RIG by
running off the end of one table into the next. That wrong number is what a
casual look gives you.

### Track G, first landing: PIZZICATO branches

The first instrument in the game with two endings. `pizzicato + capo → spiccato`
(unchanged) now sits beside `pizzicato + compressor → snap`.

**Why a branch is the right shape, given the constraints already earned.** The
offer pool is zero-sum and adding card types has been measured to make things
worse. A branch adds nothing to it: `compressor` already exists as BLACKHOLE's
catalyst so the deliberate 12×12 rig is untouched, and `availableOptions` skips
`def.fused` outright (`progression.ts:606`) so the result is never drafted. An
existing card simply becomes worth more — the only exit from the zero-sum trap
this project has found.

**The decision is real because `applyFusion` deletes the base.** Hold PIZZICATO
at 8 with both catalysts maxed and both cards are on the table; take either and
the base is spent, so the other is gone for the run. `readyFusions` already
collected every matching recipe with no early exit, so it needed no change.

It is a sidegrade and deliberately not an arc: HARP owns the fan-of-bolts line
and CROSSSTRUNG is its ending, so an arc here would blur two roster lines — the
objection that killed the RICOCHET rig item. Both branches stay `seek` and split
on stat philosophy: SPICCATO is seven fast light bouncing bolts (crowds), SNAP
is one heavy piercing bolt (375 dmg/s single-target against SPICCATO's 630, far
more through a line).

**The gate that failed was the design, and it was replaced rather than
relaxed.** `levelup.mjs` asserted `n === 1` in both directions — every
instrument evolves exactly once, every rig item catalyses once. The
at-least-one half is worth keeping and is unchanged (an instrument with no
evolution is a dead end; a rig item catalysing nothing is filler in a zero-sum
offer). The at-most-one half was never justified beyond restating the table, and
it *encoded the flaw*: one ending per instrument means committing to an
instrument chose its ending, and only the catalyst's arrival was in question.
It is replaced by a stronger check — two recipes sharing a base must ask
different catalysts and produce different results — plus a printed branch count
so a second branch cannot appear unnoticed. **All three new assertions were
verified to fail when deliberately broken**, per this repo's rule that a gate
never seen red is not evidence.

**Gates, same code before and after:**

| | before (14 recipes) | after (15) |
|---|---|---|
| `mirror` | — | 4000 loadouts, 0 disagreed; all five checks ok |
| `discovery` | 14 obtainable | **15** obtainable, counter derived not hardcoded |
| `builds` | ok | ok — the pick still changes the run |
| intent ratio | 2.00 vs 0.88 = 2.3× | 1.88 vs 0.63 = **3.0×** |
| power | 30.0 vs 27.1 = **+11%** | 29.8 vs 27.6 = **+8%** |
| fusions / 8 runs | 21 | 19 |
| **LOCKED offers** | 105/412 = **25%** | 180/406 = **44%** |

**The LOCKED number is unresolved and is the reason this entry exists.** It
counts offers where the bot's target catalyst is unheld and the rig is full, so
it is a property of *which fusion the bot chose to chase* — and adding an
instrument shifts the RNG stream, so the runs diverge (412 offers against 406)
and different targets get picked. Seeds 3 and 6 still targeted
`pizzicato+capo`, not the new branch, which is evidence the change is moving the
stream rather than the mechanic. Eight divergent runs cannot separate those two
explanations. **A 24-seed comparison is the next job; do not treat +8% or 44% as
established until it lands.** Every gate is green, and that is the only claim
being made.

### Demo prep: an adversarial audit of everything no browser has run

Twelve agents over four lenses, each finding then put to a skeptic told to
refute it. Two survived; five were refuted with measurements.

**CONFIRMED and fixed — a regression from the PIZZICATO branch.** The pause
workbench printed the same row twice. A half-done recipe whose result is
undiscovered deliberately names neither the result nor the catalyst — it reads
`<BASE> is at its ceiling — something you are not carrying` — so the moment an
instrument has TWO recipes, both rows render the identical sentence while
carrying different `to` values (`spiccato`, `snap`). Both catalysts cap at 5, so
`away` matched too and they sorted adjacent. The overlay draws `plan.slice(0,6)`,
so it also spent a row and could push a real aim under the "+N further off" line.

Fixed by emitting one unknown-ceiling row per base. Known rows are untouched, so
a player who has made both still sees `SNAP — COMPRESSOR` and `SPICCATO — CAPO`
separately — the branch stays visible, only the deliberately-anonymous rows
collapse.

`mirror.mjs` passed 11,015 rows on the day this shipped, because its duplicate
check keys on the RESULT ID and the ids differ. It now also asserts the
**rendered text** is unique: two assertions, not one, and the difference was the
bug. Verified to fail — 48 rows across the seed sweep — when the fix is reverted.

**CONFIRMED, pre-existing, not a demo blocker but important.**
`.ftype('ladder')` makes superdough IGNORE the filter type: `helpers.mjs:238`
routes `model === 'ladder'` to the `ladder-processor` worklet, which
(`worklets.mjs:365-427`) is a four-pole Moore ladder **lowpass** with no type
parameter at all. So the bass's `.hpf(95)` is not a highpass — it is a second
24 dB/oct lowpass. That is why the "an 808 is a sine" fix moves so little
audible energy, and it deserves its own investigation. **It is unrelated to any
recent change** — both lines are unchanged context.

**REFUTED, with measurements** — recorded so they are not re-raised:
- *"The motor stops being a pulse"* — the onsets are byte-identical; node
  lifetime 454ms → 604ms against `setMaxPolyphony(96)`. No leak, no clipping.
- *"The chase bass sine adds +4 dB"* — the lane sits ~20 dB below the mix peak
  (`STEM_CURVES.bass` has the lowest ceiling of any pitched lane, 0.6). Measured
  at the master, full-mix peak went **down** 0.16 dB. The `-11 dBFS` figure was
  a misread: `attackfloor`'s dBFS column is `gain² · level² · masterVolume²`, a
  control multiplier that is byte-identical before and after. The "sub-100 Hz"
  claim is also wrong — the notes are 110-175 Hz behind `hpf(95)`.
- *"A failed audio boot is swallowed"* — all three named causes are caught
  upstream inside superdough and can never reach the catch.
- *"The standalone drops the viewport meta"* — true, but desktop browsers ignore
  it; it is a phone-distribution polish item, and predates everything here.

**A separate measurement, and it corrects a claim in the branch commit.** That
commit said both branch cards are "on the table" together. `availableOptions`
does push both, but `makeOffer` calls `draw()`, a WEIGHTED draw without
replacement — high weight is not a guarantee. Measured over 2,000 offers with
both branches ready and in the pool: **both shown 38.1%, exactly one 49.5%,
neither 12.4%**. So the simultaneous commit-and-lose-the-other moment is visible
about a third of the time, and `availableOptions`' own comment that "a ready
fusion is always on the table" is false one time in eight. That is pre-existing
and applies to every fusion, not just this branch (snap appeared 1,289 times
against spiccato's 1,224 — no bias between them). Worth fixing; not fixed hours
before a demo.

---

## Refactor 3, PHASE A — the property substrate and the twenty bases

`docs/plan-refactor-3.md` §9 is the specification and it was followed. What
landed, and what each measurement said.

**The architecture.** `Props` in `weapons.ts` is a flat record of 28 numbers
folded the way `Rules` and `Modifiers` are, covering twenty named properties.
`Enemy` carries fourteen status numbers behind a `status` bitmask so the
per-step tick is one integer test on a body carrying nothing. A bolt carries a
one-byte index into `World.propSets` — interning, because a structure-of-arrays
cannot hold an object and a per-bullet copy of a 28-field record is not a cost
anyone should pay. Every damage site the player owns now goes through
`World.hurt`, which is where a frozen target's +25% and a bleed's stacks are
cashed; before this there were seven separate `e.hp -= x` lines and a property
could only ever have reached the ones somebody remembered.

**Twenty bases, twelve of them re-pointed ids.** `pizzicato` is RASP, `snare` is
SWELL, `chime` is GLASS, and so on. Every re-pointed id keeps its
`ENSEMBLE_MIX` lane and its `layers.ts` signature; eight ids are new and take
existing lanes. All twenty have their own entry in `SHOT_VOICES`, so sharing a
stem lane does not mean sharing the sound of firing.

**Fourteen delivery geometries became seven.** `beam`, `cone`, `spray`, `trail`,
`mortar` were variants of survivors; `chain` and `spawn` became PROPERTIES,
which is strictly more general than a shape one instrument could wear. The six
non-damage shapes (`rest`, `drag`, `ghost`, `counterpoint`, `unison`, `tacet`)
are `plan-items-v2.md`'s second axis and are a separate decision; they survive
as fusion results rather than as picks, so the code stays reachable and
`builds`' damage-taken spread keeps its contributors.

### Measured

**The offer pool did not collapse, and this was the risk worth naming.**
AGENTS.md §5 records a change that added no card type and still cost 31% of a
building player's designed fusions. This adds EIGHT draftable instruments.
`tools/offerpool.mjs` runs both arms inside one build (the eight new ids
banished in the narrow arm), 300 model runs each:

    designed fusions per run, builder   3.50 at 20 draftable   3.50 at 12
    offers containing a fusion card    10.3%                  10.3%
    offers before TIMPANI is dealt      8.0                    6.0

Fusions are UNMOVED. What the wider pool costs is WAITING: 33% longer before a
named instrument is dealt. `levelup`'s own model agrees — builder fusions/run
6.24 → 5.94, ratio against a random picker 1.7x either side. The reason the
fusion rate held is that rig cards are 54% of the deal and `RIG_SLOTS` went 3 →
4 at the same time, and that the recipe table went 15 → 23.

**The roster separates builds better than the one it replaces.** `builds`, 900s
x 8 seeds x 7 policies: divergence 0.38 → 0.72, damage taken across policies
1.5x → 2.2x. That column had been the open complaint in `weapons.ts`' own
header — "two gates now want opposite things" — and it is over 2x again without
anybody widening a bar. `arena` holds at the same time: encirclement p90 0.43 →
0.46 against a 0.25 floor.

**The opener menu got better, not worse.** `openers`: weakest reaches 76% → 96%
of the strongest.

**The substrate's frame cost is below this machine's noise floor.** Measured in
a real browser at wave 24, same seed, same wave: 48.7 fps holding SNAP (which
carries no property) against 48.1 fps holding four property weapons with 36
statused bodies on the field. A repeat of the SNAP arm read 54.1, so run-to-run
drift is ±5 fps and the property cost is 0.6.

### What the measurements CONTRADICTED

- **RASP's reach was inside `Enemy.standoff`.** At 210px it could not reach the
  majority of the roster at all, because everything that is not a rammer holds a
  ring at 240. `openers` found it from the outside — 61% of the best opener's
  wave against a 70% floor — and it read as a balance problem rather than as a
  weapon that physically could not connect. 300px now, and it is not a starter.
- **The simulation delivered and the screen did not.** Driven in a browser with
  each of the twenty forced in turn, every property fired and ticked and NOT ONE
  was visible: a burning body, a poisoned one and an untouched one were the same
  orange teardrop. That is this codebase's own recurring defect inverted, and
  it makes a substrate a number in a log. `Renderer.STATUS_RINGS` draws one
  stroked arc per live status now, and freeze stops the body swaying.
- **Three effects were too short-lived to see.** A chain arc at 0.14s and a
  lance line at 0.16s were gone inside two frames; TIMPANI's shock crossed its
  own 330px radius in 0.2s and screenshotted as a 40px spark. All three are
  `dps: 0` pictures, so lengthening them changes no outcome.
- **`wellcheck` is red for a reason older than this pass.** `player.wells` is
  banked in exactly one place, inside `fireField`, at HEAD and here alike — a
  `blackhole` POWERUP pickup has never granted a charge, which is what that
  check asserts. What DID change is that `fieldSwallows` is `downbeat` alone, so
  the throw is now an evolution's verb rather than a base weapon's.

### Not done, deliberately

The ~60 authored fusions of §9d. `mergeProps` is the joint they hang off and a
generic duet already inherits both parents' properties, so no pair is a dead
end in the meantime. The elite/two-currency economy of §3, the HUD of §5 and
the enemy-fire removal of §1b are all untouched.

---

## Refactor 3, PHASE B — the fusion lattice: 63 authored results over 190 pairs

`docs/plan-refactor-3.md` §9d asked for "~60 hand-authored fusions" over the
`C(20,2) = 190` pairs the twenty properties make, ported from Ball x Pit rather
than invented. Sixty-three landed. Fifty-four are base pairs; nine are TIER-TWO
CHAINS, because the source's depth is part of why its space feels rich —
BOMB → FALLOUT and → TIMEBOMB, SHADE + WRAITH → BANSHEE, SOUL SUCKER + HEART
SWALLOWER → REAPER, SUN + NOCTURNE → EVENT HORIZON, BEAM + CUTTER → X-RAY,
SFORZANDO + ASSASSIN → SNIPER, INCUBUS + SUCCUBUS → DIABOLUS, INFERNO + STORM →
ARMAGEDDON.

**They cost nothing in the offer, which is the only reason there can be
sixty-three.** `progression.ts` skips `def.fused` when it builds the draft pool,
so not one of these is ever a card. AGENTS.md §5 names that as the system's one
free move; this is it spent in full. The offer arithmetic is unchanged from
Phase A and `offerpool` still holds.

**A new `FusionDef.kind`, `lattice`, and nothing else moved.** An `evolution` is
instrument + rig catalyst, a `union` is two evolved instruments at possession, a
`lattice` is TWO INSTRUMENTS both at their own ceiling. `readyFusions` already
asked both sides for `maxLevelOf`, so the requirement is symmetric by
construction and `applyFusion` already spent both inputs — which is why the
whole tier cost one type widening in five files rather than a second code path.

### The three things that made them behaviours rather than blends

**PROPERTIES ARE INHERITED, THEN ADDED TO.** Every row's set is
`mergeProps(parentA@3, parentB@3)` with an authored DELTA on top. That makes "an
arrangement is never weaker than the duet it shadows" true by construction, and
it means a row only writes what is NEW — which is exactly the thing that makes
it distinct. `readyDuets` refuses a pair that has a named recipe, so a weaker
authored result would be a trap the player cannot see.

**THREE FUSION-ONLY PROPERTIES.** `vuln` (radiation, frostburn and curse are one
mechanic under three names: a stack that makes the body softer for everything
else you own), `rend` (a share of what is LEFT) and `execute` (a non-boss is
simply gone). No base weapon carries any of them, which is the design: Ball x
Pit's fusion tier introduces mechanics its base balls do not have, and a lattice
whose every result is a re-mix of twenty base effects is the property merge this
phase exists to avoid. Twelve of the sixty-three would have collapsed without
them. `propfire`'s "every property has a base carrier" became TWO assertions
rather than being relaxed — see `FUSION_ONLY_PROPERTIES`.

**`tools/fusefire.mjs`**, which asks the question no other gate can: what does
this fusion do that its own parents do not, and does that thing FIRE? Every row
is classified `P` (a property neither parent installs) or `S` (a delivery shape
the fallback would not have used), and then a run per fusion proves the
distinctive property fires with a denominator. 20 P, 17 P+S, 26 S, **0 bare
merges**; 39 distinctive properties, 0 never rolled, 0 rolled and never fired.

### What the measurements CONTRADICTED

- **All sixty-three rows were weaker than their own fallback**, at the first
  run. The authoring script targeted 1.6x the better parent because
  `synthesiseDuet` rescales to 1.5x — and a duet then runs its own two level
  steps and lands at **2.31x**. That is the "tool holding its own copy of a
  constant" trap; the factor is measured off a real duet's stat block now.
- **Eight fusions had their whole identity on a delivery shape that cannot
  express it.** Read off `world.ts`: bullets get `applyStatus` + `onHit` +
  `propHitEffects`, a `strike` gets the first two, and an `aura`, a `field` and
  a `lance` get statuses ONLY. LIGHTNING BUG, CATAPULT, SPIDER QUEEN, FLESH
  MOUND, ROD and LANDSLIDE all changed shape because of it, and FLICKER changed
  shape and then fired nothing at all on the new one.
- **`heavy` and `dark` are free damage on four of the seven shapes.** Both
  multiply damage inside `fireInstruments` for every shape while heavy's cost
  (slower bolts) and dark's cost (the weapon goes silent) are paid in the bullet
  path. Six results on an aura, a field or a strike drop them; `fusefire`
  asserts those are the only two fields any row may drop.
- **Five fusions one-shot their own test bed and reported zero chances on the
  property that makes them distinct.** `collidePlayerBullets` calls `hurt`
  before `applyStatus`, and `applyStatus` returns on `!e.alive`. A fusion
  arrives at ~2.5x a maxed base; there is nothing in the early field it does not
  delete. This is a real finding about OVERKILL rather than about the
  properties — a fusion's statuses are for heavies and bosses — and it is what
  `fusefire`'s durable dummies exist for.
- **The screen called one thing two names.** Screenshotted in a browser: the
  offer card said `INSTRUMENT` where it should have named the tier, and the
  celebration plate announced BOMB as an `EVOLUTION` two seconds after the card
  had called it an `ARRANGEMENT` — because a lattice fires `ability:evolve` (it
  is authored and collectable, so it belongs on the path that records a
  discovery). Both read the `FUSIONS` table through one `TIER_WORD` now.
- **The generic DUET card said nothing about itself.** `stepNote(id, 3)` on a
  synthesised duet returned its second level step — "and again, tighter" —
  while the authored BOMB beside it printed its whole mechanic, purely because
  one has level steps and the other does not. A fused instrument arrives at its
  ceiling and can never be levelled, so "what this rung buys" is not a question
  about it; `stepNote` returns the blurb for anything fused, and a duet's blurb
  is now generated after the damage rescale so it can quote real numbers:
  *"25 dmg x4 every 0.30s · EMBER's delivery carrying BOTH property sets: burn,
  leech. No written arrangement for this pair."*

### Two cuts, stated rather than fudged

**Five source fusions were not ported.** Holy Laser needs two laser
orientations and this engine has one LANCE. Tumor's "enemies die after 40s"
needs a per-body death clock. Elemental takes FOUR inputs and `FusionDef` takes
two. Mosquito Kingdom's recipe is not in the source material. Steel's "+10% per
hit to 300%" is a per-weapon ramp with no state to hold it — TEMPER keeps the
double damage and the halved speed and expresses the ramp on the TARGET
instead, as `vuln`, which changes what carries the escalation but not what the
fight feels like. Time Bomb's delay, Zombie's on-death trigger and Assassin's
facing-dependent backstab are each ported to the nearest thing the engine has,
and each is named in the row.

### Worst case, in objects

`_latticeperf`, 60s per loadout with 24 bodies held: spawn-heavy (MAGGOT,
SPIDER QUEEN, CLUTCH, SFORZANDO) peaks at 38 player bullets of 700 and 13
summons — one over `MAX_SUMMONS`, because `summonsLive` is refreshed once a
frame while `onHit` can fire several times inside one. Splash-heavy (X-RAY,
FLASH, ARMAGEDDON, LANDSLIDE) **saturates `MAX_EFFECTS` at 96**, so some chain
arcs and lance lines are silently not drawn. They carry `dps: 0`, so no damage
is lost — but it is a picture the player is not getting, and it is the one
number in this pass sitting on its cap.

### Gates

Green: tsc, vite build, levelup, mirror (13,420 workbench rows, 0 wrong),
discovery (86 arrangements, all obtainable), wiring, combine, aimcheck,
offerchurn, rulefire, beatlock, propfire, offerpool, deadhunt-ranges (0 of 40
dead level steps), effectsdraw, levelupdraw, openers (96%), **fusefire**.
`builds` divergence 0.72 → **0.88**; `arena` encirclement p90 0.46 → **0.52**.
Known red and untouched: leadfreeze, wellcheck, registercheck, counterpoint,
subcheck, attackfloor, touchcheck, four levelshot assertions.

### What no gate here can say

Whether sixty-three is INTERESTING, or whether the twenty-six `S`-class rows —
distinct only because they deliver differently — read as new weapons rather
than as the same pair with a new silhouette. Every gate was green through two
rejected rosters. What is measurable is that none of the sixty-three is the
merge of its parents, that each one's distinctive property fires in a real run,
and that all 190 pairs produce something.

---

## Ten deliveries from Vampire Survivors — the other half of the source material

The owner: *"items could be further enhanced, more new items are interesting"*,
and earlier, on the reference games, *"shouldnt be that hard to get a lot of
these in, no need to stop at 16 either if you can imagine a very rich item
space"*.

`docs/plan-refactor-3.md` §9a says the two source games contribute DIFFERENT
halves. Ball x Pit's is the property substrate — twenty composable properties
over seven shapes — and that landed in `dadbaad`. **Vampire Survivors' is the
delivery vocabulary**, and it had not been spent at all: "attacks horizontally,
fires in the faced direction, boomerangs, orbits, generates zones, bounces
around, strikes at random, erases everything in sight, freezes in a line,
shields, fires in four fixed directions, zones while moving and strikes when
stopping". Almost none of its weapons carries a status. Its roster is the exact
mirror image of the twenty, which is why the twenty were strong on one axis and
empty on the other.

Ten more bases, taken one-to-one off that list, each row in `weapons.ts` naming
the VS weapon it is: RONDO (Cross), QUADRILLE (Phiera Der Tuphello), OSTINATO
(Shadow Pinion + Santa Water), ANTIPHON (Victory Sword), CODA (Pentagram),
DAMPER (Laurel), CAESURA (Clock Lancet), BACKBEAT (Whip), ALEATORY (Lightning
Ring), CLUSTER (Garlic).

### Six shapes added, four deliberately not

`InstrumentShape`'s standing rule is **"DO NOT ADD A GEOMETRY TO MAKE A WEAPON
DIFFERENT"**, written after fourteen geometries produced "all one idea". It
stands, and it is why these six and not the other eleven. The rule refuses a
geometry added to make a weapon different — a second fan, a third cone, a star
of lances that is a lance with a `count`. Four of the six below do not answer
"where does the hitbox appear" at all; they answer WHEN, and no shape in the
table could:

| shape | the question it answers that the seven cannot |
|---|---|
| `wake` | the condition is the player MOVING — nothing else reads the stick |
| `riposte` | the trigger is the player BEING HIT — everything else is a clock |
| `erase` | no aim, no travel, no target selection, the whole screen at once |
| `guard` | deals nothing, ever, and its activation is a charge that waits |
| `boomerang` | out and BACK, hitting on both passes. `seek` cannot |
| `compass` | four FIXED WORLD AXES. `arc`'s star rotates with the player |

And four added no shape, because the honest thing was to say so: CAESURA is a
`lance` with its damage set to zero, BACKBEAT a static `arc` (which is already
a stroke either side of you), ALEATORY a `strike` (which already lands on a
random body without travelling), CLUSTER an `aura`.

**Two deal no damage at all** — DAMPER and CAESURA, the first draftable weapons
in this game that do not. §0 of the plan is the argument: VS's build space has
SHAPE because Laurel and Clock Lancet are in it, and a roster where every card
is throughput has only one question in it.

### The offer pool: 20 to 30, and the answer is "nothing moved"

`tools/offerpool.mjs` runs three arms now — 30, 20 and 12 draftable — inside
one build, because the question changed. **Designed fusions per run, builder,
at 1,500 runs per arm: 3.55 at 12, 3.57 at 20, 3.58 at 30.** Up 0.4% for this
pass and up 0.9% across both. At 400 runs the same measurement read +2.0%,
which is the AGENTS.md §6 lesson intact: the smaller sample was noise.

Ten more cards cost nothing because fusion results are excluded from the draft
pool outright, and because ten more bases means ten more evolutions and seven
more authored pairs — 103 recipes against 86 — all of them free.

### The delivery axis had no gate, and now has one

`tools/propfire.mjs` gained a DELIVERIES section, on the argument that a
delivery has exactly the failure mode a property has and nothing in the suite
could see it: **a boomerang that never returns still throws bolts, still deals
its outbound damage, and passes `levelup`, `wiring`, `aimcheck`, `mirror` and
`deadhunt-ranges` in full**. `InstrumentStats.bounces` was a declared stat with
no consumer for the life of the table for exactly this reason.

Eight counters over six shapes, each with a denominator, measured at 180s per
delivery:

```
boomerang   776 /  780   99.5%   blades thrown / blades that turned
compass    7068 / 7068  100.0%   bolts fired / bolts that left on a world axis
wake        611 /  858   71.2%   pools asked for / pools laid (the wells cap)
wakestrike   38 /   66   57.6%   stopped activations / strikes that landed
riposte      56 /   56  100.0%   hits taken holding it / answers given
erase       954 /  954  100.0%   bodies on screen / bodies the pulse reached
guard        15 /   15  100.0%   hits arriving with a charge / charges spent
guardrefill  17 /   25   68.0%   refill ticks / charges actually added
```

Ten planted defects, each seen red with its own message and undone by an
inverse edit; the log is at the foot of `propfire.mjs`.

**AND ONE OF THE TEN CAUGHT A VACUOUS ASSERTION IN THE SUBJECT ITSELF.** The
compass check counted a bolt as axis-aligned by comparing its angle against the
local `axis` variable the angle had just been computed from — so planting
`const axis = p.aim + k * (Math.PI / 2)` shifted both sides together, the
weapon silently became an aimed one, and the gate that exists to say so read
100%. It is written against the world now (snap the fired angle to the nearest
90 degrees, measure the residual) and re-planting takes it to 41.3%.

### Two gates were found red AT HEAD, in a detached worktree, before any edit

Neither was on the known-red list.

**`fusefire`, ten rows weaker than their own fallback.** `a4a553a` raised
EMBER's ladder to `burn 12/17/23` — a good density fix — and `fusefire` was not
re-run. BOMB, FROSTFIRE, INFERNO, MAGMA, BRIMSTONE, SUN, FIREWORKS, FALLOUT,
TIMEBOMB and EVENT HORIZON were authored against the old `burn: 14`, so from
that commit onward each carried a WEAKER burn than the generic duet it shadows:
spending two maxed instruments on an authored arrangement bought a worse card
than not having one, and `readyDuets` refuses a pair once a recipe exists, so
the player could not even see the better option. That is precisely the defect
31c8756 wrote the gate to catch — "ALL 63 ROWS WERE WEAKER THAN THEIR OWN
FALLBACK" was the first thing it found. It found it again. All ten raised to 23.

**`combine`, -3%.** "Committing to a fusion build reaches wave 13.9 against
14.3 for a player who ignores fusions". Still red here at **-1%**, and its
LOCKED rate fell 26% to 12% because eight rig items now catalyse three bases
each rather than two.

The one residual `fusefire` failure — `eventhorizon: 'execute' had 9 chances
and fired 0 times` — is a **sample-size artefact in the gate's own harness**,
not a defect: identical at HEAD, and green in BOTH trees at `SECS=180`, where
it reads 11 of 44. At 30% per roll, nine chances misses cleanly 4% of the time.

### Worst case, in objects — measured in a real browser at wave 16

`tools/_look10.mjs`, peak live objects over 9s per weapon, each alone at level
3. Nothing is near a cap and `BulletPool.overflow` is 0 throughout.

```
rondo       8 bullets            quadrille  30 bullets (the most of the ten)
ostinato   14 wells (AT its cap) antiphon   13 novas
coda        7 novas              damper      0 objects of its own
caesura     3 effects            backbeat    6 effects
aleatory   24 effects, 11 novas  cluster    11 novas
```

`MAX_PLAYER_BULLETS` is 700, `MAX_EFFECTS` 96, `MAX_SUMMONS` 12. The two
predicted to be expensive were the screen clear and the four-directions weapon;
the screen clear is the cheapest thing in the roster — it allocates one ring
and applies its damage in place — and the four-directions weapon is the most
expensive, at 30 of 700. **`ostinato` sits ON its cap**: three pools every 0.5s
lying for 3.8s asks for 23 and `pushWell` allows 14, which the gate reports
honestly as 71.2% rather than as a healthy activation count.

### Two things that were invisible and were fixed by looking

DAMPER's charges had no renderer at all. Every other weapon announces itself by
putting something in the world; a `guard` deals no damage, spawns no object and
its entire output is a hit that did not happen — so a charged shield and a
spent one were the same picture. There is a segmented arc around the hull now,
and it took two passes: at 21px the segments closed into a solid ring on top of
the ship's own outline, and in amber they read as three more of the amber
enemies. 27px, a 0.4 gap, and near-white.

RONDO's return was pixel-identical to its outbound pass — the same argument
ACCELERANDO's growth is made on. A blade thickens 1.45x on the turn, hitbox
included, so "it comes back through everything it passed" is something the
player watches rather than a counter in a log.

### Gates

Green: tsc, vite build, levelup, mirror (13,754 workbench rows, 0 wrong),
discovery (103 arrangements, all obtainable), wiring, aimcheck, offerchurn,
rulefire, beatlock, propfire (20 properties + 8 delivery counters), offerpool,
deadhunt-ranges (**0 of 60** dead level steps), effectsdraw, levelupdraw,
`arena` HOLDS. `fusefire` green at `SECS=180`; at its default 45s, one
pre-existing sample-size failure.

**THE COMPARATIVE NUMBERS WERE RE-RUN AT HEAD RATHER THAN READ OFF THE SECTION
ABOVE**, which is AGENTS.md §6's first rule, and it changes one of the four
answers. A detached worktree at `fb3db55` with the same node_modules, same
seeds, same machine:

| gate | HEAD `fb3db55` | this tree |
|---|---|---|
| `builds` divergence | **1.33** | **1.34** |
| `builds` damage spread | 3.5x | 3.5x |
| `arena` encirclement p90 | 0.51 | **0.54** |
| `arena` kills/min (card-0) | 317.3 | **572.6** |
| `openers` weakest share | 88% | **94%** (floor 70) |

Divergence moved by nothing — 1.33 to 1.34 — NOT from the 0.88 recorded two
sections up, which is a stale figure from an earlier tree. The kills/min jump
is the loosest of the five: `card-0` takes whatever is first, so widening the
pool changes what it takes, and three runs is a small sample.
Red at HEAD and left alone: leadfreeze, wellcheck, registercheck, counterpoint,
attackfloor, and `combine` (improved -3% to -1%).

### What no gate here can say

Whether the ten are INTERESTING. Every gate was green through three rejected
rosters. What is measurable is that six of them are deliveries no shape in the
table could express, that each one's distinctive behaviour fires with a printed
denominator, and that thirty draftable cards cost the fusion rate nothing.

What was SEEN, in a real browser at wave 16: CAESURA is the most legible of the
ten by a distance — three long pale lines with frozen bodies stopped in them.
DAMPER, RONDO, OSTINATO and CODA each read as their own thing. **ALEATORY is
the weakest**: it is a `strike`, TIMPANI is a `strike`, and on a still frame
they are rings appearing over there. QUADRILLE's four axes are unmistakable in
motion and nearly invisible in a photograph, which is a real risk for the one
weapon whose whole identity is where the bolts went.

## 2026-09-04 — The run map, and the synth deleted rather than capped

Three reports from play, landed together: "needs a new screenshot in the
readme"; "progression thru the level is unclear where checkpoints are etc";
"the synth sound is really bad i hate it remove that and clean up the music".
Every claim below is MEASURED off haps, a headless run, or a photograph unless
marked HEARD — and nothing was heard.

### The run map (`src/game/runmap.ts`, `renderer.ts`, `world.ts`)

The old left bar counted waves inside ONE boss cycle, with four 4 px act pips
above it; a boss kill printed the same WAVE CLEAR as any wave; the telegraph
had no words; pause and game-over never said how many bosses were down; and a
RETRIED run showed the previous run's last plan for ~3.75 s because `start()`
never reset `plan`. Photographed at 1440x900 before anything moved.

Now: a run bar of `TOTAL_WAVES` segments in `BOSS_COUNT` groups with a diamond
at every boss (`1 2 3 FINAL`, hollow ahead, lit next, breathing while the boss
is on the field, gold once beaten), a two-line stack `WAVE 6 OF 16 / BOSS IN
2` sized in CSS px (9 px floor at every window — the view is zoomed and a
13-view-px numeral was 6.7 CSS px on a phone), the boss HP bar flush to the
top edge with `BOSS 2 OF 4` / `THE FINAL SET` centred under it and its hue
ramp fixed (`lerp(350, 20)` ran through violet and green; a mini at 76% read as
the finale's violet), banners `WAVE n OF 16`, `BOSS WAVE / BOSS a OF 4 · CLEAR
THE ESCORT`, `BOSS a OF 4 / INCOMING` at the telegraph (deferred one update so
it cannot clobber a LEVEL banner — `wiring` stays green), `BOSS a OF 4 DOWN /
ACT a CLEAR · k TO GO · +1 REROLL · +1 BANISH` on the kill (the next WAVE
banner yields to it instead of the interlude growing — two bars was the
measured breakdown-for-a-third-of-the-run defect), roman numerals through
PHASE V, an opener line `16 WAVES · A BOSS EVERY 4TH · THE 4TH IS THE LAST`
derived from the constants, the pause row `ACT a OF 4 · WAVE w OF 16 · b
BOSSES DOWN`, the loss line `· b of 4 bosses down`, and `WAVE w OF 16 · ACT a`
under LEVEL n on the offer. The word CHECKPOINT is not used: the game has no
restart point and a word that promises one is a promise the next death breaks.

Gates: `runmap` (new) drives whole runs and asserts the bar's STRINGS against
the world's public getters — 240,584 frames over two winning runs, 0 segment
retreats, act banner x3 and telegraph x4 per run, 0 double announces, the
retried run's first frame reads WAVE 1 OF 16; twelve breaks seen red, logged in
its header. `effectsdraw` now asserts the bar is drawn by its own inks and
strings (it was silently skipped in the stub and green — the vacuous pass).
`_warpshots` imports the geometry instead of holding a copy; 1280x600 added,
the resume pill un-hidden: all five windows CLEAR. Photographed at 1440x900,
900x700, 1280x600 and 375x812 at every moment listed in the spec.

### The synth (`src/audio/layers.ts`, `director.ts`, `soundfonts.ts`)

Attribution, measured three ways rather than recalled: the chords lane's
three-voice supersaw PAD (116-233 Hz) was the first pitched sound of every run
— bars 2-3, alone, three seeds; its two-voice supersaw COLOUR pair (740-1480
Hz) was the top sustained voice above 500 Hz in the drop once the lead rests;
and bass+chords was 47% of all masking weight, 2620 of its 3265 inside the
pad's own window. Two capping commits (`2524fcb`, `6e6bdc4`) had lowered their
filters and levels and did not answer the complaint. Both are DELETED; the
chords lane is the sawtooth stab. The STUTTER motif (the recorded "pinging
noise", the top high voice of intro bar 5) went an octave down with its
lowpass halved. `colour7`/`colour9` and the `pad`/`colour` soundfont roles went
with them; `LANE_RANGE.pad`/`.colour` and `chord.colour` stay as the
voice-leading window. The intro opens sub -> bass -> stab -> motor -> kick ->
lead; the TUNING UP row reads BASS.

Measured, same code before and after: simultaneous pitched voices mean 12.0 ->
8.0, per-bar peak median 15 -> 11, max 16 -> 12; masking audible weight 874.7
-> 493.9 per bar, bass+chords 3264.7 -> 504.8, 0 of 46 lane pairs heavy (was 1
of 66); chords fader mean 0.42 -> 0.47 (it describes the stab now); the full
32-bar drop capture's 1 kHz octave -38.3 -> -40.0 dBFS and 2 kHz -40.1 ->
-40.8 (the 1 kHz move is the only one past the 1.3 dB floor — the lane was
already 30 dB under the mix); the chords stem soloed: supersaw x128 + sawtooth
x52 -> sawtooth x52, -34.6 -> -48.2 dBFS rms. `harmony` replaces CLUSTER with
NO SUPERSAW (sections x feels x {nova, hush}, 8,100 haps) and NO SUSTAIN (whole
x clip, longest 0.14 bar), both seen red; `opening` counts harmony by
AUDIBILITY (`gain² · fader² > AUDIBLE_FLOOR`, imported) — bass audible 6/8
intro bars, stab 14/24 before the drop, both seen red; `chop`'s negative
control is the sub (its positive control failed under load both runs, so its
hole numbers are not evidence yet); `bosscheck`, red on HEAD for the deleted
Lavender Town treatment, rewritten for the current boss score, four
assertions seen red; `registermap` 3 mapped groups, `harm@lpf` unchanged per
remaining group; `fontlanes` lost the two rows out loud.

Red at HEAD and left alone, stated: `session` (headroom: lead and chords
`full` above max energy 0.80), `faders` (arp range 0.01-0.08 — the arp is
inaudible in play, fader mean 0.03, 100% near zero), `phrasing` (a TypeError in
its own apex arithmetic; reproduced on a HEAD checkout served on :5176).

Scope, stated: in the first 20 s the top high voices AFTER this change are the
lead pulse with its supersaw width (climbing to 1760 Hz under the encirclement
+12 register latch), the stutter square, and the bass reese. The lead is
untouched — four re-voicings on record and its own recorded next step ("a
STAB, not a line"). If the owner still hears "synth" in the opening, that is
the next pass, by name.

### README

Prose corrected to the audited facts (bullet hell on a treadmill; throttle and
warp controls; 3000 wide and unbounded; 30 instruments, 103 arrangements, 8+8
starters; the run's shape; RASP / SORDINO / INTERLUDE; four fonts off, 1.4 s
warp arm) and the screenshot retaken on this tree: wave 6, act 2, warp
latched, 187 alive, the run bar showing the first boss beaten.

### The pivot voicing, owed back to the stab

`tools/arc.mjs` ARRIVAL went red the day the pad was deleted, and a HEAD
checkout served on a spare port proved it was the deletion: 12/12 modulations
announced with the pad (`chords` carrying 11), 10/12 without it (`chords`
carrying 0). An instrumented run named the two: both were pivot bars inside
a BREAKDOWN, where the chords lane rested, the bass at zero, and the motor
spelling neither the dominant's root nor the leading tone. The pad's pivot
voicing — root and major third, "here, and only here" — moves onto the stab:
`stabGuideTones` spells root + leading tone on a pivot chord instead of the
guide tones, and `buildChords` lets the stab play a pivot bar inside a
breakdown, two hits on the one bar that pulls. Measured after: 12/12
announced, `chords` 11, `harmony` green (no supersaw, no sustain, the seventh
still stated in all 88 non-pivot bars). CEILING and REPRISE are red before
and after, identically, and are left alone.

## 2026-09-05 — "Sounds cheapy": a drum machine, space, and a bed that is a sine

The owner, after the pad went: "music still needs to be a lot better, sounds
cheapy — here's some good stuff in here", with four Strudel references
(transcribed in the session scratchpad and summarised in `tools/README.md`).
What they have in common was measured against the score before anything
moved: the score was 98.9% oscillators and noise (capture sources: white 991,
triangle 578, sine 331, sawtooth 285, pulse 283, supersaw 157, sampled bass
28); its loud continuous lanes were DRY (no delay on sub, kick, hats, bass,
stab or motor) under 5/6/8-second rooms at low sends; it had no held harmony;
its kit was one noise generator at 30-34 haps a bar. The references are
sampled drum machines, piano and GM synth fonts, feedback delay and 2-second
rooms on nearly every line, a held dark chord bed, snare AND clap on the
backbeat, off-beat hats, a shaker, four-on-the-floor where the tempo is
straight — and the only raw oscillators in them are a saw bass under 300 Hz
and sine chords under 200 Hz. The owner's rejections on record were of
ORCHESTRAL fonts ("carnival"), struck metal, a clavinet and a bright
supersaw; not of samples, not of held harmony, not of space. Nothing below
was heard; every figure is off haps or an offline render through the real
chain, which can now load fonts and samples (`capture --fonts`).

### The kit is a drum machine (`src/audio/samples.ts`, `kit.ts`, the drum builders)

Nine one-shots from Strudel's drum-machine set — TR-909 kick, snare, clap,
closed and open hat, rim; TR-808 kick and cabasa; a LinnDrum hat — 266,688 B,
fetched from `strudel.b-cdn.net` (CORS `*`, 47 ms a file) with the raw GitHub
mirror second, warmed un-awaited under a 6 s timeout, and NEVER emitted until
every buffer is resident (`kitReady`, a generation the director's
`structureKey` names, exactly the soundfont pattern): a late sample is
dropped twice in superdough and a failed URL is failed forever. Until then,
and offline for good, the oscillator kit plays. Measured in the real page:
all nine resident 238 ms after START warm, ~2.9 s on a cold TLS connection.
Voicing from the references: sd AND cp stacked on every backbeat, rim ghosts,
909 hats on the accents and the off-beat bed (floored at written 0.45 =
reference B's `.gain(.2)` after this project's squared gain curve), the open
hat on the last accent of a bar only, a Linn sixteenth layer and the ratchets
on the fill bar only, an 808 cabasa on every eighth in build/drop/sustain,
random pan on ghosts and sixteenths, and four-on-the-floor back on the
straight feels from intensity 0.5 (the chiptune-canon argument that removed
it is superseded twice on record and by reference B; tombstoned). Drum haps
in the drop: mean 26, max 29 (was 30-34); reference B is 24 at three levels.
`kitcheck` (new): bytes by HEAD, fallback-emits-no-sample-name,
sampled-emits-every-name, fallback and sampled onsets identical, budget ≤ 28
mean; six breaks seen red. `perccheck` re-pointed (three assertions replaced,
stronger). Polyphony peak 49 of 96.

### Space (`kit.ts` ORBIT_ROOM / ORBIT_DELAY, every `.delay` site)

One IR per orbit stays the law; sizes moved once: drums 5 → 2.5 s, harmony
6 → 3 s (low 2, air 8). One feedback-delay node per orbit is the second law
(`superdoughoutput.mjs:53-67` retargets it per hap), so ONE (sync, feedback)
pair per orbit now — drums 1/8·0.30 (reference B's 0.225 s at 135 bpm is an
eighth), low 3/16·0.40, harmony 3/16·0.40 — and the lead's open-section
1/4·0.52 variant and the arp's four per-pod syncs went (they fought on the
harmony node). New sends: the backbeat 0.2, rim ghosts 0.15, the sampled
bass pluck 0.35 (the wub, reese, mid, sub and motor deliberately none: a
delayed LFO smears the part; the clock must not echo), the stab 0.25.
`spacecheck` (new): one pair per orbit, a per-lane delay-coverage table,
one room per orbit; five breaks seen red. `reverbchurn` 0 rebuilds/bar. The
band tables do not move (space is temporal); the WAVs are the evidence.

### The bed (`buildChords`) and the stab

A held harmony is back and it is NOT the pad that was deleted: a SINE dyad
(root + fifth; root + leading tone on a pivot bar, so `arc` ARRIVAL stays
12/12) folded into `LANE_RANGE.pad`, one whole note a bar, `bowed`, lpf 300
static, written 0.32, room 0.5 into the 3 s harmony IR, no delay — only in
intro, build, breakdown and HUSHED, never in the drop or sustain where the
wub owns that window (bass+chords was 47% of masking when the pad sat
there). The owner's own reference is `chord().voicing().s('sine').lpf(200)`.
At the spec's 0.22 it passed every gate and registered in no band; 0.32 is
+3.3 dB and still ~6 dB under the pad's 0.30-of-three-saws. `harmony`'s NO
SUSTAIN became NO SUSTAIN OUTSIDE THE OPEN SECTIONS with OPEN / SOURCE /
DARK (cutoff ≤ 400, gain ≤ 0.35) / DYAD / INTERVAL+CLUSTER / PRESENT
clauses, each seen red. The stab: velocity 1.41 → 1.0, drive 0.65 → 0.3,
lpf 1100-3600 → 800-2200 (register unchanged: `harm@lpf` 4.2× → 2.7×),
per-hit `rand` on decay ±25% and pan ±0.12 (screenshot 1's saw stabs), the
delay above; soloed, its 500 Hz band fell -50.8 → -57.4 dBFS. Rejected:
`gm_epiano1` for the stab (a keyboard stab was the "clavichord" complaint)
and `gm_pad_halo` for the bed (a sine needs no download and IS the reference).

### Read plainly, and what is owed

Above 2 kHz the mix is DARKER than before (0.9% of energy vs 3.8% over 32
bars): the old white-noise grid was 90% of everything above 2 kHz, and the
sampled hats at the reference's level are not. That is the reference's
balance, not a defect, but it is unheard. Red at HEAD and left alone:
`session` (headroom), `faders` (the arp), `opening`'s order assertions (bar
quantisation of `INTRO_ENTRY`), `arc` CEILING/REPRISE. Next, by name: the
lead (untouched; the research's recorded step is "a STAB, not a line").

