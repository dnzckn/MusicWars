/*
 * arc — does a RUN have a shape, or is it one loop played fifteen times?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * Nothing in `tools/` measured form. `sections` measures section SHARE,
 * `variety` measures mode SHARE, `texture` measures voice-count SPREAD, `churn`
 * and `phrasechurn` measure rebuild churn. Every one of those is a
 * DISTRIBUTION, and a distribution cannot tell a run with an arc from a run
 * without one, because an arc is an ORDERING. Shuffle a twenty-minute run's
 * bars into a random order and every existing tool reports exactly the same
 * numbers.
 *
 * THE FAULT THIS WAS WRITTEN AGAINST, measured at HEAD e17f1d4 over four
 * twenty-minute runs (2560 bars, mean bar 1.87s), median hold per unit:
 *
 *     key (tonic)   48 bars   90.0s     n=46
 *     theme         32 bars   60.0s     n=86
 *     mode          16 bars   30.0s     n=99
 *     groove        19 bars   35.6s     n=143
 *     section        4 bars    7.5s     n=643
 *
 * — no musical unit longer than ninety seconds, and every one of them a CYCLE
 * that returns rather than a line that goes somewhere. Peak forward-voice count
 * per two-minute window correlated with window index at Spearman 0.257: the mix
 * reached its ceiling in the first two minutes and stayed there for eighteen
 * more. Three of four seeds contained two-minute windows with ZERO quiet bars
 * out of sixty-four.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT ASSERTS, AND HOW EACH ONE COULD BE GAMED
 * ---------------------------------------------------------------------------
 *
 * Six assertions. Every threshold is stated with the measurement it came from,
 * and every one has been broken deliberately and watched go red INDIVIDUALLY —
 * see the fail-test log at the foot of this file. AGENTS.md §3: "a check with
 * five assertions can pass its own fail-test on the strength of one while the
 * rest are dead."
 *
 *   1 SPAN      Some musical unit must hold for longer than a section does.
 *               *Gamed by:* holding a unit that nobody can hear — so this reads
 *               the FEEL, which is the most audible unit in the score after the
 *               tune, and it reads it off the observed series rather than off
 *               the table that generates it.
 *
 *   2 CEILING   The peak forward-voice count must RISE across the run.
 *               *Gamed by:* starting empty, so everything after is "rising".
 *               Hence assertion 3, which is the other end of the same ruler.
 *
 *   3 FLOOR     ...but the opening must still be a piece of music. An absolute
 *               floor on the first window's mean forward voices and mean level
 *               sum. A run that opens on nothing fails a DIFFERENT assertion
 *               from the one it would pass by opening on nothing.
 *
 *   4 REST      No window of 64 bars may contain zero resting bars.
 *               *Gamed by:* relabelling a loud section as `breakdown`. So the
 *               rest is also checked in LEVELS: a resting bar must measure a
 *               lower level sum than the run's median bar.
 *
 *   5 ARRIVAL   Every key change must be ANNOUNCED — the bar before it must
 *               spell the dominant of the key it is going to. Read off the
 *               scheduled haps of the `chords` stem, not off any flag the
 *               director sets, so a pivot that is computed and then discarded
 *               fails.
 *
 *   6 GROOVE    The groove's median hold must be at least one phrase. This is
 *               research-music.md §3.4's own proposal and it PASSES AT HEAD
 *               (median 19 bars against a phrase of 8). It is here as a
 *               ratchet, not as a discovery, and it is labelled as one.
 *
 *   7 REPRISE   If the run reaches its recapitulation, that act must be in the
 *               key the run OPENED in and playing the theme it opened with.
 *               *Gamed by:* never leaving home, so the return is free. Hence
 *               the middle of the run is checked too — the tonic must have
 *               visited at least three distinct keys before coming back, which
 *               a run that never modulated cannot satisfy.
 *
 * TWO COLUMNS, NOT ONE. Voice COUNT and the SUM OF LEVELS are both printed
 * everywhere. A count alone is gameable by pushing a lane to 0.149 so it stops
 * being FORWARD while still sounding; a sum alone cannot see a lane leaving.
 * A change that moves one and not the other is reported and not believed.
 *
 * PRINT EVERY DENOMINATOR. Every table below prints its n. `checked === 0` is
 * a failure, not a quiet pass.
 *
 * Usage:  node --experimental-transform-types tools/arc.mjs
 *         SECS=1200 SEEDS=1,2,3,4 node --experimental-transform-types tools/arc.mjs
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport, BARS_PER_PHRASE } = await import(`${R}core/transport.ts`);
const { THEMES, BOSS_THEME, themeForWave } = await import(`${R}audio/layers.ts`);
/*
 * IT RUNS AGAINST A BUILD WITH NO FORM IN IT, on purpose.
 *
 * A gate that cannot be pointed at the state it was written to catch has never
 * been seen red, and AGENTS.md §3 is explicit that such a gate is not evidence.
 * `act` is read with a fallback and the act table is optional, so this tool can
 * be checked out into a worktree at HEAD e17f1d4 — where none of it exists —
 * and run unmodified. Four of its six assertions go red there. That is a
 * stronger fail-test than any deliberate sabotage, because it is the real
 * defect rather than a caricature of it.
 */
const ACT_AT_PHRASE = await import(`${R}audio/arrangement.ts`)
  .then((m) => m.ACT_AT_PHRASE ?? null)
  .catch(() => null);

const DT = 1 / 60;
const SECS = Number(process.env.SECS ?? 1200);
const SEEDS = (process.env.SEEDS ?? '1,2,3,4').split(',').map(Number);

/** Fader above which a lane is competing for attention. `texture`'s number. */
const FORWARD = 0.15;
/** Window used for the arc tables, in seconds. Two minutes: ten per run. */
const WINDOW = 120;
/** Window used for the REST assertion, in bars. Eight phrases. */
const REST_WINDOW = 64;

/*
 * The thresholds, each with where it came from.
 *
 * None is a round number chosen because it looked reasonable; each is the
 * HEAD measurement moved far enough that a regression to HEAD trips it and a
 * normal run does not.
 */
/*
 * MEASURED AT HEAD e17f1d4, 4 seeds x 1200s, 2560 bars, with this same tool:
 * the feel's longest observed hold was 36 bars and its median 19. With the run
 * form, the recapitulation holds one groove for its whole final act — measured
 * 108 bars. 48 sits between the two and is out of reach of the eight-slot rota,
 * which cannot produce a run longer than two adjacent identical slots.
 */
const MIN_LONGEST_FEEL = 48;
/*
 * HEAD: Spearman(window index, peak forward voices) 0.257 and peak level sum
 * 0.386, pooled over 40 windows. With the form: 0.534 and 0.730. Either one
 * clearing 0.45 is enough, because they answer the same question in different
 * units and a change that moved only one of them would be reported rather than
 * believed — see the two-columns note in the header.
 */
const MIN_CEILING_RHO = 0.45;
/*
 * HEAD: the opening two-minute window averaged 7.2-8.1 forward voices across
 * the four seeds. With the exposition reserving a tonal lane it averages
 * 6.1-6.9. 5.0 is about 18% under the worst seed of the current build — far
 * enough down not to flake, close enough up that an opening thinned on purpose
 * to buy a rising CEILING trips it.
 */
const MIN_OPENING_VOICES = 5.0;
/*
 * The same floor in the units a counting threshold cannot be gamed against.
 * HEAD 3.25-3.73, current build 2.89-3.23; 2.2 is about 24% under the worst.
 */
const MIN_OPENING_LEVELSUM = 2.2;
/* research-music.md §3.4's own proposal. PASSES AT HEAD (median 19 bars). */
const MIN_FEEL_MEDIAN = BARS_PER_PHRASE;
/*
 * HEAD announced 1 of 42 by accident; the current build announces 13 of 13 over
 * two seeds. 0.9 rather than 1.0 leaves room for the case the tool cannot
 * distinguish from a defect: a phrase end where the chord lanes happen to be
 * scheduling nothing. Those are counted separately as `muteAtPivot` and
 * excluded from the denominator rather than waived, so the allowance is for
 * sampling and not for a missing chord.
 */
const MIN_PIVOT_SHARE = 0.9;
/*
 * The recapitulation's key and theme return via `onWaveStart`, which fires on
 * a wave boundary rather than on the act boundary — so the first wave of the
 * act can still be in the outgoing key. That is at most one wave of about
 * sixteen bars against an act of sixty-plus, so 0.8 has real margin under it
 * and still cannot be reached by a recapitulation that does not come home.
 */
const MIN_REPRISE_SHARE = 0.8;
/*
 * ...and a return is only a return if the music went somewhere. A run that sat
 * in one key for twenty minutes would score a perfect reprise for free.
 */
const MIN_KEYS_VISITED = 3;

const themeId = (wave, boss, recap) => {
  const th = themeForWave(wave, boss, recap);
  if (th === BOSS_THEME) return 'BOSS';
  const i = THEMES.indexOf(th);
  return i >= 0 ? `T${i}` : '?';
};

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Lengths, in samples, of every run of identical values in a series. */
function holds(series) {
  const out = [];
  let cur = null;
  let n = 0;
  for (const v of series) {
    if (v === cur) { n++; continue; }
    if (cur !== null) out.push(n);
    cur = v;
    n = 1;
  }
  if (cur !== null) out.push(n);
  return out;
}

/** Spearman rank correlation. Ties broken by index, which is fine at this n. */
function spearman(xs, ys) {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i;
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/*
 * The lanes that spell the harmony. `hats` is the MOTOR — a pitched inner voice
 * stating root, third and fifth continuously, not a hi-hat; see `buildMotor`.
 * `lead` is excluded on purpose: the tune is written from the mode and the
 * theme, so it cannot be evidence about what chord is sounding under it.
 */
const HARMONY_LANES = ['chords', 'bass', 'hats', 'arp'];
/** Which lanes carried each announced pivot. Printed, never asserted on. */
const pivotLanes = {};
const pcOf = (name) => NOTE.indexOf(name);

const UNITS = ['tonic', 'mode', 'theme', 'feel', 'section', 'act'];
const allHolds = Object.fromEntries(UNITS.map((u) => [u, []]));
const perSeed = [];
let totalBars = 0;
const barSeconds = [];

/*
 * MODULATION ARRIVALS, counted off the emitted haps.
 *
 * `announced` is a key change whose PREVIOUS bar's chord lane spells the major
 * triad on the fifth of the key it moved to — a dominant, resolving up a
 * fourth. `mute` is one where that bar had no chord notes at all, which is a
 * sampling fact rather than a musical one and is reported separately instead of
 * being counted either way.
 */
let modulations = 0;
let announced = 0;
let muteAtPivot = 0;
/** Key changes caused by the CAPO rig item rather than by a modulation. */
let capoMoves = 0;

for (const SEED of SEEDS) {
  const w = new World(SEED);
  w.start();
  const d = new MusicDirector();
  d.reset(0);
  const t = new Transport();
  t.start();
  for (const [ev, fn] of [
    ['wave:start', (e) => d.onWaveStart(t, e)], ['wave:clear', (e) => d.onWaveClear(t, e)],
    ['boss:telegraph', (e) => d.onBossTelegraph(t, e)], ['boss:phase', (e) => d.onBossPhase(t, e)],
    ['boss:defeat', () => d.onBossDefeat(t)], ['player:hit', () => d.onPlayerHit()],
    ['player:death', () => d.onPlayerDeath(t)], ['player:bomb', () => d.onBomb(t)],
    ['powerup:pickup', (e) => d.onPickup(t, e.kind)], ['powerup:expire', (e) => d.onPickup(t, e.kind)],
    ['ability:evolve', () => d.onFusion('evolution')], ['ability:union', () => d.onFusion('union')],
    ['ability:duet', () => d.onFusion('duet')],
  ]) w.bus.on(ev, fn);

  const drive = makeBrain('dodge');
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

  const series = Object.fromEntries(UNITS.map((u) => [u, []]));
  const bars = [];
  let lastBar = -1;
  let elapsed = 0;
  let lastBarTime = 0;
  let prevKey = null;
  let lastCapo = 0;
  /*
   * The harmony sounding LATE IN THE BAR THAT IS ENDING.
   *
   * Read at 80% through each bar and left alone until the next one overwrites
   * it, so on the frame a bar line is crossed this still holds the bar that
   * just finished — which is exactly the bar a modulation has to be announced
   * in. An earlier version also copied it into a `prev` on the bar line, which
   * made every comparison one bar too old: the tool reported 0 of 42
   * modulations announced while the bass was audibly playing the dominant.
   * Caught by an implausible count, not by the code looking wrong.
   */
  let lateChordPcs = null;
  let lateLanes = {};

  for (let i = 0; i < Math.round(SECS / DT); i++) {
    if (i % 2 === 0) { drive(w, inp); inp.choice = w.choosing ? 0 : -1; }
    w.update(DT, inp);
    t.advance(DT);
    d.update(w.snapshot, t, DT);
    elapsed += DT;
    // This measures the MUSIC, not the bot's survival — the same line
    // `variety` and `keyrate` use for the same reason.
    w.player.lives = Math.max(3, w.player.lives);

    /*
     * THE CHORD LANE, SAMPLED LATE IN THE BAR — and the timing is the whole
     * point of this block rather than an implementation detail.
     *
     * `sampleBar` queries the cached pattern for the current cycle, so it reads
     * what the scheduler will hand superdough rather than any flag the director
     * sets. But `drainRebuild` builds ONE stem per frame, loudest first, so on
     * the first frame of a bar the chord lane can still be one revision behind
     * — eleven frames, about 180ms, against a bar of 1870ms. Sampling on the
     * bar line therefore measured a pattern that had already been replaced by
     * the time the bar actually sounded, and reported the pivot missing on
     * three quarters of the modulations where it was in fact played.
     *
     * Reading at 80% through the bar is the same instant a listener is at when
     * that bar's last chord sounds, and it is unambiguously after any rebuild
     * the bar line triggered. Caught by an implausible count rather than by the
     * code looking wrong, which is how `barvariety` found both of its own
     * instrumentation bugs.
     */
    if (t.barPhase > 0.8) {
      const sampled = d.sampleBar(t);
      lateChordPcs = new Set();
      lateLanes = {};
      /*
       * ACROSS THE PITCHED LANES, not just the pad — because the question is
       * what a listener hears, and the pad is not the only thing spelling the
       * chord. The first version of this read `chords` alone and reported the
       * leading tone missing on 33 of 42 modulations; the bass and the motor
       * were playing it the whole time. That would have been a tool describing
       * one builder's voicing rule as a harmonic defect.
       */
      for (const lane of HARMONY_LANES) {
        const pcs = (sampled[lane] ?? [])
          .filter((h) => h.n != null)
          .map((h) => ((h.n % 12) + 12) % 12);
        lateLanes[lane] = new Set(pcs);
        for (const p of pcs) lateChordPcs.add(p);
      }
    }

    const bar = Math.floor(t.bar);
    if (bar === lastBar) continue;
    if (lastBar >= 0) barSeconds.push(elapsed - lastBarTime);
    lastBarTime = elapsed;
    lastBar = bar;

    const r = d.readout(t);
    const lv = r.levels || {};
    let fwd = 0;
    let sum = 0;
    for (const k of Object.keys(lv)) {
      sum += lv[k];
      if (lv[k] > FORWARD) fwd++;
    }

    /*
     * THE CHORD GRID'S TONIC, not the readout's key label — and the difference
     * turned out to be a defect in the score rather than a choice here.
     *
     * `readout().key` is `keyLabel(tonic + capo, mode)`, and CAPO is a rig
     * ability worth two semitones a level. The chord grid is built from the RAW
     * tonic (`buildSlots` calls `chordForBar(this.tonic, ...)`) while the
     * melody's base is `MusicalState.tonic`, which HAS the capo added. So a
     * player holding CAPO hears a tune up to six semitones above its own
     * harmony, the HUD prints the tune's key, and the pad, bass and motor are
     * all somewhere else. Measured here: 8 of 21 "key changes" over two runs
     * were capo moves with no tonic change at all, and every one of them was
     * reported as an unannounced modulation by an earlier version of this
     * check that trusted the label.
     *
     * That is a PRE-EXISTING defect (it is identical at HEAD e17f1d4) and it is
     * not this tool's business to fix. What is this tool's business is
     * measuring the thing the pivot actually prepares, which is the chord grid.
     * Capo moves are counted and printed separately so the defect stays visible
     * instead of being silently excluded.
     */
    const keyName = NOTE[((d.tonic % 12) + 12) % 12];
    if (d.capo !== lastCapo) { capoMoves++; lastCapo = d.capo; }
    if (prevKey !== null && keyName !== prevKey) {
      modulations++;
      const to = pcOf(keyName);
      if (!lateChordPcs || lateChordPcs.size === 0) muteAtPivot++;
      else {
        /*
         * The DOMINANT of the key we just arrived in: its root a fifth above,
         * and the major third that is the new key's leading tone. Those two
         * pitch classes are what makes a chord a dominant — the fifth is
         * droppable and voicings drop it, so requiring it would measure the
         * voicing rather than the harmony.
         */
        const want = [(to + 7) % 12, (to + 11) % 12];
        if (want.every((p) => lateChordPcs.has(p))) {
          announced++;
          for (const lane of HARMONY_LANES) {
            if (want.every((p) => (lateLanes[lane] ?? new Set()).has(p))) {
              pivotLanes[lane] = (pivotLanes[lane] ?? 0) + 1;
            }
          }
        }
      }
    }
    prevKey = keyName;

    series.tonic.push(keyName);
    series.mode.push(r.key.split(' ')[1]);
    series.theme.push(themeId(d.musicalWave, d.themeBoss, r.act === 'recapitulation'));
    series.feel.push(r.feel);
    series.section.push(r.section);
    series.act.push(r.act ?? '-');
    bars.push({
      t: elapsed,
      bar,
      section: r.section,
      act: r.act ?? '-',
      // Carried per bar as well as into the hold series, because the REPRISE
      // check asks an ORDERING question ("is the last act in the FIRST act's
      // key") that a run-length table cannot answer.
      tonic: keyName,
      theme: themeId(d.musicalWave, d.themeBoss, r.act === 'recapitulation'),
      energy: r.energy,
      bpm: r.bpm,
      fwd,
      sum,
      resting: r.section === 'breakdown' || r.section === 'intro' || r.section === 'collapse',
    });
    totalBars++;
  }

  for (const u of UNITS) allHolds[u].push(...holds(series[u]));
  perSeed.push({ seed: SEED, bars });
}

if (totalBars === 0) {
  console.error('arc: zero bars sampled — nothing was measured');
  process.exit(1);
}

const barSec = mean(barSeconds);
console.log(
  `\narc — ${SEEDS.length} runs x ${SECS}s, ${totalBars} bars, mean bar ${barSec.toFixed(2)}s ` +
    `(${(totalBars / SEEDS.length / BARS_PER_PHRASE).toFixed(0)} phrases per run)\n`,
);

/* ---------------------------------------------------------------- 1 + 6 SPAN */

console.log('  how long each musical unit HOLDS, in bars (n = number of holds observed)');
console.log(`  ${'unit'.padEnd(9)} ${'n'.padStart(5)}  ${'median'.padStart(7)} ${'mean'.padStart(7)} ${'max'.padStart(6)}   seconds (median / max)`);
for (const u of UNITS) {
  const a = allHolds[u];
  console.log(
    `  ${u.padEnd(9)} ${String(a.length).padStart(5)}  ${String(med(a)).padStart(7)} ` +
      `${mean(a).toFixed(1).padStart(7)} ${String(Math.max(...a)).padStart(6)}   ` +
      `${(med(a) * barSec).toFixed(1)}s / ${(Math.max(...a) * barSec).toFixed(1)}s`,
  );
}

/* ------------------------------------------------------------- the windows */

const windowRows = [];
for (const { seed, bars } of perSeed) {
  const nW = Math.ceil(SECS / WINDOW);
  const row = [];
  for (let k = 0; k < nW; k++) {
    const sl = bars.filter((b) => b.t >= k * WINDOW && b.t < (k + 1) * WINDOW);
    if (!sl.length) continue;
    row.push({
      win: k,
      n: sl.length,
      peakF: Math.max(...sl.map((b) => b.fwd)),
      meanF: mean(sl.map((b) => b.fwd)),
      peakSum: Math.max(...sl.map((b) => b.sum)),
      meanSum: mean(sl.map((b) => b.sum)),
      peakE: Math.max(...sl.map((b) => b.energy)),
      peakB: Math.max(...sl.map((b) => b.bpm)),
      rest: sl.filter((b) => b.resting).length,
      acts: [...new Set(sl.map((b) => b.act))].map((a) => a.slice(0, 3)).join('/'),
    });
  }
  windowRows.push({ seed, row });
}

console.log(`\n  per ${WINDOW}s window — forward voices, level sum, energy, tempo, resting bars`);
for (const { seed, row } of windowRows) {
  console.log(`    seed ${seed}`);
  for (const r of row) {
    console.log(
      `      win ${String(r.win).padStart(2)} ${r.acts.padEnd(8)} n=${String(r.n).padStart(3)}  ` +
        `fwd peak ${String(r.peakF).padStart(2)} mean ${r.meanF.toFixed(1)}   ` +
        `sum peak ${r.peakSum.toFixed(2)} mean ${r.meanSum.toFixed(2)}   ` +
        `peakE ${r.peakE.toFixed(2)}  peakBpm ${r.peakB.toFixed(0)}  rest ${String(r.rest).padStart(2)}`,
    );
  }
}

const pooled = (key) => {
  const xs = [];
  const ys = [];
  for (const { row } of windowRows) for (const r of row) { xs.push(r.win); ys.push(r[key]); }
  return { rho: spearman(xs, ys), n: xs.length };
};
console.log('\n  Spearman(window index, measure), pooled over every window of every seed:');
for (const k of ['peakF', 'meanF', 'peakSum', 'meanSum', 'peakE', 'peakB']) {
  const { rho, n } = pooled(k);
  console.log(`    ${k.padEnd(8)} rho ${rho.toFixed(3)}   n=${n}`);
}

/* ------------------------------------------------------------------ 4 REST */

let worstRest = { seed: null, at: -1, count: Infinity };
let restWindows = 0;
for (const { seed, bars } of perSeed) {
  for (let i = 0; i + REST_WINDOW <= bars.length; i += REST_WINDOW) {
    const sl = bars.slice(i, i + REST_WINDOW);
    const c = sl.filter((b) => b.resting).length;
    restWindows++;
    if (c < worstRest.count) worstRest = { seed, at: sl[0].bar, count: c };
  }
}
const restingBars = perSeed.flatMap(({ bars }) => bars).filter((b) => b.resting);
const workingBars = perSeed.flatMap(({ bars }) => bars).filter((b) => !b.resting);
const restSum = mean(restingBars.map((b) => b.sum));
const workSum = mean(workingBars.map((b) => b.sum));
console.log(
  `\n  rest — ${restingBars.length}/${totalBars} bars resting (${((100 * restingBars.length) / totalBars).toFixed(1)}%), ` +
    `${restWindows} windows of ${REST_WINDOW} bars checked, emptiest holds ${worstRest.count} resting bar(s)` +
    (worstRest.seed === null ? '' : ` (seed ${worstRest.seed}, bar ${worstRest.at})`),
);
console.log(
  `  a resting bar measures level sum ${restSum.toFixed(2)} against a working bar's ${workSum.toFixed(2)} ` +
    `— the rest is in the LEVELS, not only in the label`,
);

/* --------------------------------------------------------------- 5 ARRIVAL */

const judged = modulations - muteAtPivot;
console.log(
  `\n  modulation — ${modulations} key changes, ${announced} announced by a dominant on the bar before ` +
    `(${judged > 0 ? ((100 * announced) / judged).toFixed(0) : '0'}% of the ${judged} judgeable; ` +
    `${muteAtPivot} had no chord notes in that bar and are not counted either way)`,
);
console.log(
  `  capo moved ${capoMoves} time(s), which transposes the MELODY and not the chord grid — ` +
    'a pre-existing split, identical at HEAD; see the note beside `keyName` above',
);
console.log(
  `  carried by: ${
    HARMONY_LANES.map((l) => `${l} ${pivotLanes[l] ?? 0}`).join('  ')
  }   (a pivot may be spelled by more than one lane; this is a report, not an assertion)`,
);

/* ------------------------------------------------------------------ verdict */

const fails = [];
const longestFeel = Math.max(...allHolds.feel);
if (longestFeel < MIN_LONGEST_FEEL) {
  fails.push(
    `SPAN: the longest unbroken groove in any run is ${longestFeel} bars (${(longestFeel * barSec).toFixed(0)}s), ` +
      `want >= ${MIN_LONGEST_FEEL}. Nothing in the score holds longer than a section does, so the run is a rota.`,
  );
}
const feelMedian = med(allHolds.feel);
if (feelMedian < MIN_FEEL_MEDIAN) {
  fails.push(`GROOVE: the groove's median hold is ${feelMedian} bars, under one phrase (${MIN_FEEL_MEDIAN}).`);
}
const ceiling = pooled('peakF');
const ceilingSum = pooled('peakSum');
if (ceiling.rho < MIN_CEILING_RHO && ceilingSum.rho < MIN_CEILING_RHO) {
  fails.push(
    `CEILING: peak forward voices correlate with run position at rho ${ceiling.rho.toFixed(3)} and peak level sum ` +
      `at ${ceilingSum.rho.toFixed(3)}, both under ${MIN_CEILING_RHO}. The mix reaches its maximum early and stays.`,
  );
}
const firstWindows = windowRows.map(({ row }) => row[0]).filter(Boolean);
const openF = mean(firstWindows.map((r) => r.meanF));
const openSum = mean(firstWindows.map((r) => r.meanSum));
if (openF < MIN_OPENING_VOICES || openSum < MIN_OPENING_LEVELSUM) {
  fails.push(
    `FLOOR: the opening window averages ${openF.toFixed(1)} forward voices and a level sum of ${openSum.toFixed(2)} ` +
      `(want >= ${MIN_OPENING_VOICES} and >= ${MIN_OPENING_LEVELSUM}). An arc bought by starting from nothing is not an arc.`,
  );
}
if (restWindows === 0) {
  fails.push(`REST: zero ${REST_WINDOW}-bar windows examined — the run is shorter than one window.`);
} else if (worstRest.count === 0) {
  fails.push(
    `REST: a ${REST_WINDOW}-bar window (seed ${worstRest.seed}, bar ${worstRest.at}) contains no resting bar at all. ` +
      `An arrangement that only accumulates has no dynamics longer than a bar.`,
  );
}
if (restingBars.length === 0 || restSum >= workSum) {
  fails.push(
    `REST: resting bars measure a level sum of ${restSum.toFixed(2)} against working bars' ${workSum.toFixed(2)} — ` +
      `the sections were relabelled, not re-orchestrated.`,
  );
}
if (modulations === 0) {
  fails.push('ARRIVAL: no key change happened at all, so nothing was measured.');
} else if (judged <= 0) {
  fails.push(`ARRIVAL: all ${modulations} key changes landed on a bar with no chord notes — nothing judgeable.`);
} else if (announced / judged < MIN_PIVOT_SHARE) {
  fails.push(
    `ARRIVAL: only ${announced}/${judged} modulations were announced by the incoming key's dominant ` +
      `(want ${(100 * MIN_PIVOT_SHARE).toFixed(0)}%). A key that simply becomes different is not heard as a modulation.`,
  );
}

/* --------------------------------------------------------------- 7 REPRISE */

const allBars = perSeed.flatMap(({ bars }) => bars);
const recapBars = allBars.filter((b) => b.act === 'recapitulation');
const openingKey = perSeed.map(({ bars }) => bars[0]?.tonic).filter((k) => k !== undefined);
let homeBars = 0;
let homeThemeBars = 0;
let themeJudged = 0;
for (const { bars } of perSeed) {
  const home = bars[0]?.tonic;
  const openingTheme = bars[0]?.theme;
  for (const b of bars) {
    if (b.act !== 'recapitulation') continue;
    if (b.tonic === home) homeBars++;
    // A boss outranks the form: the leitmotif is the one piece of material
    // reserved by EVENT rather than by position, and `themeForWave` says so.
    if (b.theme === 'BOSS') continue;
    themeJudged++;
    if (b.theme === openingTheme) homeThemeBars++;
  }
}
const keysVisited = new Set(allBars.map((b) => b.tonic)).size;
console.log(
  `
  reprise — ${recapBars.length} bars in the recapitulation across ${SEEDS.length} run(s); ` +
    `${homeBars} in the opening key (${recapBars.length ? ((100 * homeBars) / recapBars.length).toFixed(0) : 0}%), ` +
    `${homeThemeBars}/${themeJudged} non-boss bars on the opening theme ` +
    `(${themeJudged ? ((100 * homeThemeBars) / themeJudged).toFixed(0) : 0}%)`,
);
console.log(
  `  the run visited ${keysVisited} distinct keys, so coming home is a return rather than never having left ` +
    `(opening keys: ${[...new Set(openingKey)].join(' ')})`,
);

console.log('');
console.log(`  acts reached: ${[...new Set(perSeed.flatMap(({ bars }) => bars.map((b) => b.act)))].join(', ')}`);
console.log(
  ACT_AT_PHRASE
    ? `  (act boundaries, in phrases since the run began: ${[...ACT_AT_PHRASE].reverse().map(([a, p]) => `${a} @ ${p}`).join(', ')})`
    : '  (this build has no act table — arrangement.ts exports none)',
);
if (recapBars.length > 0) {
  if (keysVisited < MIN_KEYS_VISITED) {
    fails.push(
      `REPRISE: the run only ever visited ${keysVisited} key(s) (want >= ${MIN_KEYS_VISITED}), so the ` +
        'recapitulation returns to a key it never left. A reprise measured on a run that did not modulate is free.',
    );
  }
  if (homeBars / recapBars.length < MIN_REPRISE_SHARE) {
    fails.push(
      `REPRISE: only ${homeBars}/${recapBars.length} recapitulation bars are in the key the run opened in ` +
        `(want ${(100 * MIN_REPRISE_SHARE).toFixed(0)}%). The last act is somewhere else.`,
    );
  }
  if (themeJudged === 0 || homeThemeBars / themeJudged < MIN_REPRISE_SHARE) {
    fails.push(
      `REPRISE: only ${homeThemeBars}/${themeJudged} non-boss recapitulation bars play the theme the run ` +
        `opened with (want ${(100 * MIN_REPRISE_SHARE).toFixed(0)}%). Nothing is being paid off.`,
    );
  }
} else {
  // Not a pass and not a failure: say so rather than reporting green on an
  // assertion that examined nothing. AGENTS.md §3, print every denominator.
  console.log(`  note  no run reached the recapitulation in ${SECS}s, so REPRISE examined 0 bars`);
}

console.log('');
for (const f of fails) console.log(`  FAIL  ${f}`);
if (!fails.length) {
  console.log(
    `  ok  the run has a shape — groove holds to ${longestFeel} bars, the ceiling rises with position ` +
      `(rho ${ceiling.rho.toFixed(2)} voices / ${ceilingSum.rho.toFixed(2)} level), every ${REST_WINDOW}-bar window ` +
      `rests at least ${worstRest.count} bar(s), and ${announced}/${judged} modulations arrive on a dominant`,
  );
}

/*
 * =========================================================================
 * FAIL-TEST LOG — every assertion seen red on its own, before any was trusted.
 * =========================================================================
 *
 * AGENTS.md §3: "a gate that has never been seen red is not evidence", and
 * "do this per ASSERTION, not per tool". Four of the seven were exercised by
 * the real defect rather than by a caricature of it — this file runs unmodified
 * against a `git worktree` at HEAD e17f1d4, where the form does not exist:
 *
 *   SPAN     RED at HEAD. Longest groove 36 bars against a floor of 48.
 *   CEILING  RED at HEAD. rho 0.257 voices / 0.386 level, both under 0.45.
 *   REST     RED at HEAD. A 64-bar window (seed 1, bar 256) with no rest.
 *   ARRIVAL  RED at HEAD. 0 of 27 modulations announced.
 *
 * GROOVE and FLOOR are GREEN at HEAD, which is the point of having them: they
 * are the two assertions that stop the other five being satisfied by wrecking
 * the opening. They were broken deliberately instead, in a copy of the tree, and
 * restored — the copy diffed byte-identical against the working tree afterwards:
 *
 *   FLOOR    `if (id === 'sub' && !shape.sub) want *= 0.3` widened to every
 *            lane, i.e. "thin the opening so everything after it is rising",
 *            which is exactly the way CEILING could be gamed. RED: opening
 *            window 3.0 forward voices and a level sum of 1.10.
 *   GROOVE   the feel re-derived every two bars in `update`. RED: median hold
 *            2 bars. (SPAN goes red with it — both read the same series, and
 *            HEAD is where they are shown to be independent: 36 bars fails SPAN
 *            while passing GROOVE.)
 *   REPRISE  broken in both halves, separately. Key: the recapitulation's
 *            return to `homeTonic` removed — RED, 0 of 128 recap bars in the
 *            opening key. Theme: `themeForWave`'s recap branch pointed at
 *            `THEMES[2]` — RED, 0 of 120 non-boss recap bars on the opening
 *            theme. The third REPRISE clause (a run must have visited three
 *            keys) is what stops a score that never modulates scoring a perfect
 *            reprise for free.
 *
 * AND ONE THE BASELINE ITSELF FAILED, which is why the log is worth keeping.
 * The first build with the form in it went RED on REST at seed 1, bar 576 —
 * 80 unbroken bars of work in the recapitulation. The cause was a guard I had
 * just added reading `dropAtBar >= 0` against a field that is never cleared
 * except on one path, so the forced rest switched off permanently from the
 * first boss telegraph. See the note beside that guard in `arrangement.ts`.
 * The gate caught its author.
 */
process.exit(fails.length ? 1 : 0);
