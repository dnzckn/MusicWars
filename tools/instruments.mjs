/*
 * instruments — does every ability actually change the music?
 *
 * The premise of this project, stated in `events.ts`: "Every one of these is an
 * INSTRUMENT before it is a weapon. That is not flavour text: the mix reads the
 * loadout, so what the player is holding is literally what the band is playing,
 * and a level-up is recruiting a musician rather than incrementing a stat."
 *
 * Nothing checked it. An ability with no audio signature is a musician who
 * turns up and does not play — the level-up still says you recruited someone,
 * and the band sounds identical. That is the same defect class this repo keeps
 * finding (`.pw()` compiling to nothing, `.vibmod()` inert without `.vib()`,
 * `n.hue` hardcoded past a published value): a wire that reads fine and does
 * nothing.
 *
 * THREE LAYERS, and the first version of this tool only looked at one.
 *
 * An ability can reach the score three ways, and checking note content alone
 * reported 29 of 38 abilities as silent — including every instrument in the
 * starting six, which are the most audible things in the game:
 *
 *   1. NOTE CONTENT. The lane builders read `m.powerups.<id>` and write
 *      different notes or controls. Only the nine legacy ids that were
 *      powerups before the progression rewrite do this; their voices predate
 *      it and were kept deliberately.
 *   2. ENSEMBLE LIFT. `ENSEMBLE_MIX` in orchestration.ts maps an ability to the
 *      stem it belongs to, and the director raises that lane's LEVEL. This is
 *      how "recruiting a cellist" is meant to be heard, and it is invisible to
 *      a note-content diff because the notes are identical and the fader moved.
 *   3. SFX. `sfx.ts` gives an instrument a one-shot voice when it fires.
 *   4. DIRECTOR. Some abilities name something the director owns outright —
 *      CAPO moves the key, UP-TEMPO moves the tempo — so they change the score
 *      without touching a lane builder or a fader. Driven and compared here
 *      through a real `MusicDirector`, because a claim that an ability changes
 *      the key is only worth anything if the readout actually says so.
 *
 * An ability reached by NONE of the three is a musician who turns up and does
 * not play. `orchestration.ts` says some fusions are unmapped on purpose —
 * "dramatic on screen without implying a new voice" — so being absent from
 * ENSEMBLE_MIX alone is not a defect; being absent from all three is.
 *
 */
import { readFileSync } from 'node:fs';
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');
const { ALL_ABILITY_IDS } = await import('../src/game/weapons.ts');

const LANES = [
  ['sub', L.buildSub], ['motor', L.buildMotor], ['bass', L.buildBass],
  ['chords', L.buildChords], ['arp', L.buildArp], ['lead', L.buildLead],
  ['power', L.buildPowerupVoices], ['motifs', L.buildMotifs],
];

function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  return {
    tension: 0.6, immediate: 0.5, section: 'sustain', buildProgress: 1, fillBar: false,
    bar: 0, tonic: 57, mode, chord: buildChord(57, mode, 0), nextChord: buildChord(57, mode, 4),
    chordIndex: 0, barInPhrase: over.barInPhrase ?? 0, phrase: 2, feel: 'boomchick', bpm: 140,
    intensity: 0.6, brightness: 0.5, powerups: {}, enemies: {}, boss: false, bossPhase: 0,
    wave: 1, bombs: 0, health: 1, grazeRate: 0, combo: 0, leadRegister: 0, movement: null,
    sig: makeSignals(strudel), ...over,
  };
}

/** Every event, flattened to a comparable string. */
function fingerprint(build, powerups) {
  const out = [];
  for (const mode of Object.keys(PROGRESSIONS)) {
    for (let b = 0; b < 8; b++) {
      let evs;
      try { evs = build(state({ mode, barInPhrase: b, powerups })).queryArc(0, 1); }
      catch (err) { return `THREW: ${err.message}`; }
      for (const e of evs) {
        const v = e.value || {};
        out.push(`${(+e.part.begin).toFixed(4)}|${(+e.part.end).toFixed(4)}|` +
          Object.keys(v).sort().map((k) => `${k}=${typeof v[k] === 'number' ? v[k].toFixed(4) : v[k]}`).join(','));
      }
    }
  }
  return out.join(';');
}

const { ENSEMBLE_MIX } = await import('../src/audio/orchestration.ts');
const { MusicDirector } = await import('../src/audio/director.ts');
const { Transport } = await import('../src/core/transport.ts');
const { World } = await import('../src/game/world.ts');

/*
 * THE SNAPSHOT COMES FROM A REAL WORLD, and the first version hand-wrote one.
 *
 * `GameSnapshot` has around thirty numeric fields — `threatsVeryNear`,
 * `timeToContact`, `enemyThreat`, `playerMaxHp` and so on. A literal with the
 * dozen obvious ones leaves the rest `undefined`, and undefined in arithmetic
 * is NaN: driven that way the director produced NaN levels for `sub`, `kick`
 * and `bass`. They print as `null` through JSON, which is how it went unnoticed
 * — it looks like a missing key rather than a broken number.
 *
 * This is the mistake `lib/driver.mjs` exists to prevent, in its own words: a
 * hand-written input shape whose "numbers described nothing".
 *
 * There are two correct fixes and no third. `emptySnapshot()` in
 * `src/core/events.ts` is the canonical complete constructor — it is what
 * `World` itself initialises from, and what `tools/session.mjs` uses. A real
 * `World` spun for a moment is the other, and it is chosen here because the
 * question is whether an ability changes a REAL mix: an empty snapshot has no
 * enemies and no threat, so half the stems sit at zero and an ability that
 * lifts one of them would look inert. Either way, never a literal.
 */
const probeWorld = new World(0x51ed);
probeWorld.start();
for (let i = 0; i < 60 * 8; i++) {
  probeWorld.update(1 / 120, { x: 0.2, y: 0.1, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false });
}
const REAL_SNAP = probeWorld.snapshot;

/** Key and tempo after a few seconds of the director holding `abilities`. */
function directorFingerprint(abilities) {
  const d = new MusicDirector(); d.reset(0);
  const t = new Transport(); t.start();
  /*
   * `onWaveStart` is what sets the director's `started` flag, and `update()`
   * early-returns without it. Omitting it made this route report 0 for every
   * ability — a harness measuring an object that was never switched on, which
   * would have read as "capo does nothing" when capo was wired correctly.
   */
  d.onWaveStart(t, { index: 6, difficulty: 0.5 });
  const snap = { ...REAL_SNAP, abilities, powerups: {} };
  for (let i = 0; i < 60 * 20; i++) { t.advance(1 / 60); d.update(snap, t, 1 / 60); }
  const r = d.readout(t);
  /*
   * Key and tempo are not enough. REVERB, RESONANCE and FERMATA move SIGNALS
   * (`p.space`, `p.ring`, `p.hold`) and COMPRESSOR moves the level set, none of
   * which show up in a key/bpm comparison — so a fingerprint of those two
   * reported all four as silent after they had been wired correctly. Include
   * the whole mix state. `p` is `private` in TypeScript, which is erased at
   * runtime and does not stop this reading it.
   */
  /*
   * Assert finiteness rather than serialising it away. `JSON.stringify` turns
   * NaN into `null`, so a broken level reads as a missing key and a diff
   * between two broken states still looks like a difference — the tool would
   * report an ability as audible on the strength of one NaN differing from
   * another. Fail loudly instead.
   */
  for (const [k, v] of Object.entries(r.levels)) {
    if (!Number.isFinite(v)) throw new Error(`non-finite level "${k}" = ${v} — the director was driven with a bad snapshot`);
  }
  return JSON.stringify({ key: r.key, bpm: r.bpm, p: d.p, levels: r.levels });
}
const dirBase = directorFingerprint({});

/*
 * EXISTENCE IS NOT AUDIBILITY. An ability that moves a fader by 0.001 passes a
 * difference test and cannot be heard, which is the same trap as a threshold
 * that sits outside its signal's range. So the biggest single level change is
 * measured too, and reported beside the routes.
 *
 * Only the LIFT route is judged on it. Note-content and director abilities
 * change what is played rather than how loud a stem is, so a level delta is
 * the wrong meter for them — CAPO transposes the whole score and moves no
 * fader at all.
 */
const MIN_LIFT = 0.02;
function peakLevelDelta(abilities) {
  const d = new MusicDirector(); d.reset(0);
  const t = new Transport(); t.start();
  d.onWaveStart(t, { index: 6, difficulty: 0.5 });
  const snap = { ...REAL_SNAP, abilities, powerups: {} };
  for (let i = 0; i < 60 * 20; i++) { t.advance(1 / 60); d.update(snap, t, 1 / 60); }
  return d.readout(t).levels;
}
const lvlBase = peakLevelDelta({});
const sfxSrc = readFileSync(new URL('../src/audio/sfx.ts', import.meta.url), 'utf8');
const SFX_IDS = new Set([...sfxSrc.matchAll(/^\s{2}([a-z]+):\s*\{/gm)].map((m) => m[1]));

/** Same as `fingerprint`, but varying the SIGNALS rather than the loadout. */
function fingerprintWithSig(build, sigOverrides) {
  const out = [];
  for (const mode of Object.keys(PROGRESSIONS)) {
    for (let b = 0; b < 8; b++) {
      let evs;
      try {
        evs = build(state({ mode, barInPhrase: b, sig: makeSignals(strudel, sigOverrides) })).queryArc(0, 1);
      } catch (err) { return `THREW: ${err.message}`; }
      for (const e of evs) {
        const v = e.value || {};
        out.push(Object.keys(v).sort().map((k) => `${k}=${typeof v[k] === 'number' ? v[k].toFixed(4) : v[k]}`).join(','));
      }
    }
  }
  return out.join(';');
}

const baseline = new Map(LANES.map(([n, b]) => [n, fingerprint(b, {})]));
const rows = [];
for (const id of ALL_ABILITY_IDS) {
  const moved = [];
  for (const [n, b] of LANES) {
    /*
     * Level 3, not 1. Several signatures gate on level — a stacked DRONES adds
     * satellites, a third NOVA widens the voicing — and a check at level 1
     * would miss an ability whose first level is deliberately subtle.
     */
    if (fingerprint(b, { [id]: 3 }) !== baseline.get(n)) moved.push(n);
  }
  let dir = false;
  try { dir = directorFingerprint({ [id]: 3 }) !== dirBase; } catch { dir = false; }
  const lv = peakLevelDelta({ [id]: 3 });
  let peak = 0;
  for (const k of Object.keys(lvlBase)) peak = Math.max(peak, Math.abs((lv[k] ?? 0) - (lvlBase[k] ?? 0)));
  rows.push([id, moved, ENSEMBLE_MIX[id] ?? null, SFX_IDS.has(id), dir, peak]);
}

/*
 * A SIGNAL THAT NOTHING READS IS THE SAME BUG AS AN ABILITY THAT MAKES NO
 * SOUND, one layer down.
 *
 * The director setting `p.space` proves the ability is wired to a signal. It
 * does not prove any lane reads that signal — and this repo has been bitten
 * repeatedly by exactly that (`.pw()` undeclared and compiling to nothing,
 * `.vibmod()` inert without `.vib()`). So each new signal is driven from 0 to 1
 * through `makeSignals` overrides and the lanes are diffed.
 */
const SIGNALS = ['space', 'ring', 'hold'];
const sigFails = [];
console.log('\nsignal wiring — does any lane read each rig signal?');
for (const name of SIGNALS) {
  const moved = [];
  for (const [n, b] of LANES) {
    const off = fingerprintWithSig(b, { [name]: 0 });
    const on = fingerprintWithSig(b, { [name]: 1 });
    if (off !== on) moved.push(n);
  }
  console.log(`  ${name.padEnd(8)} ${moved.length ? moved.join(', ') : '— NO LANE READS IT —'}`);
  if (!moved.length) sigFails.push(`signal "${name}" is set by the director and read by no lane — it is an inert control`);
}

/*
 * THE IDS THIS TOOL COULD NOT SEE.
 *
 * Everything above iterates `ALL_ABILITY_IDS`, which is every ability that
 * exists in source — and a DUET or a generic UNION does not. Its id is built
 * while the run is going (`pizzicato+snare`), so the most it could ever be is
 * absent from a list this tool reads, and absent read as fine: the summary
 * said "38/38 audible" the whole time every fusion in the game was silent to
 * the ensemble.
 *
 * That was not a small silence. `ENSEMBLE_MIX` is keyed by id, so an unmapped
 * fusion lifted no lane and counted as no musician — measured,
 * `{pizzicato: 8, snare: 8}` was a band of two lifting the arp and the clap
 * and the duet they make was a band of ZERO lifting nothing. Combining is the
 * biggest reward in the game and it made the score thinner.
 *
 * So the sample is built the way the game builds them, and it is a SAMPLE with
 * a stated shape rather than a token pair: every authored evolution paired
 * with every other (the union tier), plus the base pairs, which is the whole
 * space `abilityStems` has to answer for.
 */
const { ensembleLift, ensembleSize } = await import('../src/audio/orchestration.ts');
const { duetId, INSTRUMENTS } = await import('../src/game/weapons.ts');
const STEMS = ['kick', 'clap', 'sub', 'arp', 'chords', 'lead', 'fx', 'motifs'];
const baseIds = INSTRUMENTS.filter((d) => !d.fused).map((d) => d.id);
const evoIds = INSTRUMENTS.filter((d) => d.fused).map((d) => d.id);
const synth = [];
const pairUp = (list, kind) => {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) synth.push([duetId(list[i], list[j]), kind]);
  }
};
pairUp(baseIds, 'duet');
pairUp(evoIds, 'union');
const mute = [];
for (const [id, kind] of synth) {
  const ab = { [id]: 3 };
  const lifted = STEMS.filter((st) => ensembleLift(ab, st) > 0);
  if (!lifted.length || ensembleSize(ab) === 0) mute.push(`${kind} ${id}`);
}
/*
 * DOES THE REBUILD KEY NOTICE THE LOADOUT?
 *
 * `structureKey` decides WHEN the score is rebuilt, and a cache key is only
 * correct if it names everything the built thing depends on. Abilities were
 * absent from it for a long time while every pattern above read them — nothing
 * was permanently silent, because enemy counts churn constantly and any
 * rebuild picks up the new loadout, but that is luck. Measured, it cost a
 * worst case of 4.98 bars (nine seconds at 128bpm) between taking a card and
 * hearing it, against 1.00 bar once the field was added.
 *
 * This is the contract, stated as a test: change what the player holds, and
 * the key must move. It is deliberately not a check that the SOUND changed —
 * `instruments.mjs` already proves that above — but that the engine will
 * NOTICE, which is a different failure and was the one nothing watched.
 */
function keyFor(abilities) {
  const d = new MusicDirector(); d.reset(0);
  const t = new Transport(); t.start();
  d.onWaveStart(t, { index: 6, difficulty: 0.5 });
  const snap = { ...REAL_SNAP, abilities, powerups: {} };
  for (let i = 0; i < 60 * 20; i++) { t.advance(1 / 60); d.update(snap, t, 1 / 60); }
  return d.lastKey;
}
const emptyKey = keyFor({});
const keyBlind = [];
for (const id of ALL_ABILITY_IDS) {
  if (keyFor({ [id]: 3 }) === emptyKey) keyBlind.push(id);
}
// A level change must move it too — several signatures gate on level, not presence.
const levelBlind = [];
for (const id of ALL_ABILITY_IDS.slice(0, 8)) {
  if (keyFor({ [id]: 1 }) === keyFor({ [id]: 3 })) levelBlind.push(id);
}
console.log(`\nrebuild key — does it notice the loadout?`);
console.log(`  abilities invisible to the key: ${keyBlind.length}${keyBlind.length ? ' (' + keyBlind.slice(0, 6).join(', ') + ')' : ''}`);
console.log(`  levels invisible to the key:    ${levelBlind.length}${levelBlind.length ? ' (' + levelBlind.join(', ') + ')' : ''}`);

console.log(`\nsynthesised ids — ${synth.length} runtime fusions (${baseIds.length} base, ${evoIds.length} evolved)`);
console.log(`  silent to the ensemble: ${mute.length}`);
for (const m of mute.slice(0, 5)) console.log(`    ${m}`);
if (mute.length > 5) console.log(`    ...and ${mute.length - 5} more`);

console.log(`\ninstruments — ${ALL_ABILITY_IDS.length} abilities, four routes into the score\n`);
console.log(`  ${'ability'.padEnd(14)} ${'notes'.padEnd(22)} ${'lifts'.padEnd(8)} ${'sfx'.padEnd(4)} ${'dir'.padEnd(4)} peak dLevel`);
console.log(`  ${'-'.repeat(14)} ${'-'.repeat(22)} ${'-'.repeat(8)} ${'-'.repeat(4)} ${'-'.repeat(4)} -----------`);
const silent = rows.filter(([, moved, lift, sfx, dir]) => !moved.length && !lift && !sfx && !dir);
for (const [id, moved, lift, sfx, dir, peak] of rows) {
  const mark = !moved.length && !lift && !sfx && !dir ? '   <- SILENT' : '';
  console.log(`  ${id.padEnd(14)} ${(moved.join(',') || '-').padEnd(22)} ${(lift ?? '-').padEnd(8)} ${(sfx ? 'yes' : '-').padEnd(4)} ${(dir ? 'yes' : '-').padEnd(4)} ${peak.toFixed(3).padStart(11)}${mark}`);
}
const byNote = rows.filter((r) => r[1].length).length;
const byLift = rows.filter((r) => r[2]).length;
const bySfx = rows.filter((r) => r[3]).length;
const byDir = rows.filter((r) => r[4]).length;
console.log(`\n  reached by note content: ${byNote}   by ensemble lift: ${byLift}   by sfx: ${bySfx}   by director: ${byDir}`);
console.log(`  audible by at least one route: ${rows.length - silent.length}/${rows.length}`);
console.log('');
const faint = rows.filter(([, , lift, , , peak]) => lift && peak < MIN_LIFT);
for (const [id, , lift, , , peak] of faint) {
  sigFails.push(`"${id}" lifts ${lift} by only ${peak.toFixed(4)} (min ${MIN_LIFT}) — the fader moves and nobody hears it`);
}
if (keyBlind.length || levelBlind.length) {
  sigFails.push(`the rebuild key does not notice ${keyBlind.length} abilities and ${levelBlind.length} level changes — ` +
    'the score will not rebuild when the player takes a card (see `structureKey`)');
}
if (mute.length) {
  sigFails.push(`${mute.length} of ${synth.length} runtime fusions lift no lane and count as no musician — ` +
    'combining makes the band SMALLER (see `abilityStems`)');
}
for (const m of sigFails) console.log(`  FAIL  ${m}`);
if (silent.length || sigFails.length) {
  for (const [id] of silent) {
    console.log(`  FAIL  "${id}" reaches the score by no route at all — the level-up says you recruited a musician, and the band sounds identical`);
  }
  process.exit(1);
}
console.log(`  ok  every ability reaches the score somehow, including all ${synth.length} runtime fusions`);
