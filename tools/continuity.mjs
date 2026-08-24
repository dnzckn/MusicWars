/**
 * Does the music survive an interruption?
 *
 * Two cases: the player pausing, and the browser suspending the context out
 * from under us. In both the transport must come back where it left off — a
 * backwards or jumped clock re-fires or skips a whole screen of beat-scheduled
 * enemy volleys.
 */
import { chromium } from 'playwright';
import { freezePage } from './lib/frozen.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required','--mute-audio'] });
const p = await b.newPage();
const __reloads = await freezePage(p);
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(9000);

const read = () => p.evaluate(() => ({
  beat: +window.__musicwars.world.transport.beat.toFixed(2),
  cycle: +window.__musicwars.audio().cycle.toFixed(2),
  section: window.__musicwars.readout().section,
  enemies: window.__musicwars.world.snapshot.enemyCount,
}));

// --- player pause -----------------------------------------------------------
const beforePause = await read();
await p.keyboard.press('KeyP');
await p.waitForTimeout(3500);
const duringPause = await read();
await p.keyboard.press('KeyP');
await p.waitForTimeout(1500);
const afterPause = await read();

// --- browser suspension -----------------------------------------------------
const beforeSuspend = await read();
await p.evaluate(async () => { await window.__musicwars.audioCtx().suspend(); });
await p.waitForTimeout(3500);
const duringSuspend = await read();
await p.evaluate(() => { window.__musicwars.audioCtx().resume(); });
await p.waitForTimeout(1800);
const afterSuspend = await read();
if (__reloads() > 0) console.log(`WARNING: page reloaded ${__reloads()}x mid-run — these numbers span more than one build`);
await b.close();

const show = (l, v) => console.log(`${l.padEnd(16)} beat=${String(v.beat).padStart(8)}  cycle=${String(v.cycle).padStart(7)}  ${v.section}`);
show('before pause', beforePause); show('during pause', duringPause); show('after pause', afterPause);
console.log('');
show('before suspend', beforeSuspend); show('during suspend', duringSuspend); show('after suspend', afterSuspend);

const pauseFroze = Math.abs(duringPause.beat - beforePause.beat) < 1.5;
const pauseForward = afterPause.beat >= duringPause.beat - 0.1;
const suspendFroze = Math.abs(duringSuspend.beat - beforeSuspend.beat) < 1.5;
const suspendForward = afterSuspend.beat >= duringSuspend.beat - 0.1;
console.log(`\npause: froze=${pauseFroze} continuous=${pauseForward}`);
console.log(`suspend: froze=${suspendFroze} continuous=${suspendForward}`);
const ok = pauseFroze && pauseForward && suspendFroze && suspendForward;
console.log(ok ? 'THE CLOCK SURVIVES INTERRUPTION' : 'clock discontinuity');
if (!ok) process.exit(1);
