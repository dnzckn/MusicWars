// Does Chromium's audio actually reach the PulseAudio server on this machine?
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
const LIB = process.env.HOME + '/.cache/musicwars/native-libs';
const pactl = (args) => {
  try {
    return execFileSync(`${LIB}/usr/bin/pactl`, args, {
      encoding: 'utf8',
      env: { ...process.env, LD_LIBRARY_PATH: `${LIB}/usr/lib/x86_64-linux-gnu:${LIB}/usr/lib/x86_64-linux-gnu/pulseaudio` },
    });
  } catch (e) { return 'pactl failed: ' + e.message; }
};
const withPulse = process.argv.includes('--with-pulse');
const env = { ...process.env };
if (withPulse) env.LD_LIBRARY_PATH = `${LIB}/usr/lib/x86_64-linux-gnu:${LIB}/usr/lib/x86_64-linux-gnu/pulseaudio` + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '');
console.log(`libpulse on path: ${withPulse}`);
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, env, args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
// Keep the user's speakers safe: the point is whether a stream exists, not how loud.
await p.evaluate(() => { const s = document.getElementById('ui-volume'); s.value = '10'; s.dispatchEvent(new Event('input')); });
await p.waitForTimeout(6000);
console.log('--- sinks ---\n' + pactl(['list', 'short', 'sinks']));
console.log('--- sink-inputs ---\n' + (pactl(['list', 'short', 'sink-inputs']) || '(none)'));
console.log('--- clients ---\n' + pactl(['list', 'short', 'clients']));
console.log('--- ctx state ---', await p.evaluate(() => { const a = window.__musicwars?.readout?.(); return JSON.stringify(a?.section ?? 'n/a'); }));
await b.close();
