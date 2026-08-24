/*
 * hum — one WAV per theme, so a person can decide whether the tunes are good.
 *
 * Every other music tool in this directory returns a number, and the whole
 * lesson of this project is that a theme can satisfy thirteen gates and still
 * be forgettable: a hand-written test candidate cleared all of them at 90%
 * stepwise and was obviously dull. `tune` can say a melody is not WRONG. Only
 * ears can say it is GOOD, and the browser tools that would let anyone hear the
 * real game are dark whenever this box stalls.
 *
 * So this renders each theme's melody alone — no drums, no pad, no arp — twice
 * through, in one fixed key and mode, at a walking tempo. Stripped down on
 * purpose: a tune that needs the arrangement to be interesting is not a tune.
 *
 * NOT the game's sound. Naive oscillators, one-pole filter, no reverb and no
 * delay, the same limits `render.mjs` states at length. Judge the WRITING: does
 * it go somewhere, does the phrase answer itself, could you hum it back.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const { buildChord, PROGRESSIONS, degreeToSemitone } = await import('../src/audio/theory.ts');

const { THEMES, BOSS_THEME, HOLD, cellForBar } = L;
const SR = 44100;
const BPM = Number(process.env.HUM_BPM ?? 96);
const MODE = process.env.HUM_MODE ?? 'aeolian';
const TONIC = 69; // A4 — comfortably in the middle of a singer's range.
const OUT_DIR = new URL('../renders/', import.meta.url).pathname;

const SLOTS = cellForBar(THEMES[0], 0, 0).length;
const secPerSlot = (60 / BPM) / (SLOTS / 4); // four beats to a bar, SLOTS slots
const midiToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** Notes of one theme's eight-bar period, with written durations. */
function notesOf(theme) {
  const out = [];
  for (let bar = 0; bar < 8; bar++) {
    const cell = cellForBar(theme, 0, bar);
    cell.forEach((d, slot) => {
      if (typeof d !== 'number') return;
      let dur = 1;
      for (let j = slot + 1; j < cell.length && cell[j] === HOLD; j++) dur++;
      out.push({ at: (bar * SLOTS + slot) * secPerSlot, dur: dur * secPerSlot, deg: d });
    });
  }
  return out;
}

function render(theme, passes = 2) {
  const notes = notesOf(theme);
  const periodSecs = 64 * secPerSlot;
  const total = Math.ceil((periodSecs * passes + 1.5) * SR);
  const buf = new Float32Array(total);
  for (let pass = 0; pass < passes; pass++) {
    for (const n of notes) {
      const hz = midiToHz(TONIC + degreeToSemitone(MODE, n.deg));
      const start = Math.floor((n.at + pass * periodSecs) * SR);
      const len = Math.floor((n.dur + 0.5) * SR);
      for (let i = 0; i < len && start + i < total; i++) {
        const t = i / SR;
        /* Soft attack, sustain, gentle release — a sung note, not a stab. */
        const a = 0.012, r = 0.42;
        let env;
        if (t < a) env = t / a;
        else if (t < n.dur) env = 1 - 0.25 * ((t - a) / Math.max(0.001, n.dur - a));
        else env = Math.max(0, 0.75 * (1 - (t - n.dur) / r));
        if (env <= 0) continue;
        /* Triangle plus a quiet octave — enough body to judge a contour by. */
        const ph = t * hz;
        const s = (4 * Math.abs((ph % 1) - 0.5) - 1) * 0.55 + Math.sin(2 * Math.PI * ph * 2) * 0.12;
        buf[start + i] += s * env * 0.32;
      }
    }
  }
  return buf;
}

function writeWav(path, data) {
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * gain * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
  return { seconds: n / SR, peak };
}

mkdirSync(OUT_DIR, { recursive: true });

/*
 * `--theme <file.json> [name]` auditions a CANDIDATE without installing it.
 *
 * Installing nine themes and then discovering they are worse is an expensive
 * way to find out. The JSON is the same shape `tune --theme` takes, so a
 * candidate can be validated and heard from the same file before it goes
 * anywhere near `layers.ts`.
 */
const themeArg = process.argv.indexOf('--theme');
let list;
if (themeArg >= 0) {
  const { readFileSync } = await import('node:fs');
  const file = process.argv[themeArg + 1];
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const fix = (row) => row.map((v) => (v === '_' ? HOLD : v));
  const name = process.argv[themeArg + 2] ?? file.split('/').pop().replace(/\.json$/, '');
  list = [[name, { a: fix(raw.a), a2: fix(raw.a2), b: fix(raw.b), b2: fix(raw.b2), c: fix(raw.c), tag: fix(raw.tag) }]];
} else {
  list = [...THEMES.map((t, i) => [`T${i}`, t]), ['BOSS', BOSS_THEME]];
}
console.log(`\nhum — ${list.length} themes, melody alone, ${BPM}bpm, ${MODE}, two passes each\n`);
for (const [name, theme] of list) {
  const path = `${OUT_DIR}hum-${name}.wav`;
  const r = writeWav(path, render(name === 'BOSS' ? theme : theme));
  const ns = notesOf(theme);
  const durs = new Set(ns.map((n) => +(n.dur / secPerSlot).toFixed(2)));
  console.log(`  ${name.padEnd(5)} ${r.seconds.toFixed(1)}s  ${String(ns.length).padStart(2)} notes  ` +
    `${durs.size} distinct lengths  -> renders/hum-${name}.wav`);
}
console.log('\n  BOSS is written for harmonicMinor; set HUM_MODE=harmonicMinor to hear it as intended.');
console.log('  Judge the writing, not the sound: no reverb, no delay, naive oscillators.');
