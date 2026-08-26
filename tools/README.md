# Verification tools

`npm run verify` runs the four fast checks after a build — quick enough to run
after every change. `npm run verify:all` runs all thirty that can actually fail;
it takes several minutes and drives real browsers, so it is the pre-publish gate
rather than the inner loop.

Five checks used to print a verdict and then exit 0 regardless — `gridcheck`,
`hopcheck`, `phasecheck`, `telegraph`, `voicecheck`. They would have passed in
any automated gate no matter what the game did. A check that cannot fail is
decoration, and the whole point of this directory is that Web Audio and
generative music fail silently.

The remaining scripts (`bot`, `endgame`, `mixbalance`, `thrash`, `shots`,
`stemprobe`) are surveys: they report numbers for a human to read and
deliberately assert nothing.

None of these can tell you whether the music sounds *good* — only a person can
do that. They exist to catch the failures that are silent, which in a Web Audio
project is most of them.

| script | what it proves |
|---|---|
| `npm run smoke` | The AudioContext resumed and Strudel's clock is advancing; the arrangement moves through its sections; layers enter and leave; a held powerup brings in its musical layer; no non-finite control values; frame rate holds. |
| `npm run audiocheck` | Sound is actually reaching the destination. Monkey-patches `AudioNode.connect` before boot so anything wired to the destination is also wired to an AnalyserNode we own, then measures RMS, peak and clipping. |
| `npm run shots` | Screenshots at chosen moments, playing defensively so the run survives. |
| `npm run bot` | Plays the game with a bot that actually reads the field — repelled by converging bullets, attracted to notes when safe, focuses when threading, bombs when boxed in. `MODE=weave` switches to the old fixed strategy for comparison. Every balance number before iteration 22 came from the weaving bot, so its conclusions were really about that one strategy. |
| `npm run endgame` | Jumps to waves 1/5/9/13/17/21/27 and reports difficulty, density, key, groove and fps. Found that difficulty hard-capped at wave 17 and the endgame played permanently in octatonic. |
| `npm run mixbalance` | Solos each stem and measures real RMS. **Read the caveat at the top of the file** — shared reverb tails mean it can only catch a totally absent layer, not settle fine balance. That is how a project-long silent bassline was found. |
| `npm run opening` | Prints the first twelve bars: section, and how many notes each stem actually plays. Found that the lead played *zero* notes through the entire intro, and that the intro was being cut from eight bars to four by the first wave. Replaced an earlier `introcheck` that asserted on entry order and rising loudness — both true of a broken intro, so it passed for nineteen iterations. |
| `npm run flicker` | Hovers the ship on a threshold boundary and counts how often derived state flips. Found the melody jumping an octave once a second. |
| `npm run contrast` | Samples real rendered pixels at bullet positions against the room behind them, per groove. Answered a worry that the groove-tinted palette had broken the colour contract: it had not, because readability rides on luminance rather than hue. Took three wrong versions to get right — sampling the exact centre, sampling stale positions, and not freezing motion. |
| `npm run pooling` | Hammers the particle pool with sustained grazing plus explosions and reports peak occupancy and refused emissions. Confirmed the graze ring cannot starve death bursts: peak 582 of 2600, zero dropped across 517 grazes. |
| `npm run package` | Inlines the production build into one self-contained HTML file. |
| `node tools/verify-package.mjs` | Runs the packaged single file end to end (needs `TARGET=<url>`). |

They need a dev server on :5173 (`npm run dev`) and a Chromium that Playwright
can launch. On a machine without the usual system libraries and without root,
`libnss3`/`libnspr4`/`libasound2t64` can be extracted from their .deb packages
into a directory on `LD_LIBRARY_PATH` rather than installed.

## Known overlap

Twelve scripts have accumulated, and some cover adjacent ground:

- `endgame` and `bot` both survey difficulty across waves — `endgame` reports
  the arrangement, `bot` reports what a player-like agent survives.
- `flicker` and `physcheck` both hold the game in a state and count instability.
- `opening` subsumes an older `introcheck`, which was deleted.

They are deliberately *not* merged yet. A previous cleanup pass used bulk regex
edits on source and broke four files; with no commits in this repository there
was no revert point, and recovery was hand-repair. Consolidating these is worth
doing, but it is worth doing carefully and with somewhere to fall back to.

- `deadair` — how much of a run is nothing happening. Found that 17% of a run
  had an empty screen with stretches up to 8.5s, and that the player held no
  powerup 59% of the time. Also found that the tool measuring this had a
  hand-written bot using the wrong input shape, so the ship never moved and
  never fired: the first three sets of numbers described a frozen game. That is
  why `tools/lib/driver.mjs` exists and why nothing hand-rolls a player now.
- `look` — screenshots of a live run, for reviewing the UI as a player sees it.

- `mixaudit` — solos all eleven stems in one session and fails any buried more
  than 30dB under the loudest. Found the clap 27.7dB under the kick (a backbeat
  nobody could hear) and the bass 22.5dB under. Both were filter problems, not
  gain problems: bpq(4) on white noise, and a bass lpf closing to 240Hz against
  an hpf at 95Hz. `stemprobe` only ever measured one stem per launch, which is
  why nobody had seen the eleven side by side.
- `bassprobe` — long-window solo of the low end against the kick, in dB. Use it
  to settle whether a layer is quiet or just unluckily sampled.

- `framecheck` — frame pacing at a real 1440x900 window, gated against a
  blank-page control measured in the same session rather than a fixed number.
  Found the title screen running at 27.3fps against the control's 60: a single
  `backdrop-filter: blur(2px)` on the full-screen overlay, which made the
  compositor re-blur the whole animating canvas every frame. Every screen the
  player stops to read — title, pause, game over — was at half rate.
- `framewhere` — attributes the frame to renderer / director / world / hud and
  counts long tasks. Its verdict at wave 23: everything this repo controls is
  10.7% of the main thread, so the remaining tail is the audio scheduler and the
  VM, not the game loop.
- `hudab` — interleaved A/B of the per-frame HUD update. Kept as a negative
  result: measured once each it said the HUD cost 7.7fps, and again that it cost
  nothing. Interleaved over four pairs it costs 2.1fps, inside the run-to-run
  noise band. Frame rate here drifts ~5fps on its own, so any A/B smaller than
  that must interleave or it is measuring the arrangement.

- `paintab` / `sfxab` — interleaved A/Bs for canvas rasterisation and SFX cost.
  Both are mostly cautionary. Blanking the renderer gains 14.8fps here, but the
  headless browser rasterises on SwiftShader (CPU), so that figure describes the
  test box rather than a player's machine; the bloom pass, the obvious hotspot,
  measured as costing nothing at all. SFX turned out not to be a frame cost —
  the 104 audio nodes/sec are mostly the arrangement, not the effects. Check
  `framecheck`'s rasteriser line before drawing any conclusion from either.

- `rondo` — asserts that a theme recurs. Themes were picked `wave % 8`, so a
  tune played for one wave and did not come back for several minutes; eight
  tunes heard once each guarantees none becomes a hook. Now a signature theme
  returns every other wave and on every boss, with episodes between. Asserted
  structurally rather than by listening, because the theme is deliberately
  developed on each return — a listening test would measure the development
  rather than the recurrence.

- `summarycheck` — every stat on the run-summary screen must count something.
  Found NOTES and BEST MULT initialised at reset and never written again, so
  every run ever played ended on "NOTES 0 / BEST MULT x1" on the one screen
  whose whole job is to tell the player what their run was.
- `screens` — screenshots of the framing screens. Worth noting the two test
  bugs it produced before it produced a finding: ending a run by setting
  `lives = 0; hp = 0` never sets `player.dead`, and the element is
  `#gameover-screen`, not `#gameover`. Both looked exactly like game bugs.

- `curve` — the difficulty curve as on-screen pressure per wave, using the
  *weave* bot rather than the dodging one: the good bot takes 0-3 hits in any
  sample at any wave, so it has no resolution and the curve came out flat and
  jagged at once. Found bullets jumping 8 -> 41 between waves 11 and 15, because
  armedChance saturated at 98% by wave 11 and the only escalation left was more
  enemies. Note it needs four reps to be stable, and hits are deliberately kept
  out of the verdict — with hits in, the same build passed and failed on
  consecutive runs and blamed a different wave each time.

- `mobileshot` — screenshots of the pause screen and a phone-sized run. Found
  the touch buttons sitting *on* the playfield: absolutely positioned inside the
  stage, three 72%-opaque blocks over the lower-right of the play area. Every
  existing touch check asked whether the controls worked, never where they were,
  so `touchcheck` now asserts they intersect the playfield canvas nowhere.

- `variety` / `tensionprobe` — what a player hears over an uninterrupted run.
  Found tension never exceeding 0.5 across 1132 samples: the master musical
  signal, which drives mode selection, section choice and every stem fader, only
  ever produced the bottom half of its range. Two causes — `crowding` scaled
  against 18 near-miss bullets (real peak ~7) and `density` against 200 on
  screen (real range 10-60), together 32% of the weight contributing almost
  nothing; and a weighted mean of eight terms that never co-peak, which cannot
  reach the top of its own range at all. Downstream, the run was 83% in the dark
  four modes with dorian never heard once, and the arranger spent 70% of a run
  in the drop against 5% in a breakdown — its thresholds had all been chosen
  against the broken signal, so its exits from the drop were unreachable. Fixing
  a signal's range means recalibrating everything that reads it; the two were
  found in consecutive iterations only because this tool prints distributions
  rather than pass/fail.

- `faders` — where each stem's level actually sits over a run: pinned near the
  top is a switch, not a mix; a narrow range is a layer not responding at all.
  Ran it expecting the stem curves to be miscalibrated the way the arranger's
  thresholds were, and they were not — that hypothesis was wrong. What it did
  find was the arp capped at 0.44 against a ceiling of 0.76, from
  `if (snap.playerFiring) want *= 0.62`. In a bullet hell the fire button is
  held: `playerFiring` measured true 100% of the time across 789 samples, so a
  rule written as a dynamic response was a permanent 38% cut. Re-keyed to
  focus, which varies and is the better musical cue anyway.

- `deadconditions` — sweeps every boolean and numeric field of the game snapshot
  over a real run and reports which never vary and what ranges they actually
  occupy. Built because three consecutive iterations found the same defect by
  accident: a condition or range that looks responsive in the source and is a
  constant in play. Reports rather than asserts, since a constant boolean is
  only a defect if something branches on it — `gameOver` should be false for a
  whole run. Its first run found `enemyFireRate` reaching 7.6/s against a yield
  window calibrated for a 1.85 peak. Note it pins `lives`, so `fragility` and
  the low-health behaviour are not exercised by it.

- `hurt` — what the music does as the player is dying, a branch no other probe
  reaches because they all keep the bot alive on purpose. Verdict: the design
  works. The mix thins measurably as health falls, low/high band ratio around
  6 at full health against 2-3 near death, repeatably. Two of its own bugs are
  worth remembering: asserting on sub/bass/kick fader values failed because a
  breakdown mutes them regardless of health, and walking health to zero measured
  the `collapse` section — everything but fx and sub muted — which reads as a
  ratio of 57 and looks like the thinning working spectacularly backwards.
  Nearly dead and dead are different musical states.

- `bosslength` — times a boss fight from arrival to kill. "Extremely high hp"
  was a direct complaint; the bullet half of it had been fixed and measured, the
  length half never had. Found the wave-8 boss at 88s and the wave-16 boss at
  174s. The HP pool only grows 33% between those waves, so nearly all the gap is
  the player being unable to attack — a late boss arrives with more on screen to
  dodge — which means scaling HP with difficulty compounds a penalty the game
  already applies. Now 64s and 98s, both still playing all three phases.
- `bossshots` — screenshots through a fight. Confirms the visual side reads:
  phase-marked HP bar, ~14 bullets on screen, grid warped to the groove's hue.

  Replaces `bossshot.mjs`, deleted: it printed boss state and exited 0 no matter
  what it saw, so it could never fail and was never wired into a suite. A tool
  that cannot report a problem is documentation with a startup cost.

- `firstminute` — the milestones a new player actually hits: first enemy, first
  kill, first shot fired at them, first powerup, and what the music does while
  they wait. The opening had been tuned twice from complaints and never
  measured. Found 11.5 seconds of empty screen between pressing START and the
  first enemy — six bars of runway, deliberate, but a long time to ask someone
  to wait. Four bars still lets the arrangement assemble (the intro's staged
  entry is unchanged: chords bar 1, lead bar 2, hats 4, kick 5) and the wait is
  now 7.7s.

**Do not edit anything under src/ while a browser suite is running.** Vite's HMR
full-reloads the page, which wipes whatever state the running check had set up.
This has now cost two debugging sessions — once in volcheck, where it was
written down, and once in smoke afterwards by the same person who wrote it down.

- `curve` (rewritten) — integrates pressure over whole waves from one continuous
  run instead of sampling a fixed window at a jumped-to wave. The old design's
  flaw was structural, not a threshold: a window lands on whichever phase a wave
  happens to be in, so runs of an unchanged build flagged different waves each
  time. The rewrite also compares boss waves against boss waves — a boss roughly
  doubles the pressure of the wave before it, so comparing neighbours reported
  the game's own structure back as a defect — and exempts the deliberately
  trivial waves 1-3.

**Do not run another browser tool while a suite is running.** Two headless
browsers competing on a software rasteriser degrade each other's frame timing;
`framecheck` failed once for exactly this reason and nothing was wrong with the
game. Same family as the HMR warning above: the harness interfering with itself.

- `wavelength` — wave duration against the eight-bar phrase the arrangement is
  built on. Checked because whole-wave sampling suggested ordinary waves ran as
  short as 8s, which would be less than one phrase — a wave too short for the
  theme to state itself. It is not so: ordinary waves average 18s (1.2 phrases),
  bosses 46s, none under a phrase, and bosses hold 41% of the clock. The short
  readings were waves clipped by the other tool's window boundaries, which this
  one drops explicitly.
- `progression` — whether a run has an arc. Every powerup expires, so the player
  at wave 20 was exactly as capable as at wave 4 while facing several times the
  pressure. Each boss now permanently widens the loadout (3 -> 4 -> 5), which is
  the one reward that also shows up in the music, since every held powerup
  voices its own signature.

- `roster` (`node tools/roster.mjs`, no npm script) — what the stage is *made
  of*, rather than what it produces. Every other balance tool here measures the
  result of the roster — bullets on screen, hits taken, wave length — so
  "enemies that shoot bullets should be rare, they should move slower, and take
  a few more hits" arrived with nothing that could measure any of its three
  halves. Reading `armedChance` from the source does not answer the first one
  either: `World.spawnGroup` arms the first enemy of every non-rush group
  whatever the chance returns, so the fraction a player meets has a floor of one
  per group. Measured 67-72% armed against a function whose ceiling was 85% and
  whose value at wave 1 is 26%.

  Judge speed per archetype and never by the run mean. The per-archetype numbers
  repeat to a few percent across runs; the run mean read 136, 170 and 183 on
  three runs of one unchanged build, because it averages over whatever mix of
  shapes the run happened to spawn and the mix moves more than the speeds do.

  It also buckets pressure per wave the way `curve` does. That duplication is
  deliberate and is documented in the file: `curve` cannot finish a run while
  anybody else is editing src/.

- `lib/frozen.mjs` — mocks the HMR websocket so a measuring page cannot be
  reloaded out from under a check, and returns a counter so a run that reloaded
  anyway says so instead of reporting the average of two builds. The warning
  above — do not edit src/ while a browser check is running — assumes one person
  at a time. With three workstreams in the same tree it stops being a rule
  anybody can follow: `curve` and `deadair` both died on "Execution context was
  destroyed, most likely because of a navigation", and a six-minute run could
  not be completed at all until the websocket was mocked. Two lines to adopt.

  It pins a page to the build it loaded, so it does *not* protect against
  starting on a half-saved file. Hash the files you are not changing around the
  run for that; it is how the enemy-rebalance numbers were shown to be
  uncontaminated by the concurrent player and audio work.

- `hitrate` (`node tools/hitrate.mjs`) — how much of the ship's output actually
  reaches a shape that is moving sideways. Built because `ttk` pins its target's
  position every 50ms against a sim stepping at 120Hz, which looked like it must
  be under-reporting hopping enemies. This pins nothing: it zeroes the target's
  descent so it cannot drift out of the test, and lets the archetype's own move
  function run at full rate against a parked, firing ship.

  **The hypothesis was wrong, and the tool very nearly confirmed it anyway.** Its
  first run returned 0.59s for stutter against ttk's 1.79s, an enemy hp change
  was made on that single reading, and three repeats then returned 1.43, 1.43 and
  1.47s. ttk had been close all along. A new tool's first run agreeing with the
  reason you built it is the least trustworthy number you will ever read.

  What it did find, and what does repeat: glissando takes 5.79/5.83/5.97s of
  parked fire at 8% of the ship's output, an order of magnitude worse than
  anything else, because it sways +/-150px. Read `dps` and `% of best` rather
  than seconds — dps is hp-independent, which is the whole point. Note
  `arpeggiator` is the one archetype this cannot measure: 2.49, 2.84 and 0.52s
  across three runs, because its strafe phase relative to the ship differs per
  spawn.

**Never use an unbounded string replace on a stylesheet.** Inserting a rule
before `.touch-hint {` matched a second occurrence inside a media query and
silently rewrote `.tagline, .warning, .touch-hint { font-size: 10px }` into the
new rule's selector, breaking mobile type sizing while the build still passed.
`vite build` and `tsc` both succeed on structurally valid but wrong CSS. This is
the same class of mistake that broke four source files in an earlier iteration:
anchor replacements on text that is unique, or assert the match count.

- `fullloadout` — what five simultaneous powerups do to the mix, added because
  widening the loadout to five slots created the risk. Only three powerups voice
  the `power` stem; the other nine modify existing layers, and five at once is a
  lot of simultaneous modification — "as i got more powerup the music got really
  choppy" is a complaint this project has already had. Verdict: a full loadout
  is 1.06x louder, adds 2.3 points of harshness and slightly *improves* crest
  factor. No defect; the check exists so that stays true.

- `suite` — runs every check in verify:all without stopping at the first
  failure. `verify:all` is a chain of `&&`, so one flaky gate hides everything
  behind it; three iterations in a row it stopped around the twentieth check on
  a different assertion each time, which meant learning about one problem per
  iteration. The first full sweep took 62 minutes and returned **40/44**, and
  all four failures were the same defect in the checks rather than in the game:
  a threshold sitting inside its own metric's run-to-run spread. `firstminute`
  read 7.7s and 9.1s against an 8s gate; `variety` read 18%, 31% and 35% against
  20%; `wavelength` read 0/11 and 3/13 short waves against 40%; `hurt` read
  ratios of 0.17 to 0.50 on passing runs against 0.75. Every one of them passes
  standalone, which is exactly what a threshold-in-the-noise looks like.

  Use `npm run suite` to see the whole board before fixing anything.

- `descant` — whether playing well sounds different from being in trouble.
  Combo fed exactly one thing, the `flow` tension term, so a chained
  high-multiplier run pushed the music the same direction as nearly dying:
  darker and busier. The lead now grows a harmony voice a sixth above it,
  fading in above a multiplier of eight. The check exists because the feature
  needed the rebuild key to start watching the multiplier — without that the
  descant would have appeared only when some *other* term happened to trigger a
  rebuild, which is a musical feature keyed to a value nothing was looking at.

- `earnedui` — the descant has to be visible, not only audible. The lead's
  harmony voice arrives above a multiplier of eight and nothing on screen said
  so, so a player could not connect the reward to what earned it. The multiplier
  now reads `x16 ·descant` in gold.

- `panelshot` — the MIX panel fits its contents at every window size. The panel
  was fixed at 268px while ~490px of a 1440px window sat empty, so the piano
  roll and generated code — the thing this project is about — rendered into a
  strip narrower than a phone. Widening it to 420px immediately pushed the code
  out of the panel, because the score canvas scaled its height with its width;
  capping the canvas height fixed that. The check watches both halves.

- `states` — screenshots of states that only appear on specific events: the
  ENSEMBLE GROWS banner, a flawless clear, a full loadout at high multiplier.
  Found the loadout row printing "none" *and* four empty slot chips — the same
  fact twice, from the placeholder predating the chips. `progression` now
  asserts the chip count equals the slot count.

  These event states are invisible to every other tool in this directory,
  because they need to be triggered rather than waited for.

- `ending` — what a run sounds like when it ends, which had never been listened
  to despite being the last impression a player keeps. The arrangement's
  four-second fade was fine; what followed it was not — the fx noise lane held
  at 0.58 over a sub drone at 0.13, indefinitely, so the loudest thing in the
  final mix was undirected noise that never resolved. It now decays to 0.13 over
  six seconds, leaving the tonic as the last thing standing.

  Its first version counted notes in `sampleBar` and passed, reporting a melodic
  ending nobody can hear: the collapse silences layers at the mixer and leaves
  the patterns intact underneath. Read levels, not patterns, when the question
  is what reaches the speakers.

- `retry` — the second run. Every other measurement in this directory is of a
  first run, but a player who dies presses RETRY immediately, and death leaves
  the arrangement in `collapse` with the tempo at its floor, the filter shut,
  every layer but fx and sub muted and a collapse timer running. Verdict: it all
  comes back — section, tempo, eleven audible layers, lives, loadout slots,
  scheduler. No defect found.

  Its own first assertion was wrong in an instructive way: it compared the
  second run's score against the first run's at the same elapsed time and
  treated similar values as a failure to reset. Two independent runs of the same
  length naturally score about the same. The question was whether the counter
  starts at zero, which needs reading it *at* the retry, not a minute later.

- `everypowerup` — the project's stated rule is that a powerup must be a
  persistent change to the arrangement rather than a bleep on pickup, and that
  claim had never been checked against all twelve. Two of this tool's own
  versions were wrong before one was right, and both failures are worth keeping:

  1. Sampling 2.4s apart and asking "did anything change" reported all twelve
     passing. With **nothing held at all** that comparison differed 6 times out
     of 6 — the arrangement moves on its own — so it would have passed a powerup
     that does nothing. Always measure the baseline drift of a comparison before
     believing what it says changed.
  2. Switching to a same-tick toggle then reported that *none* of the twelve did
     anything. The cause: `clear()` assigned a fresh `{}` to
     `player.powerups`, but `s.powerups = this.player.powerups` hands the
     director a **reference** that is only refreshed on the game loop — so the
     director kept reading the old object. Mutate in place; never replace an
     object something else holds a reference to.

  What it can honestly say: drift is zero, and `nova` and `timewarp` change the
  lanes the panel prints. The other ten act on the arp, lead or power lanes,
  which this instrument cannot see — `subtraction`, `descant` and `voicecheck`
  cover those. **Open question:** `rapid` is documented to double the hi-hat
  subdivision and hats *is* a printed lane, so its signature appears to be
  conditional on intensity. **Run down and fixed:** `hatDivision` tops out at
  sixteenths above intensity 0.7 and rapid works by pushing intensity up a band,
  so in a busy fight — exactly when a player is collecting powerups — RAPID
  changed nothing at all. It now opens the hats when the subdivision is already
  maxed, which is what a producer reaches for when the pattern is as fast as it
  should go. See `rapidair`.

- `rapidair` — measures the air band with and without RAPID, interleaved,
  because the panel showing a change is not the same as the speakers producing
  one. 1.27x with it held. Exists because the panel mirror and the builder are
  two separate pieces of code that have drifted apart three times in this
  project's history.

- `stacking` — picking up a powerup you already hold must do something. The game
  raises a held powerup to level 2 then 3 and the summary shows the level, so it
  promises a repeat pickup matters; several did not deliver. LASER's sustain was
  `laser > 0 ? 0.4 : 0.12`, binary, so the second and third were identical to the
  first. DRONES was capped at two satellites by a `Math.min(2, ...)` — in the
  powerup whose entire idea is more satellites. SPREAD's stereo width hit its
  clamp at level two. Same family as the RAPID bug: a contribution that
  saturates, so the reward exists on paper and not in the speakers.

## The powerup-saturation audit (applied)

RAPID (silent at high intensity), LASER, DRONES and SPREAD (repeat pickups
inaudible) were all one class — a contribution that saturates, so the reward
exists in the code and not in the speakers. A read-only sweep of the audio path
for the same shape finds three more, all in the *level* dimension:

- `nova` — `if (m.powerups.nova)` gates the held pad, so level 2 and 3 sound
  exactly like level 1. Could widen the voicing or lift the gain per level.
- `blackhole` — `if (m.powerups.blackhole)` gates the descending sub drone,
  same story.
- `magnet` — `mag > 0 ? root - 12 : root` drops the bar's first note an octave,
  binary. Could deepen or extend the sag with level.

Two more read as boolean and are **correctly** boolean, not defects:

- `timewarp` — half-time is a mode, not a magnitude. There is no "more
  half-time".
- `overdrive` — forces the arrangement to its top rung. A state, not a dial.

Applied. `nova` widens its voicing upward and opens its filter per level;
`blackhole` deepens its pitch envelope; `magnet` takes the fifth down with it at
level 2. `stacking` now covers all three — measured level 1 against level 3,
interleaved: drones 8.7 -> 13.3 events in the arp, nova 6 -> 7.7 and blackhole
2 -> 3.3 in the power lane.

Note what `stacking` does *not* assert: nova and blackhole add pitches to a
chord rather than extra events, so their event count need not rise at all — only
drones adds voices on the same rhythm. Asserting a count on all three would have
been asserting something that is not the feature.

That closes the class. Seven powerups had a signature that saturated; two more
(`timewarp`, `overdrive`) read as boolean and are correctly boolean.

## The field size moved (720x960 -> 900x1120)

Widened more than heightened, because lateral room is the axis dodging uses and
the stage is height-limited on screen, so a wider field is physically larger in
the window too. Player speed scaled by 1.15 against a field 1.25x wider —
deliberately less, so the ship covers less of the field per second.

**It broke `contrast` silently and completely.** That tool mapped world
coordinates to screenshot pixels with `png.width / 720, png.height / 960` — its
own copy of a constant the game owns. Every sample then landed on background and
it reported a bullet/background contrast of **0 across every groove**: a total
readability failure that was entirely the measurement's. It now reads
`world.width`/`world.height` from the running game and reports 203-397.

Worth generalising: a tool that hardcodes a value the program defines will lie
the day that value moves, and it will lie in the direction of *alarming*, which
costs a debugging session. Everything else in this directory derives the field
from `world.width`/`world.height`; the two remaining mentions of 720x960 are
prose in comments, now corrected.

- `content` — separates "feels short" from "feels uninteresting", which are
  different complaints. Result: a five-minute run reaches **wave 8**, meets
  **6/6 archetypes, 4/4 grooves, 8/12 powerups** and fights **one boss**, with
  54 kills. So the game is *not* short of material and is not failing to show
  it — exposure is close to complete inside five minutes.

  That points the "uninteresting" complaint somewhere specific: **event density
  and consequence, not variety**. 54 kills in five minutes is roughly one every
  five seconds against enemies that mostly die instantly, and only one boss
  arrives in that window. Fewer, slower, tougher enemies — which is exactly what
  was asked for — should raise the weight of each encounter rather than the
  count. It also means anything added past wave 8 is content most runs will
  never reach, so depth belongs early rather than late.

- `ttk` — time-to-kill per archetype and the player's effective dps, measured by
  parking one enemy in front of a firing ship rather than inferred from hp and
  damage constants (drones, spread and focus all change what actually lands).

  Baseline before the balance pass: pluck 0.22s, rush 0.22s, echo 0.40s,
  arpeggiator 0.62s, subdrop 1.52s, against ~22-28 player dps. **Most of the
  roster dies in about a fifth of a second** — that is "too easy" and
  "uninteresting" in one number, since an enemy that evaporates on contact is
  not an encounter. Exists because enemy hp and the player's weapon live in
  different files being changed by different hands, and raising one without
  watching the other turns "tougher" into "spongy".

- `starve` — does main-thread load starve the audio scheduler? A decisive
  **no**, and worth keeping precisely because it is a negative. Strudel's
  scheduler runs on the main thread and `framewhere` had measured 12-18 long
  tasks of 50-110ms per 15s from pattern queries, which made starvation the
  obvious explanation for choppiness that worsens when more is happening on
  screen. Jamming the main thread with synchronous busywork for 55ms out of
  every 100ms produced **zero** stalls (jitter 0.175 -> 0.218). The scheduler
  holds.

  That rules out an entire class of fix: no amount of render, HUD or simulation
  optimisation will improve the choppiness. It lives in the pattern layer —
  what the patterns contain, and what happens to a sounding note when the cache
  is swapped under it. A story about a mechanism is not a measurement of it, and
  this one cost nothing to settle and would have cost days to assume.

## Concurrency: freeze the page, always (tools/lib/frozen.mjs)

The old rule — "do not edit src/ while a browser check is running, because Vite
HMR full-reloads the page and wipes the check's state" — assumed one editor.
With three workstreams it is unenforceable, and it arrives as a crash
("Execution context was destroyed") or, worse, as numbers quietly averaged
across two different builds.

`freezePage(page)` mocks the HMR websocket so a measuring page cannot be
reloaded, and returns a counter so a run that reloaded anyway says so instead of
lying. **It is now applied to all 83 tools that navigate to the dev server.**
Written by the enemy-balance workstream, which hit the problem twice and fixed
it for everyone rather than routing around it.

Two fps gates in smoke.mjs also came out on the same pass — the last survivors
of a family removed from that file once before. They cannot mean anything here:
this browser rasterises on SwiftShader, and the number drops further whenever
another workstream has a browser open. `framecheck` measures a blank page in the
same session and judges the game against that control, which is the only version
of the question that transfers to real hardware.

## The rebalance (both workstreams), measured together

  ttk           time-to-kill 0.22-1.52s -> 0.45-1.79s; minimum doubled
  roster        shooters ~85% of enemies mid-game -> 25%
  forgiveness   a run absorbs 21 hits -> 18
  player dps    23.8, unchanged and deliberately so

Enemy hp and the player's survivability were changed by different hands, so both
were measured once over the combined result rather than each half checking
itself. That is the only way to catch two tightenings multiplying.

**`bosslength` was hiding a regression.** It filtered to *killed* fights before
checking duration, so a boss that ran the full 300-second budget without dying
was dropped from the sample and the check printed "BOSSES END". It did exactly
that when the roster got tougher: the wave-8 boss survived five minutes and the
gate said everything was fine. A timeout now fails louder than a slow kill.

**And then the regression turned out not to be one.** `bossdps` measured the
same unchanged build twice: 90.3% of the boss's health drained in 75 seconds,
then 0.0% drained in 149 seconds with the bar pinned at 100%. Player bullets
carry 2300-3000px of range against a 700px gap, so nothing is out of reach —
the only thing that differs is whether the dodging bot happened to line up under
a boss that weaves while it evades.

`bosslength` therefore cannot measure boss difficulty. It measures whether a
survival-first bot got shots on target, which against a moving boss is close to
a coin flip. I came within one edit of cutting boss hp to fix a bot limitation,
on the strength of a check that had *just* been made stricter and a second tool
that agreed by extrapolating a rate from the part of the fight where the bot was
engaging. Two tools agreeing is not corroboration when both depend on the same
actor.

## Choppiness: retention, not rate

Every fix aimed at this before targeted how *often* the director rebuilds. The
churn table says that was the wrong number:

  wave 2   chords 1.0/20%   arp 1.0/7%    lead 1.5/4%
  wave 25  chords 2.0/33%   arp 1.5/10%   lead 1.0/11%

(rebuilds per 10s / fraction of the phrase that survived one)

One rebuild per ten seconds is musically fine **if the material survives it**.
Four percent is not a rebuild, it is a different tune — the melody stops and
another starts, once or twice every ten seconds, forever. That is what "very
choppy, makes it unplayable" describes, and it is why the complaint outlived
every previous fix aimed at frequency.

The architectural answer, and the major refactor the user invited: **separate
what is played from how it is played.** Note content becomes a pure function of
(theme, phrase, bar) so a rebuild reproduces the phrase exactly; game state
stops choosing pitches and only chooses rendering — level, filter, density,
presence, extensions, register. Most of those are already signals, read per-hap.
A signal changes the sound of a note that is already scheduled; a rebuild
replaces the note.

## The choppiness, run down

"very choppy... choppy music makes it unplayable" was the complaint. Three
separate defects were behind it, and none of the twelve existing audio checks
could see any of them, because every one of them measures loudness, event
counts or fader positions.

- `gating` — how much of the time the melodic buses are held shut by the kick's
  sidechain. The kick carries `.duckorbit(low:harmony)`, and superdough
  implements that as automation on the *orbit output gain* — one node carrying
  every layer on that bus — so a duck does not thin the mix, it mutes it. The
  control superdough takes is not the floor either: it ducks to
  `1 - sqrt(depth)`, so `duckdepth(0.9)` reads as firm and is really -25.8dB.
  Measured, the sub, bass, chords, arp and lead were together more than 6dB
  down for 27-32% of the time with a floor of -16 to -20dB, three times a
  second. That is a gate, and a gate on everything with a tune in it is exactly
  what "choppy" describes. Now -6 to -7dB, 2-3% of the time, with the pumping
  rate unchanged.

  Two more things fell out of measuring it. The duck rode on the kick *pattern*,
  which keeps playing at postgain 0 when the arrangement mutes the kick — so a
  breakdown, an intro and the collapse were all pumped by a kick nobody could
  hear. And the recovery was a fixed 0.24s against a kick reaching six hits a
  bar at 176bpm, so it could never finish before the next duck cancelled it.
  Depth and recovery are now signals rather than values frozen into the pattern
  at build time, so both track the kick's own fader and the tempo with no
  rebuild involved.

  It reconstructs the automation arithmetically rather than sampling audio,
  which is exact and immune to the headless browser's frame timing. Its control
  is that exactly 2 of ~700 automated gain params are identified as duck
  targets; the drum bus is never one of them.

- `rebuildstable` — how many different sets of notes one rebuild key can
  produce. The answer has to be one: the key is what the director uses to decide
  whether anything has changed. `structureKey`'s own comment claims "the
  difference between intensity 0.61 and 0.64 does not change a single note of
  the patterns these values select", and that was false — the key was coarse but
  the builders were handed the raw value, which they threshold in nine places
  including the melody's own density. Sweeping intensity across its range found
  **7 keys producing 13 distinct sets of notes**: the director believed it was
  in seven states while the music was playing thirteen. So a rebuild triggered
  by an enemy dying rewrote the tune. Now 7 keys, 6 note-sets, and 0 of 11 stems
  ambiguous at any wave.

  The related path-dependence: chord voicings were led from the previous
  *rebuild* rather than the previous phrase, so each rebuild walked the voicing
  further and re-inverted all eight chords. The seed is now pinned per phrase,
  which makes a mid-phrase rebuild reproduce the chords already sounding.

  Two weaker designs came first and are recorded in the file. Rebuilding twice
  with every input held still *passed on the broken build* — holding inputs
  still cannot detect over-sensitivity to inputs. Nudging by a fixed 0.02 then
  scored a few hits on both builds, because the nudge sometimes straddled a
  bucket edge, which is a real change. Grouping by the key removes the confound.

- `voicing` — a stacked voice has to be at a different pitch from the voice it
  is stacked on. `buildLead` stacks its line an octave below itself and adds a
  descant a sixth above; `buildArp` transposes each DRONES satellite so, in its
  own words, "you can count your drones with your ears". None of it sounded.
  Every one was written `.add(transpose)` with a bare number, and adding a bare
  number to a control pattern does nothing at all: Strudel unions `{note: 77}`
  with `{value: -12}`, finds no field in common, logs `[warn]: Can't do
  arithmetic on control pattern` and returns the left side unchanged. A query of
  the lead returned `[77,77]`, `[80,80]`, `[82,82]` — two voices, one pitch, for
  the whole life of the project. The warning fired 52 times in twelve seconds,
  to a console nobody was reading. The idiom is `.add(note(n))`.

  Every other check would have passed it. `voicecheck` and `descant` count
  events and compare levels, `mixaudit` measures loudness, `stacking` counts the
  notes a powerup adds — and the note count was right. Only the pitches were
  wrong. So this one asserts on pitch, with the sub as its control: a
  deliberately single voice that must report exactly one pitch per onset.

- `phrasechurn` — how often a stem's eight bars of notes are replaced during
  live play, and how much of the phrase survives. Kept as the tool that found
  the problem and then could not settle it: at wave 25 the lead's phrase was
  replaced 3.4 times per ten seconds keeping 11% of its notes, which is what
  sent this line of enquiry in the right direction. But total churn at wave 17
  read 11.5 and then 27.5 on two runs of an unchanged build, because what the
  game happens to be doing dominates. It reports; `rebuildstable` decides.

  It does have a genuine control: every stem is hashed twice in the same tick
  and the two must match, which proves no signal-driven value has leaked into
  the hash and turned a filter sweep into "the notes changed".

- `chop` — an envelope follower in an AudioWorklet, on the audio thread, one
  value per 128-sample quantum. Three of its own versions were wrong and all
  three are documented in the file; two were caught only by its controls. Worth
  reading before writing any new audio-domain check here:

  1. Its monitor path was routed to the destination through the same patched
     `connect` that builds the tap, so the graph contained a cycle. Chrome
     renders a cycle with no DelayNode as silence, and every condition scored
     zero.
  2. Conditions were applied by passing `() => {...}` to `page.evaluate` as a
     **template string**. Playwright evaluates a string as an expression, so
     each one produced a function object that was never called: eleven rows
     silently measured the same untouched run and looked entirely plausible.
  3. A `> -55dBFS` guard meant to stop silence counting as a chop deleted
     exactly the gaps between hi-hat hits, so the positive control came out
     quieter than the drone it was supposed to outrank.

  **It could not settle the sidechain question, and that is the honest result.**
  Soloing a stem pins its fader but does not stop the arrangement moving
  underneath it, so a stem's swing over an eight-second window is mostly a
  measurement of which section it landed in. Measured across one before-run and
  two after-runs, the pad read 18.6, 20.5 and 25.7dB with per-run spreads of
  3.1, 16.4 and 5.0 — the spread is the same size as any effect being looked
  for. `gating` answered the question instead, by reconstructing the automation
  arithmetically rather than listening to its result. Kept because the failure
  modes above are worth not repeating, and because the full-mix row is stable
  enough to notice a gross regression.

`tools/lib/reload.mjs` — the page can be reloaded out from under a measurement
by any edit under `src/`, and this repository is worked on by more than one
process at a time. A reload drops the game to the title screen, where nothing
is playing, which reads as a *perfect* score on every audio metric — the
quietest, cleanest rows this project has ever printed were a dead page. The
helper detects the navigation and re-runs the affected window. The existing
warning in this file only helps the person who caused the reload; this helps the
tool that suffered it.

None of the five is in `verify` or `verify:all`, because `package.json` was out
of scope for the change that added them. Run them directly:

    node tools/gating.mjs
    node tools/rebuildstable.mjs
    node tools/voicing.mjs
    node tools/phrasechurn.mjs
    node tools/chop.mjs

### Retention, per dial (tools/retention.mjs)

  intensity  hats 20%  sub 20%  bass 33%  kick 65%  clap 76%
  register   lead 33%
  tension    nothing changed

One step of a dial replaces most of a lane. The tool is trustworthy because it
carries both controls: two rebuilds at identical dials overlap **100%**, and the
sweep produces 6/6 distinct note-sets, so it can tell "deterministic" from
"unresponsive".

**Not all of this is a defect, and the difference decides the fix.** Register
moving the lead is a deliberate feature — the melody follows the player up the
screen. If a step *transposes* the line, a note-set comparison reads 0% overlap
while a listener hears the same tune moved; that is musically continuous. Hats
thickening with intensity is likewise the arrangement responding, which is the
point of the project.

So the target is not "freeze the notes" but **changes must be monotonic on the
existing skeleton**: a step up adds onsets between the ones already there, a
step down removes, and whatever was sounding stays where it was. That yields
high retention *and* keeps every response. A lane like `sub` — a root note on a
grid, 20% kept for one intensity step — has no such excuse and is a straight
bug.

### The retention refactor landed

  no tune lane changed its notes on any dial: lead, arp and chords are now
  invariant under intensity and tension, and transpose as a unit under register

`register lead notes 33% rhythm 100%` is the shape that matters — the melody
moves as a unit rather than being regenerated, so the "melody follows the player
up the screen" feature survives intact while the churn does not. Percussion
density still responds to intensity, which is the arrangement doing its job.

**`descant` failed on this and it was the check's fault, not the refactor's.**
The director now defers non-urgent rebuilds to a lazy tier that coalesces per
phrase — about fifteen seconds — and the check waited six. It reported "THE
DESCANT NEVER ARRIVES" for a feature that arrives reliably: measured directly,
the lead goes from 8 notes cold to 15 with the multiplier up. Failing on
someone else's deliberate latency is not a finding, and a fixed sleep is the
wrong shape for any check downstream of a change in *when* work happens.

## Retention, not rate

The first pass at the choppiness cut the *number* of rebuilds and proved that a
rebuild key maps to exactly one set of notes. Both were real, and neither was
the complaint. The number that matters is how much of the eight-bar phrase
survives a rebuild that legitimately happens: one rebuild per ten seconds is
musically fine if the material survives it, and a rebuild that keeps 4% of the
melody is not a rebuild, it is a different tune. A listener does not hear "the
arrangement was regenerated"; they hear the melody stop and another one start,
twice every ten seconds, forever.

- `retention` — sweeps the arrangement's own dials (intensity, tension, lead
  register) through their ranges inside one synchronous tick, forces a full
  rebuild at every step, and measures the overlap of the notes either side of
  each step. Nothing drifts because nothing else is allowed to move, which is
  what `phrasechurn` cannot promise — it read 11.5 and then 27.5 at wave 17 on
  an unchanged build, because what the game happens to be doing dominates.

  It reports two overlaps and the difference between them is the point. NOTES
  includes pitch; RHYTHM does not. A melody moving up an octave keeps 0% of its
  notes and 100% of its rhythm — the phrase did not stop, it moved as a unit,
  which is the feature where the tune climbs with the ship. Judging the register
  dial on note overlap alone reports the game's most direct musical coupling as
  a defect, so the verdict runs on rhythm.

  Before: one step of the intensity dial left the arp with **15%** of its
  phrase, the hats 20%, the bass 33%, the lead 50%, the chords 60-67%; one step
  of tension left the arp 44% and the chords 75%; one register flip left the
  melody 33%. After: **lead, arp and chords do not change at all** under
  intensity or tension, the low end does not change under either, and the melody
  transposes as a unit under register (rhythm 100%). What still moves on
  intensity is percussion — kick 65%, clap 76%, hats 20% — which is the
  arrangement working. A busier kick pattern is a drop landing; a replaced
  melody is the defect. That distinction is the whole design.

  Its verdict caught one of its own regressions, which is the best argument for
  it: the kick vanished from the table entirely after an edit meant for
  `buildBass` also landed in `buildKick`, because Python's `str.replace`
  replaces every occurrence and the two functions contained a byte-identical
  line. The kick had silently stopped responding to intensity — a drop with no
  drop in it — and nothing else in this directory would have said so. Same
  family as the stylesheet warning above: anchor replacements on text that is
  unique, or assert the match count.

- `polyphony` — how close the mix gets to the voice cap, added because the fix
  above created the risk. The arrangement's dynamics used to work by adding and
  removing notes; they now work by fading notes that are always scheduled, so
  every one of them costs a voice at all times. When `activeSoundSources`
  exceeds `setMaxPolyphony`, superdough ramps the OLDEST voices to zero over
  0.25s — and the oldest voices are the sustained ones, so hitting the cap
  sounds like the pad cutting out mid-chord. Trading one cause of choppiness for
  another would be a poor bargain. Verdict: peak 59 of 96 with five powerups
  held, against 57 before the refactor. The control is the title screen measured
  in the same session, which must report zero live voices.

What changed in `src/audio` to move those numbers, in one sentence each: the
melody's cell renders as a skeleton, a filigree and an ornament that always all
exist and are balanced by signals, instead of one renderer that deleted the weak
beats below an intensity and added a passing note above another; the arp's pitch
walk is computed over every gap rather than over the gaps currently switched on,
so filling one adds a note instead of moving all of them; the chord's 7th and
9th live in `Chord.colour` and swell in on their own signals rather than being
switched into `chord.notes`, which had been shifting the arp's walk underneath
it; the lead's register is `sig.register` applied to the notes rather than added
into them, and lands on a bar line; and the sub and the bass — genuinely
different lines that cannot be layered — take their shape from the section
instead of from a continuously-moving intensity.

The general rule the refactor follows, and the one to keep: **anything that can
be a signal should be, because a signal changes how a note sounds instead of
replacing it.** Game state chooses how the music is played; the theme, the
phrase index and the bar choose what is played.

### Additive, not frozen

Driving retention up by freezing lanes is the wrong fix and `retention` was
briefly measuring it as the right one. The sub and the bass were first made
section-driven, which scored perfectly — because they had stopped responding to
intensity at all. In a game whose whole idea is that the music answers the play,
that is a worse outcome than the churn it replaced.

Two changes to the instrument fixed the target it was aiming at:

- The headline is **nesting**, `max(|A∩B|/|A|, |A∩B|/|B|)`, not overlap. It is
  1.0 exactly when a step only *added* material or only *removed* it, and falls
  only when material is swapped. Both alternatives are wrong in opposite
  directions: Jaccard punishes a pure addition — eighths becoming sixteenths
  scores 50% with not one existing hit moved — and directional survival punishes
  every removal. Optimising against either pushes the arrangement toward
  standing still.
- **Transposition is detected, not assumed.** If every pitch moved by the same
  interval and no onset changed, the row prints `TRANSPOSED +12` and is exempt.
  The melody's register following the ship shares no notes with what came before
  by definition, and rhythm alone cannot make the call either — a line
  regenerated on the same grid also keeps its rhythm. The interval is checked
  directly.
- A **gain-response line** prints how far each lane's summed loudness travels
  across the intensity sweep. Nesting at 100% can mean "additive" or it can mean
  "inert", and those are opposite outcomes; several lanes now answer intensity
  purely through gain signals, with no rebuild at all, and nothing else in the
  table can see that.

With that instrument the picture was: kick 100% nested and clap 100% — already
additive, not defects — and **hats 45%**, the one lane genuinely swapping
material. The cause was that `s("white*div")` changes every hap's *length* as
well as the grid, so going from eighths to sixteenths kept not one hit even
though half of them land at the same instant. Hats are now three layers on a
fixed sixteenth lattice — quarters always, eighths and sixteenths fading in over
them — and RAPID and the answering bars raise the floor under the finer layers
instead of doubling a division. The 18ms envelope means a hap's length was never
audible anyway, so this costs nothing musically. The sub and the bass went back
to answering intensity, layered the same way on their own lattices.

Final: every lane 100% nested or a detected transposition, and every lane still
moves with intensity — sub 83%, kick 68%, hats 67%, chords 64-76%, bass 64%,
arp 50%, lead 48%, clap 38%. `polyphony` peak 50 of 96, lower than before the
layering despite far more scheduled notes, because the added hits are short.

`hatDivision` and `hats()` were deleted rather than left in place. A generator
nothing calls is a generator that will drift from the one that plays, and the
MIX panel had been mirroring `hatDivision` — it now prints the layer gains.

## Knock-on effects of the rebalance

**A budget denominated in an event whose rate you are changing will move under
you.** The guaranteed-drop pity timer counts KILLS — 9, then 6 when a kill
happened every ~4.8s. Making the roster ~2.5x tougher took a run from 42-54
kills to 20-25, so the guarantee silently tightened exactly when the game got
harder: `deadair` measured the player holding no powerup **75%** of the time
against 15-20% before. Pity timer 6 -> 3, uptime back to 51%.

**Small enemies were strictly harder to shoot, and that was a bug not a
difficulty.** Player-bullet-versus-enemy used a plain `e.radius + bullet.radius`
with no leniency, while enemy-versus-player contact has always used a forgiving
0.62 factor. There is now an aim bonus that decays to zero by radius 16 — pluck
and smaller benefit, bosses untouched. It buys aim, not damage.

It did **not** fix `stutter` (still 1.84s at effective dps 3.3), and `ttk`
cannot answer why: the harness pins the target every 50ms while the sim runs at
120Hz, so a hopping enemy slips between pins and dodges shots a stationary one
would eat. That is a limitation of the instrument, not evidence about the enemy.

## Movements: new material after wave 8

The "rather uninteresting" complaint measured out as a novelty curve that
flattens exactly where the difficulty curve steepens — every archetype met by
wave 8, and only quantity changing after. Rescheduling existing content was
tried twice and measured worse both times (see waves.ts).

So from wave 9 every third non-boss wave runs under a named rule, using the same
roster arranged differently: **FLANKED** (they enter from the wings),
**SOLOIST** (one enemy carrying the group's health and score, at 1.35x size),
**HUSHED** (nothing shoots, but they arrive 90px closer). Named in the banner,
because a player should know the game did something rather than wonder why a
wave feels odd.

**HUSHED did not work at first, for an instructive reason.** Setting
`armedChance` to zero left it at 50% armed: `spawnGroup` arms the first enemy of
every group via a `guaranteed` flag written for ordinary waves, which silently
overrode the movement's single rule. That same override is why a low
`armedChance` never produced as few shooters as it claimed — a general hazard of
adding a mode to code with existing unconditional guarantees in it.

Measured: HUSHED 0% armed (was 50%), SOLOIST 178hp against an ordinary wave's
16, arriving 240px down instead of 170.

## The choppiness refactor, finished

  no lane changed at all on any dial (or every change was a transposition)
  changes are additive: what was sounding stays where it was
  responds to intensity by gain: kick 68% clap 16% hats 67% bass 64% chords 72%

The arrangement still responds to the game — it responds by **rendering** rather
than by regenerating. A signal changes the sound of a note that is already
scheduled; a rebuild replaces the note. Getting that boundary right is what took
the choppiness out without freezing the responses that make the game what it is.

## The melody, rewritten as periods

"the current melody is lame... i think more melodic, you can ease on the pop
style melodies, maybe take some inspiration from classics". Four things were
wrong and none of them was the sound of the lead:

- **The phrase was a one-bar loop.** `cellForBar` mapped bars to cells by
  `floor(bar / 2)`, so the a-a'-b-tag layout played each one-bar cell TWICE.
  Eight bars contained three bars of material and the longest stretch before
  something repeated was one bar — shorter than the pop writing it was meant to
  be an alternative to.
- **The development was applied per two-bar section**, so one phrase could open
  with an inversion and answer it with a retrograde. Two different
  transformations of a cell standing next to each other do not read as
  statement and answer, they read as unrelated.
- **Two of the six transforms silently deleted the tune.** `retrograde` maps
  slot i to slot 7-i and `displace` pushed everything one slot late; both send
  every on-beat note to an offbeat. The melody's offbeats are faded to a fifth
  when the game is calm, so a bar that had been developed that way all but
  vanished in a quiet passage. One of the eight original themes was written
  entirely on offbeats and had no skeleton at all, ever.
- **The harmony changed every bar**, which is exactly the rate the tune's own
  phrase unit changed at, so every note landed on a chord tone and the line
  read as an arpeggio with the harmony spelling it out.

Now: an eight-bar parallel period (basic idea, contrasting idea ending open,
the idea again developed, high point and cadence), one variation slot per
phrase rather than four, `PROGRESSIONS` holding all eight bars with the tonic
held for two under the opening, and both cadences running through the dominant.

- `phrasing` (`node tools/phrasing.mjs`, no npm script) — judges the writing as
  writing. Everything it asks about is a static property of THEMES and the cell
  functions, so it imports them off the dev server rather than listening:
  distinct bars per phrase, on-beat coverage, whether each offbeat note is a
  passing or neighbour tone of the frame around it, step-to-leap ratio and
  whether every leap is answered, one high point per phrase, an antecedent that
  ends open and a last bar that reaches the tonic and stops. Its thresholds are
  exact rather than generous because every number in it is deterministic —
  nothing here can sit in its own noise.

  Three of its own measurements were wrong first, and all three were wrong in
  the direction of alarm:

  1. It counted an on-beat note outside the triad as a dissonance needing
     resolution, which flagged every 7th and 9th — the notes `Chord.colour`
     already puts in the pad. Every "unresolved dissonance" in the two
     consonant modes was one of those.
  2. It then counted clashes against the colour tones themselves, which are a
     fader that is mostly down. A clash is now measured against the triad only.
  3. It demanded a leap be answered by a step back even across a two-beat rest,
     which is the phrase's own comma. Every exemption is the antecedent
     breathing before the consequent starts.

  It also reads the pad as three parts: voice crossings, parallel fifths and
  octaves, and how often the top voice moves. Zero and zero, everywhere.

- `counterpoint` (extended) — the arp answering in the melody's rests was only
  half of an independent part; it climbed the chord in the same direction
  whatever the tune did. It now starts at the top of the chord and walks down
  when the tune rises, and the reverse when it falls. 6 of 6 bars contrary, 0%
  collision.

  The first version of that rule read the tune's direction as its first note
  against its last, and measured **4 of 6**. The signature theme's opening bar
  leaps up a sixth and then walks down four times: end to end it "rises", and
  what a listener follows is a descent. Direction is now the majority of the
  steps.

## Harmonic rhythm, and the pad as a part

Second pass on the same complaint. Two things were still pop about the writing.

**The progression addressed a bar at a time.** Even after it grew to eight
entries it could only say "a chord per bar" and happened to say the same one
twice. It is now spans — `[[0, 2], [5, 2], [2, 2], [4, 1], [0, 1]]`, a degree
and how many bars it lasts — so the harmonic rhythm is composed rather than
implied: four chords over six bars and then two chords in two bars. That change
of gear is most of what makes a cadence sound like an ending rather than like a
chord that happened next. 1.6 bars per chord in five modes, 2.0 in locrian,
which holds one chord for four bars because a mode with no stable tonic is what
a pedal is for.

**The order of the two middle chords was chosen by measurement, not taste.**
Dorian with IV under the contrasting idea and VII under the restatement left 17
on-beat notes clashing with the chord and 9 of them resolving; swapped, it is 8
and all 8 resolve. Phrygian with bII sitting under two whole bars read 27 clashes
at 56%; moving it to the cadence bar — where the Phrygian cadence wants it
anyway — gives 9 at 67%. The tune is written in scale degrees and the mode
changes underneath it, so which chord sits under which bar is a real decision
with a measurable answer.

**`voicecheck` broke on that change and nobody would have known.** It built its
own chords from `PROGRESSIONS.aeolian[i]` as a bare degree, so a span read as an
array, every pitch came out `NaN`, and it printed "voice leading not effective"
— then exited 0, because it was one of the five checks that could not fail. It
now asks `chordForBar` for the chord, which is the function the director calls,
and it exits non-zero. Same lesson as `contrast` and the field size: a tool that
keeps its own copy of something the program owns will lie the day that moves.

### Contrary motion in the pad: three wrong versions

The lead and the pad moved as melody-plus-accompaniment because nothing chose
the pad's motion in relation to the tune, and `voiceLead` cannot see the tune —
it gets a chord and the voicing before it, and the director, which knows, is not
editable from here. What it CAN know is that the melody's shape is a property of
the period rather than of any one theme. Measured, the mean scale degree per bar
over all six themes runs 1.9 3.1 3.5 3.8 1.9 3.1 **5.2** **1.0**, and every
theme individually peaks at bar 7 and bottoms at bar 8. So the bar carries the
direction, `chordForBar` writes it into the chord, and it arrives through the
value the director already passes.

Three versions of what to do with it were wrong:

1. **A bonus for displacement** ("move down at bar 7, up at bars 5 and 8")
   ratcheted. The leans do not sum to zero over a phrase and nothing pulled
   back: by the fourth phrase the pad had climbed an octave, top voice at MIDI
   81, in a project whose standing complaint is that it sits too high.
2. **Preferring the lower of the voicings that exist this bar** cannot
   accumulate, and still could not move the top voice in more than 2 of the 6
   modes at any weight. Three-note triads in compact stacks anchored on the
   previous bar do not offer a lower candidate most of the time. A rule that
   demands a particular direction is a rule the material cannot always obey.
3. **Banning similar motion outright** then failed its own rule two bars in
   eight in aeolian and phrygian — and the "offending" voicing was 57,60,65
   against 57,60,64: two common tones held and the top moving one semitone,
   which is the best voice leading available and does not stop being that
   because the melody also happens to rise.

What landed is the rule counterpoint actually has: contrary motion is best,
oblique motion — one part moving while the other holds — is normal and is most
of what an inner voice does, and only both parts LEAPING together welds them
into one line. Measured over two settled phrases in all six modes: **contrary
10, oblique 72, similar by step 14, similar by leap 0.**

Two register bugs fell out of measuring it, both invisible before:

- **The pad was a random walk with good manners.** Every voicing is chosen
  relative to the one before it and nothing was absolute, so it drifted. The
  bottom voice now takes its octave inside a twelve-semitone window from the
  bottom of the range — twelve exactly, because a narrower one would not contain
  every pitch class and some chord would have nowhere legal to put its bass.
- **And it floated into the tune's register in two modes out of six.** Dorian
  and phrygian dominant settled at 62-74 while the other four sat at 55-65 —
  a pad in the middle of the melody's own octave in a third of the modes. There
  is now a soft charge for the top voice going above the melody's floor. All six
  settle inside 55-71.

A soft "distance from home" penalty was tried for the first of those and could
not work: all three candidate voicings anchor near the same previous pitch, so
there was never a lower candidate for it to prefer. The fix had to be in the
octave choice itself.

### Cadences that suspend

Three of the six themes now arrive through a prepared suspension: the last note
of bar 7 is a tone of the dominant, the downbeat of bar 8 sounds it again over
the tonic where it is a dissonance, and the next beat resolves it down by step.
`phrasing` checks all four halves of that separately — prepared, on the
downbeat, dissonant, resolves down — because three of them are true of a lot of
notes that are not suspensions. Only three themes have one: a cadence that is
always the same gesture stops being a gesture.

**Two refinements to `voiceLead` were measured as inert and one was deleted.**
Rank-pairing the voices and searching the inversions changed the voicings
substantially — that is the fix, and it is what stops the middle voice landing
where the top voice was. Weighting the top voice's movement, and then charging
it for standing still, produced byte-identical voicings in all six modes.
A rule that changes nothing is a claim the code does not deliver. The
parallel-fifths penalty is also inert with the six progressions here and was
kept deliberately, because it constrains the search rather than describing the
result and the progressions get edited far more often than the function does;
`phrasing` asserts the property directly so the claim stays checked.

**A footnote on discipline.** `counterpoint` failed once at 22% against a 20%
gate and I reported it to the audio workstream as a regression, telling them in
the same message to run it two or three times first because a marginal failure
in this repo is usually a threshold sitting in its own noise. It read **0% on
both re-runs**. The advice was right and I had not taken it myself before
sending — the re-run costs four minutes and the phantom hunt costs an iteration.

## The named waves

- `movements` — a wave the player is told about has to be a wave they can hear.
  From wave 9 every third non-boss wave runs under one rule, announced by a
  banner: FLANKED (`flank`) enters from the wings, SOLOIST (`elite`) is one
  enemy carrying the whole group, HUSHED (`hush`) never fires but presses
  closer. They were measurably distinct to play and sounded like ordinary
  waves, which for a game whose premise is that the stage and the score are the
  same thing is the premise failing.

  Each gets a gesture rather than an effect — something an arranger would do,
  not something a synthesiser would do. HUSHED is the interesting one: it is the
  quietest the stage ever gets, so the arrangement OPENS rather than merely
  subtracting. The kit steps back, the lead takes the long-tailed treatment the
  breakdown already uses, and the chord's 7th and 9th are floored open, which is
  the same statement nova makes with harmony — safety as harmonic space. SOLOIST
  puts the lead in front and lengthens its sustain, because a soloist sustains
  and does not pluck, while the arp and pad drop behind. FLANKED splits the
  arp's two interleaved lines to opposite wings and sends the chord's two colour
  tones one to each side, so the same notes arrive from either side and meet in
  the middle.

  The per-stem level part lives in one `MOVEMENT_MIX` table so the balance can
  be read at a glance; the parts that change how a note is *made* rather than
  how loud it is stay in the builders. `movement` is an IMMEDIATE field of the
  rebuild key: a stage that says FLANKED and goes on sounding like the last one
  is worse than any glitch.

  **The control is ordinary against ordinary**, and it is the only reason the
  verdict means anything — `everypowerup` once reported all twelve powerups
  working because it compared two moments 2.4s apart, and with nothing held that
  comparison differed 6 times out of 6. Two of this tool's own designs were
  wrong before one was right:

  1. Jump to a wave, hold eleven seconds, attribute what you hear to that wave.
     The bot clears a wave in less than that, so the game had moved on under
     every window and all five rows came back reporting the same movement.
     Samples are now filed under whatever the game says it is running at the
     instant of the sample, 25 times a second, which removes the race entirely.
  2. Split the ordinary samples in half BY TIME for the control band. That
     compares waves 9-21 against 22-34, which differ by design — different
     grooves, keys, more on screen — so the band came out at 0.10 of stereo
     width and swallowed a real effect. Alternating waves between the two halves
     measures the arrangement's variability instead of the run's arc, and the
     band fell to 0.02.

  Verdict: HUSHED moves the low/air balance 58% against an 11% band, SOLOIST
  moves lead-over-accompaniment 37% against 2%, FLANKED moves stereo width
  0.15 against 0.02.

- `counterpoint` now measures at SIXTEENTHS. It read 22% against its own 20%
  gate and looked like a regression from the retention work. It was not, and the
  distinction was settled by measurement rather than argument: over 180 arp
  notes at wave 17, **22% collided under the old `Math.round(t * 8)` bucketing
  and 0% landed at the same instant**, with the only off-grid lead onset at
  eighth-position 3.500. That is the melody's ornament, an upper neighbour on
  the second half of its slot, which eighth-note rounding pushes up into the
  next bucket — an arp slot. A passing note a sixteenth ahead of the arp is the
  melody leading into it, not the arp doubling the melody, which is the thing
  the check exists to encourage.

  Worth keeping as a warning about resolution: a rhythmic assertion is only as
  true as the grid it quantises to, and the grid has to keep up with the music.
  Three runs of the check before touching anything is what stopped this becoming
  a fix to working code.

### One regression the movements work did cause

Splitting the hats into three layers attenuated the finer ones TWICE — a level
cut and a lower velocity — so a sixteenth hit came out at 0.083 against the
0.147 the old single-pattern hat averaged. Since sixteenths are most of the hits
in a busy bar, the whole lane dropped: `mixaudit` read the hats at -30.7, -29.4
and -16.4dB under the loudest layer against a gate of 30, where before the split
they sat mid-pack. One attenuation is the accent; two is a mistake. The layers
now share one level and the accent lives in `velocity` alone.

Note what settled it: `mixaudit`'s hats reading has spanned 30dB across runs, so
no single reading could have. Its own caveat says it can only catch a totally
absent layer, and the way to use it is to run it three times and read the trend.

## Does it still chop? No.

`chop` now carries a real hole detector alongside the swing table, because
swing answers the wrong question: it says how far a layer's level travels, not
whether the travel is a smooth fade or the sound stopping, and only the second
is what "choppy" means. A HOLE is the envelope sitting 18dB under the local
level for between 25 and 400ms. The follower runs on the audio thread at one
value per 2.67ms, so a 25ms gap is nine samples deep.

Both bounds took a wrong version to find, and both are worth keeping:

- **Without the upper bound it counted breakdowns.** The full mix came back at
  0.21 holes/s covering 14.3% of the time — gaps averaging 0.68 seconds, which
  is a musical rest and the arrangement doing its job. A chop is short by
  definition.
- **The reference has to be local.** One reference level for an eight-second
  window makes a breakdown eight decibels down read as one continuous hole.
  It is now the peak over a second either side. An earlier attempt used ±250ms
  and failed the opposite way, with the reference sinking into the gaps between
  hi-hat hits and reporting a pattern that is mostly silence as continuous. The
  window has to be long compared to the thing being measured.
- **The positive control is the hi-hat, not the kick.** The kick was the obvious
  choice and is wrong: four-on-the-floor at 130bpm leaves ~450ms between hits,
  which is longer than a chop, so its gaps are correctly classified as rests and
  it scored 0.70/s against a `> 1/s` gate. The detector was working perfectly
  and the control said it was broken. A hi-hat at sixteenths leaves ~100ms,
  squarely inside the window a chop lives in.

Verdict after the four fixes (invariant note content, legato sustains, the
octave correction, and taking the melodic bus out of the sidechain):

    positive control — hats   6.3-7.0 holes/s, 57-59% of the time
    negative control — pad    0.3-0.5 holes/s,   2-4% of the time
    FULL MIX                  0.00-0.12 holes/s, 0.0-1.4% of the time

The detector demonstrably sees a 100ms gap seven times a second on the hi-hat
and finds essentially none in the mix. **The music does not stop.**

One caveat on the same output: the SWING column is not stable and should not be
read as a verdict. The full mix scored 7.9 and then 29.1 on two runs of the same
build, because an eight-second window may or may not contain a breakdown. The
hole metric is immune to that by construction — the local reference is what
buys the immunity — but swing is not, and nothing in this repo should be
concluded from it.

## The palette, not the notes

"too much high pitch synth always playing, its taxing on the ears... more
melodic, you can ease on the pop style melodies, maybe take some inspiration
from classics."

The registers and envelopes had already been fixed; the timbres had not. Every
sustained layer was a supersaw, the arp was a resonant acid line, and the
metallic ping was FM on a square — the sound of EDM, and specifically of the
2.5-6kHz band the ear is least able to ignore. Sustained saws are far more
tiring than sustained anything else, so the envelope fixes that made the music
legato had also made it harder to sit under: `audiocheck` read HARSH at 18%
during a drop.

What changed, and why each one is the softer choice rather than merely the
quieter one:

- **The melody is a triangle over a filtered saw.** A triangle carries only odd
  harmonics falling as 1/n², which at this register is a flute rather than a
  synth. A triangle alone is too polite to lead, so the octave below stays a
  sawtooth, low-passed hard — the bright instrument doubling the sweet one an
  octave down, which the ear reads as one voice. It costs no extra voices,
  because the octave doubling was already there. Ceiling 6.5kHz → 4kHz: above
  about 4kHz a melody gains no pitch information, only edge.
- **The pad is a filtered saw**, ceiling 2.6kHz → 1.9kHz, resonance 1.4 → 0.9,
  detune narrowed. Wide detune on a stab is a swell; on a chord held for a whole
  bar it is beating that never settles, in exactly the wrong band.
- **The 7th and 9th are triangles.** They are the highest sustained pitches in
  the mix and so the worst possible place for a saw's harmonic series.
- **The stabs lost three of their seven voices** and most of their filter
  envelope. Seven detuned saws is a festival lead; stacked over a sustained pad
  it was most of the 18%.
- **The arp lost the acid filter** — `lpq(7)` with `lpenv(4)` sweeps a resonant
  peak through the fatigue band on every note — and became a triangle.
- Smaller: FM ping on a triangle carrier rather than a square, riser resonance
  Q6 → Q2.5, hats topping out at 10.5kHz rather than 13, snare at 8.5kHz, less
  saturation on the bass and the conductor pedal.

Measured, two runs each side:

    HARSH band     opening   mid-run   firing   drop
    before            12%       14%      13%     18%
    after          10-11%      4-5%     5-6%    7-8%

The energy moved into `lomid` and `mid` — the body of the music — rather than
disappearing: `air` is unchanged at 4-11%, so the mix is softer rather than
duller. `mixaudit` still passes, `retention` still reports additive changes,
`gating` still reports one ducked bus, and `chop` still reports the mix does not
stop.

Note what was deliberately NOT touched: THEMES, DEVELOPMENTS, `cellForBar`,
`melodyForBar`, `chordForBar` and PROGRESSIONS. Timbre and note content are
separable and were separated — this pass changed what the instruments are, not
what they play.

## The structural half of "choppy"

Four causes of choppiness were fixed at the note level — wholesale rebuilds,
`sustain: 0` envelopes, everything two octaves too high, and the kick
sidechaining the melody three times a second. The complaint survived all of
them, so `keyrate` asked a different question: how often does the *music* change
rather than the *notes*.

  key changed every 20s — eleven distinct keys in four minutes

The tonic moved by a fourth on EVERY wave. A listener never gets long enough in
one tonality to know where home is, and music that keeps relocating reads as
unsettled however smooth each layer is. No envelope or rebuild fix could ever
have touched it. Now every fourth wave: **a modulation every 80 seconds, four
keys in four minutes**, using the same cycle of fourths as an event rather than
as a metronome.

**One measurement trap worth keeping.** The same tool reported the arrangement
changing section every seven seconds, which looked alarming. Most of it was the
once-per-phrase one-bar fill being counted twice, in and out. A fill is an
ornament, not a section. Excluding it, the real rate is every eight seconds —
sections sitting on their MIN_BARS floors, which is a genuine lever but a much
smaller one, and it is entangled with the drop/breakdown balance tuned earlier.

## The adversarial pass: there is no sixth discontinuity

Five causes of choppiness had been found and fixed and the complaint had not
moved, so this pass assumed we were still wrong and went looking. Every angle
was measured on the OUTPUT, with a null, and every one came back clean.

- `seams` — is there a hole where the music joins itself? Section changes, the
  eight-bar `cat` wrap, the one-bar fill, and every bar line are marked from the
  game's own state, and the deepest dip in a ±260ms window around each is
  compared against **the same window cut at random times in the same audio**.
  That null is the whole tool: music dips constantly — a note ending is a dip —
  so a seam only means something if it dips MORE than an arbitrary instant.

      SECTION  n=16   median -10.7dB     -0.5dB against an arbitrary moment
      WRAP     n= 9   median -10.5dB     -0.3dB
      BAR      n=63   median -10.4dB     -0.2dB
      RANDOM   n=88   median -10.2dB

  Bar lines matter most and were missing from the first version, which was a
  real hole in the method: the pad is one hap per cycle, so it re-attacks every
  bar with a 0.45s attack over the previous note's 0.9s release. If those did
  not sum flat there would be a dip every 1.7 seconds. They do. Measuring only
  the phrase wrap would have missed it seven times out of eight.

- `layerpop` — does a layer pop in or out? `stemLevel` is genuinely
  discontinuous: it returns 0 below the stem's `in` threshold and `c.floor`
  (0.16-0.34) immediately above, so crossing `in` is a step rather than a fade,
  and the comment above it claims gain hysteresis "is no longer needed". A real
  defect on paper. In play it never fires: **0 crossings per minute** at waves
  7, 13 and 21, and 2/min at wave 2. Not the cause.

  Its control caught its own first version, which reported exactly 2/min for
  every stem including `sub` — a stem with `in: 0.0` and no threshold to cross.
  The `on` flag started false, so the first sample of every window counted as an
  entry.

- Retriggering a sounding note cannot truncate it. superdough allocates a new
  voice per hap and only steals voices at the polyphony cap; there is no
  per-note stealing, and `polyphony` measures peak 47-59 against a cap of 96. A
  repeated pitch overlaps its predecessor, which is a re-articulation, not a cut.

- `chop` reports the full mix holed 0.0-1.4% of the time with a working positive
  control, `retention` reports note content invariant under every dial, and
  `gating` reports one ducked bus at -7dB.

**Conclusion: the remaining complaint is not about discontinuity.** Six separate
instruments, each with its own null, say the sound does not stop, does not dip
at any seam, and does not lose a layer.

### What is actually wrong: the mix stops responding

    energy, measured over 30s of real play at each wave (layerpop)
      wave  2   0.22..0.47   mean 0.37
      wave  7   0.43..0.65   mean 0.60
      wave 13   0.64..0.86   mean 0.77
      wave 21   0.86..1.00   mean 0.99

`progressFloor = 0.22 + wave * 0.035 + waveProgress * 0.22` is the arrangement's
floor, and it saturates. At wave 13 it floors energy at 0.675 rising to 0.895;
**by wave 23 it is 1.0 and stays there.** Every stem's `full` is between 0.5 and
0.84, so from about a third of the way into a run every fader is pinned at its
ceiling and nothing the player does moves any of it. Measured at waves 13 and
21: faders at 0.87-0.98, and **0% of the time anywhere in between**.

Eleven layers, all present, all at their ceiling, continuously, for the rest of
the run. That is a wall rather than an arrangement, and it is the same shape as
the powerup-saturation audit in this file: a contribution that saturates, so the
response exists in the code and not in the speakers.

It also matches the user's own words better than any of the discontinuity
theories did — "too much high pitch synth ALWAYS PLAYING, its taxing on the
ears" is a description of a mix with no dynamics, not of a mix with gaps.

`faders` says "THE FADERS ARE MIXING" and is not wrong. It plays from wave 1 and
never leaves the first minute of a run, so it has never been in a position to
see this. That is worth remembering about every tool here: a check that starts a
fresh run only ever describes the opening.

Fixed by capping the wave term — `0.2 + min(0.2, wave * 0.02) + waveProgress *
0.14`. The floor still rises through a run, so a late wave still starts bigger
than an early one; it just stops arriving at the top and staying there.

                    before            after
      wave  2   mean 0.37         mean 0.29
      wave  7   mean 0.60         mean 0.44
      wave 13   mean 0.77         mean 0.49
      wave 21   mean 0.99         mean 0.55
      range at wave 21   0.14          0.25-0.29

    faders at wave 21   chords 0.98 -> 0.82   lead 0.95 -> 0.74   arp 0.89 -> 0.79
                        kick 0.74 -> 0.73     hats 0.51 -> 0.49

The drums barely moved, which is right — a kick should keep time steadily — and
the melodic layers came off their ceilings and got their headroom back.
`variety` still reports drop 47% and quiet 21%, so the arranger's thresholds
survive the change; `verify` passes; `chop` still reports the mix does not stop
(0.0%, and 0.0-2.0% across five runs).

### HUSHED: the fix was the gesture, not the measurement

`movements` reported SOLOIST and FLANKED audible and HUSHED indistinguishable
from an ordinary wave. The instrument was right and the music was wrong.

The first HUSHED pulled the kit back a little and pushed the pad, the lead and
the fx wash UP. That is the right answer to the wrong question: on an ordinary
wave the enemy fire fills the middle of the mix, and on a hushed one it does
not, so the arrangement's job is to USE that space rather than pour more into
it. Boosting the noise lane was filling the silence the movement is made of.

It now subtracts. The kit very nearly goes (kick 0.18, clap 0.10, hats 0.28),
the two activity layers go with it (arp 0.40, motifs 0.45), the wash comes DOWN
rather than up (fx 0.60), and the tune and its harmony are left standing almost
alone (chords and lead 1.15). The lead keeps its long-tailed `open` treatment,
because a tail is exposure rather than clutter, but nothing else is added.

    HUSHED   low/air moved 25% against a 4% control band  (run 1)
             low/air moved 51% against an 8% control band (run 2)

**The near-miss worth recording.** Having decided the gesture was subtractive, I
was one edit away from changing the tool to judge HUSHED on LOUDNESS — the
reasoning being that a movement which subtracts must be quieter, and that
`low / air` divides two small bands by each other and is the noisiest of the
three axes. The edit failed to apply on a stale anchor, so the run used the
original axis, and the numbers it printed show the reasoning was wrong: HUSHED
measured **0.0331 rms against 0.0268 and 0.0280 for the two ordinary controls**
— louder, not quieter, because the subtraction is in the drums while the pad and
the lead come up. An axis chosen from a plausible story about the fix, rather
than from what the fix actually does, would have failed the movement for moving
the "wrong" way.

Two lessons, both already in this file in other words: pick the axis from the
measurement, not from the narrative; and a tool that measures fine should not be
rewritten because a better-sounding metric occurs to you. `low / air` has now
resolved this movement twice with a control band a fifth to a sixth of the
effect, which is all a metric has to do.

Constraints after the change: `verify` passes, `chop` reports the mix does not
stop (0.0%, hats control 4.3/s), `retention` reports changes additive, `gating`
reports one ducked bus, `variety` reports drop 46% / quiet 26%, `mixaudit`
reports every layer reaching the speakers.

## The Chromium dependencies are a script now, not a paragraph

`lib/chromedeps.mjs` — this box has no system `libnss3`/`libnspr4`/`libasound2`
and no root, so Playwright's Chromium can only start against copies extracted
from their .debs into a directory on `LD_LIBRARY_PATH`. That recipe existed
only as prose in this file, and the path it named was `/tmp/chromedeps`.

**`/tmp` was cleaned and every browser tool in the repository stopped working.**
The failure mode is unhelpful in a specific way: `libnspr4.so: cannot open
shared object file` is emitted by the dynamic linker *before* Playwright's
launch timeout, so it surfaces as "Target page, context or browser has been
closed" — which reads like a crashed page, not a missing library. `ldd` on the
binary is what actually says so, and nothing pointed anyone at `ldd`.

**The libraries were on disk the whole time.** The durable location is

    /home/deniz/.cache/musicwars/native-libs/usr/lib/x86_64-linux-gnu

owned by `tools/desktop-deps.mjs`, which exports `LIB_DIR` and
`libSearchPath()` and is repopulated by **`npm run desktop:deps`**. That script
is the recipe: `apt-get download` followed by `dpkg-deb -x`, neither of which
needs root — only `apt-get install` does. To run a browser tool by hand:

    LD_LIBRARY_PATH=$(node -e "import('./tools/desktop-deps.mjs').then(m=>console.log(m.libSearchPath().join(':')))") npm run <tool>

or simply import `ensureChromeDeps` and let it do it.

The desktop workstream had already moved the extraction somewhere that survives
a `/tmp` sweep — and the only reference to it anywhere in this repository was a
hardcoded constant inside `tools/.pulseprobe-tmp.mjs`, a dotfile-prefixed
scratch script about PulseAudio that nothing imports and no npm script runs. A
working configuration for the entire verification suite was reachable only from
a temp file somebody forgot to delete, while the documented path pointed at
nothing. `lib/chromedeps.mjs` now **imports** `LIB_DIR` from `desktop-deps.mjs`
rather than restating it, because two copies of a path is how it drifted in the
first place.

Two lessons, and the second is the one that cost the time. A second copy under
`/tmp` was never a backup, it was a second thing to lose — and it is the one
that got lost. And an environment fact that only exists in prose will be wrong
the day the environment moves: this now searches `CHROMEDEPS_DIR`, then the
cache directory, then the old `/tmp` path, and reports which one it used.

There is also **no network on this box** — `getent hosts archive.ubuntu.com`
fails and `curl` to the archive times out — so the rebuild path is a last resort
that cannot currently succeed. An existing extracted copy is the only route,
which is exactly why finding the surviving one mattered.

## `flicker` does not measure flicker

Worth knowing before anyone reaches for it to answer a visual question, as the
name invites: **`flicker` contains no pixels.** It hovers the ship on a
threshold boundary and counts how often `leadRegister` flips — a musical-state
stability check, and a good one; it found the melody jumping an octave once a
second. It cannot see the screen at all.

The visual complaint ("visual clutter is high, maybe reduce the square in the
background strobing") therefore had no instrument, which is why `strobe.mjs`
exists. The row in the table at the top of this file is accurate; the name is
the trap.

## Never leak a browser: `lib/autoclose.mjs`

Nearly every tool here does this:

    const b = await chromium.launch(…);
    …assertions…
    await b.close();          // only reached when nothing threw

Two Chromiums leaked that way wedged this box for **two hours and twenty-two
minutes** and could not be cleaned up: a process in `D` state never returns to
userspace to receive a signal, so `kill -9` reports success and changes
nothing. Only a WSL restart clears one.

`try/finally` is the obvious fix and **in these files it does not work.** They
are ESM modules built on top-level `await`, so a throw does not unwind into
anything — it rejects the module job, Node reports an unhandled rejection and
exits, and there is no enclosing frame for a `finally` to belong to unless the
entire file is wrapped in a function and re-indented. That still would not cover
a SIGTERM from a harness timeout, which is how at least one of the two orphans
was created.

    import { autoClose } from './lib/autoclose.mjs';
    const b = await chromium.launch(…);
    autoClose(b);

Registers the close on `uncaughtException`, `unhandledRejection`, `SIGINT`,
`SIGTERM`, `SIGHUP` and `exit`, prints the original error first, and races
`close()` against an 8s timeout — because on a stalled box the cleanup can hang
exactly as thoroughly as the thing it is cleaning up, and a cleanup that hangs
is the failure it exists to prevent. Adopted by `levelshot` and `strobe`; it is
two lines and belongs in all of them.

### Before blaming a hang on the code, read `dmesg`

With the libraries restored, Chromium still would not start — both the headless
shell and the full build timed out at 150s — and two five-hour-old
`chrome-headless` processes sat in `D` state that `kill -9` could not touch,
because a process in uninterruptible sleep never returns to userspace to receive
the signal.

None of it was the browser. `dmesg` had **2074** of these:

    hv_storvsc …: tag#882 cmd 0x28 status: scsi 0x2 srb 0x4 host 0xc0000001

`hv_storvsc` is the Hyper-V storage driver behind WSL2's virtual disk, `cmd
0x28` is SCSI READ(10), and the status is CHECK CONDITION / SRB_STATUS_ERROR.
**The virtual disk was failing reads.** That single fact explains the whole
day's symptoms at once: load averages in the thirties with every process at 0%
CPU, `cat` of a 200-byte file timing out at two minutes, a `du -sh node_modules`
still running after an hour and forty minutes, unkillable browsers, and
`tsc` taking ten minutes on a project it normally compiles in one.

The lesson for this directory: a browser check that hangs is not automatically a
browser problem, and load average is not automatically contention. Load counts
processes in `D` as well as `R`, so a stalled disk and a busy CPU look identical
from `uptime`. `ps -eo state | grep -c '^D'` and `dmesg | tail` separate them in
two seconds, and no measurement taken while that signature is present should be
believed even if it completes.

    import { ensureChromeDeps } from './lib/chromedeps.mjs';
    console.log(await ensureChromeDeps());

Idempotent, one `ldd` when the directory is already good, and it never throws —
a machine that has NSS installed must not be broken by a helper written for one
that has not. It has to be an imported module rather than a script a tool shells
out to, because it works by mutating `process.env.LD_LIBRARY_PATH` and the
browser inherits that only as a child of *this* process; a subprocess cannot set
its parent's environment.

Adopted so far only by `levelshot`. It is a one-line import and belongs at the
top of every tool that launches a browser, the same way `lib/frozen.mjs` was
adopted across all 83 of them by the workstream that first needed it.

## When there is no browser at all (`node tools/levelupdraw.mjs`)

`/tmp/chromedeps` went away and **this box has no network** — `getent hosts
archive.ubuntu.com` fails and `curl` to the archive times out — so the four
libraries Chromium needs cannot be fetched and **no browser tool in this
directory can run**. That is not contention and waiting does not fix it.

Rather than ship a screen with no evidence behind it, this draws the level-up
overlay into a **recording `CanvasRenderingContext2D`** in Node and asserts on
the calls. Same move as `gating`, which reconstructs the sidechain automation
arithmetically instead of trying to hear it in a busy mix, and same move as
`levelup`, which exercises the progression system as pure functions.

It cannot say whether the screen looks good. It decides the questions that have
a right answer:

    5 states x 4 field sizes x 6 frames, plus exits
    800 frames drawn, 432 card rectangles checked, no non-finite values
    hitTest agreed with the drawn layout at every size and every frame
    no card overlapped another or escaped the field
    the choosing latch closes the screen when no event arrives
    evolution carillon  painted  71/161 frames, ~3.6s as declared
    union     requiem   painted 123/161 frames, ~6.2s as declared

**Non-finite values are the headline and they are not hypothetical.**
`renderer.ts` already carries a comment about this exact failure: a colour
string built from NaN throws inside `addColorStop`, and the frame dies *after*
the background has been cleared, so the symptom is a black screen and not an
error anyone can trace to a line. Every numeric argument to every call is
checked finite and every colour string is checked for `NaN`/`undefined`/
`Infinity`, on write, which is where a number first becomes a string and stops
being detectable as a number.

**It sweeps field sizes, which no screenshot does.** Two of the three layout
bugs in this screen only appear at the small end of the card-height clamp — a
state no screenshot anyone would think to take ever visits.

### The same trap as `miniAllStrings()`, in a different medium

Every geometric assertion here reads `ui.rects()` — the overlay's own layout
state, not the recording. So a recorder that captured nothing, or a `draw()`
that early-returned, would leave the text loop iterating zero times and **every
check would still report green**. Exactly the shape of the `miniAllStrings()`
failure in `lib/headless-audio.mjs`, where `motorcheck` passed 1760 states while
examining no notes, and what exposed it was the arithmetic rather than an
assertion: 1.75 events per state is not a pattern with a sixteenth layer in it.

So the run now prints what it painted, and asserts a floor:

    painted: 56 draw calls and 27 strings per settled frame (worst 21/14, over 60 frames)

**The first floor was wrong and is worth recording.** At 25 calls it failed the
all-grace state, which paints 21 — correctly measured and wrongly judged,
because a grace card carries no ability and therefore no level staff and no
eight noteheads, so it legitimately draws less than an instrument card. A
threshold sitting inside the honest variation of its own metric is the most
common way a check in this directory lies, and it had just done it to me inside
five minutes of writing it.

The division of labour that replaced it: **the assertion catches "nothing
painted", the printed averages catch "painting a quarter of itself".** 8 calls
and 4 strings sits 2.5x under the worst real frame and still fails hard on an
inert recorder (0/0) or a screen that drew only its backdrop (1/0). Same split
as `chop`, where the hole detector asserts and the swing column is printed with
an explicit warning not to conclude from it. The mechanism is demonstrably live:
it fired, on real states, at the higher threshold.

### Its controls, and the one that caught me

Two, because this directory's rule is that a check which cannot fail is
decoration:

- **A planted-fault control.** Four deliberately bad calls into a throwaway
  recorder; it must catch all five detections they trip. A green run is only
  worth reading if the instrument can go red.
- **A negative hit-test.** `hitTest` twelve pixels outside a card must not claim
  that card. Without it, an implementation that returned the loop index — or
  simply always 0 for a one-card offer — would pass the positive test every
  time.

And an end-to-end proof: setting `layout`'s card gap to -60 makes it report
`cards 0 and 1 overlap` at all four sizes and exit 1.

**The first attempt at that proof printed nothing at all**, which is the finding
worth keeping. `TSBUILD_DIR` was pointing at an emit from before the break, so
the tool loaded the *previous* build and never compiled the fault. A cache that
silently measures the wrong build is worse than no cache — the same failure
`lib/frozen.mjs` exists to prevent — so `buildTs` now compares the newest mtime
under `src/` against the emit and rebuilds when the source is newer.

### Strip-only versus transform: run it with `--experimental-transform-types`

    node --experimental-transform-types tools/levelupdraw.mjs

`lib/ts.mjs` alone is not enough for anything under `src/render`, because the
render tree reaches `core/math.ts`:

    ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property is not
    supported in strip-only mode

Node's default handling **strips**: it may replace types with whitespace and may
never rewrite, and `constructor(private riseAt: number)` cannot be erased into
working code — it has to be *expanded* into an assignment. That is not a defect
in the source; parameter properties are ordinary TypeScript.
`--experimental-transform-types` transforms rather than strips and handles it.
The whole render tree imports in about 100ms.

**Three near-identical questions that have different answers, which is the trap
here.** All three concern the same file and only the middle one fails:

| what you do | `core/math.ts` | why |
|---|---|---|
| `node --check` (`npm run syntax`) | passes | only has to parse; a parameter property parses fine |
| `import()`, no flag | **fails** | has to emit runnable JS, and stripping may not rewrite |
| `import()`, `--experimental-transform-types` | passes | transforms, so it can rewrite |

So a green `npm run syntax` says nothing about whether a Node-side tool can
import the module, and "Node strips types" is true of `--check` in a strictly
weaker sense than of `import`.

A `lib/tsbuild.mjs` was written first and has been **deleted**. It shelled out
to the `tsc` binary to emit the project to a temp directory and imported the
resulting `.js`, on the reasoning that `tsc` was the only transformer on the box
— this project has no esbuild (Vite 8 does not bundle it), no network to install
one, and `typescript` 7 is the native compiler whose npm package exposes no JS
transform API at all (`Object.keys()` on it is `['version',
'versionMajorMinor']`). All of that is true and the conclusion was still wrong,
because the transformer was in Node the whole time behind a flag. It cost ~60
seconds per run against ~100ms, and a tool nothing needs is a tool that drifts.

One thing it did teach before it went, worth keeping: its emit cache went stale
silently. A deliberate break planted to prove `levelupdraw` could go red
compiled nothing, and the tool printed a clean pass. Any cache keyed on
anything other than the source's mtime will eventually report on a build other
than the one on disk — the same failure `lib/frozen.mjs` exists to prevent.

## The level-up screen (`node tools/levelshot.mjs`)

Named to sit beside `levelup.mjs`, which is a different check: that one
exercises the pure progression system 60,000 offers deep with no browser at all.
This one is about pixels, and it exists for a failure that is invisible in play.

**The cards can draw in one place while `hitTest` believes they are in
another**, so the player clicks PIZZICATO and receives SNARE ROLL. Nothing looks
wrong when it happens — the wrong instrument simply joins the band — and no
screenshot can catch it, because the screenshot is of the correct-looking
layout. The check compares the two directly: for every card in every state,
`hitTest` at the centre of the rectangle the card was drawn into must return
that card's index. Rectangles are also checked for mutual overlap and for
staying on the field.

Four states, chosen so the two that are hardest to reach by playing are the two
that are always exercised: early, mid-build, one-pick-from-CARILLON, and **all
four options grace**. That last one is the state where both inventories are full
and everything held is maxed, and it is there because of the bug below.

**The bug it was written around.** `level:offer` was specified as
`options: offer.options.map((o) => o.id).filter((x) => x !== null)`. A grace
option's id *is* null by definition, so the filter did two things: it dropped
those cards, leaving the choice screen emptier the deeper the run went; and it
desynchronised every index behind them, because `chooseOption(state, index)`
indexes the unfiltered array. A grace at index 1 made the UI's card 2 the
engine's card 1. The payload is now
`{ id: AbilityId | null; grace: GraceKind | null }[]` and the check asserts
`cards drawn === options offered`, which makes the fix permanent rather than
merely applied.

**A second hole in the same area, still open in the emit contract.**
`docs/progression.md` emits the choice as `if (c.ok && c.id)` — so taking a
grace card emits `level:choice` *not at all*, and no `level:skip` either,
because it was not a skip. Anything that closes the offer screen on events alone
sits open forever on the one pick that produces no event, with the world still
paused underneath it. The overlay now closes on the falling edge of
`snapshot.choosing` instead, latched so that it waits to see the flag go true
once before acting on it going false — which means it works while the arena
conversion still has that field defaulting to `false`, and gets stricter for
free once it is live.

**The control, which is the part worth copying.** "Did the screen paint" is
asked as mean overlay alpha over the card region *against the same region with
the offer closed, measured in the same session* — not against zero. The vignette
alone puts a nonzero value in every pixel of that canvas, so a check written
against an absolute threshold would pass on a screen that draws nothing. Same
trap `everypowerup` fell into when it compared two moments 2.4s apart and read
the arrangement's own drift as a change.

It also drives an evolution and a union celebration, and asserts the panel's
chip count equals its slot count — the assertion `progression` already makes for
the powerup row, which exists because that row once printed "none" *and* four
empty chips, the same fact twice.

## Four instruments were invisible (`node --experimental-transform-types tools/effectsdraw.mjs`)

`World.effects` carries a doc comment headed **"THIS IS THE RENDERER'S
CONTRACT"** specifying exactly how a beam, a sweep and a field should be drawn,
and **nothing in `src/render/` read it.** ROSIN BOW and HARMONICS (`beam`) and
SNARE ROLL and BLAST BEAT (`arc` at zero speed, which routes to `sweep`) dealt
damage and left no mark at all.

**It was a balance bug wearing a rendering bug's clothes.** In the soloist
probe `snare` is last of the roster at 5.2 kills/min and `bow` third from last
at 11.0 — the two weakest instruments in the game were two of the four you could
not see. A player cannot learn a weapon that leaves no trace, so they never
invest in it, so it stays weak. Two agents found it independently from opposite
directions, one by grepping the renderer and one by measuring kill rates, which
is the strongest form of corroboration this project gets.

Two more of the same shape in `drawNovas`, both a value the world took care to
publish that the renderer ignored: the hue was hardcoded to `150` while the
world writes one per instrument *precisely* so six auras look like six
instruments, and the fade ran against a fixed `155` while `maxR` reaches **520**
for REQUIEM — so the largest ring in the game, the payoff of a roughly
one-in-240 run, was invisible for four fifths of its expansion.

### The control is an identical frame with no effects in it

The renderer paints a background, a grid and a starfield every frame, so "did
anything get drawn" is trivially yes and means nothing. Every count is measured
against the **same frame with the effects array empty**, and hues are attributed
by parsing them out of the recorded fill and stroke styles, so an effect's own
colour can be picked out of the renderer's palette:

    empty field: 165 ops   one beam: 174 ops
    beam  (ROSIN BOW / HARMONICS)    +  9 ops   hue 291 present
    sweep (SNARE ROLL / BLAST BEAT)  +  8 ops   hue  17 present
    field (BLACK HOLE / TREMOLO)     +  8 ops   hue 268 present
    24 mixed effects: 361 ops, 31 distinct hues

**Commenting out the one `this.drawEffects(g)` call reproduces the original
defect exactly** — `adding a beam changed nothing (165 -> 165 ops)`, plus six
more failures. That is the check demonstrating it would have caught the bug it
was written for, which is the only way to know a regression test is real.

Two of its own bugs, both worth keeping because both are general:

- **The baseline was measured cold.** `enemyBulletSprites()` builds its atlas
  lazily on first use — hundreds of ops — so the empty-field control came out at
  761 against 178 for a frame *with* a beam, and the control cheerfully reported
  that adding a beam had removed 583 draw calls. A baseline must be of the same
  steady state as the thing compared to it; the harness now renders one throwaway
  frame first.
- **An incomplete stub reads as a renderer bug.** `Renderer` imports `World` as a
  type only, so a duck-typed object is enough — but a missing `prevX` becomes
  `undefined`, reaches `translate()` as NaN, and looks exactly like a defect in
  the code under test. `drawPlayer` reads eleven fields and they all have to be
  there.

## `strobe` (`node tools/strobe.mjs`) — the A/B is in one session

The instrument for the strobing complaint, and the thing `flicker` was never
going to answer. It freezes the world so nothing on screen can change except
the beat machinery, drives the renderer by hand at a fixed 60fps with the
transport advanced manually, and folds per-frame luminance onto beat phase. The
headline is SWING: peak-to-trough of that folded curve, in luma units. A
periodic modulation at the beat rate is exactly what "strobing" means and no
amount of gameplay motion can fake it.

**`Renderer.legacyStrobe` restores all five pre-fix beat responses at once** —
grid alpha, grid lightness, the full-field `breathe()` convulsion, the bloom and
the horizon, plus `WarpGrid.legacy` for the old `STRESS_MIN` of 10 — so both
screens are measured against the same frozen scene, the same transport, the same
browser and the same machine load. It runs ABAB and reports the run-to-run
spread of each mode next to the gap between them, refusing to call a result when
the spread is more than half the gap. `hudab` is the standing reason: it
measured one unchanged HUD as costing 7.7fps and then as costing nothing, and
the rule that came out of it is that any A/B smaller than the noise band must
interleave.

**Read the ratio, not the absolute "before".** This repository has no commits
and the fixes were already applied when the switch was written, so the legacy
constants are reconstructed from the line references in the original complaint
rather than recovered from history. The right shape and the right order of
magnitude; the reduction factor is the finding.

## What the level-up screen is, and why it flashes when the playfield no longer does

The strobing pass took four beat responses out of the playfield — the grid's
alpha and lightness, the full-field `breathe()` convulsion, the bloom and the
horizon — and left exactly one, the enemies' own breathe, on the grounds that
five things keeping time in the periphery reads as strobing rather than as
rhythm.

The offer screen then puts a full-strength beat response back, deliberately, and
the justification is mechanical rather than aesthetic. The **world stops but
the music never does**, because `repl.stop()` rewinds Strudel's cycle counters
by a measured four bars; the transport runs on and the field's beat-scheduled
emitters are pushed forward by the held beats so none of them come due at once
on resume. (The world ran at 0.12x rather than stopping until 2026-08-23.) So
the music plays on at full tempo while the player reads four cards, and there
is nothing to dodge — no bullet whose
readability a flash can cost. It is the one screen where the periphery keeping
time is the point rather than the problem, and it is what makes "you are
choosing an instrument while hearing the band" a thing that happens rather than
a line in a design document.

The backdrop is 74% opaque rather than solid for the same reason: the fight is
still crawling underneath and whether it is about to reach you is information
you need in order to decide how long you can afford to read.

Two layout bugs were found by reading rather than by looking, and both are the
kind a screenshot at one window size cannot catch: card text placed at fixed
pixel offsets collides at the 78px card-height floor the layout allows for a
short field (now proportional), and the ensemble block pinned to the bottom edge
left a 140px hole in the middle of the page whenever the card height hit its
clamp (now anchored to the last card). A third was a `measureText` called after
the font had already been switched to the lighter face, which sized a heading
with the wrong metrics.

## The arena conversion, measured (tools/arena.mjs)

`node tools/arena.mjs [minutes] [runs]`, or `npm run arena`. **No browser.**

`src/game/*` and `src/core/*` import nothing from the DOM, from Strudel or from
Web Audio — that is the entire point of the `GameSnapshot` boundary — and in
eighty-odd tools nothing had ever taken that up. Every check here drove a real
Chromium, so when this machine lost `/tmp/chromedeps` (no `libnss3`,
`libnspr4`, `libasound2t64`, no root) the whole directory stopped working at
once and the arena conversion had to be balanced with no instrument at all.

Two Node flags do the work: `--experimental-transform-types`, which *compiles*
TS rather than merely stripping it — required, because `bullets.ts` has a
`const enum` and that is not erasable syntax — and a `registerHooks` resolver in
`tools/lib/tsnode.mjs` for the extensionless imports Vite normally supplies. It
runs eight simulated minutes in a few seconds.

**What it cannot do matters as much as what it can.** There is no audio, no
renderer and no frame pacing in it. It measures the arena and says nothing
whatever about whether the music is right; `smoke`, `audiocheck`, `mixaudit`,
`chop` and the rest are not replaced by it and never will be.

It asserts four STRUCTURAL properties and reports everything else. The bar is
deliberately about the machine turning over — things die, levels arrive, the
ring closes and opens — rather than about balance. Four thresholds in this
directory have already been caught sitting inside their own metric's spread,
and the arena's numbers have not been judged by a person even once, so a
balance gate written today would be a guess with an exit code.

### What it found, in the order it found it

Every one of these was invisible in the source and obvious in one run.

- **A kiting player did no damage at all.** With every weapon firing along the
  facing, a run could reach a boss and spend four minutes making no progress on
  it: 13 kills in five minutes. A survivor arena is played by running away, so
  a forward-only weapon fires away from everything that matters for exactly as
  long as the player is surviving correctly. Vampire Survivors gets away with a
  forward-firing starter because six slots fill with orbits and auras inside a
  minute; here you start with one instrument.

  The fix was already written down and I had read it as flavour: `weapons.ts`
  defines the `seek` shape as "bolts toward the nearest target inside range".
  It is the auto-targeting shape. `arc` and `beam` — the two whose character IS
  directional — keep the strict cone, and facing still decides which target
  `seek` prioritises, so pointing at a thing still kills it first.
  **8.8 -> 32 kills/min.**

- **The arena had a median of one enemy in it.** Encirclement, which is the
  whole premise, peaked at 0.18 and sat at 0.00 for most of a run. Three causes,
  and only the third was the big one: the schedule slid forward only when the
  stage was completely *empty* (now: when it is below a population floor); group
  sizes were written for a row entering from the top, and the same count spread
  around a ring cannot surround anybody (a group of three leaves three gaps);
  and enemy hp topped out at 1.85x baseline against an ensemble that measures
  36 dps at the start and 200-2700 by the end.

  That last ratio is the conversion in one number. Per-enemy hp was measured
  carefully by another workstream against a **24 dps** player and none of it was
  wrong; the other side of the division moved by a factor of ten.
  **Enemies on screen p50 1.0 -> 3.0, p90 4 -> 15; encirclement p90 0.18 ->
  0.49.**

- **Bosses died in 0.1 seconds.** A late fusion puts a 360-degree fan of
  twenty-four projectiles inside the boss's own radius at point-blank. The
  fight has three phases and was playing one. The fix is a phase GATE — hp
  cannot cross a threshold it has not played yet, and the clamp lifts when the
  transition commits on the next bar line — which costs a strong player about
  two bars and guarantees the three acts the director builds on.
  **0.1-5s -> 14-27s, with every phase played.**

- **One level-up offer every nine seconds.** The XP curve was calibrated
  against a modelled nine kills a minute; the arena produces thirty in the first
  minute and over a hundred by the eighth. 52 offers in eight minutes is not a
  difficulty problem — it is the interruption becoming the run. `XP_BASE` and
  the step tiers are now `10 / 9 / 24 / 55` with tiers at 14 and 23, and
  `tools/arena.mjs` prints the cadence directly. **One offer every 18s.**

  This is the FOURTH budget in this codebase re-denominated after the event it
  counts changed rate (the drop pity timer, the multiplier decay, the powerup
  durations, and now this). The difference is only that this time the new rate
  was measured before the constant was chosen.

- **Shard count and shard value had to be decoupled.** `shardsForKill` returned
  `3 + toughness * 2` shards, matched to the old note scatter so the field would
  not look different. With hp scaling to keep pace with the ensemble, toughness
  reaches ten and a single kill scattered twenty-three shards; runs sat on the
  320 pool cap with the field carpeted. The count now caps at nine and the value
  rides the tier split instead — a tough kill drops a red gem, not fifty blue
  ones, which is both what VS does and the more legible design.

### Two tools it invalidated, and one it fixed

- **`tools/lib/driver.mjs` had a shmup assumption in it.** `my += (py < h*0.62
  ? 0.8 : 0)` — "prefer the lower half; drifting to the top is how runs end" —
  was true when everything entered from the top and pins the bot against the
  bottom wall in the round, with enemies closing from three sides. Left in, it
  would have re-run this file's original sin: measuring one bad strategy and
  reporting it as the game. It now heads for `world.wayOut`, weighted by how
  closed the ring actually is, and stays off all four walls. It also answers
  level-up offers, because the world STOPS for one and a bot that never picks a
  card halts the run outright.
- **`ttk` and `hitrate` read `player.weapon()`, which no longer exists.** The
  ship is six instruments on six clocks, not one function returning one fan.
  `World.ensembleDps()` is the replacement and `roster` now uses it, but read
  its comment: it is a NOMINAL budget, damage times rate summed, with no account
  taken of what connects. A sweep hits everything in its arc and a bolt hits one
  thing, so two builds with the same number are worth wildly different amounts.
  Measuring what actually lands still needs `ttk`, and `ttk` still needs
  rewriting against the instrument system.

### The safety pick, and why the world owns it

An offer nobody answers does not merely wait — the world is stopped, so it halts
the run outright. That is true for a player who walked away and true for every
headless check that drives the ship without knowing what a card is. There is a
real-time fallback that takes card 0, in `World.update` rather than in the
harness: a world that can be frozen by an input it did not receive is the
world's problem.

The fallback is **45 seconds**, raised from twelve when the offer became a true
pause. Twelve was generous against a stage still creeping at 12%; against a
stopped world it is a hidden clock on a screen that visibly has none, which is
the pressure the pause exists to remove. Every harness in this directory answers
offers, so nothing should ever reach it.

## deadhunt — conditions in the GAME layer that cannot be evaluated

`tools/deadconditions.mjs` asks, of the snapshot and in a browser, which musical
signals never vary and which never reach the values the audio branches on. It
was written after three iterations found the same shape of defect by accident.
The same shape is in the simulation, and the browser tool cannot see it, so
these two ask the same question of `src/game` and `src/core` with no browser at
all:

    node --experimental-transform-types tools/deadhunt-ranges.mjs   [minutes] [runs]
    node --experimental-transform-types tools/deadhunt-branches.mjs [minutes] [runs]

`ranges` prints the measured span of every number a game-layer comparison reads,
beside the constant it is compared against. `branches` wraps the world's own
methods and counts how often each guarded arm is actually taken.

**Half of each tool is exhaustive rather than sampled, and that half is the one
to trust.** Everything folded out of `weapons.ts` is a pure function of a
loadout — at most six rig items out of twelve at levels 1-5 — and each
`Modifiers` field is touched by at most two rig items, so the achievable set can
be enumerated. When `ranges` says `cooldown` lives in [0.62, 1] that is a bound,
not the best a bot happened to roll. The dynamic half exists for everything
positional (the threat signal, the population floor, the drop economy), where
there is nothing to enumerate.

### Read the sample counts before the verdicts

The first version of `ranges` reported `shocks.length >= 64` true for 72% of a
run and was measuring itself: `world.shocks` is drained by the renderer every
frame and there is no renderer in Node, so a headless run fills a bounded array
in the first few seconds and then reports a permanently saturated cap that no
session ever sees. Both tools now drain the render queues, and every row carries
its own `n` and prints `NEVER SAMPLED` rather than folding an empty accumulator
into a green summary.

The other half of the same lesson: a bot playing naturally reaches level 14 and
holds two instruments at level 2, so the per-shape floors in the six firing
routines are never even evaluated and "never true" would mean nothing. `ranges`
therefore also drives forced loadouts (every instrument at 8, every rig at 5,
and an all-fusions variant) and `jumpToWave` runs at 16, 26 and 40, because the
escalation term and the fused stat blocks are unobservable otherwise.

### What they found

- **`MAX_MULTIPLIER` was applied at one of the combo's two increment sites.**
  The cap lived in `updateNotes`; `onEnemyKilled` incremented unconditionally.
  Measured peak combo 182 against a cap of 60, with 19 score-threshold extends
  across ten runs — which is the exact failure the cap's own comment describes
  and believes it prevents. Fixed; the peak is now 60 exactly.
- **`player.powerups.magnet` cannot be true.** MAGNET became a rig item with
  `weight: 0`, and the only kinds that can reach `Player.addPowerup` are `bomb`,
  `overdrive` and the sent `encore`. Two reads keyed off it — a 1.6x drop-rate
  boost and a 90-vs-60 graze score — were constants. Removed rather than
  re-pointed at the rig: the drop rate is a budget three other constants are
  denominated in.
- **`introduce()` recorded the archetype before the banner guard that suppresses
  it**, so an archetype arriving under a fresh `WAVE N` banner — which is every
  wave's first group, causally — was marked seen and could never be named again.
  47 of 83 first encounters lost. Fixed by recording after the guard: 81 shown
  where 36 were.
- **Eight of the 84 level steps moved only fields their own shape ignores.** The
  six firing routines read a subset of `InstrumentStats` each, and nothing
  checks the table against them: `field` ignores `count` (so "a second pool per
  drop" places one), `aura` ignores `linger`, `seek` ignores `area`, and
  `bounces` was read by nothing at all.

  `bounces` is now implemented — `BulletPool.update` takes a wall rectangle and
  reflects in angle space, and all three projectile-spawning routines forward
  the stat — which took the count to **six of 84** and lit up ECHO CHAMBER,
  SPICCATO and CANON. The rest are annotated and left: implementing them is a
  balance change, not a repair.

### The tool caught itself a second time, and this one is worth copying

The per-shape table works by slicing each `fire*` body out of `world.ts` and
greping it for `s.<stat>`. The annotation added at `fireField` explaining that
the routine ignores `s.count` **contains the literal text `s.count`**, so the
regex matched the writeup of the defect as evidence the defect was gone: the
dead-step count fell from 8 to 3 on a change that touched no field behaviour at
all. Bodies are stripped of comments before matching now.

Both self-inflicted failures here have the same shape — the harness observing
an artefact of its own environment (no renderer draining `shocks`) or of its own
output (its comments) — and both produced a *better-looking* number, which is
the direction that does not prompt a second look.

### deadhunt-fusion — is the evolution system reachable?

    node --experimental-transform-types tools/deadhunt-fusion.mjs [runs] [maxMinutes]

`arena` reports `fusions 0.00` and `levelup` reports 98%. Both are true; they
measure different things, and the gap between them is two confounds that have to
be separated before either number means anything.

**The horizon.** `levelup` sweeps 15 minutes. `arena` defaults to 3. A building
player's first fusion lands at **278-329s**, which is outside one window and
inside the other.

**The policy.** The arena bot answers every offer with `choice = 0` — that is
`levelup`'s RANDOM policy with the dice removed, and random reaches a fusion 26%
of the time against builder's 98% *by design*, because choosing is supposed to
be the game. Measured against the real `World`, run to death, 8 seeds each:

```
                        card-0        builder
first fusion reached    2/8           8/8
first fusion at         955s          329s
best instrument         L5.9 of 8     L8.0 of 8
offers banked           48.3          60.6      (12 needed)
```

So the system is reachable and `fusions 0.00` is a property of the harness, not
of the game. `arena.mjs`'s own header warns about this exact failure — "the whole
history of this directory is tools that measured one strategy and reported it as
the game" — and its card policy is the strategy in question.

**Two things this turned up that are not about fusions.** The bot does not die:
0 deaths in 16 runs of 20 minutes, reaching wave 32-40. It is genuinely mortal
(38 hits taken, lives lost) and simply earns score extends faster than it loses
lives. That means `waves.ts`'s "runs end around wave 8" — which is load-bearing
for the decision to keep the archetype tier at `/3` — is stale for this bot and
should be re-derived before it is cited again.

### The `strike` shape, and what the soloist probe says about the roster

CHIME and CARILLON were declared `seek` while declaring an `area` and no
`speed` — the other four `seek` instruments declare a speed and no area. Two
different things under one label, so `fireSeek` served the bolts and dropped
everything the bells declared, and `speed: 0` floored them to a 120px/s crawl
with CAPO unable to touch it. They are `strike` now: `count` unaimed hits, each
landing on a random live enemy within `range` and dealing `damage` to everything
within `area`. Dead level steps 6 -> 5.

`scratchpad/soloist.mjs`-style measurement (one instrument at L8, parked, 3
seeds x 2 min) places them against the roster:

```
carillon  strike fused  75.0     ...  feedback  aura   16.8
spiccato  seek   fused  72.8          drones    orbit  15.2
canon     seek   fused  63.0          harmonics beam   15.2
pizzicato seek         59.3          harp      arc    11.5
chime     strike       58.3          bow       beam   11.0
echoes    seek         50.0          snare     arc     5.2
```

**Read that with the caveat, which is large.** A parked ship flatters range and
area and penalises anything that wants aiming or movement — the same objection
`tools/README.md` already records against `ttk`. What it is good for is
RELATIVE placement, and the placement says CHIME now sits mid-pack among the
instruments that work (the seek family runs 50-73) rather than being buffed past
them.

The bottom of that table is the more interesting half: `snare` and `bow` are the
two instruments whose entire output goes through `world.effects`, and **nothing
in `src/render/` reads `world.effects`**. Beams and sweeps are invisible.

### arena: the horizon and the card policy

Two changes, both of them the same defect in different clothes — measuring the
first fifth of a run and reporting it as the run.

**The default horizon is 20 minutes, up from 3.** This bot does not die: 0
deaths in 16 runs of twenty minutes, reaching wave 32-40, staying alive because
score extends outrun the lives it loses. Every balance conclusion ever drawn
from `arena` came from the opening three minutes of a run lasting at least
twenty. Runtime was never the reason for 3 — twelve simulated minutes across
three runs costs 4.3s of wall clock, and the new default costs 16.5s with both
policies — so there is no separate long invocation to remember and no short one
left lying around as the thing everybody reads.

**A builder policy runs alongside card-0, and card-0 still gates.** The bot
answered every level-up with `choice = 0`, which is `levelup`'s RANDOM policy
with the dice removed. Every table and all four structural assertions still read
card-0; the builder is reported in its own labelled block and gates nothing.
Swapping the gating bot would silently re-baseline both this file's gates and
`levelup`'s INCOME model, and the next person to see a number move could not
tell whether the game had changed or the player had. What the block is for:

```
                     card-0      builder
kills/min              80.5        155.3
nominal dps           578.0       1852.6
fusions                0.00         2.00
runs with a fusion      0/3          3/3
```

**Consequence, flagged in the source and not yet acted on:** `levelup.mjs`'s
income model is fitted to the old three-minute window — "mob hp 50-140", "kills
0.48/s rising". Over twenty minutes mob hp reaches the high hundreds and kills
run three to six times higher, because player output compounds and the short
window only saw the start of it. The *shape* changed, not just the scale, so
copying the new numbers into the old two-parameter model would fit the wrong
thing. Refitting belongs to whoever owns the XP curve.

## `rulefire` — a passive that installs a RULE and never fires it

    node --experimental-transform-types tools/rulefire.mjs [seconds]

`deadhunt-ranges` catches a stat nothing reads. This catches the other half of
the same defect, which arrived with the passive overhaul: six of the twelve rig
items now install a **rule** rather than scaling a number, and a rule fails
differently. A multiplier cannot be silently absent — `applyModifiers` folds it
into every stat block on every frame — but a rule waits for a moment, and if the
moment never comes or the branch guarding it is never true, the item is inert
and nothing downstream is unhappy. It type-checks, it prints on the level-up
card, it shows in the HUD, and it does nothing.

`deadhunt-ranges`' technique cannot reach it. That tool slices each `fire*`
routine out of `world.ts` and greps the text for the stat names its shape's
instruments set; a rule is not a stat name in a routine, it is a branch at a
moment. So this measures the OUTPUT: `World` carries a monotonic `ruleFires`
counter beside a `ruleChances` denominator — the same argument as
`BulletPool.bounced`, which exists because a feature nothing can observe is a
feature that can rot — and this drives seven real worlds and reads them.

Four questions, and the last two are the ones that earn their keep:

1. Every `Rules` field has a passive that installs it. Static, off `noRules()`
   rather than a list here, so a field added and forgotten is reported rather
   than skipped.
2. Every rule maps to a counter and every counter to a rule, and each has a
   denominator. This is the hand-maintained seam and `deadhunt-ranges` records
   at length what happens to those when nothing checks them.
3. **One run per rule-bearing passive**, that passive alone forced to max, real
   `World`, real bot, reported as fires over chances. **A zero denominator is a
   FAILURE, not a skip** — AGENTS.md §3, `checked === 0`.
4. **A control run with an EMPTY rig, where every counter must read zero.**
   Without it the whole file is decoration: a counter incremented one line too
   high, outside its own `if`, passes question 3 for free. Its denominators must
   still be non-zero, which is what proves the control produced every moment and
   that the zeros above are the rules being absent rather than the run being
   quiet.

**The bot plants for three seconds in every eight, and that is load-bearing.**
FERMATA charges only while the ship is genuinely stationary, so a bot that never
stops would report the item dead for a reason that is the harness's fault.
Three seconds is inside `World.IDLE_GRACE_S`, so the plant is ordinary play and
the run stays comparable to every other tool's.

### What it found on its first run

FERMATA's charge originally read `World.idleTime`, the camp-pressure clock,
which only resets when the ship leaves a 60px anchor. This measured a weaving
bot holding **at least half a charge on 74.8% of its activations** — a card that
says "hold still" paying out to a ship that never did, which is a flat damage
multiplier with extra steps and precisely the thing the overhaul exists to
delete. The charge is speed-gated now.

### Read the rate column carefully; three rows are not percentages

`homing` counts BOLTS against KILLS and level 3 throws three bolts per kill, so
up to 300% is correct. `fermata` is sensitive to the harness for the reason
above. `tempo` is per step at 120Hz against a drop every 60-80px, so a low
single-digit percentage is the design working. **The assertion is non-zero, not
a threshold** — a threshold here would be a number nobody could defend.

## `capture` — the game's real audio, offline through superdough (`tools/capture.mjs`)

`AGENTS.md` says "the listening artefact is the browser capture recorder", and
until now there was no such tool. `render.mjs` and `hum.mjs` both open by
saying they are not the game's sound — naive oscillators, one-pole filters, no
reverb, no delay — and `render.mjs` goes further than its header admits: it
applies `cutoff` and **ignores `hcutoff` and `ftype` entirely**. The one class
of defect the whole `superdough and Strudel traps` section of `AGENTS.md` is
about is the class the only audible tool could not represent.

`capture` renders the real thing. The score comes from the real `MusicDirector`
driving a real seeded `World` with the same ten bus subscriptions `main.ts`
makes; the haps then go to real superdough 1.3.0 in a real headless Chromium,
pointed at an `OfflineAudioContext` via its own `setAudioContext()`. Real
worklets, real ladder filter, real convolution reverb, real delay, real
`setGainCurve(x => x*x)`. Nothing is re-implemented, and nothing is realtime:
`initAudio()` loads the AudioWorklet modules into the offline context and the
whole thing renders faster than it plays.

```
node --experimental-transform-types tools/capture.mjs --bars=16
node --experimental-transform-types tools/capture.mjs --bars=16 --stem=bass
node --experimental-transform-types tools/capture.mjs --verify-determinism
node --experimental-transform-types tools/capture.mjs --selftest
```

It writes a 44.1k stereo WAV to `renders/` and prints RMS per octave band
(31.5 … 16k), peak, crest and gated BS.1770-4 loudness. `--stem=<id>` solos one
lane through the director's own `solo` field, which pins the lane to unity —
so a soloed capture is louder than that lane is in the mix, deliberately, for
the reason recorded on `MusicDirector.solo`.

**The render is not deterministic, and the size of it is the number that
matters.** Five complete runs of the tool over one identical hap stream
produced five distinct WAVs, and the octave-band table varied by at most
**1.329 dB, in the 500 Hz band**, every other band tighter. So a band
difference under ~1.4 dB is not a result. The filter test below moves bands by
3-10 dB.

`--verify-determinism[=N]` measures that spread by **re-running the whole tool
in clean child processes**, N times (default 3). Three cheaper versions were
tried first and each made the tool look better than it is:

```
render twice in one browser              0.000 dB   (shared process)
second render in a fresh browser         1.329 dB   (looked like a finding)
re-run the whole tool once               0.000 dB   (luck; two samples cannot
                                                     tell reproducible from
                                                     landed-twice-in-one-place)
five complete runs                       1.329 dB   (the real spread)
```

Ruled out as the cause, each by an experiment worth recording:

- **The seeded PRNG.** The page replaces `Math.random` with mulberry32 before
  superdough loads, covering the reverb impulse (`reverbGen.mjs:131`) and every
  noise buffer (`noise.mjs:21`). Runs producing *different audio* drew exactly
  38,455,685 randoms each. Same stream, different output.
- **GC of superdough's `WeakRef`s.** The polyphony reaper spares a voice whose
  handle the collector already took; `WeakRef` was replaced with a strong shim.
  No change.
- **Node release timing.** `onceEnded` installs `node.onended` callbacks that
  disconnect nodes and zero worklet `end` params on the main thread's clock,
  which offline bears no relation to the render position. Blocked by default as
  insurance; `--keep-releases` measures the same ten bands, peak, RMS and LUFS.
- **Concurrency.** Closing the first browser before the second changed nothing.

**Real, fixed, but not the cause.** `reverbGen.applyGradualLowpass` renders the
impulse response in its *own* `OfflineAudioContext` and assigns
`convolver.buffer` from that context's `oncomplete` — nothing joins on it.
Sixteen bars of this score start **49** such side renders across **4** reverb
buses, so a main render that wins the race is quietly drier than the game, with
nothing in the output to say so. `capture` counts every `OfflineAudioContext`
but its own, tracks every `ConvolverNode`, and refuses to start until nothing
is in flight, no convolver lacks a buffer, and that has held across a quiet
window; both counts are printed every run. It did not move the measured spread,
so it is a precaution and is described as one.

One further known hole: `AudioWorkletGlobalScope` is a separate realm the
seeding cannot reach, so `supersaw` and wavetable voices take a random initial
phase. `buildBass` emits `supersaw` today; bass soloed, it costs 0.019 dB on
the worst band — real, and not the 1.3 dB.

**The score half is deterministic** and is checked separately: identical
hap-stream SHA-1 across twelve processes, printed on every run and re-derived
by `--verify-determinism`. It earned that check — two captures during
development disagreed, and the cause was another session editing
`src/audio/layers.ts` underneath the run.

### Seen red: the bass filter, deliberately closed

A gate that has never failed is not evidence, so the tool was pointed at a
defect built on purpose. `buildBass`'s active branch is the `wub` sub-builder,
whose cutoff is `m.sig.openness.range(300, 1050)`; it was temporarily changed
to `range(90, 180)` and the file restored byte-for-byte afterwards (verified by
hash, not by `git checkout` — there were other people's uncommitted changes in
`src/`). Bass soloed, 16 bars, same seed:

```
   Hz    300-1050   90-180      delta
 31.5      -67.4     -60.7      +6.7
   63      -55.5     -54.8      +0.7
  125      -18.2     -18.3      -0.1
  250      -29.6     -30.1      -0.5
  500      -41.7     -44.9      -3.2
 1000      -49.6     -56.4      -6.8
 2000      -63.0     -72.6      -9.6
 4000      -79.5     -85.1      -5.6
 8000      -91.3     -93.0      -1.7
```

The fundamental sits in 125 and does not move; everything above the new cutoff
falls away with the slope of a 24 dB/oct ladder. Against the 0.019 dB
run-to-run spread measured on this stem (the bass solo has no reverb bus and
none of the full mix's 1.3 dB), a 9.6 dB move is not ambiguous.

**A note found while aiming that test — and the correction it needed.** The
first version of this paragraph claimed `buildBass`'s
`.lpf(m.sig.openness.range(500, 2300)).ftype('ladder')` chain "never runs,
because the `wub` branch returns first" and that "changing it moved nothing".
**Both halves were wrong, and the second is the instructive one.**

`basscheck` prints the rota: halftime 38%, boomchick 25%, chase 13%, gallop 13%,
shuffle 13%. Only halftime takes the early `return stack(` at `layers.ts:1447`,
so the chain runs on **62%** of waves, not none. Measured on the haps rather
than read off the branch: 12 of 44 bass haps carry `cutoff` 1156.0-1674.5 Hz,
which is exactly `range(500, 2300)` evaluated at openness 0.364-0.652. Patching
the floor to `range(50, 60)` moves the 125 Hz band 12.4 dB and shifts integrated
loudness by 13.4 LU.

"Changing it moved nothing" was therefore not a measurement — it was an edit
that was made and never measured, reported in the grammar of a result. That is
this directory's own recurring failure mode in a new costume, and it is exactly
what `AGENTS.md` §3 means by printing every denominator: a capture that examined
the halftime state alone and concluded about all five is a check with a
denominator of one reporting on five.

The `hcutoff`/`ftype` collision the paragraph went on to describe was real and
**is now fixed** — see §4 of `AGENTS.md` and the commit that removed all three
highpasses.

### What it still cannot tell you

A band share is not an instrument's share — the same caveat `spectrum.mjs`
spends a paragraph on. And the analyser is checked against a known answer
rather than trusted: `--selftest` pushes a 1 kHz -20 dBFS stereo sine through
it and should read -23.0 dBFS in the 1000 Hz band (a sine's mean square is 3 dB
below its peak), 100.0% share, peak -20.0 dBFS, and -20.25 LUFS.
