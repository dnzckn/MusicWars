/**
 * Make Playwright's Chromium launchable on a box with no system NSS and no root.
 *
 * Chromium needs `libnspr4`, `libnss3`, `libnssutil3` and `libasound.so.2`, and
 * this machine has none of them installed and no way to install them. The
 * standing workaround was to extract them from their .debs into
 * `/tmp/chromedeps/root` and put that on `LD_LIBRARY_PATH` — and that recipe
 * lived only as a paragraph of prose in `tools/README.md`.
 *
 * **`/tmp` was cleaned and the whole verification suite died**, with an error
 * ("error while loading shared libraries: libnspr4.so") that says nothing about
 * what to do and appears before the launch timeout, so it does not even look
 * like a missing dependency. That cost one workstream most of a session. A
 * recipe a human has to remember and re-type is a recipe that will be lost
 * again; this is the same recipe as code.
 *
 * Import it and call it before `chromium.launch()`. It is idempotent and cheap
 * when the directory is already good — one `ldd` — so it costs nothing to leave
 * in a tool that runs every iteration:
 *
 *     import { ensureChromeDeps } from './lib/chromedeps.mjs';
 *     await ensureChromeDeps();
 *     const b = await chromium.launch({ ... });
 *
 * It works by mutating `process.env.LD_LIBRARY_PATH`, which the browser
 * inherits because Playwright spawns it as a child of this process. That is why
 * it has to be a module the tool imports rather than a script the tool shells
 * out to: a child process cannot set its parent's environment.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LIB_DIR, libSearchPath } from '../desktop-deps.mjs';

/**
 * Where the extracted libraries might already be, in the order to try.
 *
 * The path is **imported from `tools/desktop-deps.mjs` rather than restated
 * here**, because that script owns the directory and repopulates it
 * (`npm run desktop:deps`). Two copies of a path is how it drifted in the first
 * place. Importing it is safe: that file's executable half is guarded behind
 * `import.meta.url === file://argv[1]`, so importing runs nothing.
 *
 * `libSearchPath()` also yields the `pulseaudio` subdirectory, which Chromium
 * wants when audio is not muted.
 *
 * The original workaround put these in `/tmp/chromedeps`. `/tmp` was cleaned,
 * every browser tool in the repository stopped working, and a perfectly good
 * copy sat in the cache directory the whole time — referenced only from
 * `tools/.pulseprobe-tmp.mjs`, a scratch file nothing imports. **A second copy
 * under `/tmp` was never a backup, it was a second thing to lose**, and it is
 * the one that got lost. The legacy path is still probed, last, in case a box
 * still has a populated one.
 */
const KNOWN = [
  process.env.CHROMEDEPS_DIR,
  ...libSearchPath(),
  '/tmp/chromedeps/root/usr/lib/x86_64-linux-gnu',
].filter(Boolean);

/** Where a rebuild goes: the directory `desktop-deps.mjs` already owns. */
const DIR = LIB_DIR;
const PACKAGES = ['libnss3', 'libnspr4', 'libasound2t64'];

/** The chrome binary Playwright would launch, or null if we cannot find one. */
function chromeBinary() {
  const root = join(process.env.HOME ?? '', '.cache/ms-playwright');
  if (!existsSync(root)) return null;
  // Highest build number wins, which is what Playwright itself picks.
  const builds = readdirSync(root)
    .filter((d) => d.startsWith('chromium'))
    .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));
  for (const b of builds) {
    for (const rel of [
      'chrome-linux/chrome',
      'chrome-headless-shell-linux64/chrome-headless-shell',
    ]) {
      const p = join(root, b, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Which of Chromium's shared libraries the dynamic linker cannot resolve. */
function missing(bin) {
  try {
    const out = execFileSync('ldd', [bin], { encoding: 'utf8', env: process.env });
    return out
      .split('\n')
      .filter((l) => l.includes('not found'))
      .map((l) => l.trim().split(' ')[0]);
  } catch {
    // A static binary, or no ldd. Either way we have nothing to fix.
    return [];
  }
}

function addToPath(dir) {
  const cur = process.env.LD_LIBRARY_PATH ?? '';
  if (cur.split(':').includes(dir)) return;
  process.env.LD_LIBRARY_PATH = cur ? `${dir}:${cur}` : dir;
}

/** The first known directory that actually holds the libraries. */
function findExisting() {
  return KNOWN.find((d) => existsSync(join(d, 'libnspr4.so'))) ?? null;
}

/**
 * Ensure Chromium can start. Returns a one-line description of what it did, so
 * a tool can print it and a run's log says whether the deps were rebuilt.
 *
 * Never throws: a box where this is unnecessary (a normal machine with NSS
 * installed) must not be broken by a helper written for one that is not.
 */
export async function ensureChromeDeps({ quiet = false } = {}) {
  const bin = chromeBinary();
  if (!bin) return 'chromedeps: no Playwright Chromium found; nothing to do';

  // Every candidate that exists goes on the path, not just the first: the NSS
  // libraries and the PulseAudio ones live in sibling directories.
  const present = KNOWN.filter((d) => existsSync(d));
  for (const d of present) addToPath(d);
  const found = findExisting();
  let gaps = missing(bin);
  if (gaps.length === 0) {
    return found ? `chromedeps: ok (using ${found})` : 'chromedeps: ok (system libraries)';
  }

  if (!quiet) console.log(`chromedeps: ${gaps.join(' ')} missing — trying to repopulate ${DIR}`);

  try {
    // The same recipe `tools/desktop-deps.mjs` uses: `apt-get download` plus
    // `dpkg-deb -x`, neither of which needs root — only `apt-get install` does.
    execFileSync('node', ['tools/desktop-deps.mjs'], { stdio: quiet ? 'ignore' : 'inherit' });
  } catch (err) {
    /*
     * The failure names the libraries and the paths, because the alternative is
     * what this cost us: the linker error arrives before Playwright's launch
     * timeout and surfaces as "Target page, context or browser has been
     * closed", which reads like a crashed page rather than a missing library.
     */
    return [
      `chromedeps: FAILED — ${gaps.join(' ')} still missing (${String(err).split('\n')[0]}).`,
      `  searched: ${KNOWN.join('\n            ')}`,
      '  `npm run desktop:deps` repopulates it; with no network, copy an',
      '  extracted deb tree into the first path above by hand.',
    ].join('\n');
  }

  for (const d of KNOWN.filter((x) => existsSync(x))) addToPath(d);
  gaps = missing(bin);
  return gaps.length
    ? `chromedeps: repopulated ${DIR} but ${gaps.join(' ')} are still missing`
    : `chromedeps: repopulated ${DIR} — Chromium can launch`;
}
