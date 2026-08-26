/**
 * Does a theme actually come back?
 *
 * Themes were selected `wave % THEMES.length`, so a tune played for one wave
 * and then did not return for several minutes — a playlist, not a score. Eight
 * tunes heard once each is how you guarantee none of them becomes a hook, and
 * the hook is the point.
 *
 * The structure is a rondo: a signature theme every other wave and episodes
 * between. This asserts that shape directly rather than inferring it from
 * audio, because the audio deliberately develops the theme each time it returns
 * — a listening test would be measuring the development, not the recurrence.
 *
 * ---------------------------------------------------------------------------
 * TWO ASSERTIONS REPLACED, AND WHICH KIND OF REPLACEMENT EACH IS
 * ---------------------------------------------------------------------------
 *
 * AGENTS.md §3 asks for this distinction in as many words: "'the test failed so
 * I removed it' and 'the test encoded an assumption I am deliberately changing'
 * look identical in a diff. Say which."
 *
 * 1. `bossAlwaysSignature` WAS AN ASSUMPTION A LATER CHANGE REVERSED, and it
 *    has been red ever since. It asserted `themeForWave(w, true) === signature`
 *    — that a boss plays the rondo's A material. `layers.ts` then gave the
 *    adversary its own leitmotif, and its comment states the reasoning at
 *    length: "the signature is also what plays on every even wave — so the
 *    biggest moment in the run sounded like the most familiar one". The gate
 *    was never updated. Verified rather than assumed: run against a `git
 *    worktree` at HEAD e17f1d4 it prints the identical four numbers and exits 1.
 *
 *    The replacement is STRONGER, not weaker. The old line asked for one
 *    equality; `bossIsLeitmotif` asks for three things at once — every boss
 *    wave returns the same theme, that theme is not the signature, and it is
 *    not any theme in the ordinary rotation either. A build that put the
 *    leitmotif back into the rota would pass the old assertion's spirit and
 *    fail this one.
 *
 * 2. `recapIsSignature` IS NEW, and it covers material the old tool could not
 *    see. `themeForWave` now takes a third argument: in the last act of a long
 *    run the score returns to the signature whatever the rota says (see
 *    `ACT_SHAPE` in `arrangement.ts`). That is a recurrence at the scale of a
 *    RUN rather than of a wave, and nothing here measured it.
 *
 * ALL THREE OF THE NEW/REPLACED ASSERTIONS SEEN RED, SEPARATELY, against the
 * live dev server, and restored between each:
 *
 *   bossIsLeitmotif           `themeForWave`'s boss branch pointed at
 *                             `THEMES[0]` — i.e. the design this assertion
 *                             replaced. RED alone; the other five stayed green.
 *   recapIsSignature          the recap branch pointed at `THEMES[2]`. RED alone.
 *   recapBossStillLeitmotif   the recap branch moved ABOVE the boss branch, so
 *                             the form outranked the leitmotif. RED alone.
 *
 * WHY THE GAP CHECK IS THE LOAD-BEARING ONE. AGENTS.md records that this tool
 * once passed on a theme that returned only every several minutes, so a bare
 * "the signature recurs" is not enough — a period long enough is
 * indistinguishable from no recurrence at all. `longestGap` bounds the wait in
 * WAVES, and a wave measures about 16 bars (`tools/arc.mjs`, 2560 bars over
 * four twenty-minute runs), so a gap of 2 is roughly a minute. `distinct` is
 * the other half: a signature that recurs because every theme is the same theme
 * would satisfy the gap trivially.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const f = window.__musicwars.themeForWave;
  if (!f) return null;
  const id = (t) => JSON.stringify(t.a) + JSON.stringify(t.b);
  const plain = [], boss = [];
  for (let w = 0; w < 16; w++) plain.push(id(f(w, false)));
  for (let w = 0; w < 16; w++) boss.push(id(f(w, true)));
  const signature = plain[0];
  const recap = [];
  const recapBoss = [];
  for (let w = 0; w < 16; w++) recap.push(id(f(w, false, true)));
  for (let w = 0; w < 16; w++) recapBoss.push(id(f(w, true, true)));
  return {
    signatureShare: plain.filter((x) => x === signature).length / plain.length,
    distinct: new Set(plain).size,
    // Reserved material: one leitmotif, on every boss, heard nowhere else.
    bossIsLeitmotif:
      new Set(boss).size === 1 && boss[0] !== signature && !plain.includes(boss[0]),
    // The run-level recurrence: the last act comes home to the A material
    // whatever the rota says — and a boss still outranks the form.
    recapIsSignature: recap.every((x) => x === signature),
    recapBossStillLeitmotif: recapBoss.every((x) => x === boss[0]),
    // Longest run of waves without the signature: the gap a listener has to
    // hold the tune across.
    longestGap: plain.reduce((acc, x) => (x === signature ? { run: 0, max: acc.max } : { run: acc.run + 1, max: Math.max(acc.max, acc.run + 1) }), { run: 0, max: 0 }).max,
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
if (!r) { console.log('themeForWave not exposed (production build?) - skipping'); process.exit(0); }
console.log(JSON.stringify(r, null, 1));
/*
 * Every assertion printed by name, pass or fail.
 *
 * The old version reduced six booleans to one `ok` and printed the raw object,
 * so a reader had to re-derive which condition had failed from four numbers.
 * `sections` and `session` both name their checks; this now does too.
 *
 * Note what happens on a build that predates the run form: `themeForWave`
 * ignores the third argument, `recap` comes back equal to `plain`, and
 * `recapIsSignature` is false on the episode waves. That is the correct
 * reading — the recurrence genuinely is not there — and it is why this file
 * exits 1 against HEAD e17f1d4 on two counts rather than one.
 */
const checks = {
  signatureShare: r.signatureShare >= 0.4,
  distinct: r.distinct >= 4,
  bossIsLeitmotif: r.bossIsLeitmotif,
  longestGap: r.longestGap <= 2,
  recapIsSignature: r.recapIsSignature,
  recapBossStillLeitmotif: r.recapBossStillLeitmotif,
};
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'ok  ' : 'FAIL'}  ${k}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? 'THE TUNE COMES BACK' : 'NO RECURRING THEME');
process.exit(ok ? 0 : 1);
