/**
 * Inline the production build into one self-contained HTML file.
 *
 * The Artifact host wraps the file in its own <!doctype>/<head>/<body>, so this
 * emits page *content* only — a <title>, the stylesheet, the markup and the
 * bundle as an inline module. Everything Strudel needs (including its
 * AudioWorklets, which ship as base64 data: URLs) is already inside the bundle,
 * so the page makes no network requests at all.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = readdirSync(join(dist, 'assets'));
const cssFile = assets.find((f) => f.endsWith('.css'));
const jsFile = assets.find((f) => f.endsWith('.js'));
if (!cssFile || !jsFile) throw new Error('build output not found — run `npm run build` first');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = readFileSync(join(dist, 'assets', cssFile), 'utf8');
const js = readFileSync(join(dist, 'assets', jsFile), 'utf8');

const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('could not find <body> in dist/index.html');
// Drop the module tag that pointed at the external bundle; it is inlined below.
const markup = bodyMatch[1].replace(/<script[^>]*type="module"[^>]*><\/script>/gi, '').trim();

const iconMatch = html.match(/<link rel="icon"[^>]*>/i);

// The bundle contains non-ASCII (the HUD's life pips, among other things).
// Without an explicit charset a host that serves the file without one decodes
// it as windows-1252 and the inline module dies with "Invalid or unexpected
// token" — a parse error nowhere near the actual cause.
const head = `<meta charset="utf-8" />
<title>MusicWars</title>
${iconMatch ? iconMatch[0] : ''}
<style>
${css}
</style>`;
const body = `${markup}
<script type="module">
${js.replace(/<\/script/gi, '<\\/script')}
</script>`;

/*
 * `--standalone` emits a REAL DOCUMENT, and the difference is not cosmetic.
 *
 * The fragment above is correct for the Artifact host, which supplies its own
 * doctype, head and body. It is wrong for a file someone double-clicks: with
 * no `<!doctype html>` the browser falls into QUIRKS MODE, where the box model
 * and line-height rules differ from the standards mode this layout has only
 * ever been built and tested in. The demo build was shipped as a fragment and
 * would have rendered under rules nothing here has ever seen.
 *
 * `lang` is set for the same reason a title is: it is a real document now.
 */
const standalone = process.argv.includes('--standalone');
const out = standalone
  ? `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body>
${body}
</body>
</html>
`
  : `${head}
${body}
`;

const target = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) ?? 'dist/musicwars.artifact.html';
writeFileSync(target, out);
console.log(`${target}  ${(out.length / 1024).toFixed(0)} kB${standalone ? '  (standalone document)' : '  (artifact fragment)'}`);
