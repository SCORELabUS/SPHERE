import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The inline script at the top of index.html, run as the browser would before anything else.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = /<script id="anonymous-link-referrer">([\s\S]*?)<\/script>/.exec(html)?.[1];

function metasAddedAt(pathname: string) {
  const added: Array<{ name: string; content: string }> = [];
  const document = {
    createElement: () => ({ name: '', content: '' }),
    head: { appendChild: (meta: { name: string; content: string }) => added.push(meta) },
  };
  new Function('location', 'document', script ?? '')({ pathname }, document);
  return added.map(meta => `${meta.name}=${meta.content}`);
}

test('index.html sets no-referrer before anything loads on an anonymous link, and only there (I-1)', () => {
  assert.ok(script, 'index.html keeps the inline script');
  // It runs before the icons, fonts and the app, which would send the URL as Referer.
  assert.ok(html.indexOf('id="anonymous-link-referrer"') < html.indexOf('<link'));
  assert.ok(html.indexOf('id="anonymous-link-referrer"') < html.indexOf('src="/src/main.tsx"'));

  const token = 'Abc_DEF-ghi_jklmnopqrstuvwxyz012';
  assert.deepEqual(metasAddedAt(`/a/${token}`), ['referrer=no-referrer']);
  assert.deepEqual(metasAddedAt(`/a/${token}/`), ['referrer=no-referrer']);
  assert.deepEqual(metasAddedAt(`/sphere/a/${token}`), ['referrer=no-referrer']);
  // The router matches paths case-insensitively.
  assert.deepEqual(metasAddedAt(`/A/${token}`), ['referrer=no-referrer']);
  for (const other of ['/', '/pricings', '/a/short', `/orgs/x/a/${token}x`, `/p/${token}`]) {
    assert.deepEqual(metasAddedAt(other), [], other);
  }
});
