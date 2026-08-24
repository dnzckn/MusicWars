/**
 * What does the first phrase actually sound like?
 *
 * This replaces an older `introcheck` that asserted layers entered in order and
 * that loudness rose. Both were true of a four-bar intro in which the melody
 * played zero notes, so it passed for nineteen iterations while the feature it
 * named did nothing. Asserting on the actual note content is harder to satisfy
 * by accident than asserting on a property derived from it.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
const rows = await p.evaluate(async () => {
  const mw = window.__musicwars;
  const out = [];
  let lastBar = -1;
  const end = performance.now() + 26000;
  while (performance.now() < end) {
    const bar = Math.floor(mw.readout().bar);
    if (bar !== lastBar && bar >= 0) {
      lastBar = bar;
      const s = mw.director.sampleBar(mw.world.transport);
      const rd = mw.readout();
      out.push({ bar, section: rd.section,
        lead: s.lead.length, arp: s.arp.length, chords: s.chords.length,
        kick: s.kick.length, hats: s.hats.length,
        leadLvl: +rd.levels.lead.toFixed(2) });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
});
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();
console.table(rows.slice(0, 12));
const intro = rows.filter((r) => r.section === 'intro');
const mean = (a, k) => (a.length ? a.reduce((x, y) => x + y[k], 0) / a.length : 0);
console.log(`intro bars: ${intro.length}, mean lead notes/bar: ${mean(intro, 'lead').toFixed(1)}`);

// Order of arrival: harmony, then melody, then rhythm.
const firstWith = (k) => rows.find((r) => r[k] > 0)?.bar ?? -1;
const order = { chords: firstWith('chords'), lead: firstWith('lead'), kick: firstWith('kick'), hats: firstWith('hats') };
console.log('first bar each stem sounds:', JSON.stringify(order));

const fail = [];
if (intro.length < 6) fail.push(`intro lasted only ${intro.length} bars; it is meant to be 8`);
if (mean(intro, 'lead') < 1.5) fail.push(`melody averaged ${mean(intro, 'lead').toFixed(1)} notes/bar in the intro`);
if (mean(intro, 'chords') < 2) fail.push('harmony barely present in the intro');
if (order.chords < 0 || order.lead < 0) fail.push('harmony or melody never sounded');
if (order.lead < order.chords) fail.push('melody arrived before the harmony that frames it');
if (order.kick >= 0 && order.kick < order.lead) fail.push('drums arrived before the tune');
if (fail.length) {
  console.log('\n=== FAILURES ===');
  fail.forEach((f) => console.log('  x ' + f));
  process.exit(1);
}
console.log('\nOPENING STATES THE THEME');
