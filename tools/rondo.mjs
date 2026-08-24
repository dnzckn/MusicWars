/**
 * Does a theme actually come back?
 *
 * Themes were selected `wave % THEMES.length`, so a tune played for one wave
 * and then did not return for several minutes — a playlist, not a score. Eight
 * tunes heard once each is how you guarantee none of them becomes a hook, and
 * the hook is the point.
 *
 * The structure is a rondo: a signature theme every other wave, episodes
 * between, and the signature always on boss waves. This asserts that shape
 * directly rather than inferring it from audio, because the audio deliberately
 * develops the theme each time it returns — a listening test would be measuring
 * the development, not the recurrence.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
const r = await p.evaluate(() => {
  const f = window.__musicwars.themeForWave;
  if (!f) return null;
  const id = (t) => JSON.stringify(t.a) + JSON.stringify(t.b);
  const plain = [], boss = [];
  for (let w = 0; w < 16; w++) plain.push(id(f(w, false)));
  for (let w = 0; w < 16; w++) boss.push(id(f(w, true)));
  const signature = plain[0];
  return {
    signatureShare: plain.filter((x) => x === signature).length / plain.length,
    distinct: new Set(plain).size,
    bossAlwaysSignature: boss.every((x) => x === signature),
    // Longest run of waves without the signature: the gap a listener has to
    // hold the tune across.
    longestGap: plain.reduce((acc, x) => (x === signature ? { run: 0, max: acc.max } : { run: acc.run + 1, max: Math.max(acc.max, acc.run + 1) }), { run: 0, max: 0 }).max,
  };
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
if (!r) { console.log('themeForWave not exposed (production build?) - skipping'); process.exit(0); }
console.log(JSON.stringify(r, null, 1));
const ok = r.signatureShare >= 0.4 && r.distinct >= 4 && r.bossAlwaysSignature && r.longestGap <= 2;
console.log(ok ? 'THE TUNE COMES BACK' : 'NO RECURRING THEME');
process.exit(ok ? 0 : 1);
