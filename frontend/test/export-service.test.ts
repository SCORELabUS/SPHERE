import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { createUrlWithEncodedYaml } from '../src/modules/pricing-editor/services/export.service.ts';

const globals = globalThis as { window?: unknown };

afterEach(() => {
  delete globals.window;
});

function at(href: string) {
  globals.window = { location: new URL(href) };
}

test('a full share link is the editor URL with only ?pricing=', () => {
  at('https://sphere.example/editor');
  assert.equal(createUrlWithEncodedYaml('abc'), 'https://sphere.example/editor?pricing=abc');

  at('https://sphere.example/editor?pricing=old&mode=visual');
  assert.equal(createUrlWithEncodedYaml('abc'), 'https://sphere.example/editor?pricing=abc');
});

test('a share link never carries the fragment of the current URL', () => {
  at('https://sphere.example/editor#pricing=private');
  assert.equal(createUrlWithEncodedYaml('abc'), 'https://sphere.example/editor?pricing=abc');

  at('https://sphere.example/editor?source=org/slug#section');
  assert.equal(createUrlWithEncodedYaml('abc'), 'https://sphere.example/editor?pricing=abc');
});
