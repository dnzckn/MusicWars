/*
 * _latticeshot — LOOK at the lattice in a real browser.
 *
 * Not a gate. Every gate in the suite reads counters; this exists because the
 * last pass shipped four statuses that were the same orange teardrop on screen
 * and nothing in the suite could tell. Three things it captures:
 *
 *   1. the ARRANGEMENT offer card, against a DUET offer card
 *   2. the celebration banner a lattice fusion produces
 *   3. a fusion actually FIRING, with a `vuln` ring on a body
 *
 * Usage: node --experimental-transform-types tools/_latticeshot.mjs
 */
import { chromium } from 'playwright';
import { installDriver } from './lib/driver.mjs';

const OUT = 'tools/_shotlattice';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const p = await b.newPage({ viewport: { width: 1440, height: 980 } });
p.on('pageerror', (e) => console.log('PAGE THROW:', String(e).slice(0, 240)));
p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 200)); });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button').catch(() => {});
await p.waitForTimeout(600);
await installDriver(p, 'weave');
await p.waitForTimeout(5000);

/* ------------------------------------------------- 1. the ARRANGEMENT card */
const held = await p.evaluate(() => {
  const w = window.__musicwars.world;
  const drive = window.__botInput;
  Object.defineProperty(drive, 'choice', { get: () => -1, set: () => {}, configurable: true });
  for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
  // EMBER + ANVIL -> BOMB is authored; EMBER + SIPHON is not, so it falls back.
  w.progression.instruments.ember = 3;
  w.progression.instruments.anvil = 3;
  w.progression.instruments.siphon = 3;
  w.progression.pending = 1;
  return Object.keys(w.progression.instruments);
});
await p.waitForTimeout(2400);
await p.screenshot({ path: `${OUT}/card-arrangement.png` });
console.log('held', held.join(', '));

const cards = await p.evaluate(() => {
  const w = window.__musicwars.world;
  return (w.progression.offer?.options ?? []).map((o) => ({ id: o.id, label: o.label, note: o.note, level: o.level }));
});
console.log('OFFER:', JSON.stringify(cards, null, 1));

/* ------------------------------------ 2. take the card, the REAL way through */

/*
 * Not by calling `applyFusion` from the console — by putting the ARRANGEMENT
 * card in a real offer and TAKING it, so the banner, the discovery hook and
 * the director's `onFusion` all run the path a player runs.
 */
/*
 * REROLL UNTIL THE CARD IS DEALT. AGENTS.md 5: "a ready fusion is always on
 * the table" is false — measured over 2,000 offers, a ready pair was absent
 * 12.4% of the time. The first run of this script drew an offer without it and
 * silently photographed four ordinary cards.
 */
let idx = -1;
for (let attempt = 0; attempt < 8 && idx < 0; attempt++) {
  idx = await p.evaluate(() => {
    const w = window.__musicwars.world;
    const opts = w.progression.offer?.options ?? [];
    return opts.findIndex((o) => o.id === 'detonate');
  });
  if (idx < 0) {
    await p.evaluate(() => { window.__musicwars.world.rerollOffer?.(); });
    await p.waitForTimeout(900);
  }
}
if (idx < 0) console.log('NEVER DEALT the arrangement card in 8 offers');
else await p.screenshot({ path: `${OUT}/card-arrangement.png` });
console.log('ARRANGEMENT card at index', idx);
await p.evaluate((k) => {
  const drive = window.__botInput;
  Object.defineProperty(drive, 'choice', { get: () => k, set: () => {}, configurable: true });
}, idx);
await p.waitForTimeout(500);
await p.evaluate(() => {
  const drive = window.__botInput;
  Object.defineProperty(drive, 'choice', { get: () => -1, set: () => {}, configurable: true });
});
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/celebration.png` });
console.log('AFTER TAKING:', await p.evaluate(() => {
  const w = window.__musicwars.world;
  return { held: w.progression.instruments, fusions: w.progression.fusions };
}));

/* ------------------------------------------------ 3. it fires, and it is visible */
const live = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  const hold = () => {
    for (const k of Object.keys(w.progression.instruments)) delete w.progression.instruments[k];
    // FROSTFIRE installs `vuln`; XRAY installs it two stacks at a time.
    w.progression.instruments.frostfire = 3;
    w.progression.instruments.xray = 3;
    w.progression.pending = 0;
    w.progression.offer = null;
  };
  w.jumpToWave?.(24);
  // Re-asserted while the clock runs, exactly as the headless harnesses do:
  // the bot answers offers, so a loadout set once does not stay set.
  hold();
  const t = setInterval(hold, 60);
  await new Promise((r) => setTimeout(r, 8000));
  clearInterval(t);
  const S = { Burn: 1, Poison: 2, Bleed: 4, Freeze: 8, Slow: 16, Blind: 32, Charm: 64, Vuln: 128 };
  const counts = {};
  for (const [k, bit] of Object.entries(S)) counts[k] = w.enemies.filter((e) => e.alive && (e.status & bit)).length;
  return {
    enemies: w.enemies.filter((e) => e.alive).length,
    statuses: counts,
    vulnStacks: w.enemies.filter((e) => e.alive && e.vulnStacks > 0).map((e) => e.vulnStacks).slice(0, 8),
    fires: Object.fromEntries(Object.entries(w.propFires).filter(([, v]) => v > 0)),
    dmg: Object.fromEntries(Object.entries(w.propDamage).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)])),
    bullets: w.playerBullets.count,
    effects: w.effects.length,
    novas: w.novas.length,
    propSets: w.propSets.length,
    overflow: w.propOverflow,
  };
});
console.log('LIVE:', JSON.stringify(live, null, 1));
await p.screenshot({ path: `${OUT}/firing.png` });

/* ------------------------------------------------------------------ 4. fps */
const fps = await p.evaluate(async () => {
  const w = window.__musicwars.world;
  let n = 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return {
    fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1),
    enemies: w.enemies.length,
    bullets: w.playerBullets.count,
    summons: w.summonsLive,
    statused: w.enemies.filter((e) => e.status !== 0).length,
    effects: w.effects.length,
    novas: w.novas.length,
  };
});
console.log('BUSY:', JSON.stringify(fps));
await p.screenshot({ path: `${OUT}/busy.png` });
await b.close();
