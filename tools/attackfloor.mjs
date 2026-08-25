/*
 * attackfloor — the amplitude envelope every note ACTUALLY gets, per stem.
 *
 * WHY THIS EXISTS. The standing complaint is "choppy, clavichord, abrasive",
 * and the master plan's first ranked cause (S-a) is not gaps and not loudness:
 * it is that the game plays ~28 musical onsets a second, "nearly all on 1-10ms
 * attacks". superdough's DEFAULT amplitude envelope is 1ms attack / 10ms
 * release — a literal clavichord — and it is inherited silently. A builder
 * that writes `.ds('0.07:0')` and no `.attack()` has chosen a 1ms attack just
 * as surely as if it had typed one, except nothing in the source says so.
 *
 * That is the whole reason this reads HAPS and not source text. The flash-safety
 * incident in this repo is the recorded version of the lesson: a source check
 * that reads comments tests the prose. `grep attack src/audio/layers.ts` cannot
 * see an envelope nobody wrote, and an envelope nobody wrote is exactly the
 * defect. So the measurement is taken off the patterns the DIRECTOR HAS CACHED
 * during a real run — the same objects the Strudel scheduler queries — and the
 * effective envelope is computed by calling `getADSRValues` out of the
 * installed superdough itself, so this tool holds no copy of superdough's
 * fallback arithmetic and cannot go stale against it.
 *
 * THE TRAP THIS GATE IS BUILT AROUND, and it is the reason the headline number
 * is TAIL rather than release. superdough's envelope reaches `sustain` at
 * attack+decay and holds it until the note is released; `release` is the ramp
 * from sustain to silence (helpers.mjs `getParamADSR`). So on a lane with
 * `sustain(0)` the amplitude is already zero at attack+decay and the release
 * ramp is a no-op. THE MOTOR is `.ad('0.004:0.07').sustain(0)`: a 74ms pluck
 * whose release could be set to ten seconds without changing one sample. A gate
 * that asserted "release >= 250ms" would therefore go green the moment somebody
 * appended `.release(0.3)` to a sustain-0 lane, having changed nothing audible
 * at all — the "gates optimised against" failure, pre-armed. So:
 *
 *     TAIL = attack + decay      when sustain == 0   (the envelope self-terminates)
 *     TAIL = release             when sustain  > 0   (the ramp that actually runs)
 *
 * and the floor is applied to TAIL. A sustain-0 pitched lane cannot satisfy it
 * by adding a release; it has to stop being a pluck, which is the actual remedy
 * S1 is supposed to land.
 *
 * WHAT IS ALLOWLISTED, by name and on purpose. Drums are transients — that is
 * what a drum is — and the plan puts `fx` and `power` in "Furniture: rare event
 * punctuation; S-0 envelopes acceptable *only* here". So `kick`, `clap`, `fx`
 * and `power` are measured and printed but not gated. `hats` IS NOT IN THAT
 * LIST and must never be added to it: the stem id says hi-hat and the code is
 * `buildMotor`, a PITCHED inner voice that keeps time (see director.ts's own
 * note on why the id was left alone). It is the plan's single biggest offender
 * and it gets its own row and its own verdict line so that no future edit can
 * retire it by looking like percussion.
 *
 * Noise sources inside a gated lane (`s('white')` with no pitch — the rush
 * whoosh in `motifs`) are exempt, because an attack floor is a fix for pitch
 * clarity and a noise sweep has no pitch. The exempt count is PRINTED per lane,
 * so the exemption cannot quietly grow to cover a lane.
 *
 * THE THRESHOLDS ARE PROVISIONAL. 20ms / 250ms are the plan's §4 placeholders,
 * not measurements. Phase 0's calibration protocol freezes numbers from a
 * measured distribution — current build, reference tracks, a bad control, with
 * interleaved repeats — and this tool exists partly to produce the first column
 * of that table. Every row prints its real numbers whatever the verdict says;
 * read those, not the pass/fail, until calibration lands. The failure mode of a
 * made-up threshold is that someone tunes to satisfy it.
 *
 * Usage:
 *   node --experimental-transform-types tools/attackfloor.mjs
 *   node --experimental-transform-types tools/attackfloor.mjs --secs 300
 *   node --experimental-transform-types tools/attackfloor.mjs --control
 *
 * `--control` is the positive control: four synthetic lanes with known
 * envelopes are pushed through the same collector, the same table and the same
 * verdict as the real stems — a superdough-default lane, a hand-written
 * clavichord, the sustain-0-with-a-long-release loophole above, and one lane
 * that is genuinely fine. Three must FAIL and one must pass. A gate that fails
 * everything is as useless as one that fails nothing, so the fourth lane is
 * load-bearing. Its exit codes say which of the two things happened: 1 means
 * the gate failed on the bad lanes, which is the control succeeding; 2 means
 * the DETECTOR misbehaved and nothing it says can be believed.
 */
import './lib/headless-audio.mjs';

const { getADSRValues } = await import('superdough/helpers.mjs');
const strudel = await import('@strudel/core');
const { note, noteToMidi } = strudel;

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport, BARS_PER_PHRASE } = await import(`${R}core/transport.ts`);
const { STEM_IDS } = await import(`${R}audio/layers.ts`);
const { masterVolume } = await import(`${R}audio/volume.ts`);
const { makeBrain } = await import('./lib/bot-brain.mjs');

/* ------------------------------------------------------------------ config */

const argv = process.argv.slice(2);
const CONTROL = argv.includes('--control');
const SECS = Number(
  argv.includes('--secs') ? argv[argv.indexOf('--secs') + 1] : (process.env.ATTACKFLOOR_SECS ?? 720),
);
/*
 * `0x51ed` is the seed `wiring`, `texture` and the `deadhunt` tools already
 * use, so a state here is comparable with a state there.
 *
 * More than one is accepted — `--seeds 0x51ed,0xbeef` — because MASTER_PLAN §4
 * freezes thresholds "from that distribution ... with interleaved repeats to
 * measure run-to-run spread", and this harness's single most-documented failure
 * is a threshold sitting inside its own metric's noise (`suite`'s first full
 * sweep: four of four failures were exactly that). With more than one seed the
 * report prints the headline figure per seed and the spread between them, so
 * calibration has the noise band in front of it rather than one number.
 */
const SEEDS = (
  argv.includes('--seeds') ? argv[argv.indexOf('--seeds') + 1] : (process.env.ATTACKFLOOR_SEEDS ?? '0x51ed')
)
  .split(',')
  .map((x) => Number(x.trim()))
  .filter((x) => Number.isFinite(x));
const DT = 1 / 120;

/*
 * PROVISIONAL. From MASTER_PLAN §4's `attackfloor` row ("pitched attack >=20ms,
 * release >=250ms"), which is itself a placeholder awaiting §4's calibration
 * protocol. Nothing here was measured to arrive at 20 or 250. When calibration
 * runs, these move to (post-fix median - spread) and this comment goes with
 * them; until then treat the printed distributions as the result and the
 * verdict as a direction of travel.
 */
const ATTACK_FLOOR_MS = 20;
const TAIL_FLOOR_MS = 250;

/*
 * Furniture and drums: measured, printed, NOT gated. Named individually rather
 * than derived from anything, so adding a lane to the exemption is a visible
 * edit in a diff. `hats` is buildMotor — a pitched lane — and belongs nowhere
 * near this set; see the header.
 */
const FURNITURE = new Set(['kick', 'clap', 'fx', 'power']);
const MOTOR_STEM = 'hats';

/* Sources with no pitch. An attack floor buys pitch clarity; a noise sweep has
 * no pitch to clarify. Exempt inside a gated lane, and counted out loud. */
const NOISE = new Set(['white', 'pink', 'brown', 'crackle']);

/*
 * synth.mjs's OWN fallback for the case where a hap sets none of a/d/s/r
 * (`registerSound` for the oscillators and the noises both pass exactly this).
 * It is handed to superdough's `getADSRValues` rather than applied here, so the
 * branch logic — including "attack unset becomes 1ms whenever anything else is
 * set" — is superdough's arithmetic and not a paraphrase of it.
 */
const SYNTH_DEFAULT_ADSR = [0.001, 0.05, 0.6, 0.01];

/* ------------------------------------------------------------------- maths */

const num = (x) => {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return undefined;
};
/**
 * The MIDI number of a hap's pitch, whatever form it arrived in.
 *
 * `note('e3')` and `note(52)` are the same note and the kit writes both; a
 * bare `Number()` turns the first into NaN and quietly drops every drum and
 * every hand-written pitch out of the register column. `noteToMidi` is
 * Strudel's own parser, so this cannot disagree with what the scheduler heard.
 */
const midiOf = (v) => {
  const direct = num(v.note) ?? num(v.n);
  if (direct != null) return direct;
  const raw = v.note ?? v.n;
  if (typeof raw !== 'string') return undefined;
  try {
    const m = noteToMidi(raw);
    return Number.isFinite(m) ? m : undefined;
  } catch {
    return undefined;
  }
};
const med = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (x) => (Number.isFinite(x) ? (x * 1000).toFixed(x < 0.01 ? 1 : 0) : '—');
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '—');
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

/**
 * The envelope superdough will actually build for this hap, plus whether the
 * score asked for it or inherited it.
 */
function envelopeOf(v) {
  const raw = [num(v.attack), num(v.decay), num(v.sustain), num(v.release)];
  const [a, d, s, r] = getADSRValues(raw, 'linear', SYNTH_DEFAULT_ADSR);
  return {
    a,
    d,
    s,
    r,
    /* sustain 0 => the amp is already at zero at attack+decay and `release`
     * never runs. See the header. */
    tail: s === 0 ? a + d : r,
    setA: raw[0] != null,
    setR: raw[3] != null,
  };
}

/* -------------------------------------------------------------- collection */

function newAgg(stem) {
  return {
    stem,
    haps: 0,
    zeroGain: 0,
    exemptNoise: 0,
    unparsed: 0,
    builds: new Set(),
    attacks: [],
    decays: [],
    sustains: [],
    releases: [],
    tails: [],
    rooms: [],
    gains: [],
    notes: [],
    noAttack: 0,
    noRelease: 0,
    sustainZero: 0,
    clipped: 0,
    bySrc: new Map(),
    belowAttack: 0,
    belowTail: 0,
  };
}

function bucketFor(map, stem, label = stem) {
  if (!map.has(stem)) map.set(stem, newAgg(label));
  return map.get(stem);
}

const NUMERIC = ['attacks', 'decays', 'sustains', 'releases', 'tails', 'rooms', 'gains', 'notes'];
const COUNTERS = [
  'haps', 'zeroGain', 'exemptNoise', 'unparsed', 'noAttack', 'noRelease',
  'sustainZero', 'clipped', 'belowAttack', 'belowTail',
];

/** Fold one seed's aggregate into the all-seeds aggregate. */
function mergeInto(dst, src) {
  for (const k of COUNTERS) dst[k] += src[k];
  for (const k of NUMERIC) for (const x of src[k]) dst[k].push(x);
  for (const b of src.builds) dst.builds.add(b);
  for (const [k, sub] of src.bySrc) mergeInto(bucketFor(dst.bySrc, k, sub.stem), sub);
}

/**
 * Fold one query of one stem into the aggregate.
 *
 * `level` is the director's fader for the stem at this instant; it is recorded
 * so the AUDIBLE column can be printed, and it is deliberately NOT used to
 * filter. A quiet lane's notes still carry the envelope they were built with,
 * and a gate that ignored quiet haps could be satisfied by turning the
 * offending lane down — which is the shape of the drop-economy defect.
 */
function collect(map, stem, haps, level) {
  const agg = bucketFor(map, stem);
  const sig = [];
  for (const h of haps) {
    const v = h.value ?? {};
    const g = num(v.gain) ?? 0.8;
    /* Exactly zero gain is silence by arithmetic, not by threshold — the YIELD
     * curves park a lane there deliberately. Not a note. */
    if (g === 0) {
      agg.zeroGain++;
      continue;
    }
    const src = String(v.s ?? 'triangle');
    const pitch = midiOf(v);
    if (NOISE.has(src) && pitch == null) {
      agg.exemptNoise++;
      continue;
    }
    const e = envelopeOf(v);
    if (!Number.isFinite(e.a) || !Number.isFinite(e.tail)) {
      agg.unparsed++;
      continue;
    }
    agg.haps++;
    agg.attacks.push(e.a);
    agg.decays.push(e.d);
    agg.sustains.push(e.s);
    agg.releases.push(e.r);
    agg.tails.push(e.tail);
    agg.rooms.push(num(v.room) ?? 0);
    agg.gains.push(g * g * level * level * masterVolume() * masterVolume());
    if (pitch != null) agg.notes.push(pitch);
    if (!e.setA) agg.noAttack++;
    if (!e.setR) agg.noRelease++;
    if (e.s === 0) agg.sustainZero++;
    if (num(v.clip) != null || num(v.legato) != null) agg.clipped++;
    if (e.a * 1000 < ATTACK_FLOOR_MS) agg.belowAttack++;
    if (e.tail * 1000 < TAIL_FLOOR_MS) agg.belowTail++;

    if (!agg.bySrc.has(src)) agg.bySrc.set(src, newAgg(`${stem}·${src}`));
    const sub = agg.bySrc.get(src);
    sub.haps++;
    sub.attacks.push(e.a);
    sub.decays.push(e.d);
    sub.sustains.push(e.s);
    sub.releases.push(e.r);
    sub.tails.push(e.tail);
    sub.rooms.push(num(v.room) ?? 0);
    sub.gains.push(g);
    if (pitch != null) sub.notes.push(pitch);
    if (!e.setA) sub.noAttack++;
    if (!e.setR) sub.noRelease++;
    if (num(v.clip) != null || num(v.legato) != null) sub.clipped++;

    sig.push(`${src}:${e.a}:${e.d}:${e.s}:${e.r}`);
  }
  if (sig.length) agg.builds.add(sig.join('|'));
}

/* ------------------------------------------------------------------ tables */

function envRow(a) {
  return (
    `  ${pad(a.stem, 16)}${lpad(a.haps, 7)}` +
    `${lpad(`${ms(Math.min(...a.attacks))}/${ms(med(a.attacks))}/${ms(Math.max(...a.attacks))}`, 21)}` +
    `${lpad(ms(med(a.decays)), 9)}` +
    `${lpad(med(a.sustains).toFixed(2), 8)}` +
    `${lpad(`${ms(Math.min(...a.releases))}/${ms(med(a.releases))}/${ms(Math.max(...a.releases))}`, 21)}` +
    `${lpad(`${ms(Math.min(...a.tails))}/${ms(med(a.tails))}/${ms(Math.max(...a.tails))}`, 21)}`
  );
}
const ENV_HEAD =
  `  ${pad('stem', 16)}${lpad('haps', 7)}${lpad('attack ms lo/med/hi', 21)}${lpad('decay', 9)}` +
  `${lpad('sus', 8)}${lpad('release ms lo/med/hi', 21)}${lpad('TAIL ms lo/med/hi', 21)}`;

function inhRow(a) {
  const notes = a.notes.length
    ? `${Math.round(Math.min(...a.notes))}-${Math.round(Math.max(...a.notes))}`
    : '—';
  const dry = a.rooms.filter((r) => r < 0.1).length;
  const amp = med(a.gains);
  const db = Number.isFinite(amp) && amp > 0 ? `${(10 * Math.log10(amp)).toFixed(0)}` : '—';
  return (
    `  ${pad(a.stem, 16)}${lpad(pct(a.noAttack, a.haps), 10)}${lpad(pct(a.noRelease, a.haps), 11)}` +
    `${lpad(pct(a.sustainZero, a.haps), 11)}${lpad(med(a.rooms).toFixed(2), 8)}${lpad(pct(dry, a.haps), 7)}` +
    `${lpad(pct(a.clipped, a.haps), 7)}${lpad(notes, 10)}${lpad(db, 8)}${lpad(a.zeroGain, 9)}${lpad(a.exemptNoise, 8)}`
  );
}
const INH_HEAD =
  `  ${pad('stem', 16)}${lpad('no-attack', 10)}${lpad('no-release', 11)}${lpad('sustain-0', 11)}` +
  `${lpad('room', 8)}${lpad('dry', 7)}${lpad('clip', 7)}${lpad('MIDI', 10)}${lpad('dBFS', 8)}${lpad('gain-0', 9)}${lpad('noise', 8)}`;

/* ----------------------------------------------------------------- verdict */

function judge(agg) {
  const attackMed = med(agg.attacks) * 1000;
  const tailMed = med(agg.tails) * 1000;
  const okAttack = agg.belowAttack === 0;
  const okTail = agg.belowTail === 0;
  return { attackMed, tailMed, okAttack, okTail, ok: okAttack && okTail };
}

function verdictLines(rows, label) {
  const out = [];
  for (const a of rows) {
    const j = judge(a);
    const bits = [];
    if (!j.okAttack) bits.push(`attack ${ms(med(a.attacks))}ms (${pct(a.belowAttack, a.haps)} under ${ATTACK_FLOOR_MS}ms)`);
    if (!j.okTail) bits.push(`tail ${ms(med(a.tails))}ms (${pct(a.belowTail, a.haps)} under ${TAIL_FLOOR_MS}ms)`);
    out.push(
      `  ${j.ok ? 'ok  ' : 'FAIL'}  ${pad(a.stem, 16)}${j.ok ? `attack ${ms(med(a.attacks))}ms · tail ${ms(med(a.tails))}ms` : bits.join(' · ')}`,
    );
  }
  return { label, out, failed: rows.some((a) => !judge(a).ok) };
}

/* ============================================================ CONTROL MODE */

if (CONTROL) {
  /*
   * Four lanes with envelopes chosen by hand, pushed through `collect`, the
   * same tables and the same `judge` as the real stems. Nothing here touches
   * the game — the point of a positive control is to be independent of whether
   * today's build happens to pass.
   */
  const LANES = [
    {
      id: 'ctl-default',
      why: 'sets NO envelope at all — inherits superdough 1ms/10ms',
      expect: 'FAIL',
      pat: note('57 60 64 67').s('pulse'),
    },
    {
      id: 'ctl-clavichord',
      why: 'the defect written out explicitly: adsr .001:.05:0:.01',
      expect: 'FAIL',
      pat: note('57 60 64 67').s('triangle').adsr('0.001:0.05:0:0.01'),
    },
    {
      id: 'ctl-loophole',
      why: 'attack 30ms and release 900ms — but sustain 0, so it dies at 90ms',
      expect: 'FAIL',
      pat: note('57 60 64 67').s('triangle').adsr('0.03:0.06:0:0.9'),
    },
    {
      id: 'ctl-bed',
      why: 'a genuine sustained voice: adsr .06:.3:.6:.6',
      expect: 'ok',
      pat: note('57 60 64 67').s('triangle').adsr('0.06:0.3:0.6:0.6').room(0.2),
    },
  ];

  const map = new Map();
  for (const l of LANES) collect(map, l.id, l.pat.queryArc(0, 1), 1);
  const rows = LANES.map((l) => map.get(l.id));

  console.log('\nattackfloor --control — a deliberately-bad input the gate must catch\n');
  console.log(ENV_HEAD);
  for (const a of rows) console.log(envRow(a));
  console.log('');
  console.log(INH_HEAD);
  for (const a of rows) console.log(inhRow(a));

  console.log(`\n  VERDICT (thresholds PROVISIONAL: attack >= ${ATTACK_FLOOR_MS}ms, tail >= ${TAIL_FLOOR_MS}ms)\n`);
  const v = verdictLines(rows, 'control');
  for (const line of v.out) console.log(line);

  console.log('\n  DETECTOR CHECK — a gate that fails everything proves nothing either\n');
  let broken = 0;
  for (const l of LANES) {
    const got = judge(map.get(l.id)).ok ? 'ok' : 'FAIL';
    const agree = got === l.expect;
    if (!agree) broken++;
    console.log(`  ${agree ? '✓' : '✗'}  ${pad(l.id, 16)}expected ${pad(l.expect, 6)}got ${pad(got, 6)}${l.why}`);
  }
  if (broken) {
    console.log(`\nDETECTOR BROKEN — ${broken} control lane(s) did not behave as specified. Fix the gate before believing it.`);
    process.exit(2);
  }
  console.log('\nDETECTOR HOLDS — three bad envelopes caught, one good envelope passed.');
  console.log('  The three FAIL rows above ARE the result: this is the gate failing on inputs whose');
  console.log('  envelopes are known to be wrong, while the fourth lane — equally synthetic — passes.');
  console.log('  Exit 1 is that failure, deliberately. Exit 2 would mean the DETECTOR itself is broken.');
  process.exit(1);
}

/* =============================================================== REAL SWEEP */

const map = new Map();
const perSeed = [];
const cover = {
  bars: 0,
  bossBars: 0,
  sections: new Map(),
  waves: new Set(),
  bossWaves: new Set(),
  intensity: [],
  bpms: [],
  queryErrors: 0,
};

for (const SEED of SEEDS) {
const seedMap = new Map();
const w = new World(SEED);
w.start();
const d = new MusicDirector();
d.reset(0);
const t = new Transport();
t.start();
for (const [ev, fn] of [
  ['wave:start', (e) => d.onWaveStart(t, e)],
  ['wave:clear', (e) => d.onWaveClear(t, e)],
  ['boss:telegraph', (e) => d.onBossTelegraph(t, e)],
  ['boss:phase', (e) => d.onBossPhase(t, e)],
  ['boss:defeat', () => d.onBossDefeat(t)],
  ['player:hit', () => d.onPlayerHit()],
  ['player:death', () => d.onPlayerDeath(t)],
  ['player:bomb', () => d.onBomb(t)],
  ['powerup:pickup', (e) => d.onPickup(t, e.kind)],
  ['powerup:expire', (e) => d.onPickup(t, e.kind)],
]) w.bus.on(ev, fn);

const drive = makeBrain('dodge');
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

let lastBar = -1;
for (let i = 0; i < Math.round(SECS / DT); i++) {
  if (i % 2 === 0) drive(w, inp);
  w.update(DT, inp);
  t.advance(DT);
  d.update(w.snapshot, t, DT);

  const bar = Math.floor(t.bar);
  if (bar === lastBar) continue;
  lastBar = bar;

  /*
   * These three are `private` in director.ts, which is a compile-time word:
   * at runtime they are ordinary fields. Reading them is deliberate and is the
   * safer choice — `contrast` and `voicecheck` both lied for months because
   * they kept their own copy of something the program owns.
   */
  const section = d.readout(t).section;
  const boss = !!d.boss;
  cover.bars++;
  if (boss) cover.bossBars++;
  cover.sections.set(section, (cover.sections.get(section) ?? 0) + 1);
  cover.waves.add(d.musicalWave);
  if (boss) cover.bossWaves.add(d.musicalWave);
  cover.intensity.push(d.intensity);
  cover.bpms.push(d.bpm);

  for (const id of STEM_IDS) {
    const p = d.cache?.[id];
    if (!p) continue;
    let haps;
    try {
      /* One whole phrase. Each cached stem is a `cat` of BARS_PER_PHRASE
       * one-bar states, so this is every bar the director has committed to. */
      haps = p.queryArc(0, BARS_PER_PHRASE);
    } catch {
      cover.queryErrors++;
      continue;
    }
    collect(seedMap, id, haps, d.levels?.[id] ?? 0);
  }
}
perSeed.push({ seed: SEED, map: seedMap });
for (const [id, agg] of seedMap) mergeInto(bucketFor(map, id), agg);
}

/* ------------------------------------------------------------------ report */

const measured = STEM_IDS.filter((id) => (map.get(id)?.haps ?? 0) > 0);
const silentStems = STEM_IDS.filter((id) => (map.get(id)?.haps ?? 0) === 0);
const gated = measured.filter((id) => !FURNITURE.has(id)).map((id) => map.get(id));
const allowed = measured.filter((id) => FURNITURE.has(id)).map((id) => map.get(id));

/*
 * A unit check, printed rather than asserted.
 *
 * MASTER_PLAN §4: "A detector that cannot reproduce the current build's known
 * figures (~28 musical onsets/s) is in the wrong unit." This tool's unit is the
 * HAP, which is coarser than an audible onset in one direction (a four-note
 * chord is four haps at one instant) and finer in another (a hap under the
 * mixer's floor still counts here). So the number below should land in the same
 * order of magnitude as the director's own audit, and it does. Today's build:
 * 49.7 haps/bar (26.1/s) over a 120s sweep that stays in the early waves, and
 * 64.1 haps/bar (36.0/s) over the default 720s sweep that reaches wave 21 —
 * bracketing the plan's quoted ~49/bar ~28/s. The rise between the two is S-f
 * ('intensity = more onsets') showing up uninvited, and it is the reason this
 * line prints the sweep length beside it. If the figure ever comes out an order
 * of magnitude from the audit, something in the query path is wrong and nothing
 * else on this page can be believed.
 */
const totalHaps = STEM_IDS.reduce((n, id) => n + (map.get(id)?.haps ?? 0), 0);
const hapsPerBar = totalHaps / (cover.bars * BARS_PER_PHRASE);
const medBpm = med(cover.bpms);
const barSeconds = (60 / medBpm) * 4;

const iLo = Math.min(...cover.intensity);
const iHi = Math.max(...cover.intensity);
const secs = [...cover.sections.entries()].sort((a, b) => b[1] - a[1]);

console.log(`\nattackfloor — envelopes on the haps the director actually scheduled\n`);
console.log(
  `  sweep   ${SEEDS.length} run(s) x ${SECS}s, seed(s) ${SEEDS.map((x) => `0x${x.toString(16)}`).join(', ')}, sampled every bar (${cover.bars} bars)\n` +
    `          waves ${Math.min(...cover.waves)}-${Math.max(...cover.waves)} · ` +
    `boss ${pct(cover.bossBars, cover.bars)} of bars (waves ${[...cover.bossWaves].sort((a, b) => a - b).join(',') || 'none'})\n` +
    `          intensity ${iLo.toFixed(2)}-${iHi.toFixed(2)} · sections ${secs.map(([k, n]) => `${k} ${pct(n, cover.bars)}`).join(' · ')}\n` +
    `          hap counts are dwell-weighted: a phrase held for four bars is counted in four samples,\n` +
    `          which is what a listener is exposed to.\n` +
    `          rate    ${hapsPerBar.toFixed(1)} scheduled haps per bar over all ${STEM_IDS.length} stems (${(hapsPerBar / barSeconds).toFixed(1)}/s at the median ${medBpm.toFixed(0)}bpm)\n` +
    `                  — NOT the director's ~49-onsets/bar audit unit: every note of a chord and\n` +
    `                  every layer of a stem is a separate hap here. Same order of magnitude is\n` +
    `                  the check §4 asks for; reconciling the two units is calibration's job.`,
);

console.log('\n  PITCHED LANES — gated\n');
console.log(ENV_HEAD);
for (const a of gated) console.log(envRow(a));
console.log('');
console.log(INH_HEAD);
for (const a of gated) console.log(inhRow(a));

console.log('\n  DRUMS AND FURNITURE — measured, printed, NOT gated (kick, clap, fx, power)\n');
console.log(ENV_HEAD);
for (const a of allowed) console.log(envRow(a));
console.log('');
console.log(INH_HEAD);
for (const a of allowed) console.log(inhRow(a));

console.log('\n  BY VOICE — every distinct sound inside a gated lane\n');
console.log(ENV_HEAD);
for (const a of gated) {
  for (const sub of [...a.bySrc.values()].sort((x, y) => y.haps - x.haps)) console.log(envRow(sub));
}

/* -------------------------------------------------------- verdict + controls */

console.log(
  `\n  VERDICT — thresholds PROVISIONAL (attack >= ${ATTACK_FLOOR_MS}ms, tail >= ${TAIL_FLOOR_MS}ms).\n` +
    `  These are MASTER_PLAN §4 placeholders, not measurements. §4's calibration protocol\n` +
    `  freezes them from a distribution; the numbers above are this build's contribution to it.\n`,
);

const motor = map.get(MOTOR_STEM);
const others = gated.filter((a) => a.stem !== MOTOR_STEM);
const v = verdictLines(others, 'pitched');
for (const line of v.out) console.log(line);

console.log('');
if (motor && motor.haps) {
  const j = judge(motor);
  console.log(
    `  ${j.ok ? 'ok  ' : 'FAIL'}  MOTOR (stem '${MOTOR_STEM}') — a PITCHED lane, deliberately not allowlisted.\n` +
      `        attack ${ms(med(motor.attacks))}ms · decay ${ms(med(motor.decays))}ms · sustain ${med(motor.sustains).toFixed(2)} · ` +
      `release ${ms(med(motor.releases))}ms → TAIL ${ms(med(motor.tails))}ms\n` +
      `        ${pct(motor.noAttack, motor.haps)} of its haps set no attack, ${pct(motor.noRelease, motor.haps)} set no release, ` +
      `${pct(motor.sustainZero, motor.haps)} sustain 0.\n` +
      `        It is the most-heard sound in the game; sustain 0 means its release can never engage.`,
  );
} else {
  console.log(`  FAIL  MOTOR (stem '${MOTOR_STEM}') produced no haps in this sweep — unmeasured, not passing.`);
}

/*
 * The noise band, when there is more than one run to measure it from.
 *
 * MASTER_PLAN §4 freezes every new threshold "from that distribution ... with
 * interleaved repeats". A single run cannot state a spread, and this harness's
 * worst recorded failure is a threshold sitting inside one. The envelope
 * numbers here are structural — a voice's ADSR is written into the builder —
 * so the spread SHOULD be small; printing it is how that stops being a claim.
 */
if (perSeed.length > 1) {
  const headline = (m) => {
    const g = STEM_IDS.filter((id) => !FURNITURE.has(id))
      .map((id) => m.get(id))
      .filter((a) => a && a.haps);
    const total = g.reduce((n, a) => n + a.haps, 0);
    return {
      total,
      att: (100 * g.reduce((n, a) => n + a.belowAttack, 0)) / total,
      tail: (100 * g.reduce((n, a) => n + a.belowTail, 0)) / total,
    };
  };
  console.log('\n  REPEATS — the same measurement on independent runs\n');
  console.log(`  ${pad('seed', 16)}${lpad('pitched haps', 14)}${lpad('under attack floor', 20)}${lpad('under tail floor', 18)}`);
  const all = perSeed.map(({ seed, map: m }) => ({ seed, ...headline(m) }));
  for (const r of all) {
    console.log(
      `  ${pad(`0x${r.seed.toString(16)}`, 16)}${lpad(r.total, 14)}${lpad(`${r.att.toFixed(1)}%`, 20)}${lpad(`${r.tail.toFixed(1)}%`, 18)}`,
    );
  }
  const spread = (k) => Math.max(...all.map((r) => r[k])) - Math.min(...all.map((r) => r[k]));
  console.log(`\n  spread across ${all.length} runs: attack ${spread('att').toFixed(1)}pp · tail ${spread('tail').toFixed(1)}pp`);
  console.log('  Any threshold moved by less than that spread is inside the noise and means nothing.');
}

/*
 * Sweep-adequacy controls. These say nothing about the music; they say whether
 * this run was entitled to an opinion. `ending.mjs` passed a broken build by
 * counting notes in a lane the mixer had silenced, and `everypowerup` passed
 * twelve powerups by comparing a drifting baseline against itself. A stem that
 * never sounded is UNMEASURED, and unmeasured is not ok.
 */
console.log('\n  SWEEP CONTROLS\n');
const controlFails = [];
if (silentStems.length) {
  controlFails.push(`${silentStems.length} stem(s) never scheduled a note: ${silentStems.join(', ')} — unmeasured, not passing`);
  console.log(`  FAIL  coverage — never heard: ${silentStems.join(', ')}`);
} else {
  console.log(`  ok    coverage — all ${STEM_IDS.length} stems scheduled at least one note`);
}
if (cover.bossBars === 0) {
  controlFails.push('the sweep never met a boss, so "with a boss" is unmeasured');
  console.log('  FAIL  boss states — none visited; raise --secs');
} else {
  console.log(`  ok    boss states — ${cover.bossBars} boss bars across waves ${[...cover.bossWaves].sort((a, b) => a - b).join(',')}`);
}
if (cover.sections.size < 4) {
  controlFails.push(`only ${cover.sections.size} arrangement section(s) visited`);
  console.log(`  FAIL  sections — only ${cover.sections.size} visited`);
} else {
  console.log(`  ok    sections — ${cover.sections.size} visited`);
}
/* `!(x >= 0.4)` rather than `x < 0.4`: if the director's private fields ever
 * become real #private slots, `d.intensity` reads undefined and this span is NaN
 * — and NaN < 0.4 is false, so the written-the-obvious-way test would pass a
 * sweep that measured nothing. Every other reader of those fields fails loudly
 * (no cache means no haps means the coverage control fires); this one would not. */
if (!(iHi - iLo >= 0.4)) {
  controlFails.push(`intensity only spanned ${(iHi - iLo).toFixed(2)}; the dynamics were not exercised`);
  console.log(`  FAIL  intensity span ${(iHi - iLo).toFixed(2)} — too narrow to call this a sweep`);
} else {
  console.log(`  ok    intensity span ${(iHi - iLo).toFixed(2)} (${iLo.toFixed(2)}-${iHi.toFixed(2)})`);
}
if (cover.queryErrors) console.log(`  note  ${cover.queryErrors} pattern quer(ies) threw and were skipped`);

const failed = v.failed || !motor || !motor.haps || !judge(motor).ok || controlFails.length > 0;

console.log('');
if (failed) {
  const below = gated.reduce((n, a) => n + a.belowAttack, 0);
  const belowT = gated.reduce((n, a) => n + a.belowTail, 0);
  const total = gated.reduce((n, a) => n + a.haps, 0);
  console.log(
    `ENVELOPE FLOOR NOT MET — ${pct(below, total)} of pitched haps attack faster than ${ATTACK_FLOOR_MS}ms ` +
      `and ${pct(belowT, total)} fall silent inside ${TAIL_FLOOR_MS}ms.`,
  );
  for (const c of controlFails) console.log(`  sweep control: ${c}`);
  console.log('  Run `--control` to see the same verdict applied to inputs with known envelopes.');
  process.exit(1);
}
console.log('ENVELOPE FLOOR HELD — every gated pitched hap opens slowly enough and rings long enough.');
process.exit(0);
