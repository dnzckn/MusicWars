/**
 * Pre-rendered bullet sprites.
 *
 * Drawing 2000 bullets with per-bullet `arc()` + gradient + shadowBlur is the
 * fastest way to lose a frame budget in Canvas 2D. Each bullet type is instead
 * rendered once into a small offscreen canvas, and the hot loop is nothing but
 * `drawImage`. Rotating types get a handful of pre-baked angles so the hot loop
 * never needs a transform either.
 */

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Half-width, for centring without a division in the draw loop. */
  ox: number;
  oy: number;
}

/** Number of pre-baked rotations for rotating bullet types. */
export const ROTATIONS = 16;

function makeCanvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  return { c, g };
}

function glow(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, hue: number, coreLight = 96): void {
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, `hsla(${hue}, 100%, ${coreLight}%, 1)`);
  grad.addColorStop(0.32, `hsla(${hue}, 100%, 74%, 0.95)`);
  grad.addColorStop(0.62, `hsla(${hue}, 95%, 55%, 0.55)`);
  grad.addColorStop(1, `hsla(${hue}, 90%, 45%, 0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

/**
 * A notehead: the tilted filled ellipse every projectile in this game is built
 * from. Tilted, because a horizontal ellipse reads as a pill and a tilted one
 * reads instantly as notation.
 */
function notehead(radius: number, hue: number): Sprite {
  const pad = radius * 2.7;
  const size = Math.ceil(pad * 2);
  const { c, g } = makeCanvas(size);
  const cx = size / 2;
  glow(g, cx, cx, pad, hue);
  g.save();
  g.translate(cx, cx);
  g.rotate(-0.36);
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.beginPath();
  g.ellipse(0, 0, radius * 0.82, radius * 0.6, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return { canvas: c, ox: cx, oy: cx };
}

/** A staccato dot — the small, fast projectile. */
function staccato(radius: number, hue: number): Sprite {
  const pad = radius * 2.8;
  const size = Math.ceil(pad * 2);
  const { c, g } = makeCanvas(size);
  const cx = size / 2;
  glow(g, cx, cx, pad, hue);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.arc(cx, cx, radius * 0.5, 0, Math.PI * 2);
  g.fill();
  return { canvas: c, ox: cx, oy: cx };
}

/** An eighth note: notehead, stem and flag, oriented along its travel. */
function eighthNote(radius: number, hue: number, angle: number): Sprite {
  const len = radius * 3.2;
  const size = Math.ceil(len * 2.6);
  const { c, g } = makeCanvas(size);
  const cx = size / 2;
  g.translate(cx, cx);
  g.rotate(angle);
  glow(g, 0, 0, radius * 2.1, hue, 90);

  // Stem trails behind the head, so the note looks like it is being thrown.
  g.strokeStyle = `hsla(${hue}, 100%, 86%, 0.95)`;
  g.lineWidth = Math.max(1.3, radius * 0.3);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(-radius * 0.2, -radius * 0.25);
  g.lineTo(-len * 0.92, -radius * 0.95);
  g.stroke();

  // Flag.
  g.beginPath();
  g.moveTo(-len * 0.92, -radius * 0.95);
  g.quadraticCurveTo(-len * 0.5, -radius * 1.5, -len * 0.42, -radius * 0.2);
  g.lineWidth = Math.max(1, radius * 0.24);
  g.stroke();

  g.save();
  g.rotate(-0.36);
  g.fillStyle = 'rgba(255,255,255,0.97)';
  g.beginPath();
  g.ellipse(0, 0, radius * 0.86, radius * 0.62, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return { canvas: c, ox: cx, oy: cx };
}

/** A sharp sign — the "this one is dangerous" projectile. */
function sharpGlyph(radius: number, hue: number, angle: number): Sprite {
  const r = radius * 2.3;
  const size = Math.ceil(r * 2.7);
  const { c, g } = makeCanvas(size);
  const cx = size / 2;
  g.translate(cx, cx);
  g.rotate(angle);
  glow(g, 0, 0, r * 0.95, hue, 90);
  g.strokeStyle = `hsla(${hue}, 100%, 92%, 0.98)`;
  g.lineWidth = Math.max(1.2, radius * 0.3);
  g.lineCap = 'round';
  const a = radius * 0.62;
  g.beginPath();
  // Two verticals, sheared slightly, and two thicker slanted crossbars.
  g.moveTo(-a * 0.55, -a * 1.25);
  g.lineTo(-a * 0.3, a * 1.05);
  g.moveTo(a * 0.35, -a * 1.05);
  g.lineTo(a * 0.6, a * 1.25);
  g.stroke();
  g.lineWidth = Math.max(1.4, radius * 0.38);
  g.beginPath();
  g.moveTo(-a * 1.15, -a * 0.32);
  g.lineTo(a * 1.15, -a * 0.62);
  g.moveTo(-a * 1.15, a * 0.62);
  g.lineTo(a * 1.15, a * 0.32);
  g.stroke();
  return { canvas: c, ox: cx, oy: cx };
}

/** A slur/beam streak, used for the player's piercing shot. */
function beamNote(radius: number, hue: number, angle: number): Sprite {
  const len = radius * 3.1;
  const size = Math.ceil(len * 2.4);
  const { c, g } = makeCanvas(size);
  const cx = size / 2;
  g.translate(cx, cx);
  g.rotate(angle);
  const grad = g.createLinearGradient(-len, 0, len, 0);
  grad.addColorStop(0, `hsla(${hue}, 95%, 50%, 0)`);
  grad.addColorStop(0.42, `hsla(${hue}, 100%, 62%, 0.9)`);
  grad.addColorStop(0.75, `hsla(${hue}, 100%, 88%, 1)`);
  grad.addColorStop(1, `hsla(${hue}, 100%, 96%, 0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(0, 0, len, radius * 0.95, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.ellipse(len * 0.28, 0, radius * 0.7, radius * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  return { canvas: c, ox: cx, oy: cx };
}

/** Kept for the player's laser: a hard-edged streak. */
function diamondBullet(radius: number, hue: number, angle: number): Sprite {
  const r = radius * 2.2;
  const size = Math.ceil(r * 2.6);
  const { c, g } = makeCanvas(size);
  const cx = size / 2;
  g.translate(cx, cx);
  g.rotate(angle);
  glow(g, 0, 0, r * 0.95, hue, 88);
  g.beginPath();
  g.moveTo(r * 0.92, 0);
  g.lineTo(0, radius * 0.82);
  g.lineTo(-r * 0.92, 0);
  g.lineTo(0, -radius * 0.82);
  g.closePath();
  g.fillStyle = `hsla(${hue}, 100%, 88%, 0.95)`;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  g.stroke();
  return { canvas: c, ox: cx, oy: cx };
}

export interface BulletSpriteSet {
  /** [type][rotationIndex] — non-rotating types have a single entry. */
  frames: Sprite[][];
  rotating: boolean[];
}

/**
 * Projectile types. Everything either side fires is notation: the ensemble
 * attacks with notes, and the player answers with them.
 */
type Shape = 'notehead' | 'eighth' | 'staccato' | 'sharp' | 'beam';

/*
 * Colour contract: everything that can hurt you is warm (red through magenta),
 * everything friendly is cool (cyan) or green. The sharp used to be green,
 * which put enemy fire in the same hue family as the collectibles — the single
 * worst thing you can do to a screen this busy.
 *
 * Measured (`npm run contrast`): readability against the playfield is carried by
 * *luminance*, not hue. Every sprite has a near-white core over a dark ground,
 * so bullet-to-background distance stays in the 320-390 range even on the
 * gallop palette, where the room hue (8) sits almost on top of the enemy fire
 * hue (5). That means the room may be tinted freely; what must never change is
 * the bright core. Hue separation is what distinguishes threats from each other
 * and from pickups — a different job from being visible at all.
 */
const PLAYER_TYPES: { hue: number; radius: number; shape: Shape }[] = [
  // The player answers in eighth notes. Costs 16 pre-rendered frames and makes
  // the exchange read as a duel between two players rather than gunfire.
  { hue: 190, radius: 4.2, shape: 'eighth' },
  { hue: 320, radius: 7, shape: 'beam' },
  /*
   * Type 2: the `spawn` shape's ally. VIBRATO's hunters and nothing else.
   *
   * A third entry rather than reusing type 0, because an autonomous ally is a
   * SECOND POSITION the player is meant to be tracking and one that looked
   * identical to a PIZZICATO bolt would be untrackable in a field of them. A
   * sharp is the right glyph for it: bigger than a bolt, angular where the
   * eighth note is round, and unused by anything the enemies fire.
   *
   * `World.fireSpawn` sets `type: 2`; `drawBullets` indexes this table modulo
   * its own length, so an out-of-range type degrades to a visible sprite rather
   * than to a crash — which is why the number was safe to add without touching
   * that loop.
   */
  { hue: 54, radius: 9, shape: 'sharp' },
];

function buildSet(defs: { hue: number; radius: number; shape: Shape }[]): BulletSpriteSet {
  const frames: Sprite[][] = [];
  const rotating: boolean[] = [];
  for (const d of defs) {
    if (d.shape === 'notehead' || d.shape === 'staccato') {
      frames.push([d.shape === 'notehead' ? notehead(d.radius, d.hue) : staccato(d.radius, d.hue)]);
      rotating.push(false);
      continue;
    }
    const set: Sprite[] = [];
    for (let i = 0; i < ROTATIONS; i++) {
      const a = (i / ROTATIONS) * Math.PI * 2;
      set.push(
        d.shape === 'eighth'
          ? eighthNote(d.radius, d.hue, a)
          : d.shape === 'sharp'
            ? sharpGlyph(d.radius, d.hue, a)
            : d.shape === 'beam'
              ? beamNote(d.radius, d.hue, a)
              : diamondBullet(d.radius, d.hue, a),
      );
    }
    frames.push(set);
    rotating.push(true);
  }
  return { frames, rotating };
}

let playerSet: BulletSpriteSet | null = null;

/*
 * `enemyBulletSprites()` stood here and built four rotating frame sets — 4 x
 * ROTATIONS canvases — for a pool that no longer exists. `ENEMY_TYPES` goes
 * with it. See `src/game/enemies.ts` for why nothing shoots any more.
 */

export function playerBulletSprites(): BulletSpriteSet {
  playerSet ??= buildSet(PLAYER_TYPES);
  return playerSet;
}

/** A soft radial blob, reused for particles and glows. */
export function softDot(hue: number, radius = 12): HTMLCanvasElement {
  const size = radius * 2;
  const { c, g } = makeCanvas(size);
  glow(g, radius, radius, radius, hue);
  return c;
}
