import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import LZString from 'lz-string';
import { retrievePricingFromYaml } from 'pricing4ts';

import {
  readPricingFragment,
  takePricingFragment,
  urlWithoutFragment,
} from '../src/modules/pricing-editor/services/pricing-fragment.ts';
import { TEMPLATE_PETCLINIC_PRICING } from '../src/modules/pricing-editor/pages/pricing2yaml-editor/templates/petclinic.ts';

const encode = (yaml: string) => LZString.compressToEncodedURIComponent(yaml);

/**
 * A valid Pricing2Yaml 3.1 document of about `targetBytes`: the size of a large
 * real pricing (a SaaS with a few hundred features), which is what SPACE sends.
 */
function largePricing(targetBytes: number): string {
  // Descriptions made of varied words, so that the sample compresses about as
  // well as real pricings do (roughly 3:1), not like a repeated template.
  const words = ['access', 'reports', 'team', 'workspace', 'custom', 'priority', 'export', 'audit', 'storage', 'guests',
    'automation', 'integrations', 'dashboards', 'permissions', 'history', 'templates', 'sync', 'api', 'support', 'roles'];
  let seed = 7;
  const nextWord = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return words[(seed >>> 16) % words.length];
  };
  const sentence = (length: number) =>
    Array.from({ length }, (_, i) => (i % 3 === 2 ? `${nextWord()} ${seed % 9973}` : nextWord())).join(' ');

  const features: string[] = [];
  const usageLimits: string[] = [];
  const goldFeatures: string[] = [];

  for (let i = 0; features.join('').length + usageLimits.join('').length < targetBytes - 2_000; i++) {
    features.push(
      `  feature${i}:\n` +
        `    description: ${sentence(12)}\n` +
        `    valueType: BOOLEAN\n` +
        `    defaultValue: false\n` +
        `    expression: pricingContext['features']['feature${i}']\n` +
        `    type: DOMAIN\n`
    );
    goldFeatures.push(`      feature${i}:\n        value: true\n`);

    if (i % 4 === 0) {
      usageLimits.push(
        `  limit${i}:\n` +
          `    description: ${sentence(6)}\n` +
          `    valueType: NUMERIC\n` +
          `    defaultValue: ${i}\n` +
          `    unit: use\n` +
          `    type: NON_RENEWABLE\n` +
          `    linkedFeatures:\n` +
          `    - feature${i}\n`
      );
    }
  }

  return (
    'saasName: Generated\n' +
    'syntaxVersion: "3.1"\n' +
    'version: "1.0.0"\n' +
    'createdAt: "2025-09-19"\n' +
    'currency: EUR\n' +
    `features:\n${features.join('')}` +
    `usageLimits:\n${usageLimits.join('')}` +
    'plans:\n' +
    '  BASIC:\n    description: Basic plan\n    price: 0.0\n    unit: user/month\n    features: null\n    usageLimits: null\n' +
    `  GOLD:\n    description: Gold plan\n    price: 9.0\n    unit: user/month\n    features:\n${goldFeatures.slice(0, 40).join('')}    usageLimits: null\n`
  );
}

test('a URL without a pricing fragment is left to the query parameters', () => {
  for (const hash of ['', '#', '#section', '#foo=bar', 'foo=bar&baz']) {
    assert.deepEqual(readPricingFragment(hash), { status: 'absent' }, hash);
  }
});

test('#pricing= decodes to the YAML that was encoded', () => {
  const encoded = encode(TEMPLATE_PETCLINIC_PRICING);

  assert.deepEqual(readPricingFragment(`#pricing=${encoded}`), { status: 'ok', yaml: TEMPLATE_PETCLINIC_PRICING });
  // `location.hash` includes the `#`, but the leading `#` is optional.
  assert.deepEqual(readPricingFragment(`pricing=${encoded}`), { status: 'ok', yaml: TEMPLATE_PETCLINIC_PRICING });
});

test('only the pricing key of the fragment is read', () => {
  const encoded = encode(TEMPLATE_PETCLINIC_PRICING);

  assert.deepEqual(readPricingFragment(`#foo=bar&pricing=${encoded}&baz=1`), {
    status: 'ok',
    yaml: TEMPLATE_PETCLINIC_PRICING,
  });
});

test('the value decodes whether or not it was percent-encoded again', () => {
  const yaml = `${TEMPLATE_PETCLINIC_PRICING}# ${'+$-'.repeat(20)} ünïcödé €\n`;
  const encoded = encode(yaml);

  assert.match(encoded, /[+$-]/, 'the sample must exercise the characters that form decoding alters');
  assert.deepEqual(readPricingFragment(`#pricing=${encoded}`), { status: 'ok', yaml });
  assert.deepEqual(readPricingFragment(`#pricing=${encodeURIComponent(encoded)}`), { status: 'ok', yaml });
});

test('an empty pricing fragment is an error, not the template', () => {
  for (const hash of ['#pricing', '#pricing=', '#pricing=%20%20', `#pricing=${encode('  \n ')}`]) {
    const result = readPricingFragment(hash);

    assert.equal(result.status, 'invalid', hash);
    assert.match((result as { error: string }).error, /could not be read: it carries no pricing/, hash);
  }
});

test('a value that is not lz-string output is an error', () => {
  for (const hash of ['#pricing=<script>alert(1)</script>', '#pricing=saasName%3A%20X', '#pricing=a.b']) {
    const result = readPricingFragment(hash);

    assert.equal(result.status, 'invalid', hash);
    assert.match((result as { error: string }).error, /not lz-string compressToEncodedURIComponent output/, hash);
  }
});

test('a damaged or cut value is an error', () => {
  const encoded = encode(TEMPLATE_PETCLINIC_PRICING);

  // `----` makes lz-string return null, `zzzz` makes it throw, `AAAA` decodes to ''.
  for (const value of ['----', 'zzzz', 'AAAA', encoded.slice(0, 5)]) {
    const result = readPricingFragment(`#pricing=${value}`);

    assert.equal(result.status, 'invalid', value);
    assert.match((result as { error: string }).error, /damaged or incomplete/, value);
  }
});

test('taking the fragment removes it from the URL and keeps the query and the history state', () => {
  const encoded = encode(TEMPLATE_PETCLINIC_PRICING);
  const state = { usr: null, key: 'abc', idx: 3 };
  const calls: unknown[][] = [];
  const history = {
    state,
    replaceState: (...args: unknown[]) => {
      calls.push(args);
    },
  };

  const result = takePricingFragment(
    { hash: `#pricing=${encoded}`, pathname: '/editor', search: '?mode=visual' },
    history
  );

  assert.deepEqual(result, { status: 'ok', yaml: TEMPLATE_PETCLINIC_PRICING });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], state, 'the router keeps its own state in the entry');
  assert.equal(calls[0][1], '');
  assert.equal(calls[0][2], '/editor?mode=visual');
});

test('an unreadable fragment is removed as well', () => {
  const calls: unknown[][] = [];
  const result = takePricingFragment(
    { hash: '#pricing=----', pathname: '/editor', search: '' },
    { state: null, replaceState: (...args: unknown[]) => void calls.push(args) }
  );

  assert.equal(result.status, 'invalid');
  assert.deepEqual(calls, [[null, '', '/editor']]);
});

test('a URL without a pricing fragment is not rewritten', () => {
  const calls: unknown[][] = [];

  for (const hash of ['', '#section']) {
    takePricingFragment(
      { hash, pathname: '/editor', search: '?pricing=abc' },
      { state: null, replaceState: (...args: unknown[]) => void calls.push(args) }
    );
  }

  assert.deepEqual(calls, []);
});

test('the URL without its fragment keeps the path and the query', () => {
  assert.equal(urlWithoutFragment({ pathname: '/editor', search: '' }), '/editor');
  assert.equal(urlWithoutFragment({ pathname: '/editor', search: '?a=1&b=2' }), '/editor?a=1&b=2');
});

test('a large pricing (~53 KB) decodes whole and quickly', t => {
  const yaml = largePricing(53 * 1024);
  const rawBytes = new TextEncoder().encode(yaml).length;

  assert.ok(rawBytes > 50 * 1024 && rawBytes < 56 * 1024, `generated ${rawBytes} bytes`);
  assert.equal(retrievePricingFromYaml(yaml).saasName, 'Generated', 'the sample is a valid pricing');

  const encoded = encode(yaml);
  const started = performance.now();
  const result = readPricingFragment(`#pricing=${encoded}`);
  const elapsed = performance.now() - started;

  t.diagnostic(`raw ${rawBytes} B, encoded ${encoded.length} chars, decoded in ${elapsed.toFixed(1)} ms`);
  assert.deepEqual(result, { status: 'ok', yaml });
  // Generous bound so a slow CI runner does not fail it; it takes a few ms.
  assert.ok(elapsed < 1_000, `decoding took ${elapsed} ms`);
});
