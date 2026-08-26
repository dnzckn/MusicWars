# Blast radius: large scrolling world + follow camera

> **STAGES 0-6 HAVE LANDED. This document is the plan, not the record.**
>
> Option (A) was taken and the field is 3000x3000 with a follow camera showing
> 900x1120. What actually happened — including the three places the plan below
> was wrong — is in `docs/TURNAROUND.md` §9, "Track A: the arena is 3000x3000
> and the camera follows". The short version of the corrections:
>
> - §4 predicted that camera-relative enemy culling would make `escaped` fire
>   for live enemies. It does, and by enough to matter: escapes per wave went
>   55% ABOVE the one-screen baseline and the screen got emptier. Enemy culling
>   deliberately stayed on the field. Bullets, drops and the wall rectangle all
>   moved to the view, and that half was necessary rather than optional — on the
>   field, player bolts killed things off screen whose shards were then
>   unreachable, which cost 12% of the level pacing.
> - §8(A) says the wall-bounce rectangle "keeps working by construction". It
>   survives, but only because it was moved to the view: on an 11x field a
>   bounce off the field edge is one the player cannot see, which is the
>   condition `world.ts` says the rectangle exists to satisfy.
> - Stage 6's gate — run each repaired tool with `VIEW_W` 20% off and confirm it
>   moves — caught something real about itself. `levelupdraw` and `effectsdraw`
>   import the constant and were still byte-identical at 900 and 1080, because
>   their verdicts are size-invariant by design. They print the geometry now.
>
> The density question §7b and `research-density.md` both worry about was
> measured and came out well: encirclement p90 is 0.32 before and after.

Research only. No code was changed. Everything below carries a `file:line` that
was read out of this tree at commit `35f5cb0`; nothing here is recalled.

**What was verified:** `node node_modules/typescript/bin/tsc --noEmit` is green
on the tree as read (exit 0), so the line numbers below are against a compiling
baseline. **What was NOT verified:** nothing in this document has been run,
rendered, measured or heard. Every performance figure is arithmetic on constants
read from source, and every balance claim is a prediction. This machine is
win32, so AGENTS §7's `storvsc` probe does not apply; the browser gates were not
attempted either way.

---

## 0. The one-paragraph version

The world/screen coupling is **much shallower than it looks**, and that is the
finding. There are only four `PLAYFIELD_W/H` references in the whole repo
(`world.ts:105,106,274,275`); everything else goes through `world.width` /
`world.height`, and there are only 34 `this.width`/`this.height` sites in `src`
(29 in `world.ts`, 5 in `grid.ts`). A camera translate hook **already exists**
at `renderer.ts:387` and `renderer.ts:434` — screenshake is applied as
`g.translate(w.camera.x, w.camera.y)` inside a `save`/`restore` around every
world-space draw. The hard part is not plumbing. The hard part is that six
systems are defined *as functions of the rectangle* rather than as functions of
distance, and one audio signal silently changes meaning.

---

## 1. The seam that already exists (use it)

```
renderer.ts:381   g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
renderer.ts:382   this.drawBackground(g, dt, tension);      // OUTSIDE the camera
renderer.ts:386   g.save();
renderer.ts:387   g.translate(w.camera.x, w.camera.y);      // <-- the hook
                  ... grid, drops, enemies, notes, particles, novas,
                      effects, bullets, player, drones ...
renderer.ts:429   g.restore();
renderer.ts:433   g.save();
renderer.ts:434   g.translate(w.camera.x, w.camera.y);      // <-- second hook (popups)
renderer.ts:437   g.restore();
renderer.ts:438   this.drawOverlay(...)                     // OUTSIDE the camera
```

Everything inside those two blocks is already in world coordinates and needs
**zero** change. Everything outside them is already effectively screen-space and
is drawn against `w.width`/`w.height` purely because today those two numbers are
also the viewport.

**So the whole conversion is one rename plus one new number.** Split the single
concept into two:

- `PLAYFIELD_W/H` — simulation extent. Grows.
- `VIEW_W/VIEW_H` — what the canvas shows. Stays at today's 900×1120.

Then `camera.x/y` stops being a pure shake offset and becomes
`-(viewX) + shakeX`. Both call sites are unchanged.

`sprites.ts` needs **no change at all** — sizes are derived from bullet radius
and length (`sprites.ts:48,66,80,116,146`), never from the field.

`hud.ts` needs **no change at all** — it is DOM, percentage widths and text. The
only field reference is a prose comment at `hud.ts:376` about letterboxing.

`audio/director.ts` needs **no change at all** — it reads `nearestThreat`,
`encirclement`, `facing` from the snapshot and never touches a raw coordinate.
The only match for a field concept is a comment at `director.ts:913`.

---

## 2. Rendering

| Site | What it assumes | Under a camera |
|---|---|---|
| `renderer.ts:344` | `scale = clamp(cssH*dpr / w.height)` | must be `VIEW_H`. Comment at `renderer.ts:337-343` warns this only works because `style.css:124` carries `aspect-ratio: 900 / 1120` — that CSS rule now describes the VIEW, not the world |
| `renderer.ts:346-347` | backing store = `w.width × scale` | must be `VIEW_W × scale`, else the canvas bitmap grows with the world (3× linear = 9× pixels) |
| `renderer.ts:181` | `new WarpGrid(world.width, world.height)` | **the biggest single cost.** See §2a |
| `renderer.ts:184-185` | bloom canvas = `world/4` | must be `VIEW/4` |
| `renderer.ts:188-191` | 140 stars scattered over the world | must become view-space parallax |
| `renderer.ts:486` | `bg.drawImage(g.canvas, 0,0, bloom.w, bloom.h)` | downsamples the whole canvas; correct once the canvas is the view |
| `renderer.ts:495` | `g.drawImage(this.bloom, 0,0, w.width, w.height)` | → `VIEW_W/VIEW_H` |
| `renderer.ts:500-502` | `fillRect(0,0,w.width,w.height)` background | → view rect |
| `renderer.ts:508-513` | starfield wraps at `w.height`, respawns at `Math.random()*w.width` | → view rect. **Opportunity:** with a follow camera this can become genuine parallax (`s.x - camera.viewX * s.z`), which is free scrolling feedback and answers "the map feels small" directly |
| `renderer.ts:523-528` | horizon gradient at `w.height*0.55` | screen-space furniture; → `VIEW_H` |
| `renderer.ts:1239-1291` | `drawBanner` — `y = w.height*0.34`, rules at `w.width*0.18/0.82`, text at `w.width/2` | screen-space; → `VIEW_*` |
| `renderer.ts:1301` | `clearRect(0,0,w.width,w.height)` on the overlay | → view |
| `renderer.ts:1307-1315` | boss bar `w.width - 80` | → `VIEW_W` |
| `renderer.ts:1322` | flash `fillRect(0,0,w.width,w.height)` | → view |
| `renderer.ts:1329-1343` | vignette centred `w.width/2, w.height/2`, radii from `w.height` | → view centre. Cached per 5% tension step (`renderer.ts:1327`), so it must be invalidated if the view can resize |
| `renderer.ts:1354` | `levelUp.draw(g, snap, dt, w.width, w.height, ...)` | → `VIEW_W/VIEW_H`. This is the twin of the hit test in §6 — they must move together or the cards draw in one place and test in another |
| `renderer.ts:1378-1384` | XP bar `w.width * frac` | → `VIEW_W` |

### 2a. `grid.ts` is the performance cliff

`WarpGrid` materialises the **entire field** as flat arrays and integrates every
point every frame with **no viewport culling**:

- `grid.ts:85-86` — `cols = floor(width/62)+1`, `rows = floor(height/62)+1`
- `grid.ts:88-93` — six `Float32Array`s of `cols*rows`
- `grid.ts:152-180` — `update()` loops all `count` points, sub-stepping ×2 on a long frame
- `grid.ts:186-240` — `draw()` builds two batched paths over all points, then a second stress pass over all edges

At 900×1120: 15 × 19 = **285 points**. At 3× linear (2700×3360): 44 × 55 =
**2420 points**, 8.5× the integration and stroke cost, of which ~88% is off
screen. The file's own header (`grid.ts:15-16`) budgets "~290 points". This is
the one place where "just make the world bigger" is not free.

Fix: allocate the lattice at `VIEW` size plus one cell of bleed, and scroll the
home positions with the camera snapped to `SPACING` so points do not pop. That
also fixes `grid.ts:146-150` `breathe()`, which currently centres on the *field*
centre — in a big world the beat breath would happen somewhere the player cannot
see.

---

## 3. Spawning

| Site | Today | Needed |
|---|---|---|
| `waves.ts:369-375` | `edgePoint(angle, width, height, margin)` casts a ray from `width/2, height/2` and intersects the **world rectangle** | needs a centre `(cx, cy)` and a ring extent. The rectangle choice is deliberate and documented (`waves.ts:361-367`: a circular ring in a 900×1120 field puts diagonal spawns 200px inside the arena) — keep the rectangle, just make it the *view* rectangle around the camera |
| `waves.ts:406-460` | `arenaSpawnPositions(formation, count, width, height, baseAngle, margin)` | same: pass view dims + centre |
| `world.ts:2022-2028` | `spawnGroup` calls it with `this.width, this.height` | pass camera centre + `VIEW_W/VIEW_H` |
| `world.ts:2122-2127` | `flank` re-derives the opposite half with the same world dims | same change, twice |
| `world.ts:1687` | `spawnBoss(this.width / 2, -120, ...)` — literally "off the top of the screen" | must become a point on the ring around the camera. `-120` is the `y: -40` convention that `waves.ts:468-475` says survives only for this call site |
| `enemies.ts:883` | `e.homeX = width / 2` inside `spawnBoss` | boss home is the world centre |
| `enemies.ts:305-316` | `bossMove` orbits `ctx.width/2, ctx.height/2` at `min(ctx.width, ctx.height) * 0.17` | in a 3× world that is a **1.4-screen-radius orbit around a point the player may be nowhere near**. The boss must orbit a stored anchor captured when it spawns, and the radius must come from `VIEW`, not the field |
| `world.ts:823-824` | `context()` publishes `width/height` into `EnemyContext` (`enemies.ts:14-24`) | every mover reads this; it should carry `viewW/viewH` + `camX/camY`, or the two movers above should stop reading it |
| `world.ts:751-752`, `2652-2653` | wave-gift and encore drops clamped to `60 … this.width-60` | harmless in a bigger world, meaningless in an unbounded one |
| `world.ts:3735-3736`, `3762-3763` | black-hole / effect placement clamped to `60 … this.width-60` | same |
| `world.ts:1186-1189` | retreat vector: `e.x - this.width/2`, `e.y - this.height/2` — "leave by the nearest edge" heads radially out from the **world centre** | in a big world an enemy on the far side of the player flies *toward* the player to leave. Must be `e - player` (or `e - camera centre`) |

`emitters.ts` was checked and holds **no** field references — emitters are
scheduled in beats and spawn relative to `(e.x, e.y)`. Nothing to do.

The escape-corridor design survives untouched: `gapAngle` / `rollGap`
(`world.ts:1988-1990`) / `spawnBearing` (`world.ts:1999-2011`) /
`ENCIRCLE_GAP_HALF` (`world.ts:152-164`) are all pure angles. They are the
strongest argument for keeping a spawn *ring* rather than a spawn *edge*, which
both options preserve.

---

## 4. Culling

| Site | Today |
|---|---|
| `world.ts:1015` | `enemyBullets.update(dt*scale, -60, -60, this.width+60, this.height+60)` |
| `world.ts:1038-1043` | `playerBullets.update(dt, -60,-60, this.width+60, this.height+60, { l:0, t:0, r:this.width, b:this.height })` |
| `world.ts:1243-1250` | enemies culled at `±CULL_MARGIN` (320) outside the world rect |
| `world.ts:3802-3804` | `hasEntered(e)` = inside the world rect ±30 |
| `powerups.ts:263` | `if (d.y > height + 40) d.alive = false` — drops die past the bottom |
| `world.ts:2608` | `if (e.y < -10) continue` in `collidePlayer` — a top-of-screen relic, documented as such at `world.ts:2593-2607` |

Two things are load-bearing here and are easy to break.

**The wall rectangle is a feature, not a bound.** `world.ts:1024-1036` spells it
out: the `walls` argument is the **only** consumer of `InstrumentStats.bounces`,
and that stat was declared, folded through `applyModifiers`, raised three times
across ECHO CHAMBER's ladder, set by SPICCATO and CANON — and read by nothing at
all until this rectangle was added. Removing walls silently re-kills it. The
comment even names the distinction: "a bounce has to land on the wall the player
can see", and the wall rect (`0,0,width,height`) is deliberately *not* the cull
rect (`±60`).

**Cull margin is tuned against spawn margin.** `CULL_MARGIN = 320` is 4.5×
`SPAWN_MARGIN = 70`, with a written reason (`world.ts:114-121`, `1237-1242`): a
tight margin deletes a rush during the telegraph it spends outside the field.
If culling moves to camera bounds, that ratio has to be re-derived against the
*view*, and `escaped` starts firing for enemies that are alive and well behind
the player. That matters because wave completion is
`done && this.enemies.length === 0` (`world.ts:1662`) — a wave cannot end until
everything is dead or escaped.

`hasEntered` is used in two places with different intents:
`world.ts:1199` (may this enemy start firing?) and `world.ts:3170` (does this
enemy close the ring?). Both want "on screen", not "in the world", the moment
the two differ.

---

## 5. Normalized coordinates leaking into audio

**This is the subtlest breakage in the list and it is a repeat offence.**

```
world.ts:1226   this.bus.emit('enemy:fire', { archetype: e.archetype, x: e.x / this.width });
events.ts:161   'enemy:fire': { archetype: EnemyArchetype; x: number };
main.ts:346-348 world.bus.on('enemy:fire', (e) => sfxEnemyFire(..., e.x));
sfx.ts:519-533  sfxEnemyFire(archetype, rootMidi, pan) → pan: clamp(pan, 0, 1)
```

`e.x` is not a coordinate, it is a **stereo pan**. On a 900-wide field, an enemy
firing from the left edge pans 0.0 and one on the right pans 1.0, so the mix
tells you which side the shot came from. On a 2700-wide field the player and
everything near them sit inside one third of the range, so the pan collapses
toward whatever fraction of the world the player happens to be standing at and
stops varying with the thing it is supposed to encode.

That is exactly the `playerHeight` failure this codebase has already diagnosed
once, in its own words at `world.ts:3831-3841`: *"it looks responsive in the
source and is a constant in play, the exact defect `tools/deadconditions.mjs`
was built to catch."*

The honest replacement is camera-independent and does not need the camera at
all: `clamp01(0.5 + (e.x - player.x) / VIEW_W)` — "which side of **me** did that
come from". It also happens to be more correct than today's version.

Second-order: `events.ts:161` names the field `x`, and
`tools/battlefield.mjs:13` records it as `x` in its output. The name is already
misleading; if the denominator changes, that tool's numbers change meaning with
no diff and no failure.

Also here: `world.ts:3840` `s.playerHeight = clamp01(1 - this.player.y / this.height)`
is already documented as deprecated (`events.ts:340`, `world.ts:3825-3839`). In
a 3× world it goes from "hovers around 0.5" to "hovers around 0.5 with less
variance". Its only remaining exerciser is `tools/registercheck.mjs:14-17`,
which drives `player.y = height * f` to sweep it.

Grep results for the requested patterns, complete, `src` only:

```
enemies.ts:306,307,309   ctx.width/2, ctx.height/2, min(ctx.width,ctx.height)*0.17   (bossMove)
enemies.ts:883           width / 2                                                    (boss homeX)
waves.ts:371,372,374     width/2 / |cos|, height/2 / |sin|, width/2 + c*t            (edgePoint)
waves.ts:508             width / 2 + (t-0.5)*160                                      (dead legacy fn)
world.ts:675             this.width/2, this.height/2                                  (player spawn)
world.ts:1186,1187       e.x - this.width/2, e.y - this.height/2                      (retreat)
world.ts:1226            e.x / this.width                                             (AUDIO PAN)
world.ts:1687            this.width / 2                                               (boss spawn)
world.ts:3840            1 - this.player.y / this.height                              (playerHeight)
grid.ts:85,86            width/SPACING, height/SPACING                                (lattice size)
renderer.ts:184,185      world.width/4, world.height/4                                (bloom)
renderer.ts:344          (cssH*dpr) / w.height                                        (canvas scale)
renderer.ts:1285,1291,1331-1335   w.width/2, w.height/2                               (banner, vignette)
```

`audio/director.ts`: **clean**. No position reads.

---

## 6. AI / behaviour and input

**AI radii are already player-relative and survive a bigger world unchanged.**
`DANGER_RADIUS = 110`, `PANIC_RADIUS = 52`, `SCAN_RADIUS = 300`
(`world.ts:109-112`) are all measured against the player in `collidePlayer`
(`world.ts:2465-2467`). `THREAT_RADIUS = 460` / `THREAT_SCALE = 520`
(`world.ts:190-191`) likewise, in `analyseEncirclement` (`world.ts:3148-3197`) —
that function computes bearings and gaps relative to `player.x/y` and never
touches the field. `ringHold` (`enemies.ts:167`) holds a standoff from the
player. `homeY`-as-standoff (`world.ts:2031-2038`) is already a radius from the
player, and its comment already flags itself as the line that would quietly
reinterpret a retuned `planWave` range.

So §5 of the brief is mostly good news: the encirclement system was *already*
converted off absolute field position, and the reasons are written down at
`world.ts:3131-3147`. The things that still read the rectangle are the four in
§3 (retreat vector, boss orbit, boss spawn, spawn ring) plus the cosmetic
`60 … width-60` clamps.

**Input is one function with two jobs, and a camera splits them.**

```
main.ts:130-136   toPlayfield(e) = ((clientX - r.left) / r.width) * world.width
main.ts:154       routeOfferPointer → levelUp.hitTestControl / hitTest   ← SCREEN space
main.ts:183, 202  input.setPointerTarget(pt.x, pt.y)                     ← WORLD space
```

Today those are the same number. Under a camera they are not: the level-up card
rectangles are laid out in `VIEW` coordinates (`renderer.ts:1354` passes
`w.width, w.height` into `levelUp.draw`, and `levelup.ts:815 hitTest` /
`levelup.ts:849 hitTestControl` read rectangles from that same layout), while
the steering target must be `screen → view → + camera.viewX/Y → world`.

`main.ts:139-150` already documents the failure mode of getting this wrong:
*"the cards draw in one place, the hit test believes they are in another, and
the player clicks PIZZICATO and receives SNARE ROLL with nothing on screen
looking wrong."* Splitting `toPlayfield` into `toView` and `toWorld` is the
whole fix, and it must be one commit with `renderer.ts:1354`.

Supporting sites:
- `input.ts:78-92, 166-177` — `pointerTarget` is compared against `shipX/shipY`, so it must be in **world** space.
- `input.ts:124-125` — `shipX = 450; shipY = 560` are hardcoded halves of 900/1120. Stale defaults, overwritten each frame at `main.ts:561-562`, but they will read as a lie.
- Mouse is deliberately excluded from steering (`main.ts:181, 194, 207`), so there is no desktop aim-at-cursor path to convert.

---

## 7. Tools that would break or silently lie

The AGENTS.md rule — *"a tool holding its own copy of a constant will lie the
day it moves"* — has a live population here. Split into two classes, because
they fail differently.

### 7a. Hardcodes the number (will lie loudly or produce a wrong image)

| Tool | Line | What it holds |
|---|---|---|
| `tools/contrast.mjs` | 16-17, 65-66, 90, 100 | Viewport 900×1000, `field = {w:900,h:1120}` as a fallback, and maps world→screenshot via `png.width / field.w`. **It reads the real field at :50 (the fix from last time), but the mapping assumes the canvas shows the whole field** — a camera breaks it again, in exactly the same way, and it will again report a total readability failure that is entirely its own. Worse: its background sample grid is `gy < 900, gx < 680` and its bullet filter is `q.x > 670 \|\| q.y > 890` — **those are the OLD 720×960 field and are stale today**, so it currently samples only the top-left corner of a 900×1120 arena |
| `tools/effectsdraw.mjs` | 77, 122, 145 | Fake canvas hardcoded `900 × 1120`, three times |
| `tools/effectsdraw.mjs` | 146 | Fake `camera: { x: 0, y: 0, flash: 0, flashHue: 0 }` — **the only place outside `src` that models `Camera`'s shape.** Adding `viewX/viewY` to `Camera` breaks this the moment the renderer reads them |
| `tools/levelshot.mjs` | 238-239 | Asserts cards fall inside "the 900x1120 field" |
| `tools/levelupdraw.mjs` | 210, 416, 439 | Draws at `[900, 1120]` in three places |
| `index.html` | 15, 16 | `<canvas width="900" height="1120">` × 2 |
| `src/style.css` | 124 | `aspect-ratio: 900 / 1120` — `renderer.ts:337-343` depends on this rule existing |
| `tools/panelshot.mjs` | 6 | Prose: "simulation is 900x1120" |
| `tools/barvariety.mjs` | 53 | Prose: "`width` and `height` are fixed constants" |

### 7b. Reads the live value, so it will not crash — and that is the danger

These re-baseline silently. AGENTS §3: *"before writing a threshold, ask how
someone could pass it while changing nothing."* Here the inverse — a term that
stops doing anything while the check stays green.

| Tool | Line | Term |
|---|---|---|
| `tools/lib/bot-brain.mjs` | 110-111 | `if (px > w.width - 110) mx -= 1` — wall avoidance |
| `tools/lib/driver.mjs` | 107-108 | same, copied verbatim (deliberately — see its comment) |
| `tools/arena.mjs` | 136-138 | same, third copy |
| `tools/decisions.mjs` | 70-71 | same, fourth copy |
| `tools/deadhunt-branches.mjs` | 92-94 | same |
| `tools/deadhunt-fusion.mjs` | 167-169 | same |
| `tools/deadhunt-horizon.mjs` | 198-200 | same |
| `tools/deadhunt-ranges.mjs` | 258-260 | same |

Eight copies of a 110px wall-repulsion term. On a 3× field a bot that stays near
the action is **never** within 110px of a wall, so the term goes inert. Every
balance number these produce — kills/min, level pacing, encirclement quantiles,
fusion rates, TTK — shifts because the *player model* changed, not because the
game did. `tools/lib/driver.mjs:88-100` already records this exact class of
mistake once ("measuring one bad strategy and calling it the game").

| Tool | Line | Term |
|---|---|---|
| `tools/hitrate.mjs` | 48-49, 51, 54-55, 66 | Places player at `w.height*0.8` and target at `w.height*0.4`; the **separation scales with the field**, so hit rate moves 3× further apart with no gameplay change |
| `tools/ttk.mjs` | 29, 35, 40, 45 | Same shape: `w.height*0.8` vs `w.height*0.35`. TTK is distance-sensitive |
| `tools/registercheck.mjs` | 14-17 | Sweeps `player.y = height * f` to exercise `playerHeight`, which is already deprecated |
| `tools/flicker.mjs` | 21 | `player.y = w.height * (0.5 ± 0.006)` — the jitter amplitude scales with the field |
| `tools/battlefield.mjs` | 13 | Logs `e.x` from `enemy:fire` (the 0..1 pan). Meaning changes with §5, numbers do not obviously move |
| `tools/focuscheck.mjs` | 20 | Passes `{ w: w.width, h: w.height }` as player bounds. Correct either way |

`tools/arena.mjs` is the **gate** for stages 4-5 below, and its bot is in class
7b. Fix the measurement before moving the thing being measured.

---

## 8. Two options

### (A) Bounded-but-bigger — 3-4× linear, follow camera with deadzone + lookahead

**Keeps working by construction:** the wall-bounce rectangle and therefore
`InstrumentStats.bounces`; `CULL_MARGIN` against a real boundary and therefore
`escaped` and wave completion; `edgePoint` against a rectangle; the boss's
"take the middle of the arena" identity; the encirclement corridor; the bot
wall-avoidance term (retuned, not deleted).

**Cost:** the field is still finite. A player who runs still hits a wall, and
corner camping is still reachable — though `campPressure`
(`world.ts:970-1005`) already exists to punish parking anywhere. And the
balance re-baselines regardless: longer drop travel, longer time-to-contact,
more empty space per enemy.

**Shape of the change:** mostly a rename. `VIEW_W/VIEW_H` added; ~25 render-side
`w.width` become `VIEW_W`; `Camera` gains `viewX/viewY` and a `follow()`;
`toPlayfield` splits in two; `edgePoint` gains a centre; the grid becomes
viewport-local. Every one of those is mechanical and individually reviewable.

### (B) Effectively-infinite — VS-style, spawn ring around the camera, no walls

**Deletes six designed behaviours and requires replacements for each:**

1. No walls → `bounces` is dead again (`world.ts:1024-1036`). Needs a new
   reflection surface or an honest "we removed CANON's eight bounces" note.
2. No field centre → boss orbit (`enemies.ts:305-316`) and retreat vector
   (`world.ts:1186-1189`) need a new anchor.
3. Cull must be camera-relative → `escaped` changes meaning, and wave completion
   (`world.ts:1662`) now depends on where the player is looking.
4. Drops fall forever (`powerups.ts:263` culls at `y > height + 40`); nothing
   else bounds a `PowerupDrop`.
5. `world.ts:2608`'s `if (e.y < -10) continue` early-out in `collidePlayer`
   becomes actively wrong once the player can be at negative `y`.
6. All eight bot wall terms lose their meaning outright rather than needing a
   retune.

Plus float precision drift on a genuinely unbounded field, which nothing here is
written for.

**Gain:** it is what VS actually is, corner camping is impossible, and
spawn-ring-around-camera is *simpler* than intersecting a rectangle.

### Recommendation: **(A)**

Three reasons specific to this codebase, not to camera design in general.

**One.** The feedback is "the map is too small", not "the map has walls". A 3×
field with a camera showing one screen is the smallest change that actually
answers it. Vampire Survivors' own stages are finite in practice; the feeling
being asked for is *scrolling*, and scrolling is what the camera provides —
independently of whether there is an edge 2700px away.

**Two.** This repo's whole documented culture is that removing a system to make
a change easier is how measured features die. `InstrumentStats.bounces` is the
worked example, in a comment, in the exact file this refactor touches: declared,
folded through `applyModifiers`, tuned across three ladder entries, and read by
nothing for the whole life of the project until someone added a wall rectangle.
Option B removes that rectangle. If B is chosen, `bounces` must be deliberately
re-homed or deliberately deleted, and the commit must say which — AGENTS §3's
"the test failed so I removed it" vs "the test encoded an assumption I am
deliberately changing" rule applies to features too.

**Three.** A is stageable into commits that each compile and each have a gate
that can actually go red. B's stages 3, 4 and 5 all have to land together,
because you cannot cull against a camera before the camera follows and you
cannot spawn on a camera ring before culling moves. A big-bang commit against
this verification suite is how a silent re-baseline gets in.

If the arena at 3× still reads as cramped after measurement, B is reachable from
A: `PLAYFIELD_W/H` becomes a per-run number, then `Infinity`. A is a strict
prefix of B. B is not a prefix of anything.

---

## 9. Staged implementation order

Baseline gate for every stage, per AGENTS §2: `node node_modules/typescript/bin/tsc --noEmit`.
Verified green on the tree as read. Additional gates are listed per stage.
Browser gates are marked `[browser]`; they were not attempted here.

### Stage 0 — pin the baseline. No code change.

Run `arena` (node-only, `node --experimental-transform-types tools/arena.mjs`,
20 simulated minutes × 3 runs ≈ 4.3s per its own header) plus `levelup` and
`combine`. Record kills/min, level pacing vs `docs/progression.md`, encirclement
p10/p50/p90, roster-on-screen, wave reached — **for both the card-0 and builder
policies**.

*Gate:* the numbers are written into `docs/MASTER_PLAN.md` §7 with the commit
hash. AGENTS §6: "compare against the same code, not a remembered number", and
this refactor **will** move all of them.

### Stage 0b — fix the measurement before moving the measured. No behaviour change.

Replace the eight copies of `if (px > w.width - 110)` with a term expressed
against the field the tool is actually running (`tools/lib/bot-brain.mjs:110-111`,
`tools/lib/driver.mjs:107-108`, `tools/arena.mjs:136-138`,
`tools/decisions.mjs:70-71`, `deadhunt-{branches:92,fusion:167,horizon:198,ranges:258}`).
Fix `tools/hitrate.mjs` and `tools/ttk.mjs` to place their test pair at a fixed
pixel separation rather than a fraction of the field. Fix
`tools/contrast.mjs:90,100`'s stale 720×960 sample window.

*Gate:* re-run Stage 0 and get **the same numbers**. If they move, the fix
changed the player, and that has to be understood before anything else lands.
Then temporarily set `PLAYFIELD_W = 1080` and confirm each tool's output moves —
AGENTS §3's "a gate that has never been seen red is not evidence", applied to
the constant.

### Stage 1 — the view/world split, as a numeric no-op.

Add `VIEW_W = 900`, `VIEW_H = 1120` in `world.ts` and `readonly viewW/viewH` on
`World`. Point every render-side and UI-side reference at them:
`renderer.ts:344,346,347,495,500-528,1239-1291,1301-1343,1354,1378-1384`;
`renderer.ts:184-185`; the offer branch of `main.ts:130-136`. `PLAYFIELD_W/H`
still equals `VIEW_W/H`, so nothing changes on screen.

*Gate:* `tsc`; `levelupdraw`, `effectsdraw`, `levelshot`[browser] produce
identical output. **Fail-test:** set `VIEW_W = 800` and confirm the boss bar and
XP bar shrink *and* that `levelUp.hitTest` still agrees with where the cards
draw — that is the `main.ts:139-150` failure mode, and this is the one chance to
watch it fail on purpose.

### Stage 2 — `Camera` gains a position, still pinned at the origin.

Add `viewX`, `viewY` (top-left of the view in world space) and rename the shake
accumulators. Keep `x`/`y` as the composed render offset
(`x = -viewX + shakeX`), so `renderer.ts:387` and `renderer.ts:434` are
**unchanged**. Add `follow(px, py, dt)` with a deadzone and velocity lookahead,
clamped to `[0, PLAYFIELD_W - VIEW_W]`. With world == view that clamp pins it at
zero. Update `tools/effectsdraw.mjs:146` in the same commit — it holds the only
external copy of `Camera`'s shape.

*Gate:* `tsc`; `arena` output **bit-identical** to Stage 0b. The camera must not
be able to touch the simulation, and this is the commit that proves it. Also
confirm `camera.kick()` (`camera.ts:64-69`) still writes to the shake channel,
not the view channel — it currently adds straight into `x`/`y`.

### Stage 3 — decouple the render pipeline from world size.

Grid allocated at `VIEW + 1` cell of bleed, home positions scrolled with the
camera snapped to `SPACING` (`grid.ts:82-106`); `breathe()` centred on the view
(`grid.ts:146-150`). Bloom canvas → `VIEW/4`. Stars → view-space parallax
(`renderer.ts:188-191, 508-513`) — with a real camera this becomes genuine
depth, which is the cheapest possible "the world is big" signal. Background and
vignette → view rect.

*Gate:* `tsc`; a **new node check** asserting `WarpGrid`'s point count is a
function of `VIEW_*` and not `PLAYFIELD_*` (fail-test: raise `PLAYFIELD_W`, the
count must not move). `framecheck`[browser], `flicker`[browser],
`gridcheck`[browser] if a browser is available; say plainly if not.

### Stage 4 — move the simulation off the rectangle centre. Still 900×1120.

`edgePoint` / `arenaSpawnPositions` gain `(cx, cy)` and ring dimensions
(`waves.ts:369-460`); `spawnGroup` passes the camera centre + `VIEW_*` +
`SPAWN_MARGIN` (`world.ts:2022-2028, 2122-2127`). `spawnBoss` enters on the ring
rather than at `(width/2, -120)` (`world.ts:1687`); `bossMove` orbits an anchor
captured at spawn with a `VIEW`-derived radius (`enemies.ts:305-316, 883`).
Retreat vector heads away from the player (`world.ts:1186-1189`). `hasEntered`
becomes view-relative (`world.ts:3802-3804`). **Fix the pan** at
`world.ts:1226` to `clamp01(0.5 + (e.x - player.x) / VIEW_W)` and rename the
event field in `events.ts:161` from `x` to `pan` so
`tools/battlefield.mjs:13` is forced to acknowledge the change rather than
inherit it. Retire `s.playerHeight` (`world.ts:3840`) or leave the note.

Because the world is still one screen, all of this must be a **behavioural
no-op** except the pan.

*Gate:* `tsc`; `arena` — encirclement quantiles and kills/min within the
Stage 0b band, `escaped`-per-wave unchanged. **New assertion:** no spawn
position lands inside the view rect. Today that is true by construction; after
this change it is a live risk and nothing would catch it. `battlefield`[browser]
for the pan; note that pan is *heard*, and nothing node-only can hear it —
AGENTS §9.

### Stage 5 — grow the field.

`PLAYFIELD_W/H` → 3000 × 3000. Square, not 3× of 900×1120: the comment at
`world.ts:86-104` already argues the 0.80 aspect is the wrong shape for an arena
and names 1000×1000 as the recommendation; a square field also makes the spawn
ring symmetric, which it currently is not (the ring is 25% further away N/S than
E/W). Update `index.html:15-16` and `src/style.css:124` to `VIEW`, not
`PLAYFIELD` — those are the two files `world.ts:96-99` warns about by name.
Enable the camera clamp. Retune `CULL_MARGIN` if `escaped` moves.

*Gate:* `tsc`; `arena` re-measured against Stage 0b and **reported as a finding,
not as a pass** — kills/min and level pacing will move and the question is
whether `docs/progression.md`'s XP table still holds. `bosslength` and
`firstminute` because both are wall-clock budgets denominated in an event whose
rate just changed. `contrast`[browser] — it will need the camera-aware mapping
from Stage 6 first, so expect it red here and say so.

### Stage 6 — repair the tools that now lie.

`tools/contrast.mjs` maps world→screenshot through `camera.viewX/viewY` and
`VIEW_*` instead of `png.width / field.w`. `tools/levelshot.mjs:238-239`,
`tools/levelupdraw.mjs:210,416,439`, `tools/effectsdraw.mjs:77,122,145` import
`VIEW_W`/`VIEW_H` from `src/game/world.ts` instead of hardcoding. Decide
`tools/registercheck.mjs`'s fate along with `playerHeight`.

*Gate:* each repaired tool run once with `VIEW_W` temporarily 20% off, confirmed
to move. A tool that imports the constant and still does not notice it changing
is not importing it for the reason it thinks.

### Stage 7 — feel.

Deadzone size, lookahead gain, and camera smoothing are the only three numbers
in this whole refactor that cannot be measured node-only. They need a person and
a browser. Ship the stages above first, then tune these against a human, and
record in the commit that they were **judged, not measured**.

---

## 10. Things worth knowing that were not asked for

- `waves.ts:476-513` `formationPositions` is dead code kept deliberately
  (`waves.ts:468-475`) as a side-by-side with the arena version. Stage 4 makes
  it a third layout. Consider whether it still earns its keep.
- `world.ts:2608`'s `if (e.y < -10) continue` is an already-documented relic
  with a measured justification (`tools/deadhunt-branches.mjs` found 0 real
  contacts skipped in ten runs). That justification depends on the player being
  clamped to `y >= 12`, which Stage 5 keeps and Option B removes.
- `detonateBomb` (`world.ts:2732-2747`) and `cancelBullets` hit **every** enemy
  and bullet on the field regardless of distance. In a 3× world a bomb clears
  things the player cannot see. That is a design question, not a bug, but it is
  a design question that only appears once the field is bigger than the screen.
- The starfield at `renderer.ts:504-517` currently fakes vertical scrolling on a
  static field. A follow camera makes it real for free, and it is probably the
  single highest ratio of "feels big" to lines changed in this whole document.
