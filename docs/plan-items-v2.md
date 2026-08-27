# Items, take two: why the first pass was not enough

The owner, after playing the first item pass: *"there currently not fun, i want
to change them all up considerably, and i feel like all the changes youve made up
until now on items have not impressed me."*

That is correct and this document starts by saying why, because the reason
determines the fix.

---

## 1. What the first pass actually did, and why it did not land

It fixed four **defects**:

| defect | fix |
|---|---|
| the gun straddled its target on every even bolt count | converge on targets |
| 13 of 15 evolutions produced the same verb as their base | re-point shapes, 7 verbs → 14 |
| all 12 passives were flat stat multipliers | 6 install rules instead |
| a fusion cost 13 picks; a naive run saw 0.33 of one | 3+3 ladder, 5.67 per run |

Every one of those was real, measured, and worth doing. **None of them is a
design idea.** Fixing defects gets you to *not broken*. It does not get you to
*fun*, and the gap between those two is the whole complaint.

Here is the roster as a player meets it:

```
pizzicato  seek    Dry bolts at the nearest thing moving.
snare      arc     A sweep through the arc you are facing.
bow        lance   One held beam along your facing.
chime      strike  Strikes something at random from above.
harp       arc     A fan of bolts sweeping across your facing.
drones     orbit   Pods that circle you and shoot.
nova       aura    A ring on the beat that hurts what it touches.
blackhole  field   A well that drags everything in and crushes it.
feedback   cone    A blast out of the front of the hull.
echoes     seek    Bolts that come back off the walls.
timpani    aura    A slow, enormous shockwave.
tremolo    trail   Pools left in your wake.
```

**Twelve items and one idea.** Every single one is *damage is dealt in shape X*.
The shapes are now genuinely distinct — that was the first pass's achievement —
but distinctness of shape is not variety of decision. Picking between them is
picking a delivery geometry, and after two runs the player has learned that the
geometry rarely changes what they DO. They still move away from things and let
damage happen.

The rig is the same story one level down. Seven of twelve are still numbers
(`spread`, `rapid`, `capo`, `reverb`, `magnet`, `resonance`, and most of
`laser`), and the five that became rules are all *more damage, differently*.

**So the honest diagnosis: the roster has no second axis.** Vampire Survivors
has Laurel (pure invulnerability), Clock Lancet (freezes, deals nothing), Garlic
(knockback and stun), Pentagram (deletes the screen), Tiragisú (revives you).
Ball x Pit has balls that build, balls that generate, and a combination lattice
where experimenting IS the game. MusicWars has twelve damage dealers.

---

## 2. The axis nobody has used, and it is the one this game owns

This game generates its soundtrack from play. `DirectorReadout` already publishes
`section`, `act`, `runPhrase`, `tacet` (which lane is resting), `bpm`, `key`,
`feel`, `tension`, `energy`, `modeBias`, `leadRegister`. `Transport` already
gives `bar`, `phrase`, `barPhase`, `phrasePhase`, `crossings(div)`.

**Every one of those flows game → music. Not one flows back.** The music is
output only. It is a beautiful readout of a fight it has no say in.

That is the novel axis, and it is the answer to *"following inspiration from
Vampire Survivors and Ball x Pit"* without becoming a clone of either. Copying
VS's weapon list gets a worse VS. Making the soundtrack a **mechanic** gets
something neither game can do, in a game already built to do it.

An item on this axis is one the player can **hear themselves playing**. That is
the pitch, and it is the only pitch here that is not available to a competitor.

---

## 3. Four axes, and a roster that uses all four

The rule from AGENTS.md §5 still binds: the offer is zero-sum, so this **replaces
what the twelve instruments do rather than adding a thirteenth**. Every id keeps
its audio lane and its catalyst relationship. Same trick as before, aimed at
design instead of plumbing.

### Axis A — musical (the new one, 5 slots)

| item | what it does | what the player does differently |
|---|---|---|
| **METRONOME** (`pizzicato`) | fires **only on the downbeat**, for ~8× a normal shot | you plan your position around the bar. Being caught mid-dodge on the 1 is a real loss |
| **DROP** (`feedback`) | near-inert during intro/build/breakdown; **the strongest thing in the game during the drop** | the run's musical arc becomes a combat clock you save resources for |
| **SYNCOPATION** (`snare`) | fires on the **off**-beat; enemy volleys land on the beat | you fight in the gaps. It is the anti-metronome and they anti-synergise on purpose |
| **TACET** (`tremolo`) | you **silence one stem**; charge banks while it is quiet and discharges when you let it back in. The mix visibly thins | a resource loop made of the arrangement. You choose to make your own soundtrack worse for a payoff |
| **CRESCENDO** (`timpani`) | damage scales with `energy` — feeble when safe, enormous when surrounded | inverts the risk curve. The only weapon that wants you in trouble |

### Axis B — not damage at all (3 slots)

The roster currently has zero of these and it is the most obvious hole.

| item | what it does |
|---|---|
| **REST** (`nova`) | a full bar of invulnerability on a long cooldown — and it **silences your whole band** while active. A real cost, and an audible one |
| **RITARDANDO** (`chime`) | drags enemy time down hard in a radius, and **your own fire rate with it**. Control, not damage |
| **SOSTENUTO** (`echoes`) | the last enemy you killed returns as a ghost that fights for you until it expires |

### Axis C — items that modify other items (2 slots)

Ball x Pit's actual core is that things compose. Nothing here composes today; rig
items are global multipliers, which is the flattest possible version.

| item | what it does |
|---|---|
| **COUNTERPOINT** (`harp`) | your **second** instrument fires a copy whenever your first does. Loadout ORDER becomes a decision |
| **UNISON** (`drones`) | every instrument you hold fires **together on the bar** instead of on its own timer. Converts a trickle into a volley, and makes breadth beat depth |

### Axis D — keep two honest damage dealers (2 slots)

`bow` (lance) and `blackhole` (field) stay roughly as they are. A roster where
everything is exotic has no baseline to be exotic against, and both are already
the most distinct things in the current twelve.

---

## 4. The rig, same treatment

Seven of twelve are still percentages. Percentages are fine as *some* of a rig —
six was the split argued in `plan-passives.md` and that still holds — but the
numeric six should be the ones where a number is genuinely the interesting
knob (`spread`, `rapid`, `magnet`, `resonance`), and the rest should move onto
the musical axis:

- **`capo` → TRANSPOSE**: shifts the key. Enemies take damage proportional to how
  far round the cycle of fifths the modulation travelled.
- **`reverb` → DECAY**: everything you do leaves an echo that repeats at a fixed
  delay. The delay is the track's actual delay time.
- **`laser` → OSTINATO**: the charge counter runs on **bars**, not shots.

---

## 5. Combination density — the Ball x Pit lesson

15 authored recipes over 12 instruments is a sparse lattice, and the player meets
maybe five of them. Ball x Pit's appeal is that *everything* combines with
everything and finding out is the game.

The generic duet system already exists and AGENTS.md records it as filler,
because a duet is currently a stat blend. **Make a duet carry both parents'
VERBS** — the research doc's Part E proposal — and 12 instruments become 66 real
combinations on top of the 15 authored ones. METRONOME × CRESCENDO is a downbeat
that scales with danger. TACET × DROP banks silence and spends it in the drop.

That is where "rich ecosystem" actually comes from: not 27 items, but a lattice
where the interesting thing is what you put next to what.

---

## 6. Order of work, and how we will know

1. **Build the musical-input surface.** `World` reads `DirectorReadout` and
   `Transport` today for visuals; route them into the firing path. This is the
   enabling step for Axis A and is small — the data is already in the room.
2. **Ship THREE items first, one per axis** — METRONOME, REST, COUNTERPOINT —
   and play them before building the other nine. The first pass's mistake was
   shipping twelve changes and finding out afterwards that none of them landed.
3. Then the rest of Axis A and B.
4. Then duets carrying both verbs (Axis C/§5), which is the largest single
   multiplier on variety and the riskiest, so it goes last.

**How we will know, and this is the part the first pass got wrong.** Every gate
in `tools/` measures whether an item *functions* — `deadhunt-ranges` proves a
stat is read, `rulefire` proves a rule fires, `builds` proves the pick changes
the run. **Not one of them can measure whether an item is interesting**, and all
of them were green through a roster the owner found boring. So the acceptance
test for this pass is not a gate:

> Ship three items. Play them. If the answer is "I did something different
> because of that item", build the other nine. If not, throw them out and say so.

The gates stay as regression protection. They are not evidence of fun and this
document should not be read as promising they are.

---

## 7. What would falsify this plan

- **The musical axis may not be legible in play.** A weapon that fires on the
  downbeat is only interesting if the player can FEEL the downbeat. The mix is
  now loud enough and the kick is in an audible octave, both fixed this week —
  but if the beat is not obvious under combat, METRONOME reads as "my gun is
  randomly slow" and the whole axis fails. **This is the biggest risk and it is
  testable cheaply with one item.**
- **Non-damage items may feel weak** in a game whose whole feedback vocabulary is
  damage numbers and screen shake. REST silencing the band is only satisfying if
  the silence reads as dramatic rather than as a bug.
- **Order-dependence in COUNTERPOINT may be invisible.** If the player cannot see
  which instrument is "first", the item is a coin flip.
