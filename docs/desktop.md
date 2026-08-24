# Running MusicWars as a desktop app

The game is a web app and stays one. This directory adds a shell around it so it
can be launched like a program instead of typed into a URL bar — which matters
for testing, because a browser tab is a hostile environment for a piece of
software whose entire output is a real-time audio schedule: it throttles timers
when you look away, it refuses to make sound until you click something, and it
puts its own chrome around a game that wants the screen.

The precedent is exact. Vampire Survivors is a Phaser 3 HTML5 game and it
shipped its Steam release inside Electron. Same shape: canvas, Web Audio, one
window, no reason to be a native binary.

## Quick start

```bash
npm install                # includes electron
npm run desktop:deps       # Linux only, and only once — see "Audio" below
npm run dev                # in one terminal
npm run desktop            # in another: the shell, pointed at the dev server
```

For the production bundle instead of the dev server:

```bash
npm run build
npm run desktop:prod
```

And a third mode, which loads the single-file artifact `npm run package`
produces — the same bytes you would email someone, running in the app shell:

```bash
npm run package
npm run desktop:single
```

| script | loads | use it for |
|---|---|---|
| `npm run desktop` | `http://localhost:5173` | iterating — HMR, source maps, devtools |
| `npm run desktop:prod` | `dist/` over loopback HTTP | testing what you actually ship |
| `npm run desktop:single` | `dist/musicwars.html` | proving the shareable file works |
| `npm run desktopcheck` | either, headlessly driven | proving sound reaches the speakers |

`F11` fullscreen, `F12` devtools, `Ctrl+R` reload (dev mode only), `Ctrl+Q`
quit. Every key the game claims — WASD, Z, X, C, P, `−`/`+`/M — is left alone.

## What the shell does that a browser tab does not

**It does not throttle the music.** Chromium clamps timers and deprioritises
renderers for windows that are hidden, occluded or unfocused. For a normal page
that saves battery. For this one it wrecks the arrangement the moment you
alt-tab, because Strudel's scheduler is a JavaScript loop that queries the
pattern about twenty times a second and pushes events a couple hundred
milliseconds ahead of the audio clock. Starve that loop and the lookahead window
empties. The shell disables background timer throttling, renderer backgrounding
and occluded-window backgrounding, and sets `backgroundThrottling: false` on the
window.

**It does not need a gesture to make sound.** `autoplayPolicy:
'no-user-gesture-required'`. A desktop app has no autoplay problem to solve —
the user launched an executable called MusicWars, and that is the gesture. The
title screen's START button stays exactly where it is, because it starts the
*run*: the arrangement's eight-bar intro needs a defined t=0 and the game needs
somewhere to put its controls. What changes is that the AudioContext is no
longer waiting on it, which is what lets `desktopcheck` drive the build without
synthesising a click, and what makes the first frame of audio land on time
rather than one gesture later.

**It sizes itself to the playfield.** The window is computed from
`PLAYFIELD_W`/`PLAYFIELD_H`, read out of `src/game/world.ts` at startup rather
than hard-coded, plus the room the side panel asks for in CSS. Change the
simulation's dimensions and the window follows.

**It serves `dist/` over loopback rather than `file://`.** Vite emits absolute
asset paths, which resolve to filesystem root under a `file://` origin, and
`file://` is not a secure context in the way a bundle full of AudioWorklets
wants. A forty-line static server on `127.0.0.1` with an ephemeral port avoids
the entire category, and costs nothing at runtime.

**The renderer stays sandboxed.** `contextIsolation: true`, `nodeIntegration:
false`, `sandbox: true`. The preload exposes one frozen object,
`window.musicwarsDesktop`, and the game does not read it — `src/` has no idea it
is inside Electron, which is the property worth keeping. The same bundle is the
web build.

## Audio under WSL2

This is the part that does not work by accident, and the failure is silent, so
it is worth stating precisely what breaks.

WSLg runs a PulseAudio server on the Windows side and exposes it to Linux as a
unix socket at `/mnt/wslg/PulseServer`, with `PULSE_SERVER` already set in the
environment. That half works out of the box:

```
$ pactl info
Server String: unix:/mnt/wslg/PulseServer
Default Sink: RDPSink
$ pactl list short sinks
1  RDPSink  module-rdp-sink.c  s16le 2ch 44100Hz  SUSPENDED
```

The half that does not is on the Chromium side. **Chromium reaches PulseAudio by
`dlopen`ing `libpulse.so.0` at runtime.** It is not a link-time dependency, so
nothing complains when it is absent — Chromium quietly falls back to ALSA. On
this image `ldconfig -p | grep libpulse` returns nothing and `/dev/snd` contains
exactly one entry, `timer`. There is no ALSA device to fall back to.

The result is the worst kind of bug this project has: an AudioContext in state
`"running"`, a scheduler ticking, every sample rendered, correct RMS at the
destination when you tap it — and silence in the room. `tools/audiocheck.mjs`
would pass. It is measuring the wrong end of the pipe.

### The fix

`npm run desktop:deps` unpacks the missing libraries into
`~/.cache/musicwars/native-libs` and `npm run desktop` puts that on
`LD_LIBRARY_PATH` automatically. It needs no root: `apt-get download` works as an
ordinary user, and only `apt-get install` does not.

| package | why |
|---|---|
| `libpulse0` | the fix — without it Chromium falls back to an ALSA device that is not there |
| `libasyncns0` | libpulse links it |
| `libnss3`, `libnspr4` | Chromium refuses to start without them |
| `libasound2t64` | linked outright, even when the output ends up going to PulseAudio |
| `pulseaudio-utils` + codecs | `pactl` and `parec`, used only for verification |

The cache lives under `~/.cache` rather than `/tmp` deliberately: `/tmp` is wiped
on reboot, and the previous incarnation of this workaround had to be redone every
session. It also covers the Playwright tools — export it yourself for those:

```bash
export LD_LIBRARY_PATH="$HOME/.cache/musicwars/native-libs/usr/lib/x86_64-linux-gnu:$HOME/.cache/musicwars/native-libs/usr/lib/x86_64-linux-gnu/pulseaudio${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

If a distro ever ships these properly, `desktop:deps` detects them in the system
`ldconfig` cache and does nothing.

### Proving it

`npm run desktopcheck` measures the audio at two depths, because only the second
one can see the failure above.

1. **Inside the graph.** The same `AudioNode.connect` tap `audiocheck.mjs` uses,
   installed over CDP into the real Electron window. Says the game is producing
   signal.
2. **At the sink.** `parec` on `RDPSink.monitor` — the PulseAudio monitor of the
   sink WSLg forwards to Windows. Says the signal *left the process*. These are
   the same bytes the speakers get, and the check writes them to
   `tools/desktop-audio.wav` so a person can listen to them.

It also reports what a fresh `AudioContext` created with no user gesture reports
as its state, which is the autoplay policy measured rather than assumed.

The check runs the game at 18% volume by default so it can be run at any hour;
`MUSICWARS_TEST_VOLUME` overrides that.

### Other WSL2 notes

- Display comes free. WSLg provides both an X server (`DISPLAY=:0`) and a
  Wayland compositor (`WAYLAND_DISPLAY=wayland-0`); Electron picks one up with
  no configuration.
- If Electron dies at startup complaining about the SUID sandbox helper, set
  `MUSICWARS_NO_SANDBOX=1`. It should not be needed — this kernel has
  unprivileged user namespaces enabled and no AppArmor restriction on them, so
  Chromium uses the namespace sandbox and never looks for the SUID binary.
- If the window renders black or the GPU process crashes,
  `MUSICWARS_DISABLE_GPU=1` falls back to software rendering. The game is Canvas
  2D and survives it.

## What a real Linux desktop needs differently

Less, mostly.

- **The libraries are already there.** Any desktop distro has `libnss3` and
  `libpulse0` installed as dependencies of the browser it ships.
  `npm run desktop:deps` will detect them and do nothing; you can skip it.
- **PipeWire instead of PulseAudio** is the modern default (Fedora 34+, Ubuntu
  23.04+). It changes nothing here: `pipewire-pulse` provides the same
  libpulse-facing API, and Chromium cannot tell. The one place it shows is
  verification — `pactl` still works against PipeWire, and the monitor source
  will be named after the real output device (`alsa_output.…​.monitor`) rather
  than `RDPSink.monitor`. `desktopcheck` finds it by suffix rather than by name
  for that reason.
- **Sandbox works normally**, so `MUSICWARS_NO_SANDBOX` stays unset.
- **The GPU is real**, so compositing and vsync behave. On WSLg the GL stack is
  D3D12-backed Mesa and frame pacing is approximate; on hardware it is not.
- **Packaging is a separate step.** Nothing here builds a distributable —
  `npm run desktop` runs the shell from the repo. For an installable artifact,
  `electron-builder` produces AppImage/deb/rpm on Linux and NSIS on Windows from
  the same `electron/` directory; that is the step Vampire Survivors' Steam build
  is on the other side of. Deliberately not done yet: it is a shipping decision,
  not a testing one.

## Where the single-file build fits

`npm run package` inlines the whole build into one self-contained
`dist/musicwars.html`, about 479 kB. It is not competing with this — the two
answer different questions.

- **Sharing:** the single file wins outright. It is one attachment, it opens in
  any browser on any OS, it needs no install, no runtime, no trust, and no
  install step to explain. Nothing about a 150 MB Electron download is better for
  showing someone the game.
- **Testing and shipping:** the shell wins, for the reasons in this document —
  no throttling, no autoplay gate, no browser chrome, a real window, and a CDP
  port that lets the existing verification harness drive it.

They are not exclusive: `npm run desktop:single` runs the shareable file *in* the
shell, so the artifact you send someone and the app you test can be byte
identical.

## Electron or Tauri

Electron. It is not close for this project, and the reason is not the one people
usually argue about.

Tauri's advantage is that it does not bundle a browser: it uses the system
webview, which is why a Tauri binary is ~10 MB against Electron's ~150 MB. That
is a real advantage and it is irrelevant here — Vampire Survivors shipped an
Electron game to millions of people and nobody's complaint was the download.

The disadvantage is what "the system webview" means. On Linux it is
**WebKitGTK**; on macOS, WKWebView; on Windows, WebView2 (Chromium). So a Tauri
build does not have one engine, it has three, and only one of them is the engine
this game's audio was written against. For an ordinary app that is a portability
tax you pay in CSS. For this one it is the entire product: every threshold in
`tools/` — the 26% fatigue-band ceiling, the 9 dB crest floor, the stem uptime
limits, the 98% on-grid volley rate — was measured against Chromium's Web Audio
and Chromium's timer behaviour. Ship WebKitGTK and none of those numbers are
about the thing the user is running.

Three specific concerns, in descending order of how much they matter:

1. **There is no way to measure it.** This project's central claim is that Web
   Audio fails silently and therefore everything gets verified — thirty-odd
   headless checks, all of them driving Chromium over CDP. Electron exposes the
   same CDP: `tools/desktopcheck.mjs` reuses `audiocheck.mjs`'s tap verbatim
   inside the real app window. WebKitGTK under Tauri exposes no equivalent on
   Linux. Adopting it means the desktop build is the one build nobody can check,
   in a project that exists because unchecked audio builds lie.
2. **AudioWorklet is the youngest part of WebKitGTK's Web Audio, and this
   engine is made of it.** Six modules of superdough reach for
   `AudioWorkletNode` — `synth`, `nodePools`, `helpers`, `wavetable`,
   `superdough` and `dspworklet` — and `dspworklet.mjs:48` registers its
   processor with `audioWorklet.addModule(dataURL)`, a `data:` URL rather than a
   file. That is a well-trodden path in Chromium and a thinly-trodden one
   everywhere else; this repo already documents one place where Chrome rejects a
   `data:` URL that looks identical (the SharedWorker clock behind Strudel's
   `sync: true`). On top of that, scheduling here is `currentTime`-relative with
   a ~200 ms lookahead, and the game drives everything on stage off the
   transport's absolute beat position — so scheduler jitter is not a music
   problem, it is a *gameplay* problem: volleys stop landing on subdivisions.
3. **It adds a layer under WSL2, not removes one.** WebKitGTK's audio goes out
   through GStreamer rather than straight to PulseAudio, which is one more place
   for the failure documented above to happen in a new way.

The honest caveat: **(1) is architectural and certain, (2) and (3) are reasoned
rather than measured.** Building Tauri on this machine needs a Rust toolchain and
the `webkit2gtk-4.1` development packages, and installing those needs root, which
is not available here. If someone wants the empirical version, the cheap
experiment is not to build a Tauri app at all — it is to load
`dist/musicwars.html` in any WebKitGTK browser (Epiphany, or `npx playwright
install webkit` and point Playwright's WebKit at it) and see whether the
arrangement holds together. If it does not, that settles it; if it does, Tauri is
still the option with no verification story.

Where Tauri would become the right answer: if the target were a small utility
with modest audio needs and download size mattered, or if the app had to ship on
Linux *without* bundling a browser for policy reasons. Neither describes this.
