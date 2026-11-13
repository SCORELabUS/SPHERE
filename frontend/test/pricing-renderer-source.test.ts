import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  LATEST_SYNTAX_VERSION,
  retrieveUpgradedPricing,
} from '../src/modules/core/components/pricing-renderer/source.ts';

// Deliberately minimal: what is under test is which path a document takes, not how pricing4ts
// reads one. The older document is the same text with its version changed, because nothing parses
// it -- it goes to the API, which is stubbed here.
const LATEST = `saasName: Test
syntaxVersion: '3.1'
version: '2026-01-01'
createdAt: '2026-01-01'
currency: EUR
features:
  basic:
    description: Basic
    valueType: BOOLEAN
    defaultValue: true
    type: DOMAIN
usageLimits: null
plans:
  FREE:
    description: Free plan
    price: 0
    unit: user/month
    features:
      basic:
        value: true
    usageLimits: null
addOns: null
`;

const OLDER = LATEST.replace("syntaxVersion: '3.1'", "syntaxVersion: '2.1'");

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a document already at the latest syntax is parsed here, without calling the API', async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error('the API must not be called for a document that is already 3.1');
  }) as typeof fetch;

  const pricing = await retrieveUpgradedPricing(LATEST);

  assert.equal(called, false);
  assert.equal(pricing.syntaxVersion, LATEST_SYNTAX_VERSION);
  assert.equal(pricing.saasName, 'Test');
  // Folded here too: this object reaches the renderer whenever the editor's text has already moved
  // below 3.1 while the pricing it holds has not, and an unfolded entry prints its JSON there.
  assert.deepEqual(
    (pricing as unknown as { plans: Record<string, { features: Record<string, unknown> }> }).plans
      .FREE.features.basic,
    { value: true }
  );
});

// The regression this guards: pricing4ts parses an older document without throwing, so a
// `try`/`catch` around the local parse never reached the upgrade and the renderer was handed a
// major 2 it refuses with PR_VERSION_UNSUPPORTED_MAJOR.
test('an older document is upgraded by the API instead of being parsed here', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ saasName: 'Test', syntaxVersion: '3.1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const pricing = await retrieveUpgradedPricing(OLDER);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/v1/pricings');
  assert.equal(calls[0].init.method, 'PUT');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { pricing: OLDER });
  assert.equal(pricing.syntaxVersion, LATEST_SYNTAX_VERSION);
});

test('a document the API cannot upgrade reports the failure', async () => {
  globalThis.fetch = (async () =>
    new Response('{"error":"INVALID DATA"}', { status: 422 })) as typeof fetch;

  await assert.rejects(retrieveUpgradedPricing(OLDER), /Failed to parse pricing/);
});

// `pricing-renderer` reads a plan's entry as the value itself, so handing it the whole feature
// printed its JSON on the card. Only documents that go through the API take this path.
test('each plan keeps the value it gives, not the whole feature', async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        syntaxVersion: '3.1',
        plans: {
          FREE: {
            features: {
              refresh: { name: 'refresh', valueType: 'TEXT', defaultValue: 'daily' },
              exports: { name: 'exports', valueType: 'BOOLEAN', defaultValue: true },
            },
            usageLimits: {
              seats: { name: 'seats', valueType: 'NUMERIC', defaultValue: 1, unit: 'user' },
            },
          },
          PRO: {
            features: {
              refresh: { name: 'refresh', valueType: 'TEXT', defaultValue: 'daily', value: 'hourly' },
            },
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )) as typeof fetch;

  const pricing = (await retrieveUpgradedPricing(OLDER)) as unknown as {
    plans: Record<string, { features: Record<string, unknown>; usageLimits?: Record<string, unknown> }>;
  };

  assert.deepEqual(pricing.plans.FREE.features.refresh, { value: 'daily' });
  assert.deepEqual(pricing.plans.FREE.features.exports, { value: true });
  assert.deepEqual(pricing.plans.FREE.usageLimits?.seats, { value: 1 });
  // An override wins over the feature's default.
  assert.deepEqual(pricing.plans.PRO.features.refresh, { value: 'hourly' });
});
