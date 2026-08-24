# MusicWars

A bullet hell whose soundtrack is not a file. There are no audio assets in this
repository — not one sample, not one loop. Every kick, chord and riser is
synthesised in the browser by [Strudel](https://strudel.cc), arranged in real
time from what is happening on screen.

The premise: **the ensemble on stage is the mix.** Each enemy archetype is an
instrument that plays its part while it is alive, each powerup is a persistent
change to the arrangement, and the density of the screen drives the tension
model that decides how hard the track goes.

```
World ──events──▶ MusicDirector ──ref()/signal()──▶ Strudel ──▶ WebAudio
  │                    ▲
  └──GameSnapshot──────┘
  └──immediate SFX──────────────────────────────────▶ superdough (unquantised)
```

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production bundle
npm run verify    # build, then the headless checks that matter
npm run package   # inline the build into one self-contained HTML file
```

Controls: **WASD/arrows** move, **Z/space** fire, **shift** focus (tighter
spread, +45% damage), **X** bomb, **C** black hole, **P** pause, **−/+/M**
volume. On a touchscreen, drag anywhere to fly and fire; FOCUS/BOMB/WELL are
on-screen. Audio unlocks on the first click or tap.

`tools/README.md` lists every headless check, what it verifies, and — for most
of them — the specific bug that caused it to be written.

## How the music actually works

### The pattern is installed once

`MusicDirector.masterPattern()` is handed to Strudel a single time per run:

```ts
stack(...STEM_IDS.map((id) =>
  ref(() => this.cache[id]).postgain(signal(() => this.levels[id]))))
```

- **`ref(accessor)`** re-reads its accessor on every scheduler query (~20 Hz), so
  swapping what `cache[stem]` points at swaps the music with no re-evaluation
  and no retriggering of notes already sounding.
- **`signal(fn)`** is a continuous value read at query time, so filter openness,
  drive and build progress move every frame without rebuilding anything.
- `postgain`, not `gain`: the stems set their own `gain`, and a second `gain`
  would overwrite it rather than scale it.

Structural changes (which layers exist, how busy the drums are) rebuild the
cached patterns, and only when a compact *structure key* changes — a handful of
times per wave, not once per frame.

### The chord grid lives inside the pattern

Each cached stem is an **eight-bar `cat`**, not a one-bar loop. Strudel's `cat`
advances on its own cycle counter, so the chord progression and the phrase-end
fills stay locked to the transport no matter *when* a rebuild lands. Without
that, a rebuild a few milliseconds either side of a bar line could repeat or
skip a chord — an intermittent, subtle, miserable bug.

### Tension: two channels, not one

`audio/tension.ts` reduces the game state to two scalars:

| term | weight | reads | why |
|---|---|---|---|
| crowding | .22 | notes inside 110px / 52px of the player | felt pressure, not raw count |
| imminence | .17 | time-to-closest-approach of *converging* notes | a wall moving away is not scary |
| fragility | .12 | hits remaining across all lives | last life at full HP is still desperate |
| flow | .13 | graze rate and multiplier | playing well is intensity too |
| momentum | .11 | kills per second | winning loudly should sound like it |
| density | .10 | total notes on screen | visual noise floor |
| threat | .08 | live enemies and their remaining HP | how much work is left |
| boss | .07 | phase index and boss HP | a floor the music may not drop below |

`flow` and `momentum` are together worth a quarter of the total, and that is
deliberate. Danger used to be nearly the whole story, which had an unfortunate
consequence: making the game fairer made the music duller, because a player who
was no longer drowning never pushed the arrangement past its middle. Intensity
and danger are related, but they are not the same axis, and tracking only the
second one makes a competent player's soundtrack worse the better they get.

Smoothing is **asymmetric** — fear arrives faster than relief. Tension rises with
a 0.45 s half-life and falls with a 2.6 s one; a symmetric filter makes the track
twitch on every near miss. A separate fast channel drives one-shot gestures.

### Vertical layering: curves, not switches

Eleven stems, each with a **gain curve** rather than an on/off threshold — `in`
where it becomes audible, `full` where it reaches its ceiling, smoothstepped
between.

This started as a threshold per stem and that was the worst thing about the
mix: every layer was either silent or at full, so as soon as tension crossed a
line the whole arrangement slammed to 100% and stayed there. Measured uptime was
kick 94%, hats 89%, bass 86% — a track with no dynamic range is not dynamic
music, however cleverly it was assembled. `npm run smoke` now reports average
stem levels and fails if any tension-driven stem sits above 0.9 for more than
60% of a run.

### Composition, not just arrangement

Getting the *plumbing* right produced a track that was still not good: measured
spectral balance put 45–50% of all energy below 250Hz with the melody averaging
0.13, which is a thumping loop with nothing to listen to on top of it. Fixing
that took musical decisions, not engineering ones.

**Motivic development.** A theme is a small cell — eight eighth-note slots, most
of them rests. Each eight-bar phrase puts it through a classical transformation:
transposition, inversion, retrograde, augmentation, fragmentation, rhythmic
displacement. The statement is left alone for the first two phrases, because you
cannot develop a theme nobody has heard yet. Ten phrases later the tune is
recognisably the same tune and recognisably not identical. Beethoven for the
technique, the Grateful Dead for never playing it the same way twice.

**A pad, not just stabs.** There was previously nothing sustaining anywhere, so
between kick hits there was silence and the track read as percussion with
decoration. The pad is the bed everything sits on — low-passed to 2.6kHz,
drenched in room, three unison voices rather than five because the extra saws
are inaudible under that filter and cost real polyphony.

**Grooves.** Each wave gets a feel and the run moves between them, so a long
session is a set rather than a loop. Four-to-the-floor is home base; `trap` is
half-time with hat rolls and a gliding 808 (Lil Uzi, Post Malone); `swing` is
shuffled eighths over lush extended voicings (Sinatra); `gallop` is the
palm-muted da-da-dum, at home in phrygian (Metallica). Boss waves always gallop,
because a boss should announce itself with a different rhythm before you have
finished reading the screen.

**Mix balance.** Ceilings were inverted so the music is the loudest thing and the
drums keep time underneath it: chords and lead average 0.76 and 0.68, sub and
hats 0.42 and 0.40. The kick was a hard-dance kick (pitch envelope to 48
semitones, distortion to 14) and is now a kick (20–30, 1.1–3.3). Hats got a
low-pass, because unbounded white noise through a high-pass is the single most
fatiguing thing you can put in a mix.

Measured before → after: **sub+low 45–50% → 19–22%**, **mid 12% → 28–35%**,
crest factor **14dB → 19–21dB**. `npm run audiocheck` reports spectral balance
per band and fails if more than 26% of energy lands in the 2.5–6kHz fatigue band
or the crest factor drops under 9dB.

### Health is audible

Damage is not only a HUD number. As hits are spent:

- the **low end is pulled out** — sub, bass and kick scale by `0.44 + 0.56 × health`
- a **rising high-pass** thins the chords, arp and lead (`sig.thin`)
- under 34% health a **sub heartbeat** enters, doubling in rate as it gets worse
- each hit fires a **concussion**: the master filter slams shut and everything
  ducks for about a second

A badly hurt run sounds thin and brittle without anyone reading a number.

### Horizontal re-sequencing

`audio/arrangement.ts` runs intro → build → drop → sustain → breakdown →
collapse, changing only on bar lines and the big moves only on phrase lines.

The one thing worth being fussy about: when a boss is telegraphed, the world
reports how many seconds away it is, and `scheduleDrop()` sizes the build so the
**drop lands on the exact bar the boss starts firing**.

### Everything is synthesised

Strudel ships no samples and loads none at boot, so `s("bd")` throws. Every drum
in `audio/kit.ts` is built from oscillators and noise — a sine with a steep
downward pitch envelope for the kick, band-passed noise for the clap, high-passed
noise for the hats. The game therefore has no audio assets and works offline, and
every drum is *parameterised*: the kick's pitch drop and saturation are a
continuous function of how much trouble the player is in.

Sidechain is real: the kick uses superdough's native `duckorbit` against the
orbits that are actually playing.

### Two clocks, deliberately

Quantised music goes through Strudel's scheduler (~200 ms lookahead). Gameplay
SFX skip it entirely and call `superdough()` with an absolute AudioContext time,
landing around 30 ms. A pickup that waits for the next downbeat feels broken; a
chord change that does not wait sounds broken. They need different clocks.

The loop closes in the other direction too: enemy emitters are scheduled in
**beats**, not seconds, so volleys stay on the grid as the director changes tempo.

## The ensemble

| enemy | shape | plays |
|---|---|---|
| Pluck | guitar pick | offbeat plucked stab |
| Stutter | hi-hat | sixteenth-note cluster, density scales with swarm size |
| Arp | sequencer wheel | alternating fifths |
| Gliss | slur | delayed sliding line |
| Subdrop | speaker cone | distorted low brass hit |
| Conductor | podium + baton | tritone pedal under everything |

At most three motifs sound at once, by priority. Without the cap a swarm wave
turns the mix to mud and the information the motifs carry is lost, which defeats
the point of having them.

Powerups mostly modify existing stems rather than adding bleeps, so the loadout
is something you hear woven through the track rather than announced:

| powerup | does | sounds like |
|---|---|---|
| **Overdrive** | fire rate ×0.45, +2 shots, ×1.5 damage, 8s | **forces a drop** — every driver to its top rung |
| **Drones** | 2–4 orbiting pods that shoot *and* each eat one bullet | the arp splits into hard-panned satellites on different delay divisions |
| **Nova** | expanding ring on the beat that deletes bullets | a wide room clap on the pulse; harmony floors at add9 |
| **Magnet** | pulls every drop from anywhere, ×1.6 drop rate | the bass filter envelope inverts into a vacuum |
| **Timewarp** | enemy fire, travel and movement all ×0.45 | half-time — at exactly the same tempo |
| **Encore** | the game *sends* it when you are nearly dead | a breakdown and a scheduled rebuild, just for you |
| Rapid / Spread / Homing / Laser | as expected | hats double · supersaws widen · arp grows a delay tail · lead holds |

Two of these exist specifically because the game was too hard. **Overdrive**
hands the player the engine's best trick — the drop is normally something the
game schedules for a boss, and this puts it on a pickup, so maximum power and
maximum music become the same moment. **Encore** is not found, it is sent: once
per wave, when a run is nearly over, so a bad patch is recoverable instead of
terminal.

### The game is locked to the music, literally

Everything on the field runs off the transport's absolute beat position:

- **Enemy volleys** are scheduled in beats, not seconds. 98% land on a
  subdivision. They were at 49% until emitters stopped accumulating their own
  beat count from `bpm * dt` — that drifted from the transport on every
  audio-clock correction and every frame of hitstop.
- **Wave spawns** snap to the next bar line, so groups arrive on a downbeat.
- **Boss phases** arm on an HP threshold and commit on the next bar.
- **Stutters hop** on every eighth note instead of gliding.
- **Volleys are telegraphed** by a ring contracting over the half-beat before
  they fire — so every armed enemy on screen pulses together, on the beat.
- **Nova** pulses on the grid, so surviving becomes "hold on until the next beat".
- **Every shot is a note**: each archetype fires a fixed scale degree in a fixed
  register, so a screen of enemies firing makes a chord rather than a clatter.
  Your own weapon walks up the current chord as you hold fire.

### Geometry Wars, borrowed from

- **The warping grid.** A lattice on springs, shoved by explosions, the player's
  wake and a breath on every beat. The beat impulse is small and explosions are
  large, so the grid reads as keeping time until something happens to it.
- **Notes** (Geometry Wars' geoms). Kills drop collectible shards that build an
  uncapped multiplier. They are the reason to move *toward* the danger you just
  created, and they feed the `flow` term — so chasing them literally makes the
  music go harder.
- **Additive bloom**, quarter-res, blurred at low resolution and composited with
  `lighter`.
- **The colour contract**: everything that can hurt you is warm, everything
  friendly is cool. Enemy fire is red through magenta; player fire is cyan;
  collectibles are green.
- **Extends** at score thresholds, and the forgiveness contract that the player
  outruns everything on screen (400 px/s against 210–300 px/s aimed fire).

## What a run looks like

An eight-bar intro assembles the track from silence — harmony first, then the
melody stating its theme, then the drums — while the first enemies arrive over
its final bars. Each wave has a **groove** (four-to-the-floor, half-time trap,
gallop, shuffle) that also sets the playfield's palette, so a trap wave is a
violet room and a gallop wave an amber one. Every archetype names itself and its
motif the first time you meet it.

Clearing a wave is **graded** — flawless clears resolve upward and brighten the
mode for a wave or two; a mauling resolves down and darkens it. Bosses alternate
between a rotation problem (gapped rings you orbit) and a timing problem
(telegraphed walls you thread), and their phase changes land on downbeats.

Difficulty ramps to a ceiling around wave 17 and then keeps *escalating* the
stage — more groups, larger, closer together — while the dark modes rotate
rather than parking on one. Dying collapses the track rather than stopping it,
and the run summary reads back what you played: keys visited, grooves heard,
the section and energy it peaked at.

## Layout

```
src/core/      loop, transport, events, input, math, rng   (no game, no audio)
src/game/      simulation: bullets, enemies, waves, collision, powerups
src/audio/     engine boot, theory, tension, arrangement, layers, kit, director
src/render/    canvas renderer, pre-rendered note sprites, DOM HUD
src/types/     hand-written Strudel type surface
tools/         headless verification
```

The simulation never imports Strudel and the director never imports the
simulation's internals. They meet at `GameSnapshot` and `EventBus`, which is the
only reason either half is testable.

## Notes for anyone extending this

Things that cost real time to find, so they are also commented at the call site:

- `initAudio()` does **not** resume the AudioContext. Its guard reads
  `(!audioCtx) instanceof OfflineAudioContext`, which is always `false`, so the
  branch is dead. Without an explicit `resume()` you get total silence, no error.
- `initAudioOnFirstClick()` binds `mousedown` only — useless for a keyboard-first
  title screen.
- Never pass `sync: true`: it selects a SharedWorker clock whose worker file Vite
  inlines as a `data:` URL, which Chrome rejects.
- Mini-notation in plain TypeScript needs `miniAllStrings()`.
- Values passed **directly** to `superdough()` skip the control layer that
  expands mini-arrays, so `distort: "2:0.5"` becomes a non-finite AudioParam and
  throws from inside a worklet constructor, nowhere near the call site. Use
  `{ distort: 2, distortvol: 0.5 }`. `audio/probe.ts` exists to catch this class
  of bug by name instead of by bisect.
- `AudioContext.resume()` must be *called* synchronously inside the user
  gesture. The first `await` spends the token, and Safari silently refuses the
  resume afterwards — total silence, no error. Only the promise may be awaited
  later.
- `repl.stop()` resets Cyclist's cycle counters. Using it for a player pause
  rewinds the transport (measured: four bars) and re-fires beat-scheduled
  volleys. Use `repl.pause()`.
- `distort` builds a waveshaper curve from its control value, so `distort(0)`
  is **silence** and `distort(0.19)` is -14.5dB. Never range it from zero; 1.0
  is roughly unity. This silenced the bassline for most of the project.
- Any boolean derived from a continuous value needs hysteresis — see `Latch` in
  `core/math.ts`. Without it the melody's octave flipped 14 times in 18 seconds
  with the ship parked mid-field.
- `@strudel/core` statically imports from `@kabelsalat/web`, whose `main` entry
  has no named ESM exports — it works under Vite (which prefers `module`) and
  fails under plain Node. Do not try to unit-test the repl outside a bundler.
- Rebuilding all eleven stems in one frame cost ~29ms — two dropped frames, about
  once a second. They are now rebuilt two per frame, loudest first. This is safe
  precisely because `ref` reads each stem's cache independently and every stem is
  cycle-aligned to the same chord grid, so a few frames of mixed revision is
  inaudible.
