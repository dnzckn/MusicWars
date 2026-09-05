/**
 * What does the first phrase actually sound like?
 *
 * This replaces an older `introcheck` that asserted layers entered in order and
 * that loudness rose. Both were true of a four-bar intro in which the melody
 * played zero notes, so it passed for nineteen iterations while the feature it
 * named did nothing. Asserting on the actual note content is harder to satisfy
 * by accident than asserting on a property derived from it.
 *
 * HARMONY IS COUNTED BY AUDIBILITY, NOT BY ONSET — and this is the second time
 * this file has had to move from a proxy to the thing.
 *
 * The old assertion was `mean(intro, 'chords') >= 2` over `sampleBar`, which
 * counts onsets regardless of gain. On the tree that deleted the chords pad the
 * lane's only voice is the stab, whose intro gain is `density * 0.3` with
 * density near 0.06 — about 0.013, on a fader of 0.35. Four onsets a bar of
 * that would have satisfied "harmony present" while being 30 dB under the
 * director's own floor for scheduling a voice. A gate that passes on haps the
 * director itself would refuse to allocate is measuring the pattern, not the
 * music.
 *
 * So a hap counts only if `gain^2 * fader^2 > AUDIBLE_FLOOR` — the same test
 * `masterPattern` applies before a hap reaches superdough, with the constant
 * IMPORTED rather than copied (AGENTS.md §3). Imported IN THE PAGE, from
 * `/src/audio/director.ts` exactly as Vite serves it to the game: this tool
 * runs as plain `node tools/opening.mjs` (`package.json`), and Node 22.17
 * cannot load a `.ts` file without `--experimental-transform-types` — the
 * first version imported it node-side and died with ERR_UNKNOWN_FILE_EXTENSION
 * before opening a browser, which is a red that measures nothing. The fader is
 * the live `readout().levels[id]` at the bar line. `masterVolume()` is left
 * out on purpose: it is the player's volume knob, and a gate must not change
 * verdict with it.
 *
 * What is asserted about the harmony now, both with printed denominators:
 *
 *   BASS   The bass states the key. It enters at `INTRO_ENTRY.bass` (0.2 of
 *          the phrase) and must be AUDIBLE in at least `BASS_BARS_MIN` intro
 *          bars — not merely scheduled.
 *   STAB   The harmony chair is a two-to-four-hit stab, and it must be audible
 *          at least `STAB_HAPS_MIN` times before the first drop bar. "Before
 *          the drop" rather than "in the intro" because the stab's level is
 *          the intensity signal, which the intro floors at 0.2; it comes up
 *          through the build.
 *
 * Both were seen red, separately, on 2026-09-04, by one temporary edit each
 * in `layers.ts`, reverted and byte-verified: `stabLevel = 0` -> "the stab is
 * audible 0 time(s) before the drop (24 scheduled)" with the bass still
 * audible in 6 of 8; `INTRO_ENTRY.bass = 2` (past the phrase) -> "the bass is
 * audible in only 0 of 8 intro bars" with the stab still audible 12 of 24.
 * Green on the tree that deleted the pad: bass audible from bar 2 in 6 of 8
 * intro bars, stab audible from bar 4, 14 of 24 scheduled before the drop.
 *
 * The onset-order assertions below are unchanged and are about ORDER, which
 * onsets answer honestly. One of them is SENSITIVE TO BAR QUANTISATION and
 * should be read knowing it: `INTRO_ENTRY` puts the kick at 0.55 and the lead
 * at 0.72, so the kick's first onset is designed to land a bar or so before
 * the tune's; "drums arrived before the tune" is green only when both first
 * sound in the same bar (kick 6, lead 6 in the green run above) and fired in
 * both red runs (kick 5, lead 6-7) alongside the intended failure. That is a
 * pre-existing property of the entry order, not of the pad's deletion, and it
 * is left as it stands rather than relaxed; the fix, if the order is the
 * intent, is a bar-tolerant comparison, which is a design decision for the
 * owner of the intro.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';

const BASS_BARS_MIN = 3;
const STAB_HAPS_MIN = 1;

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
const { rows, floor: AUDIBLE_FLOOR, tags: TAGS } = await p.evaluate(async () => {
  // The director's own constant, from the module the game is running.
  const { AUDIBLE_FLOOR: floor } = await import('/src/audio/director.ts');
  /*
   * THE STAB IS SELECTED BY TIMBRE, not by stem — the third time this file has
   * had to move from a proxy to the thing. The chords stem carries TWO voices
   * since 2026-09-05: the stab and the sine BED (`buildChords`), and the bed
   * at written 0.22 clears the floor two bars before the stab does. Counted by
   * stem, the bed's two whole notes a bar read as "the stab is audible" and
   * this gate could never see the bed stealing the stab's audibility, which
   * is the one thing the pass that added the bed was told to watch for. The
   * tags come from `layers.VOICE_TAGS`, imported in the page from the module
   * the game is running, so the selector is the builders' own definition and
   * not a copy (AGENTS.md §3; `harmony.mjs` had a copy and it lied).
   */
  const { VOICE_TAGS } = await import('/src/audio/layers.ts');
  const isTag = (v, tag) =>
    v.s === tag.s && (tag.pw === undefined || v.pw === tag.pw) && (tag.unison === undefined || v.unison === tag.unison);
  const mw = window.__musicwars;
  const out = [];
  let lastBar = -1;
  const end = performance.now() + 26000;
  /*
   * The director's own audibility test, per hap: `gain^2 * fader^2` against
   * the imported floor. `cache` is the per-stem pattern the scheduler queries;
   * `sampleBar` reads the same object but throws the gain away. `pick` narrows
   * a stem to one voice; the denominators are of the picked haps.
   */
  const audible = (id, bar, fader, pick = () => true) => {
    let n = 0;
    let total = 0;
    try {
      for (const hap of mw.director.cache[id].queryArc(bar, bar + 1)) {
        if (!hap.hasOnset || !hap.hasOnset()) continue;
        const v = hap.value ?? {};
        if (!pick(v)) continue;
        total++;
        const g = typeof v.gain === 'number' ? v.gain : 1;
        if (g * g * fader * fader > floor) n++;
      }
    } catch {
      /* a lane that cannot be queried counts as silent */
    }
    return { n, total };
  };
  while (performance.now() < end) {
    const bar = Math.floor(mw.readout().bar);
    if (bar !== lastBar && bar >= 0) {
      lastBar = bar;
      const s = mw.director.sampleBar(mw.world.transport);
      const rd = mw.readout();
      const bass = audible('bass', bar, rd.levels.bass);
      const stab = audible('chords', bar, rd.levels.chords, (v) => isTag(v, VOICE_TAGS.stab));
      const bed = VOICE_TAGS.bed ? audible('chords', bar, rd.levels.chords, (v) => isTag(v, VOICE_TAGS.bed)) : { n: 0, total: 0 };
      out.push({ bar, section: rd.section,
        lead: s.lead.length, arp: s.arp.length, chords: s.chords.length,
        kick: s.kick.length, hats: s.hats.length, bass: s.bass.length,
        bassAud: bass.n, stabAud: stab.n, stabSched: stab.total, bedAud: bed.n, bedSched: bed.total,
        bassLvl: +rd.levels.bass.toFixed(2), chordsLvl: +rd.levels.chords.toFixed(2),
        leadLvl: +rd.levels.lead.toFixed(2) });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return { rows: out, floor, tags: { stab: VOICE_TAGS.stab, bed: VOICE_TAGS.bed ?? null } };
});
if (typeof AUDIBLE_FLOOR !== 'number') throw new Error(`AUDIBLE_FLOOR did not import in the page: ${AUDIBLE_FLOOR}`);
if (!TAGS?.stab?.s) throw new Error(`VOICE_TAGS.stab did not import in the page: ${JSON.stringify(TAGS)}`);
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows.slice(0, 12));
const intro = rows.filter((r) => r.section === 'intro');
const mean = (a, k) => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : 0);
console.log(`intro bars: ${intro.length}, mean lead notes/bar: ${mean(intro, 'lead').toFixed(1)}`);

// Order of arrival, by onset: harmony, then melody, then rhythm.
const firstWith = (k) => rows.find((r) => r[k] > 0)?.bar ?? -1;
const order = { bass: firstWith('bass'), chords: firstWith('chords'), lead: firstWith('lead'), kick: firstWith('kick'), hats: firstWith('hats') };
console.log('first bar each stem sounds (onsets):', JSON.stringify(order));
const firstAudible = { bass: firstWith('bassAud'), stab: firstWith('stabAud'), bed: firstWith('bedAud') };
console.log(`first bar each is AUDIBLE (gain^2 * fader^2 > ${AUDIBLE_FLOOR}):`, JSON.stringify(firstAudible));

// The audibility denominators, printed before any verdict.
const firstDrop = rows.find((r) => r.section === 'drop')?.bar ?? rows.length;
const preDrop = rows.filter((r) => r.bar < firstDrop);
const bassBars = intro.filter((r) => r.bassAud > 0).length;
const stabHaps = preDrop.reduce((n, r) => n + r.stabAud, 0);
const stabScheduled = preDrop.reduce((n, r) => n + r.stabSched, 0);
const bedHaps = preDrop.reduce((n, r) => n + r.bedAud, 0);
const bedScheduled = preDrop.reduce((n, r) => n + r.bedSched, 0);
console.log(`bass audible in ${bassBars} of ${intro.length} intro bars (min ${BASS_BARS_MIN})`);
console.log(
  `stab (${TAGS.stab.s}) audible ${stabHaps} time(s) of ${stabScheduled} scheduled before the first drop bar (bar ${firstDrop}; min ${STAB_HAPS_MIN})`,
);
// A readout, not an assertion: the bed is meant to be under the stab, and
// the number to watch is the stab's, above, not this one.
console.log(
  TAGS.bed
    ? `bed (${TAGS.bed.s}) audible ${bedHaps} time(s) of ${bedScheduled} scheduled before the drop — a readout; if the stab count above ever falls under its minimum, the bed's intro level is what moves`
    : 'no bed voice in VOICE_TAGS',
);

const fail = [];
if (intro.length < 6) fail.push(`intro lasted only ${intro.length} bars; it is meant to be 8`);
if (mean(intro, 'lead') < 1.5) fail.push(`melody averaged ${mean(intro, 'lead').toFixed(1)} notes/bar in the intro`);
if (intro.length === 0 || preDrop.length === 0) fail.push('no intro bars were sampled — a zero denominator is a failure, not a pass');
if (bassBars < BASS_BARS_MIN) fail.push(`the bass is audible in only ${bassBars} of ${intro.length} intro bars — the key is not being stated`);
if (stabHaps < STAB_HAPS_MIN) fail.push(`the stab is audible ${stabHaps} time(s) before the drop (${stabScheduled} scheduled) — the harmony chair is silent`);
if (order.chords < 0 || order.lead < 0) fail.push('harmony or melody never sounded');
if (order.lead < order.chords) fail.push('melody arrived before the harmony that frames it');
if (order.kick >= 0 && order.kick < order.lead) fail.push('drums arrived before the tune');
if (fail.length) {
  console.log('\n=== FAILURES ===');
  fail.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
console.log('\nOPENING STATES THE THEME');
