/**
 * Never leak a browser, whatever the tool does next.
 *
 * Two orphaned `chrome-headless` processes wedged this box for two hours and
 * twenty-two minutes and could not be killed — a process stuck in `D` state
 * never returns to userspace to receive the signal, so `kill -9` reports
 * success and changes nothing. They were leaked by the pattern almost every
 * tool in this directory uses:
 *
 *     const b = await chromium.launch(…);
 *     …assertions…
 *     await b.close();          // <- only reached when nothing threw
 *
 * The obvious fix is `try/finally`, and in these files **it does not work**.
 * They are ESM modules built on top-level `await`, so a throw does not unwind
 * into anything — it rejects the module job, which Node reports as an unhandled
 * rejection and exits on. There is no enclosing frame for a `finally` to belong
 * to unless the whole file is wrapped in a function and re-indented, and that
 * still would not cover a SIGTERM from a harness timeout, which is how at least
 * one of the two orphans was actually created.
 *
 * So this registers the close on every path that can end the process:
 *
 *     const b = await chromium.launch(…);
 *     autoClose(b);
 *
 * Idempotent, and it never masks the original error — the failure is printed
 * first, then the browser is closed, then the exit code is set. A tool that
 * exits cleanly should still call `await b.close()` itself; this is the net
 * underneath, not a replacement for it.
 */

/**
 * Close `browser` on an uncaught exception, an unhandled rejection, a signal,
 * or a normal exit. Returns the browser so it can be chained.
 */
export function autoClose(browser) {
  let closed = false;

  const shut = async (why, err, code) => {
    if (err) console.error(`\n[autoclose] ${why}:`, err);
    if (!closed) {
      closed = true;
      try {
        // Racing a timeout: if the box is in an I/O stall, `close()` can hang
        // as thoroughly as the thing it is trying to clean up, and a cleanup
        // that hangs is the failure it exists to prevent.
        await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]);
      } catch {
        // Already gone, or unreachable. Nothing further to try.
      }
    }
    if (code !== undefined) process.exit(code);
  };

  process.on('uncaughtException', (e) => void shut('uncaught exception', e, 1));
  process.on('unhandledRejection', (e) => void shut('unhandled rejection', e, 1));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => void shut(`received ${sig}`, null, 130));
  }
  // Last resort. `exit` cannot await, but Playwright's own teardown usually
  // reaps the child from here; the handlers above are what actually matter.
  process.on('exit', () => {
    if (!closed) {
      closed = true;
      browser.close().catch(() => {});
    }
  });

  return browser;
}
