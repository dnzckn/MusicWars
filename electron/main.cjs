/**
 * MusicWars desktop shell.
 *
 * Vampire Survivors shipped a Phaser 3 HTML5 game to Steam inside Electron, and
 * this is the same shape of thing: a canvas game plus Web Audio, wrapped in a
 * known-good Chromium rather than whatever webview the machine happens to have.
 * Bundling the browser is the point — the audio engine was developed and
 * verified against Chromium's Web Audio implementation, and Strudel's scheduler
 * assumes it.
 *
 * Two modes:
 *   --dev    load the Vite dev server (HMR, source maps, the inner loop)
 *   --prod   serve dist/ over a loopback HTTP server and load that
 *
 * Why an HTTP server rather than file:// — Vite emits absolute asset paths
 * (`/assets/...`), which resolve to filesystem root under file://, and a file://
 * origin is not a secure context in the way a bundle full of AudioWorklets and
 * data:-URL modules wants. http://127.0.0.1 is a secure context and costs about
 * forty lines.
 */
const { app, BrowserWindow, Menu, screen, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(1);
const has = (flag) => argv.includes(flag);

const MODE = has('--prod') ? 'prod' : has('--single') ? 'single' : 'dev';
const DEV_URL = process.env.MUSICWARS_DEV_URL || 'http://localhost:5173/';

/*
 * The playfield is read out of the source rather than hard-coded, because the
 * simulation's dimensions are somebody else's to change and a desktop window
 * that letterboxes the game is a bug nobody would think to look for here.
 *
 * The reader moved to `electron/arena.cjs` so `tools/fieldsize.mjs` can require
 * it — including its packaged-build fallback — and fail when either drifts from
 * `src/game/arena.ts`. Requiring `main.cjs` itself would pull in `electron`.
 */
const { playfieldSize } = require('./arena.cjs');

/*
 * Audio switches, applied before app ready because Chromium reads them at
 * startup.
 *
 * autoplay-policy: a desktop app has no autoplay problem to solve. The user
 * launched an executable called MusicWars; that is the gesture. The title
 * screen's START button stays where it is — it starts the *run*, and the
 * arrangement's eight-bar intro wants a defined t=0 — but the AudioContext no
 * longer needs it, which is what lets the verification tools drive this build
 * without synthesising a click.
 *
 * The three throttling switches matter more than they look. Chromium throttles
 * timers and lowers renderer priority when a window is occluded or unfocused;
 * for a game that would drop frames, and for a game whose *soundtrack* is
 * scheduled by a ~20Hz JavaScript query loop it audibly wrecks the music the
 * moment you alt-tab.
 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (process.env.MUSICWARS_NO_SANDBOX === '1') app.commandLine.appendSwitch('no-sandbox');
if (process.env.MUSICWARS_DISABLE_GPU === '1') app.disableHardwareAcceleration();

/*
 * `--remote-debugging-port=N` is how tools/desktopcheck.mjs gets inside the real
 * window: Electron speaks the same CDP the Playwright checks already drive, so
 * the destination tap from audiocheck.mjs works here unchanged. Re-appending it
 * explicitly rather than trusting Chromium's own argv parse, and opening the
 * origin check only while the port is on, because a WebSocket client that sends
 * no Origin header is rejected by default in recent Chromium.
 */
const debugPort = argv.find((a) => a.startsWith('--remote-debugging-port='));
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort.split('=')[1]);
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

/** Serve dist/ on an ephemeral loopback port. Resolves to the base URL. */
function serveDist(dir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      reject(new Error(`no build at ${dir} — run \`npm run build\` first`));
      return;
    }
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      // Resolve then confine: a request for ../../etc/passwd is a request for
      // index.html, whatever the loopback binding already makes of it.
      const file = path.resolve(dir, rel);
      const target = file.startsWith(dir + path.sep) || file === dir ? file : path.join(dir, 'index.html');
      fs.readFile(target, (err, buf) => {
        if (err) {
          res.writeHead(404, { 'content-type': 'text/plain' });
          res.end('not found');
          return;
        }
        res.writeHead(200, {
          'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/` }));
  });
}

/** The dev server may still be booting when we are; poll rather than fail. */
async function waitForDevServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function windowSize() {
  const { w, h } = playfieldSize();
  const work = screen.getPrimaryDisplay().workAreaSize;
  // The page lays out as [14px pad][stage][16px gap][panel][14px pad], the panel
  // capped at 460 and floored at 268. Size the window so the stage gets its
  // full height and the panel its full width, then let it shrink from there.
  const PAD = 28;
  const GAP = 16;
  const PANEL = 460;
  const stageH = Math.max(560, Math.min(h, work.height - 90));
  const stageW = Math.round(stageH * (w / h));
  return {
    width: Math.min(work.width - 20, PAD + stageW + GAP + PANEL),
    height: Math.min(work.height - 20, stageH + PAD),
    minWidth: 900,
    minHeight: 620,
  };
}

let win = null;
let httpServer = null;

async function createWindow() {
  const size = windowSize();
  win = new BrowserWindow({
    ...size,
    show: false,
    backgroundColor: '#05060c',
    title: 'MusicWars',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The renderer-side half of the switches above: without this, a hidden or
      // occluded window has its timers clamped and the arrangement stumbles.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    win.show();
    if (has('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  });

  // Anything that is not the app opens in the real browser, not in the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (MODE === 'dev') {
    const up = await waitForDevServer(DEV_URL);
    if (!up) {
      console.error(`\n  the dev server at ${DEV_URL} is not answering — run \`npm run dev\` first\n`);
      app.quit();
      return;
    }
    await win.loadURL(DEV_URL);
  } else {
    const dist = path.join(ROOT, 'dist');
    const { server, base } = await serveDist(dist);
    httpServer = server;
    const page = MODE === 'single' ? 'musicwars.html' : 'index.html';
    if (MODE === 'single' && !fs.existsSync(path.join(dist, page))) {
      console.error('\n  dist/musicwars.html does not exist — run `npm run package` first\n');
      app.quit();
      return;
    }
    await win.loadURL(base + page);
  }

  win.on('closed', () => { win = null; });
}

/*
 * Shortcuts, registered on the window rather than globally so they do not
 * follow the user out of the app. Everything else the game claims for itself —
 * WASD, Z, X, C, P, +/-/M — is deliberately left alone.
 */
app.on('browser-window-created', (_e, w) => {
  w.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrlOrCmd = input.control || input.meta;
    if (input.key === 'F11') { w.setFullScreen(!w.isFullScreen()); event.preventDefault(); }
    else if (input.key === 'F12' || (ctrlOrCmd && input.shift && input.key.toLowerCase() === 'i')) {
      w.webContents.toggleDevTools(); event.preventDefault();
    } else if (ctrlOrCmd && input.key.toLowerCase() === 'r' && MODE === 'dev') {
      w.webContents.reload(); event.preventDefault();
    } else if (ctrlOrCmd && input.key.toLowerCase() === 'q') {
      app.quit(); event.preventDefault();
    }
  });
});

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => {
  if (httpServer) httpServer.close();
  app.quit();
});
