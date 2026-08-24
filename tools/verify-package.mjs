import { chromium } from 'playwright';
// Resolve a readable Chromium first; see tools/lib/chromepath.mjs.
import './lib/chromepath.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const page = await browser.newPage();
await page.addInitScript(() => {
  const oc = AudioNode.prototype.connect;
  window.__tap = null;
  AudioNode.prototype.connect = function (d, ...r) {
    const res = oc.call(this, d, ...r);
    try { if (d && d.context && d === d.context.destination) {
      if (!window.__tap) { const a = d.context.createAnalyser(); a.fftSize = 2048; window.__tap = a; window.__buf = new Float32Array(a.fftSize); }
      oc.call(this, window.__tap);
    } } catch {}
    return res;
  };
});
const errs = [];
page.on('pageerror', (e) => errs.push(e.message + ' || ' + (e.stack||'').split('\n').slice(0,4).join(' ~ ')));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(process.env.TARGET, { waitUntil: 'networkidle' });
await page.click('#start-button');
await page.waitForTimeout(3000);
await page.keyboard.down('KeyZ');
const r = await page.evaluate(async () => {
  let peak = 0, sum = 0, n = 0;
  const end = performance.now() + 9000;
  while (performance.now() < end) {
    const a = window.__tap;
    if (a) { a.getFloatTimeDomainData(window.__buf);
      let acc = 0, mx = 0;
      for (let i = 0; i < window.__buf.length; i++) { const v = window.__buf[i]; acc += v*v; if (Math.abs(v) > mx) mx = Math.abs(v); }
      sum += Math.sqrt(acc / window.__buf.length); peak = Math.max(peak, mx); n++;
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return { rms: n ? sum/n : 0, peak, hud: {
    section: document.getElementById('ui-section').textContent,
    bpm: document.getElementById('ui-bpm').textContent,
    key: document.getElementById('ui-key').textContent,
    audio: document.getElementById('ui-audio').textContent,
    fps: document.getElementById('ui-fps').textContent,
    bullets: document.getElementById('ui-bullets').textContent,
  } };
});
await page.keyboard.up('KeyZ');
await page.screenshot({ path: 'tools/shot-single.png' });
await browser.close();
console.log(JSON.stringify(r, null, 1));
console.log('errors:', errs.length ? errs.slice(0,5) : 'none');
if (r.rms < 0.002 || errs.length) process.exit(1);
console.log('SINGLE-FILE BUILD OK');
