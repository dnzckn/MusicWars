/**
 * Master volume.
 *
 * superdough connects its output straight to `AudioContext.destination` and
 * exposes no master fader, so there is nothing to turn down after the fact.
 * Instead both paths into it read this value: the director scales every stem's
 * postgain by it, and the SFX helpers scale their gain. That covers everything
 * the game can make a sound with.
 *
 * Persisted, because being told "it's too loud" and then making the player fix
 * it again on every reload is not a fix.
 */

const KEY = 'musicwars.volume';
const MUTE_KEY = 'musicwars.muted';

let volume = 0.75;
let muted = false;

try {
  const stored = localStorage.getItem(KEY);
  if (stored !== null) {
    const v = Number(stored);
    if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v));
  }
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  // Private browsing or a blocked origin; defaults are fine.
}

/**
 * The multiplier to apply at the audio call sites, already accounting for mute.
 *
 * Note the square root. `setGainCurve(x => x * x)` squares every gain-like
 * control, so passing the raw setting through makes the slider quartic overall
 * — 40% on the slider measured as 9% of the amplitude, which feels broken.
 * Pre-compensating here makes the fader behave like a fader.
 */
export function masterVolume(): number {
  return muted ? 0 : Math.sqrt(volume);
}

/** The slider position, ignoring mute, so the UI can restore it. */
export function volumeSetting(): number {
  return volume;
}

export function isMuted(): boolean {
  return muted;
}

export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  if (volume > 0) muted = false;
  persist();
}

export function nudgeVolume(delta: number): number {
  setVolume(volume + delta);
  return volume;
}

export function toggleMute(): boolean {
  muted = !muted;
  persist();
  return muted;
}

function persist(): void {
  try {
    localStorage.setItem(KEY, String(volume));
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Not worth failing over.
  }
}
