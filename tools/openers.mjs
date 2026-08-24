/*
 * openers — is the opening choice real, and is any of it a trap?
 *
 * Every run used to start with PIZZICATO, so the first decision arrived at the
 * first level-up, minutes in. `STARTERS` puts a choice before the run, the way
 * a character does in Vampire Survivors and a starting ball does in Ball x Pit.
 *
 * A choice between options is only a choice if they are all playable. Measured
 * over three seeds of 240s, every base instrument as the sole opener separated
 * hard: pizzicato 8.7 waves, echoes 7.3, chime 6.7, then a cliff to 5.3 and a
 * tail to feedback at 3.0. An arc or a beam alone cannot clear early waves —
 * snare and bow both took about twenty hits against pizzicato's seven. Offering
 * one of those would not widen the game, it would punish the player for reading
 * the menu.
 *
 * So this checks three things:
 *   1. the wire — setting `world.starter` actually seats that instrument, and
 *      survives the retry path, which is the same `start()` call;
 *   2. viability — no offered opener trails the best by more than the measured
 *      spread already present between them;
 *   3. distinctness — the openers do not all play the same, or the choice is
 *      decoration.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).pathname;
const { World } = await import(`${R}game/world.ts`);
const { STARTERS, STARTING_INSTRUMENT } = await import(`${R}game/progression.ts`);
const { labelOf } = await import(`${R}game/weapons.ts`);
const { ensembleLift } = await import(`${R}audio/orchestration.ts`);

const DT = 1 / 60;
const SECS = Number(process.env.OPENERS_SECS ?? 240);
const SEEDS = [1, 2, 3];
/*
 * The worst opener may not fall below this share of the best. Set from the
 * spread the three already have (6.7 / 8.7 = 0.77), so it ratchets against a
 * starter DECAYING into a trap rather than asserting they should be equal —
 * they should not be, or the choice would carry no consequence.
 */
const MIN_SHARE = 0.70;

const fails = [];

/* 1. The wire. */
for (const id of [...STARTERS, 'not-an-instrument']) {
  const w = new World(1);
  w.starter = id;
  w.start();
  const held = Object.keys(w.progression.instruments);
  const want = STARTERS.includes(id) ? id : STARTING_INSTRUMENT;
  if (held.length !== 1 || held[0] !== want) {
    fails.push(`starter "${id}" seated ${JSON.stringify(held)}, wanted exactly ["${want}"]`);
  }
  // The retry path is the same call; a second start must not lose the choice.
  w.start();
  if (Object.keys(w.progression.instruments)[0] !== want) {
    fails.push(`starter "${id}" was lost on restart — the retry button would hand back the default`);
  }
}

/*
 * 4. Does the choice change the SOUND, from the first bar?
 *
 * This game's premise is that the state generates the score, so an opening
 * pick that leaves the music identical is only half a choice. Each starter
 * lifts a different ensemble lane on the frame the run begins — pizzicato the
 * arp, echoes the fx, chime the lead — which means the three openings are
 * audibly distinct before a single level-up. That is a property of
 * `ENSEMBLE_MIX` and nothing was holding it: two starters mapped to one lane
 * would still pass every check above.
 */
const STEMS = ['kick', 'clap', 'sub', 'arp', 'chords', 'lead', 'fx', 'motifs'];
const lanes = new Map();
for (const id of STARTERS) {
  const lifted = STEMS.filter((st) => ensembleLift({ [id]: 1 }, st) > 0);
  lanes.set(id, lifted);
  if (!lifted.length) fails.push(`${labelOf(id)} lifts no ensemble lane — the run opens with it and the band does not notice`);
}
const claimed = new Map();
for (const [id, lifted] of lanes) {
  const key = lifted.join('+');
  if (claimed.has(key)) {
    fails.push(`${labelOf(claimed.get(key))} and ${labelOf(id)} both open on "${key}" — the two choices sound the same`);
  }
  claimed.set(key, id);
}

/* 2 & 3. Play them. */
const rows = [];
for (const id of STARTERS) {
  let wave = 0, score = 0, hits = 0;
  for (const seed of SEEDS) {
    const w = new World(seed);
    w.starter = id;
    w.start();
    const drive = makeBrain('dodge');
    const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: 0, banish: -1, reroll: false, skip: false };
    let h = 0;
    w.bus.on('player:hit', () => h++);
    for (let i = 0; i < Math.round(SECS / DT); i++) {
      if (i % 2 === 0) { drive(w, inp); inp.choice = w.choosing ? 0 : -1; }
      inp.well = i % 120 === 0;
      w.update(DT, inp);
    }
    wave += w.waveIndex; score += w.snapshot.score; hits += h;
  }
  rows.push({ id, wave: wave / SEEDS.length, score: score / SEEDS.length, hits: hits / SEEDS.length });
}

console.log(`\nopeners — ${STARTERS.length} starting choices, ${SEEDS.length} seeds x ${SECS}s\n`);
console.log(`  ${'opener'.padEnd(14)} ${'wave'.padStart(5)} ${'score'.padStart(8)} ${'hits'.padStart(6)}`);
console.log(`  ${'-'.repeat(14)} ${'-'.repeat(5)} ${'-'.repeat(8)} ${'-'.repeat(6)}`);
for (const r of rows) {
  console.log(`  ${labelOf(r.id).padEnd(14)} ${r.wave.toFixed(1).padStart(5)} ${String(Math.round(r.score)).padStart(8)} ${r.hits.toFixed(1).padStart(6)}`);
}

const best = Math.max(...rows.map((r) => r.wave));
const worst = rows.reduce((a, r) => (r.wave < a.wave ? r : a), rows[0]);
const share = best > 0 ? worst.wave / best : 0;
console.log('\n  opening lane:');
for (const [id, lifted] of lanes) console.log(`    ${labelOf(id).padEnd(14)} ${lifted.join(', ') || 'none'}`);
console.log(`\n  weakest opener reaches ${(100 * share).toFixed(0)}% of the strongest (min ${(100 * MIN_SHARE).toFixed(0)}%)`);
if (share < MIN_SHARE) {
  fails.push(`${labelOf(worst.id)} reaches only ${(100 * share).toFixed(0)}% of the best opener's wave — it is a trap, not a choice`);
}
if (new Set(rows.map((r) => Math.round(r.score))).size < rows.length) {
  fails.push('two openers produced identical scores — the choice is not reaching the simulation');
}

for (const f of fails) console.log(`\n  FAIL  ${f}`);
if (!fails.length) console.log('\n  ok  every opener is honoured, playable, and plays differently');
process.exit(fails.length ? 1 : 0);
