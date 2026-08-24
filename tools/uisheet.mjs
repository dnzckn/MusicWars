/*
 * uisheet — draw the interface decisions so a person can look at them.
 *
 * Every UI check in this directory returns a number. `legibility` says --dim is
 * 4.95:1, `typescale` says nothing is under 9px, `colourblind` says ENCORE and
 * the major shard are 25 dE apart. All true, and none of it tells you what the
 * thing LOOKS like — and the browser tools that could screenshot the real HUD
 * are dark whenever this box stalls.
 *
 * SVG rather than a raster, deliberately: it is text, so it needs no canvas
 * implementation and no font rasteriser, and the type sizes in it are the
 * REAL px values from `style.css`. A 9px label on this sheet is exactly as
 * small as a 9px label in the game.
 *
 * It reads `style.css` and the game source rather than restating them, so it
 * cannot drift into being a picture of what the palette used to be.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const vars = new Map();
for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/gm)) vars.set(m[1], m[2]);

const powerups = readFileSync(new URL('../src/game/powerups.ts', import.meta.url), 'utf8');
const DROPS = [...powerups.matchAll(/kind: '(\w+)', label: '([^']+)', duration: \d+, hue: (\d+), weight: ([0-9.]+)/g)]
  .filter((m) => Number(m[4]) > 0 || m[1] === 'encore')
  .map((m) => ({ kind: m[1], label: m[2], hue: Number(m[3]) }));

const world = readFileSync(new URL('../src/game/world.ts', import.meta.url), 'utf8');
const shardLine = world.match(/SHARD_HUES[^=]*=\s*\{([^}]+)\}/);
const SHARDS = [...shardLine[1].matchAll(/(\w+):\s*(\d+)/g)].map((m) => ({ tier: m[1], hue: Number(m[2]) }));

/* --- colour maths, shared with legibility/colourblind ------------------- */
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
const lum = (h) => { const [r, g, b] = rgb(h).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const CVD = {
  protanopia: [[0.1121, 0.8853, -0.0005], [0.1127, 0.8897, -0.0001], [0.0045, 0, 1.0019]],
  deuteranopia: [[0.2920, 0.7054, -0.0003], [0.2934, 0.7089, 0], [-0.0209, 0.4053, 0.6156]],
};
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v * 255))).toString(16).padStart(2, '0')).join('');
const simulate = (h, kind) => (kind ? hex(mul(CVD[kind], rgb(h).map(toLin)).map((c) => toSrgb(Math.max(0, Math.min(1, c))))) : h);
function hsl(h, s = 1, l = 0.74) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex(t.map((v) => v + m));
}

/* --- the sheet ---------------------------------------------------------- */
const W = 900;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const out = [];
let y = 0;
const bg = vars.get('--bg'), panel = vars.get('--panel');
const push = (s) => out.push(s);
const text = (x, yy, s, fill, size = 11, weight = 400) =>
  push(`<text x="${x}" y="${yy}" fill="${fill}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" xml:space="preserve">${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`);

y = 34;
text(28, y, 'MusicWars — interface reference', vars.get('--ink'), 17, 700);
y += 16;
text(28, y, 'generated from src/style.css, powerups.ts and world.ts — not hand-written', vars.get('--dim'), 9);

/* HUD inks, at real size, on the real panel. */
y += 40;
text(28, y, 'HUD INKS  (contrast vs --panel, WCAG AA needs 4.5:1 for text)', vars.get('--ink-2'), 11, 700);
y += 10;
const INKS = ['--ink', '--ink-2', '--dim', '--hot', '--cool', '--gold', '--green', '--violet'];
for (const ink of INKS) {
  y += 26;
  push(`<rect x="28" y="${y - 14}" width="${W - 56}" height="24" fill="${panel}" rx="3"/>`);
  push(`<rect x="34" y="${y - 10}" width="16" height="16" fill="${vars.get(ink)}" rx="2"/>`);
  text(58, y + 2, ink.replace('--', '').padEnd(9), vars.get('--dim'), 10);
  text(140, y + 2, vars.get(ink), vars.get('--dim'), 10);
  text(212, y + 2, 'The quick brown fox — 9px', vars.get(ink), 9);
  text(400, y + 2, 'The quick brown fox — 11px', vars.get(ink), 11);
  const r = ratio(vars.get(ink), panel);
  text(620, y + 2, `${r.toFixed(2)}:1`, r >= 4.5 ? vars.get('--green') : vars.get('--hot'), 10, 700);
  text(690, y + 2, r >= 4.5 ? 'AA' : 'FAILS AA', r >= 4.5 ? vars.get('--green') : vars.get('--hot'), 10);
}

/* Type scale, at real size. */
y += 48;
text(28, y, 'TYPE SCALE  (9px is the floor — twelve declarations were below it)', vars.get('--ink-2'), 11, 700);
y += 8;
for (const px of [9, 10, 11, 12, 13, 17]) {
  y += px + 12;
  text(28, y, `${String(px).padStart(2)}px`, vars.get('--dim'), 9);
  text(70, y, 'WAVE 12  x3.4  COMBO 27  — how this reads at actual size', vars.get('--ink'), px);
}

/* On-field objects, normal vision and two dichromacies. */
y += 46;
text(28, y, 'ON-FIELD COLOURS  (shards are round noteheads, drops are squares)', vars.get('--ink-2'), 11, 700);
y += 14;
const VIEWS = [null, 'protanopia', 'deuteranopia'];
for (const view of VIEWS) {
  y += 46;
  text(28, y - 12, view ?? 'normal vision', vars.get('--dim'), 9);
  let x = 150;
  for (const s of SHARDS) {
    const c = simulate(hsl(s.hue), view);
    push(`<circle cx="${x + 11}" cy="${y - 6}" r="9" fill="${c}"/>`);
    push(`<ellipse cx="${x + 11}" cy="${y - 6}" rx="3.1" ry="2.3" fill="#b6ffd9" transform="rotate(-20 ${x + 11} ${y - 6})"/>`);
    text(x, y + 14, s.tier, vars.get('--dim'), 8);
    x += 74;
  }
  x += 30;
  for (const d of DROPS) {
    const c = simulate(hsl(d.hue), view);
    push(`<rect x="${x}" y="${y - 15}" width="18" height="18" fill="none" stroke="${c}" stroke-width="2"/>`);
    text(x + 2, y - 2, d.label.slice(0, 2), c, 9, 700);
    text(x, y + 14, d.label.toLowerCase().slice(0, 9), vars.get('--dim'), 8);
    x += 74;
  }
}

y += 52;
text(28, y, 'ENCORE moved from hue 45 to 330: at 45 it was three degrees from the major shard (48),', vars.get('--dim'), 9);
y += 13;
text(28, y, 'i.e. the mercy drop looked like the commonest object on the field. Shard tiers were all', vars.get('--dim'), 9);
y += 13;
text(28, y, 'drawn at hue 150 regardless of tier until this session — a rare shard looked like a minor one.', vars.get('--dim'), 9);

const H = y + 30;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="${bg}"/>` + out.join('') + '</svg>';
const dest = process.argv[2] ?? 'renders/uisheet.svg';
writeFileSync(dest, svg);
console.log(`uisheet — wrote ${dest} (${W}x${H}, ${(svg.length / 1024).toFixed(1)}kB)`);
console.log(`  ${INKS.length} inks, ${SHARDS.length} shard tiers, ${DROPS.length} drops, ${VIEWS.length} vision models`);
