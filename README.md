# MusicWars

A survivors-like whose soundtrack is not a file. There is no recorded music in
this repository — not one loop, not one bar. Every note is decided in the
browser by [Strudel](https://strudel.cc) and arranged in real time from what is
happening on screen.

Almost all of it is synthesis — oscillators and noise, no recordings. The one
exception is the **bass**, which plays a sampled fingered electric bass
(`gm_electric_bass_finger`) fetched at runtime from
[webaudiofontdata](https://felixroos.github.io/webaudiofontdata/): one file,
9.7 KB gzipped. Nothing waits for it — the game starts on the sawtooth that lane
always used and swaps the instrument in underneath once the samples are decoded,
measured at 0.5 s with a warm connection and 3.3 s cold — and **if the fetch
fails the lane keeps its sawtooth**, so the game works with no network at all.

Six other instruments are mapped and ready in
[`src/audio/soundfonts.ts`](src/audio/soundfonts.ts) and are switched OFF: a
build that put an oboe on the melody and a choir on the harmony was heard and
described as "carnival". The table records what each would be and why; enabling
one is a single line. `node tools/fontcheck.mjs --spectrum` is the measurement.

**The ensemble on stage is the mix.** Each weapon you hold is an instrument
playing its part, each enemy archetype has a motif, and the density of the
screen drives the tension model that decides how hard the track goes.

![MusicWars](docs/img/gameplay.png)

```bash
npm install && npm run dev
```

Then open <http://localhost:5173>. Arrow keys or WASD to move — the band fires
on its own.

---

## The game

A 3000×3000 arena with a follow camera. Enemies never shoot: they hurt you by
touching you, they are slower than you are, and they arrive in the hundreds.
Killing them drops XP; levelling up offers four cards.

**20 base weapons** built from composable properties — burn, freeze, poison,
bleed, chain, slow, pierce, split, execute — and **63 hand-authored
arrangements** made by fusing two of them. Every one of the 190 possible pairs
combines into something; the unauthored ones inherit both parents' properties.

Fusing frees a slot. You hold four weapons and four passives, so the only way to
keep growing is to combine what you already have.

The design owes its shape to Vampire Survivors and Ball x Pit, and the weapon
mechanics are ported from them rather than invented — see
[`docs/plan-refactor-3.md`](docs/plan-refactor-3.md) §9.

## The music

`src/audio/layers.ts` builds every lane; `src/audio/director.ts` turns game
state into musical state. The simulation never talks to Strudel — it emits
events and publishes a numeric snapshot, and the director reads it.

Weapons are lanes in the mix, so a loadout is audible. Some read the transport
back: METRONOME fires only on the downbeat, SYNCOPATION only on the off-beat,
TACET silences a stem to bank a charge.

## Development

```bash
npm run dev        # vite, localhost:5173
npm run build      # typecheck + bundle
npm run verify     # the full gate suite
```

Around 200 verification tools live in `tools/`, most written after a specific
defect got past the previous ones. `tools/capture.mjs` renders the real audio
chain to a WAV; `tools/arena.mjs` plays 20-minute bot runs and reports density,
encirclement and build divergence.

**Read [`AGENTS.md`](AGENTS.md) before changing anything.** It records the traps
— several "obvious" improvements are documented there as measured failures.

## Layout

| path | what it is |
|---|---|
| `src/game/weapons.ts` | weapons, properties, fusion recipes |
| `src/game/world.ts` | the simulation |
| `src/audio/layers.ts` | every instrument lane |
| `src/audio/director.ts` | game state → musical state |
| `src/render/` | canvas renderer and HUD |
| `tools/` | the verification suite |
| `docs/` | plans, research, and what each measurement contradicted |
