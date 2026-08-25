/*
 * leadfreeze — a byte-exact fingerprint of every note the score can produce.
 *
 * This exists for one job: proving that a REFACTOR changed nothing. The melody
 * container is about to go from 8 slots per bar to 16 so that duration,
 * anacrusis and rhythmic figures become expressible — and a refactor of that
 * size is worthless if it quietly moves a note, because then the composition
 * work that follows is being judged against a moved baseline.
 *
 * Usage:
 *   node tools/leadfreeze.mjs --save     write the baseline
 *   node tools/leadfreeze.mjs            diff against it; non-zero on any change
 *
 * The matrix is every pitched lane x every mode x all 8 bars of a phrase x
 * four development statements, with the signals pinned. That is the whole
 * space the tables can express, so an empty diff means the container swap is
 * genuinely inert.
 *
 * It deliberately fingerprints EVENTS, not source. A `Cell` becoming a `Bar`
 * with different numbers in it is fine and expected; the same audible result is
 * the contract.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeSignals } from './lib/headless-audio.mjs';
import { fileURLToPath } from 'node:url';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS } = await import('../src/audio/theory.ts');

const LANES = [
  ['sub', L.buildSub], ['motor', L.buildMotor], ['bass', L.buildBass],
  ['chords', L.buildChords], ['arp', L.buildArp], ['lead', L.buildLead],
];
const BASE = fileURLToPath(new URL('./lib/leadfreeze.baseline.txt', import.meta.url));

function state(over) {
  const mode = over.mode;
  return {
    tension: 0.62, immediate: 0.5, section: 'sustain', buildProgress: 1, fillBar: false,
    bar: 0, tonic: 57, mode, chord: buildChord(57, mode, over.degree ?? 0),
    nextChord: buildChord(57, mode, 4), chordIndex: over.degree ?? 0,
    barInPhrase: over.barInPhrase, phrase: over.phrase, feel: 'boomchick', bpm: 140,
    /*
     * `bossTheme` tracks `boss` here, and must be set explicitly.
     *
     * In play they differ by up to a phrase — the tune's boss flag is latched
     * to a phrase line while the timbre's is live (see `MusicalState.bossTheme`)
     * — but a frozen snapshot has no phrase clock, so the two are the same
     * thing. Leaving it undefined made every `boss: true` row render the
     * ORDINARY theme, quietly retiring half of this matrix.
     */
    intensity: 0.62, brightness: 0.5, powerups: {}, enemies: {},
    boss: over.boss ?? false, bossTheme: over.boss ?? false,
    bossPhase: 0, wave: over.wave ?? 4, bombs: 0, health: 1, grazeRate: 0, combo: 0,
    leadRegister: 0, movement: null, sig: makeSignals(strudel),
  };
}

const lines = [];
for (const mode of Object.keys(PROGRESSIONS)) {
  for (const boss of [false, true]) {
    for (const phrase of [0, 1, 2, 5]) {
      for (let barInPhrase = 0; barInPhrase < 8; barInPhrase++) {
        for (const [name, build] of LANES) {
          let evs;
          try {
            evs = build(state({ mode, boss, phrase, barInPhrase })).queryArc(0, 1);
          } catch (err) {
            lines.push(`${mode}/${boss ? 'boss' : 'wave'}/p${phrase}/b${barInPhrase}/${name} THREW ${err.message}`);
            continue;
          }
          const parts = evs
            .map((e) => {
              const v = e.value || {};
              const fields = Object.keys(v).sort()
                .map((k) => `${k}=${typeof v[k] === 'number' ? v[k].toFixed(4) : String(v[k])}`)
                .join(',');
              return `${(+e.part.begin).toFixed(5)}-${(+e.part.end).toFixed(5)}[${fields}]`;
            })
            .sort();
          /*
           * A HASH per row, not the events. The full dump is 6.7MB, which has
           * no business in a repository — and the diff only needs to say WHICH
           * state moved, because the state key is enough to re-query it
           * directly. Truncated to 16 hex chars: 3456 rows against a 64-bit
           * space is a collision probability around 3e-13.
           */
          const key = `${mode}/${boss ? 'boss' : 'wave'}/p${phrase}/b${barInPhrase}/${name}`;
          lines.push(`${key} ${createHash('sha256').update(parts.join(' ')).digest('hex').slice(0, 16)}`);
        }
      }
    }
  }
}
const text = lines.join('\n') + '\n';

if (process.argv.includes('--save')) {
  writeFileSync(BASE, text);
  console.log(`leadfreeze — baseline written: ${lines.length} rows, ${(text.length / 1024).toFixed(0)}kB`);
  console.log(`  ${BASE}`);
  process.exit(0);
}

if (!existsSync(BASE)) {
  console.error('leadfreeze: no baseline. Run `node tools/leadfreeze.mjs --save` BEFORE the refactor,\n' +
    'not after — a baseline captured afterwards proves nothing.');
  process.exit(1);
}
/*
 * Normalise line endings before comparing.
 *
 * The baseline is written with LF, but git checks it out as CRLF on Windows
 * unless .gitattributes says otherwise. Splitting on LF then leaves a trailing
 * CR on every line of `old` and none on `now`, so EVERY line mismatches and the
 * tool reports a total drift -- "the output moved" -- that is entirely its own.
 *
 * That is this repo's own tools/contrast.mjs incident in a new costume: a gate
 * lying about the very thing it was built to protect, and reporting a failure
 * of the code when the defect was in the check. A .gitattributes now pins the
 * baseline to LF as well. This is the belt to that pair of braces, and it means
 * the comparison cannot be fooled on a platform nobody has tried yet.
 */
const old = readFileSync(BASE, 'utf8').replace(/\r\n/g, '\n').split('\n');
const now = text.split('\n');
const diffs = [];
for (let i = 0; i < Math.max(old.length, now.length); i++) {
  if (old[i] !== now[i]) diffs.push({ i, old: old[i] ?? '(missing)', now: now[i] ?? '(missing)' });
}
console.log(`\nleadfreeze — ${lines.length} rows compared\n`);
if (!diffs.length) {
  console.log('  ok  byte-identical to the baseline — the refactor is a no-op');
  process.exit(0);
}
console.log(`  ${diffs.length} row(s) differ:\n`);
for (const d of diffs.slice(0, 12)) {
  console.log(`  ${(d.now.split(' ')[0] || d.old.split(' ')[0])}`);
}
if (diffs.length > 6) console.log(`  ...and ${diffs.length - 6} more`);
console.log('\n  FAIL  the output moved. If this was meant to be a pure container swap, it is not one.');
process.exit(1);
