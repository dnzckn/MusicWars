/**
 * threatdensity — does the late game escalate COMPOSITION, or only bodies?
 *
 * `node --experimental-transform-types tools/threatdensity.mjs`
 *
 * WHAT IT MEASURES. Bullet ARRIVALS PER SECOND into a fixed disc that the ship
 * is inside — not enemies on screen, not bullets on screen. Arrivals is a rate
 * (a flux across a boundary); the standing bullet count everything else in this
 * directory reports is a population, and a population conflates "more fire"
 * with "slower fire". Alongside it, the enemy population and the derived ratio
 * threat-per-body, which is the number G2 is actually about.
 *
 * WHY IT EXISTS. `docs/MASTER_PLAN.md` G2: "the full archetype roster is in
 * play by wave 9; past that only group count, HP scale and two urgency gears
 * change". The recorded defect in tools/README.md is sharper than that —
 * "late waves add bodies, not bullets: clutter and easiness are one defect" —
 * and `curve` cannot see it, because `curve`'s pressure term is
 * `bullets + enemies * 3`, which rises whenever bodies do. A metric that adds
 * enemy count into its headline cannot distinguish the two things this gate
 * exists to tell apart. So the enemy count is reported here, never summed in.
 *
 * ------------------------------------------------------------------------
 * FOUR DESIGN CONSTRAINTS, EACH ONE A SCAR IN tools/README.md
 * ------------------------------------------------------------------------
 *
 * (a) THE PROBE IS BOT-INDEPENDENT, AND THAT TOOK MORE THAN "DON'T DODGE".
 *
 *     `bosslength` "measures whether a survival-first bot got shots on target,
 *     which against a moving boss is close to a coin flip" — 90.3% of a boss's
 *     health in 75s and then 0.0% in 149s on the SAME BUILD. Any number read at
 *     a dodging bot's position is a number about the bot.
 *
 *     So the probe here is a FIXED DISC in world space, centred on the arena
 *     centre, and the ship is a blind patrol that never once looks at a bullet:
 *     it chases a waypoint orbiting that centre at a fixed radius and period,
 *     with no reaction to anything. It has no skill to vary.
 *
 *     Two things had to be true before that was honest, and neither is obvious:
 *
 *     1. THE SHIP MAY NOT BE PARKED. `World.idleAnchorX` ramps `campPressure`
 *        after 4 idle seconds, and `bulletScale = warp * (1 + campPressure *
 *        CAMP_BULLET_BOOST)` makes every bullet up to 1.5x faster while also
 *        switching off ENCORE and the auto-bomb rescue. A parked probe measures
 *        a different game — and faster bullets cross a boundary more often, so
 *        it would measure that different game as MORE threatening. The patrol
 *        exists to pin campPressure at 0, and the run asserts that it does.
 *
 *     2. THE SHIP IS A SENSOR, NOT A PLAYER: it is invulnerable. Every player
 *        hit runs `World.onPlayerHit`, which calls `cancelBullets()` and clears
 *        the WHOLE enemy pool — "the screen just got emptied", in world.ts's
 *        own words. An unskilled probe therefore measures LESS threat the worse
 *        it plays, which is the bot-skill confound wearing a disguise. Holding
 *        `player.invuln` above zero removes it: `Player.takeHit` returns false,
 *        so no pool clear, no death, no auto-bomb, no ENCORE. What it costs is
 *        recorded below under DEVIATIONS.
 *
 *     REJECTED: a ring of sample points away from the ship. Aimed fire is aimed
 *     at the ship, so a probe the ship is not inside measures ambient soup and
 *     systematically misses the aimed component. That version is still computed
 *     — as the AMBIENT control, at a fixed disc the ship never visits — for
 *     exactly the reason it was rejected: if AMBIENT ever equals the probe, the
 *     probe is not measuring anything about the player and this line will say
 *     so.
 *
 * (b) WHOLE-WAVE INTEGRATION FROM ONE CONTINUOUS RUN. `curve` was rewritten for
 *     this: "a fourteen-second window lands on whichever phase the wave happens
 *     to be in... successive runs of an unchanged build flagged different waves
 *     each time". Every step of one continuous run is filed under whatever wave
 *     `w.waveIndex` says is live at that instant, and a wave's number is its own
 *     whole life divided by its own duration. Nothing jumps to a wave.
 *
 * (c) BOSS WAVES ARE COMPARED ONLY TO BOSS WAVES. Also from `curve`: "a boss
 *     roughly doubles the pressure of the wave before it, so comparing
 *     neighbours reported the game's own structure back as a defect". BOSS_EVERY
 *     is 4, so waves 4/8/12/16/20/24 form their own ladder and are never
 *     averaged with the others. Waves 1-3 are exempt from both bands — `planWave`
 *     keeps them close to trivial on purpose, the same exemption `curve` makes.
 *
 * (d) >= 4 SEEDS, AND THE SPREAD IS PRINTED NEXT TO EVERY NUMBER. "A threshold
 *     sitting inside its own metric's run-to-run spread" is this harness's
 *     most-documented failure — `suite`'s first full sweep returned 40/44 and
 *     all four failures were that. The per-wave rows print min..max across
 *     seeds, and the verdict is computed so that it cannot be satisfied by an
 *     effect smaller than that spread (see THE VERDICT below).
 *
 * ------------------------------------------------------------------------
 * THE VERDICT, AND WHY THERE IS NO INVENTED NUMBER IN IT
 * ------------------------------------------------------------------------
 *
 * `interlock`'s header says it: "the failure mode of a made-up threshold is
 * that someone tunes to satisfy it", and MASTER_PLAN §4 freezes thresholds from
 * a measured distribution, never from a guess. So the gate asserts a SHAPE, not
 * a magnitude:
 *
 *   For each seed independently, rise = mean(threat over the LATE band)
 *                                     / mean(threat over the EARLY band),
 *   within one kind of wave (ladder or boss). It is a PAIRED ratio inside one
 *   run, so how strong a build that seed happened to roll cancels out — which
 *   matters, because it is the single largest source of spread here.
 *
 *   RISING   iff mean(rise) - sd(rise) > 1     — the effect clears its own
 *                                                seed-to-seed noise band
 *   FALLING  iff mean(rise) + sd(rise) < 1
 *   FLAT     otherwise — the band straddles 1, i.e. INSIDE THE NOISE
 *
 * That rule has no tunable constant in it, and it is stable in the number of
 * seeds (unanimity, which was the first design, gets strictly harder as reps
 * rise — a gate that fails because you measured it more carefully is a trap).
 *
 * The MAGNITUDE — how much rise G2 should deliver — is deliberately NOT
 * asserted. It is printed, marked PROVISIONAL, and belongs to the §4
 * calibration protocol: run this on the current build, on the post-G2 build,
 * and on the deliberately-bad control, and freeze the floor from that
 * distribution. Anything written here today would be a guess with an exit code.
 *
 * EXPECT THIS TO BE RED BEFORE G2 AND THAT IS THE POINT. MASTER_PLAN's Phase 2
 * exit criterion is "threatdensity green through wave 25". A defect gate that
 * is green on the build containing the defect is decoration.
 *
 * ------------------------------------------------------------------------
 * THE POSITIVE CONTROLS (CONTROL=...)
 * ------------------------------------------------------------------------
 *
 * All three intercept `World.enemyBullets.spawn` — the real pool, on the real
 * instance, so what changes is the bullets that actually exist, not a number in
 * this file. None of them reads source text.
 *
 *   CONTROL=starve   from wave 10, 3 of every 5 enemy bullets are never
 *                    spawned. The late game keeps every body and loses its
 *                    fire. The gate MUST go FALLING. This is the defect G2
 *                    describes, made extreme.
 *   CONTROL=boost    from wave 10, every enemy bullet is spawned twice; from
 *                    wave 18, three times. The gate MUST go RISING. This is the
 *                    control that matters most: a gate stuck at FAIL passes the
 *                    starve control for free.
 *   CONTROL=half     half of ALL enemy bullets, at every wave, are dropped. The
 *                    per-wave threat MUST roughly halve while the verdict is
 *                    unchanged — the instrument is sensitive to fire, and the
 *                    shape statistic is not sensitive to a uniform scale.
 *
 * ------------------------------------------------------------------------
 * DEVIATIONS FROM A PLAYED RUN, STATED SO NOBODY HAS TO FIND THEM
 * ------------------------------------------------------------------------
 *
 *   - The ship is invulnerable, so every wave clears flawless and grazes never
 *     award (`world.ts:2515` requires `invuln <= 0`). Both feed score, so the
 *     level pacing here is not a played run's level pacing.
 *   - Level-ups are answered `choice = 0`, the same policy `arena.mjs` gates on
 *     and for the same reason: swapping the card policy would silently
 *     re-baseline both files at once. `arena.mjs` records that card-0 is
 *     `levelup.mjs`'s RANDOM policy with the dice removed and reaches a fusion
 *     far less often than a builder, so the DPS here is a weak build's DPS.
 *     That is a level, not a shape: it is the same policy at every wave.
 *   - Seconds are counted only while the world advances. Hitstop and the
 *     level-up pause are excluded, so this is arrivals per second of PLAY.
 *   - No audio, no renderer, no frame pacing — see tools/lib/tsnode.mjs. A
 *     green line here says nothing whatever about the music.
 *
 * WHAT IT CANNOT SAY. Whether the late game is FUN, whether the bullets are
 * readable, or whether a human can dodge them. Arrivals per second is a
 * density, and `curve`'s own history is a warning that density and difficulty
 * are not the same word.
 */

import './lib/tsnode.mjs';

const { World } = await import('../src/game/world.ts');
const { BOSS_EVERY, planWave } = await import('../src/game/waves.ts');

const DT = 1 / 120;
const SEEDS = Number(process.env.SEEDS ?? 6);
const MAX_MINUTES = Number(process.env.MINUTES ?? 22);
const LAST_WAVE = Number(process.env.WAVES ?? 25);
const CONTROL = process.env.CONTROL ?? 'none';

/*
 * The probe radii, in pixels.
 *
 * Reported at three, and the verdict runs at the middle one, because the whole
 * point of a "near the player" metric is that the answer must not depend on
 * where you drew the circle. If the three columns ever disagree about the
 * SHAPE, the shape is an artefact of the radius and this tool is lying.
 *
 * 200px is the headline: it comfortably contains the 110px patrol orbit (so the
 * ship is always inside its own probe) and is under half the game's own
 * THREAT_RADIUS of 460, which world.ts calls "deliberately generous" and uses
 * for enemies rather than for fire. None of the three is a threshold — nothing
 * passes or fails on the radius.
 */
const RADII = [120, 200, 300];
const HEADLINE = 1;

/** Patrol geometry. Blind, fixed, seed-independent: it has no policy to vary. */
const PATROL_R = 110;
const PATROL_PERIOD = 2.5;

const isBossWave = (index) => index > 0 && index % BOSS_EVERY === BOSS_EVERY - 1;

function control(index) {
  if (CONTROL === 'starve') return { drop: index >= 9 ? 3 : 0, of: 5, mult: 1 };
  if (CONTROL === 'boost') return { drop: 0, of: 5, mult: index >= 17 ? 3 : index >= 9 ? 2 : 1 };
  if (CONTROL === 'half') return { drop: 1, of: 2, mult: 1 };
  return { drop: 0, of: 5, mult: 1 };
}

function runOnce(seed) {
  const w = new World(seed);
  w.start();

  const CX = w.width / 2;
  const CY = w.height / 2;
  /*
   * The ambient disc: a fixed place the ship never goes, one probe diameter
   * away. It is the control on (a) — aimed fire is aimed at the ship, so this
   * must read well UNDER the probe. If it does not, the probe is measuring
   * arena-wide bullet soup and its name is wrong.
   */
  const AX = CX;
  const AY = CY - 2 * RADII[HEADLINE];

  const per = new Map();
  let live = 0;
  const bucket = () => {
    let a = per.get(live);
    if (!a) {
      a = {
        cross: RADII.map(() => 0),
        born: RADII.map(() => 0),
        ambient: 0,
        secs: 0,
        pop: 0,
        bullets: 0,
        n: 0,
        movement: null,
        boss: isBossWave(live),
      };
      per.set(live, a);
    }
    return a;
  };

  const pool = w.enemyBullets;
  const origSpawn = pool.spawn.bind(pool);
  const origUpdate = pool.update.bind(pool);
  let dropCounter = 0;
  let advanced = false;

  const noteSpawn = (x, y) => {
    const a = bucket();
    const dx = x - CX;
    const dy = y - CY;
    const d2 = dx * dx + dy * dy;
    for (let r = 0; r < RADII.length; r++) if (d2 < RADII[r] * RADII[r]) a.born[r]++;
    const ax = x - AX;
    const ay = y - AY;
    if (ax * ax + ay * ay < RADII[HEADLINE] * RADII[HEADLINE]) a.ambient++;
  };

  /*
   * Spawn interception. The control mutates the world's real bullets; the
   * accounting counts what the pool actually accepted, so an overflowed spawn
   * (`spawn` returns -1 at capacity) is never counted as an arrival.
   */
  pool.spawn = (s) => {
    const c = control(live);
    if (c.drop > 0 && dropCounter++ % c.of < c.drop) return -1;
    let last = -1;
    for (let k = 0; k < c.mult; k++) {
      last = origSpawn(s);
      if (last >= 0) noteSpawn(s.x, s.y);
    }
    return last;
  };

  /*
   * The crossing scan is done INSIDE the pool's own update, immediately after
   * the integration, rather than after `world.update` returns. That is not
   * tidiness: `world.update` returns early during hitstop without touching the
   * pool, and sets `simDt = 0` during the level-up pause while still calling
   * this — so a scan on the outside would re-read the same stale `px/py` pair
   * and count one crossing twice. Scanning here pairs the count 1:1 with the
   * integrations that can actually produce one.
   */
  pool.update = (dt, ...rest) => {
    origUpdate(dt, ...rest);
    if (dt <= 0) return;
    advanced = true;
    const a = bucket();
    for (let i = 0; i < pool.count; i++) {
      const nx = pool.x[i] - CX;
      const ny = pool.y[i] - CY;
      const ox = pool.px[i] - CX;
      const oy = pool.py[i] - CY;
      const dn = nx * nx + ny * ny;
      const dp = ox * ox + oy * oy;
      for (let r = 0; r < RADII.length; r++) {
        const rr = RADII[r] * RADII[r];
        if (dn < rr && dp >= rr) a.cross[r]++;
      }
      const anx = pool.x[i] - AX;
      const any = pool.y[i] - AY;
      const aox = pool.px[i] - AX;
      const aoy = pool.py[i] - AY;
      const arr = RADII[HEADLINE] * RADII[HEADLINE];
      if (anx * anx + any * any < arr && aox * aox + aoy * aoy >= arr) a.ambient++;
    }
  };

  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

  let maxCamp = 0;
  let hits = 0;
  let maxOffOrbit = 0;
  let overflow = 0;
  w.bus.on('player:hit', () => hits++);

  const steps = Math.round((MAX_MINUTES * 60) / DT);
  let reached = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    live = w.waveIndex;
    const a = bucket();
    a.movement = w.snapshot.movement;

    // Blind patrol: chase a waypoint on a fixed circle. It never reads a bullet.
    const th = (t / PATROL_PERIOD) * Math.PI * 2;
    const wx = CX + PATROL_R * Math.cos(th);
    const wy = CY + PATROL_R * Math.sin(th);
    const dx = wx - w.player.x;
    const dy = wy - w.player.y;
    const d = Math.hypot(dx, dy) || 1;
    inp.x = dx / d;
    inp.y = dy / d;
    inp.choice = w.choosing ? 0 : -1;
    // The sensor, not the player. See (a)(2) in the header.
    w.player.invuln = 9;

    advanced = false;
    w.update(DT, inp);

    if (advanced) {
      a.secs += DT;
      a.pop += w.enemies.length;
      a.bullets += w.enemyBullets.count;
      a.n++;
    }
    if (w.snapshot.campPressure > maxCamp) maxCamp = w.snapshot.campPressure;
    maxOffOrbit = Math.max(maxOffOrbit, Math.hypot(w.player.x - CX, w.player.y - CY));
    overflow = pool.overflow;
    reached = w.waveIndex;
    if (w.isOver) break;
    if (w.waveIndex > LAST_WAVE) break;
  }

  // The wave that was live when the loop stopped never finished, so its
  // integral covers only however much of it happened to fit. Same reason
  // `curve` pops its last row.
  per.delete(reached);
  return { per, maxCamp, hits, maxOffOrbit, overflow, reached: reached + 1, died: w.isOver, level: w.progression.level };
}

/* ---------------------------------------------------------------- stats */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
};
const f1 = (x) => x.toFixed(1);
const f2 = (x) => x.toFixed(2);

console.log(`\nTHREATDENSITY — bullet arrivals per second near the player, per wave`);
console.log(`  probe    fixed disc r=${RADII[HEADLINE]}px at the arena centre; also reported at ${RADII.filter((_, i) => i !== HEADLINE).join(' and ')}px`);
console.log(`  ship     blind ${PATROL_R}px patrol, period ${PATROL_PERIOD}s, invulnerable sensor, card-0 level-ups`);
console.log(`  runs     ${SEEDS} seeds x up to ${MAX_MINUTES} simulated minutes, one continuous run each, whole-wave integration`);
if (CONTROL !== 'none') console.log(`  CONTROL  ${CONTROL.toUpperCase()} — enemy fire is deliberately mutated; see the header`);

const t0 = Date.now();
const runs = [];
for (let s = 0; s < SEEDS; s++) runs.push(runOnce(0x51ed + s * 7919));
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s of wall clock\n`);

/* ------------------------------------------------------- the run controls */

console.log('CONTROLS ON THE MEASUREMENT ITSELF');
let broken = 0;
const ctl = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'BAD '}  ${label.padEnd(34)} ${detail}`);
  if (!ok) broken++;
};
const maxCamp = Math.max(...runs.map((r) => r.maxCamp));
ctl(maxCamp < 0.01, 'camp pressure stayed at zero', `max ${f2(maxCamp)} (a parked probe would earn 1.5x bullet speed)`);
const hits = runs.reduce((a, r) => a + r.hits, 0);
ctl(hits === 0, 'the sensor was never hit', `${hits} hits (a hit clears the WHOLE bullet pool)`);
const off = Math.max(...runs.map((r) => r.maxOffOrbit));
ctl(off < RADII[HEADLINE], 'the ship stayed inside its probe', `max ${f1(off)}px from centre, probe r=${RADII[HEADLINE]}`);
const overflow = runs.reduce((a, r) => a + r.overflow, 0);
ctl(overflow === 0, 'the bullet pool never saturated', `${overflow} spawns refused (a full pool would cap threat)`);
const deaths = runs.filter((r) => r.died).length;
ctl(deaths === 0, 'no run ended early', `${deaths}/${runs.length} died`);
const reached = runs.map((r) => r.reached);
ctl(Math.min(...reached) > LAST_WAVE, `every run reached wave ${LAST_WAVE}`, `reached ${reached.join(' ')}`);

/* --------------------------------------------------------- the wave table */

const waves = [];
for (let i = 0; i <= LAST_WAVE + 2; i++) {
  const cells = runs.map((r) => r.per.get(i)).filter((a) => a && a.secs > 3);
  if (cells.length < runs.length) continue;
  const threat = (r) => cells.map((a) => (a.cross[r] + a.born[r]) / a.secs);
  const row = {
    wave: i + 1,
    boss: isBossWave(i),
    movement: cells[0].movement,
    secs: mean(cells.map((a) => a.secs)),
    pop: mean(cells.map((a) => a.pop / a.n)),
    standing: mean(cells.map((a) => a.bullets / a.n)),
    ambient: mean(cells.map((a) => a.ambient / a.secs)),
    per: RADII.map((_, r) => threat(r)),
  };
  row.threat = mean(row.per[HEADLINE]);
  row.lo = Math.min(...row.per[HEADLINE]);
  row.hi = Math.max(...row.per[HEADLINE]);
  waves.push(row);
}

if (waves.length < 8) {
  console.log(`\nonly ${waves.length} complete waves observed — nothing can be said`);
  process.exit(1);
}

const seen = waves.filter((r) => r.wave > 3 && r.threat > 0).length;
const graded = waves.filter((r) => r.wave > 3).length;
ctl(seen >= graded - 2, 'the probe sees fire at nearly every wave', `${seen}/${graded} graded waves non-zero (HUSHED waves are meant to be ~0)`);
const ambientShare = mean(waves.map((r) => (r.threat > 0 ? r.ambient / r.threat : 0)));
ctl(ambientShare < 0.6, 'the AMBIENT disc reads well under the probe', `${f2(ambientShare)}x — if this were ~1 the probe would not be about the player`);

console.log('\nPER WAVE — one continuous run per seed, every wave integrated over its whole life');
console.log(`  threat = bullet arrivals/s into the r=${RADII[HEADLINE]} probe.  pop = mean enemies alive.  t/body = threat per enemy.`);
console.log('  wave  kind            secs    pop   threat/s   min..max across seeds   t/body   r120   r300');
for (const r of waves) {
  const kind = r.boss ? 'BOSS' : (r.movement ? r.movement.toUpperCase().padEnd(5) : '').padEnd(5);
  console.log(
    `  ${String(r.wave).padStart(4)}  ${kind.padEnd(14)} ${f1(r.secs).padStart(5)}  ${f1(r.pop).padStart(5)}   ` +
      `${f2(r.threat).padStart(8)}   ${(`${f1(r.lo)}..${f1(r.hi)}`).padStart(21)}   ` +
      `${f2(r.pop > 0.05 ? r.threat / r.pop : 0).padStart(6)}   ${f1(mean(r.per[0])).padStart(4)}   ${f1(mean(r.per[2])).padStart(4)}`,
  );
}

/* ------------------------------------------------------------- the bands */

/*
 * Waves 1-3 are exempt (the deliberate on-ramp, same exemption `curve` makes).
 * The split is at wave 9 because that is the wave MASTER_PLAN G2 names: the
 * full archetype roster is in play by then, so waves 4-9 are the band where
 * novelty is still arriving and 10+ is the band where, per the complaint, only
 * quantity does.
 */
const EARLY = (w) => w.wave >= 4 && w.wave <= 9;
const LATE = (w) => w.wave >= 10 && w.wave <= LAST_WAVE;

function band(kind, pick, ordinaryOnly = false) {
  const sel = waves.filter((r) => r.boss === kind && (!ordinaryOnly || !r.movement));
  const early = sel.filter(EARLY);
  const late = sel.filter(LATE);
  if (!early.length || !late.length) return null;
  const rises = runs.map((_, s) => {
    const e = mean(early.map((r) => pick(r, s)));
    const l = mean(late.map((r) => pick(r, s)));
    return e > 0 ? l / e : NaN;
  }).filter((x) => Number.isFinite(x));
  return {
    earlyWaves: early.map((r) => r.wave),
    lateWaves: late.map((r) => r.wave),
    series: sel.filter((r) => EARLY(r) || LATE(r)).map((r) => ({ wave: r.wave, threat: mean(r.per[HEADLINE]) })),
    early: mean(early.map((r) => mean(r.per[HEADLINE]))),
    late: mean(late.map((r) => mean(r.per[HEADLINE]))),
    rises,
    m: mean(rises),
    s: sd(rises),
  };
}

const threatOf = (r, s) => r.per[HEADLINE][s];
// Population has no per-seed breakdown stored, so its rise is computed on the
// wave means. It is a diagnostic, not a gate — the gate is threat.
const popRise = (kind) => {
  const sel = waves.filter((r) => r.boss === kind);
  const e = mean(sel.filter(EARLY).map((r) => r.pop));
  const l = mean(sel.filter(LATE).map((r) => r.pop));
  return e > 0 ? l / e : NaN;
};

function verdict(b) {
  if (!b) return 'NO DATA';
  if (b.m - b.s > 1) return 'RISING';
  if (b.m + b.s < 1) return 'FALLING';
  return 'FLAT';
}

const ladder = band(false, threatOf);
const ladderOrdinary = band(false, threatOf, true);
const boss = band(true, threatOf);

function report(label, b, pr) {
  console.log(`\n${label}`);
  if (!b) {
    console.log('  not enough waves of this kind to compare');
    return;
  }
  console.log(`  early band   waves ${b.earlyWaves.join(',')}   mean threat ${f2(b.early)}/s`);
  console.log(`  late band    waves ${b.lateWaves.join(',')}   mean threat ${f2(b.late)}/s`);
  /*
   * The series, wave by wave, printed rather than summarised. Two band means
   * cannot show a PERIOD, and on this build the boss row is periodic — read the
   * series before believing any single ratio computed from it.
   */
  console.log(`  series       ${b.series.map((x) => `w${x.wave} ${f1(x.threat)}`).join('   ')}`);
  console.log(`  rise per seed  [${b.rises.map((x) => f2(x)).join('  ')}]`);
  console.log(`  rise           mean ${f2(b.m)}   sd ${f2(b.s)}   band ${f2(b.m - b.s)}..${f2(b.m + b.s)}`);
  if (Number.isFinite(pr)) {
    console.log(`  population rise ${f2(pr)}x over the same bands`);
    console.log(`  ESCALATION RATIO (threat rise / population rise) ${f2(b.m / pr)}` +
      `   — under 1.0 is "bodies, not bullets"`);
  }
  console.log(`  => ${verdict(b)}`);
}

report('LADDER WAVES (non-boss; compared only to non-boss)', ladder, popRise(false));
if (ladderOrdinary) {
  console.log(`  robustness: excluding the named movement waves entirely, rise mean ${f2(ladderOrdinary.m)} sd ${f2(ladderOrdinary.s)} => ${verdict(ladderOrdinary)}`);
}
report('BOSS WAVES (compared only to boss waves)', boss, popRise(true));

/*
 * The population budget MASTER_PLAN G2 says the gate should read does not
 * exist yet, so this prints what the plan's WavePlan actually declares and
 * says so, rather than re-deriving `World.targetOnScreen` — which is private,
 * and "a tool that hardcodes a value the program defines will lie the day that
 * value moves" (tools/README.md, the `contrast` incident).
 */
console.log('\nTHE DECLARED POPULATION BUDGET');
console.log('  G2 asks for "a declared constant (flat past wave 13) that the gate reads". There is');
console.log('  no such export today — the budget is the private expression World.targetOnScreen.');
console.log('  What planWave does declare, for the record:');
console.log('    wave   difficulty  escalation   measured pop');
for (const r of waves.filter((x) => [4, 9, 13, 17, 21, 25].includes(x.wave))) {
  const p = planWave(r.wave - 1);
  console.log(`    ${String(r.wave).padStart(4)}   ${f2(p.difficulty).padStart(10)}  ${f2(p.escalation).padStart(10)}   ${f1(r.pop).padStart(12)}`);
}

/* ------------------------------------------------------------- provisional */

/*
 * The one place a threshold would go, left empty on purpose.
 *
 * MASTER_PLAN §4 freezes thresholds from a measured distribution: this build,
 * reference points, and a deliberately bad control, with repeats to measure the
 * spread. Two of those three exist today (this build, and CONTROL=starve), and
 * the post-G2 build — the one a floor would actually be defending — does not.
 * So this prints the distribution and NOTHING READS IT. The verdict above is a
 * shape test with no magnitude in it, and no exit code depends on a number
 * chosen here. "The failure mode of a made-up threshold is that someone tunes
 * to satisfy it" (tools/interlock.mjs).
 */
console.log('\nWHAT A MAGNITUDE FLOOR WOULD BE FROZEN FROM (printed, NOT asserted — MASTER_PLAN §4)');
const dist = (label, b) => {
  if (!b) return;
  console.log(
    `  ${label.padEnd(7)} rise   min ${f2(Math.min(...b.rises))}   mean ${f2(b.m)}   max ${f2(Math.max(...b.rises))}   sd ${f2(b.s)}   (n=${b.rises.length} seeds)`,
  );
};
dist('ladder', ladder);
dist('boss', boss);
console.log('  PROVISIONAL: no floor is set. Freeze one only once this meter has been run on the');
console.log('  post-G2 build as well, and only from the distribution those runs produce.');
console.log('  Reference points measured on this build: CONTROL=starve reads ladder rise ~1.37,');
console.log('  boss ~0.40; CONTROL=boost reads ladder ~9.60, boss ~2.65.');

/* ---------------------------------------------------------------- verdict */

console.log('\nVERDICT');
const vL = verdict(ladder);
const vB = verdict(boss);
console.log(`  LADDER THREAT ${vL}${vL === 'FLAT' ? '  (the rise band straddles 1 — inside the seed spread)' : ''}`);
console.log(`  BOSS   THREAT ${vB}${vB === 'FLAT' ? '  (the rise band straddles 1 — inside the seed spread)' : ''}`);
if (broken) console.log(`  ${broken} MEASUREMENT CONTROL(S) BAD — the numbers above are not trustworthy`);

const pass = vL === 'RISING' && vB === 'RISING' && broken === 0;
console.log(pass
  ? '\nTHREAT ESCALATES PAST WAVE 9\n'
  : '\nTHREAT DOES NOT ESCALATE PAST WAVE 9 — G2 is not done\n');
process.exit(pass ? 0 : 1);
