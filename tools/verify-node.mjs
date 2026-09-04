/*
 * verify-node — every check that runs WITHOUT a browser, in one command.
 *
 * `npm run verify:all` is the real suite and it dies on its second step:
 * `smoke` launches Playwright, and on a machine whose browser stack is down
 * that is the end of the run. Around 26 of the 135 tools in `tools/` need no
 * browser at all, and they had no collective entry point — so they were run in
 * ad-hoc batches, which is how a check gets quietly left out for weeks.
 *
 * Ordered FAST FIRST. A typo or a broken import should surface in ten seconds,
 * not after four minutes of simulation, and it means a run that is interrupted
 * has still covered the cheap ground.
 *
 * `--fast` stops before the simulation-heavy group; `--list` prints the plan
 * and exits. Every tool is run as its own process so one crash cannot take the
 * rest down, and so a hung tool can be killed on its own timeout.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;

/*
 * Groups are ordered by cost, and the cost is measured rather than guessed.
 * SLOW drives real `World` simulations over many seeds; a single entry there
 * can outweigh the whole of the two groups above it.
 */
const GROUPS = [
  /*
   * `inputcheck` sits in the cheap group even though it drives the real `Loop`
   * and the real `Input`: it runs a virtual clock, so ~10,000 simulated frames
   * across ten refresh rates cost under a second. The groups are ordered by
   * measured cost, not by how much machinery a tool touches.
   */
  /*
   * `effectsdraw` and `levelupdraw` are node-only — they drive the real
   * `Renderer` against a recording 2D context and never open a browser — and
   * neither was in this list. `effectsdraw` had been DEAD for some time as a
   * result: `Renderer`'s constructor grew a `ResizeObserver` its DOM stub does
   * not provide, so every invocation threw before the first assertion, and the
   * only suite that ran it (`npm run verify`) dies on its second step on any
   * machine without a browser. The header of this file names that exact failure
   * mode — "which is how a check gets quietly left out for weeks".
   */
  ['static', 120, [
    'syntax', 'domwiring', 'inputcheck', 'legibility', 'colourblind', 'typescale',
    'effectsdraw', 'levelupdraw',
  ]],
  ['score', 300, [
    'tune', 'clash', 'contour', 'motif', 'rhythm', 'basscheck', 'leadcheck',
    'motorcheck', 'perccheck', 'masking', 'interlock', 'barvariety', 'leadfreeze', 'instruments', 'sfxcheck',
  ]],
  /*
   * `gridview` is in `rules` next to `gridcost` because it costs about the
   * same and asks the adjacent question: `gridcost` measures what the lattice
   * costs, `gridview` asserts that the cost is bounded by the VIEWPORT rather
   * than by the field. The argument that makes that true is an OPTIONAL
   * parameter on `WarpGrid.draw`, so dropping it silently reverts the arena to
   * painting the whole world with every other gate still green — which is
   * precisely the sort of thing this list exists to catch.
   */
  ['rules', 300, ['mirror', 'stats', 'levelup', 'wiring', 'discovery', 'aimcheck', 'offerchurn', 'gridcost', 'gridview', 'runmap']],
  ['slow', 600, [
    'brain', 'pause', 'drops', 'overdrive', 'session', 'realprobe',
    /*
     * `rulefire` sits here rather than in `rules` because it drives seven real
     * 300-second `World` runs — one per rule-bearing passive plus a control.
     * It belongs to the same family as `builds`: a check that can only be
     * answered by playing the game.
     */
    'rulefire',
    'builds', 'difficulty', 'combine', 'openers', 'churn', 'sections',
  ]],
];

const fast = process.argv.includes('--fast');
const plan = GROUPS.filter((g) => !(fast && g[0] === 'slow'));

if (process.argv.includes('--list')) {
  for (const [name, , tools] of plan) console.log(`${name.padEnd(7)} ${tools.join(' ')}`);
  process.exit(0);
}

function run(tool, timeoutSec) {
  const cmd = scripts[tool];
  if (!cmd) return Promise.resolve({ tool, code: 127, ms: 0, why: 'no such npm script' });
  const started = Date.now();
  return new Promise((resolve) => {
    /*
     * `shell: true` rather than an explicit `sh -c`.
     *
     * The original spawned `sh` directly, which does not exist on a stock
     * Windows box and made every one of these checks report a crash as a
     * FAIL. Node picks cmd.exe or sh per platform when `shell` is true, and
     * the script bodies are plain `node tools/x.mjs` either way.
     *
     * NODE_OPTIONS carries the type-stripping flag so a tool works whether or
     * not its own npm script spells it out. Node >=23.6 strips types with no
     * flag; on 22.x it is required, and the scripts disagree about which of
     * them carry it. Setting it here means the runner does not depend on that.
     */
    const p = spawn(cmd, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env, NODE_OPTIONS: `--experimental-transform-types ${process.env.NODE_OPTIONS ?? ''}`.trim() },
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => { p.kill('SIGKILL'); }, timeoutSec * 1000);
    p.on('close', (code) => {
      clearTimeout(kill);
      // The first FAIL line is what a reader needs; the rest is context they
      // can get by running the tool directly.
      const first = out.split('\n').find((l) => /\bFAIL\b/.test(l));
      resolve({ tool, code: code ?? 1, ms: Date.now() - started, why: first?.trim() });
    });
  });
}

console.log(`\nverify-node — ${plan.reduce((a, g) => a + g[2].length, 0)} checks, no browser required${fast ? ' (--fast)' : ''}\n`);
const failed = [];
let total = 0;
for (const [group, timeoutSec, tools] of plan) {
  console.log(`  ${group}`);
  for (const tool of tools) {
    const r = await run(tool, timeoutSec);
    total += r.ms;
    const secs = (r.ms / 1000).toFixed(1).padStart(6);
    if (r.code === 0) {
      console.log(`    ok    ${tool.padEnd(12)} ${secs}s`);
    } else {
      failed.push(r);
      console.log(`    FAIL  ${tool.padEnd(12)} ${secs}s  ${r.why ?? `exit ${r.code}`}`);
    }
  }
}

console.log(`\n  ${total ? (total / 1000 / 60).toFixed(1) : 0} minutes total`);
if (failed.length) {
  console.log(`\n  ${failed.length} FAILED: ${failed.map((f) => f.tool).join(', ')}`);
  process.exit(1);
}
console.log('\n  ok  everything that can run here, ran, and passed');
