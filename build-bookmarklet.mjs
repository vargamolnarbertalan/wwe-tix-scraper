// Turns scraper.js into a bookmarklet: `node build-bookmarklet.mjs` writes dist/bookmarklet.html,
// an install page with a link to drag onto the bookmarks bar.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// No minifier: browsers percent-decode javascript: URLs before running them, so newlines survive
// and `//` comments stay safe. The trailing `void 0` keeps the script's completion value undefined;
// otherwise some browsers replace the page with its string form.
// encodeURIComponent never emits " < > & or whitespace, so the result is safe inside href="...".
export const toBookmarklet = (src) => `javascript:${encodeURIComponent(`${src.trim()}\nvoid 0;`)}`;

export const installPage = (url) => `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seat report bookmarklet</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; color: #1a1a1a; background: #fff; }
  a.bm { display: inline-block; padding: .6rem 1rem; border-radius: .5rem; background: #1a56db; color: #fff; text-decoration: none; font-weight: 600; cursor: grab; }
  code { background: #f1f1f1; padding: 0 .25rem; border-radius: .25rem; }
  @media (prefers-color-scheme: dark) { body { color: #eee; background: #161616; } code { background: #2a2a2a; } }
</style>
</head>
<body>
<h1>Ülőhely-riport bookmarklet</h1>
<ol>
  <li>Húzd ezt a gombot a könyvjelzősávra (ne kattints rá itt):<br><br>
    <a class="bm" href="${url}" onclick="event.preventDefault()">Ülőhely-riport</a><br><br></li>
  <li>Nyisd meg az eseményt, pl. <code>https://ln.funcode.hu/events/173976</code>, és add meg az access code-ot, ha kell.</li>
  <li>Kattints a könyvjelzőre. A riport a jobb felső sarokban jelenik meg, <em>Markdown másolása</em> gombbal.</li>
</ol>
<p>Ha a script változik, futtasd újra a <code>node build-bookmarklet.mjs</code>-t, és cseréld le a könyvjelzőt.</p>
</body>
</html>
`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = toBookmarklet(readFileSync(new URL('./scraper.js', import.meta.url), 'utf8'));
  const out = new URL('./dist/', import.meta.url);
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL('bookmarklet.html', out), installPage(url));
  console.log(`dist/bookmarklet.html written (${url.length.toLocaleString('en')} chars)`);
}
