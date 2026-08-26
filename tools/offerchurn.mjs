/*
 * offerchurn — does the level-up offer announce itself once, or once per bar?
 *
 * WHY THIS EXISTS. Reported from play: "on the item selection screen, whenever
 * the tempo reaches the end it repops up the selection, so it's pretty
 * annoying."
 *
 * `World.update` calls `openOfferNow()` on EVERY bar line, and the comment
 * there asserted that was free because `openOffer` is idempotent. It is
 * idempotent in STATE and not in EFFECTS:
 *
 *     if (state.offer || state.pending <= 0) return state.offer;
 *
 * With an offer already open that returns `state.offer` — truthy, the same
 * object — so `openOfferNow`'s `if (!offer) return` never fired. Every bar line
 * re-ran `emitOffer` and re-fired the LEVEL banner, and `main.ts` answers
 * `level:offer` with `sfxPickup(7)`, so the sting replayed too. At 128bpm a bar
 * is 1.875s, so the card screen re-announced itself roughly every two seconds
 * for as long as the player took to read it.
 *
 * WHAT IT MEASURES. Not the source text and not the state: it drives the real
 * `World`, counts the `level:offer` events the real bus actually emits, and
 * compares that against the number of DISTINCT offers opened. The whole defect
 * was a mismatch between those two numbers, so counting only one of them would
 * miss it entirely.
 *
 * THE ASSERTION. Every offer emits exactly one `level:offer`. Not "few", not
 * "roughly one" — exactly one, because the failure mode is a repeat and any
 * tolerance here is a tolerance for the bug.
 *
 * The run has to be long enough for a bar line to land INSIDE an open offer,
 * or the check is vacuous. That is why it holds each offer unanswered for
 * several seconds of simulated time instead of choosing immediately: an offer
 * answered on the frame it opens can never see a bar line and would pass on the
 * broken code. The printed "offers that saw a bar line" count is the real
 * denominator and a zero there is a failure.
 */
await import('./lib/headless-audio.mjs');

const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const { FIXED_DT } = await import(`${R}core/loop.ts`);

const SEEDS = [1, 7, 12345, 99, 2024];
/** Simulated seconds to leave an offer unanswered. Several bars at any tempo. */
const HOLD = 6;
const RUN_SECONDS = 240;

const idle = {
  x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false,
  choice: -1, banish: -1, reroll: false, skip: false,
};

let totalOffers = 0;
let totalEmits = 0;
let sawBarLine = 0;
const offenders = [];

for (const seed of SEEDS) {
  const w = new World(seed);
  w.start();

  let emits = 0;
  let openEmits = 0;
  let offerOpen = false;
  let heldFor = 0;
  let offersThisSeed = 0;

  /*
   * Count a NEW offer by OBJECT IDENTITY, not by watching `offer` go null.
   *
   * The first version of this check inferred "a new offer opened" from a
   * null -> non-null transition, and reported 56 emits for 55 offers. That was
   * the CHECK being wrong, not the game: a level-up queued behind another one
   * opens on the same step the previous closes, so `offer` never passes through
   * null and two genuine offers are counted as one. It only showed up once the
   * level ladder shortened and offers started arriving every ~18 seconds.
   *
   * Identity is the honest test. `openOffer` assigns a fresh object per offer,
   * so a repeat announcement is the SAME object seen twice and a chained offer
   * is a different one — which is exactly the distinction the tool exists to
   * make, and the null-transition proxy could not make it at all.
   */
  let lastSeen = null;

  w.bus.on('level:offer', () => {
    emits++;
    if (offerOpen) openEmits++;
  });

  const steps = Math.round(RUN_SECONDS / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const current = w.progression.offer;
    const choosing = current !== null;

    if (choosing && current !== lastSeen) {
      lastSeen = current;
      offerOpen = true;
      heldFor = 0;
      offersThisSeed++;
    }

    let input = idle;
    if (choosing) {
      heldFor += FIXED_DT;
      // Hold it open long enough that a bar line MUST land inside it, then
      // answer. Answering immediately would make this check vacuous.
      if (heldFor >= HOLD) {
        input = { ...idle, choice: 0 };
        offerOpen = false;
        sawBarLine++;
      }
    }
    w.update(FIXED_DT, input);
  }

  /*
   * Observe once more after the loop.
   *
   * The loop reads `w.progression.offer` BEFORE calling `w.update()`, so an
   * offer opened during the very last step is emitted and never seen — which
   * showed up as 56 emits for 55 offers, a phantom off-by-one that is the
   * TOOL's blind spot and not a repeat announcement. Closing the window is the
   * honest fix; widening the assertion to "within one" would have been a
   * tolerance for the exact defect this exists to catch.
   */
  if (w.progression.offer !== null && w.progression.offer !== lastSeen) offersThisSeed++;

  totalOffers += offersThisSeed;
  totalEmits += emits;
  if (openEmits > 0) offenders.push({ seed, openEmits, offers: offersThisSeed });
}

console.log('\nofferchurn — does an offer announce itself once, or once per bar?\n');
console.log(`  ${SEEDS.length} seeds x ${RUN_SECONDS}s, each offer held ${HOLD}s before answering`);
console.log(`  offers opened            ${totalOffers}`);
console.log(`  level:offer emitted      ${totalEmits}`);
console.log(`  offers held past a bar   ${sawBarLine}`);

/*
 * A check that examined nothing reports a pass. If no offer was ever held open
 * across a bar line then the repeat could not have happened and this tool has
 * proved nothing — that is a failure, not a clean sheet.
 */
if (totalOffers === 0 || sawBarLine === 0) {
  console.log('\n  FAIL  no offer was held open across a bar line — this check proved nothing\n');
  process.exit(1);
}

if (offenders.length > 0) {
  console.log('\n  re-emitted while already open:\n');
  for (const o of offenders) {
    console.log(`    seed ${String(o.seed).padStart(6)}  ${o.openEmits} repeat emit(s) across ${o.offers} offer(s)`);
  }
  console.log('\n  FAIL  the offer re-announces itself while the player is reading it\n');
  process.exit(1);
}

if (totalEmits !== totalOffers) {
  console.log(`\n  FAIL  ${totalEmits} emits for ${totalOffers} offers — they should be equal\n`);
  process.exit(1);
}

console.log('\n  ok    every offer announced exactly once\n');
