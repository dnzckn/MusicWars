/*
 * fontlanes — the soundfont contract, checked in Node, in BOTH modes.
 *
 * `src/audio/soundfonts.ts` moved six pitched lanes from bare oscillators onto
 * General MIDI instruments, and it did so with a per-lane fallback: a lane
 * whose samples do not load keeps the oscillator it had before. That fallback
 * is the part nobody will ever notice breaking, because breaking it looks
 * exactly like a slow connection.
 *
 * THE FAILURE MODE THIS EXISTS FOR, stated first because it decided the shape
 * of the tool. The gates query the builders in Node, where there is no browser
 * and no network, so `soundfonts.ts` reports the WRITTEN score there — the
 * instruments. Every other gate in the suite therefore measures the soundfont
 * path and NOTHING MEASURES THE FALLBACK. That is `AGENTS.md` §3's "unmeasured
 * properties rot" exactly: the oscillator score could be deleted, or could
 * quietly lose a lane, and every gate in `verify` would stay green while the
 * only players affected are the ones whose connection is bad.
 *
 * So this queries the same builders TWICE, flipping the module's own mode
 * between passes, and asserts that the two differ in exactly one respect: the
 * source. Same lanes, same note events, same onsets, same pitches.
 *
 * The five assertions:
 *
 *   1. TABLE. Every role declares a font, a variant, a fallback oscillator and
 *      a warm range, and the fallback matches the score as it stood before this
 *      change (a frozen historical copy — see `SHIPPED`).
 *   2. WRITTEN. Every role's lane emits its `gm_*` name in written mode.
 *   3. FALLBACK. The same haps emit that role's oscillator in fallback mode.
 *   4. SAME MUSIC. Every hap in those builders has the same onset and pitch in
 *      both modes, and every hap the swap does not own is byte-identical.
 *   5. NO INERT CONTROLS. A soundfont hap carries none of superdough's
 *      oscillator-branch-only controls, an oscillator hap carries no `n`, and
 *      the fallback still sets the controls its own waveform reads.
 *
 * Every denominator is printed. `checked === 0` is a failure.
 */
import { makeSignals } from './lib/headless-audio.mjs';
const strudel = await import('@strudel/core');
const L = await import('../src/audio/layers.ts');
const SF = await import('../src/audio/soundfonts.ts');
const { buildChord } = await import('../src/audio/theory.ts');

const TONIC = 57;
const FEELS = ['boomchick', 'chase', 'gallop', 'shuffle', 'halftime'];

function state(over = {}) {
  const mode = over.mode ?? 'aeolian';
  const degree = over.degree ?? 0;
  return {
    tension: 0.62, immediate: 0.5, section: over.section ?? 'sustain', buildProgress: 1,
    fillBar: false, bar: over.bar ?? 0, tonic: TONIC, mode, chord: buildChord(TONIC, mode, degree),
    nextChord: buildChord(TONIC, mode, degree + 1), chordIndex: degree,
    barInPhrase: over.barInPhrase ?? 0, phrase: 0, feel: over.feel ?? 'boomchick', bpm: 140,
    intensity: 0.62, brightness: 0.5, powerups: {}, enemies: {},
    boss: false, bossTheme: false, bossPhase: 0, wave: 4, bombs: 0, health: 1,
    grazeRate: 0, combo: 0, leadRegister: 0, movement: null, sig: makeSignals(strudel),
  };
}

/*
 * ONE ENTRY PER BUILDER, not per role, and the comparison is INDEX-WISE.
 *
 * The first version of this filtered haps by their source name and compared
 * counts. It was wrong in two ways that are worth recording, because both look
 * like defects and neither is: `pad` and `colour` both fall back to `supersaw`,
 * so a source filter merges them into one lane; and `buildBass` also emits the
 * `halftime` wobble, which is a sawtooth in both modes and so appeared only in
 * the fallback's filter. A count comparison cannot tell either of those from a
 * real change.
 *
 * Walking the two lists together fixes both and is strictly stronger: it says
 * the swap touched EXACTLY the haps it was meant to, and that every other hap
 * in the same builder is untouched, note for note and onset for onset.
 */
const BUILDERS = [
  { name: 'buildBass', build: (s) => L.buildBass(s), roles: ['bass'] },
  { name: 'buildChords', build: (s) => L.buildChords(s), roles: ['pad', 'colour', 'stab'] },
  { name: 'buildMotor', build: (s) => L.buildMotor(s), roles: ['motor'] },
  { name: 'buildLead', build: (s) => L.buildLead(s), roles: ['leadTune', 'leadDecor'] },
];

/** Every hap a builder emits over one bar, across a spread of states. */
function hapsFor(builder) {
  const out = [];
  for (const feel of FEELS) {
    for (const barInPhrase of [0, 1, 2, 3]) {
      for (const degree of [0, 3]) {
        const events = builder.build(state({ feel, barInPhrase, degree })).queryArc(0, 1);
        for (const e of events) {
          out.push({
            key: `${feel}:${barInPhrase}:${degree}`,
            s: e.value?.s,
            n: e.value?.n,
            note: e.value?.note,
            begin: Number(e.whole?.begin ?? e.part?.begin ?? 0),
            pw: e.value?.pw,
            unison: e.value?.unison,
            detune: e.value?.detune,
            spread: e.value?.spread,
            pwrate: e.value?.pwrate,
            pwsweep: e.value?.pwsweep,
          });
        }
      }
    }
  }
  return out;
}

const fails = [];
const line = (s) => console.log(s);

line('');
line('fontlanes — the instrument table and its fallback');
line('');

/* ------------------------------------------------------------------ 1. TABLE */

/*
 * THE SCORE AS IT STOOD, frozen here ON PURPOSE.
 *
 * `AGENTS.md` §3 says a tool holding its own copy of a constant will lie the
 * day it moves — and that is right about a LIVE constant. This is not one. It
 * is a record of what each lane sounded like at commit e8d61bd, which is what
 * the fallback promises to reproduce, and it must NOT track the source: if
 * someone changes a fallback oscillator, the whole point is that this goes red
 * and they have to say so out loud.
 */
/*
 * `extras` is the set of oscillator-branch-only controls each lane SET, which
 * is not the same as the set its waveform reads. `buildMotor` swept the pulse
 * duty and `buildLead`'s decoration never did, so requiring `pwrate` of every
 * pulse would have failed a lane that never had it. Named per lane, from the
 * source as it stood, for the same reason as the oscillator itself.
 */
const SHIPPED = {
  bass: { s: 'sawtooth', extras: [] },
  pad: { s: 'supersaw', unison: 3, extras: ['detune', 'spread'] },
  colour: { s: 'supersaw', unison: 2, extras: ['detune', 'spread'] },
  stab: { s: 'sawtooth', extras: [] },
  motor: { s: 'pulse', pw: 0.34, extras: ['pwrate', 'pwsweep'] },
  /*
   * pulse at 35%, not the triangle the score shipped with. This is the one
   * entry in this table that records a DELIBERATE re-voicing rather than the
   * pre-soundfont sound: docs/research-dubstep.md section 6.2 — four
   * re-voicings of the lead all moved toward sweeter (supersaw, triangle,
   * oboe, triangle) and the owner rejected each; the genre's body is a mono,
   * mid-focused pulse or saw, saturated. The gate went red on the change, as
   * it should, and this entry is the statement that the third sound WAS
   * chosen, by whom, and why.
   */
  leadTune: { s: 'pulse', pw: 0.35, extras: [] },
  leadDecor: { s: 'pulse', pw: 0.5, extras: [] },
};

let tableChecked = 0;
let wire = 0;
const wireSeen = new Set();
const rolesSharingAFont =
  SF.VOICE_ROLES.length - new Set(SF.VOICE_ROLES.map((r) => SF.INSTRUMENTS[r].font)).size;
line('  role        instrument                 n  variant                       zones     wire  fallback');
for (const role of SF.VOICE_ROLES) {
  const i = SF.INSTRUMENTS[role];
  tableChecked++;
  // Distinct FILES, matching `TOTAL_WIRE_BYTES`: two roles on one instrument
  // fetch it once.
  if (!wireSeen.has(i.variant)) {
    wireSeen.add(i.variant);
    wire += i.wireBytes;
  } else if (i.wireBytes !== 0) {
    fails.push(`role "${role}" repeats variant ${i.variant} but declares ${i.wireBytes} bytes; the second copy is free`);
  }
  const fb = `${i.osc.s}${i.osc.pw !== undefined ? `:pw${i.osc.pw}` : ''}${i.osc.unison !== undefined ? `:u${i.osc.unison}` : ''}`;
  line(
    `  ${role.padEnd(10)} ${i.font.padEnd(26)} ${String(i.n)}  ${i.variant.padEnd(28)} ${String(i.zones).padStart(3)}  ${String(i.wireBytes).padStart(7)}  ${fb}`,
  );
  const want = SHIPPED[role];
  if (!want) {
    fails.push(`role "${role}" has no entry in SHIPPED — a new role must state the oscillator it falls back to`);
    continue;
  }
  if (i.osc.s !== want.s || i.osc.pw !== want.pw || i.osc.unison !== want.unison) {
    fails.push(
      `role "${role}" falls back to ${JSON.stringify(i.osc)}, but the score before soundfonts was ` +
        `${JSON.stringify(want)}. A fallback that is not the old score is a THIRD sound nobody chose.`,
    );
  }
  if (!i.font?.startsWith('gm_')) fails.push(`role "${role}" font "${i.font}" is not a General MIDI name`);
  if (!i.variant) fails.push(`role "${role}" declares no variant file name, so its byte counts describe nothing`);
  const [lo, hi] = i.warm;
  if (!(hi > lo)) fails.push(`role "${role}" warm range ${lo}-${hi} is empty; the lane would be promoted cold`);
}
for (const role of Object.keys(SHIPPED)) {
  if (!SF.VOICE_ROLES.includes(role)) {
    fails.push(`SHIPPED names role "${role}" that no longer exists — was a lane put back on an oscillator?`);
  }
}
line('');
line(
  `  ${tableChecked} roles in the table, ${rolesSharingAFont} of them sharing a font with another, ` +
    `${wire} distinct bytes if every one were enabled`,
);
/*
 * ENABLED IS NOT THE SAME AS TABLED, and the difference is what the player
 * actually downloads.
 *
 * `SAMPLED_ROLES` gates which roles may use their instrument at all. The rest
 * keep an entry — re-enabling one is a single line — but they emit their
 * oscillator, and the loader must not fetch a font nobody plays. Both halves
 * are asserted below, because "the table lists seven instruments" and "the game
 * plays one of them" are very different statements and only one of them is
 * about what a player hears.
 */
const ENABLED = new Set(SF.ENABLED_ROLES);
line(
  `  ENABLED: ${SF.ENABLED_ROLES.join(', ') || '(none)'} — ${SF.TOTAL_WIRE_BYTES} bytes actually fetched, ` +
    `against ${SF.TABLE_WIRE_BYTES} for the whole table`,
);
if (ENABLED.size === 0) {
  fails.push(
    'no role is enabled, so `@strudel/soundfonts` is installed, loaded and wired to nothing. That may be ' +
      'deliberate, but it must be a decision somebody makes out loud rather than a table that quietly does nothing.',
  );
}
for (const r of SF.ENABLED_ROLES) {
  if (!SF.VOICE_ROLES.includes(r)) fails.push(`ENABLED_ROLES names "${r}", which is not in the table`);
}
if (tableChecked === 0) fails.push('the instrument table is empty. A check with no denominator is not a pass.');
if (wire !== SF.TABLE_WIRE_BYTES) {
  fails.push(`TABLE_WIRE_BYTES ${SF.TABLE_WIRE_BYTES} disagrees with the table's own sum of ${wire}`);
}

/* -------------------------------------------------- 2, 3, 4, 5. BOTH MODES */

/*
 * `n` IS THE SAMPLE-SET INDEX AND IT MUST NOT REACH AN OSCILLATOR.
 * `superdough/synth.mjs:503` reads `value.partials ?? value.n` and, for any
 * waveform but `sine`, a truthy `n` REPLACES the stock waveform with a custom
 * periodic wave built from it. `supersaw` is worse: `synth.mjs:158` does
 * `detune = detune ?? n ?? 0.18`, so an `n` left behind on a fallback supersaw
 * silently becomes its detune in semitones.
 */
const SUPERSAW_ONLY = ['unison', 'detune', 'spread'];
const PULSE_ONLY = ['pw', 'pwrate', 'pwsweep'];
/*
 * ROLE ATTRIBUTION IS BY (FONT, FALLBACK) AND NOT BY FONT ALONE.
 *
 * `leadTune` and `leadDecor` are two lanes of one instrument: both emit
 * `gm_oboe` with the same `n`, and in the haps they are indistinguishable —
 * which is correct, they ARE one instrument, and `registermap` merges them into
 * one voice group on purpose. Keying this table on the font alone silently made
 * one of them shadow the other and reported the tune as playing zero notes.
 *
 * The pair is unique because their fallbacks differ: the tune falls back to the
 * triangle it always had, the decoration to the 25%-duty pulse the mix's air
 * was measured on. Walking both modes together is what makes that readable.
 */
const FONT_OF = {};
for (const r of SF.ENABLED_ROLES) FONT_OF[`${SF.INSTRUMENTS[r].font}|${SF.INSTRUMENTS[r].osc.s}`] = r;
if (Object.keys(FONT_OF).length !== SF.ENABLED_ROLES.length) {
  fails.push('two enabled roles share both a font AND a fallback oscillator; their haps cannot be told apart');
}

SF.setSoundfontModeForTesting('written');
const written = new Map(BUILDERS.map((b) => [b.name, hapsFor(b)]));
SF.setSoundfontModeForTesting('fallback');
const fallback = new Map(BUILDERS.map((b) => [b.name, hapsFor(b)]));
SF.setSoundfontModeForTesting('written');

const swapped = Object.fromEntries(SF.VOICE_ROLES.map((r) => [r, 0]));
const fellBack = Object.fromEntries(SF.VOICE_ROLES.map((r) => [r, 0]));
let hapsChecked = 0;
let untouched = 0;
const otherSources = new Map();
const reported = new Set();

for (const b of BUILDERS) {
  const w = written.get(b.name);
  const f = fallback.get(b.name);
  if (w.length !== f.length) {
    fails.push(
      `${b.name}: ${w.length} haps written against ${f.length} in fallback. The mode changes the TIMBRE and ` +
        `nothing else, so a different hap count is a different piece of music.`,
    );
    continue;
  }
  for (let i = 0; i < w.length; i++) {
    const a = w[i];
    const c = f[i];
    hapsChecked++;
    if (a.key !== c.key || a.begin !== c.begin || String(a.note) !== String(c.note)) {
      fails.push(
        `${b.name}: hap ${i} differs beyond its source — written ${a.key}@${a.begin} note ${a.note}, ` +
          `fallback ${c.key}@${c.begin} note ${c.note}`,
      );
      break;
    }
    const role = FONT_OF[`${a.s}|${c.s}`];
    if (role === undefined) {
      if (a.s !== c.s) {
        /*
         * The source changed between modes but the pair is not in the table.
         * Either a role's fallback is not the oscillator it declares — THE
         * FALLBACK IS BROKEN, and on a player whose fonts do not load this lane
         * throws per note or goes silent — or a swap was introduced that
         * `INSTRUMENTS` does not describe.
         */
        const k = `pair:${a.s}|${c.s}`;
        if (!reported.has(k)) {
          reported.add(k);
          fails.push(
            `${b.name}: hap ${i} is "${a.s}" written and "${c.s}" in fallback, a pair no role declares. ` +
              `Expected: ${Object.keys(FONT_OF).join(', ')}`,
          );
        }
        continue;
      }
      // A hap this pass did not touch. Identical in both modes, as required.
      untouched++;
      otherSources.set(a.s, (otherSources.get(a.s) ?? 0) + 1);
      continue;
    }
    if (!b.roles.includes(role)) {
      const k = `stray:${b.name}:${role}`;
      if (!reported.has(k)) {
        reported.add(k);
        fails.push(`${b.name}: emitted "${a.s}" (role ${role}), which belongs to a different builder`);
      }
      continue;
    }
    const inst = SF.INSTRUMENTS[role];
    swapped[role]++;
    fellBack[role]++;
    for (const k of [...SUPERSAW_ONLY, ...PULSE_ONLY]) {
      if (a[k] !== undefined) {
        const id = `inert:${role}:${k}`;
        if (!reported.has(id)) {
          reported.add(id);
          fails.push(
            `role "${role}": soundfont hap carries "${k}", which superdough reads only on ` +
              `${SUPERSAW_ONLY.includes(k) ? 'supersaw' : 'pulse'}`,
          );
        }
      }
    }
    if (a.n === undefined && inst.n !== 0) {
      const id = `non:${role}`;
      if (!reported.has(id)) {
        reported.add(id);
        fails.push(`role "${role}": a soundfont hap has no "n", so superdough plays variant 0 rather than ${inst.n}`);
      }
    }
    if (c.n !== undefined) {
      const id = `fbn:${role}`;
      if (!reported.has(id)) {
        reported.add(id);
        fails.push(
          `role "${role}": a FALLBACK hap carries "n". On any oscillator but sine that replaces the waveform ` +
            `with a custom periodic wave (synth.mjs:503); on supersaw it becomes the detune (synth.mjs:158).`,
        );
      }
    }
  }
}

/*
 * A DISABLED ROLE'S LANE IS COUNTED TOO, and it has to be: "the lane went
 * silent" and "the lane went back to its oscillator" look identical if nobody
 * counts the oscillator haps. `oscOnly` is how many haps a disabled role's own
 * builder emitted on that role's fallback waveform, in both modes.
 */
const oscOnly = {};
for (const role of SF.VOICE_ROLES) {
  if (ENABLED.has(role)) continue;
  const b = BUILDERS.find((x) => x.roles.includes(role));
  const inst = SF.INSTRUMENTS[role];
  const count = (arr) => arr.filter((h) => h.s === inst.osc.s).length;
  oscOnly[role] = { written: count(written.get(b.name)), fallback: count(fallback.get(b.name)) };
}

line('');
line('  role        instrument                  haps   fallback                haps   enabled');
let lanesChecked = 0;
for (const role of SF.VOICE_ROLES) {
  const inst = SF.INSTRUMENTS[role];
  lanesChecked++;
  if (!ENABLED.has(role)) {
    const o = oscOnly[role];
    line(
      `  ${role.padEnd(10)} ${`(${inst.font})`.padEnd(26)} ${'-'.padStart(6)}   ${inst.osc.s.padEnd(20)} ${String(o.written).padStart(6)}   no`,
    );
    if (o.written === 0 || o.fallback === 0) {
      fails.push(
        `role "${role}" is DISABLED, so it must play "${inst.osc.s}" in both modes — measured ${o.written} ` +
          `written and ${o.fallback} fallback haps. A disabled role that emits nothing is a silent lane.`,
      );
    }
    if (o.written !== o.fallback) {
      fails.push(
        `role "${role}" is disabled but its oscillator hap count differs between modes ` +
          `(${o.written} vs ${o.fallback}); a disabled role must not notice the mode at all`,
      );
    }
    if (swapped[role] !== 0) {
      fails.push(`role "${role}" is disabled but ${swapped[role]} haps carried "${inst.font}"`);
    }
    continue;
  }
  line(
    `  ${role.padEnd(10)} ${inst.font.padEnd(26)} ${String(swapped[role]).padStart(6)}   ${inst.osc.s.padEnd(20)} ${String(fellBack[role]).padStart(6)}   yes`,
  );
  if (swapped[role] === 0) {
    fails.push(`role "${role}": no hap carried "${inst.font}" in written mode. The lane is silent or misrouted.`);
  }
  if (fellBack[role] === 0) {
    fails.push(`role "${role}": no hap fell back to "${inst.osc.s}". THE FALLBACK IS UNPROVEN for this lane.`);
  }
  /*
   * The fallback must still set the controls its own waveform reads. They were
   * set unconditionally before soundfonts existed and are conditional now, so
   * the failure this catches is "made conditional and then lost".
   */
  const need = SHIPPED[role]?.extras ?? [];
  // Only for an ENABLED role: a disabled one never became conditional, so there
  // is nothing that could have been lost.
  const builder = BUILDERS.find((b) => b.roles.includes(role));
  for (const k of need) {
    const anywhere = fallback.get(builder.name).some((h) => h.s === inst.osc.s && h[k] !== undefined);
    if (!anywhere) {
      fails.push(
        `role "${role}": the fallback ${inst.osc.s} never sets "${k}". It was set before soundfonts existed, ` +
          `so it has been lost rather than made conditional.`,
      );
    }
  }
}

const others = [...otherSources.entries()].map(([k, v]) => `${k} x${v}`).join(', ');
line('');
line(`  ${lanesChecked} lanes checked in both modes, ${hapsChecked} haps walked pairwise`);
line(`  ${untouched} haps in the same builders were untouched by the swap: ${others || '(none)'}`);
if (lanesChecked === 0 || hapsChecked === 0) {
  fails.push('nothing was examined. A check with no denominator is not a pass.');
}

/* ------------------------------------------- the lanes that KEPT their osc */

/*
 * Printed rather than asserted, because "this lane is still a triangle" is a
 * judgement and not a contract — but it is a judgement that should be visible
 * in the gate output, so that putting the arp on a celesta is something
 * somebody has to look at rather than something that happens quietly.
 */
line('');
line('  kept on oscillators, deliberately (see the tombstone in soundfonts.ts):');
const kept = Object.values(L.VOICE_TAGS).filter((t) => !t.role).map((t) => `${t.lane}/${t.s}`);
line(`     tagged voice groups: ${kept.join(', ') || '(none)'}`);
line('     sub (a sub IS a sine), kit.ts percussion, buildFx, wobble.ts, motifs, powerup voices,');
line("     the chase 808 (a drum machine, not an instrument), and the lead's octave-down BODY and");
line('     boss stack (a sawtooth behind a 500-1400 Hz lowpass; a body has no character of its own)');

/* ------------------------------------------------------------------- verdict */

line('');
if (fails.length) {
  for (const f of fails) line(`  FAIL  ${f}`);
  line('');
  line(`fontlanes: ${fails.length} failure(s)`);
  process.exit(1);
}
line('fontlanes: ok');
