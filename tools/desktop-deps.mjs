/**
 * Fetch the shared libraries Electron and Playwright's Chromium need, without root.
 *
 * This machine has no passwordless sudo and is missing three libraries Chromium
 * links against (libnss3, libnspr4, libasound2) and one it *dlopens* at runtime
 * (libpulse). The missing dlopen is the interesting one: Chromium's Linux audio
 * backend tries libpulse.so.0 first and silently falls back to ALSA when it is
 * absent. Under WSL2 there is no ALSA device — `/dev/snd` contains only `timer`
 * — so the fallback produces an AudioContext that runs, reports `state:
 * "running"`, renders every sample, and sends none of them anywhere. Exactly the
 * silent failure this project's whole tools/ directory exists to catch.
 *
 * `apt-get download` needs no root; only `apt-get install` does. So we download
 * the .debs, unpack them into a cache directory, and let LD_LIBRARY_PATH do the
 * rest. The cache lives under ~/.cache rather than /tmp so it survives a reboot.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const LIB_DIR = process.env.MUSICWARS_LIB_DIR || join(homedir(), '.cache', 'musicwars', 'native-libs');

/** The two directories inside an unpacked deb tree that hold shared objects. */
export const libSearchPath = (root = LIB_DIR) => [
  join(root, 'usr/lib/x86_64-linux-gnu'),
  join(root, 'usr/lib/x86_64-linux-gnu/pulseaudio'),
];

/**
 * Each entry lists candidate package names because Ubuntu's t64 transition
 * renamed several of these (libasound2 -> libasound2t64) and a hard-coded name
 * fails on exactly one side of that line.
 */
const PACKAGES = [
  { probe: 'libnss3.so', names: ['libnss3'], why: 'Chromium will not start without it' },
  { probe: 'libnspr4.so', names: ['libnspr4'], why: 'pulled in by libnss3' },
  { probe: 'libasound.so.2', names: ['libasound2t64', 'libasound2'], why: 'Chromium links it even when it ends up using PulseAudio' },
  { probe: 'libpulse.so.0', names: ['libpulse0'], why: 'THE audio fix: without it Chromium falls back to an ALSA device WSL2 does not have' },
  { probe: 'libasyncns.so.0', names: ['libasyncns0'], why: 'libpulse links it' },
];

/** Verification only — `pactl` and `parec` are how we prove sound left the process. */
const VERIFY_PACKAGES = [
  { probe: 'pactl', names: ['pulseaudio-utils'], bin: true },
  { probe: 'libsndfile.so.1', names: ['libsndfile1'] },
  { probe: 'libFLAC.so.12', names: ['libflac12t64', 'libflac12'] },
  { probe: 'libvorbis.so.0', names: ['libvorbis0a'] },
  { probe: 'libvorbisenc.so.2', names: ['libvorbisenc2'] },
  { probe: 'libogg.so.0', names: ['libogg0'] },
  { probe: 'libopus.so.0', names: ['libopus0'] },
  { probe: 'libmpg123.so.0', names: ['libmpg123-0t64', 'libmpg123-0'] },
  { probe: 'libmp3lame.so.0', names: ['libmp3lame0'] },
];

let ldcache = null;
const inSystemLdCache = (soname) => {
  if (ldcache === null) {
    try { ldcache = execFileSync('ldconfig', ['-p'], { encoding: 'utf8' }); } catch { ldcache = ''; }
  }
  return ldcache.includes(soname);
};

const haveLocally = (probe, bin) => {
  const dirs = bin ? [join(LIB_DIR, 'usr/bin')] : libSearchPath();
  return dirs.some((d) => existsSync(join(d, probe)));
};

/** True when nothing further needs downloading for the runtime set. */
export function runtimeLibsPresent() {
  return PACKAGES.every((p) => inSystemLdCache(p.probe) || haveLocally(p.probe, false));
}

export function verifyToolsPresent() {
  return VERIFY_PACKAGES.every((p) => (p.bin ? haveLocally(p.probe, true) : inSystemLdCache(p.probe) || haveLocally(p.probe, false)));
}

function fetchInto(pkgs, label) {
  const wanted = pkgs.filter((p) => !(p.bin ? haveLocally(p.probe, true) : inSystemLdCache(p.probe) || haveLocally(p.probe, false)));
  if (!wanted.length) {
    console.log(`  ${label}: already satisfied`);
    return;
  }
  mkdirSync(LIB_DIR, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'musicwars-deps-'));
  try {
    for (const p of wanted) {
      let got = false;
      for (const name of p.names) {
        try {
          execFileSync('apt-get', ['download', name], { cwd: work, stdio: ['ignore', 'ignore', 'pipe'] });
          got = true;
          console.log(`  fetched ${name}${p.why ? ` — ${p.why}` : ''}`);
          break;
        } catch { /* try the next candidate name */ }
      }
      if (!got) console.log(`  WARNING: could not download any of ${p.names.join(', ')} (${p.probe})`);
    }
    for (const deb of readdirSync(work).filter((f) => f.endsWith('.deb'))) {
      execFileSync('dpkg-deb', ['-x', join(work, deb), LIB_DIR]);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const withVerify = !process.argv.includes('--runtime-only');
  console.log(`\nunpacking into ${LIB_DIR}\n`);
  fetchInto(PACKAGES, 'runtime libraries');
  if (withVerify) fetchInto(VERIFY_PACKAGES, 'verification tools (pactl/parec)');
  console.log('');
  const missing = PACKAGES.filter((p) => !inSystemLdCache(p.probe) && !haveLocally(p.probe, false));
  if (missing.length) {
    console.log(`  ✗ still missing: ${missing.map((m) => m.probe).join(', ')}`);
    process.exit(1);
  }
  console.log('=== DESKTOP DEPS READY ===');
  console.log(`   npm run desktop picks these up automatically.`);
  console.log(`   For the Playwright tools, export it yourself:`);
  console.log(`   export LD_LIBRARY_PATH=${libSearchPath().join(':')}\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}`);
}
