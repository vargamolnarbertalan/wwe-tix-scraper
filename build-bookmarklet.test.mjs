import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toBookmarklet, installPage } from './build-bookmarklet.mjs';

const PREFIX = 'javascript:';
const decode = (url) => decodeURIComponent(url.slice(PREFIX.length));

test('round-trips the source and ends with void 0 so the page is not replaced', () => {
  const src = "(async () => {\n  // comment\n  return 'a&b \"c\" <d>';\n})();\n";
  const url = toBookmarklet(src);
  assert.ok(url.startsWith(PREFIX));
  assert.equal(decode(url), `${src.trim()}\nvoid 0;`);
});

test('is safe to embed in a double-quoted HTML attribute', () => {
  const url = toBookmarklet('const s = "<a href=\'x\'>&amp;</a>";\n');
  assert.doesNotMatch(url, /["<>&\s]/);
});

test('install page embeds the bookmarklet as a link href', () => {
  const url = toBookmarklet('1;');
  assert.ok(installPage(url).includes(`href="${url}"`));
});

test('the real scraper.js compiles after decoding', () => {
  const url = toBookmarklet(readFileSync(new URL('./scraper.js', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => new Function(decode(url)));
});
