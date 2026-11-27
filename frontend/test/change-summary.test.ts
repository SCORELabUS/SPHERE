import assert from 'node:assert/strict';
import { test } from 'node:test';

import { diffPricings } from '../src/modules/pricing/utils/pricing-diff.ts';
import { summarizeChanges } from '../src/modules/pricing/utils/change-summary.ts';

const before = {
  saasName: 'Demo',
  version: '1.0',
  currency: 'USD',
  features: { sso: { valueType: 'BOOLEAN' }, api: { valueType: 'BOOLEAN' } },
  plans: {
    BASIC: { price: 10, features: { sso: { value: false } } },
    PRO: { price: 20 },
    LEGACY: { price: 5 },
  },
  addOns: { extraSeats: { price: 3 } },
};

const after = {
  saasName: 'Demo',
  version: '1.1',
  currency: 'EUR',
  features: { sso: { valueType: 'BOOLEAN' }, audit: { valueType: 'BOOLEAN' }, exports: { valueType: 'BOOLEAN' } },
  plans: {
    BASIC: { price: 10, features: { sso: { value: true } } },
    PRO: { price: 25 },
    ENTERPRISE: { price: 99 },
  },
  addOns: { extraSeats: { price: 4 } },
};

test('says what each section gained, lost and changed, and which prices moved', () => {
  const summary = summarizeChanges(diffPricings(before, after));
  assert.equal(summary.isEmpty, false);
  assert.deepEqual(
    summary.sections.map(section => [section.key, section.added, section.removed, section.changed]),
    [
      ['features', ['audit', 'exports'], ['api'], []],
      ['plans', ['ENTERPRISE'], ['LEGACY'], ['BASIC', 'PRO']],
      ['addOns', [], [], ['extraSeats']],
    ]
  );
  // BASIC only changed a feature value, which is not a price change.
  assert.deepEqual(summary.priceChanges, ['PRO', 'extraSeats']);
  assert.equal(summary.otherFields, 1);
});

test('reads a first version as everything it starts with, and equal versions as no changes', () => {
  const first = summarizeChanges(diffPricings({}, before));
  assert.deepEqual(
    first.sections.map(section => [section.key, section.added.length]),
    [
      ['features', 2],
      ['plans', 3],
      ['addOns', 1],
    ]
  );
  assert.deepEqual(first.priceChanges, []);

  // Only the version label differs.
  const same = summarizeChanges(diffPricings(before, { ...before, version: '1.0.1' }));
  assert.equal(same.isEmpty, true);
  assert.deepEqual(same.sections, []);
});

test('lists features first, then usage limits, plans and add-ons', () => {
  const withLimits = (limit: number, seats: number, price: number) => ({
    features: { sso: { valueType: 'BOOLEAN' } },
    usageLimits: { users: { valueType: 'NUMERIC', defaultValue: limit } },
    plans: { PRO: { price } },
    addOns: { extraSeats: { price: seats } },
  });
  const changed = summarizeChanges(
    diffPricings(withLimits(5, 3, 20), {
      ...withLimits(10, 4, 25),
      features: { sso: { valueType: 'BOOLEAN' }, audit: { valueType: 'BOOLEAN' } },
    })
  );
  assert.deepEqual(
    changed.sections.map(section => section.key),
    ['features', 'usageLimits', 'plans', 'addOns']
  );

  // A first version is read in the same order.
  const first = summarizeChanges(diffPricings({}, withLimits(5, 3, 20)));
  assert.deepEqual(
    first.sections.map(section => section.key),
    ['features', 'usageLimits', 'plans', 'addOns']
  );

  // Only the summary is reordered: the side-by-side comparison keeps the diff's order.
  assert.deepEqual(
    diffPricings({}, withLimits(5, 3, 20)).sections.map(section => section.key),
    ['plans', 'features', 'addOns', 'usageLimits']
  );
});
