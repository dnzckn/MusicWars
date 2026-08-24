/**
 * Launcher for the desktop shell.
 *
 * All this does is start Electron with an environment in which its audio
 * backend can actually find a sound server. That sounds like a nothing, and on
 * a normal Linux desktop it is — the whole file no-ops. Under WSL2 it is the
 * difference between a game that plays and a game that mimes:
 *
 *   WSLg runs a PulseAudio server on the Windows side and exports it as a unix
 *   socket at /mnt/wslg/PulseServer, with PULSE_SERVER already pointing at it.
 *   Chromium's audio backend reaches that server by dlopen()ing libpulse.so.0.
 *   If the library is not installed it does not error — it falls back to ALSA,
 *   and this distro image has no ALSA device at all (/dev/snd holds one entry,
 *   `timer`). The result is an AudioContext in state "running", a scheduler
 *   ticking, every sample rendered, and silence. The failure has no error
 *   message anywhere in it, which is this project's recurring theme.
 *
 * `npm run desktop:deps` unpacks libpulse (and the three libraries Chromium
 * links outright) into ~/.cache/musicwars/native-libs without root. This picks
 * that up if it is there and says so loudly if it is not.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { libSearchPath, runtimeLibsPresent, LIB_DIR } from '../tools/desktop-deps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);

const isWSL = (() => {
  if (process.platform !== 'linux') return false;
  if (existsSync('/mnt/wslg')) return true;
  try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { return false; }
})();

let electronBin;
try {
  electronBin = require('electron');
} catch {
  console.error('\n  electron is not installed — run `npm install`\n');
  process.exit(1);
}
if (typeof electronBin !== 'string' || !existsSync(electronBin)) {
  console.error('\n  the electron package did not resolve to a binary — try `npm rebuild electron`\n');
  process.exit(1);
}

const env = { ...process.env };
const prepend = (key, dirs) => {
  const kept = dirs.filter((d) => existsSync(d));
  if (!kept.length) return;
  env[key] = env[key] ? `${kept.join(':')}:${env[key]}` : kept.join(':');
};
prepend('LD_LIBRARY_PATH', libSearchPath());

if (process.platform === 'linux' && !runtimeLibsPresent()) {
  console.warn(
    '\n  WARNING: libpulse/libnss are neither installed nor unpacked in\n' +
    `  ${LIB_DIR}. Electron will either refuse to start or start silent.\n` +
    '  Fix: npm run desktop:deps\n',
  );
}

/*
 * WSLg's PulseAudio wants a cookie it cannot always find, and the socket is
 * authenticated anonymously. Setting PULSE_SERVER explicitly costs nothing and
 * covers the case where a login shell dropped it.
 */
if (isWSL && !env.PULSE_SERVER && existsSync('/mnt/wslg/PulseServer')) {
  env.PULSE_SERVER = 'unix:/mnt/wslg/PulseServer';
}

const args = [join(HERE, 'main.cjs'), ...process.argv.slice(2)];
const child = spawn(electronBin, args, { cwd: ROOT, env, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
