/**
 * The overlay HUD, and the settings panel behind the gear.
 *
 * WHAT THIS REPLACED, and why. It was a 460px DOM sidebar carrying a masthead,
 * a transport, five bordered blocks, an eleven-lane notation canvas and five
 * lines of generated Strudel. On a 1512x945 window that sidebar plus the dead
 * margin beside a portrait playfield left 48.7% of the screen for the game.
 *
 * THE RULE FOR WHAT IS IN THE HUD: a player has to ACT on it while dodging.
 * Health, what you are holding and at what level, how close the next level-up
 * is, whether a combination is waiting, and how the run is going. That is all.
 *
 * Everything else moved behind the gear — the mix readout, the enemy census,
 * the frame counter — where it is still available and no longer competing with
 * a bullet for attention. Two things were deleted outright:
 *
 *   THE NOTATION CANVAS. Eleven lanes of note onsets with a playhead, redrawn
 *   every frame. It was the most distinctive thing on the page and the owner is
 *   right that it did not earn its space. It was NOT, however, costing frames:
 *   A/B'd interleaved over ten rounds at wave 24 on this machine, stubbing
 *   `drawScore` moved the mean from 45.41 fps to 44.82 — i.e. the wrong way by
 *   0.59 fps, against a control spread of +/-5.61. Stubbing the WHOLE DOM HUD
 *   bought 1.03 fps. The reason to delete it is that a player never acted on
 *   it; the performance claim is not supported and should not be repeated.
 *
 *   THE GENERATED SOURCE. Five tokenised lines of the Strudel this bar was
 *   built from. It is the proof of the premise and it belongs in a capture or
 *   a README, not over a playfield — the same argument as the roll, minus the
 *   beauty.
 *
 * The premise itself has not been abandoned: the stem levels, the section, the
 * key and the groove are all still shown, behind the gear, and the room around
 * the cabinet still takes the groove's hue.
 */

import type { AbilityId, GameSnapshot } from '../core/events';
import { clamp01 } from '../core/math';
import type { DirectorReadout } from '../audio/director';
import { STEM_LABELS, type StemId } from '../audio/layers';
import { ARCHETYPE_INFO } from '../game/enemies';
import { powerupDef } from '../game/powerups';
import { BOSS_COUNT, BOSS_EVERY, TOTAL_WAVES } from '../game/waves';
import { characterOf, labelOf, maxLevelOf, slotOf } from '../game/weapons';
import { characterHue, readyFusions, pendingFusions } from './levelup';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
};

/** `4TH`, for the opener's one line about the run's shape. */
const ordinal = (n: number): string => {
  const r = n % 100;
  const s = r >= 11 && r <= 13 ? 'TH' : n % 10 === 1 ? 'ST' : n % 10 === 2 ? 'ND' : n % 10 === 3 ? 'RD' : 'TH';
  return `${n}${s}`;
};

/**
 * The shape of the run, in one line under the opener's rule: `16 WAVES · A
 * BOSS EVERY 4TH · THE 4TH IS THE LAST`.
 *
 * Derived from `waves.ts`, whose own note is "ONE CONSTANT, AND EVERYTHING
 * ELSE IS DERIVED"; the map that preceded this line found the last widget
 * that had forgotten it, reading `OF 3` under four pips.
 *
 * THREE CLAUSES, so the line can wrap only between them. It is 338 CSS px at
 * 10px and fits every desktop window on one line; the 363-px mobile stage
 * gives the rule 283 px of content and the line wrapped as `THE 4TH IS /
 * THE LAST`, photographed. Each clause is its own no-wrap span, so the phone
 * reads `16 WAVES · A BOSS EVERY 4TH ·` over `THE 4TH IS THE LAST`.
 */
export const RUN_SHAPE_PARTS: readonly string[] = [
  `${TOTAL_WAVES} WAVES`,
  `A BOSS EVERY ${ordinal(BOSS_EVERY)}`,
  `THE ${ordinal(BOSS_COUNT)} IS THE LAST`,
];
export const RUN_SHAPE_LINE = RUN_SHAPE_PARTS.join(' · ');

/**
 * The standing rule for a wave, in the HUD's own words.
 *
 * The banner that announces one of these is gone in about two seconds, but the
 * rule holds for the whole wave — so a player who blinked spent ninety seconds
 * wondering why nothing was shooting at them. Wording tracks `World.beginWave`.
 */
const MOVEMENT_UI: Record<'flank' | 'elite' | 'hush', [string, string]> = {
  flank: ['FLANKED', 'they come from the wings'],
  elite: ['SOLOIST', 'one, worth the whole section'],
  hush: ['HUSHED', 'no fire — but they press closer'],
};

/**
 * The lanes the opening watches for, and what each one is for.
 *
 * Four bars pass between START and the first enemy while the arrangement builds
 * itself. The BASS states the key now: the chords lane's sustained supersaw pad
 * was deleted (see `buildChords`), so the row that used to read CHORD reads
 * BASS, and `INTRO_ENTRY` brings it in first (measured onsets on this build,
 * `tools/opening.mjs`: bass bar 2, the stab and the motor bar 4, kick and lead
 * bar 6) — but nothing here is timed: a row lights when the director's level
 * for that stem crosses, so if the intro is re-voiced the display follows it
 * rather than lying about it. `sub`, `fx` and `power` are deliberately not
 * listed: they are up from the first frame, so a list including them would
 * start fully lit and tell the story backwards.
 */
const OPENING_LANES: readonly [StemId, string][] = [
  ['bass', 'the key you are fighting in'],
  ['lead', 'the line that follows you'],
  ['hats', 'the pulse underneath it'],
  ['kick', 'the floor the rest stands on'],
];

/** A stem counts as arrived here at the same level a fader would call it live. */
const ARRIVED = 0.05;

/**
 * A tile's three-or-fewer letters.
 *
 * The roster is 106 instruments with labels up to fourteen characters long
 * (STRING SECTION, HEARTSWALLOWER), and a 40px tile holds about four glyphs at
 * a readable size. Initials for a multi-word name and the first three letters
 * otherwise, which keeps STRING SECTION ("SS") apart from SNARE ("SNA") — the
 * pair a first-letter scheme would collide.
 *
 * This does not have to be globally unique and could not be: what it has to
 * separate is the FOUR things a player is holding, against four different
 * character hues, with the full name one hover away and on the pause screen.
 */
function monogram(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return (words[0] ?? label).slice(0, 3).toUpperCase();
}

/** `m:ss`, for the run clock. */
function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class Hud {
  private els = {
    score: $('ui-score'),
    combo: $('ui-combo'),
    wave: $('ui-wave'),
    timer: $('ui-timer'),
    hp: $('ui-hp'),
    lives: $('ui-lives'),
    stock: $('ui-stock'),
    movement: $('ui-movement'),
    powerups: $('ui-powerups'),
    ensemble: $('ui-ensemble'),
    level: $('ui-level'),
    xp: $('ui-xp'),
    xpnum: $('ui-xpnum'),
    players: $('ui-players'),
    rig: $('ui-rig'),
    fusion: $('ui-fusion'),
    section: $('ui-section'),
    bpm: $('ui-bpm'),
    key: $('ui-key'),
    feel: $('ui-feel'),
    tension: $('ui-tension'),
    driver: $('ui-driver'),
    reason: $('ui-reason'),
    fps: $('ui-fps'),
    bodies: $('ui-bodies'),
    audio: $('ui-audio'),
    resume: $('ui-resume'),
  };

  private hudEl = $('hud');
  private settingsEl = $('settings');
  private stage = $('stage');
  private opener = $('opening');
  private title = $('title-screen');
  private pause = $('pause-screen');
  /** Per-lane row, its fill, and whether it has arrived. Sticky once lit. */
  private openerRows: { id: StemId; li: HTMLElement; fill: HTMLElement; lit: boolean }[] = [];
  /**
   * `pre` before the first enemy, `done` for the rest of the run.
   *
   * Latched, not recomputed: the field is empty again the moment the first
   * enemy dies, and without the latch the opening would pop back over a live
   * playfield the first time the player cleared the screen.
   */
  private openerState: 'pre' | 'done' = 'pre';
  private lastTime = 0;

  /** Cache of last-written text, so we are not touching the DOM 60 times a second for nothing. */
  private last: Record<string, string> = {};

  constructor() {
    for (const [id, role] of OPENING_LANES) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = STEM_LABELS[id];
      const bar = document.createElement('i');
      const fill = document.createElement('s');
      bar.appendChild(fill);
      const em = document.createElement('em');
      em.textContent = role;
      li.append(b, bar, em);
      $('opening-list').appendChild(li);
      this.openerRows.push({ id, li, fill, lit: false });
    }
    // One no-wrap span per clause, separated by ` · ` text nodes the line can
    // break at; `textContent` of the whole is `RUN_SHAPE_LINE`.
    const shape = $('opening-shape');
    RUN_SHAPE_PARTS.forEach((part, i) => {
      if (i > 0) shape.appendChild(document.createTextNode(' · '));
      const span = document.createElement('span');
      span.textContent = part;
      shape.appendChild(span);
    });

    const toggle = () => this.setSettings(this.settingsEl.classList.contains('hidden'));
    $('ui-gear').addEventListener('click', toggle);
    $('ui-gear-close').addEventListener('click', () => this.setSettings(false));
  }

  /**
   * Open or close the settings panel.
   *
   * Public because `main.ts` closes it on ESC alongside the pause screen, and
   * because `settingsOpen` gates the per-frame work below — see `update`.
   */
  setSettings(open: boolean): void {
    this.settingsEl.classList.toggle('hidden', !open);
  }

  get settingsOpen(): boolean {
    return !this.settingsEl.classList.contains('hidden');
  }

  private set(key: string, el: HTMLElement, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  update(
    snap: GameSnapshot,
    readout: DirectorReadout,
    fps: number,
    audio: string,
    barPhase: number,
  ): void {
    /*
     * The HUD is hidden until the run starts, and again while the offer is up.
     *
     * "Started" is the signal the opening uses: the title screen going away
     * plus a clock that has actually started. `snap.running` is not it — the
     * phase does not leave 'idle' until `beginWave`, which is several bars
     * later.
     *
     * `choosing` is in here because the level-up screen is a modal drawn on the
     * OVERLAY CANVAS, under this at z-index 6 — so the XP line was printing
     * across the offer's own lever row (`1-4 CHOOSE  R REROLL  Q SKIP`) at
     * every window size where the two happened to land on the same pixels. It
     * is not merely a collision: the offer draws YOUR ENSEMBLE and a level
     * header of its own, so while it is open the HUD is showing the same facts
     * twice, in a smaller font, over the top.
     *
     * Pause and game-over are in for the same reason: all three are `.screen`
     * overlays at z-index 10 with a translucent backdrop, so the HUD showed
     * THROUGH them — a dimmed score in the corner of a page that is already
     * printing SCORE 771 in the middle. Each of those screens carries its own
     * readout and none of them is a moment to act on the HUD.
     *
     * Pause is read off the SCREEN'S OWN CLASS, not off `snap.paused`.
     * `writeSnapshot` hardcodes `s.paused = false` and is not called at all
     * while paused, because pausing stops the world stepping — so that field is
     * whatever the last live frame left behind, which is always false. Pausing
     * actually lives in a local in `main.ts`, and the visible consequence of it
     * is the element this reads. That is also the pattern `started` already
     * uses for the title screen one line up.
     *
     * The elements keep being WRITTEN while hidden — this is a class toggle and
     * nothing more — which is what lets `levelshot` read the band rows with the
     * offer open, exactly as it always has.
     */
    const started =
      this.title.classList.contains('hidden') &&
      snap.time > 0.05 &&
      !snap.choosing &&
      !snap.gameOver &&
      this.pause.classList.contains('hidden');
    if (this.last['shown'] !== String(started)) {
      this.last['shown'] = String(started);
      this.hudEl.classList.toggle('hidden', !started);
      if (!started) this.setSettings(false);
    }

    this.set('score', this.els.score, snap.score.toLocaleString('en-US'));
    /*
     * The multiplier says when it has bought something.
     *
     * Above a combo of eight the lead grows a descant — the one thing in this
     * game that gets better rather than merely more intense. It was audible and
     * completely invisible, so a player had no way to connect the reward to the
     * thing they did to earn it. The multiplier is where they are already
     * looking, and the word is a tag rather than a suffix so it reads as a
     * thing that was won.
     */
    const descant = snap.combo >= 8;
    const mult = `x${1 + snap.combo}`;
    if (this.last['combo'] !== `${mult}|${descant}`) {
      this.last['combo'] = `${mult}|${descant}`;
      this.els.combo.replaceChildren(document.createTextNode(mult));
      if (descant) {
        const tag = document.createElement('em');
        tag.textContent = 'descant';
        tag.title = 'the lead has grown a harmony voice — keep the chain alive';
        this.els.combo.appendChild(tag);
      }
      this.els.combo.classList.toggle('earned', descant);
    }
    this.set('wave', this.els.wave, String(snap.wave + 1));
    this.set('timer', this.els.timer, clock(snap.time));
    this.updatePips(snap);
    this.updateMovement(snap);
    this.updateOpening(snap, readout);

    /*
     * The audio state, ABOVE the settings gate, because one of its values is an
     * instruction rather than a diagnostic.
     *
     * A suspended AudioContext on a phone recovers only inside a user gesture,
     * so "tap to resume" is the difference between a silent game and a working
     * one. Putting it behind the gear meant the prompt existed and nobody could
     * see it; `tools/mobileaudio.mjs` fails on precisely that and is the reason
     * this block is here. Every other value is hidden.
     *
     * Two writes, both cached, so a run that never suspends pays one string
     * comparison per frame.
     */
    this.set('audio', this.els.audio, audio);
    const needsTap = audio === 'tap to resume';
    if (this.last['tap'] !== String(needsTap)) {
      this.last['tap'] = String(needsTap);
      this.els.resume.classList.toggle('hidden', !needsTap);
      this.els.resume.textContent = needsTap ? '♪ tap to resume the music' : '';
    }

    /*
     * The room takes the groove's colour.
     *
     * The page background is two static gradients on this hue, so the light
     * around the cabinet changes when the band changes feel — and because it is
     * only written when the hue actually moves (four times in a run, not sixty
     * times a second) it repaints about as often as the groove does.
     *
     * Outside the settings gate below: this is the one piece of the mix readout
     * that is visible whether or not the panel is open, because it is not a
     * readout at all, it is the room.
     */
    const hue = String(Math.round(readout.paletteHue));
    if (this.last['hue'] !== hue) {
      this.last['hue'] = hue;
      document.documentElement.style.setProperty('--hue', hue);
    }

    this.updateBand(snap);

    const kinds = Object.keys(snap.powerups) as (keyof GameSnapshot['powerups'])[];
    const key = kinds.map((k) => `${k}${snap.powerups[k]}`).join(',');
    /*
     * The empty slots are drawn too. Capacity has to be visible, because the
     * whole build is shaped by it: three of three looked identical to three of
     * four, so the player could not see whether the next card would cost them
     * something. The dashed slots already say nothing is held, which is why
     * there is no 'none' placeholder beside them.
     */
    const slots = snap.loadoutSlots ?? 3;
    if (this.last['pu'] !== `${key}|${slots}`) {
      this.last['pu'] = `${key}|${slots}`;
      this.els.powerups.replaceChildren();
      for (const k of kinds) {
        const def = powerupDef(k);
        const li = document.createElement('li');
        const lvl = snap.powerups[k] ?? 1;
        li.textContent = lvl > 1 ? `${def.label} ${lvl}` : def.label;
        li.title = `sounds like: ${def.sound}`;
        li.style.borderColor = `hsla(${def.hue}, 90%, 60%, .5)`;
        li.style.color = `hsl(${def.hue}, 90%, 72%)`;
        li.style.background = `hsla(${def.hue}, 90%, 60%, .12)`;
        this.els.powerups.appendChild(li);
      }
      /*
       * The empty ones, and this loop is not decoration.
       *
       * It was dropped in the first draft of this rewrite — the comment above
       * survived and the code did not — and `tools/progression.mjs` caught it
       * within the hour: "the loadout row shows 1 chips for 3 slots". That
       * check exists because the row once printed "none" AND four empty chips,
       * the same fact twice, and it is the reason the count is asserted at all.
       */
      for (let i = kinds.length; i < slots; i++) {
        const li = document.createElement('li');
        li.className = 'slot';
        li.textContent = '·';
        li.title = 'empty loadout slot';
        this.els.powerups.appendChild(li);
      }
    }

    /*
     * EVERYTHING BELOW IS BEHIND THE GEAR, AND IS NOT WRITTEN WHILE IT IS SHUT.
     *
     * Eleven text nodes, a width style and a list rebuild, sixty times a
     * second, for a panel nobody has open. The sidebar had no choice — it was
     * always visible — and this is the one real frame saving in the rewrite,
     * measured or not: work not done is cheaper than work done fast.
     *
     * The cost of the gate is that a tool reading these elements must open the
     * panel first. `tools/verify-package.mjs` and `tools/drivercheck.mjs` do
     * exactly that, through `window.__musicwars.hud.setSettings(true)`.
     */
    if (!this.settingsOpen) return;
    this.set('section', this.els.section, readout.section);
    this.set('bpm', this.els.bpm, `${readout.bpm} BPM`);
    this.set('key', this.els.key, readout.key);
    this.set('feel', this.els.feel, readout.feel);
    this.set('driver', this.els.driver, readout.driver.toUpperCase());
    this.set('reason', this.els.reason, readout.harmonyReason);
    this.set('fps', this.els.fps, fps.toFixed(0));
    // The diagnostic row counted enemy bullets; there are none. It reads the
    // crowd instead, which is the number that matters to frame cost now.
    this.set('bodies', this.els.bodies, String(snap.pressureCount));
    this.els.tension.style.width = `${(clamp01(readout.energy) * 100).toFixed(1)}%`;
    // The beat, as a breath on the LIVE dot's own section chip. It is the only
    // thing left that says "this is running on a real clock".
    this.els.section.style.opacity = (0.62 + 0.38 * (1 - (barPhase * 4) % 1)).toFixed(2);
    this.updateEnsemble(snap);
  }

  /**
   * The band assembling, for the four bars before the first enemy.
   *
   * Shown only while the field is provably empty — no enemies, wave one, inside
   * the first fifteen seconds — and latched off permanently the
   * moment any of that stops being true. That is what makes it safe to draw
   * over the playfield at all: there is nothing underneath it to hide.
   */
  private updateOpening(snap: GameSnapshot, readout: DirectorReadout): void {
    // A new run rewinds the clock; that is the only signal here that one began.
    if (snap.time < this.lastTime) {
      this.openerState = 'pre';
      for (const row of this.openerRows) {
        row.lit = false;
        row.li.classList.remove('lit');
        row.fill.style.width = '0%';
      }
    }
    this.lastTime = snap.time;

    const clear = snap.enemyCount === 0;
    if (this.openerState === 'pre' && (!clear || snap.time > 15 || snap.wave > 0)) {
      this.openerState = 'done';
    }
    /*
     * Not `snap.running`.
     *
     * `running` is `phase !== 'over' && phase !== 'idle'`, and the phase does
     * not leave 'idle' until `beginWave` — which is the far end of the very
     * runway this is here to fill. Gating on it meant the opening was hidden
     * for exactly the window it exists for. The honest signal that the player
     * has pressed START is the title screen going away, plus a clock that has
     * actually started; both are cheap and neither can drift.
     */
    const started = this.title.classList.contains('hidden') && snap.time > 0.2;
    const show = this.openerState === 'pre' && started && !snap.gameOver && !snap.paused;
    if (this.last['opener'] !== String(show)) {
      this.last['opener'] = String(show);
      this.opener.classList.toggle('hidden', !show);
    }
    if (!show) return;

    for (const row of this.openerRows) {
      const level = clamp01(readout.levels[row.id]);
      // The fill is the stem's real level, so the row is a fader rather than a
      // tick — the player watches it come up, not merely switch on.
      row.fill.style.width = `${Math.round(level * 100)}%`;
      // Sticky: levels breathe, and a row that lit and unlit on the same bar
      // would read as a fault rather than as a musician sitting out a phrase.
      if (!row.lit && level > ARRIVED) {
        row.lit = true;
        row.li.classList.add('lit');
      }
    }
  }

  /** The rule this wave is being fought under, for as long as it applies. */
  private updateMovement(snap: GameSnapshot): void {
    const m = snap.movement;
    const key = m ?? '-';
    if (this.last['mv'] === key) return;
    this.last['mv'] = key;
    this.els.movement.classList.toggle('hidden', !m);
    /*
     * The stage takes the rule's colour for as long as the rule holds.
     *
     * The centre-screen banner announcing a movement is `announce(label, sub,
     * 'wave')` drawn by `renderer.drawBanner` — the same treatment, in the same
     * blue, as WAVE 3 — and both of those files are outside this workstream.
     * The light around the cabinet is not, and it says it for the whole wave
     * instead of for 2.4 seconds. See the styles for what each rule does.
     */
    if (m) this.stage.dataset.movement = m;
    else delete this.stage.dataset.movement;
    if (!m) return;
    this.els.movement.dataset.rule = m;
    const [label, why] = MOVEMENT_UI[m];
    const b = document.createElement('b');
    b.textContent = label;
    const s = document.createElement('span');
    s.textContent = why;
    this.els.movement.replaceChildren(b, s);
  }

  /**
   * Health as three rows of pips: shield points inside the current life, spare
   * lives, and the two panic buttons. The user could not tell how hurt they
   * were from a single row of diamonds, and in a game this busy the readout has
   * to be parseable in peripheral vision — so quantity, position and colour all
   * encode it.
   *
   * Unlabelled over the playfield, where the sidebar spent 48px on the words
   * SHIELD, LIVES and BOMB / WELL. Shape and colour already carry it: green
   * squares are shield, cyan circles are lives, gold squares and violet circles
   * are the two panic buttons, and that encoding is what the pips were designed
   * around in the first place.
   */
  private updatePips(snap: GameSnapshot): void {
    const key = `${snap.playerHp}/${snap.playerMaxHp}|${snap.lives}/${snap.maxLives}|${snap.bombs}|${snap.wells}`;
    if (this.last['pips'] === key) return;
    this.last['pips'] = key;

    const severity = snap.playerHp <= 1 ? 'crit' : snap.playerHp <= 2 ? 'warn' : '';
    this.els.hp.replaceChildren();
    for (let i = 0; i < snap.playerMaxHp; i++) {
      const pip = document.createElement('i');
      if (i < snap.playerHp) pip.className = `on ${severity}`.trim();
      this.els.hp.appendChild(pip);
    }

    this.els.lives.replaceChildren();
    /*
     * Sized to the EXTEND ceiling, not to `maxLives`.
     *
     * Score extends push lives to `maxLives + 2` (see the extend block in
     * world.ts), so a row of `maxLives` pips could never show the fourth or
     * fifth — a player earned an extra life and the panel did not move. A
     * reward with no feedback reads as a bug in the reward.
     */
    for (let i = 0; i < snap.maxLives + 2; i++) {
      const pip = document.createElement('i');
      pip.className = i < snap.lives - 1 ? 'life on' : 'life';
      this.els.lives.appendChild(pip);
    }

    // Consumables: bombs then black holes, so both panic buttons read at once.
    this.els.stock.replaceChildren();
    // Five, the cap `world.ts` actually enforces on a bomb pickup. At three,
    // the fourth and fifth were collected and invisible — same defect as the
    // lives row above.
    for (let i = 0; i < 5; i++) {
      const pip = document.createElement('i');
      pip.className = i < snap.bombs ? 'bomb on' : 'bomb';
      this.els.stock.appendChild(pip);
    }
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('i');
      pip.className = i < snap.wells ? 'well on' : 'well';
      this.els.stock.appendChild(pip);
    }
  }

  /**
   * The band: level, XP, and the two slot rows.
   *
   * This is the permanent loadout, and it is the thing a run is actually
   * *about* — `audio/layers.ts` reads these very ids, so the two rows are the
   * mix in the most literal sense available. The powerup row keeps showing the
   * temporary field-dropped surges, which are a different verb.
   *
   * Split into two cache keys on purpose. XP moves several times a second and
   * is one style write; the tiles move a few times a minute and are a full
   * rebuild of two lists. Keying them together would rebuild both lists at the
   * XP rate, on a HUD that already has to stay off the layout path.
   */
  private updateBand(snap: GameSnapshot): void {
    const pct = Math.round(clamp01(snap.xpToNext > 0 ? snap.xp / snap.xpToNext : 0) * 1000) / 10;
    if (this.last['xp'] !== String(pct)) {
      this.last['xp'] = String(pct);
      this.els.xp.style.width = `${pct}%`;
    }
    this.set('level', this.els.level, `LV ${snap.level}`);
    /*
     * Banked level-ups, and the key that spends them.
     *
     * The offer no longer interrupts, so this line is the ONLY thing that tells
     * a player they have rewards waiting. Without it, banking is a trap: a
     * player who does not know about the key never levels, never gets stronger,
     * and dies wondering why. It rides the XP line because that is where
     * somebody already looks to ask "am I close", and it replaces the raw
     * numbers while any are waiting so it cannot be missed.
     */
    if (snap.pendingOffers > 0) {
      const n = snap.pendingOffers;
      this.set('xpnum', this.els.xpnum, `${n} LEVEL UP${n > 1 ? 'S' : ''} — SPACE`);
      this.els.xpnum.classList.add('xp-ready');
    } else {
      this.set('xpnum', this.els.xpnum, `${Math.floor(snap.xp)} / ${Math.round(snap.xpToNext)}`);
      this.els.xpnum.classList.remove('xp-ready');
    }

    const held = Object.entries(snap.abilities) as [AbilityId, number][];
    const key = `${held.map(([id, lv]) => `${id}${lv}`).join(',')}|${snap.instrumentSlots}|${snap.rigSlots}`;
    if (this.last['band'] === key) return;
    this.last['band'] = key;

    const players = held.filter(([id]) => slotOf(id) === 'instrument');
    const rig = held.filter(([id]) => slotOf(id) === 'rig');
    this.tiles(this.els.players, players, snap.instrumentSlots, 'instrument');
    this.tiles(this.els.rig, rig, snap.rigSlots, 'rig');

    /*
     * A combination the player can take on their NEXT LEVEL-UP.
     *
     * `docs/progression.md`: "A reward a player cannot see coming is a reward
     * they cannot play toward." That is why it survived the cull: the offer
     * screen is open for a few seconds a minute, and knowing a combination is
     * waiting changes what you do with the minute in between.
     *
     * RANK BY TIER, because the HUD shows one and buries the rest. A union is
     * the top of the tree — two evolved instruments, each of which cost a maxed
     * base and a maxed catalyst — and a committed run lands one in about half
     * its attempts. A duet is routine by comparison. `lattice` sits with
     * `evolution` and above `duet`: both are AUTHORED, one of eighty-six named
     * results for a pair, and the generic duet is the fallback for the pairs
     * nobody wrote down. Ranking a written result behind a combinatorial one is
     * the mistake `combinationPlan` records at length.
     */
    const RANK = { union: 0, evolution: 1, lattice: 1, duet: 2 } as const;
    const ready = readyFusions(snap.abilities).slice()
      .sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    const pending = ready.length ? [] : pendingFusions(snap.abilities);
    this.els.fusion.classList.toggle('hidden', ready.length === 0 && pending.length === 0);
    this.els.fusion.classList.toggle('union', ready.length > 0 && ready[0].kind === 'union');
    if (ready.length) {
      const b = document.createElement('b');
      b.textContent = labelOf(ready[0].to);
      const em = document.createElement('em');
      em.textContent = ready.length > 1 ? `${ready[0].line}  (+${ready.length - 1} more)` : ready[0].line;
      // A filled diamond for the top of the tree against the open one used
      // everywhere else, so the tier reads without relying on the colour shift.
      const lead = ready[0].kind === 'union' ? '◆ UNION READY ' : '◈ READY TO COMBINE ';
      this.els.fusion.replaceChildren(document.createTextNode(lead), b, em);
    } else if (pending.length) {
      /*
       * ONE STEP AWAY — what to build toward, shown only when nothing is
       * already waiting. A ready combination is news and must not be buried
       * under a plan, so these are mutually exclusive rather than stacked.
       *
       * This is the half that changes play. "READY" tells you to spend your
       * next pick; this tells you which of four instruments to feed for the
       * next two minutes, which is the actual decision a slot-limited build is
       * made of.
       */
      const p = pending[0];
      const b = document.createElement('b');
      b.textContent = labelOf(p.to);
      const em = document.createElement('em');
      em.textContent = `needs ${p.needs}`;
      this.els.fusion.replaceChildren(document.createTextNode('◇ ONE STEP AWAY '), b, em);
    }
  }

  /**
   * One slot row: a tile per held ability, then a dashed tile per empty slot.
   *
   * These were name chips and could not stay. Four instruments and four rig
   * items is eight labels of up to fourteen characters over the playfield;
   * `builds` and the fusion tables put 106 instruments and 86 recipes behind
   * those eight positions, so any design that scales with the NAME does not
   * scale at all. A tile is fixed-size by construction.
   */
  private tiles(host: HTMLElement, held: [AbilityId, number][], slots: number, kind: string): void {
    host.replaceChildren();
    for (const [id, level] of held) {
      const max = maxLevelOf(id);
      const hue = characterHue(characterOf(id));
      const label = labelOf(id);
      const li = document.createElement('li');
      // A maxed instrument is half of a fusion, so it reads as gold rather than
      // as its own colour — the same rule the offer screen follows.
      const maxed = level >= max;
      const mono = document.createElement('b');
      mono.textContent = monogram(label);
      li.appendChild(mono);
      if (max > 1) {
        const lv = document.createElement('i');
        lv.textContent = String(level);
        li.appendChild(lv);
      }
      li.title = `${label} — ${characterOf(id)}${max > 1 ? `, level ${level} of ${max}` : ''}`;
      li.style.borderColor = maxed ? 'rgba(255,209,102,.75)' : `hsla(${hue}, 88%, 62%, .5)`;
      li.style.color = maxed ? 'hsl(45, 95%, 78%)' : `hsl(${hue}, 90%, 76%)`;
      li.style.background = `hsla(${maxed ? 45 : hue}, 85%, 45%, .22)`;
      host.appendChild(li);
    }
    for (let i = held.length; i < slots; i++) {
      const li = document.createElement('li');
      li.className = 'slot';
      const dot = document.createElement('b');
      dot.textContent = '·';
      li.appendChild(dot);
      /*
       * It said "beat a boss to widen the band". Slot growth was REMOVED —
       * `grantBossReward`'s own comment reads "the band does not get bigger
       * when you beat a boss, it gets better" — so the panel was telling the
       * player to do a thing that would never pay. A stale promise in a
       * tooltip is worse than no tooltip: they can act on it.
       */
      li.title = `empty ${kind} slot — a new ${kind} fills it, and a fusion frees one again`;
      host.appendChild(li);
    }
  }

  /**
   * Who is on stage, behind the gear.
   *
   * The same list as "which motifs are in the mix", which is why it survives at
   * all: the readout is a mixer channel strip that happens to be populated by
   * whatever is currently trying to kill you. It is not in the HUD because a
   * player who wants to know what is on the field can look at the field.
   */
  private updateEnsemble(snap: GameSnapshot): void {
    const live = (Object.keys(snap.enemies) as (keyof GameSnapshot['enemies'])[])
      .filter((k) => snap.enemies[k] > 0)
      .sort((a, b) => snap.enemies[b] - snap.enemies[a]);
    const key = live.map((k) => `${k}${snap.enemies[k]}`).join(',');
    if (this.last['ens'] === key) return;
    this.last['ens'] = key;

    this.els.ensemble.replaceChildren();
    if (!live.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'empty stage';
      this.els.ensemble.appendChild(li);
      return;
    }
    for (const k of live) {
      const info = ARCHETYPE_INFO[k];
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = info.label;
      const count = document.createElement('i');
      count.textContent = `x${snap.enemies[k]}`;
      li.title = `plays: ${info.motif}`;
      li.style.borderLeftColor = k === 'conductor' ? 'var(--hot)' : 'var(--cool)';
      li.appendChild(name);
      li.appendChild(count);
      this.els.ensemble.appendChild(li);
    }
  }
}
