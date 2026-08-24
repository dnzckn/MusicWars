/*
 * drops — the field-drop economy, in plain Node.
 *
 * `tools/deadair.mjs` owns the "is the player holding anything" threshold, but
 * it drives a browser, and on a stalled box that is 81% of the suite going
 * dark (see the verification notes). The uptime half of it is a pure sim
 * question — `World` runs headless — so this asks it without Chromium, and
 * adds the constraint deadair cannot see: WHICH kind is supplying the uptime.
 *
 * That distinction is the whole point. Before WARD existed the random pool was
 * BOMB (a charge, no duration) and OVERDRIVE (12s), so every point of "not
 * empty" came from OVERDRIVE, and OVERDRIVE pins the mix to its top rung.
 * deadair read 42% empty and passed while the score was pinned for half the
 * run: the metric was satisfied by the very thing that was breaking the music.
 * A single-source uptime number is the defect, so it is checked here directly.
 */
import './lib/headless-audio.mjs';
const R = new URL('../src/', import.meta.url).pathname;
const { World } = await import(`${R}game/world.ts`);
const { POWERUPS } = await import(`${R}game/powerups.ts`);

const DT = 1 / 120;
const SECS = Number(process.argv[2] ?? 900);
/** deadair.mjs gates on `noPowerups / samples < 0.55`; matched deliberately. */
const MAX_EMPTY = 0.55;
/*
 * No kind may be effectively permanent. Not a share — an absolute.
 *
 * The first version of this gate capped any one kind's SHARE of total uptime
 * at 75%, and it failed the moment it was written. That threshold cannot be
 * met by this pool and never could: BOMB is a charge with no duration and
 * OVERDRIVE has to stay rare for the mix, so exactly one kind is left to carry
 * uptime and concentration is forced by arithmetic. A gate the design cannot
 * satisfy is a bad gate, and tuning the design to hit a number invented in the
 * same commit would have been the wrong way round.
 *
 * What actually went wrong before WARD was not concentration. It was WHICH
 * kind was concentrated: the carrier was OVERDRIVE, which forces the
 * arrangement to its top rung, so keeping the player supplied and keeping the
 * music dynamic were the same dial pulling opposite ways. The two real
 * invariants are below — nothing is permanent, and the carrier is never a kind
 * that seizes the arrangement.
 */
const MAX_ANY_UPTIME = 0.7;
/** OVERDRIVE forces a drop; above this it is the setting, not an accent. */
const MAX_OVERDRIVE = 0.3;

const timed = new Set(POWERUPS.filter((p) => p.duration > 0).map((p) => p.kind));
const w = new World(0x51ed); w.start();
const picks = new Map(); const times = [];
w.bus.on('powerup:pickup', (e) => {
  picks.set(e.kind, (picks.get(e.kind) ?? 0) + 1);
  times.push([e.kind, w.snapshot.time ?? 0]);
});
const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
const heldBy = new Map();
let n = 0, any = 0;
for (let i = 0; i < Math.round(SECS / DT); i++) {
  inp.x = Math.sin(i * DT * 3) * 0.35;
  inp.y = Math.cos(i * DT * 2.3) * 0.25;
  w.update(DT, inp);
  if (i % 30) continue;
  n++;
  const pw = w.snapshot.powerups ?? {};
  const held = Object.entries(pw).filter(([k, v]) => timed.has(k) && v > 0).map(([k]) => k);
  if (held.length) any++;
  for (const k of held) heldBy.set(k, (heldBy.get(k) ?? 0) + 1);
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

console.log(`\ndrops — ${SECS}s, wave ${w.snapshot.wave}, ${n} samples`);
console.log('  pickups: ' + [...picks.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  '));
console.log(`  empty-handed ${pct((n - any) / n)}   holding something ${pct(any / n)}`);
console.log('  uptime by kind:');
for (const [k, v] of [...heldBy.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${k.padEnd(10)} ${pct(v / n).padStart(6)} of run   ${pct(v / any).padStart(6)} of all uptime`);
}
for (const kind of ['overdrive', 'ward']) {
  const ts = times.filter((t) => t[0] === kind).map((t) => t[1]);
  const g = []; for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
  const def = POWERUPS.find((p) => p.kind === kind);
  if (g.length) console.log(`  ${kind}: median gap ${med(g).toFixed(1)}s vs ${def.duration}s duration` +
    (med(g) < def.duration ? '  <- re-upped before it can lapse' : ''));
}

const fails = [];
if ((n - any) / n >= MAX_EMPTY) fails.push(`empty-handed ${pct((n - any) / n)} — deadair.mjs fails at ${pct(MAX_EMPTY)}`);
const od = (heldBy.get('overdrive') ?? 0) / n;
if (od > MAX_OVERDRIVE) fails.push(`OVERDRIVE held ${pct(od)} of the run (max ${pct(MAX_OVERDRIVE)}) — see npm run overdrive`);
for (const [k, v] of heldBy) {
  if (v / n > MAX_ANY_UPTIME) fails.push(`${k} is held ${pct(v / n)} of the run (max ${pct(MAX_ANY_UPTIME)}) — that is a baseline, not a pickup`);
}
/*
 * FORCING kinds seize the arrangement rather than colouring it, so they must
 * never be what keeps the player supplied. WARD carrying the pool is fine and
 * intended — a dark sustained pad is safe to have on often, which is exactly
 * why it was chosen for the job.
 */
const FORCING = ['overdrive'];
const top = [...heldBy.entries()].sort((a, b) => b[1] - a[1])[0];
if (top && FORCING.includes(top[0])) {
  fails.push(`${top[0]} is the largest source of uptime (${pct(top[1] / any)} of it) — it forces the arrangement, so it must never be the buff the player is usually holding`);
}
console.log('');
if (fails.length) {
  for (const m of fails) console.log(`  FAIL  ${m}`);
  process.exit(1);
}
console.log(`  ok  the player is rarely empty, nothing is permanent, and the carrier is ${top ? top[0] : 'none'}`);
console.log('\n  Baseline 2026-08-22, after WARD and the OVERDRIVE ration:');
console.log('    empty 41.3%  ward 49.3% of run (84% of uptime)  overdrive 13.4%.');
console.log('    Before: empty 42.1%, overdrive 52.8% and 91% of all uptime — the player');
console.log('    could not be kept supplied without pinning the mix. WARD carrying the pool');
console.log('    is the intended shape, not a leftover problem; see MAX_ANY_UPTIME above.');
