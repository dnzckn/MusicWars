/**
 * Canvas type, sized in CSS px.
 *
 * THE UNIT PROBLEM. Both canvases draw in VIEW px, and the view is zoomed:
 * `viewForStage` keeps √(w·h) in [1004, 1240], so one view px is one CSS px
 * only at about 1440x900 and 0.54 CSS px on the two phone profiles the mobile
 * programme photographs (iPhone 14 390x844, Pixel 7 412x915 — `cssPerView`
 * measured 0.5422 and 0.5813). A `12px` canvas font is therefore 6.5 CSS px on
 * the phone, which is what the layout pass measured for the banner's subtitle
 * and is smaller than anything a stylesheet in this repo is allowed to set
 * (`typescale`'s 9 px floor). The owner's brief for this pass — "really make
 * the mobile experience premium and polished" — and the majority audience is
 * the phone.
 *
 * ONE HELPER, SO THERE IS ONE ARITHMETIC. The run bar and the boss HP label
 * each carried their own `Math.max(9, px) * u`; the banner, the ship's badge,
 * the popups, the pickups, the throttle's WARP caption and the whole level-up
 * panel carried none. Every canvas font now goes through this: a size in the
 * unit a person reads in, a floor, and the conversion. `u` is VIEW px per CSS
 * px (`1 / cssPerView`, 1 until the first layout and 1 in the node harnesses).
 *
 * THE FLOORS. 10 CSS px for body text — the smallest size a phone user can
 * read without bringing the screen closer, and a step above the stylesheet's
 * 9 because canvas text has no hinting. 12 for anything read MID-FIGHT: the
 * badge that says TAP, the WARP caption, the banner's title. The floor is
 * applied BEFORE the conversion, so it is a floor in CSS px whatever the zoom.
 *
 * REJECTED: scaling each widget's whole geometry by `u` instead. The run bar
 * already does this for its glyphs and it is right there (a diamond is a
 * state, and a state that shrinks with the zoom vanishes); for text the
 * geometry that matters is the line box, and every caller sizes that from the
 * same `u` beside the font call. A second helper returning "the px" was
 * considered and rejected as a second copy of `Math.max(floor, px) * u` — the
 * callers that need the number call `px()` below, which is the same line.
 */

/** The floor for text a player reads at leisure: captions, notes, labels. */
export const BODY_FLOOR = 10;

/** The floor for text a player must read while dodging. */
export const FIGHT_FLOOR = 12;

/** `cssPx` CSS px, floored, in view px. */
export function px(cssPx: number, u: number, floor = BODY_FLOOR): number {
  return Math.max(floor, cssPx) * u;
}

/**
 * A `ctx.font` string for `cssPx` CSS px of the game's monospace face, at
 * `weight`, on a canvas where one CSS px is `u` context px.
 */
export function font(weight: number | string, cssPx: number, u: number, floor = BODY_FLOOR): string {
  return `${weight} ${px(cssPx, u, floor).toFixed(1)}px ui-monospace, monospace`;
}

/**
 * The largest size, from `cssPx` down to `floor`, at which `text` fits in
 * `maxW` context px — for a centred line whose width the layout cannot
 * control (a banner title, a fusion's result name on the celebration plate).
 * Sets the context's font as a side effect, so the caller can measure or
 * fill straight away. Below the floor the text is the caller's problem
 * (`fit` with an ellipsis, or a narrower plate); the floor is never crossed
 * because a floor that yields is not a floor.
 */
export function fitFont(
  g: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  weight: number | string,
  cssPx: number,
  u: number,
  floor = BODY_FLOOR,
): number {
  let size = Math.max(floor, cssPx);
  g.font = font(weight, size, u, floor);
  const w = g.measureText(text).width;
  if (w > maxW && maxW > 0) {
    size = Math.max(floor, (size * maxW) / w);
    g.font = font(weight, size, u, floor);
  }
  return size;
}
