/**
 * MusicWars — entry point.
 *
 * Wiring, in one place:
 *
 *   World  --events-->  MusicDirector  --patterns-->  Strudel
 *     |                      |
 *     |                      +--> ref()/signal() caches, rebuilt on bar lines
 *     +--> GameSnapshot ---->|
 *     +--> immediate SFX ---> superdough (unquantised)
 *
 * The simulation never imports Strudel and the director never imports the
 * simulation's internals; they meet at `GameSnapshot` and `EventBus`.
 */

import type { MusicalState } from './core/events';
import { Input } from './core/input';
import { FIXED_DT, Loop } from './core/loop';
import { MusicDirector } from './audio/director';
import { getAudioContext } from '@strudel/webaudio';
import {
  audioStatus,
  audioSuspended,
  bootAudio,
  getRepl,
  pauseAudio,
  playPattern,
  resumeAudio,
  startAudio,
  syncTransport,
} from './audio/engine';
import {
  sfxBomb,
  sfxEnemyDeath,
  sfxEnemyFire,
  sfxEnemyHit,
  sfxExtend,
  sfxGraze,
  sfxPickup,
  sfxPlayerHit,
  sfxRunStart,
  sfxShard,
  sfxShoot,
  sfxWaveClear,
} from './audio/sfx';
import { isMuted, nudgeVolume, setVolume, toggleMute, volumeSetting } from './audio/volume';
import { themeForWave } from './audio/layers';
import { Hud } from './render/hud';
import { combinationPlan } from './render/levelup';
import { STARTERS, STARTING_INSTRUMENT } from './game/progression';
import { codex, discoveryLine, loadDiscovered, record, saveDiscovered, summary } from './game/discovery';
import { abilityLevels } from './game/progression';
import { instrumentDef, labelOf } from './game/weapons';
import { Renderer } from './render/renderer';
import { World } from './game/world';
import { setView, stageBox, viewForStage } from './game/field';

const playfield = document.getElementById('playfield') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
const titleScreen = document.getElementById('title-screen')!;
const pauseScreen = document.getElementById('pause-screen')!;
const gameoverScreen = document.getElementById('gameover-screen')!;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const retryButton = document.getElementById('retry-button') as HTMLButtonElement;
const finalScore = document.getElementById('final-score')!;
const finalWave = document.getElementById('final-wave')!;
const finalBest = document.getElementById('final-best')!;
const pauseStats = {
  score: document.getElementById('pause-score')!,
  wave: document.getElementById('pause-wave')!,
  mult: document.getElementById('pause-mult')!,
  notes: document.getElementById('pause-notes')!,
  music: document.getElementById('pause-music')!,
  combos: document.getElementById('pause-combos')!,
  combosNone: document.getElementById('pause-combos-none')!,
};
const titleBest = document.getElementById('title-best')!;
const uiBest = document.getElementById('ui-best')!;

/**
 * Personal best.
 *
 * A run needs somewhere to land. Without a number to beat, a game over is just
 * the music stopping — this is the cheapest possible reason to press AGAIN.
 */
const BEST_KEY = 'musicwars.best';
let bestScore = 0;
try {
  bestScore = Number(localStorage.getItem(BEST_KEY) ?? '0') || 0;
} catch {
  bestScore = 0;
}

/*
 * "Pick upgrades for me, at random." A preference, so it persists across runs.
 *
 * Wrapped in try/catch for the same reason `bestScore` is: localStorage throws
 * outright in a headless context and in private-mode Safari, and a settings
 * checkbox is not worth failing a boot over.
 */
const AUTOPICK_KEY = 'musicwars.autopick';
let autoPick = false;
try {
  autoPick = localStorage.getItem(AUTOPICK_KEY) === '1';
} catch {
  autoPick = false;
}

function paintBest(): void {
  const text = bestScore.toLocaleString('en-US');
  uiBest.textContent = text;
  titleBest.textContent = bestScore > 0 ? `BEST ${text}` : '';
}
paintBest();

/**
 * The run's seed, and why it is reachable from outside.
 *
 * `World` has always accepted one — `constructor(seed = Date.now() & 0xffffffff)`
 * — but this call site never passed anything, so every run was unrepeatable and
 * the only way a tool could pin one was to reach in and overwrite `world.rng`'s
 * internal state before `startRun()`. That works, and the capture tool did
 * exactly that, but it is a trick that depends on a field name rather than a
 * contract, and it silently stops working the day the generator is swapped.
 *
 * The master plan's S1/S2/S5 listening passes are before/after WAV pairs at a
 * FIXED seed. Comparing two mixes recorded from two different runs is not a
 * comparison at all, so this needs to be real. `?seed=0x51ed` — the seed the
 * rest of the harness already uses — is now all it takes.
 *
 * Absent or unparseable, the behaviour is exactly what it was: clock-seeded.
 */
const seedParam = new URLSearchParams(location.search).get('seed');
const parsedSeed = seedParam === null ? NaN : Number(seedParam);
const world = new World(Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : undefined);
const director = new MusicDirector();
/**
 * The arrangement's position, carried from `render` back into `update`.
 *
 * A single mutated object rather than a fresh one per frame: this runs at up to
 * 144 Hz for the length of a run, and `World.setMusicalState` copies its fields
 * out rather than keeping the reference, so nothing downstream can be surprised
 * by it changing.
 */
const lastMusical: MusicalState = { section: 'sustain', energy: 0.45 };
const renderer = new Renderer(playfield, overlay, world);
const hud = new Hud();
const input = new Input();

// ---------------------------------------------------------------------------
// touch
// ---------------------------------------------------------------------------

const touchControls = document.getElementById('touch-controls')!;
const stage = document.getElementById('stage')!;
const app = document.getElementById('app')!;

// ---------------------------------------------------------------------------
// layout — the view is a function of the window
// ---------------------------------------------------------------------------

/**
 * Size the stage to the window and set `VIEW_W/VIEW_H` from it.
 *
 * THIS FUNCTION IS "GIVE THE SCREEN BACK". Everything else in the change is
 * consequence. `VIEW_W/VIEW_H` were hardcoded at 900x1120 beside a sidebar
 * that took 30% of the window; here the playfield takes all of it and the view
 * is derived from what it got.
 *
 * The order matters and is the reason this is one function rather than a
 * resize listener per interested party:
 *
 *   1. measure the box the stage may have — `#app`'s content area, LESS the
 *      touch button row when one is showing. The row is a sibling below the
 *      stage, so on a phone the playfield has to shrink to make room for it;
 *      `touchcheck` asserts the buttons never overlap the field and this
 *      subtraction is what keeps that true.
 *   2. clamp that box's ASPECT (`stageBox`) and write it as an explicit
 *      width/height. Explicit, not `flex: 1`, because a clamp expressed in CSS
 *      would need the other axis's used value and CSS cannot see it.
 *   3. derive the view from the stage box (`viewForStage`) so the two
 *      rectangles are the same shape by construction.
 *   4. tell the renderer, which owns the bloom bitmap and the starfield.
 *
 * Idempotent and cheap enough to call from a `resize` listener directly: two
 * `getBoundingClientRect` reads and at most four style writes, and step 4 is
 * skipped entirely when the view did not actually move.
 */
function layout(): void {
  const cs = getComputedStyle(app);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW = app.clientWidth - padX;
  let availH = app.clientHeight - padY;
  if (!touchControls.classList.contains('hidden')) {
    const gap = parseFloat(cs.rowGap) || 0;
    availH -= touchControls.getBoundingClientRect().height + gap;
  }
  const box = stageBox(availW, availH);
  stage.style.width = `${box.w}px`;
  stage.style.height = `${box.h}px`;
  const v = viewForStage(box.w, box.h);
  // Only when it MOVED. A stage box that changed without moving the view is
  // already covered — `Renderer` keeps a `ResizeObserver` on the canvas for
  // exactly that case, and reallocating the bloom bitmap and rescaling 140
  // stars on every pixel of a window drag would be work for nothing.
  if (setView(v.w, v.h)) renderer.viewChanged();
}

addEventListener('resize', layout);
addEventListener('orientationchange', layout);
layout();

/*
 * ONE POINTER, TWO COORDINATE SYSTEMS.
 *
 * These were a single `toPlayfield` because today `VIEW_W/H` and
 * `PLAYFIELD_W/H` are the same numbers, so a tap has the same coordinates in
 * both. They are separated now, before a camera makes them differ, because the
 * two callers want genuinely different things and the failure mode of getting
 * it wrong is invisible — see `routeOfferPointer` below.
 *
 *   toView  — where on the SCREEN the finger landed. The level-up cards, the
 *             reroll and skip controls and everything else on the overlay are
 *             laid out against `viewW`/`viewH` (`renderer.ts` passes exactly
 *             those into `levelUp.draw`), so a hit test must use the same pair.
 *   toWorld — which point in the SIMULATION the finger is pointing at. This is
 *             a steering target and is compared against the ship's own
 *             position in `input.ts`, which is world space.
 */

/** Where on the screen the pointer landed, in view coordinates. */
function toView(e: PointerEvent): { x: number; y: number } {
  const r = playfield.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * world.viewW,
    y: ((e.clientY - r.top) / r.height) * world.viewH,
  };
}

/**
 * Which point in the world the pointer is over, in simulation coordinates.
 *
 * Screen -> view -> plus the camera's top-left -> world. The camera is at the
 * origin today so the last step adds zero, and it is written out anyway
 * because the alternative is a function that looks like a pointless alias of
 * `toView` and gets deleted by the next reader.
 *
 * `viewX`/`viewY` rather than the composed `camera.x`/`camera.y`: the composed
 * offset carries screenshake, and a steering target that jitters with every
 * explosion would make the ship twitch at exactly the moment the player most
 * needs it to go where they pointed.
 */
function toWorld(e: PointerEvent): { x: number; y: number } {
  const v = toView(e);
  return { x: v.x + world.camera.viewX, y: v.y + world.camera.viewY };
}

/**
 * A click or tap on the level-up offer.
 *
 * Routed through `renderer.levelUp.hitTest`, which returns a card index in
 * playfield canvas coordinates, rather than re-deriving the card rectangles
 * here. The failure mode of two copies of that layout is silent and nasty: the
 * cards draw in one place, the hit test believes they are in another, and the
 * player clicks PIZZICATO and receives SNARE ROLL with nothing on screen
 * looking wrong.
 *
 * Returns true when the pointer was consumed by the offer, so the same event
 * does not also steer the ship toward the card the player just tapped.
 */
function routeOfferPointer(e: PointerEvent): boolean {
  if (!world.choosing) return false;
  const pt = toView(e);
  const control = renderer.levelUp.hitTestControl(pt.x, pt.y);
  if (control === 'reroll') {
    input.pointerReroll = true;
    return true;
  }
  if (control === 'skip') {
    input.pointerSkip = true;
    return true;
  }
  const card = renderer.levelUp.hitTest(pt.x, pt.y);
  if (card < 0) return false;
  // Banishing needs a target as well as an intent, so it is the modifier on a
  // card rather than a lever of its own: hold shift (or the BANISH control,
  // which arms the same modifier) and click the card you want gone.
  if (control === 'banish' || e.shiftKey) input.pointerBanish = card;
  else input.pointerChoice = card;
  return true;
}

stage.addEventListener('pointerdown', (e) => {
  // Mouse included, deliberately: the offer is the one screen a desktop player
  // is expected to click, and the steering path below ignores mice entirely.
  if (routeOfferPointer(e)) {
    e.preventDefault();
    return;
  }
  if (e.pointerType === 'mouse') return;
  if (touchControls.classList.contains('hidden')) {
    touchControls.classList.remove('hidden');
    // The row is a sibling below the stage, so revealing it takes height away
    // from the playfield. Without this the stage keeps its old box and the
    // buttons are pushed off the bottom of the window on the very first touch.
    layout();
  }
  const pt = toWorld(e);
  input.setPointerTarget(pt.x, pt.y);
  try {
    stage.setPointerCapture(e.pointerId);
  } catch {
    // A pointer id that is no longer active throws. Capture is an optimisation
    // for drags that leave the element; losing it is not worth a dead frame.
  }
  e.preventDefault();
});
stage.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') return;
  // Do not steer while an offer is open. The world is paused, so a drag across
  // the cards would bank up a heading the ship then takes the instant play
  // resumes — the player would arrive back in the fight somewhere they did not
  // choose to be. (This mattered more when the world merely slowed to 12% and
  // the ship actually crept across the arena while they read; it still matters,
  // because the input is live even while the simulation is not.)
  if (world.choosing) return;
  const pt = toWorld(e);
  input.setPointerTarget(pt.x, pt.y);
  e.preventDefault();
});
const releasePointer = (e: PointerEvent) => {
  if (e.pointerType === 'mouse') return;
  input.setPointerTarget(null);
};
stage.addEventListener('pointerup', releasePointer);
stage.addEventListener('pointercancel', releasePointer);

const bindTouchButton = (id: string, press: () => void, hold?: (down: boolean) => void) => {
  const el = document.getElementById(id)!;
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    press();
    hold?.(true);
  });
  const up = (ev: Event) => {
    ev.preventDefault();
    hold?.(false);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
};
bindTouchButton('touch-bomb', () => (input.touchBomb = true));
bindTouchButton('touch-well', () => (input.touchWell = true));
bindTouchButton('touch-focus', () => {}, (down) => (input.touchFocus = down));

// ---------------------------------------------------------------------------
// volume
// ---------------------------------------------------------------------------

const autoPickBox = document.getElementById('ui-autopick') as HTMLInputElement | null;
if (autoPickBox) {
  autoPickBox.checked = autoPick;
  autoPickBox.addEventListener('change', () => {
    autoPick = autoPickBox.checked;
    try {
      localStorage.setItem(AUTOPICK_KEY, autoPick ? '1' : '0');
    } catch {
      /* Preference is still live for this run; only persistence is lost. */
    }
  });
}

const volumeSlider = document.getElementById('ui-volume') as HTMLInputElement;
const muteButton = document.getElementById('ui-mute') as HTMLButtonElement;
const volumeNumber = document.getElementById('ui-volnum')!;

function paintVolume(): void {
  const v = volumeSetting();
  const pct = Math.round(v * 100);
  volumeSlider.value = String(pct);
  volumeSlider.style.setProperty('--fill', `${pct}%`);
  volumeNumber.textContent = isMuted() ? 'off' : String(pct);
  muteButton.classList.toggle('muted', isMuted());
  muteButton.textContent = isMuted() ? '\u266D' : '\u266B';
}

volumeSlider.addEventListener('input', () => {
  setVolume(Number(volumeSlider.value) / 100);
  paintVolume();
});
muteButton.addEventListener('click', () => {
  toggleMute();
  paintVolume();
});
paintVolume();

let paused = false;
/** True from the moment a run starts until the next one; stays true through the
 *  game-over screen so the music can finish collapsing. */
let inRun = false;
/** Set on the frame the audio clock should be re-read. */
let needsSync = true;

// ---------------------------------------------------------------------------
// game -> music routing
// ---------------------------------------------------------------------------

const t = world.transport;

world.bus.on('wave:start', (e) => director.onWaveStart(t, e));
world.bus.on('wave:clear', (e) => {
  director.onWaveClear(t, e);
  sfxWaveClear(director.currentChordNotes(), e.grade);
});
world.bus.on('boss:telegraph', (e) => director.onBossTelegraph(t, e));
world.bus.on('boss:phase', (e) => {
  director.onBossPhase(t, e);
  sfxBomb();
});
world.bus.on('boss:defeat', () => director.onBossDefeat(t));

world.bus.on('player:hit', () => {
  director.onPlayerHit();
  sfxPlayerHit();
});
world.bus.on('player:death', () => {
  director.onPlayerDeath(t);
  sfxPlayerHit();
});
world.bus.on('player:bomb', () => {
  director.onBomb(t);
  sfxBomb();
});
world.bus.on('player:extend', () => sfxExtend());

world.bus.on('powerup:pickup', (e) => {
  director.onPickup(t, e.kind);
  sfxPickup(e.level * 2);
});
world.bus.on('powerup:expire', (e) => director.onPickup(t, e.kind));

/*
 * The shard tick. See sfx.ts for why this is one short voice and not the
 * four-note pickup arpeggio: it fires roughly fifty times a minute, and a
 * melody nobody wrote would fight the eleven stems somebody did.
 *
 * The tier is mapped to an index here rather than in sfx.ts, because the
 * audio layer must not import from game/ -- the same one-directional rule
 * that makes events.ts restate the ability ids instead of re-exporting them.
 */
const SHARD_STEP: Record<string, number> = { minor: 0, major: 1, rare: 2 };
world.bus.on('shard:collect', (e) => sfxShard(SHARD_STEP[e.tier] ?? 0, e.combo));

/*
 * Progression, answered with sound.
 *
 * Deliberately only SFX here. The arrangement's response to a level-up — the
 * fermata over a held dominant that resolves on the choice — belongs to the
 * director, and calling into it for events it has not declared handlers for
 * would be this file inventing the audio side's interface for it.
 */
world.bus.on('level:offer', () => sfxPickup(7));
world.bus.on('level:choice', (e) => sfxPickup(Math.min(9, e.level)));
/*
 * A fusion gets BOTH a sound and a change to the score, and all three kinds
 * get them.
 *
 * The stinger was already here for `evolve` and `union`; `duet` had no handler
 * at all, so the generative tier landed in silence. And a one-shot is not the
 * same as the music responding — the director had no fusion hook whatsoever,
 * so the band could change shape and the arrangement would not react. See
 * `MusicDirector.onFusion`.
 */
world.bus.on('ability:evolve', (e) => {
  sfxWaveClear(director.currentChordNotes(), 'perfect');
  director.onFusion('evolution');
  if (record(discovered, e.to)) { saveDiscovered(discovered); paintDiscovered(); }
});
world.bus.on('ability:union', (e) => {
  sfxWaveClear(director.currentChordNotes(), 'perfect');
  director.onFusion('union');
  // Generic unions carry a synthesised id and `record` ignores them; only the
  // two authored ones are collectable.
  if (record(discovered, e.to)) { saveDiscovered(discovered); paintDiscovered(); }
});
world.bus.on('ability:duet', () => {
  sfxWaveClear(director.currentChordNotes(), 'clean');
  director.onFusion('duet');
});

// A charge committing is the note a volley used to be; see `enemy:lunge`.
world.bus.on('enemy:lunge', (e) => {
  sfxEnemyFire(e.archetype, director.currentChordNotes()[0] ?? 57, e.pan);
});

// Hits are frequent; throttle so they stay a confirmation rather than a buzz.
let lastHitNote = 0;
world.bus.on('enemy:hit', (e) => {
  if (e.lethal) return; // the death sound covers it
  const now = performance.now();
  if (now - lastHitNote < 70) return;
  lastHitNote = now;
  sfxEnemyHit(director.currentChordNotes());
});

world.bus.on('enemy:death', (e) => {
  if (!e.byPlayer) return;
  // Pass the archetype and the current root: the enemy dies in its own voice,
  // in key. `enemy:death` has always carried the archetype; it was being
  // collapsed into a size number and discarded.
  sfxEnemyDeath(
    e.archetype === 'conductor' ? 1 : e.archetype === 'subdrop' ? 0.8 : 0.35,
    e.archetype,
    director.currentChordNotes()[0],
  );
});

// Grazing is continuous and can fire many times a second; throttle it so it
// stays a texture rather than a wall of clicks.
let lastGraze = 0;
world.bus.on('player:graze', (e) => {
  const now = performance.now();
  if (now - lastGraze < 55) return;
  lastGraze = now;
  sfxGraze(e.total % 13);
});

/*
 * When the run ended, so the restart key can be ignored for a beat. The AGAIN
 * button is unaffected — a deliberate click is never an accident.
 */
const RUN_OVER_GRACE = 700;
let runOverAt = -Infinity;

world.bus.on('run:over', (e) => {
  runOverAt = performance.now();
  finalScore.textContent = e.score.toLocaleString('en-US');
  finalWave.textContent = String(e.wave);

  // What the run was, and what it sounded like. The premise of the game is
  // that the fight writes the music, so the end is where that gets read back.
  const t = world.totals;
  const heard = director.heard;
  document.getElementById('final-notes')!.textContent = t.notes.toLocaleString('en-US');
  document.getElementById('final-mult')!.textContent = `x${t.bestMultiplier}`;
  document.getElementById('final-flawless')!.textContent = String(t.flawless);
  document.getElementById('final-grazes')!.textContent = t.grazes.toLocaleString('en-US');

  const keys = [...heard.keys];
  const grooves = [...heard.grooves];
  const el = document.getElementById('final-heard')!;
  el.replaceChildren();
  const add = (label: string, value: string) => {
    const b = document.createElement('b');
    b.textContent = value;
    el.append(document.createTextNode(label), b, document.createTextNode('  '));
  };
  add('you played in ', keys.length === 1 ? keys[0] : `${keys.length} keys`);
  add('through ', grooves.length === 1 ? grooves[0] : `${grooves.length} grooves`);
  // Peak energy and the deepest section: tracked last iteration and then not
  // shown, which is the same "looks implemented, isn't" shape this project has
  // hit repeatedly. Either display it or delete it.
  const deepest = (['drop', 'build', 'sustain', 'breakdown', 'intro'] as const).find((x) =>
    heard.sections.has(x),
  );
  if (deepest) add('peaking at ', `${deepest} · ${Math.round(heard.peakEnergy * 100)}% energy`);
  if (keys.length > 1) {
    el.append(document.createElement('br'));
    const b = document.createElement('b');
    b.textContent = keys.slice(-4).join(' → ');
    el.append(b);
  }
  /*
   * THE BAND, and the one you nearly had.
   *
   * The end screen listed the music and said nothing about the build, which is
   * the half the player actually chose. In a game where committing to a fusion
   * is worth 2.3x the designed combinations and +11% on wave reached, the
   * moment they are deciding whether to go again is the wrong moment to hide
   * what they made.
   *
   * The second line is the hook: the nearest thing they did NOT finish, with
   * what it wanted. `combinationPlan` already sorts designed recipes above
   * generic duets and aims by distance, so its first unfinished row is exactly
   * "the one that got away".
   */
  const bandEl = document.getElementById('final-band')!;
  bandEl.replaceChildren();
  const prog = world.progression;
  const held = Object.entries(prog.instruments as Record<string, number>)
    .filter(([, lv]) => lv > 0)
    .sort((a, b) => b[1] - a[1]);
  if (held.length) {
    bandEl.append(document.createTextNode('your band  '));
    held.forEach(([id, lv], i) => {
      if (i) bandEl.append(document.createTextNode(' · '));
      const fused = prog.fusions.includes(id);
      const node = fused ? document.createElement('b') : document.createElement('span');
      // A fusion is named alone; an ordinary instrument carries how far it got.
      node.textContent = fused ? labelOf(id) : `${labelOf(id)} ${lv}`;
      bandEl.append(node);
    });
    // `abilityLevels` merges instruments and rig, which is the flat record the
    // plan expects — the same read the HUD uses.
    const nearest = combinationPlan(abilityLevels(prog), discovered).find((r) => !r.ready);
    if (nearest) {
      const near = document.createElement('span');
      near.className = 'near';
      near.append(document.createTextNode('one step from '));
      const b = document.createElement('b');
      b.textContent = nearest.label;
      near.append(b, document.createTextNode(` — needed ${nearest.needs}`));
      bandEl.append(near);
    }
  }

  const beaten = e.score > bestScore;
  if (beaten) {
    bestScore = e.score;
    try {
      localStorage.setItem(BEST_KEY, String(bestScore));
    } catch {
      // Nothing to do; the run still counted.
    }
    paintBest();
  }
  finalBest.textContent = beaten ? 'NEW BEST' : `best ${bestScore.toLocaleString('en-US')}`;
  finalBest.style.color = beaten ? 'var(--gold)' : 'var(--dim)';
  gameoverScreen.classList.remove('hidden');
});

// ---------------------------------------------------------------------------
// shooting SFX, throttled at source
// ---------------------------------------------------------------------------

/*
 * The shot sound is keyed to the world now, not to the input.
 *
 * There is no fire button any more, so `input.state.shoot` is false for the
 * whole run on a keyboard and the ship would be silent while firing six
 * instruments. `player:shoot` is emitted by the world on any step where at
 * least one instrument discharged, which is the honest trigger — and it fires
 * far more often than a held button did, because six instruments on six
 * cadences interleave, so the throttle matters more than it used to rather
 * than less.
 */
let lastShot = 0;
let lastShotId: string | undefined;

world.bus.on('player:shoot', (e) => {
  const now = performance.now();
  /*
   * ~11 per second maximum PER VOICE, and never throttled when the voice
   * changes.
   *
   * A flat window was right when every instrument made one identical blip:
   * above about eleven a second a confirmation stops being a confirmation and
   * becomes a texture, which is the arp's job and not this one's. Now that each
   * instrument has its own oscillator and decay, a shared window has a second
   * effect nobody asked for — it drops whichever shot lands inside it, and the
   * shots that land inside it are overwhelmingly the RARE ones. PIZZICATO fires
   * four to ten times a second and TIMPANI about every three, so a shared
   * window silences the timpani roughly in proportion to how busy the pizzicato
   * is. That is exactly backwards, and it would have quietly undone most of the
   * work of giving the instruments distinct voices.
   *
   * The world already resolves a same-tick collision in favour of the rarest
   * instrument; this is the other half of that, making sure the choice survives
   * the trip to the speakers. A repeated voice is still capped, so the texture
   * argument is untouched.
   */
  const changed = e.id !== undefined && e.id !== lastShotId;
  if (!changed && now - lastShot < 88) return;
  lastShot = now;
  lastShotId = e.id;
  // Pass which instrument fired, so a bell sounds like a bell. Without this
  // every ability in the game makes one identical blip, which is the premise
  // broken at the point the player hears most often.
  sfxShoot(director.currentChordNotes(), world.player.focused, e.id, e.voice);
});

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

const loop = new Loop({
  update(dt) {
    /*
     * Freeze while the audio is suspended.
     *
     * A phone can suspend the AudioContext without hiding the tab — a call, the
     * ringer switch — and the game would happily keep simulating in silence.
     * That is bad twice over: this is a music game, so playing it silently is
     * pointless; and the transport keeps advancing off wall-clock while
     * Strudel's clock is frozen, so on resume the two are seconds apart and the
     * correction snaps a whole screen of beat-scheduled enemy fire.
     */
    /*
     * Both early returns discard pending edge presses before they leave.
     *
     * `update` is the only hook that samples the input, so a branch that skips
     * it is a branch where nothing will ever consume the key-down edges the
     * `Input` listener is still collecting. The pause screen and the title
     * screen have their own `window` keydown handler further down this file
     * and keep running throughout, so without this a C pressed while paused —
     * or on the title screen, before the run even starts — would still be
     * sitting in the set and would throw a black hole on the first simulated
     * step after resuming.
     *
     * The old code got this for free from `input.endFrame()` in `render`, and
     * that free lunch was the 144 Hz bug: `render` runs on frames that
     * simulate nothing, so it also cleared presses the simulation had not yet
     * seen. See the long note on `pressed` in `core/input.ts`. The discard has
     * to live here, next to the decision not to simulate, not in `render`.
     */
    if (audioSuspended()) {
      input.discardEdges();
      return;
    }
    if (paused || !inRun) {
      input.discardEdges();
      return;
    }
    // A dev-only input override, so tooling can drive the ship directly rather
    // than through synthetic key events. Balance conclusions drawn from one
    // fixed strategy are conclusions about that strategy, not about the game.
    const injected = import.meta.env.DEV
      ? ((window as unknown as Record<string, unknown>).__botInput as typeof input.state | null)
      : null;
    // Pointer steering needs to know where the ship is to steer toward a point.
    input.shipX = world.player.x;
    input.shipY = world.player.y;
    const state = injected ?? input.sample();
    /*
     * THE ONE INBOUND EDGE OF THE GAME/MUSIC BOUNDARY.
     *
     * `core/events.ts` says the simulation emits and never receives, and every
     * musical signal this project publishes has been output-only since it
     * started — which `docs/plan-items-v2.md` §2 identifies as the reason the
     * soundtrack is a beautiful readout of a fight it has no say in. DROP
     * (`feedback`) is the first item that needs it back.
     *
     * A VALUE PUSH, NOT A CALL. `World.setMusicalState` copies two numbers off
     * a readout; the world holds no director, cannot ask it a question, and
     * `src/game/` still never imports `src/audio/`. Either half can still be
     * rewritten without the other, which is the property that boundary exists
     * to protect.
     *
     * ONE FRAME STALE, deliberately: the readout is built in `render`, which
     * runs after this. A section holds for a minimum of four bars
     * (`arrangement.ts` MIN_BARS) — 7.5 seconds at 128 BPM — so a 16ms lag is
     * three orders of magnitude inside the signal, and computing a second
     * readout here would cost more than it could possibly buy.
     */
    world.setMusicalState(lastMusical);
    /*
     * The auto-pick preference rides on the input rather than living in the
     * world, for the same reason the offer request does: `World` is driven by
     * forty headless tools and a preference is not simulation state. It is read
     * fresh every step so toggling it mid-run takes effect immediately, which
     * is what a settings checkbox is expected to do.
     */
    state.autoPick = autoPick;
    world.update(dt, state);
    director.update(world.snapshot, world.transport, dt);
  },
  render(alpha, frameDt) {
    if (needsSync) {
      syncTransport(world.transport);
      needsSync = false;
    }
    const readout = director.readout(world.transport);
    // Handed to the simulation at the top of the next `update`; see there.
    lastMusical.section = readout.section;
    lastMusical.energy = readout.energy;
    // Caption every announcement with what the music just became.
    renderer.bannerDetail = `${readout.key.toUpperCase()} · ${readout.feel.toUpperCase()} · ${readout.bpm} BPM`;
    renderer.targetHue = readout.paletteHue;
    renderer.render(paused || !inRun ? 1 : alpha, frameDt, world.transport, readout.tension, loop.fps);

    /*
     * `sampleBar` and `sourceLines` are no longer called from here.
     *
     * They fed the notation canvas and the generated-source block, and both are
     * gone with the sidebar — see the header of `render/hud.ts` for what was
     * deleted and what the frame-rate A/B actually said about it. The director
     * still exposes both methods and `tools/capture.mjs` still uses them; this
     * frame hook simply no longer asks once a bar for eleven patterns and five
     * lines of formatted source that nothing renders.
     */
    hud.update(
      world.snapshot,
      readout,
      loop.fps,
      audioSuspended() ? 'tap to resume' : audioStatus(),
      world.transport.barPhase,
    );
    /*
     * Nothing touches the input here any more. `input.endFrame()` used to be
     * this line, and it is the reason one tap of the black-hole key spent four
     * wells at 30 Hz and none at all on ~17% of frames at 144 Hz: `render`
     * runs exactly once per displayed frame while `update` runs zero to eight
     * times, so a per-frame clear can never agree with a per-step read. The
     * edge set is now drained by `sample()` itself. Do not put a per-frame
     * input call back in this hook — `tools/inputcheck.mjs` check E will say
     * so, but by then someone has already shipped it.
     */
    needsSync = true;
  },
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

/*
 * THE OPENING CHOICE.
 *
 * Built from `STARTERS` rather than hardcoded, so the list cannot drift from
 * the one `resetProgression` will actually honour — it validates against the
 * same array and silently falls back, which would turn a stale button into a
 * player wondering why their pick did nothing.
 *
 * The selection persists: a player who liked ECHOES should not have to re-pick
 * it every run, and the retry button never passes through here at all.
 */
/*
 * The collection, loaded once and written on each new find.
 *
 * Written immediately rather than at run end: a player who closes the tab
 * mid-run has still made the thing, and losing it would be the one bug this
 * feature cannot afford — the whole point is that it survives the run.
 */
const discovered = loadDiscovered();
/*
 * The world asks; this answers. It is consulted one line ABOVE the emits that
 * trigger `record` below — see `rewardBoss`/the fusion card path in world.ts —
 * because a hook read after them would always answer "seen before".
 */
const discoveredEl = document.getElementById('title-discovered')!;
const codexGrid = document.getElementById('codex-grid')!;
function paintDiscovered(): void {
  const s = summary(discovered);
  discoveredEl.textContent = discoveryLine(discovered);
  discoveredEl.classList.toggle('complete', s.found === s.total);
  /*
   * The grid is rebuilt rather than patched. It is fourteen rows, drawn on the
   * title screen and after each find — there is no frame budget here worth
   * protecting, and a rebuild cannot drift out of step with the set.
   */
  codexGrid.replaceChildren();
  for (const row of codex(discovered)) {
    const li = document.createElement('li');
    if (row.found) li.classList.add('found');
    const name = document.createElement('b');
    name.textContent = `${row.found ? '◈' : '·'} ${row.label}`;
    const recipe = document.createElement('em');
    recipe.textContent = row.recipe;
    li.append(name, recipe);
    codexGrid.append(li);
  }
}
paintDiscovered();

world.isFirstDiscovery = (id) => !discovered.has(id);

const OPENER_KEY = 'musicwars.opener';
let chosenOpener: string = STARTING_INSTRUMENT;
try {
  const saved = localStorage.getItem(OPENER_KEY);
  if (saved && STARTERS.includes(saved)) chosenOpener = saved;
} catch {
  // Private browsing. The default opener is a fine answer.
}

const starterRow = document.querySelector('#starters .starter-row')!;
function paintOpeners(): void {
  starterRow.replaceChildren();
  for (const id of STARTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'starter';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === chosenOpener));
    const name = document.createElement('b');
    name.textContent = labelOf(id);
    const desc = document.createElement('em');
    desc.textContent = instrumentDef(id)?.blurb ?? '';
    b.append(name, desc);
    b.addEventListener('click', () => {
      chosenOpener = id;
      try { localStorage.setItem(OPENER_KEY, id); } catch { /* see above */ }
      paintOpeners();
    });
    starterRow.append(b);
  }
}
paintOpeners();

async function startRun(): Promise<void> {
  // Set before `start()`, which is also the retry path — see `World.starter`.
  world.starter = chosenOpener;
  titleScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');

  // Audio must be unlocked from inside the gesture that got us here.
  try {
    await bootAudio(128);
    director.reset(0);
    playPattern(director.masterPattern());
  } catch (err) {
    console.error('[musicwars] audio unavailable, running silent', err);
  }

  world.start();
  // Answer the click immediately; the scheduled arrangement joins underneath.
  sfxRunStart(director.currentChordNotes());
  inRun = true;
  paused = false;
}

startButton.addEventListener('click', () => void startRun());
retryButton.addEventListener('click', () => void startRun());

window.addEventListener('keydown', (e) => {
  // Volume from the keyboard, so a player mid-run never has to reach for a
  // slider they cannot look at.
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
    nudgeVolume(-0.05);
    paintVolume();
    return;
  }
  if (e.code === 'Equal' || e.code === 'NumpadAdd') {
    nudgeVolume(0.05);
    paintVolume();
    return;
  }
  if (e.code === 'KeyM') {
    toggleMute();
    paintVolume();
    return;
  }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!inRun || world.isOver) return;
    paused = !paused;
    if (paused) {
      // Snapshot the run into the pause screen: a pause is the one moment a
      // player can actually read anything, so it should be worth reading.
      const snap = world.snapshot;
      const readout = director.readout(world.transport);
      pauseStats.score.textContent = snap.score.toLocaleString('en-US');
      pauseStats.wave.textContent = String(snap.wave + 1);
      pauseStats.mult.textContent = `x${1 + snap.combo}`;
      /*
       * The run's TOTAL, not the shards lying on the floor right now.
       *
       * `world.notes` is the live array of uncollected shards, so this read as
       * a number that fell as the player collected them — pausing after a
       * clean sweep showed 0 notes for a run that had banked hundreds. The
       * game-over screen already uses `world.totals.notes`; the pause screen
       * was reading a different quantity under the same label.
       */
      pauseStats.notes.textContent = world.totals.notes.toLocaleString('en-US');
      pauseStats.music.textContent =
        `${readout.key.toUpperCase()} · ${readout.feel.toUpperCase()} · ${readout.bpm} BPM · ${readout.section.toUpperCase()}`;

      /*
       * The build plan. Six rows, because the pause screen also carries the
       * control list and a plan you have to scroll is not one you read.
       * `combinationPlan` sorts what is takeable now to the top, so the
       * truncation only ever hides the most distant aims — and it says how
       * many it hid rather than pretending the list is complete.
       */
      const plan = combinationPlan(snap.abilities, discovered);
      const SHOWN = 6;
      pauseStats.combos.replaceChildren();
      for (const row of plan.slice(0, SHOWN)) {
        const li = document.createElement('li');
        if (row.ready) li.classList.add('ready');
        if (row.kind === 'union') li.classList.add('union');
        const b = document.createElement('b');
        // The glyph carries the tier without relying on the colour: filled for
        // a union, open for anything else ready, hollow for an aim.
        b.textContent = `${row.ready ? (row.kind === 'union' ? '◆' : '◈') : '◇'} ${row.label}`;
        const em = document.createElement('em');
        em.textContent = row.ready ? row.needs : `needs ${row.needs}`;
        li.append(b, em);
        pauseStats.combos.append(li);
      }
      if (plan.length > SHOWN) {
        const li = document.createElement('li');
        const em = document.createElement('em');
        em.textContent = `+${plan.length - SHOWN} further off`;
        li.append(em);
        pauseStats.combos.append(li);
      }
      pauseStats.combosNone.classList.toggle('hidden', plan.length > 0);
    }
    pauseScreen.classList.toggle('hidden', !paused);
    // Pause, not stop: stopping resets the scheduler's cycle counters and the
    // transport comes back four bars in the past.
    if (paused) pauseAudio();
    else startAudio();
  }
  /*
   * Enter also starts, so the whole game is playable from the keyboard — but
   * NOT for the first moment the run-over screen is up.
   *
   * `world.isOver` becomes true in the same tick that `run:over` fires and the
   * screen appears, so a player who was holding Space or Enter when they died
   * — which, in a bullet hell, is most of them — restarted instantly and never
   * saw the screen at all. That screen is where the run is read back: the band
   * they assembled and the arrangement they were one pick away from.
   */
  // A held Space auto-repeats ~30x/s, so the grace period alone would be
  // outlasted by a player who died mid-press. Ignore repeats outright.
  if (e.repeat && (e.code === 'Enter' || e.code === 'Space')) return;
  const settled = performance.now() - runOverAt > RUN_OVER_GRACE;
  if ((e.code === 'Enter' || e.code === 'Space') && (!inRun || world.isOver) && settled) {
    if (!titleScreen.classList.contains('hidden') || !gameoverScreen.classList.contains('hidden')) {
      void startRun();
    }
  }
});

/*
 * Recover a suspended context.
 *
 * A phone that backgrounds the tab, takes a call or hits the ringer switch
 * leaves the AudioContext suspended, and it will not come back by itself. Any
 * subsequent gesture is a chance to fix that, so every one of them tries.
 */
for (const evt of ['pointerdown', 'keydown', 'touchend'] as const) {
  window.addEventListener(evt, () => {
    if (inRun && audioSuspended()) resumeAudio();
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && inRun && audioSuspended()) resumeAudio();
  if (document.hidden && inRun && !paused) {
    paused = true;
    pauseScreen.classList.remove('hidden');
    pauseAudio();
  }
});

loop.start();

// Keep the fixed timestep honest if the display is unusual.
if (import.meta.env.DEV) {
  console.info(`[musicwars] fixed dt ${(FIXED_DT * 1000).toFixed(2)}ms`);
  // Handle for the smoke test; dev-only so it never ships.
  (window as unknown as Record<string, unknown>).__musicwars = {
    world,
    director,
    loop,
    startRun,
    readout: () => director.readout(world.transport),
    // What ?seed= actually resolved to, so a capture can record the seed that
    // produced the file rather than the one it hoped for.
    seed: () => (Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : null),
    probe: () => {
      // Lazily imported so the validator never reaches a production bundle.
      return import('./audio/probe').then((m) => m.findNonFinite(director.masterPattern(), 8));
    },
    renderer,
    hud,
    // Dev-only: lets the rondo check assert theme recurrence directly.
    themeForWave,
    // The app's own AudioContext. Tooling that imports @strudel/webaudio
    // directly gets a *second* module instance with its own singleton, so it
    // ends up poking a context the game has never heard of.
    audioCtx: () => getAudioContext(),
    audio: () => {
      const repl = getRepl();
      return {
        status: audioStatus(),
        started: !!repl?.scheduler.started,
        cycle: repl?.scheduler.now() ?? -1,
        cps: repl?.scheduler.cps ?? -1,
      };
    },
  };
}
