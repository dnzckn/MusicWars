/**
 * Confirms each archetype names itself once, and does not talk over waves.
 *
 * Asserts on the banner's typed `kind`, not on its text. An earlier version
 * regex-matched known prefixes, so adding any new announcement type would have
 * silently started counting it as an archetype introduction — the same way a
 * previous test passed for nineteen iterations while its feature was broken.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.evaluate(() => {
  window.__banners = [];
  let last = '';
  setInterval(() => {
    const w = window.__musicwars.world;
    if (w.banner && w.banner !== last && w.bannerAge < 0.6) {
      last = w.banner;
      window.__banners.push({ text: w.banner, sub: w.bannerSub, kind: w.bannerKind });
    }
  }, 60);
});
await p.keyboard.down('KeyZ');
// Walk through several waves so a range of archetypes appears.
for (const wave of [0, 3, 6, 9, 12]) {
  await p.evaluate((wv) => {
    const w = window.__musicwars.world;
    w.jumpToWave(wv); w.player.lives = 4; w.player.hp = w.player.maxHp;
  }, wave);
  await p.waitForTimeout(11000);
}
await p.keyboard.up('KeyZ');
const r = await p.evaluate(() => {
  const b = window.__banners;
  const intros = b.filter((x) => x.kind === 'archetype');
  const names = intros.map((x) => x.text);
  return {
    banners: b,
    intros: names,
    repeatedIntros: [...new Set(names.filter((x, i) => names.indexOf(x) !== i))],
    kinds: [...new Set(b.map((x) => x.kind))],
    introsWithoutMotif: intros.filter((x) => !x.sub).length,
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
for (const x of r.banners) console.log(`  [${x.kind.padEnd(9)}] ${x.text.padEnd(14)} ${x.sub}`);
console.log(`\n${r.banners.length} banners across kinds: ${r.kinds.join(', ')}`);
console.log(`archetype introductions: ${r.intros.join(', ') || 'none'}`);
console.log(`repeated: ${r.repeatedIntros.join(', ') || 'none'}   without a motif: ${r.introsWithoutMotif}`);
const ok = r.intros.length >= 3 && r.repeatedIntros.length === 0 && r.introsWithoutMotif === 0;
console.log(ok ? 'ARCHETYPES INTRODUCE THEMSELVES ONCE, WITH THEIR MOTIF' : 'introduction logic off');
if (!ok) process.exit(1);
