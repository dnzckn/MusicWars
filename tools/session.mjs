/*
 * session — drive the whole MusicDirector through a simulated run.
 *
 * Every other audio check in this directory tests one builder in one state.
 * That is necessary and it is not sufficient, because nothing in it exercises
 * the thing that actually makes the music: the director, deciding bar by bar
 * what the tension is, which mode to be in, which section to be in, which
 * stems to allocate voices to, and when to rebuild a pattern. That machinery —
 * the arranger, the tension model, the voice budget, the hysteresis — had never
 * been run end to end anywhere outside a browser.
 *
 * So this plays the game without a game. It builds a plausible twelve minutes
 * of a run — waves arriving, enemies massing and dying, health lost and
 * recovered, bosses at intervals, powerups picked up — advances the transport
 * at 60fps, and samples the director's own readout every bar.
 *
 * WHAT IT ASSERTS, and each is a failure this project has actually seen or come
 * close to:
 *
 *   FINITE      No NaN or Infinity reaches a control. A single non-finite gain
 *               silences a lane in Web Audio permanently, with no error.
 *
 *   ALIVE       Every stem's level actually moves. A fader pinned at one value
 *               for twelve minutes is a dead lane — either always on (so it
 *               contributes nothing dynamic) or never on (so the work that
 *               built it is inaudible). `DUCK_KICK_FLOOR` was exactly this
 *               class of bug: a ratio mathematically pinned at 1 for a whole
 *               run while looking like a groove device.
 *
 *   NOT SILENT  The mix never goes quiet for longer than a phrase. Dead air is
 *               the worst possible failure for a score that is meant to be the
 *               primary experience.
 *
 *   MOVING      Key, mode, section and feel all change over the run. A score
 *               that never modulates and never changes section is a loop, and
 *               "this sounds like a loop, not a piece" is the complaint this
 *               whole refactor exists to answer.
 *
 *   MELODY      The lead is audible for a substantial share of the run. Gating
 *               the only tune behind "the player is in serious danger" once
 *               meant it was absent for most of a run; a track with no tune is
 *               just a beat.
 */
import { makeSignals } from './lib/headless-audio.mjs';

const { MusicDirector } = await import('../src/audio/director.ts');
const { Transport } = await import('../src/core/transport.ts');
const { emptySnapshot } = await import('../src/core/events.ts');
const { findNonFinite } = await import('../src/audio/probe.ts');
const { STEM_CURVES } = await import('../src/audio/layers.ts');

void makeSignals; // the director builds its own signals; import kept for parity

const FPS = 60;
/*
 * The horizon, and it was too short.
 *
 * This was a hardcoded 12, which reached wave 18. `deadhunt` then measured real
 * runs to death rather than to a clock: **0 deaths in 16 runs of 20 minutes,
 * reaching wave 32-40.** So this gate was sampling roughly the first half of a
 * run and reporting it as the run — the same defect as `arena`'s 3-minute
 * default, in my own file.
 *
 * It matters more here than it looks. Tempo caps at wave ~18 (`base` is
 * `min(138, 122 + wave * 0.9)`), modulation fires every 4th wave, and the six
 * themes cycle every other wave — so everything this file measures about
 * variety and development is answering "what happens before any of it
 * saturates".
 */
const MINUTES = Number(process.argv[2] ?? 22);
const STEPS = FPS * 60 * MINUTES;
const WAVE_SECONDS = 40;

const director = new MusicDirector();
// `reset` is what sets `started`, and `update` returns immediately without it.
// The game calls this when a run begins; a harness that forgets it measures a
// director that is switched off, and every level reads a plausible-looking 0.
director.reset(0);

const transport = new Transport();
transport.start();

const snap = emptySnapshot();
const bars = [];
let wave = 0;
let cleared = false;
let lastHitAt = -999;
let nonFinite = null;
// Peak energy across EVERY frame, not just the once-a-bar samples. Energy moves
// within a bar, so a per-bar reading understates the peak and made `sub` look
// like it could never fire when it demonstrably does.
let peakEnergy = 0;
/** Every section the run actually enters, sampled per frame — see below. */
const sectionsSeen = new Set();

/**
 * Measured with `npm run realprobe` on the real `World`, 15 minutes, wave 28. Each entry is
 * [quantile, value] and is read as an inverse CDF. These are observations, not
 * targets — re-measure them if the game's balance changes.
 */
const REAL_QUANTILES = {
  bulletCount: [[0, 0], [0.5, 5], [0.9, 31], [0.99, 70], [1, 91]],
  bulletsNear: [[0, 0], [0.5, 0], [0.9, 1], [0.99, 8], [1, 22]],
  bulletsVeryNear: [[0, 0], [0.9, 0], [0.99, 3], [1, 10]],
  timeToImpact: [[0, 0.01], [0.5, 0.54], [0.9, 0.94], [1, 1.75]],
  killRate: [[0, 0], [0.5, 0.51], [0.9, 4.1], [1, 17]],
  grazeRate: [[0, 0], [0.9, 0], [0.99, 1.5], [1, 4.44]],
  enemyCount: [[0, 0], [0.5, 5], [0.9, 30], [1, 49]],
  enemyThreat: [[0, 0], [0.5, 0.66], [0.9, 0.9], [1, 1]],
};

/** Tent map. Uniform-preserving, peaks at the middle of the wave. */
const tent = (x) => {
  const f = x - Math.floor(x);
  return 1 - Math.abs(2 * f - 1);
};

/**
 * Inverse CDF by linear interpolation between the measured quantiles.
 *
 * `cycles` is how many times this axis peaks per wave, and it is what stops
 * every axis cresting together. A phase offset alone was not enough: with all
 * eight fields on `tent(p + offset)` they each peak once per wave a little
 * apart, which still overlaps heavily, and the harness came out HOT — p90
 * energy 0.845 against the real game's 0.700, while the median matched. The
 * top of the distribution is exactly where terms co-peaking shows up.
 *
 * An INTEGER multiplier is required, not an arbitrary one: the tent map
 * preserves a uniform distribution over a whole number of periods, so
 * `tent(p * 2 + offset)` is still uniform and the measured marginals below
 * still hold, while a fractional multiplier would leave a partial period and
 * quietly bias every quantile.
 */
function draw(field, phase, offset, cycles = 1, invert = false) {
  let u = tent(phase * cycles + offset);
  if (invert) u = 1 - u;
  const table = REAL_QUANTILES[field];
  for (let i = 1; i < table.length; i++) {
    const [q0, v0] = table[i - 1];
    const [q1, v1] = table[i];
    if (u <= q1) return v0 + ((u - q0) / (q1 - q0 || 1)) * (v1 - v0);
  }
  return table[table.length - 1][1];
}

/** A plausible run: waves arrive, pressure rises and falls, bosses interrupt. */
function drive(step) {
  const t = step / FPS;
  const nextWave = Math.floor(t / WAVE_SECONDS) + 1;
  if (nextWave !== wave) {
    wave = nextWave;
    snap.wave = wave;
    /*
     * Clear the PREVIOUS wave before starting this one. Omitting this was a
     * real gap: `onWaveClear` is the only route into a `breakdown` section
     * (and only on a `perfect` grade), so a simulation that never clears a
     * wave never exercises the one section where the arrangement rests.
     * Grades cycle so all three paths through `onWaveClear` are hit.
     */
    director.onWaveStart(transport, { index: wave, boss: wave % 5 === 0 });
  }

  // Where we are inside the wave, 0..1 — pressure rises and then clears.
  const p = (t % WAVE_SECONDS) / WAVE_SECONDS;

  /*
   * Clear the wave BEFORE the next one starts, with a gap.
   *
   * Firing `onWaveClear` and `onWaveStart` in the same frame — which an
   * earlier version of this harness did — makes the breakdown unreachable:
   * the clear requests one and the start immediately queues a build over the
   * top of it. Real play has several seconds of lull in between, and that lull
   * is the only window in which the arrangement is allowed to rest.
   */
  if (p > 0.86 && !cleared) {
    cleared = true;
    const grade = wave % 3 === 0 ? 'perfect' : wave % 3 === 1 ? 'clean' : 'rough';
    director.onWaveClear(transport, { index: wave, grade, peakMultiplier: 1 + (wave % 4) });
  }
  if (p < 0.5) cleared = false;
  const boss = wave % 5 === 0;

  snap.waveProgress = p;
  snap.bossActive = boss && p > 0.15;
  snap.bossPhase = boss ? Math.min(1, p * 1.2) : 0;
  const lull = p > 0.86 ? 0.08 : 1;   // the gap between waves is genuinely quiet
  snap.enemyCount = Math.round(draw('enemyCount', p, 0.13, 1) * lull);
  snap.enemies = { grunt: snap.enemyCount };
  snap.enemyThreat = draw('enemyThreat', p, 0.17, 2) * lull;
  snap.enemyFireRate = 0.1 + 0.5 * p;
  // Danger axes: `nearestThreat` is 0 when something is touching you.
  snap.nearestThreat = p > 0.86 ? 1 : Math.max(0.05, 1 - 0.85 * Math.sin(p * Math.PI));
  snap.encirclement = Math.max(0, 0.7 * Math.sin(p * Math.PI) - 0.1);
  snap.playerFiring = true;
  snap.focused = p > 0.5;

  /*
   * THE DANGER FIELDS, and this harness did not have them.
   *
   * `TensionModel.update` reads eight terms. Four of them — crowding (weight
   * 0.22), imminence (0.17), momentum (0.11) and density (0.10) — come from
   * `bulletsNear`, `bulletsVeryNear`, `timeToImpact`, `killRate` and
   * `bulletCount`, and this generator set NONE of them. `emptySnapshot()`
   * zeroes them, so **0.60 of the tension model's total weight was pinned at
   * zero for every frame of every run this gate has ever measured.**
   *
   * `fragility` was worse than absent, it was wrong. The real player has
   * `maxHp = 3` and `maxLives = 3` (see `game/player.ts`); this set
   * `playerMaxHp = 100` and swung HP between 45 and 100, a state the game
   * cannot produce. On that scale `fragility` tops out at 0.14. Measured
   * against the real `World` it reaches about 0.75, because the player spends
   * most of a run on their LAST life — `lives` has a median of 1 — and
   * fragility is the single largest driver of real tension, 52% of the time.
   *
   * The consequence was not subtle and it was pointing the wrong way. Driven
   * by the real `World` for 15 minutes, energy runs median 0.632 and peaks
   * 0.851, and 69% of samples sit above 0.54. Driven by this generator it ran
   * 0.26 to 0.54 — and 0.54 is exactly the arithmetic maximum of
   * `progressFloor` (0.2 + 0.2 + 0.14). The gate was not measuring the
   * arrangement responding to danger at all. It was measuring the wave-count
   * ramp, alone, and then reporting in its own headroom section that eight
   * stems "never reach their ceiling" — a conclusion about the music that was
   * entirely an artefact of the harness.
   *
   * Every number below is calibrated against that 15-minute real run rather
   * than invented, quantiles in the comments. The shapes matter more than the
   * digits: bullets are bursty and mostly absent, kills come in runs, and the
   * player is usually one hit from the end.
   */
  /*
   * Each axis gets its OWN phase, and that is load-bearing rather than
   * decoration. Driving every term off one `sin(p*PI)` made them all peak
   * together, which pushed p90 tension to 0.93 against the real game's 0.703
   * — the median was right and the shape was wrong. `tension.ts` says it
   * outright: "a weighted mean of eight terms that rarely peak together". A
   * harness in which they always do is a harness with no middle.
   */
  /*
   * Each field is drawn through its own MEASURED QUANTILE CURVE, rather than
   * from a sine wave scaled by eye.
   *
   * The sine version got the median right and the shape wrong: p90 tension
   * came out 0.93 against the real game's 0.703, and `outnumbered` displaced
   * `hurt` as the dominant driver. The cause is that `sin(p*PI)` is not
   * uniformly distributed — its density piles up near 1 — so every axis it
   * drove spent most of its time near maximum, and terms that are rare in the
   * real game (`bulletsNear` has a real p90 of ONE) were saturated.
   *
   * `tent()` is the fix. For `p` uniform on [0,1] the tent map is also uniform
   * on [0,1], so feeding it into an inverse-CDF built from the measured
   * quantiles reproduces the real marginal distribution by construction rather
   * than by tuning. It still peaks mid-wave, so the wave arc survives, and a
   * per-field phase offset keeps the axes from all cresting together — which
   * is the property `tension.ts` relies on ("eight terms that rarely peak
   * together").
   */
  const pressure = Math.sin(p * Math.PI) * lull;

  // real: p50 2, p90 26, max 81 — long stretches of nothing, then a wall.
  snap.bulletCount = Math.round(draw('bulletCount', p, 0.0, 1) * lull);
  // real: p50 0, p90 1, max 22. Near-misses are rare and clustered.
  snap.bulletsNear = Math.round(draw('bulletsNear', p, 0.07, 2) * lull);
  // real: p50 0, p90 0, max 10.
  snap.bulletsVeryNear = Math.round(draw('bulletsVeryNear', p, 0.05, 3) * lull);
  // real: min 0.01, p50 0.48, p90 1.0, max 1.59. Lower is more urgent.
  // Inverted: the quantile curve is stored low-to-high, but LOW is dangerous.
  snap.timeToImpact = draw('timeToImpact', p, 0.31, 2, true);
  // real: p50 60, p90 60 — the combo sits at its cap for most of a run.
  snap.combo = Math.min(60, Math.round(60 * Math.min(1, p * 2.5)));
  // real: p50 0.85, p90 4.16. The 38 max is a bomb clearing a screen.
  snap.killRate = draw('killRate', p, 0.21, 1) * lull;
  snap.grazeRate = draw('grazeRate', p, 0.13, 3) * lull;

  /*
   * Hits, so `timeSinceHit` is a real number. Two per wave, which puts the
   * median around 12s as measured. The model floors `raw` at 0.55 for 1.5s
   * after a hit, and that path has never once executed in this harness.
   */
  if ((p > 0.3 && p <= 0.3 + 1 / (WAVE_SECONDS * FPS)) || (p > 0.62 && p <= 0.62 + 1 / (WAVE_SECONDS * FPS))) {
    lastHitAt = t;
  }
  snap.timeSinceHit = t - lastHitAt;

  snap.bossHp = boss ? Math.max(0, 1 - p * 1.15) : 1;
  snap.bossPhases = boss ? 3 : 0;

  // The real scale: three hearts, three lives — NOT a 0-100 bar.
  snap.playerMaxHp = 3;
  snap.maxLives = 3;
  /*
   * real: p50 THREE of 3. Re-measured with a moving bot, which mostly does not
   * get hit — the p50 of 2 in the previous version came from a parked probe
   * taking a hit every few seconds, and it made `fragility` (weight 0.12, and
   * the single largest driver of real tension) permanently overstated. The
   * exponent shapes it so health sits at full about two thirds of the time and
   * still reaches 1.
   */
  snap.playerHp = Math.max(1, 3 - Math.round(2 * Math.pow(tent(p + 0.11), 2.5)));
  // real: min 1, p50 1, max 3. Attrition across waves, reset by an extend.
  // real: min 1, p50 1, p90 2, max 3 — the run settles onto the last life.
  snap.lives = wave <= 2 ? 3 : wave <= 4 ? 2 : 1;
  snap.bombs = 2;
  snap.movement = boss ? 'elite' : null;
  /*
   * Abilities, not powerups — matching where the real game actually puts these.
   *
   * The progression rewrite moved nine of the twelve ids onto
   * `snapshot.abilities`; only OVERDRIVE, BOMB and ENCORE still drop in the
   * field. This harness was still filling `powerups`, which meant it was
   * simulating a state the game can no longer produce — and it hid the fact
   * that the band was empty, because `ensembleSize` reads `abilities`.
   *
   * The instrument the player starts with is always present, because the real
   * `World` gives it to them at wave 1; a run with an empty band is not a
   * reachable state and should not be what the gate measures.
   */
  snap.abilities = {
    pizzicato: Math.min(8, 1 + Math.floor(wave / 2)),
    ...(wave >= 3 ? { rapid: Math.min(3, wave - 2) } : {}),
    ...(wave >= 4 ? { snare: Math.min(5, wave - 3) } : {}),
    ...(wave >= 6 ? { laser: 1, bow: Math.min(4, wave - 5) } : {}),
  };
  snap.powerups = wave >= 5 ? { overdrive: 1 } : {};
}

for (let step = 0; step < STEPS; step++) {
  const beforeBar = Math.floor(transport.bar);
  transport.advance(1 / FPS);
  drive(step);
  director.update(snap, transport, 1 / FPS);

  const frame = director.readout(transport);
  peakEnergy = Math.max(peakEnergy, frame.energy ?? 0);
  /*
   * Sections are collected per FRAME, not per bar.
   *
   * The bar-boundary sample below misses `fill` entirely: a fill is one bar
   * long and returns to whatever it interrupted, so it is rarely the section
   * at the instant a bar begins. This gate reported "5 sections" for a run
   * that reaches six, which reads as a section being unreachable when it is
   * only unsampled — the same resolution trap `counterpoint.mjs` records
   * against bucketing a rhythm too coarsely.
   */
  sectionsSeen.add(frame.section);

  const bar = Math.floor(transport.bar);
  if (bar !== beforeBar) {
    const r = frame;
    bars.push({
      bar,
      section: r.section,
      key: r.key,
      feel: r.feel,
      tension: r.tension,
      energy: r.energy,
      driver: r.driver,
      floor: r.progressFloor,
      bpm: r.bpm,
      levels: { ...r.levels },
    });
  }
}

/* Non-finite controls, checked on the assembled master pattern rather than on
 * any single lane — that is what actually reaches the audio graph. */
try {
  nonFinite = findNonFinite(director.masterPattern(), 8);
} catch (e) {
  nonFinite = `probe threw: ${String(e).split('\n')[0]}`;
}

const stems = Object.keys(bars[0]?.levels ?? {});
const failures = [];

/*
 * WAVEFORM-CONDITIONAL CONTROLS, checked because a mismatch is silent.
 *
 * superdough reads some controls only inside one oscillator's branch.
 * `spread`, `unison` and `detune` are honoured for `supersaw` and ignored
 * everywhere else; `pw` is the pulse width and means nothing to a triangle.
 * Setting one on the wrong waveform is not an error at any level — it parses,
 * it type-checks, it reaches the hap, and it does nothing. This project has
 * already shipped that exact bug once: `spread` was set on the pad after the
 * pad became a pulse, and it was inert for as long as it took someone to read
 * superdough's source and notice the branch.
 *
 * Cheap to check and impossible to notice by ear, which is the combination
 * that justifies a gate.
 */
const SUPERSAW_ONLY = ['spread', 'unison', 'detune'];
const mismatched = new Map();
try {
  for (const h of director.masterPattern().queryArc(0, 8)) {
    const v = h.value ?? {};
    const wave = typeof v.s === 'string' ? v.s : '(none)';
    for (const k of SUPERSAW_ONLY) {
      if (v[k] !== undefined && wave !== 'supersaw') mismatched.set(`${k} on '${wave}'`, (mismatched.get(`${k} on '${wave}'`) ?? 0) + 1);
    }
    if (v.pw !== undefined && wave !== 'pulse') mismatched.set(`pw on '${wave}'`, (mismatched.get(`pw on '${wave}'`) ?? 0) + 1);
  }
} catch { /* the finite probe above already reports a broken pattern */ }
if (mismatched.size > 0) {
  failures.push(
    'inert controls — ' + [...mismatched.entries()].map(([k, n]) => `${k} x${n}`).join(', ') +
      ' (superdough only reads these on their own oscillator, so they silently do nothing)',
  );
} else {
  console.log('  ok   controls    — no waveform-conditional control set on the wrong oscillator');
}


console.log(`session — ${MINUTES} simulated minutes, ${bars.length} bars, ${wave} waves\n`);

// FINITE
if (nonFinite && (Array.isArray(nonFinite) ? nonFinite.length : true)) {
  failures.push('finite');
  console.log(`  NON-FINITE controls reached the master pattern: ${JSON.stringify(nonFinite).slice(0, 300)}`);
} else {
  console.log('  ok   finite      — no NaN or Infinity in the master pattern');
}

// ALIVE
const dead = [];
for (const id of stems) {
  const vals = bars.map((b) => b.levels[id]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    dead.push(`${id} (non-finite)`);
  } else if (hi - lo < 0.02) {
    dead.push(`${id} (pinned at ${lo.toFixed(2)})`);
  }
}
if (dead.length) {
  failures.push('alive');
  console.log(`  DEAD LANES  — ${dead.join(', ')}`);
} else {
  console.log(`  ok   alive       — all ${stems.length} stems move across the run`);
}

// NOT SILENT
const loudness = bars.map((b) => Object.values(b.levels).reduce((a, v) => a + (v || 0), 0));
let quietRun = 0;
let worstQuiet = 0;
for (const l of loudness) {
  quietRun = l < 0.05 ? quietRun + 1 : 0;
  worstQuiet = Math.max(worstQuiet, quietRun);
}
if (worstQuiet > 8) {
  failures.push('silence');
  console.log(`  DEAD AIR    — ${worstQuiet} consecutive bars below audible`);
} else {
  console.log(`  ok   not silent  — longest quiet stretch ${worstQuiet} bar(s)`);
}

// MOVING
const uniq = (f) => new Set(bars.map(f)).size;
const keys = uniq((b) => b.key);
const sections = sectionsSeen.size;
const feels = uniq((b) => b.feel);
if (keys < 2 || sections < 3) {
  failures.push('moving');
  console.log(`  STATIC      — ${keys} key(s), ${sections} section(s), ${feels} feel(s)`);
} else {
  console.log(`  ok   moving      — ${keys} keys, ${sections} sections, ${feels} feels`);
  console.log(`                 sections seen: ${[...sectionsSeen].sort().join(', ')}`);
}

// MELODY
const leadAudible = bars.filter((b) => (b.levels.lead ?? 0) > 0.1).length / bars.length;
if (leadAudible < 0.4) {
  failures.push('melody');
  console.log(`  NO TUNE     — the lead is audible in only ${(leadAudible * 100).toFixed(0)}% of bars`);
} else {
  console.log(`  ok   melody      — lead audible in ${(leadAudible * 100).toFixed(0)}% of bars`);
}

// A level readout, because the numbers are the point even when it passes.
console.log('\n  mean level per stem across the run:');
const means = stems
  .map((id) => [id, bars.reduce((a, b) => a + (b.levels[id] || 0), 0) / bars.length])
  .sort((a, b) => b[1] - a[1]);
for (const [id, v] of means) {
  const bar = '#'.repeat(Math.round(v * 40));
  console.log(`    ${id.padEnd(8)} ${v.toFixed(3)}  ${bar}`);
}

const tensions = bars.map((b) => b.tension).sort((a, b) => a - b);
const pct = (p) => tensions[Math.floor(tensions.length * p)] ?? 0;
console.log(
  `\n  tension  min ${tensions[0].toFixed(2)}  p10 ${pct(0.1).toFixed(2)}  ` +
    `median ${pct(0.5).toFixed(2)}  p90 ${pct(0.9).toFixed(2)}  max ${tensions[tensions.length - 1].toFixed(2)}` +
    `   (p10-p90 span ${(pct(0.9) - pct(0.1)).toFixed(2)})`,
);

/*
 * CALIBRATION AGAINST THE REAL GAME.
 *
 * Everything above describes a run this file invents. That is only worth
 * anything if the invented run resembles one the game can actually produce,
 * and for the whole life of this tool it did not: four of the tension model's
 * eight terms were pinned at zero and the player's health was modelled on a
 * 0-100 scale the game does not use, so energy could never exceed
 * `progressFloor` and the gate was measuring a wave-count ramp.
 *
 * The reference below was measured with `npm run realprobe` — which drives the
 * REAL `World` for fifteen minutes (reaching wave 28) and records
 * `readout().energy`. It is a
 * snapshot of one run on one date, not a law, and it is here to be compared
 * against rather than matched exactly — if the game's balance changes these
 * numbers should be re-measured, and a divergence is a question ("which one
 * moved?") rather than an automatic failure.
 */
/*
 * Re-measured with a MOVING bot. The previous reference was taken with the
 * probe parked, which the game now punishes (`campPressure`) and the score now
 * responds to (the camping floor in `tension.ts`) — so those numbers described
 * the one state the design treats as not playing, and ran hot at the top.
 */
const REAL = { p10: 0.36, p50: 0.593, p90: 0.697, max: 0.762, inBand: 46.4, aboveFloor: 92.8, label: 'real World, 15 min, wave 27, moving bot' };
/*
 * THE RESIDUAL, and why it is not worth chasing further.
 *
 * Calibration history: this harness was once +0.30 out (four tension terms
 * pinned at zero and health on a scale the game does not use), then +0.15,
 * and is now about +0.10 at the median with p10 matching to 0.001.
 *
 * What closed most of the gap was giving each axis its own PEAK RATE, not just
 * a phase offset — see `draw`. What remains is a median that sits high, and
 * the cause is structural rather than a mistuned constant: eight axes drawn
 * independently sum toward the middle, while real danger is BURSTY. The game
 * produces long correlated quiet stretches punctuated by spikes, which puts
 * mass at both ends; independent uniforms put it in the centre. Matching that
 * properly needs a mixture model — a shared quiet/busy regime with per-field
 * draws inside it — not another coefficient.
 *
 * Two knobs were tried and rejected on measurement: widening the shared `lull`
 * window moved the median by 0.01 and made the in-band share WORSE (37.7% to
 * 31.3%), and decorrelating the axes further lowers p90 while raising p50,
 * because that is the same central-limit effect pulling harder.
 *
 * So the honest position is that this harness still runs hot in the middle,
 * the drift note below says so on every run, and conclusions about the top of
 * a stem curve drawn from it need confirming with `npm run realprobe`.
 */
const energies = bars.map((b) => b.energy).sort((a, b) => a - b);
const epct = (q) => energies[Math.floor(energies.length * q)] ?? 0;
const inBand = (100 * energies.filter((e) => e >= 0.6 && e < 0.72).length) / (energies.length || 1);
console.log(`\n  energy, this harness vs the real game (${REAL.label}):`);
console.log('    quantile     harness    real     delta');
for (const [k, real] of [['p10', REAL.p10], ['p50', REAL.p50], ['p90', REAL.p90]]) {
  const mine = epct(Number(k.slice(1)) / 100);
  console.log(`    ${k.padEnd(12)} ${mine.toFixed(3)}      ${real.toFixed(3)}   ${(mine - real >= 0 ? '+' : '') + (mine - real).toFixed(3)}`);
}
const emax = energies[energies.length - 1] ?? 0;
/*
 * Drift is reported, never failed. This reference is one measured run; the
 * game's balance is being actively changed, so a divergence means "go and
 * re-measure", not "the build is broken". Silence would be the bad outcome —
 * the previous version of this harness was wrong by 0.3 and said nothing.
 */
const drift = Math.max(Math.abs(epct(0.5) - REAL.p50), Math.abs(epct(0.9) - REAL.p90));
console.log(`    max          ${emax.toFixed(3)}      ${REAL.max.toFixed(3)}   ${(emax - REAL.max >= 0 ? '+' : '') + (emax - REAL.max).toFixed(3)}`);
console.log(`    0.60-0.72    ${inBand.toFixed(1)}%      ${REAL.inBand}%`);
if (drift > 0.08) {
  console.log(
    `    NOTE: this harness runs ${drift > 0 ? 'hot' : 'cold'} by ${drift.toFixed(2)} at p50/p90. It exercises the top of\n` +
      '    every stem curve more than the game does, so "the stem reached its ceiling"\n' +
      '    here is weaker evidence than it looks. Re-measure with `npm run realprobe`\n' +
      '    before treating any headroom conclusion below as a fact about the game.',
  );
}

/*
 * THE GUARD THAT WOULD HAVE CAUGHT THIS.
 *
 * `progressFloor` in `director.ts` is `0.2 + min(0.2, wave*0.02) +
 * waveProgress*0.14`, so its arithmetic maximum is 0.54 and it needs no danger
 * whatsoever to get there. If a run's peak energy never clears that, then
 * every danger term contributed nothing and this harness is driving the score
 * with a wave counter. That is not a finding about the music; it is a broken
 * generator, and it looked exactly like a finding about the music for as long
 * as it went unchecked.
 */
/*
 * The floor comes from the director's own readout, never restated here. An
 * earlier version hardcoded `0.2 + 0.2 + 0.14`; the formula was retuned the
 * same day and the copy silently went stale, so the guard began reporting
 * against a number the code no longer used. A measuring tool that duplicates
 * the thing it measures will eventually measure the duplicate.
 */
const aboveFloor = (100 * bars.filter((b) => b.energy > b.floor + 0.002).length) / (bars.length || 1);
/*
 * A SHARE, not a peak, and the difference is not pedantic.
 *
 * The first version of this guard failed a run only if peak energy never
 * cleared 0.54. Planting the original bug — all the bullet and impact terms
 * dead — produced a peak of 0.556 and the guard passed. One transient poke
 * above the line was enough, because `raw` is floored at 0.55 for 1.5s after a
 * hit and that single path survived. A peak is one sample; it says nothing
 * about whether danger is driving the arrangement or merely grazing it once.
 *
 * The real game rises above its own floor 93.4% of the time. Requiring 10% is
 * a long way below that and still impossible to reach with the danger terms
 * dead, which is exactly the property a guard wants: far from the truth, and
 * far from the failure.
 */
if (aboveFloor < 10) {
  failures.push(
    `danger — only ${aboveFloor.toFixed(1)}% of the run rose above its own progressFloor ` +
      `(the real game manages ${REAL.aboveFloor}%), so the snapshots carry almost no danger and the tension terms are dead`,
  );
} else {
  console.log(
    `  ok   danger      — ${aboveFloor.toFixed(1)}% of the run rises above its own progressFloor ` +
      `(real game ${REAL.aboveFloor}%), so the danger terms are live`,
  );
}

const drivers = new Map();
for (const b of bars) drivers.set(b.driver, (drivers.get(b.driver) ?? 0) + 1);
console.log(
  '  drivers: ' +
    [...drivers.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((100 * v) / bars.length).toFixed(0)}%`).join('  '),
);

/*
 * DYNAMIC RANGE, which is the actual deliverable.
 *
 * A stem's curve maps tension onto level across a band — `lead` runs from
 * `in 0.2` to `full 0.84`. If the tension a real run produces only ever
 * occupies a narrow slice of 0..1, then every fader only ever traverses a
 * narrow slice of its band, and the arrangement is static no matter how
 * carefully the curves were drawn. That is "a wall rather than an
 * arrangement", and it is invisible from reading either the curves or the
 * tension model alone — it only shows up when the two are run together.
 *
 * `used` is how much of its own available band the stem actually travelled.
 */
console.log('\n  dynamic range actually used, per stem:');
const spans = stems
  .map((id) => {
    const vals = bars.map((b) => b.levels[id] ?? 0);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return { id, lo, hi, span: hi - lo };
  })
  .sort((a, b) => a.span - b.span);
for (const s of spans) {
  const flag = s.span < 0.1 ? '  <- barely moves' : '';
  console.log(
    `    ${s.id.padEnd(8)} ${s.lo.toFixed(2)} -> ${s.hi.toFixed(2)}   span ${s.span.toFixed(2)}${flag}`,
  );
}
const meanSpan = spans.reduce((a, s) => a + s.span, 0) / spans.length;
console.log(`\n  mean level span across stems: ${meanSpan.toFixed(2)}`);

/*
 * HEADROOM — how much of each curve the tension model can actually reach.
 *
 * `STEM_CURVES` draws every fader against a 0..1 tension axis, and it is
 * natural to read `full: 0.84` as "at high tension this lane is at its
 * ceiling". Measured, that is not what happens. Driven at sustained maximum
 * danger — 5 HP of 100, one life, forty enemies, boss phase 1, fully
 * encircled, nothing held back, for three minutes — the tension model peaks
 * at about 0.65. The top third of the axis is not reachable by play.
 *
 * So a `full` above that is not a high-intensity setting; it is a setting that
 * never occurs, and the lane spends the whole game climbing a curve it can
 * never finish. This is not necessarily a bug — the curves were tuned against
 * real behaviour and may already account for it — but it must be VISIBLE,
 * because reading the table alone gives exactly the wrong impression, and
 * anyone editing a `full` value is otherwise choosing a number on a scale a
 * third of which is imaginary.
 */
/*
 * WHERE IN ITS RANGE EACH LANE ACTUALLY SITS.
 *
 * Span alone does not distinguish an arrangement from a switch. A lane that
 * slams between its floor and its ceiling and rests at each has exactly the
 * same min and max as one that breathes through the middle — and this codebase
 * has already been bitten by precisely that: the faders once "sat at 0.87-0.98
 * and spent 0% of the time anywhere in between".
 *
 * So: what share of the run does each lane spend parked at the top of its own
 * observed range, and what share in the middle third? A high `top%` with a low
 * `mid%` is a wall wearing a curve's clothing.
 */
console.log('\n  where each lane sits within its own range:');
for (const s of [...spans].sort((a, b) => b.span - a.span)) {
  if (s.span < 0.02) continue;
  const vals = bars.map((b) => b.levels[s.id] ?? 0);
  const norm = vals.map((v) => (v - s.lo) / s.span);
  const top = norm.filter((v) => v > 0.9).length / norm.length;
  const bottom = norm.filter((v) => v < 0.1).length / norm.length;
  const mid = norm.filter((v) => v >= 0.1 && v <= 0.9).length / norm.length;
  /*
   * Three lanes are flat ON PURPOSE and must not be read as defects:
   *   hats    is THE MOTOR, the clock — `STEM_CURVES` calls it "very nearly
   *           flat" and a metronome that fades is not a metronome.
   *   motifs  is overridden in `director.updateLevels` by a `presence` term
   *           deliberately flattened so the loop yields to the shooting.
   *   fx      is event-driven — risers and impacts either happen or do not.
   * Raising `motifs.full` to chase this number was tried and did nothing,
   * because the curve is not what drives it.
   */
  const BY_DESIGN = new Set(['hats', 'motifs', 'fx']);
  const note = BY_DESIGN.has(s.id) ? '  (flat by design)' : '';
  const flag = note || (top > 0.5 ? '  <- parked at the top' : mid < 0.25 ? '  <- switch, not a fader' : '');
  console.log(
    `    ${s.id.padEnd(8)} bottom ${(bottom * 100).toFixed(0).padStart(3)}%   ` +
      `mid ${(mid * 100).toFixed(0).padStart(3)}%   top ${(top * 100).toFixed(0).padStart(3)}%${flag}`,
  );
}

const reachable = peakEnergy;
/*
 * SECTION RUN-LENGTHS — is the arrangement responding to play, or to a clock?
 *
 * Each section has two exits: a tension threshold and a bar-count timeout. If
 * the thresholds sit outside the range the tension model can actually produce,
 * only the timeouts ever fire — and the arrangement becomes a fixed carousel
 * that merely happens to be wired to a game. Identical run-lengths every time
 * are the signature; a section that responds to play has a spread.
 */
{
  const runs = new Map();
  let cur = bars[0]?.section;
  let len = 0;
  for (const b of bars) {
    if (b.section === cur) { len++; continue; }
    if (cur) { if (!runs.has(cur)) runs.set(cur, []); runs.get(cur).push(len); }
    cur = b.section;
    len = 1;
  }
  if (cur) { if (!runs.has(cur)) runs.set(cur, []); runs.get(cur).push(len); }
  console.log('\n  section run-lengths (bars):');
  for (const [sec, ls] of runs) {
    const u = [...new Set(ls)].sort((a, b) => a - b);
    const verdict = u.length === 1 && ls.length > 2 ? '   <- always identical: timeout-driven' : '';
    console.log(`    ${sec.padEnd(11)} n=${String(ls.length).padStart(3)}  lengths ${u.slice(0, 8).join(',')}${verdict}`);
  }
}

/*
 * SIGNAL RANGES — the headless half of `tools/deadconditions.mjs`.
 *
 * That tool was written for exactly the defect class this session keeps
 * turning up: "a condition or range that looked responsive in the source and
 * was a constant in play". Its own header lists tension capped at half its
 * range, an `arp` full point at an energy the game never produces, and
 * `playerFiring` reading true 100% of the time while gating a "dynamic" duck.
 *
 * It has never been runnable here, because it drives Chromium — and Chromium
 * wedges on this machine. So the same question is asked without a browser: for
 * every numeric the director reports, what range does a real run actually
 * produce? A threshold outside that range is dead code no matter how sensible
 * it reads, and this is the table to check a new threshold against BEFORE
 * writing it.
 *
 * This does not replace `deadconditions` — that one also samples raw game
 * snapshot booleans, which the music harness never sees.
 */
{
  const numeric = new Map();
  for (const b of bars) {
    for (const [k, v] of Object.entries(b)) {
      if (typeof v !== 'number' || k === 'bar') continue;
      const e = numeric.get(k) ?? { lo: Infinity, hi: -Infinity, seen: new Set() };
      e.lo = Math.min(e.lo, v);
      e.hi = Math.max(e.hi, v);
      if (e.seen.size < 6) e.seen.add(v);
      numeric.set(k, e);
    }
  }
  console.log('\n  signal ranges a real run produces (check thresholds against these):');
  for (const [k, e] of numeric) {
    const frozen = e.hi - e.lo < 1e-9 ? '   <- CONSTANT: any condition on this is dead code' : '';
    console.log(`    ${k.padEnd(10)} ${e.lo.toFixed(2)} .. ${e.hi.toFixed(2)}${frozen}`);
  }
}

const bpms = bars.map((b) => b.bpm).filter(Number.isFinite).sort((a, b) => a - b);
if (bpms.length) {
  const bp = (q) => bpms[Math.floor(bpms.length * q)] ?? 0;
  const spread = bpms[bpms.length - 1] - bpms[0];
  console.log(
    `\n  tempo  min ${bpms[0]}  p10 ${bp(0.1)}  median ${bp(0.5)}  p90 ${bp(0.9)}  max ${bpms[bpms.length - 1]}` +
      `   (spread ${spread} BPM)`,
  );
  // A score whose slowest moment is still a dance tempo has no repose in it.
  console.log(`         share of bars under 120 BPM: ${((bpms.filter((b) => b < 120).length / bpms.length) * 100).toFixed(0)}%`);
}

console.log(`\n  headroom — highest ENERGY this run reached: ${reachable.toFixed(2)}  (energy, not tension, is what drives the curves)`);
const unreachable = stems
  .map((id) => ({ id, full: STEM_CURVES[id]?.full ?? 0, in: STEM_CURVES[id]?.in ?? 0 }))
  .filter((s) => s.full > reachable)
  .sort((a, b) => b.full - a.full);
if (unreachable.length) {
  console.log('    stems whose `full` is above it, so they never reach their ceiling:');
  for (const s of unreachable) {
    console.log(`      ${s.id.padEnd(8)} full ${s.full.toFixed(2)}${s.in > reachable ? '   (and `in` is unreachable too — lane is effectively off)' : ''}`);
  }
} else {
  console.log('    every stem can reach its ceiling.');
}

/*
 * HEADROOM — does the mix stay under unity with a full band?
 *
 * `engine.ts` states that there is **no master limiter anywhere in the chain**;
 * it relies on a polyphony cap as insurance. So the arrangement itself has to
 * stay inside the ceiling, and nothing was checking that it did.
 *
 * It had already stopped doing so. Adding `ensembleLift` raised level on six
 * lanes at once, and a full band measured 1.33 after the 0.75 master trim —
 * clipping, which is exactly the harshness this refactor exists to remove.
 * `ensembleTrim` fixed it, and this exists so the next level change cannot undo
 * that quietly.
 *
 * Two things this figure is NOT. It is the arithmetic sum of simultaneous
 * amplitudes, and real peaks are lower because voices at different frequencies
 * do not sum in phase — so it is a conservative bound, not a prediction. And it
 * needs the gain curve applied by hand: superdough runs `setGainCurve(x => x*x)`,
 * so every gain-like control is squared before it reaches a node. Forgetting
 * that overstates the sum roughly fourfold, which it did on the first attempt.
 *
 * Deliberately tested at a FULL BAND and high tension rather than at the
 * simulated run's state: the ceiling is a worst-case property and a gate that
 * only samples the average will not see the case that breaks it.
 *
 * VERIFIED TO FAIL. Replacing `ensembleTrim`'s body with `return 1` — the exact
 * defect this guards — makes it report 1.329 and exit non-zero, reproducing the
 * hand measurement to three decimals. A check nobody has watched go red is a
 * check nobody should trust.
 */
{
  const MASTER = 0.75; // volume.ts default; `masterVolume` pre-compensates the curve
  const ampOf = (v) =>
    Math.pow(typeof v?.gain === 'number' ? v.gain : 1, 2) *
    Math.pow(typeof v?.postgain === 'number' ? v.postgain : 1, 2);

  const hd = new MusicDirector();
  hd.reset(0);
  const ht = new Transport();
  ht.start();
  const hs = emptySnapshot();
  Object.assign(hs, {
    wave: 8, waveProgress: 0.6, enemyCount: 14, enemies: { grunt: 14 },
    enemyThreat: 0.8, enemyFireRate: 0.6, nearestThreat: 0.25, encirclement: 0.5,
    playerFiring: true, playerMaxHp: 100, playerHp: 60, lives: 3, maxLives: 3, bombs: 1,
    abilities: { pizzicato: 8, snare: 6, bow: 6, chime: 5, drones: 4, nova: 3, laser: 3, rapid: 3, spread: 2 },
    powerups: {},
  });
  hd.onWaveStart(ht, { index: 8, boss: false });
  for (let i = 0; i < 60 * 30; i++) { ht.advance(1 / 60); hd.update(hs, ht, 1 / 60); }

  const ev = hd.masterPattern().queryArc(0, 2).map((h) => ({
    b: Number(h.whole?.begin ?? h.part.begin),
    e: Number(h.whole?.end ?? h.part.end),
    a: ampOf(h.value),
  }));
  let worst = 0;
  for (const t of ev.map((e) => e.b)) {
    let sum = 0;
    for (const e of ev) if (e.b <= t + 1e-6 && e.e > t + 1e-6) sum += e.a;
    worst = Math.max(worst, sum);
  }
  const out = worst * MASTER;
  if (ev.length === 0) {
    failures.push('headroom');
    console.log('  HEADROOM    — the master pattern produced no events; nothing measured');
  } else if (out > 1) {
    failures.push('headroom');
    console.log(`  CLIPPING    — full band peaks at ${out.toFixed(3)} of full scale, and there is no limiter`);
  } else {
    console.log(`  ok   headroom    — full band peaks at ${out.toFixed(3)} of full scale (${ev.length} events)`);
  }
}

/*
 * THE COLLAPSE — the one section a normal run never reaches.
 *
 * `session`'s main loop reports five sections and `collapse` is not among
 * them, because the player is functionally immortal: score extends carry them
 * to exactly one life and the auto-bomb rescue then refunds every lethal hit.
 * So the death music is unreachable in play, and an unreachable path is a path
 * nobody checks.
 *
 * It had a real bug when first exercised. The collapse zeroes every lane
 * except `fx` and `sub`, and `ensembleLift` — added 150 lines later — put the
 * band straight back: `clap:0.12 chords:0.12 arp:0.15`, the snare, the bow and
 * the pizzicato playing through the player's death. Fixed at the source; this
 * exists so it cannot come back.
 */
{
  const cd = new MusicDirector();
  cd.reset(0);
  const ct = new Transport();
  ct.start();
  const cs = emptySnapshot();
  Object.assign(cs, {
    wave: 8, waveProgress: 0.6, enemyCount: 10, enemies: { pluck: 5, rush: 5 },
    enemyThreat: 0.7, enemyFireRate: 0.5, nearestThreat: 0.3, encirclement: 0.4,
    playerFiring: true, playerMaxHp: 100, playerHp: 60, lives: 1, maxLives: 3, bombs: 0,
    abilities: { pizzicato: 5, snare: 3, bow: 3 }, powerups: {},
  });
  cd.onWaveStart(ct, { index: 8, boss: false });
  for (let i = 0; i < 60 * 25; i++) { ct.advance(1 / 60); cd.update(cs, ct, 1 / 60); }
  const beforeBpm = cd.readout(ct).bpm;

  cd.onPlayerDeath(ct);
  Object.assign(cs, { playerHp: 0, lives: 0, enemyCount: 0, enemies: {}, playerFiring: false });
  let bad = 0;
  for (let i = 0; i < 60 * 14; i++) {
    ct.advance(1 / 60);
    cd.update(cs, ct, 1 / 60);
    for (const v of Object.values(cd.readout(ct).levels)) if (!Number.isFinite(v)) bad++;
  }
  const cr = cd.readout(ct);
  // Everything the collapse is supposed to have silenced.
  const ALLOWED = new Set(['fx', 'sub']);
  const surviving = Object.entries(cr.levels)
    .filter(([id, v]) => v > 0.05 && !ALLOWED.has(id))
    .map(([id, v]) => `${id}:${v.toFixed(2)}`);

  if (cr.section !== 'collapse') {
    failures.push('collapse');
    console.log(`  COLLAPSE    — never entered; section is '${cr.section}' after a player death`);
  } else if (bad > 0) {
    failures.push('collapse');
    console.log(`  COLLAPSE    — ${bad} non-finite levels during the death sequence`);
  } else if (surviving.length) {
    failures.push('collapse');
    console.log(`  COLLAPSE    — lanes still playing through the death: ${surviving.join(' ')}`);
  } else {
    console.log(
      `  ok   collapse    — strips to fx and sub, ${beforeBpm} -> ${cr.bpm} BPM, nothing non-finite`,
    );
  }
}

console.log(failures.length ? `\nSESSION FAILED: ${failures.join(', ')}` : '\nSESSION HOLDS');
process.exit(failures.length ? 1 : 0);
