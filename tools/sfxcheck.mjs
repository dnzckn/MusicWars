/*
 * sfxcheck — does every sound effect actually ask for a sound?
 *
 * The eleven `sfx*` functions are the only audio in the game that does NOT go
 * through the pattern engine: they call `superdough` directly against the Web
 * Audio context. That puts them outside every check in `tools/` — `leadcheck`,
 * `masking`, `instruments` and the rest all query patterns, and patterns are
 * not what these produce. The one tool that covered them, `audiocheck`, drives
 * Playwright, so on a box with no browser the entire SFX layer is unwatched.
 *
 * This project has already shipped a whole class of this bug once: six
 * abilities named after audio processes that made no audio, and a `bounces`
 * stat with no consumer. A sound effect that early-returns, or asks for gain
 * 0, or is wired to a voice that no longer exists, fails in exactly the same
 * silent way — the call site looks correct and nothing happens.
 *
 * METHOD. `@strudel/webaudio` is redirected to a recording stub before
 * `sfx.ts` is imported, using the same `registerHooks` trick
 * `lib/headless-audio.mjs` uses for `@kabelsalat/web`. Then every exported
 * effect is called and its requests are inspected. The stub is registered HERE
 * rather than in the shared shim on purpose: the director imports the real
 * module, and stubbing it globally would quietly hollow out every other tool.
 */
import { registerHooks } from 'node:module';

/* The recorder lives on globalThis so the stub module can reach it. */
globalThis.__sfxCalls = [];

/*
 * A CLOCK WE CONTROL, because several effects are rate-limited.
 *
 * `sfxEnemyFire` refuses to fire twice inside 55ms and `sfxShoot` has its own
 * throttle, both read from `performance.now()`. Calling the eight archetypes
 * in a tight loop therefore silenced seven of them and the check reported 0/8
 * fire voices — a total failure of the feature, which is not what was
 * happening at all. Advancing a fake clock between calls is the difference
 * between measuring the game and measuring the loop's speed.
 */
let fakeNow = 0;
globalThis.__audioNow = 0;
globalThis.performance = { ...globalThis.performance, now: () => fakeNow };
/*
 * TWO clocks, because the code reads two. `sfxEnemyFire` and `sfxShoot`
 * throttle on `performance.now()` in milliseconds, while `fire()` spaces each
 * CHANNEL on the audio context's `currentTime` in seconds. Freezing either one
 * silences everything after the first call and reads as a dead feature — the
 * first version of this tool reported 0 of 8 archetypes firing, when all eight
 * are wired correctly.
 */
const tick = () => { fakeNow += 1000; globalThis.__audioNow += 1; };

const STUB = `
  export function getAudioContext() {
    // currentTime must ADVANCE: fire() gates each channel on it, so a frozen
    // clock silences every call after the first on that channel.
    return { get currentTime() { return globalThis.__audioNow ?? 0; }, state: 'running' };
  }
  export function superdough(value, time, dur) {
    globalThis.__sfxCalls.push({ value, time, dur });
  }
  export function samples() {}
  export function initAudio() {}
  export function registerSynthSounds() {}
  export function webaudioOutput() {}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@strudel/webaudio') {
      return { url: `data:text/javascript,${encodeURIComponent(STUB)}`, shortCircuit: true };
    }
    if (specifier === '@kabelsalat/web') {
      return { url: 'data:text/javascript,export class SalatRepl%20%7B%7D', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

await import('./lib/tsnode.mjs');
const SFX = await import('../src/audio/sfx.ts');

/*
 * Plausible arguments per effect. Several take a chord or a grade and would
 * legitimately do nothing with nonsense, so each gets something the game would
 * actually hand it.
 */
const CHORD = [57, 60, 64];
const ARGS = {
  sfxShoot: [CHORD, false, 'pizzicato', 'seek'],
  sfxEnemyFire: ['pluck', 57, 0],
  sfxEnemyHit: [CHORD],
  sfxEnemyDeath: [0.5, 'pluck', 57],
  sfxPlayerHit: [],
  sfxGraze: [],
  sfxPickup: [5],
  sfxBomb: [CHORD],
  sfxExtend: [],
  sfxRunStart: [CHORD],
  sfxWaveClear: [CHORD, 'perfect'],
};

/*
 * These signatures were got WRONG first time and every one of the four
 * mismatches read as a defect: a chord passed where `sfxEnemyDeath` wanted a
 * `size` produced gain 0, and an undefined archetype made `sfxEnemyFire`
 * early-return with no sound at all. Both look exactly like the bug this tool
 * exists to find. Check the signature before believing the failure.
 */

const names = Object.keys(SFX).filter((k) => k.startsWith('sfx'));
const rows = [];
const fails = [];

for (const name of names) {
  globalThis.__sfxCalls = [];
  tick();
  const args = ARGS[name];
  if (!args) { fails.push(`${name} has no test arguments — add them, do not skip it`); continue; }
  try {
    SFX[name](...args);
  } catch (err) {
    fails.push(`${name} threw: ${String(err).slice(0, 80)}`);
    continue;
  }
  const calls = globalThis.__sfxCalls;
  const audible = calls.filter((c) => (c.value?.gain ?? 0) > 0);
  rows.push([name, calls.length, audible.length, calls[0]?.value?.s ?? calls[0]?.value?.note ?? '—']);
  if (!calls.length) fails.push(`${name} asked for no sound at all`);
  else if (!audible.length) fails.push(`${name} made ${calls.length} request(s), every one at gain 0`);
}

/*
 * EVERY ARCHETYPE MUST HAVE A FIRE VOICE.
 *
 * `sfxEnemyFire` looks its archetype up in `FIRE_VOICE` and returns silently
 * when there is no entry — so an enemy type added without one shoots in
 * complete silence, and nothing anywhere would say so. The denominator is the
 * game's own roster rather than a list in this file: "38/38 audible" once
 * passed for weeks because the list being counted was the wrong one.
 */
const { ARCHETYPE_INFO } = await import('../src/game/enemies.ts');
const silentArchetypes = [];
const voiced = [];
for (const archetype of Object.keys(ARCHETYPE_INFO)) {
  globalThis.__sfxCalls = [];
  tick();
  try { SFX.sfxEnemyFire(archetype, 57, 0); } catch { /* recorded as silent below */ }
  const audible = globalThis.__sfxCalls.filter((c) => (c.value?.gain ?? 0) > 0);
  if (audible.length) voiced.push(archetype);
  else silentArchetypes.push(archetype);
}
if (silentArchetypes.length) {
  fails.push(`${silentArchetypes.join(', ')} fire in silence — no FIRE_VOICE entry, and sfxEnemyFire returns quietly when it finds none`);
}

console.log(`\nsfxcheck — ${names.length} effects, called against a recording stub\n`);
console.log(`  ${'effect'.padEnd(16)} ${'voices'.padStart(6)} ${'audible'.padStart(8)}  first voice`);
console.log(`  ${'-'.repeat(16)} ${'-'.repeat(6)} ${'-'.repeat(8)}  ${'-'.repeat(20)}`);
for (const [n, total, aud, first] of rows) {
  console.log(`  ${n.padEnd(16)} ${String(total).padStart(6)} ${String(aud).padStart(8)}  ${first}`);
}

console.log(`\n  enemy fire voices: ${voiced.length}/${Object.keys(ARCHETYPE_INFO).length} archetypes` +
  (silentArchetypes.length ? `  SILENT: ${silentArchetypes.join(', ')}` : ''));

for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) console.log('\n  ok  every effect requests at least one audible voice');
process.exit(fails.length ? 1 : 0);
