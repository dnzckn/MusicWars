/*
 * builds — does it matter which card you pick?
 *
 * In a survivors-like the level-up choice IS the game: the run is a build, and
 * the fight is the consequence of it. Nothing in this repo has ever asked
 * whether that is true here. The bot every balance tool uses answers every
 * offer with card 0, which is exactly the policy that cannot tell a meaningful
 * choice from a decorative one.
 *
 * So: run the same seeds under different PICK POLICIES and compare. The
 * question is not which policy wins — it is whether the spread between
 * policies is larger than the spread between seeds. If it is not, the cards
 * are cosmetic and the player's decisions are not reaching the game.
 *
 *   first    always the leftmost card (what every other tool measures)
 *   last     always the rightmost
 *   random   uniform over the offered options, per offer
 *   greedy   prefers a NEW ability over levelling one, so it spreads wide
 *   narrow   prefers levelling something already owned, so it goes deep
 *
 * `wide` versus `deep` is the real design question underneath — a system where
 * both do equally well is one where the interesting decision is absent.
 */
import './lib/headless-audio.mjs';
import { makeBrain } from './lib/bot-brain.mjs';
const R = new URL('../src/', import.meta.url).href;
const { World } = await import(`${R}game/world.ts`);
const META = await import(`${R}game/meta.ts`);

/*
 * WHICH ROSTER THE PICK IS BEING MADE FROM.
 *
 * `docs/plan-meta.md` §6 names "if 8 weapons makes runs samey" as the thing
 * that would falsify the whole unlock design, and it names THIS file as the
 * instrument: 28 pairs is arithmetic, and whether the pick still changes the
 * run is a measurement.
 *
 * THE DEFAULT IS `full` AND THE SHIPPED GAME IS `base`, which is an
 * uncomfortable pair and is deliberate. Every baseline recorded at the foot of
 * this file — 0.73, 0.37, 0.29, 0.12, 0.22 and the 2.4x -> 1.5x damage spread —
 * was measured against thirty instruments and twelve passives. Flipping the
 * default would silently re-baseline all of them, which is the exact failure
 * AGENTS.md §6 opens with: compare against the same code, not a remembered
 * number. So the historical arm stays reproducible by running this file with no
 * environment at all, and `ROSTER=base` measures what a new player actually
 * holds. Both numbers belong in the record; neither replaces the other.
 *
 * One arm per invocation rather than both in one, unlike `tools/offerpool.mjs`:
 * this file plays 56 real runs of 900 simulated seconds and doubling that is
 * minutes of wall clock, where offerpool's arms are a model of the dealer and
 * cost nothing.
 */
const ROSTER = (process.env.ROSTER ?? 'full').toLowerCase();
const UNLOCKED = ROSTER === 'base' ? META.unlockedRoster(META.defaultMeta()) : null;

const DT = 1 / 120;
/*
 * 900s, not 480. The `fuser` and `refuser` policies only mean anything once
 * combinations exist, and measured across three seeds a 480s run produces
 * fusion cards in about 1% of offers against 20% at 900s. Run short, those two
 * policies have nothing to act on, fall through to card 0, and become exact
 * duplicates of `first` — which drags the policy spread down and reads as the
 * build system flattening. It is not: with the original five policies the same
 * build measures 0.36 against a 0.37 baseline.
 */
const SECS = Number(process.env.SECS ?? 900);
/*
 * Eight seeds, not four. The ratio below divides policy spread by SEED spread,
 * so the denominator is itself an estimate — at four seeds a verdict can sit
 * either side of the bar on noise alone, which happened when slots went to
 * 4/3 and the reading moved 0.73 -> 0.34 with the hits spread barely changed.
 */
const SEEDS = [0x51ed, 0xbeef, 0x1234, 0xc0de, 0x9a7f, 0x77aa, 0x3f10, 0xd00d];
const THREAT_RADIUS = 150;

/* Deterministic per-offer pseudo-randomness: no Math.random, so runs repeat. */
function pick(policy, offer, n, counter) {
  const opts = offer.options;
  if (!opts.length) return 0;
  switch (policy) {
    case 'first': return 0;
    case 'last': return opts.length - 1;
    case 'random': return (counter * 1103515245 + 12345) % opts.length;
    case 'greedy': {
      const i = opts.findIndex((o) => o.isNew && o.id);
      return i >= 0 ? i : 0;
    }
    case 'narrow': {
      const i = opts.findIndex((o) => !o.isNew && o.id);
      return i >= 0 ? i : 0;
    }
    /*
     * Take every combination the moment it is offered.
     *
     * DUET makes combining always legal — any two maxed instruments merge —
     * so "did you ever fuse" stopped separating players and the interesting
     * question became whether fusing GREEDILY is a mistake. It should be: each
     * merge spends two maxed instruments for one that starts at level 1, so a
     * player who takes every one on sight keeps resetting their own power.
     * If this policy wins, combining is not a decision.
     */
    case 'fuser': {
      const i = opts.findIndex((o) => o.fusion);
      return i >= 0 ? i : 0;
    }
    /* Never combine. The other end of the same question. */
    case 'refuser': {
      const i = opts.findIndex((o) => !o.fusion);
      return i >= 0 ? i : 0;
    }
    default: return 0;
  }
}

const POLICIES = ['first', 'last', 'random', 'greedy', 'narrow', 'fuser', 'refuser'];
const results = {};
for (const policy of POLICIES) {
  const per = [];
  for (const seed of SEEDS) {
    const w = new World(seed); w.unlocked = UNLOCKED; w.start();
    const drive = makeBrain('dodge');
    const inp = { x: 0, y: 0, shoot: true, focus: false, bomb: false, well: false, choice: -1, banish: -1, reroll: false, skip: false };
    let hits = 0, offers = 0, press = 0, pn = 0;
    w.bus.on('player:hit', () => hits++);
    const steps = Math.round(SECS / DT);
    for (let i = 0; i < steps; i++) {
      if (i % 2 === 0) drive(w, inp);
      /*
       * Override the brain's `choice` AFTER it runs. The brain hardcodes 0,
       * which is the very policy under test — letting it win would make every
       * row identical and the tool would report "choices do not matter"
       * because it never made a different one.
       */
      if (w.choosing && w.offer) { inp.choice = pick(policy, w.offer, w.offer.options.length, offers); offers++; }
      else inp.choice = -1;
      w.update(DT, inp);
      if (i % 30 === 0) {
        // PRESSURE is bodies within THREAT_RADIUS, not bullets. Contact damage
        // means a body inside that ring is the threat a bullet used to be.
        let near = 0;
        for (const e of w.enemies) {
          const dx = e.x - w.player.x, dy = e.y - w.player.y;
          if (dx * dx + dy * dy < THREAT_RADIUS * THREAT_RADIUS) near++;
        }
        press += near; pn++;
      }
      if (w.phase === 'over') break;
    }
    per.push({ seed, wave: w.snapshot.wave, score: w.score, level: w.progression.level, hits, press: pn ? press / pn : 0 });
  }
  results[policy] = per;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

console.log(`\nbuilds — ${SECS}s, ${SEEDS.length} seeds x ${POLICIES.length} pick policies`);
console.log(
  `  roster ${ROSTER.toUpperCase()} — ` +
    `${UNLOCKED ? `${UNLOCKED.size} ids draftable, the shipped starting roster` : 'the whole table'}` +
    '.  ROSTER=base|full\n',
);
console.log('  policy   mean wave  mean score  mean level  mean hits');
console.log('  -------  ---------  ----------  ----------  ---------');
for (const p of POLICIES) {
  const r = results[p];
  console.log(`  ${p.padEnd(7)}  ${mean(r.map((x) => x.wave)).toFixed(1).padStart(9)}  ${Math.round(mean(r.map((x) => x.score))).toString().padStart(10)}  ${mean(r.map((x) => x.level)).toFixed(1).padStart(10)}  ${mean(r.map((x) => x.hits)).toFixed(1).padStart(9)}`);
}

/*
 * The comparison that matters. Spread ACROSS policies (each averaged over the
 * same seeds, so seed luck cancels) against spread across seeds within one
 * policy. If policy spread is the smaller of the two, the pick is noise.
 */
const policyMeans = POLICIES.map((p) => mean(results[p].map((x) => x.wave)));
const seedSpread = mean(POLICIES.map((p) => sd(results[p].map((x) => x.wave))));
const policySpread = sd(policyMeans);
console.log(`\n  spread in wave reached ACROSS POLICIES: ${policySpread.toFixed(2)}`);
console.log(`  spread ACROSS SEEDS within a policy:   ${seedSpread.toFixed(2)}`);
console.log(`  ratio (policy / seed): ${(seedSpread ? policySpread / seedSpread : 0).toFixed(2)}`);

const fails = [];
const ratio = seedSpread ? policySpread / seedSpread : 0;
/*
 * A deliberately low bar. It is not "builds must be balanced" — it is "the
 * choice must register at all against seed luck". Below this the level-up
 * screen is a cutscene.
 */
/*
 * GATED ON DAMAGE TAKEN, NOT ON WAVE REACHED — and the wave ratio is kept
 * above only as a diagnostic.
 *
 * That ratio divides policy spread by SEED spread, and both grow with run
 * length while seed spread grows faster: a long run compounds its own luck.
 * Across changes that were mostly not about build quality at all it has read
 * 0.73, 0.37, 0.29, 0.12 and 0.22 — a number that moves that much under
 * unrelated pressure is not measuring what its name says.
 *
 * Damage taken has been stable and interpretable the whole time, and it is
 * directly attributable to the build: `narrow` took 3.5 hits where `random`
 * took 30 at 480s, and at 900s `fuser` takes 12.3 against `random`'s 33.3.
 * A 2x spread means the pick decides how much punishment the run costs you,
 * which is what "the choice reaches the game" actually means.
 */
const hitsBy = POLICIES.map((p) => mean(results[p].map((x) => x.hits)));
const hitSpread = Math.max(...hitsBy) / Math.max(0.001, Math.min(...hitsBy));
console.log(`  damage taken across policies: ${Math.min(...hitsBy).toFixed(1)} to ${Math.max(...hitsBy).toFixed(1)} hits — ${hitSpread.toFixed(1)}x spread`);

/*
 * DIVERGENCE, in both currencies at once — replacing a damage-only assertion.
 *
 * WHY THE OLD ONE WENT. It required the best and worst policies to differ by
 * 2x in DAMAGE TAKEN, and the comment above defends that at length: the ratio
 * had read 0.73/0.37/0.29/0.12/0.22 across changes that were not about build
 * quality, while damage taken stayed "stable and interpretable". All true, and
 * it rested on a premise that is no longer true.
 *
 * The premise: that every item's effect shows up as damage taken. That held
 * when all twelve instruments were damage dealers, because the only thing a
 * pick could do was kill faster, and killing faster is taking fewer hits. Four
 * of the twelve now deal no direct damage at all. REST and RITARDANDO LOWER
 * damage taken and LOWER wave reached; CRESCENDO raises both. A roster that
 * trades progress against punishment compresses the damage column from both
 * ends while the picks matter MORE, not less — which is exactly what happened:
 * damage spread fell 2.4x -> 1.5x in the same pass that policy spread in wave
 * reached rose 0.97 -> 1.48 and the tool's own ratio rose 0.22 -> 0.29.
 *
 * So this is the second case AGENTS.md names — "the test encoded an assumption
 * I am deliberately changing" — and the rule for that case is to replace the
 * gate with a STRONGER one rather than relax it. Dropping MIN_HIT_SPREAD to 1.4
 * would have been the other thing, and it would have been a tolerance for the
 * defect the gate exists to catch.
 *
 * WHAT THIS ASSERTS INSTEAD. Each policy becomes a point in a two-dimensional
 * space — wave reached and damage taken — with each axis divided by its own
 * cross-policy mean so the two are commensurable and neither dominates by unit.
 * The statistic is the largest distance between any two policies. It answers
 * "do different pick policies produce different RUNS" without prescribing the
 * currency the difference has to arrive in.
 *
 * It is strictly harder to game than the old one. A roster where the pick does
 * nothing collapses every policy onto one point and scores ~0 on BOTH axes, so
 * it fails here exactly as it failed before. But a roster where one policy
 * survives longer and another gets further now passes, and under the old
 * assertion it could not — which is the whole point of having defensive and
 * control items in the roster at all.
 *
 * Both raw columns are still printed above and below, because a single distance
 * is not diagnosable on its own and the decomposition is what anyone actually
 * reads.
 *
 * THRESHOLD, calibrated rather than chosen: the roster measures 0.38 and a
 * deliberately flattened one (every policy forced to the same picks) measures
 * 0.02. 0.25 sits between them with room on both sides, and has been seen red.
 */
const waveBy = POLICIES.map((p) => mean(results[p].map((x) => x.wave)));
const waveMean = Math.max(0.001, mean(waveBy));
const hitsMean = Math.max(0.001, mean(hitsBy));
const points = POLICIES.map((_, i) => [waveBy[i] / waveMean, hitsBy[i] / hitsMean]);
let divergence = 0;
let apart = ['', ''];
for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
    if (d > divergence) { divergence = d; apart = [POLICIES[i], POLICIES[j]]; }
  }
}
const MIN_DIVERGENCE = 0.25;
console.log(`  divergence across policies (wave + damage, mean-normalised): ${divergence.toFixed(2)}` +
  `  — furthest apart: ${apart[0]} vs ${apart[1]}`);
if (divergence < MIN_DIVERGENCE) {
  fails.push(`policies differ by only ${divergence.toFixed(2)} in combined wave/damage ` +
    `(want >=${MIN_DIVERGENCE}) — the level-up choice is not reaching the game`);
}
console.log('');
if (fails.length) { for (const m of fails) console.log(`  FAIL  ${m}`); process.exit(1); }
console.log('  ok  the pick changes the run');
console.log('\n  Baseline 2026-08-23, 480s x 8 seeds, slots fixed at 4 stand / 3 rig — ratio 0.37.');
console.log('  READ THE DECOMPOSITION, NOT THE RATIO. Against the 6+6 baseline the policy');
console.log('  spread barely moved (0.86 -> 0.92); the SEED spread doubled (1.17 -> 2.49),');
console.log('  which is what halved the ratio. Fewer chairs means what you are OFFERED');
console.log('  matters more run to run — that is roguelite variance, not the pick going');
console.log('  cosmetic. A drop in this ratio is only bad news if policy spread fell too.');
console.log('\n  Baseline 2026-08-22, 480s x 4 seeds — ratio 0.73. The interesting part is');
console.log('  not the ratio but the hits column: narrow (level what you already own)');
console.log('  took 3.5 hits where random took 30.3, a 9x swing in damage taken from');
console.log('  the pick policy alone, while reaching a similar wave. Going deep is');
console.log('  much safer than going wide, and that is a real decision rather than a');
console.log('  dominant one only while random still scores comparably. If a later');
console.log('  pass flattens that hits spread, the choice is going cosmetic even if');
console.log('  the ratio above still passes.');
