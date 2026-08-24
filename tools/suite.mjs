/**
 * Runs every check in verify:all without stopping at the first failure.
 *
 * `verify:all` is a chain of `&&`, so one flaky gate hides everything after it.
 * Three iterations running it stopped around the twentieth check on a different
 * discrete-event assertion each time, which meant discovering one problem per
 * iteration instead of all of them at once.
 */
import { spawn } from 'node:child_process';

const chain = JSON.parse(await (await import('node:fs/promises')).readFile('package.json', 'utf8'))
  .scripts['verify:all'].split('&&').map((s) => s.trim().replace(/^npm run /, ''));
const checks = chain.filter((c) => c !== 'verify:all' && c !== 'build');

const run = (name) => new Promise((res) => {
  const t0 = Date.now();
  const child = spawn('npm', ['run', name], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', (code) => res({ name, code, seconds: Math.round((Date.now() - t0) / 1000), tail: out.trim().split('\n').slice(-2).join(' | ').slice(0, 100) }));
});

const results = [];
for (const c of checks) {
  const r = await run(c);
  results.push(r);
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${c.padEnd(16)} ${String(r.seconds).padStart(4)}s  ${r.code === 0 ? '' : r.tail}`);
}
const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${Math.round(results.reduce((a, r) => a + r.seconds, 0) / 60)} minutes total`);
if (failed.length) console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
process.exit(failed.length ? 1 : 0);
