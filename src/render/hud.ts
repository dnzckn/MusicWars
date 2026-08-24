/**
 * DOM side panel.
 *
 * The mix readout is not debug UI. The whole premise is that the soundtrack is
 * a function of the game state, and that claim is unfalsifiable to a player who
 * cannot see which layers are live. Showing the stems, the section and the key
 * turns "the music got more intense" into something you can watch happen.
 */

import type { AbilityId, GameSnapshot } from '../core/events';
import { clamp01 } from '../core/math';
import type { DirectorReadout } from '../audio/director';
import { STEM_IDS, STEM_LABELS, type StemId } from '../audio/layers';
import { ARCHETYPE_INFO } from '../game/enemies';
import { powerupDef } from '../game/powerups';
import { characterOf, labelOf, maxLevelOf, slotOf } from '../game/weapons';
import { characterHue, readyFusions, pendingFusions} from './levelup';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
};

/**
 * The standing rule for a wave, in the panel's own words.
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
 * itself. Measured entry on this build is chords immediately, lead by bar 3,
 * hats by bar 4 and kick by bar 5 — but nothing here is timed: a row lights
 * when the director's level for that stem crosses, so if the intro is re-voiced
 * the display follows it rather than lying about it. `sub`, `fx` and `power`
 * are deliberately not listed: they are up from the first frame, so a list
 * including them would start fully lit and tell the story backwards.
 */
const OPENING_LANES: readonly [StemId, string][] = [
  ['chords', 'the key you are fighting in'],
  ['lead', 'the line that follows you'],
  ['hats', 'the pulse underneath it'],
  ['kick', 'the floor the rest stands on'],
];

/** A stem counts as arrived here at the same level the roll calls a lane live. */
const ARRIVED = 0.05;

/**
 * Crude tokeniser for the generated source.
 *
 * The panel prints real Strudel, and undifferentiated grey made five lines of
 * it read as a stack trace. Strings and numbers are the parts that visibly
 * change from bar to bar, so they are the parts that get colour.
 */
const TOKEN = /("[^"]*")|(\d+(?:\.\d+)?)|([A-Za-z_][\w.]*)|(\s+)|([^\s])/g;

function tokenClass(m: RegExpExecArray): string {
  if (m[1] !== undefined) return 's';
  if (m[2] !== undefined) return 'n';
  if (m[3] !== undefined) return 'f';
  if (m[4] !== undefined) return '';
  return 'p';
}

export class Hud {
  private els = {
    score: $('ui-score'),
    combo: $('ui-combo'),
    wave: $('ui-wave'),
    hp: $('ui-hp'),
    lives: $('ui-lives'),
    stock: $('ui-stock'),
    movement: $('ui-movement'),
    powerups: $('ui-powerups'),
    ensemble: $('ui-ensemble'),
    level: $('ui-level'),
    xp: $('ui-xp'),
    xpnum: $('ui-xpnum'),
    slots: $('ui-slots'),
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
    notation: $('ui-notation') as HTMLCanvasElement,
    code: $('ui-code'),
    fps: $('ui-fps'),
    bullets: $('ui-bullets'),
    audio: $('ui-audio'),
  };

  private beats = [...$('ui-beats').children] as HTMLElement[];
  private stage = $('stage');
  private opener = $('opening');
  private title = $('title-screen');
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

  private sg: CanvasRenderingContext2D;
  /** Notes for the current bar, re-sampled once per bar rather than per frame. */
  private bar: Record<StemId, { t: number; n: number | null }[]> | null = null;
  private lastBar = -1;
  /** Cache of last-written text, so we are not touching the DOM 60 times a second for nothing. */
  private last: Record<string, string> = {};

  /**
   * The roll's size in CSS pixels, and whether the backing store still matches.
   *
   * The canvas was a fixed 520x300 bitmap displayed in a 347x200 box, so every
   * lane label was resampled down by a third — the most distinctive thing on
   * the page was also the blurriest. A ResizeObserver keeps the backing store
   * equal to the rendered box times the device pixel ratio, and costs nothing
   * per frame: measuring the element in `update()` would force a layout on a
   * HUD that also writes styles, which is the classic read-after-write stall.
   */
  private cw = 0;
  private ch = 0;
  private resized = true;

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

    this.sg = this.els.notation.getContext('2d')!;
    const ro = new ResizeObserver(() => {
      this.resized = true;
    });
    ro.observe(this.els.notation);
    addEventListener('resize', () => {
      this.resized = true;
    });
  }

  private set(key: string, el: HTMLElement, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  /** Match the backing store to the box, and report the size to draw into. */
  private fitCanvas(): void {
    if (!this.resized) return;
    this.resized = false;
    const el = this.els.notation;
    const dpr = Math.min(3, Math.max(1, devicePixelRatio || 1));
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.cw = w;
    this.ch = h;
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (el.width !== bw || el.height !== bh) {
      el.width = bw;
      el.height = bh;
    }
    this.sg.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Draw the bar as a score: one lane per stem, a mark at every note onset,
   * pitch shown by vertical position where the stem has one, and a playhead
   * sweeping in time with the transport.
   *
   * The lane's name sits on a fader — the gutter fills in proportion to that
   * stem's level — so the roll answers "what is playing" and "how loud is it"
   * in the same glance, which is what a channel strip is for.
   */
  private drawScore(readout: DirectorReadout, barPhase: number): void {
    this.fitCanvas();
    const g = this.sg;
    const W = this.cw;
    const H = this.ch;
    const rows = STEM_IDS.length;
    const laneH = H / rows;
    const labelW = Math.round(Math.min(58, Math.max(44, W * 0.16)));
    const x0 = labelW + 4;
    const span = W - x0 - 5;

    g.clearRect(0, 0, W, H);

    // Alternating lane bands. Eleven unmarked rows of dots is a table with no
    // ruling; the banding is what lets the eye stay on one instrument.
    g.fillStyle = 'rgba(255,255,255,0.018)';
    for (let r = 0; r < rows; r += 2) g.fillRect(x0 - 2, r * laneH, W - x0 - 1, laneH);

    // Beat gridlines, so the eye can find the downbeat.
    for (let b = 0; b <= 4; b++) {
      const x = x0 + (span * b) / 4;
      g.strokeStyle = b === 0 || b === 4 ? 'rgba(140,165,220,0.22)' : 'rgba(120,140,190,0.11)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, H);
      g.stroke();
    }

    /*
     * The label has to fit its lane, not a nominal lane.
     *
     * A floor of 8px looked fine at the panel's 460px width and collided with
     * itself at 268px: eleven lanes into the roll's 90px minimum is 8.2px each,
     * so an 8px label overlapped the rows above and below and the gutter turned
     * into a smear. Tie it to the lane the way the notes are tied to it.
     */
    const labelPx = Math.max(6, Math.min(10, laneH * 0.62));
    g.textBaseline = 'middle';

    for (let r = 0; r < rows; r++) {
      const id = STEM_IDS[r];
      const level = clamp01(readout.levels[id]);
      const y = r * laneH + laneH / 2;
      const live = level > 0.05;

      // The fader behind the name. Faded out at its right edge, or eleven
      // hard-edged blocks of differing widths read as a column of chips rather
      // than as levels.
      if (live) {
        const fw = labelW * (0.22 + level * 0.78);
        const grad = g.createLinearGradient(0, 0, fw, 0);
        grad.addColorStop(0, `hsla(190, 90%, 62%, ${0.06 + level * 0.2})`);
        grad.addColorStop(1, 'hsla(190, 90%, 62%, 0)');
        g.fillStyle = grad;
        g.fillRect(0, r * laneH + 1, fw, laneH - 2);
      }

      g.font = `${live ? 700 : 400} ${labelPx}px ui-monospace, monospace`;
      g.fillStyle = live ? `rgba(210,224,248,${0.5 + level * 0.5})` : 'rgba(92,102,136,0.42)';
      g.fillText(STEM_LABELS[id], 5, y + 0.5);

      g.strokeStyle = live ? 'rgba(53,230,255,0.11)' : 'rgba(92,102,136,0.06)';
      g.beginPath();
      g.moveTo(x0, Math.round(y) + 0.5);
      g.lineTo(W - 5, Math.round(y) + 0.5);
      g.stroke();

      const notes = this.bar?.[id] ?? [];
      if (!notes.length) continue;

      // Pitched stems get vertical placement within the lane; percussion sits
      // on the centre line.
      const pitches = notes.filter((n) => n.n !== null).map((n) => n.n as number);
      const lo = pitches.length ? Math.min(...pitches) : 0;
      const hi = pitches.length ? Math.max(...pitches) : 1;
      const range = Math.max(1, hi - lo);

      for (const note of notes) {
        const x = x0 + span * note.t;
        const dy = note.n === null ? 0 : (0.5 - (note.n - lo) / range) * (laneH * 0.58);
        // Notes near the playhead flare, so you see them being played.
        const near = Math.max(0, 1 - Math.abs(note.t - barPhase) * 9);
        const alpha = (0.3 + level * 0.6) * (0.55 + near * 0.45);
        const cy = y + dy;
        if (note.n === null) {
          // Percussion: a struck bar, which is what it is.
          const hh = Math.max(3, laneH * 0.3) * (0.8 + near * 0.5);
          g.fillStyle = `rgba(255,209,102,${alpha})`;
          g.fillRect(x - 1, cy - hh / 2, 2.2 + near, hh);
        } else {
          const w = 5 + near * 3 + level * 2;
          const h = 3 + near * 1.4;
          g.fillStyle = `hsla(${190 + (note.n % 12) * 9}, 95%, ${60 + near * 25}%, ${alpha})`;
          this.capsule(g, x - 1, cy - h / 2, w, h);
        }
      }
    }

    // The playhead, with the bar it has already played dimmed behind it.
    const px = x0 + span * barPhase;
    const trail = g.createLinearGradient(px - 26, 0, px, 0);
    trail.addColorStop(0, 'rgba(255,255,255,0)');
    trail.addColorStop(1, 'rgba(255,255,255,0.09)');
    g.fillStyle = trail;
    g.fillRect(px - 26, 0, 26, H);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(Math.round(px), 0, 1.5, H);
  }

  private capsule(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    g.beginPath();
    // roundRect is everywhere this game runs, but a missing one must not take
    // the frame down with it.
    if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, h / 2);
    else g.rect(x, y, w, h);
    g.fill();
  }

  update(
    snap: GameSnapshot,
    readout: DirectorReadout,
    fps: number,
    audio: string,
    bar: Record<StemId, { t: number; n: number | null }[]> | null,
    barIndex: number,
    barPhase: number,
    code: { label: string; code: string }[],
  ): void {
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
    this.updatePips(snap);
    this.updateMovement(snap);
    this.updateOpening(snap, readout);
    this.set('section', this.els.section, readout.section);
    this.set('bpm', this.els.bpm, String(readout.bpm));
    this.set('key', this.els.key, readout.key);
    this.set('feel', this.els.feel, readout.feel);
    this.set('driver', this.els.driver, readout.driver.toUpperCase());
    this.set('reason', this.els.reason, readout.harmonyReason);
    this.set('fps', this.els.fps, fps.toFixed(0));
    this.set('bullets', this.els.bullets, String(snap.bulletCount));
    this.set('audio', this.els.audio, audio);

    this.els.tension.style.width = `${(clamp01(readout.energy) * 100).toFixed(1)}%`;

    /*
     * The room takes the groove's colour.
     *
     * A fixed 3:4 playfield leaves ~280px of letterboxing on a wide window,
     * which read as an unfinished page. The page background is two static
     * gradients on this hue, so the light around the cabinet changes when the
     * band changes feel — and because it is only written when the hue actually
     * moves (four times in a run, not sixty times a second) it repaints about
     * as often as the groove does.
     */
    const hue = String(Math.round(readout.paletteHue));
    if (this.last['hue'] !== hue) {
      this.last['hue'] = hue;
      document.documentElement.style.setProperty('--hue', hue);
    }

    // Four lamps on the real transport. Derived from the bar phase rather than
    // from a frame counter, so they land with the kick and not near it.
    const beat = Math.min(3, Math.max(0, Math.floor(barPhase * 4)));
    if (this.last['beat'] !== String(beat)) {
      this.last['beat'] = String(beat);
      for (let i = 0; i < this.beats.length; i++) this.beats[i].classList.toggle('on', i === beat);
    }

    if (bar && barIndex !== this.lastBar) {
      this.lastBar = barIndex;
      this.bar = bar;
      this.paintCode(code);
    }
    this.drawScore(readout, barPhase);

    this.updateEnsemble(snap);
    this.updateBand(snap);

    const kinds = Object.keys(snap.powerups) as (keyof GameSnapshot['powerups'])[];
    const key = kinds.map((k) => `${k}${snap.powerups[k]}`).join(',');
    /*
     * The empty slots are drawn too.
     *
     * Capacity has to be visible, because the whole build is shaped by it.
     *
     * The panel showed only what was HELD, so three of three looked identical
     * to three of four and the player could not see whether the next card
     * would cost them something. Drawing the empty ones makes the ceiling
     * legible at a glance.
     *
     * This block used to justify itself by boss slot growth — "going from
     * three slots to four" — and that mechanic is gone; slots are fixed at
     * four and three. The reason survives the mechanic: with a FIXED four and three,
     * knowing how full you are is what makes a swap or a fusion legible, and a
     * fusion spending its catalyst is now the only thing that hands a slot
     * back.
     */
    const slots = snap.loadoutSlots ?? 3;
    if (this.last['pu'] !== `${key}|${slots}`) {
      this.last['pu'] = `${key}|${slots}`;
      this.els.powerups.replaceChildren();
      /*
       * No 'none' placeholder once the slots are drawn.
       *
       * The empty-loadout text predates the slot chips, and with both present
       * the panel read "none" followed by four empty slots — the same fact
       * twice, and it made the slot count harder to read rather than easier.
       * The dashed slots already say nothing is held.
       */
      if (kinds.length) {
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
      }
      for (let i = kinds.length; i < slots; i++) {
        const li = document.createElement('li');
        li.className = 'slot';
        li.textContent = '·';
        li.title = 'empty loadout slot';
        this.els.powerups.appendChild(li);
      }
    }
  }

  /**
   * The generated source, rebuilt only when the patterns change.
   *
   * Five lines of identical grey was the least readable text on the page while
   * being the only proof that nothing here is pre-recorded; strings and numbers
   * are the parts that visibly move from bar to bar, so they carry the colour.
   */
  private paintCode(code: { label: string; code: string }[]): void {
    this.els.code.replaceChildren();
    for (const line of code) {
      const b = document.createElement('b');
      b.textContent = line.label.padEnd(6);
      const i = document.createElement('i');
      TOKEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TOKEN.exec(line.code)) !== null) {
        const cls = tokenClass(m);
        if (!cls) {
          i.append(document.createTextNode(m[0]));
          continue;
        }
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = m[0];
        i.append(span);
      }
      this.els.code.append(b, i, document.createTextNode('\n'));
    }
  }

  /**
   * The band assembling, for the four bars before the first enemy.
   *
   * Shown only while the field is provably empty — no enemies, no bullets, wave
   * one, inside the first fifteen seconds — and latched off permanently the
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

    const clear = snap.enemyCount === 0 && snap.bulletCount === 0;
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
   * Health as two rows of pips: shield points inside the current life, and
   * spare lives. The user could not tell how hurt they were from a single row
   * of diamonds, and in a game this busy the readout has to be parseable in
   * peripheral vision — so quantity, position and colour all encode it.
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
   * This is the permanent loadout, and after the arena conversion it is the
   * thing a run is actually *about* — `audio/layers.ts` reads these very ids,
   * so the two rows below are the mix in the most literal sense available. The
   * powerup row underneath keeps showing the temporary field-dropped surges,
   * which are a different verb and belong in a different box.
   *
   * Split into two cache keys on purpose. XP moves several times a second and
   * is one style write; the chips move a few times a minute and are a full
   * rebuild of two lists. Keying them together would rebuild both lists at the
   * XP rate, on a HUD that already has to stay off the layout path.
   */
  private updateBand(snap: GameSnapshot): void {
    const pct = Math.round(clamp01(snap.xpToNext > 0 ? snap.xp / snap.xpToNext : 0) * 1000) / 10;
    if (this.last['xp'] !== String(pct)) {
      this.last['xp'] = String(pct);
      this.els.xp.style.width = `${pct}%`;
    }
    this.set('level', this.els.level, String(snap.level));
    this.set('xpnum', this.els.xpnum, `${Math.floor(snap.xp)} / ${Math.round(snap.xpToNext)}`);

    const held = Object.entries(snap.abilities) as [AbilityId, number][];
    const key = `${held.map(([id, lv]) => `${id}${lv}`).join(',')}|${snap.instrumentSlots}|${snap.rigSlots}`;
    if (this.last['band'] === key) return;
    this.last['band'] = key;

    const players = held.filter(([id]) => slotOf(id) === 'instrument');
    const rig = held.filter(([id]) => slotOf(id) === 'rig');
    this.chips(this.els.players, players, snap.instrumentSlots, 'instrument');
    this.chips(this.els.rig, rig, snap.rigSlots, 'rig');
    this.set('slots', this.els.slots, `${snap.instrumentSlots} players · ${snap.rigSlots} rig`);

    /*
     * A combination the player can take on their NEXT LEVEL-UP.
     *
     * This said "ON THE NEXT BOSS" for as long as beating a boss resolved every
     * ready fusion in a batch. It does not any more — a fusion is a card you
     * choose, and choosing it costs the pick — so the banner was telling the
     * player to wait for something that would never happen. A HUD that gives a
     * false instruction is worse than a blank one.
     *
     * `docs/progression.md`: "A reward a player cannot see coming is a reward
     * they cannot play toward." That is why it is here at all: the offer screen
     * is open for a few seconds a minute, and knowing a combination is waiting
     * changes what you do with the minute in between. It now also covers DUETs,
     * so a generative pair announces itself the same way an authored one does.
     */
    /*
     * RANK BY TIER, because the panel shows one and buries the rest.
     *
     * A union is the top of the tree — two evolved instruments, each of which
     * cost a maxed base and a maxed catalyst — and a committed run lands one
     * in about half its attempts. A duet is routine by comparison. Sorted only
     * by discovery order, the rarest thing a player will see all run could
     * appear as "(+1 more)" behind a duet they could make at any time.
     *
     * This was harmless while unions never fired. They do now, so the order is
     * no longer an implementation detail.
     */
    const RANK = { union: 0, evolution: 1, duet: 2 } as const;
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
       * already waiting.
       *
       * A ready combination is news and must not be buried under a plan, so
       * these are mutually exclusive rather than stacked; the panel is one
       * line and two golden banners fighting for it would read as neither.
       *
       * This is the half that changes play. "READY" tells you to spend your
       * next pick; this tells you which of four instruments to feed for the
       * next two minutes, which is the actual decision a slot-limited build
       * is made of.
       */
      const p = pending[0];
      const b = document.createElement('b');
      b.textContent = labelOf(p.to);
      const em = document.createElement('em');
      em.textContent = `needs ${p.needs}`;
      this.els.fusion.replaceChildren(document.createTextNode('◇ ONE STEP AWAY '), b, em);
    }
  }

  /** One slot row: a chip per held ability, then a dashed chip per empty slot. */
  private chips(host: HTMLElement, held: [AbilityId, number][], slots: number, kind: string): void {
    host.replaceChildren();
    for (const [id, level] of held) {
      const max = maxLevelOf(id);
      const hue = characterHue(characterOf(id));
      const li = document.createElement('li');
      // A maxed instrument is half of a fusion, so it reads as gold rather than
      // as its own colour — the same rule the offer screen follows.
      const maxed = level >= max;
      li.textContent = max > 1 ? `${labelOf(id)} ${level}` : labelOf(id);
      li.title = `${characterOf(id)}${max > 1 ? ` — level ${level} of ${max}` : ''}`;
      li.style.borderColor = maxed ? 'rgba(255,209,102,.75)' : `hsla(${hue}, 88%, 62%, .45)`;
      li.style.color = maxed ? 'hsl(45, 95%, 78%)' : `hsl(${hue}, 90%, 76%)`;
      li.style.background = `hsla(${maxed ? 45 : hue}, 85%, 55%, .14)`;
      host.appendChild(li);
    }
    for (let i = held.length; i < slots; i++) {
      const li = document.createElement('li');
      li.className = 'slot';
      li.textContent = '·';
      /*
       * It said "beat a boss to widen the band". Slot growth was REMOVED —
       * `grantBossReward`'s own comment reads "the band does not get bigger
       * when you beat a boss, it gets better" — so the panel was telling the
       * player to do a thing that would never pay. A stale promise in a
       * tooltip is worse than no tooltip: they can act on it.
       *
       * What actually fills a slot is taking a card; what frees one again is a
       * fusion, which spends its catalyst. That is what it says now.
       */
      li.title = `empty ${kind} slot — a new ${kind} fills it, and a fusion frees one again`;
      host.appendChild(li);
    }
  }

  /**
   * Who is on stage. This is the same list as "which motifs are in the mix",
   * which is the point: the panel is a mixer channel strip that happens to be
   * populated by whatever is currently trying to kill you.
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
