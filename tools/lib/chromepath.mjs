/**
 * Pick a Chromium build whose files can actually be READ, and point every
 * browser tool at it.
 *
 * WHY THIS EXISTS. On this box the disk is failing. `dmesg` repeats
 *
 *     hv_storvsc ...: tag#1110 cmd 0x28 status: scsi 0x2 srb 0x4 host 0xc0000001
 *
 * every few seconds — `cmd 0x28` is SCSI READ(10) — and the damage has landed
 * inside the Playwright browser cache. Measured with a 3s timeout per file:
 *
 *     chromium-1217                 icudtl.dat UNREADABLE   chrome UNREADABLE
 *     chromium-1234                 icudtl.dat UNREADABLE   v8_context_snapshot.bin UNREADABLE
 *     chromium_headless_shell-1217  all three ok
 *     chromium_headless_shell-1234  v8_context_snapshot.bin UNREADABLE
 *
 * Three of the four builds are damaged, on different files. One is intact.
 *
 * The failure this produces is uniquely nasty, which is the real reason for
 * this file. A read of a bad block does not return an error — it never returns
 * at all. Chrome blocks forever in `folio_wait_bit_common` while mmapping the
 * snapshot, Playwright reports only `browserType.launch: Timeout exceeded`,
 * and the zygote is left in uninterruptible sleep where no signal can reach it,
 * so every attempt leaks a process that cannot be killed. Nothing in that chain
 * says "disk". A whole afternoon can go into debugging the game's audio because
 * the browser that was supposed to measure it never started.
 *
 * `chromedeps.mjs` cannot see this. It resolves the HIGHEST build number —
 * which is 1234, one of the broken ones — and then asks `ldd` whether the
 * libraries resolve. `ldd` reads the ELF headers, which are in the good part of
 * the file, so it answers yes. The binary is fine. Its data files are not.
 *
 * WHAT THIS DOES. Probes each candidate binary and the two data files it mmaps
 * at startup, keeps only builds where every one of them is readable inside a
 * timeout, and exports the winner as `CHROME_PATH`. All 109 browser tools
 * already pass `executablePath: process.env.CHROME_PATH` to `chromium.launch`,
 * so setting the variable is the entire fix — no tool changes.
 *
 * It prefers a copy on tmpfs when one exists. Reading Chromium off a disk that
 * is actively retrying failed reads is slow even where the blocks are good; the
 * agent that first hit this measured launch going from a 240s timeout to 0.1s
 * after copying the healthy build to /dev/shm.
 *
 * THIS IS A WORKAROUND FOR BROKEN HARDWARE, NOT A FEATURE. The right fix is to
 * replace the disk and reinstall the browsers. Delete this file when that
 * happens: it will keep working silently on a healthy machine, which is exactly
 * how a workaround outlives the problem it was written for and starts being
 * treated as architecture.
 *
 * SAFETY. It never throws and it never overrides an explicit `CHROME_PATH`. On
 * a machine with no Playwright cache, no `timeout(1)`, or no damage, it does
 * nothing at all and every tool behaves exactly as it did before.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Seconds a single file read may take before we call the file unreadable. */
const READ_TIMEOUT_S = 3;

/** How long a verdict stays good. The disk does not heal, but it does spread. */
const CACHE_TTL_MS = 30 * 60 * 1000;

const ROOT = join(process.env.HOME ?? '', '.cache/ms-playwright');
const CACHE = join(process.env.HOME ?? '', '.cache/musicwars/chromepath.json');

/**
 * Where a build keeps its executable. `chrome-linux64` is the one
 * `chromedeps.chromeBinary()` forgets, which is why its probe only ever
 * succeeds by falling through to the headless shell.
 */
const BINARIES = [
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-headless-shell-linux64/chrome-headless-shell',
];

/**
 * The files Chrome mmaps before it can render anything. A build missing either
 * one starts and then dies without a usable message, so they are part of
 * "healthy", not extras.
 */
const DATA = ['v8_context_snapshot.bin', 'icudtl.dat'];

/**
 * Can this file be read at all, within the timeout?
 *
 * Spawned rather than read in-process on purpose: a bad-block read is
 * uninterruptible, so an `fs.readFileSync` here would hang this very process
 * with no way out. `timeout(1)` gives up on our behalf and leaves the stuck
 * reader outside our own process tree.
 */
function readable(file) {
  if (!existsSync(file)) return false;
  try {
    execFileSync('timeout', [String(READ_TIMEOUT_S), 'head', '-c', '65536', file], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    // Non-zero exit, or 124 from `timeout` itself. Either way: do not use it.
    return false;
  }
}

/** Every (build, binary) pair present on disk, newest build first. */
function candidates() {
  if (!existsSync(ROOT)) return [];
  const builds = readdirSync(ROOT)
    .filter((d) => d.startsWith('chromium'))
    .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
  const out = [];
  for (const b of builds) {
    for (const rel of BINARIES) {
      const bin = join(ROOT, b, rel);
      if (existsSync(bin)) out.push({ build: b, bin, dir: join(ROOT, b, rel.split('/')[0]) });
    }
  }
  return out;
}

/**
 * A tmpfs copy of the same build, if somebody has already made one.
 *
 * We look for it but never create it: this module runs at import time inside
 * every browser tool, and a 200MB copy is not something to do behind a tool's
 * back. `tools/README.md` carries the one-liner to make it by hand.
 */
function tmpfsTwin(bin) {
  const name = bin.split('/').slice(-2).join('/');
  for (const base of ['/dev/shm/mw17', '/dev/shm/musicwars-chrome']) {
    const p = join(base, name);
    if (existsSync(p) && readable(p)) return p;
  }
  return null;
}

function cached() {
  try {
    const c = JSON.parse(readFileSync(CACHE, 'utf8'));
    if (Date.now() - c.at > CACHE_TTL_MS) return null;
    // A cached path that has since gone bad is worse than no cache.
    return c.path && existsSync(c.path) ? c : null;
  } catch {
    return null;
  }
}

function remember(path, note) {
  try {
    mkdirSync(join(process.env.HOME ?? '', '.cache/musicwars'), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ at: Date.now(), path, note }));
  } catch {
    /* A cache we cannot write is a cache we do without. */
  }
}

/**
 * Resolve a healthy Chromium and publish it as `CHROME_PATH`.
 *
 * Returns a one-line description of what happened, so a tool can print it and
 * a run's log records which browser produced the numbers — the same contract
 * `ensureChromeDeps` uses.
 */
export function ensureChromePath({ force = false } = {}) {
  if (process.env.CHROME_PATH && !force) {
    return `chromepath: honouring CHROME_PATH=${process.env.CHROME_PATH}`;
  }
  if (!existsSync(ROOT)) return 'chromepath: no Playwright cache; leaving resolution to Playwright';

  const hit = force ? null : cached();
  if (hit) {
    process.env.CHROME_PATH = hit.path;
    return `chromepath: ${hit.note} (cached)`;
  }

  const all = candidates();
  if (all.length === 0) return 'chromepath: no Chromium builds found; nothing to do';

  const damaged = [];
  for (const c of all) {
    const bad = [c.bin, ...DATA.map((d) => join(c.dir, d))].filter((f) => existsSync(f) && !readable(f));
    if (bad.length) {
      damaged.push(`${c.build}(${bad.map((f) => f.split('/').pop()).join(',')})`);
      continue;
    }
    const twin = tmpfsTwin(c.bin);
    const path = twin ?? c.bin;
    // Nothing was wrong with the build Playwright would have picked anyway, so
    // say nothing and change nothing — the quiet path on a healthy machine.
    if (damaged.length === 0 && !twin) {
      remember(path, `using ${c.build}`);
      process.env.CHROME_PATH = path;
      return `chromepath: ${c.build} reads cleanly`;
    }
    const note = `using ${c.build}${twin ? ' from tmpfs' : ''}, skipped ${damaged.join(' ')}`;
    remember(path, note);
    process.env.CHROME_PATH = path;
    return `chromepath: ${note}`;
  }

  // Every build is damaged. Do not set CHROME_PATH — let Playwright fail in its
  // own way rather than adding a second mystery on top of the first — but say
  // plainly what is wrong, because the launch timeout that follows will not.
  const msg =
    `chromepath: EVERY Chromium build has unreadable files (${damaged.join(' ')}). ` +
    'This is failing storage, not a browser problem — check `dmesg` for SCSI read errors. ' +
    'Browser tools are expected to hang on launch until the disk is replaced.';
  console.error(msg);
  return msg;
}

/**
 * Chromium's own shared libraries, unpacked without root by `desktop-deps`.
 *
 * `chromedeps.mjs` already does this — but only four of the 109 browser tools
 * import it, so on this box the other 105 launched a browser that died with
 * `libnspr4.so: cannot open shared object file`. Since we are already here,
 * at import time, before any child is spawned, and Playwright hands
 * `process.env` to that child, the path costs nothing to set.
 *
 * Only directories that actually hold the library are added, so this is inert
 * on a machine whose libraries came from a package manager.
 */
function ensureLibraryPath() {
  const dirs = [
    process.env.CHROMEDEPS_DIR,
    join(process.env.HOME ?? '', '.cache/musicwars/native-libs/usr/lib/x86_64-linux-gnu'),
    '/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu',
  ].filter(Boolean);
  const added = [];
  for (const d of dirs) {
    if (!existsSync(join(d, 'libnspr4.so'))) continue;
    const cur = process.env.LD_LIBRARY_PATH ?? '';
    if (cur.split(':').includes(d)) continue;
    process.env.LD_LIBRARY_PATH = cur ? `${d}:${cur}` : d;
    added.push(d);
  }
  return added;
}

/** Applied on import: 107 of the 109 browser tools import this module's host. */
const LIBS_ADDED = ensureLibraryPath();

export const CHROME_PATH_NOTE =
  ensureChromePath() + (LIBS_ADDED.length ? ` (+${LIBS_ADDED.length} lib dir)` : '');

if (process.env.CHROMEPATH_VERBOSE) console.error(CHROME_PATH_NOTE);
