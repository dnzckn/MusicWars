/**
 * Development-only pattern validator.
 *
 * superdough turns a non-finite control value into
 * `Failed to set the 'value' property on 'AudioParam'` with no indication of
 * which control or which layer produced it. This queries the pattern the way
 * the scheduler would and reports the offenders by name, which turns a
 * ten-minute bisect into a one-line answer.
 */

import type { Pattern } from '@strudel/core';

export interface BadValue {
  cycle: number;
  control: string;
  value: unknown;
  sound: unknown;
  note: unknown;
}

export function findNonFinite(pattern: Pattern, cycles = 8): BadValue[] {
  const bad: BadValue[] = [];
  for (let c = 0; c < cycles; c++) {
    let haps;
    try {
      haps = pattern.queryArc(c, c + 1, { _cps: 0.55 });
    } catch (err) {
      bad.push({ cycle: c, control: '<query threw>', value: String(err), sound: null, note: null });
      continue;
    }
    for (const hap of haps) {
      const v = hap.value ?? {};
      for (const [key, val] of Object.entries(v)) {
        if (typeof val === 'number' && !Number.isFinite(val)) {
          bad.push({ cycle: c, control: key, value: val, sound: v.s, note: v.note });
        }
        // A control that should be numeric but arrived as an unparsed string is
        // the other way this fails, and it fails later and more confusingly.
        if (typeof val === 'string' && /^-?\d*\.?\d+:/.test(val) === false && NUMERIC.has(key) && Number.isNaN(Number(val))) {
          bad.push({ cycle: c, control: `${key}(string)`, value: val, sound: v.s, note: v.note });
        }
      }
    }
  }
  return bad;
}

const NUMERIC = new Set([
  'gain',
  'postgain',
  'velocity',
  'pan',
  'lpf',
  'hpf',
  'bpf',
  'lpq',
  'hpq',
  'bpq',
  'attack',
  'decay',
  'sustain',
  'release',
  'penv',
  'pdecay',
  'room',
  'delay',
  'delaytime',
  'delayfeedback',
  'unison',
  'spread',
  'detune',
  'drive',
  'duckdepth',
  'duckattack',
  'distort',
  'distortvol',
]);
