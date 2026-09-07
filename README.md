# MusicWars

A bullet hell whose soundtrack is not a file. Every note is decided in the
browser by [Strudel](https://strudel.cc) and arranged in real time from what is
happening on screen — the weapons you hold are the instruments playing.

**[Play it here.](https://dnzckn.github.io/MusicWars/)** Works on a phone; add it
to your home screen for a full-screen launch.

![MusicWars](docs/img/gameplay.png)

## Controls

The ship never stops — you only choose how fast.

- **Hold** to boost, with the mouse button or a finger. **Let go** to cruise.
- **Drag backwards** while holding to brake.
- The cursor's side of the ship — or the finger's — steers.
- Hold the boost **1.4 s to WARP**: the stage spawns 50% faster until you pull
  back. It is the difficulty dial, mid-run.
- Firing is automatic.

Keyboard: **W**/**S** throttle, **A**/**D** steer, **Shift** focus, **Space**
spends banked level-ups, **P** pauses. On a phone those last two are buttons.

## The run

Eight waves, a boss every second one. Three minis, then THE FINAL SET, and
beating it wins. Enemies never shoot: they arrive from behind you, they are
slower than you are, and they hurt you by touching you.

Health is one bar of three units. An ordinary hit costs half a unit, a boss
costs a whole one, so six touches or three from a conductor.

Killing things drops XP, and each level banks a choice of four cards. You hold
four instruments and four rig items, so once the chairs are full the only way to
grow is to fuse what you already have — which frees a chair. **30 instruments**
built from composable properties (burn, freeze, chain, leech, quake and the
rest) and **103 authored arrangements**; all 435 pairs combine into something,
the unauthored ones inheriting both parents.

Runs are stages on a set list — twelve of them, the same eight waves under more
pressure — and each run pays points into a shop that unlocks the rest of the
roster. A new save starts with 8 instruments and 8 rig items.

The design owes its shape to Vampire Survivors and Ball x Pit; see
[`docs/plan-refactor-3.md`](docs/plan-refactor-3.md) §9.

## The music

`src/audio/layers.ts` builds every lane and `src/audio/director.ts` turns game
state into musical state. The simulation never talks to Strudel: it emits events
and publishes a numeric snapshot, and the director reads that.

The bass is the protagonist, a sampled pluck with a wobble under it. A motor
pulse keeps the clock, a stab comps the chord's guide tones, the lead follows
you, and the kit plays around them. Enemy archetypes carry motifs, and how
crowded the screen is decides how hard the track goes.

Two things are sampled, and both stream at runtime with a synthesised fallback
underneath so the game still plays offline: a nine-piece drum-machine kit
(267 KB on the wire) and a fingered electric bass (9.7 KB). Everything else is
oscillators and noise.

Weapons are lanes in the mix, so a loadout is audible. Some read the transport
back: RASP fires only on the off-beat, SORDINO silences two of your own lanes to
bank the damage, INTERLUDE takes the whole band out for two bars.

## Working on it

```bash
npm install
npm run build     # typecheck + bundle
npm run verify    # the gate suite
```

Over 240 verification tools live in `tools/`, most written after a specific
defect got past the previous ones. `tools/capture.mjs` renders the real audio
chain to a WAV; `tools/arena.mjs` plays bot runs and reports density and
encirclement; `tools/builds.mjs` measures whether the card you pick changes the
run.

**Read [`AGENTS.md`](AGENTS.md) before changing anything.** It records the traps
— several "obvious" improvements are documented there as measured failures.

| path | what it is |
|---|---|
| `src/game/weapons.ts` | weapons, properties, fusion recipes |
| `src/game/world.ts` | the simulation |
| `src/audio/layers.ts` | every instrument lane |
| `src/audio/director.ts` | game state → musical state |
| `src/render/` | canvas renderer and HUD |
| `tools/` | the verification suite |
| `docs/` | plans, research, and what each measurement contradicted |

Pushing to `master` rebuilds and republishes the site automatically.
