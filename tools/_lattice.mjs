/*
 * _lattice — the authoring script for the fusion lattice.
 *
 * NOT A GATE. It emits the four blocks that have to agree with each other —
 * the `EvolvedId` union, the `INSTRUMENTS` rows, the `FUSIONS` recipes and the
 * `ENSEMBLE_MIX` lanes — from ONE table, so the four cannot drift apart while
 * they are being written. Once pasted in, `weapons.ts` is the source of truth
 * and this file is history; `tools/fusefire.mjs` is what holds it.
 *
 * Three things it computes rather than asking the author for:
 *
 *   PROPS. Every result's set is `mergeProps(parentA@max, parentB@max)` with
 *   the row's DELTA on top. That makes "an authored fusion is never weaker
 *   than the generic duet it shadows" true by construction instead of by
 *   proofreading — and a row then only has to write what is NEW, which is
 *   exactly the thing that makes the fusion distinct rather than a blend.
 *
 *   DAMAGE, FROM A MEASUREMENT OF THE FALLBACK RATHER THAN A GUESS AT IT.
 *   Taking the ARRANGEMENT of a pair locks the DUET out (`readyDuets` skips
 *   named pairs), so a result weaker than the pairing it replaces is a trap
 *   the player cannot see. The first draft targeted 1.6x the better parent
 *   because `synthesiseDuet` rescales to 1.5x -- and `fusefire` immediately
 *   reported all sixty-three as the worse card, because a duet then runs its
 *   OWN two level steps on top and lands at 2.31x. That is precisely the
 *   "tool holding its own copy of a constant" trap in AGENTS.md 3, so the
 *   factor is now MEASURED off a real duet's stat block and the rows only
 *   name their headroom over it.
 *
 *   TIER TWO. A row's parent may be a row above it. The registry below
 *   resolves those, so a chain is authored the same way a base pair is.
 *
 * ---------------------------------------------------------------------------
 * WHAT A DELIVERY SHAPE CAN ACTUALLY FIRE, because this decided half the table
 * and it is not obvious from `weapons.ts` alone. Read off `world.ts`:
 *
 *   bullets (seek, arc, orbit)  applyStatus + onHit + propHitEffects — all of it
 *   strike                      applyStatus + onHit — no bolt, so no split,
 *                               burst, erode, ghost, accel, and no DARK SILENCE
 *   aura, field, lance          applyStatus only — statuses and nothing else
 *
 * So a fusion whose distinctive property is `chain`, `quake`, `lance`, `leech`,
 * `brood`, `rend` or `execute` must be a bullet or a strike, and one whose
 * distinctive property is `split`, `burst` or `brood` must be a bullet. Four
 * rows were moved off `field` and `strike` for exactly this: LIGHTNING BUG,
 * CATAPULT, SPIDER QUEEN and FLESH MOUND each had their whole identity on a
 * shape that cannot express it, which is the "type-checks, renders, does
 * nothing" defect this repository is full of.
 *
 * `dropProps` is the other half of the same finding. `heavy` and `dark`
 * multiply damage inside `fireInstruments` for EVERY shape, but heavy's cost
 * (slower bolts) and dark's cost (the weapon goes silent) are both paid in the
 * bullet path. On an aura, a field, a lance or a strike they are therefore a
 * free 2.75x or 3.6x, so the six results in that position drop them. They are
 * the only two fields any row is allowed to drop and `fusefire` asserts it.
 *
 * Usage: NODE_OPTIONS=--experimental-transform-types node tools/_lattice.mjs
 */
import './lib/headless-audio.mjs';
const R = new URL('../src/', import.meta.url).href;
const W = await import(`${R}game/weapons.ts`);

const LOWER = new Set(W.PROP_LOWER_IS_STRONGER);

/*
 * Inherited values, so the card text can quote them without lying:
 *   burn 14 x2   poison 10 x1  bleed 4 x2   freeze 0.12  slow 0.6   blind 1
 *   hold 1.2     chain 5/20    quake 96/330 lance 46/680 leech 0.12 charm 0.12
 *   split 4      burst 6       brood 0.5    erode 0.25/0.6  accel 0.45
 *   ghost 1      heavy 2.75    dark 3.6/1.8
 */
const ROWS = [
  /* --------------------------------------------------------------- EMBER */
  { id: 'detonate', label: 'BOMB', shape: 'seek', a: 'ember', b: 'anvil',
    delta: { quake: 95, quakeRadius: 250 },
    stat: { interval: 1.0, count: 2, speed: 820, range: 700 },
    blurb: '{d} dmg x{c}, weighted 2.75x by the iron · every hit blows a 250px ring for 95 and leaves 2 burn stacks.',
    character: 'heavy — a bass drum with a fuse in it',
    line: 'every hit detonates a 250px ring for 95, and the coals go on burning',
    stem: 'kick' },
  { id: 'frostfire', label: 'FROSTFIRE', shape: 'seek', a: 'ember', b: 'chime',
    delta: { vuln: 0.1, vulnStack: 1, freeze: 0.14 },
    stat: { interval: 0.3, count: 3, speed: 1000, range: 620 },
    blurb: '{d} dmg x{c} · frostburn: every hit stacks +10% damage taken, to five, and it still burns and freezes.',
    character: 'shimmering — struck glass over a live coal',
    line: 'frostburn — every hit leaves +10% damage taken, and it still burns and freezes',
    stem: 'lead' },
  { id: 'inferno', label: 'INFERNO', shape: 'aura', a: 'ember', b: 'snare',
    delta: {},
    stat: { interval: 0.45, count: 1, area: 330, linger: 0.5 },
    blurb: '{d} dmg in a 330px ring around you, twice a second · everything in it burns at 14/s a stack and is slowed 60%.',
    character: 'aggressive — a wall of fire, roaring',
    line: 'the fire stops being a bolt and becomes a room you carry with you',
    stem: 'fx' },
  { id: 'magma', label: 'MAGMA', shape: 'field', a: 'ember', b: 'timpani',
    delta: {},
    stat: { interval: 1.3, count: 3, area: 150, linger: 4 },
    blurb: '{d} dmg per gout, three of them, lying where they fall for 4s · anything wading takes 2 burn stacks, 14/s each.',
    character: 'heavy — lava, dropped in gouts',
    line: 'it stops throwing coals and starts pouring — three gouts that lie where they land',
    stem: 'kick' },
  { id: 'brimstone', label: 'BRIMSTONE', shape: 'aura', a: 'ember', b: 'gravel',
    delta: { poison: 12, poisonStack: 2 },
    stat: { interval: 0.5, count: 1, area: 290, linger: 0.45 },
    blurb: '{d} dmg in a 290px ring · everything caught takes BOTH burn and poison stacks, 14/s and 12/s a stack.',
    character: 'eerie — sulphur, hissing',
    line: 'burning AND poisoning everything in 290px — the stone was full of it all along',
    stem: 'sub' },
  { id: 'sun', label: 'SUN', shape: 'field', a: 'ember', b: 'nova',
    delta: {},
    stat: { interval: 2.6, count: 1, area: 520, linger: 6 },
    blurb: '{d} dmg where it is dropped, and it hangs for 6s · everything inside 520px of it is blinded and burning.',
    character: 'shimmering — one unbearable sustained chord',
    line: 'a 520px sun left hanging for six seconds; nothing near it can see or stop burning',
    stem: 'kick' },
  { id: 'fireworks', label: 'FIREWORKS', shape: 'arc', a: 'ember', b: 'harp',
    delta: {},
    stat: { interval: 0.9, count: 4, arc: 1.4, speed: 900, range: 600 },
    blurb: '{d} dmg x{c} lobbed in a spread · wherever one lands 6 more go out from it, and each sets 2 burn stacks.',
    character: 'shimmering — rockets, and then the report',
    line: 'four rockets in a spread, each one bursting into six more, all of them burning',
    stem: 'arp' },

  /* --------------------------------------------------------------- GLASS */
  { id: 'timestop', label: 'TIMESTOP', shape: 'aura', a: 'blackhole', b: 'chime',
    delta: { hold: 5, freeze: 1 },
    stat: { interval: 6.0, count: 1, area: 640, linger: 1.2 },
    blurb: '{d} dmg, and EVERYTHING within 640px stops dead for 5s · once every six seconds, and never a boss.',
    character: 'eerie — everything stops, and one note hangs',
    line: 'everything within 640px stops for five seconds — once every six, which is the whole cost',
    stem: 'sub' },
  { id: 'frostray', label: 'FROSTRAY', shape: 'lance', a: 'chime', b: 'bow',
    delta: { freeze: 0.25 },
    stat: { interval: 0.4, count: 2, area: 16, linger: 0.8, range: 820 },
    blurb: '{d} dmg/s in two held beams reaching 820px · a quarter of everything the line touches freezes solid.',
    character: 'shimmering — a glass rod drawn out',
    line: 'the shards become a held beam, and a quarter of what it crosses freezes solid',
    stem: 'lead' },
  { id: 'blizzard', label: 'BLIZZARD', shape: 'aura', a: 'chime', b: 'snare',
    delta: { freeze: 0.5 },
    stat: { interval: 0.7, count: 1, area: 420, linger: 0.6 },
    blurb: '{d} dmg in a 420px whiteout · half of everything caught freezes outright, and the rest is slowed 60%.',
    character: 'shimmering — a whiteout, all noise and no pitch',
    line: 'a 420px whiteout: half of what it touches freezes, the rest can barely move',
    stem: 'clap' },
  { id: 'glacier', label: 'GLACIER', shape: 'field', a: 'chime', b: 'timpani',
    delta: { hold: 1.5, freeze: 0.6 },
    stat: { interval: 2.2, count: 3, area: 210, linger: 6 },
    blurb: '{d} dmg x{c} in spikes standing for 6s · whatever touches one is HELD where it stands, no roll needed.',
    character: 'heavy — ice, grinding',
    line: 'spikes that stand for six seconds and hold whatever touches them — no roll, just held',
    stem: 'kick' },
  { id: 'venom', label: 'VENOM', shape: 'seek', a: 'chime', b: 'tremolo',
    delta: { slow: 0.55, poison: 14, poisonStack: 2 },
    stat: { interval: 0.35, count: 3, speed: 950, range: 640 },
    blurb: '{d} dmg x{c} · venom stacks that BOTH rot at 14/s and take 55% of the speed. Five stacks, six seconds.',
    character: 'eerie — a slow chromatic slide downward',
    line: 'venom, not poison — it rots at 14/s a stack AND takes 55% of the legs away',
    stem: 'motifs' },
  { id: 'wraith', label: 'WRAITH', shape: 'seek', a: 'chime', b: 'phantom',
    delta: { hold: 0.9, freeze: 0.3 },
    stat: { interval: 0.5, count: 3, speed: 1000, pierce: 99, range: 1200 },
    blurb: '{d} dmg x{c} passing through everything · anything the wraith crosses is HELD where it stands, no roll.',
    character: 'mournful — a cold breath crossing the room',
    line: 'it passes through everything, and everything it passes through stops where it stands',
    stem: 'motifs' },

  /* -------------------------------------------------------------- DETUNE */
  { id: 'swamp', label: 'SWAMP', shape: 'field', a: 'tremolo', b: 'timpani',
    delta: { slow: 0.5, poison: 16, poisonStack: 2 },
    stat: { interval: 1.6, count: 3, area: 190, linger: 5.5 },
    blurb: '{d} dmg x{c} tar pools lying for 5.5s · anything wading takes 2 poison stacks at 16/s AND loses half its speed.',
    character: 'eerie — tar, bubbling',
    line: 'the pools turn to tar: poison as before, and half the speed of anything standing in it',
    stem: 'motifs' },
  { id: 'virus', label: 'VIRUS', shape: 'seek', a: 'tremolo', b: 'pizzicato',
    delta: { chain: 4, chainDamage: 22 },
    stat: { interval: 0.3, count: 3, speed: 920, range: 640 },
    blurb: '{d} dmg x{c} · the disease SPREADS — every hit jumps to 4 more bodies for 22 and infects each of them too.',
    character: 'eerie — one voice infecting the next',
    line: 'the poison spreads: every hit jumps to four more and stacks on all of them',
    stem: 'motifs' },
  { id: 'noxious', label: 'NOXIOUS', shape: 'aura', a: 'tremolo', b: 'nocturne',
    delta: { blind: 0.7, poison: 18, poisonStack: 2 },
    dropProps: ['dark', 'darkCooldown'],
    stat: { interval: 0.9, count: 1, area: 400, linger: 0.6 },
    blurb: '{d} dmg in a 400px cloud · everything in it takes 2 poison stacks at 18/s, and 70% of it is blinded.',
    character: 'eerie — a low cloud that will not lift',
    line: 'a 400px cloud nothing can see through, poisoning everything standing in it',
    stem: 'chords' },
  { id: 'radiation', label: 'RADIATION', shape: 'lance', a: 'tremolo', b: 'bow',
    delta: { vuln: 0.1, vulnStack: 1, poison: 14, poisonStack: 2 },
    stat: { interval: 0.45, count: 2, area: 16, linger: 0.85, range: 860 },
    blurb: '{d} dmg/s in two held beams · every touch is a radiation stack, +10% damage taken, to five. And it rots.',
    character: 'eerie — a sustained cluster, humming',
    line: 'the beam irradiates: +10% damage taken per stack, on top of the rot',
    stem: 'chords' },

  /* ---------------------------------------------------------------- RASP */
  { id: 'hemorrhage', label: 'HEMORRHAGE', shape: 'seek', a: 'pizzicato', b: 'anvil',
    delta: { rend: 0.06, bleed: 7, bleedStack: 3 },
    stat: { interval: 0.5, count: 3, speed: 850, range: 620 },
    blurb: '{d} dmg x{c}, weighted by the iron · every hit also takes 6% of whatever health is LEFT, and leaves 3 bleeds.',
    character: 'aggressive — a saw drawn across a wound',
    line: 'each hit takes 6% of what is LEFT — worthless on chaff, enormous on a boss',
    stem: 'kick' },
  { id: 'sacrifice', label: 'SACRIFICE', shape: 'seek', a: 'pizzicato', b: 'nocturne',
    delta: { vuln: 0.12, vulnStack: 1, bleed: 7, bleedStack: 3 },
    stat: { interval: 0.7, count: 2, speed: 950, range: 780 },
    blurb: '{d} dmg x{c}, tripled by the dark · bleeds AND curses: +12% damage taken a stack. Then it goes quiet 1.8s.',
    character: 'mournful — a chord struck once and left to ring',
    line: 'bleeds and curses at once — three stacks of the wound, one of +12% damage taken',
    stem: 'chords' },
  { id: 'heartswallower', label: 'HEARTSWALLOWER', shape: 'seek', a: 'pizzicato', b: 'phantom',
    delta: { leech: 0.12, bleed: 6, bleedStack: 3 },
    stat: { interval: 0.4, count: 4, speed: 980, pierce: 99, range: 1200 },
    blurb: '{d} dmg x{c} passing through everything · 12% of hits take a point of health off them and give it to you.',
    character: 'mournful — something drawing breath through you',
    line: 'it passes through them and takes something with it — 12% of hits heal you',
    stem: 'motifs' },
  { id: 'vampirelord', label: 'VAMPIRELORD', shape: 'seek', a: 'pizzicato', b: 'siphon',
    delta: { execute: 0.07, leech: 0.25, bleed: 8, bleedStack: 3 },
    stat: { interval: 0.28, count: 5, speed: 950, range: 640 },
    blurb: '{d} dmg x{c}, very fast · a quarter of hits heal you, and 7% simply CONSUME a non-boss outright.',
    character: 'aggressive — a fast, hungry ostinato',
    line: 'a quarter of hits heal you and 7% consume the body entirely, whatever its health was',
    stem: 'chords' },
  { id: 'berserk', label: 'BERSERK', shape: 'aura', a: 'pizzicato', b: 'charm',
    delta: { charm: 0.3, bleed: 6, bleedStack: 2 },
    stat: { interval: 0.5, count: 1, area: 300, linger: 0.4 },
    blurb: '{d} dmg in a 300px ring · 30% of everything caught turns and fights its own neighbours for 5s.',
    character: 'aggressive — a march that turns on itself',
    line: 'a 300px ring of rage — a third of what it catches attacks its own side',
    stem: 'arp' },

  /* ----------------------------------------------------------------- ARC */
  { id: 'storm', label: 'STORM', shape: 'strike', a: 'feedback', b: 'snare',
    delta: { chain: 6, chainDamage: 40 },
    stat: { interval: 0.7, count: 4, area: 130, range: 900 },
    blurb: '{d} dmg x{c} strikes landing ON things, unaimed · each arcs to 6 more for 40 and slows all of them 60%.',
    character: 'mechanical — thunder, arriving in sheets',
    line: 'the lightning stops being aimed — four strikes land wherever the bodies are',
    stem: 'clap' },
  { id: 'flash', label: 'FLASH', shape: 'seek', a: 'feedback', b: 'nova',
    delta: { quake: 55, quakeRadius: 900, chain: 8, chainDamage: 46 },
    stat: { interval: 0.6, count: 2, speed: 1200, range: 760 },
    blurb: '{d} dmg x{c} · every hit blinds and damages EVERYTHING within 900px for 55, then arcs to 8 more for 46.',
    character: 'shimmering — a cymbal choke and a white flash',
    line: 'the whole screen takes 55 and is blinded, every single time it lands',
    stem: 'fx' },
  { id: 'rod', label: 'ROD', shape: 'strike', a: 'feedback', b: 'anvil',
    delta: { chain: 8, chainDamage: 44 },
    dropProps: ['heavy'],
    stat: { interval: 1.4, count: 2, area: 180, range: 900 },
    blurb: '{d} dmg x{c} rods driven into whatever is out there · every strike arcs to 8 nearby for 44.',
    character: 'mechanical — a rod struck on the three',
    line: 'rods driven into the field and struck — eight arcs out of every one',
    stem: 'kick' },
  { id: 'lightningbug', label: 'LIGHTNINGBUG', shape: 'arc', a: 'feedback', b: 'drones',
    delta: { chain: 4, chainDamage: 28, brood: 0.5 },
    stat: { interval: 0.5, count: 5, arc: 2.0, speed: 900, range: 620 },
    blurb: '{d} dmg x{c} sprayed wide · half of what they touch sends a hunter out, and every hit arcs to 4 more.',
    character: 'mechanical — small sparks, everywhere at once',
    line: 'sparks sprayed across the arc — half of what they touch hatches a hunter',
    stem: 'fx' },

  /* --------------------------------------------------------------- SWELL */
  { id: 'sandstorm', label: 'SANDSTORM', shape: 'seek', a: 'snare', b: 'timpani',
    delta: { ghost: 1, blind: 0.6 },
    stat: { interval: 0.5, count: 3, speed: 880, pierce: 99, range: 1100 },
    blurb: '{d} dmg x{c} passing through everything · 60% of what it crosses is blinded, all of it slowed and shocked.',
    character: 'mechanical — grit in the mechanism',
    line: 'it passes through the whole line, blinding and shocking everything on the way',
    stem: 'clap' },
  { id: 'erosion', label: 'EROSION', shape: 'seek', a: 'snare', b: 'blackhole',
    delta: { ghost: 1, rend: 0.08 },
    stat: { interval: 0.55, count: 3, speed: 900, pierce: 99, range: 1200 },
    blurb: '{d} dmg x{c} passing through everything · each pass also takes 8% of the health a body has LEFT.',
    character: 'mournful — a long decay that never quite ends',
    line: 'it passes through and takes 8% of what is left — nothing on chaff, everything on a boss',
    stem: 'clap' },

  /* ------------------------------------------------------------- PHANTOM */
  { id: 'shade', label: 'SHADE', shape: 'seek', a: 'phantom', b: 'nocturne',
    delta: { vuln: 0.14, vulnStack: 1 },
    stat: { interval: 0.75, count: 2, speed: 1000, pierce: 99, range: 1200 },
    blurb: '{d} dmg x{c}, tripled by the dark, passing through everything · every body it crosses is cursed, +14% a stack.',
    character: 'mournful — a curse, whispered',
    line: 'it crosses the whole line and curses everything on it: +14% damage taken a stack',
    stem: 'chords' },
  { id: 'assassin', label: 'ASSASSIN', shape: 'seek', a: 'phantom', b: 'anvil',
    delta: { execute: 0.07 },
    stat: { interval: 0.9, count: 2, speed: 1150, pierce: 99, range: 1300 },
    blurb: '{d} dmg x{c}, weighted by the iron, passing through everything · 7% of hits kill a non-boss outright.',
    character: 'mechanical — one note, precisely placed',
    line: 'seven percent of its hits simply end a non-boss, wherever its health happened to be',
    stem: 'motifs' },
  { id: 'soulsucker', label: 'SOULSUCKER', shape: 'seek', a: 'phantom', b: 'siphon',
    delta: { leech: 0.3, blind: 0.5 },
    stat: { interval: 0.45, count: 3, speed: 900, pierce: 99, range: 1200 },
    blurb: '{d} dmg x{c} passing through everything · 30% of hits heal you, and half of what it crosses is blinded.',
    character: 'mournful — breath drawn out of the room',
    line: 'it draws through the line: 30% of hits heal you, and half of them cannot aim after',
    stem: 'chords' },

  /* --------------------------------------------------------------- ANVIL */
  { id: 'temper', label: 'TEMPER', shape: 'seek', a: 'anvil', b: 'gravel',
    delta: { vuln: 0.12, vulnStack: 1, heavy: 3.2, erode: 0.15, erodeFloor: 0.75 },
    stat: { interval: 1.2, count: 2, speed: 700, pierce: 99, range: 900 },
    blurb: '{d} dmg x{c}, 3.2x and a third of the speed · each blow leaves the metal softer: +12% damage taken a stack.',
    character: 'heavy — struck steel, enormous',
    line: 'triple damage at a third the speed, and every blow makes the next one land harder',
    stem: 'kick' },
  { id: 'drill', label: 'DRILL', shape: 'seek', a: 'anvil', b: 'timpani',
    delta: { lance: 40, lanceRange: 300 },
    stat: { interval: 1.0, count: 2, speed: 760, pierce: 99, range: 1000 },
    blurb: '{d} dmg x{c}, weighted by the iron, pierces everything · it also cuts a 300px line through each body it enters.',
    character: 'heavy — a drum roll boring through',
    line: 'it does not stop at the first — it bores, cutting a line through everything behind',
    stem: 'kick' },
  { id: 'sforzando', label: 'SFORZANDO', shape: 'arc', a: 'anvil', b: 'harp',
    delta: { burst: 7 },
    stat: { interval: 1.1, count: 3, arc: 1.1, speed: 900, bounces: 2, range: 560 },
    blurb: '{d} dmg x{c} in a heavy close spread, weighted by the iron · wherever one lands, 7 more go out from it.',
    character: 'aggressive — one enormous accent, then shrapnel',
    line: 'a close, heavy spread — and seven more bolts out of wherever it lands',
    stem: 'arp' },

  /* -------------------------------------------------------------- GRAVEL */
  { id: 'cutter', label: 'CUTTER', shape: 'seek', a: 'gravel', b: 'bow',
    delta: { heavy: 2.4, lance: 70, lanceRange: 700 },
    stat: { interval: 0.55, count: 2, speed: 640, pierce: 99, range: 900 },
    blurb: '{d} dmg x{c}, weighted 2.4x and slow with it · every body it enters is cut 700px through, front and back.',
    character: 'mechanical — a cutting head, never lifting',
    line: 'a cutting head rather than a bolt: heavy, slow, and 700px of line out of every body',
    stem: 'sub' },
  { id: 'catapult', label: 'CATAPULT', shape: 'arc', a: 'gravel', b: 'harp',
    delta: { quake: 45, quakeRadius: 170 },
    stat: { interval: 1.1, count: 3, arc: 1.3, speed: 620, pierce: 99, range: 700 },
    blurb: '{d} dmg x{c} stones lobbed in a spread · each shocks 170px on contact and throws 6 more out of the impact.',
    character: 'heavy — stones thrown, and landing',
    line: 'stones lobbed in a spread, each shocking 170px and scattering six more',
    stem: 'sub' },
  { id: 'petrify', label: 'PETRIFY', shape: 'lance', a: 'gravel', b: 'accelerando',
    delta: { hold: 1.4 },
    stat: { interval: 0.9, count: 2, area: 20, linger: 0.9, range: 760 },
    blurb: '{d} dmg/s in two held beams · everything standing in the line is HELD, no roll, for as long as it is lit.',
    character: 'heavy — everything in the line stops',
    line: 'everything in the sightline is held where it stands, for as long as the line is on it',
    stem: 'sub' },
  { id: 'landslide', label: 'LANDSLIDE', shape: 'strike', a: 'gravel', b: 'timpani',
    delta: { quake: 130, quakeRadius: 300 },
    stat: { interval: 1.2, count: 3, area: 200, range: 900 },
    blurb: '{d} dmg x{c} landing across the field, unaimed · each one shocks everything within 300px for 130 more.',
    character: 'heavy — the whole low end coming down',
    line: 'the ground goes: three unaimed landings, each shocking 300px for 130',
    stem: 'sub' },

  /* ------------------------------------------------------------ NOCTURNE */
  { id: 'flicker', label: 'FLICKER', shape: 'strike', a: 'nocturne', b: 'nova',
    delta: { blind: 1 },
    dropProps: ['dark', 'darkCooldown'],
    stat: { interval: 1.4, count: 6, area: 150, range: 1100 },
    blurb: '{d} dmg x{c} landing across the whole screen at once, unaimed · everything they touch is blinded outright.',
    character: 'eerie — a lamp failing, over and over',
    line: 'six strikes across the whole screen at once, and everything they touch is blinded',
    stem: 'chords' },
  { id: 'incubus', label: 'INCUBUS', shape: 'field', a: 'nocturne', b: 'charm',
    delta: { charm: 0.28 },
    dropProps: ['dark', 'darkCooldown'],
    stat: { interval: 1.5, count: 2, area: 200, linger: 5 },
    blurb: '{d} dmg x{c} shadows lying for 5s · 28% of whatever walks into one walks back out fighting for you.',
    character: 'eerie — a seductive minor line',
    line: 'shadows left on the ground — what walks into one walks out on your side',
    stem: 'lead' },

  /* ------------------------------------------------------------- FERMATA */
  { id: 'warp', label: 'WARP', shape: 'aura', a: 'blackhole', b: 'nova',
    delta: { slow: 0.5, hold: 1.6 },
    stat: { interval: 1.1, count: 1, area: 380, linger: 0.7 },
    blurb: '{d} dmg in a 380px bubble · time drags in it: everything is HELD and blinded, and slowed 50% on the way out.',
    character: 'shimmering — a bar that will not end',
    line: 'a 380px bubble where time drags — everything inside it is held and blinded',
    stem: 'sub' },

  /* -------------------------------------------------------------- SIPHON */
  { id: 'succubus', label: 'SUCCUBUS', shape: 'orbit', a: 'siphon', b: 'charm',
    delta: { charm: 0.26 },
    stat: { interval: 0.4, count: 4, area: 140, speed: 940, range: 660 },
    blurb: '{d} dmg from four attendants circling you · 26% of what they touch turns, and their hits keep healing you.',
    character: 'shimmering — two voices, one of them lying',
    line: 'four attendants circling; a quarter of what they touch changes sides',
    stem: 'lead' },
  { id: 'zombie', label: 'ZOMBIE', shape: 'seek', a: 'siphon', b: 'accelerando',
    delta: { charm: 0.35 },
    stat: { interval: 0.45, count: 4, speed: 700, bounces: 6, range: 0 },
    blurb: '{d} dmg x{c}, faster off every wall · 35% of what it hits gets back up and fights on your side for 5s.',
    character: 'eerie — a shuffling figure that will not stop repeating',
    line: 'a third of what it hits gets back up on your side',
    stem: 'chords' },
  { id: 'mosquitoswarm', label: 'MOSQUITOSWARM', shape: 'arc', a: 'siphon', b: 'harp',
    delta: { burst: 7 },
    stat: { interval: 1.1, count: 4, arc: 1.6, speed: 880, range: 620 },
    blurb: '{d} dmg x{c} in a spraying swarm · seven more come out of wherever one lands, and hits still heal you.',
    character: 'mechanical — a cloud of small fast things',
    line: 'a swarm rather than a bolt — seven more out of every landing, all of them feeding you',
    stem: 'arp' },
  { id: 'mosquitoking', label: 'MOSQUITOKING', shape: 'seek', a: 'siphon', b: 'drones',
    delta: { brood: 0.55 },
    stat: { interval: 0.5, count: 3, speed: 920, range: 700 },
    blurb: '{d} dmg x{c} · 55% of hits send a hunter out after something else, and the hits still heal you.',
    character: 'mechanical — a swarm with a leader',
    line: 'over half its hits send out a hunter, and every one of them still feeds you',
    stem: 'sub' },

  /* --------------------------------------------------------------- CANON */
  { id: 'offspring', label: 'OFFSPRING', shape: 'seek', a: 'echoes', b: 'accelerando',
    delta: { split: 5, accel: 0.5 },
    stat: { interval: 0.4, count: 3, speed: 760, bounces: 8, range: 0 },
    blurb: '{d} dmg x{c} splitting FIVE times instead of twice · and every one of them is faster off every wall.',
    character: 'eerie — a figure answering itself, faster each time',
    line: 'five splits instead of two, and each one comes off the walls faster than the last',
    stem: 'clap' },
  { id: 'clutch', label: 'CLUTCH', shape: 'seek', a: 'echoes', b: 'harp',
    delta: { brood: 0.4 },
    stat: { interval: 0.7, count: 3, speed: 880, range: 700 },
    blurb: '{d} dmg x{c} that split, scatter AND hatch · 40% of hits send a hunter out on top of the burst.',
    character: 'eerie — a cell dividing, wetly',
    line: 'it splits, it scatters, and two in five of its hits hatch something that hunts',
    stem: 'fx' },
  { id: 'overgrowth', label: 'OVERGROWTH', shape: 'strike', a: 'echoes', b: 'timpani',
    delta: { quake: 130, quakeRadius: 360 },
    stat: { interval: 0.8, count: 3, area: 170, range: 820 },
    blurb: '{d} dmg x{c} landing ON things, unaimed · each one shocks everything within 360px for 130 more.',
    character: 'heavy — growth, and then a collapse',
    line: 'it stops travelling and starts landing — three unaimed strikes, each shocking 360px',
    stem: 'kick' },
  { id: 'maggot', label: 'MAGGOT', shape: 'orbit', a: 'echoes', b: 'drones',
    delta: { burst: 5, brood: 0.5 },
    stat: { interval: 0.45, count: 5, area: 130, speed: 880, range: 660 },
    blurb: '{d} dmg from five circling pods · hits split, send hunters, AND scatter 5 lesser bolts out of the body.',
    character: 'eerie — something small, multiplying',
    line: 'it splits, it hatches, and it bursts — five lesser bolts out of every body it opens',
    stem: 'fx' },

  /* ------------------------------------------------------------ ENSEMBLE */
  { id: 'spiderqueen', label: 'SPIDERQUEEN', shape: 'seek', a: 'drones', b: 'harp',
    delta: { brood: 0.6, burst: 6 },
    stat: { interval: 0.6, count: 3, speed: 880, range: 680 },
    blurb: '{d} dmg x{c} · 60% of hits birth a hunter, and 6 lesser bolts go out of the same body with it.',
    character: 'eerie — a nest, waking',
    line: 'three in five of its hits birth a hunter, and a burst of six goes out with each one',
    stem: 'sub' },
  { id: 'leeches', label: 'LEECHES', shape: 'seek', a: 'drones', b: 'pizzicato',
    delta: { brood: 0.55, bleed: 7, bleedStack: 3 },
    stat: { interval: 0.4, count: 4, speed: 900, range: 660 },
    blurb: '{d} dmg x{c} · 55% of hits attach a hunter, and every hit leaves 3 bleed stacks costing 7 more each.',
    character: 'aggressive — many small mouths',
    line: 'over half its hits attach something that keeps feeding, on top of three bleed stacks',
    stem: 'arp' },
  { id: 'fleshmound', label: 'FLESHMOUND', shape: 'orbit', a: 'drones', b: 'accelerando',
    delta: { brood: 0.6, accel: 0.5 },
    stat: { interval: 0.5, count: 5, area: 150, speed: 820, range: 620 },
    blurb: '{d} dmg from five circling pods, faster off every wall · 60% of what they touch sends a hunter out.',
    character: 'eerie — a heap that keeps producing',
    line: 'five pods throwing hunters out at whatever comes near, all of them speeding up',
    stem: 'clap' },

  /* ---------------------------------------------------------------- DUET */
  { id: 'lovestruck', label: 'LOVESTRUCK', shape: 'aura', a: 'charm', b: 'nova',
    delta: { charm: 0.3 },
    stat: { interval: 0.7, count: 1, area: 430, linger: 0.6 },
    blurb: '{d} dmg in a 430px ring · everything caught is blinded, and 30% of it turns and fights its own side.',
    character: 'shimmering — a love duet, badly timed',
    line: 'a 430px ring: everything in it is blinded and a third of it changes sides',
    stem: 'lead' },

  /* --------------------------------------------------------------- LANCE */
  { id: 'beam', label: 'BEAM', shape: 'lance', a: 'bow', b: 'nova',
    delta: {},
    stat: { interval: 0.4, count: 2, area: 18, linger: 0.85, range: 880 },
    blurb: '{d} dmg/s in two held beams reaching 880px · everything the line touches is blinded outright.',
    character: 'shimmering — one blinding sustained line',
    line: 'the bolt becomes a held beam, and nothing it touches can aim afterwards',
    stem: 'chords' },

  /* ====================================================================== *
   * TIER TWO. The source has chains and the depth is part of why its space
   * feels rich; each of these takes a RESULT and a second instrument.
   * ====================================================================== */
  { id: 'fallout', label: 'FALLOUT', shape: 'seek', a: 'detonate', b: 'tremolo',
    delta: { vuln: 0.12, vulnStack: 2, quake: 140, quakeRadius: 330 },
    stat: { interval: 1.0, count: 2, speed: 800, range: 720 },
    blurb: '{d} dmg x{c}, weighted by the iron · a 330px blast for 140, and 2 radiation stacks: +12% damage taken each.',
    character: 'heavy — the low end of the world falling out',
    line: 'the bomb goes nuclear: 330px, and everything left standing takes 24% more from everything',
    stem: 'kick' },
  { id: 'timebomb', label: 'TIMEBOMB', shape: 'strike', a: 'detonate', b: 'blackhole',
    delta: { quake: 130, quakeRadius: 300 },
    dropProps: ['heavy'],
    stat: { interval: 1.2, count: 3, area: 160, range: 900 },
    blurb: '{d} dmg x{c} shells landing ON things · each blows 300px for 130 and HOLDS everything left in the crater.',
    character: 'heavy — a fuse, and then the one',
    line: 'the bombs are lobbed now, and everything left in the crater is held where it stood',
    stem: 'sub' },
  { id: 'armageddon', label: 'ARMAGEDDON', shape: 'strike', a: 'inferno', b: 'storm',
    delta: { quake: 80, quakeRadius: 220, burn: 24, burnStack: 3 },
    stat: { interval: 0.35, count: 3, area: 150, range: 1000 },
    blurb: '{d} dmg x{c} landing three times a second · each shocks 220px, arcs to 6 more, and sets 3 burn stacks.',
    character: 'aggressive — a meteor shower with no gaps in it',
    line: 'a meteor shower: three strikes a second, shocking, arcing and setting the ground alight',
    stem: 'fx' },
  { id: 'banshee', label: 'BANSHEE', shape: 'aura', a: 'shade', b: 'wraith',
    delta: { vuln: 0.16, vulnStack: 2, blind: 1, freeze: 0.4 },
    dropProps: ['dark', 'darkCooldown'],
    stat: { interval: 1.3, count: 1, area: 700, linger: 0.8 },
    blurb: '{d} dmg in a 700px scream · EVERYTHING in it is cursed twice over, blinded, and 40% of it freezes solid.',
    character: 'mournful — a scream that curses the whole room',
    line: 'it curses every enemy on the screen at once: +32% damage taken, blinded, and held',
    stem: 'chords' },
  { id: 'reaper', label: 'REAPER', shape: 'seek', a: 'soulsucker', b: 'heartswallower',
    delta: { execute: 0.12, leech: 0.35 },
    stat: { interval: 0.42, count: 4, speed: 980, pierce: 99, range: 1300 },
    blurb: '{d} dmg x{c} passing through everything · 12% of hits simply take a non-boss, and 35% of them heal you.',
    character: 'mournful — the last chord, and nothing after it',
    line: 'twelve percent of its hits end a body outright, and a third give you the health back',
    stem: 'motifs' },
  { id: 'eventhorizon', label: 'EVENTHORIZON', shape: 'seek', a: 'sun', b: 'nocturne',
    delta: { execute: 0.3 },
    /*
     * interval 1.6 / count 1 was the first draft, and `fusefire` reported it
     * at 1 fire in 10 rolls — a denominator so thin the gate would flake on
     * the seed rather than on the mechanic. Two bolts at 1.2s is the same dps
     * and thirty rolls.
     */
    stat: { interval: 1.2, count: 2, speed: 900, range: 800 },
    blurb: '{d} dmg x{c}, tripled by the dark · 30% of what they touch is simply gone. Then the weapon goes quiet.',
    character: 'eerie — a single note that swallows the bar',
    line: 'thirty percent of what it touches is gone — not damaged, gone',
    stem: 'sub' },
  { id: 'xray', label: 'XRAY', shape: 'seek', a: 'beam', b: 'cutter',
    delta: { vuln: 0.12, vulnStack: 2, lance: 80, lanceRange: 640 },
    stat: { interval: 0.5, count: 4, speed: 1100, pierce: 99, range: 1100 },
    blurb: '{d} dmg x{c} cutting 640px through every body they enter · each touch is 2 radiation stacks, +24% taken.',
    character: 'shimmering — four lines crossing, all of them lit',
    line: 'four crossed cuts, and everything they touch takes 24% more from everything else you own',
    stem: 'chords' },
  { id: 'sniper', label: 'SNIPER', shape: 'seek', a: 'sforzando', b: 'assassin',
    delta: { lance: 70, lanceRange: 700, execute: 0.12 },
    stat: { interval: 1.0, count: 2, speed: 1600, pierce: 99, range: 1500 },
    blurb: '{d} dmg x{c}, weighted by the iron · each shot cuts 700px through everything, and 12% of hits end a body.',
    character: 'mechanical — one shot, and a very long silence',
    line: 'one shot down the whole line: 12% of what it touches is finished where it stands',
    stem: 'arp' },
  { id: 'diabolus', label: 'DIABOLUS', shape: 'seek', a: 'incubus', b: 'succubus',
    delta: { vuln: 0.15, vulnStack: 2, charm: 0.45 },
    stat: { interval: 0.55, count: 3, speed: 950, range: 700 },
    blurb: '{d} dmg x{c} · 45% of hits turn a body against its own side, and the rest take +30% from everything.',
    character: 'eerie — the tritone, held',
    line: 'nearly half of what it touches changes sides, and the rest of it is condemned',
    stem: 'lead' },
];

/* ---------------------------------------------------------------- build */

const dpsOf = (s) => (s.interval > 0 ? (s.damage * s.count) / s.interval : 0);
const STAT_DEFAULTS = { interval: 1, count: 1, damage: 4, area: 0, arc: 0, speed: 0, pierce: 1, bounces: 0, linger: 0, range: 0 };

/*
 * WHAT A GENERIC DUET IS ACTUALLY WORTH, measured rather than restated.
 *
 * `synthesiseDuet` rescales to 1.5x the better parent AND THEN gives the
 * result two level steps, which a fusion arrives already holding. Reading the
 * ratio off a real duet's own maxed stat block means this number cannot drift
 * the day somebody re-tunes either half of that.
 */
const _pe = W.instrumentStats('ember', 3), _pc = W.instrumentStats('chime', 3);
const FALLBACK = dpsOf(W.instrumentStats(W.duetId('ember', 'chime'), W.maxLevelOf(W.duetId('ember', 'chime'))))
  / Math.max(dpsOf(_pe), dpsOf(_pc));
console.log(`/* a maxed generic duet is ${FALLBACK.toFixed(3)}x its better parent; rows target 1.08x that */`);

const made = new Map();
const propsAt = (id) => made.get(id)?.props ?? W.instrumentProps(id, W.maxLevelOf(id));
const statsAt = (id) => made.get(id)?.stats ?? W.instrumentStats(id, W.maxLevelOf(id));
const known = (id) => made.has(id) || !!W.instrumentDef(id);

const seen = new Set();
const out = { inst: [], fus: [], mix: [], ids: [] };

for (const row of ROWS) {
  const { id, label, shape, a, b, delta, stat, blurb, character, line, stem } = row;
  if (seen.has(id)) throw new Error(`duplicate id ${id}`);
  seen.add(id);
  if (!known(a)) throw new Error(`${id}: unknown parent ${a}`);
  if (!known(b)) throw new Error(`${id}: unknown parent ${b}`);

  const pa = propsAt(a);
  const pb = propsAt(b);
  const props = W.mergeProps(pa, pb);
  for (const k of LOWER) {
    const c = [pa[k], pb[k]].filter((v) => v > 0);
    props[k] = c.length ? Math.min(...c) : 0;
  }
  for (const [k, v] of Object.entries(delta)) {
    if (LOWER.has(k)) props[k] = props[k] > 0 ? Math.min(props[k], v) : v;
    else props[k] = Math.max(props[k], v);
  }
  for (const k of row.dropProps ?? []) props[k] = 0;

  const sa = statsAt(a);
  const sb = statsAt(b);
  const mul = row.mul ?? 1.08;
  const target = mul * FALLBACK * Math.max(dpsOf(sa), dpsOf(sb));
  const interval = stat.interval ?? 1;
  const count = stat.count ?? 1;
  const damage = Math.round((target * interval) / count);
  const full = { ...STAT_DEFAULTS, ...stat, damage };

  const nz = Object.entries(props).filter(([, v]) => v !== 0);
  const statTxt = Object.entries(stat).map(([k, v]) => `${k}: ${v}`).concat([`damage: ${damage}`]).join(', ');
  const propTxt = nz.map(([k, v]) => `${k}: ${+v.toFixed(4)}`).join(', ');
  const text = blurb.replace('{d}', String(damage)).replace('{c}', String(count));
  if (text.length > 131) throw new Error(`${id}: blurb ${text.length} chars\n  ${text}`);
  if (line.length > 131) throw new Error(`${id}: line ${line.length} chars`);

  out.ids.push(`  | '${id}'`);
  out.inst.push(
    `  {\n` +
    `    id: '${id}',\n` +
    `    label: '${label}',\n` +
    `    shape: '${shape}',\n` +
    `    fused: true,\n` +
    `    weight: 0,\n` +
    `    blurb: '${text.replace(/'/g, "\\'")}',\n` +
    `    character: '${character.replace(/'/g, "\\'")}',\n` +
    `    base: stats({ ${statTxt} }),\n` +
    `    props: { ${propTxt} },\n` +
    `    steps: [],\n` +
    `  },`,
  );
  out.fus.push(`  { kind: 'lattice', base: '${a}', catalyst: '${b}', result: '${id}', line: '${line.replace(/'/g, "\\'")}' },`);
  out.mix.push(`  ${id}: '${stem}',`);
  made.set(id, { props, stats: full, shape });
}

console.log(`/* ${ROWS.length} rows */`);
console.log('\n===== EVOLVED IDS =====\n' + out.ids.join('\n'));
console.log('\n===== INSTRUMENTS =====\n' + out.inst.join('\n'));
console.log('\n===== FUSIONS =====\n' + out.fus.join('\n'));
console.log('\n===== ENSEMBLE_MIX =====\n' + out.mix.join('\n'));
