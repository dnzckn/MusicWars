/**
 * Proves the Electron build makes sound — twice, at two different depths.
 *
 * `audiocheck.mjs` taps AudioNode.connect and measures what reaches the
 * AudioContext destination. That is the right check for a browser, but it
 * cannot see the failure this shell was written to survive: under WSL2, a
 * Chromium without libpulse renders the whole graph correctly and then hands it
 * to an audio backend with nowhere to put it. The destination tap reads a
 * healthy RMS and the room stays quiet.
 *
 * So this check does both:
 *
 *   1. the same destination tap, over CDP, inside the real Electron window —
 *      "the game is producing signal";
 *   2. `parec` on RDPSink.monitor, which is the PulseAudio sink WSLg forwards to
 *      Windows — "the signal left the process".
 *
 * (2) is the one that matters. It is measuring the same bytes the speakers get.
 *
 * Usage: npm run desktopcheck            (against the dev server)
 *        npm run desktopcheck -- --prod  (against dist/)
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
import { LIB_DIR, libSearchPath } from './desktop-deps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MUSICWARS_CDP_PORT || 9333);
const MODE = process.argv.includes('--prod') ? '--prod' : process.argv.includes('--single') ? '--single' : '--dev';
/* Loud enough to measure, quiet enough not to make a machine shout at 1am. */
const VOLUME = Number(process.env.MUSICWARS_TEST_VOLUME || 18);

const pulseEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [...libSearchPath(), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};
const PACTL = join(LIB_DIR, 'usr/bin/pactl');
const PAREC = join(LIB_DIR, 'usr/bin/parec');
const havePulseTools = existsSync(PACTL) && existsSync(PAREC);

const pactl = (...args) => {
  try { return execFileSync(PACTL, args, { encoding: 'utf8', env: pulseEnv }).trim(); }
  catch { return ''; }
};

/** Capture `seconds` of whatever PulseAudio is sending to the host and measure it. */
function captureMonitor(device, seconds) {
  return new Promise((resolveCapture) => {
    const child = spawn(PAREC, ['--device', device, '--format=s16le', '--rate=44100', '--channels=2', '--raw'],
      { env: pulseEnv, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout.on('data', (c) => chunks.push(c));
    child.on('error', () => resolveCapture(null));
    setTimeout(() => {
      child.kill('SIGINT');
      const buf = Buffer.concat(chunks);
      if (buf.length < 4096) { resolveCapture(null); return; }
      let acc = 0, peak = 0, n = 0;
      for (let i = 0; i + 1 < buf.length; i += 2) {
        const v = buf.readInt16LE(i) / 32768;
        acc += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
        n++;
      }
      resolveCapture({ rms: Math.sqrt(acc / n), peak, seconds: n / 2 / 44100, pcm: buf });
    }, seconds * 1000);
  });
}

/** Minimal 16-bit stereo WAV header so a human can listen to what we measured. */
function wav(pcm, rate = 44100, channels = 2) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * channels * 2, 28); head.writeUInt16LE(channels * 2, 32);
  head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

const waitFor = async (fn, ms, step = 400) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
};

console.log('');
if (havePulseTools) {
  const info = pactl('info');
  console.log(`pulse server: ${/Server String: (.*)/.exec(info)?.[1] || 'unreachable'}`);
  console.log(`sinks before: ${pactl('list', 'short', 'sinks').replace(/\s+/g, ' ') || '(none)'}`);
} else {
  console.log('pulse tools absent (npm run desktop:deps) — OS-level audio will not be measured');
}

const app = spawn('node', [join(ROOT, 'electron/launch.mjs'), MODE, `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const appLog = [];
app.stdout.on('data', (d) => appLog.push(String(d)));
app.stderr.on('data', (d) => appLog.push(String(d)));
let appExited = false;
app.on('exit', (code) => { appExited = true; appLog.push(`\n[electron exited ${code}]`); });

const shutdown = () => { try { app.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', shutdown);

const endpoint = await waitFor(async () => {
  if (appExited) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return (await res.json()).webSocketDebuggerUrl;
  } catch { return null; }
}, 60000);

if (!endpoint) {
  console.log('\n  ✗ Electron never opened a debugger port. Output:\n');
  console.log(appLog.join('').split('\n').map((l) => '    ' + l).join('\n'));
  shutdown();
  process.exit(1);
}

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = await waitFor(async () => context.pages().find((p) => !p.url().startsWith('devtools://')), 20000);
if (!page) { console.log('  ✗ no page in the Electron context'); shutdown(); process.exit(1); }

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// In dev mode this window is pointed at the same dev server everyone else is
// editing against; without the HMR websocket mocked, somebody saving a file in
// src/ reloads the page out from under the measurement.
const reloads = await freezePage(page);

/*
 * The tap has to exist before the page's first script runs, so install it and
 * reload. Reloading in the shell is free — there is no navigation state to lose.
 */
await page.addInitScript(() => {
  const origConnect = AudioNode.prototype.connect;
  window.__tap = null;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const result = origConnect.call(this, dest, ...rest);
    try {
      if (dest && dest.context && dest === dest.context.destination) {
        if (!window.__tap) {
          const a = dest.context.createAnalyser();
          a.fftSize = 2048;
          window.__tap = a;
          window.__buf = new Float32Array(a.fftSize);
        }
        origConnect.call(this, window.__tap);
      }
    } catch { /* a node that refuses the extra fan-out is not worth failing over */ }
    return result;
  };
  // Autoplay policy, measured rather than assumed: a context created with no
  // user gesture anywhere in the page's history should already be running.
  window.__autoplay = (() => {
    try {
      const probe = new (window.AudioContext || window.webkitAudioContext)();
      const state = probe.state;
      void probe.close();
      return state;
    } catch (e) { return 'error: ' + e.message; }
  })();
});
await page.reload({ waitUntil: 'load' });

const shell = await page.evaluate(() => window.musicwarsDesktop || null);
const autoplay = await page.evaluate(() => window.__autoplay);
console.log(`shell:         ${shell ? `electron ${shell.electron} / chromium ${shell.chrome}` : 'NOT the desktop shell'}`);
console.log(`autoplay:      fresh AudioContext without a gesture is "${autoplay}"`);

await page.waitForSelector('#start-button', { timeout: 20000 });
await page.click('#start-button');
await page.evaluate((v) => {
  const s = document.getElementById('ui-volume');
  if (s) { s.value = String(v); s.dispatchEvent(new Event('input')); }
}, VOLUME);
console.log(`volume:        set to ${VOLUME}% for the measurement`);

// Let the eight-bar intro assemble, then play so the arrangement has something
// to react to.
await page.waitForTimeout(9000);
await page.keyboard.down('KeyZ');

const monitorDevice = havePulseTools
  ? (pactl('list', 'short', 'sources').split('\n').map((l) => l.split('\t')[1]).find((n) => n && n.endsWith('.monitor')) || null)
  : null;

const capturePromise = monitorDevice ? captureMonitor(monitorDevice, 8) : Promise.resolve(null);

const graph = await page.evaluate(async () => {
  const out = { peak: 0, sum: 0, n: 0, silent: 0 };
  const end = performance.now() + 8000;
  while (performance.now() < end) {
    const a = window.__tap;
    if (a) {
      a.getFloatTimeDomainData(window.__buf);
      let acc = 0, mx = 0;
      for (let i = 0; i < window.__buf.length; i++) {
        const v = window.__buf[i];
        acc += v * v;
        if (Math.abs(v) > mx) mx = Math.abs(v);
      }
      const rms = Math.sqrt(acc / window.__buf.length);
      out.sum += rms; out.n++;
      if (rms < 1e-5) out.silent++;
      if (mx > out.peak) out.peak = mx;
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return out;
});
const captured = await capturePromise;
await page.keyboard.up('KeyZ');

const sinkState = havePulseTools ? pactl('list', 'short', 'sinks').replace(/\s+/g, ' ') : '';
const sinkInputs = havePulseTools ? pactl('list', 'short', 'sink-inputs') : '';
// `ui-fps` is behind the gear now and is not written while it is shut.
await page.evaluate(() => window.__musicwars?.hud?.setSettings(true));
await new Promise((r) => setTimeout(r, 400));
const fps = await page.evaluate(() => Number(document.getElementById('ui-fps')?.textContent) || 0);
const readout = await page.evaluate(() => {
  const r = window.__musicwars?.readout?.();
  return r ? { section: r.section, tension: +r.tension.toFixed(3), bpm: r.bpm } : null;
});

await page.screenshot({ path: join(ROOT, 'tools/desktop.png') });
if (reloads() > 0) console.log(`WARNING: the window reloaded ${reloads()}x mid-run — these numbers span more than one build`);
await browser.close();
shutdown();

const graphRms = graph.n ? graph.sum / graph.n : 0;
const silentPct = graph.n ? (graph.silent / graph.n) * 100 : 100;

console.log('');
console.log(`in-graph:      rms=${graphRms.toFixed(4)} peak=${graph.peak.toFixed(3)} silent=${silentPct.toFixed(0)}% of frames`);
if (captured) {
  console.log(`at the sink:   rms=${captured.rms.toFixed(4)} peak=${captured.peak.toFixed(3)} over ${captured.seconds.toFixed(1)}s of ${monitorDevice}`);
  writeFileSync(join(ROOT, 'tools/desktop-audio.wav'), wav(captured.pcm));
  console.log(`               written to tools/desktop-audio.wav — play it`);
} else if (monitorDevice) {
  console.log(`at the sink:   captured nothing from ${monitorDevice}`);
}
if (havePulseTools) {
  console.log(`sinks after:   ${sinkState || '(none)'}`);
  console.log(`sink-inputs:   ${sinkInputs ? sinkInputs.replace(/\n/g, ' | ') : '(none — nothing is playing to the OS)'}`);
}
console.log(`game:          ${fps}fps${readout ? ` · ${readout.section} t=${readout.tension} ${readout.bpm}bpm` : ''}`);

const fail = [];
if (!shell) fail.push('the page under test is not the Electron shell — the preload did not run');
if (graphRms < 0.002) fail.push(`no signal inside the audio graph (rms ${graphRms.toFixed(5)})`);
if (silentPct > 50) fail.push(`graph silent for ${silentPct.toFixed(0)}% of frames`);
if (monitorDevice) {
  // The threshold is deliberately low. This is a yes/no about whether audio
  // leaves the process; loudness is audiocheck's business, and the game is
  // being measured at a fraction of its normal volume.
  if (!captured) fail.push('could not read the PulseAudio monitor at all');
  else if (captured.rms < 1e-4) fail.push(`the graph is loud but the sink is silent (rms ${captured.rms.toFixed(6)}) — audio is not leaving the process`);
}
if (errors.length) fail.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);

console.log('');
if (fail.length) {
  fail.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('=== DESKTOP AUDIO VERIFIED ===');
console.log(monitorDevice
  ? `   signal inside the graph (${graphRms.toFixed(4)}) and at the PulseAudio sink (${captured.rms.toFixed(4)}) — it reaches the speakers`
  : `   signal inside the graph (${graphRms.toFixed(4)}); no PulseAudio monitor here, so OS output was not measured`);
