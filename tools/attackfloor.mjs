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
 * THE TAIL THRESHOLD HAS BEEN CALIBRATED AND RE-POINTED. It was a one-sided
 * `>= 250ms`, which the old comment here correctly called a placeholder. Sixty
 * songs of `eefano/strudel-songs-collection` put the corpus median release at
 * 200ms and the median attack at 50ms, so a floor of 250ms is ABOVE what real
 * music does, and could only ever be satisfied by lengthening tails on a score
 * whose defect was tails that were already too long. It is a WINDOW now,
 * 80-320ms, plus an OVERHANG assertion in gap units that is not a proxy at all.
 * See the block above `ATTACK_FLOOR_MS`. The ATTACK floor of 20ms is unchanged
 * and is still well below the corpus median, so it stays a floor and not a
 * target.
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
 * ===========================================================================
 * THE TAIL THRESHOLD IS RE-POINTED, AND IT WAS ARGUING FOR THE DEFECT
 * ===========================================================================
 *
 * It was `TAIL >= 250ms`, one-sided, and the comment that stood here said so
 * plainly: "PROVISIONAL ... nothing here was measured to arrive at 20 or 250 ...
 * the failure mode of a made-up threshold is that someone tunes to satisfy it."
 * Somebody did, four passes running, and the owner's report after every one of
 * them was that the music is "too drawn out".
 *
 * THE CALIBRATION THE OLD COMMENT ASKED FOR. Sixty published pieces from
 * `eefano/strudel-songs-collection`, read against this tree:
 *
 *                    corpus median      this score, before
 *   attack                  50 ms       6 ms   (lead)
 *   release                200 ms       530 ms (lead), 1475 ms (chords)
 *   clip                      .95       unused on six of seven lanes
 *
 * A one-sided floor of 250 ms is ABOVE the corpus median. It could only ever be
 * satisfied by tails longer than real music uses, on a score whose actual
 * defect was tails so long that notes of one lane stacked five deep. That is
 * not a threshold that was too loose or too tight; it was pointing the wrong
 * way.
 *
 * SO IT IS A WINDOW NOW, and the window is wider than the corpus rather than
 * narrower, because a gate should fail on defects and not on style: 80 ms to
 * 320 ms brackets the median 200 with a factor of about 2.5 either side. The
 * FLOOR keeps every bit of the pressure the old one-sided version was for - a
 * `sustain(0)` lane still cannot pass by appending a release, because TAIL is
 * defined as attack+decay when sustain is 0 (see the trap note above). The
 * CEILING is new, and it is the half that catches what the owner hears.
 *
 * AND THE CEILING IS NOT THE REAL ASSERTION EITHER. A 300 ms tail is short on a
 * whole-note pad and enormous on a sixteenth-note clock, so any threshold in
 * milliseconds is a proxy. The measurement that is not a proxy is OVERHANG -
 * how far a note runs past the NEXT note of its own lane, in units of the gap
 * between them - and it is asserted below, per lane, with its denominator
 * printed. Read that one. The millisecond window is the coarse net.
 */
const ATTACK_FLOOR_MS = 20;
const TAIL_FLOOR_MS = 80;
const TAIL_CEIL_MS = 320;

/*
 * OVERHANG CEILINGS.
 *
 * `reachesSecond` is the number that matters: a note still sounding when the
 * note AFTER the next one starts is three notes of the same part audible at
 * once, which is the definition of a smear. Some of it is legitimate - a
 * plucked string rings through its neighbour, and a delayed lane is supposed to
 * - so the ceiling is a share rather than zero.
 *
 * SEEN RED, on this tree, at HEAD, with the same tool and the same seed. The
 * paired run against the pre-articulation audio module failed three lanes on
 * this assertion alone - bass p95 1.98, chords p95 2.95, motifs p95 1.62 - and
 * the same run's chords lane read a p95 of 7.30 before the grouping was fixed
 * to compare a note against the next note of its OWN line rather than of its
 * stem. It is not a gate nobody has watched fail.
 *
 * After: the worst lane is the bass at 24% reaching the second onset and a p95
 * of 1.29 gaps; every other lane is 0% and under 0.35. The ceilings leave that
 * about a third of headroom, and they are RATCHETS - a figure seen at 24% does
 * not get a ceiling of 60% back without an argument written in this file.
 *
 * The bass is the worst lane for a reason worth recording rather than tuning
 * away: its three layers (anchor, on-beat fill, driving eighths) share one pan,
 * so the line key groups them as ONE part and the measure sees a denser onset
 * stream than any single layer plays. That over-reports it, and it is left
 * over-reported because the alternative is a grouping key with a special case
 * in it.
 */
const OVERHANG_SECOND_MAX = 0.32;
const OVERHANG_P95_MAX = 1.5;

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
    aboveTail: 0,
    /*
     * OVERHANG — how far a note's tail runs past the next note of its own lane,
     * as a multiple of the gap between them. See the OVERHANG section of the
     * header. Dimensionless on purpose, so a whole-note pad and a sixteenth-note
     * clock are on the same axis.
     */
    overhangs: [],
    reachesNext: 0,
    reachesSecond: 0,
    overhangDenom: 0,
  };
}

function bucketFor(map, stem, label = stem) {
  if (!map.has(stem)) map.set(stem, newAgg(label));
  return map.get(stem);
}

const NUMERIC = ['attacks', 'decays', 'sustains', 'releases', 'tails', 'rooms', 'gains', 'notes', 'overhangs'];
const COUNTERS = [
  'haps', 'zeroGain', 'exemptNoise', 'unparsed', 'noAttack', 'noRelease',
  'sustainZero', 'clipped', 'belowAttack', 'belowTail', 'aboveTail',
  'reachesNext', 'reachesSecond', 'overhangDenom',
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
function collect(map, stem, haps, level, secPerCycle) {
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
    if (e.tail * 1000 > TAIL_CEIL_MS) agg.aboveTail++;

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

  /*
   * OVERHANG, over the haps of ONE query of ONE stem.
   *
   * `Hap.duration` already carries `clip` (@strudel/core applies it in the
   * getter), and superdough starts the release ramp at `begin + duration`
   * (`helpers.mjs`, `end = begin + duration`). So a note is audible from its
   * onset until `onset + duration + release`, and everything below is
   * arithmetic on numbers this tool already reads rather than a model of
   * anything.
   *
   * The unit is the GAP between successive onsets of the same stem, so the
   * measure is dimensionless and a whole-note pad and a sixteenth-note clock
   * can be read on one axis. Onsets are DEDUPLICATED first: a four-note chord
   * is four haps at one instant and is one onset.
   *
   * Zero-gain haps are excluded for the same reason the envelope table excludes
   * them - the yield curves park a lane at exactly 0 on purpose and that is
   * silence by arithmetic, not a note.
   */
  const live = haps.filter((h) => (num(h.value?.gain) ?? 0.8) !== 0 && h.whole);

  /*
   * ONE LINE, NOT ONE STEM, and getting this wrong made the measurement useless
   * the first time it ran.
   *
   * Grouping onsets by STEM compared the pad's whole-bar note against the
   * STAB's next sixteenth — two different instruments inside `chords` — and
   * reported a p95 overhang of 7.3 gaps on an arrangement where the pad
   * overlaps nothing at all. A tail only smears against the NEXT NOTE OF THE
   * SAME PART.
   *
   * The key is (oscillator, duty, unison, pan). The first three are the voice
   * group identity `layers.VOICE_TAGS` defines; `pan` separates parts that
   * share a timbre, which in this score is exactly the case that matters — the
   * lead's skeleton, filigree and ornament are one oscillator at three places
   * in the field, and they are three lines, not one line playing triplets.
   */
  /*
   * ...UNLESS THE PAN IS DRAWN PER HIT. The stab's pan is `rand.range(+-0.12)`
   * since 2026-09-05 (screenshot 1's `.pan(rand.range(.1, 1))`), and Stage 1
   * gave the ghosts and the sixteenth hats the same. Keyed on the raw pan,
   * every such hap is its own one-hap "line", `onsets.length < 2` skips all
   * of them, and the stem's overhang denominator falls to whatever OTHER line
   * the stem has — the bed, at a fixed 0.5 — so the stab's overhang would go
   * unmeasured while the stem read green on the bed alone. That is the
   * one-assertion-carrying-the-rest shape AGENTS.md §3 names.
   *
   * So the pan joins the key only when a timbre sits at a FEW places: more
   * distinct pans than `PAN_LINES_MAX` in one (s, pw, unison) family is one
   * part moving in the field, not many parts, and it is grouped as one line.
   * The lead's three lines are three pans; the stab's are dozens.
   */
  const PAN_LINES_MAX = 8;
  const timbreOf = (v) => `${v.s ?? '?'}:${v.pw ?? ''}:${v.unison ?? ''}`;
  const pansOf = new Map();
  for (const h of live) {
    const v = h.value ?? {};
    const t = timbreOf(v);
    if (!pansOf.has(t)) pansOf.set(t, new Set());
    pansOf.get(t).add(v.pan ?? '');
  }
  const lineOf = (v) => {
    const t = timbreOf(v);
    return pansOf.get(t).size > PAN_LINES_MAX ? `${t}:*` : `${t}:${v.pan ?? ''}`;
  };
  const lines = new Map();
  for (const h of live) {
    const k = lineOf(h.value ?? {});
    if (!lines.has(k)) lines.set(k, []);
    lines.get(k).push(h);
  }
  for (const group of lines.values()) {
    const onsets = [...new Set(group.map((h) => Number(h.whole.begin)))].sort((a, b) => a - b);
    if (onsets.length < 2) continue;
    const idx = new Map(onsets.map((t, i) => [t, i]));
    for (const h of group) {
      const v = h.value ?? {};
      const e = envelopeOf(v);
      if (!Number.isFinite(e.r)) continue;
      const t0 = Number(h.whole.begin);
      const i = idx.get(t0);
      if (i === undefined || i + 1 >= onsets.length) continue;
      const gap = onsets[i + 1] - t0;
      if (!(gap > 0)) continue;
      const dur = Number(h.duration ?? gap);
      /* release is in SECONDS; onsets and durations are in cycles. */
      const end = t0 + dur + e.r / secPerCycle;
      agg.overhangDenom++;
      agg.overhangs.push((end - onsets[i + 1]) / gap);
      if (end > onsets[i + 1]) agg.reachesNext++;
      if (i + 2 < onsets.length && end > onsets[i + 2]) agg.reachesSecond++;
    }
  }
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
  const okTail = agg.belowTail === 0 && agg.aboveTail === 0;
  /*
   * EVERY GATED PITCHED HAP MUST STATE ITS NOTE LENGTH.
   *
   * `clip` was measured at 0% on six of seven lanes and 34% on the seventh
   * before `articulation.ts` existed, and the consequence is the whole finding
   * of that pass: a lane that never says how long its note is has its length
   * decided by `sustain` and `release` as a side effect, which is how a score
   * ends up "too drawn out" while every individual number looks reasonable.
   *
   * This is the assertion that locks the architecture in. A lane can only pass
   * it by going through `articulate`, and `articulate` refuses to write `clip`
   * on a `sustain(0)` lane — so a lane that reverts to a pluck fails here
   * rather than quietly losing its length control. Noise haps are already
   * excluded upstream (an attack floor buys pitch clarity; a noise sweep has no
   * pitch), and the exempt count is printed per lane.
   */
  const okClip = agg.haps > 0 && agg.clipped === agg.haps;
  /*
   * OVERHANG. `overhangDenom === 0` is a FAILURE and not a pass: a lane with no
   * pair of successive onsets was not measured at all, and AGENTS.md 3's "print
   * every denominator" exists because zero and clean look identical.
   */
  const second = agg.overhangDenom ? agg.reachesSecond / agg.overhangDenom : 1;
  const p95 = agg.overhangs.length ? pct95(agg.overhangs) : Infinity;
  const okOver = agg.overhangDenom > 0 && second <= OVERHANG_SECOND_MAX && p95 <= OVERHANG_P95_MAX;
  return {
    attackMed, tailMed, second, p95,
    okAttack, okTail, okOver, okClip,
    ok: okAttack && okTail && okOver && okClip,
  };
}

/** p95 of a numeric array. */
function pct95(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
}

function verdictLines(rows, label) {
  const out = [];
  for (const a of rows) {
    const j = judge(a);
    const bits = [];
    if (!j.okAttack) bits.push(`attack ${ms(med(a.attacks))}ms (${pct(a.belowAttack, a.haps)} under ${ATTACK_FLOOR_MS}ms)`);
    if (a.belowTail) bits.push(`tail ${ms(med(a.tails))}ms (${pct(a.belowTail, a.haps)} under ${TAIL_FLOOR_MS}ms)`);
    if (a.aboveTail) bits.push(`tail ${ms(med(a.tails))}ms (${pct(a.aboveTail, a.haps)} over ${TAIL_CEIL_MS}ms)`);
    if (!j.okClip) {
      bits.push(
        `clip ${pct(a.clipped, a.haps)} of ${a.haps} haps state a note length — the rest let \`release\` decide it`,
      );
    }
    if (!j.okOver) {
      bits.push(
        a.overhangDenom === 0
          ? 'OVERHANG not measured - no pair of successive onsets'
          : `overhang ${pct(a.reachesSecond, a.overhangDenom)} of ${a.overhangDenom} notes still sounding two onsets later` +
            `, p95 ${j.p95.toFixed(2)} gaps`,
      );
    }
    out.push(
      `  ${j.ok ? 'ok  ' : 'FAIL'}  ${pad(a.stem, 16)}` +
        (j.ok
          ? `attack ${ms(med(a.attacks))}ms · tail ${ms(med(a.tails))}ms · overhang ` +
            `${pct(a.reachesNext, a.overhangDenom)}/${pct(a.reachesSecond, a.overhangDenom)} next/second of ${a.overhangDenom}` +
            `, p95 ${j.p95.toFixed(2)} gaps`
          : bits.join(' · ')),
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
      why: 'attack 30ms and release 900ms — but sustain 0, so it dies at 50ms',
      expect: 'FAIL',
      pat: note('57 60 64 67').s('triangle').adsr('0.03:0.02:0:0.9'),
    },
    {
      /*
       * THE SMEAR CONTROL IS NEW, AND IT IS THE OLD `ctl-bed`.
       *
       * `adsr('0.06:0.3:0.6:0.6')` was specified as "a genuine sustained voice"
       * and expected to PASS, because under a one-sided `tail >= 250ms` a 600 ms
       * release was virtuous. Against the corpus median of 200 ms it is three
       * times too long, and on quarter notes it is a note still sounding when
       * the note after next begins. That is the exact defect this pass exists to
       * remove, so the same lane keeps its numbers, changes its name, and flips
       * its expectation.
       *
       * Recording it this way rather than deleting it is the point: the control
       * set now contains a lane the OLD gate called correct and the NEW gate
       * calls a failure, which is the clearest possible statement of what was
       * re-pointed.
       */
      id: 'ctl-smear',
      why: 'the OLD ctl-bed, which the old gate PASSED: adsr .06:.3:.6:.6, a 600ms tail',
      expect: 'FAIL',
      pat: note('57 60 64 67').s('triangle').adsr('0.06:0.3:0.6:0.6').room(0.2),
    },
    {
      /*
       * A CORPUS-SHAPED LANE: 50 ms on, 200 ms off, and a `clip` that states the
       * note's length instead of leaving it to the release. This is what the
       * sixty reference songs do on their sustained parts, and the gate has to
       * pass it or the gate is wrong.
       */
      id: 'ctl-bed',
      why: 'corpus-shaped: adsr .05:.18:.6:.2 with clip .8 — 50ms on, 200ms off',
      expect: 'ok',
      pat: note('57 60 64 67').s('triangle').adsr('0.05:0.18:0.6:0.2').clip(0.8).room(0.2),
    },
  ];

  const map = new Map();
  for (const l of LANES) collect(map, l.id, l.pat.queryArc(0, 1), 1, 240 / 135);
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
  console.log('\nDETECTOR HOLDS — four bad envelopes caught, one good envelope passed.');
  console.log('  The four FAIL rows above ARE the result: this is the gate failing on inputs whose');
  console.log('  envelopes are known to be wrong, while the fifth lane — equally synthetic — passes.');
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
    collect(seedMap, id, haps, d.levels?.[id] ?? 0, 240 / (d.bpm || 135));
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
  `\n  VERDICT — attack >= ${ATTACK_FLOOR_MS}ms, tail ${TAIL_FLOOR_MS}-${TAIL_CEIL_MS}ms, clip on every hap,\n` +
    `  and overhang\n` +
    `  <= ${(OVERHANG_SECOND_MAX * 100).toFixed(0)}% of notes still sounding two onsets later, p95 <= ${OVERHANG_P95_MAX} gaps.\n` +
    `  The tail window is CALIBRATED against 60 songs of eefano/strudel-songs-collection:\n` +
    `  median attack 50ms, median release 200ms, clip .95. It was a one-sided '>= 250ms',\n` +
    `  which is ABOVE that median - the threshold was arguing for the defect it was meant\n` +
    `  to catch. OVERHANG is the assertion that is not a proxy. Read that one first.\n`,
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
      `, ${pct(belowT, total)} fall silent inside ${TAIL_FLOOR_MS}ms and `+
      `${pct(gated.reduce((n, a) => n + a.aboveTail, 0), total)} ring past ${TAIL_CEIL_MS}ms.`,
  );
  for (const c of controlFails) console.log(`  sweep control: ${c}`);
  console.log('  Run `--control` to see the same verdict applied to inputs with known envelopes.');
  process.exit(1);
}
console.log('ENVELOPE FLOOR HELD — every gated pitched hap opens slowly enough and rings long enough.');
process.exit(0);
