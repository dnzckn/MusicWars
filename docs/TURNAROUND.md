# TURNAROUND

The governing plan for the post-launch overhaul. Launch feedback named four
things: the music is not great, the item mechanics are nowhere near Vampire
Survivors or Ball x Pit, the arena is too small, and the game does not feel
snappy.

This document follows the house style of `docs/MASTER_PLAN.md`: §9 is an
append-only changelog, and every claim is marked MEASURED or HYPOTHESIS. Read
`AGENTS.md` before touching anything — several obvious improvements are already
recorded there as measured failures.

---

## 0. The machine changed, and it changes the strategy

`AGENTS.md` §7 describes a Linux box with a failing disk where **no browser
could be launched**, and concludes that node-only tools "are the whole
verification surface in this state." That is no longer true.

This checkout is on **Windows 11, Node v22.17.0**. Two things follow.

**The disk-failure section does not apply.** There is no `storvsc` read-retry
storm; `tools/lib/chromepath.mjs` and its whole rationale are about hardware
that is not this hardware. The four damaged Chromium builds it works around do
not exist here.

**Therefore the browser gates may run, and if they do the project can HEAR
ITSELF for the first time in its recorded history.** `AGENTS.md` is emphatic
that `tools/render.mjs` must never be used to judge sound — its oscillators are
not superdough's, there is no reverb or delay, the filters are one-pole — and
that the only listening artefact is the browser capture recorder. Every audio
change in the changelog was therefore verified *at the hap level* and never
actually heard. "Music is not great" is exactly the complaint you would expect
from a codebase that has been composing blind.

**Restoring audition is the highest-leverage single action available**, because
it converts the entire music workstream from argument into measurement. It is
tracked as Track M0 and blocks nothing else, so it runs first and in parallel.

### 0.1 The checkout had no dependencies installed — MEASURED

`node_modules/` did not exist. This produced a cascade of misleading signals
that cost real time and is worth recording so it is not re-diagnosed:

- `node node_modules/typescript/bin/tsc --noEmit` printed `MODULE_NOT_FOUND`.
  Piping it into `head` and reading `$?` reports **head's** exit status, which
  is 0 — so the typecheck looked green while never having run at all. Check the
  exit code of the process you care about, not of the pipeline.
- `verify-node` reported **29 FAILED**, every one of them in 0.1s. A suite where
  every failure takes the same suspiciously small time is crashing on startup,
  not failing assertions. `tools/levelup.mjs` passed cleanly when invoked
  directly on the same commit.

Two genuine cross-platform defects were flushed out underneath that and are
fixed in this branch (§1). The rest was the missing install.

---

## 1. Landed: the verification suite runs on Windows

Both defects were systemic rather than incidental, and both are the kind
`AGENTS.md` §3 warns about — a gate that cannot run is strictly worse than no
gate, because a red suite that is red for environmental reasons trains everyone
to ignore it.

**`new URL(x, import.meta.url).pathname` is wrong on Windows.** It yields
`/E:/GitHub/MusicWars/src/` — a leading slash in front of the drive letter —
which then composes into paths like `E:\E:\GitHub\MusicWars\index.html`. That
exact doubled drive letter is what `domwiring` reported. **17 tools** carried
the defective idiom; 10 others already used the correct
`fileURLToPath(new URL(...))`, so the codebase disagreed with itself. All 17 are
converted.

**`verify-node.mjs` spawned `sh` explicitly.** `spawn('sh', ['-c', cmd])` has no
meaning on a stock Windows box. It now uses `shell: true`, which resolves to
cmd.exe or sh per platform, and injects
`NODE_OPTIONS=--experimental-transform-types` so a check runs whether or not its
own npm script spells the flag out. That flag disagreement is real: Node 23.6+
strips types with no flag and 22.x requires it, and the scripts in
`package.json` are inconsistent about carrying it — `discovery` has it,
`levelup` does not.

Neither fix changes any game or audio behaviour. Both are pure tooling.

---

## 2. The four workstreams

| Track | Complaint | Root cause (as far as established) | Status |
|---|---|---|---|
| **M** | Music is not great | Composed blind — never auditioned. Suspected: no long-form structure, mix too dense, bass lowpassed twice | M0 landed / diagnosis in flight |
| **I** | Item mechanics | Zero-sum four-card offer, 12×12 rig, ~1.6 fusions per run | diagnosis in flight |
| **A** | Arena too small | `PLAYFIELD_W/H = 900×1120` fixed, single screen, **no follow camera** | diagnosis in flight |
| **S** | Not snappy | Unknown; feedback-channel matrix being built | diagnosis in flight |

### Track A: the finding that makes it tractable

`src/game/camera.ts` implements screenshake, hitstop and flash — and **no
translation whatsoever**. The world is exactly one screen, 900×1120, and it is a
shmup's portrait aspect ratio rather than a survivor arena's square or
landscape. `world.ts:87` already concedes this in a comment: *"DELIBERATELY
UNCHANGED BY THE ARENA CONVERSION, and this is the wrong shape."*

The encouraging half: `src/render/renderer.ts:383-387` already funnels every
draw through a single `setTransform(scale) → translate(camera.x, camera.y)`
choke point. A follow camera is an addition at one site, not a rewrite of the
renderer. The cost is in the things that assume world-space equals screen-space
— spawning, culling, and the `e.x / this.width` normalisation that feeds the
audio pan.

That comment also names the blast radius for the constant itself: the number
lives in `src/style.css` as a hardcoded `aspect-ratio: 900 / 1120` and in the
two canvas elements in `index.html`, and moving it once silently broke
`tools/contrast.mjs`, which kept its own copy.

---

## 9. Changelog

### The suite runs on Windows

17 tools converted from `.pathname` to `fileURLToPath`; `verify-node` made
cross-platform. Baseline before dependencies were installed: 29 failing, all in
0.1s, all crashes. This entry will be updated with the real post-install
baseline, which is the first honest number this branch has.
