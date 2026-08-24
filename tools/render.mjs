/*
 * render — write the score to a WAV file, with no browser and no Web Audio.
 *
 * WHY. Every check in this directory proves the music is CORRECT. Not one of
 * them proves it is any good, and nobody has heard a note of it: Chromium
 * wedges on this machine, so `smoke` and `audiocheck` have not run in a day and
 * the only listener who matters has had nothing to listen to.
 *
 * This closes that. It drives the real `MusicDirector`, queries the assembled
 * master pattern, synthesises the events directly into a buffer and writes a
 * WAV. The composition — the tune, the harmony, the bass, the groove, the
 * arrangement moving between sections — all of it is decided before the audio
 * graph exists, so all of it survives the trip.
 *
 * WHAT IT IS NOT, and this matters before anyone judges the score by it:
 *
 *   - **The oscillators are the real shapes but not superdough's code.** Its
 *     `pulse` worklet, its filter topology and its envelope curves are its own;
 *     this reimplements the same maths simply.
 *   - **No reverb, no delay, no echo.** The score leans on a tempo-synced
 *     3/16 delay on the melody and room on nearly everything, and the SPC700
 *     echo unit is half of why the reference canon sounds the way it does. This
 *     will sound drier and smaller than the game.
 *   - **One-pole filters** rather than the real resonant ladder, so the timbre
 *     is in the right family and not identical.
 *
 * So: judge the WRITING from this — the tune, whether it goes anywhere, whether
 * the parts get in each other's way. Do not judge the SOUND. If the melody is
 * dull here it is dull in the game; if it is thin here it may only be thin
 * here.
 */
/*
 * RENDER_STATE=live renders a real playthrough rather than a frozen snapshot.
 *
 * The snapshot presets (`calm`, `wave`, `boss`) each pin one point of the
 * energy distribution and are the right tool for judging the writing and the
 * spectral balance. They cannot show the arrangement MOVING, because nothing
 * moves while they record.
 *
 * Measured difference, 32 bars: the static `wave` preset has a p10-p90
 * loudness range of 3.6dB; `live` has 12.9dB over the same span. Same music,
 * same synthesis — the only difference is that the game is running.
 *
 *   RENDER_STATE=live RENDER_OUT=renders/live.wav node tools/render.mjs 32
 *
 * THIS TOOL IS NOT DETERMINISTIC. The director makes random choices, so the
 * same command run three times gave peaks of 0.408, 0.421 and 0.414 — about
 * +-2%. Do not read a small change in `measured peak` between runs as a
 * regression, and do not quote it to three significant figures. Differences
 * worth acting on are the ones that survive a re-run, and the distribution
 * measurements in `npm run realprobe` are the better instrument for anything
 * where a couple of percent matters.
 */
import { writeFileSync } from 'node:fs';
import { makeSignals } from './lib/headless-audio.mjs';

const { MusicDirector } = await import('../src/audio/director.ts');
const { Transport } = await import('../src/core/transport.ts');
const { emptySnapshot } = await import('../src/core/events.ts');
const { World } = await import('../src/game/world.ts');

void makeSignals; // the director builds its own; imported for loader parity

const SR = 44100;
const BARS = Number(process.env.RENDER_BARS ?? process.argv[2] ?? 32);
/*
 * `renders/`, not `dist/` — because `vite build` empties `dist/`.
 *
 * Renders written there are deleted by the next build, which is how a set of
 * WAVs vanished between being measured and being copied. Audio output is not a
 * build artifact; it is evidence about one.
 */
const OUT = process.env.RENDER_OUT ?? process.argv[3] ?? 'renders/musicwars-score.wav';
/*
 * Warm-up before recording — and six seconds was catastrophically too short.
 *
 * The intro is EIGHT BARS with staged entry: chords and fx at bar 1, lead at 2,
 * the motor at 5, kick at 6, bass at 7. Six seconds is about three and a half
 * bars at these tempi, so the render captured the arrangement before its
 * rhythm section existed — `bass:0.00 kick:0.00 hats:0.00` — and every
 * spectrum measurement taken from it described a pad and a melody alone.
 *
 * It produced a confident, dramatic and completely wrong finding: 6% of energy
 * below 250Hz, read as the refactor having gutted the low end, and I came
 * within one measurement of retuning the bass on it.
 *
 * Thirty seconds clears the intro, the first build and into a drop, so the
 * recording starts on a full arrangement. The section and levels are printed
 * below for exactly this reason — a render of the wrong state should be
 * visible in its own output rather than inferred three tools later.
 */
const LEAD_IN_SECONDS = Number(process.env.RENDER_LEAD_IN ?? 30);

/* ------------------------------------------------------------------ synth */

const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * One sample of an oscillator. Naive shapes — no band-limiting — because the
 * point is to hear the writing, and an alias at 12kHz does not change whether
 * a tune is memorable.
 */
function osc(kind, phase, pw) {
  const t = phase % 1;
  switch (kind) {
    case 'sine':
      return Math.sin(2 * Math.PI * t);
    case 'triangle':
      return 4 * Math.abs(t - 0.5) - 1;
    case 'sawtooth':
      return 2 * t - 1;
    case 'pulse': {
      // superdough maps duty as (1 - pw) / 2 — the mapping documented in
      // `strudel.d.ts`, and getting it backwards would make every harmony lane
      // the wrong timbre.
      const duty = (1 - (pw ?? 0)) / 2;
      return t < duty ? 1 : -1;
    }
    case 'square':
      return t < 0.5 ? 1 : -1;
    case 'white':
      return Math.random() * 2 - 1;
    default:
      return Math.sin(2 * Math.PI * t);
  }
}

/** Linear ADSR over a note of `dur` seconds, plus its release tail. */
function envAt(tt, dur, a, d, s, r) {
  if (tt < 0) return 0;
  if (tt < a) return a > 0 ? tt / a : 1;
  if (tt < a + d) return d > 0 ? 1 - (1 - s) * ((tt - a) / d) : s;
  if (tt < dur) return s;
  const rt = tt - dur;
  return rt < r ? s * (1 - rt / r) : 0;
}

/* ------------------------------------------------------------- the score */

const director = new MusicDirector();
director.reset(0);
const transport = new Transport();
transport.start();

/*
 * Which moment to record. The score is a function of game state, so "render the
 * music" is not a well-formed request until you say WHICH music — and the boss
 * arrangement is a different piece: harmonic minor rather than the ladder, ten
 * BPM slower, the leitmotif in the foreground with the accompaniment cleared
 * out from under it.
 */
const STATE = process.env.RENDER_STATE ?? 'wave';
/*
 * Presets are pinned to MEASURED points of the real game's energy
 * distribution, not to numbers that sounded plausible.
 *
 * This mattered more than it looks. The previous snapshot set `playerMaxHp:
 * 100` and `playerHp: 78` — but the real player has three hearts and three
 * lives (`game/player.ts`), so `fragility` was computed on a scale the game
 * does not use and capped around 0.14 instead of reaching 0.75. None of the
 * bullet, impact or kill-rate fields were set at all, so four of the eight
 * tension terms sat at zero. The render was therefore recording a mix the game
 * cannot produce, and every spectral figure taken from it — including the
 * headline "22.8% below 250Hz" — described that mix rather than the game's.
 *
 * `npm run realprobe` reports the distribution; these are its p10, p50 and the
 * boss case. `wave` is now the median mix, so a render is representative by
 * construction rather than by hope.
 */
const PRESETS = {
  // p50 of a real run: energy about 0.62. This is the ordinary sound.
  wave: {
    wave: 6, enemyCount: 8, enemies: { pluck: 4, rush: 3, stutter: 1 },
    enemyThreat: 0.71, nearestThreat: 0.45, encirclement: 0.3,
    playerHp: 2, lives: 1, bulletCount: 2, bulletsNear: 0, bulletsVeryNear: 0,
    timeToImpact: 0.48, killRate: 0.85, combo: 60, timeSinceHit: 12,
    bossActive: false, bossPhase: 0, movement: null,
  },
  /*
   * p10 of a real run: energy about 0.36. The quiet end, which only exists
   * since the `progressFloor` retune — energy used to bottom out at 0.465.
   *
   * The wave number and the `enemies` ROSTER are deliberately identical to
   * `wave` above, and only the danger fields differ. `enemies` feeds the
   * orchestration allocator while `enemyCount` feeds the tension model, and
   * they are separate inputs; a first version of this preset changed both at
   * once and came out LOUDER than `wave`, because a smaller roster frees stem
   * budget. Holding the roster fixed is what makes this a comparison of energy
   * rather than a comparison of two unrelated things.
   */
  calm: {
    wave: 6, enemyCount: 2, enemies: { pluck: 4, rush: 3, stutter: 1 },
    enemyThreat: 0.15, nearestThreat: 0.9, encirclement: 0.05,
    playerHp: 3, lives: 3, bulletCount: 0, bulletsNear: 0, bulletsVeryNear: 0,
    timeToImpact: 1.4, killRate: 0.1, combo: 4, timeSinceHit: 40,
    bossActive: false, bossPhase: 0, movement: null,
  },
  boss: {
    wave: 10, enemyCount: 4, enemies: { conductor: 1, rush: 3 },
    enemyThreat: 0.95, nearestThreat: 0.3, encirclement: 0.45,
    playerHp: 1, lives: 1, bulletCount: 26, bulletsNear: 1, bulletsVeryNear: 0,
    timeToImpact: 0.3, killRate: 2.0, combo: 60, timeSinceHit: 6,
    bossActive: true, bossPhase: 0.7, bossHp: 0.5, bossPhases: 3, movement: 'elite',
  },
};
/*
 * `live` is not a snapshot, so it has no preset of its own — it starts from
 * `wave` and then lets the real game take over. Listed here so the error
 * message below names it.
 */
const LIVE = STATE === 'live';
const preset = LIVE ? PRESETS.wave : PRESETS[STATE];
if (!preset) throw new Error(`unknown RENDER_STATE '${STATE}' — try ${[...Object.keys(PRESETS), 'live'].join(' or ')}`);

const snap = emptySnapshot();
Object.assign(snap, {
  wave: 6,
  waveProgress: 0.5,
  enemyCount: 9,
  enemies: { pluck: 4, rush: 3, stutter: 2 },
  enemyThreat: 0.55,
  enemyFireRate: 0.35,
  nearestThreat: 0.45,
  encirclement: 0.3,
  playerFiring: true,
  // The real scale: three hearts, three lives — see the note on PRESETS.
  playerMaxHp: 3,
  playerHp: 2,
  lives: 1,
  maxLives: 3,
  bombs: 1,
  // A four-piece band, so the ensemble system is audibly doing something.
  // RENDER_BAND=solo strips the band to the one instrument the real game
  // starts you with, so a render can isolate ensemble size from everything
  // else. Same section, same key, same danger — only the band differs.
  abilities: process.env.RENDER_BAND === 'solo' ? { pizzicato: 1 } : { pizzicato: 5, snare: 3, bow: 3, chime: 2 },
  powerups: {},
});
Object.assign(snap, preset);
director.onWaveStart(transport, { index: preset.wave, boss: preset.bossActive });
if (preset.bossActive) {
  // The boss groove is set by `onBossTelegraph`, not by `onWaveStart` — which
  // hardcodes `false`. A boss render that skipped this would play the ordinary
  // feel over the boss harmony and look like the leitmotif not working.
  director.onBossTelegraph(transport, { id: 'render', phases: 3, etaSeconds: 4 });
}

/*
 * The live world, wired to the director exactly as `main.ts` wires it.
 *
 * Only built for `live`. Subscribing the same ten bus events matters as much
 * as the snapshot does: the mode change on a new wave, the breakdown on a
 * clean clear and the boss groove all arrive through handlers, not through
 * `snapshot`, so a render that skipped them would record an arrangement with
 * no structure in it.
 */
/*
 * An EXPLICIT SEED, and the second argument is gone because it never existed.
 *
 * This said `new World(960, 540)`, which reads like a playfield size and is
 * not one: `World`'s constructor takes `(seed = Date.now() & 0xffffffff)` and
 * nothing else — `width` and `height` are fixed constants. So this passed a
 * SEED of 960 and silently discarded 540. It happened to be harmless because
 * a constant is still reproducible, but it was reproducible by accident, and
 * the moment anyone "fixed" the apparent size argument the seed would have
 * moved with it.
 *
 * Verified reproducible: the same seed gives an identical state hash across
 * separate processes at both 120s and 300s of simulation, and different seeds
 * diverge (wave 7 / 9 / 10 at 300s). `0x51ed` is what `wiring` and the
 * `deadhunt` tools already use, so measurements can be compared across tools.
 */
const SEED = 0x51ed;
const world = LIVE ? new World(SEED) : null;
if (world) {
  world.start();
  const bus = world.bus;
  bus.on('wave:start', (e) => director.onWaveStart(transport, e));
  bus.on('wave:clear', (e) => director.onWaveClear(transport, e));
  bus.on('boss:telegraph', (e) => director.onBossTelegraph(transport, e));
  bus.on('boss:phase', (e) => director.onBossPhase(transport, e));
  bus.on('boss:defeat', () => director.onBossDefeat(transport));
  bus.on('player:hit', () => director.onPlayerHit());
  bus.on('player:death', () => director.onPlayerDeath(transport));
  bus.on('player:bomb', () => director.onBomb(transport));
  bus.on('powerup:pickup', (e) => director.onPickup(transport, e.kind));
  bus.on('powerup:expire', (e) => director.onPickup(transport, e.kind));
}

// Let the arrangement settle before the recording starts.
for (let i = 0; i < 60 * LEAD_IN_SECONDS; i++) {
  if (world) {
    world.update(1 / 60, {
      x: Math.sin(i * (1 / 60) * 3.0) * 0.35,
      y: Math.cos(i * (1 / 60) * 2.3) * 0.25,
      shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false,
    });
    transport.advance(1 / 60);
    director.update(world.snapshot, transport, 1 / 60);
  } else {
    transport.advance(1 / 60);
    director.update(snap, transport, 1 / 60);
  }
}

const warm = director.readout(transport);
const bpm = warm.bpm;
const playing = Object.entries(warm.levels)
  .filter(([, v]) => v > 0.05)
  .map(([k, v]) => `${k}:${v.toFixed(2)}`);
const secPerBar = (60 / bpm) * 4;

/*
 * Events are resolved to ABSOLUTE SECONDS before synthesis, which is what lets
 * `RENDER_STATE=live` exist.
 *
 * Every other preset freezes one snapshot, warms up, and queries the whole run
 * out of a single pattern at a single tempo. That is the right tool for judging
 * the writing, and it is useless for judging the thing this project has spent
 * days on: whether the arrangement MOVES. A static render cannot show a stem
 * fading in, a section changing, or the tempo tracking the game, because none
 * of those happen while it is being recorded.
 *
 * In live mode the real `World` runs during the render and the master pattern
 * is re-queried each bar, so a rebuild mid-run is captured rather than missed.
 * Tempo is read per bar too — `secPerBar` is not a constant once the director
 * is allowed to change it, and treating it as one would smear every bar after
 * the first tempo change.
 */
const timed = [];
if (LIVE) {
  const DT = 1 / 120;
  /*
   * The live bot MOVES. A parked one dies around wave 9.
   *
   * This held the stick at zero, which `World` now treats as not playing:
   * `campPressure` ramps, bullets speed up, the rescue mechanics switch off.
   * The consequence was silent and badly misleading — a render with a long
   * lead-in spent most of its length in `collapse`, measuring at -40dB, and a
   * spectral comparison built on it produced a completely false finding about
   * the early mix being bass-heavy relative to the late one. Same policy as
   * `realprobe` and `wiring`; this was the third tool and the one I missed.
   */
  const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
  const steer = (n) => {
    inp.x = Math.sin(n * DT * 3.0) * 0.35;
    inp.y = Math.cos(n * DT * 2.3) * 0.25;
  };
  const startBar = Math.floor(transport.bar) + 1;
  const warmSteps = Math.round(60 * LEAD_IN_SECONDS);
  let sec = 0;
  for (let i = 0; i < BARS; i++) {
    const target = startBar + i;
    let guard = 0;
    while (Math.floor(transport.bar) < target && guard++ < 100000) {
      steer(warmSteps + guard);
      world.update(DT, inp);
      transport.advance(DT);
      director.update(world.snapshot, transport, DT);
    }
    const spb = (60 / director.readout(transport).bpm) * 4;
    for (const h of director.masterPattern().queryArc(target, target + 1)) {
      const b = Number(h.whole?.begin ?? h.part.begin);
      const e = Number(h.whole?.end ?? h.part.end);
      if (!Number.isFinite(b)) continue;
      timed.push({ v: h.value ?? {}, t0: sec + (b - target) * spb, dur: Math.max(0.02, (e - b) * spb) });
    }
    sec += spb;
  }
} else {
  for (const h of director.masterPattern().queryArc(0, BARS)) {
    const b = Number(h.whole?.begin ?? h.part.begin);
    const e = Number(h.whole?.end ?? h.part.end);
    if (!Number.isFinite(b)) continue;
    timed.push({ v: h.value ?? {}, t0: b * secPerBar, dur: Math.max(0.02, (e - b) * secPerBar) });
  }
}
/*
 * Allocated AFTER the events, because in live mode the length is not known
 * until the tempo has been read bar by bar — the director changes it during
 * the run, so `BARS * secPerBar` is only correct for a frozen snapshot.
 */
const spanSec = timed.reduce((m, e) => Math.max(m, e.t0 + e.dur), 0);
const total = Math.ceil(Math.max(spanSec, BARS * secPerBar) * SR) + SR; // +1s for tails
const left = new Float32Array(total);
const right = new Float32Array(total);
let voices = 0;

for (const ev of timed) {
  const v = ev.v;

  const note = typeof v.note === 'number' ? v.note : Number(v.note);
  const kind = typeof v.s === 'string' ? v.s : 'sine';
  const pitched = Number.isFinite(note);
  if (!pitched && kind !== 'white') continue;

  /*
   * The gain curve, applied by hand. superdough runs `setGainCurve(x => x*x)`,
   * so every gain-like control is squared before it reaches a node — the same
   * correction `session`'s headroom check needs, and forgetting it here would
   * make the render four times too loud and clip.
   */
  const g = Math.pow(typeof v.gain === 'number' ? v.gain : 1, 2)
    * Math.pow(typeof v.postgain === 'number' ? v.postgain : 1, 2)
    * (typeof v.velocity === 'number' ? v.velocity : 1);
  if (!(g > 0.0001)) continue;

  const num = (x, dflt) => {
    const n = typeof x === 'number' ? x : Number(x);
    return Number.isFinite(n) ? n : dflt;
  };
  const a = num(v.attack, 0.005);
  const d = num(v.decay, 0.1);
  const s = num(v.sustain, 0);
  const r = num(v.release, 0.08);

  const t0 = ev.t0;
  const dur = ev.dur;
  const life = dur + r + 0.01;
  const i0 = Math.floor(t0 * SR);
  const n = Math.min(Math.ceil(life * SR), total - i0 - 1);
  if (i0 < 0 || n <= 0) continue;
  voices++;

  const hz = pitched ? midiToHz(note) : 0;
  const pan = Math.min(1, Math.max(0, num(v.pan, 0.5)));
  // Equal-power pan, so a fanned chord does not lose level in the middle.
  const gl = Math.cos(pan * Math.PI / 2) * g;
  const gr = Math.sin(pan * Math.PI / 2) * g;

  // One-pole low-pass, standing in for the real ladder.
  const cutoff = num(v.cutoff, 12000);
  const k = Math.min(1, (2 * Math.PI * cutoff) / SR);
  let lp = 0;
  let phase = 0;
  const inc = hz / SR;
  const vibHz = num(v.vib, 0);
  const vibDepth = num(v.vibmod, 0);

  for (let j = 0; j < n; j++) {
    const tt = j / SR;
    const e = envAt(tt, dur, a, d, s, r);
    if (e <= 0 && tt > dur) break;
    // Vibrato, in semitones, the way `getVibratoOscillator` applies it.
    const bend = vibHz > 0 ? Math.pow(2, (vibDepth * Math.sin(2 * Math.PI * vibHz * tt)) / 12) : 1;
    phase += inc * bend;
    const raw = osc(kind, phase, num(v.pw, 0));
    lp += k * (raw - lp);
    const smp = lp * e;
    left[i0 + j] += smp * gl;
    right[i0 + j] += smp * gr;
  }
}

/* --------------------------------------------------------------- output */

// Master trim, matching `volume.ts`'s 0.75 default after its curve.
let peak = 0;
for (let i = 0; i < total; i++) {
  left[i] *= 0.75;
  right[i] *= 0.75;
  peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
/*
 * Normalised for listening, with the true peak reported instead.
 *
 * The first version scaled only if it would clip, to avoid hiding the headroom
 * work — and produced a file peaking at 0.161, about 16dB down, which is a
 * deliverable nobody can comfortably hear. The evidence belongs in the log, not
 * in the amplitude: the measured peak is printed below and the file is brought
 * to a sane listening level.
 *
 * That 0.161 is itself worth recording. `session` asserts a full band peaks at
 * 0.86 of full scale, computed as the ARITHMETIC sum of simultaneous
 * amplitudes — and this is what actually happens when the same events are
 * summed as signals, where different frequencies and phases do not add
 * coherently. The gate is conservative by roughly a factor of five, which is
 * the right direction for a clipping check to err in.
 */
const norm = peak > 0 ? 0.89 / peak : 1;

const frames = total;
const buf = Buffer.alloc(44 + frames * 4);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + frames * 4, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(frames * 4, 40);
for (let i = 0; i < frames; i++) {
  const l = Math.max(-1, Math.min(1, left[i] * norm));
  const rr = Math.max(-1, Math.min(1, right[i] * norm));
  buf.writeInt16LE((l * 32767) | 0, 44 + i * 4);
  buf.writeInt16LE((rr * 32767) | 0, 46 + i * 4);
}
writeFileSync(OUT, buf);

console.log(`render — ${OUT}  [state: ${STATE}]`);
console.log(
  LIVE
    ? `  ${BARS} bars driven by the real World = ${spanSec.toFixed(1)}s (tempo varies; started at ${bpm} BPM)`
    : `  ${BARS} bars at ${bpm} BPM = ${(BARS * secPerBar).toFixed(1)}s`,
);
console.log(`  starting in section '${warm.section}', key ${warm.key}, feel ${warm.feel}, after ${LEAD_IN_SECONDS}s warm-up`);
// Energy is what every stem curve reads, so a render that does not print it
// cannot be compared against another render. Two presets once disagreed by 2x
// on the kick with no visible reason, because this line was not here.
console.log(
  `  energy ${warm.energy.toFixed(3)}  (tension ${warm.tension.toFixed(3)}, floor ${warm.progressFloor.toFixed(3)}, driver '${warm.driver}')`,
);
console.log(`  lanes above 0.05: ${playing.join(' ') || 'NONE — the arrangement is empty, check the warm-up'}`);
console.log(`  ${timed.length} events queried, ${voices} synthesised`);
// Gain-weighted pitch of what was actually scheduled. A spectral share can be
// dominated by one loud low lane; this says where the NOTES are.
{
  let ws = 0, wt = 0, lowW = 0;
  for (const ev of timed) {
    const v = ev.v;
    const n = typeof v.note === 'number' ? v.note : Number(v.note);
    if (!Number.isFinite(n)) continue;
    const g = Math.pow(typeof v.gain === 'number' ? v.gain : 1, 2) * Math.pow(typeof v.postgain === 'number' ? v.postgain : 1, 2);
    ws += n * g; wt += g; if (n < 50) lowW += g;
  }
  if (wt > 0) console.log(`  gain-weighted mean pitch ${(ws / wt).toFixed(1)} MIDI; ${((100 * lowW) / wt).toFixed(1)}% of note weight below MIDI 50 (147Hz)`);
}
console.log(`  measured peak ${peak.toFixed(3)} of full scale — the acoustic sum, against`);
console.log(`  session's arithmetic worst case of 0.86, so that gate is ~5x conservative.`);
console.log(`  Normalised by ${norm.toFixed(2)}x for listening.`);
if (voices === 0) console.log('  NOTHING SYNTHESISED — the pattern produced no usable events.');
console.log('\n  Judge the WRITING from this, not the sound: no reverb, no delay,');
console.log('  one-pole filters, and simple oscillators rather than superdough\'s.');
