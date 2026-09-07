# MusicWars

A bullet hell whose soundtrack is not a file. Every note is decided in the
browser by [Strudel](https://strudel.cc) and arranged live from what is
happening on screen — the weapons you hold are the instruments playing.

**[Play it here.](https://dnzckn.github.io/MusicWars/)** Works on a phone; add it
to your home screen for a full-screen launch.

![MusicWars](docs/img/gameplay.png)

## Controls

The ship never stops — you only steer it.

- **Drag anywhere to fly.** Where you hold your thumb relative to where you
  pressed is the stick: the direction is the heading, the distance is the
  speed, and it keeps steering that way until you let go. Your thumb can rest
  anywhere, and a press that doesn't move does nothing.
- **Pull the lever at the right edge up to WARP** — the stage spawns 50% faster
  until you pull it back down. It is the difficulty dial, mid-run.
- Firing is automatic.

Keyboard: **W**/**S** throttle (hold **W** 1.4 s to warp), **A**/**D** steer,
**Shift** focus, **Space** spends banked level-ups, **P** pauses.

## The run

Eight waves, a boss every second one: three minis, then THE FINAL SET. Enemies
never shoot — they arrive from behind, they are slower than you, and they hurt
you by touching you. Health is one bar of three units, and an ordinary hit costs
half of one while a boss costs a whole one.

Kills drop XP and each level banks a choice of four cards. You hold four
instruments and four rig items, so once the chairs are full the only way to grow
is to fuse what you have — which frees one. **30 instruments** built from
composable properties (burn, freeze, chain, leech, quake and the rest) and **103
authored fusions**; all 435 pairs combine into something, the unauthored ones
inheriting both parents.

Runs are stages on a set list — twelve of them, the same eight waves under more
pressure — each paying points into a shop that unlocks the rest of the roster.
A new save starts with 8 instruments and 8 rig items.

## The music

`src/audio/layers.ts` builds every lane; `src/audio/director.ts` turns game state
into musical state. The simulation never talks to Strudel — it emits events and
publishes a numeric snapshot, and the director reads that.

The bass is the protagonist. A motor pulse keeps the clock, a stab comps the
chord's guide tones, the lead follows you, and the kit plays around them. Enemy
archetypes carry motifs, and how crowded the screen is decides how hard the
track goes. Two things are sampled and both stream at runtime with a synthesised
fallback underneath, so it still plays offline: a nine-piece drum-machine kit
(267 KB on the wire) and a fingered electric bass (9.7 KB).

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
defect got past the previous ones — `capture.mjs` renders the real audio chain
to a WAV, `arena.mjs` plays bot runs and reports density and encirclement.
**Read [`AGENTS.md`](AGENTS.md) first**: it records the traps, and several
"obvious" improvements are documented there as measured failures.

| path | what it is |
|---|---|
| `src/game/weapons.ts` | weapons, properties, fusion recipes |
| `src/game/world.ts` | the simulation |
| `src/core/input.ts` | the drag scheme and the warp lever's intent |
| `src/audio/layers.ts` | every instrument lane |
| `src/audio/director.ts` | game state → musical state |
| `src/render/` | canvas renderer and HUD |
| `tools/` | the verification suite |
| `docs/` | plans, and what each measurement contradicted |

Pushing to `master` rebuilds and republishes the site.
