/**
 * The device, in one place.
 *
 * THE OWNER'S BRIEF: "make this game mobile ready; the majority audience will
 * play this on the phone" — and "i don't mean working on mobile = done, i mean
 * really make the mobile experience premium and polished". Three files draw or
 * print the level-up prompt (`renderer.ts` on the ship, `hud.ts` on the XP
 * line, `levelup.ts` on the offer) and every one of them has to know whether
 * the player has a keyboard, so the question is answered here once and the
 * three read the same answer. A second copy of `matchMedia` in each would be
 * the two-copies-of-one-string drift this repository has been burned by three
 * times over (see `paintOpeners` in main.ts).
 *
 * Guarded on `typeof matchMedia`: `tools/inputcheck.mjs` runs `Input` under
 * node with a stubbed `window`, and anything on the input path that reaches
 * for a browser global unguarded takes that check down with a ReferenceError.
 */

/**
 * True when the PRIMARY pointer is a finger.
 *
 * `(pointer: coarse)` rather than `hasTouch`: a laptop with a touchscreen
 * reports a fine primary pointer and keeps its keys and its mouse, so it keeps
 * the keyboard prompts — the same gate `style.css` already uses for the title
 * screen's key list. Cached: the answer cannot change without a reload on any
 * platform this ships to, and `renderer.ts` asks every frame.
 */
let coarse: boolean | null = null;
export function coarsePointer(): boolean {
  if (coarse === null) {
    coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }
  return coarse;
}

/**
 * The word for "press this to open the offer", on the device the player has.
 *
 * `SPACE` on a keyboard, `TAP` on a phone. `hud.ts` prints it on the XP line
 * and `renderer.ts` on the ship's badge; a phone player told to press SPACE
 * was the CRITICAL row of the platform audit — on touch there was no way to
 * open the offer at all, and the interface named a key the device does not
 * have.
 */
export function offerKeyWord(): string {
  return coarsePointer() ? 'TAP' : 'SPACE';
}

/*
 * ---------------------------------------------------------------------------
 * The phone session: audio category, wake lock, fullscreen, orientation.
 *
 * Every call here is BEST-EFFORT — never awaited on the critical path into
 * `bootAudio`, never allowed to throw. A phone that refuses any of these still
 * plays; the platform audit ranks them, in order: the iOS silent switch muting
 * a WebAudio-only page with the context still `running` (#4), the screen
 * timing out during the hands-off TUNING UP opener and the card screen (#9),
 * and the game living in the small viewport under Android's URL bar for the
 * whole run because the page never scrolls, so the bar never collapses (#6).
 * ---------------------------------------------------------------------------
 */

/** The Screen Wake Lock sentinel, while one is held. */
let wakeLock: { release(): Promise<void>; addEventListener?: unknown } | null = null;
/** Whether a run wants the screen kept on; consulted when the tab comes back. */
let wantWake = false;

/**
 * Keep the screen on. Re-request on every call rather than checking the
 * sentinel: the lock is released by the browser the moment the tab is hidden,
 * and the `release` event is not reliable enough to track it — asking again
 * for one already held is a no-op that costs a promise.
 */
export function holdWake(): void {
  wantWake = true;
  try {
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<typeof wakeLock> } }).wakeLock;
    if (!wl) return;
    void wl.request('screen').then((s) => { wakeLock = s; }).catch(() => undefined);
  } catch {
    /* No API, or a denied request: the screen behaves as it always did. */
  }
}

/** Let the screen sleep again. Called when the run is over. */
export function releaseWake(): void {
  wantWake = false;
  const s = wakeLock;
  wakeLock = null;
  if (s) void s.release().catch(() => undefined);
}

/** A run is live and the tab just came back: take the lock again. */
export function reholdWake(): void {
  if (wantWake) holdWake();
}

/**
 * Called from inside the START gesture, before `bootAudio`.
 *
 *   - `navigator.audioSession.type = 'playback'` (WebKit, iOS 17+): a
 *     WebAudio-only page is otherwise muted by the ringer switch with the
 *     context still `'running'`, so the HUD says the music is playing and the
 *     phone is silent. Read from the platform audit, not measured — there is
 *     no WebKit on this machine.
 *   - the wake lock, from the gesture that grants it.
 *   - on a coarse pointer only, and only where the API exists (iPhone Safari
 *     has no element fullscreen): fullscreen with the navigation UI hidden,
 *     then the portrait lock, which Android permits only in fullscreen. The
 *     "swipe to exit" toast and the browser's own gesture are the way out; no
 *     leave-fullscreen control of ours is needed.
 */
export function enterPhoneSession(): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if ('audioSession' in navigator && nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* Not WebKit, or a read-only session: the ringer switch rule stands. */
  }
  holdWake();
  if (!coarsePointer()) return;
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      const root = document.documentElement as HTMLElement & {
        requestFullscreen(o?: { navigationUI?: 'hide' | 'show' | 'auto' }): Promise<void>;
      };
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => lockPortrait())
        .catch(() => undefined);
    }
  } catch {
    /* A browser without the API, or one that refuses outside a gesture. */
  }
}

function lockPortrait(): void {
  try {
    const o = screen.orientation as unknown as { lock?(t: string): Promise<void> } | undefined;
    void o?.lock?.('portrait')?.catch?.(() => undefined);
  } catch {
    /* Desktop browsers throw synchronously; that is the whole reason for the try. */
  }
}
