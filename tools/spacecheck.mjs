/*
 * spacecheck — one delay line per orbit, one room per orbit, and delay on the
 * lanes the references delay. Read off the haps, in Node, no browser.
 *
 * WHY THIS EXISTS. The owner: "music still needs to be a lot better, sounds
 * cheapy". The audit (`scratchpad/cheap/reports/audit.md` §2) read this
 * score's space off its haps: 5/6/8-second rooms at low sends, no delay on
 * any drum or bass hap, and — the part nothing measured — the lead and the
 * arp on ONE shared delay node asking it for two different times. superdough
 * keeps one feedback delay per orbit and retargets its `delayTime` and
 * `feedback` with `setValueAtTime` whenever a hap's values differ from the
 * node's (`node_modules/superdough/superdoughoutput.mjs:53-67`); a hap that
 * sets `delay` without `delaysync`/`delayfeedback` falls to the defaults
 * `3/16` and `0.5` (`superdough.mjs:190-194`) and retargets just the same.
 * `kit.ts` now carries `ORBIT_DELAY` beside `ORBIT_ROOM`; this tool is what
 * keeps a lane from quietly disagreeing with either table.
 *
 * THE ASSERTIONS, each with its denominator printed:
 *
 *   PAIRS     Per orbit, the SET of (delaysync, delayfeedback) pairs on haps
 *             with `delay > 0`. Exactly one pair, and it is `ORBIT_DELAY[o]`
 *             (imported — a copy would lie the day the table moved). A
 *             delayed hap carrying no sync or no feedback is red on its own:
 *             superdough would give it the defaults, which is a second pair.
 *   COVERAGE  Per lane, haps with `delay > 0` against the expectation below
 *             (`EXPECTED`): a "yes" lane with any dry hap is red, a "no" lane
 *             with any wet hap is red, a lane that emitted nothing is red
 *             (a check with no denominator is not a pass), and a lane the
 *             table does not name is red — the table is total on purpose.
 *   ROOMS     Per orbit, the set of `roomsize` values is one value and it is
 *             `ORBIT_ROOM[o]`. `reverbchurn` asserts the consequence (0 IR
 *             rebuilds per bar); this asserts the table. Haps that send
 *             `room` with no `roomsize` are printed per orbit and not gated
 *             (the stab does this today; Stage 3 of the brief owns its chain).
 *
 * WHAT IS SWEPT. Every builder over sections x feels x {plain, nova, hush,
 * graze, hurt, boss, bomb} x two intensities x three bars (0, 3 and the fill
 * bar 7). The brief named three variants (plain, nova, hush); the other four
 * are here because a lane that never sounds in the sweep is a lane this
 * check cannot see: the graze shimmer is the only delayed lane on ORBIT_AIR
 * and needs `grazeRate > 1.2` to exist at all (without it PAIRS on that
 * orbit examines nothing and passes), the fx heartbeat needs `health < 0.34`,
 * the lead's low-brass octaves need a boss, and the bomb voice needs a bomb.
 * The motifs are swept separately, one archetype at a time over sections x
 * feels, because `buildMotifs` plays at most `MAX_MOTIFS` of them by priority
 * and the two delayed ones (echo, glissando) are not the top two.
 *
 * THE CLASSIFIER READS CONTROLS, NOT SOURCE. `.fm()` reaches the hap as
 * `fmi`; `s('sawtooth,sine')` is mini-notation and reaches it as TWO haps,
 * one per source, both carrying the wobble's `lpsync` — the first run of this
 * tool named the wub's saw half "thumb" and its sine half "unlisted" before
 * that was read off the haps (`tools/_scratch_spaceprobe.mjs`, deleted).
 *
 * Written mode only (in Node `kitReady()` is true): the drum delays are
 * chained OUTSIDE `snare()`/`clap()`/`rim()` in `layers.ts`, so both kit
 * bodies carry them by construction; `kitcheck`'s SAME assertion holds the
 * onsets equal across modes and is the place a divergence would show.
 *
 * SEEN RED, once per assertion, 2026-09-05 (each break made and reverted by
 * hand, the restored file verified with `cmp`; the lines quoted are what the
 * tool printed):
 *
 *   PAIRS     the lead's `.delaysync(ORBIT_DELAY[ORBIT_HARMONY].sync)` set
 *             back to `1 / 4` -> "orbit 3 carries 2 (sync, feedback) pairs:
 *             0.1875|0.4 [arp motif:echo motif:glissando stab]  0.25|0.4
 *             [lead]"
 *   PAIRS     the backbeat's `.delaysync`/`.delayfeedback` removed ->
 *             "orbit 1 carries 2 (sync, feedback) pairs: 0.125|0.3 [backbeat
 *             ghost]  -|- [backbeat]" and "orbit 1: 7644 delayed haps carry
 *             no delaysync/delayfeedback (superdough would default them to
 *             3/16 · 0.5) [backbeat]"
 *   COVERAGE  `.delay(0.2)` on `sub()` in kit.ts -> "sub: expected NO delay,
 *             3732 of 3732 haps carry one" (and PAIRS on orbit 5, bare)
 *   COVERAGE  the pluck's `.delay(0.35)` removed -> "pluck: expected delay,
 *             1470 of 1470 haps carry none"
 *   ROOMS     `.roomsize(2)` on the stab -> "orbit 3 carries 2 roomsize
 *             values: 3 [arp lead motor power]  2 [stab]"
 *
 *   The first two breaks were applied with a multi-line `perl -0` pattern
 *   written with `\n`; the sources are CRLF and the pattern matched nothing,
 *   so the tool ran green against an unbroken file twice. A fail-test that
 *   reports "still green" has to print the substitution count before it is
 *   believed; the retry printed 1 and went red.
 *
 *   node --experimental-transform-types tools/spacecheck.mjs
 */
import { makeSignals, notesIn } from './lib/headless-audio.mjs';

const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const K = await import('../src/audio/kit.ts');
const { buildChord } = await import('../src/audio/theory.ts');

const SECTIONS = ['intro', 'build', 'drop', 'sustain', 'breakdown', 'fill', 'collapse'];
const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];
const INTENSITIES = [0.4, 0.8];
const BARS = [0, 3, 7];
const VARIANTS = {
  plain: {},
  nova: { powerups: { nova: 1 } },
  hush: { movement: 'hush' },
  graze: { grazeRate: 4 },
  hurt: { health: 0.2 },
  boss: { boss: true, bossTheme: true, bossPhase: 1 },
  bomb: { bombs: 1 },
};
const ARCHETYPES = ['pluck', 'stutter', 'arpeggiator', 'glissando', 'subdrop', 'echo', 'rush', 'conductor'];
const remap01 = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/** A `MusicalState` good enough to build one bar of every lane with. */
function state(over = {}) {
  const tonic = 57;
  const mode = 'aeolian';
  const i = over.intensity ?? 0.7;
  return {
    tension: i,
    immediate: 0.5,
    section: over.section ?? 'drop',
    buildProgress: 0.5,
    fillBar: over.bar === 7,
    bar: over.bar ?? 0,
    tonic,
    mode,
    chord: buildChord(tonic, mode, 0),
    nextChord: buildChord(tonic, mode, 4),
    chordIndex: 0,
    barInPhrase: over.bar ?? 0,
    phrase: 1,
    feel: over.feel ?? 'boomchick',
    bpm: 136,
    intensity: i,
    brightness: 0.5,
    powerups: {},
    enemies: { pluck: 0, stutter: 0, arpeggiator: 0, glissando: 0, subdrop: 0, echo: 0, rush: 0, conductor: 0 },
    boss: false,
    bossTheme: false,
    bossPhase: 0,
    wave: 4,
    recap: false,
    bombs: 0,
    health: 1,
    grazeRate: 0,
    combo: 0,
    leadRegister: 0,
    movement: null,
    sig: makeSignals(strudel, {
      density: remap01(i, 0.18, 0.5),
      fill: remap01(i, 0.58, 0.82),
      ornament: remap01(i, 0.68, 0.9),
    }),
    ...over,
  };
}

/*
 * The lane table. Which lanes carry a delay is the DESIGN (`scratchpad/cheap/
 * spec-v2.md` STAGE 2, from the references): the backbeat, the ghosts, the
 * sampled pluck, the stab, the arp, the lead, the graze shimmer and the two
 * motifs whose character IS the echo. Everything else is dry, and the reasons
 * are on the chains — hats and shaker (a 16-hap grid smears), the kick and
 * the sub (the floor), the wub/reese/mid (a delayed LFO is a second sweep out
 * of phase), the motor (the clock).
 *
 * `absent` marks a lane the table names before it exists (Stage 3 adds the
 * bed, a sine in the chords lane, with no delay); it is printed as absent
 * rather than failed, and the moment it lands it is gated like the rest.
 */
const EXPECTED = {
  backbeat: { delay: true },
  ghost: { delay: true },
  pluck: { delay: true },
  stab: { delay: true },
  arp: { delay: true },
  lead: { delay: true },
  shimmer: { delay: true },
  'motif:echo': { delay: true },
  'motif:glissando': { delay: true },
  kick: { delay: false },
  hats: { delay: false },
  shaker: { delay: false },
  bell: { delay: false },
  sub: { delay: false },
  motor: { delay: false },
  wub: { delay: false },
  reese: { delay: false },
  mid: { delay: false },
  bed: { delay: false, absent: 'Stage 3 of the brief adds the sine bed' },
  roll: { delay: false },
  'fx-air': { delay: false },
  heartbeat: { delay: false },
  power: { delay: false },
  'motif:pluck': { delay: false },
  'motif:stutter': { delay: false },
  'motif:arpeggiator': { delay: false },
  'motif:subdrop': { delay: false },
  'motif:rush': { delay: false },
  'motif:conductor': { delay: false },
};

const HATS = new Set(['mw_hh909', 'mw_oh909', 'mw_hhlinn']);

/** Which lane a hap belongs to, from the builder that emitted it and its controls. */
function laneOf(builder, h) {
  const s = String(h.s ?? '');
  switch (builder) {
    case 'sub':
      return 'sub';
    case 'kick':
      return 'kick';
    case 'clap':
      if (s === 'mw_sd909' || s === 'mw_cp909') return 'backbeat';
      if (s === 'mw_rim909') return 'ghost';
      if (HATS.has(s)) return 'hats';
      if (s === 'mw_sh808') return 'shaker';
      if (s === 'triangle' && h.fmi !== undefined) return 'bell';
      return `clap/${s}`;
    case 'motor':
      return 'motor';
    case 'bass':
      if (s.startsWith('gm_')) return 'pluck';
      if (h.distorttype === 'chebyshev') return 'mid';
      if (s === 'supersaw' && h.lpsync !== undefined) return 'reese';
      if ((s === 'sawtooth' || s === 'sine') && h.lpsync !== undefined) return 'wub';
      return `bass/${s}`;
    case 'chords':
      if (s === 'sawtooth') return 'stab';
      if (s === 'sine') return 'bed';
      return `chords/${s}`;
    case 'arp':
      return 'arp';
    case 'lead':
      return 'lead';
    case 'fx':
      if (h.orbit === K.ORBIT_DRUMS) return 'roll';
      if (h.orbit === K.ORBIT_AIR && h.fmi !== undefined) return 'shimmer';
      if (h.orbit === K.ORBIT_AIR) return 'fx-air';
      if (h.orbit === K.ORBIT_LOW) return 'heartbeat';
      return `fx/${s}`;
    case 'power':
      return 'power';
    default:
      return `${builder}/${s}`;
  }
}

const BUILDERS = {
  sub: L.buildSub,
  kick: L.buildKick,
  clap: L.buildClap,
  motor: L.buildMotor,
  bass: L.buildBass,
  chords: L.buildChords,
  arp: L.buildArp,
  lead: L.buildLead,
  fx: L.buildFx,
  power: L.buildPowerupVoices,
};

const fails = [];
const line = (s) => console.log(s);
const fmtSync = (v) => (v === undefined ? '-' : String(v));

/* ------------------------------------------------------------- the sweep */

const perLane = new Map(); // lane -> { haps, wet, dry, orbits:Set }
const perOrbitPairs = new Map(); // orbit -> Map(pairKey -> { n, lanes:Set })
const perOrbitBare = new Map(); // orbit -> { n, lanes:Set } delayed haps missing sync/feedback
const perOrbitSizes = new Map(); // orbit -> Map(size -> { n, lanes:Set })
const perOrbitRoomNoSize = new Map(); // orbit -> { n, lanes:Set }
let hapsSeen = 0;
let wetSeen = 0;
let statesBuilt = 0;

function bump(map, key, lane) {
  if (!map.has(key)) map.set(key, { n: 0, lanes: new Set() });
  const rec = map.get(key);
  rec.n++;
  rec.lanes.add(lane);
}

function record(lane, h) {
  hapsSeen++;
  const o = h.orbit === undefined ? 0 : h.orbit;
  if (!perLane.has(lane)) perLane.set(lane, { haps: 0, wet: 0, dry: 0, orbits: new Set() });
  const rec = perLane.get(lane);
  rec.haps++;
  rec.orbits.add(o);
  const wet = typeof h.delay === 'number' && h.delay > 0;
  if (wet) {
    wetSeen++;
    rec.wet++;
    if (h.delaysync === undefined || h.delayfeedback === undefined) {
      if (!perOrbitBare.has(o)) perOrbitBare.set(o, { n: 0, lanes: new Set() });
      perOrbitBare.get(o).n++;
      perOrbitBare.get(o).lanes.add(lane);
    }
    if (!perOrbitPairs.has(o)) perOrbitPairs.set(o, new Map());
    bump(perOrbitPairs.get(o), `${fmtSync(h.delaysync)}|${fmtSync(h.delayfeedback)}`, lane);
  } else {
    rec.dry++;
  }
  if (h.roomsize !== undefined) {
    if (!perOrbitSizes.has(o)) perOrbitSizes.set(o, new Map());
    bump(perOrbitSizes.get(o), String(h.roomsize), lane);
  } else if (typeof h.room === 'number' && h.room > 0) {
    if (!perOrbitRoomNoSize.has(o)) perOrbitRoomNoSize.set(o, { n: 0, lanes: new Set() });
    perOrbitRoomNoSize.get(o).n++;
    perOrbitRoomNoSize.get(o).lanes.add(lane);
  }
}

function sweepBuilder(name, build, m, where) {
  let evs;
  try {
    evs = notesIn(build(m), 1);
  } catch (err) {
    throw new Error(`${name} threw (${where}): ${String(err).split('\n')[0]}`);
  }
  for (const h of evs) record(laneOf(name, h), h);
}

for (const section of SECTIONS) {
  for (const feel of FEELS) {
    for (const [variant, over] of Object.entries(VARIANTS)) {
      for (const intensity of INTENSITIES) {
        for (const bar of BARS) {
          const m = state({ section, feel, intensity, bar, ...over });
          statesBuilt++;
          const where = `${section}/${feel}/${variant}/${intensity}/bar${bar}`;
          for (const [name, build] of Object.entries(BUILDERS)) sweepBuilder(name, build, m, where);
        }
      }
    }
  }
}

// The motifs, one archetype at a time so every one of them is examined.
for (const section of SECTIONS) {
  for (const feel of FEELS) {
    for (const a of ARCHETYPES) {
      const m = state({ section, feel, intensity: 0.7, bar: 1, enemies: { ...state().enemies, [a]: 2 } });
      statesBuilt++;
      let evs;
      try {
        evs = notesIn(L.buildMotifs(m), 1);
      } catch (err) {
        throw new Error(`buildMotifs threw (${section}/${feel}/${a}): ${String(err).split('\n')[0]}`);
      }
      for (const h of evs) record(`motif:${a}`, h);
    }
  }
}

line('');
line('spacecheck — one delay line and one room per orbit, and delay where the references put it');
line('');
line(
  `  states built: ${statesBuilt} (${SECTIONS.length} sections x ${FEELS.length} feels x ` +
    `${Object.keys(VARIANTS).length} variants x ${INTENSITIES.length} intensities x ${BARS.length} bars, ` +
    `+ ${SECTIONS.length * FEELS.length * ARCHETYPES.length} motif states)`,
);
line(`  haps: ${hapsSeen} total, ${wetSeen} with delay > 0 (${((wetSeen / Math.max(1, hapsSeen)) * 100).toFixed(1)}%)`);
if (hapsSeen === 0) fails.push('no haps at all; a check with no denominator is not a pass');

/* ------------------------------------------------------------------ PAIRS */

line('');
line('  PAIRS — (delaysync, delayfeedback) per orbit on haps with delay > 0; the table is kit.ts ORBIT_DELAY');
const orbits = [...new Set([...perOrbitPairs.keys(), ...perOrbitSizes.keys(), ...perOrbitRoomNoSize.keys()])].sort((a, b) => a - b);
for (const o of orbits) {
  const pairs = perOrbitPairs.get(o);
  const want = K.ORBIT_DELAY[o];
  const wantKey = want ? `${want.sync}|${want.feedback}` : '(no entry)';
  if (!pairs || pairs.size === 0) {
    line(`    orbit ${o}: no delayed haps (table says ${wantKey})`);
    continue;
  }
  line(`    orbit ${o}: ${pairs.size} pair(s), table says ${wantKey}`);
  for (const [key, rec] of [...pairs].sort((a, b) => b[1].n - a[1].n)) {
    line(`      ${String(rec.n).padStart(6)} haps  ${key.padEnd(14)} [${[...rec.lanes].sort().join(' ')}]`);
  }
  if (pairs.size > 1) {
    fails.push(
      `orbit ${o} carries ${pairs.size} (sync, feedback) pairs: ` +
        [...pairs].map(([k, r]) => `${k} [${[...r.lanes].sort().join(' ')}]`).join('  ') +
        ` — one feedback delay per orbit (superdoughoutput.mjs:53-67); every hap that differs retargets the shared node`,
    );
  } else {
    const [only] = pairs.keys();
    if (only !== wantKey) {
      fails.push(`orbit ${o}'s pair is ${only}, kit.ts ORBIT_DELAY says ${wantKey}; read the table instead of writing a number`);
    }
  }
  const bare = perOrbitBare.get(o);
  if (bare) {
    fails.push(
      `orbit ${o}: ${bare.n} delayed haps carry no delaysync/delayfeedback ` +
        `(superdough would default them to 3/16 · 0.5) [${[...bare.lanes].sort().join(' ')}]`,
    );
  }
}
if (perOrbitPairs.size === 0) fails.push('no orbit carried a delayed hap; PAIRS examined nothing');

/* --------------------------------------------------------------- COVERAGE */

line('');
line('  COVERAGE — delay per lane against the design (EXPECTED in this file)');
line(`    ${'lane'.padEnd(18)} ${'orbit'.padStart(5)} ${'haps'.padStart(7)} ${'wet'.padStart(7)} ${'dry'.padStart(7)}   expected  verdict`);
const lanes = [...new Set([...Object.keys(EXPECTED), ...perLane.keys()])];
lanes.sort((a, b) => {
  const ea = EXPECTED[a]?.delay ? 0 : 1;
  const eb = EXPECTED[b]?.delay ? 0 : 1;
  return ea - eb || a.localeCompare(b);
});
let covered = 0;
for (const lane of lanes) {
  const exp = EXPECTED[lane];
  const rec = perLane.get(lane) ?? { haps: 0, wet: 0, dry: 0, orbits: new Set() };
  const orbit = [...rec.orbits].sort().join('/') || '-';
  let verdict = 'ok';
  if (!exp) {
    verdict = 'UNLISTED';
    fails.push(`${lane}: ${rec.haps} haps from a lane EXPECTED does not name; add it with its expectation`);
  } else if (rec.haps === 0) {
    if (exp.absent) verdict = `absent (${exp.absent})`;
    else {
      verdict = 'NO HAPS';
      fails.push(`${lane}: emitted nothing in the sweep; a lane with no denominator is not covered`);
    }
  } else if (exp.delay && rec.dry > 0) {
    verdict = 'DRY';
    fails.push(`${lane}: expected delay, ${rec.dry} of ${rec.haps} haps carry none`);
  } else if (!exp.delay && rec.wet > 0) {
    verdict = 'WET';
    fails.push(`${lane}: expected NO delay, ${rec.wet} of ${rec.haps} haps carry one`);
  } else {
    covered++;
  }
  line(
    `    ${lane.padEnd(18)} ${orbit.padStart(5)} ${String(rec.haps).padStart(7)} ${String(rec.wet).padStart(7)} ` +
      `${String(rec.dry).padStart(7)}   ${(exp ? (exp.delay ? 'yes' : 'no') : '?').padEnd(8)}  ${verdict}`,
  );
}
line(`    ${covered} of ${lanes.length} lanes match the table`);

/* ------------------------------------------------------------------ ROOMS */

line('');
line('  ROOMS — roomsize per orbit; the table is kit.ts ORBIT_ROOM');
for (const o of orbits) {
  const sizes = perOrbitSizes.get(o);
  const want = K.ORBIT_ROOM[o];
  const noSize = perOrbitRoomNoSize.get(o);
  if (!sizes || sizes.size === 0) {
    line(`    orbit ${o}: no roomsize on any hap (table says ${want})${noSize ? `; ${noSize.n} haps send room with no size [${[...noSize.lanes].sort().join(' ')}]` : ''}`);
    continue;
  }
  line(`    orbit ${o}: ${sizes.size} size(s), table says ${want}`);
  for (const [size, rec] of [...sizes].sort((a, b) => b[1].n - a[1].n)) {
    line(`      ${String(rec.n).padStart(6)} haps  roomsize=${size.padEnd(5)} [${[...rec.lanes].sort().join(' ')}]`);
  }
  if (noSize) line(`      ${String(noSize.n).padStart(6)} haps  room > 0, no roomsize (ride the orbit's IR) [${[...noSize.lanes].sort().join(' ')}]`);
  if (sizes.size > 1) {
    fails.push(
      `orbit ${o} carries ${sizes.size} roomsize values: ` +
        [...sizes].map(([k, r]) => `${k} [${[...r.lanes].sort().join(' ')}]`).join('  ') +
        ` — every change rebuilds the impulse response (superdoughoutput.mjs:69)`,
    );
  } else {
    const [only] = sizes.keys();
    if (Number(only) !== want) fails.push(`orbit ${o}'s roomsize is ${only}, kit.ts ORBIT_ROOM says ${want}`);
  }
}
if (perOrbitSizes.size === 0) fails.push('no orbit carried a roomsize; ROOMS examined nothing');

/* ----------------------------------------------------------------- verdict */

if (fails.length) {
  line('');
  line('FAIL');
  for (const f of fails) line(`  - ${f}`);
  process.exit(1);
}
line('');
line(`ok — ${perOrbitPairs.size} delayed orbit(s) hold one (sync, feedback) pair each, ${covered} lanes match the table, ${perOrbitSizes.size} orbit(s) hold one room each`);
