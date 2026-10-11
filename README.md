# wwe-tix-scraper

Seat capacity and sales report (per price band and per level) for funcode / nuweb seating-plan
events, e.g. `https://ln.funcode.hu/events/173976`. Output is Hungarian Markdown.

It runs inside your browser because the site sits behind a Cloudflare challenge: plain HTTP
clients get `403 Just a moment...`, while your browser already holds the clearance cookie,
your session and any access code.

## Bookmarklet (recommended)

1. `node build-bookmarklet.mjs` (Node 18+, no dependencies) writes `dist/bookmarklet.html`.
2. Open that file and drag the button onto your bookmarks bar.
3. Open an event page (enter the access code if needed) and click the bookmark. The report
   appears in a panel at the top right with a copy button.

Rebuild and replace the bookmark whenever `scraper.js` changes.

## DevTools Console

Paste `scraper.js` into the Console on an event page. Same panel and output; the report is
also logged and kept in `window.__seatReport`.

## Tests

`node --test`
