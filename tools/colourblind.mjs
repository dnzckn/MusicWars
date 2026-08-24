/*
 * colourblind — does the colour contract survive colour-vision deficiency?
 *
 * This game encodes meaning in hue. `tools/contrast.mjs` states the contract:
 * warm = hurts you, cool = yours, green = collect. That is a good contract and
 * it has one specific problem — red against green is precisely the pair that
 * red-green CVD collapses, and that affects roughly 8% of men. A player who
 * cannot separate "this will kill you" from "pick this up" is not playing the
 * same game.
 *
 * `contrast.mjs` already showed that READABILITY here rides on luminance
 * rather than hue, which is why the groove-tinted room did not break it. That
 * is the right answer for "can I see it". It is not an answer for "can I tell
 * these two apart", which is what a contract built on hue actually promises,
 * and nothing measures that.
 *
 * Simulation uses the standard Viénot/Brettel linear-RGB matrices for
 * protanopia, deuteranopia and tritanopia. Distance is CIE76 dE in Lab, which
 * is crude next to CIEDE2000 but the decision here is "obviously different or
 * not", far above the threshold where the difference between the two metrics
 * matters.
 *
 * A pair that separates on LUMINANCE alone still works under CVD, so the
 * report shows dL beside dE: a low dE with a large dL is a pair the player can
 * still read, just not by hue.
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const vars = new Map();
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/gm)) vars.set(m[1], m[2]);

const srgb = (h) => [1, 3, 5].map((i, k) => parseInt(h.slice(1 + k * 2, 3 + k * 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/* Viénot, Brettel & Mollon (1999), applied in linear RGB. */
const CVD = {
  protanopia: [[0.1121, 0.8853, -0.0005], [0.1127, 0.8897, -0.0001], [0.0045, 0.0000, 1.0019]],
  deuteranopia: [[0.2920, 0.7054, -0.0003], [0.2934, 0.7089, 0.0000], [-0.0209, 0.4053, 0.6156]],
  tritanopia: [[1.0, 0.1420, -0.1420], [0.0, 0.9873, 0.0127], [0.0, 0.4404, 0.5596]],
};

function lab(hex, kind) {
  let lin = srgb(hex).map(toLin);
  if (kind) lin = mul(CVD[kind], lin).map((c) => Math.max(0, Math.min(1, c)));
  const [r, g, b] = lin;
  // sRGB D65 -> XYZ
  let X = r * 0.4124 + g * 0.3576 + b * 0.1805;
  let Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  let Z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  [X, Y, Z] = [X / 0.95047, Y, Z / 1.08883].map((t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116));
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dE = (a, b, k) => {
  const [l1, a1, b1] = lab(a, k), [l2, a2, b2] = lab(b, k);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};
const dL = (a, b, k) => Math.abs(lab(a, k)[0] - lab(b, k)[0]);

/* The pairs the contract actually promises are distinguishable. */
const MEANING = [
  ['--hot', 'hurts you'], ['--cool', 'yours'], ['--green', 'collect'],
  ['--gold', 'bomb / reward'], ['--violet', 'well / rare'],
];
const pairs = [];
for (let i = 0; i < MEANING.length; i++) {
  for (let j = i + 1; j < MEANING.length; j++) pairs.push([MEANING[i], MEANING[j]]);
}

/* Below this two colours read as the same at a glance in motion. */
const MIN_DE = 20;
/* ...unless luminance alone separates them by this much. */
const RESCUE_DL = 25;

console.log('\ncolourblind — can the colour contract still be read?\n');
const kinds = [null, 'protanopia', 'deuteranopia', 'tritanopia'];
console.log(`  ${'pair'.padEnd(30)} ${kinds.map((k) => (k ?? 'normal').slice(0, 8).padStart(9)).join('')}`);
console.log(`  ${'-'.repeat(30)} ${kinds.map(() => '-'.repeat(9)).join('')}`);

const fails = [];
for (const [[ka, na], [kb, nb]] of pairs) {
  const a = vars.get(ka), b = vars.get(kb);
  if (!a || !b) continue;
  const row = kinds.map((k) => dE(a, b, k));
  console.log(`  ${`${na} / ${nb}`.padEnd(30)} ${row.map((d) => d.toFixed(1).padStart(9)).join('')}`);
  for (let i = 1; i < kinds.length; i++) {
    if (row[i] < MIN_DE) {
      const lsep = dL(a, b, kinds[i]);
      if (lsep < RESCUE_DL) {
        fails.push(`${na} vs ${nb} collapse under ${kinds[i]} (dE ${row[i].toFixed(1)}, and only ${lsep.toFixed(1)} of lightness between them)`);
      } else {
        console.log(`      note: ${na}/${nb} lose hue separation under ${kinds[i]} (dE ${row[i].toFixed(1)}) but keep ${lsep.toFixed(1)} of lightness`);
      }
    }
  }
}

/*
 * THE CONTRACT LIVES ON THE FIELD, NOT IN THE STYLESHEET.
 *
 * The table above checks CSS custom properties, which are HUD text. The
 * objects the contract is actually about — shards, drops, bullets — are drawn
 * from bare HSL hue numbers in `world.ts` and `sprites.ts`, and never touch
 * the palette. Checking only the CSS would have declared the contract sound
 * while the things the player is looking at were untested.
 *
 * Lightness 74% and full saturation are what `glow()` in sprites.ts uses for
 * the body of a sprite, so that is the sample point.
 */
/*
 * WITHIN a category is a failure; ACROSS categories is a note.
 *
 * The first version failed every close pair and was wrong to. Shards are round
 * noteheads with a mint core; drops are squares with two letters in them. That
 * shape difference survives any amount of hue collapse, so a shard reading the
 * same colour as a drop is not a confusion the player can actually make.
 *
 * Two things still are. Two DROPS the same colour are both squares, and two
 * SHARDS the same colour are both noteheads — in each case colour is the only
 * thing carrying which one it is. Encoding category in shape and identity in
 * hue is the design that makes this tractable at all; there is no arrangement
 * of seven same-lightness hues that stays separable under dichromacy, which
 * the optimiser confirmed by topping out at dE 17.4 while producing a cyan
 * bomb.
 */
const CATEGORIES = [
  ['shard (round notehead)', [[150, 'minor'], [48, 'major'], [340, 'rare']]],
  ['drop (square + letters)', [[20, 'BOMB'], [330, 'ENCORE'], [175, 'WARD'], [300, 'OVERDRIVE']]],
];
function hsl(h, s2 = 1, l = 0.74) {
  const c = (1 - Math.abs(2 * l - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + t.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

for (const [cat, members] of CATEGORIES) {
  console.log(`\n  ON-FIELD, within ${cat}:`);
  console.log(`  ${'pair'.padEnd(30)} ${kinds.map((k) => (k ?? 'normal').slice(0, 8).padStart(9)).join('')}`);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = hsl(members[i][0]), b = hsl(members[j][0]);
      const row = kinds.map((k) => dE(a, b, k));
      console.log(`  ${`${members[i][1]} / ${members[j][1]}`.padEnd(30)} ${row.map((d) => d.toFixed(1).padStart(9)).join('')}`);
      for (let k = 0; k < kinds.length; k++) {
        if (row[k] < MIN_DE && dL(a, b, kinds[k]) < RESCUE_DL) {
          fails.push(`${cat}: ${members[i][1]} vs ${members[j][1]} collapse under ${kinds[k] ?? 'NORMAL VISION'} ` +
            `(hue ${members[i][0]} vs ${members[j][0]}, dE ${row[k].toFixed(1)})`);
        }
      }
    }
  }
}

console.log('');
if (fails.length) {
  for (const m of fails) console.log(`  FAIL  ${m}`);
  console.log('\n  A contract that encodes meaning in hue has to survive the eye that');
  console.log('  cannot read hue. Separate the pair by lightness, or by shape.');
  process.exit(1);
}
console.log('  ok  every meaning-bearing pair stays separable');
