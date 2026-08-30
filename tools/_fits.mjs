/**
 * _fits — scratch. Does the title screen's content fit the window it is in?
 *
 * `panelshot` asserts the PAGE does not scroll, which a `.screen` with its own
 * overflow satisfies while quietly clipping its own last four rows. This asks
 * the other question: how much of the title screen is below the fold, at every
 * window size, and which elements are cut.
 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 720], [1100, 700], [900, 800], [800, 600]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const m = await p.evaluate(() => {
    const s = document.getElementById('title-screen');
    const r = s.getBoundingClientRect();
    const cut = [];
    for (const el of s.querySelectorAll('.controls dt, .touch-hint, .warning, #start-button, .codex summary')) {
      const b = el.getBoundingClientRect();
      // Zero-height boxes are `display: contents` wrappers, not content.
      if (b.height <= 0) continue;
      if (b.bottom > r.bottom + 1 || b.top < r.top - 1) {
        cut.push(String(el.textContent ?? el.className ?? el.id).trim().slice(0, 22));
      }
    }
    return {
      scrollH: s.scrollHeight,
      clientH: s.clientHeight,
      overflow: s.scrollHeight - s.clientHeight,
      overflowStyle: getComputedStyle(s).overflowY,
      cut,
      pageScrolls: document.body.scrollHeight > window.innerHeight,
    };
  });
  console.log(
    `${String(w).padStart(4)}x${String(h).padEnd(4)} content ${m.scrollH}px in ${m.clientH}px` +
      ` (overflow ${m.overflow}px, overflow-y: ${m.overflowStyle}, page scrolls: ${m.pageScrolls})` +
      `${m.cut.length ? `  CLIPPED: ${m.cut.join(', ')}` : '  nothing clipped'}`,
  );
  await p.close();
}
await b.close();
