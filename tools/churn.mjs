/*
 * churn — how long does the listener get one tune in one colour?
 *
 * A theme is chosen by `themeForWave` and a mode by `updateHarmony`, and until
 * now they ran on separate clocks: the mode moved every phrase (8 bars) and the
 * wave every ~16, so a tune was stated in one colour and then continued in
 * another before it could ever be restated in the first.
 *
 * Recognition is statement plus restatement. A melody heard once and then
 * recoloured cannot be learned however well it is written, so this number is
 * upstream of every note choice in `layers.ts` — it is worth fixing before
 * rewriting a single theme.
 *
 * Measured here as the longest unbroken run of identical (mode, tonic, theme)
 * across a real playthrough, plus how often each of the three changes.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { MusicDirector } = await import(`${R}audio/director.ts`);
const { Transport } = await import(`${R}core/transport.ts`);
const { THEMES, BOSS_THEME, themeForWave } = await import(`${R}audio/layers.ts`);

/*
 * Identify the TUNE, not the wave number. Two consecutive waves now share a
 * theme, so keying a segment on the wave counted a boundary where the listener
 * hears none — this reported 18 eight-bar segments after the fix that was
 * supposed to remove them.
 */
const themeId = (wave, boss) => {
  const th = themeForWave(wave, boss);
  if (th === BOSS_THEME) return 'BOSS';
  const i = THEMES.indexOf(th);
  return i >= 0 ? `T${i}` : '?';
};

const DT = 1 / 120;
const SECS = Number(process.env.SECS ?? 480);
/* A theme has to survive at least this many bars to be heard twice. */
const MIN_HOLD_BARS = 24;

/*
 * SEVERAL SEEDS. One run is an anecdote, and this metric is sensitive to wave
 * pacing — a change to the level-up economy that had nothing to do with music
 * moved it 52% -> 49% against a 50% bar, which is a verdict decided by three
 * bars of one playthrough. The same mistake was live in `builds.mjs` at the
 * same time.
 */
const SEEDS = [0x51ed, 0xbeef, 0x1234, 0xc0de, 0x9a7f];
const perSeed = [];
/* Hoisted above the seed loop so the pooled totals survive each iteration. */
let lastBar = -1, bars = 0;
let modeChanges = 0, keyChanges = 0, waveChanges = 0;
let prev = null, runLen = 0, best = 0, bestWhat = '';
const runs = [];
for (const SEED of SEEDS) {
const w = new World(SEED); w.start();
const d = new MusicDirector(); d.reset(0);
const t = new Transport(); t.start();
for (const [ev, fn] of [
  ['wave:start', (e) => d.onWaveStart(t, e)], ['wave:clear', (e) => d.onWaveClear(t, e)],
  ['boss:telegraph', (e) => d.onBossTelegraph(t, e)], ['boss:phase', (e) => d.onBossPhase(t, e)],
  ['boss:defeat', () => d.onBossDefeat(t)], ['player:hit', () => d.onPlayerHit()],
  ['player:death', () => d.onPlayerDeath(t)], ['player:bomb', () => d.onBomb(t)],
  ['powerup:pickup', (e) => d.onPickup(t, e.kind)], ['powerup:expire', (e) => d.onPickup(t, e.kind)],
  // Fusions move `modeBias`, so a director that does not hear them is not the
  // one the player has. See `MusicDirector.onFusion`.
  ['ability:evolve', () => d.onFusion('evolution')], ['ability:union', () => d.onFusion('union')],
  ['ability:duet', () => d.onFusion('duet')],
]) w.bus.on(ev, fn);

const drive = makeBrain('dodge');
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };

for (let i = 0; i < Math.round(SECS / DT); i++) {
  if (i % 2 === 0) { drive(w, inp); inp.choice = w.choosing ? 0 : -1; }
  w.update(DT, inp); t.advance(DT); d.update(w.snapshot, t, DT);
  const bar = Math.floor(t.bar);
  if (bar === lastBar) continue;
  lastBar = bar; bars++;
  const r = d.readout(t);
  const key = String(r.key);
  /*
   * The wave the SCORE is playing, not the one the GAME is fighting. They are
   * deliberately different — the theme turns at the next phrase line so it
   * lands with the key — and keying this on `snapshot.wave` measured the game
   * clock while claiming to measure the music. It reported 31 eight-bar
   * segments against 15 waves purely because the two clocks are offset.
   */
  /*
   * `d.themeBoss`, not `snapshot.bossActive`. The tune follows a boss flag
   * latched to the phrase line (see `MusicalState.bossTheme`); the snapshot's
   * is live and turns mid-bar. Keying this on the live one counted a theme
   * boundary the score does not play — the same class of mistake as keying it
   * on `snapshot.wave`, recorded in the note just above.
   */
  const now = `${key}|${themeId(d.musicalWave, d.themeBoss)}`;
  if (prev === null) { prev = now; runLen = 1; continue; }
  if (now === prev) { runLen++; }
  else {
    runs.push(runLen);
    if (runLen > best) { best = runLen; bestWhat = prev; }
    const [pk, pw] = prev.split('|');
    const [nk, nw] = now.split('|');
    if (pk !== nk) modeChanges++;
    if (pw !== nw) waveChanges++;
    prev = now; runLen = 1;
  }
}
runs.push(runLen);
if (runLen > best) { best = runLen; bestWhat = prev; }
perSeed.push({ seed: SEED, runs: [...runs], bars, best, bestWhat, modeChanges, waveChanges });
runs.length = 0; prev = null; runLen = 0; best = 0; bestWhat = ''; bars = 0;
modeChanges = 0; waveChanges = 0; lastBar = -1;
}

/* Pool every seed's segments; the gate is about the shape of a run in general. */
for (const p of perSeed) runs.push(...p.runs);
bars = perSeed.reduce((a, p) => a + p.bars, 0);
best = Math.max(...perSeed.map((p) => p.best));
bestWhat = perSeed.find((p) => p.best === best).bestWhat;
modeChanges = perSeed.reduce((a, p) => a + p.modeChanges, 0);
waveChanges = perSeed.reduce((a, p) => a + p.waveChanges, 0);
runs.sort((a, b) => a - b);
const med = runs[runs.length >> 1];
const mean = runs.reduce((a, b) => a + b, 0) / runs.length;

console.log(`\nchurn — ${SEEDS.length} seeds x ${SECS}s, ${bars} bars total\n`);
for (const p of perSeed) {
  const l = p.runs.filter((r) => r >= 16).reduce((a, b) => a + b, 0);
  console.log(`  seed 0x${p.seed.toString(16).padEnd(6)} longest ${String(p.best).padStart(3)}b   >=16b spans ${((100 * l) / p.bars).toFixed(0)}%`);
}
console.log('');
console.log(`  (key, wave) segments: ${runs.length}`);
console.log(`  segment length in bars:  median ${med}   mean ${mean.toFixed(1)}   longest ${best}  (${bestWhat})`);
console.log(`  key/mode changes ${modeChanges}   theme changes ${waveChanges}`);
const hist = new Map();
for (const r of runs) hist.set(r, (hist.get(r) ?? 0) + 1);
console.log('  segment lengths: ' + [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}b x${v}`).join('  '));
console.log(`  a phrase is 8 bars, so a theme needs ${MIN_HOLD_BARS} bars to be stated and restated in one colour`);
console.log('');
if (best < MIN_HOLD_BARS) {
  console.log(`  FAIL  the longest the listener ever gets one tune in one colour is ${best} bars ` +
    `(want >=${MIN_HOLD_BARS}) — nothing can be recognised, however well it is written`);
  process.exit(1);
}
/*
 * SHARE OF BARS IN LEARNABLE MATERIAL, not mean segment length.
 *
 * The mean is the wrong statistic. A run legitimately contains short segments —
 * a boss arrives mid-phrase and takes its own mode with it, a wave clears early
 * — and those drag an average down without saying anything about whether the
 * listener ever gets a tune long enough to learn. What matters is how much of
 * the run is spent inside a span long enough to state a theme AND restate it.
 *
 * 16 bars is two phrases, which is the minimum for that. The bar is set at half
 * the run rather than higher because the other half is doing real work:
 * transitions, boss entries and the deliberate colour changes that stop the
 * score being one loop.
 */
const learnable = runs.filter((r) => r >= 16).reduce((a, b) => a + b, 0);
const share = learnable / bars;
console.log(`  bars inside a >=16-bar span: ${learnable}/${bars} = ${(100 * share).toFixed(0)}%`);
if (share < 0.5) {
  console.log(`  FAIL  only ${(100 * share).toFixed(0)}% of the run is spent on a tune held long enough ` +
    'to be stated and restated in one colour (want >=50%)');
  /*
   * The known cause, so nobody re-derives it: most of the shortfall is BOSS
   * ENTRY. A boss takes harmonicMinor the moment the fight starts rather than
   * waiting for a period boundary — deliberately, because the leitmotif's whole
   * argument is that its mode arrives with the adversary — and that splits
   * whatever period it lands in. Pooled over five seeds there are 39 segments
   * of exactly 8 bars and 51 shorter than that; boss entries and exits account
   * for most of them.
   *
   * The bar stays at 50% rather than moving to meet the 49% reading. A single
   * seed measured 52% and setting the threshold from it was the mistake that
   * made this look solved; setting it from the pooled 49% would be the same
   * mistake in the other direction. Closing the last point needs the short
   * spans dealt with musically, not the number redefined.
   */
  process.exit(1);
}
console.log(`  ok  a tune holds its colour long enough to be heard twice (longest ${best} bars, ` +
  `${(100 * share).toFixed(0)}% of the run in >=16-bar spans)`);
console.log('\n  Before: longest 16 bars, and 17 of 26 segments were exactly 8 — one phrase each,');
console.log('  so no theme was ever stated twice. Three clocks were running independently:');
console.log('  the mode turned per phrase, the theme per wave, and the two never aligned.');
