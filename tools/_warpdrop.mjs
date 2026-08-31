/* Can you get OUT of warp, and do enemies actually arrive while in it? */
import { chromium } from 'playwright';

const b = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-gl=angle', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'],
});
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.click('#start-button');
await p.waitForTimeout(3000);

const st = () =>
  p.evaluate(() => {
    const w = window.__musicwars.world;
    const vx = w.camera.viewX, vy = w.camera.viewY;
    return {
      warping: !!w.warping,
      charge: +(w.warpCharge ?? -1).toFixed(2),
      thr: +(w.lastThrottle ?? NaN).toFixed(2),
      alive: w.enemies.length,
      onScreen: w.enemies.filter((e) => e.x > vx && e.x < vx + w.viewW && e.y > vy && e.y < vy + w.viewH).length,
    };
  });

console.log('before      ', JSON.stringify(await st()));

await p.keyboard.down('KeyW');
await p.waitForTimeout(2200);
console.log('W held 2.2s ', JSON.stringify(await st()));
await p.keyboard.up('KeyW');
await p.waitForTimeout(8000);
console.log('warp +8s    ', JSON.stringify(await st()));

// Now try to drop out: hold S well past the stated 1.4s threshold.
await p.keyboard.down('KeyS');
for (const t of [1000, 1000, 1000, 2000]) {
  await p.waitForTimeout(t);
  console.log('  S held    ', JSON.stringify(await st()));
}
await p.keyboard.up('KeyS');
await p.waitForTimeout(1000);
console.log('S released  ', JSON.stringify(await st()));

// Try ArrowDown too, in case only one binding reaches the throttle axis.
await p.keyboard.down('ArrowDown');
await p.waitForTimeout(2500);
console.log('ArrowDown   ', JSON.stringify(await st()));
await p.keyboard.up('ArrowDown');

await b.close();
